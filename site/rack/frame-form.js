// THE FRAME, as a form (spec §5.1). The page decides what a change means;
// this only reports it - including lowering the rack below its highest
// device, which the page now handles by compacting and, if needed, trimming
// from the bottom (fit.js's shrinkRack), rather than refusing the edit.
//
// RACK PRODUCTS (Portrayal #935 step 2, #1131): the catalogue's `frames` are
// offered beside the generic frame, searched by the kit's frameProducts. A
// frame that holds one shows its name and ref, and the numbers the product
// states (fixedNumbers) cannot be edited; the rail depth takes the product's
// range and step (railRange). The kit refuses the same edits (editRefusal) -
// the disabled controls only keep from offering them. A frame with no ref
// is the form it always was.

import {el} from './dom.js';
import {THREADS} from '../../vendor/rack/model.js';
import {frameProducts, frameState, fixedNumbers, railRange, frameName} from '../../vendor/rack/frames.js';
import {formsOf, formLabel} from './frame-forms.js';

const option = (value, text, current) =>
  el('option', {value, text, ...(String(current) === String(value) ? {selected: ''} : {})});

// `picker` is the search text and form filter ({text, form}), kept by the page so they outlive the form's
// rebuild; `onPicker` is told when either changes. The id a chosen product's button takes is pickId(ref), so
// the page can put the keyboard back on it.
export const pickId = ref => `fPick-${ref}`;

export function frameForm({rack, frames = {}, frameOf = null, picker = {text: '', form: ''}, onPicker = () => {},
                           onName, onFrame, onApply, onCustomise}) {
  const f = rack.frame;
  const err = el('p', {class: 'rk-error', role: 'alert'});
  const field = (label, control) => el('label', {}, [label, control]);
  const num = (id, value, min) => el('input', {id, type: 'number', min: String(min), step: '1', value: String(value)});
  // What the frame's product states (the catalogue has it, whether or not the numbers still match).
  const state = frameState(f, frameOf);
  const row = state.row;
  const fixed = row ? fixedNumbers(row) : null;
  const lock = (control, on) => { if (on) control.setAttribute('disabled', ''); return control; };

  const name = el('input', {id: 'fName', type: 'text', value: rack.name});
  name.addEventListener('change', () => onName(name.value.trim() || 'Rack'));

  const kind = lock(el('select', {id: 'fKind'}, [option('four-post', 'Four-post', f.kind), option('two-post', 'Two-post', f.kind)]), fixed);
  kind.addEventListener('change', () => onFrame({kind: kind.value}));

  const height = lock(num('fHeight', f.heightRU, 1), fixed);
  height.addEventListener('change', () => {
    const n = Math.round(Number(height.value));
    if (!(n >= 1)) { err.textContent = 'Enter a height of 1U or more.'; return; }
    err.textContent = '';
    onFrame({heightRU: n});
  });

  const numbering = lock(el('select', {id: 'fNumbering'},
    [option('bottom-up', 'U1 at the bottom', f.numbering), option('top-down', 'U1 at the top', f.numbering)]), fixed);
  numbering.addEventListener('change', () => onFrame({numbering: numbering.value}));

  const holes = lock(el('select', {id: 'fHoles'},
    [option('square', 'Square (cage nuts)', f.holes.style), option('tapped', 'Tapped (round)', f.holes.style),
     // (unthreaded round holes, rack file version 4: offered only where the file has them, so the form never loses them)
     ...(f.holes.style === 'round' ? [option('round', 'Round (unthreaded)', f.holes.style)] : [])]), fixed);
  // Only the style: the page keeps the thread the frame has now (it may not be this form's any more).
  holes.addEventListener('change', () => onFrame({holes: {style: holes.value}}));

  const thread = lock(el('select', {id: 'fThread'},
    [option('', 'Not stated', f.holes.thread ?? ''), ...THREADS.map(t => option(t, t, f.holes.thread))]), fixed);
  thread.addEventListener('change', () => onFrame({holes: {style: 'tapped', thread: thread.value || null}}));

  // The rail depth is the one number a product leaves to the person, inside its range and step; a product
  // that fixes it (or a range of one) leaves nothing to edit.
  const rail = num('fRail', f.railDepth ?? 740, 1);
  const range = row ? railRange(row) : null;
  if (range) {
    rail.setAttribute('min', String(range.min));
    rail.setAttribute('max', String(range.max));
    if (range.step) rail.setAttribute('step', String(range.step));
    lock(rail, range.fixed);
  }
  rail.addEventListener('change', () => { const n = Number(rail.value); if (n > 0) onFrame({railDepth: n}); });
  const usable = lock(num('fUsable', f.usableDepth, 1), fixed && fixed.usableDepth != null);
  usable.addEventListener('change', () => { const n = Number(usable.value); if (n > 0) onFrame({usableDepth: n}); });

  const railLabel = range?.step ? `Front-to-rear rail depth (mm, ${range.min} to ${range.max} in steps of ${range.step})`
    : range && !range.fixed ? `Front-to-rear rail depth (mm, ${range.min} to ${range.max})` : 'Front-to-rear rail depth (mm)';
  return el('div', {class: 'rk-frame'}, [
    el('h3', {text: 'Frame'}),
    productPicker({frames, current: f.ref, state, picker, onPicker, onApply, onCustomise}),
    field('Name', name),
    field('Frame', kind),
    field('Height (U)', height),
    field('U numbering', numbering),
    field('Rail holes', holes),
    ...(f.holes.style === 'tapped' ? [field('Thread', thread)] : []),
    ...(f.kind === 'four-post' ? [field(railLabel, rail)] : []),
    field('Usable depth from the front rail (mm)', usable),
    err,
  ]);
}

