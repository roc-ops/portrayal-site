// HOVER A CABLE OR A BUNDLE, AND THE REST DIM (#169). With sixteen cords in a
// rack one is hard to follow; under the pointer it stays at full strength
// along its whole path and every other cable and bundle in the view dims.
//
// What can be hovered: a cable or a bundle's band on the 2D panes, a tube in
// the 3D scene, a cable's row or a bundle's header in the side panel's list.
// A cable lights itself; a bundle lights its trunk and every member.
//
// RESTYLE, NEVER REBUILD. In 2D a class on the pane (`cable-hover`) and `.hot`
// on what stays lit; rack.css does the dimming. In 3D each tube's own
// material (cables.js makes one per cable, scene3d.js one jacket and one strap
// material per bundle) is made see-through and stops writing depth, so a
// dimmed tube in front never hides the lit one; its own values are kept and
// put back exactly when the hover ends. The plugs of the other cables go with
// their tubes (#179): a plug is a mesh of its device, found by its cable's end.
//
// HOVER ONLY. Nothing here selects, and nothing takes a click. A touch has no
// hover, so a touch pointer is ignored: on a phone or a tablet the stage and
// the list behave as they did (a tap still selects).
//
// THE KEYBOARD HOVERS TOO. A row of the list reached with Tab lights its
// cable or bundle as the pointer over it does (hoverAtFocus), for as long as
// focus stays on it: Tab away or a blur ends it, and Escape does not (focus
// has not moved). The pointer over another cable outranks it, and over
// nothing hands back to it. Only focus the browser would ring
// (:focus-visible): a row clicked with the mouse keeps focus, and is not held
// lit by it once the pointer has gone.
//
// A SELECTED CABLE OR BUNDLE IS PINNED. The page has one selection (a click on
// a cable's or a bundle's row, or a cable's tag): on the panes it has always
// lit the selected cable and dimmed the rest (cable-view.js paintCables,
// .cable-focus). The scene now does the same, with the hover's own look, and
// a selected bundle lights its members, its straps and its envelope in both
// views: the scene keeps the selection's lit set as `pinLit` (paintSelected3d)
// and dims by the hover while there is one, else by the pin. So a hover over
// another cable previews it and the pinned one comes back when the pointer
// leaves; an orbit, a rebuild or a switch of view never ends it.
//
// NEVER IN A FILE. The 2D exports are drawn fresh by exports.js, so the panes'
// classes cannot reach them. A GLB or USDZ is written from the live scene, so
// modelFile holds the scene undimmed while it writes (holdUndimmed).

import {matches} from '../../vendor/rack/cable-rules.js';

const DIM = 0.12;  // what a dimmed tube keeps of its own opacity

/** The cables and bundles that stay lit for a hover target, or null for none
 *  (no target, or one the rack no longer has). */
export function litFor(rack, target) {
  if (!target) return null;
  let lit = null;
  if (target.kind === 'cable')
    lit = (rack.cables || []).some(c => c.id === target.id) ? {cables: new Set([target.id]), bundles: new Set()} : null;
  else if (target.kind === 'bundle') {
    const b = (rack.bundles || []).find(x => x.id === target.id);
    lit = b ? {cables: new Set(b.members.map(m => m.cable)), bundles: new Set([b.id])} : null;
  }
  if (lit) lit.plugs = plugsFor(rack, lit.cables);
  return lit;
}

// THE PLUGS OF THE CABLES (#179): a cabled end's plug is a mesh of its device,
// not of the cable's group, so the lit set names the ends as well, `item|port`
// (a plug on `port-1-occupant/tx` is on `port-1`). `dim` holds the ends of
// every cable not lit, less any end a lit cable also holds.
export const portKey = (item, path) => `${item}|${String(path).split('-occupant')[0]}`;
function plugsFor(rack, litCables) {
  const on = new Set(), dim = new Set();
  for (const c of rack.cables || [])
    for (const e of [c.a, c.b]) if (e) (litCables.has(c.id) ? on : dim).add(portKey(e.item, e.path));
  for (const k of on) dim.delete(k);
  return {dim};
}

