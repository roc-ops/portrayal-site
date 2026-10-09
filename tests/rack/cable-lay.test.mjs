// CABLE LAY STEP 2 ON THE SITE (Portrayal #949, kit 0.11.0 and 0.12.0): the
// detours the kit adds round a solid body, put after the waypoint each one
// follows so both drawings can go round it (route-context.js detourStops);
// the crosses-body findings in the notes beside the ring findings
// (routeNotes); the agent's cable text naming what a route still crosses
// (agent-text.js cableText); and a ring that holds a cord reaching just into
// it past its port, which the drawings pass as any ring (ringMarks).
import test from 'node:test';
import assert from 'node:assert/strict';
import {detourStops, routeNotes} from '../../site/rack/route-context.js';
import {cableText} from '../../site/rack/agent-text.js';
import {routePath, ringMarks, ringFindings, bodyFindings} from '../../vendor/rack/route.js';
import {routed2d} from '../../vendor/rack/route-path.js';
import {RU} from '../../vendor/rack/rails.js';

// A lacer of the FHD-CMP5DR's shape (its tray floor only, as rack.json derives
// it: 1.5 mm thick, 1.5 mm up from the bottom of its unit), on a panel at
// U41, with a switch below at U40. The floor is drawn 100 mm deep from the
// outward face, not the real 61.2, so a straight leg from the port below to
// the ring must cross it.
const CMP = {ru: 1, w: 483, h: 44, d: 110, mount: 'rack-face', shell: 'sheet', guides: {front: ['guide-3']},
  solids: [{part: 'tray/floor', box: {x: 17.3, y: 1.5, z: 0, w: 448.4, h: 1.5, d: 100}}]};
const SIZES = {sw: {ru: 1, w: 438, h: 43.5, d: 536}, panel: {ru: 1, w: 448, h: 44, d: 432.8}, cmp: CMP};
const chassisOf = ref => SIZES[ref] ?? null;
const RING = {via: 'guide-3', kind: 'ring', face: 'front', run: 'x', depth: 6.8, x: 0, aperture: {w: 32, h: 29.5}};
const item = (id, ref, ru, extra = {}) => ({id, ref, cfg: 'base', label: id.toUpperCase(), ru, face: 'front', turned: false,
  swaps: {}, fields: {}, ...extra});
const rack = cables => ({id: 'r1', name: 'lay', frame: {kind: 'four-post', heightRU: 42, numbering: 'bottom-up', railDepth: 740},
  items: [item('sw', 'sw', 40), item('pp', 'panel', 41), item('cm', 'cmp', 41, {on: 'pp', unit: 1})], zeroU: [], cables});
const ctx = {chassisOf, guidesOf: id => (id === 'cm' ? [RING] : []),
  portX: end => ({'sw|p1': -40, 'pp|lc1': 40})[`${end.item}|${end.path}`] ?? null};
const cord = (id, route) => ({id, a: {item: 'sw', path: 'p1', view: 'front'}, b: {item: 'pp', path: 'lc1', view: 'front'},
  media: 'om4', purpose: 'uplink', label: '', route, routeEdited: true});

test('detourStops puts each detour after the waypoint its leg starts from, end a as -1', () => {
  const ws = [{item: 'cm', via: 'guide-3'}, {lane: 'left-front', ru: 30}, {item: 'cm', via: 'guide-3'}];
  const p = (x, y, z) => ({x, y, z});
  const got = detourStops(ws, [
    {between: [{end: 'a'}, {item: 'cm', via: 'guide-3'}], points: [p(1, 2, 3)]},
    {between: [{lane: 'left-front', ru: 30}, {item: 'cm', via: 'guide-3'}], points: [p(4, 5, 6), p(7, 8, 9)]},
    // the second visit to the same ring: after the lane, never back at the first
    {between: [{item: 'cm', via: 'guide-3'}, {end: 'b'}], points: [p(0, 0, 0)]},
    // a stop that is not among the waypoints: dropped, never put at a guess
    {between: [{item: 'gone', via: 'x'}, {end: 'b'}], points: [p(9, 9, 9)]}]);
  assert.deepEqual(got.map(d => [d.after, d.points.length]), [[-1, 1], [1, 2], [2, 1]]);
  assert.deepEqual(detourStops(ws, undefined), []);
});

