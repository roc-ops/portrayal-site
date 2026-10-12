// kit/rack/ports.js
// THE PORTS OF WHAT IS SEATED, read without a drawing. A card in a bay has
// ports on its face, and a panel or a cassette has more on its back, which the
// host shows through its rear panel. Whether a cable end names one of them is
// answered here from `<ref>.configs.json` and `components.json` alone (what
// `loadSlots` in `catalog.js` returns), through the item's own swaps, so a page
// needs no lookup in a drawing for it.
//
// THE ADDRESS of a port on a seated part is `<bay>/module/<part>`, on the
// device's own panel that shows it: the bay's panel for the part's face, the
// other panel for its back. So the rear adapter b01 of a panel in bay-1 of an
// enclosure whose bays open to the front is
//   {item, path: 'bay-1/module/b01', view: 'rear'}
// An element id of the drawing (`bay-1-rear--b01`) is not an address
// (cable-rules.js isElementId).

import {slotEnv, resolverFor, holdsAt, partOf} from './slots.js';
import {portPathOf, looseReason, isElementId, connectorOf, endKey} from './cable-rules.js';

const MODULE = '/module/';
const OTHER = {front: 'rear', rear: 'front'};
const faceRef = f => (typeof f === 'string' ? f : f?.ref) || null;
const list = v => (Array.isArray(v) ? v : []);
const loaded = ctx => typeof ctx?.slotsOf === 'function' && typeof ctx?.compByRef === 'function';

// A part as it is named in a reason: its model, else its ref's name in capitals.
const modelOf = (comp, ref) => comp?.attrs?.model || String(ref).split('/').pop().split('@')[0].toUpperCase();

// Is `steps` a port of `comp`: a part it composes whose component is of class
// port, and below that only the ports that part composes in turn. THE ANSWER
// IS ONE-SIDED. Yes is certain: the build draws every such part as a port. No
// is not: a skin may draw a port its contract composes no part for (a test
// point on a card's face), and only the drawing knows those.
function portIn(comp, steps, compByRef) {
  let c = comp;
  for (const id of steps) {
    const part = list(c?.parts).find(q => q.id === id);
    c = part ? partOf(compByRef, part.ref) : null;
    if (c?.class !== 'port') return null;
  }
  return steps.length ? c : null;
}

// WHAT A CABLE END UNDER A BAY NAMES, in the words looseReason reads, or null
// when the catalogue cannot say: no parts list was loaded, the path is not
// under a bay of this device, neither the item's swaps nor its configuration
// names that bay, the part seated there is unknown, or the part composes no
// port of that name on either side. The drawing decides then.
//   port      a port is at the path on the end's panel
//   onView    the panel the port is on; where `port` is false, the port is on
//             that panel and the end names the other one
//   back      the port is on the back of the part
//   cage, occupied   the port takes an optic; something is seated in it
//   holder    {path, part, ref}: the bay above the path and what it holds;
//             `part` is null for an empty bay
//   info      the port's connector, as cable-rules.js connectorOf reads it
// `ctx` is {slotsOf, compByRef}.
//
// A PORT ON A BACK IS THE PART'S, WHETHER OR NOT THE HOST DRAWS IT. Whether a
// bay shows the back of what it holds on the other panel is the device's own
// statement, which configs.json does not publish. An enclosure with a closed
// back has the port all the same, and a cable on it lands; it is only not
// drawn there, and a route to it ends at the device.
export function seatedPort(item, end, ctx) {
  if (!item || !loaded(ctx)) return null;
  const p = portPathOf(end?.path ?? ''), first = p.indexOf(MODULE), cut = p.lastIndexOf(MODULE);
  if (first < 0 || isElementId(p)) return null;
  const slots = ctx.slotsOf(item.ref);
  if (!slots || slots.error) return null;
  const env = slotEnv(item, slots, ctx.compByRef), swaps = item.swaps || {};
  const bay = env.bays.find(b => b.id === p.slice(0, first));
  if (!bay || !OTHER[bay.view]) return null;
  // ONLY A BAY THAT IS SPOKEN FOR: by the item's swaps, or by the
  // configuration's own list. configs.json lists every bay of the device, and
  // a device may give a bay to some configurations only (a double-width
  // power bay where another has two card slots), which it does not publish.
  // A bay nothing names reads as holding its default, and in a configuration
  // that has no such bay the build draws nothing there.
  if (!Object.hasOwn(swaps, bay.id) && env.built(bay.id) === undefined) return null;
  const R = resolverFor(env, swaps);
  const carrier = p.slice(0, cut), steps = p.slice(cut + MODULE.length).split('/');
  const ref = R.refAt(`${carrier}/module`);
  const base = {item: true, drawing: true, port: false, cage: false, occupied: false, onView: null, back: false};
  if (!ref) return R.entryAt(carrier) ? {...base, holder: {path: carrier, part: null, ref: null}} : null;
  const comp = partOf(ctx.compByRef, ref);
  if (!comp) return null;
  const holder = {path: carrier, part: modelOf(comp, ref), ref: String(ref).split(':')[0]};
  const view = end.view === 'rear' ? 'rear' : 'front';
  const face = portIn(comp, steps, ctx.compByRef);
  // only what sits in one of the device's own bays shows its back
  const rear = carrier === bay.id ? partOf(ctx.compByRef, faceRef(comp.faces?.rear)) : null;
  const behind = rear ? portIn(rear, steps, ctx.compByRef) : null;
  const back = !!behind && view === OTHER[bay.view];
  const drawn = back ? behind : face && view === bay.view ? face : null;
  if (!drawn) return face || behind ? {...base, holder, onView: face ? bay.view : OTHER[bay.view]} : null;
  // the slot at the path: the resolver's, which reads a back's slots where no
  // part of the face shares the id; a back that does share one answers itself
  const slot = back && face ? (steps.length === 1 ? list(rear.cages).find(g => g.id === steps[0]) ?? null : null) : R.entryAt(p);
  return {...base, port: true, onView: view, back, holder, cage: slot?.kind === 'cage',
          occupied: !!slot && holdsAt(env, swaps, p, {...slot, isCage: true}) != null,
          info: connectorOf({portMedia: drawn.attrs?.media || '', iface: slot?.interface || drawn.attrs?.connector || ''})};
}

