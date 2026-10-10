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
import {fitCorners, roundedCurve, clearCurve, kitRoute, insideOf, tightText, MAX_EXTEND_R} from '../../site/rack/bend3d.js';
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

test('the kit path is drawn through its own points: the arc out of a plug starts at the plug, along its axis (#166)', () => {
  // a duplex plug pair whose far ends are at z 47.6, the kit's next point 60 mm
  // to the right and 30 mm up: the tube starts at the pair's middle, runs out
  // along the normal and turns there with a 25 mm arc that starts AT the plug
  const A = {points: [V(-3, 0, 47.6), V(3, 0, 47.6)], normal: V(0, 0, 1)};
  const B = {points: [V(300, 0, 47.6)], normal: V(0, 0, 1)};
  const mid = [V(0, 0, 47.6), V(60, 30, 90), V(300, 30, 90), V(300, 0, 47.6)];   // reach a, two kit points, reach b
  const {pts, bent, extended_mm} = kitRoute(THREE, A, B, mid, 25, () => false);
  assert.ok(pts[0].distanceTo(V(0, 0, 47.6)) < 1e-9);                // the tube's first point is the reach point
  assert.ok(extended_mm[0] > 0 && extended_mm[0] <= MAX_EXTEND_R * 25);
  assert.ok(Math.abs(pts[1].z - (47.6 + extended_mm[0])) < 1e-9 && Math.hypot(pts[1].x, pts[1].y) < 1e-9);
  const first = bent.corners.find(c => c.at.distanceTo(pts[1]) < 1e-9);
  assert.ok(first && first.short_mm === 0 && Math.abs(first.t - extended_mm[0]) < 1e-3, JSON.stringify(first));
  // so the curve leaves the plug along its axis
  const t0 = bent.getTangent(0);
  assert.ok(t0.z > 0.999, JSON.stringify(t0));
  // every kit point between the reach points is on the polyline, as given
  for (const q of mid.slice(1, -1)) assert.ok(pts.some(p => p.distanceTo(q) < 1e-9));
});

test('kit points on one line are one leg, so a turn beside a ring has the run through it (#166)', () => {
  // a ring's approach, entry, exit and approach lie on its run, 6.5 + 6.8 + 6.5 mm;
  // the cable comes down to the first approach point and leaves level
  const A = {points: [V(0, 100, 30)], normal: V(0, 0, 1)}, B = {points: [V(300, 0, 30)], normal: V(0, 0, 1)};
  const ring = [V(0, 0, 60), V(6.5, 0, 60), V(13.3, 0, 60), V(19.8, 0, 60)];
  const {pts, bent} = kitRoute(THREE, A, B, [V(0, 100, 60), ...ring, V(300, 0, 60)], 25, () => false);
  assert.ok(!pts.some(p => p.distanceTo(ring[1]) < 1e-9 || p.distanceTo(ring[2]) < 1e-9));   // straight through: not corners
  const turn = bent.corners.find(c => c.at.distanceTo(ring[0]) < 1e-9);
  assert.ok(turn && turn.t > 6.5, JSON.stringify(turn));     // more than the 6.5 mm to the ring's face
});

test('a lead out of a plug is at most MAX_EXTEND_R radii; past that its corner is flagged (#166)', () => {
  // the kit's next point is nearly back behind the plug: no lead within the cap holds the turn
  const A = {points: [V(0, 0, 40)], normal: V(0, 0, 1)}, B = {points: [V(300, 0, 40)], normal: V(0, 0, 1)};
  const {bent, extended_mm} = kitRoute(THREE, A, B, [V(5, 0, 0), V(300, 0, 0)], 25, () => false);
  assert.ok(extended_mm[0] <= MAX_EXTEND_R * 25 + 1e-9, String(extended_mm));
  assert.ok(bent.corners.some(c => c.short_mm > 0));
});

test("a ring's part is met by the tube: its box grown by the radius keeps a rounded arc out of it (#166)", () => {
  // a part of a ring standing inside the corner where the cable comes down
  // and turns along x: clear of both straight legs, in the way of the arc
  const leg = new THREE.Box3(V(8, 9, 47), V(14, 14, 53));
  const grown = leg.clone().expandByScalar(1.5);
  const A = {points: [V(0, 120, 30)], normal: V(0, 0, 1)}, B = {points: [V(300, 0, 30)], normal: V(0, 0, 1)};
  const mid = [V(0, 120, 50), V(0, 6, 50), V(300, 6, 50)];
  const open = kitRoute(THREE, A, B, mid, 25, () => false).bent;
  const near = open.getSpacedPoints(4000).some(q => grown.containsPoint(q));
  assert.ok(near, 'the full-radius arc would pass over the leg');
  const kept = kitRoute(THREE, A, B, mid, 25, insideOf([{ref: 'i4', part: 'ring/guide-3/front-leg', box: grown}])).bent;
  assert.ok(!kept.getSpacedPoints(4000).some(q => grown.containsPoint(q) && q.x > grown.min.x + 0.05 && q.x < grown.max.x - 0.05
    && q.y > grown.min.y + 0.05 && q.y < grown.max.y - 0.05 && q.z > grown.min.z + 0.05 && q.z < grown.max.z - 0.05));
  const c = kept.corners.find(x => x.why === 'body');
  assert.ok(c && c.hitRef === 'i4', JSON.stringify(kept.corners));
});
