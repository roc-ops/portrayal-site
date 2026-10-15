// CABLE BUNDLES ON THE PAGE (portrayal-site#142; Portrayal
// docs/cable-bundles-design.md sections 6 and 7). The kit (vendor/rack/
// bundles.js, since 0.7.0) owns the bundle: its trunk, which members ride it and
// where each joins and leaves, its size check and where its straps go. This
// module reads those once per render (bundleFacts, from route-context.js
// routeFacts) and turns them into what the views draw and the list says:
//   - each member's stretch along the trunk, so 2D and 3D comb the members
//     inside the bundle there and leave them free outside it;
//   - the trunk's ring marks, taken from a member that rides through each ring
//     (the kit's decision, route.js ringMarks), turned to the trunk's own
//     direction, so the band passes a ring the way its cables do;
//   - a strap's place on a view's own drawing of a trunk segment;
//   - the lines the cable list and the sheet's notes give a bundle.
// Pure: no DOM and no three.js here (cable-view.js and scene3d.js draw).

import {bundlesOf, bundleName, bundleCheck, straps as strapsOf, strapSpacing, spacingText, membersText,
        waypointText, onTrunk, bundleDiameter} from '../../vendor/rack/bundles.js';
import {waypointKey} from '../../vendor/rack/bundle-route.js';
import {pointOf, DIAMETERS} from '../../vendor/rack/route.js';
import {RU} from '../../vendor/rack/rails.js';

// A strap as drawn, along the run (mm). The kit keeps straps STRAP_W (20 mm)
// off rings; a strap drawn half that wide reads as a strap, not a block.
export const STRAP_DRAWN = 10;
// EACH STRAP HAS ITS OWN WIDTH (kit 0.22.0: `width_mm`, one of 12, 19 and 25).
// It is drawn in proportion: the common 19 mm strap is the bar it always was
// (STRAP_DRAWN), and a 12 or a 25 mm one is narrower or wider beside it.
export const STRAP_COMMON_MM = 19;
export const strapDrawn = s => (Number(s?.width_mm) > 0 ? STRAP_DRAWN * Number(s.width_mm) / STRAP_COMMON_MM : STRAP_DRAWN);
// A TIE STRAP OF A SINGLE CABLE (kit 0.22.0, bundles.js anchorsOf): a band at
// a tray's tie slot, round the cables lying there. How far it reaches each
// side of them as drawn, mm.
export const TIE_HALF = 5;
/** A tie strap's mark for one tie slot (route-context.js tieStraps): `slot` is
 *  the kit's anchor ({item, via, tie, width_mm, cables}), `tray` its tray
 *  (solids.js traysOf: `top` and `under`, the heights of the plate's two
 *  faces, `run`, and `ties`, plan rectangles), `rest` how the first of its
 *  cables lies there (the path's `rests` entry: `role` held or resting). `at`
 *  is on the FACE OF THE PLATE THE CABLES ARE ON: its underside for a cable
 *  held under it, its top for one resting on it. Null without the slot. */
export function tieMark(slot, tray, rest) {
  const r = tray?.ties?.[slot.tie];
  if (!r) return null;
  const held = rest?.role === 'held';
  return {item: slot.item, via: slot.via, tie: slot.tie, width_mm: slot.width_mm, cables: [...slot.cables], run: tray.run, held,
          at: {x: (r.x0 + r.x1) / 2, y: held ? tray.under : tray.top, z: (r.z0 + r.z1) / 2}};
}
/** The middle of a tie strap's band as drawn, in rack mm: off the plate's
 *  face by half the band, on the side the cables are (below the underside for
 *  a held cable, above the top for a resting one). One answer for the panes,
 *  the side panes and the 3D scene. */
export const tieCentre = m => ({x: m.at.x, y: m.at.y + (m.held ? -TIE_HALF : TIE_HALF), z: m.at.z});

