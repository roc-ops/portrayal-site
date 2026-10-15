// tests/rack/zero-u-cords.test.mjs
// A POWER CORD TO A VERTICAL PDU BESIDE THE RACK (kit 0.36.0, Portrayal #1068).
// The kit resolves an end on a zero-U part's own slot, measures it, pairs its
// plug and lists its free outlets, and tests all of that itself; these hold
// the site to handing it what it needs: the parts list of every part beside
// the rack in the route context, the settled facts for the plug at an outlet,
// and the agent's free-port text for a PDU and for a device's power ends.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRackEditor} from '../../vendor/rack/editor.js';
import * as M from '../../vendor/rack/model.js';
import * as Q from '../../vendor/rack/queries.js';
import {routePath, pathLength} from '../../vendor/rack/route.js';
import {cableEndPaths} from '../../vendor/rack/ports.js';
import {endKey} from '../../vendor/rack/cable-rules.js';
import {slotRefsOf} from '../../site/rack/route-context.js';
import {zeroUFacts} from '../../site/rack/cable-plugs.js';
import {rackTools} from '../../site/rack/agent-tools.js';
import {freeLine} from '../../site/rack/agent-text.js';

const dist = f => JSON.parse(readFileSync(new URL(`../../assets/dist/${f}`, import.meta.url)));
const devices = dist('rack.json').devices;
const comps = new Map(dist('components.json').components.map(c => [`${c.ns}/${c.name}@${String(c.major).replace(/^v/, '')}`, c]));
const slots = new Map();
const slotsOf = ref => {
  if (!slots.has(ref)) {
    const j = dist(`${ref}.configs.json`);
    slots.set(ref, {bays: j.bays || {}, cages: j.cages || {}, configs: j.configs || [], default: j.default ?? null, 'pdu-class': j['pdu-class'] ?? null});
  }
  return slots.get(ref);
};
const compByRef = ref => (ref == null ? null : comps.get(String(ref).split(':')[0]) ?? null);
const chassisOf = ref => devices[ref] ?? null;
const ctx = {chassisOf, slotsOf, compByRef};

const PDU = 'evma8365x', SWITCH = 's9700-53dx', CONSOLE = 'ds1000';
// A 42U four-post with a PDU at each rear upright, a 2U switch at U35 and a 1U console at U42.
const rackWith = (cables = []) => {
  const doc = M.newDoc({kind: 'four-post'});
  const ed = createRackEditor({doc: {...doc, racks: [M.withFrame(doc.racks[0], {heightRU: 42})]}, chassisOf});
  const res = ed.apply([{op: 'place', ref: SWITCH, face: 'front', ru: 35, as: 'sw'},
                        {op: 'place', ref: CONSOLE, face: 'front', ru: 42, as: 'con'},
                        {op: 'zerou.place', ref: PDU, at: 'left-rear', ru: 1, as: 'pa'},
                        {op: 'zerou.place', ref: PDU, at: 'right-rear', ru: 1, as: 'pb'},
                        {op: 'zerou.update', id: '@pa', label: 'PDU-A'},
                        {op: 'zerou.update', id: '@pb', label: 'PDU-B'},
                        ...cables], {origin: 'agent', ctx});
  assert.equal(res.error, undefined, res.error);
  return ed;
};
const inlet = (item, psu) => ({item, path: `psu-${psu}/module/inlet`, view: 'rear'});
const outlet = (item, path) => ({item, path, view: 'front'});

test('the catalogue has the PDU and the devices the cords are drawn for', () => {
  assert.ok(chassisOf(PDU) && chassisOf(SWITCH) && chassisOf(CONSOLE));
  assert.deepEqual(cableEndPaths({ref: SWITCH, cfg: chassisOf(SWITCH).default}, 'rear', ctx), ['psu-0/module/inlet', 'psu-1/module/inlet']);
  // the PDU's outlets are the pick targets on its front, as the panes ask for them (face.js `ends`)
  const ends = cableEndPaths({id: 'z1', ref: PDU, cfg: 'base'}, 'front', ctx);
  assert.ok(ends.includes('outlet-a1') && ends.includes('outlet-e34') && ends.includes('outlet-f42'), ends.join(' '));
});

