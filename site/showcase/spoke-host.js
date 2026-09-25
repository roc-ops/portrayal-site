// Spokes: one device, one lens, and the way back.
//
// The four lenses drive the inlined 2D face (#stage2d); stages 1-3 drive the
// 3D rack. So a spoke is a RENDERER SWITCH, not a panel swap (spec §3.4): it
// takes the whole stage, the ladder dims, and a breadcrumb names the stage it
// came from. Leaving goes back through the rail, so the stage is re-entered -
// its seats survive because rack.js's `overrides` is module state.
//
// Two ways in, both only in stages 1-3. In 2D the drawing is the entry point:
// every cast device on it is a real element, so clicking one (or Enter on it)
// opens Inspect - wireDevices, below. Under the stage, a strip names every
// cast device and its lenses (renderStrip): always visible, so the feature is
// found without scrolling a panel, and the only way in from 3D - rack3d has no
// picking API, and a GPU-less CI runner cannot click a canvas. When the rack
// can say what was hit, it calls openSpoke exactly as these do.

import {stage2d, stage3d, stageRack, panel, hint, srcLine, exportSlot, el,
        setDrawing, setHost, isHost, srcName} from './artifact.js';
import {CAST, overrides} from './rack.js';
import {encodeSwaps} from '../../vendor/swap.js';
import {wireClicks} from './svg2d.js';
// A circular import: stage-rail.js imports this (a rung click closes an open
// spoke), and this imports the rail. Safe for the same reason rack.js's is -
// every binding from the rail is read inside a function, never while the
// modules are being evaluated.
import {suspend, activate, stageLabel, mode, notice} from './stage-rail.js';
import makeCallouts from './spokes/callouts.js';
import makeState    from './spokes/state.js';
import makeSelect   from './spokes/select.js';

const LENSES = {
  inspect:  {frame: true,        label: 'Inspect'},
  callouts: {make: makeCallouts, label: 'Callouts'},
  state:    {make: makeState,    label: 'Live state'},
  select:   {make: makeSelect,   label: 'Select'},
};

// WHICH LENSES A DEVICE IS OFFERED. Inspect reads whatever the drawing
// carries, so every device gets it. Callouts, Live state and Select name the
// AS7726-32X's own paths - port-14, region:mgmt-block, led-psu1/lamp - so on
// any other face they would ring nothing and toggle nothing. They are offered
// there and only there, rather than generalized into something that pretends.
// check-contract.py reads this table.
export const LENS_DEVICES = {
  inspect: '*',
  callouts: ['as7726-32x'],
  state: ['as7726-32x'],
  select: ['as7726-32x'],
};
const offered = (lens, ref) =>
  LENS_DEVICES[lens] === '*' || LENS_DEVICES[lens].includes(ref);
const lensesFor = ref => Object.keys(LENSES).filter(l => offered(l, ref));

const crumb = document.getElementById('spokeCrumb');
const back = document.getElementById('spokeBack');
const where = document.getElementById('spokeWhere');
const lensRow = document.getElementById('spokeLenses');
const strip = document.getElementById('lookStrip');
const lensHost = document.getElementById('lensFrame');
const body = lensHost.closest('.show-body');

let open = null;    // {dev, cfg, lens, spoke, returnTo, origin} or, for a frame lens, {..., frame, api}
// A frame lens still loading: shown, under its cover, but not yet `open`.
// Held so that a rung click or another lens can take it down AT ONCE rather
// than leaving it over the next stage until its load settles.
let pendingFrame = null;   // {abort}

// A frame still loading counts as open: the rail's rung click closes it
// (without resuming), and its 2D/3D switch is only remembered - openFrame
// applies the latest mode when Explorer is ready.
export const spokeOpen = () => open !== null || pendingFrame !== null;

