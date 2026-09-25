// Stage 1 - Mount. "Will it fit?"
//
// The cast mounted into the rails stage 0 drew: in 2D, the compiled front
// faces on those rails; in 3D, the same stack in the rack scene. The panel's
// answer is computed from the chassis dimensions in each device manifest, so
// whether it fits is arithmetic rather than judgement - and the panel is the
// same in both views and built whether or not 3D mounted, because R11: the
// panel never depends on 3D. mount3d returns null when WebGL is unavailable,
// after guard3d has already put its message on the loading scrim; the drawing
// is the picture, the panel is the answer.

import {stage3d, stageRack, title, lead, kv, save, saveSvg, panZoom} from '../artifact.js';
import {CAST, RACK_U, loadMeta, chassisOf, unitsOf, overrides, mount3d, build2dElevation}
  from '../rack.js';
import {wireDevices} from '../spoke-host.js';

export default function makeMount() {
  let scene = null;
  return {
    title: 'Mount',
    question: 'Will it fit?',
    // `ui` is the rail's lease on this entry (stage-rail.js): every panel,
    // export and scrim write goes through it and is a no-op once stale.
    async enter(ui) {
      const is3d = ui.mode === '3d';
      stageRack.hidden = is3d; stage3d.hidden = !is3d;
      ui.scrim('Mounting the cast…');
      await loadMeta();
      if (!ui.live()) return;

      // Height per device comes from the chassis (unitsOf), not from CAST's
      // own `ru` - that field is a *position*, the chassis' is a *height*.
      // Conflating them is how a rack silently overlaps.
      const stack = CAST.map(e => ({...e, chassis: chassisOf(e.ref)}));
      const rows = stack.map(e => {
        const u = unitsOf(e.ref);
        return {label: e.label, ru: e.ru, u, top: e.ru + u - 1};
      });
      const used = rows.reduce((n, r) => n + r.u, 0);
      const free = RACK_U - used;

      let exports = [];
      if (is3d) {
        // Held locally until this entry is known to be live: an entry
        // overtaken mid-build must not write its null over a newer entry's
        // scene, or that scene would never be disposed.
        const sc = await mount3d({stack, heightRU: RACK_U, overrides});
        if (!ui.live()) { sc?.dispose(); return; }
        scene = sc;
        // Only when a scene actually mounted: on the no-WebGL path mount3d
        // returns null and deliberately leaves guard3d's message on the scrim,
        // so hiding it unconditionally would show an empty 3D pane with no
        // explanation. The panel below is built either way - R11.
        if (scene) {
          ui.unscrim();
          exports = [{label: 'GLB', title: 'Download the mounted rack as a GLB',
            run: async () => save(await sc.toGLB(), 'rack.glb', 'model/gltf-binary')}];
        }
      } else {
        // The cast on stage 0's rails: only the devices whose index loaded,
        // so a missing one is a gap rather than a device at an unknown height.
        const svg = await build2dElevation({stack: CAST.filter(e => e.ru != null),
                                            heightRU: RACK_U, overrides});
        if (!ui.live()) return;
        stage3d.hidden = true;
        stageRack.hidden = false;
        stageRack.replaceChildren(svg);
        const base = svg.getAttribute('viewBox').split(/\s+/).map(Number);
        panZoom(svg, () => base);
        // Each device on it opens its Inspect lens (spoke-host.js).
        wireDevices(svg, 'mount', ui);
        ui.unscrim();
        exports = [{label: 'SVG', title: 'Download the mounted rack as drawn',
          run: () => saveSvg(svg, 'rack-mounted.svg')}];
      }

      ui.setPanel(
        title('Stage 1 · Mount'),
        lead('<strong>Will it fit?</strong>'),
        lead('The chassis dimensions are in each device manifest, so whether it fits is arithmetic rather than judgement.'),
        kv([
          ['rack', `${RACK_U} U`, true],
          ['occupied', `${used} U`, true],
          ['free', `${free} U`],
          ...rows.map(r => [r.label, `U${r.ru}–${r.top} (${r.u} U)`]),
        ]),
      );
      // "Look closer" lives under the stage, not at the foot of this panel.
      ui.strip();
      if (exports.length) ui.setExports(exports);
    },
    exit() {
      // Both layers, whichever this entry drew: a 2D/3D switch re-enters this
      // same stage, and the next entry must not find the last one showing.
      stageRack.hidden = true;
      stageRack.replaceChildren();
      scene?.dispose();
      scene = null;
      stage3d.hidden = true;
      stage3d.replaceChildren();
    },
  };
}
