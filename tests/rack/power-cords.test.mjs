// tests/rack/power-cords.test.mjs
// A POWER CORD IN THE RACK BUILDER (portrayal-site#202, kit 0.30.0 and 0.31.0).
// The rules are the kit's (cableLandsOn, settleEnd, plugSeats, mismatch) and
// are tested there; these hold the site to asking them with the real library:
// a cord from a device's inlet to a PDU's outlet lands, the plug at each end is
// derived and never stored, a cord that does not fit is a warning, and the
// kit hears `drawnAt` from the page's own readers.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRackEditor} from '../../vendor/rack/editor.js';
import {newDoc} from '../../vendor/rack/model.js';
import {settleEnd, cableEndPaths} from '../../vendor/rack/ports.js';
import {plugSeats, mismatch, MEDIA, MEDIA_LABELS, mergeSeats, looseReason, endKey} from '../../vendor/rack/cable-rules.js';
import {agentContextFor} from '../../site/rack/agent-context.js';

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

// What the page's drawnAt answers, by the drawing: the part at a path. The two
// refs here are what the compiled faces carry at these paths.
const DRAWN = {'i1|rear|inlet': 'std/c14-inlet@1', 'i2|front|outlet-front-1': 'std/c13-outlet@1', 'i2|front|outlet-front-2': 'std/c13-outlet@1'};
const drawnAt = end => DRAWN[`${end.item}|${end.view}|${end.path}`] ?? null;
const ctx = {chassisOf, slotsOf, compByRef, drawnAt};

const rackWith = () => {
  const ed = createRackEditor({doc: newDoc(), chassisOf});
  const res = ed.apply([{op: 'place', ref: 'mx150', face: 'front', ru: 10, as: 'a'},
                        {op: 'place', ref: 'pdu12iec', face: 'front', ru: 20, as: 'p'}], {origin: 'agent', ctx});
  assert.equal(res.error, undefined, res.error);
  return ed;
};
const inlet = {item: 'i1', path: 'inlet', view: 'rear'};
const outlet = n => ({item: 'i2', path: `outlet-front-${n}`, view: 'front'});

test('the catalogue has the parts the demo rack uses', () => {
  assert.ok(chassisOf('mx150') && chassisOf('pdu12iec'));
  const pdu = slotsOf('pdu12iec');
  assert.ok(pdu.cages.front.some(c => c.id === 'outlet-front-1' && c.interface === 'iec-c13'));
  assert.ok(slotsOf('mx150').cages.rear.some(c => c.id === 'inlet' && c.interface === 'iec-c14'));
});

test('the cable form can offer power and ground, each with a label', () => {
  for (const m of ['power', 'ground']) {
    assert.ok(MEDIA.includes(m), m);
    assert.ok(MEDIA_LABELS[m], m);
  }
});

test('the kit lists the slots a cord lands on, on the panel the page draws', () => {
  const ed = rackWith();
  const [mx, pdu] = ed.rack().items;
  assert.deepEqual(cableEndPaths(mx, 'rear', ctx).sort(), ['ground-studs', 'inlet']);
  const front = cableEndPaths(pdu, 'front', ctx);
  assert.deepEqual(front, ['outlet-front-1', 'outlet-front-2', 'outlet-front-3', 'outlet-front-4']);
});

test('an inlet and an outlet land, say what they are, and a cord between them is added with no warning', () => {
  const ed = rackWith();
  const rack = ed.rack();
  const got = (end, facts) => settleEnd(rack, end, {facts, info: null, reason: looseReason(end, facts)}, ctx);
  const a = got(inlet, {item: true, drawing: true, port: false, cage: false, occupied: false, holder: null});
  const b = got(outlet(1), {item: true, drawing: true, port: false, cage: false, occupied: false, holder: null});
  assert.equal(a.reason, null, a.reason);
  assert.equal(b.reason, null, b.reason);
  assert.equal(a.info.family, 'power');
  assert.equal(a.info.role, 'inlet');
  assert.equal(b.info.role, 'outlet');
  assert.match(a.info.connector, /C14 inlet/);
  assert.match(b.info.connector, /C13 outlet/);
  assert.deepEqual(mismatch('power', a.info, b.info), []);
  const res = ed.apply({op: 'cable.add', a: inlet, b: outlet(1), media: 'power', purpose: 'power'}, {origin: 'agent', ctx});
  assert.equal(res.error, undefined, res.error);
  assert.equal(ed.rack().cables.length, 1);
});

test('the plug at each end is derived from its slot: a C13 in the inlet, a C14 in the outlet', () => {
  const ed = rackWith();
  const [mx, pdu] = ed.rack().items;
  const faceSlots = (item, view) => slotsOf(item.ref).cages[view];
  const into = plugSeats('inlet', faceSlots(mx, 'rear'), {}, {cls: 'inlet', compByRef});
  const out = plugSeats('outlet-front-1', faceSlots(pdu, 'front'), {}, {cls: 'inlet', compByRef});
  assert.deepEqual(Object.keys(into), ['inlet']);
  assert.equal(compByRef(into.inlet).class, 'port');
  assert.match(into.inlet, /c13-plug/);
  assert.deepEqual(Object.keys(out), ['outlet-front-1']);
  assert.match(out['outlet-front-1'], /c14-plug/);
  // never stored: the item's swaps are as they were, the seats are laid over them
  assert.deepEqual(pdu.swaps ?? {}, {});
  assert.deepEqual(mergeSeats({'outlet-front-1': 'x/own@1'}, out), {'outlet-front-1': 'x/own@1'});
});

test('outlet to outlet is a warning, said once the page has handed in drawnAt', () => {
  const ed = rackWith();
  const rack = ed.rack();
  const facts = {item: true, drawing: true, port: false, cage: false, occupied: false, holder: null};
  const info = end => settleEnd(rack, end, {facts, info: null, reason: looseReason(end, facts)}, ctx).info;
  const said = mismatch('power', info(outlet(1)), info(outlet(2)));
  assert.ok(said.some(s => /Both ends are outlets/.test(s)), said.join(' | '));
  // without drawnAt the kit guesses nothing, so nothing is said: the page must supply it
  const bare = end => settleEnd(rack, end, {facts, info: null, reason: looseReason(end, facts)}, {...ctx, drawnAt: undefined}).info;
  assert.deepEqual(mismatch('power', bare(outlet(1)), bare(outlet(2))), []);
});

test('a data cable on a power end is a warning, and a power cord on a data port too', () => {
  const ed = rackWith();
  const rack = ed.rack();
  const facts = {item: true, drawing: true, port: false, cage: false, occupied: false, holder: null};
  const a = settleEnd(rack, inlet, {facts, info: null, reason: null}, ctx).info;
  assert.match(mismatch('cat6a', a, null).join(' '), /does not suit end A, which is power/);
});

test('the agent context carries the page\'s drawnAt to the kit', async () => {
  const make = agentContextFor({loadSlots: async () => ({slotsOf, compByRef}), chassisOf, cableFacts: async () => ({ends: new Map()}), drawnAt});
  const c = await make(rackWith().rack());
  assert.equal(c.drawnAt, drawnAt);
  const without = await agentContextFor({loadSlots: async () => ({slotsOf, compByRef}), chassisOf, cableFacts: async () => ({ends: new Map()})})(rackWith().rack());
  assert.ok(!('drawnAt' in without));
});

test('endKey names a slot end by its path', () => {
  assert.equal(endKey(inlet), 'i1|rear|inlet');
});