test('the route context loads the parts list of every part beside the rack', () => {
  const ed = rackWith();
  assert.deepEqual(slotRefsOf(ed.rack()), [PDU]);
  assert.deepEqual(slotRefsOf({...ed.rack(), zeroU: undefined}), []);
});

test('a cord to a PDU outlet has a length only with the parts lists in the route context', () => {
  const ed = rackWith([{op: 'cable.add', a: inlet('i1', 0), b: outlet('z1', 'outlet-e34'), media: 'power'}]);
  const r = ed.rack(), c = r.cables[0];
  const page = {chassisOf, guidesOf: () => [], portX: () => -150, portY: () => 35 * 44.45 - 20};
  assert.equal(pathLength(routePath(r, c, page)), null);
  const got = pathLength(routePath(r, c, {...page, slotsOf, compByRef}));
  assert.ok(got?.measured > 0.2 && got.measured < 3, JSON.stringify(got));
  // its last point is the outlet, on the PDU at the left-rear upright
  const end = routePath(r, c, {...page, slotsOf, compByRef}).points.at(-1);
  assert.equal(end.at, 'b');
  assert.ok(end.x < -225, JSON.stringify(end));
});

// What the page read off the device's panel for its inlet (cable-plugs.js readEnd and settleEnd): a C20 inlet takes a C19.
const pageSaid = (key, plug) => new Map([[key, {facts: {item: true, drawing: true, port: false, slot: true}, reason: null,
  info: {family: 'power', connector: 'C20 inlet', plug}}]]);

test('the plug at a C39 outlet pairs with the cord\'s other end, and is seated on the PDU', () => {
  const ed = rackWith([{op: 'cable.add', a: inlet('i1', 0), b: outlet('z1', 'outlet-e34'), media: 'power'},
                       {op: 'cable.add', a: inlet('i2', 1), b: outlet('z2', 'outlet-f42'), media: 'power'}]);
  const r = ed.rack();
  const ends = pageSaid(endKey(inlet('i1', 0)), 'generic/c19-plug@1');
  const got = zeroUFacts(r, ends, ctx);
  const e34 = got.ends.get(endKey(outlet('z1', 'outlet-e34')));
  assert.equal(e34.reason, null);
  assert.equal(e34.info.connector, 'C39 outlet');
  assert.equal(e34.info.plug, 'generic/c20-plug@1');
  // a C13 outlet takes a C14, whatever is at the far end
  assert.equal(got.ends.get(endKey(outlet('z2', 'outlet-f42'))).info.plug, 'generic/c14-plug@1');
  assert.deepEqual(got.seats, {z1: {'outlet-e34': 'generic/c20-plug@1'}, z2: {'outlet-f42': 'generic/c14-plug@1'}});
  // nothing the page said of a device end is changed
  assert.equal(got.ends.has(endKey(inlet('i1', 0))), false);
  // a plug is derived, never stored
  assert.deepEqual(r.zeroU.map(z => z.swaps ?? null), [null, null]);
});

test('an end on a PDU outlet the catalogue cannot answer is not checked, and never called loose', () => {
  const ed = rackWith([{op: 'cable.add', a: inlet('i1', 0), b: outlet('z1', 'outlet-e34'), media: 'power'}]);
  const got = zeroUFacts(ed.rack(), new Map(), {chassisOf});
  assert.equal(got.ends.size, 0);
  assert.deepEqual(got.seats, {});
  // and a path the PDU does not have is loose, with the slots it has
  const bad = {...ed.rack(), cables: [{...ed.rack().cables[0], b: outlet('z1', 'zzz')}]};
  assert.match(zeroUFacts(bad, new Map(), ctx).ends.get(endKey(outlet('z1', 'zzz'))).reason, /has no zzz; it has .*C39 outlet-a2/);
});

test('a cord picked for the new-cable form is answered too, and seats no plug', () => {
  const ed = rackWith();
  const got = zeroUFacts(ed.rack(), new Map(), ctx, [inlet('i1', 0), outlet('z1', 'outlet-a1')]);
  assert.equal(got.ends.get(endKey(outlet('z1', 'outlet-a1'))).info.connector, 'C13 outlet');
  assert.deepEqual(got.seats, {});
});

