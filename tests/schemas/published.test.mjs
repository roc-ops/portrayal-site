// THE PUBLISHED SCHEMAS (publish/schemas/, served at the URL each $id names).
// The device schema at /schemas/v1/ was republished in place on 2026-10-11 to
// match Portrayal at cf5e08fb, which added the optional `adjustments` block
// and `moves-with`: the copy published before refused a device that declares a
// part that slides (the FS DIN rail shelves), at `adjustments`, since the
// schema takes no key it does not describe. Held here with the kit's own
// validator over the compiled sources this site vendors, so it needs no
// Portrayal clone.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {validate} from '../../vendor/rack/validate.js';
import {readDistFile} from '../dist-files.mjs';

const read = rel => JSON.parse(readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8'));
const device = read('publish/schemas/v1/device.schema.json');
const source = name => JSON.parse(readDistFile(`${name}.source.json`));

test('the published device schema validates a device that declares an adjustment, and one that does not', () => {
  for (const name of ['dinrail2u', 'dinrail4u']) {
    const d = source(name);
    assert.ok(d.adjustments && d.adjustments['rail-setback'], `${name} declares rail-setback`);
    assert.deepEqual(validate(device, d).map(e => `${e.path.join('/')}: ${e.keyword}`), [], name);
  }
  for (const name of ['as7726-32x', 'xcu', 'mx104']) {
    const d = source(name);
    assert.equal(d.adjustments, undefined, `${name} declares none`);
    assert.deepEqual(validate(device, d).map(e => `${e.path.join('/')}: ${e.keyword}`), [], name);
  }
});

test('the adjustment is checked, not waved through: a wrong axis, a range of one number and an unknown key are refused', () => {
  const broken = edit => { const d = source('dinrail2u'); edit(d.adjustments['rail-setback'], d); return validate(device, d).map(e => e.keyword); };
  assert.ok(broken(a => { a.axis = 'w'; }).length > 0, 'axis');
  assert.ok(broken(a => { a.range = [51.2]; }).length > 0, 'range');
  assert.ok(broken(a => { a.wobble = true; }).length > 0, 'an unknown key');
  assert.ok(broken((a, d) => { d['not-a-key'] = 1; }).includes('additionalProperties'), 'the schema still takes no key it does not describe');
});

// HELD: published schemas that are not republished to match the vendored copy yet.
const HELD_REASON = 'held until Portrayal settles the attrs.speeds typing (Portrayal issue #1699)';
const HELD = [
  {label: 'v1', name: 'component.schema.json', reason: HELD_REASON},
  {label: 'v1', name: 'device.schema.json', reason: HELD_REASON},
  {label: 'v1', name: 'listing.schema.json', reason: HELD_REASON},
  {label: 'v3', name: 'rack.schema.json', reason: HELD_REASON},
];
const isHeld = (label, name) => HELD.some(h => h.label === label && h.name === name);

test('each published schema is the vendored one of the same name wherever its label is the one upstream names, except the four held', () => {
  const dir = new URL('../../publish/schemas/', import.meta.url);
  let same = 0;
  const held = [];
  for (const label of readdirSync(dir).filter(n => /^v\d+$/.test(n)))
    for (const name of readdirSync(new URL(`${label}/`, dir)).filter(n => n.endsWith('.schema.json'))) {
      const pub = readFileSync(new URL(`${label}/${name}`, dir), 'utf8');
      const mine = JSON.parse(pub);
      assert.equal(mine.$id, `https://portrayal.dev/schemas/${label}/${name}`);
      let vend = null;
      try { vend = readFileSync(new URL(`../../assets/schemas/${name}`, import.meta.url), 'utf8'); } catch { vend = null; }
      // an older label of a schema that has moved on (the rack file's v1 and v2) is kept as published
      if (!(vend && JSON.parse(vend).$id === mine.$id)) continue;
      if (isHeld(label, name)) {
        // a held exception that stops differing must fail, not stay on as a silent exemption
        assert.notEqual(pub, vend, `${label}/${name} is held (${HELD_REASON}) but now equals the vendored schema: take it off HELD`);
        held.push(`${label}/${name}`);
      } else { assert.equal(pub, vend, `${label}/${name} differs from the vendored schema`); same++; }
    }
  assert.deepEqual(held.sort(), ['v1/component.schema.json', 'v1/device.schema.json', 'v1/listing.schema.json', 'v3/rack.schema.json'], 'every held schema is published and still differs');
  // the floor of six counts every schema examined, equal or held and shown to differ, so holding one cannot lower it;
  // and at least two must still be compared equal, so the equality check is not emptied by holding the rest
  assert.ok(same + HELD.length >= 6, `only ${same} compared equal and ${HELD.length} held: fewer than 6 published schemas were examined`);
  assert.ok(same >= 2, `only ${same} published schemas were compared equal`);
});

test('the held list is exactly four, each with its reason', () => {
  assert.deepEqual(HELD.map(h => `${h.label}/${h.name}`), ['v1/component.schema.json', 'v1/device.schema.json', 'v1/listing.schema.json', 'v3/rack.schema.json']);
  for (const h of HELD) assert.equal(h.reason, 'held until Portrayal settles the attrs.speeds typing (Portrayal issue #1699)');
});
