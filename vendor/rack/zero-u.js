// kit/rack/zero-u.js
// ZERO-U PARTS: WHAT STANDS BESIDE THE RACK (#926). Pure, like fit.js.
//
// A zero-U part takes no rack unit. It lives in `rack.zeroU`, never in
// `items` (model.js zeroUOf has the entry's shape), stands at an attachment
// point of the frame (`at`), and is fitted by fit.js fitsZeroU. Which mounts
// are zero-U parts is fit.js ZERO_U_MOUNTS: `rack-side` today, the vertical
// cable managers; a zero-U PDU is placed the same way. The commands that
// place, move and remove one are `zerou.*` in commands.js.
//
// This file holds what the drawings, the routes and the exports ask of one:
// where it is, as words and as x; whether a cable lane runs through it; and
// each placeable entry with what a drawing needs.

import {RU, RAIL_W, OPENING} from './rails.js';
import {isZeroUPart, zeroUUnits, zeroUTouched, zeroUSpanText, notBracket} from './fit.js';
import {zeroUOf, zeroUBottom, zeroUById, zeroUOffset, holdersOf, uLabel} from './model.js';
import {configFacts} from './catalog.js';

// The gap between a part and the upright it stands against: no source
// dimensions it (the FS ducts' `bracket-stand-off` gap), so it is drawn against
// the upright's outer face.
export const STANDOFF = 0;

// The side of the rack an attachment point is on, and the face of a four-post
// it is on (null on a two-post, whose one pair of uprights both panes see).
export const sideOfAt = at => (String(at).startsWith('right') ? 'right' : 'left');
export const faceOfAt = at => /-(front|rear)$/.exec(String(at))?.[1] ?? null;

export const zeroUName = (z, chassisOf) => z.label || chassisOf(z.ref)?.model || z.ref;
// "beside the rack at left, U1-U45", or "between racks at ...".
export const whereText = (rack, z, chassisOf) =>
  `${z.between ? 'between racks' : 'beside the rack'} at ${z.at}, ${zeroUSpanText(rack.frame, z, chassisOf)}`;
// WHERE A PART THAT HANGS ON BRACKETS IS, for an export (`heldBy: {parts}`):
// "on 2 FS-PDUBK brackets at left-rear, from U4", the unit that of the
// lowest. The brackets are named by model when they are all one, and a
// holder that is no longer beside the rack is not counted. null for a part
// that hangs on none.
export function hungText(rack, z, chassisOf) {
  const on = holdersOf(z).map(id => zeroUOf(rack).find(o => o.id === id)).filter(Boolean);
  if (!on.length) return null;
  const models = [...new Set(on.map(o => chassisOf(o.ref)?.model || o.ref))];
  const low = Math.min(...on.map(zeroUBottom));
  return `on ${on.length} ${models.length === 1 ? `${models[0]} ` : ''}bracket${on.length === 1 ? '' : 's'} at ${z.at}, from U${uLabel(rack.frame, low)}`;
}

// Each zero-U part the catalogue knows as one, with what a drawing or an
// export needs: its bottom U (`ru`), the units it runs beside (`u`), and its
// chassis width and drawn height in mm. An entry of another shape, or whose
// part is not a zero-U part, is not listed: an export says it is left out
// (export-data.js rackNotes).
export function zeroUEntries(rack, chassisOf) {
  return zeroUOf(rack).filter(z => isZeroUPart(chassisOf(z.ref))).map(z => {
    const c = chassisOf(z.ref), u = zeroUUnits(c);
    return {id: z.id, ref: z.ref, cfg: z.cfg || c.default || '', label: zeroUName(z, chassisOf), at: z.at,
            between: z.between === true, ru: zeroUBottom(z), u, w: Number(c.w) || 0,
            h: Number(c.h) || u * RU, mount: c.mount};
  });
}

