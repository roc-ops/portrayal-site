# Rack Builder Command Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every Rack Builder edit becomes a named, pure, validated command run through one `apply`, with step-by-step undo/redo, a headless editor with change events, agent-facing queries, and a published rack JSON Schema. `site/rack-page.js` is rewired onto it.

**Architecture:** Four new pure modules in `site/rack/` (`validate.js`, `commands.js`, `history.js`, `editor.js`) plus `queries.js` and `rack.schema.json`. They wrap the existing reducers and checks (`model.js`, `fit.js`, `managers.js`, `cable-rules.js`) and import nothing from a site path. `rack-page.js` holds a `createRackEditor` instance in place of `S.doc` / `S.undo`. Every UI edit goes through `edit(cmds)`, which calls `ed.apply`. The editor's change listener does what `commit()` did: autosave, notices, the 3D keep-or-rebuild, render.

**Tech Stack:** Plain ES modules, no build step, no new dependencies. Tests: `node --test tests/*/*.test.mjs` (Node 22), `python3 check-contract.py`, and `python3 check-browser.py --only <check names>` (Playwright).

**Spec:** `docs/superpowers/specs/2026-10-07-rack-command-core-design.md`. Read it before starting. This plan argues from it.

## Global Constraints

- **Start after cable piece 2 lands.** Do not begin Task 1 until the cable-routing PR (branch `claude/cable-routing-pathways`, from the "0RU device support and cable management" session) is merged to `origin/main`. Then rebase this branch (`claude/refactor-agent-79cc9e`) onto `origin/main`. Tasks 1-5 touch only new files and could start earlier. But Task 6 rewrites `rack-page.js`, which that PR also rewrites, and Task 7 wraps its `route.js`.
- **Pure means pure.** The new modules have no DOM, no `fetch` and no `localStorage`, and import no site path (`../faces.js`, `../svg-export.js`, `../../vendor/*`). They import only `./model.js`, `./fit.js`, `./managers.js`, `./cable-rules.js`, `./chassis.js` (for `catalogEntries` only) and each other. Async readers (faces, cable facts) arrive through `ctx`.
- **Spelling.** Comments in the new `site/rack/` modules use British spelling (colour, centre, behaviour), because they become upstream kit code in piece 2. Everything else in this repo (page copy, tests, check messages, commit messages) uses American spelling.
- **Sentences.** Every refusal is a plain-English sentence. Sentences that exist today keep their exact text; checks assert them.
- **No new dependencies.** The validator is hand-written (Task 1).
- **Comment style.** Match the files around you: a SHOUTED lead phrase for a rule, prose explaining why, no JSDoc.
- **Never `git push --no-verify`.** At high load, use `nohup sh ~/.claude/merge-agent/portrayal-site/when-calm.sh git push -u origin <branch> &` as a background task. Never push `main`, and never merge. The "Portrayal-site merge agent" lands the PR.
- **Commit trailer** on every commit: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

These are the failure modes most likely to bite, which no single task's tests would otherwise catch. Each one is pinned by a test in the task named.

1. **A render loop from non-step commands.** `dcim` is applied from inside `render()` (via `flushDcimDraft`) and `lengths.routed` after each render. If the change listener renders on those, the page loops forever. Expected: a non-step change saves and re-points the 3D scene but does not render. Pinned in Task 6 (a browser check counts renders after a DCIM draft is stored) and Task 3 (`step: false` on the event).
2. **Undo across a DCIM edit taking the settings back.** Place, set DCIM site, Undo: the device goes and the site stays. Pinned in Task 3's node test and Task 6's browser check.
3. **A stale panel button after Undo.** The remove panel or inspector is open, Undo removes the device, then the old button is clicked. Expected: GONE, or the silent redraw it gives today, with nothing written. Today's `check_rack_stale_handlers` covers this through `replaceRack`; it must keep passing (Task 6).
4. **`@name` used in a field that isn't an id.** A label of `"@srv"` must stay literally `"@srv"`. Pinned in Task 2's `apply` tests.
5. **A batch failing on the last command.** The editor must not record, emit or save anything, and the page must show the error. Pinned in Task 2 (`apply` returns the same rack) and Task 6 (`__rack.apply` browser check).

---

## File structure

| File | Responsibility |
|---|---|
| `site/rack/validate.js` (new) | A small JSON Schema validator over the keywords this repo's argument and rack schemas use. Returns error records. |
| `site/rack/commands.js` (new) | One function per command, the `COMMANDS` table (description, argument schema, flags, run), and `apply`. |
| `site/rack/history.js` (new) | A capped stack of `{before, after, summary, origin}` steps. |
| `site/rack/editor.js` (new) | `createRackEditor`: the document, the history, `apply`/`preview`/`undo`/`redo`/`loadDoc`, change events. |
| `site/rack/queries.js` (new) | `fitsAt`, `freeUs`, `catalog`, `describe`, and async `freePorts`, `suggestMedia`, `looseEnds`. |
| `site/rack/rack.schema.json` (new) | The `portrayal-rack` v2 document schema. |
| `site/rack-page.js` (modify) | The editor replaces `S.doc`/`S.undo`; `edit()` replaces `commit()`; Undo/Redo UI and keys; probe hook. |
| `site/rack/drag.js` (modify) | Unchanged API. Its `patchItem` callback is now backed by a `move` command. |
| `site/schema.js`, `schema.html`, `schemawalk.py`, `check-contract.py` (modify) | Publish the site-owned rack schema beside the vendored ones. |
| `tests/rack/*.test.mjs` (new) | `validate`, `commands`, `apply`, `commands-table`, `history`, `editor`, `queries`, `schema`, `one-way-in`. |
| `check-browser.py` (modify) | New `check_rack_history` and `check_rack_commands`. Undo-presence assertions are updated to the new rule (Task 6). |

---

### Task 1: The validator

**Files:**
- Create: `site/rack/validate.js`
- Test: `tests/rack/validate.test.mjs`

**Interfaces:**
- Produces: `validate(schema, value, root = schema) -> Array<{path: string[], keyword: string, schema: object, missing?: string}>`. The array is empty when the value is valid. Supported keywords: `$ref` (to `#/$defs/<name>` only), `type` (a string or an array, including `'null'` and `'integer'`), `const`, `enum`, `minimum`, `maximum`, `exclusiveMinimum`, `minLength`, `minItems`, `items`, `required`, `properties`, `additionalProperties` (`false` or a schema), `dependentRequired`. Unknown keywords are ignored.

- [ ] **Step 1: Write the failing test**

```js
// tests/rack/validate.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {validate} from '../../site/rack/validate.js';

const S = {type: 'object', required: ['ru', 'face'], additionalProperties: false,
  properties: {ru: {type: 'integer', minimum: 1}, face: {enum: ['front', 'rear']},
               label: {type: 'string', minLength: 1}, length: {type: ['object', 'null'],
               properties: {value: {type: 'number', exclusiveMinimum: 0}}, required: ['value']},
               list: {type: 'array', minItems: 1, items: {type: 'string'}}},
  dependentRequired: {on: ['unit']}};

test('a valid value has no errors', () => {
  assert.deepEqual(validate(S, {ru: 3, face: 'rear', length: null, list: ['a']}), []);
});

test('required, type, enum and additionalProperties each name their path', () => {
  const kinds = e => e.map(x => [x.keyword, x.path.join('.'), x.missing ?? null]);
  assert.deepEqual(kinds(validate(S, {face: 'side'})), [['required', '', 'ru'], ['enum', 'face', null]]);
  assert.deepEqual(kinds(validate(S, {ru: 1.5, face: 'front'})), [['type', 'ru', null]]);
  assert.deepEqual(kinds(validate(S, {ru: 0, face: 'front'})), [['minimum', 'ru', null]]);
  assert.deepEqual(kinds(validate(S, {ru: 1, face: 'front', x: 1})), [['additionalProperties', 'x', null]]);
  assert.deepEqual(kinds(validate(S, {ru: 1, face: 'front', length: {value: 0}})), [['exclusiveMinimum', 'length.value', null]]);
  assert.deepEqual(kinds(validate(S, {ru: 1, face: 'front', list: []})), [['minItems', 'list', null]]);
  assert.deepEqual(kinds(validate(S, {ru: 1, face: 'front', list: [3]})), [['type', 'list.0', null]]);
});

test('dependentRequired, const and $ref', () => {
  const D = {$defs: {end: {type: 'object', required: ['item']}}, type: 'object',
             properties: {a: {$ref: '#/$defs/end'}, f: {const: 'portrayal-rack'}}, dependentRequired: {on: ['unit']}};
  assert.deepEqual(validate(D, {on: 'i1'}).map(e => [e.keyword, e.missing]), [['dependentRequired', 'unit']]);
  assert.deepEqual(validate(D, {f: 'x'}).map(e => e.keyword), ['const']);
  assert.deepEqual(validate(D, {a: {}}).map(e => [e.keyword, e.path.join('.'), e.missing]), [['required', 'a', 'item']]);
});

test('integer is not number-with-a-fraction, and null is only null', () => {
  assert.deepEqual(validate({type: 'integer'}, 2), []);
  assert.equal(validate({type: 'integer'}, '2').length, 1);
  assert.equal(validate({type: 'object'}, null).length, 1);
  assert.equal(validate({type: 'object'}, []).length, 1);
});
```

- [ ] **Step 2: Run it and check that it fails**

Run: `node --test tests/rack/validate.test.mjs`
Expected: FAIL, `Cannot find module '.../site/rack/validate.js'`

- [ ] **Step 3: Implement**

```js
// site/rack/validate.js
// A SMALL JSON SCHEMA VALIDATOR, over the keywords the command arguments and
// the rack schema use and nothing more. No dependency: the kit ships without a
// build step, and a full validator would be most of its weight. Each error says
// where (a path of keys), which keyword refused, and the sub-schema that did,
// so a caller can turn it into a sentence.

const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const IS = {
  null: v => v === null, boolean: v => typeof v === 'boolean', string: v => typeof v === 'string',
  number: v => typeof v === 'number' && Number.isFinite(v), integer: v => Number.isInteger(v),
  object: plain, array: Array.isArray,
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function deref(root, ref) {
  const m = /^#\/\$defs\/(.+)$/.exec(ref);
  const target = m && root.$defs?.[m[1]];
  if (!target) throw new Error(`validate: cannot follow ${ref}`);
  return target;
}

export function validate(schema, value, root = schema, path = []) {
  if (schema.$ref) return validate(deref(root, schema.$ref), value, root, path);
  const err = (keyword, at = path, extra = {}) => ({path: at, keyword, schema, ...extra});
  const types = schema.type == null ? null : [].concat(schema.type);
  if (types && !types.some(t => IS[t]?.(value))) return [err('type')];
  if ('const' in schema && !same(schema.const, value)) return [err('const')];
  if (schema.enum && !schema.enum.some(e => same(e, value))) return [err('enum')];
  const out = [];
  if (typeof value === 'number') {
    if (schema.minimum != null && value < schema.minimum) out.push(err('minimum'));
    if (schema.maximum != null && value > schema.maximum) out.push(err('maximum'));
    if (schema.exclusiveMinimum != null && value <= schema.exclusiveMinimum) out.push(err('exclusiveMinimum'));
  }
  if (typeof value === 'string' && schema.minLength != null && value.length < schema.minLength) out.push(err('minLength'));
  if (Array.isArray(value)) {
    if (schema.minItems != null && value.length < schema.minItems) out.push(err('minItems'));
    if (schema.items) value.forEach((v, i) => out.push(...validate(schema.items, v, root, [...path, String(i)])));
  }
  if (plain(value)) {
    for (const k of schema.required || []) if (!(k in value)) out.push(err('required', path, {missing: k}));
    const props = schema.properties || {};
    for (const [k, v] of Object.entries(value)) {
      if (props[k]) out.push(...validate(props[k], v, root, [...path, k]));
      else if (schema.additionalProperties === false) out.push(err('additionalProperties', [...path, k]));
      else if (plain(schema.additionalProperties)) out.push(...validate(schema.additionalProperties, v, root, [...path, k]));
    }
    for (const [k, needs] of Object.entries(schema.dependentRequired || {}))
      if (k in value) for (const n of needs) if (!(n in value)) out.push(err('dependentRequired', path, {missing: n}));
  }
  return out;
}
```

- [ ] **Step 4: Run it and check that it passes**

Run: `node --test tests/rack/validate.test.mjs`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add site/rack/validate.js tests/rack/validate.test.mjs
git commit -m "rack: a small JSON Schema validator for command arguments and the rack file

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Commands, the `COMMANDS` table, and `apply`

**Files:**
- Create: `site/rack/commands.js`
- Test: `tests/rack/commands.test.mjs`, `tests/rack/apply.test.mjs`, `tests/rack/commands-table.test.mjs`

**Interfaces:**
- Consumes: `validate` (Task 1); `withItem, updateItem, withoutItem, withFrame, renamed, withDcim, detached, positionOf` from `model.js`; `fits, isRackFace, heightOf, shrinkRack` from `fit.js`; `placement, moveItem, managersOf` from `managers.js`; `canCable, withCable, updateCable, withoutCable, cablesOf, withoutCablesOf, cableName, MEDIA` from `cable-rules.js`.
- Produces:
  - `export const GONE, CABLE_GONE, NOT_ADDED, CLEARED` (sentences)
  - `export const COMMANDS: {[op]: {description, args, step?: false, system?: true, run(rack, args, ctx) -> {rack, summary, findings, created?} | {error}}}`
  - `export function apply(rack, cmds, ctx) -> {rack, summary, findings, created: {[name]: id, ids: id[]}, noop, step} | {error, index}`
  - `ctx` is `{chassisOf}`.

The route commands (`cable.route`, `cable.route.reset`, `lengths.routed`) are added in Task 7, after piece 2's `route.js` exists.

- [ ] **Step 1: Write the failing command tests**

