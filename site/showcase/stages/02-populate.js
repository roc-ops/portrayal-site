// Stage 2 - Populate. "What does this bay accept?"
//
// The refusal is the whole point of the stage. A bay's accepted list comes
// from the compiled index (rack.js's baysOf), never from an array written in
// this file - a hardcoded list here would be the page inventing the answer it
// is meant to demonstrate. check-contract.py enforces both halves of that:
// baysOf must be read, and no inline accepted-list array may appear below.
//
// The candidates offered for a bay are the UNION of `accepts` over every bay
// in the same group (`slots`) on the ASR-9006, not a hand-picked incompatible
// part. slot-0 and slot-1 (route processors) and slot-2 through slot-5 (line
// cards) share one group, so offering a line card to slot-0 - or an RSP to
// slot-3 - is a real refusal: the candidate is real hardware for THIS device,
// just not for that bay. Acceptance is enforced by testing membership in the
// bay's own `accepts` array below; setState is not involved in that decision
// (R5) - it only marks a declared visual state on a 2D element, and this
// stage works the 3D rack, not the 2D drawing.
//
// Verified against assets/dist/asr-9006.configs.json's .bays.front:
//   slot-0/slot-1 accept only a9k-rsp880-{se,tr,lt-se,lt-tr} + the slot cover
//   slot-2..slot-5 accept only line cards (a9k-16x100ge-tr, a9k-4x100ge-se,
//   a9k-8x100ge-se, ...) + the slot cover

import {stage3d, stageRack, loading, el, title, lead, kv, setPanel}
  from '../artifact.js';
import {CAST, RACK_U, loadMeta, chassisOf, baysOf, overrides, mount3d, shortRef}
  from '../rack.js';
import {epoch, stale} from '../stage-rail.js';

const DEV = 'asr-9006';
const GROUP = 'slots';
const COVER = 'cisco/a9k-slot-cover@1';

export default function makePopulate() {
  let scene = null;
  let readout = null;
  // Seats are serialized through this chain. rack3d.js's build() has no
  // reentrancy guard of its own - buildAll() clears its `mounted` array and
  // disposes the previous meshes SYNCHRONOUSLY before its first await, then
  // resolves the rest across several awaits. A second build() starting while
  // the first is still mid-await would clear and repopulate the very arrays
  // the first call is still writing into: two seats fired back to back (a
  // double-click, or one bay's button while another bay's rebuild is still in
  // flight) is exactly that, since the old buttons stay live during `await
  // sc.build()`. Queuing every seat() behind the one before it means only one
  // sc.build() is ever in flight, writes to `overrides` land and are painted
  // in the order they were requested, and the final panel always matches the
  // final `overrides` regardless of how the awaits interleaved.
  let queue = Promise.resolve();
  let inFlight = 0;

  function bays() {
    return (baysOf(DEV).front || []).filter(b => b.group === GROUP);
  }

  // The group's full range, minus the slot cover every bay already defaults
  // to and isn't interesting to offer back.
  function union(all) {
    return [...new Set(all.flatMap(b => b.accepts || []))]
      .filter(ref => ref !== COVER)
      .sort();
  }

  function buildPanel(message, refused) {
    const all = bays();
    const candidates = union(all);
    const busy = inFlight > 0;
    readout = el('p', {class: 'panel-lead', 'data-readout': 'true',
      text: message || (busy ? 'Applying…' : 'Pick a bay and a card, then seat it.')});
    if (refused) readout.dataset.refused = 'true';
    if (busy) readout.dataset.busy = 'true';

    const bayRows = all.map(b => {
      const sel = el('select', {'data-bay': b.id});
      for (const ref of candidates) sel.append(el('option', {value: ref, text: shortRef(ref)}));
      const btn = el('button', {type: 'button', 'data-bay': b.id, text: `Seat in ${b.id}`});
      btn.onclick = () => seat(b, sel.value);
      return el('div', {class: 'ctl-row', 'data-bay-row': b.id},
        [el('span', {class: 'mono', text: b.id}), sel, btn]);
    });

    const seatedRows = all.map(b => {
      const mine = overrides[DEV]?.[b.id];
      return [b.id, mine ? shortRef(mine) : shortRef(b.default)];
    });

    setPanel(
      title('Stage 2 · Populate'),
      lead('<strong>What does this bay accept?</strong>'),
      lead('slot-0 and slot-1 take route processors; slot-2 through slot-5 take line cards. The list below is each bay’s own `accepts`, read off the compiled index - choose a card and the bay either seats it or refuses it on that basis.'),
      kv(all.map(b => [b.id, `accepts: ${(b.accepts || []).filter(r => r !== COVER).map(shortRef).join(', ')}`])),
      ...bayRows,
      readout,
      kv(seatedRows),
    );
  }

  // The queued unit of work. Returns what to paint, or null when the stage
  // moved on mid-await and there is nothing left worth painting - never
  // touches `overrides` on the refusal path.
  async function doSeat(bay, ref) {
    if (!(bay.accepts || []).includes(ref)) {
      const accepts = (bay.accepts || []).filter(r => r !== COVER).map(shortRef).join(', ');
      return {message: `refused — ${bay.id} accepts: ${accepts}. ${shortRef(ref)} is not in that list.`,
              refused: true};
    }
    overrides[DEV] = overrides[DEV] || {};
    overrides[DEV][bay.id] = ref;

    const sc = scene;
    if (sc) {
      const mine = epoch;
      sc.setOverrides(DEV, overrides[DEV]);
      await sc.build();
      if (stale(mine) || scene !== sc) return null;
    }
    return {message: `seated — ${bay.id}: ${shortRef(ref)}`, refused: false};
  }

  // Every click enqueues rather than runs - the chain is what keeps two
  // sc.build() calls from ever overlapping. buildPanel() only runs after
  // inFlight has been decremented, so whichever seat was queued LAST is also
  // painted last, and once the chain drains the panel reflects the final
  // `overrides` no matter how the clicks landed.
  function seat(bay, ref) {
    inFlight++;
    queue = queue
      .then(() => doSeat(bay, ref))
      .catch(err => { console.warn('[portrayal] stage 2 seat failed', err); return null; })
      .then(result => {
        inFlight--;
        if (result) buildPanel(result.message, result.refused);
      });
  }

  return {
    title: 'Populate',
    question: 'What does this bay accept?',
    async enter() {
      const mine = epoch;
      stageRack.hidden = true; stage3d.hidden = false;
      loading.hidden = false; loading.textContent = 'Mounting the cast…';
      await loadMeta();
      if (stale(mine)) return;

      const stack = CAST.map(e => ({...e, chassis: chassisOf(e.ref)}));
      scene = await mount3d({stack, heightRU: RACK_U, overrides});
      if (stale(mine)) { scene?.dispose(); scene = null; return; }
      // Only when a scene actually mounted - R11: the panel is built either
      // way, so a no-WebGL run still lets the visitor seat cards and see the
      // refusal, just without the 3D picture.
      if (scene) loading.hidden = true;

      buildPanel();
    },
    exit() {
      scene?.dispose();
      scene = null;
      stage3d.hidden = true;
      stage3d.replaceChildren();
    },
  };
}
