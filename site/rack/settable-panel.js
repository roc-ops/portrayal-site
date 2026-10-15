// WHAT A PART IS SET TO, AND WHAT ITS DISPLAYS SHOW, in the side panel: the
// controls for the kit's state.set (a lamp, a status digit, an outlet, a
// breaker) and display.set (text, digits or an image), for a placed device and
// for a part beside the rack. Like the other panels it changes nothing itself:
// each control is a callback the page sends as a command through the editor,
// which is the command the assistant's edit_rack sends, so the same rack and
// the same drawing come of either. `info` is what the kit says (queries.js
// inspect's `settable` and `states`, and its `displays`); nothing is guessed
// here about what a part can be, and none is shown for a part that declares
// none.

import {el} from './dom.js';

const orWords = xs => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} or ${xs.at(-1)}`);
const button = (id, text, fn) => { const b = el('button', {type: 'button', id, text}); b.addEventListener('click', fn); return b; };
const readDataUrl = file => new Promise((done, fail) => {
  const r = new FileReader();
  r.onload = () => done(String(r.result));
  r.onerror = () => fail(r.error);
  r.readAsDataURL(file);
});

// onState(path, state|null) and onDisplay(path, content|null) answer {ok, reason}.
export function settablePanel({info, onState, onDisplay}) {
  const groups = info.settable ?? [], displays = info.displays ?? [], now = Object.entries(info.states ?? {});
  if (!groups.length && !displays.length) return null;
  const err = el('p', {class: 'rk-error', role: 'alert', id: 'stError'});
  const say = r => { err.textContent = r && !r.ok ? r.reason : ''; return !r || r.ok; };
  const out = [el('h4', {text: 'Lamps, digits and outlets'})];

  if (groups.length) {
    const path = el('select', {id: 'stPath', 'aria-label': 'Part to set'},
      groups.map(g => el('optgroup', {label: orWords(g.can)}, g.paths.map(p => el('option', {value: p, text: p})))));
    const state = el('select', {id: 'stState', 'aria-label': 'What it is'});
    const canOf = () => groups.find(g => g.paths.includes(path.value))?.can ?? [];
    const fill = () => {
      const keep = state.value;
      state.replaceChildren(...canOf().map(s => el('option', {value: s, text: s})));
      if (canOf().includes(keep)) state.value = keep;
    };
    path.addEventListener('change', fill);
    fill();
    out.push(el('label', {}, ['Part', path]), el('label', {}, ['It is', state]),
      el('div', {class: 'rk-actions'}, [button('stSet', 'Set', () => say(onState(path.value, state.value)))]));
    if (now.length) {
      out.push(el('ul', {id: 'stNow', class: 'rk-muted'}, now.map(([p, s]) => {
        const clear = button('', 'Clear', () => say(onState(p, null)));
        clear.removeAttribute('id');
        clear.setAttribute('aria-label', `Clear ${p}`);
        clear.dataset.path = p;
        return el('li', {'data-path': p}, [`${p}: ${s} `, clear]);
      })));
    }
  }

  if (displays.length) {
    out.push(el('h4', {text: 'Displays'}));
    const path = el('select', {id: 'dpPath', 'aria-label': 'Display'},
      displays.map(d => el('option', {value: d.path, text: `${d.path} (${d.text})`})));
    const text = el('textarea', {id: 'dpText', rows: '3', 'aria-label': 'Text, one line a row'});
    const digits = el('input', {id: 'dpDigits', type: 'text', 'aria-label': 'Digits', autocomplete: 'off'});
    const image = el('input', {id: 'dpImage', type: 'file', accept: 'image/svg+xml,image/png,image/jpeg,image/gif', 'aria-label': 'Picture'});
    const textRow = el('label', {}, ['Text', text]), digitsRow = el('label', {}, ['Digits', digits]), imageRow = el('label', {}, ['Picture', image]);
    const shows = el('p', {id: 'dpShows', class: 'rk-muted'});
    const cur = () => displays.find(d => d.path === path.value);
    const sync = () => {
      const d = cur(), takes = d?.takes ?? [];
      textRow.style.display = takes.includes('text') ? '' : 'none';
      digitsRow.style.display = takes.includes('digits') ? '' : 'none';
      imageRow.style.display = takes.includes('image') ? '' : 'none';
      const s = d?.shows;
      text.value = s?.text ? s.text.join('\n') : '';
      digits.value = s?.digits ?? '';
      image.value = '';
      shows.textContent = !s ? 'It shows nothing.' : s.text ? 'It shows text.' : s.digits != null ? `It shows ${s.digits}.` : 'It shows a picture.';
    };
    path.addEventListener('change', sync);
    sync();
    const show = async () => {
      const d = cur(), takes = d?.takes ?? [];
      if (takes.includes('image') && image.files?.length) {
        let url;
        try { url = await readDataUrl(image.files[0]); } catch { err.textContent = 'That picture could not be read.'; return; }
        say(onDisplay(d.path, {image: url}));
      } else if (takes.includes('digits')) say(onDisplay(d.path, {digits: digits.value}));
      else say(onDisplay(d.path, {text: text.value.split('\n')}));
    };
    out.push(el('label', {}, ['Display', path]), textRow, digitsRow, imageRow, shows,
      el('div', {class: 'rk-actions'}, [button('dpSet', 'Show', show), button('dpClear', 'Clear', () => say(onDisplay(cur().path, null)))]));
  }
  out.push(err);
  return el('div', {class: 'rk-settable', id: 'settable'}, out);
}
