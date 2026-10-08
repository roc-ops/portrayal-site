# Annotate Command API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Annotate's document gets the Rack Builder's command layer. That means named, pure, validated commands through one `apply`, undo/redo, change events, a live `getDoc`/`setDoc` (including pasted share links), and `window.portrayalAnnotate` for agents. The marks document also gets a JSON Schema, published upstream.

**Architecture:** Three new pure site modules: `site/annotate/commands.js` (commands, `COMMANDS`, `apply`), `site/annotate/describe.js` (an agent-sized reading of the document and the last render's report) and `site/annotate/editor.js` (document + history + events). They reuse the rack core's generic `history.js` and `validate.js` from `vendor/rack/`. `annotate.html` stops mutating `doc` in place: every edit goes through `edit(cmd)`, and the editor's change listener redraws and writes the hash. The schema is a separate upstream PR to roc-ops/Portrayal.

**Tech Stack:** Plain ES modules, no build step, no new dependencies. Site: `node --test tests/*/*.test.mjs`, `python3 check-contract.py`, `python3 check-browser.py`. Upstream: `python3 -m pytest spec/tests`, node scripts under `spec/tests/js/`, `jsonschema` (already an upstream test dependency).

**Spec:** `docs/superpowers/specs/2026-10-08-annotate-command-api-design.md`

## Global Constraints

- **Sequencing.** Task 1 (upstream) can start at once. Tasks 2-4 import `vendor/rack/history.js` and `vendor/rack/validate.js`, so they **start only once the rack kit move's site half has landed on `origin/main`**, meaning `vendor/rack/validate.js` exists there. The 0RU session ("0RU device support and cable management") messages the Refactor agent when it lands. Rebase `claude/annotate-command-api` onto `origin/main` first.
- **Pure means pure.** `site/annotate/commands.js`, `describe.js` and `editor.js` have no DOM, no `fetch` and no `localStorage`. They import only `../../vendor/marks.js` (for `normalise`), `../../vendor/rack/validate.js`, `../../vendor/rack/history.js` and each other.
- **Spelling.** Comments in `site/annotate/*.js` use British spelling (they become kit code later). Page copy, refusal sentences, tests, checks and commit messages use American spelling. Upstream (roc-ops/Portrayal) is British throughout: its schema descriptions, tests, changelog and PR.
- **Sentences.** Every refusal is a plain-English sentence. `lamp.state`'s and `lamp.color`'s effects match today's `setState`, `setLamp` and `clearLamp` in `annotate.html` exactly.
- **No new dependencies.**
- **Comment style.** Match the surrounding files: a SHOUTED lead phrase for a rule, prose saying why, no JSDoc.
- **Site commits** end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. **Upstream commits** are signed off (`git commit -s`, giving `Signed-off-by: Jason Patterson <...>` as upstream's history has) and carry the same Co-Authored-By line.
- **Never `git push --no-verify`.** At high load, push with `nohup sh ~/.claude/merge-agent/portrayal-site/when-calm.sh git push -u origin <branch> &` as a background task. Site PRs go to the "Portrayal-site merge agent". Upstream PRs follow upstream's own process, and you do not merge them.
- **Upstream work** happens in a new worktree of `/Volumes/External/Network-Device-Visualization` (`git -C /Volumes/External/Network-Device-Visualization worktree add ../Network-Device-Visualization/.claude/worktrees/marks-schema -b claude/marks-schema origin/main`). Never edit the live checkout there.

## Review Focus

1. **Focus loss while typing.** The row inputs send `mark.update` on every keystroke. If the change listener rebuilds the rows, the input the user is typing in is replaced. Expected: typing keeps focus and caret, exactly as today's `schedule()` path does. Pinned in Task 4: the browser check types into a row and asserts the same element still has focus.
2. **A typing burst is one undo step.** Ten keystrokes in one label make one Undo that restores the label from before the burst. Pinned in Task 3 (editor `merge`) and Task 4 (browser).
3. **Undo after a device switch.** Add a mark, switch the device in the shell's picker, then Undo. The mark goes, and the shell and `doc.device` still name the new device. Pinned in Task 3.
4. **A pasted share link into an open tab** restores that document, and the page's own `replaceState` hash writes do not loop into `loadDoc`. Pinned in Task 4.
5. **Two id-less marks with one selector**, made by editing a row's selector. Rows are addressed by index, so the page's own edits still work. An agent addressing that selector is refused with the sentence. Pinned in Task 2.

---

## File structure

| File | Responsibility |
|---|---|
| Upstream `spec/schemas/marks.schema.json` (new) | The marks document schema |
| Upstream `spec/tests/js/marks-schema.mjs` (new) | Prints `normalise()` of a set of documents as JSON |
| Upstream `spec/tests/test_marks_schema_js.py` (new) | Validates those outputs against the schema |
| Upstream `changelog.d/marks-schema.md` (new) | The changelog fragment |
| `site/annotate/commands.js` (new) | The commands, `COMMANDS`, `apply` |
| `site/annotate/describe.js` (new) | `describe(doc, report)` |
| `site/annotate/editor.js` (new) | `createMarksEditor` |
| `annotate.html` (modify) | Edits through `edit()`, `loadDoc`, `hashchange`, Undo/Redo, `window.portrayalAnnotate` |
| `tests/annotate/*.test.mjs` (new) | `commands`, `apply`, `describe`, `editor`, `commands-table`, `one-way-in` |
| `check-browser.py` (modify) | `check_annotate_api`, registered with `@extra` |

---

### Task 1: The marks schema, upstream

**Files (in the upstream worktree):**
- Create: `spec/schemas/marks.schema.json`, `spec/tests/js/marks-schema.mjs`, `spec/tests/test_marks_schema_js.py`, `changelog.d/marks-schema.md`

**Interfaces:**
- Produces: `spec/schemas/marks.schema.json` with `$id` `https://portrayal.dev/schemas/v1/marks.schema.json`, describing exactly what `kit/marks.js` `normalise()` returns.

- [ ] **Step 1: Make the worktree and read upstream's rules**

```bash
git -C /Volumes/External/Network-Device-Visualization fetch -q origin
git -C /Volumes/External/Network-Device-Visualization worktree add .claude/worktrees/marks-schema -b claude/marks-schema origin/main
```

Read `CONTRIBUTING.md` §"The changelog entry" and `changelog.d/README.md`, and one existing `spec/tests/test_*_js.py` with its `spec/tests/js/*.mjs` (e.g. `test_accept_swaps_js.py` and `js/accept-swaps.mjs`). Copy their shape. Read `spec/tests/test_schema_hygiene.py`: it sweeps every `spec/schemas/*.schema.json`, so the new file must pass it too.

- [ ] **Step 2: Write the node script**

```js
// spec/tests/js/marks-schema.mjs
// normalise() over documents that reach every branch of it, printed as one JSON
// line for test_marks_schema_js.py to validate against marks.schema.json.
import {normalise} from '../../../kit/marks.js';

const cases = {
  empty: {},
  minimal: {v: 1, device: 'as7946-30xb', marks: [{select: '#psu-0'}]},
  full: {v: 1, device: 'as7946-30xb', config: 'dc', view: 'rear', legend: {title: 'PSUs'},
         crop: {x: 1.5, y: 2, w: 30, h: 12},
         marks: [{id: 'm1', select: "[data-path='psu-0']", color: '#ff2d95', state: 'on', label: 'PSU 0', lamp: '#00FF00'},
                 {select: '.led', state: 'off'}],
         swaps: {'port-4': 'generic/qsfp-lc@1', 'slot-1': null},
         fields: {'port-4-occupant': {'latch-color': 'red', label: null}}},
  junk: {v: 9, legend: false, crop: {x: 0, y: 0, w: -1, h: 2}, marks: [null, 'x', {select: 3, lamp: 'red'}],
         swaps: [], fields: {'__proto__': {a: 'b'}, p: 'not an object'}},
};
console.log(JSON.stringify(Object.fromEntries(Object.entries(cases).map(([k, d]) => [k, normalise(d)]))));
```

Run: `node spec/tests/js/marks-schema.mjs | head -c 400`
Expected: one JSON line with keys `empty`, `minimal`, `full`, `junk`.

- [ ] **Step 3: Write the failing test**

```python
# spec/tests/test_marks_schema_js.py
"""The marks document has a schema, and normalise() writes nothing it refuses.

kit/marks.js defines the document an annotated drawing is - selectors, ink,
lamp states, swaps and fields - and was written so that an MCP client could
send one. A client cannot be told what to send by a function body. The schema
is that statement; this test keeps it and normalise() from drifting apart, in
the direction that matters: whatever normalise() returns is a valid document.
"""
import json
import pathlib
import shutil
import subprocess

import jsonschema
import pytest

ROOT = pathlib.Path(__file__).resolve().parents[2]
SCHEMA = json.loads((ROOT / "spec/schemas/marks.schema.json").read_text())
SCRIPT = ROOT / "spec/tests/js/marks-schema.mjs"


@pytest.fixture(scope="module")
def out():
    if shutil.which("node") is None:
        pytest.skip("node not installed")
    p = subprocess.run(["node", str(SCRIPT)], capture_output=True, text=True, cwd=str(ROOT))
    assert p.returncode == 0, p.stderr
    return json.loads(p.stdout.strip().splitlines()[-1])


@pytest.mark.parametrize("case", ["empty", "minimal", "full", "junk"])
def test_normalise_writes_valid_documents(out, case):
    jsonschema.validate(out[case], SCHEMA)


def test_the_schema_refuses_what_normalise_never_writes():
    bad = {"v": 2, "device": "", "config": "", "view": "", "legend": True, "crop": None,
           "marks": [{"select": "#a", "color": "", "state": "", "label": "", "lamp": "red"}],
           "swaps": {}, "fields": {}}
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(bad, SCHEMA)
```

Run: `python3 -m pytest spec/tests/test_marks_schema_js.py -q`
Expected: FAIL. `FileNotFoundError` for `marks.schema.json`.

- [ ] **Step 4: Write the schema**

Write `spec/schemas/marks.schema.json`. Match the house style of `spec/schemas/lab.schema.json` (one-space indent, `$schema`, `$id`, `title`, a `description` on every property). Content:

```json
{
 "$schema": "https://json-schema.org/draft/2020-12/schema",
 "$id": "https://portrayal.dev/schemas/v1/marks.schema.json",
 "title": "Portrayal marked-up drawing (v1)",
 "description": "An annotated drawing as one document of CSS selectors over a compiled face: what kit/marks.js normalise() returns, encode() carries in a URL and apply() draws.",
 "type": "object",
 "required": ["v", "device", "config", "view", "legend", "crop", "marks", "swaps", "fields"],
 "additionalProperties": false,
 "properties": {
  "v": {"const": 1, "description": "The document version."},
  "device": {"type": "string", "description": "The device the selectors are written against, by its library name; empty for none."},
  "config": {"type": "string", "description": "The configuration of that device; empty for its default."},
  "view": {"type": "string", "description": "Which face: front, rear, or another view the device has; empty for its default."},
  "legend": {"type": ["boolean", "object"], "description": "Whether a legend strip is drawn. An object is a legend with options and reads as true."},
  "crop": {"oneOf": [{"type": "null"}, {"$ref": "#/$defs/rect"}], "description": "A region of the face, in millimetres of its drawing, or null for the whole face."},
  "marks": {"type": "array", "items": {"$ref": "#/$defs/mark"}, "description": "The marks, in drawing order."},
  "swaps": {"type": "object", "additionalProperties": {"type": ["string", "null"]},
            "description": "What the reader seated before marking up: bay or cage path to component ref, null for one emptied. Only what differs from the configuration's build."},
  "fields": {"type": "object", "additionalProperties": {"type": "object", "additionalProperties": {"type": ["string", "null"]}},
             "description": "What the reader wrote on parts: part path to {field: value}, null for a value cleared."}
 },
 "$defs": {
  "rect": {"type": "object", "required": ["x", "y", "w", "h"], "additionalProperties": false,
           "description": "A rectangle in millimetres of the face's drawing.",
           "properties": {"x": {"type": "number", "description": "Left edge."}, "y": {"type": "number", "description": "Top edge."},
                          "w": {"type": "number", "exclusiveMinimum": 0, "description": "Width, above 0."},
                          "h": {"type": "number", "exclusiveMinimum": 0, "description": "Height, above 0."}}},
  "mark": {"type": "object", "required": ["id", "select", "color", "state", "label", "lamp"], "additionalProperties": false,
           "description": "One statement about the parts a selector matches.",
           "properties": {
            "id": {"type": "string", "description": "A name for the mark, kept as given; empty when it has none."},
            "select": {"type": "string", "description": "A CSS selector over the compiled drawing, e.g. [data-path='psu-0']."},
            "color": {"type": "string", "description": "Ink: a ring drawn around the matched parts, as a CSS colour; empty for none."},
            "state": {"type": "string", "description": "A lamp state the matched parts show, from their contract's vocabulary; empty for none."},
            "label": {"type": "string", "description": "Text for the legend; empty for none."},
            "lamp": {"type": "string", "pattern": "^(#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8}))?$",
                     "description": "The colour the lamp itself shows, as lower-case hex; empty for however the drawing paints it."}}}
 }
}
```

Before keeping the `oneOf` on `crop`, check that every keyword used is one the site's schema page renders (`site/schema.js` `KNOWN` in portrayal-site: `oneOf`, `$ref`, `pattern`, `exclusiveMinimum` and `additionalProperties` are all in it). Check that `test_schema_hygiene.py` passes.

- [ ] **Step 5: Run the tests**

Run: `python3 -m pytest spec/tests/test_marks_schema_js.py spec/tests/test_schema_hygiene.py -q`
Expected: PASS. If a `normalise` output fails validation, fix the schema to what `normalise` actually writes, never the other way round.

- [ ] **Step 6: The changelog fragment**

Write `changelog.d/marks-schema.md` in the form `changelog.d/README.md` gives. One entry: a JSON Schema for the marked-up drawing document (`spec/schemas/marks.schema.json`), which `normalise()` is tested against. Run `python3 spec/tools/portrayal/changelog.py --check`.
Expected: no problems.

- [ ] **Step 7: Commit, push, open the PR**

```bash
git add spec/schemas/marks.schema.json spec/tests/js/marks-schema.mjs spec/tests/test_marks_schema_js.py changelog.d/marks-schema.md
git commit -s -m "marks: a JSON Schema for the marked-up drawing, and normalise() tested against it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin claude/marks-schema
```

Open the PR to roc-ops/Portrayal with `gh pr create`. If `.claude/skills/portrayal-pr/SKILL.md` exists in the worktree, follow it for the body (it includes the merge-danger line). Otherwise:
- what the schema is;
- why: agents and other clients sending marks documents;
- that the site will publish it on its schema page after the next sync;
- the tests run;
- the line `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

Do not merge it.

---

### Task 2: The commands

**Files:**
- Create: `site/annotate/commands.js`, `site/annotate/describe.js`
- Test: `tests/annotate/commands.test.mjs`, `tests/annotate/apply.test.mjs`, `tests/annotate/describe.test.mjs`, `tests/annotate/commands-table.test.mjs`

**Interfaces:**
- Consumes: `normalise` from `vendor/marks.js`; `validate`, `same` from `vendor/rack/validate.js`.
- Produces:
  - `COMMANDS: {[op]: {description, args, run(doc, args) -> {doc, summary, findings, created?} | {error}}}`
  - `apply(doc, cmds) -> {doc, summary, findings, created: {[name]: id, ids}, noop, step} | {error, index}`
  - `MARK_GONE(mark) -> string`
  - `describe(doc, report) -> string`, where `report` is `marks.apply()`'s return: `[{index, select, count, total, error, warning}]`

- [ ] **Step 1: Write the failing command tests**

```js
// tests/annotate/commands.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {normalise} from '../../vendor/marks.js';
import {COMMANDS, MARK_GONE} from '../../site/annotate/commands.js';

const run = (op, doc, args = {}) => COMMANDS[op].run(doc, args);
const doc = (marks = []) => normalise({device: 'd', marks});
const P = "[data-path='psu-0']";

test('mark.add gives the next free id, and refuses what it cannot keep', () => {
  const d = doc([{id: 'm4', select: '#a'}, {select: '#b'}]);
  const r = run('mark.add', d, {select: '#c', color: '#ff2d95'});
  assert.deepEqual(r.doc.marks[2], {id: 'm5', select: '#c', color: '#ff2d95', state: '', label: '', lamp: ''});
  assert.deepEqual([r.created, r.summary], [{id: 'm5'}, 'Added mark m5 on #c.']);
  assert.deepEqual(run('mark.add', d, {select: '  '}), {error: 'A mark needs a selector.'});
  assert.deepEqual(run('mark.add', d, {select: '#c', id: 'm4'}), {error: 'There is already a mark m4.'});
  assert.deepEqual(run('mark.add', d, {select: '#c', lamp: 'red'}), {error: 'red is not a hex color like #ff8800.'});
  assert.equal(run('mark.add', d, {select: '#c', lamp: '#00FF00'}).doc.marks[2].lamp, '#00ff00');
});

test('a mark is addressed by index, then id, then the select of an id-less mark', () => {
  const d = doc([{id: 'm1', select: '#a'}, {select: '#b'}, {select: '#dup'}, {select: '#dup'}]);
  assert.equal(run('mark.update', d, {mark: 1, label: 'x'}).doc.marks[1].label, 'x');
  assert.equal(run('mark.update', d, {mark: 'm1', label: 'x'}).doc.marks[0].label, 'x');
  assert.equal(run('mark.update', d, {mark: '#b', label: 'x'}).doc.marks[1].label, 'x');
  assert.deepEqual(run('mark.update', d, {mark: '#dup', label: 'x'}),
                   {error: 'Two marks select #dup; give one an id first (mark.update with id).'});
  assert.deepEqual(run('mark.update', d, {mark: 'm9', label: 'x'}), {error: MARK_GONE('m9')});
  assert.equal(MARK_GONE('m9'), 'There is no mark m9.');
  assert.equal(MARK_GONE(7), 'There is no mark at row 7.');
  assert.deepEqual(run('mark.update', d, {mark: 7}), {error: 'There is no mark at row 7.'});
});

test('mark.update: a no-op is the same document; an id can be given or refused', () => {
  const d = doc([{id: 'm1', select: '#a', label: 'x'}, {select: '#b'}]);
  assert.equal(run('mark.update', d, {mark: 'm1', label: 'x'}).doc, d);
  const named = run('mark.update', d, {mark: '#b', id: 'up'});
  assert.deepEqual([named.doc.marks[1].id, named.summary], ['up', 'Changed mark #b.']);
  assert.deepEqual(run('mark.update', d, {mark: '#b', id: 'm1'}), {error: 'There is already a mark m1.'});
});

test('mark.remove, mark.move, marks.clear', () => {
  const d = doc([{id: 'm1', select: '#a'}, {id: 'm2', select: '#b'}, {id: 'm3', select: '#c'}]);
  assert.deepEqual(run('mark.remove', d, {mark: 'm2'}).doc.marks.map(m => m.id), ['m1', 'm3']);
  const mv = run('mark.move', d, {mark: 'm3', to: 0});
  assert.deepEqual([mv.doc.marks.map(m => m.id), mv.summary], [['m3', 'm1', 'm2'], 'Moved mark m3 to row 0.']);
  assert.equal(run('mark.move', d, {mark: 0, to: 0}).doc, d);
  assert.deepEqual(run('mark.move', d, {mark: 0, to: 3}), {error: 'There is no row 3; the list has 3 marks.'});
  const c = run('marks.clear', d);
  assert.deepEqual([c.doc.marks, c.summary], [[], 'Cleared 3 marks.']);
  assert.equal(run('marks.clear', doc()).doc.marks.length, 0);
  const empty = doc();
  assert.equal(run('marks.clear', empty).doc, empty);
});

test('lamp.state is the tree chip: set, toggle off, and a mark left saying nothing goes', () => {
  const on = run('lamp.state', doc(), {path: 'psu-0', state: 'on'});
  assert.deepEqual(on.doc.marks.map(m => [m.select, m.state]), [[P, 'on']]);
  const off = run('lamp.state', on.doc, {path: 'psu-0', state: 'on'});
  assert.deepEqual(off.doc.marks, []);
  const kept = run('lamp.state', doc([{select: P, state: 'on', label: 'PSU'}]), {path: 'psu-0', state: 'on'});
  assert.deepEqual(kept.doc.marks.map(m => [m.state, m.label]), [['', 'PSU']]);
  const nothing = doc();
  assert.equal(run('lamp.state', nothing, {path: 'psu-0', state: ''}).doc, nothing);
});

test('lamp.color is the swatch: a color on an off lamp clears the off; null clears', () => {
  const set = run('lamp.color', doc([{select: P, state: 'off'}]), {path: 'psu-0', hex: '#00ff00'});
  assert.deepEqual(set.doc.marks.map(m => [m.state, m.lamp]), [['', '#00ff00']]);
  const added = run('lamp.color', doc(), {path: 'psu-0', hex: '#00FF00'});
  assert.deepEqual(added.doc.marks.map(m => [m.select, m.lamp]), [[P, '#00ff00']]);
  assert.deepEqual(run('lamp.color', added.doc, {path: 'psu-0', hex: null}).doc.marks, []);
  const keep = run('lamp.color', doc([{select: P, label: 'x', lamp: '#fff'}]), {path: 'psu-0', hex: null});
  assert.deepEqual(keep.doc.marks.map(m => [m.label, m.lamp]), [['x', '']]);
  const none = doc();
  assert.equal(run('lamp.color', none, {path: 'psu-0', hex: null}).doc, none);
  assert.deepEqual(run('lamp.color', none, {path: 'psu-0', hex: 'red'}), {error: 'red is not a hex color like #ff8800.'});
});

test('crop and legend', () => {
  const d = doc();
  const c = run('crop', d, {rect: {x: 1, y: 2, w: 3, h: 4}});
  assert.deepEqual([c.doc.crop, c.summary], [{x: 1, y: 2, w: 3, h: 4}, 'Cropped to 3 x 4 mm.']);
  assert.equal(run('crop', d, {rect: null}).doc, d);
  assert.equal(run('crop', c.doc, {rect: null}).summary, 'Removed the crop.');
  assert.equal(run('legend', d, {on: true}).doc, d);
  assert.deepEqual(run('legend', d, {on: false}).doc.legend, false);
  assert.equal(run('legend', d, {on: false}).summary, 'Turned the legend off.');
});
```

```js
// tests/annotate/apply.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {normalise} from '../../vendor/marks.js';
import {apply} from '../../site/annotate/commands.js';

const empty = () => normalise({device: 'd'});

test('a batch applies whole, and @names reach later commands', () => {
  const r = apply(empty(), [{op: 'mark.add', select: '#a', as: 'a'}, {op: 'mark.update', mark: '@a', label: '@a'}]);
  assert.deepEqual(r.doc.marks.map(m => [m.id, m.label]), [['m1', '@a']]);
  assert.deepEqual(r.created, {a: 'm1', ids: ['m1']});
  assert.deepEqual([r.noop, r.step], [false, true]);
});

test('a failing command leaves the document untouched and says which', () => {
  const d = empty();
  const r = apply(d, [{op: 'mark.add', select: '#a'}, {op: 'mark.remove', mark: 'nope'}]);
  assert.deepEqual(r, {error: 'There is no mark nope.', index: 1});
  assert.equal(d.marks.length, 0);
});

test('unknown commands, bad arguments and inherited keys are refused in words', () => {
  const d = empty();
  assert.deepEqual(apply(d, {op: 'mark.ad'}), {error: "There is no command called 'mark.ad'.", index: 0});
  assert.deepEqual(apply(d, {op: 'mark.add'}), {error: 'mark.add needs select, some text.', index: 0});
  assert.deepEqual(apply(d, {op: 'mark.add', select: '#a', colour: 'x'}), {error: 'mark.add does not take colour.', index: 0});
  assert.deepEqual(apply(d, {op: 'mark.add', select: '#a', constructor: 1}), {error: 'mark.add does not take constructor.', index: 0});
  assert.deepEqual(apply(d, [{op: 'mark.add', select: '#a', as: 'x'}, {op: 'mark.add', select: '#b', as: 'x'}]),
                   {error: 'Two commands in this batch are called x.', index: 1});
  assert.deepEqual(apply(d, {op: 'mark.remove', mark: '@x'}), {error: 'Nothing earlier in this batch is called x.', index: 0});
});

test('a batch of no-ops is a no-op', () => {
  const d = empty();
  const r = apply(d, [{op: 'legend', on: true}, {op: 'crop', rect: null}]);
  assert.deepEqual([r.noop, r.doc === d], [true, true]);
});
```

```js
// tests/annotate/commands-table.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {COMMANDS} from '../../site/annotate/commands.js';

test('every command and every argument is described, briefly', () => {
  for (const [op, def] of Object.entries(COMMANDS)) {
    assert.ok(def.description && def.description.length <= 500, `${op}: description`);
    const walk = (schema, at) => {
      for (const [k, s] of Object.entries(schema.properties || {})) {
        assert.ok(s.description && s.description.length <= 150, `${op}: ${at}${k} needs a description under 150 characters`);
        walk(s, `${at}${k}.`);
      }
    };
    walk(def.args, '');
  }
});
```

```js
// tests/annotate/describe.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {normalise} from '../../vendor/marks.js';
import {describe} from '../../site/annotate/describe.js';

test('describe names the target, the settings, and every mark with what it matched', () => {
  const d = normalise({device: 'as7946-30xb', config: 'dc', view: 'rear', crop: {x: 0, y: 0, w: 10, h: 5},
    marks: [{id: 'm1', select: '#psu-0', color: '#ff2d95', label: 'PSU'}, {select: '.nope', state: 'on'}]});
  const text = describe(d, [{index: 0, count: 1, total: 1}, {index: 1, count: 0, total: 0}]);
  assert.match(text, /^as7946-30xb, config dc, rear\. Legend on; cropped to 10 x 5 mm\./);
  assert.match(text, /m1 #psu-0, color #ff2d95, label "PSU": 1 part/);
  assert.match(text, /#1 \.nope, state on: matches nothing/);
});

test('describe stays under 1.5K characters and says what it shortened', () => {
  const marks = Array.from({length: 80}, (_, k) => ({id: `m${k}`, select: `[data-path='port-${k}']`, label: `uplink to spine ${k}`, color: '#ffd400'}));
  const d = normalise({device: 'x', marks});
  const text = describe(d, marks.map((_, k) => ({index: k, count: 1, total: 1})));
  assert.ok(text.length <= 1500, `${text.length}`);
  assert.match(text, /^Shortened: /m);
});

test('a document with no report yet says so rather than guessing counts', () => {
  const text = describe(normalise({device: 'x', marks: [{select: '#a'}]}), []);
  assert.match(text, /#0 #a: not drawn yet/);
});
```

- [ ] **Step 2: Run them and check that they fail**

Run: `node --test tests/annotate/`
Expected: FAIL, `Cannot find module '.../site/annotate/commands.js'`

- [ ] **Step 3: Implement `commands.js`**

```js
// site/annotate/commands.js
// ANNOTATE'S COMMANDS (spec docs/superpowers/specs/2026-10-08-annotate-command-api-design.md).
// Every edit of a marked-up drawing is one of these, run through apply(): the
// page's own controls and an agent alike. Pure - a normalised document and the
// arguments in, a new document out - and a command that changes nothing hands
// back the very document it was given. The device, configuration, view, swaps
// and fields are the shell's to change, not these commands' (editor.js).

import {validate, same} from '../../vendor/rack/validate.js';

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
  const m = doc.marks[i], next = {...m, state: m.state === state ? '' : state};
  if (same(next, m)) return unchanged(doc);
  return done(replaceOrDrop(doc, i, next), next.state ? `Set ${path} to ${state}.` : `Cleared the state on ${path}.`);
}

function lampColor(doc, {path, hex}) {
  if (hex != null && !HEX_RE.test(hex)) return {error: badHex(hex)};
  const select = pathSel(path);
  const i = doc.marks.findIndex(m => m.select === select);
  if (hex == null) {
    if (i < 0 || !doc.marks[i].lamp) return unchanged(doc);
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
```

If `typeWord`'s two-type branch produces an awkward sentence for `mark` (`a whole number from 0 or some text`), that's acceptable. The asserted sentences in the tests are the contract.

- [ ] **Step 4: Implement `describe.js`**

```js
// site/annotate/describe.js
// A SHORT READING OF THE DOCUMENT for an agent: the target, the settings, and
// every mark with what it matched the last time the drawing was drawn - which
// is how an agent learns that a selector it wrote reaches nothing. About 1.5K
// characters at most (WebMCP's guidance for tool output); a long document loses
// its labels first, then its tail, and says so.

const LIMIT = 1500;

export function describe(doc, report = []) {
  const target = [doc.device || 'No device', doc.config && `config ${doc.config}`, doc.view].filter(Boolean).join(', ');
  const crop = doc.crop ? `cropped to ${doc.crop.w} x ${doc.crop.h} mm` : 'not cropped';
  const head = `${target}. Legend ${doc.legend ? 'on' : 'off'}; ${crop}.`;
  const matched = i => {
    const r = report.find(x => x.index === i);
    if (!r) return 'not drawn yet';
    if (r.error) return `refused: ${r.error}`;
    return r.count ? `${r.count} part${r.count === 1 ? '' : 's'}` : 'matches nothing';
  };
  const line = (m, i, short) => {
    const bits = [m.color && `color ${m.color}`, m.state && `state ${m.state}`, !short && m.label && `label "${m.label}"`,
                  m.lamp && `lamp ${m.lamp}`].filter(Boolean);
    return `${m.id || `#${i}`} ${m.select}${bits.length ? `, ${bits.join(', ')}` : ''}: ${matched(i)}`;
  };
  const build = (short, n) => {
    const lines = [head, doc.marks.length ? 'Marks:' : 'No marks.', ...doc.marks.slice(0, n).map((m, i) => line(m, i, short))];
    const more = doc.marks.length - n;
    if (short) lines.push(more ? `Shortened: labels left out, and ${more} more not listed; ask by id or row.` : 'Shortened: labels left out.');
    return lines.join('\n');
  };
  let out = build(false, doc.marks.length);
  if (out.length <= LIMIT) return out;
  let n = doc.marks.length;
  out = build(true, n);
  while (out.length > LIMIT && n) out = build(true, --n);
  return out;
}
```

- [ ] **Step 5: Run the tests and check that they pass**

Run: `node --test tests/annotate/`
Expected: PASS. A sentence assertion that fails means the code is wrong, not the test. The exceptions are `lamp.state` and `lamp.color`, where today's page functions are the authority (`annotate.html` `setState`, `setLamp`, `clearLamp`). If a test disagrees with them, report it.

- [ ] **Step 6: Commit**

```bash
git add site/annotate/commands.js site/annotate/describe.js tests/annotate/
git commit -m "annotate: every edit of a marked-up drawing as a named command, and a reading of it for agents

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The editor

**Files:**
- Create: `site/annotate/editor.js`
- Test: `tests/annotate/editor.test.mjs`

**Interfaces:**
- Consumes: `apply` (Task 2), `normalise` (`vendor/marks.js`), `createHistory` (`vendor/rack/history.js`, which returns `{record(before, after, summary, origin), undo() -> step|null, redo() -> step|null, clear(), canUndo, canRedo, undoSummary, redoSummary}`).
- Produces: `createMarksEditor({doc, cap = 100}) -> {getDoc(), loadDoc(doc) -> {findings}, apply(cmds, {origin = 'ui', merge = null}), preview(cmds), undo() -> {summary}|null, redo(), retarget(patch), canUndo, canRedo, undoSummary, redoSummary, on('change', fn) -> unsubscribe}`. A change event is `{cause: 'apply'|'undo'|'redo'|'load'|'target', origin, step, commands, summary, findings, before, after}`.

- [ ] **Step 1: Write the failing test**

```js
// tests/annotate/editor.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {createMarksEditor} from '../../site/annotate/editor.js';

const fresh = () => {
  const ed = createMarksEditor({doc: {device: 'a'}});
  const evs = [];
  ed.on('change', e => evs.push(e));
  return {ed, evs};
};

test('apply records a step and emits; undo and redo walk it with its origin', () => {
  const {ed, evs} = fresh();
  ed.apply({op: 'mark.add', select: '#x'}, {origin: 'agent'});
  assert.equal(ed.getDoc().marks.length, 1);
  assert.equal(ed.undoSummary, 'Added mark m1 on #x.');
  ed.undo();
  assert.equal(ed.getDoc().marks.length, 0);
  ed.redo();
  assert.equal(ed.getDoc().marks.length, 1);
  assert.deepEqual(evs.map(e => [e.cause, e.origin]), [['apply', 'agent'], ['undo', 'agent'], ['redo', 'agent']]);
});

test('an error, a no-op and a preview record and emit nothing', () => {
  const {ed, evs} = fresh();
  const before = ed.getDoc();
  assert.ok(ed.apply({op: 'mark.remove', mark: 'm9'}).error);
  assert.ok(ed.apply({op: 'legend', on: true}).noop);
  assert.equal(ed.preview({op: 'mark.add', select: '#x'}).doc.marks.length, 1);
  assert.deepEqual([ed.getDoc() === before, evs.length, ed.canUndo], [true, 0, false]);
});

test('a typing burst with one merge key is one step that undoes to before the burst', () => {
  const {ed} = fresh();
  ed.apply({op: 'mark.add', select: '#x'});
  for (const t of ['P', 'PS', 'PSU']) ed.apply({op: 'mark.update', mark: 0, label: t}, {merge: '0:label'});
  assert.equal(ed.getDoc().marks[0].label, 'PSU');
  ed.undo();
  assert.equal(ed.getDoc().marks[0].label, '');
  ed.undo();
  assert.equal(ed.getDoc().marks.length, 0);
});

test('another edit, or an undo, ends the burst', () => {
  const {ed} = fresh();
  ed.apply({op: 'mark.add', select: '#x'});
  ed.apply({op: 'mark.update', mark: 0, label: 'a'}, {merge: '0:label'});
  ed.apply({op: 'legend', on: false});
  ed.apply({op: 'mark.update', mark: 0, label: 'ab'}, {merge: '0:label'});
  ed.undo();
  assert.deepEqual([ed.getDoc().marks[0].label, ed.getDoc().legend], ['a', false]);
});

test('the shell owns the target: retarget is not a step, and undo keeps it', () => {
  const {ed, evs} = fresh();
  ed.apply({op: 'mark.add', select: '#x'});
  ed.retarget({device: 'b', config: 'c', view: 'rear', swaps: {'p': 'x/y@1'}, fields: {}});
  assert.deepEqual([evs.at(-1).cause, evs.at(-1).step], ['target', false]);
  ed.undo();
  const d = ed.getDoc();
  assert.deepEqual([d.marks.length, d.device, d.config, d.view, d.swaps], [0, 'b', 'c', 'rear', {'p': 'x/y@1'}]);
  ed.redo();
  assert.deepEqual([ed.getDoc().marks.length, ed.getDoc().device], [1, 'b']);
  const n = evs.length;
  ed.retarget({device: 'b'});
  assert.equal(evs.length, n);              // the same target is a no-op
});

test('loadDoc normalises, clears history and emits load', () => {
  const {ed, evs} = fresh();
  ed.apply({op: 'mark.add', select: '#x'});
  ed.loadDoc({device: 'z', marks: [{select: '#y', lamp: '#ABC'}]});
  assert.deepEqual([ed.getDoc().device, ed.getDoc().marks[0].lamp, ed.canUndo, evs.at(-1).cause], ['z', '#abc', false, 'load']);
});

test('a throwing listener does not stop the edit or the other listeners', () => {
  const ed = createMarksEditor({doc: {}});
  const seen = [];
  const err = console.error;
  console.error = () => {};
  try {
    ed.on('change', () => { throw new Error('boom'); });
    ed.on('change', e => seen.push(e.cause));
    ed.apply({op: 'mark.add', select: '#x'});
  } finally { console.error = err; }
  assert.deepEqual([ed.getDoc().marks.length, seen], [1, ['apply']]);
});
```

- [ ] **Step 2: Run it and check that it fails**

Run: `node --test tests/annotate/editor.test.mjs`
Expected: FAIL, module not found

- [ ] **Step 3: Implement**

```js
// site/annotate/editor.js
// THE HEADLESS ANNOTATE EDITOR (spec §2.2): the marks document, its history and
// the one way in for edits, shaped like the rack editor so one adapter pattern
// drives both. The page draws what it is told by `change`.

import {apply as applyCommands} from './commands.js';
import {normalise} from '../../vendor/marks.js';
import {createHistory} from '../../vendor/rack/history.js';

// THE SHELL OWNS THE TARGET. Which device, configuration and view, and what is
// seated and written on it, change only by the shell loading something - so an
// undo restores the marks, the crop and the legend and keeps the target as it
// is now. Restoring a device the shell is not showing would be a document that
// lies about its own drawing.
const TARGET = ['device', 'config', 'view', 'swaps', 'fields'];
const keepTarget = (doc, from) => ({...doc, ...Object.fromEntries(TARGET.map(k => [k, from[k]]))});
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function createMarksEditor({doc = {}, cap = 100} = {}) {
  const history = createHistory({cap});
  const listeners = new Set();
  let current = normalise(doc);
  let lastMerge = null;
  const list = cmds => (Array.isArray(cmds) ? cmds : [cmds]);
  const emit = ev => {
    for (const fn of [...listeners]) {
      try { fn(ev); } catch (err) { console.error('[portrayal] an annotate change listener failed', err); }
    }
  };

  function apply(cmds, {origin = 'ui', merge = null} = {}) {
    const commands = list(cmds), before = current;
    const res = applyCommands(before, commands);
    if (res.error || res.noop) return res;
    current = res.doc;
    // A TYPING BURST IS ONE STEP: the same merge key as the newest step, with
    // nothing in between, replaces that step rather than adding one.
    if (merge != null && merge === lastMerge && history.canUndo) {
      const old = history.undo();
      history.record(old.before, current, res.summary, origin);
    } else history.record(before, current, res.summary, origin);
    lastMerge = merge;
    emit({cause: 'apply', origin, step: true, commands, summary: res.summary, findings: res.findings, before, after: current});
    return res;
  }

  function travel(cause) {
    const s = cause === 'undo' ? history.undo() : history.redo();
    if (!s) return null;
    lastMerge = null;
    const before = current;
    current = keepTarget(cause === 'undo' ? s.before : s.after, before);
    emit({cause, origin: s.origin, step: true, commands: [], summary: s.summary, findings: [], before, after: current});
    return {summary: s.summary};
  }

  return {
    getDoc: () => current,
    loadDoc(next) {
      const before = current;
      current = normalise(next);
      history.clear();
      lastMerge = null;
      emit({cause: 'load', origin: 'ui', step: false, commands: [], summary: '', findings: [], before, after: current});
      return {findings: []};
    },
    apply,
    preview: cmds => applyCommands(current, list(cmds)),
    undo: () => travel('undo'),
    redo: () => travel('redo'),
    // The shell moved, seated or wrote something, or a new drawing re-cut the
    // crop: not an edit, so not a step.
    retarget(patch) {
      const allowed = Object.fromEntries(Object.entries(patch).filter(([k]) => TARGET.includes(k) || k === 'crop'));
      const next = {...current, ...allowed};
      if (same(next, current)) return;
      const before = current;
      current = next;
      emit({cause: 'target', origin: 'ui', step: false, commands: [], summary: '', findings: [], before, after: current});
    },
    get canUndo() { return history.canUndo; },
    get canRedo() { return history.canRedo; },
    get undoSummary() { return history.undoSummary; },
    get redoSummary() { return history.redoSummary; },
    on(type, fn) {
      if (type !== 'change') throw new Error(`There is no event called ${type}.`);
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
```

`same` here is local and key-order sensitive on purpose. `retarget` compares a document with itself after a spread, where order is preserved. If a reviewer prefers it, import `same` from `vendor/rack/validate.js` instead; either works.

- [ ] **Step 4: Run it and check that it passes**

Run: `node --test tests/annotate/ && node --test tests/*/*.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add site/annotate/editor.js tests/annotate/editor.test.mjs
git commit -m "annotate: a headless editor with undo, redo, typing bursts as one step, and the shell owning the target

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The page onto the editor

**Files:**
- Modify: `annotate.html` (the module script; line numbers are from `f54d18e2` and will have moved)
- Modify: `check-browser.py` (add `check_annotate_api` with `@extra`)
- Test: `tests/annotate/one-way-in.test.mjs`

**Interfaces:**
- Consumes: `createMarksEditor` (Task 3), `describe` (Task 2).
- Produces: `window.portrayalAnnotate = {ready, settled, getDoc, setDoc, apply, preview, undo, redo, history, describe, on}`, set synchronously before `await shell.ready`.

- [ ] **Step 1: Write the failing one-way-in test**

```js
// tests/annotate/one-way-in.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// ONE WAY IN (spec §2.3): the page edits the document only through the editor.
// Reads of `doc` are fine; an assignment to it, or to a mark in it, is not.
test('annotate.html never writes the document directly', () => {
  const src = readFileSync(new URL('../../annotate.html', import.meta.url), 'utf8');
  const bad = [
    ...src.matchAll(/\bdoc\.(marks|crop|legend|device|config|view|swaps|fields)\s*=[^=]/g),
    ...src.matchAll(/\bdoc\.marks\.(push|splice|pop|shift|unshift|sort|reverse)\s*\(/g),
    ...src.matchAll(/\bdoc\.marks\[[^\]]+\]\s*(\.\w+\s*)?=[^=]/g),
    ...src.matchAll(/\bm\.(select|label|color|lamp|state)\s*=[^=]/g),
  ].map(m => m[0]);
  assert.deepEqual(bad, []);
});
```

Run: `node --test tests/annotate/one-way-in.test.mjs`
Expected: FAIL. It lists today's direct writes (`doc.marks.push`, `doc.marks.splice`, `m.select =` and so on).

- [ ] **Step 2: Rewire the page**

**2a. Imports and state.** Add to the module's imports:

```js
import { createMarksEditor } from './site/annotate/editor.js';
import { describe as describeMarks } from './site/annotate/describe.js';
```

Replace `let doc = {v: 1, ...};` with:

```js
const ed = createMarksEditor({doc: {legend: true}});
// `doc` is read everywhere and written nowhere: the editor's document as it is now.
let doc = ed.getDoc();
```

**2b. One way in, with the redraw chosen by the caller.** Today, typing in a row only restages (`schedule()`), the state menu restages, and everything else re-renders. The page keeps that choice:

```js
// THE ONE WAY AN EDIT REACHES THE DOCUMENT: a command, through the editor. The
// caller says how much to redraw, as each handler did before - a keystroke in a
// row must not rebuild the row the reader is typing in.
let redraw = 'render';
function edit(cmds, {draw = 'render', merge = null} = {}) {
  redraw = draw;
  const res = ed.apply(cmds, {origin: 'ui', merge});
  redraw = 'render';
  if (res.error) say('#expmsg', res.error, 'bad');
  return res;
}
ed.on('change', ev => {
  doc = ev.after;
  if (ev.cause === 'target' || ev.cause === 'load') return;    // the load and target paths draw for themselves
  if (redraw === 'schedule') schedule(); else if (redraw === 'restage') restage(); else render();
  paintSteps();
});
```

**2c. Every write becomes a command.** Leave each handler's UI logic as it is (`row._sig`, `scrollIntoView`, `say`).

| Today | Becomes |
|---|---|
| `addMark(m)` | `const r = edit({op: 'mark.add', ...m}); if (!r.error) $('#rows').lastElementChild?.scrollIntoView({block: 'nearest'});` |
| `setState(path, st)` | `edit({op: 'lamp.state', path, state: st})` |
| `setLamp(path, hex)` | `edit({op: 'lamp.color', path, hex})` |
| `clearLamp(path)` | `edit({op: 'lamp.color', path, hex: null})` |
| `toggleMark(select, label)` | Find the index `i` as today. If found and `m.state \|\| m.lamp`: `edit({op: 'mark.update', mark: i, color: '', label: ''})`. If found otherwise: `edit({op: 'mark.remove', mark: i})`. If not found: `addMark({select, color: nextColor(), label: label \|\| ''})`. |
| row `input` handler (`sel`, `lab`, `col`, `paint`, `lamp`) | Build the patch exactly as today, then `edit({op: 'mark.update', mark: i, ...patch}, {draw: 'schedule', merge: \`${i}:${field}\`})`. `field` is `select`, `label`, `color` or `lamp`. `paint` uses field `color`. Keep the `.paint`/`.unset` class toggles. |
| row `change` on `.st` | `row._sig = sigOf(row)` stays, then `edit({op: 'mark.update', mark: i, state: ev.target.value}, {draw: 'restage'})`. Set `_sig` before the edit, since the listener restages synchronously. |
| row click `.lx` | `edit({op: 'mark.update', mark: i, lamp: ''})` |
| row click `.x` | `edit({op: 'mark.remove', mark: i})` |
| row click `.mv` | `edit({op: 'mark.move', mark: i, to: j})`, with the range guard kept. |
| `#clearall` | `edit({op: 'marks.clear'})` |
| `#cropclear` | `edit({op: 'crop', rect: null})` |
| crop `pointermove` | Keep a local `cropDraft` and draw it. `drawCrop()` reads `cropDraft ?? doc.crop`. No command. |
| crop `pointerup` | `cropDraft = null; edit({op: 'crop', rect: r.w > 2 && r.h > 2 ? marks.clampCrop(state.svg, r) : null});` followed by `disarmCrop()`. |
| `#legend` change | `edit({op: 'legend', on: $('#legend').checked})` |
| `writeTarget()` | `ed.retarget({device: state.device \|\| '', config: state.cfg \|\| '', view: state.view \|\| '', ...(pendingSwaps ? {} : {swaps: swapsNow(shell)}), ...(pendingFields ? {} : {fields: fieldsNow(shell)})})` |
| `shell.on('change')` and `applyPendingSwaps` swaps/fields writes | `ed.retarget({swaps: swapsNow(shell), fields: fieldsNow(shell)})`. The existing `lastSeated` compare and `render()` stay. |
| `shell.on('load')` crop re-cut | `if (doc.crop) ed.retarget({crop: marks.clampCrop(state.svg, doc.crop)});` |
| hash restore at boot (`doc = fromHash; ...`) | Becomes `loadDoc` (2d). |

Delete the page's own `addMark` body, along with `setState`, `setLamp` and `clearLamp`, except as the thin wrappers in the table.

**2d. `loadDoc`, `setDoc` and `hashchange`.** Lift the hash-restore block at the end of the module into:

```js
// A DOCUMENT FROM OUTSIDE - a share link, a pasted hash, an agent - moves the
// shell to its drawing, then lays its swaps and fields on, then its marks. The
// newest call wins: an older one still moving the shell is overtaken.
let loads = 0;
async function loadDoc(input) {
  const mine = ++loads;
  const next = marks.normalise(input);
  ed.loadDoc(next);
  const want = {device: next.device, config: next.config};
  pendingSwaps = Object.keys(next.swaps || {}).length ? {...next.swaps} : null;
  pendingFields = Object.keys(next.fields || {}).length ? {...next.fields} : null;
  $('#legend').checked = !!next.legend;
  const moving = await retarget(next);
  if ((pendingSwaps || pendingFields) && moving && !atTarget(want))
    await new Promise(resolve => { landing = {want, resolve}; setTimeout(resolve, 8000); });
  if (mine !== loads) return {error: 'Overtaken by a newer document.'};
  const left = await applyPendingSwaps() || {};
  if (mine !== loads) return {error: 'Overtaken by a newer document.'};
  if (!moving) { writeTarget(); render({fit: true}); }
  paintSteps();
  const findings = [left.swaps && `${left.swaps} swap(s) do not fit this drawing and were left out`,
                    left.fields && `${left.fields} written part(s) do not fit this drawing and were left out`].filter(Boolean);
  return {findings};
}
```

The boot path becomes:

```js
const fromHash = marks.decode(location.hash);
if (fromHash) {
  const {findings = []} = await loadDoc(fromHash);
  // the existing "restored N mark(s) ..." message, built from fromHash and `findings`
}
window.addEventListener('hashchange', () => {
  const d = marks.decode(location.hash);
  if (d && marks.encode(d) !== marks.encode(ed.getDoc())) loadDoc(d);
});
```

Keep the existing `say('#expmsg', 'restored ...')` wording. Build its "do not fit" half from `left` as before: return `left` from `loadDoc` alongside `findings`, as `{findings, left}`, if that is simpler.

**2e. Undo and Redo.** Add two buttons to the marks panel's header markup, beside Clear all:

```html
<button id="undoStep" hidden></button><button id="redoStep" hidden></button>
```

```js
// Undo and Redo, each while there is a step to take, each saying what it would do.
function paintSteps() {
  for (const [id, can, what, word] of [['undoStep', ed.canUndo, ed.undoSummary, 'Undo'], ['redoStep', ed.canRedo, ed.redoSummary, 'Redo']]) {
    const b = $(`#${id}`);
    b.hidden = !can;
    b.textContent = word;
    b.title = can ? `${word}: ${what}` : '';
    b.setAttribute('aria-label', can ? `${word}: ${what}` : word);
  }
}
$('#undoStep').onclick = () => ed.undo();
$('#redoStep').onclick = () => ed.redo();
document.addEventListener('keydown', e => {
  if (e.target.closest?.('input, select, textarea') || !(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
  e.preventDefault();
  if (e.shiftKey) ed.redo(); else ed.undo();
});
```

Match the panel's existing button styling, using the same classes as `#clearall`.

**2f. The page's API.** Place this immediately after `ed` is created and before any `await`:

```js
let settled = false;
const ready = shell.ready.then(() => { settled = true; });
window.portrayalAnnotate = Object.freeze({
  ready,
  get settled() { return settled; },
  getDoc: () => ed.getDoc(),
  setDoc: d => loadDoc(d),
  apply: (cmds, opts = {}) => {
    const r = ed.apply(cmds, {origin: opts.origin ?? 'agent'});
    return r;
  },
  preview: cmds => ed.preview(cmds),
  undo: () => ed.undo(),
  redo: () => ed.redo(),
  history: () => ({canUndo: ed.canUndo, canRedo: ed.canRedo, undoSummary: ed.undoSummary, redoSummary: ed.redoSummary}),
  describe: () => describeMarks(ed.getDoc(), report),
  on: (type, fn) => ed.on(type, fn),
});
```

An edit through `window.portrayalAnnotate.apply` runs the same change listener, with `redraw` at its default `'render'`.

**2g. The share hash.** The `act === 'share'` path already encodes `doc`, which is now the editor's document. No change is needed beyond `doc` being current, which the listener keeps it.

- [ ] **Step 3: Run the node suite**

Run: `node --test tests/*/*.test.mjs`
Expected: PASS, including `one-way-in`.

- [ ] **Step 4: Add the browser check**

Add near the other Annotate checks in `check-browser.py`:

```python
@extra("annotate.html: window.portrayalAnnotate sets and reads the document, edits through commands with Undo and Redo, restores a pasted hash, and says when a selector matches nothing")
def check_annotate_api(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    page.goto(f"{base}/annotate.html", wait_until="load")
    page.wait_for_function("() => window.portrayalAnnotate && window.portrayalAnnotate.settled", timeout=READY_MS)
    api = "window.portrayalAnnotate"
    dev = page.evaluate(f"() => {api}.getDoc().device")
    if not dev:
        return bad + ["annotate api: getDoc() names no device after the page settled"]
    # setDoc: a document naming this device and one mark on a part it has.
    path = page.evaluate("() => document.querySelector('#stage-svg [data-path]')?.dataset.path")
    res = page.evaluate(f"""async p => await {api}.setDoc({{device: {api}.getDoc().device,
        marks: [{{id: 'one', select: `[data-path='${{p}}']`, color: '#ff2d95'}}]}})""", path)
    if res.get("error"):
        bad.append(f"annotate api: setDoc refused: {res}")
    wait_fn(page, "annotate api: the mark is a row", "() => document.querySelectorAll('#rows .mark').length === 1")
    # apply, then undo and redo
    page.evaluate(f"() => {api}.apply([{{op: 'mark.add', select: '.does-not-exist', as: 'miss'}}, {{op: 'mark.update', mark: 'one', label: 'Here'}}])")
    wait_fn(page, "annotate api: two rows", "() => document.querySelectorAll('#rows .mark').length === 2")
    text = page.evaluate(f"() => {api}.describe()")
    if "matches nothing" not in text or 'label "Here"' not in text:
        bad.append(f"annotate api: describe() reads {text!r}")
    page.evaluate(f"() => {api}.undo()")
    wait_fn(page, "annotate api: undone", f"() => {api}.getDoc().marks.length === 1 && {api}.getDoc().marks[0].label === ''")
    if page.is_hidden("#redoStep"):
        bad.append("annotate api: Redo is not offered after an Undo")
    page.evaluate(f"() => {api}.redo()")
    wait_fn(page, "annotate api: redone", f"() => {api}.getDoc().marks.length === 2")
    # a refusal changes nothing and says why
    before = page.evaluate(f"() => JSON.stringify({api}.getDoc())")
    r = page.evaluate(f"() => {api}.apply({{op: 'mark.remove', mark: 'nope'}})")
    if r.get("error") != "There is no mark nope." or page.evaluate(f"() => JSON.stringify({api}.getDoc())") != before:
        bad.append(f"annotate api: a refused remove answered {r} or changed the document")
    # typing keeps focus, and a burst is one step
    page.click("#rows .mark:first-child .lab")
    page.keyboard.type("abc")
    if not page.evaluate("() => document.activeElement && document.activeElement.classList.contains('lab')"):
        bad.append("annotate api: typing in a row's label lost focus")
    page.keyboard.press("Escape")
    page.evaluate(f"() => {api}.undo()")
    lab = page.evaluate(f"() => {api}.getDoc().marks[0].label")
    if lab != "Here":
        bad.append(f"annotate api: one Undo after typing 'abc' left the label {lab!r}, expected 'Here'")
    # a pasted hash restores that document; the page's own hash writes do not loop
    enc = page.evaluate("""() => import('./vendor/marks.js').then(m => m.encode({device: window.portrayalAnnotate.getDoc().device,
        marks: [{select: '.pasted', label: 'from a link'}]}))""")
    page.evaluate("h => { location.hash = h; }", enc)
    wait_fn(page, "annotate api: pasted hash restored",
            f"() => {api}.getDoc().marks.length === 1 && {api}.getDoc().marks[0].label === 'from a link'")
    return bad
```

Check that `wait_fn` and `READY_MS` are the helpers used elsewhere, and that the row label input really has the class `lab` (`grep -n "class=\"lab\"\|'lab'" annotate.html`). If `marks.encode` already includes a leading `#`, drop or keep it to match how the share path writes `#${enc}`.

- [ ] **Step 5: Run the Annotate browser checks**

Run: `uptime`, then `python3 check-browser.py --only check_annotate_api`
Expected: no problems.

The other Annotate checks (`check_annotate_diagram_exports`, `check_annotate_3d`, and the page sweep for `annotate.html`) are not `@extra`, so they run only in the full pass. Run the full pass now (`python3 check-browser.py 2>&1 | tail -30`, about 9 minutes). If load is above 20, wait or report it rather than trusting a timeout.
Expected: all pass. Fix the page, not the checks.

- [ ] **Step 6: Commit**

```bash
git add annotate.html check-browser.py tests/annotate/one-way-in.test.mjs
git commit -m "annotate: the page edits through the editor - commands, Undo and Redo, a pasted link restores, an API for agents

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Verification, review, PR

- [ ] **Step 1:** `node --test tests/*/*.test.mjs && python3 check-contract.py`, then the full browser pass (when calm).
- [ ] **Step 2:** Run the code-review skill on the branch. Fix findings or record them.
- [ ] **Step 3:** Set the spec's status line to `implemented (plan: docs/superpowers/plans/2026-10-08-annotate-command-api.md)` and commit.
- [ ] **Step 4:** Push with `when-calm.sh` and open the site PR.
  - The body covers: what changed; that the upstream schema PR is separate (name its number); which tests ran; any flaky checks by name; the closing 🤖 line.
- [ ] **Step 5:** Message the "Portrayal-site merge agent" with the PR number, and "Agent integration research" with the `window.portrayalAnnotate` shape and the PR.
