// portrayal.dev — the showcase.
//
// One compiled artifact, seven lenses. Every tab drives the *same* inlined SVG
// (except 3D and Rack, which mount their own stage), because that is the claim
// the page is making: the drawing is addressable, so you do not need a
// different picture for a different job.
//
// Nothing here fabricates data. Labels, states and component references are
// read off the compiled SVG's own attributes, and a state is only ever applied
// to an element that declares it in data-states.

const DEV = 'as7726-32x';
const CFG = 'ac-f2b';          // the default configuration
const DIST = 'assets/dist/';

// Which face and which configuration is on the stage. The Inspect tab lets you
// change both; every other tab is written against the front view of the default
// config and resets to it on entry.
let VIEW = 'front';
let CONFIG = CFG;
const src = () => `${DIST}${DEV}.${CONFIG}.${VIEW}.svg`;

const VIEWS = ['front', 'rear', 'top', 'bottom', 'left', 'right'];
const CONFIGS = [
  {id: 'ac-f2b', label: 'AC · front-to-back'},
  {id: 'ac-b2f', label: 'AC · back-to-front'},
  {id: 'dc-f2b', label: 'DC · front-to-back'},
  {id: 'dc-b2f', label: 'DC · back-to-front'},
];

const $ = sel => document.querySelector(sel);
const el = (tag, attrs = {}, kids = []) => {
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
const svgEl = (tag, attrs = {}) => {
  const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};

const stage2d = $('#stage2d');
const stage3d = $('#stage3d');
const stageRack = $('#stageRack');
const loading = $('#stageLoading');
const panel = $('#sidePanel');
const hint = $('#showHint');
const srcLine = $('#showSrc');

let svg = null;         // the live compiled drawing
let overlay = null;     // our own layer inside it, in millimeter space
let BASE_FRAME = null;

// ── Loading the artifact ───────────────────────────────────────────────
async function loadDrawing() {
  const url = src();
  const text = await fetch(url).then(r => {
    if (!r.ok) throw new Error(`${url} — ${r.status}`);
    return r.text();
  });
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
  srcLine.textContent = `${DEV}.${CONFIG}.${VIEW}.svg`;
  loading.hidden = true;
}

// Swap the artifact under the current tab. The tab is torn down and rebuilt
// around the new drawing rather than patched, because its listeners are bound
// to the old SVG element and its overlay lives inside it.
async function setDrawing(view, config) {
  if (view === VIEW && config === CONFIG) return;
  const tab = current;
  if (tab) await TABS[tab].exit?.();
  VIEW = view;
  CONFIG = config;
  await loadDrawing();
  if (tab) await TABS[tab].enter();
}

// ── Small helpers over the drawing ─────────────────────────────────────
const node = path => svg.querySelector(`[data-path="${CSS.escape(path)}"]`);
const box = path => {
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
const setFrame = (x, y, w, h) => { TAB_FRAME = [x, y, w, h]; pz2d ? pz2d.reset() : svg.setAttribute('viewBox', TAB_FRAME.join(' ')); };
const resetFrame = () => setFrame(...BASE_FRAME);

// Wheel to zoom about the cursor, drag to pan, double-click to fit. Operates on
// the viewBox rather than a transform, so millimeters stay millimeters and
// getBBox-derived overlays keep working unchanged.
function panZoom(node, baseFrame) {
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

  return {reset};
}
const clearOverlay = () => { while (overlay.firstChild) overlay.firstChild.remove(); };

// A single brass stroke disappears against the faceplate, which is dark gray
// whatever the page theme is doing. Draw a dark halo underneath and the bright
// brass on top, so the ring separates from the metal at any zoom.
function ring(path, cls = 'pt-ring', pad = 0.9) {
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
const declared = path => (node(path)?.getAttribute('data-states') || '').split(/\s+/).filter(Boolean);
function setState(path, state) {
  const n = node(path);
  if (!n) return false;
  const ok = declared(path);
  [...n.classList].filter(c => c.startsWith('state-')).forEach(c => n.classList.remove(c));
  if (!state || state === 'off') return true;
  if (ok.length && !ok.includes(state)) return false;   // refuse an undeclared state
  n.classList.add(`state-${state}`);
  return true;
}
function clearStates() {
  svg.querySelectorAll('[class*="state-"]').forEach(n =>
    [...n.classList].filter(c => c.startsWith('state-')).forEach(c => n.classList.remove(c)));
}

// ── Exporting what is on screen ────────────────────────────────────────
const exportSlot = document.getElementById('stageExport');

const DL_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" ' +
  'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M8 2v8M4.5 7l3.5 3.5L11.5 7M2.5 13h11"/></svg>';

function setExports(items) {
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

function save(data, filename, type) {
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
function standalone(node) {
  const clone = node.cloneNode(true);
  const orig = [node, ...node.querySelectorAll('*')];
  const copy = [clone, ...clone.querySelectorAll('*')];
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
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
         new XMLSerializer().serializeToString(clone);
}

const saveSvg = (node, filename) => save(standalone(node), filename, 'image/svg+xml');

// ── Side panel builders ────────────────────────────────────────────────
const title = t => el('p', {class: 'panel-title', text: t});
const lead = h => el('p', {class: 'panel-lead', html: h});
function kv(rows) {
  const d = el('dl', {class: 'kv'});
  for (const [k, v, hi] of rows) {
    d.append(el('dt', {text: k}), el('dd', {class: hi ? 'hi' : '', text: v}));
  }
  return d;
}
function controls(defs) {
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
const setPanel = (...kids) => { panel.replaceChildren(...kids); };

// ── Tab: Inspect ───────────────────────────────────────────────────────
const inspect = (() => {
  let readout, onMove, onLeave, hoverRing;
  const FIELDS = [
    ['data-class', 'class'], ['data-ref', 'contract'], ['data-media', 'media'],
    ['data-speed', 'speed'], ['data-lanes', 'lanes'], ['data-group', 'group'],
    ['data-role', 'role'], ['data-model', 'model'], ['data-sku', 'sku'],
    ['data-part-number', 'part'], ['data-members', 'members'], ['data-states', 'states'],
    ['data-for', 'belongs to'],
  ];
  function show(target) {
    clearOverlay();
    if (!target) {
      readout.replaceChildren(el('p', {class: 'panel-lead', text: 'Move over the drawing.'}));
      return;
    }
    const path = target.getAttribute('data-path');
    hoverRing = ring(path, 'pt-ring');
    const rows = [['path', path, true]];
    for (const [attr, label] of FIELDS) {
      const v = target.getAttribute(attr);
      if (v) rows.push([label, v]);
    }
    readout.replaceChildren(kv(rows));
  }
  return {
    hint: 'Hover any element; everything shown is read off its own attributes. Switch to the rear and try AC against DC — the PSU modules and the airflow stripe both change, because a configuration is a different compile.',
    enter() {
      resetFrame();
      readout = el('div', {class: 'readout'});
      const viewRow = controls(VIEWS.map(v => ({
        label: v, run: () => setDrawing(v, CONFIG),
      })));
      const cfgRow = controls(CONFIGS.map(c => ({
        label: c.label, run: () => setDrawing(VIEW, c.id),
      })));
      const mark = () => {
        [...viewRow.children].forEach(b => b.setAttribute('aria-pressed', String(b.textContent === VIEW)));
        [...cfgRow.children].forEach((b, i) => b.setAttribute('aria-pressed', String(CONFIGS[i].id === CONFIG)));
      };
      mark();
      // The readout goes first. It is the only thing here that changes while you
      // move the mouse, and putting the view and config rows above it pushed it
      // below the fold of the panel.
      setPanel(
        title('Inspect'),
        el('p', {class: 'panel-title', text: 'element'}),
        readout,
        el('p', {class: 'panel-title', text: 'view'}), viewRow,
        el('p', {class: 'panel-title', text: 'configuration'}), cfgRow,
        el('p', {class: 'panel-lead', html: 'A configuration populates the bays. Swapping AC for DC swaps the <em>modules</em> — the drawing is recompiled per configuration, not recolored.'}),
      );
      show(null);
      setExports([{label: 'SVG', title: 'Download this view as SVG',
        run: () => saveSvg(svg, `${DEV}.${CONFIG}.${VIEW}.svg`)}]);
      onMove = ev => {
        const t = ev.target.closest?.('[data-path]');
        show(t && t !== svg ? t : null);
      };
      onLeave = () => show(null);
      svg.addEventListener('pointermove', onMove);
      svg.addEventListener('pointerleave', onLeave);
    },
    exit() {
      svg.removeEventListener('pointermove', onMove);
      svg.removeEventListener('pointerleave', onLeave);
      clearOverlay();
    },
  };
})();

// ── Tab: Callouts ──────────────────────────────────────────────────────
const callouts = (() => {
  // Datasheet-style annotation. What is authored is only *which* elements are
  // worth pointing at and which side they leave from; every coordinate, and
  // most of the label text, is derived from the drawing.
  //
  // Leaders never cross because anchors and label slots are both laid out in
  // ascending x within a side, so their order is preserved by construction.
  const TARGETS = [
    {path: 'port-1',             side: 'up'},
    {path: 'port-32',            side: 'up'},
    {path: 'region:mgmt-block',  side: 'up'},
    {path: 'region:status-leds', side: 'down'},
    {path: 'region:intake',      side: 'down', note: 'front-to-back airflow'},
    {path: 'mgmt-eth',           side: 'down'},
  ];

  const LABEL = 7;      // mm — ~12px once the 438mm drawing is laid out
  const SUB = 5;
  const CH = 0.6;       // IBM Plex Mono advance, as a fraction of the em
  const width = (text, size) => text.length * size * CH;

  // A sub-label built from the element's own attributes wherever it has them.
  function describe(n, fallback) {
    const a = k => n.getAttribute(k);
    if (a('data-class') === 'port') {
      return [a('data-media'), a('data-speed'), a('data-lanes') && `${a('data-lanes')} lanes`]
        .filter(Boolean).join(' · ');
    }
    if (a('data-class') === 'region') {
      const m = (a('data-members') || '').split(/\s+/).filter(Boolean);
      if (m.length) return `${m.length} members`;
    }
    if (a('data-model')) return [a('data-model'), a('data-sku')].filter(Boolean).join(' · ');
    return fallback || a('data-class') || '';
  }

  function layout(side, W) {
    const rows = TARGETS.filter(t => t.side === side)
      .map(t => {
        const n = node(t.path), b = box(t.path);
        if (!n || !b) return null;
        const label = t.path;
        const sub = describe(n, t.note);
        return {...t, n, b, label, sub, w: Math.max(width(label, LABEL), width(sub, SUB))};
      })
      .filter(Boolean)
      .sort((a, r) => (a.b.x + a.b.width / 2) - (r.b.x + r.b.width / 2));

    // Three passes. Forward: sit each block under its own anchor, pushed right
    // only as far as the previous block requires. Backward: pull anything that
    // overhangs the right edge back in, carrying its neighbors with it.
    // Forward again: nothing may end up left of the frame.
    //
    // Shifting the whole row by the right-hand overflow - the obvious fix - is
    // wrong: it drags the left-most label off the other edge.
    const GAP = 22, MIN = 8;
    let prev = MIN;
    for (const r of rows) {
      r.tx = Math.max(r.b.x + r.b.width / 2 - 10, prev);
      prev = r.tx + r.w + GAP;
    }
    for (let i = rows.length - 1; i >= 0; i--) {
      const limit = i === rows.length - 1 ? W - rows[i].w : rows[i + 1].tx - rows[i].w - GAP;
      rows[i].tx = Math.min(rows[i].tx, limit);
    }
    prev = MIN;
    for (const r of rows) {
      r.tx = Math.max(r.tx, prev);
      prev = r.tx + r.w + GAP;
    }
    return rows;
  }

  return {
    hint: 'Anchors, routing and most of the label text are derived from the drawing. Only the choice of what to point at is authored.',
    enter() {
      const W = BASE_FRAME[2], H = BASE_FRAME[3];
      setFrame(-14, -46, W + 34, H + 46 + 52);
      clearOverlay();

      for (const side of ['up', 'down']) {
        const up = side === 'up';
        const ty = up ? -30 : H + 26;
        for (const r of layout(side, W)) {
          const ax = r.b.x + r.b.width / 2;
          const ay = up ? r.b.y : r.b.y + r.b.height;
          const stub = up ? ay - 7 : ay + 7;
          overlay.append(
            svgEl('path', {class: 'pt-leader', d:
              `M ${ax} ${ay} L ${ax} ${stub} L ${r.tx - 9} ${ty} L ${r.tx - 2} ${ty}`}),
            svgEl('circle', {class: 'pt-dot', cx: ax, cy: ay, r: 0.9}));

          const t1 = svgEl('text', {class: 'pt-label', x: r.tx, y: ty + LABEL * 0.34});
          t1.textContent = r.label;
          const t2 = svgEl('text', {class: 'pt-label-sub', x: r.tx, y: ty + LABEL * 0.34 + SUB + 1.6});
          t2.textContent = r.sub;
          overlay.append(t1, t2);
          ring(r.path, 'pt-ring-soft', 1.1);
        }
      }

      // A real dimension, off the file's own frame, clear of the labels.
      const dy = H + 44;
      overlay.append(svgEl('path', {class: 'pt-dim',
        d: `M 0 ${dy - 2.5} V ${dy + 2.5} M 0 ${dy} H ${W} M ${W} ${dy - 2.5} V ${dy + 2.5}`}));
      const dt = svgEl('text', {class: 'pt-label-sub', x: W / 2, y: dy - 2.5, 'text-anchor': 'middle'});
      dt.textContent = `${W} × ${H} mm`;
      overlay.append(dt);

      setExports([{label: 'SVG', title: 'Download the annotated figure',
        run: () => saveSvg(svg, `${DEV}.${CONFIG}.${VIEW}.callouts.svg`)}]);
      setPanel(
        title('Callouts'),
        lead('The annotated figure a datasheet or an install guide needs — generated, not drawn. Because the anchors are real geometry, the figure cannot drift from the hardware.'),
        kv([
          ['anchors', 'getBBox()', true],
          ['routing', 'sorted, so leaders cannot cross'],
          ['sub-labels', 'from data-media / speed / lanes / members'],
          ['authored', 'which element, which side'],
        ]),
      );
    },
    exit() { clearOverlay(); resetFrame(); },
  };
})();

// ── Tab: Live state ────────────────────────────────────────────────────
const state = (() => {
  const PORT_LEDS = n => [1, 2, 3, 4].map(i => `port-${n}/led-${i}`);
  const CHASSIS = ['led-loc/lamp', 'led-psu1/lamp', 'led-diag/lamp', 'led-psu2/lamp', 'led-fan/lamp'];
  let note;

  // Speed bands, stated once. Every one of the 32 cages belongs to exactly one
  // band: an earlier version ran 1-12, 13-20 and then 25-32, which left ports
  // 21 to 24 unlit for no reason a reader could work out from the drawing.
  const BANDS = [
    {from: 1,  to: 12, state: 'link-100g', label: '100G'},
    {from: 13, to: 20, state: 'link-40g',  label: '40G'},
    {from: 21, to: 24, state: 'link-10g',  label: '10G'},
    {from: 25, to: 32, state: 'link-25g',  label: '25G'},
  ];
  const PORTS = 32;
  const allPorts = st => { for (let n = 1; n <= PORTS; n++) PORT_LEDS(n).forEach(p => setState(p, st)); };

  const scenarios = {
    healthy() {
      clearStates(); clearOverlay();
      CHASSIS.forEach(p => setState(p, 'on'));
      allPorts('link-100g');
      setState('mgmt-eth/led-left', 'up');
      setState('sfp-leds/lamp-1', 'link-10g');
      return `All ${PORTS} cages up at 100G, management link up, both PSU lamps on.`;
    },
    mixed() {
      clearStates(); clearOverlay();
      CHASSIS.forEach(p => setState(p, 'on'));
      for (const b of BANDS) {
        for (let n = b.from; n <= b.to; n++) PORT_LEDS(n).forEach(p => setState(p, b.state));
      }
      setState('mgmt-eth/led-left', 'up');
      setState('sfp-leds/lamp-1', 'link-10g');
      setState('sfp-leds/lamp-2', 'link-1g');
      return 'Four speeds at once — ' +
        BANDS.map(b => `${b.from}-${b.to} at ${b.label}`).join(', ') +
        '. The colors are the vendor\'s own convention, carried in the compiled stylesheet, not chosen here.';
    },
    fault() {
      clearStates(); clearOverlay();
      CHASSIS.forEach(p => setState(p, 'on'));
      allPorts('link-100g');
      PORT_LEDS(14).forEach(p => setState(p, 'fault'));
      setState('mgmt-eth/led-left', 'up');
      ring('port-14');
      return 'port-14 in fault. Note what did NOT happen: the front PSU lamps declare only off and on, so this drawing cannot show a PSU fault — that fact lives on the rear view. A state the model does not declare is refused rather than faked.';
    },
    off() { clearStates(); clearOverlay(); return 'Everything dark.'; },
  };

  return {
    hint: 'The .state-* stylesheet is compiled into the file. Driving it is a class toggle — no redraw, no image swap.',
    enter() {
      resetFrame();
      note = el('p', {class: 'panel-lead', text: 'Pick a scenario.'});
      setPanel(
        title('Live state'),
        lead('Bind these classes to telemetry and the drawing becomes the dashboard.'),
        controls([
          {label: 'Healthy', run: () => note.textContent = scenarios.healthy()},
          {label: 'Mixed speeds', run: () => note.textContent = scenarios.mixed()},
          {label: 'Fault', run: () => note.textContent = scenarios.fault()},
          {label: 'All off', run: () => note.textContent = scenarios.off()},
        ]),
        note,
        el('div', {class: 'legend'}, [
          el('span', {html: '<i style="background:#3b82f6"></i> 100G'}),
          el('span', {html: '<i style="background:#f97316"></i> 40G'}),
          el('span', {html: '<i style="background:#f5f7fa"></i> 25G'}),
          el('span', {html: '<i style="background:#22c55e"></i> 10G / up'}),
          el('span', {html: '<i style="background:#ef4444"></i> fault'}),
        ]),
      );
      note.textContent = scenarios.mixed();
      setExports([{label: 'SVG', title: 'Download with the current states applied',
        run: () => saveSvg(svg, `${DEV}.${CONFIG}.${VIEW}.state.svg`)}]);
    },
    exit() { clearStates(); clearOverlay(); },
  };
})();

// ── Tab: Select & regions ──────────────────────────────────────────────
const select = (() => {
  let picked = new Set(), listEl, selEl, onClick;

  function paint() {
    clearOverlay();
    picked.forEach(p => ring(p));
    listEl.textContent = picked.size
      ? [...picked].join('\n')
      : 'nothing selected';
    selEl.textContent = picked.size
      ? `[data-path="${[...picked][0]}"]${picked.size > 1 ? `, … (${picked.size} total)` : ''}`
      : '—';
  }
  const pick = paths => { picked = new Set(paths); paint(); };

  return {
    hint: 'Click any element to select it. Selection is a set of data-paths — the same strings a DCIM, a ticket or a query would use.',
    enter() {
      resetFrame();
      listEl = el('pre', {class: 'mono', style: 'margin:0;max-height:150px;overflow:auto;font-size:0.72rem;color:var(--pt-ink-muted)'});
      selEl = el('code', {style: 'font-size:0.72rem;color:var(--pt-brass);overflow-wrap:anywhere'});
      setPanel(
        title('Select & regions'),
        lead('Regions are addressable areas, not just decoration: a region can declare its members and be targeted by a NOS entity-map rule.'),
        controls([
          {label: 'All QSFP28', run: () => pick([...svg.querySelectorAll('[data-group="qsfp28"]')].map(n => n.getAttribute('data-path')))},
          {label: 'Odd ports', run: () => pick(Array.from({length: 16}, (_, i) => `port-${i * 2 + 1}`))},
          {label: 'mgmt-block', run: () => pick(['region:mgmt-block'])},
          {label: 'status-leds', run: () => pick(['region:status-leds'])},
          {label: 'Clear', run: () => pick([])},
        ]),
        el('p', {class: 'panel-title', text: 'selection'}),
        listEl,
        el('p', {class: 'panel-title', text: 'as a selector'}),
        selEl,
      );
      onClick = ev => {
        const t = ev.target.closest?.('[data-path]');
        if (!t || t === svg) return;
        const p = t.getAttribute('data-path');
        picked.has(p) ? picked.delete(p) : picked.add(p);
        paint();
      };
      svg.addEventListener('click', onClick);
      setExports([{label: 'SVG', title: 'Download with the selection marked',
        run: () => saveSvg(svg, `${DEV}.${CONFIG}.${VIEW}.selection.svg`)}]);
      pick(['region:mgmt-block']);
    },
    exit() { svg.removeEventListener('click', onClick); picked.clear(); clearOverlay(); },
  };
})();

// ── Tab: Runbook ───────────────────────────────────────────────────────
const runbook = (() => {
  // An example method of procedure. The prose is authored; every highlight is
  // resolved against the drawing, so a step cannot reference a port that is not
  // on the device.
  const STEPS = [
    {t: 'Confirm chassis health before touching anything — <code>DIAG</code>, <code>PS1</code>, <code>PS2</code>, <code>FAN</code> all lit.',
     paths: ['region:status-leds'], run: () => { ['led-diag/lamp','led-psu1/lamp','led-psu2/lamp','led-fan/lamp'].forEach(p => setState(p, 'on')); }},
    {t: 'Connect to <code>console</code> at 115200 8N1 and confirm you are on the right unit.',
     paths: ['console']},
    {t: 'Shut the existing uplink on <code>port-31</code> and confirm the peer has failed over.',
     paths: ['port-31'], run: () => [1,2,3,4].forEach(i => setState(`port-31/led-${i}`, 'off'))},
    {t: 'Remove the 100G DAC from <code>port-31</code>. Cap the cage.',
     paths: ['port-31']},
    {t: 'Fit the QSFP28-LR4 into <code>port-32</code> and dress the fibre to the left-hand manager.',
     paths: ['port-32']},
    {t: 'Confirm the link comes up at 100G — all four lane lamps on <code>port-32</code>.',
     paths: ['port-32'], run: () => [1,2,3,4].forEach(i => setState(`port-32/led-${i}`, 'link-100g'))},
    {t: 'Verify management is still reachable on <code>mgmt-eth</code> before you close the window.',
     paths: ['mgmt-eth'], run: () => setState('mgmt-eth/led-left', 'up')},
  ];
  let list;

  function go(i) {
    clearOverlay();
    clearStates();
    [...list.children].forEach((li, k) => li.setAttribute('aria-current', k === i ? 'step' : 'false'));
    for (let k = 0; k <= i; k++) STEPS[k].run?.();
    STEPS[i].paths.forEach(p => ring(p));
    list.children[i].scrollIntoView({block: 'nearest'});
  }

  return {
    hint: 'A method of procedure where each step highlights the hardware it names. The steps are an example; the highlighting is real.',
    enter() {
      resetFrame();
      list = el('ol', {class: 'steps'});
      STEPS.forEach((s, i) => {
        const li = el('li', {tabindex: '0'}, [el('span', {html: s.t})]);
        li.onclick = () => go(i);
        li.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(i); } };
        list.append(li);
      });
      setPanel(
        title('Runbook — example MOP'),
        lead('<strong>Migrate the uplink from port-31 to port-32.</strong> Click a step.'),
        list,
      );
      setExports([{label: 'SVG', title: 'Download this step as a figure',
        run: () => saveSvg(svg, `${DEV}.runbook-step.svg`)}]);
      go(0);
    },
    exit() { clearOverlay(); clearStates(); },
  };
})();

// ── Tab: 3D ────────────────────────────────────────────────────────────
const three = (() => {
  let viewer = null, unsub = [], dims = null;

  // Drafting dimensions over the model.
  //
  // Drawn as an SVG layer projected from the scene rather than as geometry in
  // it: screen-space text stays the same size and stays upright however you
  // orbit, and the arrowheads keep their proportions at any zoom. Three.js text
  // would have to be re-scaled every frame and would still shear with the view.
  //
  // Which axis is width, height or depth is not assumed. The scene's bounding
  // box is measured and each axis matched to the chassis dimensions the model
  // declares, so a device whose local axes are ordered differently still labels
  // correctly.
  function dimensions(host, v) {
    const {THREE, scene, camera} = v.three;
    const c = v.info.chassis || {};

    // The box comes from the chassis dimensions the manifest declares, centered
    // on the origin - which is the convention the chassis mesh itself uses
    // (its bounds are exactly ±w/2, ±h/2, ±d/2).
    //
    // Deliberately NOT Box3.setFromObject(scene): some sub-meshes in the
    // compiled model carry position.z = NaN, and a single NaN poisons the union
    // for the whole scene. Falling back to a union of the finite mesh boxes
    // keeps this working for a device that declares no chassis block.
    let box;
    if (c.w && c.h && c.d) {
      box = new THREE.Box3(new THREE.Vector3(-c.w / 2, -c.h / 2, -c.d / 2),
                           new THREE.Vector3(c.w / 2, c.h / 2, c.d / 2));
    } else {
      box = new THREE.Box3();
      scene.traverse(o => {
        if (!o.geometry) return;
        const b = new THREE.Box3().setFromObject(o);
        if (b.isEmpty()) return;
        if (![b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z].every(Number.isFinite)) return;
        box.union(b);
      });
      if (box.isEmpty()) return null;
    }

    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const mm = n => `${(+n).toFixed(1)} mm`;
    const {min, max} = box;
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const EDGES = [
      {a: V(min.x, min.y, max.z), b: V(max.x, min.y, max.z), label: mm(c.w ?? size.x), tag: 'width'},
      {a: V(max.x, min.y, max.z), b: V(max.x, max.y, max.z), label: mm(c.h ?? size.y), tag: 'height'},
      {a: V(max.x, min.y, min.z), b: V(max.x, min.y, max.z), label: mm(c.d ?? size.z), tag: 'depth'},
    ];

    const svg = svgEl('svg', {class: 'dim-layer'});
    host.append(svg);

    const project = (v3, w, h) => {
      const p = v3.clone().project(camera);
      return [(p.x * 0.5 + 0.5) * w, (-p.y * 0.5 + 0.5) * h];
    };
    const finite = a => a.every(Number.isFinite);

    let raf = 0;
    function frame() {
      const r = host.getBoundingClientRect();
      if (!r.width || !r.height) { raf = requestAnimationFrame(frame); return; }
      svg.setAttribute('viewBox', `0 0 ${r.width} ${r.height}`);
      while (svg.firstChild) svg.firstChild.remove();

      const cen = project(center, r.width, r.height);
      const OFF = 42, ARROW = 7;

      if (finite(cen)) for (const e of EDGES) {
        const A = project(e.a, r.width, r.height);
        const B = project(e.b, r.width, r.height);
        if (!finite(A) || !finite(B)) continue;
        let dx = B[0] - A[0], dy = B[1] - A[1];
        const len = Math.hypot(dx, dy);
        if (len < 24) continue;             // edge nearly end-on: no room to label
        dx /= len; dy /= len;
        let px = -dy, py = dx;              // perpendicular, in screen space
        const mid = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
        if ((mid[0] - cen[0]) * px + (mid[1] - cen[1]) * py < 0) { px = -px; py = -py; }

        const A2 = [A[0] + px * OFF, A[1] + py * OFF];
        const B2 = [B[0] + px * OFF, B[1] + py * OFF];

        // Witness lines run a little past the dimension line, as on a drawing.
        svg.append(
          svgEl('path', {class: 'dim-witness',
            d: `M ${A[0] + px * 6} ${A[1] + py * 6} L ${A[0] + px * (OFF + 7)} ${A[1] + py * (OFF + 7)}`}),
          svgEl('path', {class: 'dim-witness',
            d: `M ${B[0] + px * 6} ${B[1] + py * 6} L ${B[0] + px * (OFF + 7)} ${B[1] + py * (OFF + 7)}`}),
          svgEl('path', {class: 'dim-line', d: `M ${A2[0]} ${A2[1]} L ${B2[0]} ${B2[1]}`}));

        const head = (P, sx, sy) => svgEl('path', {class: 'dim-head', d:
          `M ${P[0]} ${P[1]} ` +
          `L ${P[0] + sx * ARROW + px * ARROW * 0.36} ${P[1] + sy * ARROW + py * ARROW * 0.36} ` +
          `L ${P[0] + sx * ARROW - px * ARROW * 0.36} ${P[1] + sy * ARROW - py * ARROW * 0.36} Z`});
        svg.append(head(A2, dx, dy), head(B2, -dx, -dy));

        // Text upright: flip the run direction when it would read right-to-left.
        let ang = Math.atan2(dy, dx) * 180 / Math.PI;
        const ax = (A2[0] + B2[0]) / 2, ay = (A2[1] + B2[1]) / 2 - 6;
        if (ang > 90 || ang < -90) ang += 180;
        const t = svgEl('text', {class: 'dim-text', x: ax, y: ay, 'text-anchor': 'middle',
          transform: `rotate(${ang.toFixed(2)} ${ax} ${ay})`});
        t.textContent = e.label;
        svg.append(t);
      }
      raf = requestAnimationFrame(frame);
    }
    frame();

    return {
      destroy() { cancelAnimationFrame(raf); svg.remove(); },
      toggle(on) { svg.style.display = on ? '' : 'none'; },
    };
  }

  return {
    hint: 'Drag to orbit, wheel to zoom, hover to identify. The dimensions are projected from the model\'s own bounding box and labeled from the millimeters the manifest declares.',
    async enter() {
      const mine = epoch;
      stage2d.hidden = true; stage3d.hidden = false;
      loading.hidden = false;
      loading.textContent = 'Building the 3D model…';
      const readout = el('div');
      setPanel(
        title('3D'),
        lead('Depth and relief come from the model, not from an artist: cavities, walls and vents are declared per element.'),
        readout,
      );
      try {
        const {createViewer} = await import('../vendor/viewer3d.js');
        if (stale(mine)) return;
        viewer = createViewer(stage3d, {dist: DIST, background: 0x0E1013});
        unsub = [viewer.on('hover', (path, info) => {
          readout.replaceChildren(info
            ? kv([['path', path || `(${info.view} face)`, true], ['class', info.cls || '—'],
                  ...(info.model ? [['model', info.model]] : [])])
            : el('p', {class: 'panel-lead', text: 'Hover the model to identify a component.'}));
        })];
        await viewer.load({device: DEV, config: CFG});
        if (stale(mine)) { viewer.dispose(); viewer = null; return; }
        loading.hidden = true;
        dims = dimensions(stage3d, viewer);
        const caps = viewer.capabilities();
        const ch = viewer.info.chassis || {};
        panel.append(
          el('p', {class: 'panel-title', text: 'chassis'}),
          kv([['width', `${ch.w} mm`, true], ['height', `${ch.h} mm`, true], ['depth', `${ch.d} mm`, true]]),
          controls([
            {label: 'Dimensions', toggle: true, run: b => dims?.toggle(b.getAttribute('aria-pressed') === 'true')},
          ]),
          el('p', {class: 'panel-lead', html: `<span class="mono" style="font-size:0.72rem;color:var(--pt-ink-faint)">${caps.text}</span>`}),
        );
        // The dimensions are the point of this tab, so they start on.
        panel.querySelector('.ctl button')?.setAttribute('aria-pressed', 'true');
        setExports([
          {label: 'GLB', run: () => viewer.download('glb')},
          {label: 'USDZ', run: () => viewer.download('usdz')},
        ]);
        readout.replaceChildren(el('p', {class: 'panel-lead', text: 'Hover the model to identify a component.'}));
      } catch (err) {
        if (stale(mine)) return;
        const {webglTrouble} = await import('./webgl.js');
        // A refused context is almost never this page's doing, and saying so
        // saves somebody debugging the wrong thing.
        const why = webglTrouble();
        loading.hidden = false;
        loading.textContent = why || `3D failed to start: ${err.message}`;
        setPanel(title('3D'), lead(why
          ? 'The 2D tabs are unaffected — they need no WebGL.'
          : 'The viewer needs WebGL and the three.js module map. It failed to start here — the 2D tabs are unaffected.'));
      }
    },
    exit() {
      dims?.destroy(); dims = null;
      unsub.forEach(f => f());
      unsub = [];
      // dispose() matters: browsers keep about sixteen WebGL contexts alive and
      // drop the oldest without warning, so a page that toggles 2D/3D must not
      // stack them up. viewer3d.js exists in this shape for exactly this reason.
      viewer?.dispose();
      viewer = null;
      stage3d.hidden = true; stage3d.replaceChildren();
      stage2d.hidden = false;
      loading.hidden = true;
    },
  };
})();

// ── Tab: Rack ──────────────────────────────────────────────────────────
const rack = (() => {
  const RU = 44.45;
  const UNITS = 12;
  const RAIL = 26;
  const INNER = 450.85;

  // ONE stack, two renderers. The 2D elevation and the 3D rack are handed this
  // same array, and a module swapped in either is a swap in both, because both
  // resolve it through swap.js against the same compiled faces. That is the
  // whole argument of this tab: one source, several views - not several sources.
  const STACK = [
    {ref: 'dcp-sc-28p',  cfg: 'default',      ru: 1, label: 'DCP-SC-28P'},
    {ref: 's9510-28dc',  cfg: 'ac',           ru: 2, label: 'S9510-28DC'},
    {ref: 'as5912-54x',  cfg: 'ac-f2b',       ru: 3, label: 'AS5912-54X'},
    {ref: 'as7726-32x',  cfg: 'ac-f2b',       ru: 4, label: 'AS7726-32X'},
    {ref: 'as7946-30xb', cfg: 'ac-psu',       ru: 5, label: 'AS7946-30XB'},
    {ref: 'asr-9001',    cfg: 'asr-9001-s',   ru: 7, label: 'ASR-9001'},
  ];
  // The one device here with bays worth swapping on a showcase page.
  const SWAPPABLE = 'asr-9001';

  let meta = null;        // ref -> {chassis, bays, ...} from the compiled index
  let components = null;  // the component index, for resolving a bay occupant
  let overrides = {};     // bay id -> component ref, for SWAPPABLE
  let mode = '2d';
  let built2d = null, pz = null, rackBase = null;
  let scene3d = null;
  let readout, controlsRow;

  // Through jdist, not fetch: the 3D viewer asks for these same two indexes, and
  // its memo is what stopped components.json coming down repeatedly. A bare
  // fetch here would sit outside that memo and put the duplicate straight back.
  //
  // jdist throws where the old code inspected r.ok, so the tolerance is explicit
  // now: a device whose configs.json is missing drops out of the rack rather
  // than taking the tab down with it.
  async function loadMeta() {
    if (meta) return;
    meta = {};
    const {jdist} = await import('../vendor/dist.js');
    for (const e of STACK) {
      try { meta[e.ref] = await jdist(`${DIST}${e.ref}.configs.json`); }
      catch (err) { console.warn('[portrayal] no config index for', e.ref, err); }
    }
    try { components = (await jdist(`${DIST}components.json`)).components; }
    catch (err) { console.warn('[portrayal] no component index', err); components = []; }
  }

  const entryOf = ref => STACK.find(e => e.ref === ref);
  const baysOf = ref => (meta?.[ref]?.bays) || {};
  const chassisOf = ref => meta?.[ref]?.chassis || {};

  // Resolve "cisco/a9k-mpa-4x10ge@1" to its compiled standalone skin.
  const byRef = ref => (components || []).find(
    c => `${c.ns}/${c.name}@${c.major.slice(1)}` === ref.split(':')[0]);
  async function loadSkin(ref) {
    const c = byRef(ref);
    if (!c) return null;
    const skin = c.skins?.includes('default') ? 'default' : c.skins?.[0];
    const url = `${DIST}components/${c.ns}--${c.name}--${c.major}--${skin}.svg`;
    const r = await fetch(url);
    if (!r.ok) return null;
    return {comp: c, text: await r.text()};
  }
  const shortRef = ref => (ref || '(empty)').split('/').pop().replace(/@\d+$/, '');

  // ── 2D elevation ───────────────────────────────────────────────────────
  async function build2d() {
    const totalH = UNITS * RU;
    const out = svgEl('svg', {xmlns: 'http://www.w3.org/2000/svg',
      viewBox: `${-RAIL - 6} -18 ${INNER + RAIL * 2 + 12} ${totalH + 30}`});

    for (const x of [-RAIL, INNER]) {
      out.append(svgEl('rect', {x, y: 0, width: RAIL, height: totalH,
        fill: 'var(--pt-surface-2)', stroke: 'var(--pt-line)', 'stroke-width': 1}));
    }
    for (let u = 0; u < UNITS; u++) {
      const yTop = totalH - (u + 1) * RU;
      for (const x of [-RAIL, INNER]) {
        out.append(svgEl('line', {x1: x, y1: yTop, x2: x + RAIL, y2: yTop,
          stroke: 'var(--pt-line)', 'stroke-width': 0.8}));
        for (const f of [0.22, 0.5, 0.78]) {
          out.append(svgEl('rect', {x: x + RAIL * 0.72, y: yTop + RU * f - 2.6,
            width: 4.2, height: 5.2, rx: 0.8, fill: 'var(--pt-ground)',
            stroke: 'var(--pt-line)', 'stroke-width': 0.5}));
        }
        const t = svgEl('text', {x: x + RAIL * 0.34, y: yTop + RU / 2 + 4,
          'text-anchor': 'middle', 'font-family': 'IBM Plex Mono, monospace',
          'font-size': 11, 'font-weight': 500, fill: 'var(--pt-ink-muted)'});
        t.textContent = String(u + 1);
        out.append(t);
      }
    }

    let styled = false;
    for (const e of STACK) {
      const url = `${DIST}${e.ref}.${e.cfg}.front.svg`;
      const text = await fetch(url).then(r => r.ok ? r.text() : null);
      if (!text) continue;
      const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
      const root = doc.documentElement;
      const w = parseFloat(root.getAttribute('width'));
      const h = parseFloat(root.getAttribute('height'));
      const ruH = Math.max(1, Math.round(h / RU));
      const y = totalH - (e.ru - 1 + ruH) * RU + (ruH * RU - h) / 2;

      const g = svgEl('g', {transform: `translate(${(INNER - w) / 2} ${y})`,
                            'data-device-name': e.label, 'data-device-ref': e.ref});
      // Ids are NOT rewritten per device. The compiled drawings carry no <defs>,
      // no url(#...) and no href="#...", so there is nothing to collide - and
      // renaming them would break swap.js, which finds a seated module by the
      // canonical id the compiler gave it.
      for (const kid of [...root.childNodes]) {
        if (kid.nodeName === 'style') { if (styled) continue; styled = true; }
        g.append(document.importNode(kid, true));
      }
      out.append(g);
      if (e.ref === SWAPPABLE && Object.keys(overrides).length) {
        await applyOverridesTo(g, e.ref);
      }
    }
    rackBase = out.getAttribute('viewBox').split(/\s+/).map(Number);
    return out;
  }

  async function applyOverridesTo(deviceGroup, ref) {
    const bays = baysOf(ref).front || [];
    const {applyOverrides} = await import('../vendor/swap.js');
    await applyOverrides(deviceGroup, bays, overrides, loadSkin);
  }

  // ── swap controls ──────────────────────────────────────────────────────
  function swapControls() {
    const wrap = el('div', {style: 'display:flex;flex-direction:column;gap:0.55rem'});
    const bays = (baysOf(SWAPPABLE).front || []).filter(b => (b.accepts || []).length > 1);
    for (const bay of bays) {
      const row = el('div', {style: 'display:flex;flex-direction:column;gap:0.2rem'});
      const sel = el('select', {class: 'bay-select'});
      for (const ref of bay.accepts) {
        const o = el('option', {value: ref, text: shortRef(ref)});
        sel.append(o);
      }
      sel.value = overrides[bay.id] || bay.default || bay.accepts[0];
      sel.onchange = async () => {
        overrides[bay.id] = sel.value;
        await refresh();
      };
      row.append(el('label', {class: 'panel-title', text: bay.id}), sel);
      wrap.append(row);
    }
    return wrap;
  }

  async function refresh() {
    if (mode === '2d') {
      built2d = null;
      loading.hidden = false; loading.textContent = 'Recomposing the elevation…';
      const mine = epoch;
      const svgOut = await build2d();
      if (stale(mine)) return;
      loading.hidden = true;
      built2d = svgOut;
      stageRack.replaceChildren(svgOut);
      pz = panZoom(svgOut, () => rackBase);
      setExports([{label: 'SVG', title: 'Download the elevation as drawn',
        run: () => saveSvg(svgOut, 'rack-elevation.svg')}]);
    } else if (scene3d) {
      loading.hidden = false; loading.textContent = 'Rebuilding the rack…';
      const mine = epoch;
      // Through the scene's own API: it holds a copy of the stack, so mutating
      // the STACK constant here would change nothing on screen.
      scene3d.setOverrides(SWAPPABLE, overrides);
      await scene3d.build();
      if (stale(mine)) return;
      loading.hidden = true;
    }
  }

  async function to3d() {
    mode = '3d';
    stageRack.hidden = true; stage3d.hidden = false;
    loading.hidden = false; loading.textContent = 'Building the rack in 3D…';
    const mine = epoch;
    // WITHOUT THIS THE SCRIM NEVER COMES DOWN. three.js throws when it cannot
    // get a context, the exception escaped this handler, and the tab sat on
    // "Building the rack in 3D…" forever - which reads as a slow build rather
    // than a browser that has graphics acceleration switched off.
    const {guard3d} = await import('./webgl.js');
    const built = await guard3d(async () => {
      const {createRackScene} = await import('./rack3d.js');
      if (stale(mine)) return null;
      const stack = STACK.map(e => ({...e, chassis: chassisOf(e.ref), bays: baysOf(e.ref),
        componentIndex: components,
        overrides: e.ref === SWAPPABLE ? {...overrides} : null}));
      const sc = createRackScene(stage3d, {dist: DIST, stack, heightRU: UNITS,
                                           background: 0x0E1013});
      await sc.build();
      return sc;
    }, msg => {
      if (stale(mine)) return;
      loading.hidden = false;
      loading.textContent = msg;
    });
    if (!built) return;
    scene3d = built;
    if (stale(mine)) { scene3d.dispose(); scene3d = null; return; }
    loading.hidden = true;
    setExports([
      {label: 'GLB', run: async () => { const b = await scene3d.toGLB(); save(b, 'rack.glb', 'model/gltf-binary'); }},
      {label: 'USDZ', run: async () => { const b = await scene3d.toUSDZ(); save(b, 'rack.usdz', 'model/vnd.usdz+zip'); }},
    ]);
  }



  function to2d() {
    mode = '2d';
    scene3d?.dispose(); scene3d = null;
    stage3d.hidden = true; stageRack.hidden = false;
  }

  return {
    hint: 'One stack, two renderers. Swap a module on the ASR-9001 and it changes in both, because both resolve it against the same compiled faces.',
    async enter() {
      const mine = epoch;
      stage2d.hidden = true; stageRack.hidden = false;
      loading.hidden = false; loading.textContent = 'Composing the elevation…';
      readout = el('p', {class: 'panel-lead', text: 'Hover a device.'});
      await loadMeta();
      if (stale(mine)) return;

      controlsRow = controls([
        {label: '2D', run: async (b, row) => {
          if (mode === '2d') return;
          to2d(); mark(row); await refresh();
        }},
        {label: '3D', run: async (b, row) => {
          if (mode === '3d') return;
          mark(row, 1); await to3d();
        }},
      ]);
      const mark = (row, i = 0) => [...row.children].forEach((b, k) => b.setAttribute('aria-pressed', String(k === i)));
      mark(controlsRow, mode === '2d' ? 0 : 1);

      setPanel(
        title('Rack'),
        lead('Every drawing is authored at true size, so an elevation is composition rather than illustration — and the same stack can be handed to a 3D renderer without restating anything.'),
        controlsRow,
        el('p', {class: 'panel-title', text: 'ASR-9001 modules'}),
        swapControls(),
        el('p', {class: 'panel-lead', html: 'Each bay offers only what it <em>accepts</em> — that list is in the device manifest, not in this page.'}),
        readout,
      );

      if (mode === '3d') { await to3d(); return; }
      await refresh();
      stageRack.onpointermove = ev => {
        const g = ev.target.closest?.('[data-device-name]');
        const t = ev.target.closest?.('[data-path]');
        readout.replaceChildren(g
          ? kv([['device', g.getAttribute('data-device-name'), true],
                ['path', t ? t.getAttribute('data-path') : '—']])
          : el('p', {class: 'panel-lead', text: 'Hover a device.'}));
      };
    },
    exit() {
      stageRack.onpointermove = null;
      stageRack.hidden = true;
      scene3d?.dispose(); scene3d = null;
      stage3d.hidden = true; stage3d.replaceChildren();
      stage2d.hidden = false;
      mode = '2d';
    },
  };
})();

// ── Wiring ─────────────────────────────────────────────────────────────
const TABS = {inspect, callouts, state, select, runbook, three, rack};
let current = null;
// Bumped on every switch. An enter() that awaits - 3D and Rack both do - checks
// it after each await and gives up if the stage has moved on, so a slow build
// cannot paint over the tab that replaced it.
let epoch = 0;
const stale = mine => mine !== epoch;

// Callouts, state, select and runbook all name elements that exist on the front
// face of the default configuration. Entering one from a rear or DC view would
// silently resolve nothing, so reset the drawing first.
const NEEDS_DEFAULT = new Set(['callouts', 'state', 'select', 'runbook']);

async function activate(name) {
  if (current === name) return;
  epoch++;
  if (current) await TABS[current].exit?.();
  loading.hidden = true;
  exportSlot.replaceChildren();
  if (NEEDS_DEFAULT.has(name) && (VIEW !== 'front' || CONFIG !== CFG)) {
    VIEW = 'front';
    CONFIG = CFG;
    await loadDrawing();
  }
  current = name;
  document.querySelectorAll('.show-tabs button').forEach(b =>
    b.setAttribute('aria-selected', String(b.dataset.tab === name)));
  hint.textContent = TABS[name].hint || '';
  srcLine.textContent = name === 'rack'
    ? '6 devices · true mm scale'
    : `${DEV}.${CONFIG}.${VIEW}.svg`;
  await TABS[name].enter();
}

(async () => {
  try {
    await loadDrawing();
  } catch (err) {
    loading.textContent = `Could not load ${src()} — ${err.message}. This page must be served over HTTP, not opened from disk.`;
    return;
  }
  document.querySelectorAll('.show-tabs button').forEach(b => {
    b.onclick = () => activate(b.dataset.tab);
  });
  await activate('inspect');
})();
