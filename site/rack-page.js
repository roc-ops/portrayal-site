// THE RACK BUILDER PAGE: wiring only. The rack lives in the headless editor
// (rack/editor.js); every change is a command sent through edit(), and the
// editor's change event autosaves and redraws. What the side panel shows
// follows S.sel.

import {newDoc, nextRackName, positionOf, dcimOf, zeroUById, zeroUOf, rollOf} from '../vendor/rack/model.js';
import {hostAt, managersOf} from '../vendor/rack/managers.js';
import {managerRows, managerInspector} from './rack/manager-panel.js';
import {openLibrary, autosaver, downloadDoc, readDocFile, fileName, docNotes} from './rack/library.js';
import {drawElevation, uAtY, halfAtY, panelFor} from './rack/elevation.js';
import {fits, fitsZeroU, isRackFace, isZeroUPart, isNarrow, reaches, availableDepth, itemsWithU, heightOf, spansMeet, spanOf, frameNotices} from '../vendor/rack/fit.js';
import {zeroUEntries, hangNotices} from '../vendor/rack/zero-u.js';
import {stateNotices} from '../vendor/rack/states.js';
import {loadCatalog, loadSlots} from '../vendor/rack/catalog.js';
import {loadCableTypes} from '../vendor/rack/cable-types.js';
import {frameForm} from './rack/frame-form.js';
import {dcimForm} from './rack/dcim-form.js';
import {catalogPanel} from './rack/picker.js';
import {projectionIdRefusal} from './rack/part-path.js';
import {openLens} from './rack/explorer-lens.js';
import {inspectorPanel} from './rack/inspector.js';
import {el, svgY} from './rack/dom.js';
import {loadZoom, saveZoom, zoomLabel, applyZoom, stepZoom, wheelZoom, factorForFit} from './rack/zoom.js';
import {createDragController} from './rack/drag.js';
import {mountRack3d} from './rack/scene3d.js';
import {mountStage, loadStage, stageTone} from './rack/stage.js';
import {MODE3D_CSS} from './mode3d.js';
import {sheetSvg, sheetPng, drawioFile, modelFile, dcimKit, bomCsv, cableScheduleCsv, failExport} from './rack/exports.js';
import {save} from './svg-export.js';
import {exportStatus, UNCHECKED_NOTE, rollNote} from '../vendor/rack/export-data.js';
import {cableFacts, factsStand, UNCHECKED} from './rack/cable-plugs.js';
import {mergeSeats, endKey, sameEnd, paneOf, portFree, cablesOf, endName, proposeMedia, countsBy, sameCables3d} from '../vendor/rack/cable-rules.js';
import {widenForCables, drawRackCables, roomForCables, portAt, markPort, paintCables, drawPickTargets, wayEl, inPane} from './rack/cable-view.js';
import {routeList} from './rack/route-panel.js';
import {RU, RAIL_W, OPENING} from '../vendor/rack/rails.js';
import {cableForm, cableList, cableMeta, removePanel} from './rack/cable-panel.js';
import {sparesOf, looseIn, needsText} from './rack/spare.js';
import {bundleForm, bundleInspector} from './rack/bundle-panel.js';
import {paintBundles} from './rack/cable-view.js';
import {litFor, paintHover2d, paintHover3d, paintSelected3d, hoverAt2d, hoverAt3d, hoverAtList, hoverAtFocus, sameTarget} from './rack/hover.js';
import {routeWarnings, withCableTypes, bendNotice, landedBends, reads, kept} from './rack/route-context.js';
import {agentContextFor} from './rack/agent-context.js';
import {routesOf, sameReading, askOf} from './rack/reading.js';
import {describeOnce, inspectOnce} from './rack/agent-read.js';
import {LANE_GAP, routeText} from '../vendor/rack/route.js';
import {createRackEditor} from '../vendor/rack/editor.js';
import {GONE, NOT_ADDED} from '../vendor/rack/commands.js';
import * as Q from '../vendor/rack/queries.js';
import {configuredFace, DIST} from './rack/face.js';
import {rackTools} from './rack/agent-tools.js';
import {registerTools} from './agent/webmcp.js';
import {writeHint} from './rack/agent-hint.js';
import {relaySwitch, prefs} from './agent/relay.js';
import {touchedIds, markTouched} from './rack/agent-mark.js';
import {zeroUInspector, sideControl} from './rack/zero-u-panel.js';
import {drawSideElevation, drawSideCables, roomForSideCables, sizeSideLabels} from './rack/side-elevation.js';
import {stopCentre} from './rack/scene3d.js';
import {solidsOf} from '../vendor/rack/solids.js';
import {bundleOfCable} from '../vendor/rack/bundles.js';
import {loadTree, saveTree, isOpen, markHover, LOOSE} from './rack/cable-tree.js';
import {mountCovers, loadCovers, paintCovers2d, paintCovers3d, layCovers2d} from './rack/covers.js';
import {sizeStraps} from './rack/strap-size.js';

const $ = id => document.getElementById(id);
const PROBE = new URLSearchParams(location.search).get('probe') === '1';
// PROBE ONLY: `?probe=1&checkKept=1` gives the kit's route context `checkKept: true` (route-context.js kept), so every
// path the kit reads is laid again from nothing and compared with the one it kept; a difference throws. Not for a page in use.
if (PROBE && new URLSearchParams(location.search).get('checkKept') === '1') kept.check = true;
const LAST = 'portrayal.rack.last';
const MODE_KEY = 'portrayal.rack.mode';
const CANT_OPEN = "This rack couldn't be opened. Reload to try again.";
const CANT_DRAW = "This rack couldn't be drawn. Reload to try again.";
const AGENT_MARK_MS = 3000;
// The highlight preference lives with the Connect your AI switch.
const agentHighlightOn = () => prefs.highlight;
const CABLES_3D = 'Cables are added in 2D. Switch to 2D to add one.';
function loadMode() {
  try { return localStorage.getItem(MODE_KEY) === '3d' ? '3d' : '2d'; }
  catch { return '2d'; }
}
function saveMode(m) { try { localStorage.setItem(MODE_KEY, m); } catch { /* forgets */ } }
// WHICH PAIR THE TWO PANES SHOW IN 2D (portrayal-site#187): the rack's faces
// (front and rear) or its sides (left and right). The reader's, remembered in
// this browser as the mode is; never in the rack file and never in the URL.
const VIEW_KEY = 'portrayal.rack.view';
const PAIRS = {faces: ['Front', 'Rear'], sides: ['Left', 'Right']};
// What the side pair is for, said where 3D says the like of itself.
const SIDES_NOTE = 'Left and Right show the rack from its sides: click to select. Devices are placed and moved, and cables added, in Front / Rear.';
const CABLES_SIDES = 'Cables are added in Front / Rear. Switch to Front / Rear to add one.';
const MOVE_SIDES = 'Devices are moved in Front / Rear. Switch to Front / Rear to move it. Esc stops moving.';
const PICK_SIDES = 'A waypoint is picked in Front / Rear. Switch to Front / Rear to add one.';
function loadView() {
  try { return localStorage.getItem(VIEW_KEY) === 'sides' ? 'sides' : 'faces'; }
  catch { return 'faces'; }
}
function saveView(v) { try { localStorage.setItem(VIEW_KEY, v); } catch { /* forgets */ } }
const S = {sel: null, lib: null, save: null, devices: {}, draws: 0, notice: null, entries: [],
  dcimDraft: null, zoom: loadZoom(), svgs: [], focusNext: null, mode: loadMode(), view: loadView(), stage: loadStage(), scene3d: null, scene3dRack: null, camera3d: null,
  covers: loadCovers(),   // the covers of the parts beside the rack: 'on', 'see' or 'off' (covers.js); the reader's, never the rack's
  // What the last redraw read off the cabled ends: the derived plugs, and why an end is loose.
  cableFacts: {seats: {}, ends: new Map()},
  hover: null,       // {kind: 'cable'|'bundle', id, from: 'stage'|'list'}: what the pointer is over (#169)
  routes: null,
  routeSel: null,    // {cableId, i}: the route row new waypoints go after
  cableDraft: null,  // {id, values}: what the open cable form holds, kept across a route edit's redraw
  routePick: null,   // {cableId, at}: the next click on a ring, duct, brush or gutter adds a waypoint there
  saidStep: null,    // the summary of the step the notice says, which Undo may take as its description
  // Cable mode: on or off, and the A end picked and waiting for its B.
  cable: {on: false, a: null},
  // The cable list's filter: the viewer's, not the document's.
  cableFilter: {purpose: null, media: null},
  // The cable list as a tree (cable-tree.js): which rows the reader opened or closed in this rack document
  // (`state`, remembered in this browser), the row with the Tab stop (`stop`) and the cable whose pin last
  // opened its row (`pinned`). The viewer's, never the document's.
  tree: {doc: null, state: {}, stop: null, pinned: null, show: null},
  pick: {query: '', vendor: 'all', fitsOnly: true, device: null, cfgByRef: {}}};
let chassisOf = () => null;
// How tall a device is, in U: a device is named with its position (model.js
// positionOf), and that needs its height. Reads chassisOf as it is when asked.
const uOf = item => heightOf(chassisOf)(item);
let drag = null; // the drag controller, wired in bootInner; onPaneClick asks it about a trailing click
let ed = null;   // the rack editor (rack/editor.js), made in bootInner: the document and its history

// ── 3D ──────────────────────────────────────────────────────────────────
// Rebuilt after every edit while in 3D (debounced) and whenever the frame
// changes; the old scene's camera is saved and restored on the new one, so a
// rebuild triggered by, say, a swap does not snap the view back to the
// opening one. `epoch` drops a rebuild that was overtaken by a mode switch
// or a faster-arriving one, the same guard rack3d.js's own build() uses.
let stage3dEpoch = 0;
// The last camera a scene actually had, kept even once the scene itself is
// gone: a rebuild started while a PREVIOUS rebuild is still awaiting its
// mount finds S.scene3d already null (the in-flight one cleared it before
// awaiting), and reading the camera off `S.scene3d` at that moment would
// hand the new build a null camera - snapping the view back to the opening
// one on every rebuild that overlaps another. This is updated wherever a
// scene is disposed, so it is always the most recent real camera, in-flight
// build or not.
function disposeScene3d() {
  if (!S.scene3d) return;
  S.camera3d = {position: S.scene3d.three.camera.position.clone(),
                target: S.scene3d.three.controls.target.clone()};
  S.scene3d.dispose();
  S.scene3d = null;
  S.scene3dRack = null;
}
// The waypoints the 3D scene hangs its routed cables by, as one string: the
// scene is rebuilt when this changes (routes are resolved by render(), later
// than the edit that changed them, so sameCables3d alone cannot see them).
// Does the rack have a routed cable (a resolved route with waypoints)? Only then are the
// gutters widened (spec 7); a cable with no route draws as before.
// (the routes of the rack as it is: routesNow, below)
const hasRoutes = () => [...(routesNow()?.routes.values() ?? [])].some(x => x.waypoints?.length);
// THE ROUTES ARE ONE RACK'S (kit 0.17.0, Portrayal #973). S.routes is what the
// last render read for the rack it drew: its paths, and the route context
// they were measured with, which the kit keeps its decisions against. A
// reader that pairs them with the rack as it is NOW (a bundle command, the
// notes of the cable list, the 3D build, a route being picked) takes them
// from here, and gets null while they are another rack's: after an edit,
// until the render it started has read the routes again. Nothing is then
// worked out from the old context. A change that is not a step (the routed
// lengths, the DCIM settings) swaps the rack object and nothing a route
// reads, and re-points them (keepRoutes).
const routesNow = () => (S.routes && S.routes.rack === rack() ? S.routes : null);
// The ring marks too (Portrayal #930): a ring's way through can turn with no waypoint changing.
// And the detours (kit 0.11.0, #949): a body moved can take a cable round it with no waypoint changing.
// And the kit's points (portrayal-site#166): the scene draws each routed cable
// through them, and a plug seated or a body moved changes them with no
// waypoint changing.
const routesSig = rf => (rf ? JSON.stringify([...rf.routes].map(([id, r]) => [id, r.waypoints, rf.marks?.get(id) ?? null,
  rf.detours?.get(id) ?? null, rf.paths?.get(id)?.points ?? null]))
  // and the kit's tight bends (kit 0.17.0): a cable's type can change what it needs with no point moving
  + JSON.stringify((rf.bendsShown ?? []).map(f => [f.cable, f.at, f.text]))
  + bundlesSig(rf) : '');
