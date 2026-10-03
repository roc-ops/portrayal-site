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
export const sameEnd = (a, b) => endKey(a) === endKey(b);

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
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
// The text of a cross-face tag: the far end, short enough for the side column.
export function tagText(rack, end) {
  const it = itemOf(rack, end);
  return clip(`→ ${it ? it.label : 'removed'} ${end.path}`, 32);
}

// ── one cable per port (spec §9.3) ──────────────────────────────────────
export function portFree(rack, end, {ignoreId = null} = {}) {
  const k = endKey(end);
  const other = (rack.cables || []).find(c => c.id !== ignoreId && (endKey(c.a) === k || endKey(c.b) === k));
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
export function updateCable(rack, id, patch) {
  return {...rack, cables: rack.cables.map(c => {
    if (c.id !== id) return c;
    const next = {...c, ...patch};
    if (next.length == null) delete next.length;
    return next;
  })};
}
export const withoutCable = (rack, id) => ({...rack, cables: rack.cables.filter(c => c.id !== id)});
export const cablesOf = (rack, itemId) =>
  (rack.cables || []).filter(c => c.a.item === itemId || c.b.item === itemId);
export const withoutCablesOf = (rack, itemId) =>
  ({...rack, cables: (rack.cables || []).filter(c => c.a.item !== itemId && c.b.item !== itemId)});

// ── length ──────────────────────────────────────────────────────────────
export const UNITS = ['m', 'ft'];
export function parseLength(text, unit = 'm') {
  const t = String(text ?? '').trim();
  if (!t) return {ok: true, length: null};
  const value = Number(t);
  if (!Number.isFinite(value) || value <= 0) return {ok: false, reason: 'Enter a length above 0, or leave it empty.'};
  return {ok: true, length: {value, unit: UNITS.includes(unit) ? unit : 'm', source: 'entered'}};
}
export const lengthText = l => (l && l.value > 0 ? `${l.value} ${l.unit || 'm'}` : '');

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
