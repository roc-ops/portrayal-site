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