// How long a rebuild waits for the routes of the rack as it now is (below):
// STALE_3D_TRIES times STALE_3D_MS, then it builds without them.
const STALE_3D_TRIES = 36, STALE_3D_MS = 100;
async function rebuild3d() {
  if (S.mode !== '3d') return;             // overtaken by a switch back to 2D
  const mine = ++stage3dEpoch;
  S.detailFailed = null;      // what the scene before could not draw is not this one's to say
  const camera = S.camera3d;
  // THE SCENE IS HUNG BY THIS RACK'S ROUTES, never the last rack's. After an
  // edit the routes are read again by render(), which can finish after this
  // is due: the build then waits for them rather than hang the new rack's
  // cables on the old rack's paths. The old scene goes first, as it does for
  // any build, so nothing shows a rack that is no longer this one; a newer
  // rebuild or a switch to 2D ends the wait, as it ends a build. A redraw
  // that could not read the routes, or failed before it drew, leaves
  // S.routes null (render), which is not waited for; if the routes of this
  // rack still never come, it builds without them, and the cables hang.
  if (S.routes && S.routes.rack !== rack()) {
    disposeScene3d();
    for (let k = 0; k < STALE_3D_TRIES && S.routes && S.routes.rack !== rack(); k++) {
      await new Promise(done => setTimeout(done, STALE_3D_MS));
      if (mine !== stage3dEpoch || S.mode !== '3d') return;
    }
  }
  const forRack = rack();
  const live = routesNow();
  const sig = routesSig(live);
  disposeScene3d();
  const stage = S.stage;
  const built = await mountRack3d($('stage3d'), {rack: forRack, chassisOf, camera, failFacts: !!S.probeSceneFactsFail,
    routes: live?.routes ?? null, paths: live?.paths ?? null, ctx: live?.ctx ?? null, bundles: bundles3d(live),
    bendOf: (live?.types ?? cableTypes)?.bendOf ?? null, bends: live?.bendsShown ?? null, stage, covers: S.covers,
    onDetailFailed: f => { if (mine === stage3dEpoch) detailFailed(forRack, f); },
    ...(PROBE ? {onScene: s => { S.probeLoading = s; }} : {})});
  if (mine !== stage3dEpoch || S.mode !== '3d') { built?.dispose?.(); return; }
  // No scene: this browser gives no WebGL, or the build failed, and
  // mountRack3d has put its sentence on the stage. S.scene3d stays null.
  if (!built) return;
  // An edit made while this was building that the scene does not read (a
  // cable's label, the rack's name) could not re-point a scene that did not
  // exist yet: the scene is current for the rack as it is now.
  const now = rack();
  S.scene3d = built;
  paintHover3d(built, litFor(now, S.hover));
  paintSelected3d(built, {cable: selectedCable(), bundle: pinnedBundle()}, pinnedLit(now));
  // A swatch picked while this was building found no scene to tell.
  if (S.stage !== stage) built.setStage?.(S.stage);
  // ...and so did a covers setting picked then.
  if (built.covers !== S.covers) paintCovers3d(built, S.covers);
  S.scene3dRack = sameScene(now, forRack) ? now : forRack;
  S.scene3dRoutes = sig;
  // Routes are resolved by render(), after an edit: if they settled while
  // this was building, the scene was hung by the old ones.
  if (routesSig(routesNow()) !== sig) scheduleRebuild3d();
  // A scene built without its cables' faces has no plugs and marks no loose
  // end: 2D says so (render), and so does 3D, once until a build is checked.
  if (built.rackCables && built.rackCables.checked === false) {
    if (!S.unchecked3dSaid) { S.unchecked3dSaid = true; addNotice(UNCHECKED_TEXT, 'note'); render(); }
  } else if (built.rackCables) S.unchecked3dSaid = false;
}
// A PART WHOSE DETAIL COULD NOT BE BUILT IN 3D (a file of its drawing did not
// load) stays the plain box it stood as while loading (rack3d.js standIn),
// marked as one that is not coming. The page says which, once for each part of
// a rack document: a box with nothing said read as loading forever.
function detailFailed(forRack, {id, label}) {
  if (rack() !== forRack && !sameScene(rack(), forRack)) return;   // a scene for a rack that has moved on
  (S.detailFailed ??= new Map()).set(id ?? label, label);
  renderSide();
}
// ...AND IT STAYS SAID WHILE THE PART IS STILL A BOX: not a one-shot notice,
// which the next redraw takes away, but a line of the side panel for as long
// as the scene on screen (or the one being built) has a part that failed.
// Each part once. A new build starts with none and says its own (rebuild3d);
// 2D, where every part is drawn, has none.
function detailFailedLine() {
  if (S.mode !== '3d' || !S.detailFailed?.size) return null;
  return el('p', {id: 'detailFailed', class: 'rk-notice rk-error', role: 'status',
    text: [...S.detailFailed.values()].map(label => `${label} could not be drawn in detail.`).join(' ')});
}
// THE LAST EDIT IS NOT STORED (#198): the library refused the write (the
// browser's storage is full, or blocked). Said for as long as it is true, as
// the line above is, and gone when a later write lands. Save still writes the
// file, which is the way to keep the work.
function saveFailedLine() {
  const err = S.save?.failed();
  if (!err) return null;
  const why = err.name === 'QuotaExceededError' ? "this browser's storage is full" : (err.message || String(err)).replace(/\.$/, '');
  return el('p', {id: 'saveFailed', class: 'rk-notice rk-error', role: 'alert',
    text: `This rack could not be saved in this browser (${why}), so a reload would lose your last changes. Use Save to keep it as a file.`});
}
// WHAT THE 3D SCENE READS OF A RACK: its items, its frame, and of its cables
// their ends and media (cable-rules.js sameCables3d). Two racks that agree on
// those build the same scene. A rack-level field the scene comes to read later
// (zeroU) must be added here, or an edit to it will leave the scene, and a GLB
// exported from it, showing the rack as it was.
const sameScene = (a, b) => a.items === b.items && a.frame === b.frame && a.zeroU === b.zeroU && sameCables3d(a, b);
let rebuild3dTimer = null;
function scheduleRebuild3d() {
  if (S.mode !== '3d') return;
  clearTimeout(rebuild3dTimer);
  rebuild3dTimer = setTimeout(rebuild3d, 300);
}
// The Explorer's switch (mode3d.js): `on` is how it looks, aria-pressed what it says.
function paintMode() {
  for (const b of document.querySelectorAll('#mode [data-mode]')) {
    b.classList.toggle('on', b.dataset.mode === S.mode);
    b.setAttribute('aria-pressed', String(b.dataset.mode === S.mode));
  }
  for (const b of document.querySelectorAll('#view2d [data-view]')) {
    b.classList.toggle('on', b.dataset.view === S.view);
    b.setAttribute('aria-pressed', String(b.dataset.view === S.view));
  }
}
// Is the side pair what the panes show (2D, Left / Right)?
const sidesShown = () => S.mode === '2d' && S.view === 'sides';
// THE STAGE IS THE READER'S, as in the Explorer and Annotate: picked from the
// swatches, remembered (stage.js), and the ground in both views. In 2D it is
// the panes' background, with the site's light or dark palette laid over them
// so the rails, U numbers and tags read on it (rack.css, [data-stage]); in 3D
// it is handed to the scene on screen and to every one built after it.
function setStage(c) {
  S.stage = c;
  $('panes').style.setProperty('--rk-stage', c);
  $('panes').dataset.stage = stageTone(c);
  S.scene3d?.setStage?.(c);
}
// THE COVERS ARE THE READER'S TOO (#190, covers.js): on, see-through or off,
// one setting for the panes (either pair) and the scene, remembered in this
// browser. The panes follow an attribute and rack.css; the scene on screen is
// told, and every one built after it is built with it. Nothing is redrawn,
// and no download reads it.
function setCovers(state) {
  S.covers = state;
  paintCovers2d($('panes'), state);
  paintCovers3d(S.scene3d, state);
}
// Which container is shown. Both the `hidden` property AND an explicit
// inline `display` are set on the one being hidden: `.rk-panes` sets its own
// `display: grid`, an author rule, which always beats the UA's `[hidden] {
// display: none }` regardless of which was written last or how specific it
// is - so `hidden` alone does not hide it, and this needs the inline
// override too. The element being shown has both cleared, falling back to
// its ordinary class (`.rk-panes`'s grid, or a bare div's block).
function showMode() {
  const is3d = S.mode === '3d';
  $('panes').hidden = is3d;
  $('panes').style.display = is3d ? 'none' : '';
  // The zoom controls keep their place in 3D - invisible and inert, not
  // removed - so the 2D/3D switch beside them never moves when it is used.
  $('rkZoom').style.visibility = is3d ? 'hidden' : '';
  $('rkZoom').inert = is3d;
  // The Front / Rear | Left / Right switch is 2D's: in 3D it keeps its place
  // the same way, so the 2D/3D switch beside it does not move either.
  $('view2d').style.visibility = is3d ? 'hidden' : '';
  $('view2d').inert = is3d;
  // Cable mode needs the panes (Phase 2 ruling 7): in 3D the button is off, and says why.
  // And it needs the faces: the side pair is for looking, so there it is off too (#187).
  const sides = !is3d && S.view === 'sides';
  $('cableBtn').disabled = is3d || sides;
  $('cableBtn').title = is3d ? CABLES_3D : sides ? CABLES_SIDES : '';
  $('panes').dataset.view = S.view;
  $('stage3d').hidden = !is3d;
  $('stage3d').style.display = is3d ? '' : 'none';
}
function setMode(m) {
  if ((m !== '2d' && m !== '3d') || m === S.mode) return;
  clearTimeout(rebuild3dTimer);          // a switch answers any pending rebuild itself
  S.mode = m;
  saveMode(m);
  paintMode();
  if ($('exportMenu').open) renderExports();   // the 3D entries follow the mode
  showMode();
  if (m === '3d') {
    // 3D has no ports to click, so Cable mode ends here, and a new cable not
    // yet added goes with it. The side panel is redrawn to say so (render()
    // is not called on the way into 3D).
    if (pendingEnds().length) S.sel = null;
    S.cable = {on: false, a: null};
    paintCableMode();
    renderSide();
    rebuild3d();
    return;
  }
  disposeScene3d();
  S.detailFailed = null;
  // render() skips applying zoom while #panes is hidden (it was, in 3D), so
  // whatever was drawn there while hidden never got a real height - this is
  // what makes the panes come back to life rather than blank.
  render();
}
// FRONT / REAR OR LEFT / RIGHT (#187): one switch for both panes. The side
// pair is view-only, as 3D is: Cable mode ends here, a new cable not yet
// added goes with it, and so does a pick of an empty U (there is none to
// click from the side). A cable, a bundle, a device or a part selected stays
// selected, so a pinned highlight is carried across.
function setView(v) {
  if ((v !== 'faces' && v !== 'sides') || v === S.view) return;
  S.view = v;
  saveView(v);
  paintMode();
  // the hover label is beside a pointer over a pane that is about to be replaced (a switch by keyboard leaves the pointer where it was)
  hideTip();
  if (v === 'sides') {
    if (pendingEnds().length || S.sel?.kind === 'u') S.sel = null;
    S.cable = {on: false, a: null};
    S.routePick = null;
    paintCableMode();
  }
  showMode();
  if (S.mode !== '2d') return;
  // THE SWITCH IS ANSWERED AT ONCE, the panes a moment later: the headings
  // name the pair now, and the panes are marked busy (aria-busy; rack.css
  // fades them and shows the progress cursor) until the pair asked for is
  // drawn. A redraw overtaken by another switch leaves the mark to that one.
  [$('headFront').textContent, $('headRear').textContent] = PAIRS[v];
  const mine = ++viewTurns;
  $('panes').setAttribute('aria-busy', 'true');
  render({keepRoutes: true}).finally(() => { if (mine === viewTurns) $('panes').removeAttribute('aria-busy'); });
}
let viewTurns = 0;
const rack = () => ed.rack();
const theDoc = () => ed.getDoc();
const itemById = id => rack().items.find(i => i.id === id) || null;
// A name for any id a note can carry: a device's, or a part's beside the rack.
const nameOfId = id => itemById(id)?.label ?? zeroUById(rack(), id)?.label ?? id;

// What removing a host leaves behind (spec section 5): its managers stay on
// the rack, on their own. '' when it had none.
function managersStay(r, hostId) {
  const ms = managersOf(r, hostId);
  return ms.length ? ` Its cable manager${ms.length === 1 ? '' : 's'} ${ms.map(m => m.label).join(', ')} stay${ms.length === 1 ? 's' : ''} on the rack.` : '';
}

// Bolt an unhosted manager over the device now at its U. It acts on the
// manager as it is now, or says it is gone.
function attachManager(id) {
  if (!itemById(id)) { S.notice = {text: GONE, kind: 'error'}; render(); return; }
  edit({op: 'attach', id}, {say: true});
}

// The readout is a percentage of Fit's own factor (recomputed every time,
// since Fit's factor moves with the window and with what's drawn), not of
// the raw column-width factor - a controller ruling, so this needs
// recomputing after every render and every resize, not just when the zoom
// itself changes.
// (Every place that applies the zoom says its label straight after, so this is
// also where a side pane's own words are kept readable at the scale it now
// has: side-elevation.js sizeSideLabels. Size only; nothing is redrawn.)
// (and where a strap is kept to its size on screen: strap-size.js sizeStraps, #190)
const setZoomLabel = () => { $('zoomLevel').textContent = zoomLabel(S.zoom, factorForFit($('panes'), S.svgs[0])); sizeSideLabels(S.svgs); sizeStraps(S.svgs); };
const setZoom = z => { S.zoom = z; saveZoom(z); applyZoom($('panes'), S.svgs, z); setZoomLabel(); };

// A stored document can be missing (deleted from another tab) or fail to
// parse (spec §5 rejects it). Either way this reports null rather than
// throwing, so every caller can fall back instead of taking the page down.
async function getDoc(id) {
  try { return await S.lib.get(id); }
  catch (err) { console.warn('[portrayal] could not read a stored rack', id, err); return null; }
}

// The picker judged the fit against the rack it was built for, and its Place
// button can outlive that rack (a redraw still on its way): the place command
// judges it again, against the rack as it is now.
// A part that stands beside the rack goes in its zero-U record, at the upright
// chosen, its bottom level with this U; a narrow rail part on the rail chosen
// (the kit's zerou.place and side.place, #926). Everything else is the kit's place.
function place(entry, cfg, face, ru, extra = {}) {
  const label = entry.model || entry.name;
  if (isZeroUPart(entry)) {
    const res = edit({op: 'zerou.place', ref: entry.name, cfg, at: extra.at, ru, between: !!extra.between, label});
    if (!res.error) S.sel = {kind: 'zerou', id: res.created.ids[0]};
    return;
  }
  const res = edit(isNarrow(entry) && extra.side ? {op: 'side.place', ref: entry.name, cfg, face, ru, side: extra.side, label}
    : {op: 'place', ref: entry.name, cfg, face, ru, label});
  if (!res.error) S.sel = {kind: 'item', id: res.created.ids[0]};
}

// A change to a placed item: a move (ru, face) or a patch (the rest). The
// command checks it against the rules and says no with the reason, which the
// caller shows its own way (the inspector beside its control, a drag in the
// notice). The cleared-Explorer-changes note arrives as a finding.
const defined = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
function patchItem(id, patch) {
  // A control of a panel built for an earlier rack (the redraw that replaces
  // it is still on its way): the device may be gone. Nothing is sent.
  if (!itemById(id)) { S.notice = {text: GONE, kind: 'error'}; render(); return {ok: false, reason: GONE}; }
  if (['ru', 'face'].some(k => k in patch)) {
    const res = edit({op: 'move', id, ...defined({ru: patch.ru, face: patch.face})}, {report: false});
    return res.error ? {ok: false, reason: res.error} : {ok: true};
  }
  const res = edit({op: 'patch', id, ...defined(patch)});
  return res.error ? {ok: false, reason: res.error} : {ok: true};
}

// The lens is awaited across a render gap: the rack it opened for can be
// gone (another rack switched in) or the item removed by the time it
// resolves, and a repeated item id (i1, i2, ...) is not unique across
// racks - so the write-back is guarded by both the document and the ref.
async function explore(id) {
  const it = itemById(id);
  if (!it) { render(); return; }               // a stale panel's button: the device is gone
  const docId = theDoc().id, ref = it.ref;
  const res = await openLens({ref: it.ref, cfg: it.cfg, swaps: it.swaps, fields: it.fields, title: it.label});
  if (res && theDoc().id === docId && itemById(id)?.ref === ref)
    patchItem(id, {cfg: res.config, swaps: res.swaps, fields: res.fields});
}

// THE ONE WAY AN EDIT REACHES THE RACK: a command, through the editor (spec
// §3.1). The editor's change listener (onChange) saves, redraws and keeps or
// rebuilds the 3D scene; this only reports a refusal. `say` puts the step's
// summary in the notice, where an edit with an Undo said what it did before
// every edit had one. `report: false` leaves the refusal to the caller (a drag,
// the arrow keys, the inspector), which says it its own way. An edit that changes nothing
// still redraws, as the caller may have changed the selection, unless `quiet`:
// the frame form's echoed change event (see onFrame) must not redraw, or it
// would wipe the notice the first pass just showed.
function edit(cmds, {say = false, report = true, quiet = false} = {}) {
  // (an end given a drawing id is refused here, with the path to use: part-path.js)
  const idNo = projectionIdRefusal(cmds);
  const res = idNo ? {error: idNo} : ed.apply(cmds, {origin: 'ui', ...(bundling(cmds) ? {ctx: bundleCtx()} : {})});
  // A refusal the caller reports is its to redraw too: the inspector shows it
  // beside the control it snaps back, and a redraw would take that away.
  if (res.error) { if (report) { S.notice = {text: res.error, kind: 'error'}; renderSoon(); } return res; }
  if (say && !res.noop && res.summary) { addNotice(res.summary, 'note'); S.saidStep = res.summary; }
  if (res.noop && !quiet) renderSoon();
  return res;
}
// A BUNDLE COMMAND READS THE ROUTES (kit 0.7.0, docs/cable-bundles-design.md
// 3.1): the last render's routing context and the cable types' diameters, so
// the kit works a trunk out from its cables and checks its size. Without them
// a bundle is still made, with a route given, and is reported not checked.
// The bundle panels send them (bundlePanel, bundleFormPanel, portrayal-site#142);
// the agent's edit_rack sends them with its own context (agentContext).
const bundling = cmds => (Array.isArray(cmds) ? cmds : [cmds]).some(c => typeof c?.op === 'string' && c.op.startsWith('bundle.'));
// The cable types come from the page's own load, or from the routes' when the
// page's has not finished (route-context.js withCableTypes, portrayal-site#164).
// Only the context read for the rack as it is now (routesNow): a command sent
// before the render after an edit has read the routes again goes without one.
const bundleCtx = () => { const now = routesNow(); return withCableTypes(now?.ctx ? {route: now.ctx} : {}, cableTypes ?? S.routes?.types ?? null); };
// The published cable types (cable-types.json), loaded once; null until then,
// or when they cannot be read (a bundle's size then counts each cable by its
// media, as fill does, and says it is an estimate).
let cableTypes = null;
const cableTypesReady = loadCableTypes(DIST).then(t => { cableTypes = t; return t; })
  .catch(err => { console.warn('[portrayal] cable types', err); return null; });

// A redraw queued for the end of this task: whatever the caller sets after an
// edit (the selection, where the keyboard goes) is set before render() reads it.
let renderQueued = false;
function renderSoon() {
  if (renderQueued) return;
  renderQueued = true;
  queueMicrotask(() => { renderQueued = false; render(); });
}
// An agent's edit is outlined for a moment (spec §5). Each render redraws the
// SVG, so the mark is put back on until it runs out, then taken off.
function paintAgentMark() {
  const m = S.agentMark;
  if (!m) return;
  const on = Date.now() < m.until;
  markTouched(document, m.ids, on);
  if (!on) { S.agentMark = null; return; }
  clearTimeout(S.agentMarkTimer);
  S.agentMarkTimer = setTimeout(paintAgentMark, m.until - Date.now() + 20);
}
function onChange(ev) {
  if (ev.cause === 'load') { if (ev.findings.length) S.save.save(theDoc()); return; }
  if (ev.cause === 'apply' && ev.origin === 'agent') {
    if (ev.summary) addNotice(`Your assistant: ${ev.summary}`, 'note');
    if (agentHighlightOn()) S.agentMark = {ids: touchedIds(ev), until: Date.now() + AGENT_MARK_MS};
  }
  for (const f of ev.findings) addNotice(f.text, f.kind);
  // The notice says this step only when the step raised it: a finding that is
  // its summary (a shrink), or edit()'s `say`, which runs after this. "Undid: X"
  // is not step X, even when the step Undo now takes back is also called X.
  S.saidStep = ev.cause === 'apply' && ev.summary && ev.findings.some(f => f.text.includes(ev.summary)) ? ev.summary : null;
  // An agent's step is said by its "Your assistant:" notice, which serves as Undo's description.
  if (ev.cause === 'apply' && ev.origin === 'agent' && ev.summary) S.saidStep = ev.summary;
  if (ev.cause === 'undo' || ev.cause === 'redo')
    addNotice(`${ev.cause === 'undo' ? 'Undid' : 'Redid'}: ${ev.summary}`, 'note');
  // (written now, before the redraw this edit asks for: library.js autosaver)
  S.save.save(theDoc());
  // The 3D view draws the cables: a change that adds or removes one, or
  // changes a cable's ends or media, changes the tubes and the plugs seated
  // for them, and goes the same debounced rebuild a device edit does. A change
  // the scene reads nothing of (a cable's label, purpose or length, the rack's
  // name, the DCIM settings) keeps it, re-pointed at the new rack, but only if
  // it was current. An export already running holds the old rack and is
  // discarded by modelExport's guard, as for any change.
  if (sameScene(ev.before, ev.after)) keepScene(ev.before, ev.after);
  else scheduleRebuild3d();
  // What is not a step changes nothing a route reads: the routes stay this rack's.
  // (and so does the one reading of the rack that every reader shares: reading.js)
  if (!ev.step) { keepRoutes(ev.before, ev.after); sameReading(ev.before, ev.after); }
  // NOT A STEP, NOT A REDRAW: the DCIM settings are stored from inside render()
  // (flushDcimDraft) and the routed lengths during one, so redrawing for them
  // would loop. Neither changes what the page shows.
  if (ev.step) renderSoon();
  // what the rack keeps and the page does not draw is said for the rack as it is now
  if (ev.step) sayKept();
}
// A change the scene reads nothing of swaps the rack object under it. The scene
// is kept and re-pointed at the new rack, but only if it was current for the
// old one: a scene an earlier edit already made stale stays stale. The ONE
// place this is decided, for every change the editor reports (onChange).
function keepScene(prev, next) {
  if (S.scene3d && S.scene3dRack === prev) S.scene3dRack = next;
}
// The routes read for the old rack object are the new one's too, but only if
// they were current for the old one (as keepScene, for a change that is not a
// step: onChange).
function keepRoutes(prev, next) {
  if (S.routes && S.routes.rack === prev) S.routes = {...S.routes, rack: next};
}
function select(sel) { S.sel = sel; S.pinOff = false; render(); }
// `notes` are what parseDoc said of the bundles it repaired (library.js
// docNotes): the editor gives them back as its first findings.
function setDoc(doc, notes = docNotes(doc)) {
  docsSet++;                 // a bundle command still waiting was for the document before (bundleCommand)
  const {findings} = ed.loadDoc(doc, {notes});   // settles managers; clears history; saves a repair (onChange)
  S.sel = null; S.cable.a = null; S.dcimDraft = null;
  S.routes = null;           // the last document's routes are not this one's (the 3D build reads them)
  S.bendsSaid = '';          // nor its tight bends: this document's are said once of their own
  // (what the kit keeps and does not act on stands in the panel while it is true: sayKept. Not said twice.)
  const stands = new Set(frameNotices(rack(), chassisOf));
  for (const f of findings) if (!stands.has(f.text)) addNotice(f.text, 'note');
  S.cableFilter = {purpose: null, media: null};
  // "Said once" is once per rack: another rack's unchecked scene is announced too.
  S.unchecked3dSaid = false;
  try { localStorage.setItem(LAST, theDoc().id); } catch { /* a convenience, not state */ }
  render();
  renderLibrary();
  if (S.mode === '3d') rebuild3d();
  S.kept = []; S.keptLate = [];
  sayKept();
}

