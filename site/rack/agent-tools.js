// site/rack/agent-tools.js
// THE RACK BUILDER'S AGENT TOOLS (spec 2026-10-07-rack-agent-tools-design.md,
// round 2 in 2026-10-08-rack-agent-tools-2-design.md): the kit's editor and
// queries, handed to an agent as ten WebMCP tools. Pure
// apart from what it is handed - no DOM, no fetch - so it is tested in Node and
// registered by the page (site/agent/webmcp.js).

import {COMMANDS, apply as applyCommands} from '../../vendor/rack/commands.js';
import {newRack, dcimOf} from '../../vendor/rack/model.js';
import {MAX_WINDOW} from '../../vendor/rack/queries.js';
import {LIMIT, fit, ranges, clip, cutList, runs, windowLines, inspectText, cableText, INSPECT_SECTIONS} from './agent-text.js';
import {portPathOf} from '../../vendor/rack/cable-rules.js';
import {refsFor, routes, SELECTABLE, expandSelectors, reached, editResult} from './agent-edit.js';

export {LIMIT, fit, ranges};

// What an agent may send: every command but the page's own (system) and the
// DCIM settings, which stay the user's (spec §7 D).
export const agentMay = (op, commands = COMMANDS) =>
  Object.hasOwn(commands, op) && !commands[op].system && op !== 'dcim';

// THE KIT'S ARGUMENTS, AS AN AGENT HERE READS THEM (spec 2026-10-08 section 5):
// the shape of every object argument, the open rack, and this site's tool
// names where a kit description names one of its own functions.
const ARG_WORDS = {
  rack: 'Edits go to the rack that is open; describe_rack names it.',
  a: 'One end: {item, path, view}: a device id, a port path from list_free_ports, and front or rear.',
  b: 'The other end: {item, path, view}, as for a.',
  length: 'How long: {value, unit} with unit m or ft (m when left out), or null for not known.',
  holes: 'The rail holes: {style, thread}: square or tapped, and the thread of tapped holes.',
  swaps: 'Replaces every swap: {slot path: part ref}. To change one slot, use fit.',
  fields: 'Replaces every field: {part path: {key: value}}. To set one, use field.',
};
const ARG_WORDS_BY_OP = {
  'cable.update': {
    a: 'Moves end a to another port: {item, path, view}. The cable keeps its id, media, label and length.',
    b: 'Moves end b to another port: {item, path, view}, as for a.',
  },
};
const TOOL_WORDS = [[/\bdescribe\(\)/g, 'describe_rack'], [/\bfreePorts\(\)/g, 'list_free_ports'],
                    [/\bcatalog\(\)/g, 'find_devices'], [/\binspect\(\)/g, 'inspect']];
const words = d => TOOL_WORDS.reduce((s, [re, w]) => s.replace(re, w), d);
// Every description at any depth, in this site's words.
const reword = node => {
  if (Array.isArray(node)) return node.map(reword);
  if (!node || typeof node !== 'object') return node;
  return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, k === 'description' && typeof v === 'string' ? words(v) : reword(v)]));
};

// edit_rack's argument schema, generated from the command table, so a command
// added there is offered here with no other change. A guide for the agent:
// apply() checks every argument again, strictly, and says what is wrong.
// cable.remove and cable.update take select in place of id (agent-edit.js).
const SELECT = {type: 'object', description: 'In place of id: {item}, {item, path, view}, {loose: true}, {purpose} or {media}. Reads the rack as it was before this batch.'};
export function editSchema(commands = COMMANDS) {
  const oneOf = Object.keys(commands).filter(op => agentMay(op, commands)).map(op => {
    const a = reword(commands[op].args ?? {type: 'object', properties: {}});
    const props = {...(a.properties ?? {})};
    for (const k of Object.keys(props)) {
      const w = ARG_WORDS_BY_OP[op]?.[k] ?? ARG_WORDS[k];
      if (w) props[k] = {...props[k], description: w};
    }
    let required = a.required ?? [];
    if (SELECTABLE.has(op)) { props.select = SELECT; required = required.filter(r => r !== 'id'); }
    return {
      type: 'object', description: words(commands[op].description),
      required: ['op', ...required],
      properties: {op: {const: op}, ...props},
      ...('additionalProperties' in a ? {additionalProperties: a.additionalProperties} : {}),
    };
  });
  return {
    type: 'object', required: ['commands'], additionalProperties: false,
    properties: {
      commands: {type: 'array', minItems: 1, maxItems: 50, items: {oneOf},
                 description: 'The edits, in order. All are applied, or none.'},
      dry_run: {type: 'boolean', description: 'Check the edits and say what they would do, changing nothing.'},
    },
  };
}

