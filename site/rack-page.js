// THE RACK BUILDER PAGE: wiring only. The rack lives in the headless editor
// (rack/editor.js); every change is a command sent through edit(), and the
// editor's change event autosaves and redraws. What the side panel shows
// follows S.sel.

import {newDoc, nextRackName, positionOf, dcimOf} from './rack/model.js';
import {hostAt, managersOf} from './rack/managers.js';
import {managerRows, managerInspector} from './rack/manager-panel.js';
import {openLibrary, autosaver, downloadDoc, readDocFile, fileName} from './rack/library.js';
import {drawElevation, uAtY, panelFor} from './rack/elevation.js';
import {fits, isRackFace, reaches, availableDepth, itemsWithU, heightOf} from './rack/fit.js';
import {loadChassis, chassisLookup, catalogEntries} from './rack/chassis.js';
import {frameForm} from './rack/frame-form.js';
import {dcimForm} from './rack/dcim-form.js';
import {catalogPanel} from './rack/picker.js';
import {openLens} from './rack/explorer-lens.js';
import {inspectorPanel} from './rack/inspector.js';
import {el, svgY} from './rack/dom.js';
import {loadZoom, saveZoom, zoomLabel, applyZoom, stepZoom, wheelZoom, factorForFit} from './rack/zoom.js';
import {createDragController} from './rack/drag.js';
import {mountRack3d} from './rack/scene3d.js';
import {mountStage, loadStage} from './rack/stage.js';
import {MODE3D_CSS} from './mode3d.js';
import {sheetSvg, sheetPng, drawioFile, modelFile, dcimKit, bomCsv, cableScheduleCsv, failExport} from './rack/exports.js';
import {save} from './svg-export.js';
import {exportStatus, UNCHECKED_NOTE, fillNotes} from './rack/export-data.js';
import {cableFacts, UNCHECKED} from './rack/cable-plugs.js';
import {mergeSeats, endKey, sameEnd, paneOf, portFree, cablesOf, endName, proposeMedia, countsBy, sameCables3d} from './rack/cable-rules.js';
import {widenForCables, drawRackCables, roomForCables, portAt, markPort, paintCables, drawPickTargets, wayEl, inPane} from './rack/cable-view.js';
import {routeList} from './rack/route-panel.js';
import {RU, RAIL_W, OPENING} from './rack/rails.js';
import {cableForm, cableList, removePanel} from './rack/cable-panel.js';
import {routeFacts} from './rack/route-context.js';
import {LANE_GAP, routeText} from './rack/route.js';
import {createRackEditor} from './rack/editor.js';
import {GONE, NOT_ADDED} from './rack/commands.js';
import * as Q from './rack/queries.js';
import {configuredFace} from './rack/face.js';
import {rackTools} from './rack/agent-tools.js';
import {registerTools} from './agent/webmcp.js';
import {relaySwitch, prefs} from './agent/relay.js';
import {touchedIds, markTouched} from './rack/agent-mark.js';

