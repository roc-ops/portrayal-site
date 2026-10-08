import test from 'node:test';
import assert from 'node:assert/strict';
import {modelContext, registerTools} from '../../site/agent/webmcp.js';

const withDocument = async (doc, fn) => {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {value: doc, configurable: true});
  try { return await fn(); } finally {
    if (had) Object.defineProperty(globalThis, 'document', had); else delete globalThis.document;
  }
};
const recorder = (fail = new Set()) => {
  const got = [];
  return {got, registerTool: async (t, o) => { if (fail.has(t.name)) throw new Error('nope'); got.push([t.name, o?.signal]); }};
};
const tool = name => ({name, description: name, inputSchema: {type: 'object'}, execute: async () => ({content: []})});

test('no model context: nothing registered, no throw', async () => {
  await withDocument({}, async () => {
    assert.equal(modelContext(), null);
    assert.deepEqual(await registerTools([tool('a')]), {registered: 0});
  });
});

test('document.modelContext: every tool registered with the signal', async () => {
  const mc = recorder(), ac = new AbortController();
  await withDocument({modelContext: mc}, async () => {
    assert.equal(modelContext(), mc);
    assert.deepEqual(await registerTools([tool('a'), tool('b')], {signal: ac.signal}), {registered: 2});
    assert.deepEqual(mc.got, [['a', ac.signal], ['b', ac.signal]]);
  });
});

test('one tool that fails to register is skipped and named', async () => {
  const mc = recorder(new Set(['b']));
  await withDocument({modelContext: mc}, async () => {
    const res = await registerTools([tool('a'), tool('b'), tool('c')]);
    assert.equal(res.registered, 2);
    assert.match(res.error, /^b: nope$/);
  });
});
