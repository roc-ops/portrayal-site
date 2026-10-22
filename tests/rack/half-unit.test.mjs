// HALF-UNIT POSITIONS ON THE SITE (rack file version 4, kit 0.22.0). Where a
// body is in the units its item fills is the kit's (rack/fit.js itemBox), and
// so are the rail holes an ear can use (rack/rails.js holesIn). The site keeps
// one small rule of its own over them, which holes an ear is drawn screwed at
// (site/rack/ear-holes.js), and no position code: body-span.js, with its
// "lower half of its unit" rule, is gone.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync, readdirSync} from 'node:fs';
import {earHoles} from '../../site/rack/ear-holes.js';
import {RU, HOLE_DY, holesIn} from '../../vendor/rack/rails.js';
import * as F from '../../vendor/rack/fit.js';
import {newRack} from '../../vendor/rack/model.js';
import * as Q from '../../vendor/rack/queries.js';

const devices = JSON.parse(readFileSync(new URL('../../assets/dist/rack.json', import.meta.url), 'utf8')).devices;
const chassisOf = ref => devices[ref] ?? null;
const item = (id, ref, ru, extra = {}) => ({id, ref, cfg: 'base', label: id, ru, face: 'front', turned: false, swaps: {}, fields: {}, ...extra});
const near = (a, b, what) => assert.ok(Math.abs(a - b) < 1e-9, `${what}: ${a}, expected ${b}`);

test('the site has no body-position module of its own, and none of the retired kit names', () => {
  assert.ok(!existsSync(new URL('../../site/rack/body-span.js', import.meta.url)), 'site/rack/body-span.js is back');
  const dir = new URL('../../site/rack/', import.meta.url);
  const files = [new URL('../../site/rack-page.js', import.meta.url), new URL('../../site/rack3d.js', import.meta.url),
    ...readdirSync(dir).filter(f => f.endsWith('.js')).map(f => new URL(f, dir))];
  for (const url of files) {
    const src = readFileSync(url, 'utf8');
    assert.doesNotMatch(src, /from\s*'[^']*body-span\.js'/, `${url.pathname} imports body-span.js`);
    assert.doesNotMatch(src, /\bbodySpan\(|\bHALF_HOLE\b/, `${url.pathname} still calls the site's own span`);
    // `span`, the closed whole-unit pair, is removed from the kit: spanOf is half-open
    assert.doesNotMatch(src, /import\s*\{[^}]*\bspan\b[^}]*\}\s*from\s*'[^']*vendor\/rack\/fit\.js'/, `${url.pathname} imports span`);
  }
  assert.equal(F.span, undefined);
  for (const f of ['unitsOf', 'itemUnits', 'spanOf', 'itemBox', 'spanText', 'spansMeet']) assert.equal(typeof F[f], 'function', f);
});

test('the library\'s four devices that are no whole number of units, and what the kit makes of each', () => {
  const odd = Object.keys(devices).filter(n => devices[n].ru != null && !Number.isInteger(Number(devices[n].ru))).sort();
  assert.deepEqual(odd, ['cmhookmw', 'mx104', 'tm-7124s', 'xcu']);
  assert.deepEqual(odd.map(n => F.unitsOf(devices[n])), [1.5, 3.5, 1.5, 0.5]);
  assert.ok(Object.keys(devices).length > 200, 'the catalogue was read');
});

