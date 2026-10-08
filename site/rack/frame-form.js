// THE FRAME, as a form (spec §5.1). The page decides what a change means;
// this only reports it - including lowering the rack below its highest
// device, which the page now handles by compacting and, if needed, trimming
// from the bottom (fit.js's shrinkRack), rather than refusing the edit.

import {el} from './dom.js';
import {THREADS} from './model.js';

const option = (value, text, current) =>
  el('option', {value, text, ...(String(current) === String(value) ? {selected: ''} : {})});

export function frameForm({rack, onName, onFrame}) {
  const f = rack.frame;
  const err = el('p', {class: 'rk-error', role: 'alert'});
  const field = (label, control) => el('label', {}, [label, control]);
  const num = (id, value, min) => el('input', {id, type: 'number', min: String(min), step: '1', value: String(value)});

  const name = el('input', {id: 'fName', type: 'text', value: rack.name});
  name.addEventListener('change', () => onName(name.value.trim() || 'Rack'));

  const kind = el('select', {id: 'fKind'}, [option('four-post', 'Four-post', f.kind), option('two-post', 'Two-post', f.kind)]);
  kind.addEventListener('change', () => onFrame({kind: kind.value}));

  const height = num('fHeight', f.heightRU, 1);
  height.addEventListener('change', () => {
    const n = Math.round(Number(height.value));
    if (!(n >= 1)) { err.textContent = 'Enter a height of 1U or more.'; return; }
    err.textContent = '';
    onFrame({heightRU: n});
  });

  const numbering = el('select', {id: 'fNumbering'},
    [option('bottom-up', 'U1 at the bottom', f.numbering), option('top-down', 'U1 at the top', f.numbering)]);
  numbering.addEventListener('change', () => onFrame({numbering: numbering.value}));

  const holes = el('select', {id: 'fHoles'},
    [option('square', 'Square (cage nuts)', f.holes.style), option('tapped', 'Tapped (round)', f.holes.style)]);
  // Only the style: the page keeps the thread the frame has now (it may not be this form's any more).
  holes.addEventListener('change', () => onFrame({holes: {style: holes.value}}));

  const thread = el('select', {id: 'fThread'},
    [option('', 'Not stated', f.holes.thread ?? ''), ...THREADS.map(t => option(t, t, f.holes.thread))]);
  thread.addEventListener('change', () => onFrame({holes: {style: 'tapped', thread: thread.value || null}}));

  const rail = num('fRail', f.railDepth ?? 740, 1);
  rail.addEventListener('change', () => { const n = Number(rail.value); if (n > 0) onFrame({railDepth: n}); });
  // The rack's default faceplate setback (model.js setbackOf): where a device
  // that states none of its own has its faceplate, in mm behind the rail.
  const setback = num('fSetback', f.setback ?? 0, 0);
  setback.addEventListener('change', () => {
    const n = Number(setback.value);
    if (!(n >= 0) || setback.value.trim() === '') { err.textContent = 'Enter a setback of 0 mm or more.'; return; }
    err.textContent = '';
    onFrame({setback: n});
  });
  const usable = num('fUsable', f.usableDepth, 1);
  usable.addEventListener('change', () => { const n = Number(usable.value); if (n > 0) onFrame({usableDepth: n}); });

  return el('div', {class: 'rk-frame'}, [
    el('h3', {text: 'Frame'}),
    field('Name', name),
    field('Frame', kind),
    field('Height (U)', height),
    field('U numbering', numbering),
    field('Rail holes', holes),
    ...(f.holes.style === 'tapped' ? [field('Thread', thread)] : []),
    ...(f.kind === 'four-post' ? [field('Front-to-rear rail depth (mm)', rail)] : []),
    field('Usable depth from the front rail (mm)', usable),
    field('Faceplate setback (mm, 0 is flush)', setback),
    err,
  ]);
}
