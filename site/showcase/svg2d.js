// Geometry inside a composed 2D drawing. A face is placed by a transform on
// its group, so an element's getBBox is in its own space; this walks it back
// into the root <svg>'s user units, the same way artifact.js's box() does for
// the inlined drawing.

export function boxIn(root, el) {
  if (!el || !root) return null;
  // No CTM means a detached or undisplayed root or element: there is no
  // honest box to give, and a local-space one would land in the wrong place.
  const rc = root.getScreenCTM(), ec = el.getScreenCTM();
  if (!rc || !ec) return null;
  const b = el.getBBox();
  const m = rc.inverse().multiply(ec);
  const p = (x, y) => { const q = root.createSVGPoint(); q.x = x; q.y = y; return q.matrixTransform(m); };
  const a = p(b.x, b.y), c = p(b.x + b.width, b.y + b.height);
  return {x: Math.min(a.x, c.x), y: Math.min(a.y, c.y),
          width: Math.abs(c.x - a.x), height: Math.abs(c.y - a.y)};
}

// A highlight is page UI, not drawing, and it says so itself: the rect is
// marked data-pt-ui="*" and `data-highlight` is added to the element's
// data-pt-ui list, so artifact.js's standalone() strips both and no export
// ever carries one - whoever called this.
export function highlight(root, el, tag = 'hl', pad = 1.2) {
  const b = boxIn(root, el);
  if (!b) return null;
  el.setAttribute('data-highlight', tag);
  const had = el.getAttribute('data-pt-ui');
  if (had !== '*' && !(had || '').split(/\s+/).includes('data-highlight')) {
    el.setAttribute('data-pt-ui', `${had ? had + ' ' : ''}data-highlight`);
  }
  const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  for (const [k, v] of Object.entries({x: b.x - pad, y: b.y - pad, width: b.width + pad * 2,
      height: b.height + pad * 2, rx: 1, class: 'pt-hl', 'data-highlight-box': tag,
      'data-pt-ui': '*', 'pointer-events': 'none'})) r.setAttribute(k, v);
  root.append(r);
  return r;
}

export function clearHighlights(root, tag = 'hl') {
  root.querySelectorAll(`[data-highlight-box="${tag}"]`).forEach(n => n.remove());
  root.querySelectorAll(`[data-highlight="${tag}"]`).forEach(n => {
    n.removeAttribute('data-highlight');
    const ui = n.getAttribute('data-pt-ui');
    if (ui == null || ui === '*') return;
    const rest = ui.split(/\s+/).filter(t => t && t !== 'data-highlight').join(' ');
    rest ? n.setAttribute('data-pt-ui', rest) : n.removeAttribute('data-pt-ui');
  });
}

// ONE WAY TO CLICK ON A DRAWING. A cast device on a 2D elevation (spoke-host's
// wireDevices) and a cable's cross-face tag (patch-view.js) are both buttons
// inside a pan/zoom <svg>. Two copies of this once drifted: one lost the
// double-click window, so a double-click over it acted instead of fitting
// the drawing.
//
//   wireClicks(root, {targetAt, open, ui = null, dblMs = 300})
//
// `targetAt(node)` names the target an event node belongs to, or null;
// `open(target, {keyboard})` acts on it. `ui` is the entry's lease, when
// there is one.
//
// A drag that pans is not a click. panZoom (artifact.js) captures the pointer
// on the <svg> at pointerdown, so in Chromium the click that ends a gesture
// is aimed at the <svg>, not the element under it. So the press is recorded
// on the root, in the capture phase (before panZoom takes the pointer), and
// the target is the one the pointer went DOWN on; a pointer that moved more
// than panZoom's own 3 px since then panned, and opens nothing. A
// pointercancel forgets the press.
//
// Nor is a double-click: panZoom fits the drawing on dblclick, and that has
// to survive over a target. A pointer click therefore opens after `dblMs`; a
// second press inside that window cancels it and the fit runs, and a click
// with detail > 1 is ignored. When the timer comes due it does nothing if
// the drawing is off the page (redrawn, or the stage left) or the lease has
// gone stale, so a timer never acts after the visitor has moved on.
//
// Enter or Space on a focused target opens it at once (a held key's repeats
// are ignored). A click with no press before it - element.click(), assistive
// tech - has no drag or double-click to rule out, and opens at once too.
export function wireClicks(root, {targetAt, open, ui = null, dblMs = 300}) {
  const alive = () => root.isConnected && !(ui && !ui.live());
  let down = null;
  let pending = null;
  const cancel = () => { clearTimeout(pending); pending = null; };
  root.addEventListener('pointerdown', ev => {
    cancel();
    down = ev.button === 0 ? {t: targetAt(ev.target), x: ev.clientX, y: ev.clientY} : null;
  }, true);
  root.addEventListener('pointercancel', () => { down = null; }, true);
  root.addEventListener('click', ev => {
    const d = down;
    down = null;
    if (!d) {
      const t = targetAt(ev.target);
      if (t && alive()) open(t, {keyboard: false});
      return;
    }
    if (!d.t || ev.detail > 1) return;
    if (Math.hypot(ev.clientX - d.x, ev.clientY - d.y) > 3) return;
    const t = d.t;
    pending = setTimeout(() => {
      pending = null;
      if (alive()) open(t, {keyboard: false});
    }, dblMs);
  });
  root.addEventListener('keydown', ev => {
    if (ev.repeat || (ev.key !== 'Enter' && ev.key !== ' ')) return;
    const t = targetAt(ev.target);
    if (!t) return;
    ev.preventDefault();
    if (alive()) open(t, {keyboard: true});
  });
}