const $ = id => document.getElementById(id);
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
const S = {sel: null, lib: null, save: null, devices: {}, draws: 0, notice: null, entries: [],
  dcimDraft: null, zoom: loadZoom(), svgs: [], focusNext: null, mode: loadMode(), stage: loadStage(), scene3d: null, scene3dRack: null, camera3d: null,
  // What the last redraw read off the cabled ends: the derived plugs, and why an end is loose.
  cableFacts: {seats: {}, ends: new Map()},
  routes: null,
  routeSel: null,    // {cableId, i}: the route row new waypoints go after
  cableDraft: null,  // {id, values}: what the open cable form holds, kept across a route edit's redraw
  routePick: null,   // {cableId, at}: the next click on a ring, duct, brush or gutter adds a waypoint there
  saidStep: null,    // the summary of the step the notice says, which Undo may take as its description
  // Cable mode: on or off, and the A end picked and waiting for its B.
  cable: {on: false, a: null},
  // The cable list's filter: the viewer's, not the document's.
  cableFilter: {purpose: null, media: null},
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
const hasRoutes = () => !!S.routes && [...S.routes.routes.values()].some(x => x.waypoints?.length);
const routesSig = rf => (rf ? JSON.stringify([...rf.routes].map(([id, r]) => [id, r.waypoints])) : '');
async function rebuild3d() {
  if (S.mode !== '3d') return;             // overtaken by a switch back to 2D
  const mine = ++stage3dEpoch;
  const camera = S.camera3d;
  const forRack = rack();
  const sig = routesSig(S.routes);
  disposeScene3d();
  const stage = S.stage;
  const built = await mountRack3d($('stage3d'), {rack: forRack, chassisOf, camera, failFacts: !!S.probeSceneFactsFail,
    routes: S.routes?.routes ?? null, stage});
  if (mine !== stage3dEpoch || S.mode !== '3d') { built?.dispose?.(); return; }
  // An edit made while this was building that the scene does not read (a
  // cable's label, the rack's name) could not re-point a scene that did not
  // exist yet: the scene is current for the rack as it is now.
  const now = rack();
  S.scene3d = built;
  // A swatch picked while this was building found no scene to tell.
  if (S.stage !== stage) built.setStage?.(S.stage);
  S.scene3dRack = sameScene(now, forRack) ? now : forRack;
  S.scene3dRoutes = sig;
  // Routes are resolved by render(), after an edit: if they settled while
  // this was building, the scene was hung by the old ones.
  if (routesSig(S.routes) !== sig) scheduleRebuild3d();
  // A scene built without its cables' faces has no plugs and marks no loose
  // end: 2D says so (render), and so does 3D, once until a build is checked.
  if (built.rackCables && built.rackCables.checked === false) {
    if (!S.unchecked3dSaid) { S.unchecked3dSaid = true; addNotice(UNCHECKED_TEXT, 'note'); render(); }
  } else if (built.rackCables) S.unchecked3dSaid = false;
}
// WHAT THE 3D SCENE READS OF A RACK: its items, its frame, and of its cables
// their ends and media (cable-rules.js sameCables3d). Two racks that agree on
// those build the same scene. A rack-level field the scene comes to read later
// (zeroU) must be added here, or an edit to it will leave the scene, and a GLB
// exported from it, showing the rack as it was.
const sameScene = (a, b) => a.items === b.items && a.frame === b.frame && sameCables3d(a, b);
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
}
// THE 3D BACKGROUND IS THE READER'S, as in the Explorer: picked from the
// swatches, remembered (stage.js), and handed to the scene on screen and to
// every one built after it.
function setStage(c) {
  S.stage = c;
  S.scene3d?.setStage?.(c);
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
  // Cable mode needs the panes (Phase 2 ruling 7): in 3D the button is off, and says why.
  $('cableBtn').disabled = is3d;
  $('cableBtn').title = is3d ? CABLES_3D : '';
  $('stage3d').hidden = !is3d;
  $('stage3d').style.display = is3d ? '' : 'none';
  // The swatches colour the 3D stage only, so in 2D they are invisible and
  // inert - keeping their place, as the zoom controls keep theirs, because the
  // bar is pushed right and anything that came and went would move the switch.
  $('stagebg').style.visibility = is3d ? '' : 'hidden';
  $('stagebg').inert = !is3d;
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
  // render() skips applying zoom while #panes is hidden (it was, in 3D), so
  // whatever was drawn there while hidden never got a real height - this is
  // what makes the panes come back to life rather than blank.
  render();
}
const rack = () => ed.rack();
const theDoc = () => ed.getDoc();
const itemById = id => rack().items.find(i => i.id === id) || null;

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
const setZoomLabel = () => { $('zoomLevel').textContent = zoomLabel(S.zoom, factorForFit($('panes'), S.svgs[0])); };
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
function place(entry, cfg, face, ru) {
  const res = edit({op: 'place', ref: entry.name, cfg, face, ru, label: entry.model || entry.name});
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
  const res = ed.apply(cmds, {origin: 'ui'});
  // A refusal the caller reports is its to redraw too: the inspector shows it
  // beside the control it snaps back, and a redraw would take that away.
  if (res.error) { if (report) { S.notice = {text: res.error, kind: 'error'}; renderSoon(); } return res; }
  if (say && !res.noop && res.summary) { addNotice(res.summary, 'note'); S.saidStep = res.summary; }
  if (res.noop && !quiet) renderSoon();
  return res;
}
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
  if (ev.cause === 'load') { if (ev.findings.length) S.save.saveSoon(theDoc()); return; }
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
  S.save.saveSoon(theDoc());
  // The 3D view draws the cables: a change that adds or removes one, or
  // changes a cable's ends or media, changes the tubes and the plugs seated
  // for them, and goes the same debounced rebuild a device edit does. A change
  // the scene reads nothing of (a cable's label, purpose or length, the rack's
  // name, the DCIM settings) keeps it, re-pointed at the new rack, but only if
  // it was current. An export already running holds the old rack and is
  // discarded by modelExport's guard, as for any change.
  if (sameScene(ev.before, ev.after)) keepScene(ev.before, ev.after);
  else scheduleRebuild3d();
  // NOT A STEP, NOT A REDRAW: the DCIM settings are stored from inside render()
  // (flushDcimDraft) and the routed lengths during one, so redrawing for them
  // would loop. Neither changes what the page shows.
  if (ev.step) renderSoon();
}
// A change the scene reads nothing of swaps the rack object under it. The scene
// is kept and re-pointed at the new rack, but only if it was current for the
// old one: a scene an earlier edit already made stale stays stale. The ONE
// place this is decided, for every change the editor reports (onChange).
function keepScene(prev, next) {
  if (S.scene3d && S.scene3dRack === prev) S.scene3dRack = next;
}
function select(sel) { S.sel = sel; render(); }
function setDoc(doc) {
  const {findings} = ed.loadDoc(doc);   // settles managers; clears history; saves a repair (onChange)
  S.sel = null; S.cable.a = null; S.dcimDraft = null;
  S.routes = null;           // the last document's routes are not this one's (the 3D build reads them)
  for (const f of findings) addNotice(f.text, 'note');
  S.cableFilter = {purpose: null, media: null};
  // "Said once" is once per rack: another rack's unchecked scene is announced too.
  S.unchecked3dSaid = false;
  try { localStorage.setItem(LAST, theDoc().id); } catch { /* a convenience, not state */ }
  render();
  renderLibrary();
  if (S.mode === '3d') rebuild3d();
}

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
  S.cable = {on: !!on && S.mode === '2d', a: null};
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
  const res = S.routes?.routes.get(cable.id);
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
  const r = rack(), ctx = S.routes?.ctx;
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
function cableListPanel() {
  const r = rack();
  pruneFilter();
  const on = S.cableFilter;
  // Fill, capacity and gone-waypoint warnings, from the routes resolved for this render.
  const notes = S.routes ? fillNotes(r, S.routes, id => itemById(id)?.label ?? id) : [];
  return cableList({rack: r, ends: S.cableFacts.ends, notes, on, uOf, selectedId: selectedCable(), mode3d: S.mode === '3d',
    onFilter: next => {
      S.cableFilter = next;
      renderSide();
      paintCables(S.svgs, rack(), {selectedId: selectedCable(), on: next});
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
const homePanel = () => el('div', {}, [
  S.cable.on ? cableModePanel() : summary(),
  // In 3D the cables are drawn and the list still selects, edits and deletes;
  // a selected cable is not lit in the scene, and a cable is added in 2D.
  S.mode === '3d' ? el('p', {id: 'cable3dNote', class: 'rk-muted', role: 'status', text: CABLES_3D}) : null,
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
async function render() {
  flushDcimDraft();
  const mine = ++S.draws;
  pruneCable();
  pruneFilter();
  // The route row and the typed fields belong to one open cable form too.
  const formOf = S.sel?.kind === 'cable-form' ? S.sel.id : null;
  if (S.routeSel && S.routeSel.cableId !== formOf) S.routeSel = null;
  if (S.cableDraft && S.cableDraft.id !== formOf) S.cableDraft = null;
  // Picking belongs to one open cable form, outside Cable mode.
  if (S.routePick && (S.cable.on || S.sel?.kind !== 'cable-form' || S.sel.id !== S.routePick.cableId
      || !rack().cables.some(c => c.id === S.routePick.cableId))) S.routePick = null;
  let r = rack();
  $('rackName').textContent = r.name;
  const holes = r.frame.holes.style === 'tapped'
    ? `tapped${r.frame.holes.thread ? ` ${r.frame.holes.thread}` : ''}` : 'square holes';
  // The heading stays one line ("Front" / "Rear") so both panes' SVGs start
  // at the same top edge; the frame summary that used to wrap it onto two
  // lines lives in the top bar instead, beside the rack name.
  $('headFront').textContent = 'Front';
  $('headRear').textContent = 'Rear';
  $('frameSummary').textContent = `${r.frame.heightRU}U ${r.frame.kind} · ${holes}`;
  const selectedId = S.sel?.kind === 'item' || S.sel?.kind === 'move' || S.sel?.kind === 'remove' ? S.sel.id : null;
  let front, rear, facts;
  try {
    // PLUGS ARE DERIVED, NEVER STORED: a cabled end is drawn with the plug its
    // port takes, laid over the item's own swaps for this drawing only. The
    // document, Explorer and the exports keep reading item.swaps.
    // Cables are an overlay: if reading them fails, the rack still draws, unplugged.
    // Then the ends are drawn as they are, none marked loose, and the panel says so.
    facts = await (S.probeFactsFail ? Promise.reject(new Error('probe: cableFacts fails')) : cableFacts(r, pendingEnds()))
      .catch(err => {
        console.warn('[portrayal] could not read the cables\' faces', err);
        return UNCHECKED;
      });
    if (facts.unchecked && r.cables.length && mine === S.draws) addNotice(UNCHECKED_TEXT, 'note');
    // ROUTES (spec 5, 8): resolved from the drawings each render. A routed
    // length is the document's, so when one changes it is stored by the
    // lengths.routed command, which is not an undo step - it is the page's
    // measurement, not an edit - and so triggers no render (onChange): the side
    // panel and cable list below read S.routes.
    if (r.cables.length) {
      const at = theDoc();
      const rf = await routeFacts(r, chassisOf).catch(err => { console.warn('[portrayal] routes', err); return null; });
      if (mine !== S.draws) return;
      if (!rf) { S.routes = null; if (S.scene3d && S.scene3dRoutes) scheduleRebuild3d(); }
      else if (theDoc() === at) {
        S.routes = rf;
        if (S.scene3d && S.scene3dRoutes !== routesSig(rf)) scheduleRebuild3d();
        // Not from facts with a face missing: a port not found there is not a port that is loose.
        if (rf.complete) {
          // onChange saves it and keeps the scene; the drawing below shows the length just kept.
          const res = ed.apply({op: 'lengths.routed', routeCtx: rf.ctx}, {origin: 'system'});
          if (!res.error && !res.noop) r = rack();
        }
      }
    } else {
      S.routes = null;
      if (S.scene3d && S.scene3dRoutes) scheduleRebuild3d();   // '' when it was hung without routes
    }
    const items = itemsWithU(r, chassisOf).map(it => (facts.seats[it.id]
      ? {...it, swaps: mergeSeats(it.swaps, facts.seats[it.id])} : it));
    [front, rear] = await Promise.all(['front', 'rear'].map(view => drawElevation({
      items, frame: r.frame, view, hitTargets: true, selectedId, ears: true, metal: true,
      selectedU: S.sel?.kind === 'u' && S.sel.face === view ? S.sel.ru : null,
      laneGap: hasRoutes() ? LANE_GAP : 0})));
  } catch (err) {
    if (mine !== S.draws) return;
    console.warn('[portrayal] the rack elevation failed to draw', err);
    $('side').replaceChildren(el('p', {class: 'rk-error', role: 'alert', text: CANT_DRAW}));
    return;
  }
  if (mine !== S.draws) return;
  S.cableFacts = facts;
  $('paneFront').replaceChildren(front);
  $('paneRear').replaceChildren(rear);
  // The SVGs are new nodes every render, so the zoom (a style on the old
  // ones) has to be reapplied to these.
  S.svgs = [front, rear];
  // With cables, both panes widen by the same side column, before the zoom
  // below reads their viewBox; with none they are exactly as they were.
  const cabled = r.cables.length > 0;
  const routed = hasRoutes();
  if (cabled) for (const svg of S.svgs) widenForCables(svg, routed);
  // #panes is hidden while in 3D (showMode()) - applyZoom measures its own
  // column width to fit into, and a hidden element measures 0, which is what
  // left every SVG at height:0 once the panes came back. Skipped here, this
  // is instead applied by setMode() the moment #panes is shown again.
  if (!$('panes').hidden) {
    applyZoom($('panes'), S.svgs, S.zoom);
    setZoomLabel();
    // Cables are measured off the laid-out panes (getScreenCTM), so they are
    // drawn only while the panes show; setMode() redraws on the way back from 3D.
    if (cabled) {
      const reasons = new Map([...facts.ends].map(([k, v]) => [k, v.reason]));
      for (const svg of S.svgs) drawRackCables(svg, r, reasons, uOf, S.routes);
      // A long cable's loop and a low lead's tag reach below the rack: both
      // panes grow downward by what the lowest one needs, and the zoom is
      // applied again to the taller boxes.
      if (roomForCables(S.svgs)) { applyZoom($('panes'), S.svgs, S.zoom); setZoomLabel(); }
      paintCables(S.svgs, r, {selectedId: selectedCable(), on: S.cableFilter});
    }
    if (S.routePick) drawRoutePicking();
    // The picked A end, and both ends while a new cable's form is open.
    for (const e of [...pendingEnds(), ...(S.cable.a ? [S.cable.a] : [])]) {
      const it = itemById(e.item);
      if (it) markPort(S.svgs.find(s => s.dataset.pane === paneOf(it, e.view)), it.id, e.path);
    }
  }
  renderSide();
  paintAgentMark();
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
  const used = devices.reduce((n, i) => n + Math.max(1, chassisOf(i.ref)?.ru ?? 1), 0);
  const warnings = r.items
    .map(i => ({i, f: fits(r, {ref: i.ref, ru: i.ru, face: i.face, ...('setback' in i ? {setback: i.setback} : {})},
                               chassisOf, {ignoreId: i.id})}))
    .filter(x => !x.f.ok);
  return el('div', {}, [
    el('h3', {text: r.name}),
    el('p', {class: 'rk-muted', text: `${devices.length} devices · ${used}U used on the rails${managers ? ` · ${managers} cable manager${managers === 1 ? '' : 's'}` : ''}.`}),
    ...warnings.map(({i, f}) => el('p', {class: 'rk-error', text: `${i.label} at U${positionOf(r.frame, i.ru, uOf(i))}: ${f.reason}`})),
    el('p', {class: 'rk-muted', text: 'Click an empty U on either face to place a device there.'}),
  ]);
}

function renderSide() {
  // Rebuilding the panel must not take keyboard focus away (a frame edit
  // redraws the form): the control that had it gets it back, by id.
  const had = document.activeElement;
  const focusId = had && $('side').contains(had) ? had.id : '';
  const r = rack();
  if (S.sel?.kind === 'cable' && !r.cables.some(c => c.id === S.sel.id)) S.sel = null;   // that cable is gone
  const sel = S.sel;
  let body;
  if (!sel || sel.kind === 'cable') body = homePanel();
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
  else if (sel.kind === 'u') body = catalogPanel({entries: S.entries, rack: r, face: sel.face, ru: sel.ru,
    chassisOf, pick: S.pick, onState: patch => { S.pick = {...S.pick, ...patch}; },
    onPlace: (entry, cfg) => place(entry, cfg, sel.face, sel.ru), onlyMount: sel.onlyMount ?? null});
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
      el('p', {class: 'rk-muted', text: 'Click the U where its bottom should go, on either face, or use the ↑ and ↓ keys. Esc stops moving.'})]);
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
        onAdd: unit => select({kind: 'u', face: it.face, ru: it.ru + unit - 1, onlyMount: 'rack-face'}),
        onSelect: id => select({kind: 'item', id}),
        onRemove: id => {
          const m = itemById(id);
          if (!m) { render(); return; }
          edit({op: 'remove', id}, {say: true});
        }})]);
  }
  const kids = [body];
  const notice = noticeParagraph();
  if (notice) kids.push(notice);
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
  if (row) row.focus();
  else if (next) next.focus();
  else if (back) back.focus();
  // A cable form that just opened takes the keyboard at its first field.
  else if (S.sel?.kind === 'cable-form') $('cMedia')?.focus();
}

