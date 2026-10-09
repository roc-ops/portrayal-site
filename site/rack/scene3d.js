// THE RACK BUILDER'S 3D VIEW. A thin adapter over rack3d.js's createRackScene,
// the same one the showcase mounts (site/showcase/rack.js's mount3d) - one
// source, several views, and a swap in the side panel reaches both.
//
// This module owns none of the page's state: it is handed a rack and a way
// to look up a device's physical size, and it hands back a built scene (or
// null) for the page to hold onto, rebuild and dispose.

import {el} from './dom.js';
import {cableFacts, UNCHECKED} from './cable-plugs.js';
import {mergeSeats, cablePlan3d, endKey} from '../../vendor/rack/cable-rules.js';
import {drawCables3d, WIDTH} from './cables.js';
import {throughRings} from '../../vendor/rack/route-path.js';
import {trunkMarks, trunkMembers, strapAt, drawableRuns, bendViolations, trunkIndexOf} from './bundle-view.js';
import {laneX} from '../../vendor/rack/route.js';
import {RU, SIDES} from '../../vendor/rack/rails.js';
import {zeroUOf, zeroUBottom} from '../../vendor/rack/model.js';
import {isZeroUPart, isNarrow} from '../../vendor/rack/fit.js';
import {faceOfAt, zeroUX} from '../../vendor/rack/zero-u.js';
import {laneXAt} from '../../vendor/rack/route.js';
import {labelsFor} from './stage.js';

const NO_WEBGL = "3D isn't available in this browser, so the rack is shown in 2D only.";

