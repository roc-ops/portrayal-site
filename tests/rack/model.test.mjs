import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../../site/rack/model.js';

test('a new document is one 42U four-post rack with the spec defaults', () => {
  const d = M.newDoc();
  assert.equal(d.format, 'portrayal-rack');
  assert.equal(d.version, 1);
  assert.match(d.id, /^doc-/);
  assert.equal(d.racks.length, 1);
  assert.deepEqual(d.racks[0].frame, {kind: 'four-post', heightRU: 42, numbering: 'bottom-up',
    holes: {style: 'square', thread: null}, railDepth: 740, usableDepth: 1000, ref: null});
  assert.deepEqual([d.racks[0].items, d.racks[0].zeroU, d.racks[0].cables], [[], [], []]);
});

test('a two-post frame has no rail depth and a 1000 mm usable depth', () => {
  assert.deepEqual(M.defaultFrame('two-post'), {kind: 'two-post', heightRU: 42, numbering: 'bottom-up',
    holes: {style: 'square', thread: null}, railDepth: null, usableDepth: 1000, ref: null});
});

test('normalizeFrame keeps a thread only on a tapped rail, and only a known one', () => {
  const f = M.defaultFrame();
  assert.equal(M.normalizeFrame({...f, holes: {style: 'square', thread: 'M6'}}).holes.thread, null);
  assert.equal(M.normalizeFrame({...f, holes: {style: 'tapped', thread: 'M6'}}).holes.thread, 'M6');
  assert.equal(M.normalizeFrame({...f, holes: {style: 'tapped', thread: 'M5'}}).holes.thread, null);
  assert.equal(M.normalizeFrame({...f, heightRU: '24.4'}).heightRU, 24);
  assert.equal(M.normalizeFrame({...f, heightRU: 0}).heightRU, 42);
  assert.equal(M.normalizeFrame({...f, kind: 'two-post'}).railDepth, null);
  assert.equal(M.normalizeFrame({...M.defaultFrame('two-post'), kind: 'four-post'}).railDepth, 740);
});

test('items get stable, unique ids; edits return new racks', () => {
  const r0 = M.newRack();
  const {rack: r1, item: a} = M.withItem(r0, {ref: 'r740xd', cfg: 'sff24-rc5-1b2a3a', ru: 10});
  const {rack: r2, item: b} = M.withItem(r1, {ref: 'as7726-32x', cfg: 'ac-f2b', ru: 20, face: 'rear'});
  assert.deepEqual([a.id, b.id], ['i1', 'i2']);
  assert.equal(r0.items.length, 0, 'the original rack is untouched');
  assert.deepEqual(a, {id: 'i1', ref: 'r740xd', cfg: 'sff24-rc5-1b2a3a', label: 'r740xd', ru: 10,
    face: 'front', turned: false, swaps: {}, fields: {}});
  const r3 = M.withoutItem(r2, 'i1');
  const {item: c} = M.withItem(r3, {ref: 'tm-280', cfg: 'base', ru: 1});
  assert.equal(c.id, 'i3', 'a removed id is never reused');
  assert.equal(M.updateItem(r2, 'i2', {ru: 21}).items[1].ru, 21);
  assert.equal(M.renamed(r2, 'Lab').name, 'Lab');
});

test('uLabel counts from the top when the frame says so', () => {
  const f = M.defaultFrame();
  assert.equal(M.uLabel(f, 1), 1);
  assert.equal(M.uLabel({...f, numbering: 'top-down'}, 1), 42);
  assert.equal(M.uLabel({...f, numbering: 'top-down'}, 42), 1);
});

test('a document survives serialize and parse unchanged', () => {
  let d = M.newDoc({name: 'Lab rack'});
  const {rack} = M.withItem(d.racks[0], {ref: 'r740xd', cfg: 'sff24-rc5-1b2a3a', ru: 10,
    swaps: {'psu-2': 'common/psu-dc-650@2'}, fields: {'port-1-occupant': {label: 'LR4'}}});
  d = {...d, racks: [rack]};
  assert.deepEqual(M.parseDoc(M.serialize(d)), d);
});

test('parseDoc refuses what it cannot read, with a sentence', () => {
  assert.throws(() => M.parseDoc('{'), SyntaxError);
  assert.throws(() => M.parseDoc({format: 'other'}), /not a Portrayal rack file/);
  assert.throws(() => M.parseDoc({format: 'portrayal-rack', version: 2, racks: []}),
    /version 2; this page reads up to version 1/);
  assert.throws(() => M.parseDoc({format: 'portrayal-rack', version: 1, racks: []}), /holds no rack/);
  assert.throws(() => M.parseDoc({format: 'portrayal-rack', version: 1,
    racks: [{frame: {}, items: [{ref: 'x'}]}]}), /Item 1 has no device or no U/);
});

test('parseDoc gives every item a distinct id, even a duplicated one', () => {
  const d = M.parseDoc({format: 'portrayal-rack', version: 1,
    racks: [{frame: {}, items: [{id: 'i2', ref: 'x', ru: 1}, {ref: 'x', ru: 2}, {ref: 'x', ru: 3}]}]});
  const ids = d.racks[0].items.map(i => i.id);
  assert.equal(new Set(ids).size, 3, 'all three ids are distinct');
  assert.equal(ids[0], 'i2', 'the first item keeps its declared id');
});

test('parseDoc gives a second item the same declared id a fresh one', () => {
  const d = M.parseDoc({format: 'portrayal-rack', version: 1,
    racks: [{frame: {}, items: [{id: 'i4', ref: 'x', ru: 1}, {id: 'i4', ref: 'x', ru: 2}]}]});
  const ids = d.racks[0].items.map(i => i.id);
  assert.equal(ids[0], 'i4');
  assert.notEqual(ids[1], 'i4', 'a repeated id is not kept twice');
  assert.equal(new Set(ids).size, 2);
});

test('parseDoc fills what an older writer left out, and keeps zeroU and cables', () => {
  const d = M.parseDoc({format: 'portrayal-rack', version: 1,
    racks: [{name: 'A', frame: {kind: 'two-post'}, items: [{id: 'i4', ref: 'tm-280', ru: 3}],
             zeroU: [{id: 'z1'}], cables: [{id: 'c1'}]}]});
  assert.match(d.id, /^doc-/);
  assert.equal(d.racks[0].frame.usableDepth, 1000);
  assert.deepEqual(d.racks[0].items[0], {id: 'i4', ref: 'tm-280', cfg: '', label: 'tm-280', ru: 3,
    face: 'front', turned: false, swaps: {}, fields: {}});
  assert.deepEqual([d.racks[0].zeroU, d.racks[0].cables], [[{id: 'z1'}], [{id: 'c1'}]]);
});
