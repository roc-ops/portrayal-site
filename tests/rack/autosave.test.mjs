// AN EDIT IS WRITTEN AT ONCE (portrayal-site#198): site/rack/library.js.
// The write is with the store before the caller's turn ends (so before the
// redraw an edit asks for), its transaction is committed there and then, and a
// write the store refuses is said, not lost. The browser checks
// (check_rack_edit_survives_reload, check_rack_save_failure_said) hold the
// same against a real IndexedDB and a real reload.
import test from 'node:test';
import assert from 'node:assert/strict';
import {openLibrary, autosaver} from '../../site/rack/library.js';
import {newDoc} from '../../vendor/rack/model.js';

// An IndexedDB of one store, which records what is asked of it in order and
// finishes a transaction only when the test says so.
function fakeIdb({refuse = () => null} = {}) {
  const log = [], open = [], records = new Map();
  const db = {
    transaction(name, mode) {
      const tx = {mode, error: null, committed: false, oncomplete: null, onabort: null, onerror: null,
        objectStore: () => ({
          put(rec) { log.push(['put', rec.id, rec.racks[0].name]); tx.rec = structuredClone(rec); return {}; },
          get(id) { const req = {}; queueMicrotask(() => { req.result = records.get(id); req.onsuccess?.(); }); return req; },
        }),
        commit() { tx.committed = true; log.push(['commit', tx.rec?.id ?? null]); },
        finish() {
          const err = tx.rec ? refuse(tx.rec) : null;
          if (err) { tx.error = err; tx.onabort?.(); } else { if (tx.rec) records.set(tx.rec.id, tx.rec); tx.oncomplete?.(); }
        }};
      if (mode === 'readwrite') open.push(tx);
      return tx;
    }};
  const idb = {open() { const req = {result: db}; queueMicrotask(() => req.onsuccess?.()); return req; }};
  return {idb, log, open, records, finishAll() { for (const tx of open.splice(0)) tx.finish(); }};
}
const named = (doc, name) => ({...doc, racks: [{...doc.racks[0], name}]});
const tick = () => new Promise(r => setTimeout(r, 0));

test('put hands the record over and commits its transaction before it first waits', async () => {
  const f = fakeIdb(), lib = await openLibrary({idb: f.idb}), doc = newDoc({name: 'Alpha'});
  const p = lib.put(doc);
  // nothing has been awaited: the page could start a long redraw on the next line
  assert.deepEqual(f.log, [['put', doc.id, 'Alpha'], ['commit', doc.id]]);
  assert.equal(f.open[0].committed, true);
  let settled = false; p.then(() => { settled = true; });
  await tick();
  assert.equal(settled, false, 'the promise waits for the transaction, not for the request');
  f.finishAll(); await p;
  assert.equal(f.records.get(doc.id).racks[0].name, 'Alpha');
  assert.equal(typeof f.records.get(doc.id).updatedAt, 'number');
});

test('put rejects with the reason when the transaction is aborted (a full store refuses at the commit)', async () => {
  const full = Object.assign(new Error('The quota has been exceeded.'), {name: 'QuotaExceededError'});
  const f = fakeIdb({refuse: () => full}), lib = await openLibrary({idb: f.idb});
  const p = lib.put(newDoc({name: 'Alpha'}));
  f.finishAll();
  await assert.rejects(p, e => e === full);
});

test('save writes in the turn it is called in: no timer stands between an edit and its write', async () => {
  const f = fakeIdb(), lib = await openLibrary({idb: f.idb}), doc = newDoc({name: 'Alpha'});
  const save = autosaver(lib);
  save.save(named(doc, 'Alpha 2'));
  assert.deepEqual(f.log, [['put', doc.id, 'Alpha 2'], ['commit', doc.id]]);
  save.save(named(doc, 'Alpha 3'));
  assert.equal(f.log.length, 4, 'each edit is its own write, made at once');
  let flushed = false; const fl = save.flush().then(() => { flushed = true; });
  await tick();
  assert.equal(flushed, false, 'flush waits for every write made so far');
  f.finishAll(); await fl;
  assert.equal(f.records.get(doc.id).racks[0].name, 'Alpha 3', 'the last write made is the record kept');
  assert.equal(save.failed(), null);
});

test('a write that fails is said once, stays said, and is unsaid when a later write lands', async () => {
  let full = true;
  const err = Object.assign(new Error('The quota has been exceeded.'), {name: 'QuotaExceededError'});
  const f = fakeIdb({refuse: () => (full ? err : null)}), lib = await openLibrary({idb: f.idb}), doc = newDoc({name: 'Alpha'});
  const states = [], warn = console.warn;
  console.warn = () => {};
  try {
    const save = autosaver(lib, {onState: s => states.push(s.failed)});
    const p = save.save(named(doc, 'Alpha 2'));
    f.finishAll(); await p;                      // never a rejection for the page to catch
    assert.deepEqual(states, [true]);
    assert.equal(save.failed(), err);
    const q = save.save(named(doc, 'Alpha 3'));
    f.finishAll(); await q;
    assert.deepEqual(states, [true], 'still failing: not said again');
    full = false;
    const r = save.save(named(doc, 'Alpha 4'));
    f.finishAll(); await r; await save.flush();
    assert.deepEqual(states, [true, false]);
    assert.equal(save.failed(), null);
  } finally { console.warn = warn; }
});

test('an older write that lands late does not unsay a newer failure', async () => {
  const err = new Error('refused');
  const f = fakeIdb({refuse: rec => (rec.racks[0].name === 'second' ? err : null)}), lib = await openLibrary({idb: f.idb}), doc = newDoc({name: 'Alpha'});
  const warn = console.warn; console.warn = () => {};
  try {
    const save = autosaver(lib);
    save.save(named(doc, 'first')); save.save(named(doc, 'second'));
    const [a, b] = f.open.splice(0);
    b.finish(); await tick();
    assert.equal(save.failed(), err);
    a.finish(); await save.flush();
    assert.equal(save.failed(), err, 'the newest write speaks for the rack');
  } finally { console.warn = warn; }
});

test('a library that throws in put is a failed save, and a library that is off saves nothing and fails nothing', async () => {
  const warn = console.warn; console.warn = () => {};
  try {
    const boom = new Error('no store');
    const save = autosaver({put() { throw boom; }});
    await save.save(newDoc());
    assert.equal(save.failed(), boom);
  } finally { console.warn = warn; }
  const off = await openLibrary({idb: null});
  const save = autosaver(off);
  await save.save(newDoc());
  assert.equal(save.failed(), null);
});
