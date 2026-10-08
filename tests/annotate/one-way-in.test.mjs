// tests/annotate/one-way-in.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// ONE WAY IN (spec §2.3): the page edits the document only through the editor.
// Reads of `doc` are fine; an assignment to it, or to a mark in it, is not.
const writes = src => [
  ...src.matchAll(/\bdoc\.(marks|crop|legend|device|config|view|swaps|fields)\s*=[^=]/g),
  ...src.matchAll(/\bdoc\.marks\.(push|splice|pop|shift|unshift|sort|reverse|fill|copyWithin)\s*\(/g),
  ...src.matchAll(/\bdoc\.marks\[[^\]]+\]\s*(\.\w+\s*)?=[^=]/g),
  // a destructuring swap writes through its left-hand pattern: [doc.marks[i], ...] = ...
  ...src.matchAll(/\[[^\]=;]*\bdoc\.marks\[[^\]]+\][^=;]*\]\s*=[^=]/g),
  ...src.matchAll(/\bm\.(select|label|color|lamp|state)\s*=[^=]/g),
  ...src.matchAll(/\bObject\.assign\(\s*doc\b/g),
].map(m => m[0]);

test('the check sees every way the page used to write the document', () => {
  for (const bad of ['doc.crop = null;', 'doc.marks.push(m);', 'doc.marks[i].lamp = \'\';',
                     '[doc.marks[i], doc.marks[j]] = [doc.marks[j], doc.marks[i]];',
                     'm.select = t.value;', 'Object.assign(doc, x);'])
    assert.notDeepEqual(writes(bad), [], bad);
  for (const ok of ['const m = doc.marks[i];', 'if (doc.crop === null) {}', 'const [a, b] = [doc.marks[0], 1];'])
    assert.deepEqual(writes(ok), [], ok);
});

test('annotate.html never writes the document directly', () => {
  const src = readFileSync(new URL('../../annotate.html', import.meta.url), 'utf8');
  assert.deepEqual(writes(src), []);
});
