// THE RACK BUILDER PAGE: wiring only. The rack lives in S.doc; every change
// goes through commit(), which autosaves and redraws. What the side panel
// shows follows S.sel.

import {newDoc, withFrame, renamed, uLabel, withItem, updateItem, withoutItem} from './rack/model.js';
import {openLibrary, autosaver, downloadDoc, readDocFile} from './rack/library.js';
import {drawElevation} from './rack/elevation.js';
import {reaches, fits, availableDepth, itemsWithU, shrinkRack} from './rack/fit.js';
import {loadChassis, chassisLookup, catalogEntries} from './rack/chassis.js';
import {frameForm} from './rack/frame-form.js';
import {catalogPanel} from './rack/picker.js';
import {openLens} from './rack/explorer-lens.js';
import {inspectorPanel} from './rack/inspector.js';
import {el} from './rack/dom.js';
import {loadZoom, saveZoom, zoomLabel, applyZoom, stepZoom, wheelZoom, factorForFit} from './rack/zoom.js';
import {createDragController} from './rack/drag.js';

const $ = id => document.getElementById(id);
const LAST = 'portrayal.rack.last';
const CANT_OPEN = "This rack couldn't be opened. Reload to try again.";
const CANT_DRAW = "This rack couldn't be drawn. Reload to try again.";
const S = {doc: null, sel: null, lib: null, save: null, devices: {}, draws: 0, notice: null, entries: [],
  zoom: loadZoom(), svgs: [], undo: null,
  pick: {query: '', vendor: 'all', fitsOnly: true, device: null, cfgByRef: {}}};
let chassisOf = () => null;
let suppressNextClick = false;
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

function place(entry, cfg, face, ru) {
  const {rack: next, item} = withItem(rack(), {ref: entry.name, cfg, ru, face, label: entry.model || entry.name});
  S.sel = {kind: 'item', id: item.id};
  commit(next);
}

// A change to a placed item, checked against the rules before it is made.
// A configuration change is a delta against the OLD configuration, so a
// changed cfg that leaves an item with no swaps/fields to carry forward
// says so - one shot, through S.notice, since the panel showing this patch
// is about to be replaced by the redraw it triggers.
function patchItem(id, patch) {
  const r = rack(), it = itemById(id);
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
  const docId = S.doc.id, ref = it.ref;
  const res = await openLens({ref: it.ref, cfg: it.cfg, swaps: it.swaps, fields: it.fields, title: it.label});
  if (res && S.doc.id === docId && itemById(id)?.ref === ref)
    patchItem(id, {cfg: res.config, swaps: res.swaps, fields: res.fields});
}

function commit(nextRack) {
  S.undo = null;
  S.doc = {...S.doc, racks: [nextRack]};
  S.save.saveSoon(S.doc);
  render();
}
function select(sel) { S.sel = sel; render(); }
function setDoc(doc) {
  S.doc = doc; S.sel = null; S.undo = null;
  try { localStorage.setItem(LAST, doc.id); } catch { /* a convenience, not state */ }
  render();
  renderLibrary();
}

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
  if ('heightRU' in patch && patch.heightRU < r.frame.heightRU) {
    const {rack: next, moved, removed} = shrinkRack(r, patch.heightRU, chassisOf);
    if (moved.length || removed.length) {
      S.undo = r;
      const parts = [];
      if (moved.length) parts.push(`Moved ${moved.length} device${moved.length === 1 ? '' : 's'} down to fit ${patch.heightRU}U.`);
      if (removed.length)
        parts.push(`Removed ${removed.length} device${removed.length === 1 ? '' : 's'} from the bottom to fit ${patch.heightRU}U: ${removed.map(i => i.label).join(', ')}.`);
      S.notice = {text: parts.join(' '), kind: 'note'};
    } else {
      S.undo = null;
    }
    S.doc = {...S.doc, racks: [next]};
    S.save.saveSoon(S.doc);
    render();
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
}

