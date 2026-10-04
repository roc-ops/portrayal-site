// WHAT A DCIM IMPORT KIT SAYS, as data (spec §8, §9.4; Phase 2c). Pure: no DOM,
// no fetch, so `node --test` covers every rule the NetBox and Nautobot kits
// follow: what a port is called in a type file, which rows a file may hold,
// and what the README says of the rest. site/rack/exports.js fetches the type
// files and the faces, and asks here.

import {endName, lengthParts} from './cable-rules.js';
import {cableFindings, TARGET_NAME} from './export-data.js';

// ── a type file's own names ─────────────────────────────────────────────
// The sections of a device-type or module-type YAML that hold cable ends, in
// the order a name is looked up, with the type a DCIM gives an end found there.
export const SECTIONS = [
  ['interfaces', 'dcim.interface'], ['front-ports', 'dcim.frontport'], ['rear-ports', 'dcim.rearport'],
  ['console-ports', 'dcim.consoleport'], ['console-server-ports', 'dcim.consoleserverport'],
  ['power-ports', 'dcim.powerport'], ['power-outlets', 'dcim.poweroutlet']];

const unquote = v => (/^'.*'$/.test(v) ? v.slice(1, -1).replace(/''/g, "'") : /^".*"$/.test(v) ? JSON.parse(v) : v);

// THE NAME LISTS OF ONE TYPE FILE, read as text: the exporter writes every
// component as "  - name: X" under a top-level "section:" line, with its other
// fields indented beneath, so no YAML library is needed (the site has none).
// `sections` holds each known section's names in file order; `bays` each
// module bay's name and position; `model` and `manufacturer` the identity
// lines, as the file writes them.
export function typeLists(text) {
  const sections = Object.fromEntries(SECTIONS.map(([s]) => [s, []]));
  const bays = [], head = {};
  let section = null, bay = null;
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const top = line.match(/^([A-Za-z_][\w-]*):\s*(.*?)\s*$/);
    if (top) {
      section = top[2] === '' ? top[1] : null;
      bay = null;
      if ((top[1] === 'manufacturer' || top[1] === 'model') && !(top[1] in head)) head[top[1]] = unquote(top[2]);
      continue;
    }
    if (!section) continue;
    const item = line.match(/^  - name:\s*(.*?)\s*$/);
    if (item) {
      const name = unquote(item[1]);
      bay = null;
      if (section === 'module-bays') { bay = {name, position: ''}; bays.push(bay); }
      else if (Object.hasOwn(sections, section)) sections[section].push(name);
      continue;
    }
    const pos = bay && line.match(/^    position:\s*(.*?)\s*$/);
    if (pos) bay.position = unquote(pos[1]);
  }
  return {manufacturer: head.manufacturer ?? null, model: head.model ?? null, sections, bays};
}

// A name's section and end type in one type file, first section first.
function findName(lists, name) {
  for (const [section, type] of SECTIONS) if (lists.sections[section].includes(name)) return {section, type};
  return null;
}
// The module bay a drawing's bay id is: the one whose POSITION is that id. A
// bay's name is for display ("Fan 1", "Front 0"); its position is what a
// DCIM puts in place of {module}.
export const bayAt = (lists, position) => lists?.bays.find(b => b.position === position) ?? null;

const MODULE = '/module/';
// WHAT A CABLE END IS CALLED IN THE DCIM, and which kind of component it is.
// Never built by convention alone: the name must be in the matched type
// file's own lists, and the list it is in gives the type.
//   path      the end's port path on the drawing ("port-1", "slot-2/module/p0")
//   device    typeLists of the item's device type, or null when it has none
//   moduleAt  bay id -> typeLists of the module type seated there, or null
//   consoles  the paths of the console ports the device's drawing has
// Returns {ok: true, name, type}, or {ok: false, reason}: a phrase with no
// period, for "Cable X is not in this file: end A, <end>, <reason>."
export function resolveEnd({path, device, moduleAt = () => null, consoles = []}) {
  if (!device) return {ok: false, reason: 'its device has no device type'};
  const p = String(path), at = p.indexOf(MODULE);
  if (at < 0) {
    const hit = findName(device, p);
    if (hit) return {ok: true, name: p, type: hit.type};
    if (consoles.includes(p)) {
      const listed = device.sections['console-ports'];
      if (listed.includes(`Console (${p})`)) return {ok: true, name: `Console (${p})`, type: 'dcim.consoleport'};
      if (listed.length === 1 && consoles.length === 1) return {ok: true, name: listed[0], type: 'dcim.consoleport'};
      return {ok: false, reason: `the device type ${device.model} does not say which of its console ports ${p} is`};
    }
    return {ok: false, reason: `the device type ${device.model} lists no port named ${p}`};
  }
  const bayId = p.slice(0, at), leaf = p.slice(at + MODULE.length);
  if (leaf.includes(MODULE))
    return {ok: false, reason: 'it is a port of a module inside a card, and the card has no module bay to import that module into'};
  const bay = bayAt(device, bayId);
  if (!bay) return {ok: false, reason: `the device type ${device.model} has no module bay at position ${bayId}`};
  const module = moduleAt(bayId);
  if (!module) return {ok: false, reason: `what is seated in ${bayId} has no module type`};
  const hit = findName(module, `{module}/${leaf}`);
  if (!hit) return {ok: false, reason: `the module type ${module.model} lists no port named {module}/${leaf}`};
  return {ok: true, name: `${bay.position}/${leaf}`, type: hit.type, bay};
}

