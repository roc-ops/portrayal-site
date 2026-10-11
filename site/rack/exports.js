// THE RACK, EXPORTED (spec §8). Every file is built from the rack document
// through configuredFace - never from the panes on screen, whose hit
// targets, selection and zoom are the page's, not the rack's. Each builder
// resolves to {name, data, type, notes}: `notes` lists what could not be
// resolved (a face never drawn, a part that would not seat, a device with
// no DCIM type), and the file carries the same list - a notes block on the
// sheet, a comment in the draw.io file, README.txt in an import kit, a notes
// section in a CSV - rather than dropping it. A file with no place for a
// note (a USDZ) returns it as `left` instead, with `leftText` when one
// sentence says it better, and the status line says so (exportStatus).
//
// The rules (names, CSV, matching, counting) are export-data.js's, which
// has no DOM and is tested with node --test.

import {RU, RAIL_W, OPENING} from '../../vendor/rack/rails.js';
import {drawElevation, panelFor} from './elevation.js';
import {holdUndimmed, withoutBendRings, withFileStraps} from './hover.js';
import {withCoversAsBuilt} from './covers.js';
import {STRAP_PAINT} from './stage.js';
import {makeZip} from '../bundle.js';
import {configuredFace, components, findComp} from './face.js';
import {itemsWithU, heightOf} from '../../vendor/rack/fit.js';
import {el, svgEl} from './dom.js';
import {standalone} from '../svg-export.js';
import {rasterize} from '../raster.js';
import {rackDiagram} from '../../vendor/drawio.js';
import {uniq, fileStem, titleLines, wrapText, faceNotes, seatNotes, rackNotes, threeDNotes, mountNotes, managerNotes, isRackMount,
        htmlText, perFaceItems, drawioU, matchDeviceType, yamlHead, moduleTypePath, partNumber,
        stemOf, vendorOf, dirOf, otherVendorNote, deviceImportRows, toCsv, isSeatedPath, TARGET_NAME,
        bomRows, BOM_COLUMNS, bomCell, hardwareNotes, partManufacturer, firstSentence,
        cableScheduleRows, cableBomRows, cableNotes, sheetCableNotes, cableNames, UNCHECKED_NOTE, uOfItem, rearSuffix, drawioId, rearCabinetLabel,
        drawioCables, drawioCableStyle, drawioMediaKey, cableBomNotes, uniqueEntryIds, rearNoDrawing, uniqueNames, rackImportRows,
        zeroUNotes, zeroUImportItems, bundleExports, strapBomRows, strapBomNotes} from '../../vendor/rack/export-data.js';
import {cableFacts, UNCHECKED} from './cable-plugs.js';
import {routeFacts, routeNotes, withCableTypes, cableTypes} from './route-context.js';
import {LANE_GAP, bodyFindings} from '../../vendor/rack/route.js';
import {mergeSeats, endKey, endName, portPathOf} from '../../vendor/rack/cable-rules.js';
import {dcimOf, zeroUOf} from '../../vendor/rack/model.js';
import {typeLists, resolveEnd, moduleImportRows, cableImportRows, kitReadme, kitNames, KIT_FILES, KIT_SCRIPT} from '../../vendor/rack/dcim-rules.js';
import {ROOM, widenForCables, drawRackCables, roomForCables} from './cable-view.js';
import {sheetBundleNotes} from './bundle-view.js';
import {COLORS, colorOf} from './cables.js';
import {zeroUEntries} from '../../vendor/rack/zero-u.js';

// AN EXPORT THAT CARRIES THE PARTS BESIDE THE RACK says where each stands
// (export-data.js zeroUNotes), and calls left out only an entry it cannot
// place: the kit's rackNotes with {zeroU: false, chassisOf} (#926).
const besideNotes = (rack, chassisOf) => rackNotes(rack, {cables: false, zeroU: false, chassisOf});

// WHAT THIS PAGE CALLS ITSELF in what it writes (#895 upstream): the kit's sheet title and import-kit README
// name whoever drew them, and say where the DCIM settings are, in words a host passes in. These are the Rack
// Builder's own, which the sheet and the README said before the kit took them as arguments.
const SOURCE = 'the Portrayal Rack Builder';
const SETTINGS_AT = 'under Export, DCIM import settings';
const SVG_NS = 'http://www.w3.org/2000/svg';
const FACE_W = OPENING + RAIL_W * 2 + 12;     // drawElevation's own viewBox width
const M = 24, GAP = 48, HEAD = 28, LINE = 16, NOTE_LINE = 13;
// The sheet is paper: fixed ink on white, whatever the page's theme.
const INK = '#1D2125', MUTED = '#5B636B', PAPER = '#FFFFFF', RULE = '#B9BFC6';

// The same key drawElevation asks with, so the memo answers both.
export const faceOf = (it, view) => configuredFace({ref: it.ref, cfg: it.cfg, view,
  swaps: it.swaps || {}, fields: it.fields || {}}).catch(() => null);

