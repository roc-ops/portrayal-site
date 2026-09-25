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

import {stage3d, stageRack, el, title, lead, kv, save} from '../artifact.js';
import {mountRing, disposeRing, summarize, colorOf} from '../ring.js';

const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const hex = n => `#${n.toString(16).padStart(6, '0')}`;
const swatch = c => el('span', {style: `display:inline-block;width:0.9em;height:0.9em;`
  + `border-radius:2px;vertical-align:-0.1em;margin-right:0.4em;background:${hex(c)}`});

export default function makeCable() {
  let ring = null;
  return {
    title: 'Cable',
    question: 'What is connected to what?',
    // `ui` is the rail's lease on this entry (stage-rail.js): every panel,
    // export and scrim write goes through it and is a no-op once stale.
    async enter(ui) {
      const mine = ui.mine;
      stageRack.hidden = true; stage3d.hidden = false;
      ui.scrim('Racking the ROADM ring…');

      // Adopted as soon as the scene exists, so exit() can dispose it even
      // while mountRing is still waiting on the relief pass or the anchors.
      const got = await mountRing({mine, onScene: r => { if (ui.live()) ring = r; }});
      if (!ui.live()) { disposeRing(got); return; }
      const lab = got?.lab;
      const scene = got?.scene || null;
      // mount3d already hid the scrim when a scene mounted; on the no-WebGL
      // path it deliberately leaves guard3d's message showing.
      if (scene) ui.unscrim();

      const kids = [title('Stage 4 · Cable'), lead('<strong>What is connected to what?</strong>')];
      if (!lab) {
        kids.push(lead('labs.json could not be loaded, so there is no topology to draw.'));
        ui.setPanel(...kids);
        return;
      }
      const s = summarize(lab);
      kids.push(
        lead(`A different rack: <strong>${esc(lab.title || lab.name)}</strong>, from the lab file Portrayal ships. The cast has no links in the data, so this stage cables a topology that does, on its own ${s.rackU ?? '?'} U rails.`),
        kv([
          ['devices', String(s.devices), true],
          ['links', String(s.links), true],
          ...Object.entries(s.byMedia).map(([m, n]) => [m, String(n)]),
        ]),
      );
      // ONE ENTRY PER COLOUR ACTUALLY DRAWN, counted from the links drawn in
      // it. A link on a span is drawn in its span's colour, not its media's,
      // so a media swatch counts only that media's links NOT on a span - the
      // smf swatch once said 24 while six of those strands were span-coloured.
      // The media come from the lab (s.byMedia), not from ring.js's colour
      // map, so a media the map does not know still gets its (grey) entry.
      const legend = el('div', {class: 'panel-lead', 'data-legend': 'true'});
      for (const m of Object.keys(s.byMedia)) {
        const own = lab.links.filter(l => l.media === m && !l.span);
        if (!own.length) continue;          // every one is drawn in a span colour
        const some = own.length < s.byMedia[m];
        legend.append(el('div', {'data-media': m}, [swatch(colorOf(own[0], lab)),
          el('span', {text: `${m}${some ? ', not on a span' : ''} (${own.length})`})]));
      }
      for (const sp of s.spans) {
        const link = lab.links.find(l => l.span === sp.span);
        legend.append(el('div', {'data-span': sp.span},
          [swatch(colorOf(link, lab)), el('span', {text: `span ${sp.span} (${sp.links} strands)`})]));
      }
      kids.push(legend);

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
    },
  };
}
