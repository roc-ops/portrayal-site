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
import {endKey, plugSeats, connectorOf, looseReason, holderPath, portPathOf} from '../../vendor/rack/cable-rules.js';
import {settleEnd} from '../../vendor/rack/ports.js';
import {loadSlots} from '../../vendor/rack/catalog.js';
import {partSel, pathOfProjectionId} from './part-path.js';

// WHAT IS DRAWN AT AN END, for the kit (ctx.drawnAt, kit 0.30.0): the ref of
// the component drawn at the end's path on that panel, or null. Only the
// drawing knows which part presents a device's own slot (configs.json does
// not say), and without it the kit guesses nothing: an outlet-to-outlet cord
// would go unwarned. Panels are remembered as cableFacts reads them, keyed by
// item and panel, and replaced when the item is read again.
const DRAWN = new Map();
export function drawnAt(end) {
  const root = DRAWN.get(`${end.item}|${end.view === 'rear' ? 'rear' : 'front'}`);
  if (!root) return null;
  const el = root.querySelector(partSel(portPathOf(end.path)));
  return (el?.getAttribute('data-ref') || '').split(':')[0] || null;
}

// (a part by its path, as its own drawing or as the projection of a seated module's back: part-path.js)
const at = (root, path) => root.querySelector(partSel(path));
const refOf = el => (el?.getAttribute('data-ref') || '').split(':')[0];
// A part as it is named in a reason: its model, or its ref's name in capitals.
function partName(list, ref) {
  if (!ref) return 'a part';
  return findComp(list, ref)?.attrs?.model || ref.split('/').pop().split('@')[0].toUpperCase();
}

// One panel of one item, as its own swaps configure it: the parsed face and
// every slot on it. null when that panel has no compiled drawing. A device's
// configs.json that fails to load leaves its cages unknown (an empty cage then
// reads as landing): the panel is still read, and `onFail` is told, so the
// answer built on it is not kept and the next redraw asks again.
async function readPanel(item, view, list, onFail) {
  const face = await configuredFace({ref: item.ref, cfg: item.cfg, view,
                                     swaps: item.swaps || {}, fields: item.fields || {}, ends: true});
  if (!face) return null;
  const root = new DOMParser().parseFromString(face.text, 'image/svg+xml').documentElement;
  DRAWN.set(`${item.id}|${view === 'rear' ? 'rear' : 'front'}`, root);
  const idx = await jdist(`${DIST}${item.ref}.configs.json`).catch(err => { onFail(err); return null; });
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
                 // (a projection carries no ref of its own: the part seated in the bay is the item's swap there)
                 holder: bay ? {path: bay, part: card ? partName(list, refOf(card) || (item.swaps || {})[bay] || '') : null} : null};
  const info = connectorOf({attrs: occupant ? (findComp(list, refOf(occupant))?.attrs || {}) : null,
                            portMedia: port?.getAttribute('data-media') || '', iface: slot?.interface || ''});
  // A DRAWING ID IS NOT A PATH. The back of a seated module is drawn as a
  // projection whose ids are the drawing's own ("bay-1-rear--b01"); the port
  // is addressed by its path there. An end given an id is not connected, and
  // is told the path to use.
  const meant = !port ? pathOfProjectionId(root, end.path) : null;
  return {facts, info, cls: port?.getAttribute('data-class') || null,
          seats: isPort ? plugSeats(end.path, slots, item.swaps || {}) : {},
          ...(meant ? {reason: `${end.path} is a drawing id, not a port: the port is ${meant} on the ${end.view === 'rear' ? 'rear' : 'front'}.`} : {})};
}

// What the page falls back to when reading the cables' faces fails: no plugs,
// and no end judged, so none is marked loose. Frozen, like every answer.
export const UNCHECKED = Object.freeze({seats: Object.freeze({}), ends: new Map(), unchecked: true});
const NONE = Object.freeze({seats: Object.freeze({}), ends: new Map()});

// The last answer, kept: render() asks on every redraw, and most redraws (a
// selection, a zoom) change neither the cables nor what is seated.
let memo = {key: '', value: null};
// ...and the one being read now (portrayal-site#192): a redraw and an
// assistant's call that ask of the same rack while its panels are still
// loading are handed one reading, not two that each fetch and parse them.
let reading = {key: '', promise: null};
// Every answer that was read whole: each panel and the component index loaded.
const stood = new WeakSet();

