// tests/rack/zero-u.test.mjs
// PARTS BESIDE THE RACK AND ON ONE RAIL, AS THE SITE USES THEM (kit 0.6.0, #926).
// The commands, fit rules, lanes and fill are the kit's and are tested there;
// these hold the site to using them: the kit's editor takes zerou.* and side.*
// directly, a site-saved file reads back whole through library.js, the site's
// duct channel is handed to the kit's fill (counted once, marked estimated),
// and the exports word the parts as the kit does.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {newDoc, serialize, withFrame, zeroUOf, zeroUBottom, VERSION} from '../../vendor/rack/model.js';
import {createRackEditor} from '../../vendor/rack/editor.js';
import {COMMANDS} from '../../vendor/rack/commands.js';
import {isZeroUPart, isNarrow, fits, fitsZeroU} from '../../vendor/rack/fit.js';
import {fill, capacityOver} from '../../vendor/rack/route.js';
import {zeroUNotes, zeroUImportItems, deviceImportRows, managerNotes, rackNotes, fillNotes} from '../../vendor/rack/export-data.js';
import {readDoc, docNotes} from '../../site/rack/library.js';
import {ductAperture, guidesFromRects} from '../../site/rack/route-context.js';

const devices = JSON.parse(readFileSync(new URL('../../assets/dist/rack.json', import.meta.url))).devices;
const chassisOf = ref => devices[ref] ?? null;
const DUCT = 'cmv-sfd45u5w', BRACKET = 'cmv-5u3w';
const rackOf = (kind = 'two-post', heightRU = 45) => withFrame(newDoc({kind}).racks[0], {heightRU});
const editorOf = rack => createRackEditor({doc: {...newDoc(), racks: [rack]}, chassisOf});

test('the catalogue has the rack-side duct and the narrow bracket the page places', () => {
  assert.ok(isZeroUPart(chassisOf(DUCT)));
  assert.equal(chassisOf(DUCT).ru, 45);
  assert.ok(isNarrow(chassisOf(BRACKET)));
  assert.ok(!isNarrow(chassisOf('fhd-cmp5dr')));
});

test('the kit\'s own editor takes zerou.* and side.*, each one undo step', () => {
  for (const op of ['zerou.place', 'zerou.update', 'zerou.remove', 'side.place', 'side.set']) assert.ok(op in COMMANDS, op);
  const ed = editorOf(rackOf());
  const res = ed.apply([{op: 'zerou.place', ref: DUCT, at: 'left', ru: 1, as: 'duct'},
                        {op: 'side.place', ref: BRACKET, face: 'front', ru: 10, side: 'right'},
                        {op: 'zerou.update', id: '@duct', label: 'vcm-1'}]);
  assert.ok(!res.error, res.error);
  assert.equal(res.created.duct, 'z1');
  const r = ed.rack();
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].side, 'right');
  assert.deepEqual(zeroUOf(r).map(z => [z.id, z.at, z.label, zeroUBottom(z)]), [['z1', 'left', 'vcm-1', 1]]);
  // The kit refuses a duct on the rails, and a second duct on the same upright.
  assert.match(ed.apply({op: 'place', ref: DUCT, face: 'front', ru: 1}).error, /zerou\.place/);
  assert.match(ed.apply({op: 'zerou.place', ref: DUCT, at: 'left', ru: 1}).error, /Overlaps/);
  // What the page's summary and drag preview call: the kit's fits, the item's side included.
  for (const it of r.items) assert.deepEqual(fits(r, it, chassisOf, {ignoreId: it.id}), {ok: true});
  for (const z of zeroUOf(r)) assert.deepEqual(fitsZeroU(r, z, chassisOf, {ignoreId: z.id}), {ok: true});
  ed.undo();
  assert.equal(ed.rack().items.length, 0);
  assert.equal(zeroUOf(ed.rack()).length, 0);
});

