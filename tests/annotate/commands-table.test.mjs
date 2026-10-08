// tests/annotate/commands-table.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {COMMANDS} from '../../site/annotate/commands.js';

test('every command and every argument is described, briefly', () => {
  for (const [op, def] of Object.entries(COMMANDS)) {
    assert.ok(def.description && def.description.length <= 500, `${op}: description`);
    const walk = (schema, at) => {
      for (const [k, s] of Object.entries(schema.properties || {})) {
        assert.ok(s.description && s.description.length <= 150, `${op}: ${at}${k} needs a description under 150 characters`);
        walk(s, `${at}${k}.`);
      }
    };
    walk(def.args, '');
  }
});
