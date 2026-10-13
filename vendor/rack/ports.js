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

import {slotEnv, resolverFor, holdsAt, partOf, slotTree} from './slots.js';
import {portPathOf, looseReason, isElementId, connectorOf, endKey, takesCableEnd, receptacleOf, endPlug, connectorName} from './cable-rules.js';
import {hexColor} from './cable-geometry.js';

const MODULE = '/module/';
const OTHER = {front: 'rear', rear: 'front'};
const faceRef = f => (typeof f === 'string' ? f : f?.ref) || null;
const list = v => (Array.isArray(v) ? v : []);
const loaded = ctx => typeof ctx?.slotsOf === 'function' && typeof ctx?.compByRef === 'function';
const natural = new Intl.Collator('en', {numeric: true});

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

// The part at `steps` under `comp`, whatever its class: every part on the way
// from the seated part down to it, the last one last; null when a step names
// no part. [{comp, ref}].
function chainIn(comp, steps, compByRef) {
  const out = [];
  let c = comp;
  for (const id of steps) {
    const part = list(c?.parts).find(q => q.id === id);
    c = part ? partOf(compByRef, part.ref) : null;
    if (!c) return null;
    out.push({comp: c, ref: part.ref});
  }
  return out.length ? out : null;
}

// WHAT AN END THAT LANDS BY ITS SLOT IS (cable-rules.js receptacleOf), with
// the plug the slot gives it (endPlug) and its name for a person. `comps` are
// the components that could say what it is, the nearest first: a screw of a
// DC terminal says nothing of itself, and the terminal it is part of does.
function slotInfo(slot, comps, end, compByRef) {
  const said = comps.map(receptacleOf).find(i => i.family) || receptacleOf(null);
  const {plug, note} = endPlug(slot, compByRef, end?.plug);
  return {...said, plug, ...(note ? {note} : {}), connector: connectorName(slot, said)};
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
//   slot      the end lands by its slot and not as a part of class port: a
//             power inlet, a DC terminal, a ground stud (cable-rules.js
//             cableLandsOn). `info` then carries `role`, `plug`, `connector`
//             and, where the plug is in question, `note`
//   part      a part is at the path that takes no cable end: its name
// `ctx` is {slotsOf, compByRef}.
//
// A PORT ON A BACK IS THE PART'S, WHETHER OR NOT THE HOST DRAWS IT. Whether a
// bay shows the back of what it holds on the other panel is the device's own
// statement, which configs.json does not publish. An enclosure with a closed
// back has the port all the same, and a cable on it lands; it is only not
// drawn there, and a route to it ends at the device.
//
// `seen: true` is for an end whose panel a page read and found a part in that
// bay: the bay is then one this configuration has, and where neither the
// swaps nor the configuration names it, it holds what it ships with. Every
// supply in a bay that only its default fills is read this way (settleEnd).
export function seatedPort(item, end, ctx, {seen = false} = {}) {
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
  if (!seen && !Object.hasOwn(swaps, bay.id) && env.built(bay.id) === undefined) return null;
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
  if (!drawn) {
    if (face || behind) return {...base, holder, onView: face ? bay.view : OTHER[bay.view]};
    // NOT A PORT, BUT A PART OF THE FACE: it lands when a connector slot that
    // takes a cable end is at its path, and is named when none is.
    const chain = view === bay.view ? chainIn(comp, steps, ctx.compByRef) : null;
    if (!chain) return null;
    const seat = R.entryAt(p);
    if (!seat || seat.back || !takesCableEnd(seat, ctx.compByRef)) {
      // no slot itself; where its own parts are (the screws of a DC terminal), they are named
      const last = chain.at(-1);
      const under = list(last.comp.parts).map(q => `${p}/${q.id}`).filter(x => takesCableEnd(R.entryAt(x), ctx.compByRef)).sort(natural.compare);
      return {...base, holder, part: modelOf(last.comp, last.ref), ...(under.length ? {under} : {})};
    }
    return {...base, port: true, slot: true, onView: view, holder,
            info: slotInfo(seat, [...chain.map(x => x.comp).reverse(), comp], end, ctx.compByRef)};
  }
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

// ── the jacket colour an end states (#1028) ─────────────────────────────
// A cable is drawn in the jacket colour of its two seated ends when both
// state one and they agree (cable-geometry.js agreedJacket). This says what
// one end states.
//
// A DEFAULT IS NOT A STATEMENT. Every generic cable end declares the field
// `jacket-color` with a default (`#1c1c1c` on most), which is what its stub is
// drawn in when nobody has said anything. If that counted, every DAC, AOC and
// power cord between two generic ends would turn black. So an end states a
// jacket colour only when something says it of THAT end:
//   1. the rack: `fields` of the item holds `jacket-color` for the part
//      seated in the port (`<port>-occupant`), set by the `field` command or
//      the page's form. A value set to the very colour of the default is
//      stated all the same: somebody chose it.
//   2. else the part: a maker's part that composes a generic end and gives
//      its jacket a colour (`attrs` of the part, or of a part it composes,
//      to any depth; siemon/qsfp28-aoc@1 states its aqua this way).
// The declared default of a field is never read. A value that is no hex
// colour states nothing the kit can draw, and it does not fall through to the
// part's own: the rack said something else of that end.
export const JACKET_FIELD = 'jacket-color';
function partJacket(comp, compByRef, seen = new Set()) {
  if (!comp || seen.has(comp)) return null;
  seen.add(comp);
  if (comp.attrs && Object.hasOwn(comp.attrs, JACKET_FIELD)) return hexColor(comp.attrs[JACKET_FIELD]);
  for (const q of list(comp.parts)) {
    if (q?.attrs && Object.hasOwn(q.attrs, JACKET_FIELD)) return hexColor(q.attrs[JACKET_FIELD]);
    const under = partJacket(partOf(compByRef, q?.ref), compByRef, seen);
    if (under) return under;
  }
  return null;
}
// The jacket colour the part seated at a cable end states, as `#rrggbb`, or
// null: nothing is seated in the port, the catalogue was not loaded or does
// not know the part, or nothing states a colour of it. `ctx` is
// {slotsOf, compByRef}, what `loadSlots` returns. `kept`, a Map, holds what
// each item seats from one end to the next (jacketsFor passes one): a device
// of sixty cabled ports is then read once and not sixty times.
function seatsOf(item, ctx, kept) {
  if (kept?.has(item)) return kept.get(item);
  const slots = ctx.slotsOf(item.ref);
  const seats = !slots || slots.error ? null : resolverFor(slotEnv(item, slots, ctx.compByRef), item.swaps || {});
  kept?.set(item, seats);
  return seats;
}
export function seatedJacket(item, end, ctx, kept = null) {
  if (!item || !loaded(ctx)) return null;
  const port = portPathOf(end?.path ?? '');
  if (!port || isElementId(port)) return null;
  const path = `${port}-occupant`;
  const ref = seatsOf(item, ctx, kept)?.refAt(path);
  if (!ref) return null;
  const set = item.fields?.[path];
  if (set && typeof set === 'object' && Object.hasOwn(set, JACKET_FIELD) && set[JACKET_FIELD] != null && set[JACKET_FIELD] !== '')
    return hexColor(set[JACKET_FIELD]);
  return partJacket(partOf(ctx.compByRef, ref), ctx.compByRef);
}
// One end of a rack's cable, with what a page read laid over the catalogue.
// A PAGE SAYS WHAT IT READ by a `jacket` key on that end's entry of its cable
// facts (`ends`, the Map `cableFacts(rack).ends` is: endKey -> {info, reason,
// jacket}): a colour, or null for an end it found bare. Where the key is
// there, it stands, since a page can see a part the rack file does not name
// (a plug it seats for the cable). Where it is not, the catalogue answers
// (seatedJacket). `parts` is {slotsOf, compByRef}.
export function jacketAt(rack, end, {ends = null, parts = null} = {}, kept = null) {
  const got = ends?.get?.(endKey(end));
  if (got && Object.hasOwn(got, 'jacket')) return hexColor(got.jacket);
  return seatedJacket((rack.items || []).find(i => i.id === end?.item) || null, end, parts, kept);
}
// The `jacketOf` reader the plans and the exports take (cable-rules.js
// colorFacts): end -> the jacket colour it states, or null. Made for one
// rack as it is, and made anew for the next: it keeps what each item seats.
export const jacketsFor = (rack, facts = {}) => { const kept = new Map(); return end => jacketAt(rack, end, facts, kept); };

// ── the panels this configuration shows ─────────────────────────────────
// `configs.json` lists the bays and cages of EVERY panel the device has, each
// under the name of its panel, and a device may have more than one panel for
// a face: a 24-port build of a switch shows `front-24` where the 48-port one
// shows `front`. Which one a configuration shows is its own `views`
// (`{front: 'front-24'}`; a face it does not name shows the panel of that
// name). slotEnv keeps every panel's slots, as the readers of a path need
// them. THIS keeps only the slots of the panels the item's configuration
// shows, each with `view` as the face it is on, so that a slot of another
// build of the device is never taken for one of this build.
const SIX = ['front', 'rear', 'left', 'right', 'top', 'bottom'];
export function shownEnv(item, slots, compByRef = null) {
  const env = slotEnv(item, slots, compByRef);
  const faceOf = new Map(SIX.map(face => [env.cfg?.views?.[face] ?? face, face]));
  const shown = s => (faceOf.has(s.view) ? [{...s, view: faceOf.get(s.view)}] : []);
  return {...env, bays: env.bays.flatMap(shown), cages: env.cages.flatMap(shown)};
}

// ── a slot of the device itself ─────────────────────────────────────────
// AN END ON ONE OF THE DEVICE'S OWN CONNECTOR SLOTS (an outlet of a PDU, a
// chassis inlet, a ground stud): `<ref>.configs.json` lists the slot, its
// view and what it accepts, so whether a cable lands there is answered here.
// It is asked ONLY where a page read the panel and found no port at the path,
// which is what a page that knows class `port` alone says of every such
// slot; an end the page did not read, or read as a port, is left as it was.
// ONLY A SLOT THIS CONFIGURATION BUILDS: a page that knows class `port` alone
// says "no port" both of a slot that is drawn and of a path with nothing
// drawn, so the slot is looked for on the panel the configuration shows for
// that face (shownEnv) and nowhere else. Port 29 of a 48-port panel is not on
// the 24-port build, whatever the device lists.
//
// WHAT A PAGE HANDS IN, `ctx.drawnAt(end)`: the ref of the component drawn at
// the end's path on that panel (the `data-ref` of the element whose
// `data-path` is the path, a `-occupant` left off), or null. configs.json
// does not say what part presents a slot, so only the drawing knows. With it
// an end says what it is (power or ground, outlet or inlet, AC or DC) and an
// outlet that is no slot is named in its reason. WITHOUT IT NOTHING IS
// GUESSED: the end lands all the same, with no family and no direction, and
// an outlet that is no slot reads "is not on this panel" as before.
//   {facts, info}   facts to lay over the page's; info only when it landed
const FACES = ['front', 'rear'];
function drawnComp(end, ctx) {
  if (typeof ctx?.drawnAt !== 'function') return null;
  let ref = null;
  try { ref = ctx.drawnAt(end); } catch { ref = null; }
  const comp = ref ? partOf(ctx.compByRef, String(ref).split(':')[0]) : null;
  return comp ? {comp, ref: String(ref).split(':')[0]} : null;
}
export function ownSlot(item, end, ctx) {
  if (!item || !loaded(ctx)) return null;
  const p = portPathOf(end?.path ?? '');
  if (!p || p.includes(MODULE) || isElementId(p)) return null;
  const slots = ctx.slotsOf(item.ref);
  if (!slots || slots.error) return null;
  const view = end.view === 'rear' ? 'rear' : 'front';
  const takes = shownEnv(item, slots, ctx.compByRef).cages.filter(g => g.id === p && takesCableEnd(g, ctx.compByRef));
  const here = takes.find(g => g.view === view);
  const drawn = drawnComp(end, ctx);
  if (here) return {facts: {port: true, slot: true, cage: false, occupied: false, onView: view},
                    info: slotInfo(here, drawn ? [drawn.comp] : [], end, ctx.compByRef)};
  const side = takes.find(g => !FACES.includes(g.view));
  if (side) return {facts: {side: side.view}};
  return drawn && !takes.length ? {facts: {part: modelOf(drawn.comp, drawn.ref)}} : null;
}

// THE PATHS, ON ONE PANEL OF A DEVICE, OF THE SLOTS A CABLE LANDS ON: what a
// page hands zones.js readSvg as `ends`, so that its ports include a power
// inlet, an outlet, a DC terminal's screws and a ground stud. The device's
// own connector slots on that panel, and those of what its bays there hold,
// to any depth of parts (a supply's terminal, and the screws of that
// terminal), each where cable-rules.js takesCableEnd says so. A slot whose
// part is of class `port` is in the list too; readSvg reads that one as the
// port it is.
export function cableEndPaths(item, view, ctx) {
  if (!item || !loaded(ctx)) return [];
  const slots = ctx.slotsOf(item.ref);
  if (!slots || slots.error) return [];
  // the panels this configuration shows, and no other build's (shownEnv)
  const env = shownEnv(item, slots, ctx.compByRef), swaps = item.swaps || {};
  const R = resolverFor(env, swaps), out = new Set();
  const take = path => { if (takesCableEnd(R.entryAt(path), ctx.compByRef)) out.add(path); };
  const under = (comp, base, depth) => {
    for (const q of list(comp?.parts)) {
      take(`${base}/${q.id}`);
      if (depth < 4) under(partOf(ctx.compByRef, q.ref), `${base}/${q.id}`, depth + 1);
    }
  };
  for (const g of env.cages) if (g.view === view) take(g.id);
  for (const b of slotTree(env, swaps).bays)
    if (b.view === view && b.holds) under(partOf(ctx.compByRef, b.holds), `${b.path}/module`, 0);
  return [...out];
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
  let own = seatedPort(item, end, ctx);
  // A BAY THAT ONLY ITS DEFAULT FILLS, which the catalogue alone will not
  // answer for: the page saw a part drawn in it and no port at the path. The
  // catalogue is asked again, and heard only where it finds a slot that takes
  // a cable end, or a part that takes none; a port is still the page's to say.
  // AND ONLY WHERE THE PAGE SAW WHAT THE BAY SHIPS WITH: the part it names is
  // the one the catalogue holds there, so a page whose drawing shows another
  // part in the bay is not heard. (A page names the part as modelOf does, as
  // it always has: its model, else its ref's name in capitals.)
  // WHAT THIS DOES NOT CATCH: the catalogue does not say which configurations
  // build a bay that only its default fills. A page that hands in the drawing
  // of a configuration that builds the bay, for an item now in one that does
  // not, names the very part the bay ships with and is heard. A page that
  // reads the item's own configuration never does that
  // (docs/cable-ends-design.md section 6).
  if (!own && got?.facts?.drawing === true && got.facts.port === false && got.facts.holder?.part) {
    const again = seatedPort(item, end, ctx, {seen: true});
    if ((again?.slot || again?.part) && again.holder?.part === got.facts.holder.part) own = again;
  }
  if (!own && got?.facts?.drawing === true && got.facts.port === false && !got.facts.holder) {
    // the device's own slot, where the page found no port (ownSlot)
    const mine = ownSlot(item, end, ctx);
    if (!mine) return got;
    const facts = {...got.facts, ...mine.facts};
    return {...got, facts, ...(mine.info ? {info: mine.info.family || !got.info?.family ? mine.info : {...got.info, plug: mine.info.plug, ...(mine.info.note ? {note: mine.info.note} : {})}} : {}),
            reason: looseReason(end, facts)};
  }
  if (!own || got?.facts?.drawing === false) return got ?? null;
  const {info, ...facts} = own;
  // the screws to name for an end on a terminal: those no other cable is on
  if (facts.under) facts.under = facts.under.filter(x => !(rack.cables || []).some(c => [c.a, c.b].some(e =>
    e.item === end.item && e.view === end.view && portPathOf(e.path) === x)));
  // an end that lands by its slot is what its part says it is; a port, what the page read of it
  return {...got, facts: {...got?.facts, ...facts}, info: facts.slot ? info : got?.info?.family ? got.info : info ?? got?.info, reason: looseReason(end, facts)};
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