// ── lanes through a part ─────────────────────────────────────────────────
// The cable lane beside an upright runs through a zero-U part standing there
// when the part is a pathway (it declares guides, as a duct does): a lane
// waypoint at a U the part spans is in its channel, at its centre line. A part
// that is no pathway (a PDU) leaves the lane where it was, in the gutter.
export const carriesLane = c => isZeroUPart(c) && Object.values(c?.guides || {}).some(l => Array.isArray(l) && l.length);
export function zeroUOnLane(rack, lane, ru, chassisOf) {
  return zeroUOf(rack).find(z => z.at === lane && carriesLane(chassisOf(z.ref))
    && ru >= zeroUTouched(z, chassisOf)[0] && ru <= zeroUTouched(z, chassisOf)[1]) ?? null;
}
// Its centre line across the rack, in mm from the rack's centre line, right as
// seen from the front: outside the rail, the stand-off and half its width out.
export function zeroUX(z, chassisOf) {
  const w = Number(chassisOf(z.ref)?.w) || 0, s = sideOfAt(z.at) === 'left' ? -1 : 1;
  return s * (OPENING / 2 + RAIL_W + STANDOFF + w / 2);
}

// Does a run of lane waypoints pass through a part? A waypoint on its lane at a
// U it spans, or two in a row on its lane whose run crosses its span.
export function runsThrough(waypoints, z, chassisOf) {
  const [lo, hi] = zeroUTouched(z, chassisOf);
  return waypoints.some((w, k) => {
    if (w.lane !== z.at) return false;
    if (w.ru >= lo && w.ru <= hi) return true;
    const nx = waypoints[k + 1];
    return nx?.lane === z.at && Math.min(w.ru, nx.ru) <= hi && Math.max(w.ru, nx.ru) >= lo;
  });
}

// ── hung on brackets (docs/rack-file-v4-design.md section 5) ──────────────
// A zero-U PDU on a frame with no channel hangs on brackets bolted to an
// upright. Each bracket is a zero-U entry of its own; the PDU names them in
// `heldBy: {parts: [id, ...]}`, and where it stands follows from them: `at`
// is theirs, and `offsetMm` puts its lowest mount point on their lowest slot.
// The facts come from each device's configs.json, for the configuration its
// entry names (`configFacts`): the `mount-points` of the PDU,
// `{mates, at}`, and the `slots` of a bracket, `{interface, at}`, each in mm
// above the bottom of its own view. `ctx.slotsOf` is what `loadSlots` answers.
//
// A mount point lands on a slot of the interface it mates within HANG_TOL_MM.
// The connectors registry states no tolerance for any mounting interface
// today, so this is the 1 mm the design gives for one that states none.
export const HANG_TOL_MM = 1;
const round1 = v => Math.round(v * 10) / 10;
const round2 = v => Math.round(v * 100) / 100;
const factsOf = (z, ctx) => (typeof ctx?.slotsOf === 'function' ? configFacts(ctx.slotsOf(z.ref), z.cfg) : null);