// THE STRAPS OF A BUNDLE IN WORDS, by kind, as the kit counts them
// (straps().kinds): "9 straps (2 every 12 in, 7 where a cable leaves)". A
// count is never said to be "every 12 in" unless it is the spacing straps
// alone. Null when it has none.
export function strapsText(st, every) {
  const k = st?.kinds ?? {spacing: st?.count ?? 0, breakout: 0, anchor: 0}, n = st?.count ?? 0;
  if (!n) return null;
  const parts = [k.spacing ? `${k.spacing}${every ? ` every ${every.value} ${every.unit}` : ' along it'}` : null,
                 k.breakout ? `${k.breakout} where a cable leaves` : null,
                 k.anchor ? `${k.anchor} at ${k.anchor === 1 ? 'a tray tie slot' : 'tray tie slots'}` : null].filter(Boolean);
  const head = `${n} strap${n === 1 ? '' : 's'}`;
  return parts.length === 1 && k.spacing === n && every ? `${head} every ${every.value} ${every.unit}` : `${head} (${parts.join(', ')})`;
}

// EVERY BUNDLE, AS THE VIEWS AND THE LIST READ IT, from the kit with the
// routing context of this render (`ctx`: {route, diameterOf?, bendOf?}).
// Map(id -> {id, name, members: [cable ids], drawn, every, check, straps, diameter}):
// `every` the strap spacing ({value, unit}, or null for none);
// `drawn` is the kit's rule (two or more members: route.js drawnBundleOf);
// `check` is bundleCheck's whole answer (size, bend, warnings, notes, the
// layout of the trunk); `straps` is straps' ({every, count, straps, runs}, or
// null when the routes are not known); `diameter` is the size check's
// largest, in mm, or null.
export function bundleFacts(rack, ctx = {}) {
  const out = new Map();
  for (const b of bundlesOf(rack)) {
    const check = bundleCheck(rack, b, ctx);
    let st = null;
    try { st = ctx.route ? strapsOf(rack, b, ctx) : null; } catch { st = null; }
    out.set(b.id, {id: b.id, name: bundleName(b), members: b.members.map(m => m.cable), drawn: b.members.length >= 2,
                   every: strapSpacing(b), check, straps: st, diameter: check.size?.max_mm > 0 ? check.size.max_mm : null});
  }
  return out;
}

// WHERE A MEMBER RIDES ITS BUNDLE, as indices into its resolved waypoints
// (route.js resolveRoute, which names its `join` and `leave`): [i, j], the
// first waypoint at its join point and the last at its leave point. null for
// a cable in no drawn bundle. When the join or leave point is not a waypoint
// of its own (a lane U its route passes straight through), the stretch is
// the waypoints on the stored trunk.
export function memberStretch(route, bundle) {
  if (!route?.bundle || !route.waypoints?.length) return null;
  const ws = route.waypoints, key = w => waypointKey(w);
  const jk = route.join && key(route.join), lk = route.leave && key(route.leave);
  let i = jk ? ws.findIndex(w => key(w) === jk) : -1;
  let j = -1;
  if (lk) for (let n = ws.length - 1; n >= Math.max(0, i); n--) if (key(ws[n]) === lk) { j = n; break; }
  if (i < 0 || j < 0) {
    const on = ws.map((w, n) => (bundle && onTrunk(bundle, w) ? n : -1)).filter(n => n >= 0);
    if (!on.length) return null;
    if (i < 0) i = on[0];
    if (j < 0) j = on.at(-1);
  }
  return i <= j ? [i, j] : null;
}

// EACH MEMBER'S PLACE IN ITS BUNDLE: Map(cable id -> {bundle, index, n,
// diameter, stretch}), for the members of drawn bundles whose route rides
// the trunk. `routes` is routeFacts' Map(cable id -> resolveRoute result).
export function memberPlaces(rack, routes, bundles) {
  const out = new Map();
  for (const b of bundlesOf(rack)) {
    const f = bundles?.get(b.id);
    if (!f?.drawn) continue;
    b.members.forEach((m, index) => {
      const stretch = memberStretch(routes?.get(m.cable), b);
      if (stretch) out.set(m.cable, {bundle: b.id, index, n: b.members.length, diameter: f.diameter, stretch});
    });
  }
  return out;
}

// HOW WIDE A BUNDLE IS DRAWN (mm), in 2D and 3D alike: the kit's diameter,
// never less than two cables' width (a bundle not yet measured, or a thin one).
// Every view and the members' packing use this one figure.
export const drawnDiameter = (diameter, width) => Math.max(diameter ?? 0, width * 2);

