// Stage 4 - Cable. "What is connected to what?"
//
// The one deliberate scene change. Stages 0-3 build the cast rack, but the cast
// has no links anywhere in the data, and inventing some would break the
// standing rule against fabricating it. So this stage cuts to a second, real
// rack - labs.json's three-site ROADM ring - on its own rails, and draws its
// thirty cables from the ports the compiled faces put them on. ring.js does
// the mounting and the cabling; this file owns the question and the panel.
//
// R11: the panel is built whether or not 3D mounted. Without a scene it still
// says what the lab says - devices, links, media, spans - and that 3D is
// unavailable; with one it adds how many cables were drawn and how many ends
// anchored, which is the honest measure of whether the picture is complete.
//
// IN 2D the ring is drawn a site at a time (ring2d.js): each site's front and
// rear elevations, its own cables between real ports, and a stub for each
// span end that names the far end and jumps there. The sites are the ring's
// topology, not its racking - physically all of them share one lab rack, and
// the panel says so first. 3D is unchanged: the one physical rack.

import {stage3d, stageRack, el, title, lead, kv, save, saveSvg} from '../artifact.js';
import {mountRing, disposeRing, summarize, loadLab, sitesOf, legendEl} from '../ring.js';
import {siteView, siteCaption} from '../ring2d.js';
// A circular import (the rail imports this stage); setMode is only read inside
// a click handler, never while the modules are being evaluated.
import {setMode} from '../stage-rail.js';

const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');

// What the lab says, whichever view draws it: the counts, and one legend
// entry per colour actually drawn.
function summaryKids(lab) {
  const s = summarize(lab);
  const kids = [kv([
    ['devices', String(s.devices), true],
    ['links', String(s.links), true],
    ...Object.entries(s.byMedia).map(([m, n]) => [m, String(n)]),
  ])];
  // One entry per colour actually drawn: ring.js's legend, which stage 5
  // shares, so a span strand is counted under its span and not its media.
  kids.push(legendEl(lab));
  return kids;
}