// `origin` is what started this detour - a strip button, or with
// `via: 'drawing'` the device on the drawing - and focus goes back to it on
// the way out. Switching lens inside a spoke keeps the original one.
export async function openSpoke({dev, cfg, lens, returnTo, origin = {dev, lens}}) {
  if (!LENSES[lens] || !offered(lens, dev)) {
    throw new Error(`no ${lens} lens for ${dev}`);
  }
  if (spokeOpen()) await closeSpoke({resume: false});
  // Leaving the stage bumps the epoch: its own late work (a queued seat) is
  // dropped, and a rung clicked from here on makes THIS open stale. The rail
  // hands back a lease on that epoch - the same one a stage gets - and every
  // scrim write below goes through it.
  const ui = await suspend();
  if (!ui.live()) return;
  if (LENSES[lens].frame) return openFrame({dev, cfg, lens, returnTo, origin, ui});
  setHost(null);
  stage3d.hidden = true; stageRack.hidden = true;

  // The lenses read the inlined face, so the drawing has to be the DEVICE's,
  // not whatever was last on the stage. The stale guard is handed down too, so
  // a fetch that lands after a rung click does not touch the stage at all.
  ui.scrim(`Loading ${dev}…`);
  let ok = false;
  try {
    ok = await setDrawing('front', cfg, dev, () => !ui.live());
  } catch (err) {
    // A face that will not load is not a place to strand the visitor: say so
    // in the console and put them back on the stage they came from.
    console.warn('[portrayal] could not open a spoke on', dev, err);
  }
  if (!ui.live()) return;
  // FALSE MEANS THIS DRAWING IS NOT THE ONE ON THE STAGE. setDrawing returns
  // false when another redraw overtook it, and entering the lens anyway would
  // wire it to whatever face did land. Not stale, so nobody else is taking
  // the stage: go back where the visitor came from, as for a failed load.
  if (!ok) { await activate(returnTo); return; }
  ui.unscrim();
  stage2d.hidden = false;
  srcLine.textContent = srcName();

  // `redraw` is the lens's only way to change the drawing, and it is bound to
  // THIS spoke: once the spoke is no longer the host (closed, or replaced by
  // another lens) it refuses before touching anything - no load generation
  // bumped, no fetch, no srcLine, no scrim - so a lens control that somehow
  // outlives its spoke is inert rather than merely late.
  let spoke = null;
  const redraw = (view, config) => setDrawing(view, config, dev, () => !isHost(spoke));
  spoke = LENSES[lens].make({dev, cfg, redraw});
  // The host hook: the lens's own view/config controls call redraw, which
  // exits and re-enters whatever is hosted - this lens.
  setHost(spoke);
  await spoke.enter();
  if (!ui.live()) {
    await spoke.exit?.();
    setHost(null);
    stage2d.hidden = true;
    return;
  }
  open = {dev, cfg, lens, spoke, returnTo, origin};
  hint.textContent = spoke.hint || '';
  document.body.classList.add('spoke-open');     // dims the ladder, per §3.4
  showCrumb();
  const t = panel.querySelector('.panel-title');
  if (t) { t.tabIndex = -1; t.focus(); }
}

// resume: false is the rail's call - a rung was clicked, so the rail goes
// where the visitor asked rather than back where the spoke came from.
export async function closeSpoke({resume = true} = {}) {
  // A frame overtaken while it loads: taken down now, nothing read back (the
  // visitor never had it), and nowhere to resume to - the caller is going
  // somewhere else.
  if (!open) { pendingFrame?.abort(); return; }
  const was = open;
  const {returnTo, origin} = was;
  open = null;
  // The lens's controls go with it, at once - the same rule the rail applies
  // to a stage it leaves - so none of them can be clicked on the way out.
  panel.replaceChildren();
  exportSlot.replaceChildren();
  if (was.frame) {
    readBack(was);
    dropFrame();
  } else {
    await was.spoke.exit?.();
    setHost(null);
  }
  document.body.classList.remove('spoke-open');
  crumb.hidden = true;
  stage2d.hidden = true;
  if (!resume) return;
  await activate(returnTo);                       // re-enters the stage we left
  // Back to what started the detour: the device on the drawing, or its strip
  // button, whichever it was - and the other when that one is not there (a
  // spoke opened from the strip in 3D and closed after a switch to 2D, say).
  // Looked up only now: the stage redrew its picture on the way back in, so
  // the group that was clicked is gone and this is its replacement.
  const button = strip.querySelector(
    `[data-spoke-device="${origin.dev}"][data-spoke-lens="${origin.lens}"]`);
  const device = stageRack.querySelector(`svg [data-device-ref="${origin.dev}"][tabindex]`);
  (origin.via === 'drawing' ? device || button : button || device)?.focus();
}