// WHERE A MEMBER SITS IN ITS BUNDLE'S CROSS-SECTION (3D), [across, across]
// from the bundle's centre (mm): the members on a sunflower (golden-angle
// spiral) in the circle the bundle's diameter leaves for a cable's centre,
// so each is inside the tube, on the diagonals too and past any count. In a
// thin bundle the tubes overlap a little: the kit packs at 0.8 of the circle,
// tighter than round tubes can sit, so that is the geometry, not a fault.
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
export function packOffset(place, width) {
  if (!place || place.n < 2) return [0, 0];
  const R = Math.max(0, (drawnDiameter(place.diameter, width) - width) / 2);
  const r = R * Math.sqrt((place.index + 0.5) / place.n), a = place.index * GOLDEN;
  return [r * Math.cos(a), r * Math.sin(a)];
}

// ── the lay of a bundle along its trunk ──────────────────────────────────
// A BUNDLE IS AS THICK AS THE CABLES IN IT AT EACH PLACE. The kit's layout
// (bundles.js layoutOf) cuts the trunk into elements (`T`: a pathway, a lane
// node at each U, a lane segment between two) and says where each member joins
// and leaves (`ji`, `li`, indices into `T`). The size check reports the largest
// diameter; the drawing needs the diameter everywhere, and where each member
// lies in it, so the pack thins as cables peel off and no peel crosses the
// cables that go on. trunkLay works that out once, in the rack's own frame
// (x right as seen from the front, y up, z out), for both views:
//
//   - WHO IS THERE. At each element, the members whose ride covers it.
//   - HOW THICK. The kit's own rule (bundles.js bundleDiameter) over the
//     diameters of the members there, never under two drawn widths.
//   - IN WHAT ORDER. One order for the whole trunk, across the run as seen
//     from the front (`a`, to the left of the direction the trunk runs): a
//     member that leaves at a point the others ride on past sits on the side
//     it leaves toward, and the sooner it leaves the further out, so it
//     peels off the outside of the pack.
//   - WHERE, IN 2D. Side by side in that order at one pitch for the whole
//     trunk (the largest pack's: its members just fill its diameter), each in
//     its own place while the members there are neighbours, so a member runs
//     straight while others join and leave beside it; where a member between
//     two others has gone the rest close up about their middle. On a lane the
//     offset is across the lane (x); at a ring or a tray the members stand on
//     the floor, the lowest where the kit rests a cable (y).
//   - WHERE, IN 3D. Packed in the circle of the diameter there (packOffset's
//     sunflower), in the same order across the run.
//
// `paths` is routeFacts' cable id -> routePath (the kit's points), `ctx` its
// route context, `diameterOf` the cable types' lookup (or none: the kit's
// figure for the media is taken, as its size check takes it). Nothing here
// changes a length, a route or a check: it is where the drawing puts what the
// kit measured. Returns null for a bundle that is not drawn or has no trunk.
const unit = (v, k) => (k === 'x' ? {x: v, y: 0} : {x: 0, y: v});
export function trunkLay(rack, fact, {paths = null, ctx = null, diameterOf = null, width = 3} = {}) {
  const L = fact?.check?.layout, T = L?.T ?? [];
  if (!fact?.drawn || !T.length) return null;
  const byId = new Map((rack.cables || []).map(c => [c.id, c]));
  const dOf = id => {
    const c = byId.get(id);
    let d = null;
    try { d = typeof diameterOf === 'function' ? diameterOf(c) : null; } catch { d = null; }
    return typeof d === 'number' && d > 0 ? d : DIAMETERS[c?.media] ?? 6;
  };
  const riders = L.members.filter(m => m.ji != null && m.li != null)
    .map((m, k) => ({cable: m.cable, k, lo: Math.min(m.ji, m.li), hi: Math.max(m.ji, m.li), ji: m.ji, li: m.li}));
  if (riders.length < 2) return null;
  const at = i => riders.filter(m => m.lo <= i && i <= m.hi);
  const index = new Map();
  T.forEach((e, i) => { if (e.kind !== 's' && !index.has(e.key)) index.set(e.key, i); });
  const nodes = T.map((e, i) => i).filter(i => T[i].kind !== 's');
  // where each node is, in rack mm: a lane node by the kit's own point; a
  // pathway by the points a member's path gives it (not its lead or approach)
  const pathPts = (id, e) => (paths?.get(id)?.points ?? []).filter(q => q.item === e.item && q.via === e.via && q.at !== 'lead' && q.at !== 'approach');
  const pos = new Map(), run = new Map();
  for (const i of nodes) {
    const e = T[i];
    let p = null, r = e.kind === 'n' ? 'y' : 'x';
    if (e.kind === 'p') {
      for (const m of at(i)) {
        const qs = pathPts(m.cable, e);
        if (!qs.length) continue;
        p = {x: qs.reduce((s, q) => s + q.x, 0) / qs.length, y: qs.reduce((s, q) => s + q.y, 0) / qs.length, z: qs.reduce((s, q) => s + q.z, 0) / qs.length};
        const d = {x: Math.abs(qs.at(-1).x - qs[0].x), y: Math.abs(qs.at(-1).y - qs[0].y), z: Math.abs(qs.at(-1).z - qs[0].z)};
        if (qs.length > 1) r = d.z > d.x && d.z > d.y ? 'z' : d.y > d.x ? 'y' : 'x';
        break;
      }
    }
    if (!p) { try { p = ctx ? pointOf(rack, e.kind === 'n' ? {lane: e.lane, ru: e.u} : {item: e.item, via: e.via}, ctx) : null; } catch { p = null; } }
    pos.set(i, p); run.set(i, r);
  }
  // which way the trunk runs at each node, along its run, and the axis across
  // it in the face: to the left of that direction, as seen from the front
  const across = new Map();
  nodes.forEach((i, n) => {
    const r = run.get(i), p = pos.get(i);
    if (r === 'z' || !p) { across.set(i, {x: 1, y: 0}); return; }
    const near = step => { for (let k = n + step; k >= 0 && k < nodes.length; k += step) { const q = pos.get(nodes[k]); if (q && Math.abs(q[r] - p[r]) > 1e-6) return q; } return null; };
    const before = near(-1), after = near(1);
    const s = Math.sign((after ?? p)[r] - (before ?? p)[r]) || 1;
    across.set(i, r === 'y' ? {x: -s, y: 0} : {x: 0, y: s});
  });
  // the one order: each end that leaves the others behind pulls its member
  // to the side its port is on, harder the sooner it leaves
  const lo0 = Math.min(...riders.map(m => m.lo)), hi0 = Math.max(...riders.map(m => m.hi));
  const portOf = (id, end) => (paths?.get(id)?.points ?? []).find(q => q.at === end) ?? null;
  const pull = (m, i, end, depth) => {
    const n = across.get(i), p = pos.get(i), q = portOf(m.cable, end);
    if (!depth || !n || !p || !q) return 0;
    return Math.sign(n.x * (q.x - p.x) + n.y * (q.y - p.y)) * depth;
  };
  for (const m of riders) {
    const [loEnd, hiEnd] = m.ji <= m.li ? ['a', 'b'] : ['b', 'a'];
    m.key = pull(m, m.lo, loEnd, m.lo - lo0) + pull(m, m.hi, hiEnd, hi0 - m.hi);
  }
  const order = [...riders].sort((p, q) => p.key - q.key || p.k - q.k);
  order.forEach((m, s) => { m.slot = s; });
  const M = order.length, Dmax = drawnDiameter(fact.diameter, width);
  const pitch = M > 1 ? Math.min(width, Math.max(0, Dmax - width) / (M - 1)) : 0;
  // (to a tenth of a millimetre, as the kit's size check reports it, so the thickest stretch is the size it says)
  const sizeOf = list => drawnDiameter(Math.round((list.length >= 2 ? bundleDiameter(list.map(m => dOf(m.cable))) : list.length ? dOf(list[0].cable) : 0) * 10) / 10, width);
  // each node's members in order, their places across the run (mm from the
  // trunk's line, along `across`), and the diameter there
  const lay = new Map();
  for (const i of nodes) {
    const here = at(i).sort((p, q) => p.slot - q.slot), n = here.length;
    if (!n) continue;
    const mid = (here[0].slot + here.at(-1).slot) / 2;
    const tight = here.at(-1).slot - here[0].slot === n - 1;
    const a = here.map((m, r) => ((tight ? m.slot : mid + r - (n - 1) / 2) - (M - 1) / 2) * pitch);
    lay.set(i, {members: here.map(m => m.cable), a, diameter: sizeOf(here)});
  }
  const floor = i => T[i].kind === 'p' && run.get(i) !== 'z';
  // 2D: a member's offset at a node, in rack mm (x right, y up)
  const offset = (cable, i) => {
    const l = lay.get(i), n = across.get(i), r = l ? l.members.indexOf(cable) : -1;
    if (r < 0 || !n) return null;
    const v = {x: l.a[r] * n.x || 0, y: l.a[r] * n.y || 0};
    // on a floor the lowest member rests where the kit rests a cable
    if (floor(i)) v.y -= Math.min(...l.a.map(x => x * n.y));
    return v;
  };
  // 3D: a member's place in the circle at a node, from its centre: `u` across
  // the run in the face (along `across`), `v` out of it
  const packed = new Map();
  const pack = (cable, i) => {
    const l = lay.get(i), r = l ? l.members.indexOf(cable) : -1, n = across.get(i);
    if (r < 0 || !n) return null;
    if (!packed.has(i)) {
      const k = l.members.length;
      const pts = l.members.map((_, index) => packOffset({index, n: k, diameter: l.diameter}, width));
      // the same order across the run: the member furthest along `across` takes the point furthest along it
      packed.set(i, pts.sort((p, q) => p[0] - q[0] || p[1] - q[1]));
    }
    const [u, v] = packed.get(i)[r];
    return {x: u * n.x, y: u * n.y, z: v, u, v};
  };
  // the stretches between one node and the next, with the members that ride
  // both, the diameter of those, and where their pack's middle is at each end
  const stretches = [];
  for (let n = 0; n + 1 < nodes.length; n++) {
    const i = nodes[n], j = nodes[n + 1];
    const on = at(i).filter(m => m.lo <= j && j <= m.hi).sort((p, q) => p.slot - q.slot);
    if (on.length < 2) continue;
    const D = sizeOf(on);
    const middle = k => {
      const vs = on.map(m => offset(m.cable, k)).filter(Boolean);
      if (!vs.length) return {x: 0, y: 0};
      const xs = vs.map(v => v.x), ys = vs.map(v => v.y);
      // on a floor the pack stands on its lowest member's underside; elsewhere it is about its members' middle
      return {x: (Math.min(...xs) + Math.max(...xs)) / 2,
              y: floor(k) ? Math.min(...ys) - width / 2 + D / 2 : (Math.min(...ys) + Math.max(...ys)) / 2};
    };
    stretches.push({from: i, to: j, members: on.map(m => m.cable), diameter: D, c0: middle(i), c1: middle(j),
                    s0: T[i].seg + T[i].t, s1: T[j].seg + T[j].t});
  }
  return {T, nodes, index, order: order.map(m => m.cable), pitch, diameter: Dmax, lay, stretches,
          at: i => lay.get(i) ?? null, pos: i => pos.get(i) ?? null, across: i => across.get(i) ?? null, run: i => run.get(i) ?? null,
          offset, pack, indexOf: w => index.get(waypointKey(w)) ?? -1,
          // the stretch a strap is on ({segment, t}: the kit's place along the trunk), and how far along it
          stretchAt: s => { const v = s.segment + s.t; const st = stretches.find(x => x.s0 <= v + 1e-9 && v <= x.s1 + 1e-9);
            return st ? {stretch: st, f: st.s1 > st.s0 ? (v - st.s0) / (st.s1 - st.s0) : 0} : null; }};
}

