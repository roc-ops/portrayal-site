// tests/rack/ear-flange.test.mjs
// The flange of a generic ear runs from the face's edge to the rail hole and
// EAR_OVERHANG past it (#176), one answer for the 2D and the 3D rack.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {earFlange, EAR_OVERHANG} from '../../site/rack/ear-holes.js';
import {SIDES} from '../../vendor/rack/rails.js';

const hole = Math.abs(SIDES[1].hole);

test('a narrow face gets a flange from its edge to past the rail hole', () => {
  const f = earFlange(110.5, hole);
  assert.equal(f.inner, 110.5);
  assert.equal(f.outer, hole + EAR_OVERHANG);
  assert.equal(f.width, f.outer - 110.5);
  assert.equal(f.centre, (110.5 + f.outer) / 2);
  assert.ok(f.inner < hole && hole < f.outer);
});

test('the screw head lies wholly inside the flange', () => {
  for (const halfW of [110.5, 150, 215.65, 225]) {
    const f = earFlange(halfW, hole);
    assert.ok(hole - 2.6 >= f.inner && hole + 2.6 <= f.outer, `halfW ${halfW}`);
  }
});

test('a face that already reaches the hole has no flange', () => {
  assert.equal(earFlange(hole + EAR_OVERHANG, hole), null);
  assert.equal(earFlange(241.3, hole), null);
});

test('2D and 3D share the constant and the flange', () => {
  const el = readFileSync(new URL('../../site/rack/elevation.js', import.meta.url), 'utf8');
  assert.match(el, /import\s*\{[^}]*EAR_OVERHANG[^}]*\}\s*from\s*'\.\/ear-holes\.js'/);
  assert.doesNotMatch(el, /const EAR_OVERHANG =/);
  const r3 = readFileSync(new URL('../../site/rack3d.js', import.meta.url), 'utf8');
  assert.match(r3, /earFlange/);
  assert.doesNotMatch(r3, /BoxGeometry\(24,/);
});
