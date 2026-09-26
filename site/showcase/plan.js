// The patching plan stages 4 and 5 cable (patching.json), and the one rule for
// applying its seats to the rack. The plan is INVENTED - the panel says so -
// and check-contract.py proves every end against the compiled faces.
//
// THE FILL RULE (spec §4.3). A plan seat is applied only where the rack holds
// nothing of the visitor's: no override at that key. A key the visitor set,
// to anything other than the plan's ref (a different card, or null for a bay
// emptied in the Inspect lens), is KEPT, and nothing under it is the plan's to
// fill - its cables become loose ends, and looseReason says why.

import {shortRef} from './rack.js';

let memo = null;
export async function loadPlan() {
  if (memo) return memo;
  const r = await fetch(new URL('./patching.json', import.meta.url));
  if (!r.ok) throw new Error(`patching.json: HTTP ${r.status}`);
  memo = await r.json();
  return memo;
}

export const endView = end => end[2] || 'front';
export const isFiber = link => link.media !== 'copper';

// Every seat the plan has made, once per device and key (a re-seat that the
// plan fills again is the same seat). planSeatsMade(overrides) counts only
// those the rack still holds: a card the visitor seated since takes its
// cages' plan seats with it.
const made = new Map();
export const planSeatsMade = (ov = null) => [...made.values()]
  .filter(s => !ov || ov[s.dev]?.[s.key] === s.ref);

// Is `key` below `parent` - a card's cage under its slot, a plug under its optic?
const below = (key, parent) => key.startsWith(parent + '/') || key.startsWith(parent + '-occupant');

// Drop every override key below `key` in one device's map `ov`: the cages and
// plugs of whatever `key` held before. Called when a bay takes a new card, so
// the old card's seats do not outlive it (stage 2's doSeat).
export function dropBelow(ov, key) {
  for (const k of Object.keys(ov)) if (below(k, key)) delete ov[k];
}

export function applyPlanSeats(plan, overrides) {
  const now = [], kept = [];
  for (const [dev, seats] of Object.entries(plan.seats || {})) {
    const ov = overrides[dev] = overrides[dev] || {};
    const blocked = [];
    for (const [key, ref] of Object.entries(seats)) {       // the file lists parents first
      if (blocked.some(b => below(key, b))) continue;
      if (!Object.hasOwn(ov, key)) {
        ov[key] = ref;
        const s = {dev, key, ref};
        now.push(s); made.set(`${dev}\n${key}`, s);
      } else if (ov[key] !== ref) {
        kept.push({dev, key, ref, have: ov[key]});
        blocked.push(key);
      }
    }
  }
  return {made: now, kept};
}

// Why an end did not land, from what the fill rule kept - never a guess.
export function looseReason(plan, kept, [dev, path]) {
  const k = kept.find(x => x.dev === dev && (path === x.key || below(path, x.key)));
  if (k) return `${dev} ${k.key} holds ${k.have ? shortRef(k.have) : 'nothing'}, not the plan's ${shortRef(k.ref)} — seat it in stage 2 to connect this cable`;
  return `${dev} ${path} is not on the drawing`;
}

// {value -> count} for a link field (media, purpose), in first-seen order:
// derived from the plan, so a new value shows up with its own count.
export function countsBy(plan, field) {
  const m = new Map();
  for (const l of plan.links || []) m.set(l[field], (m.get(l[field]) || 0) + 1);
  return m;
}
