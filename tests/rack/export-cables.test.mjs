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

test('the BOM lists cables by media, length and connector, with "length not set" where there is none', () => {
  const two = {...RACK.cables[0], id: 'c7', label: 'A2', a: RACK.cables[0].b, b: RACK.cables[0].a};
  const rows = X.cableBomRows({...RACK, cables: [...RACK.cables, two]}, ENDS);
  assert.deepEqual(rows, [
    {section: 'Cables', qty: 1, manufacturer: '', model: 'Cat 6A copper', description: 'length not set; copper at both ends', ref: ''},
    {section: 'Cables', qty: 2, manufacturer: '', model: 'OS2 single-mode fiber', description: '2 m; fiber at both ends', ref: ''},
    {section: 'Cables', qty: 1, manufacturer: '', model: 'OS2 single-mode fiber', description: 'length not set; copper at one end', ref: ''}]);
});

test('the BOM: a length kept as written is not set, a unit is part of the line, an unknown end adds nothing', () => {
  const c = RACK.cables[1];
  const rack = {...RACK, cables: [
    {...c, id: 'a', length: {value: 3, unit: 'm'}}, {...c, id: 'b', length: {value: 3, unit: 'ft'}},
    {...c, id: 'c', lengthAsWritten: 'long'}, {...c, id: 'd', media: ''}, {...c, id: 'e', media: 'toString'}]};
  assert.deepEqual(X.cableBomRows(rack).map(r => [r.qty, r.model, r.description]), [
    [1, 'Cat 6A copper', '3 ft'], [1, 'Cat 6A copper', '3 m'], [1, 'Cat 6A copper', 'length not set'],
    [1, 'Media not set', 'length not set'], [1, 'toString', 'length not set']]);
  const mixed = new Map([['i2|front|mgmt-eth', {info: COPPER}], ['i3|front|port-2-1', {info: FIBER}]]);
  assert.equal(X.cableBomRows({...RACK, cables: [c]}, mixed)[0].description,
    'length not set; copper at one end, fiber at the other');
  assert.deepEqual(X.cableBomRows({...RACK, cables: []}), []);
  assert.deepEqual(X.cableBomRows({items: []}), []);
});

test('draw.io: a rear cabinet entry gets an id no item has, whatever the ids are', () => {
  assert.equal(X.rearSuffix(RACK.items), '@rear');
  assert.equal(X.drawioId('i3', 'front', '@rear'), 'i3');
  assert.equal(X.drawioId('i3', 'rear', '@rear'), 'i3@rear');
  const odd = [{id: 'i3'}, {id: 'i3@rear'}, {id: 'x@rear@'}];
  const s = X.rearSuffix(odd);
  assert.equal(s, '@rear@@');
  const ids = odd.map(i => i.id), rear = odd.map(i => X.drawioId(i.id, 'rear', s));
  assert.equal(new Set([...ids, ...rear]).size, 6);
  assert.equal(X.drawioId(7, 'front', s), '7');
});

test("draw.io: the second cabinet's label is changed by one exact replace, escaped as the vendor writes it", () => {
  const cab = (id, value) => `<mxCell id="${id}" value="${value}" style="s" vertex="1" parent="1"></mxCell>`;
  const file = (a, b) => `<mxfile host="portrayal"><!--\nNotes:\n- id="g0r1-front" value="x · front"\n--><diagram name="x">${a}${b}</diagram></mxfile>`;
  assert.equal(X.rearCabinetLabel(file(cab('g0r0-front', 'x · front'), cab('g0r1-front', 'x · front')), 'x'),
    file(cab('g0r0-front', 'x · front'), cab('g0r1-front', 'x · rear')));
  // The label arrives HTML-escaped (htmlText), and the vendor escapes that for XML.
  const label = X.htmlText('R&D <core> "a"');
  const esc = 'R&amp;amp;D &amp;lt;core&amp;gt; &quot;a&quot;';
  assert.equal(X.rearCabinetLabel(file(cab('g0r0-front', `${esc} · front`), cab('g0r1-front', `${esc} · front`)), label),
    file(cab('g0r0-front', `${esc} · front`), cab('g0r1-front', `${esc} · rear`)));
  // A rack with no name: the vendor writes the face alone.
  assert.equal(X.rearCabinetLabel(file(cab('g0r0-front', 'front'), cab('g0r1-front', 'front')), ''),
    file(cab('g0r0-front', 'front'), cab('g0r1-front', 'rear')));
  // No such cell: it throws, and never returns the file unchanged.
  assert.throws(() => X.rearCabinetLabel(file(cab('g0r0-front', 'x · front'), ''), 'x'), /rear cabinet/);
  assert.throws(() => X.rearCabinetLabel(file(cab('g0r0-front', 'x · front'), cab('g0r1-front', 'y · front')), 'x'), /rear cabinet/);
});

