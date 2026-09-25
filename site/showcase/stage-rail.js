// The stage rail: seven ordered, cumulative stages that build one rack up.
//
// Stages are ordered where the old tabs were independent, so this is a
// different control model rather than more tabs: a rung below the current one
// is a stage already passed, and the ladder shows it.

import {stage2d, loading, panel, hint, srcLine, exportSlot, setHost, setPanel, setExports, el}
  from './artifact.js';
import makeRails    from './stages/00-rails.js';
import makeMount    from './stages/01-mount.js';
import makePopulate from './stages/02-populate.js';
import makeOptics   from './stages/03-optics.js';
import makeCable    from './stages/04-cable.js';
import makeFilter   from './stages/05-filter.js';
import makeTakeaway from './stages/06-takeaway.js';
// A circular import: spoke-host.js imports the rail (to suspend a stage and to
// come back to it), and the rail imports it (a rung click closes an open
// spoke). Safe because both sides only read the other's bindings inside
// functions, never while the modules are being evaluated.
import {spokeOpen, closeSpoke, renderStrip, hideStrip} from './spoke-host.js';

// Bumped on every switch. An enter() that awaits checks it after each await
// and gives up if the stage has moved on, so a slow build cannot paint over
// the stage that replaced it.
export let epoch = 0;
export const stale = mine => mine !== epoch;

// THE STAGE LEASE - the one way a stage writes the shared UI.
//
// A stage used to import setPanel, setExports and the loading scrim straight
// from artifact.js and remember to check stale(mine) before each write. Four
// times a caller forgot, or checked the wrong epoch: a seat or a cage change
// clicked on a panel that was still on screen after the rail had moved read
// the GLOBAL epoch at click time, so it looked fresh, and painted its panel
// over the next stage's. So the guard lives here, in two halves:
//
//   1. The rail takes the old stage's controls away. activate() and suspend()
//      clear #sidePanel the moment the epoch moves - before the old stage's
//      exit() and long before the next stage paints - so none of its handlers
//      can be clicked at all (spoke-host.js's closeSpoke does the same).
//
//   2. A write that was already in flight cannot land. enter(ui) receives a
//      lease minted for that one entry: `ui.mine` is its epoch, `ui.live()`
//      is !stale(mine), and ui.setPanel / ui.setExports / ui.scrim /
//      ui.unscrim / ui.strip do nothing once the entry is stale. A handler
//      closes over the lease of the panel it was built into, never over the
//      global epoch, so a click can only ever act for the entry that drew its
//      button.
//
// The lease is the ONLY way a stage reaches those writes (panel, exports,
// scrim, and the "Look closer" strip):
// check-contract.py fails any file under stages/ that imports setPanel,
// setExports or loading from artifact.js, or reads the rail's `epoch`. mount3d
// (rack.js) and artifact.js's load keep their own guards; they are shared
// with callers that are not stages.
//
// `mode` is captured when the lease is minted, so an entry that began in 2D
// never sees 3D half-way through: switching mints a new entry, and a new lease.
// `name` is the stage the lease was minted for, so ui.strip() puts up THAT
// stage's "Look closer" strip (the breadcrumb returns to it); a spoke's lease
// (suspend) has none, and its strip() does nothing.
function lease(mine, name = null) {
  const live = () => !stale(mine);
  const m = mode;
  return Object.freeze({
    mine,
    live,
    mode: m,
    setPanel: (...kids) => { if (live()) setPanel(...kids); },
    setExports: items => { if (live()) setExports(items); },
    scrim: text => { if (live()) { loading.textContent = text; loading.hidden = false; } },
    unscrim: () => { if (live()) loading.hidden = true; },
    strip: () => { if (live() && name) renderStrip(name, m); },
  });
}

// 2D FIRST. One view for the whole ladder, remembered across stages and
// visits. Storage can be blocked (private windows, previews); then the page
// still works and simply forgets.
const MODE_KEY = 'portrayal.showcase.mode';
function readMode() {
  try { return localStorage.getItem(MODE_KEY) === '3d' ? '3d' : '2d'; }
  catch { return '2d'; }
}
function saveMode(m) { try { localStorage.setItem(MODE_KEY, m); } catch { /* forgets */ } }
export let mode = readMode();

const modeButtons = () => [...document.querySelectorAll('#stageMode [data-mode]')];
function paintMode() {
  for (const b of modeButtons()) b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
}

// What leaving a stage takes off the screen, at once: its panel (so none of
// its controls can be clicked while the next one loads), its downloads, its
// "Look closer" strip (a rung click or a 2D/3D switch leaves none behind; the
// next stage puts its own up if it has one), the ring's site tabs (a stage
// that has sites draws its own, under its lease), and the ready signal a
// checker waits on.
function vacate() {
  panel.replaceChildren();
  exportSlot.replaceChildren();
  hideStrip();
  document.getElementById('stageTabs')?.replaceChildren();
  stageHost.removeAttribute('data-stage-ready');
}

// NAMED, NOT GLOBBED. check-contract.py holds this list against the stages/
// directory, so a stage that goes away fails the contract rather than quietly
// becoming unreachable.
export const STAGES = ['rails', 'mount', 'populate', 'optics', 'cable', 'filter', 'takeaway'];
const MODULES = {
  rails: makeRails(), mount: makeMount(), populate: makePopulate(),
  optics: makeOptics(), cable: makeCable(), filter: makeFilter(),
  takeaway: makeTakeaway(),
};