/** 2D: dim every cable, tag and band on `svgs` but the lit ones, and every strap but those of a lit bundle or of a lit cable's bundle; null restores. */
export function paintHover2d(svgs, lit) {
  for (const svg of svgs) {
    if (!svg) continue;
    svg.classList.toggle('cable-hover', !!lit);
    for (const n of svg.querySelectorAll('[data-cable-id]'))
      n.classList.toggle('hot', !!lit && lit.cables.has(n.dataset.cableId));
    for (const n of svg.querySelectorAll('[data-bundle-id]'))
      n.classList.toggle('hot', !!lit && lit.bundles.has(n.dataset.bundleId));
    // A STRAP GOES WITH ITS BUNDLE: lit while its bundle, or a cable that rides
    // it, is lit, and dimmed with the rest otherwise.
    for (const n of svg.querySelectorAll('[data-strap]'))
      n.classList.toggle('hot', !!lit && (lit.bundles.has(n.dataset.strap) || (n.dataset.members || '').split(' ').some(id => lit.cables.has(id))));
    // A STORED LOOP (spare-loops.js) goes with its cable.
    for (const n of svg.querySelectorAll('[data-spare-loop]'))
      n.classList.toggle('hot', !!lit && lit.cables.has(n.dataset.members));
    // a member under the pointer shows the envelope of the bundle it rides (rack.css)
    for (const n of svg.querySelectorAll('[data-bundle-id]'))
      n.classList.toggle('hot-member', !!lit && (n.dataset.members || '').split(' ').some(id => lit.cables.has(id)));
  }
}

// A material's own see-through state, kept while it is dimmed.
const SAVED = new WeakMap();
function dimMaterial(m, dim) {
  if (dim) {
    if (!SAVED.has(m)) SAVED.set(m, {transparent: m.transparent, opacity: m.opacity, depthWrite: m.depthWrite});
    const own = SAVED.get(m);
    if (m.transparent && m.opacity === own.opacity * DIM && !m.depthWrite) return;
    m.transparent = true; m.opacity = own.opacity * DIM; m.depthWrite = false; m.needsUpdate = true;
  } else if (SAVED.has(m)) {
    Object.assign(m, SAVED.get(m));
    SAVED.delete(m);
    m.needsUpdate = true;
  }
}

// Each cable is a group `cable-<id>` in `patch-cables` (cables.js), each
// bundle a group `bundle-<id>` in `cable-bundles` (scene3d.js).
const GROUPS = [['patch-cables', 'cable-', 'cables'], ['cable-bundles', 'bundle-', 'bundles']];
function apply3d(world, lit) {
  if (typeof world?.getObjectByName !== 'function') return;   // a stub scene (an export's notes under test)
  for (const [name, prefix, key] of GROUPS) {
    const group = world.getObjectByName(name);
    if (!group) continue;
    for (const g of group.children) {
      const dim = !!lit && !lit[key].has(g.name.slice(prefix.length));
      // (a bundle's envelope is shown or hidden, never dimmed: paintEnvelopes3d;
      // and its straps go with it: lit while it, or a cable that rides it, is lit)
      const rides = !!lit && (g.userData.members ?? []).some(id => lit.cables.has(id));
      g.traverse(o => { if (o.isMesh) for (const m of [].concat(o.material))
        dimMaterial(m, dim && !o.userData.envelope && !(o.userData.strap && rides)); });
    }
  }
  // THE TIE STRAPS OF SINGLE CABLES (scene3d.js, group `tie-straps`): each goes
  // with the cables it ties, lit while one of them is, dimmed with the rest.
  // ...and the stored loops of spare (scene3d.js hangLoops, group `spare-loops`), each with its cable.
  for (const g of [...(world.getObjectByName('tie-straps')?.children ?? []), ...(world.getObjectByName('spare-loops')?.children ?? [])]) {
    const dim = !!lit && !(g.userData.members ?? []).some(id => lit.cables.has(id));
    g.traverse(o => { if (o.isMesh) for (const m of [].concat(o.material)) dimMaterial(m, dim); });
  }
  // THE PLUGS (#179): a device's meshes tagged with a port path (relief.js)
  // dim when their end's cable is not lit, and are put back with the rest.
  for (const g of world.children ?? []) {
    if (!g.name?.startsWith('device-')) continue;
    dimPlugs(g, g.name.slice('device-'.length), lit);
  }
}
function dimPlugs(root, item, lit) {
  root.traverse(o => {
    const path = o.userData?.portrayalPath;
    if (!o.isMesh || !path) return;
    const dim = !!lit?.plugs?.dim.has(portKey(item, path));
    for (const m of [].concat(o.material)) dimMaterial(m, dim);
  });
}

/** 3D: a face's detail just added to item `id`'s group (rack3d.js `onFace`),
 *  dimmed as the scene is now (its hover, selection or filter): the detail is
 *  built after the cables are hung, so it lands after the page has painted. */
export function paintLanded3d(scene, id, meshes) {
  const lit = scene?.hoverHeld ? null : (scene?.hoverLit ?? scene?.pinLit ?? scene?.filterLit ?? null);
  if (!lit || id == null) return;
  for (const top of meshes ?? []) if (typeof top?.traverse === 'function') dimPlugs(top, id, lit);
  scene.requestFrame?.();
}