// THE TRUNK'S RING MARKS, one per trunk waypoint (the kit's layout.trunk), in
// the rack's axes: null for a lane, a duct or a pass, and for a ring the mark
// of a member riding through it there (route.js ringMarks), with its sense
// turned when that member runs the trunk from its far end. `members` is
// [{cable, waypoints, marks, stretch, dir}], `dir` +1 when the member runs
// from the trunk's start to its end. A ring no member's marks reach is null:
// the drawing then passes it as a point.
export function trunkMarks(trunk, members) {
  return trunk.map(w => {
    if (!w || w.lane) return null;
    const k = waypointKey(w);
    for (const m of members) {
      if (!m.marks || !m.stretch || m.marks.length !== m.waypoints.length) continue;
      const [i, j] = m.stretch;
      let at = -1;
      for (let n = i; n <= j; n++) if (waypointKey(m.waypoints[n]) === k) { at = n; break; }
      const mk = at >= 0 ? m.marks[at] : null;
      if (!mk) continue;
      const turn = m.dir < 0 && (mk.sense === 1 || mk.sense === -1) && mk.back !== true;
      return turn ? {...mk, sense: -mk.sense} : mk;
    }
    return null;
  });
}

// The members as trunkMarks reads them, from a bundle's facts and this
// render's routes and marks (Map(cable id -> ...)).
export function trunkMembers(fact, routes, marks, places) {
  const L = fact?.check?.layout;
  if (!L) return [];
  return L.members.map(m => {
    const r = routes?.get(m.cable);
    const dir = m.ji != null && m.li != null ? Math.sign(m.li - m.ji) || 1 : 1;
    return {cable: m.cable, waypoints: r?.waypoints ?? [], marks: marks?.get(m.cable) ?? null,
            stretch: places?.get(m.cable)?.stretch ?? null, dir};
  });
}

