// THE RACK, EXPORTED (spec §8). Every file is built from the rack document
// through configuredFace - never from the panes on screen, whose hit
// targets, selection and zoom are the page's, not the rack's. Each builder
// resolves to {name, data, type, notes}: `notes` lists what could not be
// resolved (a face never drawn, a part that would not seat, a device with
// no DCIM type), and the file carries the same list - a notes block on the
// sheet, a comment in the draw.io file, NOTES.txt in a zip, a comments
// column or a notes section in a CSV - rather than dropping it. A file with
// no place for a note (a USDZ, a device CSV's rack-level notes) returns it
// as `left` instead, with `leftText` when one sentence says it better, and
// the status line says so (exportStatus).
//
// The rules (names, CSV, matching, counting) are export-data.js's, which
// has no DOM and is tested with node --test.

import {RU, RAIL_W, OPENING} from './rails.js';
import {drawElevation, panelFor} from './elevation.js';
import {makeZip} from '../bundle.js';
import {configuredFace, components, findComp} from './face.js';
import {itemsWithU} from './fit.js';
import {uLabel} from './model.js';
import {el, svgEl} from './dom.js';
import {standalone} from '../svg-export.js';
import {rasterize} from '../raster.js';
import {rackDiagram} from '../../vendor/drawio.js';
import {uniq, fileStem, titleLines, wrapText, faceNotes, seatNotes, rackNotes, threeDNotes, mountNotes, isRackMount,
        htmlText, perFaceItems, drawioU, matchDeviceType, yamlHead, moduleTypePath, partNumber,
        stemOf, vendorOf, otherVendorNote, deviceImportRows, toCsv, dcimNotesText, isSeatedPath, TARGET_NAME,
        bomRows, BOM_COLUMNS, bomCell, hardwareNotes, partManufacturer, firstSentence} from './export-data.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const FACE_W = OPENING + RAIL_W * 2 + 12;     // drawElevation's own viewBox width
const M = 24, GAP = 48, HEAD = 28, LINE = 16, NOTE_LINE = 13;
// The sheet is paper: fixed ink on white, whatever the page's theme.
const INK = '#1D2125', MUTED = '#5B636B', PAPER = '#FFFFFF', RULE = '#B9BFC6';

// The same key drawElevation asks with, so the memo answers both.
export const faceOf = (it, view) => configuredFace({ref: it.ref, cfg: it.cfg, view,
  swaps: it.swaps || {}, fields: it.fields || {}}).catch(() => null);

// What the panes named could not show, item by item.
export async function faceNotesFor(rack, items, panes, chassisOf = () => null) {
  const notes = [...rackNotes(rack), ...mountNotes(items, chassisOf, rack.frame)];
  for (const it of items) {
    for (const pane of panes) {
      const panel = panelFor(it, pane);
      notes.push(...faceNotes({label: it.label, u: uLabel(rack.frame, it.ru), pane, panel,
                               face: await faceOf(it, panel)}));
    }
  }
  return uniq(notes);
}

const text = (x, y, s, {size = 11, weight = 400, fill = INK, mono = false} = {}) => {
  const t = svgEl('text', {x, y, 'font-size': size, 'font-weight': weight, fill,
    'font-family': mono ? 'IBM Plex Mono, ui-monospace, monospace' : 'Archivo, system-ui, sans-serif'});
  t.textContent = s;
  return t;
};