// ── the modules file (Phase 2c ruling 5) ────────────────────────────────
// A card's ports exist in a DCIM only once a module of its type is in its bay,
// so the modules are imported before the cables. NetBox finds the bay by the
// device's name and the bay's NAME, and the module type by its model alone (a
// manufacturer column is refused); Nautobot by the lookups below. Both were
// accepted by the real instances (NetBox 4.7.2, Nautobot 3.2.6).
export const MODULE_COLUMNS = {
  netbox: ['device', 'module_bay', 'module_type', 'status'],
  nautobot: ['module_type__manufacturer__name', 'module_type__model', 'parent_module_bay__parent_device__name',
             'parent_module_bay__name', 'status__name']};

// One row per part seated in a BAY (its path ends "/module") that has a module
// type, on a device the devices file holds, in a bay the device type has at
// that position. A part seated in a cage (an optic, a plug) is not a module:
// the cage is the interface. A module inside a card is not written: no module
// type here has a module bay of its own to import it into.
//   parts     [{itemId, path, ref}], what each device has seated (exports.js)
//   names     uniqueNames(items); kept: the ids of the devices in the devices file
//   deviceOf  item id -> typeLists of its device type, or null
//   moduleOf  part ref -> {manufacturer, model, lists} of its module type, or null
// `left` holds one sentence for each thing the file does not carry.
export function moduleImportRows({target = 'netbox', parts, names, kept, deviceOf, moduleOf}) {
  const rows = [], left = [], said = new Set();
  for (const p of parts) {
    if (!String(p.path).endsWith('/module')) continue;
    const type = moduleOf(p.ref);
    if (!type) continue;                       // a part with no module type is already in the kit's notes
    const device = names.get(p.itemId)?.name ?? '';
    const bayId = p.path.slice(0, -'/module'.length);
    if (!kept.has(p.itemId)) {
      if (!said.has(p.itemId)) left.push(`The modules of ${device} are not in the modules file: ${device} is not in the devices file.`);
      said.add(p.itemId);
      continue;
    }
    if (bayId.includes(MODULE)) {
      left.push(`${device} ${bayId}: ${type.model} is not in the modules file. It is a module inside a card, and no module type here has a module bay to import it into.`);
      continue;
    }
    const lists = deviceOf(p.itemId), bay = bayAt(lists, bayId);
    if (!bay) {
      left.push(`${device} ${bayId}: ${type.model} is not in the modules file. The device type ${lists?.model ?? ''} has no module bay at position ${bayId}.`);
      continue;
    }
    rows.push(target === 'nautobot'
      ? {module_type__manufacturer__name: type.manufacturer, module_type__model: type.model,
         parent_module_bay__parent_device__name: device, parent_module_bay__name: bay.name, status__name: 'Planned'}
      : {device, module_bay: bay.name, module_type: type.model, status: 'planned'});
  }
  return {columns: MODULE_COLUMNS[target === 'nautobot' ? 'nautobot' : 'netbox'], rows, left};
}

// ── the cables file (Phase 2c rulings 6 and 7) ──────────────────────────
// The Rack Builder's media as a DCIM's cable type. Both targets accepted each
// of these and refused "os2". A media this page does not know, or none, is a
// blank type: the column is optional.
export const CABLE_TYPE = {os2: 'smf-os2', om3: 'mmf-om3', om4: 'mmf-om4', om5: 'mmf-om5', cat6: 'cat6', cat6a: 'cat6a',
                           dac: 'dac-passive', aoc: 'aoc'};
export const cableType = media => (Object.hasOwn(CABLE_TYPE, media ?? '') ? CABLE_TYPE[media] : '');

