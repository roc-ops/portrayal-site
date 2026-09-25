// The compiled artifact and everything that operates on it: load, frame,
// pan/zoom, overlay, states, exports, panel builders. A stage or a spoke
// imports from here instead of relying on a module global that happens to be
// in scope.
//
// Nothing here fabricates data. Labels, states and component references are
// read off the compiled SVG's own attributes, and a state is only ever applied
// to an element that declares it in data-states.

// The default device: the one the page boots with. Which device is actually
// on the stage is DEVICE, below - a spoke opens any device in the cast.
export const DEV = 'as7726-32x';
export const CFG = 'ac-f2b';          // the default configuration
export const DIST = 'assets/dist/';

// Which device, face and configuration is on the stage. Assigned only here,
// by loadDrawing, and only once the file has actually arrived - so these always
// name the drawing that is loaded, never one that was asked for and failed.
export let DEVICE = DEV;
export let VIEW = 'front';
export let CONFIG = CFG;
const file = (dev, config, view) => `${dev}.${config}.${view}.svg`;
// The file on the stage, as the footer names it.
export const srcName = () => file(DEVICE, CONFIG, VIEW);

export const VIEWS = ['front', 'rear', 'top', 'bottom', 'left', 'right'];
export const CONFIGS = [
  {id: 'ac-f2b', label: 'AC · front-to-back'},
  {id: 'ac-b2f', label: 'AC · back-to-front'},
  {id: 'dc-f2b', label: 'DC · front-to-back'},
  {id: 'dc-b2f', label: 'DC · back-to-front'},
];

const $ = sel => document.querySelector(sel);
export const el = (tag, attrs = {}, kids = []) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'text') n.textContent = v;
    else n.setAttribute(k, v);
  }
  for (const c of [].concat(kids)) n.append(c);
  return n;
};
export const svgEl = (tag, attrs = {}) => {
  const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};

export const stage2d = $('#stage2d');
export const stage3d = $('#stage3d');
export const stageRack = $('#stageRack');
export const loading = $('#stageLoading');
export const panel = $('#sidePanel');
export const hint = $('#showHint');
export const srcLine = $('#showSrc');

export let svg = null;         // the live compiled drawing
export let overlay = null;     // our own layer inside it, in millimeter space
export let BASE_FRAME = null;

// The tab currently mounted over the drawing. setHost(null) detaches it (used
// while the drawing is reset out from under no particular tab); setDrawing
// tears the host down and rebuilds it around the new drawing, exactly as a
// tab's own view/config controls expect.
let host = null;
export function setHost(h) { host = h; gen++; }
// Whether `h` is the one mounted now - what a spoke's redraw asks, so a lens
// whose spoke has closed is refused before it can touch anything.
export const isHost = h => h !== null && host === h;

// THE LOAD GENERATION - the one guard every redraw goes through. Bumped by
// every loadDrawing/setDrawing and by every setHost, and captured before the
// fetch. A fetch that lands after it moved has been overtaken - by another
// redraw, by a spoke closing, by a rung click that closed the spoke - and it
// touches nothing: not #stage2d, not svg, not DEVICE/VIEW/CONFIG, not srcLine,
// not the scrim. It lives HERE, at the choke point, because a lens's own
// view/config buttons call setDrawing with no epoch of their own, and a guard
// each caller must remember is one the next caller forgets.
let gen = 0;

// ── Loading the artifact ───────────────────────────────────────────────
// `isStale`, when given, is asked as well once the file has arrived: a caller
// with its own notion of being overtaken (a spoke whose open lost to a rung
// click) gets false back and the stage is left exactly as it was.
export async function loadDrawing(dev = DEVICE, view = VIEW, config = CONFIG, isStale = null) {
  return load(dev, view, config, isStale, ++gen);
}