// A STRAP ON A VIEW'S OWN DRAWING. `pts` are the view's points for the
// trunk's waypoints (null where the view cannot place one), `s` the kit's
// strap ({segment, t}). The strap's centre and the run's direction there, or
// null when either end of its segment is not in this view: a segment in
// depth (front to rear) is seen in neither elevation, so its straps are
// counted but not drawn (design section 6). Points are [x, y] or [x, y, z].
export function strapAt(pts, s) {
  const p = pts[s.segment], q = pts[s.segment + 1];
  if (!p || !q) return null;
  const d = p.map((v, k) => q[k] - v), L = Math.hypot(...d);
  if (!(L > 0)) return null;
  return {at: p.map((v, k) => v + d[k] * s.t), dir: d.map(v => v / L)};
}

// THE POINTS THE KIT LAYS A MEMBER THROUGH BETWEEN TWO TRUNK STOPS (waypoints
// k and k + 1 of `trunk`): {a, b, mid}, the kit's own points (rack mm) at the
// first stop, at the second, and between them in order from the first. Taken
// from the first member whose path runs from one waypoint straight to the
// other; null when none does. `mid` is [] where the kit adds no point there:
// the run between the two stops is then straight. This is the run as it is
// DRAWN (the 3D trunk and the side views' cables go through these points), so
// it is what a strap is stood on (#195).
// A LANE STOP IS ONE POINT OF THE MEMBER'S PATH. The kit's lane points carry
// no lane name, only where they are, and two lanes at one U (a rear lane and
// the front lane it crosses to) stand at one height: `laneAt(w)`, the kit's
// own point for a lane waypoint (route.js pointOf), tells them apart - the
// stop is the path's lane point at that height nearest it, across the rack
// and in depth. Without it a stop at such a U matched both points, and a run
// from one to the other was read as no run at all.
export function trunkSpanPoints(trunk, k, members, paths, laneAt = null) {
  const at = (P, w) => {
    const all = P.map((q, i) => i).filter(i => (w.lane ? P[i].at === 'lane' && Math.abs(P[i].y - (w.ru - 0.5) * RU) < 1e-6
      : P[i].item === w.item && P[i].via === w.via && P[i].at !== 'lead'));
    if (!w.lane || all.length < 2 || !laneAt) return all;
    let p = null;
    try { p = laneAt(w); } catch { p = null; }
    return p ? [all.reduce((m, i) => (Math.hypot(P[i].x - p.x, P[i].z - p.z) < Math.hypot(P[m].x - p.x, P[m].z - p.z) ? i : m))] : all;
  };
  for (const id of members ?? []) {
    const P = paths?.get(id)?.points;
    if (!P?.length || !trunk[k] || !trunk[k + 1]) continue;
    const a = at(P, trunk[k]), b = at(P, trunk[k + 1]);
    if (!a.length || !b.length) continue;
    let mid;
    if (Math.max(...a) < Math.min(...b)) mid = P.slice(Math.max(...a) + 1, Math.min(...b));
    else if (Math.max(...b) < Math.min(...a)) mid = P.slice(Math.max(...b) + 1, Math.min(...a)).reverse();
    else continue;
    // (another stop, or a lead of the member's own, between them: it does not run straight from one to the other)
    if (mid.some(q => q.item || q.at === 'lead' || q.at === 'lane' || q.at === 'reach' || q.end)) continue;
    return {a: a.map(i => P[i]), b: b.map(i => P[i]), mid};
  }
  return null;
}