test('a cord from the switch below to a ring on the lacer goes over the front edge of the tray, and the drawings get the detour', () => {
  const r = rack([cord('c1', [{item: 'cm', via: 'guide-3'}])]);
  const path = routePath(r, r.cables[0], ctx);
  // the kit took it round: no crossing left, and detour points out past the tray's front edge (z 110 + radius + 5)
  assert.deepEqual(path.crossings, []);
  assert.ok(path.detours.length > 0, 'the leg up through the tray floor has a detour');
  assert.ok(path.detours.flatMap(d => d.points).every(q => q.z > 110), 'every detour point is in front of the tray');
  const stops = detourStops([{item: 'cm', via: 'guide-3'}], path.detours);
  assert.deepEqual(stops.map(d => d.after), [-1], 'the detour is between the port and the ring');
  assert.deepEqual(bodyFindings(r, ctx), []);
});

test('the crosses-body findings are in the notes after the ring findings, and the schedule can leave them to its rows', () => {
  const r = rack([]);
  const facts = {ctx: null, fill: [], over: [], routes: new Map(), ringFindings: [{text: 'ring finding'}],
    bodyFindings: [{kind: 'crosses-body', cable: 'c9', text: 'c9 passes through CM tray between x and y: route it.'}]};
  assert.deepEqual(routeNotes(r, facts).slice(-2), ['ring finding', 'c9 passes through CM tray between x and y: route it.']);
  // the cable schedule writes each into its own row, so its file notes leave them out
  assert.deepEqual(routeNotes(r, facts, id => id, {bodies: false}).slice(-1), ['ring finding']);
});

test('cableText names each body a route still crosses, between which stops and where', () => {
  const base = {id: 'c7', a: {item: 'i1', path: 'p1'}, b: {item: 'i2', path: 'p2'}, media: 'om4', loose: [], mismatch: []};
  const text = cableText({...base, route: {edited: true, text: 'i4 guide-3', crosses: [
    {item: 'i4', part: 'tray/floor', between: [{end: 'a'}, {item: 'i4', via: 'guide-3'}], at: [10, 1780.4, 60]},
    {item: 'i9', part: 'envelope', between: [{lane: 'left-front', ru: 12}, {end: 'b'}], at: [-250, 520, 0]}]}});
  assert.match(text, /\nCrosses a body: i4 \(tray\/floor\) between its a end and i4 guide-3, entering at 10, 1780\.4, 60 mm\./);
  assert.match(text, /\nCrosses a body: i9 between left-front U12 and its b end, entering at -250, 520, 0 mm\./);
  assert.doesNotMatch(cableText({...base, route: {edited: false, text: ''}}), /Crosses a body/);
});

test('a ring just past a port holds the cord (held: true), and its mark is a pass the drawing goes through', () => {
  // A patch between two panel ports on the ring's left, level with it: the
  // cord would enter and leave the ring by one face. With the nearer port 12
  // mm from the ring's centre it only reaches in to be held (kit 0.12.0); 30
  // mm off it would be a hook-back and a finding.
  const patch = {...cord('c1', [{item: 'cm', via: 'guide-3'}]), a: {item: 'pp', path: 'lc0', view: 'front'}};
  const r = rack([patch]);
  const at = x => ({...ctx, portX: end => ({'pp|lc0': x, 'pp|lc1': -40})[`${end.item}|${end.path}`] ?? null});
  const path = routePath(r, patch, at(-12));
  assert.deepEqual(path.rings.map(g => [g.passed, g.held === true]), [[true, true]]);
  assert.deepEqual(ringFindings(r, at(-12)), []);
  // the contrast: further off, the same cord hooks back and is found
  assert.deepEqual(routePath(r, patch, at(-30)).rings.map(g => g.passed), [false]);
  assert.equal(ringFindings(r, at(-30)).length, 1);
  // a held ring's mark is a pass like any other, with its sense
  const [mark] = ringMarks(r, patch, at(-12));
  assert.equal(mark.back, false);
  assert.ok(mark.sense === 1 || mark.sense === -1);
  // drawn with that mark, the line goes through both faces of the ring
  const y = 100;
  const d = routed2d([[-12, y], [0, y], [-40, y]], 4, [null, mark, null]);
  const xs = (d.match(/-?\d*\.?\d+/g) || []).map(Number).filter((_, i) => i % 2 === 0);
  assert.ok(Math.min(...xs) <= -3.4 + 1e-6 && Math.max(...xs) >= 3.4 - 1e-6, `the line passes both faces: ${d}`);
});
