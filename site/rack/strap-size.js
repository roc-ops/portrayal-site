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
//                    that would make the whole bar, its rim included, over
//                    twice the pack's width: then twice the pack's width
//                    (and never under its true length: a pack under 4 mm,
//                    one cable, has a bar of its width and the margins).
//   ALONG THE RUN    the strap's real width at scale (STRAP_DRAWN), on screen
//                    never under STRAP_MIN_PX.
//
// WHERE THE PACK IS, IS THE CABLES' OWN LINES. A cable's line runs straight
// between the stops its own route has, which is not always the trunk's line:
// a bar placed by the trunk sat up to 5 mm off the cables it ties. So a strap
// is put across its riders where their lines cross it (lineSpan), from the
// points each cable is drawn through; nothing is read back off the drawing.
// A rider with no line there is left out; with none, the lay's own places
// stand (packSpan).
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
 *  out: then its true size), `rimPx` what the rim adds to a bar's length on
 *  screen. {true, least, rimTrue, rimLeast}: the bar at scale and the bar that
 *  is never under the least size on screen, and the rim round each. No bar,
 *  rim included, is over `most` packs long unless its true length is. */
export function strapLengths(pack, scale, {margin = STRAP_MARGIN, minPx = STRAP_MIN_PX, most = STRAP_MOST, rimPx = 2} = {}) {
  const real = pack + 2 * margin;
  if (!(scale > 0)) return {true: real, least: real, rimTrue: real, rimLeast: real};
  const rim = rimPx / scale, cap = Math.max(real, most * pack);
  const least = Math.max(real, Math.min(minPx / scale, most * pack - rim));
  return {true: real, least, rimTrue: Math.min(real + rim, cap), rimLeast: Math.min(least + rim, cap)};
}

/** THE PACK OFF ITS CABLES' LINES: `lines` are the riders' lines as the
 *  points each is drawn through ([[x, y], ...]), `c` and `n` the strap's
 *  middle and the unit vector across the run, `width` a cable's drawn width,
 *  `reach` how far across the run a rider may be (the trunk's half-width and
 *  some). Each line is cut where it crosses the strap's own line, nearest the
 *  strap. {lo, hi, riders: how many were found} along `n` from `c`, or null when none crosses. */
export function lineSpan(lines, c, n, width, reach) {
  const d = [-n[1], n[0]], at = [];
  const along = q => (q[0] - c[0]) * d[0] + (q[1] - c[1]) * d[1], across = q => (q[0] - c[0]) * n[0] + (q[1] - c[1]) * n[1];
  for (const pts of lines ?? []) {
    let best = null;
    for (let k = 0; k + 1 < pts.length; k++) {
      const s0 = along(pts[k]), s1 = along(pts[k + 1]);
      if ((s0 > 0 && s1 > 0) || (s0 < 0 && s1 < 0) || s0 === s1) continue;
      const a0 = across(pts[k]), a = a0 + (across(pts[k + 1]) - a0) * (s0 / (s0 - s1));
      if (Math.abs(a) <= reach && (best == null || Math.abs(a) < Math.abs(best))) best = a;
    }
    if (best != null) at.push(best);
  }
  return at.length ? {lo: Math.min(...at) - width / 2, hi: Math.max(...at) + width / 2, riders: at.length} : null;
}

const GEOM = new WeakMap();
/** What sizeStraps needs of a strap's group: {c: [x, y], n: [x, y], lo, hi} (lineSpan's or packSpan's, about `c` along `n`). */
export function noteStrap(g, geom) { GEOM.set(g, geom); }
export const strapNote = g => GEOM.get(g) ?? null;

// A QUIET STRAP ON THE PAGE (S-0040). In 2D a strap is a thin band on the
// bundle, not a block beside it. The drawing's own strokes are the paper's
// (a sheet and the files keep them); on the page the strap is sized here and
// painted by rack.css (stage.js STRAP_PAINT_2D): narrower along the run
// (PAGE_ALONG of the true width), a least size of PAGE_MIN_PX, a margin of 1 mm
// past the pack, at most 1.5 packs long, and a hairline rim.
export const PAGE_ALONG = 0.6;
export const PAGE_MIN_PX = 5;
export const PAGE_RIM_PX = 1;
export const PAGE_STRAP = {margin: 1, minPx: PAGE_MIN_PX, most: 1.5, rimPx: PAGE_RIM_PX};

// The strokes' widths for the page, from the paper's (kept once in data-w0).
function quietWidths(g) {
  for (const line of g.querySelectorAll('line')) {
    const least = line.hasAttribute('data-strap-least'), rim = line.dataset.strapPart === 'rim';
    if (line.dataset.w0 == null) line.dataset.w0 = line.getAttribute('stroke-width');
    const core = least ? PAGE_MIN_PX : Number(line.dataset.w0) * PAGE_ALONG;
    // the rim of the true bar is read off its core's true width, the paper's own rim being 1.6 wider
    const trueCore = rim && !least ? (Number(line.dataset.w0) - 1.6) * PAGE_ALONG : core;
    line.setAttribute('stroke-width', String(n3(rim ? (least ? PAGE_MIN_PX : trueCore) + PAGE_RIM_PX : core)));
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
      quietWidths(g);
      const geom = GEOM.get(g);
      if (!geom) continue;
      const {c, n, lo, hi} = geom, mid = (lo + hi) / 2, len = strapLengths(hi - lo, scale, PAGE_STRAP);
      g.dataset.strapPack = String(n3(hi - lo));
      for (const line of g.querySelectorAll('line')) {
        const least = line.hasAttribute('data-strap-least'), rim = line.dataset.strapPart === 'rim';
        // the rim shows a pixel past the core at each end of the bar, as it does along its sides, where the cap leaves room
        const half = (rim ? (least ? len.rimLeast : len.rimTrue) : least ? len.least : len.true) / 2;
        line.setAttribute('x1', String(n3(c[0] + n[0] * (mid - half)))); line.setAttribute('y1', String(n3(c[1] + n[1] * (mid - half))));
        line.setAttribute('x2', String(n3(c[0] + n[0] * (mid + half)))); line.setAttribute('y2', String(n3(c[1] + n[1] * (mid + half))));
        // a square cap would add the bar's own width to its length: the least bar is cut to its length
        if (least) line.setAttribute('stroke-linecap', 'butt');
      }
    }
  }
}
