# Rack Builder Phase 1a: build a rack (implementation plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new tool page, `rack.html` ("Rack Builder" in the nav), where someone can:
- create a two-post or four-post rack with its own depths and hole style;
- place any catalog device at an RU, on the front or the rear;
- see the front and rear elevations side by side;
- move or remove a device, or open it in Explorer to seat modules and optics;
- keep their racks in a browser library, and save or open them as `.json`.

**Architecture:**
- Pure modules under `site/rack/` hold the file format (`model.js`) and the placement rules (`fit.js`). They have no DOM, so `node --test` can test them.
- A generated `site/rack/chassis.json` gives every device's RU and depth without fetching 158 config files.
- `elevation.js` draws one face of any rack through Phase 0's `configuredFace`. The showcase's `build2dElevation` becomes an adapter over it.
- `library.js` keeps documents in IndexedDB.
- `explorer-lens.js` opens Explorer in an overlay and reads the device's changes back.
- `rack-page.js` wires the page, with the side panel built by `frame-form.js`, `catalog.js` and `inspector.js`.

**Tech stack:**
- Vanilla ES modules with no bundler, served by `serve.py`.
- `node --test`, with no dependencies, for the pure modules.
- Playwright checks in `check-browser.py`, registered with `@extra` and runnable with `--only`.
- Python for the chassis index and `check-contract.py`.

**Spec:** `docs/superpowers/specs/2026-09-26-rack-builder-design.md`. This plan covers §5 (model), §6 (placement), §7.1–7.3 and §7.5–7.6 (page, layout, Explorer lens, library, rails), plus §11 (testing). **3D (§7.4) and exports (§8) are Phase 1b**, and cabling (§9) is Phase 2. Read §2, §5, §6 and §7 before starting.

## Global constraints

- **Never edit anything under `vendor/` or `assets/`.** They are snapshots of the upstream Portrayal project, and `./refresh-assets.sh` overwrites them.
- There is no bundler, no npm and no new dependency. Modules import each other by relative path. `site/rack/model.js`, `site/rack/fit.js` and `site/rack/rails.js` must not touch the DOM, because `node --test` imports them.
- Prose in comments and UI copy uses American English (color, center). UI copy is sentence case, with no "please" and no exclamation marks.
- The showcase's behavior must not change, apart from the corrected rail hole size (Task 1).
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Serve locally with `python3 serve.py 8932`. `file://` does not work.
- Decisions already made (spec §2):
  - one rack per document, in a file whose `racks` is an array;
  - front and rear share an RU only on four-post frames, and only when their depths fit;
  - hole style is square (cage nut) or tapped, with an optional thread (12-24, 10-32, M6);
  - the library lives in IndexedDB;
  - layout B: front and rear side by side, with the side panel on the right.

## Facts the tasks rely on (verified 2026-09-26 on `main` at `34d0cd92`)

- **`site/rack/face.js` (Phase 0):**
  - `configuredFace({ref, cfg, view='front', swaps={}, fields={}, turned=false})` → a deep-frozen `{ref, cfg, view, text, vb, zones, ports, seat}`, or `null` when the face was never compiled;
  - it is memoized on a snapshot of its arguments;
  - `components()` caches the component index for the session, including a failure (`[]`).
- **`site/showcase/rack.js` `build2dElevation({stack, heightRU, overrides, view='front', baseRU=1})`:**
  - It draws rails from `site/showcase/rails.js` (`RU`, `RAIL_W`, `OPENING`, `HOLE_DY`, `HOLE_SIZE = 6.5`, `SIDES`), then every stack entry `{ref, cfg, ru, u, label, turned?}` through `configuredFace`.
  - Each device is a `<g transform data-device-name data-device-ref>`.
  - A missing face is skipped.
  - Its only importers are the showcase stages, `patch-view.js` and `check-browser.py` checks.
- **`site/rack3d.js`** imports `{RU, RAIL_W, HOLE_DY, HOLE_SIZE, SIDES}` from `./showcase/rails.js`.
- **`check-contract.py`, around line 470:** it reads `site/showcase/rails.js` as text and checks its exports and the mirror.
- **`site/showcase/artifact.js`** defines `el` and `svgEl` (lines 35–50), and looks up showcase-only elements at module load. **A tool page must not import `artifact.js`.**
- **`assets/dist/devices.json`:** `{contract, devices: [{name, manufacturer, model, portfolio: {family}, …}]}`. It has 158 devices and `name` is the device ref. Size and configurations live only in `assets/dist/<name>.configs.json`:
  - `chassis: {ru?, h, w, d, airflow}` (mm);
  - `default`;
  - `configs: [{name}]`.

  Together the configs files are 7.9 MB, too much to fetch for the catalog.
- **Real depths, for fixtures:**

  | Device | Height | Depth | Default config |
  |---|---|---|---|
  | `r740xd` | 2U (h 86.8, no `ru`) | 737.5 | `sff24-rc5-1b2a3a` |
  | `as7726-32x` | 1U | 515.0 | `ac-f2b` |
  | `fhd-1ufce` | 1U | 432.8 | `base` |
  | `tm-280` | 1U | 140.5 | |
  | `mx10004` | 7U | 932.0 | |

  No device has `ru: 0` today.
- **Explorer embed** (`explorer.html`, `?embed=1`) exposes `window.portrayalEmbed = {ready, setMode, current()}`. `current()` returns `{device, config, view, mode, swaps, pulled}`, with **no `fields`**. Explorer already reads `swap=` and `fields=` from its URL. Encoders: `encodeSwaps` (`vendor/swap.js`) and `encodeFields` (`site/optics.js`).
- **Tool pages** use `body.tool` and the head/site-bar of `explorer.html` (lines 1–27 and 142–164), plus `brand/tokens.css`, `site/toolbar.css` and `site/tool-theme.css`. `body.tool > .fill` is the flex fill. Colors come from `var(--pt-surface | --pt-surface-2 | --pt-ink | --pt-ink-muted | --pt-line | --pt-warn | --pt-ground | --pt-brass)`.
- **The nav is copied by hand** into drawings, explorer, components, schema, annotate, drawio and exporter `.html`. `index.html` has a masthead nav (Explorer link at line 49) and a footer list (line 476).
- **`check-browser.py`:**
  - `PAGES` (line 47) is the 404/exception sweep;
  - extra checks are `@extra(label)` functions `fn(page, base) -> list[str]`, run alone with `--only name1,name2`;
  - it has `READY_MS`, and `pathlib` is imported.
- **CI** (`.github/workflows/checks.yml`) runs `check-contract.py`, then `check-browser.py`. The pre-push hook (`hooks/pre-push`) runs the contract check always, and the browser check when site files changed.
- **Node** is v22 locally. CI has no Node step yet.

## File map

| File | Responsibility | Task |
|---|---|---|
| `site/rack/rails.js` | Rail geometry and hole sizes. Pure. Moved from `site/showcase/rails.js`, which becomes a re-export. | 1 |
| `tests/rack/*.test.mjs` | `node --test` suites for the pure modules | 1–3 |
| `site/rack/model.js` | File format, defaults, immutable edits, parse, migrations, `uLabel` | 2 |
| `site/rack/fit.js` | Placement rules and their reasons; `reaches`; `availableDepth`; zero-U fit | 3 |
| `chassis-index.py`, `site/rack/chassis.json`, `site/rack/chassis.js` | The catalog's sizes: generator, output, loader | 4 |
| `site/rack/face.js` | Bounded memo; the component index is retried after a failure | 5 |
| `site/rack/dom.js`, `site/rack/elevation.js` | `el` and `svgEl`; one face of any rack. `build2dElevation` becomes an adapter. | 6 |
| `site/rack/library.js` | IndexedDB library, autosave, `.json` download and read | 7 |
| `explorer.html`, `site/rack/explorer-lens.js` | `current().fields`; the overlay lens | 8 |
| `rack.html`, `site/rack/rack.css`, `site/rack-page.js`, `site/rack/frame-form.js`, and the nav in 8 pages | The page, frame settings, library menu, both panes | 9 |
| `site/rack/catalog.js` | The side panel for an empty U: a searchable catalog showing what fits | 10 |
| `site/rack/inspector.js` | The side panel for an item: label, config, face, turned, depth, Explorer, move, remove | 11 |

---

### Task 1: One rail file under `site/rack/`, correct hole sizes, and node tests in CI

**Files:**
- Create: `site/rack/rails.js`, `tests/rack/rails.test.mjs`
- Modify: `site/showcase/rails.js` (becomes a re-export), `site/rack3d.js:22` (the import path), `check-contract.py` (rails section, ~line 470), `.github/workflows/checks.yml`, `hooks/pre-push`

**Interfaces:**
- Produces: `site/rack/rails.js` exports `RU = 44.45`, `RAIL_W = 26`, `OPENING = 450.85`, `HOLE_CC = 465.1`, `HOLE_DY = [6.35, 22.22, 38.10]`, `HOLE_SQUARE = 9.5`, `HOLE_ROUND = 5.5`, `HOLE_SIZE = HOLE_SQUARE`, and `SIDES` (unchanged). `site/showcase/rails.js` is `export * from '../rack/rails.js';`.

- [ ] **Step 1: Write the failing node test**

`tests/rack/rails.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../../site/rack/rails.js';

test('square holes are EIA-310 cage-nut holes, 3/8 in', () => {
  assert.equal(R.HOLE_SQUARE, 9.5);
  assert.equal(R.HOLE_SIZE, R.HOLE_SQUARE);
});

test('a tapped hole is drawn round at about a 12-24 major diameter', () => {
  assert.equal(R.HOLE_ROUND, 5.5);
});

test('a hole sits inside its rail, clear of the U line', () => {
  for (const s of R.SIDES) {
    const inner = Math.abs(s.inner), outer = Math.abs(s.outer), hole = Math.abs(s.hole);
    assert.ok(hole - R.HOLE_SQUARE / 2 > inner, `${s.side}: hole crosses the inner edge`);
    assert.ok(hole + R.HOLE_SQUARE / 2 < outer, `${s.side}: hole crosses the outer edge`);
  }
  assert.ok(R.HOLE_DY[0] - R.HOLE_SQUARE / 2 > 0);
  assert.ok(R.HOLE_DY.at(-1) + R.HOLE_SQUARE / 2 < R.RU);
});

test('the right rail mirrors the left', () => {
  const [l, r] = R.SIDES;
  for (const k of ['inner', 'outer', 'hole', 'number']) assert.equal(l[k], -r[k]);
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `node --test tests/rack/rails.test.mjs`
Expected: FAIL, `Cannot find module …/site/rack/rails.js`.

- [ ] **Step 3: Move the file and correct the holes**

Run `git mv site/showcase/rails.js site/rack/rails.js`. In `site/rack/rails.js`, replace `export const HOLE_SIZE = 6.5;` with:

```js
// THE HOLES. EIA-310's square hole for a cage nut is 0.375 in (9.5 mm) - the
// 6.5 mm drawn before was a guess that read as a round-hole rail. A tapped
// rail is drawn round at about a 12-24's major diameter (0.216 in); a 10-32
// (4.8 mm) or an M6 (6 mm) would be within a pixel of it at any zoom.
export const HOLE_SQUARE = 9.5;
export const HOLE_ROUND = 5.5;
// The square hole, which is what rack3d.js and the showcase draw.
export const HOLE_SIZE = HOLE_SQUARE;
```

Create `site/showcase/rails.js`:

```js
// The rails moved to site/rack/rails.js - the Rack Builder draws them too, and
// one description is the whole point of the file. This keeps the showcase's
// imports working.
export * from '../rack/rails.js';
```

In `site/rack3d.js` line 22, change `'./showcase/rails.js'` to `'./rack/rails.js'`.

- [ ] **Step 4: Point the contract check at the new file**

In `check-contract.py`, in the "one rail, drawn twice" section:
- change `rails = HERE / "site" / "showcase" / "rails.js"` to `rails = HERE / "site" / "rack" / "rails.js"`;
- change the message `"site/showcase/rails.js exists"` to `"site/rack/rails.js exists"`;
- extend the exports tuple to `("RU", "RAIL_W", "OPENING", "HOLE_CC", "HOLE_DY", "HOLE_SQUARE", "HOLE_ROUND", "HOLE_SIZE", "SIDES")`.

Directly after the export loop, add:

```python
shim = (HERE / "site" / "showcase" / "rails.js")
check(shim.is_file() and "export * from '../rack/rails.js'" in shim.read_text()
      and "export const" not in shim.read_text(),
      "site/showcase/rails.js only re-exports site/rack/rails.js",
      "the rail has a second description")
