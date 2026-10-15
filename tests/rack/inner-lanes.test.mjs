// The site's share of Portrayal #1078 (kit 0.42.0): a four-post offers an inner
// lane beside each rail (left-rear-inner, ...) for a route to name. The route
// editor offers them as pick targets, and an agent reads them back in the
// lanes a cable can take.

import test from 'node:test';
import assert from 'node:assert/strict';
import {waypointLanesOf} from '../../vendor/rack/route.js';
import {RU, RAIL_W, OPENING} from '../../vendor/rack/rails.js';
import {laneTargets} from '../../site/rack/lane-targets.js';
import {cableText} from '../../site/rack/agent-text.js';

const four = {kind: 'four-post', heightRU: 42};
const two = {kind: 'two-post', heightRU: 42};

test('laneTargets: the rear pane of a four-post offers the gutter and the inner lane of each side, at every U', () => {
  const ts = laneTargets(four, 'rear');
  assert.deepEqual([...new Set(ts.map(t => t.lane))].sort(), ['left-rear', 'left-rear-inner', 'right-rear', 'right-rear-inner']);
  for (const lane of ['left-rear', 'left-rear-inner', 'right-rear', 'right-rear-inner'])
    assert.deepEqual(ts.filter(t => t.lane === lane).map(t => t.ru), Array.from({length: 42}, (_, i) => i + 1));
  const at = lane => ts.find(t => t.lane === lane && t.ru === 42);
  // the rear pane mirrors the sides: the left lane is at the pane's right
  assert.equal(at('left-rear-inner').x, OPENING);
  assert.equal(at('left-rear-inner').w, RAIL_W);
  assert.equal(at('right-rear-inner').x, -RAIL_W);
  assert.equal(at('left-rear-inner').y, 0);
  assert.equal(at('left-rear-inner').h, RU);
});

test('laneTargets: the front pane names the front lanes, and a two-post has no inner lane', () => {
  const front = laneTargets(four, 'front');
  assert.deepEqual([...new Set(front.map(t => t.lane))].sort(), ['left-front', 'left-front-inner', 'right-front', 'right-front-inner']);
  assert.equal(front.find(t => t.lane === 'left-front-inner').x, -RAIL_W);
  assert.deepEqual([...new Set(laneTargets(two, 'front').map(t => t.lane))].sort(), ['left', 'right']);
});

test('laneTargets: every lane it offers is one the kit takes for a waypoint', () => {
  const kit = waypointLanesOf(four);
  for (const view of ['front', 'rear']) for (const t of laneTargets(four, view)) assert.ok(kit.includes(t.lane), t.lane);
});

test('cableText names all eight lanes of a four-post, the inner ones too', () => {
  const lanes = waypointLanesOf(four);
  assert.equal(lanes.length, 8);
  const text = cableText({kind: 'cable', id: 'c1', a: {item: 'i1', path: 'port-1', view: 'front'}, b: {item: 'i2', path: 'port-1', view: 'front'},
    media: 'cat6', loose: [], route: {text: ''}, lanes});
  for (const l of lanes) assert.ok(text.includes(l), `${l} in ${text}`);
  assert.doesNotMatch(text, /and \d+ more/);
});
