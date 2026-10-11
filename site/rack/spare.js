// site/rack/spare.js
// A CORD'S SPARE: how much of a cable is left once it is routed and plugged
// in. The page draws the path a cable takes between its ports and nothing
// else, so a 0.5 m cord and a 1 m cord on the same path look alike. Until
// stored slack is drawn (Portrayal #949 step 4), the page says the figure.
//
//   spare = the cord's length - (the path's length + what each end takes)
//
// THE CORD'S LENGTH is the cable's own: the stock size the kit rounded its
// routed length up to (route.js stockLength), or the length a person entered.
// THE PATH'S LENGTH is the kit's (route.js pathLength over routePath's points).
// WHAT EACH END TAKES is the kit's sourced table, END_ALLOWANCE_BY_MEDIA: what
// is physically there and not in the path (the part of the plug inside the
// port, half of a maker's minus tolerance).
//
// The kit's `measured` length adds one thing more at each end, a dressing
// allowance (0.1 m in kit 0.16.0, route.js DRESSING_ALLOWANCE). It is there so
// that a routed cord is bought with something to dress it by: it is slack, not
// cable the route uses, so it counts as spare here. The kit does not export
// it; it is read as what endAllowance adds on top of the table, so the day the
// kit drops it (step 4 of #949) this module follows with no edit.
//
// NOT THE KIT'S `slack`. queries.js inspect reports `slack` only for a cable
// whose length was entered, as that length less the routed one, dressing
// allowance included. A routed cable, which is most of them, gets none. The
// two differ by the dressing allowance at both ends; agent-text.js says both.
//
// Nothing here measures, routes or stores: every number comes from the kit's
// path and the cable's own length.

import {endAllowance, pathLength, routePath, END_ALLOWANCE_BY_MEDIA} from '../../vendor/rack/route.js';
import {lengthParts, endKey} from '../../vendor/rack/cable-rules.js';

const M_PER = {m: 1, ft: 0.3048};
const round2 = x => Math.round(x * 100) / 100;

/** What the kit adds at each end beyond its sourced table, in metres. */
export function dressingAllowance() {
  const media = Object.keys(END_ALLOWANCE_BY_MEDIA)[0];
  return Math.max(0, endAllowance({media}) - END_ALLOWANCE_BY_MEDIA[media]);
}

/** What a routed cable uses of its cord, in metres: its path and what each
 *  end takes. Null for no path. */
export function usedMetres(path) {
  const len = pathLength(path);
  return len && Number.isFinite(len.measured) ? len.measured - 2 * dressingAllowance() : null;
}

/** A cable's spare, or null when it cannot be said: no path (not routed), no
 *  usable length, or a length in a unit other than m or ft.
 *  {value, unit}: the cord as the cable has it; cord, used, spare: metres;
 *  large: the spare is more than half the cord. */
export function spareOf(cable, path) {
  const cord = lengthParts(cable?.length);
  if (!cord || !Object.hasOwn(M_PER, cord.unit)) return null;
  const used = usedMetres(path);
  if (used == null) return null;
  const metres = cord.value * M_PER[cord.unit];
  const spare = metres - used;
  return {value: cord.value, unit: cord.unit, cord: metres, used, spare, large: spare > metres / 2};
}

/** Every cable's spare, by id: `paths` is route-context.js routeFacts' Map.
 *  A cable with a loose end is left out: it is not drawn along its path. */
export function sparesOf(rack, paths, isLoose = () => false) {
  const out = new Map();
  if (!paths) return out;
  for (const c of rack.cables || []) {
    if (isLoose(c.a) || isLoose(c.b)) continue;
    const s = spareOf(c, paths.get(c.id));
    if (s) out.set(c.id, s);
  }
  return out;
}
/** One cable's spare by a route context (the agent's inspect): the kit's path
 *  for it, read as the page's routes are. A reader that fails is no spare. */
export function spareFor(rack, cable, routeCtx) {
  if (!cable || !routeCtx) return null;
  try { return spareOf(cable, routePath(rack, cable, routeCtx)); } catch { return null; }
}
/** sparesOf's `isLoose`, from cableFacts' ends (endKey -> {info, reason}). */
export const looseIn = ends => e => ends?.get(endKey(e))?.reason != null;

// A length of `metres` in the cord's own unit, to the centimetre (or 0.01 ft).
const amount = (s, metres) => `${round2(Math.abs(metres) / M_PER[s.unit])} ${s.unit}`;
/** "0.58 m": the spare alone, in the cord's unit. */
export const spareAmount = s => amount(s, s.spare);
/** "1 m cord, 0.58 m spare"; a cord shorter than what its route uses reads
 *  "0.5 m cord, 0.12 m short". */
export const spareText = s => `${s.value} ${s.unit} cord, ${spareAmount(s)} ${round2(s.spare / M_PER[s.unit]) < 0 ? 'short' : 'spare'}`;
/** The sentence for a cord whose spare is more than half of it, else null. */
export const undrawnText = s => (s.large ? `${spareAmount(s)} of this cord is not drawn: the picture shows its path only.` : null);
/** The cable list's one line of explanation. */
export const SPARE_HELP = 'The drawing shows each cable\'s path. A cord\'s spare is listed here; where it is stored is not drawn yet.';
