// A BUNDLE'S TRUNK ON A 2D PANE turns its corners as its members do (portrayal-site#185):
// the stretches between the trunk's nodes are rounded with the bundle's radius, so the
// members, drawn by arcPath at that radius, stay inside the band at every turn.
import test from 'node:test';
import assert from 'node:assert/strict';
import {arcPath, trunkPaths, trunkPoint} from '../../site/rack/bend2d.js';

const nums = d => d.match(/-?[\d.]+/g).map(Number);
const arcs = d => [...d.matchAll(/A([\d.]+) ([\d.]+) 0 0 ([01]) (-?[\d.]+) (-?[\d.]+)/g)].map(m => ({r: +m[1], to: [+m[4], +m[5]]}));

test('two stretches meeting at a corner: the first ends in the arc, the second starts where it leaves', () => {
  const [a, b] = trunkPaths([[0, 0], [200, 0], [200, 200]], 24);
  assert.match(a.d, /^M0 0 L176 0 A24 24 0 0 1 200 24$/);
  assert.match(b.d, /^M200 24 L200 200$/);
  assert.deepEqual(arcs(a.d)[0].to, [200, 24]);
  assert.equal(arcs(b.d).length, 0);
});

test('a stretch begins M x0 y0 L x1 y1 along its own straight run (what the browser check reads)', () => {
  const [a] = trunkPaths([[0, 0], [200, 0], [200, 200]], 24);
  assert.deepEqual(nums(a.d).slice(0, 4), [0, 0, 176, 0]);
});

test('the trunk is the members line: the same arc as arcPath of the same points', () => {
  const pts = [[0, 0], [200, 0], [200, 200], [400, 200]];
  const whole = arcPath(pts, 30).d;
  const arcsOfWhole = arcs(whole), arcsOfTrunk = trunkPaths(pts, 30).flatMap(s => arcs(s.d));
  assert.deepEqual(arcsOfTrunk, arcsOfWhole);
});

test('a straight node (a stretch change with no turn) keeps both stretches as they were', () => {
  const [a, b] = trunkPaths([[0, 0], [100, 0], [250, 0]], 30);
  assert.equal(a.d, 'M0 0 L100 0');
  assert.equal(b.d, 'M100 0 L250 0');
});

test('without a radius every stretch is the straight line, as before', () => {
  const [a, b] = trunkPaths([[0, 0], [200, 0], [200, 200]], null);
  assert.equal(a.d, 'M0 0 L200 0');
  assert.equal(b.d, 'M200 0 L200 200');
});

test('a corner short of room is a smaller arc in the trunk too, as for the members', () => {
  const [a] = trunkPaths([[0, 0], [30, 0], [30, 30]], 40);
  assert.equal(arcs(a.d)[0].r, 30);
});

test('a strap on a straight run is where the chord puts it; on a corner it is on the arc', () => {
  const pts = [[0, 0], [200, 0], [200, 200]];
  const mid = trunkPoint(pts, 24, 0, 0.5);
  assert.deepEqual(mid.c.map(Math.round), [100, 0]);
  assert.deepEqual(mid.dir.map(v => Math.round(v * 1e3) / 1e3), [1, -0 || 0]);
  // 0.99 of the first stretch is 2 mm before the vertex: inside the cut, on the arc
  const near = trunkPoint(pts, 24, 0, 0.99);
  const centre = [176, 24];
  assert.ok(Math.abs(Math.hypot(near.c[0] - centre[0], near.c[1] - centre[1]) - 24) < 0.01, 'on the arc of radius 24');
  assert.ok(near.c[0] < 200 && near.c[1] > 0, 'cut inside the corner');
  assert.ok(Math.abs(Math.hypot(near.dir[0], near.dir[1]) - 1) < 1e-9);
});

test('the corner point (the vertex) of the arc is not on the rounded trunk', () => {
  const [a] = trunkPaths([[0, 0], [200, 0], [200, 200]], 24);
  assert.ok(!/L200 0/.test(a.d));
});