// The words an agent picks an export by, and the page's own export keys.
export const EXPORT_KINDS = {
  'sheet svg': 'sheet-svg', 'front svg': 'front-svg', 'rear svg': 'rear-svg', 'sheet png': 'sheet-png',
  drawio: 'drawio', 'netbox import': 'netbox-import', 'nautobot import': 'nautobot-import',
  'bill of materials': 'bom', 'cable schedule': 'cables', 'rack file': 'json',
};

const say = t => ({content: [{type: 'text', text: fit(t)}]});
const refuse = t => ({...say(t), isError: true});
// A tool that throws is answered, never thrown: the agent hears what failed.
const safe = fn => async (args = {}) => {
  try { return await fn(args ?? {}); } catch (e) {
    console.error('[portrayal] agent tool', e);
    return refuse(`That didn't work: ${e?.message ?? e}.`);
  }
};
const FACE = {type: 'string', enum: ['front', 'rear'], description: 'Which face of the rack: front or rear.'};
// describe_rack's largest window: the kit's own cap on a window.
const MAX_LIMIT = MAX_WINDOW;

// THE DCIM IMPORT SETTINGS stay the user's (spec 2026-10-08 section 3): an agent
// is told what they are, and that a blank one is the user's to set.
const SETS = 'the user sets them under Export > DCIM import settings';
export const dcimBlank = rack => { const d = dcimOf(rack); return [!d.site && 'site', !d.role && 'role'].filter(Boolean); };
export function dcimLine(rack) {
  const d = dcimOf(rack);
  const said = `site ${d.site ? clip(d.site, 60) : 'blank'}, role ${d.role ? clip(d.role, 60) : 'blank'}`;
  return `DCIM import: ${said}${d.site && d.role ? '.' : `; ${SETS}.`}`;
}
const READ = {readOnlyHint: true};
const UNTRUSTED = {readOnlyHint: true, untrustedContentHint: true};

