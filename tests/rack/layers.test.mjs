// The Show menu's layers and presets (portrayal-site#197, part 1): five layers, five presets, remembered
// in the browser, and what a cable or a part belongs to.
import test from 'node:test';
import assert from 'node:assert/strict';
import {LAYERS_KEY, LAYER_IDS, PRESETS, LAYERS_DEFAULT, presetOf, loadLayers, saveLayers, layerOfMedia, layerOfKind, shiftIntoWindow} from '../../site/rack/layers.js';

const store = (v = null) => { const m = new Map(v == null ? [] : [[LAYERS_KEY, v]]); return {getItem: k => m.get(k) ?? null, setItem: (k, x) => { m.set(k, String(x)); }, map: m}; };

test('five layers and five presets, and Everything is the default', () => {
  assert.deepEqual(LAYER_IDS, ['data', 'power', 'bundles', 'managers', 'pdus']);
  assert.deepEqual(PRESETS.map(p => p[0]), ['elevation', 'equipment', 'data', 'power', 'everything']);
  const on = Object.fromEntries(PRESETS.map(p => [p[0], p[3]]));
  assert.deepEqual(on, {elevation: ['managers'], equipment: [], data: ['data', 'bundles', 'managers'], power: ['power', 'pdus'], everything: LAYER_IDS});
  assert.deepEqual(LAYERS_DEFAULT, LAYER_IDS);
});

test('a preset is named from the layers on, in any order, and a mix is none', () => {
  assert.equal(presetOf(['managers', 'bundles', 'data']), 'data');
  assert.equal(presetOf(['pdus', 'power']), 'power');
  assert.equal(presetOf([]), 'equipment');
  assert.equal(presetOf(LAYER_IDS), 'everything');
  assert.equal(presetOf(['data']), null);
  assert.equal(presetOf(['managers', 'data']), null);
});

test('the layers are kept as a list in order, and only a list of layers is read back', () => {
  assert.deepEqual(loadLayers(store()), LAYER_IDS);
  const s = store(); saveLayers(['pdus', 'data'], s);
  assert.equal(s.map.get(LAYERS_KEY), '["data","pdus"]');
  assert.deepEqual(loadLayers(s), ['data', 'pdus']);
  const none = store(); saveLayers([], none);
  assert.deepEqual(loadLayers(none), [], 'no layer is a setting');
  for (const junk of ['', 'power', '{}', '["nope"]', '["power", 3]', 'null']) assert.deepEqual(loadLayers(store(junk)), LAYER_IDS, junk);
  const blocked = {getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }};
  assert.deepEqual(loadLayers(blocked), LAYER_IDS);
  assert.doesNotThrow(() => saveLayers(['power'], blocked));
});

test('an open panel is shifted into the window with 8px to spare, its left edge kept in view', () => {
  assert.equal(shiftIntoWindow(855, 1207, 1280), 0, 'already inside');
  assert.equal(shiftIntoWindow(1137, 1504, 1280), -232, 'past the right edge: its right edge to 1272');
  assert.equal(shiftIntoWindow(-40, 300, 1280), 48, 'past the left edge: its left edge to 8');
  assert.equal(shiftIntoWindow(20, 372, 375), -5, 'inside the window but not the margin');
  assert.equal(shiftIntoWindow(20, 500, 375), -12, 'wider than the window: the left edge wins (to 8)');
  assert.equal(shiftIntoWindow(300, 400, 500, 0), 0, 'no margin');
});

test('a cable belongs to power or to data, and a part to managers, PDUs or no layer', () => {
  for (const m of ['power', 'ground']) assert.equal(layerOfMedia(m), 'power', m);
  for (const m of ['cat6a', 'sm-fibre', 'dac', undefined]) assert.equal(layerOfMedia(m), 'data', String(m));
  assert.equal(layerOfKind('cable manager'), 'managers');
  assert.equal(layerOfKind('pdu'), 'pdus');
  for (const k of ['switch', 'router', 'server', 'patch panel', 'optical', 'network device', undefined]) assert.equal(layerOfKind(k), null, String(k));
});
