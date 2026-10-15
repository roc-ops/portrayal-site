// portrayal-site#194: a cross-face tag too long for its pill is shortened in
// the middle of a part, never at its end, where what tells two tags apart is.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fitText} from '../../site/rack/bundle-view.js';

const fitTag = (parts, cut) => fitText(parts, cut, 33);

const len = s => Array.from(s).length;

test('a text that fits is as it was given', () => {
  assert.equal(fitTag(['→ ', 'demarc', '', ' ', 'port-2-1'], [1, 4]), '→ demarc port-2-1');
});

test('a long device name loses its middle; its U and the port stay whole', () => {
  const t = fitTag(['→ ', 'a-rather-long-device-label-'.repeat(5), ' U14', ' ', 'port-2-1'], [1, 4]);
  assert.ok(len(t) <= 33 && t.startsWith('→ a-rather') && t.endsWith(' U14 port-2-1') && t.includes('…'), t);
});

test('two bundles whose names differ at the end still read apart: the first part named is cut first', () => {
  const tag = name => fitTag(['→ ', 'AS7816-64X', ' U40', ' ×12 · ', name], [1, 4]);
  const [a, b] = [tag('PP Bay 1 rear'), tag('PP Bay 2 rear')];
  assert.ok(len(a) <= 33 && len(b) <= 33 && a !== b, `${a} | ${b}`);
  assert.ok(a.endsWith('PP Bay 1 rear') && b.endsWith('PP Bay 2 rear'));
});

test('when the first part cannot give enough, the next is cut too', () => {
  const t = fitTag(['→ ', 'sw', '', ' ', 'bay-1/module/a-very-long-path-to-a-port-far-inside/lc01'], [1, 4]);
  assert.ok(len(t) <= 33 && t.startsWith('→ sw bay-1') && t.endsWith('lc01'), t);
});
