// The cast rack: which devices, where they sit, how tall the rack is, and the
// two renderers that draw it. Stage 0 draws its rails, and stages 1-3 and 6
// mount it (stages 4 and 5 rack the ROADM ring instead, through ring.js), so
// it lives here rather than in any one of them.
//
// ONE stack, two renderers. The 2D elevation and the 3D rack are handed the
// same array, and a module swapped in either is a swap in both, because both
// resolve it through swap.js against the same compiled faces. That is the
// argument the rack makes: one source, several views - not several sources.

import {DIST, stage3d, stageRack, loading, svgEl} from './artifact.js';
// A circular import: stage-rail.js imports the stages, which import this. It is
// safe because epoch and stale are only ever read inside mount3d, never while
// the modules are being evaluated.
import {epoch, stale} from './stage-rail.js';
import {RU, RAIL_W, OPENING, HOLE_DY, HOLE_SIZE, SIDES} from './rails.js';
export {RU};
// The rack heights a cabinet is actually sold in. The rack is the smallest of
// these that holds the cast, so it is a real cabinet and not one sized to fit.
const RACK_SIZES = [12, 16, 22, 24, 42];
// One free U between devices, as a rack is racked: it is where the fingers go.
const GAP = 1;

// The cast, bottom-up, heaviest lowest. What each demonstrates HERE: the
// ASR-9006 is modular - stage 2 seats its slots, each offering only what it
// accepts; the AS7726-32X is the optics story in stage 3, and the one
// device every lens is written against; the R740xd and the FHD-1UFCE are
// mounted, sized from their own chassis, and open under Inspect. The R740xd's
// teardown (data-under, R24) is half there: inside the Inspect lens, which is
// Explorer, its bezel comes off with Explorer's own pull control - but not on
// the rack, whose 2D elevation and 3D build draw it as it ships. The
// FHD-1UFCE as a fibre path (R28) is NOT built yet.
//
// `cfg` is the configuration each device is cast in, named in its
// configs.json, not a guess: a wrong cfg is a silent empty slot rather than an
// error, so loadMeta warns when one is not in the index. Three are their
// index's own `default`; the FHD-1UFCE is not - its default `base` is an empty
// tray, so it is cast `populated`, with its four cassettes. `ru` - the
// device's bottom U, counted from 1 at the bottom of the rack, which is what
// rack3d.js and the elevation below both read - and the height `u` are
// filled in by loadMeta from the chassis each index declares, because a height
// written here is one that can drift from the model.
export const CAST = [
  {ref: 'asr-9006',   cfg: 'base',             label: 'ASR-9006'},
  {ref: 'r740xd',     cfg: 'sff24-rc5-1b2a3a', label: 'R740xd'},
  {ref: 'as7726-32x', cfg: 'ac-f2b',           label: 'AS7726-32X'},
  {ref: 'fhd-1ufce',  cfg: 'populated',       label: 'FHD-1UFCE'},
];

// The rack's height in U, settled by loadMeta. Stage 0 draws exactly this, so
// the rails stage 1 mounts into are the rails stage 0 showed.
export let RACK_U = null;

// The cast's choices: {ref: {bayOrCagePath: componentRef}}. Module state on
// purpose - a card seated in one stage is still seated in the next, which is
// what makes the ladder cumulative.
export const overrides = {};

// rack3d.js's build() is not re-entrant: buildAll() clears and disposes the
// scene's shared `mounted` array SYNCHRONOUSLY, before its first await, and
// only repopulates it across several awaits after that. A second build()
// starting while the first is still mid-await would run that same clear on
// meshes the first call is still building - this is a property of the rack,
// not of any one stage, so it belongs here rather than duplicated in every
// stage that rebuilds it (stage 2 seating a card, stage 3 seating an optic,
// ...). Every rebuild goes through this one module-level chain instead, so at
// most one build() is ever in flight regardless of how many callers race.
//
// A rejection is swallowed at the CHAIN level, not the caller's: `fn`
// throwing must not leave every later enqueue()'d rebuild permanently stuck
// behind a rejected promise, but the caller still gets `fn`'s own rejection
// back on the promise this returns, so it can handle or log it.
let rebuildQueue = Promise.resolve();
export function enqueueRebuild(fn) {
  const ready = rebuildQueue.catch(() => {});
  const step = ready.then(fn);
  rebuildQueue = step.catch(() => {});
  return step;
}

let meta = null;        // ref -> the device's configs.json, from the compiled index
let components = null;  // the component index, for resolving a bay occupant

