// tests/rack/one-way-in.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';

// ONE WAY IN (spec §5.1): nothing that draws the page edits the rack except
// through the editor's commands. The reducers are the commands' to call.
const REDUCERS = ['withItem', 'updateItem', 'withoutItem', 'withFrame', 'renamed', 'withDcim', 'detached', 'withCable',
                  'updateCable', 'withoutCable', 'withoutCablesOf', 'moveItem', 'shrinkRack', 'withRoutedLengths'];
// The core may call them; drag.js may call moveItem for its PREVIEW only (the drop is a move command).
// The core is the kit's now (vendor/rack/); history.js and validate.js stay
// in site/rack/ only as re-exports of it.
const CORE = new Set(['history.js', 'validate.js']);
const ALLOWED = {'drag.js': ['moveItem']};

test('the page and the UI modules import no reducer', () => {
  const files = [['rack-page.js', new URL('../../site/rack-page.js', import.meta.url)],
    ...readdirSync(new URL('../../site/rack/', import.meta.url)).filter(f => f.endsWith('.js') && !CORE.has(f))
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
