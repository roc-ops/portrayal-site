// THE DCIM EXPORTS, PACKED.
//
// A device type's YAML is not served as a file of its own. tools/pack-assets.py
// puts every YAML of one target and one manufacturer into one JSON,
// assets/exports/packs/<target>/<manufacturer>.json, a map of the path that
// files.json and index.json list (`netbox/device-types/APC/AP7821B.yaml`) to the
// file's text. A path in those lists is a name inside a pack, not a URL, so every
// page that wants a file's text asks here. check-contract.py holds `packOf` and
// pack-assets.py to the same pack for every path in files.json.

const BASE = 'assets/exports/';
const PACKS = new Map();   // pack URL -> the promise of its map

/** The URL of the pack `rel` is in. The manufacturer is the folder name as the
 *  exporter wrote it, which is the one above the file in every target. */
export function packOf(rel) {
  const parts = rel.split('/');
  return `${BASE}packs/${encodeURIComponent(parts[0])}/${encodeURIComponent(parts.at(-2))}.json`;
}

function load(url) {
  if (!PACKS.has(url)) {
    PACKS.set(url, fetch(url).then(async r => {
      if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
      const pack = await r.json();
      if (!pack || typeof pack !== 'object' || Array.isArray(pack)) throw new Error(`${url}: not a pack`);
      return pack;
    }).catch(err => {
      // A failure must not be remembered, or one flaky load poisons the page.
      PACKS.delete(url);
      throw err;
    }));
  }
  return PACKS.get(url);
}

/** The text of the export `rel`. Each pack is fetched once per page.
 *  Throws if its pack cannot be fetched or parsed (the next call fetches again);
 *  null if the pack loaded and does not hold `rel`. */
export async function exportText(rel) {
  const pack = await load(packOf(rel));
  return Object.hasOwn(pack, rel) && typeof pack[rel] === 'string' ? pack[rel] : null;
}
