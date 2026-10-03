import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../../site/rack/model.js';
import * as C from '../../site/rack/cable-rules.js';

// A small rack: a switch and a router on the front, two identical demarcs on the rear.
function rack() {
  let r = M.newRack({name: 'Cable test'});
  for (const it of [
    {ref: 'asr-9006', cfg: 'base', ru: 2, label: 'core-1'},
    {ref: 'as7726-32x', cfg: 'ac-f2b', ru: 14, label: 'leaf-1'},
    {ref: 'tm-280', cfg: 'base', ru: 14, face: 'rear', label: 'demarc'},
    {ref: 'tm-280', cfg: 'base', ru: 20, face: 'rear', label: 'demarc'}]) r = M.withItem(r, it).rack;
  return r;
}
const end = (item, path, view = 'front') => ({item, path, view});

test('an end is {item, path, view}; its key tells apart two devices with one ref and two panels of one device', () => {
  assert.equal(C.endKey(end('i3', 'port-2-1')), 'i3|front|port-2-1');
  assert.notEqual(C.endKey(end('i3', 'port-2-1')), C.endKey(end('i4', 'port-2-1')));
  assert.notEqual(C.endKey(end('i3', 'port-1', 'front')), C.endKey(end('i3', 'port-1', 'rear')));
  assert.ok(C.sameEnd(end('i1', 'p'), {item: 'i1', path: 'p', view: 'front', extra: 1}));
});

test('paneOf is the inverse of panelFor, for every face and turn', () => {
  // elevation.js's rule, restated: which panel of the device faces a pane.
  const panelFor = (item, pane) => (((item.face === pane) !== !!item.turned) ? 'front' : 'rear');
  for (const face of ['front', 'rear']) for (const turned of [false, true]) {
    const item = {face, turned};
    for (const view of ['front', 'rear'])
      assert.equal(panelFor(item, C.paneOf(item, view)), view, JSON.stringify({face, turned, view}));
  }
  assert.equal(C.paneOf({face: 'front', turned: false}, 'front'), 'front');
  assert.equal(C.paneOf({face: 'rear', turned: false}, 'front'), 'rear', 'a rear-mounted device shows its front in the rear pane');
  assert.equal(C.paneOf({face: 'front', turned: true}, 'front'), 'rear', 'a turned device shows its front in the other pane');
  assert.equal(C.paneOf({face: 'rear', turned: true}, 'rear'), 'rear');
});

test('portPathOf drops the occupant and everything under it', () => {
  assert.equal(C.portPathOf('port-1'), 'port-1');
  assert.equal(C.portPathOf('port-1-occupant'), 'port-1');
  assert.equal(C.portPathOf('port-1-occupant/tx'), 'port-1');
  assert.equal(C.portPathOf('port-1-occupant/tx-occupant'), 'port-1');
  assert.equal(C.portPathOf('slot-2/module/p0-occupant/rx'), 'slot-2/module/p0');
  assert.equal(C.portPathOf('port-10'), 'port-10');
});

test('withCable allocates c ids, copies the ends, and omits an unset length', () => {
  const r0 = rack();
  const {rack: r1, cable: c1} = C.withCable(r0, {a: end('i2', 'port-1'), b: end('i1', 'slot-2/module/p0'),
    media: 'os2', purpose: 'uplink', label: 'A1', length: {value: 2, unit: 'm', source: 'entered'}});
  assert.deepEqual(c1, {id: 'c1', a: {item: 'i2', path: 'port-1', view: 'front'},
    b: {item: 'i1', path: 'slot-2/module/p0', view: 'front'}, media: 'os2', purpose: 'uplink', label: 'A1',
    length: {value: 2, unit: 'm', source: 'entered'}, route: []});
  assert.equal(r0.cables.length, 0, 'the original rack is untouched');
  const {rack: r2, cable: c2} = C.withCable(r1, {a: end('i2', 'mgmt-eth'), b: end('i3', 'port-2-1')});
  assert.equal(c2.id, 'c2');
  assert.ok(!('length' in c2));
  assert.deepEqual([c2.media, c2.purpose, c2.label, c2.route], ['', '', '', []]);
  assert.equal(r2.items, r0.items, 'a cable edit leaves the items array itself alone');
  assert.equal(C.updateCable(r2, 'c1', {media: 'om4', length: null}).cables[0].media, 'om4');
  assert.ok(!('length' in C.updateCable(r2, 'c1', {length: null}).cables[0]));
  assert.deepEqual(C.updateCable(r2, 'c2', {length: {value: 3, unit: 'ft', source: 'entered'}}).cables[1].length,
    {value: 3, unit: 'ft', source: 'entered'});
  assert.deepEqual(C.withoutCable(r2, 'c1').cables.map(c => c.id), ['c2']);
});