// THE PICKER: what the frame holds (name, ref, Customise, and the kit's note when the file's numbers no longer
// follow the product), and the catalogue's products to choose from, narrowed by words and by form.
function productPicker({frames, current, state, picker, onPicker, onApply, onCustomise}) {
  const row = state.row;
  const held = [];
  if (current != null) {
    const customise = el('button', {type: 'button', id: 'fCustomise', text: 'Customise',
      title: 'Stop following the product. Every number stays; the frame can then be edited freely.'});
    customise.addEventListener('click', () => onCustomise());
    held.push(el('div', {id: 'fProduct', class: 'rk-product-held'}, [
      el('strong', {text: row ? frameName(row) : 'Unknown product'}), ' ', el('code', {text: current}), ' ', customise]));
    if (state.note) held.push(el('p', {id: 'fNote', class: 'rk-muted', text: state.note}));
    if (state.state === 'changed') {
      const again = el('button', {type: 'button', id: 'fReapply', text: `Apply ${frameName(row)} again`});
      again.addEventListener('click', () => onApply(current));
      held.push(el('p', {}, [again]));
    }
  }
  const search = el('input', {id: 'fProdSearch', type: 'search', placeholder: 'Name, part number or alias', autocomplete: 'off',
    value: picker.text});
  // The forms are the catalogue's own; one the filter holds that the catalogue no longer has is kept as a choice.
  const forms = formsOf(frames);
  if (picker.form && !forms.includes(picker.form)) forms.push(picker.form);
  const form = el('select', {id: 'fProdForm'}, [option('', 'Any form', picker.form), ...forms.map(v => option(v, formLabel(v), picker.form))]);
  const list = el('ul', {id: 'fProducts', class: 'rk-products'});
  const show = () => {
    const rows = frameProducts(frames, {text: search.value, form: form.value || null});
    list.replaceChildren(...(rows.length ? rows.map(r => {
      const b = el('button', {type: 'button', id: pickId(r.ref), 'data-product-ref': r.ref, ...(r.ref === current ? {'aria-pressed': 'true'} : {}),
        title: r.description ?? ''}, [
        el('span', {class: 'rk-product-name', text: frameName(r)}),
        el('span', {class: 'rk-muted', text: ` ${r.ru}U ${formLabel(r.form)}`})]);
      b.addEventListener('click', () => onApply(r.ref));
      return el('li', {}, [b]);
    }) : [el('li', {class: 'rk-muted', text: 'No rack product matches.'})]));
  };
  const changed = () => { onPicker({text: search.value, form: form.value}); show(); };
  search.addEventListener('input', changed);
  form.addEventListener('change', changed);
  show();
  return el('fieldset', {class: 'rk-picker'}, [
    el('legend', {text: 'Rack product'}),
    ...held,
    el('label', {}, ['Find a rack product', search]),
    el('label', {}, ['Form', form]),
    list,
    el('p', {class: 'rk-muted', text: 'Or set the frame by hand below.'}),
  ]);
}
