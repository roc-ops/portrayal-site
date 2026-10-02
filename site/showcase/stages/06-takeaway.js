// Stage 6 - Take it away. "Where can it go from here?"
//
// The cast rack as built - the same overrides stages 1-3 produced, plus the
// seats stage 4's patching plan filled in (the line card, optics and plugs
// its cables land on; plan.js's applyPlanSeats writes them into the same
// overrides) - handed over in the formats a network team uses next. Every exporter already
// exists elsewhere on this site; this stage only wires them to the rack that
// got built here (R6). No new export code.
//
// Stage 6 is stage 4's cabled rack (enterPatched, patch-view.js) under its
// own panel: it applies the plan's seats itself, so a visitor who jumps
// straight here still sees the rack cabled, and its SVG, PNG and 3D exports
// carry the cables (patch-view.js's cableFace/cabledElevationSvg; the tags
// and hover/focus state stay screen UI and never reach a file).
//
//   draw.io   - a rack diagram through drawio.js's rackDiagram, fed each
//               device's configured face (site/rack/face.js) on front and
//               rear, so the cards, optics and plugs seated here are in it
//               and their ports are connection points.
//   GLB/USDZ  - the mounted scene's own exporters, offered only when a scene
//               exists (R11). In 2D there is no scene to export, so the two
//               become one button that switches to 3D (the rail's setMode)
//               rather than pretending to export something not built. Both
//               await scene.complete() first, so the deferred relief pass
//               that extrudes optics and plugs has landed before the export
//               is built.
//   SVG       - cabledElevationSvg: a freshly built, cabled elevation of the
//               face shown, standing alone from the one on screen so a
//               visitor's pan/zoom or hover never reaches the file.
//   PNG       - raster.js's rasterize, which only takes a URL: the SVG built
//               above is not one, so it is turned into an object URL first
//               and the URL is revoked once the raster is done.
//   DCIM      - links built straight off assets/exports/index.json, never a
//               hand-typed filename; a device missing from the index gets no
//               links rather than a guessed one.
//
// The picture follows the switch (ui.mode): in 2D this stage shows the same
// elevation it exports, in 3D the mounted scene. Clicking a device on the
// drawing itself does nothing here - but enterPatched's "Look closer" strip,
// shared with stages 4 and 5, still opens any cast device's own lenses.

import {stage3d, stageRack, el, title, lead, kv, save} from '../artifact.js';
import {CAST, RACK_U, overrides} from '../rack.js';
import {enterPatched, cabledElevationSvg} from '../patch-view.js';
import {rackDiagram} from '../../../vendor/drawio.js';
import {configuredFace} from '../../rack/face.js';
import {rasterize} from '../../raster.js';
// A circular import (the rail imports this stage); setMode is only read inside
// a click handler, never while the modules are being evaluated. Stages may use
// the rail's functions - never its `epoch`.
import {setMode} from '../stage-rail.js';

const EXPORTS_BASE = 'assets/exports/';

// Every YAML the index lists for the cast, as real links - never a filename
// this page invents. A device the index does not know about says so instead
// of silently having no links.
function dcimSection(index) {
  const wrap = el('div', {class: 'dcim'});
  for (const e of CAST) {
    wrap.append(el('p', {class: 'panel-lead', html: `<strong>${e.label}</strong>`}));
    const entry = index?.[e.ref];
    if (!entry) {
      wrap.append(el('p', {class: 'panel-lead', text: 'not in the export index'}));
      continue;
    }
    const ul = el('ul', {class: 'dcim-links'});
    for (const kind of ['netbox', 'nautobot']) {
      for (const path of entry[kind] || []) {
        const href = EXPORTS_BASE + path.split('/').map(encodeURIComponent).join('/');
        ul.append(el('li', {}, [el('a', {href, target: '_blank', rel: 'noopener',
          text: `${kind} — ${path.split('/').pop()}`})]));
      }
    }
    wrap.append(ul);
  }
  return wrap;
}

// The cast AS BUILT, both sides: each device's configured face - the cards,
// optics and plugs stages 2-4 seated - so the diagram's port cells include
// the ports on those cards. A side a device was never drawn for is left
// out, and rackDiagram says "no rear drawing" there rather than borrowing
// the other side.
async function buildDrawio() {
  const mounted = [];
  for (const e of CAST) {
    if (e.ru == null) continue;   // dropped from the rack - no compiled index
    const faces = {};
    for (const view of ['front', 'rear']) {
      const f = await configuredFace({ref: e.ref, cfg: e.cfg, view,
                                      swaps: overrides[e.ref] || {},
                                      turned: !!e.turned}).catch(() => null);
      if (f) faces[view] = {svg: f.text, vb: f.vb, ports: f.ports};
    }
    if (!faces.front && !faces.rear) continue;
    // TWO NUMBERINGS. The cast counts U from 1 at the BOTTOM (e.ru is the
    // device's bottom U, as rack3d and the elevation read it); rackDiagram
    // counts from 1 at the TOP (numDisp=ascend, as drawio-page.js packs
    // it), and its `u` is where the device's top edge sits. So the device's
    // top U, e.ru + e.u - 1, is flipped: top U 22 of 22 is draw.io's u 1.
    // Passed as-is, the 10U ASR-9006 at the bottom drew at the top.
    mounted.push({name: e.label, u: RACK_U - (e.ru + e.u - 1) + 1, ru: e.u, faces});
  }
  const groups = [{label: 'Cast rack', racks: [{label: '', units: RACK_U, mounted}]}];
  save(rackDiagram(groups, {faces: ['front', 'rear'], labels: true}),
       'cast-rack.drawio', 'application/xml');
}

