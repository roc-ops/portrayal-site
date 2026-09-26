// AN EMPTY U, AND WHAT COULD GO THERE (spec §7.2). The whole catalog,
// searchable; a device that will not fit here is grayed out with the reason
// fit.js gives, rather than hidden - "why can't I put the ASR here?" is
// answered on the row, not left to guesswork.

import {el} from './dom.js';
import {fits} from './fit.js';
import {uLabel} from './model.js';

const hay = e => `${e.manufacturer ?? ''} ${e.model ?? ''} ${e.family ?? ''} ${e.name}`.toLowerCase();

export function catalogPanel({entries, rack, face, ru, chassisOf, query = '', onQuery, onPick}) {
  const input = el('input', {id: 'catQuery', type: 'search', placeholder: 'R740xd, 400G, patch panel',
                             value: query, 'aria-label': 'Search devices'});
  const list = el('div', {class: 'rk-cat-list'});
  const draw = q => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    list.replaceChildren(...entries
      .filter(e => e.ru !== 0 && words.every(w => hay(e).includes(w)))
      .map(e => {
        const f = fits(rack, {ref: e.name, ru, face}, chassisOf);
        const b = el('button', {type: 'button', class: f.ok ? 'rk-cat' : 'rk-cat rk-no', 'data-ref': e.name,
                                ...(f.ok ? {} : {'aria-disabled': 'true'})}, [
          el('span', {class: 'rk-cat-name', text: `${e.manufacturer ?? ''} ${e.model}`.trim()}),
          el('span', {class: 'rk-muted', text: ` ${e.ru}U · ${Math.round(e.d ?? 0)} mm`}),
          ...(f.ok ? [] : [el('span', {class: 'rk-why', text: f.reason})]),
        ]);
        if (f.ok) b.addEventListener('click', () => onPick(e));
        return b;
      }));
  };
  input.addEventListener('input', () => { onQuery?.(input.value); draw(input.value); });
  draw(query);
  queueMicrotask(() => input.focus());
  return el('div', {class: 'rk-catalog'}, [
    el('h3', {text: `U${uLabel(rack.frame, ru)} · ${face}, empty`}),
    el('label', {}, ['Place a device here', input]),
    list,
  ]);
}
