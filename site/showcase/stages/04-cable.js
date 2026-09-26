// Stage 4 - Cable. "What is connected to what?"
//
// The rack stages 0-3 built, cabled to an example plan (patching.json): the
// plan is invented and says so, and check-contract.py proves every end of it
// against the compiled faces. Fiber lands on real connectors the plan seats
// (LC plugs in the optics, duplex plugs in the patch panel); copper lands on
// the jack, because no RJ45 port accepts a plug yet (roc-ops/Portrayal#610).
// patch-view.js is the body stage 5 shares; this file owns the question.

import {stage3d, stageRack, title, lead} from '../artifact.js';
import {enterPatched, LANDS} from '../patch-view.js';

export default function makeCable() {
  let handle = null;
  return {
    title: 'Cable',
    question: 'What is connected to what?',
    // `ui` is the rail's lease on this entry (stage-rail.js): every panel,
    // export and scrim write goes through it and is a no-op once stale.
    async enter(ui) {
      const h = await enterPatched(ui, {
        head: [title('Stage 4 · Cable'), lead('<strong>What is connected to what?</strong>')],
        extraPanel: () => [lead(`${LANDS} Hover a cable, or pick a row, to follow it.`)],
      });
      if (!ui.live()) { h?.dispose(); return; }
      handle = h;
    },
    exit() {
      handle?.dispose(); handle = null;
      stage3d.hidden = true; stage3d.replaceChildren();
      // The 2D picture. #stageTabs is the rail's to empty (vacate), not this.
      stageRack.hidden = true; stageRack.replaceChildren();
    },
  };
}
