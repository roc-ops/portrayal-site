// REPLACE A PLACED DEVICE (site/rack/replace.js): one step through the editor,
// at the place the panel promised. check_rack_replace holds the same on the page.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../../vendor/rack/model.js';
import {withCable} from '../../vendor/rack/cable-rules.js';
import {createRackEditor} from '../../vendor/rack/editor.js';
import {replaceSpot, replaceCommands} from '../../site/rack/replace.js';

const part = (name, ru) => ({name, ru, model: name.toUpperCase(), d: 400, w: 482.6, h: ru * 44.45, default: 'base', configs: ['base']});
const PARTS = {one: part('one', 1), two: part('two', 2), three: part('three', 3)};
const chassisOf = ref => PARTS[ref] ?? null;

function editorWith(...placed) {
  let rack = M.newRack({name: 'Replace'});
  for (const [ref, ru, label] of placed) ({rack} = M.withItem(rack, {ref, cfg: 'base', ru, label: label ?? ref}));
  return createRackEditor({doc: {...M.newDoc({name: 'Replace'}), racks: [rack]}, chassisOf});
}
const swap = (ed, id, ref, label = PARTS[ref].model) => {
  const item = ed.rack().items.find(i => i.id === id);
  const without = ed.preview({op: 'remove', id}).rack;
  return ed.apply(replaceCommands(item, {ref, cfg: 'base', ru: replaceSpot(without, item, PARTS[ref], chassisOf), label}));
};

test('a device with room keeps its bottom U', () => {
  const ed = editorWith(['one', 20]);
  const res = swap(ed, 'i1', 'two');
  assert.ok(!res.error, res.error);
  assert.deepEqual(ed.rack().items.map(i => [i.ref, i.ru, i.label]), [['two', 20, 'TWO']]);
  assert.equal(res.created.ids.length, 1);
});

test('a taller device with a neighbour above keeps its top U', () => {
  const ed = editorWith(['one', 20], ['one', 21, 'above']);
  swap(ed, 'i1', 'two');
  assert.deepEqual(ed.rack().items.find(i => i.ref === 'two').ru, 19);
});

test('a shorter device keeps its bottom U', () => {
  const ed = editorWith(['three', 20]);
  swap(ed, 'i1', 'one');
  assert.deepEqual(ed.rack().items.map(i => [i.ref, i.ru]), [['one', 20]]);
});

test('one Undo takes back both halves', () => {
  const ed = editorWith(['one', 20, 'tor-1']);
  const before = ed.rack();
  swap(ed, 'i1', 'two');
  assert.ok(ed.canUndo);
  ed.undo();
  assert.deepEqual(ed.rack(), before);
  assert.ok(!ed.canUndo, 'the replacement was one step');
});

test('a device with no room either way is refused, and nothing changes', () => {
  const ed = editorWith(['one', 20], ['one', 21, 'above'], ['one', 19, 'below']);
  const before = ed.rack();
  const res = swap(ed, 'i1', 'two');
  assert.ok(res.error, 'expected a refusal');
  assert.equal(ed.rack(), before);
  assert.ok(!ed.canUndo);
});

test('its cables stay as loose ends, and the step says so', () => {
  const ed = editorWith(['one', 20], ['one', 30]);
  const {rack} = withCable(ed.rack(), {a: {item: 'i1', path: 'p1', view: 'front'}, b: {item: 'i2', path: 'p1', view: 'front'}, media: 'cat6'});
  ed.loadDoc({...ed.getDoc(), racks: [rack]});
  const res = swap(ed, 'i1', 'two');
  assert.match(res.summary, /Its 1 cable is a loose end/);
  assert.equal(ed.rack().cables.length, 1);
});
