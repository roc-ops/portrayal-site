// tests/rack/side-view.test.mjs
// The side pair's numbers (portrayal-site#187; site/rack/side-geometry.js):
// where a body is in depth, which of its drawings a pane shows, how the two
// panes mirror each other, and how a cable's points fall on a pane.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {itemDepth, zeroUDepth, shownSide, sideBox, drawingX, sideX, sideY, project, projectedPath, paintOrder, onNearSide,
        nearness, postsOf, depthExtent, paneSpanX, packedPoints, strapBar, POST_D, FRONT_ROOM, SIDE_PAD} from '../../site/rack/side-geometry.js';
import {solidsOf} from '../../vendor/rack/solids.js';
import {isZeroUPart, isNarrow} from '../../vendor/rack/fit.js';
import {normalizeFrame} from '../../vendor/rack/model.js';
import {RU} from '../../vendor/rack/rails.js';

const devices = JSON.parse(readFileSync(new URL('../../assets/dist/rack.json', import.meta.url), 'utf8')).devices;
const chassisOf = ref => devices[ref] ?? null;
const four = normalizeFrame({kind: 'four-post', heightRU: 42}), two = normalizeFrame({kind: 'two-post', heightRU: 42});
const rackOf = (frame, items = [], zeroU = []) => ({frame, items, zeroU, cables: []});
const close = (a, b, what) => assert.ok(Math.abs(a - b) < 1e-9, `${what}: ${a} is not ${b}`);
// the extent of every solid the kit places for one id
const kitBox = (rack, id) => {
  const list = solidsOf(rack, {chassisOf}).filter(s => s.item === id);
  if (!list.length) return null;
  const lo = k => Math.min(...list.map(s => s.box[k])), hi = k => Math.max(...list.map(s => s.box[k]));
  return {x0: lo('x0'), x1: hi('x1'), y0: lo('y0'), y1: hi('y1'), z0: lo('z0'), z1: hi('z1'), n: list.length, envelope: list.length === 1 && list[0].part === 'envelope'};
};

test('a device is in depth exactly where the kit places its envelope: front, rear, turned, on a four-post and a two-post', () => {
  let seen = 0;
  const refs = Object.keys(devices).filter(n => !isZeroUPart(devices[n]) && devices[n].mount !== 'rack-face' && devices[n].d > 0 && devices[n].w > 0 && devices[n].h > 0);
  assert.ok(refs.length > 150, `the catalogue was read (${refs.length} box devices)`);
  for (const ref of refs) for (const frame of [four, two]) for (const face of ['front', 'rear']) for (const turned of [false, true]) {
    const it = {id: 'i1', ref, ru: 10, face, turned}, rack = rackOf(frame, [it]);
    const kit = kitBox(rack, 'i1'), mine = itemDepth(rack, it, devices[ref]);
    if (!kit?.envelope) continue;       // a body with plates of its own is held below
    seen++;
    for (const k of ['z0', 'z1', 'x0', 'x1']) close(mine[k], kit[k], `${ref} ${frame.kind} ${face}${turned ? ' turned' : ''} ${k}`);
    // its own front is on its rail plane unless it is turned, and it looks out of the face it is on unless turned
    assert.equal(mine.outward, (face === 'rear') === turned ? 1 : -1);
    close(mine.zFront, mine.outward === 1 ? mine.z1 : mine.z0, `${ref} front end`);
  }
  assert.ok(seen > 1000, `only ${seen} placings were compared`);
});

