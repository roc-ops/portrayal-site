// tests/rack/estimated-capacity.test.mjs
// AN ESTIMATED CABLE CAPACITY SAYS IT IS ESTIMATED (kit 0.40.0, Portrayal
// #1074). Seven FS managers state no capacity; the library now carries an
// estimate for them (`capacity.estimated: true` in rack.json, `estimated` on the
// kit's loads and over-capacity entries). Where the page shows a manager's
// capacity or fill it says "estimated" for those, and says nothing of the kind
// for a count the maker states.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {cableText} from '../../site/rack/agent-text.js';
import {capacityText} from '../../site/rack/capacity-text.js';
import {WARNING_KINDS, capacityKindTitle} from '../../site/rack/cable-panel.js';

const devices = JSON.parse(readFileSync(new URL('../../assets/dist/rack.json', import.meta.url), 'utf8')).devices;

test('the catalogue marks the estimate, and only the estimate', () => {
  const sfds = devices['cmh-sfds1u'].capacity;
  assert.equal(sfds.estimated, true);
  assert.equal(sfds.media, 'cat6');
  // a manager whose maker states a count carries no `estimated`
  const stated = Object.values(devices).filter(d => d.capacity && d.capacity.estimated !== true);
  assert.ok(stated.length > 0);
  assert.ok(stated.every(d => !('estimated' in d.capacity)));
});

test('a stated capacity is worded as it was', () => {
  assert.equal(capacityText({count: 30, basis: 'FS states 30 Cat6 cables', media: 'cat6'}), '30 cables (FS states 30 Cat6 cables)');
  assert.doesNotMatch(capacityText({count: 30, basis: 'FS states 30', estimated: false}), /estimate/i);
});

test('an estimated capacity says it is an estimate, in the kit\'s words, and the maker states none', () => {
  const t = capacityText(devices['cmh-sfds1u'].capacity);
  assert.match(t, /^an estimated 54 cat6 cables' worth \(its maker states none\)/);
  assert.match(t, /ESTIMATE, not stated by FS/);
  assert.match(capacityText({count: 1, estimated: true, basis: 'b'}), /^an estimated 1 cable's worth \(its maker states none\)/);
  assert.match(capacityText({count: 12, estimated: true, media: 'cat6', basis: 'b'}), /^an estimated 12 cat6 cables' worth/);
});

test('a loop stored in a duct with an estimated capacity reads against the estimate', () => {
  const base = {kind: 'cable', id: 'c15', a: {item: 'i1', path: 'p1', view: 'front'}, b: {item: 'i2', path: 'p1', view: 'front'}, media: 'cat6',
    length: {value: 3, unit: 'm', source: 'entered', need: 1.2}, routed: {metres: 1.3, stock: 2}, route: {edited: true, text: 'CMH-SFDS1U duct'}};
  const loop = load => cableText({...base, slack: {metres: 1.74, at_ends_m: 0.2, said: true, unplaced_m: 0,
    stored: [{item: 'hm', via: 'duct', form: 'loop', metres: 1.54, ok: true, kind: 'duct', load}]}});
  const est = loop({stated: true, compared: true, estimated: true, count: 5, capacity: 54, media: 'cat6', over: false});
  assert.match(est, /\(a duct holding 5 cat6 cables' worth against an estimated 54 cat6 cables' worth \(its maker states none\)\)/);
  assert.doesNotMatch(est, /its maker states\)/);
  const past = loop({stated: true, compared: true, estimated: true, count: 60, capacity: 54, media: 'cat6', over: true});
  assert.match(past, /holding 60 cat6 cables' worth past an estimated 54 cat6 cables' worth \(its maker states none\)/);
  // a stated count is worded as before
  assert.match(loop({stated: true, compared: true, count: 5, capacity: 48, media: 'cat6', over: false}),
    /a duct holding 5 cat6 cables' worth of the 48 its maker states\)/);
});

test('the kit\'s estimated-capacity finding is named by kind', () => {
  const t = cableText({kind: 'cable', id: 'c1', a: {item: 'i1', path: 'p', view: 'front'}, b: {item: 'i2', path: 'p', view: 'front'}, media: 'cat6',
    spare_findings: [{kind: 'spare-capacity-estimated', text: 'hm holds 5 cat6 cables\' worth with the spare stored in it, against an estimated 54 cat6 cables\' worth (its maker states none).'}]});
  assert.match(t, /Spare, capacity estimated: hm holds 5/);
});

test('the over-capacity list says "estimated" only when a row rests on an estimate', () => {
  assert.equal(capacityKindTitle([{item: 'a'}, {item: 'b', estimated: false}]), WARNING_KINDS.capacity);
  assert.equal(capacityKindTitle([{item: 'a', estimated: true}]), "More cables than a manager's estimated capacity");
  assert.equal(capacityKindTitle([{item: 'a'}, {item: 'b', estimated: true}]), 'More cables than a manager states or is estimated to hold');
});
