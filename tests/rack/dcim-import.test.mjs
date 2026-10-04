import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as D from '../../site/rack/dcim-rules.js';
import * as X from '../../site/rack/export-data.js';
import * as M from '../../site/rack/model.js';

// The vendored type files, read as text - what the page fetches.
const EXPORTS = new URL('../../assets/exports/', import.meta.url);
const yaml = path => fs.readFileSync(new URL(path, EXPORTS), 'utf8');
const lists = path => D.typeLists(yaml(path));
const ASR = 'netbox/device-types/Cisco/ASR-9006-AC-V2.yaml', LEAF = 'netbox/device-types/Edgecore/7726-32X-O-AC-F.yaml',
  TM = 'netbox/device-types/Telco Systems/TM-280.yaml', CARD = 'netbox/module-types/Cisco/A9K-16X100GE-TR.yaml';

test('a type file gives its own name lists, by section, and its bays by name and position', () => {
  const tm = lists(TM);
  assert.equal(tm.manufacturer, 'Telco Systems');
  assert.equal(tm.model, 'TM-280');
  assert.deepEqual(tm.sections.interfaces, ['port-1-1', 'port-2-1', 'port-3-1', 'copper-3-1', 'port-2-2']);
  assert.deepEqual(tm.sections['console-ports'], ['Console']);
  assert.deepEqual(tm.sections['power-ports'], ['dc-in']);
  assert.deepEqual(tm.bays, []);
  const asr = lists(ASR);
  assert.deepEqual(asr.sections.interfaces, []);
  assert.deepEqual(asr.bays.find(b => b.position === 'slot-2'), {name: 'slot-2', position: 'slot-2'});
  assert.equal(asr.bays.length, 11);
  // A quoted name is read without its quotes; a name is not a path until a bay's position replaces {module}.
  assert.deepEqual(lists(CARD).sections.interfaces.slice(0, 2), ['{module}/p0', '{module}/p1']);
  // A bay's name is for display; its position is the drawing's bay id.
  assert.deepEqual(lists(LEAF).bays[0], {name: 'Fan 1', position: 'fan-1'});
  assert.deepEqual(D.bayAt(lists('netbox/device-types/Casa Systems/C40G-CHASSIS-AC.yaml'), 'front-0'),
    {name: 'Front 0', position: 'front-0'});
  assert.equal(D.bayAt(lists(LEAF), 'Fan 1'), null);
  // Not a type file at all: empty lists, never a throw.
  assert.deepEqual(D.typeLists('').sections.interfaces, []);
  assert.deepEqual(D.typeLists(undefined).bays, []);
});

