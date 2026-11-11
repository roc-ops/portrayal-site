// site/annotate/agent-tools.js
// ANNOTATE'S AGENT TOOLS: the page's window.portrayalAnnotate (editor.js and
// commands.js behind it), handed to an agent as four WebMCP tools, as
// site/rack/agent-tools.js hands the Rack Builder's editor. Pure apart from the
// api it is given - no DOM, no fetch - so it is tested in Node and registered by
// the page (site/agent/webmcp.js).

import {COMMANDS} from './commands.js';
import {fit} from '../rack/agent-text.js';

// edit_marks' argument schema, generated from the command table, so a command
// added there is offered here with no other change. A guide for the agent:
// apply() checks every argument again, strictly, and says what is wrong.
export function editSchema(commands = COMMANDS) {
  const oneOf = Object.entries(commands).map(([op, def]) => {
    const a = def.args ?? {type: 'object', properties: {}};
    return {
      type: 'object', description: def.description,
      required: ['op', ...(a.required ?? [])],
      properties: {op: {const: op}, ...a.properties},
      additionalProperties: false,
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

const say = t => ({content: [{type: 'text', text: fit(t)}]});
const refuse = t => ({...say(t), isError: true});
// A tool that throws is answered, never thrown: the agent hears what failed.
const safe = fn => async (args = {}) => {
  try { return await fn(args ?? {}); } catch (e) {
    console.error('[portrayal] agent tool', e);
    return refuse(`That didn't work: ${e?.message ?? e}.`);
  }
};

// `api` is window.portrayalAnnotate. `reach(rect)` is the page's own rule for a
// crop (marks.clampCrop: the rectangle cut to the drawing, or null when it
// misses the drawing); without it a crop goes through as it was sent.
export function annotateTools({api, commands = COMMANDS, reach = rect => rect}) {
  const tool = (name, title, description, properties, required, annotations, run) => ({
    name, title, description, annotations,
    inputSchema: {type: 'object', properties, ...(required.length ? {required} : {}), additionalProperties: false},
    execute: safe(run),
  });
  // The page has laid out its link before a tool runs: a call that comes in at boot waits for it.
  const up = () => api.ready;
  return [
    tool('describe_marks', 'Describe the marked-up drawing',
      'Read the open document: the drawing it is on (device, config, view), whether the legend is on and the crop, then every mark with its id (or row), selector, color, state, label and lamp color, and how many parts it matched the last time the drawing was drawn - "matches nothing" means its selector missed. Call this first; edit_marks addresses a mark by that id or row.',
      {}, [], {readOnlyHint: true, untrustedContentHint: true},
      async () => {
        await up();
        const h = api.history();
        const undo = h.canUndo ? `Undo would take back: ${h.undoSummary}` : 'Nothing to undo.';
        // the undo line comes second, so a long document loses its tail, never this
        const [first, ...rest] = api.describe().split('\n');
        return say([first, undo, ...rest].join('\n'));
      }),
    tool('edit_marks', 'Edit the marks',
      "Apply edits to the open document, in order: all apply or none, as one undo step. mark.add gives a mark an id (m1, m2, ...) unless you send one; name what it creates with as: \"a\", then use \"@a\" as a later mark. The answer repeats describe_marks, so a selector that matches nothing shows at once. The device, config and view are the user's to choose. Send only what changes. dry_run checks without changing anything.",
      editSchema(commands).properties, ['commands'], {readOnlyHint: false},
      async ({commands: cmds, dry_run}) => {
        if (!Array.isArray(cmds) || !cmds.length) return refuse('Send commands: a list of at least one {op, ...}.');
        await up();
        const n = cmds.length;
        // a crop is cut to the drawing, as the page's own drag is
        let missed = -1;
        const sent = cmds.map((c, i) => {
          if (c?.op !== 'crop' || !c.rect || typeof c.rect !== 'object') return c;
          const r = reach(c.rect);
          if (r === null && missed < 0) missed = i;
          return r === null ? c : {...c, rect: r};
        });
        if (missed >= 0) return refuse(`Command ${missed + 1} of ${n} (crop) was refused: that rectangle is outside the drawing. Nothing was changed.`);
        const res = dry_run ? api.preview(sent) : api.apply(sent, {origin: 'agent'});
        if (res.error) return refuse(`Command ${(res.index ?? 0) + 1} of ${n} (${cmds[res.index ?? 0]?.op}) was refused: ${res.error} Nothing was changed.`);
        if (res.noop) return say('Nothing changed: the document already looks like that.');
        const named = Object.entries(res.created ?? {}).filter(([k]) => k !== 'ids').map(([k, id]) => `${k} is ${id}`);
        const head = `${dry_run ? 'Would do' : 'Done'}: ${res.summary}${named.length ? ` (${named.join(', ')})` : ''}`;
        return say(dry_run ? head : `${head}\n${api.describe()}`);
      }),
    tool('undo', 'Undo', 'Take back the last edit to the marks, crop or legend, whoever made it, and say what it was. "Undid your edit" means the step was the user\'s own, made on the page. The drawing itself is not taken back.',
      {}, [], {readOnlyHint: false},
      async () => {
        // The editor says whose step it was on its change event; undo() itself says only what.
        let origin = null;
        const off = api.on('change', e => { origin = e.origin; });
        let s;
        try { s = api.undo(); } finally { off(); }
        if (!s) return say('Nothing to undo.');
        return say(`Undid${origin === 'ui' ? ' your edit' : ''}: ${s.summary}`);
      }),
    tool('redo', 'Redo', 'Put back the last edit Undo took back, and say what it was.', {}, [], {readOnlyHint: false},
      async () => { const s = api.redo(); return say(s ? `Redid: ${s.summary}` : 'Nothing to redo.'); }),
  ];
}