test('draw.io: an edge is filed under the media that colors it', () => {
  assert.equal(X.drawioMedia({media: 'os2', purpose: 'uplink'}), 'os2');
  assert.equal(X.drawioMedia({media: '', purpose: 'x'}), '');
  assert.equal(X.drawioMedia({purpose: 'x'}), '');
  assert.equal(X.drawioMedia({media: 'copper', purpose: 'management'}), 'copper-management');
  assert.equal(X.drawioMedia({media: 'copper', purpose: ''}), 'copper-server');
});

test('draw.io: each end names the cabinet that shows its panel; a loose end or an undrawn port is a note, not an edge', () => {
  const idOf = (id, pane) => X.drawioId(id, pane, '@rear');
  const all = () => true;
  const got = X.drawioCables(RACK, {ends: ENDS, idOf, drawn: all});
  assert.deepEqual(got.cables, [
    {id: 'c1', a: {item: 'i2', path: 'port-1'}, b: {item: 'i1', path: 'slot-2/module/p0'}, media: 'os2',
     purpose: 'uplink', label: 'A1', length: {value: 2, unit: 'm', source: 'entered'}},
    // leaf-1's front panel is in the front cabinet; the rear-mounted demarc's front panel is in the rear one.
    {id: 'c2', a: {item: 'i2', path: 'mgmt-eth'}, b: {item: 'i3@rear', path: 'port-2-1'}, media: 'cat6a',
     purpose: 'management', label: ''}]);
  assert.deepEqual(got.notes, [
    'Cable c3 is not drawn: end A, leaf-1 (U14) port-2, is not connected (port-2 holds no optic).',
    'Cable c3: OS2 single-mode fiber does not suit end B, which is copper.']);
  // A turned device shows its front panel on the other side.
  const turned = {...RACK, items: RACK.items.map(i => (i.id === 'i2' ? {...i, turned: true} : i))};
  assert.equal(X.drawioCables(turned, {ends: ENDS, idOf, drawn: all}).cables[0].a.item, 'i2@rear');
  // A port its cabinet does not draw: the device is hidden there, or the port is not in the drawing.
  const asked = [];
  const hidden = X.drawioCables(RACK, {ends: ENDS, idOf, drawn: (id, pane, path) => { asked.push([id, pane, path]); return id !== 'i3'; }});
  assert.deepEqual(asked, [['i2', 'front', 'port-1'], ['i1', 'front', 'slot-2/module/p0'],
                           ['i2', 'front', 'mgmt-eth'], ['i3', 'rear', 'port-2-1']]);
  assert.deepEqual(hidden.cables.map(c => c.id), ['c1']);
  assert.equal(hidden.notes.at(-1),
    'Cable c2 is not drawn: end B, demarc (U14) port-2-1, has no port drawn in the rear cabinet.');
  // Not checked, and a device gone: the cable is still not an edge to nothing, and no cabinet id is in a note.
  const gone = {...RACK, items: RACK.items.filter(i => i.id !== 'i3')};
  const un = X.drawioCables(gone, {idOf, drawn: all});
  assert.deepEqual(un.cables.map(c => c.id), ['c1', 'c3']);
  assert.deepEqual(un.notes, ["Cable c2 is not drawn: end B, a removed device's port-2-1, names a device that is not in the rack."]);
  assert.ok(![...got.notes, ...hidden.notes, ...un.notes].some(n => n.includes('@rear')));
  assert.deepEqual(X.drawioCables({...RACK, cables: []}, {idOf, drawn: all}), {cables: [], notes: []});
});

