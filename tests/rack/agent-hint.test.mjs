// tests/rack/agent-hint.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {writeHint, hintText, CONNECT} from '../../site/rack/agent-hint.js';

const page = (json = '{"webmcp": true, "howTo": "x", "tools": []}') => {
  const els = {'webmcp-hint': {textContent: json}, 'webmcp-hint-text': {textContent: ''}};
  return {els, doc: {getElementById: id => els[id] ?? null}};
};

test('writeHint names the tools once registered, and until then says how to connect', () => {
  const {els, doc} = page();
  assert.equal(writeHint(doc, []), true);
  let j = JSON.parse(els['webmcp-hint'].textContent);
  assert.deepEqual([j.registered, j.tools], [false, []]);
  assert.match(j.connect, /Connect your AI/);
  assert.match(els['webmcp-hint-text'].textContent, /^This page has tools for AI agents, not yet registered in this browser: open the Connect your AI menu/);
  assert.doesNotMatch(els['webmcp-hint-text'].textContent, /describe_rack/);
  assert.equal(writeHint(doc, ['describe_rack', 'inspect']), true);
  j = JSON.parse(els['webmcp-hint'].textContent);
  assert.deepEqual([j.registered, j.tools, 'connect' in j], [true, ['describe_rack', 'inspect'], false]);
  assert.match(els['webmcp-hint-text'].textContent,
    /^This page has tools for AI agents: use them rather than clicking the page\. Call document\.modelContext\.executeTool\(tool, args\), with the tool object from await document\.modelContext\.getTools\(\)\. The tools are: describe_rack, inspect\. Start with describe_rack\.$/);
  assert.equal(writeHint({getElementById: () => null}, ['a']), false);
  assert.equal(writeHint({getElementById: () => ({textContent: 'not json'})}, ['a']), false);
});

test('rack.html opens its body with the hint, as the body\'s description, saying it is not registered yet', () => {
  const html = readFileSync(new URL('../../rack.html', import.meta.url), 'utf8');
  const body = html.slice(html.indexOf('<body'));
  assert.match(body, /^<body class="tool" aria-describedby="webmcp-hint-text">\n/);
  // nothing visible comes before it: the paragraph and the JSON are the body's first elements
  const first = body.split('\n').slice(1).filter(l => l.trim() && !l.trim().startsWith('<!--')).slice(0, 2);
  assert.match(first[0], /^<p class="rk-vh" id="webmcp-hint-text">/);
  assert.match(first[1], /^<script type="application\/json" id="webmcp-hint">/);
  const p = /<p class="rk-vh" id="webmcp-hint-text">([^<]*)<\/p>/.exec(html)[1].replaceAll('&quot;', '"');
  assert.equal(p, hintText([]));
  const j = JSON.parse(/<script type="application\/json" id="webmcp-hint">([\s\S]*?)<\/script>/.exec(html)[1]);
  assert.deepEqual([j.webmcp, j.registered, j.tools], [true, false, []]);
  assert.equal(j.connect, `Not registered yet: ${CONNECT}.`);
  assert.match(j.howTo, /document\.modelContext \?\? navigator\.modelContext/);
  assert.match(j.howTo, /await mc\.executeTool\(t, \{\}\)/);
  assert.match(j.howTo, /not its name/);
  assert.match(html, /id="agentMenu"/);   // the menu the hint points at
});