```

- [ ] **Step 5: Run node tests in CI and in the hook**

In `.github/workflows/checks.yml`, directly after the `the contract with Portrayal` step, add:

```yaml
      - uses: actions/setup-node@v4
        with: {node-version: '22'}

      # THE RACK MODEL, on its own: pure modules, no browser, a second or two.
      - name: the rack builder's pure modules
        run: node --test tests/rack/*.test.mjs
```

In `hooks/pre-push`, directly after `python3 "$CONTRACT"`, add:

```sh
# The rack builder's pure modules: no browser, a second or two, so always.
if command -v node >/dev/null 2>&1 && ls tests/rack/*.test.mjs >/dev/null 2>&1; then
  echo "pre-push: node --test tests/rack"
  node --test tests/rack/*.test.mjs
fi
```

Also add `tests/` to the `touches_the_site` pattern: `'^(vendor/|site/|assets/|brand/|tests/|[^/]+\.html$|check-browser\.py$|serve\.py$)'`.

- [ ] **Step 6: Run everything that reads the rails**

Run: `node --test tests/rack/rails.test.mjs && python3 check-contract.py && python3 check-browser.py`
Expected:
- 4 node tests pass;
- the contract passes, with the new shim check;
- the browser suite passes. The showcase now draws 9.5 mm square holes; nothing asserts the old size.

Then open `http://localhost:8932/index.html`, go to stage 0 (Rails), and confirm that the holes are visibly larger squares, sit inside the rails, and don't touch the U lines.

- [ ] **Step 7: Commit**

```bash
git add site/rack/rails.js site/showcase/rails.js site/rack3d.js check-contract.py tests/rack/rails.test.mjs .github/workflows/checks.yml hooks/pre-push
git commit -m "rack: one rail file under site/rack, cage-nut holes at their real 9.5 mm

The Rack Builder draws rails too, so rails.js moves to site/rack and the
showcase path re-exports it. Square holes were 6.5 mm; EIA-310's are 3/8 in.
A round hole is added for tapped rails. node --test runs the pure rack
modules in CI and in the pre-push hook.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The rack file format (`model.js`)

**Files:**
- Create: `site/rack/model.js`, `tests/rack/model.test.mjs`

**Interfaces:**
- Produces:
  - Constants: `FORMAT = 'portrayal-rack'`, `VERSION = 1`, `THREADS = ['12-24', '10-32', 'M6']`, `MIGRATIONS = []`. `MIGRATIONS[n-1]` upgrades a version-n document to n+1.
  - `defaultFrame(kind='four-post') → frame`
  - `normalizeFrame(frameLike) → frame`
  - `newRack({name='Rack 1', kind='four-post'}) → rack`
  - `newDoc({name, kind}) → doc`, where a doc is `{format, version, id, racks: [rack]}`
  - `nextId(list, prefix) → string`
  - `withItem(rack, {ref, cfg, ru, face='front', turned=false, label=ref, swaps={}, fields={}}) → {rack, item}`
  - `updateItem(rack, id, patch) → rack`
  - `withoutItem(rack, id) → rack`
  - `withFrame(rack, patch) → rack`, which normalizes
  - `renamed(rack, name) → rack`
  - `uLabel(frame, u) → number`
  - `parseDoc(stringOrObject) → doc`, which throws `Error` with a sentence the page can show
  - `serialize(doc) → string`

  All edits are immutable: they return new objects.
- The shapes are exactly spec §5:
  - **frame:** `{kind, heightRU, numbering, holes: {style, thread}, railDepth, usableDepth, ref}`
  - **item:** `{id, ref, cfg, label, ru, face, turned, swaps, fields}`
  - **rack:** `{id, name, frame, items, zeroU, cables}`

- [ ] **Step 1: Write the failing tests**

`tests/rack/model.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../../site/rack/model.js';

test('a new document is one 42U four-post rack with the spec defaults', () => {
  const d = M.newDoc();
  assert.equal(d.format, 'portrayal-rack');
  assert.equal(d.version, 1);
  assert.match(d.id, /^doc-/);
  assert.equal(d.racks.length, 1);
  assert.deepEqual(d.racks[0].frame, {kind: 'four-post', heightRU: 42, numbering: 'bottom-up',
    holes: {style: 'square', thread: null}, railDepth: 740, usableDepth: 1000, ref: null});
  assert.deepEqual([d.racks[0].items, d.racks[0].zeroU, d.racks[0].cables], [[], [], []]);
});

test('a two-post frame has no rail depth and a 1000 mm usable depth', () => {
  assert.deepEqual(M.defaultFrame('two-post'), {kind: 'two-post', heightRU: 42, numbering: 'bottom-up',
    holes: {style: 'square', thread: null}, railDepth: null, usableDepth: 1000, ref: null});
});

test('normalizeFrame keeps a thread only on a tapped rail, and only a known one', () => {
  const f = M.defaultFrame();
  assert.equal(M.normalizeFrame({...f, holes: {style: 'square', thread: 'M6'}}).holes.thread, null);
  assert.equal(M.normalizeFrame({...f, holes: {style: 'tapped', thread: 'M6'}}).holes.thread, 'M6');
  assert.equal(M.normalizeFrame({...f, holes: {style: 'tapped', thread: 'M5'}}).holes.thread, null);
  assert.equal(M.normalizeFrame({...f, heightRU: '24.4'}).heightRU, 24);
  assert.equal(M.normalizeFrame({...f, heightRU: 0}).heightRU, 42);
  assert.equal(M.normalizeFrame({...f, kind: 'two-post'}).railDepth, null);
  assert.equal(M.normalizeFrame({...M.defaultFrame('two-post'), kind: 'four-post'}).railDepth, 740);
});

test('items get stable, unique ids; edits return new racks', () => {
  const r0 = M.newRack();
  const {rack: r1, item: a} = M.withItem(r0, {ref: 'r740xd', cfg: 'sff24-rc5-1b2a3a', ru: 10});
  const {rack: r2, item: b} = M.withItem(r1, {ref: 'as7726-32x', cfg: 'ac-f2b', ru: 20, face: 'rear'});
  assert.deepEqual([a.id, b.id], ['i1', 'i2']);
  assert.equal(r0.items.length, 0, 'the original rack is untouched');
  assert.deepEqual(a, {id: 'i1', ref: 'r740xd', cfg: 'sff24-rc5-1b2a3a', label: 'r740xd', ru: 10,
    face: 'front', turned: false, swaps: {}, fields: {}});
  const r3 = M.withoutItem(r2, 'i1');
  const {item: c} = M.withItem(r3, {ref: 'tm-280', cfg: 'base', ru: 1});
  assert.equal(c.id, 'i3', 'a removed id is never reused');
  assert.equal(M.updateItem(r2, 'i2', {ru: 21}).items[1].ru, 21);
  assert.equal(M.renamed(r2, 'Lab').name, 'Lab');
});

test('uLabel counts from the top when the frame says so', () => {
  const f = M.defaultFrame();
  assert.equal(M.uLabel(f, 1), 1);
  assert.equal(M.uLabel({...f, numbering: 'top-down'}, 1), 42);
  assert.equal(M.uLabel({...f, numbering: 'top-down'}, 42), 1);
});

test('a document survives serialize and parse unchanged', () => {
  let d = M.newDoc({name: 'Lab rack'});
  const {rack} = M.withItem(d.racks[0], {ref: 'r740xd', cfg: 'sff24-rc5-1b2a3a', ru: 10,
    swaps: {'psu-2': 'common/psu-dc-650@2'}, fields: {'port-1-occupant': {label: 'LR4'}}});
  d = {...d, racks: [rack]};
  assert.deepEqual(M.parseDoc(M.serialize(d)), d);
});

test('parseDoc refuses what it cannot read, with a sentence', () => {
  assert.throws(() => M.parseDoc('{'), SyntaxError);
  assert.throws(() => M.parseDoc({format: 'other'}), /not a Portrayal rack file/);
  assert.throws(() => M.parseDoc({format: 'portrayal-rack', version: 2, racks: []}),
    /version 2; this page reads up to version 1/);
  assert.throws(() => M.parseDoc({format: 'portrayal-rack', version: 1, racks: []}), /holds no rack/);
  assert.throws(() => M.parseDoc({format: 'portrayal-rack', version: 1,
    racks: [{frame: {}, items: [{ref: 'x'}]}]}), /Item 1 has no device or no U/);
});

test('parseDoc fills what an older writer left out, and keeps zeroU and cables', () => {
  const d = M.parseDoc({format: 'portrayal-rack', version: 1,
    racks: [{name: 'A', frame: {kind: 'two-post'}, items: [{id: 'i4', ref: 'tm-280', ru: 3}],
             zeroU: [{id: 'z1'}], cables: [{id: 'c1'}]}]});
  assert.match(d.id, /^doc-/);
  assert.equal(d.racks[0].frame.usableDepth, 1000);
  assert.deepEqual(d.racks[0].items[0], {id: 'i4', ref: 'tm-280', cfg: '', label: 'tm-280', ru: 3,
    face: 'front', turned: false, swaps: {}, fields: {}});
  assert.deepEqual([d.racks[0].zeroU, d.racks[0].cables], [[{id: 'z1'}], [{id: 'c1'}]]);
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `node --test tests/rack/model.test.mjs`
Expected: FAIL, `Cannot find module …/site/rack/model.js`.

- [ ] **Step 3: Implement `site/rack/model.js`**

```js
// THE RACK FILE (spec §5). Pure data: no DOM, no fetch, no rendering, so the
// page, the library, the exports and `node --test` all read one definition.
//
// A document holds an ARRAY of racks although the page edits one: rows of
// racks come later, and a file written today must still open then. Every
// edit here returns a new object - the page autosaves whatever it last
// committed, and a shared, mutated rack is how a save would catch half an edit.

export const FORMAT = 'portrayal-rack';
export const VERSION = 1;
export const THREADS = ['12-24', '10-32', 'M6'];
// MIGRATIONS[n - 1] takes a version-n document to version n + 1. Empty until
// the format first changes; parseDoc runs whatever is here, in order.
export const MIGRATIONS = [];

const RAIL_DEPTH = 740;        // mm between front and rear rails: a common 4-post
const USABLE_BEYOND = 260;     // mm a four-post allows past its rear rail by default
const TWO_POST_USABLE = 1000;  // mm a two-post allows, front rail to the deepest point

const token = () => Math.random().toString(36).slice(2, 10);

export function normalizeFrame(f = {}) {
  const four = f.kind !== 'two-post';
  const railDepth = four ? (Number(f.railDepth) > 0 ? Number(f.railDepth) : RAIL_DEPTH) : null;
  const style = f.holes?.style === 'tapped' ? 'tapped' : 'square';
  const height = Math.round(Number(f.heightRU));
  return {
    kind: four ? 'four-post' : 'two-post',
    heightRU: height >= 1 ? height : 42,
    numbering: f.numbering === 'top-down' ? 'top-down' : 'bottom-up',
    holes: {style, thread: style === 'tapped' && THREADS.includes(f.holes?.thread) ? f.holes.thread : null},
    railDepth,
    usableDepth: Number(f.usableDepth) > 0 ? Number(f.usableDepth)
      : four ? railDepth + USABLE_BEYOND : TWO_POST_USABLE,
    ref: f.ref ?? null,
  };
}

export const defaultFrame = (kind = 'four-post') => normalizeFrame({kind});

export const newRack = ({name = 'Rack 1', kind = 'four-post'} = {}) =>
  ({id: 'r1', name, frame: defaultFrame(kind), items: [], zeroU: [], cables: []});

export const newDoc = ({name = 'Rack 1', kind = 'four-post'} = {}) =>
  ({format: FORMAT, version: VERSION, id: `doc-${token()}`, racks: [newRack({name, kind})]});

// The next id after the highest one ever used in `list`, so a removed item's
// id is never handed to another - a cable (Phase 2) naming it must not start
// naming something else.
export function nextId(list, prefix) {
  const used = list.map(x => Number(String(x.id).slice(prefix.length))).filter(Number.isInteger);
  return `${prefix}${Math.max(0, ...used) + 1}`;
}

export function withItem(rack, {ref, cfg, ru, face = 'front', turned = false, label = ref,
                                swaps = {}, fields = {}}) {
  const item = {id: nextId(rack.items, 'i'), ref, cfg, label, ru,
                face: face === 'rear' ? 'rear' : 'front', turned: !!turned,
                swaps: {...swaps}, fields: structuredClone(fields)};
  return {rack: {...rack, items: [...rack.items, item]}, item};
}

export const updateItem = (rack, id, patch) =>
  ({...rack, items: rack.items.map(i => (i.id === id ? {...i, ...patch} : i))});
export const withoutItem = (rack, id) => ({...rack, items: rack.items.filter(i => i.id !== id)});
export const withFrame = (rack, patch) => ({...rack, frame: normalizeFrame({...rack.frame, ...patch})});
export const renamed = (rack, name) => ({...rack, name: String(name)});

// U numbers are stored bottom-up always; this is only what a label says.
export const uLabel = (frame, u) => (frame.numbering === 'top-down' ? frame.heightRU - u + 1 : u);

function readItem(i, n) {
  if (!i || typeof i.ref !== 'string' || !i.ref || !Number.isInteger(i.ru))
    throw new Error(`Item ${n} has no device or no U.`);
  return {id: String(i.id ?? `i${n}`), ref: i.ref, cfg: String(i.cfg ?? ''), label: String(i.label ?? i.ref),
          ru: i.ru, face: i.face === 'rear' ? 'rear' : 'front', turned: !!i.turned,
          swaps: {...(i.swaps || {})}, fields: structuredClone(i.fields || {})};
}

// READ A FILE, OR REFUSE IT WITH A SENTENCE. A newer file than this page knows
// is refused whole: reading the parts it understands and dropping the rest
// would hand back a rack that looks complete and is not.
export function parseDoc(input) {
  let d = typeof input === 'string' ? JSON.parse(input) : input;
  if (!d || d.format !== FORMAT) throw new Error('This is not a Portrayal rack file.');
  if (!Number.isInteger(d.version) || d.version < 1) throw new Error('This rack file has no valid version.');
  if (d.version > VERSION)
    throw new Error(`This rack file is version ${d.version}; this page reads up to version ${VERSION}. Reload to get the newer page.`);
  for (let v = d.version; v < VERSION; v++) d = MIGRATIONS[v - 1](d);
  if (!Array.isArray(d.racks) || !d.racks.length) throw new Error('This rack file holds no rack.');
  return {
    format: FORMAT, version: VERSION,
    id: typeof d.id === 'string' && d.id ? d.id : `doc-${token()}`,
    racks: d.racks.map((r, k) => ({
      id: String(r.id ?? `r${k + 1}`), name: String(r.name ?? 'Rack'),
      frame: normalizeFrame(r.frame),
      items: (r.items || []).map((i, n) => readItem(i, n + 1)),
      zeroU: Array.isArray(r.zeroU) ? structuredClone(r.zeroU) : [],
      cables: Array.isArray(r.cables) ? structuredClone(r.cables) : [],
    })),
  };
}

export const serialize = doc => JSON.stringify(doc, null, 2);
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --test tests/rack/`
Expected: every test in `model.test.mjs` and `rails.test.mjs` passes.

- [ ] **Step 5: Commit**

```bash
git add site/rack/model.js tests/rack/model.test.mjs
git commit -m "rack: the rack file format - frame, items, parse and migrations

Pure and immutable; a newer file than the page knows is refused whole, and
a removed item's id is never reused.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Placement rules (`fit.js`)

**Files:**
- Create: `site/rack/fit.js`, `tests/rack/fit.test.mjs`

**Interfaces:**
- Consumes: `RU` from `site/rack/rails.js`. The rack shape comes from Task 2.
- Produces:
  - `REACH_MM = 50`
  - `span(item, chassisOf) → [lowU, highU]`
  - `fits(rack, cand, chassisOf, {ignoreId=null}) → {ok: true} | {ok: false, reason}`, where `cand` is `{ref, ru, face}`
  - `reaches(item, rack, chassisOf) → boolean`: does the item show a panel on the other face, or only a ghost?
  - `availableDepth(rack, item, chassisOf) → mm`
  - `attachPoints(kind) → string[]`
  - `fitsZeroU(rack, cand, chassisOf, {ignoreId}) → {ok, reason?}`, where `cand` is `{ref, at, offsetMm}`

  `chassisOf(ref)` returns `{ru, h, d, …}` or `null`.

- [ ] **Step 1: Write the failing tests**

`tests/rack/fit.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../../site/rack/model.js';
import * as F from '../../site/rack/fit.js';

// Real sizes (assets/dist configs.json, 2026-09-26).
const SIZES = {
  'r740xd': {ru: 2, h: 86.8, d: 737.5}, 'as7726-32x': {ru: 1, h: 43.5, d: 515.0},
  'fhd-1ufce': {ru: 1, h: 44.0, d: 432.8}, 'tm-280': {ru: 1, h: 43.6, d: 140.5},
  'mx10004': {ru: 7, h: 311, d: 932.0}, 'pdu-v': {ru: 0, h: 1200, d: 60},
};
const chassisOf = ref => SIZES[ref] || null;
const place = (rack, ref, ru, face = 'front', label = ref.toUpperCase()) =>
  M.withItem(rack, {ref, cfg: 'x', ru, face, label}).rack;

test('a device fits in an empty four-post rack', () => {
  assert.deepEqual(F.fits(M.newRack(), {ref: 'r740xd', ru: 10, face: 'front'}, chassisOf), {ok: true});
});

test('height: below U1 or past the top is refused', () => {
  const r = M.newRack();
  assert.equal(F.fits(r, {ref: 'tm-280', ru: 0, face: 'front'}, chassisOf).reason, 'Below U1.');
  assert.equal(F.fits(r, {ref: 'mx10004', ru: 40, face: 'front'}, chassisOf).reason,
    '7U needed; 3U free from U40 to the top.');
});

test('an unknown device is refused, not guessed at', () => {
  assert.equal(F.fits(M.newRack(), {ref: 'nope', ru: 1, face: 'front'}, chassisOf).reason,
    'No size is known for nope.');
});

test('the same face never shares a U', () => {
  const r = place(M.newRack(), 'r740xd', 10);       // U10-U11
  assert.equal(F.fits(r, {ref: 'tm-280', ru: 11, face: 'front'}, chassisOf).reason,
    'Taken by R740XD on the front.');
  assert.deepEqual(F.fits(r, {ref: 'tm-280', ru: 12, face: 'front'}, chassisOf), {ok: true});
});

test('four-post: opposite faces share a U when their depths fit the rail depth', () => {
  const r = place(M.newRack(), 'as7726-32x', 20);   // 515 mm, front
  assert.deepEqual(F.fits(r, {ref: 'tm-280', ru: 20, face: 'rear'}, chassisOf), {ok: true});   // 655.5 <= 740
  assert.equal(F.fits(r, {ref: 'fhd-1ufce', ru: 20, face: 'rear'}, chassisOf).reason,
    '433 mm deep; 225 mm free behind AS7726-32X.');                                         // 947.8 > 740
});

test('four-post: a boundary sum exactly equal to the rail depth fits', () => {
  const r = place(M.withFrame(M.newRack(), {railDepth: 655.5}), 'as7726-32x', 20);
  assert.deepEqual(F.fits(r, {ref: 'tm-280', ru: 20, face: 'rear'}, chassisOf), {ok: true});
});

test('two-post: front and rear never share a U', () => {
  const r = place(M.newRack({kind: 'two-post'}), 'tm-280', 5);
  assert.equal(F.fits(r, {ref: 'tm-280', ru: 5, face: 'rear'}, chassisOf).reason,
    'Taken by TM-280; two-post rails are shared by front and rear.');
});

test('usable depth caps any device, on either face', () => {
  const r = M.withFrame(M.newRack(), {usableDepth: 900});
  assert.equal(F.fits(r, {ref: 'mx10004', ru: 1, face: 'rear'}, chassisOf).reason,
    '932 mm deep; this rack allows 900 mm.');
});

test('ignoreId lets an item be checked against everything but itself (moves)', () => {
  const r = place(M.newRack(), 'r740xd', 10);
  assert.deepEqual(F.fits(r, {ref: 'r740xd', ru: 11, face: 'front'}, chassisOf, {ignoreId: 'i1'}), {ok: true});
});

test('reaches: a full-depth device shows its other panel; a short one is a ghost', () => {
  const r = place(place(M.newRack(), 'r740xd', 10), 'tm-280', 20);
  assert.equal(F.reaches(r.items[0], r, chassisOf), true);     // 737.5 >= 740 - 50
  assert.equal(F.reaches(r.items[1], r, chassisOf), false);    // 140.5
  const two = place(M.newRack({kind: 'two-post'}), 'tm-280', 20);
  assert.equal(F.reaches(two.items[0], two, chassisOf), true, 'two-post has one plane');
});

test('availableDepth: what is left behind the other face, or the usable depth', () => {
  const r = place(place(M.newRack(), 'as7726-32x', 20), 'tm-280', 20, 'rear');
  assert.equal(F.availableDepth(r, r.items[1], chassisOf), 740 - 515);
  assert.equal(F.availableDepth(r, r.items[0], chassisOf), 740 - 140.5);
  const alone = place(M.newRack(), 'r740xd', 1);
  assert.equal(F.availableDepth(alone, alone.items[0], chassisOf), 1000);
});

test('zero-U: only the frame\'s attachment points, and never overlapping', () => {
  assert.deepEqual(F.attachPoints('four-post'), ['left-front', 'right-front', 'left-rear', 'right-rear']);
  assert.deepEqual(F.attachPoints('two-post'), ['left', 'right']);
  let r = M.newRack();
  assert.equal(F.fitsZeroU(r, {ref: 'pdu-v', at: 'left', offsetMm: 0}, chassisOf).reason,
    'left is not an attachment point of a four-post frame.');
  assert.deepEqual(F.fitsZeroU(r, {ref: 'pdu-v', at: 'left-rear', offsetMm: 0}, chassisOf), {ok: true});
  r = {...r, zeroU: [{id: 'z1', ref: 'pdu-v', at: 'left-rear', offsetMm: 0, label: 'PDU A'}]};
  assert.equal(F.fitsZeroU(r, {ref: 'pdu-v', at: 'left-rear', offsetMm: 600}, chassisOf).reason,
    'Overlaps PDU A at left-rear.');
  assert.equal(F.fitsZeroU(r, {ref: 'pdu-v', at: 'right-rear', offsetMm: 900}, chassisOf).reason,
    '1200 mm long; it runs past the top of the rack.');
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `node --test tests/rack/fit.test.mjs`
Expected: FAIL, `Cannot find module …/site/rack/fit.js`.

- [ ] **Step 3: Implement `site/rack/fit.js`**

```js
// WHERE A DEVICE MAY GO (spec §6). Pure: the rack, the candidate, and a
// chassisOf(ref) -> {ru, h, d} that the page backs with site/rack/chassis.json.
// Every refusal is a sentence, because the catalog shows it beside the device
// it grays out - "no" without a reason is a puzzle.
//
// Depth along the rack: a front-face device runs [0, d] back from the front
// rail; a rear-face one runs [railDepth - d, railDepth] forward from the rear
// rail. On four posts the two share a U when those do not overlap, which is
// dFront + dRear <= railDepth. Two-post rails are one plane that every body
// passes through, so there a U is never shared.

import {RU} from './rails.js';

export const REACH_MM = 50;   // within this of the far rail, a device's far panel is visible there

const mm = x => Math.round(x);
export function span(item, chassisOf) {
  const u = chassisOf(item.ref)?.ru ?? 1;
  return [item.ru, item.ru + Math.max(1, u) - 1];
}
const overlaps = (a, b) => a[0] <= b[1] && b[0] <= a[1];

export function fits(rack, cand, chassisOf, {ignoreId = null} = {}) {
  const f = rack.frame, c = chassisOf(cand.ref);
  if (!c) return {ok: false, reason: `No size is known for ${cand.ref}.`};
  const lo = cand.ru, hi = cand.ru + Math.max(1, c.ru) - 1;
  if (lo < 1) return {ok: false, reason: 'Below U1.'};
  if (hi > f.heightRU)
    return {ok: false, reason: `${c.ru}U needed; ${f.heightRU - lo + 1}U free from U${lo} to the top.`};
  if (c.d > f.usableDepth) return {ok: false, reason: `${mm(c.d)} mm deep; this rack allows ${mm(f.usableDepth)} mm.`};
  for (const o of rack.items) {
    if (o.id === ignoreId) continue;
    const oc = chassisOf(o.ref);
    if (!oc || !overlaps([lo, hi], span(o, chassisOf))) continue;
    if (o.face === cand.face) return {ok: false, reason: `Taken by ${o.label} on the ${o.face}.`};
    if (f.kind === 'two-post')
      return {ok: false, reason: `Taken by ${o.label}; two-post rails are shared by front and rear.`};
    if (c.d + oc.d > f.railDepth)
      return {ok: false, reason: `${mm(c.d)} mm deep; ${Math.max(0, mm(f.railDepth - oc.d))} mm free behind ${o.label}.`};
  }
  return {ok: true};
}

// Does this item show its other panel on the other face's elevation, or only
// a ghost of the space it takes?
export function reaches(item, rack, chassisOf) {
  if (rack.frame.kind === 'two-post') return true;
  return (chassisOf(item.ref)?.d ?? 0) >= rack.frame.railDepth - REACH_MM;
}

// The depth this item could have where it stands: what the other face leaves
// on the U range it shares, or the rack's usable depth.
export function availableDepth(rack, item, chassisOf) {
  const f = rack.frame;
  if (f.kind === 'two-post') return f.usableDepth;
  const mine = span(item, chassisOf);
  const other = rack.items.filter(o => o.id !== item.id && o.face !== item.face
                                       && overlaps(mine, span(o, chassisOf)));
  if (!other.length) return f.usableDepth;
  return Math.min(f.usableDepth, f.railDepth - Math.max(...other.map(o => chassisOf(o.ref)?.d ?? 0)));
}

export const attachPoints = kind => (kind === 'four-post'
  ? ['left-front', 'right-front', 'left-rear', 'right-rear'] : ['left', 'right']);

// ZERO-U (spec §5.3): along an attachment point, by offset in mm from the
// bottom of the rails. The catalog has none yet; the rules are here so the
// day it does, placing one is data, not a change to this file.
export function fitsZeroU(rack, cand, chassisOf, {ignoreId = null} = {}) {
  const f = rack.frame;
  if (!attachPoints(f.kind).includes(cand.at))
    return {ok: false, reason: `${cand.at} is not an attachment point of a ${f.kind} frame.`};
  const len = chassisOf(cand.ref)?.h;
  if (!len) return {ok: false, reason: `No size is known for ${cand.ref}.`};
  if (cand.offsetMm < 0 || cand.offsetMm + len > f.heightRU * RU)
    return {ok: false, reason: `${mm(len)} mm long; it runs past the top of the rack.`};
  for (const o of rack.zeroU) {
    if (o.id === ignoreId || o.at !== cand.at) continue;
    const ol = chassisOf(o.ref)?.h ?? 0;
    if (cand.offsetMm < o.offsetMm + ol && o.offsetMm < cand.offsetMm + len)
      return {ok: false, reason: `Overlaps ${o.label ?? o.ref} at ${o.at}.`};
  }
  return {ok: true};
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --test tests/rack/`
Expected: every test passes. If a reason string differs, fix the code, not the test: the strings are the UI copy.

- [ ] **Step 5: Commit**

```bash
git add site/rack/fit.js tests/rack/fit.test.mjs
git commit -m "rack: placement rules - RU, face, the four-post depth budget, zero-U

Every refusal is a sentence the catalog shows. Two-post rails never share a
U; four-post faces share one when dFront + dRear fits the rail depth.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The catalog's sizes (`chassis-index.py` → `site/rack/chassis.json`)

**Files:**
- Create: `chassis-index.py`, `site/rack/chassis.json` (generated), `site/rack/chassis.js`
- Modify: `refresh-assets.sh` (run the generator before the contract check), `check-contract.py` (assert it is current)

**Interfaces:**
- Produces:
  - `site/rack/chassis.json`:

    ```
    {"generated-from": "...", "devices": {<name>: {manufacturer, model, family, ru, h, w, d, airflow, default, configs: [..]}}}
    ```

    `ru` is `chassis.ru` when stated, including 0; otherwise `max(1, round(h / 44.45))`, the rule of `rack.js`'s `unitsOf`.
  - `site/rack/chassis.js`: `loadChassis(url='site/rack/chassis.json') → Promise<{[name]: entry}>`, memoized, and retried after a failure.
  - `chassisLookup(devices) → ref => entry | null`
  - `catalogEntries(devices) → [{name, …entry}]`, sorted by manufacturer, then model.

- [ ] **Step 1: Write the failing contract check**

In `check-contract.py`, directly above the `# ── report` line, add:

```python
# ── the rack builder's chassis index ───────────────────────────────────────
# The catalog grays out what will not fit, which needs every device's RU and
# depth; those live only in 158 configs.json files (7.9 MB). chassis-index.py
# distils them into site/rack/chassis.json, and refresh-assets.sh regenerates
# it after every sync - this is what fails if a sync forgot to.
import importlib.util as _ilu
_spec = _ilu.spec_from_file_location("chassis_index", HERE / "chassis-index.py")
if _spec and (HERE / "chassis-index.py").is_file():
    _ci = _ilu.module_from_spec(_spec); _spec.loader.exec_module(_ci)
    _out = HERE / "site" / "rack" / "chassis.json"
    check(_out.is_file() and _out.read_text() == _ci.text(),
          "site/rack/chassis.json matches assets/dist", "run ./chassis-index.py")
else:
    check(False, "chassis-index.py exists", "the rack builder's catalog has no sizes")
```

Run: `python3 check-contract.py`
Expected: FAIL, `chassis-index.py exists`.

- [ ] **Step 2: Write the generator**

`chassis-index.py` (make it executable with `chmod +x`):

```python
#!/usr/bin/env python3
"""The rack builder's catalog sizes, from the vendored build.

Every device's RU, depth and configurations, distilled from
assets/dist/<name>.configs.json into site/rack/chassis.json - small enough for
the catalog to load at once, so it can gray out what will not fit without
fetching 158 index files. Regenerated by refresh-assets.sh after every sync;
check-contract.py fails when it is stale.

    ./chassis-index.py          write site/rack/chassis.json
"""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
DIST = HERE / "assets" / "dist"
OUT = HERE / "site" / "rack" / "chassis.json"
RU = 44.45


def build():
    devices = json.loads((DIST / "devices.json").read_text())["devices"]
    out = {}
    for d in sorted(devices, key=lambda d: d["name"]):
        p = DIST / f"{d['name']}.configs.json"
        if not p.is_file():
            continue
        idx = json.loads(p.read_text())
        c = idx.get("chassis") or {}
        h = c.get("h") or RU
        out[d["name"]] = {
            "manufacturer": d.get("manufacturer"),
            "model": d.get("model") or d["name"],
            "family": (d.get("portfolio") or {}).get("family"),
            # chassis.ru when the index states it - 0 included, which is a
            # zero-U part - else the height in mm, as rack.js's unitsOf reads it
            "ru": c["ru"] if c.get("ru") is not None else max(1, round(h / RU)),
            "h": h, "w": c.get("w"), "d": c.get("d"), "airflow": c.get("airflow"),
            "default": idx.get("default"),
            "configs": [x["name"] for x in idx.get("configs", [])],
        }
    return {"generated-from": "assets/dist/devices.json and <name>.configs.json, by chassis-index.py",
            "devices": out}


def text():
    return json.dumps(build(), indent=1, sort_keys=True) + "\n"


if __name__ == "__main__":
    OUT.write_text(text())
    print(f"chassis-index: {len(build()['devices'])} devices -> {OUT.relative_to(HERE)}")
```

In `refresh-assets.sh`, directly before the line that runs `check-contract.py`, add:

```sh
# The rack builder's catalog sizes, distilled from what was just vendored.
python3 ./chassis-index.py
```

- [ ] **Step 3: Generate the index and confirm the contract passes**

Run: `./chassis-index.py && python3 check-contract.py`
Expected: `chassis-index: 158 devices -> site/rack/chassis.json`, then the contract passes.

Spot-check: `python3 -c "import json;d=json.load(open('site/rack/chassis.json'))['devices'];print(d['r740xd']['ru'],d['r740xd']['d'],d['r740xd']['default'])"` prints `2 737.5 sff24-rc5-1b2a3a`.

- [ ] **Step 4: Write the loader `site/rack/chassis.js`**

```js
// The catalog's sizes (chassis-index.py -> site/rack/chassis.json), loaded
// once. A failed load is not remembered: the next ask tries again, so one
// network hiccup does not leave the page with an empty catalog for good.

let INDEX = null;
export function loadChassis(url = 'site/rack/chassis.json') {
  if (!INDEX) {
    INDEX = fetch(url)
      .then(r => { if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return r.json(); })
      .then(j => j.devices || {})
      .catch(err => { INDEX = null; throw err; });
  }
  return INDEX;
}

export const chassisLookup = devices => ref => devices[ref] || null;

const cmp = (a, b) => String(a ?? '').localeCompare(String(b ?? ''));
export const catalogEntries = devices => Object.entries(devices)
  .map(([name, e]) => ({name, ...e}))
  .sort((a, b) => cmp(a.manufacturer, b.manufacturer) || cmp(a.model, b.model));
```

It is exercised by Task 9's page check. It has no DOM, so a node test of it would only test `fetch`.

- [ ] **Step 5: Commit**

```bash
git add chassis-index.py site/rack/chassis.json site/rack/chassis.js refresh-assets.sh check-contract.py
git commit -m "rack: the catalog's sizes - chassis-index.py distils 158 configs.json

site/rack/chassis.json holds every device's RU, depth and configurations so
the catalog can gray out what will not fit without fetching 7.9 MB.
refresh-assets.sh regenerates it; check-contract.py fails when it is stale.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `face.js`: a bounded memo, and a component index that retries

These are the two items deferred from Phase 0's final review. The Rack Builder draws arbitrary devices in arbitrary configurations for as long as the page is open, so an unbounded memo and a sticky failure both start to matter.

**Files:**
- Modify: `site/rack/face.js` (the `components` function and the memo in `configuredFace`)
- Modify: `check-browser.py` (add `check_face_memo_bound` and `check_components_retry`)

**Interfaces:**
- Produces:
  - `FACE_MEMO_LIMIT = 200` (the default)
  - `setFaceMemoLimit(n)`
  - `faceMemoSize() → number`

  `configuredFace` is unchanged for callers. The least recently *asked-for* face is dropped first. `components()` no longer caches a failure.

- [ ] **Step 1: Write the failing checks**

```python
@extra("configuredFace's memo is bounded, least recently asked-for first out")
def check_face_memo_bound(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    page.goto(f"{base}/index.html", wait_until="load")
    r = page.evaluate("""async () => {
      const F = await import('/site/rack/face.js');
      F.setFaceMemoLimit(3);
      const ask = i => F.configuredFace({ref: 'as7726-32x', cfg: 'ac-f2b', view: 'front',
                                         fields: {'port-1-occupant': {label: `M${i}`}}});
      const a = ask(1); await a; await ask(2); await ask(3);
      const again = ask(1) === a;          // a hit refreshes it
      await ask(4);                        // evicts 2, the least recently asked-for
      const size = F.faceMemoSize();
      const oneKept = ask(1) === a;
      F.setFaceMemoLimit(F.FACE_MEMO_LIMIT);
      return {again, size, oneKept};
    }""")
    if r != {"again": True, "size": 3, "oneKept": True}:
        bad.append(f"face memo: {r}")
    return bad


@extra("the component index is fetched again after a failure")
def check_components_retry(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    failed = {"n": 0}

    def fail_once(route):
        if failed["n"] == 0:
            failed["n"] += 1
            route.abort()
        else:
            route.continue_()
    # A blank page on the site's origin, so nothing but this check asks for
    # the component index - the first ask is the one the route fails.
    page.route(f"{base}/__blank.html",
               lambda r: r.fulfill(body="<!doctype html><title>blank</title>", content_type="text/html"))
    page.route("**/assets/dist/components.json", fail_once)
    page.goto(f"{base}/__blank.html", wait_until="load")
    r = page.evaluate("""async () => {
      const F = await import('/site/rack/face.js');
      const first = (await F.components()).length;
      const second = (await F.components()).length;
      return {first, second};
    }""")
    if r["first"] != 0 or r["second"] == 0:
        bad.append(f"components retry: {r} (expected the first to fail empty, the second to load)")
    return bad