// A sheet part's plates are derived from its faces (rack_solids.py) and can stand a plate's
// thickness past the catalogue's envelope: the FS lacer's back plate is 1.5 mm behind its rail plane.
const PLATE = 3;
test('a rack-face part and a part beside the rack are inside the envelope placed here, and fill it in depth where the kit gives an envelope', () => {
  let faces = 0, sides = 0, narrow = 0;
  for (const [ref, c] of Object.entries(devices)) {
    if (!(c.d > 0 && c.w > 0 && c.h > 0)) continue;
    if (c.mount === 'rack-face') for (const face of ['front', 'rear']) for (const side of isNarrow(c) ? ['left', 'right'] : [undefined]) {
      const it = {id: 'm1', ref, ru: 12, face, turned: false, ...(side ? {side} : {})}, rack = rackOf(four, [it]);
      const kit = kitBox(rack, 'm1'), mine = itemDepth(rack, it, c);
      // the body stands out from its rail plane, away from the rack
      close(face === 'front' ? mine.z0 : mine.z1, face === 'front' ? 0 : -four.railDepth, `${ref} ${face} rail plane`);
      assert.equal(mine.flip, side === 'right', `${ref} ${side}: turned end over end only on the right rail`);
      if (side) narrow++;
      if (!kit) continue;
      faces++;
      for (const [lo, hi] of [['z0', 'z1'], ['x0', 'x1']])
        assert.ok(kit[lo] >= mine[lo] - PLATE && kit[hi] <= mine[hi] + PLATE, `${ref} ${face} ${side ?? ''}: the kit's ${lo}..${hi} ${kit[lo]}..${kit[hi]} is outside ${mine[lo]}..${mine[hi]}`);
    }
    if (isZeroUPart(c)) for (const at of ['left-front', 'right-front', 'left-rear', 'right-rear']) {
      const z = {id: 'z1', ref, at}, rack = rackOf(four, [], [z]);
      const kit = kitBox(rack, 'z1'), mine = zeroUDepth(rack, z, c);
      // centred on its upright's depth
      close((mine.z0 + mine.z1) / 2, at.endsWith('rear') ? -four.railDepth + POST_D / 2 : -POST_D / 2, `${ref} ${at} centre`);
      assert.equal(mine.outward, at.endsWith('rear') ? -1 : 1);
      if (!kit) continue;
      sides++;
      for (const [lo, hi] of [['z0', 'z1'], ['x0', 'x1']])
        assert.ok(kit[lo] >= mine[lo] - PLATE && kit[hi] <= mine[hi] + PLATE, `${ref} ${at}: the kit's ${lo}..${hi} is outside the envelope`);
      if (kit.envelope) for (const k of ['z0', 'z1', 'x0', 'x1']) close(mine[k], kit[k], `${ref} ${at} ${k}`);
      if (kit.envelope) close(mine.y0, kit.y0, `${ref} ${at} bottom`);
      else assert.ok(kit.y0 >= mine.y0 - PLATE, `${ref} ${at}: the kit's plates start below the part`);
    }
  }
  assert.ok(faces >= 6 && sides >= 8, `compared ${faces} rack-face and ${sides} beside-the-rack placings`);
  assert.ok(narrow >= 2, 'a narrow part on each rail was placed');
});

test('a pane shows a part its own side on that side, or its other side when it looks out of the back; a part on the right rail is turned in the pane', () => {
  assert.deepEqual(shownSide('left', {outward: 1, flip: false}), {view: 'left', turn: false});
  assert.deepEqual(shownSide('right', {outward: 1, flip: false}), {view: 'right', turn: false});
  assert.deepEqual(shownSide('left', {outward: -1, flip: false}), {view: 'right', turn: false});
  assert.deepEqual(shownSide('right', {outward: -1, flip: false}), {view: 'left', turn: false});
  assert.deepEqual(shownSide('left', {outward: 1, flip: true}), {view: 'right', turn: true});
  assert.deepEqual(shownSide('right', {outward: -1, flip: true}), {view: 'right', turn: true});
});

test('the right pane has the front at its left and the left pane at its right: mirror images in depth, one scale in height', () => {
  assert.equal(sideX('right', -100), 100);
  assert.equal(sideX('left', -100), -100);
  assert.equal(sideY(four, 0), 42 * RU);
  assert.equal(sideY(four, 42 * RU), 0);
  const p = {x: 37, y: 500, z: -250};
  assert.deepEqual(project('right', four, p), [250, 42 * RU - 500]);
  assert.deepEqual(project('left', four, p), [-250, 42 * RU - 500]);
  // x plays no part
  assert.deepEqual(project('left', four, {...p, x: -400}), project('left', four, p));
  const ext = depthExtent(four), L = paneSpanX('left', ext), R = paneSpanX('right', ext);
  assert.equal(L.w, R.w);
  close(L.x, -(R.x + R.w), 'mirrored boxes');
  assert.deepEqual(ext, [-four.usableDepth - SIDE_PAD, FRONT_ROOM + SIDE_PAD]);
  // a body that stands out past either end widens it
  assert.deepEqual(depthExtent(four, [{z0: -1500, z1: 300}]), [-1500 - SIDE_PAD, 300 + SIDE_PAD]);
});

