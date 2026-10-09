// site/rack/bend3d.js
// EVERY 3D CORNER AT THE CABLE'S BEND RADIUS (portrayal-site#164; Portrayal
// docs/cable-lay-design.md section 3: "no corner ... tighter than the
// installed bend radius"). A routed tube is a polyline - the lead out of each
// port, the detours round a body, the ring passes, the waypoints - and each
// corner of it is rounded here by a true circular arc of the cable's
// installed minimum bend radius (the kit's cable-types.js bendLookup, handed
// in as a number), or a bundle's radius for a bundle's trunk (the kit's
// bundleCheck `bend.radius_mm`). A corner is never invented here: the pass
// works on whatever points it is given, so when the kit's path starts at its
// own reach point (kit 0.13.0) it rounds those the same way.
//
// THE ROOM AT A CORNER. An arc of radius R through a turn of theta needs
// t = R tan(theta / 2) of each leg. Two corners share the leg between them:
// each may have its own need when both fit, else as much as the other leaves,
// and never less than half; a leg's open end (a plug) gives all of it. A
// corner that cannot have its need is drawn at the tightest radius its legs
// allow, t / tan(theta / 2), and reported, in the words of the kit's bend
// check (bundles.js bendCheck): "turns ... with room for a 12 mm bend; c3
// (om4) needs 25 mm, 13 mm short", or "doubles back ... with no room for a
// bend". A radius not known (a cable with no type) rounds nothing and checks
// nothing: the corner is drawn as the polyline has it, and not called a pass.
//
// No DOM and no three.js import: THREE is passed in, as cable-geometry.js does.

import {throughRings} from '../../vendor/rack/route-path.js';
import {LEAD, mergeOf} from '../../vendor/rack/cable-geometry.js';

const EPS = 1e-6;
const STRAIGHT = 0.25 * Math.PI / 180;   // a turn under a quarter degree is straight
const round1 = v => Math.round(v * 10) / 10;

// The corners of `pts` (Vector3s) with radius `R` (mm, or null): returns
// {points, corners}, the points with repeats dropped, and per interior
// point that turns, {k, theta, need_t, t, room_t, need_mm, drawn_mm,
// short_mm, why, at}: `room_t` is what its legs allow, and `why` says what
// made a short corner short - 'legs' (no room between its neighbours), 'body'
// (`cap`: clearCurve drew it tighter to keep its arc out of a body) or 'back'
// (it doubles back); null for a corner at its full radius.
export function fitCorners(pts, R, {cap = null} = {}) {
  const P = [];
  for (const p of pts) if (!P.length || P[P.length - 1].distanceTo(p) > EPS) P.push(p.clone());
  const L = P.slice(1).map((p, j) => p.distanceTo(P[j]));
  const turn = P.map((q, k) => {
    if (k === 0 || k === P.length - 1) return 0;
    const d1 = q.clone().sub(P[k - 1]).normalize(), d2 = P[k + 1].clone().sub(q).normalize();
    return Math.acos(Math.max(-1, Math.min(1, d1.dot(d2))));
  });
  const known = typeof R === 'number' && Number.isFinite(R) && R > 0;
  const want = turn.map(th => (!known || th < STRAIGHT ? 0 : th >= Math.PI - STRAIGHT ? Infinity : R * Math.tan(th / 2)));
  // Each leg's share for the corner at either end of it.
  // (an end of the path wants nothing, so a leg to it gives the corner all of it)
  const share = (j, other) => Math.max(L[j] / 2, L[j] - want[other]);
  const corners = [];
  for (let k = 1; k < P.length - 1; k++) {
    if (turn[k] < STRAIGHT) continue;
    const left = share(k - 1, k - 1), right = share(k, k + 1);
    const room = Math.min(left, right), capped = cap?.get(k) ?? Infinity;
    const t = known ? Math.min(want[k], room, capped) : 0;
    const tan = Math.tan(turn[k] / 2);
    const drawn = !known ? null : want[k] === Infinity ? 0 : t / tan;
    const short = known && drawn < R - 0.05 ? round1(R - drawn) : 0;
    const why = !short ? null : want[k] === Infinity ? 'back' : capped < Math.min(want[k], room) ? 'body' : 'legs';
    corners.push({k, theta: turn[k], need_t: want[k], t: want[k] === Infinity ? 0 : t, room_t: room,
                  need_mm: known ? R : null, drawn_mm: drawn == null ? null : round1(drawn),
                  short_mm: short, why, at: P[k].clone()});
  }
  return {points: P, corners};
}

