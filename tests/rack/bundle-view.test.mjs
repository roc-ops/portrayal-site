import test from 'node:test';
import assert from 'node:assert/strict';
import {memberStretch, trunkLay, trunkMarks, strapAt, alongLine, trunkSpanPoints, drawableRuns, bendLine, bendViolations, packOffset, drawnDiameter,
        trunkIndexOf, bundleSummary, bundleFacts, sheetBundleNotes, peelText} from '../../site/rack/bundle-view.js';

import {elementsOf} from '../../vendor/rack/bundle-route.js';
import {newRack} from '../../vendor/rack/model.js';

const ring = (via) => ({item: 'i2', via});
const lane = (ru) => ({lane: 'left-front', ru});

test('memberStretch spans the join to the leave waypoint of a member route', () => {
  const route = {bundle: 'b1', waypoints: [ring('guide-1'), lane(20), lane(25), lane(30)], join: ring('guide-1'), leave: lane(25)};
  assert.deepEqual(memberStretch(route, null), [0, 2]);
  assert.equal(memberStretch({waypoints: [lane(20)]}, null), null, 'a cable in no bundle has no stretch');
});

test('memberStretch falls back to the stored trunk when the join is not a waypoint of its own', () => {
  const bundle = {id: 'b1', members: [], route: [ring('guide-1'), lane(20), lane(30)]};
  const route = {bundle: 'b1', waypoints: [ring('guide-1'), lane(20), lane(30), ring('guide-9')], join: lane(22), leave: lane(30)};
  assert.deepEqual(memberStretch(route, bundle), [0, 2]);
});

// THE LAY OF A BUNDLE (trunkLay). A lane up the left of the rack, U31 to U36:
// `far` rides all of it, `mid` joins at U33 and `near` at U35, each from a
// port on the rack's side of the lane (x greater), and all leave at the top.
const LANE_X = -271.425;
const laidFact = (members, trunk = [lane(31), lane(36)], diameter = 11.6) => ({id: 'b1', drawn: true, diameter,
  members: members.map(m => m.cable), check: {layout: {trunk, T: elementsOf(trunk), members}}});
const laidPaths = spec => new Map(Object.entries(spec).map(([id, [ay, by]]) => [id, {points: [
  {x: 100, y: ay, z: 0, at: 'a'}, {x: 100, y: by, z: 0, at: 'b'}]}]));
const laidRack = {...newRack({name: 'lay'}), cables: ['far', 'mid', 'near'].map(id => ({id, media: 'cat6'}))};
const laidCtx = {chassisOf: () => null, guidesOf: () => []};
const peel = () => {
  const T = elementsOf([lane(31), lane(36)]), at = u => T.findIndex(e => e.kind === 'n' && e.u === u);
  const members = [{cable: 'far', ji: at(31), li: at(36)}, {cable: 'mid', ji: at(33), li: at(36)}, {cable: 'near', ji: at(35), li: at(36)}];
  const lay = trunkLay(laidRack, laidFact(members), {paths: laidPaths({far: [1350, 1600], mid: [1440, 1600], near: [1530, 1600]}), ctx: laidCtx, width: 3});
  return {lay, at};
};

test('trunkLay: the member that leaves the others first sits on the side it leaves toward', () => {
  const {lay, at} = peel();
  // the lane runs up, so "across" is toward the left (x less); the ports are to the right
  assert.deepEqual(lay.across(at(33)), {x: -1, y: 0});
  assert.deepEqual(lay.order, ['near', 'mid', 'far'], 'the last to join is nearest the rack, the first furthest out');
  const x = (id, u) => lay.offset(id, at(u)).x;
  assert.ok(x('near', 35) > x('mid', 35) && x('mid', 35) > x('far', 35));
  // each runs straight: one offset at every unit it rides
  for (const [id, from] of [['far', 31], ['mid', 33], ['near', 35]])
    for (let u = from; u <= 36; u++) assert.equal(x(id, u), x(id, 36), `${id} at U${u}`);
  // side by side, a drawn width apart at most, inside the largest diameter
  assert.equal(lay.pitch, 3);
  assert.ok(x('near', 36) - x('far', 36) + 3 <= lay.diameter + 1e-9);
  assert.equal(lay.offset('near', at(33)), null, 'a member has no place where it does not ride');
});