```

Run: `python3 check-browser.py --only check_face_memo_bound,check_components_retry`
Expected: FAIL. `setFaceMemoLimit is not a function`, and `first` is 0 while `second` is also 0 (the failure is cached).

- [ ] **Step 2: Implement the bound and the retry in `site/rack/face.js`**

Replace `components()` with:

```js
let COMPONENTS = null;
export function components() {
  if (!COMPONENTS) {
    COMPONENTS = jdist(`${DIST}components.json`)
      .then(j => j.components || [])
      .catch(err => {
        // Not remembered: the next ask fetches again. A cached [] meant one
        // hiccup left every card and optic unseatable until a reload.
        console.warn('[portrayal] no component index', err);
        COMPONENTS = null;
        return [];
      });
  }
  return COMPONENTS;
}
```

`jdist` memoizes too (`vendor/dist.js`). Check that it drops a rejected promise; it does, via `INFLIGHT` in `vendor/dist.js`, or the retry would get the same rejection. If it doesn't, call `clearDistCache()` from `vendor/dist.js` in the catch before resetting `COMPONENTS`.

Replace the memo section (`const MEMO = new Map();` and `configuredFace`) with:

```js
// BOUNDED, least recently asked-for out first. The Rack Builder asks for any
// device in any configuration for as long as the page stays open; each entry
// holds a whole face's SVG text.
export const FACE_MEMO_LIMIT = 200;
let limit = FACE_MEMO_LIMIT;
const MEMO = new Map();
export const setFaceMemoLimit = n => { limit = Math.max(1, n); while (MEMO.size > limit) MEMO.delete(MEMO.keys().next().value); };
export const faceMemoSize = () => MEMO.size;

