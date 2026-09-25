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
// the time it runs.
//
// Once seated, the occupant's paths become addressable on the device - not
// guessed, but read off vendor/swap.js's own naming (occupantNames): a
// device-level cage's occupant is `<cage-id>-occupant`, and the skin's own
// data-paths (qsfp-lc/tx, qsfp-lc/rx, qsfp-lc/tx/bore, qsfp-lc/rx/bore) hang
// off that root once renamed in. When a scene is mounted, portAnchor resolves
// the tx path to a real position in the room - this is exactly what commit
// a7255061 fixed, and it is the proof that the seated optic is real in 3D.
// When there is no scene (no WebGL), the panel says so instead of a position -
// R11: the panel builds either way, only the "loading" scrim depends on 3D.

import {stage3d, stageRack, loading, el, title, lead, kv, setPanel, DIST} from '../artifact.js';
import {CAST, RACK_U, loadMeta, cagesOf, overrides, mount3d, shortRef,
        enqueueRebuild} from '../rack.js';
import {epoch, stale} from '../stage-rail.js';
import {occupantNames} from '../../../vendor/swap.js';

const DEV = 'as7726-32x';
const GROUP = 'qsfp28';
const DEFAULT_CAGE = 'port-1';

export default function makeOptics() {
  let scene = null;
  let selected = DEFAULT_CAGE;
  let components = null;   // the component index, loaded once and memoized

  function cages() {
    return (cagesOf(DEV).front || []).filter(c => c.group === GROUP);
  }

  async function loadComponents() {
    if (components) return components;
    const {jdist} = await import('../../../vendor/dist.js');
    try { components = (await jdist(`${DIST}components.json`)).components || []; }
    catch (err) { console.warn('[portrayal] no component index', err); components = []; }
    return components;
  }
  const byRef = (list, ref) => (list || []).find(
    c => ref && `${c.ns}/${c.name}@${c.major.slice(1)}` === ref.split(':')[0]);

  async function buildPanel(message) {
    const all = cages();
    const cage = all.find(c => c.id === selected) || all[0];
    const comps = await loadComponents();

    const cageSel = el('select', {'data-cage': 'true'});
    for (const c of all) cageSel.append(el('option', {value: c.id, text: c.id}));
    cageSel.value = cage?.id || '';
    cageSel.onchange = () => { selected = cageSel.value; buildPanel(); };

    const seatBtn = el('button', {type: 'button', 'data-seat': 'true', text: 'Seat optic'});
    seatBtn.onclick = () => seat(cage, (cage.accepts || [])[0] || null);
    const unseatBtn = el('button', {type: 'button', 'data-unseat': 'true', text: 'Unseat'});
    unseatBtn.onclick = () => seat(cage, null);

    const readout = el('p', {class: 'panel-lead', 'data-readout': 'true',
      text: message || `Pick a cage and seat its optic (defaults to ${DEFAULT_CAGE}).`});

    const seatedRef = cage ? (overrides[DEV]?.[cage.id] || null) : null;
    const seatedComp = seatedRef ? byRef(comps, seatedRef) : null;

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

      const occId = occupantNames(cage).path;
      const paths = ['tx', 'rx', 'tx/bore', 'rx/bore'].map(p => `${occId}/${p}`);
      kids.push(lead(`Newly addressable: ${paths.map(p => `<code>${p}</code>`).join(', ')}`));

      if (scene) {
        const anchor = await scene.portAnchor(DEV, `${occId}/tx`);
        if (anchor) {
          const {x, y, z} = anchor.position;
          kids.push(kv([[`${occId}/tx`,
            `x ${x.toFixed(1)}, y ${y.toFixed(1)}, z ${z.toFixed(1)} mm`, true]]));
        } else {
          kids.push(lead('portAnchor found no matching path on the mounted scene.'));
        }
      } else {
        kids.push(lead('3D is unavailable in this browser, so the tx position cannot be shown.'));
      }
    } else if (cage) {
      kids.push(lead(`${cage.id} is empty.`));
    }

    setPanel(...kids);
  }

  // The queued unit of work. `mine` is the epoch at the moment the visitor
  // CLICKED - captured by seat(), below - not at the moment this runs, which
  // can be later if it was queued behind another cage's rebuild, or behind
  // stage 2's own seats (both stages share rack.js's one rebuild queue).
  // R18: the first thing this does is check whether the stage has already
  // moved on, and if so it drops the seat entirely - no `overrides` write, no
  // rebuild, no panel update.
  async function doSeat(cage, ref, mine) {
    if (stale(mine)) return null;
    overrides[DEV] = overrides[DEV] || {};
    overrides[DEV][cage.id] = ref;

    const sc = scene;
    if (sc) {
      sc.setOverrides(DEV, overrides[DEV]);
      await sc.build();
      if (stale(mine) || scene !== sc) return null;
    }
    return {message: ref ? `seated — ${cage.id}: ${shortRef(ref)}` : `unseated — ${cage.id}`};
  }

  function seat(cage, ref) {
    if (!cage) return;
    const mine = epoch;   // captured NOW, at the click - not when this runs
    enqueueRebuild(() => doSeat(cage, ref, mine))
      .catch(err => { console.warn('[portrayal] stage 3 seat failed', err); return null; })
      .then(result => { if (result && !stale(mine)) buildPanel(result.message); });
  }

  return {
    title: 'Seat optics',
    question: 'What media, speed and lanes?',
    async enter() {
      const mine = epoch;
      stageRack.hidden = true; stage3d.hidden = false;
      loading.hidden = false; loading.textContent = 'Mounting the cast…';
      await loadMeta();
      if (stale(mine)) return;

      const stack = CAST.map(e => ({...e}));
      scene = await mount3d({stack, heightRU: RACK_U, overrides});
      if (stale(mine)) { scene?.dispose(); scene = null; return; }
      // Only when a scene actually mounted - R11: the panel is built either
      // way, so a no-WebGL run still lets the visitor seat an optic and read
      // its attrs back, just without a 3D position.
      if (scene) loading.hidden = true;

      await buildPanel();
    },
    exit() {
      scene?.dispose();
      scene = null;
      stage3d.hidden = true;
      stage3d.replaceChildren();
    },
  };
}
