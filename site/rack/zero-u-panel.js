// A PART BESIDE THE RACK, IN THE SIDE PANEL (the kit's zero-u.js): what it is, where it
// stands, and the controls that move or remove it. Like manager-panel.js it
// changes nothing itself: every action is a callback, which the page sends as
// a command through the editor.

import {el} from './dom.js';
import {attachPoints} from '../../vendor/rack/fit.js';
import {zeroUBottom, uLabel} from '../../vendor/rack/model.js';
import {whereText, carriesLane} from '../../vendor/rack/zero-u.js';

const button = (id, text, fn) => { const b = el('button', {type: 'button', id, text}); b.addEventListener('click', fn); return b; };

// onUpdate(patch) -> {ok, reason}: patch is zerou.update's {at, ru, between, label}.
export function zeroUInspector({z, rack, chassis, chassisOf, onUpdate, onRemove}) {
  const err = el('p', {class: 'rk-error', role: 'alert', id: 'zError'});
  const send = (patch, undo) => {
    const r = onUpdate(patch);
    if (r && !r.ok) { err.textContent = r.reason; undo(); }
  };
  const label = el('input', {id: 'zLabel', type: 'text', value: z.label ?? ''});
  label.addEventListener('change', () => send({label: label.value.trim()}, () => { label.value = z.label ?? ''; }));
  const at = el('select', {id: 'zAt', 'aria-label': 'Beside the upright'},
    attachPoints(rack.frame.kind).map(p => el('option', {value: p, text: p, ...(p === z.at ? {selected: ''} : {})})));
  at.addEventListener('change', () => send({at: at.value}, () => { at.value = z.at; }));
  // The bottom U as the rack labels it; the command takes it counted from the bottom.
  const ru = zeroUBottom(z);
  const bottom = el('input', {id: 'zRu', type: 'number', min: '1', max: String(rack.frame.heightRU), value: String(ru)});
  bottom.addEventListener('change', () => {
    const n = Number(bottom.value);
    if (!Number.isInteger(n) || n < 1) { err.textContent = 'The bottom U is a whole number from 1.'; bottom.value = String(ru); return; }
    send({ru: n}, () => { bottom.value = String(ru); });
  });
  const between = el('input', {id: 'zBetween', type: 'checkbox', ...(z.between ? {checked: ''} : {})});
  between.addEventListener('change', () => send({between: between.checked}, () => { between.checked = !!z.between; }));
  const cap = chassis?.capacity;
  return el('div', {class: 'rk-inspector', id: 'zeroUPanel'}, [
    el('h3', {text: z.label}),
    el('p', {class: 'rk-muted', id: 'zWhere', text: `${[chassis?.manufacturer, chassis?.model].filter(Boolean).join(' ') || z.ref} · ` +
      `zero-U, ${whereText(rack, z, chassisOf)}. It takes no rack unit` +
      // only a part that is a pathway carries the lane (kit zero-u.js carriesLane): a PDU leaves it in the gutter
      `${carriesLane(chassis) ? `; the ${z.at} cable lane runs through it` : ''}.`}),
    el('label', {}, ['Label', label]),
    el('label', {}, ['Beside the upright', at]),
    el('label', {}, [`Bottom U (counted from the bottom; labelled U${uLabel(rack.frame, ru)})`, bottom]),
    el('label', {class: 'rk-check'}, [between, ' Between racks (serves the next rack too)']),
    ...(cap ? [el('p', {id: 'zCapacity', class: 'rk-muted', text: `${cap.count} cables (${cap.basis})`})] : []),
    el('div', {class: 'rk-actions'}, [button('zRemove', 'Remove', onRemove)]),
    err,
  ]);
}

// A narrow rail part's rail: left, right, or across both (the kit's side.set).
export function sideControl({item, onSide}) {
  const err = el('p', {class: 'rk-error', role: 'alert', id: 'mSideError'});
  const sel = el('select', {id: 'mSide', 'aria-label': 'Rail'}, [
    ['left', 'Left rail'], ['right', 'Right rail'], ['', 'Across both rails']]
    .map(([v, t]) => el('option', {value: v, text: t, ...((item.side ?? '') === v ? {selected: ''} : {})})));
  sel.addEventListener('change', () => {
    const r = onSide(sel.value || null);
    if (r && !r.ok) { err.textContent = r.reason; sel.value = item.side ?? ''; }
  });
  return el('div', {}, [el('label', {}, ['Rail', sel]), err]);
}
