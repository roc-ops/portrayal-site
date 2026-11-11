import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commonAccepts, rangeOf, groupsOf, emptyOf, applyChoice, makeHistory }
  from '../../site/slot-select.js';

const BDM = ['casa/bdm@1', 'casa/bdm2@1', 'casa/blank-faceplate@1'];
const SMM = ['casa/smm-8x10g@1', 'casa/blank-faceplate@1'];
const bay = (id, accepts, chosen = '', group = 'front-slots', face = 'front') =>
  ({id, accepts, chosen, group, face});

test('commonAccepts: what every selected slot takes, versions dropped, blanks left out', () => {
  const bays = [bay('a', BDM), bay('b', BDM), bay('c', SMM)];
  assert.deepEqual(commonAccepts([bays[0], bays[1]]), ['casa/bdm', 'casa/bdm2']);
  assert.deepEqual(commonAccepts(bays), []);
  assert.deepEqual(commonAccepts([]), []);
  assert.deepEqual(commonAccepts([bay('x', ['casa/bdm@1', 'casa/bdm2@2'])]), ['casa/bdm', 'casa/bdm2']);
});

test('commonAccepts keeps the order of the first slot', () => {
  const a = bay('a', ['x/one@1', 'x/two@1', 'x/three@1']);
  const b = bay('b', ['x/three@1', 'x/one@1']);
  assert.deepEqual(commonAccepts([a, b]), ['x/one', 'x/three']);
});

test('rangeOf: both ends included, in either order, over the displayed order', () => {
  const order = [4, 5, 6, 7, 8];
  assert.deepEqual(rangeOf(order, 5, 7), [5, 6, 7]);
  assert.deepEqual(rangeOf(order, 7, 5), [5, 6, 7]);
  assert.deepEqual(rangeOf(order, 6, 6), [6]);
  assert.deepEqual(rangeOf(order, 5, 99), [5]);
});

test('groupsOf: one entry per face and group, slots in declared order', () => {
  const bays = [bay('front-0', BDM), bay('front-1', BDM), bay('rear-0', SMM, '', 'rear-slots', 'rear'),
                bay('fan-0', ['c/fan@1'], '', 'fans', 'rear')];
  assert.deepEqual(groupsOf(bays).map(g => [g.face, g.group, g.indices]),
    [['front', 'front-slots', [0, 1]], ['rear', 'rear-slots', [2]], ['rear', 'fans', [3]]]);
});

test('emptyOf: the slots that hold nothing', () => {
  const bays = [bay('a', BDM, 'casa/bdm2'), bay('b', BDM), bay('c', BDM, '')];
  assert.deepEqual(emptyOf(bays), [1, 2]);
});

test('applyChoice sets every selected slot that accepts the choice and says which it left', () => {
  const bays = [bay('a', BDM, 'casa/bdm'), bay('b', BDM), bay('c', SMM)];
  const r = applyChoice(bays, [0, 1, 2], 'casa/bdm2');
  assert.deepEqual(r.changes, [{i: 0, was: 'casa/bdm', now: 'casa/bdm2'}, {i: 1, was: '', now: 'casa/bdm2'}]);
  assert.deepEqual(r.skipped, [2]);
  assert.equal(bays[0].chosen, 'casa/bdm', 'the input is not changed');
});

test('applyChoice: empty is always a choice; a slot already holding it is not a change', () => {
  const bays = [bay('a', BDM, 'casa/bdm'), bay('b', BDM, '')];
  const r = applyChoice(bays, [0, 1], '');
  assert.deepEqual(r.changes, [{i: 0, was: 'casa/bdm', now: ''}]);
  assert.deepEqual(r.skipped, []);
  assert.deepEqual(applyChoice(bays, [0], 'casa/bdm').changes, []);
});

test('applyChoice refuses a ref no selected slot accepts, even a version of one that does', () => {
  const bays = [bay('a', BDM)];
  assert.deepEqual(applyChoice(bays, [0], 'casa/smm-8x10g'), {changes: [], skipped: [0]});
  assert.deepEqual(applyChoice(bays, [0], 'casa/bdm@9'), {changes: [], skipped: [0]});
});

test('history: undo hands back the last change set, newest first, and nothing once empty', () => {
  const h = makeHistory();
  assert.equal(h.undo(), null);
  h.push([{i: 0, was: '', now: 'x'}]);
  h.push([]);
  h.push([{i: 1, was: 'x', now: ''}, {i: 2, was: '', now: 'y'}]);
  assert.equal(h.size, 2, 'an empty change set is not kept');
  assert.deepEqual(h.undo(), [{i: 1, was: 'x', now: ''}, {i: 2, was: '', now: 'y'}]);
  assert.deepEqual(h.undo(), [{i: 0, was: '', now: 'x'}]);
  assert.equal(h.undo(), null);
  h.push([{i: 0, was: '', now: 'x'}]);
  h.clear();
  assert.equal(h.size, 0);
});