test('a free outlet is said with its type, its label, its unit, its connector and its plug', () => {
  assert.equal(freeLine({path: 'outlet-a2', view: 'front', label: 'A2', kind: 'power', type: 'C39', u: 3, connector: 'C39 outlet', plug: 'generic/c14-plug@1'}),
    'outlet-a2, front: C39 outlet A2 at U3, plug generic/c14-plug@1');
  assert.equal(freeLine({path: 'psu-0/module/inlet', view: 'rear', kind: 'power', connector: 'C20 inlet', plug: 'generic/c19-plug@1'}),
    'psu-0/module/inlet, rear: power, C20 inlet, plug generic/c19-plug@1');
  assert.equal(freeLine({path: 'port-1..2', view: 'front', speed: '100G', media: 'qsfp28', cage: 'cage, empty'}), 'port-1..2, front: 100G qsfp28 cage, empty');
});

// The page's tools over the real catalogue, with the page's per-call context.
const toolsFor = ed => {
  const queries = {freePorts: (r, id, c, o) => Q.freePorts(r, id, {...c, portsOf: async () => []}, o),
                   inspect: (r, id, c) => Q.inspect(r, id, c)};
  const context = async () => ({chassisOf, slotsOf, compByRef, cableFacts: async () => ({ends: new Map(), seats: {}})});
  const tools = Object.fromEntries(rackTools({ed, chassisOf, queries, runExport: async () => ({}), context}).map(t => [t.name, t]));
  return (name, args) => tools[name].execute(args).then(r => ({error: !!r.isError, text: r.content[0].text}));
};

test('list_free_ports: the free outlets of a PDU beside the rack, by type and near a unit', async () => {
  const ed = rackWith([{op: 'cable.add', a: inlet('i1', 0), b: outlet('z1', 'outlet-e34'), media: 'power'}]);
  const run = toolsFor(ed);
  const all = await run('list_free_ports', {id: 'z1'});
  assert.equal(all.error, false, all.text);
  assert.match(all.text, /^z1 \(PDU-A\): \d+ free ports/);
  assert.match(all.text, /\noutlet-a1, front: C13 outlet A1 at U\d+, plug generic\/c14-plug@1\n/);
  assert.doesNotMatch(all.text, /outlet-e34,/);
  const near = await run('list_free_ports', {id: 'z1', kinds: ['power'], type: 'C39', near: 35});
  const lines = near.text.split('\n');
  assert.match(lines[0], /^z1 \(PDU-A\): \d+ free ports front and rear, in \d+ runs\.$/);
  assert.match(lines[1], /^outlet-e32, front: C39 outlet E32 at U3[45], plug /);
  assert.ok(lines.slice(1).every(l => / C39 outlet /.test(l)), near.text);
  // a device's power ends are listed by the catalogue, with what each is
  const dev = await run('list_free_ports', {id: 'i1', kinds: ['power']});
  assert.match(dev.text, /\npsu-1\/module\/inlet, rear: power, C\d+ inlet, plug generic\/c\d+-plug@1/);
  // what the kit refuses is said
  const bad = await run('list_free_ports', {id: 'z1', type: 'C39', near: 99});
  assert.equal(bad.error, true);
  assert.match(bad.text, /no U99/);
});

test('edit_rack: cable.add to an outlet the PDU does not have is refused with the slots it has', async () => {
  const ed = rackWith();
  const ok = await toolsFor(ed)('edit_rack', {commands: [{op: 'cable.add', a: inlet('i1', 0), b: outlet('z1', 'outlet-e34'), media: 'power'}]});
  assert.equal(ok.error, false, ok.text);
  assert.equal(ed.rack().cables.length, 1);
  const no = await toolsFor(ed)('edit_rack', {commands: [{op: 'cable.add', a: inlet('i1', 1), b: outlet('z1', 'zzz'), media: 'power'}]});
  assert.equal(no.error, true);
  assert.match(no.text, /has no zzz/);
});
