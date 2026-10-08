// tests/annotate/commands.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {normalise} from '../../vendor/marks.js';
import {COMMANDS, MARK_GONE} from '../../site/annotate/commands.js';

const run = (op, doc, args = {}) => COMMANDS[op].run(doc, args);
const doc = (marks = []) => normalise({device: 'd', marks});
const P = "[data-path='psu-0']";

test('mark.add gives the next free id, and refuses what it cannot keep', () => {
  const d = doc([{id: 'm4', select: '#a'}, {select: '#b'}]);
  const r = run('mark.add', d, {select: '#c', color: '#ff2d95'});
  assert.deepEqual(r.doc.marks[2], {id: 'm5', select: '#c', color: '#ff2d95', state: '', label: '', lamp: ''});
  assert.deepEqual([r.created, r.summary], [{id: 'm5'}, 'Added mark m5 on #c.']);
  assert.deepEqual(run('mark.add', d, {select: '  '}), {error: 'A mark needs a selector.'});
  assert.deepEqual(run('mark.add', d, {select: '#c', id: 'm4'}), {error: 'There is already a mark m4.'});
  assert.deepEqual(run('mark.add', d, {select: '#c', lamp: 'red'}), {error: 'red is not a hex color like #ff8800.'});
  assert.equal(run('mark.add', d, {select: '#c', lamp: '#00FF00'}).doc.marks[2].lamp, '#00ff00');
});

test('a mark is addressed by index, then id, then the select of an id-less mark', () => {
  const d = doc([{id: 'm1', select: '#a'}, {select: '#b'}, {select: '#dup'}, {select: '#dup'}]);
  assert.equal(run('mark.update', d, {mark: 1, label: 'x'}).doc.marks[1].label, 'x');
  assert.equal(run('mark.update', d, {mark: 'm1', label: 'x'}).doc.marks[0].label, 'x');
  assert.equal(run('mark.update', d, {mark: '#b', label: 'x'}).doc.marks[1].label, 'x');
  assert.deepEqual(run('mark.update', d, {mark: '#dup', label: 'x'}),
                   {error: 'Two marks select #dup; give one an id first (mark.update with id).'});
  assert.deepEqual(run('mark.update', d, {mark: 'm9', label: 'x'}), {error: MARK_GONE('m9')});
  assert.equal(MARK_GONE('m9'), 'There is no mark m9.');
  assert.equal(MARK_GONE(7), 'There is no mark at row 7.');
  assert.deepEqual(run('mark.update', d, {mark: 7}), {error: 'There is no mark at row 7.'});
});

test('mark.update: a no-op is the same document; an id can be given or refused', () => {
  const d = doc([{id: 'm1', select: '#a', label: 'x'}, {select: '#b'}]);
  assert.equal(run('mark.update', d, {mark: 'm1', label: 'x'}).doc, d);
  const named = run('mark.update', d, {mark: '#b', id: 'up'});
  assert.deepEqual([named.doc.marks[1].id, named.summary], ['up', 'Changed mark #b.']);
  assert.deepEqual(run('mark.update', d, {mark: '#b', id: 'm1'}), {error: 'There is already a mark m1.'});
});

test('mark.remove, mark.move, marks.clear', () => {
  const d = doc([{id: 'm1', select: '#a'}, {id: 'm2', select: '#b'}, {id: 'm3', select: '#c'}]);
  assert.deepEqual(run('mark.remove', d, {mark: 'm2'}).doc.marks.map(m => m.id), ['m1', 'm3']);
  const mv = run('mark.move', d, {mark: 'm3', to: 0});
  assert.deepEqual([mv.doc.marks.map(m => m.id), mv.summary], [['m3', 'm1', 'm2'], 'Moved mark m3 to row 0.']);
  assert.equal(run('mark.move', d, {mark: 0, to: 0}).doc, d);
  assert.deepEqual(run('mark.move', d, {mark: 0, to: 3}), {error: 'There is no row 3; the list has 3 marks.'});
  const c = run('marks.clear', d);
  assert.deepEqual([c.doc.marks, c.summary], [[], 'Cleared 3 marks.']);
  assert.equal(run('marks.clear', doc()).doc.marks.length, 0);
  const empty = doc();
  assert.equal(run('marks.clear', empty).doc, empty);
});

test('lamp.state is the tree chip: set, toggle off, and a mark left saying nothing goes', () => {
  const on = run('lamp.state', doc(), {path: 'psu-0', state: 'on'});
  assert.deepEqual(on.doc.marks.map(m => [m.select, m.state]), [[P, 'on']]);
  const off = run('lamp.state', on.doc, {path: 'psu-0', state: 'on'});
  assert.deepEqual(off.doc.marks, []);
  const kept = run('lamp.state', doc([{select: P, state: 'on', label: 'PSU'}]), {path: 'psu-0', state: 'on'});
  assert.deepEqual(kept.doc.marks.map(m => [m.state, m.label]), [['', 'PSU']]);
  const nothing = doc();
  assert.equal(run('lamp.state', nothing, {path: 'psu-0', state: ''}).doc, nothing);
  // a mark on the path that already says nothing goes, as the chip has always done
  assert.deepEqual(run('lamp.state', doc([{select: P}]), {path: 'psu-0', state: ''}).doc.marks, []);
});

test('lamp.color is the swatch: a color on an off lamp clears the off; null clears', () => {
  const set = run('lamp.color', doc([{select: P, state: 'off'}]), {path: 'psu-0', hex: '#00ff00'});
  assert.deepEqual(set.doc.marks.map(m => [m.state, m.lamp]), [['', '#00ff00']]);
  const added = run('lamp.color', doc(), {path: 'psu-0', hex: '#00FF00'});
  assert.deepEqual(added.doc.marks.map(m => [m.select, m.lamp]), [[P, '#00ff00']]);
  assert.deepEqual(run('lamp.color', added.doc, {path: 'psu-0', hex: null}).doc.marks, []);
  const keep = run('lamp.color', doc([{select: P, label: 'x', lamp: '#fff'}]), {path: 'psu-0', hex: null});
  assert.deepEqual(keep.doc.marks.map(m => [m.label, m.lamp]), [['x', '']]);
  const none = doc();
  assert.equal(run('lamp.color', none, {path: 'psu-0', hex: null}).doc, none);
  assert.deepEqual(run('lamp.color', none, {path: 'psu-0', hex: 'red'}), {error: 'red is not a hex color like #ff8800.'});
  // clearing the color of a mark that says nothing drops it, as clearLamp always did
  assert.deepEqual(run('lamp.color', doc([{select: P}]), {path: 'psu-0', hex: null}).doc.marks, []);
});

test('crop and legend', () => {
  const d = doc();
  const c = run('crop', d, {rect: {x: 1, y: 2, w: 3, h: 4}});
  assert.deepEqual([c.doc.crop, c.summary], [{x: 1, y: 2, w: 3, h: 4}, 'Cropped to 3 x 4 mm.']);
  assert.equal(run('crop', d, {rect: null}).doc, d);
  assert.equal(run('crop', c.doc, {rect: null}).summary, 'Removed the crop.');
  assert.equal(run('legend', d, {on: true}).doc, d);
  assert.deepEqual(run('legend', d, {on: false}).doc.legend, false);
  assert.equal(run('legend', d, {on: false}).summary, 'Turned the legend off.');
});
