// The entity-map join (portrayal-site#12), as pure functions.
//
// A listing's `entity-map` (assets/schemas/listing.schema.json) is a list of
// rules {match, to, source?, range?, note?}: `match` is a NOS component name
// pattern ('sfp{n}'), `to` the id of the drawn part ('port-{n}') or a region
// ('region:internal'), `range` the 'lo-hi' values {n} may take. This module
// applies those rules to the component names a NOS dump holds. It reads no
// file and touches no DOM; site/entities-page.js feeds it and draws the result.
//
// {n} is the only placeholder the schema documents. The shipped listings also
// write {n+1} ('psu{n}' 0-1 -> 'psu-{n+1}', their note: "names psu0/psu1; own
// labels say PSU-1/PSU-2"), so a target may carry an integer offset, + or -.
// A name no rule claims is unmapped, which the schema calls legal.

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function parseRange(range) {
  if (range == null || range === '') return null;
  const m = /^\s*(-?\d+)\s*-\s*(-?\d+)\s*$/.exec(String(range));
  return m ? [Number(m[1]), Number(m[2])] : undefined;   // undefined: not a range we can read
}

// The value of {n} when `name` is the rule's pattern, null when it is a
// pattern with no {n} and the name is equal to it, and false when it does not match.
export function matchName(rule, name) {
  const pat = String(rule.match ?? '');
  const at = pat.indexOf('{n}');
  if (at < 0) return pat === name ? null : false;
  const m = new RegExp(`^${esc(pat.slice(0, at))}(\\d+)${esc(pat.slice(at + 3))}$`).exec(name);
  if (!m) return false;
  const n = Number(m[1]);
  const r = parseRange(rule.range);
  if (r === undefined) return false;
  return r && (n < r[0] || n > r[1]) ? false : n;
}

// The drawn id a rule gives a name: 'port-{n}' with n = 4 is 'port-4';
// 'psu-{n+1}' with n = 0 is 'psu-1'.
export function targetOf(rule, n) {
  return String(rule.to ?? '').replace(/\{n(?:\s*([+-])\s*(\d+))?\}/g,
    (_, sign, k) => String(n + (sign ? (sign === '-' ? -1 : 1) * Number(k) : 0)));
}

export function regionOf(to) {
  return String(to).startsWith('region:') ? String(to).slice('region:'.length) : null;
}

// Join the rules onto the names of one tree.
//   rows      one per name a rule claims, in the dump's order:
//             {name, to, region, rule, note}   (region is null for a part)
//   unmapped  names no rule claims
//   conflicts names two rules claim with different targets: joined to neither
// `source` is the tree the names came from; a rule with another `source` is
// not applied, one with none applies to every tree.
export function joinNames(rules, names, source = 'openconfig') {
  const live = (rules || []).map((rule, i) => ({rule, i}))
    .filter(({rule}) => !rule.source || rule.source === source);
  const rows = [], unmapped = [], conflicts = [];
  for (const name of names) {
    const hits = [];
    for (const {rule, i} of live) {
      const n = matchName(rule, name);
      if (n === false) continue;
      hits.push({rule: i, to: targetOf(rule, n ?? 0), note: rule.note});
    }
    if (!hits.length) { unmapped.push(name); continue; }
    if (new Set(hits.map(h => h.to)).size > 1) { conflicts.push({name, to: hits.map(h => h.to)}); continue; }
    const h = hits[0];
    rows.push({name, to: h.to, region: regionOf(h.to), rule: h.rule, note: h.note || ''});
  }
  return {rows, unmapped, conflicts};
}

// The component names an OpenConfig `show components | display json` document
// holds: its `component` list, and the transceivers ArcOS keeps beside it.
// Both listings' `sfp{n}` rules name the transceivers.
export function componentNames(doc) {
  const c = doc?.data?.['openconfig-platform:components'] ?? doc?.['openconfig-platform:components'];
  if (!c) return [];
  const out = [];
  for (const x of c.component || []) if (x?.name) out.push(x.name);
  for (const x of c['arcos-platform-transceiver:transceivers']?.state?.transceiver || []) if (x?.name) out.push(x.name);
  return out;
}

// The listings that have an entity-map, and those that have none (the page says
// so for those). `listings` is listings.json's `listings` object.
export function entityListings(listings) {
  const withMap = [], without = [];
  for (const [key, l] of Object.entries(listings || {}).sort(([a], [b]) => a.localeCompare(b))) {
    (Array.isArray(l['entity-map']) && l['entity-map'].length ? withMap : without).push(key);
  }
  return {withMap, without};
}

// The dump a listing names for the OpenConfig components tree, or null.
export function componentsDump(listing) {
  return (listing?.dumps || []).find(p => /openconfig-components\.json$/.test(p)) ?? null;
}
