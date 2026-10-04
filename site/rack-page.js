// THE RACK BUILDER PAGE: wiring only. The rack lives in S.doc; every change
// goes through commit(), which autosaves and redraws. What the side panel
// shows follows S.sel.

import {newDoc, nextRackName, withFrame, renamed, uLabel, withItem, updateItem, withoutItem} from './rack/model.js';
import {openLibrary, autosaver, downloadDoc, readDocFile} from './rack/library.js';
import {drawElevation, uAtY, panelFor} from './rack/elevation.js';
import {fits, reaches, availableDepth, itemsWithU, shrinkRack} from './rack/fit.js';
import {loadChassis, chassisLookup, catalogEntries} from './rack/chassis.js';
import {frameForm} from './rack/frame-form.js';
import {catalogPanel} from './rack/picker.js';
import {openLens} from './rack/explorer-lens.js';
import {inspectorPanel} from './rack/inspector.js';
import {el, svgY} from './rack/dom.js';
import {loadZoom, saveZoom, zoomLabel, applyZoom, stepZoom, wheelZoom, factorForFit} from './rack/zoom.js';
import {createDragController} from './rack/drag.js';
import {mountRack3d} from './rack/scene3d.js';
import {sheetSvg, sheetPng, drawioFile, modelFile, dcimTypesZip, deviceImportCsv, bomCsv, cableScheduleCsv, failExport} from './rack/exports.js';
import {save} from './svg-export.js';
import {exportStatus} from './rack/export-data.js';
import {cableFacts, UNCHECKED} from './rack/cable-plugs.js';
import {mergeSeats, endKey, sameEnd, paneOf, portFree, canCable, withCable, updateCable, withoutCable,
        cablesOf, withoutCablesOf, cableName, endName, proposeMedia, countsBy, sameCables3d} from './rack/cable-rules.js';
import {widenForCables, drawRackCables, roomForCables, portAt, markPort, paintCables} from './rack/cable-view.js';
import {cableForm, cableList, removePanel} from './rack/cable-panel.js';

const $ = id => document.getElementById(id);
const LAST = 'portrayal.rack.last';
const MODE_KEY = 'portrayal.rack.mode';
const CANT_OPEN = "This rack couldn't be opened. Reload to try again.";
const CANT_DRAW = "This rack couldn't be drawn. Reload to try again.";
const CABLES_3D = 'Cables are added in 2D. Switch to 2D to add one.';
function loadMode() {
  try { return localStorage.getItem(MODE_KEY) === '3d' ? '3d' : '2d'; }
  catch { return '2d'; }
}
function saveMode(m) { try { localStorage.setItem(MODE_KEY, m); } catch { /* forgets */ } }
const S = {doc: null, sel: null, lib: null, save: null, devices: {}, draws: 0, notice: null, entries: [],
  zoom: loadZoom(), svgs: [], undo: null, undoText: '', focusNext: null, mode: loadMode(), scene3d: null, scene3dRack: null, camera3d: null,
  // What the last redraw read off the cabled ends: the derived plugs, and why an end is loose.
  cableFacts: {seats: {}, ends: new Map()},
  // Cable mode: on or off, and the A end picked and waiting for its B.
  cable: {on: false, a: null},
  // The cable list's filter: the viewer's, not the document's.
  cableFilter: {purpose: null, media: null},
  pick: {query: '', vendor: 'all', fitsOnly: true, device: null, cfgByRef: {}}};
let chassisOf = () => null;
let drag = null; // the drag controller, wired in bootInner; onPaneClick asks it about a trailing click

