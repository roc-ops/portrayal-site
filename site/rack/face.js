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
//   3. reads ports and bays with zones.js's readSvg, so a port on a seated
//      card or optic is a port like any other.
//
// `turned` means the device's other panel faces out, so front and rear swap.
// Resolves to null when the face was never compiled. Results are memoized on
// the whole argument and DEEP-frozen - the top-level object, `vb`, `seat` and
// its arrays, and `zones`/`ports` themselves plus every zone/port object they
// hold - because the same result is handed to every caller that asked for the
// same key: one caller mutating a zone or pushing onto `ports` would corrupt
// what every other caller sees. Treat all of it as read-only.

import {faceUrl} from '../faces.js';
import {jdist} from '../../vendor/dist.js';
import {seatFace} from '../../vendor/swap.js';
import {paintFields} from '../../vendor/fields.js';
import {readSvg, portsOf} from '../../vendor/zones.js';

export const DIST = 'assets/dist/';
const OPPOSITE = {front: 'rear', rear: 'front'};

let COMPONENTS = null;
export function components() {
  if (!COMPONENTS) {
    COMPONENTS = jdist(`${DIST}components.json`)
      .then(j => j.components || [])
      .catch(err => {
        // Not remembered: the next ask fetches again. A cached [] meant one
        // hiccup left every card and optic unseatable until a reload.
        console.warn('[portrayal] no component index', err);
        COMPONENTS = null;
        return [];
      });
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

// BOUNDED, least recently asked-for out first. The Rack Builder asks for any
// device in any configuration for as long as the page stays open; each entry
// holds a whole face's SVG text.
export const FACE_MEMO_LIMIT = 200;
let limit = FACE_MEMO_LIMIT;
const MEMO = new Map();
export const setFaceMemoLimit = n => { limit = Math.max(1, n); while (MEMO.size > limit) MEMO.delete(MEMO.keys().next().value); };
export const faceMemoSize = () => MEMO.size;

export function configuredFace({ref, cfg, view = 'front', swaps = {}, fields = {}, turned = false}) {
  const args = {ref, cfg, view, swaps: swaps || {}, fields: fields || {}, turned: !!turned};
  const key = JSON.stringify(canon(args));
  // `build` awaits several times (fetch, jdist, components) and, in the
  // showcase, the caller's `swaps`/`fields` are the SAME object it goes on
  // mutating in place afterward (applyPlanSeats, dropBelow, stage 2/3
  // doSeat all write into overrides[dev] rather than replacing it). Holding
  // onto `args` itself would let a build in flight read the mutated object
  // after an await and cache a wrong face under the key computed before the
  // mutation - a sticky wrong face for the rest of the session. `key` is
  // already a canonical JSON string of a plain deep copy, so parsing it
  // back gives `build` its own snapshot, immune to later mutation.
  let hit = MEMO.get(key);
  if (hit) {
    MEMO.delete(key);            // re-insert: Map order is recency
  } else {
    hit = build(JSON.parse(key)).catch(err => { MEMO.delete(key); throw err; });
  }
  MEMO.set(key, hit);
  while (MEMO.size > limit) MEMO.delete(MEMO.keys().next().value);
  return hit;
}

// ONE FETCH PER FACE FILE. A face is asked for by the pane that draws it and,
// when it is a front, by the ear plan that reads its declared width
// (earPlanFor), and under other swaps by any other caller: each got its own
// request for the same file. Resolves to the file's text, or null when the
// face was never compiled. Bounded like MEMO, and small: it holds whole files
// only to bridge callers that ask close together. A failed fetch is not kept.
const TEXT_LIMIT = 16;
const TEXTS = new Map();
function faceText(url) {
  let hit = TEXTS.get(url);
  if (hit) TEXTS.delete(url);   // re-insert: Map order is recency
  else hit = fetch(url).then(r => (r.ok ? r.text() : null)).catch(err => { TEXTS.delete(url); throw err; });
  TEXTS.set(url, hit);
  while (TEXTS.size > TEXT_LIMIT) TEXTS.delete(TEXTS.keys().next().value);
  return hit;
}

async function build({ref, cfg, view, swaps, fields, turned}) {
  const shown = turned ? (OPPOSITE[view] || view) : view;
  let text = await faceText(await faceUrl(DIST, ref, cfg, shown));   // #670: may be another config's file
  if (text == null) return null;
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

// THE GENERIC RACK EAR A DEVICE GETS IN THE RACK (Portrayal #909): the kit's
// plan (ears2d.js earPlan, relief.js genericEars) from the device's
// configs.json and its front's declared width, or null where it gets none -
// not a rack device, a sheet body, ears stated `behind`, or a front as wide
// as the rack face, which is a face with its ears BUILT IN (a blanking panel,
// a shelf, a full-width patch panel) and already draws them. The Rack Builder
// draws its own rail-side ears (elevation.js, rack3d.js) only where this is
// not null, in the plan's colour: silver (#c8cacc) unless the device states
// `chassis.ears.color`. Memoized per device and configuration. A device whose
// index cannot be read gets no plan (null: nothing says it is a rack device);
// one whose front cannot be read is judged on its chassis width alone.
const EAR_PLANS = new Map();
export function earPlanFor(ref, cfg) {
  const key = `${ref}.${cfg || ''}`;
  if (!EAR_PLANS.has(key)) {
    EAR_PLANS.set(key, (async () => {
      // imported on first use: ears2d.js brings relief.js, which reads the
      // page's location as it loads, and this module is also loaded under
      // node (the tests of route-context.js, which imports it)
      const {earPlan, frontWidthOfText} = await import('../../vendor/ears2d.js');
      const idx = await jdist(`${DIST}${ref}.configs.json`).catch(() => null);
      if (!idx) return null;
      const w = await faceUrl(DIST, ref, cfg || idx.default, 'front')
        .then(faceText).then(t => frontWidthOfText(t ?? '')).catch(() => null);
      return earPlan(idx, w);
    })());
  }
  return EAR_PLANS.get(key);
}
