// site/rack/agent-tools.js
// THE RACK BUILDER'S AGENT TOOLS (spec 2026-10-07-rack-agent-tools-design.md):
// piece 1's editor and queries, handed to an agent as eight WebMCP tools. Pure
// apart from what it is handed - no DOM, no fetch - so it is tested in Node and
// registered by the page (site/agent/webmcp.js).

import {COMMANDS} from './commands.js';

// Chrome's WebMCP guidance: tool output of about 1.5K characters at most.
export const LIMIT = 1500;

// Cut at the last whole line that fits, and say how many lines were left out.
export function fit(text, limit = LIMIT) {
  if (text.length <= limit) return text;
  const lines = text.split('\n');
  for (let keep = lines.length - 1; keep >= 1; keep--) {
    const left = lines.length - keep;
    const out = [...lines.slice(0, keep), `(${left} more line${left === 1 ? '' : 's'} left out.)`].join('\n');
    if (out.length <= limit) return out;
  }
  return `${text.slice(0, limit - 1)}…`;
}

export function ranges(ns) {
  const s = [...new Set(ns)].sort((a, b) => a - b), out = [];
  for (let i = 0; i < s.length; i++) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    out.push(i === j ? `U${s[i]}` : `U${s[i]}-U${s[j]}`);
    i = j;
  }
  return out.join(', ');
}

// What an agent may send: every command but the page's own (system) and the
// DCIM settings, which stay the user's (spec §7 D).
export const agentMay = (op, commands = COMMANDS) =>
  Object.hasOwn(commands, op) && !commands[op].system && op !== 'dcim';

