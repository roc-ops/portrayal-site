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
import {strapAt, drawableRuns, bendViolations, trunkIndexOf, drawnDiameter, strapDrawn, STRAP_DRAWN, TIE_HALF, tieCentre} from './bundle-view.js';
import {pointOf} from '../../vendor/rack/route.js';
import {RU, SIDES} from '../../vendor/rack/rails.js';
import {zeroUOf, zeroUBottom, zeroUBottomMm, uLabel} from '../../vendor/rack/model.js';
import {isZeroUPart, isNarrow, setbackOf} from '../../vendor/rack/fit.js';
import {faceOfAt, zeroUX} from '../../vendor/rack/zero-u.js';
import {solidsOf, traysOf} from '../../vendor/rack/solids.js';
import {labelsFor, strapPaint} from './stage.js';
import {clearCurve, tightText, insideOf, radiusOf} from './bend3d.js';
import {landedBends, bendPoints, widthLookup} from './route-context.js';
import {coverPathsOf, takeCovers, COVERS_DEFAULT} from './covers.js';
import {LOOP_PAINT, LOOP_LONG, LOOP_SHORT, loopScale, loopTitle} from './spare-loops.js';

const NO_WEBGL = "3D isn't available in this browser, so the rack is shown in 2D only.";

// THE RACK'S CABLES AS TUBES (Phase 2b ruling 5), drawn once the devices are
// built. An end is found on the mount of its own item (rack3d.js findMounted
// by id: two items can share a ref) and on the device's own panel:
//   - an end the page calls loose (cable-plugs.js: an empty cage, a removed
//     device) does not land, so 2D and 3D agree on which cables hang free;
//   - an end with a plug or a DAC end seated lands on its cable points;
//   - any other end lands on the center of its port, as it does in 2D.
// A ROUTED CABLE IS DRAWN THROUGH THE KIT'S OWN POINTS (portrayal-site#166):
// route.js routePath, measured once by route-context.js routeFacts, with
// each plug's reach (the plug's cable-point z, kit 0.13.0), each ring's
// approach, entry and exit on its sill (kit 0.14.0 and 0.15.0), a tray's
// stretch, each free span's rest, each detour and each lead point (kit
// 0.17.0: `at: 'lead'`, where a turn is given its room - a point of the
// path like the others, and drawn as one). The scene is in the rack's
// own axes with the front rail plane at metrics().faceZ, so a point in rack
// mm is (x, y, faceZ + z). Nothing is placed here: no ring centre, no lead,
// no spread. Cables through one ring share its sill point, as the kit lays a
// cable on its own (the lay of several is the kit's step 5).
const inScene = (THREE, faceZ) => q => new THREE.Vector3(q.x, q.y, faceZ + q.z);
// link -> {points, kit: true}: the kit's points between the two ports (the
// reach points included, the ports left out: the tube starts at the plugs).
// A cable with no waypoints and nothing to go round gets its points too, with
// `free: true`: it is not a routed cable (no ring, lane or tray), but it is
// drawn on the kit's free span, not on a hang of the site's own.
// `bundles` is routeFacts' Map of bundle facts, each with its lay
// (bundle-view.js trunkLay), and `places` each member's stretch; `rack` and
// `ctx` place a ring's opening (stopCentre).
function kitPointsFor(THREE, faceZ, paths, routes, places = null, bundles = null, rack = null, ctx = null) {
  const at = inScene(THREE, faceZ);
  const centres = new Map();
  const centreOf = (w, rt) => {
    const k = `${w.item}|${w.via}|${rt}`;
    if (!centres.has(k)) centres.set(k, rack ? stopCentre(rack, w, ctx, rt) : null);
    return centres.get(k);
  };
  return async link => {
    const p = paths?.get(link.id), ws = routes?.get(link.id)?.waypoints;
    if (!p?.points?.length) return {points: []};
    // A cable with no waypoints and no detour is drawn through the kit's points
    // too (portrayal-site#178): its path is the free span as it hangs (`rest`
    // points), the same one its length is measured on.
    const free = !ws?.length && !p.detours?.length;
    // the reach points are where the plugs end: the scene's own plug points
    // stand there (the plug's cable-point z is the kit's reach), so the tube
    // starts at those, and the two reach points come along to say how far apart
    const reach = ['a', 'b'].map(e => p.points.find(q => q.at === 'reach' && q.end === e)).map(q => (q ? at(q) : null));
    const inner = p.points.filter(q => q.at !== 'a' && q.at !== 'b' && q.at !== 'reach');
    const pts = inner.map(q => Object.assign(at(q), {kitAt: q.at}));
    // A BUNDLE'S MEMBER (portrayal-site#142) is packed inside its bundle along
    // the whole of its ride (bundle-view.js trunkLay `pack`: its place in the
    // circle of the bundle's diameter where it is, in the bundle's own order
    // across the run). On a lane the circle is about the kit's lane point. At
    // a ring or a tray whose opening the kit places it stands ON the floor,
    // where the trunk is laid (stopCentre: its radius over the opening's
    // lowest inside edge), so every point the kit gives the member there - its
    // approach, its entry and its exit - is that centre plus its place, kept
    // inside the opening by its own radius. A ring the kit places no opening
    // for keeps the kit's points as the circle's centre. A member's lead point
    // is its own way to the ring, and is left where the kit put it.
    const place = places?.get(link.id), lay = place ? bundles?.get(place.bundle)?.lay ?? null : null;
    if (place && lay && ws?.length) {
      const rides = n => n >= place.stretch[0] && n <= place.stretch[1];
      const r = WIDTH / 2;
      // how far each packed point was moved from the kit's, for the spans between
      const moved = new Map(), kit = pts.map(v => v.clone());
      let w = 0;
      inner.forEach((q, k) => {
        if (q.at === 'lane') {
          while (w < ws.length && !ws[w].lane) w++;
          const o = w < ws.length && rides(w) ? lay.pack(link.id, lay.indexOf(ws[w])) : null;
          if (o) { pts[k].x += o.x; pts[k].y += o.y; pts[k].z += o.z; moved.set(k, pts[k].clone().sub(kit[k])); }
          w++;
          return;
        }
        if (!q.item || !q.via || q.at === 'lead') return;
        const n = ws.findIndex((x, m) => rides(m) && !x.lane && x.item === q.item && x.via === q.via);
        if (n < 0) return;
        const i = lay.indexOf(ws[n]), o = lay.pack(link.id, i), node = lay.at(i);
        if (!o || !node) return;
        const c = centreOf(ws[n], node.diameter / 2);
        const b = c ? c.at(q) : q;
        const v = {x: b.x + o.x, y: b.y + o.y, z: b.z + o.z};
        if (c) {
          const [lo, hi] = [c.box[`${c.across}0`] + r, c.box[`${c.across}1`] - r];
          if (lo <= hi) v[c.across] = Math.min(hi, Math.max(lo, v[c.across]));
          if (c.box.y0 + r <= c.box.y1 - r) v.y = Math.min(c.box.y1 - r, Math.max(c.box.y0 + r, v.y));
        }
        pts[k] = Object.assign(at(v), {kitAt: q.at});
        moved.set(k, pts[k].clone().sub(kit[k]));
      });
      // BETWEEN TWO PACKED STOPS the kit's points (a free span's rest, a
      // tray's stretch, a detour) are one line for every member: each is moved
      // by what its two stops were, in proportion along the points between, so
      // the members stay a pack across the span and none of them jumps to a
      // shared line and back.
      const packed = [...moved.keys()].sort((a, b) => a - b);
      for (let n = 0; n + 1 < packed.length; n++) {
        const [i, j] = [packed[n], packed[n + 1]];
        for (let k = i + 1; k < j; k++) {
          if (inner[k].at === 'lead') continue;
          pts[k].add(moved.get(i).clone().lerp(moved.get(j), (k - i) / (j - i)));
        }
      }
    }
    return {points: pts, reach, kit: true, ...(free ? {free: true} : {})};
  };
}

