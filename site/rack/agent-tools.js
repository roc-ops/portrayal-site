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
        const lines = [ed.canUndo ? `Undo would take back: ${ed.undoSummary}` : 'Nothing to undo.'];
        if (rack.frame.numbering === 'top-down')
          lines.push("This rack's U labels count top-down; commands take ru counted from 1 at the bottom of the rails.");
        lines.push(queries.describe(rack));
        const loose = await queries.looseEnds(rack);
        if (loose.ends.length) lines.push('Loose ends:', ...loose.ends.map(e => `${e.cable}: the ${e.end.item} end does not land: ${e.reason}`));
        if (loose.unchecked) lines.push('Some ports could not be checked.');
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
  return tools;
}
