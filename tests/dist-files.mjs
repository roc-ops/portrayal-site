// THE SITE'S assets/dist/, READ FROM DISK AS A PAGE READS IT.
//
// The faces and skins are served as packs (assets/dist/packs/, written by
// Portrayal's spec/tools/dev/dist_packs.py); the JSON and the few drawings
// tools/pack-assets.py keeps loose (PLAIN_FILES) are plain files. A test that
// wants a file of the dist asks here, by its dist path, and gets the loose file
// or the entry of the pack that holds it, routed as the kit's fetchDist routes
// a packedDist URL (vendor/dist.js): a face by its device's configs[].files to
// the default pack or the second, a skin to the chunk components/index.json
// picks. A path no file and no pack holds throws, as readFileSync does.
import {readFileSync, existsSync, readdirSync} from 'node:fs';

const DIST = new URL('../assets/dist/', import.meta.url);
const PACKS = new URL('packs/', DIST);
const parsed = new Map();

function pack(rel) {
  if (!parsed.has(rel)) {
    const url = new URL(rel, PACKS);
    parsed.set(rel, existsSync(url) ? JSON.parse(readFileSync(url, 'utf8')) : null);
  }
  return parsed.get(rel);
}

const held = (p, path) => (p?.files && Object.hasOwn(p.files, path) ? p.files[path] : undefined);

function skinPack(path) {
  const skin = path.slice('components/'.length);
  const ns = skin.split('--')[0];
  const index = pack('components/index.json') || {};
  const firsts = Object.hasOwn(index, ns) ? index[ns] : [];
  let lo = 0, hi = firsts.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (firsts[mid] <= skin) lo = mid + 1; else hi = mid;
  }
  return `components/${ns}.${lo + 1}.json`;
}

function faceText(path) {
  const device = path.split('.')[0];
  const dflt = `devices/${device}.json`, more = `devices/${device}.more.json`;
  const cfgUrl = new URL(`${device}.configs.json`, DIST);
  const idx = existsSync(cfgUrl) ? JSON.parse(readFileSync(cfgUrl, 'utf8')) : null;
  const configs = idx?.configs;
  if (Array.isArray(configs) && configs.length && configs.every(c => c?.files && typeof c.files === 'object')) {
    const d = configs.find(c => c.name === idx.default);
    if (d) {
      if (Object.values(d.files).includes(path)) return held(pack(dflt), path);
      if (!configs.some(c => Object.values(c.files).includes(path))) return undefined;
      return held(pack(more), path);
    }
  }
  const first = pack(dflt);
  const text = held(first, path);
  return text !== undefined || !first?.more ? text : held(pack(more), path);
}

/** The text of `path` under assets/dist/: the loose file, or its pack entry. */
export function readDistFile(path) {
  const loose = new URL(path, DIST);
  if (existsSync(loose)) return readFileSync(loose, 'utf8');
  const text = path.startsWith('components/') ? held(pack(skinPack(path)), path)
    : path.endsWith('.svg') ? faceText(path) : undefined;
  if (text === undefined) {
    throw Object.assign(new Error(`ENOENT: no loose file and no pack entry for assets/dist/${path}`), {code: 'ENOENT'});
  }
  return text;
}

/** [{f, text}] for every device face the site serves, loose or in a pack, by name. */
export function distFaces() {
  const out = new Map();
  for (const f of readdirSync(DIST).filter(f => f.endsWith('.svg'))) out.set(f, readFileSync(new URL(f, DIST), 'utf8'));
  const devices = new URL('devices/', PACKS);
  for (const p of existsSync(devices) ? readdirSync(devices).filter(f => f.endsWith('.json')).sort() : []) {
    for (const [f, text] of Object.entries(JSON.parse(readFileSync(new URL(p, devices), 'utf8')).files || {})) {
      if (!out.has(f)) out.set(f, text);
    }
  }
  return [...out].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([f, text]) => ({f, text}));
}
