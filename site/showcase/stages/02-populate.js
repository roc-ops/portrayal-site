// Stage 2 - Populate. "What does this bay accept?"
//
// Every slot offers exactly what it accepts, and choosing one seats it. The
// list comes from the compiled index (rack.js's baysOf), never from an array
// written in this file - a hardcoded list here would be the page inventing
// the answer it is meant to demonstrate. check-contract.py enforces both
// halves of that: baysOf must be read, and no inline accepted-list array may
// appear below.
//
// The device knowing its slots IS the demonstration, so it is shown rather
// than staged: the ASR-9006's `slots` group splits into bays with the same
// `accepts`, and each set is headed by what its cards are - the `role` the
// component index gives them (route-switch-processor, line-card), never a
// label written here. slot-0 and slot-1 list route processors; slot-2 through
// slot-5 list line cards. (It used to offer every slot the union of both, so
// that picking a line card for slot-0 would be refused. That read as a broken
// dropdown, not a demonstration, and it went.)
//
// The picture follows the switch (ui.mode): in 2D the cast's front faces on
// the rails, through build2dElevation, which seats `overrides` through
// swap.js; in 3D the rack scene. Seats live in `overrides`, not in either
// picture, so a card seated in 2D is there in 3D and back again.
//
// Verified against assets/dist/asr-9006.configs.json's .bays.front:
//   slot-0/slot-1 accept only a9k-rsp880-{se,tr,lt-se,lt-tr} + the slot cover
//   slot-2..slot-5 accept only line cards (a9k-16x100ge-tr, a9k-4x100ge-se,
//   a9k-8x100ge-se, ...) + the slot cover

import {stage3d, stageRack, el, title, lead, panZoom} from '../artifact.js';
import {CAST, RACK_U, loadMeta, chassisOf, baysOf, byRef, overrides, mount3d, shortRef,
        enqueueRebuild, build2dElevation} from '../rack.js';
import {wireDevices} from '../spoke-host.js';
import {dropBelow} from '../plan.js';

const DEV = 'asr-9006';
const GROUP = 'slots';
const COVER = 'cisco/a9k-slot-cover@1';

