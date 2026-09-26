// ZOOM (rack feedback round 1): one scale for both panes, so front and rear
// stay in step. `applyZoom` writes it onto a set of SVGs after every render
// (they're replaced each time) and on resize; `wheelZoom` turns a ctrl/cmd
// wheel event into the next zoom, anchored at the pointer. The page owns the
// buttons and S.zoom; this module knows nothing about either.

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

export function zoomLabel(zoom) { return zoom === 'fit' ? 'Fit' : `${Math.round(zoom * 100)}%`; }

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

// Fit has no stored numeric factor, so a step away from it starts from
// what's actually on screen right now.
function currentFactor(panesEl, svgs, zoom) {
  if (zoom !== 'fit') return zoom;
  const svg = svgs[0];
  if (!svg) return 1;
  const w = columnWidth(panesEl);
  const rendered = svg.getBoundingClientRect().width;
  return w > 0 && rendered > 0 ? rendered / w : 1;
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

// ctrl/cmd + wheel over the panes: a trackpad pinch arrives this way in
// Chromium and Safari, so this covers pinch too. Anchored at the pointer -
// the point under the cursor stays under it - by adjusting scroll position
// by the same ratio the zoom just changed by.
export function wheelZoom(panesEl, svgs, zoom, ev) {
  ev.preventDefault();
  const factor = currentFactor(panesEl, svgs, zoom);
  const next = clampZoom(factor * Math.pow(1.1, -ev.deltaY / 100));
  const rect = panesEl.getBoundingClientRect();
  const px = ev.clientX - rect.left, py = ev.clientY - rect.top;
  const x = px + panesEl.scrollLeft, y = py + panesEl.scrollTop;
  const ratio = next / factor;
  applyZoom(panesEl, svgs, next);
  panesEl.scrollLeft = x * ratio - px;
  panesEl.scrollTop = y * ratio - py;
  return next;
}