function onPaneClick(ev) {
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
  const through = ev.target.closest('[data-panel="through"]');
  if (through) {
    const svg = through.closest('svg');
    const face = svg.dataset.pane;
    const r = rack();
    const u = uAtY(r.frame, svgY(svg, ev.clientX, ev.clientY));
    const item = itemById(through.dataset.itemId);
    const free = !itemsWithU(r, chassisOf)
      .some(it => !isRackFace(chassisOf(it.ref)) && it.face === face && u >= it.ru && u <= it.ru + it.u - 1);
    const opensPicker = r.frame.kind === 'four-post' && item && !reaches(item, r, chassisOf) && free;
    return opensPicker ? select({kind: 'u', face, ru: u}) : select({kind: 'item', id: through.dataset.itemId});
  }
  const hit = ev.target.closest('[data-item-id]');
  if (hit) return select({kind: 'item', id: hit.dataset.itemId});
  const u = ev.target.closest('[data-u]');
  if (u) return select({kind: 'u', face: u.dataset.face, ru: Number(u.dataset.u)});
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

let libDraws = 0;
async function renderLibrary() {
  const mine = ++libDraws;
  const items = $('libItems');
  const act = (text, fn) => { const b = el('button', {type: 'button', text}); b.addEventListener('click', () => { $('libMenu').open = false; fn(); }); return b; };
  const kids = [
    act('New rack', async () => {
      storeDcimDraft();       // typed for this rack: it must reach this rack, not the next one
      await offerDownloadIfNoLibrary();
      // A document switch drops whatever the previous rack's last edit had
      // queued (saveSoon fires 500ms later); flushing first means it lands
      // before the switch instead of being silently skipped.
      await S.save.flush();
      const d = newDoc({name: nextRackName([...(await S.lib.list()).map(x => x.name), rack().name])});
      await S.lib.put(d); setDoc(d);
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
      // A pending autosave (queued by the last edit's saveSoon) writes 500ms
      // after it, which can be after confirm()'s blocking dialog closes.
      // Flushing it here - before remove() - means it either lands (and is
      // then deleted with the rest) or is already clear, so it never queues
      // a put() for a document that's already gone.
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

// If site/rack/chassis.json (or anything else here) fails to load, the page
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
  S.devices = await loadChassis();
  chassisOf = chassisLookup(S.devices);
  S.entries = catalogEntries(S.devices);
  S.lib = await openLibrary();
  S.save = autosaver(S.lib);
  $('libNote').hidden = S.lib.available;
  let doc = null;
  let last = null;
  try { last = localStorage.getItem(LAST); } catch { /* storage blocked: no last rack */ }
  if (last) doc = await getDoc(last);   // getDoc already reports null rather than throwing
  if (!doc) { const first = (await S.lib.list())[0]; if (first) doc = await getDoc(first.id); }
  if (!doc) { doc = newDoc(); await S.lib.put(doc); }
  $('paneFront').addEventListener('click', onPaneClick);
  $('paneRear').addEventListener('click', onPaneClick);
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
  const press = ev => { if (!S.cable.on && !S.routePick) drag.onPointerDown(ev); };
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
  S.stage = mountStage($('stagebg'), setStage).get();
  $('mode').addEventListener('click', ev => {
    const b = ev.target.closest('[data-mode]');
    if (b) setMode(b.dataset.mode);
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
      storeDcimDraft();
      await S.save.flush();
      // A file's own id can match one already in the library (it was saved
      // from here, or from another browser sharing the same rack) - importing
      // it must never overwrite that stored rack, so it gets a fresh id.
      if ((await S.lib.list()).some(x => x.id === d.id)) d = {...d, id: newDoc().id};
      await S.lib.put(d); setDoc(d);
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
    if (ev.key === 'Escape' && S.sel) { ev.preventDefault(); select(back && (S.sel.kind === 'move' || S.sel.kind === 'remove') ? {kind: 'item', id: back} : null); }
    else if (id && (ev.key === 'ArrowUp' || ev.key === 'ArrowDown')) {
      const cur = itemById(id);
      if (cur) {
        ev.preventDefault();
        const r = patchItem(id, {ru: cur.ru + (ev.key === 'ArrowUp' ? 1 : -1)});
        if (!r.ok) { S.notice = {text: r.reason, kind: 'error'}; render(); }
      }
    }
  });
  paintMode();
  showMode();
  ed = createRackEditor({doc, chassisOf});
  ed.on('change', onChange);
  // AGENTS (spec 2026-10-07-rack-agent-tools): the same editor, as WebMCP tools.
  // Registered now for a browser that has WebMCP; the Connect your AI switch
  // (site/agent/relay.js) registers them for one that doesn't.
  S.agentTools = rackTools({ed, chassisOf, queries: boundQueries(), runExport});
  S.agentAbort = new AbortController();
  S.agentNative = false;
  setDoc(doc);
  // Registration runs behind the first draw: a failure only logs. The switch
  // asks lazily (and waits for this) whether the browser took the tools.
  S.agentReg = registerTools(S.agentTools, {signal: S.agentAbort.signal})
    .then(r => { S.agentNative = r.registered > 0; })
    .catch(e => console.warn('[portrayal] WebMCP registration', e));
  relaySwitch({mount: $('agentSlot'), tools: S.agentTools, native: async () => { await S.agentReg; return S.agentNative; }, examples: [
    'Build a 42U rack with two leaf switches at the top, a 24-port patch panel between them, and cable every switch uplink to the panel.',
    'What in this rack has loose cable ends, and why?',
    'Export this rack for NetBox.']});
}

// The queries, bound to this page's readers: the probe hook and the agent tools
// ask the same questions the same way.
const facePorts = async (item, view) =>
  ((await configuredFace({ref: item.ref, cfg: item.cfg, view, swaps: item.swaps, fields: item.fields}))?.ports ?? []);
const boundQueries = () => ({
  describe: r => Q.describe(r, {chassisOf}),
  catalog: filter => Q.catalog(S.devices, filter),
  fitsAt: (r, spot) => Q.fitsAt(r, spot, {chassisOf}),
  freeUs: (r, spot) => Q.freeUs(r, spot, {chassisOf}),
  freePorts: (r, id) => Q.freePorts(r, id, {portsOf: facePorts}),
  looseEnds: r => Q.looseEnds(r, {cableFacts}),
});

const ready = boot();
if (new URLSearchParams(location.search).get('probe') === '1') {
  window.__rack = {ready, doc: () => ed.getDoc(), flush: () => S.save.flush(), scene: () => S.scene3d,
    // Probe only: put a rack in as one undo step, as any edit that changes the rack under the page does.
    replaceRack: (next, undoable) => {
      if (undoable) addNotice(undoable.text, 'note');
      ed.replaceRack(next, undoable?.text ?? 'Changed the rack.');
      if (undoable) S.saidStep = undoable.text;
    },
    apply: cmds => edit(cmds),
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
    // Probe only: the 3D scene's own read of the cables' faces fails.
    failSceneFacts: on => { S.probeSceneFactsFail = !!on; },
    // The last redraw's cable facts, as plain data: the derived plug seats per
    // item, and each cabled end's loose-end reason (null when it lands).
    // The routes the page resolved, as plain data: [[cable id, waypoints], ...], or null.
    routes: () => (S.routes ? [...S.routes.routes].map(([id, r]) => [id, r.waypoints]) : null),
    cableFacts: () => ({seats: S.cableFacts.seats,
      reasons: Object.fromEntries([...S.cableFacts.ends].map(([k, v]) => [k, v.reason]))})};
}
