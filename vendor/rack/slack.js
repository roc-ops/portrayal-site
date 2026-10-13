// kit/rack/slack.js
// WHERE THE SPARE CABLE IS (docs/rack-file-v4-design.md sections 3.3 to 3.6).
// A cable carries `slack`, a list of where its spare is stored: {item, via,
// form?, value?, unit?} for a tray or spool of a placed part, {end: a | b,
// value?, unit?} for what is left at an end. No `slack` key means nothing has
// been said; an empty list means it is stored nowhere, by choice.
//
// This module resolves the list against the route and says it in words. It
// returns NO GEOMETRY: version 4 records and lists the spare, and draws none
// of it. Nor does it place spare on its own, or judge how much a tray holds.
// Pure; `ctx` is the routing context route.js takes, and `rack.bundles` are
// read through bundles.js with it.

import {routePath, spareOf, toMetres, UNPLACED_WARN_M, BREAK_TOL_M} from './route.js';
import {traysOf} from './solids.js';
import {bendOf} from './resting.js';
import {bundleOfCable, layoutOf} from './bundles.js';
import {bundleName} from './model.js';

export const FORMS = ['coil', 'serpentine', 'spool'];
const plain = v => !!v && typeof v === 'object' && !Array.isArray(v);
// A length as the list says it: to a centimetre, with no trailing zero.
export const mText = m => `${Math.round(m * 100) / 100} m`;
const labelOf = (rack, id) => rack.items.find(i => i.id === id)?.label
  ?? (Array.isArray(rack.zeroU) ? rack.zeroU : []).find(z => z?.id === id)?.label ?? id;
export const trayText = (rack, e) => `${labelOf(rack, e.item)} ${e.via}`;

// WHY A CABLE CANNOT STORE SPARE IN A TRAY, as the sentence, or null when it
// can (section 3.5). `path` is the cable's routed path; without it, or with
// no routing context, nothing is judged and the answer is null.
// - the tray is not one the cable rests on;
// - the tray states no place for spare;
// - the cable lies on its held face there;
// - the cable rides a bundle trunk through it;
// - no turn of the cable can lie on its floor at all: twice its bend radius
//   and its diameter are more than the floor is deep. Necessary and not
//   sufficient; nothing finer is judged. For a coil and a serpentine, which
//   turn the cable on the floor; a spool is refused on a tray that states none.
export function trayRefusal(rack, cable, entry, ctx, path) {
  if (!ctx || !path) return null;
  const name = trayText(rack, entry);
  const rest = (path.rests || []).find(x => x.kind === 'tray' && x.item === entry.item && x.via === entry.via);
  if (!rest) return `${name} is not on the route of ${cable.id}.`;
  const tray = traysOf(rack, ctx).find(t => t.item === entry.item && t.via === entry.via);
  if (!tray?.slack) return `${name} states no place for spare cable.`;
  if (rest.role === 'held') return `${cable.id} lies on the held face of ${name}; slack is stored on the resting face.`;
  const b = bundleOfCable(rack, cable.id);
  if (b && ridesThrough(rack, b, cable.id, entry, ctx)) return `${cable.id} rides ${bundleName(b)} through ${name}: store its spare after it leaves the bundle.`;
  const form = entry.form ?? 'coil';
  if (form === 'spool') return tray.slack.kind === 'spool' ? null : `${name} states no spool.`;
  const d = typeof ctx.diameterOf === 'function' ? Number(ctx.diameterOf(cable)) : NaN;
  const across = 2 * bendOf(cable, ctx) + (Number.isFinite(d) ? d : 0);
  const deep = Math.max(...tray.floors.map(f => f.z1 - f.z0));
  return across > deep + 1e-9 ? `A turn of ${cable.id} is ${Math.round(across * 10) / 10} mm across, and the floor of ${name} is ${Math.round(deep * 10) / 10} mm deep.` : null;
}
// Does the cable ride its bundle's trunk through this tray: is the tray an
// element of the trunk between where the cable joins and leaves it?
function ridesThrough(rack, b, cableId, entry, ctx) {
  if (b.members.length < 2) return false;
  const L = layoutOf(rack, b, {route: ctx});
  const m = L?.members.find(x => x.cable === cableId);
  if (!m || m.ji == null || m.li == null) return false;
  const lo = Math.min(m.ji, m.li), hi = Math.max(m.ji, m.li);
  return L.T.some((e, i) => i >= lo && i <= hi && e.kind === 'p' && e.item === entry.item && e.via === entry.via);
}