// WHAT THE RACK CARRIES THAT THIS PAGE KEEPS AND DOES NOT YET DRAW OR ACT ON
// (rack file version 4, kit 0.22.0). The rack is loaded, drawn and saved
// whole; what the page cannot show is SAID, beside its other notices, for as
// long as it is true, and never drawn as something it is not:
//   - the kit's sentences for what it keeps and does not act on (fit.js
//     frameNotices: a rail width, a channel, a quarter turn, a held item);
//   - the kit's sentences that need the devices' parts lists (loadSlots): a
//     part hung on brackets that does not hang as the rack says (zero-u.js
//     hangNotices), a state or a reading kept and not applied (states.js
//     stateNotices);
//   - a device mounted upside down, in the kit's sentence (rollNote): it is
//     fitted, routed and exported as mounted, and drawn upright;
//   - states and readings that do apply: kept, exported, and not drawn.
// DERIVED FROM THE RACK AS IT IS, AFTER EVERY CHANGE (setDoc, and onChange for
// every step: an edit here, an assistant's, undo, redo), not said once when a
// file opens: a roll, a state, a reading or a hang set by a command is said as
// one read from a file is, and its sentence goes when the key does. They stand
// in the side panel (keptParagraphs) until then; a version-3 rack has none.
const keptOf = r => ({
  hung: zeroUOf(r).some(z => z.heldBy != null), rolled: r.items.filter(i => rollOf(i) === 180),
  set: [...r.items, ...zeroUOf(r)].filter(e => e.states != null || e.readings != null || e.readingsAsWritten != null)});
let keptRun = 0;
async function sayKept() {
  const mine = ++keptRun, r = rack(), k = keptOf(r);
  const said = [...frameNotices(r, chassisOf),
    ...k.rolled.map(i => `${i.label}: ${rollNote(i)} It is fitted, routed and exported that way, and drawn upright here.`)];
  if (k.set.length) said.push(`${k.set.length === 1 ? `${k.set[0].label || k.set[0].ref} carries` : `${k.set.length} parts carry`} outlet states or readings: they are kept in the file and written to the exports, and not drawn here yet.`);
  // what needs no parts list is said at once; the rest when the lists are read
  const show = list => { if (mine !== keptRun || rack() !== r) return;
    if (JSON.stringify(list) !== JSON.stringify(S.kept ?? [])) { S.kept = list; renderSoon(); } };
  // (the kit's sentences of the last reading stand meanwhile, so the panel does not blink at every edit)
  show([...said, ...(k.hung || k.set.length ? S.keptLate ?? [] : [])]);
  if (!k.hung && !k.set.length) { S.keptLate = []; return; }
  try {
    const ctx = await agentContext(r, zeroUOf(r).map(z => z.ref));
    const late = [...(k.hung ? hangNotices(r, ctx) : []), ...(k.set.length ? stateNotices(r, ctx) : [])];
    if (mine !== keptRun || rack() !== r) return;
    S.keptLate = late;
    show([...said, ...late]);
  } catch (err) { console.warn('[portrayal] what the rack keeps could not be checked', err); }
}
// The sentences of sayKept, as they stand in the side panel: status, not alerts.
const keptParagraphs = () => (S.kept ?? []).map(text => el('p', {class: 'rk-notice rk-muted', role: 'status', 'data-kept': '', text}));

// ── Cable mode (spec §9.2) ──────────────────────────────────────────────
// A tool state beside 2D/3D: while it is on, a click in a pane picks a port
// instead of selecting a device, and the drag controller is off. The A end
// waits in S.cable.a; the B end opens the cable form with both.
const pendingEnds = () => (S.sel?.kind === 'cable-form' && !S.sel.id ? [S.sel.a, S.sel.b] : []);
function paintCableMode() {
  $('cableBtn').setAttribute('aria-pressed', String(S.cable.on));
  $('panes').classList.toggle('rk-cabling', S.cable.on);
}
function setCableMode(on) {
  S.cable = {on: !!on && S.mode === '2d' && S.view === 'faces', a: null};
  // Entering clears the selection; leaving drops a new cable not yet added.
  if (S.cable.on || (S.sel?.kind === 'cable-form' && !S.sel.id)) S.sel = null;
  paintCableMode();
  render();
}
// A picked end never outlives its device or its port: whenever the rack
// changes under Cable mode (a frame shrink removes a device, Undo brings it
// back, a taken port) the pick is dropped, and a new-cable form whose end's
// device is gone is closed with a sentence. Run at the top of every render.
// One sentence for the page and the files (export-data.js): both say the same thing happened.
const UNCHECKED_TEXT = UNCHECKED_NOTE;
function addNotice(text, kind = 'error') {
  const old = S.notice && (typeof S.notice === 'string' ? {text: S.notice, kind: 'error'} : S.notice);
  // Overlapping redraws can raise the same sentence twice before either shows it.
  if (old?.text.includes(text)) return;
  S.notice = old ? {text: `${old.text} ${text}`, kind: old.kind} : {text, kind};
}
function pruneCable() {
  const r = rack(), a = S.cable.a;
  if (a && (!itemById(a.item) || !portFree(r, a, {uOf}).ok)) S.cable.a = null;
  const s = S.sel;
  if (s?.kind === 'cable-form' && !s.id && !(itemById(s.a.item) && itemById(s.b.item))) {
    S.sel = null;
    addNotice(NOT_ADDED);
  }
}
function onCableClick(ev) {
  if (S.sel?.kind === 'cable-form') return;      // the form is open: finish or cancel it first
  const group = ev.target.closest('[data-item-id][data-panel]');
  const item = group ? itemById(group.dataset.itemId) : null;
  const path = item && group.dataset.panel !== 'missing' ? portAt(ev.target, group) : null;
  if (!path) return;
  // The end's view is the device's own panel, not the pane it was clicked in.
  const end = {item: item.id, path, view: panelFor(item, group.closest('svg').dataset.pane)};
  if (S.cable.a && sameEnd(S.cable.a, end)) { S.cable.a = null; render(); return; }   // the same port again: unpick it
  const free = portFree(rack(), end, {uOf});
  if (!free.ok) { S.notice = {text: free.reason, kind: 'error'}; render(); return; }
  if (!S.cable.a) { S.cable.a = end; render(); return; }
  // The A end is checked again now: the rack may have changed since it was picked.
  if (!itemById(S.cable.a.item) || !portFree(rack(), S.cable.a, {uOf}).ok) { S.cable.a = null; render(); return; }
  S.sel = {kind: 'cable-form', id: null, a: S.cable.a, b: end};
  S.cable.a = null;
  render();
}
function cableModePanel() {
  const a = S.cable.a;
  return el('div', {id: 'cableHelp'}, [
    el('h3', {text: 'Cable'}),
    el('p', {id: 'cableStep', class: 'rk-muted', role: 'status', text: a
      ? `From ${endName(rack(), a, uOf)}. Click the port at the other end, on either face. Esc starts over.`
      : 'Click the port at one end, on either face. Esc leaves Cable mode.'})]);
}
// The form for a new cable (sel.a and sel.b, picked on the drawing) or for
// an existing one (sel.id). What is known about each end comes from the
// render that drew this panel (S.cableFacts).
function cableFormPanel(sel) {
  const r = rack();
  const cable = sel.id ? r.cables.find(c => c.id === sel.id) : null;
  if (sel.id && !cable) { S.sel = null; return homePanel(); }
  const a = cable ? cable.a : sel.a, b = cable ? cable.b : sel.b;
  const info = e => S.cableFacts.ends.get(endKey(e))?.info || null;
  const form = cableForm({
    title: cable ? 'Edit cable' : 'New cable', endA: endName(r, a, uOf), endB: endName(r, b, uOf),
    cable: cable || {media: proposeMedia(info(a), info(b)), purpose: '', label: '', length: null},
    infoA: info(a), infoB: info(b),
    routed: cable?.length?.source === 'routed' ? cable.length : null,
    purposes: [...countsBy(r.cables, 'purpose').keys()].filter(Boolean),
    // A saved cable is left selected: lit on the drawing, its row open in the list.
    onSave: fields => {
      // The rack as it is NOW: it may have changed while the form was open (Undo).
      const now = rack();
      if (cable) {
        // The cable may be gone: then there is nothing to save, and nothing is sent.
        const cur = now.cables.find(c => c.id === cable.id);
        if (!cur) { S.sel = null; render(); return; }
        S.sel = {kind: 'cable', id: cable.id}; S.cableDraft = null;
        // A media from a file this page does not know stays as itself: left
        // alone, it is not sent, so the command's list of media never refuses it.
        const {media, ...rest} = fields;
        edit({op: 'cable.update', id: cable.id, ...rest, ...(media === (cur.media ?? '') ? {} : {media})});
        return;
      }
      // The command's refusals are NOT_ADDED (a device is gone) and canCable's sentence.
      const res = edit({op: 'cable.add', a, b, ...fields});
      S.sel = res.error ? null : {kind: 'cable', id: res.created.ids[0]};
    },
    onCancel: () => { S.cableDraft = null; select(cable ? {kind: 'cable', id: cable.id} : null); }});
  if (!cable) return form;
  const d = S.cableDraft?.id === cable.id ? S.cableDraft.values : null;
  if (d) {
    for (const [k, v] of Object.entries(d)) form.querySelector(`#${k}`).value = v;
    if ('cMedia' in d) form.querySelector('#cMedia').dispatchEvent(new Event('change'));   // the mismatch warning follows
  }
  const wrap = el('div', {}, [form, routePanel(cable)]);
  // Only what the viewer typed is kept: a field they never touched follows the
  // cable (a routed length changes with the route, and an untouched one is never sent).
  const keep = ev => {
    const k = ev.target.id;
    if (!['cMedia', 'cPurpose', 'cLabel', 'cLength', 'cUnit'].includes(k)) return;
    S.cableDraft = {id: cable.id, values: {...(S.cableDraft?.id === cable.id ? S.cableDraft.values : {}), [k]: ev.target.value}};
  };
  form.addEventListener('input', keep);
  form.addEventListener('change', keep);
  return wrap;
}

// Every route edit stores the whole list and is one Undo step (spec §6), named
// by what was done: `text` is the notice and the Undo's description. A null
// list resets the cable to its own route. Guarded like the managers' actions:
// the panel may be stale (Undo, another edit).
function editRoute(cableId, list, text) {
  const now = rack();
  if (!now.cables.some(x => x.id === cableId) || S.sel?.kind !== 'cable-form' || S.sel.id !== cableId) {
    S.routePick = null; if (S.sel?.id === cableId || !now.cables.some(x => x.id === cableId)) S.sel = null; render(); return;
  }
  S.focusNext = 'routeAdd';
  edit(list ? {op: 'cable.route', id: cableId, route: list, summary: text}
            : {op: 'cable.route.reset', id: cableId, summary: text}, {say: true});
}
// The waypoints a cable shows: the stored list once edited, else the page's own choice.
function shownRoute(cable) {
  const res = routesNow()?.routes.get(cable.id);
  const nameOf = id => itemById(id)?.label ?? id;
  const frame = rack().frame;
  const list = cable.routeEdited ? cable.route ?? [] : res?.waypoints ?? [];
  const gone = new Set(cable.routeEdited ? (res?.gone ?? []) : []);
  return {list, auto: !cable.routeEdited,
    rows: list.map(w => ({text: routeText([w], nameOf, frame), gone: gone.has(w)}))};
}
function routePanel(cable) {
  const id = cable.id, {list, auto, rows} = shownRoute(cable);
  const picking = S.routePick?.cableId === id;
  const sel = S.routeSel?.cableId === id && S.routeSel.i < list.length ? S.routeSel.i : null;
  // A moved row keeps the selection; a removed one drops it.
  const swap = (i, j) => { if (j < 0 || j >= list.length) return;
    const l = [...list]; [l[i], l[j]] = [l[j], l[i]];
    if (sel === i) S.routeSel = {cableId: id, i: j};
    editRoute(id, l, 'Waypoint moved.'); };
  return el('div', {}, [
    routeList({rows, auto, selected: sel,
      onSelect: i => { S.routeSel = {cableId: id, i};
                       if (picking) S.routePick = {cableId: id, at: i + 1};
                       S.focusNext = `routeRow-${i}`; render(); },
      onUp: i => swap(i, i - 1), onDown: i => swap(i, i + 1),
      onRemove: i => { S.routeSel = null; editRoute(id, list.filter((_, k) => k !== i), 'Waypoint removed.'); },
      onAdd: () => { S.routePick = {cableId: id, at: sel === null ? list.length : sel + 1}; S.focusNext = 'routeAdd'; render(); },
      onReset: () => { S.routeSel = null; editRoute(id, null, 'Route reset to automatic.'); }}),
    ...(picking ? [el('p', {id: 'routePickHelp', class: 'rk-muted', role: 'status',
      text: 'Click a ring, duct, brush or the gutter beside a rail. Esc stops.'})] : [])]);
}

// Pick targets for a route being edited: every pathway the pane draws, and a
// lane target per U on each gutter (the rear pane mirrors the sides).
function drawRoutePicking() {
  const r = rack(), ctx = routesNow()?.ctx;
  for (const svg of S.svgs) {
    const view = svg.dataset.pane, targets = [];
    if (ctx) for (const it of r.items) for (const g of ctx.guidesOf(it.id)) {
      const e = wayEl(svg, {item: it.id, via: g.via});
      if (e) targets.push({item: it.id, via: g.via, box: inPane(svg, e)});
    }
    const sides = r.frame.kind === 'two-post' ? ['left', 'right'] : ['left', 'right'].map(sd => `${sd}-${view}`);
    for (const lane of sides) {
      const left = (view === 'front') === lane.startsWith('left');
      const x = left ? -RAIL_W - LANE_GAP : OPENING + RAIL_W;
      for (let ru = 1; ru <= r.frame.heightRU; ru++)
        targets.push({lane, ru, x, y: (r.frame.heightRU - ru) * RU, w: LANE_GAP, h: RU});
    }
    drawPickTargets(svg, targets);
  }
}

// ── The cable list (spec §9.4) ──────────────────────────────────────────
// Shown under the summary (or under Cable mode's help) whenever the rack has
// cables. The filter is the viewer's, not the document's: S.cableFilter.
const selectedCable = () =>
  (S.sel?.kind === 'cable' || (S.sel?.kind === 'cable-form' && S.sel.id) ? S.sel.id : null);
