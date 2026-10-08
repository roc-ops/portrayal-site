// ONE PLACED DEVICE (spec §7.2): what it is, where it stands, and the things
// that can be done to it. Every change goes through onPatch, which runs the
// placement rules and says no with the reason; the control then snaps back.

import {el} from './dom.js';
import {positionOf} from '../../vendor/rack/model.js';

const option = (value, text, current) =>
  el('option', {value, text, ...(String(current) === String(value) ? {selected: ''} : {})});

export function inspectorPanel({item, rack, chassis, available, onPatch, onMove, onRemove, onExplore}) {
  const err = el('p', {class: 'rk-error', role: 'alert'});
  const apply = (patch, reset) => {
    const r = onPatch(patch);
    if (r && !r.ok) { err.textContent = r.reason; reset(); } else err.textContent = '';
    return r;
  };
  const field = (label, control) => el('label', {}, [label, control]);

  const label = el('input', {id: 'iLabel', type: 'text', value: item.label});
  label.addEventListener('change', () => apply({label: label.value.trim() || item.ref}, () => { label.value = item.label; }));

  // Whether this clears the item's swaps/fields, and the note saying so, are
  // the page's call (patchItem sets S.notice) - this panel is about to be
  // replaced by the redraw the patch triggers, so a note written here would
  // never be seen.
  const cfg = el('select', {id: 'iCfg'}, (chassis?.configs ?? [item.cfg]).map(c => option(c, c, item.cfg)));
  cfg.addEventListener('change', () => apply({cfg: cfg.value, swaps: {}, fields: {}}, () => { cfg.value = item.cfg; }));

  const face = el('select', {id: 'iFace'}, [option('front', 'Front', item.face), option('rear', 'Rear', item.face)]);
  face.addEventListener('change', () => apply({face: face.value}, () => { face.value = item.face; }));

  const turned = el('input', {id: 'iTurned', type: 'checkbox', ...(item.turned ? {checked: ''} : {})});
  turned.addEventListener('change', () => apply({turned: turned.checked}, () => { turned.checked = item.turned; }));

  const d = chassis?.d;
  const button = (id, text, fn) => { const b = el('button', {type: 'button', id, text}); b.addEventListener('click', fn); return b; };
  return el('div', {class: 'rk-inspector'}, [
    el('h3', {text: item.label}),
    el('p', {class: 'rk-muted', text: `${chassis?.manufacturer ?? ''} ${chassis?.model ?? item.ref} · U${positionOf(rack.frame, item.ru, chassis?.ru ?? 1)}, ${item.face}${item.turned ? ', turned' : ''}`.trim()}),
    field('Label', label),
    field('Configuration', cfg),
    field('Mounted on', face),
    el('label', {class: 'rk-check'}, [turned, ' Turned (its rear panel faces out)']),
    el('p', {class: 'rk-depth rk-muted', text: d ? `${Math.round(d)} mm deep · ${Math.round(available)} mm available here` : 'Depth unknown'}),
    el('div', {class: 'rk-actions'}, [
      button('iExplore', 'Open in Explorer', onExplore),
      button('iMove', 'Move', onMove),
      button('iRemove', 'Remove', onRemove),
    ]),
    err,
  ]);
}