// A curve along the rounded path, parameterised by arc length, so a tube's
// samples (and getSpacedPoints) fall evenly along it and its curvature is
// exactly 0 on a straight and 1/r on an arc.
export function roundedCurve(THREE, pts, R, {cap = null} = {}) {
  const {points: P, corners} = fitCorners(pts, R, {cap});
  const pieces = [];   // {len, at(s) -> Vector3, tan(s) -> Vector3}
  const line = (a, b) => {
    const len = a.distanceTo(b);
    if (len <= EPS) return;
    const d = b.clone().sub(a).normalize();
    pieces.push({len, at: s => a.clone().addScaledVector(d, s), tan: () => d.clone()});
  };
  let from = P[0];
  const byK = new Map(corners.map(c => [c.k, c])), mid = new Map();
  for (let k = 1; k < P.length - 1; k++) {
    const c = byK.get(k), q = P[k];
    if (!c || !(c.t > EPS) || !(c.drawn_mm > 0)) { line(from, q); from = q; mid.set(k, pieces.reduce((a, p) => a + p.len, 0)); continue; }
    const d1 = q.clone().sub(P[k - 1]).normalize(), d2 = P[k + 1].clone().sub(q).normalize();
    const T1 = q.clone().addScaledVector(d1, -c.t), T2 = q.clone().addScaledVector(d2, c.t);
    const r = c.t / Math.tan(c.theta / 2);
    const n = d2.clone().addScaledVector(d1, -d1.dot(d2)).normalize();
    const C = T1.clone().addScaledVector(n, r);
    line(from, T1);
    mid.set(k, pieces.reduce((a, p) => a + p.len, 0) + r * c.theta / 2);
    // phi from 0 at T1 to theta at T2: C + r(-n cos phi + d1 sin phi)
    pieces.push({len: r * c.theta,
      at: s => { const f = s / r; return C.clone().addScaledVector(n, -r * Math.cos(f)).addScaledVector(d1, r * Math.sin(f)); },
      tan: s => { const f = s / r; return n.clone().multiplyScalar(Math.sin(f)).addScaledVector(d1, Math.cos(f)).normalize(); }});
    from = T2;
  }
  line(from, P[P.length - 1]);
  const total = pieces.reduce((s, p) => s + p.len, 0);
  const find = u => {
    let s = Math.max(0, Math.min(1, u)) * total;
    for (const p of pieces) { if (s <= p.len + EPS) return [p, Math.min(s, p.len)]; s -= p.len; }
    const p = pieces[pieces.length - 1]; return [p, p.len];
  };
  class Rounded extends THREE.Curve {
    getPoint(u, target = new THREE.Vector3()) {
      if (!pieces.length) return target.copy(P[0]);
      const [p, s] = find(u); return target.copy(p.at(s));
    }
    getTangent(u, target = new THREE.Vector3()) {
      if (!pieces.length) return target.set(0, 0, 1);
      const [p, s] = find(u); return target.copy(p.tan(s));
    }
    getLength() { return total; }
    getLengths(div = this.arcLengthDivisions) { return Array.from({length: div + 1}, (_, i) => total * i / div); }
    getUtoTmapping(u, distance) { return distance != null ? (total ? distance / total : 0) : u; }
  }
  const curve = new Rounded();
  curve.corners = corners;
  // How far along the curve corner k's arc is centred (its vertex, for a corner not rounded).
  curve.lengthTo = k => mid.get(k) ?? 0;
  curve.radius = typeof R === 'number' && R > 0 ? R : null;
  // The polyline's own length, unrounded: what rounding took off is the difference.
  curve.polyline = P.slice(1).reduce((s, p, j) => s + p.distanceTo(P[j]), 0);
  return curve;
}

