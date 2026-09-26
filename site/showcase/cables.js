// Cables that hang. One module for both views, so the sag and the colors
// cannot differ between 2D and 3D (spec §5).
//
// WHERE A CABLE STARTS. A fiber end is a connector the plan seated - an LC
// plug in each of an optic's two cages, or a duplex plug in a cassette's
// adapter - and the kit's relief.js cablePoints() names the point each one
// leaves from. Its `at` is in the marker's own frame, so it is mapped through
// the marker's CTM (relief.js says to). A copper end has no plug to seat yet
// (roc-ops/Portrayal#610): it starts at the jack's center.

import {cablePoints} from '../../vendor/relief.js';
import {svgEl} from './artifact.js';

// OS2 jackets are yellow; copper is colored by what it is for.
export const COLORS = {os2: '#e8c547', copper: {server: '#5aa7ff', management: '#9aa3ad'}};
export const colorOf = l => l.media === 'copper'
  ? (COLORS.copper[l.purpose] || COLORS.copper.server) : (COLORS[l.media] || COLORS.os2);

export const WIDTH = 3;          // mm: a patch lead, to scale
const MERGE = 10;                // mm below a duplex pair where the two strands join
// How far a cable hangs below the lower of its two ends: a little always, more
// the farther apart they are, and a few mm more per cable already hung between
// the same two devices, so parallel runs fan out instead of stacking.
// A tag's pitch, in mm: its pill is 18 tall (patch-view.js), plus a gap.
export const TAG_H = 20;
export const sag2d = (dist, fan = 0) => 14 + 0.3 * dist + 5 * fan;

const esc = s => (window.CSS && CSS.escape ? CSS.escape(s) : String(s));

// An end's points in `svg`'s user space, left to right: a fiber end's
// connectors, or a copper end's jack center. null when the end is not drawn.
// `svg` must be in the document, displayed and laid out: this reads
// getScreenCTM and getBoundingClientRect, which are null or zero otherwise.
export function ends2d(svg, dev, path, fiber) {
  const g = svg.querySelector(`[data-device-ref="${esc(dev)}"]`);
  if (!g) return null;
  const inv = svg.getScreenCTM().inverse();
  if (fiber) {
    const pre = `${path}-occupant/`;
    const pts = cablePoints(g).filter(p => p.at && p.path.startsWith(pre));
    if (!pts.length) return null;
    return pts.map(p => {
      const q = new DOMPoint(+p.at[0], +p.at[1]).matrixTransform(inv.multiply(p.el.getScreenCTM()));
      return [q.x, q.y];
    }).sort((a, b) => a[0] - b[0]);
  }
  const port = g.querySelector(`[data-path="${esc(path)}"]`);
  if (!port) return null;
  const b = port.getBoundingClientRect();
  const c = new DOMPoint(b.x + b.width / 2, b.y + b.height / 2).matrixTransform(inv);
  return [[c.x, c.y]];
}

const mean = ps => [ps.reduce((s, p) => s + p[0], 0) / ps.length,
                    ps.reduce((s, p) => s + p[1], 0) / ps.length];

// One end's strands: a duplex pair joins MERGE below its connectors, and the
// cable proper starts there. Returns [start, strandPaths].
function gather(pts) {
  if (pts.length < 2) return [pts[0], []];
  const [mx] = mean(pts);
  const m = [mx, Math.max(...pts.map(p => p[1])) + MERGE];
  return [m, pts.map(p => `M${p[0]} ${p[1]} C${p[0]} ${p[1] + MERGE * 0.6} ${m[0]} ${m[1] - MERGE * 0.6} ${m[0]} ${m[1]}`)];
}

const hang = (a, b, s) => `M${a[0]} ${a[1]} C${a[0]} ${Math.max(a[1], b[1]) + s} ${b[0]} ${Math.max(a[1], b[1]) + s} ${b[0]} ${b[1]}`;

function stroke(g, d, color, w) {
  g.append(svgEl('path', {d, fill: 'none', stroke: '#000', 'stroke-opacity': 0.45,
    'stroke-width': w + 1.2, 'stroke-linecap': 'round'}));
  g.append(svgEl('path', {d, fill: 'none', stroke: color, 'stroke-width': w, 'stroke-linecap': 'round'}));
}