export function configuredFace({ref, cfg, view = 'front', swaps = {}, fields = {}, turned = false}) {
  const args = {ref, cfg, view, swaps: swaps || {}, fields: fields || {}, turned: !!turned};
  const key = JSON.stringify(canon(args));
  let hit = MEMO.get(key);
  if (hit) {
    MEMO.delete(key);            // re-insert: Map order is recency
  } else {
    hit = build(JSON.parse(key)).catch(err => { MEMO.delete(key); throw err; });
  }
  MEMO.set(key, hit);
  while (MEMO.size > limit) MEMO.delete(MEMO.keys().next().value);
  return hit;
}
```

Keep the existing comments above the memo. They explain the snapshot (`build(JSON.parse(key))`), and that stays.

- [ ] **Step 3: Run the new checks and the existing face checks**

Run: `python3 check-browser.py --only check_face_memo_bound,check_components_retry,check_configured_face,check_configured_face_snapshot`
Expected: all four pass.

- [ ] **Step 4: Commit**

```bash
git add site/rack/face.js check-browser.py
git commit -m "rack: face memo bounded (LRU, 200) and the component index retries

The two items Phase 0's final review deferred to the Rack Builder, which
asks for arbitrary faces for as long as it is open.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: One face of any rack (`elevation.js`); the showcase draws through it

**Files:**
- Create: `site/rack/dom.js`, `site/rack/elevation.js`
- Modify: `site/showcase/artifact.js` (`el`/`svgEl` come from `dom.js`), `site/showcase/rack.js` (`build2dElevation` becomes an adapter), `check-browser.py` (add `check_rack_elevation`)

**Interfaces:**
- Consumes: `configuredFace` (Task 5), the rails (Task 1), `uLabel` (Task 2).
- Produces:
  - `dom.js`: `el(tag, attrs, kids)` and `svgEl(tag, attrs)`, with the same behavior as `artifact.js`'s.
  - `elevation.js`: `panelFor(item, pane) → 'front' | 'rear'`.
  - `drawElevation({items, frame, view='front', baseRU=1, reaches=() => true, hitTargets=false, selectedId=null, selectedU=null, placeholders=true}) → Promise<SVGSVGElement>`, where:
    - `items` is `[{id, ref, cfg, label, ru, u, face, turned, swaps, fields}]`;
    - `u` is the height in RU;
    - device groups carry `data-item-id`, `data-device-name`, `data-device-ref`, and `data-panel` (`mounted`, `through`, `ghost` or `missing`);
    - hit targets are `<rect class="rk-u" data-u data-face>`;
    - the svg carries `data-pane`.
  - `build2dElevation` keeps its signature and output.

- [ ] **Step 1: Write the failing check**

```python
@extra("elevation.js draws both faces of a four-post rack: mounted, through, ghost, holes")
def check_rack_elevation(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    page.goto(f"{base}/index.html", wait_until="load")
    r = page.evaluate("""async () => {
      const E = await import('/site/rack/elevation.js');
      const M = await import('/site/rack/model.js');
      const frame = M.normalizeFrame({kind: 'four-post', heightRU: 24,
                                      holes: {style: 'tapped', thread: '12-24'}});
      const items = [
        {id: 'i1', ref: 'r740xd', cfg: 'sff24-rc5-1b2a3a', label: 'R740xd', ru: 10, u: 2,
         face: 'front', turned: false, swaps: {}, fields: {}},
        {id: 'i2', ref: 'as7726-32x', cfg: 'ac-f2b', label: 'AS7726', ru: 20, u: 1,
         face: 'front', turned: false, swaps: {}, fields: {}},
        {id: 'i3', ref: 'eps201', cfg: 'ac-f2b', label: 'AS4630', ru: 20, u: 1,
         face: 'rear', turned: false, swaps: {}, fields: {}},
      ];
      const reaches = it => it.ref === 'r740xd';
      const draw = view => E.drawElevation({items, frame, view, reaches, hitTargets: true,
                                           selectedId: 'i2', selectedU: view === 'front' ? 5 : null});
      const front = await draw('front'), rear = await draw('rear');
      const panel = (svg, id) => svg.querySelector(`[data-item-id="${id}"]`)?.dataset.panel;
      return {
        pane: [front.dataset.pane, rear.dataset.pane],
        targets: [front.querySelectorAll('rect.rk-u').length, rear.querySelectorAll('rect.rk-u').length],
        front: [panel(front, 'i1'), panel(front, 'i2'), panel(front, 'i3')],
        rear: [panel(rear, 'i1'), panel(rear, 'i2'), panel(rear, 'i3')],
        rearOfServer: !!rear.querySelector('[data-item-id="i1"] [data-path^="psu"]'),
        round: front.querySelectorAll('circle[data-rail-hole]').length,
        square: front.querySelectorAll('rect[data-rail-hole]').length,
        selected: front.querySelector('[data-item-id="i2"]').classList.contains('rk-selected')
                  && front.querySelectorAll('.rk-sel-ring').length === 1,
        ghostPassesClicks: rear.querySelector('[data-item-id="i2"]').getAttribute('pointer-events') === 'none',
        selectedU: front.querySelector('rect.rk-u[data-u="5"]').classList.contains('rk-u-selected'),
        panelFor: [E.panelFor({face: 'front'}, 'front'), E.panelFor({face: 'front'}, 'rear'),
                   E.panelFor({face: 'rear'}, 'rear'), E.panelFor({face: 'front', turned: true}, 'front')],
      };
    }""")
    want = {"pane": ["front", "rear"], "targets": [24, 24],
            "front": ["mounted", "mounted", "ghost"], "rear": ["through", "ghost", "mounted"],
            "rearOfServer": True, "round": 24 * 3 * 2, "square": 0,
            "selected": True, "ghostPassesClicks": True, "selectedU": True,
            "panelFor": ["front", "rear", "front", "rear"]}
    for k, v in want.items():
        if r.get(k) != v:
            bad.append(f"elevation: {k} is {r.get(k)!r}, expected {v!r}")
    return bad
```

Run: `python3 check-browser.py --only check_rack_elevation`
Expected: FAIL, because `/site/rack/elevation.js` is not found.

`[data-path^="psu"]` asserts that the R740xd's rear face really was drawn in the rear pane. If its rear drawing names its supplies differently, pick any path that only exists on `r740xd.sff24-rc5-1b2a3a.rear.svg` (`grep -o 'data-path="[^"]*"' assets/dist/r740xd.sff24-rc5-1b2a3a.rear.svg | head`) and say so in the report.

- [ ] **Step 2: Create `site/rack/dom.js`**, and make `artifact.js` use it

```js
// Two element builders every page module uses. The showcase's artifact.js
// re-exports these: a tool page must not import artifact.js, which looks up
// the showcase's own elements when it loads.
export const el = (tag, attrs = {}, kids = []) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'text') n.textContent = v;
    else n.setAttribute(k, v);
  }
  for (const c of [].concat(kids)) n.append(c);
  return n;
};
export const svgEl = (tag, attrs = {}) => {
  const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};
```

In `site/showcase/artifact.js`, delete the `export const el = …` and `export const svgEl = …` definitions (lines 35–50). At the top of the file, with its imports, add:

```js
import {el, svgEl} from '../rack/dom.js';
export {el, svgEl};
```

- [ ] **Step 3: Create `site/rack/elevation.js`**

```js
// ONE FACE OF A RACK, drawn from data: the rails with this rack's holes, and
// every item on it. The Rack Builder draws both faces with it; the showcase's
// build2dElevation is an adapter over it, so the two can never disagree about
// what a rail or a device looks like.
//
// What a pane shows of an item:
//   mounted  - on this face: its outward panel
//   through  - on the other face, deep enough to reach this one: its far panel
//   ghost    - on the other face and short of this one: a dashed outline, so
//              the space it takes is visible without hiding the free depth
//              behind it
//   missing  - no compiled drawing for that panel: an outline saying so
//
// Every device goes through configuredFace, with its own swaps and fields.

import {RU, RAIL_W, OPENING, HOLE_DY, HOLE_SQUARE, HOLE_ROUND, SIDES} from './rails.js';
import {configuredFace} from './face.js';
import {svgEl} from './dom.js';
import {uLabel} from './model.js';

// Which of the device's own panels faces `pane`. On its own face that is its
// front, unless it is turned; on the other face, the reverse.
export const panelFor = (item, pane) => (((item.face === pane) !== !!item.turned) ? 'front' : 'rear');

function drawRails(out, frame, baseRU, totalH) {
  const X = x => x + OPENING / 2;
  const round = frame.holes?.style === 'tapped';
  for (const s of SIDES) {
    out.append(svgEl('rect', {x: X(Math.min(s.inner, s.outer)), y: 0, width: RAIL_W, height: totalH,
      'data-rail': s.side, fill: 'var(--pt-surface-2)', stroke: 'var(--pt-line)', 'stroke-width': 1}));
  }
  for (let i = 0; i < frame.heightRU; i++) {
    const u = baseRU + i;
    const yBottom = totalH - i * RU;
    for (const s of SIDES) {
      const x0 = X(Math.min(s.inner, s.outer));
      out.append(svgEl('line', {x1: x0, y1: yBottom - RU, x2: x0 + RAIL_W, y2: yBottom - RU,
        stroke: 'var(--pt-line)', 'stroke-width': 0.8}));
      for (const dy of HOLE_DY) {
        const hole = {fill: 'var(--pt-ground)', stroke: 'var(--pt-line)', 'stroke-width': 0.5,
                      'data-rail-hole': s.side};
        out.append(round
          ? svgEl('circle', {cx: X(s.hole), cy: yBottom - dy, r: HOLE_ROUND / 2, ...hole})
          : svgEl('rect', {x: X(s.hole) - HOLE_SQUARE / 2, y: yBottom - dy - HOLE_SQUARE / 2,
                           width: HOLE_SQUARE, height: HOLE_SQUARE, rx: 0.6, ...hole}));
      }
      const t = svgEl('text', {x: X(s.number), y: yBottom - RU / 2 + 4,
        'text-anchor': 'middle', 'font-family': 'IBM Plex Mono, monospace',
        'font-size': 11, 'font-weight': 500, fill: 'var(--pt-ink-muted)', 'data-rail-num': s.side});
      t.textContent = String(uLabel(frame, u));
      out.append(t);
    }
  }
}

// The selection ring is drawn, not styled: CSS outline does not render on
// an SVG group.
const ring = (top, ruH) => svgEl('rect', {x: -3, y: top - 1.5, width: OPENING + 6, height: ruH * RU + 3,
  rx: 3, fill: 'none', stroke: 'var(--pt-brass)', 'stroke-width': 2.5, class: 'rk-sel-ring',
  'pointer-events': 'none'});

function outline(top, ruH, text, attrs) {
  const g = svgEl('g', attrs);
  g.append(svgEl('rect', {x: 0.5, y: top + 0.5, width: OPENING - 1, height: ruH * RU - 1, rx: 2,
    fill: 'var(--pt-surface-2)', 'fill-opacity': 0.35, stroke: 'var(--pt-ink-muted)',
    'stroke-width': 1, 'stroke-dasharray': '4 3'}));
  const t = svgEl('text', {x: OPENING / 2, y: top + ruH * RU / 2 + 4, 'text-anchor': 'middle',
    'font-size': 11, 'font-family': 'IBM Plex Mono, monospace', fill: 'var(--pt-ink-muted)'});
  t.textContent = text;
  g.append(t);
  return g;
}

export async function drawElevation({items, frame, view = 'front', baseRU = 1, reaches = () => true,
                                     hitTargets = false, selectedId = null, selectedU = null,
                                     placeholders = true}) {
  const totalH = frame.heightRU * RU;
  const out = svgEl('svg', {xmlns: 'http://www.w3.org/2000/svg', 'data-pane': view,
    viewBox: `${-RAIL_W - 6} -18 ${OPENING + RAIL_W * 2 + 12} ${totalH + 30}`});
  drawRails(out, frame, baseRU, totalH);
  // Under the devices, so a click on a device is the device's; a click on an
  // empty U lands here.
  if (hitTargets) {
    for (let i = 0; i < frame.heightRU; i++) {
      const u = baseRU + i;
      out.append(svgEl('rect', {x: 0, y: totalH - (i + 1) * RU, width: OPENING, height: RU,
        fill: 'transparent', 'data-u': String(u), 'data-face': view,
        class: u === selectedU ? 'rk-u rk-u-selected' : 'rk-u'}));
    }
  }
  let styled = false;
  for (const it of items) {
    const common = {'data-item-id': it.id, 'data-device-name': it.label, 'data-device-ref': it.ref,
                    ...(it.id === selectedId ? {class: 'rk-selected'} : {})};
    const through = it.face !== view;
    const topOf = ruH => totalH - (it.ru - baseRU + ruH) * RU;
    if (through && !reaches(it)) {
      // A ghost lets clicks through to the empty U under it: the space
      // behind a short device is exactly where a half-depth one goes.
      const ruH = it.u ?? 1;
      out.append(outline(topOf(ruH), ruH, `${it.label} · ${it.face}, short of this rail`,
                         {...common, 'data-panel': 'ghost', 'pointer-events': 'none'}));
      if (it.id === selectedId) out.append(ring(topOf(ruH), ruH));
      continue;
    }
    const panel = panelFor(it, view);
    const face = await configuredFace({ref: it.ref, cfg: it.cfg, view: panel,
                                       swaps: it.swaps || {}, fields: it.fields || {}});
    if (!face) {
      if (placeholders) {
        const ruH = it.u ?? 1;
        out.append(outline(topOf(ruH), ruH, `${it.label} · no ${panel} drawing`,
                           {...common, 'data-panel': 'missing'}));
        if (it.id === selectedId) out.append(ring(topOf(ruH), ruH));
      }
      continue;
    }
    const root = new DOMParser().parseFromString(face.text, 'image/svg+xml').documentElement;
    const vb = (root.getAttribute('viewBox') || '').split(/\s+/).map(Number);
    const w = parseFloat(root.getAttribute('width')) || vb[2];
    const h = parseFloat(root.getAttribute('height')) || vb[3];
    const ruH = it.u ?? Math.max(1, Math.round(h / RU));
    const y = topOf(ruH) + (ruH * RU - h) / 2;
    const g = svgEl('g', {transform: `translate(${(OPENING - w) / 2} ${y})`, ...common,
                          'data-panel': through ? 'through' : 'mounted'});
    // Ids are NOT rewritten per device. The compiled drawings carry no <defs>,
    // no url(#...) and no href="#...", so there is nothing to collide - and
    // renaming them would break swap.js, which finds a seated module by the
    // canonical id the compiler gave it. One <style> is enough: every
    // compiled drawing carries the same stylesheet.
    for (const kid of [...root.childNodes]) {
      if (kid.nodeName === 'style') { if (styled) continue; styled = true; }
      g.append(document.importNode(kid, true));
    }
    out.append(g);
    if (it.id === selectedId) out.append(ring(topOf(ruH), ruH));
  }
  return out;
}
```

