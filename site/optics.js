// What a page on this site does with PLUGGABLES, shared by Explorer and Annotate.
//
// Portrayal's kit seats an optic in a port since #441: the port is a CAGE, what
// is in it lives in `state.cfgOccupants` beside `state.cfgBays`, and the shell's
// inspector already offers an `optic` menu. Two things the kit leaves to the
// page that hosts it, and that both our pages need identically:
//
//   swapsNow(shell)            what the reader changed from the build, bays and
//                              cages together, by swap.js's own rule
//   fieldsNow(shell)           what the reader WROTE ON those parts, for the
//                              share link's `fields` slot
//   encodeFields/decodeFields  the same map as ONE QUERY PARAMETER, for a page
//                              whose link is `?device=&config=&view=&swap=`
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

/**
 * WHAT THE READER WROTE ON THE PARTS, in the shape marks.js slot 8 takes and
 * `shell.setFields(path, vals)` replays: `{path: {key: value}}`, which is the
 * shell's own `state.cfgFields`. Copied rather than handed over, so a document
 * holding it does not alias live state and change under whoever is reading it.
 *
 * NO PRUNING HERE, deliberately. cfgFields gains a path only when a value is
 * written on it and setFields DELETES the path outright when it is cleared (or
 * when the optic below it changes), so an untouched drawing already answers
 * `{}`; and marks.js's own fieldsOf drops a path left with no keys. A second
 * rule here could only disagree with those two.
 */
export function fieldsNow(shell) {
  const out = {};
  for (const [path, vals] of Object.entries(shell.state.cfgFields || {}))
    out[path] = {...vals};
  return out;
}

/* A FIELD MAP AS ONE QUERY PARAMETER, the shape `?swap=` already uses one
 * level down. Annotate carries its fields in the m1 document, which has a slot
 * for them; Explorer's link is query parameters and the kit reads only `swap=`,
 * so this page needs the string.
 *
 *     fields=port-4-occupant:latch-color~%23c22f2f,port-4-occupant:label~LR4-A
 *
 * encodeSwaps's rules, one separator further: every token is
 * encodeURIComponent'd, which leaves only `A-Za-z0-9-_.!*'()` and `%XX` (and
 * `~` is escaped after, as it does), so `:` between a path and a key and `,`
 * between entries cannot appear inside one. Paths and keys are sorted, so one
 * state is one string.
 *
 * AN EMPTY VALUE IS NULL COMING BACK, which is decodeSwaps's rule and costs
 * nothing here: fields.js paints `null` and `''` identically - its own
 * docstring says "both are empty" - so the only thing the collapse could lose
 * is a distinction nothing downstream draws.
 */
const encTok = s => encodeURIComponent(s).replace(/~/g, '%7E');
const sorted = o => Object.keys(o || {}).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);

export function encodeFields(map) {
  if (!map || typeof map !== 'object') return '';
  const out = [];
  for (const path of sorted(map)) {
    const vals = map[path];
    if (!vals || typeof vals !== 'object') continue;
    for (const key of sorted(vals)) {
      const v = vals[key];
      out.push(`${encTok(path)}:${encTok(key)}~${v == null ? '' : encTok(String(v))}`);
    }
  }
  return out.join(',');
}

/** NEVER THROWS, and one bad entry does not take the rest with it - a link is
 *  typed, pasted and truncated by people, and the worst a `fields=` may do is
 *  be ignored. decodeSwaps's rule, applied to both halves of the key. */
export function decodeFields(s) {
  const out = {};
  if (typeof s !== 'string' || !s) return out;
  for (const part of s.split(',')) {
    const t = part.indexOf('~');
    if (t <= 0 || part.indexOf('~', t + 1) >= 0) continue;
    const c = part.indexOf(':');
    // exactly one of each, in order: a token cannot contain either, so anything
    // else is not this shape - decodeSwaps drops a second `~` the same way
    if (c <= 0 || c > t || part.indexOf(':', c + 1) >= 0) continue;
    let path, key, val;
    try {
      path = decodeURIComponent(part.slice(0, c));
      key = decodeURIComponent(part.slice(c + 1, t));
      val = decodeURIComponent(part.slice(t + 1));
    } catch (e) { continue; }
    if (!path || !key || path === '__proto__' || key === '__proto__') continue;
    (out[path] || (out[path] = {}))[key] = val || null;
  }
  return out;
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
    // THE KIT DRAWS A PART'S OWN FIELDS SINCE PORTRAYAL #817: select the optic
    // itself and the shell's inspector already holds a control per field, for
    // this same path. The rows below would be the same fields a second time.
    // The CAGE's row is still this function's: a cage declares no fields, the
    // kit draws none there, and that is where a reader picks the optic.
    if (state.sel === occ && box.querySelector('[data-field]')) return;
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
      // A PICKER PAINTS AS IT IS MOVED. It sends `change` only when it is
      // dismissed - on macOS, when the colour panel is closed - so a colour
      // waiting for `change` showed nothing while the reader chose it. The
      // kit's own highlight picker listens the same way; the 3D scene's
      // setFields coalesces, so a drag of updates costs one repaint. Words
      // still land on `change`, once they are typed.
      if (colour) inp.oninput = () => shell.setFields(occ, {[k]: inp.value});
      else inp.onchange = () => shell.setFields(occ, {[k]: inp.value});
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

  // WHAT IS WRITTEN SURVIVES A RELOAD, which the kit does not yet make true.
  // A fresh face is the build: shell.js reseat() says so and seats every swap
  // again from `state.touched` before it emits `load`. The FIELDS are not in
  // that build either and nothing replays them, so front, rear, front comes
  // back with the optic in the cage and its latch the default grey - the state
  // still holds the colour and a link still carries it, and only the drawing
  // has stopped agreeing with both. Filed as
  // upstream-work/fields-not-replayed.md.
  //
  // Replayed through the kit's own setFields, not painted here: that is the
  // call the controls above make, so colour and text come back by the one rule
  // - the whole point of #481 having moved that rule into the kit. This goes
  // when reseat() replays them itself.
  shell.on('load', () => {
    for (const [path, vals] of Object.entries(shell.state.cfgFields || {}))
      shell.setFields(path, vals);
  });
}

/** The controls' styles, for a page to drop into its own sheet. */
export const OPTIC_CSS = `
  .optic-fields input[type=text] { flex:1; min-width:0; font:inherit; }
  .optic-fields input[type=color] { width:2.2rem; height:1.3rem; padding:0; border:none;
                                    background:none; cursor:pointer; }`;
