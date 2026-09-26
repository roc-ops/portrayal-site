// THE RACK BUILDER PAGE: wiring only. The rack lives in S.doc; every change
// goes through commit(), which autosaves and redraws. What the side panel
// shows follows S.sel.

import {newDoc, withFrame, renamed, uLabel} from './rack/model.js';
import {openLibrary, autosaver, downloadDoc, readDocFile} from './rack/library.js';
import {drawElevation} from './rack/elevation.js';
import {reaches, fits} from './rack/fit.js';
import {loadChassis, chassisLookup} from './rack/chassis.js';
import {frameForm} from './rack/frame-form.js';
import {el} from './rack/dom.js';

const $ = id => document.getElementById(id);
const LAST = 'portrayal.rack.last';
const CANT_OPEN = "This rack couldn't be opened. Reload to try again.";
const CANT_DRAW = "This rack couldn't be drawn. Reload to try again.";
const S = {doc: null, sel: null, lib: null, save: null, devices: {}, draws: 0, notice: null};
let chassisOf = () => null;
const rack = () => S.doc.racks[0];
const itemById = id => rack().items.find(i => i.id === id) || null;
const topOf = r => Math.max(0, ...r.items.map(i => i.ru + Math.max(1, chassisOf(i.ref)?.ru ?? 1) - 1));

// A stored document can be missing (deleted from another tab) or fail to
// parse (spec §5 rejects it). Either way this reports null rather than
// throwing, so every caller can fall back instead of taking the page down.
async function getDoc(id) {
  try { return await S.lib.get(id); }
  catch (err) { console.warn('[portrayal] could not read a stored rack', id, err); return null; }
}

function commit(nextRack) {
  S.doc = {...S.doc, racks: [nextRack]};
  S.save.saveSoon(S.doc);
  render();
}
function select(sel) { S.sel = sel; render(); }
function setDoc(doc) {
  S.doc = doc; S.sel = null;
  try { localStorage.setItem(LAST, doc.id); } catch { /* a convenience, not state */ }
  render();
  renderLibrary();
}

async function render() {
  const mine = ++S.draws;
  const r = rack();
  $('rackName').textContent = r.name;
  const holes = r.frame.holes.style === 'tapped'
    ? `tapped${r.frame.holes.thread ? ` ${r.frame.holes.thread}` : ''}` : 'square holes';
  $('headFront').textContent = `Front · ${r.frame.heightRU}U ${r.frame.kind} · ${holes}`;
  $('headRear').textContent = 'Rear';
  const items = r.items.map(i => ({...i, u: Math.max(1, chassisOf(i.ref)?.ru ?? 1)}));
  const selectedId = S.sel?.kind === 'item' || S.sel?.kind === 'move' ? S.sel.id : null;
  let front, rear;
  try {
    [front, rear] = await Promise.all(['front', 'rear'].map(view => drawElevation({
      items, frame: r.frame, view, hitTargets: true, selectedId,
      selectedU: S.sel?.kind === 'u' && S.sel.face === view ? S.sel.ru : null,
      reaches: it => reaches(it, r, chassisOf)})));
  } catch (err) {
    if (mine !== S.draws) return;
    console.warn('[portrayal] the rack elevation failed to draw', err);
    $('side').replaceChildren(el('p', {class: 'rk-error', role: 'alert', text: CANT_DRAW}));
    return;
  }
  if (mine !== S.draws) return;
  $('paneFront').replaceChildren(front);
  $('paneRear').replaceChildren(rear);
  renderSide();
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

// Tasks 10 and 11 replace the 'u' and 'item' branches.
function renderSide() {
  const r = rack(), sel = S.sel;
  let body;
  if (!sel) body = summary();
  else if (sel.kind === 'frame') body = frameForm({rack: r, maxTop: topOf(r),
    onName: name => commit(renamed(r, name)), onFrame: patch => commit(withFrame(r, patch))});
  else if (sel.kind === 'u') body = el('h3', {text: `U${uLabel(r.frame, sel.ru)} · ${sel.face}, empty`});
  else body = el('h3', {text: itemById(sel.id)?.label ?? 'Device'});
  const kids = [body];
  if (S.notice) { kids.push(el('p', {class: 'rk-error', role: 'alert', text: S.notice})); S.notice = null; }
  $('side').replaceChildren(...kids);
}

function onPaneClick(ev) {
  const hit = ev.target.closest('[data-item-id]');
  if (hit) return select({kind: 'item', id: hit.dataset.itemId});
  const u = ev.target.closest('[data-u]');
  if (u) return select({kind: 'u', face: u.dataset.face, ru: Number(u.dataset.u)});
}

let libDraws = 0;
async function renderLibrary() {
  const mine = ++libDraws;
  const items = $('libItems');
  const act = (text, fn) => { const b = el('button', {type: 'button', text}); b.addEventListener('click', () => { $('libMenu').open = false; fn(); }); return b; };
  const kids = [
    act('New rack', async () => { const d = newDoc({name: `Rack ${(await S.lib.list()).length + 1}`}); await S.lib.put(d); setDoc(d); }),
    act('Duplicate', async () => { const d = {...structuredClone(S.doc), id: newDoc().id}; d.racks[0].name = `${rack().name} copy`; await S.lib.put(d); setDoc(d); }),
    act('Rename…', () => { const n = prompt('Rack name', rack().name); if (n && n.trim()) commit(renamed(rack(), n.trim())); }),
    act('Delete…', async () => {
      if (!confirm(`Delete ${rack().name} from this browser? This can't be undone.`)) return;
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
      const doc = await getDoc(d.id);
      if (!doc) { $('side').replaceChildren(el('p', {class: 'rk-error', role: 'alert', text: CANT_OPEN})); return; }
      setDoc(doc);
    });
    if (d.id === S.doc.id) b.classList.add('rk-current');
    return b;
  }));
}

async function boot() {
  S.devices = await loadChassis();
  chassisOf = chassisLookup(S.devices);
  S.lib = await openLibrary();
  S.save = autosaver(S.lib);
  $('libNote').hidden = S.lib.available;
  let doc = null;
  try { const last = localStorage.getItem(LAST); if (last) doc = await getDoc(last); } catch { /* none */ }
  if (!doc) { const first = (await S.lib.list())[0]; if (first) doc = await getDoc(first.id); }
  if (!doc) { doc = newDoc(); await S.lib.put(doc); }
  $('paneFront').addEventListener('click', onPaneClick);
  $('paneRear').addEventListener('click', onPaneClick);
  $('frameBtn').addEventListener('click', () => select(S.sel?.kind === 'frame' ? null : {kind: 'frame'}));
  $('libMenu').addEventListener('toggle', () => { if ($('libMenu').open) renderLibrary(); });
  $('openFile').addEventListener('change', async () => {
    const file = $('openFile').files[0]; $('openFile').value = '';
    if (!file) return;
    try { const d = await readDocFile(file); await S.lib.put(d); setDoc(d); }
    catch (err) { $('side').replaceChildren(el('p', {class: 'rk-error', role: 'alert', text: err.message})); }
  });
  window.addEventListener('pagehide', () => S.save.flush());
  setDoc(doc);
}

const ready = boot();
if (new URLSearchParams(location.search).get('probe') === '1') {
  window.__rack = {ready, doc: () => S.doc, flush: () => S.save.flush()};
}
