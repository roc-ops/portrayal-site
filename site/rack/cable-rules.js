// THE CABLE RULES (spec §9). Pure: no DOM, no fetch, so the page, the side
// panel and `node --test` all read one definition. A rule that says no gives
// a sentence, in the style of fit.js.
//
// A cable is {id, a, b, media, purpose, label, length?, route}; an END is
// {item, path, view}: the item's id, the port's data-path, and the device's
// OWN panel ('front' or 'rear') the port is on - not the pane that shows it.

import {nextId, uLabel} from './model.js';

// ── ends ────────────────────────────────────────────────────────────────
export const endKey = end => `${end.item}|${end.view}|${end.path}`;
// One PORT, however its path is spelled: a click on a seated optic or its plug
// (`port-1-occupant/tx`) is a click on `port-1`. endKey stays exact.
const portKey = end => `${end.item}|${end.view}|${portPathOf(end.path)}`;
export const sameEnd = (a, b) => portKey(a) === portKey(b);

// WHICH PANE SHOWS A DEVICE'S PANEL: the inverse of elevation.js's panelFor.
// A device's front is on the face it is mounted on, unless it is turned.
const OTHER = {front: 'rear', rear: 'front'};
export const paneOf = (item, view) => (((view === 'front') !== !!item.turned) ? item.face : OTHER[item.face]);

// THE PORT A CLICKED PATH BELONGS TO. A seated optic and its plugs are drawn
// beside their cage, at `<port>-occupant` and below it, so a click on either
// is a click on the port: everything from the first `-occupant` on is dropped.
export const portPathOf = path => String(path).split('-occupant')[0];

const itemOf = (rack, end) => rack.items.find(i => i.id === end.item) || null;
// An end as a person reads it. Labels repeat (two "demarc"), so the U is in it.
export function endName(rack, end) {
  const it = itemOf(rack, end);
  return it ? `${it.label} (U${uLabel(rack.frame, it.ru)}) ${end.path}` : `a removed device's ${end.path}`;
}
export const cableName = c => c.label || c.id;
const clip = (s, n) => { const cs = Array.from(s); return cs.length > n ? `${cs.slice(0, n - 1).join('')}…` : s; };
// The text of a cross-face tag: the far end, short enough for the side column.
export function tagText(rack, end) {
  const it = itemOf(rack, end);
  return clip(`→ ${it ? it.label : 'removed'} ${end.path}`, 32);
}

// ── one cable per port (spec §9.3) ──────────────────────────────────────
export function portFree(rack, end, {ignoreId = null} = {}) {
  const k = portKey(end);
  const other = (rack.cables || []).find(c => c.id !== ignoreId && (portKey(c.a) === k || portKey(c.b) === k));
  return other ? {ok: false, reason: `${endName(rack, end)} already has a cable (${cableName(other)}).`} : {ok: true};
}
export function canCable(rack, a, b, opts = {}) {
  if (sameEnd(a, b)) return {ok: false, reason: 'A cable needs two different ports.'};
  for (const e of [a, b]) { const f = portFree(rack, e, opts); if (!f.ok) return f; }
  return {ok: true};
}

// ── edits: each returns a new rack ──────────────────────────────────────
const endOf = e => ({item: e.item, path: e.path, view: e.view === 'rear' ? 'rear' : 'front'});
export function withCable(rack, {a, b, media = '', purpose = '', label = '', length = null}) {
  const cable = {id: nextId(rack.cables || [], 'c'), a: endOf(a), b: endOf(b), media, purpose, label,
                 ...(length ? {length} : {}), route: []};
  return {rack: {...rack, cables: [...(rack.cables || []), cable]}, cable};
}
// `length: null` in the patch removes the length; anything else is merged.
// A patch that names the length at all - a value, or null - is the user
// setting or clearing it, and that replaces a length the loader kept as
// written (model.js `lengthAsWritten`); a patch that does not name it leaves
// both as they are.
export function updateCable(rack, id, patch) {
  return {...rack, cables: (rack.cables || []).map(c => {
    if (c.id !== id) return c;
    const next = {...c, ...patch};
    if (Object.hasOwn(patch, 'length')) delete next.lengthAsWritten;
    if (next.length == null) delete next.length;
    return next;
  })};
}
export const withoutCable = (rack, id) => ({...rack, cables: (rack.cables || []).filter(c => c.id !== id)});
export const cablesOf = (rack, itemId) =>
  (rack.cables || []).filter(c => c.a.item === itemId || c.b.item === itemId);
export const withoutCablesOf = (rack, itemId) =>
  ({...rack, cables: (rack.cables || []).filter(c => c.a.item !== itemId && c.b.item !== itemId)});

