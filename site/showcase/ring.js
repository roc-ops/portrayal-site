// The ROADM ring: the second, real rack the showcase cuts to at stage 4.
//
// Stages 0-3 build the cast rack. Cabling is multi-device, and the cast has no
// links anywhere in the data, so stage 4 cuts to the one topology Portrayal
// ships - labs.json's three-site ring - rather than hand-authoring cables,
// which the standing rule at the top of showcase.js forbids. Everything drawn
// here is read off labs.json and the compiled faces: which devices, where they
// sit, which port each cable end lands on, and what media each cable is.
//
// Stage 5 reuses this module, so it is the ring's, not stage 4's.

import {DIST} from './artifact.js';
import {mount3d} from './rack.js';
import {stale} from './stage-rail.js';

// Colour by what the data says, and nothing else. `media` is on every link;
// `span` is on the six inter-site fibres, which the lab's own provenance
// groups per span, so each span gets its own colour rather than being lost
// among the other twenty-four smf runs. Yellow and blue are the jacket
// conventions for single-mode and copper; the span colours only need to be
// told apart from those and from each other.
export const MEDIA_COLORS = {smf: 0xE6C229, ethernet: 0x3D8BFD};
export const OTHER_MEDIA = 0x9AA1A8;
export const SPAN_COLORS = [0xFF6B35, 0xE040FB, 0x2EC4B6, 0x9CCC65];

// Millimetres. A 42U rack framed in a pane is about a third of a pixel per
// millimetre, so a tube has to be a few millimetres across to show at all.
const TUBE_RADIUS = 2.4;
// A fibre pair is two links in labs.json - every strand is modelled on its own
// - and both strands of a pair land on the SAME port path, because no vendored
// face carries a tx or rx path. So the strand only decides which side of the
// port centre the tube sits on, far enough apart that neither hides the other.
// It is NOT mapped to a bore: which of xc34/1 and xc34/2 is TX is not in the data.
const STRAND_OFFSET = 3.2;
// How far a cable runs straight out of its face before it starts to bend, so it
// does not start inside the metal.
const LEAD = 60;
// A front-to-rear run goes round the right-hand side of the rack (the U numbers
// are on the left), this far outside the posts.
const SIDE_CLEAR = 45;

let labMemo = null;

// The first lab in labs.json, or null when it is missing or empty. Through
// jdist for the same reason rack.js's loadMeta is: one memo for every index.
export async function loadLab() {
  if (labMemo) return labMemo;
  try {
    const {jdist} = await import('../../vendor/dist.js');
    const doc = await jdist(`${DIST}labs.json`);
    const lab = (doc?.labs || [])[0] || null;
    if (lab) labMemo = lab;
    return lab;
  } catch (err) {
    console.warn('[portrayal] no labs.json', err);
    return null;
  }
}

// What the lab says, as counts. Needs no scene, so the panel can show it
// whether or not 3D mounted.
export function summarize(lab) {
  const byMedia = {};
  const spans = new Map();
  for (const l of lab.links || []) {
    byMedia[l.media] = (byMedia[l.media] || 0) + 1;
    if (l.span) spans.set(l.span, (spans.get(l.span) || 0) + 1);
  }
  return {
    devices: (lab.devices || []).length,
    links: (lab.links || []).length,
    byMedia,
    spans: [...spans].map(([span, links]) => ({span, links})),
    rackU: lab.rack?.['height-ru'] ?? null,
  };
}

// A link's colour: its span's, when it has one, otherwise its media's. Spans
// are numbered in the order the lab first names them, so the same lab always
// colours the same way.
export function colorOf(link, lab) {
  if (link.span) {
    const order = [...new Set((lab.links || []).map(l => l.span).filter(Boolean))];
    return SPAN_COLORS[order.indexOf(link.span) % SPAN_COLORS.length];
  }
  return MEDIA_COLORS[link.media] ?? OTHER_MEDIA;
}

// The lab's devices as a rack3d stack. cfg is each ref's own configs.json
// `default`, and chassis/bays/cages come from the same index, so mount3d has
// nothing to guess. label is the lab's id - unique, which is what lets
// portAnchor name one of nine devices that are only two models.
async function ringStack(lab) {
  const {jdist} = await import('../../vendor/dist.js');
  const idx = {};
  for (const ref of new Set(lab.devices.map(d => d.ref))) {
    try { idx[ref] = await jdist(`${DIST}${ref}.configs.json`); }
    catch (err) { console.warn('[portrayal] no config index for', ref, err); }
  }
  return lab.devices.filter(d => idx[d.ref]).map(d => ({
    ref: d.ref, cfg: idx[d.ref].default, ru: d.ru, label: d.id,
    chassis: idx[d.ref].chassis, bays: idx[d.ref].bays || {}, cages: idx[d.ref].cages || {},
  }));
}

// Remove the tubes from the scene and free them. The scene's own dispose()
// walks its graph, but these are ours: they are freed here, by name, rather
// than relying on that walk to know they exist.
export function disposeTubes(scene, tubes) {
  for (const t of tubes || []) {
    if (!t.object) continue;
    t.object.parent?.remove(t.object);
    t.object.geometry.dispose();
    t.object.material.dispose();
    t.object = null;
  }
}

// Everything mountRing made: the tubes, then the scene. Idempotent, because
// two parties can hold the same ring: the stage's exit(), which may run while
// mountRing is still awaiting, and mountRing's own stale path after it.
export function disposeRing(ring) {
  if (!ring?.scene || ring.disposed) return;
  ring.disposed = true;
  disposeTubes(ring.scene, ring.tubes);
  ring.scene.dispose();
}

