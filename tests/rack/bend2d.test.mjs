// A ROUTED CABLE ON A 2D PANE keeps its bend radius (portrayal-site#185): every
// corner is a circular arc of the cable's radius where the legs allow it, a
// short corner is a smaller arc and is reported, and no corner is square.
import test from 'node:test';
import assert from 'node:assert/strict';
import {arcPath} from '../../site/rack/bend2d.js';
import {radiusOf} from '../../site/rack/bend3d.js';

const arcs = d => [...d.matchAll(/A([\d.]+) ([\d.]+) 0 0 ([01]) (-?[\d.]+) (-?[\d.]+)/g)]
  .map(m => ({r: +m[1], ry: +m[2], sweep: +m[3], to: [+m[4], +m[5]]}));

test('an L with long legs is one arc of exactly the bend radius, tangent to both legs', () => {
  const {d, corners} = arcPath([[0, 0], [200, 0], [200, 200]], 24);
  const a = arcs(d);
  assert.equal(a.length, 1);
  assert.equal(a[0].r, 24);
  assert.equal(a[0].ry, 24);
  assert.deepEqual(a[0].to, [200, 24]);
  assert.match(d, /L176 0 A/);          // the arc starts R before the corner along the first leg
  assert.equal(corners.length, 1);
  assert.equal(corners[0].short_mm, 0);
  assert.ok(!/Q/.test(d), 'no square-cut quadratic corner');
});

test('the sweep follows the turn', () => {
  const right = arcs(arcPath([[0, 0], [100, 0], [100, 100]], 10).d)[0];
  const left = arcs(arcPath([[0, 0], [100, 0], [100, -100]], 10).d)[0];
  assert.notEqual(right.sweep, left.sweep);
});

test('a corner short of room is a smaller arc and is reported short', () => {
  // legs of 30 to a path's open ends give the corner all of them: 30 of the 40 asked
  const {d, corners} = arcPath([[0, 0], [30, 0], [30, 30]], 40);
  assert.equal(corners.length, 1);
  assert.equal(arcs(d)[0].r, 30);
  assert.equal(corners[0].drawn_mm, 30);
  assert.equal(corners[0].short_mm, 10);
  // two corners share the leg between them, neither taking less than half
  const two = arcPath([[0, 0], [100, 0], [100, 40], [200, 40]], 30).corners;
  assert.deepEqual(two.map(c => c.drawn_mm), [20, 20]);
  assert.deepEqual(two.map(c => c.short_mm), [10, 10]);
});

test('a corner that doubles back has no arc and is short by all of it', () => {
  const {d, corners} = arcPath([[0, 0], [50, 0], [0, 0.001]], 20);
  assert.equal(arcs(d).length, 0);
  assert.equal(corners[0].short_mm, 20);
});

test('a straight run and a repeated point add no corner', () => {
  const {d, corners} = arcPath([[0, 0], [50, 0], [50, 0], [100, 0]], 20);
  assert.equal(corners.length, 0);
  assert.equal(arcs(d).length, 0);
});

test('the drawn arc turns through the corner by its own angle', () => {
  // 45 degrees: the arc of radius 30 ends at q + R tan(22.5 deg) along the next leg
  const {d} = arcPath([[0, 0], [300, 0], [500, 200]], 30);
  const a = arcs(d)[0], t = 30 * Math.tan(Math.PI / 8);
  assert.ok(Math.abs(a.to[0] - (300 + t * Math.SQRT1_2)) < 0.01);
  assert.ok(Math.abs(a.to[1] - t * Math.SQRT1_2) < 0.01);
});

test('without a radius the corners are the small cut as before', () => {
  const {d, corners} = arcPath([[0, 0], [100, 0], [100, 100]], null);
  assert.match(d, /Q100 0/);
  assert.equal(corners.length, 0);
});

test('a cable that rides a bundle is drawn at the larger of its own and its bundle radius', () => {
  const rack = {cables: [{id: 'c1'}, {id: 'c2'}]};
  const bendOf = c => ({c1: 24, c2: 25}[c.id]);
  const r = radiusOf(rack, bendOf, {bundles: new Map([['b1', {members: ['c1'], check: {bend: {radius_mm: 40}}}]])});
  assert.equal(r({id: 'c1'}), 40);
  assert.equal(r({id: 'c2'}), 25);
  assert.equal(radiusOf(rack, null, null)({id: 'c1'}), null);
});