// THE SHEET: the faces asked for, side by side, fresh from drawElevation
// (no hit targets, no selection; ears and metal, as the page draws them),
// over a title block and, when there are any, the notes. The root carries a
// width and height in millimeters-as-pixels, so rasterize() draws it at its
// real size. `paper` gives a missing face's outline fixed ink too, so the
// file is the same in light and dark; `standalone` bakes whatever
// `var(--pt-*)` paint is left while the sheet is attached, as
// cabledElevationSvg does.
export async function sheetSvg(rack, chassisOf, {faces = ['front', 'rear'], date = new Date()} = {}) {
  const items = itemsWithU(rack, chassisOf);
  const notes = await faceNotesFor(rack, items, faces, chassisOf);
  const panes = await Promise.all(faces.map(view =>
    drawElevation({items, frame: rack.frame, view, ears: true, metal: true, paper: true})));
  const faceH = rack.frame.heightRU * RU + 30;       // drawElevation's own viewBox height
  const width = M * 2 + faces.length * FACE_W + (faces.length - 1) * GAP;
  const chars = Math.floor((width - M * 2 - 24) / 6.2);   // 10 px mono runs about 6 px a character
  const noteLines = notes.flatMap(n => wrapText(n, chars - 2).map((l, i) => (i ? `  ${l}` : `• ${l}`)));

  const sheet = svgEl('svg', {xmlns: SVG_NS});
  const paper = svgEl('rect', {x: 0, y: 0, fill: PAPER});
  sheet.append(paper);
  panes.forEach((pane, i) => {
    const x = M + i * (FACE_W + GAP);
    sheet.append(text(x, M + 16, faces[i] === 'front' ? 'Front' : 'Rear', {size: 14, weight: 600}));
    pane.setAttribute('x', x.toFixed(2));
    pane.setAttribute('y', String(M + HEAD));
    pane.setAttribute('width', FACE_W.toFixed(2));
    pane.setAttribute('height', faceH.toFixed(2));
    sheet.append(pane);
  });

  const blockY = M + HEAD + faceH + 24;
  const box = svgEl('rect', {x: M, y: blockY, width: (width - 2 * M).toFixed(2), fill: 'none', stroke: RULE});
  sheet.append(box);
  let y = blockY + 22;
  titleLines(rack, date).forEach((line, i) => {
    sheet.append(text(M + 12, y, line, i ? {fill: MUTED} : {size: 14, weight: 600}));
    y += LINE;
  });
  if (noteLines.length) {
    y += 6;
    sheet.append(text(M + 12, y, 'Notes', {weight: 600}));
    for (const l of noteLines) { y += NOTE_LINE; sheet.append(text(M + 12, y, l, {size: 10, fill: MUTED, mono: true})); }
  }
  const blockH = y - blockY + 12;
  box.setAttribute('height', blockH.toFixed(2));
  const height = blockY + blockH + M;
  for (const [k, v] of [['width', width], ['height', height]]) {
    sheet.setAttribute(k, v.toFixed(2));
    paper.setAttribute(k, v.toFixed(2));
  }
  sheet.setAttribute('viewBox', `0 0 ${width.toFixed(2)} ${height.toFixed(2)}`);

  const host = el('div', {'aria-hidden': 'true'});
  host.style.cssText = 'position:fixed;left:0;top:0;width:800px;visibility:hidden;pointer-events:none';
  document.body.append(host);
  try {
    host.append(sheet);
    const stem = fileStem(rack.name);
    return {name: faces.length === 1 ? `${stem}-${faces[0]}.svg` : `${stem}-sheet.svg`,
            data: standalone(sheet), type: 'image/svg+xml', notes};
  } finally {
    host.remove();
  }
}

// DRAW.IO (spec §8): one page per face. Each cabinet holds what is mounted
// on that side and the far panel of whatever nothing mounted there covers
// (perFaceItems); a device hidden behind another is listed in the notes.
// Each face is the configured face that side shows (panelFor), so a seated
// card's ports are connection points carrying portrayal-path.
export async function drawioFile(rack, chassisOf) {
  const items = itemsWithU(rack, chassisOf);
  const H = rack.frame.heightRU;
  const lists = perFaceItems(items);
  const notes = await faceNotesFor(rack, items, ['front', 'rear'], chassisOf);
  for (const h of lists.hidden)
    notes.push(`${h.pane === 'front' ? 'Front' : 'Rear'} page: ${h.item.label} is behind ${h.by.label} and is not drawn there.`);
  const numDisp = rack.frame.numbering === 'top-down' ? 'ascend' : 'descend';
  const groups = [];
  for (const pane of ['front', 'rear']) {
    const mounted = await Promise.all(lists[pane].map(async it => {
      const f = await faceOf(it, panelFor(it, pane));
      return {id: it.id, name: htmlText(it.label), u: drawioU(H, it.ru, it.u), ru: it.u,
              faces: f ? {[pane]: {svg: f.text, vb: f.vb, ports: f.ports}} : {}};
    }));
    groups.push({label: pane === 'front' ? 'Front' : 'Rear', faces: [pane],
                 racks: [{label: htmlText(rack.name), units: H, numDisp, mounted}]});
  }
  const all = uniq(notes);
  // rackDiagram writes the notes as a comment INSIDE <mxfile>: draw.io reads
  // its <diagram> children and skips a comment there. Names and labels are
  // HTML-escaped above because its label cells are html=1.
  const xml = rackDiagram(groups, {labels: true, notes: all});
  return {name: `${fileStem(rack.name)}.drawio`, data: xml, type: 'application/xml', notes: all};
}