```js
// tests/rack/commands.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../../site/rack/model.js';
import {COMMANDS, GONE, CABLE_GONE, NOT_ADDED, CLEARED} from '../../site/rack/commands.js';

const SIZES = {'as7726-32x': {ru: 1, h: 43.5, d: 515, model: 'AS7726-32X', default: 'ac-f2b'},
               'r740xd': {ru: 2, h: 86.8, d: 737.5, model: 'R740xd', default: 'sff24'},
               'fhd-cmp5dr': {ru: 1, h: 44, d: 110, mount: 'rack-face', model: 'FHD-CMP5DR', default: 'base'},
               'tm-280': {ru: 1, h: 43.6, d: 140.5, model: 'TM-280', default: 'base'}};
const ctx = {chassisOf: ref => SIZES[ref] || null};
const run = (op, rack, args) => COMMANDS[op].run(rack, args, ctx);
const add = (rack, ref, ru, extra = {}) => M.withItem(rack, {ref, cfg: 'x', ru, label: extra.label ?? ref, ...extra}).rack;
const end = (item, path = 'port-1', view = 'front') => ({item, path, view});

test('place: a device goes in, named by its model, and says where', () => {
  const r = run('place', M.newRack(), {ref: 'r740xd', face: 'front', ru: 10});
  assert.equal(r.rack.items[0].label, 'R740xd');
  assert.equal(r.rack.items[0].cfg, 'sff24');
  assert.deepEqual(r.created, {id: 'i1'});
  assert.equal(r.summary, 'Placed R740xd at U10 on the front.');
});

test('place: a refusal is fits() sentence; an unknown device says so', () => {
  const r = add(M.newRack(), 'r740xd', 10, {label: 'srv'});
  assert.deepEqual(run('place', r, {ref: 'as7726-32x', face: 'front', ru: 11}), {error: 'Taken by srv on the front.'});
  assert.deepEqual(run('place', r, {ref: 'nope', face: 'front', ru: 1}), {error: 'No size is known for nope.'});
});

test('place: a cable manager on a device attaches to it', () => {
  const r = add(M.newRack(), 'r740xd', 10, {label: 'srv'});
  const m = run('place', r, {ref: 'fhd-cmp5dr', face: 'front', ru: 11});
  assert.deepEqual([m.rack.items[1].on, m.rack.items[1].unit], ['i1', 2]);
});

test('move: GONE, a refusal, a no-op, and a move', () => {
  let r = add(M.newRack(), 'as7726-32x', 10, {label: 'leaf'});
  r = add(r, 'as7726-32x', 20, {label: 'spine'});
  assert.deepEqual(run('move', r, {id: 'i9', ru: 1}), {error: GONE});
  assert.deepEqual(run('move', r, {id: 'i1', ru: 20}), {error: 'Taken by spine on the front.'});
  assert.equal(run('move', r, {id: 'i1', ru: 10}).rack, r);
  const m = run('move', r, {id: 'i1', ru: 12, face: 'rear'});
  assert.equal(m.summary, 'Moved leaf to U12 on the rear.');
});

test('patch: changes what it names; clears-changes note; same value is a no-op', () => {
  const r = add(M.newRack(), 'as7726-32x', 10, {label: 'leaf', swaps: {'port-1': 'x'}});
  assert.equal(run('patch', r, {id: 'i1', label: 'leaf'}).rack, r);
  const p = run('patch', r, {id: 'i1', cfg: 'other', swaps: {}, fields: {}});
  assert.deepEqual(p.findings, [{kind: 'note', text: CLEARED}]);
  assert.equal(p.rack.items[0].cfg, 'other');
  assert.deepEqual(run('patch', r, {id: 'i7', label: 'x'}), {error: GONE});
});

test('remove: keep or remove its cables, with today\'s sentences', () => {
  let r = add(add(M.newRack(), 'as7726-32x', 10, {label: 'leaf'}), 'as7726-32x', 20, {label: 'spine'});
  r = {...r, cables: [{id: 'c1', a: end('i1'), b: end('i2'), media: '', purpose: '', label: '', route: []},
                      {id: 'c2', a: end('i1', 'port-2'), b: end('i2', 'port-2'), media: '', purpose: '', label: '', route: []}]};
  const keep = run('remove', r, {id: 'i1', cables: 'keep'});
  assert.equal(keep.summary, 'Removed leaf. Its 2 cables are loose ends.');
  assert.equal(keep.rack.cables.length, 2);
  const gone = run('remove', r, {id: 'i1', cables: 'remove'});
  assert.equal(gone.summary, 'Removed leaf and its 2 cables.');
  assert.equal(gone.rack.cables.length, 0);
  assert.equal(run('remove', add(M.newRack(), 'tm-280', 1, {label: 'pp'}), {id: 'i1'}).summary, 'Removed pp.');
});

test('remove: a host\'s managers stay, and the sentence says so', () => {
  let r = add(M.newRack(), 'as7726-32x', 10, {label: 'leaf'});
  r = add(r, 'fhd-cmp5dr', 10, {label: 'mgr', on: 'i1', unit: 1});
  assert.equal(run('remove', r, {id: 'i1'}).summary, 'Removed leaf. Its cable manager mgr stays on the rack.');
});

test('attach and detach', () => {
  let r = add(M.newRack(), 'as7726-32x', 10, {label: 'leaf'});
  r = add(r, 'fhd-cmp5dr', 10, {label: 'mgr'});
  r = add(r, 'fhd-cmp5dr', 30, {label: 'alone'});
  const a = run('attach', r, {id: 'i2'});
  assert.equal(a.summary, 'Attached mgr to leaf.');
  assert.deepEqual(run('attach', r, {id: 'i3'}), {error: 'alone is not over a device.'});
  assert.deepEqual(run('attach', r, {id: 'i1'}), {error: 'leaf is not a cable manager.'});
  const d = run('detach', a.rack, {id: 'i2'});
  assert.equal(d.summary, 'Detached mgr.');
  assert.equal('on' in d.rack.items[1], false);
  assert.equal(run('detach', d.rack, {id: 'i2'}).rack, d.rack);
});

test('frame: a shrink packs down, trims, and says so; holes merge; an echo is a no-op', () => {
  let r = add(add(M.newRack(), 'as7726-32x', 40, {label: 'a'}), 'as7726-32x', 1, {label: 'b'});
  r = {...r, cables: [{id: 'c1', a: end('i2'), b: end('i1'), media: '', purpose: '', label: '', route: []}]};
  const s = run('frame', r, {heightRU: 1});
  // b (U1) is the bottom cluster and goes; a (U40) packs down to U1.
  const text = 'Moved 1 device down and removed 1 from the bottom to fit 1U: b. 1 cable is kept as a loose end.';
  assert.equal(s.summary, text);
  assert.deepEqual(s.findings, [{kind: 'note', text}]);
  const t = run('frame', r, {holes: {style: 'tapped'}});
  assert.equal(t.rack.frame.holes.style, 'tapped');
  assert.equal(run('frame', r, {kind: 'four-post'}).rack, r);
});

test('rename and dcim', () => {
  const r = M.newRack();
  assert.equal(run('rename', r, {name: 'Core A'}).summary, 'Renamed the rack to Core A.');
  assert.deepEqual(run('rename', r, {name: '  '}), {error: 'A rack needs a name.'});
  assert.equal(run('rename', r, {name: r.name}).rack, r);
  assert.deepEqual(run('dcim', r, {site: 'dc1'}).rack.dcim, {site: 'dc1'});
  assert.equal(run('dcim', r, {site: ''}).rack, r);
});

test('cable.add, cable.update, cable.remove', () => {
  const r = add(add(M.newRack(), 'as7726-32x', 10, {label: 'leaf'}), 'as7726-32x', 20, {label: 'spine'});
  const a = run('cable.add', r, {a: end('i1'), b: end('i2'), media: 'om4'});
  assert.deepEqual([a.created, a.summary], [{id: 'c1'}, 'Added cable c1.']);
  assert.deepEqual(run('cable.add', a.rack, {a: end('i1'), b: end('i2', 'port-5')}),
                   {error: 'leaf (U10) port-1 already has a cable (c1).'});
  assert.deepEqual(run('cable.add', r, {a: end('i1'), b: end('i9')}), {error: NOT_ADDED});
  assert.deepEqual(run('cable.add', r, {a: end('i1'), b: end('i1')}), {error: 'A cable needs two different ports.'});
  const u = run('cable.update', a.rack, {id: 'c1', label: 'A1', length: {value: 3}});
  assert.deepEqual(u.rack.cables[0].length, {value: 3, unit: 'm', source: 'entered'});
  assert.equal(u.summary, 'Edited cable A1.');
  assert.equal(run('cable.update', a.rack, {id: 'c1', media: 'om4'}).rack, a.rack);
  assert.deepEqual(run('cable.update', a.rack, {id: 'c9', label: 'x'}), {error: CABLE_GONE});
  assert.equal(run('cable.remove', u.rack, {id: 'c1'}).summary, 'Deleted cable A1.');
});
```

- [ ] **Step 2: Write the failing `apply` and table tests**

```js
// tests/rack/apply.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../../site/rack/model.js';
import {apply} from '../../site/rack/commands.js';

const SIZES = {'as7726-32x': {ru: 1, h: 43.5, d: 515, model: 'AS7726-32X', default: 'ac-f2b'}};
const ctx = {chassisOf: ref => SIZES[ref] || null};
const P = (ru, extra = {}) => ({op: 'place', ref: 'as7726-32x', face: 'front', ru, ...extra});

test('a batch applies whole, and @names reach later commands', () => {
  const r = apply(M.newRack(), [P(10, {as: 'leaf'}), P(20, {as: 'spine'}),
    {op: 'cable.add', a: {item: '@leaf', path: 'port-1', view: 'front'}, b: {item: '@spine', path: 'port-1', view: 'front'}, as: 'up'},
    {op: 'patch', id: '@leaf', label: '@spine'}], ctx);
  assert.equal(r.rack.items.length, 2);
  assert.deepEqual(r.rack.cables[0].a.item, 'i1');
  assert.equal(r.rack.items[0].label, '@spine');          // not an id: kept as written
  assert.deepEqual(r.created, {leaf: 'i1', spine: 'i2', up: 'c1', ids: ['i1', 'i2', 'c1']});
  assert.equal(r.step, true);
  assert.equal(r.noop, false);
});

test('a failing command leaves the rack untouched and says which', () => {
  const rack = M.newRack();
  const r = apply(rack, [P(10), P(11), P(10)], ctx);
  assert.deepEqual(r, {error: 'Taken by AS7726-32X on the front.', index: 2});
});

test('names: unbound, bound twice, and the rack argument', () => {
  const rack = M.newRack();
  assert.deepEqual(apply(rack, [{op: 'move', id: '@x', ru: 2}], ctx), {error: 'Nothing earlier in this batch is called x.', index: 0});
  assert.deepEqual(apply(rack, [P(1, {as: 'a'}), P(2, {as: 'a'})], ctx), {error: 'Two commands in this batch are called a.', index: 1});
  assert.deepEqual(apply(rack, [P(1, {rack: 'r2'})], ctx), {error: 'Only rack r1 can be edited here.', index: 0});
  assert.equal(apply(rack, [P(1, {rack: 'r1'})], ctx).rack.items.length, 1);
});

test('unknown commands and bad arguments are refused in words', () => {
  const rack = M.newRack();
  assert.deepEqual(apply(rack, {op: 'plce'}, ctx), {error: "There is no command called 'plce'.", index: 0});
  assert.deepEqual(apply(rack, {op: 'place', ref: 'as7726-32x', face: 'front'}, ctx),
                   {error: 'place needs ru, a whole number from 1.', index: 0});
  assert.deepEqual(apply(rack, P(1, {face: 'side'}), ctx), {error: 'place needs face, one of front, rear.', index: 0});
  assert.deepEqual(apply(rack, P(1, {colour: 'red'}), ctx), {error: 'place does not take colour.', index: 0});
  assert.deepEqual(apply(rack, 'place', ctx), {error: 'A command is an object with an op.', index: 0});
});

test('a batch of no-ops is a no-op; a dcim-only batch is not a step', () => {
  const rack = M.newRack();
  const n = apply(rack, [{op: 'rename', name: rack.name}], ctx);
  assert.equal(n.noop, true);
  assert.equal(n.rack, rack);
  const d = apply(rack, {op: 'dcim', site: 'dc1'}, ctx);
  assert.deepEqual([d.noop, d.step], [false, false]);
});
```

```js
// tests/rack/commands-table.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {COMMANDS} from '../../site/rack/commands.js';

// An agent reads this table to know what it may send (spec §2.1).
test('every command and every argument is described, briefly', () => {
  for (const [op, def] of Object.entries(COMMANDS)) {
    assert.ok(def.description && def.description.length <= 500, `${op}: description`);
    assert.equal(typeof def.run, 'function', `${op}: run`);
    const walk = (schema, at) => {
      for (const [k, s] of Object.entries(schema.properties || {})) {
        assert.ok(s.description && s.description.length <= 150, `${op}: ${at}${k} needs a description under 150 characters`);
        walk(s, `${at}${k}.`);
      }
    };
    walk(def.args, '');
  }
});

test('every command takes the optional rack argument', () => {
  for (const [op, def] of Object.entries(COMMANDS)) assert.ok(def.args.properties.rack, op);
});
```

- [ ] **Step 3: Run them and check that they fail**

Run: `node --test tests/rack/commands.test.mjs tests/rack/apply.test.mjs tests/rack/commands-table.test.mjs`
Expected: FAIL, `Cannot find module '.../site/rack/commands.js'`

- [ ] **Step 4: Implement `commands.js`**