// ── fix round 1 ────────────────────────────────────────────────────────
test('schedule: a_u and b_u are the device import position (the lower U label), top-down and bottom-up', () => {
  const cab = (n, a, b) => ({id: n, a: {item: a, path: 'p', view: 'front'}, b: {item: b, path: 'p', view: 'front'}, media: 'os2', purpose: '', label: n, route: []});
  for (const [numbering, want] of [['top-down', {two: 14, ten: 13}], ['bottom-up', {two: 10, ten: 3}]]) {
    const frame = M.normalizeFrame({heightRU: 24, numbering});
    const items = [{id: 'a', label: 'two', ru: 10, u: 2}, {id: 'b', label: 'ten', ru: 3, u: 10}];
    const rack = {name: 'r', frame, items, zeroU: [], cables: [cab('c', 'a', 'b')]};
    const {rows} = X.cableScheduleRows(rack, new Map(), items);
    assert.deepEqual([rows[0].a_u, rows[0].b_u], [want.two, want.ten], numbering);
    for (const it of items) assert.equal(X.positionOf(frame, it.ru, it.u), it.id === 'a' ? want.two : want.ten);
  }
});

test('one length rule for the schedule and the BOM: usable is above 0 with a unit (m when none), else not set in both', () => {
  const run = length => {
    const rack = {...RACK, cables: [{...RACK.cables[0], length}]};
    const row = X.cableScheduleRows(rack, ENDS).rows[0];
    return [row.length, row.length_unit, X.cableBomRows(rack, ENDS)[0].description.split(';')[0]];
  };
  assert.deepEqual(run({value: 0, unit: 'm'}), ['', '', 'length not set']);
  assert.deepEqual(run({value: -2, unit: 'm'}), ['', '', 'length not set']);
  assert.deepEqual(run({value: Infinity, unit: 'm'}), ['', '', 'length not set']);
  assert.deepEqual(run({value: '3', unit: 'm'}), ['', '', 'length not set']);
  assert.deepEqual(run({value: 3}), [3, 'm', '3 m']);
  assert.deepEqual(run({value: 30, unit: 'cm'}), [30, 'cm', '30 cm']);
  assert.deepEqual(run(undefined), ['', '', 'length not set']);
});

test('BOM: undefined, null and empty media are one group', () => {
  const mk = media => ({...RACK.cables[1], id: String(media), media});
  const rack = {...RACK, cables: [mk(undefined), mk(null), mk('')]};
  const rows = X.cableBomRows(rack, ENDS);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].qty, rows[0].model], [3, 'Media not set']);
});

test('BOM: a panel with no drawing is noted once per device panel, not once per cable', () => {
  const none = {facts: {item: true, drawing: false}, info: NONE, reason: 'this panel has no drawing'};
  const ends = new Map([...ENDS, ['i2|front|port-1', none], ['i2|front|mgmt-eth', none], ['i2|front|port-2', none]]);
  assert.deepEqual(X.cableBomNotes(RACK, ends),
    ['leaf-1: its front panel had no drawing, so the cable lines do not state its connectors.']);
  assert.deepEqual(X.cableBomNotes(RACK, ENDS), []);
  assert.deepEqual(X.cableBomNotes({...RACK, cables: []}, ends), []);
});

// ── fix round: draw.io and the sheet ───────────────────────────────────
import {rackDiagram} from '../../vendor/drawio.js';