// INSPECT IS EXPLORER, IN A FRAME. The kit's shell injects page-wide CSS and
// finds its parts by global id, so it cannot be mounted inside this page; a
// same-origin frame gives it a page of its own. It is seeded from the rack -
// the cast configuration and the swaps already made - and talks back only
// through window.portrayalEmbed.
//
// THE FRAME IS SHOWN AT ONCE, UNDER ITS OWN COVER. Explorer fits its drawing
// to its stage when it loads, and a frame loaded inside a hidden container
// measures zero - it would open mis-fitted. So the host is shown immediately
// at full size, with a cover saying what is loading, and the cover comes off
// when Explorer says it is ready.
//
// A CLICK THAT OVERTAKES THE LOAD REMOVES THE WHOLE HOST, at once: the rail
// sees spokeOpen() while the frame is pending, so a rung click reaches
// closeSpoke, which aborts it. The awaits below race that abort, so a frame
// removed before it fired `load` does not leave this function waiting forever,
// and after every one of them the lease is checked before anything is touched.
function dropFrame() {
  lensHost.hidden = true;
  lensHost.replaceChildren();
  body.classList.remove('frame-open');
}

async function openFrame({dev, cfg, lens, returnTo, origin, ui}) {
  const name = CAST.find(e => e.ref === dev)?.label || dev;
  const q = new URLSearchParams({embed: '1', device: dev, config: cfg, view: 'front'});
  const sw = encodeSwaps(overrides[dev] || {});
  const frame = el('iframe', {title: `${name} in Explorer`,
    src: `explorer.html?${q}${sw ? `&swap=${sw}` : ''}`});   // swap= carries its own escaping
  const cover = el('p', {class: 'lens-cover', role: 'status', text: `Opening ${name} in Explorer…`});
  let aborted = false, abort;
  const gone = new Promise(res => { abort = () => { aborted = true; res(); }; });
  const mine = {abort: () => { if (pendingFrame === mine) pendingFrame = null; dropFrame(); abort(); }};
  pendingFrame = mine;
  lensHost.replaceChildren(frame, cover);
  lensHost.hidden = false;
  body.classList.add('frame-open');
  let api = null;
  try {
    await Promise.race([gone, new Promise((res, rej) => {
      frame.addEventListener('load', res, {once: true});
      frame.addEventListener('error', rej, {once: true});
    })]);
    if (!aborted && ui.live()) {
      api = frame.contentWindow?.portrayalEmbed || null;
      if (!api) throw new Error('explorer.html did not expose portrayalEmbed');
      await Promise.race([gone, api.ready]);
      // `mode` is the rail's live binding: a switch clicked during the load
      // was remembered there, and this applies it.
      if (!aborted && ui.live()) await Promise.race([gone, api.setMode(mode)]);
    }
  } catch (err) {
    console.warn('[portrayal] could not open Explorer for', dev, err);
    api = null;
  }
  // Overtaken: whoever overtook owns the stage. Take the frame down if the
  // abort has not already, and paint, read and write nothing.
  if (aborted || !ui.live() || pendingFrame !== mine) {
    if (pendingFrame === mine) mine.abort();
    return;
  }
  pendingFrame = null;
  if (!api) { dropFrame(); await activate(returnTo); return; }
  cover.remove();
  open = {dev, cfg, lens, frame, api, returnTo, origin};
  hint.textContent = '';
  document.body.classList.add('spoke-open');     // dims the ladder, per §3.4
  showCrumb();
  frame.focus();
}

// THE SWAPS COME BACK - if they still mean what the rack means. Explorer's
// swaps, like the rack's overrides, are a delta against a configuration's
// defaults; made on another configuration they would say something else on
// the cast's, so they stay in the lens and the stage says so.
function readBack({dev, api}) {
  let cur = null;
  try { cur = api?.current?.(); } catch (err) { console.warn('[portrayal] reading the lens back', err); }
  if (!cur) return;
  const castCfg = CAST.find(e => e.ref === dev)?.cfg;
  if (cur.config === castCfg) overrides[dev] = {...cur.swaps};
  else notice(`Your swaps in ${cur.config} stayed in the lens; the rack uses ${castCfg}.`);
}

// The rail's 2D/3D switch, while a frame lens is open, is the frame's.
export function lensMode(m) {
  if (open?.api) open.api.setMode(m).catch(err => console.warn('[portrayal] lens mode', err));
}

function showCrumb() {
  const {dev, cfg, lens, returnTo, origin} = open;
  const {n, title} = stageLabel(returnTo);
  const name = CAST.find(e => e.ref === dev)?.label || dev;
  back.textContent = `‹ back to stage ${n} · ${title}`;
  where.textContent = `${name} — ${LENSES[lens].label}`;
  lensRow.replaceChildren(...lensesFor(dev).map(l => {
    const b = el('button', {type: 'button', text: LENSES[l].label,
                            'aria-pressed': String(l === lens)});
    b.onclick = () => { if (l !== open?.lens) openSpoke({dev, cfg, lens: l, returnTo, origin}); };
    return b;
  }));
  crumb.hidden = false;
}
back.onclick = () => closeSpoke();

