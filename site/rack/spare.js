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
// ONE ROUNDING RULE, THE KIT'S. Every figure is said to the nearest
// centimetre (or 0.01 ft), as the kit says its own (slack.js mText, and the
// cable schedule's `spare` cell): the list, the hover label, the assistant's
// text and the schedule then give one figure for one cord. This page once
// rounded a spare down and a need up, so that no row flattered a cord; the
// schedule rounds, and a cord read 0.38 m on the page and 0.39 in the file.
// The cost is at the edge: a cord a few millimetres under its need reads
// "0 m short", with the need at the same figure as the cord.
const r2 = x => Math.round(x * 100) / 100;

// THE KIT'S ANSWER, ASKED ONCE FOR A ROUTE CONTEXT, A RACK AND A CABLE OBJECT
// (portrayal-site#192): the kit lays the cable each time it is asked, and the
// list, the hover label and an assistant's inspect all ask. A context is made
// once for a reading of a rack and never changed (route-context.js), and a
// rack and a cable are never changed in place, so the kit's answer for the
// same three objects is the same. null where the kit has none, or throws.
// (kept for each of the three: the page asks of the rack the routes were read
// from and an assistant's inspect of the rack as it is, and a cable neither
// changed is one object in both)
const kitSpares = new WeakMap();   // route context -> WeakMap(cable object -> WeakMap(rack object -> {k}))
function kitSpare(rack, cable, routeCtx) {
  let per = kitSpares.get(routeCtx);
  if (!per) kitSpares.set(routeCtx, per = new WeakMap());
  let byRack = per.get(cable);
  if (!byRack) per.set(cable, byRack = new WeakMap());
  const had = byRack.get(rack);
  if (had) return had.k;
  let k = null;
  try { k = kitSpareOf(rack, cable, routeCtx); } catch { k = null; }
  byRack.set(rack, {k});
  return k;
}

/** A cable's spare by a route context, or null when it cannot be said: no
 *  context, no length on the cable, a length in a unit other than m or ft, or
 *  no path (the kit's spareOf answers null).
 *  {value, unit}: the cord as the row says it (a pinned length as it was
 *  entered; a routed one as the stock size the kit gives for the route now);
 *  cord, need, spare, endPlay, toStore: the kit's stock_m, need_m, spare_m,
 *  end_play_m and to_store_m, in metres; pinned: the kit's; needs: the kit's
 *  need when a pinned cord is under it, else null. */
export function spareFor(rack, cable, routeCtx, read = null) {
  if (!cable || !routeCtx) return null;
  const cord = lengthParts(cable.length);
  if (!cord || !Object.hasOwn(M_PER, cord.unit)) return null;
  // ASKED OF THE RACK THE ROUTES WERE READ FROM, where that is the same
  // question (`read`: {rack, cable}, from sparesOf). The kit keeps which lay
  // of a cable it chose per rack object and cable object, and lays a cable
  // from both ends the first time it is asked of a new one. The page's rack is
  // a new object once its routed lengths are written, with a new object for
  // each cable whose length was; nothing a route or a spare reads has moved.
  const k = read ? kitSpare(read.rack, read.cable, routeCtx) : kitSpare(rack, cable, routeCtx);
  if (!k) return null;
  const own = k.pinned ? {value: cord.value, unit: cord.unit} : {value: k.stock_m, unit: 'm'};
  return {...own, cord: k.stock_m, need: k.need_m, spare: k.spare_m, endPlay: k.end_play_m, toStore: k.to_store_m,
          pinned: k.pinned, needs: k.pinned && k.spare_m < -1e-9 ? k.need_m : null};
}


/** Every cable's spare, by id, by the route context the page read for the
 *  rack (route-context.js routeFacts' `ctx`). A cable with a loose end is left
 *  out: it is not drawn along its path. The caller hands no context when the
 *  ends could not be checked. */
export function sparesOf(rack, routeCtx, isLoose = () => false, readRack = null) {
  const out = new Map();
  if (!routeCtx) return out;
  const was = new Map(readRack && readRack !== rack ? (readRack.cables || []).map(c => [c.id, c]) : []);
  for (const c of rack.cables || []) {
    if (isLoose(c.a) || isLoose(c.b)) continue;
    const w = was.get(c.id);
    const s = spareFor(rack, c, routeCtx, w && sameQuestion(w, c) ? {rack: readRack, cable: w} : null);
    if (s) out.set(c.id, s);
  }
  return out;
}
// Whether the kit's spareOf answers the same for two objects of one cable:
// everything a route or a spare reads is the same object or value, and the
// length is the same, or is a routed one on both (the kit reads a routed
// length from the path, never from the cable) or absent on one.
const routedOrNone = l => !l || l.source === 'routed';
const sameQuestion = (w, c) => w === c || (w.a === c.a && w.b === c.b && w.media === c.media && w.type === c.type
  && w.route === c.route && w.routeEdited === c.routeEdited && w.slack === c.slack && w.lay === c.lay && w.straps === c.straps
  && w.lengthAsWritten === c.lengthAsWritten && (w.length === c.length || (routedOrNone(w.length) && routedOrNone(c.length))));

/** sparesOf's `isLoose`, from cableFacts' ends (endKey -> {info, reason}). */
export const looseIn = ends => e => ends?.get(endKey(e))?.reason != null;

// A length of `metres` in the cord's own unit, to the centimetre (or 0.01 ft).
const isShort = s => s.spare < -1e-9;
/** "0.57 m": the spare alone, or the shortfall, in the cord's unit, to the nearest hundredth. */
export const spareAmount = s => `${r2(Math.abs(s.spare) / M_PER[s.unit])} ${s.unit}`;
/** "1 m cord, 0.57 m spare"; a cord under what its route needs reads "0.3 m
 *  cord, 0.18 m short". */
export const spareText = s => `${s.value} ${s.unit} cord, ${spareAmount(s)} ${isShort(s) ? 'short' : 'spare'}`;
/** "the route needs 0.68 m", in the cord's own unit, when a pinned length is
 *  under the kit's need, else null. */
export const needsText = s => (s.needs == null ? null : `the route needs ${r2(s.needs / M_PER[s.unit])} ${s.unit}`);
/** The cable list's one line of explanation. */
export const SPARE_HELP = 'The drawing shows each cable\'s path. A cord\'s spare is listed here and is not drawn.';