// edit_rack's argument schema, generated from the command table, so a command
// added there is offered here with no other change. A guide for the agent:
// apply() checks every argument again, strictly, and says what is wrong.
export function editSchema(commands = COMMANDS) {
  const oneOf = Object.keys(commands).filter(op => agentMay(op, commands)).map(op => {
    const a = commands[op].args ?? {type: 'object', properties: {}};
    return {
      type: 'object', description: commands[op].description,
      required: ['op', ...(a.required ?? [])],
      properties: {op: {const: op}, ...(a.properties ?? {})},
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
const READ = {readOnlyHint: true};
const UNTRUSTED = {readOnlyHint: true, untrustedContentHint: true};

export function rackTools({ed, chassisOf, queries, runExport}) {
  const tool = (name, title, description, properties, required, annotations, run) => ({
    name, title, description, annotations,
    inputSchema: {type: 'object', properties, ...(required.length ? {required} : {}), additionalProperties: false},
    execute: safe(run),
  });
  const tools = [
    tool('describe_rack', 'Describe the rack',
      'Read the open rack: its frame, every device and cable manager with its id, U range and face, every cable, the cable ends that do not land, and what Undo would take back. Call this first; edit_rack addresses things by these ids.',
      {}, [], UNTRUSTED,
      async () => {
        const rack = ed.rack();
        // The undo line is cut short and the loose ends come before the listing,
        // so a big rack's listing is what fit() trims, never the problems.
        const undo = `Undo would take back: ${ed.undoSummary}`;
        const lines = [ed.canUndo ? (undo.length > 150 ? `${undo.slice(0, 149)}…` : undo) : 'Nothing to undo.'];
        if (rack.frame.numbering === 'top-down')
          lines.push("This rack's U labels count top-down; commands take ru counted from 1 at the bottom of the rails.");
        const loose = await queries.looseEnds(rack);
        if (loose.ends.length) lines.push('Loose ends:', ...loose.ends.map(e => `${e.cable}: the ${e.end.item} end does not land: ${e.reason}`));
        if (loose.unchecked) lines.push('Some ports could not be checked.');
        lines.push(queries.describe(rack));
        return say(lines.join('\n'));
      }),
    tool('find_devices', 'Find devices',
      'Search the devices that can be put in a rack, by words in the manufacturer, model or id, by height in U, by family or by mount. Each result gives the ref and configs that edit_rack\'s place command takes.',
      {text: {type: 'string', description: 'Words to look for, e.g. "dell r740" or "patch panel".'},
       ru: {type: 'integer', minimum: 1, description: 'Only devices this many U tall.'},
       family: {type: 'string', description: 'Only this product family.'},
       mount: {type: 'string', enum: ['rack', 'rack-face'], description: 'rack for devices, rack-face for cable managers.'}},
      [], READ,
      async ({text, ru, family, mount}) => {
        const all = queries.catalog({text, ru, family, mount});
        if (!all.length) return say('No devices match. Try fewer words, or none.');
        const line = e => `${e.ref} | ${[e.manufacturer, e.model].filter(Boolean).join(' ')} | ${e.ru}U${e.mount !== 'rack' ? ` ${e.mount}` : ''} | configs: ${e.configs.join(', ')}${e.default ? ` (default ${e.default})` : ''}`;
        const shown = all.slice(0, 20).map(line);
        if (all.length > 20) shown.push(`and ${all.length - 20} more: narrow the search.`);
        return say(shown.join('\n'));
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
      'List the ports of one device that have no cable, front and rear, with speed and media. cable.add takes a port as {item, path, view}.',
      {item: {type: 'string', description: 'The device id, as describe_rack gives it (e.g. i3).'}},
      ['item'], UNTRUSTED,
      async ({item}) => {
        const ports = await queries.freePorts(ed.rack(), item);
        if (ports.error) return refuse(ports.error);
        const lines = [];
        for (const view of ['front', 'rear']) {
          const here = ports.filter(p => p.view === view);
          lines.push(`${view === 'front' ? 'Front' : 'Rear'}:`,
                     ...(here.length ? here.map(p => `${p.path}: ${[p.label, p.speed, p.media].filter(Boolean).join(', ')}`) : ['no free ports']));
        }
        return say(lines.join('\n'));
      }),
  ];
  const kinds = Object.keys(EXPORT_KINDS);
  tools.push(
    tool('edit_rack', 'Edit the rack',
      'Apply edits in order. All apply or none; one undo step. Name what a command creates with as: "srv", then use "@srv" as a later id or cable end item. Get ref and cfg from find_devices, port paths from list_free_ports. Send only the fields you are changing. dry_run checks without changing anything.',
      editSchema().properties, ['commands'], {readOnlyHint: false},
      async ({commands, dry_run}) => {
        if (!Array.isArray(commands) || !commands.length) return refuse('Send commands: a list of at least one {op, ...}.');
        const n = commands.length;
        const at = i => `Command ${i + 1} of ${n} (${commands[i]?.op})`;
        const banned = commands.findIndex(c => typeof c?.op === 'string' && Object.hasOwn(COMMANDS, c.op) && !agentMay(c.op));
        if (banned >= 0) return refuse(`${at(banned)} is not for agents: the page sends it itself, or the user sets it. Nothing was changed.`);
        const res = dry_run ? ed.preview(commands) : ed.apply(commands, {origin: 'agent'});
        if (res.error) return refuse(`${at(res.index ?? 0)} was refused: ${res.error} Nothing was changed.`);
        if (res.noop) return say('Nothing changed: the rack already looks like that.');
        const named = Object.entries(res.created ?? {}).filter(([k]) => k !== 'ids').map(([k, v]) => `${k} = ${v}`);
        // What the next call needs comes first, so a long batch can lose only
        // the tail of its summary and its notes, never ids or the undo line.
        const head = [...(named.length ? [named.join(', ')] : []),
          ...(res.created?.ids?.length ? [`Created: ${res.created.ids.join(', ')}`] : []),
          dry_run ? 'Nothing was changed.' : 'Undo takes all of this back in one step.'];
        const notes = res.findings.map(f => `${f.kind === 'error' ? 'Problem' : 'Note'}: ${f.text}`);
        const sum = `${dry_run ? 'Would: ' : ''}${res.summary}`;
        const room = LIMIT - head.join('\n').length - 1;
        const cut = sum.length <= room ? sum : `${sum.slice(0, Math.max(0, room - 1))}…`;
        const lines = [...head, cut];
        for (const n of notes) {
          if ([...lines, n].join('\n').length > LIMIT) break;
          lines.push(n);
        }
        return say(lines.join('\n'));
      }),
    tool('undo', 'Undo', 'Take back the last edit to the rack, whoever made it, and say what it was.', {}, [], {readOnlyHint: false},
      async () => { const s = ed.undo(); return say(s ? `Undid: ${s.summary}` : 'Nothing to undo.'); }),
    tool('redo', 'Redo', 'Put back the last edit Undo took back, and say what it was.', {}, [], {readOnlyHint: false},
      async () => { const s = ed.redo(); return say(s ? `Redid: ${s.summary}` : 'Nothing to redo.'); }),
    tool('export_rack', 'Export the rack',
      'Save the rack as a file through the browser\'s download: a drawing (svg, png), a draw.io diagram, a NetBox or Nautobot import kit, a bill of materials, a cable schedule, or the rack file. Returns the file name and notes, not the file.',
      {kind: {type: 'string', enum: kinds, description: 'Which export.'}}, ['kind'], {readOnlyHint: false},
      async ({kind}) => {
        const key = EXPORT_KINDS[kind];
        if (!key) return refuse(`There is no export called ${kind}. Choose one of: ${kinds.join(', ')}.`);
        const out = await runExport(key);
        if (!out || out.error) return refuse(out?.error ?? "That export didn't work. Try again.");
        // The agent can't open the zip, so it is told where an import kit's omissions are written.
        const kit = key === 'netbox-import' || key === 'nautobot-import'
          ? " The kit's README.txt lists anything left out, such as a cable whose end is not connected: do not say every cable is in the file, and tell the user to read it." : '';
        return say(`Saved ${out.name}.${out.notes ? ` ${out.notes}` : ''}${kit}`);
      }),
  );
  return tools;
}
