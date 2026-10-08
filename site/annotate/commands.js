// site/annotate/commands.js
// ANNOTATE'S COMMANDS (spec docs/superpowers/specs/2026-10-08-annotate-command-api-design.md).
// Every edit of a marked-up drawing is one of these, run through apply(): the
// page's own controls and an agent alike. Pure - a normalised document and the
// arguments in, a new document out - and a command that changes nothing hands
// back the very document it was given. The device, configuration, view, swaps
// and fields are the shell's to change, not these commands' (editor.js).

import {validate, same} from '../rack/validate.js';

// kit/marks.js keeps this private; the schema states the same rule.
const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const BLANK = {id: '', select: '', color: '', state: '', label: '', lamp: ''};
const pathSel = path => `[data-path='${path}']`;
const says = m => !!(m.state || m.color || m.label || m.lamp);
const nameOf = m => m.id || m.select;
const done = (doc, summary, extra = {}) => ({doc, summary, findings: [], ...extra});
const unchanged = doc => done(doc, '');
const withMarks = (doc, marks) => ({...doc, marks});
const badHex = hex => `${hex} is not a hex color like #ff8800.`;

export const MARK_GONE = mark => (Number.isInteger(mark) ? `There is no mark at row ${mark}.` : `There is no mark ${mark}.`);

// A MARK IS NAMED BY ITS ROW, ITS ID, OR THE SELECTOR OF A MARK THAT HAS NO ID.
// Rows are how the page's own list addresses them; ids are what an agent keeps;
// a bare selector is the last resort, and refused when it is not one mark.
function find(doc, mark) {
  if (Number.isInteger(mark)) return mark >= 0 && mark < doc.marks.length ? {i: mark} : {error: MARK_GONE(mark)};
  const byId = doc.marks.findIndex(m => m.id && m.id === mark);
  if (byId >= 0) return {i: byId};
  const hits = doc.marks.flatMap((m, i) => (!m.id && m.select === mark ? [i] : []));
  if (hits.length > 1) return {error: `Two marks select ${mark}; give one an id first (mark.update with id).`};
  return hits.length ? {i: hits[0]} : {error: MARK_GONE(mark)};
}

const idInUse = (doc, id, except = -1) => doc.marks.some((m, i) => i !== except && m.id === id);
// The next m<n> past every one in use, so an id is never handed out twice.
const nextId = marks => `m${Math.max(0, ...marks.map(m => /^m(\d+)$/.exec(m.id)?.[1]).filter(Boolean).map(Number)) + 1}`;

function markAdd(doc, {select, color = '', state = '', label = '', lamp = '', id}) {
  if (!String(select).trim()) return {error: 'A mark needs a selector.'};
  if (lamp && !HEX_RE.test(lamp)) return {error: badHex(lamp)};
  if (id != null && idInUse(doc, id)) return {error: `There is already a mark ${id}.`};
  const mid = id ?? nextId(doc.marks);
  const mark = {...BLANK, id: mid, select, color, state, label, lamp: lamp.toLowerCase()};
  return done(withMarks(doc, [...doc.marks, mark]), `Added mark ${mid} on ${select}.`, {created: {id: mid}});
}

function markUpdate(doc, {mark, ...p}) {
  const f = find(doc, mark);
  if (f.error) return f;
  const cur = doc.marks[f.i];
  if (p.id != null && idInUse(doc, p.id, f.i)) return {error: `There is already a mark ${p.id}.`};
  if (p.lamp && !HEX_RE.test(p.lamp)) return {error: badHex(p.lamp)};
  const want = 'lamp' in p ? {...p, lamp: p.lamp.toLowerCase()} : p;
  const changes = Object.fromEntries(Object.entries(want).filter(([k, v]) => !same(v, cur[k])));
  if (!Object.keys(changes).length) return unchanged(doc);
  return done(withMarks(doc, doc.marks.map((m, i) => (i === f.i ? {...m, ...changes} : m))), `Changed mark ${nameOf(cur)}.`);
}

function markRemove(doc, {mark}) {
  const f = find(doc, mark);
  if (f.error) return f;
  return done(withMarks(doc, doc.marks.filter((_, i) => i !== f.i)), `Removed mark ${nameOf(doc.marks[f.i])}.`);
}

function markMove(doc, {mark, to}) {
  const f = find(doc, mark);
  if (f.error) return f;
  if (to >= doc.marks.length) return {error: `There is no row ${to}; the list has ${doc.marks.length} marks.`};
  if (to === f.i) return unchanged(doc);
  const list = doc.marks.filter((_, i) => i !== f.i);
  list.splice(to, 0, doc.marks[f.i]);
  return done(withMarks(doc, list), `Moved mark ${nameOf(doc.marks[f.i])} to row ${to}.`);
}

