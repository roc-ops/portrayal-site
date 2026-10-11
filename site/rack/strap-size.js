// A STRAP'S SIZE ON A PANE (portrayal-site#190). A strap is a bar across its
// bundle's pack. It was drawn as long as the pack's diameter wherever it sat,
// and never under STRAP_MIN_PX on screen either way: on a diagonal run or a
// fan the members lie closer across the run than the diameter says, and at
// Fit on a 42U rack the least size made a strap on a thin pack several times
// as long as the pack is wide. The rule, the same on a straight stretch and a
// diagonal one:
//
//   ACROSS THE PACK  the pack's own width where the strap is (the members
//                    there, measured square across the run) plus STRAP_MARGIN
//                    each side; on screen never under STRAP_MIN_PX, unless
//                    that is over twice the pack's width: then twice the
//                    pack's width (and never under its true length).
//   ALONG THE RUN    the strap's real width at scale (STRAP_DRAWN), on screen
//                    never under STRAP_MIN_PX.
//
// WHERE THE PACK IS, IS READ OFF THE STROKES. A cable's drawn line is eased
// round its corners and runs straight between the stops its own route has,
// so it is not always where the trunk's own line is: a bar placed by the
// trunk sat up to 5 mm off the cables it ties. So the page measures each
// strap's members where their strokes cross the strap's line (fitStraps), and
// the bar is put across those. A member with no stroke there (not drawn on
// this pane) is left out; with none, the trunk's own figure stands.
//
// THE PAGE'S, NOT THE DRAWING'S. The least sizes are a matter of screen pixels,
// so they follow the zoom: sizeStraps is run after the cables are drawn and
// again whenever the zoom or the window changes, and only moves the ends of
// the lines already there. What it needs of each strap (where the pack is,
// square across the run) is kept beside the element, not on it (noteStrap), so
// a sheet, which is drawn by the same code away from the page, is the file it
// was. Size only: nothing is redrawn.

import {STRAP_DRAWN} from './bundle-view.js';
import {STRAP_MIN_PX} from './stage.js';

// mm a strap reaches past the pack, each side.
export const STRAP_MARGIN = 2;
// The most the least size may make of a strap: this many times its pack's width.
export const STRAP_MOST = 2;

/** THE PACK, SQUARE ACROSS THE RUN: `points` are its members' centres where
 *  the strap is, `c` the strap's middle as drawn, `n` the unit vector across
 *  the run, `width` a cable's drawn width, and `most` the pack's diameter
 *  there (no member is drawn outside it). {lo, hi}: the pack's two edges
 *  along `n`, from `c`. With no member, the diameter about `c`. */
export function packSpan(points, c, n, width, most) {
  const at = (points ?? []).map(p => (p[0] - c[0]) * n[0] + (p[1] - c[1]) * n[1]);
  if (!at.length) return {lo: -most / 2, hi: most / 2};
  const lo = Math.min(...at) - width / 2, hi = Math.max(...at) + width / 2;
  // (a pack is never wider than its diameter; the members' own places are the kit's lay, to a rounding)
  const over = (hi - lo) - most;
  return over > 0 ? {lo: lo + over / 2, hi: hi - over / 2} : {lo, hi};
}

/** A strap's lengths across its pack, in the pane's units: `pack` the pack's
 *  width there, `scale` screen pixels a unit (0 when the pane is not laid
 *  out: then its true size). {true, least}: the bar at scale, and the bar
 *  that is never under the least size on screen. */
export function strapLengths(pack, scale, {margin = STRAP_MARGIN, minPx = STRAP_MIN_PX, most = STRAP_MOST} = {}) {
  const real = pack + 2 * margin;
  if (!(scale > 0)) return {true: real, least: real};
  return {true: real, least: Math.max(real, Math.min(minPx / scale, most * pack))};
}

/** THE PACK OFF ITS STROKES: `lines` are the members' drawn lines as points
 *  ([[x, y], ...] each, close together), `c` and `n` the strap's middle and
 *  the unit vector across the run, `width` a cable's drawn width, `reach` how
 *  far across the run a member may be (the trunk's own half-width and some).
 *  {lo, hi, n: members found} along `n` from `c`, or null when none crosses. */