// THE RACK'S CABLES AS TUBES (Phase 2b ruling 5), drawn once the devices are
// built. An end is found on the mount of its own item (rack3d.js findMounted
// by id: two items can share a ref) and on the device's own panel:
//   - an end the page calls loose (cable-plugs.js: an empty cage, a removed
//     device) does not land, so 2D and 3D agree on which cables hang free;
//   - an end with a plug or a DAC end seated lands on its cable points;
//   - any other end lands on the center of its port, as it does in 2D.
// Where a route's waypoints are in the room. A ring, duct or pass by its
// drawing (guideAnchor, which tries the ring's own components and the guide
// and pass rects); a lane LANE_GAP/2 outside the posts at the U's middle.
// Cables that share a waypoint are spread on a small grid so their tubes do
// not overlap.
// THE RINGS AS THE KIT DECIDED THEM (Portrayal #930): `marks` is cable id ->
// route.js ringMarks, one per waypoint. The scene is in the rack's own axes,
// so they pass unturned; each is dropped in step with a waypoint the scene
// cannot place, and a ring's spread is across its own run, at its centre,
// before cables.js routePoints3d expands it to its entry and exit.
// Returns {points, marks} per link.
const SPREAD = 6;   // mm between cables sharing a waypoint
// A waypoint's point in the room, unspread, and the run a cable takes there.
async function anchorOf(scene, THREE, w, laneAt) {
  const m = scene.metrics();
  let p = null, run = 'x';
  if (w.lane) {
    const [, face = 'front'] = w.lane.split('-');
    // Through a zero-U duct where one stands on this lane (route.js laneXAt).
    p = new THREE.Vector3(laneAt(w.lane, w.ru), (w.ru - 0.5) * RU, face === 'rear' ? m.faceZ - m.railDepth : m.faceZ);
    run = 'y';
  } else {
    // A ring: x and z from its top-view component, y from the center of
    // its end rect, so the point is the center of the OPENING. A duct runs
    // along x like a ring; a pass crosses the face, along z.
    const [top, end] = await Promise.all([w.via, `${w.via}-end`].map(id => scene.guideAnchor({id: w.item}, id)));
    if (top || end) {
      p = (top || end).position.clone();
      if (top && end) p.y = end.position.y;
    } else {
      const duct = await scene.guideAnchor({id: w.item}, `guide--${w.via}`);
      const pass = duct ? null : await scene.guideAnchor({id: w.item}, `pass--${w.via}`);
      if (duct || pass) p = (duct || pass).position.clone();
      if (pass) run = 'z';
    }
  }
  return p ? {p, run} : null;
}
// The two axes across a run.
const across = run => (run === 'x' ? ['y', 'z'] : run === 'y' ? ['x', 'z'] : ['x', 'y']);
// A BUNDLE'S MEMBERS (portrayal-site#142): where a member rides its trunk
// (`places`, bundle-view.js memberPlaces), the bundle takes ONE slot of the
// grid at each waypoint, as one cable would, and its members are packed
// inside the bundle's diameter around that slot's centre, in the same 3x3
// grid at a pitch that keeps them in (bundle-view.js combOffset's rule).
// `bases` collects each bundle's slot offset from the waypoint's anchor, per
// lane or pathway, Map(`bundle|key` -> Vector3), for its tube (hangBundles).
function waypointsFor(scene, routes, THREE, laneAt = (lane, ru) => laneX(lane.split('-')[0]), marksOf = new Map(),
                      places = null, bases = new Map()) {
  const used = new Map(), slot = new Map();
  return async link => {
    const r = routes?.get(link.id);
    if (!r) return {points: [], marks: null};
    const all = marksOf.get(link.id);
    const given = all?.length === r.waypoints.length ? all : null;
    const place = places?.get(link.id) ?? null;
    const out = [], marks = [];
    for (const [i, w] of r.waypoints.entries()) {
      const got = await anchorOf(scene, THREE, w, laneAt);
      if (!got) continue;
      const {p} = got, anchor = p.clone();
      let {run} = got;
      const mark = given?.[i] ?? null;
      if (mark?.run) run = mark.run;
      // Spread across the run: the first cable at 0, then +-1 steps, on a 3x3
      // grid (it wraps after 9 cables sharing a waypoint).
      // A lane takes one slot per cable per lane, so the cable's run along it is
      // straight (vertical), as cable-view.js draws it; a ring or duct takes one per cable.
      const inBundle = place && i >= place.stretch[0] && i <= place.stretch[1];
      const key = w.lane ? `${w.lane}` : `${w.item}|${w.via}`, own = inBundle ? `${place.bundle}|${key}` : `${link.id}|${key}`;
      if (!slot.has(own)) { slot.set(own, used.get(key) || 0); used.set(key, (used.get(key) || 0) + 1); }
      const k = slot.get(own);
      const off = n => ((n + 1) % 3 - 1) * SPREAD;   // 0, +1, -1, 0, ...
      const [u, v] = across(run);
      p[u] += off(k % 3); p[v] += off(Math.floor(k / 3) % 3);
      if (inBundle) {
        if (!bases.has(own)) bases.set(own, p.clone().sub(anchor));
        const pitch = Math.min(SPREAD, Math.max(0, (place.diameter ?? WIDTH * 3) - WIDTH) / 2);
        const j = place.index;
        p[u] += ((j + 1) % 3 - 1) * pitch; p[v] += ((Math.floor(j / 3) + 1) % 3 - 1) * pitch;
      }
      out.push(p);
      marks.push(mark);
    }
    return {points: out, marks: given ? marks : null};
  };
}