// THE SLACK OF A CABLE, RESOLVED: null without a path or a usable length,
// else {spare, said, entries, at_ends_m, unplaced_m, over_m, short}.
// - `said` is false for no `slack` key and true for a list, empty or not;
// - `entries` are {item, via, form, metres, ok, why} for a tray (ok false with
//   the reason when the cable cannot store there) and {end, metres} for an
//   end; an entry with a value takes it, and the one without takes the rest;
// - `at_ends_m` is the end play, `unplaced_m` what is to store and has no
//   place, `over_m` how much the stated values are past what there is to
//   store; `short` is true for a pinned length under the need, and then
//   nothing is stored anywhere.
export function slackOf(rack, cable, ctx) {
  // the path is read once, for the spare and for where it can be stored
  let path = null;
  try { path = routePath(rack, cable, ctx); } catch { path = null; }
  const spare = spareOf(rack, cable, ctx, path);
  if (!spare) return null;
  const said = Array.isArray(cable.slack);
  if (spare.spare_m < -1e-9) return {spare, said, entries: [], at_ends_m: 0, unplaced_m: 0, over_m: 0, short: true};
  const list = said ? cable.slack.filter(plain) : [];
  const stated = list.reduce((s, e) => s + (toMetres(e.value, e.unit) ?? 0), 0);
  const rest = Math.max(0, spare.to_store_m - stated);
  const entries = list.map(e => {
    const metres = e.value == null ? rest : toMetres(e.value, e.unit);
    if (e.end === 'a' || e.end === 'b') return {end: e.end, metres};
    const why = trayRefusal(rack, cable, e, ctx, path);
    return {item: e.item, via: e.via, form: e.form ?? 'coil', metres, ok: !why, why};
  });
  const placed = entries.reduce((s, e) => s + (e.metres ?? 0), 0);
  return {spare, said, entries, at_ends_m: spare.end_play_m, unplaced_m: Math.max(0, spare.to_store_m - placed),
          over_m: Math.max(0, stated - spare.to_store_m), short: false};
}

// THE `stored` TEXT OF THE LIST (section 3.6), '' when there is nothing to
// say: no path, no usable length, or a pinned length under the need.
const offText = why => (/held face/.test(why) ? 'on the held face' : /rides (.+) through/.test(why) ? `in ${/rides (.+) through/.exec(why)[1]}`
  : /not on the route/.test(why) ? 'not on its route' : null);
export function storedText(rack, cable, s) {
  if (!s || s.short || !cable.length) return '';
  const parts = s.entries.map(e => {
    const m = e.metres == null ? 'a length in a unit that does not convert' : mText(e.metres);
    if (e.end) return `${m} at the ${e.end.toUpperCase()} end`;
    const off = e.ok ? null : offText(e.why);
    return `${trayText(rack, e)}, ${e.form}, ${m}${off ? `, ${off}` : ''}`;
  });
  if (s.unplaced_m > 0.005) parts.push(`${mText(s.unplaced_m)} not placed${s.said && !s.entries.length ? ', by choice' : ''}`);
  return [...parts, `${mText(s.at_ends_m)} at the ends`].join('; ');
}