// "LOOK CLOSER", UNDER THE STAGE. It used to be a section at the foot of
// stages 1-3's panels, 400 px down a panel clipped at 520 px, where nobody
// found it. Now it is a strip between the stage and its foot: one group per
// cast device, a button per lens it is offered. Built here once so the three
// stages cannot drift apart; the rail's lease calls it (ui.strip), and the
// rail's vacate() hides it, so no stage's strip outlives the stage.
const NARROW = 'Callouts, Live state and Select are written against the AS7726-32X’s front face.';

// `m` is the view of the entry that asked - its lease's mode, handed down by
// ui.strip() - not the rail's global, which a switch may already have moved.
export function renderStrip(returnTo, m = mode) {
  const groups = CAST.map(e => {
    const lenses = lensesFor(e.ref);
    const btns = lenses.map(l => {
      const b = el('button', {type: 'button', text: LENSES[l].label,
                              'data-spoke-device': e.ref, 'data-spoke-lens': l});
      b.onclick = () => openSpoke({dev: e.ref, cfg: e.cfg, lens: l, returnTo})
        .catch(err => console.warn('[portrayal] open spoke', err));
      return b;
    });
    const attrs = {class: 'look-dev', 'data-spoke-row': e.ref};
    if (lenses.length < Object.keys(LENSES).length) attrs.title = NARROW;
    return el('div', attrs, [el('span', {class: 'mono', text: e.label}), ...btns]);
  });
  const label = el('p', {class: 'look-label'}, [el('strong', {text: 'Look closer'})]);
  if (m === '2d') label.append(' · click a device on the drawing, or');
  strip.replaceChildren(label, ...groups);
  strip.hidden = false;
}

export function hideStrip() {
  strip.replaceChildren();
  strip.hidden = true;
}

// IN 2D, THE DEVICE IS THE BUTTON. build2dElevation tags every device group
// with data-device-ref; hovering one outlines it and its <title> names its
// lenses, and clicking (or Enter) opens Inspect. Only cast devices drawn in
// THIS picture are wired, and only by stages 1-3: stage 6's elevation is not
// an entry point.
//
// Clicking, and what is not a click (a drag that pans, a double-click that
// fits), is svg2d.js's wireClicks - the same helper ring2d.js's stubs use, so
// the two cannot drift apart again.
//
// EVERYTHING ADDED HERE IS UI, NOT DRAWING. The group lists what was added in
// data-pt-ui (attribute names, and `.class` for a class), and the <title> is
// marked data-pt-ui="*". artifact.js's standalone() strips both, so an SVG
// export of a wired drawing is the drawing, not the page's controls.
const wired = new WeakSet();
export function wireDevices(root, returnTo, ui = null) {
  if (!root || wired.has(root)) return;
  wired.add(root);
  const open = ref => {
    const e = CAST.find(c => c.ref === ref);
    openSpoke({dev: ref, cfg: e.cfg, lens: 'inspect', returnTo,
               origin: {dev: ref, lens: 'inspect', via: 'drawing'}})
      .catch(err => console.warn('[portrayal] open spoke', err));
  };
  const devices = [];
  for (const g of root.querySelectorAll('[data-device-ref]')) {
    const ref = g.dataset.deviceRef;
    const e = CAST.find(c => c.ref === ref);
    if (!e) continue;
    const lenses = lensesFor(ref).map(l => LENSES[l].label);
    g.setAttribute('tabindex', '0');
    g.setAttribute('role', 'button');
    g.setAttribute('aria-label',
      `${e.label}: look closer (${lenses.length} lens${lenses.length > 1 ? 'es' : ''})`);
    g.classList.add('pt-device');
    g.setAttribute('data-pt-ui', 'tabindex role aria-label .pt-device');
    const tip = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    tip.setAttribute('data-pt-ui', '*');
    tip.textContent = `${e.label} · ${lenses.join(', ')}`;
    g.prepend(tip);
    devices.push(g);
  }
  wireClicks(root, {
    targetAt: t => devices.find(g => g.contains(t)) || null,
    open: g => open(g.dataset.deviceRef),
    ui,
  });
}
