// A COLOR FIELD, AS ONE CONTROL, and the spelling a visitor reads it in.
//
// The kit offers a part's fields as text boxes, and this site added a picker
// beside them for an optic's latch color; the two were wired to different
// parts and read different values (see optics.js ownerOf). Every color field
// on every page now goes through colorControl: a swatch that opens the picker,
// the hex beside it, and a reset - one value, shown twice, kept in step both
// ways.

const HEX6 = /^#[0-9a-f]{6}$/i;
const HEX3 = /^#[0-9a-f]{3}$/i;

/** US spelling for what a visitor or an agent reads. The kit's field labels and
 *  descriptions come out of the library's data in British spelling; saved keys
 *  (`latch-color`) were never spelt that way and are not touched. */
export const american = s => typeof s === 'string'
  ? s.replace(/colour/g, 'color').replace(/Colour/g, 'Color').replace(/COLOUR/g, 'COLOR')
  : s;

/** '#rrggbb' in lower case for '#rrggbb' or '#rgb' (the '#' optional), else
 *  null. A native color input holds nothing else. */
export function normalizeHex(v) {
  let s = String(v ?? '').trim();
  if (s && s[0] !== '#') s = `#${s}`;
  if (HEX6.test(s)) return s.toLowerCase();
  if (HEX3.test(s)) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`.toLowerCase();
  return null;
}

/** A field a color control fits: declared as text whose default is a hex. */
export const isColorField = f => HEX6.test(String(f?.default ?? ''));

/**
 * WHO OWNS A FIELD. A part drawn inside another (an optic's pull tab) can
 * declare a field of the same name as the part around it (`latch-color`) and be
 * wired to the same nodes, so the same color had two homes: the optic's and the
 * tab's. The nearest ancestor that declares the key owns it; the part itself
 * when none does. `declares(path, key)` answers for one path.
 */
export function ownerOf(path, key, declares) {
  const segs = String(path).split('/');
  for (let i = segs.length - 1; i >= 1; i--) {
    const anc = segs.slice(0, i).join('/');
    if (declares(anc, key)) return anc;
  }
  return path;
}

/**
 * The control. o: {value, fallback, isSet, label, onSet(hex), onReset()}.
 * Returns {el, set(value, isSet)}: `set` is how the page tells it what the
 * drawing now holds.
 *
 * THE PICKER WRITES ON `input` AND ON `change`. A picker sends `input` while
 * the reader drags and `change` when it closes (on macOS, when the color panel
 * is closed); some send `change` alone. Both write, and the close repeats the
 * last value. THE HEX WRITES AS SOON AS IT IS SIX DIGITS; three digits wait for
 * the box to be left, so typing '#abcdef' does not pass through '#abc'. A box
 * left holding something that is not a color goes back to the swatch's value.
 */
export function colorControl(doc, o) {
  const el = doc.createElement('span');
  el.className = 'colorfield';
  const swatch = doc.createElement('input');
  swatch.type = 'color';
  swatch.className = 'swatch';
  const hex = doc.createElement('input');
  hex.type = 'text';
  hex.className = 'hex';
  hex.size = 8;
  hex.maxLength = 7;
  hex.spellcheck = false;
  hex.autocomplete = 'off';
  if (o.label) { swatch.title = hex.title = o.label; swatch.setAttribute('aria-label', o.label);
                 hex.setAttribute('aria-label', `${o.label} (hex)`); }
  const reset = doc.createElement('button');
  reset.type = 'button';
  reset.className = 'reset';
  reset.textContent = '↺';
  reset.title = 'back to the default';
  el.append(swatch, hex, reset);
  // PRESETS: one click is the same as typing that hex. The browser's own panel
  // can leave a color grey when only its hue slider moves; these cannot.
  if (o.presets?.length) {
    const row = doc.createElement('span');
    row.className = 'presets';
    for (const p of o.presets) {
      const b = doc.createElement('button');
      b.type = 'button';
      b.className = 'preset';
      b.dataset.hex = p.hex;
      b.style.background = p.hex;
      b.title = p.name;
      b.setAttribute('aria-label', `${o.label || 'Color'}: ${p.name}`);
      b.addEventListener('click', () => { const n = normalizeHex(p.hex); if (n) write(n); });
      row.appendChild(b);
    }
    el.appendChild(row);
  }

  const fallback = normalizeHex(o.fallback) ?? '#000000';
  let held = null;
  function show(v, isSet) {
    const n = normalizeHex(v) ?? fallback;
    swatch.value = n;
    hex.value = n;
    reset.hidden = !isSet;
    held = n;
    return n;
  }
  function write(n) {
    if (n === held && !reset.hidden) return;
    show(n, true);
    o.onSet(n);
  }
  swatch.addEventListener('input', () => write(normalizeHex(swatch.value)));
  swatch.addEventListener('change', () => write(normalizeHex(swatch.value)));
  hex.addEventListener('input', () => {
    const n = HEX6.test(hex.value.trim()) || HEX6.test(`#${hex.value.trim()}`) ? normalizeHex(hex.value) : null;
    if (!n) return;
    swatch.value = n;
    write(n);
  });
  hex.addEventListener('change', () => {
    const n = normalizeHex(hex.value);
    if (n) write(n); else hex.value = swatch.value;
  });
  reset.addEventListener('click', () => { show(fallback, false); o.onReset(); });
  show(o.value, o.isSet);
  return {el, set: show};
}

/** The controls' styles, for a page to drop into its own sheet. */
export const COLOR_CSS = `
  .colorfield { display:inline-flex; align-items:center; gap:.3rem; }
  .colorfield input.swatch { width:2.2rem; height:1.3rem; padding:0; border:none;
                             background:none; cursor:pointer; }
  .colorfield input.hex { font:inherit; font-family:ui-monospace,monospace; width:6.5em; min-width:0; }
  .colorfield button.reset { font:inherit; padding:0 .3rem; cursor:pointer; }
  .colorfield button.reset[hidden] { display:none; }
  .colorfield .presets { display:inline-flex; gap:.2rem; flex-wrap:wrap; }
  .colorfield button.preset { width:1.1rem; height:1.1rem; padding:0; border:1px solid #888;
                              border-radius:50%; cursor:pointer; }
  .colorfield button.preset:hover, .colorfield button.preset:focus-visible { outline:2px solid currentColor; outline-offset:1px; }`;

/** Named by color alone; no optic type is claimed for any of them. */
export const LATCH_PRESETS = [
  {name: 'blue', hex: '#2f6fd6'}, {name: 'beige', hex: '#d8c8a4'}, {name: 'red', hex: '#c22f2f'},
  {name: 'green', hex: '#2fa84f'}, {name: 'yellow', hex: '#f2d02e'}, {name: 'black', hex: '#1a1a1a'},
  {name: 'default grey', hex: '#6f6f6f'},
];
