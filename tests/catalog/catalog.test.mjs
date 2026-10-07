import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catalogSize, catalogRow, catalogGroups, catalogMatches } from '../../site/catalog-page.js';

// THE SIZE COLUMN IS WHAT UPSTREAM'S GENERATOR WRITES, to the character.
// components_catalogue.py prints w x h x d in millimeters with a U+00D7
// between, drops a dimension the component does not have, and writes the
// number as a number - 13, not 13.0. A row that reads 28 x 20 x 13.0 here and
// 28 x 20 x 13 in CATALOGUE.md is a page that cannot be checked against its
// own source, so the separator and the number format are both asserted.
test('the size column is millimeters, U+00D7 separated, with no trailing zeros', () => {
  assert.equal(catalogSize({w: 28, h: 20, d: 13}), '28 × 20 × 13');
  assert.equal(catalogSize({w: 9.7, h: 8.85}), '9.7 × 8.85');
  assert.equal(catalogSize({w: 82, h: 13.6, d: 144.8}), '82 × 13.6 × 144.8');
});

// One real row, copied out of the generator's own output for std/bnc@1:
//   | `std/bnc@1` | component | port | 9.7 x 8.85 | bnc | 0 | 3 | BNC bayonet...
// `major` is the major's directory ("v1"), the same thing as the "@1" in a
// ref, so the ref is built from it rather than assuming every component is @1.
test('a row carries the eight catalog columns, with the ref built from the major', () => {
  const row = catalogRow({
    ns: 'std', name: 'bnc', major: 'v1', kind: 'component', class: 'port',
    size: {w: 9.7, h: 8.85}, conforms: 'bnc', seats: 0, 'composed-by': 3,
    description: 'BNC bayonet coaxial panel jack core (IEC 61169-8) - the D-hole and the collar.',
  });
  assert.deepEqual(row, {
    ref: 'std/bnc@1',
    kind: 'component',
    cls: 'port',
    size: '9.7 × 8.85',
    iface: 'bnc',
    devices: 0,
    inParts: 3,
    what: 'BNC bayonet coaxial panel jack core (IEC 61169-8) - the D-hole and the collar.',
  });
});

// THE INTERFACE COLUMN IS THREE FIELDS IN ORDER, and one of them is a trap.
// The generator prints `conforms`, else `interface`, else `mates`. Sparse
// `conforms` is normal: it is set on about a tenth of the library, which is why
// the other two exist. `mates` is an interface NAME; the similarly spelled
// `mate` is a POINT - a two-number array - and a row that reached for it would
// print coordinates into this column, which is the kind of wrong that looks
// like data rather than a bug.
test('the interface column is conforms, else interface, else mates - never mate', () => {
  const col = c => catalogRow({ns: 'x', name: 'y', major: 'v1', size: {w: 1}, ...c}).iface;
  assert.equal(col({conforms: 'usb-a', interface: 'if', mates: 'm'}), 'usb-a');
  assert.equal(col({interface: 'qsfp28', mates: 'm'}), 'qsfp28');
  assert.equal(col({mates: 'c13-cord'}), 'c13-cord');
  assert.equal(col({}), '');
  assert.equal(col({mate: [6, 2.25]}), '', 'mate is a point and must never reach this column');
});

// THE SECTION ORDER IS NOT ALPHABETICAL, and sorting the namespaces would put
// amphenol above common and quietly disagree with the generator. std, common
// and generic are the shared namespaces every vendor draws on, and the
// generator prints them first, in that order; the vendors follow in
// alphabetical order. A namespace that is not one of the three sorts with the
// vendors even if it would sort before them.
test('sections are std, common, generic, then the vendors alphabetically', () => {
  const c = (ns, name) => ({ns, name, major: 'v1', size: {w: 1}});
  const groups = catalogGroups([
    c('dell', 'a'), c('generic', 'b'), c('amphenol', 'c'),
    c('std', 'd'), c('cisco', 'e'), c('common', 'f'), c('cisco', 'g'),
  ]);
  assert.deepEqual(groups.map(g => g.ns), ['std', 'common', 'generic', 'amphenol', 'cisco', 'dell']);
  assert.deepEqual(groups.map(g => g.rows.length), [1, 1, 1, 1, 2, 1], 'each section counts its own majors');
});

