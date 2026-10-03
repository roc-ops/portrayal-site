import test from 'node:test';
import assert from 'node:assert/strict';
import * as X from '../../site/rack/export-data.js';
import * as M from '../../site/rack/model.js';
import {ITEMS} from './export-data.test.mjs';

const DAY = new Date(2026, 8, 27);
const nb = (vendor, model) => `netbox/device-types/${vendor}/${model}.yaml`;

test('one file is certain; a manufacturer filter comes first', () => {
  assert.deepEqual(X.matchDeviceType({cfg: 'base', manufacturer: 'Telco Systems', paths: [nb('Telco Systems', 'TM-280')]}),
    {path: nb('Telco Systems', 'TM-280'), guess: false, candidates: 1});
  assert.equal(X.matchDeviceType({cfg: 'base', manufacturer: 'X', paths: []}), null);
});

test('a file naming the configuration wins, as a run of its words', () => {
  const paths = ['lff12-mlff4-rlff2-rc0-noriser', 'lff12-rc0-noriser', 'lff12-rc3-1a2a']
    .map(c => nb('Dell', `PowerEdge R740xd ${c}`));
  assert.deepEqual(X.matchDeviceType({cfg: 'lff12-rc0-noriser', manufacturer: 'Dell', paths}),
    {path: paths[1], guess: false, candidates: 3});
  const asr = [nb('Cisco', 'ASR-9006-AC-V2'), nb('Cisco', 'ASR-9006-DC-V2')];
  assert.deepEqual(X.matchDeviceType({cfg: 'dc', manufacturer: 'Cisco', paths: asr}),
    {path: asr[1], guess: false, candidates: 2});
});

test('otherwise the best token score, with airflow and DC aliases, is a guess', () => {
  const paths = ['ArcOS on 7726-32X-O-AC-F', 'ArcOS on 7726-32X-O-AC-B'].map(m => nb('Arrcus', m))
    .concat(['7726-32X-O-48V-B', '7726-32X-O-48V-F', '7726-32X-O-AC-B', '7726-32X-O-AC-F'].map(m => nb('Edgecore', m)));
  assert.deepEqual(X.matchDeviceType({cfg: 'ac-f2b', manufacturer: 'Edgecore', paths}),
    {path: nb('Edgecore', '7726-32X-O-AC-F'), guess: true, candidates: 4});
  assert.equal(X.matchDeviceType({cfg: 'dc-b2f', manufacturer: 'Edgecore', paths}).path, nb('Edgecore', '7726-32X-O-48V-B'));
  const asr = [nb('Cisco', 'ASR-9006-AC-V2'), nb('Cisco', 'ASR-9006-DC-V2')];
  assert.deepEqual(X.matchDeviceType({cfg: 'base', manufacturer: 'Cisco', paths: asr}),
    {path: asr[0], guess: true, candidates: 2});
});

test('falling back past the manufacturer filter is always a guess', () => {
  const arrcus = nb('Arrcus', '7726-32X-O-AC-F');
  assert.deepEqual(X.matchDeviceType({cfg: 'ac-f2b', manufacturer: 'Edgecore', paths: [arrcus]}),
    {path: arrcus, guess: true, candidates: 1});
});

test('yamlHead reads the top-level identity, quoted or not', () => {
  const h = X.yamlHead('---\nmanufacturer: Cisco\nmodel: ASR 9901 Router, AC supplies\nslug: cisco-asr-9901\n' +
                       'u_height: 2.0\nis_full_depth: true\ninterfaces:\n  - name: x\n    model: nested\n');
  assert.deepEqual(h, {manufacturer: 'Cisco', model: 'ASR 9901 Router, AC supplies', slug: 'cisco-asr-9901',
                       uHeight: 2, isFullDepth: true});
  assert.equal(X.yamlHead("model: 'O''Brien 1'").model, "O'Brien 1");
  assert.equal(X.yamlHead('model: "A: B"').model, 'A: B');
  assert.equal(X.yamlHead('').model, null);
});

