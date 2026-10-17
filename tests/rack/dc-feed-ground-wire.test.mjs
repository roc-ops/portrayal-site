// tests/rack/dc-feed-ground-wire.test.mjs
// A DC FEED AND A GROUND WIRE IN THE RACK BUILDER (portrayal-site#202, kit 0.30.0 on).
// power-cords.test.mjs holds an AC cord; these hold the other two kinds: a DC
// feed from a distribution panel's output to a device's DC terminal, and a
// ground wire from stud to stud. The rules are the kit's (cableLandsOn,
// settleEnd, mismatch); they hold the site to asking them with the real
// library, with each end of each kind saying what it is, a cord that does not
// fit said as a warning, and the page's own readers handed to the kit.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRackEditor} from '../../vendor/rack/editor.js';
import {newDoc} from '../../vendor/rack/model.js';
import {settleEnd, cableEndPaths} from '../../vendor/rack/ports.js';
import {mismatch, looseReason, proposeMedia, MEDIA, MEDIA_LABELS} from '../../vendor/rack/cable-rules.js';
import {kindLabel, KINDS, kindOfMedia, mediaOfKind} from '../../site/rack/cable-kinds.js';

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

// What the page's drawnAt answers: the ref the compiled faces carry at these paths.
const DRAWN = {'i1|rear|output-b8': 'amphenol-ns/output-p40@1', 'i2|rear|dc-1': 'common/dc-terminal-header-6@1',
               'i3|rear|ground-studs': 'juniper/mx-ground-stud-pair-3-4@1', 'i4|rear|ground-studs': 'juniper/mx-ground-stud-pair-3-4@1'};
const drawnAt = end => DRAWN[`${end.item}|${end.view}|${end.path}`] ?? null;
const ctx = {chassisOf, slotsOf, compByRef, drawnAt};

const rackWith = () => {
  const ed = createRackEditor({doc: newDoc(), chassisOf});
  const res = ed.apply([{op: 'place', ref: '300cb08-c', face: 'rear', ru: 10, as: 'p'},
                        {op: 'place', ref: 'gl-12xb-240d', face: 'rear', ru: 20, as: 'd'},
                        {op: 'place', ref: 'mx150', face: 'front', ru: 30, as: 'a'},
                        {op: 'place', ref: 'mx150', face: 'front', ru: 34, as: 'b'}], {origin: 'agent', ctx});
  assert.equal(res.error, undefined, res.error);
  return ed;
};
const out = {item: 'i1', path: 'output-b8', view: 'rear'};
const dc = {item: 'i2', path: 'dc-1', view: 'rear'};
const stud = id => ({item: id, path: 'ground-studs', view: 'rear'});
const facts = {item: true, drawing: true, port: false, cage: false, occupied: false, holder: null};
const infoOf = (rack, end) => settleEnd(rack, end, {facts, info: null, reason: looseReason(end, facts)}, ctx);

test('the kinds a power cabling form offers are a power cable, a DC feed and a ground wire, each over a media the kit has', () => {
  assert.deepEqual(KINDS.map(k => k.id), ['ac', 'dc', 'ground']);
  for (const k of KINDS) {
    assert.ok(MEDIA.includes(k.media), k.media);
    assert.ok(kindLabel(k.id).length > 3, k.id);
  }
  assert.equal(mediaOfKind('ac'), 'power');
  assert.equal(mediaOfKind('dc'), 'power');
  assert.equal(mediaOfKind('ground'), 'ground');
  assert.equal(kindLabel('dc'), 'DC feed');
  assert.equal(kindLabel('ground'), 'Ground wire');
  assert.match(MEDIA_LABELS.power, /Power/);
});

test('a kind is read back from the media and what the ends say: a power media on DC ends is a DC feed', () => {
  const rack = rackWith().rack();
  const a = infoOf(rack, out).info, b = infoOf(rack, dc).info;
  assert.equal(kindOfMedia('ground', a, b), 'ground');
  assert.equal(kindOfMedia('power', a, b), 'dc');
  assert.equal(kindOfMedia('power', {family: 'power', mode: 'ac'}, {family: 'power', mode: 'ac'}), 'ac');
  assert.equal(kindOfMedia('power', null, null), 'ac');
  assert.equal(kindOfMedia('cat6a', a, b), null);
  assert.equal(kindOfMedia('', null, null), null);
});

test('a DC terminal and a distribution output land, say they are DC power, and a feed between them is added with no warning', () => {
  const ed = rackWith();
  const rack = ed.rack();
  assert.ok(cableEndPaths(rack.items[1], 'rear', ctx).includes('dc-1'));
  const a = infoOf(rack, out), b = infoOf(rack, dc);
  assert.equal(a.reason, null, a.reason);
  assert.equal(b.reason, null, b.reason);
  assert.equal(a.info.family, 'power');
  assert.equal(b.info.family, 'power');
  assert.equal(b.info.mode, 'dc');
  assert.deepEqual(mismatch('power', a.info, b.info), []);
  const res = ed.apply({op: 'cable.add', a: out, b: dc, media: 'power', purpose: 'dc feed'}, {origin: 'agent', ctx});
  assert.equal(res.error, undefined, res.error);
  assert.equal(ed.rack().cables.length, 1);
});

test('an AC cord on a DC feed is a warning, never a refusal', () => {
  const rack = rackWith().rack();
  const ac = {family: 'power', mode: 'ac', role: 'inlet'};
  const said = mismatch('power', ac, infoOf(rack, dc).info).join(' ');
  assert.match(said, /AC power, B is DC power/);
});

test('a ground wire runs from stud to stud and lands, and a ground wire on a power end is a warning', () => {
  const ed = rackWith();
  const rack = ed.rack();
  const a = infoOf(rack, stud('i3')), b = infoOf(rack, stud('i4'));
  assert.equal(a.reason, null, a.reason);
  assert.equal(a.info.family, 'ground');
  assert.equal(proposeMedia(a.info, b.info), 'ground');
  assert.deepEqual(mismatch('ground', a.info, b.info), []);
  const res = ed.apply({op: 'cable.add', a: stud('i3'), b: stud('i4'), media: 'ground'}, {origin: 'agent', ctx});
  assert.equal(res.error, undefined, res.error);
  assert.match(mismatch('ground', a.info, infoOf(rack, dc).info).join(' '), /does not suit end B, which is power|The ends differ/);
});