// A filter value no cable has any more (its last cable was edited or deleted,
// or there are none) would ghost every cable with no button left to release
// it. One helper, run before anything is painted and before the list is built.
function pruneFilter() {
  const r = rack(), on = {...S.cableFilter};
  for (const f of ['purpose', 'media']) if (on[f] != null && !countsBy(r.cables, f).has(on[f])) on[f] = null;
  S.cableFilter = on;
}
// WHETHER EVERY ROUTED LENGTH ALREADY STANDS AS THE KIT WOULD WRITE IT, from
// the lengths routeFacts just read (the kit's pathLength of each cable's own
// path): the test withRoutedLengths makes for each cable (route.js), without
// laying the cables again. True only when it is certain: a cable that states
// slack values is measured with them by the kit (routedLength), not by this
// reading, so a rack with one is always asked.
function lengthsStand(r, rf) {
  for (const c of r.cables || []) {
    if (c.lengthAsWritten != null || (c.length && c.length.source !== 'routed')) continue;
    if (Array.isArray(c.slack) && c.slack.length) return false;
    const got = rf.lengths.get(c.id);
    if (!got) continue;
    const need = Math.round(got.need * 100) / 100;
    if (!(c.length?.value === got.value && c.length?.need === need && !('measured' in c.length))) return false;
  }
  return true;
}
// EACH CABLE'S SPARE (spare.js: the kit's spareOf), by the route context read
// for the rack as it is (routesNow): none while it is another rack's, none for a cable with a
// loose end, which is not drawn along its path, and none at all while the ends
// could not be checked (an end not known to land is not said to have spare).
// The list, the 2D titles and the hover label all read this, so they say one figure.
// READ ONCE FOR A RACK, ITS ROUTES AND ITS ENDS: the list, the pane's titles
// and the hover label each ask, on every redraw of the side panel, and the
// kit's spareOf lays the cable again each time it is asked (it keeps which lay
// it chose, not the lay). A rack is never changed in place, so the answer for
// the same three objects is the same Map.
let sparesMemo = null;
const sparesNow = () => {
  const r = rack(), ctx = S.cableFacts.unchecked ? null : routesNow()?.ctx ?? null, facts = S.cableFacts;
  if (!sparesMemo || sparesMemo.rack !== r || sparesMemo.ctx !== ctx || sparesMemo.facts !== facts)
    sparesMemo = {rack: r, ctx, facts, map: sparesOf(r, ctx, looseIn(facts.ends), ctx ? routesNow()?.readRack ?? null : null)};
  return sparesMemo.map;
};
// THE LIST'S ROWS, OPEN OR CLOSED (#190, cable-tree.js): the reader's, per rack
// document, in this browser. A row nobody touched starts open in a small rack
// and closed in a large one. A CABLE PINNED OPENS THE ROW IT IS UNDER, once,
// when it is pinned (from the stage or the list), and its own row is scrolled
// into view: the reader can still close that row with the cable pinned.
function treeHooks(r) {
  const t = S.tree, docId = theDoc().id;
  if (t.doc !== docId) Object.assign(t, {doc: docId, state: loadTree(docId), stop: null, pinned: null, show: null});
  const open = key => isOpen(t.state, key, r.cables.length);
  const set = (key, on) => { t.state = {...t.state, [key]: on}; saveTree(docId, t.state); };
  const pin = selectedCable();
  if (pin !== t.pinned) {
    t.pinned = pin;
    if (pin != null) {
      const key = bundleOfCable(r, pin)?.id ?? LOOSE;
      if (!open(key)) set(key, true);
      t.show = pin;
    }
  }
  // (`state(key)`: what the reader set for a row, undefined if never: the Warnings section starts closed whatever the rack's size)
  return {open, state: key => t.state[key], stop: t.stop, onToggle: set, onStop: id => { t.stop = id; }};
}
function cableListPanel() {
  const r = rack();
  pruneFilter();
  const on = S.cableFilter;
  // Fill, capacity and gone-waypoint warnings, from the routes resolved for this render.
  // (the routes read for this rack: routesNow)
  const now = routesNow();
  // ...and each tight bend the page rings, in the kit's sentence: the notice
  // says them once, and here they stay, beside the ring and body findings.
  // (the ring and body findings as the routes read them: routesNow() is these routes for this rack, names and all)
  const lap = lapsOf();
  // (by kind and by what each is about: the list shows them as one section that opens, cable-panel.js warningsSection;
  // what the reader has opened there is kept with the tree's rows, per rack document)
  const warnings = now ? routeWarnings(r, now, nameOfId, {bends: now.bendsShown ?? [], asRead: true}) : [];
  lap('notes');
  const spares = sparesNow();
  lap('spares');
  if (lap.times) queueMicrotask(() => { lap('list'); S.probeSide = {...lap.times, notes_n: warnings.reduce((n, k) => n + k.rows.reduce((m, x) => m + x.texts.length, 0), 0)}; });
  return cableList({rack: r, ends: S.cableFacts.ends, warnings, on, uOf, selectedId: selectedCable(), mode3d: S.mode === '3d',
    // a finding picked pins its cable, as its row in the tree does, or selects its manager
    onWarningPick: w => select(w.cable ? {kind: 'cable', id: w.cable} : {kind: 'item', id: w.item}),
    spares,
    tree: treeHooks(r),
    ...bundleListHooks(),
    onFilter: next => {
      S.cableFilter = next;
      renderSide();
      paintCables(S.svgs, rack(), {selectedId: selectedCable(), bundleId: pinnedBundle(), on: next});
    },
    // A second click on the selected row lets it go.
    onSelect: id => select(selectedCable() === id ? null : {kind: 'cable', id}),
    onEdit: id => select({kind: 'cable-form', id}),
    onDelete: id => {
      const c = rack().cables.find(x => x.id === id);
      if (!c) { render(); return; }            // a stale row's button: the cable is already gone
      S.sel = null;
      S.focusNext = 'undoShrink';              // Delete is gone with its row: the keyboard goes to Undo
      edit({op: 'cable.remove', id}, {say: true});
    }});
}
// What the side panel shows with nothing selected, or with a cable selected:
// the summary (or Cable mode's help), then the cable list.
// ── Bundles (portrayal-site#142) ─────────────────────────────────────────
// A bundle is selected from its header row in the cable list ({kind:
// 'bundle', id}) and edited in the side panel; a new one is made from the
// cables ticked in a form ({kind: 'bundle-form', picked}). Every change is one
// of the kit's bundle.* commands, sent through edit() with the last render's
// routing context (bundleCtx). The drawings, the list and the 3D scene read
// routeFacts' `bundles` (bundle-view.js bundleFacts).
const selectedBundle = () => (S.sel?.kind === 'bundle' ? S.sel.id : null);
// The bundle whose highlight is pinned: the selected one, unless its panel's pin is off.
const pinnedBundle = () => (S.pinOff ? null : selectedBundle());
const bundleListHooks = () => ({bundles: routesNow()?.bundles ?? null, selectedBundle: selectedBundle(),
  // (the list is replaced by the bundle's panel: the keyboard goes to the panel's pin, not to the page's body)
  onBundleSelect: id => { if (selectedBundle() !== id) S.focusNext = 'bPin'; select(selectedBundle() === id ? null : {kind: 'bundle', id}); },
  onBundleNew: id => select({kind: 'bundle-form', picked: [id]})});
// A bundle command from a panel: a refusal is shown beside the control, not as a notice.
// A BUNDLE COMMAND FROM A PERSON WAITS FOR THE RACK'S ROUTES. Right after an
// edit the routes are being read again (render), and until they are the page
// has none for the rack as it is (routesNow). Sent then, a command would be
// refused by the kit for want of a route nobody can type here, or go through
// "not checked" for something that is checked a moment later. So it waits for
// the redraw in hand, up to ROUTES_WAIT_MS, and is sent with this rack's
// routes. With the routes current it is sent at once, and answers at once.
// Only if they still have not come is it refused, in the page's own words.
// A rack whose routes cannot be read at all (S.routes null, nothing in hand)
// is as before: the kit makes what it can and says it is not checked.
const ROUTES_WAIT_MS = 4000;
const ROUTES_BUSY = 'The cable routes are still being worked out after the last change. Try again in a moment.';
const NO_ROUTES_HERE = 'The cable routes could not be read, so these cables cannot be bundled here.';
const routesInHand = () => renderQueued || rendering > 0 || (!!S.routes && S.routes.rack !== rack());
// A COMMAND THAT WAITED IS FOR THE DOCUMENT IT WAS GIVEN FOR. While it waits
// another rack can be opened (a file, the library, a new rack: setDoc), and
// that one usually has a c9 and a c10 as well: the command is then dropped,
// with no answer and nothing done, never sent to a rack nobody asked about.
// `docsSet` counts the documents put in; the id is compared as well.
let docsSet = 0;
function bundleCommand(cmd, after = res => (res.error ? {error: res.error} : null)) {
  const forDoc = theDoc().id, forSet = docsSet;
  const send = () => {
    if (!routesNow() && routesInHand()) return {error: ROUTES_BUSY};
    const res = edit(cmd, {say: true, report: false});
    // the kit's refusal asks for a route; the form has no such field
    return !routesNow() && cmd.op === 'bundle.create' && /routes are not known/.test(res.error ?? '') ? {error: NO_ROUTES_HERE} : res;
  };
  if (routesNow() || !routesInHand()) return after(send());
  return (async () => {
    const until = Date.now() + ROUTES_WAIT_MS;
    const moved = () => docsSet !== forSet || theDoc().id !== forDoc;
    while (!moved() && !routesNow() && routesInHand() && Date.now() < until) await new Promise(done => setTimeout(done, 25));
    return moved() ? {dropped: true} : after(send());
  })();
}
const bundleEdit = cmd => bundleCommand(cmd);
// A refusal that comes after the wait, when the panel that asked has been
// redrawn and its own line is gone, is said as the page's notice.
const lateRefusal = text => { S.notice = {text, kind: 'error'}; renderSoon(); };
function bundleFormPanel(sel) {
  return bundleForm({rack: rack(), picked: sel.picked || [], uOf, onLate: lateRefusal,
    onCreate: ({cables, label}) => bundleCommand({op: 'bundle.create', cables, ...(label ? {label} : {})}, res => {
      if (res.error) return {error: res.error};
      const id = res.created?.id ?? res.created?.ids?.[0];
      select(id ? {kind: 'bundle', id} : null);
      return null;
    }),
    onCancel: () => select(null)});
}
function bundlePanel(sel) {
  const r = rack(), b = (r.bundles || []).find(x => x.id === sel.id);
  if (!b) { S.sel = null; return homePanel(); }
  return bundleInspector({rack: r, bundle: b, fact: routesNow()?.bundles?.get(b.id) ?? null, uOf, onLate: lateRefusal,
    onLabel: label => bundleEdit({op: 'bundle.update', id: b.id, label}),
    onStraps: straps => bundleEdit({op: 'bundle.update', id: b.id, straps}),
    onAdd: cables => bundleEdit({op: 'bundle.add', id: b.id, cables}),
    onPeel: (cable, at) => bundleEdit({op: 'bundle.peel', id: b.id, cable, ...(at ? {at} : {})}),
    onRemove: () => { S.sel = null; edit({op: 'bundle.remove', id: b.id}, {say: true}); },
    // (and back to the bundle's row in the list when the panel is put away)
    onClose: () => { S.focusNext = `bundleItem-${b.id}`; select(null); },
    // the panel's own pin control: its row in the list is behind the panel
    pinned: !S.pinOff, onPin: () => { S.pinOff = !S.pinOff; S.focusNext = 'bPin'; render(); }});
}
// What the 3D scene reads of the bundles, and its rebuild signature's share.
const bundles3d = rf => (rf?.bundles?.size || rf?.tieStraps?.length ? {bundles: rf.bundles ?? new Map(), places: rf.places, tieStraps: rf.tieStraps ?? []} : null);
const bundlesSig = rf => (rf?.bundles?.size ? JSON.stringify([...rf.bundles.values()].map(f =>
  [f.id, f.diameter, f.straps?.straps ?? null, f.check?.layout?.trunk ?? null])) : '');

const homePanel = () => el('div', {}, [
  S.cable.on ? cableModePanel() : summary(),
  // In 3D the cables are drawn and the list still selects, edits and deletes;
  // a selected cable is not lit in the scene, and a cable is added in 2D.
  S.mode === '3d' ? el('p', {id: 'cable3dNote', class: 'rk-muted', role: 'status', text: CABLES_3D}) : null,
  // The side pair says what it is for, as 3D says where cables are added (#187).
  sidesShown() ? el('p', {id: 'sidesNote', class: 'rk-muted', role: 'status', text: SIDES_NOTE}) : null,
  cableListPanel()].filter(Boolean));

// Undo and Redo walk the editor's history (spec §3.3); onChange says what was
// undone or redone, saves and redraws.
function undoStep() { ed.undo(); }
function redoStep() { ed.redo(); }

// ── Export (spec §8) ────────────────────────────────────────────────────
// Every export is built from the rack by exports.js, never from the panes. A
// builder resolves to {name, data, type, notes}, or {error: sentence}; the
// notes travel inside the file, and the status line only counts them - and
// says which ones the file had no place for (`left`, see exportStatus).
// A rebuild follows an edit 300 ms later (scheduleRebuild3d), so an export
// taken sooner would read the rack before the edit. The scene remembers which
// rack object it was built from; any other one is rebuilt first.
async function sceneForExport() {
  if (S.mode !== '3d') return {scene: null, overtaken: true};
  if (!S.scene3d || S.scene3dRack !== rack()) {
    clearTimeout(rebuild3dTimer);
    const before = stage3dEpoch;
    await rebuild3d();
    // A switch back to 2D, or a newer rebuild, overtook this one: that is not
    // a browser without WebGL.
    if (S.mode !== '3d' || stage3dEpoch !== before + 1) return {scene: null, overtaken: true};
  }
  return {scene: S.scene3d, overtaken: false};
}
const NO_SCENE = {error: "3D isn't available in this browser, so there's no model to export."};
const OVERTAKEN = {error: 'The 3D view changed before the model was ready. Try the export again.'};
// modelFile awaits the relief pass and the exporter while the page stays
// live: an edit (and its rebuild 300 ms later), a switch to 2D or another
// rack can dispose or replace the scene under it. What comes back is only
// good if it is still the scene on screen, built from the rack as it is now;
// otherwise nothing is saved, whether the exporter threw or returned.
const modelExport = async format => {
  const {scene, overtaken} = await sceneForExport();
  if (!scene) return overtaken ? OVERTAKEN : NO_SCENE;
  const forRack = rack();
  const current = () => S.scene3d === scene && S.scene3dRack === forRack && rack() === forRack;
  let out;
  try { out = await modelFile(scene, forRack, format, chassisOf); }
  catch (err) { if (current()) throw err; console.warn('[portrayal] export overtaken', err); return OVERTAKEN; }
  return current() ? out : OVERTAKEN;
};

const BUILD = {
  'sheet-svg': () => sheetSvg(rack(), chassisOf),
  'front-svg': () => sheetSvg(rack(), chassisOf, {faces: ['front']}),
  'rear-svg': () => sheetSvg(rack(), chassisOf, {faces: ['rear']}),
  'sheet-png': () => sheetPng(rack(), chassisOf),
  drawio: () => drawioFile(rack(), chassisOf),
  'netbox-import': () => dcimKit(rack(), chassisOf, 'netbox'),
  'nautobot-import': () => dcimKit(rack(), chassisOf, 'nautobot'),
  bom: () => bomCsv(rack(), chassisOf),
  cables: () => cableScheduleCsv(rack(), chassisOf),
  glb: () => modelExport('glb'),
  usdz: () => modelExport('usdz'),
};
// The DCIM import settings are a form in the side panel, as the frame's is: a
// different activity from Cable mode, so opening it turns that off.
function openDcimSettings() {
  if (S.cable.on) { S.cable = {on: false, a: null}; paintCableMode(); }
  S.focusNext = 'dSite';
  S.dcimDraft = null;
  select({kind: 'dcim'});
}
// Closing the settings form: the keyboard goes back to the Export menu that opened it.
// Cancel closes without saving what is typed NOW. It does not take back what an
// export already stored: an export saves the draft (runExport), and the form's
// help text says so.
function closeDcimForm(saved) {
  S.dcimDraft = null;
  S.focusNext = 'exportSummary';
  // An export or another rack may have stored the draft already: then the
  // rack holds it and there is nothing to say. Nothing changed, nothing said.
  if (saved && putDcim(saved)) {
    const d = dcimOf(rack());
    S.notice = {kind: 'note', text: `DCIM import settings saved: ${d.site ? `site or location "${d.site}"` : 'no site or location'}, ` +
                                    `${d.role ? `device role "${d.role}"` : 'no device role'}.`};
  }
  select(null);
}
let exporting = false;
async function runExport(kind) {
  // What is typed in the settings form, Done not pressed, is part of the rack
  // the export builds from: store it before any builder reads rack().
  storeDcimDraft();
  if (kind === 'json') { const doc = theDoc(); downloadDoc(doc); return {name: fileName(doc), notes: ''}; }
  if (kind === 'to-3d') { setMode('3d'); return {name: '', notes: ''}; }
  if (kind === 'dcim-settings') { openDcimSettings(); return {name: '', notes: ''}; }
  if (exporting) return {error: 'Another export is still running. Try again in a moment.'};
  if (!BUILD[kind]) return {error: `There is no export called ${kind}.`};
  exporting = true;
  // The line is one row and cuts a long sentence short (.rk-export-status),
  // so the whole of it is the element's title too.
  const say = text => { const status = $('exportStatus'); status.textContent = text; status.title = text; };
  say('Preparing…');
  try {
    const out = await BUILD[kind]();
    if (out.error) { say(out.error); return {error: out.error}; }
    save(out.data, out.name, out.type);
    const notes = exportStatus(out);
    say(notes);
    return {name: out.name, notes};
  } catch (err) {
    console.warn('[portrayal] export', kind, err);
    say("That export didn't work. Try again.");
    return {error: "That export didn't work. Try again."};
  } finally {
    exporting = false;
  }
}
function renderExports() {
  const act = (kind, text, title = '') => {
    const b = el('button', {type: 'button', 'data-export': kind, text, ...(title ? {title} : {})});
    b.addEventListener('click', () => { $('exportMenu').open = false; runExport(kind); });
    return b;
  };
  $('exportItems').replaceChildren(
    act('sheet-svg', 'Sheet, front and rear (.svg)'),
    act('front-svg', 'Front only (.svg)'),
    act('rear-svg', 'Rear only (.svg)'),
    act('sheet-png', 'Sheet as a picture (.png)'),
    el('hr'),
    act('drawio', 'draw.io diagram (.drawio)'),
    el('hr'),
    ...(S.mode === '3d'
      ? [act('glb', '3D model (.glb)'), act('usdz', '3D model for Apple devices (.usdz)')]
      : [act('to-3d', '3D model (GLB, USDZ): switch to 3D',
             'GLB and USDZ export the 3D view, which 2D does not build')]),
    el('hr'),
    act('dcim-settings', 'DCIM import settings', 'The site or location and the device role the NetBox and Nautobot files name'),
    act('netbox-import', 'NetBox import (.zip)',
        'Device and module types, the rack, devices, modules and cables, numbered in import order, with a README'),
    act('nautobot-import', 'Nautobot import (.zip)',
        'Device and module types, devices, modules and cables, a script that creates the cables, and a README'),
    act('bom', 'Bill of materials (.csv)'),
    act('cables', 'Cable schedule (.csv)'),
    el('hr'),
    act('json', 'Rack file (.json)'),
  );
}

