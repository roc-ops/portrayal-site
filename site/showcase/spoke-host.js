// Spokes: one device, one lens, and the way back.
//
// The four lenses drive the inlined 2D face (#stage2d); stages 1-3 drive the
// 3D rack. So a spoke is a RENDERER SWITCH, not a panel swap (spec §3.4): it
// takes the whole stage, the ladder dims, and a breadcrumb names the stage it
// came from. Leaving goes back through the rail, so the stage is re-entered -
// its seats survive because rack.js's `overrides` is module state.
//
// The entry point is a list in the stage's panel, not a click on the 3D rack:
// rack3d has no picking API, and a GPU-less CI runner cannot click a canvas.
// Picking a device in the canvas is deferred until the rack can say what was
// hit; when it can, it calls openSpoke exactly as these buttons do.

import {stage2d, stage3d, stageRack, panel, hint, srcLine, exportSlot, el,
        setDrawing, setHost, isHost, srcName} from './artifact.js';
import {CAST} from './rack.js';
// A circular import: stage-rail.js imports this (a rung click closes an open
// spoke), and this imports the rail. Safe for the same reason rack.js's is -
// every binding from the rail is read inside a function, never while the
// modules are being evaluated.
import {suspend, activate, stageLabel} from './stage-rail.js';
import makeInspect  from './spokes/inspect.js';
import makeCallouts from './spokes/callouts.js';
import makeState    from './spokes/state.js';
import makeSelect   from './spokes/select.js';

const LENSES = {
  inspect:  {make: makeInspect,  label: 'Inspect'},
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

let open = null;    // {dev, cfg, lens, spoke, returnTo, origin}

export const spokeOpen = () => open !== null;

// `origin` is the button that started this detour - focus goes back to it on
// the way out. Switching lens inside a spoke keeps the original one.
export async function openSpoke({dev, cfg, lens, returnTo, origin = {dev, lens}}) {
  if (!LENSES[lens] || !offered(lens, dev)) {
    throw new Error(`no ${lens} lens for ${dev}`);
  }
  if (open) await closeSpoke({resume: false});
  // Leaving the stage bumps the epoch: its own late work (a queued seat) is
  // dropped, and a rung clicked from here on makes THIS open stale. The rail
  // hands back a lease on that epoch - the same one a stage gets - and every
  // scrim write below goes through it.
  const ui = await suspend();
  if (!ui.live()) return;
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
  if (!open) return;
  const {spoke, returnTo, origin} = open;
  open = null;
  // The lens's controls go with it, at once - the same rule the rail applies
  // to a stage it leaves - so none of them can be clicked on the way out.
  panel.replaceChildren();
  exportSlot.replaceChildren();
  await spoke.exit?.();
  setHost(null);
  document.body.classList.remove('spoke-open');
  crumb.hidden = true;
  stage2d.hidden = true;
  if (!resume) return;
  await activate(returnTo);                       // re-enters the stage we left
  panel.querySelector(
    `[data-spoke-device="${origin.dev}"][data-spoke-lens="${origin.lens}"]`)?.focus();
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

// "Look closer": the same section in stages 1, 2 and 3's panels - one row per
// cast device, a button per lens it is offered. Built here once so the three
// stages cannot drift apart.
export function lookCloser(returnTo) {
  const rows = CAST.map(e => {
    const lenses = lensesFor(e.ref);
    const btns = lenses.map(l => {
      const b = el('button', {type: 'button', text: LENSES[l].label,
                              'data-spoke-device': e.ref, 'data-spoke-lens': l});
      b.onclick = () => openSpoke({dev: e.ref, cfg: e.cfg, lens: l, returnTo});
      return b;
    });
    const kids = [el('span', {class: 'mono', text: e.label}), el('div', {class: 'ctl'}, btns)];
    if (lenses.length < Object.keys(LENSES).length) {
      kids.push(el('p', {class: 'lens-note',
        text: 'Callouts, Live state and Select are written against the AS7726-32X’s front face.'}));
    }
    return el('div', {class: 'lens-row', 'data-spoke-row': e.ref}, kids);
  });
  return el('div', {class: 'look-closer', 'data-look-closer': 'true'}, [
    el('p', {class: 'panel-title', text: 'Look closer'}),
    el('p', {class: 'panel-lead', text: 'Open one device’s compiled 2D face under a lens. The breadcrumb brings you back here.'}),
    ...rows,
  ]);
}
