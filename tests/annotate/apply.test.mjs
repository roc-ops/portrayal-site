// tests/annotate/apply.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {normalise} from '../../vendor/marks.js';
import {apply} from '../../site/annotate/commands.js';

const empty = () => normalise({device: 'd'});

test('a batch applies whole, and @names reach later commands', () => {
  const r = apply(empty(), [{op: 'mark.add', select: '#a', as: 'a'}, {op: 'mark.update', mark: '@a', label: '@a'}]);
  assert.deepEqual(r.doc.marks.map(m => [m.id, m.label]), [['m1', '@a']]);
  assert.deepEqual(r.created, {a: 'm1', ids: ['m1']});
  assert.deepEqual([r.noop, r.step], [false, true]);
});

test('a failing command leaves the document untouched and says which', () => {
  const d = empty();
  const r = apply(d, [{op: 'mark.add', select: '#a'}, {op: 'mark.remove', mark: 'nope'}]);
  assert.deepEqual(r, {error: 'There is no mark nope.', index: 1});
  assert.equal(d.marks.length, 0);
});

test('unknown commands, bad arguments and inherited keys are refused in words', () => {
  const d = empty();
  assert.deepEqual(apply(d, {op: 'mark.ad'}), {error: "There is no command called 'mark.ad'.", index: 0});
  assert.deepEqual(apply(d, {op: 'mark.add'}), {error: 'mark.add needs select, some text.', index: 0});
  assert.deepEqual(apply(d, {op: 'mark.add', select: '#a', colour: 'x'}), {error: 'mark.add does not take colour.', index: 0});
  assert.deepEqual(apply(d, {op: 'mark.add', select: '#a', constructor: 1}), {error: 'mark.add does not take constructor.', index: 0});
  assert.deepEqual(apply(d, [{op: 'mark.add', select: '#a', as: 'x'}, {op: 'mark.add', select: '#b', as: 'x'}]),
                   {error: 'Two commands in this batch are called x.', index: 1});
  assert.deepEqual(apply(d, {op: 'mark.remove', mark: '@x'}), {error: 'Nothing earlier in this batch is called x.', index: 0});
});

test('a batch of no-ops is a no-op', () => {
  const d = empty();
  const r = apply(d, [{op: 'legend', on: true}, {op: 'crop', rect: null}]);
  assert.deepEqual([r.noop, r.doc === d], [true, true]);
});
