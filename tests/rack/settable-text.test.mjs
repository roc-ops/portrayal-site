// tests/rack/settable-text.test.mjs
// WHAT AN AGENT IS TOLD OF A PART'S LAMPS, DIGITS, OUTLETS AND DISPLAYS (kit 0.45.0 and 0.47.0: inspect's
// `settable`, `states` and `displays`). The kit's answer is plain data; these hold the words the site
// says it in: runs of numbered paths are one entry, what is set now comes first, a display says what it
// takes and what it shows, and an answer that does not fit is paged with these as sections of their own.
import test from 'node:test';
import assert from 'node:assert/strict';
import {settableLines, displayLines, inspectText, zeroUText, INSPECT_SECTIONS, LIMIT} from '../../site/rack/agent-text.js';

const ports = n => Array.from({length: n}, (_, i) => `led-port-${i}/lamp`);
const SWITCH = {kind: 'item', id: 'i1', ref: 's9700-53dx', model: 'S9700-53DX', manufacturer: 'UfiSpace', label: 'spine-1', cfg: 'ac', ru: 30, face: 'front',
  configs: [], bays: [], cages: [], fields: [], cables: [],
  states: {'led-sys': 'ok', 'led-port-3/lamp': 'on'},
  settable: [{can: ['off', 'ok', 'boot-failed'], paths: ['led-sys', 'led-sys/lamp']}, {can: ['off', 'on'], paths: ports(53)},
    {can: ['blank', '0', '1'], paths: ['status-display/digit-1', 'status-display/digit-2']}]};

test('what a part can be set to is said by vocabulary, a hundred lamps as one run', () => {
  const lines = settableLines(SWITCH);
  assert.equal(lines[0], 'set now: led-sys ok, led-port-3/lamp on');
  assert.ok(lines.includes('led-sys, led-sys/lamp can be off, ok or boot-failed'), lines.join('\n'));
  assert.ok(lines.includes('led-port-0..52/lamp can be off or on'), lines.join('\n'));
  assert.ok(lines.includes('status-display/digit-1..2 can be blank, 0 or 1'), lines.join('\n'));
  assert.ok(lines.every(l => l.length < 200), 'a line stays short');
});

test('a part with nothing to set says nothing', () => {
  assert.deepEqual(settableLines({}), []);
  assert.deepEqual(displayLines({}), []);
});

const LCD = {path: 'network-module/module/lcd', kind: 'pixel', columns: 19, rows: null, takes: ['text', 'image'],
  text: 'a pixel display (text or an image, 19 columns)', shows: null};

test('a display says what it takes and what it shows', () => {
  assert.deepEqual(displayLines({displays: [LCD]}), ['network-module/module/lcd: a pixel display (text or an image, 19 columns); shows nothing']);
  const shows = displayLines({displays: [{...LCD, shows: {text: ['PDU-A', '192.0.2.17']}}]});
  assert.equal(shows.length, 1);
  assert.match(shows[0], /; shows \{"text":\["PDU-A","192\.0\.2\.17"\]\}$/);
  // a picture is a data URL: never the whole of it in an answer
  const pic = displayLines({displays: [{...LCD, shows: {image: `data:image/png;base64,${'A'.repeat(5000)}`}}]});
  assert.ok(pic[0].length < 260, `${pic[0].length}`);
});

test('inspect gives them as sections of their own, before the cables', () => {
  assert.deepEqual(INSPECT_SECTIONS, ['bays', 'cages', 'fields', 'settable', 'displays', 'cables']);
  const text = inspectText({...SWITCH, displays: [LCD]});
  assert.match(text, /\nLamps, digits and outlets state\.set takes:\nset now: led-sys ok/);
  assert.match(text, /\nDisplays display\.set takes:\nnetwork-module\/module\/lcd: a pixel display/);
  assert.ok(text.length <= LIMIT, `${text.length}`);
});

test('the settable section pages like the others: asked for by name, it starts there', () => {
  const big = {...SWITCH, cables: Array.from({length: 120}, (_, i) => ({id: `c${i}`, end: 'a', path: `port-${i}`, view: 'front', other: 'i2'})), displays: [LCD]};
  const first = inspectText(big, {ask: {id: 'i1'}});
  assert.match(first, /^Part of i1: /);
  const at = inspectText(big, {section: 'settable', offset: 0, ask: {id: 'i1'}});
  assert.match(at, /^Part of i1: settable 1-/);
  assert.ok(at.length <= LIMIT, `${at.length}`);
});

test('a part beside the rack says its lamps and its display in its own answer', () => {
  const z = {id: 'z1', ref: 'evma8365x', label: 'PDU-A', cfg: 'base', at: 'left-rear', ru: 1, manufacturer: 'Eaton', model: 'EVMA8365X',
    states: {'outlet-a1': 'on'}, settable: [{can: ['on', 'off'], paths: ['outlet-a1', 'outlet-a2', 'breaker-a/rocker']}], displays: [LCD]};
  const text = zeroUText(z);
  assert.match(text, /Lamps, digits and outlets state\.set takes:\nset now: outlet-a1 on\nbreaker-a\/rocker, outlet-a1\.\.2 can be on or off/);
  assert.match(text, /Displays display\.set takes:\nnetwork-module\/module\/lcd: a pixel display/);
  assert.match(text, /Move it with zerou\.update/);
});
