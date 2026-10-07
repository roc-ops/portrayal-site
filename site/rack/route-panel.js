// A CABLE'S ROUTE IN ITS FORM (routing spec §6). Automatic until edited: the
// waypoints the page chose are shown grayed. Any change stores the whole list.
// Like the other panels, every action is a callback.

import {el} from './dom.js';

const button = (id, text, fn, label) => {
  const b = el('button', {type: 'button', id, text, ...(label ? {'aria-label': label} : {})});
  b.addEventListener('click', fn);
  return b;
};

export function routeList({rows, auto, selected = null, onSelect, onUp, onDown, onRemove, onAdd, onReset}) {
  const items = rows.map((r, i) => el('li', {id: `routeRow-${i}`, class: [auto ? 'rk-muted' : '', i === selected ? 'rk-selected' : '', r.gone ? 'rk-gone' : ''].join(' ').trim(),
                                              tabindex: '0'}, [
    `${r.text}${r.gone ? ' (gone)' : ''} `,
    button(`routeUp-${i}`, '↑', () => onUp(i), 'Move up'),
    button(`routeDown-${i}`, '↓', () => onDown(i), 'Move down'),
    button(`routeDel-${i}`, '✕', () => onRemove(i), 'Remove waypoint')]));
  for (const [i, li] of items.entries()) li.addEventListener('click', ev => { if (ev.target === li) onSelect(i); });
  return el('section', {id: 'routeList', class: 'rk-route'}, [
    el('h4', {text: auto ? 'Route: automatic' : 'Route'}),
    rows.length ? el('ol', {}, items) : el('p', {class: 'rk-muted', text: 'Hangs directly between its ports.'}),
    el('div', {class: 'rk-actions'}, [button('routeAdd', 'Add waypoint', onAdd),
                                      ...(auto ? [] : [button('routeReset', 'Reset route', onReset)])]),
  ]);
}
