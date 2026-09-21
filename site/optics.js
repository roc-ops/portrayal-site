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
//                              and label - beneath the optic menu, and the live
//                              paint of the colour in the drawing

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
 * shell can set them - setFields writes the 2D drawing and emits `fields` for a
 * host to tell a 3D scene - and offers no control for them, so they go here,
 * beneath the optic menu, for whatever optic is in the selected cage. The optic
 * itself is `<cage>-occupant`, a top-level sibling of its port (swap.js
 * occupantAttrs, render.py seat_at).
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

  // THE COLOUR, PAINTED LIVE. A part's colour is a field too: its node carries
  // `data-fill-from="latch-color"`, and render.py's fill_from_attrs sets the
  // node's `fill` from it - AT BUILD TIME. At runtime the kit's setFields (2D)
  // and relief.js applyNodeFields (3D) write only text (`data-from`), so a
  // colour chosen here changed nothing. Until the kit paints it, the drawing's
  // half is done here by the build's own rule: a value sets `fill` on
  // `data-fill-from` and `stroke` on `data-stroke-from`, and an empty one
  // restores what was drawn. 3D waits on the kit - upstream-work/pluggable-fields.md.
  function paintFields() {
    const svg = state.svg;
    if (!svg) return;
    for (const [path, vals] of Object.entries(state.cfgFields || {}))
      for (const host of svg.querySelectorAll(`[data-path="${CSS.escape(path)}"]`))
        for (const [k, v] of Object.entries(vals || {}))
          for (const [attr, from] of [['fill', 'data-fill-from'], ['stroke', 'data-stroke-from']])
            for (const node of host.querySelectorAll(`[${from}="${CSS.escape(k)}"]`)) {
              const drawn = `data-drawn-${attr}`;
              if (!node.hasAttribute(drawn)) node.setAttribute(drawn, node.getAttribute(attr) || '');
              const val = v == null ? '' : String(v).trim();
              node.setAttribute(attr, val || node.getAttribute(drawn));
            }
  }
  for (const ev of ['fields', 'load', 'change']) shell.on(ev, paintFields);
}

/** The controls' styles, for a page to drop into its own sheet. */
export const OPTIC_CSS = `
  .optic-fields input[type=text] { flex:1; min-width:0; font:inherit; }
  .optic-fields input[type=color] { width:2.2rem; height:1.3rem; padding:0; border:none;
                                    background:none; cursor:pointer; }`;