// The DCIM settings form keeps what was typed as a draft; Done and Cancel clear
// it. Anything else that leaves the form (a click on the rack, another panel)
// saves it rather than losing it, and so does everything that reads or replaces
// the rack while the form is still open: an export, another rack being opened or
// created, the page being left. storeDcimDraft() puts the draft into the rack it
// was typed for, quietly, and says whether the rack changed. It keeps the
// draft, which the open form still shows.
function storeDcimDraft() { return !!S.dcimDraft && putDcim(S.dcimDraft); }
// THE ONE WAY THE IMPORT SETTINGS REACH THE RACK, from Done and from a stored
// draft alike: the dcim command, which is not an undo step (spec §3.3). Undo
// never takes the settings back (the editor keeps them across an undo), and
// the 3D scene reads nothing of them, so a current scene stays current
// (onChange's keepScene): the next GLB is not a rebuild. `quiet`, because this
// runs inside render() (flushDcimDraft): settings that change nothing must not
// redraw. Returns whether the rack changed.
function putDcim(patch) {
  const res = edit({op: 'dcim', ...patch}, {quiet: true});
  return !res.error && !res.noop;
}
// If the form is gone and a draft is left, the user went elsewhere: save it.
function flushDcimDraft() {
  if (!S.dcimDraft || S.sel?.kind === 'dcim') return;
  storeDcimDraft();
  S.dcimDraft = null;
}
// PROBE ONLY: a redraw held open at a named point. S.probeHold is set only by
// window.__rack.holdRedraw, which exists only under ?probe=1; without it this
// is one null test at each point and no await, so a redraw runs exactly as it
// did. The first redraw to reach the named point waits there until
// releaseRedraw; later redraws pass (a check holds an edit's redraw and lets
// the redraw of what it does next run past it). The points:
//   'routes' - the faces are read and the routes are about to be: the page
//              still holds the routes and facts of the rack before the edit;
//   'drawn'  - the routes are set for the rack as it is, and the facts just
//              read are not stored yet (they are stored when the panes are).
const probeHeld = at => { const h = S.probeHold; if (!h || h.at !== at || h.taken) return null; h.taken = true; h.reach(); return h.gate; };
// How many redraws are running: a bundle command waits for one (bundleCommand).
let rendering = 0;
// PROBE ONLY: WHERE A REDRAW'S TIME GOES (portrayal-site#192, tools/rack-speed.py). `lapsOf()` gives a
// redraw a stopwatch: lap(name) adds the time since the last lap to `name`. Without ?probe=1 it is
// a function that does nothing, and S.probeTimes is never set, so a redraw runs exactly as it did.
const NO_LAP = Object.assign(() => {}, {times: null});
function lapsOf() {
  if (!PROBE) return NO_LAP;
  const times = {}, t0 = performance.now();
  let last = t0;
  return Object.assign(k => { const now = performance.now(); times[k] = (times[k] ?? 0) + now - last; last = now; },
    {times, t0, since: () => performance.now() - t0});
}
// `keepRoutes` (a switch of pair, setView): the rack has not changed, so what
// the last redraw read of it is still true and is drawn from again (redraw).
async function render(opts) {
  rendering++;
  try { return await redraw(opts?.keepRoutes === true); } finally { rendering--; }
}
async function redraw(keepRoutes = false) {
  flushDcimDraft();
  const mine = ++S.draws;
  const lap = lapsOf();
  pruneCable();
  pruneFilter();
  // The route row and the typed fields belong to one open cable form too.
  const formOf = S.sel?.kind === 'cable-form' ? S.sel.id : null;
  if (S.routeSel && S.routeSel.cableId !== formOf) S.routeSel = null;
  if (S.cableDraft && S.cableDraft.id !== formOf) S.cableDraft = null;
  // Picking belongs to one open cable form, outside Cable mode.
  // (nor from the side: there is no ring, duct or gutter to click there, and the page says so)
  if (S.routePick && sidesShown()) { S.routePick = null; addNotice(PICK_SIDES, 'note'); }
  if (S.routePick && (S.cable.on || S.sel?.kind !== 'cable-form' || S.sel.id !== S.routePick.cableId
      || !rack().cables.some(c => c.id === S.routePick.cableId))) S.routePick = null;
  let r = rack();
  $('rackName').textContent = r.name;
  const holes = r.frame.holes.style === 'tapped'
    ? `tapped${r.frame.holes.thread ? ` ${r.frame.holes.thread}` : ''}` : r.frame.holes.style === 'round' ? 'round holes' : 'square holes';
  // The heading stays one line ("Front" / "Rear") so both panes' SVGs start
  // at the same top edge; the frame summary that used to wrap it onto two
  // lines lives in the top bar instead, beside the rack name.
  // The pair the panes show names them (#187): Front and Rear, or Left and Right.
  const sides = S.view === 'sides';
  [$('headFront').textContent, $('headRear').textContent] = PAIRS[S.view];
  $('frameSummary').textContent = `${r.frame.heightRU}U ${r.frame.kind} · ${holes}`;
  const selectedId = S.sel?.kind === 'item' || S.sel?.kind === 'move' || S.sel?.kind === 'remove' ? S.sel.id : null;
  let front, rear, facts, sideCables = null;
  // A SWITCH OF PAIR READS NOTHING AGAIN (#187). Reading the cables' faces and
  // the routes is nearly all of a redraw (over a second on a 48-cable rack),
  // and a switch between Front / Rear and Left / Right changes neither: the
  // two pairs draw one rack by one set of routes. So when the redraw is for a
  // switch, and the page holds the facts and the routes it read for this very
  // rack object (S.factsRack, S.routes.rack: any edit makes a new one), they
  // are drawn from as they are. In every other case, and whenever either is
  // another rack's or missing, both are read as always.
  // Nor are facts read with a new cable's two ends in hand (a plug seated for
  // each, pendingEnds) kept once that cable is dropped, or the other way round:
  // S.factsPending is how many such ends the facts were read with.
  const pending = pendingEnds();
  const kept = keepRoutes && S.routes?.rack === r && S.factsRack === r && !pending.length && S.factsPending === 0 && !S.probeFactsFail ? S.cableFacts : null;
  try {
    // PLUGS ARE DERIVED, NEVER STORED: a cabled end is drawn with the plug its
    // port takes, laid over the item's own swaps for this drawing only. The
    // document, Explorer and the exports keep reading item.swaps.
    // Cables are an overlay: if reading them fails, the rack still draws, unplugged.
    // Then the ends are drawn as they are, none marked loose, and the panel says so.
    facts = kept ?? await (S.probeFactsFail ? Promise.reject(new Error('probe: cableFacts fails')) : cableFacts(r, pending))
      .catch(err => {
        console.warn('[portrayal] could not read the cables\' faces', err);
        return UNCHECKED;
      });
    if (!kept && facts.unchecked && r.cables.length && mine === S.draws) addNotice(UNCHECKED_TEXT, 'note');
    lap('facts');
    // ROUTES (spec 5, 8): resolved from the drawings each render. A routed
    // length is the document's, so when one changes it is stored by the
    // lengths.routed command, which is not an undo step - it is the page's
    // measurement, not an edit - and so triggers no render (onChange): the side
    // panel and cable list below read S.routes.
    if (kept) { /* the routes are this rack's, as the last redraw read them */ }
    else if (r.cables.length) {
      const at = theDoc();
      if (S.probeHold) { const held = probeHeld('routes'); if (held) await held; }
      // READ ONCE FOR THIS RACK OBJECT (reading.js, portrayal-site#192): a redraw that changes nothing a route
      // reads (a selection, a row opened, a notice) is handed the routes the last one read, and so is every
      // export and every call an assistant makes. A step is a new rack object, and is read afresh.
      const read = await routesOf(r, chassisOf, {cableFacts: facts}).catch(err => { console.warn('[portrayal] routes', err); return null; });
      // A REDRAW ASKED FOR LATER IN THE SAME TASK STILL OVERTAKES THIS ONE. Reading the routes always took long enough
      // that a second redraw asked for by the same click (a pane's own handler, then the page's, which puts a pinned
      // cable down) began before this one drew, and this one stood down for it (`mine`, below). Handed routes already
      // read, this one would finish first and show the one-shot notice, and the second would then draw it away: a
      // taken port's "already has a cable" flashed and was gone. So the task that asked is let finish first.
      await new Promise(next => setTimeout(next));
      // (the page's own copy: `rack` is the rack this redraw draws, which a reading shared with the rack before a
      // change that is not a step does not name, and `bendsShown` is this redraw's, by the ends as it read them)
      const rf = read && {...read, rack: r, bendsShown: landedBends(read.bendFindings, r, e => facts.ends.get(endKey(e))?.reason != null)};
      if (mine !== S.draws) return;
      if (!rf) { S.routes = null; if (S.scene3d && S.scene3dRoutes) scheduleRebuild3d(); }
      // THE RACK MOVED WHILE ITS FACES AND ROUTES WERE READ, and nothing has
      // asked for another redraw (a change that is not a step redraws nothing:
      // a DCIM setting stored): these routes are another rack's and are not
      // kept, so they are read again now, for the rack as it is. Left alone,
      // the page held the routes of a rack before until the next redraw:
      // cables drawn unrouted, and a 3D build waiting for routes that no
      // redraw was going to read. `r` is the rack this redraw began with.
      else if (rack() !== r || theDoc() !== at) { renderSoon(); return; }
      else {
        // (the bends shown are set before the scene's signature is compared:
        // it counts them, and the scene's own was taken with them set)
        S.routes = rf;
        if (S.scene3d && S.scene3dRoutes !== routesSig(rf)) scheduleRebuild3d();
        // THE BEND NOTICE (kit 0.17.0, Portrayal #973): each corner of a
        // cable's path with less room than its own installed bend radius, in
        // the kit's words (route.js bendFindings), said once per set of them:
        // when a cable, a type or a device changes what is tight, not on every
        // redraw. Both drawings ring the same corners (cable-view.js,
        // scene3d.js). Nothing is measured on the page. Only for a cable
        // plugged in at both ends (landedBends): one with a loose end is not
        // drawn along its path, and its notice is that it is not connected.
        // The sentences stay in the cable list's notes (cableListPanel).
        const said = rf.bendsShown.map(f => f.text).join('\n');
        if (said !== (S.bendsSaid ?? '')) {
          S.bendsSaid = said;
          if (said) addNotice(bendNotice(rf.bendsShown), 'note');
        }
        // Not from facts with a face missing: a port not found there is not a port that is loose.
        if (rf.complete) {
          // onChange saves it and keeps the scene; the drawing below shows the length just kept.
          // (asked only when a routed length would change: the command lays every cable again to find out, and
          // on most redraws none has moved. lengthsStand says so from the lengths just read, by the kit's own rule.)
          const res = lengthsStand(r, rf) ? {noop: true} : ed.apply({op: 'lengths.routed', routeCtx: rf.ctx}, {origin: 'system'});
          if (!res.error && !res.noop) r = rack();
        }
      }
    } else {
      S.routes = null;
      S.bendsSaid = '';
      if (S.scene3d && S.scene3dRoutes) scheduleRebuild3d();   // '' when it was hung without routes
    }
    lap('routes');
    if (S.probeHold) { const held = probeHeld('drawn'); if (held) await held; }
    const items = itemsWithU(r, chassisOf).map(it => (facts.seats[it.id]
      ? {...it, swaps: mergeSeats(it.swaps, facts.seats[it.id])} : it));
    const zeroU = zeroUEntries(r, chassisOf);
    // THE SIDE PAIR (#187): the same two panes, drawn by side-elevation.js
    // from the same items, parts and routes. Nothing in it is a target for
    // placing, moving or cabling.
    if (sides) [front, rear] = await Promise.all(['left', 'right'].map(pane => drawSideElevation({
      rack: r, items, zeroU, pane, chassisOf, selectedId, cabled: r.cables.length > 0,
      laneGap: hasRoutes() ? LANE_GAP : 0, selectedZeroU: S.sel?.kind === 'zerou' ? S.sel.id : null})));
    else [front, rear] = await Promise.all(['front', 'rear'].map(view => drawElevation({
      items, frame: r.frame, view, hitTargets: true, selectedId, ears: true, metal: true,
      selectedU: S.sel?.kind === 'u' && S.sel.face === view ? S.sel.ru : null,
      laneGap: hasRoutes() ? LANE_GAP : 0, zeroU, selectedZeroU: S.sel?.kind === 'zerou' ? S.sel.id : null, chassisOf})));
  } catch (err) {
    if (mine !== S.draws) return;
    // routes read for a rack before this one are not this rack's: nothing waits for them
    if (S.routes && S.routes.rack !== rack()) S.routes = null;
    console.warn('[portrayal] the rack elevation failed to draw', err);
    $('side').replaceChildren(el('p', {class: 'rk-error', role: 'alert', text: CANT_DRAW}));
    return;
  }
  if (mine !== S.draws) return;
  lap('panes');
  S.cableFacts = facts;
  S.factsRack = r;       // the rack these were read for (a switch of pair draws from them again: `kept`, above)
  if (!kept) S.factsPending = pending.length;
  $('paneFront').replaceChildren(front);
  $('paneRear').replaceChildren(rear);
  // The SVGs are new nodes every render, so the zoom (a style on the old
  // ones) has to be reapplied to these.
  S.svgs = [front, rear];
  // With cables, both panes widen by the same side column, before the zoom
  // below reads their viewBox; with none they are exactly as they were.
  const cabled = r.cables.length > 0;
  const routed = hasRoutes();
  if (cabled && !sides) for (const svg of S.svgs) widenForCables(svg, routed);
  // #panes is hidden while in 3D (showMode()) - applyZoom measures its own
  // column width to fit into, and a hidden element measures 0, which is what
  // left every SVG at height:0 once the panes came back. Skipped here, this
  // is instead applied by setMode() the moment #panes is shown again.
  if (!$('panes').hidden) {
    applyZoom($('panes'), S.svgs, S.zoom);
    setZoomLabel();
    lap('layout');
    // Cables are measured off the laid-out panes (getScreenCTM), so they are
    // drawn only while the panes show; setMode() redraws on the way back from 3D.
    if (cabled && sides) {
      // The cables from the side: the kit's points for each, dropped onto
      // depth and height (side-elevation.js). They need no laid-out pane, but
      // the panes grow for them, so the zoom is applied again when they do.
      const reasons = new Map([...facts.ends].map(([k, v]) => [k, v.reason]));
      const live = S.routes?.rack === r ? S.routes : null;
      const centreOf = (w, rt) => stopCentre(r, w, live?.ctx, rt);
      sideCables = S.svgs.map(svg => drawSideCables(svg, r, live, reasons, {uOf, centreOf}));
      if (roomForSideCables(S.svgs, sideCables)) { applyZoom($('panes'), S.svgs, S.zoom); setZoomLabel(); }
      paintCables(S.svgs, r, {selectedId: selectedCable(), bundleId: pinnedBundle(), on: S.cableFilter});
      paintBundles(S.svgs, pinnedBundle());
      paintHover2d(S.svgs, litFor(r, S.hover));
      sizeStraps(S.svgs);
    } else if (cabled) {
      const reasons = new Map([...facts.ends].map(([k, v]) => [k, v.reason]));
      // by the routes read for the rack this draws, never another's
      const spares = sparesNow();
      for (const svg of S.svgs) drawRackCables(svg, r, reasons, uOf, S.routes?.rack === r ? S.routes : null, spares);
      // A long cable's loop and a low lead's tag reach below the rack: both
      // panes grow downward by what the lowest one needs, and the zoom is
      // applied again to the taller boxes.
      if (roomForCables(S.svgs)) { applyZoom($('panes'), S.svgs, S.zoom); setZoomLabel(); }
      paintCables(S.svgs, r, {selectedId: selectedCable(), bundleId: pinnedBundle(), on: S.cableFilter});
      paintBundles(S.svgs, pinnedBundle());
      paintHover2d(S.svgs, litFor(r, S.hover));
      sizeStraps(S.svgs);
      layCovers2d(S.svgs);
    }
    if (S.routePick && !sides) drawRoutePicking();
    // The picked A end, and both ends while a new cable's form is open.
    for (const e of [...pendingEnds(), ...(S.cable.a ? [S.cable.a] : [])]) {
      const it = itemById(e.item);
      if (it) markPort(S.svgs.find(s => s.dataset.pane === paneOf(it, e.view)), it.id, e.path);
    }
  }
  lap('cables');
  renderSide();
  lap('side');
  paintAgentMark();
  // a selected cable or bundle shows its bundle's envelope in the scene, as on the panes
  if (S.scene3d) paintSelected3d(S.scene3d, {cable: selectedCable(), bundle: pinnedBundle()}, pinnedLit(rack()));
  paintTip();   // a cable under the pointer may have just changed its cord
  if (lap.times) { lap('rest'); S.probeTimes = {...lap.times, total: lap.since(), kept: !!kept, cableCount: r.cables.length, draw: mine}; S.probeDone = (S.probeDone ?? 0) + 1; }
}