test('a module type is found by its part number, slashes as dashes', () => {
  const paths = ['netbox/module-types/Cisco/A9K Slot Cover.yaml', 'netbox/device-types/Cisco/X.yaml',
                 'netbox/module-types/Acme/A-B.yaml'];
  assert.equal(X.moduleTypePath(paths, 'A9K Slot Cover'), paths[0]);
  assert.equal(X.moduleTypePath(paths, 'A/B'), paths[2]);
  assert.equal(X.moduleTypePath(paths, 'X'), null);
  assert.equal(X.moduleTypePath(paths, ''), null);
  assert.equal(X.partNumber({attrs: {model: 'A9K-3KW-AC'}}), 'A9K-3KW-AC');
  assert.equal(X.partNumber({attrs: {'part-number': 'P1'}}), 'P1');
  assert.equal(X.partNumber(null), '');
});

test('a repeated label gets the item id, once per duplicate', () => {
  const n = X.uniqueNames(ITEMS);
  assert.deepEqual([...n.values()].map(v => v.name), ['core-1', 'leaf-1', 'demarc-i3', 'demarc-i4']);
  assert.equal(n.get('i3').renamed, true);
  assert.equal(n.get('i1').renamed, false);
});

test('a generated name never collides with another item\'s own label', () => {
  const items = [{id: 'i3', label: 'demarc', ref: 'tm-280'}, {id: 'i4', label: 'demarc', ref: 'tm-280'},
                 {id: 'i9', label: 'demarc-i3', ref: 'tm-280'}];
  const names = [...X.uniqueNames(items).values()].map(v => v.name);
  assert.equal(new Set(names).size, 3, names.join(', '));
  assert.equal(names[2], 'demarc-i3');           // an item's own label is kept
  assert.equal(names[1], 'demarc-i4');
  assert.notEqual(names[0], 'demarc-i3');
  assert.match(names[0], /^demarc-i3-/);
  // Two generated names cannot meet either.
  const twice = [{id: 'a', label: 'x', ref: 'r'}, {id: 'a-2', label: 'x', ref: 'r'}, {id: 'b', label: 'x-a', ref: 'r'},
                 {id: 'c', label: 'x-a-2', ref: 'r'}];
  const got = [...X.uniqueNames(twice).values()].map(v => v.name);
  assert.equal(new Set(got).size, 4, got.join(', '));
});

test('a device with no type and no configuration name leaves the parenthesis out', () => {
  const item = {id: 'i1', ref: 'mystery', cfg: '', label: 'm', ru: 2, u: 1, face: 'front', turned: false};
  const {rows} = X.deviceImportRows({rack: RACK, items: [item], types: new Map([['i1', null]])});
  assert.equal(rows[0].comments, 'No NetBox device type for mystery; add one before importing.');
  const {rows: none} = X.deviceImportRows({rack: RACK, items: [{...item, cfg: undefined}], types: new Map()});
  assert.equal(none[0].comments, 'No NetBox device type for mystery; add one before importing.');
});

test('a rack with no devices does not claim every device matched', () => {
  assert.equal(X.dcimNotesText({rackName: 'Empty', target: 'netbox', date: DAY, notes: [], devices: 0}),
    'NetBox types for Empty, from the Portrayal Rack Builder, 2026-09-27.\n\n' +
    'This rack has no devices, so there are no NetBox types in this zip.\n');
  assert.equal(X.dcimNotesText({rackName: 'Empty', target: 'nautobot', date: DAY, notes: ['a'], devices: 0}),
    'Nautobot types for Empty, from the Portrayal Rack Builder, 2026-09-27.\n\n' +
    'This rack has no devices, so there are no Nautobot types in this zip.\n- a\n');
  assert.match(X.dcimNotesText({rackName: 'R', target: 'netbox', date: DAY, notes: [], devices: 2}), /Every device and part/);
});

const TYPES = new Map([
  ['i1', {manufacturer: 'Cisco', model: 'ASR-9006-AC-V2', isFullDepth: true, guess: true}],
  ['i2', {manufacturer: 'Edgecore', model: '7726-32X-O-AC-F', isFullDepth: true, guess: true}],
  ['i3', {manufacturer: 'Telco Systems', model: 'TM-280', isFullDepth: true, guess: false}],
  ['i4', {manufacturer: 'Telco Systems', model: 'TM-280', isFullDepth: true, guess: false}],
]);
const RACK = {name: 'Export test', frame: M.normalizeFrame({heightRU: 24})};

