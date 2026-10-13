import test from 'node:test';
import assert from 'node:assert/strict';
import {american, normalizeHex, isColorField, ownerOf} from '../../site/colors.js';
import {editSchema, rackTools} from '../../site/rack/agent-tools.js';
import {COMMANDS} from '../../vendor/rack/commands.js';

test('american spells color the US way and leaves saved keys alone', () => {
  assert.equal(american('Latch colour'), 'Latch color');
  assert.equal(american('colour, Colours and COLOURED'), 'color, Colors and COLORED');
  assert.equal(american('latch-color'), 'latch-color');
  assert.equal(american(null), null);
});

test('normalizeHex takes what a color input holds, and three digits', () => {
  assert.equal(normalizeHex('#C22F2F'), '#c22f2f');
  assert.equal(normalizeHex('c22f2f'), '#c22f2f');
  assert.equal(normalizeHex('#abc'), '#aabbcc');
  for (const bad of ['', '#12', '#12345', '#1234567', 'red', '#ggg', null, undefined])
    assert.equal(normalizeHex(bad), null, String(bad));
});

test('a color field is a text field whose default is a hex', () => {
  assert.ok(isColorField({default: '#6f6f6f', type: 'text'}));
  assert.ok(!isColorField({default: '', type: 'text'}));
  assert.ok(!isColorField({default: 6.9, type: 'number'}));
  assert.ok(!isColorField(undefined));
});

test('the nearest enclosing part that declares a key owns it', () => {
  const has = new Set(['port-29-occupant:latch-color', 'port-29-occupant/tab:latch-color',
                       'port-29-occupant:label']);
  const declares = (p, k) => has.has(`${p}:${k}`);
  assert.equal(ownerOf('port-29-occupant/tab', 'latch-color', declares), 'port-29-occupant');
  assert.equal(ownerOf('port-29-occupant', 'latch-color', declares), 'port-29-occupant');
  assert.equal(ownerOf('port-29-occupant/tab', 'other', declares), 'port-29-occupant/tab');
  const deep = new Set(['card/port-1-occupant:latch-color']);
  assert.equal(ownerOf('card/port-1-occupant/tab/grip', 'latch-color', (p, k) => deep.has(`${p}:${k}`)),
               'card/port-1-occupant');
});

test('what an agent reads of the field command says color', () => {
  const text = JSON.stringify(editSchema(COMMANDS));
  assert.ok(!/colour/i.test(text), text.match(/.{0,40}colour.{0,40}/i)?.[0]);
  assert.match(text, /latch color/);
  assert.ok(typeof rackTools === 'function');
});
