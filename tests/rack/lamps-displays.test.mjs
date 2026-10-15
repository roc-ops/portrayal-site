// tests/rack/lamps-displays.test.mjs
// LAMPS, DIGITS, OUTLETS, BREAKERS AND DISPLAYS IN A RACK, with the real library (kit 0.45.0 and 0.47.0, and the
// FHD RJ45 module's rear jacks of 0.46.0). The rules are the kit's and are tested there; these hold the site to
// handing them what the kit asks: the maps a drawing is given (settable.js paintMaps) for the public test racks,
// the agent's tools reaching state.set and display.set and reading back what they set, and a cable to a
// keystone jack's rear and front, with the refusal for a side a part lacks.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRackEditor} from '../../vendor/rack/editor.js';
import {parseDoc} from '../../vendor/rack/model.js';
import * as Q from '../../vendor/rack/queries.js';
import {paints, paintMaps} from '../../site/rack/settable.js';
import {rackTools} from '../../site/rack/agent-tools.js';
import {agentContextFor} from '../../site/rack/agent-context.js';

const dist = f => JSON.parse(readFileSync(new URL(`../../assets/dist/${f}`, import.meta.url)));
const fixture = f => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url)));
const devices = dist('rack.json').devices;
const comps = new Map(dist('components.json').components.map(c => [`${c.ns}/${c.name}@${String(c.major).replace(/^v/, '')}`, c]));
const cache = new Map();
const slotsOf = ref => {
  if (!cache.has(ref)) {
    const j = dist(`${ref}.configs.json`);
    cache.set(ref, {bays: j.bays || {}, cages: j.cages || {}, configs: j.configs || [], default: j.default ?? null, 'pdu-class': j['pdu-class'] ?? null});
  }
  return cache.get(ref);
};
const compByRef = ref => (ref == null ? null : comps.get(String(ref).split(':')[0]) ?? null);
const chassisOf = ref => devices[ref] ?? null;
const ctx = {chassisOf, slotsOf, compByRef};
const rackOf = name => parseDoc(fixture(name)).racks[0];
const editorFor = rack => {
  const ed = createRackEditor({doc: {format: 'portrayal-rack', version: 4, id: 'd', racks: [rack]}, chassisOf});
  return ed;
};
const tools = ed => rackTools({ed, chassisOf, queries: {...Q, inspect: (r, id, c) => Q.inspect(r, id, c)}, runExport: async () => ({}),
  context: async () => ctx}).reduce((o, t) => ({...o, [t.name]: t}), {});
const text = out => out.content.map(c => c.text).join('\n');

test('the test racks open with nothing said against them', () => {
  for (const f of ['lamps-displays.rack.json', 'keystone-rear.rack.json']) {
    const doc = parseDoc(fixture(f));
    assert.ok(doc.racks[0].items.length >= 2, f);
  }
});

test('a rack that sets nothing paints nothing, and reads no parts list for it', async () => {
  const r = rackOf('keystone-rear.rack.json');
  assert.equal(paints(r), false);
  assert.equal((await paintMaps(r, {}, async () => null)).size, 0);
});

test('every lamp, digit, outlet, breaker and display the test rack sets is handed to its drawing', async () => {
  const r = rackOf('lamps-displays.rack.json');
  assert.equal(paints(r), true);
  const maps = await paintMaps(r, ctx, async () => null);
  const sw = maps.get('i1').states;
  assert.equal(sw['led-sys'], 'ok');
  assert.equal(sw['led-port-4/lamp'], 'on');
  assert.equal(sw['status-display/digit-2'], '4');
  assert.equal(maps.get('i2').displays.beacon.digits, '1f');
  const pdu = maps.get('z1');
  assert.equal(pdu.states['led-a1'], 'on');
  assert.equal(pdu.states['breaker-a/rocker'], 'on');
  assert.equal(pdu.states['outlet-b8'], 'off');
  assert.deepEqual(pdu.displays['network-module/module/lcd'].text.slice(0, 2), ['PDU A', '192.0.2.17']);
  assert.match(maps.get('z2').displays['network-module/module/lcd'].image, /^data:image\/svg\+xml;utf8,/);
});

test('what the device does not declare is kept in the file and not handed to a drawing', async () => {
  const r = structuredClone(rackOf('lamps-displays.rack.json'));
  r.items[0].states['led-nonsense'] = 'on';
  r.items[0].states['led-sys'] = 'purple';
  r.zeroU[0].displays['status-display'] = {digits: '12'};
  const maps = await paintMaps(r, ctx, async () => null);
  assert.equal(maps.get('i1').states['led-nonsense'], undefined);
  assert.equal(maps.get('i1').states['led-sys'], undefined);
  assert.equal(maps.get('z1').displays['status-display'], undefined);
});