// Through jdist, not fetch: the 3D viewer asks for these same two indexes, and
// its memo is what stopped components.json coming down repeatedly. A bare
// fetch here would sit outside that memo and put the duplicate straight back.
//
// jdist throws where the old code inspected r.ok, so the tolerance is explicit
// now: a device whose configs.json is missing drops out of the rack rather
// than taking the stage down with it.
export async function loadMeta() {
  if (meta) return;
  const m = {};
  const {jdist} = await import('../../vendor/dist.js');
  for (const e of CAST) {
    try { m[e.ref] = await jdist(`${DIST}${e.ref}.configs.json`); }
    catch (err) { console.warn('[portrayal] no config index for', e.ref, err); }
  }
  try { components = (await jdist(`${DIST}components.json`)).components; }
  catch (err) { console.warn('[portrayal] no component index', err); components = []; }
  meta = m;

  let next = 1;
  for (const e of CAST) {
    const idx = meta[e.ref];
    if (!idx) { e.ru = e.u = null; continue; }
    if (!(idx.configs || []).some(c => c.name === e.cfg)) {
      console.warn('[portrayal] cast config not in the index', e.ref, e.cfg);
    }
    e.u = unitsOf(e.ref);
    e.ru = next;
    next += e.u + GAP;
  }
  const top = Math.max(0, ...CAST.filter(e => e.ru).map(e => e.ru + e.u - 1));
  RACK_U = RACK_SIZES.find(n => n >= top) ?? top;
}

// The cast as mounted: only the devices whose index loaded, so a missing one
// is a gap in the rack rather than a device drawn at an unknown height.
export const placed = () => CAST.filter(e => e.ru != null);

export const chassisOf = ref => meta?.[ref]?.chassis || {};
// The configurations the device compiles to, by name - what Inspect offers a
// spoke to switch between, so it never asks for a file that was not built.
export const configsOf = ref => (meta?.[ref]?.configs || []).map(c => c.name);
// The index's own shape, {view: [{id, accepts, default, group, ...}]}.
export const baysOf = ref => meta?.[ref]?.bays || {};
export const cagesOf = ref => meta?.[ref]?.cages || {};
// A device's height in U. chassis.ru when the index states it; otherwise read
// off the height in millimeters, which is how the R740xd declares itself.
export function unitsOf(ref) {
  const c = chassisOf(ref);
  return c.ru ?? Math.max(1, Math.round((c.h || RU) / RU));
}

// Resolve "cisco/a9k-mpa-4x10ge@1" to its compiled standalone skin. Exported
// so a stage that needs the same skin - stage 3 reading an occupant's own
// data-paths off it, rather than hardcoding them - reuses this instead of
// writing a second copy that can drift from it.
export const byRef = ref => (components || []).find(
  c => `${c.ns}/${c.name}@${c.major.slice(1)}` === ref.split(':')[0]);
export async function loadSkin(ref) {
  const c = byRef(ref);
  if (!c) return null;
  const skin = c.skins?.includes('default') ? 'default' : c.skins?.[0];
  const url = `${DIST}components/${c.ns}--${c.name}--${c.major}--${skin}.svg`;
  const r = await fetch(url);
  if (!r.ok) return null;
  return {comp: c, text: await r.text()};
}
export const shortRef = ref => (ref || '(empty)').split('/').pop().replace(/@\d+$/, '');

