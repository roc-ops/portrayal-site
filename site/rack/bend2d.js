// A routed cable on a 2D pane, with each corner a true arc of the cable's own
// bend radius (portrayal-site#185), as the 3D tube is (bend3d.js fitCorners):
// the kit's points are the polyline, a corner is cut back `R * tan(theta / 2)`
// along each leg and joined by an SVG arc of radius R. A corner whose legs
// cannot hold that is cut back as far as they allow (half of a leg, or what
// the corner at its far end leaves) and its arc is smaller, and it is listed
// in `short` with how much: the same sums as fitCorners, in the pane's mm.
//
// Pure geometry, so node can import it. Without a radius the corners are
// routed2d's small cut, as before.
import {routed2d, throughRings} from '../../vendor/rack/route-path.js';

const STRAIGHT = 0.25 * Math.PI / 180;   // as bend3d.js: under a quarter degree is straight
const EPS = 1e-6;
const n2 = v => Math.round(v * 1e3) / 1e3;

// {d, corners}: the path `d` through `pts` ([x, y] pairs; `rings` as routed2d
// takes them) and, per interior point that turns, {k, at, theta, drawn_mm,
// short_mm}. `short_mm` is 0 for a corner at its full radius.
export function arcPath(pts, R, rings = null, {lead = 4} = {}) {
  if (!validR(R)) return {d: routed2d(pts, lead, rings), corners: []};
  if (rings) pts = throughRings(pts, rings, {lead}).points;
  const {P, cuts} = fit(pts, R);
  const corners = [];
  let d = P.length ? `M${n2(P[0][0])} ${n2(P[0][1])}` : '';
  for (let k = 1; k < P.length - 1; k++) {
    const c = cuts[k];
    if (!c) { d += ` L${n2(P[k][0])} ${n2(P[k][1])}`; continue; }
    corners.push({k, at: P[k], theta: c.theta, drawn_mm: Math.round(c.drawn * 10) / 10, short_mm: c.short});
    d += ` L${n2(c.i[0])} ${n2(c.i[1])}${arcTo(c)}`;
  }
  if (P.length > 1) d += ` L${n2(P[P.length - 1][0])} ${n2(P[P.length - 1][1])}`;
  return {d, corners};
}

const validR = R => typeof R === 'number' && Number.isFinite(R) && R > 0;

// The points without repeats and, per interior point that turns, its cut:
// {theta, t (cut back along each leg), drawn (the arc's radius), short, d1,
// d2 (the legs' directions), i, o (where the arc starts and ends)}; null
// for a point that goes straight on.
function fit(pts, R) {
  const P = [];
  for (const p of pts) if (!P.length || Math.hypot(p[0] - P[P.length - 1][0], p[1] - P[P.length - 1][1]) > EPS) P.push([p[0], p[1]]);
  const len = P.slice(1).map((p, j) => Math.hypot(p[0] - P[j][0], p[1] - P[j][1]));
  const dir = (a, b, l) => [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
  const turn = P.map((q, k) => {
    if (k === 0 || k === P.length - 1) return 0;
    const d1 = dir(P[k - 1], q, len[k - 1]), d2 = dir(q, P[k + 1], len[k]);
    return Math.acos(Math.max(-1, Math.min(1, d1[0] * d2[0] + d1[1] * d2[1])));
  });
  // What each corner asks of its legs; a corner that doubles back asks for all.
  const want = turn.map(th => (th < STRAIGHT ? 0 : th >= Math.PI - STRAIGHT ? Infinity : R * Math.tan(th / 2)));
  const share = (j, other) => Math.max(len[j] / 2, len[j] - want[other]);
  const cuts = P.map((q, k) => {
    if (k === 0 || k === P.length - 1 || turn[k] < STRAIGHT) return null;
    const t = Math.min(want[k], share(k - 1, k - 1), share(k, k + 1));
    const drawn = want[k] === Infinity ? 0 : t / Math.tan(turn[k] / 2);
    const short = drawn < R - 0.05 ? Math.round((R - drawn) * 10) / 10 : 0;
    const d1 = dir(P[k - 1], q, len[k - 1]), d2 = dir(q, P[k + 1], len[k]);
    return {theta: turn[k], t, drawn, short, d1, d2, sweep: d1[0] * d2[1] - d1[1] * d2[0] > 0 ? 1 : 0,
            i: [q[0] - d1[0] * t, q[1] - d1[1] * t], o: [q[0] + d2[0] * t, q[1] + d2[1] * t]};
  });
  return {P, cuts};
}

// The arc from a cut's start to its end (a doubled-back corner has no arc to draw: it is a point).
const arcTo = c => (c.drawn > EPS ? ` A${n2(c.drawn)} ${n2(c.drawn)} 0 0 ${c.sweep} ${n2(c.o[0])} ${n2(c.o[1])}` : ` L${n2(c.o[0])} ${n2(c.o[1])}`);

// A BUNDLE'S TRUNK round the same corners (portrayal-site#185). `pts` are the
// trunk's nodes in order on one pane, stretch j running from pts[j] to
// pts[j + 1]; R is the bundle's radius. One path per stretch, the arc at a
// corner drawn by the stretch it ends, the next starting where the arc
// leaves: {d, from, to} with `d` beginning `M start L end-of-its-straight-run`.
// A node that goes straight on, or no radius, leaves a stretch the line it was.
export function trunkPaths(pts, R) {
  const {P, cuts} = validR(R) ? fit(pts, R) : {P: pts, cuts: pts.map(() => null)};
  return P.slice(1).map((_, j) => {
    const a = cuts[j] ? cuts[j].o : P[j], c = cuts[j + 1];
    const into = c ? c.i : P[j + 1];
    return {d: `M${n2(a[0])} ${n2(a[1])} L${n2(into[0])} ${n2(into[1])}${c ? arcTo(c) : ''}`, from: a, to: c ? c.o : P[j + 1]};
  });
}

// Where a fraction `f` of stretch j (as the straight chord, which is what the
// kit places a strap on) falls on the rounded trunk: {c, dir}, the point and
// the direction of the run there. Within a corner's cut the chord's stretch
// of 2 t maps onto its arc.
export function trunkPoint(pts, R, j, f) {
  const {P, cuts} = validR(R) ? fit(pts, R) : {P: pts, cuts: pts.map(() => null)};
  const a = P[j], b = P[j + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]), u = f * L;
  const dir = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
  const onArc = (c, share) => {          // share 0..1 through the arc
    const al = share * c.theta, r = c.drawn, s = c.sweep ? 1 : -1, n = [-c.d1[1], c.d1[0]];
    return {c: [c.i[0] + r * (Math.sin(al) * c.d1[0] + s * (1 - Math.cos(al)) * n[0]), c.i[1] + r * (Math.sin(al) * c.d1[1] + s * (1 - Math.cos(al)) * n[1])],
            dir: [Math.cos(al) * c.d1[0] + s * Math.sin(al) * n[0], Math.cos(al) * c.d1[1] + s * Math.sin(al) * n[1]]};
  };
  const start = cuts[j], end = cuts[j + 1];
  if (end && end.drawn > EPS && L - u < end.t) return onArc(end, 0.5 - (L - u) / (2 * end.t));
  if (start && start.drawn > EPS && u < start.t) return onArc(start, 0.5 + u / (2 * start.t));
  return {c: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], dir};
}
