// tests/rack/fibrain-coupler.test.mjs
// THE FIBRAIN XCU'S ADAPTERS ARE COUPLERS WITH A CABLE END ON EACH FACE (kit 0.48.0, Portrayal #1086), with the real
// library. The rules are the kit's and are tested there; these hold the site to handing them what the kit asks: the
// public test rack (an XCU in its xcu10-51id configuration on the rear rails of a four-post frame, and two devices
// with an SC optic), a cable to an adapter's outer face and one to its inner face accepted by the agent's tool and
// by the editor, the inner ends in the port picker's list, and a made-up adapter refused.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRackEditor} from '../../vendor/rack/editor.js';
import {parseDoc} from '../../vendor/rack/model.js';
import * as Q from '../../vendor/rack/queries.js';
import {rackTools} from '../../site/rack/agent-tools.js';

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
const rackOf = () => parseDoc(fixture('fibrain-coupler.rack.json')).racks[0];
const editorFor = rack => createRackEditor({doc: {format: 'portrayal-rack', version: 4, id: 'd', racks: [rack]}, chassisOf});
const tools = ed => rackTools({ed, chassisOf, queries: {...Q, inspect: (r, id, c) => Q.inspect(r, id, c)}, runExport: async () => ({}),
  context: async () => ctx}).reduce((o, t) => ({...o, [t.name]: t}), {});
const text = out => out.content.map(c => c.text).join('\n');
const slot = 'drawer/module/slot-1/module/';

test('the test rack is an XCU in its xcu10-51id configuration on the rear rails of a four-post frame, with two SC devices', () => {
  const r = rackOf();
  assert.equal(r.frame.kind, 'four-post');
  const xcu = r.items.find(i => i.ref === 'xcu');
  assert.equal(xcu.cfg, 'xcu10-51id');
  assert.equal(xcu.face, 'rear');
  assert.equal(r.items.filter(i => i.ref === 'xs-010x-r').length, 2);
});

test('a cable to an adapter\'s outer face and another to its inner face are both accepted by the agent\'s tool; a made-up adapter is refused', async () => {
  const ed = editorFor(structuredClone(rackOf()));
  const t = tools(ed);
  const inner = await t.edit_rack.execute({commands: [{op: 'cable.add', a: {item: 'i2', path: 'pon', view: 'rear'},
    b: {item: 'i1', path: `${slot}b01`, view: 'rear'}, media: 'os2'}]});
  assert.ok(!inner.isError, text(inner));
  const outer = await t.edit_rack.execute({commands: [{op: 'cable.add', a: {item: 'i3', path: 'pon', view: 'rear'},
    b: {item: 'i1', path: `${slot}sc01`, view: 'front'}, media: 'os2'}]});
  assert.ok(!outer.isError, text(outer));
  assert.equal(ed.rack().cables.length, 2);
  for (const path of [`${slot}sc99`, `${slot}b99`]) {
    const bad = await t.edit_rack.execute({commands: [{op: 'cable.add', a: {item: 'i2', path: 'pon', view: 'rear'},
      b: {item: 'i1', path, view: path.endsWith('b99') ? 'rear' : 'front'}, media: 'os2'}]});
    assert.equal(bad.isError, true, path);
    assert.match(text(bad), /drawer\/module\/slot-1 holds XMN1051GB, which has no port (sc|b)99/);
  }
  assert.equal(ed.rack().cables.length, 2, 'nothing was added');
});

test('the same two cables are accepted by the editor the cable editor sends its commands to', () => {
  const ed = editorFor(structuredClone(rackOf()));
  const add = (item, path, view) => ed.apply({op: 'cable.add', a: {item, path: 'pon', view: 'rear'}, b: {item: 'i1', path: `${slot}${path}`, view}, media: 'os2'}, {ctx});
  assert.ok(add('i2', 'b01', 'rear'));
  assert.ok(add('i3', 'sc01', 'front'));
  assert.equal(ed.rack().cables.length, 2);
});

test('the cable editor\'s port picker lists the inner ends of every adapter, beside the outer ones the drawing gives it', async () => {
  const rack = rackOf();
  const outer = [1, 2, 3, 4].flatMap(s => Array.from({length: 12}, (_, n) => ({path: `drawer/module/slot-${s}/module/sc${String(n + 1).padStart(2, '0')}`,
    cls: 'port', media: 'fiber', speed: null})));
  const free = await Q.freePorts(rack, 'i1', {...ctx, portsOf: async (item, view) => (view === 'front' ? outer : [])}, {});
  const inner = free.filter(p => p.view === 'rear');
  assert.equal(inner.length, 48, 'four holders of twelve adapters');
  assert.deepEqual(inner.slice(0, 2).map(p => p.path), [`${slot}b01`, `${slot}b02`]);
  assert.equal(free.filter(p => p.view === 'front').length, 48);
});