// Which kinds of end a DCIM lets one cable join (NetBox and Nautobot share the
// table; both refused a console port to an interface).
const PORTS = ['dcim.frontport', 'dcim.rearport'];
const MEETS = {
  'dcim.interface': ['dcim.interface', ...PORTS],
  'dcim.frontport': ['dcim.interface', 'dcim.consoleport', 'dcim.consoleserverport', ...PORTS],
  'dcim.rearport': ['dcim.interface', 'dcim.consoleport', 'dcim.consoleserverport', ...PORTS],
  'dcim.consoleport': ['dcim.consoleserverport', ...PORTS],
  'dcim.consoleserverport': ['dcim.consoleport', ...PORTS],
  'dcim.powerport': ['dcim.poweroutlet'],
  'dcim.poweroutlet': ['dcim.powerport']};
export const canMeet = (a, b) => (MEETS[a] || []).includes(b);
const KIND = {'dcim.interface': 'an interface', 'dcim.frontport': 'a front port', 'dcim.rearport': 'a rear port',
              'dcim.consoleport': 'a console port', 'dcim.consoleserverport': 'a console server port',
              'dcim.powerport': 'a power port', 'dcim.poweroutlet': 'a power outlet'};

// A cable's length as a target takes it: {value, unit, note}. Only m and ft
// are written (the units the page offers). NetBox keeps two decimal places and
// refuses a third; Nautobot takes a whole number only. Either way a length is
// rounded UP, never down: a cable cut short does not reach.
export function importLength(cable, target = 'netbox') {
  const p = lengthParts(cable.length);
  if (!p) return {value: '', unit: '', note: cable.lengthAsWritten != null ? 'its length as written in the rack file is not carried' : null};
  if (p.unit !== 'm' && p.unit !== 'ft')
    return {value: '', unit: '', note: `its length (${p.value} ${p.unit}) is not carried: the kit writes lengths in m or ft only`};
  const value = target === 'nautobot' ? Math.ceil(p.value) : Math.ceil(p.value * 100 - 1e-9) / 100;
  const note = value === p.value ? null
    : `${p.value} ${p.unit} is written as ${value} ${p.unit}: ${target === 'nautobot' ? 'Nautobot takes whole numbers' : 'NetBox keeps two decimal places'}, and a length is rounded up`;
  return {value, unit: p.unit, note};
}

export const CABLE_IMPORT_COLUMNS = {
  netbox: ['side_a_device', 'side_a_type', 'side_a_name', 'side_b_device', 'side_b_type', 'side_b_name', 'type', 'status',
           'label', 'color', 'length', 'length_unit', 'description'],
  // Read by import_cables.py, NOT by Nautobot's own importer: Nautobot takes a cable's ends by id only.
  nautobot: ['a_device', 'a_type', 'a_name', 'b_device', 'b_type', 'b_name', 'type', 'status', 'label', 'color', 'length',
             'length_unit']};

