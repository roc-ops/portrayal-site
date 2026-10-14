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

test('at scale a strap is its pack and the margin each side, with a pixel of rim past each end', () => {
  assert.equal(STRAP_MARGIN, 2);
  const big = strapLengths(9, 4);                                          // 300%: 52 px, nothing to make up
  assert.deepEqual([big.true, big.least], [13, 13]);
  assert.ok(near(big.rimTrue, 13.5) && near(big.rimLeast, 13.5));
  assert.deepEqual(strapLengths(9, 0), {true: 13, least: 13, rimTrue: 13, rimLeast: 13}, 'a pane not laid out is drawn at its true size');
});

test('at Fit the least size holds, but no bar, its rim included, is over twice its pack unless its true length is', () => {
  assert.equal(STRAP_MOST, 2);
  // a thick pack, 15 mm at 0.45 px a mm: its true 19 mm is 8.6 px, over the least size already
  const thick = strapLengths(15, 0.45);
  assert.deepEqual([thick.true, thick.least], [19, 19]);
  assert.ok(near(thick.rimLeast, 19 + 2 / 0.45));
  // 9 mm, three cables: the least size is 15.6 mm; with its rim that would be 20 mm, 2.2 packs: held to 18 in all
  const mid = strapLengths(9, 0.45);
  assert.ok(near(mid.rimLeast, 18) && near(mid.least, 18 - 2 / 0.45), JSON.stringify(mid));
  assert.ok(mid.least >= mid.true && mid.rimTrue <= 18 + 1e-9);
  // a thin pack, 6 mm: twice the pack is 12 mm in all, and its true 10 mm is the floor
  const thin = strapLengths(6, 0.45);
  assert.deepEqual([thin.true, thin.least], [10, 10]);
  assert.ok(near(thin.rimLeast, 12) && near(thin.rimTrue, 12));
  // one cable, 3 mm: its true bar is 7 mm, over twice the pack by its margins alone; nothing is added to it
  const one = strapLengths(3, 0.45);
  assert.deepEqual([one.true, one.least, one.rimTrue, one.rimLeast], [7, 7, 7, 7]);
  for (const pack of [1, 3, 6, 9, 15, 30]) for (const scale of [0.2, 0.45, 1, 4]) {
    const l = strapLengths(pack, scale), cap = Math.max(l.true, STRAP_MOST * pack) + 1e-9;
    assert.ok(l.least >= l.true && l.rimLeast >= l.least && l.rimTrue >= l.true && l.rimLeast <= cap && l.rimTrue <= cap, `${pack} mm at ${scale}`);
  }
});

import {PAGE_STRAP, PAGE_ALONG} from '../../site/rack/strap-size.js';

test('on the page a strap is narrower along the run and not much wider than its bundle (S-0040)', () => {
  assert.ok(PAGE_ALONG < 1);
  for (const pack of [3, 6, 9, 15]) for (const scale of [0.2, 0.45, 1, 4]) {
    const page = strapLengths(pack, scale, PAGE_STRAP), paper = strapLengths(pack, scale);
    assert.ok(page.rimLeast <= paper.rimLeast + 1e-9 && page.rimTrue <= paper.rimTrue + 1e-9, `${pack} mm at ${scale}`);
    assert.ok(page.rimLeast <= Math.max(pack + 2 * PAGE_STRAP.margin + PAGE_STRAP.rimPx / scale, PAGE_STRAP.most * pack) + 1e-9);
  }
});

import {lineSpan} from '../../site/rack/strap-size.js';

test("the pack is where its cables' lines cross the strap, wherever the trunk said it was", () => {
  // three verticals at x = 103, 106, 109, each two points; the strap is across them at y = 50, placed by the trunk at x = 100
  const line = x => [[x, 0], [x, 100]];
  assert.deepEqual(lineSpan([line(103), line(106), line(109)], [100, 50], [1, 0], 3, 20), {lo: 1.5, hi: 10.5, riders: 3});
  // a line that ends before the strap is left out, and so is one too far across the run (another cable's)
  assert.equal(lineSpan([line(103), [[112, 0], [112, 30]]], [100, 50], [1, 0], 3, 20).riders, 1);
  assert.equal(lineSpan([line(103), line(160)], [100, 50], [1, 0], 3, 20).riders, 1);
  assert.equal(lineSpan([[[112, 0], [112, 30]]], [100, 50], [1, 0], 3, 20), null);
  assert.equal(lineSpan([], [100, 50], [1, 0], 3, 20), null);
  // a line of several points is cut on the segment that crosses, and one that turns back is taken nearest the strap
  assert.deepEqual(lineSpan([[[90, 0], [104, 40], [104, 60], [140, 60]]], [100, 50], [1, 0], 3, 20), {lo: 2.5, hi: 5.5, riders: 1});
});

test('on a slant the lines are measured square across the run', () => {
  // two lines at 45 degrees, 3 mm apart in x: 2.12 mm apart across the run
  const line = x0 => [[x0, 0], [x0 + 100, 100]];
  const s = lineSpan([line(0), line(3)], [51.5, 50], [Math.SQRT1_2, -Math.SQRT1_2], 3, 20);
  assert.ok(Math.abs((s.hi - s.lo) - (3 * Math.SQRT1_2 + 3)) < 1e-9, `${s.hi - s.lo}`);
});
