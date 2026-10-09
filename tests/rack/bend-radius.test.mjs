// tests/rack/bend-radius.test.mjs
// portrayal-site#164: a bundle an agent makes is checked for its bend with
// the cable types' radii, and every 3D corner is rounded to the cable's
// installed bend radius, or flagged where its legs cannot hold one.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from '../../vendor/three/three.module.js';
import * as M from '../../vendor/rack/model.js';
import * as Q from '../../vendor/rack/queries.js';
import {createRackEditor} from '../../vendor/rack/editor.js';
import {bendLookup, diameterLookup} from '../../vendor/rack/cable-types.js';
import {rackTools} from '../../site/rack/agent-tools.js';
import {agentContextFor} from '../../site/rack/agent-context.js';
import {fitCorners, roundedCurve, clearCurve, roundRoute, insideOf, tightText, MAX_EXTEND_R} from '../../site/rack/bend3d.js';
import {SIZES, chassisOf, slotsOf, compByRef} from './fixtures/kit-slots.mjs';

// The cable types as the page loads them (cable-types.js loadCableTypes),
// read from the vendored dist instead of fetched.
const TABLE = JSON.parse(readFileSync(new URL('../../assets/dist/cable-types.json', import.meta.url)));
const TYPES = {types: TABLE.types, bendOf: bendLookup(TABLE.types), diameterOf: diameterLookup(TABLE.types)};
const text = r => r.content[0].text;

// The page's agent context (agent-context.js), with its readers handed in:
// the parts lists, a routing context with no guides (lanes only), and the
// cable types.
function agentSetup({types = TYPES} = {}) {
  const ed = createRackEditor({doc: M.newDoc(), chassisOf});
  const route = {chassisOf, guidesOf: () => [], portX: () => -100, portY: () => null};
  const context = agentContextFor({
    loadSlots: async () => ({slotsOf, compByRef}), chassisOf, cableFacts: async () => ({ends: new Map()}),
    routeFacts: async () => ({ctx: route}), cableTypes: async () => types});
  const queries = {
    describe: (r, win, ctx = {}) => Q.describe(r, {...ctx, chassisOf}, win), catalog: f => Q.catalog(SIZES, f),
    fitsAt: (r, s) => Q.fitsAt(r, s, {chassisOf}), freeUs: (r, s) => Q.freeUs(r, s, {chassisOf}),
    freePorts: (r, id) => Q.freePorts(r, id, {portsOf: async () => []}),
    looseEnds: r => Q.looseEnds(r, {cableFacts: async () => ({ends: new Map()})}),
    inspect: (r, id, ctx) => Q.inspect(r, id, ctx), selectCables: (r, sel, ctx) => Q.selectCables(r, sel, ctx),
  };
  const tools = Object.fromEntries(rackTools({ed, chassisOf, queries, runExport: async () => ({}), context}).map(t => [t.name, t]));
  return {ed, run: (name, args = {}) => tools[name].execute(args)};
}

const OM4_BUNDLE = [
  {op: 'place', ref: 'as7726-32x', face: 'front', ru: 40, as: 'a'},
  {op: 'place', ref: 'as7726-32x', face: 'front', ru: 36, as: 'b'},
  {op: 'cable.add', a: {item: '@a', path: 'port-1', view: 'front'}, b: {item: '@b', path: 'port-1', view: 'front'}, media: 'om4'},
  {op: 'cable.add', a: {item: '@a', path: 'port-2', view: 'front'}, b: {item: '@b', path: 'port-2', view: 'front'}, media: 'om4'},
  {op: 'cable.add', a: {item: '@a', path: 'port-3', view: 'front'}, b: {item: '@b', path: 'port-3', view: 'front'}, media: 'om4'}];

