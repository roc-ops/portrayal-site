// The cable list as a tree (portrayal-site#190): which rows start open, what
// the reader set is remembered per rack document, and what each key does.
import test from 'node:test';
import assert from 'node:assert/strict';
import {MANY, LOOSE, TREE_KEY, startsOpen, isOpen, loadTree, saveTree, keyStep} from '../../site/rack/cable-tree.js';

const store = () => { const m = new Map(); return {getItem: k => m.get(k) ?? null, setItem: (k, v) => { m.set(k, String(v)); }, map: m}; };

test('rows nobody touched start open in a small rack and closed past about twenty cables', () => {
  assert.equal(MANY, 20);
  assert.equal(startsOpen(0), true);
  assert.equal(startsOpen(20), true);
  assert.equal(startsOpen(21), false);
  assert.equal(isOpen({}, 'b1', 48), false);
  assert.equal(isOpen({}, 'b1', 4), true);
  assert.equal(isOpen(null, LOOSE, 4), true);
});

test('what the reader set outranks the start, either way', () => {
  assert.equal(isOpen({b1: true}, 'b1', 48), true);
  assert.equal(isOpen({b1: false}, 'b1', 4), false);
  assert.equal(isOpen({b1: 'yes'}, 'b1', 48), false, 'only a boolean is a setting');
  assert.equal(isOpen({b2: true}, 'b1', 48), false);
});

test('the rows are remembered per rack document, and one rack never answers for another', () => {
  const s = store();
  assert.deepEqual(loadTree('doc-a', s), {});
  saveTree('doc-a', {b1: true, [LOOSE]: false}, s);
  saveTree('doc-b', {b1: false}, s);
  assert.deepEqual(loadTree('doc-a', s), {b1: true, [LOOSE]: false});
  assert.deepEqual(loadTree('doc-b', s), {b1: false});
  assert.deepEqual(loadTree('doc-c', s), {});
  saveTree('doc-a', {b1: false}, s);
  assert.deepEqual(loadTree('doc-a', s), {b1: false});
  assert.equal(JSON.parse(s.map.get(TREE_KEY)).filter(([id]) => id === 'doc-a').length, 1, 'one entry a document');
});

test('only the most recently touched racks are kept, and a broken store reads as nothing set', () => {
  const s = store();
  for (let k = 0; k < 60; k++) saveTree(`doc-${k}`, {b1: true}, s);
  const all = JSON.parse(s.map.get(TREE_KEY));
  assert.equal(all.length, 40);
  assert.equal(all[0][0], 'doc-59');
  assert.deepEqual(loadTree('doc-0', s), {}, 'the oldest is forgotten');
  assert.deepEqual(loadTree('doc-59', s), {b1: true});
  for (const junk of ['{', '{"a":1}', '[1,2]', '[["doc-x", null]]', '[["doc-x", {"b1": 1}]]']) {
    const t = store(); t.setItem(TREE_KEY, junk);
    assert.deepEqual(loadTree('doc-x', t), {}, junk);
  }
  const blocked = {getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }};
  assert.deepEqual(loadTree('doc-a', blocked), {});
  assert.doesNotThrow(() => saveTree('doc-a', {b1: true}, blocked));
});

// b1 open over c1 and c2 (c2 left out by the filter), b2 closed over c3, then the group of the rest, open over c4.
const ROWS = [
  {id: 'b1', parent: null, open: true, hidden: false},
  {id: 'c1', parent: 'b1', open: null, hidden: false},
  {id: 'c2', parent: 'b1', open: null, hidden: true},
  {id: 'b2', parent: null, open: false, hidden: false},
  {id: 'c3', parent: 'b2', open: null, hidden: false},
  {id: 'none', parent: null, open: true, hidden: false},
  {id: 'c4', parent: 'none', open: null, hidden: false},
];

test('Up and Down move between the rows that show: not into a closed row, not onto a filtered one', () => {
  const walk = (from, key) => { const out = []; let at = from; for (;;) { const s = keyStep(ROWS, at, key); if (!s) break; at = s.focus; out.push(at); } return out; };
  assert.deepEqual(walk('b1', 'ArrowDown'), ['c1', 'b2', 'none', 'c4']);
  assert.deepEqual(walk('c4', 'ArrowUp'), ['none', 'b2', 'c1', 'b1']);
  assert.deepEqual(keyStep(ROWS, 'c1', 'Home'), {focus: 'b1'});
  assert.deepEqual(keyStep(ROWS, 'c1', 'End'), {focus: 'c4'});
});

test('Right opens a closed row and steps into an open one; Left closes an open row and steps out of a member', () => {
  assert.deepEqual(keyStep(ROWS, 'b2', 'ArrowRight'), {toggle: 'b2', open: true});
  assert.deepEqual(keyStep(ROWS, 'b1', 'ArrowRight'), {focus: 'c1'});
  assert.equal(keyStep(ROWS, 'c1', 'ArrowRight'), null, 'a cable has nothing to open');
  assert.deepEqual(keyStep(ROWS, 'b1', 'ArrowLeft'), {toggle: 'b1', open: false});
  assert.deepEqual(keyStep(ROWS, 'c1', 'ArrowLeft'), {focus: 'b1'});
  assert.equal(keyStep(ROWS, 'b2', 'ArrowLeft'), null, 'a closed row at the top has nowhere to go');
  assert.deepEqual(keyStep(ROWS, 'c4', 'ArrowLeft'), {focus: 'none'});
});

test('Enter and Space act on the row; any other key is left alone', () => {
  assert.deepEqual(keyStep(ROWS, 'c1', 'Enter'), {act: 'c1'});
  assert.deepEqual(keyStep(ROWS, 'b2', ' '), {act: 'b2'});
  assert.equal(keyStep(ROWS, 'c1', 'a'), null);
  assert.equal(keyStep(ROWS, 'c1', 'Tab'), null);
});

test('a row that no longer shows hands the keyboard to the first that does', () => {
  assert.deepEqual(keyStep(ROWS, 'c3', 'ArrowDown'), {focus: 'b1'}, 'c3 is under a closed row');
  assert.equal(keyStep(ROWS, 'c3', 'Enter'), null);
  assert.equal(keyStep([], 'x', 'ArrowDown'), null);
});
