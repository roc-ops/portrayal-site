// portrayal-site#166: an agent's `inspect` of a cable says what it lies on
// (kit 0.14.0 route.rests), in cableText.
import test from 'node:test';
import assert from 'node:assert/strict';
import {cableText} from '../../site/rack/agent-text.js';

const base = {id: 'c9', kind: 'cable', a: {item: 'i3', path: 'port-49'}, b: {item: 'i2', path: 'bay-3/module/lc1'}, media: 'om4',
  length: null, routed: null, loose: [], route: {edited: false, text: 'i4 guide-3'}};

test('cableText says each ring sill, tray and body the cable rests on', () => {
  const t = cableText({...base, route: {...base.route, rests: [
    {kind: 'ring', item: 'i4', via: 'guide-3'},
    {kind: 'tray', item: 'i4', via: 'tray', face: 'top', role: 'resting'},
    {kind: 'tray', item: 'i5', via: 'tray', face: 'underside', role: 'held', ties: [2, 3]},
    {kind: 'body', item: 'i1', part: 'envelope'}]}});
  assert.match(t, /\nRests on: the sill of i4 guide-3, i4 tray \(top face, resting\), i5 tray \(underside face, held, tie slots 2, 3\), i1\./);
});

test('a cable that rests on nothing says nothing of it', () => {
  assert.doesNotMatch(cableText(base), /Rests on/);
});
