// A rack whose devices share a skin fetches that skin's pack once (face.js
// loadSkin, through the kit's fetchDist), a failed fetch is asked again, and
// findComp answers from a Map.
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.location = new URL('http://localhost/rack.html');
const calls = [];
let failSkin = 0;
const COMPONENTS = [
  {ns: 'a', name: 'sfp', major: 'v1', skins: ['default']},
  {ns: 'a', name: 'sfp', major: 'v1', skins: ['other']},
  {ns: 'b', name: 'card', major: 'v2', skins: ['x']},
  {ns: 'c', name: 'late', major: 'v3', skins: ['x']},
];
// The skins are in packs: one chunk per namespace here, so the chunk index
// names no second chunk, and each pack holds its namespace's skins.
const packOf = ns => Object.fromEntries(COMPONENTS.filter(c => c.ns === ns).flatMap(c => c.skins.map(s => {
  const path = `components/${c.ns}--${c.name}--${c.major}--${s}.svg`;
  return [path, `<svg id="${path}"/>`];
})));
globalThis.fetch = async url => {
  const u = String(url);
  calls.push(u);
  if (u.endsWith('/packs/components/index.json')) return {ok: true, status: 200, json: async () => ({})};
  if (u.endsWith('components.json')) {
    const body = {components: COMPONENTS};
    return {ok: true, json: async () => body};
  }
  if (failSkin > 0) { failSkin--; throw new Error('network'); }
  const pack = /\/packs\/components\/([^/.]+)\.1\.json$/.exec(u);
  return {ok: true, status: 200, json: async () => ({files: pack ? packOf(pack[1]) : {}})};
};

const {loadSkin, findComp, components} = await import('../../site/rack/face.js');
const packFetches = ns => calls.filter(u => u.endsWith(`/packs/components/${ns}.1.json`)).length;

test('devices sharing a skin fetch its pack once', async () => {
  const rs = await Promise.all(Array.from({length: 40}, () => loadSkin('a/sfp@1:slot')));
  assert.equal(packFetches('a'), 1);
  assert.ok(rs.every(r => r.text === rs[0].text && r.comp.skins[0] === 'default'));
  assert.match(rs[0].text, /--sfp--v1--default/);
  await loadSkin('b/card@2');
  assert.equal(packFetches('b'), 1);
  assert.equal(await loadSkin('nope/none@1'), null);
});

test('a failed skin fetch is not kept', async () => {
  // The kit tries a pack that fails on the network once more before it gives
  // up (vendor/dist.js loadPack), so a failure reaches loadSkin only when both
  // tries fail; then neither the pack nor the skin is remembered.
  failSkin = 2;
  await assert.rejects(loadSkin('c/late@3'), /network/);
  assert.equal(packFetches('c'), 2);
  const r = await loadSkin('c/late@3');
  assert.match(r.text, /--late--/);
  assert.equal(packFetches('c'), 3);
});

test('findComp finds the first match by ref key', async () => {
  const list = await components();
  assert.equal(findComp(list, 'a/sfp@1:port').skins[0], 'default');
  assert.equal(findComp(list, 'b/card@2').ns, 'b');
  assert.equal(findComp(list, 'z/z@9'), undefined);
  // a list spliced in place is looked in as it now is
  const [gone] = list.splice(list.findIndex(c => c.ns === 'b'), 1);
  assert.equal(findComp(list, 'b/card@2'), undefined);
  list.push(gone);
  assert.equal(findComp(list, 'b/card@2'), gone);
});
