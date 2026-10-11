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
// put back exactly when the hover ends.
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
// NEVER IN A FILE. The 2D exports are drawn fresh by exports.js, so the panes'
// classes cannot reach them. A GLB or USDZ is written from the live scene, so
// modelFile holds the scene undimmed while it writes (holdUndimmed).

const DIM = 0.12;   // what a dimmed tube keeps of its own opacity

/** The cables and bundles that stay lit for a hover target, or null for none
 *  (no target, or one the rack no longer has). */
export function litFor(rack, target) {
  if (!target) return null;
  if (target.kind === 'cable')
    return (rack.cables || []).some(c => c.id === target.id) ? {cables: new Set([target.id]), bundles: new Set()} : null;
  if (target.kind === 'bundle') {
    const b = (rack.bundles || []).find(x => x.id === target.id);
    return b ? {cables: new Set(b.members.map(m => m.cable)), bundles: new Set([b.id])} : null;
  }
  return null;
}

/** 2D: dim every cable, tag, band and strap on `svgs` but the lit ones; null restores. */
export function paintHover2d(svgs, lit) {
  for (const svg of svgs) {
    if (!svg) continue;
    svg.classList.toggle('cable-hover', !!lit);
    for (const n of svg.querySelectorAll('[data-cable-id]'))
      n.classList.toggle('hot', !!lit && lit.cables.has(n.dataset.cableId));
    for (const n of svg.querySelectorAll('[data-bundle-id], [data-strap]'))
      n.classList.toggle('hot', !!lit && lit.bundles.has(n.dataset.bundleId ?? n.dataset.strap));
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
      // (a bundle's envelope is shown or hidden, never dimmed: paintEnvelopes3d)
      g.traverse(o => { if (o.isMesh) for (const m of [].concat(o.material)) dimMaterial(m, dim && !o.userData.envelope); });
    }
  }
}

// A BUNDLE'S ENVELOPE IN 3D (scene3d.js hangBundles: the see-through tube at
// its diameter) is hidden until the bundle, or a cable that rides it, is
// hovered or selected, as in 2D. The hover is the scene's `hoverLit`, the
// selection its `selected` ({cable, bundle}, from paintSelected3d). While an
// export holds the scene (holdUndimmed) every envelope is hidden, so no file
// carries one.
export function paintEnvelopes3d(scene) {
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
/** 3D: which cable or bundle is selected ({cable, bundle}, either null), for the envelopes. */
export function paintSelected3d(scene, sel) {
  if (!scene?.three) return;
  scene.selected = sel && (sel.cable != null || sel.bundle != null) ? {cable: sel.cable ?? null, bundle: sel.bundle ?? null} : null;
  paintEnvelopes3d(scene);
}

/** 3D: dim every tube in `scene` (scene3d.js's) but the lit ones; null restores.
 *  Remembered on the scene, so an export can lift it and put it back. */
export function paintHover3d(scene, lit) {
  if (!scene?.three) return;
  scene.hoverLit = lit;
  if (!scene.hoverHeld) apply3d(scene.three.scene, lit);
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
    if (!scene.hoverHeld) apply3d(scene.three.scene, scene.hoverLit ?? null);
    paintEnvelopes3d(scene);
  }
}

/** Run `fn` with the cables' bend rings (scene3d.js ringBends) out of sight,
 *  then show them again. A warning is the page's, not the rack's: share.js
 *  leaves a hidden mesh out of a GLB or USDZ, so the file never carries one. */
export async function withoutBendRings(scene, fn) {
  const rings = [];
  if (typeof scene?.three?.scene?.traverse === 'function')
    scene.three.scene.traverse(o => { if (o.userData?.bendFinding && o.visible) rings.push(o); });
  for (const r of rings) r.visible = false;
  try { return await fn(); } finally { for (const r of rings) r.visible = true; }
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