function marksClear(doc) {
  const n = doc.marks.length;
  return n ? done(withMarks(doc, []), `Cleared ${n} mark${n === 1 ? '' : 's'}.`) : unchanged(doc);
}

// THE TREE'S CHIP AND SWATCH, as the page has always done them: a statement
// about one part, on the mark that selects it by path, which is made when it is
// needed and goes when it is left saying nothing.
function replaceOrDrop(doc, i, next) {
  return withMarks(doc, says(next) ? doc.marks.map((m, k) => (k === i ? next : m)) : doc.marks.filter((_, k) => k !== i));
}

function lampState(doc, {path, state}) {
  const select = pathSel(path);
  const i = doc.marks.findIndex(m => m.select === select);
  if (i < 0) {
    if (!state) return unchanged(doc);
    const r = markAdd(doc, {select, state});
    return {...r, summary: `Set ${path} to ${state}.`};
  }
  // A mark that already says nothing goes too, as the page's chip has always
  // done: the test is on what is left, not on whether anything changed.
  const m = doc.marks[i], next = {...m, state: m.state === state ? '' : state};
  if (same(next, m) && says(m)) return unchanged(doc);
  return done(replaceOrDrop(doc, i, next), next.state ? `Set ${path} to ${state}.` : `Cleared the state on ${path}.`);
}

function lampColor(doc, {path, hex}) {
  if (hex != null && !HEX_RE.test(hex)) return {error: badHex(hex)};
  const select = pathSel(path);
  const i = doc.marks.findIndex(m => m.select === select);
  if (hex == null) {
    if (i < 0 || (!doc.marks[i].lamp && says(doc.marks[i]))) return unchanged(doc);
    return done(replaceOrDrop(doc, i, {...doc.marks[i], lamp: ''}), `Cleared the lamp color on ${path}.`);
  }
  const lamp = hex.toLowerCase();
  if (i < 0) {
    const r = markAdd(doc, {select, lamp});
    return {...r, summary: `Colored ${path} ${lamp}.`};
  }
  const m = doc.marks[i];
  const next = {...m, lamp, state: m.state === 'off' ? '' : m.state};
  return same(next, m) ? unchanged(doc) : done(replaceOrDrop(doc, i, next), `Colored ${path} ${lamp}.`);
}

function crop(doc, {rect}) {
  if (same(rect ?? null, doc.crop)) return unchanged(doc);
  return done({...doc, crop: rect ?? null}, rect ? `Cropped to ${rect.w} x ${rect.h} mm.` : 'Removed the crop.');
}

function legend(doc, {on}) {
  if (same(on, doc.legend)) return unchanged(doc);
  return done({...doc, legend: on}, on ? 'Turned the legend on.' : 'Turned the legend off.');
}

// ── the table an agent reads ────────────────────────────────────────────
const MARK = {type: ['integer', 'string'], minimum: 0,
  description: 'The mark: its row (from 0, as describe() lists it), its id, or the selector of a mark with no id.'};
const AS = {type: 'string', minLength: 1, description: 'A name for the mark this adds; later commands in the same batch can use "@name".'};
const FIELDS = {
  select: {type: 'string', description: "A CSS selector over the drawing, e.g. [data-path='psu-0'] or .led."},
  color: {type: 'string', description: 'Ink: a ring drawn around what it selects, as a CSS colour; "" for none.'},
  state: {type: 'string', description: "A lamp state the selected parts show, from their own vocabulary (e.g. on, off, amber); \"\" for none."},
  label: {type: 'string', description: 'Text for the legend; "" for none.'},
  lamp: {type: 'string', description: 'The colour the lamp itself shows, as hex like #00ff00; "" for however the drawing paints it.'},
  id: {type: 'string', minLength: 1, description: 'A name for the mark, so later commands can address it.'},
};
const PATH = {type: 'string', minLength: 1, description: "A part's path in the drawing, as the tree lists it (e.g. psu-0 or port-4)."};
const args = (required, properties) => ({type: 'object', required, additionalProperties: false, properties});