test('NetBox rows: top down, unique names, planned, notes in comments', () => {
  const {columns, rows} = X.deviceImportRows({rack: RACK, items: ITEMS, types: TYPES, target: 'netbox'});
  assert.deepEqual(columns, ['name', 'role', 'manufacturer', 'device_type', 'status', 'site', 'rack',
                             'position', 'face', 'comments']);
  assert.deepEqual(rows.map(r => [r.name, r.position, r.face, r.manufacturer, r.device_type]), [
    ['demarc-i4', 20, 'rear', 'Telco Systems', 'TM-280'], ['leaf-1', 14, 'front', 'Edgecore', '7726-32X-O-AC-F'],
    ['demarc-i3', 14, 'rear', 'Telco Systems', 'TM-280'], ['core-1', 2, 'front', 'Cisco', 'ASR-9006-AC-V2']]);
  assert.ok(rows.every(r => r.status === 'planned' && r.role === '' && r.site === '' && r.rack === 'Export test'));
  assert.equal(rows[0].comments, 'Named demarc-i4 because another device here is also demarc.');
  assert.equal(rows[1].comments, 'Device type 7726-32X-O-AC-F is a best guess for configuration ac-f2b. ' +
    'Shares its U with demarc-i3 on the rear; NetBox refuses this while either type is full depth.');
  assert.equal(rows[3].comments, 'Device type ASR-9006-AC-V2 is a best guess for configuration base.');
});

test('rows sort by each item\'s top U, not where it starts', () => {
  const tall = {id: 't1', ref: 'asr-9006', cfg: 'base', label: 'tall', ru: 2, u: 10, face: 'front', turned: false};
  const short = {id: 't2', ref: 'tm-280', cfg: 'base', label: 'short', ru: 5, u: 1, face: 'front', turned: false};
  const types = new Map([['t1', {manufacturer: 'Cisco', model: 'ASR-9006-AC-V2', isFullDepth: false, guess: false}],
                          ['t2', {manufacturer: 'Telco Systems', model: 'TM-280', isFullDepth: false, guess: false}]]);
  const {rows} = X.deviceImportRows({rack: RACK, items: [short, tall], types, target: 'netbox'});
  assert.deepEqual(rows.map(r => r.name), ['tall', 'short']);
});

test('positions follow a top-down frame', () => {
  const rack = {...RACK, frame: {...RACK.frame, numbering: 'top-down'}};
  assert.deepEqual(X.deviceImportRows({rack, items: ITEMS, types: TYPES}).rows.map(r => r.position), [5, 11, 11, 14]);
});

test('Nautobot rows use natural-key columns; a device with no type says so', () => {
  const types = new Map([...TYPES, ['i1', null]]);
  const {columns, rows} = X.deviceImportRows({rack: RACK, items: ITEMS, types, target: 'nautobot'});
  assert.deepEqual(columns, ['name', 'role__name', 'device_type__manufacturer__name', 'device_type__model',
    'status__name', 'location__name', 'rack__name', 'position', 'face', 'comments']);
  assert.deepEqual([rows[1].device_type__manufacturer__name, rows[1].device_type__model, rows[1].status__name,
                    rows[1].rack__name], ['Edgecore', '7726-32X-O-AC-F', 'Planned', 'Export test']);
  assert.equal(rows[3].device_type__model, '');
  assert.equal(rows[3].comments, 'No Nautobot device type for asr-9006 (base); add one before importing.');
});

test('NOTES.txt heads its list, or says everything matched', () => {
  assert.equal(X.dcimNotesText({rackName: 'Export test', target: 'netbox', date: DAY, notes: []}),
    'NetBox types for Export test, from the Portrayal Rack Builder, 2026-09-27.\n\n' +
    'Every device and part in this rack matched a NetBox type.\n');
  assert.equal(X.dcimNotesText({rackName: 'R', target: 'nautobot', date: DAY, notes: ['a', 'b']}),
    'Nautobot types for R, from the Portrayal Rack Builder, 2026-09-27.\n\n- a\n- b\n');
});

