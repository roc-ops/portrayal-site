// Stage 6 - Take it away. "Where can it go from here?"
//
// The cast rack as built - the same overrides stages 1-3 produced - handed
// over in the formats a network team uses next. Every exporter already
// exists elsewhere on this site; this stage only wires them to the rack that
// got built here (R6). No new export code.
//
//   draw.io   - a rack diagram through drawio.js's rackDiagram, fed the
//               compiled FRONT face straight off disk, the way drawio-page.js
//               feeds it. That face is the base configuration, not the
//               overridden one - rackDiagram never runs applyOverrides, only
//               build2dElevation does - so the button's title says so rather
//               than implying it shows the seated cards and optics.
//   GLB/USDZ  - the mounted scene's own exporters, offered only when a scene
//               exists (R11).
//   SVG       - build2dElevation with the current overrides, which DOES
//               apply them - it is the same call stage 0's rails export
//               already uses, and it seats each front face through swap.js's
//               face-level pass, so stage 2's cards AND stage 3's optics are
//               in the file (R26).
//   PNG       - raster.js's rasterize, which only takes a URL: the SVG built
//               above is not one, so it is turned into an object URL first
//               and the URL is revoked once the raster is done.
//   DCIM      - links built straight off assets/exports/index.json, never a
//               hand-typed filename; a device missing from the index gets no
//               links rather than a guessed one.

import {stage3d, stageRack, el, title, lead, kv, save, saveSvg, standalone, DIST}
  from '../artifact.js';
import {CAST, RACK_U, loadMeta, chassisOf, overrides, mount3d, build2dElevation}
  from '../rack.js';
import {rackDiagram, loadFace, portsOf} from '../../drawio.js';
import {rasterize} from '../../raster.js';

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

export default function makeTakeaway() {
  let scene = null;
  let elevationSvg = null;

  // The cast's front faces, straight off disk - the base configuration
  // drawio-page.js itself draws from, not the overridden one.
  async function buildDrawio() {
    const mounted = [];
    for (const e of CAST) {
      if (e.ru == null) continue;   // dropped from the rack - no compiled index
      const face = await loadFace(`${DIST}${e.ref}.${e.cfg}.front.svg`).catch(() => null);
      if (!face) continue;
      // TWO NUMBERINGS. The cast counts U from 1 at the BOTTOM (e.ru is the
      // device's bottom U, as rack3d and the elevation read it); rackDiagram
      // counts from 1 at the TOP (numDisp=ascend, as drawio-page.js packs
      // it), and its `u` is where the device's top edge sits. So the device's
      // top U, e.ru + e.u - 1, is flipped: top U 22 of 22 is draw.io's u 1.
      // Passed as-is, the 10U ASR-9006 at the bottom drew at the top.
      mounted.push({name: e.label, u: RACK_U - (e.ru + e.u - 1) + 1, ru: e.u,
        faces: {front: {svg: face.text, vb: face.vb, ports: portsOf(face.zones)}}});
    }
    const groups = [{label: 'Cast rack', racks: [{label: '', units: RACK_U, mounted}]}];
    save(rackDiagram(groups, {faces: ['front'], labels: true}),
         'cast-rack.drawio', 'application/xml');
  }

  // rasterize() only takes a URL; the elevation built here is not one, so a
  // blob URL stands in for it and is revoked once the raster is done.
  async function buildPng() {
    const text = standalone(elevationSvg);
    const url = URL.createObjectURL(new Blob([text], {type: 'image/svg+xml'}));
    try {
      const bytes = await rasterize(url, 2);
      if (!bytes) throw new Error('could not rasterize the elevation');
      save(bytes, 'cast-rack-elevation.png', 'image/png');
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  return {
    title: 'Take it away',
    question: 'Where can it go from here?',
    // `ui` is the rail's lease on this entry (stage-rail.js): every panel,
    // export and scrim write goes through it and is a no-op once stale.
    async enter(ui) {
      // The same mount stage 1 does (R6): the cast, with whatever overrides
      // the visitor already made, so the downloads reflect their choices.
      stageRack.hidden = true; stage3d.hidden = false;
      ui.scrim('Mounting the cast…');
      await loadMeta();
      if (!ui.live()) return;

      const stack = CAST.map(e => ({...e, chassis: chassisOf(e.ref)}));
      scene = await mount3d({stack, heightRU: RACK_U, overrides});
      if (!ui.live()) { scene?.dispose(); scene = null; return; }
      // Only when a scene actually mounted - R11: the panel and every
      // non-3D format are built either way.
      if (scene) ui.unscrim();

      // Built for the SVG/PNG exports, not for display - the 3D scene is
      // what this stage shows. Kept attached (hidden) to stageRack purely so
      // standalone() has a document to resolve --pt-* custom properties
      // against.
      elevationSvg = await build2dElevation({stack, heightRU: RACK_U, overrides});
      if (!ui.live()) { scene?.dispose(); scene = null; return; }
      stageRack.replaceChildren(elevationSvg);

      let exportsIndex = null;
      try {
        exportsIndex = await fetch(`${EXPORTS_BASE}index.json`).then(r => r.ok ? r.json() : null);
      } catch (err) {
        console.warn('[portrayal] no export index', err);
      }
      if (!ui.live()) { scene?.dispose(); scene = null; return; }

      ui.setPanel(
        title('Take it away'),
        lead('<strong>Where can it go from here?</strong>'),
        lead('The cast rack as built here, handed over in the formats a network team uses next.'),
        kv([
          ['draw.io', 'rack diagram, base front configuration - does not reflect seated cards or optics'],
          ['GLB / USDZ', scene ? 'the mounted rack, as configured, as a 3D model'
                                : 'unavailable - no 3D in this browser'],
          ['SVG', '2D front elevation, with the seated cards and optics'],
          ['PNG', 'a raster of that same elevation'],
          ['DCIM', 'NetBox and Nautobot device-type YAMLs for each cast device, linked below'],
        ]),
        lead('<strong>DCIM device types</strong>'),
        dcimSection(exportsIndex),
      );

      const items = [
        {label: 'draw.io',
         title: 'Download a draw.io rack diagram - base front configuration only; does not show seated cards or optics',
         run: buildDrawio},
        {label: 'SVG',
         title: 'Download the 2D front elevation, with the seated cards and optics',
         run: () => saveSvg(elevationSvg, 'cast-rack-elevation.svg')},
        {label: 'PNG',
         title: 'Download a PNG raster of the front elevation, with the seated cards and optics',
         run: buildPng},
      ];
      if (scene) {
        items.push({label: 'GLB', title: 'Download the mounted rack as a GLB, with the current overrides',
          run: async () => save(await scene.toGLB(), 'cast-rack.glb', 'model/gltf-binary')});
        items.push({label: 'USDZ', title: 'Download the mounted rack as a USDZ, with the current overrides',
          run: async () => save(await scene.toUSDZ(), 'cast-rack.usdz', 'model/vnd.usdz+zip')});
      }
      ui.setExports(items);
    },
    exit() {
      scene?.dispose();
      scene = null;
      elevationSvg = null;
      stage3d.hidden = true;
      stage3d.replaceChildren();
      stageRack.hidden = true;
      stageRack.replaceChildren();
    },
  };
}
