// Geometry inside a composed 2D drawing. A face is placed by a transform on
// its group, so an element's getBBox is in its own space; this walks it back
// into the root <svg>'s user units, the same way artifact.js's box() does for
// the inlined drawing.

export function boxIn(root, el) {
  if (!el || !root) return null;
  const b = el.getBBox();
  const m = root.getScreenCTM()?.inverse().multiply(el.getScreenCTM());
  if (!m) return {x: b.x, y: b.y, width: b.width, height: b.height};
  const p = (x, y) => { const q = root.createSVGPoint(); q.x = x; q.y = y; return q.matrixTransform(m); };
  const a = p(b.x, b.y), c = p(b.x + b.width, b.y + b.height);
  return {x: Math.min(a.x, c.x), y: Math.min(a.y, c.y),
          width: Math.abs(c.x - a.x), height: Math.abs(c.y - a.y)};
}

export function highlight(root, el, tag = 'hl', pad = 1.2) {
  const b = boxIn(root, el);
  if (!b) return null;
  el.setAttribute('data-highlight', tag);
  const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  for (const [k, v] of Object.entries({x: b.x - pad, y: b.y - pad, width: b.width + pad * 2,
      height: b.height + pad * 2, rx: 1, class: 'pt-hl', 'data-highlight-box': tag,
      'pointer-events': 'none'})) r.setAttribute(k, v);
  root.append(r);
  return r;
}

export function clearHighlights(root, tag = 'hl') {
  root.querySelectorAll(`[data-highlight-box="${tag}"]`).forEach(n => n.remove());
  root.querySelectorAll(`[data-highlight="${tag}"]`).forEach(n => n.removeAttribute('data-highlight'));
}