// GLB / USDZ (spec §8), from the scene the page built - after complete(), so
// the deferred relief pass (optics, plugs) has landed. The notes ride in the
// scene's userData, which GLTFExporter writes as the scene's `extras`. A USDZ
// has no such place, so its notes come back as `left`, not `notes`.
export async function modelFile(scene, rack, kind, chassisOf = () => null) {
  // The render loop runs on the same thread as the exporters, and both encode
  // each texture with canvas.toBlob(), one await at a time. Each await then
  // queues behind a frame of the whole rack: 2-3 s a texture on a software
  // renderer, over 300 textures for four devices. A paused scene makes the
  // same awaits take milliseconds. It is resumed whatever happens.
  // Pausing and resuming one scene is only safe one export at a time:
  // rack-page.js's `exporting` flag serializes them.
  const wasRunning = scene.running?.();
  if (wasRunning) scene.pause();
  try {
    await scene.complete();
    // A device nobody drew, as the sheet says it (only ru, face and turned
    // are read, so the rack's own items do).
    const missing = [];
    for (const it of rack.items) {
      for (const pane of ['front', 'rear']) {
        const panel = panelFor(it, pane);
        if (!await faceOf(it, panel))
          missing.push(...faceNotes({label: it.label, u: uLabel(rack.frame, it.ru), pane, panel, face: null}));
      }
    }
    const notes = uniq([...rackNotes(rack), ...mountNotes(rack.items, chassisOf, rack.frame), ...threeDNotes(rack), ...missing]);
    scene.three.scene.userData.portrayal = {rack: rack.name, notes};
    const usdz = kind === 'usdz';
    return {name: `${fileStem(rack.name)}.${usdz ? 'usdz' : 'glb'}`,
            data: usdz ? await scene.toUSDZ() : await scene.toGLB(),
            type: usdz ? 'model/vnd.usdz+zip' : 'model/gltf-binary',
            ...(usdz ? {notes: [], left: notes, leftText: 'USDZ carries no notes; the GLB does.'} : {notes})};
  } finally {
    if (wasRunning) scene.resume();
  }
}

