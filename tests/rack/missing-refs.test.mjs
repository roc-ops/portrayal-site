// The Rack Builder says when a slot's stored part is not in the library (#183).
import test from 'node:test';
import assert from 'node:assert/strict';
import {missingRefs, missingTexts} from '../../site/rack/missing-refs.js';

const HERE = new Set(['juniper/mx-dpc-blank@2', 'juniper/scb-mx@3']);
const ctx = {compByRef: ref => (HERE.has(String(ref).split(':')[0]) ? {} : null), redirects: {catalogued: HERE.size}};
const GONE = 'juniper/dpc-r-4xge-xfp@2';
const item = (id, label, swaps) => ({id, ref: 'mx960', cfg: 'base', label, swaps});

test('a stored ref the library does not hold is found with its label and slot', () => {
  const rack = {items: [item('i1', 'edge-1', {fpc0: GONE, scb0: 'juniper/scb-mx@3'})], zeroU: []};
  assert.deepEqual(missingRefs(rack, ctx), [{item: 'i1', label: 'edge-1', path: 'fpc0', ref: GONE}]);
});

test('a zeroU part is read as an item is; no label names the id', () => {
  const rack = {items: [], zeroU: [item('z1', '', {a: GONE})]};
  assert.deepEqual(missingRefs(rack, ctx), [{item: 'z1', label: 'z1', path: 'a', ref: GONE}]);
});

test('a held ref, an empty slot, no swaps and a suffix say nothing', () => {
  const rack = {items: [
    item('i1', 'a', {x: 'juniper/scb-mx@3', y: '', z: 'juniper/scb-mx@3:cfg'}),
    {id: 'i2', label: 'b'}, item('i3', 'c', null)], zeroU: []};
  assert.deepEqual(missingRefs(rack, ctx), []);
});

test('a library that did not load says nothing', () => {
  const rack = {items: [item('i1', 'edge-1', {fpc0: GONE})], zeroU: []};
  assert.deepEqual(missingRefs(rack, {...ctx, redirects: {catalogued: 0}}), []);
  assert.deepEqual(missingRefs(rack, undefined), []);
  assert.deepEqual(missingRefs(null, ctx), []);
});

test('the sentence for one slot', () => {
  const found = missingRefs({items: [item('i1', 'edge-1', {fpc0: GONE})], zeroU: []}, ctx);
  assert.deepEqual(missingTexts(found), [
    'edge-1: slot fpc0 names juniper/dpc-r-4xge-xfp@2, which is not in the library, so the slot shows its default. The choice stays in the file.']);
});

test('two slots of one device share the sentence', () => {
  const found = missingRefs({items: [item('i1', 'edge-1', {fpc0: 'A@1', fpc1: 'B@1'})], zeroU: []}, ctx);
  assert.deepEqual(missingTexts(found), [
    'edge-1: slot fpc0 names A@1 and slot fpc1 names B@1, which are not in the library, so those slots show their defaults. The choices stay in the file.']);
});

test('eight devices give five lines', () => {
  const items = Array.from({length: 8}, (_, i) => item(`i${i}`, `d${i}`, {s: GONE}));
  const out = missingTexts(missingRefs({items, zeroU: []}, ctx));
  assert.equal(out.length, 5);
  assert.equal(out[4], '4 more devices name parts the library does not hold; their slots show their defaults.');
  assert.ok(out[0].startsWith('d0: '));
});

test('an empty list gives none', () => assert.deepEqual(missingTexts([]), []));