test('one cable per port: a taken port is refused with a sentence that names the device, its U and the cable', () => {
  const {rack: r} = C.withCable(rack(), {a: end('i2', 'port-1'), b: end('i3', 'port-2-1'), label: 'A1'});
  assert.deepEqual(C.portFree(r, end('i2', 'port-2')), {ok: true});
  assert.deepEqual(C.portFree(r, end('i2', 'port-1')),
    {ok: false, reason: 'leaf-1 (U14) port-1 already has a cable (A1).'});
  assert.deepEqual(C.portFree(r, end('i3', 'port-2-1')),
    {ok: false, reason: 'demarc (U14) port-2-1 already has a cable (A1).'});
  assert.deepEqual(C.portFree(r, end('i4', 'port-2-1')), {ok: true}, 'the other demarc is another device');
  assert.deepEqual(C.portFree(r, end('i2', 'port-1', 'rear')), {ok: true}, 'the same path on the other panel is another port');
  assert.deepEqual(C.portFree(r, end('i2', 'port-1'), {ignoreId: 'c1'}), {ok: true}, 'editing a cable does not collide with itself');
  assert.deepEqual(C.canCable(r, end('i2', 'port-2'), end('i2', 'port-2')),
    {ok: false, reason: 'A cable needs two different ports.'});
  assert.deepEqual(C.canCable(r, end('i2', 'port-2'), end('i4', 'port-2-1')), {ok: true});
  assert.equal(C.canCable(r, end('i2', 'port-2'), end('i2', 'port-1')).ok, false);
  const unlabeled = C.withCable(rack(), {a: end('i2', 'port-1'), b: end('i3', 'port-2-1')}).rack;
  assert.match(C.portFree(unlabeled, end('i2', 'port-1')).reason, /\(c1\)\.$/, 'a cable with no label is named by its id');
});

test('endName and tagText say which device, and survive a removed one', () => {
  const r = rack();
  assert.equal(C.endName(r, end('i4', 'port-2-1')), 'demarc (U20) port-2-1');
  assert.equal(C.endName({...r, frame: {...r.frame, numbering: 'top-down'}}, end('i4', 'port-2-1')), 'demarc (U23) port-2-1');
  assert.equal(C.endName(r, end('i9', 'port-1')), "a removed device's port-1");
  assert.equal(C.tagText(r, end('i3', 'port-2-1')), '→ demarc port-2-1');
  assert.equal(C.tagText(r, end('i9', 'port-1')), '→ removed port-1');
  const long = C.tagText(r, end('i1', 'slot-2/module/a-very-long-port-name-indeed'));
  assert.equal(long.length, 32);
  assert.ok(long.endsWith('…'));
});

test('cablesOf and withoutCablesOf find a device\'s cables by its id, at either end', () => {
  let r = C.withCable(rack(), {a: end('i2', 'port-1'), b: end('i1', 'slot-2/module/p0')}).rack;
  r = C.withCable(r, {a: end('i2', 'mgmt-eth'), b: end('i3', 'port-2-1')}).rack;
  r = C.withCable(r, {a: end('i4', 'port-2-1'), b: end('i1', 'slot-2/module/p1')}).rack;
  assert.deepEqual(C.cablesOf(r, 'i2').map(c => c.id), ['c1', 'c2']);
  assert.deepEqual(C.cablesOf(r, 'i3').map(c => c.id), ['c2']);
  assert.deepEqual(C.cablesOf(r, 'i9'), []);
  assert.deepEqual(C.withoutCablesOf(r, 'i2').cables.map(c => c.id), ['c3']);
  // Removing the item alone keeps its cables: they become loose ends.
  assert.equal(M.withoutItem(r, 'i2').cables.length, 3);
  // Moving it keeps them too: a cable names the item's id, not its place.
  assert.deepEqual(M.updateItem(r, 'i2', {ru: 16, face: 'rear'}).cables, r.cables);
});

test('parseLength takes a positive number or nothing; lengthText prints it', () => {
  assert.deepEqual(C.parseLength('', 'm'), {ok: true, length: null});
  assert.deepEqual(C.parseLength('  ', 'ft'), {ok: true, length: null});
  assert.deepEqual(C.parseLength('2.5', 'm'), {ok: true, length: {value: 2.5, unit: 'm', source: 'entered'}});
  assert.deepEqual(C.parseLength('10', 'ft'), {ok: true, length: {value: 10, unit: 'ft', source: 'entered'}});
  assert.deepEqual(C.parseLength('3', 'yards'), {ok: true, length: {value: 3, unit: 'm', source: 'entered'}});
  for (const bad of ['0', '-1', 'abc', 'Infinity'])
    assert.deepEqual(C.parseLength(bad, 'm'), {ok: false, reason: 'Enter a length above 0, or leave it empty.'}, bad);
  assert.equal(C.lengthText({value: 2, unit: 'm'}), '2 m');
  assert.equal(C.lengthText({value: 10, unit: 'ft'}), '10 ft');
  assert.equal(C.lengthText(undefined), '');
});