// THE FINDINGS OF THE SPARE, rack-wide: [{kind, cable, text}], one for
// - `spare-unplaced`: more than UNPLACED_WARN_M to store and no `slack` key
//   (an empty list is a choice, and gives none);
// - `spare-short`: a pinned length under the need;
// - `spare-over`: values that add up to more than there is to store, by more
//   than the stock break tolerance (BREAK_TOL_M);
// - `spare-off-route`: an entry on a tray the cable cannot store in, kept.
export function slackFindings(rack, ctx, nameOf = id => id) {
  const out = [];
  for (const c of rack.cables || []) {
    let s = null;
    if (!c.length) continue;                     // nothing is bought yet, so nothing is spare
    try { s = slackOf(rack, c, ctx); } catch { s = null; }
    if (!s) continue;
    if (s.short) { out.push({kind: 'spare-short', cable: c.id, text: `${c.id} is ${mText(s.spare.stock_m)} and needs ${mText(s.spare.need_m)}.`}); continue; }
    if (!s.said && s.spare.to_store_m > UNPLACED_WARN_M)
      out.push({kind: 'spare-unplaced', cable: c.id, text: `${c.id} has ${mText(s.spare.to_store_m)} to store and no place for it.`});
    if (s.over_m > BREAK_TOL_M) {
      const where = s.entries.filter(e => e.item && e.metres != null);
      const stated = s.entries.reduce((n, e) => n + (e.metres ?? 0), 0);
      out.push({kind: 'spare-over', cable: c.id, text: `${c.id} stores ${mText(stated)}${where.length === 1 && s.entries.length === 1 ? ` in ${nameOf(where[0].item)} ${where[0].via}` : ''} and has ${mText(s.spare.to_store_m)} to store.`});
    }
    for (const e of s.entries) if (e.item && !e.ok) out.push({kind: 'spare-off-route', cable: c.id, text: e.why});
  }
  return out;
}
// One line for the rack: "Spare: 14.2 m; 41 cords not placed." '' when no
// cable has a path and a usable length.
export const spareLine = (rack, ctx) => lineOf(rack, c => slackTry(rack, c, ctx));
// A cable's slack, or null where it cannot be read.
function slackTry(rack, c, ctx) { try { return slackOf(rack, c, ctx); } catch { return null; } }
// The two lines from each cable's slack, `slackFor(cable)`: spareExports
// reads every cable's once and says both lines from that one reading.
function lineOf(rack, slackFor) {
  let total = 0, unplaced = 0, n = 0;
  for (const c of rack.cables || []) {
    const s = slackFor(c);
    if (!s || s.short || !c.length) continue;    // a cable with no length has no spare to count
    n++; total += s.spare.spare_m;
    if (!s.said && s.unplaced_m > 0.005) unplaced++;
  }
  return n ? `Spare: ${mText(total)}; ${unplaced} cord${unplaced === 1 ? '' : 's'} not placed.` : '';
}
// The one line of the BOM notes: "Spare cable: 14.2 m of 31 m bought; 41
// cords have spare that is not placed." '' as spareLine is.
export const spareBomLine = (rack, ctx) => bomLineOf(rack, c => slackTry(rack, c, ctx));
function bomLineOf(rack, slackFor) {
  let total = 0, bought = 0, unplaced = 0, n = 0;
  for (const c of rack.cables || []) {
    const s = slackFor(c);
    if (!s || s.short || !c.length) continue;
    n++; total += s.spare.spare_m; bought += s.spare.stock_m;
    if (!s.said && s.unplaced_m > 0.005) unplaced++;
  }
  return n ? `Spare cable: ${mText(total)} of ${mText(bought)} bought; ${unplaced} cord${unplaced === 1 ? ' has' : 's have'} spare that is not placed.` : '';
}
// What the exports take (export-data.js cableScheduleRows, cableBomNotes and
// drawioCables, `spare`): each cable's resolved slack by id, the one line of
// the schedule for the rack, and the one line of the BOM.
export function spareExports(rack, ctx) {
  const byCable = new Map(), read = new Map();
  for (const c of rack.cables || []) {
    const s = slackTry(rack, c, ctx);
    read.set(c, s);
    if (s) byCable.set(c.id, s);
  }
  return {byCable, line: lineOf(rack, c => read.get(c)), bom: bomLineOf(rack, c => read.get(c))};
}
