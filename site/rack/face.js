// ONE DEVICE FACE, AS CONFIGURED. Every consumer that draws or exports a
// specific device - the 2D elevation, draw.io, Explorer's download, and the
// Rack Builder - asks here, so none of them can show the base build while
// another shows the cards and optics the reader seated.
//
//   configuredFace({ref, cfg, view, swaps, fields, turned})
//
// fetches <ref>.<cfg>.<view>.svg and then, on a detached copy:
//   1. seats `swaps` through swap.js's seatFace - bays, then cages, then the
//      rear holes that show a swapped bay's back - on ANY view, not only the
//      front. (build2dElevation seated the front alone, which is how rear
//      plugs and PSUs went missing from the rear elevation.)
//   2. paints `fields` (an optic's latch color, its label) the way Explorer
//      does: shortest path first, on the part and on its projections.
//   3. reads ports and bays with drawio.js's readSvg, so a port on a seated
//      card or optic is a port like any other.
//
// `turned` means the device's other panel faces out, so front and rear swap.
// Resolves to null when the face was never compiled. Results are memoized on
// the whole argument and frozen: treat them as read-only.

import {jdist} from '../../vendor/dist.js';
import {seatFace} from '../../vendor/swap.js';
import {paintFields} from '../../vendor/fields.js';
import {readSvg, portsOf} from '../drawio.js';

export const DIST = 'assets/dist/';
const OPPOSITE = {front: 'rear', rear: 'front'};

let COMPONENTS = null;
export function components() {
  if (!COMPONENTS) {
    COMPONENTS = jdist(`${DIST}components.json`)
      .then(j => j.components || [])
      .catch(err => { console.warn('[portrayal] no component index', err); return []; });
  }
  return COMPONENTS;
}

const refKey = c => `${c.ns}/${c.name}@${c.major.slice(1)}`;
export const findComp = (list, ref) => list.find(c => refKey(c) === String(ref).split(':')[0]);

export async function loadSkin(ref) {
  const c = findComp(await components(), ref);
  if (!c) return null;
  const skin = c.skins?.includes('default') ? 'default' : c.skins?.[0];
  const r = await fetch(`${DIST}components/${c.ns}--${c.name}--${c.major}--${skin}.svg`);
  if (!r.ok) return null;
  return {comp: c, text: await r.text()};
}

export function applyFields(root, fields) {
  const entries = Object.entries(fields || {}).sort(([a], [b]) => a.length - b.length);
  for (const [path, vals] of entries) {
    const p = CSS.escape(path);
    for (const el of root.querySelectorAll(`[data-path="${p}"],[data-projection][data-of="${p}"]`))
      paintFields(el, vals);
  }
  return root;
}

const canon = v => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])]))
  : v;

const MEMO = new Map();
export function configuredFace({ref, cfg, view = 'front', swaps = {}, fields = {}, turned = false}) {
  const args = {ref, cfg, view, swaps: swaps || {}, fields: fields || {}, turned: !!turned};
  const key = JSON.stringify(canon(args));
  if (!MEMO.has(key)) {
    MEMO.set(key, build(args).catch(err => { MEMO.delete(key); throw err; }));
  }
  return MEMO.get(key);
}

async function build({ref, cfg, view, swaps, fields, turned}) {
  const shown = turned ? (OPPOSITE[view] || view) : view;
  const res = await fetch(`${DIST}${ref}.${cfg}.${shown}.svg`);
  if (!res.ok) return null;
  let text = await res.text();
  const seat = {applied: 0, refused: [], failed: []};
  const hasSwaps = Object.keys(swaps).length > 0;
  const hasFields = Object.keys(fields).length > 0;
  if (hasSwaps || hasFields) {
    const root = new DOMParser().parseFromString(text, 'image/svg+xml').documentElement;
    if (hasSwaps) {
      const idx = await jdist(`${DIST}${ref}.configs.json`);
      const list = await components();
      const r = await seatFace(root,
        {bays: idx?.bays?.[shown] || [], cages: idx?.cages?.[shown] || []},
        swaps, loadSkin, x => findComp(list, x));
      seat.applied = r.applied; seat.refused = r.refused; seat.failed = r.failed;
    }
    if (hasFields) applyFields(root, fields);
    text = new XMLSerializer().serializeToString(root);
  }
  const {vb, zones} = readSvg(text);
  return Object.freeze({ref, cfg, view: shown, text, vb, zones,
                        ports: portsOf(zones, {bays: true}), seat});
}
