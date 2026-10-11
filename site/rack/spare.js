// site/rack/spare.js
// A CORD'S SPARE, IN THE PAGE'S WORDS. The page draws the path a cable takes
// between its ports and nothing else, so a 0.5 m cord and a 1 m cord on the
// same path look alike. Spare is recorded and listed, not drawn (rack file
// version 4, Portrayal #949 step 4; drawing it is #1011), so the page says
// the figure.
//
// EVERY FIGURE IS THE KIT'S (kit 0.22.0: rack/route.js spareOf). It names a
// cable's lengths:
//
//   need      the path, what is inside the two ports, and how much shorter
//             than its nominal length a maker lets the cord be: what the cord
//             must at least be;
//   stock     the length bought: the one a person pinned, or the size the kit
//             chose for the need and the end play;
//   spare     stock less need: real cable, and it is somewhere;
//   end play  the part of the spare that stays in the curves into the two
//             ports (END_PLAY_M an end) and is never stored.
//
// Until 0.22.0 this module worked the spare out itself: the cord less the
// kit's `measured`, with a dressing allowance added back that it read as what
// `endAllowance` held on top of the kit's table. The kit moved that allowance
// out of `endAllowance` and named it end play, so the same sum would have read
// 0 for it and said 0.2 m less spare for every cord. Nothing here derives a
// length now: this module turns the kit's record into the row's words.
//
// A CORD SHORTER THAN THE ROUTE NEEDS is a length a person pinned (any source
// but `routed`: entered, read from a DCIM) that is under the kit's `need`: it
// does not reach. The cable says so: `needs`, the kit's need. A pinned cord
// that meets the need with less than the end play to spare is not short: it
// reaches, and its row says how little it has.
//
// Nothing here measures, routes or stores.

import {spareOf as kitSpareOf} from '../../vendor/rack/route.js';
import {lengthParts, endKey} from '../../vendor/rack/cable-rules.js';

const M_PER = {m: 1, ft: 0.3048};
// ROUNDING NEVER FLATTERS THE CORD. Figures are said to the centimetre (or
// 0.01 ft). A spare is rounded DOWN, a shortfall UP and a route's need UP, so
// no row says two figures that only rounding makes agree: a 0.62 m cord under
// a need of 0.6232 m reads "needs 0.63 m", never "needs 0.62 m", and its
// spare of 0.1968 m reads 0.19, never the 0.2 that would be dressing room.
// The hair taken off before rounding keeps a figure that is exact in decimal
// (0.3 m, 1 m) from moving a whole step on float noise.
const HAIR = 1e-6;
const down2 = x => Math.floor(x * 100 + HAIR) / 100;
const up2 = x => Math.ceil(x * 100 - HAIR) / 100;

/** A cable's spare by a route context, or null when it cannot be said: no
 *  context, no length on the cable, a length in a unit other than m or ft, or
 *  no path (the kit's spareOf answers null).
 *  {value, unit}: the cord as the row says it (a pinned length as it was
 *  entered; a routed one as the stock size the kit gives for the route now);
 *  cord, need, spare, endPlay, toStore: the kit's stock_m, need_m, spare_m,
 *  end_play_m and to_store_m, in metres; pinned: the kit's; needs: the kit's
 *  need when a pinned cord is under it, else null. */
export function spareFor(rack, cable, routeCtx) {
  if (!cable || !routeCtx) return null;
  const cord = lengthParts(cable.length);
  if (!cord || !Object.hasOwn(M_PER, cord.unit)) return null;
  let k = null;
  try { k = kitSpareOf(rack, cable, routeCtx); } catch { k = null; }
  if (!k) return null;
  const own = k.pinned ? {value: cord.value, unit: cord.unit} : {value: k.stock_m, unit: 'm'};
  return {...own, cord: k.stock_m, need: k.need_m, spare: k.spare_m, endPlay: k.end_play_m, toStore: k.to_store_m,
          pinned: k.pinned, needs: k.pinned && k.spare_m < -1e-9 ? k.need_m : null};
}

/** Every cable's spare, by id, by the route context the page read for the
 *  rack (route-context.js routeFacts' `ctx`). A cable with a loose end is left
 *  out: it is not drawn along its path. The caller hands no context when the
 *  ends could not be checked. */
export function sparesOf(rack, routeCtx, isLoose = () => false) {
  const out = new Map();
  if (!routeCtx) return out;
  for (const c of rack.cables || []) {
    if (isLoose(c.a) || isLoose(c.b)) continue;
    const s = spareFor(rack, c, routeCtx);
    if (s) out.set(c.id, s);
  }
  return out;
}
/** sparesOf's `isLoose`, from cableFacts' ends (endKey -> {info, reason}). */
export const looseIn = ends => e => ends?.get(endKey(e))?.reason != null;

// A length of `metres` in the cord's own unit, to the centimetre (or 0.01 ft).
const isShort = s => s.spare < -1e-9;
/** "0.57 m": the spare alone (rounded down), or the shortfall (rounded up), in the cord's unit. */
export const spareAmount = s => `${isShort(s) ? up2(-s.spare / M_PER[s.unit]) : down2(Math.max(0, s.spare) / M_PER[s.unit])} ${s.unit}`;
/** "1 m cord, 0.57 m spare"; a cord under what its route needs reads "0.3 m
 *  cord, 0.18 m short". */
export const spareText = s => `${s.value} ${s.unit} cord, ${spareAmount(s)} ${isShort(s) ? 'short' : 'spare'}`;
/** "the route needs 0.68 m", in the cord's own unit, when a pinned length is
 *  under the kit's need, else null. */
export const needsText = s => (s.needs == null ? null : `the route needs ${up2(s.needs / M_PER[s.unit])} ${s.unit}`);
/** The cable list's one line of explanation. */
export const SPARE_HELP = 'The drawing shows each cable\'s path. A cord\'s spare is listed here and is not drawn.';
