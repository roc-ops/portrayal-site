// WHAT AN EXPORT SAYS, as data (spec §8). Pure: no DOM, no fetch - so
// `node --test` covers every rule an export follows: file names, CSV
// quoting, the title block, which cabinet draws which device, the notes,
// and (below, Tasks 4-5) DCIM matching and the bill of materials.
// site/rack/exports.js does the fetching and drawing, and asks here.

import {uLabel} from './model.js';
import {endKey, endName, cableName, mismatch, lengthText, MEDIA_LABELS} from './cable-rules.js';

export const uniq = list => [...new Set(list)];

// One stem for every file a rack exports - the one its .json already uses.
// Never a dotfile ("." and ".." are names a rack can have), never longer
// than 80 characters, and never a name Windows keeps for a device: CON.drawio
// cannot be opened there, whatever its extension.
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const trimEdges = s => s.replace(/^[.-]+|[.-]+$/g, '');
export function fileStem(name) {
  const stem = trimEdges(trimEdges(String(name ?? '').replace(/[^A-Za-z0-9._-]+/g, '-')).slice(0, 80));
  if (!stem) return 'rack';
  return RESERVED.test(stem.split('.')[0]) ? `rack-${stem}` : stem;
}

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

// draw.io reads a label cell as HTML (vendor/drawio.js writes html=1 and
// escapes for XML only), so text handed to it is escaped for HTML first:
// "R&D <core>" then shows as typed instead of losing its tag.
export const htmlText = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// A swap the face did not take, said two ways: `drawn` for a file that shows
// the face (the sheet, draw.io), `listed` for one that lists its parts (the
// BOM, the DCIM types). A refused bay is left empty; a part that could not be
// loaded leaves the configuration's own part in place.
const SEAT_TAIL = {
  drawn: {refused: n => `${n === 1 ? 'is' : 'are'} shown empty.`,
          failed: 'so the drawing shows what the configuration seats there.'},
  listed: {refused: n => `${n === 1 ? 'is' : 'are'} empty, so no part is listed there.`,
           failed: 'so the part the configuration seats there is listed instead.'}};
function seatNotesAs(tail, {label, u, face}) {
  const at = `${label} at U${u}`;
  const {refused = [], failed = []} = face?.seat || {};
  const out = [];
  if (refused.length)
    out.push(`${at}: ${refused.join(', ')} refused the part chosen and ${tail.refused(refused.length)}`);
  if (failed.length)
    out.push(`${at}: the part chosen for ${failed.join(', ')} couldn't be loaded, ${tail.failed}`);
  return out;
}
export const seatNotes = arg => seatNotesAs(SEAT_TAIL.listed, arg);

// What one pane could not show of one item. `u` is the U label as the frame
// numbers it; `panel` is the device's own panel facing `pane`.
export function faceNotes({label, u, pane, panel, face}) {
  if (!face) return [`${label} at U${u}: no ${panel} drawing, so the ${pane} shows an outline.`];
  return seatNotesAs(SEAT_TAIL.drawn, {label, u, face});
}

const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// THE STATUS LINE after a download. `notes` are the ones the file carries;
// `left` are the ones it has no place for (a USDZ has none at all, a device
// CSV has only its rows' comments), said rather than counted as "in the file".
export function exportStatus({notes = [], left = [], leftText = ''} = {}) {
  const head = notes.length ? `Downloaded, with ${count(notes.length, 'note', 'notes')} in the file.` : 'Downloaded.';
  return left.length ? `${head} ${leftText || `Not in the file: ${left.join(' ')}`}` : head;
}
// What a rack holds that an export leaves out. An export that carries the
// cables (the sheet, draw.io, the 3D model, the BOM, the cable schedule)
// passes {cables: false}; one that does not (the DCIM types and the device
// import) keeps the line.
export function rackNotes(rack, {cables = true} = {}) {
  const out = [];
  const z = rack.zeroU?.length || 0, c = rack.cables?.length || 0;
  if (z) out.push(`${count(z, 'zero-U item is', 'zero-U items are')} not in this export yet.`);
  if (cables && c) out.push(`${count(c, 'cable is', 'cables are')} not in this export yet.`);
  return out;
}

