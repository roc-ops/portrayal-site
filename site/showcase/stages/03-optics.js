// Stage 3 - Seat optics. "What media, speed and lanes?"
//
// The cages on the AS7726-32X's qsfp28 group accept exactly one thing:
// generic/qsfp-lc@1 (verified against assets/dist/as7726-32x.configs.json's
// .cages.front - 32 cages in group qsfp28, each `accepts: ["generic/qsfp-lc@1"]`,
// plus 2 mgmt cages this stage does not touch). That component carries NO
// speed and NO lanes attribute - components.json's own description says so:
// "which module it is - rate, reach, wavelength, watts - is a fact about a
// vendor's product" and lives on the wrapper that composes this generic shape,
// never here. So this stage answers "what media / speed / lanes?" only as far
// as the data goes: it shows the seated optic's own attrs (media, form
// factor, face, class), the cage's interface and group, and then says plainly
// that speed and lanes are not modelled - quoting the component's own
// description as the reason, rather than inferring a hundred-gig rate from
// the group name `qsfp28` or anything else. Showing that gap honestly is the
// point; check-contract.py enforces that no speed table and no guessed rate
// or lane count ever creeps back in here.
//
// Seating goes through the same rack.js machinery stage 2 uses: overrides,
// enqueueRebuild (rack3d.js's build() is not re-entrant - see rack.js's
// comment on the shared rebuild queue), and the epoch/stale guard captured at
// click time (R17/R18) so a click queued behind a slow rebuild, or one that
// outlives leaving this stage, never paints over whatever stage is current by
// the time it runs. "Click time" is the rail's lease (stage-rail.js) of the
// entry that drew the button, never the global epoch read when it is clicked.
//
// Once seated, the occupant's paths become addressable on the device - and
// this stage reads them off the seated component's own compiled skin,
// through rack.js's `loadSkin` (the same fetch `overrideFaces` in rack3d.js
// runs, and the same one `build2dElevation` goes through for a bay swap):
// every `data-path` on the skin that starts with the component's own root id
// plus `/` (`qsfp-lc/…`) is real, and none of them are hand-typed here. Each
// is renamed onto the occupant path exactly as vendor/swap.js's own naming
// does (occupantNames): a device-level cage's occupant is `<cage-id>-occupant`,
// so `qsfp-lc/tx` becomes `port-1-occupant/tx`. If the skin fails to fetch,
// the panel says so rather than falling back to a guessed list - a stale or
// wrong list would be worse than admitting the fetch failed.
//
// When a scene is mounted, portAnchor resolves the derived tx path to a real
// position in the room - this is exactly what commit a7255061 fixed, and it
// is the proof that the seated optic is real in 3D. When there is no scene
// (no WebGL), the panel says so instead of a position - R11: the panel
// builds either way, only the "loading" scrim depends on 3D.
//
// In 2D (ui.mode) there is no room to put a coordinate in. The picture is the
// cast's front faces through build2dElevation, which seats `overrides` with
// the same swap.js naming, so the derived tx bore path is an element on the
// AS7726-32X's face - and it is highlighted there instead. The path is picked
// from the same derived list, never typed; if it is not on the face, the
// panel says so.

import {stage3d, stageRack, el, title, lead, kv, panZoom} from '../artifact.js';
import {CAST, RACK_U, loadMeta, cagesOf, overrides, mount3d, shortRef,
        enqueueRebuild, byRef, loadSkin, build2dElevation} from '../rack.js';
import {boxIn, highlight, clearHighlights} from '../svg2d.js';
import {wireDevices} from '../spoke-host.js';
import {occupantNames} from '../../../vendor/swap.js';
import {dropBelow} from '../plan.js';

const DEV = 'as7726-32x';
const GROUP = 'qsfp28';
const DEFAULT_CAGE = 'port-1';
// THE HIGHLIGHT IS THE PORT, with the TX bore ringed inside it. A box round
// the bore alone (7 mm, haloed) sat on one corner of a QSFP port and read as a
// stray square; the port is what the visitor chose, the bore is what the seat
// made addressable, so both are drawn. Padding in mm.
const PORT_PAD = 0.8;
const BORE_PAD = 0.6;