test('a type from another vendor says so in the row\'s comments, as NOTES.txt does', () => {
  const types = new Map([['i1', {manufacturer: 'Cisco', model: 'ASR-9006-AC-V2', isFullDepth: false, guess: true,
    otherVendor: true, chassisManufacturer: 'Nobody Inc', path: nb('Cisco', 'ASR-9006-AC-V2')}]]);
  const item = {id: 'i1', ref: 'asr-9006', cfg: 'base', label: 'core-1', ru: 2, u: 4, face: 'front', turned: false};
  const {rows} = X.deviceImportRows({rack: RACK, items: [item], types, target: 'netbox'});
  assert.equal(rows[0].comments, 'core-1 (asr-9006): no NetBox device type from Nobody Inc, so ' +
    "ASR-9006-AC-V2 is another vendor's (Cisco) file, a best guess.");
});

test('the shared-U note names every device it shares with', () => {
  const full = {manufacturer: 'M', model: 'X', isFullDepth: true, guess: false};
  const items = [
    {id: 'a', ref: 'r', cfg: 'base', label: 'tall', ru: 10, u: 6, face: 'front', turned: false},
    {id: 'b', ref: 'r', cfg: 'base', label: 'one', ru: 11, u: 1, face: 'rear', turned: false},
    {id: 'c', ref: 'r', cfg: 'base', label: 'two', ru: 13, u: 1, face: 'rear', turned: false},
    {id: 'd', ref: 'r', cfg: 'base', label: 'three', ru: 15, u: 1, face: 'rear', turned: false}];
  const types = new Map(items.map(i => [i.id, full]));
  const {rows} = X.deviceImportRows({rack: RACK, items, types, target: 'netbox'});
  assert.equal(rows.find(r => r.name === 'tall').comments,
    'Shares its U with one, two and three on the rear; NetBox refuses this while either type is full depth.');
  assert.equal(rows.find(r => r.name === 'one').comments,
    'Shares its U with tall on the front; NetBox refuses this while either type is full depth.');
});

test('the other-vendor comment wins over a certain match (guess: false)', () => {
  const types = new Map([['i1', {manufacturer: 'Cisco', model: 'ASR-9006-AC-V2', isFullDepth: false, guess: false,
    otherVendor: true, chassisManufacturer: 'Nobody Inc', path: nb('Cisco', 'ASR-9006-AC-V2')}]]);
  const item = {id: 'i1', ref: 'asr-9006', cfg: 'base', label: 'core-1', ru: 2, u: 4, face: 'front', turned: false};
  const {rows} = X.deviceImportRows({rack: RACK, items: [item], types, target: 'netbox'});
  assert.match(rows[0].comments, /another vendor's \(Cisco\) file/);
  assert.doesNotMatch(rows[0].comments, /best guess for configuration/);
});

test('a device label that starts with = stays verbatim in the DCIM CSV (only the BOM guards it)', () => {
  const item = {id: 'i1', ref: 'asr-9006', cfg: 'base', label: '=core', ru: 2, u: 4, face: 'front', turned: false};
  const types = new Map([['i1', {manufacturer: 'Cisco', model: 'ASR-9006-AC-V2', isFullDepth: false, guess: false}]]);
  const {columns, rows} = X.deviceImportRows({rack: RACK, items: [item], types, target: 'netbox'});
  const csv = X.toCsv(columns, rows);
  assert.ok(csv.split('\r\n')[1].startsWith('=core,'), csv);
  assert.ok(!csv.includes("'=core"));
});

test('a device that is not rack-mount says so in its own comments', () => {
  const rack = {name: 'r', frame: M.normalizeFrame({heightRU: 4})};
  const items = [{id: 'a', ref: 'hlx-tgv', cfg: '', label: 'tgv', ru: 1, u: 1, face: 'front', mount: 'desktop'}];
  const {rows} = X.deviceImportRows({rack, items, types: new Map(), target: 'netbox'});
  assert.match(rows[0].comments, /A desktop device, so it needs a shelf\./);
});