// What the panes named could not show, item by item. `cables: false` is for
// a file that carries the cables, and so does not say they are left out;
// `zeroU: false` for one that draws the parts beside the rack. A narrow part's
// rail is in the kit's own manager note (export-data.js managerNotes).
export async function faceNotesFor(rack, items, panes, chassisOf = () => null, {cables = true, zeroU = true} = {}) {
  const notes = [...rackNotes(rack, {cables, zeroU, chassisOf}), ...mountNotes(items, chassisOf, rack.frame),
                 ...managerNotes(items, chassisOf, rack.frame)];
  for (const it of items) {
    for (const pane of panes) {
      const panel = panelFor(it, pane);
      notes.push(...faceNotes({label: it.label, u: uOfItem(rack.frame, it, chassisOf), pane, panel,
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

// The cabled ends of a rack as an export draws them: the items with the
// derived plugs laid over their own swaps (for this drawing only - notes, the
// BOM and the DCIM exports keep reading item.swaps), and why each end is
// loose. With no cables it reads nothing and the items are the rack's own.
async function cabledItems(rack, base) {
  if (!(rack.cables || []).length) return {cabled: false, facts: UNCHECKED, items: base, reasons: new Map()};
  const facts = await cableEnds(rack);
  return {cabled: true, facts,
          items: base.map(it => (facts.seats[it.id] ? {...it, swaps: mergeSeats(it.swaps, facts.seats[it.id])} : it)),
          reasons: new Map([...facts.ends].map(([k, v]) => [k, v.reason]))};
}

// The routes and pathway fill of a rack's cables (route-context.js), read once
// per export. Null with no cables or when the drawings cannot be read: the
// export then comes without routes, as it did before them.
const routesOf = (rack, chassisOf) => ((rack.cables || []).length
  ? routeFacts(rack, chassisOf).catch(err => { console.warn('[portrayal] export: routes', err); return null; })
  : Promise.resolve(null));
const hasWaypoints = rf => !!rf && [...rf.routes.values()].some(x => x.waypoints?.length);
const labelOf = rack => id => (rack.items || []).find(i => i.id === id)?.label ?? zeroUOf(rack).find(z => z.id === id)?.label ?? id;

const boxOf = svg => svg.getAttribute('viewBox').split(/\s+/).map(Number);
const MONO = 'IBM Plex Mono, ui-monospace, monospace';

// A TAG IS PART OF THE DRAWING ON PAPER. On the page it is a control (a
// button, painted by rack.css, in a layer standalone() strips); on the sheet
// it is the only thing that says where a cross-face run goes or that a lead
// is not connected. So the layer stops being screen UI, and each pill gets
// fixed ink of its own: no class, no tabindex, no role, no theme token.
function paperTags(pane) {
  // pointer-events is a screen concern; the title (hover text) stays as accessible text.
  for (const n of pane.querySelectorAll('[data-cables][pointer-events], [data-cables] [pointer-events], [data-cable-tags] [pointer-events]'))
    n.removeAttribute('pointer-events');
  const set = (node, attrs) => { for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v); };
  for (const layer of pane.querySelectorAll(':scope > [data-cable-tags]')) {
    layer.removeAttribute('data-pt-ui');
    for (const tag of layer.querySelectorAll('[data-cable-tag]')) {
      const loose = tag.classList.contains('not-connected');
      for (const a of ['class', 'tabindex', 'role']) tag.removeAttribute(a);
      if (loose) tag.setAttribute('data-not-connected', 'true');
      set(tag.querySelector('rect'), {fill: PAPER, stroke: loose ? MUTED : RULE, 'stroke-width': 1,
                                      ...(loose ? {'stroke-dasharray': '3 2'} : {})});
      set(tag.querySelector('text'), {fill: INK, 'font-family': MONO, 'font-size': 11, 'font-weight': 500});
    }
  }
}

// THE SHEET: the faces asked for, side by side, fresh from drawElevation
// (no hit targets, no selection; ears and metal, as the page draws them),
// over a title block and, when there are any, the notes. The root carries a
// width and height in millimeters-as-pixels, so rasterize() draws it at its
// real size. `paper` gives a missing face's outline fixed ink too, so the
// file is the same in light and dark; `standalone` bakes whatever
// `var(--pt-*)` paint is left while the sheet is attached, as
// cabledElevationSvg does.
//
// WITH CABLES the sheet draws them as the page does (cable-view.js): the
// derived plugs seated, every pane widened by the side column and grown
// together to hold the lowest loop or lead, a cross-face run leaving by a
// tag, a loose end as an unplugged lead with its tag. The cable code
// measures a laid-out drawing, so the sheet is attached to its hidden host
// BEFORE the cables are drawn, and the title block is placed after them.
// A RACK WITH NO CABLES takes none of that: its sheet is byte for byte the
// one this function made before cables (check_rack_export_sheet_pinned).
export async function sheetSvg(rack, chassisOf, {faces = ['front', 'rear'], date = new Date()} = {}) {
  const base = itemsWithU(rack, chassisOf);
  const {cabled, facts, items, reasons} = await cabledItems(rack, base);
  const rf = cabled ? await routesOf(rack, chassisOf) : null;
  const routed = hasWaypoints(rf);
  // What a pane could not show is judged on the items' own swaps: a plug
  // nobody chose is never "the part chosen".
  // The parts beside the rack are drawn (the kit's zero-u.js zeroUEntries), so the sheet says where each is, not that it is left out.
  const zeroU = zeroUEntries(rack, chassisOf);
  const notes = [...await faceNotesFor(rack, base, faces, chassisOf, {cables: false, zeroU: false}), ...zeroUNotes(rack, chassisOf)];
  if (cabled && facts.unchecked) notes.push(UNCHECKED_NOTE);
  const uOf = heightOf(chassisOf);
  // The cables' own notes wait for the drawing: they say which cables the sheet holds.
  const after = [], failed = [];
  const panes = await Promise.all(faces.map(view =>
    drawElevation({items, frame: rack.frame, view, ears: true, metal: true, paper: true,
                   laneGap: routed ? LANE_GAP : 0, zeroU, chassisOf})));

  const sheet = svgEl('svg', {xmlns: SVG_NS});
  const paper = svgEl('rect', {x: 0, y: 0, fill: PAPER});
  sheet.append(paper);
  const host = el('div', {'aria-hidden': 'true'});
  host.style.cssText = 'position:fixed;left:0;top:0;width:800px;visibility:hidden;pointer-events:none';
  document.body.append(host);
  try {
    host.append(sheet);
    if (cabled) for (const pane of panes) widenForCables(pane, routed);
    // Every pane has one width: drawElevation's own, plus the column when cabled.
    // Routed cables widen the gutters (the lane gap) and both sides; the width is the widened pane's own.
    // A part beside the rack widens both panes alike (elevation.js), so it is the pane's own width too.
    const faceW = cabled || zeroU.length ? Math.max(...panes.map(pane => boxOf(pane)[2])) : FACE_W;
    panes.forEach((pane, i) => {
      const x = M + i * (faceW + GAP);
      // The heading sits over the rack, not over the rear pane's column to its left.
      sheet.append(text(x + (cabled && (routed || faces[i] === 'rear') ? ROOM : 0), M + 16,
                        faces[i] === 'front' ? 'Front' : 'Rear', {size: 14, weight: 600}));
      pane.setAttribute('x', x.toFixed(2));
      pane.setAttribute('y', String(M + HEAD));
      pane.setAttribute('width', faceW.toFixed(2));
      pane.setAttribute('height', boxOf(pane)[3].toFixed(2));
      sheet.append(pane);
    });
    if (cabled) {
      for (const pane of panes) {
        try {
          if (probeFail.pane === pane.dataset.pane) throw new Error('probe: this pane cannot draw its cables');
          drawRackCables(pane, rack, reasons, uOf, rf);
        }
        catch (err) {
          // One face's cables failing must not cost the sheet: it comes without them, and says so.
          console.warn(`[portrayal] sheet: the ${pane.dataset.pane} face's cables`, err);
          pane.querySelectorAll(':scope > [data-cables], :scope > [data-in-front], :scope > [data-cable-tags]').forEach(n => n.remove());
          failed.push(pane.dataset.pane);
          after.push(`The cables could not be drawn on the ${pane.dataset.pane} face of this sheet; tags on the other face may point at runs that are not drawn.`);
        }
      }
      // A cable with no group on this sheet (a run, a lead or a tag) is said to be missing, and why.
      const drawn = new Set(panes.flatMap(pane => [...pane.querySelectorAll('[data-cable-id]')].map(n => n.getAttribute('data-cable-id'))));
      notes.push(...sheetCableNotes(rack, facts.ends, {faces, drawn, failed, uOf}), ...after, ...routeNotes(rack, rf, labelOf(rack)),
                 // a note per bundle and its warnings (portrayal-site#142); the bands and straps are drawn with the cables
                 ...sheetBundleNotes(rack, rf?.bundles));
      roomForCables(panes);
      for (const pane of panes) {
        pane.setAttribute('height', boxOf(pane)[3].toFixed(2));
        pane.removeAttribute('data-base-box');
        paperTags(pane);
      }
    }
    const all = uniq(notes);
    const faceH = cabled || zeroU.length ? boxOf(panes[0])[3] : rack.frame.heightRU * RU + 30;   // drawElevation's own viewBox height
    const width = M * 2 + faces.length * faceW + (faces.length - 1) * GAP;
    const chars = Math.floor((width - M * 2 - 24) / 6.2);   // 10 px mono runs about 6 px a character
    const noteLines = all.flatMap(n => wrapText(n, chars - 2).map((l, i) => (i ? `  ${l}` : `• ${l}`)));

    const blockY = M + HEAD + faceH + 24;
    const box = svgEl('rect', {x: M, y: blockY, width: (width - 2 * M).toFixed(2), fill: 'none', stroke: RULE});
    sheet.append(box);
    let y = blockY + 22;
    titleLines(rack, date, {source: SOURCE}).forEach((line, i) => {
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
    const stem = fileStem(rack.name);
    return {name: faces.length === 1 ? `${stem}-${faces[0]}.svg` : `${stem}-sheet.svg`,
            data: standalone(sheet), type: 'image/svg+xml', notes: all};
  } finally {
    host.remove();
  }
}

// DRAW.IO (spec §8, Phase 2b rulings 1 and 2): ONE page, a cabinet per face,
// and the cables as edges between port cells. Each cabinet holds what is
// mounted on that side and the far panel of whatever nothing mounted there
// covers (perFaceItems); a device hidden behind another is listed in the
// notes. Each face is the configured face that side shows (panelFor), drawn
// with the plugs its cables seat, so a seated card's ports are connection
// points carrying portrayal-path. The two cabinets are two racks of one group
// (export-data.js says why), and the second one's label is put right
// afterwards.
//
// A cable is handed to the vendor only when both its ends land and both have
// a port cell (export-data.js drawioCables); the rest are notes, written here
// in the page's words. Edge colors are cables.js's, by media, as on the page;
// the rest of an edge's style is export-data.js drawioCableStyle.
export async function drawioFile(rack, chassisOf) {
  const base = itemsWithU(rack, chassisOf);
  const {cabled, facts, items} = await cabledItems(rack, base);
  const H = rack.frame.heightRU;
  const lists = perFaceItems(items);
  const notes = await faceNotesFor(rack, base, ['front', 'rear'], chassisOf, {cables: false});
  for (const h of lists.hidden)
    notes.push(`${h.pane === 'front' ? 'Front' : 'Rear'} cabinet: ${h.item.label} is behind ${h.by.label} and is not drawn there.`);
  const numDisp = rack.frame.numbering === 'top-down' ? 'ascend' : 'descend';
  const suffix = rearSuffix(items);
  const label = htmlText(rack.name);
  // A cell id the vendor writes is a slug of the entry's id: two that slug alike get an alias (export-data.js).
  const entries = ['front', 'rear'].flatMap(pane => lists[pane].map(it => ({pane, it, id: drawioId(it.id, pane, suffix)})));
  const finals = uniqueEntryIds(entries), idFor = new Map(entries.map((e, i) => [`${e.it.id}|${e.pane}`, finals[i]]));
  const racks = [], ports = new Set();
  for (const pane of ['front', 'rear']) {
    const mounted = await Promise.all(lists[pane].map(async it => {
      const f = await faceOf(it, panelFor(it, pane));
      // The port cells this cabinet will hold, as the vendor picks them (cls 'port', by path).
      for (const p of f?.ports || []) if (p.cls === 'port') ports.add(`${it.id}|${pane}|${p.path || p.id}`);
      // Filed under 'front' in both cabinets: it is the group's one face key, not the side shown.
      return {id: idFor.get(`${it.id}|${pane}`), name: htmlText(it.label), u: drawioU(H, it.ru, it.u), ru: it.u,
              faces: f ? {front: {svg: f.text, vb: f.vb, ports: f.ports}} : {}};
    }));
    racks.push({label, units: H, numDisp, mounted});
  }
  const wires = drawioCables(rack, {ends: facts.ends, idOf: (id, pane) => idFor.get(`${id}|${pane}`) ?? drawioId(id, pane, suffix),
                                    drawn: (id, pane, path) => ports.has(`${id}|${pane}|${path}`),
                                    hiddenBy: (id, pane) => lists.hidden.find(h => h.item.id === id && h.pane === pane)?.by.label ?? null,
                                    unchecked: cabled && !!facts.unchecked, uOf: heightOf(chassisOf)});
  notes.push(...wires.notes);
  if (hasWaypoints(cabled ? await routesOf(rack, chassisOf) : null))
    notes.push('Cable routes are not drawn in draw.io; the cables run straight between their ports there.');
  // A cable's color is the page's own, by its media key; the style around it is export-data.js's.
  const colors = new Map();
  for (const c of rack.cables || [])
    if (drawioMediaKey(c)) colors.set(drawioMediaKey(c), colorOf({media: c.media || 'unset', purpose: c.purpose}));
  const cableStyle = c => drawioCableStyle(colors.get(c.media) ?? COLORS.unset);
  const all = uniq(notes);
  // rackDiagram writes the notes as a comment INSIDE <mxfile>: draw.io reads
  // its <diagram> children and skips a comment there. Names and labels are
  // HTML-escaped above because its label cells are html=1; the page's name is
  // an attribute, and a cable's label is plain text, which the vendor escapes.
  const xml = rackDiagram([{label: rack.name || 'Rack', faces: ['front'], racks}],
                          {labels: true, notes: all, cables: wires.cables, cableStyle});
  return {name: `${fileStem(rack.name)}.drawio`, data: rearNoDrawing(rearCabinetLabel(xml, label)), type: 'application/xml', notes: all};
}

// What the 3D model carries of the cables, as notes. `hung` is what the scene
// holds (scene3d.js: built.rackCables): drawCables3d's tubes, or {failed}.
// `facts` are the ones the scene was BUILT from when it kept them (scene3d.js
// hangCables), so the notes describe the model that is exported and never a
// later, different reading:
//   - nothing hung at all: the model has no cables, and says so;
//   - a loose end, a mismatch: as the sheet says them (cableNotes);
//   - an end the page calls connected that the scene could not place (no
//     drawing of that panel in 3D): the cable hangs loose there, and the
//     model says which end.
function modelCableNotes(rack, hung, facts, uOf) {
  if (!(rack.cables || []).length) return [];
  if (!hung || hung.failed) return ['The cables could not be drawn in the 3D model.'];
  // The SCENE's own reading decides what the model shows: built without it
  // (checked === false) it has no plugs and marks no loose end, so the notes
  // may not assert findings the model contradicts. They say it was unchecked.
  if (hung.checked === false) facts = UNCHECKED;
  // A cable the scene did not draw at all says so, as draw.io's notes do.
  const gone = new Set(hung.tubes.filter(t => !t.mesh).map(t => t.link.id));
  const out = [...(facts.unchecked ? [UNCHECKED_NOTE] : []),
               ...cableNotes(rack, facts.ends, {undrawn: c => gone.has(c.id), uOf})];
  const names = cableNames(rack);
  for (const t of hung.tubes) {
    const c = rack.cables.find(x => x.id === t.link.id);
    if (!c) continue;
    const lost = t.loose.map(k => (k === 'from' ? ['A', c.a] : ['B', c.b]))
      .filter(([, e]) => facts.ends.get(endKey(e))?.reason == null);
    if (lost.length)
      out.push(`Cable ${names.get(c.id)}: ${lost.map(([s, e]) => `end ${s}, ${endName(rack, e, uOf)},`).join(' and ')} `
        + `could not be placed in the 3D model, so the cable ${t.mesh ? 'hangs loose' : 'is not drawn'} there.`);
  }
  return out;
}

// GLB / USDZ (spec §8), from the scene the page built - after complete(), so
// the deferred relief pass (optics, plugs) has landed. The scene holds the
// rack's cables as tubes (group `patch-cables`, each `cable-<id>`), so both
// files carry them. The notes ride in the scene's userData, which
// GLTFExporter writes as the scene's `extras`. A USDZ has no such place, so
// its notes come back as `left`, not `notes`.
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
    // A device nobody drew, as the sheet says it (ru, face and turned are the
    // rack's own items'; the height its U is named by is the chassis's).
    const missing = [];
    for (const it of rack.items) {
      for (const pane of ['front', 'rear']) {
        const panel = panelFor(it, pane);
        if (!await faceOf(it, panel))
          missing.push(...faceNotes({label: it.label, u: uOfItem(rack.frame, it, chassisOf), pane, panel, face: null}));
      }
    }
    // The facts the scene hung its cables by, when it kept them; the export's
    // own reading only for a scene that has none (a stub, a failed hang).
    const facts = !(rack.cables || []).length ? UNCHECKED : scene.rackCables?.facts ?? await cableEnds(rack);
    // The scene stands the parts beside the rack (scene3d.js), so the model carries them.
    const notes = uniq([...besideNotes(rack, chassisOf), ...zeroUNotes(rack, chassisOf), ...mountNotes(rack.items, chassisOf, rack.frame),
                        ...threeDNotes(rack), ...missing, ...modelCableNotes(rack, scene.rackCables, facts, heightOf(chassisOf))]);
    scene.three.scene.userData.portrayal = {rack: rack.name, notes};
    const usdz = kind === 'usdz';
    return {name: `${fileStem(rack.name)}.${usdz ? 'usdz' : 'glb'}`,
            // never the hover's dimming (#169): the file is the rack, not the pointer;
            // nor a tight bend's warning ring (kit 0.17.0): that is the page's to show
            // nor the reader's setting for the covers (#190): every cover is in the file as it was built
            data: await holdUndimmed(scene, () => withoutBendRings(scene, () => withFileStraps(scene, STRAP_PAINT.light.core,
              () => withCoversAsBuilt(scene, () => (usdz ? scene.toUSDZ() : scene.toGLB()))))),
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
      notes.push(...seatNotes({label: it.label, u: uOfItem(rack.frame, it), face: f}));
      for (const p of seatedParts(f.text)) {
        if (seen.has(p.path)) continue;
        seen.add(p.path);
        parts.push({...p, itemId: it.id, label: it.label});
      }
    }
  }
  return {parts, notes: uniq(notes)};
}

// WHAT A RACK IS IN A DCIM: each item's device type (the matched file, its
// identity lines and its own name lists), and every seated part with its
// module type. The import kits carry the cables, so no note here says they
// are left out. Nothing that cannot be read fails the export:
//   - a type file costs that one type: the device or the part is then one with
//     no type, and a note says which file it was (and `why` says it for the
//     device);
//   - index.json unreadable: no device has a type, and `causes` says so;
//   - files.json or the component list unreadable: module types cannot be
//     looked up, so there are no modules, and `causes` says so.
// `causes` are sentences for the top of a kit's README list of what is left
// out; `why` is, per item id, the phrase that replaces "there is no device
// type for ..." in that device's own left-out line.
export async function dcimContext(rack, chassisOf, target) {
  const T = TARGET_NAME[target];
  // Each source on its own: one failing costs what it feeds, and is said (the probe can fail each).
  const source = async (key, what, read) => {
    try {
      if (probeFail[key]) throw new Error(`probe: ${what} cannot be read`);
      return {value: await read(), failed: false};
    } catch (err) {
      console.warn('[portrayal] export:', what, err);
      return {value: null, failed: true};
    }
  };
  const [idx, fls, cmp] = await Promise.all([
    source('index', 'the device type index', () => fetchJson(`${EXPORTS_BASE}index.json`)),
    source('files', 'the module type list', () => fetchJson(`${EXPORTS_BASE}files.json`)),
    source('components', 'the component list', () => components())]);
  const index = idx.value || {}, files = fls.value || {}, comps = cmp.value;
  const causes = [], why = new Map();
  if (idx.failed)
    causes.push(`The ${T} device type index (${EXPORTS_BASE}index.json) could not be read, so no device has a device type ` +
                'and every device is left out. Check that the site is reachable and export again.');
  // A part beside the rack is a device of the rack with no position and no face, as a
  // rack-face manager is: the kit's rows write one so, and word where it stands
  // in its comment (export-data.js zeroUImportItems and deviceImportRows). Its
  // type is upstream's, u_height 0 and not full depth.
  const rails = itemsWithU(rack, chassisOf);
  const items = [...rails, ...zeroUImportItems(rack, chassisOf).map(z => ({...z, face: 'front', turned: false, swaps: {}, fields: {}}))];
  // Where each part stands is its row's comment, not a note of the kit.
  const notes = [...besideNotes(rack, chassisOf), ...mountNotes(rails, chassisOf, rack.frame)];
  const types = new Map();
  const readType = path => (probeFail.type && path.includes(probeFail.type)
    ? Promise.reject(new Error('probe: this type file cannot be read')) : fetchText(exportUrl(path)));
  for (const it of items) {
    const manufacturer = chassisOf(it.ref)?.manufacturer;
    const m = matchDeviceType({cfg: it.cfg, manufacturer, paths: index[it.ref]?.[target] || []});
    if (!m) {
      types.set(it.id, null);
      if (idx.failed) why.set(it.id, 'the device type index could not be read');
      else notes.push(`${it.label} (${it.ref}): no ${T} device type.`);
      continue;
    }
    let text;
    try { text = await readType(m.path); }
    catch (err) {
      console.warn('[portrayal] export: a device type file', m.path, err);
      types.set(it.id, null);
      why.set(it.id, `its ${T} device type file, ${m.path}, could not be read`);
      notes.push(`${it.label} (${it.ref}): its ${T} device type, ${m.path}, couldn't be read, so it has none here.`);
      continue;
    }
    const head = yamlHead(text);
    // matchDeviceType falls back past the manufacturer filter when no file is in
    // the chassis's own folder; that shows as a file from another vendor's. The
    // folder, not the name: dirOf is the same rule matchDeviceType filtered by.
    const otherVendor = vendorOf(m.path) !== dirOf(manufacturer);
    // chassisManufacturer is the chassis catalog's value; `manufacturer` below is the YAML's.
    types.set(it.id, {...m, otherVendor, chassisManufacturer: manufacturer, manufacturer: head.manufacturer ?? '', model: head.model ?? '',
                      isFullDepth: head.isFullDepth, lists: typeLists(text)});
    if (otherVendor)
      notes.push(otherVendorNote({label: it.label, ref: it.ref, T, manufacturer, path: m.path}));
    else if (m.guess)
      notes.push(`${it.label} (${it.ref}, configuration ${it.cfg || 'default'}): ${stemOf(m.path)} is a best guess ` +
                 `among ${m.candidates} ${T} device types; none names this configuration.`);
  }
  const out = {items, types, modules: [], parts: [], notes, causes, why};
  {
    const {parts, notes: partNotes} = await seatedPartsOf(rack, items);
    notes.push(...partNotes);
    const users = new Map();
    for (const p of parts) users.set(p.ref, [...(users.get(p.ref) || []), p.label]);
    const noModules = fls.failed || cmp.failed;
    if (noModules && parts.some(p => p.path.endsWith('/module')))
      causes.push(`The ${T} module types could not be looked up (${[fls.failed && `${EXPORTS_BASE}files.json`, cmp.failed && 'the component list']
        .filter(Boolean).join(' and ')} could not be read), so no module is in the modules file and no cable to a card's port is in the cables file. ` +
        'Check that the site is reachable and export again.');
    for (const [ref, labels] of noModules ? [] : users) {
      const comp = findComp(comps, ref);
      const model = partNumber(comp);
      let path = moduleTypePath(files[target] || [], model), type = null;
      if (path) {
        // The module type's own identity and name lists: what a module row names, and what a card's port is called.
        try {
          const lists = typeLists(await readType(path));
          type = {manufacturer: lists.manufacturer ?? '', model: lists.model ?? '', lists};
        } catch (err) {
          console.warn('[portrayal] export: a module type file', path, err);
          notes.push(`${ref}${model ? ` (${model})` : ''}: its ${T} module type, ${path}, couldn't be read, so it has none here; seated in ${uniq(labels).join(', ')}.`);
          path = null;
        }
      } else notes.push(`${ref}${model ? ` (${model})` : ''}: no ${T} module type; seated in ${uniq(labels).join(', ')}.`);
      out.modules.push({ref, comp, model, path, type});
    }
    out.parts = parts;
  }
  out.notes = uniq(notes);
  return out;
}



// The console ports each cabled device's drawing has, by item id: a console
// port is named in a type file by its own list, not by its path (dcim-rules.js
// resolveEnd), and the drawing says which ports those are (data-role). Only
// devices with a cabled end are read. A panel with no drawing has none: its
// ends are loose already.
async function consolePorts(rack, items) {
  const cabled = new Set((rack.cables || []).flatMap(c => [c.a.item, c.b.item]));
  const out = new Map();
  for (const it of items) {
    if (!cabled.has(it.id)) continue;
    const paths = [];
    for (const view of ['front', 'rear']) {
      const f = await faceOf(it, view);
      if (!f) continue;
      const doc = new DOMParser().parseFromString(f.text, 'image/svg+xml');
      for (const n of doc.querySelectorAll('[data-class="port"][data-role="console"][data-path]'))
        paths.push(portPathOf(n.getAttribute('data-path')));
    }
    out.set(it.id, uniq(paths));
  }
  return out;
}

// The Nautobot kit's script: a real file of the site, fetched as any other.
const SCRIPT_URL = `site/rack/nautobot/${KIT_SCRIPT}`;
// Where the README says the script is: this page's own site, so a preview or a mirror points at itself. A page
// with no http(s) origin (file://) has none, and the README names portrayal.dev's copy instead: the kit names
// no site of its own (#895), so that fallback is this site's to keep.
const SCRIPT_FALLBACK = `https://portrayal.dev/${SCRIPT_URL}`;
const scriptHref = () => {
  try {
    const u = new URL(SCRIPT_URL, document.baseURI);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : SCRIPT_FALLBACK;
  } catch { return SCRIPT_FALLBACK; }
};

// THE IMPORT KIT (Phase 2c ruling 1): ONE zip per target, its files numbered
// in the order they are imported, with a README.txt that says what to do with
// each, what must already exist, and everything the kit could not carry.
//   NetBox:   types/…, 1-rack.csv, 2-devices.csv, 3-modules.csv, 4-cables.csv
//   Nautobot: types/…, 1-devices.csv, 2-modules.csv, 3-cables.csv and
//             import_cables.py, which creates the cables from that file
// Every CSV is written verbatim (no formula guard: an importer reads it
// literally) and is in the zip even with no rows. A device's name is
// uniqueNames' and its U is positionOf, the same in every file. A row the
// target would refuse is left out and listed in the README (dcim-rules.js,
// export-data.js deviceImportRows): NetBox takes a file whole or not at all.
// `files` is each file this builder writes, by name, for a caller that wants
// one without unzipping: the CSVs and the README. It does not hold the type
// files or import_cables.py, which are the site's own files copied into the
// zip. `notes` are the README's own, which is what the status counts.
export async function dcimKit(asStored, chassisOf, target, {date = new Date()} = {}) {
  // Every file is built from the rack as a kit names it: a line break or another control character in a
  // name is a space (dcim-rules.js kitNames), and the README says which names that changed.
  const {rack, notes: renamed} = kitNames(asStored);
  const nautobot = target === 'nautobot', F = KIT_FILES[nautobot ? 'nautobot' : 'netbox'];
  const ctx = await dcimContext(rack, chassisOf, target);
  const dcim = dcimOf(rack), enc = new TextEncoder();
  const entries = [], files = {}, left = [];
  const add = (name, text) => { files[name] = text; entries.push({name, bytes: enc.encode(text)}); };

  const paths = uniq([...ctx.types.values()].filter(Boolean).map(t => t.path)
    .concat(ctx.modules.map(m => m.path).filter(Boolean))).sort();
  let typeFiles = 0;
  for (const p of paths) {
    try { entries.push({name: `types/${p.split('/').slice(1).join('/')}`, bytes: enc.encode(await fetchText(exportUrl(p)))}); typeFiles++; }
    catch { left.push(`${p} couldn't be fetched, so it is not in this zip.`); }
  }
  const manufacturers = uniq([...[...ctx.types.values()].filter(Boolean).map(t => t.manufacturer),
                              ...ctx.modules.filter(m => m.type).map(m => m.type.manufacturer)].filter(Boolean)).sort();

  const names = uniqueNames(ctx.items);
  const dev = deviceImportRows({rack, items: ctx.items, types: ctx.types, target, dcim, why: ctx.why});
  const out = new Set(dev.left.map(l => l.id));
  const kept = new Set(ctx.items.filter(i => !out.has(i.id)).map(i => i.id));
  const deviceOf = id => ctx.types.get(id)?.lists ?? null;
  const moduleOf = ref => ctx.modules.find(m => m.ref === ref)?.type ?? null;
  const mod = moduleImportRows({target, parts: ctx.parts, names, kept, deviceOf, moduleOf});

  // The cabled ends, as the page reads them; with no cables nothing is read.
  const cabled = (rack.cables || []).length > 0;
  const facts = cabled ? await cableEnds(rack) : UNCHECKED;
  const consoles = cabled ? await consolePorts(rack, ctx.items) : new Map();
  const seated = new Map(ctx.parts.filter(p => p.path.endsWith('/module'))
    .map(p => [`${p.itemId}|${p.path.slice(0, -'/module'.length)}`, moduleOf(p.ref)?.lists ?? null]));
  const resolve = end => resolveEnd({path: portPathOf(end.path), device: deviceOf(end.item),
    consoles: consoles.get(end.item) || [], moduleAt: bay => seated.get(`${end.item}|${bay}`) ?? null});
  const cab = cableImportRows({rack, target, names, kept, resolve, ends: facts.ends,
                               unchecked: cabled && !!facts.unchecked, uOf: heightOf(chassisOf)});

  const rows = {devices: dev.rows.length, modules: mod.rows.length, cables: cab.rows.length};
  if (!nautobot) {
    const r = rackImportRows({rack, dcim});
    rows.rack = r.rows.length;
    add(F.rack, toCsv(r.columns, r.rows));
  }
  add(F.devices, toCsv(dev.columns, dev.rows));
  add(F.modules, toCsv(mod.columns, mod.rows));
  add(F.cables, toCsv(cab.columns, cab.rows));
  let script = false;
  if (nautobot) {
    // The script is a real file of the site (site/rack/nautobot/), fetched into
    // the zip. If it cannot be, the kit still comes, and says where the script is.
    try {
      if (probeFail.script) throw new Error('probe: the script cannot be fetched');
      entries.push({name: KIT_SCRIPT, bytes: enc.encode(await fetchText(SCRIPT_URL))});
      script = true;
    } catch (err) { console.warn(`[portrayal] export: ${KIT_SCRIPT}`, err); }
  }
  const notes = [...renamed, ...ctx.notes, ...cab.notes];
  if (!ctx.items.length) notes.unshift('This rack has no devices, so there is nothing to import.');
  const readme = kitReadme({target, rack, date, dcim, typeFiles, manufacturers, rows, script,
                            left: [...ctx.causes, ...left, ...dev.left.map(l => l.reason), ...mod.left, ...cab.left], notes: uniq(notes),
                            scriptUrl: scriptHref(), source: SOURCE, settingsAt: SETTINGS_AT});
  add('README.txt', readme.text);
  // The entries are dated with the export's DAY, the one the README prints: the same rack on the same day
  // gives the same bytes.
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return {name: `${fileStem(rack.name)}-${nautobot ? 'nautobot' : 'netbox'}-import.zip`, data: await makeZip(entries, day),
          type: 'application/zip', notes: readme.notes, files};
}

// THE BILL OF MATERIALS (spec §8): each device by configuration, each
// seated part by reference (as configured - defaults and swaps alike, read
// off the configured faces by the reader the DCIM exports use), and the
// mounting hardware, 4 x U per device, and the cables by media, length and
// connector. A spreadsheet opens this one, so its cells go through bomCell
// (formula guard); the DCIM CSVs stay verbatim.
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
  const railItems = items.filter(i => isRackMount(chassisOf(i.ref)));
  // A manager on a host shares the host's screws (spec D4); one on its own
  // bolts in with its own, like a 1U device.
  const managers = items.filter(i => i.mount === 'rack-face');
  const railUs = [...railItems.map(i => i.u), ...managers.filter(i => !i.on).map(() => 1)];
  const {parts, notes} = await seatedPartsOf(rack, items);
  // The BOM carries the cables, so it no longer says they are left out. Their
  // connectors come from the faces as the items' OWN swaps configure them:
  // a derived plug is never a part, and never a line here.
  const cabled = (rack.cables || []).length > 0;
  const facts = cabled ? await cableEnds(rack) : UNCHECKED;
  const sides = zeroUEntries(rack, chassisOf);
  notes.unshift(...besideNotes(rack, chassisOf), ...mountNotes(items, chassisOf, rack.frame),
                ...managerNotes(items, chassisOf, rack.frame), ...zeroUNotes(rack, chassisOf),
                ...sides.map(z => `${z.label} hangs on its own brackets beside the upright, as its maker ships them; no rail hardware is counted for it.`));
  for (const m of managers.filter(i => i.on)) {
    const h = items.find(i => i.id === m.on);
    if (h) notes.push(`${m.label} shares ${h.label}'s rail screws; with two ears stacked, longer screws may be needed.`);
  }
  if (cabled && facts.unchecked) notes.push('Cable ends could not be read, so the cable lines do not state their connectors.');
  // THE STRAPS (Portrayal #923): one hook-and-loop line, every bundle's straps
  // summed, and a note for a bundle whose straps cannot be counted.
  const rf = cabled ? await routesOf(rack, chassisOf) : null;
  // Without the routes the kit still reads the cable types (portrayal-site#164).
  const bundles = (rack.bundles || []).length ? (rf?.bundleRecords ?? bundleExports(rack, withCableTypes({}, await cableTypes()))) : [];
  if (cabled) notes.push(...cableBomNotes(rack, facts.ends), ...routeNotes(rack, rf, labelOf(rack)));
  notes.push(...strapBomNotes(bundles));
  if (!items.length && !sides.length) notes.push('This rack has no devices, so there is nothing to list.');
  if (filesFailed && parts.length) notes.push('Manufacturer names could not be loaded, so some are blank.');
  const devices = [...items, ...sides].map(it => ({ref: it.ref, cfg: it.cfg,
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
  if (railUs.length) notes.push(...hardwareNotes(rack.frame));   // no rail hardware, nothing to explain
  const all = uniq(notes);
  const rows = [...bomRows({devices, parts: lines, frame: rack.frame, railUs}),
                ...cableBomRows(rack, facts.ends), ...strapBomRows(bundles)];
  return {name: `${fileStem(rack.name)}-bom.csv`, data: toCsv(BOM_COLUMNS, rows, all, {cell: bomCell}),
          type: 'text/csv', notes: all};
}

// ── CABLES (spec §9.4) ──────────────────────────────────────────────────
// What each cabled end has on its panel, for an export: cable-plugs.js's own
// reading (memoized, so the page and every export share one). A panel that
// fails to load is already a loose end with a reason there. If the reading
// itself fails, the export still comes: no end is judged, and the file says
// so (export-data.js UNCHECKED_NOTE) rather than calling every end connected.
// Probe only (rack-page.js, ?probe=1 window.__rack.failExport): make the
// exports' own reading fail ({facts: true}), or one sheet pane's cables fail
// to draw ({pane: 'front'}), or a DCIM type file whose path holds a text fail
// to be read ({type: 'TM-280'}), or the Nautobot kit's script fail to be
// fetched ({script: true}), or a kit's sources fail ({index: true} the device
// type index, {files: true} the module type list, {components: true} the
// component list), to see each export without it. Anything that is
// not such an object - nothing, null - is "nothing fails": it never makes an
// export throw.
let probeFail = {};
export const failExport = what => { probeFail = what && typeof what === 'object' ? what : {}; };
export const cableEnds = rack => (probeFail.facts ? Promise.reject(new Error('probe: export cableFacts fails')) : cableFacts(rack)).catch(err => {
  console.warn("[portrayal] export: could not read the cables' faces", err);
  return UNCHECKED;
});

// THE CABLE SCHEDULE (spec §9.4): one row per cable. A spreadsheet opens it,
// so its cells go through bomCell, as the BOM's do. The notes the file
// carries are its notes section and each row's notes column.
export async function cableScheduleCsv(rack, chassisOf) {
  const facts = await cableEnds(rack);
  const rf = await routesOf(rack, chassisOf);
  // THE BUNDLES (Portrayal #923): each one's line, warnings and notes, from
  // the kit, measured with this render's routes, cable types and bend radii.
  // Without the routes the kit reads them unmeasured and says so.
  // THE BODIES A ROUTE STILL CROSSES (Portrayal #949, kit 0.11.0): each
  // finding's sentence goes in its own cable's notes, so the file's notes
  // leave them out rather than say each twice.
  const {columns, rows, notes} = cableScheduleRows(rack, facts.ends, itemsWithU(rack, chassisOf), rf?.routes,
                                                   {bundles: rf?.bundleRecords ?? null,
                                                    bodies: rf?.ctx ? bodyFindings(rack, rf.ctx, labelOf(rack)) : null});
  notes.push(...routeNotes(rack, rf, labelOf(rack), {bodies: false}));
  return {name: `${fileStem(rack.name)}-cables.csv`, data: toCsv(columns, rows, notes, {cell: bomCell}),
          type: 'text/csv', notes: [...notes, ...rows.map(r => r.notes).filter(Boolean)]};
}
