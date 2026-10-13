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
//   installOpticFields(shell)  controls for an optic's FIELDS - its latch color
//                              and label - beneath the optic menu, and one
//                              swatch-and-hex control for every color field

import { swapOverrides as swapDelta } from '../vendor/swap.js';
import { american, normalizeHex, isColorField, ownerOf, colorControl, COLOR_CSS, LATCH_PRESETS } from './colors.js';

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

/**
 * WHAT IS WRITTEN ON AN OPTIC. A seated optic declares fields (components.json
 * `fields`): the four generics carry a latch color and a module label. The
 * shell can set them - setFields paints the 2D drawing by the build's own rule,
 * text and color alike, and emits `fields` for a host to tell a 3D scene - and
 * offers them as text boxes in its inspector. This adds, for whatever optic is
 * in the selected cage, a row under the optic menu, and turns every color field
 * the inspector draws into the one control colorControl makes.
 *
 * THE OPTIC ITSELF is `<cage>-occupant` - swap.js occupantNames, whose PATH is
 * that string for a cage on a device face and for one on a seated card alike,
 * even where the drawing's id for the latter is namespaced into its carrier.
 *
 * ONE FIELD, WRITTEN IN ONE PLACE. The pull tab drawn inside an optic is a part
 * of its own (`<optic>/tab`, common/qsfp-pull-tab) that declares a `latch-color`
 * too and is wired to the same nodes, so selecting the tab offered a second
 * home for the optic's color and the two held different values. The nearest
 * enclosing part that declares a key owns it: every control writes there, and a
 * value that reaches the nested part by any other road (a link, a saved rack,
 * the kit's own text box) is moved to the owner.
 */
