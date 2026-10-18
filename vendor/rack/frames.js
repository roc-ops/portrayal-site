// RACK PRODUCTS APPLIED TO A FRAME (docs/rack-products-design.md section 9).
// `frames` in rack.json holds one row per rack product, keyed by its ref
// `<vendor>/<name>@<major>`. Applying a row writes `frame.ref` and copies the
// row's numbers into the frame, so the file still stands alone and a page
// without the catalogue draws the same frame. Everything here is pure: the
// frame commands, the load notes and a page's controls all ask these.
//
// ONLY WHAT RACK FILE VERSION 3 HOLDS IS WRITTEN: `ref` and the frame keys
// version 3 already had. A product that states `width`, `numbering.start` or a
// round hole would need a version-4 key, so it is refused here rather than
// half applied (the file's `startU` and `width` are never written by this).
//
// A frame's `ref` is null for a generic frame, which none of this touches.

import {normalizeFrame, firstU} from './model.js';

const FORM_KIND = {'2-post-frame': 'two-post', '4-post-frame': 'four-post', '4-post-cabinet': 'four-post'};
const RAIL_WIDTH = 19;
const EPS = 1e-6;

const rearOf = row => (row.rails || []).find(r => r.id === 'rear') ?? null;
const depthOf = row => rearOf(row)?.depth ?? null;
const mm = n => `${n} mm`;

// THE NAME A ROW IS SHOWN BY: its maker and model (`APC AR201`), or its ref
// when it has neither. A row's own `name` is the short id, not this.
export const frameName = row => [row.manufacturer, row.model].filter(Boolean).join(' ') || row.ref;

export const kindOf = row => FORM_KIND[row.form] ?? (rearOf(row) ? 'four-post' : 'two-post');

// What a row states that version 3 cannot hold, as a sentence, or null.
export function unholdable(row) {
  const bits = [];
  if (row.width != null && row.width !== RAIL_WIDTH) bits.push(`${row.width} in rails`);
  if ((row.numbering?.start ?? 1) !== 1) bits.push(`numbering from U${row.numbering.start}`);
  if (row.holes?.style === 'round') bits.push('round holes');
  return bits.length ? `${frameName(row)} has ${bits.join(' and ')}, which this rack file cannot hold yet.` : null;
}

// THE RAIL DEPTH a row allows: {fixed}, {min, max, step?, factory?} or null
// when the product states none (the frame's own depth stands).
export const railRange = row => {
  const d = depthOf(row);
  if (!d) return null;
  return d.fixed != null ? {min: d.fixed, max: d.fixed, fixed: true} : {...d};
};

const stepOff = (v, r) => r.step > 0 && Math.abs(Math.round((v - r.min) / r.step) * r.step - (v - r.min)) > EPS;

// WHY A RAIL DEPTH IS NOT ONE THE PRODUCT ALLOWS, as a sentence; null when it is.
export function railRefusal(row, value) {
  const r = railRange(row);
  if (!r) return null;
  if (r.fixed) return value === r.min ? null : `${frameName(row)} fixes the rail depth at ${mm(r.min)}.`;
  if (value < r.min - EPS || value > r.max + EPS)
    return `${frameName(row)} takes a rail depth from ${r.min} to ${r.max} mm, not ${value}.`;
  if (stepOff(value, r)) return `${frameName(row)} sets the rail depth in steps of ${r.step} mm from ${r.min}, so ${value} is not one.`;
  return null;
}

// THE NUMBERS A ROW FIXES, as the frame keys they land in. The rail depth and
// the usable depth are named only where the product states one.
export function fixedNumbers(row) {
  const d = {kind: kindOf(row), heightRU: row.ru, numbering: row.numbering?.direction ?? 'bottom-up',
             holes: {style: row.holes?.style, thread: row.holes?.thread ?? null}};
  if (row['max-device-depth'] != null) d.usableDepth = row['max-device-depth'];
  if (row.numbering?.start != null) d.startU = row.numbering.start;
  return d;
}

// APPLY: the frame with the product's ref and numbers. The rail depth is the
// product's fixed or factory depth; with a range and no factory depth, or no
// depth at all, the frame's own depth stands, held inside the range. A number
// the product does not state is left as the frame has it, but the usable depth
// goes back to its default when the kind changes, since the old one was for the
// other kind.
export function appliedFrame(frame, row) {
  const kind = kindOf(row);
  const f = fixedNumbers(row);
  const r = railRange(row);
  let railDepth = frame.railDepth;
  if (kind === 'four-post' && r) railDepth = r.fixed ? r.min : r.factory ?? Math.min(r.max, Math.max(r.min, railDepth ?? r.min));
  const base = {...frame, kind, heightRU: f.heightRU, numbering: f.numbering, holes: f.holes, railDepth, ref: row.ref};
  if (f.usableDepth != null) base.usableDepth = f.usableDepth;
  else if (frame.kind !== kind) delete base.usableDepth;
  if (kind === 'two-post') base.railDepth = null;
  return normalizeFrame(base);
}

