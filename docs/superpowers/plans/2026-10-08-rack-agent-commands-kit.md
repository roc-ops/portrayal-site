# Rack kit agent commands Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the rack kit the commands and questions an agent needs to fit one part, set one field, re-point a cable, read one device or cable whole, and pick cables by selector, without reading the code.

**Architecture:** A new pure module, `kit/rack/slots.js`, reads a placed device's bays, cages and what its configuration builds, from the parts lists that a new async loader (`loadSlots` in `kit/rack/catalog.js`) fetches through `jdist`. The commands (`fit`, `field`, `cable.update {a, b}`, and the `cfg` and `swaps` checks in `place` and `patch`) stay pure and synchronous: they check against that lookup when a caller hands it in through the editor's new per-call `ctx`, and behave as today when it does not. The queries (`inspect`, `selectCables`, a windowed `describe`, `catalog` by `kind`) read the same lookup; `rack.json` gains a plain-word `kind` per device, read from the manifest `profile` that `devices.json` now carries.

**Tech Stack:** Plain ES modules (no build step) under `kit/`, tested with `node --test` (`spec/tests/js/rack-*.mjs`, run by `spec/tests/test_rack_kit_js.py`); Python 3 for `spec/tools/portrayal/rack_index.py` and `devices_index.py`, tested with pytest.

**Spec:** `docs/rack-agent-commands-design.md` (approved). Read it before Task 1.

## Global Constraints

