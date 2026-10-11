// kit/rack/states.js
// WHAT A RACK ENTRY IS SET TO, AND WHAT WAS READ FROM IT
// (docs/rack-file-v4-design.md section 4). An item and a part beside the rack
// each carry `states`, a map of part path to state name, and `readings`,
// {source, at, values}. The file keeps what it was given; what a drawing is
// handed is checked here against the facts of the device, which parseDoc
// cannot see: `facts` is what `configFacts` gives for the device and the
// configuration the entry names. Pure: no DOM, no fetch.

import {expandStates} from '../states.js';
import {zeroUOf} from './model.js';
import {configFacts} from './catalog.js';

const plain = v => !!v && typeof v === 'object' && !Array.isArray(v);
const nameOf = entry => entry.label || entry.ref || entry.id;
const orList = names => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`);

// One state of one part against what the part declares: null when it can be
// that, else the sentence. A part that declares nothing cannot be set.
export function stateRefusal(entry, path, state, facts) {
  const can = facts?.states && Object.hasOwn(facts.states, path) ? facts.states[path] : null;
  if (!can) return `${path} on ${nameOf(entry)} cannot be set: it declares no state.`;
  return can.includes(state) ? null : `${path} on ${nameOf(entry)} cannot be ${state}: it can be ${orList(can)}.`;
}

// THE STATES TO HAND A DRAWING for one entry: {path: state}, only those the
// part declares, expanded from each outlet to the lamps bound to it by `for:`
// through the one expansion 2D and 3D share (kit/states.js expandStates).
// `facts.bindings`, when the caller has read the drawing, is what boundLamps
// answered for it, or a Map of path to lamp paths; without it the map names
// the outlets alone, and a drawing that applies it expands it itself. A state
// the part does not declare is kept in the file and is not in the map; with
// no facts nothing can be checked, so nothing is applied.
export function statesFor(entry, facts) {
  if (!facts || !plain(entry?.states)) return {};
  const ok = Object.fromEntries(Object.entries(entry.states).filter(([p, s]) => stateRefusal(entry, p, s, facts) == null));
  return expandStates(ok, facts.bindings);
}

// THE READINGS TO SHOW for one entry: {source, at, badges: [{path, ...values}]},
// or null when it has none it can show. A PDU that measures nothing shows none.
export function readingsFor(entry, facts) {
  const r = entry?.readings;
  if (!plain(r) || !facts || facts.metering === 'none') return null;
  const badges = Object.entries(plain(r.values) ? r.values : {}).filter(([, v]) => plain(v)).map(([path, v]) => ({path, ...v}));
  return {source: r.source, at: r.at, badges};
}

// WHAT IS KEPT AND NOT APPLIED, one sentence each, for every item and every
// part beside the rack whose device facts are loaded (`ctx.slotsOf`, from
// `loadSlots`). The settle step of states and readings: the rack is
// not changed, since nothing here is a repair.
export function stateNotices(rack, ctx = {}) {
  const out = [];
  if (typeof ctx.slotsOf !== 'function') return out;
  for (const entry of [...(rack.items || []), ...zeroUOf(rack)]) {
    const facts = configFacts(ctx.slotsOf(entry.ref), entry.cfg);
    if (!facts) continue;
    for (const [path, state] of Object.entries(plain(entry.states) ? entry.states : {})) {
      const no = stateRefusal(entry, path, state, facts);
      if (no) out.push(no);
    }
    const paths = Object.keys(plain(entry.readings?.values) ? entry.readings.values : {});
    if (facts.metering === 'none' && paths.length)
      out.push(`${ctx.chassisOf?.(entry.ref)?.model ?? entry.ref} measures nothing, so there is no reading for ${paths.join(', ')}.`);
  }
  return out;
}
