// The link's `pulled=`: the parts taken off, as one query parameter.
import test from 'node:test';
import assert from 'node:assert/strict';
import { encodePulled, decodePulled } from '../../site/pulled-link.js';

test('a device with one view writes the bare paths, sorted', () => {
  assert.equal(encodePulled(['psu-cover', 'fan-left'], [null, null]), 'fan-left,psu-cover');
  assert.equal(encodePulled(['psu-cover'], null), 'psu-cover');
});

test('a device with several views writes each path with its view', () => {
  assert.equal(encodePulled(['bezel', 'lid'], ['front', 'top']), 'bezel@front,lid@top');
});

test('one path on two faces stays two entries', () => {
  assert.equal(encodePulled(['screw-1', 'screw-1'], ['left', 'right']), 'screw-1@left,screw-1@right');
});

test('a repeat is written once; nothing off writes nothing', () => {
  assert.equal(encodePulled(['a', 'a'], ['front', 'front']), 'a@front');
  assert.equal(encodePulled([], []), '');
  assert.equal(encodePulled(undefined, undefined), '');
});

test('a path with a slash, a comma or an @ cannot be mistaken for a separator', () => {
  const s = encodePulled(['bay-1/module', 'a,b', 'c@d'], ['front', 'front', 'front']);
  assert.deepEqual(decodePulled(s), {
    paths: ['a,b', 'bay-1/module', 'c@d'], views: ['front', 'front', 'front'],
  });
});

test('decoding is the inverse of encoding', () => {
  const paths = ['psu-cover', 'fan-left'], views = ['rear', 'rear'];
  assert.deepEqual(decodePulled(encodePulled(paths, views)),
    {paths: ['fan-left', 'psu-cover'], views: ['rear', 'rear']});
  assert.deepEqual(decodePulled('bezel'), {paths: ['bezel'], views: [null]});
});

test('a bad link is ignored, never thrown on, and one bad entry spares the rest', () => {
  assert.deepEqual(decodePulled(null), {paths: [], views: []});
  assert.deepEqual(decodePulled(''), {paths: [], views: []});
  assert.deepEqual(decodePulled(',,@front,%E0%A4%A,bezel@front'), {paths: ['bezel'], views: ['front']});
});
