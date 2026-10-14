import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {STRAP_PAINT, STRAP_PAINT_2D, strapPaint, STRAP_MIN_PX, STAGE_SWATCHES, stageTone} from '../../site/rack/stage.js';
import {COLORS, JACKETS} from '../../vendor/rack/cable-geometry.js';
import {STRAP_DRAWN} from '../../site/rack/bundle-view.js';

const rgb = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16) / 255);
const lum = c => rgb(c).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
const cableColours = [...new Set([...Object.values(COLORS).flatMap(v => (typeof v === 'string' ? [v] : Object.values(v))), ...Object.values(JACKETS)])];

test('a strap contrasts with every stage the reader can pick', () => {
  for (const [stage, name] of STAGE_SWATCHES) {
    const p = strapPaint(stage);
    assert.equal(p, STRAP_PAINT[stageTone(stage)]);
    assert.ok(contrast(p.core, stage) >= 7, `a strap on the ${name} stage is ${contrast(p.core, stage).toFixed(1)} to 1`);
    // and its rim is the other tone, so its edge is drawn against the strap itself
    assert.ok(contrast(p.core, p.rim) >= 12);
  }
  // what it was: #24282d on the black stage
  assert.ok(contrast('#24282d', '#101214') < 1.5);
});

test('a strap stands off every cable colour: its core or its rim is at least 3 to 1 against each', () => {
  assert.ok(cableColours.length >= 7, 'the cable colours were read');
  for (const p of Object.values(STRAP_PAINT))
    for (const c of cableColours)
      assert.ok(Math.max(contrast(p.core, c), contrast(p.rim, c)) >= 3, `${p.core}/${p.rim} on a ${c} cable`);
});

test('the page paints a strap in the quiet 2D pairs: muted, seen, and no white or high-contrast outline', () => {
  const css = readFileSync(new URL('../../site/rack/rack.css', import.meta.url), 'utf8');
  for (const [tone, p] of Object.entries(STRAP_PAINT_2D)) {
    assert.ok(css.includes(`.rk-panes[data-stage="${tone}"] [data-strap] [data-strap-part="core"] { stroke: ${p.core}; }`), `${tone} core`);
    assert.ok(css.includes(`.rk-panes[data-stage="${tone}"] [data-strap] [data-strap-part="rim"] { stroke: ${p.rim}; }`), `${tone} rim`);
    const stage = tone === 'dark' ? '#101214' : '#ffffff';
    assert.ok(contrast(p.core, stage) >= 4.5 && contrast(p.core, stage) < 8, `${tone} core ${contrast(p.core, stage).toFixed(1)} to 1`);
    assert.notEqual(p.rim.toLowerCase(), '#ffffff');
    assert.ok(contrast(p.rim, p.core) <= 5 && contrast(p.rim, stage) <= 2, `${tone} rim is muted`);
  }
  // a sheet and a file keep the paper's black and white
  assert.deepEqual(STRAP_PAINT.light, {core: '#1b1d20', rim: '#ffffff'});
  assert.ok(STRAP_MIN_PX >= 6 && STRAP_DRAWN === 10);
  // nothing dims the straps' layer with a selected cable any more
  assert.ok(!/\.cable-focus[^{]*\[data-bundle-straps\]/.test(css));
});
