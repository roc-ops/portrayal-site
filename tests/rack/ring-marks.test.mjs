// A CABLE THROUGH A RING, DRAWN ON A PANE (Portrayal #930). The kit decides
// each ring once, in the rack's axes (route.js ringMarks); a pane whose axes
// run the other way turns the marks (route-context.js paneMarks) before
// route-path.js routed2d draws them. Unturned, a rear ring or a ring that
// runs up the rack is entered from the wrong face, and the cable is drawn
// past the ring and back: a hook. These draw both cases on the pane that
// shows them and measure the hook as the furthest the drawn line goes back
// against its direction of travel along the ring's run.
import test from 'node:test';
import assert from 'node:assert/strict';
import {ringMarks, reverseMarks, laneX} from '../../vendor/rack/route.js';
import {routed2d} from '../../vendor/rack/route-path.js';
import {RU, OPENING} from '../../vendor/rack/rails.js';
import {paneMarks} from '../../site/rack/route-context.js';

const HEIGHT_RU = 42, H = HEIGHT_RU * RU;
const frame = {kind: 'four-post', heightRU: HEIGHT_RU, numbering: 'bottom-up', railDepth: 700};

// Rack (x right as seen from the front, y up) to a pane's user space: y down,
// and the rear pane mirrored across the opening (cable-view.js wayPoint).
const toPane = (pane, p) => [pane === 'rear' ? OPENING / 2 - p.x : OPENING / 2 + p.x, H - p.y];

// Every coordinate pair of a routed2d path, in order (M, L and Q's control
// and end points: a rounded corner's control point is the corner itself).
const pathPoints = d => {
  const n = d.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/g).map(Number), out = [];
  for (let i = 0; i + 1 < n.length; i += 2) out.push([n[i], n[i + 1]]);
  return out;
};
// How far the drawn line goes back against its travel along axis `k`
// (0 = x, 1 = y) toward `dir` (+1 or -1): 0 when it never turns back.
const hookOf = (d, k, dir) => {
  let best = -Infinity, back = 0;
  for (const p of pathPoints(d)) { const v = dir * p[k]; best = Math.max(best, v); back = Math.max(back, best - v); }
  return back;
};

// A one-cable rack with an edited route a -> ring -> lane, and a route
// context that places the ports and the ring where the test says.
function scene({face, ring, port, lane}) {
  const rack = {frame, items: [{id: 'i1', ref: 'sw', ru: 18, face}, {id: 'i2', ref: 'mgr', ru: 20, face}],
    cables: [{id: 'c1', a: {item: 'i1', path: 'p1', view: 'front'}, b: {item: 'i1', path: 'p2', view: 'front'},
              route: [{item: 'i2', via: 'ring-1'}, lane], routeEdited: true}]};
  const ctx = {
    chassisOf: ref => ({sw: {ru: 1, d: 300}, mgr: {ru: 1, d: 0}})[ref],
    guidesOf: id => (id === 'i2' ? [{via: 'ring-1', kind: 'ring', face, x: ring.x, aperture: null, ...ring.g}] : []),
    portX: end => (end.path === 'p1' ? port.x : 0),
    portY: end => (end.path === 'p1' ? port.y : 0),
  };
  return {rack, ctx};
}
const ringY = 19.5 * RU;   // the manager's U middle: item ru 20

test('a rear ring on the mirrored rear pane is drawn through, with no hook', () => {
  // A rear-facing manager's ring at rack x 0; the port 150 mm to its left
  // (as seen from the front), the cable leaving to the right-rear lane.
  const lane = {lane: 'right-rear', ru: 25};
  const {rack, ctx} = scene({face: 'rear', ring: {x: 0, g: {run: 'x', depth: 6.8}}, port: {x: -150, y: ringY - 20}, lane});
  const marks = ringMarks(rack, rack.cables[0], ctx);
  assert.deepEqual(marks, [{run: 'x', depth: 6.8, sense: 1, back: false}, null]);
  const pts = [{x: -150, y: ringY - 20}, {x: 0, y: ringY}, {x: laneX('right'), y: (25 - 0.5) * RU}].map(p => toPane('rear', p));
  // On the rear pane the cable travels toward -x: from the port at x 375.5 to the lane left of the opening.
  assert.ok(pts[0][0] > pts[1][0] && pts[1][0] > pts[2][0]);
  const [a, w, z] = pts;
  const turned = paneMarks(marks, 'rear');
  assert.equal(turned[0].sense, -1);
  const drawn = routed2d([a, w, z], 4, [null, ...turned, null]);
  assert.equal(hookOf(drawn, 0, -1), 0, `turned: ${drawn}`);
  // The same marks unturned enter the ring by its far face: the hook this removes.
  const hooked = routed2d([a, w, z], 4, [null, ...marks, null]);
  assert.ok(hookOf(hooked, 0, -1) >= 6.8 - 1e-9, `unturned should hook: ${hooked}`);
  // Drawn from its far end (cables.js, a cross-face tag on the other side): orient, then reverse.
  const back = routed2d([z, w, a], 4, [null, ...reverseMarks(turned), null]);
  assert.equal(hookOf(back, 0, +1), 0, `reversed: ${back}`);
});

test('a ring that runs up the rack is drawn through on the front pane, with no hook', () => {
  // A ring along y (as a CMH-6DR1U's end ring is), the port well below it and
  // a little to one side, the cable going up to a lane above.
  const lane = {lane: 'left-front', ru: 30};
  const ring = {x: -262, g: {run: 'y', depth: 10}};
  const {rack, ctx} = scene({face: 'front', ring, port: {x: -250, y: ringY - 150}, lane});
  const marks = ringMarks(rack, rack.cables[0], ctx);
  assert.deepEqual(marks, [{run: 'y', depth: 10, sense: 1, back: false}, null]);
  const pts = [{x: -250, y: ringY - 150}, {x: ring.x, y: ringY}, {x: laneX('left'), y: (30 - 0.5) * RU}].map(p => toPane('front', p));
  const turned = paneMarks(marks, 'front');
  assert.equal(turned[0].sense, -1);
  const drawn = routed2d(pts, 4, [null, ...turned, null]);
  // Up the rack is toward -y on the pane.
  assert.equal(hookOf(drawn, 1, -1), 0, `turned: ${drawn}`);
  const hooked = routed2d(pts, 4, [null, ...marks, null]);
  assert.ok(hookOf(hooked, 1, -1) >= 10 - 1e-9, `unturned should hook: ${hooked}`);
  const back = routed2d([...pts].reverse(), 4, [null, ...reverseMarks(turned), null]);
  assert.equal(hookOf(back, 1, +1), 0, `reversed: ${back}`);
});

test('paneMarks turns y on the front pane and x and y on the rear, and leaves z and lanes alone', () => {
  const m = [{run: 'x', depth: 10, sense: 1, back: false}, {run: 'y', depth: 10, sense: -1, back: false},
             {run: 'z', depth: 10, sense: 1, back: false}, null, {run: 'x', depth: 10}];
  assert.deepEqual(paneMarks(m, 'front').map(x => x?.sense), [1, 1, 1, undefined, undefined]);
  assert.deepEqual(paneMarks(m, 'rear').map(x => x?.sense), [-1, 1, 1, undefined, undefined]);
});