// The element holding the stage layers. data-stage-ready on it names the stage
// whose enter() finished - the signal a checker waits on.
const stageHost = document.getElementById('stageHost');
const rungs = () => [...document.querySelectorAll('.stage-rail [data-stage]')];
let current = null;

// Selected, focusable (roving tabindex), and every rung before it marked done,
// so the ladder shows cumulative progress - which is the point of a ladder.
function paintRail(name) {
  const at = STAGES.indexOf(name);
  for (const b of rungs()) {
    const i = STAGES.indexOf(b.dataset.stage);
    b.setAttribute('aria-selected', String(i === at));
    b.tabIndex = i === at ? 0 : -1;
    b.classList.toggle('done', i < at);
  }
}

// "stage 2 · Populate", for the breadcrumb that leads back to it.
export const stageLabel = name => ({n: STAGES.indexOf(name), title: MODULES[name].title});

export async function activate(name) {
  // A rung clicked while a spoke is open goes where it was clicked, not back
  // to where the spoke came from - so the spoke closes WITHOUT resuming.
  if (spokeOpen()) await closeSpoke({resume: false});
  if (current === name) return;
  await enterStage(name);
}

// Leave whatever is current and enter `name`, even when it IS the current
// stage: that is how switching 2D/3D redraws the stage you are on. The same
// epoch bump guards both: a switch while the old entry's enter() is still
// awaiting makes that entry stale, so its late writes go nowhere and it
// never marks itself ready.
async function enterStage(name) {
  epoch++;
  const mine = epoch;
  vacate();
  // An exit that throws must not stop the next stage entering (R11).
  try { if (current) await MODULES[current].exit?.(); }
  catch (err) { console.warn(`[portrayal] stage ${current} exit`, err); }
  // Overtaken during that exit (another rung, or a spoke suspending): that
  // caller owns the stage now, so do not start entering this one under it.
  if (stale(mine)) return;
  loading.hidden = true;
  current = name;
  paintRail(name);
  hint.textContent = MODULES[name].hint || '';
  srcLine.textContent = '';
  // A STAGE THAT THROWS DOES NOT STRAND THE VISITOR (R11). Without this the
  // rejection escaped to activate()'s callers - rung clicks, the switch -
  // as an unhandled rejection, and the scrim the stage had put up stayed up
  // over nothing. Now, if the entry is still the live one: the scrim comes
  // down, the panel says in one line that the stage could not be drawn and
  // why, and the console has the error. data-stage-ready is still NOT set,
  // so a checker waiting on it fails loudly rather than passing quietly. An
  // entry that was already overtaken writes nothing - the stage that
  // replaced it owns the screen.
  try {
    await MODULES[name].enter(lease(mine, name));
  } catch (err) {
    console.warn(`[portrayal] stage ${name} could not be drawn`, err);
    if (stale(mine)) return;
    loading.hidden = true;
    setPanel(el('p', {class: 'panel-lead', 'data-stage-error': name,
      text: `This stage could not be drawn. ${err?.message || err}`}));
    return;
  }
  // Only for a stage that is still current, and never for one whose enter()
  // threw: a checker waiting on this must fail loudly, not pass quietly.
  if (!stale(mine)) stageHost.setAttribute('data-stage-ready', name);
}

// The switch. A spoke is always a 2D face, so while one is open the new mode
// is only remembered, and applies when the spoke closes and re-enters.
export async function setMode(m) {
  if ((m !== '2d' && m !== '3d') || m === mode) return;
  mode = m;
  saveMode(m);
  paintMode();
  if (spokeOpen() || !current) return;
  await enterStage(current);
}

// Leave the current stage without entering another: a spoke is taking the
// stage. Bumps the epoch, so the stage's own late work (a seat still queued)
// is dropped, and returns a lease on the new epoch - the caller's, the same
// kind a stage gets, so the spoke's scrim writes are guarded the same way.
// The rung stays selected, because the spoke is a detour from it; `current`
// is cleared, so coming back through activate() re-enters the stage rather
// than returning early.
export async function suspend() {
  epoch++;
  const mine = epoch;
  const was = current;
  current = null;
  vacate();
  if (was) await MODULES[was].exit?.();
  return lease(mine);
}

// A vertical tablist: Up/Down move between rungs, Home/End to either end.
function onKey(ev) {
  const list = rungs();
  const i = list.indexOf(document.activeElement);
  if (i < 0) return;
  const to = {ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: list.length - 1}[ev.key];
  if (to == null) return;
  ev.preventDefault();
  const b = list[(to + list.length) % list.length];
  b.focus();
  activate(b.dataset.stage).catch(warnSwitch);
}

// enterStage already turns a stage's own failure into a panel message; this
// is the last net under the UI's own calls (a spoke that fails to close, say),
// so a click never ends in an unhandled rejection.
const warnSwitch = err => console.warn('[portrayal] stage switch', err);

export async function boot() {
  // Stages draw into the rack and 3D layers, never the inlined 2D drawing, so
  // no stage is its host: a stray setDrawing must not exit and re-enter one.
  setHost(null);
  stage2d.hidden = true;
  for (const b of rungs()) b.onclick = () => activate(b.dataset.stage).catch(warnSwitch);
  paintMode();
  for (const b of modeButtons()) b.onclick = () => setMode(b.dataset.mode).catch(warnSwitch);
  document.querySelector('.stage-rail')?.addEventListener('keydown', onKey);
  await activate(STAGES[0]);
}
