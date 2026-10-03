// A DEVICE, OPENED IN EXPLORER, OVER THE RACK. The builder's version of the
// showcase's Inspect lens (spoke-host.js openFrame/readBack), without the
// stage rail: Explorer in an iframe (?embed=1) loaded with the item's swaps
// and fields, and on Done whatever Explorer now says about that device comes
// back - its configuration, swaps and fields. A lens that never became ready,
// or that reports a different device, hands back nothing: those are not this
// item's to write.

import {encodeSwaps} from '../../vendor/swap.js';
import {encodeFields} from '../optics.js';
import {el} from './dom.js';

export function openLens({ref, cfg, view = 'front', swaps = {}, fields = {}, title = ref,
                          host = document.body}) {
  return new Promise(resolve => {
    const q = new URLSearchParams({embed: '1', device: ref, config: cfg, view});
    const sw = encodeSwaps(swaps), fd = encodeFields(fields);
    // swap= and fields= carry their own escaping, so they are appended, not set.
    const frame = el('iframe', {title: `${title} in Explorer`,
      src: `explorer.html?${q}${sw ? `&swap=${sw}` : ''}${fd ? `&fields=${fd}` : ''}`});
    const status = el('span', {class: 'rk-lens-status', role: 'status', text: `Opening ${title} in Explorer…`});
    const done = el('button', {type: 'button', class: 'rk-lens-done', text: 'Done'});
    // The box only covers the middle of the viewport (inset: 3vh 3vw); this
    // covers the rest, so a click in that margin lands on the lens, not on
    // the rack pane underneath it.
    const backdrop = el('div', {class: 'rk-lens-backdrop'});
    const box = el('div', {class: 'rk-lens', role: 'dialog', 'aria-modal': 'true',
                           'aria-label': `${title} in Explorer`},
      [el('div', {class: 'rk-lens-bar'}, [el('strong', {text: title}), status, done]), frame]);
    let api = null, shown = false;   // shown: Explorer reported its device ready
    // EVERY load, not the first: if the frame reloads, the API the first load
    // exposed belongs to a dead window.
    frame.addEventListener('load', async () => {
      try {
        api = frame.contentWindow?.portrayalEmbed || null;
        if (!api) throw new Error('explorer.html did not expose portrayalEmbed');
        await api.ready;
        shown = true;
        status.textContent = 'Changes you make here come back to the rack when you press Done.';
      } catch (err) {
        console.warn('[portrayal] Explorer lens', err);
        api = null; shown = false;
        status.textContent = `${title} could not be opened in Explorer.`;
      }
    });
    const onKey = e => { if (e.key === 'Escape') close(); };
    function close() {
      let cur = null;
      // Read from the window the frame shows NOW - the live one, whatever loaded last.
      const live = frame.contentWindow?.portrayalEmbed || api;
      try { cur = live?.current?.() ?? null; } catch (err) { console.warn('[portrayal] reading the lens back', err); }
      document.removeEventListener('keydown', onKey);
      backdrop.remove();
      box.remove();
      // current() falls back to the URL's own device before one loads, so
      // `shown` is what says Explorer really has it.
      resolve(shown && cur && cur.device === ref
        ? {device: cur.device, config: cur.config, swaps: {...(cur.swaps || {})},
           fields: structuredClone(cur.fields || {})}
        : null);
    }
    done.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    host.append(backdrop, box);
    done.focus();
  });
}