export default function makeTakeaway() {
  let handle = null;

  // The face the visitor is looking at in 2D; the front in 3D, which has none.
  const face = () => (handle?.mode === '2d' && handle.view) || 'front';

  // `h`/`v` are captured once, at the start of the export: a stage the
  // visitor has already left (handle gone, exit() nulled it) downloads
  // nothing rather than throwing on a stale handle.
  async function buildSvg() {
    const h = handle, v = face();
    if (!h) return;
    save(await cabledElevationSvg(h, v), `cast-rack-${v}.svg`, 'image/svg+xml');
  }

  // rasterize() only takes a URL, so the cabled SVG goes through a blob URL.
  async function buildPng() {
    const h = handle, v = face();
    if (!h) return;
    const text = await cabledElevationSvg(h, v);
    const url = URL.createObjectURL(new Blob([text], {type: 'image/svg+xml'}));
    try {
      const bytes = await rasterize(url, 2);
      if (!bytes) throw new Error('could not rasterize the elevation');
      save(bytes, `cast-rack-${v}.png`, 'image/png');
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  return {
    title: 'Take it away',
    question: 'Where can it go from here?',
    async enter(ui) {
      let exportsIndex = null;
      try {
        exportsIndex = await fetch(`${EXPORTS_BASE}index.json`).then(r => r.ok ? r.json() : null);
      } catch (err) {
        console.warn('[portrayal] no export index', err);
      }
      if (!ui.live()) return;
      const is3d = ui.mode === '3d';
      // Stage 4's cabled rack - the plan's seats applied here too, so a
      // visitor who jumps straight to this stage still sees it cabled - under
      // this stage's own panel. The plan list stays: a row still lights its
      // cable.
      const h = await enterPatched(ui, {
        counts: false,
        head: [
          title('Take it away'),
          lead('<strong>Where can it go from here?</strong>'),
          lead('The cast rack as built and cabled here, handed over in the formats a network team uses next.'),
        ],
        // Built from the handle enterPatched hands back, after enter2d/enter3d
        // have run - so the GLB/USDZ row can tell "no 3D in this browser"
        // (R11: is3d but hh.scene never mounted) apart from "a scene is ready".
        top: hh => [kv([
          ['draw.io', 'rack diagram, front and rear, with the seated cards and optics and a connection point on every port'],
          ['GLB / USDZ', !is3d ? 'the 3D model with its cables - switch to 3D to build the scene they export'
                        : hh.scene ? 'the mounted, cabled rack as a 3D model'
                                   : 'unavailable - no 3D in this browser'],
          ['SVG', 'the face shown, with its cards, optics and cables'],
          ['PNG', 'a raster of that same face'],
          ['DCIM', 'NetBox and Nautobot device-type YAMLs for each cast device, linked below'],
        ])],
        extraPanel: () => [lead('<strong>DCIM device types</strong>'), dcimSection(exportsIndex)],
      });
      if (!ui.live()) { h?.dispose(); return; }
      handle = h;

      const items = [
        {label: 'draw.io',
         title: 'Download a draw.io rack diagram - front and rear, as built, with a connection point on every port',
         run: buildDrawio},
        {label: 'SVG', title: 'Download the face shown as an SVG, with its cards, optics and cables',
         run: buildSvg},
        {label: 'PNG', title: 'Download a PNG raster of the face shown, with its cables',
         run: buildPng},
      ];
      if (!is3d) {
        items.push({label: '3D formats (GLB, USDZ) — switch to 3D',
          title: 'GLB and USDZ export the 3D scene, which 2D does not build - this switches to 3D',
          run: () => setMode('3d')});
      } else if (handle.scene) {
        const sc = handle.scene;
        // The plan list's row highlight (patch-view.js's enter3d) dims every
        // other tube to opacity 0.15 for the screen; cleared first, or an
        // export taken mid-highlight ships 13 ghosted cables. highlight(null)
        // is the same call a cleared plan-row selection makes.
        // complete() first: optics and plugs are extruded by the deferred
        // relief pass, and an export taken before it lands has them flat.
        items.push({label: 'GLB', title: 'Download the mounted, cabled rack as a GLB',
          run: async () => { handle.highlight?.(null); await sc.complete();
                             save(await sc.toGLB(), 'cast-rack.glb', 'model/gltf-binary'); }});
        items.push({label: 'USDZ', title: 'Download the mounted, cabled rack as a USDZ',
          run: async () => { handle.highlight?.(null); await sc.complete();
                             save(await sc.toUSDZ(), 'cast-rack.usdz', 'model/vnd.usdz+zip'); }});
      }
      ui.setExports(items);
    },
    exit() {
      handle?.dispose(); handle = null;
      stage3d.hidden = true; stage3d.replaceChildren();
      // The 2D picture. #stageTabs is the rail's to empty (vacate), not this.
      stageRack.hidden = true; stageRack.replaceChildren();
    },
  };
}
