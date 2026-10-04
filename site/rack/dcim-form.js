// DCIM IMPORT SETTINGS, as a form (Phase 2c ruling 2). NetBox needs a site and
// a device role on every device, Nautobot a location and a role; the rack
// knows neither, so it asks. Like frame-form.js, this builds elements and
// reports what the user did; the page decides what a change means. The names
// are stored in the rack file (model.js dcimOf) and written into the import
// kits' files as typed. The status is not asked: everything is planned.
//
// HOW IT SAVES: typing changes nothing in the rack (`onEdit` only reports the
// draft). Done reads both fields itself and saves once, then closes; Cancel
// and Esc close without saving. Saving on each field's `change` rebuilt the
// side panel between a click's mousedown and mouseup, and the first click on
// Done was lost. The page keeps the draft, so leaving the form any other way
// (a click on the rack, another panel) saves what was typed.

import {el} from './dom.js';
import {dcimOf} from './model.js';

export function dcimForm({rack, draft = null, onEdit, onDone, onCancel}) {
  const d = {...dcimOf(rack), ...(draft || {})};
  const field = (label, control) => el('label', {}, [label, control]);
  const site = el('input', {id: 'dSite', type: 'text', value: d.site, autocomplete: 'off', 'aria-describedby': 'dHelp'});
  site.addEventListener('input', () => onEdit({site: site.value, role: role.value}));
  const role = el('input', {id: 'dRole', type: 'text', value: d.role, autocomplete: 'off', 'aria-describedby': 'dHelp'});
  role.addEventListener('input', () => onEdit({site: site.value, role: role.value}));
  const done = el('button', {type: 'button', id: 'dDone', text: 'Done'});
  done.addEventListener('click', () => onDone({site: site.value, role: role.value}));
  const cancel = el('button', {type: 'button', id: 'dCancel', text: 'Cancel'});
  cancel.addEventListener('click', onCancel);
  const form = el('div', {id: 'dcimForm', class: 'rk-dcim'}, [
    el('h3', {text: 'DCIM import settings'}),
    field('Site (NetBox) or location (Nautobot)', site),
    field('Device role', role),
    el('p', {id: 'dHelp', class: 'rk-muted',
             text: 'The names as your NetBox or Nautobot has them. They go into the import kits as typed; both must exist there before you import. Left empty, the kit still exports and its README says which columns to fill in.'}),
    el('p', {id: 'dStatus', class: 'rk-muted', text: 'Status: planned, for every device, module and cable.'}),
    el('div', {class: 'rk-actions'}, [done, cancel]),
  ]);
  // Esc in a field closes the form without saving, as Esc does in the cable form;
  // Enter in a field is Done. Other forms are not touched: this listener is the form's own.
  form.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') { ev.preventDefault(); onCancel(); }
    else if (ev.key === 'Enter' && ev.target instanceof HTMLInputElement) { ev.preventDefault(); done.click(); }
  });
  return form;
}
