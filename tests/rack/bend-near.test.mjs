// tests/rack/bend-near.test.mjs
// S-0049: a corner's arc is kept out of the bodies near it only (bend3d.js
// insideOf `near`, clearCurve), and the answer is the one the whole list
// gives: the same corners, the same radii, the same first body hit.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../../vendor/three/three.module.js';
import {clearCurve, kitRoute, insideOf} from '../../site/rack/bend3d.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
// a small fixed generator, so a failure is the same failure on every run
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}
const read = curve => JSON.stringify({len: curve.getLength(), corners: curve.corners.map(c => ({...c, at: c.at.toArray(),
  hit: c.hit ? c.hit.toArray() : c.hit}))});
// the whole list, as clearCurve tested it before `near`: a plain function
const whole = boxes => { const inside = insideOf(boxes); return q => inside(q); };

test('insideOf near: only the boxes reaching into the cube, in their own order', () => {
  const boxes = [{ref: 'a', box: new THREE.Box3(V(0, 0, 0), V(10, 10, 10))}, {ref: 'b', box: new THREE.Box3(V(5, 5, 5), V(30, 30, 30))},
                 {ref: 'c', box: new THREE.Box3(V(100, 0, 0), V(110, 10, 10))}];
  const near = insideOf(boxes).near(V(8, 8, 8), 3);
  assert.equal(near(V(8, 8, 8)).ref, 'a', 'the first box in the list that holds the point answers, as before');
  assert.equal(near(V(105, 5, 5)), null, 'a box outside the cube is not tested');
  assert.equal(insideOf(boxes)(V(105, 5, 5)).ref, 'c');
});

test('clearCurve against the bodies near each corner answers as against all of them', () => {
  const rand = rng(49);
  let corners = 0, body = 0;
  for (let n = 0; n < 300; n++) {
    // a run of five to eight points through a rack-sized room, crowded with bodies of every size
    const pts = Array.from({length: 5 + Math.floor(rand() * 4)}, () => V(rand() * 600 - 300, rand() * 1800, rand() * 800 - 600));
    const boxes = Array.from({length: 40 + Math.floor(rand() * 120)}, (_, k) => {
      const c = pts[Math.floor(rand() * pts.length)].clone().add(V(rand() * 160 - 80, rand() * 160 - 80, rand() * 160 - 80));
      const h = V(1 + rand() * 60, 1 + rand() * 60, 1 + rand() * 60);
      return {ref: `b${k}`, box: new THREE.Box3(c.clone().sub(h), c.clone().add(h))};
    });
    const R = [10, 25, 30, 50, 80][n % 5];
    const old = clearCurve(THREE, pts, R, whole(boxes)), now = clearCurve(THREE, pts, R, insideOf(boxes));
    assert.equal(read(now), read(old), `run ${n}: the corners differ`);
    corners += old.corners.length;
    body += old.corners.filter(c => c.why === 'body').length;
  }
  // (the runs did meet bodies: the comparison is of corners drawn tighter, not only of clear ones)
  assert.ok(body > 50, `only ${body} of ${corners} corners met a body`);
});

test('kitRoute against the bodies near each corner answers as against all of them', () => {
  const rand = rng(1049);
  for (let n = 0; n < 100; n++) {
    const A = {points: [V(-100 + rand() * 50, 400 + rand() * 900, 11)], normal: V(0, 0, 1)};
    const B = {points: [V(100 + rand() * 50, 400 + rand() * 900, 11)], normal: V(0, 0, 1)};
    const mid = [V(-250, A.points[0].y - 20, 60), V(-250, B.points[0].y + 30, 60), V(rand() * 200 - 100, B.points[0].y + 30, 80)];
    const boxes = Array.from({length: 60}, (_, k) => {
      const c = V(rand() * 600 - 300, rand() * 1800, rand() * 200 - 100), h = V(2 + rand() * 40, 2 + rand() * 20, 2 + rand() * 40);
      return {ref: `b${k}`, box: new THREE.Box3(c.clone().sub(h), c.clone().add(h))};
    });
    const old = kitRoute(THREE, A, B, mid, 30, whole(boxes)), now = kitRoute(THREE, A, B, mid, 30, insideOf(boxes));
    assert.equal(read(now.bent), read(old.bent), `run ${n}: the corners differ`);
  }
});
