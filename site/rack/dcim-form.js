// DCIM IMPORT SETTINGS, as a form (Phase 2c ruling 2). NetBox needs a site and
// a device role on every device, Nautobot a location and a role; the rack
// knows neither, so it asks. Like frame-form.js, this builds elements and
// reports what the user did; the page decides what a change means. The names
// are stored in the rack file (model.js dcimOf) and written into the import
// kits' files as typed. The status is not asked: everything is planned.

import {el} from './dom.js';
import {dcimOf} from './model.js';

export function dcimForm({rack, onChange, onDone}) {
  const d = dcimOf(rack);
  const field = (label, control) => el('label', {}, [label, control]);
  const site = el('input', {id: 'dSite', type: 'text', value: d.site, autocomplete: 'off', 'aria-describedby': 'dHelp'});
  site.addEventListener('change', () => onChange({site: site.value}));
  const role = el('input', {id: 'dRole', type: 'text', value: d.role, autocomplete: 'off', 'aria-describedby': 'dHelp'});
  role.addEventListener('change', () => onChange({role: role.value}));
  const done = el('button', {type: 'button', id: 'dDone', text: 'Done'});
  done.addEventListener('click', onDone);
  return el('div', {id: 'dcimForm', class: 'rk-dcim'}, [
    el('h3', {text: 'DCIM import settings'}),
    field('Site (NetBox) or location (Nautobot)', site),
    field('Device role', role),
    el('p', {id: 'dHelp', class: 'rk-muted',
             text: 'The names as your NetBox or Nautobot has them. They go into the import kits as typed; both must exist there before you import. Left empty, the kit still exports and its README says which columns to fill in.'}),
    el('p', {id: 'dStatus', class: 'rk-muted', text: 'Status: planned, for every device, module and cable.'}),
    el('div', {class: 'rk-actions'}, [done]),
  ]);
}