- Repository: the upstream Portrayal library, worktree `/Volumes/External/Network-Device-Visualization/.claude/worktrees/rack-agent-commands`, branch `claude/rack-agent-commands`, built on `origin/claude/rack-kit-move` (roc-ops/Portrayal#896, kit 0.3.0). Every path below is relative to that worktree.
- British spelling in kit comments and docs (`colour`, `catalogue`, `behaviour`, `fibre`), enforced on `kit/rack/` comments by `spec/tools/portrayal/comment_spelling.py`. A word in backticks is exempt. Identifiers, data keys and strings stay as they are (`latch-color`, `colorOf`, `catalog.js`, `MEDIA_LABELS`' "fiber").
- Commands stay pure and synchronous: the rack, the arguments and `ctx` in, `{rack, summary, findings}` or `{error}` out, and the very rack back when nothing changed. Only `kit/rack/catalog.js` fetches, and only through `jdist`.
- Description bounds: 500 characters or less per command, 150 or less per argument, a default stated where an argument has one, and no function names (`describe()`, `freePorts()`) or site pages (the Explorer, portrayal.dev) in any description an agent reads.
- `rack.json` stays `format: 1`; `kind` is additive. `devices.json` stays `contract: 2`; `profile` is additive.
- Every new sentence is plain and names no site page or menu (spec D6).
- The kit version follows the repository's pattern: it moves when the kit is published (0.1.0, 0.2.0, then 0.3.0 for #896), not per feature. Task 11 bumps it only if 0.3.0 has been published by then.
- A changelog entry is one new file in `changelog.d/`, under `### Added` / `### Changed` / `### Removed` / `### Fixed`, checked by `spec/tools/portrayal/changelog.py --check`.
- Tests: the node tests run under `spec/tests/test_rack_kit_js.py` (every `spec/tests/js/rack-*.mjs`, one node process each), plus `npm test` in `kit/` (a `node --check` of every module). A helper module that is not a test file must not be named `rack-*.mjs`.
- Run pytest with this worktree's tools on the path. The machine's editable `portrayal` install points at another worktree, so a bare `python3 -m pytest` fails with `No module named 'portrayal.shards'`. Use `PYTHONPATH=spec/tools:spec/tests python3 -m pytest ...` throughout.
- portrayal-site vendors `kit/rack/*.js` read-only. The rack modules now import `../swap.js` and `../fields.js` beside the existing `../dist.js`. Those files are already part of the kit; the companion site spec picks the change up.
- Commit after every task, with a message that ends `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do not push. Do not use `--no-verify`.

## Decisions made while planning (the spec left these open, or the code disagreed)

1. **Where `kind` comes from.** The spec says `devices.json` `capability` or the portfolio's category. In the real build, `capability` is how far a device is modelled (`{"name": "addressable", "level": 4, ...}`), and no portfolio has a `category` (only `line`, `family`, `series`, `also-listed-in`). The manifest's `profile` (`networking`, `optical`, `passive`, `power`, `server`; every manifest states one) is the device class. So `devices_index.py` publishes `profile`, and `rack_index.py` maps it: `server` → `server`; `power` → `pdu`; `passive` → `cable manager` (all 23 passive devices are FS cable managers); `optical` → `patch panel` when the chassis airflow is `passive` (the FS FHD enclosures, the Fibrain XCU), else `optical` (DCP, CH3000, the ONT housing); `networking` → `router` or `switch` from the portfolio's `family`/`line`/`series`, else from the description, else `network device`. An unknown or missing profile is `device`. On the current library this classifies every networking device sensibly; the CMTS, NIDs, PTP grandmasters and ONTs come out as `network device`.
2. **`inspect` is async.** A cable's loose ends and media need `ctx.cableFacts`, which is async (as `looseEnds` and `suggestMedia` already are). `inspect` always returns a promise.
3. **`field`'s `path` is the part's path**, `<bay>/module` or `<cage>-occupant`, which is the key `item.fields` already uses (the Explorer's `setFields('psu-1/module', ...)`) and which `inspect` lists in `fields[].path`. A slot path is refused with a sentence that names the part path.
4. **The orphaned-cable finding.** Spec §5.1 quotes "Removed the cables on <paths>: ..." but also says the cables are kept as loose ends. The plan keeps them and says so: `Kept the cables on <paths> as loose ends (<ids>): these ports are not on <part>.` (or `...: <path> is empty.`).
5. **The media finding without facts.** Commands cannot await `ctx.cableFacts`. `fit` reads the new part's own `attrs` from `components.json` (through `connectorOf`) and compares them with each cable's media on that port: `c3 now runs OM4 multimode fiber into LR optic.`
6. **`fit` drops what was under a replaced carrier.** It drops swaps as well as fields (`underCarrier`), as `swap.js pruneCarrier` does (#484 R5: an optic cannot outlive the card it sat in).
7. **`describe`.** The totals line is always the first line. With no window, the rest is today's output, except that the frame line no longer repeats the rack's name, and the 1,500-character bound stands. A window (`section` `'items'`, `'cables'` or `'both'`; `offset` from 0; `limit` 20 by default) is not shortened, and its lines carry the ref and configuration, or the purpose and length.
8. **`selectCables`.** Keys combine (`{item, purpose}`). `loose` must be `true`. `{item}` for a removed device still returns the cables that name it; an id that nothing names is `{error: GONE}`.
9. **#895 wording.** Of #895's `commands.js` sentences, "the page sets it" (`cable.route`, `cable.route.reset`) and "the page sends it" (`lengths.routed`) sit on commands this spec does not touch, so they stay. The function names in the shared `ID`, `END.path` and `place.ref` descriptions, and "the Explorer" in `patch`, are fixed, because every touched command carries them.
10. **This plan is not committed.** `.gitignore` has ignored `docs/plans/` and `docs/superpowers/plans/` since #453 ("working notes for one session"). The plan stays on disk at `docs/plans/2026-10-08-rack-agent-commands.md`; the spec is the committed record.

## Review Focus

1. **A slot on the part the configuration built, with no swap naming the part.** For example, `bay-1/module/lc1` on a patch panel whose configuration seats the cassette. `fit` must resolve it through the build. Pinned in Task 6.
2. **An item that already holds a swap its slot refuses.** This comes from an older file or from the Explorer. Fitting another slot must still work and keep that entry, since only the slot named is judged. Pinned in Task 6.
3. **An item whose `cfg` the parts list no longer has** (a renamed configuration). `inspect` and the commands read the device's default configuration instead of throwing. Pinned in Task 3.
4. **A `describe` window with an offset or limit that is not a whole number above 0** (`-3`, `2.5`, `'3'`, `0`). It falls back to the start and 20, rather than printing an empty or broken window. Pinned in Task 10.
5. **A batch of `fit`s and its undo.** One `apply` with the agent's `ctx` is one undo step, and undo restores swaps and fields together. Pinned in Task 6.

---

### Task 1: Rebase onto main once #896 merges, and check every name this plan uses

**Files:**
- No file changes.

**Interfaces:**
- Consumes: nothing.
- Produces: a branch whose base has every export the later tasks import, and a recorded baseline of passing tests.

- [ ] **Step 1: See whether #896 has merged**

Run: `gh pr view 896 -R roc-ops/Portrayal --json state -q .state`
Expected: `MERGED` or `OPEN`.

- [ ] **Step 2: If it is `MERGED`, rebase onto main**

```bash
git fetch origin
git rebase origin/main
```

Expected: the rebase replays the one spec commit (`docs: rack kit commands and questions an agent can use ...`) cleanly. If #896 is still `OPEN`, stay on `origin/claude/rack-kit-move` and repeat Steps 1 to 3 before Task 11. The plan builds against #896's shape either way.

- [ ] **Step 3: Check that every name the plan imports is still exported**

Run from the worktree root:

```bash
node --input-type=module -e "
const need = {
  'kit/swap.js': ['slotResolver', 'builtBays', 'builtOccupants', 'underCarrier', 'acceptSwaps'],
  'kit/fields.js': ['fieldRows', 'fieldAccepts'],
  'kit/dist.js': ['jdist', 'clearDistCache'],
  'kit/rack/catalog.js': ['loadCatalog', 'chassisLookup', 'catalogEntries'],
  'kit/rack/commands.js': ['COMMANDS', 'apply', 'GONE', 'CABLE_GONE', 'NOT_ADDED', 'CLEARED'],
  'kit/rack/editor.js': ['createRackEditor'],
  'kit/rack/queries.js': ['describe', 'catalog', 'freePorts', 'looseEnds', 'suggestMedia', 'fitsAt', 'freeUs'],
  'kit/rack/cable-rules.js': ['canCable', 'portFree', 'endKey', 'endName', 'carriedU', 'sameEnd', 'portPathOf', 'matches', 'mismatch', 'connectorOf', 'mediaKind', 'MEDIA', 'MEDIA_LABELS', 'lengthText', 'cableName', 'updateCable'],
  'kit/rack/route.js': ['lanesOf', 'resolveRoute', 'routedLength', 'routeText', 'stockLength'],
  'kit/rack/managers.js': ['managersOf', 'placement'],
  'kit/rack/fit.js': ['heightOf', 'fits', 'isRackFace'],
  'kit/rack/model.js': ['newRack', 'newDoc', 'withItem', 'updateItem', 'uLabel'],
};
let bad = 0;
for (const [f, names] of Object.entries(need)) {
  const m = await import(process.cwd() + '/' + f);
  for (const n of names) if (!(n in m)) { console.log('MISSING', f, n); bad++; }
}
console.log(bad ? bad + ' missing' : 'every name the plan uses is exported');
process.exit(bad ? 1 : 0);
"
```

Expected: `every name the plan uses is exported`. A `MISSING` line means main renamed something: find the new name with `grep -n "export" <file>` and use it wherever this plan uses the old one, before starting Task 2. Also check these signatures, which the plan relies on:
- `acceptSwaps(map, {bays, cages, built, builtOcc, compByRef, placementRef})` returns `{accepted, ignored, cages}`.
- `slotResolver({bays, cages, bayRef, compByRef, placementRef, occRef})` returns `{entryAt, refAt}`.
- `builtOccupants(cfg, cages, ctx)` is unchanged.
- `fieldRows(fields, current)` returns rows with `key, type, value, default, options`.
- `fieldAccepts(field, value)` is unchanged.
- `COMMANDS[op].run(rack, args, ctx)` is unchanged.
- `createRackEditor({doc, chassisOf, cap})` is unchanged.

Run `grep -n "export function acceptSwaps\|export function slotResolver\|export function fieldRows\|export function fieldAccepts" kit/swap.js kit/fields.js` to see them.

- [ ] **Step 4: Record the baseline**

Run:

```bash
PYTHONPATH=spec/tools:spec/tests python3 -m pytest -q spec/tests/test_rack_kit_js.py spec/tests/test_rack_index.py spec/tests/test_comment_spelling.py
(cd kit && npm test)
python3 spec/tools/portrayal/comment_spelling.py kit/rack
```

Expected: all pass, `npm test` exits 0, `comment spelling: clean`. Record any failure that exists before your changes; it is not yours to fix.

- [ ] **Step 5: Commit (only if the rebase changed history)**

Nothing to commit: a rebase rewrites the branch itself. Note the new base SHA (`git rev-parse HEAD~1`) in your report.

---

### Task 2: `loadSlots`, and the editor's per-call `ctx`

**Files:**
- Modify: `kit/rack/catalog.js` (append after `loadCatalog`)
- Modify: `kit/rack/editor.js:33-47` (`apply`) and `:74` (`preview`)
- Create: `spec/tests/js/rack-slots.mjs`
- Modify: `spec/tests/js/rack-editor.mjs` (append one test)

**Interfaces:**
- Consumes: `jdist(url)` from `kit/dist.js`; the private `urlOf(dist, path)` already in `catalog.js`.
- Produces:
  - `loadSlots(dist, refs = []) -> Promise<{slotsOf(ref) -> {bays: {[view]: Bay[]}, cages: {[view]: Cage[]}, configs: Config[], default: string|null} | null, compByRef(ref) -> Component | null}>`. `dist` is a base URL string or a `path -> URL` function. It never rejects.
  - `editor.apply(cmds, {origin = 'ui', ctx = null})` and `editor.preview(cmds, {ctx = null})`: `ctx` is spread over `{chassisOf}` for that call only.

- [ ] **Step 1: Write the failing tests**

Create `spec/tests/js/rack-slots.mjs`:

```js
// spec/tests/js/rack-slots.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

// jdist resolves a url against location.href and fetches it: stand both in.
globalThis.location = {href: 'https://page.test/', search: ''};
const asked = [];
let files = {};
globalThis.fetch = async url => {
  asked.push(url);
  const name = url.slice('https://page.test/d/'.length);
  return Object.hasOwn(files, name) ? {ok: true, json: async () => files[name]} : {ok: false, status: 404};
};

const {loadSlots} = await import('../../../kit/rack/catalog.js');
const {clearDistCache} = await import('../../../kit/dist.js');

const LEAF = {device: 'leaf', default: 'base',
  bays: {front: [], rear: [{id: 'psu-1', group: 'psus', accepts: ['common/psu-a@1'], default: 'common/psu-a@1'}]},
  cages: {front: [{id: 'port-1', group: 'sfp', interface: 'sfp', media: 'sfp', accepts: ['generic/sfp-lc@1'], default: null}]},
  configs: [{name: 'base', description: 'Base', airflow: 'front-to-back', bays: {}, occupants: {}}]};
const COMPONENTS = {components: [{ns: 'generic', name: 'sfp-lc', major: 'v1', class: 'transceiver', attrs: {media: 'fiber'}}]};
const fresh = f => { clearDistCache(); asked.length = 0; files = f; };

test('loadSlots fetches each device once and components.json once, and answers synchronously', async () => {
  fresh({'leaf.configs.json': LEAF, 'components.json': COMPONENTS});
  const s = await loadSlots('/d', ['leaf', 'leaf']);
  assert.deepEqual(asked.sort(), ['https://page.test/d/components.json', 'https://page.test/d/leaf.configs.json']);
  assert.deepEqual(s.slotsOf('leaf'), {bays: LEAF.bays, cages: LEAF.cages, configs: LEAF.configs, default: 'base'});
  assert.equal(s.compByRef('generic/sfp-lc@1').class, 'transceiver');
  assert.equal(s.compByRef('generic/sfp-lc@1:1.2.0').class, 'transceiver');
  assert.equal(s.compByRef('generic/nope@1'), null);
  assert.equal(s.compByRef(null), null);
  assert.equal(s.slotsOf('nope'), null);
});

test('a device whose file fails is null, and the others still load', async () => {
  fresh({'leaf.configs.json': LEAF, 'components.json': COMPONENTS});
  const s = await loadSlots('/d', ['gone', 'leaf']);
  assert.equal(s.slotsOf('gone'), null);
  assert.equal(s.slotsOf('leaf').default, 'base');
});

test('a failed components.json leaves every part unknown and never throws', async () => {
  fresh({'leaf.configs.json': LEAF});
  const s = await loadSlots('/d', ['leaf']);
  assert.equal(s.compByRef('generic/sfp-lc@1'), null);
  assert.equal(s.slotsOf('leaf').default, 'base');
});

test('a ref that is not a device name is never fetched', async () => {
  fresh({'components.json': COMPONENTS});
  const s = await loadSlots('/d', ['../secret', 'a/b', 'constructor.x', '', 7]);
  assert.deepEqual(asked, ['https://page.test/d/components.json']);
  assert.equal(s.slotsOf('../secret'), null);
  assert.equal(s.slotsOf('constructor'), null);
});

test('a function dist is asked for each path', async () => {
  fresh({'leaf.configs.json': LEAF, 'components.json': COMPONENTS});
  const paths = [];
  await loadSlots(p => { paths.push(p); return `https://page.test/d/${p}`; }, ['leaf']);
  assert.deepEqual(paths.sort(), ['components.json', 'leaf.configs.json']);
});
```

Append to `spec/tests/js/rack-editor.mjs`:

```js

test('a per-call ctx reaches the commands for apply and preview, and is not kept', async () => {
  const {COMMANDS} = await import('../../../kit/rack/commands.js');
  const seen = [];
  COMMANDS['test.spy'] = {run: (rack, _a, ctx) => { seen.push(ctx); return {rack: {...rack, name: `${rack.name}+`}, summary: 'Spied.', findings: []}; },
                          args: {type: 'object', additionalProperties: false, properties: {rack: {type: 'string'}}}};
  try {
    const {ed} = fresh();
    const slotsOf = () => null;
    ed.apply({op: 'test.spy'}, {origin: 'agent', ctx: {slotsOf}});
    ed.preview({op: 'test.spy'}, {ctx: {slotsOf, extra: 1}});
    ed.apply({op: 'test.spy'});
    ed.preview({op: 'test.spy'});
    assert.deepEqual(seen.map(c => [typeof c.chassisOf, typeof c.slotsOf, c.extra ?? null]),
      [['function', 'function', null], ['function', 'function', 1], ['function', 'undefined', null], ['function', 'undefined', null]]);
  } finally { delete COMMANDS['test.spy']; }
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd spec/tests/js && node --test rack-slots.mjs rack-editor.mjs`
Expected: FAIL. `rack-slots.mjs` with `TypeError: loadSlots is not a function`; the editor test with a deepEqual failure, because `typeof c.slotsOf` is `'undefined'` for the per-call calls.

- [ ] **Step 3: Write `loadSlots`**

Append to `kit/rack/catalog.js`:

```js

// THE PARTS OF THE DEVICES IN A RACK, for the commands that check a bay, a
// cage or a field (`fit`, `field`, and `place` and `patch` with a
// configuration). Each device's `<ref>.configs.json` is fetched once, through
// `jdist`, and `components.json` once; what comes back is a synchronous
// lookup, so the commands stay pure. A device whose file cannot be fetched is
// null, as an unknown one is, and the commands refuse it with a sentence;
// nothing here throws to the caller. A ref is a device's name in the build,
// which holds no dot or slash, so nothing else is fetched.
const DEVICE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const compKey = c => `${c.ns}/${c.name}@${String(c.major).replace(/^v/, '')}`;

export async function loadSlots(dist, refs = []) {
  const comps = new Map();
  try {
    for (const c of (await jdist(urlOf(dist, 'components.json')))?.components || []) comps.set(compKey(c), c);
  } catch { /* every part is unknown: compByRef answers null */ }
  const slots = new Map();
  await Promise.all([...new Set(refs)].filter(r => typeof r === 'string' && DEVICE_NAME.test(r)).map(async ref => {
    try {
      const j = await jdist(urlOf(dist, `${ref}.configs.json`));
      slots.set(ref, {bays: j?.bays || {}, cages: j?.cages || {}, configs: j?.configs || [], default: j?.default ?? null});
    } catch { slots.set(ref, null); }
  }));
  return {
    slotsOf: ref => slots.get(ref) ?? null,
    compByRef: ref => (ref == null ? null : comps.get(String(ref).split(':')[0]) ?? null),
  };
}
```

- [ ] **Step 4: Give the editor a per-call `ctx`**

In `kit/rack/editor.js`, replace

```js
  function apply(cmds, {origin = 'ui'} = {}) {
```

with

```js
  // A PER-CALL CONTEXT (`ctx`, e.g. the slots `loadSlots` read) is
  // laid over {chassisOf} for that one call and kept nowhere: the page's own
  // calls, which pass none, are checked exactly as before.
  const withCtx = extra => (extra ? {...ctx, ...extra} : ctx);

  function apply(cmds, {origin = 'ui', ctx: extra = null} = {}) {
```

then replace `const res = applyCommands(before, commands, ctx);` with `const res = applyCommands(before, commands, withCtx(extra));`, and replace

```js
    preview: cmds => applyCommands(rack(), list(cmds), ctx),
```

with

```js
    preview: (cmds, {ctx: extra = null} = {}) => applyCommands(rack(), list(cmds), withCtx(extra)),
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `cd spec/tests/js && node --test rack-slots.mjs rack-editor.mjs rack-catalog.mjs`
Expected: PASS (5 + 9 + 5 tests).

- [ ] **Step 6: Check spelling and syntax**

Run: `python3 spec/tools/portrayal/comment_spelling.py kit/rack && (cd kit && npm test)`
Expected: `comment spelling: clean`, exit 0.

- [ ] **Step 7: Commit**

```bash
git add kit/rack/catalog.js kit/rack/editor.js spec/tests/js/rack-slots.mjs spec/tests/js/rack-editor.mjs
git commit -m "rack: loadSlots reads the parts lists once, and the editor takes a per-call ctx

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `inspect` for an item, and the slot module it reads

**Files:**
- Create: `kit/rack/slots.js`
- Modify: `kit/rack/queries.js` (imports; append the inspect section)
- Modify: `kit/package.json` (`exports`: add `"./rack/slots": "./rack/slots.js"` after `"./rack/rails"`)
- Create: `spec/tests/js/slot-fixtures.mjs` (a helper, deliberately not `rack-*.mjs`)
- Create: `spec/tests/js/rack-inspect.mjs`

**Interfaces:**
- Consumes: from Task 2, `slotsOf(ref)` and `compByRef(ref)` as `loadSlots` returns them. From `kit/swap.js`: `slotResolver`, `builtBays`, `builtOccupants`, `underCarrier`. From `kit/fields.js`: `fieldRows`.
- Produces (`kit/rack/slots.js`, which Tasks 6, 7 and 9 import):
  - `partsMissing(ref) -> string`, which is `The parts list for <ref> could not be loaded.`
  - `slotsFor(ctx, ref) -> null | {error} | Slots`. It is null when `ctx.slotsOf` is not a function.
  - `partOf(compByRef, ref) -> Component | null`. It never throws.
  - `partName(compByRef, ref) -> string`: the first clause of the description, else the ref, else `'nothing'` for no ref.
  - `slotEnv(item, slots, compByRef) -> {bays, cages, cfg, compByRef, built(path), builtOcc(path)}`. `bays` and `cages` are flattened and each carries `view`. `built` and `builtOcc` return `undefined` when the configuration says nothing.
  - `holdsAt(env, swaps, path, slot) -> ref | null`.
  - `resolverFor(env, swaps) -> {entryAt(path), refAt(path)}`.
  - `slotTree(env, swaps) -> {bays: [{path, view, group, holds, default, accepts: string[]}], cages: [{path, view, interface, media, holds, default, accepts: string[]}]}`.
- Produces (`kit/rack/queries.js`): `inspect(rack, id, ctx = {}) -> Promise<ItemFacts | {error}>`. Its item shape is spec §3.1's. `slots: 'not loaded'` replaces `bays`, `cages` and `fields` when there is no `ctx.slotsOf` or it returns null. `fields[].path` is the part path.

- [ ] **Step 1: Write the fixture and the failing tests**

Create `spec/tests/js/slot-fixtures.mjs`:

```js
// spec/tests/js/slot-fixtures.mjs
// A small catalogue for the rack tests that need slots: what catalog.js
// loadSlots would return for two devices, and the parts they take. Not a test
// file (the rack wrapper runs rack-*.mjs only).

export const SIZES = {
  leaf: {ru: 1, h: 43.6, d: 400, model: 'Leaf-48', manufacturer: 'Acme', configs: ['base', 'dc'], default: 'base', family: 'Leaf Switch', kind: 'switch'},
  pp: {ru: 1, h: 44, d: 300, model: 'PP-4', manufacturer: 'Acme', configs: ['empty', 'loaded'], default: 'loaded', family: null, kind: 'patch panel',
       guides: {front: ['guide-1']}},
  mgr: {ru: 1, h: 44, d: 110, mount: 'rack-face', model: 'Ring-1', manufacturer: 'Acme', configs: ['base'], default: 'base', family: null,
        kind: 'cable manager', guides: {front: ['guide-1', 'guide-2']}, passes: {front: ['window-1']}},
};
export const chassisOf = ref => (Object.hasOwn(SIZES, ref) ? SIZES[ref] : null);

const SFP = ['acme/sr@1', 'acme/lr@1', 'acme/dac@1'];
const CASSETTES = ['acme/lc6@1', 'acme/mpo2@1', 'acme/blank@1', 'acme/carrier@1'];
export const SLOTS = {
  leaf: {default: 'base',
    bays: {front: [], rear: [{id: 'psu-1', group: 'psus', accepts: ['acme/psu-ac@1', 'acme/psu-dc@1'], default: 'acme/psu-ac@1'}]},
    cages: {front: [{id: 'port-1', group: 'sfp', interface: 'sfp', media: 'sfp', accepts: SFP, default: null},
                    {id: 'port-2', group: 'sfp', interface: 'sfp', media: 'sfp', accepts: SFP, default: null}], rear: []},
    configs: [{name: 'base', description: 'AC power', airflow: 'front-to-back', bays: {}, occupants: {'port-1': 'acme/sr@1'}},
              {name: 'dc', description: 'DC power', airflow: 'front-to-back', bays: {'psu-1': 'acme/psu-dc@1'}, occupants: {}}]},
  pp: {default: 'loaded',
    bays: {front: [{id: 'bay-1', group: 'cassettes', accepts: CASSETTES, default: 'acme/blank@1'},
                   {id: 'bay-2', group: 'cassettes', accepts: CASSETTES, default: 'acme/blank@1'}], rear: []},
    cages: {front: [], rear: []},
    configs: [{name: 'empty', description: 'No cassettes', airflow: 'passive', bays: {}, occupants: {}},
              {name: 'loaded', description: 'One LC cassette', airflow: 'passive', bays: {'bay-1': 'acme/lc6@1'}, occupants: {}}]},
};

const LC = n => ({id: `lc${n}`, interface: 'lc-duplex', media: null, accepts: ['acme/lc-plug@1'], default: null, bores: []});
export const COMPONENTS = {
  'acme/psu-ac@1': {class: 'psu', description: 'AC power supply - 650 W'},
  'acme/psu-dc@1': {class: 'psu', description: 'DC power supply - 650 W'},
  'acme/sr@1': {class: 'transceiver', description: 'SR optic - 850 nm', attrs: {media: 'fiber', mode: 'multimode', face: 'lc-duplex'},
    fields: {'pull-tab': {type: 'choice', options: ['blue', 'black'], default: 'black', label: 'Pull tab'},
             label: {type: 'text', default: '', label: 'Label'}}},
  'acme/lr@1': {class: 'transceiver', description: 'LR optic - 1310 nm', attrs: {media: 'fiber', mode: 'single-mode', face: 'lc-duplex'}},
  'acme/dac@1': {class: 'transceiver', description: 'DAC end', attrs: {'cable-kind': 'dac'}},
  'acme/lc6@1': {class: 'cassette', description: 'LC cassette - six LC duplex', cages: [LC(1), LC(2)],
    parts: [{id: 'lc1', ref: 'acme/lc-adapter@1'}, {id: 'lc2', ref: 'acme/lc-adapter@1'}],
    fields: {'latch-color': {type: 'choice', options: ['blue', 'green', 'beige'], default: 'blue', label: 'Latch colour'}}},
  'acme/mpo2@1': {class: 'cassette', description: 'MPO cassette - two MPO',
    cages: [{id: 'mpo1', interface: 'mpo', media: null, accepts: [], default: null, bores: []}], parts: [{id: 'mpo1', ref: 'acme/mpo-adapter@1'}]},
  'acme/blank@1': {class: 'blank', description: 'Blank plate'},
  'acme/carrier@1': {class: 'module', description: 'Carrier - one sub-bay', bays: {'sub-1': {accepts: ['acme/lc6@1'], default: null}}},
  'acme/lc-plug@1': {class: 'plug', description: 'LC plug'},
};
export const compByRef = ref => {
  const k = ref == null ? null : String(ref).split(':')[0];
  return k && Object.hasOwn(COMPONENTS, k) ? COMPONENTS[k] : null;
};
export const slotsOf = ref => (Object.hasOwn(SLOTS, ref) ? SLOTS[ref] : null);
// What the commands and queries take: chassisOf, and the two lookups loadSlots returns.
export const ctx = {chassisOf, slotsOf, compByRef};
```

Create `spec/tests/js/rack-inspect.mjs`:

```js
// spec/tests/js/rack-inspect.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../../../kit/rack/model.js';
import {inspect} from '../../../kit/rack/queries.js';
import {GONE, CABLE_GONE} from '../../../kit/rack/commands.js';
import {ctx, chassisOf} from './slot-fixtures.mjs';

const CFG = {leaf: 'base', pp: 'loaded', mgr: 'base'};
const add = (rack, ref, ru, extra = {}) => M.withItem(rack, {ref, cfg: CFG[ref], ru, label: ref, ...extra}).rack;
const end = (item, path = 'port-1', view = 'front') => ({item, path, view});
const cable = (id, a, b, extra = {}) => ({id, a, b, media: '', purpose: '', label: '', route: [], ...extra});

test('inspect: an item without slots says they were not loaded, and still lists its cables', async () => {
  let r = add(add(M.newRack(), 'leaf', 10, {label: 'leaf-1'}), 'leaf', 20, {label: 'leaf-2'});
  r = {...r, cables: [cable('c1', end('i1'), end('i2', 'port-2'))]};
  const got = await inspect(r, 'i1', {chassisOf});
  assert.deepEqual(got, {kind: 'item', id: 'i1', ref: 'leaf', model: 'Leaf-48', manufacturer: 'Acme', label: 'leaf-1', cfg: 'base',
    configs: [{name: 'base', description: '', airflow: null}, {name: 'dc', description: '', airflow: null}],
    ru: 10, u: 1, face: 'front', turned: false, on: null, unit: null, managers: [], slots: 'not loaded',
    cables: [{id: 'c1', end: 'a', path: 'port-1', view: 'front', other: 'i2/port-2'}]});
});

test('inspect: an item with slots lists its bays, cages and fields, with what each holds', async () => {
  const r = add(M.newRack(), 'leaf', 10, {label: 'leaf-1', swaps: {'port-2': 'acme/lr@1'}, fields: {'port-1-occupant': {'pull-tab': 'blue'}}});
  const got = await inspect(r, 'i1', ctx);
  assert.equal('slots' in got, false);
  assert.deepEqual(got.configs[0], {name: 'base', description: 'AC power', airflow: 'front-to-back'});
  assert.deepEqual(got.bays, [{path: 'psu-1', view: 'rear', group: 'psus', holds: 'acme/psu-ac@1', default: 'acme/psu-ac@1',
    accepts: [{ref: 'acme/psu-ac@1', name: 'AC power supply', kind: 'psu'}, {ref: 'acme/psu-dc@1', name: 'DC power supply', kind: 'psu'}]}]);
  // port-1 holds what the configuration builds; port-2 the item's own swap
  assert.deepEqual(got.cages.map(g => [g.path, g.view, g.interface, g.holds, g.default]),
    [['port-1', 'front', 'sfp', 'acme/sr@1', null], ['port-2', 'front', 'sfp', 'acme/lr@1', null]]);
  assert.deepEqual(got.cages[0].accepts.map(a => a.ref), ['acme/sr@1', 'acme/lr@1', 'acme/dac@1']);
  assert.deepEqual(got.fields, [
    {path: 'port-1-occupant', key: 'pull-tab', type: 'choice', value: 'blue', default: 'black', choices: ['blue', 'black']},
    {path: 'port-1-occupant', key: 'label', type: 'text', value: '', default: ''}]);
});

test('inspect: a bay lists the slots on what it holds, and a swapped carrier holds its defaults', async () => {
  const r = add(M.newRack(), 'pp', 5, {label: 'pp-1', swaps: {'bay-2': 'acme/carrier@1'}});
  const got = await inspect(r, 'i1', ctx);
  assert.deepEqual(got.bays.map(b => [b.path, b.holds]),
    [['bay-1', 'acme/lc6@1'], ['bay-2', 'acme/carrier@1'], ['bay-2/module/sub-1', null]]);
  assert.deepEqual(got.cages.map(g => [g.path, g.interface]), [['bay-1/module/lc1', 'lc-duplex'], ['bay-1/module/lc2', 'lc-duplex']]);
  assert.deepEqual(got.fields.map(f => [f.path, f.key, f.value]), [['bay-1/module', 'latch-color', 'blue']]);
});

test('inspect: a device whose parts list did not load reads as not loaded', async () => {
  const r = add(M.newRack(), 'leaf', 10);
  const got = await inspect(r, 'i1', {...ctx, slotsOf: () => null});
  assert.equal(got.slots, 'not loaded');
});

test('inspect: an id that is not in the rack', async () => {
  assert.deepEqual(await inspect(M.newRack(), 'i4', ctx), {error: GONE});
  assert.deepEqual(await inspect(M.newRack(), 'c4', ctx), {error: CABLE_GONE});
});

test('inspect: an item whose configuration the parts list no longer has reads as the default one', async () => {
  const r = add(M.newRack(), 'leaf', 10, {cfg: 'gone'});
  const got = await inspect(r, 'i1', ctx);
  assert.equal(got.cfg, 'gone');
  assert.deepEqual(got.cages.map(g => [g.path, g.holds]), [['port-1', 'acme/sr@1'], ['port-2', null]]);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd spec/tests/js && node --test rack-inspect.mjs`
Expected: FAIL with `SyntaxError: The requested module '../../../kit/rack/queries.js' does not provide an export named 'inspect'`.

- [ ] **Step 3: Write `kit/rack/slots.js`**

```js
// kit/rack/slots.js
// WHAT A PLACED DEVICE HOLDS, read without a drawing: its bays and cages from
// `<ref>.configs.json`, what its configuration builds in them, and what the
// item's own swaps change. The commands that check a slot (`fit`, `field`,
// `patch`) and the query that lists them (`inspect`) read it here, so the two
// cannot disagree. Pure: `slots` and `compByRef` are what `loadSlots` in `catalog.js`
// returns, handed in by the caller.

import {slotResolver, builtBays, builtOccupants, underCarrier} from '../swap.js';

const own = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);

// The sentence for a device whose parts list the caller could not load.
export const partsMissing = ref => `The parts list for ${ref} could not be loaded.`;

// What the commands need of ctx for one device: null when the caller loaded no
// slots at all (today's behaviour: nothing is checked), {error} when it loaded
// them and this device's are missing, else the device's slots.
export function slotsFor(ctx, ref) {
  if (typeof ctx?.slotsOf !== 'function') return null;
  return ctx.slotsOf(ref) || {error: partsMissing(ref)};
}

// The components.json entry for a part, or null: no ref, no lookup, or a
// lookup that throws on a ref it cannot read.
export const partOf = (compByRef, ref) => {
  if (!ref || typeof compByRef !== 'function') return null;
  try { return compByRef(ref) || null; } catch { return null; }
};

// A part as a person reads it: the first clause of its description ("FS
// FHD-1MTP6LCDOS2A", "A generic QSFP with an LC duplex face"), else its ref.
export function partName(compByRef, ref) {
  if (!ref) return 'nothing';
  const c = partOf(compByRef, ref);
  const first = String(c?.description || '').split(/\s[-–]\s|\.\s|\.$/)[0].trim();
  return first && first.length <= 60 ? first : ref;
}

// The device's own bays and cages, every view, each carrying its view; the
// configuration the item is built as (its own, else the device's default);
// and what that configuration seats, by the drawing's path.
export function slotEnv(item, slots, compByRef = null) {
  const flat = by => Object.entries(by || {}).flatMap(([view, list]) => (list || []).map(s => ({...s, view})));
  const bays = flat(slots.bays), cages = flat(slots.cages);
  const configs = slots.configs || [];
  const cfg = configs.find(c => c.name === item.cfg) || configs.find(c => c.name === slots.default) || null;
  const cb = builtBays(cfg);
  const occ = builtOccupants(cfg, cages, compByRef ? {bays, compByRef} : null);
  return {bays, cages, cfg, compByRef,
          built: p => (own(cb, p) ? cb[p] || null : undefined),
          builtOcc: p => (own(occ, p) ? occ[p] || null : undefined)};
}

// What a slot holds under the swaps map `swaps`: the map's answer; else the
// configuration's, unless a carrier above it was swapped (a fresh seat holds
// its defaults); else what the slot ships with.
export function holdsAt(env, swaps, path, slot) {
  if (own(swaps, path)) return swaps[path] || null;
  const reseated = Object.keys(swaps || {}).some(k => k !== path && underCarrier(path, k));
  const was = reseated ? undefined : (slot?.isCage ? env.builtOcc(path) : env.built(path));
  return was !== undefined ? was : slot?.default ?? null;
}

// swap.js slotResolver over this device, with `swaps` deciding what each
// carrier holds: `entryAt(path)` is the bay or cage at a path, nested ones
// included, and `refAt(path)` the part drawn at a part path (`<bay>/module`,
// `<cage>-occupant`).
export function resolverFor(env, swaps) {
  return slotResolver({bays: env.bays, cages: env.cages, compByRef: env.compByRef,
    bayRef: (p, bay) => holdsAt(env, swaps, p, bay),
    occRef: (p, slot) => holdsAt(env, swaps, p, {...slot, isCage: true})});
}

// Every bay and cage, the device's own and those on what its bays hold, in
// order, each with what it holds now. A cage's own bores (an adapter's two
// fibres) are not listed: a path reaches them all the same.
export function slotTree(env, swaps) {
  const bays = [], cages = [];
  const seen = new Set();
  const addBay = (path, view, b) => {
    const holds = holdsAt(env, swaps, path, b);
    bays.push({path, view, group: b.group ?? null, holds, default: b.default ?? null, accepts: b.accepts || []});
    const c = partOf(env.compByRef, holds);
    if (!c || seen.has(path)) return;
    seen.add(path);
    for (const [id, nb] of Object.entries(c.bays || {})) addBay(`${path}/module/${id}`, view, nb);
    for (const g of Array.isArray(c.cages) ? c.cages : []) addCage(`${path}/module/${g.id}`, view, g);
  };
  const addCage = (path, view, g) => cages.push({path, view, interface: g.interface ?? null, media: g.media ?? null,
    holds: holdsAt(env, swaps, path, {...g, isCage: true}), default: g.default ?? null, accepts: g.accepts || []});
  for (const b of env.bays) addBay(b.id, b.view, b);
  for (const g of env.cages) addCage(g.id, g.view, g);
  return {bays, cages};
}
```

- [ ] **Step 4: Write `inspect` for items**

In `kit/rack/queries.js`, replace `import {GONE} from './commands.js';` with:

```js
import {GONE, CABLE_GONE} from './commands.js';
import {slotEnv, slotTree, partName, partOf} from './slots.js';
import {fieldRows} from '../fields.js';
```

Append to the end of `kit/rack/queries.js`:

```js

// ── inspect (one item or one cable, whole) ──────────────────────────────
// What an agent needs before it fits a part, sets a field or re-points a
// cable, as a plain object for the caller to format. Async because a cable's
// loose ends and media are read through `ctx.cableFacts`, as looseEnds reads
// them; everything else is answered from the rack and what ctx hands in.
const offers = (ctx, refs) => refs.map(ref => ({ref, name: partName(ctx.compByRef, ref), kind: partOf(ctx.compByRef, ref)?.class ?? null}));

function itemFacts(rack, item, ctx) {
  const c = ctx.chassisOf?.(item.ref) || null;
  const slots = typeof ctx.slotsOf === 'function' ? ctx.slotsOf(item.ref) : null;
  const configs = slots
    ? (slots.configs || []).map(k => ({name: k.name, description: k.description ?? '', airflow: k.airflow ?? null}))
    : (c?.configs || []).map(name => ({name, description: '', airflow: null}));
  const out = {kind: 'item', id: item.id, ref: item.ref, model: c?.model ?? null, manufacturer: c?.manufacturer ?? null,
    label: item.label, cfg: item.cfg, configs, ru: item.ru, u: Math.max(1, c?.ru ?? 1), face: item.face, turned: !!item.turned,
    on: item.on ?? null, unit: item.unit ?? null, managers: managersOf(rack, item.id).map(m => m.id)};
  if (!slots) out.slots = 'not loaded';
  else {
    const env = slotEnv(item, slots, ctx.compByRef);
    const tree = slotTree(env, item.swaps || {});
    out.bays = tree.bays.map(b => ({...b, accepts: offers(ctx, b.accepts)}));
    out.cages = tree.cages.map(g => ({...g, accepts: offers(ctx, g.accepts)}));
    // the fields of every seated part that declares any, at the part's own
    // path - what the `field` command takes
    const parts = [...tree.bays.map(b => [`${b.path}/module`, b.holds]), ...tree.cages.map(g => [`${g.path}-occupant`, g.holds])];
    out.fields = parts.flatMap(([path, ref]) => fieldRows(partOf(ctx.compByRef, ref)?.fields, item.fields?.[path])
      .map(r => ({path, key: r.key, type: r.type, value: r.value, default: r.default, ...(r.type === 'choice' ? {choices: r.options} : {})})));
  }
  out.cables = (rack.cables || []).flatMap(cb => [['a', cb.a, cb.b], ['b', cb.b, cb.a]]
    .filter(([, e]) => e.item === item.id)
    .map(([end, e, o]) => ({id: cb.id, end, path: e.path, view: e.view, other: `${o.item}/${o.path}`})));
  return out;
}

export async function inspect(rack, id, ctx = {}) {
  const item = rack.items.find(i => i.id === id);
  if (item) return itemFacts(rack, item, ctx);
  return {error: /^c\d+$/.test(String(id)) ? CABLE_GONE : GONE};
}
```

In `kit/package.json` `exports`, add after the `"./rack/rails"` line:

```json
    "./rack/slots": "./rack/slots.js",
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `cd spec/tests/js && node --test rack-inspect.mjs rack-queries.mjs`
Expected: PASS (6 + 5 tests).

- [ ] **Step 6: Check spelling and syntax**

Run: `python3 spec/tools/portrayal/comment_spelling.py kit/rack && (cd kit && npm test)`
Expected: `comment spelling: clean`, exit 0.

- [ ] **Step 7: Commit**

```bash
git add kit/rack/slots.js kit/rack/queries.js kit/package.json spec/tests/js/slot-fixtures.mjs spec/tests/js/rack-inspect.mjs
git commit -m "rack: inspect an item - its bays, cages and part fields, read through slots.js

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `inspect` for a cable

**Files:**
- Modify: `kit/rack/queries.js` (imports; add `pathwayIds` and `cableInfo` before `inspect`; one line in `inspect`)
- Modify: `spec/tests/js/rack-inspect.mjs` (append)

**Interfaces:**
- Consumes: from `cable-rules.js`, `endName`, `carriedU`, `endKey`, `mismatch`. From `route.js`, `lanesOf`, `resolveRoute`, `routedLength`, `routeText`. From `managers.js`, `managersOf`. `ctx.route` is a route context (`{chassisOf, guidesOf, portX, portY?}`, as `route.js` takes). `ctx.cableFacts(rack, ends) -> Promise<{ends: Map<endKey, {info, reason}>, unchecked?}>`, as `looseEnds` takes.
- Produces: `inspect(rack, cableId, ctx)` resolves to `{kind: 'cable', id, a: {item, path, view, name}, b, media, purpose, label, length: {value, unit, source} | null, routed: {metres, stock} | null, route: {edited, waypoints, text}, lanes, passes: {[itemId]: string[]}, loose: [{end, reason}] | null, mismatch: string[] | null}`. `loose` and `mismatch` are null when there is no `ctx.cableFacts`, or when the facts say `unchecked`.

- [ ] **Step 1: Write the failing tests**

Append to `spec/tests/js/rack-inspect.mjs`:

```js

const ROUTE = {chassisOf, guidesOf: () => [], portX: () => -100};

test('inspect: a cable, with its routed length from a route context', async () => {
  let r = add(add(M.newRack(), 'leaf', 10, {label: 'leaf-1'}), 'leaf', 20, {label: 'leaf-2'});
  r = add(r, 'mgr', 20, {label: 'ring', on: 'i2', unit: 1});
  r = {...r, cables: [cable('c1', end('i1'), end('i2'), {media: 'om4', purpose: 'uplink', label: 'A1', length: {value: 2, unit: 'm', source: 'entered'}})]};
  const got = await inspect(r, 'c1', {chassisOf, route: ROUTE});
  assert.deepEqual(got, {kind: 'cable', id: 'c1',
    a: {item: 'i1', path: 'port-1', view: 'front', name: 'leaf-1 (U10) port-1'},
    b: {item: 'i2', path: 'port-1', view: 'front', name: 'leaf-2 (U20) port-1'},
    media: 'om4', purpose: 'uplink', label: 'A1', length: {value: 2, unit: 'm', source: 'entered'},
    routed: {metres: 1.09, stock: 1.5},
    route: {edited: false, waypoints: [{lane: 'left-front', ru: 10}, {lane: 'left-front', ru: 20}], text: 'left-front U10-U20'},
    lanes: ['left-front', 'right-front', 'left-rear', 'right-rear'],
    passes: {i3: ['guide-1', 'guide-2', 'window-1']},
    loose: null, mismatch: null});
});

test('inspect: a hand-made route without a route context, and loose ends and media from the cable facts', async () => {
  let r = add(add(M.newRack(), 'leaf', 10, {label: 'leaf-1'}), 'pp', 20, {label: 'pp-1'});
  const route = [{lane: 'right-front', ru: 12}, {lane: 'right-front', ru: 18}];
  r = {...r, cables: [cable('c1', end('i1'), end('i2', 'bay-1/module/lc1'), {media: 'os2', route, routeEdited: true})]};
  const copper = {family: 'copper', mode: null};
  const cableFacts = async (_rack, ends) => {
    assert.deepEqual(ends, [end('i1'), end('i2', 'bay-1/module/lc1')]);
    return {ends: new Map([['i1|front|port-1', {info: copper, reason: null}],
                           ['i2|front|bay-1/module/lc1', {info: null, reason: 'bay-1/module/lc1 holds no optic'}]])};
  };
  const got = await inspect(r, 'c1', {chassisOf, cableFacts});
  assert.equal(got.routed, null);
  assert.deepEqual(got.route, {edited: true, waypoints: route, text: 'right-front U12-U18'});
  assert.deepEqual(got.passes, {i2: ['guide-1']});
  assert.deepEqual(got.loose, [{end: 'b', reason: 'bay-1/module/lc1 holds no optic'}]);
  assert.deepEqual(got.mismatch, ['OS2 single-mode fiber does not suit end A, which is copper.']);
});

test('inspect: a route context that throws leaves the cable unmeasured', async () => {
  let r = add(add(M.newRack(), 'leaf', 10), 'leaf', 20);
  r = {...r, cables: [cable('c1', end('i1'), end('i2'))]};
  const got = await inspect(r, 'c1', {chassisOf, route: {...ROUTE, portX: () => { throw new Error('no drawing'); }}});
  assert.equal(got.routed, null);
  assert.deepEqual(got.route.waypoints, []);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd spec/tests/js && node --test rack-inspect.mjs`
Expected: FAIL. The three cable tests get `{error: 'That cable is no longer in the rack.'}`.

- [ ] **Step 3: Write the cable half**

In `kit/rack/queries.js`, replace the `cable-rules.js` import line with

```js
import {portFree, endKey, proposeMedia, mismatch, endName, carriedU} from './cable-rules.js';
import {lanesOf, resolveRoute, routedLength, routeText} from './route.js';
```

Insert immediately above `export async function inspect(`:

```js
// The pathway ids a route may name on a device: its rings and ducts
// (`guides`) and pass-throughs (`passes`), every view, from rack.json.
const pathwayIds = c => [...new Set(['guides', 'passes'].flatMap(k => Object.values(c?.[k] || {}).flat()))].sort();

async function cableInfo(rack, cable, ctx) {
  const uOf = ctx.chassisOf ? heightOf(ctx.chassisOf) : carriedU;
  const end = e => ({item: e.item, path: e.path, view: e.view, name: endName(rack, e, uOf)});
  const l = cable.length;
  const label = id => rack.items.find(i => i.id === id)?.label ?? id;
  const edited = cable.routeEdited === true;
  // A route context's readers come from the page's drawings and may throw; a
  // measure that fails is "not measured", never an error.
  let routed = null, waypoints = edited ? cable.route || [] : [];
  if (ctx.route) {
    try {
      waypoints = resolveRoute(rack, cable, ctx.route).waypoints;
      const r = routedLength(rack, cable, ctx.route);
      routed = r ? {metres: Math.round(r.measured * 100) / 100, stock: r.value} : null;
    } catch { routed = null; }
  }
  // the devices a route through this cable's ends can name: its two, and the
  // cable managers bolted on them
  const near = [...new Set([cable.a.item, cable.b.item])].filter(id => rack.items.some(i => i.id === id))
    .flatMap(id => [id, ...managersOf(rack, id).map(m => m.id)]);
  const passes = Object.fromEntries(near.map(id => [id, pathwayIds(ctx.chassisOf?.(rack.items.find(i => i.id === id).ref))])
    .filter(([, ids]) => ids.length));
  let loose = null, warn = null;
  if (typeof ctx.cableFacts === 'function') {
    const facts = await ctx.cableFacts(rack, [cable.a, cable.b]);
    if (!facts.unchecked) {
      const at = e => facts.ends.get(endKey(e)) || {};
      loose = [['a', cable.a], ['b', cable.b]].map(([side, e]) => ({end: side, reason: at(e).reason ?? null})).filter(x => x.reason);
      warn = mismatch(cable.media, at(cable.a).info || null, at(cable.b).info || null);
    }
  }
  return {kind: 'cable', id: cable.id, a: end(cable.a), b: end(cable.b), media: cable.media, purpose: cable.purpose, label: cable.label,
    length: l ? {value: l.value, unit: l.unit ?? 'm', source: l.source ?? 'entered'} : null, routed,
    route: {edited, waypoints, text: routeText(waypoints, label, rack.frame)}, lanes: lanesOf(rack.frame), passes,
    loose, mismatch: warn};
}

```

and replace the body of `inspect` so that it reads:

```js
export async function inspect(rack, id, ctx = {}) {
  const item = rack.items.find(i => i.id === id);
  if (item) return itemFacts(rack, item, ctx);
  const cable = (rack.cables || []).find(c => c.id === id);
  if (cable) return cableInfo(rack, cable, ctx);
  return {error: /^c\d+$/.test(String(id)) ? CABLE_GONE : GONE};
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd spec/tests/js && node --test rack-inspect.mjs rack-queries.mjs rack-route.mjs`
Expected: PASS (9 tests in `rack-inspect.mjs`).

- [ ] **Step 5: Check spelling and syntax, then commit**

```bash
python3 spec/tools/portrayal/comment_spelling.py kit/rack && (cd kit && npm test)
git add kit/rack/queries.js spec/tests/js/rack-inspect.mjs
git commit -m "rack: inspect a cable - its ends, route, routed length, pathways and loose ends

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `selectCables`

**Files:**
- Modify: `kit/rack/queries.js` (import; append)
- Create: `spec/tests/js/rack-select.mjs`

**Interfaces:**
- Consumes: `portPathOf`, `matches` and `endKey` from `cable-rules.js`; `ctx.cableFacts` as in Task 4.
- Produces:
  - `selectCables(rack, selector, ctx = {}) -> Promise<{ids: string[]} | {error: string}>`. The keys are `item`, `path`, `view`, `loose`, `purpose` and `media`, and they combine.
  - The constant `NO_FACTS`, the refusal for `{loose: true}` without `ctx.cableFacts`.

- [ ] **Step 1: Write the failing tests**

Create `spec/tests/js/rack-select.mjs`:

```js
// spec/tests/js/rack-select.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../../../kit/rack/model.js';
import {selectCables, NO_FACTS} from '../../../kit/rack/queries.js';
import {GONE} from '../../../kit/rack/commands.js';

const end = (item, path = 'port-1', view = 'front') => ({item, path, view});
const cable = (id, a, b, extra = {}) => ({id, a, b, media: '', purpose: '', label: '', route: [], ...extra});
let R = M.newRack();
for (const ru of [10, 20]) R = M.withItem(R, {ref: 'leaf', cfg: 'base', ru, label: `leaf-${ru}`}).rack;
R = {...R, cables: [
  cable('c1', end('i1'), end('i2'), {purpose: 'uplink', media: 'om4'}),
  cable('c2', end('i1', 'port-2-occupant/tx'), end('i2', 'port-2'), {purpose: 'uplink', media: 'os2'}),
  cable('c3', end('i1', 'port-1', 'rear'), end('i9', 'port-1'), {purpose: 'management', media: 'cat6a'})]};
const facts = async () => ({ends: new Map([['i9|front|port-1', {reason: 'the device was removed'}]])});

test('selectCables: by item, by port on either panel or one, and a port spelled through its optic', async () => {
  assert.deepEqual(await selectCables(R, {item: 'i1'}), {ids: ['c1', 'c2', 'c3']});
  assert.deepEqual(await selectCables(R, {item: 'i1', path: 'port-1'}), {ids: ['c1', 'c3']});
  assert.deepEqual(await selectCables(R, {item: 'i1', path: 'port-1', view: 'rear'}), {ids: ['c3']});
  assert.deepEqual(await selectCables(R, {item: 'i1', path: 'port-2'}), {ids: ['c2']});
  assert.deepEqual(await selectCables(R, {item: 'i2', path: 'port-2-occupant'}), {ids: ['c2']});
});

test('selectCables: by purpose, by media, and both narrowing together', async () => {
  assert.deepEqual(await selectCables(R, {purpose: 'uplink'}), {ids: ['c1', 'c2']});
  assert.deepEqual(await selectCables(R, {media: 'cat6a'}), {ids: ['c3']});
  assert.deepEqual(await selectCables(R, {item: 'i2', purpose: 'uplink', media: 'os2'}), {ids: ['c2']});
});

test('selectCables: loose ends need the cable facts', async () => {
  assert.deepEqual(await selectCables(R, {loose: true}, {cableFacts: facts}), {ids: ['c3']});
  assert.deepEqual(await selectCables(R, {loose: true}), {error: NO_FACTS});
});

test('selectCables: an empty result is not an error; a removed device with loose cables still answers', async () => {
  assert.deepEqual(await selectCables(R, {purpose: 'storage'}), {ids: []});
  assert.deepEqual(await selectCables(R, {item: 'i2', path: 'port-48'}), {ids: []});
  assert.deepEqual(await selectCables(R, {item: 'i9'}), {ids: ['c3']});
  assert.deepEqual(await selectCables(R, {item: 'i7'}), {error: GONE});
});

test('selectCables: a selector it cannot read is refused with a sentence', async () => {
  assert.deepEqual(await selectCables(R, {}), {error: 'A selector names an item, loose: true, a purpose or a media.'});
  assert.deepEqual(await selectCables(R, null), {error: 'A selector names an item, loose: true, a purpose or a media.'});
  assert.deepEqual(await selectCables(R, {label: 'A1'}), {error: 'A selector does not take label.'});
  assert.deepEqual(await selectCables(R, {path: 'port-1'}), {error: 'A selector with a path needs its item.'});
  assert.deepEqual(await selectCables(R, {loose: false}), {error: 'A selector takes loose: true, or leaves it out.'});
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd spec/tests/js && node --test rack-select.mjs`
Expected: FAIL: `does not provide an export named 'NO_FACTS'`.

- [ ] **Step 3: Write `selectCables`**

In `kit/rack/queries.js`, replace the `cable-rules.js` import line with

```js
import {portFree, endKey, proposeMedia, mismatch, endName, carriedU, portPathOf, matches} from './cable-rules.js';
```

and append:

```js

// ── selectCables (D5: a query, not a command argument) ──────────────────
// The ids of the cables a selector names, for a caller to expand into plain
// `cable.remove` or `cable.update` commands, so a batch stays one an agent can
// read back. Every key given narrows: {item, purpose} is that device's cables
// of that purpose. An empty result is {ids: []}.
const SELECTOR_KEYS = ['item', 'path', 'view', 'loose', 'purpose', 'media'];
export const NO_FACTS = 'Which cables are loose is only known once the devices have been read.';

export async function selectCables(rack, selector, ctx = {}) {
  const s = selector && typeof selector === 'object' && !Array.isArray(selector) ? selector : {};
  const keys = Object.keys(s);
  const odd = keys.find(k => !SELECTOR_KEYS.includes(k));
  if (odd) return {error: `A selector does not take ${odd}.`};
  if (('path' in s || 'view' in s) && !('item' in s)) return {error: 'A selector with a path needs its item.'};
  if ('loose' in s && s.loose !== true) return {error: 'A selector takes loose: true, or leaves it out.'};
  if (!keys.some(k => ['item', 'loose', 'purpose', 'media'].includes(k)))
    return {error: 'A selector names an item, loose: true, a purpose or a media.'};
  let list = rack.cables || [];
  if ('item' in s) {
    const ends = c => [c.a, c.b].filter(e => e.item === s.item);
    if (!rack.items.some(i => i.id === s.item) && !list.some(c => ends(c).length)) return {error: GONE};
    // a port however its path is spelled (a click on a seated optic is a click
    // on its port: cable-rules.js portPathOf), on one panel or on either
    const port = e => ('path' in s ? portPathOf(e.path) === portPathOf(s.path) : true) && ('view' in s ? e.view === s.view : true);
    list = list.filter(c => ends(c).some(port));
  }
  if ('purpose' in s || 'media' in s) list = list.filter(c => matches(c, {purpose: s.purpose ?? null, media: s.media ?? null}));
  if (s.loose === true) {
    if (typeof ctx.cableFacts !== 'function') return {error: NO_FACTS};
    const facts = await ctx.cableFacts(rack);
    list = list.filter(c => [c.a, c.b].some(e => facts.ends.get(endKey(e))?.reason));
  }
  return {ids: list.map(c => c.id)};
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd spec/tests/js && node --test rack-select.mjs rack-queries.mjs`
Expected: PASS (5 + 5 tests).

- [ ] **Step 5: Check spelling and syntax, then commit**

```bash
python3 spec/tools/portrayal/comment_spelling.py kit/rack && (cd kit && npm test)
git add kit/rack/queries.js spec/tests/js/rack-select.mjs
git commit -m "rack: selectCables turns the cables on a device, a port, a purpose or every loose end into ids

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The `fit` command

**Files:**
- Modify: `kit/rack/commands.js` (imports; the parts section before `// ── the rack`; one `COMMANDS` entry)
- Create: `spec/tests/js/rack-fit-command.mjs`

**Interfaces:**
- Consumes:
  - From Task 3 (`slots.js`): `slotsFor`, `slotEnv`, `resolverFor`, `holdsAt`, `partName`, `partOf`.
  - From `swap.js`: `acceptSwaps`, `underCarrier`.
  - From `cable-rules.js`: `connectorOf`, `mediaKind`, `MEDIA_LABELS`, `portPathOf`.
  - From Task 2: the editor's per-call `ctx`.
- Produces:
  - `COMMANDS.fit`, with `{id, path, ref}`. `ref` is a string, `null` to empty the slot, or `'default'`.
  - The private helper `own(o, k)`, at module level in `commands.js`, which Task 7 uses.

- [ ] **Step 1: Write the failing tests**

Create `spec/tests/js/rack-fit-command.mjs`:

```js
// spec/tests/js/rack-fit-command.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../../../kit/rack/model.js';
import {COMMANDS, GONE, apply} from '../../../kit/rack/commands.js';
import {ctx, chassisOf} from './slot-fixtures.mjs';

const run = (rack, args, c = ctx) => COMMANDS.fit.run(rack, args, c);
const CFG = {leaf: 'base', pp: 'loaded', mgr: 'base'};
const add = (rack, ref, ru, extra = {}) => M.withItem(rack, {ref, cfg: CFG[ref], ru, label: ref, ...extra}).rack;
const end = (item, path = 'port-1', view = 'front') => ({item, path, view});
const cable = (id, a, b, extra = {}) => ({id, a, b, media: '', purpose: '', label: '', route: [], ...extra});
const LEAF = add(M.newRack(), 'leaf', 10, {label: 'leaf-1', swaps: {'psu-1': 'acme/psu-dc@1'}});

test('fit: seat a part, empty a slot, and put back what the configuration builds', () => {
  const a = run(LEAF, {id: 'i1', path: 'port-2', ref: 'acme/lr@1'});
  assert.deepEqual(a.rack.items[0].swaps, {'psu-1': 'acme/psu-dc@1', 'port-2': 'acme/lr@1'});
  assert.equal(a.summary, 'Fitted LR optic in port-2 on leaf-1.');
  const b = run(LEAF, {id: 'i1', path: 'port-1', ref: null});
  assert.deepEqual(b.rack.items[0].swaps, {'psu-1': 'acme/psu-dc@1', 'port-1': null});
  assert.equal(b.summary, 'Emptied port-1 on leaf-1.');
  const c = run(LEAF, {id: 'i1', path: 'psu-1', ref: 'default'});
  assert.deepEqual(c.rack.items[0].swaps, {});
  assert.equal(c.summary, 'Fitted AC power supply in psu-1 on leaf-1.');
  assert.equal(run(LEAF, {id: 'i1', path: 'port-2', ref: 'default'}).rack, LEAF);
  assert.deepEqual(run(LEAF, {id: 'i9', path: 'port-1', ref: null}), {error: GONE});
});

test('fit: a nested bay, after its carrier', () => {
  const pp = add(M.newRack(), 'pp', 5, {label: 'pp-1'});
  const r = apply(pp, [{op: 'fit', id: 'i1', path: 'bay-2', ref: 'acme/carrier@1'},
                       {op: 'fit', id: 'i1', path: 'bay-2/module/sub-1', ref: 'acme/lc6@1'}], ctx);
  assert.deepEqual(r.rack.items[0].swaps, {'bay-2': 'acme/carrier@1', 'bay-2/module/sub-1': 'acme/lc6@1'});
  assert.equal(r.summary, 'Fitted Carrier in bay-2 on pp-1. Fitted LC cassette in bay-2/module/sub-1 on pp-1.');
});

test('fit: an unknown path lists the slots there; a part the slot does not take lists what it does', () => {
  assert.deepEqual(run(LEAF, {id: 'i1', path: 'port-9', ref: 'acme/sr@1'}),
    {error: 'port-9 is not a bay or cage on leaf-1. It has: psus: psu-1; sfp: port-1, port-2.'});
  assert.deepEqual(run(add(M.newRack(), 'pp', 5, {label: 'pp-1'}), {id: 'i1', path: 'bay-1/module/lc9', ref: 'acme/lc-plug@1'}),
    {error: 'bay-1/module/lc9 is not a bay or cage on pp-1. It has: lc-duplex: bay-1/module/lc1, bay-1/module/lc2.'});
  assert.deepEqual(run(LEAF, {id: 'i1', path: 'port-1', ref: 'acme/psu-ac@1'}),
    {error: 'port-1 does not take acme/psu-ac@1. It takes: acme/sr@1, acme/lr@1, acme/dac@1.'});
});

test('fit: a long list of parts is cut at eight', () => {
  const many = Array.from({length: 11}, (_, k) => `acme/x${k}@1`);
  const slotsOf = ref => (ref === 'leaf' ? {...ctx.slotsOf('leaf'), cages: {front: [{id: 'port-1', group: 'sfp', accepts: many, default: null}]}} : null);
  assert.deepEqual(run(LEAF, {id: 'i1', path: 'port-1', ref: 'acme/sr@1'}, {...ctx, slotsOf}),
    {error: `port-1 does not take acme/sr@1. It takes: ${many.slice(0, 8).join(', ')} and 3 more.`});
});

test('fit: without slots it merges and checks nothing; a missing parts list is refused', () => {
  const r = run(LEAF, {id: 'i1', path: 'port-48', ref: 'x'}, {chassisOf});
  assert.deepEqual(r.rack.items[0].swaps, {'psu-1': 'acme/psu-dc@1', 'port-48': 'x'});
  assert.deepEqual(run(LEAF, {id: 'i1', path: 'port-1', ref: null}, {...ctx, slotsOf: () => null}),
    {error: 'The parts list for leaf could not be loaded.'});
});

test('fit: a different cassette keeps the cables on ports it lacks as loose ends, and says so', () => {
  let r = add(add(M.newRack(), 'pp', 5, {label: 'pp-1'}), 'leaf', 10, {label: 'leaf-1'});
  r = {...r, cables: [cable('c1', end('i1', 'bay-1/module/lc1'), end('i2')), cable('c2', end('i1', 'bay-1/module/lc2/1'), end('i2', 'port-2'))]};
  const f = run(r, {id: 'i1', path: 'bay-1', ref: 'acme/mpo2@1'});
  assert.equal(f.rack.cables.length, 2);
  assert.deepEqual(f.findings, [{kind: 'note', text: 'Kept the cables on bay-1/module/lc1, bay-1/module/lc2/1 as loose ends (c1, c2): these ports are not on MPO cassette.'}]);
  const e = run(r, {id: 'i1', path: 'bay-1', ref: null});
  assert.deepEqual(e.findings, [{kind: 'note', text: 'Kept the cables on bay-1/module/lc1, bay-1/module/lc2/1 as loose ends (c1, c2): bay-1 is empty.'}]);
});

test('fit: what was seated in a part, and its fields, go with it', () => {
  const r = add(M.newRack(), 'pp', 5, {label: 'pp-1', swaps: {'bay-1/module/lc1': 'acme/lc-plug@1', 'bay-2': 'acme/lc6@1'},
    fields: {'bay-1/module': {'latch-color': 'green'}, 'bay-1/module/lc1-occupant': {x: '1'}, 'bay-2/module': {'latch-color': 'beige'}}});
  const f = run(r, {id: 'i1', path: 'bay-1', ref: 'acme/mpo2@1'});
  assert.deepEqual(f.rack.items[0].swaps, {'bay-1': 'acme/mpo2@1', 'bay-2': 'acme/lc6@1'});
  assert.deepEqual(f.rack.items[0].fields, {'bay-2/module': {'latch-color': 'beige'}});
});

test('fit: an optic that does not suit the cable on its port is a finding', () => {
  let r = add(add(M.newRack(), 'leaf', 10, {label: 'leaf-1'}), 'leaf', 20, {label: 'leaf-2'});
  r = {...r, cables: [cable('c3', end('i1', 'port-2'), end('i2', 'port-2'), {media: 'om4'})]};
  assert.deepEqual(run(r, {id: 'i1', path: 'port-2', ref: 'acme/lr@1'}).findings,
    [{kind: 'note', text: 'c3 now runs OM4 multimode fiber into LR optic.'}]);
  assert.deepEqual(run(r, {id: 'i1', path: 'port-2', ref: 'acme/sr@1'}).findings, []);
});

test('fit: the other swaps are kept', () => {
  const r = run(LEAF, {id: 'i1', path: 'port-2', ref: 'acme/dac@1'});
  assert.equal(r.rack.items[0].swaps['psu-1'], 'acme/psu-dc@1');
});

test('fit: a slot on the part the configuration built, with no swap naming that part', () => {
  const pp = add(M.newRack(), 'pp', 5, {label: 'pp-1'});
  const r = run(pp, {id: 'i1', path: 'bay-1/module/lc1', ref: 'acme/lc-plug@1'});
  assert.deepEqual(r.rack.items[0].swaps, {'bay-1/module/lc1': 'acme/lc-plug@1'});
  assert.equal(r.summary, 'Fitted LC plug in bay-1/module/lc1 on pp-1.');
});

test('fit: a swap from an older file that its slot refuses does not block another slot, and is kept', () => {
  const old = add(M.newRack(), 'leaf', 10, {label: 'leaf-1', swaps: {'port-1': 'junk'}});
  const r = run(old, {id: 'i1', path: 'port-2', ref: 'acme/sr@1'});
  assert.deepEqual(r.rack.items[0].swaps, {'port-1': 'junk', 'port-2': 'acme/sr@1'});
});

test('fit: a batch is one undo step, swaps and fields alike', async () => {
  const {createRackEditor} = await import('../../../kit/rack/editor.js');
  const doc = M.newDoc();
  doc.racks[0] = add(doc.racks[0], 'pp', 5, {label: 'pp-1', fields: {'bay-1/module': {'latch-color': 'green'}}});
  const ed = createRackEditor({doc, chassisOf});
  const res = ed.apply([{op: 'fit', id: 'i1', path: 'bay-1', ref: 'acme/mpo2@1'}, {op: 'fit', id: 'i1', path: 'bay-2', ref: 'acme/lc6@1'}],
                       {origin: 'agent', ctx});
  assert.equal(res.step, true);
  assert.deepEqual(ed.rack().items[0].fields, {});
  ed.undo();
  assert.deepEqual([ed.rack().items[0].swaps, ed.rack().items[0].fields], [{}, {'bay-1/module': {'latch-color': 'green'}}]);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd spec/tests/js && node --test rack-fit-command.mjs`
Expected: FAIL: `TypeError: Cannot read properties of undefined (reading 'run')`. `apply` gives `There is no command called 'fit'.`

- [ ] **Step 3: Write `fit`**

In `kit/rack/commands.js`, replace the `cable-rules.js` import line with

```js
import {canCable, withCable, updateCable, withoutCable, cablesOf, withoutCablesOf, cableName,
        connectorOf, mediaKind, portPathOf, MEDIA, MEDIA_LABELS} from './cable-rules.js';
```

and add after the `route.js` import:

```js
import {slotsFor, slotEnv, resolverFor, holdsAt, partName, partOf} from './slots.js';
import {acceptSwaps, underCarrier} from '../swap.js';
```

Insert immediately above the line `// ── the rack ────...`:

```js
// ── parts: one slot, one field (spec rack-agent-commands §5.1, §5.2) ─────
// A slot as a person lists it: the slots beside it, grouped, a long run of
// one group as its first and last.
const own = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);
function slotList(env, R, path) {
  const cut = path.lastIndexOf('/module/');
  const carrier = cut < 0 ? null : path.slice(0, cut);
  const c = carrier == null ? null : partOf(env.compByRef, R.refAt(`${carrier}/module`));
  const slots = c
    ? [...Object.entries(c.bays || {}).map(([id, b]) => ({...b, id: `${carrier}/module/${id}`})),
       ...(Array.isArray(c.cages) ? c.cages : []).map(g => ({...g, id: `${carrier}/module/${g.id}`}))]
    : [...env.bays, ...env.cages];
  const groups = new Map();
  for (const sl of slots) {
    const g = sl.group || sl.interface || 'other';
    groups.set(g, [...(groups.get(g) || []), sl.id]);
  }
  return [...groups].map(([g, ids]) => `${g}: ${ids.length > 4 ? `${ids[0]} to ${ids.at(-1)} (${ids.length})` : ids.join(', ')}`).join('; ') || 'no bays or cages';
}
const firstEight = refs => (refs.length > 8 ? `${refs.slice(0, 8).join(', ')} and ${refs.length - 8} more` : refs.join(', ') || 'nothing');

// The ports a part in a bay has, by their ids on it: its cages, the parts it
// composes and its own bays.
const portIds = comp => new Set([...(Array.isArray(comp?.cages) ? comp.cages : []).map(g => g.id),
  ...(comp?.parts || []).map(q => q.id), ...Object.keys(comp?.bays || {})]);

function fit(rack, {id, path, ref}, ctx) {
  const it = itemOf(rack, id);
  if (!it) return {error: GONE};
  const was = it.swaps || {};
  // a different part in a carrier is a fresh seat: what was in it goes
  // (swap.js pruneCarrier, #484 R5), its fields with it
  const next = Object.fromEntries(Object.entries(was).filter(([k]) => k === path || !underCarrier(k, path)));
  if (ref === 'default') delete next[path]; else next[path] = ref;
  if (same(next, was)) return unchanged(rack);
  const s = slotsFor(ctx, it.ref);
  if (s?.error) return s;
  let holds = ref === 'default' ? undefined : ref, isCage = false, view = null;
  if (s) {
    const env = slotEnv(it, s, ctx.compByRef);
    const R = resolverFor(env, next);
    const target = R.entryAt(path);
    if (!target) return {error: `${path} is not a bay or cage on ${it.label}. It has: ${slotList(env, R, path)}.`};
    isCage = !!target.isCage;
    view = target.view ?? null;
    if (ref && ref !== 'default' && !(target.accepts || []).includes(ref))
      return {error: `${path} does not take ${ref}. It takes: ${firstEight(target.accepts || [])}.`};
    if (ref && ref !== 'default' && acceptSwaps(next, env).ignored.includes(path))
      return {error: `${path} cannot take ${ref} while the slot it shares a seat with holds something.`};
    holds = holdsAt(env, next, path, target);
  }
  const fields = Object.fromEntries(Object.entries(it.fields || {})
    .filter(([k]) => k !== `${path}/module` && !underCarrier(k, path)));
  const name = holds === undefined ? null : partName(ctx.compByRef, holds);
  const findings = [];
  // A BAY'S PORTS GO WITH ITS PART: a cable on a port the new part does not
  // have is kept, as a loose end (remove's cables: 'keep').
  if (!isCage && holds !== undefined) {
    const comp = partOf(ctx.compByRef, holds);
    const known = holds === null || comp;
    const ports = portIds(comp), under = `${path}/module/`;
    const cut = known ? (rack.cables || []).flatMap(c => [c.a, c.b].filter(e => e.item === id && e.path.startsWith(under)
      && !ports.has(e.path.slice(under.length).split('/')[0])).map(e => ({c, e}))) : [];
    if (cut.length) {
      const paths = [...new Set(cut.map(x => x.e.path))], ids = [...new Set(cut.map(x => x.c.id))];
      findings.push(note(`Kept the cables on ${paths.join(', ')} as loose ends (${ids.join(', ')}): ${holds ? `${paths.length === 1 ? 'this port is' : 'these ports are'} not on ${name}` : `${path} is empty`}.`));
    }
  }
  // A CAGE'S NEW PART, against the media of the cables on its port.
  if (isCage && holds) {
    const comp = partOf(ctx.compByRef, holds);
    const conn = comp ? connectorOf({attrs: comp.attrs || {}}) : null;
    for (const c of (rack.cables || [])) {
      if (!conn?.family || ![c.a, c.b].some(e => e.item === id && portPathOf(e.path) === path && (view == null || e.view === view))) continue;
      const m = mediaKind(c.media);
      if ((m.family && m.family !== conn.family) || (m.family === 'fiber' && m.mode && conn.mode && m.mode !== conn.mode))
        findings.push(note(`${c.id} now runs ${MEDIA_LABELS[c.media] ?? c.media} into ${name}.`));
    }
  }
  const summary = holds === undefined ? `Put ${path} on ${it.label} back as its configuration builds it.`
    : holds ? `Fitted ${name} in ${path} on ${it.label}.` : `Emptied ${path} on ${it.label}.`;
  return {rack: updateItem(rack, id, {swaps: next, fields}), summary, findings};
}

```

In `COMMANDS`, insert before `'cable.add':`:

```js
  fit: {run: fit, description: 'Seat one part in one bay or cage of a placed device, empty it, or put back what its configuration builds there. Only that slot changes; a part taken out takes what was seated in it, and its settings, with it. Refused, with what the slot takes, when the part does not fit there.',
    args: args(['id', 'path', 'ref'], {id: ID('device'),
      path: {type: 'string', minLength: 1, description: 'The bay or cage, as inspecting the device lists it (e.g. port-1, bay-2/module/lc1).'},
      ref: {type: ['string', 'null'], minLength: 1, description: 'The part to seat, as the slot lists it; null to empty the slot; "default" for what the configuration builds.'}})},
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd spec/tests/js && node --test rack-fit-command.mjs rack-commands.mjs rack-commands-table.mjs rack-apply.mjs`
Expected: PASS (12 tests in `rack-fit-command.mjs`; the table test confirms the new descriptions are within bounds).

- [ ] **Step 5: Check spelling and syntax, then commit**

```bash
python3 spec/tools/portrayal/comment_spelling.py kit/rack && (cd kit && npm test)
git add kit/rack/commands.js spec/tests/js/rack-fit-command.mjs
git commit -m "rack: fit seats, empties or restores one bay or cage, checked against the parts list

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The `field` command

**Files:**
- Modify: `kit/rack/commands.js` (import; `field` after `fit`; one `COMMANDS` entry)
- Create: `spec/tests/js/rack-field-command.mjs`

**Interfaces:**
- Consumes:
  - From Task 6: `own`, and the `slots.js` imports.
  - From `kit/fields.js`: `fieldAccepts`.
- Produces: `COMMANDS.field`, with `{id, path, key, value}`. `path` is a part path (`<bay>/module`, `<cage>-occupant`). `value` is a string or number, stored as a string, or `null` to reset.

- [ ] **Step 1: Write the failing tests**

Create `spec/tests/js/rack-field-command.mjs`:

```js
// spec/tests/js/rack-field-command.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../../../kit/rack/model.js';
import {COMMANDS, GONE} from '../../../kit/rack/commands.js';
import {ctx, chassisOf} from './slot-fixtures.mjs';

const run = (rack, args, c = ctx) => COMMANDS.field.run(rack, args, c);
const PP = M.withItem(M.newRack(), {ref: 'pp', cfg: 'loaded', ru: 5, label: 'pp-1', fields: {'bay-1/module': {other: 'x'}}}).rack;

test('field: set one key, merged into the part\'s own; set it again; reset it', () => {
  const a = run(PP, {id: 'i1', path: 'bay-1/module', key: 'latch-color', value: 'green'});
  assert.deepEqual(a.rack.items[0].fields, {'bay-1/module': {other: 'x', 'latch-color': 'green'}});
  assert.equal(a.summary, 'Set latch-color on bay-1/module of pp-1 to green.');
  assert.equal(run(a.rack, {id: 'i1', path: 'bay-1/module', key: 'latch-color', value: 'green'}).rack, a.rack);
  const b = run(a.rack, {id: 'i1', path: 'bay-1/module', key: 'latch-color', value: null});
  assert.deepEqual(b.rack.items[0].fields, {'bay-1/module': {other: 'x'}});
  assert.equal(b.summary, 'Reset latch-color on bay-1/module of pp-1.');
  assert.deepEqual(run(PP, {id: 'i9', path: 'bay-1/module', key: 'latch-color', value: 'green'}), {error: GONE});
});

test('field: a part with no such key lists its keys; a value it refuses lists its choices', () => {
  assert.deepEqual(run(PP, {id: 'i1', path: 'bay-1/module', key: 'colour', value: 'green'}),
    {error: 'LC cassette has no field colour. Its fields: latch-color.'});
  assert.deepEqual(run(PP, {id: 'i1', path: 'bay-1/module', key: 'latch-color', value: 'red'}),
    {error: 'latch-color on LC cassette takes one of: blue, green, beige.'});
  assert.deepEqual(run(PP, {id: 'i1', path: 'bay-2/module', key: 'latch-color', value: 'blue'}),
    {error: 'Blank plate has no field latch-color. Its fields: none.'});
});

test('field: a slot path is answered with the part path, and an empty slot says so', () => {
  assert.deepEqual(run(PP, {id: 'i1', path: 'bay-1', key: 'latch-color', value: 'green'}),
    {error: 'bay-1 is a bay; the part in it is bay-1/module.'});
  const leaf = M.withItem(M.newRack(), {ref: 'leaf', cfg: 'base', ru: 5, label: 'leaf-1'}).rack;
  assert.deepEqual(run(leaf, {id: 'i1', path: 'port-2-occupant', key: 'label', value: 'x'}),
    {error: 'Nothing is seated at port-2-occupant on leaf-1.'});
  assert.equal(run(leaf, {id: 'i1', path: 'port-1-occupant', key: 'label', value: 'uplink 1'}).rack.items[0].fields['port-1-occupant'].label, 'uplink 1');
});

test('field: without the parts it merges and checks nothing', () => {
  const a = run(PP, {id: 'i1', path: 'bay-1/module', key: 'anything', value: 7}, {chassisOf});
  assert.deepEqual(a.rack.items[0].fields['bay-1/module'], {other: 'x', anything: '7'});
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd spec/tests/js && node --test rack-field-command.mjs`
Expected: FAIL: `Cannot read properties of undefined (reading 'run')`.

- [ ] **Step 3: Write `field`**

In `kit/rack/commands.js`, add after the `swap.js` import:

```js
import {fieldAccepts} from '../fields.js';
```

Insert immediately above `// ── the rack ────...` (after `fit`):

```js
// ONE FIELD of the part drawn at `path` - its part path, `<bay>/module` or
// `<cage>-occupant`, the key item.fields uses and inspect lists. Merged: the
// part's other fields, and every other part's, stay as they are.
function field(rack, {id, path, key, value}, ctx) {
  const it = itemOf(rack, id);
  if (!it) return {error: GONE};
  const s = slotsFor(ctx, it.ref);
  if (s?.error) return s;
  if (s && typeof ctx.compByRef === 'function') {
    const env = slotEnv(it, s, ctx.compByRef);
    const R = resolverFor(env, it.swaps || {});
    const slot = R.entryAt(path);
    if (slot) return {error: `${path} is a ${slot.isCage ? 'cage' : 'bay'}; the part in it is ${path}${slot.isCage ? '-occupant' : '/module'}.`};
    const ref = R.refAt(path);
    if (!ref) return {error: `Nothing is seated at ${path} on ${it.label}.`};
    const name = partName(ctx.compByRef, ref);
    const decl = partOf(ctx.compByRef, ref)?.fields || {};
    if (!own(decl, key)) return {error: `${name} has no field ${key}. Its fields: ${Object.keys(decl).join(', ') || 'none'}.`};
    if (value != null && !fieldAccepts(decl[key], value)) {
      const f = decl[key];
      return {error: f.type === 'choice' && Array.isArray(f.options) ? `${key} on ${name} takes one of: ${f.options.join(', ')}.`
        : f.type === 'number' ? `${key} on ${name} takes a number.` : `${key} on ${name} does not take ${JSON.stringify(String(value))}.`};
    }
  }
  const fields = structuredClone(it.fields || {});
  const part = {...(own(fields, path) ? fields[path] : {})};
  if (value == null) delete part[key]; else part[key] = String(value);
  if (Object.keys(part).length) fields[path] = part; else delete fields[path];
  if (same(fields, it.fields || {})) return unchanged(rack);
  return done(updateItem(rack, id, {fields}),
    value == null ? `Reset ${key} on ${path} of ${it.label}.` : `Set ${key} on ${path} of ${it.label} to ${value}.`);
}

```

In `COMMANDS`, insert after the `fit` entry:

```js
  field: {run: field, description: "Set one setting of one part seated in a placed device, such as a cassette's latch colour or an optic's label; null puts it back to the part's default. Its other settings stay. Refused, with the part's settings or choices, when the part has no such setting or does not take the value.",
    args: args(['id', 'path', 'key', 'value'], {id: ID('device'),
      path: {type: 'string', minLength: 1, description: 'The part, as inspecting the device lists its fields (e.g. bay-1/module, port-1-occupant).'},
      key: {type: 'string', minLength: 1, description: "The setting, as the part's fields list it (e.g. latch-color)."},
      value: {type: ['string', 'number', 'null'], description: 'The new value; null for the default.'}})},
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd spec/tests/js && node --test rack-field-command.mjs rack-fit-command.mjs rack-commands-table.mjs`
Expected: PASS (4 tests in `rack-field-command.mjs`).

- [ ] **Step 5: Check spelling and syntax, then commit**

```bash
python3 spec/tools/portrayal/comment_spelling.py kit/rack && (cd kit && npm test)
git add kit/rack/commands.js spec/tests/js/rack-field-command.mjs
git commit -m "rack: field sets one setting of one seated part, checked against what the part declares

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: `cable.update` moves an end

**Files:**
- Modify: `kit/rack/commands.js` (import; replace `cableUpdate`; the `'cable.update'` entry)
- Create: `spec/tests/js/rack-cable-repoint.mjs`

**Interfaces:**
- Consumes: from `cable-rules.js`, `canCable(rack, a, b, {ignoreId, uOf})`, `endName`, `endKey`, `updateCable`. From `fit.js`, `heightOf`.
- Produces:
  - `COMMANDS['cable.update']` takes optional `a` and `b` (`{item, path, view}`).
  - The summary is `Moved end A of cable <name> to <end name>.` when an end moved.
  - A note `<id>'s route was drawn for its old end.` when the route was edited by hand.

- [ ] **Step 1: Write the failing tests**

Create `spec/tests/js/rack-cable-repoint.mjs`:

```js
// spec/tests/js/rack-cable-repoint.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../../../kit/rack/model.js';
import {COMMANDS, GONE, CABLE_GONE, apply} from '../../../kit/rack/commands.js';
import {chassisOf} from './slot-fixtures.mjs';

const ctx = {chassisOf};
const run = (rack, args) => COMMANDS['cable.update'].run(rack, args, ctx);
const end = (item, path = 'port-1', view = 'front') => ({item, path, view});
let R = M.newRack();
for (const [ru, label] of [[10, 'leaf-1'], [20, 'leaf-2']]) R = M.withItem(R, {ref: 'leaf', cfg: 'base', ru, label}).rack;
const LEN = {value: 3, unit: 'm', source: 'entered'};
R = {...R, cables: [{id: 'c1', a: end('i1'), b: end('i2'), media: 'om4', purpose: 'uplink', label: 'A1', length: LEN, route: []},
                    {id: 'c2', a: end('i1', 'port-2'), b: end('i2', 'port-2'), media: '', purpose: '', label: '', route: []}]};

test('cable.update {a}: re-points the end and keeps everything else', () => {
  const u = run(R, {id: 'c1', a: end('i1', 'bay-1/module/lc3')});
  assert.deepEqual(u.rack.cables[0], {id: 'c1', a: end('i1', 'bay-1/module/lc3'), b: end('i2'), media: 'om4', purpose: 'uplink',
    label: 'A1', length: LEN, route: []});
  assert.equal(u.summary, 'Moved end A of cable A1 to leaf-1 (U10) bay-1/module/lc3.');
  assert.deepEqual(u.findings, []);
});

test('cable.update {b}: a port with another cable is refused with its sentence; its own port is not', () => {
  assert.deepEqual(run(R, {id: 'c1', b: end('i2', 'port-2')}), {error: 'leaf-2 (U20) port-2 already has a cable (c2).'});
  assert.equal(run(R, {id: 'c1', b: end('i2')}).rack, R);
  assert.deepEqual(run(R, {id: 'c1', b: end('i1')}), {error: 'A cable needs two different ports.'});
  assert.deepEqual(run(R, {id: 'c1', b: end('i9')}), {error: GONE});
  assert.deepEqual(run(R, {id: 'c9', b: end('i2', 'port-5')}), {error: CABLE_GONE});
});

test('cable.update: a hand-made route is kept and noted', () => {
  const routed = {...R, cables: R.cables.map(c => (c.id === 'c1' ? {...c, route: [{lane: 'left-front', ru: 15}], routeEdited: true} : c))};
  const u = run(routed, {id: 'c1', b: end('i2', 'port-7'), label: 'A2'});
  assert.deepEqual(u.rack.cables[0].route, [{lane: 'left-front', ru: 15}]);
  assert.equal(u.rack.cables[0].label, 'A2');
  assert.deepEqual(u.findings, [{kind: 'note', text: "c1's route was drawn for its old end."}]);
});

test('cable.update: an end named by @name from earlier in the batch', () => {
  const r = apply(R, [{op: 'place', ref: 'leaf', face: 'front', ru: 30, as: 'new'},
                      {op: 'cable.update', id: 'c1', b: {item: '@new', path: 'port-1', view: 'front'}}], ctx);
  assert.deepEqual(r.rack.cables[0].b, end('i3'));
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd spec/tests/js && node --test rack-cable-repoint.mjs`
Expected: FAIL. Today's `cableUpdate` stores `a` as a plain field, with no check, and says `Edited cable A1.`; the taken port is not refused; and `apply` refuses `cable.update does not take b.`

- [ ] **Step 3: Write the re-pointing**

In `kit/rack/commands.js`, replace the `cable-rules.js` import with

```js
import {canCable, withCable, updateCable, withoutCable, cablesOf, withoutCablesOf, cableName, endName, endKey,
        connectorOf, mediaKind, portPathOf, MEDIA, MEDIA_LABELS} from './cable-rules.js';
```

Replace the whole `function cableUpdate(rack, {id, ...p}) { ... }` with:

```js
// RE-POINTING AN END (`a`, `b`) keeps the cable - its id, media, purpose,
// label and length - and checks the new port as cable.add would, with the
// cable itself out of the way. A route drawn by hand is kept, and said to be
// possibly stale.
const endOf = e => ({item: e.item, path: e.path, view: e.view === 'rear' ? 'rear' : 'front'});
function cableUpdate(rack, {id, a, b, ...p}, {chassisOf}) {
  const c = cableOf(rack, id);
  if (!c) return {error: CABLE_GONE};
  const ends = {a: a ? endOf(a) : c.a, b: b ? endOf(b) : c.b};
  const moved = ['a', 'b'].filter(k => endKey(ends[k]) !== endKey(c[k]));
  if (moved.some(k => !itemOf(rack, ends[k].item))) return {error: GONE};
  const uOf = heightOf(chassisOf);
  if (moved.length) {
    const can = canCable(rack, ends.a, ends.b, {ignoreId: id, uOf});
    if (!can.ok) return {error: can.reason};
  }
  const want = 'length' in p ? {...p, length: lengthOf(p.length)} : p;
  // A length named at all replaces one the loader kept as written.
  const changed = Object.keys(want).filter(k => !same(want[k], c[k] ?? null) || (k === 'length' && 'lengthAsWritten' in c));
  if (!changed.length && !moved.length) return unchanged(rack);
  const next = updateCable(rack, id, {...want, ...Object.fromEntries(moved.map(k => [k, ends[k]]))});
  const name = cableName(cableOf(next, id));
  const said = moved.map(k => `Moved end ${k.toUpperCase()} of cable ${name} to ${endName(next, ends[k], uOf)}.`);
  return {rack: next, summary: said.length ? said.join(' ') : `Edited cable ${name}.`,
          findings: moved.length && c.routeEdited === true ? [note(`${c.id}'s route was drawn for its old end.`)] : []};
}
```

Replace the `'cable.update'` entry in `COMMANDS` with:

```js
  'cable.update': {run: cableUpdate, description: "Change a cable's type, purpose, label or length, or move either end to another port. A moved end keeps the cable's id and everything else about it; refused when the new port already has a cable.",
    args: args(['id'], {id: ID('cable'), a: {...END, description: 'Move end A to this port; left where it is when left out.'},
      b: {...END, description: 'Move end B to this port; left where it is when left out.'}, ...CABLE_FIELDS})},
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd spec/tests/js && node --test rack-cable-repoint.mjs rack-commands.mjs rack-cables.mjs rack-apply.mjs rack-commands-table.mjs`
Expected: PASS (4 tests in `rack-cable-repoint.mjs`; the existing `cable.update` tests unchanged).

- [ ] **Step 5: Check spelling and syntax, then commit**

```bash
python3 spec/tools/portrayal/comment_spelling.py kit/rack && (cd kit && npm test)
git add kit/rack/commands.js spec/tests/js/rack-cable-repoint.mjs
git commit -m "rack: cable.update moves an end and keeps the cable, its id and its length

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: `place` and `patch` check what they can; `patch {cfg}` clears

**Files:**
- Modify: `kit/rack/commands.js` (`place`, `patch`, and the new `cfgRefused` above `place`)
- Create: `spec/tests/js/rack-cfg-checks.mjs`

**Interfaces:**
- Consumes: `slotsFor`, `slotEnv` (Task 3) and `acceptSwaps` (Task 6).
- Produces:
  - `place` and `patch` receive the whole `ctx`.
  - With `ctx.slotsOf`, a `cfg` the device does not list is refused with `<label> has no configuration <cfg>. It has: <names>.` `place` names the device by its model.
  - `patch {swaps}` stores only what `acceptSwaps` accepts, and adds the note `Left out <keys>: not a slot on <label>, or a part that slot does not take.`
  - `patch` with a changed `cfg` and no `swaps` or `fields` sets both to `{}`, and returns `CLEARED` when there were any.

- [ ] **Step 1: Write the failing tests**

Create `spec/tests/js/rack-cfg-checks.mjs`:

```js
// spec/tests/js/rack-cfg-checks.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../../../kit/rack/model.js';
import {COMMANDS, CLEARED} from '../../../kit/rack/commands.js';
import {ctx, chassisOf} from './slot-fixtures.mjs';

const run = (op, rack, args, c = ctx) => COMMANDS[op].run(rack, args, c);
const LEAF = M.withItem(M.newRack(), {ref: 'leaf', cfg: 'base', ru: 10, label: 'leaf-1',
  swaps: {'port-2': 'acme/lr@1'}, fields: {'port-2-occupant': {label: 'x'}}}).rack;

test('place: a configuration the device does not list is refused when the slots are loaded', () => {
  assert.deepEqual(run('place', M.newRack(), {ref: 'leaf', cfg: 'ac', face: 'front', ru: 5}),
    {error: 'Leaf-48 has no configuration ac. It has: base, dc.'});
  assert.equal(run('place', M.newRack(), {ref: 'leaf', cfg: 'dc', face: 'front', ru: 5}).rack.items[0].cfg, 'dc');
  assert.equal(run('place', M.newRack(), {ref: 'leaf', cfg: 'ac', face: 'front', ru: 5}, {chassisOf}).rack.items[0].cfg, 'ac');
  assert.deepEqual(run('place', M.newRack(), {ref: 'leaf', cfg: 'dc', face: 'front', ru: 5}, {...ctx, slotsOf: () => null}),
    {error: 'The parts list for leaf could not be loaded.'});
  assert.equal(run('place', M.newRack(), {ref: 'leaf', face: 'front', ru: 5}, {...ctx, slotsOf: () => null}).rack.items[0].cfg, 'base');
});

test('patch {cfg}: a configuration the device does not list is refused when the slots are loaded', () => {
  assert.deepEqual(run('patch', LEAF, {id: 'i1', cfg: 'ac'}), {error: 'leaf-1 has no configuration ac. It has: base, dc.'});
});

test('patch {cfg} alone clears the swaps and fields, and says so', () => {
  const p = run('patch', LEAF, {id: 'i1', cfg: 'dc'}, {chassisOf});
  assert.deepEqual([p.rack.items[0].cfg, p.rack.items[0].swaps, p.rack.items[0].fields], ['dc', {}, {}]);
  assert.deepEqual(p.findings, [{kind: 'note', text: CLEARED}]);
  const kept = run('patch', LEAF, {id: 'i1', cfg: 'dc', swaps: {'port-1': null}}, {chassisOf});
  assert.deepEqual([kept.rack.items[0].swaps, kept.rack.items[0].fields], [{'port-1': null}, {}]);
  assert.equal(run('patch', LEAF, {id: 'i1', cfg: 'base'}, {chassisOf}).rack, LEAF);
});

test('patch {swaps} still replaces the map, but leaves out what the slots refuse', () => {
  const p = run('patch', LEAF, {id: 'i1', swaps: {'port-1': 'acme/dac@1', 'port-48': 'x', 'port-2': 'acme/psu-ac@1'}});
  assert.deepEqual(p.rack.items[0].swaps, {'port-1': 'acme/dac@1'});
  assert.deepEqual(p.findings, [{kind: 'note', text: 'Left out port-2, port-48: not a slot on leaf-1, or a part that slot does not take.'}]);
  const raw = run('patch', LEAF, {id: 'i1', swaps: {'port-48': 'x'}}, {chassisOf});
  assert.deepEqual(raw.rack.items[0].swaps, {'port-48': 'x'});
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd spec/tests/js && node --test rack-cfg-checks.mjs`
Expected: FAIL. The unknown `cfg` is placed, `patch {cfg: 'dc'}` keeps the swaps, and the refused swaps are stored.

- [ ] **Step 3: Write the checks**

In `kit/rack/commands.js`, replace from `function place(rack, {ref, cfg, face, ru, label}, {chassisOf}) {` through its line `const c = chassisOf(ref);` with:

```js
// A CONFIGURATION THE DEVICE DOES NOT LIST is refused when its slots are
// loaded (`loadSlots` in `catalog.js`), naming the ones it does list.
function cfgRefused(ctx, ref, cfg, label) {
  const s = slotsFor(ctx, ref);
  if (!s) return null;
  if (s.error) return s;
  const names = (s.configs || []).map(k => k.name);
  return names.includes(cfg) ? null : {error: `${label} has no configuration ${cfg}. It has: ${names.join(', ') || 'none'}.`};
}

function place(rack, {ref, cfg, face, ru, label}, ctx) {
  const {chassisOf} = ctx;
  const top = pastTop(rack, ru);
  if (top) return top;
  const c = chassisOf(ref);
  if (cfg != null) { const bad = cfgRefused(ctx, ref, cfg, c?.model ?? ref); if (bad) return bad; }
```

The rest of `place` (from `const spot = isRackFace(c) ...`) is unchanged.

Replace the whole of `patch`, from its comment `// A configuration change is a delta ...` to its closing brace, with:

```js
// A configuration change is a delta against the OLD configuration: one that
// leaves an item with no swaps or fields to carry forward says they went.
// A NEW CONFIGURATION ALONE starts the device afresh: its swaps and fields
// were for the old one, so they go, as the site's inspector already clears
// them. Swaps or fields sent with it are kept as sent.
function patch(rack, {id, ...given}, ctx) {
  const it = itemOf(rack, id);
  if (!it) return {error: GONE};
  const newCfg = 'cfg' in given && given.cfg !== it.cfg;
  if (newCfg) { const bad = cfgRefused(ctx, it.ref, given.cfg, it.label); if (bad) return bad; }
  // The rack keeps its own copy, as withItem does: a caller that goes on to
  // change the object it passed changes neither the rack nor its history.
  const p = {...given, ...('swaps' in given ? {swaps: {...given.swaps}} : newCfg ? {swaps: {}} : {}),
             ...('fields' in given ? {fields: structuredClone(given.fields)} : newCfg ? {fields: {}} : {})};
  // A WHOLE SWAPS MAP still replaces the item's, but with the slots loaded a
  // ref a slot does not take, or a key that is no slot, is left out and named.
  const findings = [];
  if ('swaps' in given) {
    const s = slotsFor(ctx, it.ref);
    if (s?.error) return s;
    if (s) {
      const {accepted, ignored} = acceptSwaps(p.swaps, slotEnv({...it, cfg: p.cfg ?? it.cfg}, s, ctx.compByRef));
      p.swaps = accepted;
      if (ignored.length) findings.push(note(`Left out ${ignored.join(', ')}: not a slot on ${it.label}, or a part that slot does not take.`));
    }
  }
  const changes = Object.fromEntries(['cfg', 'swaps', 'fields', 'label', 'turned']
    .filter(k => k in p && !same(p[k], it[k])).map(k => [k, p[k]]));
  if (!Object.keys(changes).length) return findings.length ? {...unchanged(rack), findings} : unchanged(rack);
  const next = {...it, ...changes};
  const had = Object.keys(it.swaps ?? {}).length || Object.keys(it.fields ?? {}).length;
  const has = Object.keys(next.swaps ?? {}).length || Object.keys(next.fields ?? {}).length;
  return {rack: updateItem(rack, id, changes), summary: `Changed ${it.label}.`,
          findings: [...('cfg' in changes && had && !has ? [note(CLEARED)] : []), ...findings]};
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd spec/tests/js && node --test rack-cfg-checks.mjs rack-commands.mjs rack-apply.mjs rack-editor.mjs rack-readme-example.mjs`
Expected: PASS (4 tests in `rack-cfg-checks.mjs`). The existing `patch: changes what it names; clears-changes note` test still passes: it sends `swaps: {}` and `fields: {}` with `cfg`.

- [ ] **Step 5: Check spelling and syntax, then commit**

```bash
python3 spec/tools/portrayal/comment_spelling.py kit/rack && (cd kit && npm test)
git add kit/rack/commands.js spec/tests/js/rack-cfg-checks.mjs
git commit -m "rack: place and patch refuse an unknown configuration, patch {swaps} leaves out what a slot refuses, patch {cfg} clears

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9b: `cable.route` checks its waypoints, and `inspect` gives a cable's slack

Added 2026-10-08 after Jason's routing run, by controller ruling K6. That run showed:
- `cable.route` accepts made-up names (`{item:'i4', via:'?'}`, `{lane:'?', ru:9}`) without an error;
- the agent cannot tell whether a cable's length leaves slack.

`rack.json` already lists every device's rings, ducts and pass-throughs (`guides` and `passes` per view), so the check is pure.

**Files:**
- Modify: `kit/rack/route.js` (export `pathwaysOf`)
- Modify: `kit/rack/queries.js` (use `pathwaysOf`; add `slack`)
- Modify: `kit/rack/commands.js` (`cableRoute` checks waypoints when `ctx.chassisOf` is given)
- Test: `spec/tests/js/rack-route-check.mjs` (new)

**Interfaces:**
- Produces:
  - `pathwaysOf(chassis) -> string[]`: sorted, unique ids from `chassis.guides` and `chassis.passes` across all views, or `[]`.
  - `cable.route` refusals:
    - `"Waypoint <n> names <id>, which is not in the rack."`
    - `"Waypoint <n>: <label> has no ring, duct or pass-through called <via>. It has: <ids>."`
    - `"Waypoint <n>: <label> has no rings, ducts or pass-throughs."`
    - `"Waypoint <n>: there is no gutter called <lane>. This rack has: <lanes>."`
    - `"Waypoint <n>: U<ru> is not on this <h>U rack."`
  - `inspect` of a cable gains `slack: {metres} | null`. This is the cable's own length in metres (ft × 0.3048) minus the routed metres, rounded to 0.01. It is null when either is unknown, or when the length is itself the routed one (`source: 'routed'`).

- [ ] **Step 1: Write the failing tests**

```js
// spec/tests/js/rack-route-check.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../../../kit/rack/model.js';
import {COMMANDS} from '../../../kit/rack/commands.js';
import {pathwaysOf} from '../../../kit/rack/route.js';
import {inspect} from '../../../kit/rack/queries.js';
import {chassisOf} from './slot-fixtures.mjs';

const add = (rack, ref, ru, label) => M.withItem(rack, {ref, cfg: 'base', ru, label}).rack;
const end = (item, path = 'port-1') => ({item, path, view: 'front'});
const rackWith = () => {
  let r = add(add(add(M.newRack(), 'leaf', 20, 'leaf-1'), 'mgr', 19, 'cm-1'), 'leaf', 10, 'leaf-2');
  return {...r, cables: [{id: 'c1', a: end('i1'), b: end('i3'), media: 'om4', purpose: '', label: '', route: []}]};
};
const route = (rack, waypoints, ctx = {chassisOf}) => COMMANDS['cable.route'].run(rack, {id: 'c1', route: waypoints}, ctx);

test('pathwaysOf lists guides and passes across views, sorted and unique', () => {
  assert.deepEqual(pathwaysOf(chassisOf('mgr')), ['guide-1', 'guide-2', 'window-1']);
  assert.deepEqual(pathwaysOf(null), []);
});

test('cable.route accepts real pathways and gutters', () => {
  const r = rackWith();
  const s = route(r, [{item: 'i2', via: 'guide-2'}, {lane: 'left-front', ru: 15}]);
  assert.equal(s.error, undefined);
  assert.deepEqual(s.rack.cables[0].route, [{item: 'i2', via: 'guide-2'}, {lane: 'left-front', ru: 15}]);
});

test('cable.route refuses made-up names and says what exists', () => {
  const r = rackWith();
  assert.deepEqual(route(r, [{item: 'i2', via: '?'}]),
    {error: 'Waypoint 1: cm-1 has no ring, duct or pass-through called ?. It has: guide-1, guide-2, window-1.'});
  assert.deepEqual(route(r, [{item: 'i9', via: 'guide-1'}]), {error: 'Waypoint 1 names i9, which is not in the rack.'});
  assert.match(route(r, [{lane: 'left-front', ru: 3}, {lane: '?', ru: 9}]).error,
    /^Waypoint 2: there is no gutter called \?\. This rack has: left-front, right-front, left-rear, right-rear\.$/);
  assert.deepEqual(route(r, [{lane: 'left-front', ru: 99}]), {error: 'Waypoint 1: U99 is not on this 42U rack.'});
});

test('cable.route refuses a pathway on a device with none, and checks nothing without a catalogue', () => {
  const r = rackWith();
  const noGuides = ref => ({...chassisOf(ref), guides: undefined, passes: undefined});
  assert.deepEqual(route(r, [{item: 'i2', via: 'guide-1'}], {chassisOf: noGuides}),
    {error: 'Waypoint 1: cm-1 has no rings, ducts or pass-throughs.'});
  assert.equal(route(r, [{item: 'i2', via: 'anything'}], {}).error, undefined);
});

test('inspect gives a cable its slack: its own length less the routed length', async () => {
  const r = {...rackWith(), cables: [{...rackWith().cables[0], length: {value: 1, unit: 'm', source: 'entered'}}]};
  const ctx = {chassisOf, route: {measure: () => 0.62}};
  const routedOnly = {...r, cables: [{...r.cables[0], length: {value: 1, unit: 'm', source: 'routed'}}]};
  const feet = {...r, cables: [{...r.cables[0], length: {value: 3, unit: 'ft', source: 'entered'}}]};
  const withRoute = async rack => (await inspect(rack, 'c1', {...ctx, route: ROUTE_CTX})).slack;
  assert.deepEqual(await withRoute(r), {metres: 0.38});
  assert.equal(await withRoute(routedOnly), null);
  assert.deepEqual(await withRoute(feet), {metres: 0.29});
  assert.equal((await inspect(r, 'c1', {chassisOf})).slack, null);
});
```

The slack test needs a route context that `routedLength` accepts and that measures exactly 0.62 m. Before running, read how Task 4's cable test in `spec/tests/js/rack-inspect.mjs` builds its `ctx.route` (it pins a rounded routed length). Define `ROUTE_CTX` at the top of this file the same way, scaled or stubbed so that `routedLength(...).measured` is 0.62. If `routedLength` cannot be stubbed to an exact figure, take the measured value Task 4's fixture produces and compute the expected slack from it: `1 - measured` and `3 * 0.3048 - measured`, each rounded to 0.01. Drop the placeholder `ctx.route` line above.

- [ ] **Step 2: Run them and see them fail**

Run: `node --test spec/tests/js/rack-route-check.mjs`
Expected: FAIL, `pathwaysOf` is not exported.

- [ ] **Step 3: Implement**

In `kit/rack/route.js`, add after `lanesOf`:

```js
// The rings, ducts and pass-throughs a device offers a route, as rack.json lists
// them per view: one sorted list of ids, whatever the view.
export const pathwaysOf = chassis =>
  [...new Set(['guides', 'passes'].flatMap(k => Object.values(chassis?.[k] || {}).flat()))].sort();
```

In `kit/rack/queries.js`:
- import `pathwaysOf` from `./route.js`;
- replace the local `const pathwayIds = c => …` with `const pathwayIds = pathwaysOf;`, or rename its uses;
- in `cableInfo`, after `routed` is known, add:

```js
  const own = l && l.source !== 'routed' && typeof l.value === 'number'
    ? l.value * ((l.unit ?? 'm') === 'ft' ? 0.3048 : 1) : null;
  const slack = own != null && routed ? {metres: Math.round((own - routed.metres) * 100) / 100} : null;
```

and include `slack` in the returned cable object, after `routed`.

In `kit/rack/commands.js`:
- import `pathwaysOf` and `lanesOf` from `./route.js`, if they're not already imported;
- add, above `cableRoute`:

```js
// A waypoint must name something the rack has. Checked only when the catalogue
// is given; without it, a route is stored as written, as before.
function waypointError(rack, route, {chassisOf} = {}) {
  if (typeof chassisOf !== 'function') return null;
  const lanes = lanesOf(rack.frame);
  for (const [k, w] of route.entries()) {
    const n = k + 1;
    if ('lane' in w) {
      if (!lanes.includes(w.lane)) return `Waypoint ${n}: there is no gutter called ${w.lane}. This rack has: ${lanes.join(', ')}.`;
      if (!Number.isInteger(w.ru) || w.ru < 1 || w.ru > rack.frame.heightRU) return `Waypoint ${n}: U${w.ru} is not on this ${rack.frame.heightRU}U rack.`;
      continue;
    }
    const it = rack.items.find(i => i.id === w.item);
    if (!it) return `Waypoint ${n} names ${w.item}, which is not in the rack.`;
    const ch = chassisOf(it.ref);
    if (!ch) continue;
    const ids = pathwaysOf(ch);
    if (!ids.length) return `Waypoint ${n}: ${it.label} has no rings, ducts or pass-throughs.`;
    if (!ids.includes(w.via)) return `Waypoint ${n}: ${it.label} has no ring, duct or pass-through called ${w.via}. It has: ${ids.join(', ')}.`;
  }
  return null;
}
```

Then change `cableRoute`:
- its signature becomes `function cableRoute(rack, {id, route, summary}, ctx)`;
- after the `isWaypoint` check, add:

```js
  const wrong = waypointError(rack, route, ctx);
  if (wrong) return {error: wrong};
```

- [ ] **Step 4: Run the tests and see them pass**

Run:
```bash
node --test spec/tests/js/rack-route-check.mjs spec/tests/js/rack-commands.mjs spec/tests/js/rack-inspect.mjs spec/tests/js/rack-route.mjs
PYTHONPATH=spec/tools:spec/tests python3 -m pytest -q spec/tests/test_rack_kit_js.py
python3 spec/tools/portrayal/comment_spelling.py kit/rack
```

Expected: all pass. The existing `cable.route and cable.route.reset` test in rack-commands.mjs routes only through a gutter, so it is unaffected. If an existing test routes through `{item, via}` with a `chassisOf` that has no guides, give that fixture the guide it names. Don't loosen the check.

- [ ] **Step 5: Commit**

```bash
git add kit/rack/route.js kit/rack/queries.js kit/rack/commands.js spec/tests/js/rack-route-check.mjs
git commit -m "rack: cable.route refuses a waypoint the rack lacks, and inspect gives a cable's slack

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: `describe` windows, `catalog` by kind, and `kind` in rack.json

**Files:**
- Modify: `kit/rack/queries.js` (the `cable-rules.js` import; replace `catalog`; replace the whole `describe` section)
- Modify: `spec/tests/js/rack-queries.mjs` (two expectations; append)
- Modify: `spec/tools/portrayal/devices_index.py` (one key in the device entry)
- Modify: `spec/tools/portrayal/rack_index.py` (`import re`; `kind_of`; one key in `build`)
- Modify: `spec/tests/test_rack_index.py` (fixture; append)
- Modify: `docs/format-stability.md` (the rack catalogue section)

**Interfaces:**
- Consumes: `lengthText` from `cable-rules.js`. `devices.json` entries, which now carry `profile`. The chassis from `<name>.configs.json` (`airflow`).
- Produces:
  - `describe(rack, {chassisOf}, {section, offset, limit} = {}) -> string`.
  - `catalog(devices, {text, ru, family, mount, kind}) -> [{ref, manufacturer, model, ru, mount, family, kind, configs, default}]`.
  - `rack_index.kind_of(device, chassis) -> str`.
  - `rack.json` `devices.<name>.kind`.
  - `devices.json` `devices[].profile`.

- [ ] **Step 1: Write the failing tests**

In `spec/tests/js/rack-queries.mjs`, replace

```js
  assert.match(text, /^Rack 1: 42U four-post, square holes, numbered bottom-up\./);
```

with

```js
  assert.match(text, /^Rack 1 \(r1\): 2 items, 1 cable\.\n42U four-post, square holes, numbered bottom-up\./);
```

and in the `catalog filters by text, height, family and mount` test, replace the expected entry

```js
    {ref: 'r740xd', manufacturer: 'Dell', model: 'R740xd', ru: 2, mount: 'rack', family: 'poweredge', configs: ['a', 'b'], default: 'a'});
```

with

```js
    {ref: 'r740xd', manufacturer: 'Dell', model: 'R740xd', ru: 2, mount: 'rack', family: 'poweredge', kind: null, configs: ['a', 'b'], default: 'a'});
```

Append to `spec/tests/js/rack-queries.mjs`:

```js

const KINDS = {pp: {ru: 1, model: 'FHD-1UFCE', manufacturer: 'FS', family: null, kind: 'patch panel', configs: ['base'], default: 'base'},
               sw: {ru: 1, model: 'DS3000', manufacturer: 'Celestica', family: 'Data Center Switch', kind: 'switch', configs: ['base'], default: 'base'},
               cm: {ru: 1, mount: 'rack-face', model: 'CMP5DR', manufacturer: 'FS', family: null, kind: 'cable manager', configs: ['base'], default: 'base'}};

test('catalog: by kind, and text matches the kind and family words', () => {
  assert.deepEqual(Q.catalog(KINDS, {kind: 'patch panel'}).map(e => e.ref), ['pp']);
  assert.deepEqual(Q.catalog(KINDS, {text: 'patch panel'}).map(e => e.ref), ['pp']);
  assert.deepEqual(Q.catalog(KINDS, {text: 'Switch'}).map(e => e.ref), ['sw']);
  assert.deepEqual(Q.catalog(KINDS, {text: 'cable manager', mount: 'rack-face'}).map(e => e.ref), ['cm']);
  assert.equal(Q.catalog(KINDS, {kind: 'switch'})[0].kind, 'switch');
});

test('describe: a window reads one stretch in full, and the first line gives the totals and what is shown', () => {
  let r = M.newRack();
  for (let u = 1; u <= 6; u++) r = add(r, 'as7726-32x', u, {label: `leaf-${u}`, cfg: 'ac-f2b'});
  r = {...r, cables: Array.from({length: 40}, (_, k) => ({id: `c${k + 1}`, a: {item: 'i1', path: `port-${k + 1}`, view: 'front'},
    b: {item: 'i2', path: `port-${k + 1}`, view: 'front'}, media: 'om4', purpose: k % 2 ? 'uplink' : '', label: '', route: [],
    ...(k === 20 ? {length: {value: 3, unit: 'm', source: 'entered'}} : {})}))};
  const text = Q.describe(r, ctx, {section: 'cables', offset: 20, limit: 20});
  const lines = text.split('\n');
  assert.equal(lines[0], 'Rack 1 (r1): 6 items, 40 cables. Cables 21-40 shown.');
  assert.equal(lines[1], '42U four-post, square holes, numbered bottom-up.');
  assert.equal(lines[2], 'Cables:');
  assert.equal(lines[3], 'c21: i1/port-21 <-> i2/port-21, om4, 3 m');
  assert.equal(lines[4], 'c22: i1/port-22 <-> i2/port-22, om4, uplink');
  assert.equal(lines.length, 23);
  const items = Q.describe(r, ctx, {section: 'items', limit: 2}).split('\n');
  assert.deepEqual(items, ['Rack 1 (r1): 6 items, 40 cables. Items 1-2 shown.', '42U four-post, square holes, numbered bottom-up.',
    'Items:', 'i6 leaf-6 U6 front, as7726-32x ac-f2b', 'i5 leaf-5 U5 front, as7726-32x ac-f2b']);
  assert.equal(Q.describe(r, ctx, {section: 'cables', offset: 40}).split('\n')[0], 'Rack 1 (r1): 6 items, 40 cables. Cables past the end: there are 40.');
  assert.equal(Q.describe(M.newRack(), ctx, {offset: 0}).split('\n')[0], 'Rack 1 (r1): 0 items, 0 cables. No items. No cables.');
  assert.match(Q.describe(r, ctx, {offset: 0}), /^Rack 1 \(r1\): 6 items, 40 cables\. Items 1-6 shown\. Cables 1-20 shown\./);
});

test('describe: the totals line survives the shortening of a long rack', () => {
  let r = M.newRack();
  for (let u = 1; u <= 42; u++) r = add(r, 'as7726-32x', u, {label: `leaf-switch-number-${u}`});
  const text = Q.describe(r, ctx);
  assert.ok(text.length <= 1500);
  assert.match(text, /^Rack 1 \(r1\): 42 items, 0 cables\.\n/);
});

test('describe: an offset or limit that is not a whole number above 0 falls back to the start and 20', () => {
  let r = M.newRack();
  for (let u = 1; u <= 25; u++) r = add(r, 'as7726-32x', u, {label: `l${u}`});
  for (const w of [{offset: -3}, {offset: 2.5}, {offset: '3'}, {limit: 0}, {limit: -1}, {limit: 'all'}])
    assert.equal(Q.describe(r, ctx, {section: 'items', ...w}).split('\n')[0], 'Rack 1 (r1): 25 items, 0 cables. Items 1-20 shown.', JSON.stringify(w));
});
```

In `spec/tests/test_rack_index.py`, add `import pytest` after `import json` (with a blank line between, as below), and give `_dist` a `device` parameter with a profile:

```python
import json

import pytest

from portrayal import rack_index
```

```python
def _dist(tmp_path, chassis, attrs=None, faces=None, device=None):
    (tmp_path / "devices.json").write_text(json.dumps({"devices": [
        {"name": "mgr", "manufacturer": "FS.com", "model": "FHD-CMP5DR", "profile": "passive", **(device or {})}]}))
```

(The rest of `_dist` is unchanged.) Append:

```python


@pytest.mark.parametrize("device, chassis, kind", [
    ({"profile": "server"}, {}, "server"),
    ({"profile": "power"}, {}, "pdu"),
    ({"profile": "passive"}, {"mount": "rack-face"}, "cable manager"),
    ({"profile": "optical"}, {"airflow": "passive"}, "patch panel"),
    ({"profile": "optical"}, {"airflow": "front-to-back"}, "optical"),
    ({"profile": "networking", "portfolio": {"family": "Aggregation Services Router"}}, {}, "router"),
    ({"profile": "networking", "portfolio": {"family": "Universal Routing Platform"}}, {}, "router"),
    ({"profile": "networking", "portfolio": {"family": "Leaf Switch"}}, {}, "switch"),
    ({"profile": "networking", "description": "1U top-of-rack switch, 48 x 25G"}, {}, "switch"),
    ({"profile": "networking", "description": "The 2RU Nokia 7750 SR-1 service router"}, {}, "router"),
    ({"profile": "networking", "portfolio": {"family": "PTP grandmaster"}}, {}, "network device"),
    ({"profile": "lab-bench"}, {}, "device"),
    ({}, {}, "device"),
])
def test_kind_is_a_plain_word_from_the_profile_and_the_vendors_own_words(device, chassis, kind):
    assert rack_index.kind_of(device, chassis) == kind


def test_every_device_carries_its_kind(tmp_path):
    d = _dist(tmp_path, {"h": 44, "airflow": "passive"}, device={"profile": "optical"})
    assert rack_index.build(d)["devices"]["mgr"]["kind"] == "patch panel"
    assert rack_index.build(d)["format"] == 1


def test_devices_json_carries_each_manifests_profile(tmp_path):
    """rack_index reads `profile` from devices.json, so the index must publish it."""
    import subprocess
    import sys
    from pathlib import Path
    root = Path(__file__).resolve().parents[2]
    r = subprocess.run([sys.executable, root / "spec/tools/portrayal/devices_index.py",
                        "--library", root / "library", "--out", tmp_path], capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr
    devices = {x["name"]: x for x in json.loads((tmp_path / "devices.json").read_text())["devices"]}
    assert devices["r740xd"]["profile"] == "server"
    assert devices["fhd-cmp5dr"]["profile"] == "passive"
    assert devices["fhd-1ufce"]["profile"] == "optical"
    assert all(x["profile"] for x in devices.values())
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd spec/tests/js && node --test rack-queries.mjs`, then from the root `PYTHONPATH=spec/tools:spec/tests python3 -m pytest -q spec/tests/test_rack_index.py`
Expected: node FAIL (no totals line, no `kind`, no window). pytest FAIL (`module 'portrayal.rack_index' has no attribute 'kind_of'`, and `KeyError: 'profile'`). The `devices_index` test takes about a minute, because it indexes the whole library.

- [ ] **Step 3: Write `catalog` by kind and the windowed `describe`**

In `kit/rack/queries.js`, replace the `cable-rules.js` import line with

```js
import {portFree, endKey, proposeMedia, mismatch, endName, carriedU, portPathOf, matches, lengthText} from './cable-rules.js';
```

Replace the whole `export function catalog(...) { ... }` with:

```js
// `text` matches the ref, maker and model, and what the device IS: its kind
// ("patch panel", "switch", "cable manager", from rack.json) and its family.
export function catalog(devices, {text, ru, family, mount, kind} = {}) {
  const t = text ? String(text).toLowerCase() : null;
  return catalogEntries(devices)
    .filter(e => !t || [e.name, e.manufacturer, e.model, e.kind, e.family].some(v => String(v ?? '').toLowerCase().includes(t)))
    .filter(e => ru == null || e.ru === ru)
    .filter(e => family == null || e.family === family)
    .filter(e => mount == null || (e.mount || 'rack') === mount)
    .filter(e => kind == null || e.kind === kind)
    .map(e => ({ref: e.name, manufacturer: e.manufacturer ?? null, model: e.model ?? null, ru: e.ru,
                mount: e.mount || 'rack', family: e.family ?? null, kind: e.kind ?? null, configs: e.configs ?? [], default: e.default ?? null}));
}
```

Replace everything from `// A SHORT READING OF THE RACK` down to (not including) `// The ports of a device with no cable` with:

```js
// A SHORT READING OF THE RACK for an agent: the ids it needs to address
// anything, in about 1.5K characters (WebMCP's guidance for tool output). A
// long rack loses its labels first, then its tail, and says so. The first line
// always gives the totals. A WINDOW (`section`, `offset`, `limit`) reads one
// stretch of a long rack in full instead, each line with the device's ref and
// configuration or the cable's purpose and length.
const LIMIT = 1500;
const WINDOW = 20;
const count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const sideOf = e => `${e.item}/${e.path}${e.view === 'rear' ? ' (rear)' : ''}`;

export function describe(rack, {chassisOf}, {section, offset, limit} = {}) {
  const f = rack.frame;
  const holes = f.holes.style === 'tapped' ? `tapped${f.holes.thread ? ` ${f.holes.thread}` : ''} holes` : 'square holes';
  const items = [...rack.items].sort((a, b) => b.ru - a.ru);
  const cables = rack.cables || [];
  const totals = `${rack.name} (${rack.id}): ${count(items.length, 'item')}, ${count(cables.length, 'cable')}.`;
  const frameLine = `${f.heightRU}U ${f.kind}, ${holes}, numbered ${f.numbering}.`;
  const uOf = heightOf(chassisOf);
  const span = i => {
    const [a, b] = [uLabel(f, i.ru), uLabel(f, i.ru + uOf(i) - 1)].sort((x, y) => x - y);
    return a === b ? `U${a}` : `U${a}-U${b}`;
  };
  // `full` is a window's line: the ref and configuration, the purpose and length
  const item = (i, short, full = false) => {
    const ms = managersOf(rack, i.id).map(m => m.id);
    return [`${i.id}${short ? '' : ` ${i.label}`} ${span(i)} ${i.face}${i.turned ? ' turned' : ''}`,
            ...(full ? [`${i.ref} ${i.cfg || '(no configuration)'}`] : []),
            ...(i.on ? [`on ${i.on} unit ${i.unit}`] : []), ...(ms.length ? [`carries ${ms.join(' ')}`] : [])].join(', ');
  };
  const cable = (c, full = false) => [`${c.id}: ${sideOf(c.a)} <-> ${sideOf(c.b)}`, ...(c.media ? [c.media] : []),
    ...(full && c.purpose ? [c.purpose] : []), ...(full && lengthText(c.length) ? [lengthText(c.length)] : [])].join(', ');

  if (section != null || offset != null || limit != null) {
    const from = Number.isInteger(offset) && offset > 0 ? offset : 0;
    const n = Number.isInteger(limit) && limit > 0 ? limit : WINDOW;
    const parts = [['items', 'Items', items, i => item(i, false, true)], ['cables', 'Cables', cables, c => cable(c, true)]]
      .filter(([key]) => !['items', 'cables'].includes(section) || section === key);
    const shown = [], body = [];
    for (const [, title, list, line] of parts) {
      if (!list.length) shown.push(`No ${title.toLowerCase()}.`);
      else if (from >= list.length) shown.push(`${title} past the end: there are ${list.length}.`);
      else {
        shown.push(`${title} ${from + 1}-${Math.min(list.length, from + n)} shown.`);
        body.push(`${title}:`, ...list.slice(from, from + n).map(line));
      }
    }
    return [`${totals} ${shown.join(' ')}`, frameLine, ...body].join('\n');
  }

  const build = (short, nItems, nCables) => {
    const lines = [totals, frameLine, items.length ? 'Items:' : 'No items.', ...items.slice(0, nItems).map(i => item(i, short)),
                   ...(cables.length ? ['Cables:', ...cables.slice(0, nCables).map(c => cable(c))] : [])];
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
```

- [ ] **Step 4: Publish `profile`, and write `kind`**

In `spec/tools/portrayal/devices_index.py`, after the line `"portfolio": d.get("portfolio") or {},` add:

```python
                # WHAT CLASS OF DEVICE IT IS (spec/schemas/profiles.yaml):
                # rack_index reads it for the plain word a rack catalogue
                # searches by. Every manifest states one.
                "profile": d.get("profile"),
```

In `spec/tools/portrayal/rack_index.py`, add `import re` after `import json`, insert above `def face_file(`:

```python
# WHAT A DEVICE IS, in a plain word an agent can search for: "patch panel",
# "switch". devices.json's `capability` is how far a device is modelled, not
# what it is, and a portfolio has no category; the manifest's `profile` (the
# class spec/schemas/profiles.yaml judges it by) is, and devices.json carries
# it. `networking` is split by the vendor's own words for the device - its
# portfolio, else its description - and `optical` by whether the box is
# passive. A profile this does not know, or none, is "device".
ROUTER = re.compile(r"\brout(?:er|ers|ing)\b", re.I)
SWITCH = re.compile(r"\bswitch(?:es)?\b", re.I)


def kind_of(d, chassis):
    profile = d.get("profile")
    if profile == "server":
        return "server"
    if profile == "power":
        return "pdu"
    if profile == "passive":
        return "cable manager"
    if profile == "optical":
        return "patch panel" if chassis.get("airflow") == "passive" else "optical"
    if profile == "networking":
        p = d.get("portfolio") or {}
        for text in (" ".join(str(p.get(k) or "") for k in ("family", "line", "series")), d.get("description") or ""):
            if ROUTER.search(text):
                return "router"
            if SWITCH.search(text):
                return "switch"
        return "network device"
    return "device"

```

and in `build`, after `"configs": [x["name"] for x in idx.get("configs", [])],` add:

```python
            "kind": kind_of(d, c),
```

- [ ] **Step 5: Document the key**

In `docs/format-stability.md`, in "The rack catalogue", replace

```
`model`, `family`, `ru`, `h`, `w`, `d`, `airflow`, `default` and `configs`
(the names of its configurations). Four keys appear only when the device has
them:
```

with

```
`model`, `family`, `ru`, `h`, `w`, `d`, `airflow`, `default`, `configs`
(the names of its configurations) and `kind`. Four keys appear only when the
device has them:
```

and after the paragraph that ends `...adding a key is not.`, add:

```
`kind` is a plain word for what the device is, read from the manifest's
`profile` (which `devices.json` carries) and the vendor's own words: `switch`,
`router`, `network device`, `server`, `pdu`, `patch panel`, `optical`,
`cable manager`, or `device` when the profile says no more.
```

- [ ] **Step 6: Run the tests to see them pass**

Run:

```bash
(cd spec/tests/js && node --test rack-queries.mjs rack-readme-example.mjs rack-catalog.mjs)
PYTHONPATH=spec/tools:spec/tests python3 -m pytest -q spec/tests/test_rack_index.py spec/tests/test_rack_kit_js.py
```

Expected: PASS (9 tests in `rack-queries.mjs`; 22 in `test_rack_index.py`).

- [ ] **Step 7: Check spelling and syntax, then commit**

```bash
python3 spec/tools/portrayal/comment_spelling.py kit/rack && (cd kit && npm test)
git add kit/rack/queries.js spec/tests/js/rack-queries.mjs spec/tools/portrayal/devices_index.py spec/tools/portrayal/rack_index.py spec/tests/test_rack_index.py docs/format-stability.md
git commit -m "rack: describe takes a window and leads with the totals, catalog finds by kind, rack.json says what each device is

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Descriptions and #895 wording, version, changelog and README

**Files:**
- Modify: `kit/rack/commands.js` (the `ID`, `END`, `place` and `patch` descriptions)
- Modify: `spec/tests/js/rack-commands-table.mjs` (append)
- Create: `changelog.d/rack-agent-commands.md`
- Modify: `kit/README.md` (the Racks table, and one new subsection)
- Modify: `kit/package.json` (`version`, only if 0.3.0 is already published)

**Interfaces:**
- Consumes: every command from Tasks 6 to 9.
- Produces: the descriptions an agent reads, and the record of the change.

- [ ] **Step 1: Write the failing test**

Append to `spec/tests/js/rack-commands-table.mjs`:

```js

// Spec rack-agent-commands §5.5: an agent reads only these words, so they name
// no function and no page of any one site.
test('no description an agent reads names a function or a site page', () => {
  const said = [];
  const walk = (schema, at) => {
    for (const [k, s] of Object.entries(schema.properties || {})) { said.push([`${at}${k}`, s.description]); walk(s, `${at}${k}.`); }
  };
  for (const [op, def] of Object.entries(COMMANDS)) {
    if (def.system) continue;
    said.push([op, def.description]);
    walk(def.args, `${op}: `);
  }
  for (const [where, text] of said) {
    assert.doesNotMatch(text, /\w\(\)/, `${where} names a function`);
    assert.doesNotMatch(text, /Explorer|portrayal\.dev|Rack Builder/, `${where} names a site page`);
  }
});

test('the commands an agent uses to change one part are in the table', () => {
  for (const op of ['fit', 'field']) assert.ok(COMMANDS[op], op);
  assert.ok(COMMANDS['cable.update'].args.properties.a && COMMANDS['cable.update'].args.properties.b);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd spec/tests/js && node --test rack-commands-table.mjs`
Expected: FAIL, with `place: id names a function` or similar, from `describe()`, `freePorts()`, `catalog()` and "the Explorer".

- [ ] **Step 3: Reword the shared and touched descriptions**

In `kit/rack/commands.js`:

Replace the `ID` line with

```js
const ID = what => ({type: 'string', minLength: 1, description: `The id of the ${what}, as the rack's description lists it, or "@name" from earlier in this batch.`});
```

In `END`, replace `description: 'The port, as freePorts() names it (e.g. port-1).'` with `description: "The port, as the device's free ports name it (e.g. port-1)."`.

Replace the `place` entry's first two lines with

```js
  place: {run: place, description: 'Put a device in the rack with its bottom at a U on a face. A cable manager put over a device bolts onto it. Refused, with the reason, when it does not fit, or when the device has no such configuration.',
    args: args(['ref', 'face', 'ru'], {ref: {type: 'string', minLength: 1, description: 'The device, as the catalogue lists it (its ref).'},
```

Replace the `patch` entry's first four lines (through `fields:`) with

```js
  patch: {run: patch, description: "Change a placed device's configuration, label or turned state, or replace all of what is seated in it and all of its part settings at once. A new configuration on its own clears what was seated and set; to change one slot or one setting, use fit or field.",
    args: args(['id'], {id: ID('device'), cfg: {type: 'string', description: 'Which of its configurations; it keeps its own when left out.'},
      swaps: {type: 'object', description: 'Every slot path to the part ref seated there, replacing the whole map. A slot left out holds what its configuration builds.'},
      fields: {type: 'object', description: 'Every part path to its settings ({key: value}), replacing the whole map.'},
```

`SUMMARY` ("the page sets it") and `lengths.routed` ("the page sends it", `routeFacts().ctx`) stay. They belong to commands this spec does not touch, and the new test skips system commands. See decision 9.

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd spec/tests/js && node --test rack-commands-table.mjs rack-commands.mjs rack-apply.mjs`
Expected: PASS.

- [ ] **Step 5: Decide the version**

Run: `npm view @portrayal/kit versions --json`
Expected today: `["0.1.0", "0.2.0"]`. If `"0.3.0"` is in the list, set `"version": "0.4.0"` in `kit/package.json`, and write `0.4.0` where the changelog entry below says "the kit". Otherwise leave `0.3.0`: this work ships in the release #896 started.

- [ ] **Step 6: Write the changelog fragment**

Create `changelog.d/rack-agent-commands.md`:

```markdown
### Added
- `@portrayal/kit/rack` has commands and questions an agent can use without
  reading the code (`docs/rack-agent-commands-design.md`). `fit` seats, empties
  or restores one bay or cage; `field` sets one setting of one seated part;
  `cable.update` takes `a` and `b` to move an end and keep the cable. `inspect`
  reads one device's bays, cages and part settings, or one cable's ends, route,
  routed length and loose ends; `selectCables` turns "the cables on this
  device" or "every loose cable" into ids; `describe` takes a window
  (`section`, `offset`, `limit`); `catalog` filters by `kind`.
  `loadSlots(dist, refs)` in `rack/catalog.js` loads the parts lists that
  `editor.apply(cmds, {ctx})` and `editor.preview(cmds, {ctx})` check against,
  for that call only.
- `rack.json` gives every device a `kind`, a plain word for what it is
  (`switch`, `router`, `patch panel`, `cable manager`, `server`, `pdu`, ...),
  and `devices.json` carries each device's `profile`, which `kind` is read
  from. Both are additive: `rack.json` stays `format` 1 and `devices.json`
  stays `contract: 2`.
### Changed
- `patch` with a new `cfg` and no `swaps` or `fields` clears both, as the Rack
  Builder's inspector already did. With parts lists loaded, `place` and `patch`
  refuse a configuration the device does not list, and `patch {swaps}` leaves
  out, and names, what a slot does not take.
- `describe` starts with a totals line (`Rack 1 (r1): 6 items, 40 cables.`);
  the frame follows on its own line.
- The command descriptions name no function and no page: `describe()`,
  `freePorts()`, `catalog()` and the Explorer are gone from them.
```

Run: `PYTHONPATH=spec/tools python3 spec/tools/portrayal/changelog.py --check`
Expected: `... changelog fragment(s), all well formed`.

- [ ] **Step 7: Update the kit README**

In `kit/README.md`, under `## Racks`, replace the `rack/catalog.js` row (the table's first) with

```markdown
| `rack/catalog.js` | `loadCatalog(dist)`: the rack catalogue, and the `chassisOf(ref)` lookup everything else takes; `loadSlots(dist, refs)`: the bays, cages and parts the commands check against |
```

and replace the `rack/queries.js` row (the table's last) with these two rows:

```markdown
| `rack/queries.js` | reading a rack: `fitsAt`, `freeUs`, `catalog`, `describe`, `inspect`, `selectCables`, `freePorts`, `suggestMedia`, `looseEnds` |
| `rack/slots.js` | what a placed device holds, read without a drawing: its bays and cages, what its configuration builds, and its own swaps |
```

and replace the paragraph that begins `To change a rack by name rather than by function` with:

```markdown
To change a rack by name rather than by function, use the command core:
`createRackEditor({ doc, chassisOf })` applies `place`, `move`, `patch`,
`remove`, `attach`, `detach`, `frame`, `rename`, `dcim`, `fit`, `field`, the
`cable.*` commands and the page's own `lengths.routed` as all-or-nothing
batches, with `undo`, `redo` and an `on('change')` event. Each command names
its arguments in `COMMANDS` (`rack/commands.js`), and `rack/queries.js`
answers what a command would need to know first.

### Commands and questions for an agent

`fit` seats, empties or restores one bay or cage, and `field` sets one setting
of one seated part; neither touches the rest of the device. `cable.update`
takes `a` or `b` to move an end and keep the cable. They check what they are
given against the parts lists when the caller loads them:
`loadSlots(dist, refs)` fetches each device's `<ref>.configs.json` and
`components.json` once, and `editor.apply(cmds, { origin, ctx })` and
`editor.preview(cmds, { ctx })` lay that `ctx` over `{ chassisOf }` for the one
call. Without it, nothing is checked, as before.

`inspect(rack, id, ctx)` reads one device whole: its configurations, every bay
and cage with what it holds and what it takes, and its parts' settings. For a
cable it reads both ends, the route, the routed length (with `ctx.route`), the
pathways it may name, and its loose ends (with `ctx.cableFacts`).
`selectCables(rack, selector, ctx)` turns `{ item }`, `{ item, path }`,
`{ loose: true }`, `{ purpose }` or `{ media }` into cable ids, for a caller to
expand into plain commands. `describe(rack, ctx, { section, offset, limit })`
reads one stretch of a long rack in full. `catalog(devices, { kind })` finds a
"patch panel" or a "switch" by `rack.json`'s `kind`.
```

- [ ] **Step 8: Run the whole suite this plan touches**

```bash
PYTHONPATH=spec/tools:spec/tests python3 -m pytest -q spec/tests/test_rack_kit_js.py spec/tests/test_rack_index.py spec/tests/test_comment_spelling.py spec/tests/test_dist_contract.py
(cd kit && npm test)
python3 spec/tools/portrayal/comment_spelling.py kit/rack
PYTHONPATH=spec/tools python3 spec/tools/portrayal/changelog.py --check
```

Expected: all pass (`test_dist_contract.py` skips without a built `library/dist`), `npm test` exits 0, `comment spelling: clean`, and fragments well formed.

- [ ] **Step 9: Commit**

```bash
git add kit/rack/commands.js spec/tests/js/rack-commands-table.mjs changelog.d/rack-agent-commands.md kit/README.md kit/package.json
git commit -m "rack: descriptions an agent reads name no function or page; changelog and README for the agent commands

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-review

**Spec coverage.**
- §3.1 `inspect`, items: Task 3. Cables: Task 4.
- §3.2 `selectCables`: Task 5.
- §3.3 `describe` windows and totals, and `catalog` by `kind` and text: Task 10.
- §4 `loadSlots` and the per-call editor `ctx`: Task 2.
- §5.1 `fit`: Task 6, with the nested bay, the unknown path, the refused ref, the cut at 8, the orphaned-cable and media findings, the merge, and the dropped fields.
- §5.2 `field`: Task 7.
- §5.3 `cable.update {a, b}`: Task 8.
- §5.4 the `place` and `patch` checks, and the `patch {cfg}` clear: Task 9.
- §5.5 descriptions: the new entries in Tasks 6 to 8, and the bounds and wording test in Task 11.
- §6 `rack.json` `kind` and the format-stability line: Task 10.
- §7 tests: every bullet has a test above. The editor test is in Task 2; the `loadSlots` failing fetch in Task 2; `kind` in `test_rack_index.py` in Task 10; the house rules in every task's last step.
- D6 and #895: Task 11, decision 9.

**Placeholders.** None. Every code step carries its code, and every run step its command and expected result.

**Type consistency.** The names are the same everywhere they appear:
- `slotsFor`, `slotEnv`, `resolverFor`, `holdsAt`, `slotTree`, `partName`, `partOf` and `partsMissing` are defined in Task 3 and imported in Tasks 3, 6, 7 and 9.
- `own` is defined in Task 6 and used in Task 7.
- `NO_FACTS` is defined and tested in Task 5.
- `inspect` is async throughout.
- `field` takes part paths in both Task 3's `fields[].path` and Task 7.
- The `cable-rules.js` import line is given whole in Tasks 6 and 8. Task 8's is a superset of Task 6's.
- The `queries.js` import line is given whole in Tasks 4, 5 and 10, each a superset of the one before.

**Review Focus.** Each of the five lines has its test in the owning task:
1. A slot on a built carrier: Task 6, `fit: a slot on the part the configuration built...`.
2. A refused swap from an older file: Task 6, `fit: a swap from an older file...`.
3. A configuration the parts list no longer has: Task 3, `inspect: an item whose configuration...`.
4. A bad window: Task 10, `describe: an offset or limit that is not a whole number...`.
5. Batch undo: Task 6, `fit: a batch is one undo step...`.
