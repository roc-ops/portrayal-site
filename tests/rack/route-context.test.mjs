import test from 'node:test';
import assert from 'node:assert/strict';
import {guidesFromRects, ringGroupsFrom, dedupeGuides} from '../../site/rack/route-context.js';

test('guidesFromRects maps ring ends, ducts and passes to via ids in rack coordinates', () => {
  // Face 483 wide: rack x = face x - 241.5 on the front; mirrored on the rear.
  const rects = [
    {id: 'guide-1-end', kind: 'ring', x: 32.3, y: 0, w: 6.8, h: 41},
    {id: 'guide--duct', cls: 'guide', x: 20, y: 5, w: 443, h: 30},
    {id: 'pass--rear-brush', cls: 'pass', x: 9, y: 6, w: 465, h: 32},
    {id: 'chassis-faceplate', x: 0, y: 0, w: 483, h: 44}];
  const front = guidesFromRects(rects, 'front', 483);
  assert.deepEqual(front.map(g => [g.via, g.kind, Math.round(g.x * 10) / 10]),
    [['guide-1', 'ring', -205.8], ['duct', 'duct', 0], ['rear-brush', 'pass', 0]]);
  assert.deepEqual(front.find(g => g.via === 'duct').aperture, {w: 30, h: 30});
  assert.deepEqual(front.find(g => g.via === 'rear-brush').aperture, {w: 465, h: 32});
  const rear = guidesFromRects(rects, 'rear', 483);
  assert.equal(Math.round(rear[0].x * 10) / 10, 205.8);
});

test('ringGroupsFrom makes a ring of each group at the center of its extent, aperture unknown', () => {
  const groups = [{id: 'guide-1', x: 63.75, w: 20}, {id: 'guide-2', x: 400, w: 20}];
  const front = ringGroupsFrom(groups, 'front', 483);
  assert.deepEqual(front.map(g => [g.via, g.kind, g.face, g.x, g.aperture]),
    [['guide-1', 'ring', 'front', 73.75 - 241.5, null], ['guide-2', 'ring', 'front', 410 - 241.5, null]]);
  assert.equal(ringGroupsFrom(groups, 'rear', 483)[0].x, 241.5 - 73.75);
});

test('dedupeGuides keeps one guide per via and face, the first', () => {
  const a = {via: 'guide-1', face: 'front', x: 1}, b = {via: 'guide-1', face: 'front', x: 2};
  const c = {via: 'guide-1', face: 'rear', x: 3};
  assert.deepEqual(dedupeGuides([a, b, c]), [a, c]);
});
