// tests/annotate/one-way-in.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// ONE WAY IN (spec §2.3): the page edits the document only through the editor.
// Reads of `doc` are fine; an assignment to it, or to a mark in it, is not.
test('annotate.html never writes the document directly', () => {
  const src = readFileSync(new URL('../../annotate.html', import.meta.url), 'utf8');
  const bad = [
    ...src.matchAll(/\bdoc\.(marks|crop|legend|device|config|view|swaps|fields)\s*=[^=]/g),
    ...src.matchAll(/\bdoc\.marks\.(push|splice|pop|shift|unshift|sort|reverse)\s*\(/g),
    ...src.matchAll(/\bdoc\.marks\[[^\]]+\]\s*(\.\w+\s*)?=[^=]/g),
    ...src.matchAll(/\bm\.(select|label|color|lamp|state)\s*=[^=]/g),
  ].map(m => m[0]);
  assert.deepEqual(bad, []);
});