test('two half-unit panels in one unit: each centred in its own half, one hole each, and the unit\'s two outer holes between them', () => {
  const rack = {...newRack(), items: [item('lo', 'xcu', 12), item('hi', 'xcu', 12.5)]};
  const [a, b] = rack.items.map(i => F.itemBox(rack, i, chassisOf));
  near(a.lo, 11 * RU, 'lower half starts at the bottom of U12');
  near(a.hi, 11.5 * RU, 'and ends at its middle');
  near(b.lo, 11.5 * RU, 'upper half starts at the middle');
  near(b.hi, 12 * RU, 'and ends at the top of U12');
  for (const box of [a, b]) {
    near((box.y0 + box.y1) / 2, (box.lo + box.hi) / 2, 'the body is centred in its half');
    near(box.h, 22.2, 'at the catalogue height');
    assert.ok(box.y0 >= box.lo && box.y1 <= box.hi, 'inside its half');
  }
  assert.ok(a.y1 <= b.y0, 'the two bodies do not overlap');
  const ha = earHoles(a.lo, a.hi), hb = earHoles(b.lo, b.hi);
  assert.equal(ha.length, 1);
  assert.equal(hb.length, 1);
  near(ha[0], 11 * RU + HOLE_DY[0], 'the lower half meets the unit\'s first hole');
  near(hb[0], 11 * RU + HOLE_DY[2], 'the upper half meets its last');
  // both fit, and a third is refused in either half with the kit's "Taken by"
  for (const i of rack.items) assert.deepEqual(F.fits(rack, i, chassisOf, {ignoreId: i.id}), {ok: true});
  assert.equal(F.fits(rack, {ref: 'xcu', face: 'front', ru: 12.5}, chassisOf).reason, 'Taken by hi on the front.');
  assert.equal(F.fits(rack, {ref: 'xcu', face: 'front', ru: 12}, chassisOf).reason, 'Taken by lo on the front.');
  // the two take one unit between them, as the page's summary counts
  assert.equal(F.itemsWithU(rack, chassisOf).reduce((n, i) => n + i.u, 0), 1);
});

test('an ear\'s screws: two a unit for whole units, one for a half, the middle hole empty where both others are in', () => {
  const ys = (lo, hi) => earHoles(lo * RU, hi * RU).map(y => Math.round(y * 100) / 100);
  assert.deepEqual(ys(0, 1), [6.35, 38.1]);
  assert.deepEqual(ys(0, 2), [6.35, 38.1, 50.8, 82.55]);
  assert.deepEqual(ys(0, 0.5), [6.35]);
  assert.deepEqual(ys(0.5, 1), [38.1]);
  assert.deepEqual(ys(0, 1.5), [6.35, 38.1, 50.8]);        // a 1.5U device at a whole unit: 3 an ear, the 6 the BOM counts
  assert.deepEqual(ys(0.5, 2), [38.1, 50.8, 82.55]);       // and started on a half
  // every screw is a hole the kit gives that span, and over the whole catalogue an ear has 2 x units of them
  for (const [name, c] of Object.entries(devices)) {
    const u = F.unitsOf(c);
    for (const ru of Number.isInteger(u) ? [1, 7] : [1, 7, 7.5]) {
      const box = F.itemBox(null, item('x', name, ru), chassisOf), got = earHoles(box.lo, box.hi);
      assert.equal(got.length, 2 * u, `${name} at ${ru}: ${got.length} screws an ear for ${u}U`);
      for (const y of got) assert.ok(holesIn(box.lo, box.hi).includes(y), `${name}: ${y} is not a hole of its span`);
    }
  }
});

test('the kit refuses a whole-unit device on a half, in a sentence, and offers halves only to a device that may start on one', () => {
  const rack = newRack();
  const no = F.fits(rack, {ref: 'as7726-32x', face: 'front', ru: 12.5}, chassisOf);
  assert.equal(no.ok, false);
  assert.match(no.reason, /is 1U; its ears meet the rail holes only at a whole unit, and U12\.5 is a half unit\.$/);
  assert.deepEqual(F.fits(rack, {ref: 'xcu', face: 'front', ru: 12.5}, chassisOf), {ok: true});
  const free = ref => Q.freeUs(rack, {ref, face: 'front'}, {chassisOf});
  assert.ok(free('as7726-32x').every(Number.isInteger));
  assert.ok(free('xcu').includes(12.5) && free('xcu').includes(12));
  // a 1.5U device: the unit its top half is in is no longer offered to a 1U device
  const r15 = {...rack, items: [item('t', 'tm-7124s', 10)]};
  assert.match(F.fits(r15, {ref: 'as7726-32x', face: 'front', ru: 11}, chassisOf).reason, /^Taken by t/);
  assert.deepEqual(F.fits(r15, {ref: 'xcu', face: 'front', ru: 11.5}, chassisOf), {ok: true});
  assert.deepEqual(F.spanOf(r15.items[0], chassisOf), [10, 11.5]);
});