// A PLACE ALONG A LINE OF POINTS, BY ITS LENGTH: fraction `t` (0 to 1) of the
// whole length of the line through `points` ([x, y] or [x, y, z] each), as
// {k, f, at, dir}: the leg it falls on (from points[k]), how far along that
// leg, the point, and the leg's direction. null for a line of no length.
export function alongLine(points, t) {
  const legs = points.slice(1).map((q, k) => Math.hypot(...q.map((v, n) => v - points[k][n])));
  const total = legs.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return null;
  let left = Math.min(1, Math.max(0, t)) * total, k = 0;
  // (a leg of no length is stepped over; the last leg with any length takes what rounding leaves)
  const last = legs.reduce((n, L, i) => (L > 0 ? i : n), 0);
  while (k < last && (!(legs[k] > 0) || left > legs[k])) { left -= legs[k]; k++; }
  const f = Math.min(1, Math.max(0, left / legs[k])), p = points[k], q = points[k + 1];
  return {k, f, at: p.map((v, n) => v + (q[n] - v) * f), dir: p.map((v, n) => (q[n] - v) / legs[k])};
}

// A TAG IS NEVER CUT AT ITS END (#194): what tells two tags apart is at the
// end - a port's path, a bundle's name - so two different ends cut there read
// the same. A text too long for its pill (over `max` characters) loses the
// MIDDLE of a part instead (`parts` in order, joined as they are; `cut` names
// the ones that may be shortened, the first of them first), and its title
// keeps it whole.
const midCut = (text, n) => { const cs = Array.from(String(text)); if (cs.length <= n) return cs.join('');
  const keep = Math.max(2, n - 1), head = Math.ceil(keep / 2); return `${cs.slice(0, head).join('')}…${cs.slice(cs.length - (keep - head)).join('')}`; };
