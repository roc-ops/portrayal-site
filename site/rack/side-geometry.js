// THE RACK FROM ITS SIDE, AS NUMBERS (portrayal-site#187). Pure: no DOM here
// (side-elevation.js draws). The Rack Builder's Left / Right pair looks at
// the rack along its width, so a pane's axes are depth and height.
//
// THE RACK'S FRAME is the kit's (solids.js, route.js): x from the centre
// line, right as seen from the front; y up from the floor of U1; z 0 on the
// front rail plane and negative toward the rear. A side pane drops x:
//
//   - the RIGHT pane looks at the rack's right side, so the front of the rack
//     is at the pane's left: pane X = -z;
//   - the LEFT pane looks at its left side, front at the pane's right: X = z;
//   - pane Y runs down from the top of the rack, as the front pane's does:
//     Y = heightRU x RU - y. One U scale and one origin for all four panes.
//
// So the two panes are mirror images of each other in X, and nothing else.
//
// WHICH OF A PART'S OWN DRAWINGS A PANE SHOWS. Every catalogue entry has a
// `left` and a `right` drawing, depth by height. A RIGHT drawing has the
// part's front at x = 0; a LEFT drawing has its rear at x = 0 (Portrayal
// docs/modelling-pitfalls.md, "Axes and views"). A part that looks out of the
// front of the rack shows the rack's left pane its own left side. One that
// looks out of the back (mounted on the rear, or turned) has been turned
// about the vertical, so its right side faces the rack's left: the pane shows
// its RIGHT drawing. Either way the drawing is placed as it is, never
// mirrored: a part's front in its own drawing is on the side its front is in
// the pane. A narrow part on the right rail is turned end over end in its
// face (solids.js itemPlacer `flip`): the pane shows its other side, turned
// half a turn in the pane.
//
// WHERE A PART IS IN DEPTH is the kit's rule (solids.js itemPlacer and
// zeroUPlacer, which are not exported): its envelope is placed here the same
// way, and tests/rack/side-view.test.mjs holds the two together over every
// case solidsOf places. Devices sit flush on their rail plane, as in 3D: the
// catalogue states no setback yet (Portrayal #908).

import {RU, SIDES} from '../../vendor/rack/rails.js';
import {railOf} from '../../vendor/rack/fit.js';
import {faceOfAt, zeroUX} from '../../vendor/rack/zero-u.js';
import {zeroUBottom} from '../../vendor/rack/model.js';

export const SIDE_PANES = ['left', 'right'];
const OTHER = {left: 'right', right: 'left'};
// The depth of an upright, behind its mounting face: the kit's (solids.js
// POST_D) and the 3D rack's post (rack3d.js), 34 mm.
export const POST_D = 34;

const railDepthOf = f => (f?.kind === 'two-post' ? 0 : Number(f?.railDepth) || 0);
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v));

/** Pane X of a depth z (rack mm), and pane Y of a height y. */
export const sideX = (pane, z) => (pane === 'right' ? 0 - z : z);
export const sideY = (frame, y) => frame.heightRU * RU - y;
/** A rack point {x, y, z} on a side pane: [X, Y]. */
export const project = (pane, frame, p) => [sideX(pane, p.z), sideY(frame, p.y)];

/** Where a placed item's envelope is, as solids.js itemPlacer places it:
 *  {z0, z1} its depth (rack mm, z0 <= z1), {x0, x1} across the rack,
 *  `zFront` where its own front is, `outward` +1 when it looks out of the
 *  front of the rack and -1 out of the back, `flip` when it is turned end
 *  over end in its face (a narrow part on the right rail). null without a
 *  depth. `c` is its catalogue entry. */
export function itemDepth(rack, it, c) {
  const d = num(c?.d), w = num(c?.w);
  if (!(d > 0)) return null;
  const rear = it.face === 'rear', turned = !!it.turned;
  const plane = rear ? -railDepthOf(rack.frame) : 0;
  let zFront, outward;
  if (c.mount === 'rack-face') { zFront = rear ? plane - d : plane + d; outward = rear ? -1 : 1; }
  else {
    outward = rear === turned ? 1 : -1;
    zFront = turned ? (rear ? plane + d : plane - d) : plane;
  }
  const zBack = zFront - outward * d;
  const rail = railOf(it, () => c);
  const left = rail ? (rail === 'left') === !rear : null;
  const cx = rail ? (left ? SIDES[0] : SIDES[1]).hole : 0;
  const half = w > 0 ? w / 2 : 0;
  return {z0: Math.min(zFront, zBack), z1: Math.max(zFront, zBack), x0: cx - half, x1: cx + half,
          zFront, outward, flip: rail === 'right'};
}

/** The same for a part beside the rack (solids.js zeroUPlacer): centred on
 *  its upright's depth, a rear upright's part looking rearward. */
