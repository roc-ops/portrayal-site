// tests/annotate/editor.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {createMarksEditor} from '../../site/annotate/editor.js';

const fresh = () => {
  const ed = createMarksEditor({doc: {device: 'a'}});
  const evs = [];
  ed.on('change', e => evs.push(e));
  return {ed, evs};
};

test('apply records a step and emits; undo and redo walk it with its origin', () => {
  const {ed, evs} = fresh();
  ed.apply({op: 'mark.add', select: '#x'}, {origin: 'agent'});
  assert.equal(ed.getDoc().marks.length, 1);
  assert.equal(ed.undoSummary, 'Added mark m1 on #x.');
  ed.undo();
  assert.equal(ed.getDoc().marks.length, 0);
  ed.redo();
  assert.equal(ed.getDoc().marks.length, 1);
  assert.deepEqual(evs.map(e => [e.cause, e.origin]), [['apply', 'agent'], ['undo', 'agent'], ['redo', 'agent']]);
});

test('an error, a no-op and a preview record and emit nothing', () => {
  const {ed, evs} = fresh();
  const before = ed.getDoc();
  assert.ok(ed.apply({op: 'mark.remove', mark: 'm9'}).error);
  assert.ok(ed.apply({op: 'legend', on: true}).noop);
  assert.equal(ed.preview({op: 'mark.add', select: '#x'}).doc.marks.length, 1);
  assert.deepEqual([ed.getDoc() === before, evs.length, ed.canUndo], [true, 0, false]);
});

test('a typing burst with one merge key is one step that undoes to before the burst', () => {
  const {ed} = fresh();
  ed.apply({op: 'mark.add', select: '#x'});
  for (const t of ['P', 'PS', 'PSU']) ed.apply({op: 'mark.update', mark: 0, label: t}, {merge: '0:label'});
  assert.equal(ed.getDoc().marks[0].label, 'PSU');
  ed.undo();
  assert.equal(ed.getDoc().marks[0].label, '');
  ed.undo();
  assert.equal(ed.getDoc().marks.length, 0);
});

test('another edit, or an undo, ends the burst', () => {
  const {ed} = fresh();
  ed.apply({op: 'mark.add', select: '#x'});
  ed.apply({op: 'mark.update', mark: 0, label: 'a'}, {merge: '0:label'});
  ed.apply({op: 'legend', on: false});
  ed.apply({op: 'mark.update', mark: 0, label: 'ab'}, {merge: '0:label'});
  ed.undo();
  assert.deepEqual([ed.getDoc().marks[0].label, ed.getDoc().legend], ['a', false]);
});

test('the shell owns the target: retarget is not a step, and undo keeps it', () => {
  const {ed, evs} = fresh();
  ed.apply({op: 'mark.add', select: '#x'});
  ed.retarget({device: 'b', config: 'c', view: 'rear', swaps: {'p': 'x/y@1'}, fields: {}});
  assert.deepEqual([evs.at(-1).cause, evs.at(-1).step], ['target', false]);
  ed.undo();
  const d = ed.getDoc();
  assert.deepEqual([d.marks.length, d.device, d.config, d.view, d.swaps], [0, 'b', 'c', 'rear', {'p': 'x/y@1'}]);
  ed.redo();
  assert.deepEqual([ed.getDoc().marks.length, ed.getDoc().device], [1, 'b']);
  const n = evs.length;
  ed.retarget({device: 'b'});
  assert.equal(evs.length, n);              // the same target is a no-op
  ed.retarget({swaps: {'p': 'x/y@1'}, fields: {}, view: 'rear'});
  assert.equal(evs.length, n);              // and so is the same target in another key order
});

test('loadDoc normalises, clears history and emits load', () => {
  const {ed, evs} = fresh();
  ed.apply({op: 'mark.add', select: '#x'});
  ed.loadDoc({device: 'z', marks: [{select: '#y', lamp: '#ABC'}]});
  assert.deepEqual([ed.getDoc().device, ed.getDoc().marks[0].lamp, ed.canUndo, evs.at(-1).cause], ['z', '#abc', false, 'load']);
});

test('a throwing listener does not stop the edit or the other listeners', () => {
  const ed = createMarksEditor({doc: {}});
  const seen = [];
  const err = console.error;
  console.error = () => {};
  try {
    ed.on('change', () => { throw new Error('boom'); });
    ed.on('change', e => seen.push(e.cause));
    ed.apply({op: 'mark.add', select: '#x'});
  } finally { console.error = err; }
  assert.deepEqual([ed.getDoc().marks.length, seen], [1, ['apply']]);
});

test('the documents handed out are frozen, so editing one in place cannot rewrite a step', () => {
  const {ed} = fresh();
  const r = ed.apply({op: 'mark.add', select: '#x'});
  const d = ed.getDoc();
  assert.equal(r.doc, d);
  assert.ok(Object.isFrozen(d) && Object.isFrozen(d.marks) && Object.isFrozen(d.marks[0]));
  assert.throws(() => { d.marks[0].select = '#y'; }, TypeError);
  assert.throws(() => { d.marks.push({}); }, TypeError);
  ed.undo(); ed.redo();
  assert.equal(ed.getDoc().marks[0].select, '#x');
  // the shell's own objects are copied, not frozen under it
  const swaps = {p: 'x/y@1'};
  ed.retarget({swaps});
  assert.ok(!Object.isFrozen(swaps));
  assert.ok(Object.isFrozen(ed.getDoc().swaps));
});

test('undo across a change of drawing keeps the crop the shell re-cut for it', () => {
  const ed = createMarksEditor({doc: {device: 'a', view: 'front'}});
  ed.apply({op: 'crop', rect: {x: 0, y: 0, w: 10, h: 5}});
  ed.apply({op: 'mark.add', select: '#x'});
  ed.retarget({view: 'rear', crop: {x: 0, y: 0, w: 8, h: 5}});
  ed.undo();                                 // the mark, a step taken on the front
  assert.deepEqual([ed.getDoc().marks.length, ed.getDoc().crop], [0, {x: 0, y: 0, w: 8, h: 5}]);
  ed.undo();                                 // the crop itself, also from the front
  assert.deepEqual(ed.getDoc().crop, {x: 0, y: 0, w: 8, h: 5});
  // on the same drawing a crop step undoes as any other
  const same = createMarksEditor({doc: {device: 'a', view: 'front'}});
  same.apply({op: 'crop', rect: {x: 0, y: 0, w: 10, h: 5}});
  same.undo();
  assert.equal(same.getDoc().crop, null);
});