// Every link with at least one end on `view`: both ends -> a hanging cable;
// one end -> a cable hanging off to `edgeX` with a tag (from `tag(at, farEnd,
// link)`) naming the far end (spec §6: front-to-rear runs go round the side).
// A fiber end whose connectors are missing, or a copper end whose port is,
// is recorded loose.
export function drawCables2d(svg, plan, view, {edgeX, tag}) {
  const layer = svgEl('g', {'data-cables': view, 'data-pt-ui': '*'});
  svg.append(layer);
  const fans = new Map();
  const out = [];
  plan.links.forEach((link, i) => {
    const fiber = link.media !== 'copper';
    const sides = [['from', link.from], ['to', link.to]];
    const here = sides.filter(([, e]) => (e[2] || 'front') === view);
    const rec = {link, i, g: null, loose: [], tagged: false};
    out.push(rec);
    if (!here.length) return;
    const pts = here.map(([k, e]) => [k, ends2d(svg, e[0], e[1], fiber)]);
    for (const [k, p] of pts) if (!p) rec.loose.push(k);
    const live = pts.filter(([, p]) => p);
    if (!live.length) return;
    const g = svgEl('g', {'data-cable': 'true', 'data-link-index': String(i),
      'data-media': link.media, 'data-purpose': link.purpose, tabindex: '0'});
    const color = colorOf(link);
    const key = [link.from[0], link.to[0]].sort().join('|');
    const fan = fans.get(key) || 0; fans.set(key, fan + 1);
    const starts = live.map(([, p]) => {
      const [s, strands] = gather(p);
      for (const d of strands) stroke(g, d, color, WIDTH * 0.6);
      return s;
    });
    if (starts.length === 2) {
      const [a, b] = starts;
      stroke(g, hang(a, b, sag2d(Math.hypot(b[0] - a[0], b[1] - a[1]), fan)), color, WIDTH);
    } else if (here.length === 1) {
      const a = starts[0];
      // TAG_H apart per cable already hung between the same two devices, so
      // their tags stack instead of overlapping.
      const b = [edgeX, a[1] + 30 + TAG_H * fan];
      stroke(g, hang(a, b, sag2d(Math.abs(b[0] - a[0]), fan)), color, WIDTH);
      const other = sides.find(([, e]) => (e[2] || 'front') !== view)[1];
      g.append(tag(b, other, link));
      rec.tagged = true;
    }
    const t = svgEl('title', {});
    t.textContent = `${link.from[0]} ${link.from[1]} → ${link.to[0]} ${link.to[1]} · ${link.purpose}, ${link.media}`;
    g.prepend(t);
    layer.append(g);
    rec.g = g;
  });
  return out;
}

// Which ends of the plan do not land on `view`'s drawing: [[linkIndex,
// 'from' | 'to'], ...]. The same test drawCables2d applies, without drawing,
// so the panel can judge every end against its own face whichever is shown.
export function looseOn(svg, plan, view) {
  const out = [];
  plan.links.forEach((link, i) => {
    for (const k of ['from', 'to']) {
      const e = link[k];
      if ((e[2] || 'front') === view && !ends2d(svg, e[0], e[1], link.media !== 'copper')) out.push([i, k]);
    }
  });
  return out;
}

// ── 3D ────────────────────────────────────────────────────────────────────
// The same cables as tubes in the mounted rack. A fiber end starts at the
// room points rack3d.js's cableAnchor finds for its connectors (the same
// cablePoints the 2D half reads); a copper end starts at portAnchor's jack,
// a little proud of the face, since no plug is seated in it yet.
export const LEAD = 40;           // mm straight out of a connector before it can bend
const MERGE3D = 25;               // mm out from a duplex pair where the strands join
const SIDE_CLEAR = 45;            // mm outside the rack's right post, for front-rear runs
const JACK_OUT = 2;               // mm proud of the face a copper end starts, so it is not in the metal
const CLEAR = 5;                  // mm a point pushed out of a chassis ends up past its face
const K = 1.2;                    // catenary shape: f(t) = (cosh(K(2t-1)) - cosh K)/(cosh K - 1)
const cat = t => (Math.cosh(K * (2 * t - 1)) - Math.cosh(K)) / (Math.cosh(K) - 1);
const sag3d = dist => 20 + 0.3 * dist;

// A hanging stretch from p to q: straight between them in x and z, and the
// catenary in y, dipping sag3d of the chord below the straight line mid-way.
function hangBetween(p, q, n = 24) {
  const s = sag3d(p.distanceTo(q));
  const out = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const v = p.clone().lerp(q, t);
    v.y += s * cat(t);
    out.push(v);
  }
  return out;
}

// Where a duplex end's strands join: MERGE3D out from the middle of the pair.
const mergeOf = (THREE, e) => e.points.reduce((s, p) => s.add(p), new THREE.Vector3())
  .multiplyScalar(1 / e.points.length).addScaledVector(e.normal, MERGE3D);

