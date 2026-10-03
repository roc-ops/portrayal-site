// WHAT AN EXPORT SAYS, as data (spec §8). Pure: no DOM, no fetch - so
// `node --test` covers every rule an export follows: file names, CSV
// quoting, the title block, which cabinet draws which device, the notes,
// and (below, Tasks 4-5) DCIM matching and the bill of materials.
// site/rack/exports.js does the fetching and drawing, and asks here.

import {uLabel} from './model.js';

export const uniq = list => [...new Set(list)];

// One stem for every file a rack exports - the one its .json already uses.
export const fileStem = name =>
  String(name ?? '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-|-$/g, '') || 'rack';

const pad = n => String(n).padStart(2, '0');
export const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// RFC 4180: a cell with a comma, a quote, a line break or an edge space is
// quoted, its quotes doubled. Nothing else is touched - a part number that
// starts with "-" is a part number, not a formula to defuse. NetBox and
// Nautobot read this literally on import, so a guard prefix here would
// corrupt a name; the BOM's spreadsheet-safe variant is `bomCell`, below.
export const csvCell = v => {
  const s = v == null ? '' : String(v);
  return /[",\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export function toCsv(columns, rows, notes = [], {cell = csvCell} = {}) {
  const line = cells => cells.map(cell).join(',');
  const out = [line(columns), ...rows.map(r => line(columns.map(c => r[c])))];
  if (notes.length) out.push('', line(['Notes']), ...notes.map(n => line([n])));
  return `${out.join('\r\n')}\r\n`;
}

export function holesText(frame) {
  if (frame.holes?.style !== 'tapped') return 'Square holes (cage nuts)';
  return `Tapped holes, ${frame.holes.thread || 'thread not stated'}`;
}

// The sheet's title block (spec §8): rack name, frame, depths, holes, date.
export function titleLines(rack, date) {
  const f = rack.frame;
  const kind = f.kind === 'two-post' ? 'Two-post' : 'Four-post';
  const numbering = f.numbering === 'top-down' ? 'U1 at the top' : 'U1 at the bottom';
  const depth = f.kind === 'two-post'
    ? `Usable depth ${Math.round(f.usableDepth)} mm`
    : `Rail depth ${Math.round(f.railDepth)} mm · usable depth ${Math.round(f.usableDepth)} mm`;
  return [rack.name, `${kind} frame, ${f.heightRU}U, ${numbering}`, depth, holesText(f),
          `Drawn ${isoDate(date)} with the Portrayal Rack Builder`];
}

export function wrapText(text, width) {
  const lines = [];
  let cur = '';
  for (const w of String(text).split(/\s+/).filter(Boolean)) {
    if (cur && cur.length + 1 + w.length > width) { lines.push(cur); cur = w; }
    else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) lines.push(cur);
  return lines;
}

// Notes inside an XML file (draw.io). "--" may not appear in a comment.
export function xmlComment(notes) {
  if (!notes.length) return '';
  const body = notes.map(n => `- ${n}`).join('\n').replace(/-{2,}/g, '-');
  return `<!--\nNotes from the Portrayal Rack Builder:\n${body}\n-->`;
}

// What one pane could not show of one item. `u` is the U label as the frame
// numbers it; `panel` is the device's own panel facing `pane`.
export function faceNotes({label, u, pane, panel, face}) {
  const at = `${label} at U${u}`;
  if (!face) return [`${at}: no ${panel} drawing, so the ${pane} shows an outline.`];
  const {refused = [], failed = []} = face.seat || {};
  const out = [];
  if (refused.length)
    out.push(`${at}: ${refused.join(', ')} refused the part chosen and ${refused.length === 1 ? 'is' : 'are'} shown empty.`);
  if (failed.length)
    out.push(`${at}: the part chosen for ${failed.join(', ')} couldn't be loaded, so the drawing shows what the configuration seats there.`);
  return out;
}

const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
export function rackNotes(rack) {
  const out = [];
  const z = rack.zeroU?.length || 0, c = rack.cables?.length || 0;
  if (z) out.push(`${count(z, 'zero-U item is', 'zero-U items are')} not in this export yet.`);
  if (c) out.push(`${count(c, 'cable is', 'cables are')} not in this export yet.`);
  return out;
}

// createRackScene has no fields input yet (site/rack/scene3d.js).
export function threeDNotes(rack) {
  const withFields = rack.items.filter(i => Object.keys(i.fields || {}).length).map(i => i.label);
  return withFields.length ? [`Optic labels and colors are not in the 3D model yet: ${withFields.join(', ')}.`] : [];
}

// The U a DCIM calls a device's position: the lowest-numbered U it covers,
// counted the way this frame counts.
export const positionOf = (frame, ru, u) => Math.min(uLabel(frame, ru), uLabel(frame, ru + u - 1));

// draw.io's cabinet counts from 1 at the TOP, and its `u` is the device's top U.
export const drawioU = (heightRU, ru, u) => heightRU - (ru + u - 1) + 1;

const overlaps = (a, b) => a.ru <= b.ru + b.u - 1 && b.ru <= a.ru + a.u - 1;
// ONE CABINET PER FACE. What you see from a side is what is mounted there,
// plus the far panel of anything that nothing mounted on this side covers.
// Behind a mounted device, the other side's device is hidden - two pictures
// in one U of a draw.io cabinet overlap, and the 2D pane already draws the
// mounted one on top.
export function perFaceItems(items) {
  const out = {front: [], rear: [], hidden: []};
  for (const pane of ['front', 'rear']) {
    for (const it of items) {
      if (it.face === pane) { out[pane].push(it); continue; }
      const by = items.find(o => o.face === pane && overlaps(o, it));
      if (by) out.hidden.push({item: it, pane, by});
      else out[pane].push(it);
    }
  }
  return out;
}

// ── DCIM (spec §8) ─────────────────────────────────────────────────────
export const stemOf = path => String(path).split('/').pop().replace(/\.ya?ml$/i, '');
export const vendorOf = path => String(path).split('/').at(-2) ?? '';
export const tokens = s => String(s ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

// How a configuration's words are also spelled in vendor part numbers:
// Edgecore writes front-to-back airflow as -F, back-to-front as -B, and
// 48 V DC as 48V.
const ALIAS = {f2b: ['f'], b2f: ['b'], dc: ['48v']};
const runIn = (hay, needle) => needle.length > 0 && hay.some((_, i) =>
  i + needle.length <= hay.length && needle.every((t, k) => hay[i + k] === t));

// WHICH DEVICE TYPE IS THIS ITEM. index.json lists every type a device ref
// exports - one per SKU, often one per configuration - and nothing names
// which configuration each is. So: the chassis manufacturer's own files
// first; one file is certain; a file whose name carries the configuration's
// words as a run is certain when it is the only one; otherwise the best
// match on words and aliases is a GUESS, and the caller lists it in notes.
export function matchDeviceType({cfg, manufacturer, paths}) {
  if (!paths?.length) return null;
  const own = paths.filter(p => vendorOf(p) === manufacturer);
  // No file of the chassis's own manufacturer: the match falls back to every
  // file, so whatever wins is still someone else's part - a guess even when
  // it is the only file, or the only one naming the configuration.
  const fallback = !own.length;
  const pool = fallback ? [...paths] : own;
  if (pool.length === 1) return {path: pool[0], guess: fallback, candidates: 1};
  const want = tokens(cfg);
  const exact = pool.filter(p => runIn(tokens(stemOf(p)), want));
  if (exact.length) {
    const best = [...exact].sort((a, b) => tokens(stemOf(a)).length - tokens(stemOf(b)).length)[0];
    return {path: best, guess: fallback || exact.length > 1, candidates: pool.length};
  }
  const wanted = want.flatMap(t => [t, ...(ALIAS[t] || [])]);
  let best = pool[0], score = -1;
  for (const p of pool) {
    const have = new Set(tokens(stemOf(p)));
    const s = wanted.filter(t => have.has(t)).length;
    if (s > score) { best = p; score = s; }
  }
  return {path: best, guess: true, candidates: pool.length};
}

// The identity lines at the top of a device-type YAML - enough for a CSV to
// name the type exactly as the YAML does. Top level only: an indented
// `model:` belongs to a component, not the type.
export function yamlHead(text) {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.match(/^(manufacturer|model|slug|u_height|is_full_depth):\s*(.*?)\s*$/);
    if (!m || m[1] in out) continue;
    let v = m[2];
    if (/^'.*'$/.test(v)) v = v.slice(1, -1).replace(/''/g, "'");
    else if (/^".*"$/.test(v)) v = JSON.parse(v);
    out[m[1]] = v;
  }
  return {manufacturer: out.manufacturer ?? null, model: out.model ?? null, slug: out.slug ?? null,
          uHeight: out.u_height != null ? Number(out.u_height) : null,
          isFullDepth: out.is_full_depth === 'true'};
}

// A module type's file is named for the part number (attrs.model), a "/"
// in it written "-" (exporter.html reads it the same way).
export function moduleTypePath(paths, model) {
  if (!model) return null;
  const want = [model, model.replace(/\//g, '-')];
  return paths.find(p => p.includes('/module-types/') && want.includes(stemOf(p))) ?? null;
}
export const partNumber = comp => comp?.attrs?.model ?? comp?.attrs?.part ?? comp?.attrs?.['part-number']
  ?? comp?.attrs?.['vendor-sku'] ?? '';

// A DCIM wants unique device names; two items may share a label.
export function uniqueNames(items) {
  const base = i => String(i.label || i.ref).trim();
  const seen = new Map();
  for (const i of items) seen.set(base(i), (seen.get(base(i)) || 0) + 1);
  return new Map(items.map(i => [i.id, seen.get(base(i)) > 1
    ? {name: `${base(i)}-${i.id}`, renamed: true} : {name: base(i), renamed: false}]));
}

export const NETBOX_COLUMNS = ['name', 'role', 'manufacturer', 'device_type', 'status', 'site', 'rack',
  'position', 'face', 'comments'];
export const NAUTOBOT_COLUMNS = ['name', 'role__name', 'device_type__manufacturer__name', 'device_type__model',
  'status__name', 'location__name', 'rack__name', 'position', 'face', 'comments'];
export const TARGET_NAME = {netbox: 'NetBox', nautobot: 'Nautobot'};

// The one wording for "this type is another vendor's file", shared by
// NOTES.txt and the device CSV's comments column.
export const otherVendorNote = ({label, ref, T, manufacturer, path}) =>
  `${label} (${ref}): no ${T} device type from ${manufacturer || 'its manufacturer'}, so ` +
  `${stemOf(path)} is another vendor's (${vendorOf(path)}) file, a best guess.`;

// One row per rail item, top down. Role and site/location are left blank on
// purpose: both are required, and this rack knows neither - a blank one
// fails the import loudly instead of filing devices under a guess.
export function deviceImportRows({rack, items, types, target = 'netbox'}) {
  const T = TARGET_NAME[target] || 'NetBox';
  const names = uniqueNames(items);
  // Top down by the U a device's TOP occupies, not where it starts (ru is
  // its bottom): a tall device reaches higher than its ru alone would say.
  const topU = it => it.ru + it.u - 1;
  const sorted = [...items].sort((a, b) => topU(b) - topU(a) || (a.face === b.face ? 0 : a.face === 'front' ? -1 : 1));
  const rows = sorted.map(it => {
    const t = types.get(it.id) || null;
    const n = names.get(it.id);
    const notes = [];
    if (!t) notes.push(`No ${T} device type for ${it.ref} (${it.cfg}); add one before importing.`);
    else if (t.otherVendor)
      notes.push(otherVendorNote({label: it.label, ref: it.ref, T, manufacturer: t.chassisManufacturer, path: t.path}));
    else if (t.guess) notes.push(`Device type ${t.model} is a best guess for configuration ${it.cfg}.`);
    if (n.renamed) notes.push(`Named ${n.name} because another device here is also ${String(it.label || it.ref).trim()}.`);
    if (it.turned) notes.push('Mounted turned: its rear panel faces out.');
    const others = items.filter(o => o.id !== it.id && o.face !== it.face && overlaps(o, it));
    if (others.length && (t?.isFullDepth || others.some(o => types.get(o.id)?.isFullDepth))) {
      const named = others.map(o => names.get(o.id).name);
      const list = named.length > 1 ? `${named.slice(0, -1).join(', ')} and ${named.at(-1)}` : named[0];
      notes.push(`Shares its U with ${list} on the ${others[0].face}; ${T} refuses this while either type is full depth.`);
    }
    const position = positionOf(rack.frame, it.ru, it.u);
    const comments = notes.join(' ');
    return target === 'nautobot'
      ? {name: n.name, role__name: '', device_type__manufacturer__name: t?.manufacturer ?? '',
         device_type__model: t?.model ?? '', status__name: 'Planned', location__name: '',
         rack__name: rack.name, position, face: it.face, comments}
      : {name: n.name, role: '', manufacturer: t?.manufacturer ?? '', device_type: t?.model ?? '',
         status: 'planned', site: '', rack: rack.name, position, face: it.face, comments};
  });
  return {columns: target === 'nautobot' ? NAUTOBOT_COLUMNS : NETBOX_COLUMNS, rows};
}

export function dcimNotesText({rackName, target, date, notes}) {
  const T = TARGET_NAME[target] || 'NetBox';
  const body = notes.length ? notes.map(n => `- ${n}`).join('\n')
    : `Every device and part in this rack matched a ${T} type.`;
  return `${T} types for ${rackName}, from the Portrayal Rack Builder, ${isoDate(date)}.\n\n${body}\n`;
}

// ── THE BILL OF MATERIALS (spec §8) ─────────────────────────────────────
// A part counts when it is SEATED: a bay's module (`…/module`) or a cage's
// occupant (`…-occupant` - an optic, a cap, a plug). Everything else in a
// face that carries data-ref is the chassis itself (a door, a jack, every
// port shape) and is already the device's line.
export const isSeatedPath = path => /\/module$|-occupant$/.test(String(path));

export const SECTIONS = [
  ['device', 'Devices'], ['supervisor', 'Supervisors'], ['line-card', 'Line cards'], ['fabric', 'Fabric cards'],
  ['expansion-card', 'Expansion cards'], ['nic', 'Network cards'], ['riser', 'Risers'], ['drive', 'Drives'],
  ['psu', 'Power supplies'], ['fan', 'Fans'], ['filter', 'Filters'], ['cassette', 'Cassettes'],
  ['adapter-panel', 'Adapter panels'], ['blank', 'Blanks'], ['transceiver', 'Optics'], ['port', 'Plugs'],
  ['cap', 'Dust caps'], ['other', 'Other parts'], ['hardware', 'Mounting hardware']];
const SECTION = new Map(SECTIONS);
export const sectionOf = cls => SECTION.get(cls) ?? 'Other parts';
const sectionOrder = label => SECTIONS.findIndex(([, l]) => l === label);

export const firstSentence = text => String(text ?? '').split(/(?<=\.)\s/)[0];
const titled = ns => ns.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
export function partManufacturer(comp, path) {
  if (path) return vendorOf(path);
  if (!comp || ['generic', 'std', 'common'].includes(comp.ns)) return '';
  return titled(comp.ns);
}

export const BOM_COLUMNS = ['section', 'qty', 'manufacturer', 'model', 'description', 'ref'];

// The BOM is meant to open in a spreadsheet, unlike the device-import CSVs
// (an importer reads those literally). A cell that OPENS as a formula -
// starts with =, +, - or @ - gets a leading apostrophe first, so the
// spreadsheet keeps it as text; csvCell then quotes it as any such text needs.
const FORMULA_START = /^[=+\-@]/;
export const bomCell = v => csvCell(FORMULA_START.test(String(v ?? '')) ? `'${v}` : v);

export function bomRows({devices = [], parts = [], frame, railUs = []}) {
  const lines = new Map();
  const add = (key, row) => { const l = lines.get(key); if (l) l.qty++; else lines.set(key, {...row, qty: 1}); };
  for (const d of devices)
    add(`device|${d.ref}|${d.cfg}`, {section: 'Devices', manufacturer: d.manufacturer ?? '', model: d.model ?? d.ref,
      description: d.cfg ? `Configuration ${d.cfg}` : '', ref: d.ref});
  for (const p of parts)
    add(`part|${p.ref}`, {section: sectionOf(p.cls), manufacturer: p.manufacturer ?? '', model: p.model || p.ref,
      description: p.description ?? '', ref: p.ref});
  const rows = [...lines.values()].sort((a, b) => sectionOrder(a.section) - sectionOrder(b.section)
    || String(a.model).localeCompare(String(b.model)) || String(a.ref).localeCompare(String(b.ref)));
  return [...rows, ...hardwareRows(frame, railUs)];
}

// 2 ears x 2 screws x each U a rail item covers (Task 2 draws the same).
export function hardwareRows(frame, railUs) {
  const qty = 4 * railUs.reduce((s, u) => s + Math.max(1, u), 0);
  if (!qty) return [];
  const row = model => ({section: 'Mounting hardware', qty, manufacturer: '', model,
    description: 'Two per ear for each U a device covers', ref: ''});
  if (frame.holes?.style === 'tapped') return [row(`Screw, ${frame.holes.thread || 'thread not stated'}`)];
  return [row('Cage nut, M6'), row('Screw, M6')];
}
export function hardwareNotes(frame) {
  if (frame.holes?.style !== 'tapped')
    return ["Cage nuts and screws are counted as M6, the usual size for square-hole rails; check your rack's own."];
  return frame.holes.thread ? [] : ['The rail thread is not set under Frame, so the screws are listed without one.'];
}
