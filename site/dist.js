// WHERE THE LIBRARY'S DRAWINGS ARE READ FROM.
//
// The site serves Portrayal's library as packs, not one file per drawing: the
// host takes a limited number of files per version, and a device's faces are
// many files and one or two packs. refresh-assets.sh writes them with
// Portrayal's own spec/tools/dev/dist_packs.py into assets/dist/packs/, and
// the kit reads them through `packedDist` and `fetchDist` (vendor/dist.js).
//
// So a page gives the kit `await siteDist()`, a path -> URL function, where it
// used to give it 'assets/dist/', and reads any URL that function makes with
// `fetchDist`: a bare `fetch` of one gets the whole pack. The indexes and the
// other JSON (devices.json, <device>.configs.json, ...) are plain files at the
// same URLs as before, and the function answers them with the plain URL.
//
// THE FILES tools/pack-assets.py KEEPS LOOSE (KEEP_PLAIN) are read through the
// plain base, DIST, never through siteDist: it would send them to a pack, and
// no pack holds a plain `<device>.<view>.svg`. check-contract.py holds both.
import {packedDist, fetchDist} from '../vendor/dist.js';
export {fetchDist};

/** Where this site serves the library, from a page at the site root. */
export const DIST = 'assets/dist/';

const MADE = new Map();

/** The library's path -> URL function over the packs under `base`, made once
 *  per page and shared. A failed load is not remembered. */
export function siteDist(base = DIST) {
  const key = new URL(base, location.href).href;
  if (!MADE.has(key)) {
    const made = packedDist(base);
    MADE.set(key, made);
    made.catch(() => { if (MADE.get(key) === made) MADE.delete(key); });
  }
  return MADE.get(key);
}

/** A drawing's URL as an object URL, for an <img src>: an image element cannot
 *  read a pack. The caller revokes it when the image changes. */
export async function distObjectUrl(url) {
  const r = await fetchDist(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return URL.createObjectURL(await r.blob());
}