test('the NetBox and Nautobot copies of the fixture types name the same things', () => {
  for (const p of [ASR, LEAF, TM, CARD]) {
    const nb = lists(p), nt = lists(p.replace(/^netbox\//, 'nautobot/'));
    assert.deepEqual(nt.sections, nb.sections, p);
    assert.deepEqual(nt.bays, nb.bays, p);
  }
});

test("the fixture's cable ends resolve to the names the real instances made", () => {
  const leaf = lists(LEAF), asr = lists(ASR), tm = lists(TM), card = lists(CARD);
  for (const path of ['port-1', 'port-2', 'mgmt-eth'])
    assert.deepEqual(D.resolveEnd({path, device: leaf}), {ok: true, name: path, type: 'dcim.interface'});
  assert.deepEqual(D.resolveEnd({path: 'port-2-1', device: tm}), {ok: true, name: 'port-2-1', type: 'dcim.interface'});
  // result.json, inventory_after_modules: the card in slot-2 gave core-1 the interfaces slot-2/p0 to slot-2/p15.
  assert.deepEqual(D.resolveEnd({path: 'slot-2/module/p0', device: asr, moduleAt: bay => (bay === 'slot-2' ? card : null)}),
    {ok: true, name: 'slot-2/p0', type: 'dcim.interface', bay: {name: 'slot-2', position: 'slot-2'}});
  assert.deepEqual(D.resolveEnd({path: 'dc-in', device: tm}), {ok: true, name: 'dc-in', type: 'dcim.powerport'});
});

test('a console port is found by its own list, never by its path alone', () => {
  const tm = lists(TM);
  // The drawing calls it "con"; the type file calls its only console port "Console".
  assert.deepEqual(D.resolveEnd({path: 'con', device: tm, consoles: ['con']}),
    {ok: true, name: 'Console', type: 'dcim.consoleport'});
  // Two drawn, one listed: which one is it? Not said.
  assert.deepEqual(D.resolveEnd({path: 'con', device: tm, consoles: ['con', 'con-usb']}),
    {ok: false, reason: 'the device type TM-280 does not say which of its console ports con is'});
  // Not drawn as a console at all: it is just a path the file does not list.
  assert.deepEqual(D.resolveEnd({path: 'con', device: tm}),
    {ok: false, reason: 'the device type TM-280 lists no port named con'});
  // "Console (<path>)" names it exactly.
  const two = D.typeLists('model: X\nconsole-ports:\n  - name: Console (usb)\n  - name: Console (rj45)\n');
  assert.deepEqual(D.resolveEnd({path: 'usb', device: two, consoles: ['usb', 'rj45']}),
    {ok: true, name: 'Console (usb)', type: 'dcim.consoleport'});
});

test('an end that does not resolve says why, and gets no name', () => {
  const asr = lists(ASR), card = lists(CARD), leaf = lists(LEAF);
  const why = arg => { const r = D.resolveEnd(arg); assert.equal(r.ok, false); assert.equal('name' in r, false); return r.reason; };
  assert.equal(why({path: 'port-1', device: null}), 'its device has no device type');
  assert.equal(why({path: 'port-99', device: leaf}), 'the device type 7726-32X-O-AC-F lists no port named port-99');
  assert.equal(why({path: 'slot-9/module/p0', device: asr, moduleAt: () => card}),
    'the device type ASR-9006-AC-V2 has no module bay at position slot-9');
  assert.equal(why({path: 'slot-2/module/p0', device: asr}), 'what is seated in slot-2 has no module type');
  assert.equal(why({path: 'slot-2/module/p99', device: asr, moduleAt: () => card}),
    'the module type A9K-16X100GE-TR lists no port named {module}/p99');
  assert.equal(why({path: 'slot-2/module/mic-0/module/p0', device: asr, moduleAt: () => card}),
    'it is a port of a module inside a card, and the card has no module bay to import that module into');
  // The Edgecore AS7326-56X draws port-57 where its type file lists "57": no convention bridges that.
  assert.equal(why({path: 'port-57', device: lists('netbox/device-types/Edgecore/7326-56X-O-48V-B.yaml')}),
    'the device type 7326-56X-O-48V-B lists no port named port-57');
});

test('the list a name is in gives the end its type: a cassette has front and rear ports, not interfaces', () => {
  const cassette = lists('netbox/module-types/FS.com/FHD-1MTP6LCDOS2A.yaml');
  const dev = D.typeLists('model: Panel\nmodule-bays:\n  - name: Bay 1\n    position: bay-1\n');
  assert.deepEqual(D.resolveEnd({path: 'bay-1/module/1', device: dev, moduleAt: () => cassette}),
    {ok: true, name: 'bay-1/1', type: 'dcim.frontport', bay: {name: 'Bay 1', position: 'bay-1'}});
  assert.deepEqual(D.resolveEnd({path: 'bay-1/module/MTP-1', device: dev, moduleAt: () => cassette}),
    {ok: true, name: 'bay-1/MTP-1', type: 'dcim.rearport', bay: {name: 'Bay 1', position: 'bay-1'}});
  // The drawing's own name for that adapter is lc1, which the file does not list.
  assert.equal(D.resolveEnd({path: 'bay-1/module/lc1', device: dev, moduleAt: () => cassette}).reason,
    'the module type FHD-1MTP6LCDOS2A lists no port named {module}/lc1');
});

test('every vendored type file is read whole: each "- name:" line is a name, a module port carries {module}/ once', () => {
  const files = JSON.parse(yaml('files.json'));
  let n = 0;
  for (const target of ['netbox', 'nautobot']) for (const path of files[target]) {
    const text = yaml(path), l = D.typeLists(text);
    const named = Object.values(l.sections).reduce((s, v) => s + v.length, 0) + l.bays.length;
    assert.equal(named, text.split('\n').filter(x => x.startsWith('  - name:')).length, path);
    assert.ok(l.model, path);
    assert.equal(new Set(l.bays.map(b => b.position)).size, l.bays.length, `${path}: two bays share a position`);
    if (path.includes('/module-types/'))
      for (const name of Object.values(l.sections).flat())
        assert.ok(name.startsWith('{module}/') && name.indexOf('{module}', 1) < 0, `${path}: ${name}`);
    n++;
  }
  assert.ok(n > 2000, `${n} files`);
});

// ── the modules and cables files ────────────────────────────────────────
// check-browser.py's cable fixture, as far as the rules read it.
const FRAME = M.normalizeFrame({heightRU: 24});
const ITEMS = [
  {id: 'i1', ref: 'asr-9006', cfg: 'base', label: 'core-1', ru: 2, u: 10, face: 'front', turned: false},
  {id: 'i2', ref: 'as7726-32x', cfg: 'ac-f2b', label: 'leaf-1', ru: 14, u: 1, face: 'front', turned: false},
  {id: 'i3', ref: 'tm-280', cfg: 'base', label: 'demarc', ru: 14, u: 1, face: 'rear', turned: false},
  {id: 'i4', ref: 'tm-280', cfg: 'base', label: 'demarc', ru: 20, u: 1, face: 'rear', turned: false}];
const end = (item, path) => ({item, path, view: 'front'});
const CABLES = [
  {id: 'c1', a: end('i2', 'port-1'), b: end('i1', 'slot-2/module/p0'), media: 'os2', purpose: 'uplink', label: 'A1',
   length: {value: 2, unit: 'm', source: 'entered'}, route: []},
  {id: 'c2', a: end('i2', 'mgmt-eth'), b: end('i3', 'port-2-1'), media: 'cat6a', purpose: 'management', label: '', route: []},
  {id: 'c3', a: end('i2', 'port-2'), b: end('i4', 'port-2-1'), media: 'os2', purpose: 'uplink', label: '', route: []}];
const RACK = {name: 'Cable test', frame: FRAME, zeroU: [], items: ITEMS, cables: CABLES};
const NAMES = X.uniqueNames(ITEMS);
const DEVICE = {i1: lists(ASR), i2: lists(LEAF), i3: lists(TM), i4: lists(TM)};
const CARD_TYPE = {manufacturer: 'Cisco', model: 'A9K-16X100GE-TR', lists: lists(CARD)};
const PARTS = [{itemId: 'i1', path: 'slot-2/module', ref: 'cisco/a9k-16x100ge-tr@1'},
               {itemId: 'i1', path: 'slot-2/module/p0-occupant', ref: 'generic/qsfp-lc@2'},
               {itemId: 'i2', path: 'port-1-occupant', ref: 'generic/qsfp-lc@2'}];
const moduleOf = ref => (ref === 'cisco/a9k-16x100ge-tr@1' ? CARD_TYPE : null);
const resolve = e => D.resolveEnd({path: e.path, device: DEVICE[e.item], consoles: ['con'],
  moduleAt: bay => (e.item === 'i1' && bay === 'slot-2' ? CARD_TYPE.lists : null)});
// Every end lands, except leaf-1 port-2: an empty cage.
const landed = (cables, loose = {}) => new Map(cables.flatMap(c => [c.a, c.b]).map(e =>
  [`${e.item}|${e.view}|${e.path}`, {info: null, reason: loose[`${e.item}|${e.path}`] ?? null}]));
const ENDS = landed(CABLES, {'i2|port-2': 'port-2 holds no optic'});
const ALL = new Set(['i1', 'i2', 'i3', 'i4']), NETBOX_KEPT = new Set(['i1', 'i2', 'i4']);
const cableRows = (over = {}) => D.cableImportRows({rack: RACK, target: 'netbox', names: NAMES, kept: NETBOX_KEPT, resolve,
  ends: ENDS, ...over});

test('the modules file: one row per card in a bay, by the bay NAME; an optic is not a module', () => {
  const nb = D.moduleImportRows({target: 'netbox', parts: PARTS, names: NAMES, kept: ALL, deviceOf: id => DEVICE[id], moduleOf});
  // result.json: NetBox took exactly these columns (status is required; a manufacturer column is refused).
  assert.deepEqual(nb, {columns: ['device', 'module_bay', 'module_type', 'status'], left: [],
    rows: [{device: 'core-1', module_bay: 'slot-2', module_type: 'A9K-16X100GE-TR', status: 'planned'}]});
  const nt = D.moduleImportRows({target: 'nautobot', parts: PARTS, names: NAMES, kept: ALL, deviceOf: id => DEVICE[id], moduleOf});
  assert.deepEqual(nt.columns, ['module_type__manufacturer__name', 'module_type__model',
    'parent_module_bay__parent_device__name', 'parent_module_bay__name', 'status__name']);
  assert.deepEqual(nt.rows, [{module_type__manufacturer__name: 'Cisco', module_type__model: 'A9K-16X100GE-TR',
    parent_module_bay__parent_device__name: 'core-1', parent_module_bay__name: 'slot-2', status__name: 'Planned'}]);
});

test('the modules file names a bay by its name, found by its position; what it cannot carry is said', () => {
  const fan = {manufacturer: 'Edgecore', model: 'FAN-F', lists: D.typeLists('model: FAN-F\n')};
  const parts = [{itemId: 'i2', path: 'fan-1/module', ref: 'fan'},                // name "Fan 1", position fan-1
                 {itemId: 'i2', path: 'nowhere/module', ref: 'fan'},              // no bay at that position
                 {itemId: 'i1', path: 'slot-2/module/mic-0/module', ref: 'fan'},  // a module inside a card
                 {itemId: 'i3', path: 'bay/module', ref: 'fan'}, {itemId: 'i3', path: 'bay-2/module', ref: 'fan'},
                 {itemId: 'i4', path: 'bay/module', ref: 'no-type'}];
  const got = D.moduleImportRows({target: 'netbox', parts, names: NAMES, kept: NETBOX_KEPT, deviceOf: id => DEVICE[id],
    moduleOf: ref => (ref === 'fan' ? fan : null)});
  assert.deepEqual(got.rows, [{device: 'leaf-1', module_bay: 'Fan 1', module_type: 'FAN-F', status: 'planned'}]);
  assert.deepEqual(got.left, [
    'leaf-1 nowhere: FAN-F is not in the modules file. The device type 7726-32X-O-AC-F has no module bay at position nowhere.',
    'core-1 slot-2/module/mic-0: FAN-F is not in the modules file. It is a module inside a card, and no module type here has a module bay to import it into.',
    'The modules of demarc-i3 are not in the modules file: demarc-i3 is not in the devices file.']);
});

test('media become cable types both targets accepted; anything else is blank', () => {
  assert.deepEqual(['os2', 'om3', 'om4', 'om5', 'cat6', 'cat6a', 'dac', 'aoc'].map(D.cableType),
    ['smf-os2', 'mmf-om3', 'mmf-om4', 'mmf-om5', 'cat6', 'cat6a', 'dac-passive', 'aoc']);
  assert.deepEqual(['', undefined, null, 'copper', 'toString', 'smf-os2'].map(D.cableType), ['', '', '', '', '', '']);
});

test('a length is written in m or ft, rounded up to what the target stores', () => {
  const len = (value, unit) => ({length: {value, unit, source: 'entered'}});
  assert.deepEqual(D.importLength(len(2, 'm'), 'netbox'), {value: 2, unit: 'm', note: null});
  assert.deepEqual(D.importLength(len(1.5, 'ft'), 'netbox'), {value: 1.5, unit: 'ft', note: null});
  assert.deepEqual(D.importLength(len(0.07, 'm'), 'netbox'), {value: 0.07, unit: 'm', note: null});
  assert.deepEqual(D.importLength(len(1.234, 'm'), 'netbox'), {value: 1.24, unit: 'm',
    note: '1.234 m is written as 1.24 m: NetBox keeps two decimal places, and a length is rounded up'});
  // result.json: Nautobot answered 1.5 with "A valid integer is required."
  assert.deepEqual(D.importLength(len(1.5, 'ft'), 'nautobot'), {value: 2, unit: 'ft',
    note: '1.5 ft is written as 2 ft: Nautobot takes whole numbers, and a length is rounded up'});
  assert.deepEqual(D.importLength(len(3, 'm'), 'nautobot'), {value: 3, unit: 'm', note: null});
  assert.deepEqual(D.importLength(len(30, 'cm'), 'netbox'), {value: '', unit: '',
    note: 'its length (30 cm) is not carried: the kit writes lengths in m or ft only'});
  assert.deepEqual(D.importLength({}, 'netbox'), {value: '', unit: '', note: null});
  assert.deepEqual(D.importLength({lengthAsWritten: 'long'}, 'nautobot'), {value: '', unit: '',
    note: 'its length as written in the rack file is not carried'});
});

test('which ends one cable may join', () => {
  assert.ok(D.canMeet('dcim.interface', 'dcim.interface') && D.canMeet('dcim.interface', 'dcim.frontport'));
  assert.ok(D.canMeet('dcim.consoleport', 'dcim.rearport') && D.canMeet('dcim.powerport', 'dcim.poweroutlet'));
  assert.ok(!D.canMeet('dcim.consoleport', 'dcim.interface') && !D.canMeet('dcim.interface', 'dcim.consoleport'));
  assert.ok(!D.canMeet('dcim.interface', 'dcim.powerport') && !D.canMeet('dcim.nonsense', 'dcim.interface'));
});

test("NetBox's cables file: the columns the real instance took, and only rows it would take", () => {
  const got = cableRows();
  assert.deepEqual(got.columns, ['side_a_device', 'side_a_type', 'side_a_name', 'side_b_device', 'side_b_type',
    'side_b_name', 'type', 'status', 'label', 'color', 'length', 'length_unit', 'description']);
  // The row result.json's cables_good imported, device names apart.
  assert.deepEqual(got.rows, [{side_a_device: 'leaf-1', side_a_type: 'dcim.interface', side_a_name: 'port-1',
    side_b_device: 'core-1', side_b_type: 'dcim.interface', side_b_name: 'slot-2/p0', type: 'smf-os2', status: 'planned',
    label: 'A1', color: '', length: 2, length_unit: 'm', description: 'uplink'}]);
  assert.equal(X.toCsv(got.columns, got.rows).split('\r\n')[1],
    'leaf-1,dcim.interface,port-1,core-1,dcim.interface,slot-2/p0,smf-os2,planned,A1,,2,m,uplink');
  assert.deepEqual(got.left, [
    'Cable c2 is not in the cables file: end B is on demarc-i3, which is not in the devices file.',
    'Cable c3 is not in the cables file: end A, leaf-1 (U14) port-2, is not connected (port-2 holds no optic).']);
  assert.deepEqual(got.notes, []);
});

test("Nautobot's cables file is for the script: ends by name, every device kept, whole lengths", () => {
  const cables = [...CABLES, {id: 'c4', a: end('i4', 'port-2-2'), b: end('i3', 'port-2-2'), media: 'cat6', purpose: '', label: '',
    length: {value: 1.5, unit: 'ft', source: 'entered'}, route: []}];
  const rack = {...RACK, cables};
  const got = D.cableImportRows({rack, target: 'nautobot', names: NAMES, kept: ALL, resolve,
    ends: landed(cables, {'i2|port-2': 'port-2 holds no optic'})});
  assert.deepEqual(got.columns, ['a_device', 'a_type', 'a_name', 'b_device', 'b_type', 'b_name', 'type', 'status', 'label',
    'color', 'length', 'length_unit']);
  assert.deepEqual(got.rows.map(r => Object.values(r).join('|')), [
    'leaf-1|dcim.interface|port-1|core-1|dcim.interface|slot-2/p0|smf-os2|Planned|A1||2|m',
    'leaf-1|dcim.interface|mgmt-eth|demarc-i3|dcim.interface|port-2-1|cat6a|Planned|c2|||',
    'demarc-i4|dcim.interface|port-2-2|demarc-i3|dcim.interface|port-2-2|cat6|Planned|c4||2|ft']);
  assert.deepEqual(got.left, ['Cable c3 is not in the cables file: end A, leaf-1 (U14) port-2, is not connected (port-2 holds no optic).']);
  assert.deepEqual(got.notes, ['Cable c4: 1.5 ft is written as 2 ft: Nautobot takes whole numbers, and a length is rounded up.']);
});

test('a cable the target would refuse is left out, each with its reason', () => {
  const one = (cable, over = {}) => {
    const rack = {...RACK, cables: [cable]};
    return D.cableImportRows({rack, target: 'netbox', names: NAMES, kept: ALL, resolve, ends: landed([cable]), ...over, rack: over.rack || rack});
  };
  const cab = (a, b, more = {}) => ({id: 'c9', a, b, media: 'cat6', purpose: '', label: 'X', route: [], ...more});
  // Console port to interface: result.json, "Incompatible termination types: consoleport and interface".
  assert.deepEqual(one(cab(end('i4', 'con'), end('i2', 'mgmt-eth'))).left,
    ['Cable X is not in the cables file: NetBox does not cable a console port to an interface.']);
  assert.match(one(cab(end('i4', 'con'), end('i2', 'mgmt-eth')), {target: 'nautobot'}).left[0], /Nautobot does not cable a console port to an interface\.$/);
  // An end the type file does not name, with the reason the resolution gives.
  assert.deepEqual(one(cab(end('i2', 'port-99'), end('i4', 'port-2-1'))).left,
    ['Cable X is not in the cables file: end A, leaf-1 (U14) port-99: the device type 7726-32X-O-AC-F lists no port named port-99.']);
  // Ends that could not be checked: none is written. A loose end might be among them.
  assert.deepEqual(one(cab(end('i2', 'port-1'), end('i4', 'port-2-1')), {unchecked: true}).left,
    ['Cable X is not in the cables file: its ends could not be checked.']);
  assert.deepEqual(one(cab(end('i2', 'port-1'), end('i4', 'port-2-1')), {ends: new Map()}).left,
    ['Cable X is not in the cables file: its ends could not be checked.']);
  // A removed device is a loose end, in the words the other exports use.
  const gone = cab(end('i9', 'port-1'), end('i4', 'port-2-1'));
  assert.deepEqual(one(gone, {ends: landed([gone], {'i9|port-1': 'the device was removed'})}).left,
    ["Cable X is not in the cables file: end A, a removed device's port-1, is not connected (the device was removed)."]);
  // A comma in a device name: NetBox would read two devices. Nautobot's script looks the name up whole.
  const items = ITEMS.map(i => (i.id === 'i2' ? {...i, label: 'leaf, one'} : i));
  const rack = {...RACK, items, cables: [cab(end('i2', 'port-1'), end('i4', 'port-2-1'))]};
  const over = {rack, names: X.uniqueNames(items), ends: landed(rack.cables)};
  assert.deepEqual(one(rack.cables[0], over).left,
    ['Cable X is not in the cables file: end A: NetBox reads a comma in a device or port name as a list, so "leaf, one" cannot be written.']);
  assert.equal(one(rack.cables[0], {...over, target: 'nautobot'}).rows[0].a_device, 'leaf, one');
});

test('one port, one cable in the file; a label, or the id; an unknown media and a DAC are said', () => {
  const cab = (id, a, b, more = {}) => ({id, a, b, media: 'cat6', purpose: '', label: '', route: [], ...more});
  const cables = [cab('c1', end('i2', 'mgmt-eth'), end('i4', 'port-2-1')),
                  cab('c2', end('i4', 'port-2-1'), end('i2', 'port-3'), {label: 'second'}),
                  cab('c3', end('i2', 'port-4'), end('i2', 'port-5'), {media: 'dac'}),
                  cab('c4', end('i2', 'port-6'), end('i2', 'port-7'), {media: 'coax'}),
                  cab('c5', end('i2', 'port-8'), end('i2', 'port-9'), {media: ''})];
  const got = D.cableImportRows({rack: {...RACK, cables}, target: 'netbox', names: NAMES, kept: ALL, resolve, ends: landed(cables)});
  assert.deepEqual(got.rows.map(r => [r.label, r.type]), [['c1', 'cat6'], ['c3', 'dac-passive'], ['c4', ''], ['c5', '']]);
  assert.deepEqual(got.left, ['Cable second is not in the cables file: end A, demarc (U20) port-2-1, already has cable c1 in this file.']);
  assert.deepEqual(got.notes, ['Cable c4: its media (coax) has no NetBox cable type, so its type is blank.',
    'A DAC is written as dac-passive. Change the type of one that is active.']);
});

test('a rack with no cables gets a header and no rows', () => {
  const got = D.cableImportRows({rack: {...RACK, cables: []}, target: 'netbox', names: NAMES, kept: ALL, resolve});
  assert.deepEqual([got.rows, got.left, got.notes], [[], [], []]);
  assert.equal(X.toCsv(got.columns, got.rows),
    'side_a_device,side_a_type,side_a_name,side_b_device,side_b_type,side_b_name,type,status,label,color,length,length_unit,description\r\n');
});
