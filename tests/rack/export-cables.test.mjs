import test from 'node:test';
import assert from 'node:assert/strict';
import * as X from '../../site/rack/export-data.js';
import * as M from '../../site/rack/model.js';

// check-browser.py's cable fixture, as far as the rules read it.
const FRAME = M.normalizeFrame({heightRU: 24});
const RACK = {name: 'Cable test', frame: FRAME, zeroU: [], items: [
  {id: 'i1', ref: 'asr-9006', label: 'core-1', ru: 2, face: 'front', turned: false},
  {id: 'i2', ref: 'as7726-32x', label: 'leaf-1', ru: 14, face: 'front', turned: false},
  {id: 'i3', ref: 'tm-280', label: 'demarc', ru: 14, face: 'rear', turned: false},
  {id: 'i4', ref: 'tm-280', label: 'demarc', ru: 20, face: 'rear', turned: false}],
  cables: [
    {id: 'c1', a: {item: 'i2', path: 'port-1', view: 'front'}, b: {item: 'i1', path: 'slot-2/module/p0', view: 'front'},
     media: 'os2', purpose: 'uplink', label: 'A1', length: {value: 2, unit: 'm', source: 'entered'}, route: []},
    {id: 'c2', a: {item: 'i2', path: 'mgmt-eth', view: 'front'}, b: {item: 'i3', path: 'port-2-1', view: 'front'},
     media: 'cat6a', purpose: 'management', label: '', route: []},
    {id: 'c3', a: {item: 'i2', path: 'port-2', view: 'front'}, b: {item: 'i4', path: 'port-2-1', view: 'front'},
     media: 'os2', purpose: 'uplink', label: '', route: []}]};
const FIBER = {family: 'fiber', mode: null}, COPPER = {family: 'copper', mode: null}, NONE = {family: null, mode: null};
// What cable-plugs.js cableFacts(rack).ends holds for that rack.
const ENDS = new Map([
  ['i2|front|port-1', {info: FIBER, reason: null}], ['i1|front|slot-2/module/p0', {info: FIBER, reason: null}],
  ['i2|front|mgmt-eth', {info: COPPER, reason: null}], ['i3|front|port-2-1', {info: COPPER, reason: null}],
  ['i2|front|port-2', {info: NONE, reason: 'port-2 holds no optic'}], ['i4|front|port-2-1', {info: COPPER, reason: null}]]);

test('an export that carries the cables drops the cable line, and only that line', () => {
  const rack = {zeroU: [{}], cables: [{}, {}]};
  assert.deepEqual(X.rackNotes(rack), ['1 zero-U item is not in this export yet.', '2 cables are not in this export yet.']);
  assert.deepEqual(X.rackNotes(rack, {cables: true}), X.rackNotes(rack));
  assert.deepEqual(X.rackNotes(rack, {cables: false}), ['1 zero-U item is not in this export yet.']);
  assert.deepEqual(X.rackNotes({zeroU: [], cables: [{}]}, {cables: false}), []);
});

test('each cable is read once: its loose ends with reasons, its mismatch warnings, whether it was checked', () => {
  const f = X.cableFindings(RACK, ENDS);
  assert.deepEqual(f.map(x => [x.name, x.loose.map(l => [l.side, l.reason]), x.warnings, x.checked]), [
    ['A1', [], [], true],
    ['c2', [], [], true],
    ['c3', [['A', 'port-2 holds no optic']], ['OS2 single-mode fiber does not suit end B, which is copper.'], true]]);
  assert.deepEqual(X.cableFindings(RACK).map(x => [x.loose.length, x.warnings.length, x.checked]),
    [[0, 0, false], [0, 0, false], [0, 0, false]]);
  assert.deepEqual(X.cableFindings({items: [], cables: undefined}), []);
});

test('the notes a drawn export carries name the cable, the end as the page names it, and the reason', () => {
  assert.deepEqual(X.cableNotes(RACK, ENDS), [
    'Cable c3: end A, leaf-1 (U14) port-2, is not connected (port-2 holds no optic).',
    'Cable c3: OS2 single-mode fiber does not suit end B, which is copper.']);
  assert.equal(X.cableNotes(RACK, ENDS, {undrawn: true})[0],
    'Cable c3 is not drawn: end A, leaf-1 (U14) port-2, is not connected (port-2 holds no optic).');
  const gone = {...RACK, items: RACK.items.filter(i => i.id !== 'i1')};
  const ends = new Map([...ENDS, ['i1|front|slot-2/module/p0', {info: NONE, reason: 'the device was removed'}]]);
  assert.equal(X.cableNotes(gone, ends)[0],
    "Cable A1: end B, a removed device's slot-2/module/p0, is not connected (the device was removed).");
  assert.deepEqual(X.cableNotes({...RACK, cables: []}, ENDS), []);
});