// ── length ──────────────────────────────────────────────────────────────
export const UNITS = ['m', 'ft'];
export function parseLength(text, unit = 'm') {
  const t = String(text ?? '').trim();
  if (!t) return {ok: true, length: null};
  const value = /^\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;   // a plain decimal, not 0x10 or 1e3
  if (!Number.isFinite(value) || value <= 0) return {ok: false, reason: 'Enter a length above 0, or leave it empty.'};
  return {ok: true, length: {value, unit: UNITS.includes(unit) ? unit : 'm', source: 'entered'}};
}
// Value and unit as the cable has them: a unit this page does not offer (a
// file's 'cm' or 'yd') prints as itself.
export const lengthText = l => (l && typeof l.value === 'number' && l.value > 0 ? `${l.value} ${l.unit || 'm'}` : '');

// ── the plan cables.js draws ────────────────────────────────────────────
// The rack's cables in the shape drawCables2d takes: an end is [item id,
// path, PANE]. An end whose device is gone is on no pane ('none'), so the
// drawer hangs the other end as an unplugged lead. A cable with no media is
// 'unset', which cables.js colors neutral.
export function cablePlan(rack) {
  const end = e => { const it = itemOf(rack, e); return [e.item, e.path, it ? paneOf(it, e.view) : 'none']; };
  return {links: (rack.cables || []).map(c =>
    ({id: c.id, media: c.media || 'unset', purpose: c.purpose || '', from: end(c.a), to: end(c.b)}))};
}

// ── media ───────────────────────────────────────────────────────────────
export const MEDIA = ['os2', 'om3', 'om4', 'om5', 'cat6', 'cat6a', 'dac', 'aoc'];
export const MEDIA_LABELS = {
  os2: 'OS2 single-mode fiber', om3: 'OM3 multimode fiber', om4: 'OM4 multimode fiber',
  om5: 'OM5 multimode fiber', cat6: 'Cat 6 copper', cat6a: 'Cat 6A copper',
  dac: 'DAC (twinax)', aoc: 'AOC (active optical)'};

const FIBER_SM = {family: 'fiber', mode: 'single-mode'}, FIBER_MM = {family: 'fiber', mode: 'multimode'};
const KIND = {os2: FIBER_SM, om3: FIBER_MM, om4: FIBER_MM, om5: FIBER_MM,
              cat6: {family: 'copper', mode: null}, cat6a: {family: 'copper', mode: null},
              dac: {family: 'dac', mode: null}, aoc: {family: 'aoc', mode: null}};
const UNKNOWN = {family: null, mode: null};
// What a media IS: its connector family (fiber, copper, dac, aoc) and, for
// fiber, its mode. A media this page does not know has neither.
export const mediaKind = media => KIND[media] || UNKNOWN;

// What an END's connector is, from what is known about it: the attrs of the
// part seated in the port (an optic, a DAC end - null when nothing is), the
// port's own data-media, and its slot's interface. Same shape as mediaKind.
export function connectorOf({attrs = null, portMedia = '', iface = ''} = {}) {
  const a = attrs || {};
  const kind = String(a['cable-kind'] || '');
  if (kind === 'aoc') return {family: 'aoc', mode: null};
  if (kind || a.face === 'cable') return {family: 'dac', mode: null};
  const mode = /^single/.test(a.mode || '') ? 'single-mode' : /^multi/.test(a.mode || '') ? 'multimode' : null;
  const face = String(a.face || a.connector || '');      // an optic states `face`, a plug `connector`
  if (a.media === 'fiber' || mode || /^(lc|sc|mpo)/.test(face)) return {family: 'fiber', mode};
  if (a.media === 'copper' || face === 'rj45') return {family: 'copper', mode: null};
  if (attrs) return UNKNOWN;                    // something is seated, and it does not say
  if (/^rj45/.test(portMedia) || iface === 'rj45') return {family: 'copper', mode: null};
  if (/^(lc|sc|mpo)/.test(iface) || portMedia === 'fiber') return {family: 'fiber', mode: null};
  return UNKNOWN;
}

// THE MEDIA A NEW CABLE IS OFFERED, from its two ends: single-mode fiber ->
// os2; multimode -> om4; fiber that states no mode -> os2; copper -> cat6a;
// a DAC or AOC end -> itself; nothing known -> '', and the user picks. The
// first end that knows decides, unless it is fiber of no stated mode and the
// other is fiber that states one.
export function proposeMedia(a, b) {
  const known = [a, b].filter(e => e && e.family);
  if (!known.length) return '';
  const pick = known.find(e => e.family === 'fiber' && e.mode && known[0].family === 'fiber') || known[0];
  if (pick.family === 'fiber') return pick.mode === 'multimode' ? 'om4' : 'os2';
  return {copper: 'cat6a', dac: 'dac', aoc: 'aoc'}[pick.family] || '';
}

