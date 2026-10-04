// WHAT A DCIM IMPORT KIT SAYS, as data (spec §8, §9.4; Phase 2c). Pure: no DOM,
// no fetch, so `node --test` covers every rule the NetBox and Nautobot kits
// follow: what a port is called in a type file, which rows a file may hold,
// and what the README says of the rest. site/rack/exports.js fetches the type
// files and the faces, and asks here.

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