// ── CABLES IN THE EXPORTS (spec §9.4) ───────────────────────────────────
// Every export that carries cables reads them through these, so a loose end
// or a mismatch is worded once. `ends` is cable-plugs.js cableFacts(rack).ends:
// Map(endKey -> {info, reason}), reason null when the end lands. A cable
// whose ends are not in the map was not checked (reading the faces failed).
export const UNCHECKED_NOTE = 'Cable ends could not be checked, so loose ends are not marked.';
export function cableFindings(rack, ends = new Map()) {
  return (rack.cables || []).map(cable => {
    const got = s => ends.get(endKey(cable[s]));
    const loose = [['A', 'a'], ['B', 'b']].filter(([, s]) => got(s)?.reason != null)
      .map(([side, s]) => ({side, end: cable[s], reason: got(s).reason}));
    return {cable, name: cableName(cable), loose, checked: !!got('a') && !!got('b'),
            warnings: mismatch(cable.media, got('a')?.info, got('b')?.info)};
  });
}
// The notes a drawn export carries: each loose end with its reason, each
// media mismatch. `undrawn` is for a file that leaves a cable with a loose
// end out altogether (draw.io) where the others draw its unplugged lead.
export function cableNotes(rack, ends = new Map(), {undrawn = false} = {}) {
  const out = [];
  for (const f of cableFindings(rack, ends)) {
    if (f.loose.length) {
      const why = f.loose.map(l => `end ${l.side}, ${endName(rack, l.end)}, is not connected (${l.reason})`);
      out.push(`Cable ${f.name}${undrawn ? ' is not drawn' : ''}: ${why.join('; ')}.`);
    }
    for (const w of f.warnings) out.push(`Cable ${f.name}: ${w}`);
  }
  return out;
}

// Own keys only: a hand-edited media named like something every object has
// (toString) is its own name, not a label.
const mediaLabel = m => (Object.hasOwn(MEDIA_LABELS, m) ? MEDIA_LABELS[m] : String(m ?? ''));
const asWritten = v => (typeof v === 'string' ? v : JSON.stringify(v));

// THE CABLE SCHEDULE: one row per cable, in the rack's own order. A device is
// named as the device import names it (uniqueNames over the same items), so
// the two files agree. A length the page could not use (model.js
// lengthAsWritten) is quoted in the notes, never put in the numeric column.
export const CABLE_COLUMNS = ['cable', 'a_device', 'a_u', 'a_port', 'b_device', 'b_u', 'b_port', 'media', 'purpose',
  'length', 'length_unit', 'status', 'notes'];
export function cableScheduleRows(rack, ends = new Map()) {
  const names = uniqueNames(rack.items);
  const byId = new Map(rack.items.map(i => [i.id, i]));
  const named = new Set();
  const side = e => {
    const it = byId.get(e.item);
    if (!it) return ['', '', e.path];
    if (names.get(it.id).renamed) named.add(names.get(it.id).name);
    return [names.get(it.id).name, uLabel(rack.frame, it.ru), e.path];
  };
  const findings = cableFindings(rack, ends);
  const rows = findings.map(f => {
    const c = f.cable, [aDev, aU, aPort] = side(c.a), [bDev, bU, bPort] = side(c.b);
    const notes = [...f.loose.map(l => `End ${l.side} is not connected: ${l.reason}.`), ...f.warnings];
    if (c.lengthAsWritten != null) notes.push(`Length as written in the file: ${asWritten(c.lengthAsWritten)}.`);
    return {cable: f.name, a_device: aDev, a_u: aU, a_port: aPort, b_device: bDev, b_u: bU, b_port: bPort,
            media: mediaLabel(c.media), purpose: c.purpose, length: c.length ? c.length.value : '',
            length_unit: c.length ? c.length.unit : '',
            status: !f.checked ? 'not checked' : f.loose.length ? 'loose end' : 'connected', notes: notes.join(' ')};
  });
  const notes = [];
  if (!rows.length) notes.push('This rack has no cables, so there is nothing to list.');
  if (findings.some(f => !f.checked)) notes.push(UNCHECKED_NOTE);
  if (named.size) notes.push(`Devices that share a label are named as the device import names them: ${[...named].join(', ')}.`);
  return {columns: CABLE_COLUMNS, rows, notes};
}

