// DRAG A DEVICE TO MOVE IT (feedback round 2 §1). The controller here owns
// the pointer lifecycle; rack-page.js only wires it to the two panes and
// supplies the callbacks that touch the document (patchItem) or the DOM
// (svgFor, setStatus). The pure half - a pointer's y to a U - is uAtY in
// elevation.js, so this stays about gesture handling, not layout math.

import {RU, OPENING} from './rails.js';
import {uAtY} from './elevation.js';
import {fits} from './fit.js';
import {svgEl, svgY} from './dom.js';

const THRESHOLD = 4; // CSS px before a press becomes a drag, not a click

export function createDragController({panesEl, svgFor, rack, chassisOf, itemById, patchItem,
                                      onStart, onEnd, setStatus}) {
  let d = null; // the in-flight drag, or null between drags
  // Whether a click that follows the drag just finished should be treated as
  // its trailing echo rather than a fresh click. Some engines (Chromium, with
  // setPointerCapture + preventDefault in play) never fire that trailing
  // click at all; others (Firefox, Safari) do. Rather than guess with a
  // timer, the page asks consumeClick() from its own click handler: true
  // exactly once, right after a drag that moved, then false - so a click
  // that never arrives can never swallow a later, unrelated one.
  let justDragged = false;

  function paneFaceAt(clientX, clientY) {
    let best = null, bestDist = Infinity;
    for (const face of ['front', 'rear']) {
      const svg = svgFor(face);
      if (!svg) continue;
      const r = svg.getBoundingClientRect();
      if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) return face;
      const dx = Math.max(r.left - clientX, 0, clientX - r.right);
      const dy = Math.max(r.top - clientY, 0, clientY - r.bottom);
      const dist = Math.hypot(dx, dy);
      if (dist < bestDist) { bestDist = dist; best = face; }
    }
    return best;
  }

  function clearPreview() {
    for (const face of ['front', 'rear']) svgFor(face)?.querySelector('rect.rk-drop')?.remove();
  }

  function drawPreview(svg, frame, ru, ruH, ok) {
    clearPreview();
    const totalH = frame.heightRU * RU;
    const top = totalH - (ru - 1 + ruH) * RU;
    // Brass stroke always; a green-ish fill says it fits, not brass - brass
    // is the rack's own accent color and reads as "selected", not "ok here".
    svg.append(svgEl('rect', {x: 0.5, y: top + 0.5, width: OPENING - 1, height: ruH * RU - 1, rx: 2,
      class: 'rk-drop', fill: ok ? 'rgba(52, 168, 83, 0.22)' : 'none',
      stroke: ok ? 'var(--pt-brass)' : 'var(--pt-warn)', 'stroke-width': 2, 'pointer-events': 'none'}));
  }

  function updatePreview(clientX, clientY) {
    const face = paneFaceAt(clientX, clientY) || d.origFace;
    const svg = svgFor(face);
    if (!svg) return;
    const r = rack();
    const y = svgY(svg, clientX, clientY);
    const pointerU = uAtY(r.frame, y);
    const maxRu = Math.max(1, r.frame.heightRU - d.ruH + 1);
    const ru = Math.min(maxRu, Math.max(1, pointerU - d.grabOffsetU));
    const f = fits(r, {ref: d.item.ref, ru, face}, chassisOf, {ignoreId: d.id});
    d.target = {face, ru, ok: f.ok};
    drawPreview(svg, r.frame, ru, d.ruH, f.ok);
    setStatus(f.ok ? 'Drop to move here.' : f.reason);
  }

  function edgeScroll() {
    if (!d || !d.moved) return;
    if (d.scrollDir) {
      panesEl.scrollTop += d.scrollDir * 10;
      updatePreview(d.lastX, d.lastY);
    }
    d.rafId = requestAnimationFrame(edgeScroll);
  }

  function beginDrag(ev) {
    d.moved = true;
    d.panelGroup.style.opacity = '0.4';
    // The grab point is where the pointer went DOWN, not where it happens to
    // be once it has moved past the threshold - by the time a move fires,
    // the pointer may already be a whole U or more from the press.
    const face = paneFaceAt(d.startX, d.startY) || d.origFace;
    const svg = svgFor(face);
    const r = rack();
    d.ruH = Math.max(1, chassisOf(d.item.ref)?.ru ?? 1);
    const grabU = svg ? uAtY(r.frame, svgY(svg, d.startX, d.startY)) : d.item.ru;
    d.grabOffsetU = grabU - d.item.ru;
    onStart(d.id);
    d.rafId = requestAnimationFrame(edgeScroll);
  }

  function finish(commitMove) {
    if (!d) return;
    const {id, group, panelGroup, pointerId} = d;
    if (d.rafId != null) cancelAnimationFrame(d.rafId);
    clearPreview();
    if (panelGroup) panelGroup.style.opacity = '';
    if (group) { try { group.releasePointerCapture(pointerId); } catch { /* already released */ } }
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerCancel);
    window.removeEventListener('keydown', onKeyDown, true);
    const wasMoved = d.moved, target = d.target;
    d = null;
    if (!wasMoved) return;
    justDragged = true;
    if (commitMove && target) {
      const res = patchItem(id, {ru: target.ru, face: target.face});
      if (res.ok) return; // patchItem already committed and re-rendered
      onEnd(res.reason); // refused: the page must show why and restore the panel
    } else {
      onEnd(null); // cancelled: nothing changed, just restore the panel
    }
  }

  function onPointerMove(ev) {
    if (!d || ev.pointerId !== d.pointerId) return;
    d.lastX = ev.clientX; d.lastY = ev.clientY;
    if (!d.moved) {
      if (Math.hypot(ev.clientX - d.startX, ev.clientY - d.startY) < THRESHOLD) return;
      beginDrag(ev);
    }
    ev.preventDefault();
    const pr = panesEl.getBoundingClientRect();
    d.scrollDir = ev.clientY - pr.top < 40 ? -1 : pr.bottom - ev.clientY < 40 ? 1 : 0;
    updatePreview(ev.clientX, ev.clientY);
  }

  function onPointerUp(ev) {
    if (!d || ev.pointerId !== d.pointerId) return;
    finish(true);
  }

  function onPointerCancel(ev) {
    if (!d || ev.pointerId !== d.pointerId) return;
    finish(false);
  }

  function onKeyDown(ev) {
    if (!d || !d.moved) return;
    if (ev.key === 'Escape' || ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
      ev.preventDefault();
      ev.stopPropagation();
      if (ev.key === 'Escape') finish(false);
    }
  }

  function onPointerDown(ev) {
    // Any new press - even one that turns out not to start a drag, like a
    // click on an empty U - means a PREVIOUS drag's still-unclaimed trailing
    // click (an engine that never sent one) is moot: it must not go on to
    // swallow a later, unrelated click once this press's own click arrives.
    justDragged = false;
    if (ev.button !== 0 || d) return;
    const group = ev.target.closest('[data-item-id]');
    // A press on the item's own panel group, or on its rack ears (round 3
    // §2's `<g class="rk-ears">`, which carries no data-panel) - either
    // starts a drag on the item, exactly like a press on the device itself.
    if (!group || !(['mounted', 'through', 'missing'].includes(group.dataset.panel)
                    || group.classList.contains('rk-ears'))) return;
    const item = itemById(group.dataset.itemId);
    if (!item) return;
    // A press on the ears group itself (fix round 1 #3) must still fade and
    // restore the item's own PANEL, not the small ear shapes - pointer
    // capture stays on whatever was actually pressed.
    const panelGroup = group.dataset.panel
      ? group
      : group.closest('svg')?.querySelector(`[data-item-id="${item.id}"][data-panel]`) || group;
    group.setPointerCapture(ev.pointerId);
    d = {id: item.id, item, group, panelGroup, pointerId: ev.pointerId, startX: ev.clientX, startY: ev.clientY,
         origFace: item.face, moved: false, scrollDir: 0, rafId: null};
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    window.addEventListener('keydown', onKeyDown, true);
  }

  function consumeClick() {
    const was = justDragged;
    justDragged = false;
    return was;
  }

  return {onPointerDown, consumeClick};
}