// The solid body a point is strictly inside, as tubes_inside reads them:
// 0.05 mm in from a face. `boxes` is [{ref, part, box}] (world Box3s); the
// answer is the entry it is inside, so a caller can tell whose body it is,
// or null.
export const insideOf = boxes => q => (boxes ?? []).find(({box}) => q.x > box.min.x + 0.05 && q.x < box.max.x - 0.05
  && q.y > box.min.y + 0.05 && q.y < box.max.y - 0.05 && q.z > box.min.z + 0.05 && q.z < box.max.z - 0.05) ?? null;

// A CORNER KEPT OUT OF THE METAL. An arc lies inside its corner, so a corner
// the route takes round a solid body (a detour round a PDU, a tray's edge)
// would cut through that body at the full radius. `inside(point)` says
// whether a point is in a body; each corner whose arc meets one is drawn
// tighter, halving its share of the legs until it clears (or is the polyline
// itself), and so is flagged as short like any corner without room, with
// `why: 'body'`, `hit`, the first point where its arc met the body, and
// `hitRef`, that body's item (when `inside` answers the box, as insideOf does).
// Only the ARC is sampled: a straight leg inside a body (a lead leaving a
// plug recessed in its own device) is no bend fault, and tubes_inside's to
// find, not this.
export function clearCurve(THREE, pts, R, inside, {tries = 10, step = 1} = {}) {
  let curve = roundedCurve(THREE, pts, R);
  if (typeof inside !== 'function') return curve;
  const cap = new Map(), hits = new Map();
  for (let n = 0; n < tries; n++) {
    let moved = false;
    for (const c of curve.corners) {
      if (!(c.t > 1e-6) || !(c.drawn_mm > 0)) continue;
      // the arc itself: r theta long, centred on lengthTo(k)
      const L = curve.getLength(), at = curve.lengthTo(c.k), half = (c.t / Math.tan(c.theta / 2)) * c.theta / 2;
      const from = Math.max(0, at - half), to = Math.min(L, at + half);
      let hit = null, body = null;
      for (let d = from; d <= to + 1e-9 && !hit; d += Math.min(step, (to - from) / 2 || step)) {
        const q = curve.getPointAt(L ? Math.min(1, d / L) : 0);
        body = inside(q);
        if (body) hit = q;
      }
      if (hit) {
        if (!hits.has(c.k)) hits.set(c.k, {at: hit.clone(), ref: body?.ref ?? null});
        cap.set(c.k, c.t / 2 < 0.5 ? 0 : c.t / 2); moved = true;
      }
    }
    if (!moved) break;
    curve = roundedCurve(THREE, pts, R, {cap});
  }
  for (const c of curve.corners) if (c.why === 'body') { c.hit = hits.get(c.k)?.at ?? null; c.hitRef = hits.get(c.k)?.ref ?? null; }
  return curve;
}

// A tight corner in the words of the kit's bend check (bundles.js bendCheck):
// `name` is the cable or bundle, `who` the member that sets the radius with
// its type ("c3 (om4)"), `where` the place in words.
const an = t => (/^(8|1[18](\.|$))/.test(t) ? 'an' : 'a');
export function tightText(name, who, where, c) {
  const needs = `${who} needs ${round1(c.need_mm)} mm`;
  if (c.need_t === Infinity) return `${name} doubles back ${where}, with no room for a bend; ${needs}.`;
  if (!(c.drawn_mm > 0)) return `${name} turns ${where} with no room for a bend; ${needs}.`;
  const room = String(c.drawn_mm);
  return `${name} turns ${where} with room for ${an(room)} ${room} mm bend; ${needs}, ${c.short_mm} mm short.`;
}

