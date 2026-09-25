// Stage 0 - Rails. "Is this to scale?"
//
// An empty rack: rails and RU marks, nothing mounted. The claim is that
// 44.45 mm is 44.45 mm, so in 2D the numbers in the panel are read off the
// drawn geometry rather than printed beside it. In 3D they come from rails.js,
// the one rail description both renderers draw.

import {stageRack, stage3d, srcLine, title, lead, kv, save, saveSvg, panZoom}
  from '../artifact.js';
import {loadMeta, build2dElevation, mount3d, RACK_U, RU} from '../rack.js';
import {OPENING} from '../rails.js';

const mm = n => `${Number((+n).toFixed(2))} mm`;

export default function makeRails() {
  let scene = null;
  return {
    title: 'Rails',
    question: 'Is this to scale?',
    // `ui` is the rail's lease on this entry (stage-rail.js): its setPanel
    // and setExports do nothing once the stage has moved on, and `ui.mode`
    // is the view this entry was started in.
    async enter(ui) {
      // The rack is exactly as tall as the one the cast is mounted into at
      // stage 1, so its height comes from the cast.
      await loadMeta();
      if (!ui.live()) return;
      if (ui.mode === '3d') return enter3d(ui);

      const svg = await build2dElevation({stack: [], heightRU: RACK_U});
      if (!ui.live()) return;
      stage3d.hidden = true;
      stageRack.hidden = false;
      stageRack.replaceChildren(svg);
      const base = svg.getAttribute('viewBox').split(/\s+/).map(Number);
      panZoom(svg, () => base);

      const [left, right] = svg.querySelectorAll('[data-rail]');
      const railH = +left.getAttribute('height');
      const inner = +right.getAttribute('x') - (+left.getAttribute('x') + +left.getAttribute('width'));
      const units = Math.round(railH / RU);
      srcLine.textContent = `${units} U rack · true mm scale`;
      ui.setPanel(
        title('Stage 0 · Rails'),
        lead('<strong>Is this to scale?</strong>'),
        lead('Every drawing here is authored at true size, so an elevation is composition rather than illustration. These are the rails stage 1 mounts into.'),
        kv([['rack unit', mm(RU), true],
            ['height', `${units} U — ${mm(railH)}`],
            ['inner width', mm(inner)]]),
      );
      ui.setExports([{label: 'SVG', title: 'Download the empty rack as drawn',
        run: () => saveSvg(svg, 'rack-rails.svg')}]);
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

  async function enter3d(ui) {
    stageRack.hidden = true; stage3d.hidden = false;
    ui.scrim('Building the empty rack…');
    // Held locally until this entry is known to be live: an entry overtaken
    // mid-build must not write its null over a newer entry's scene.
    const sc = await mount3d({stack: [], heightRU: RACK_U});
    if (!ui.live()) { sc?.dispose(); return; }
    scene = sc;
    // No scene means no WebGL: guard3d's message stays on the scrim, and the
    // panel is built regardless (R11).
    if (scene) ui.unscrim();
    // Say "drawn in 3D" only when something was: without a scene nothing is
    // drawn, and the numbers below are rails.js's, not read off a picture.
    srcLine.textContent = scene ? `${RACK_U} U rack · 3D` : `${RACK_U} U rack · 3D unavailable`;
    ui.setPanel(
      title('Stage 0 · Rails'),
      lead('<strong>Is this to scale?</strong>'),
      lead(scene
        ? 'Drawn in 3D from the same rail description as the 2D view. These are the rails stage 1 mounts into.'
        : '3D is unavailable in this browser, so nothing is drawn here. The values below come from rails.js, the rail description both views draw from. These are the rails stage 1 mounts into.'),
      kv([['rack unit', mm(RU), true],
          ['height', `${RACK_U} U — ${mm(RACK_U * RU)}`],
          ['inner width', mm(OPENING)]]),
    );
    if (scene) {
      ui.setExports([{label: 'GLB', title: 'Download the empty rack as a GLB',
        run: async () => save(await sc.toGLB(), 'rack-rails.glb', 'model/gltf-binary')}]);
    }
  }
}
