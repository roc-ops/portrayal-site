// COVERS: ON, SEE-THROUGH OR OFF (portrayal-site#190). A vertical manager's
// front cover hides the cables that run up inside it. One view control, the
// same in 2D (both pairs) and in 3D, with three settings:
//
//   on           the cover is opaque and in front of what it covers;
//   see-through  the cover is plainly there and the run behind it reads
//                through it (what the front pane has always drawn);
//   off          the cover is not drawn.
//
// WHAT A COVER IS: what the library marks as one on a part that stands beside
// the rack (rack.zeroU): the `cover` group of its drawing (data-group="cover")
// and, on the views that draw the cover edge on, the nodes of kind cover
// (data-kind="cover"). A lacer has none, and nothing else is touched.
//
// A VIEW SETTING. It is the reader's, remembered in this browser beside the
// 2D/3D mode; it is never in the rack file and never in the URL. NO DOWNLOAD
// READS IT: the sheet is drawn fresh by exports.js, away from the panes this
// styles, and a GLB or USDZ is written with every cover as it was built
// (withCoversAsBuilt), so each file is the same whatever the control says.
//
// IN 2D it is one attribute on the panes (data-covers) and rack.css: the
// see-through copy the front pane lays over the cables (cable-view.js
// drawInFront, data-front="cover") is made opaque, or it and the cover under
// the cables are not painted. Nothing is redrawn. A cover that is not painted
// takes no pointer, so a click goes to the manager's own body under it, which
// selects the manager as before.
//
// IN 3D a part's body is built from its drawing by relief.js, which tags each
// mesh with the data-path of the part of the drawing it came from
// (userData.portrayalPath). The cover's meshes are the ones whose path is a
// cover group's, or under one: they are separate meshes, never merged with
// the channel or the fingers, so they are faded or hidden on their own. Each
// keeps its own material values and gets them back exactly.

import {configuredFace} from './face.js';

export const COVERS_KEY = 'portrayal.rack.covers';
// [state, the button's word, what it says in full (its title and its accessible name)]: the bar is short of room.
export const COVER_STATES = [['on', 'On', 'Covers on: opaque, in front of the cables inside'],
                             ['see', 'See', 'Covers see-through: the cables inside read through them'],
                             ['off', 'Off', 'Covers off: not drawn']];
export const COVERS_DEFAULT = 'see';
// What a see-through cover keeps of its own opacity in 3D (the front pane's copy is 0.34).
export const COVER_FADE = 0.3;

const known = v => COVER_STATES.some(([s]) => s === v);
export function loadCovers(store = globalThis.localStorage) {
  try { const v = store.getItem(COVERS_KEY); return known(v) ? v : COVERS_DEFAULT; }
  catch { return COVERS_DEFAULT; }
}
export function saveCovers(v, store = globalThis.localStorage) { try { store.setItem(COVERS_KEY, v); } catch { /* forgets */ } }

/** Is `path` a cover's: one of `paths` (the cover groups' data-paths) or a node under one? */
export const underCover = (paths, path) => typeof path === 'string' && [...(paths ?? [])].some(p => path === p || path.startsWith(`${p}/`));

/** The data-paths of the cover groups in a drawing's text. */
export function coverPathsIn(text) {
  const out = [];
  for (const m of String(text ?? '').matchAll(/<[a-zA-Z][^>]*\sdata-group="cover"[^>]*>/g)) {
    const p = /\sdata-path="([^"]*)"/.exec(m[0]);
    if (p) out.push(p[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
  }
  return out;
}

// ── the control ──────────────────────────────────────────────────────────
/** The three buttons, into `host`; `onCovers(state)` on each pick. `get()` is the state to start with. */
export function mountCovers(host, onCovers) {
  let cur = loadCovers();
  const paint = () => {
    for (const b of host.querySelectorAll('[data-covers-set]')) {
      const on = b.dataset.coversSet === cur;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    }
  };
  const label = document.createElement('span');
  label.className = 'rk-covers-label';
  label.textContent = 'Covers';
  host.append(label);
  for (const [state, text, title] of COVER_STATES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.coversSet = state;
    b.textContent = text;
    b.title = title;
    b.setAttribute('aria-label', title);
    b.addEventListener('click', () => { if (cur === state) return; cur = state; saveCovers(state); paint(); onCovers(state); });
    host.append(b);
  }
  paint();
  return {get: () => cur};
}

