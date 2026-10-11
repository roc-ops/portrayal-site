// ROOM FOR THE BENDS ON THE SITE (Portrayal #973, kit 0.17.0). The kit lays a
// path with room for its cable's bend radius and says what it found no room
// for (route.js routePath `bends`, bendFindings). The site measures no bend:
// it says the kit's sentences (route-context.js bendNotice), finds which
// stops of a route a finding lies between so a pane can ring it (bendStops),
// and hands the panes the kit's lead points beside the ring each stands at
// (leadStops). The end allowance is the kit's as well (0.16.0, #962): the
// names the site once read are gone, and a length is the path plus the
// path's own `allowance`.
import test from 'node:test';
import assert from 'node:assert/strict';
import {leadStops, bendStops, bendNotice} from '../../site/rack/route-context.js';
import * as R from '../../vendor/rack/route.js';

// The lacer of cable-lay.test.mjs: a tray floor 100 mm deep on a panel at U41,
// a switch below at U40, one ring. A cord from the switch to the panel through
// the ring goes out round the tray's front edge and back in to the ring.
const CMP = {ru: 1, w: 483, h: 44, d: 110, mount: 'rack-face', shell: 'sheet', guides: {front: ['guide-3']},
  solids: [{part: 'tray/floor', box: {x: 17.3, y: 1.5, z: 0, w: 448.4, h: 1.5, d: 100}}]};
const SIZES = {sw: {ru: 1, w: 438, h: 43.5, d: 536}, panel: {ru: 1, w: 448, h: 44, d: 432.8}, cmp: CMP};
const chassisOf = ref => SIZES[ref] ?? null;
const RING = {via: 'guide-3', kind: 'ring', face: 'front', run: 'x', depth: 6.8, x: 0, aperture: {w: 32, h: 29.5}};
const item = (id, ref, ru, extra = {}) => ({id, ref, cfg: 'base', label: id.toUpperCase(), ru, face: 'front', turned: false,
  swaps: {}, fields: {}, ...extra});
const rack = cables => ({id: 'r1', name: 'lay', frame: {kind: 'four-post', heightRU: 42, numbering: 'bottom-up', railDepth: 740},
  items: [item('sw', 'sw', 40), item('pp', 'panel', 41), item('cm', 'cmp', 41, {on: 'pp', unit: 1})], zeroU: [], cables});
const ctxOf = (extra = {}) => ({chassisOf, guidesOf: id => (id === 'cm' ? [RING] : []),
  portX: end => ({'sw|p1': -40, 'pp|lc1': 40})[`${end.item}|${end.path}`] ?? null, ...extra});
const cord = (media = 'om4') => ({id: 'c1', a: {item: 'sw', path: 'p1', view: 'front'}, b: {item: 'pp', path: 'lc1', view: 'front'},
  media, purpose: 'uplink', label: '', route: [{item: 'cm', via: 'guide-3'}], routeEdited: true});
const WS = [{item: 'cm', via: 'guide-3'}];

test('the end allowance is the kit\'s: the old names are gone, and a length is the path plus its own allowance', () => {
  assert.equal(R.END_ALLOWANCE_M, undefined);
  assert.equal(R.END_ALLOWANCE, undefined);
  assert.equal(typeof R.endAllowance, 'function');
  assert.equal(typeof R.END_ALLOWANCE_BY_MEDIA, 'object');
  const r = rack([cord('om4'), {...cord('aoc'), id: 'c2'}]);
  const ctx = ctxOf();
  for (const c of r.cables) {
    const p = R.routePath(r, c, ctx);
    // what a length adds an end is the path's, by its cable's media
    assert.equal(p.allowance, R.endAllowance(c));
    assert.ok(p.allowance > R.END_ALLOWANCE_BY_MEDIA[c.media], 'the table, plus the dressing allowance');
    const run = p.points.reduce((m, q, i) => (i ? m + Math.hypot(q.x - p.points[i - 1].x, q.y - p.points[i - 1].y, q.z - p.points[i - 1].z) : 0), 0);
    assert.ok(Math.abs(R.pathLength(p).measured - (run / 1000 + 2 * p.allowance)) < 1e-9);
  }
  // and it differs by media: an LC cord's is not an AOC's
  assert.notEqual(R.endAllowance(r.cables[0]), R.endAllowance(r.cables[1]));
});

test('the bend notice is the kit\'s sentences, the first three and how many more', () => {
  const r = rack([cord('aoc')]);
  const found = R.bendFindings(r, ctxOf(), id => id.toUpperCase());
  // NOT VACUOUS: this fixture has tight bends, each in the kit's own words
  assert.ok(found.length > 3, `the fixture gives ${found.length} findings`);
  for (const f of found) {
    assert.equal(f.kind, 'tight-bend');
    assert.match(f.text, /^c1 (turns [\d.]+ degrees|doubles back) .+ the cable \(aoc\) needs 30 mm/);
    assert.equal(f.at.length, 3);
  }
  assert.equal(bendNotice(found), `${found.slice(0, 3).map(f => f.text).join(' ')} And ${found.length - 3} more.`);
  assert.equal(bendNotice(found.slice(0, 2)), `${found[0].text} ${found[1].text}`);
  assert.equal(bendNotice(found.slice(0, 3)), found.slice(0, 3).map(f => f.text).join(' '));
  assert.equal(bendNotice([]), '');
  assert.equal(bendNotice(null), '');
});

