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
// the whole argument and DEEP-frozen - the top-level object, `vb`, `seat` and
// its arrays, and `zones`/`ports` themselves plus every zone/port object they
// hold - because the same result is handed to every caller that asked for the
// same key: one caller mutating a zone or pushing onto `ports` would corrupt
// what every other caller sees. Treat all of it as read-only.

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
    // `build` awaits several times (fetch, jdist, components) and, in the
    // showcase, the caller's `swaps`/`fields` are the SAME object it goes on
    // mutating in place afterward (applyPlanSeats, dropBelow, stage 2/3
    // doSeat all write into overrides[dev] rather than replacing it). Holding
    // onto `args` itself would let a build in flight read the mutated object
    // after an await and cache a wrong face under the key computed before the
    // mutation - a sticky wrong face for the rest of the session. `key` is
    // already a canonical JSON string of a plain deep copy, so parsing it
    // back gives `build` its own snapshot, immune to later mutation.
    MEMO.set(key, build(JSON.parse(key)).catch(err => { MEMO.delete(key); throw err; }));
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
  const ports = portsOf(zones, {bays: true});
  return deepFreeze({ref, cfg, view: shown, text, vb, zones, ports, seat});
}

// Freezes the result AND everything reachable inside it - `vb` (an array of
// numbers), `seat` and its `refused`/`failed` arrays, and `zones`/`ports`
// (two arrays that share the same zone objects) plus every zone/port object
// they hold. `ports` and `zones` overlap, so a zone is frozen once and the
// second freeze is a cheap no-op.
function deepFreeze(v) {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    for (const k of Object.keys(v)) deepFreeze(v[k]);
    Object.freeze(v);
  }
  return v;
}
