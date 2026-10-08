// tests/annotate/describe.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {normalise} from '../../vendor/marks.js';
import {describe} from '../../site/annotate/describe.js';

test('describe names the target, the settings, and every mark with what it matched', () => {
  const d = normalise({device: 'as7946-30xb', config: 'dc', view: 'rear', crop: {x: 0, y: 0, w: 10, h: 5},
    marks: [{id: 'm1', select: '#psu-0', color: '#ff2d95', label: 'PSU'}, {select: '.nope', state: 'on'}]});
  const text = describe(d, [{index: 0, count: 1, total: 1}, {index: 1, count: 0, total: 0}]);
  assert.match(text, /^as7946-30xb, config dc, rear\. Legend on; cropped to 10 x 5 mm\./);
  assert.match(text, /m1 #psu-0, color #ff2d95, label "PSU": 1 part/);
  assert.match(text, /#1 \.nope, state on: matches nothing/);
});

test('describe stays under 1.5K characters and says what it shortened', () => {
  const marks = Array.from({length: 80}, (_, k) => ({id: `m${k}`, select: `[data-path='port-${k}']`, label: `uplink to spine ${k}`, color: '#ffd400'}));
  const d = normalise({device: 'x', marks});
  const text = describe(d, marks.map((_, k) => ({index: k, count: 1, total: 1})));
  assert.ok(text.length <= 1500, `${text.length}`);
  assert.match(text, /^Shortened: /m);
});

test('a document with no report yet says so rather than guessing counts', () => {
  const text = describe(normalise({device: 'x', marks: [{select: '#a'}]}), []);
  assert.match(text, /#0 #a: not drawn yet/);
});