// WHICH FIXED NUMBERS OF A FRAME ARE NOT THE PRODUCT'S, as frame keys.
export function mismatches(frame, row) {
  const f = fixedNumbers(row), out = [];
  if (frame.kind !== f.kind) out.push('kind');
  if (frame.heightRU !== f.heightRU) out.push('heightRU');
  if (frame.numbering !== f.numbering) out.push('numbering');
  if (frame.holes?.style !== f.holes.style || (frame.holes?.thread ?? null) !== f.holes.thread) out.push('holes');
  if (f.usableDepth != null && frame.usableDepth !== f.usableDepth) out.push('usableDepth');
  if (f.startU != null && firstU(frame) !== f.startU) out.push('startU');
  if (frame.kind === 'four-post' && frame.railDepth != null && railRefusal(row, frame.railDepth)) out.push('railDepth');
  return out;
}

// WHAT A FRAME IS: `generic` (no ref), `product` (a ref the catalogue has and
// the numbers match), `changed` (the catalogue has it and the numbers no longer
// match) or `missing` (the catalogue lacks it). `unknown` is a page with no
// catalogue loaded: nothing can be said, and nothing is. A page draws the
// frame from the file's own numbers in every state; `note` is what it shows.
export function frameState(frame, frameOf) {
  if (frame?.ref == null) return {state: 'generic', row: null, note: null};
  if (typeof frameOf !== 'function') return {state: 'unknown', row: null, note: null};
  const row = frameOf(frame.ref);
  if (!row) return {state: 'missing', row: null,
    note: `This frame was set from ${frame.ref}, which the catalogue does not have, so it is drawn from the numbers in the file. Apply a product to set it again.`};
  const bad = mismatches(frame, row);
  if (bad.length) return {state: 'changed', row, mismatched: bad,
    note: `This frame's ${bad.join(', ')} no longer match ${frameName(row)} (${frame.ref}), so it is drawn from the numbers in the file. Apply the product again to set them.`};
  return {state: 'product', row, note: null};
}

const KEYS = {kind: 'the kind', heightRU: 'the height', numbering: 'the numbering', holes: 'the rail holes',
              usableDepth: 'the usable depth', startU: 'the first unit'};

// WHY AN EDIT OF A FRAME THAT HOLDS A PRODUCT IS REFUSED, or null. `patch` is
// what the edit asks for, `frame` the frame as it stands. A number the product
// fixes may be asked for only at its own value; the rail depth may change within
// the product's range and step. A frame whose ref the catalogue lacks, or none,
// is not held to anything.
export function editRefusal(frame, patch, frameOf) {
  if (frame?.ref == null || typeof frameOf !== 'function') return null;
  const row = frameOf(frame.ref);
  if (!row) return null;
  const f = fixedNumbers(row);
  const same = (k, v) => (k === 'startU' ? v === f.startU : k === 'holes' ? (v?.style ?? frame.holes.style) === f.holes.style && (v?.thread === undefined ? frame.holes.thread : v.thread) === f.holes.thread : v === f[k]);
  for (const k of Object.keys(KEYS)) {
    if (!(k in patch) || f[k] == null) continue;
    if (!same(k, patch[k])) return `${frameName(row)} fixes ${KEYS[k]}; customise the frame to change it.`;
  }
  if ('railDepth' in patch && patch.railDepth != null) return railRefusal(row, patch.railDepth);
  return null;
}

// CUSTOMISE: the same numbers, no product. It becomes a generic frame.
export const customisedFrame = frame => normalizeFrame({...frame, ref: null});

// THE PRODUCTS A PAGE OR AN AGENT CAN CHOOSE FROM, as the catalogue lists them,
// narrowed by `text` (any of ref, maker, model, part number or alias) and `form`.
export function frameProducts(frames, {text = '', form = null} = {}) {
  const t = String(text ?? '').trim().toLowerCase();
  return Object.values(frames || {})
    .filter(r => (!form || r.form === form)
      && (!t || [r.ref, r.manufacturer, r.model, ...Object.keys(r['part-numbers'] || {}), ...(r.aliases || [])].some(s => String(s).toLowerCase().includes(t))))
    .sort((a, b) => String(a.manufacturer).localeCompare(String(b.manufacturer)) || String(a.model).localeCompare(String(b.model)));
}
