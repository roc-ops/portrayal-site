// tests/rack/kit-contract.test.mjs
// THE KIT, AS THE AGENT TOOLS CALL IT (round 2 plan, Task 1): every interface
// site/rack/agent-tools.js and rack-page.js consume, pinned as @portrayal/kit
// 0.4.0 landed it (Portrayal 46bf55a3). A kit sync that changes one fails here,
// not deep in a tool test.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Q from '../../vendor/rack/queries.js';
import {COMMANDS} from '../../vendor/rack/commands.js';
import {loadSlots} from '../../vendor/rack/catalog.js';
import {createRackEditor} from '../../vendor/rack/editor.js';
import * as M from '../../vendor/rack/model.js';
import {SIZES, chassisOf, slotsOf, compByRef} from './fixtures/kit-slots.mjs';

const ctx = {chassisOf, slotsOf, compByRef};
const end = (item, path) => ({item, path, view: 'front'});
const placed = () => {
  const ed = createRackEditor({doc: M.newDoc(), chassisOf});
  const res = ed.apply([{op: 'place', ref: 'as7726-32x', face: 'front', ru: 40, as: 'a'},
                        {op: 'place', ref: 'as7726-32x', face: 'front', ru: 38, as: 'b'},
                        {op: 'cable.add', a: end('@a', 'port-1'), b: end('@b', 'port-1'), purpose: 'uplink'}], {origin: 'agent', ctx});
  assert.equal(res.error, undefined, res.error);
  return ed;
};

test('the kit exports what the round-2 tools call', () => {
  for (const f of ['inspect', 'selectCables', 'describe', 'catalog', 'freePorts', 'looseEnds', 'fitsAt', 'freeUs'])
    assert.equal(typeof Q[f], 'function', f);
  assert.equal(typeof loadSlots, 'function');
  for (const op of ['fit', 'field']) assert.ok(Object.hasOwn(COMMANDS, op), op);
  assert.ok(COMMANDS['cable.update'].args.properties.a && COMMANDS['cable.update'].args.properties.b, 'cable.update takes a and b');
  for (const f of ['newRack', 'withItem', 'dcimOf', 'newDoc', 'nextRackName']) assert.equal(typeof M[f], 'function', f);
});

test('inspect: an item with its parts lists, without them, and gone', async () => {
  const ed = placed();
  const o = await Q.inspect(ed.rack(), 'i1', ctx);
  assert.equal(o.kind, 'item');
  for (const k of ['id', 'ref', 'model', 'manufacturer', 'label', 'cfg', 'configs', 'ru', 'face', 'turned', 'managers', 'bays', 'cages', 'fields', 'cables'])
    assert.ok(k in o, k);
  const c1 = o.cages.find(c => c.path === 'port-1');
  assert.ok(c1 && 'holds' in c1 && c1.view === 'front' && c1.interface === 'qsfp28', JSON.stringify(c1));
  assert.deepEqual(c1.accepts.map(a => a.ref), ['generic/qsfp-lc@2', 'generic/qsfp-dac@1']);
  assert.deepEqual(o.configs.map(c => [c.name, c.description]), [['ac-f2b', 'AC power, front-to-back air.']]);
  assert.deepEqual(o.cables.map(c => [c.id, c.end, c.path, c.view]), [['c1', 'a', 'port-1', 'front']]);
  assert.equal(typeof o.cables[0].other, 'string');
  assert.equal((await Q.inspect(ed.rack(), 'i1', {chassisOf})).slots, 'not loaded');
  assert.ok((await Q.inspect(ed.rack(), 'i9', ctx)).error);
});

test('inspect: a cable', async () => {
  const o = await Q.inspect(placed().rack(), 'c1', ctx);
  assert.equal(o.kind, 'cable');
  for (const k of ['a', 'b', 'media', 'purpose', 'label', 'length', 'routed', 'slack', 'route', 'lanes', 'passes', 'loose', 'mismatch'])
    assert.ok(k in o, k);
  assert.equal(o.a.item, 'i1');
  assert.equal(o.purpose, 'uplink');
  assert.equal(o.routed, null);   // no ctx.route given
  assert.equal(o.loose, null);    // no ctx.cableFacts: not checked, which is not "none loose"
  // a cable-facts reader that rejects leaves the ends unchecked, never an error
  const bad = await Q.inspect(placed().rack(), 'c1', {...ctx, cableFacts: async () => { throw new Error('offline'); }});
  assert.equal(bad.unchecked, true);
  assert.equal(bad.error, undefined);
});

test('selectCables: by item, by port, by purpose, loose, and an empty selection', async () => {
  const r = placed().rack();
  assert.deepEqual(await Q.selectCables(r, {item: 'i1'}, ctx), {ids: ['c1']});
  assert.deepEqual(await Q.selectCables(r, {item: 'i2', path: 'port-1'}, ctx), {ids: ['c1']});
  assert.deepEqual(await Q.selectCables(r, {item: 'i2', path: 'port-9'}, ctx), {ids: []});
  assert.deepEqual(await Q.selectCables(r, {purpose: 'uplink'}, ctx), {ids: ['c1']});
  const facts = {ends: new Map([['i1|front|port-1', {reason: 'the port is not on that device'}]])};
  assert.deepEqual(await Q.selectCables(r, {loose: true}, {...ctx, cableFacts: async () => facts}), {ids: ['c1']});
  // some ports not read: the ids found so far, and unchecked
  assert.deepEqual(await Q.selectCables(r, {loose: true}, {...ctx, cableFacts: async () => ({...facts, unchecked: true})}), {ids: ['c1'], unchecked: true});
  assert.ok((await Q.selectCables(r, {loose: true}, {chassisOf})).error, 'loose with no cable facts is refused');
  assert.ok((await Q.selectCables(r, {colour: 'x'}, ctx)).error);
});