// THE SOLID BODIES OF THE RACK (kit 0.11.0, #949: solids.js solidsOf) as
// world boxes, [{ref, part, box, raw?}]: a box device's envelope, a sheet
// part's plates (a lacer's tray floor), a duct's walls and a PDU, each where
// the kit measures it, and (kit 0.15.0, #968) each part of a ring's solid
// loop, `ring/<id>/<part>`. A ring's part is met by the cable's TUBE, as the
// kit meets it (solids.js legCrossings): its box here is grown by the drawn
// tube's radius, so a centre line strictly inside it is a tube touching the
// part, and `raw` keeps the part itself. So is a zero-U part's (a PDU, a
// duct's walls: kit 0.15.0 meets those with the tube as well). A hanging cable is kept out of them
// (cables.js clearOf), a rounded corner too (bend3d.js clearCurve), and the
// browser check samples every routed tube against them.
export const RING_PART = /^ring\/[^/]+\/./;
export function solidBoxes(THREE, rack, chassisOf, faceZ) {
  if (typeof chassisOf !== 'function') return [];
  const r = WIDTH / 2;
  return solidsOf(rack, {chassisOf}).map(s => {
    const raw = new THREE.Box3(new THREE.Vector3(s.box.x0, s.box.y0, faceZ + s.box.z0),
                               new THREE.Vector3(s.box.x1, s.box.y1, faceZ + s.box.z1));
    return RING_PART.test(String(s.part)) || s.zeroU === true
      ? {ref: s.item, part: s.part, box: raw.clone().expandByScalar(r), raw, grown: r, ...(s.zeroU ? {zeroU: true} : {})}
      : {ref: s.item, part: s.part, box: raw};
  });
}