```js
// site/rack/commands.js
// THE RACK COMMANDS (spec docs/superpowers/specs/2026-10-07-rack-command-core-design.md).
// Every edit of a rack is one of these, run through apply(): the page's own
// controls and an agent alike. A command is pure - the rack, its arguments
// and {chassisOf} in, a new rack out - and says no with a sentence. One that
// changes nothing hands back the very rack it was given, so a caller can tell.

import {withItem, updateItem, withoutItem, withFrame, renamed, withDcim, detached, positionOf} from './model.js';
import {fits, isRackFace, heightOf, shrinkRack} from './fit.js';
import {placement, moveItem, managersOf} from './managers.js';
import {canCable, withCable, updateCable, withoutCable, cablesOf, withoutCablesOf, cableName, MEDIA} from './cable-rules.js';
import {validate} from './validate.js';

export const GONE = 'That device is no longer in the rack.';
export const CABLE_GONE = 'That cable is no longer in the rack.';
export const NOT_ADDED = 'The cable was not added because a device it ran to was removed.';
export const CLEARED = 'Your Explorer changes were for the old configuration, so they were cleared.';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const itemOf = (rack, id) => rack.items.find(i => i.id === id) || null;
const cableOf = (rack, id) => (rack.cables || []).find(c => c.id === id) || null;
const at = (rack, item, chassisOf) => `U${positionOf(rack.frame, item.ru, heightOf(chassisOf)(item))}`;
const done = (rack, summary, extra = {}) => ({rack, summary, findings: [], ...extra});
const unchanged = rack => done(rack, '');
const note = text => ({kind: 'note', text});
const count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// ── items ───────────────────────────────────────────────────────────────
function place(rack, {ref, cfg, face, ru, label}, {chassisOf}) {
  const c = chassisOf(ref);
  const spot = isRackFace(c) ? placement(rack, {face, ru}, chassisOf) : {face, ru};
  const f = fits(rack, {ref, ...spot}, chassisOf);
  if (!f.ok) return {error: f.reason};
  const name = label ?? c?.model ?? ref;
  const {rack: next, item} = withItem(rack, {ref, cfg: cfg ?? c?.default ?? '', ...spot, label: name});
  return done(next, `Placed ${name} at ${at(next, item, chassisOf)} on the ${item.face}.`, {created: {id: item.id}});
}

function move(rack, {id, ru, face}, {chassisOf}) {
  const it = itemOf(rack, id);
  if (!it) return {error: GONE};
  const patch = {...(ru == null ? {} : {ru}), ...(face == null ? {} : {face})};
  if (Object.entries(patch).every(([k, v]) => it[k] === v)) return unchanged(rack);
  // Through managers.js: a manager is re-hosted by where it lands, and a host
  // takes its managers with it.
  const m = moveItem(rack, id, patch, chassisOf);
  if (!m.ok) return {error: m.reason};
  const now = itemOf(m.rack, id);
  return done(m.rack, `Moved ${it.label} to ${at(m.rack, now, chassisOf)} on the ${now.face}.`);
}

// A configuration change is a delta against the OLD configuration: one that
// leaves an item with no swaps or fields to carry forward says they went.
function patch(rack, {id, ...p}) {
  const it = itemOf(rack, id);
  if (!it) return {error: GONE};
  const changes = Object.fromEntries(['cfg', 'swaps', 'fields', 'label', 'turned']
    .filter(k => k in p && !same(p[k], it[k])).map(k => [k, p[k]]));
  if (!Object.keys(changes).length) return unchanged(rack);
  const next = {...it, ...changes};
  const had = Object.keys(it.swaps ?? {}).length || Object.keys(it.fields ?? {}).length;
  const has = Object.keys(next.swaps ?? {}).length || Object.keys(next.fields ?? {}).length;
  return {rack: updateItem(rack, id, changes), summary: `Changed ${it.label}.`,
          findings: 'cfg' in changes && had && !has ? [note(CLEARED)] : []};
}

function remove(rack, {id, cables = 'keep'}) {
  const it = itemOf(rack, id);
  if (!it) return {error: GONE};
  const k = cablesOf(rack, id).length, n = count(k, 'cable');
  const ms = managersOf(rack, id);
  const stay = ms.length ? ` Its cable manager${ms.length === 1 ? '' : 's'} ${ms.map(m => m.label).join(', ')} stay${ms.length === 1 ? 's' : ''} on the rack.` : '';
  if (cables === 'remove')
    return done(withoutCablesOf(withoutItem(rack, id), id), (k ? `Removed ${it.label} and its ${n}.` : `Removed ${it.label}.`) + stay);
  return done(withoutItem(rack, id),
    (k ? `Removed ${it.label}. Its ${n} ${k === 1 ? 'is a loose end' : 'are loose ends'}.` : `Removed ${it.label}.`) + stay);
}

// Bolt an unhosted manager over the device at its own U.
function attach(rack, {id}, {chassisOf}) {
  const it = itemOf(rack, id);
  if (!it) return {error: GONE};
  if (!isRackFace(chassisOf(it.ref))) return {error: `${it.label} is not a cable manager.`};
  if (it.on) return unchanged(rack);
  const m = moveItem(rack, id, {ru: it.ru, face: it.face}, chassisOf);
  if (!m.ok) return {error: m.reason};
  const host = itemOf(m.rack, itemOf(m.rack, id).on);
  if (!host) return {error: `${it.label} is not over a device.`};
  return done(m.rack, `Attached ${it.label} to ${host.label}.`);
}

// The manager keeps its U and loses its host.
function detach(rack, {id}) {
  const it = itemOf(rack, id);
  if (!it) return {error: GONE};
  if (!('on' in it)) return unchanged(rack);
  return done({...rack, items: rack.items.map(i => (i.id === id ? detached(i) : i))}, `Detached ${it.label}.`);
}

// ── the rack ────────────────────────────────────────────────────────────
// A lower height that leaves devices hanging past it packs them down, then
// trims from the bottom (fit.js shrinkRack); a trimmed device's cables stay,
// as loose ends. The form names only the part of `holes` it changed.
function frame(rack, p, {chassisOf}) {
  const want = p.holes ? {...p, holes: {...rack.frame.holes, ...p.holes}} : p;
  if ('heightRU' in want && want.heightRU < rack.frame.heightRU) {
    const {heightRU, ...rest} = want;
    const {rack: shrunk, moved, removed} = shrinkRack(rack, heightRU, chassisOf);
    const next = Object.keys(rest).length ? withFrame(shrunk, rest) : shrunk;
    if (!moved.length && !removed.length) return done(next, `Set the rack to ${heightRU}U.`);
    const dn = n => `device${n === 1 ? '' : 's'}`;
    const names = removed.map(i => i.label).join(', ');
    const text = moved.length && removed.length
      ? `Moved ${moved.length} ${dn(moved.length)} down and removed ${removed.length} from the bottom to fit ${heightRU}U: ${names}.`
      : moved.length
      ? `Moved ${moved.length} ${dn(moved.length)} down to fit ${heightRU}U.`
      : `Removed ${removed.length} ${dn(removed.length)} from the bottom to fit ${heightRU}U: ${names}.`;
    const cut = new Set(removed.flatMap(i => cablesOf(rack, i.id).map(c => c.id))).size;
    const kept = cut ? ` ${cut} ${cut === 1 ? 'cable is kept as a loose end' : 'cables are kept as loose ends'}.` : '';
    return {rack: next, summary: text + kept, findings: [note(text + kept)]};
  }
  const next = withFrame(rack, want);
  return same(next.frame, rack.frame) ? unchanged(rack) : done(next, 'Changed the rack frame.');
}

function rename(rack, {name}) {
  if (!String(name).trim()) return {error: 'A rack needs a name.'};
  return name === rack.name ? unchanged(rack) : done(renamed(rack, name), `Renamed the rack to ${name}.`);
}

function dcim(rack, p) {
  const next = withDcim(rack, p);
  return same(next.dcim, rack.dcim) ? unchanged(rack) : done(next, 'Saved the DCIM import settings.');
}

// ── cables ──────────────────────────────────────────────────────────────
const lengthOf = l => (l ? {value: l.value, unit: l.unit ?? 'm', source: l.source ?? 'entered'} : null);

function cableAdd(rack, {a, b, media = '', purpose = '', label = '', length = null}, {chassisOf}) {
  if (!itemOf(rack, a.item) || !itemOf(rack, b.item)) return {error: NOT_ADDED};
  const can = canCable(rack, a, b, {uOf: heightOf(chassisOf)});
  if (!can.ok) return {error: can.reason};
  const {rack: next, cable} = withCable(rack, {a, b, media, purpose, label, length: lengthOf(length)});
  return done(next, `Added cable ${cableName(cable)}.`, {created: {id: cable.id}});
}

function cableUpdate(rack, {id, ...p}) {
  const c = cableOf(rack, id);
  if (!c) return {error: CABLE_GONE};
  const want = 'length' in p ? {...p, length: lengthOf(p.length)} : p;
  // A length named at all replaces one the loader kept as written.
  const changed = Object.keys(want).filter(k => !same(want[k], c[k] ?? null) || (k === 'length' && 'lengthAsWritten' in c));
  if (!changed.length) return unchanged(rack);
  const next = updateCable(rack, id, want);
  return done(next, `Edited cable ${cableName(cableOf(next, id))}.`);
}

function cableRemove(rack, {id}) {
  const c = cableOf(rack, id);
  return c ? done(withoutCable(rack, id), `Deleted cable ${cableName(c)}.`) : {error: CABLE_GONE};
}

// ── the table an agent reads (spec §2.1, D4) ────────────────────────────
const RACK = {type: 'string', description: 'The id of the rack to edit. Only the first rack can be edited today.'};
const AS = {type: 'string', minLength: 1, description: 'A name for what this creates; later commands in the same batch can use "@name" as its id.'};
const ID = what => ({type: 'string', minLength: 1, description: `The id of the ${what}, as describe() lists it, or "@name" from earlier in this batch.`});
const FACE = {enum: ['front', 'rear'], description: 'Which face of the rack: front or rear.'};
const RU = {type: 'integer', minimum: 1, description: 'The U its bottom sits in, counted from 1 at the bottom of the rails.'};
const END = {type: 'object', required: ['item', 'path', 'view'], additionalProperties: false,
  description: 'One end of a cable: a port on a device.',
  properties: {item: ID('device'), path: {type: 'string', minLength: 1, description: 'The port, as freePorts() names it (e.g. port-1).'},
               view: {enum: ['front', 'rear'], description: "Which of the device's own panels the port is on: front or rear."}}};
const LENGTH = {type: ['object', 'null'], required: ['value'], additionalProperties: false,
  description: 'How long the cable is, or null for not known.',
  properties: {value: {type: 'number', exclusiveMinimum: 0, description: 'The length, above 0.'},
               unit: {enum: ['m', 'ft'], description: 'Metres (m) or feet (ft); m when left out.'},
               source: {type: 'string', description: 'Where the length came from; "entered" when left out.'}}};
const CABLE_FIELDS = {
  media: {enum: ['', ...MEDIA], description: `The cable type: ${MEDIA.join(', ')}, or "" for not known.`},
  purpose: {type: 'string', description: 'What the cable is for, in a word or two (e.g. uplink, management).'},
  label: {type: 'string', description: 'The text on its tags. Its id is used when there is none.'},
  length: LENGTH};
const args = (required, properties) => ({type: 'object', required, additionalProperties: false,
                                         properties: {...properties, rack: RACK}});

export const COMMANDS = {
  place: {run: place, description: 'Put a device in the rack with its bottom at a U on a face. A cable manager put over a device bolts onto it. Refused, with the reason, when it does not fit.',
    args: args(['ref', 'face', 'ru'], {ref: {type: 'string', minLength: 1, description: 'The device, as catalog() lists it (its ref).'},
      cfg: {type: 'string', description: "Which of the device's configurations; its default when left out."},
      face: FACE, ru: RU, label: {type: 'string', description: 'The name shown on the drawing; its model when left out.'}, as: AS})},
  move: {run: move, description: 'Move a device to another U and/or face. Its cable managers move with it; a cable manager moved onto a device bolts onto it.',
    args: args(['id'], {id: ID('device'), ru: RU, face: FACE})},
  patch: {run: patch, description: "Change a placed device's configuration, label, turned state, or its Explorer swaps and fields.",
    args: args(['id'], {id: ID('device'), cfg: {type: 'string', description: 'Which of its configurations.'},
      swaps: {type: 'object', description: 'What is seated where: slot path to part ref, as the Explorer writes it.'},
      fields: {type: 'object', description: 'Editable text on the device, as the Explorer writes it.'},
      label: {type: 'string', description: 'The name shown on the drawing.'},
      turned: {type: 'boolean', description: 'true when mounted back to front.'}})},
  remove: {run: remove, description: 'Take a device out of the rack. Its cables are kept as loose ends, or removed with it; its cable managers stay on the rack.',
    args: args(['id'], {id: ID('device'), cables: {enum: ['keep', 'remove'], description: 'keep its cables as loose ends, or remove them; keep when left out.'}})},
  attach: {run: attach, description: 'Bolt an unattached cable manager onto the device at its U.',
    args: args(['id'], {id: ID('cable manager')})},
  detach: {run: detach, description: 'Unbolt a cable manager from its device; it stays at its U on its own.',
    args: args(['id'], {id: ID('cable manager')})},
  frame: {run: frame, description: 'Change the rack frame. A lower height packs devices down and removes from the bottom what still does not fit; their cables are kept as loose ends.',
    args: args([], {kind: {enum: ['four-post', 'two-post'], description: 'four-post or two-post.'},
      heightRU: {type: 'integer', minimum: 1, description: 'How many U tall.'},
      numbering: {enum: ['bottom-up', 'top-down'], description: 'Which way the U labels count.'},
      holes: {type: 'object', additionalProperties: false, description: 'The rail holes.',
        properties: {style: {enum: ['square', 'tapped'], description: 'square or tapped.'},
                     thread: {enum: ['12-24', '10-32', 'M6', null], description: 'The thread of tapped holes.'}}},
      railDepth: {type: 'number', exclusiveMinimum: 0, description: 'Millimetres between the front and rear rails (four-post).'},
      usableDepth: {type: 'number', exclusiveMinimum: 0, description: 'Millimetres from the front rail to the deepest point a device may reach.'}})},
  rename: {run: rename, description: 'Rename the rack.', args: args(['name'], {name: {type: 'string', description: 'The new name.'}})},
  dcim: {run: dcim, step: false, description: 'Set the names a NetBox or Nautobot import needs: the site (or location) and the device role. Not an undo step.',
    args: args([], {site: {type: 'string', description: "NetBox's site, Nautobot's location."}, role: {type: 'string', description: 'The device role.'}})},
  'cable.add': {run: cableAdd, description: 'Run a cable between two free ports. Refused when a port already has a cable or a device is gone.',
    args: args(['a', 'b'], {a: END, b: END, ...CABLE_FIELDS, as: AS})},
  'cable.update': {run: cableUpdate, description: "Change a cable's type, purpose, label or length.",
    args: args(['id'], {id: ID('cable'), ...CABLE_FIELDS})},
  'cable.remove': {run: cableRemove, description: 'Delete a cable.', args: args(['id'], {id: ID('cable')})},
};

// ── apply (spec §2.2) ───────────────────────────────────────────────────
const typeWord = s => {
  if (s.enum) return `one of ${s.enum.filter(v => v !== null && v !== '').join(', ')}`;
  const t = [].concat(s.type ?? []).find(x => x !== 'null');
  return {integer: `a whole number${s.minimum != null ? ` from ${s.minimum}` : ''}`,
          number: `a number${s.exclusiveMinimum === 0 ? ' above 0' : ''}`, string: 'some text',
          boolean: 'true or false', object: 'an object', array: 'a list'}[t] || 'a value';
};
function sentence(op, e) {
  if (e.keyword === 'required' || e.keyword === 'dependentRequired') {
    const s = e.schema.properties?.[e.missing] || {};
    return `${op} needs ${[...e.path, e.missing].join('.')}, ${typeWord(s)}.`;
  }
  if (e.keyword === 'additionalProperties') return `${op} does not take ${e.path.join('.')}.`;
  return `${op} needs ${e.path.join('.')}, ${typeWord(e.schema)}.`;
}

// Only ids are names: `id`, and the item of a cable end. A label that reads
// "@srv" is a label.
function resolve(cmd, bound) {
  const name = v => (typeof v === 'string' && v.startsWith('@') ? v.slice(1) : null);
  const swap = v => {
    const n = name(v);
    if (n == null) return {v};
    return bound.has(n) ? {v: bound.get(n)} : {error: `Nothing earlier in this batch is called ${n}.`};
  };
  const out = {...cmd};
  for (const k of ['id']) if (k in out) { const s = swap(out[k]); if (s.error) return s; out[k] = s.v; }
  for (const k of ['a', 'b']) if (out[k]?.item != null) {
    const s = swap(out[k].item); if (s.error) return s; out[k] = {...out[k], item: s.v};
  }
  return {cmd: out};
}

export function apply(rack, cmds, ctx) {
  const list = Array.isArray(cmds) ? cmds : [cmds];
  const seen = new Set();
  for (const [index, c] of list.entries()) {
    if (c?.as == null) continue;
    if (seen.has(c.as)) return {error: `Two commands in this batch are called ${c.as}.`, index};
    seen.add(c.as);
  }
  const bound = new Map(), created = {}, ids = [], summaries = [], findings = [];
  let cur = rack, step = false;
  for (const [index, raw] of list.entries()) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || typeof raw.op !== 'string')
      return {error: 'A command is an object with an op.', index};
    const def = Object.hasOwn(COMMANDS, raw.op) ? COMMANDS[raw.op] : null;
    if (!def) return {error: `There is no command called '${raw.op}'.`, index};
    const {op, ...given} = raw;
    const bad = validate(def.args, given)[0];
    if (bad) return {error: sentence(op, bad), index};
    if (given.rack != null && given.rack !== rack.id) return {error: `Only rack ${rack.id} can be edited here.`, index};
    const r = resolve(given, bound);
    if (r.error) return {error: r.error, index};
    const {as, rack: _which, ...a} = r.cmd;
    const res = def.run(cur, a, ctx);
    if (res.error) return {error: res.error, index};
    if (res.rack !== cur) {
      if (def.step !== false) step = true;
      if (res.summary) summaries.push(res.summary);
    }
    findings.push(...res.findings);
    if (res.created) {
      ids.push(res.created.id);
      if (as != null) { bound.set(as, res.created.id); created[as] = res.created.id; }
    }
    cur = res.rack;
  }
  return {rack: cur, summary: summaries.join(' '), findings, created: {...created, ids}, noop: cur === rack, step};
}
```