test('describe: the totals line first, with a window or without; a bad window is {error}; the window is capped', () => {
  const r = placed().rack();
  assert.match(Q.describe(r, {chassisOf}, {offset: 0, limit: 40}).split('\n')[0], /^Rack 1 \(r1\): 2 items, 1 cable\. Items 1-2 shown\. Cables 1-1 shown\.$/);
  assert.match(Q.describe(r, {chassisOf}, {section: 'items', offset: 1, limit: 1}).split('\n')[0], /Items 2-2 shown\.$/);
  assert.match(Q.describe(r, {chassisOf}), /^Rack 1 \(r1\): 2 items, 1 cable\.\n42U four-post/);
  for (const win of [{section: 'racks'}, {offset: -1}, {offset: 1.5}, {limit: 0}])
    assert.equal(typeof Q.describe(r, {chassisOf}, win).error, 'string', JSON.stringify(win));
  assert.equal(Q.MAX_WINDOW, 50);
  const ed = createRackEditor({doc: M.newDoc(), chassisOf});
  ed.apply(Array.from({length: 42}, (_, i) => ({op: 'place', ref: 'as7726-32x', face: 'front', ru: i + 1})));
  assert.match(Q.describe(ed.rack(), {chassisOf}, {section: 'items', limit: 100}).split('\n')[0], /Items 1-42 shown/);
  const many = {...ed.rack(), items: Array.from({length: 60}, (_, k) => ({...ed.rack().items[0], id: `i${k + 1}`}))};
  assert.match(Q.describe(many, {chassisOf}, {section: 'items', limit: 100}).split('\n')[0], /Items 1-50 shown/);
});

test('catalog: by kind, and kind words in text', () => {
  assert.deepEqual(Q.catalog(SIZES, {kind: 'patch panel'}).map(e => e.ref), ['fhd-1ufce']);
  assert.deepEqual(Q.catalog(SIZES, {text: 'patch panel'}).map(e => e.ref), ['fhd-1ufce']);
  assert.equal(Q.catalog(SIZES, {kind: 'patch panel'})[0].kind, 'patch panel');   // find_devices prints it
});

test('the editor checks fit and field against a per-call ctx, and keeps none of it', async () => {
  const ed = placed();
  const bad = {op: 'fit', id: 'i1', path: 'port-1', ref: 'generic/sfp-lr@1'};
  assert.match(ed.preview([bad], {ctx}).error, /does not take generic\/sfp-lr@1/);
  assert.match(ed.apply([bad], {origin: 'agent', ctx}).error, /does not take/);
  assert.equal(ed.preview([bad]).error, undefined, 'without ctx a fit is unchecked: the ctx was not kept');
  assert.equal(ed.apply([{op: 'fit', id: 'i1', path: 'port-1', ref: 'generic/qsfp-lc@2'}], {origin: 'agent', ctx}).error, undefined);
  assert.equal(ed.rack().items[0].swaps['port-1'], 'generic/qsfp-lc@2');
  // field takes the path inspect lists under fields
  const latch = (await Q.inspect(ed.rack(), 'i1', ctx)).fields.find(f => f.key === 'latch-color');
  assert.ok(latch, 'inspect lists the optic\'s latch-color field');
  assert.equal(ed.apply([{op: 'field', id: 'i1', path: latch.path, key: 'latch-color', value: '#c22f2f'}], {origin: 'agent', ctx}).error, undefined);
  assert.match(ed.apply([{op: 'field', id: 'i1', path: latch.path, key: 'colour', value: 'x'}], {origin: 'agent', ctx}).error, /latch-color/);
  // re-point an end; the cable keeps its id
  assert.equal(ed.apply([{op: 'cable.update', id: 'c1', a: end('i1', 'port-2')}], {origin: 'agent', ctx}).error, undefined);
  assert.equal(ed.rack().cables[0].a.path, 'port-2');
});

test('loadSlots: a ref that fails to load is null, and the rest load', async () => {
  const had = {fetch: globalThis.fetch, location: globalThis.location};
  const files = {
    'http://test/as7726-32x.configs.json': {device: 'as7726-32x', bays: {front: [], rear: []}, cages: {front: [], rear: []},
                                            configs: [{name: 'ac-f2b', bays: {}, occupants: {}}], default: 'ac-f2b'},
    'http://test/components.json': {components: []},
  };
  globalThis.location = {href: 'http://test/rack.html'};
  globalThis.fetch = async url => (files[url] ? {ok: true, json: async () => files[url]} : {ok: false, status: 404});
  try {
    const {slotsOf: got} = await loadSlots(p => `http://test/${p}`, ['as7726-32x', 'nope']);
    assert.ok(got('as7726-32x'));
    assert.equal(got('nope'), null);
  } finally {
    globalThis.fetch = had.fetch;
    if (had.location === undefined) delete globalThis.location; else globalThis.location = had.location;
  }
});
