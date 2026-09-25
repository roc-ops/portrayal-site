// Stage 0 - Rails. "Is this to scale?"
//
// An empty rack: rails and RU marks, nothing mounted. The claim is that
// 44.45 mm is 44.45 mm, so the numbers in the panel are read off the drawn
// geometry rather than printed beside it.

import {stageRack, srcLine, title, lead, kv, setPanel, setExports, saveSvg, panZoom}
  from '../artifact.js';
import {loadMeta, build2dElevation, RACK_U, RU} from '../rack.js';
import {epoch, stale} from '../stage-rail.js';

const mm = n => `${Number((+n).toFixed(2))} mm`;

export default function makeRails() {
  return {
    title: 'Rails',
    question: 'Is this to scale?',
    async enter() {
      const mine = epoch;
      // The rack is exactly as tall as the one the cast is mounted into at
      // stage 1, so its height comes from the cast.
      await loadMeta();
      if (stale(mine)) return;
      const svg = await build2dElevation({stack: [], heightRU: RACK_U});
      if (stale(mine)) return;
      stageRack.hidden = false;
      stageRack.replaceChildren(svg);
      const base = svg.getAttribute('viewBox').split(/\s+/).map(Number);
      panZoom(svg, () => base);

      const [left, right] = svg.querySelectorAll('[data-rail]');
      const railH = +left.getAttribute('height');
      const inner = +right.getAttribute('x') - (+left.getAttribute('x') + +left.getAttribute('width'));
      const units = Math.round(railH / RU);
      srcLine.textContent = `${units} U rack · true mm scale`;
      setPanel(
        title('Stage 0 · Rails'),
        lead('<strong>Is this to scale?</strong>'),
        lead('Every drawing here is authored at true size, so an elevation is composition rather than illustration. These are the rails stage 1 mounts into.'),
        kv([['rack unit', mm(RU), true],
            ['height', `${units} U — ${mm(railH)}`],
            ['inner width', mm(inner)]]),
      );
      setExports([{label: 'SVG', title: 'Download the empty rack as drawn',
        run: () => saveSvg(svg, 'rack-rails.svg')}]);
    },
    exit() {
      stageRack.hidden = true;
      stageRack.replaceChildren();
    },
  };
}
