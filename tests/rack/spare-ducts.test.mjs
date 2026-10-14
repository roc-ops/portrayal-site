// tests/rack/spare-ducts.test.mjs
// SPARE IN A FINGER DUCT, AND A PART BESIDE THE RACK IN A ROUTE (kit 0.35.0,
// Portrayal #1065). The kit stores a cable's spare in a duct its route uses
// and says where each stored loop is (slack.js spareMarks); the page draws a
// loop there (spare-loops.js), says it in the agent's text (agent-text.js),
// and offers a part beside the rack's duct and windows as route pick targets.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {cableText, inspectText, zeroUText, pathwaysLine} from '../../site/rack/agent-text.js';
import {spareLoops, loopPane, loopRadii, loopTitle, zeroUTargets} from '../../site/rack/spare-loops.js';
import {spareMarks} from '../../vendor/rack/slack.js';
import * as R from '../../vendor/rack/route.js';
import {RU} from '../../vendor/rack/rails.js';

const devices = JSON.parse(readFileSync(new URL('../../assets/dist/rack.json', import.meta.url), 'utf8')).devices;
const SW = {ru: 1, w: 440, h: 44, d: 300};
const chassisOf = ref => (ref === 'sw' ? SW : devices[ref] ?? null);
const item = (id, ref, ru, extra = {}) => ({id, ref, cfg: 'base', label: id.toUpperCase(), ru, face: 'front', turned: false, swaps: {}, fields: {}, ...extra});
const end = i => ({item: i, path: 'p1', view: 'front'});
const LEN = {value: 3, unit: 'm', source: 'entered'};
const cable = (id, route, extra = {}) => ({id, a: end('i1'), b: end('i2'), media: 'cat6', purpose: '', label: '', route, routeEdited: true, length: LEN, ...extra});
const DUCT = {item: 'hm', via: 'duct'}, VDUCT = {item: 'z1', via: 'duct'};
const DOWN = [{lane: 'right-front', ru: 30}, {lane: 'right-front', ru: 26}];
const rackOf = cables => ({id: 'r1', name: 'r', frame: {kind: 'four-post', heightRU: 45, numbering: 'bottom-up', railDepth: 740},
  items: [item('i1', 'sw', 30), item('i2', 'sw', 26), item('hm', 'cmh-bs-sfds1u', 28), item('rear', 'cmh-bs-sfds1u', 20, {face: 'rear'})],
  zeroU: [{id: 'z1', ref: 'cmv-sfd42u9w', cfg: 'base', label: 'VCM', at: 'right-front', offsetMm: 0}], cables});
const GUIDES = {hm: [{via: 'duct', kind: 'duct', face: 'front', x: 0, run: 'x'}], rear: [{via: 'duct', kind: 'duct', face: 'rear', x: 0, run: 'x'}]};
const ctx = {chassisOf, guidesOf: id => GUIDES[id] ?? [], portX: () => -100, portY: () => null};

// ── the loops a drawing puts where spare is stored ───────────────────────

test('a loop is drawn at the kit\'s point for each duct a cable stores spare in, and none for spare at an end', () => {
  const r = rackOf([cable('c1', [DUCT], {slack: [DUCT]}), cable('c2', DOWN, {slack: [VDUCT]}),
                    cable('c3', DOWN, {slack: [{end: 'a'}]}), cable('c4', DOWN)]);
  const loops = spareLoops(r, ctx);
  assert.deepEqual(loops.map(l => l.cable), ['c1', 'c2']);
  // each is the kit's own mark, with the cable it is of
  for (const l of loops) {
    const [k] = spareMarks(r, r.cables.find(c => c.id === l.cable), ctx);
    assert.deepEqual({...l, cable: undefined}, {...k, cable: undefined});
  }
  // a horizontal manager's duct runs across the rack; a vertical's beside it runs up
  assert.equal(loops[0].run, 'x');
  assert.equal(loops[1].run, 'y');
  // the vertical's loop is at the middle of the cable's run in it (U26-U30)
  assert.deepEqual(loops[1].at, R.pointOf(r, {lane: 'right-front', ru: 28}, ctx));
  // without the routes nothing is drawn
  assert.deepEqual(spareLoops(r, null), []);
});