export function fitText(parts, cut, max) {
  const out = parts.map(String), len = () => Array.from(out.join('')).length;
  for (const k of cut) {
    const over = len() - max;
    if (over <= 0) break;
    out[k] = midCut(out[k], Math.max(3, Array.from(out[k]).length - over));
  }
  return out.join('');
}

// How far a point is from a line of points (each [x, y] or [x, y, z]): to the nearest place on any of its legs.
export function offLine(p, line) {
  let best = line.length === 1 ? Math.hypot(...p.map((v, n) => v - line[0][n])) : Infinity;
  for (let k = 0; k + 1 < line.length; k++) {
    const a = line[k], d = line[k + 1].map((v, n) => v - a[n]), L2 = d.reduce((s, v) => s + v * v, 0);
    const f = L2 > 0 ? Math.min(1, Math.max(0, p.reduce((s, v, n) => s + (v - a[n]) * d[n], 0) / L2)) : 0;
    best = Math.min(best, Math.hypot(...p.map((v, n) => v - a[n] - d[n] * f)));
  }
  return best;
}

// The trunk's waypoints cut into stretches a view can draw: each a run of
// consecutive waypoints it places, with their indices. A waypoint the view
// cannot place (on the other face) ends one stretch; the band never jumps it.
export function drawableRuns(pts) {
  const runs = [];
  let cur = null;
  pts.forEach((p, k) => {
    if (!p) { cur = null; return; }
    if (!cur) { cur = {from: k, points: []}; runs.push(cur); }
    cur.points.push(p);
  });
  return runs.filter(r => r.points.length >= 2);
}

// ── what the list and the sheet say of a bundle ──────────────────────────
const mmText = v => `${Math.round(v)} mm`;