test('trunkLay: each stretch is as thick as the members that ride it, by the kit\'s rule', () => {
  const {lay, at} = peel();
  const tenth = v => Math.round(v * 10) / 10, two = tenth(Math.sqrt(2 * 36 / 0.8)), three = tenth(Math.sqrt(3 * 36 / 0.8));
  const by = Object.fromEntries(lay.stretches.map(s => [`${lay.T[s.from].u}-${lay.T[s.to].u}`, s]));
  assert.deepEqual(Object.keys(by), ['33-34', '34-35', '35-36'], 'no envelope where one cable rides alone');
  assert.ok(Math.abs(by['33-34'].diameter - two) < 1e-9 && Math.abs(by['35-36'].diameter - three) < 1e-9);
  assert.deepEqual(by['33-34'].members, ['mid', 'far']);
  // the envelope is about its own members' middle
  const mid = s => (lay.offset(s.members[0], s.from).x + lay.offset(s.members.at(-1), s.from).x) / 2;
  for (const s of lay.stretches) assert.ok(Math.abs(s.c0.x - mid(s)) < 1e-9);
  assert.equal(lay.at(at(31)).diameter, 6, 'one cable: its own diameter, never under two drawn widths');
  // a strap is on the stretch its place along the trunk falls in
  const hit = lay.stretchAt({segment: 0, t: 0.9});
  assert.equal(`${lay.T[hit.stretch.from].u}-${lay.T[hit.stretch.to].u}`, '35-36');
  assert.ok(Math.abs(hit.f - 0.5) < 1e-9);
  assert.equal(lay.stretchAt({segment: 0, t: 0.1}), null);
});

test('trunkLay: where a member between two others has gone, the rest close up about their middle', () => {
  const T = elementsOf([lane(31), lane(36)]), at = u => T.findIndex(e => e.kind === 'n' && e.u === u);
  // `mid` leaves at U33 toward the left, though it sits between the other two
  const members = [{cable: 'far', ji: at(31), li: at(36)}, {cable: 'mid', ji: at(31), li: at(33)}, {cable: 'near', ji: at(31), li: at(36)}];
  const lay = trunkLay(laidRack, laidFact(members), {paths: null, ctx: laidCtx, width: 3});
  assert.deepEqual(lay.order, ['far', 'mid', 'near'], 'with nothing to pull them, the bundle\'s own order');
  const x = (id, u) => lay.offset(id, at(u)).x;
  assert.deepEqual([x('far', 32), x('mid', 32), x('near', 32)], [3, 0, -3]);
  assert.deepEqual([x('far', 35), x('near', 35)], [1.5, -1.5]);
});

