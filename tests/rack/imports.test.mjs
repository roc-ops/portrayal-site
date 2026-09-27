import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';

const ROOT = new URL('../../', import.meta.url);
const read = p => readFileSync(new URL(p, ROOT), 'utf8');

test('svg-export.js is a leaf: it loads with no DOM at all', async () => {
  const S = await import('../../site/svg-export.js');
  assert.equal(typeof S.save, 'function');
  assert.equal(typeof S.standalone, 'function');
  assert.equal(typeof S.saveSvg, 'function');
});

test('no tool-page module imports the showcase artifact', () => {
  const files = ['site/rack-page.js', 'site/svg-export.js',
    ...readdirSync(new URL('site/rack/', ROOT)).filter(f => f.endsWith('.js')).map(f => `site/rack/${f}`)];
  for (const f of files) assert.doesNotMatch(read(f), /showcase\/artifact\.js/, `${f} imports artifact.js`);
});