// One line: "3 cables (c1-c3), about 6 mm, 2 straps every 12 in".
export function bundleSummary(fact) {
  const n = fact.members.length;
  const parts = [`${n} cable${n === 1 ? '' : 's'}${n ? ` (${membersText(fact.members)})` : ''}`];
  if (!fact.drawn) parts.push('not drawn');
  else if (!fact.check.checked) parts.push('not checked');
  else if (fact.diameter) parts.push(`about ${mmText(fact.diameter)}`);
  const every = fact.every ?? null;
  const said = fact.straps ? strapsText(fact.straps, every) : null;
  if (said) parts.push(said);
  else if (fact.drawn) parts.push(spacingText(every));
  return parts.join(', ');
}

// The size check in words: "about 6 mm; the tightest opening on its route is
// 29.5 mm, at mgr-1 ring 1".
export function sizeLine(fact) {
  const s = fact.check?.size;
  if (!s || !(s.max_mm > 0)) return null;
  const by = s.limitBy ? `, set by ${s.limitBy.text}${s.limitBy.estimated ? ' (estimated)' : ''}` : '';
  return `About ${mmText(s.max_mm)} across at its largest (${s.at}); its limit is ${s.limit_mm} mm${by}.`;
}

// THE BEND RESULT, WHEREVER A BUNDLE'S WARNINGS ARE LISTED (Portrayal #922,
// kit 0.8.0, vendored since 0.10.0). With the cable types' bend radii
// (`ctx.bendOf`) and the routes, the check's `bend` is
//   {radius_mm, by, unchecked: [ids], points: [point], violations: [point]}
// each point {kind: 'corner' | 'pathway', at (text), waypoint, angle_deg?,
// legs_mm?, room_mm, source, estimated, need_mm, by, members, unchecked,
// ok: true | false | null, short_mm}, `violations` the points with ok false.
// A violation's sentence is already in the check's `warnings`, and a member
// or point left unchecked (ok null) is in its `notes`; the list shows both, so
// this adds only the radius the bundle needs, and the views mark the
// violations (bendViolations). Null-safe: without the routes, or with no
// bundle to bend, `bend` is null and they say nothing. The only place on the
// page that reads `bend` (the exports read the kit's bundleExports).
export function bendLine(check) {
  const b = check?.bend;
  return b?.radius_mm > 0 ? `Bend radius ${mmText(b.radius_mm)}${b.by ? `, set by ${b.by}` : ''}.` : null;
}
// The trunk waypoints where the bend is too tight (ok false), for the views
// to mark: [{waypoint, at, need_mm, room_mm, short_mm}]. Empty when it passes.
export function bendViolations(check) {
  const b = check?.bend;
  const list = Array.isArray(b?.violations) ? b.violations : Array.isArray(b?.points) ? b.points.filter(p => p?.ok === false) : [];
  return list.filter(p => p && p.waypoint).map(p => ({waypoint: p.waypoint, at: p.at ?? '', need_mm: p.need_mm ?? null,
    room_mm: p.room_mm ?? null, short_mm: p.short_mm ?? null}));
}
// Where on a trunk a violation is: the index of its waypoint, or -1.
export const trunkIndexOf = (trunk, w) => { const k = waypointKey(w); return k == null ? -1 : trunk.findIndex(x => waypointKey(x) === k); };

// Where a member leaves its bundle, in words, when a peel point sends it off
// before the trunk's end: "leaves at left-front U25 for its b end".
export function peelText(rack, bundle, cableId) {
  const m = bundle.members.find(x => x.cable === cableId);
  if (!m) return null;
  const ends = ['a', 'b'].filter(e => m[e]);
  return ends.length ? ends.map(e => `leaves at ${waypointText(rack, m[e])} for its ${e} end`).join('; ') : null;
}

// THE SHEET'S NOTES (design section 7): one per bundle, then its warnings.
// The kit's notes come too, as in the list: a size that is an estimate, a
// member that does not meet the route, a stale peel point, and (kit 0.8.0)
// members whose bend is unchecked - without them a bend radius would read as
// a pass. The cable schedule lists the bundles in the kit's own words
// (export-data.js bundleNotes, Portrayal #923); the sheet keeps these.
export function sheetBundleNotes(rack, bundles) {
  if (!bundles) return [];
  return [...bundles.values()].flatMap(f => [`${f.name} (${f.id}): ${bundleSummary(f)}.`,
    ...(f.check?.warnings ?? []), ...[bendLine(f.check)].filter(Boolean), ...(f.check?.notes ?? [])]);
}
