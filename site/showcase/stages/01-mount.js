// Stage 1 - Mount. "Will it fit?"
//
// The cast mounted into the rails stage 0 drew, in 3D. The panel's answer is
// computed from the chassis dimensions in each device manifest, so whether it
// fits is arithmetic rather than judgement - and the panel is built whether or
// not 3D mounted, because R11: the panel never depends on 3D. mount3d returns
// null when WebGL is unavailable, after guard3d has already put its message
// on the loading scrim; the 3D is the picture, the panel is the answer.

import {stage3d, stageRack, loading, title, lead, kv, setPanel, setExports, save}
  from '../artifact.js';
import {CAST, RACK_U, loadMeta, chassisOf, unitsOf, overrides, mount3d} from '../rack.js';
import {epoch, stale} from '../stage-rail.js';

export default function makeMount() {
  let scene = null;
  return {
    title: 'Mount',
    question: 'Will it fit?',
    async enter() {
      const mine = epoch;
      stageRack.hidden = true; stage3d.hidden = false;
      loading.hidden = false; loading.textContent = 'Mounting the cast…';
      await loadMeta();
      if (stale(mine)) return;

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

      scene = await mount3d({stack, heightRU: RACK_U, overrides});
      if (stale(mine)) { scene?.dispose(); scene = null; return; }
      // Only when a scene actually mounted: on the no-WebGL path mount3d
      // returns null and deliberately leaves guard3d's message on the scrim,
      // so hiding it unconditionally would show an empty 3D pane with no
      // explanation. The panel below is built either way - R11.
      if (scene) loading.hidden = true;

      setPanel(
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
      if (scene) {
        setExports([{label: 'GLB', title: 'Download the mounted rack as a GLB',
          run: async () => save(await scene.toGLB(), 'rack.glb', 'model/gltf-binary')}]);
      }
    },
    exit() {
      scene?.dispose();
      scene = null;
      stage3d.hidden = true;
      stage3d.replaceChildren();
    },
  };
}
