// THE RACK, EXPORTED (spec §8). Every file is built from the rack document
// through configuredFace - never from the panes on screen, whose hit
// targets, selection and zoom are the page's, not the rack's. Each builder
// resolves to {name, data, type, notes}: `notes` lists what could not be
// resolved (a face never drawn, a part that would not seat, a device with
// no DCIM type), and the file carries the same list - a notes block on the
// sheet, a comment in the draw.io file, NOTES.txt in a zip, a comments
// column or a notes section in a CSV - rather than dropping it.
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
import {uniq, fileStem, titleLines, wrapText, faceNotes, rackNotes, threeDNotes,
        xmlComment, perFaceItems, drawioU, matchDeviceType, yamlHead, moduleTypePath, partNumber,
        stemOf, vendorOf, dcimNotesText, isSeatedPath, TARGET_NAME} from './export-data.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const FACE_W = OPENING + RAIL_W * 2 + 12;     // drawElevation's own viewBox width
const M = 24, GAP = 48, HEAD = 28, LINE = 16, NOTE_LINE = 13;
// The sheet is paper: fixed ink on white, whatever the page's theme.
const INK = '#1D2125', MUTED = '#5B636B', PAPER = '#FFFFFF', RULE = '#B9BFC6';

// The same key drawElevation asks with, so the memo answers both.
export const faceOf = (it, view) => configuredFace({ref: it.ref, cfg: it.cfg, view,
  swaps: it.swaps || {}, fields: it.fields || {}}).catch(() => null);

// What the panes named could not show, item by item.
export async function faceNotesFor(rack, items, panes) {
  const notes = [...rackNotes(rack)];
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
// real size. `standalone` bakes the few `var(--pt-*)` paints (a missing
// face's outline) while the sheet is attached, as cabledElevationSvg does.
export async function sheetSvg(rack, chassisOf, {faces = ['front', 'rear'], date = new Date()} = {}) {
  const items = itemsWithU(rack, chassisOf);
  const notes = await faceNotesFor(rack, items, faces);
  const panes = await Promise.all(faces.map(view =>
    drawElevation({items, frame: rack.frame, view, ears: true, metal: true})));
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
  const notes = await faceNotesFor(rack, items, ['front', 'rear']);
  for (const h of lists.hidden)
    notes.push(`${h.pane === 'front' ? 'Front' : 'Rear'} page: ${h.item.label} is behind ${h.by.label} and is not drawn there.`);
  const numDisp = rack.frame.numbering === 'top-down' ? 'ascend' : 'descend';
  const groups = [];
  for (const pane of ['front', 'rear']) {
    const mounted = await Promise.all(lists[pane].map(async it => {
      const f = await faceOf(it, panelFor(it, pane));
      return {id: it.id, name: it.label, u: drawioU(H, it.ru, it.u), ru: it.u,
              faces: f ? {[pane]: {svg: f.text, vb: f.vb, ports: f.ports}} : {}};
    }));
    groups.push({label: pane === 'front' ? 'Front' : 'Rear', faces: [pane],
                 racks: [{label: rack.name, units: H, numDisp, mounted}]});
  }
  const all = uniq(notes);
  // The notes go INSIDE <mxfile>: draw.io reads its <diagram> children and
  // skips a comment there, and nothing is put before the root element.
  const xml = rackDiagram(groups, {labels: true})
    .replace('<mxfile host="portrayal">', m => m + xmlComment(all));
  return {name: `${fileStem(rack.name)}.drawio`, data: xml, type: 'application/xml', notes: all};
}

// GLB / USDZ (spec §8), from the scene the page built - after complete(), so
// the deferred relief pass (optics, plugs) has landed. The notes ride in the
// scene's userData, which GLTFExporter writes as the scene's `extras`.
export async function modelFile(scene, rack, kind) {
  await scene.complete();
  const notes = uniq([...rackNotes(rack), ...threeDNotes(rack)]);
  scene.three.scene.userData.portrayal = {rack: rack.name, notes};
  const usdz = kind === 'usdz';
  return {name: `${fileStem(rack.name)}.${usdz ? 'usdz' : 'glb'}`,
          data: usdz ? await scene.toUSDZ() : await scene.toGLB(),
          type: usdz ? 'model/vnd.usdz+zip' : 'model/gltf-binary', notes};
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
// what is in it), one part per path.
async function seatedPartsOf(items) {
  const parts = [], notes = [];
  for (const it of items) {
    const seen = new Set();
    for (const view of ['front', 'rear']) {
      const f = await faceOf(it, view);
      if (!f) { notes.push(`${it.label}: no ${view} drawing, so parts seen only from the ${view} are not listed.`); continue; }
      for (const p of seatedParts(f.text)) {
        if (seen.has(p.path)) continue;
        seen.add(p.path);
        parts.push({...p, itemId: it.id, label: it.label});
      }
    }
  }
  return {parts, notes};
}

export async function dcimContext(rack, chassisOf, target, {modules = true} = {}) {
  const T = TARGET_NAME[target];
  const [index, files, comps] = await Promise.all([
    fetchJson(`${EXPORTS_BASE}index.json`), fetchJson(`${EXPORTS_BASE}files.json`), components()]);
  const items = itemsWithU(rack, chassisOf);
  const notes = [...rackNotes(rack)];
  const types = new Map();
  for (const it of items) {
    const manufacturer = chassisOf(it.ref)?.manufacturer;
    const m = matchDeviceType({cfg: it.cfg, manufacturer, paths: index[it.ref]?.[target] || []});
    if (!m) { types.set(it.id, null); notes.push(`${it.label} (${it.ref}): no ${T} device type.`); continue; }
    const head = yamlHead(await fetchText(exportUrl(m.path)));
    // matchDeviceType falls back past the manufacturer filter when no file is in
    // the chassis's own folder; that shows as a file from another vendor's.
    const otherVendor = vendorOf(m.path) !== manufacturer;
    types.set(it.id, {...m, otherVendor, manufacturer: head.manufacturer ?? '', model: head.model ?? '',
                      isFullDepth: head.isFullDepth});
    if (otherVendor)
      notes.push(`${it.label} (${it.ref}): no ${T} device type from ${manufacturer || 'its manufacturer'}, so ` +
                 `${stemOf(m.path)} is another vendor's (${vendorOf(m.path)}) file, a best guess.`);
    else if (m.guess)
      notes.push(`${it.label} (${it.ref}, configuration ${it.cfg || 'default'}): ${stemOf(m.path)} is a best guess ` +
                 `among ${m.candidates} ${T} device types; none names this configuration.`);
  }
  const out = {items, types, modules: [], parts: [], notes};
  if (modules) {
    const {parts, notes: partNotes} = await seatedPartsOf(items);
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
  entries.push({name: 'NOTES.txt', bytes: enc.encode(dcimNotesText({rackName: rack.name, target, date, notes: ctx.notes}))});
  return {name: `${fileStem(rack.name)}-${target}-types.zip`, data: await makeZip(entries, date),
          type: 'application/zip', notes: ctx.notes};
}