const NAMED = {fiber: 'fiber', copper: 'copper', dac: 'a DAC', aoc: 'an AOC'};
// A MISMATCH IS A WARNING, never a refusal (spec §9.3): the sentences to show
// beside the media field, or [] when nothing is known to be wrong.
export function mismatch(media, a, b) {
  const out = [];
  const fa = a?.family, fb = b?.family;
  if (fa && fb && fa !== fb) out.push(`The ends differ: A is ${NAMED[fa]}, B is ${NAMED[fb]}.`);
  if (fa === 'fiber' && fb === 'fiber' && a.mode && b.mode && a.mode !== b.mode)
    out.push(`The ends differ: A is ${a.mode}, B is ${b.mode}.`);
  const m = mediaKind(media);
  if (m.family) for (const [k, e] of [['A', a], ['B', b]])
    if (e?.family && e.family !== m.family)
      out.push(`${MEDIA_LABELS[media]} does not suit end ${k}, which is ${NAMED[e.family]}.`);
  return out;
}

// ── plugs: derived, never stored ────────────────────────────────────────
// The plug a slot takes, by its interface, when the slot accepts it. A slot
// with no known plug here (an MPO adapter, a cage - which takes an optic or
// a DAC, not a plug) has none: its cable ends at the port's own center, or
// on the cable point a seated DAC end carries. That is not an error.
const PLUGS = {lc: 'generic/lc-plug@2', 'lc-duplex': 'generic/lc-duplex-plug@2', rj45: 'generic/rj45-plug@1'};
export function plugFor(slot) {
  const p = PLUGS[slot?.interface];
  return p && (slot.accepts || []).includes(p) ? p : null;
}
// The seats a cabled end at `path` adds, as {slotId: plugRef}: the port's own
// slot when it takes a plug (an RJ45 jack, a duplex adapter), else the slots
// one step under what is seated in it (an optic's tx and rx bores). `slots`
// is the face's slot list (swap.js faceCages); a slot the user's own `swaps`
// already speak for - or, for an adapter, any of its bores - is left alone.
export function plugSeats(path, slots, swaps = {}) {
  const own = k => Object.hasOwn(swaps || {}, k);
  const free = s => !own(s.id) && !(s.bores || []).some(b => own(`${s.id}/${b}`));
  const seat = list => Object.fromEntries(list.filter(s => plugFor(s) && free(s)).map(s => [s.id, plugFor(s)]));
  const exact = slots.filter(s => s.id === path);
  if (exact.some(plugFor)) return seat(exact);
  const under = `${path}-occupant/`;
  return seat(slots.filter(s => s.id.startsWith(under) && !s.id.slice(under.length).includes('/')));
}
// The swaps a face is drawn with: the item's own, over the derived plugs.
export const mergeSeats = (swaps, plugs) => ({...(plugs || {}), ...(swaps || {})});

// ── loose ends (spec §9.3) ──────────────────────────────────────────────
// The bay a card port's path sits in: 'slot-2/module/p2' -> 'slot-2'.
export function holderPath(path) {
  const i = String(path).lastIndexOf('/module/');
  return i < 0 ? null : path.slice(0, i);
}
// WHY AN END DOES NOT LAND, from what its panel has now - or null when it
// lands. `facts` is what cable-plugs.js read off the face:
//   {item, drawing, port, cage, occupied, holder: {path, part} | null}
// item: the device is still in the rack; drawing: its panel has one; port: a
// port is drawn at the end's path; cage: that port takes an optic; occupied:
// something is seated in it; holder: the bay above the path and what it holds.
export function looseReason(end, facts) {
  if (!facts || !facts.item) return 'the device was removed';
  if (!facts.drawing) return 'this panel has no drawing';
  if (!facts.port) {
    const h = facts.holder;
    if (!h) return `${end.path} is not on this panel`;
    const leaf = end.path.slice(h.path.length + '/module/'.length);
    return h.part ? `${h.path} holds ${h.part}, which has no port ${leaf}` : `${h.path} is empty`;
  }
  if (facts.cage && !facts.occupied) return `${end.path} holds no optic`;
  return null;
}

// ── the list's filter (stage 5's two axes) ──────────────────────────────
// {value -> count} for a cable field, in first-seen order.
export function countsBy(cables, field) {
  const m = new Map();
  for (const c of cables || []) m.set(c[field], (m.get(c[field]) || 0) + 1);
  return m;
}
// `on` is {purpose, media}; null on an axis means it is not narrowing.
export const matches = (cable, on = {}) =>
  (on.purpose == null || cable.purpose === on.purpose) && (on.media == null || cable.media === on.media);