// One row per cable the target will take. NetBox takes the file whole or not
// at all, so a cable it would refuse is left out and said, in `left`, with its
// reason. A row needs: its ends checked and both landed; both devices in the
// devices file; both ends named by the type files (`resolve`, resolveEnd over
// this rack); no comma in a device or port name (NetBox reads one as a list);
// two kinds of end a DCIM joins; and no port already used by an earlier row.
//   ends       cable-plugs.js cableFacts(rack).ends; unchecked: reading them failed
//   names      uniqueNames(items); kept: the ids of the devices in the devices file
//   resolve    end -> resolveEnd's answer for that end
//   uOf        endName's: how tall a device is
// `notes` are about rows that ARE written: a type left blank, a length changed.
export function cableImportRows({rack, target = 'netbox', names, kept, resolve, ends = new Map(), unchecked = false, uOf}) {
  const T = TARGET_NAME[target] || 'NetBox', nautobot = target === 'nautobot';
  const rows = [], left = [], notes = [], used = new Map();
  let dac = false;
  for (const f of cableFindings(rack, ends)) {
    const c = f.cable;
    let why = [], sides = [];
    if (unchecked || !f.checked) why = ['its ends could not be checked'];
    else if (f.loose.length)
      why = f.loose.map(l => `end ${l.side}, ${endName(rack, l.end, uOf)}, is not connected (${l.reason})`);
    else {
      sides = [['A', c.a], ['B', c.b]].map(([side, end]) => {
        const device = names.get(end.item)?.name ?? '';
        if (!kept.has(end.item)) return {why: `end ${side} is on ${device}, which is not in the devices file`};
        const r = resolve(end);
        if (!r.ok) return {why: `end ${side}, ${endName(rack, end, uOf)}: ${r.reason}`};
        const comma = [device, r.name].find(x => x.includes(','));
        if (!nautobot && comma != null) return {why: `end ${side}: NetBox reads a comma in a device or port name as a list, so "${comma}" cannot be written`};
        return {side, end, device, name: r.name, type: r.type, key: JSON.stringify([device, r.type, r.name])};
      });
      why = sides.filter(s => s.why).map(s => s.why);
      if (!why.length && !canMeet(sides[0].type, sides[1].type))
        why = [`${T} does not cable ${KIND[sides[0].type]} to ${KIND[sides[1].type]}`];
      if (!why.length)
        why = sides.filter(s => used.has(s.key))
          .map(s => `end ${s.side}, ${endName(rack, s.end, uOf)}, already has cable ${used.get(s.key)} in this file`);
    }
    if (why.length) { left.push(`Cable ${f.name} is not in the cables file: ${why.join('; ')}.`); continue; }
    const [a, b] = sides;
    for (const s of sides) used.set(s.key, f.name);
    const type = cableType(c.media);
    if (c.media && !type) notes.push(`Cable ${f.name}: its media (${c.media}) has no ${T} cable type, so its type is blank.`);
    dac ||= c.media === 'dac';
    const len = importLength(c, target);
    if (len.note) notes.push(`Cable ${f.name}: ${len.note}.`);
    rows.push(nautobot
      ? {a_device: a.device, a_type: a.type, a_name: a.name, b_device: b.device, b_type: b.type, b_name: b.name, type,
         status: 'Planned', label: c.label || c.id, color: '', length: len.value, length_unit: len.unit}
      : {side_a_device: a.device, side_a_type: a.type, side_a_name: a.name, side_b_device: b.device, side_b_type: b.type,
         side_b_name: b.name, type, status: 'planned', label: c.label || c.id, color: '', length: len.value,
         length_unit: len.unit, description: c.purpose || ''});
  }
  if (dac) notes.push('A DAC is written as dac-passive. Change the type of one that is active.');
  return {columns: CABLE_IMPORT_COLUMNS[nautobot ? 'nautobot' : 'netbox'], rows, left, notes};
}

// ── README.txt (Phase 2c ruling 1) ──────────────────────────────────────
// What to do with each file, in order; what must already exist; and
// everything the kit could not carry. It replaces NOTES.txt and keeps its
// content (`notes`).
//   rows      how many rows each CSV holds: {rack, devices, modules, cables}
//   typeFiles how many YAML files are under types/
//   left      a sentence for each device, module and cable the files leave out
//   notes     what the types and the written rows need said (a best-guess type,
//             a length that was rounded)
//   script    whether import_cables.py is in the zip (Nautobot)
// Returns {text, notes}: `notes` are the lines the file carries beyond its
// instructions, which is what the page's status line counts.
export const KIT_FILES = {
  netbox: {rack: '1-rack.csv', devices: '2-devices.csv', modules: '3-modules.csv', cables: '4-cables.csv'},
  nautobot: {devices: '1-devices.csv', modules: '2-modules.csv', cables: '3-cables.csv'}};
export const KIT_SCRIPT = 'import_cables.py';
const isoDay = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const rowsText = n => (n ? `${n} ${n === 1 ? 'row' : 'rows'}` : 'no rows: it holds its header only, so skip it');

