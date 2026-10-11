import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {bodySpan, HALF_HOLE} from '../../site/rack/body-span.js';
import {RU, HOLE_DY} from '../../vendor/rack/rails.js';

const devices = JSON.parse(readFileSync(new URL('../../assets/dist/rack.json', import.meta.url), 'utf8')).devices;
// The units an item takes, as the fit rules give them (fit.js heightOf).
const unitsOf = c => Math.max(1, c.ru ?? 1);

test('over the whole catalogue, nothing but a body under one unit moves, in either view', () => {
  const moved = [];
  for (const [name, c] of Object.entries(devices)) {
    const u = unitsOf(c), h = c.h ?? RU;
    const flat = bodySpan(c.ru, u, h), stood = bodySpan(c.ru, u, h, true);
    // what each view did before there was a body span: 2D centred in u x RU, 3D on the bottom
    const was2d = (u * RU - h) / 2, was3d = 0;
    if (flat.units === u && flat.span === u * RU && flat.inset === was2d && stood.inset === was3d && !flat.half && !stood.half) continue;
    moved.push(name);
  }
  assert.ok(Object.keys(devices).length > 200, 'the catalogue was read');
  assert.deepEqual(moved, Object.keys(devices).filter(n => devices[n].ru < 1));
  assert.deepEqual(moved, ['xcu'], 'the one body under a unit in the library today');
});

test('a body of one unit or more is bit for bit where it was: 2D centred in its span, 3D standing on the bottom', () => {
  for (const [ru, h] of [[1, 43.6], [2, 88.1], [3.5, 154.7], [1.5, 66.3], [undefined, 44], [null, 44.45], [10, 440]]) {
    const u = Math.max(1, ru ?? 1);
    assert.deepEqual(bodySpan(ru, u, h), {units: u, span: u * RU, inset: (u * RU - h) / 2, half: false});
    assert.deepEqual(bodySpan(ru, u, h, true), {units: u, span: u * RU, inset: 0, half: false});
  }
});

test('a half-unit body is in the lower half of its unit, the same in both views, with one hole inside it', () => {
  const c = devices.xcu;
  const flat = bodySpan(c.ru, 1, c.h), stood = bodySpan(c.ru, 1, c.h, true);
  assert.deepEqual(flat, stood);
  assert.equal(flat.half, true);
  assert.equal(flat.span, RU / 2);
  assert.ok(Math.abs(flat.inset - (RU / 2 - 22.2) / 2) < 1e-12);
  const [bottom, top] = [flat.inset, flat.inset + c.h];
  assert.ok(bottom >= 0 && top <= RU / 2 + 1e-9, 'the body is inside the lower half');
  assert.deepEqual(HOLE_DY.filter(dy => dy > bottom && dy < top), [HOLE_DY[HALF_HOLE]], 'one rail hole meets it');
  assert.equal(HOLE_DY[HALF_HOLE], 6.35);
});