// One end, shifted across the port by strand. "Across" is the face's own
// horizontal: perpendicular to the way the face points and to the vertical.
function endPoint(THREE, anchor, strand) {
  const p = anchor.position.clone();
  const off = strand === 'rx' ? STRAND_OFFSET : strand === 'tx' ? -STRAND_OFFSET : 0;
  if (!off) return p;
  let across = new THREE.Vector3().crossVectors(anchor.normal, new THREE.Vector3(0, 1, 0));
  if (across.lengthSq() < 1e-6) across = new THREE.Vector3(1, 0, 0);
  return p.addScaledVector(across.normalize(), off);
}

// The route: out of each face along its normal, then either straight across
// the front of the rack (same side) or round its right-hand side (front to
// rear). The bulge grows with the vertical distance so runs between the same
// pair of heights do not stack on top of one another.
function route(THREE, a, na, b, nb, rackW) {
  const outA = a.clone().addScaledVector(na, LEAD);
  const outB = b.clone().addScaledVector(nb, LEAD);
  const pts = [a, outA];
  if (na.dot(nb) > 0.5) {
    const mid = outA.clone().add(outB).multiplyScalar(0.5);
    mid.addScaledVector(na.clone().add(nb).normalize(), 20 + Math.abs(a.y - b.y) * 0.25);
    pts.push(mid);
  } else {
    const x = rackW / 2 + SIDE_CLEAR;
    pts.push(new THREE.Vector3(x, outA.y, outA.z), new THREE.Vector3(x, outB.y, outB.z));
  }
  pts.push(outB, b);
  return new THREE.CatmullRomCurve3(pts, false, 'centripetal');
}

// Mount the ring on its own rails and cable it.
//
//   mountRing({mine, onScene?}) ->
//     {scene, lab, tubes: [{link, object, anchored, views?}], ends: {anchored, total}}
//       views is [fromFace, toFace] as portAnchor found them, on drawn tubes
//     {scene: null, lab}              no WebGL, or no lab (lab is then null)
//     null                            the stage went stale; nothing is left over
//
// `mine` is the caller's epoch. Every await is followed by a stale check, and
// on the stale path everything this created - tubes and scene - is disposed
// before returning null, so a caller that has moved on owns nothing.
// `onScene(ring)` is called with the ring handle as soon as the scene exists,
// before the anchor pass, so a caller's
// exit() can dispose it at once rather than leaving a render loop and a GL
// context alive until this function next checks the epoch. The handle it gets
// is the one this returns, filled in as the cables are drawn.
// A link with an end that does not anchor is not drawn: its tube entry has
// `anchored: false` and `object: null`, and the ends count says so.
export async function mountRing({mine, onScene} = {}) {
  const lab = await loadLab();
  if (stale(mine)) return null;
  if (!lab) return {scene: null, lab: null};

  const stack = await ringStack(lab);
  if (stale(mine)) return null;

  // Its own rails, at the lab's own height. An empty overrides map: the
  // cast's seated modules belong to the cast, not to this rack.
  const scene = await mount3d({stack, heightRU: lab.rack?.['height-ru'] || 42, overrides: {}});
  if (stale(mine)) { scene?.dispose(); return null; }
  if (!scene) return {scene: null, lab};
  const ring = {scene, lab, tubes: [], ends: {anchored: 0, total: 0}, disposed: false};
  onScene?.(ring);

  // NO await scene.complete() HERE, on purpose. portAnchor reads the face
  // documents directly (faceDoc) and the device transforms build() already
  // set; it does not need the deferred faces installed - complete() only
  // waits on the relief pass, which is cosmetic depth. Verified: all 60
  // anchors taken before and after complete() were identical, including the
  // 6 rear management ends. Awaiting it cost about a minute before any cable
  // appeared, for no change in where the cables go.

  const {THREE, scene: world} = scene.three;
  const rackW = scene.metrics().rackWidth;
  // One at a time, not Promise.all: rack3d.js caches a face per mount but
  // does not dedupe a fetch already in flight, so two concurrent anchors on
  // one face would each park a measuring copy in the document and the cache
  // would keep only one of them.
  const ends = [];
  for (const ep of lab.links.flatMap(l => [l.from, l.to])) {
    // {label}, NEVER a bare ref: nine devices, two models, and a bare ref is
    // the first of that model every time. The port is ep[1]; ep[2] is a
    // strand, not a path.
    ends.push(await scene.portAnchor({label: ep[0]}, ep[1]).catch(() => null));
    if (stale(mine) || ring.disposed) { disposeRing(ring); return null; }
  }

  const group = new THREE.Group();
  group.name = 'ring-cables';
  const tubes = ring.tubes;
  let anchored = 0;
  lab.links.forEach((link, i) => {
    const a = ends[2 * i], b = ends[2 * i + 1];
    anchored += (a ? 1 : 0) + (b ? 1 : 0);
    if (!a || !b) { tubes.push({link, object: null, anchored: false}); return; }
    const curve = route(THREE, endPoint(THREE, a, link.from[2]), a.normal,
                        endPoint(THREE, b, link.to[2]), b.normal, rackW);
    const mesh = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 96, TUBE_RADIUS, 8, false),
      new THREE.MeshStandardMaterial({color: colorOf(link, lab), roughness: 0.55}));
    mesh.name = `${link.from.join(':')}->${link.to.join(':')}`;
    mesh.userData = {media: link.media, span: link.span || null};
    group.add(mesh);
    tubes.push({link, object: mesh, anchored: true, views: [a.view, b.view]});
  });
  world.add(group);
  ring.ends = {anchored, total: ends.length};
  return ring;
}