// THE BUNDLES AS TUBES (portrayal-site#142; design section 6): each drawn
// bundle's trunk as a tube of its diameter (the kit's size check), see-through
// so its members show inside, through the kit's points as its members take
// them (portrayal-site#166): at a ring or a pathway, the points a member's
// path (route.js routePath) gives that waypoint - a ring's approach, entry
// and exit on its sill - and anywhere else the kit's own point for the
// waypoint (route.js pointOf: a lane's run). Each strap is a band round it at
// the kit's position along its trunk segment. Returns {group, bundles: [{id,
// diameter, points, straps: [Vector3]}]}.
const STRAP_BAND = 12;   // mm along the run: a strap as drawn
// The kit's points for one trunk waypoint, in the scene: the first member
// path that tags points with it, else pointOf. [] when neither places it.
// AT A RING WHOSE OPENING THE KIT PLACES (solids.js traysOf: a ring on a
// tray) the members lie on its sill at their own radius, and the trunk is
// wider: it is laid there by the kit's own rule with the trunk's radius `rt`
// - its centre `rt` over the opening's lowest inside edge, across the run
// at the side nearer the rail by `rt` (the middle, when the opening is
// narrower than the trunk) - so it rests on the sill and against the leg as
// the kit lays a cable, never through them (portrayal-site#166 round 2).
function trunkStop(THREE, rack, w, members, paths, ctx, at, rt = 0) {
  let own = [];
  if (!w.lane) for (const id of members) {
    // (not a member's lead point, kit 0.17.0: that is the member's own way
    // to the ring from the stop before it, not a point of the ring's)
    own = (paths?.get(id)?.points ?? []).filter(q => q.item === w.item && q.via === w.via && q.at !== 'lead');
    if (own.length) break;
  }
  if (!own.length) {
    // no member's path names it (yet: a scene hung while the members' routes
    // still follow their own way): the kit's point for the waypoint
    let p = null;
    try { p = ctx ? pointOf(rack, w, ctx) : null; } catch { p = null; }
    own = p ? [p] : [];
  }
  const c = own.length ? stopCentre(rack, w, ctx, rt) : null;
  return c ? own.map(q => at(c.at(q))) : own.map(at);
}
// WHERE A PACK OF RADIUS `rt` IS LAID AT A RING (the rule above), or null where
// the kit places no opening for the waypoint: {at: q => the kit's point q moved
// to the pack's centre, box: the opening, across: the axis across its run}.
// The trunk and its members are laid by this one rule, so the members are
// inside the trunk wherever it is drawn.
export function stopCentre(rack, w, ctx, rt) {
  const open = rt > 0 && !w.lane ? openingOf(rack, w, ctx) : null;
  if (!open) return null;
  const b = open.box, across = open.run === 'x' ? 'z' : 'x';
  const lo = b[`${across}0`], hi = b[`${across}1`];
  const rail = (rack.items.find(i => i.id === w.item)?.face === 'rear')
    ? -(rack.frame.kind === 'two-post' ? 0 : Number(rack.frame.railDepth) || 0) : 0;
  const c = hi - lo <= 2 * rt || across === 'x' ? (lo + hi) / 2
    : Math.abs(lo - rail) <= Math.abs(hi - rail) ? lo + rt : hi - rt;
  return {at: q => ({...q, y: b.y0 + rt, [across]: c}), box: b, across};
}
// BETWEEN TWO TRUNK WAYPOINTS, k and k + 1, the kit lays a cable through
// points of its own: along a tray's floor, over a free span's rest, round a
// body. The members are drawn through them (kitPointsFor), each moved as its
// two stops were, so the trunk goes through them too, moved as ITS two stops
// were from the kit's points there (`pts`: the trunk's centre at each
// waypoint). Taken from the first member whose path runs from one waypoint
// straight to the other; [] when none does, or the kit adds no point there.
function trunkSpan(trunk, k, members, paths, toScene, pts) {
  const RUmm = RU;
  const at = (P, w) => P.map((q, i) => i).filter(i => (w.lane ? P[i].at === 'lane' && Math.abs(P[i].y - (w.ru - 0.5) * RUmm) < 1e-6
    : P[i].item === w.item && P[i].via === w.via && P[i].at !== 'lead'));
  for (const id of members) {
    const P = paths?.get(id)?.points;
    if (!P?.length) continue;
    const a = at(P, trunk[k]), b = at(P, trunk[k + 1]);
    if (!a.length || !b.length) continue;
    let mid, i, j;
    if (Math.max(...a) < Math.min(...b)) { [i, j] = [Math.max(...a), Math.min(...b)]; mid = P.slice(i + 1, j); }
    else if (Math.max(...b) < Math.min(...a)) { [j, i] = [Math.max(...b), Math.min(...a)]; mid = P.slice(j + 1, i).reverse(); }
    else continue;
    // (another stop, or a lead of the member's own, between them: it does not run straight from one to the other)
    if (mid.some(q => q.item || q.at === 'lead' || q.at === 'lane' || q.at === 'reach' || q.end)) continue;
    if (!mid.length) return [];
    const mean = list => list.reduce((s, n) => s.add(toScene(P[n])), toScene({x: 0, y: 0, z: 0}).set(0, 0, 0)).multiplyScalar(1 / list.length);
    const d0 = pts[k].clone().sub(mean(a)), d1 = pts[k + 1].clone().sub(mean(b));
    return mid.map((q, n) => toScene(q).add(d0.clone().lerp(d1, (n + 1) / (mid.length + 1))));
  }
  return [];
}
// The opening of a ring a waypoint names, where the kit places it ({run, box}), or null.
function openingOf(rack, w, ctx) {
  let trays = [];
  try { trays = ctx?.chassisOf ? traysOf(rack, ctx) : []; } catch { trays = []; }
  for (const t of trays) if (t.item === w.item) { const o = t.rings.find(x => x.via === w.via); if (o) return o; }
  return null;
}
// A PART OF A CURVE, from u0 to u1 of its length (0 to 1), as a curve of its own.
function CurvePart(THREE, curve, u0, u1) {
  const part = new THREE.Curve();
  part.getPoint = (t, target) => curve.getPointAt(Math.min(1, Math.max(0, u0 + (u1 - u0) * t)), target);
  return part;
}
// THE ENVELOPE'S PIECES ALONG ONE RUN OF THE TRUNK: [{u0, u1, diameter, riders,
// whole}], `u` along the run's curve. Each stretch of the lay (two nodes next
// to each other with two or more members riding both) is found on the curve by
// the point nearest each node; stretches of one diameter that meet are one
// piece. `whole` when one piece covers the run from end to end: the caller
// then draws the run's own curve. Without a lay, the whole run at `D`.
function envelopePieces(THREE, lay, run, pts, curve, D) {
  if (!lay) return [{u0: 0, u1: 1, diameter: D, riders: null, whole: true}];
  const first = run.from, last = run.from + run.points.length - 1;
  const samples = curve.getSpacedPoints(Math.max(200, Math.ceil(curve.getLength() / 2)));
  const uOf = i => {
    const e = lay.T[i], k = e.seg;
    if (k < first || k > last || (e.t > 0 && k + 1 > last)) return null;
    const p = e.t > 0 ? pts[k].clone().lerp(pts[k + 1], e.t) : pts[k];
    if (k === first && !(e.t > 0)) return 0;
    if (k === last) return 1;
    let best = 0, d = Infinity;
    samples.forEach((q, n) => { const x = q.distanceToSquared(p); if (x < d) { d = x; best = n; } });
    return best / (samples.length - 1);
  };
  const out = [];
  for (const st of lay.stretches) {
    const [u0, u1] = [uOf(st.from), uOf(st.to)];
    if (u0 == null || u1 == null || !(Math.abs(u1 - u0) > 1e-6)) continue;
    const [a, b] = u0 < u1 ? [u0, u1] : [u1, u0], prev = out.at(-1);
    if (prev && Math.abs(prev.diameter - st.diameter) < 1e-6 && Math.abs(prev.u1 - a) < 1e-6) { prev.u1 = b; prev.riders = Math.max(prev.riders, st.members.length); }
    else out.push({u0: a, u1: b, diameter: st.diameter, riders: st.members.length, whole: false});
  }
  if (out.length === 1 && out[0].u0 === 0 && out[0].u1 === 1) out[0].whole = true;
  return out;
}
// The bodies a trunk of radius `rt` is kept out of: a ring's part and a
// zero-U part met by the trunk's tube (grown by its radius), the rest as they are.
const trunkInside = (boxes, rt) => insideOf((boxes ?? []).map(b => (b.raw ? {...b, box: b.raw.clone().expandByScalar(rt)} : b)));
async function hangBundles(scene, rack, facts, boxes = null) {
  const {THREE, scene: world} = scene.three;
  const toScene = inScene(THREE, scene.metrics().faceZ);
  const group = new THREE.Group(); group.name = 'cable-bundles';
  const out = [], drawnTight = [];
  for (const f of facts.bundles.values()) {
    const L = f.check?.layout;
    if (!f.drawn || !L?.trunk?.length) continue;
    // one point per trunk waypoint (the middle of its stop), for the straps
    // and the bend marks; the tube runs through every point of each stop
    // THE PACK IS AS THICK AS THE MEMBERS THERE (bundle-view.js trunkLay): at
    // each trunk waypoint the trunk is laid at the diameter of the members
    // present, so it rests on a ring's sill at its own size there.
    const D = drawnDiameter(f.diameter, WIDTH), lay = f.lay ?? null;
    const sizeAt = w => lay?.at(lay.indexOf(w))?.diameter ?? D;
    const stops = L.trunk.map(w => trunkStop(THREE, rack, w, f.members ?? [], facts.paths, facts.ctx, toScene, sizeAt(w) / 2));
    const pts = stops.map(q => (q.length ? q.reduce((a, b) => a.add(b), new THREE.Vector3()).multiplyScalar(1 / q.length) : null));
    const inside = trunkInside(boxes, D / 2);
    const g = new THREE.Group(); g.name = `bundle-${f.id}`;
    g.userData.bundle = f.id; g.userData.members = [...(f.members ?? [])];
    const jacket = new THREE.MeshStandardMaterial({color: 0x8b939c, roughness: 0.7, transparent: true, opacity: 0.45,
                                                   depthWrite: false});
    // a strap in the stage's own strap colour (stage.js strapPaint): black on a
    // light stage, a light neutral on a dark one, where black is not seen
    const strapMat = new THREE.MeshStandardMaterial({color: new THREE.Color(strapPaint(facts.stage ?? '#101214').core), roughness: 0.8});
    strapMat.userData.strap = true;
    // THE TRUNK'S CORNERS AT THE BUNDLE'S RADIUS (portrayal-site#164): the
    // kit's bundle radius (bundleCheck `bend.radius_mm`, its largest member's)
    // rounds each corner by a true arc (bend3d.js); with none known the
    // corners are eased as before.
    const R = f.check?.bend?.radius_mm > 0 ? f.check.bend.radius_mm : null;
    const runs = [];
    for (const run of drawableRuns(pts)) {
      // through every point of each stop, and between two stops the points the
      // kit lays a member through there (trunkSpan), so the trunk lies on a
      // tray as its members do
      const path = run.points.flatMap((_, k) => [...stops[run.from + k],
        ...(k + 1 < run.points.length ? trunkSpan(L.trunk, run.from + k, f.members ?? [], facts.paths, toScene, pts) : [])]);
      let curve;
      if (R != null) curve = clearCurve(THREE, path, R, inside);
      else {
        const smooth = [path[0]];
        for (let k = 1; k < path.length - 1; k++) {
          const [p, q, s] = [path[k - 1], path[k], path[k + 1]];
          const ease = (from, to) => { const d = to.distanceTo(from); return to.clone().lerp(from, Math.min(30, d / 2) / (d || 1)); };
          smooth.push(ease(p, q), q.clone(), ease(s, q));
        }
        smooth.push(path.at(-1));
        curve = new THREE.CatmullRomCurve3(smooth, false, 'centripetal');
      }
      runs.push(curve);
      // THE ENVELOPE: the bundle's diameter as a see-through tube along this
      // run, in pieces, each as thick as the members that ride it (the lay's
      // stretches; neighbours of one size are one piece), so it thins as
      // cables peel off. NOT SHOWN until the bundle or one of its members is
      // hovered or selected (hover.js paintEnvelopes3d), and a hidden mesh is
      // left out of a GLB or USDZ (share.js). A bundle with one size along the
      // whole run is one tube on the run's own curve, as it always was.
      for (const piece of envelopePieces(THREE, lay, run, pts, curve, D)) {
        const path = piece.whole ? curve : new CurvePart(THREE, curve, piece.u0, piece.u1);
        const len = piece.whole ? curve.getLength() : curve.getLength() * (piece.u1 - piece.u0);
        const tube = new THREE.Mesh(new THREE.TubeGeometry(path,
          R != null || !piece.whole ? Math.max(piece.whole ? 40 : 4, Math.ceil(len / 3)) : Math.max(40, curve.points.length * 12), piece.diameter / 2, 16, false), jacket);
        tube.name = `bundle-${f.id}-trunk`;
        tube.renderOrder = 1;
        tube.userData.envelope = {bundle: f.id, diameter: piece.diameter, riders: piece.riders};
        tube.visible = false;
        g.add(tube);
      }
    }
    const at = [];
    const vec = pts.map(p => (p ? [p.x, p.y, p.z] : null));
    // ON THE TUBE AS IT IS DRAWN. The kit places a strap along the straight
    // trunk; the tube rounds its corners by the bundle's bend radius, and a
    // strap near one (a breakout strap stands 25 mm from where a cable
    // leaves, which is often at a corner) would hang off the tube. Each band
    // is stood at the nearest point of the drawn run, along its tangent there.
    const drawn = runs.flatMap(curve => { const n = Math.max(40, Math.ceil(curve.getLength() / 2));
      return Array.from({length: n + 1}, (_, i) => ({p: curve.getPointAt(i / n), t: curve.getTangentAt(i / n)})); });
    const onTube = at => { const q = new THREE.Vector3(...at); let best = null, d2 = Infinity;
      for (const x of drawn) { const d = x.p.distanceToSquared(q); if (d < d2) { d2 = d; best = x; } }
      return best && d2 < 60 * 60 ? best : null; };
    (f.straps?.straps ?? []).forEach((s, k) => {
      const hit = strapAt(vec, s);
      if (!hit) return;
      const snap = onTube(hit.at);
      if (snap) { hit.at = [snap.p.x, snap.p.y, snap.p.z]; hit.dir = [snap.t.x, snap.t.y, snap.t.z]; }
      // a band round the pack, at the pack's diameter where the strap is
      const Ds = lay?.stretchAt(s)?.stretch.diameter ?? D;
      // as wide along the run as its own width asks (kit 0.22.0 `width_mm`; a 19 mm strap is the band it always was)
      const band = new THREE.Mesh(new THREE.CylinderGeometry(Ds / 2 + 1.5, Ds / 2 + 1.5, STRAP_BAND * strapDrawn(s) / STRAP_DRAWN, 20, 1, false), strapMat);
      band.position.set(...hit.at);
      band.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...hit.dir));
      band.name = `bundle-${f.id}-strap-${k}`;
      band.userData.strap = {bundle: f.id, along_mm: s.along_mm, diameter: Ds, kind: s.kind ?? 'spacing', width_mm: s.width_mm ?? null};
      g.add(band);
      at.push(band.position.clone());
    });
    // A corner too tight for its bend radius (kit 0.8.0, Portrayal #922): a
    // warning ring round the tube there.
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
    // A trunk corner drawn tighter than the bundle's radius, in the kit's words.
    const name = f.name ?? f.id;
    for (const curve of runs) for (const c of (curve.corners ?? []).filter(c => c.short_mm > 0)) {
      // the member that sets the radius, or the bundle itself when the kit names none
      const by = f.check.bend.by ?? null, cable = by ? (rack.cables || []).find(x => x.id === by) : null;
      const kind = cable?.type || cable?.media, who = !by ? name : kind ? `${by} (${kind})` : by;
      drawnTight.push({bundle: f.id, drawn_mm: c.drawn_mm, need_mm: c.need_mm, why: c.why, t: c.t, room_t: c.room_t, hitRef: c.hitRef ?? null, hit: c.hit ? [c.hit.x, c.hit.y, c.hit.z] : null,
        text: tightText(`${name} in 3D`, who, cornerWhere(rack, {from: [], to: []}, [], c, scene.metrics().faceZ), c)});
    }
    group.add(g);
    out.push({id: f.id, diameter: D, points: pts.filter(Boolean), straps: at, tight, radius_mm: R, curves: runs});
  }
  // THE TIE STRAPS OF SINGLE CABLES (kit 0.22.0; route-context.js tieStraps): a
  // band at the tray's tie slot round the cables lying there, its axis along
  // their run, on the face of the plate they are on. Named by its slot, with
  // the cables it ties, so it is lit and dimmed with them (hover.js).
  // (a group of their own beside the bundles', 'tie-straps': a tie strap is no bundle, has no envelope and takes no pointer)
  const ties = [], tieGroup = new THREE.Group();
  tieGroup.name = 'tie-straps';
  if (facts.tieStraps?.length) {
    facts.tieStraps.forEach(m => {
      // a group and a material of its own, as a bundle has: hover.js dims a group's materials
      const slot = `${m.item}|${m.via}|${m.tie}`;
      const tg = new THREE.Group();
      tg.name = `tie-${slot}`;
      tg.userData.tie = slot; tg.userData.members = [...m.cables];
      const mat = new THREE.MeshStandardMaterial({color: new THREE.Color(strapPaint(facts.stage ?? '#101214').core), roughness: 0.8});
      mat.userData.strap = true;
      const band = new THREE.Mesh(new THREE.CylinderGeometry(TIE_HALF, TIE_HALF, STRAP_BAND * strapDrawn(m) / STRAP_DRAWN, 16, 1, false), mat);
      band.position.copy(toScene(tieCentre(m)));
      band.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), m.run === 'z' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0));
      band.name = `tie-strap-${slot}`;
      band.userData.strap = {tie: slot, cables: [...m.cables], kind: 'anchor', width_mm: m.width_mm, held: m.held};
      tg.add(band);
      tieGroup.add(tg);
      ties.push(band);
    });
  }
  world.add(group);
  if (ties.length) world.add(tieGroup);
  return {group, bundles: out, tight: drawnTight, ties, tieGroup: ties.length ? tieGroup : null};
}

