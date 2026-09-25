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
    readout = el('p', {class: 'panel-lead', text: message || 'Pick a bay and a card, then seat it.'});
    if (refused) readout.dataset.refused = 'true';

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

  async function seat(bay, ref) {
    if (!(bay.accepts || []).includes(ref)) {
      const accepts = (bay.accepts || []).filter(r => r !== COVER).map(shortRef).join(', ');
      buildPanel(`refused — ${bay.id} accepts: ${accepts}. ${shortRef(ref)} is not in that list.`, true);
      return;
    }
    overrides[DEV] = overrides[DEV] || {};
    overrides[DEV][bay.id] = ref;

    const sc = scene;
    if (sc) {
      const mine = epoch;
      sc.setOverrides(DEV, overrides[DEV]);
      await sc.build();
      if (stale(mine) || scene !== sc) return;
    }
    buildPanel(`seated — ${bay.id}: ${shortRef(ref)}`, false);
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