test('a loop the kit refuses is not drawn: a ring holds no spare', () => {
  const RING = {via: 'guide-1', kind: 'ring', face: 'front', x: 0, run: 'x', aperture: {w: 30, h: 30}};
  const c = {...ctx, guidesOf: id => (id === 'hm' ? [RING] : [])};
  const r = rackOf([cable('c1', [{item: 'hm', via: 'guide-1'}], {slack: [{item: 'hm', via: 'guide-1'}]})]);
  assert.deepEqual(spareLoops(r, c), []);
});

test('a loop is drawn on the pane of the face it is stored at, and lies along its duct', () => {
  const r = rackOf([cable('c1', [DUCT], {slack: [DUCT]})]);
  const front = spareLoops(r, ctx)[0];
  assert.equal(loopPane(front, r.frame), 'front');
  assert.equal(loopPane({...front, at: {...front.at, z: -700}}, r.frame), 'rear');
  // long along its run, on a front or rear pane (x, y) and on a side pane (z, y); end on, round
  const [a, b] = loopRadii('x', ['x', 'y']);
  assert.ok(a > b);
  const [c2, d2] = loopRadii('y', ['x', 'y']);
  assert.ok(d2 > c2);
  const [e, f] = loopRadii('x', ['z', 'y']);
  assert.equal(e, f);
  assert.equal(loopTitle({...front, metres: 1.537}, id => (id === 'hm' ? 'CMH-BS-SFDS1U' : id)), 'c1: 1.54 m spare, a loop in CMH-BS-SFDS1U duct');
});

// ── a part beside the rack, picked in the route editor ───────────────────

test('a vertical manager offers its duct, and each window at the height the kit has it, as pick targets', () => {
  const r = rackOf([]);
  const box = {x: 500, y: 100, w: 89, h: 1867};
  const ts = zeroUTargets(r, {chassisOf}, r.zeroU[0], box);
  assert.deepEqual(ts.map(t => t.via), ['duct', 'pass-through-1', 'pass-through-2', 'pass-through-3', 'pass-through-4', 'pass-through-5', 'pass-through-6']);
  assert.ok(ts.every(t => t.item === 'z1'));
  // the duct is the whole part, under the windows
  assert.deepEqual(ts[0].box, box);
  // a window spans the heights of its hole in the back plate, in the pane's y (down from the top of the rack)
  const top = r.frame.heightRU * RU;
  const w2 = ts.find(t => t.via === 'pass-through-2').box;
  assert.ok(Math.abs(w2.y - (top - 1418.8)) < 0.5, `top of window 2 at ${w2.y}`);
  assert.ok(Math.abs(w2.h - 146.4) < 0.5, `window 2 is ${w2.h} high`);
  assert.equal(w2.x, box.x);
  // a part with no pathway offers none
  assert.deepEqual(zeroUTargets(r, {chassisOf: () => null}, r.zeroU[0], box), []);
});

test('a route through the vertical\'s duct resolves to its lane run, and its text says the duct', () => {
  const r = rackOf([cable('c1', [VDUCT])]);
  const ws = R.resolveRoute(r, r.cables[0], ctx).waypoints;
  assert.ok(ws.length && ws.every(w => w.lane === 'right-front'));
  assert.equal(R.routeText(ws, id => id, r.frame, R.ductsThrough(r, chassisOf, id => (id === 'z1' ? 'VCM' : id))), 'right-front U30-U26, through VCM duct');
});

// ── the agent's text ─────────────────────────────────────────────────────

const base = {kind: 'cable', id: 'c15', a: {item: 'i1', path: 'p1', view: 'front'}, b: {item: 'i2', path: 'p1', view: 'front'}, media: 'cat6',
  length: {value: 3, unit: 'm', source: 'entered', need: 1.2}, routed: {metres: 1.3, stock: 2}, route: {edited: true, text: 'CMH-BS-SFDS1U duct'}};
const slack = stored => ({metres: 1.74, at_ends_m: 0.2, said: true, stored, unplaced_m: 0});