test('trunkLay: at a ring the pack stands on the floor, and in 3D every member is inside the circle', () => {
  const trunk = [ring('guide-1'), lane(20), lane(22)], T = elementsOf(trunk);
  const members = ['far', 'mid', 'near'].map(cable => ({cable, ji: 0, li: T.length - 1}));
  const ringPts = [{x: -202, y: 857, z: 76, at: 'entry', item: 'i2', via: 'guide-1'}, {x: -209, y: 857, z: 76, at: 'exit', item: 'i2', via: 'guide-1'}];
  const paths = new Map(['far', 'mid', 'near'].map(id => [id, {points: [{x: -100, y: 870, z: 0, at: 'a'}, ...ringPts, {x: 0, y: 950, z: 0, at: 'b'}]}]));
  const lay = trunkLay(laidRack, laidFact(members, trunk), {paths, ctx: laidCtx, width: 3});
  assert.equal(lay.run(0), 'x');
  const ys = ['far', 'mid', 'near'].map(id => lay.offset(id, 0)).map(v => v.y).sort((a, b) => a - b);
  assert.deepEqual(ys, [0, 3, 6], 'the lowest member is where the kit rests a cable, the others above it');
  assert.ok(['far', 'mid', 'near'].every(id => lay.offset(id, 0).x === 0));
  for (const i of lay.nodes) {
    const R = (lay.at(i).diameter - 3) / 2;
    const places = lay.at(i).members.map(id => lay.pack(id, i));
    for (const p of places) assert.ok(Math.hypot(p.u, p.v) <= R + 1e-9);
    // in the lay's order across the run
    for (let k = 1; k < places.length; k++) assert.ok(places[k].u >= places[k - 1].u);
  }
  assert.equal(trunkLay(laidRack, {...laidFact(members, trunk), drawn: false}, {}), null);
});

test('trunkMarks takes a riding member\'s ring mark, turned when it runs the trunk from its far end', () => {
  const trunk = [ring('guide-1'), lane(20), lane(30)];
  const mark = {run: 'x', depth: 6.8, sense: 1, back: false};
  const fwd = {waypoints: trunk, marks: [mark, null, null], stretch: [0, 2], dir: 1};
  assert.deepEqual(trunkMarks(trunk, [fwd]), [mark, null, null]);
  const rev = {waypoints: [...trunk].reverse(), marks: [null, null, mark], stretch: [0, 2], dir: -1};
  assert.equal(trunkMarks(trunk, [rev])[0].sense, -1);
  // a ring doubled back keeps its sense; a member whose marks are missing gives nothing
  assert.equal(trunkMarks(trunk, [{...rev, marks: [null, null, {...mark, back: true}]}])[0].sense, 1);
  assert.deepEqual(trunkMarks(trunk, [{...fwd, marks: null}]), [null, null, null]);
});

test('strapAt places a strap on a view\'s own segment, and not across one the view cannot draw', () => {
  const hit = strapAt([[0, 0], [0, 100], [50, 100]], {segment: 0, t: 0.25});
  assert.deepEqual(hit, {at: [0, 25], dir: [0, 1]});
  assert.equal(strapAt([[0, 0], null, [50, 100]], {segment: 0, t: 0.5}), null);
  assert.deepEqual(strapAt([[0, 0, 0], [0, 0, 10]], {segment: 0, t: 0.5}).at, [0, 0, 5]);
});

test('drawableRuns cuts the trunk where a view cannot place a waypoint', () => {
  const runs = drawableRuns([[0, 0], [1, 1], null, [2, 2], [3, 3], [4, 4], null]);
  assert.deepEqual(runs.map(r => [r.from, r.points.length]), [[0, 2], [3, 3]]);
});

// THE BEND HOOK (Portrayal #922): null-safe on a check with no bend (no
// routes, or no bundle to bend: `bend: null`), and reading the kit's
// {radius_mm, by, unchecked, points, violations} when it is there.
test('the bend hook says nothing of a check with no bend result', () => {
  for (const check of [null, {}, {bend: null}]) {
    assert.equal(bendLine(check), null);
    assert.deepEqual(bendViolations(check), []);
  }
});

