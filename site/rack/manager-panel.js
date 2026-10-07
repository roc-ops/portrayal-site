// CABLE MANAGERS IN THE SIDE PANEL (spec §7): the rows a host shows, one per
// unit of the host, and the inspector a manager shows instead of a device's.
// Like inspector.js, it changes nothing itself: every action is a callback.

import {el} from './dom.js';
import {positionOf} from './model.js';

const button = (id, text, fn) => { const b = el('button', {type: 'button', id, text}); b.addEventListener('click', fn); return b; };

export function managerRows({host, rack, chassisOf, attachable = () => null, onAttach = () => {}, onAdd, onSelect, onRemove}) {
  const units = Math.max(1, chassisOf(host.ref)?.ru ?? 1);
  const rows = [];
  for (let unit = units; unit >= 1; unit--) {           // top first, as the rack reads
    const m = rack.items.find(i => i.on === host.id && i.unit === unit);
    // An unhosted manager already at this U on the host's face: attach it
    // rather than offering to add another one (it would be refused as taken).
    const loose = m ? null : attachable(host.face, host.ru + unit - 1);
    const name = units > 1 ? `Unit ${unit}` : 'On this device';
    rows.push(el('li', {}, m
      ? [`${name}: ${m.label} `, button(`mgrSelect-${unit}`, 'Select', () => onSelect(m.id)),
         button(`mgrRemove-${unit}`, 'Remove', () => onRemove(m.id))]
      : loose ? [`${name}: ${loose.label} (not attached) `, button(`mgrAttach-${unit}`, 'Attach', () => onAttach(loose.id))]
      : [`${name}: none `, button(`mgrAdd-${unit}`, 'Add...', () => onAdd(unit))]));
  }
  return el('section', {class: 'rk-managers', id: 'mgrRows'},
            [el('h4', {text: `Cable managers on the ${host.face}`}), el('ul', {}, rows)]);
}

export function managerInspector({item, rack, chassis, host, hostHere, onPatch, onDetach, onAttach,
                                  onSelectHost, onMove, onRemove, onExplore}) {
  const err = el('p', {class: 'rk-error', role: 'alert'});
  const label = el('input', {id: 'iLabel', type: 'text', value: item.label});
  label.addEventListener('change', () => {
    const r = onPatch({label: label.value.trim() || item.ref});
    if (r && !r.ok) { err.textContent = r.reason; label.value = item.label; }
  });
  const cap = chassis?.capacity;
  const where = host ? `on ${host.label}, unit ${item.unit}` : 'on its own';
  return el('div', {class: 'rk-inspector'}, [
    el('h3', {text: item.label}),
    el('p', {class: 'rk-muted', text: `${chassis?.manufacturer ?? ''} ${chassis?.model ?? item.ref} · 0U cable manager, ` +
                                      `U${positionOf(rack.frame, item.ru, 1)} ${item.face}, ${where}`.trim()}),
    el('label', {}, ['Label', label]),
    ...(cap ? [el('p', {id: 'mCapacity', class: 'rk-muted', text: `${cap.count} cables (${cap.basis})`})] : []),
    el('div', {class: 'rk-actions'}, [
      ...(host ? [button('mSelectHost', 'Select host', onSelectHost), button('mDetach', 'Detach', onDetach)]
               : hostHere ? [button('mAttach', `Attach to ${hostHere.label}`, onAttach)] : []),
      button('iExplore', 'Open in Explorer', onExplore),
      button('iMove', 'Move', onMove),
      button('iRemove', 'Remove', onRemove),
    ]),
    err,
  ]);
}
