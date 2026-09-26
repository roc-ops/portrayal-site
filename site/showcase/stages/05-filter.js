// Stage 5 - Filter. "Show me just management."
//
// Stage 4's rack and cables (patch-view.js), narrowed on two axes read off
// the plan - purpose and media, each value with its count - so a purpose
// added to patching.json gets its own button without this file changing.
// What a filter leaves out fades to a ghost rather than vanishing, so the
// rack still reads as cabled. The two axes combine: a cable is lit when it
// matches every axis that has a value picked.
//
// R11: the panel, both rows and the count are built whether or not 3D
// mounted; without a scene a button still narrows the count.

import {stage3d, stageRack, el, title, lead} from '../artifact.js';
import {enterPatched, LANDS} from '../patch-view.js';
import {countsBy} from '../plan.js';

// How much of a filtered-out cable is left: enough to see the rack is cabled.
const GHOST = 0.12;

// A tube's materials, faded or restored. Turning transparency on or off
// recompiles the shader, which three.js does only when told (patch-view.js).
function fade3d(mesh, ghost) {
  mesh.traverse(o => {
    if (!o.material) return;
    if (o.material.transparent !== ghost) { o.material.transparent = ghost; o.material.needsUpdate = true; }
    o.material.opacity = ghost ? GHOST : 1;
  });
}

export default function makeFilter() {
  let handle = null;
  const on = {purpose: null, media: null};
  // 3D only: the plan row lit last (null for none), and the highlight that
  // lights it, so a filter change keeps the row's dimming under the ghosts.
  let lit = null;
  let relight = null;
  const match = l => (!on.purpose || l.purpose === on.purpose) && (!on.media || l.media === on.media);

  // Ghost what does not match - the SVG groups in 2D, the tubes in 3D - and
  // say how many match. In 2D the ghost is a class, and a row's highlight is
  // another, so neither undoes the other. In 3D both are the tube's opacity:
  // the row's highlight is laid down first (or every tube restored), then
  // the ghosts over it.
  function apply(h, countEl) {
    let n = 0;
    if (h.mode !== '2d') {
      if (relight) relight(lit);
      else for (const d of h.drawn) if (d.mesh) fade3d(d.mesh, false);
    }
    for (const d of h.drawn) {
      const hit = match(d.link);
      if (d.g) d.g.classList.toggle('ghost', !hit);
      if (d.tag) d.tag.classList.toggle('ghost', !hit);
      if (d.mesh && !hit) fade3d(d.mesh, true);
    }
    // Counted off the plan, not off what is drawn: the same whichever face
    // is shown, and with no scene at all.
    for (const l of h.plan.links) if (match(l)) n++;
    const total = h.plan.links.length;
    countEl.dataset.matching = String(n);
    countEl.dataset.total = String(total);
    countEl.textContent = `${n} of ${total} cables match.`;
  }

  // One row of toggle buttons per axis, one button per value the plan has.
  function row(ui, h, field, countEl) {
    const wrap = el('div', {class: 'ctl', 'data-filter-row': field});
    const buttons = [];
    for (const [v, n] of countsBy(h.plan, field)) {
      const b = el('button', {type: 'button', 'aria-pressed': 'false', [`data-filter-${field}`]: v,
                              text: `${v} (${n})`});
      b.onclick = () => {
        if (!ui.live()) return;
        on[field] = on[field] === v ? null : v;
        for (const x of buttons) x.setAttribute('aria-pressed', String(on[field] === x.getAttribute(`data-filter-${field}`)));
        apply(h, countEl);
      };
      buttons.push(b);
      wrap.append(b);
    }
    return el('div', {}, [el('p', {class: 'panel-title', text: field}), wrap]);
  }

  return {
    title: 'Filter',
    question: 'Show me just management.',
    // `ui` is the rail's lease on this entry (stage-rail.js): every write
    // after an await, and every button, asks ui.live() first.
    async enter(ui) {
      on.purpose = null; on.media = null;
      lit = null; relight = null;
      const countEl = el('p', {class: 'panel-lead', 'data-filter-count': 'true'});
      const h = await enterPatched(ui, {
        head: [title('Stage 5 · Filter'), lead('<strong>Show me just management.</strong>')],
        // The filters ARE this stage, so they lead the panel; each button
        // carries its count, so the shared counts are left out.
        top: hh => [row(ui, hh, 'purpose', countEl), row(ui, hh, 'media', countEl), countEl],
        counts: false,
        extraPanel: () => [lead('Pick a purpose or a media, or one of each: what does not match fades rather than vanishing, on either face.'),
                           lead(LANDS)],
        // Each 2D draw (the Front/Rear toggle redraws) and the 3D tubes: the
        // filter holds across a redraw.
        onDrawn: hh => { if (ui.live()) apply(hh, countEl); },
      });
      if (!ui.live()) { h?.dispose(); return; }
      handle = h;
      // In 3D a plan row's highlight sets every tube's opacity; remember the
      // row, and fade what the filter leaves out again over it.
      if (h.mode !== '2d' && h.highlight) {
        relight = h.highlight;
        h.highlight = async i => {
          await relight(i);
          if (!ui.live()) return;
          lit = i;
          apply(h, countEl);
        };
      }
      apply(h, countEl);
    },
    exit() {
      handle?.dispose(); handle = null; lit = null; relight = null;
      stage3d.hidden = true; stage3d.replaceChildren();
      // The 2D picture. #stageTabs is the rail's to empty (vacate), not this.
      stageRack.hidden = true; stageRack.replaceChildren();
    },
  };
}