test('each cable is judged by its own bend radius: bendOf in the context is what a finding needs', () => {
  const r = rack([cord('om4')]);
  const own = R.bendFindings(r, ctxOf());
  assert.ok(own.length > 0 && own.every(f => f.need_mm === 25), 'OM4 by its media, 25 mm');
  // the cable types' lookup, as route-context.js gives it: this cord's type needs 40 mm
  const typed = R.bendFindings(r, ctxOf({bendOf: c => (c.id === 'c1' ? 40 : null)}));
  assert.ok(typed.length > 0 && typed.every(f => f.need_mm === 40));
  assert.ok(typed.every(f => /needs 40 mm/.test(f.text)));
});

test('bendStops finds the stops a finding lies between: end a is -1, end b is past the last waypoint', () => {
  const r = rack([cord('aoc')]);
  const found = R.bendFindings(r, ctxOf());
  const stops = found.map(f => bendStops(WS, f));
  // every finding of this route is placed, some before the ring and some after it
  assert.ok(stops.every(s => Array.isArray(s) && s.length === 2));
  assert.ok(stops.some(s => s[0] === -1 && s[1] === 0), 'between the a port and the ring');
  assert.ok(stops.some(s => s[0] === 0 && s[1] === 1), 'between the ring and the b port');
  // by hand: each kind of stop, a ring visited twice taken in turn, and a stop the route lacks
  const ws = [{item: 'cm', via: 'guide-3'}, {lane: 'left-front', ru: 30}, {item: 'cm', via: 'guide-3'}];
  const between = (a, b) => bendStops(ws, {between: [a, b]});
  assert.deepEqual(between({end: 'a'}, {end: 'a'}), [-1, -1]);
  assert.deepEqual(between({end: 'a'}, {item: 'cm', via: 'guide-3'}), [-1, 0]);
  assert.deepEqual(between({lane: 'left-front', ru: 30}, {item: 'cm', via: 'guide-3'}), [1, 2]);
  assert.deepEqual(between({item: 'cm', via: 'guide-3'}, {end: 'b'}), [0, 3]);
  assert.deepEqual(between({end: 'b'}, {end: 'b'}), [3, 3]);
  assert.equal(between({item: 'gone', via: 'x'}, {end: 'b'}), null);
  assert.equal(between({end: 'a'}, {item: 'gone', via: 'x'}), null);
  assert.equal(bendStops(ws, {}), null);
});

test('leadStops hands a pane each ring\'s lead points, before the ring or after it, and never a plug\'s', () => {
  const pt = (at, x, y, z, extra = {}) => ({x, y, z, at, ...extra});
  const ring = {item: 'i4', via: 'guide-3'};
  // the reference rack's c1, as kit 0.18.0 lays it: led square onto ring 3's run from behind its approach point
  const c1 = [pt('a', 138.8, 1849.6, 0), pt('reach', 138.8, 1849.6, 32.5, {end: 'a'}), pt('lead', 138.8, 1849.6, 32.5, ring),
    pt('approach', 138.8, 1788.1, 73.7, ring), pt('entry', 110.4, 1788.1, 73.7, ring), pt('exit', 103.6, 1788.1, 73.7, ring),
    pt('approach', 73.6, 1788.1, 73.7, ring), pt('rest', 60, 1790, 40), pt('reach', 44, 1800.2, 13.7, {end: 'b'}), pt('b', 44, 1800.2, 0)];
  assert.deepEqual(leadStops([ring], c1), [{at: 0, before: true, points: [{x: 138.8, y: 1849.6, z: 32.5}]}]);
  // a lead on the way out is after the ring's own points
  const out = [...c1.slice(0, 2), ...c1.slice(3, 7), pt('lead', 73.6, 1820, 73.7, ring), ...c1.slice(7)];
  assert.deepEqual(leadStops([ring], out), [{at: 0, before: false, points: [{x: 73.6, y: 1820, z: 73.7}]}]);
  // a run-out straight out of a plug (`end`, no ring) is along z: not a pane's to draw
  const run = [c1[0], c1[1], pt('lead', 138.8, 1849.6, 62.5, {end: 'a'}), ...c1.slice(3)];
  assert.deepEqual(leadStops([ring], run), []);
  // two rings in turn, each with its own; and the same ring passed twice is matched in order
  const other = {item: 'i4', via: 'guide-5'};
  const two = [c1[0], c1[1], pt('lead', 1, 2, 3, ring), pt('approach', 0, 0, 0, ring), pt('entry', 0, 0, 0, ring), pt('exit', 0, 0, 0, ring),
    pt('approach', 0, 0, 0, ring), pt('lane', 9, 9, 9), pt('lead', 4, 5, 6, other), pt('approach', 0, 0, 0, other),
    pt('entry', 0, 0, 0, other), pt('exit', 0, 0, 0, other), pt('approach', 0, 0, 0, other), pt('lead', 7, 8, 9, other), c1.at(-1)];
  assert.deepEqual(leadStops([ring, {lane: 'left-front', ru: 30}, other], two),
    [{at: 0, before: true, points: [{x: 1, y: 2, z: 3}]}, {at: 2, before: true, points: [{x: 4, y: 5, z: 6}]},
     {at: 2, before: false, points: [{x: 7, y: 8, z: 9}]}]);
  const twice = [pt('lead', 1, 1, 1, ring), pt('entry', 0, 0, 0, ring), pt('exit', 0, 0, 0, ring), pt('lane', 9, 9, 9),
    pt('entry', 0, 0, 0, ring), pt('exit', 0, 0, 0, ring), pt('lead', 2, 2, 2, ring)];
  assert.deepEqual(leadStops([ring, {lane: 'left-front', ru: 30}, ring], twice).map(l => [l.at, l.before]), [[0, true], [2, false]]);
  // a ring the route does not name, and no points at all
  assert.deepEqual(leadStops([other], c1), []);
  assert.deepEqual(leadStops([ring], undefined), []);
});