async function load(dev, view, config, isStale, mine) {
  const url = DIST + file(dev, config, view);
  const text = await fetch(url).then(r => {
    if (!r.ok) throw new Error(`${url} — ${r.status}`);
    return r.text();
  });
  if (mine !== gen || isStale?.()) return false;
  DEVICE = dev; VIEW = view; CONFIG = config;
  stage2d.innerHTML = text;
  svg = stage2d.querySelector('svg');
  // The file is authored at true size (438.4mm x 43.5mm). Drop the physical
  // width/height so it can be responsive, and keep the viewBox, which is what
  // carries the millimeters.
  BASE_FRAME = svg.getAttribute('viewBox').split(/\s+/).map(Number);
  svg.removeAttribute('width');
  svg.removeAttribute('height');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  overlay = svgEl('g', {id: 'pt-overlay', 'pointer-events': 'none'});
  svg.append(overlay);
  TAB_FRAME = [...BASE_FRAME];
  pz2d = panZoom(svg, () => TAB_FRAME);
  srcLine.textContent = srcName();
  loading.hidden = true;
  return true;
}

// Swap the artifact under the current host. The host is torn down and rebuilt
// around the new drawing rather than patched, because its listeners are bound
// to the old SVG element and its overlay lives inside it.
//
// `dev` defaults to the device already on the stage, not to DEV: a caller that
// only asks for another view must not silently change device underneath it.
//
// The host is captured once, at entry. It is re-entered only if it is still
// the host and nothing has redrawn since - otherwise a late fetch would enter
// a lens a second time, or enter one that has already been closed.
//
// A caller that is ALREADY stale is refused before anything moves, the load
// generation included: bumping it would cancel whatever load is legitimately
// in flight (a spoke opening), so a dead lens's click would strand the live
// one on its scrim.
export async function setDrawing(view, config, dev = DEVICE, isStale = null) {
  if (isStale?.()) return false;
  if (dev === DEVICE && view === VIEW && config === CONFIG) return true;
  const h = host;
  const mine = ++gen;
  await h?.exit?.();
  if (mine !== gen || isStale?.()) return false;
  const ok = await load(dev, view, config, isStale, mine);
  if (ok && host === h && mine === gen) await h?.enter?.();
  return ok;
}

// ── Small helpers over the drawing ─────────────────────────────────────
export const node = path => svg.querySelector(`[data-path="${CSS.escape(path)}"]`);
export const box = path => {
  const n = node(path);
  if (!n) return null;
  const b = n.getBBox();
  // getBBox is in the element's own space; these elements are placed by a
  // transform on the group, so walk it back up to the root frame.
  const m = n.getCTM ? null : null;
  const ctm = n.getScreenCTM && svg.getScreenCTM
    ? svg.getScreenCTM().inverse().multiply(n.getScreenCTM())
    : null;
  if (!ctm) return b;
  const pt = (x, y) => {
    const p = svg.createSVGPoint(); p.x = x; p.y = y;
    return p.matrixTransform(ctm);
  };
  const a = pt(b.x, b.y), c = pt(b.x + b.width, b.y + b.height);
  return {x: Math.min(a.x, c.x), y: Math.min(a.y, c.y),
          width: Math.abs(c.x - a.x), height: Math.abs(c.y - a.y)};
};

// The frame a tab wants. Pan and zoom ride on top of it, so changing tabs
// always starts from a known fit rather than wherever the last drag left off.
let TAB_FRAME = null;
let pz2d = null;
export const setFrame = (x, y, w, h) => { TAB_FRAME = [x, y, w, h]; pz2d ? pz2d.reset() : svg.setAttribute('viewBox', TAB_FRAME.join(' ')); };
export const resetFrame = () => setFrame(...BASE_FRAME);

