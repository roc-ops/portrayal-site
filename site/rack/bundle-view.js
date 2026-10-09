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
        waypointText, onTrunk} from '../../vendor/rack/bundles.js';
import {waypointKey} from '../../vendor/rack/bundle-route.js';

// A strap as drawn, along the run (mm). The kit keeps straps STRAP_W (20 mm)
// off rings; a strap drawn half that wide reads as a strap, not a block.
export const STRAP_DRAWN = 10;

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

// HOW FAR A MEMBER SITS FROM ITS BUNDLE'S CENTRE LINE, across the run (mm):
// the members side by side in combing order, their centres spread over the
// bundle's diameter less one cable's width, never further apart than `width`
// (a stroke or a tube's width), so they stay inside the band.
export function combOffset(place, width) {
  if (!place || place.n < 2) return 0;
  const room = Math.max(0, drawnDiameter(place.diameter, width) - width);
  const pitch = Math.min(width, room / (place.n - 1));
  return (place.index - (place.n - 1) / 2) * pitch;
}

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
  if (fact.straps && every) parts.push(`${fact.straps.count} strap${fact.straps.count === 1 ? '' : 's'} every ${every.value} ${every.unit}`);
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