// A FILE AN OLDER SITE SAVED: version 2, with the `side` the site's own reader
// used to put back and a zero-U entry with no id. The kit's reader keeps both
// now and migrates it, and the next save writes VERSION.
const v2File = () => ({
  format: 'portrayal-rack', version: 2, id: 'doc-v2',
  racks: [{id: 'r1', name: 'Saved v2', frame: {kind: 'two-post', heightRU: 45},
    items: [{id: 'i1', ref: BRACKET, cfg: 'base', label: 'fb-1', ru: 20, face: 'front', turned: false, swaps: {}, fields: {}, side: 'right'}],
    zeroU: [{id: 'z1', ref: DUCT, cfg: 'base', label: 'vcm-1', at: 'left', offsetMm: 0},
            {ref: DUCT, cfg: 'base', label: 'vcm-2', at: 'right', offsetMm: 0, between: true}],
    cables: []}]});

test('a version 2 rack the site saved reads back whole through library.js, and saves as version 3', () => {
  assert.equal(VERSION, 3);
  for (const input of [v2File(), JSON.stringify(v2File())]) {
    const doc = readDoc(input);
    assert.equal(doc.version, 3);
    assert.equal(doc.id, 'doc-v2');
    const r = doc.racks[0];
    assert.equal(r.items[0].side, 'right');
    assert.deepEqual(r.zeroU.map(z => [z.id, z.at, z.between === true]), [['z1', 'left', false], ['z2', 'right', true]]);
    assert.deepEqual(docNotes(doc), []);
    const saved = JSON.parse(serialize(doc));
    assert.equal(saved.version, 3);
    // read again, it is the same document
    assert.deepEqual(readDoc(saved), doc);
  }
  // A version 1 file (the browser checks' fixtures) migrates the same way.
  assert.equal(readDoc({...v2File(), version: 1}).version, 3);
  // A file newer than this page is refused with a sentence.
  // The kit says what it reads; the page adds what to do about it, once.
  assert.throws(() => readDoc({...v2File(), version: 4}),
                {message: 'This rack file is version 4; this reader supports up to version 3. Reload to get the newer page.'});
});

test('what parseDoc says of a bundle it repaired reaches the editor\'s first findings', () => {
  const f = v2File();
  f.version = 3;
  f.racks[0].cables = [{id: 'c1', a: {item: 'i1', path: 'p', view: 'front'}, b: {item: 'i1', path: 'q', view: 'front'}}];
  f.racks[0].bundles = [{id: 'b1', number: 1, label: '', members: [{cable: 'c1'}, {cable: 'c9'}], route: []}];
  const doc = readDoc(f);
  const notes = docNotes(doc);
  assert.equal(notes.length, 1);
  assert.match(notes[0], /^Saved v2: /);
  assert.deepEqual(doc.racks[0].bundles[0].members, [{cable: 'c1'}]);
  const ed = createRackEditor({doc: newDoc(), chassisOf});
  const {findings} = ed.loadDoc(doc, {notes});
  assert.deepEqual(findings[0], {kind: 'note', text: notes[0]});
});

test('a duct\'s channel is the site\'s estimate, marked so, and the kit counts the duct once', () => {
  // The guide rect on the duct's front view: 93.4 mm wide; the part is 165.1 mm deep.
  const ap = ductAperture([{id: 'guide--duct', cls: 'guide', x: 0, y: 0, w: 93.4, h: 2000}], chassisOf(DUCT).d);
  assert.deepEqual(ap, {w: 93.4, h: chassisOf(DUCT).d, estimated: true});
  assert.equal(ductAperture([], 100), null);
  let r = editorOf(rackOf()).apply({op: 'zerou.place', ref: DUCT, at: 'left', ru: 1});
  r = {...r.rack, cables: [{id: 'c1', a: {item: 'x', path: 'p'}, b: {item: 'y', path: 'q'}, media: 'os2', route: [{lane: 'left', ru: 10}, {lane: 'left', ru: 30}], routeEdited: true}]};
  const ctx = {chassisOf, guidesOf: () => [], portX: () => null, zeroUAperture: z => (z.id === 'z1' ? ap : null)};
  const got = fill(r, ctx).filter(e => e.item === 'z1');
  assert.equal(got.length, 1);
  assert.deepEqual([got[0].count, got[0].cables, got[0].zeroU], [1, ['c1'], true]);
  assert.equal(got[0].percent, Math.round(Math.PI * 1.5 ** 2 / (0.4 * 93.4 * chassisOf(DUCT).d) * 100));
  assert.deepEqual(capacityOver(r, ctx), []);
  // the notes read the kit's entries as they are
  assert.deepEqual(fillNotes(r, {fill: [{...got[0], over: true}], over: [], routes: new Map(), ctx}, () => 'vcm-1'),
    [`${got[0].via} on vcm-1: 1 cables, ${got[0].percent}% of a 40% fill.`]);
});