// WHETHER AN ANSWER IS ONE THIS MODULE KEEPS (portrayal-site#192): the answer for a rack with no
// cabled end, or the last one read with every panel and the component index loaded. An answer
// built on a fetch that failed is given and not kept (below), and what is worked out from one
// is not kept either (reading.js): the next ask reads again.
export const factsStand = facts => facts === NONE || (!!facts && typeof facts === 'object' && stood.has(facts));

// EVERY CABLED END OF THE RACK, read once per redraw:
//   seats  {itemId: {slotId: plugRef}}   the derived plugs, per item
//   ends   Map(endKey -> {facts, info, reason})   reason is null when the end lands
// `extra` ends (the two ends of a cable still being made) are read as well,
// for the form's media proposal and warning; they get no plugs.
export async function cableFacts(rack, extra = []) {
  const cabled = (rack.cables || []).flatMap(c => [c.a, c.b]);
  const ends = [...cabled, ...extra];
  if (!ends.length) return NONE;
  const items = new Map(rack.items.map(i => [i.id, i]));
  const key = JSON.stringify([cabled.map(endKey), extra.map(endKey),
    [...new Set(ends.map(e => e.item))].map(id => items.get(id) || null)
      .map(i => i && [i.id, i.ref, i.cfg, i.swaps, i.fields])]);
  if (memo.key === key) return memo.value;
  if (reading.key === key) return reading.promise;
  const mine = {key, promise: readFacts(cabled, ends, items, key)};
  reading = mine;
  try { return await mine.promise; } finally { if (reading === mine) reading = {key: '', promise: null}; }
}
async function readFacts(cabled, ends, items, key) {
  const out = {seats: {}, ends: new Map()};
  const list = await components();
  const panels = new Map();
  let failed = false;
  // A panel that fails to load is a panel with no drawing: its ends read "this
  // panel has no drawing" and the rack still draws. The failure is not kept
  // (see `failed` below), so a later redraw asks again.
  const panelOf = (item, view) => {
    const k = `${item.id}|${view}`;
    if (!panels.has(k)) panels.set(k, readPanel(item, view, list, err => {
      failed = true;
      console.warn(`[portrayal] could not read ${item.label || item.id}'s configurations for its cables`, err);
    }).catch(err => {
      failed = true;
      console.warn(`[portrayal] could not read ${item.label || item.id}'s ${view} panel for its cables`, err);
      return null;
    }));
    return panels.get(k);
  };
  const hasCable = new Set(cabled.map(endKey));
  // The parts lists, for the kit to judge an end on a slot of its own (a power
  // inlet, a PDU outlet) that the panel shows and no port is at.
  // Read only when an end needs it, and after its panel: a panel that fails to load must fail as it did.
  let kit = null;
  const kitCtx = async () => kit ??= {...await loadSlots(DIST, [...new Set(ends.map(e => items.get(e.item)?.ref).filter(Boolean))]), drawnAt};
  for (const end of ends) {
    const k = endKey(end);
    if (out.ends.has(k)) continue;
    const item = items.get(end.item) || null;
    const panel = item ? await panelOf(item, end.view) : null;
    const got = readEnd(end, item, panel, list);
    let ans = {facts: got.facts, info: got.info, reason: got.reason ?? looseReason(end, got.facts)};
    let seats = got.seats;
    // A SLOT A CABLE LANDS ON THAT IS NOT A PORT (cable-rules.js cableLandsOn):
    // the kit answers what the end is, and the plug it takes is derived.
    if (item && panel && !got.reason && !got.facts.port) {
      const ctx = await kitCtx();
      ans = settleEnd(rack, end, ans, ctx) ?? ans;
      if (ans.facts?.slot)
        seats = plugSeats(end.path, panel.slots, item.swaps || {}, {cls: got.cls, compByRef: ctx.compByRef, plug: end.plug});
    }
    out.ends.set(k, ans);
    // seats is keyed by ITEM, as item.swaps is: a front-panel end's plugs and a
    // rear-panel end's share one map, and mergeSeats lays it over both panels.
    if (item && hasCable.has(k)) out.seats[item.id] = {...(out.seats[item.id] || {}), ...seats};
  }
  // What is returned is shared (the memo, S.cableFacts, the probe): frozen.
  for (const m of Object.values(out.seats)) Object.freeze(m);
  Object.freeze(out.seats);
  Object.freeze(out);
  // An empty component index, or a panel that failed to load, is a fetch that
  // failed (face.js asks again next time), so an answer built on it is not kept.
  if (list.length && !failed) { memo = {key, value: out}; stood.add(out); }
  return out;
}