// The one-shot notice, shown once beside whatever the side panel now shows
// and cleared - never written into a panel that render() is about to
// replace, which is what left the brief's inline notices lost.
function noticeParagraph() {
  if (!S.notice) return null;
  const n = typeof S.notice === 'string' ? {text: S.notice, kind: 'error'} : S.notice;
  S.notice = null;
  return el('p', {class: `rk-notice ${n.kind === 'note' ? 'rk-muted' : 'rk-error'}`,
                  role: n.kind === 'note' ? 'status' : 'alert', text: n.text});
}

function summary() {
  const r = rack();
  const devices = r.items.filter(i => !isRackFace(chassisOf(i.ref)));
  const managers = r.items.length - devices.length;
  // in halves since rack file version 4: two half-unit panels in one unit use one unit between them
  const used = devices.reduce((n, i) => n + uOf(i), 0);
  // A narrow part on one rail is judged on its rail (the kit's fits reads the item's side).
  const warnings = r.items
    .map(i => ({i, f: fits(r, i, chassisOf, {ignoreId: i.id})}))
    .filter(x => !x.f.ok);
  // A part beside the rack can stop fitting under it: a shorter frame, or two posts instead of four.
  const side = zeroUOf(r);
  const sideWarnings = side.map(z => ({z, f: fitsZeroU(r, z, chassisOf, {ignoreId: z.id})}))
    .filter(x => !x.f.ok);
  return el('div', {}, [
    el('h3', {text: r.name}),
    el('p', {class: 'rk-muted', text: `${devices.length} devices · ${used}U used on the rails${managers ? ` · ${managers} cable manager${managers === 1 ? '' : 's'}` : ''}` +
      `${side.length ? ` · ${side.length} beside the rack` : ''}.`}),
    ...warnings.map(({i, f}) => el('p', {class: 'rk-error', text: `${i.label} at U${positionOf(r.frame, i.ru, uOf(i))}: ${f.reason}`})),
    ...sideWarnings.map(({z, f}) => el('p', {class: 'rk-error', text: `${z.label} at ${z.at}: ${f.reason}`})),
    ...(sidesShown() ? [] : [el('p', {class: 'rk-muted', text: 'Click an empty U on either face to place a device there.'})]),
  ]);
}

// ── Hover (#169) ──────────────────────────────────────────────────────────
// A cable or bundle under the pointer lights and the rest dim, in whichever
// view shows (hover.js). Restyles the panes and the scene; never redraws,
// never selects. A touch pointer is ignored: on touch the page is as before.
function setHover(target) {
  if (sameTarget(S.hover, target)) { if (S.hover && target) S.hover.from = target.from; paintTip(); return; }
  S.hover = target;
  // what is under the pointer on the stage marks its row in the list: a mark only, nothing opens or scrolls (cable-tree.js)
  markHover($('side'), target?.from === 'stage' ? target : null);
  const lit = litFor(rack(), target);
  paintHover2d(S.svgs, lit);
  if (S.scene3d) paintHover3d(S.scene3d, lit);
  paintTip();
}
// THE HOVER LABEL. A cable under the pointer on either stage (the 2D panes or
// the 3D scene) says what it is beside the pointer: its two ends, then what
// its row in the list says (cable-panel.js cableMeta), its cord and spare
// with it. Two cords on paths of one length look alike in the drawing; this
// is where the stage tells them apart. Only for a hover from the stage: over
// a row of the list, the row itself says it. It takes no pointer and is no
// control, and it is hidden from assistive technology, which reads the list.
let tipAt = null;
function paintTip() {
  let tip = $('cableTip');
  // (not for the cable that is pinned: it is selected, its row in the list is
  // pressed and says all of this, and the label would sit on the cable the
  // reader pinned to follow)
  const h = S.hover, c = h?.kind === 'cable' && h.from === 'stage' && tipAt && h.id !== selectedCable() ? rack().cables.find(x => x.id === h.id) : null;
  if (!c) { if (tip) { tip.hidden = true; tip.removeAttribute('data-cable-tip'); } return; }
  if (!tip) {
    tip = el('div', {id: 'cableTip', class: 'rk-cable-tip', 'aria-hidden': 'true'});
    document.body.append(tip);
  }
  const r = rack(), spare = sparesNow().get(c.id) ?? null, meta = cableMeta(c, spare);
  const needs = spare ? needsText(spare) : null;
  tip.replaceChildren(el('span', {text: `${endName(r, c.a, uOf)} → ${endName(r, c.b, uOf)}`}),
                      ...(meta ? [el('span', {'data-tip-meta': 'true', text: meta})] : []),
                      ...(needs ? [el('span', {'data-tip-short': 'true', text: `${needs[0].toUpperCase()}${needs.slice(1)}.`})] : []));
  tip.dataset.cableTip = c.id;
  tip.hidden = false;
  // beside the pointer, and turned back inside the window at its right and bottom edges
  const w = tip.offsetWidth, hgt = tip.offsetHeight;
  tip.style.left = `${Math.max(4, Math.min(tipAt.x + 14, window.innerWidth - w - 4))}px`;
  tip.style.top = `${Math.max(4, tipAt.y + 16 + hgt > window.innerHeight ? tipAt.y - hgt - 10 : tipAt.y + 16)}px`;
}
const hideTip = () => { if (tipAt) { tipAt = null; paintTip(); } };
let hoverFrame = 0, hoverEv = null;
function hoverMove(ev, find) {
  if (ev.pointerType === 'touch') return;
  hoverEv = ev;
  if (hoverFrame) return;
  hoverFrame = requestAnimationFrame(() => {
    hoverFrame = 0;
    const e = hoverEv;
    // an orbit or a drag in progress is not a hover, and the label does not
    // stay behind where it began: it comes back with the next free move
    if (e.buttons) { hideTip(); return; }
    const t = find(e);
    tipAt = t ? {x: e.clientX, y: e.clientY} : null;
    // over nothing: a row keyboard focus is on is lit again, as on leaving the list
    setHover(t ? {...t, from: 'stage'} : focusHover());
    paintTip();   // the same cable, the pointer further along it
  });
}
// ── The pinned highlight ──────────────────────────────────────────────────
// THE SELECTION IS THE PIN: a cable or a bundle selected (a click on its row,
// Enter or Space on it, a cable's tag on a pane) stays lit, and the rest dim,
// in both views, through an orbit, a redraw and a switch of view, until it is
// put down. There is no second state: this is S.sel, read as a hover target.
const pinnedLit = r => {
  const cable = selectedCable(), bundle = pinnedBundle();
  return litFor(r, cable != null ? {kind: 'cable', id: cable} : bundle != null ? {kind: 'bundle', id: bundle} : null);
};
// PUT DOWN BY A CLICK ON NOTHING: on empty stage, or on the page's own
// background. A click is a press and a release within a few pixels and half a
// second, so an orbit, a pan or a drag never puts it down. A click on a
// control, in the side panel or on something a pane selects (a device, an
// empty unit: the pane's own handler ran first and the selection is no longer
// this one) is not a click on nothing; nor, in 3D, is one on a cable or a
// bundle. Escape and a second click on the pinned row put it down as before.
const CLICK_SLOP = 4, CLICK_MS = 500;
const NOT_NOTHING = 'button, a, input, select, textarea, label, summary, details, dialog, [role="button"], [tabindex], #side, .rk-lens, .rk-lens-backdrop';
function wirePin() {
  let down = null;
  document.addEventListener('pointerdown', ev => { S.focusQuiet = false; down = {x: ev.clientX, y: ev.clientY, t: performance.now(), sel: S.sel}; }, true);
  document.addEventListener('click', ev => {
    const d = down;
    down = null;
    if (!d || d.sel !== S.sel || (S.sel?.kind !== 'cable' && S.sel?.kind !== 'bundle')) return;
    if (Math.hypot(ev.clientX - d.x, ev.clientY - d.y) > CLICK_SLOP || performance.now() - d.t > CLICK_MS) return;
    const t = ev.target;
    if (!(t instanceof Element) || t.closest(NOT_NOTHING)) return;
    if (t.closest('#stage3d') && S.scene3d && hoverAt3d(S.scene3d, ev)) return;
    select(null);
  });
}

function wireHover() {
  for (const id of ['paneFront', 'paneRear']) {
    const pane = $(id);
    pane.addEventListener('pointermove', ev => hoverMove(ev, e => {
      const svg = pane.querySelector(':scope > svg');
      return svg ? hoverAt2d(svg, e) : null;
    }));
    pane.addEventListener('pointerleave', ev => { if (ev.pointerType !== 'touch' && S.hover?.from === 'stage') setHover(focusHover()); });
  }
  // A button going down on either stage (an orbit, a drag, a click) hides the label at once.
  for (const id of ['paneFront', 'paneRear', 'stage3d']) $(id).addEventListener('pointerdown', hideTip, true);
  const stage = $('stage3d');
  stage.addEventListener('pointermove', ev => hoverMove(ev, e => (S.scene3d ? hoverAt3d(S.scene3d, e) : null)));
  stage.addEventListener('pointerleave', ev => { if (ev.pointerType !== 'touch' && S.hover?.from === 'stage') setHover(focusHover()); });
  const side = $('side');
  side.addEventListener('pointerover', ev => {
    if (ev.pointerType === 'touch') return;
    const t = hoverAtList(ev);
    if (t) setHover({...t, from: 'list'});
    else if (S.hover?.from === 'list') setHover(focusHover());
  });
  side.addEventListener('pointerleave', ev => { if (ev.pointerType !== 'touch' && S.hover?.from === 'list') setHover(focusHover()); });
  // KEYBOARD FOCUS ON A ROW is a hover of it (hover.js hoverAtFocus). The
  // pointer over a row outranks it; when the pointer leaves the list, the
  // focused row is lit again (above).
  side.addEventListener('focusin', () => {
    const t = focusHover();
    if (t) { if (S.hover?.from !== 'list') setHover(t); }
    else if (S.hover?.from === 'focus') setHover(null);
  });
  side.addEventListener('focusout', ev => {
    if (S.hover?.from === 'focus' && !side.contains(ev.relatedTarget)) setHover(null);
  });
}
// The row keyboard focus is on, as a hover target, or null.
// (not straight after Escape put a pin down with focus still on its row: the
// row would light it again as a hover; the next key or press ends that)
function focusHover() {
  if (S.focusQuiet) return null;
  const t = hoverAtFocus($('side'));
  return t ? {...t, from: 'focus'} : null;
}

function renderSide() {
  // The list is rebuilt: a row the pointer was over is gone, and no
  // pointerout will say so. Its hover ends here; the next move finds the new row.
  if (S.hover?.from === 'list') setHover(null);
  // Rebuilding the panel must not take keyboard focus away (a frame edit
  // redraws the form): the control that had it gets it back, by id.
  const had = document.activeElement;
  const focusId = had && $('side').contains(had) ? had.id : '';
  const r = rack();
  if (S.sel?.kind === 'cable' && !r.cables.some(c => c.id === S.sel.id)) S.sel = null;   // that cable is gone
  const sel = S.sel;
  let body;
  if (!sel || sel.kind === 'cable') body = homePanel();
  else if (sel.kind === 'bundle') body = bundlePanel(sel);
  else if (sel.kind === 'bundle-form') body = bundleFormPanel(sel);
  else if (sel.kind === 'cable-form') body = cableFormPanel(sel);
  else if (sel.kind === 'frame') body = frameForm({rack: r,
    // The rack as it is when the field changes, not as it was when the form was built.
    onName: name => edit({op: 'rename', name}, {quiet: true}),
    // A shrink packs devices down and trims from the bottom, and says so (a
    // finding); Undo puts every device back where it was. A field whose new
    // value already matches the frame changes nothing: removing a
    // still-focused, edited <input> from the DOM (this panel is rebuilt on
    // every edit) makes some browsers re-fire 'change' on it as it loses focus,
    // echoing the same edit a second time. The command makes that echo a no-op,
    // and `quiet` keeps it from redrawing away the notice the first pass showed.
    onFrame: patch => edit({op: 'frame', ...patch}, {quiet: true})});
  else if (sel.kind === 'dcim') body = dcimForm({rack: r, draft: S.dcimDraft,
    // Typing only keeps a draft. Done saves it once, against the rack as it is
    // when Done is clicked, not as it was when the form was built.
    onEdit: draft => { S.dcimDraft = draft; },
    onDone: closeDcimForm,
    onCancel: () => closeDcimForm(null)});
  else if (sel.kind === 'u') body = catalogPanel({entries: S.entries, rack: r, face: sel.face, ru: sel.ru, half: sel.half ?? null,
    chassisOf, pick: S.pick, onState: patch => { S.pick = {...S.pick, ...patch}; },
    onPlace: (entry, cfg, extra) => place(entry, cfg, sel.face, extra.ru ?? sel.ru, extra), onlyMount: sel.onlyMount ?? null});
  else if (sel.kind === 'zerou') {
    const z = zeroUById(r, sel.id);
    if (!z) { S.sel = null; body = homePanel(); }
    else body = zeroUInspector({z, rack: r, chassis: chassisOf(z.ref), chassisOf,
      // Like every panel's controls, these act on the part as it is now, or say it is gone.
      onUpdate: patch => {
        const res = edit({op: 'zerou.update', id: z.id, ...patch}, {report: false});
        return res.error ? {ok: false, reason: res.error} : {ok: true};
      },
      onRemove: () => { S.sel = null; edit({op: 'zerou.remove', id: z.id}, {say: true}); }});
  }
  else if (sel.kind === 'remove') {
    const it = itemById(sel.id);
    if (!it) { S.sel = null; body = homePanel(); }
    else {
      const n = cablesOf(r, it.id).length;
      // The buttons may outlive the rack they were built for (a redraw still
      // awaiting the cables' faces leaves them clickable): a click acts on the
      // rack as it is now, and does nothing once the device is gone or the
      // panel is no longer this device's.
      // The command words the sentence from the rack at click time: with no
      // cable left, neither mentions any.
      const act = cables => () => {
        const cur = rack().items.find(i => i.id === it.id);
        if (S.sel?.kind !== 'remove' || S.sel.id !== it.id || !cur) { render(); return; }
        S.sel = null;
        S.focusNext = 'undoShrink';            // the panel's buttons go: the keyboard goes to Undo
        edit({op: 'remove', id: cur.id, cables}, {say: true});
      };
      body = removePanel({item: it, count: n, onBoth: act('remove'), onKeep: act('keep'),
        onCancel: () => { S.focusNext = 'iRemove'; select({kind: 'item', id: it.id}); }});
    }
  }
  else if (sel.kind === 'move') {
    const it = itemById(sel.id);
    if (!it) { S.sel = null; body = homePanel(); }
    else body = el('div', {}, [
      el('h3', {text: `Move ${it.label}`}),
      el('p', {id: 'moveHelp', class: 'rk-muted', text: sidesShown() ? MOVE_SIDES
        : 'Click the U where its bottom should go, on either face, or use the ↑ and ↓ keys. Esc stops moving.'})]);
  } else {
    const it = itemById(sel.id);
    if (!it) { S.sel = null; body = homePanel(); }
    else if (isRackFace(chassisOf(it.ref))) {
      const host = it.on ? itemById(it.on) : null;
      const hostHere = host ? null : hostAt(r, it.face, it.ru, chassisOf);
      // Like the device panel's Remove: these may outlive the rack they were
      // built for, so each acts on the item as it is now, or just redraws.
      const live = fn => {
        const cur = rack().items.find(i => i.id === it.id);
        if (S.sel?.kind !== 'item' || S.sel.id !== it.id || !cur) { render(); return; }
        fn(cur);
      };
      body = managerInspector({item: it, rack: r, chassis: chassisOf(it.ref), host, hostHere,
        onPatch: patch => patchItem(it.id, patch),
        onSelectHost: () => select({kind: 'item', id: host.id}),
        onDetach: () => live(cur => edit({op: 'detach', id: cur.id}, {say: true})),
        onAttach: () => live(cur => attachManager(cur.id)),
        onMove: () => select({kind: 'move', id: it.id}),
        onRemove: () => live(cur => { S.sel = null; edit({op: 'remove', id: cur.id}, {say: true}); }),
        onExplore: () => explore(it.id)});
      // A narrow part (a finger bracket) goes on one rail (the kit's side.set).
      if (isNarrow(chassisOf(it.ref))) body.append(sideControl({item: it, onSide: side => {
        const res = edit({op: 'side.set', id: it.id, side}, {report: false});
        return res.error ? {ok: false, reason: res.error} : {ok: true};
      }}));
    } else body = el('div', {}, [inspectorPanel({item: it, rack: r, chassis: chassisOf(it.ref),
      available: availableDepth(r, it, chassisOf),
      onPatch: patch => patchItem(it.id, patch),
      onMove: () => select({kind: 'move', id: it.id}),
      // A device with cables asks in the side panel, where it can offer the
      // choice a dialog cannot (spec §9.3); one without keeps the plain question.
      // Like the remove panel's buttons, this one may outlive the rack it was
      // built for: it reads the rack as it is at the click, and does nothing
      // once the device is gone or is no longer the selection.
      onRemove: () => {
        const now = rack(), cur = now.items.find(i => i.id === it.id);
        if (S.sel?.kind !== 'item' || S.sel.id !== it.id || !cur) { render(); return; }
        if (cablesOf(now, cur.id).length) {
          S.focusNext = 'removeWithCables';    // the panel's first button takes the keyboard
          select({kind: 'remove', id: cur.id});
          return;
        }
        if (confirm(`Remove ${cur.label} from the rack?`)) {
          S.sel = null;
          // Said only when its managers stay behind: a plain removal is its own Undo's description.
          edit({op: 'remove', id: cur.id}, {say: !!managersStay(now, cur.id)});
        }
      },
      onExplore: () => explore(it.id)}),
      managerRows({host: it, rack: r, chassisOf,
        attachable: (face, ru) => r.items.find(i => i.face === face && i.ru === ru && !i.on && isRackFace(chassisOf(i.ref))) ?? null,
        onAttach: id => attachManager(id),
        onAdd: unit => select({kind: 'u', face: it.face, ru: Math.floor(it.ru) + unit - 1, onlyMount: 'rack-face'}),
        onSelect: id => select({kind: 'item', id}),
        onRemove: id => {
          const m = itemById(id);
          if (!m) { render(); return; }
          edit({op: 'remove', id}, {say: true});
        }})]);
  }
  const kids = [body];
  const failed = detailFailedLine();
  if (failed) kids.push(failed);
  const unsaved = saveFailedLine();
  if (unsaved) kids.push(unsaved);
  const notice = noticeParagraph();
  if (notice) kids.push(notice);
  // what the rack keeps and the page does not draw, for as long as it is true (sayKept)
  kids.push(...keptParagraphs());
  // Undo and Redo, each while there is a step to take, each saying what it would
  // take back or do again (spec §3.3). With nothing to undo the button is
  // absent, not disabled: a disabled button with no description is noise. The
  // notice is shown once; the sentence beside the button stays: the notice
  // itself while it shows, then a line of its own. Either way it is the
  // button's description.
  const stepButton = (id, text, whatId, what, fn) => {
    if (notice && what && S.saidStep === what && notice.textContent.includes(what) && id === 'undoShrink') notice.id = whatId;
    else if (what) kids.push(el('p', {id: whatId, class: 'rk-undo-what rk-muted', text: what}));
    const b = el('button', {type: 'button', id, text, ...(what ? {'aria-describedby': whatId} : {})});
    b.addEventListener('click', fn);
    kids.push(b);
  };
  if (ed.canUndo) stepButton('undoShrink', 'Undo', 'undoWhat', ed.undoSummary, undoStep);
  if (ed.canRedo) stepButton('redoStep', 'Redo', 'redoWhat', ed.redoSummary, redoStep);
  if (notice) S.saidStep = null;     // shown once, like the notice
  $('side').replaceChildren(...kids);
  const back = focusId ? document.getElementById(focusId) : null;
  const row = S.focusRow ? document.getElementById(`cableRow-${S.focusRow}`) : null;
  // Where the keyboard goes when the control that had it is gone with its
  // panel (a Delete, the remove panel opening or closing): named by the
  // action, taken by the redraw that shows it.
  const next = S.focusNext ? document.getElementById(S.focusNext) : null;
  S.focusNext = null;
  S.focusRow = null;
  // the rebuilt list has the mark of what is still under the pointer on the stage
  if (S.hover?.from === 'stage') markHover($('side'), S.hover);
  // a cable just pinned shows its row (treeHooks opened the row it is under)
  if (S.tree.show != null) { document.getElementById(`cableItem-${S.tree.show}`)?.scrollIntoView({block: 'nearest'}); S.tree.show = null; }
  if (row) row.focus();
  else if (next) next.focus();
  else if (back) back.focus();
  // A cable form that just opened takes the keyboard at its first field.
  else if (S.sel?.kind === 'cable-form') $('cMedia')?.focus();
  // A row lit by keyboard focus: the rebuild took its row away and may have
  // put focus back on it, on another control, or nowhere. The hover follows.
  if (S.hover?.from === 'focus') setHover(focusHover());
}

