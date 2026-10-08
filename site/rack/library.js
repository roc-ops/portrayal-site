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
import {keepSiteFields} from './zero-u.js';

// The kit's reader, with what it does not keep put back (zero-u.js): a
// narrow part's `side`, and an id for a zero-U part written without one.
export const readDoc = input => keepSiteFields(input, parseDoc(input));

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