export default function makeOptics() {
  let scene = null;
  let svg = null;      // the 2D picture on stageRack, when this entry is 2D
  let selected = DEFAULT_CAGE;
  const skinCache = new Map();   // ref -> {comp, text} | null, memoized
  let buildSeq = 0;    // the newest buildPanel; an older one never paints

  // The 2D picture, as stage 2 draws it. Put up only while `ui` is live, and
  // attached before anything is highlighted on it (svg2d's boxIn needs the
  // root in the document). It opens framed on the AS7726-32X, because a bore
  // is a few millimeters in a rack a meter tall; the pan/zoom base stays the
  // whole rack, so double-click still fits all of it.
  async function draw2d(ui) {
    const out = await build2dElevation({stack: CAST.filter(e => e.ru != null),
                                        heightRU: RACK_U, overrides});
    if (!ui.live()) return false;
    stage3d.hidden = true;
    stageRack.hidden = false;
    stageRack.replaceChildren(out);
    const base = out.getAttribute('viewBox').split(/\s+/).map(Number);
    const pz = panZoom(out, () => base);
    const b = boxIn(out, out.querySelector(`[data-device-ref="${DEV}"]`));
    if (b) pz.show([b.x - 20, b.y - 40, b.width + 40, b.height + 80]);
    // Every draw, the first and each seat's redraw: the devices on THIS
    // picture open their Inspect lens (spoke-host.js), in this framing too.
    wireDevices(out, 'optics', ui);
    svg = out;
    return true;
  }

  function cages() {
    return (cagesOf(DEV).front || []).filter(c => c.group === GROUP);
  }

  // Memoized per component ref - a re-render (cage change, unrelated seat)
  // must not refetch a skin it already has, but two different refs must
  // never share a cache slot.
  async function skinFor(ref) {
    if (skinCache.has(ref)) return skinCache.get(ref);
    const loaded = await loadSkin(ref).catch(() => null);
    skinCache.set(ref, loaded);
    return loaded;
  }

  // Every data-path on the skin that hangs off the component's own root id,
  // renamed onto the seated occupant - not a literal list. Returns [] when
  // the skin carries none, null when the skin could not be fetched at all
  // (the caller tells the visitor honestly rather than guessing).
  async function occupantPaths(cage, ref, comp) {
    const skin = await skinFor(ref);
    if (!skin) return null;
    const doc = new DOMParser().parseFromString(skin.text, 'image/svg+xml');
    const prefix = `${comp.name}/`;
    const occId = occupantNames(cage).path;
    return [...doc.querySelectorAll('[data-path]')]
      .map(el => el.getAttribute('data-path'))
      .filter(p => p && p.startsWith(prefix))
      .map(p => ({suffix: p.slice(prefix.length), path: `${occId}/${p.slice(prefix.length)}`}));
  }

  // `ui` is the lease this build was started under (stage-rail.js) -
  // enter()'s for the initial paint, and the SAME lease for a seat, unseat
  // or cage change clicked on that panel, since every control closes over
  // it. This function awaits a skin fetch (uncached on a component's first
  // seat) and, on the scene path, portAnchor - either can resolve after the
  // visitor has left this stage. R18 applies here exactly as it does to
  // doSeat: check ui.live() after every await, and ui.setPanel is itself a
  // no-op once stale, so a build that outlives the stage paints nothing over
  // whatever stage is current by the time it finishes.
  //
  // And only the NEWEST build paints. Live is not enough: on a component's
  // first seat the skin fetch is uncached, so seat port-1 (this build awaits
  // the skin) and switch the cage to port-2, which is empty and paints at
  // once - when port-1's build resumes the lease is still live and the
  // picture is the same, and it would clear port-2's panel and highlight
  // port-1's bore while port-2 is selected. `my` is this build's number;
  // every check after an await asks that it is still the latest.
  async function buildPanel(ui, message) {
    const my = ++buildSeq;
    const current = () => ui.live() && my === buildSeq;
    const sc = scene;   // this build's own scene, for the identity check below
    const pic = svg;    // and its own 2D picture, likewise
    // The last cage's highlight goes whatever this cage holds; it is redrawn
    // below, after the skin loads, only if this cage has an optic.
    if (pic) { clearHighlights(pic); clearHighlights(pic, 'hl-bore'); }
    const all = cages();
    const cage = all.find(c => c.id === selected) || all[0];

    const cageSel = el('select', {'data-cage': 'true'});
    for (const c of all) cageSel.append(el('option', {value: c.id, text: c.id}));
    cageSel.value = cage?.id || '';
    cageSel.onchange = () => { if (!ui.live()) return; selected = cageSel.value; buildPanel(ui); };

    const seatBtn = el('button', {type: 'button', 'data-seat': 'true', text: 'Seat optic'});
    seatBtn.onclick = () => seat(ui, cage, (cage.accepts || [])[0] || null);
    const unseatBtn = el('button', {type: 'button', 'data-unseat': 'true', text: 'Unseat'});
    unseatBtn.onclick = () => seat(ui, cage, null);

    const readout = el('p', {class: 'panel-lead', 'data-readout': 'true',
      text: message || `Pick a cage and seat its optic (defaults to ${DEFAULT_CAGE}).`});

    const seatedRef = cage ? (overrides[DEV]?.[cage.id] || null) : null;
    const seatedComp = seatedRef ? byRef(seatedRef) : null;
    // What the cage holds, as a marker a checker can wait on.
    if (seatedRef) readout.dataset.seated = seatedRef;

    const kids = [
      title('Stage 3 · Seat optics'),
      lead('<strong>What media, speed and lanes?</strong>'),
      lead('Every qsfp28 cage on the AS7726-32X accepts exactly one thing, read off its own `accepts`: a generic QSFP with an LC duplex face. Seat it and read back what the compiled index actually knows about it.'),
      el('div', {class: 'ctl-row', 'data-cage-row': 'true'},
        [el('span', {class: 'mono', text: cage?.id || '(none)'}), cageSel, seatBtn, unseatBtn]),
      readout,
      kv([
        [cage?.id || '(cage)', `interface: ${cage?.interface}, group: ${cage?.group}`],
      ]),
    ];

    if (seatedComp) {
      const a = seatedComp.attrs || {};
      kids.push(kv([
        ['occupant', shortRef(seatedRef)],
        ['media', a.media, true],
        ['form factor', a['form-factor'], true],
        ['face', a.face],
        ['class', seatedComp.class],
      ]));
      kids.push(lead(
        `Speed and lanes are not on this optic. Its own description says: &ldquo;${
          (seatedComp.description || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
        }&rdquo;`));

      const paths = await occupantPaths(cage, seatedRef, seatedComp);
      if (!current()) return;
      // A redraw replaced the picture while the skin loaded: the build that
      // follows that redraw paints the panel and the highlight, not this one.
      if (svg !== pic) return;
      if (pic) { clearHighlights(pic); clearHighlights(pic, 'hl-bore'); }
      if (paths === null) {
        kids.push(lead('The skin could not be loaded, so its paths are unknown.'));
      } else if (!paths.length) {
        kids.push(lead('The skin carries no data-paths under its own root.'));
      } else {
        kids.push(lead(`Newly addressable: ${paths.map(p => `<code>${p.path}</code>`).join(', ')}`));
        const tx = paths.find(p => p.suffix === 'tx');
        const bore = paths.find(p => p.suffix === 'tx/bore');
        if (ui.mode === '2d') {
          // The path and the element are resolved together, so the panel
          // names exactly what the box is on: the bore when the face has it,
          // else the tx element, else neither.
          const g = pic?.querySelector(`[data-device-ref="${DEV}"]`);
          const at = p => p && g?.querySelector(`[data-path="${CSS.escape(p.path)}"]`);
          const hit = [bore, tx].find(at);
          if (!bore && !tx) {
            kids.push(lead('The skin carries no tx path to highlight.'));
          } else if (hit && highlight(pic, g.querySelector(`[data-path="${CSS.escape(cage.id)}"]`) || at(hit),
                                      'hl', PORT_PAD)) {
            highlight(pic, at(hit), 'hl-bore', BORE_PAD)?.classList.add('pt-hl-inner');
            kids.push(kv([[hit.path,
              `${cage.id} highlighted, its ${hit === bore ? 'TX bore' : 'TX'} ringed inside`, true]]));
          } else {
            kids.push(lead(`${[bore, tx].filter(Boolean).map(p => `<code>${p.path}</code>`).join(' and ')
              } ${bore && tx ? 'are' : 'is'} not on the drawn face, so nothing is highlighted.`));
          }
        } else if (sc && tx) {
          const anchor = await sc.portAnchor(DEV, tx.path);
          if (!current() || scene !== sc) return;
          if (anchor) {
            const {x, y, z} = anchor.position;
            kids.push(kv([[tx.path,
              `x ${x.toFixed(1)}, y ${y.toFixed(1)}, z ${z.toFixed(1)} mm`, true]]));
          } else {
            kids.push(lead('portAnchor found no matching path on the mounted scene.'));
          }
        } else if (sc && !tx) {
          kids.push(lead('The skin carries no tx path to anchor.'));
        } else {
          kids.push(lead('3D is unavailable in this browser, so the tx position cannot be shown.'));
        }
      }
    } else if (cage) {
      kids.push(lead(`${cage.id} is empty.`));
    }

    if (!current() || scene !== sc || svg !== pic) return;
    ui.setPanel(...kids);
  }

  // The queued unit of work. `ui` is the lease of the panel the visitor
  // CLICKED - handed down by seat(), below - not the state when this runs, which
  // can be later if it was queued behind another cage's rebuild, or behind
  // stage 2's own seats (both stages share rack.js's one rebuild queue).
  // R18: the first thing this does is check whether the stage has already
  // moved on, and if so it drops the seat entirely - no `overrides` write, no
  // rebuild, no panel update.
  async function doSeat(cage, ref, ui) {
    if (!ui.live()) return null;
    overrides[DEV] = overrides[DEV] || {};
    // Ruling R1, as stage 2 does for a bay: the plugs the old optic held go
    // with it, so an Unseat leaves no `<cage>-occupant/` seat behind (stage
    // 4 would count it, and the Inspect lens would carry it into swap=).
    dropBelow(overrides[DEV], cage.id);
    overrides[DEV][cage.id] = ref;
    const message = ref ? `seated — ${cage.id}: ${shortRef(ref)}` : `unseated — ${cage.id}`;

    if (ui.mode === '2d') {
      // In this same queue slot, so the pictures land in click order.
      if (!await draw2d(ui)) return null;
      return {message};
    }
    const sc = scene;
    if (sc) {
      sc.setOverrides(DEV, overrides[DEV]);
      await sc.build();
      if (!ui.live() || scene !== sc) return null;
    }
    return {message};
  }

  function seat(ui, cage, ref) {
    if (!cage) return;
    enqueueRebuild(() => doSeat(cage, ref, ui))
      .catch(err => { console.warn('[portrayal] stage 3 seat failed', err); return null; })
      .then(result => { if (result && ui.live()) buildPanel(ui, result.message); });
  }

  return {
    title: 'Seat optics',
    question: 'What media, speed and lanes?',
    async enter(ui) {
      const is3d = ui.mode === '3d';
      stageRack.hidden = is3d; stage3d.hidden = !is3d;
      ui.scrim('Mounting the cast…');
      await loadMeta();
      if (!ui.live()) return;

      if (is3d) {
        const stack = CAST.map(e => ({...e}));
        // Held locally until this entry is known to be live, as stage 1 does.
        const sc = await mount3d({stack, heightRU: RACK_U, overrides});
        if (!ui.live()) { sc?.dispose(); return; }
        scene = sc;
        // Only when a scene actually mounted - R11: the panel is built either
        // way, so a no-WebGL run still lets the visitor seat an optic and read
        // its attrs back, just without a 3D position.
        if (scene) ui.unscrim();
      } else {
        if (!await draw2d(ui)) return;
        ui.unscrim();
      }

      await buildPanel(ui);
      // "Look closer" lives under the stage, not at the foot of the panel.
      // ui.strip() is a no-op if this entry went stale during that await.
      ui.strip();
    },
    exit() {
      // Both layers, whichever this entry drew: a 2D/3D switch re-enters this
      // same stage, and the next entry must not find the last one showing.
      stageRack.hidden = true;
      stageRack.replaceChildren();
      svg = null;
      scene?.dispose();
      scene = null;
      stage3d.hidden = true;
      stage3d.replaceChildren();
    },
  };
}
