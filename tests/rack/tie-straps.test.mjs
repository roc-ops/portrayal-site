// THE TIE STRAP OF A SINGLE CABLE (kit 0.22.0, bundles.js anchorsOf) is drawn
// at its tray's tie slot, on the face of the plate the cable is on: above the
// top for a cable resting on it, under the underside for one held under it.
// One mark and one centre for the panes, the side panes and the 3D scene
// (site/rack/bundle-view.js tieMark, tieCentre).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {tieMark, tieCentre, TIE_HALF} from '../../site/rack/bundle-view.js';

const tray = {item: 'cm', via: 'tray', top: 1800, under: 1798.5, run: 'x',
  ties: [{x0: -200, x1: -190, z0: 20, z1: 26}, {x0: 100, x1: 112, z0: 20, z1: 26}]};
const slot = {item: 'cm', via: 'tray', tie: 1, width_mm: 19, bundles: [], cables: ['c1', 'c2']};

test('a resting cable is tied above the plate, a held one under it, at the slot\'s middle', () => {
  const rest = tieMark(slot, tray, {kind: 'tray', item: 'cm', via: 'tray', role: 'resting', face: 'top'});
  assert.deepEqual(rest, {item: 'cm', via: 'tray', tie: 1, width_mm: 19, cables: ['c1', 'c2'], run: 'x', held: false, at: {x: 106, y: 1800, z: 23}});
  const held = tieMark(slot, tray, {kind: 'tray', item: 'cm', via: 'tray', role: 'held', face: 'underside', ties: [1]});
  assert.equal(held.held, true);
  assert.deepEqual(held.at, {x: 106, y: 1798.5, z: 23});
  // the band's middle is half a band off the face, on the cable's side: never inside the plate, never on the other side
  assert.deepEqual(tieCentre(rest), {x: 106, y: 1800 + TIE_HALF, z: 23});
  assert.deepEqual(tieCentre(held), {x: 106, y: 1798.5 - TIE_HALF, z: 23});
  assert.ok(tieCentre(rest).y - TIE_HALF >= tray.top && tieCentre(held).y + TIE_HALF <= tray.under);
  // with no word on how the cable lies, it rests; a slot the tray does not have is no mark
  assert.equal(tieMark(slot, tray, undefined).held, false);
  assert.equal(tieMark({...slot, tie: 7}, tray, null), null);
  assert.equal(tieMark(slot, undefined, null), null);
  assert.notEqual(rest.cables, slot.cables);
});

test('every drawing takes the band\'s middle from tieCentre: none works the face out for itself', () => {
  for (const f of ['cable-view.js', 'side-elevation.js', 'scene3d.js']) {
    const src = readFileSync(new URL(`../../site/rack/${f}`, import.meta.url), 'utf8');
    assert.match(src, /tieCentre\(m\)/, `${f} does not place a tie strap by tieCentre`);
    assert.doesNotMatch(src, /m\.held \? -/, `${f} works out the held side itself`);
  }
  assert.match(readFileSync(new URL('../../site/rack/route-context.js', import.meta.url), 'utf8'), /tieMark\(s, t, rest\)/);
});