test('the bend hook reads the kit\'s result: the radius and the violations', () => {
  const tight = {kind: 'corner', at: 'left-front U10', waypoint: lane(10), room_mm: 24.5, need_mm: 25, by: 'c2',
                 members: ['c1', 'c2'], unchecked: [], ok: false, short_mm: 0.5};
  const open = {kind: 'corner', at: 'pp-1 ring 1', waypoint: ring('guide-1'), ok: null, unchecked: ['c5']};
  const check = {bend: {radius_mm: 25, by: 'c2', unchecked: ['c5'], points: [tight, open], violations: [tight]}};
  // the radius only: what was left unchecked is the kit's own notes, shown beside it, not said twice
  assert.equal(bendLine(check), 'Bend radius 25 mm, set by c2.');
  assert.deepEqual(bendViolations(check), [{waypoint: lane(10), at: 'left-front U10', need_mm: 25, room_mm: 24.5, short_mm: 0.5}]);
  // with points and no violations list, the points with ok false are the violations
  assert.equal(bendViolations({bend: {points: [tight, open]}}).length, 1);
  assert.equal(trunkIndexOf([ring('guide-1'), lane(10)], lane(10)), 1);
});

test('bundleFacts without the routes is not checked, and the summary and notes say so', () => {
  const rack = {id: 'r1', frame: {kind: 'four-post', heightRU: 42, numbering: 'bottom-up'}, items: [],
    cables: [{id: 'c1', media: 'os2'}, {id: 'c2', media: 'os2'}],
    bundles: [{id: 'b1', number: 1, label: '', members: [{cable: 'c1'}, {cable: 'c2'}], route: []}]};
  const f = bundleFacts(rack, {}).get('b1');
  assert.equal(f.drawn, true);
  assert.equal(f.check.checked, false);
  assert.equal(f.straps, null);
  assert.equal(bundleSummary(f), '2 cables (c1-c2), not checked, straps every 12 in');
  assert.deepEqual(sheetBundleNotes(rack, new Map([['b1', f]])), ['Bundle 1 (b1): 2 cables (c1-c2), not checked, straps every 12 in.']);
});

test('packOffset keeps every member inside the bundle, on the diagonals and past nine members', () => {
  for (const n of [2, 3, 9, 10, 24, 61]) {
    const D = 20, W = 3;
    for (let index = 0; index < n; index++) {
      const [u, v] = packOffset({index, n, diameter: D}, W);
      assert.ok(Math.hypot(u, v) + W / 2 <= D / 2 + 1e-9, `member ${index} of ${n} is outside`);
    }
    const spots = new Set(Array.from({length: n}, (_, index) => packOffset({index, n, diameter: D}, W).map(x => x.toFixed(3)).join()));
    assert.equal(spots.size, n, `${n} members share a spot`);
  }
  assert.deepEqual(packOffset({index: 0, n: 1, diameter: 9}, 3), [0, 0]);
});

test('sheetBundleNotes carries the kit\'s notes, so an unchecked bend never reads as a pass on the sheet', () => {
  const f = {id: 'b1', name: 'Bundle 1', members: ['c1', 'c2'], drawn: true, every: {value: 12, unit: 'in'}, diameter: 9,
    straps: {every: {value: 12, unit: 'in'}, count: 2, straps: []},
    check: {checked: true, warnings: ['Bundle 1 turns at left-front U10 with room for a 24.5 mm bend; c2 (om4) needs 25 mm, 0.5 mm short.'],
            notes: ["Bundle 1's bend is not checked for c5, which has no cable type."],
            bend: {radius_mm: 25, by: 'c2', unchecked: ['c5']}, size: {max_mm: 9}}};
  assert.deepEqual(sheetBundleNotes({}, new Map([['b1', f]])), [
    'Bundle 1 (b1): 2 cables (c1-c2), about 9 mm, 2 straps every 12 in.',
    'Bundle 1 turns at left-front U10 with room for a 24.5 mm bend; c2 (om4) needs 25 mm, 0.5 mm short.',
    'Bend radius 25 mm, set by c2.',
    "Bundle 1's bend is not checked for c5, which has no cable type."]);
});