// `commands` is the table the editor runs (the page adds its own, zero-u.js);
// `besides(rack)` lists what describe() leaves out: the parts beside the rack.
// `context(rack, refs, {route})` is the kit's per-call context, read by the
// page: the parts lists of `refs` and of everything in the rack (loadSlots),
// the cabled ends' facts, and, with route, the routing context. `library` is
// the page's New path (new_rack).
export function rackTools({ed, chassisOf, queries, runExport, commands = COMMANDS, besides = () => [],
                           context = async () => ({}), library = null}) {
  const table = commands;
  const tool = (name, title, description, properties, required, annotations, run) => ({
    name, title, description, annotations,
    inputSchema: {type: 'object', properties, ...(required.length ? {required} : {}), additionalProperties: false},
    execute: safe(run),
  });
  const tools = [
    tool('describe_rack', 'Describe the rack',
      'Read the open rack: its name, id and totals first, then what Undo would take back, the DCIM import settings, the cable ends that do not land, the parts beside the rack, and its devices and cables with their ids. section, offset and limit page a long listing. Call this first; edit_rack and inspect address things by these ids.',
      {section: {type: 'string', enum: ['items', 'cables'], description: 'List only items or only cables. Both when left out.'},
       offset: {type: 'integer', minimum: 0, description: 'Skip this many entries of section; 0 when left out. Needs section.'},
       limit: {type: 'integer', minimum: 1, maximum: MAX_LIMIT, description: `At most this many entries, up to ${MAX_LIMIT}; 40 when left out, fewer when they would not fit.`}},
      [], UNTRUSTED,
      async ({section, offset, limit}) => {
        if (offset != null && section == null) return refuse('Send section with offset: items or cables.');
        const rack = ed.rack();
        // What comes between the kit's first line and its listing: the undo
        // line (cut short), the DCIM settings, the loose ends and the parts
        // beside the rack. The listing is what shrinks to keep the bound,
        // never these.
        const undo = `Undo would take back: ${ed.undoSummary}`;
        const extra = [ed.canUndo ? clip(undo, 150) : 'Nothing to undo.'];
        if (rack.frame.numbering === 'top-down')
          extra.push("This rack's U labels count top-down; commands take ru counted from 1 at the bottom of the rails.");
        extra.push(dcimLine(rack));
        const loose = await queries.looseEnds(rack);
        if (loose.ends.length) {
          extra.push('Loose ends:', ...loose.ends.slice(0, 10).map(e => clip(`${e.cable}: the ${e.end.item} end does not land: ${e.reason}`, 150)));
          if (loose.ends.length > 10) extra.push(`and ${loose.ends.length - 10} more; edit_rack's select {loose: true} reaches them all.`);
        }
        if (loose.unchecked) extra.push('Some ports could not be checked.');
        const side = besides(rack);
        if (side.length) {
          extra.push('Beside the rack (zero-U, no rack unit; edit with zerou.update and zerou.remove):', ...side.slice(0, 8).map(l => clip(l, 150)));
          if (side.length > 8) extra.push(`and ${side.length - 8} more beside the rack.`);
        }
        // The kit's window names what it shows in its first line, so the limit
        // shrinks until the answer fits rather than being cut after the fact.
        // The kit's own window is unbounded in characters and capped at its
        // MAX_WINDOW lines; this tool caps limit at MAX_LIMIT too.
        for (let lim = Math.min(limit ?? 40, MAX_LIMIT); ;) {
          const got = queries.describe(rack, {section, offset: offset ?? 0, limit: lim});
          if (got?.error) return refuse(got.error);
          const [first, ...rest] = got.split('\n');
          const out = [first, ...extra, ...rest].join('\n');
          if (out.length <= LIMIT || lim === 1) return say(out);
          // the next try is scaled to what was over, and always smaller
          lim = Math.max(1, Math.min(lim - 1, Math.floor(lim * LIMIT / out.length)));
        }
      }),
    tool('inspect', 'Inspect a device or cable',
      'Read one device or cable in full. A device: its configs, its bays and cages with what each holds and takes, its editable fields, and its cables. A cable: its ends, media, length, routed length and stock size, route, the waypoints it can take, and why an end is loose. Send id for something in the rack, or ref for a device from find_devices. A long answer comes in pages; its first line says what to send next.',
      {id: {type: 'string', description: 'A device or cable id from describe_rack, e.g. i3 or c7.'},
       ref: {type: 'string', description: 'A device from find_devices, to read it before placing it.'},
       cfg: {type: 'string', description: 'With ref: which configuration to read; its default when left out.'},
       section: {type: 'string', enum: INSPECT_SECTIONS, description: 'Where a page starts: bays, cages, fields or cables. The start when left out.'},
       offset: {type: 'integer', minimum: 0, description: 'Where in section the page starts; 0 when left out.'}},
      [], UNTRUSTED,
      async ({id, ref, cfg, section, offset}) => {
        if (!id === !ref) return refuse('Send id for something in the rack, or ref for a device from find_devices.');
        if (ref) {
          const c = chassisOf(ref);
          if (!c) return refuse(`There is no device called ${ref}. Use find_devices to find its ref.`);
          if (cfg != null && !(c.configs ?? []).includes(cfg)) return refuse(`${ref} has no config called ${cfg}. It has: ${cutList(c.configs ?? [])}.`);
          // A catalog device is read as one item in an empty rack of its own,
          // written out here: a throwaway the editor and the page never see.
          const item = {id: 'i1', ref, cfg: cfg ?? c.default ?? '', label: c.model ?? ref, ru: 1, face: 'front', turned: false, swaps: {}, fields: {}};
          const probe = {...newRack(), items: [item], cables: []};
          const o = await queries.inspect(probe, item.id, await context(probe, [ref]));
          if (o.error) return refuse(o.error);
          return say(inspectText({...o, id: null, label: null, ru: null, cables: []},
            {section, offset: offset ?? 0, ask: {ref, ...(cfg ? {cfg} : {})}}));
        }
        const rack = ed.rack();
        const isCable = (rack.cables ?? []).some(c => c.id === id);
        const ctx = await context(rack, [], {route: isCable});
        // A cable's ends are read through the page's cable facts, which can
        // fail: then they are unchecked, and the rest is still answered.
        let o;
        try { o = await queries.inspect(rack, id, ctx); } catch (e) {
          if (!isCable) throw e;
          o = {...await queries.inspect(rack, id, {...ctx, cableFacts: undefined}), unchecked: true};
        }
        if (o.error) return refuse(o.error);
        return say(o.kind === 'cable' ? cableText(o) : inspectText(o, {section, offset: offset ?? 0, ask: {id}}));
      }),
    tool('find_devices', 'Find devices',
      'Search the devices that can be put in a rack: by words in the manufacturer, model, ref or kind (e.g. "patch panel"), or by kind, height in U, family or mount. Each result gives the ref and configs that edit_rack\'s place command takes; inspect with ref reads one in full. The first line counts the matches; offset pages them.',
      {text: {type: 'string', description: 'Words to look for, e.g. "dell r740" or "patch panel".'},
       kind: {type: 'string', description: 'Only this kind of device, e.g. switch, router, server, patch panel, cable manager, pdu.'},
       ru: {type: 'integer', minimum: 1, description: 'Only devices this many U tall.'},
       family: {type: 'string', description: 'Only this product family.'},
       mount: {type: 'string', enum: ['rack', 'rack-face', 'rack-side'], description: 'rack for devices, rack-face for cable managers, rack-side for vertical cable managers that stand beside the rack (placed with zerou.place).'},
       offset: {type: 'integer', minimum: 0, description: 'Skip this many matches; 0 when left out.'}},
      [], READ,
      async ({text, kind, ru, family, mount, offset}) => {
        const all = queries.catalog({text, kind, ru, family, mount});
        if (!all.length) return say('0 matches. Try fewer words, or none, or another kind.');
        const line = e => clip(`${e.ref} | ${[e.manufacturer, e.model].filter(Boolean).join(' ')} | ${e.ru}U${e.mount !== 'rack' ? ` ${e.mount}` : ''}` +
          `${e.kind ? ` | ${e.kind}` : ''} | configs: ${e.configs.join(', ')}${e.default ? ` (default ${e.default})` : ''}`, 300);
        const start = offset ?? 0;
        const n = all.length, word = `${n} match${n === 1 ? '' : 'es'}`;
        if (start >= n) return say(`${word}; nothing past ${n}.`);
        // The header is written first and counts what the page holds, so a cut never loses it.
        const page = windowLines(all.slice(start, start + 20).map(line), 0, LIMIT - 120);
        const end = start + page.length;
        return say([`${word}, showing ${start + 1}-${end}.${end < n ? ` Next: offset ${end}.` : ''}`, ...page].join('\n'));
      }),
    tool('check_fit', 'Check where a device fits',
      'Ask whether a device fits at a U on a face, and why not if it does not. Leave out ru to list every U it fits at, in the same numbers place takes.',
      {ref: {type: 'string', description: 'The device, as find_devices names it.'}, face: FACE,
       ru: {type: 'integer', minimum: 1, description: 'The U its bottom would sit at.'}},
      ['ref', 'face'], READ,
      async ({ref, face, ru}) => {
        if (!chassisOf(ref)) return refuse(`There is no device called ${ref}. Use find_devices to find its ref.`);
        const rack = ed.rack();
        if (ru != null) {
          const r = queries.fitsAt(rack, {ref, face, ru});
          return say(r.ok ? 'Fits.' : r.reason);
        }
        const us = queries.freeUs(rack, {ref, face});
        const note = rack.frame.numbering === 'top-down' ? ' (counted from the bottom, as place takes them)' : '';
        return say(us.length ? `${ref} fits on the ${face} at ${ranges(us)}${note}.` : `${ref} fits nowhere on the ${face} of this rack.`);
      }),
    tool('list_free_ports', 'List free ports',
      'List the ports of one device that have no cable, grouped into runs, with speed and media. An empty cage is marked: a fiber cable needs an optic fitted there first (edit_rack fit). cable.add takes a port as {item, path, view}. The first line gives the total; a long list comes in pages, and the first line says what to send next.',
      {id: {type: 'string', description: 'The device id from describe_rack, e.g. i3.'},
       item: {type: 'string', description: 'Old name for id; id is preferred.'},
       view: {type: 'string', enum: ['front', 'rear'], description: "Only the ports on the device's front or rear panel. Both when left out."},
       offset: {type: 'integer', minimum: 0, description: 'Skip this many runs; 0 when left out.'}},
      [], UNTRUSTED,
      async ({id, item, view, offset}) => {
        const which = id ?? item;
        if (!which) return refuse('Send id: the device id from describe_rack, e.g. i3.');
        const rack = ed.rack();
        const ports = await queries.freePorts(rack, which);
        if (ports.error) return refuse(ports.error);
        // What each cage holds, from inspect: a port in a cage is free whether
        // or not an optic is seated, and an agent has to know which.
        const o = await Promise.resolve(context(rack, [])).then(ctx => queries.inspect(rack, which, ctx)).catch(() => ({}));
        const holds = new Map((o.cages ?? []).map(c => [`${c.view}|${c.path}`, c.holds ?? null]));
        const order = new Intl.Collator('en', {numeric: true});
        const shown = ports.filter(p => !view || p.view === view)
          .sort((a, b) => (a.view === b.view ? order.compare(a.path, b.path) : a.view === 'front' ? -1 : 1))
          .map(p => {
            // Only the cage's own port is the cage: an optic's own ports
            // (port-1-occupant/...) are ports on the optic, not cages.
            const k = `${p.view}|${p.path}`;
            const isCage = portPathOf(p.path) === p.path && holds.has(k);
            return {...p, cage: isCage ? (holds.get(k) ? `cage, holds ${holds.get(k)}` : 'cage, empty') : null};
          });
        const lines = runs(shown, p => JSON.stringify([p.view, p.speed, p.media, p.cage]))
          .map(p => `${p.path}, ${p.view}: ${[p.speed, p.media, p.cage].filter(Boolean).join(' ') || 'port'}`);
        const where = view ? `on the ${view}` : 'front and rear';
        const name = `${which}${o.label ? ` (${clip(o.label, 40)})` : ''}`;
        if (!lines.length) return say(`${name}: no free ports ${where}.`);
        const s = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
        const total = `${name}: ${s(shown.length, 'free port')} ${where}, in ${s(lines.length, 'run')}.`;
        const start = offset ?? 0;
        if (start >= lines.length) return say(`${total} Nothing past run ${lines.length}.`);
        const page = windowLines(lines, start, LIMIT - 250);
        const end = start + page.length;
        const more = end < lines.length
          ? ` Showing runs ${start + 1}-${end}. Next: ${JSON.stringify({id: which, ...(view ? {view} : {}), offset: end})}.`
          : start ? ` Showing runs ${start + 1}-${end}.` : '';
        return say([total + more, ...page].join('\n'));
      }),
  ];
  const kinds = Object.keys(EXPORT_KINDS);
  tools.push(
    tool('edit_rack', 'Edit the rack',
      'Apply edits to the open rack, in order: all apply or none, as one undo step. Name what a command creates with as: "srv", then use "@srv" as a later id. Refs and cfgs come from find_devices, port paths from list_free_ports, slot paths and field keys from inspect. fit seats one optic or module; field sets one value. cable.remove and cable.update take select in place of id. Send only what changes. dry_run checks without changing anything.',
      editSchema(table).properties, ['commands'], {readOnlyHint: false},
      async ({commands, dry_run}) => {
        if (!Array.isArray(commands) || !commands.length) return refuse('Send commands: a list of at least one {op, ...}.');
        const n = commands.length;
        const at = i => `Command ${i + 1} of ${n} (${commands[i]?.op})`;
        const banned = commands.findIndex(c => typeof c?.op === 'string' && Object.hasOwn(table, c.op) && !agentMay(c.op, table));
        if (banned >= 0) return refuse(`${at(banned)} is not for agents: the page sends it itself, or the user sets it. Nothing was changed.`);
        // The lists load across an await, and the user can edit meanwhile: they
        // are loaded again for the rack as it is, so a device the user just
        // placed has its list too. Three tries; apply checks the rack it has.
        // Selectors read the same rack the lists were loaded for.
        let ctx, x;
        for (let tries = 0; tries < 3; tries++) {
          const rack = ed.rack();
          ctx = await context(rack, refsFor(rack, commands), {route: routes(commands)});
          x = await expandSelectors(rack, commands, (r, sel) => queries.selectCables(r, sel, ctx));
          if (ed.rack() === rack) break;
        }
        if (x.error) return refuse(`${at(x.index)} was refused: ${x.error} Nothing was changed.`);
        const res = dry_run ? ed.preview(x.commands, {ctx}) : ed.apply(x.commands, {origin: 'agent', ctx});
        if (res.error) return refuse(`${at(x.from[res.index ?? 0] ?? 0)} was refused: ${res.error} Nothing was changed.`);
        if (res.noop) return say('Nothing changed: the rack already looks like that.');
        const verb = {'cable.remove': dry_run ? 'Would remove' : 'Removed', 'cable.update': dry_run ? 'Would update' : 'Updated'};
        const echoed = reached(x).map(s => `${verb[s.op]}: ${s.ids.join(', ')}.`);
        const notes = x.unchecked ? ['Note: some ports could not be checked, so a loose cable may have been missed.'] : [];
        return say(editResult(res, {dryRun: !!dry_run, echoed, notes}));
      }),
    tool('new_rack', 'Start a new rack',
      "Start a new, empty rack and open it. The open rack is saved in this browser's library first and stays there; Undo can't take this back. Later edits go to the new rack. name, height and kind set its name and frame.",
      {name: {type: 'string', minLength: 1, description: 'The new rack\'s name. When left out, the next free "Rack n".'},
       height: {type: 'integer', minimum: 1, maximum: 100, description: 'How many U tall, 1 to 100; 42 when left out.'},
       kind: {type: 'string', enum: ['four-post', 'two-post'], description: 'four-post or two-post; four-post when left out.'}},
      [], {readOnlyHint: false},
      async ({name, height, kind}) => {
        if (!library?.available)
          return refuse("This browser isn't keeping a library, so a new rack would lose this one. Ask the user to start one with the rack menu's New rack, which offers to save this one first.");
        const cmds = [...(name != null ? [{op: 'rename', name}] : []),
          ...(height != null || kind != null ? [{op: 'frame', ...(height != null ? {heightRU: height} : {}), ...(kind != null ? {kind} : {})}] : [])];
        // The name and frame are checked before anything happens, then built
        // into the new rack, so it opens as asked with no undo step of its own.
        const check = cmds.length ? applyCommands(newRack(), cmds, {chassisOf}) : null;
        if (check?.error) return refuse(`${check.error} No rack was started.`);
        const shape = r => {
          if (!cmds.length) return r;
          const res = applyCommands(r, cmds, {chassisOf});
          return res.error || res.noop ? r : res.rack;
        };
        const old = ed.rack().name;
        await library.newRack(shape);
        const r = ed.rack();
        return say(`Opened ${r.name} (${r.id}), ${r.frame.heightRU}U ${r.frame.kind}. Undo can't take this back; the old rack, ${old}, is in the library.`);
      }),
    tool('undo', 'Undo', 'Take back the last edit to the rack, whoever made it, and say what it was. "Undid your edit" means the step was the user\'s own, made on the page.', {}, [], {readOnlyHint: false},
      async () => {
        // The editor says whose step it was on its change event; undo() itself says only what.
        let origin = null;
        const off = ed.on('change', e => { origin = e.origin; });
        let s;
        try { s = ed.undo(); } finally { off(); }
        if (!s) return say('Nothing to undo.');
        return say(`Undid${(s.origin ?? origin) === 'ui' ? ' your edit' : ''}: ${s.summary}`);
      }),
    tool('redo', 'Redo', 'Put back the last edit Undo took back, and say what it was.', {}, [], {readOnlyHint: false},
      async () => { const s = ed.redo(); return say(s ? `Redid: ${s.summary}` : 'Nothing to redo.'); }),
    tool('export_rack', 'Export the rack',
      'Save the rack as a file through the browser\'s download: a drawing (svg, png), a draw.io diagram, a NetBox or Nautobot import kit, a bill of materials, a cable schedule, or the rack file. Returns the file name and notes, not the file. An import kit uses the DCIM site and role the user sets; the answer says when they are blank.',
      {kind: {type: 'string', enum: kinds, description: 'Which export.'}}, ['kind'], {readOnlyHint: false},
      async ({kind}) => {
        const key = EXPORT_KINDS[kind];
        if (!key) return refuse(`There is no export called ${kind}. Choose one of: ${kinds.join(', ')}.`);
        const out = await runExport(key);
        if (!out || out.error) return refuse(out?.error ?? "That export didn't work. Try again.");
        const isKit = key === 'netbox-import' || key === 'nautobot-import';
        // Read after the export: runExport stores what is typed in the settings form first.
        const blank = isKit ? dcimBlank(ed.rack()) : [];
        const dcim = blank.length
          ? `The DCIM ${blank.join(' and ')} ${blank.length > 1 ? 'are' : 'is'} blank; the user sets ${blank.length > 1 ? 'them' : 'it'} under Export > DCIM import settings. ` : '';
        // The agent can't open the zip, so it is told where an import kit's omissions are written.
        const kit = isKit
          ? " The kit's README.txt lists anything left out, such as a cable whose end is not connected: do not say every cable is in the file, and tell the user to read it." : '';
        return say(`${dcim}Saved ${out.name}.${out.notes ? ` ${out.notes}` : ''}${kit}`);
      }),
  );
  return tools;
}