// ── 2D elevation ─────────────────────────────────────────────────────────
// Rails and RU marks for heightRU units, then each device's compiled front face
// at its own bottom U. An empty stack is an empty rack - stage 0 draws exactly
// that.
//
// A device's overrides are seated the way the 3D rack seats them: through
// swap.js's face-level pass, bays AND cages, never a bays-only call. Seating
// the bays alone is how stage 3's optics went missing from stage 6's SVG and
// PNG - the AS7726-32X has no front bays at all, and its 34 cages are in
// `cages.front`.
export async function build2dElevation({stack, heightRU, overrides: ov = overrides,
                                        view = 'front', baseRU = 1}) {
  const totalH = heightRU * RU;
  const X = x => x + OPENING / 2;          // centre-line mm -> this drawing's x
  const out = svgEl('svg', {xmlns: 'http://www.w3.org/2000/svg',
    viewBox: `${-RAIL_W - 6} -18 ${OPENING + RAIL_W * 2 + 12} ${totalH + 30}`});

  for (const s of SIDES) {
    const x0 = X(Math.min(s.inner, s.outer));
    out.append(svgEl('rect', {x: x0, y: 0, width: RAIL_W, height: totalH, 'data-rail': s.side,
      fill: 'var(--pt-surface-2)', stroke: 'var(--pt-line)', 'stroke-width': 1}));
  }
  for (let i = 0; i < heightRU; i++) {
    const u = baseRU + i;                              // the real U number
    const yBottom = totalH - i * RU;
    for (const s of SIDES) {
      const x0 = X(Math.min(s.inner, s.outer));
      out.append(svgEl('line', {x1: x0, y1: yBottom - RU, x2: x0 + RAIL_W, y2: yBottom - RU,
        stroke: 'var(--pt-line)', 'stroke-width': 0.8}));
      for (const dy of HOLE_DY) {
        out.append(svgEl('rect', {x: X(s.hole) - HOLE_SIZE / 2, y: yBottom - dy - HOLE_SIZE / 2,
          width: HOLE_SIZE, height: HOLE_SIZE, rx: 0.6, fill: 'var(--pt-ground)',
          stroke: 'var(--pt-line)', 'stroke-width': 0.5, 'data-rail-hole': s.side}));
      }
      const t = svgEl('text', {x: X(s.number), y: yBottom - RU / 2 + 4,
        'text-anchor': 'middle', 'font-family': 'IBM Plex Mono, monospace',
        'font-size': 11, 'font-weight': 500, fill: 'var(--pt-ink-muted)', 'data-rail-num': s.side});
      t.textContent = String(u);
      out.append(t);
    }
  }

  let styled = false;
  for (const e of stack) {
    const url = `${DIST}${e.ref}.${e.cfg}.${view}.svg`;
    const text = await fetch(url).then(r => r.ok ? r.text() : null);
    if (!text) continue;
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    const root = doc.documentElement;
    const vb = (root.getAttribute('viewBox') || '').split(/\s+/).map(Number);
    const w = parseFloat(root.getAttribute('width')) || vb[2];
    const h = parseFloat(root.getAttribute('height')) || vb[3];
    const ruH = e.u ?? Math.max(1, Math.round(h / RU));
    const y = totalH - (e.ru - baseRU + ruH) * RU + (ruH * RU - h) / 2;

    const g = svgEl('g', {transform: `translate(${(OPENING - w) / 2} ${y})`,
                          'data-device-name': e.label, 'data-device-ref': e.ref});
    // Ids are NOT rewritten per device. The compiled drawings carry no <defs>,
    // no url(#...) and no href="#...", so there is nothing to collide - and
    // renaming them would break swap.js, which finds a seated module by the
    // canonical id the compiler gave it.
    for (const kid of [...root.childNodes]) {
      if (kid.nodeName === 'style') { if (styled) continue; styled = true; }
      g.append(document.importNode(kid, true));
    }
    out.append(g);
    const mine = ov?.[e.ref];
    // Seating overrides is front-only: bays and cages are keyed per view in
    // the index (e.g. cages.front, cages.rear). The stages only ever seat
    // front bays, but the Inspect lens is Explorer, and a swap made there on
    // a REAR bay comes back into `overrides` too. This front elevation
    // ignores it: applying it against a rear face's keys would seat nothing,
    // or the wrong thing.
    if (view === 'front' && mine && Object.keys(mine).length) {
      const {applyFaceOverrides} = await import('../../vendor/swap.js');
      await applyFaceOverrides(g, {bays: baysOf(e.ref).front || [], cages: cagesOf(e.ref).front || []},
                               mine, loadSkin, byRef);
    }
  }
  return out;
}

// ── 3D rack ──────────────────────────────────────────────────────────────
// Returns the built scene, or null when there is none: WebGL unavailable (the
// reason is already on the loading scrim), or the stage moved on while it was
// building. A caller builds its side panel either way - nothing in a panel may
// depend on the 3D having mounted.
export async function mount3d({stack, heightRU, overrides: ov = overrides}) {
  stageRack.hidden = true; stage3d.hidden = false;
  loading.hidden = false; loading.textContent = 'Building the rack in 3D…';
  const mine = epoch;
  // WITHOUT THIS THE SCRIM NEVER COMES DOWN. three.js throws when it cannot
  // get a context, the exception escaped this handler, and the tab sat on
  // "Building the rack in 3D…" forever - which reads as a slow build rather
  // than a browser that has graphics acceleration switched off.
  const {guard3d} = await import('../webgl.js');
  const built = await guard3d(async () => {
    const {createRackScene} = await import('../rack3d.js');
    if (stale(mine)) return null;
    // What a caller supplies wins: the ROADM ring's refs are not in the
    // cast's index, so ring.js hands over its own chassis, bays and cages,
    // and filling them from `meta` here would blank them to {} - which is
    // truthy, so rack3d's hydrate() would skip loading the index and every
    // device would mount with no dimensions.
    const scStack = stack.map(e => ({...e, chassis: e.chassis || chassisOf(e.ref),
      bays: e.bays || baysOf(e.ref), cages: e.cages || cagesOf(e.ref),
      componentIndex: e.componentIndex || components,
      overrides: ov?.[e.ref] ? {...ov[e.ref]} : null}));
    const sc = createRackScene(stage3d, {dist: DIST, stack: scStack, heightRU,
                                         background: 0x0E1013});
    await sc.build();
    return sc;
  }, msg => {
    if (stale(mine)) return;
    loading.hidden = false;
    loading.textContent = msg;
  });
  if (!built) return null;
  if (stale(mine)) { built.dispose(); return null; }
  loading.hidden = true;
  return built;
}