export function zeroUDepth(rack, z, c) {
  const d = num(c?.d), w = num(c?.w);
  if (!(d > 0)) return null;
  const rear = faceOfAt(z.at) === 'rear';
  const zc = rear ? -railDepthOf(rack.frame) + POST_D / 2 : -POST_D / 2;
  const zFront = rear ? zc - d / 2 : zc + d / 2, outward = rear ? -1 : 1;
  const zBack = zFront - outward * d, cx = zeroUX(z, () => c), half = w > 0 ? w / 2 : 0;
  return {z0: Math.min(zFront, zBack), z1: Math.max(zFront, zBack), x0: cx - half, x1: cx + half,
          zFront, outward, flip: false, y0: (zeroUBottom(z) - 1) * RU};
}

/** Which of a part's own side drawings a pane shows, and whether it is
 *  turned half a turn in the pane (`turn`). */
export function shownSide(pane, {outward, flip}) {
  const swaps = (outward === -1 ? 1 : 0) + (flip ? 1 : 0);
  return {view: swaps % 2 ? OTHER[pane] : pane, turn: !!flip};
}

/** A part's box on a pane, in pane mm: {x, y, w, h}. `span` is itemDepth's or
 *  zeroUDepth's answer; `y0` and `h` the body's bottom above the floor and
 *  its height, in rack mm. */
export function sideBox(pane, frame, span, y0, h) {
  const a = sideX(pane, span.z0), b = sideX(pane, span.z1);
  return {x: Math.min(a, b), y: sideY(frame, y0 + h), w: Math.abs(b - a), h};
}

/** Where a side drawing `faceW` wide goes on the pane: the X of its own
 *  x = 0. A RIGHT drawing starts at the part's front and a LEFT one ends
 *  there, so a drawing wider or narrower than the catalogue's depth still
 *  has its front on the part's front. */
export function drawingX(pane, span, view, faceW) {
  const front = sideX(pane, span.zFront);
  // turned in the pane (a flipped part): its front is where the other drawing's would be
  const startsAtFront = (view === 'right') !== !!span.flip;
  return startsAtFront ? front : front - faceW;
}

/** How near a box is to the eye of a pane: larger is nearer. The left pane is
 *  looked at from beyond the rack's left side (x toward minus infinity). */
export const nearness = (pane, span) => (pane === 'left' ? -span.x0 : span.x1);
/** Is a part on the side of the rack a pane looks at? (A part beside the rack:
 *  one on the near side stands in front of the posts, one on the far side
 *  behind everything.) */
export const onNearSide = (pane, span) => (pane === 'left' ? span.x0 + span.x1 < 0 : span.x0 + span.x1 > 0);
/** Farthest first: the order to paint in, so a nearer body covers a farther one. Stable. */
export const paintOrder = (pane, list, spanOf = x => x.span) =>
  list.map((v, i) => [v, i]).sort((a, b) => nearness(pane, spanOf(a[0])) - nearness(pane, spanOf(b[0])) || a[1] - b[1]).map(([v]) => v);

/** The posts a side pane draws, in depth: [{at: 'front' | 'rear', z0, z1}].
 *  A four-post has a pair at each rail plane; a two-post one pair. Each
 *  stands behind its mounting face, toward the middle of the rack. */
export function postsOf(frame) {
  const out = [{at: 'front', z0: -POST_D, z1: 0}];
  const rd = railDepthOf(frame);
  if (frame?.kind !== 'two-post' && rd > 0) out.push({at: 'rear', z0: -rd, z1: -rd + POST_D});
  return out;
}

// mm in front of the front rail a pane always shows (a lacer's rings, the
// plugs and the cables' first legs), and round its extent on every side.
export const FRONT_ROOM = 160;
export const SIDE_PAD = 24;
/** The depth a side pane shows, in rack z: [zRear, zFront], zRear < 0 <
 *  zFront. The rack's own depth (frame.usableDepth, measured back from the
 *  front rail), FRONT_ROOM in front of it, and every span given (a part that
 *  stands out further, a cable's point), padded. */
export function depthExtent(frame, spans = []) {
  let lo = -(Number(frame?.usableDepth) || 0), hi = FRONT_ROOM;
  for (const s of spans) { if (s.z0 < lo) lo = s.z0; if (s.z1 > hi) hi = s.z1; }
  return [lo - SIDE_PAD, hi + SIDE_PAD];
}
/** The pane's viewBox x and width for a depth extent: the two panes get
 *  mirrored boxes of one width. */
export function paneSpanX(pane, [lo, hi]) {
  const a = sideX(pane, lo), b = sideX(pane, hi);
  return {x: Math.min(a, b), w: Math.abs(b - a)};
}