// Within a section the generator lists majors by ref, so a reader can find one
// by scanning. Sorting the whole library once and grouping after would do it,
// but the rows arrive in whatever order the build wrote them.
test('rows within a section are ordered by ref', () => {
  const c = (name) => ({ns: 'std', name, major: 'v1', size: {w: 1}});
  const [std] = catalogGroups([c('qsfp28'), c('bnc'), c('c14-inlet')]);
  assert.deepEqual(std.rows.map(r => r.ref), ['std/bnc@1', 'std/c14-inlet@1', 'std/qsfp28@1']);
});

// SEARCHING THE CATALOG MEANS SEARCHING THE ROW A READER SEES, not the
// component record behind it. The fields are the ones printed: the ref, the
// kind, the class, the interface and the description. components.html searches
// the same shape, so the two pages answer a query the same way.
test('search matches any printed column, case-insensitively; the namespace filter is exact', () => {
  const c = {ns: 'std', name: 'c14-inlet', major: 'v1', kind: 'component', class: 'inlet',
             size: {w: 28, h: 20, d: 13}, conforms: 'c14-inlet', seats: 4, 'composed-by': 63,
             description: 'IEC C14 appliance inlet (mates C13 cords)'};
  const m = (q, ns) => catalogMatches(c, {q, ns});
  assert.equal(m('C13 CORDS', ''), true, 'the description, case-insensitively');
  assert.equal(m('inlet', ''), true, 'the class');
  assert.equal(m('std/c14', ''), true, 'the ref');
  assert.equal(m('qsfp', ''), false);
  assert.equal(m('', 'std'), true);
  assert.equal(m('', 'cisco'), false, 'the namespace filter is exact, not a substring');
  assert.equal(m('', ''), true, 'no query and no namespace is everything');
});

// AGAINST THE REAL LIBRARY, not a fixture. The rules above are pinned on
// handmade rows, which proves the rules and not the data: a field renamed
// upstream would leave every test above green and the page empty. So this
// reads what the site actually vendors.
//
// The one row asserted in full is copied from the generator's own output for
// std/bnc@1 (CATALOGUE.md, before Portrayal #843 stopped committing it). That
// file cannot be a fixture here - it is not vendored, and it is being deleted -
// so this is the record of what the two agreed on when the page was written.
test('every vendored major appears once, and a known row reads as the generator wrote it', async () => {
  const {readFileSync} = await import('node:fs');
  const {components} = JSON.parse(readFileSync(new URL('../../assets/dist/components.json', import.meta.url)));
  const groups = catalogGroups(components);
  const rows = groups.flatMap(g => g.rows);
  assert.equal(rows.length, components.length, 'no major is dropped or duplicated by the grouping');
  assert.equal(new Set(rows.map(r => r.ref)).size, rows.length, 'every ref is distinct');
  assert.equal(groups.length, new Set(components.map(c => c.ns)).size, 'one section per namespace');

  const bnc = rows.find(r => r.ref === 'std/bnc@1');
  assert.ok(bnc, 'std/bnc@1 is in the library');
  assert.equal(bnc.kind, 'component');
  assert.equal(bnc.cls, 'port');
  assert.equal(bnc.size, '9.7 × 8.85');
  assert.equal(bnc.iface, 'bnc');
  assert.equal(bnc.devices, 0);
  assert.equal(bnc.inParts, 3);
  assert.match(bnc.what, /^BNC bayonet coaxial panel jack core \(IEC 61169-8\)/);

  // seats and composed-by arrive from upstream (#847) and are on every entry;
  // a row whose counts are undefined prints an empty column that reads as zero.
  const blank = rows.filter(r => r.devices == null || r.inParts == null);
  assert.deepEqual(blank, [], 'every row has both counts');
});