// A ROUTED RUN AS A POLYLINE: routePoints3d's own points - each end's plug,
// its lead straight out of the face, then the waypoints with each ring passed
// along its run (throughRings, `lead` mm outside each face) - with no easing,
// so every corner can be rounded to the cable's radius (roundRoute). Nothing is added
// to the kit's geometry here: only routePoints3d's ease points are left out.
const startOf3d = (THREE, e) => (e.points.length > 1 ? mergeOf(THREE, e) : e.points[0].clone());
export function routeLine3d(THREE, A, B, wps, lead = 30, rings = null) {
  const a = startOf3d(THREE, A), b = startOf3d(THREE, B);
  const outA = a.clone().addScaledVector(A.normal, A.reach ?? LEAD);
  const outB = b.clone().addScaledVector(B.normal, B.reach ?? LEAD);
  const path = rings ? throughRings([outA, ...wps, outB], [null, ...rings, null], {lead}).points : [outA, ...wps, outB];
  return [a, ...path, b];
}

// A ROUTED RUN, ROUNDED: routeLine3d's polyline through waypoints `w` (with
// ring marks `m`, or null), each corner an arc of radius R kept out of the
// bodies (clearCurve, `inside`), with two rules.
// A RING TOO THIN FOR THE TURN. A ring passed along its run has the cable
// turn at its faces, and when its depth (a few mm of wire) is all the leg a
// corner has, no bend of the cable's radius fits there. A real cord bends
// THROUGH the ring: such a ring is drawn as its centre, one corner, rounded
// across it (as the kit's bundle bend check measures a corner at a trunk
// waypoint). A ring the route doubles back at (`back`) stays as the kit
// decided it.
// A LEAD LONG ENOUGH TO TURN. A plug sits recessed in its device, and the
// lead runs straight out of the face before it turns; when the turn's arc
// would start inside the device (its envelope reaches past the plug), the
// cable cannot bend there. The lead is drawn longer instead - the end's
// `reach`, as reaches() sets it - by what the arc lacked, so the cable leaves
// the device straight and turns once clear, at its full radius. So is a lead
// shorter than its own turn needs. Only its OWN device: an arc that meets
// another body in front of the port (a tray, a manager) is flagged, never
// answered by pushing the lead through that body. And by at most
// MAX_EXTEND_R radii in all, an end: past that the corner is flagged.
// Returns {pts, bent, extended_mm: [end a, end b]}, how much longer each
// lead was drawn. `thin: false` keeps every ring face to face (a test's
// control). An end's `item` is its device's id, as the solid boxes' `ref`.
export const MAX_EXTEND_R = 2;
export function roundRoute(THREE, A, B, w, m, R, lead, inside, {thin: thinRule = true, tries = 4} = {}) {
  let ends = [A, B], pts, bent, rings = m;
  const extended = [0, 0], most = MAX_EXTEND_R * R;
  const draw = () => { pts = routeLine3d(THREE, ends[0], ends[1], w, lead, rings); bent = clearCurve(THREE, pts, R, inside); };
  const reach = e => e.reach ?? LEAD;
  const longer = () => {
    let moved = false;
    ends = ends.map((e, j) => {
      const q = j === 0 ? pts[1] : pts[pts.length - 2], plug = j === 0 ? pts[0] : pts[pts.length - 1];
      // short for its own device, or because the lead itself is shorter than the turn needs
      const own = x => x.why === 'body' && x.hitRef != null && x.hitRef === e.item;
      const c = bent.corners.find(x => x.at.distanceTo(q) < 1e-6 && (own(x) || (x.why === 'legs' && q.distanceTo(plug) < x.need_t)));
      if (!c || !(c.need_t < Infinity)) return e;
      const more = Math.min((c.need_t - c.t) + 1, most - extended[j]);
      if (!(more > 1e-6)) return e;
      extended[j] += more;
      moved = true;
      return {...e, reach: reach(e) + more};
    });
    return moved;
  };
  draw();
  for (let n = 0; n < tries && longer(); n++) draw();
  if (thinRule && m && bent.corners.some(c => c.short_mm > 0)) {
    const thin = m.map((g, k) => !!g && g.back !== true && g.depth > 0 && bent.corners.some(c => c.short_mm > 0
      && c.at.distanceTo(w[k]) <= lead + g.depth / 2 + 1e-3));
    if (thin.some(Boolean)) {
      rings = m.map((g, k) => (thin[k] ? null : g));
      draw();
      for (let n = 0; n < tries && longer(); n++) draw();
    }
  }
  return {pts, bent, extended_mm: extended};
}