test('one drawn diameter for every view: the kit\'s, never under two cable widths', () => {
  assert.equal(drawnDiameter(14.5, 3), 14.5);
  assert.equal(drawnDiameter(4, 3), 6);
  assert.equal(drawnDiameter(null, 3), 6);
  // a bundle not yet measured packs its members in that same width
  for (let index = 0; index < 5; index++) {
    const [u, v] = packOffset({index, n: 5, diameter: null}, 3);
    assert.ok(Math.hypot(u, v) <= (6 - 3) / 2 + 1e-9);
  }
});

// WHERE A MEMBER LEAVES, AND FOR WHICH END. The kit stores a peel point under
// the end the cable heads for from there (`a` or `b`: commands.js bundle.peel
// picks the nearer port when the page names none); the list says both.
test('peelText names the waypoint and the end a peeled member heads for', () => {
  const rack = {frame: {kind: 'four-post', heightRU: 42, numbering: 'bottom-up'}, items: []};
  const bundle = {id: 'b1', route: [lane(20), lane(30)], members: [
    {cable: 'c1'}, {cable: 'c2', a: lane(22)}, {cable: 'c3', b: lane(27)}, {cable: 'c4', a: lane(21), b: lane(29)}]};
  assert.equal(peelText(rack, bundle, 'c1'), null, 'a member that rides the whole trunk has no peel point');
  assert.equal(peelText(rack, bundle, 'c2'), 'leaves at left-front U22 for its a end');
  assert.equal(peelText(rack, bundle, 'c3'), 'leaves at left-front U27 for its b end');
  assert.equal(peelText(rack, bundle, 'c4'), 'leaves at left-front U21 for its a end; leaves at left-front U29 for its b end');
  assert.equal(peelText(rack, bundle, 'c9'), null, 'not a member');
});

// ── kit 0.22.0: three kinds of strap, each with a width ───────────────────
import {strapsText, strapDrawn, STRAP_DRAWN as DRAWN_19} from '../../site/rack/bundle-view.js';
test('a bundle\'s straps are said by kind: a count is "every 12 in" only when it is the spacing straps alone', () => {
  const every = {value: 12, unit: 'in'};
  assert.equal(strapsText({count: 2, kinds: {spacing: 2, breakout: 0, anchor: 0}}, every), '2 straps every 12 in');
  assert.equal(strapsText({count: 1, kinds: {spacing: 1, breakout: 0, anchor: 0}}, every), '1 strap every 12 in');
  assert.equal(strapsText({count: 10, kinds: {spacing: 2, breakout: 8, anchor: 0}}, every), '10 straps (2 every 12 in, 8 where a cable leaves)');
  assert.equal(strapsText({count: 12, kinds: {spacing: 3, breakout: 6, anchor: 3}}, every), '12 straps (3 every 12 in, 6 where a cable leaves, 3 at tray tie slots)');
  assert.equal(strapsText({count: 1, kinds: {spacing: 0, breakout: 0, anchor: 1}}, null), '1 strap (1 at a tray tie slot)');
  assert.equal(strapsText({count: 4, kinds: {spacing: 0, breakout: 4, anchor: 0}}, every), '4 straps (4 where a cable leaves)');
  assert.equal(strapsText({count: 0, kinds: {spacing: 0, breakout: 0, anchor: 0}}, every), null);
  // the summary a row and the panel show carries it, and never the total as a spacing count
  const f = {id: 'b1', name: 'Bundle 1', members: ['c1', 'c2'], drawn: true, every, diameter: 9,
    check: {checked: true, warnings: [], notes: []}, straps: {every, count: 10, kinds: {spacing: 2, breakout: 8, anchor: 0}, straps: []}};
  assert.equal(bundleSummary(f), '2 cables (c1-c2), about 9 mm, 10 straps (2 every 12 in, 8 where a cable leaves)');
  assert.doesNotMatch(bundleSummary(f), /10 straps every/);
});
test('a strap is drawn at its own width: the 19 mm strap as the bar it always was, 12 narrower, 25 wider', () => {
  assert.equal(strapDrawn({width_mm: 19}), DRAWN_19);
  assert.ok(strapDrawn({width_mm: 12}) < DRAWN_19 && strapDrawn({width_mm: 25}) > DRAWN_19);
  assert.ok(Math.abs(strapDrawn({width_mm: 25}) / strapDrawn({width_mm: 12}) - 25 / 12) < 1e-9);
  assert.equal(strapDrawn({}), DRAWN_19);
});

