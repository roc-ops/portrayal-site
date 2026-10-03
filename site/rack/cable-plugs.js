// WHAT EACH CABLED END HAS, READ OFF ITS PANEL - and the plugs that follow.
//
// PLUGS ARE DERIVED, NEVER STORED (Phase 2 ruling 1). A cable lands on a
// connector: an LC plug in each bore of an optic, a duplex plug in a
// cassette's adapter, an RJ45 plug in a copper jack. The file records only
// the cable, {item, path, view} at each end; the plugs are worked out here
// from the cables and laid over the item's swaps when the page draws
// (cable-rules.js mergeSeats). Nothing is written into item.swaps, so
// Explorer, the BOM and the DCIM exports never see a plug the user did not
// seat.
//
// The slots a face has depend on what is seated in it (an optic's bores
// exist only while the optic does), so this needs the face itself: the
// item's panel as configured by its OWN swaps, parsed, and swap.js's
// faceCages over it. The rules - which plug a slot takes, why an end is
// loose, what its connector is - are cable-rules.js's, and node tests them.

import {configuredFace, components, findComp, DIST} from './face.js';
import {jdist} from '../../vendor/dist.js';
import {faceCages} from '../../vendor/swap.js';
import {endKey, plugSeats, connectorOf, looseReason, holderPath} from './cable-rules.js';

const at = (root, path) => root.querySelector(`[data-path="${CSS.escape(path)}"]`);
const refOf = el => (el?.getAttribute('data-ref') || '').split(':')[0];
// A part as it is named in a reason: its model, or its ref's name in capitals.
function partName(list, ref) {
  if (!ref) return 'a part';
  return findComp(list, ref)?.attrs?.model || ref.split('/').pop().split('@')[0].toUpperCase();
}

// One panel of one item, as its own swaps configure it: the parsed face and
// every slot on it. null when that panel has no compiled drawing.
async function readPanel(item, view, list) {
  const face = await configuredFace({ref: item.ref, cfg: item.cfg, view,
                                     swaps: item.swaps || {}, fields: item.fields || {}});
  if (!face) return null;
  const root = new DOMParser().parseFromString(face.text, 'image/svg+xml').documentElement;
  const idx = await jdist(`${DIST}${item.ref}.configs.json`).catch(() => null);
  return {root, slots: faceCages(root, idx?.cages?.[view] || [], x => findComp(list, x))};
}

// One end against its panel: the facts looseReason reads, the connector
// mismatch and proposeMedia read, and the plug seats the end adds.
function readEnd(end, item, panel, list) {
  if (!item) return {facts: {item: false}, info: connectorOf(), seats: {}};
  if (!panel) return {facts: {item: true, drawing: false}, info: connectorOf(), seats: {}};
  const {root, slots} = panel;
  const port = at(root, end.path);
  const isPort = !!port && port.getAttribute('data-class') === 'port';
  const slot = slots.find(s => s.id === end.path) || null;
  const occupant = at(root, `${end.path}-occupant`);
  const bay = holderPath(end.path);
  const card = bay ? at(root, `${bay}/module`) : null;
  const facts = {item: true, drawing: true, port: isPort, cage: slot?.kind === 'cage', occupied: !!occupant,
                 holder: bay ? {path: bay, part: card ? partName(list, refOf(card)) : null} : null};
  const info = connectorOf({attrs: occupant ? (findComp(list, refOf(occupant))?.attrs || {}) : null,
                            portMedia: port?.getAttribute('data-media') || '', iface: slot?.interface || ''});
  return {facts, info, seats: isPort ? plugSeats(end.path, slots, item.swaps || {}) : {}};
}

// What the page falls back to when reading the cables' faces fails: no plugs,
// and no end judged, so none is marked loose. Frozen, like every answer.
export const UNCHECKED = Object.freeze({seats: Object.freeze({}), ends: new Map(), unchecked: true});
const NONE = Object.freeze({seats: Object.freeze({}), ends: new Map()});

// The last answer, kept: render() asks on every redraw, and most redraws (a
// selection, a zoom) change neither the cables nor what is seated.
let memo = {key: '', value: null};

// EVERY CABLED END OF THE RACK, read once per redraw:
//   seats  {itemId: {slotId: plugRef}}   the derived plugs, per item
//   ends   Map(endKey -> {facts, info, reason})   reason is null when the end lands
// `extra` ends (the two ends of a cable still being made) are read as well,
// for the form's media proposal and warning; they get no plugs.
export async function cableFacts(rack, extra = []) {
  const cabled = (rack.cables || []).flatMap(c => [c.a, c.b]);
  const ends = [...cabled, ...extra];
  if (!ends.length) return NONE;
  const out = {seats: {}, ends: new Map()};
  const items = new Map(rack.items.map(i => [i.id, i]));
  const key = JSON.stringify([cabled.map(endKey), extra.map(endKey),
    [...new Set(ends.map(e => e.item))].map(id => items.get(id) || null)
      .map(i => i && [i.id, i.ref, i.cfg, i.swaps, i.fields])]);
  if (memo.key === key) return memo.value;
  const list = await components();
  const panels = new Map();
  let failed = false;
  // A panel that fails to load is a panel with no drawing: its ends read "this
  // panel has no drawing" and the rack still draws. The failure is not kept
  // (see `failed` below), so a later redraw asks again.
  const panelOf = (item, view) => {
    const k = `${item.id}|${view}`;
    if (!panels.has(k)) panels.set(k, readPanel(item, view, list).catch(err => {
      failed = true;
      console.warn(`[portrayal] could not read ${item.label || item.id}'s ${view} panel for its cables`, err);
      return null;
    }));
    return panels.get(k);
  };
  const hasCable = new Set(cabled.map(endKey));
  for (const end of ends) {
    const k = endKey(end);
    if (out.ends.has(k)) continue;
    const item = items.get(end.item) || null;
    const got = readEnd(end, item, item ? await panelOf(item, end.view) : null, list);
    out.ends.set(k, {facts: got.facts, info: got.info, reason: looseReason(end, got.facts)});
    // seats is keyed by ITEM, as item.swaps is: a front-panel end's plugs and a
    // rear-panel end's share one map, and mergeSeats lays it over both panels.
    if (item && hasCable.has(k)) out.seats[item.id] = {...(out.seats[item.id] || {}), ...got.seats};
  }
  // What is returned is shared (the memo, S.cableFacts, the probe): frozen.
  for (const m of Object.values(out.seats)) Object.freeze(m);
  Object.freeze(out.seats);
  Object.freeze(out);
  // An empty component index, or a panel that failed to load, is a fetch that
  // failed (face.js asks again next time), so an answer built on it is not kept.
  if (list.length && !failed) memo = {key, value: out};
  return out;
}
