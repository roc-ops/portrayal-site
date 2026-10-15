// tests/rack/route-cancel.test.mjs
// CANCEL IN THE ROUTE EDITOR (S-0042). The editor applies each pick at once,
// one Undo step each (spec §6, rack-page.js editRoute), so Cancel takes back
// every route edit made since the edit opened (route-edit.js): the route is
// what it was, in one step, and Cancel itself adds no Undo step.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {newDoc} from '../../vendor/rack/model.js';
import {createRackEditor} from '../../vendor/rack/editor.js';
import {routeEditSession} from '../../site/rack/route-edit.js';

const devices = JSON.parse(readFileSync(new URL('../../assets/dist/rack.json', import.meta.url), 'utf8')).devices;
const SW = {ru: 1, w: 440, h: 44, d: 300};
const chassisOf = ref => (ref === 'sw' ? SW : devices[ref] ?? null);
const item = (id, ref, ru) => ({id, ref, cfg: 'base', label: id.toUpperCase(), ru, face: 'front', turned: false, swaps: {}, fields: {}});
const end = i => ({item: i, path: 'p1', view: 'front'});
const LEN = {value: 3, unit: 'm', source: 'entered'};
const L30 = {lane: 'right-front', ru: 30}, L28 = {lane: 'right-front', ru: 28}, L26 = {lane: 'right-front', ru: 26};
const cable = (id, extra = {}) => ({id, a: end('i1'), b: end('i2'), media: 'cat6', purpose: '', label: '', length: LEN, ...extra});
const editorOf = cables => createRackEditor({chassisOf, doc: {...newDoc(), racks: [{id: 'r1', name: 'r',
  frame: {kind: 'four-post', heightRU: 45, numbering: 'bottom-up', railDepth: 740},
  items: [item('i1', 'sw', 30), item('i2', 'sw', 26)], zeroU: [], cables}]}});
const route = (ed, id) => ed.rack().cables.find(c => c.id === id);
const pick = (ed, s, id, list) => { const res = ed.apply({op: 'cable.route', id, route: list, summary: 'Waypoint added.'}); assert.ok(!res.error, res.error); s.noteEdit(res); };

test('a picked waypoint, cancelled, leaves the route as it was', () => {
  const ed = editorOf([cable('c1', {route: [L30], routeEdited: true})]);
  const before = route(ed, 'c1');
  const s = routeEditSession(ed, 'c1');
  pick(ed, s, 'c1', [L30, L28]);
  assert.deepEqual(route(ed, 'c1').route, [L30, L28]);
  assert.equal(s.cancel(), 1);
  assert.deepEqual(route(ed, 'c1'), before);
});

test('every pick since the edit opened is taken back, in one Cancel', () => {
  const ed = editorOf([cable('c1', {route: [L30], routeEdited: true})]);
  const before = route(ed, 'c1');
  const s = routeEditSession(ed, 'c1');
  pick(ed, s, 'c1', [L30, L28]);
  pick(ed, s, 'c1', [L30, L28, L26]);
  pick(ed, s, 'c1', [L26, L30, L28, L26]);
  assert.equal(s.cancel(), 3);
  assert.deepEqual(route(ed, 'c1'), before);
});

test('an automatic route is automatic again after a cancelled pick', () => {
  const ed = editorOf([cable('c1')]);
  const before = route(ed, 'c1');
  assert.ok(!before.routeEdited);
  const s = routeEditSession(ed, 'c1');
  pick(ed, s, 'c1', [L30]);
  assert.ok(route(ed, 'c1').routeEdited);
  s.cancel();
  assert.deepEqual(route(ed, 'c1'), before);
});

test('Cancel adds no Undo step: what was undoable before the edit is still the last step', () => {
  const ed = editorOf([cable('c1', {route: [L30], routeEdited: true})]);
  ed.apply({op: 'cable.update', id: 'c1', label: 'first'});
  const last = ed.undoSummary;
  const s = routeEditSession(ed, 'c1');
  pick(ed, s, 'c1', [L30, L28]);
  s.cancel();
  assert.equal(ed.undoSummary, last);
  assert.equal(route(ed, 'c1').label, 'first');   // an edit made before the route editor opened stays
});

test('Cancel does not undo past the edit: nothing picked, nothing undone', () => {
  const ed = editorOf([cable('c1', {route: [L30], routeEdited: true})]);
  ed.apply({op: 'cable.update', id: 'c1', label: 'first'});
  const s = routeEditSession(ed, 'c1');
  assert.equal(s.cancel(), 0);
  assert.equal(route(ed, 'c1').label, 'first');
});

test('a pick the viewer already took back with Undo is not taken back twice', () => {
  const ed = editorOf([cable('c1', {route: [L30], routeEdited: true})]);
  ed.apply({op: 'cable.update', id: 'c1', label: 'first'});
  const before = route(ed, 'c1');
  const s = routeEditSession(ed, 'c1');
  pick(ed, s, 'c1', [L30, L28]);
  pick(ed, s, 'c1', [L30, L28, L26]);
  ed.undo(); s.noteUndo();
  assert.equal(s.cancel(), 1);
  assert.deepEqual(route(ed, 'c1'), before);
  assert.equal(route(ed, 'c1').label, 'first');
});

test('a redo after an undo is counted, so Cancel reaches it', () => {
  const ed = editorOf([cable('c1', {route: [L30], routeEdited: true})]);
  const before = route(ed, 'c1');
  const s = routeEditSession(ed, 'c1');
  pick(ed, s, 'c1', [L30, L28]);
  ed.undo(); s.noteUndo();
  ed.redo(); s.noteRedo();
  assert.equal(s.cancel(), 1);
  assert.deepEqual(route(ed, 'c1'), before);
});

test('a refused or unchanged pick is not a step', () => {
  const ed = editorOf([cable('c1', {route: [L30], routeEdited: true})]);
  const s = routeEditSession(ed, 'c1');
  s.noteEdit(ed.apply({op: 'cable.route', id: 'c1', route: [L30]}));              // no change
  s.noteEdit(ed.apply({op: 'cable.route', id: 'nope', route: [L30]}));            // refused
  assert.equal(s.cancel(), 0);
});