// ── 2D ───────────────────────────────────────────────────────────────────
/** The panes follow the setting: one attribute, and rack.css does the rest. */
export function paintCovers2d(panes, state) { if (panes) panes.dataset.covers = state; }

// ── 3D ───────────────────────────────────────────────────────────────────
const PATHS = new Map();
const VIEWS = ['front', 'rear', 'left', 'right', 'top', 'bottom'];
/** The cover groups' data-paths of one part's drawing, over all its views. Never throws. */
export function coverPathsOf(ref, cfg) {
  const key = `${ref}|${cfg ?? ''}`;
  if (!PATHS.has(key)) PATHS.set(key, Promise.all(VIEWS.map(view => configuredFace({ref, cfg, view})
    .then(f => coverPathsIn(f?.text)).catch(() => []))).then(lists => new Set(lists.flat())));
  return PATHS.get(key);
}

// A material's own values, kept while its cover is see-through. A face that
// carries the drawing's art is cut out by its alpha (relief.js: alphaTest
// with alpha to coverage), which would turn a fade into all or nothing: while
// faded it blends instead, and the cut-out's threshold fades with it.
const OWN = new WeakMap();
function fade(m, on) {
  if (on) {
    if (!OWN.has(m)) OWN.set(m, {transparent: m.transparent, opacity: m.opacity, depthWrite: m.depthWrite, alphaToCoverage: m.alphaToCoverage, alphaTest: m.alphaTest});
    const own = OWN.get(m);
    m.transparent = true; m.opacity = own.opacity * COVER_FADE; m.depthWrite = false;
    m.alphaToCoverage = false; m.alphaTest = own.alphaTest * COVER_FADE; m.needsUpdate = true;
  } else if (OWN.has(m)) {
    Object.assign(m, OWN.get(m));
    OWN.delete(m);
    m.needsUpdate = true;
  }
}
function apply(scene, state) {
  for (const mesh of scene.coverMeshes ?? []) {
    mesh.visible = state !== 'off';
    for (const m of [].concat(mesh.material)) if (m) fade(m, state === 'see');
  }
}

/** Meshes just added to a part's group (rack3d.js `onFace`): the cover's are
 *  kept on the scene (`scene.coverMeshes`: nothing is written on a mesh, whose
 *  userData a GLB carries as extras) and styled at once, so a cover is never drawn one frame
 *  as built and the next as the setting has it. `paths` is coverPathsOf's. */
export function takeCovers(scene, meshes, paths) {
  if (!paths?.size) return;
  const mine = [];
  for (const top of meshes) top.traverse?.(o => { if (o.isMesh && underCover(paths, o.userData?.portrayalPath)) mine.push(o); });
  if (!mine.length) return;
  (scene.coverMeshes ??= []).push(...mine);
  if (!scene.coversHeld) apply({coverMeshes: mine}, scene.covers ?? COVERS_DEFAULT);
}

/** 3D: every cover in `scene` as `state` has it. Remembered on the scene, so an export can lift it and put it back. */
export function paintCovers3d(scene, state) {
  if (!scene) return;
  scene.covers = state;
  if (!scene.coversHeld) apply(scene, state);
}

/** Run `fn` with every cover as it was built (shown, its own materials), then
 *  as the setting has it again: what a GLB or USDZ is written under. */
export async function withCoversAsBuilt(scene, fn) {
  if (!scene?.coverMeshes?.length) return fn();   // no cover in it (or a stub scene): nothing to put back
  scene.coversHeld = (scene.coversHeld || 0) + 1;
  apply(scene, 'on');
  try { return await fn(); } finally {
    scene.coversHeld -= 1;
    if (!scene.coversHeld) apply(scene, scene.covers ?? COVERS_DEFAULT);
  }
}
