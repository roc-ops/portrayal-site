import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NOT_MODELLED, STATE_TAG, countPorts, deviceFacts, alignFacts, authoredSections,
         factText, devicesFromSearch } from '../../site/facts.js';

// The two devices the page opens on, with the numbers their vendored files carry:
// as7726-32x (chassis 438.4 x 43.5 x 515, 1 U, 10.87 kg) and hlx-tgv (172 x 40 x
// 115, desktop, no ru and no weight).
const SWITCH = {
  name: 'as7726-32x',
  rack: {mount: undefined},
  source: {chassis: {width: 438.4, height: 43.5, depth: 515, ru: 1, 'weight-kg': 10.87}},
  configs: {bays: {front: [], rear: [{id: 'psu-1'}, {id: 'psu-2'}, {id: 'fan-1'}], left: []}},
  faces: {
    front: '<g id="port-1" data-class="port" data-media="qsfp28" data-speed="100g"><g id="port-1--aperture" data-class="port" data-inner="1" data-media="qsfp"></g></g>'
         + '<g id="port-2" data-class="port" data-media="qsfp28" data-speed="100g"></g>'
         + '<g id="mgmt" data-class="port" data-media="rj45" data-speed="1g"></g>'
         + '<g id="console" data-class="port" data-media="rj45-serial"></g>',
    rear: '<g id="x" data-class="led"></g>',
  },
};
const DESKTOP = {name: 'hlx-tgv', rack: {mount: 'desktop'}, source: {chassis: {width: 172, height: 40, depth: 115}}, configs: {bays: {}}, faces: null};

const byKey = d => Object.fromEntries(d.facts.map(f => [f.key, f]));

// A PORT IS ONE ELEMENT, NOT ITS APERTURE. A cage's inner opening is also
// class port, marked data-inner; counting it would double every cage.
test('ports are counted by media and speed, an aperture is not a second port', () => {
  assert.deepEqual(countPorts(SWITCH.faces.front), [
    {media: 'qsfp28', speed: '100g', n: 2},
    {media: 'rj45', speed: '1g', n: 1},
    {media: 'rj45-serial', speed: null, n: 1},
  ]);
  assert.deepEqual(countPorts('<svg></svg>'), []);
});

test('a device with everything modelled gives derived and stated figures with their units', () => {
  const f = byKey(deviceFacts(SWITCH));
  assert.deepEqual([f['size.width'].value, f['size.height'].value, f['size.depth'].value], [438.4, 43.5, 515]);
  assert.equal(f['size.width'].state, 'derived');
  assert.equal(f['size.volume'].value, 9.82);
  assert.equal(f['size.volume'].unit, 'L');
  assert.equal(f['mount.ru'].value, 1);
  assert.equal(f['physical.weight-kg'].state, 'stated');
  assert.equal(f['ports.total'].value, 4);
  assert.equal(f['bays.count'].value, 3);
  assert.equal(factText(f['physical.weight-kg']), '10.87 kg');
});

// A MISSING FIGURE IS NEVER A BLANK. The desktop box has no rack units and no
// weight in the library; both read "not modelled" and carry the state.
test('a missing figure is unknown and prints "not modelled", never an empty cell', () => {
  const f = byKey(deviceFacts(DESKTOP));
  for (const k of ['physical.weight-kg', 'ports.total']) {
    assert.equal(f[k].state, 'unknown', k);
    assert.equal(f[k].value, null, k);
    assert.equal(factText(f[k]), NOT_MODELLED, k);
  }
  // every state has a word of its own, so a greyscale print still tells them apart
  assert.equal(new Set(Object.values(STATE_TAG)).size, Object.keys(STATE_TAG).length);
  assert.ok(Object.values(STATE_TAG).every(w => w.length > 0));
  assert.equal(f['mount.ru'].value, 'not rack mounted');
  assert.equal(f['mount.ru'].state, 'derived');
  assert.equal(f['size.volume'].value, 0.79);
});

test('a device with no chassis block has every size fact unknown, not zero', () => {
  const f = byKey(deviceFacts({name: 'bare'}));
  for (const f1 of Object.values(f)) assert.equal(f1.state, 'unknown', f1.key);
  assert.equal(f['size.volume'].value, null);
});