export function strokeSpan(lines, c, n, width, reach) {
  const d = [-n[1], n[0]], at = [];
  for (const pts of lines ?? []) {
    let best = null;
    for (const q of pts) {
      const a = (q[0] - c[0]) * n[0] + (q[1] - c[1]) * n[1];
      if (Math.abs(a) > reach) continue;
      const along = Math.abs((q[0] - c[0]) * d[0] + (q[1] - c[1]) * d[1]);
      if (best == null || along < best.along) best = {along, a};
    }
    // on the strap's line, to within the spacing of the points
    if (best && best.along <= 0.75) at.push(best.a);
  }
  return at.length ? {lo: Math.min(...at) - width / 2, hi: Math.max(...at) + width / 2, n: at.length} : null;
}

const GEOM = new WeakMap();
/** What the page needs of a strap's group: {c: [x, y], n: [x, y], lo, hi} (packSpan's, about `c` along `n`), and
 *  `members`, the cables that ride the stretch it is on. */
export function noteStrap(g, geom) { GEOM.set(g, geom); }
export const strapNote = g => GEOM.get(g) ?? null;

// A cable's drawn line as points a millimetre apart, read once for each drawing of it.
const LINES = new WeakMap();
function lineOf(path) {
  if (!LINES.has(path)) {
    const L = path.getTotalLength(), pts = [];
    for (let t = 0; t <= L; t += 1) { const q = path.getPointAtLength(t); pts.push([q.x, q.y]); }
    LINES.set(path, pts);
  }
  return LINES.get(path);
}
/** Put every strap on `svgs` across its members as they are drawn there
 *  (strokeSpan). Run once after the cables are drawn; sizeStraps then sizes
 *  them. `width` is a cable's drawn width. */
export function fitStraps(svgs, width = 3) {
  for (const svg of svgs ?? []) {
    if (!svg?.querySelectorAll) continue;
    for (const g of svg.querySelectorAll('[data-strap]')) {
      const geom = GEOM.get(g);
      if (!geom || geom.fitted) continue;
      // (the members that ride the stretch the strap is on: one that has left the bundle may pass close by)
      const lines = (geom.members ?? (g.dataset.members || '').split(' ').filter(Boolean))
        .map(id => svg.querySelector(`[data-cables] [data-cable][data-cable-id="${CSS.escape(id)}"] path:last-of-type`)).filter(Boolean).map(lineOf);
      const span = strokeSpan(lines, geom.c, geom.n, width, (geom.hi - geom.lo) / 2 + 12);
      GEOM.set(g, {...geom, ...(span ? {lo: span.lo, hi: span.hi} : {}), fitted: true});
    }
  }
}

const n3 = v => Math.round(v * 1000) / 1000;
/** Size every strap on `svgs` for the scale each pane is shown at. */
export function sizeStraps(svgs) {
  for (const svg of svgs ?? []) {
    if (!svg?.querySelectorAll) continue;
    const vb = svg.viewBox?.baseVal, w = svg.getBoundingClientRect().width;
    const scale = vb?.width > 0 && w > 0 ? w / vb.width : 0;
    for (const g of svg.querySelectorAll('[data-strap]')) {
      const geom = GEOM.get(g);
      if (!geom) continue;
      const {c, n, lo, hi} = geom, mid = (lo + hi) / 2, len = strapLengths(hi - lo, scale);
      g.dataset.strapPack = String(n3(hi - lo));
      for (const line of g.querySelectorAll('line')) {
        const least = line.hasAttribute('data-strap-least'), rim = line.dataset.strapPart === 'rim';
        // the rim shows a pixel past the core at each end of the bar, as it does along its sides
        const half = ((least ? len.least : len.true) + (rim && scale > 0 ? 2 / scale : 0)) / 2;
        line.setAttribute('x1', String(n3(c[0] + n[0] * (mid - half)))); line.setAttribute('y1', String(n3(c[1] + n[1] * (mid - half))));
        line.setAttribute('x2', String(n3(c[0] + n[0] * (mid + half)))); line.setAttribute('y2', String(n3(c[1] + n[1] * (mid + half))));
        // a square cap would add the bar's own width to its length: the least bar is cut to its length
        if (least) line.setAttribute('stroke-linecap', 'butt');
      }
    }
  }
}