- [ ] **Step 4: Make `build2dElevation` an adapter**

In `site/showcase/rack.js`:
- add `import {drawElevation} from '../rack/elevation.js';`;
- replace the whole body of `build2dElevation` with the code below;
- keep the comment block above the function, and add one line saying it now draws through `site/rack/elevation.js`;
- remove any imports that are now unused. These are `RAIL_W`, `OPENING`, `HOLE_DY`, `HOLE_SIZE` and `SIDES` if nothing else in the file uses them. Check with `grep`.

```js
export async function build2dElevation({stack, heightRU, overrides: ov = overrides,
                                        view = 'front', baseRU = 1}) {
  // The cast is every device on the FRONT of one plane of rails, so the rear
  // view is each device's rear panel - two-post says exactly that - and a
  // face that was never drawn is left out, as it always was.
  return drawElevation({
    items: stack.map(e => ({id: e.ref, ref: e.ref, cfg: e.cfg, label: e.label, ru: e.ru, u: e.u,
                            face: 'front', turned: !!e.turned, swaps: ov?.[e.ref] || {}, fields: {}})),
    frame: {kind: 'two-post', heightRU, numbering: 'bottom-up', holes: {style: 'square', thread: null}},
    view, baseRU, placeholders: false,
  });
}
```

- [ ] **Step 5: Run the new check and the full suite**

Run: `python3 check-browser.py --only check_rack_elevation,check_rear_elevation`
Expected: both pass.

Run: `python3 check-browser.py`
Expected: everything passes, including `the stage rail: 7 stages`, stage 4 rear loose ends, and the stage 6 checks. They all draw through the adapter now.

- [ ] **Step 6: Commit**