- [ ] **Step 5: Run the tests and check that they pass**

Run: `node --test tests/rack/commands.test.mjs tests/rack/apply.test.mjs tests/rack/commands-table.test.mjs`
Expected: PASS. If a sentence assertion fails, the test is right and the code is wrong: the sentences are today's (`rack-page.js` `commitFrame`, the remove panel, `managersStay`), copied exactly.

- [ ] **Step 6: Run the whole node suite**

Run: `node --test tests/*/*.test.mjs`
Expected: PASS, with nothing else broken.

- [ ] **Step 7: Commit**

```bash
git add site/rack/commands.js tests/rack/commands.test.mjs tests/rack/apply.test.mjs tests/rack/commands-table.test.mjs
git commit -m "rack: every edit as a named command, applied whole or not at all

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: History and the headless editor

**Files:**
- Create: `site/rack/history.js`, `site/rack/editor.js`
- Test: `tests/rack/history.test.mjs`, `tests/rack/editor.test.mjs`

**Interfaces:**
- Consumes: `apply` (Task 2), `settleManagers` from `managers.js`.
- Produces:
  - `createHistory({cap = 100}) -> {record(before, after, summary, origin), undo() -> step | null, redo() -> step | null, clear(), canUndo, canRedo, undoSummary, redoSummary}`, where a step is `{before, after, summary, origin}`.
  - `createRackEditor({doc, chassisOf, cap = 100}) -> {getDoc(), rack(), loadDoc(doc) -> {findings}, apply(cmds, {origin = 'ui'}) -> apply's result, preview(cmds) -> apply's result, undo() -> {summary} | null, redo() -> {summary} | null, replaceRack(next, summary = 'Changed the rack.', origin = 'probe'), canUndo, canRedo, undoSummary, redoSummary, on('change', fn) -> unsubscribe}`.
  - A change event is `{cause: 'apply' | 'undo' | 'redo' | 'load', origin, step: boolean, commands, summary, findings, before, after}`. `before` is `null` on load.

- [ ] **Step 1: Write the failing tests**

```js
// tests/rack/history.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHistory} from '../../site/rack/history.js';

test('undo and redo walk the steps in order; a new step clears redo', () => {
  const h = createHistory();
  h.record('a', 'b', 'one'); h.record('b', 'c', 'two');
  assert.deepEqual([h.canUndo, h.undoSummary, h.canRedo], [true, 'two', false]);
  assert.equal(h.undo().before, 'b');
  assert.equal(h.redoSummary, 'two');
  assert.equal(h.undo().before, 'a');
  assert.equal(h.undo(), null);
  assert.equal(h.redo().after, 'b');
  h.record('b', 'x', 'three');
  assert.equal(h.canRedo, false);
});

test('the oldest step goes past the cap; clear empties both ways', () => {
  const h = createHistory({cap: 2});
  h.record(1, 2, 'a'); h.record(2, 3, 'b'); h.record(3, 4, 'c');
  assert.equal(h.undo().summary, 'c');
  assert.equal(h.undo().summary, 'b');
  assert.equal(h.undo(), null);
  h.clear();
  assert.deepEqual([h.canUndo, h.canRedo], [false, false]);
});
```

```js
// tests/rack/editor.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../../site/rack/model.js';
import {createRackEditor} from '../../site/rack/editor.js';

const SIZES = {'as7726-32x': {ru: 1, h: 43.5, d: 515, model: 'AS7726-32X', default: 'ac-f2b'},
               'fhd-cmp5dr': {ru: 1, h: 44, d: 110, mount: 'rack-face', model: 'FHD-CMP5DR', default: 'base'}};
const chassisOf = ref => SIZES[ref] || null;
const P = ru => ({op: 'place', ref: 'as7726-32x', face: 'front', ru});
const fresh = () => { const ed = createRackEditor({doc: M.newDoc(), chassisOf}); const evs = []; ed.on('change', e => evs.push(e)); return {ed, evs}; };

test('apply records a step, emits once, and carries its origin through undo and redo', () => {
  const {ed, evs} = fresh();
  ed.apply(P(10), {origin: 'agent'});
  assert.equal(ed.rack().items.length, 1);
  assert.deepEqual(evs.map(e => [e.cause, e.origin, e.step]), [['apply', 'agent', true]]);
  assert.equal(ed.undoSummary, 'Placed AS7726-32X at U10 on the front.');
  assert.deepEqual(ed.undo(), {summary: 'Placed AS7726-32X at U10 on the front.'});
  assert.equal(ed.rack().items.length, 0);
  ed.redo();
  assert.equal(ed.rack().items.length, 1);
  assert.deepEqual(evs.map(e => [e.cause, e.origin]), [['apply', 'agent'], ['undo', 'agent'], ['redo', 'agent']]);
});

test('an error or a no-op records, emits and changes nothing', () => {
  const {ed, evs} = fresh();
  const before = ed.getDoc();
  assert.ok(ed.apply([P(10), P(10)]).error);
  assert.ok(ed.apply({op: 'rename', name: 'Rack 1'}).noop);
  assert.equal(ed.getDoc(), before);
  assert.deepEqual([evs.length, ed.canUndo], [0, false]);
});

test('preview is apply without the commit', () => {
  const {ed, evs} = fresh();
  const r = ed.preview(P(10));
  assert.equal(r.rack.items.length, 1);
  assert.deepEqual([ed.rack().items.length, evs.length, ed.canUndo], [0, 0, false]);
});

test('dcim is not a step, and undo and redo keep the settings as they are now', () => {
  const {ed, evs} = fresh();
  ed.apply(P(10));
  ed.apply({op: 'dcim', site: 'dc1'});
  assert.equal(evs.at(-1).step, false);
  assert.equal(ed.undoSummary, 'Placed AS7726-32X at U10 on the front.');
  ed.undo();
  assert.deepEqual([ed.rack().items.length, ed.rack().dcim], [0, {site: 'dc1'}]);
  ed.redo();
  assert.deepEqual([ed.rack().items.length, ed.rack().dcim], [1, {site: 'dc1'}]);
});

test('loadDoc settles managers, returns the repairs, and clears history', () => {
  const {ed, evs} = fresh();
  ed.apply(P(10));
  const doc = M.newDoc();
  doc.racks[0].items = [{id: 'i1', ref: 'fhd-cmp5dr', cfg: 'base', label: 'mgr', ru: 5, face: 'front', turned: false, swaps: {}, fields: {}, on: 'i9', unit: 1}];
  const {findings} = ed.loadDoc(doc);
  assert.equal(findings.length, 1);
  assert.match(findings[0].text, /the device it was on is not in this rack/);
  assert.equal('on' in ed.rack().items[0], false);
  assert.deepEqual([ed.canUndo, ed.canRedo, evs.at(-1).cause], [false, false, 'load']);
});

test('replaceRack is one step with its summary', () => {
  const {ed} = fresh();
  ed.replaceRack({...ed.rack(), name: 'X'}, 'Dropped demarc.');
  assert.deepEqual([ed.rack().name, ed.undoSummary], ['X', 'Dropped demarc.']);
});
```

- [ ] **Step 2: Run them and check that they fail**

Run: `node --test tests/rack/history.test.mjs tests/rack/editor.test.mjs`
Expected: FAIL, modules not found

- [ ] **Step 3: Implement `history.js`**

```js
// site/rack/history.js
// UNDO AND REDO AS SNAPSHOTS (spec §2.3): each step keeps the rack before and
// after it whole. Racks are never mutated, so a snapshot costs a reference,
// not a copy. Past the cap the oldest step is forgotten.

export function createHistory({cap = 100} = {}) {
  let past = [], future = [];
  return {
    record(before, after, summary, origin = 'ui') {
      past.push({before, after, summary, origin});
      if (past.length > cap) past.shift();
      future = [];
    },
    undo() { const s = past.pop(); if (s) future.push(s); return s ?? null; },
    redo() { const s = future.pop(); if (s) past.push(s); return s ?? null; },
    clear() { past = []; future = []; },
    get canUndo() { return past.length > 0; },
    get canRedo() { return future.length > 0; },
    get undoSummary() { return past.at(-1)?.summary ?? ''; },
    get redoSummary() { return future.at(-1)?.summary ?? ''; },
  };
}
```

- [ ] **Step 4: Implement `editor.js`**

```js
// site/rack/editor.js
// THE HEADLESS RACK EDITOR (spec §2.4): a document, its history, and the one
// way in for edits. The page draws what it is told by `change`; an agent drives
// the same object. Selection is the page's, not this.

import {apply as applyCommands} from './commands.js';
import {settleManagers} from './managers.js';
import {createHistory} from './history.js';

// What a command that is not a step owns is kept across an undo or redo: Undo
// never takes the DCIM settings back (spec §3.3). Routed lengths are measured
// again by the next render, so they need nothing here.
const keepDcim = (rack, from) => {
  const {dcim: _old, ...bare} = rack;
  return 'dcim' in from ? {...bare, dcim: from.dcim} : bare;
};