// THE BUNDLES AS TUBES (portrayal-site#142; design section 6): each drawn
// bundle's trunk as a tube of its diameter (the kit's size check), see-through
// so its members show packed inside, through the same points its members take
// (each waypoint's anchor moved by the bundle's slot offset there), passing
// each ring the way its members do (bundle-view.js trunkMarks; the scene is in
// the rack's axes, so they pass unturned); and each strap a band round it at
// the kit's position along its trunk segment. Returns {group, bundles: [{id,
// diameter, points, straps: [Vector3]}]}.
const STRAP_BAND = 12;   // mm along the run: a strap as drawn
async function hangBundles(scene, rack, facts, laneAt, bases) {
  const {THREE, scene: world} = scene.three;
  const group = new THREE.Group(); group.name = 'cable-bundles';
  const out = [];
  for (const f of facts.bundles.values()) {
    const L = f.check?.layout;
    if (!f.drawn || !L?.trunk?.length) continue;
    const pts = [];
    for (const w of L.trunk) {
      const key = w.lane ? `${w.lane}` : `${w.item}|${w.via}`;
      const a = (await anchorOf(scene, THREE, w, laneAt))?.p ?? null;
      const off = bases.get(`${f.id}|${key}`);
      pts.push(a && off ? a.add(off) : a);
    }
    const D = Math.max(f.diameter ?? 0, WIDTH * 2);
    const marks = trunkMarks(L.trunk, trunkMembers(f, facts.routes, facts.marks, facts.places));
    const g = new THREE.Group(); g.name = `bundle-${f.id}`;
    const jacket = new THREE.MeshStandardMaterial({color: 0x8b939c, roughness: 0.7, transparent: true, opacity: 0.45,
                                                   depthWrite: false});
    const strapMat = new THREE.MeshStandardMaterial({color: 0x24282d, roughness: 0.8});
    for (const run of drawableRuns(pts)) {
      const rings = marks.slice(run.from, run.from + run.points.length);
      const path = rings.some(Boolean) ? throughRings(run.points, rings, {lead: 30}).points : run.points;
      const smooth = [path[0]];
      for (let k = 1; k < path.length - 1; k++) {
        const [p, q, s] = [path[k - 1], path[k], path[k + 1]];
        const ease = (from, to) => { const d = to.distanceTo(from); return to.clone().lerp(from, Math.min(30, d / 2) / (d || 1)); };
        smooth.push(ease(p, q), q.clone(), ease(s, q));
      }
      smooth.push(path.at(-1));
      const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(smooth, false, 'centripetal'),
        Math.max(40, smooth.length * 12), D / 2, 16, false), jacket);
      tube.name = `bundle-${f.id}-trunk`;
      tube.renderOrder = 1;
      g.add(tube);
    }
    const at = [];
    const vec = pts.map(p => (p ? [p.x, p.y, p.z] : null));
    (f.straps?.straps ?? []).forEach((s, k) => {
      const hit = strapAt(vec, s);
      if (!hit) return;
      const band = new THREE.Mesh(new THREE.CylinderGeometry(D / 2 + 1.5, D / 2 + 1.5, STRAP_BAND, 20, 1, false), strapMat);
      band.position.set(...hit.at);
      band.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...hit.dir));
      band.name = `bundle-${f.id}-strap-${k}`;
      band.userData.strap = {bundle: f.id, along_mm: s.along_mm};
      g.add(band);
      at.push(band.position.clone());
    });
    // A corner too tight for its bend radius (kit 0.8.0, Portrayal #922): a
    // warning ring round the tube there. Nothing before 0.8.0.
    const tight = [];
    for (const v of bendViolations(f.check)) {
      const p = pts[trunkIndexOf(L.trunk, v.waypoint)];
      if (!p) continue;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(D / 2 + 8, 1.5, 8, 32),
        new THREE.MeshBasicMaterial({color: 0xd9822b}));
      ring.position.copy(p);
      ring.name = `bundle-${f.id}-bend-${tight.length}`;
      g.add(ring);
      tight.push(p.clone());
    }
    group.add(g);
    out.push({id: f.id, diameter: D, points: pts.filter(Boolean), straps: at, tight});
  }
  world.add(group);
  return {group, bundles: out};
}