test('a rack-mounted part with no rack units stated says not modelled', () => {
  const f = byKey(deviceFacts({name: 'x', rack: {mount: 'rack-side'}, source: {chassis: {width: 1, height: 2, depth: 3}}}));
  assert.equal(f['mount.ru'].state, 'unknown');
});

test('one face read and the other not says so rather than totalling as if both were', () => {
  const f = byKey(deviceFacts({...SWITCH, faces: {front: SWITCH.faces.front, rear: null}}));
  assert.equal(f['ports.total'].value, 4);
  assert.match(f['ports.total'].detail, /front only/);
});

// THE ROWS LINE UP BY EXACT KEY. A port kind one device draws and another does
// not is a real zero for the device whose faces were read, and unknown for the
// one whose faces were not.
test('aligned rows carry one cell per device, zero where the faces were read and unknown where not', () => {
  const rows = alignFacts([deviceFacts(SWITCH), deviceFacts(DESKTOP)]);
  assert.ok(rows.every(r => r.cells.length === 2), 'a cell for every device in every row');
  const qsfp = rows.find(r => r.key === 'ports.qsfp28.100g');
  assert.equal(qsfp.cells[0].value, 2);
  assert.equal(qsfp.cells[1].state, 'unknown');
  const other = alignFacts([deviceFacts(SWITCH), deviceFacts({...SWITCH, name: 'b', faces: {front: '<g data-class="port" data-media="sfp" data-speed="10g"></g>', rear: ''}})]);
  assert.equal(other.find(r => r.key === 'ports.qsfp28.100g').cells[1].value, 0);
  assert.equal(other.find(r => r.key === 'ports.qsfp28.100g').cells[1].state, 'derived');
  // the order: size, mounting and weight first, ports after their total, bays last
  const keys = rows.map(r => r.key);
  assert.ok(keys.indexOf('ports.total') < keys.indexOf('ports.qsfp28.100g'));
  assert.equal(keys.at(-1), 'bays.count');
});

// AUTHORED ATTRIBUTES ARE SHOWN, NEVER COMPUTED ON. weight and
// weight-configured-kg are different facts; sorted, they sit next to each other
// and a reader sees the difference.
test('authored attributes align by exact key, sorted, with no merging of near names', () => {
  const secs = authoredSections([
    {name: 'a', attrs: {physical: {weight: '11.3 kg', 'weight-configured-kg': '12.1'}, power: {'power-max-w': '650'}}},
    {name: 'b', attrs: {physical: {weight: '2 kg'}}},
  ]);
  assert.deepEqual(secs.map(s => s.section), ['physical', 'power']);
  const phys = secs[0];
  assert.deepEqual(phys.rows.map(r => r.key), ['weight', 'weight-configured-kg']);
  assert.deepEqual(phys.rows[0].cells.map(c => c.text), ['11.3 kg', '2 kg']);
  assert.equal(phys.rows[1].cells[1].state, 'unknown');
  assert.equal(phys.rows[1].cells[1].text, NOT_MODELLED);
});

test('a section a device lacks is shown as lacking, in every row of it', () => {
  const secs = authoredSections([
    {name: 'a', attrs: {management: {'mgmt-ports': '1x RJ-45'}}},
    {name: 'b', attrs: {physical: {weight: '2 kg'}}},
    {name: 'c', attrs: null},
  ]);
  const mgmt = secs.find(s => s.section === 'management');
  assert.deepEqual(mgmt.missingIn, ['b', 'c']);
  assert.deepEqual(mgmt.rows[0].cells.map(c => c.state), ['stated', 'absent', 'absent']);
  assert.equal(mgmt.rows[0].cells[1].text, 'no management attributes recorded');
});

test('an authored value is shown as the model wrote it, a non-string as its JSON', () => {
  const secs = authoredSections([{name: 'a', attrs: {x: {s: '3.2 Tbps', n: 650, l: ['a', 'b']}}}]);
  assert.deepEqual(secs[0].rows.map(r => r.cells[0].text), ['["a","b"]', '650', '3.2 Tbps']);
});

test('the URL names devices: only the ones the library has, once each, in order', () => {
  const lib = ['as7726-32x', 'hlx-tgv', 'ap7821b'];
  assert.deepEqual(devicesFromSearch('?devices=hlx-tgv,nope,as7726-32x,hlx-tgv', lib), ['hlx-tgv', 'as7726-32x']);
  assert.deepEqual(devicesFromSearch('', lib), []);
});