// Wheel to zoom about the cursor, drag to pan, double-click to fit. Operates on
// the viewBox rather than a transform, so millimeters stay millimeters and
// getBBox-derived overlays keep working unchanged. `show(frame)` puts up a
// view other than the base - an opening close-up - without changing what
// double-click fits back to.
//
// The base frame is also left on the node (__ptBase, the function, so a tab
// that changes its frame is read at the time of asking): standalone() exports
// THAT, never the crop the visitor has panned or zoomed to.
export function panZoom(node, baseFrame) {
  node.__ptBase = baseFrame;
  let view = [...baseFrame()];
  let drag = null, moved = false;
  const apply = () => node.setAttribute('viewBox', view.join(' '));
  const reset = () => { view = [...baseFrame()]; apply(); };

  node.style.touchAction = 'none';
  node.style.cursor = 'grab';

  node.addEventListener('wheel', ev => {
    ev.preventDefault();
    const ctm = node.getScreenCTM();
    if (!ctm) return;
    const p = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(ctm.inverse());
    const base = baseFrame();
    const k = Math.exp(ev.deltaY * 0.0015);
    const w = Math.min(base[2] * 3, Math.max(base[2] / 25, view[2] * k));
    const s = w / view[2];
    view = [p.x - (p.x - view[0]) * s, p.y - (p.y - view[1]) * s, view[2] * s, view[3] * s];
    apply();
  }, {passive: false});

  node.addEventListener('pointerdown', ev => {
    if (ev.button !== 0) return;
    drag = {x: ev.clientX, y: ev.clientY, view: [...view]};
    moved = false;
    node.style.cursor = 'grabbing';
    node.setPointerCapture?.(ev.pointerId);
  });
  node.addEventListener('pointermove', ev => {
    if (!drag) return;
    const r = node.getBoundingClientRect();
    const dx = (ev.clientX - drag.x) * view[2] / r.width;
    const dy = (ev.clientY - drag.y) * view[3] / r.height;
    if (Math.hypot(ev.clientX - drag.x, ev.clientY - drag.y) > 3) moved = true;
    view = [drag.view[0] - dx, drag.view[1] - dy, view[2], view[3]];
    apply();
  });
  const end = ev => { if (!drag) return; drag = null; node.style.cursor = 'grab'; node.releasePointerCapture?.(ev.pointerId); };
  node.addEventListener('pointerup', end);
  node.addEventListener('pointercancel', end);
  // A pan that ends over a port must not also select it.
  node.addEventListener('click', ev => { if (moved) { ev.stopPropagation(); moved = false; } }, true);
  node.addEventListener('dblclick', reset);

  const show = frame => { view = [...frame]; apply(); };
  return {reset, show};
}
export const clearOverlay = () => { while (overlay.firstChild) overlay.firstChild.remove(); };

// A single brass stroke disappears against the faceplate, which is dark gray
// whatever the page theme is doing. Draw a dark halo underneath and the bright
// brass on top, so the ring separates from the metal at any zoom.
export function ring(path, cls = 'pt-ring', pad = 0.9) {
  const b = box(path);
  if (!b) return null;
  const geom = {x: b.x - pad, y: b.y - pad,
                width: b.width + pad * 2, height: b.height + pad * 2, rx: 0.8};
  const halo = svgEl('rect', {class: `${cls}-halo`, ...geom});
  const r = svgEl('rect', {class: cls, ...geom});
  overlay.append(halo, r);
  return r;
}

// Every state class this drawing ships, so the demo can only ask for states the
// model actually declares.
export const declared = path => (node(path)?.getAttribute('data-states') || '').split(/\s+/).filter(Boolean);
export function setState(path, state) {
  const n = node(path);
  if (!n) return false;
  const ok = declared(path);
  [...n.classList].filter(c => c.startsWith('state-')).forEach(c => n.classList.remove(c));
  if (!state || state === 'off') return true;
  if (ok.length && !ok.includes(state)) return false;   // refuse an undeclared state
  n.classList.add(`state-${state}`);
  return true;
}
export function clearStates() {
  svg.querySelectorAll('[class*="state-"]').forEach(n =>
    [...n.classList].filter(c => c.startsWith('state-')).forEach(c => n.classList.remove(c)));
}

// ── Exporting what is on screen ────────────────────────────────────────
export const exportSlot = document.getElementById('stageExport');

const DL_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" ' +
  'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M8 2v8M4.5 7l3.5 3.5L11.5 7M2.5 13h11"/></svg>';

export function setExports(items) {
  exportSlot.replaceChildren();
  for (const it of items) {
    const b = el('button', {type: 'button', title: it.title || `Download ${it.label}`,
                            html: DL_ICON + `<span>${it.label}</span>`});
    b.onclick = async () => {
      const span = b.querySelector('span');
      const was = span.textContent;
      b.disabled = true; span.textContent = 'preparing…';
      try { await it.run(); span.textContent = was; }
      catch (err) { span.textContent = 'failed'; console.warn('[portrayal] export', err); }
      finally { b.disabled = false; setTimeout(() => { span.textContent = was; }, 2500); }
    };
    exportSlot.append(b);
  }
}