// A ZERO-U PART, STOOD BESIDE ITS UPRIGHT: across, its centre line (the kit's
// zero-u.js zeroUX, against the upright's outer face); along the rack, centred on the
// upright's depth (a 34 mm post box behind its mounting face). Its height is
// rack3d.js's own, from its bottom U. Every anchor (guideAnchor, portAnchor)
// reads the group's world matrix, so moving the group moves them too.
const POST_D = 34;
function placeZeroU(scene, parts, chassisOf) {
  const m = scene.metrics();
  for (const z of parts) {
    const g = scene.three.scene.getObjectByName(`device-${z.id}`);
    if (!g) continue;
    const rear = faceOfAt(z.at) === 'rear';
    g.position.x = zeroUX(z, chassisOf);
    g.position.z = rear ? m.faceZ - m.railDepth + POST_D / 2 : m.faceZ - POST_D / 2;
    g.rotation.y = rear ? Math.PI : 0;
    g.userData.zeroU = {id: z.id, at: z.at};
  }
}

// A NARROW PART ON ONE RAIL (the kit's fit.js railOf, `side`) stands over that rail's hole
// line, as elevation.js draws it, and is turned end over end on the right rail.
// `side` is as seen from its own face; a rear part's group is already turned
// round, so its left is the rack's right as seen from the front.
function placeSided(scene, items, chassisOf) {
  for (const it of items) {
    if (!(it.side === 'left' || it.side === 'right') || !isNarrow(chassisOf(it.ref))) continue;
    const g = scene.three.scene.getObjectByName(`device-${it.id}`);
    if (!g) continue;
    const left = (it.side === 'left') === (it.face !== 'rear');
    g.position.x = (left ? SIDES[0] : SIDES[1]).hole;
    g.rotation.z = it.side === 'right' ? Math.PI : 0;
    g.userData.side = it.side;
  }
}

// Returns drawCables3d's {tubes, anchors, boxes, group} plus `checked` and the
// `facts` the cables were hung by (an export's notes read those, so they
// describe this scene and not a later reading), or {failed: true} when the
// cables could not be drawn: the rack still stands, and an export of it says so.
async function hangCables(scene, rack, facts, routes, chassisOf = null, marks = null, bundles = null) {
  const loose = new Set([...facts.ends].filter(([, v]) => v.reason != null).map(([k]) => k));
  const laneAt = (lane, ru) => laneXAt(rack, lane, ru, chassisOf);
  const bases = new Map();
  try {
    const drawn = await drawCables3d(scene, cablePlan3d(rack), {anchor: async (item, path, view) => {
      if (loose.has(endKey({item, path, view}))) return [];
      const got = await scene.cableAnchor({id: item}, path, {view});
      if (got.length) return got;
      const port = await scene.portAnchor({id: item}, path, {view});
      return port ? [{position: port.position, normal: port.normal, view, path}] : [];
    }, waypoints: waypointsFor(scene, routes, scene.three.THREE, laneAt, marks ?? new Map(), bundles?.places ?? null, bases)});
    // The bundles over the cables they hold; one failing costs only the bundles.
    let hung = null;
    if (bundles?.bundles?.size) {
      try { hung = await hangBundles(scene, rack, {...bundles, routes, marks}, laneAt, bases); }
      catch (err) { console.warn('[portrayal] the bundles could not be drawn in 3D', err); }
    }
    return {...drawn, checked: !facts.unchecked, facts, bundles: hung};
  } catch (err) {
    console.warn('[portrayal] the cables could not be drawn in 3D', err);
    return {failed: true};
  }
}