// ── what a DCIM calls the port ─────────────────────────────────────────────
// THE DCIM PORTS A CABLE END ON A SEATED PART LANDS ON, as the part's module
// type lists them, or null when the catalogue has none for it. A module type
// does not name a fibre port by its part: a duplex adapter `lc01` on a panel's
// face is the front ports `1` and `2`, one per fibre; its back `b01` is the
// rear port `B01-1`, one connector with two positions; a cassette's `mtp` is
// `MTP-1`. Those names are the exporter's own numbering, so the build writes
// them beside the fibre graph (`optical.ports` in components.json, from the
// walk that writes the type file) and nothing here derives one.
//   part      the part's id on the module
//   back      it is on the back of the module
//   sections  [[section, names]]: the type file's list ('front-ports',
//             'rear-ports') and the names in it, in position order, each once
//             and without the {module}/ a type file writes before them. More
//             than one list: the part's positions are split between two kinds
//             of port (a stated trunk position beside a front one).
// Only a port one step under a module in one of the device's own bays: a
// module inside a card has no module bay to be imported into (dcim-rules.js).
export function fibrePorts(item, end, ctx) {
  const at = seatedPort(item, end, ctx);
  if (!at?.port || !at.holder?.ref) return null;
  const p = portPathOf(end.path), cut = p.indexOf(MODULE);
  const part = p.slice(cut + MODULE.length);
  if (part.includes('/')) return null;
  const key = `${at.back ? 'rear:' : ''}${part}`;
  const published = partOf(ctx.compByRef, at.holder.ref)?.optical?.ports;
  const lists = published && Object.hasOwn(published, key) ? published[key] : null;
  if (!lists || typeof lists !== 'object') return null;
  const sections = Object.entries(lists)
    .map(([section, names]) => [section, [...new Set(list(names).filter(n => n != null).map(String))]])
    .filter(([, names]) => names.length);
  return sections.length ? {part, back: at.back, sections} : null;
}

// The ids one step under a part that a cable can be on: its cages, the parts
// it composes and its own bays, and the cages and parts of its back.
export function portIdsOf(comp, compByRef) {
  const rear = partOf(compByRef, faceRef(comp?.faces?.rear));
  return new Set([...list(comp?.cages).map(g => g.id), ...list(comp?.parts).map(q => q.id), ...Object.keys(comp?.bays || {}),
                  ...list(rear?.cages).map(g => g.id), ...list(rear?.parts).map(q => q.id)]);
}

// ── what the page read, with what the catalogue knows laid over it ──────
// One end: `got` is the page's {facts, info, reason} for it, or nothing. An
// element id is never an address, whatever a drawing matched it to. Where the
// catalogue answers (seatedPort), its answer stands, unless the page found the
// panel has no drawing at all; where it cannot, the page's does.
export function settleEnd(rack, end, got, ctx) {
  const item = (rack.items || []).find(i => i.id === end.item) || null;
  if (!item) return got ?? null;
  if (isElementId(end.path)) return {...got, reason: looseReason(end, {item: true})};
  const own = seatedPort(item, end, ctx);
  if (!own || got?.facts?.drawing === false) return got ?? null;
  const {info, ...facts} = own;
  return {...got, facts: {...got?.facts, ...facts}, info: got?.info?.family ? got.info : info ?? got?.info, reason: looseReason(end, facts)};
}
// The page's `cableFacts(rack).ends` settled: every cabled end of the rack,
// and `extra` ends (the two of a cable still being made), as cableFacts takes
// them. Map(endKey -> {facts?, info?, reason}); an end neither the page nor
// the catalogue answered for stays out of it, which reads as not checked.
export function settleEnds(rack, ends, ctx, extra = []) {
  const out = new Map(ends || []);
  for (const end of [...(rack.cables || []).flatMap(c => [c.a, c.b]), ...extra]) {
    const k = endKey(end), got = settleEnd(rack, end, out.get(k), ctx);
    if (got) out.set(k, got);
  }
  return out;
}