// A CLICK ON A SIDE PANE SELECTS, and does nothing else (#187): a cable or a
// bundle under the pointer (found by geometry, as its hover is: a stroke takes
// no click), else the part beside the rack or the device clicked. A click on
// nothing puts a selected device or part down; a pinned cable or bundle is put
// down by wirePin, as everywhere.
function onSideClick(ev) {
  const svg = ev.currentTarget.querySelector(':scope > svg');
  const hit = svg ? hoverAt2d(svg, ev) : null;
  if (hit) {
    // the pinned one clicked again stays pinned: a new selection object, so wirePin does not take it for a click on nothing
    if (S.sel?.kind === hit.kind && S.sel.id === hit.id) { S.sel = {...S.sel}; return; }
    return select({kind: hit.kind, id: hit.id});
  }
  const zpart = ev.target.closest('[data-zerou-id]');
  if (zpart) return select({kind: 'zerou', id: zpart.dataset.zerouId});
  const item = ev.target.closest('[data-item-id]');
  if (item) return select({kind: 'item', id: item.dataset.itemId});
  if (S.sel?.kind === 'item' || S.sel?.kind === 'zerou') select(null);
}

function onPaneClick(ev) {
  if (sidesShown()) return onSideClick(ev);
  if (drag?.consumeClick()) return; // this drag's own trailing click (some engines fire one), not a fresh click
  // Picking a waypoint: only a pick target takes the click (one mode at a time;
  // Cable mode and Move mode cannot be on while a form is picking).
  if (S.routePick) {
    const t = ev.target.closest('[data-pick-item], [data-pick-lane]');
    if (!t) return;
    const w = t.dataset.pickLane ? {lane: t.dataset.pickLane, ru: Number(t.dataset.pickRu)}
                                 : {item: t.dataset.pickItem, via: t.dataset.pickVia};
    const {cableId, at} = S.routePick;
    const c = rack().cables.find(x => x.id === cableId);
    if (!c || S.sel?.id !== cableId) { S.routePick = null; render(); return; }
    const shown = shownRoute(c).list;
    S.routePick = {cableId, at: at + 1};
    S.routeSel = {cableId, i: at};
    editRoute(cableId, [...shown.slice(0, at), w, ...shown.slice(at)], 'Waypoint added.');
    return;
  }
  // A tag selects its cable (cable strokes are click-through, rack.css) - in
  // Cable mode too, where only the tags take clicks.
  const cab = ev.target.closest('[data-cable-tags] [data-cable-id]');
  // A new cable's form is open (or any cable form, in Cable mode): finish or
  // cancel it first. Selecting another cable would discard the picked ends
  // and what was typed.
  if (cab && S.sel?.kind === 'cable-form' && (!S.sel.id || S.cable.on)) return;
  if (cab) return select({kind: 'cable', id: cab.dataset.cableId});
  if (S.cable.on) return onCableClick(ev);
  if (S.sel?.kind === 'move') {
    const u = ev.target.closest('[data-u]');
    if (u) {
      const id = S.sel.id;
      const r = patchItem(id, {ru: Number(u.dataset.u), face: u.dataset.face});
      if (!r.ok) S.notice = {text: r.reason, kind: 'error'};
      select({kind: 'item', id});
      return;
    }
    // No U target (a device's own panel): take the U and face from the click,
    // so a cable manager can be moved onto a device by clicking it.
    const svg = ev.target.closest('svg[data-pane]');
    if (svg && isRackFace(chassisOf(itemById(S.sel.id)?.ref))) {
      const id = S.sel.id;
      const r = patchItem(id, {ru: uAtY(rack().frame, svgY(svg, ev.clientX, ev.clientY)), face: svg.dataset.pane});
      if (!r.ok) S.notice = {text: r.reason, kind: 'error'};
      select({kind: 'item', id});
      return;
    }
  }
  // A `through` panel may now cover an empty U's own hit target - the
  // half-depth case, where the space behind a SHORT front device is exactly
  // where a rear device goes - so a plain click there opens the picker for
  // that U on the clicked face instead of selecting the item, but only when
  // all three hold (fix round 1): the frame is four-post (a two-post's
  // through panel is the same physical device on the one shared plane -
  // reaches() is always true there, but the frame check makes the rule read
  // without relying on that), the item does NOT reach this rail (fit.js's
  // reaches - a full-depth server's through panel IS its real, present rear,
  // not a stand-in for empty space), and the U is actually free on this
  // face. Otherwise a through panel is clicked like any other panel: it
  // selects the item.
  // A part beside the rack (rack.zeroU) is selected as itself: it is not an item.
  const zpart = ev.target.closest('[data-zerou-id]');
  if (zpart) return select({kind: 'zerou', id: zpart.dataset.zerouId});
  const through = ev.target.closest('[data-panel="through"]');
  if (through) {
    const svg = through.closest('svg');
    const face = svg.dataset.pane;
    const r = rack();
    // The whole unit when all of it is free on this face; else the half
    // clicked, when that half is (the kit's spans, half-open).
    const y = svgY(svg, ev.clientX, ev.clientY), u = uAtY(r.frame, y), h = halfAtY(r.frame, y);
    const item = itemById(through.dataset.itemId);
    const freeIn = (lo, hi) => !r.items.some(it => !isRackFace(chassisOf(it.ref)) && it.face === face && spansMeet([lo, hi], spanOf(it, chassisOf)));
    const ru = freeIn(u, u + 1) ? u : freeIn(h, h + 0.5) ? h : null;
    const opensPicker = r.frame.kind === 'four-post' && item && !reaches(item, r, chassisOf) && ru != null;
    return opensPicker ? select({kind: 'u', face, ru, ...(ru === u && freeIn(u, u + 1) ? {} : {half: Number.isInteger(ru) ? 'lower' : 'upper'})}) : select({kind: 'item', id: through.dataset.itemId});
  }
  const hit = ev.target.closest('[data-item-id]');
  if (hit) return select({kind: 'item', id: hit.dataset.itemId});
  const u = ev.target.closest('[data-u]');
  // (a unit one half of which is taken offers its other half as a target of its own: elevation.js `data-half`)
  if (u) return select({kind: 'u', face: u.dataset.face, ru: Number(u.dataset.u), ...(u.dataset.half ? {half: u.dataset.half} : {})});
}

// Without IndexedDB, S.lib is a no-op: New rack and Delete would otherwise
// discard the current rack with nothing left of it anywhere - so a rack that
// only lives in memory gets the chance to leave as a file first. Whichever
// button the person answers this for still runs afterward either way; this
// only offers the download.
async function offerDownloadIfNoLibrary() {
  if (S.lib.available) return;
  if (confirm("This browser isn't keeping a library, so this rack will be lost. Save it as .json first?"))
    downloadDoc(theDoc());
}

// THE LIBRARY'S NEW: the open rack is saved, then a new one opens. The menu
// and an agent's new_rack both come here. `shape` lets new_rack build its name
// and frame into the new rack, so it opens as it was asked for.
async function startNewRack(shape = r => r) {
  storeDcimDraft();       // typed for this rack: it must reach this rack, not the next one
  // The previous rack's last write may still be on its way (every edit is
  // written at once: library.js autosaver); waiting for it here means it has
  // landed before the switch.
  await S.save.flush();
  const d = newDoc({name: nextRackName([...(await S.lib.list()).map(x => x.name), rack().name])});
  d.racks[0] = shape(d.racks[0]);
  await S.lib.put(d); setDoc(d);
  return {name: d.racks[0].name};
}
// What new_rack is handed: never the no-library dialog, which an agent can't
// answer (new_rack refuses instead), and the step said as the assistant's.
const agentLibrary = {
  get available() { return !!S.lib?.available; },
  async newRack(shape) {
    const r = await startNewRack(shape);
    addNotice(`Your assistant: Started ${r.name}.`, 'note');
    renderSoon();
    return r;
  },
};

let libDraws = 0;
async function renderLibrary() {
  const mine = ++libDraws;
  const items = $('libItems');
  const act = (text, fn) => { const b = el('button', {type: 'button', text}); b.addEventListener('click', () => { $('libMenu').open = false; fn(); }); return b; };
  const kids = [
    act('New rack', async () => {
      storeDcimDraft();       // typed for this rack: it must reach a download of it too
      await offerDownloadIfNoLibrary();
      await startNewRack();
    }),
    act('Duplicate', async () => {
      // The copy is of the rack as stored: what is typed in an open settings
      // form is a draft for the original, and goes into the original only.
      const copy = structuredClone(theDoc());
      storeDcimDraft();
      await S.save.flush();
      const d = {...copy, id: newDoc().id};
      d.racks[0].name = `${rack().name} copy`; await S.lib.put(d); setDoc(d);
    }),
    act('Rename…', () => { const n = prompt('Rack name', rack().name); if (n && n.trim()) edit({op: 'rename', name: n.trim()}); }),
    act('Delete…', async () => {
      if (!confirm(`Delete ${rack().name} from this browser? This can't be undone.`)) return;
      await offerDownloadIfNoLibrary();
      // The last edit's write may still be on its way. Waiting for it here,
      // before remove(), means it has landed (and is then deleted with the
      // rest), so no put() arrives for a document that's already gone.
      await S.save.flush();
      await S.lib.remove(theDoc().id);
      const next = (await S.lib.list())[0];
      let doc = next ? await getDoc(next.id) : null;
      if (next && !doc) S.notice = CANT_OPEN;
      if (!doc) { doc = newDoc(); await S.lib.put(doc); }
      setDoc(doc);
    }),
    el('hr'),
    act('Save as .json', () => downloadDoc(theDoc())),
    act('Open .json…', () => $('openFile').click()),
  ];
  // The actions at once, so they are never rebuilt under a click; the list of
  // racks after it is read, and only by the newest render.
  items.replaceChildren(...kids);
  const list = await S.lib.list();
  if (mine !== libDraws || !list.length) return;
  items.append(el('hr'), ...list.map(d => {
    // The open rack by its live name: the stored one trails an edit by the autosave delay.
    const b = act(d.id === theDoc().id ? rack().name : d.name, async () => {
      storeDcimDraft();
      await S.save.flush();
      const doc = await getDoc(d.id);
      if (!doc) { $('side').replaceChildren(el('p', {class: 'rk-error', role: 'alert', text: CANT_OPEN})); return; }
      setDoc(doc);
    });
    if (d.id === theDoc().id) b.classList.add('rk-current');
    return b;
  }));
}

// If assets/dist/rack.json (or anything else here) fails to load, the page
// otherwise stays blank with nothing in #side to say why - so this is caught
// whole, reported once, and rethrown so window.__rack.ready still settles
// (rejected) instead of hanging a probe forever.
async function boot() {
  try {
    await bootInner();
  } catch (err) {
    console.warn('[portrayal] the rack builder could not start', err);
    $('side').replaceChildren(el('p', {class: 'rk-error', role: 'alert',
      text: "The Rack Builder couldn't start. Reload to try again."}));
    throw err;
  }
}

