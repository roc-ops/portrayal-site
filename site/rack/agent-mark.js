// site/rack/agent-mark.js
// WHAT AN AGENT TOUCHED, for the page to point at (spec §5): every id its
// commands name, plus every item or cable the change created. A cable end's
// item is where a cable runs to, not something the agent changed.

export function touchedIds(ev) {
  const ids = new Set(ev.commands.map(c => c?.id).filter(v => typeof v === 'string' && !v.startsWith('@')));
  // A part beside the rack (rack.zeroU) is touched as an item is.
  const all = r => [...(r?.items ?? []), ...(r?.cables ?? []), ...(Array.isArray(r?.zeroU) ? r.zeroU : []).filter(z => z && typeof z.id === 'string')];
  const had = new Set(all(ev.before).map(x => x.id));
  for (const x of all(ev.after)) if (!had.has(x.id)) ids.add(x.id);
  return [...ids];
}

// The highlight is a class on the drawn elements: never in the document, never
// in an export.
export function markTouched(root, ids, on) {
  for (const id of ids) {
    const q = CSS.escape(id);
    for (const n of root.querySelectorAll(`svg [data-item-id="${q}"], svg [data-cable-id="${q}"], svg [data-zerou-id="${q}"]`))
      n.classList.toggle('rk-agent-touched', on);
  }
}