test('an agent-created bundle of OM4 cords reports a checked bend radius, not "unchecked" (#164)', async () => {
  const {ed, run} = agentSetup();
  assert.equal(text(await run('edit_rack', {commands: OM4_BUNDLE})).includes('refused'), false);
  const made = text(await run('edit_rack', {commands: [{op: 'bundle.create', cables: ['c1', 'c2', 'c3'],
    route: [{lane: 'left-front', ru: 36}, {lane: 'left-front', ru: 40}]}]}));
  assert.equal(M.bundlesOf(ed.rack()).length, 1, made);
  // OM4's installed radius, as the vendored cable types give it
  const want = TYPES.bendOf({media: 'om4'});
  assert.equal(want, 25);
  for (const said of [made, text(await run('inspect', {id: 'b1'})), text(await run('describe_rack'))]) {
    assert.doesNotMatch(said, /cable types are not loaded/, said);
    assert.doesNotMatch(said, /not checked for c1/, said);
  }
  const b = text(await run('inspect', {id: 'b1'}));
  assert.match(b, new RegExp(`\\nbend: radius ${want} mm, set by c1`), b);
});

test('without the cable types the bundle says so, and is never read as a pass', async () => {
  const {run} = agentSetup({types: null});
  await run('edit_rack', {commands: OM4_BUNDLE});
  const made = text(await run('edit_rack', {commands: [{op: 'bundle.create', cables: ['c1', 'c2']}]}));
  assert.match(made, /bend is not checked: the cable types are not loaded/);
  assert.match(text(await run('inspect', {id: 'b1'})), /\nbend: no radius known/);
});

// ── the 3D corners ──
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const circumradius = (a, b, c) => {
  const s = b.clone().sub(a).cross(c.clone().sub(a)).length();
  return s < 1e-9 ? Infinity : a.distanceTo(b) * b.distanceTo(c) * c.distanceTo(a) / (2 * s);
};
const minRadius = curve => {
  const P = curve.getSpacedPoints(Math.ceil(curve.getLength() / 0.25));
  let m = Infinity;
  for (let k = 1; k < P.length - 1; k++) m = Math.min(m, circumradius(P[k - 1], P[k], P[k + 1]));
  return m;
};

test('a right angle with room is an arc of exactly the radius, and the path is shorter by R(2 - pi/2)', () => {
  const pts = [V(0, 0, 0), V(0, 0, 100), V(100, 0, 100)];
  const c = roundedCurve(THREE, pts, 25);
  assert.deepEqual(c.corners.map(x => [x.k, x.drawn_mm, x.short_mm]), [[1, 25, 0]]);
  assert.ok(Math.abs(minRadius(c) - 25) < 0.05, `sampled ${minRadius(c)}`);
  assert.ok(Math.abs((c.polyline - c.getLength()) - 25 * (2 - Math.PI / 2)) < 1e-6);
  // it starts and ends where the polyline does, and passes its corner's inside
  assert.ok(c.getPoint(0).distanceTo(pts[0]) < 1e-9 && c.getPoint(1).distanceTo(pts[2]) < 1e-9);
  assert.ok(c.getPoint(0.5).distanceTo(pts[1]) > 5);
});

test('two corners share the leg between them; one that cannot fit is drawn as tight as it can and flagged', () => {
  // a 30 mm leg between two right angles: 25 + 25 do not fit, each gets 15
  const pts = [V(0, 0, 0), V(0, 0, 100), V(0, 30, 100), V(0, 30, 0)];
  const c = roundedCurve(THREE, pts, 25);
  assert.deepEqual(c.corners.map(x => [x.drawn_mm, x.short_mm]), [[15, 10], [15, 10]]);
  assert.ok(Math.abs(minRadius(c) - 15) < 0.05);
  assert.equal(tightText('c1 in 3D', 'c1 (om4)', 'at U41', c.corners[0]),
    'c1 in 3D turns at U41 with room for a 15 mm bend; c1 (om4) needs 25 mm, 10 mm short.');
  // a neighbour that needs little leaves the rest of the leg to the other
  // (a 40 mm leg, a right angle and a 10 degree turn: 25 + 2.2 fit)
  const f = fitCorners([V(0, 0, 0), V(0, 0, 100), V(0, 40, 100), V(0, 240, 100 + 200 * Math.tan(Math.PI / 18))], 25);
  assert.deepEqual(f.corners.map(x => x.short_mm), [0, 0]);
});