export default function makeCable() {
  let ring = null;

  // 2D: the ring a site at a time. Every write after an await is behind
  // ui.live(), and siteView holds its own draws to the newest one.
  async function enter2d(ui) {
    stage3d.hidden = true; stageRack.hidden = false;
    stageRack.replaceChildren();
    ui.scrim('Drawing the ROADM ring…');
    const lab = await loadLab();
    if (!ui.live()) return;
    const kids = [title('Stage 4 · Cable'), lead('<strong>What is connected to what?</strong>')];
    if (!lab) {
      ui.scrim('labs.json could not be loaded, so there is no topology to draw.');
      kids.push(lead('labs.json could not be loaded, so there is no topology to draw.'));
      ui.setPanel(...kids);
      return;
    }
    const sites = sitesOf(lab);
    const view = siteView({ui, lab, sites});
    kids.push(
      el('p', {class: 'panel-lead', 'data-site-caption': 'true', text: siteCaption(lab, sites)}),
      view.back,
      view.status,
      lead(`<strong>${esc(lab.title || lab.name)}</strong>, from the lab file Portrayal ships. The cast has no links in the data, so this stage cables a topology that does.`),
      ...summaryKids(lab),
      lead('Each site is its front and rear elevation. Every in-site cable runs between the ports the lab names; a span to another site ends in a stub naming its far end - click it to go there. tx and rx only set which side of the port a strand sits: which bore carries TX is not in the data.'),
    );
    ui.setPanel(...kids);
    ui.setExports([
      {label: 'SVG', title: 'Download this site, front and rear with its cables, as an SVG',
       run: () => {
         const now = view.current();
         if (now) saveSvg(now.drawn.svg, `ring-${sites[now.index].label}.svg`);
       }},
      {label: 'GLB — switch to 3D',
       title: 'GLB exports the 3D scene, which 2D does not build - this switches to 3D',
       run: () => setMode('3d')},
    ]);
    await view.show(0);
    if (!ui.live()) return;
    ui.unscrim();
  }

  return {
    title: 'Cable',
    question: 'What is connected to what?',
    // `ui` is the rail's lease on this entry (stage-rail.js): every panel,
    // export and scrim write goes through it and is a no-op once stale.
    async enter(ui) {
      if (ui.mode === '2d') return enter2d(ui);
      const mine = ui.mine;
      stageRack.hidden = true; stage3d.hidden = false;
      ui.scrim('Racking the ROADM ring…');

      // Adopted as soon as the scene exists, so exit() can dispose it even
      // while mountRing is still taking the anchors.
      const got = await mountRing({mine, onScene: r => { if (ui.live()) ring = r; }});
      if (!ui.live()) { disposeRing(got); return; }
      const lab = got?.lab;
      const scene = got?.scene || null;
      // mount3d already hid the scrim when a scene mounted; on the no-WebGL
      // path it deliberately leaves guard3d's message showing.
      if (scene) ui.unscrim();

      const kids = [title('Stage 4 · Cable'), lead('<strong>What is connected to what?</strong>')];
      if (!lab) {
        // No lab means mountRing never got as far as mount3d, so nothing
        // else will ever take "Racking the ROADM ring…" down: say why here.
        ui.scrim('labs.json could not be loaded, so there is no topology to draw.');
        kids.push(lead('labs.json could not be loaded, so there is no topology to draw.'));
        ui.setPanel(...kids);
        return;
      }
      const s = summarize(lab);
      kids.push(
        lead(`A different rack: <strong>${esc(lab.title || lab.name)}</strong>, from the lab file Portrayal ships. The cast has no links in the data, so this stage cables a topology that does, on its own ${s.rackU ?? '?'} U rails.`),
        ...summaryKids(lab),
      );

      if (scene) {
        const drawn = got.tubes.filter(t => t.anchored).length;
        const missing = got.tubes.length - drawn;
        // WHY a cable is missing, by the reason ring.js recorded for each
        // end - never a guess. The contract proves every port is drawn, so
        // at runtime a missing cable is far likelier a load failure, and
        // blaming the port would be wrong exactly when this shows.
        const f = got.ends.failed;
        const why = [];
        if (f.unmounted) why.push(`${f.unmounted} end${f.unmounted === 1 ? '' : 's'} on devices that did not mount (their config index failed to load)`);
        if (f.threw) why.push(`${f.threw} anchor lookup${f.threw === 1 ? '' : 's'} failed (see the console)`);
        if (f.missing) why.push(`${f.missing} end${f.missing === 1 ? '' : 's'} not found on the mounted device`);
        kids.push(kv([
          ['cables drawn', `${drawn} / ${s.links}`, true],
          ['ends anchored', `${got.ends.anchored} / ${got.ends.total}`, true],
          ['not drawn', missing ? `${missing} — ${why.join('; ')}` : '0'],
        ]));
        // Which faces the ends landed on, as portAnchor found them - read
        // back, not asserted, so a port that moved faces shows up here.
        const faces = {};
        for (const t of got.tubes) {
          if (!t.views) continue;
          const k = `${t.link.media}: ${t.views[0]} → ${t.views[1]}`;
          faces[k] = (faces[k] || 0) + 1;
        }
        kids.push(kv(Object.entries(faces).map(([k, n]) => [k, String(n)])));
        kids.push(lead('Every end is found by its port on the device the lab names, and leaves straight out of the face that port is on. tx and rx only set which side of the port a strand sits: which bore carries TX is not in the data, so it is not drawn as if it were.'));
        ui.setExports([{label: 'GLB', title: 'Download the cabled ring as a GLB',
          run: async () => save(await scene.toGLB(), 'roadm-ring.glb', 'model/gltf-binary')}]);
      }
      if (got.unmounted?.length) {
        const ul = el('p', {class: 'panel-lead', 'data-unmounted': 'true'});
        ul.append(el('strong', {text: `Not mounted (${got.unmounted.length}): `}),
                  el('span', {text: got.unmounted.join(', ')}));
        kids.push(ul);
      }
      if (!scene) {
        kids.push(lead('3D is unavailable in this browser, so the cables are not drawn. The counts above are read from the lab file, not from the picture.'));
      }
      ui.setPanel(...kids);
    },
    exit() {
      disposeRing(ring);
      ring = null;
      stage3d.hidden = true;
      stage3d.replaceChildren();
      // The 2D picture. #stageTabs is the rail's to empty (vacate), not this.
      stageRack.hidden = true;
      stageRack.replaceChildren();
    },
  };
}
