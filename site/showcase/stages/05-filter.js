// Stage 5 - Filter. "Show me just management."
//
// The same ring stage 4 cabled, filtered on two independent axes: media,
// straight off each link, and purpose, the group of the ports a link
// connects - read off the compiled face, per ring.js's groupOf/purpose. Both
// axes are derived from the data, never a literal list, so a third media or
// an unforeseen group shows up on its own row with its own count rather than
// being silently dropped - the finding against stage 4's fixed colour map.
//
// R11: the panel (and both filter rows) is built whether or not 3D mounted.
// Toggling still narrows the counted set with no scene; it only additionally
// hides tubes when one exists.

import {stage3d, stageRack, el, title, lead, kv, controls, panel} from '../artifact.js';
import {mountRing, disposeRing, purpose, MEDIA_COLORS, OTHER_MEDIA} from '../ring.js';

const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const hex = n => `#${n.toString(16).padStart(6, '0')}`;
const swatch = c => el('span', {style: `display:inline-block;width:0.9em;height:0.9em;`
  + `border-radius:2px;vertical-align:-0.1em;margin-right:0.4em;background:${hex(c)}`});

export default function makeFilter() {
  let ring = null;

  return {
    title: 'Filter',
    question: 'Show me just management.',
    // `ui` is the rail's lease on this entry (stage-rail.js). The toggle
    // handlers below close over it: once the rail has moved on, ui.live() is
    // false and a click that somehow reaches them changes nothing.
    async enter(ui) {
      stageRack.hidden = true; stage3d.hidden = false;
      ui.scrim('Racking the ROADM ring…');

      const got = await mountRing({mine: ui.mine, onScene: r => { if (ui.live()) ring = r; }});
      if (!ui.live()) { disposeRing(got); return; }
      const lab = got?.lab;
      const scene = got?.scene || null;
      if (scene) ui.unscrim();

      const kids = [title('Stage 5 · Filter'), lead('<strong>Show me just management.</strong>')];
      if (!lab) {
        kids.push(lead('labs.json could not be loaded, so there is nothing to filter.'));
        ui.setPanel(...kids);
        return;
      }

      const links = lab.links || [];
      // One purpose per link, in link order, so it lines up with got.tubes
      // (built in the same lab.links order) whether or not a scene exists.
      const purposes = await Promise.all(links.map(purpose));
      if (!ui.live()) { disposeRing(got); return; }

      // Both rows straight off the data - values that appear, not a fixed
      // vocabulary - so an unforeseen media or group gets its own row rather
      // than vanishing into nothing.
      const mediaVals = [...new Set(links.map(l => l.media))];
      const purposeVals = [...new Set(purposes)];

      const activeMedia = new Set();
      const activePurpose = new Set();

      const matches = (l, i) =>
        (activeMedia.size === 0 || activeMedia.has(l.media)) &&
        (activePurpose.size === 0 || activePurpose.has(purposes[i]));

      const countEl = el('p', {class: 'panel-lead', 'data-filter-count': 'true'});

      function apply() {
        if (!ui.live()) return;
        let matching = 0;
        links.forEach((l, i) => { if (matches(l, i)) matching++; });
        countEl.textContent = `${matching} of ${links.length} link${links.length === 1 ? '' : 's'} match.`;
        if (scene && got.tubes) {
          let visible = 0;
          got.tubes.forEach((t, i) => {
            const show = matches(t.link, i);
            if (t.object) { t.object.visible = show; if (show) visible++; }
          });
          // Read back from the tubes, never hand-set: this is what a test
          // (or a curious visitor) can check against the picture itself.
          panel.dataset.visibleCables = String(visible);
        } else {
          delete panel.dataset.visibleCables;
        }
      }

      const toggleBtn = (set, value) => (btn) => {
        if (!ui.live()) return;
        set.has(value) ? set.delete(value) : set.add(value);
        apply();
      };

      const mediaCounts = new Map(mediaVals.map(m => [m, links.filter(l => l.media === m).length]));
      const purposeCounts = new Map(purposeVals.map(p => [p, purposes.filter(x => x === p).length]));

      const legend = el('div', {class: 'panel-lead', 'data-legend': 'true'});
      for (const m of mediaVals) {
        legend.append(el('div', {}, [swatch(MEDIA_COLORS[m] ?? OTHER_MEDIA),
          el('span', {text: `${m} (${mediaCounts.get(m)})`})]));
      }

      kids.push(
        lead(`Filtering the same ${links.length}-link ring stage 4 cabled, on two independent axes: media, straight off each link, and purpose, the group of the ports it connects - read off the compiled face, the same way stage 4's labels are.`),
        legend,
        el('p', {class: 'panel-title', text: 'media'}),
        controls(mediaVals.map(m => ({
          label: `${m} (${mediaCounts.get(m)})`, toggle: true, run: toggleBtn(activeMedia, m),
        }))),
        el('p', {class: 'panel-title', text: 'purpose'}),
        controls(purposeVals.map(p => ({
          label: `${p} (${purposeCounts.get(p)})`, toggle: true, run: toggleBtn(activePurpose, p),
        }))),
        countEl,
      );
      if (!scene) {
        kids.push(lead('3D is unavailable in this browser, so no tubes are drawn, but the counts above and a toggle\'s effect on them are read from the same data a picture would use.'));
      }
      ui.setPanel(...kids);
      apply();
    },
    exit() {
      disposeRing(ring);
      ring = null;
      delete panel.dataset.visibleCables;
      stage3d.hidden = true;
      stage3d.replaceChildren();
    },
  };
}
