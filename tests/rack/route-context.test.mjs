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

import {pathBox} from '../../site/rack/route-context.js';
test('pathBox reads an absolute obround path, bulges included, and refuses relative ones', () => {
  const b = pathBox('M33.900 9.400 H48.800 A12.800 12.800 0 0 1 48.800 35.000 H33.900 A12.800 12.800 0 0 1 33.900 9.400 Z');
  assert.deepEqual([b.x, b.y, b.w, Math.round(b.h * 10) / 10].map(v => Math.round(v * 10) / 10), [21.1, 9.4, 40.5, 25.6]);
  assert.equal(pathBox('m1 1 l2 2'), null);
  const g = guidesFromRects([{id: 'pass--window-1', cls: 'pass', x: b.x, y: b.y, w: b.w, h: b.h}], 'front', 483);
  assert.equal(g[0].via, 'window-1');
});

test('a ring guide carries its run, and a ring along x its -end rect width as its depth (Portrayal #930)', () => {
  const rects = [{id: 'guide-1-end', kind: 'ring', x: 32.3, y: 0, w: 6.8, h: 41},
                 {id: 'end-ring-left-end', kind: 'ring', x: 0, y: 0, w: 12, h: 41},
                 {id: 'guide--duct', cls: 'guide', x: 20, y: 5, w: 443, h: 30}];
  const g = guidesFromRects(rects, 'front', 483, {}, {'end-ring-left': 'y'});
  assert.deepEqual(g.map(x => [x.via, x.run, x.depth]),
    [['guide-1', 'x', 6.8], ['end-ring-left', 'y', undefined], ['duct', undefined, undefined]]);
  assert.deepEqual(ringGroupsFrom([{id: 'end-ring-left', x: 0, w: 20}], 'front', 483, {'end-ring-left': 'y'})
    .map(x => [x.run, x.depth]), [['y', undefined]]);
});
