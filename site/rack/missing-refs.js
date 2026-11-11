// A STORED PART THE LIBRARY NO LONGER HOLDS, SAID IN THE RACK BUILDER (#183).
// When the library retires a component major its files leave assets/dist, and a
// rack that names the old ref loads with that slot on its default, silently.
// The choice stays in the document; this only finds those slots and words the
// line the side panel shows for as long as they are there. It does not look for
// what replaced a ref. Pure, so the page and the tests share one rule.

const SHOWN = 5;   // sentences shown; beyond that the rest are counted

const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);

// [{item, label, path, ref}]: every swap of the rack's items and zeroU parts
// whose ref `ctx.compByRef` (loadSlots) does not know. An empty string is a slot
// emptied on purpose. A library that did not load (no `redirects.catalogued`)
// says nothing: every ref would look absent.
export function missingRefs(rack, ctx) {
  if (!ctx?.redirects?.catalogued || typeof ctx.compByRef !== 'function' || !plain(rack)) return [];
  const known = ref => { try { return ctx.compByRef(ref); } catch { return null; } };
  const found = [];
  for (const it of [...(rack.items ?? []), ...(rack.zeroU ?? [])]) {
    if (!plain(it) || !plain(it.swaps)) continue;
    const label = typeof it.label === 'string' && it.label ? it.label : String(it.id ?? '');
    for (const [path, ref] of Object.entries(it.swaps)) {
      if (typeof ref !== 'string' || !ref) continue;
      if (!known(ref)) found.push({item: it.id, label, path, ref});
    }
  }
  return found;
}

// One sentence per device, and at most SHOWN lines.
export function missingTexts(found) {
  const byItem = new Map();
  for (const f of found ?? []) {
    if (!byItem.has(f.item)) byItem.set(f.item, []);
    byItem.get(f.item).push(f);
  }
  const lines = [...byItem.values()].map(list => {
    const names = list.map(f => `slot ${f.path} names ${f.ref}`);
    const joined = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
    const many = list.length > 1;
    return `${list[0].label}: ${joined}, ${many ? 'which are' : 'which is'} not in the library, so ${many ? 'those slots show their defaults' : 'the slot shows its default'}. ${many ? 'The choices stay' : 'The choice stays'} in the file.`;
  });
  if (lines.length <= SHOWN) return lines;
  const rest = lines.length - (SHOWN - 1);
  return [...lines.slice(0, SHOWN - 1),
    `${rest} more ${rest === 1 ? 'device' : 'devices'} name parts the library does not hold; their slots show their defaults.`];
}