// rasterize() only takes a URL, so the sheet goes through a blob URL.
export async function sheetPng(rack, chassisOf, opts = {}) {
  const svg = await sheetSvg(rack, chassisOf, opts);
  const url = URL.createObjectURL(new Blob([svg.data], {type: 'image/svg+xml'}));
  try {
    const bytes = await rasterize(url, 2);
    if (!bytes) throw new Error('the sheet could not be rasterized');
    return {name: svg.name.replace(/\.svg$/, '.png'), data: bytes, type: 'image/png', notes: svg.notes};
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ── DCIM (spec §8) ─────────────────────────────────────────────────────
const EXPORTS_BASE = 'assets/exports/';
const TEXT = new Map();
function fetchText(url) {
  if (!TEXT.has(url)) {
    TEXT.set(url, fetch(url)
      .then(r => { if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return r.text(); })
      .catch(err => { TEXT.delete(url); throw err; }));
  }
  return TEXT.get(url);
}
const fetchJson = async url => JSON.parse(await fetchText(url));
// index.json and files.json paths already start with the target folder.
const exportUrl = path => EXPORTS_BASE + path.split('/').map(encodeURIComponent).join('/');

// What a face has SEATED: a bay's module or a cage's occupant. Default
// parts carry data-ref exactly as swapped ones do, so this is the rack as
// configured - defaults, swaps, and a swapped carrier's own defaults - with
// no swap logic re-derived here.
export function seatedParts(svgText) {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  return [...doc.querySelectorAll('[data-ref][data-path]')]
    .map(n => ({path: n.getAttribute('data-path'), ref: n.getAttribute('data-ref').split(':')[0]}))
    .filter(p => isSeatedPath(p.path));
}

// Both of the device's own panels (not the panes': turned does not change
// what is in it), one part per path. This reads what the face ENDED UP
// holding, so a swap it did not take is in the notes: a refused bay is empty
// and lists nothing, a part that could not be loaded lists the
// configuration's own (seatNotes; the caller's uniq drops a note both
// panels give).
async function seatedPartsOf(rack, items) {
  const parts = [], notes = [];
  for (const it of items) {
    const seen = new Set();
    for (const view of ['front', 'rear']) {
      const f = await faceOf(it, view);
      if (!f) { notes.push(`${it.label}: no ${view} drawing, so parts seen only from the ${view} are not listed.`); continue; }
      notes.push(...seatNotes({label: it.label, u: uLabel(rack.frame, it.ru), face: f}));
      for (const p of seatedParts(f.text)) {
        if (seen.has(p.path)) continue;
        seen.add(p.path);
        parts.push({...p, itemId: it.id, label: it.label});
      }
    }
  }
  return {parts, notes: uniq(notes)};
}

export async function dcimContext(rack, chassisOf, target, {modules = true} = {}) {
  const T = TARGET_NAME[target];
  const [index, files, comps] = await Promise.all([
    fetchJson(`${EXPORTS_BASE}index.json`), fetchJson(`${EXPORTS_BASE}files.json`), components()]);
  const items = itemsWithU(rack, chassisOf);
  const notes = [...rackNotes(rack), ...mountNotes(items, chassisOf, rack.frame)];
  const types = new Map();
  for (const it of items) {
    const manufacturer = chassisOf(it.ref)?.manufacturer;
    const m = matchDeviceType({cfg: it.cfg, manufacturer, paths: index[it.ref]?.[target] || []});
    if (!m) { types.set(it.id, null); notes.push(`${it.label} (${it.ref}): no ${T} device type.`); continue; }
    const head = yamlHead(await fetchText(exportUrl(m.path)));
    // matchDeviceType falls back past the manufacturer filter when no file is in
    // the chassis's own folder; that shows as a file from another vendor's.
    const otherVendor = vendorOf(m.path) !== manufacturer;
    // chassisManufacturer is the chassis catalog's value; `manufacturer` below is the YAML's.
    types.set(it.id, {...m, otherVendor, chassisManufacturer: manufacturer, manufacturer: head.manufacturer ?? '', model: head.model ?? '',
                      isFullDepth: head.isFullDepth});
    if (otherVendor)
      notes.push(otherVendorNote({label: it.label, ref: it.ref, T, manufacturer, path: m.path}));
    else if (m.guess)
      notes.push(`${it.label} (${it.ref}, configuration ${it.cfg || 'default'}): ${stemOf(m.path)} is a best guess ` +
                 `among ${m.candidates} ${T} device types; none names this configuration.`);
  }
  const out = {items, types, modules: [], parts: [], notes};
  if (modules) {
    const {parts, notes: partNotes} = await seatedPartsOf(rack, items);
    notes.push(...partNotes);
    const users = new Map();
    for (const p of parts) users.set(p.ref, [...(users.get(p.ref) || []), p.label]);
    for (const [ref, labels] of users) {
      const comp = findComp(comps, ref);
      const model = partNumber(comp);
      const path = moduleTypePath(files[target] || [], model);
      out.modules.push({ref, comp, model, path});
      if (!path) notes.push(`${ref}${model ? ` (${model})` : ''}: no ${T} module type; seated in ${uniq(labels).join(', ')}.`);
    }
    out.parts = parts;
  }
  out.notes = uniq(notes);
  return out;
}

export async function dcimTypesZip(rack, chassisOf, target, {date = new Date()} = {}) {
  const ctx = await dcimContext(rack, chassisOf, target);
  const enc = new TextEncoder();
  const paths = uniq([...ctx.types.values()].filter(Boolean).map(t => t.path)
    .concat(ctx.modules.map(m => m.path).filter(Boolean))).sort();
  const entries = [];
  for (const p of paths) {
    try { entries.push({name: p.split('/').slice(1).join('/'), bytes: enc.encode(await fetchText(exportUrl(p)))}); }
    catch { ctx.notes.push(`${p} couldn't be fetched, so it is not in this zip.`); }
  }
  entries.push({name: 'NOTES.txt', bytes: enc.encode(dcimNotesText({rackName: rack.name, target, date, notes: ctx.notes,
                                                                    devices: ctx.items.length}))});
  return {name: `${fileStem(rack.name)}-${target}-types.zip`, data: await makeZip(entries, date),
          type: 'application/zip', notes: ctx.notes};
}

// The device import (spec §8): one row per rail item. Pure CSV so it
// imports as is; each row's notes are in its own comments column, and those
// are the notes the file carries. A rack-level note (zero-U items, cables)
// has no row to sit in, so it comes back as `left`.
export async function deviceImportCsv(rack, chassisOf, target) {
  const ctx = await dcimContext(rack, chassisOf, target, {modules: false});
  const {columns, rows} = deviceImportRows({rack, items: ctx.items, types: ctx.types, target});
  return {name: `${fileStem(rack.name)}-${target}-devices.csv`, data: toCsv(columns, rows),
          type: 'text/csv', notes: rows.map(r => r.comments).filter(Boolean), left: rackNotes(rack)};
}

// THE BILL OF MATERIALS (spec §8): each device by configuration, each
// seated part by reference (as configured - defaults and swaps alike, read
// off the configured faces by the reader the DCIM exports use), and the
// mounting hardware, 4 x U per device. A spreadsheet opens this one, so
// its cells go through bomCell (formula guard); the DCIM CSVs stay verbatim.
export async function bomCsv(rack, chassisOf) {
  const items = itemsWithU(rack, chassisOf);
  // files.json only names manufacturers here, so the BOM goes on without it -
  // and says so.
  let filesFailed = false;
  const [files, comps] = await Promise.all([
    fetchJson(`${EXPORTS_BASE}files.json`).catch(err => {
      console.warn('[portrayal] BOM: files.json', err);
      filesFailed = true;
      return null;
    }), components()]);
  const {parts, notes} = await seatedPartsOf(rack, items);
  notes.unshift(...rackNotes(rack), ...mountNotes(items, chassisOf, rack.frame));
  if (!items.length) notes.push('This rack has no devices, so there is nothing to list.');
  if (filesFailed && parts.length) notes.push('Manufacturer names could not be loaded, so some are blank.');
  const devices = items.map(it => ({ref: it.ref, cfg: it.cfg,
    manufacturer: chassisOf(it.ref)?.manufacturer ?? '', model: chassisOf(it.ref)?.model ?? it.ref}));
  const lines = parts.map(p => {
    const comp = findComp(comps, p.ref);
    if (!comp) notes.push(`${p.ref} in ${p.label} is not in the component index; it is listed by its reference.`);
    const model = partNumber(comp);
    return {ref: p.ref, cls: comp?.class ?? 'other', model, description: firstSentence(comp?.description),
            manufacturer: partManufacturer(comp, moduleTypePath(files?.netbox || [], model))};
  });
  for (const it of items)
    if (!chassisOf(it.ref)) notes.push(`${it.label}: no size is known for ${it.ref}, so its hardware is counted for 1U.`);
  if (items.length) notes.push(...hardwareNotes(rack.frame));   // no devices, no hardware to explain
  const all = uniq(notes);
  const rows = bomRows({devices, parts: lines, frame: rack.frame, railUs: items.filter(i => isRackMount(chassisOf(i.ref))).map(i => i.u)});
  return {name: `${fileStem(rack.name)}-bom.csv`, data: toCsv(BOM_COLUMNS, rows, all, {cell: bomCell}),
          type: 'text/csv', notes: all};
}
