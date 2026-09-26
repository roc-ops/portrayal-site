// The cast rack: which devices, where they sit, how tall the rack is, and the
// two renderers that draw it. Stage 0 draws its rails, and stages 1-6 mount
// it (stages 4 and 5 cabled, through patch-view.js), so it lives here rather
// than in any one of them.
//
// ONE stack, two renderers. The 2D elevation and the 3D rack are handed the
// same array, and a module swapped in either is a swap in both, because both
// resolve it through swap.js against the same compiled faces. That is the
// argument the rack makes: one source, several views - not several sources.

import {DIST, stage3d, stageRack, loading} from './artifact.js';
import {components as faceComponents, loadSkin as faceLoadSkin} from '../rack/face.js';
// A circular import: stage-rail.js imports the stages, which import this. It is
// safe because epoch and stale are only ever read inside mount3d, never while
// the modules are being evaluated.
import {epoch, stale} from './stage-rail.js';
import {RU} from './rails.js';
import {drawElevation} from '../rack/elevation.js';
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
// FHD-1UFCE as a fibre path (R28) is NOT built yet. The AS4630-54TE is the
// copper top-of-rack switch stage 4's plan lands the server and every
// management port on, uplinked to the AS7726-32X over its two QSFP28 ports.
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
  {ref: 'eps201',     cfg: 'ac-f2b',           label: 'AS4630-54TE'},
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

// Through jdist, not fetch, for each device's own configs.json: the 3D
// viewer asks for the same per-device indexes, and jdist's memo is what
// stopped one coming down repeatedly. The component index comes from
// face.js's `components()` instead, which memoizes through jdist itself, so
// the showcase and every configured face resolve one component list, not two.
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
  components = await faceComponents();
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
// One skin loader for the showcase and every configured face, so the two can
// never resolve a component differently.
export const loadSkin = faceLoadSkin;
export const shortRef = ref => (ref || '(empty)').split('/').pop().replace(/@\d+$/, '');

// ── 2D elevation ─────────────────────────────────────────────────────────
// Rails and RU marks for heightRU units, then each device's compiled face at
// its own bottom U, on whichever view is asked for. An empty stack is an
// empty rack - stage 0 draws exactly that.
//
// Each device is drawn through `configuredFace`, which seats bays, cages AND
// rear holes on any view - not the front alone. Seating the bays alone is how
// stage 3's optics went missing from stage 6's SVG and PNG - the AS7726-32X
// has no front bays at all, and its 34 cages are in `cages.front`. And a
// device outside the cast - which is every Rack Builder device - has no entry
// in `loadMeta`'s index at all; `configuredFace` loads its own configs.json,
// so it seats regardless.
//
// This now draws through site/rack/elevation.js: build2dElevation is an
// adapter over drawElevation, so the showcase and the Rack Builder can never
// disagree about what a rail or a device looks like.
export async function build2dElevation({stack, heightRU, overrides: ov = overrides,
                                        view = 'front', baseRU = 1}) {
  // The cast is every device on the FRONT of one plane of rails, so the rear
  // view is each device's rear panel - two-post says exactly that - and a
  // face that was never drawn is left out, as it always was.
  return drawElevation({
    items: stack.map(e => ({id: e.ref, ref: e.ref, cfg: e.cfg, label: e.label, ru: e.ru, u: e.u,
                            face: 'front', turned: !!e.turned, swaps: ov?.[e.ref] || {}, fields: {}})),
    frame: {kind: 'two-post', heightRU, numbering: 'bottom-up', holes: {style: 'square', thread: null}},
    view, baseRU, placeholders: false,
  });
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
    // What a caller supplies wins: a ref that is not in the cast's index
    // comes with its own chassis, bays and cages, and filling them from
    // `meta` here would blank them to {} - which is
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