// A BUNDLE'S ENVELOPE IN 3D (scene3d.js hangBundles: the see-through tube at
// its diameter) is hidden until the bundle, or a cable that rides it, is
// hovered or selected, as in 2D. The hover is the scene's `hoverLit`, the
// selection its `selected` ({cable, bundle}, from paintSelected3d). While an
// export holds the scene (holdUndimmed) every envelope is hidden, so no file
// carries one.
export function paintEnvelopes3d(scene) {
  // EVERY RESTYLE ASKS FOR A FRAME (rack3d.js `requestFrame`: the scene draws
  // only when asked). Every 3D paint here ends with this, so it asks for them all.
  scene?.requestFrame?.();
  const group = scene?.three?.scene?.getObjectByName?.('cable-bundles');
  if (!group) return;
  const lit = scene.hoverLit ?? null, sel = scene.selected ?? null;
  for (const g of group.children) {
    const id = g.userData.bundle, members = g.userData.members ?? [];
    const on = !scene.hoverHeld && ((!!lit && (lit.bundles.has(id) || members.some(m => lit.cables.has(m))))
      || (!!sel && (sel.bundle === id || (sel.cable != null && members.includes(sel.cable)))));
    for (const o of g.children) if (o.userData.envelope) o.visible = on;
  }
}
/** 3D: which cable or bundle is selected ({cable, bundle}, either null), and
 *  what stays lit for it (`lit`, litFor's answer for the selection, or null):
 *  the rest dims as under a hover, until a hover says otherwise. */
export function paintSelected3d(scene, sel, lit = null) {
  if (!scene?.three) return;
  scene.selected = sel && (sel.cable != null || sel.bundle != null) ? {cable: sel.cable ?? null, bundle: sel.bundle ?? null} : null;
  scene.pinLit = scene.selected ? lit : null;
  if (!scene.hoverHeld) apply3d(scene.three.scene, scene.hoverLit ?? scene.pinLit ?? scene.filterLit ?? null);
  paintEnvelopes3d(scene);
}

/** The cables the list's filter ({purpose, media}) leaves in, and the bundles
 *  and plugs that go with them, as a lit set; null while no filter is on. */
export function litForFilter(rack, on) {
  if (!on || (on.purpose == null && on.media == null)) return null;
  const cables = new Set((rack.cables || []).filter(c => matches(c, on)).map(c => c.id));
  const bundles = new Set((rack.bundles || []).filter(b => b.members.some(m => cables.has(m.cable))).map(b => b.id));
  return {cables, bundles, plugs: plugsFor(rack, cables)};
}

/** 3D: the filter's lit set, kept on the scene. It dims the rest as a hover
 *  does, below a hover and a selection (a selection replaces the filter's
 *  lit set while there is one); the same restyle, never a rebuild. */
export function paintFilter3d(scene, lit) {
  if (!scene?.three) return;
  scene.filterLit = lit;
  if (!scene.hoverHeld) apply3d(scene.three.scene, scene.hoverLit ?? scene.pinLit ?? scene.filterLit ?? null);
  paintEnvelopes3d(scene);
}

/** 3D: dim every tube in `scene` (scene3d.js's) but the lit ones; null restores.
 *  Remembered on the scene, so an export can lift it and put it back. */
export function paintHover3d(scene, lit) {
  if (!scene?.three) return;
  scene.hoverLit = lit;
  if (!scene.hoverHeld) apply3d(scene.three.scene, lit ?? scene.pinLit ?? scene.filterLit ?? null);
  paintEnvelopes3d(scene);
}

/** Run `fn` with the scene undimmed, then dim it again as the hover is by then. */
export async function holdUndimmed(scene, fn) {
  if (!scene?.three) return fn();
  scene.hoverHeld = (scene.hoverHeld || 0) + 1;
  apply3d(scene.three.scene, null);
  paintEnvelopes3d(scene);
  try { return await fn(); } finally {
    scene.hoverHeld -= 1;
    if (!scene.hoverHeld) apply3d(scene.three.scene, scene.hoverLit ?? scene.pinLit ?? scene.filterLit ?? null);
    paintEnvelopes3d(scene);
  }
}