test('every guide carries its run; a duct\'s square aperture is marked estimated, a pass is not', () => {
  const rects = [{id: 'guide-1-end', kind: 'ring', x: 10, y: 0, w: 6.8, h: 40},
                 {id: 'guide--tray', cls: 'guide', run: 'x', x: 0, y: 10, w: 400, h: 30},
                 {id: 'guide--up', cls: 'guide', run: 'y', x: 0, y: 0, w: 90, h: 400},
                 {id: 'guide--old', cls: 'guide', run: null, x: 0, y: 0, w: 90, h: 30},
                 {id: 'pass--brush', cls: 'pass', x: 0, y: 0, w: 300, h: 20}];
  const g = Object.fromEntries(guidesFromRects(rects, 'front', 483).map(x => [x.via, x]));
  assert.deepEqual(Object.values(g).map(x => [x.via, x.run]),
    [['guide-1', 'x'], ['tray', 'x'], ['up', 'y'], ['old', 'x'], ['brush', 'z']]);
  assert.deepEqual(g.tray.aperture, {w: 30, h: 30, estimated: true});
  assert.deepEqual(g.brush.aperture, {w: 300, h: 20});
});

test('the exports word a part beside the rack and a part on one rail as the kit does', () => {
  const ed = editorOf(rackOf());
  ed.apply([{op: 'zerou.place', ref: DUCT, at: 'right', ru: 1, label: 'vcm-1', between: true},
            {op: 'side.place', ref: BRACKET, face: 'front', ru: 20, side: 'left', label: 'fb-1'}]);
  const r = ed.rack();
  assert.deepEqual(zeroUNotes(r, chassisOf),
    ['vcm-1: FS.com CMV-SFD45U5W, 0U, between racks at right, U1-U45; it serves the next rack too, which this file does not hold.']);
  assert.match(managerNotes(r.items, chassisOf, r.frame)[0], /^fb-1: .*at U20, front, left rail\.$/);
  // An export that carries the parts calls none left out; one entry it cannot place still is.
  assert.deepEqual(rackNotes(r, {cables: false, zeroU: false, chassisOf}), []);
  const odd = {...r, zeroU: [...r.zeroU, {id: 'z9', ref: 'fhd-cmp5dr', at: 'left', offsetMm: 0}]};
  assert.deepEqual(rackNotes(odd, {cables: false, zeroU: false, chassisOf}), ['1 zero-U item is not in this export yet.']);
  // The DCIM row: no position, no face, where it stands in the comment.
  const items = zeroUImportItems(r, chassisOf).map(z => ({...z, face: 'front', turned: false, swaps: {}, fields: {}}));
  const types = new Map([['z1', {manufacturer: 'FS.com', model: 'CMV-SFD45U5W'}]]);
  const {rows} = deviceImportRows({rack: r, items, types, target: 'netbox'});
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].position, rows[0].face], ['', '']);
  assert.equal(rows[0].comments, '0U, between racks at right, U1-U45, serving the next rack too; NetBox has no field for that.');
});
