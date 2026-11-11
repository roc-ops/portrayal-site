// kit/rack/displays.js
// WHAT A DISPLAY IN THE RACK SHOWS (docs/display-content-design.md). An item
// and a part beside the rack each carry `displays`, a map of part path to
// content, as they carry `states`. The file keeps what it was given; what a
// drawing is handed is checked here against the displays the device really has,
// which parseDoc cannot see. Pure: no DOM, no fetch. `ctx` is what the other
// rack modules take: `slotsOf` and `compByRef` from `loadSlots`, `chassisOf`.

import {configFacts} from './catalog.js';
import {zeroUOf} from './model.js';
import {slotEnv, slotTree, partOf} from './slots.js';
import {displayRecords, contentRefusal, contentNotes, TAKES} from '../displays.js';

const plain = v => !!v && typeof v === 'object' && !Array.isArray(v);
const nameOf = (entry, ctx) => entry.label || ctx?.chassisOf?.(entry.ref)?.model || entry.ref || entry.id;
const orList = names => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`);

/**
 * The displays of a placed device or a part beside the rack: [{path, kind,
 * columns, rows, window, digits?}], those it places itself (its configuration's
 * `displays`) and those of what its bays hold under its swaps. null when the
 * parts list of the device has not been loaded, [] when it has no display
 * that says its kind.
 */
export function displaysOf(entry, ctx = {}) {
  const slots = typeof ctx.slotsOf === 'function' ? ctx.slotsOf(entry.ref) : null;
  if (!slots || slots.error) return null;
  const facts = configFacts(slots, entry.cfg);
  const out = [];
  for (const [part, elements] of Object.entries(facts?.displays || {})) out.push(...displayRecords(part, elements));
  if (slots.bays || slots.cages) {
    const env = slotEnv(entry, slots, ctx.compByRef, ctx.redirects);
    for (const b of slotTree(env, entry.swaps || {}).bays) {
      const there = partOf(ctx.compByRef, b.holds);
      if (there?.displays) out.push(...displayRecords(`${b.path}/module`, there.displays));
    }
  }
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** The words for what a display is: "a pixel display (text or an image, 19 columns)". */
export function displayText(d) {
  const takes = TAKES[d.kind].map(t => ({text: 'text', digits: 'digits', image: 'an image'}[t]));
  const size = d.kind === 'segment' ? `${d.columns} digit${d.columns === 1 ? '' : 's'}`
    : `${d.columns} column${d.columns === 1 ? '' : 's'}${d.rows ? ` by ${d.rows} row${d.rows === 1 ? '' : 's'}` : ''}`;
  return `${d.kind === 'segment' ? 'a segment' : `a${d.kind === 'pixel' ? ' pixel' : ' character'}`} display (${orList(takes)}, ${size})`;
}

// One content on one path of an entry: null when it can be that, else the sentence.
export function displayRefusal(entry, path, content, ctx = {}) {
  const have = displaysOf(entry, ctx);
  const name = nameOf(entry, ctx);
  if (have == null) return null;
  const d = have.find(x => x.path === path);
  if (!d) {
    return have.length
      ? `${path} on ${name} is not a display. Its displays are ${orList(have.map(x => x.path))}.`
      : `${path} on ${name} is not a display, and ${name} has none that says what kind it is.`;
  }
  return contentRefusal(d, content, `${path} on ${name}`);
}

/**
 * THE DISPLAYS TO HAND A DRAWING for one entry: {path: content}, only those
 * that are displays of the device and can show what they are given. With no
 * facts nothing can be checked, so nothing is applied. An image that is a
 * library asset is handed on as it is; `loadDisplayImages` makes it a picture.
 */
export function displaysFor(entry, ctx = {}) {
  if (!plain(entry?.displays)) return {};
  const have = displaysOf(entry, ctx);
  if (!have) return {};
  return Object.fromEntries(Object.entries(entry.displays)
    .filter(([path, content]) => { const d = have.find(x => x.path === path); return d && !contentRefusal(d, content); }));
}

/**
 * WHAT IS KEPT AND NOT APPLIED, AND WHAT IS CUT OR FITTED, one sentence each,
 * for every item and part beside the rack whose device facts are loaded. The
 * rack is not changed, since nothing here is a repair.
 */
export function displayNotices(rack, ctx = {}) {
  const out = [];
  for (const entry of [...(rack.items || []), ...zeroUOf(rack)]) {
    if (!plain(entry.displays)) continue;
    const have = displaysOf(entry, ctx);
    if (!have) continue;
    const name = nameOf(entry, ctx);
    for (const [path, content] of Object.entries(entry.displays)) {
      const no = displayRefusal(entry, path, content, ctx);
      if (no) { out.push(no); continue; }
      out.push(...contentNotes(have.find(x => x.path === path), content, `${path} on ${name}`));
    }
  }
  return out;
}

/**
 * Every display in the rack and what it shows, for an agent: [{item, path, kind,
 * columns, rows, shows}] where `shows` is the content set or null. `item`
 * limits it to one. A device whose parts list is not loaded is skipped.
 */
export function displayList(rack, ctx = {}, item = null) {
  const out = [];
  for (const entry of [...(rack.items || []), ...zeroUOf(rack)]) {
    if (item != null && entry.id !== item) continue;
    for (const d of displaysOf(entry, ctx) || [])
      out.push({item: entry.id, path: d.path, kind: d.kind, columns: d.columns, rows: d.rows,
                takes: TAKES[d.kind].slice(), text: displayText(d),
                shows: plain(entry.displays) && plain(entry.displays[d.path]) ? entry.displays[d.path] : null});
  }
  return out;
}
