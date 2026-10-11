// A strap's size on a pane (portrayal-site#190): as long as its pack is wide
// where it sits, square across the run, and never made much longer than that
// by the least size it keeps on screen.
import test from 'node:test';
import assert from 'node:assert/strict';
import {STRAP_MARGIN, STRAP_MOST, packSpan, strapLengths} from '../../site/rack/strap-size.js';
import {STRAP_MIN_PX} from '../../site/rack/stage.js';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

test('on a straight run the pack is its members side by side, a cable wide at each edge', () => {
  // three cables 3 mm apart up a lane (x across, the run along y), the strap at their middle
  const s = packSpan([[97, 50], [100, 50], [103, 50]], [100, 50], [1, 0], 3, 15);
  assert.deepEqual(s, {lo: -4.5, hi: 4.5});
});

test('on a diagonal the pack is measured square across the run, not across the lane', () => {
  // the same three, on a run at 45 degrees: 3 mm apart in x is 2.12 mm apart across the run
  const n = [Math.SQRT1_2, -Math.SQRT1_2];
  const s = packSpan([[97, 50], [100, 50], [103, 50]], [100, 50], n, 3, 15);
  assert.ok(near(s.hi - s.lo, 2 * 3 * Math.SQRT1_2 + 3, 1e-9), `${s.hi - s.lo}`);
  assert.ok(s.hi - s.lo < 9, 'narrower than the same pack on a straight run');
  assert.ok(near(s.lo, -s.hi), 'about the strap');
});

test('a fan is measured where the strap is, and a pack that is off its middle keeps its own place', () => {
  const s = packSpan([[100, 0], [104, 0]], [100, 0], [1, 0], 3, 15);
  assert.deepEqual(s, {lo: -1.5, hi: 5.5});
});

test('no pack is wider than its diameter, and with no member it is the diameter', () => {
  const s = packSpan([[90, 0], [110, 0]], [100, 0], [1, 0], 3, 12);
  assert.ok(near(s.hi - s.lo, 12) && near(s.lo, -6));
  assert.deepEqual(packSpan([], [0, 0], [1, 0], 3, 12), {lo: -6, hi: 6});
});

test('at scale a strap is its pack and the margin each side', () => {
  assert.equal(STRAP_MARGIN, 2);
  assert.deepEqual(strapLengths(9, 4), {true: 13, least: 13});            // 300%: 52 px, nothing to make up
  assert.deepEqual(strapLengths(9, 0), {true: 13, least: 13}, 'a pane not laid out is drawn at its true size');
});

test('at Fit the least size holds, but never makes a strap over twice its pack', () => {
  assert.equal(STRAP_MOST, 2);
  // a thick pack, 15 mm at 0.45 px a mm: its true 19 mm is 8.6 px, over the least size already
  assert.deepEqual(strapLengths(15, 0.45), {true: 19, least: 19});
  // 9 mm: 13 mm true is 5.9 px, under the least size; the least size (15.6 mm) is within twice the pack
  const mid = strapLengths(9, 0.45);
  assert.ok(near(mid.least * 0.45, STRAP_MIN_PX), `${mid.least * 0.45} px`);
  // a thin pack, 6 mm: the least size would be 15.6 mm, 2.6 packs; it is held to twice the pack
  const thin = strapLengths(6, 0.45);
  assert.equal(thin.least, 12);
  assert.ok(thin.least / 6 <= STRAP_MOST && thin.least >= thin.true);
  // and a strap is never shorter than it truly is, however thin the pack
  for (const pack of [1, 3, 6, 9, 15, 30]) for (const scale of [0.2, 0.45, 1, 4]) {
    const l = strapLengths(pack, scale);
    assert.ok(l.least >= l.true && l.least <= Math.max(l.true, STRAP_MOST * pack) + 1e-9, `${pack} mm at ${scale}`);
  }
});

import {strokeSpan} from '../../site/rack/strap-size.js';

test('the pack is read off the strokes where they cross the strap, wherever the trunk said it was', () => {
  // three verticals at x = 103, 106, 109, points a millimetre apart; the strap is across them at y = 50,
  // placed by the trunk at x = 100
  const line = x => Array.from({length: 101}, (_, k) => [x, k]);
  const s = strokeSpan([line(103), line(106), line(109)], [100, 50], [1, 0], 3, 20);
  assert.deepEqual(s, {lo: 1.5, hi: 10.5, n: 3});
  // a member that does not come near the strap's line (it ends before it) is left out
  const short = Array.from({length: 30}, (_, k) => [112, k]);
  assert.equal(strokeSpan([line(103), short], [100, 50], [1, 0], 3, 20).n, 1);
  // one too far across the run is another cable's, not the pack's
  assert.equal(strokeSpan([line(103), line(160)], [100, 50], [1, 0], 3, 20).n, 1);
  assert.equal(strokeSpan([short], [100, 50], [1, 0], 3, 20), null);
  assert.equal(strokeSpan([], [100, 50], [1, 0], 3, 20), null);
});

test('on a slant the strokes are measured square across the run', () => {
  // two lines at 45 degrees, 3 mm apart in x: 2.12 mm apart across the run
  const line = x0 => Array.from({length: 200}, (_, k) => [x0 + k * 0.5, k * 0.5]);
  const s = strokeSpan([line(0), line(3)], [51.5, 50], [Math.SQRT1_2, -Math.SQRT1_2], 3, 20);
  assert.ok(Math.abs((s.hi - s.lo) - (3 * Math.SQRT1_2 + 3)) < 0.01, `${s.hi - s.lo}`);
});