async function bootInner() {
  const cat = await loadCatalog('assets/dist/');
  S.devices = cat.devices;
  chassisOf = cat.chassisOf;
  S.entries = cat.entries;
  S.lib = await openLibrary();
  // a write the library refuses is said in the side panel for as long as it is true (saveFailedLine)
  S.save = autosaver(S.lib, {onState: () => renderSide()});
  $('libNote').hidden = S.lib.available;
  let doc = null;
  let last = null;
  try { last = localStorage.getItem(LAST); } catch { /* storage blocked: no last rack */ }
  if (last) doc = await getDoc(last);   // getDoc already reports null rather than throwing
  if (!doc) { const first = (await S.lib.list())[0]; if (first) doc = await getDoc(first.id); }
  if (!doc) { doc = newDoc(); await S.lib.put(doc); }
  $('paneFront').addEventListener('click', onPaneClick);
  $('paneRear').addEventListener('click', onPaneClick);
  wireHover();
  wirePin();
  drag = createDragController({
    panesEl: $('panes'),
    svgFor: face => S.svgs.find(s => s.dataset.pane === face),
    rack, chassisOf, itemById, patchItem,
    // A drag replaces whatever was selected - including a stale empty-U pick
    // whose catalog panel is still open (part 1's bug: that U kept painting
    // its brass highlight forever, since neither a drag nor its drop ever
    // touched S.sel) - with the item actually being dragged, so the render
    // the drop triggers shows the item selected and nothing else.
    onStart: id => {
      S.sel = {kind: 'item', id};
      $('side').replaceChildren(el('p', {id: 'dragStatus', class: 'rk-muted', role: 'status', text: 'Drop to move here.'}));
    },
    onEnd: reason => { if (reason) S.notice = {text: reason, kind: 'error'}; render(); },
    setStatus: text => { const s = $('dragStatus'); if (s) s.textContent = text; },
  });
  // The drag controller is off in Cable mode: a press on a port must stay a click.
  // And off in the side pair: nothing is moved from the side (#187).
  const press = ev => { if (!S.cable.on && !S.routePick && !sidesShown()) drag.onPointerDown(ev); };
  $('paneFront').addEventListener('pointerdown', press);
  $('paneRear').addEventListener('pointerdown', press);
  $('cableBtn').addEventListener('click', () => setCableMode(!S.cable.on));
  // A tag is focusable: Enter or Space selects its cable, as a click does.
  $('panes').addEventListener('keydown', ev => {
    const cab = ev.key === 'Enter' || ev.key === ' ' ? ev.target.closest?.('[data-cable-tags] [data-cable-id]') : null;
    if (cab) {
      ev.preventDefault();
      if (S.sel?.kind === 'cable-form' && (!S.sel.id || S.cable.on)) return;   // as a click: finish or cancel the form first
      // select() redraws the cable layer and destroys the focused tag: the keyboard goes to the row.
      S.focusRow = cab.dataset.cableId;
      select({kind: 'cable', id: cab.dataset.cableId});
    }
  });
  // The frame form is a different activity from Cable mode, as it is from
  // Move: opening it replaces the selection, and turns Cable mode off.
  $('frameBtn').addEventListener('click', () => {
    if (S.cable.on) { S.cable = {on: false, a: null}; paintCableMode(); }
    select(S.sel?.kind === 'frame' ? null : {kind: 'frame'});
  });
  document.head.appendChild(Object.assign(document.createElement('style'), {textContent: MODE3D_CSS}));
  setStage(mountStage($('stagebg'), setStage).get());
  setCovers(mountCovers($('covers'), setCovers).get());
  $('mode').addEventListener('click', ev => {
    const b = ev.target.closest('[data-mode]');
    if (b) setMode(b.dataset.mode);
  });
  $('view2d').addEventListener('click', ev => {
    const b = ev.target.closest('[data-view]');
    if (b) setView(b.dataset.view);
  });
  $('zoomOut').addEventListener('click', () => setZoom(stepZoom($('panes'), S.svgs, S.zoom, -1)));
  $('zoomIn').addEventListener('click', () => setZoom(stepZoom($('panes'), S.svgs, S.zoom, 1)));
  $('zoomFit').addEventListener('click', () => setZoom('fit'));
  $('panes').addEventListener('wheel', ev => {
    if (!(ev.ctrlKey || ev.metaKey)) return;
    // wheelZoom already applies the zoom itself (it needs the SVG's
    // before-and-after box to anchor the pointer), so this only updates the
    // state that follows from its result - applying it again here would be
    // redundant, wasted layout work.
    S.zoom = wheelZoom($('panes'), S.svgs, S.zoom, ev);
    saveZoom(S.zoom);
    setZoomLabel();
  }, {passive: false});
  // A numeric zoom's pixel width is column-width x factor, so it has to
  // track a resize too, not just Fit; the readout (relative to Fit) also
  // moves with the window even when the absolute zoom does not.
  window.addEventListener('resize', () => { applyZoom($('panes'), S.svgs, S.zoom); setZoomLabel(); });
  setZoom(S.zoom);
  $('libMenu').addEventListener('toggle', () => { if ($('libMenu').open) renderLibrary(); });
  $('exportMenu').addEventListener('toggle', () => { if ($('exportMenu').open) renderExports(); });
  $('openFile').addEventListener('change', async () => {
    const file = $('openFile').files[0]; $('openFile').value = '';
    if (!file) return;
    try {
      let d = await readDocFile(file);
      const notes = docNotes(d);
      storeDcimDraft();
      await S.save.flush();
      // A file's own id can match one already in the library (it was saved
      // from here, or from another browser sharing the same rack) - importing
      // it must never overwrite that stored rack, so it gets a fresh id.
      if ((await S.lib.list()).some(x => x.id === d.id)) d = {...d, id: newDoc().id};
      await S.lib.put(d); setDoc(d, notes);
    }
    catch (err) { $('side').replaceChildren(el('p', {class: 'rk-error', role: 'alert', text: err.message})); }
  });
  window.addEventListener('pagehide', () => { storeDcimDraft(); S.save.flush(); });
  document.addEventListener('keydown', ev => {
    // The lens holds its own keyboard (Escape closes it, not the rack's
    // selection), and a click that lands on the backdrop can leave focus on
    // the document while the lens is still open - so its presence, not just
    // the event target, gates every key here.
    if (document.querySelector('.rk-lens')) return;
    // Esc in the cable form's own fields cancels the form, as Cancel does;
    // the next Esc (below) drops the picked end, then leaves the mode. Other
    // forms' fields keep Esc to themselves.
    if (ev.key === 'Escape' && S.routePick) { ev.preventDefault(); S.routePick = null; render(); return; }
    if (ev.key === 'Escape' && ev.target.closest?.('#cableForm')) { ev.preventDefault(); $('cCancel')?.click(); return; }
    if (ev.target.closest?.('input, select, textarea')) return;
    if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'z') {
      ev.preventDefault();
      if (ev.shiftKey) redoStep(); else undoStep();
      return;
    }
    // In Cable mode Esc backs out one step: the open form, then the picked
    // end, then the mode itself.
    if (ev.key === 'Escape' && S.cable.on) {
      ev.preventDefault();
      if (S.sel?.kind === 'cable-form') select(null);
      else if (S.cable.a) { S.cable.a = null; render(); }
      else setCableMode(false);
      return;
    }
    const id = S.sel?.kind === 'item' || S.sel?.kind === 'move' ? S.sel.id : null;
    // Esc in the move or remove panel goes back to the device, as Cancel does.
    const back = S.sel?.kind === 'remove' ? S.sel.id : id;
    if (ev.key === 'Escape' && S.sel?.kind === 'remove') S.focusNext = 'iRemove';
    // Escape puts a pinned cable or bundle down altogether: keyboard focus left
    // on its row must not light it again as a hover (focusHover).
    S.focusQuiet = ev.key === 'Escape' && (S.sel?.kind === 'cable' || S.sel?.kind === 'bundle');
    if (S.focusQuiet && S.hover?.from === 'focus') setHover(null);
    if (ev.key === 'Escape' && S.sel) { ev.preventDefault(); select(back && (S.sel.kind === 'move' || S.sel.kind === 'remove') ? {kind: 'item', id: back} : null); }
    // (not from the side: the side pair moves nothing, #187)
    else if (id && !sidesShown() && (ev.key === 'ArrowUp' || ev.key === 'ArrowDown')) {
      const cur = itemById(id);
      if (cur) {
        ev.preventDefault();
        // half a unit at a time for a device that may start on a half (its height
        // is not a whole number of units, or a file has it on one); a unit otherwise
        const step = Number.isInteger(uOf(cur)) && Number.isInteger(cur.ru) ? 1 : 0.5;
        const r = patchItem(id, {ru: cur.ru + (ev.key === 'ArrowUp' ? step : -step)});
        if (!r.ok) { S.notice = {text: r.reason, kind: 'error'}; render(); }
      }
    }
  });
  paintMode();
  showMode();
  // The kit's editor: its command table holds the parts beside the rack and
  // narrow parts on one rail (zerou.*, side.*, kit 0.6.0) and the bundles
  // (bundle.*, 0.7.0) beside every other command.
  ed = createRackEditor({doc, chassisOf});
  ed.on('change', onChange);
  // AGENTS (spec 2026-10-07-rack-agent-tools): the same editor, as WebMCP tools.
  // Registered now for a browser that has WebMCP; the Connect your AI switch
  // (site/agent/relay.js) registers them for one that doesn't.
  S.agentTools = rackTools({ed, chassisOf, queries: boundQueries(), runExport, context: agentContext, library: agentLibrary});
  // The page hint names the tools only once they are registered (agent-hint.js).
  const toolNames = S.agentTools.map(t => t.name);
  writeHint(document, []);
  S.agentAbort = new AbortController();
  S.agentNative = false;
  setDoc(doc);
  // Registration runs behind the first draw: a failure only logs. The switch
  // asks lazily (and waits for this) whether the browser took the tools.
  S.agentReg = registerTools(S.agentTools, {signal: S.agentAbort.signal})
    .then(r => { S.agentNative = r.registered > 0; if (S.agentNative) writeHint(document, toolNames); })
    .catch(e => console.warn('[portrayal] WebMCP registration', e));
  relaySwitch({mount: $('agentSlot'), tools: S.agentTools, native: async () => { await S.agentReg; return S.agentNative; },
    onTools: on => writeHint(document, on || S.agentNative ? toolNames : []), examples: [
    'Build a 42U rack with two leaf switches at the top, a 24-port patch panel between them, and cable every switch uplink to the panel.',
    'What in this rack has loose cable ends, and why?',
    'Export this rack for NetBox.']});
}

// The queries, bound to this page's readers: the probe hook and the agent tools
// ask the same questions the same way.
const facePorts = async (item, view) =>
  ((await configuredFace({ref: item.ref, cfg: item.cfg, view, swaps: item.swaps, fields: item.fields}))?.ports ?? []);
// WHAT LAYS CABLES IS ANSWERED ONCE FOR A RACK (agent-read.js, portrayal-site#192): a window of describe with the
// routes, and the inspect of a cable or a bundle. A device's inspect lays nothing and is asked each time.
const boundQueries = () => ({
  // ctx: the routing context and the cable types, for a bundle's line (agentContext with route)
  // (asked of the rack the routes were read from where that is the same question: reading.js askOf)
  describe: (r, win, ctx = {}) => describeOnce(Q.describe, r, win, {...ctx, chassisOf}, askOf(r, ctx.route)),
  catalog: filter => Q.catalog(S.devices, filter),
  fitsAt: (r, spot) => Q.fitsAt(r, spot, {chassisOf}),
  freeUs: (r, spot) => Q.freeUs(r, spot, {chassisOf}),
  freePorts: (r, id) => Q.freePorts(r, id, {portsOf: facePorts}),
  looseEnds: r => Q.looseEnds(r, {cableFacts}),
  selectCables: (r, sel, ctx) => Q.selectCables(r, sel, ctx),
  inspect: (r, id, ctx) => inspectOnce(Q.inspect, r, id, ctx, factsStand),
});

// THE KIT'S PER-CALL CONTEXT for an agent's call (agent-context.js): the
// parts lists, the cabled ends' facts and, with route, the routing context and
// the cable types, diameters and bend radii both (portrayal-site#164).
// loadSlots memoizes through the dist fetch, so a warm call fetches nothing.
const agentContext = agentContextFor({
  // chassisOf is read through, not captured: the catalog replaces it once loaded.
  loadSlots: refs => loadSlots(DIST, refs), chassisOf: ref => chassisOf(ref), cableFacts,
  // (the one reading of the rack, which the redraw has usually made already: reading.js)
  routeFacts: r => routesOf(r, chassisOf), cableTypes: () => cableTypesReady});

const ready = boot();
if (PROBE) {
  window.__rack = {ready, doc: () => ed.getDoc(), flush: () => S.save.flush(), scene: () => S.scene3d,
    // Probe only: put a rack in as one undo step, as any edit that changes the rack under the page does.
    replaceRack: (next, undoable) => {
      if (undoable) addNotice(undoable.text, 'note');
      ed.replaceRack(next, undoable?.text ?? 'Changed the rack.');
      if (undoable) S.saidStep = undoable.text;
    },
    apply: cmds => edit(cmds),
    // Probe only: which pair the panes show ('faces' or 'sides'), and a redraw that resolves when it has drawn.
    view: () => S.view,
    // Probe only: the covers setting ('on', 'see' or 'off').
    covers: () => S.covers,
    // Probe only: the 3D scene being built, from before its first device (scene() answers only once it is hung).
    loadingScene: () => S.probeLoading ?? null,
    redraw: () => render(),
    // Probe only (portrayal-site#192): how many times the routes were read and the kit laid a cable
    // (route-context.js reads), where the last finished redraw's time went (lapsOf), how many redraws
    // have finished, and whether one is running or queued.
    reads: () => ({routeFacts: reads.routeFacts, lays: reads.reach / 2, last: reads.last ? {...reads.last} : null}),
    times: () => (S.probeTimes ? {...S.probeTimes, sidePanel: S.probeSide ? {...S.probeSide} : null} : null),
    drawn: () => S.probeDone ?? 0,
    // Probe only: whether the route context the page last read had the kit's `checkKept` on (?probe=1&checkKept=1).
    checkKept: () => S.routes?.ctx?.checkKept === true,
    idle: () => rendering === 0 && !renderQueued,
    // Probe only: the kit's solid bodies for the rack as it is (solids.js solidsOf), as plain data.
    solids: () => solidsOf(rack(), {chassisOf}).map(b => ({item: b.item, part: b.part, box: {...b.box}, zeroU: b.zeroU === true})),
    // Probe only: a bundle command as a panel sends it (bundleCommand): it waits for the rack's routes.
    bundleCommand: cmd => Promise.resolve(bundleCommand(cmd, res => ({error: res.error ?? null, created: res.created ?? null,
      findings: (res.findings ?? []).map(f => f.text)}))),
    // Probe only: put another document in, as opening a file or a rack from the library does (setDoc).
    loadDoc: doc => setDoc(doc),
    undo: () => undoStep(),
    redo: () => redoStep(),
    history: () => ({canUndo: ed.canUndo, canRedo: ed.canRedo, undoSummary: ed.undoSummary, redoSummary: ed.redoSummary}),
    query: (() => { const q = boundQueries(); return {
      describe: () => q.describe(rack()), catalog: f => q.catalog(f), fitsAt: s => q.fitsAt(rack(), s),
      freePorts: id => q.freePorts(rack(), id), looseEnds: () => q.looseEnds(rack())}; })(),
    // Probe only: a notice raised earlier in the same action.
    addNotice: text => addNotice(text, 'note'),
    // Probe only: make the exports' own reading of the cables fail, or one sheet pane's cables (see exports.js).
    failExport: what => failExport(what),
    // Probe only: make reading the cables' faces fail, to see the page without it.
    failCableFacts: on => { S.probeFactsFail = !!on; },
    // Probe only: hold the next redraw that reaches `at` ('routes' or 'drawn': probeHeld) until releaseRedraw;
    // heldRedraw resolves when one is being held there. One hold at a time; releaseRedraw ends it.
    holdRedraw: at => { const h = {at, taken: false}; h.gate = new Promise(open => { h.open = open; }); h.reached = new Promise(reach => { h.reach = reach; }); S.probeHold = h; },
    heldRedraw: () => S.probeHold?.reached ?? Promise.resolve(),
    releaseRedraw: () => { const h = S.probeHold; S.probeHold = null; h?.open(); },
    // Probe only: the 3D scene's own read of the cables' faces fails.
    failSceneFacts: on => { S.probeSceneFactsFail = !!on; },
    // The last redraw's cable facts, as plain data: the derived plug seats per
    // item, and each cabled end's loose-end reason (null when it lands).
    // The routes the page resolved, as plain data: [[cable id, waypoints], ...], or null.
    routes: () => (S.routes ? [...S.routes.routes].map(([id, r]) => [id, r.waypoints]) : null),
    // The pathway fill the page resolved (route.js fill, and the ducts beside the rack), as plain data.
    // A duct's entry carries the channel the page read off its drawing and gave the kit (ductAperture).
    fill: () => (S.routes ? {fill: S.routes.fill.map(f => ({...f, ...(f.zeroU ? {aperture: S.routes.ctx?.zeroUAperture?.({id: f.item}) ?? null} : {})})),
                             over: S.routes.over.map(o => ({...o}))} : null),
    // The ring marks the panes and the scene drew by (route.js ringMarks, rack axes), and the
    // rings a route would enter and leave by one face (route.js ringFindings), as plain data.
    rings: () => (S.routes ? {marks: [...S.routes.marks].map(([id, m]) => [id, m.map(x => (x ? {...x} : null))]),
                              findings: S.routes.ringFindings.map(f => ({...f}))} : null),
    // Each cable's measured path (route.js routePath, kit 0.12.0) as plain data:
    // its routed length, the rings it passes (`held` where a ring holds a cord
    // reaching just into it past its port), the detours and the bodies it still
    // crosses; and the page's crosses-body findings (route.js bodyFindings).
    paths: () => (S.routes ? Object.fromEntries([...S.routes.paths].map(([id, p]) => [id, p && {
      measured: S.routes.lengths.get(id)?.measured ?? null, value: S.routes.lengths.get(id)?.value ?? null,
      rings: p.rings.map(g => ({item: g.item, via: g.via, passed: g.passed, held: g.held === true})),
      detours: p.detours.map(d => ({between: d.between, points: d.points.map(q => ({...q}))})),
      crossings: p.crossings.map(f => ({...f})),
      // the kit's own points (kit 0.13-0.15: reach, approach, tray, rest) and what it lies on
      points: p.points.map(q => ({...q})), rests: (p.rests ?? []).map(x => ({...x}))}])) : null),
    bodies: () => (S.routes ? S.routes.bodyFindings.map(f => ({...f})) : null),
    // The kit's tight bends the page says and rings (route.js bendFindings, for the
    // cables plugged in at both ends: landedBends), as plain data.
    bends: () => (S.routes ? (S.routes.bendsShown ?? []).map(f => ({...f})) : null),
    // Are the routes the page holds the ones read for the rack as it is now
    // (routesNow), and is their context one that cannot be changed in place?
    routesCurrent: () => ({current: !!routesNow(), frozen: !!S.routes?.ctx && Object.isFrozen(S.routes.ctx)}),
    // Probe only: the route context the page's routes were read with (the object itself, to tell one from the next).
    routeContext: () => S.routes?.ctx ?? null,
    // The bundles the page drew by (bundle-view.js bundleFacts), as plain data.
    bundles: () => (S.routes?.bundles ? [...S.routes.bundles.values()].map(f => ({id: f.id, name: f.name, drawn: f.drawn,
      diameter: f.diameter, count: f.straps?.count ?? null, kinds: f.straps?.kinds ?? null, widths: f.straps?.widths ?? null, straps: (f.straps?.straps ?? []).map(x => ({...x})),
      warnings: [...f.check.warnings], checked: f.check.checked})) : null),
    // Probe only: the tie slots a strap is at (the kit's anchorsOf) and the tie straps of single cables the page draws.
    anchors: () => (S.routes?.anchors ?? []).map(a => ({...a, bundles: [...a.bundles], cables: [...a.cables]})),
    tieStraps: () => (S.routes?.tieStraps ?? []).map(m => ({...m, at: {...m.at}, cables: [...m.cables]})),
    cableFacts: () => ({seats: S.cableFacts.seats,
      reasons: Object.fromEntries([...S.cableFacts.ends].map(([k, v]) => [k, v.reason]))})};
}