export function installOpticFields(shell) {
  const state = shell.state;
  const doc = document;

  const faceRoots = () => [state.svg, ...Object.values(state.faces || {})].filter(Boolean);
  const partEl = path => {
    for (const r of faceRoots()) {
      const e = r.querySelector(`[data-path="${CSS.escape(path)}"][data-ref]`);
      if (e) return e;
    }
    return null;
  };
  const declared = (path, key) => {
    const ref = partEl(path)?.dataset.ref?.split(':')[0];
    if (!ref) return null;
    try { return shell.fieldsOf(ref)?.[key] ?? null; } catch (e) { return null; }
  };
  const ownerFor = (path, key) => ownerOf(path, key, (p, k) => declared(p, k) != null);
  // What the drawing holds: this session's value, else what the build wrote on
  // the part's group.
  const heldAt = (path, key) => state.cfgFields?.[path]?.[key]
    ?? partEl(path)?.getAttribute(`data-${key}`) ?? undefined;
  const isSetAt = (path, key) => Object.prototype.hasOwnProperty.call(state.cfgFields?.[path] || {}, key);

  // One color field: the control for `key` of the part at `path`.
  function colorFieldFor(path, key, decl, label) {
    const ctl = colorControl(doc, {
      value: heldAt(path, key) || decl.default, fallback: decl.default, isSet: isSetAt(path, key), label,
      presets: key === 'latch-color' ? LATCH_PRESETS : null,
      onSet: v => {
        shell.setFields(path, {[key]: v});
        // a value an older link left on a part inside this one is not a second copy
        for (const p of Object.keys(state.cfgFields || {}))
          if (p.startsWith(`${path}/`) && isSetAt(p, key) && ownerFor(p, key) === path) shell.resetField(p, key);
      },
      onReset: () => shell.resetField(path, key),
    });
    return ctl;
  }

  // THE PART THE INSPECTOR IS SHOWING: the selected element when it carries a
  // component, else the module seated in it (the shell's own fieldPart).
  function shownPart() {
    if (state.sel == null) return null;
    const sel = faceRoots().map(r => r.querySelector(`[data-path="${CSS.escape(state.sel)}"]`)).find(Boolean);
    const own = sel?.dataset?.ref ? sel : sel?.querySelector?.('[data-ref][data-path]');
    const path = own?.getAttribute('data-path');
    const ref = own?.dataset.ref?.split(':')[0];
    return path && ref ? {path, ref} : null;
  }

  // THE KIT'S ROWS, IN THIS SITE'S WORDS AND THIS SITE'S CONTROL. Idempotent:
  // the inspector is redrawn wholesale, so every pass meets fresh rows.
  function upgradeRows() {
    const box = shell.el.inspect;
    if (!box) return;
    const part = shownPart();
    for (const inp of box.querySelectorAll('[data-field]:not([data-upgraded])')) {
      inp.dataset.upgraded = '1';
      const row = inp.closest('.row');
      const label = row?.querySelector('span');
      if (label) label.textContent = american(label.textContent);
      if (row?.title) row.title = american(row.title);
      if (!part || inp.tagName !== 'INPUT') continue;
      const key = inp.dataset.field;
      let decl = null;
      try { decl = shell.fieldsOf(part.ref)?.[key]; } catch (e) { /* not a component */ }
      if (!isColorField(decl)) continue;
      const owner = ownerFor(part.path, key);
      const ctl = colorFieldFor(owner, key, decl, label?.textContent || key);
      for (const x of row.querySelectorAll('[data-field],[data-reset]')) x.remove();
      (label || row).after(ctl.el);
      // the swatch and the box are this field's; the kit's own are gone
      ctl.el.dataset.field = key;
      ctl.el.dataset.owner = owner;
    }
  }

  function opticFields() {
    const box = shell.el.inspect;
    const pick = box?.querySelector('#optic');
    if (!pick || box.querySelector('.optic-fields')) return;
    const occ = `${pick.dataset.cage}-occupant`;
    // A DIFFERENT OPTIC STARTS FROM ITS OWN DEFAULTS, so a color picked for
    // one part does not ride onto the next.
    if (!pick.dataset.clears) {
      pick.dataset.clears = '1';
      pick.addEventListener('change', () => shell.setFields(occ, null));
    }
    const ref = pick.value;
    const fields = ref ? shell.fieldsOf(ref) : {};
    const wrap = doc.createElement('div');
    wrap.className = 'optic-fields';
    // WHAT THE PANEL ALREADY OFFERS IS NOT OFFERED TWICE: select the optic, or
    // a part inside it, and the kit's own row for the field is here, upgraded
    // to the same control and writing to the same owner.
    const shown = shownPart();
    const offered = new Set(shown ? [...box.querySelectorAll('[data-field]')]
      .map(i => i.dataset.field).filter(k => ownerFor(shown.path, k) === occ) : []);
    for (const k of Object.keys(fields)) {
      if (offered.has(k)) continue;
      const f = fields[k] || {};
      const label = american(f.label || k);
      const row = doc.createElement('div');
      row.className = 'row';
      const name = doc.createElement('span');
      name.textContent = label.toLowerCase();
      row.appendChild(name);
      if (isColorField(f)) {
        row.appendChild(colorFieldFor(occ, k, f, label).el);
      } else {
        const inp = doc.createElement('input');
        inp.type = 'text';
        inp.value = state.cfgFields?.[occ]?.[k] ?? f.default ?? '';
        inp.placeholder = 'none';
        // Words land on `change`, once they are typed.
        inp.addEventListener('change', () => shell.setFields(occ, {[k]: inp.value}));
        row.appendChild(inp);
      }
      wrap.appendChild(row);
    }
    if (wrap.children.length) pick.closest('.row').after(wrap);
  }

  const refresh = () => { upgradeRows(); opticFields(); };
  if (shell.el.inspect) new MutationObserver(() => queueMicrotask(refresh)).observe(shell.el.inspect, {childList: true});
  shell.on('select', () => queueMicrotask(refresh));
  shell.on('change', () => queueMicrotask(refresh));

  // A VALUE THAT LANDS ON A PART INSIDE ANOTHER THAT OWNS THE KEY MOVES TO THE
  // OWNER. Whatever wrote it - the kit's text box, `fields=` on a link, a saved
  // rack, a replay - there is one stored value, and it is the owner's. The
  // nested copy is put back first, or its restore would paint over the owner's.
  shell.on('fields', ({path} = {}) => {
    const mine = state.cfgFields?.[path];
    if (!mine) return;
    for (const key of Object.keys(mine)) {
      const owner = ownerFor(path, key);
      if (owner === path) continue;
      const v = mine[key];
      shell.resetField(path, key);
      if (v == null || v === '') shell.resetField(owner, key);
      else shell.setFields(owner, {[key]: v});
    }
  });

  // THE KIT'S HIGHLIGHT PICKER listens for `input` alone (vendor/shell.js
  // mountHl), so a picker that reports only when it closes changes nothing.
  // Replay its close as the `input` it waits for; a picker that sent both
  // repeats a value already set. Its hex box is beside it, and the two follow
  // each other: the page's `hl` event says what the highlight now is.
  const hl = doc.querySelector('#hl');
  const hlPick = hl?.querySelector('input[type=color]');
  if (hlPick) {
    hl.title = american(hl.title);
    hlPick.addEventListener('change', e =>
      e.target.dispatchEvent(new Event('input', {bubbles: true})));
    const hex = doc.createElement('input');
    hex.type = 'text';
    hex.className = 'hex';
    hex.size = 8;
    hex.maxLength = 7;
    hex.spellcheck = false;
    hex.setAttribute('aria-label', 'Selection color (hex)');
    hex.title = 'Selection color (hex)';
    const follow = c => { const n = normalizeHex(c); if (n) hex.value = n; };
    follow(getComputedStyle(doc.documentElement).getPropertyValue('--hl').trim() || hlPick.value);
    hex.addEventListener('input', () => {
      const n = normalizeHex(hex.value);
      if (!n || !/^#?[0-9a-f]{6}$/i.test(hex.value.trim())) return;
      hlPick.value = n;
      hlPick.dispatchEvent(new Event('input', {bubbles: true}));
    });
    hex.addEventListener('change', () => follow(hlPick.value));
    hl.appendChild(hex);
    shell.on('hl', c => { follow(c); });
  }

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
export const OPTIC_CSS = `${COLOR_CSS}
  .optic-fields input[type=text] { flex:1; min-width:0; font:inherit; }
  .optic-fields .colorfield input.hex { flex:none; }
  #hl input.hex { font:inherit; font-family:ui-monospace,monospace; width:6.5em; min-width:0; margin-left:.3rem; }`;