export const COMMANDS = {
  'mark.add': {run: markAdd, description: 'Add a mark: a statement about the parts a CSS selector matches - ink around them, a lamp state, a label, or the colour the lamp shows. Gets an id (m1, m2, ...) unless one is given.',
    args: args(['select'], {...FIELDS, as: AS})},
  'mark.update': {run: markUpdate, description: "Change a mark's selector, ink, state, label, lamp colour, or give it an id.",
    args: args(['mark'], {mark: MARK, ...FIELDS})},
  'mark.remove': {run: markRemove, description: 'Remove a mark.', args: args(['mark'], {mark: MARK})},
  'mark.move': {run: markMove, description: 'Move a mark to another row; later marks draw over earlier ones.',
    args: args(['mark', 'to'], {mark: MARK, to: {type: 'integer', minimum: 0, description: 'The row it moves to, from 0.'}})},
  'marks.clear': {run: marksClear, description: 'Remove every mark.', args: args([], {})},
  'lamp.state': {run: lampState, description: "Set a part's lamp state, as the tree's state chips do: setting the state it already shows clears it.",
    args: args(['path', 'state'], {path: PATH, state: {type: 'string', description: 'The state, from the part\'s own vocabulary; "" clears it.'}})},
  'lamp.color': {run: lampColor, description: "Say what colour a part's lamp shows, as the tree's swatch does, or clear it with null.",
    args: args(['path', 'hex'], {path: PATH, hex: {type: ['string', 'null'], description: 'The colour as hex like #00ff00, or null to clear it.'}})},
  crop: {run: crop, description: 'Crop the drawing to a rectangle, in millimetres of its own drawing, or remove the crop with null.',
    args: args(['rect'], {rect: {type: ['object', 'null'], required: ['x', 'y', 'w', 'h'], additionalProperties: false,
      description: 'The rectangle {x, y, w, h} in millimetres, or null.',
      properties: {x: {type: 'number', description: 'Left edge.'}, y: {type: 'number', description: 'Top edge.'},
                   w: {type: 'number', exclusiveMinimum: 0, description: 'Width, above 0.'},
                   h: {type: 'number', exclusiveMinimum: 0, description: 'Height, above 0.'}}}})},
  legend: {run: legend, description: 'Show or hide the legend strip.',
    args: args(['on'], {on: {type: ['boolean', 'object'], description: 'true or false; an object is a legend with options.'}})},
};

// ── apply ───────────────────────────────────────────────────────────────
// The same contract as the rack core's apply(): a batch in order, all of it or
// none of it, refusals as sentences. (Its sentence-building is the rack's own,
// not exported from the kit yet, so it is repeated here; a follow-up that moves
// validate.js and history.js out of kit/rack/ can take this with them.)
const typeWord = s => {
  if (s.enum) return `one of ${s.enum.join(', ')}`;
  const ts = [].concat(s.type ?? []);
  const t = ts.find(x => x !== 'null');
  const word = {integer: `a whole number${s.minimum != null ? ` from ${s.minimum}` : ''}`,
                number: `a number${s.exclusiveMinimum === 0 ? ' above 0' : ''}`, string: 'some text',
                boolean: 'true or false', object: 'an object', array: 'a list'}[t] || 'a value';
  return ts.length > 1 && !ts.includes('null') ? `${word} or ${ts.filter(x => x !== t).map(x => ({string: 'some text', object: 'an object'})[x] ?? x).join(', ')}` : word;
};
function sentence(op, e) {
  if (e.keyword === 'required') return `${op} needs ${[...e.path, e.missing].join('.')}, ${typeWord(e.schema.properties?.[e.missing] || {})}.`;
  if (e.keyword === 'additionalProperties') return `${op} does not take ${e.path.join('.')}.`;
  return `${op} needs ${e.path.join('.')}, ${typeWord(e.schema)}.`;
}

export function apply(doc, cmds) {
  const list = Array.isArray(cmds) ? cmds : [cmds];
  const seen = new Set();
  for (const [index, c] of list.entries()) {
    if (c?.as == null) continue;
    if (seen.has(c.as)) return {error: `Two commands in this batch are called ${c.as}.`, index};
    seen.add(c.as);
  }
  const bound = new Map(), created = {}, ids = [], summaries = [], findings = [];
  let cur = doc;
  for (const [index, raw] of list.entries()) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || typeof raw.op !== 'string')
      return {error: 'A command is an object with an op.', index};
    const def = Object.hasOwn(COMMANDS, raw.op) ? COMMANDS[raw.op] : null;
    if (!def) return {error: `There is no command called '${raw.op}'.`, index};
    const {op, ...given} = raw;
    const bad = validate(def.args, given)[0];
    if (bad) return {error: sentence(op, bad), index};
    // Only the `mark` position is a name: a label that reads "@a" is a label.
    if (typeof given.mark === 'string' && given.mark.startsWith('@')) {
      const n = given.mark.slice(1);
      if (!bound.has(n)) return {error: `Nothing earlier in this batch is called ${n}.`, index};
      given.mark = bound.get(n);
    }
    const {as, ...a} = given;
    const res = def.run(cur, a);
    if (res.error) return {error: res.error, index};
    if (res.doc !== cur && res.summary) summaries.push(res.summary);
    findings.push(...res.findings);
    if (res.created) {
      ids.push(res.created.id);
      if (as != null) { bound.set(as, res.created.id); created[as] = res.created.id; }
    }
    cur = res.doc;
  }
  return {doc: cur, summary: summaries.join(' '), findings, created: {...created, ids}, noop: cur === doc, step: cur !== doc};
}
