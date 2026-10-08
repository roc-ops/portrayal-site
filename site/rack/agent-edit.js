// site/rack/agent-edit.js
// EDIT_RACK'S PRE-PASS AND RESULT (spec 2026-10-08 section 4): which parts lists
// a batch needs, selectors expanded into plain commands, and the answer built
// in the round-1 order. Pure apart from the readers it is handed.

import {LIMIT} from './agent-text.js';

// Every device the rack holds and every device the batch places: the kit checks
// a batch against their parts lists, which the page loads for the call.
export const refsFor = (rack, commands) => [...new Set([
  ...rack.items.map(i => i.ref),
  ...commands.filter(c => c?.op === 'place' && typeof c.ref === 'string').map(c => c.ref)])];

// Whether a batch routes a cable by hand: then the call also needs the route
// context, so the kit checks waypoints against the configured faces (K8).
export const routes = commands => commands.some(c => c?.op === 'cable.route');

// SELECTORS (spec 2026-10-08 D4): cable.remove and cable.update may name their
// cables by {select: {...}} in place of id. Each is expanded, against the rack
// as it was before the batch, into one plain command per id, so the batch the
// kit checks is ids only. `from[k]` is the index in the batch as sent of
// expanded command k: a refusal names the command the agent wrote.
export const SELECTABLE = new Set(['cable.remove', 'cable.update']);

export const selectorText = sel => `{${Object.entries(sel).map(([k, v]) => `${k}: ${v}`).join(', ')}}`;

export async function expandSelectors(rack, commands, select) {
  const out = [], from = [], selected = [];
  const removed = new Set();   // a cable two removes reach is removed once
  let unchecked = false;
  for (const [i, c] of commands.entries()) {
    const selectable = SELECTABLE.has(c?.op);
    if (!c || typeof c !== 'object' || !('select' in c)) {
      if (selectable && c.id == null) return {error: 'Send id or select.', index: i};
      if (c?.op === 'cable.remove') {
        if (removed.has(c.id)) continue;
        removed.add(c.id);
      }
      out.push(c); from.push(i);
      continue;
    }
    const {select: sel, ...rest} = c;
    if (!selectable) return {error: 'Only cable.remove and cable.update take select.', index: i};
    if ('id' in rest) return {error: 'Send id or select, not both.', index: i};
    if (!sel || typeof sel !== 'object' || Array.isArray(sel)) return {error: 'select is an object, such as {item: "i3"}.', index: i};
    if (Object.values(sel).some(v => typeof v === 'string' && v.startsWith('@')))
      return {error: "select reads the rack as it was before this batch, so it can't use an @name from it.", index: i};
    let r;
    try { r = await select(rack, sel); } catch { return {error: 'The ports could not be read, so which cables are loose is not known.', index: i}; }
    if (r.error) return {error: r.error, index: i};
    if (r.unchecked) unchecked = true;
    if (!r.ids.length) return {error: `No cable matches ${selectorText(sel)}.`, index: i};
    selected.push({op: c.op, ids: r.ids});
    for (const id of r.ids) {
      if (c.op === 'cable.remove') {
        if (removed.has(id)) continue;
        removed.add(id);
      }
      out.push({...rest, id}); from.push(i);
    }
  }
  return {commands: out, from, selected, unchecked};
}

// THE IDS A BATCH WITH SELECTORS REACHED, per op, as the kit will act on them:
// every cable.remove or cable.update in the expanded batch, the ones named by
// id too, each once. A selector and an explicit id that overlap say every cable
// actually removed, not only the selector's share.
export function reached(x) {
  const ops = [...new Set(x.selected.map(s => s.op))];
  return ops.map(op => ({op, ids: [...new Set(x.commands.filter(c => c?.op === op).map(c => c.id))]}));
}

// THE ANSWER, in the round-1 order: names bound, ids created, ids a selector
// reached (`echoed`), the undo line, then the summary and the kit's notes. The
// ids and the undo line are what the next call needs, so the summary is cut
// first, and it leaves the notes room of their own: a swap's orphaned cables
// are said there.
export function editResult(res, {dryRun = false, echoed = [], notes: extra = []} = {}) {
  const named = Object.entries(res.created ?? {}).filter(([k]) => k !== 'ids').map(([k, v]) => `${k} = ${v}`);
  const head = [...(named.length ? [named.join(', ')] : []),
    ...(res.created?.ids?.length ? [`Created: ${res.created.ids.join(', ')}`] : []),
    ...echoed,
    dryRun ? 'Nothing was changed.' : 'Undo takes all of this back in one step.'];
  const notes = [...(res.findings ?? []).map(f => `${f.kind === 'error' ? 'Problem' : 'Note'}: ${f.text}`), ...extra];
  const noteRoom = notes.length ? Math.min(notes.join('\n').length + 1, 700) : 0;
  const room = Math.max(120, LIMIT - head.join('\n').length - 1 - noteRoom);
  const sum = `${dryRun ? 'Would: ' : ''}${res.summary}`;
  const lines = [...head, sum.length <= room ? sum : `${sum.slice(0, Math.max(0, room - 1))}…`];
  for (const n of notes) {
    if ([...lines, n].join('\n').length > LIMIT) break;
    lines.push(n);
  }
  return lines.join('\n');
}
