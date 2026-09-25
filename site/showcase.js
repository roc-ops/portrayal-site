// portrayal.dev — the showcase.
//
// One compiled artifact, six lenses. Every tab drives the *same* inlined SVG
// (except 3D and Rack, which mount their own stage), because that is the claim
// the page is making: the drawing is addressable, so you do not need a
// different picture for a different job.
//
// Nothing here fabricates data. Labels, states and component references are
// read off the compiled SVG's own attributes, and a state is only ever applied
// to an element that declares it in data-states.

import {
  svg, VIEW, CONFIG, DEV, CFG, DIST,
  stage2d, stage3d, stageRack, loading, panel, hint, srcLine, exportSlot,
  el, svgEl, loadDrawing, setDrawing, box,
  panZoom,
  setExports, save, saveSvg, standalone,
  title, lead, kv, controls, setPanel,
  setHost,
} from './showcase/artifact.js';
import makeInspect  from './showcase/spokes/inspect.js';
import makeCallouts from './showcase/spokes/callouts.js';
import makeState    from './showcase/spokes/state.js';
import makeSelect   from './showcase/spokes/select.js';

const inspect  = makeInspect({dev: DEV, cfg: CFG});
const callouts = makeCallouts({dev: DEV, cfg: CFG});
const state    = makeState({dev: DEV, cfg: CFG});
const select   = makeSelect({dev: DEV, cfg: CFG});

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
const TABS = {inspect, callouts, state, select, three, rack};
let current = null;
// Bumped on every switch. An enter() that awaits - 3D and Rack both do - checks
// it after each await and gives up if the stage has moved on, so a slow build
// cannot paint over the tab that replaced it.
let epoch = 0;
const stale = mine => mine !== epoch;

// Callouts, state and select all name elements that exist on the front
// face of the default configuration. Entering one from a rear or DC view would
// silently resolve nothing, so reset the drawing first.
const NEEDS_DEFAULT = new Set(['callouts', 'state', 'select']);

async function activate(name) {
  if (current === name) return;
  epoch++;
  if (current) await TABS[current].exit?.();
  loading.hidden = true;
  exportSlot.replaceChildren();
  if (NEEDS_DEFAULT.has(name) && (VIEW !== 'front' || CONFIG !== CFG)) {
    setHost(null);
    await setDrawing('front', CFG);
  }
  setHost(TABS[name]);
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
    loading.textContent = `Could not load ${DIST}${DEV}.${CONFIG}.${VIEW}.svg — ${err.message}. This page must be served over HTTP, not opened from disk.`;
    return;
  }
  document.querySelectorAll('.show-tabs button').forEach(b => {
    b.onclick = () => activate(b.dataset.tab);
  });
  await activate('inspect');
})();
