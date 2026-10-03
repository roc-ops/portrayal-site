// THE CABLE PANELS, for the side panel (spec §9.2, §9.4). Like frame-form.js
// and inspector.js, these build elements and report what the user did; the
// page decides what a change means. No prompt() and no confirm() (Phase 2
// ruling 10): the side panel is rebuilt on every redraw, and every control
// here has an id so the page can hand keyboard focus back to it.

import {el} from './dom.js';
import {MEDIA, MEDIA_LABELS, UNITS, mismatch, parseLength} from './cable-rules.js';

const option = (value, text, current) =>
  el('option', {value, text, ...(String(current ?? '') === String(value) ? {selected: ''} : {})});
const field = (label, control) => el('label', {}, [label, control]);
const button = (id, text, fn, type = 'button') => {
  const b = el('button', {type, id, text});
  if (fn) b.addEventListener('click', fn);
  return b;
};

// ONE CABLE, AS A FORM - a new one or one being edited (the same form). The
// ends are fixed: they were picked on the drawing. `cable` gives the starting
// values ({media, purpose, label, length}; an `id` means it is being edited);
// `infoA` and `infoB` are the ends' connectors (cable-rules.js connectorOf),
// for the warning beside the media; `purposes` are the ones the rack already
// uses, offered as suggestions. A media mismatch is a WARNING and never stops
// a save (spec §9.3). onSave gets {media, purpose, label, length}, with
// length null when the field is empty.
export function cableForm({title, endA, endB, cable, infoA = null, infoB = null, purposes = [],
                           onSave, onCancel}) {
  const media = el('select', {id: 'cMedia'}, [
    option('', 'Not set', cable.media),
    ...MEDIA.map(m => option(m, MEDIA_LABELS[m], cable.media)),
    // A media from a file this page does not know stays selectable as itself.
    ...(cable.media && !MEDIA.includes(cable.media) ? [option(cable.media, cable.media, cable.media)] : [])]);
  const purpose = el('input', {id: 'cPurpose', type: 'text', value: cable.purpose || '',
                               list: 'cPurposes', autocomplete: 'off'});
  const label = el('input', {id: 'cLabel', type: 'text', value: cable.label || ''});
  const length = el('input', {id: 'cLength', type: 'text', inputmode: 'decimal',
                              value: cable.length ? String(cable.length.value) : ''});
  const unit = el('select', {id: 'cUnit'}, UNITS.map(u => option(u, u, cable.length?.unit || 'm')));
  const warn = el('p', {id: 'cWarn', class: 'rk-warn', role: 'status'});
  const err = el('p', {id: 'cError', class: 'rk-error', role: 'alert'});
  const showWarn = () => { warn.textContent = mismatch(media.value, infoA, infoB).join(' '); };
  media.addEventListener('change', showWarn);
  showWarn();

  const form = el('form', {id: 'cableForm', class: 'rk-cable-form', novalidate: ''}, [
    el('h3', {text: title}),
    el('p', {id: 'cEndA', class: 'rk-muted', text: `A: ${endA}`}),
    el('p', {id: 'cEndB', class: 'rk-muted', text: `B: ${endB}`}),
    field('Media', media),
    warn,
    field('Purpose', purpose),
    el('datalist', {id: 'cPurposes'}, purposes.map(p => el('option', {value: p}))),
    field('Label', label),
    el('div', {class: 'rk-length'}, [field('Length', length), field('Unit', unit)]),
    err,
    el('div', {class: 'rk-actions'}, [
      button('cSave', cable.id ? 'Save' : 'Add cable', null, 'submit'),
      button('cCancel', 'Cancel', onCancel)]),
  ]);
  // A form, so Enter in any field saves.
  form.addEventListener('submit', ev => {
    ev.preventDefault();
    const len = parseLength(length.value, unit.value);
    if (!len.ok) { err.textContent = len.reason; length.focus(); return; }
    err.textContent = '';
    onSave({media: media.value, purpose: purpose.value.trim(), label: label.value.trim(), length: len.length});
  });
  return form;
}