async function render() {
  const mine = ++S.draws;
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
  const items = itemsWithU(r, chassisOf);
  const selectedId = S.sel?.kind === 'item' || S.sel?.kind === 'move' ? S.sel.id : null;
  let front, rear;
  try {
    [front, rear] = await Promise.all(['front', 'rear'].map(view => drawElevation({
      items, frame: r.frame, view, hitTargets: true, selectedId,
      selectedU: S.sel?.kind === 'u' && S.sel.face === view ? S.sel.ru : null,
      reaches: it => reaches(it, r, chassisOf),
      depthOf: it => chassisOf(it.ref)?.d})));
  } catch (err) {
    if (mine !== S.draws) return;
    console.warn('[portrayal] the rack elevation failed to draw', err);
    $('side').replaceChildren(el('p', {class: 'rk-error', role: 'alert', text: CANT_DRAW}));
    return;
  }
  if (mine !== S.draws) return;
  $('paneFront').replaceChildren(front);
  $('paneRear').replaceChildren(rear);
  // The SVGs are new nodes every render, so the zoom (a style on the old
  // ones) has to be reapplied to these.
  S.svgs = [front, rear];
  applyZoom($('panes'), S.svgs, S.zoom);
  setZoomLabel();
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
  const r = rack(), sel = S.sel;
  let body;
  if (!sel) body = summary();
  else if (sel.kind === 'frame') body = frameForm({rack: r,
    onName: name => commit(renamed(r, name)), onFrame: patch => commitFrame(patch)});
  else if (sel.kind === 'u') body = catalogPanel({entries: S.entries, rack: r, face: sel.face, ru: sel.ru,
    chassisOf, pick: S.pick, onState: patch => { S.pick = {...S.pick, ...patch}; },
    onPlace: (entry, cfg) => place(entry, cfg, sel.face, sel.ru)});
  else if (sel.kind === 'move') {
    const it = itemById(sel.id);
    if (!it) { S.sel = null; body = summary(); }
    else body = el('div', {}, [
      el('h3', {text: `Move ${it.label}`}),
      el('p', {class: 'rk-muted', text: 'Click the U where its bottom should go, on either face, or use the ↑ and ↓ keys. Esc stops moving.'})]);
  } else {
    const it = itemById(sel.id);
    if (!it) { S.sel = null; body = summary(); }
    else body = inspectorPanel({item: it, rack: r, chassis: chassisOf(it.ref),
      available: availableDepth(r, it, chassisOf),
      onPatch: patch => patchItem(it.id, patch),
      onMove: () => select({kind: 'move', id: it.id}),
      onRemove: () => { if (confirm(`Remove ${it.label} from the rack?`)) { S.sel = null; commit(withoutItem(r, it.id)); } },
      onExplore: () => explore(it.id)});
  }
  const kids = [body];
  const notice = noticeParagraph();
  if (notice) kids.push(notice);
  // The shrink notice and Undo can stay past the render that shows them -
  // they are cleared by the next commit (commit()/undoShrink()) or a
  // document switch (setDoc()), not by this redraw.
  if (S.undo) {
    const undo = el('button', {type: 'button', id: 'undoShrink', text: 'Undo'});
    undo.addEventListener('click', undoShrink);
    kids.push(undo);
  }
  $('side').replaceChildren(...kids);
}

function onPaneClick(ev) {
  if (suppressNextClick) { suppressNextClick = false; return; }
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
      const d = newDoc({name: `Rack ${(await S.lib.list()).length + 1}`});
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
    const b = act(d.name, async () => {
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
  try { const last = localStorage.getItem(LAST); if (last) doc = await getDoc(last); } catch { /* none */ }
  if (!doc) { const first = (await S.lib.list())[0]; if (first) doc = await getDoc(first.id); }
  if (!doc) { doc = newDoc(); await S.lib.put(doc); }
  $('paneFront').addEventListener('click', onPaneClick);
  $('paneRear').addEventListener('click', onPaneClick);
  const drag = createDragController({
    panesEl: $('panes'),
    svgFor: face => S.svgs.find(s => s.dataset.pane === face),
    rack, chassisOf, itemById, patchItem,
    onStart: () => {
      // A real drag (pointer moved, target retargeted by setPointerCapture)
      // does not reliably produce a trailing 'click' on drop in every engine
      // - so this both guards a click that does arrive right away and heals
      // itself on the next tick, rather than eating some later, unrelated
      // click if the browser never fires one for this gesture at all.
      suppressNextClick = true;
      setTimeout(() => { suppressNextClick = false; }, 0);
      $('side').replaceChildren(el('p', {id: 'dragStatus', class: 'rk-muted', role: 'status', text: 'Drop to move here.'}));
    },
    onEnd: reason => { if (reason) S.notice = {text: reason, kind: 'error'}; render(); },
    setStatus: text => { const s = $('dragStatus'); if (s) s.textContent = text; },
  });
  $('paneFront').addEventListener('pointerdown', drag.onPointerDown);
  $('paneRear').addEventListener('pointerdown', drag.onPointerDown);
  $('frameBtn').addEventListener('click', () => select(S.sel?.kind === 'frame' ? null : {kind: 'frame'}));
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
    if (ev.target.closest?.('input, select, textarea')) return;
    const id = S.sel?.kind === 'item' || S.sel?.kind === 'move' ? S.sel.id : null;
    if (ev.key === 'Escape' && S.sel) { ev.preventDefault(); select(id && S.sel.kind === 'move' ? {kind: 'item', id} : null); }
    else if (id && (ev.key === 'ArrowUp' || ev.key === 'ArrowDown')) {
      const cur = itemById(id);
      if (cur) {
        ev.preventDefault();
        const r = patchItem(id, {ru: cur.ru + (ev.key === 'ArrowUp' ? 1 : -1)});
        if (!r.ok) { S.notice = {text: r.reason, kind: 'error'}; render(); }
      }
    }
  });
  setDoc(doc);
}

const ready = boot();
if (new URLSearchParams(location.search).get('probe') === '1') {
  window.__rack = {ready, doc: () => S.doc, flush: () => S.save.flush()};
}
