import test from 'node:test';
import assert from 'node:assert/strict';
import {touchedIds} from '../../site/rack/agent-mark.js';

const rack = (items, cables = []) => ({items: items.map(id => ({id})), cables: cables.map(id => ({id}))});

test('touched: every command id, plus what the change created', () => {
  const ev = {commands: [{op: 'move', id: 'i1', ru: 3}, {op: 'cable.add', a: {item: '@x'}, b: {item: 'i1'}}],
              before: rack(['i1']), after: rack(['i1', 'i2'], ['c1'])};
  assert.deepEqual(touchedIds(ev).sort(), ['c1', 'i1', 'i2']);
});

test('a cable end\'s item is not counted, and removed ids are harmless', () => {
  const ev = {commands: [{op: 'remove', id: 'i2', cables: 'remove'}, {op: 'cable.update', id: 'c1', label: 'x'}],
              before: rack(['i1', 'i2'], ['c1']), after: rack(['i1'], ['c1'])};
  assert.deepEqual(touchedIds(ev).sort(), ['c1', 'i2']);
});