// `camera`, when given, is `{position, target}` from a previous build - saved
// by the page just before it disposes the old scene, so a rebuild (a commit,
// or a frame change) restores the orbit instead of snapping back to the
// opening view. `stage` is the background colour the reader picked (stage.js);
// the page changes it on a built scene with setStage below.
// `bundles` is routeFacts' {bundles, places} (bundle-view.js), or null.
export async function mountRack3d(container, {rack, chassisOf, camera = null, failFacts = false, routes = null, marks = null,
                                              bundles = null, stage = '#101214'}) {
  const frame = rack.frame;
  // PLUGS ARE DERIVED, NEVER STORED: as in 2D, a cabled end is built with the
  // plug its port takes, laid over the item's own swaps for this scene only.
  // If the cables' faces cannot be read the rack is built without plugs, and
  // every end is tried as it is.
  const cabled = (rack.cables || []).length > 0;
  const facts = !cabled ? UNCHECKED : await (failFacts ? Promise.reject(new Error('probe: scene cableFacts fails')) : cableFacts(rack)).catch(err => {
    console.warn("[portrayal] 3D: could not read the cables' faces", err);
    return UNCHECKED;
  });
  // The stack rack3d.js reads, mapped from this document's own items.
  // `chassis` is filled from the SAME lookup the 2D elevation and the fit
  // rules use (chassisOf), not fetched again from the compiled index -
  // rack3d.js prefers a caller's own chassis over one it would otherwise
  // fetch, and reading the two views' sizes from one place is the whole
  // argument this rack makes for itself (see rack3d.js's own banner).
  //
  // Optic fields (item.fields) are NOT carried over: createRackScene has no
  // fields input yet, so a swap into a bay shows in 3D but a field edit on an
  // optic does not, until that lands.
  const stack = rack.items.map(item => ({
    id: item.id,
    ref: item.ref, cfg: item.cfg, ru: item.ru, label: item.label,
    face: item.face, turned: item.turned, overrides: mergeSeats(item.swaps, facts.seats[item.id]),
    chassis: chassisOf?.(item.ref) || undefined,
    mount: chassisOf?.(item.ref)?.mount,
  }));
  // ZERO-U PARTS stand beside an upright (the kit's zero-u.js): built as any device is,
  // then stood in place once built (placeZeroU). A four-post's rear upright
  // carries its part facing rearward, as a rear device faces.
  const sideParts = chassisOf ? zeroUOf(rack).filter(z => isZeroUPart(chassisOf(z.ref))) : [];
  for (const z of sideParts) {
    stack.push({id: z.id, ref: z.ref, cfg: z.cfg, ru: zeroUBottom(z), label: z.label,
                face: faceOfAt(z.at) === 'rear' ? 'rear' : 'front', turned: false, overrides: {},
                chassis: chassisOf(z.ref), mount: 'rack-side'});
  }

  // Imported here, not at module load: rack-page.js pulls this module in on
  // every visit, most of which never switch to 3D, and three.js (through
  // rack3d.js) is not a cost a 2D-only visit should pay - the showcase's own
  // mount3d (site/showcase/rack.js) makes the same choice for the same
  // reason.
  const {guard3d} = await import('../webgl.js');
  const scene = await guard3d(async () => {
    const {createRackScene} = await import('../rack3d.js');
    const built = createRackScene(container, {
      stack, heightRU: frame.heightRU,
      frame: frame.kind === 'four-post' ? {kind: 'four-post', railDepth: frame.railDepth} : null,
      background: stage, ...labelsFor(stage),
    });
    built.setStage = c => { built.setBackground(c); built.setLabelColors(labelsFor(c)); };
    await built.build();
    placeZeroU(built, sideParts, chassisOf);
    placeSided(built, rack.items, chassisOf);
    // What the scene holds of the cables, for the page and the exports: null
    // for a rack with none (nothing is added to the scene at all).
    built.rackCables = cabled ? await hangCables(built, rack, facts, routes, chassisOf, marks, bundles) : null;
    if (camera) {
      built.three.camera.position.copy(camera.position);
      built.three.controls.target.copy(camera.target);
      built.three.controls.update();
    }
    return built;
  }, () => {
    // A fixed, page-level sentence rather than guard3d's own (more technical,
    // chrome://gpu-pointing) message: the Rack Builder always has a working
    // 2D view right behind this one, which the showcase's 3D stages do not,
    // so what a reader needs to know here is simply that 2D is still there.
    container.replaceChildren(el('p', {class: 'rk-notice', role: 'status', text: NO_WEBGL}));
  });
  return scene;
}