test('cablePlan hands cables.js each end as [item id, path, pane]', () => {
  let r = rack();
  r = C.withCable(r, {a: end('i2', 'port-1'), b: end('i1', 'slot-2/module/p0'), media: 'os2', purpose: 'uplink'}).rack;
  r = C.withCable(r, {a: end('i2', 'mgmt-eth'), b: end('i3', 'port-2-1')}).rack;
  r = C.withCable(r, {a: end('i2', 'port-2'), b: end('i9', 'port-2-1')}).rack;
  assert.deepEqual(C.cablePlan(r).links, [
    {id: 'c1', media: 'os2', purpose: 'uplink', from: ['i2', 'port-1', 'front'], to: ['i1', 'slot-2/module/p0', 'front']},
    {id: 'c2', media: 'unset', purpose: '', from: ['i2', 'mgmt-eth', 'front'], to: ['i3', 'port-2-1', 'rear']},
    {id: 'c3', media: 'unset', purpose: '', from: ['i2', 'port-2', 'front'], to: ['i9', 'port-2-1', 'none']}]);
  assert.deepEqual(C.cablePlan(M.newRack()).links, []);
});

test('the loader keeps every cable: it fixes the shape and never drops one', () => {
  const d = M.parseDoc({format: 'portrayal-rack', version: 1, racks: [{frame: {}, items: [{id: 'i1', ref: 'x', ru: 1}],
    cables: [
      {id: 'c1', a: {item: 'i1', path: 'port-1', view: 'front'}, b: {item: 'gone', path: 'port-2', view: 'rear'},
       media: 'os2', purpose: 'uplink', label: 'A1', length: {value: '2', unit: 'm', source: 'entered'},
       route: [{item: 'i1'}], color: 'red'},
      {id: 'c1', a: {item: 'i1', path: 'port-3'}, b: null, media: 'os1', length: {value: 0}},
      {},
      'nonsense',
      {id: 'c2', a: {item: 'i1', path: 'p', view: 'sideways'}, b: {item: 'i1', path: 'q'}, length: {value: 3, unit: 'ft', source: 'routed'}},
    ]}]});
  const cs = d.racks[0].cables;
  assert.equal(cs.length, 5, 'five in, five out');
  assert.deepEqual(cs[0], {id: 'c1', a: {item: 'i1', path: 'port-1', view: 'front'},
    b: {item: 'gone', path: 'port-2', view: 'rear'}, media: 'os2', purpose: 'uplink', label: 'A1',
    length: {value: 2, unit: 'm', source: 'entered'}, route: [{item: 'i1'}], color: 'red'},
    'a missing item is kept; route and unknown fields survive');
  assert.equal(new Set(cs.map(c => c.id)).size, 5, 'ids are unique');
  assert.equal(cs[4].id, 'c2', 'a declared id is not taken by a repaired one before it');
  assert.deepEqual(cs[1].b, {item: '', path: '', view: 'front'});
  assert.equal(cs[1].media, 'os1', 'an unknown media is kept as written');
  assert.ok(!('length' in cs[1]), 'a length that is not a positive number is dropped, the cable is not');
  assert.deepEqual(cs[2].a, {item: '', path: '', view: 'front'});
  assert.deepEqual([cs[3].media, cs[3].purpose, cs[3].label, cs[3].route], ['', '', '', []]);
  assert.equal(cs[4].a.view, 'front');
  assert.deepEqual(cs[4].length, {value: 3, unit: 'ft', source: 'routed'});
});

test('a cabled document survives serialize and parse unchanged', () => {
  let d = M.newDoc({name: 'Cabled'});
  let r = M.withItem(d.racks[0], {ref: 'as7726-32x', cfg: 'ac-f2b', ru: 14}).rack;
  r = M.withItem(r, {ref: 'tm-280', cfg: 'base', ru: 14, face: 'rear'}).rack;
  r = C.withCable(r, {a: end('i1', 'mgmt-eth'), b: end('i2', 'port-2-1'), media: 'cat6a', purpose: 'management',
    label: 'M1', length: {value: 3, unit: 'ft', source: 'entered'}}).rack;
  r = C.withCable(r, {a: end('i1', 'port-2'), b: end('i2', 'port-1-1')}).rack;
  d = {...d, racks: [r]};
  assert.deepEqual(M.parseDoc(M.serialize(d)), d);
});