test('a picture that is a library asset is read and handed on as a data URL', async () => {
  const r = structuredClone(rackOf('lamps-displays.rack.json'));
  r.zeroU[1].displays = {'network-module/module/lcd': {image: 'img/logo.svg'}};
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8"/></svg>');
  const asked = [];
  const maps = await paintMaps(r, ctx, async p => { asked.push(p); return svg; });
  assert.deepEqual(asked, ['img/logo.svg']);
  assert.match(maps.get('z2').displays['network-module/module/lcd'].image, /^data:image\/svg\+xml;base64,/);
});

test('the agent sets a lamp, a digit, a breaker and a display with the same commands the page sends, and reads them back', async () => {
  const base = structuredClone(rackOf('lamps-displays.rack.json'));
  for (const e of [...base.items, ...base.zeroU]) { delete e.states; delete e.displays; }
  const ed = editorFor(base);
  const t = tools(ed);
  const set = async commands => { const out = await t.edit_rack.execute({commands}); assert.ok(!out.isError, text(out)); };
  await set([{op: 'state.set', id: 'i1', path: 'led-sys', state: 'ok'}, {op: 'state.set', id: 'i1', path: 'led-port-4/lamp', state: 'on'},
    {op: 'state.set', id: 'i1', path: 'status-display/digit-2', state: '4'}, {op: 'state.set', id: 'z1', path: 'breaker-a/rocker', state: 'off'},
    {op: 'display.set', id: 'z1', path: 'network-module/module/lcd', content: {text: ['PDU A', '192.0.2.17']}},
    {op: 'display.set', id: 'i2', path: 'beacon', content: {digits: '1f'}}]);
  const r = ed.rack();
  assert.equal(r.items[0].states['led-sys'], 'ok');
  assert.equal(r.zeroU[0].states['breaker-a/rocker'], 'off');
  assert.equal(r.items[1].displays.beacon.digits, '1f');
  // (the first page of a switch says there is something to set; the section lists it)
  const head = text(await t.inspect.execute({id: 'i1'}));
  assert.match(head, /state\.set takes \d+ paths of lamps, digits, outlets or breakers; set now: .*led-sys ok.*\(section settable lists them\)/);
  const sw = text(await t.inspect.execute({id: 'i1', section: 'settable'}));
  assert.match(sw, /set now: .*led-sys ok/);
  assert.match(sw, /led-port-0\.\.\d+\/lamp.* can be off or on/);
  const pdu = text(await t.inspect.execute({id: 'z1'}));
  assert.match(pdu, /Displays display\.set takes:\nnetwork-module\/module\/lcd: .*shows \{"text":\["PDU A","192\.0\.2\.17"\]\}/);
  // a part that is no display is refused with the displays it has
  const no = await t.edit_rack.execute({commands: [{op: 'display.set', id: 'i1', path: 'led-sys', content: {text: ['x']}}]});
  assert.equal(no.isError, true);
  assert.match(text(no), /is not a display/);
  // and the same maps the page draws come of the same rack
  const maps = await paintMaps(r, ctx, async () => null);
  assert.equal(maps.get('i1').states['status-display/digit-2'], '4');
  assert.equal(maps.get('z1').displays['network-module/module/lcd'].text[1], '192.0.2.17');
});

test('a cable to a keystone jack\'s rear and another to its front are both accepted; a rear jack on a part that has none is refused with its list', async () => {
  const ed = editorFor(structuredClone(rackOf('keystone-rear.rack.json')));
  const t = tools(ed);
  const rear = await t.edit_rack.execute({commands: [{op: 'cable.add', a: {item: 'z1', path: 'network-module/module/eth0', view: 'front'},
    b: {item: 'i2', path: 'bay-1/module/b1', view: 'rear'}, media: 'cat6'}]});
  assert.ok(!rear.isError, text(rear));
  const front = await t.edit_rack.execute({commands: [{op: 'cable.add', a: {item: 'i1', path: 'oob', view: 'front'},
    b: {item: 'i2', path: 'bay-1/module/p1', view: 'front'}, media: 'cat6'}]});
  assert.ok(!front.isError, text(front));
  assert.equal(ed.rack().cables.length, 2);
  const none = await t.edit_rack.execute({commands: [{op: 'cable.add', a: {item: 'i1', path: 'console', view: 'front'},
    b: {item: 'i2', path: 'bay-2/module/b1', view: 'rear'}, media: 'cat6'}]});
  assert.equal(none.isError, true);
  assert.equal(ed.rack().cables.length, 2, 'nothing was added');
  console.log(text(none));
});
