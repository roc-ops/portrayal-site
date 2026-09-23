// What a page on this site does with PLUGGABLES, shared by Explorer and Annotate.
//
// Portrayal's kit seats an optic in a port since #441: the port is a CAGE, what
// is in it lives in `state.cfgOccupants` beside `state.cfgBays`, and the shell's
// inspector already offers an `optic` menu. Two things the kit leaves to the
// page that hosts it, and that both our pages need identically:
//
//   swapsNow(shell)            what the reader changed from the build, bays and
//                              cages together, by swap.js's own rule
//   installOpticFields(shell)  controls for an optic's FIELDS - its latch colour
//                              and label - beneath the optic menu

import { swapOverrides as swapDelta } from '../vendor/swap.js';

const flat = o => Object.values(o || {}).flat();

/** Only what differs from what the configuration built - an override is a
 *  deviation, not a restatement. swap.js's rule, the one the kit's own page
 *  uses, so a page cannot drift from it by keeping a copy. */
export function swapsNow(shell) {
  const state = shell.state;
  return swapDelta({
    cfg: state.meta?.configs?.find(c => c.name === state.cfg),
    bays: flat(state.meta?.bays), cages: flat(state.meta?.cages),
    cfgBays: state.cfgBays, cfgOccupants: state.cfgOccupants,
  });
}

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * WHAT IS WRITTEN ON AN OPTIC. A seated optic declares fields (components.json
 * `fields`): the four generics carry a latch colour and a module label. The
 * shell can set them - setFields paints the 2D drawing by the build's own rule,
 * text and colour alike, and emits `fields` for a host to tell a 3D scene - and
 * offers no control for them, so they go here, beneath the optic menu, for
 * whatever optic is in the selected cage. The optic itself is
 * `<cage>-occupant` - swap.js occupantNames, whose PATH is that string for a
 * cage on a device face and for one on a seated card alike, even where the
 * drawing's id for the latter is namespaced into its carrier.
 *
 * `select` fires after the shell has drawn the inspector; `change` covers the
 * redraw after a swap. The rows are added once per drawn inspector.
 */
export function installOpticFields(shell) {
  const state = shell.state;

  function opticFields() {
    const box = shell.el.inspect;
    const pick = box?.querySelector('#optic');
    if (!pick || box.querySelector('.optic-fields')) return;
    const occ = `${pick.dataset.cage}-occupant`;
    // A DIFFERENT OPTIC STARTS FROM ITS OWN DEFAULTS, so a colour picked for
    // one part does not ride onto the next.
    pick.addEventListener('change', () => shell.setFields(occ, null));
    const ref = pick.value;
    const fields = ref ? shell.fieldsOf(ref) : {};
    const keys = Object.keys(fields);
    if (!keys.length) return;
    const cur = state.cfgFields?.[occ] || {};
    const wrap = document.createElement('div');
    wrap.className = 'optic-fields';
    for (const k of keys) {
      const f = fields[k] || {};
      // A colour is declared as text holding a hex value, so the default says
      // which control fits: a picker for a colour, a box for words.
      const colour = HEX.test(String(f.default || ''));
      const row = document.createElement('div');
      row.className = 'row';
      const name = document.createElement('span');
      name.textContent = (f.label || k).toLowerCase();
      const inp = document.createElement('input');
      inp.type = colour ? 'color' : 'text';
      inp.value = cur[k] ?? f.default ?? '';
      if (!colour) inp.placeholder = 'none';
      inp.onchange = () => shell.setFields(occ, {[k]: inp.value});
      row.append(name, inp);
      wrap.appendChild(row);
    }
    pick.closest('.row').after(wrap);
  }
  shell.on('select', () => queueMicrotask(opticFields));
  shell.on('change', () => queueMicrotask(opticFields));

  // THE COLOUR USED TO BE PAINTED HERE. It is not any more: kit/fields.js does
  // it, called from shell.js setFields for the 2D drawing and relief.js for the
  // documents the 3D scene rasterises, so one rule serves both -
  // roc-ops/Portrayal#481 and #482, and upstream-work/pluggable-fields-RESOLVED.md.
  // The stand-in that lived here was the build's rule written a second time, and
  // keeping it past the fix would have been worse than never having had it: it
  // stashed what the KIT had just painted as "what was drawn", so clearing a
  // colour restored the previous choice rather than the skin's own.
}

/** The controls' styles, for a page to drop into its own sheet. */
export const OPTIC_CSS = `
  .optic-fields input[type=text] { flex:1; min-width:0; font:inherit; }
  .optic-fields input[type=color] { width:2.2rem; height:1.3rem; padding:0; border:none;
                                    background:none; cursor:pointer; }`;