test('a body\'s box and its drawing are mirror placements in the two panes, with its front on its own front', () => {
  const c = devices.dcs500;
  for (const [face, turned] of [['front', false], ['rear', false], ['front', true], ['rear', true]]) {
    const it = {id: 'i1', ref: 'dcs500', ru: 5, face, turned}, span = itemDepth(rackOf(four, [it]), it, c);
    const L = sideBox('left', four, span, 4 * RU, c.h), R = sideBox('right', four, span, 4 * RU, c.h);
    close(L.w, c.d, 'depth'); close(R.w, c.d, 'depth');
    close(L.x, -(R.x + R.w), `${face} ${turned}: mirrored`);
    assert.deepEqual([L.y, L.h], [R.y, R.h]);
    close(L.y, 42 * RU - 4 * RU - c.h, 'top');
    for (const pane of ['left', 'right']) {
      const {view} = shownSide(pane, span), x = drawingX(pane, span, view, c.d), b = pane === 'left' ? L : R;
      // a drawing as deep as the body fills the box
      close(x, b.x, `${pane} ${face} ${turned}: the drawing starts at the box`);
      // the drawing's own front (x = 0 of a right view, x = width of a left one) is at the body's front
      close(view === 'right' ? x : x + c.d, sideX(pane, span.zFront), `${pane} ${face} ${turned}: front on front`);
      // and a drawing that is not as deep as the catalogue says keeps its front there
      const x2 = drawingX(pane, span, view, c.d + 20);
      close(view === 'right' ? x2 : x2 + c.d + 20, sideX(pane, span.zFront), 'a deeper drawing');
    }
  }
  // front-mounted: front rail plane at the right pane's 0, running back
  const front = itemDepth(rackOf(four), {face: 'front', ru: 1}, c);
  assert.deepEqual([sideBox('right', four, front, 0, c.h).x, sideBox('left', four, front, 0, c.h).x], [0, -c.d]);
  // rear-mounted: against the rear rail plane, running forward
  const rear = itemDepth(rackOf(four), {face: 'rear', ru: 1}, c);
  assert.deepEqual([sideBox('right', four, rear, 0, c.h).x, sideBox('left', four, rear, 0, c.h).x], [four.railDepth - c.d, -four.railDepth]);
});

test('nearer bodies are painted after farther ones, from the side each pane is looked at', () => {
  const far = {id: 'far', span: {x0: 240, x1: 330}}, mid = {id: 'mid', span: {x0: -219, x1: 219}},
        wide = {id: 'wide', span: {x0: -241, x1: 241}}, near = {id: 'near', span: {x0: -330, x1: -240}};
  assert.deepEqual(paintOrder('left', [near, wide, mid, far]).map(b => b.id), ['far', 'mid', 'wide', 'near']);
  assert.deepEqual(paintOrder('right', [near, wide, mid, far]).map(b => b.id), ['near', 'mid', 'wide', 'far']);
  // equals keep their order
  const a = {id: 'a', span: {x0: -219, x1: 219}};
  assert.deepEqual(paintOrder('left', [mid, a]).map(b => b.id), ['mid', 'a']);
  assert.ok(nearness('left', near.span) > nearness('left', far.span));
  assert.deepEqual([onNearSide('left', near.span), onNearSide('left', far.span), onNearSide('right', far.span), onNearSide('right', near.span)], [true, false, true, false]);
});

test('the posts stand behind their mounting faces: a pair at each rail plane of a four-post, one pair on a two-post', () => {
  assert.deepEqual(postsOf(four), [{at: 'front', z0: -POST_D, z1: 0}, {at: 'rear', z0: -four.railDepth, z1: -four.railDepth + POST_D}]);
  assert.deepEqual(postsOf(two), [{at: 'front', z0: -POST_D, z1: 0}]);
});

