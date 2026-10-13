// THE WIDTH A CABLE IS DRAWN AT (Portrayal #1060, kit 0.34.0 widthOf). A power
// cord is drawn at its type's outside diameter (7.1 mm C13/C14, 7.9 mm C19/C20)
// so it meets the plug stub; every other cable keeps WIDTH. A plan link carries
// no `type`, so widthLookup asks the kit about the rack's own cable.
import test from 'node:test';
import assert from 'node:assert/strict';
import {WIDTH} from '../../vendor/rack/cable-geometry.js';
import {diameterLookup} from '../../vendor/rack/cable-types.js';
import {widthLookup} from '../../site/rack/route-context.js';

const types = {
  'power-c13': {od_mm: 7.1}, 'power-c19': {od_mm: 7.9}, power: {od_mm: 7.1}, cat6a: {od_mm: 6.2},
};
const diameterOf = diameterLookup(types);
const cables = [
  {id: 'c1', media: 'power', type: 'power-c13'},
  {id: 'c2', media: 'power', type: 'power-c19'},
  {id: 'c3', media: 'cat6a', type: 'cat6a'},
  {id: 'c4', media: 'power'},
];
const link = id => ({id, media: cables.find(c => c.id === id).media});

test('a power cord is drawn at its type\'s diameter', () => {
  const w = widthLookup(diameterOf, cables);
  assert.equal(w(link('c1')), 7.1);
  assert.equal(w(link('c2')), 7.9);
});

test('a cord that names no type, or with no cable types loaded, is the C13 cord', () => {
  assert.equal(widthLookup(diameterOf, cables)(link('c4')), 7.1);
  assert.equal(widthLookup(undefined, cables)(link('c2')), 7.1);
});

test('every other cable keeps WIDTH', () => {
  const w = widthLookup(diameterOf, cables);
  assert.equal(w(link('c3')), WIDTH);
  assert.equal(widthLookup(undefined, cables)(link('c3')), WIDTH);
});