// THE STRAPS TURN WITH THE STAGE, as the rail labels do: every strap band's
// material takes the stage's strap colour (a dimmed one keeps its dimming:
// only the colour is set).
function paintStraps3d(scene, stage) {
  const color = strapPaint(stage).core;
  // (a bundle's straps, and the tie straps of single cables in their own group)
  for (const name of ['cable-bundles', 'tie-straps'])
    scene?.three?.scene?.getObjectByName?.(name)?.traverse(o => { if (o.isMesh && o.userData.strap) o.material.color.set(color); });
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

// A drawn corner's place in words: the lead out of an end, or its height and
// depth in the rack.
function cornerWhere(rack, link, pts, c, faceZ) {
  const near = (q, k) => q && c.at.distanceTo(q) < 1e-3 && k;
  const label = id => rack.items.find(i => i.id === id)?.label ?? zeroUOf(rack).find(z => z.id === id)?.label ?? id;
  const end = near(pts[1], 'from') || near(pts[pts.length - 2], 'to');
  if (end) { const [item, path] = link[end]; return `where it leaves ${label(item)} ${path}`; }
  const ru = Math.max(1, Math.floor(c.at.y / RU) + 1), dz = Math.round(c.at.z - faceZ);
  return `at U${ru}, ${Math.abs(dz)} mm ${dz >= 0 ? 'in front of' : 'behind'} the front rails`;
}

// A WARNING RING ROUND EACH CORNER SHORT OF ITS CABLE'S BEND RADIUS (kit
// 0.17.0, Portrayal #973). The corners are the kit's findings, each at the
// kit's own point (`at`, rack mm: the scene's (x, y, faceZ + z)); nothing is
// measured here. A ring goes in its cable's group, so it dims and lights with
// the cable, and carries `userData.bendFinding` (the kit's sentence, and
// where): a GLB or USDZ is written with these rings hidden (hover.js
// withoutBendRings).
// Returns [{cable, at: Vector3, text}], one per ring drawn.
export const BEND_RING = 0xd9822b;
function ringBends(scene, drawn, bends) {
  const {THREE} = scene.three, at = inScene(THREE, scene.metrics().faceZ), out = [];
  const count = new Map();
  for (const f of bends ?? []) {
    const tube = (drawn.tubes || []).find(t => t.link.id === f.cable && t.mesh);
    if (!tube) continue;
    // a pair of turns is one finding with a ring at each corner (bendPoints)
    for (const here of bendPoints(f)) {
      const k = count.get(f.cable) ?? 0; count.set(f.cable, k + 1);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(WIDTH / 2 + 6, 1, 8, 24), new THREE.MeshBasicMaterial({color: BEND_RING}));
      ring.position.copy(at({x: here[0], y: here[1], z: here[2]}));
      ring.name = `cable-${f.cable}-bend-${k}`;
      ring.userData.bendFinding = {cable: f.cable, text: f.text, at: [...here]};
      tube.mesh.add(ring);
      out.push({cable: f.cable, at: ring.position.clone(), text: f.text});
    }
  }
  return out;
}
// Returns drawCables3d's {tubes, anchors, boxes, group} plus `checked` and the
// `facts` the cables were hung by (an export's notes read those, so they
// describe this scene and not a later reading), or {failed: true} when the
// cables could not be drawn: the rack still stands, and an export of it says so.
// `tight` lists every corner drawn tighter than its radius, as sentences:
// the drawing's own account of its arcs, kept in the scene and said nowhere.
// `bends` are the kit's tight bends (route.js bendFindings, through
// route-context.js): each is ringed where the kit puts it (ringBends), and
// `bendRings` lists the rings drawn.
// A STORED LOOP OF SPARE (kit 0.35.0, Portrayal #1065; spare-loops.js): two
// turns of a ring at the kit's point (slack.js spareMarks), long along the
// duct it lies in and facing out of it: a duct across the rack or up it is
// seen face on from the front, one in depth from the side. Named by its
// place, with its cable, so it is lit and dimmed with it (hover.js).
// {group, loops: [mesh]}, or null for none.
function hangLoops(scene, rack, list) {
  if (!list.length) return null;
  const {THREE} = scene.three, toScene = inScene(THREE, scene.metrics().faceZ);
  const group = new THREE.Group();
  group.name = 'spare-loops';
  const nameOf = id => rack.items.find(i => i.id === id)?.label ?? (rack.zeroU || []).find(z => z.id === id)?.label ?? id;
  const out = [];
  for (const l of list) {
    const mat = new THREE.MeshStandardMaterial({color: new THREE.Color(LOOP_PAINT.core), roughness: 0.6});
    const g = new THREE.Group();
    g.name = `spare-${l.cable}|${l.item}|${l.via}`;
    g.userData.members = [l.cable];
    const k = loopScale(l.metres);   // the longer the spare, the larger the loop (spare-loops.js)
    for (const s of [-1, 1]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(LOOP_SHORT * k, 1.6, 8, 32), mat);
      // long along its run: x for a duct across the rack, y up it, z in depth
      // (a torus lies across its own z: turned a quarter about y, its own x runs in the rack's depth)
      const along = l.run === 'y' ? 'y' : l.run === 'z' ? 'z' : 'x';
      if (along === 'z') { ring.rotation.y = Math.PI / 2; ring.scale.x = LOOP_LONG / LOOP_SHORT; }
      else ring.scale[along] = LOOP_LONG / LOOP_SHORT;
      const p = toScene(l.at);
      p[along] += s * 2.5;
      ring.position.copy(p);
      g.add(ring);
    }
    g.userData.spare = {cable: l.cable, item: l.item, via: l.via, metres: l.metres, run: l.run, text: loopTitle(l, nameOf)};
    group.add(g);
    out.push(g);
  }
  scene.three.scene.add(group);
  return {group, loops: out};
}

