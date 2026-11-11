// Select-and-apply for the schematic page's slots: pick several slots, offer
// only what every one of them accepts, set them all at once, take it back.
//
// Pure: no DOM, no fetch. A bay here is what schematic.html holds per slot -
// {id, accepts, chosen, group, face} - where `accepts` are versioned refs
// (`casa/bdm2@1`) and `chosen` is a ref without its version ('' for empty).
// Slots are named by their index in the page's bay list, which is stable for
// as long as one device is open.

export const refKey = r => String(r || '').split('@')[0];
const isBlank = r => /blank|filler/i.test(refKey(r).split('/').pop());

/** What every one of `bays` accepts, as version-less refs, in the first slot's
 *  order. A blank faceplate is not offered (the page's "— empty —" is how a slot
 *  is left bare). Nothing selected, or nothing in common, is []. */
export function commonAccepts(bays) {
  if (!bays.length) return [];
  const sets = bays.map(b => new Set((b.accepts || []).filter(a => !isBlank(a)).map(refKey)));
  return [...sets[0]].filter(k => sets.every(s => s.has(k)));
}

/** The indices from `a` to `b` inclusive, in either order, taken from `order`
 *  (the indices in the order the page lists them). An end the list lacks gives
 *  the other end alone. */
export function rangeOf(order, a, b) {
  const i = order.indexOf(a), j = order.indexOf(b);
  if (i < 0 || j < 0) return [a, b].filter(x => order.includes(x));
  return order.slice(Math.min(i, j), Math.max(i, j) + 1);
}

/** The slot groups the device declares, one per face and group, each with its
 *  slots' indices in declared order. */
export function groupsOf(bays) {
  const out = new Map();
  bays.forEach((b, i) => {
    const k = `${b.face}\u0000${b.group || ''}`;
    if (!out.has(k)) out.set(k, {face: b.face, group: b.group || '', indices: []});
    out.get(k).indices.push(i);
  });
  return [...out.values()];
}

/** The slots that hold nothing. */
export const emptyOf = bays => bays.flatMap((b, i) => b.chosen ? [] : [i]);

/** Setting `selected` (indices) to `ref` ('' is empty). Returns the changes, each
 *  with what the slot held, and the slots that were left alone because they do
 *  not accept `ref`. Changes nothing itself: the caller writes `now`, and keeps
 *  `was` for Undo. */
export function applyChoice(bays, selected, ref) {
  const changes = [], skipped = [];
  for (const i of selected) {
    const b = bays[i];
    const ok = ref === '' || (b.accepts || []).some(a => !isBlank(a) && refKey(a) === ref);
    if (!ok) skipped.push(i);
    else if ((b.chosen || '') !== ref) changes.push({i, was: b.chosen || '', now: ref});
  }
  return {changes, skipped};
}

/** Undo: each apply (or single-slot change) is one step. */
export function makeHistory() {
  const stack = [];
  return {
    push(changes) { if (changes.length) stack.push(changes); },
    undo() { return stack.pop() || null; },
    clear() { stack.length = 0; },
    get size() { return stack.length; },
  };
}
