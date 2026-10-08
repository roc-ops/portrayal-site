import test from 'node:test';
import assert from 'node:assert/strict';
import {COMMANDS} from '../../site/rack/commands.js';
import {LIMIT, fit, ranges, editSchema, agentMay, EXPORT_KINDS} from '../../site/rack/agent-tools.js';

test('fit leaves short text alone and cuts long text at a whole line, saying how much', () => {
  assert.equal(fit('a\nb'), 'a\nb');
  const long = Array.from({length: 400}, (_, i) => `line ${i}`).join('\n');
  const out = fit(long);
  assert.ok(out.length <= LIMIT);
  assert.match(out, /^line 0\n/);
  assert.match(out, /\(\d+ more lines left out\.\)$/);
  assert.ok(fit('x'.repeat(5000)).length <= LIMIT);  // one huge line is still bounded
});

test('ranges reads runs as U ranges', () => {
  assert.equal(ranges([]), '');
  assert.equal(ranges([1, 2, 3, 5, 7, 8]), 'U1-U3, U5, U7-U8');
  assert.equal(ranges([9, 1, 2]), 'U1-U2, U9');
});

test('the edit_rack schema has one branch per command an agent may send', () => {
  const s = editSchema();
  const ops = s.properties.commands.items.oneOf.map(b => b.properties.op.const);
  const want = Object.keys(COMMANDS).filter(op => !COMMANDS[op].system && op !== 'dcim');
  assert.deepEqual(ops, want);
  assert.ok(!ops.includes('lengths.routed') && !ops.includes('dcim'));
  for (const b of s.properties.commands.items.oneOf) {
    assert.equal(b.required[0], 'op');
    for (const r of COMMANDS[b.properties.op.const].args.required ?? []) assert.ok(b.required.includes(r));
  }
  assert.deepEqual(s.required, ['commands']);
  assert.equal(s.properties.commands.maxItems, 50);
});

test('a command added to the table is offered with no other change', () => {
  const more = {...COMMANDS, 'shelf.add': {run: () => ({}), description: 'Add a shelf.', args: {type: 'object', required: ['ru'], properties: {ru: {type: 'integer'}}}}};
  assert.ok(editSchema(more).properties.commands.items.oneOf.some(b => b.properties.op.const === 'shelf.add'));
  assert.equal(agentMay('shelf.add', more), true);
  assert.equal(agentMay('dcim'), false);
  assert.equal(agentMay('lengths.routed'), false);
  assert.equal(agentMay('nope'), false);
});

test('every export kind maps to a page export key', () => {
  assert.deepEqual(EXPORT_KINDS, {
    'sheet svg': 'sheet-svg', 'front svg': 'front-svg', 'rear svg': 'rear-svg', 'sheet png': 'sheet-png',
    drawio: 'drawio', 'netbox import': 'netbox-import', 'nautobot import': 'nautobot-import',
    'bill of materials': 'bom', 'cable schedule': 'cables', 'rack file': 'json'});
});
