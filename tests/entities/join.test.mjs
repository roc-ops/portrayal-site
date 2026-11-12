import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readDistFile } from '../dist-files.mjs';
import { parseRange, matchName, targetOf, joinNames, componentNames, entityListings, componentsDump }
  from '../../site/entity-join.js';

const listings = JSON.parse(readDistFile('listings.json')).listings;
const rules = key => listings[key]['entity-map'];

test('a range bounds {n}, and a pattern with no {n} matches only itself', () => {
  assert.deepEqual(parseRange('1-32'), [1, 32]);
  assert.equal(parseRange(undefined), null);
  assert.equal(parseRange('x'), undefined);
  const sfp = {match: 'sfp{n}', range: '1-32', to: 'port-{n}'};
  assert.equal(matchName(sfp, 'sfp1'), 1);
  assert.equal(matchName(sfp, 'sfp32'), 32);
  assert.equal(matchName(sfp, 'sfp33'), false);
  assert.equal(matchName(sfp, 'sfp0'), false);
  assert.equal(matchName(sfp, 'xsfp1'), false);
  assert.equal(matchName(sfp, 'sfp1a'), false);
  assert.equal(matchName({match: 'lc0', to: 'chassis'}, 'lc0'), null);
  assert.equal(matchName({match: 'lc0', to: 'chassis'}, 'lc01'), false);
  assert.equal(matchName({match: 'sfp{n}', range: 'bad', to: 'x'}, 'sfp1'), false);
});

test('a target takes {n} and an offset on it', () => {
  assert.equal(targetOf({to: 'port-{n}'}, 4), 'port-4');
  assert.equal(targetOf({to: 'psu-{n+1}'}, 0), 'psu-1');
  assert.equal(targetOf({to: 'x-{n-1}'}, 3), 'x-2');
  assert.equal(targetOf({to: 'chassis'}, 0), 'chassis');
});

test('names are joined, a name no rule claims is unmapped, and a region is named as one', () => {
  const r = [
    {match: 'sfp{n}', range: '1-2', to: 'port-{n}', source: 'openconfig'},
    {match: 'psu{n}', range: '0-1', to: 'psu-{n+1}'},
    {match: 'thermal{n}', range: '0-1', to: 'region:internal'},
    {match: 'fan0', to: 'psu-2'},
    {match: 'redfish-only', to: 'chassis', source: 'redfish'},
  ];
  const out = joinNames(r, ['sfp1', 'sfp3', 'psu1', 'thermal0', 'fan0', 'redfish-only', 'process0']);
  assert.deepEqual(out.rows.map(x => [x.name, x.to, x.region]), [
    ['sfp1', 'port-1', null], ['psu1', 'psu-2', null], ['thermal0', 'region:internal', 'internal'], ['fan0', 'psu-2', null]]);
  assert.deepEqual(out.unmapped, ['sfp3', 'redfish-only', 'process0']);
  assert.deepEqual(out.conflicts, []);
});

test('two rules that give one name different targets join it to neither, and say so', () => {
  const out = joinNames([{match: 'fan{n}', to: 'fan-{n}'}, {match: 'fan1', to: 'psu-1'}, {match: 'fan2', to: 'fan-2'}],
                        ['fan1', 'fan2']);
  assert.deepEqual(out.conflicts, [{name: 'fan1', to: ['fan-1', 'psu-1']}]);
  assert.deepEqual(out.rows.map(x => x.name), ['fan2']);
  // the same target twice is not a conflict
  assert.deepEqual(joinNames([{match: 'a', to: 'x'}, {match: 'a', to: 'x'}], ['a']).conflicts, []);
});

test('the component names come from the component list and from the transceivers', () => {
  const doc = {data: {'openconfig-platform:components': {
    component: [{name: 'chassis'}, {name: 'psu0'}],
    'arcos-platform-transceiver:transceivers': {state: {transceiver: [{name: 'sfp1'}]}}}}};
  assert.deepEqual(componentNames(doc), ['chassis', 'psu0', 'sfp1']);
  assert.deepEqual(componentNames({}), []);
  assert.deepEqual(componentNames(null), []);
});

test('the shipped listings: both devices with an entity-map are listed, and every rule is readable', () => {
  const {withMap, without} = entityListings(listings);
  assert.ok(withMap.includes('arrcus/as7326-56x') && withMap.includes('arrcus/as7726-32x'), `${withMap}`);
  assert.ok(without.every(k => !listings[k]['entity-map']?.length));
  for (const key of withMap) for (const r of rules(key)) {
    assert.ok(r.match && r.to, `${key}: ${JSON.stringify(r)}`);
    assert.notEqual(parseRange(r.range), undefined, `${key}: range ${r.range}`);
  }
  assert.match(componentsDump(listings['arrcus/as7726-32x']), /^devices\/edgecore\/as7726-32x\/dumps\/arcos-openconfig-components\.json$/);
});

test('on the as7726-32x map: sfp1-32 are ports, psu0 is psu-1, thermal0 is internal, sfp33 is a management cage', () => {
  const out = joinNames(rules('arrcus/as7726-32x'),
    ['chassis', 'lc0', 'sfp1', 'sfp32', 'sfp33', 'sfp34', 'psu0', 'psu1', 'fan0', 'fan1', 'fan6', 'thermal0', 'thermal5', 'thermal6', 'cpu0']);
  const to = Object.fromEntries(out.rows.map(x => [x.name, x.to]));
  assert.equal(to.sfp1, 'port-1');
  assert.equal(to.sfp32, 'port-32');
  assert.equal(to.sfp33, 'mgmt-sfp-1');
  assert.equal(to.psu0, 'psu-1');
  assert.equal(to.psu1, 'psu-2');
  assert.equal(to.fan0, 'psu-2');
  assert.equal(to.fan6, 'fan-6');
  assert.equal(to.thermal5, 'region:internal');
  assert.equal(to.thermal6, 'psu-2');
  assert.deepEqual(out.unmapped, ['cpu0']);
  assert.deepEqual(out.conflicts, []);
});
