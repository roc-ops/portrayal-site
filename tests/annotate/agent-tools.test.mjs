// tests/annotate/agent-tools.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {COMMANDS} from '../../site/annotate/commands.js';
import {createMarksEditor} from '../../site/annotate/editor.js';
import {describe} from '../../site/annotate/describe.js';
import {annotateTools, editSchema} from '../../site/annotate/agent-tools.js';
import {LIMIT} from '../../site/rack/agent-text.js';
import {hintText} from '../../site/rack/agent-hint.js';

// window.portrayalAnnotate, as annotate.html builds it, over the real editor.
const setup = ({reach} = {}) => {
  const ed = createMarksEditor({doc: {legend: true, device: 'c100g'}});
  const api = {
    ready: Promise.resolve({}),
    getDoc: () => ed.getDoc(),
    apply: (cmds, opts = {}) => ed.apply(cmds, {origin: opts.origin ?? 'agent'}),
    preview: cmds => ed.preview(cmds),
    undo: () => ed.undo(),
    redo: () => ed.redo(),
    history: () => ({canUndo: ed.canUndo, canRedo: ed.canRedo, undoSummary: ed.undoSummary, redoSummary: ed.redoSummary}),
    describe: () => describe(ed.getDoc(), []),
    on: (type, fn) => ed.on(type, fn),
  };
  const tools = Object.fromEntries(annotateTools({api, ...(reach ? {reach} : {})}).map(t => [t.name, t]));
  const call = async (name, args) => tools[name].execute(args);
  const text = r => r.content[0].text;
  return {ed, api, tools, call, text};
};

test('four tools, each with a title, a description and a closed argument schema', () => {
  const {tools} = setup();
  assert.deepEqual(Object.keys(tools), ['describe_marks', 'edit_marks', 'undo', 'redo']);
  for (const t of Object.values(tools)) {
    assert.ok(t.title && t.description && typeof t.execute === 'function', t.name);
    assert.equal(t.inputSchema.type, 'object');
    assert.equal(t.inputSchema.additionalProperties, false);
  }
  assert.equal(tools.describe_marks.annotations.readOnlyHint, true);
  assert.equal(tools.edit_marks.annotations.readOnlyHint, false);
  assert.deepEqual(tools.edit_marks.inputSchema.required, ['commands']);
});

test('the edit_marks schema has one branch per command in the table', () => {
  const s = editSchema();
  const branches = s.properties.commands.items.oneOf;
  assert.deepEqual(branches.map(b => b.properties.op.const), Object.keys(COMMANDS));
  for (const b of branches) {
    const def = COMMANDS[b.properties.op.const];
    assert.equal(b.required[0], 'op');
    for (const r of def.args.required ?? []) assert.ok(b.required.includes(r), `${b.properties.op.const} requires ${r}`);
    assert.equal(b.additionalProperties, false);
  }
  assert.equal(s.properties.commands.maxItems, 50);
  const more = {...COMMANDS, 'mark.flash': {run: () => ({}), description: 'Flash a mark.', args: {type: 'object', required: ['mark'], properties: {mark: {type: 'string'}}}}};
  assert.ok(editSchema(more).properties.commands.items.oneOf.some(b => b.properties.op.const === 'mark.flash'));
});