test('a doubling back has no room, and an unknown radius rounds and checks nothing', () => {
  const back = fitCorners([V(0, 0, 0), V(0, 0, 50), V(0, 0, 10)], 25);
  assert.deepEqual(back.corners.map(x => [x.drawn_mm, x.short_mm]), [[0, 25]]);
  assert.equal(tightText('c2 in 3D', 'c2 (om4)', 'at U3', back.corners[0]), 'c2 in 3D doubles back at U3, with no room for a bend; c2 (om4) needs 25 mm.');
  const none = roundedCurve(THREE, [V(0, 0, 0), V(0, 0, 100), V(100, 0, 100)], null);
  assert.deepEqual(none.corners.map(x => [x.drawn_mm, x.short_mm]), [[null, 0]]);
  assert.equal(none.getLength(), 200);
});

test('a corner round a body is drawn tighter, not through it, and flagged', () => {
  // round the corner of a box at x < 0, z < 0, 2 mm off its faces
  const box = new THREE.Box3(V(-100, -10, -100), V(-2, 10, -2));
  const inside = q => box.containsPoint(q) && q.x < -2.05 && q.z < -2.05;
  const pts = [V(-100, 0, 0), V(0, 0, 0), V(0, 0, -100)];
  assert.ok(roundedCurve(THREE, pts, 25).getSpacedPoints(400).some(inside));   // the full radius cuts the box
  const c = clearCurve(THREE, pts, 25, inside);
  assert.equal(c.getSpacedPoints(400).some(inside), false);
  assert.ok(c.corners[0].short_mm > 0 && c.corners[0].drawn_mm < 25);
  // with nothing in the way it is the full radius
  assert.equal(clearCurve(THREE, pts, 25, () => false).corners[0].short_mm, 0);
});

test('a lead from a plug recessed in its own device is not flagged: only the arc is checked (#164 review B1)', () => {
  // the device's envelope is z < 0; the plug sits 10 mm inside it, the lead
  // runs 50 mm straight out, then turns along x with a long leg
  const device = [{box: new THREE.Box3(V(-200, -20, -400), V(200, 20, 0))}];
  const inside = insideOf(device);
  const pts = [V(0, 0, -10), V(0, 0, 40), V(200, 0, 40)];
  assert.ok(inside(pts[0]));                                  // the lead does start inside
  const c = clearCurve(THREE, pts, 25, inside);
  assert.deepEqual(c.corners.map(x => [x.drawn_mm, x.short_mm, x.why]), [[25, 0, null]]);
  // an arc that does meet the body is still drawn tighter and says where
  const low = clearCurve(THREE, [V(0, 0, -10), V(0, 0, 100), V(0, 300, 100)], 25, insideOf([{box: new THREE.Box3(V(-50, 3, 60), V(50, 50, 97))}]));
  assert.equal(low.corners[0].why, 'body');
  assert.ok(low.corners[0].hit && low.corners[0].short_mm > 0);
});

test('a ring too thin for the turn is drawn as one corner through its centre (thin-ring rule)', () => {
  // a ring 7 mm deep along x at (0, 0, 60): the cable rises to it from a
  // port just below and 10 mm to its left, then runs on along x, so passing it
  // face to face leaves a few mm of leg either side of its near face
  const A = {points: [V(-10, -60, 20)], normal: V(0, 0, 1)}, B = {points: [V(300, 0, 20)], normal: V(0, 0, 1)};
  const ring = {run: 'x', depth: 7, sense: 1};
  const w = [V(0, 0, 60)];
  const kept = roundRoute(THREE, A, B, w, [ring], 25, 30, () => false, {thin: false}).bent;
  assert.ok(kept.corners.some(c => c.short_mm > 0));
  const {pts, bent} = roundRoute(THREE, A, B, w, [ring], 25, 30, () => false);
  // the ring's two faces are gone: its centre is one corner of the path
  assert.ok(pts.some(q => q.distanceTo(w[0]) < 1e-9));
  assert.ok(!pts.some(q => Math.abs(Math.abs(q.x) - 3.5) < 1e-9 && q.z === 60));
  // and that corner is rounder than the face-to-face drawing could be
  const at = c => c.drawn_mm;
  assert.ok(Math.min(...bent.corners.map(at)) > Math.min(...kept.corners.map(at)));
  // a ring the route doubles back at is left as the kit decided it
  const back = roundRoute(THREE, A, B, w, [{...ring, back: true}], 25, 30, () => false);
  assert.ok(!back.pts.some(q => q.distanceTo(w[0]) < 1e-9));
});