export default function makePopulate() {
  let scene = null;
  let readout = null;
  // Seats are serialized through rack.js's enqueueRebuild - see the comment
  // there for why (build() disposes the shared `mounted` array before its
  // first await, so two concurrent build()s corrupt each other). This stage
  // only has to track how many of ITS OWN seats are still outstanding, for
  // the "Applying…" readout below.
  let inFlight = 0;

  // The 2D picture: the cast on the rails, with the current overrides seated.
  // Built off-screen and put up only if `ui` is still live, so a redraw that
  // finishes after the visitor has left paints nothing.
  async function draw2d(ui) {
    const svg = await build2dElevation({stack: CAST.filter(e => e.ru != null),
                                        heightRU: RACK_U, overrides});
    if (!ui.live()) return false;
    stage3d.hidden = true;
    stageRack.hidden = false;
    stageRack.replaceChildren(svg);
    const base = svg.getAttribute('viewBox').split(/\s+/).map(Number);
    panZoom(svg, () => base);
    // Every draw, the first and each seat's redraw: the devices on THIS
    // picture open their Inspect lens (spoke-host.js).
    wireDevices(svg, 'populate', ui);
    return true;
  }

  // In slot order - slot-0 first - rather than the index's, which lists them
  // top of the chassis down.
  function bays() {
    return (baysOf(DEV).front || []).filter(b => b.group === GROUP)
      .sort((a, b) => a.id.localeCompare(b.id, 'en', {numeric: true}));
  }

  // What a bay holds now: its override when there is one - null meaning it
  // was deliberately emptied, which is how Explorer reports a bay emptied in
  // the Inspect lens - and otherwise what the configuration gives it.
  function holding(b) {
    const ov = overrides[DEV] || {};
    return Object.hasOwn(ov, b.id) ? (ov[b.id] || null) : b.default;
  }

  // Bays with the same `accepts`, in slot order, each set headed by the role
  // its cards declare in the component index. Cards that disagree (or carry
  // no role) get a neutral heading rather than a guessed one.
  function sets(all) {
    const out = new Map();
    for (const b of all) {
      const key = [...(b.accepts || [])].sort().join(' ');
      if (!out.has(key)) out.set(key, []);
      out.get(key).push(b);
    }
    return [...out.values()].map(bays => {
      const roles = new Set((bays[0].accepts || []).filter(r => r !== COVER)
        .map(r => byRef(r)?.attrs?.role));
      const [role] = roles;
      const name = roles.size === 1 && role
        ? role.charAt(0).toUpperCase() + role.slice(1).replace(/-/g, ' ') + 's'
        : 'Modules';
      return {name, bays};
    });
  }

  // `ui` is the lease of the entry this panel belongs to (stage-rail.js).
  // Every control below closes over THAT lease, never the rail's global
  // epoch - so a change can only act for the entry that drew its control.
  function buildPanel(ui, message) {
    const all = bays();
    const busy = inFlight > 0;
    const had = document.activeElement?.closest?.('#sidePanel select[data-bay]')?.dataset.bay;
    readout = el('p', {class: 'panel-lead', 'data-readout': 'true',
      text: message || (busy ? 'Applying…' : 'Choose a card for any slot and it seats.')});
    if (busy) readout.dataset.busy = 'true';

    const groups = sets(all).map(({name, bays}) => el('div', {class: 'bay-set'}, [
      el('p', {class: 'bay-set-name', text: `${name} · ${bays.map(b => b.id).join(', ')}`}),
      ...bays.map(b => {
        const now = holding(b);
        const sel = el('select', {'data-bay': b.id, 'aria-label': `${b.id} holds`});
        const refs = (b.accepts || []).filter(r => r !== COVER);
        for (const ref of refs) sel.append(el('option', {value: ref, text: shortRef(ref)}));
        if ((b.accepts || []).includes(COVER)) {
          sel.append(el('option', {value: COVER, text: 'slot cover (no card)'}));
        }
        // Emptied in the lens: not a choice this stage offers, but the truth.
        if (now === null) sel.append(el('option', {value: '', text: 'empty'}));
        sel.value = now ?? '';
        sel.onchange = () => { if (sel.value) seat(ui, b, sel.value); };
        return el('label', {class: 'ctl-row', 'data-bay-row': b.id},
          [el('span', {class: 'mono', text: b.id}), sel]);
      }),
    ]));

    ui.setPanel(
      title('Stage 2 · Populate'),
      lead('<strong>What does this bay accept?</strong>'),
      lead('Each slot lists only the cards it accepts, read off the compiled index: the ASR-9006 knows its route processor slots from its line card slots.'),
      readout,
      ...groups,
    );
    if (had) panelSelect(had)?.focus();
  }
  const panelSelect = id => document.querySelector(`#sidePanel select[data-bay="${id}"]`);

  // The queued unit of work. `ui` is the lease of the panel the visitor
  // CHANGED (handed down by seat(), below), so it is judged by the entry that
  // drew the control - not by whatever is current when this runs, which can be
  // much later if it was queued behind another bay's rebuild. R18: the very
  // first thing this does is check whether that entry has already gone
  // stale, and if so it drops the seat entirely - no `overrides` write, no
  // rebuild, no panel update - on both the scene and no-scene paths, because
  // a queued item that survives exit() and paints anyway would setPanel()
  // over whatever stage is current by the time it runs. Returns what to
  // paint, or null when there is nothing worth painting. A ref the bay does
  // not accept is never written: the menu only offers accepted ones, so that
  // can only be a stale or forged value, and it is dropped.
  async function doSeat(bay, ref, ui) {
    if (!ui.live()) return null;
    if (!(bay.accepts || []).includes(ref)) {
      console.warn('[portrayal] stage 2: not accepted by', bay.id, ref);
      return null;
    }
    overrides[DEV] = overrides[DEV] || {};
    // A new card, so the old card's cages and plugs go with it: the plan fill
    // (stage 4) would otherwise leave slot-2/module/p0... seated on a card
    // that is no longer there.
    dropBelow(overrides[DEV], bay.id);
    overrides[DEV][bay.id] = ref;
    const said = `seated — ${bay.id}: ${ref === COVER ? 'slot cover' : shortRef(ref)}`;

    if (ui.mode === '2d') {
      // In this same queue slot, so the pictures land in change order.
      if (!await draw2d(ui)) return null;
      return {message: said};
    }
    const sc = scene;
    if (sc) {
      sc.setOverrides(DEV, overrides[DEV]);
      await sc.build();
      if (!ui.live() || scene !== sc) return null;
    }
    return {message: said};
  }

  // Every change enqueues rather than runs, through rack.js's shared rebuild
  // queue - that is what keeps two sc.build() calls from ever overlapping,
  // including one started by a DIFFERENT stage (stage 3 rebuilds the same
  // scene). buildPanel() only runs after inFlight has been decremented, so
  // whichever seat was queued LAST is also painted last, and once the queue
  // drains the panel reflects the final `overrides` no matter how the clicks
  // landed. A seat that is dropped still repaints, so the menus never keep
  // showing a choice that did not happen.
  function seat(ui, bay, ref) {
    inFlight++;
    enqueueRebuild(() => doSeat(bay, ref, ui))
      .catch(err => { console.warn('[portrayal] stage 2 seat failed', err); return null; })
      .then(result => {
        inFlight--;
        if (ui.live()) buildPanel(ui, result?.message);
      });
  }

  return {
    title: 'Populate',
    question: 'What does this bay accept?',
    async enter(ui) {
      const is3d = ui.mode === '3d';
      stageRack.hidden = is3d; stage3d.hidden = !is3d;
      ui.scrim('Mounting the cast…');
      await loadMeta();
      if (!ui.live()) return;

      if (is3d) {
        const stack = CAST.map(e => ({...e, chassis: chassisOf(e.ref)}));
        // Held locally until this entry is known to be live, as stage 1 does.
        const sc = await mount3d({stack, heightRU: RACK_U, overrides});
        if (!ui.live()) { sc?.dispose(); return; }
        scene = sc;
        // Only when a scene actually mounted - R11: the panel is built either
        // way, so a no-WebGL run still lets the visitor seat cards and read
        // what each slot accepts, just without the 3D picture.
        if (scene) ui.unscrim();
      } else {
        if (!await draw2d(ui)) return;
        ui.unscrim();
      }

      buildPanel(ui);
      // "Look closer" lives under the stage, not at the foot of the panel.
      // Once per entry: a seat rebuilds the panel, and the strip is unchanged.
      ui.strip();
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
}
