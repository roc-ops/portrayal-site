import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packOf, exportText } from '../../site/exports-pack.js';

// A path in index.json or files.json is a name inside a pack. The pack is the
// one for the path's target and the folder above the file, as the exporter wrote
// it, spaces and dots included: tools/pack-assets.py writes the same names.
test('a path names its pack by target and manufacturer', () => {
  assert.equal(packOf('netbox/device-types/APC/AP7821B.yaml'), 'assets/exports/packs/netbox/APC.json');
  assert.equal(packOf('nautobot/module-types/ZPE Systems/nsc-fan-module.yaml'),
               'assets/exports/packs/nautobot/ZPE%20Systems.json');
  assert.equal(packOf('fibre-maps/FS.com/FHD Fiber Splice Cassette.yaml'),
               'assets/exports/packs/fibre-maps/FS.com.json');
  // device types and module types of one manufacturer share a pack
  assert.equal(packOf('netbox/module-types/Cisco/A9K-3KW-AC.yaml'), packOf('netbox/device-types/Cisco/ASR-9006-AC-V2.yaml'));
});

// fetch is replaced for the test: `answers` maps a URL to a Response factory,
// and every call is recorded.
function fakeFetch(answers) {
  const calls = [];
  globalThis.fetch = async url => {
    calls.push(url);
    const make = answers[url];
    if (!make) return new Response('', {status: 404});
    return make();
  };
  return calls;
}

test('a pack is fetched once and gives each file its text, null for a path it lacks', async () => {
  const url = packOf('netbox/device-types/Alpha/a.yaml');
  const pack = {'netbox/device-types/Alpha/a.yaml': 'model: a\n', 'netbox/device-types/Alpha/b.yaml': 'model: b\n'};
  const calls = fakeFetch({[url]: () => new Response(JSON.stringify(pack))});
  assert.equal(await exportText('netbox/device-types/Alpha/a.yaml'), 'model: a\n');
  assert.equal(await exportText('netbox/device-types/Alpha/b.yaml'), 'model: b\n');
  assert.equal(await exportText('netbox/device-types/Alpha/none.yaml'), null);
  assert.equal(await exportText('netbox/device-types/Alpha/constructor'), null, 'not an inherited property');
  assert.deepEqual(calls, [url]);
});

test('a pack that cannot be fetched or parsed throws, and the failure is not remembered', async () => {
  const rel = 'nautobot/device-types/Beta/a.yaml';
  const url = packOf(rel);
  let calls = fakeFetch({});
  await assert.rejects(exportText(rel), /HTTP 404/);

  calls = fakeFetch({[url]: () => new Response('{not json')});
  await assert.rejects(exportText(rel));

  calls = fakeFetch({[url]: () => new Response('["a"]')});
  await assert.rejects(exportText(rel), /not a pack/);

  calls = fakeFetch({[url]: () => new Response(JSON.stringify({[rel]: 'slug: a\n'}))});
  assert.equal(await exportText(rel), 'slug: a\n', 'the next call fetches again');
  assert.deepEqual(calls, [url]);
});

test('a pack missing a path is null, not a throw, so one absent file is told apart from a broken pack', async () => {
  const rel = 'fibre-maps/Gamma/a.yaml';
  fakeFetch({[packOf(rel)]: () => new Response('{}')});
  assert.equal(await exportText(rel), null);
});