// A FILE'S STRAPS ARE ONE COLOUR, WHATEVER THE STAGE. On the page a strap
// turns with the stage so it can be seen (stage.js STRAP_PAINT); a GLB or USDZ
// is the rack, not the page, and must be the same file from a dark stage and
// a light one, as the sheet is. It is written with every strap in the sheet's
// ink, a black strap (STRAP_PAINT.light.core): what a hook-and-loop strap is,
// and what reads on the light-grey ground model viewers open on.
export async function withFileStraps(scene, color, fn) {
  const mats = new Map();
  if (typeof scene?.three?.scene?.traverse === 'function')
    scene.three.scene.traverse(o => { if (o.isMesh && o.userData?.strap && !mats.has(o.material)) mats.set(o.material, o.material.color.getHex()); });
  for (const m of mats.keys()) m.color.set(color);
  scene?.requestFrame?.();
  try { return await fn(); } finally { for (const [m, c] of mats) m.color.setHex(c); scene?.requestFrame?.(); }
}

/** Run `fn` with the cables' bend rings (scene3d.js ringBends) out of sight,
 *  then show them again. A warning is the page's, not the rack's: share.js
 *  leaves a hidden mesh out of a GLB or USDZ, so the file never carries one. */
export async function withoutBendRings(scene, fn) {
  const rings = [];
  if (typeof scene?.three?.scene?.traverse === 'function')
    scene.three.scene.traverse(o => { if (o.userData?.bendFinding && o.visible) rings.push(o); });
  for (const r of rings) r.visible = false;
  scene?.requestFrame?.();
  try { return await fn(); } finally { for (const r of rings) r.visible = true; scene?.requestFrame?.(); }
}

/** The hover target under a pointer on a 2D pane: a tag (it takes the
 *  pointer), else a cable's stroke, else a bundle's band. Strokes are
 *  click-through (pointer-events: none), so they are found by geometry. */
export function hoverAt2d(svg, ev) {
  const tag = ev.target?.closest?.('[data-cable-tags] [data-cable-id]');
  if (tag) return {kind: 'cable', id: tag.dataset.cableId};
  const hit = sel => {
    for (const p of [...svg.querySelectorAll(sel)].reverse()) {
      const m = p.getScreenCTM();
      if (!m) continue;
      const q = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(m.inverse());
      if (p.isPointInStroke(q)) return p;
    }
    return null;
  };
  const c = hit(':scope > [data-cables] [data-cable][data-cable-id] path');
  if (c) return {kind: 'cable', id: c.closest('[data-cable-id]').dataset.cableId};
  const b = hit(':scope > [data-cables] [data-bundle-id] path');
  if (b) return {kind: 'bundle', id: b.closest('[data-bundle-id]').dataset.bundleId};
  return null;
}

/** The hover target under a pointer on the 3D scene's canvas, by a ray
 *  through the cable and bundle tubes. */
export function hoverAt3d(scene, ev) {
  const {THREE, scene: world, camera, renderer} = scene?.three ?? {};
  if (!THREE || !renderer) return null;
  const targets = GROUPS.map(([name]) => world.getObjectByName(name)).filter(Boolean);
  if (!targets.length) return null;
  const r = renderer.domElement.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), camera);
  // A bundle's envelope is a see-through sleeve round its members, shown or
  // not: a ray that meets a cable or a strap after passing through it is on
  // that cable or strap (a member under the pointer is hovered alone, as in
  // 2D, where a cable's stroke outranks the band). Through an envelope and
  // nothing else, it is on the bundle.
  let sleeve = null;
  for (const hit of ray.intersectObjects(targets, true)) {
    for (let o = hit.object; o && o.parent; o = o.parent) {
      const [name, prefix, key] = GROUPS.find(([n]) => n === o.parent.name) ?? [];
      if (!name) continue;
      const target = {kind: key === 'cables' ? 'cable' : 'bundle', id: o.name.slice(prefix.length)};
      if (!hit.object.userData.envelope) return target;
      sleeve ??= target;
      break;
    }
  }
  return sleeve;
}

/** The hover target a side-panel row names: a cable row or a bundle header. */
export function hoverAtList(ev) {
  const row = ev.target?.closest?.('[data-cable-item], [data-bundle-item]');
  if (!row) return null;
  return row.dataset.cableItem != null ? {kind: 'cable', id: row.dataset.cableItem}
    : {kind: 'bundle', id: row.dataset.bundleItem};
}

/** The hover target keyboard focus names inside `root` (the side panel): the
 *  row that holds the focused control, when the browser would ring that focus
 *  (:focus-visible), else null. */
export function hoverAtFocus(root) {
  const a = root?.ownerDocument?.activeElement;
  if (!a || a === root || !root.contains(a)) return null;
  let ring = true;
  try { ring = a.matches(':focus-visible'); } catch { /* no :focus-visible here: any focus counts */ }
  return ring ? hoverAtList({target: a}) : null;
}

export const sameTarget = (a, b) => (a?.kind ?? null) === (b?.kind ?? null) && (a?.id ?? null) === (b?.id ?? null);