test('a lead whose turn would start inside its own device is drawn longer, not flagged', () => {
  // the envelope reaches 11 mm past the face; the plug is 6 mm behind it and
  // the lead 44 mm long, so a 25 mm bend through 120 degrees (43 mm of leg)
  // would start inside the device
  const device = [{ref: 'i1', part: 'envelope', box: new THREE.Box3(V(-200, -20, -400), V(200, 20, 11))}];
  const A = {points: [V(0, 0, -6)], normal: V(0, 0, 1), reach: 44, item: 'i1'}, B = {points: [V(300, -300, -6)], normal: V(0, 0, 1), item: 'i9'};
  const w = [V(120, -5, 20)];
  // without the lengthening the turn is drawn tighter and flagged for the body
  const short = clearCurve(THREE, [A.points[0], V(0, 0, 38), ...w, V(300, -300, 34), B.points[0]], 25, insideOf(device));
  assert.equal(short.corners[0].why, 'body');
  assert.equal(short.corners[0].hitRef, 'i1');
  const {pts, bent, extended_mm} = roundRoute(THREE, A, B, w, null, 25, 30, insideOf(device));
  const lead = bent.corners.find(c => c.at.distanceTo(pts[1]) < 1e-6);
  assert.ok(lead && lead.short_mm === 0 && lead.why === null, JSON.stringify(lead));
  assert.ok(pts[1].z > -6 + 44);                                   // drawn further out
  assert.ok(extended_mm[0] > 0 && extended_mm[0] <= MAX_EXTEND_R * 25 && extended_mm[1] === 0, String(extended_mm));
  assert.ok(Math.abs(pts[1].z - (-6 + 44 + extended_mm[0])) < 1e-6);
  // only the straight run out of the plug is inside the device
  assert.ok(bent.getSpacedPoints(2000).filter(insideOf(device)).every(q => Math.hypot(q.x, q.y) < 1e-6));
});

test('a tray in front of the port still flags: the lead is not pushed through another body (#164 round 2)', () => {
  // the same lead and turn, with a tray's floor (item i4) just below the turn,
  // where the arc would pass: the lead stays as long as it was, and the
  // corner is flagged for the tray
  const bodies = [{ref: 'i1', part: 'envelope', box: new THREE.Box3(V(-200, -20, -400), V(200, 20, 11))},
                  {ref: 'i4', part: 'tray/floor', box: new THREE.Box3(V(2, -20, 14), V(200, 20, 30))}];
  const A = {points: [V(0, 0, -6)], normal: V(0, 0, 1), reach: 44, item: 'i1'}, B = {points: [V(300, -300, -6)], normal: V(0, 0, 1), item: 'i9'};
  const {pts, bent, extended_mm} = roundRoute(THREE, A, B, [V(120, -5, 34)], null, 25, 30, insideOf(bodies));
  const lead = bent.corners.find(c => c.at.distanceTo(pts[1]) < 1e-6);
  assert.equal(lead.why, 'body');
  assert.equal(lead.hitRef, 'i4');
  assert.ok(lead.short_mm > 0);
  assert.equal(extended_mm[0], 0);
  assert.ok(Math.abs(pts[1].z - 38) < 1e-6);
});

test('a lead is drawn at most MAX_EXTEND_R radii longer; past that its corner is flagged', () => {
  // a narrow device whose envelope reaches 200 mm past the plug, the turn
  // beside it: no lead within the cap clears it
  const deep = [{ref: 'i1', part: 'envelope', box: new THREE.Box3(V(-30, -20, -400), V(30, 20, 200))}];
  const A = {points: [V(0, 0, -6)], normal: V(0, 0, 1), reach: 44, item: 'i1'}, B = {points: [V(300, -300, 300)], normal: V(0, 0, -1), item: 'i9'};
  const {bent, extended_mm} = roundRoute(THREE, A, B, [V(120, -5, 60)], null, 25, 30, insideOf(deep));
  assert.ok(extended_mm[0] <= MAX_EXTEND_R * 25 + 1e-9, String(extended_mm));
  assert.ok(bent.corners.some(c => c.short_mm > 0));
});