test('edit_marks adds a mark, names it, and answers with what describe_marks would say', async () => {
  const {ed, call, text} = setup();
  const r = await call('edit_marks', {commands: [{op: 'mark.add', select: "[data-path='psu-0']", color: '#ff2d95', as: 'psu'}]});
  assert.equal(r.isError, undefined);
  assert.match(text(r), /^Done: Added mark m1 on \[data-path='psu-0'\]\. \(psu is m1\)\n/);
  assert.match(text(r), /m1 \[data-path='psu-0'\], color #ff2d95: not drawn yet/);
  assert.equal(ed.getDoc().marks.length, 1);
});

test('an edit made through the tool is an agent step, in one undo step per call', async () => {
  const {ed, call} = setup();
  const seen = [];
  ed.on('change', e => seen.push(e.origin));
  await call('edit_marks', {commands: [{op: 'mark.add', select: '.a'}, {op: 'mark.add', select: '.b'}]});
  assert.deepEqual(seen, ['agent']);
  assert.equal(ed.getDoc().marks.length, 2);
  assert.match(ed.undoSummary, /Added mark m1/);
});

test('a refused batch changes nothing, names the command and says why', async () => {
  const {ed, call, text} = setup();
  const before = ed.getDoc();
  const r = await call('edit_marks', {commands: [{op: 'mark.add', select: '.a'}, {op: 'mark.remove', mark: 'nope'}]});
  assert.equal(r.isError, true);
  assert.equal(text(r), 'Command 2 of 2 (mark.remove) was refused: There is no mark nope. Nothing was changed.');
  assert.equal(ed.getDoc(), before);
  const bad = await call('edit_marks', {commands: [{op: 'mark.add'}]});
  assert.match(text(bad), /^Command 1 of 1 \(mark\.add\) was refused: mark\.add needs select, some text\. Nothing was changed\.$/);
  assert.equal((await call('edit_marks', {commands: []})).isError, true);
  assert.equal((await call('edit_marks', {})).isError, true);
});

test('edit_marks says when nothing changed, and dry_run changes nothing', async () => {
  const {ed, call, text} = setup();
  assert.equal(text(await call('edit_marks', {commands: [{op: 'marks.clear'}]})), 'Nothing changed: the document already looks like that.');
  const r = await call('edit_marks', {commands: [{op: 'mark.add', select: '.a'}], dry_run: true});
  assert.equal(text(r), 'Would do: Added mark m1 on .a.');
  assert.equal(ed.getDoc().marks.length, 0);
  assert.equal(ed.canUndo, false);
});

test('undo and redo take back and put back, and say whose step it was', async () => {
  const {ed, call, text} = setup();
  assert.equal(text(await call('undo', {})), 'Nothing to undo.');
  assert.equal(text(await call('redo', {})), 'Nothing to redo.');
  await call('edit_marks', {commands: [{op: 'mark.add', select: '.a'}]});
  assert.equal(text(await call('undo', {})), 'Undid: Added mark m1 on .a.');
  assert.equal(ed.getDoc().marks.length, 0);
  assert.equal(text(await call('redo', {})), 'Redid: Added mark m1 on .a.');
  assert.equal(ed.getDoc().marks.length, 1);
  // a step the page's own controls made is "your edit"
  ed.apply({op: 'mark.add', select: '.b'}, {origin: 'ui'});
  assert.equal(text(await call('undo', {})), 'Undid your edit: Added mark m2 on .b.');
});

test('undo keeps the drawing the user is on', async () => {
  const {ed, call} = setup();
  await call('edit_marks', {commands: [{op: 'mark.add', select: '.a'}]});
  ed.retarget({device: 's9510-28dc', config: 'dc', view: 'front'});
  await call('undo', {});
  assert.equal(ed.getDoc().device, 's9510-28dc');
  assert.equal(ed.getDoc().marks.length, 0);
});

test('describe_marks reads the document, and what undo would take back, within the bound', async () => {
  const {call, text} = setup();
  assert.match(text(await call('describe_marks', {})), /^c100g\. Legend on; not cropped\.\nNothing to undo\.\nNo marks\.$/);
  await call('edit_marks', {commands: [{op: 'mark.add', select: '.a', label: 'x'.repeat(3000)}]});
  const out = text(await call('describe_marks', {}));
  assert.ok(out.length <= LIMIT);
  assert.match(out, /Undo would take back: Added mark m1/);
});

test('a crop is cut to the drawing by the page, and refused when it misses it', async () => {
  const {ed, call, text} = setup({reach: r => (r.x > 1000 ? null : {...r, w: Math.min(r.w, 50)})});
  await call('edit_marks', {commands: [{op: 'crop', rect: {x: 0, y: 0, w: 90, h: 10}}]});
  assert.deepEqual(ed.getDoc().crop, {x: 0, y: 0, w: 50, h: 10});
  const r = await call('edit_marks', {commands: [{op: 'crop', rect: {x: 2000, y: 0, w: 5, h: 5}}]});
  assert.equal(text(r), 'Command 1 of 1 (crop) was refused: that rectangle is outside the drawing. Nothing was changed.');
  assert.deepEqual(ed.getDoc().crop, {x: 0, y: 0, w: 50, h: 10});
  await call('edit_marks', {commands: [{op: 'crop', rect: null}]});
  assert.equal(ed.getDoc().crop, null);
});

test('a tool waits for the page to be ready, and a throw is answered, not thrown', async () => {
  const {api, tools, text} = setup();
  let open;
  api.ready = new Promise(r => { open = r; });
  let done = false;
  const p = tools.describe_marks.execute({}).then(r => { done = true; return r; });
  await new Promise(r => setTimeout(r, 10));
  assert.equal(done, false);
  open({});
  assert.match(text(await p), /^c100g\./);
  api.describe = () => { throw new Error('boom'); };
  const r = await tools.describe_marks.execute({});
  assert.equal(r.isError, true);
  assert.equal(text(r), "That didn't work: boom.");
});

test('annotate.html carries the hint block the tools are named in, as written for an unconnected page', () => {
  const html = readFileSync(new URL('../../annotate.html', import.meta.url), 'utf8');
  assert.match(html, /<body class="tool" aria-describedby="webmcp-hint-text">\n<p class="rk-vh" id="webmcp-hint-text">/);
  const p = /<p class="rk-vh" id="webmcp-hint-text">([^<]*)<\/p>/.exec(html)[1].replaceAll('&quot;', '"');
  assert.equal(p, hintText([], {start: 'describe_marks', bar: 'the marks panel'}));
  const j = JSON.parse(/<script type="application\/json" id="webmcp-hint">([\s\S]*?)<\/script>/.exec(html)[1]);
  assert.deepEqual([j.webmcp, j.registered, j.tools], [true, false, []]);
  assert.match(j.howTo, /t\.name === 'describe_marks'/);
  assert.match(html, /<meta http-equiv="origin-trial" content="[^"]+">/);
});
