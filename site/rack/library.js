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
// a version 1 or 2 file to version 3 (0.7.0), which every save then writes.
// The sentences it gives for the bundles it repaired are not kept in the
// document: they are held here beside the document they came with, so the page
// can hand them to the editor's loadDoc (docNotes), which makes them its first
// findings. A document copied with a new id carries them over by hand.
const NOTES = new WeakMap();
export const docNotes = doc => (doc && NOTES.get(doc)) || [];
export function readDoc(input) {
  const notes = [];
  const doc = parseDoc(input, {notes});
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
      return d ? readDoc(d) : null;
    },
    async put(doc) {
      if (!db) return;
      await done(store('readwrite').put({...JSON.parse(serialize(doc)), updatedAt: Date.now()}));
    },
    async remove(id) {
      if (!db) return;
      await done(store('readwrite').delete(id));
    },
  };
}

// The last of a burst of edits is written, once, `delay` ms after it.
export function autosaver(lib, delay = 500) {
  let timer = null, pending = null, last = Promise.resolve();
  const flush = () => {
    clearTimeout(timer); timer = null;
    if (pending) {
      const doc = pending; pending = null;
      last = lib.put(doc).catch(err => console.warn('[portrayal] autosave', err));
    }
    return last;
  };
  return {saveSoon(doc) { pending = doc; clearTimeout(timer); timer = setTimeout(flush, delay); }, flush};
}

export const fileName = doc => `${fileStem(doc.racks[0]?.name)}.rack.json`;

export function downloadDoc(doc) {
  const url = URL.createObjectURL(new Blob([serialize(doc)], {type: 'application/json'}));
  const a = Object.assign(document.createElement('a'), {href: url, download: fileName(doc)});
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const readDocFile = async file => readDoc(await file.text());
