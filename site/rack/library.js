// THE RACK LIBRARY (spec §7.5): named racks in this browser's IndexedDB, not
// localStorage - a library of racks with their Explorer changes (and, later,
// cables) can outgrow localStorage's ~5 MB. Documents go in as the §5 file
// plus `updatedAt`, and come back through parseDoc, so a stored document is
// read exactly as an opened file is.
//
// NO INDEXEDDB (a private window, blocked storage): the library is off, every
// method is a no-op, and the page says so - Save and Open still work.

import {parseDoc, serialize} from '../../vendor/rack/model.js';
import {fileStem} from '../../vendor/rack/export-data.js';

// THE KIT'S READER, AND WHAT IT SAID. parseDoc keeps a narrow part's `side`
// and gives a zero-U entry with no id one of its own (kit 0.6.0), and migrates
// an older file (version 1, 2 or 3) to version 4 (kit 0.22.0: half-unit
// positions, and every key it does not know kept), which every save then writes.
// The sentences it gives for the bundles it repaired are not kept in the
// document: they are held here beside the document they came with, so the page
// can hand them to the editor's loadDoc (docNotes), which makes them its first
// findings. A document copied with a new id carries them over by hand.
//
// A FILE NEWER THAN THIS PAGE is refused by parseDoc with what the reader
// supports ("... this reader supports up to version N."), which says nothing of
// what to do: the kit cannot know a host can be reloaded (#895 upstream). This
// page can, so the refusal it shows - from Open and from the library alike -
// says so.
const NOTES = new WeakMap();
const TOO_NEW = /this reader supports up to version \d+\.$/;
export const RELOAD = 'Reload to get the newer page.';
export const docNotes = doc => (doc && NOTES.get(doc)) || [];
export function readDoc(input) {
  const notes = [];
  let doc;
  try { doc = parseDoc(input, {notes}); }
  catch (err) {
    if (TOO_NEW.test(err?.message || '')) err.message = `${err.message} ${RELOAD}`;
    throw err;
  }
  if (notes.length) NOTES.set(doc, notes);
  return doc;
}

const DB = 'portrayal-racks', STORE = 'docs';
const done = req => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

export async function openLibrary({idb = globalThis.indexedDB} = {}) {
  let db = null;
  try {
    if (idb) {
      const open = idb.open(DB, 1);
      open.onupgradeneeded = () => open.result.createObjectStore(STORE, {keyPath: 'id'});
      db = await done(open);
    }
  } catch (err) {
    console.warn('[portrayal] the rack library is unavailable', err);
    db = null;
  }
  const store = mode => db.transaction(STORE, mode).objectStore(STORE);
  return {
    available: !!db,
    async list() {
      if (!db) return [];
      const all = await done(store('readonly').getAll());
      return all.map(d => {
        // Read as get() reads it, so a migrated or older record lists by the
        // name it opens with; one that will not parse still lists as stored
        // (opening it says why).
        let name = d.racks?.[0]?.name ?? 'Rack';
        try { name = parseDoc(d).racks[0].name; } catch { /* listed as stored */ }
        return {id: d.id, name, updatedAt: d.updatedAt ?? 0};
      }).sort((a, b) => b.updatedAt - a.updatedAt);
    },
    async get(id) {
      if (!db) return null;
      const d = await done(store('readonly').get(id));
      if (!d) return null;
      // `updatedAt` IS THE LIBRARY'S OWN, written beside the document by put().
      // The reader keeps every key it does not know since rack file version 4
      // (kit 0.22.0), so handed the stored record it would keep this one as
      // the document's, and a saved rack file would carry it. It is taken off
      // before the record is read as a document.
      const {updatedAt: _stamp, ...doc} = d;
      return readDoc(doc);
    },
    // THE WRITE IS HANDED OVER BEFORE THIS RETURNS (#198). The record is made,
    // put and its transaction committed in the caller's own turn, before the
    // first await, so whatever the page does next (a redraw that holds the
    // thread for seconds, a reload) the browser already has the whole write and
    // finishes it without the page. Left to commit by itself, a transaction
    // waits for the page to come back to its event loop, and a page that is
    // reloaded first loses it. The promise settles when the transaction has:
    // a store that is full refuses there, not at the put.
    async put(doc) {
      if (!db) return;
      const tx = db.transaction(STORE, 'readwrite');
      const over = new Promise((res, rej) => {
        tx.oncomplete = () => res();
        tx.onabort = tx.onerror = () => rej(tx.error ?? new Error('the write was aborted'));
      });
      tx.objectStore(STORE).put({...JSON.parse(serialize(doc)), updatedAt: Date.now()});
      tx.commit?.();
      await over;
    },
    async remove(id) {
      if (!db) return;
      await done(store('readwrite').delete(id));
    },
  };
}

// EVERY EDIT IS WRITTEN AT ONCE (#198), by hand or through the page's tools.
// `save(doc)` hands the document to the library in the caller's own turn, so
// the write is with the browser before the redraw the edit asks for begins.
// It was a timer, 500 ms after the last edit of a burst, and the redraw ran
// first: a tab reloaded inside the redraw, or within half a second of any
// edit, came back without the edit, and the flush on `pagehide` could not
// help, because a page that is busy is not told it is going and IndexedDB has
// no write that finishes inside that event. One record a step is a few
// milliseconds for the largest rack; writes land in the order they were made.
//
// A WRITE THAT FAILS IS SAID, NOT LOGGED AND LOST: a full or blocked store
// refuses, and the person must hear it while Save (the file) can still keep
// their work. `onState({failed, error})` is called when a write fails and
// again when a later one lands; `failed()` is the same answer on demand.
// `flush()` settles when every write made so far has landed or failed.
export function autosaver(lib, {onState = () => {}} = {}) {
  let last = Promise.resolve(), failed = null, n = 0;
  const say = err => { const was = failed; failed = err; if (!!was !== !!err || (err && was !== err)) onState({failed: !!err, error: err}); };
  return {
    save(doc) {
      const mine = ++n;
      let put;
      try { put = Promise.resolve(lib.put(doc)); } catch (err) { put = Promise.reject(err); }
      // only the newest write speaks for the rack: an older one that lands late does not clear a newer failure
      const done = put.then(() => { if (mine === n) say(null); }, err => {
        console.warn('[portrayal] autosave', err);
        if (mine === n) say(err ?? new Error('the write failed'));
      });
      last = Promise.all([last, done]).then(() => {});
      return done;
    },
    flush: () => last,
    failed: () => failed,
  };
}

export const fileName = doc => `${fileStem(doc.racks[0]?.name)}.rack.json`;

export function downloadDoc(doc) {
  const url = URL.createObjectURL(new Blob([serialize(doc)], {type: 'application/json'}));
  const a = Object.assign(document.createElement('a'), {href: url, download: fileName(doc)});
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const readDocFile = async file => readDoc(await file.text());