```bash
git add site/rack/dom.js site/rack/elevation.js site/showcase/artifact.js site/showcase/rack.js check-browser.py
git commit -m "rack: elevation.js draws one face of any rack; the showcase draws through it

Mounted, through, ghost or missing, per the frame's depth; tapped rails get
round holes; hit targets for empty Us. build2dElevation is now an adapter
over it, and el/svgEl live in site/rack/dom.js so a tool page need not
import the showcase's artifact.js.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The rack library (`library.js`)

**Files:**
- Create: `site/rack/library.js`
- Modify: `check-browser.py` (add `check_rack_library`)

**Interfaces:**
- Consumes: `parseDoc` and `serialize` (Task 2).
- Produces:
  - `openLibrary({idb = globalThis.indexedDB}) → Promise<lib>`, where `lib` is:
    - `available` (a boolean);
    - `list() → [{id, name, updatedAt}]`, newest first;
    - `get(id) → doc | null`;
    - `put(doc)`;
    - `remove(id)`.

    With no IndexedDB, every method is a no-op, `list` returns `[]` and `get` returns `null`.
  - `autosaver(lib, delay=500) → {saveSoon(doc), flush() → Promise}`
  - `downloadDoc(doc)`
  - `readDocFile(file) → Promise<doc>`, which throws `parseDoc`'s sentence
  - Database `portrayal-racks`, store `docs`, keyPath `id`.

- [ ] **Step 1: Write the failing check**

```python
@extra("the rack library keeps documents in IndexedDB, and works without it")
def check_rack_library(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    page.goto(f"{base}/index.html", wait_until="load")
    r = page.evaluate("""async () => {
      const L = await import('/site/rack/library.js');
      const M = await import('/site/rack/model.js');
      const lib = await L.openLibrary();
      const a = M.newDoc({name: 'Alpha'}), b = M.newDoc({name: 'Beta'});
      await lib.put(a); await new Promise(r => setTimeout(r, 5)); await lib.put(b);
      const names = (await lib.list()).map(x => x.name);
      const got = await lib.get(a.id);
      const save = L.autosaver(lib, 50);
      save.saveSoon({...a, racks: [{...a.racks[0], name: 'Alpha 2'}]});
      save.saveSoon({...a, racks: [{...a.racks[0], name: 'Alpha 3'}]});
      await save.flush();
      const renamed = (await lib.get(a.id)).racks[0].name;
      await lib.remove(b.id);
      const after = (await lib.list()).map(x => x.name);
      const none = await L.openLibrary({idb: null});
      const off = [none.available, (await none.list()).length, await none.get('x')];
      await none.put(a);   // a no-op, never a throw
      let refused = '';
      try { await L.readDocFile(new File(['{"format":"x"}'], 'x.json')); } catch (e) { refused = e.message; }
      return {available: lib.available, names, same: JSON.stringify(got) === JSON.stringify(a),
              renamed, after, off, refused};
    }""")
    want = {"available": True, "names": ["Beta", "Alpha"], "same": True, "renamed": "Alpha 3",
            "after": ["Alpha 3"], "off": [False, 0, None], "refused": "This is not a Portrayal rack file."}
    for k, v in want.items():
        if r.get(k) != v:
            bad.append(f"library: {k} is {r.get(k)!r}, expected {v!r}")
    return bad
```

Run: `python3 check-browser.py --only check_rack_library`
Expected: FAIL, because `/site/rack/library.js` is not found.

- [ ] **Step 2: Implement `site/rack/library.js`**

```js
// THE RACK LIBRARY (spec §7.5): named racks in this browser's IndexedDB, not
// localStorage - a library of racks with their Explorer changes (and, later,
// cables) can outgrow localStorage's ~5 MB. Documents go in as the §5 file
// plus `updatedAt`, and come back through parseDoc, so a stored document is
// read exactly as an opened file is.
//
// NO INDEXEDDB (a private window, blocked storage): the library is off, every
// method is a no-op, and the page says so - Save and Open still work.

import {parseDoc, serialize} from './model.js';

const DB = 'portrayal-racks', STORE = 'docs';
const done = req => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

export async function openLibrary({idb = globalThis.indexedDB} = {}) {
  let db = null;
  try {
    if (idb) {
      const open = idb.open(DB, 1);
      open.onupgradeneeded = () => open.result.createObjectStore(STORE, {keyPath: 'id'});
      db = await done(open);
    }
  } catch (err) {
    console.warn('[portrayal] the rack library is unavailable', err);
    db = null;
  }
  const store = mode => db.transaction(STORE, mode).objectStore(STORE);
  return {
    available: !!db,
    async list() {
      if (!db) return [];
      const all = await done(store('readonly').getAll());
      return all.map(d => ({id: d.id, name: d.racks?.[0]?.name ?? 'Rack', updatedAt: d.updatedAt ?? 0}))
                .sort((a, b) => b.updatedAt - a.updatedAt);
    },
    async get(id) {
      if (!db) return null;
      const d = await done(store('readonly').get(id));
      return d ? parseDoc(d) : null;
    },
    async put(doc) {
      if (!db) return;
      await done(store('readwrite').put({...JSON.parse(serialize(doc)), updatedAt: Date.now()}));
    },
    async remove(id) {
      if (!db) return;
      await done(store('readwrite').delete(id));
    },
  };
}

// The last of a burst of edits is written, once, `delay` ms after it.
export function autosaver(lib, delay = 500) {
  let timer = null, pending = null, last = Promise.resolve();
  const flush = () => {
    clearTimeout(timer); timer = null;
    if (pending) {
      const doc = pending; pending = null;
      last = lib.put(doc).catch(err => console.warn('[portrayal] autosave', err));
    }
    return last;
  };
  return {saveSoon(doc) { pending = doc; clearTimeout(timer); timer = setTimeout(flush, delay); }, flush};
}

const fileName = doc => `${(doc.racks[0]?.name || 'rack').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-|-$/g, '') || 'rack'}.rack.json`;

export function downloadDoc(doc) {
  const url = URL.createObjectURL(new Blob([serialize(doc)], {type: 'application/json'}));
  const a = Object.assign(document.createElement('a'), {href: url, download: fileName(doc)});
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const readDocFile = async file => parseDoc(await file.text());
```

- [ ] **Step 3: Run the check and confirm it passes**

Run: `python3 check-browser.py --only check_rack_library`
Expected: ok.

- [ ] **Step 4: Commit**

```bash
git add site/rack/library.js check-browser.py
git commit -m "rack: the library - named racks in IndexedDB, autosave, .json in and out

Off, not broken, without IndexedDB; a stored document is read back through
parseDoc exactly as an opened file is.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The Explorer lens, with optic fields

**Files:**
- Modify: `explorer.html` (`window.portrayalEmbed.current()` also returns `fields`)
- Create: `site/rack/explorer-lens.js`
- Modify: `check-browser.py` (add `check_rack_lens`; extend `check_embed` to expect `fields`)

**Interfaces:**
- Consumes: `encodeSwaps` (`vendor/swap.js`), `encodeFields` (`site/optics.js`), `el` (Task 6).
- Produces:
  - `openLens({ref, cfg, view='front', swaps={}, fields={}, title=ref, host=document.body}) → Promise<{device, config, swaps, fields} | null>`.
    - It shows a modal overlay `.rk-lens`, holding a bar with the title, a status line and a `.rk-lens-done` button, above an Explorer iframe.
    - It resolves when Done is pressed or Escape is hit on the parent page.
    - It resolves `null` when Explorer never became ready, or reported another device.
  - `current().fields`: `fieldsNow(shell)`, or `{}` before a device has loaded.

- [ ] **Step 1: Write the failing check**

In `check_embed`, after the existing `cur.get("device")` assertion, add:

```python
        if not isinstance(cur.get("fields"), dict):
            bad.append(f"embed: current().fields is {cur.get('fields')!r}, expected a dict")
```

Add the new check:

```python
@extra("the Explorer lens opens a device with its swaps and fields, and hands them back")
def check_rack_lens(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    page.goto(f"{base}/index.html", wait_until="load")
    page.evaluate("""() => { window.__lens = import('/site/rack/explorer-lens.js').then(L =>
      L.openLens({ref: 'as7726-32x', cfg: 'ac-f2b', title: 'AS7726',
                  swaps: {'port-1': 'generic/qsfp-lc@2'},
                  fields: {'port-1-occupant': {label: 'LENS-1'}}})); }""")
    page.wait_for_selector(".rk-lens iframe", timeout=READY_MS)
    page.wait_for_function("""async () => {
      const w = document.querySelector('.rk-lens iframe')?.contentWindow;
      if (!w?.portrayalEmbed) return false;
      await w.portrayalEmbed.ready; return true; }""", timeout=READY_MS)
    page.click(".rk-lens-done")
    r = page.evaluate("async () => await window.__lens")
    if not r:
        bad.append("lens: resolved null")
    else:
        if r.get("device") != "as7726-32x":
            bad.append(f"lens: device {r.get('device')!r}")
        if r.get("swaps", {}).get("port-1") != "generic/qsfp-lc@2":
            bad.append(f"lens: swaps {r.get('swaps')!r}")
        if r.get("fields", {}).get("port-1-occupant", {}).get("label") != "LENS-1":
            bad.append(f"lens: fields {r.get('fields')!r}")
    if page.query_selector(".rk-lens"):
        bad.append("lens: the overlay is still open after Done")
    return bad
```

Run: `python3 check-browser.py --only check_rack_lens`
Expected: FAIL, because `/site/rack/explorer-lens.js` is not found.

- [ ] **Step 2: `explorer.html` returns fields**

In the `if (EMBED) { … window.portrayalEmbed = Object.freeze({ … current: () => ({ … }) }) }` block, add this line after `swaps: …`:

```js
      fields: state.device ? fieldsNow(shell) : {},
```

Also add `fields` to the comment above the block, in the list of what `current()` reports. `fieldsNow` is already imported from `./site/optics.js`.

- [ ] **Step 3: Implement `site/rack/explorer-lens.js`**

```js
// A DEVICE, OPENED IN EXPLORER, OVER THE RACK. The builder's version of the
// showcase's Inspect lens (spoke-host.js openFrame/readBack), without the
// stage rail: Explorer in an iframe (?embed=1) loaded with the item's swaps
// and fields, and on Done whatever Explorer now says about that device comes
// back - its configuration, swaps and fields. A lens that never became ready,
// or that reports a different device, hands back nothing: those are not this
// item's to write.

import {encodeSwaps} from '../../vendor/swap.js';
import {encodeFields} from '../optics.js';
import {el} from './dom.js';

export function openLens({ref, cfg, view = 'front', swaps = {}, fields = {}, title = ref,
                          host = document.body}) {
  return new Promise(resolve => {
    const q = new URLSearchParams({embed: '1', device: ref, config: cfg, view});
    const sw = encodeSwaps(swaps), fd = encodeFields(fields);
    // swap= and fields= carry their own escaping, so they are appended, not set.
    const frame = el('iframe', {title: `${title} in Explorer`,
      src: `explorer.html?${q}${sw ? `&swap=${sw}` : ''}${fd ? `&fields=${fd}` : ''}`});
    const status = el('span', {class: 'rk-lens-status', role: 'status', text: `Opening ${title} in Explorer…`});
    const done = el('button', {type: 'button', class: 'rk-lens-done', text: 'Done'});
    const box = el('div', {class: 'rk-lens', role: 'dialog', 'aria-modal': 'true',
                           'aria-label': `${title} in Explorer`},
      [el('div', {class: 'rk-lens-bar'}, [el('strong', {text: title}), status, done]), frame]);
    let api = null;
    // EVERY load, not the first: if the frame reloads, the API the first load
    // exposed belongs to a dead window.
    frame.addEventListener('load', async () => {
      try {
        api = frame.contentWindow?.portrayalEmbed || null;
        if (!api) throw new Error('explorer.html did not expose portrayalEmbed');
        await api.ready;
        status.textContent = 'Changes you make here come back to the rack when you press Done.';
      } catch (err) {
        console.warn('[portrayal] Explorer lens', err);
        api = null;
        status.textContent = `${title} could not be opened in Explorer.`;
      }
    });
    const onKey = e => { if (e.key === 'Escape') close(); };
    function close() {
      let cur = null;
      // Read from the window the frame shows NOW - the live one, whatever loaded last.
      const live = frame.contentWindow?.portrayalEmbed || api;
      try { cur = live?.current?.() ?? null; } catch (err) { console.warn('[portrayal] reading the lens back', err); }
      document.removeEventListener('keydown', onKey);
      box.remove();
      resolve(cur && cur.device === ref
        ? {device: cur.device, config: cur.config, swaps: {...(cur.swaps || {})},
           fields: structuredClone(cur.fields || {})}
        : null);
    }
    done.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    host.append(box);
    done.focus();
  });
}
```

The overlay's CSS is in Task 9's `rack.css`. Until then the lens is unstyled but works, which is all this task's check needs.

- [ ] **Step 4: Run the checks and confirm they pass**

Run: `python3 check-browser.py --only check_rack_lens`
Expected: ok.

Run: `python3 check-browser.py`
Expected: everything passes, including `explorer embed mode` with its new `fields` assertion.

- [ ] **Step 5: Commit**

```bash
git add explorer.html site/rack/explorer-lens.js check-browser.py
git commit -m "rack: the Explorer lens, and Explorer's embed reports optic fields too

openLens opens a device with its swaps and fields over the page and hands
back its configuration, swaps and fields on Done - nothing when Explorer
never became ready or names another device.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The page (`rack.html`): frame, library, both faces, and the nav

**Files:**
- Create: `rack.html`, `site/rack/rack.css`, `site/rack-page.js`, `site/rack/frame-form.js`
- Modify: the nav in `drawings.html`, `explorer.html`, `components.html`, `schema.html`, `annotate.html`, `drawio.html` and `exporter.html`, plus `index.html`'s masthead (line 49) and footer (line 476); `check-browser.py` (`PAGES` gains `rack.html`; add `check_rack_page`); `check-contract.py` (every nav links the Rack Builder)

**Interfaces:**
- Consumes: Tasks 2–8.
- Produces:
  - `rack-page.js` state: `S = {doc, sel, lib, save, devices, draws}`.
    - `sel` is one of `null`, `{kind: 'frame'}`, `{kind: 'u', face, ru}`, `{kind: 'item', id}` or `{kind: 'move', id}`.
    - `commit(nextRack)` replaces the rack, autosaves and re-renders.
    - `select(sel)` re-renders.
    - `renderSide()` dispatches on `sel.kind`. Tasks 10 and 11 replace its `'u'` and `'item'` branches.
  - With `?probe=1`: `window.__rack = {ready, doc: () => S.doc, flush: () => S.save.flush()}`.
  - `frame-form.js`: `frameForm({rack, maxTop, onName, onFrame}) → HTMLElement`, where `onFrame(patch)` is called with a partial frame.

- [ ] **Step 1: Write the failing checks**

Add `"rack.html"` to `PAGES` in `check-browser.py`. Then:

```python
@extra("rack.html: a 42U four-post rack on first open, frame edits redraw and survive a reload")
def check_rack_page(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    page.goto(f"{base}/rack.html?probe=1", wait_until="load")
    page.wait_for_function("() => window.__rack && window.__rack.ready", timeout=READY_MS)
    page.evaluate("() => window.__rack.ready")
    counts = lambda: page.evaluate("""() => ['front', 'rear'].map(f =>
      document.querySelectorAll(`svg[data-pane="${f}"] rect.rk-u`).length)""")
    if counts() != [42, 42]:
        bad.append(f"rack page: U targets {counts()}, expected [42, 42]")
    page.click("#frameBtn")
    page.fill("#fHeight", "24")
    page.dispatch_event("#fHeight", "change")
    # The side panel is redrawn after each change: wait for it, then the next control.
    page.wait_for_function("""() => document.querySelectorAll('svg[data-pane="front"] rect.rk-u').length === 24""",
                           timeout=READY_MS)
    page.select_option("#fHoles", "tapped")
    page.wait_for_function("""() => document.querySelector('svg[data-pane="front"] circle[data-rail-hole]')""",
                           timeout=READY_MS)
    page.evaluate("() => window.__rack.flush()")
    page.reload(wait_until="load")
    page.wait_for_function("() => window.__rack && window.__rack.ready", timeout=READY_MS)
    page.evaluate("() => window.__rack.ready")
    if counts() != [24, 24]:
        bad.append(f"rack page: after reload U targets {counts()}, expected [24, 24]")
    if not page.query_selector('svg[data-pane="rear"] circle[data-rail-hole]'):
        bad.append("rack page: tapped holes did not survive the reload")
    if page.get_attribute('.site-bar a[href="rack.html"]', "aria-current") != "page":
        bad.append("rack page: the nav does not mark Rack Builder as the current page")
    return bad
```

In `check-contract.py`, above `# ── report`, add:

```python
# ── every nav names the Rack Builder ───────────────────────────────────────
for page_name in ("drawings.html", "explorer.html", "components.html", "schema.html",
                  "annotate.html", "drawio.html", "exporter.html", "index.html", "rack.html"):
    p = HERE / page_name
    check(p.is_file() and 'href="rack.html"' in p.read_text(),
          f"{page_name} links the Rack Builder", "the nav is copied by hand; add it there")
```

Run: `python3 check-contract.py`, then `python3 check-browser.py --only check_rack_page`
Expected: both fail. The contract reports `explorer.html links the Rack Builder` and the others; the browser check fails on a 404 for `rack.html`.

- [ ] **Step 2: Add the nav link everywhere**

In each of the seven tool pages' `.site-bar nav`, directly after `<a href="explorer.html" …>Explorer</a>`, add:

```html
    <a href="rack.html">Rack Builder</a>
```

In `index.html`:
- after the masthead's `<a href="explorer.html">Explorer</a>` (line 49), add `<a href="rack.html">Rack Builder</a>`;
- in the footer, after `<a href="explorer.html">Explorer</a> ·` (line 476), add `<a href="rack.html">Rack Builder</a> ·`.

- [ ] **Step 3: Create `rack.html`**

Copy `explorer.html` lines 1–27 (the head) with these changes:
- `<title>Portrayal — rack builder</title>`, and the same title in `og:title` and `twitter:title`;
- description, `og:description` and `twitter:description` set to "Build a rack elevation from Portrayal's devices: place them by RU, front and rear, open any one in Explorer, and keep your racks in this browser.";
- `og:url` set to `https://portrayal.dev/rack.html`;
- the explorer-only `<style>` block and its importmap dropped;
- `<link rel="stylesheet" href="site/rack/rack.css">` added after `tool-theme.css`.

Then the body:

```html
<body class="tool">

<div class="site-bar">
  <a class="brand" href="index.html">
    <img src="brand/portrayal-mark.svg" alt="" width="20" height="20">
    <span>portrayal<span class="tld">.dev</span></span>
  </a>
  <nav>
    <a href="index.html#showcase">Showcase</a>
    <a href="explorer.html">Explorer</a>
    <a href="rack.html" aria-current="page">Rack Builder</a>
    <a href="components.html">Components</a>
    <a href="annotate.html">Annotate</a>
    <details class="navmenu">
      <summary>Export</summary>
      <div class="navmenu-items">
        <a href="exporter.html">DCIM export<span class="hint">NetBox &amp; Nautobot device types</span></a>
        <a href="drawio.html">draw.io export<span class="hint">shape library and rack elevations</span></a>
        <a href="drawio.html#omnigraffle">OmniGraffle export<span class="hint">stencils with named ports</span></a>
        <a href="drawings.html">Drawings<span class="hint">the compiled SVGs, as a zip</span></a>
      </div>
    </details>
    <a href="schema.html">Schema</a>
    <a href="https://github.com/roc-ops/Portrayal">GitHub</a>
  </nav>
</div>

<div class="fill rk">
  <div class="rk-bar">
    <details class="rk-menu" id="libMenu">
      <summary id="rackName">Rack</summary>
      <div class="rk-menu-items" id="libItems"></div>
    </details>
    <button type="button" id="frameBtn">Frame</button>
    <span class="rk-note" id="libNote" hidden>This browser isn't keeping a library, so use Save and Open.</span>
  </div>
  <div class="rk-main">
    <div class="rk-panes">
      <section class="rk-pane"><h2 id="headFront">Front</h2><div id="paneFront"></div></section>
      <section class="rk-pane"><h2 id="headRear">Rear</h2><div id="paneRear"></div></section>
    </div>
    <aside class="rk-side" id="side" aria-live="polite"></aside>
  </div>
</div>
<input type="file" id="openFile" accept=".json,application/json" hidden>

<script type="module" src="site/rack-page.js"></script>
</body>
</html>
```

Before saving, compare the nav block with `explorer.html`'s and keep it identical, except for the two `aria-current` changes.

- [ ] **Step 4: Create `site/rack/rack.css`**

```css
/* The Rack Builder: two faces side by side, one scroll, and a side panel. */
.rk { background: var(--pt-ground); color: var(--pt-ink); }
.rk-bar { display: flex; gap: 0.6rem; align-items: center; padding: 0.5rem 1rem;
          border-bottom: 1px solid var(--pt-line); background: var(--pt-surface); }
.rk-bar button, .rk-side button, .rk-lens button { background: var(--pt-surface-2); color: var(--pt-ink);
  border: 1px solid var(--pt-line); border-radius: 6px; padding: 0.3rem 0.7rem; cursor: pointer; font: inherit; }
.rk-bar button:hover, .rk-side button:hover { border-color: var(--pt-brass); }
.rk-note { color: var(--pt-warn); font-size: 0.85rem; }
.rk-menu { position: relative; }
.rk-menu > summary { list-style: none; cursor: pointer; font-weight: 600; padding: 0.3rem 0.6rem;
  border: 1px solid var(--pt-line); border-radius: 6px; background: var(--pt-surface-2); }
.rk-menu > summary::after { content: ' ▾'; color: var(--pt-ink-muted); }
.rk-menu-items { position: absolute; z-index: 5; top: calc(100% + 4px); left: 0; min-width: 16rem;
  background: var(--pt-surface); border: 1px solid var(--pt-line); border-radius: 8px; padding: 0.4rem;
  display: flex; flex-direction: column; gap: 0.15rem; }
.rk-menu-items button { text-align: left; border: none; background: none; }
.rk-menu-items button:hover { background: var(--pt-surface-2); }
.rk-menu-items hr { border: none; border-top: 1px solid var(--pt-line); margin: 0.3rem 0; width: 100%; }
.rk-menu-items .rk-current { color: var(--pt-brass); }
.rk-main { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 20rem; }
.rk-panes { overflow: auto; display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; padding: 1rem 1.5rem; }
.rk-pane h2 { margin: 0 0 0.5rem; font-size: 0.9rem; font-weight: 600; color: var(--pt-ink-muted);
  text-transform: uppercase; letter-spacing: 0.06em; }
.rk-pane svg { width: 100%; height: auto; display: block; }
.rk-u { cursor: pointer; }
.rk-u:hover { fill: var(--pt-brass); fill-opacity: 0.12; }
.rk-u-selected { fill: var(--pt-brass); fill-opacity: 0.22; }
[data-item-id] { cursor: pointer; }
[data-panel="ghost"] { cursor: default; }
[data-panel="through"] { opacity: 0.9; }
.rk-side { border-left: 1px solid var(--pt-line); background: var(--pt-surface); overflow: auto; padding: 1rem; }
.rk-side h3 { margin: 0 0 0.6rem; font-size: 1rem; }
.rk-side label { display: flex; flex-direction: column; gap: 0.2rem; margin: 0 0 0.6rem; font-size: 0.85rem;
  color: var(--pt-ink-muted); }
.rk-side input, .rk-side select { font: inherit; color: var(--pt-ink); background: var(--pt-surface-2);
  border: 1px solid var(--pt-line); border-radius: 6px; padding: 0.3rem 0.4rem; }
.rk-side .rk-error { color: var(--pt-warn); font-size: 0.85rem; min-height: 1.2em; }
.rk-side .rk-muted { color: var(--pt-ink-muted); font-size: 0.85rem; }
.rk-lens { position: fixed; inset: 3vh 3vw; z-index: 20; display: flex; flex-direction: column;
  background: var(--pt-surface); border: 1px solid var(--pt-line); border-radius: 10px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.45); overflow: hidden; }
.rk-lens-bar { display: flex; gap: 0.8rem; align-items: center; padding: 0.5rem 0.8rem;
  border-bottom: 1px solid var(--pt-line); }
.rk-lens-status { color: var(--pt-ink-muted); font-size: 0.85rem; flex: 1; }
.rk-lens iframe { flex: 1; border: 0; width: 100%; }
@media (max-width: 900px) {
  .rk-main { grid-template-columns: 1fr; grid-template-rows: minmax(0, 1fr) auto; }
  .rk-side { border-left: none; border-top: 1px solid var(--pt-line); max-height: 45vh; }
}
```

- [ ] **Step 5: Create `site/rack/frame-form.js`**

```js
// THE FRAME, as a form (spec §5.1). The page decides what a change means;
// this only reports it. Lowering the rack below its highest device is refused
// here, with the reason, because the page would otherwise have to undo it.

import {el} from './dom.js';
import {THREADS} from './model.js';

const option = (value, text, current) =>
  el('option', {value, text, ...(String(current) === String(value) ? {selected: ''} : {})});

export function frameForm({rack, maxTop, onName, onFrame}) {
  const f = rack.frame;
  const err = el('p', {class: 'rk-error', role: 'alert'});
  const field = (label, control) => el('label', {}, [label, control]);
  const num = (id, value, min) => el('input', {id, type: 'number', min: String(min), step: '1', value: String(value)});

  const name = el('input', {id: 'fName', type: 'text', value: rack.name});
  name.addEventListener('change', () => onName(name.value.trim() || 'Rack'));

  const kind = el('select', {id: 'fKind'}, [option('four-post', 'Four-post', f.kind), option('two-post', 'Two-post', f.kind)]);
  kind.addEventListener('change', () => onFrame({kind: kind.value}));

  const height = num('fHeight', f.heightRU, 1);
  height.addEventListener('change', () => {
    const n = Math.round(Number(height.value));
    if (!(n >= 1)) { err.textContent = 'Enter a height of 1U or more.'; return; }
    if (n < maxTop) { err.textContent = `Devices reach U${maxTop}. Move them down before lowering the rack to ${n}U.`; height.value = String(f.heightRU); return; }
    err.textContent = '';
    onFrame({heightRU: n});
  });

  const numbering = el('select', {id: 'fNumbering'},
    [option('bottom-up', 'U1 at the bottom', f.numbering), option('top-down', 'U1 at the top', f.numbering)]);
  numbering.addEventListener('change', () => onFrame({numbering: numbering.value}));

  const holes = el('select', {id: 'fHoles'},
    [option('square', 'Square (cage nuts)', f.holes.style), option('tapped', 'Tapped (round)', f.holes.style)]);
  holes.addEventListener('change', () => onFrame({holes: {style: holes.value, thread: f.holes.thread}}));

  const thread = el('select', {id: 'fThread'},
    [option('', 'Not stated', f.holes.thread ?? ''), ...THREADS.map(t => option(t, t, f.holes.thread))]);
  thread.addEventListener('change', () => onFrame({holes: {style: 'tapped', thread: thread.value || null}}));

  const rail = num('fRail', f.railDepth ?? 740, 1);
  rail.addEventListener('change', () => { const n = Number(rail.value); if (n > 0) onFrame({railDepth: n}); });
  const usable = num('fUsable', f.usableDepth, 1);
  usable.addEventListener('change', () => { const n = Number(usable.value); if (n > 0) onFrame({usableDepth: n}); });

  return el('div', {class: 'rk-frame'}, [
    el('h3', {text: 'Frame'}),
    field('Name', name),
    field('Frame', kind),
    field('Height (U)', height),
    field('U numbering', numbering),
    field('Rail holes', holes),
    ...(f.holes.style === 'tapped' ? [field('Thread', thread)] : []),
    ...(f.kind === 'four-post' ? [field('Front-to-rear rail depth (mm)', rail)] : []),
    field('Usable depth from the front rail (mm)', usable),
    err,
  ]);
}
```

- [ ] **Step 6: Create `site/rack-page.js`**

```js
// THE RACK BUILDER PAGE: wiring only. The rack lives in S.doc; every change
// goes through commit(), which autosaves and redraws. What the side panel
// shows follows S.sel.

import {newDoc, withFrame, renamed, uLabel} from './rack/model.js';
import {openLibrary, autosaver, downloadDoc, readDocFile} from './rack/library.js';
import {drawElevation} from './rack/elevation.js';
import {reaches, fits} from './rack/fit.js';
import {loadChassis, chassisLookup} from './rack/chassis.js';
import {frameForm} from './rack/frame-form.js';
import {el} from './rack/dom.js';

const $ = id => document.getElementById(id);
const LAST = 'portrayal.rack.last';
const S = {doc: null, sel: null, lib: null, save: null, devices: {}, draws: 0};
let chassisOf = () => null;
const rack = () => S.doc.racks[0];
const itemById = id => rack().items.find(i => i.id === id) || null;
const topOf = r => Math.max(0, ...r.items.map(i => i.ru + Math.max(1, chassisOf(i.ref)?.ru ?? 1) - 1));

function commit(nextRack) {
  S.doc = {...S.doc, racks: [nextRack]};
  S.save.saveSoon(S.doc);
  render();
}
function select(sel) { S.sel = sel; render(); }
function setDoc(doc) {
  S.doc = doc; S.sel = null;
  try { localStorage.setItem(LAST, doc.id); } catch { /* a convenience, not state */ }
  render();
  renderLibrary();
}

async function render() {
  const mine = ++S.draws;
  const r = rack();
  $('rackName').textContent = r.name;
  const holes = r.frame.holes.style === 'tapped'
    ? `tapped${r.frame.holes.thread ? ` ${r.frame.holes.thread}` : ''}` : 'square holes';
  $('headFront').textContent = `Front · ${r.frame.heightRU}U ${r.frame.kind} · ${holes}`;
  $('headRear').textContent = 'Rear';
  const items = r.items.map(i => ({...i, u: Math.max(1, chassisOf(i.ref)?.ru ?? 1)}));
  const selectedId = S.sel?.kind === 'item' || S.sel?.kind === 'move' ? S.sel.id : null;
  const [front, rear] = await Promise.all(['front', 'rear'].map(view => drawElevation({
    items, frame: r.frame, view, hitTargets: true, selectedId,
    selectedU: S.sel?.kind === 'u' && S.sel.face === view ? S.sel.ru : null,
    reaches: it => reaches(it, r, chassisOf)})));
  if (mine !== S.draws) return;
  $('paneFront').replaceChildren(front);
  $('paneRear').replaceChildren(rear);
  renderSide();
}

function summary() {
  const r = rack();
  const used = r.items.reduce((n, i) => n + Math.max(1, chassisOf(i.ref)?.ru ?? 1), 0);
  const warnings = r.items
    .map(i => ({i, f: fits(r, {ref: i.ref, ru: i.ru, face: i.face}, chassisOf, {ignoreId: i.id})}))
    .filter(x => !x.f.ok);
  return el('div', {}, [
    el('h3', {text: r.name}),
    el('p', {class: 'rk-muted', text: `${r.items.length} devices · ${used}U used on the rails.`}),
    ...warnings.map(({i, f}) => el('p', {class: 'rk-error', text: `${i.label} at U${uLabel(r.frame, i.ru)}: ${f.reason}`})),
    el('p', {class: 'rk-muted', text: 'Click an empty U on either face to place a device there.'}),
  ]);
}

// Tasks 10 and 11 replace the 'u' and 'item' branches.
function renderSide() {
  const r = rack(), sel = S.sel;
  let body;
  if (!sel) body = summary();
  else if (sel.kind === 'frame') body = frameForm({rack: r, maxTop: topOf(r),
    onName: name => commit(renamed(r, name)), onFrame: patch => commit(withFrame(r, patch))});
  else if (sel.kind === 'u') body = el('h3', {text: `U${uLabel(r.frame, sel.ru)} · ${sel.face}, empty`});
  else body = el('h3', {text: itemById(sel.id)?.label ?? 'Device'});
  $('side').replaceChildren(body);
}

function onPaneClick(ev) {
  const hit = ev.target.closest('[data-item-id]');
  if (hit) return select({kind: 'item', id: hit.dataset.itemId});
  const u = ev.target.closest('[data-u]');
  if (u) return select({kind: 'u', face: u.dataset.face, ru: Number(u.dataset.u)});
}

let libDraws = 0;
async function renderLibrary() {
  const mine = ++libDraws;
  const items = $('libItems');
  const act = (text, fn) => { const b = el('button', {type: 'button', text}); b.addEventListener('click', () => { $('libMenu').open = false; fn(); }); return b; };
  const kids = [
    act('New rack', async () => { const d = newDoc({name: `Rack ${(await S.lib.list()).length + 1}`}); await S.lib.put(d); setDoc(d); }),
    act('Duplicate', async () => { const d = {...structuredClone(S.doc), id: newDoc().id}; d.racks[0].name = `${rack().name} copy`; await S.lib.put(d); setDoc(d); }),
    act('Rename…', () => { const n = prompt('Rack name', rack().name); if (n && n.trim()) commit(renamed(rack(), n.trim())); }),
    act('Delete…', async () => {
      if (!confirm(`Delete ${rack().name} from this browser? This can't be undone.`)) return;
      await S.lib.remove(S.doc.id);
      const next = (await S.lib.list())[0];
      setDoc(next ? await S.lib.get(next.id) : await (async () => { const d = newDoc(); await S.lib.put(d); return d; })());
    }),
    el('hr'),
    act('Save as .json', () => downloadDoc(S.doc)),
    act('Open .json…', () => $('openFile').click()),
  ];
  // The actions at once, so they are never rebuilt under a click; the list of
  // racks after it is read, and only by the newest render.
  items.replaceChildren(...kids);
  const list = await S.lib.list();
  if (mine !== libDraws || !list.length) return;
  items.append(el('hr'), ...list.map(d => {
    const b = act(d.name, async () => setDoc(await S.lib.get(d.id)));
    if (d.id === S.doc.id) b.classList.add('rk-current');
    return b;
  }));
}

