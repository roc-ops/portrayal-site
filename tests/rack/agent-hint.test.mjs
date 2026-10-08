// tests/rack/agent-hint.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {writeHint} from '../../site/rack/agent-hint.js';

test('writeHint puts the tool names in the page hint, and leaves a page without one alone', () => {
  const el = {textContent: '{"webmcp": true, "howTo": "x", "tools": []}'};
  const doc = {getElementById: id => (id === 'webmcp-hint' ? el : null)};
  assert.equal(writeHint(doc, ['describe_rack', 'inspect']), true);
  assert.deepEqual(JSON.parse(el.textContent), {webmcp: true, howTo: 'x', tools: ['describe_rack', 'inspect']});
  assert.equal(writeHint({getElementById: () => null}, ['a']), false);
  assert.equal(writeHint({getElementById: () => ({textContent: 'not json'})}, ['a']), false);
});

test('rack.html carries the hint block and its one-line paragraph', () => {
  const html = readFileSync(new URL('../../rack.html', import.meta.url), 'utf8');
  const m = /<script type="application\/json" id="webmcp-hint">([\s\S]*?)<\/script>/.exec(html);
  assert.ok(m, 'no #webmcp-hint block');
  const j = JSON.parse(m[1]);
  assert.equal(j.webmcp, true);
  assert.match(j.howTo, /document\.modelContext \?\? navigator\.modelContext/);
  assert.match(j.howTo, /await mc\.executeTool\(t, \{\}\)/);
  assert.deepEqual(j.tools, []);
  assert.match(html, /<p class="rk-vh" id="webmcp-hint-text">[^<]*executeTool[^<]*<\/p>/);
});
