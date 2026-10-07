// A CABLE'S ROUTE IN ITS FORM (routing spec §6). Automatic until edited: the
// waypoints the page chose are shown grayed. Any change stores the whole list.
// Like the other panels, every action is a callback.

import {el} from './dom.js';

const button = (id, text, fn, label, disabled = false) => {
  const b = el('button', {type: 'button', id, text, ...(label ? {'aria-label': label} : {}), ...(disabled ? {disabled: ''} : {})});
  b.addEventListener('click', fn);
  return b;
};

export function routeList({rows, auto, selected = null, onSelect, onUp, onDown, onRemove, onAdd, onReset}) {
  const items = rows.map((r, i) => el('li', {id: `routeRow-${i}`, class: [auto ? 'rk-muted' : '', i === selected ? 'rk-selected' : '', r.gone ? 'rk-gone' : ''].join(' ').trim(),
                                              tabindex: '0', 'aria-selected': String(i === selected)}, [
    `${r.text}${r.gone ? ' (gone)' : ''} `,
    button(`routeUp-${i}`, '↑', () => onUp(i), 'Move up', i === 0),
    button(`routeDown-${i}`, '↓', () => onDown(i), 'Move down', i === rows.length - 1),
    button(`routeDel-${i}`, '✕', () => onRemove(i), 'Remove waypoint')]));
  for (const [i, li] of items.entries()) {
    li.addEventListener('click', ev => { if (ev.target === li) onSelect(i); });
    li.addEventListener('keydown', ev => {
      if (ev.target === li && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); onSelect(i); }
    });
  }
  return el('section', {id: 'routeList', class: 'rk-route'}, [
    el('h4', {text: auto ? 'Route: automatic' : 'Route'}),
    rows.length ? el('ol', {}, items) : el('p', {class: 'rk-muted', text: 'Hangs directly between its ports.'}),
    el('div', {class: 'rk-actions'}, [button('routeAdd', 'Add waypoint', onAdd),
                                      ...(auto ? [] : [button('routeReset', 'Reset route', onReset)])]),
  ]);
}