// ── 3D ──────────────────────────────────────────────────────────────────
// Rebuilt after every commit while in 3D (debounced) and whenever the frame
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
async function rebuild3d() {
  if (S.mode !== '3d') return;             // overtaken by a switch back to 2D
  const mine = ++stage3dEpoch;
  const camera = S.camera3d;
  const forRack = rack();
  disposeScene3d();
  const built = await mountRack3d($('stage3d'), {rack: forRack, chassisOf, camera});
  if (mine !== stage3dEpoch || S.mode !== '3d') { built?.dispose?.(); return; }
  // An edit made while this was building that the scene does not read (a
  // cable's label, the rack's name) could not re-point a scene that did not
  // exist yet: the scene is current for the rack as it is now.
  const now = rack();
  S.scene3d = built;
  S.scene3dRack = sameScene(now, forRack) ? now : forRack;
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
function paintMode() {
  for (const b of document.querySelectorAll('#rkMode [data-mode]'))
    b.setAttribute('aria-pressed', String(b.dataset.mode === S.mode));
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
const rack = () => S.doc.racks[0];
const itemById = id => rack().items.find(i => i.id === id) || null;

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
// button can outlive that rack (a redraw still on its way): the fit is judged
// again here, against the rack as it is now.
function place(entry, cfg, face, ru) {
  const f = fits(rack(), {ref: entry.name, ru, face}, chassisOf);
  if (!f.ok) { S.notice = {text: f.reason, kind: 'error'}; render(); return; }
  const {rack: next, item} = withItem(rack(), {ref: entry.name, cfg, ru, face, label: entry.model || entry.name});
  S.sel = {kind: 'item', id: item.id};
  commit(next);
}

// A change to a placed item, checked against the rules before it is made.
// A configuration change is a delta against the OLD configuration, so a
// changed cfg that leaves an item with no swaps/fields to carry forward
// says so - one shot, through S.notice, since the panel showing this patch
// is about to be replaced by the redraw it triggers.
const GONE = 'That device is no longer in the rack.';
function patchItem(id, patch) {
  const r = rack(), it = itemById(id);
  // A control of a panel built for an earlier rack (the redraw that replaces
  // it is still on its way): the device may be gone. Nothing is committed.
  if (!it) { S.notice = {text: GONE, kind: 'error'}; render(); return {ok: false, reason: GONE}; }
  const next = {...it, ...patch};
  if (['ru', 'face'].some(k => k in patch)) {
    const f = fits(r, {ref: next.ref, ru: next.ru, face: next.face}, chassisOf, {ignoreId: id});
    if (!f.ok) return f;
  }
  if ('cfg' in patch && patch.cfg !== it.cfg &&
      (Object.keys(it.swaps ?? {}).length || Object.keys(it.fields ?? {}).length) &&
      !Object.keys(next.swaps ?? {}).length && !Object.keys(next.fields ?? {}).length)
    S.notice = {text: 'Your Explorer changes were for the old configuration, so they were cleared.', kind: 'note'};
  commit(updateItem(r, id, patch));
  return {ok: true};
}

// The lens is awaited across a render gap: the rack it opened for can be
// gone (another rack switched in) or the item removed by the time it
// resolves, and a repeated item id (i1, i2, ...) is not unique across
// racks - so the write-back is guarded by both the document and the ref.
async function explore(id) {
  const it = itemById(id);
  if (!it) { render(); return; }               // a stale panel's button: the device is gone
  const docId = S.doc.id, ref = it.ref;
  const res = await openLens({ref: it.ref, cfg: it.cfg, swaps: it.swaps, fields: it.fields, title: it.label});
  if (res && S.doc.id === docId && itemById(id)?.ref === ref)
    patchItem(id, {cfg: res.config, swaps: res.swaps, fields: res.fields});
}

// `undoable` ({text}) makes this change the one pending Undo: the rack as it
// was is kept whole in S.undo and the notice says what happened. Any other
// change retires it, so only one Undo is ever pending.
function commit(nextRack, undoable = null) {
  // The 3D view draws the cables: a commit that adds or removes one, or
  // changes a cable's ends or media, changes the tubes and the plugs seated
  // for them, and goes the same debounced rebuild a device edit does. A commit
  // the scene reads nothing of (a cable's label, purpose or length, the rack's
  // name) has nothing to rebuild there: the scene is kept and re-pointed at
  // the new rack, but only if it was current. One that an earlier edit already
  // made stale (its rebuild still pending) stays stale, so an export still
  // rebuilds it first. An export already running holds the old rack and is
  // discarded by modelExport's guard, as for any commit.
  const prev = rack();
  const kept = sameScene(prev, nextRack);
  S.undo = undoable ? prev : null;
  S.undoText = undoable ? undoable.text : '';
  if (undoable) addNotice(undoable.text, 'note');
  S.doc = {...S.doc, racks: [nextRack]};
  S.save.saveSoon(S.doc);
  render();
  if (!kept) scheduleRebuild3d();
  else if (S.scene3d && S.scene3dRack === prev) S.scene3dRack = nextRack;
}
function select(sel) { S.sel = sel; render(); }
function setDoc(doc) {
  S.doc = doc; S.sel = null; S.undo = null; S.cable.a = null;
  S.cableFilter = {purpose: null, media: null};
  try { localStorage.setItem(LAST, doc.id); } catch { /* a convenience, not state */ }
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
const UNCHECKED_TEXT = 'Cable ends could not be checked, so loose ends are not marked.';
const NOT_ADDED = 'The cable was not added because a device it ran to was removed.';
function addNotice(text, kind = 'error') {
  const old = S.notice && (typeof S.notice === 'string' ? {text: S.notice, kind: 'error'} : S.notice);
  // Overlapping redraws can raise the same sentence twice before either shows it.
  if (old?.text.includes(text)) return;
  S.notice = old ? {text: `${old.text} ${text}`, kind: old.kind} : {text, kind};
}
function pruneCable() {
  const r = rack(), a = S.cable.a;
  if (a && (!itemById(a.item) || !portFree(r, a).ok)) S.cable.a = null;
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
  const free = portFree(rack(), end);
  if (!free.ok) { S.notice = {text: free.reason, kind: 'error'}; render(); return; }
  if (!S.cable.a) { S.cable.a = end; render(); return; }
  // The A end is checked again now: the rack may have changed since it was picked.
  if (!itemById(S.cable.a.item) || !portFree(rack(), S.cable.a).ok) { S.cable.a = null; render(); return; }
  S.sel = {kind: 'cable-form', id: null, a: S.cable.a, b: end};
  S.cable.a = null;
  render();
}
function cableModePanel() {
  const a = S.cable.a;
  return el('div', {id: 'cableHelp'}, [
    el('h3', {text: 'Cable'}),
    el('p', {id: 'cableStep', class: 'rk-muted', role: 'status', text: a
      ? `From ${endName(rack(), a)}. Click the port at the other end, on either face. Esc starts over.`
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
  return cableForm({
    title: cable ? 'Edit cable' : 'New cable', endA: endName(r, a), endB: endName(r, b),
    cable: cable || {media: proposeMedia(info(a), info(b)), purpose: '', label: '', length: null},
    infoA: info(a), infoB: info(b),
    purposes: [...countsBy(r.cables, 'purpose').keys()].filter(Boolean),
    // A saved cable is left selected: lit on the drawing, its row open in the list.
    onSave: fields => {
      // The rack as it is NOW: it may have changed while the form was open (Undo).
      const now = rack();
      if (cable) {
        // The cable may be gone: then there is nothing to save, and nothing is committed.
        if (!now.cables.some(c => c.id === cable.id)) { S.sel = null; render(); return; }
        S.sel = {kind: 'cable', id: cable.id};
        commit(updateCable(now, cable.id, fields));
        return;
      }
      if (!itemById(a.item) || !itemById(b.item)) { S.sel = null; addNotice(NOT_ADDED); render(); return; }
      const ok = canCable(now, a, b);
      if (!ok.ok) { S.sel = null; S.notice = {text: ok.reason, kind: 'error'}; render(); return; }
      const made = withCable(now, {a, b, ...fields});
      S.sel = {kind: 'cable', id: made.cable.id};
      commit(made.rack);
    },
    onCancel: () => select(cable ? {kind: 'cable', id: cable.id} : null)});
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
  return cableList({rack: r, ends: S.cableFacts.ends, on, selectedId: selectedCable(), mode3d: S.mode === '3d',
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
      commit(withoutCable(rack(), id), {text: `Deleted cable ${cableName(c)}.`});
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

// A frame change goes through commit() as usual, unless the height drops and
// some device no longer fits: shrinkRack (fit.js) compacts, then trims from
// the bottom, and the previous rack is kept whole in S.undo (not just the
// frame) so Undo restores items and positions exactly, not only the height.
//
// A field whose new value already matches the committed frame is a no-op:
// removing a still-focused, edited <input> from the DOM (this panel is
// rebuilt on every commit) makes some browsers re-fire 'change' on it as it
// loses focus, echoing the same edit a second time. Applying that echo would
// otherwise re-run this at the now-already-shrunk height and wipe the notice
// and Undo the first pass just set.
function commitFrame(patch) {
  const r = rack();
  // The form names only the part of `holes` it changed; the rest is the
  // frame's as it is now, not as it was when the form was built.
  if (patch.holes) patch = {...patch, holes: {...r.frame.holes, ...patch.holes}};
  if ('heightRU' in patch && patch.heightRU < r.frame.heightRU) {
    const {rack: next, moved, removed} = shrinkRack(r, patch.heightRU, chassisOf);
    if (moved.length || removed.length) {
      S.undo = r;
      const dn = n => `device${n === 1 ? '' : 's'}`;
      const removedNames = () => removed.map(i => i.label).join(', ');
      const text = moved.length && removed.length
        ? `Moved ${moved.length} ${dn(moved.length)} down and removed ${removed.length} from the bottom to fit ${patch.heightRU}U: ${removedNames()}.`
        : moved.length
        ? `Moved ${moved.length} ${dn(moved.length)} down to fit ${patch.heightRU}U.`
        : `Removed ${removed.length} ${dn(removed.length)} from the bottom to fit ${patch.heightRU}U: ${removedNames()}.`;
      // A trimmed device's cables are kept (spec §9.3: never silently
      // deleted); each becomes a loose end, and Undo brings its device back.
      const cut = new Set(removed.flatMap(i => cablesOf(r, i.id).map(c => c.id))).size;
      const kept = cut ? ` ${cut} ${cut === 1 ? 'cable is kept as a loose end' : 'cables are kept as loose ends'}.` : '';
      S.notice = {text: text + kept, kind: 'note'};
      S.undoText = text + kept;
    } else {
      S.undo = null;
    }
    S.doc = {...S.doc, racks: [next]};
    S.save.saveSoon(S.doc);
    render();
    scheduleRebuild3d();
    return;
  }
  const next = withFrame(r, patch);
  if (JSON.stringify(next.frame) === JSON.stringify(r.frame)) return; // the echoed duplicate above
  commit(next);
}

function undoShrink() {
  if (!S.undo) return;
  S.doc = {...S.doc, racks: [S.undo]};
  S.undo = null;
  S.notice = null;
  S.save.saveSoon(S.doc);
  render();
  scheduleRebuild3d();
}

// ── Export (spec §8) ────────────────────────────────────────────────────
// Every export is built from S.doc by exports.js, never from the panes. A
// builder resolves to {name, data, type, notes}, or {error: sentence}; the
// notes travel inside the file, and the status line only counts them - and
// says which ones the file had no place for (`left`, see exportStatus).
// A rebuild follows a commit 300 ms later (scheduleRebuild3d), so an export
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
// live: a commit (and its rebuild 300 ms later), a switch to 2D or another
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
  'netbox-types': () => dcimTypesZip(rack(), chassisOf, 'netbox'),
  'nautobot-types': () => dcimTypesZip(rack(), chassisOf, 'nautobot'),
  'netbox-devices': () => deviceImportCsv(rack(), chassisOf, 'netbox'),
  'nautobot-devices': () => deviceImportCsv(rack(), chassisOf, 'nautobot'),
  bom: () => bomCsv(rack(), chassisOf),
  cables: () => cableScheduleCsv(rack(), chassisOf),
  glb: () => modelExport('glb'),
  usdz: () => modelExport('usdz'),
};
let exporting = false;
async function runExport(kind) {
  if (kind === 'json') { downloadDoc(S.doc); return; }
  if (kind === 'to-3d') { setMode('3d'); return; }
  if (exporting || !BUILD[kind]) return;
  exporting = true;
  // The line is one row and cuts a long sentence short (.rk-export-status),
  // so the whole of it is the element's title too.
  const say = text => { const status = $('exportStatus'); status.textContent = text; status.title = text; };
  say('Preparing…');
  try {
    const out = await BUILD[kind]();
    if (out.error) { say(out.error); return; }
    save(out.data, out.name, out.type);
    say(exportStatus(out));
  } catch (err) {
    console.warn('[portrayal] export', kind, err);
    say("That export didn't work. Try again.");
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
    act('netbox-types', 'NetBox device types (.zip)'),
    act('nautobot-types', 'Nautobot device types (.zip)'),
    act('netbox-devices', 'NetBox device import (.csv)', 'Fill in role and site before importing'),
    act('nautobot-devices', 'Nautobot device import (.csv)', 'Fill in role and location before importing'),
    act('bom', 'Bill of materials (.csv)'),
    act('cables', 'Cable schedule (.csv)'),
    el('hr'),
    act('json', 'Rack file (.json)'),
  );
}

async function render() {
  const mine = ++S.draws;
  pruneCable();
  pruneFilter();
  const r = rack();
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
    const items = itemsWithU(r, chassisOf).map(it => (facts.seats[it.id]
      ? {...it, swaps: mergeSeats(it.swaps, facts.seats[it.id])} : it));
    [front, rear] = await Promise.all(['front', 'rear'].map(view => drawElevation({
      items, frame: r.frame, view, hitTargets: true, selectedId, ears: true, metal: true,
      selectedU: S.sel?.kind === 'u' && S.sel.face === view ? S.sel.ru : null})));
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
  if (cabled) for (const svg of S.svgs) widenForCables(svg);
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
      for (const svg of S.svgs) drawRackCables(svg, r, reasons);
      // A long cable's loop and a low lead's tag reach below the rack: both
      // panes grow downward by what the lowest one needs, and the zoom is
      // applied again to the taller boxes.
      if (roomForCables(S.svgs)) { applyZoom($('panes'), S.svgs, S.zoom); setZoomLabel(); }
      paintCables(S.svgs, r, {selectedId: selectedCable(), on: S.cableFilter});
    }
    // The picked A end, and both ends while a new cable's form is open.
    for (const e of [...pendingEnds(), ...(S.cable.a ? [S.cable.a] : [])]) {
      const it = itemById(e.item);
      if (it) markPort(S.svgs.find(s => s.dataset.pane === paneOf(it, e.view)), it.id, e.path);
    }
  }
  renderSide();
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
  const used = r.items.reduce((n, i) => n + Math.max(1, chassisOf(i.ref)?.ru ?? 1), 0);
  const warnings = r.items
    .map(i => ({i, f: fits(r, {ref: i.ref, ru: i.ru, face: i.face}, chassisOf, {ignoreId: i.id})}))
    .filter(x => !x.f.ok);
  return el('div', {}, [
    el('h3', {text: r.name}),
    el('p', {class: 'rk-muted', text: `${r.items.length} devices · ${used}U used on the rails.`}),
    ...warnings.map(({i, f}) => el('p', {class: 'rk-error', text: `${i.label} at U${uLabel(r.frame, i.ru)}: ${f.reason}`})),
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
    onName: name => { if (name !== rack().name) commit(renamed(rack(), name)); },
    onFrame: patch => commitFrame(patch)});
  else if (sel.kind === 'u') body = catalogPanel({entries: S.entries, rack: r, face: sel.face, ru: sel.ru,
    chassisOf, pick: S.pick, onState: patch => { S.pick = {...S.pick, ...patch}; },
    onPlace: (entry, cfg) => place(entry, cfg, sel.face, sel.ru)});
  else if (sel.kind === 'remove') {
    const it = itemById(sel.id);
    if (!it) { S.sel = null; body = homePanel(); }
    else {
      const n = cablesOf(r, it.id).length;
      // The buttons may outlive the rack they were built for (a redraw still
      // awaiting the cables' faces leaves them clickable): a click acts on the
      // rack as it is now, and does nothing once the device is gone or the
      // panel is no longer this device's.
      const act = fn => () => {
        const now = rack(), cur = now.items.find(i => i.id === it.id);
        if (S.sel?.kind !== 'remove' || S.sel.id !== it.id || !cur) { render(); return; }
        const k = cablesOf(now, it.id).length, cables = `${k} cable${k === 1 ? '' : 's'}`;
        S.sel = null;
        S.focusNext = 'undoShrink';            // the panel's buttons go: the keyboard goes to Undo
        fn(now, cur, k, cables);
      };
      body = removePanel({item: it, count: n,
        onBoth: act((now, cur, k, cables) =>
          commit(withoutCablesOf(withoutItem(now, cur.id), cur.id),
            {text: k ? `Removed ${cur.label} and its ${cables}.` : `Removed ${cur.label}.`})),
        // The count is the one at click time: with no cable left, neither sentence mentions any.
        onKeep: act((now, cur, k, cables) => commit(withoutItem(now, cur.id),
          {text: k ? `Removed ${cur.label}. Its ${cables} ${k === 1 ? 'is a loose end' : 'are loose ends'}.`
                   : `Removed ${cur.label}.`})),
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
    else body = inspectorPanel({item: it, rack: r, chassis: chassisOf(it.ref),
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
        if (confirm(`Remove ${cur.label} from the rack?`)) { S.sel = null; commit(withoutItem(now, cur.id)); }
      },
      onExplore: () => explore(it.id)});
  }
  const kids = [body];
  const notice = noticeParagraph();
  if (notice) kids.push(notice);
  // The shrink notice and Undo can stay past the render that shows them -
  // they are cleared by the next commit (commit()/undoShrink()) or a
  // document switch (setDoc()), not by this redraw.
  if (S.undo) {
    // The notice is shown once; the button stays until the next change. So
    // that it is never a bare "Undo", the sentence saying what it would undo
    // stays beside it: the notice itself while it shows, then a line of its
    // own. Either way it is the button's description.
    if (notice && S.undoText && notice.textContent.includes(S.undoText)) notice.id = 'undoWhat';
    else if (S.undoText) kids.push(el('p', {id: 'undoWhat', class: 'rk-undo-what rk-muted', text: S.undoText}));
    const undo = el('button', {type: 'button', id: 'undoShrink', text: 'Undo',
                               ...(S.undoText ? {'aria-describedby': 'undoWhat'} : {})});
    undo.addEventListener('click', undoShrink);
    kids.push(undo);
  }
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
      .some(it => it.face === face && u >= it.ru && u <= it.ru + it.u - 1);
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
    downloadDoc(S.doc);
}

let libDraws = 0;
async function renderLibrary() {
  const mine = ++libDraws;
  const items = $('libItems');
  const act = (text, fn) => { const b = el('button', {type: 'button', text}); b.addEventListener('click', () => { $('libMenu').open = false; fn(); }); return b; };
  const kids = [
    act('New rack', async () => {
      await offerDownloadIfNoLibrary();
      // A document switch drops whatever the previous rack's last edit had
      // queued (saveSoon fires 500ms later); flushing first means it lands
      // before the switch instead of being silently skipped.
      await S.save.flush();
      const d = newDoc({name: nextRackName([...(await S.lib.list()).map(x => x.name), rack().name])});
      await S.lib.put(d); setDoc(d);
    }),
    act('Duplicate', async () => {
      await S.save.flush();
      const d = {...structuredClone(S.doc), id: newDoc().id};
      d.racks[0].name = `${rack().name} copy`; await S.lib.put(d); setDoc(d);
    }),
    act('Rename…', () => { const n = prompt('Rack name', rack().name); if (n && n.trim()) commit(renamed(rack(), n.trim())); }),
    act('Delete…', async () => {
      if (!confirm(`Delete ${rack().name} from this browser? This can't be undone.`)) return;
      await offerDownloadIfNoLibrary();
      // A pending autosave (queued by the last edit's saveSoon) writes 500ms
      // after it, which can be after confirm()'s blocking dialog closes.
      // Flushing it here - before remove() - means it either lands (and is
      // then deleted with the rest) or is already clear, so it never queues
      // a put() for a document that's already gone.
      await S.save.flush();
      await S.lib.remove(S.doc.id);
      const next = (await S.lib.list())[0];
      let doc = next ? await getDoc(next.id) : null;
      if (next && !doc) S.notice = CANT_OPEN;
      if (!doc) { doc = newDoc(); await S.lib.put(doc); }
      setDoc(doc);
    }),
    el('hr'),
    act('Save as .json', () => downloadDoc(S.doc)),
    act('Open .json…', () => $('openFile').click()),
  ];
  // The actions at once, so they are never rebuilt under a click; the list of
  // racks after it is read, and only by the newest render.
  items.replaceChildren(...kids);
  const list = await S.lib.list();
  if (mine !== libDraws || !list.length) return;
  items.append(el('hr'), ...list.map(d => {
    // The open rack by its live name: the stored one trails an edit by the autosave delay.
    const b = act(d.id === S.doc.id ? rack().name : d.name, async () => {
      await S.save.flush();
      const doc = await getDoc(d.id);
      if (!doc) { $('side').replaceChildren(el('p', {class: 'rk-error', role: 'alert', text: CANT_OPEN})); return; }
      setDoc(doc);
    });
    if (d.id === S.doc.id) b.classList.add('rk-current');
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
  const press = ev => { if (!S.cable.on) drag.onPointerDown(ev); };
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
  $('rkMode').addEventListener('click', ev => {
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
      await S.save.flush();
      // A file's own id can match one already in the library (it was saved
      // from here, or from another browser sharing the same rack) - importing
      // it must never overwrite that stored rack, so it gets a fresh id.
      if ((await S.lib.list()).some(x => x.id === d.id)) d = {...d, id: newDoc().id};
      await S.lib.put(d); setDoc(d);
    }
    catch (err) { $('side').replaceChildren(el('p', {class: 'rk-error', role: 'alert', text: err.message})); }
  });
  window.addEventListener('pagehide', () => S.save.flush());
  document.addEventListener('keydown', ev => {
    // The lens holds its own keyboard (Escape closes it, not the rack's
    // selection), and a click that lands on the backdrop can leave focus on
    // the document while the lens is still open - so its presence, not just
    // the event target, gates every key here.
    if (document.querySelector('.rk-lens')) return;
    // Esc in the cable form's own fields cancels the form, as Cancel does;
    // the next Esc (below) drops the picked end, then leaves the mode. Other
    // forms' fields keep Esc to themselves.
    if (ev.key === 'Escape' && ev.target.closest?.('#cableForm')) { ev.preventDefault(); $('cCancel')?.click(); return; }
    if (ev.target.closest?.('input, select, textarea')) return;
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
  setDoc(doc);
}

const ready = boot();
if (new URLSearchParams(location.search).get('probe') === '1') {
  window.__rack = {ready, doc: () => S.doc, flush: () => S.save.flush(), scene: () => S.scene3d,
    // Probe only: put a rack in through commit(), as any edit that changes the rack under the page does.
    replaceRack: (next, undoable) => commit(next, undoable),
    // Probe only: a notice raised earlier in the same action.
    addNotice: text => addNotice(text, 'note'),
    // Probe only: make reading the cables' faces fail, to see the page without it.
    // Probe only: make the exports' own reading of the cables fail, or one sheet pane's cables (see exports.js).
    failExport: what => failExport(what),
    failCableFacts: on => { S.probeFactsFail = !!on; },
    // The last redraw's cable facts, as plain data: the derived plug seats per
    // item, and each cabled end's loose-end reason (null when it lands).
    cableFacts: () => ({seats: S.cableFacts.seats,
      reasons: Object.fromEntries([...S.cableFacts.ends].map(([k, v]) => [k, v.reason]))})};
}
