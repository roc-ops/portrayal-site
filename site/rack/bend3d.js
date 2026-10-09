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

const EPS = 1e-6;
const STRAIGHT = 0.25 * Math.PI / 180;   // a turn under a quarter degree is straight
const round1 = v => Math.round(v * 10) / 10;

// The corners of `pts` (Vector3s) with radius `R` (mm, or null): returns
// {points, corners}, the points with repeats dropped, and per interior
// point that turns, {k, theta, need_t, t, need_mm, drawn_mm, short_mm, at}.
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
    const t = known ? Math.min(want[k], left, right, cap?.get(k) ?? Infinity) : 0;
    const tan = Math.tan(turn[k] / 2);
    const drawn = !known ? null : want[k] === Infinity ? 0 : t / tan;
    corners.push({k, theta: turn[k], need_t: want[k], t: want[k] === Infinity ? 0 : t,
                  need_mm: known ? R : null, drawn_mm: drawn == null ? null : round1(drawn),
                  short_mm: known && drawn < R - 0.05 ? round1(R - drawn) : 0, at: P[k].clone()});
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

// A CORNER KEPT OUT OF THE METAL. An arc lies inside its corner, so a corner
// the route takes round a solid body (a detour round a PDU, a tray's edge)
// would cut through that body at the full radius. `inside(point)` says
// whether a point is in a body; each corner whose arc meets one is drawn
// tighter, halving its share of the legs until it clears (or is the polyline
// itself), and so is flagged as short like any corner without room.
export function clearCurve(THREE, pts, R, inside, {tries = 10, step = 1} = {}) {
  let curve = roundedCurve(THREE, pts, R);
  if (typeof inside !== 'function') return curve;
  const cap = new Map();
  for (let n = 0; n < tries; n++) {
    let moved = false;
    for (const c of curve.corners) {
      if (!(c.t > 1e-6)) continue;
      // the arc lies within t of its corner: sample that stretch of the curve
      const L = curve.getLength(), at = curve.lengthTo(c.k);
      const from = Math.max(0, at - c.t * 1.6), to = Math.min(L, at + c.t * 1.6);
      let hit = false;
      for (let d = from; d <= to && !hit; d += step) hit = inside(curve.getPointAt(L ? d / L : 0));
      if (hit) { cap.set(c.k, c.t / 2 < 0.5 ? 0 : c.t / 2); moved = true; }
    }
    if (!moved) break;
    curve = roundedCurve(THREE, pts, R, {cap});
  }
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