/** A list of rack points as an SVG path on a side pane, through every point
 *  in order (the kit's corners as they are: nothing is rounded or added).
 *  Points that fall on one another in the pane are one: a run along the
 *  rack's width is seen end on. '' for fewer than one point. */
export function projectedPath(pane, frame, points) {
  const out = [];
  for (const p of points) {
    const q = project(pane, frame, p), last = out.at(-1);
    if (last && Math.abs(last[0] - q[0]) < 1e-6 && Math.abs(last[1] - q[1]) < 1e-6) continue;
    out.push(q);
  }
  if (!out.length) return {d: '', points: out};
  const n = v => Math.round(v * 1000) / 1000;
  // a cable seen end on along its whole length is still a mark: a stroke of no length draws its round caps
  const pts = out.length === 1 ? [out[0], out[0]] : out;
  return {d: pts.map((q, i) => `${i ? 'L' : 'M'}${n(q[0])} ${n(q[1])}`).join(' '), points: out};
}

/** A BUNDLE'S MEMBER ALONG ITS RIDE, as the 3D scene packs it (scene3d.js
 *  kitPointsFor): the kit's points for the cable, each one on the trunk
 *  moved to the member's place in the pack there (bundle-view.js trunkLay
 *  `pack`), and the kit's points between two packed stops moved by what the
 *  stops were, in proportion. `points` are routePath's, `ws` the cable's
 *  resolved waypoints, `place` its stretch (memberPlaces), `lay` its bundle's
 *  lay, `centreOf(w, rt)` where a pack of radius rt is laid at a ring
 *  (scene3d.js stopCentre) or null, `width` the drawn cable's. A cable in no
 *  bundle comes back as it is. Plain {x, y, z}. */
export function packedPoints(id, points, ws, place, lay, centreOf = () => null, width = 3) {
  const pts = points.map(q => ({x: q.x, y: q.y, z: q.z}));
  if (!place || !lay || !ws?.length) return pts;
  const rides = n => n >= place.stretch[0] && n <= place.stretch[1];
  const r = width / 2, moved = new Map();
  const put = (k, v) => { moved.set(k, {x: v.x - points[k].x, y: v.y - points[k].y, z: v.z - points[k].z}); pts[k] = v; };
  let w = 0;
  points.forEach((q, k) => {
    if (q.at === 'lane') {
      while (w < ws.length && !ws[w].lane) w++;
      const o = w < ws.length && rides(w) ? lay.pack(id, lay.indexOf(ws[w])) : null;
      if (o) put(k, {x: q.x + o.x, y: q.y + o.y, z: q.z + o.z});
      w++;
      return;
    }
    if (!q.item || !q.via || q.at === 'lead') return;
    const n = ws.findIndex((x, m) => rides(m) && !x.lane && x.item === q.item && x.via === q.via);
    if (n < 0) return;
    const i = lay.indexOf(ws[n]), o = lay.pack(id, i), node = lay.at(i);
    if (!o || !node) return;
    const c = centreOf(ws[n], node.diameter / 2);
    const b = c ? c.at(q) : q;
    const v = {x: b.x + o.x, y: b.y + o.y, z: b.z + o.z};
    if (c) {
      const [lo, hi] = [c.box[`${c.across}0`] + r, c.box[`${c.across}1`] - r];
      if (lo <= hi) v[c.across] = Math.min(hi, Math.max(lo, v[c.across]));
      if (c.box.y0 + r <= c.box.y1 - r) v.y = Math.min(c.box.y1 - r, Math.max(c.box.y0 + r, v.y));
    }
    put(k, v);
  });
  const packed = [...moved.keys()].sort((a, b) => a - b);
  for (let n = 0; n + 1 < packed.length; n++) {
    const [i, j] = [packed[n], packed[n + 1]], a = moved.get(i), b = moved.get(j);
    for (let k = i + 1; k < j; k++) {
      if (points[k].at === 'lead') continue;
      const t = (k - i) / (j - i);
      pts[k] = {x: pts[k].x + a.x + (b.x - a.x) * t, y: pts[k].y + a.y + (b.y - a.y) * t, z: pts[k].z + a.z + (b.z - a.z) * t};
    }
  }
  return pts;
}

/** A strap's bar on a pane: across the run from `p` to `q` (pane points), `f`
 *  of the way along, reaching `half` each side. null when the run is seen end
 *  on (no length in the pane: there is no "across" to draw). */
export function strapBar(p, q, f, half) {
  const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
  if (!(len > 1e-6)) return null;
  const dir = [(q[0] - p[0]) / len, (q[1] - p[1]) / len], n = [-dir[1], dir[0]];
  const c = [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f];
  return {x1: c[0] - n[0] * half, y1: c[1] - n[1] * half, x2: c[0] + n[0] * half, y2: c[1] + n[1] * half, at: c};
}
