// THE POSITION CONTROL OF THE EXPLORER (docs/adjustable-positions-design.md
// section 7). A device may declare a part that slides, a rail panel on slotted
// brackets, and this is the one place a reader sets where it stands: for each
// adjustment a slider over its range, a number box in mm, one button for each
// named stop and a reset.
//
// IT HOLDS NO RULE OF ITS OWN. The rows are fields.js `adjustmentRows`, read
// off the face on screen; a value is written through the shell's `setFields`
// at the path of the carrier, the call a host already has, so the location,
// a shared link and the 3D scene take it by the road every field takes; and
// what is refused comes back from `setFields` with its sentence, which is
// shown under the control.
//
// IT IS THERE WHATEVER IS SELECTED, on the page of the device and not in the
// row of a part, and it is absent for a device that declares no adjustment.
import { adjustmentsOf, adjustmentRows } from './fields.js';

const CSS_TEXT = `
  #positions { border-bottom:1px solid var(--line); padding:0.5rem 0.7rem 0.55rem; font-size:0.76rem;
       flex:none; max-height:45%; overflow:auto; }
  #positions[hidden] { display:none; }
  #positions .pos + .pos { margin-top:0.6rem; padding-top:0.5rem; border-top:1px solid var(--line); }
  #positions .hd { display:flex; align-items:baseline; gap:0.4rem; margin-bottom:0.25rem; }
  #positions .lbl { color:var(--dim); text-transform:uppercase; letter-spacing:0.06em; font-size:0.68rem; }
  #positions .val { margin-left:auto; color:var(--ink); font-variant-numeric:tabular-nums; }
  #positions input[type=range] { width:100%; margin:0.1rem 0 0.3rem; accent-color:var(--warn); }
  #positions .ctl { display:flex; align-items:center; gap:0.3rem; flex-wrap:wrap; }
  #positions input[type=number] { width:4.6rem; font:inherit; padding:0.12rem 0.3rem;
       border:1px solid var(--control-line); background:var(--control); color:var(--ink); }
  #positions .unit { color:var(--dim); margin-right:0.3rem; }
  #positions button { font:inherit; font-size:0.72rem; padding:0.14rem 0.5rem; cursor:pointer;
       border:1px solid var(--control-line); background:var(--control); color:var(--ink); }
  #positions button:hover:not(:disabled):not([aria-pressed="true"]) { background:var(--control-hover); border-color:var(--control-hover-line); }
  #positions button[aria-pressed="true"] { background:var(--warn); color:#111; border-color:var(--warn); }
  #positions button:disabled { opacity:0.45; cursor:default; }
  #positions .reset { margin-left:auto; }
  #positions input:focus-visible, #positions button:focus-visible { outline:2px solid var(--ink); outline-offset:1px; }
  #positions .datum, #positions .note { color:var(--dim); font-size:0.68rem; line-height:1.45; margin-top:0.3rem; }
  #positions .msg { color:var(--warn); font-size:0.7rem; line-height:1.45; margin-top:0.3rem; }
  #positions .note:empty { display:none; }
  #positions .msg:empty { margin-top:0; }
`;

// "a", "a or b", "a, b or c"
const anyOf = names => names.length < 2 ? names.join('')
  : `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`;

/**
 * Does this face show the motion of adjustment `id`? True when a member on it
 * moves in the plane of the face: its `data-moves-by` has a `dx` or a `dy`
 * that is not 0. A face on which the motion is depth alone draws the same at
 * every position (section 5 of the design note).
 */
function shows(face, id) {
  if (!face?.querySelectorAll) return false;
  for (const n of face.querySelectorAll(`[data-moves-with="${id}"]`)) {
    const by = String(n.getAttribute('data-moves-by') || '').trim().split(/\s+/).map(Number);
    if (by[0] || by[1]) return true;
  }
  return false;
}

/**
 * Mount the position control of a shell (shell.js `createShell`). One group
 * for each adjustment the device on screen declares: its label, the position
 * in mm, a slider over the range (step 0.1 mm), a number box, a button for
 * each named stop and a reset. With stops and no range the buttons are the
 * whole control. It is hidden for a device that declares none, and inside a
 * module.
 *
 * `opts.before` is the element the control is put in front of (the shell's
 * tree by default). `opts.threeD` answers whether the page offers a 3D view,
 * for the line that names where the motion can be seen. The page says which
 * stage is showing by emitting `mode` on the shell (`'2d'` or `'3d'`), as
 * kit/index.html does: in 3D every face is on screen, so the line is not
 * shown, and a dragged slider is applied when it is let go, since each
 * position is a scene to rebuild.
 *
 * Answers `{el, refresh}`: the control's element, and a function that reads
 * the shell again.
 */