// NOT RACK-MOUNT. The chassis index states `mount` only when it is not
// "rack"; such a device stays placeable, and everything says what it needs.
// ONE table, so the picker and the notes cannot word it differently.
export const isRackMount = chassis => !chassis?.mount || chassis.mount === 'rack';
const MOUNTS = {
  'din-rail': {tag: 'DIN rail', what: 'a DIN-rail device', where: 'a shelf or DIN-rail bracket'},
  desktop: {tag: 'desktop', what: 'a desktop device', where: 'a shelf'},
  wall: {tag: 'wall mount', what: 'a wall-mount device', where: 'a shelf or bracket'}};
const mountOf = mount => isRackMount({mount}) ? null
  : MOUNTS[mount] ?? {tag: mount, what: `not a rack-mount device (${mount})`, where: 'a shelf or bracket'};
export const mountText = mount => { const m = mountOf(mount); return m && `${m.what}, so it needs ${m.where}`; };
// The picker's words: the list row's tag and the fit line.
export function mountPick(mount) {
  const m = mountOf(mount);
  return m && {tag: m.tag, fit: `Fits here, on ${m.where}: this is ${m.what}.`};
}
export function mountNotes(items, chassisOf, frame) {
  const out = [];
  for (const it of items) {
    const t = mountText(chassisOf(it.ref)?.mount);
    if (t) out.push(`${it.label} at U${frame ? uLabel(frame, it.ru) : it.ru}: ${t}.`);
  }
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

// DRAW.IO, ONE PAGE (Phase 2b ruling 1). Both cabinets stand on one page so
// a front-to-rear cable is one edge, not two stubs on two tabs. vendor/drawio.js
// lays the racks of ONE group side by side, each drawn once per face the group
// names; so the group names one face, 'front', and holds two racks: rack 0 is
// what the front pane shows, rack 1 what the rear pane shows. 'front' is only
// the key each mounted entry's drawing is filed under.
//
// The vendor finds a cable's port by the mounted entry's id, and an item is
// in both cabinets, so the rear cabinet's entries get the id plus a suffix.
// The suffix is one no item id ends with: a rear id then never equals an item
// id, and two items never share one.
export function rearSuffix(items) {
  let s = '@rear';
  while (items.some(i => String(i.id).endsWith(s))) s += '@';
  return s;
}
export const drawioId = (id, pane, suffix) => (pane === 'rear' ? `${id}${suffix}` : String(id));

// The vendor labels every cabinet "<rack label> · <face key>", so both read
// "· front". The second cabinet's value is put right by ONE exact replace on
// its own cell (id g0r1-front), escaped as the vendor's cell() writes it. If
// that cell is not there the file is wrong, and this throws: the export fails
// where it can be seen, and never ships two "front" cabinets.
const xmlAttr = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export function rearCabinetLabel(xml, label) {
  const cellOf = face => `id="g0r1-front" value="${xmlAttr(label ? `${label} · ${face}` : face)}"`;
  const was = cellOf('front');
  // Past the notes comment: inside a <diagram> every attribute value is escaped, so this text is the cell's own.
  const at = xml.indexOf(was, Math.max(0, xml.indexOf('<diagram')));
  if (at < 0) throw new Error("draw.io: the rear cabinet's label cell was not found");
  return xml.slice(0, at) + cellOf('rear') + xml.slice(at + was.length);
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

// A DCIM wants unique device names; two items may share a label. A repeated
// label gets the item's id - and a counter after it for as long as that name
// is some other item's own label, or one already generated here.
export function uniqueNames(items) {
  const base = i => String(i.label || i.ref).trim();
  const seen = new Map();
  for (const i of items) seen.set(base(i), (seen.get(base(i)) || 0) + 1);
  const taken = new Set(seen.keys());
  return new Map(items.map(i => {
    if (seen.get(base(i)) === 1) return [i.id, {name: base(i), renamed: false}];
    let name = `${base(i)}-${i.id}`;
    for (let k = 2; taken.has(name); k++) name = `${base(i)}-${i.id}-${k}`;
    taken.add(name);
    return [i.id, {name, renamed: true}];
  }));
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
    if (!t) notes.push(`No ${T} device type for ${it.ref}${it.cfg ? ` (${it.cfg})` : ''}; add one before importing.`);
    else if (t.otherVendor)
      notes.push(otherVendorNote({label: it.label, ref: it.ref, T, manufacturer: t.chassisManufacturer, path: t.path}));
    else if (t.guess) notes.push(`Device type ${t.model} is a best guess for configuration ${it.cfg}.`);
    if (n.renamed) notes.push(`Named ${n.name} because another device here is also ${String(it.label || it.ref).trim()}.`);
    const mt = mountText(it.mount);
    if (mt) notes.push(`${mt[0].toUpperCase()}${mt.slice(1)}.`);
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

// `devices` is how many the rack has: with none, nothing matched anything.
export function dcimNotesText({rackName, target, date, notes, devices}) {
  const T = TARGET_NAME[target] || 'NetBox';
  const list = notes.map(n => `- ${n}`);
  const body = (devices === 0 ? [`This rack has no devices, so there are no ${T} types in this zip.`, ...list]
    : list.length ? list : [`Every device and part in this rack matched a ${T} type.`]).join('\n');
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
// starts with =, +, - or @, or with the tab or carriage return a spreadsheet
// skips on its way to one - gets a leading apostrophe first, so the
// spreadsheet keeps it as text; csvCell then quotes it as any such text needs.
const FORMULA_START = /^[=+\-@\t\r]/;
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

// CABLES IN THE BOM (spec §8): one line per media, length and connector, with
// a quantity. A cable with no length - or one whose length the page could not
// use - is "length not set". The connector is what each end's port takes, as
// cable-plugs.js read it (`ends`, as for cableFindings); the two ends are
// said in one order, so A-to-B and B-to-A are one line. The plugs a cable is
// drawn with are part of the cable: they are never lines of their own.
const FAMILY = {fiber: 'fiber', copper: 'copper', dac: 'DAC', aoc: 'AOC'};
const familyOf = info => (info && Object.hasOwn(FAMILY, info.family ?? '') ? FAMILY[info.family] : null);
function connectorText(a, b) {
  const known = [familyOf(a), familyOf(b)].filter(Boolean).sort();
  if (known.length === 2) return known[0] === known[1] ? `${known[0]} at both ends` : `${known[0]} at one end, ${known[1]} at the other`;
  return known.length ? `${known[0]} at one end` : '';
}
export function cableBomRows(rack, ends = new Map()) {
  const lines = new Map();
  for (const c of rack.cables || []) {
    const info = s => ends.get(endKey(c[s]))?.info;
    const length = lengthText(c.length) || 'length not set';
    const connector = connectorText(info('a'), info('b'));
    const key = JSON.stringify([c.media, length, connector]);
    const l = lines.get(key);
    if (l) l.qty++;
    else lines.set(key, {section: 'Cables', qty: 1, manufacturer: '', model: mediaLabel(c.media) || 'Media not set',
                         description: [length, connector].filter(Boolean).join('; '), ref: ''});
  }
  return [...lines.values()].sort((a, b) => a.model.localeCompare(b.model) || a.description.localeCompare(b.description));
}