export function save(data, filename, type) {
  const url = URL.createObjectURL(new Blob([data], {type}));
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// A standalone copy of what is on screen.
//
// The compiled drawing already carries its own <style> and its own semantics, so
// the export keeps every id and data-path - the file you get out is as
// addressable as the one on the page. What does NOT travel is this site's own
// CSS: overlay callouts and rack rails are styled by site.css and painted from
// --pt-* tokens that mean nothing outside this document. Those get their
// computed values written back as presentation attributes.
//
// Deliberately narrow: only attributes naming a --pt- token and only elements
// with our own classes are touched. Resolving every element would multiply the
// file size, and the compiled stylesheet's own custom properties - --led-color
// and the rest - must be left alone or a lit LED exports unlit.
//
// Nor does the page's UI. spoke-host.js's wireDevices makes each device on a
// 2D elevation a button - tabindex, role, aria-label, the pt-device class and
// a hover <title> - and marks all of it with data-pt-ui: on an element, the
// attribute names (and `.class`es) it added; on a node it added, "*". Those
// come off the clone here, the class BEFORE the baking pass below (pt-device
// would otherwise match its /pt-/ test and bake computed paint onto every
// device group), the nodes after it, so the two lists stay index-aligned.
//
// NOR THE VISITOR'S VIEW OF IT. panZoom works by rewriting the live viewBox
// and sets touch-action and cursor inline; a copy of those is whatever crop
// the visitor last zoomed to, under a title that promises the whole drawing.
// So the clone - never the live node - gets back the base frame panZoom
// recorded, and loses panZoom's inline style.
export function standalone(node) {
  const clone = node.cloneNode(true);
  const base = node.__ptBase?.();
  if (base) clone.setAttribute('viewBox', base.join(' '));
  clone.style?.removeProperty('touch-action');
  clone.style?.removeProperty('cursor');
  if (clone.getAttribute('style')?.trim() === '') clone.removeAttribute('style');
  const orig = [node, ...node.querySelectorAll('*')];
  const copy = [clone, ...clone.querySelectorAll('*')];
  for (const ce of copy) {
    const ui = ce.getAttribute?.('data-pt-ui');
    if (ui == null || ui === '*') continue;
    for (const t of ui.split(/\s+/).filter(Boolean)) {
      if (t.startsWith('.')) ce.classList.remove(t.slice(1));
      else ce.removeAttribute(t);
    }
    if (ce.getAttribute('class') === '') ce.removeAttribute('class');
    ce.removeAttribute('data-pt-ui');
  }
  const PROPS = ['fill', 'stroke', 'stroke-width', 'stroke-linejoin', 'stroke-linecap',
                 'opacity', 'font-family', 'font-size', 'font-weight', 'paint-order'];
  for (let i = 0; i < orig.length; i++) {
    const oe = orig[i], ce = copy[i];
    if (!ce.getAttribute) continue;
    const ours = /\b(pt|dim)-/.test(ce.getAttribute('class') || '');
    const tokened = [...ce.attributes].some(a => a.value.includes('var(--pt-'));
    if (!ours && !tokened) continue;
    const cs = getComputedStyle(oe);
    for (const prop of PROPS) {
      const v = cs.getPropertyValue(prop);
      if (v) ce.setAttribute(prop, v.trim());
    }
  }
  clone.querySelectorAll('[data-pt-ui="*"]').forEach(n => n.remove());
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
         new XMLSerializer().serializeToString(clone);
}

export const saveSvg = (node, filename) => save(standalone(node), filename, 'image/svg+xml');

// ── Side panel builders ────────────────────────────────────────────────
export const title = t => el('p', {class: 'panel-title', text: t});
export const lead = h => el('p', {class: 'panel-lead', html: h});
export function kv(rows) {
  const d = el('dl', {class: 'kv'});
  for (const [k, v, hi] of rows) {
    d.append(el('dt', {text: k}), el('dd', {class: hi ? 'hi' : '', text: v}));
  }
  return d;
}
export function controls(defs) {
  const wrap = el('div', {class: 'ctl'});
  for (const d of defs) {
    const b = el('button', {type: 'button', text: d.label});
    if (d.toggle) b.setAttribute('aria-pressed', 'false');
    b.onclick = () => {
      if (d.toggle) b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') === 'false');
      d.run(b, wrap);
    };
    wrap.append(b);
  }
  return wrap;
}
export function setPanel(...kids) { panel.replaceChildren(...kids); }