export function createRackEditor({doc, chassisOf, cap = 100}) {
  const ctx = {chassisOf};
  const history = createHistory({cap});
  const listeners = new Set();
  let current = doc;
  const rack = () => current.racks[0];
  const put = next => { current = {...current, racks: [next, ...current.racks.slice(1)]}; };
  const emit = ev => { for (const fn of [...listeners]) fn(ev); };
  const list = cmds => (Array.isArray(cmds) ? cmds : [cmds]);

  function apply(cmds, {origin = 'ui'} = {}) {
    const commands = list(cmds), before = rack();
    const res = applyCommands(before, commands, ctx);
    if (res.error || res.noop) return res;
    put(res.rack);
    if (res.step) history.record(before, res.rack, res.summary, origin);
    emit({cause: 'apply', origin, step: res.step, commands, summary: res.summary, findings: res.findings, before, after: res.rack});
    return res;
  }

  function travel(cause) {
    const s = cause === 'undo' ? history.undo() : history.redo();
    if (!s) return null;
    const before = rack(), after = keepDcim(cause === 'undo' ? s.before : s.after, before);
    put(after);
    emit({cause, origin: s.origin, step: true, commands: [], summary: s.summary, findings: [], before, after});
    return {summary: s.summary};
  }

  return {
    getDoc: () => current,
    rack,
    loadDoc(next) {
      const findings = [];
      const racks = next.racks.map(r => {
        const s = settleManagers(r, chassisOf);
        findings.push(...s.notices.map(text => ({kind: 'note', text})));
        return s.rack;
      });
      current = {...next, racks};
      history.clear();
      emit({cause: 'load', origin: 'ui', step: false, commands: [], summary: '', findings, before: null, after: rack()});
      return {findings};
    },
    apply,
    preview: cmds => applyCommands(rack(), list(cmds), ctx),
    undo: () => travel('undo'),
    redo: () => travel('redo'),
    // For the probe hook only (?probe=1): a whole rack put in as one step.
    replaceRack(next, summary = 'Changed the rack.', origin = 'probe') {
      const before = rack();
      put(next);
      history.record(before, next, summary, origin);
      emit({cause: 'apply', origin, step: true, commands: [], summary, findings: [], before, after: next});
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

- [ ] **Step 5: Run the tests and check that they pass**

Run: `node --test tests/rack/history.test.mjs tests/rack/editor.test.mjs`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add site/rack/history.js site/rack/editor.js tests/rack/history.test.mjs tests/rack/editor.test.mjs
git commit -m "rack: a headless editor with step-by-step undo and redo and change events

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Queries

**Files:**
- Create: `site/rack/queries.js`
- Test: `tests/rack/queries.test.mjs`

**Interfaces:**
- Consumes: `fits, isRackFace, heightOf` (`fit.js`), `placement, managersOf` (`managers.js`), `uLabel` (`model.js`), `portFree, endKey, proposeMedia, mismatch` (`cable-rules.js`), `catalogEntries` (`chassis.js`), `GONE` (`commands.js`).
- Produces:
  - `fitsAt(rack, {ref, face, ru}, {chassisOf}) -> {ok} | {ok: false, reason}`
  - `freeUs(rack, {ref, face}, {chassisOf}) -> number[]`
  - `catalog(devices, {text, ru, family, mount} = {}) -> Array<{ref, manufacturer, model, ru, mount, family, configs, default}>`
  - `describe(rack, {chassisOf}) -> string`
  - `async freePorts(rack, itemId, {portsOf}) -> Array<{path, view, label, media, speed}> | {error}`, where `portsOf(item, view) -> Promise<Array<{path, cls, media, speed, group}>>`
  - `async suggestMedia(rack, a, b, {cableFacts}) -> {media, warnings: string[]}`
  - `async looseEnds(rack, {cableFacts}) -> {unchecked: boolean, ends: Array<{cable, side, end, reason}>}`

- [ ] **Step 1: Write the failing test**

```js
// tests/rack/queries.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../../site/rack/model.js';
import * as Q from '../../site/rack/queries.js';

const SIZES = {'as7726-32x': {ru: 1, h: 43.5, d: 515, model: 'AS7726-32X', manufacturer: 'Accton', configs: ['ac-f2b'], default: 'ac-f2b', family: null},
               'r740xd': {ru: 2, h: 86.8, d: 737.5, model: 'R740xd', manufacturer: 'Dell', configs: ['a', 'b'], default: 'a', family: 'poweredge'},
               'fhd-cmp5dr': {ru: 1, h: 44, d: 110, mount: 'rack-face', model: 'FHD-CMP5DR', manufacturer: 'FS.com', configs: ['base'], default: 'base', family: null}};
const ctx = {chassisOf: ref => SIZES[ref] || null};
const add = (rack, ref, ru, extra = {}) => M.withItem(rack, {ref, cfg: 'x', ru, label: extra.label ?? ref, ...extra}).rack;

test('fitsAt and freeUs', () => {
  const r = add(M.newRack(), 'r740xd', 10, {label: 'srv'});
  assert.deepEqual(Q.fitsAt(r, {ref: 'as7726-32x', face: 'front', ru: 11}, ctx), {ok: false, reason: 'Taken by srv on the front.'});
  const us = Q.freeUs(r, {ref: 'as7726-32x', face: 'front'}, ctx);
  assert.equal(us.includes(10) || us.includes(11), false);
  assert.equal(us.length, 40);
});

test('catalog filters by text, height, family and mount', () => {
  assert.deepEqual(Q.catalog(SIZES, {text: 'dell'}).map(e => e.ref), ['r740xd']);
  assert.deepEqual(Q.catalog(SIZES, {ru: 1}).map(e => e.ref), ['as7726-32x', 'fhd-cmp5dr']);
  assert.deepEqual(Q.catalog(SIZES, {mount: 'rack-face'}).map(e => e.ref), ['fhd-cmp5dr']);
  assert.deepEqual(Q.catalog(SIZES, {family: 'poweredge'})[0],
    {ref: 'r740xd', manufacturer: 'Dell', model: 'R740xd', ru: 2, mount: 'rack', family: 'poweredge', configs: ['a', 'b'], default: 'a'});
});

test('describe: the frame, items with U ranges and managers, cables', () => {
  let r = add(M.newRack(), 'r740xd', 10, {label: 'srv'});
  r = add(r, 'fhd-cmp5dr', 11, {label: 'mgr', on: 'i1', unit: 2});
  r = {...r, cables: [{id: 'c1', a: {item: 'i1', path: 'port-1', view: 'rear'}, b: {item: 'i9', path: 'p', view: 'front'}, media: 'om4', purpose: '', label: '', route: []}]};
  const text = Q.describe(r, ctx);
  assert.match(text, /^Rack 1: 42U four-post, square holes, numbered bottom-up\./);
  assert.match(text, /i1 srv U10-U11 front, carries i2/);
  assert.match(text, /i2 mgr U11 front, on i1 unit 2/);
  assert.match(text, /c1: i1\/port-1 \(rear\) <-> i9\/p, om4/);
});

test('describe stays under 1.5K characters for a full 42U rack, and says what it shortened', () => {
  let r = M.newRack();
  for (let u = 1; u <= 42; u++) r = add(r, 'as7726-32x', u, {label: `leaf-switch-number-${u}`});
  r = {...r, cables: Array.from({length: 30}, (_, k) => ({id: `c${k + 1}`, a: {item: `i${k + 1}`, path: 'port-12', view: 'front'},
    b: {item: `i${k + 2}`, path: 'port-12', view: 'front'}, media: 'om4', purpose: '', label: '', route: []}))};
  const text = Q.describe(r, ctx);
  assert.ok(text.length <= 1500, `${text.length} characters`);
  assert.match(text, /shortened|more/);
});

test('freePorts, suggestMedia and looseEnds read through ctx', async () => {
  let r = add(add(M.newRack(), 'as7726-32x', 10, {label: 'a'}), 'as7726-32x', 20, {label: 'b'});
  r = {...r, cables: [{id: 'c1', a: {item: 'i1', path: 'port-1', view: 'front'}, b: {item: 'i2', path: 'port-1', view: 'front'}, media: '', purpose: '', label: '', route: []}]};
  const portsOf = async (item, view) => (view === 'front'
    ? [{path: 'port-1', cls: 'port', media: 'lc', speed: '100G'}, {path: 'port-2', cls: 'port', media: 'lc', speed: '100G'}, {path: 'slot-1', cls: 'bay'}] : []);
  assert.deepEqual(await Q.freePorts(r, 'i1', {portsOf}), [{path: 'port-2', view: 'front', label: 'port 2', media: 'lc', speed: '100G'}]);
  assert.deepEqual(await Q.freePorts(r, 'i9', {portsOf}), {error: 'That device is no longer in the rack.'});
  const fiber = {family: 'fiber', mode: 'multimode'}, copper = {family: 'copper', mode: null};
  const cableFacts = async (_rack, extra = []) => ({seats: {}, ends: new Map([
    ['i1|front|port-1', {info: fiber, reason: null}], ['i2|front|port-1', {info: fiber, reason: 'port-1 holds no optic'}],
    ['i1|front|port-2', {info: fiber}], ['i2|front|port-2', {info: copper}]])});
  const s = await Q.suggestMedia(r, {item: 'i1', path: 'port-2', view: 'front'}, {item: 'i2', path: 'port-2', view: 'front'}, {cableFacts});
  assert.equal(s.media, 'om4');
  assert.equal(s.warnings[0], 'The ends differ: A is fiber, B is copper.');
  assert.deepEqual(await Q.looseEnds(r, {cableFacts}),
    {unchecked: false, ends: [{cable: 'c1', side: 'b', end: {item: 'i2', path: 'port-1', view: 'front'}, reason: 'port-1 holds no optic'}]});
});
```

- [ ] **Step 2: Run it and check that it fails**

Run: `node --test tests/rack/queries.test.mjs`
Expected: FAIL, module not found

- [ ] **Step 3: Implement**

```js
// site/rack/queries.js
// QUESTIONS ABOUT A RACK (spec §2.5), for an agent deciding what to send and
// for a page that wants to ask before it acts. Pure; the two that read faces
// are handed their readers in `ctx`, since reading a face needs the network and
// a DOMParser, which this module never touches.

import {fits, isRackFace, heightOf} from './fit.js';
import {placement, managersOf} from './managers.js';
import {uLabel} from './model.js';
import {portFree, endKey, proposeMedia, mismatch} from './cable-rules.js';
import {catalogEntries} from './chassis.js';
import {GONE} from './commands.js';

export function fitsAt(rack, {ref, face, ru}, {chassisOf}) {
  const spot = isRackFace(chassisOf(ref)) ? placement(rack, {face, ru}, chassisOf) : {face, ru};
  return fits(rack, {ref, ...spot}, chassisOf);
}

export const freeUs = (rack, {ref, face}, ctx) =>
  Array.from({length: rack.frame.heightRU}, (_, k) => k + 1).filter(ru => fitsAt(rack, {ref, face, ru}, ctx).ok);

export function catalog(devices, {text, ru, family, mount} = {}) {
  const t = text ? String(text).toLowerCase() : null;
  return catalogEntries(devices)
    .filter(e => !t || [e.name, e.manufacturer, e.model].some(v => String(v ?? '').toLowerCase().includes(t)))
    .filter(e => ru == null || e.ru === ru)
    .filter(e => family == null || e.family === family)
    .filter(e => mount == null || (e.mount || 'rack') === mount)
    .map(e => ({ref: e.name, manufacturer: e.manufacturer ?? null, model: e.model ?? null, ru: e.ru,
                mount: e.mount || 'rack', family: e.family ?? null, configs: e.configs ?? [], default: e.default ?? null}));
}

// A SHORT READING OF THE RACK for an agent: the ids it needs to address
// anything, in about 1.5K characters (WebMCP's guidance for tool output). A
// long rack loses its labels first, then its tail, and says so.
const LIMIT = 1500;
export function describe(rack, {chassisOf}) {
  const f = rack.frame;
  const holes = f.holes.style === 'tapped' ? `tapped${f.holes.thread ? ` ${f.holes.thread}` : ''} holes` : 'square holes';
  const head = `${rack.name}: ${f.heightRU}U ${f.kind}, ${holes}, numbered ${f.numbering}.`;
  const uOf = heightOf(chassisOf);
  const span = i => {
    const [a, b] = [uLabel(f, i.ru), uLabel(f, i.ru + uOf(i) - 1)].sort((x, y) => x - y);
    return a === b ? `U${a}` : `U${a}-U${b}`;
  };
  const item = (i, short) => {
    const ms = managersOf(rack, i.id).map(m => m.id);
    return [`${i.id}${short ? '' : ` ${i.label}`} ${span(i)} ${i.face}${i.turned ? ' turned' : ''}`,
            ...(i.on ? [`on ${i.on} unit ${i.unit}`] : []), ...(ms.length ? [`carries ${ms.join(' ')}`] : [])].join(', ');
  };
  const side = e => `${e.item}/${e.path}${e.view === 'rear' ? ' (rear)' : ''}`;
  const cable = c => `${c.id}: ${side(c.a)} <-> ${side(c.b)}${c.media ? `, ${c.media}` : ''}`;
  const items = [...rack.items].sort((a, b) => b.ru - a.ru);
  const cables = rack.cables || [];
  const build = (short, nItems, nCables) => {
    const lines = [head, items.length ? 'Items:' : 'No items.', ...items.slice(0, nItems).map(i => item(i, short)),
                   ...(cables.length ? ['Cables:', ...cables.slice(0, nCables).map(cable)] : [])];
    const more = (items.length - nItems) + (cables.length - nCables);
    if (short) lines.push(more ? `Shortened: labels left out, and ${more} more not listed; ask for them by id.` : 'Shortened: labels left out.');
    return lines.join('\n');
  };
  let out = build(false, items.length, cables.length);
  if (out.length <= LIMIT) return out;
  let ni = items.length, nc = cables.length;
  out = build(true, ni, nc);
  while (out.length > LIMIT && (ni || nc)) {
    if (nc >= ni && nc) nc--; else ni--;
    out = build(true, ni, nc);
  }
  return out;
}

// The ports of a device with no cable, on either of its panels.
export async function freePorts(rack, itemId, {portsOf}) {
  const item = rack.items.find(i => i.id === itemId);
  if (!item) return {error: GONE};
  const out = [];
  for (const view of ['front', 'rear']) {
    for (const p of await portsOf(item, view)) {
      if (p.cls !== 'port') continue;
      if (!portFree(rack, {item: itemId, path: p.path, view}).ok) continue;
      out.push({path: p.path, view, label: p.path.replace(/-/g, ' '), media: p.media ?? null, speed: p.speed ?? null});
    }
  }
  return out;
}

export async function suggestMedia(rack, a, b, {cableFacts}) {
  const facts = await cableFacts(rack, [a, b]);
  const info = e => facts.ends.get(endKey(e))?.info || null;
  const media = proposeMedia(info(a), info(b));
  return {media, warnings: mismatch(media, info(a), info(b))};
}

export async function looseEnds(rack, {cableFacts}) {
  const facts = await cableFacts(rack);
  const ends = (rack.cables || []).flatMap(c => [['a', c.a], ['b', c.b]]
    .map(([side, end]) => ({cable: c.id, side, end, reason: facts.ends.get(endKey(end))?.reason ?? null})))
    .filter(x => x.reason);
  return {unchecked: !!facts.unchecked, ends};
}
```

- [ ] **Step 4: Run it and check that it passes**

Run: `node --test tests/rack/queries.test.mjs`
Expected: PASS. If the `describe` regexes miss by punctuation, fix the code to produce exactly the asserted lines. The asserted shape is the contract an agent reads.

- [ ] **Step 5: Commit**

```bash
git add site/rack/queries.js tests/rack/queries.test.mjs
git commit -m "rack: queries an agent asks before it acts - catalog, describe, free Us and ports

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The rack schema, published

**Files:**
- Create: `site/rack/rack.schema.json`
- Modify: `schemawalk.py` (add `site_documents()` and `all_documents()`), `check-contract.py` (count and keyword checks over all documents), `check-browser.py:2224` (`check_schema_coverage` walks all documents), `site/schema.js:22-30` and `:383-388`, `schema.html:82` and `:93-96`
- Test: `tests/rack/schema.test.mjs`

**Interfaces:**
- Produces: `site/rack/rack.schema.json`, `$id` `https://portrayal.dev/schemas/v1/rack.schema.json`. Its keywords are all in `site/schema.js`'s `KNOWN`.

- [ ] **Step 1: Write the failing test**

```js
// tests/rack/schema.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {validate} from '../../site/rack/validate.js';
import * as M from '../../site/rack/model.js';

const SCHEMA = JSON.parse(readFileSync(new URL('../../site/rack/rack.schema.json', import.meta.url)));
const errs = d => validate(SCHEMA, JSON.parse(M.serialize(d))).map(e => `${e.keyword} at /${e.path.join('/')}`);

test('a new document, and one with every kind of thing in it, validate', () => {
  assert.deepEqual(errs(M.newDoc()), []);
  const d = M.parseDoc({format: 'portrayal-rack', version: 2, racks: [{name: 'R', frame: {kind: 'four-post', heightRU: 42, holes: {style: 'tapped', thread: 'M6'}},
    dcim: {site: 'dc1', role: 'leaf', extra: 'kept'},
    items: [{id: 'i1', ref: 'a', cfg: 'x', ru: 1, face: 'front', swaps: {'p': 'q'}, fields: {f: 1}},
            {id: 'i2', ref: 'm', cfg: 'x', ru: 1, face: 'front', on: 'i1', unit: 1}],
    cables: [{id: 'c1', a: {item: 'i1', path: 'p1', view: 'front'}, b: {item: 'i9', path: 'p2'}, media: 'om4',
              length: {value: 3, unit: 'cm'}, route: [], note: 'kept'},
             {id: 'c2', a: {item: 'i1', path: 'p3'}, b: {item: 'i1', path: 'p4'}, length: {value: 'abc'}}]}]});
  assert.deepEqual(errs(d), []);
});

test('every fixture rack in tests/ that parseDoc accepts validates', () => {
  const dir = new URL('../fixtures/', import.meta.url);
  let files = [];
  try { files = readdirSync(dir).filter(f => f.endsWith('.json')); } catch { /* no fixtures dir */ }
  for (const f of files) {
    let doc;
    try { doc = M.parseDoc(readFileSync(new URL(f, dir), 'utf8')); } catch { continue; }
    assert.deepEqual(errs(doc), [], f);
  }
});

test('on without unit, a bad face and a bad version are refused', () => {
  const d = M.newDoc();
  d.racks[0].items = [{id: 'i1', ref: 'a', cfg: '', label: 'a', ru: 1, face: 'front', turned: false, swaps: {}, fields: {}, on: 'i2'}];
  assert.ok(errs(d).some(e => e.startsWith('dependentRequired')));
  d.racks[0].items[0] = {...d.racks[0].items[0], unit: 1, face: 'side'};
  assert.ok(errs(d).some(e => e.startsWith('enum')));
  assert.ok(errs({...M.newDoc(), version: 3}).some(e => e.startsWith('const')));
});
```

Before writing the fixture test, find where the browser checks keep their rack fixtures: `grep -n "fixture" check-browser.py | head` and `ls tests`. Point `dir` at that folder if it isn't `tests/fixtures/`. If there is no fixtures folder, the test passes trivially. In that case, also add a test that validates `M.parseDoc` of the rack `open_cabled` builds (copy its literal from `check-browser.py:6540`).

- [ ] **Step 2: Run it and check that it fails**

Run: `node --test tests/rack/schema.test.mjs`
Expected: FAIL, `ENOENT ... rack.schema.json`

- [ ] **Step 3: Write the schema**

```json
{
 "$schema": "https://json-schema.org/draft/2020-12/schema",
 "$id": "https://portrayal.dev/schemas/v1/rack.schema.json",
 "title": "Portrayal rack file (v2)",
 "description": "A Rack Builder document: one or more racks, the devices in them, and the cables between their ports. What site/rack/model.js parseDoc accepts and serialize writes.",
 "type": "object",
 "required": ["format", "version", "id", "racks"],
 "properties": {
  "format": {"const": "portrayal-rack", "description": "Always portrayal-rack."},
  "version": {"const": 2, "description": "The file version. Older files are migrated on load; newer ones are refused."},
  "id": {"type": "string", "minLength": 1, "description": "The document's id, unique in a browser's library."},
  "racks": {"type": "array", "minItems": 1, "description": "The racks. The Rack Builder edits the first.", "items": {"$ref": "#/$defs/rack"}}
 },
 "$defs": {
  "rack": {
   "type": "object",
   "required": ["id", "name", "frame", "items", "zeroU", "cables"],
   "properties": {
    "id": {"type": "string", "description": "Unique within the document."},
    "name": {"type": "string", "description": "What the rack is called."},
    "frame": {"$ref": "#/$defs/frame"},
    "items": {"type": "array", "description": "Devices and cable managers on the rails.", "items": {"$ref": "#/$defs/item"}},
    "zeroU": {"type": "array", "description": "Side-mounted parts along the attachment points. Reserved: none can be placed yet.", "items": {"type": "object"}},
    "cables": {"type": "array", "description": "Port-to-port cables.", "items": {"$ref": "#/$defs/cable"}},
    "dcim": {"type": "object", "description": "Names a NetBox or Nautobot import needs. Present only once set; unknown fields are kept.",
     "properties": {"site": {"type": "string", "description": "NetBox's site, Nautobot's location."}, "role": {"type": "string", "description": "The device role."}}}
   }
  },
  "frame": {
   "type": "object",
   "required": ["kind", "heightRU", "numbering", "holes", "railDepth", "usableDepth", "ref"],
   "properties": {
    "kind": {"enum": ["four-post", "two-post"], "description": "Four posts, or two."},
    "heightRU": {"type": "integer", "minimum": 1, "description": "How many U tall."},
    "numbering": {"enum": ["bottom-up", "top-down"], "description": "Which way the U labels count. Positions are always stored bottom-up."},
    "holes": {"type": "object", "required": ["style", "thread"], "description": "The rail holes.",
     "properties": {"style": {"enum": ["square", "tapped"], "description": "Square (cage nuts) or tapped."},
                    "thread": {"enum": ["12-24", "10-32", "M6", null], "description": "The thread of tapped holes; null for square."}}},
    "railDepth": {"type": ["number", "null"], "exclusiveMinimum": 0, "description": "Millimetres between front and rear rails; null on two posts."},
    "usableDepth": {"type": "number", "exclusiveMinimum": 0, "description": "Millimetres from the front rail to the deepest point a device may reach."},
    "ref": {"type": ["string", "null"], "description": "A catalog rack this frame was taken from, if any."}
   }
  },
  "item": {
   "type": "object",
   "required": ["id", "ref", "cfg", "label", "ru", "face", "turned", "swaps", "fields"],
   "dependentRequired": {"on": ["unit"], "unit": ["on"]},
   "properties": {
    "id": {"type": "string", "minLength": 1, "description": "Unique within the rack, and never reused while a cable end names it."},
    "ref": {"type": "string", "minLength": 1, "description": "The device, by its catalog ref."},
    "cfg": {"type": "string", "description": "Which of the device's configurations."},
    "label": {"type": "string", "description": "The name shown on the drawing."},
    "ru": {"type": "integer", "minimum": 1, "description": "The U its bottom sits in, counted bottom-up."},
    "face": {"enum": ["front", "rear"], "description": "The face it is mounted on."},
    "turned": {"type": "boolean", "description": "Mounted back to front."},
    "swaps": {"type": "object", "description": "What the Explorer seated: slot path to part ref."},
    "fields": {"type": "object", "description": "Editable text the Explorer set."},
    "on": {"type": "string", "description": "A cable manager's host: the id of the device it bolts over."},
    "unit": {"type": "integer", "minimum": 1, "description": "Which of the host's units, from 1 at its bottom."}
   }
  },
  "end": {
   "type": "object",
   "required": ["item", "path", "view"],
   "properties": {
    "item": {"type": "string", "description": "The device's id. A removed device's id is kept, and the end reads as loose."},
    "path": {"type": "string", "description": "The port's path on the face."},
    "view": {"enum": ["front", "rear"], "description": "Which of the device's own panels the port is on."}
   }
  },
  "cable": {
   "type": "object",
   "required": ["id", "a", "b", "media", "purpose", "label", "route"],
   "properties": {
    "id": {"type": "string", "minLength": 1, "description": "Unique within the rack."},
    "a": {"$ref": "#/$defs/end"},
    "b": {"$ref": "#/$defs/end"},
    "media": {"type": "string", "description": "The cable type (os2, om3, om4, om5, cat6, cat6a, dac, aoc), or empty."},
    "purpose": {"type": "string", "description": "What it is for."},
    "label": {"type": "string", "description": "The text on its tags."},
    "length": {"type": "object", "required": ["value", "unit", "source"], "description": "A usable length.",
     "properties": {"value": {"type": "number", "exclusiveMinimum": 0, "description": "Above 0."},
                    "unit": {"type": "string", "minLength": 1, "description": "As written; m when the file stated none."},
                    "source": {"type": "string", "description": "Where it came from: entered, routed, ..."}}},
    "lengthAsWritten": {"description": "A length the loader could not use, kept whole as it was written."},
    "route": {"type": "array", "description": "The pathways the cable runs through, in order.", "items": {}}
   }
  }
 }
}
```

After cable piece 2 has landed (Global Constraints), compare `cable` against what `readCables` in `model.js` now keeps (`routeEdited`, route entries) and describe those fields here too. `additionalProperties` is left open on purpose: `parseDoc` keeps fields it does not know.

- [ ] **Step 4: Run it and check that it passes**

Run: `node --test tests/rack/schema.test.mjs`
Expected: PASS

- [ ] **Step 5: Publish it on the schema page**

In `schemawalk.py`, below `documents()`:

```python
SITE_SCHEMAS = [HERE / "site" / "rack" / "rack.schema.json"]


def site_documents():
    """{filename: parsed schema} for the schemas this site owns (not vendored)."""
    return {p.name: json.loads(p.read_text()) for p in SITE_SCHEMAS}


def all_documents():
    """Vendored and site-owned together: what the schema page shows."""
    return {**documents(), **site_documents()}
```

In `check-contract.py`, keep the vendored-vs-`SOURCES` check on `docs = schemawalk.documents()` exactly as it is. Then add `alldocs = schemawalk.all_documents()` and use it for:
- the count (`WORDS.get(len(alldocs))`);
- the keyword loop (`for name, doc in alldocs.items():`);
- a new check that every site-owned schema has a `SOURCES` entry. For example: `site_urls = set(re.findall(r"url:\s*'(site/[^']+)'", SJS))` and `check({f"site/rack/{n}" for n in schemawalk.site_documents()} <= site_urls, "schema.js renders every site-owned schema", ...)`.

In `check-browser.py` `check_schema_coverage`, change `schemawalk.documents()` to `schemawalk.all_documents()`.

In `site/schema.js` `SOURCES`, after `overlay`:

```js
  // The Rack Builder's own file. Site-owned until the rack core moves to the
  // kit (piece 2 of docs/superpowers/specs/2026-10-07-rack-command-core-design.md),
  // so it is not in assets/schemas/, which every sync replaces.
  rack:      {url: 'site/rack/rack.schema.json',            label: 'a rack built in the Rack Builder'},
```

and in the `have` computation, a site-owned file is never hidden by the vendored index:

```js
const have = Object.fromEntries(Object.entries(SOURCES).map(([k, {url}]) =>
  [k, !url.startsWith('assets/schemas/') || !listed || listed.has(url.split('/').pop())]));
```

In `schema.html`, add `<button role="tab" data-schema="rack" aria-selected="false">Rack</button>` after the overlay tab. Then update the intro count at line 82 to the number `check-contract.py` now expects. Read the sentence and add the rack file to its list of what the documents are.

- [ ] **Step 6: Run the contract and the schema browser checks**

Run: `python3 check-contract.py 2>&1 | tail -20`
Expected: every check passes, including "schema.html's intro counts N documents" and "schema.js renders every keyword rack.schema.json uses".

Run: `python3 check-browser.py --only check_schema_coverage`
Expected: no problems. If `check_schema_coverage` is not registered with `@extra` (`--only` refuses it), run `python3 check-browser.py` restricted the way its `--help` describes, or the full pass (about 9 minutes), and read the schema lines.

- [ ] **Step 7: Commit**

```bash
git add site/rack/rack.schema.json tests/rack/schema.test.mjs schemawalk.py check-contract.py check-browser.py site/schema.js schema.html
git commit -m "rack: a JSON Schema for the rack file, on the schema page beside the others

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `rack-page.js` onto the editor

**Files:**
- Modify: `site/rack-page.js` (throughout; line numbers are from `fd9efa89` and will have moved after the rebase onto piece 2)
- Modify: `site/rack/drag.js:3-14,105-120` (comments only; the callback contract is kept)
- Modify: `check-browser.py` (Undo-presence assertions; two new checks)
- Test: `tests/rack/one-way-in.test.mjs`

**Interfaces:**
- Consumes: `createRackEditor` (Task 3); `GONE`, `NOT_ADDED` (Task 2); the queries (Task 4) for the probe hook.
- Produces: `edit(cmds, {say = false, report = true} = {}) -> apply result` inside the page. `window.__rack` gains `apply(cmds)`, `undo()`, `redo()`, `history()` and `query`.

**The rule for Undo on screen** (refines spec §3.3, and keeps today's ids): the Undo button (`#undoShrink`) is rendered whenever `ed.canUndo`, described by `#undoWhat` = `ed.undoSummary`. The Redo button (`#redoStep`) is rendered whenever `ed.canRedo`, described by `#redoWhat`. When there is nothing to undo, the button is absent rather than disabled. The checks then keep reading "no `#undoShrink`" as "nothing to undo", and a disabled button with no description would be noise.

- [ ] **Step 1: Write the failing one-way-in test**

```js
// tests/rack/one-way-in.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';

// ONE WAY IN (spec §5.1): nothing that draws the page edits the rack except
// through the editor's commands. The reducers are the commands' to call.
const REDUCERS = ['withItem', 'updateItem', 'withoutItem', 'withFrame', 'renamed', 'withDcim', 'withCable',
                  'updateCable', 'withoutCable', 'withoutCablesOf', 'moveItem', 'shrinkRack'];
// The core may call them; drag.js may call moveItem for its PREVIEW only (the drop is a move command).
const CORE = new Set(['model.js', 'fit.js', 'managers.js', 'cable-rules.js', 'commands.js', 'editor.js', 'history.js',
                      'queries.js', 'validate.js', 'route.js']);
const ALLOWED = {'drag.js': ['moveItem']};

test('the page and the UI modules import no reducer', () => {
  const files = [['rack-page.js', new URL('../../site/rack-page.js', import.meta.url)],
    ...readdirSync(new URL('../../site/rack/', import.meta.url)).filter(f => f.endsWith('.js') && !CORE.has(f))
      .map(f => [f, new URL(`../../site/rack/${f}`, import.meta.url)])];
  for (const [name, url] of files) {
    const src = readFileSync(url, 'utf8');
    const imported = [...src.matchAll(/import\s*\{([^}]*)\}\s*from/g)].flatMap(m => m[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0]));
    const bad = imported.filter(n => REDUCERS.includes(n) && !(ALLOWED[name] || []).includes(n));
    assert.deepEqual(bad, [], `${name} imports ${bad.join(', ')}`);
  }
});
```

Run: `node --test tests/rack/one-way-in.test.mjs`
Expected: FAIL. `rack-page.js` imports `withFrame, renamed, withItem, updateItem, withoutItem, withDcim, moveItem, shrinkRack, withCable, updateCable, withoutCable, withoutCablesOf`. If another UI module turns up (for example a piece-2 route panel), it is converted in Step 2 too.

- [ ] **Step 2: Rewire the page**

Make these changes in `site/rack-page.js`, in order:

**2a. Imports.** Remove the reducers named in the test from the `model.js`, `managers.js`, `fit.js` and `cable-rules.js` import lines; keep everything else those lines import. Add:

```js
import {createRackEditor} from './rack/editor.js';
import {GONE, NOT_ADDED} from './rack/commands.js';
import * as Q from './rack/queries.js';
import {configuredFace} from './rack/face.js';
```

Delete the page's own `const GONE = ...` and `const NOT_ADDED = ...`. They now come from `commands.js`, with the same text.

**2b. State.** In `S`, remove `doc`, `undo` and `undoText`. Add `let ed = null;` beside `let drag = null;`, and change `rack` to read the editor:

```js
const rack = () => ed.rack();
const theDoc = () => ed.getDoc();
```

Replace every remaining `S.doc` with `theDoc()` (library actions, `downloadDoc(S.doc)`, `S.doc.id` in `explore` and `renderLibrary`, `pagehide`).

**2c. One way in.** Replace `commit()` with `edit()` and a render that is queued, so a caller can set the selection after `edit` returns and before the redraw reads it:

```js
// THE ONE WAY AN EDIT REACHES THE RACK: a command, through the editor (spec
// §3.1). The editor's change listener (onChange) saves, redraws and keeps or
// rebuilds the 3D scene; this only reports a refusal. `say` puts the step's
// summary in the notice, where an edit with an Undo said what it did before
// every edit had one. `report: false` leaves the refusal to the caller (a drag,
// the arrow keys), which says it its own way.
function edit(cmds, {say = false, report = true} = {}) {
  const res = ed.apply(cmds, {origin: 'ui'});
  if (res.error) { if (report) S.notice = {text: res.error, kind: 'error'}; renderSoon(); return res; }
  if (say && !res.noop && res.summary) addNotice(res.summary, 'note');
  return res;
}
// A redraw queued for the end of this task: whatever the caller sets after an
// edit (the selection, where the keyboard goes) is set before render() reads it.
let renderQueued = false;
function renderSoon() {
  if (renderQueued) return;
  renderQueued = true;
  queueMicrotask(() => { renderQueued = false; render(); });
}
function onChange(ev) {
  if (ev.cause === 'load') { if (ev.findings.length) S.save.saveSoon(theDoc()); return; }
  for (const f of ev.findings) addNotice(f.text, f.kind);
  if (ev.cause === 'undo' || ev.cause === 'redo')
    addNotice(`${ev.cause === 'undo' ? 'Undid' : 'Redid'}: ${ev.summary}`, 'note');
  S.save.saveSoon(theDoc());
  // A change the 3D scene reads nothing of keeps it, re-pointed; any other is a rebuild.
  if (sameScene(ev.before, ev.after)) keepScene(ev.before, ev.after);
  else scheduleRebuild3d();
  // NOT A STEP, NOT A REDRAW: the DCIM settings are stored from inside render()
  // (flushDcimDraft) and the routed lengths after one, so redrawing for them would
  // loop. Neither changes what the page shows.
  if (ev.step) renderSoon();
}
```

In `bootInner`, create the editor after `chassisOf` is set and before `setDoc(doc)`:

```js
ed = createRackEditor({doc, chassisOf});
ed.on('change', onChange);
```

**2d. setDoc.** Replace its first five lines (the settle loop, `S.doc = doc`, the save-if-notes, and the `S.undo = null` reset) with:

```js
function setDoc(doc) {
  const {findings} = ed.loadDoc(doc);   // settles managers; clears history; saves a repair (onChange)
  S.sel = null; S.cable.a = null; S.dcimDraft = null;
  for (const f of findings) addNotice(f.text, 'note');
```

Keep the rest of `setDoc` as it is, but read `theDoc().id` for `localStorage.setItem(LAST, ...)`.

**2e. Every edit site becomes a command.** Each closure keeps its UI-only guards (selection checks, `confirm()`, focus) and sends one command:

| Today | Becomes |
|---|---|
| `attachManager(id)` | `if (!itemById(id)) { S.notice = {text: GONE, kind: 'error'}; render(); return; } edit({op: 'attach', id}, {say: true});` |
| `place(entry, cfg, face, ru)` | `const res = edit({op: 'place', ref: entry.name, cfg, face, ru, label: entry.model \|\| entry.name}); if (!res.error) S.sel = {kind: 'item', id: res.created.ids[0]};` |
| `patchItem(id, patch)` with `ru`/`face` | `const res = edit({op: 'move', id, ...pick(patch, ['ru', 'face'])}, {report: false}); return res.error ? {ok: false, reason: res.error} : {ok: true};`. Callers keep setting the notice from `reason`, as today. When the item is gone, set `S.notice` to GONE and `render()` before sending, exactly as today. |
| `patchItem(id, patch)` otherwise | `edit({op: 'patch', id, ...patch}); return {ok: true};`. The cleared-changes note now arrives as a finding. |
| manager Detach | `live(cur => edit({op: 'detach', id: cur.id}, {say: true}))` |
| manager Remove, host's manager-row Remove | `edit({op: 'remove', id}, {say: true})` |
| remove panel `onBoth` / `onKeep` | `fn` becomes `edit({op: 'remove', id: cur.id, cables: 'remove' \| 'keep'}, {say: true})` |
| inspector Remove (no cables, after `confirm`) | `edit({op: 'remove', id: cur.id}, {say: !!managersStay(now, cur.id)})`. Today this only spoke when managers stay. |
| `commitFrame(patch)` | Delete the function. The frame form's `onFrame: patch => edit({op: 'frame', ...patch})`. The shrink sentence arrives as a finding; the echo is a no-op (spec §3.4). |
| frame form `onName`, library Rename… | `edit({op: 'rename', name})` |
| `putDcim(patch)` | `const res = edit({op: 'dcim', ...patch}); return !res.error && !res.noop;`. Delete the `S.undo` patching: the editor keeps `dcim` across undo and redo. |
| cable form save, existing cable | Keep the "cable already gone" guard. Then `S.sel = {kind: 'cable', id: cable.id}; edit({op: 'cable.update', id: cable.id, ...fields});` |
| cable form save, new cable | `const res = edit({op: 'cable.add', a, b, ...fields}); S.sel = res.error ? null : {kind: 'cable', id: res.created.ids[0]};`. Delete the page's own `itemById` and `canCable` checks: the command's refusals are NOT_ADDED and `canCable`'s sentence. |
| cable list Delete | `S.sel = null; S.focusNext = 'undoShrink'; edit({op: 'cable.remove', id}, {say: true});` |
| `undoShrink()` | `function undoStep() { ed.undo(); }` and `function redoStep() { ed.redo(); }`. `onChange` does the rest. |

Delete `detachedRack`, `managersStay`'s use in remove sentences (the command builds them; keep `managersStay` only where `say` needs it), and `keepScene`'s comment reference to `putDcim`.

**2f. The Undo/Redo footer.** In `renderSide`, replace the `if (S.undo) { ... }` block with:

```js
  // Undo and Redo, each while there is a step to take, each saying what it would
  // take back or do again (spec §3.3). The notice is shown once; the sentence
  // beside the button stays.
  const stepButton = (id, text, whatId, what, fn) => {
    if (notice && what && notice.textContent.includes(what) && id === 'undoShrink') notice.id = whatId;
    else if (what) kids.push(el('p', {id: whatId, class: 'rk-undo-what rk-muted', text: what}));
    const b = el('button', {type: 'button', id, text, ...(what ? {'aria-describedby': whatId} : {})});
    b.addEventListener('click', fn);
    kids.push(b);
  };
  if (ed.canUndo) stepButton('undoShrink', 'Undo', 'undoWhat', ed.undoSummary, undoStep);
  if (ed.canRedo) stepButton('redoStep', 'Redo', 'redoWhat', ed.redoSummary, redoStep);
```

**2g. Keys.** In the document `keydown` handler, after the `input, select, textarea` guard and before the Cable-mode Escape branch:

```js
    if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'z') {
      ev.preventDefault();
      if (ev.shiftKey) redoStep(); else undoStep();
      return;
    }
```

**2h. The probe hook.** Replace `doc`, `replaceRack` and add the new entries:

```js
  // The ports of a device's own panel, as the queries read them.
  const facePorts = async (item, view) =>
    ((await configuredFace({ref: item.ref, cfg: item.cfg, view, swaps: item.swaps, fields: item.fields}))?.ports ?? []);
  window.__rack = {ready, doc: () => ed.getDoc(), flush: () => S.save.flush(), scene: () => S.scene3d,
    // Probe only: put a rack in as one undo step, as any edit that changes the rack under the page does.
    replaceRack: (next, undoable) => {
      ed.replaceRack(next, undoable?.text ?? 'Changed the rack.');
      if (undoable) addNotice(undoable.text, 'note');
    },
    apply: cmds => edit(cmds),
    undo: () => undoStep(),
    redo: () => redoStep(),
    history: () => ({canUndo: ed.canUndo, canRedo: ed.canRedo, undoSummary: ed.undoSummary, redoSummary: ed.redoSummary}),
    query: {
      describe: () => Q.describe(rack(), {chassisOf}),
      catalog: filter => Q.catalog(S.devices, filter),
      fitsAt: spot => Q.fitsAt(rack(), spot, {chassisOf}),
      freePorts: id => Q.freePorts(rack(), id, {portsOf: facePorts}),
      looseEnds: () => Q.looseEnds(rack(), {cableFacts}),
    },
    // ... the existing addNotice, failExport, failCableFacts, failSceneFacts, cableFacts entries, unchanged
  };
```

- [ ] **Step 3: Run the node suite**

Run: `node --test tests/*/*.test.mjs`
Expected: PASS, including `one-way-in`.

- [ ] **Step 4: Update the Undo-presence assertions in `check-browser.py`**

Every edit now leaves an Undo. List the assertions that relied on an edit retiring it, or on it being absent:

Run: `grep -n "undoShrink\|undoWhat" check-browser.py`

For each hit, apply this rule and nothing else:
- **"Undo is offered / click Undo / the device is back"**: unchanged.
- **"Undo is not offered before anything changed"** (`check_rack_cable_undo` right after `open_cabled`): `open_cabled` builds its rack through `replaceRack` or `setDoc`. If through `replaceRack`, Undo is now offered. Change the assertion to compare `__rack.history().undoSummary` with the summary of the last real edit, or call `setDoc`-equivalent loading (open the rack from the library) so that history starts empty. Pick whichever the helper's code makes true, and say which in a comment.
- **"Undo and its sentence go together" after undoing the only step** (`check_rack_cable_polish` ~8496): unchanged, provided the rack was loaded fresh. If the rack was set with `replaceRack`, there is an earlier step, so assert that `#undoWhat` now reads that earlier step's summary instead.
- **"a later non-undoable change retires Undo"**: the premise no longer exists. Change it to "Undo now describes the later change" (read `#undoWhat`).
- **The stale-handler checks** (`check_rack_stale_handlers`, "Undo stands"): unchanged. They assert Undo is still offered, which stays true.

Then add the two new checks after `check_rack_cable_undo`:

```python
@extra("rack.html: Undo and Redo walk back and forth through several edits, by button and by keyboard; a new edit clears Redo; DCIM settings survive Undo")
def check_rack_history(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    page.goto(f"{base}/rack.html?probe=1", wait_until="load")
    page.wait_for_function("() => window.__rack && window.__rack.ready", timeout=READY_MS)
    page.evaluate("() => window.__rack.ready")
    page.click("#libMenu > summary"); page.click("#libItems button:has-text('New rack')")
    wait_fn(page, "history: empty rack", "() => window.__rack.doc().racks[0].items.length === 0 && !window.__rack.history().canUndo")
    items = lambda: page.evaluate("() => window.__rack.doc().racks[0].items.map(i => [i.ref, i.ru, i.face])")
    pick(page, "front", 10, "R740", "r740xd")
    wait_fn(page, "history: placed", "() => window.__rack.doc().racks[0].items.length === 1")
    page.evaluate("() => window.__rack.apply({op: 'move', id: 'i1', ru: 20})")
    page.evaluate("() => window.__rack.apply({op: 'dcim', site: 'dc1'})")
    wait_sel(page, "history: Undo offered", "#undoShrink")
    what = page.text_content("#undoWhat") or ""
    if not what.startswith("Moved "):
        bad.append(f"history: Undo describes {what!r}, expected the move")
    page.click("#undoShrink")
    wait_fn(page, "history: the move undone", "() => window.__rack.doc().racks[0].items[0].ru === 10")
    if page.evaluate("() => window.__rack.doc().racks[0].dcim") != {"site": "dc1"}:
        bad.append("history: Undo took the DCIM settings back")
    wait_sel(page, "history: Redo offered", "#redoStep")
    page.keyboard.press("Meta+Shift+z" if sys.platform == "darwin" else "Control+Shift+z")
    wait_fn(page, "history: redone by keyboard", "() => window.__rack.doc().racks[0].items[0].ru === 20")
    page.keyboard.press("Meta+z" if sys.platform == "darwin" else "Control+z")
    page.keyboard.press("Meta+z" if sys.platform == "darwin" else "Control+z")
    wait_fn(page, "history: back to empty", "() => window.__rack.doc().racks[0].items.length === 0")
    if page.query_selector("#undoShrink"):
        bad.append("history: Undo is still offered with nothing left to undo")
    page.evaluate("() => window.__rack.apply({op: 'rename', name: 'Fresh'})")
    wait_fn(page, "history: a new edit", "() => window.__rack.doc().racks[0].name === 'Fresh'")
    if page.evaluate("() => window.__rack.history().canRedo"):
        bad.append("history: a new edit left Redo offered")
    # A shrink, undone: every position comes back.
    page.evaluate("""() => window.__rack.apply([{op: 'place', ref: 'as7726-32x', face: 'front', ru: 40},
                                              {op: 'place', ref: 'as7726-32x', face: 'front', ru: 1}])""")
    before = items()
    page.evaluate("() => window.__rack.apply({op: 'frame', heightRU: 2})")
    wait_fn(page, "history: shrunk", "() => window.__rack.doc().racks[0].frame.heightRU === 2")
    page.click("#undoShrink")
    wait_fn(page, "history: unshrunk", "() => window.__rack.doc().racks[0].frame.heightRU === 42")
    if items() != before:
        bad.append(f"history: Undo after a shrink left {items()}, expected {before}")
    return bad


@extra("rack.html: __rack.apply refuses a bad batch whole, shows why, and the queries answer")
def check_rack_commands(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    page.goto(f"{base}/rack.html?probe=1", wait_until="load")
    page.wait_for_function("() => window.__rack && window.__rack.ready", timeout=READY_MS)
    page.evaluate("() => window.__rack.ready")
    page.click("#libMenu > summary"); page.click("#libItems button:has-text('New rack')")
    wait_fn(page, "commands: empty rack", "() => window.__rack.doc().racks[0].items.length === 0")
    res = page.evaluate("""() => window.__rack.apply([{op: 'place', ref: 'as7726-32x', face: 'front', ru: 10},
                                                    {op: 'place', ref: 'as7726-32x', face: 'front', ru: 10}])""")
    if res.get("index") != 1 or "Taken by" not in (res.get("error") or ""):
        bad.append(f"commands: the batch answered {res}")
    if page.evaluate("() => window.__rack.doc().racks[0].items.length") != 0:
        bad.append("commands: a refused batch left items in the rack")
    try:
        wait_fn(page, "commands: the refusal is shown",
                "() => (document.querySelector('.rk-side .rk-notice')?.textContent || '').includes('Taken by')")
    except RuntimeError:
        bad.append("commands: the page did not show why the batch was refused")
    page.evaluate("() => window.__rack.apply({op: 'place', ref: 'as7726-32x', face: 'front', ru: 10, as: 'leaf'})")
    text = page.evaluate("() => window.__rack.query.describe()")
    if "i1 AS7726-32X U10 front" not in text:
        bad.append(f"commands: describe() reads {text!r}")
    ports = page.evaluate("() => window.__rack.query.freePorts('i1')")
    if not isinstance(ports, list) or not ports or not all(p.get("path") and p.get("view") for p in ports):
        bad.append(f"commands: freePorts('i1') answered {str(ports)[:200]}")
    return bad
```

Check that `pick` (used by `check_rack_place`), `wait_fn` and `wait_sel` are the helpers named here (`grep -n "^def pick" check-browser.py`). Check that `as7726-32x`'s model in `site/rack/chassis.json` is `AS7726-32X` (the `describe` assertion uses it).

- [ ] **Step 5: Run the rack browser checks**

First check the load (see memory "3D check timeouts: check load first"):

Run: `uptime`
If the load is above about 8, find the cause before trusting any timeout.

Run: `python3 check-browser.py --only $(grep -o "^def check_rack_[a-z0-9_]*" check-browser.py | sed 's/^def //' | paste -sd, -) 2>&1 | tail -40`
Expected: no problems reported. Every rack check is registered with `@extra`; if `--only` refuses a name, drop that name from the list and note it. Fix failures in the page, not by loosening a check, except where Step 4's rule says the premise changed.

- [ ] **Step 6: Run the whole node suite and the contract**

Run: `node --test tests/*/*.test.mjs && python3 check-contract.py 2>&1 | tail -5`
Expected: PASS / all checks pass.

- [ ] **Step 7: Commit**

```bash
git add site/rack-page.js site/rack/drag.js check-browser.py tests/rack/one-way-in.test.mjs
git commit -m "rack: the page edits through the editor - every edit a command, Undo and Redo on every step

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The route commands from cable piece 2

**Files:**
- Modify: `site/rack/commands.js` (three commands and their table entries), `site/rack-page.js` (piece 2's route edit, reset and routed-lengths save sites)
- Test: `tests/rack/commands.test.mjs` (append)

**Interfaces:**
- Consumes: from piece 2, as landed, `updateCable` (`cable-rules.js`) and `withRoutedLengths(rack, ctx)` (`site/rack/route.js`). **Read `route.js` and piece 2's `rack-page.js` route code first.** The signatures below are what the "0RU device support and cable management" session said on 2026-10-07. If what landed differs, wrap what landed and keep the command names.
- Produces: `COMMANDS['cable.route']`, `COMMANDS['cable.route.reset']`, `COMMANDS['lengths.routed']` (`step: false`, `system: true`).

- [ ] **Step 1: Write the failing tests**

Append to `tests/rack/commands.test.mjs`:

```js
test('cable.route and cable.route.reset', () => {
  let r = add(add(M.newRack(), 'as7726-32x', 10), 'as7726-32x', 20);
  r = {...r, cables: [{id: 'c1', a: end('i1'), b: end('i2'), media: '', purpose: '', label: 'A1', route: []}]};
  const route = [{pathway: 'ring-1'}];
  const s = run('cable.route', r, {id: 'c1', route});
  assert.deepEqual([s.rack.cables[0].route, s.rack.cables[0].routeEdited, s.summary], [route, true, 'Routed cable A1 by hand.']);
  const t = run('cable.route.reset', s.rack, {id: 'c1'});
  assert.deepEqual([t.rack.cables[0].route, 'routeEdited' in t.rack.cables[0]], [[], false]);
  assert.equal(run('cable.route.reset', t.rack, {id: 'c1'}).rack, t.rack);
  assert.deepEqual(run('cable.route', r, {id: 'c9', route}), {error: CABLE_GONE});
});

test('lengths.routed is a system command that is not a step', () => {
  assert.equal(COMMANDS['lengths.routed'].step, false);
  assert.equal(COMMANDS['lengths.routed'].system, true);
});
```

Adjust the shape of `route` entries in the test to what piece 2's `route.js` actually stores.

- [ ] **Step 2: Run them and check that they fail**

Run: `node --test tests/rack/commands.test.mjs`
Expected: FAIL. `COMMANDS['cable.route']` is undefined.

- [ ] **Step 3: Implement**

In `commands.js`, import `withRoutedLengths` from `./route.js` and add:

```js
function cableRoute(rack, {id, route}) {
  const c = cableOf(rack, id);
  if (!c) return {error: CABLE_GONE};
  if (c.routeEdited && same(c.route, route)) return unchanged(rack);
  return done(updateCable(rack, id, {route, routeEdited: true}), `Routed cable ${cableName(c)} by hand.`);
}
function cableRouteReset(rack, {id}) {
  const c = cableOf(rack, id);
  if (!c) return {error: CABLE_GONE};
  if (!c.routeEdited && !(c.route || []).length) return unchanged(rack);
  const next = updateCable(rack, id, {route: [], routeEdited: undefined});
  return done({...next, cables: next.cables.map(x => { if (x.id !== id) return x; const {routeEdited: _r, ...rest} = x; return rest; })},
              `Put cable ${cableName(c)} back on its own route.`);
}
// The page measures routed lengths after a render and stores them: derived, so
// not an undo step, and not offered to agents. `routeFacts` is what that
// render measured (piece 2's `S.routes`).
function lengthsRouted(rack, {routeFacts}, ctx) {
  const next = withRoutedLengths(rack, {...ctx, routeFacts});
  return same(next.cables, rack.cables) ? unchanged(rack) : done(next, 'Measured the routed lengths.');
}
```

with table entries:

```js
  'cable.route': {run: cableRoute, description: 'Route a cable by hand through the pathways given, in order. Its routed length follows.',
    args: args(['id', 'route'], {id: ID('cable'), route: {type: 'array', description: 'The pathways, in order, as piece 2 stores them.'}})},
  'cable.route.reset': {run: cableRouteReset, description: 'Drop a hand-made route; the cable takes its own route again.',
    args: args(['id'], {id: ID('cable')})},
  'lengths.routed': {run: lengthsRouted, step: false, system: true, description: 'Store the routed lengths the page measured. Not an undo step; the page sends it.',
    args: args(['routeFacts'], {routeFacts: {type: 'object', description: 'What the last render measured of the routes.'}})},
```

Then change the `routeFacts` argument and `withRoutedLengths` call to match `route.js` as landed. If it takes something other than an object, give the argument that type.

In `rack-page.js`, convert piece 2's three sites:
- route edit: `edit({op: 'cable.route', id, route})`
- route reset: `edit({op: 'cable.route.reset', id})`
- the post-render save of `withRoutedLengths(...)`: `ed.apply({op: 'lengths.routed', routeFacts: S.routes}, {origin: 'system'})`. `onChange` saves it and does not redraw, because `step` is false.

Add `'route.js'` to nothing: it is already in the one-way-in test's `CORE` set.

- [ ] **Step 4: Run node, the contract and the route browser checks**

Run: `node --test tests/*/*.test.mjs && python3 check-contract.py 2>&1 | tail -5`
Run: `python3 check-browser.py --only <piece 2's route check names, from grep -n "@extra(\"rack.html: .*rout" check-browser.py>`
Expected: PASS / no problems.

- [ ] **Step 5: Commit**

```bash
git add site/rack/commands.js site/rack-page.js tests/rack/commands.test.mjs
git commit -m "rack: route edits and routed lengths go through commands too

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Whole-branch verification, review, PR

**Files:** none new.

- [ ] **Step 1: The full local pass**

Run: `uptime`, then `node --test tests/*/*.test.mjs && python3 check-contract.py && python3 check-browser.py 2>&1 | tail -60`
Expected: all pass. The full browser pass takes about 9 minutes. Note any known-flaky check by name, and do not mark it as passed.

- [ ] **Step 2: Code review**

Run the `code-review` skill on the branch. Fix confirmed findings, or note them for the PR. Re-run Step 1 after any fix.

- [ ] **Step 3: Update the spec's status line**

In `docs/superpowers/specs/2026-10-07-rack-command-core-design.md`, set `**Status:** implemented (plan: docs/superpowers/plans/2026-10-07-rack-command-core.md)`. Commit.

- [ ] **Step 4: Push and open the PR**

```bash
git fetch origin && git rebase origin/main
git push -u origin claude/refactor-agent-79cc9e
```

If the pre-push hook times out at high load, use `nohup sh ~/.claude/merge-agent/portrayal-site/when-calm.sh git push -u origin claude/refactor-agent-79cc9e &` as a background task. Never use `--no-verify`.

Open the PR with `gh pr create`. The body:
- what the command core is;
- that this is piece 1 of 4;
- the Undo rule change (every edit, buttons shown while there is a step);
- which tests ran;
- any flaky checks by name;
- and it ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

- [ ] **Step 5: Hand off**

Message "Portrayal-site merge agent" with the PR number. Message "Agent integration research" that `COMMANDS`, `apply`, the editor and the queries are in review, with the PR link.