// WHERE A PART HANGS, OR WHY IT CANNOT. {ok: true, place: {at, offsetMm}} for
// one whose every mount point meets a slot; {ok: true, place: null} for a
// part that hangs on nothing, or whose facts are not loaded (then nothing is
// checked, and `unchecked` says so); else {ok: false, reason}, in the order
// the design gives: each holder is a bracket of this rack, they are on one
// upright, and the mount points land.
export function fitsHang(rack, z, ctx) {
  const ids = holdersOf(z);
  if (!ids.length) return {ok: true, place: null};
  const brackets = ids.map(id => zeroUById(rack, id));
  const missing = ids.find((id, k) => !brackets[k]);
  if (missing) return {ok: false, reason: notBracket(missing)};
  const mine = factsOf(z, ctx);
  if (!mine) return {ok: true, place: null, unchecked: true};
  const points = [...mine.mountPoints].sort((a, b) => a.at - b.at);
  const slots = [];
  for (const b of brackets) {
    const f = factsOf(b, ctx);
    const offers = (f?.slots || []).filter(s => points.some(m => m.mates === s.interface));
    if (!offers.length) return {ok: false, reason: notBracket(b.id)};
    for (const s of offers) slots.push({id: b.id, interface: s.interface, h: (Number(b.offsetMm) || 0) + s.at});
  }
  const other = brackets.find(b => b.at !== brackets[0].at);
  if (other) return {ok: false, reason: `${brackets[0].id} is at ${brackets[0].at} and ${other.id} at ${other.at}; a PDU hangs on one upright.`};
  if (!points.length) return {ok: false, reason: `${zeroUName(z, ctx.chassisOf)} has no mount point to hang by.`};
  slots.sort((a, b) => a.h - b.h);
  const base = slots.find(s => s.interface === points[0].mates);
  const offset = base.h - points[0].at;
  for (const m of points) {
    const want = m.at + offset;
    const near = slots.filter(s => s.interface === m.mates).reduce((n, s) => (Math.abs(s.h - want) < Math.abs(n.h - want) ? s : n));
    if (Math.abs(near.h - want) <= HANG_TOL_MM) continue;
    const name = zeroUName(z, ctx.chassisOf);
    if (points.length === 2 && ids.length === 2 && near.id !== base.id) {
      const need = points[1].at - points[0].at, have = near.h - base.h, units = Math.round(Math.abs(need - have) / RU);
      const by = units >= 1 ? `${units}U` : `${round1(Math.abs(need - have))} mm`;
      return {ok: false, reason: `${name} has mount points ${round1(need)} mm apart; brackets ${base.id} and ${near.id} are ${round1(have)} mm apart. ` +
        `Move ${near.id} ${need > have ? 'up' : 'down'} ${by}.`};
    }
    return {ok: false, reason: `A mount point of ${name} ${round1(m.at - points[0].at)} mm above its lowest meets no slot of ${ids.join(', ')}.`};
  }
  return {ok: true, place: {at: brackets[0].at, offsetMm: round2(offset)}};
}

// The parts that hang on a part, and each held part that does not hang as
// its file says, as sentences for a page that has loaded the facts.
export const hangingOn = (rack, id) => zeroUOf(rack).filter(z => holdersOf(z).includes(id));
export function hangNotices(rack, ctx) {
  const out = [];
  for (const z of zeroUOf(rack)) {
    if (!holdersOf(z).length) continue;
    const f = fitsHang(rack, z, ctx);
    if (!f.ok) out.push(`${zeroUName(z, ctx.chassisOf)}: ${f.reason}`);
    else if (f.place && (f.place.at !== z.at || Math.abs(f.place.offsetMm - (Number(z.offsetMm) || 0)) > HANG_TOL_MM))
      out.push(`${zeroUName(z, ctx.chassisOf)} is not where its brackets hold it: it hangs at ${f.place.at}, ${f.place.offsetMm} mm up.`);
  }
  return out;
}

// WHERE THE BRACKETS GO FOR A PART, before any is placed: one for each mount
// point of the part `ref` (configuration `cfg`, its default when left out),
// the lowest with its bottom level with unit `ru` (1 when left out) and each
// other a whole number of units above it. `offsets` are their `offsetMm`,
// `units` the same in units above the lowest, and `exact` says every mount
// point then lands within the tolerance, taking each bracket to offer its
// slot at one height. null when the facts of the part are not loaded or it
// has no mount point.
export function bracketPositions(rack, {ref, cfg = '', ru = 1}, ctx) {
  const facts = factsOf({ref, cfg}, ctx);
  const points = [...(facts?.mountPoints || [])].sort((a, b) => a.at - b.at);
  if (!points.length) return null;
  const units = points.map(m => Math.round((m.at - points[0].at) / RU));
  return {units, offsets: units.map(u => zeroUOffset(ru + u)),
          exact: points.every((m, k) => Math.abs(m.at - points[0].at - units[k] * RU) <= HANG_TOL_MM)};
}