test('the cable schedule: one row per cable, devices named as the device import names them', () => {
  const {columns, rows, notes} = X.cableScheduleRows(RACK, ENDS);
  assert.deepEqual(columns, ['cable', 'a_device', 'a_u', 'a_port', 'b_device', 'b_u', 'b_port', 'media', 'purpose',
    'length', 'length_unit', 'status', 'notes']);
  assert.equal(columns, X.CABLE_COLUMNS);
  assert.deepEqual(rows[0], {cable: 'A1', a_device: 'leaf-1', a_u: 14, a_port: 'port-1', b_device: 'core-1', b_u: 2,
    b_port: 'slot-2/module/p0', media: 'OS2 single-mode fiber', purpose: 'uplink', length: 2, length_unit: 'm',
    status: 'connected', notes: ''});
  assert.deepEqual(rows[1], {cable: 'c2', a_device: 'leaf-1', a_u: 14, a_port: 'mgmt-eth', b_device: 'demarc-i3',
    b_u: 14, b_port: 'port-2-1', media: 'Cat 6A copper', purpose: 'management', length: '', length_unit: '',
    status: 'connected', notes: ''});
  assert.equal(rows[2].status, 'loose end');
  assert.equal(rows[2].b_device, 'demarc-i4');
  assert.equal(rows[2].notes,
    'End A is not connected: port-2 holds no optic. OS2 single-mode fiber does not suit end B, which is copper.');
  assert.deepEqual(notes, ['Devices that share a label are named as the device import names them: demarc-i3, demarc-i4.']);
  // The same names the device import gives.
  const names = X.uniqueNames(RACK.items);
  assert.equal(rows[1].b_device, names.get('i3').name);
});

test('the cable schedule: positions follow the frame, a removed device leaves blanks, an unknown media is its own name', () => {
  const rack = {...RACK, frame: {...FRAME, numbering: 'top-down'}, items: RACK.items.filter(i => i.id !== 'i1'),
    cables: [{...RACK.cables[0], media: 'toString', length: {value: 30, unit: 'cm', source: 'entered'}},
             {...RACK.cables[1], media: '', lengthAsWritten: {value: 'about 3', unit: 'm'}},
             {...RACK.cables[1], id: 'c9', lengthAsWritten: 'long'}]};
  const ends = new Map([...ENDS, ['i1|front|slot-2/module/p0', {info: NONE, reason: 'the device was removed'}]]);
  const {rows} = X.cableScheduleRows(rack, ends);
  assert.deepEqual([rows[0].a_u, rows[0].b_device, rows[0].b_u, rows[0].b_port, rows[0].status],
    [11, '', '', 'slot-2/module/p0', 'loose end']);
  assert.deepEqual([rows[0].media, rows[0].length, rows[0].length_unit], ['toString', 30, 'cm']);
  assert.deepEqual([rows[1].media, rows[1].length, rows[1].length_unit], ['', '', '']);
  assert.equal(rows[1].notes, 'Length as written in the file: {"value":"about 3","unit":"m"}.');
  assert.equal(rows[2].notes, 'Length as written in the file: long.');
});

test('the cable schedule says so when there are no cables, and when the ends were not checked', () => {
  assert.deepEqual(X.cableScheduleRows({...RACK, cables: []}, new Map()),
    {columns: X.CABLE_COLUMNS, rows: [], notes: ['This rack has no cables, so there is nothing to list.']});
  const {rows, notes} = X.cableScheduleRows(RACK);
  assert.deepEqual(rows.map(r => r.status), ['not checked', 'not checked', 'not checked']);
  assert.equal(notes[0], 'Cable ends could not be checked, so loose ends are not marked.');
  assert.equal(notes[0], X.UNCHECKED_NOTE);
});

test('a schedule cell that opens as a formula is guarded, as the BOM guards it', () => {
  const rack = {...RACK, cables: [{...RACK.cables[0], label: '=A1', purpose: '-x'}]};
  const {columns, rows} = X.cableScheduleRows(rack, ENDS);
  const csv = X.toCsv(columns, rows, [], {cell: X.bomCell});
  assert.match(csv, /\r\n'=A1,leaf-1,14,port-1,core-1,2,slot-2\/module\/p0,OS2 single-mode fiber,'-x,2,m,connected,\r\n$/);
});
