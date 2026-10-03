// ZOOM (rack feedback round 1, fix round 1): one scale for both panes, so
// front and rear stay in step. `applyZoom` writes it onto a set of SVGs
// after every render (they're replaced each time) and on resize; `wheelZoom`
// turns a ctrl/cmd wheel event into the next zoom, anchored at the pointer.
// The page owns the buttons and S.zoom; this module knows nothing about
// either.

const KEY = 'portrayal.rack.zoom';
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 6;
const STEP = 1.25;

export const clampZoom = n => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, n));

export function loadZoom() {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'fit') return 'fit';
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return clampZoom(n);
  } catch { /* a per-viewer convenience, not document state */ }
  return 'fit';
}

export function saveZoom(zoom) {
  try { localStorage.setItem(KEY, String(zoom)); } catch { /* a per-viewer convenience, not document state */ }
}

// The readout is relative to Fit, not to the raw factor (a controller ruling
// - Fit is "the old look" from the person's point of view, so "150%" should
// mean "half again bigger than what just fit", not half again bigger than a
// column's own width, which for a tall rack in a short window is already
// far below 100%).
export function zoomLabel(zoom, fitFactor = 1) {
  if (zoom === 'fit') return 'Fit';
  const pct = fitFactor > 0 ? (zoom / fitFactor) * 100 : zoom * 100;
  return `${Math.round(pct)}%`;
}

// A pane's width at zoom 1 (the old, unzoomed look): the panes area split
// evenly in two, minus its own padding and the gap between them.
function columnWidth(panesEl) {
  const cs = getComputedStyle(panesEl);
  const pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
  const gap = parseFloat(cs.columnGap || cs.gap) || 0;
  return Math.max(0, (panesEl.clientWidth - pad - gap) / 2);
}

// The available height for one pane's SVG in Fit mode: the scroll area's own
// height, minus its padding and that pane's heading.
function fitHeight(panesEl, svg) {
  const h = heightAvailable(panesEl, svg);
  // A rack with cables is wider than a plain one (its side column), so the
  // height alone can make it wider than its column: it fits the width too.
  // A plain rack is exactly as before.
  const vb = svg.viewBox?.baseVal;
  if (svg.dataset.baseBox && vb && vb.width > 0 && vb.height > 0) {
    const w = columnWidth(panesEl);
    if (w > 0) return Math.min(h, w * vb.height / vb.width);
  }
  return h;
}
function heightAvailable(panesEl, svg) {
  const heading = svg.parentElement?.previousElementSibling;
  const cs = getComputedStyle(panesEl);
  const padV = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
  let headingH = 0;
  if (heading) {
    const hcs = getComputedStyle(heading);
    headingH = heading.offsetHeight + (parseFloat(hcs.marginTop) || 0) + (parseFloat(hcs.marginBottom) || 0);
  }
  return Math.max(0, panesEl.clientHeight - padV - headingH);
}

// The absolute factor Fit would render at right now, from the SVG's own
// intrinsic aspect ratio (its viewBox) rather than from whatever is
// currently on screen - this has to work even when the page isn't currently
// in Fit mode, since the numeric-zoom readout needs it too.
export function factorForFit(panesEl, svg) {
  if (!svg) return 1;
  const vb = svg.viewBox?.baseVal;
  const aspect = vb && vb.height ? vb.width / vb.height : 1;
  const w = columnWidth(panesEl);
  return w > 0 ? (fitHeight(panesEl, svg) * aspect) / w : 1;
}

// Fit has no stored numeric factor, so a step away from it starts from the
// absolute factor Fit is rendering at right now.
function currentFactor(panesEl, svgs, zoom) {
  return zoom === 'fit' ? factorForFit(panesEl, svgs[0]) : zoom;
}

export function stepZoom(panesEl, svgs, zoom, direction) {
  const factor = currentFactor(panesEl, svgs, zoom);
  return clampZoom(direction > 0 ? factor * STEP : factor / STEP);
}

export function applyZoom(panesEl, svgs, zoom) {
  for (const svg of svgs) {
    if (zoom === 'fit') {
      svg.style.width = 'auto';
      svg.style.height = `${fitHeight(panesEl, svg)}px`;
    } else {
      svg.style.width = `${columnWidth(panesEl) * zoom}px`;
      svg.style.height = 'auto';
    }
  }
}

// The pane SVG a pointer event is over, or the nearer one if it lands
// between them (over the gap, or over the side panel during a fast wheel).
function paneUnder(svgs, clientX, clientY) {
  let best = null, bestDist = Infinity;
  for (const svg of svgs) {
    const r = svg.getBoundingClientRect();
    if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) return svg;
    const dx = Math.max(r.left - clientX, 0, clientX - r.right);
    const dy = Math.max(r.top - clientY, 0, clientY - r.bottom);
    const d = Math.hypot(dx, dy);
    if (d < bestDist) { bestDist = d; best = svg; }
  }
  return best;
}

// A trackpad's wheel delta arrives in different units depending on the
// device and browser (deltaMode 0 = pixels, the common case; 1 = lines; 2 =
// pages) - without normalizing this, the same physical gesture would zoom at
// wildly different rates depending on deltaMode.
function pixelDeltaY(panesEl, ev) {
  if (ev.deltaMode === 1) return ev.deltaY * 16;
  if (ev.deltaMode === 2) return ev.deltaY * panesEl.clientHeight;
  return ev.deltaY;
}

// ctrl/cmd + wheel over the panes: a trackpad pinch arrives this way in
// Chromium and Safari, so this covers pinch too. Anchored at the pointer -
// the point under the cursor stays under it - by reading the fraction of the
// pane's own SVG box under the pointer before the zoom, then scrolling so
// that same fraction of the (resized) SVG box lands back under the pointer.
// This is exact regardless of the panes' padding, the gap between them, or
// either heading's height, because it measures the SVG's rendered box
// directly rather than reconstructing it from those pieces.
export function wheelZoom(panesEl, svgs, zoom, ev) {
  ev.preventDefault();
  const factor = currentFactor(panesEl, svgs, zoom);
  const next = clampZoom(factor * Math.pow(1.1, -pixelDeltaY(panesEl, ev) / 100));
  const svg = paneUnder(svgs, ev.clientX, ev.clientY);
  if (!svg) { applyZoom(panesEl, svgs, next); return next; }
  const r = svg.getBoundingClientRect();
  const fx = r.width > 0 ? (ev.clientX - r.left) / r.width : 0.5;
  const fy = r.height > 0 ? (ev.clientY - r.top) / r.height : 0.5;
  applyZoom(panesEl, svgs, next);
  const r2 = svg.getBoundingClientRect();
  panesEl.scrollLeft += r2.left + fx * r2.width - ev.clientX;
  panesEl.scrollTop += r2.top + fy * r2.height - ev.clientY;
  return next;
}