async function hangCables(scene, rack, facts, routes, chassisOf = null, paths = null, bundles = null, bendOf = null, ctx = null, bends = null, stage = null, spares = null) {
  const loose = new Set([...facts.ends].filter(([, v]) => v.reason != null).map(([k]) => k));
  const {THREE} = scene.three, faceZ = scene.metrics().faceZ;
  try {
    // The bodies are the kit's (solidsOf), not the scene's meshes: a sheet
    // part's plates are solid as well, and a ring's parts (kit 0.15.0), and a
    // hang or a rounded corner is kept out of them.
    const boxes = solidBoxes(THREE, rack, chassisOf, faceZ);
    const drawn = await drawCables3d(scene, cablePlan3d(rack), {boxes, widthOf: widthLookup(ctx?.diameterOf, rack.cables), anchor: async (item, path, view) => {
      if (loose.has(endKey({item, path, view}))) return [];
      const got = await scene.cableAnchor({id: item}, path, {view});
      if (got.length) return got;
      const port = await scene.portAnchor({id: item}, path, {view});
      return port ? [{position: port.position, normal: port.normal, view, path}] : [];
    }, waypoints: kitPointsFor(THREE, faceZ, paths, routes, bundles?.places ?? null, bundles?.bundles ?? null, rack, ctx), bendOf: radiusOf(rack, bendOf, bundles),
      // the page is handed back every 30 ms while the tubes are made, and they stand as they are hung (cables.js `slice`)
      slice: 30});
    // Each corner drawn tighter than its radius, in the kit's bend-check words.
    const byId = new Map((rack.cables || []).map(c => [c.id, c]));
    drawn.tight = (drawn.tubes || []).flatMap(t => (t.tight ?? []).map(c => {
      const cable = byId.get(t.link.id), kind = cable?.type || cable?.media;
      // a lead out of a port: which end, and that end's device
      const end = [t.points[1], t.points[t.points.length - 2]].findIndex(q => q && c.at.distanceTo(q) < 1e-3);
      // (the corner out of a plug: drawn there only where the lead runs out of it, kitRoute)
      const lead = end >= 0 && (t.bend.extended_mm?.[end] ?? 1) > 0, leadItem = lead ? (end === 0 ? t.link.from : t.link.to)[0] : null;
      return {cable: t.link.id, drawn_mm: c.drawn_mm, need_mm: c.need_mm, why: c.why, lead, leadItem, t: c.t, room_t: c.room_t,
              at: [c.at.x, c.at.y, c.at.z - faceZ],
              extended_mm: lead ? t.bend.extended_mm?.[end] ?? 0 : 0, radius_mm: t.bend.radius_mm,
              hit: c.hit ? [c.hit.x, c.hit.y, c.hit.z] : null, hitRef: c.hitRef ?? null,
              text: tightText(`${t.link.id} in 3D`, kind ? `${t.link.id} (${kind})` : t.link.id, cornerWhere(rack, t.link, t.points, c, faceZ), c)};
    }));
    // The bundles over the cables they hold; one failing costs only the bundles.
    let hung = null;
    // (and the tie straps of single cables, for a cable plugged in at both ends, as the panes draw them)
    const landedId = id => { const c = (rack.cables || []).find(x => x.id === id); return !!c && !loose.has(endKey(c.a)) && !loose.has(endKey(c.b)); };
    const tieStraps = (bundles?.tieStraps ?? []).filter(m => m.cables.some(landedId));
    if (bundles?.bundles?.size || tieStraps.length) {
      try { hung = await hangBundles(scene, rack, {...bundles, tieStraps, routes, paths, ctx, stage: scene.stageColor ?? stage}, drawn.boxes);
        drawn.tight.push(...hung.tight); }
      catch (err) { console.warn('[portrayal] the bundles could not be drawn in 3D', err); }
    }
    // THE STORED LOOPS (kit 0.35.0; spare-loops.js), for a cable plugged in at both ends, as the panes draw them
    let loops = null;
    try { loops = hangLoops(scene, rack, (spares ?? []).filter(l => landedId(l.cable))); }
    catch (err) { console.warn('[portrayal] the stored spare could not be drawn in 3D', err); }
    // (only for a cable plugged in at both ends, as on the panes: route-context.js landedBends)
    return {...drawn, checked: !facts.unchecked, facts, bundles: hung, loops,
            bendRings: ringBends(scene, drawn, landedBends(bends, rack, e => loose.has(endKey(e))))};
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
// `paths` is routeFacts' cable id -> routePath (the kit's points), and `ctx`
// its route context (a bundle's lane stops are the kit's pointOf), or null.
// `covers` is the reader's setting for the covers of the parts beside the rack
// (covers.js: 'on', 'see' or 'off'); the page changes it on a built scene with
// covers.js paintCovers3d. `onScene(scene)` is told the scene the moment it
// exists, before anything is built in it (a probe watches it load).
// `onDetailFailed({id, label})` is told of a sheet part whose detail could not
// be built: it stays a plain box, and the page says so.
// `bendOf` is the cable types' cable => installed bend radius in mm (the kit's
// cable-types.js bendLookup), or null: the tubes' corners are rounded to it.
// `bends` are the kit's tight bends for this rack (routeFacts' bendFindings),
// or null: each is ringed where the kit puts it.
export async function mountRack3d(container, {rack, chassisOf, camera = null, failFacts = false, routes = null, paths = null,
                                              ctx = null, bundles = null, bendOf = null, bends = null, spares = null, stage = '#101214',
                                              covers = COVERS_DEFAULT, onScene = null, onDetailFailed = null}) {
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
  // Optic fields (item.fields: a latch colour, a label) are carried over, and
  // the scene paints them into the device's own faces (rack3d.js overrideFaces),
  // so a field edit shows in 3D as it does in 2D (portrayal-site#206).
  const stack = rack.items.map(item => ({
    id: item.id,
    ref: item.ref, cfg: item.cfg, ru: item.ru, label: item.label, fields: item.fields || {},
    face: item.face, turned: item.turned, overrides: mergeSeats(item.swaps, facts.seats[item.id]),
    chassis: chassisOf?.(item.ref) || undefined,
    mount: chassisOf?.(item.ref)?.mount,
    // how far its faceplate stands behind its rail, and its roll, which sets the span it fills (rack file version 4: the kit's setbackOf, itemBox)
    ...(chassisOf?.(item.ref) ? {setback: setbackOf(rack, item, chassisOf)} : {}), ...(item.roll ? {roll: item.roll} : {}),
  }));
  // ZERO-U PARTS stand beside an upright (the kit's zero-u.js): built as any device is,
  // then stood in place once built (placeZeroU). A four-post's rear upright
  // carries its part facing rearward, as a rear device faces.
  const sideParts = chassisOf ? zeroUOf(rack).filter(z => isZeroUPart(chassisOf(z.ref))) : [];
  for (const z of sideParts) {
    stack.push({id: z.id, ref: z.ref, cfg: z.cfg, ru: zeroUBottom(z), mm: zeroUBottomMm(z), label: z.label,
                // (the plug at each cabled outlet, paired with the cord's other end: cable-plugs.js zeroUFacts)
                face: faceOfAt(z.at) === 'rear' ? 'rear' : 'front', turned: false, overrides: mergeSeats({}, facts.seats[z.id]),
                chassis: chassisOf(z.ref), mount: 'rack-side'});
  }

  // Imported here, not at module load: rack-page.js pulls this module in on
  // every visit, most of which never switch to 3D, and three.js (through
  // rack3d.js) is not a cost a 2D-only visit should pay - the showcase's own
  // mount3d (site/showcase/rack.js) makes the same choice for the same
  // reason.
  // WHICH PARTS OF EACH PART ARE ITS COVER (covers.js), read
  // off its drawings before anything is built, so a cover takes the reader's
  // setting in the task its meshes arrive in (onFace, below).
  // (every part the library marks one on: a part beside the rack, and a rack-mounted duct with a cover as well)
  const coverPaths = new Map(await Promise.all([...rack.items, ...sideParts].map(async z => [z.id, await coverPathsOf(z.ref, z.cfg)])));
  const {guard3d} = await import('../webgl.js');
  const scene = await guard3d(async () => {
    const {createRackScene} = await import('../rack3d.js');
    // THE KIT'S FRAME (portrayal-site#166): a rack device's panel is on its
    // rail plane, as route.js portPoint and solids.js place it, so the plugs
    // the scene draws end where the kit's reach points are and the devices
    // stand where their solid envelopes are. rack3d.js's own default sets a
    // faceplate 30 mm behind the rails, which put every drawn plug 30 mm
    // behind the path it starts.
    const built = createRackScene(container, {
      stack, heightRU: frame.heightRU, recess: 0, unitLabel: u => uLabel(frame, u),
      frame: frame.kind === 'four-post' ? {kind: 'four-post', railDepth: frame.railDepth} : null,
      background: stage, ...labelsFor(stage),
      onFace: ({id, meshes}) => takeCovers(built, meshes, coverPaths.get(id)),
      // NOTHING FLOATS WHILE THE SCENE LOADS (#190). A sheet part (a vertical
      // manager, a lacer) is all detail, and its detail is built after the
      // cables are hung: it stands as a plain box of its size until then
      // (rack3d.js standIn). And a part beside the rack, or on one rail, is
      // stood in its place as it is mounted, not once the whole stack is
      // built, so its box is never drawn at the middle of the rack first.
      standIn: true,
      // A FRAME AT MOST EVERY 400 MS WHILE THE DETAIL IS BEING BUILT and nobody is handling the view (rack3d.js
      // `buildFrameMs`, portrayal-site#192): a rack in detail is tens of thousands of draw calls a frame, and
      // drawing one at every animation frame while the build was still adding to it took a quarter of the build's
      // time on a fast GPU and nearly all of it without one.
      buildFrameMs: 400,
      onDetailFailed: f => onDetailFailed?.(f),
      onMount: ({id}) => { placeZeroU(built, sideParts.filter(z => z.id === id), chassisOf); placeSided(built, rack.items.filter(i => i.id === id), chassisOf); },
    });
    onScene?.(built);
    built.stageColor = stage;
    built.covers = covers;
    built.setStage = c => { built.stageColor = c; built.setBackground(c); built.setLabelColors(labelsFor(c)); paintStraps3d(built, c); };
    await built.build();
    placeZeroU(built, sideParts, chassisOf);
    placeSided(built, rack.items, chassisOf);
    // What the scene holds of the cables, for the page and the exports: null
    // for a rack with none (nothing is added to the scene at all).
    built.rackCables = cabled ? await hangCables(built, rack, facts, routes, chassisOf, paths, bundles, bendOf, ctx, bends, stage, spares) : null;
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
