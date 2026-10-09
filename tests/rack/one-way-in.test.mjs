// tests/rack/one-way-in.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';

// ONE WAY IN (spec §5.1): nothing that draws the page edits the rack except
// through the editor's commands. The reducers are the commands' to call.
const REDUCERS = ['withItem', 'updateItem', 'withoutItem', 'withFrame', 'renamed', 'withDcim', 'detached', 'withCable',
                  'updateCable', 'withoutCable', 'withoutCablesOf', 'moveItem', 'shrinkRack', 'withRoutedLengths'];
// The core may call them; drag.js may call moveItem for its PREVIEW only (the drop is a move command).
// The core is the kit's (vendor/rack/), zero-U parts and narrow parts on one rail
// included since kit 0.6.0 (#926): the site keeps no commands of its own.
const ALLOWED = {'drag.js': ['moveItem']};

test('the page and the UI modules import no reducer', () => {
  const files = [['rack-page.js', new URL('../../site/rack-page.js', import.meta.url)],
    ...readdirSync(new URL('../../site/rack/', import.meta.url)).filter(f => f.endsWith('.js'))
      .map(f => [f, new URL(`../../site/rack/${f}`, import.meta.url)])];
  for (const [name, url] of files) {
    const src = readFileSync(url, 'utf8');
    const imported = [...src.matchAll(/import\s*\{([^}]*)\}\s*from/g)].flatMap(m => m[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0]));
    // A namespace import reaches them too: import * as X from './model.js', then X.withItem(...).
    const spaces = [...src.matchAll(/import\s*\*\s*as\s+(\w+)\s+from/g)].map(m => m[1]);
    const dotted = spaces.flatMap(ns => [...src.matchAll(new RegExp(`\\b${ns}\\.(\\w+)`, 'g'))].map(m => m[1]));
    const bad = [...new Set([...imported, ...dotted])].filter(n => REDUCERS.includes(n) && !(ALLOWED[name] || []).includes(n));
    assert.deepEqual(bad, [], `${name} imports ${bad.join(', ')}`);
  }
});

// NO SITE COMMAND LAYER (kit 0.6.0, #926): zerou.* and side.* are the kit's,
// so the page runs the kit's editor as it is and nothing here wraps it or keeps
// a command table of its own.
test('the page runs the kit\'s editor directly, with no site command layer', () => {
  const dir = new URL('../../site/rack/', import.meta.url);
  const files = [['rack-page.js', new URL('../../site/rack-page.js', import.meta.url)],
    ...readdirSync(dir).filter(f => f.endsWith('.js')).map(f => [f, new URL(f, dir)])];
  assert.ok(!files.some(([name]) => name === 'zero-u.js'), 'site/rack/zero-u.js is back');
  for (const [name, url] of files) {
    const src = readFileSync(url, 'utf8');
    assert.doesNotMatch(src, /from\s*'\.\/(?:rack\/)?zero-u\.js'/, `${name} imports a site zero-u.js`);
    assert.doesNotMatch(src, /\b(?:withZeroUEditor|applySite|needsSite|keepSiteFields|ZERO_U_COMMANDS|ALL_COMMANDS|zeroUFill)\b/,
      `${name} still names the site's zero-U command layer`);
  }
  const page = readFileSync(files[0][1], 'utf8');
  assert.match(page, /\bed = createRackEditor\(\{doc, chassisOf\}\);/, 'the page does not run the kit\'s editor as it is');
});
