// THE COMPONENT CATALOG, as upstream's own generator writes it.
//
// Portrayal's components_catalogue.py wrote library/components/CATALOGUE.md,
// and Portrayal #843 stops committing it, so GitHub's view of that file - the
// only browsable copy there has ever been - goes away. This page is where it
// lives instead, built from assets/dist/components.json, which the site already
// vendors and which carries every column the generator printed.
//
// The rows are meant to read the same as the generator's, to the character:
// upstream's README links here, and a reader who follows that link and finds a
// table that disagrees with the one they remember has no way to tell which is
// wrong. So the formatting rules below are the generator's rules, not this
// page's preferences, and tests/catalog pins them.

// A COMPONENT'S SIZE, in millimeters, as the catalog column reads it: the
// dimensions it has, separated by U+00D7, and each written as a number rather
// than a fixed decimal - 13, never 13.0. A component with no depth is two
// dimensions, not three with a blank, which is why this filters rather than
// formatting a fixed triple.
export const catalogSize = size =>
  [size?.w, size?.h, size?.d].filter(v => v).map(v => String(+v)).join(' × ');

// ONE CATALOG ROW. The names are the column headings the generator printed,
// shortened only where a heading is two words ("in parts" -> inParts) or a
// reserved word ("class" -> cls).
export const catalogRow = c => ({
  ref: `${c.ns}/${c.name}@${String(c.major ?? 'v1').slice(1)}`,
  kind: c.kind,
  cls: c.class,
  size: catalogSize(c.size),
  iface: c.conforms || c.interface || c.mates || '',
  devices: c.seats,
  inParts: c['composed-by'],
  what: c.description || '',
});

// THE SHARED NAMESPACES COME FIRST, in this order, and the vendors follow
// alphabetically. This is the generator's order, not a sort: `amphenol` sorts
// before `common` and a plain sort would put it there, disagreeing with the
// file this page stands in for. Anything not named here is a vendor.
const SHARED = ['std', 'common', 'generic'];
const nsOrder = ns => {
  const i = SHARED.indexOf(ns);
  return i < 0 ? [1, ns] : [0, String(i)];
};

// THE LIBRARY AS SECTIONS, one per namespace, each holding its own majors by
// ref. The rows arrive in whatever order the build wrote components.json, so
// both levels are ordered here rather than assumed.
export function catalogGroups(components) {
  const by = new Map();
  for (const c of components) {
    if (!by.has(c.ns)) by.set(c.ns, []);
    by.get(c.ns).push(catalogRow(c));
  }
  return [...by.keys()]
    .sort((a, b) => {
      const [ga, sa] = nsOrder(a), [gb, sb] = nsOrder(b);
      return ga - gb || sa.localeCompare(sb);
    })
    .map(ns => ({ns, rows: by.get(ns).sort((x, y) => x.ref.localeCompare(y.ref))}));
}

// DOES THIS COMPONENT ANSWER THE READER'S QUERY. The haystack is the row as
// printed, so a search finds what the reader can see and nothing they cannot:
// searching the record would match fields no column shows, and a hit the
// reader cannot account for reads as a bug in the search. The namespace is a
// separate, exact choice rather than part of the text, because `cisco` as a
// substring also hits a description that merely mentions Cisco.
export const catalogMatches = (c, {q = '', ns = ''} = {}) => {
  if (ns && c.ns !== ns) return false;
  if (!q) return true;
  const r = catalogRow(c);
  return `${r.ref} ${r.kind} ${r.cls} ${r.iface} ${r.what}`.toLowerCase().includes(q.toLowerCase());
};
