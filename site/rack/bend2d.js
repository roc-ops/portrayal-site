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
  if (!(typeof R === 'number' && Number.isFinite(R) && R > 0)) return {d: routed2d(pts, lead, rings), corners: []};
  if (rings) pts = throughRings(pts, rings, {lead}).points;
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
  const corners = [];
  let d = P.length ? `M${n2(P[0][0])} ${n2(P[0][1])}` : '';
  for (let k = 1; k < P.length - 1; k++) {
    const q = P[k];
    if (turn[k] < STRAIGHT) { d += ` L${n2(q[0])} ${n2(q[1])}`; continue; }
    const t = Math.min(want[k], share(k - 1, k - 1), share(k, k + 1));
    const drawn = want[k] === Infinity ? 0 : t / Math.tan(turn[k] / 2);
    const short = drawn < R - 0.05 ? Math.round((R - drawn) * 10) / 10 : 0;
    corners.push({k, at: q, theta: turn[k], drawn_mm: Math.round(drawn * 10) / 10, short_mm: short});
    const d1 = dir(P[k - 1], q, len[k - 1]), d2 = dir(q, P[k + 1], len[k]);
    const i = [q[0] - d1[0] * t, q[1] - d1[1] * t], o = [q[0] + d2[0] * t, q[1] + d2[1] * t];
    d += ` L${n2(i[0])} ${n2(i[1])}`;
    // (a doubled-back corner has no arc to draw: it is a point)
    if (drawn > EPS) d += ` A${n2(drawn)} ${n2(drawn)} 0 0 ${d1[0] * d2[1] - d1[1] * d2[0] > 0 ? 1 : 0} ${n2(o[0])} ${n2(o[1])}`;
    else d += ` L${n2(o[0])} ${n2(o[1])}`;
  }
  if (P.length > 1) d += ` L${n2(P[P.length - 1][0])} ${n2(P[P.length - 1][1])}`;
  return {d, corners};
}