async function boot() {
  S.devices = await loadChassis();
  chassisOf = chassisLookup(S.devices);
  S.lib = await openLibrary();
  S.save = autosaver(S.lib);
  $('libNote').hidden = S.lib.available;
  let doc = null;
  try { const last = localStorage.getItem(LAST); if (last) doc = await S.lib.get(last); } catch { /* none */ }
  if (!doc) { const first = (await S.lib.list())[0]; if (first) doc = await S.lib.get(first.id); }
  if (!doc) { doc = newDoc(); await S.lib.put(doc); }
  $('paneFront').addEventListener('click', onPaneClick);
  $('paneRear').addEventListener('click', onPaneClick);
  $('frameBtn').addEventListener('click', () => select(S.sel?.kind === 'frame' ? null : {kind: 'frame'}));
  $('libMenu').addEventListener('toggle', () => { if ($('libMenu').open) renderLibrary(); });
  $('openFile').addEventListener('change', async () => {
    const file = $('openFile').files[0]; $('openFile').value = '';
    if (!file) return;
    try { const d = await readDocFile(file); await S.lib.put(d); setDoc(d); }
    catch (err) { $('side').replaceChildren(el('p', {class: 'rk-error', role: 'alert', text: err.message})); }
  });
  window.addEventListener('pagehide', () => S.save.flush());
  setDoc(doc);
}

const ready = boot();
if (new URLSearchParams(location.search).get('probe') === '1') {
  window.__rack = {ready, doc: () => S.doc, flush: () => S.save.flush()};
}
```

Test hooks behind `?probe=1` follow the showcase's `?patchprobe=1` convention.

- [ ] **Step 7: Run the checks**

Run: `python3 check-contract.py && python3 check-browser.py --only check_rack_page`
Expected: both pass.

Run: `python3 check-browser.py`
Expected: everything passes. `rack.html` loads in the page sweep with no 404s and no uncaught errors.

Then open `http://localhost:8932/rack.html` and check each of these:
- there are two empty 42U four-post panes;
- **Frame** opens the form in the side panel;
- switching to two-post hides the rail-depth field;
- tapped holes draw round, and a thread can be chosen;
- the rack name menu can create, rename, duplicate and switch racks;
- **Save as .json** downloads a file that **Open .json…** reads back.

- [ ] **Step 8: Commit**

