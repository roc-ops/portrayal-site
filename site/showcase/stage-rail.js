// The stage rail: seven ordered, cumulative stages that build one rack up.
//
// Stages are ordered where the old tabs were independent, so this is a
// different control model rather than more tabs: a rung below the current one
// is a stage already passed, and the ladder shows it.

import {stage2d, loading, hint, srcLine, exportSlot, setHost} from './artifact.js';
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
import {spokeOpen, closeSpoke} from './spoke-host.js';

// Bumped on every switch. An enter() that awaits checks it after each await
// and gives up if the stage has moved on, so a slow build cannot paint over
// the stage that replaced it.
export let epoch = 0;
export const stale = mine => mine !== epoch;

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
  epoch++;
  const mine = epoch;
  if (current) await MODULES[current].exit?.();
  loading.hidden = true;
  exportSlot.replaceChildren();
  stageHost.removeAttribute('data-stage-ready');
  current = name;
  paintRail(name);
  hint.textContent = MODULES[name].hint || '';
  srcLine.textContent = '';
  await MODULES[name].enter();
  // Only for a stage that is still current, and never for one whose enter()
  // threw: a checker waiting on this must fail loudly, not pass quietly.
  if (!stale(mine)) stageHost.setAttribute('data-stage-ready', name);
}

// Leave the current stage without entering another: a spoke is taking the
// stage. Bumps the epoch, so the stage's own late work (a seat still queued)
// is dropped, and returns it - the caller's `mine`. The rung stays selected,
// because the spoke is a detour from it; `current` is cleared, so coming back
// through activate() re-enters the stage rather than returning early.
export async function suspend() {
  epoch++;
  const mine = epoch;
  const was = current;
  current = null;
  stageHost.removeAttribute('data-stage-ready');
  exportSlot.replaceChildren();
  if (was) await MODULES[was].exit?.();
  return mine;
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
  activate(b.dataset.stage);
}

export async function boot() {
  // Stages draw into the rack and 3D layers, never the inlined 2D drawing, so
  // no stage is its host: a stray setDrawing must not exit and re-enter one.
  setHost(null);
  stage2d.hidden = true;
  for (const b of rungs()) b.onclick = () => activate(b.dataset.stage);
  document.querySelector('.stage-rail')?.addEventListener('keydown', onKey);
  await activate(STAGES[0]);
}