export function positionControl(shell, opts = {}) {
  const doc = opts.document || document;
  const state = shell.state;
  doc.head.appendChild(Object.assign(doc.createElement('style'), {textContent: CSS_TEXT}));
  const box = doc.createElement('section');
  box.setAttribute('id', 'positions');
  box.setAttribute('aria-label', 'Adjustable positions');
  box.hidden = true;
  (opts.before || shell.el.tree).before(box);

  let mode = '2d';
  let drawn = '';                 // what the groups on screen were built from
  const groups = new Map();       // adjustment id -> its nodes
  const said = new Map();         // adjustment id -> the sentence a refusal left

  const make = (tag, part, attrs = {}) => {
    const n = doc.createElement(tag);
    if (part) { n.className = part; n.setAttribute('data-part', part); }
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    return n;
  };

  // WRITE ONE POSITION, the only way this control changes anything. A value
  // the adjustment does not take is not applied: the drawing stays, and the
  // sentence `setFields` answers is shown until the next value is taken.
  function apply(row, value) {
    const got = shell.setFields(row.carrier, {[row.id]: value}) || {};
    const no = (got.refused || []).find(r => r.key === row.id);
    if (no) said.set(row.id, no.reason); else said.delete(row.id);
    refresh();
  }

  function build(rows) {
    box.replaceChildren();
    groups.clear();
    for (const row of rows) {
      const uid = `pos-${row.id}`;
      const g = make('div', 'pos', {role: 'group', 'aria-labelledby': `${uid}-l`,
                                    'data-adjustment': row.id});
      const hd = make('div', 'hd');
      const lbl = make('span', 'lbl', {id: `${uid}-l`});
      lbl.textContent = row.label;
      const val = make('output', 'val', {for: uid});
      hd.append(lbl, val);
      g.append(hd);
      const n = {g, val, stops: []};
      if (row.type === 'range') {
        // THE SLIDER: every 0.1 mm of the range, by pointer or by the keys a
        // range input already takes (arrows, Page Up and Down, Home and End)
        n.slider = make('input', 'slider', {
          type: 'range', id: uid, min: row.min, max: row.max, step: '0.1',
          'aria-labelledby': `${uid}-l`, 'aria-describedby': `${uid}-d`});
        // WHILE IT IS DRAGGED the number follows, and in 2D the drawing does
        // too: a move there is a transform on a few nodes. In 3D each position
        // is a scene to rebuild, so it is applied when the slider is let go.
        n.slider.oninput = () => {
          if (mode === '3d') { show(n, {...row, value: n.slider.value, stop: ''}, true); return; }
          apply(row, n.slider.value);
        };
        n.slider.onchange = () => apply(row, n.slider.value);
        g.append(n.slider);
      }
      const ctl = make('div', 'ctl');
      if (row.type === 'range') {
        n.number = make('input', 'number', {
          type: 'number', min: row.min, max: row.max, step: '0.1', inputmode: 'decimal',
          'aria-label': `${row.label}, ${row.unit}`, 'aria-describedby': `${uid}-d`});
        // a typed value is judged by the shell, not by the box: what it
        // refuses comes back with its sentence, and the box goes back
        n.number.onchange = () => apply(row, n.number.value);
        const unit = make('span', 'unit');
        unit.textContent = row.unit;
        ctl.append(n.number, unit);
      }
      for (const stop of row.stops) {
        const b = make('button', 'stop', {type: 'button', 'data-stop': stop.name,
                                          title: `${stop.value} ${row.unit}`});
        b.textContent = stop.name;
        // the name is input: the shell keeps the number behind it
        b.onclick = () => apply(row, stop.name);
        n.stops.push({b, stop});
        ctl.append(b);
      }
      n.reset = make('button', 'reset', {type: 'button'});
      n.reset.textContent = 'Reset';
      // an empty value is a reset: back to where the drawing was built
      n.reset.onclick = () => apply(row, '');
      ctl.append(n.reset);
      g.append(ctl);
      n.datum = make('div', 'datum', {id: `${uid}-d`});
      n.note = make('div', 'note');
      // THE LIVE REGION IS THERE BEFORE ITS TEXT. A status that is taken out
      // of the page while empty (`display:none`) is not reliably announced
      // when its sentence arrives, so the empty one stays in the
      // accessibility tree: no text and no margin, which is no height.
      n.msg = make('div', 'msg', {role: 'status', 'aria-live': 'polite'});
      g.append(n.datum, n.note, n.msg);
      box.append(g);
      groups.set(row.id, n);
    }
  }

  // What one group says for a row. `dragging` leaves the slider's own value
  // alone, and the rest of the group as it was.
  function show(n, row, dragging = false) {
    const stop = row.stop ? ` (${row.stop})` : '';
    n.val.textContent = `${row.value} ${row.unit}${stop}`;
    if (n.number) n.number.value = row.value;
    if (n.slider) {
      if (!dragging) n.slider.value = row.value;
      n.slider.setAttribute('aria-valuetext', `${row.value} ${row.unit}${stop}`);
    }
    if (dragging) return;
    for (const {b, stop: s} of n.stops) b.setAttribute('aria-pressed', String(s.name === row.stop));
    const held = state.cfgFields?.[row.carrier]?.[row.id] != null;
    n.reset.disabled = !held;
    n.reset.title = `back to where the drawing was built, ${row.built} ${row.unit}`;
    n.datum.textContent = (row.type === 'range' ? `${row.min} to ${row.max} ${row.unit}: ` : '')
      + (row.datum || '');
    n.note.textContent = where(row.id);
    n.msg.textContent = said.get(row.id) || '';
  }

  // WHICH VIEWS SHOW THE MOTION, said when the view on screen cannot (section
  // 7). Read off the faces themselves: a face shows it when a member on it
  // moves in its plane. The faces not on screen are named once the shell
  // holds them; until then the line says only what is known.
  function where(id) {
    if (mode === '3d' || !state.svg || shows(state.svg, id)) return '';
    const others = (state.meta?.views || Object.keys(state.faces || {}))
      .filter(v => v !== state.view && shows(state.faces?.[v], id));
    const threeD = opts.threeD ? !!opts.threeD() : true;
    const first = `The ${state.view} view does not show this.`;
    if (!others.length) return threeD ? `${first} See it in 3D.` : first;
    return `${first} See the ${anyOf(others)} view${threeD ? ', or 3D' : ''}.`;
  }

  // THE OTHER FACES are what the line above names, and a face the shell
  // holds is moved with the rest. THEY ARE ASKED FOR WHEN THE SHELL LACKS
  // ONE, AT MOST TWICE FOR ONE MAP OF FACES AND ONE LOAD. Each refresh puts
  // the question to the map itself, so no note of an old answer goes stale.
  //   - `asking` is the map a request is out for: one is not sent twice.
  //   - A request that ends with a face of this map still missing is counted
  //     in `tries`. The first is followed at once by a second, which is what
  //     a module opened while the faces were on their way needs once it is
  //     left. After the second nothing is asked: the shell keeps no note of
  //     a face it could not fetch, so asking at every `fields` event would
  //     fetch it at every step of a dragged slider.
  //   - The count starts again when the answer could be another one: the
  //     shell starts a new map, or a `load` arrives (a device, a
  //     configuration, a view, or the way back out of a module).
  let asking = null;              // the map a request is out for
  let tried = null, tries = 0;    // the map counted, and its requests that ended short
  const lacking = () => (state.meta?.views || []).some(v => !state.faces?.[v]);
  function wantFaces() {
    if (typeof shell.loadFaces !== 'function') return;
    const map = state.faces;
    if (tried !== map) { tried = map; tries = 0; }
    if (!lacking() || asking === map || tries >= 2) return;
    asking = map;
    // asked now, not a moment later; what it throws is a request that failed
    new Promise(done => done(shell.loadFaces()))
      .catch(err => console.warn('[portrayal] faces for the position control', err))
      .then(() => {
        if (asking === map) asking = null;
        if (state.faces === map && lacking()) tries++;
        refresh();
      });
  }

  function refresh() {
    const declared = state.module || !state.svg ? {} : adjustmentsOf(state.svg);
    const rows = adjustmentRows(declared, state.cfgFields || {});
    box.hidden = !rows.length;
    if (!rows.length) { drawn = ''; said.clear(); box.replaceChildren(); groups.clear(); return; }
    // the groups are rebuilt only when what they were built from changes, so
    // a slider being dragged is never replaced under the pointer
    const sig = JSON.stringify([state.device, rows.map(r =>
      [r.id, r.label, r.carrier, r.type, r.min, r.max, r.stops, r.unit])]);
    if (sig !== drawn) { drawn = sig; said.clear(); build(rows); }
    for (const row of rows) show(groups.get(row.id), row);
    wantFaces();
  }

  // a load is when the faces that could not be had may be there to have
  shell.on('load', () => { tries = 0; refresh(); });
  shell.on('fields', refresh);
  shell.on('mode', m => { mode = m === '3d' ? '3d' : '2d'; refresh(); });
  refresh();
  return {el: box, refresh};
}