// The main run between two ends, {points, normal} each: from each end's start
// (a duplex pair's merge, or the one point) LEAD straight out, then hanging
// between. Ends on opposite faces go round the rack's right-hand side,
// outside the posts (spec §6).
export function hangPoints3d(THREE, A, B, rackW) {
  const start = e => e.points.length > 1 ? mergeOf(THREE, e) : e.points[0].clone();
  const a = start(A), b = start(B);
  const outA = a.clone().addScaledVector(A.normal, LEAD);
  const outB = b.clone().addScaledVector(B.normal, LEAD);
  const pts = [a, outA];
  if (A.normal.dot(B.normal) < -0.5) {
    const x = rackW / 2 + SIDE_CLEAR;
    const sa = new THREE.Vector3(x, outA.y, outA.z), sb = new THREE.Vector3(x, outB.y, outB.z);
    pts.push(...hangBetween(outA, sa).slice(1), ...hangBetween(sa, sb).slice(1),
             ...hangBetween(sb, outB).slice(1));
  } else {
    pts.push(...hangBetween(outA, outB).slice(1));
  }
  pts.push(b);
  return pts;
}

// Keep a cable out of the metal: a point inside a chassis box is pushed along
// z to CLEAR past whichever of that box's front and rear faces is nearer.
export function clearOf(pts, boxes) {
  for (const p of pts) for (const {box} of boxes) {
    if (!box.containsPoint(p)) continue;
    p.z = box.max.z - p.z <= p.z - box.min.z ? box.max.z + CLEAR : box.min.z - CLEAR;
  }
  return pts;
}

// The world centers of a tube mesh's first and last rings of vertices - where
// the drawn tube actually begins and ends, read off its geometry.
function tubeEnds(THREE, mesh) {
  const pos = mesh.geometry.attributes.position;
  const {tubularSegments: n, radialSegments: r} = mesh.geometry.parameters;
  mesh.updateMatrixWorld(true);
  return [0, n * (r + 1)].map(first => {
    const c = new THREE.Vector3();
    // r distinct vertices: the ring's (r+1)th repeats its first, for the seam.
    for (let j = 0; j < r; j++) c.add(new THREE.Vector3().fromBufferAttribute(pos, first + j));
    return mesh.localToWorld(c.multiplyScalar(1 / r));
  });
}

// Every link of the plan as a tube in `scene` (rack3d.js's scene API). Returns
// {tubes, anchors, boxes, group}: per link {link, i, mesh, loose, points,
// starts} - mesh null and `loose` naming the sides when an end did not land;
// `starts` the drawn ends of its tubes - plus every fiber connector anchored,
// and the chassis boxes the run was kept out of. null when `live()` went
// false during an await.
export async function drawCables3d(scene, plan, {live = () => true} = {}) {
  const {THREE, scene: world} = scene.three;
  const rackW = scene.metrics().rackWidth;
  const boxes = scene.deviceBoxes();
  const refOf = id => (plan.devices || []).find(d => d.id === id)?.ref || id;
  const group = new THREE.Group(); group.name = 'patch-cables';
  const tubes = [], anchors = [];
  for (const [i, link] of plan.links.entries()) {
    const fiber = link.media !== 'copper';
    const ends = [], loose = [];
    for (const [side, [dev, path, view]] of [['from', link.from], ['to', link.to]]) {
      let e = null;
      if (fiber) {
        const got = await scene.cableAnchor({ref: refOf(dev)}, path, {view: view || 'front'});
        if (!live()) return null;
        if (got.length) e = {points: got.map(g => g.position), normal: got[0].normal};
        for (const g of got) anchors.push({i, side, anchor: g});
      } else {
        const a = await scene.portAnchor({ref: refOf(dev)}, path, {view: view || 'front'});
        if (!live()) return null;
        if (a) e = {points: [a.position.clone().addScaledVector(a.normal, JACK_OUT)], normal: a.normal};
      }
      if (!e) loose.push(side);
      ends.push(e);
    }
    if (loose.length) { tubes.push({link, i, mesh: null, loose, points: [], starts: []}); continue; }
    const pts = clearOf(hangPoints3d(THREE, ends[0], ends[1], rackW), boxes);
    const mat = new THREE.MeshStandardMaterial({color: colorOf(link), roughness: 0.6});
    const g = new THREE.Group(); g.name = `cable-${i}`;
    const main = new THREE.Mesh(new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3(pts, false, 'centripetal'), 160, WIDTH / 2, 8, false), mat);
    g.add(main);
    // A duplex end: a thinner strand from each connector into the merge.
    const strands = [];
    for (const e of ends) if (e.points.length > 1) {
      const m = mergeOf(THREE, e);
      for (const p of e.points) {
        const s = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(
          [p, p.clone().addScaledVector(e.normal, 12), m]), 16, WIDTH * 0.3, 6, false), mat);
        g.add(s); strands.push(s);
      }
    }
    group.add(g);
    // Where each connector's run begins, measured off the drawn geometry: a
    // strand's first ring, or the main tube's first or last.
    const starts = [...tubeEnds(THREE, main), ...strands.map(s => tubeEnds(THREE, s)[0])];
    tubes.push({link, i, mesh: g, loose, points: pts, starts});
  }
  world.add(group);
  return {tubes, anchors, boxes, group};
}
