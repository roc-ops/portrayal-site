import test from 'node:test';
import assert from 'node:assert/strict';
import {touchedIds, markTouched} from '../../site/rack/agent-mark.js';

// An element with the one thing markTouched uses of a DOM element: a class attribute that, as in a browser, stays
// behind as class="" once its last class is taken off.
function drawnElement() {
  let cls = null;
  const names = () => (cls ?? '').split(/\s+/).filter(Boolean);
  return {
    classList: { toggle(name, on) {
      const has = names().includes(name);
      if (on && !has) cls = [...names(), name].join(' ');
      else if (!on && has) cls = names().filter(n => n !== name).join(' ');
    } },
    getAttribute: name => (name === 'class' ? cls : null),
    removeAttribute(name) { if (name === 'class') cls = null; },
  };
}

test('the mark taken off leaves the element as it was drawn, with no empty class attribute', () => {
  globalThis.CSS ??= {escape: s => s};
  const el = drawnElement();
  const root = {querySelectorAll: () => [el]};
  markTouched(root, ['i1'], true);
  assert.equal(el.getAttribute('class'), 'rk-agent-touched');
  markTouched(root, ['i1'], false);
  assert.equal(el.getAttribute('class'), null, 'a drawn again element has no class attribute; the marked one must not keep class=""');
});

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
