import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { markdownPath, wantsMarkdown } from '../../worker/index.mjs';

// A stand-in for the ASSETS binding: the static files the Worker reads.
const FILES = {
  '/': ['<!doctype html><title>home</title>', 'text/html'],
  '/kit': ['<!doctype html><title>kit</title>', 'text/html'],
  '/index.md': ['---\ntitle: "home"\n---\n# Home\n', 'text/markdown'],
  '/kit.md': ['---\ntitle: "kit"\n---\n# Kit\n', 'text/markdown'],
  '/rack': ['<!doctype html><title>rack</title>', 'text/html'],   // no rack.md
};
const env = {
  ASSETS: {
    async fetch(req) {
      const f = FILES[new URL(req.url).pathname];
      if (!f) return new Response('not found', { status: 404, headers: { 'Content-Type': 'text/html' } });
      return new Response(f[0], { status: 200, headers: { 'Content-Type': f[1], ETag: '"x"', 'X-Content-Type-Options': 'nosniff' } });
    },
  },
};
const get = (path, accept, method = 'GET') =>
  worker.fetch(new Request(`https://portrayal.dev${path}`, { method, headers: accept ? { Accept: accept } : {} }), env);

test('a page path maps to its Markdown copy', () => {
  assert.equal(markdownPath('/'), '/index.md');
  assert.equal(markdownPath('/kit'), '/kit.md');
  assert.equal(markdownPath('/kit.html'), '/kit.md');
  for (const p of ['/site/x.js', '/schemas/v1/device.schema.json', '/kit/', '/Kit'])
    assert.equal(markdownPath(p), null, p);
});

test('Markdown when Accept prefers it, HTML otherwise', () => {
  for (const a of ['text/markdown', 'text/markdown, text/html;q=0.9', 'text/html;q=0.5, text/markdown', 'TEXT/MARKDOWN; charset=utf-8'])
    assert.equal(wantsMarkdown(a), true, a);
  for (const a of [null, '', '*/*', 'text/html', 'text/html, text/markdown;q=0.5', 'text/markdown;q=0', 'text/*'])
    assert.equal(wantsMarkdown(a), false, String(a));
});

test('Accept: text/markdown gets the copy as text/markdown, with a token count and Vary', async () => {
  const r = await get('/', 'text/markdown');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('Content-Type'), 'text/markdown; charset=utf-8');
  assert.equal(await r.text(), FILES['/index.md'][0]);
  assert.match(r.headers.get('x-markdown-tokens'), /^\d+$/);
  assert.equal(r.headers.get('Vary'), 'Accept');
  assert.equal(r.headers.get('ETag'), null, 'the HTML ETag must not label the Markdown');
  assert.equal(r.headers.get('X-Content-Type-Options'), 'nosniff');
});

test('HEAD with Accept: text/markdown has the headers and no body', async () => {
  const r = await get('/kit', 'text/markdown', 'HEAD');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('Content-Type'), 'text/markdown; charset=utf-8');
  assert.equal(await r.text(), '');
});

test('the HTML names its Markdown copy in a Link header, and the front page the sitemap', async () => {
  const home = await get('/', 'text/html');
  assert.equal(home.headers.get('Content-Type'), 'text/html');
  assert.equal(await home.text(), FILES['/'][0]);
  const link = home.headers.get('Link');
  assert.match(link, /<\/index\.md>; rel="alternate"; type="text\/markdown"/);
  assert.match(link, /<\/sitemap\.xml>; rel="sitemap"/);
  assert.equal(home.headers.get('Vary'), 'Accept');
  const kit = await get('/kit');
  assert.equal(kit.headers.get('Link'), '</kit.md>; rel="alternate"; type="text/markdown"');
});

test('no copy, or not a page: the static asset, untouched', async () => {
  const rack = await get('/rack', 'text/markdown');
  assert.equal(rack.headers.get('Content-Type'), 'text/html', 'falls back to the HTML');
  const miss = await get('/nope.js', 'text/markdown');
  assert.equal(miss.status, 404);
  assert.equal(miss.headers.get('Link'), null);
});
