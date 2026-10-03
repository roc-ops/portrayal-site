import { test } from 'node:test';
import assert from 'node:assert/strict';
import { docToScene, legendItems } from '../../site/annotate3d.js';

// The smallest DOM docToScene touches: querySelectorAll over a flat list, and
// parentNode/nodeType for the outermost-only rule. A selector the fake does
// not know is treated as invalid CSS, which querySelectorAll throws on.
function face(parts) {
  const root = {nodeType: 1, parentNode: null, all: []};
  const byPath = {};
  for (const [path, parent] of parts) {
    const el = {nodeType: 1, dataset: {path}, parentNode: parent ? byPath[parent] : root};
    byPath[path] = el;
    root.all.push(el);
  }
  root.querySelectorAll = sel => {
    const m = /^\[data-path\^?='([^']*)'\]$/.exec(sel);
    if (!m) throw new SyntaxError(`bad selector ${sel}`);
    const prefix = sel.includes('^=');
    return root.all.filter(e => prefix ? e.dataset.path.startsWith(m[1]) : e.dataset.path === m[1]);
  };
  return root;
}
const front = face([['port-0'], ['port-1'], ['port-0/lamp', 'port-0']]);
const rear = face([['psu-0'], ['psu-1']]);

test('a colour reaches every face, outermost match only', () => {
  const s = docToScene({marks: [{select: "[data-path^='p']", color: '#e0574f'}]}, {front, rear});
  assert.deepEqual(s.marks.map(m => m.path).sort(), ['port-0', 'port-1', 'psu-0', 'psu-1']);
  assert.deepEqual(s.byMark[0].paths.sort(), ['port-0', 'port-1', 'psu-0', 'psu-1']);
});

test('a lamp colour and a state map by path', () => {
  const s = docToScene({marks: [
    {select: "[data-path='port-0/lamp']", lamp: '#FF00FF'},
    {select: "[data-path='psu-1']", state: 'fault'},
  ]}, {front, rear});
  assert.deepEqual(s.lamps, {'port-0/lamp': '#ff00ff'});
  assert.deepEqual(s.states, {'psu-1': 'state-fault'});
  assert.deepEqual(s.marks, []);
});

test('a selector matching nothing anywhere has no paths, and no error', () => {
  const s = docToScene({marks: [{select: "[data-path='fan-9']", color: '#2bb3c8'}]}, {front, rear});
  assert.deepEqual(s.byMark, [{paths: [], error: null}]);
});

test('invalid CSS is an error on its mark, and the others still reach the scene', () => {
  const s = docToScene({marks: [
    {select: "[data-path=", color: '#e0574f'},
    {select: "[data-path='psu-0']", color: '#2bb3c8'},
  ]}, {front, rear});
  assert.ok(s.byMark[0].error);
  assert.deepEqual(s.marks, [{path: 'psu-0', color: '#2bb3c8'}]);
});

test('an invalid colour or state is dropped, not passed on', () => {
  const s = docToScene({marks: [
    {select: "[data-path='port-1']", color: 'red; x', lamp: 'url(x)', state: 'On Fire'},
  ]}, {front, rear});
  assert.deepEqual([s.marks, s.lamps, s.states], [[], {}, {}]);
  assert.deepEqual(s.byMark[0].paths, ['port-1']);
});

test('a later mark on the same path wins, as in paint order', () => {
  const s = docToScene({marks: [
    {select: "[data-path='psu-0']", color: '#111111', state: 'ok'},
    {select: "[data-path='psu-0']", color: '#222222', state: 'fault'},
  ]}, {rear});
  assert.deepEqual(s.marks, [{path: 'psu-0', color: '#222222'}]);
  assert.deepEqual(s.states, {'psu-0': 'state-fault'});
});

test('the legend lists labelled marks that reached something, in order', () => {
  const doc = {marks: [
    {select: "[data-path='psu-0']", color: '#e0574f', label: 'A feed'},
    {select: "[data-path='fan-9']", color: '#2bb3c8', label: 'nowhere'},
    {select: "[data-path='port-0/lamp']", lamp: '#ff00ff', label: 'lit'},
    {select: "[data-path='port-1']", color: '#00ff00'},
  ]};
  const s = docToScene(doc, {front, rear});
  assert.deepEqual(legendItems(doc, s), [
    {label: 'A feed', color: '#e0574f', hollow: false},
    {label: 'lit', color: '#ff00ff', hollow: true},
  ]);
});

test('a state-only labelled mark takes the colour its state paints, when the page can say', () => {
  const doc = {marks: [
    {select: "[data-path='psu-0']", state: 'fault', label: 'failed feed'},
    {select: "[data-path='psu-1']", state: 'ok', label: 'good feed'},
    {select: "[data-path='port-1']", color: '#00ff00', state: 'fault', label: 'ringed'},
  ]};
  const s = docToScene(doc, {front, rear});
  const colorOf = m => ({fault: '#EF4444', ok: 'url(x)'})[m.state];
  assert.deepEqual(legendItems(doc, s, colorOf), [
    {label: 'failed feed', color: '#ef4444', hollow: true},   // the state's colour, hollow: no ring
    {label: 'good feed', color: '#8d939a', hollow: true},     // not a hex: grey, never passed on
    {label: 'ringed', color: '#00ff00', hollow: false},       // a ring colour still wins
  ]);
  // and with no resolver the rows are as before
  assert.equal(legendItems(doc, s)[0].color, '#8d939a');
});
