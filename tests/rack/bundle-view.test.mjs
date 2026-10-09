import test from 'node:test';
import assert from 'node:assert/strict';
import {memberStretch, combOffset, trunkMarks, strapAt, drawableRuns, bendLine, bendViolations, packOffset, drawnDiameter,
        trunkIndexOf, bundleSummary, bundleFacts, sheetBundleNotes} from '../../site/rack/bundle-view.js';

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

test('combOffset spreads members symmetrically inside the diameter, never further apart than the width', () => {
  const at = index => combOffset({index, n: 3, diameter: 9}, 3);
  assert.deepEqual([0, 1, 2].map(at), [-3, 0, 3]);
  // a tight bundle: centres spread over the diameter less one width
  assert.deepEqual([0, 1, 2].map(index => combOffset({index, n: 3, diameter: 7}, 3)), [-2, 0, 2]);
  // under two widths, the drawn diameter (drawnDiameter) is the band's: 6 for a 3 mm stroke
  assert.deepEqual([0, 1].map(index => combOffset({index, n: 2, diameter: 5}, 3)), [-1.5, 1.5]);
  assert.equal(combOffset({index: 0, n: 1, diameter: 9}, 3), 0);
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

// THE BEND HOOK (Portrayal #922, kit 0.8.0): null-safe on 0.7.0's `bend: null`,
// and reading 0.8.0's {radius_mm, by, unchecked, points, violations} when it comes.
test('the bend hook says nothing before kit 0.8.0', () => {
  for (const check of [null, {}, {bend: null}]) {
    assert.equal(bendLine(check), null);
    assert.deepEqual(bendViolations(check), []);
  }
});

test('the bend hook reads kit 0.8.0\'s result: the radius and the violations', () => {
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