export function kitReadme({target = 'netbox', rack, date, dcim = {}, typeFiles = 0, manufacturers = [], rows = {},
                           left = [], notes = [], script = true}) {
  const nautobot = target === 'nautobot', T = TARGET_NAME[nautobot ? 'nautobot' : 'netbox'];
  const F = KIT_FILES[nautobot ? 'nautobot' : 'netbox'];
  const site = String(dcim?.site ?? '').trim(), role = String(dcim?.role ?? '').trim();
  const place = nautobot ? 'location' : 'site', cols = nautobot ? ['location__name', 'role__name'] : ['site', 'role'];
  const blank = [!site && cols[0], !role && cols[1]].filter(Boolean);
  const warning = blank.length
    ? `${F.devices} WILL BE REFUSED as it is: its ${blank.join(' and ')} ${blank.length === 1 ? 'column is' : 'columns are'} blank, and ` +
      `${T} requires ${blank.length === 1 ? 'it' : 'both'}.${!nautobot && !site ? ` ${F.rack}'s site column is blank too.` : ''} ` +
      `Set the ${[!site && place, !role && 'device role'].filter(Boolean).join(' and the ')} under Export, DCIM import settings, ` +
      `and export again; or fill ${blank.length === 1 ? 'that column' : 'those columns'} in by hand.`
    : '';
  const numbered = rack.frame.numbering === 'top-down' ? 'numbered from the top' : 'numbered from the bottom';
  const out = [`${T} import kit for ${rack.name}, from the Portrayal Rack Builder, ${isoDay(date)}.`, ''];
  if (warning) out.push(warning, '');

  out.push(`BEFORE YOU IMPORT, ${T} must already have:`);
  out.push(site ? `- the ${place} "${site}"${nautobot ? ', of a location type that allows devices and racks' : ''}`
                : `- a ${place}${nautobot ? ', of a location type that allows devices and racks' : ''} (none is set in this kit)`);
  out.push(role ? `- the ${nautobot ? 'role' : 'device role'} "${role}"${nautobot ? ', for devices' : ''}`
                : `- a ${nautobot ? 'role for devices' : 'device role'} (none is set in this kit)`);
  if (nautobot) out.push('- a status named Planned, for devices, modules and cables');
  if (manufacturers.length) out.push(`- these manufacturers: ${manufacturers.join(', ')}`);
  if (nautobot)
    out.push(`- the rack "${rack.name}" in that location: ${rack.frame.heightRU}U, ${numbered}` +
             `${rack.frame.numbering === 'top-down' ? ' (descending units)' : ''}. This kit has no rack file for Nautobot.`);
  out.push('');

  const types = `types/device-types/, then types/module-types/ (${typeFiles} ${typeFiles === 1 ? 'file' : 'files'})`;
  if (nautobot) {
    out.push('IMPORT IN THIS ORDER. Nautobot takes each CSV file whole or not at all.',
      typeFiles ? `1. ${types}: Device Types > Import and Module Types > Import, one YAML file per import. This step is written ` +
                  'from Nautobot\'s source and was NOT verified against Nautobot 3.2.'
                : '1. types/: no files, so there is nothing to import.',
      `2. ${F.devices} (${rowsText(rows.devices)}): Devices > Import, or POST it to /api/dcim/devices/ as text/csv. Every device is planned.`,
      `3. ${F.modules} (${rowsText(rows.modules)}): Modules > Import, or POST it to /api/dcim/modules/ as text/csv. ` +
        "This creates each card's ports, so it comes before the cables.",
      `4. ${F.cables} (${rowsText(rows.cables)}), with ${KIT_SCRIPT}. DO NOT give ${F.cables} to Nautobot's own importer: ` +
        'Nautobot takes a cable\'s ends by id only, and from a file that names them it creates cables with no ends.');
    if (script)
      out.push('     export NAUTOBOT_URL=https://nautobot.example.com',
        '     export NAUTOBOT_TOKEN=...     (an API token; the script never prints it)',
        `     python3 ${KIT_SCRIPT} ${F.cables}             (a dry run: what it would create, and what it cannot find)`,
        `     python3 ${KIT_SCRIPT} ${F.cables} --apply     (creates the cables)`,
        "   Python 3, standard library only. It talks to that URL's host and no other.");
    out.push("   A cable's purpose is not carried: a Nautobot cable has no description.", '');
  } else {
    out.push('IMPORT IN THIS ORDER. NetBox takes each CSV file whole or not at all: one refused row refuses the file.',
      typeFiles ? `1. ${types}: Device Types > Import and Module Types > Import, format YAML, one file at a time. ` +
                  'The module types must be in before step 4.'
                : '1. types/: no files, so there is nothing to import.',
      `2. ${F.rack} (${rowsText(rows.rack)}): Racks > Import. Creates the rack "${rack.name}", ${rack.frame.heightRU}U, ${numbered}.`,
      `3. ${F.devices} (${rowsText(rows.devices)}): Devices > Import. Every device is planned.`,
      `4. ${F.modules} (${rowsText(rows.modules)}): Modules > Import. This creates each card's ports, so it comes before the cables.`,
      `5. ${F.cables} (${rowsText(rows.cables)}): Cables > Import.`,
      '   NetBox finds a device by its name in every site, and a module type by its model in every manufacturer: a name it ' +
      'already has twice is refused as not unique.', '');
  }

  const missing = nautobot && !script
    ? [`${KIT_SCRIPT} could not be fetched, so it is not in this zip. It is at https://portrayal.dev/site/rack/nautobot/${KIT_SCRIPT}.`] : [];
  const gone = [...missing, ...left];
  out.push('NOT IN THIS KIT:', ...(gone.length ? gone.map(n => `- ${n}`) : ['- Nothing: every device, card and cable in this rack is in the files.']), '');
  if (notes.length) out.push('NOTES:', ...notes.map(n => `- ${n}`), '');
  return {text: `${out.join('\n').trimEnd()}\n`, notes: [...(warning ? [warning] : []), ...gone, ...notes]};
}