test('cableText says a loop in a duct, how full the duct is with it, and that the loop is drawn', () => {
  const t = cableText({...base, slack: slack([{item: 'hm', via: 'duct', form: 'loop', metres: 1.54, ok: true, kind: 'duct',
    load: {stated: true, compared: true, count: 5, capacity: 48, media: 'cat6', over: false}}])});
  assert.match(t, /1\.54 m as a loop in hm duct \(a duct holding 5 cat6 cables' worth of the 48 its maker states\)/);
  assert.match(t, /the stored loop is drawn/);
  assert.doesNotMatch(t, /listed, not drawn/);
  const none = cableText({...base, slack: slack([{item: 'z1', via: 'duct', form: 'loop', metres: 1.54, ok: true, kind: 'duct', load: {stated: false}}])});
  assert.match(none, /1\.54 m as a loop in z1 duct \(a duct whose maker states no cable capacity\)/);
  // spare at an end only, or a place it cannot be stored, is listed and not drawn
  assert.match(cableText({...base, slack: slack([{end: 'a', metres: 1.54}])}), /spare is listed, not drawn/);
  assert.match(cableText({...base, slack: slack([{item: 'hm', via: 'guide-1', form: 'coil', metres: 1.54, ok: false, why: 'x'}])}), /spare is listed, not drawn/);
});

test('cableText says where its spare can go, and the duct findings by kind', () => {
  const t = cableText({...base, slack: slack([]),
    spare_places: [{item: 'hm', via: 'duct', kind: 'duct'}, {item: 'z1', via: 'duct', kind: 'duct'}, {item: 'lacer', via: 'tray-1', kind: 'tray'}],
    spare_findings: [{kind: 'spare-capacity-unstated', text: 'VCM states no cable capacity, so the spare stored in it is not counted.'},
                     {kind: 'spare-over-capacity', text: 'hm holds 50 cat6 cables\' worth with the spare stored in it, past the 48 its maker states.'},
                     {kind: 'spare-unplaced', text: 'c15 has 1 m not placed.'}]});
  assert.match(t, /Spare can go in: hm duct, z1 duct, lacer tray-1, or at an end \(\{end: a\} or \{end: b\}\)\./);
  assert.match(t, /Spare, capacity not stated: VCM states no cable capacity/);
  assert.match(t, /Spare, over capacity: hm holds 50/);
  assert.match(t, /Spare: c15 has 1 m not placed\./);
  // a route with nowhere to store spare says so
  assert.match(cableText({...base, slack: slack([]), spare_places: []}), /Spare can go only at an end \(\{end: a\} or \{end: b\}\)\./);
  // a kit that gives no places says nothing of them
  assert.doesNotMatch(cableText({...base, slack: slack([])}), /Spare can go/);
});

test('an item and a part beside the rack say their pathways, and which hold spare', () => {
  const ways = [{via: 'duct', kind: 'duct', holds_spare: true}, {via: 'pass-through-1', kind: 'pass', holds_spare: false},
                {via: 'pass-through-2', kind: 'pass', holds_spare: false}, {via: 'guide-1', kind: 'ring', holds_spare: false},
                {via: 'odd', kind: null, holds_spare: false}];
  assert.equal(pathwaysLine(ways),
    'Pathways: duct duct (holds spare); ring guide-1 (holds no spare); pass-through pass-through-1, pass-through-2 (holds no spare); of no known kind odd (holds no spare).');
  assert.equal(pathwaysLine([]), null);
  const it = {kind: 'item', id: 'hm', ref: 'cmh-bs-sfds1u', cfg: 'base', ru: 28, face: 'front', pathways: ways.slice(0, 2)};
  assert.match(inspectText(it), /\nPathways: duct duct \(holds spare\); pass-through pass-through-1 \(holds no spare\)\./);
  const z = {kind: 'zeroU', id: 'z1', ref: 'cmv-sfd42u9w', at: 'right-front', ru: 1, u: 42, lane: 'right-front', pathways: ways.slice(0, 3)};
  assert.match(zeroUText(z), /\nPathways: duct duct \(holds spare\); pass-through pass-through-1, pass-through-2 \(holds no spare\)\./);
  assert.doesNotMatch(zeroUText({...z, pathways: undefined}), /Pathways/);
});