```bash
git add rack.html site/rack/rack.css site/rack-page.js site/rack/frame-form.js drawings.html explorer.html components.html schema.html annotate.html drawio.html exporter.html index.html check-browser.py check-contract.py
git commit -m "rack: rack.html - the frame, the library, both faces, and a place in the nav

Front and rear side by side in one scroll, the frame as a form in the side
panel, the rack's name as the library menu (new, duplicate, rename, delete,
save and open .json), autosaved to IndexedDB.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Place a device from the catalog

**Files:**
- Create: `site/rack/catalog.js`
- Modify: `site/rack-page.js` (the `'u'` branch of `renderSide`, and a `place` function)
- Modify: `check-browser.py` (add `check_rack_place`)

**Interfaces:**
- Consumes: `catalogEntries` (Task 4), `fits` (Task 3), `withItem` (Task 2).
- Produces: `catalogPanel({entries, rack, face, ru, chassisOf, query='', onQuery, onPick}) → HTMLElement`.
  - Rows are `<button class="rk-cat" data-ref>` holding the model and `NU · D mm`.
  - A device that doesn't fit gets `aria-disabled="true"` and the class `rk-no`, and shows its reason in `<span class="rk-why">`.
  - Zero-U entries (`ru === 0`) are left out, since they don't go on rails.
  - `onPick(entry)` is called only for a device that fits.

- [ ] **Step 1: Write the failing check**

```python
@extra("rack.html: place from the catalog; both faces show it; a device that won't fit says why")
def check_rack_place(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    page.goto(f"{base}/rack.html?probe=1", wait_until="load")
    page.wait_for_function("() => window.__rack && window.__rack.ready", timeout=READY_MS)
    page.evaluate("() => window.__rack.ready")
    # A fresh, empty rack, whatever an earlier check left in this browser.
    page.click("#libMenu > summary"); page.click("#libItems button:has-text('New rack')")
    page.wait_for_function("() => window.__rack.doc().racks[0].items.length === 0")

    def place(face, u, query, ref):
        page.click(f'svg[data-pane="{face}"] rect.rk-u[data-u="{u}"]')
        page.fill("#catQuery", query)
        page.click(f'.rk-cat[data-ref="{ref}"]:not([aria-disabled="true"])')

    place("front", 10, "R740", "r740xd")
    page.wait_for_selector('svg[data-pane="front"] [data-device-ref="r740xd"][data-panel="mounted"]', timeout=READY_MS)
    page.wait_for_selector('svg[data-pane="rear"] [data-device-ref="r740xd"][data-panel="through"]', timeout=READY_MS)
    place("front", 20, "AS7726", "as7726-32x")
    page.wait_for_selector('svg[data-pane="rear"] [data-device-ref="as7726-32x"][data-panel="ghost"]', timeout=READY_MS)
    # Behind the switch: the patch panel is too deep, the TM-280 fits.
    page.click('svg[data-pane="rear"] rect.rk-u[data-u="20"]')
    page.fill("#catQuery", "FHD")
    why = page.text_content('.rk-cat[data-ref="fhd-1ufce"] .rk-why') or ""
    if "mm free behind" not in why:
        bad.append(f"place: the FHD-1UFCE's reason is {why!r}, expected a depth reason")
    page.fill("#catQuery", "TM-280")
    page.click('.rk-cat[data-ref="tm-280"]:not([aria-disabled="true"])')
    page.wait_for_selector('svg[data-pane="rear"] [data-device-ref="tm-280"][data-panel="mounted"]', timeout=READY_MS)
    doc = page.evaluate("() => window.__rack.doc()")
    got = [(i["ref"], i["ru"], i["face"], i["cfg"]) for i in doc["racks"][0]["items"]]
    want = [("r740xd", 10, "front", "sff24-rc5-1b2a3a"), ("as7726-32x", 20, "front", "ac-f2b"),
            ("tm-280", 20, "rear", doc["racks"][0]["items"][2]["cfg"])]
    if got != want:
        bad.append(f"place: items {got}, expected {want}")
    return bad
```

Run: `python3 check-browser.py --only check_rack_place`
Expected: FAIL, a timeout waiting for `#catQuery`.

- [ ] **Step 2: Create `site/rack/catalog.js`**

```js
// AN EMPTY U, AND WHAT COULD GO THERE (spec §7.2). The whole catalog,
// searchable; a device that will not fit here is grayed out with the reason
// fit.js gives, rather than hidden - "why can't I put the ASR here?" is
// answered on the row, not left to guesswork.

import {el} from './dom.js';
import {fits} from './fit.js';
import {uLabel} from './model.js';

const hay = e => `${e.manufacturer ?? ''} ${e.model ?? ''} ${e.family ?? ''} ${e.name}`.toLowerCase();

export function catalogPanel({entries, rack, face, ru, chassisOf, query = '', onQuery, onPick}) {
  const input = el('input', {id: 'catQuery', type: 'search', placeholder: 'R740xd, 400G, patch panel',
                             value: query, 'aria-label': 'Search devices'});
  const list = el('div', {class: 'rk-cat-list'});
  const draw = q => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    list.replaceChildren(...entries
      .filter(e => e.ru !== 0 && words.every(w => hay(e).includes(w)))
      .map(e => {
        const f = fits(rack, {ref: e.name, ru, face}, chassisOf);
        const b = el('button', {type: 'button', class: f.ok ? 'rk-cat' : 'rk-cat rk-no', 'data-ref': e.name,
                                ...(f.ok ? {} : {'aria-disabled': 'true'})}, [
          el('span', {class: 'rk-cat-name', text: `${e.manufacturer ?? ''} ${e.model}`.trim()}),
          el('span', {class: 'rk-muted', text: ` ${e.ru}U · ${Math.round(e.d ?? 0)} mm`}),
          ...(f.ok ? [] : [el('span', {class: 'rk-why', text: f.reason})]),
        ]);
        if (f.ok) b.addEventListener('click', () => onPick(e));
        return b;
      }));
  };
  input.addEventListener('input', () => { onQuery?.(input.value); draw(input.value); });
  draw(query);
  queueMicrotask(() => input.focus());
  return el('div', {class: 'rk-catalog'}, [
    el('h3', {text: `U${uLabel(rack.frame, ru)} · ${face}, empty`}),
    el('label', {}, ['Place a device here', input]),
    list,
  ]);
}
```

Append to `site/rack/rack.css`:

```css
.rk-cat-list { display: flex; flex-direction: column; gap: 0.15rem; }
.rk-cat { display: flex; flex-wrap: wrap; gap: 0 0.3rem; text-align: left; border: 1px solid transparent !important; }
.rk-cat:hover { border-color: var(--pt-brass) !important; }
.rk-cat.rk-no { opacity: 0.55; cursor: not-allowed; }
.rk-cat .rk-why { flex-basis: 100%; color: var(--pt-warn); font-size: 0.8rem; }
```

- [ ] **Step 3: Wire the `'u'` branch into `site/rack-page.js`**

Add these imports:

```js
import {withItem} from './rack/model.js';
import {catalogEntries} from './rack/chassis.js';
import {catalogPanel} from './rack/catalog.js';
```

Merge `withItem` and `catalogEntries` into the existing import lines rather than repeating them. Add `entries: []` and `query: ''` to `S`, and in `boot()`, after `chassisOf = …`, set `S.entries = catalogEntries(S.devices);`.

Add:

```js
function place(entry, face, ru) {
  const cfg = entry.default ?? entry.configs?.[0] ?? '';
  const {rack: next, item} = withItem(rack(), {ref: entry.name, cfg, ru, face, label: entry.model || entry.name});
  S.sel = {kind: 'item', id: item.id};
  commit(next);
}
```

Replace the `'u'` branch in `renderSide` with:

```js
  else if (sel.kind === 'u') body = catalogPanel({entries: S.entries, rack: r, face: sel.face, ru: sel.ru,
    chassisOf, query: S.query, onQuery: q => { S.query = q; }, onPick: e => place(e, sel.face, sel.ru)});
```

- [ ] **Step 4: Run the checks**

Run: `python3 check-browser.py --only check_rack_place,check_rack_page`
Expected: both pass.

Then place a few devices by hand at `http://localhost:8932/rack.html`. Check that search narrows the list, that devices which don't fit show their reasons, and that the rear pane shows the R740xd's rear panel and a ghost for a short switch.

- [ ] **Step 5: Commit**

```bash
git add site/rack/catalog.js site/rack/rack.css site/rack-page.js check-browser.py
git commit -m "rack: place a device - an empty U opens the catalog, grayed with reasons

Search across manufacturer, model and family; a device that will not fit
says why on its own row; a placed device takes its default configuration.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: The inspector: edit, move, remove, open in Explorer

**Files:**
- Create: `site/rack/inspector.js`
- Modify: `site/rack-page.js` (the `'item'` and `'move'` branches, the move click, the arrow keys, the lens)
- Modify: `check-browser.py` (add `check_rack_inspect`)

**Interfaces:**
- Consumes: `fits`, `availableDepth` (Task 3); `updateItem`, `withoutItem` (Task 2); `openLens` (Task 8).
- Produces: `inspectorPanel({item, rack, chassis, available, onPatch, onMove, onRemove, onExplore}) → HTMLElement`.
  - It has fields `#iLabel`, `#iCfg`, `#iFace` and `#iTurned`, a depth line `.rk-depth`, buttons `#iExplore`, `#iMove` and `#iRemove`, and an error line `.rk-error`.
  - `onPatch(patch)` returns `{ok, reason?}`. On refusal the panel shows the reason and resets the control.
  - A changed configuration clears `swaps` and `fields`, because they are a delta against the old configuration, and the panel says so.

- [ ] **Step 1: Write the failing check**

```python
@extra("rack.html: inspect, move with arrows, face refusal, Explorer round trip, remove")
def check_rack_inspect(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    page.on("dialog", lambda d: d.accept())
    page.goto(f"{base}/rack.html?probe=1", wait_until="load")
    page.wait_for_function("() => window.__rack && window.__rack.ready", timeout=READY_MS)
    page.evaluate("() => window.__rack.ready")
    page.click("#libMenu > summary"); page.click("#libItems button:has-text('New rack')")
    page.wait_for_function("() => window.__rack.doc().racks[0].items.length === 0")
    page.click('svg[data-pane="front"] rect.rk-u[data-u="20"]')
    page.fill("#catQuery", "AS7726")
    page.click('.rk-cat[data-ref="as7726-32x"]:not([aria-disabled="true"])')
    item = lambda: page.evaluate("() => window.__rack.doc().racks[0].items[0]")
    page.wait_for_selector("#iLabel", timeout=READY_MS)
    # Move with the arrow keys.
    page.keyboard.press("ArrowUp"); page.keyboard.press("ArrowUp")
    page.wait_for_function("() => window.__rack.doc().racks[0].items[0].ru === 22")
    # Another device at U22 on the rear; switching the switch's face to rear is refused.
    page.click('svg[data-pane="rear"] rect.rk-u[data-u="22"]')
    page.fill("#catQuery", "TM-280")
    page.click('.rk-cat[data-ref="tm-280"]:not([aria-disabled="true"])')
    page.click('svg[data-pane="front"] [data-device-ref="as7726-32x"]')
    page.select_option("#iFace", "rear")
    err = page.text_content(".rk-side .rk-error") or ""
    if "Taken by" not in err or item()["face"] != "front":
        bad.append(f"inspect: a face change onto an occupied U was not refused ({err!r}, {item()['face']})")
    # Label edit.
    page.fill("#iLabel", "tor-1"); page.dispatch_event("#iLabel", "change")
    page.wait_for_function("() => window.__rack.doc().racks[0].items[0].label === 'tor-1'")
    # Explorer round trip: seat an optic in the lens through its own URL state.
    page.click("#iExplore")
    page.wait_for_selector(".rk-lens iframe", timeout=READY_MS)
    page.wait_for_function("""async () => {
      const w = document.querySelector('.rk-lens iframe')?.contentWindow;
      if (!w?.portrayalEmbed) return false; await w.portrayalEmbed.ready; return true; }""", timeout=READY_MS)
    page.evaluate("""() => {
      const w = document.querySelector('.rk-lens iframe').contentWindow;
      // swap= is written raw (it carries its own escaping), so it is appended, not set.
      const rest = w.location.search.replace(/&?swap=[^&]*/, '');
      w.location.replace(`${w.location.pathname}${rest}&swap=port-1~generic%2Fqsfp-lc%402`);
    }""")
    page.wait_for_function("""async () => {
      const w = document.querySelector('.rk-lens iframe')?.contentWindow;
      if (!w?.portrayalEmbed || !w.location.search.includes('swap=')) return false;
      await w.portrayalEmbed.ready; return !!w.portrayalEmbed.current().swaps['port-1']; }""", timeout=READY_MS)
    page.click(".rk-lens-done")
    page.wait_for_function("() => (window.__rack.doc().racks[0].items[0].swaps || {})['port-1'] === 'generic/qsfp-lc@2'",
                           timeout=READY_MS)
    page.wait_for_selector('svg[data-pane="front"] [data-device-ref="as7726-32x"] [data-ref^="generic/qsfp-lc@2"]',
                           timeout=READY_MS)
    # Remove.
    page.click('svg[data-pane="front"] [data-device-ref="as7726-32x"]')
    page.click("#iRemove")
    page.wait_for_function("() => !window.__rack.doc().racks[0].items.some(i => i.ref === 'as7726-32x')")
    return bad
```

The round trip sets the swap through the lens's own URL, because Explorer has no programmatic "swap this cage" API. Reloading the iframe with `swap=` is exactly what a user's swap leaves in Explorer's URL. It also exercises the lens re-reading the live window on Done (Task 8). The assertion: after Done, the item's `swaps['port-1']` is `generic/qsfp-lc@2`, and the front pane draws that optic.

Run: `python3 check-browser.py --only check_rack_inspect`
Expected: FAIL, a timeout waiting for `#iLabel`.

- [ ] **Step 2: Create `site/rack/inspector.js`**

```js
// ONE PLACED DEVICE (spec §7.2): what it is, where it stands, and the things
// that can be done to it. Every change goes through onPatch, which runs the
// placement rules and says no with the reason; the control then snaps back.

import {el} from './dom.js';
import {uLabel} from './model.js';

const option = (value, text, current) =>
  el('option', {value, text, ...(String(current) === String(value) ? {selected: ''} : {})});

export function inspectorPanel({item, rack, chassis, available, onPatch, onMove, onRemove, onExplore}) {
  const err = el('p', {class: 'rk-error', role: 'alert'});
  const note = el('p', {class: 'rk-muted'});
  const apply = (patch, reset) => {
    const r = onPatch(patch);
    if (r && !r.ok) { err.textContent = r.reason; reset(); } else err.textContent = '';
    return r;
  };
  const field = (label, control) => el('label', {}, [label, control]);

  const label = el('input', {id: 'iLabel', type: 'text', value: item.label});
  label.addEventListener('change', () => apply({label: label.value.trim() || item.ref}, () => { label.value = item.label; }));

  const cfg = el('select', {id: 'iCfg'}, (chassis?.configs ?? [item.cfg]).map(c => option(c, c, item.cfg)));
  cfg.addEventListener('change', () => {
    const had = Object.keys(item.swaps).length + Object.keys(item.fields).length > 0;
    const r = apply({cfg: cfg.value, swaps: {}, fields: {}}, () => { cfg.value = item.cfg; });
    if (r?.ok !== false && had) note.textContent = 'Your Explorer changes were for the old configuration, so they were cleared.';
  });

  const face = el('select', {id: 'iFace'}, [option('front', 'Front', item.face), option('rear', 'Rear', item.face)]);
  face.addEventListener('change', () => apply({face: face.value}, () => { face.value = item.face; }));

  const turned = el('input', {id: 'iTurned', type: 'checkbox', ...(item.turned ? {checked: ''} : {})});
  turned.addEventListener('change', () => apply({turned: turned.checked}, () => { turned.checked = item.turned; }));

  const d = chassis?.d;
  const button = (id, text, fn) => { const b = el('button', {type: 'button', id, text}); b.addEventListener('click', fn); return b; };
  return el('div', {class: 'rk-inspector'}, [
    el('h3', {text: item.label}),
    el('p', {class: 'rk-muted', text: `${chassis?.manufacturer ?? ''} ${chassis?.model ?? item.ref} · U${uLabel(rack.frame, item.ru)}, ${item.face}${item.turned ? ', turned' : ''}`.trim()}),
    field('Label', label),
    field('Configuration', cfg),
    field('Mounted on', face),
    el('label', {class: 'rk-check'}, [turned, ' Turned (its rear panel faces out)']),
    el('p', {class: 'rk-depth rk-muted', text: d ? `${Math.round(d)} mm deep · ${Math.round(available)} mm available here` : 'Depth unknown'}),
    el('div', {class: 'rk-actions'}, [
      button('iExplore', 'Open in Explorer', onExplore),
      button('iMove', 'Move', onMove),
      button('iRemove', 'Remove', onRemove),
    ]),
    note, err,
  ]);
}
```

Append to `rack.css`:

```css
.rk-check { flex-direction: row !important; align-items: center; gap: 0.4rem !important; }
.rk-actions { display: flex; gap: 0.4rem; flex-wrap: wrap; margin: 0.4rem 0; }
```

- [ ] **Step 3: Wire it into `site/rack-page.js`**

Merge these into the existing imports: `updateItem`, `withoutItem` (model); `availableDepth` (fit); `openLens` (`./rack/explorer-lens.js`); `inspectorPanel` (`./rack/inspector.js`).

Add:

```js
// A change to a placed item, checked against the rules before it is made.
function patchItem(id, patch) {
  const r = rack(), it = itemById(id);
  const next = {...it, ...patch};
  if (['ru', 'face'].some(k => k in patch)) {
    const f = fits(r, {ref: next.ref, ru: next.ru, face: next.face}, chassisOf, {ignoreId: id});
    if (!f.ok) return f;
  }
  commit(updateItem(r, id, patch));
  return {ok: true};
}

async function explore(id) {
  const it = itemById(id);
  const res = await openLens({ref: it.ref, cfg: it.cfg, swaps: it.swaps, fields: it.fields, title: it.label});
  if (res && itemById(id)) patchItem(id, {cfg: res.config, swaps: res.swaps, fields: res.fields});
}
```

Replace the `'item'` fallback branch in `renderSide` with:

```js
  else if (sel.kind === 'move') body = el('div', {}, [
    el('h3', {text: `Move ${itemById(sel.id)?.label ?? ''}`}),
    el('p', {class: 'rk-muted', text: 'Click the U where its bottom should go, on either face, or use the ↑ and ↓ keys. Esc stops moving.'})]);
  else {
    const it = itemById(sel.id);
    if (!it) { S.sel = null; body = summary(); }
    else body = inspectorPanel({item: it, rack: r, chassis: chassisOf(it.ref),
      available: availableDepth(r, it, chassisOf),
      onPatch: patch => patchItem(it.id, patch),
      onMove: () => select({kind: 'move', id: it.id}),
      onRemove: () => { if (confirm(`Remove ${it.label} from the rack?`)) { S.sel = null; commit(withoutItem(r, it.id)); } },
      onExplore: () => explore(it.id)});
  }
```

At the top of `onPaneClick`, handle a move before anything else:

```js
  if (S.sel?.kind === 'move') {
    const u = ev.target.closest('[data-u]');
    if (u) {
      const id = S.sel.id;
      const r = patchItem(id, {ru: Number(u.dataset.u), face: u.dataset.face});
      S.sel = {kind: 'item', id};
      if (!r.ok) { render(); queueMicrotask(() => { const e = document.querySelector('.rk-side .rk-error'); if (e) e.textContent = r.reason; }); }
      return;
    }
  }
```

In `boot()`, add the keys:

```js
  document.addEventListener('keydown', ev => {
    if (ev.target.closest?.('input, select, textarea, .rk-lens')) return;
    const id = S.sel?.kind === 'item' || S.sel?.kind === 'move' ? S.sel.id : null;
    if (ev.key === 'Escape' && S.sel) { ev.preventDefault(); select(id && S.sel.kind === 'move' ? {kind: 'item', id} : null); }
    else if (id && (ev.key === 'ArrowUp' || ev.key === 'ArrowDown')) {
      ev.preventDefault();
      const r = patchItem(id, {ru: itemById(id).ru + (ev.key === 'ArrowUp' ? 1 : -1)});
      if (!r.ok) { const e = document.querySelector('.rk-side .rk-error'); if (e) e.textContent = r.reason; }
    }
  });
```

- [ ] **Step 4: Run the checks**

Run: `python3 check-browser.py --only check_rack_inspect,check_rack_place,check_rack_page`
Expected: all pass.

Run: `python3 check-browser.py`
Expected: everything passes.

Then, at `http://localhost:8932/rack.html`, open a server in Explorer, seat a card, press Done, and confirm that the card appears in the elevation and survives a reload.

- [ ] **Step 5: Commit**

```bash
git add site/rack/inspector.js site/rack/rack.css site/rack-page.js check-browser.py
git commit -m "rack: inspect a device - label, configuration, face, turned, move, remove, Explorer

Every change runs the placement rules first and says no with the reason;
the arrow keys move the selected device a U at a time; Explorer's changes
come back on Done, and a new configuration clears the old one's changes.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Phase 1a wrap-up

**Files:**
- Modify: `docs/superpowers/specs/2026-09-26-rack-builder-design.md` (the status line)

- [ ] **Step 1: Run the whole suite from a clean start**

Run: `node --test tests/rack/*.test.mjs && ./chassis-index.py && git diff --exit-code site/rack/chassis.json && python3 check-contract.py && python3 check-browser.py`
Expected:
- every node test passes;
- the chassis index is unchanged;
- the contract passes;
- the browser suite lists every new `ok`: face memo, components retry, rack elevation, library, lens, page, place and inspect, with `rack.html` in the page sweep.

- [ ] **Step 2: Check the whole flow by hand, as a user would, at `http://localhost:8932/rack.html`**

Take these steps in order:
1. Create a new rack: **Frame**, four-post, 42U, tapped 12-24.
2. Place an R740xd at U10 on the front. The rear pane shows its rear panel.
3. Place an AS7726-32X at U20 on the front. The rear shows a ghost.
4. On the rear at U20, try the FHD-1UFCE. It is grayed, with a depth reason.
5. Place a TM-280 at U20 on the rear instead.
6. Open the R740xd in Explorer, change a PSU, press Done. The rear pane shows the new PSU.
7. Move the AS7726 with the arrow keys, then remove it.
8. **Save as .json**, **New rack**, then **Open .json…**. The saved rack comes back whole.
9. Reload the page. The last rack reopens as it was.
10. Open the page in a private window. The library note shows, and Save and Open still work.

- [ ] **Step 3: Mark the phase in the spec and commit**

Change the spec's `**Status:**` line to:
`design approved; Phase 0 implemented; Phase 1a implemented (plan: docs/superpowers/plans/2026-09-26-rack-builder-phase1a-build-a-rack.md); Phase 1b (3D and exports) next`

```bash
git add docs/superpowers/specs/2026-09-26-rack-builder-design.md
git commit -m "spec: Rack Builder Phase 1a is implemented

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

## Not in Phase 1a (so nobody adds it here)

- The 3D view, and every export except the rack `.json` (SVG sheet, PNG, draw.io, GLB/USDZ, DCIM types, DCIM device import CSV, BOM): **Phase 1b**.
- Placing or drawing zero-U items. The catalog has none, `fit.js` already has the rules (`fitsZeroU`), and the model keeps `zeroU`. **This deviates from spec §5.3**, which asked for the rendering hook in v1: with no zero-U device to draw, a side-gutter renderer could not be tested against anything real. It arrives with the first zero-U device, together with the UI for placing it.
- Cables: Phase 2. The model keeps `cables` untouched.
- Pan and zoom in the panes. The panes scroll together, which is enough for a 42U rack.