// portrayal-site#195: a strap stands on its run as the run is drawn, by its length.
test('alongLine finds a place by the length of a line of points, not by its ends', () => {
  // 100 up, then 50 across: half of its 150 is 75 up the first leg, not the middle of the chord
  const hit = alongLine([[0, 0], [0, 100], [50, 100]], 0.5);
  assert.deepEqual([hit.k, hit.at, hit.dir], [0, [0, 75], [0, 1]]);
  const far = alongLine([[0, 0], [0, 100], [50, 100]], 0.9);
  assert.equal(far.k, 1);
  assert.ok(Math.abs(far.at[0] - 35) < 1e-9 && far.at[1] === 100 && far.dir[0] === 1);
  // the ends, a leg of no length stepped over, three dimensions, and a line of no length
  assert.deepEqual(alongLine([[0, 0], [0, 100]], 0).at, [0, 0]);
  assert.deepEqual(alongLine([[0, 0], [0, 100]], 1).at, [0, 100]);
  assert.deepEqual(alongLine([[0, 0], [0, 0], [10, 0]], 0.5).at, [5, 0]);
  assert.deepEqual(alongLine([[0, 0, 0], [0, 0, 10], [0, 0, 10]], 0.5).at, [0, 0, 5]);
  assert.equal(alongLine([[3, 3], [3, 3]], 0.5), null);
});

test('trunkSpanPoints gives the points the kit lays a member through between two trunk stops, in order from the first', () => {
  const trunk = [{item: 'm', via: 'guide-1'}, {lane: 'left-rear', ru: 2}, {lane: 'left-front', ru: 2}];
  const y = 1.5 * 44.45;
  const points = [{at: 'a', x: 0, y: 0, z: 0}, {item: 'm', via: 'guide-1', x: 1, y: 1, z: 1}, {at: 'lane', x: 2, y, z: -700},
    {at: 'rest', x: 2, y: y - 20, z: -400}, {at: 'rest', x: 2, y: y - 20, z: -200}, {at: 'lane', x: 2, y, z: 0}, {at: 'b', x: 9, y: 9, z: 9}];
  const paths = new Map([['c1', {points}]]);
  // two lane stops at one height are told apart by their order on the member's own path
  const span = trunkSpanPoints([trunk[1], trunk[2]], 0, ['c0', 'c1'], paths);
  assert.equal(span, null);   // both stops match both lane points: the member does not run straight from one to the other
  const ring = trunkSpanPoints(trunk, 0, ['c1'], new Map([['c1', {points: [points[0], points[1], {at: 'approach', x: 1, y: 5, z: 1}, points[2], points[6]]}]]));
  assert.deepEqual([ring.a.length, ring.b.length, ring.mid.map(q => q.at)], [1, 1, ['approach']]);
  // from the far stop back: the points between come in order from the first stop named
  const back = trunkSpanPoints([trunk[1], trunk[0]], 0, ['c1'], new Map([['c1', {points: [points[0], points[1], {at: 'approach', x: 1, y: 5, z: 1}, {at: 'rest', x: 1, y: 6, z: 1}, points[2], points[6]]}]]));
  assert.deepEqual(back.mid.map(q => q.at), ['rest', 'approach']);
  // nothing between: a straight run; no member with a path: null
  assert.deepEqual(trunkSpanPoints(trunk, 0, ['c1'], new Map([['c1', {points: [points[1], points[2]]}]])).mid, []);
  assert.equal(trunkSpanPoints(trunk, 0, ['c1'], new Map()), null);
});