test('draw.io: the mirrored slug equals the vendor\'s on hostile ids', () => {
  const hostile = ['a b', 'a-b', 'a?', 'a', '??', '-x-', '--', '', 'é', 'a/b\\c', 'a b  c', '<b>&"', 'x.y_z', '__proto__', 'a\nb', '0'];
  for (const id of hostile) {
    const xml = rackDiagram([{label: 'g', faces: ['front'], racks: [{label: 'r', units: 4, mounted: [
      {id, name: 'n', u: 1, ru: 1, faces: {front: {svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"/>', vb: [0, 0, 10, 10], ports: []}}}]}]}], {labels: true});
    assert.ok(xml.includes(`id="${X.vendorSlug(id)}-g0r0-front"`), `${JSON.stringify(id)} -> ${X.vendorSlug(id)}`);
  }
});

test('draw.io: entries whose ids slug alike get an alias that slugs uniquely, per cabinet', () => {
  const e = (pane, id) => ({pane, id});
  const got = X.uniqueEntryIds([e('front', 'a b'), e('front', 'a-b'), e('front', 'a-b-2'), e('rear', 'a-b'), e('front', 'a?'), e('front', 'a')]);
  assert.equal(got[0], 'a b');
  const slugs = got.slice(0, 3).map(X.vendorSlug);
  assert.equal(new Set(slugs).size, 3);
  assert.equal(got[2], 'a-b-2');
  assert.notEqual(got[1], 'a-b');          // the later of two alike is the one aliased
  assert.equal(got[3], 'a-b');             // the other cabinet has its own cells
  assert.equal(new Set([got[4], got[5]].map(X.vendorSlug)).size, 2);
  assert.equal(new Set(got).size, got.length);   // an alias never repeats a raw id
  assert.deepEqual(X.uniqueEntryIds([e('front', 'x'), e('front', 'y')]), ['x', 'y']);
});

test('draw.io: only the rear cabinet\'s dashed box is reworded', () => {
  const c = (id, value, parent) => `<mxCell id="${id}" value="${value}" style="s" vertex="1" parent="${parent}"></mxCell>`;
  const xml = `<mxfile host="portrayal"><!--\nNotes:\n- no front drawing\n--><diagram name="x">` +
    c('a-g0r0-front-none', 'no front drawing', 'g0r0-front') + c('b-g0r1-front-none', 'no front drawing', 'g0r1-front') +
    c('no-g0r1-front', 'no front drawing', 'g0r1-front') + `</diagram></mxfile>`;
  const out = X.rearNoDrawing(xml);
  assert.equal(out, xml.replace('id="b-g0r1-front-none" value="no front drawing"', 'id="b-g0r1-front-none" value="no rear drawing"'));
  assert.equal(X.rearNoDrawing('<mxfile/>'), '<mxfile/>');
});

test('draw.io: the rear label is found after the notes, even when a note holds <diagram name=', () => {
  const cab = (id, value) => `<mxCell id="${id}" value="${value}" style="s" vertex="1" parent="1"></mxCell>`;
  const fake = cab('g0r1-front', 'x · front');
  const file = (inner) => `<mxfile host="portrayal"><!--\nNotes:\n- seen <diagram name="x">${inner}\n-->` +
    `<diagram name="x">${cab('g0r0-front', 'x · front')}${cab('g0r1-front', 'x · front')}</diagram></mxfile>`;
  const out = X.rearCabinetLabel(file(fake), 'x');
  assert.ok(out.endsWith(`${cab('g0r0-front', 'x · front')}${cab('g0r1-front', 'x · rear')}</diagram></mxfile>`));
  assert.ok(out.includes(fake), 'the note is untouched');
});

test('draw.io: a media that is not safe as a table key falls back to the neutral color', () => {
  for (const m of ['__proto__', 'constructor', 'default', 'Default', 'a b', 'x;y']) assert.equal(X.drawioMediaKey({media: m}), '', m);
  assert.equal(X.drawioMediaKey({media: 'OS2'}), 'os2');
  assert.equal(X.drawioMediaKey({media: 'copper', purpose: 'management'}), 'copper-management');
  assert.equal(X.drawioMediaKey({media: 'tostring'}), 'tostring');
  const rack = {...RACK, cables: [{...RACK.cables[0], media: '__proto__'}]};
  const got = X.drawioCables(rack, {ends: ENDS, idOf: id => id, drawn: () => true});
  assert.equal(got.cables[0].media, '');
});

test('draw.io: a cable to a device hidden in its cabinet says what hides it', () => {
  const idOf = (id, pane) => X.drawioId(id, pane, '@rear');
  const got = X.drawioCables(RACK, {ends: ENDS, idOf, drawn: (id) => id !== 'i3',
    hiddenBy: (id, pane) => (id === 'i3' ? 'leaf-1' : null)});
  assert.equal(got.notes.at(-1), 'Cable c2 is not drawn: end B, demarc (U14) port-2-1, is hidden behind leaf-1 in the rear cabinet.');
  const un = X.drawioCables(RACK, {ends: new Map(), idOf, drawn: () => true, unchecked: true});
  assert.deepEqual(un, {cables: [], notes: ['3 cables are not drawn because their ends could not be checked.']});
  assert.deepEqual(X.drawioCables({...RACK, cables: [RACK.cables[0]]}, {idOf, drawn: () => true, unchecked: true}).notes,
    ['1 cable is not drawn because its ends could not be checked.']);
});