test('a cable is drawn through the kit\'s points as they are: a run across the rack is seen end on, and nothing is added', () => {
  const pts = [{x: -100, y: 1700, z: 0}, {x: -100, y: 1700, z: 28}, {x: -250, y: 1700, z: 28}, {x: -250, y: 900, z: 28},
               {x: -250, y: 900, z: -740}, {x: 100, y: 900, z: -740}];
  const R = projectedPath('right', four, pts), L = projectedPath('left', four, pts);
  // the run along x (the third point) and the last one fall on their neighbours
  assert.equal(R.points.length, 4);
  assert.equal(R.d, `M0 ${n(42 * RU - 1700)} L-28 ${n(42 * RU - 1700)} L-28 ${n(42 * RU - 900)} L740 ${n(42 * RU - 900)}`);
  assert.deepEqual(L.points.map(q => [0 - q[0], q[1]]), R.points);
  // front to rear: the path reaches from in front of the front rail to the rear rail plane
  assert.deepEqual([Math.min(...R.points.map(q => q[0])), Math.max(...R.points.map(q => q[0]))], [-28, four.railDepth]);
  // a patch between two ports of one face stays in front of that face
  const patch = projectedPath('right', four, [{x: -100, y: 1700, z: 0}, {x: -100, y: 1700, z: 28}, {x: 60, y: 1650, z: 28}, {x: 60, y: 1650, z: 0}]);
  assert.ok(patch.points.every(q => q[0] <= 0 && q[0] >= -28));
  // seen end on along its whole length it is still a mark
  assert.equal(projectedPath('left', four, [{x: 0, y: 10, z: 5}, {x: 90, y: 10, z: 5}]).d, `M5 ${n(42 * RU - 10)} L5 ${n(42 * RU - 10)}`);
  assert.equal(projectedPath('left', four, []).d, '');
});
const n = v => Math.round(v * 1000) / 1000;

test('a cable in no bundle keeps the kit\'s points; a member is moved to its place in the pack along its ride and carried across the span between', () => {
  const points = [{x: 0, y: 100, z: 0, at: 'a'}, {x: 0, y: 100, z: 28, at: 'reach', end: 'a'}, {x: -260, y: 111, z: 0, at: 'lane'},
                  {x: -260, y: 300, z: -5, at: 'rest'}, {x: -260, y: 511, z: 0, at: 'lane'}, {x: 0, y: 520, z: 28, at: 'reach', end: 'b'}, {x: 0, y: 520, z: 0, at: 'b'}];
  assert.deepEqual(packedPoints('c1', points, [], null, null), points.map(({x, y, z}) => ({x, y, z})));
  const ws = [{lane: 'left-front', ru: 3}, {lane: 'left-front', ru: 12}];
  const lay = {indexOf: w => ws.indexOf(w), pack: (id, i) => (i === 0 ? {x: 2, y: 0, z: 4} : {x: 2, y: 0, z: -6}), at: () => ({diameter: 12})};
  const got = packedPoints('c1', points, ws, {stretch: [0, 1]}, lay);
  assert.deepEqual(got[2], {x: -258, y: 111, z: 4});
  assert.deepEqual(got[4], {x: -258, y: 511, z: -6});
  // the kit's point between them is moved half way between what its two stops were
  assert.deepEqual(got[3], {x: -258, y: 300, z: -5 + (4 - 6) / 2});
  // the ends are not on the trunk and stay
  assert.deepEqual([got[0], got[1], got[5], got[6]], [points[0], points[1], points[5], points[6]].map(({x, y, z}) => ({x, y, z})));
  // outside its stretch nothing moves
  assert.deepEqual(packedPoints('c1', points, ws, {stretch: [1, 1]}, lay)[2], {x: -260, y: 111, z: 0});
});

test('a strap is a bar across the run where it is, and a run seen end on has none', () => {
  const bar = strapBar([0, 0], [0, 100], 0.25, 8);
  assert.deepEqual(bar.at, [0, 25]);
  assert.deepEqual([Math.abs(bar.x1), Math.abs(bar.x2), bar.y1, bar.y2], [8, 8, 25, 25]);
  const tilted = strapBar([0, 0], [30, 40], 0.5, 5);
  // perpendicular to the run, 2 x half long
  close((tilted.x2 - tilted.x1) * 30 + (tilted.y2 - tilted.y1) * 40, 0, 'across');
  close(Math.hypot(tilted.x2 - tilted.x1, tilted.y2 - tilted.y1), 10, 'length');
  assert.equal(strapBar([5, 5], [5, 5], 0.5, 8), null);
});
