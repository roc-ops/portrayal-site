# Rack Builder Phase 1b: exports (implementation plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `rack.html` gets an **Export ▾** menu that turns the rack being built into every format the site offers, each carrying the rack as configured:
- an SVG sheet with front and rear side by side and a title block, plus each face on its own;
- a PNG of the sheet at 2×;
- a draw.io file with one page per face;
- GLB and USDZ models from the 3D view;
- NetBox or Nautobot device-type YAMLs, zipped;
- a NetBox or Nautobot device-import CSV;
- a bill of materials (BOM) CSV that includes mounting hardware;
- the rack `.json`.

Anything an export can't resolve goes into a notes list that the file itself carries.

**Architecture:**
- **`site/rack/export-data.js`** holds every rule as pure functions with no DOM: file names, CSV quoting, the title block, which cabinet draws which device, matching a device to its DCIM type, device-import rows, and BOM aggregation. `node --test` covers it.
- **`site/rack/exports.js`** builds the files. It reads `S.doc` through `configuredFace`, `drawElevation`, `rackDiagram`, `makeZip`, `rasterize` and the 3D scene. Each builder resolves to `{name, data, type, notes}`, or `{error}`.
- **`site/svg-export.js`** is a new leaf module. It takes `standalone`/`save`/`saveSvg` out of `site/showcase/artifact.js`, which re-exports them. A tool page may import it.
- **`site/rack-page.js`** only wires the Export menu to the builders.

**Tech stack:**
- Vanilla ES modules with no bundler, served by `serve.py`.
- `node --test` for the pure modules.
- Playwright checks in `check-browser.py`, registered with `@extra` and runnable with `--only`. Downloads are captured with `page.expect_download`. Zips are read with Python's `zipfile`, CSVs with `csv`, and draw.io XML with `xml.etree`.

**Spec:** `docs/superpowers/specs/2026-09-26-rack-builder-design.md`.
- This plan covers §8 (exports) end to end, the **Export ▾** entry of §7.2, and §11's "each export produces a non-empty file".
- 3D (§7.4) already shipped in Phase 1a's follow-ups.
- Cabling (§9) is Phase 2.
- Read §5, §7 and §8 before starting.

## Before you start

- Work on the branch `rack-builder-1b`. Run `git fetch origin && git rebase origin/main` first.
- **PR #60** ("an In development note") merged on 2026-09-27, so `#devNote` and `check_rack_dev_note` are already on `main` and on this branch. Task 13 step 1 applies as written.

## Global constraints

- **Never edit anything under `vendor/` or `assets/`.** They are upstream snapshots, and `./refresh-assets.sh` overwrites them.
- No bundler, no npm, no new dependency. Modules import each other by relative path.
- These must not touch the DOM, because `node --test` imports them: `site/rack/model.js`, `site/rack/fit.js`, `site/rack/rails.js` and the new `site/rack/export-data.js`.
- Prose in comments and UI copy is American English. UI copy is sentence case, with no "please" and no exclamation marks.
- **The showcase's behavior and its exports must not change.** Every shared-module change in this plan is additive and gated on something only the Rack Builder passes (`group.faces`, `m.id`, `rack.numDisp`, a stack entry's `id`).
- **A tool page must not import `site/showcase/artifact.js`.** It looks up the showcase's own elements when it loads. Task 1 adds a node test that enforces this.
- **Never pass an async function as a `page.wait_for_function` predicate.** A promise is truthy at once. Wait on a synchronous predicate, then `page.evaluate` the awaiting.
- Local full-suite runs flake on showcase 3D and page-load timeouts (issue #59). Treat a failure as environmental **only if it reproduces on `main`**.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Serve locally with `python3 serve.py 8932`. `file://` does not work.

## Facts the tasks rely on (verified 2026-09-27 on `main` at `00ade464`)

**Page and shared helpers**
- **`rack.html` `.rk-bar`**, in order (without #60): `#libMenu` (`<details class="rk-menu">` with `#libItems`), `#frameSummary`, `#frameBtn`, `#rkZoom`, `#rkMode`, `#libNote`. `.rk-zoom` has `margin-left: auto`, so anything inserted before it stays on the left, and `#rkMode`'s position (`check_rack_mode_toggle_stable`) does not move. `.rk-menu > summary::after` already draws the ` ▾`.
- **`site/showcase/artifact.js`:**
  - It defines `save(data, filename, type)` (≈L279), `standalone(node)` (≈L314, clone, `__ptBase` viewBox, strip `data-pt-ui`, bake computed `--pt-*` paint, XML prolog) and `saveSvg` (≈L366).
  - Importers: `patch-view.js` (`standalone`); `00-rails.js`, `01-mount.js`, `06-takeaway.js`, `spokes/select.js`, `spokes/state.js` and `spokes/callouts.js` (`save`/`saveSvg`).
  - It already re-exports `el`/`svgEl` from `site/rack/dom.js`.
- **`site/rack/elevation.js`:**
  - `drawElevation({items, frame, view, baseRU=1, hitTargets=false, selectedId=null, selectedU=null, placeholders=true, ears=false, metal=false})` returns an `<svg data-pane>` with viewBox `${-RAIL_W-6} -18 ${OPENING+RAIL_W*2+12} ${heightRU*RU+30}` and **no width/height**.
  - Device groups carry `data-item-id`, `data-device-ref` and `data-panel` (`mounted` | `through` | `missing`).
  - A missing face draws an outline in `var(--pt-*)` colors.
  - `panelFor(item, pane)` is exported.
  - `drawEars` draws **2 screws per ear in total**: the bottom hole of the bottom U and the top hole of the top U.
  - `site/rack3d.js` `rackEars` draws **2 per ear per U**, at 6.35 and 38.10 mm, which are `HOLE_DY[0]` and `HOLE_DY[2]`.
  - The showcase's `build2dElevation` never passes `ears`.
- **`site/rack/face.js`:**
  - `configuredFace({ref, cfg, view, swaps, fields, turned})` resolves to a frozen `{text, vb, zones, ports, seat: {applied, refused, failed}}`, or `null` when the face was never compiled (an unknown ref resolves `null` after a 404).
  - It is memoized on its whole argument.
  - It also exports `components()` and `findComp(list, ref)`.
- **`site/rack/fit.js`:** `itemsWithU(rack, chassisOf)` adds `u` (height, at least 1).
- **`site/rack/model.js`:** `uLabel(frame, u)` gives the label under the frame's numbering.
- **`chassisOf(ref)`** (from `site/rack/chassis.json`) returns `{manufacturer, model, family, ru, h, w, d, airflow, default, configs}`, or `null`.

**Formats and assets**
- **`site/drawio.js` `rackDiagram(groups, {faces=['front'], labels=true})`:**
  - It draws one `<diagram>` page per group.
  - `pairWidth` is computed once from the `faces` option.
  - A device's cell id is `${slug(m.name)}-g${gi}r${r}-${face}`, so **two devices with the same name collide**.
  - The cabinet style contains `numDisp=ascend;`, which draws 1 at the top.
  - `m.u` is the device's top U counted from the top: `units - (ru + u - 1) + 1`.
  - A face missing for a side draws a dashed "no `<face>` drawing" box.
  - Port cells carry `portrayal-path`.
- **`site/raster.js` `rasterize(url, scale=2)`** draws `img.width × img.height × scale`, so the SVG needs width and height attributes to rasterize at its real size. It caches by URL; blob URLs are unique.
- **`site/bundle.js` `makeZip([{name, bytes}], stamp)`** returns a `Blob`, deterministic for one stamp.
- **`assets/exports/index.json`:**
  - It is keyed by device ref, as `{netbox: [paths], nautobot: [paths]}`, with paths like `netbox/device-types/<Vendor>/<model>.yaml`.
  - Every one of the 161 chassis refs has an entry.
  - Against the configs: 308 have a single file, 34 have a file whose name contains the config name, and 120 need a guess.
  - `as7726-32x` lists 4 Arrcus and 4 Edgecore files: `7726-32X-O-{48V-B,48V-F,AC-B,AC-F}`.
  - `asr-9006` lists `Cisco/ASR-9006-AC-V2.yaml` and `Cisco/ASR-9006-DC-V2.yaml`. Its `base` config names neither.
  - `tm-280` lists only `Telco Systems/TM-280.yaml`.
- **`assets/exports/files.json`:**
  - `{netbox, nautobot, fibre-maps}`.
  - Module types are `<target>/module-types/<Vendor>/<attrs.model>.yaml`, with no stem under two vendors.
  - Examples: `Cisco/A9K-16X100GE-TR.yaml`, `Cisco/A9K-3KW-AC.yaml`, `Cisco/ASR-9006-FAN.yaml` and `Cisco/A9K Slot Cover.yaml`.
- **A device-type YAML** begins `---`, then `manufacturer:`, `model:`, `slug:`, `u_height:`, `is_full_depth:`, all unquoted in practice.
  - `ASR-9006-AC-V2`, `7726-32X-O-AC-F` and `TM-280` are all `is_full_depth: true`. That is upstream data; do not "fix" it.
- **`assets/dist/components.json` `.components[]`:**
  - Fields: `{ns, name, major:'v1', kind, class, description, attrs}`, where the ref is `ns/name@<major without v>`.
  - Part number: `attrs.model`.
  - Examples:
    - `cisco/a9k-16x100ge-tr@1`: line-card, `A9K-16X100GE-TR`.
    - `cisco/a9k-slot-cover@1`: blank, `A9K Slot Cover`.
    - `cisco/a9k-pwr-3kw-ac@1`: psu, `A9K-3KW-AC`.
    - `cisco/asr-9006-fan@1`: fan, `ASR-9006-FAN`.
    - `generic/qsfp-lc@2`: transceiver, no `attrs.model`.
    - `common/fan-module@1`: fan, no model.
    - `common/psu-ac-650@3`: psu, no model.
- **Seated parts in a compiled face:**
  - Every `<g>` whose `data-path` ends in `/module` (a bay's module) or `-occupant` (a cage's optic, cap or plug) carries `data-ref="<ns/name@major>:<version>"`. This holds for all 542 compiled front and rear faces (grep, 2026-09-27).
  - Chassis parts carry `data-ref` too (`fan-tray-door`, `esd-jack`, and every port shape such as `std/sfp-ganged@1`). **Only the path suffix tells a seated part apart.**
  - Rear projections drop `data-ref`.
  - `asr-9006.base.front.svg` has 11 seated modules: `ft-0`/`ft-1` fans, `pm-0..2` A9K-3KW-AC, and `slot-0..5` slot covers.
  - `as7726-32x.ac-f2b.rear.svg` has 6 `common/fan-module@1` and 2 `common/psu-ac-650@3`.
- **3D:**
  - `site/rack3d.js` device groups are unnamed (≈L626 `const group = new THREE.Group();`), and entries are spread (`{...e}`), so an `id` on a stack entry survives.
  - The showcase's `CAST`/`mount3d` stack and `site/hero-3d.js`'s stack carry no `id`.
  - `toGLB()` returns an ArrayBuffer (magic `glTF`). `toUSDZ()` returns a Uint8Array (a zip, `PK`).
  - `vendor/share.js`'s `forExport` clones the scene, which copies `userData`.
  - `GLTFExporter` writes `object.name` as the node name, and scene `userData` as scene `extras` (`GLTFExporter.js:2336`).
  - `complete()` resolves when the deferred relief pass lands.

**Page and test harness**
- **`site/rack-page.js`:**
  - `S.doc`, `rack()`, `chassisOf`, `S.mode`, `S.scene3d`.
  - `rebuild3d()` is debounced 300 ms after `commit` by `scheduleRebuild3d`.
  - `downloadDoc` comes from `library.js`, with the file name `${stem}.rack.json` and the stem regex `/[^A-Za-z0-9._-]+/g → '-'`, trimmed.
  - `window.__rack = {ready, doc(), flush(), scene()}` with `?probe=1`.
- **`check-browser.py`:**
  - Each `@extra` check gets `browser.new_page()`, which is a fresh context with empty storage.
  - `READY_MS = 60000`, `READY_3D_MS = 240000`.
  - `pick(page, face, u, query, ref, cfg=None, dispatch=False)` places a device.
  - `u_center` and `wait_fn` exist.
  - `#openFile` accepts `set_input_files` (already used by `check_rack_import_keeps_library`).
  - It imports `json`, `pathlib` and `re`, but not `csv`, `io`, `zipfile` or `xml`.
- **Node** is v22 locally and in CI. `tests/rack/*.test.mjs` already runs in CI and in the pre-push hook.

## File map

| File | Responsibility | Task |
|---|---|---|
| `site/svg-export.js` | `save`, `standalone`, `saveSvg`: a leaf module with no DOM lookups at load. `artifact.js` re-exports it. | 1 |
| `tests/rack/imports.test.mjs` | The leaf imports under node; no tool module imports `artifact.js` | 1 |
| `site/rack/elevation.js` | Ears: 2 screws per ear per U | 2 |
| `site/rack/export-data.js` | Pure export rules: names, CSV, title block, notes, cabinets, DCIM matching and rows, BOM | 3, 4, 5 |
| `tests/rack/export-data.test.mjs`, `tests/rack/dcim.test.mjs`, `tests/rack/bom.test.mjs` | Node suites for `export-data.js` | 3, 4, 5 |
| `site/rack/exports.js` | Builders: sheet SVG/PNG, draw.io, GLB/USDZ, DCIM zip, device CSV, BOM | 6–11 |
| `rack.html`, `site/rack/rack.css`, `site/rack-page.js` | The Export menu and its wiring | 6–11 |
| `site/drawio.js` | `rackDiagram`: per-group `faces`, `m.id` for cell ids, per-rack `numDisp` (all optional) | 7 |
| `site/rack3d.js`, `site/rack/scene3d.js` | A device group is named `device-<id>` when the stack entry has an `id` | 8 |
| `explorer.html`, `site/rack/model.js`, `site/rack/library.js`, `chassis-index.py` | Deferred minor findings from Phase 1a | 12 |
| `check-browser.py` | Every new check, the export fixture and helpers | 1, 2, 6–13 |

---

### Task 1: One save/standalone, in a leaf module a tool page may import

**Files:**
- Create: `site/svg-export.js`, `tests/rack/imports.test.mjs`
- Modify: `site/showcase/artifact.js` (delete `save`, `standalone`, `saveSvg`; import and re-export them), `check-browser.py` (add `check_svg_export_leaf`)

**Interfaces:**
- Produces: `site/svg-export.js` exports:
  - `save(data, filename, type)`, which downloads a `Blob` through `<a download>`;
  - `standalone(node) → string`;
  - `saveSvg(node, filename)`.

  Their behavior is identical to `artifact.js`'s today. `artifact.js` re-exports the same function objects.

- [ ] **Step 1: Write the failing tests**

`tests/rack/imports.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';

const ROOT = new URL('../../', import.meta.url);
const read = p => readFileSync(new URL(p, ROOT), 'utf8');

test('svg-export.js is a leaf: it loads with no DOM at all', async () => {
  const S = await import('../../site/svg-export.js');
  assert.equal(typeof S.save, 'function');
  assert.equal(typeof S.standalone, 'function');
  assert.equal(typeof S.saveSvg, 'function');
});

test('no tool-page module imports the showcase artifact', () => {
  const files = ['site/rack-page.js', 'site/svg-export.js',
    ...readdirSync(new URL('site/rack/', ROOT)).filter(f => f.endsWith('.js')).map(f => `site/rack/${f}`)];
  for (const f of files) assert.doesNotMatch(read(f), /showcase\/artifact\.js/, `${f} imports artifact.js`);
});
```

In `check-browser.py`, before `def main():`:

```python
@extra("svg-export.js is the one save/standalone; the showcase re-exports the same functions")
def check_svg_export_leaf(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    page.goto(f"{base}/index.html", wait_until="load")
    r = page.evaluate("""async () => {
      const S = await import('/site/svg-export.js');
      const A = await import('/site/showcase/artifact.js');
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.innerHTML = '<g data-pt-ui="tabindex" tabindex="0"><rect/></g><g data-pt-ui="*"/>';
      document.body.append(svg);
      const text = S.standalone(svg);
      svg.remove();
      return {same: A.save === S.save && A.standalone === S.standalone && A.saveSvg === S.saveSvg,
              stripped: !text.includes('data-pt-ui') && !text.includes('tabindex'),
              prolog: text.startsWith('<?xml')};
    }""")
    for k in ("same", "stripped", "prolog"):
        if not r.get(k):
            bad.append(f"svg-export: {k} is {r.get(k)!r}")
    return bad
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `node --test tests/rack/imports.test.mjs`
Expected: FAIL, `Cannot find module …/site/svg-export.js`.

Run: `python3 check-browser.py --only check_svg_export_leaf`
Expected: FAIL, because `/site/svg-export.js` is not found.

- [ ] **Step 3: Move the three functions**

Create `site/svg-export.js`. Its header:

```js
// SAVING A DRAWING, for any page. `standalone` and `save` lived in the
// showcase's artifact.js, which looks up the showcase's own elements when it
// loads - so a tool page (the Rack Builder) could not use them. They are
// here now, with no DOM lookups at load; artifact.js re-exports them, so the
// showcase's imports are unchanged.
```

Then move these verbatim from `site/showcase/artifact.js`, keeping every comment above them:
- `export function save(…) {…}`;
- the long comment block and `export function standalone(node) {…}`;
- `export const saveSvg = (node, filename) => save(standalone(node), filename, 'image/svg+xml');`.

In `site/showcase/artifact.js`:
- delete those three definitions and their comment block;
- next to the existing `import {el, svgEl} from '../rack/dom.js';` / `export {el, svgEl};`, add:

```js
import {save, standalone, saveSvg} from '../svg-export.js';
export {save, standalone, saveSvg};
```

Grep `site/showcase/artifact.js` to confirm that anything inside it still calling `save(` or `standalone(` resolves to the imported bindings.

- [ ] **Step 4: Run the checks**

Run: `node --test tests/rack/*.test.mjs && python3 check-browser.py --only check_svg_export_leaf,check_takeaway_cables_2d,check_takeaway_drawio`
Expected: all pass. The stage 6 SVG export still has no `data-pt-ui` and keeps its cables.

- [ ] **Step 5: Commit**

```bash
git add site/svg-export.js site/showcase/artifact.js tests/rack/imports.test.mjs check-browser.py
git commit -m "site: save and standalone move to svg-export.js, a leaf any page may import

The Rack Builder's exports need them, and a tool page must not import the
showcase's artifact.js. artifact.js re-exports the same functions, so the
showcase is unchanged; a node test keeps site/rack off artifact.js.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Ears carry two screws per ear per U, as in 3D and the BOM

**Files:**
- Modify: `site/rack/elevation.js` (`drawEars` and its comment), `check-browser.py` (`check_rack_faces`)

**Interfaces:**
- Produces: a mounted item's `g.rk-ears` holds `4 × u` screw-head `<circle>`s: 2 ears, 2 per ear per U. Each sits on a rail hole at `HOLE_DY[0]` and `HOLE_DY[2]` of its U. Task 11's hardware count (4 × U) is the same number.

- [ ] **Step 1: Write the failing check**

In `check_rack_faces`, after the four-post R740xd block (after `pick(page, "front", 10, "R740", "r740xd")` and its two `wait_for_selector` lines), and before the final click test, add:

```python
    # Two screws per ear per U, on the rail's own holes - rack3d.js's rackEars
    # and the BOM's 4 x U count the same way. The R740xd is 2U: 8 heads.
    r740_id = page.eval_on_selector('svg[data-pane="front"] [data-device-ref="r740xd"]', "el => el.dataset.itemId")
    screws = page.eval_on_selector('svg[data-pane="front"]', """(svg, id) => {
      const ears = svg.querySelector(`g.rk-ears[data-ears-for="${id}"]`);
      const holes = [...svg.querySelectorAll('[data-rail-hole]')].map(h => h.tagName === 'circle'
        ? +h.getAttribute('cy') : +h.getAttribute('y') + +h.getAttribute('height') / 2);
      const heads = ears ? [...ears.querySelectorAll('circle')] : [];
      return {n: heads.length,
              onHoles: heads.every(c => holes.some(y => Math.abs(y - +c.getAttribute('cy')) < 0.01))};
    }""", r740_id)
    if screws["n"] != 8:
        bad.append(f"faces: a 2U device's ears carry {screws['n']} screws, expected 8 (2 per ear per U)")
    if not screws["onHoles"]:
        bad.append("faces: a screw head is not on a rail hole")
```

Run: `python3 check-browser.py --only check_rack_faces`
Expected: FAIL, `a 2U device's ears carry 4 screws, expected 8`.

- [ ] **Step 2: Draw a pair per U**

In `site/rack/elevation.js` `drawEars`, replace

```js
  const screwYs = [bottom - HOLE_DY[0], topOf(ruH - 1) - HOLE_DY[HOLE_DY.length - 1]];
```

with

```js
  // Two screws per ear in EVERY U the ear covers - the first and last hole of
  // each U - as rack3d.js's rackEars draws them and as the BOM counts them
  // (4 x U per device). One pair for the whole device read as a 1U ear on a
  // 10U chassis.
  const screwYs = [];
  for (let k = 0; k < ruH; k++) {
    const uBottom = topOf(k);
    screwYs.push(uBottom - HOLE_DY[0], uBottom - HOLE_DY[HOLE_DY.length - 1]);
  }
```

In the `RACK EARS` comment above, replace "a screw head sits at the device's top-most and bottom-most holes (HOLE_DY) within its span - for a 1U device, that is simply the first and last hole of that U." with "a screw head sits at the first and last hole (HOLE_DY) of every U the device covers." If `bottom` is now unused apart from `height: bottom - top`, keep it for that.

- [ ] **Step 3: Run the checks**

Run: `python3 check-browser.py --only check_rack_faces,check_rack_elevation,check_rack_rails_metal`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add site/rack/elevation.js check-browser.py
git commit -m "rack: ears carry two screws per ear per U, as in 3D and the BOM

The 2D ear drew one pair for the whole device; rack3d.js draws a pair in
every U, and the bill of materials counts 4 x U. All three agree now.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The pure export rules, part 1 (names, CSV, title block, notes, cabinets)

**Files:**
- Create: `site/rack/export-data.js`, `tests/rack/export-data.test.mjs`
- Modify: `site/rack/library.js` (`fileName` uses `fileStem`)

**Interfaces:**
- Produces, from `site/rack/export-data.js`. All of it is pure, and the only import is `uLabel` from `./model.js`.
  - `uniq(list) → list`
  - `fileStem(name) → string`: the same stem the `.rack.json` uses, `'rack'` when empty.
  - `isoDate(date) → 'YYYY-MM-DD'`, in local time.
  - `csvCell(v) → string`; `toCsv(columns, rows, notes = []) → string`. Rows are objects keyed by column. Lines end in CRLF. Non-empty `notes` add a blank line, a `Notes` row, and one note per row.
  - `holesText(frame)`; `titleLines(rack, date) → string[5]`
  - `wrapText(text, width) → string[]`
  - `xmlComment(notes) → string`, which is `''` when there are no notes.
  - `faceNotes({label, u, pane, panel, face}) → string[]`, where `face` is a `configuredFace` result or `null`.
  - `rackNotes(rack) → string[]` (zero-U items, cables); `threeDNotes(rack) → string[]` (optic fields)
  - `positionOf(frame, ru, u) → number`: the lowest U label the device covers, in the frame's numbering.
  - `drawioU(heightRU, ru, u) → number`
  - `perFaceItems(items) → {front, rear, hidden: [{item, pane, by}]}`. Each list holds the items drawn in that face's cabinet: those mounted there, plus the far side of anything not covered there by a mounted item.

- [ ] **Step 1: Write the failing tests**

`tests/rack/export-data.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import * as X from '../../site/rack/export-data.js';
import * as M from '../../site/rack/model.js';

const DAY = new Date(2026, 8, 27);
// check-browser.py's export fixture, with each item's height.
export const ITEMS = [
  {id: 'i1', ref: 'asr-9006', cfg: 'base', label: 'core-1', ru: 2, u: 10, face: 'front', turned: false},
  {id: 'i2', ref: 'as7726-32x', cfg: 'ac-f2b', label: 'leaf-1', ru: 14, u: 1, face: 'front', turned: false},
  {id: 'i3', ref: 'tm-280', cfg: 'base', label: 'demarc', ru: 14, u: 1, face: 'rear', turned: false},
  {id: 'i4', ref: 'tm-280', cfg: 'base', label: 'demarc', ru: 20, u: 1, face: 'rear', turned: false},
];

test('every export of a rack shares one file stem', () => {
  assert.equal(X.fileStem('Export test'), 'Export-test');
  assert.equal(X.fileStem(' Lab / rack #2 '), 'Lab-rack-2');
  assert.equal(X.fileStem(''), 'rack');
});

test('CSV cells are quoted only when they must be, RFC 4180 style', () => {
  assert.equal(X.csvCell('plain'), 'plain');
  assert.equal(X.csvCell('a,b'), '"a,b"');
  assert.equal(X.csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(X.csvCell(' edge'), '" edge"');
  assert.equal(X.csvCell(null), '');
  assert.equal(X.csvCell(3), '3');
  assert.equal(X.toCsv(['a', 'b'], [{a: 1, b: 'x,y'}, {a: null, b: 'say "hi"'}]),
    'a,b\r\n1,"x,y"\r\n,"say ""hi"""\r\n');
  assert.equal(X.toCsv(['a'], [{a: 1}], ['First note', 'Second, with a comma']),
    'a\r\n1\r\n\r\nNotes\r\nFirst note\r\n"Second, with a comma"\r\n');
});

test('the title block names the rack, frame, depths, holes and date', () => {
  assert.deepEqual(X.titleLines(M.newRack({name: 'Lab'}), DAY), ['Lab',
    'Four-post frame, 42U, U1 at the bottom', 'Rail depth 740 mm · usable depth 1000 mm',
    'Square holes (cage nuts)', 'Drawn 2026-09-27 with the Portrayal Rack Builder']);
  const edge = M.withFrame(M.newRack({name: 'Edge', kind: 'two-post'}),
    {heightRU: 12, numbering: 'top-down', holes: {style: 'tapped', thread: '10-32'}});
  assert.deepEqual(X.titleLines(edge, DAY).slice(1, 4),
    ['Two-post frame, 12U, U1 at the top', 'Usable depth 1000 mm', 'Tapped holes, 10-32']);
  assert.equal(X.holesText({holes: {style: 'tapped', thread: null}}), 'Tapped holes, thread not stated');
});

test('wrapText breaks on words and never splits one', () => {
  assert.deepEqual(X.wrapText('one two three four', 9), ['one two', 'three', 'four']);
  assert.deepEqual(X.wrapText('abcdefghijk x', 5), ['abcdefghijk', 'x']);
  assert.deepEqual(X.wrapText('', 5), []);
});

test('notes become an XML comment that cannot close itself early', () => {
  assert.equal(X.xmlComment([]), '');
  assert.equal(X.xmlComment(['a -- b', 'c']),
    '<!--\nNotes from the Portrayal Rack Builder:\n- a - b\n- c\n-->');
});

test('a face that is missing or refused a part says so', () => {
  assert.deepEqual(X.faceNotes({label: 'mystery', u: 20, pane: 'rear', panel: 'front', face: null}),
    ['mystery at U20: no front drawing, so the rear shows an outline.']);
  assert.deepEqual(X.faceNotes({label: 'core-1', u: 2, pane: 'front', panel: 'front',
    face: {seat: {applied: 1, refused: ['slot-1'], failed: ['slot-3', 'slot-4']}}}), [
    'core-1 at U2: slot-1 refused the part chosen and is shown empty.',
    "core-1 at U2: the part chosen for slot-3, slot-4 couldn't be loaded, so the drawing shows what the configuration seats there."]);
  assert.deepEqual(X.faceNotes({label: 'x', u: 1, pane: 'front', panel: 'front',
    face: {seat: {applied: 0, refused: [], failed: []}}}), []);
});

test('what no export shows yet is said, not dropped', () => {
  assert.deepEqual(X.rackNotes({zeroU: [], cables: []}), []);
  assert.deepEqual(X.rackNotes({zeroU: [{}], cables: [{}, {}]}),
    ['1 zero-U item is not in this export yet.', '2 cables are not in this export yet.']);
  assert.deepEqual(X.threeDNotes({items: [{label: 'leaf-1', fields: {'port-1-occupant': {label: 'LR4'}}},
                                          {label: 'core-1', fields: {}}]}),
    ['Optic labels and colors are not in the 3D model yet: leaf-1.']);
});

test('positions follow the frame numbering; draw.io counts from the top', () => {
  const f = M.normalizeFrame({heightRU: 24});
  assert.equal(X.positionOf(f, 2, 10), 2);
  assert.equal(X.positionOf({...f, numbering: 'top-down'}, 2, 10), 14);
  assert.equal(X.positionOf({...f, numbering: 'top-down'}, 20, 1), 5);
  assert.equal(X.drawioU(24, 2, 10), 14);
  assert.equal(X.drawioU(24, 24, 1), 1);
});

test('a cabinet draws what is mounted there and whatever is not hidden behind it', () => {
  const {front, rear, hidden} = X.perFaceItems(ITEMS);
  assert.deepEqual(front.map(i => i.id), ['i1', 'i2', 'i4']);
  assert.deepEqual(rear.map(i => i.id), ['i1', 'i3', 'i4']);
  assert.deepEqual(hidden.map(h => [h.pane, h.item.id, h.by.id]), [['front', 'i3', 'i2'], ['rear', 'i2', 'i3']]);
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `node --test tests/rack/export-data.test.mjs`
Expected: FAIL, `Cannot find module …/site/rack/export-data.js`.

- [ ] **Step 3: Create `site/rack/export-data.js`**

```js
// WHAT AN EXPORT SAYS, as data (spec §8). Pure: no DOM, no fetch - so
// `node --test` covers every rule an export follows: file names, CSV
// quoting, the title block, which cabinet draws which device, the notes,
// and (below, Tasks 4-5) DCIM matching and the bill of materials.
// site/rack/exports.js does the fetching and drawing, and asks here.

import {uLabel} from './model.js';

export const uniq = list => [...new Set(list)];

// One stem for every file a rack exports - the one its .json already uses.
export const fileStem = name =>
  String(name ?? '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-|-$/g, '') || 'rack';

const pad = n => String(n).padStart(2, '0');
export const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// RFC 4180: a cell with a comma, a quote, a line break or an edge space is
// quoted, its quotes doubled. Nothing else is touched - a part number that
// starts with "-" is a part number, not a formula to defuse.
export const csvCell = v => {
  const s = v == null ? '' : String(v);
  return /[",\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export function toCsv(columns, rows, notes = []) {
  const line = cells => cells.map(csvCell).join(',');
  const out = [line(columns), ...rows.map(r => line(columns.map(c => r[c])))];
  if (notes.length) out.push('', line(['Notes']), ...notes.map(n => line([n])));
  return `${out.join('\r\n')}\r\n`;
}

export function holesText(frame) {
  if (frame.holes?.style !== 'tapped') return 'Square holes (cage nuts)';
  return `Tapped holes, ${frame.holes.thread || 'thread not stated'}`;
}

// The sheet's title block (spec §8): rack name, frame, depths, holes, date.
export function titleLines(rack, date) {
  const f = rack.frame;
  const kind = f.kind === 'two-post' ? 'Two-post' : 'Four-post';
  const numbering = f.numbering === 'top-down' ? 'U1 at the top' : 'U1 at the bottom';
  const depth = f.kind === 'two-post'
    ? `Usable depth ${Math.round(f.usableDepth)} mm`
    : `Rail depth ${Math.round(f.railDepth)} mm · usable depth ${Math.round(f.usableDepth)} mm`;
  return [rack.name, `${kind} frame, ${f.heightRU}U, ${numbering}`, depth, holesText(f),
          `Drawn ${isoDate(date)} with the Portrayal Rack Builder`];
}

export function wrapText(text, width) {
  const lines = [];
  let cur = '';
  for (const w of String(text).split(/\s+/).filter(Boolean)) {
    if (cur && cur.length + 1 + w.length > width) { lines.push(cur); cur = w; }
    else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) lines.push(cur);
  return lines;
}

// Notes inside an XML file (draw.io). "--" may not appear in a comment.
export function xmlComment(notes) {
  if (!notes.length) return '';
  const body = notes.map(n => `- ${n}`).join('\n').replace(/-{2,}/g, '-');
  return `<!--\nNotes from the Portrayal Rack Builder:\n${body}\n-->`;
}

// What one pane could not show of one item. `u` is the U label as the frame
// numbers it; `panel` is the device's own panel facing `pane`.
export function faceNotes({label, u, pane, panel, face}) {
  const at = `${label} at U${u}`;
  if (!face) return [`${at}: no ${panel} drawing, so the ${pane} shows an outline.`];
  const {refused = [], failed = []} = face.seat || {};
  const out = [];
  if (refused.length)
    out.push(`${at}: ${refused.join(', ')} refused the part chosen and ${refused.length === 1 ? 'is' : 'are'} shown empty.`);
  if (failed.length)
    out.push(`${at}: the part chosen for ${failed.join(', ')} couldn't be loaded, so the drawing shows what the configuration seats there.`);
  return out;
}

const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
export function rackNotes(rack) {
  const out = [];
  const z = rack.zeroU?.length || 0, c = rack.cables?.length || 0;
  if (z) out.push(`${count(z, 'zero-U item is', 'zero-U items are')} not in this export yet.`);
  if (c) out.push(`${count(c, 'cable is', 'cables are')} not in this export yet.`);
  return out;
}

// createRackScene has no fields input yet (site/rack/scene3d.js).
export function threeDNotes(rack) {
  const withFields = rack.items.filter(i => Object.keys(i.fields || {}).length).map(i => i.label);
  return withFields.length ? [`Optic labels and colors are not in the 3D model yet: ${withFields.join(', ')}.`] : [];
}

// The U a DCIM calls a device's position: the lowest-numbered U it covers,
// counted the way this frame counts.
export const positionOf = (frame, ru, u) => Math.min(uLabel(frame, ru), uLabel(frame, ru + u - 1));

// draw.io's cabinet counts from 1 at the TOP, and its `u` is the device's top U.
export const drawioU = (heightRU, ru, u) => heightRU - (ru + u - 1) + 1;

const overlaps = (a, b) => a.ru <= b.ru + b.u - 1 && b.ru <= a.ru + a.u - 1;
// ONE CABINET PER FACE. What you see from a side is what is mounted there,
// plus the far panel of anything that nothing mounted on this side covers.
// Behind a mounted device, the other side's device is hidden - two pictures
// in one U of a draw.io cabinet overlap, and the 2D pane already draws the
// mounted one on top.
export function perFaceItems(items) {
  const out = {front: [], rear: [], hidden: []};
  for (const pane of ['front', 'rear']) {
    for (const it of items) {
      if (it.face === pane) { out[pane].push(it); continue; }
      const by = items.find(o => o.face === pane && overlaps(o, it));
      if (by) out.hidden.push({item: it, pane, by});
      else out[pane].push(it);
    }
  }
  return out;
}
```

In `site/rack/library.js`:
- add `import {fileStem} from './export-data.js';`;
- replace the `fileName` body with `` const fileName = doc => `${fileStem(doc.racks[0]?.name)}.rack.json`; ``.

- [ ] **Step 4: Run the tests**

Run: `node --test tests/rack/*.test.mjs`
Expected: all pass.

Run: `python3 check-browser.py --only check_rack_no_idb`
Expected: pass. Save as .json still downloads.

- [ ] **Step 5: Commit**

```bash
git add site/rack/export-data.js site/rack/library.js tests/rack/export-data.test.mjs
git commit -m "rack: the pure rules exports follow - names, CSV, title block, notes, cabinets

export-data.js has no DOM, so node --test covers what every export
decides: its file name, CSV quoting, the sheet's title block, what a face
could not show, and which side a draw.io cabinet draws.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The pure export rules, part 2 (DCIM matching and device-import rows)

**Files:**
- Create: `tests/rack/dcim.test.mjs`
- Modify: `site/rack/export-data.js` (append)

**Interfaces:**
- Produces, appended to `export-data.js`:
  - `stemOf(path)`, `vendorOf(path)`, `tokens(s)`
  - `matchDeviceType({cfg, manufacturer, paths}) → {path, guess, candidates} | null`. This implements the mapping rule:
    1. Only the chassis manufacturer's own files, if any exist.
    2. A single file is certain.
    3. Otherwise a file whose name holds the config's words as a run wins; it is certain if only one does.
    4. Otherwise the best token score with airflow and DC aliases wins; it is a **guess**.
    5. Ties go to index order.
  - `yamlHead(text) → {manufacturer, model, slug, uHeight, isFullDepth}`
  - `moduleTypePath(paths, model) → path | null`; `partNumber(comp) → string`
  - `uniqueNames(items) → Map(id → {name, renamed})`
  - `NETBOX_COLUMNS`, `NAUTOBOT_COLUMNS`
  - `deviceImportRows({rack, items, types, target}) → {columns, rows}`, where `types` is `Map(id → {manufacturer, model, isFullDepth, guess} | null)`. Rows run top down by U, with front before rear.
  - `dcimNotesText({rackName, target, date, notes}) → string` (NOTES.txt)

**Column decision (binding for Tasks 10 and 13):**
- **NetBox:** `name, role, manufacturer, device_type, status, site, rack, position, face, comments`.
  - NetBox 3.6 renamed `device_role` to `role`, and NetBox 4 accepts only `role`, so that is the column.
  - `role` and `site` are required by NetBox. The rack document has no notion of either, so both are **left blank**. A blank required column fails the import loudly and per row, instead of creating devices under a role or site this page guessed.
  - `status` is `planned`, because this is a designed rack, not an installed one.
  - `comments` is a real Device field. It carries each row's notes (guessed type, renamed, turned, shared U), so the file stays importable. A trailing notes section would break the import.
- **Nautobot:** Nautobot 2.x CSV import identifies related objects by natural-key columns: `name, role__name, device_type__manufacturer__name, device_type__model, status__name, location__name, rack__name, position, face, comments`, with status `Planned` and `role__name`/`location__name` blank.
  - While doing this task, check these names against Nautobot 2.x's CSV import documentation. If they differ, change only `NAUTOBOT_COLUMNS`, the row builder's Nautobot object and their test, and say so in the report.

- [ ] **Step 1: Write the failing tests**

`tests/rack/dcim.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import * as X from '../../site/rack/export-data.js';
import * as M from '../../site/rack/model.js';
import {ITEMS} from './export-data.test.mjs';

const DAY = new Date(2026, 8, 27);
const nb = (vendor, model) => `netbox/device-types/${vendor}/${model}.yaml`;

test('one file is certain; a manufacturer filter comes first', () => {
  assert.deepEqual(X.matchDeviceType({cfg: 'base', manufacturer: 'Telco Systems', paths: [nb('Telco Systems', 'TM-280')]}),
    {path: nb('Telco Systems', 'TM-280'), guess: false, candidates: 1});
  assert.equal(X.matchDeviceType({cfg: 'base', manufacturer: 'X', paths: []}), null);
});

test('a file naming the configuration wins, as a run of its words', () => {
  const paths = ['lff12-mlff4-rlff2-rc0-noriser', 'lff12-rc0-noriser', 'lff12-rc3-1a2a']
    .map(c => nb('Dell', `PowerEdge R740xd ${c}`));
  assert.deepEqual(X.matchDeviceType({cfg: 'lff12-rc0-noriser', manufacturer: 'Dell', paths}),
    {path: paths[1], guess: false, candidates: 3});
  const asr = [nb('Cisco', 'ASR-9006-AC-V2'), nb('Cisco', 'ASR-9006-DC-V2')];
  assert.deepEqual(X.matchDeviceType({cfg: 'dc', manufacturer: 'Cisco', paths: asr}),
    {path: asr[1], guess: false, candidates: 2});
});

test('otherwise the best token score, with airflow and DC aliases, is a guess', () => {
  const paths = ['ArcOS on 7726-32X-O-AC-F', 'ArcOS on 7726-32X-O-AC-B'].map(m => nb('Arrcus', m))
    .concat(['7726-32X-O-48V-B', '7726-32X-O-48V-F', '7726-32X-O-AC-B', '7726-32X-O-AC-F'].map(m => nb('Edgecore', m)));
  assert.deepEqual(X.matchDeviceType({cfg: 'ac-f2b', manufacturer: 'Edgecore', paths}),
    {path: nb('Edgecore', '7726-32X-O-AC-F'), guess: true, candidates: 4});
  assert.equal(X.matchDeviceType({cfg: 'dc-b2f', manufacturer: 'Edgecore', paths}).path, nb('Edgecore', '7726-32X-O-48V-B'));
  const asr = [nb('Cisco', 'ASR-9006-AC-V2'), nb('Cisco', 'ASR-9006-DC-V2')];
  assert.deepEqual(X.matchDeviceType({cfg: 'base', manufacturer: 'Cisco', paths: asr}),
    {path: asr[0], guess: true, candidates: 2});
});

test('yamlHead reads the top-level identity, quoted or not', () => {
  const h = X.yamlHead('---\nmanufacturer: Cisco\nmodel: ASR 9901 Router, AC supplies\nslug: cisco-asr-9901\n' +
                       'u_height: 2.0\nis_full_depth: true\ninterfaces:\n  - name: x\n    model: nested\n');
  assert.deepEqual(h, {manufacturer: 'Cisco', model: 'ASR 9901 Router, AC supplies', slug: 'cisco-asr-9901',
                       uHeight: 2, isFullDepth: true});
  assert.equal(X.yamlHead("model: 'O''Brien 1'").model, "O'Brien 1");
  assert.equal(X.yamlHead('model: "A: B"').model, 'A: B');
  assert.equal(X.yamlHead('').model, null);
});

test('a module type is found by its part number, slashes as dashes', () => {
  const paths = ['netbox/module-types/Cisco/A9K Slot Cover.yaml', 'netbox/device-types/Cisco/X.yaml',
                 'netbox/module-types/Acme/A-B.yaml'];
  assert.equal(X.moduleTypePath(paths, 'A9K Slot Cover'), paths[0]);
  assert.equal(X.moduleTypePath(paths, 'A/B'), paths[2]);
  assert.equal(X.moduleTypePath(paths, 'X'), null);
  assert.equal(X.moduleTypePath(paths, ''), null);
  assert.equal(X.partNumber({attrs: {model: 'A9K-3KW-AC'}}), 'A9K-3KW-AC');
  assert.equal(X.partNumber({attrs: {'part-number': 'P1'}}), 'P1');
  assert.equal(X.partNumber(null), '');
});

test('a repeated label gets the item id, once per duplicate', () => {
  const n = X.uniqueNames(ITEMS);
  assert.deepEqual([...n.values()].map(v => v.name), ['core-1', 'leaf-1', 'demarc-i3', 'demarc-i4']);
  assert.equal(n.get('i3').renamed, true);
  assert.equal(n.get('i1').renamed, false);
});

const TYPES = new Map([
  ['i1', {manufacturer: 'Cisco', model: 'ASR-9006-AC-V2', isFullDepth: true, guess: true}],
  ['i2', {manufacturer: 'Edgecore', model: '7726-32X-O-AC-F', isFullDepth: true, guess: true}],
  ['i3', {manufacturer: 'Telco Systems', model: 'TM-280', isFullDepth: true, guess: false}],
  ['i4', {manufacturer: 'Telco Systems', model: 'TM-280', isFullDepth: true, guess: false}],
]);
const RACK = {name: 'Export test', frame: M.normalizeFrame({heightRU: 24})};

test('NetBox rows: top down, unique names, planned, notes in comments', () => {
  const {columns, rows} = X.deviceImportRows({rack: RACK, items: ITEMS, types: TYPES, target: 'netbox'});
  assert.deepEqual(columns, ['name', 'role', 'manufacturer', 'device_type', 'status', 'site', 'rack',
                             'position', 'face', 'comments']);
  assert.deepEqual(rows.map(r => [r.name, r.position, r.face, r.manufacturer, r.device_type]), [
    ['demarc-i4', 20, 'rear', 'Telco Systems', 'TM-280'], ['leaf-1', 14, 'front', 'Edgecore', '7726-32X-O-AC-F'],
    ['demarc-i3', 14, 'rear', 'Telco Systems', 'TM-280'], ['core-1', 2, 'front', 'Cisco', 'ASR-9006-AC-V2']]);
  assert.ok(rows.every(r => r.status === 'planned' && r.role === '' && r.site === '' && r.rack === 'Export test'));
  assert.equal(rows[0].comments, 'Named demarc-i4 because another device here is also demarc.');
  assert.equal(rows[1].comments, 'Device type 7726-32X-O-AC-F is a best guess for configuration ac-f2b. ' +
    'Shares its U with demarc-i3 on the rear; NetBox refuses this while either type is full depth.');
  assert.equal(rows[3].comments, 'Device type ASR-9006-AC-V2 is a best guess for configuration base.');
});

test('positions follow a top-down frame', () => {
  const rack = {...RACK, frame: {...RACK.frame, numbering: 'top-down'}};
  assert.deepEqual(X.deviceImportRows({rack, items: ITEMS, types: TYPES}).rows.map(r => r.position), [5, 11, 11, 14]);
});

test('Nautobot rows use natural-key columns; a device with no type says so', () => {
  const types = new Map([...TYPES, ['i1', null]]);
  const {columns, rows} = X.deviceImportRows({rack: RACK, items: ITEMS, types, target: 'nautobot'});
  assert.deepEqual(columns, ['name', 'role__name', 'device_type__manufacturer__name', 'device_type__model',
    'status__name', 'location__name', 'rack__name', 'position', 'face', 'comments']);
  assert.deepEqual([rows[1].device_type__manufacturer__name, rows[1].device_type__model, rows[1].status__name,
                    rows[1].rack__name], ['Edgecore', '7726-32X-O-AC-F', 'Planned', 'Export test']);
  assert.equal(rows[3].device_type__model, '');
  assert.equal(rows[3].comments, 'No Nautobot device type for asr-9006 (base); add one before importing.');
});

test('NOTES.txt heads its list, or says everything matched', () => {
  assert.equal(X.dcimNotesText({rackName: 'Export test', target: 'netbox', date: DAY, notes: []}),
    'NetBox types for Export test, from the Portrayal Rack Builder, 2026-09-27.\n\n' +
    'Every device and part in this rack matched a NetBox type.\n');
  assert.equal(X.dcimNotesText({rackName: 'R', target: 'nautobot', date: DAY, notes: ['a', 'b']}),
    'Nautobot types for R, from the Portrayal Rack Builder, 2026-09-27.\n\n- a\n- b\n');
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `node --test tests/rack/dcim.test.mjs`
Expected: FAIL, `X.matchDeviceType is not a function`.

- [ ] **Step 3: Append to `site/rack/export-data.js`**

```js
// ── DCIM (spec §8) ─────────────────────────────────────────────────────
export const stemOf = path => String(path).split('/').pop().replace(/\.ya?ml$/i, '');
export const vendorOf = path => String(path).split('/').at(-2) ?? '';
export const tokens = s => String(s ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

// How a configuration's words are also spelled in vendor part numbers:
// Edgecore writes front-to-back airflow as -F, back-to-front as -B, and
// 48 V DC as 48V.
const ALIAS = {f2b: ['f'], b2f: ['b'], dc: ['48v']};
const runIn = (hay, needle) => needle.length > 0 && hay.some((_, i) =>
  i + needle.length <= hay.length && needle.every((t, k) => hay[i + k] === t));

// WHICH DEVICE TYPE IS THIS ITEM. index.json lists every type a device ref
// exports - one per SKU, often one per configuration - and nothing names
// which configuration each is. So: the chassis manufacturer's own files
// first; one file is certain; a file whose name carries the configuration's
// words as a run is certain when it is the only one; otherwise the best
// match on words and aliases is a GUESS, and the caller lists it in notes.
export function matchDeviceType({cfg, manufacturer, paths}) {
  if (!paths?.length) return null;
  const own = paths.filter(p => vendorOf(p) === manufacturer);
  const pool = own.length ? own : [...paths];
  if (pool.length === 1) return {path: pool[0], guess: false, candidates: 1};
  const want = tokens(cfg);
  const exact = pool.filter(p => runIn(tokens(stemOf(p)), want));
  if (exact.length) {
    const best = [...exact].sort((a, b) => tokens(stemOf(a)).length - tokens(stemOf(b)).length)[0];
    return {path: best, guess: exact.length > 1, candidates: pool.length};
  }
  const wanted = want.flatMap(t => [t, ...(ALIAS[t] || [])]);
  let best = pool[0], score = -1;
  for (const p of pool) {
    const have = new Set(tokens(stemOf(p)));
    const s = wanted.filter(t => have.has(t)).length;
    if (s > score) { best = p; score = s; }
  }
  return {path: best, guess: true, candidates: pool.length};
}

// The identity lines at the top of a device-type YAML - enough for a CSV to
// name the type exactly as the YAML does. Top level only: an indented
// `model:` belongs to a component, not the type.
export function yamlHead(text) {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.match(/^(manufacturer|model|slug|u_height|is_full_depth):\s*(.*?)\s*$/);
    if (!m || m[1] in out) continue;
    let v = m[2];
    if (/^'.*'$/.test(v)) v = v.slice(1, -1).replace(/''/g, "'");
    else if (/^".*"$/.test(v)) v = JSON.parse(v);
    out[m[1]] = v;
  }
  return {manufacturer: out.manufacturer ?? null, model: out.model ?? null, slug: out.slug ?? null,
          uHeight: out.u_height != null ? Number(out.u_height) : null,
          isFullDepth: out.is_full_depth === 'true'};
}

// A module type's file is named for the part number (attrs.model), a "/"
// in it written "-" (exporter.html reads it the same way).
export function moduleTypePath(paths, model) {
  if (!model) return null;
  const want = [model, model.replace(/\//g, '-')];
  return paths.find(p => p.includes('/module-types/') && want.includes(stemOf(p))) ?? null;
}
export const partNumber = comp => comp?.attrs?.model ?? comp?.attrs?.part ?? comp?.attrs?.['part-number']
  ?? comp?.attrs?.['vendor-sku'] ?? '';

// A DCIM wants unique device names; two items may share a label.
export function uniqueNames(items) {
  const base = i => String(i.label || i.ref).trim();
  const seen = new Map();
  for (const i of items) seen.set(base(i), (seen.get(base(i)) || 0) + 1);
  return new Map(items.map(i => [i.id, seen.get(base(i)) > 1
    ? {name: `${base(i)}-${i.id}`, renamed: true} : {name: base(i), renamed: false}]));
}

export const NETBOX_COLUMNS = ['name', 'role', 'manufacturer', 'device_type', 'status', 'site', 'rack',
  'position', 'face', 'comments'];
export const NAUTOBOT_COLUMNS = ['name', 'role__name', 'device_type__manufacturer__name', 'device_type__model',
  'status__name', 'location__name', 'rack__name', 'position', 'face', 'comments'];
const TARGET_NAME = {netbox: 'NetBox', nautobot: 'Nautobot'};

// One row per rail item, top down. Role and site/location are left blank on
// purpose: both are required, and this rack knows neither - a blank one
// fails the import loudly instead of filing devices under a guess.
export function deviceImportRows({rack, items, types, target = 'netbox'}) {
  const T = TARGET_NAME[target] || 'NetBox';
  const names = uniqueNames(items);
  const sorted = [...items].sort((a, b) => b.ru - a.ru || (a.face === b.face ? 0 : a.face === 'front' ? -1 : 1));
  const rows = sorted.map(it => {
    const t = types.get(it.id) || null;
    const n = names.get(it.id);
    const notes = [];
    if (!t) notes.push(`No ${T} device type for ${it.ref} (${it.cfg}); add one before importing.`);
    else if (t.guess) notes.push(`Device type ${t.model} is a best guess for configuration ${it.cfg}.`);
    if (n.renamed) notes.push(`Named ${n.name} because another device here is also ${String(it.label || it.ref).trim()}.`);
    if (it.turned) notes.push('Mounted turned: its rear panel faces out.');
    const other = items.find(o => o.id !== it.id && o.face !== it.face && overlaps(o, it));
    if (other && (t?.isFullDepth || types.get(other.id)?.isFullDepth))
      notes.push(`Shares its U with ${names.get(other.id).name} on the ${other.face}; ${T} refuses this while either type is full depth.`);
    const position = positionOf(rack.frame, it.ru, it.u);
    const comments = notes.join(' ');
    return target === 'nautobot'
      ? {name: n.name, role__name: '', device_type__manufacturer__name: t?.manufacturer ?? '',
         device_type__model: t?.model ?? '', status__name: 'Planned', location__name: '',
         rack__name: rack.name, position, face: it.face, comments}
      : {name: n.name, role: '', manufacturer: t?.manufacturer ?? '', device_type: t?.model ?? '',
         status: 'planned', site: '', rack: rack.name, position, face: it.face, comments};
  });
  return {columns: target === 'nautobot' ? NAUTOBOT_COLUMNS : NETBOX_COLUMNS, rows};
}

export function dcimNotesText({rackName, target, date, notes}) {
  const T = TARGET_NAME[target] || 'NetBox';
  const body = notes.length ? notes.map(n => `- ${n}`).join('\n')
    : `Every device and part in this rack matched a ${T} type.`;
  return `${T} types for ${rackName}, from the Portrayal Rack Builder, ${isoDate(date)}.\n\n${body}\n`;
}
```

`overlaps` is the helper defined in Task 3's section; it is reused here.

- [ ] **Step 4: Run the tests**

Run: `node --test tests/rack/*.test.mjs`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add site/rack/export-data.js tests/rack/dcim.test.mjs
git commit -m "rack: match an item to its DCIM type, and build device-import rows

A configuration's name picks its device type when a file carries it; a
closest match on words is a guess the export says out loud. NetBox and
Nautobot rows follow the frame's numbering, leave role and site blank for
the importer to require, and carry each row's notes in comments.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The pure export rules, part 3 (the bill of materials)

**Files:**
- Create: `tests/rack/bom.test.mjs`
- Modify: `site/rack/export-data.js` (append)

**Interfaces:**
- Produces:
  - `isSeatedPath(path) → boolean`: a `…/module` or `…-occupant` path.
  - `SECTIONS`, `sectionOf(cls) → label`
  - `firstSentence(text)`, `partManufacturer(comp, moduleTypePath) → string`
  - `BOM_COLUMNS = ['section', 'qty', 'manufacturer', 'model', 'description', 'ref']`
  - `bomRows({devices, parts, frame, railUs}) → rows`
    - `devices` is `[{ref, cfg, manufacturer, model}]`, one per item.
    - `parts` is `[{ref, cls, manufacturer, model, description}]`, one per seated instance.
    - Rows are aggregated by `ref|cfg` for devices and `ref` for parts, and sorted by section order, then model, then ref.
    - Mounting hardware comes last.
  - `hardwareRows(frame, railUs) → rows`: 4 × total U each. On square holes that is a `Cage nut, M6` row and a `Screw, M6` row; on tapped holes, one `Screw, <thread>` or `Screw, thread not stated` row.
  - `hardwareNotes(frame) → string[]`

- [ ] **Step 1: Write the failing tests**

`tests/rack/bom.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import * as X from '../../site/rack/export-data.js';
import * as M from '../../site/rack/model.js';

test('a seated part is a bay module or a cage occupant, nothing else', () => {
  for (const p of ['slot-2/module', 'port-1-occupant', 'slot-7/module/inp-com-occupant', 'slot-2/module/sub/module'])
    assert.equal(X.isSeatedPath(p), true, p);
  for (const p of ['fan-tray-door', 'port-1', 'slot-2/module/p0', 'esd-jack'])
    assert.equal(X.isSeatedPath(p), false, p);
});

test('parts are grouped by class', () => {
  assert.equal(X.sectionOf('line-card'), 'Line cards');
  assert.equal(X.sectionOf('transceiver'), 'Optics');
  assert.equal(X.sectionOf('port'), 'Plugs');
  assert.equal(X.sectionOf('led'), 'Other parts');
});

test('manufacturer and description come from the DCIM file and the component', () => {
  assert.equal(X.partManufacturer({ns: 'cisco'}, 'netbox/module-types/Cisco/A9K-3KW-AC.yaml'), 'Cisco');
  assert.equal(X.partManufacturer({ns: 'telco-systems'}, null), 'Telco Systems');
  assert.equal(X.partManufacturer({ns: 'generic'}, null), '');
  assert.equal(X.partManufacturer(null, null), '');
  assert.equal(X.firstSentence('Cisco X Line Card, 4th generation. Ten ports.'), 'Cisco X Line Card, 4th generation.');
  assert.equal(X.firstSentence(undefined), '');
});

test('the BOM counts devices by configuration and parts by reference, hardware last', () => {
  const card = {ref: 'cisco/a9k-16x100ge-tr@1', cls: 'line-card', manufacturer: 'Cisco', model: 'A9K-16X100GE-TR', description: 'Card.'};
  const cover = {ref: 'cisco/a9k-slot-cover@1', cls: 'blank', manufacturer: 'Cisco', model: 'A9K Slot Cover', description: 'Blank.'};
  const optic = {ref: 'generic/qsfp-lc@2', cls: 'transceiver', manufacturer: '', model: '', description: 'An optic.'};
  const rivet = {ref: 'common/rivet@1', cls: 'mechanical', manufacturer: '', model: '', description: ''};
  const tm = {ref: 'tm-280', cfg: 'base', manufacturer: 'Telco Systems', model: 'TM-280'};
  const rows = X.bomRows({
    devices: [tm, tm, {ref: 'asr-9006', cfg: 'base', manufacturer: 'Cisco', model: 'ASR 9006'}],
    parts: [cover, optic, card, cover, rivet], frame: M.defaultFrame(), railUs: [1, 1, 10]});
  assert.deepEqual(rows.map(r => [r.section, r.model || r.ref, r.qty]), [
    ['Devices', 'ASR 9006', 1], ['Devices', 'TM-280', 2], ['Line cards', 'A9K-16X100GE-TR', 1],
    ['Blanks', 'A9K Slot Cover', 2], ['Optics', 'generic/qsfp-lc@2', 1], ['Other parts', 'common/rivet@1', 1],
    ['Mounting hardware', 'Cage nut, M6', 48], ['Mounting hardware', 'Screw, M6', 48]]);
  assert.equal(rows[0].description, 'Configuration base');
  assert.deepEqual(X.BOM_COLUMNS, ['section', 'qty', 'manufacturer', 'model', 'description', 'ref']);
});

test('mounting hardware is 4 per U: cage nuts and screws, or screws of the thread', () => {
  const tapped = M.normalizeFrame({holes: {style: 'tapped', thread: '12-24'}});
  assert.deepEqual(X.hardwareRows(tapped, [2]), [{section: 'Mounting hardware', qty: 8, manufacturer: '',
    model: 'Screw, 12-24', description: 'Two per ear for each U a device covers', ref: ''}]);
  assert.equal(X.hardwareRows(M.normalizeFrame({holes: {style: 'tapped'}}), [1])[0].model, 'Screw, thread not stated');
  assert.deepEqual(X.hardwareRows(M.defaultFrame(), []), []);
  assert.match(X.hardwareNotes(M.defaultFrame())[0], /M6/);
  assert.match(X.hardwareNotes(M.normalizeFrame({holes: {style: 'tapped'}}))[0], /thread is not set/);
  assert.deepEqual(X.hardwareNotes(tapped), []);
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `node --test tests/rack/bom.test.mjs`
Expected: FAIL, `X.isSeatedPath is not a function`.

- [ ] **Step 3: Append to `site/rack/export-data.js`**

```js
// ── THE BILL OF MATERIALS (spec §8) ─────────────────────────────────────
// A part counts when it is SEATED: a bay's module (`…/module`) or a cage's
// occupant (`…-occupant` - an optic, a cap, a plug). Everything else in a
// face that carries data-ref is the chassis itself (a door, a jack, every
// port shape) and is already the device's line.
export const isSeatedPath = path => /\/module$|-occupant$/.test(String(path));

export const SECTIONS = [
  ['device', 'Devices'], ['supervisor', 'Supervisors'], ['line-card', 'Line cards'], ['fabric', 'Fabric cards'],
  ['expansion-card', 'Expansion cards'], ['nic', 'Network cards'], ['riser', 'Risers'], ['drive', 'Drives'],
  ['psu', 'Power supplies'], ['fan', 'Fans'], ['filter', 'Filters'], ['cassette', 'Cassettes'],
  ['adapter-panel', 'Adapter panels'], ['blank', 'Blanks'], ['transceiver', 'Optics'], ['port', 'Plugs'],
  ['cap', 'Dust caps'], ['other', 'Other parts'], ['hardware', 'Mounting hardware']];
const SECTION = new Map(SECTIONS);
export const sectionOf = cls => SECTION.get(cls) ?? 'Other parts';
const sectionOrder = label => SECTIONS.findIndex(([, l]) => l === label);

export const firstSentence = text => String(text ?? '').split(/(?<=\.)\s/)[0];
const titled = ns => ns.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
export function partManufacturer(comp, path) {
  if (path) return vendorOf(path);
  if (!comp || ['generic', 'std', 'common'].includes(comp.ns)) return '';
  return titled(comp.ns);
}

export const BOM_COLUMNS = ['section', 'qty', 'manufacturer', 'model', 'description', 'ref'];

export function bomRows({devices = [], parts = [], frame, railUs = []}) {
  const lines = new Map();
  const add = (key, row) => { const l = lines.get(key); if (l) l.qty++; else lines.set(key, {...row, qty: 1}); };
  for (const d of devices)
    add(`device|${d.ref}|${d.cfg}`, {section: 'Devices', manufacturer: d.manufacturer ?? '', model: d.model ?? d.ref,
      description: d.cfg ? `Configuration ${d.cfg}` : '', ref: d.ref});
  for (const p of parts)
    add(`part|${p.ref}`, {section: sectionOf(p.cls), manufacturer: p.manufacturer ?? '', model: p.model ?? '',
      description: p.description ?? '', ref: p.ref});
  const rows = [...lines.values()].sort((a, b) => sectionOrder(a.section) - sectionOrder(b.section)
    || String(a.model).localeCompare(String(b.model)) || String(a.ref).localeCompare(String(b.ref)));
  return [...rows, ...hardwareRows(frame, railUs)];
}

// 2 ears x 2 screws x each U a rail item covers (Task 2 draws the same).
export function hardwareRows(frame, railUs) {
  const qty = 4 * railUs.reduce((s, u) => s + Math.max(1, u), 0);
  if (!qty) return [];
  const row = model => ({section: 'Mounting hardware', qty, manufacturer: '', model,
    description: 'Two per ear for each U a device covers', ref: ''});
  if (frame.holes?.style === 'tapped') return [row(`Screw, ${frame.holes.thread || 'thread not stated'}`)];
  return [row('Cage nut, M6'), row('Screw, M6')];
}
export function hardwareNotes(frame) {
  if (frame.holes?.style !== 'tapped')
    return ["Cage nuts and screws are counted as M6, the usual size for square-hole rails; check your rack's own."];
  return frame.holes.thread ? [] : ['The rail thread is not set under Frame, so the screws are listed without one.'];
}
```

- [ ] **Step 4: Run the tests**

Run: `node --test tests/rack/*.test.mjs`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add site/rack/export-data.js tests/rack/bom.test.mjs
git commit -m "rack: the bill of materials, as data - seated parts by class, hardware 4 x U

A part counts when a bay or cage seats it, by its path; a chassis part is
the device's own line. Mounting hardware is two screws per ear per U:
cage nuts and M6 screws on square holes, screws of the thread on tapped.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The Export menu, the SVG sheet, each face alone, the PNG, and the rack file

**Files:**
- Create: `site/rack/exports.js`
- Modify: `rack.html` (the menu), `site/rack/rack.css`, `site/rack-page.js` (wiring), `check-browser.py` (`EXPORT_FIXTURE`, `open_fixture`, `export_file`, `check_rack_export_sheet`)

**Interfaces:**
- Consumes: `drawElevation`, `panelFor`, `configuredFace`, `itemsWithU`, `uLabel`, `standalone` (Task 1), and `titleLines`, `wrapText`, `faceNotes`, `rackNotes`, `uniq`, `fileStem` (Task 3).
- Produces:
  - `exports.js`:
    - `sheetSvg(rack, chassisOf, {faces=['front','rear'], date=new Date()}) → Promise<{name, data: string, type, notes}>`. The name is `<stem>-sheet.svg`, or `<stem>-<face>.svg` for one face.
    - `sheetPng(rack, chassisOf, opts) → Promise<{name: '<stem>-sheet.png', data: Uint8Array, type, notes}>`.
    - The internal helpers `faceOf(item, view)` and `faceNotesFor(rack, items, panes)`, which later tasks reuse.
  - `rack.html`: `<details class="rk-menu" id="exportMenu">` with `#exportItems` directly after `#frameBtn`, then `<span id="exportStatus">`.
    - Each entry is `<button data-export="<kind>">`.
    - The kinds added here are `sheet-svg`, `front-svg`, `rear-svg`, `sheet-png` and `json`.
  - `rack-page.js`:
    - `BUILD[kind]() → Promise<{name, data, type, notes} | {error}>`;
    - `runExport(kind)`;
    - `renderExports()`, rebuilt each time the menu opens and on a mode switch.
  - `check-browser.py`: `EXPORT_FIXTURE` (a dict), `open_fixture(page, base, fixture=EXPORT_FIXTURE)`, and `export_file(page, kind, timeout=READY_MS) → Download`.

- [ ] **Step 1: Write the fixture, the helpers and the failing check**

In `check-browser.py`, directly after `def pick(…)`:

```python
# THE EXPORT FIXTURE: a 24U four-post rack holding the cases every export
# has to get right - a seated card (core-1's slot-2), an optic with a label
# (leaf-1's port-1), a U shared front and rear (U14), and two devices with
# the same label (demarc).
EXPORT_FIXTURE = {
    "format": "portrayal-rack", "version": 1, "id": "doc-export-fixture",
    "racks": [{
        "id": "r1", "name": "Export test",
        "frame": {"kind": "four-post", "heightRU": 24, "numbering": "bottom-up",
                  "holes": {"style": "square", "thread": None},
                  "railDepth": 740, "usableDepth": 1000, "ref": None},
        "items": [
            {"id": "i1", "ref": "asr-9006", "cfg": "base", "label": "core-1", "ru": 2, "face": "front",
             "turned": False, "swaps": {"slot-2": "cisco/a9k-16x100ge-tr@1"}, "fields": {}},
            {"id": "i2", "ref": "as7726-32x", "cfg": "ac-f2b", "label": "leaf-1", "ru": 14, "face": "front",
             "turned": False, "swaps": {"port-1": "generic/qsfp-lc@2"},
             "fields": {"port-1-occupant": {"label": "LR4"}}},
            {"id": "i3", "ref": "tm-280", "cfg": "base", "label": "demarc", "ru": 14, "face": "rear",
             "turned": False, "swaps": {}, "fields": {}},
            {"id": "i4", "ref": "tm-280", "cfg": "base", "label": "demarc", "ru": 20, "face": "rear",
             "turned": False, "swaps": {}, "fields": {}},
        ],
        "zeroU": [], "cables": []}]}


def open_fixture(page, base, fixture=EXPORT_FIXTURE):
    page.goto(f"{base}/rack.html?probe=1", wait_until="load")
    page.wait_for_function("() => window.__rack && window.__rack.ready", timeout=READY_MS)
    page.evaluate("() => window.__rack.ready")
    rack = fixture["racks"][0]
    page.set_input_files("#openFile", files=[{"name": "fixture.rack.json", "mimeType": "application/json",
                                              "buffer": json.dumps(fixture).encode()}])
    page.wait_for_function("(n) => window.__rack.doc().racks[0].name === n", arg=rack["name"], timeout=READY_MS)
    page.wait_for_function(
        """(n) => document.querySelectorAll('svg[data-pane="front"] [data-item-id][data-panel]').length >= n""",
        arg=len(rack["items"]), timeout=READY_MS)


def export_file(page, kind, timeout=READY_MS):
    page.click("#exportMenu > summary")
    with page.expect_download(timeout=timeout) as dl:
        page.click(f'#exportItems [data-export="{kind}"]')
    return dl.value
```

Before `def main():`:

```python
@extra("rack.html: Export - the SVG sheet and PNG carry both faces as configured, a title block and notes, no screen UI")
def check_rack_export_sheet(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    open_fixture(page, base)
    root_tag = lambda t: (re.search(r"<svg[^>]*>", t) or [""])[0]

    dl = export_file(page, "sheet-svg")
    if dl.suggested_filename != "Export-test-sheet.svg":
        bad.append(f"sheet: named {dl.suggested_filename!r}")
    text = pathlib.Path(dl.path()).read_text(encoding="utf-8")
    for ref, want in (("asr-9006", 2), ("as7726-32x", 2), ("tm-280", 4)):   # once per face per item
        got = text.count(f'data-device-ref="{ref}"')
        if got != want:
            bad.append(f"sheet: {ref} drawn {got} times, expected {want}")
    for bit in ('data-pane="front"', 'data-pane="rear"', 'data-ref="cisco/a9k-16x100ge-tr@1',
                'data-ref="generic/qsfp-lc@2', ">Export test<", "Four-post frame, 24U, U1 at the bottom",
                "Rail depth 740 mm · usable depth 1000 mm", "Square holes (cage nuts)"):
        if bit not in text:
            bad.append(f"sheet: missing {bit!r}")
    if not re.search(r"Drawn \d{4}-\d{2}-\d{2} with the Portrayal Rack Builder", text):
        bad.append("sheet: no dated title line")
    for ui_bit in ('class="rk-u', "data-pt-ui", "rk-selected", "rk-sel-ring"):
        if ui_bit in text:
            bad.append(f"sheet: screen UI in the file ({ui_bit})")
    root = root_tag(text)
    if ' width="' not in root or ' height="' not in root:
        bad.append(f"sheet: the root <svg> has no width and height ({root[:120]!r})")

    dl = export_file(page, "front-svg")
    front = pathlib.Path(dl.path()).read_text(encoding="utf-8")
    if dl.suggested_filename != "Export-test-front.svg" or 'data-pane="rear"' in front \
            or 'data-pane="front"' not in front:
        bad.append(f"front only: {dl.suggested_filename!r} is not the front face alone")

    dl = export_file(page, "sheet-png")
    png = pathlib.Path(dl.path()).read_bytes()
    if dl.suggested_filename != "Export-test-sheet.png" or png[:8] != b"\x89PNG\r\n\x1a\n":
        bad.append(f"sheet PNG: {dl.suggested_filename!r} is not a PNG")
    else:
        w, h = int.from_bytes(png[16:20], "big"), int.from_bytes(png[20:24], "big")
        if w < 2000 or h < 2000 or len(png) < 50_000:
            bad.append(f"sheet PNG: {w}x{h}, {len(png)} bytes - not the sheet at 2x")

    dl = export_file(page, "json")
    if dl.suggested_filename != "Export-test.rack.json":
        bad.append(f"rack file: named {dl.suggested_filename!r}")

    # A face nobody drew is listed in the sheet's notes block.
    notes_fixture = json.loads(json.dumps(EXPORT_FIXTURE))
    notes_fixture["id"] = "doc-export-notes"
    notes_fixture["racks"][0]["name"] = "Export notes"
    notes_fixture["racks"][0]["items"].append(
        {"id": "i5", "ref": "no-such-device", "cfg": "base", "label": "mystery", "ru": 22, "face": "front",
         "turned": False, "swaps": {}, "fields": {}})
    open_fixture(page, base, notes_fixture)
    text = pathlib.Path(export_file(page, "sheet-svg").path()).read_text(encoding="utf-8")
    for bit in (">Notes<", "mystery at U22: no front drawing, so the front shows an outline.",
                "mystery at U22: no rear drawing, so the rear shows an outline."):
        if bit not in text:
            bad.append(f"sheet notes: missing {bit!r}")
    return bad
```

Run: `python3 check-browser.py --only check_rack_export_sheet`
Expected: FAIL, a timeout on `#exportMenu > summary`.

- [ ] **Step 2: Create `site/rack/exports.js`**

```js
// THE RACK, EXPORTED (spec §8). Every file is built from the rack document
// through configuredFace - never from the panes on screen, whose hit
// targets, selection and zoom are the page's, not the rack's. Each builder
// resolves to {name, data, type, notes}: `notes` lists what could not be
// resolved (a face never drawn, a part that would not seat, a device with
// no DCIM type), and the file carries the same list - a notes block on the
// sheet, a comment in the draw.io file, NOTES.txt in a zip, a comments
// column or a notes section in a CSV - rather than dropping it.
//
// The rules (names, CSV, matching, counting) are export-data.js's, which
// has no DOM and is tested with node --test.

import {RU, RAIL_W, OPENING} from './rails.js';
import {drawElevation, panelFor} from './elevation.js';
import {configuredFace} from './face.js';
import {itemsWithU} from './fit.js';
import {uLabel} from './model.js';
import {el, svgEl} from './dom.js';
import {standalone} from '../svg-export.js';
import {rasterize} from '../raster.js';
import {uniq, fileStem, titleLines, wrapText, faceNotes, rackNotes} from './export-data.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const FACE_W = OPENING + RAIL_W * 2 + 12;     // drawElevation's own viewBox width
const M = 24, GAP = 48, HEAD = 28, LINE = 16, NOTE_LINE = 13;
// The sheet is paper: fixed ink on white, whatever the page's theme.
const INK = '#1D2125', MUTED = '#5B636B', PAPER = '#FFFFFF', RULE = '#B9BFC6';

// The same key drawElevation asks with, so the memo answers both.
export const faceOf = (it, view) => configuredFace({ref: it.ref, cfg: it.cfg, view,
  swaps: it.swaps || {}, fields: it.fields || {}}).catch(() => null);

// What the panes named could not show, item by item.
export async function faceNotesFor(rack, items, panes) {
  const notes = [...rackNotes(rack)];
  for (const it of items) {
    for (const pane of panes) {
      const panel = panelFor(it, pane);
      notes.push(...faceNotes({label: it.label, u: uLabel(rack.frame, it.ru), pane, panel,
                               face: await faceOf(it, panel)}));
    }
  }
  return uniq(notes);
}

const text = (x, y, s, {size = 11, weight = 400, fill = INK, mono = false} = {}) => {
  const t = svgEl('text', {x, y, 'font-size': size, 'font-weight': weight, fill,
    'font-family': mono ? 'IBM Plex Mono, ui-monospace, monospace' : 'Archivo, system-ui, sans-serif'});
  t.textContent = s;
  return t;
};

// THE SHEET: the faces asked for, side by side, fresh from drawElevation
// (no hit targets, no selection; ears and metal, as the page draws them),
// over a title block and, when there are any, the notes. The root carries a
// width and height in millimeters-as-pixels, so rasterize() draws it at its
// real size. `standalone` bakes the few `var(--pt-*)` paints (a missing
// face's outline) while the sheet is attached, as cabledElevationSvg does.
export async function sheetSvg(rack, chassisOf, {faces = ['front', 'rear'], date = new Date()} = {}) {
  const items = itemsWithU(rack, chassisOf);
  const notes = await faceNotesFor(rack, items, faces);
  const panes = await Promise.all(faces.map(view =>
    drawElevation({items, frame: rack.frame, view, ears: true, metal: true})));
  const faceH = rack.frame.heightRU * RU + 30;       // drawElevation's own viewBox height
  const width = M * 2 + faces.length * FACE_W + (faces.length - 1) * GAP;
  const chars = Math.floor((width - M * 2 - 24) / 6.2);   // 10 px mono runs about 6 px a character
  const noteLines = notes.flatMap(n => wrapText(n, chars - 2).map((l, i) => (i ? `  ${l}` : `• ${l}`)));

  const sheet = svgEl('svg', {xmlns: SVG_NS});
  const paper = svgEl('rect', {x: 0, y: 0, fill: PAPER});
  sheet.append(paper);
  panes.forEach((pane, i) => {
    const x = M + i * (FACE_W + GAP);
    sheet.append(text(x, M + 16, faces[i] === 'front' ? 'Front' : 'Rear', {size: 14, weight: 600}));
    pane.setAttribute('x', x.toFixed(2));
    pane.setAttribute('y', String(M + HEAD));
    pane.setAttribute('width', FACE_W.toFixed(2));
    pane.setAttribute('height', faceH.toFixed(2));
    sheet.append(pane);
  });

  const blockY = M + HEAD + faceH + 24;
  const box = svgEl('rect', {x: M, y: blockY, width: (width - 2 * M).toFixed(2), fill: 'none', stroke: RULE});
  sheet.append(box);
  let y = blockY + 22;
  titleLines(rack, date).forEach((line, i) => {
    sheet.append(text(M + 12, y, line, i ? {fill: MUTED} : {size: 14, weight: 600}));
    y += LINE;
  });
  if (noteLines.length) {
    y += 6;
    sheet.append(text(M + 12, y, 'Notes', {weight: 600}));
    for (const l of noteLines) { y += NOTE_LINE; sheet.append(text(M + 12, y, l, {size: 10, fill: MUTED, mono: true})); }
  }
  const blockH = y - blockY + 12;
  box.setAttribute('height', blockH.toFixed(2));
  const height = blockY + blockH + M;
  for (const [k, v] of [['width', width], ['height', height]]) {
    sheet.setAttribute(k, v.toFixed(2));
    paper.setAttribute(k, v.toFixed(2));
  }
  sheet.setAttribute('viewBox', `0 0 ${width.toFixed(2)} ${height.toFixed(2)}`);

  const host = el('div', {'aria-hidden': 'true'});
  host.style.cssText = 'position:fixed;left:0;top:0;width:800px;visibility:hidden;pointer-events:none';
  document.body.append(host);
  try {
    host.append(sheet);
    const stem = fileStem(rack.name);
    return {name: faces.length === 1 ? `${stem}-${faces[0]}.svg` : `${stem}-sheet.svg`,
            data: standalone(sheet), type: 'image/svg+xml', notes};
  } finally {
    host.remove();
  }
}

// rasterize() only takes a URL, so the sheet goes through a blob URL.
export async function sheetPng(rack, chassisOf, opts = {}) {
  const svg = await sheetSvg(rack, chassisOf, opts);
  const url = URL.createObjectURL(new Blob([svg.data], {type: 'image/svg+xml'}));
  try {
    const bytes = await rasterize(url, 2);
    if (!bytes) throw new Error('the sheet could not be rasterized');
    return {name: svg.name.replace(/\.svg$/, '.png'), data: bytes, type: 'image/png', notes: svg.notes};
  } finally {
    URL.revokeObjectURL(url);
  }
}
```

- [ ] **Step 3: Add the menu to `rack.html` and style it**

In `rack.html`, directly after `<button type="button" id="frameBtn">Frame</button>`:

```html
    <details class="rk-menu" id="exportMenu">
      <summary>Export</summary>
      <div class="rk-menu-items" id="exportItems"></div>
    </details>
    <span class="rk-muted rk-export-status" id="exportStatus" role="status" aria-live="polite"></span>
```

Append to `site/rack/rack.css`:

```css
/* The export status sits between the Export menu and the zoom controls;
   .rk-zoom's margin-left: auto absorbs its width, so the 2D/3D switch never
   moves when it changes. */
.rk-export-status { font-size: 0.85rem; max-width: 18rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#exportItems { min-width: 19rem; }
```

- [ ] **Step 4: Wire it in `site/rack-page.js`**

Add these imports:

```js
import {sheetSvg, sheetPng} from './rack/exports.js';
import {save} from './svg-export.js';
```

Add this section after `undoShrink()`:

```js
// ── Export (spec §8) ────────────────────────────────────────────────────
// Every export is built from S.doc by exports.js, never from the panes. A
// builder resolves to {name, data, type, notes}, or {error: sentence}; the
// notes travel inside the file, and the status line only counts them.
const BUILD = {
  'sheet-svg': () => sheetSvg(rack(), chassisOf),
  'front-svg': () => sheetSvg(rack(), chassisOf, {faces: ['front']}),
  'rear-svg': () => sheetSvg(rack(), chassisOf, {faces: ['rear']}),
  'sheet-png': () => sheetPng(rack(), chassisOf),
};
let exporting = false;
async function runExport(kind) {
  if (kind === 'json') { downloadDoc(S.doc); return; }
  if (kind === 'to-3d') { setMode('3d'); return; }
  if (exporting || !BUILD[kind]) return;
  exporting = true;
  const status = $('exportStatus');
  status.textContent = 'Preparing…';
  try {
    const out = await BUILD[kind]();
    if (out.error) { status.textContent = out.error; return; }
    save(out.data, out.name, out.type);
    const n = out.notes?.length || 0;
    status.textContent = n ? `Downloaded, with ${n} note${n === 1 ? '' : 's'} in the file.` : 'Downloaded.';
  } catch (err) {
    console.warn('[portrayal] export', kind, err);
    status.textContent = "That export didn't work. Try again.";
  } finally {
    exporting = false;
  }
}
function renderExports() {
  const act = (kind, text, title = '') => {
    const b = el('button', {type: 'button', 'data-export': kind, text, ...(title ? {title} : {})});
    b.addEventListener('click', () => { $('exportMenu').open = false; runExport(kind); });
    return b;
  };
  $('exportItems').replaceChildren(
    act('sheet-svg', 'Sheet, front and rear (.svg)'),
    act('front-svg', 'Front only (.svg)'),
    act('rear-svg', 'Rear only (.svg)'),
    act('sheet-png', 'Sheet as a picture (.png)'),
    el('hr'),
    act('json', 'Rack file (.json)'),
  );
}
```

In `bootInner`, next to the `libMenu` toggle listener:

```js
  $('exportMenu').addEventListener('toggle', () => { if ($('exportMenu').open) renderExports(); });
```

In `setMode`, directly after `paintMode();`:

```js
  if ($('exportMenu').open) renderExports();   // the 3D entries follow the mode
```

- [ ] **Step 5: Run the checks**

Run: `python3 check-browser.py --only check_rack_export_sheet,check_rack_mode_toggle_stable,check_rack_page,check_rack_no_idb`
Expected: all pass.

Then, at `http://localhost:8932/rack.html`, export the sheet SVG and PNG and open both. Confirm:
- the faces line up;
- ears, cards and optics are drawn;
- the title block reads correctly;
- the picture is the same in light and dark mode.

- [ ] **Step 6: Commit**

```bash
git add site/rack/exports.js rack.html site/rack/rack.css site/rack-page.js check-browser.py
git commit -m "rack: Export - the SVG sheet, each face alone, a PNG at 2x, and the rack file

The sheet is drawn fresh from the rack document - front and rear side by
side, a title block, and a notes block for anything a face could not show -
and never copied from the panes, so no hit target or selection leaks in.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: draw.io, one page per face

**Files:**
- Modify: `site/drawio.js` (`rackDiagram`), `site/rack/exports.js` (`drawioFile`), `site/rack-page.js`, `check-browser.py` (`check_drawio_group_faces`, `check_rack_export_drawio`; add `import xml.etree.ElementTree as ET` to the imports)

**Interfaces:**
- `rackDiagram` gains three optional inputs. With none of them given, its output is byte-identical to today's.
  - `group.faces`: that page's own faces list, overriding the `faces` option.
  - `m.id`: the id slugged into a device's cell ids, instead of `m.name`.
  - `rack.numDisp`: replaces `numDisp=ascend` in that cabinet's style.
- **Why per-face groups:** the spec asks for one page per face, and `rackDiagram` already makes one page per group. Giving each group its own `faces` and its own `mounted` list is the whole extension. Each cabinet then holds only what shows from that side (`perFaceItems`), and the four-post half-depth overlap never reaches draw.io, whose rack container would otherwise draw two pictures in one U. A per-face `mounted` map on each rack would have needed a second branch through the loop.
- **Why `m.id`:** cell ids are slugged from the name, and two items labeled `demarc` would produce duplicate ids.
- **Why `numDisp`:** the page's default numbering is bottom-up, and draw.io's `descend` prints 1 at the bottom.
- Produces: `exports.js` `drawioFile(rack, chassisOf) → {name: '<stem>.drawio', data, type: 'application/xml', notes}`, with the pages `Front` and `Rear` and the notes as a comment inside `<mxfile>`. The menu kind is `drawio`.

- [ ] **Step 1: Write the failing checks**

Add `import xml.etree.ElementTree as ET` to `check-browser.py`'s imports. Then add:

```python
@extra("draw.io: a group may name its own faces, a device its own id, a rack its numbering - defaults unchanged")
def check_drawio_group_faces(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    page.goto(f"{base}/index.html", wait_until="load")
    r = page.evaluate("""async () => {
      const D = await import('/site/drawio.js');
      const F = await import('/site/rack/face.js');
      const f = await F.configuredFace({ref: 'tm-280', cfg: 'base', view: 'front'});
      const b = await F.configuredFace({ref: 'tm-280', cfg: 'base', view: 'rear'});
      const face = x => ({svg: x.text, vb: x.vb, ports: x.ports});
      const mk = (extra = {}, m = {}) => [{label: 'P', ...extra, racks: [{label: 'R', units: 4,
        mounted: [{name: 'TM', u: 2, ru: 1, faces: {front: face(f), rear: face(b)}, ...m}]}]}];
      const a = D.rackDiagram(mk(), {faces: ['front', 'rear']});
      return {
        same: a === D.rackDiagram(mk({faces: ['front', 'rear']}), {faces: ['front']}),
        rearOnly: (x => !x.includes('value="R · front"') && x.includes('value="R · rear"'))(
          D.rackDiagram(mk({faces: ['rear']}), {faces: ['front', 'rear']})),
        nameIds: a.includes('id="TM-g0r0-front"'),
        ownIds: (x => x.includes('id="i7-g0r0-front"') && !x.includes('id="TM-g0r0-front"'))(
          D.rackDiagram(mk({}, {id: 'i7'}))),
        ascend: a.includes('numDisp=ascend;'),
        descend: D.rackDiagram([{label: 'P', racks: [{label: 'R', units: 4, numDisp: 'descend', mounted: []}]}])
          .includes('numDisp=descend;'),
      };
    }""")
    for k in ("same", "rearOnly", "nameIds", "ownIds", "ascend", "descend"):
        if not r.get(k):
            bad.append(f"rackDiagram: {k} is {r.get(k)!r}")
    return bad


@extra("rack.html: Export - draw.io has a page per face, only what shows from each side, and a seated card's ports")
def check_rack_export_drawio(page, base):
    from collections import Counter
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    open_fixture(page, base)
    dl = export_file(page, "drawio")
    if dl.suggested_filename != "Export-test.drawio":
        bad.append(f"draw.io: named {dl.suggested_filename!r}")
    text = pathlib.Path(dl.path()).read_text(encoding="utf-8")
    try:
        root = ET.fromstring(text)
    except ET.ParseError as e:
        return bad + [f"draw.io: not well-formed XML ({e})"]
    pages = {d.get("name"): d for d in root.findall("diagram")}
    if set(pages) != {"Front", "Rear"}:
        return bad + [f"draw.io: pages {sorted(pages)}, expected Front and Rear"]
    values = {n: [e.get("value") for e in p.iter() if e.get("value") is not None] for n, p in pages.items()}
    for n, p in pages.items():
        dup = [i for i, c in Counter(e.get("id") for e in p.iter() if e.get("id")).items() if c > 1]
        if dup:
            bad.append(f"draw.io {n}: duplicate cell ids {dup[:5]}")
    if values["Front"].count("demarc") != 1:
        bad.append("draw.io Front: expected one demarc (U20's, from behind); U14's is behind leaf-1")
    if "leaf-1" in values["Rear"]:
        bad.append("draw.io Rear: leaf-1 is drawn, but demarc is mounted in front of it there")
    if values["Rear"].count("demarc") != 2 or "core-1" not in values["Rear"]:
        bad.append("draw.io Rear: expected both demarcs and core-1's rear")
    if 'portrayal-path="slot-2/module/p0"' not in ET.tostring(pages["Front"], encoding="unicode"):
        bad.append("draw.io Front: no port cell for core-1's seated card")
    if "numDisp=descend;" not in text:
        bad.append("draw.io: a bottom-up rack is not numbered from the bottom")
    if "is behind leaf-1" not in text:
        bad.append("draw.io: the notes comment does not list the device hidden behind leaf-1")
    return bad
```

Run: `python3 check-browser.py --only check_drawio_group_faces,check_rack_export_drawio`
Expected: both FAIL. `same`, `rearOnly`, `ownIds` and `descend` are false, and there is no `drawio` menu entry.

- [ ] **Step 2: Extend `rackDiagram` in `site/drawio.js`**

1. Add to the `rackDiagram` doc comment:
   "A group may carry its own `faces` (the Rack Builder draws one page per face), a mounted device its own `id` (cell ids are slugged from it instead of the name, which two devices can share), and a rack its own `numDisp` (`descend` prints 1 at the bottom). Without them, the output is exactly what it always was."
2. Replace
   ```js
     const pairWidth = faces.length * RACK.outer + (faces.length - 1) * FACE_GAP;
   ```
   with
   ```js
     const pairWidthOf = fs => fs.length * RACK.outer + (fs.length - 1) * FACE_GAP;
   ```
3. At the top of the `groups.map((group, gi) => {` body add:
   ```js
       const gFaces = group.faces || faces;
       const pairWidth = pairWidthOf(gFaces);
   ```
   Then change `faces.forEach((face, i) => {` to `gFaces.forEach((face, i) => {`.
4. In the cabinet `cells.push(cell(rackId, …, style, …))`, pass
   ```js
   rack.numDisp ? style.replace('numDisp=ascend;', `numDisp=${rack.numDisp};`) : style
   ```
   instead of `style`.
5. Change `` const id = `${slug(m.name)}-g${gi}r${r}-${face}`; `` to `` const id = `${slug(m.id ?? m.name)}-g${gi}r${r}-${face}`; ``.

- [ ] **Step 3: Add `drawioFile` to `site/rack/exports.js`**

Add `import {rackDiagram} from '../drawio.js';`, and add `xmlComment, perFaceItems, drawioU` to the `export-data.js` import. Then:

```js
// DRAW.IO (spec §8): one page per face. Each cabinet holds what is mounted
// on that side and the far panel of whatever nothing mounted there covers
// (perFaceItems); a device hidden behind another is listed in the notes.
// Each face is the configured face that side shows (panelFor), so a seated
// card's ports are connection points carrying portrayal-path.
export async function drawioFile(rack, chassisOf) {
  const items = itemsWithU(rack, chassisOf);
  const H = rack.frame.heightRU;
  const lists = perFaceItems(items);
  const notes = await faceNotesFor(rack, items, ['front', 'rear']);
  for (const h of lists.hidden)
    notes.push(`${h.pane === 'front' ? 'Front' : 'Rear'} page: ${h.item.label} is behind ${h.by.label} and is not drawn there.`);
  const numDisp = rack.frame.numbering === 'top-down' ? 'ascend' : 'descend';
  const groups = [];
  for (const pane of ['front', 'rear']) {
    const mounted = await Promise.all(lists[pane].map(async it => {
      const f = await faceOf(it, panelFor(it, pane));
      return {id: it.id, name: it.label, u: drawioU(H, it.ru, it.u), ru: it.u,
              faces: f ? {[pane]: {svg: f.text, vb: f.vb, ports: f.ports}} : {}};
    }));
    groups.push({label: pane === 'front' ? 'Front' : 'Rear', faces: [pane],
                 racks: [{label: rack.name, units: H, numDisp, mounted}]});
  }
  const all = uniq(notes);
  // The notes go INSIDE <mxfile>: draw.io reads its <diagram> children and
  // skips a comment there, and nothing is put before the root element.
  const xml = rackDiagram(groups, {labels: true})
    .replace('<mxfile host="portrayal">', m => m + xmlComment(all));
  return {name: `${fileStem(rack.name)}.drawio`, data: xml, type: 'application/xml', notes: all};
}
```

- [ ] **Step 4: Wire the menu entry**

In `site/rack-page.js`:
- import `drawioFile` alongside `sheetSvg`;
- add `drawio: () => drawioFile(rack(), chassisOf),` to `BUILD`;
- in `renderExports`, directly after `act('sheet-png', …),`, add:

```js
    el('hr'),
    act('drawio', 'draw.io diagram (.drawio)'),
```

- [ ] **Step 5: Run the checks**

Run: `python3 check-browser.py --only check_drawio_group_faces,check_rack_export_drawio,check_takeaway_drawio,check_drawio_port_paths,check_drawio_covers`
Expected: all pass. The showcase's draw.io checks confirm that its output is unchanged.

Then open the exported file at app.diagrams.net and confirm:
- there are two pages;
- U1 is at the bottom of each cabinet;
- devices sit against their real U numbers;
- a seated card's ports are connection points.

If draw.io prints `descend` with 1 at the top instead, swap the two `numDisp` values in `drawioFile` and in the check, and say so in the report.

- [ ] **Step 6: Commit**

```bash
git add site/drawio.js site/rack/exports.js site/rack-page.js check-browser.py
git commit -m "rack: Export - a draw.io file with a page per face, numbered like the rack

rackDiagram takes a page's own faces, a device's own id and a rack's own
numbering, all optional, so the showcase's file is unchanged. Each cabinet
holds only what shows from that side; what is hidden behind a mounted
device is named in the file's notes.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: GLB and USDZ from the 3D view; in 2D, a switch to 3D

**Files:**
- Modify: `site/rack3d.js` (name a device group when its entry has an `id`), `site/rack/scene3d.js` (pass `id`), `site/rack/exports.js` (`modelFile`), `site/rack-page.js` (`S.scene3dRack`, `sceneForExport`, menu), `check-browser.py` (`check_rack_export_3d`)

**Interfaces:**
- `createRackScene` stack entries may carry `id`. When one is present, that device's group is named `device-<id>`. The showcase and the hero pass no `id`, so their scenes and GLBs are unchanged.
- `exports.js` `modelFile(scene, rack, kind: 'glb' | 'usdz') → {name: '<stem>.<kind>', data, type, notes}`.
  - It awaits `scene.complete()`.
  - It writes `{rack, notes}` to `scene.three.scene.userData.portrayal`, which a GLB carries as the scene's `extras`.
- `rack-page.js`:
  - `sceneForExport() → scene | null` rebuilds first if the scene was built from an older rack.
  - The menu kinds are `glb` and `usdz` in 3D, and `to-3d` in 2D.

- [ ] **Step 1: Write the failing check**

```python
@extra("rack.html: Export - 2D offers a switch to 3D; GLB and USDZ name every device and carry the notes")
def check_rack_export_3d(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    open_fixture(page, base)
    page.click('#rkMode [data-mode="2d"]')
    page.click("#exportMenu > summary")
    page.wait_for_selector('#exportItems [data-export="to-3d"]', timeout=READY_MS)
    if page.query_selector('#exportItems [data-export="glb"]'):
        bad.append("3D export: 2D offers GLB, which only a 3D scene can make")
    page.click('#exportItems [data-export="to-3d"]')
    page.wait_for_function("() => window.__rack.scene() != null", timeout=READY_3D_MS)
    dl = export_file(page, "glb", timeout=READY_3D_MS)
    glb = pathlib.Path(dl.path()).read_bytes()
    if dl.suggested_filename != "Export-test.glb" or glb[:4] != b"glTF":
        bad.append(f"GLB: {dl.suggested_filename!r} is not a GLB")
    missing = [i for i in ("i1", "i2", "i3", "i4") if f'"device-{i}"'.encode() not in glb]
    if missing:
        bad.append(f"GLB: no node for device(s) {missing}")
    if b"Optic labels and colors are not in the 3D model yet: leaf-1." not in glb:
        bad.append("GLB: the notes are not in the scene's extras")
    dl = export_file(page, "usdz", timeout=READY_3D_MS)
    usdz = pathlib.Path(dl.path()).read_bytes()
    if dl.suggested_filename != "Export-test.usdz" or usdz[:2] != b"PK":
        bad.append(f"USDZ: {dl.suggested_filename!r} is not a USDZ")
    page.click('#rkMode [data-mode="2d"]')
    return bad
```

Run: `python3 check-browser.py --only check_rack_export_3d`
Expected: FAIL, a timeout on `[data-export="to-3d"]`.

- [ ] **Step 2: Name the device groups, only when asked**

In `site/rack3d.js`, directly after `const group = new THREE.Group();` in the device builder (≈L626):

```js
    // NAMED ONLY WHEN THE CALLER NAMES THE MOUNT. The Rack Builder passes each
    // item's id, so its GLB says which node is which device; the showcase and
    // the hero pass none, so their scenes and exports are exactly as before.
    if (entry.id) group.name = `device-${entry.id}`;
```

In `site/rack/scene3d.js`, add `id: item.id,` as the first key of the object each `rack.items.map(item => ({…}))` entry builds.

- [ ] **Step 3: Add `modelFile` to `site/rack/exports.js`**

Add `threeDNotes` to the `export-data.js` import, then:

```js
// GLB / USDZ (spec §8), from the scene the page built - after complete(), so
// the deferred relief pass (optics, plugs) has landed. The notes ride in the
// scene's userData, which GLTFExporter writes as the scene's `extras`.
export async function modelFile(scene, rack, kind) {
  await scene.complete();
  const notes = uniq([...rackNotes(rack), ...threeDNotes(rack)]);
  scene.three.scene.userData.portrayal = {rack: rack.name, notes};
  const usdz = kind === 'usdz';
  return {name: `${fileStem(rack.name)}.${usdz ? 'usdz' : 'glb'}`,
          data: usdz ? await scene.toUSDZ() : await scene.toGLB(),
          type: usdz ? 'model/vnd.usdz+zip' : 'model/gltf-binary', notes};
}
```

- [ ] **Step 4: Export only a scene built from the rack as it is now**

In `site/rack-page.js`:
- import `modelFile`;
- add `scene3dRack: null` to `S`;
- in `disposeScene3d`, directly after `S.scene3d = null;`, add `S.scene3dRack = null;`;
- in `rebuild3d`, directly after `const camera = S.camera3d;`, add `const forRack = rack();`;
- change `S.scene3d = built;` to `S.scene3d = built; S.scene3dRack = forRack;`.

Add, after `BUILD`:

```js
// A rebuild follows a commit 300 ms later (scheduleRebuild3d), so an export
// taken sooner would read the rack before the edit. The scene remembers which
// rack object it was built from; any other one is rebuilt first.
async function sceneForExport() {
  if (S.mode !== '3d') return null;
  if (!S.scene3d || S.scene3dRack !== rack()) { clearTimeout(rebuild3dTimer); await rebuild3d(); }
  return S.scene3d;
}
const NO_SCENE = {error: "3D isn't available in this browser, so there's no model to export."};
```

Add to `BUILD`:

```js
  glb: async () => { const sc = await sceneForExport(); return sc ? modelFile(sc, rack(), 'glb') : NO_SCENE; },
  usdz: async () => { const sc = await sceneForExport(); return sc ? modelFile(sc, rack(), 'usdz') : NO_SCENE; },
```

In `renderExports`, directly after `act('drawio', …),`, add:

```js
    ...(S.mode === '3d'
      ? [act('glb', '3D model (.glb)'), act('usdz', '3D model for Apple devices (.usdz)')]
      : [act('to-3d', '3D model (GLB, USDZ): switch to 3D',
             'GLB and USDZ export the 3D view, which 2D does not build')]),
```

- [ ] **Step 5: Run the checks**

Run: `python3 check-browser.py --only check_rack_export_3d,check_rack_3d,check_takeaway_cables_3d`
Expected: all pass. `check_takeaway_cables_3d` confirms that the showcase GLB still carries its cables.

Then open the GLB in a glTF viewer and confirm that each device node is named `device-i…`.

- [ ] **Step 6: Commit**

```bash
git add site/rack3d.js site/rack/scene3d.js site/rack/exports.js site/rack-page.js check-browser.py
git commit -m "rack: Export - GLB and USDZ from the 3D view, with every device named

An export waits for the relief pass, and rebuilds first if the scene
predates the last edit. Device nodes are named by item id; 2D offers a
switch to 3D in their place. The showcase's scene is untouched.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: DCIM device types, zipped, with NOTES.txt

**Files:**
- Modify: `site/rack/exports.js` (`seatedParts`, `dcimContext`, `dcimTypesZip`), `site/rack-page.js`, `check-browser.py` (`check_rack_export_dcim_types`; add `import zipfile`)

**Interfaces:**
- `seatedParts(svgText) → [{path, ref}]`: seated groups only (`isSeatedPath`), with the ref's version dropped.
- `dcimContext(rack, chassisOf, target, {modules = true}) → {items, types: Map(id → {path, guess, candidates, manufacturer, model, isFullDepth} | null), modules: [{ref, comp, model, path}], parts, notes}`.
  - Parts are read from each item's configured **front and rear** faces, deduplicated by `data-path`.
- `dcimTypesZip(rack, chassisOf, target, {date}) → {name: '<stem>-<target>-types.zip', data: Blob, …}`.
  - Entries are named like `exporter.html`'s, with the target prefix dropped (`device-types/Cisco/…yaml`), plus `NOTES.txt`.
- Menu kinds: `netbox-types`, `nautobot-types`.

- [ ] **Step 1: Write the failing check**

Add `import zipfile` to the imports, then:

```python
@extra("rack.html: Export - NetBox and Nautobot device types zip every device and part, with NOTES.txt")
def check_rack_export_dcim_types(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    open_fixture(page, base)
    want = {"device-types/Cisco/ASR-9006-AC-V2.yaml", "device-types/Edgecore/7726-32X-O-AC-F.yaml",
            "device-types/Telco Systems/TM-280.yaml", "module-types/Cisco/A9K-16X100GE-TR.yaml",
            "module-types/Cisco/A9K-3KW-AC.yaml", "module-types/Cisco/ASR-9006-FAN.yaml",
            "module-types/Cisco/A9K Slot Cover.yaml", "NOTES.txt"}
    for target, T in (("netbox", "NetBox"), ("nautobot", "Nautobot")):
        dl = export_file(page, f"{target}-types")
        if dl.suggested_filename != f"Export-test-{target}-types.zip":
            bad.append(f"{T} types: named {dl.suggested_filename!r}")
        with zipfile.ZipFile(dl.path()) as z:
            names = set(z.namelist())
            notes = z.read("NOTES.txt").decode() if "NOTES.txt" in names else ""
            head = z.read("device-types/Edgecore/7726-32X-O-AC-F.yaml").decode() \
                if "device-types/Edgecore/7726-32X-O-AC-F.yaml" in names else ""
        if want - names:
            bad.append(f"{T} types: missing {sorted(want - names)}")
        devices = sorted(n for n in names if n.startswith("device-types/"))
        if len(devices) != 3:
            bad.append(f"{T} types: {len(devices)} device types, expected 3 (two TM-280s share one): {devices}")
        if "ASR-9006-AC-V2 is a best guess" not in notes:
            bad.append(f"{T} types: NOTES.txt does not flag the ASR-9006's guessed type")
        if "generic/qsfp-lc@2" not in notes or f"no {T} module type" not in notes:
            bad.append(f"{T} types: NOTES.txt does not list the optic with no module type")
        if "model: 7726-32X-O-AC-F" not in head:
            bad.append(f"{T} types: the Edgecore YAML is not the exported file")
    return bad
```

Run: `python3 check-browser.py --only check_rack_export_dcim_types`
Expected: FAIL, a timeout on `[data-export="netbox-types"]`.

- [ ] **Step 2: Confirm what a seated part looks like** (read-only)

Run:

```bash
grep -o '<g [^>]*data-path="[^"]*/module"[^>]*>' assets/dist/asr-9006.base.front.svg | grep -c 'data-ref='
grep -o '<g [^>]*data-path="[^"]*/module"[^>]*>' assets/dist/asr-9006.base.front.svg | grep -vc 'data-ref='
```

Expected: `11`, then `0`. Every default-seated module carries `data-ref`, so reading the configured faces gives defaults and swaps alike.

If either count differs, stop and report. The fallback would be `vendor/swap.js`'s `builtBays(cfg)`/`builtOccupants(cfg, cages, ctx)` plus `item.swaps`, applied shallowest first. That is a different task.

- [ ] **Step 3: Add the DCIM builders to `site/rack/exports.js`**

Add these imports:
- `import {makeZip} from '../bundle.js';`
- extend the face import to `import {configuredFace, components, findComp} from './face.js';`
- add `matchDeviceType, yamlHead, moduleTypePath, partNumber, stemOf, dcimNotesText, isSeatedPath` to the `export-data.js` import.

Then:

```js
// ── DCIM (spec §8) ─────────────────────────────────────────────────────
const EXPORTS_BASE = 'assets/exports/';
const TARGET_NAME = {netbox: 'NetBox', nautobot: 'Nautobot'};
const TEXT = new Map();
function fetchText(url) {
  if (!TEXT.has(url)) {
    TEXT.set(url, fetch(url)
      .then(r => { if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return r.text(); })
      .catch(err => { TEXT.delete(url); throw err; }));
  }
  return TEXT.get(url);
}
const fetchJson = async url => JSON.parse(await fetchText(url));
const exportUrl = path => EXPORTS_BASE + path.split('/').map(encodeURIComponent).join('/');

// What a face has SEATED: a bay's module or a cage's occupant. Default
// parts carry data-ref exactly as swapped ones do, so this is the rack as
// configured - defaults, swaps, and a swapped carrier's own defaults - with
// no swap logic re-derived here.
export function seatedParts(svgText) {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  return [...doc.querySelectorAll('[data-ref][data-path]')]
    .map(n => ({path: n.getAttribute('data-path'), ref: n.getAttribute('data-ref').split(':')[0]}))
    .filter(p => isSeatedPath(p.path));
}

// Both of the device's own panels (not the panes': turned does not change
// what is in it), one part per path.
async function seatedPartsOf(items) {
  const parts = [], notes = [];
  for (const it of items) {
    const seen = new Set();
    for (const view of ['front', 'rear']) {
      const f = await faceOf(it, view);
      if (!f) { notes.push(`${it.label}: no ${view} drawing, so parts seen only from the ${view} are not listed.`); continue; }
      for (const p of seatedParts(f.text)) {
        if (seen.has(p.path)) continue;
        seen.add(p.path);
        parts.push({...p, itemId: it.id, label: it.label});
      }
    }
  }
  return {parts, notes};
}

export async function dcimContext(rack, chassisOf, target, {modules = true} = {}) {
  const T = TARGET_NAME[target];
  const [index, files, comps] = await Promise.all([
    fetchJson(`${EXPORTS_BASE}index.json`), fetchJson(`${EXPORTS_BASE}files.json`), components()]);
  const items = itemsWithU(rack, chassisOf);
  const notes = [...rackNotes(rack)];
  const types = new Map();
  for (const it of items) {
    const m = matchDeviceType({cfg: it.cfg, manufacturer: chassisOf(it.ref)?.manufacturer,
                               paths: index[it.ref]?.[target] || []});
    if (!m) { types.set(it.id, null); notes.push(`${it.label} (${it.ref}): no ${T} device type.`); continue; }
    const head = yamlHead(await fetchText(exportUrl(m.path)));
    types.set(it.id, {...m, manufacturer: head.manufacturer ?? '', model: head.model ?? '',
                      isFullDepth: head.isFullDepth});
    if (m.guess)
      notes.push(`${it.label} (${it.ref}, configuration ${it.cfg || 'default'}): ${stemOf(m.path)} is a best guess ` +
                 `among ${m.candidates} ${T} device types; none names this configuration.`);
  }
  const out = {items, types, modules: [], parts: [], notes};
  if (modules) {
    const {parts, notes: partNotes} = await seatedPartsOf(items);
    notes.push(...partNotes);
    const users = new Map();
    for (const p of parts) users.set(p.ref, [...(users.get(p.ref) || []), p.label]);
    for (const [ref, labels] of users) {
      const comp = findComp(comps, ref);
      const model = partNumber(comp);
      const path = moduleTypePath(files[target] || [], model);
      out.modules.push({ref, comp, model, path});
      if (!path) notes.push(`${ref}${model ? ` (${model})` : ''}: no ${T} module type; seated in ${uniq(labels).join(', ')}.`);
    }
    out.parts = parts;
  }
  out.notes = uniq(notes);
  return out;
}

export async function dcimTypesZip(rack, chassisOf, target, {date = new Date()} = {}) {
  const ctx = await dcimContext(rack, chassisOf, target);
  const enc = new TextEncoder();
  const paths = uniq([...ctx.types.values()].filter(Boolean).map(t => t.path)
    .concat(ctx.modules.map(m => m.path).filter(Boolean))).sort();
  const entries = [];
  for (const p of paths) {
    try { entries.push({name: p.split('/').slice(1).join('/'), bytes: enc.encode(await fetchText(exportUrl(p)))}); }
    catch { ctx.notes.push(`${p} couldn't be fetched, so it is not in this zip.`); }
  }
  entries.push({name: 'NOTES.txt', bytes: enc.encode(dcimNotesText({rackName: rack.name, target, date, notes: ctx.notes}))});
  return {name: `${fileStem(rack.name)}-${target}-types.zip`, data: await makeZip(entries, date),
          type: 'application/zip', notes: ctx.notes};
}
```

- [ ] **Step 4: Wire the menu entries**

In `site/rack-page.js`, import `dcimTypesZip` and add to `BUILD`:

```js
  'netbox-types': () => dcimTypesZip(rack(), chassisOf, 'netbox'),
  'nautobot-types': () => dcimTypesZip(rack(), chassisOf, 'nautobot'),
```

In `renderExports`, directly before `act('json', …),`, add:

```js
    act('netbox-types', 'NetBox device types (.zip)'),
    act('nautobot-types', 'Nautobot device types (.zip)'),
    el('hr'),
```

- [ ] **Step 5: Run the checks**

Run: `python3 check-browser.py --only check_rack_export_dcim_types,check_rack_export_sheet`
Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add site/rack/exports.js site/rack-page.js check-browser.py
git commit -m "rack: Export - NetBox and Nautobot device types for the rack, zipped

Every distinct device and every seated module and optic, read from the
configured faces - defaults and swaps alike. A guessed device type, and a
part with no module type, are listed in NOTES.txt.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: DCIM device import CSV, NetBox and Nautobot

**Files:**
- Modify: `site/rack/exports.js` (`deviceImportCsv`), `site/rack-page.js`, `check-browser.py` (`check_rack_export_device_csv`; add `import csv` and `import io`)

**Interfaces:**
- `deviceImportCsv(rack, chassisOf, target) → {name: '<stem>-<target>-devices.csv', data, type: 'text/csv', notes}`.
  - It uses `dcimContext(…, {modules: false})` and Task 4's `deviceImportRows`.
  - The file is pure CSV, so it stays importable. Its notes are in each row's `comments`.
- Menu kinds: `netbox-devices`, `nautobot-devices`.

- [ ] **Step 1: Write the failing check**

Add `import csv` and `import io` to the imports, then:

```python
def read_csv(dl):
    text = pathlib.Path(dl.path()).read_text(encoding="utf-8")
    data = text.partition("\r\n\r\nNotes\r\n")[0]
    reader = csv.DictReader(io.StringIO(data, newline=""))
    return reader.fieldnames, list(reader), text


@extra("rack.html: Export - device import CSVs name each device's type, position and face as NetBox and Nautobot read them")
def check_rack_export_device_csv(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    open_fixture(page, base)
    dl = export_file(page, "netbox-devices")
    if dl.suggested_filename != "Export-test-netbox-devices.csv":
        bad.append(f"NetBox CSV: named {dl.suggested_filename!r}")
    cols, rows, _ = read_csv(dl)
    if cols != ["name", "role", "manufacturer", "device_type", "status", "site", "rack", "position", "face", "comments"]:
        bad.append(f"NetBox CSV: columns {cols}")
    by = {r["name"]: r for r in rows}
    want = {"core-1": ("Cisco", "ASR-9006-AC-V2", "2", "front"), "leaf-1": ("Edgecore", "7726-32X-O-AC-F", "14", "front"),
            "demarc-i3": ("Telco Systems", "TM-280", "14", "rear"), "demarc-i4": ("Telco Systems", "TM-280", "20", "rear")}
    for name, (man, dt, pos, face) in want.items():
        r = by.get(name)
        if not r or (r["manufacturer"], r["device_type"], r["position"], r["face"]) != (man, dt, pos, face):
            bad.append(f"NetBox CSV: {name} is {r and (r['manufacturer'], r['device_type'], r['position'], r['face'])}")
    if not all(r["status"] == "planned" and r["rack"] == "Export test" for r in rows):
        bad.append("NetBox CSV: status or rack column wrong")
    if "best guess" not in by.get("core-1", {}).get("comments", ""):
        bad.append("NetBox CSV: core-1's guessed type is not said in comments")

    dl = export_file(page, "nautobot-devices")
    cols, rows, _ = read_csv(dl)
    if dl.suggested_filename != "Export-test-nautobot-devices.csv" or "device_type__model" not in (cols or []):
        bad.append(f"Nautobot CSV: {dl.suggested_filename!r} with columns {cols}")
    leaf = next((r for r in rows if r["name"] == "leaf-1"), {})
    if (leaf.get("device_type__model"), leaf.get("status__name")) != ("7726-32X-O-AC-F", "Planned"):
        bad.append(f"Nautobot CSV: leaf-1 is {leaf}")

    # Positions follow the frame's numbering.
    page.click("#frameBtn")
    page.select_option("#fNumbering", "top-down")
    page.wait_for_function("() => window.__rack.doc().racks[0].frame.numbering === 'top-down'", timeout=READY_MS)
    _, rows, _ = read_csv(export_file(page, "netbox-devices"))
    got = {r["name"]: r["position"] for r in rows}
    if got != {"core-1": "14", "leaf-1": "11", "demarc-i3": "11", "demarc-i4": "5"}:
        bad.append(f"NetBox CSV: top-down positions {got}")
    return bad
```

Run: `python3 check-browser.py --only check_rack_export_device_csv`
Expected: FAIL, a timeout on `[data-export="netbox-devices"]`.

- [ ] **Step 2: Add `deviceImportCsv`**

In `site/rack/exports.js`, add `deviceImportRows, toCsv` to the `export-data.js` import, then:

```js
// The device import (spec §8): one row per rail item. Pure CSV so it
// imports as is; each row's notes are in its own comments column.
export async function deviceImportCsv(rack, chassisOf, target) {
  const ctx = await dcimContext(rack, chassisOf, target, {modules: false});
  const {columns, rows} = deviceImportRows({rack, items: ctx.items, types: ctx.types, target});
  return {name: `${fileStem(rack.name)}-${target}-devices.csv`, data: toCsv(columns, rows),
          type: 'text/csv', notes: ctx.notes};
}
```

- [ ] **Step 3: Wire the menu entries**

In `site/rack-page.js`, import `deviceImportCsv` and add to `BUILD`:

```js
  'netbox-devices': () => deviceImportCsv(rack(), chassisOf, 'netbox'),
  'nautobot-devices': () => deviceImportCsv(rack(), chassisOf, 'nautobot'),
```

In `renderExports`, directly after `act('nautobot-types', …),`, add:

```js
    act('netbox-devices', 'NetBox device import (.csv)', 'Fill in role and site before importing'),
    act('nautobot-devices', 'Nautobot device import (.csv)', 'Fill in role and location before importing'),
```

- [ ] **Step 4: Run the checks**

Run: `node --test tests/rack/*.test.mjs && python3 check-browser.py --only check_rack_export_device_csv,check_rack_export_dcim_types`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add site/rack/exports.js site/rack-page.js check-browser.py
git commit -m "rack: Export - NetBox and Nautobot device import CSVs

One row per device, top down: its type exactly as the type's YAML names
it, its position in the frame's own numbering, its face, and a comments
column saying what was guessed. Role and site are left for the importer
to require.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: The bill of materials CSV

**Files:**
- Modify: `site/rack/exports.js` (`bomCsv`), `site/rack-page.js`, `check-browser.py` (`check_rack_export_bom`)

**Interfaces:**
- `bomCsv(rack, chassisOf) → {name: '<stem>-bom.csv', data, type: 'text/csv', notes}`.
  - The columns are `BOM_COLUMNS`.
  - A trailing `Notes` section holds the hardware assumptions, parts not in the index, faces never drawn, and devices of unknown size.
- Menu kind: `bom`.

**Deviation from spec §8, on purpose:** the spec says counts are "taken from `swaps`". This export counts what the configured faces **seat**, which is the defaults overridden by the swaps: the effective set the spec means.
- Counting `swaps` alone would miss every default PSU, fan and blank.
- Re-deriving the defaults would duplicate `swap.js`'s nested-carrier rules.
- Task 9 step 2 confirmed that default parts carry `data-ref`.

- [ ] **Step 1: Write the failing check**

```python
@extra("rack.html: Export - the BOM counts devices, modules, optics and 4 x U of mounting hardware")
def check_rack_export_bom(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    open_fixture(page, base)

    def qty(rows, section, key):
        return next((int(r["qty"]) for r in rows if r["section"] == section and key in (r["model"], r["ref"])), None)

    dl = export_file(page, "bom")
    if dl.suggested_filename != "Export-test-bom.csv":
        bad.append(f"BOM: named {dl.suggested_filename!r}")
    cols, rows, text = read_csv(dl)
    if cols != ["section", "qty", "manufacturer", "model", "description", "ref"]:
        bad.append(f"BOM: columns {cols}")
    for section, key, n in (("Devices", "ASR 9006", 1), ("Devices", "AS7726-32X", 1), ("Devices", "TM-280", 2),
                            ("Line cards", "A9K-16X100GE-TR", 1), ("Blanks", "A9K Slot Cover", 5),
                            ("Power supplies", "A9K-3KW-AC", 3), ("Fans", "ASR-9006-FAN", 2),
                            ("Optics", "generic/qsfp-lc@2", 1),
                            ("Mounting hardware", "Cage nut, M6", 52), ("Mounting hardware", "Screw, M6", 52)):
        got = qty(rows, section, key)
        if got != n:
            bad.append(f"BOM: {section} / {key} is {got}, expected {n}")
    if "\r\nNotes\r\n" not in text or "M6" not in text.partition("\r\nNotes\r\n")[2]:
        bad.append("BOM: no notes section naming the M6 assumption")

    # Tapped rails: screws of the chosen thread, no cage nuts.
    page.click("#frameBtn")
    page.select_option("#fHoles", "tapped")
    page.wait_for_selector("#fThread", timeout=READY_MS)
    page.select_option("#fThread", "12-24")
    page.wait_for_function("() => window.__rack.doc().racks[0].frame.holes.thread === '12-24'", timeout=READY_MS)
    _, rows, _ = read_csv(export_file(page, "bom"))
    if qty(rows, "Mounting hardware", "Screw, 12-24") != 52 or qty(rows, "Mounting hardware", "Cage nut, M6"):
        bad.append(f"BOM tapped: hardware rows {[(r['model'], r['qty']) for r in rows if r['section'] == 'Mounting hardware']}")
    return bad
```

Run: `python3 check-browser.py --only check_rack_export_bom`
Expected: FAIL, a timeout on `[data-export="bom"]`.

- [ ] **Step 2: Add `bomCsv`**

In `site/rack/exports.js`, add `bomRows, BOM_COLUMNS, hardwareNotes, partManufacturer, firstSentence` to the `export-data.js` import, then:

```js
// THE BILL OF MATERIALS (spec §8): each device by configuration, each
// seated part by reference (as configured - defaults and swaps alike, read
// off the configured faces), and the mounting hardware, 4 x U per device.
export async function bomCsv(rack, chassisOf) {
  const items = itemsWithU(rack, chassisOf);
  const [files, comps] = await Promise.all([
    fetchJson(`${EXPORTS_BASE}files.json`).catch(() => null), components()]);
  const {parts, notes} = await seatedPartsOf(items);
  notes.unshift(...rackNotes(rack));
  const devices = items.map(it => ({ref: it.ref, cfg: it.cfg,
    manufacturer: chassisOf(it.ref)?.manufacturer ?? '', model: chassisOf(it.ref)?.model ?? it.ref}));
  const lines = parts.map(p => {
    const comp = findComp(comps, p.ref);
    if (!comp) notes.push(`${p.ref} in ${p.label} is not in the component index; it is listed by its reference.`);
    const model = partNumber(comp);
    return {ref: p.ref, cls: comp?.class ?? 'other', model, description: firstSentence(comp?.description),
            manufacturer: partManufacturer(comp, moduleTypePath(files?.netbox || [], model))};
  });
  for (const it of items)
    if (!chassisOf(it.ref)) notes.push(`${it.label}: no size is known for ${it.ref}, so its hardware is counted for 1U.`);
  notes.push(...hardwareNotes(rack.frame));
  const all = uniq(notes);
  const rows = bomRows({devices, parts: lines, frame: rack.frame, railUs: items.map(i => i.u)});
  return {name: `${fileStem(rack.name)}-bom.csv`, data: toCsv(BOM_COLUMNS, rows, all), type: 'text/csv', notes: all};
}
```

- [ ] **Step 3: Wire the menu entry**

In `site/rack-page.js`:
- import `bomCsv`;
- add `bom: () => bomCsv(rack(), chassisOf),` to `BUILD`;
- in `renderExports`, directly after `act('nautobot-devices', …),`, add `act('bom', 'Bill of materials (.csv)'),`.

- [ ] **Step 4: Run the checks**

Run: `python3 check-browser.py --only check_rack_export_bom,check_rack_export_device_csv,check_rack_export_dcim_types`
Expected: all pass.

Then open the BOM in a spreadsheet and confirm that the sections read in order and that the notes sit below the table.

- [ ] **Step 5: Commit**

```bash
git add site/rack/exports.js site/rack-page.js check-browser.py
git commit -m "rack: Export - a bill of materials, including the screws

Devices by configuration; cards, supplies, fans, blanks, optics and plugs
as configured, grouped by class; and mounting hardware at two screws per
ear per U - cage nuts and M6 screws on square holes, screws of the chosen
thread on tapped. Assumptions are listed under Notes.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Phase 1a's deferred minor findings

**Files:**
- Modify:
  - `explorer.html` (`applyPendingFields`)
  - `site/rack-page.js` (focus restore; New rack name; boot's `try`)
  - `site/rack/model.js` (`nextId` prefix guard; `nextRackName`)
  - `site/rack/library.js` (`list()` through `parseDoc`)
  - `chassis-index.py` (`h`)
  - `tests/rack/model.test.mjs`
  - `check-browser.py` (`check_rack_lens_edges`, `check_rack_menu_and_warnings`, `check_rack_frame_focus`; extend `check_rack_no_idb` and `check_rack_library`)

**Interfaces:**
- `model.js`: `nextRackName(names) → 'Rack N'`, where N is one more than the highest `Rack k` in use. `nextId` counts only ids that start with its prefix.
- Carried item 6 (the showcase adapter's `id = e.ref`) is **not** done here. See "Carried to Phase 2".

- [ ] **Step 1: Write the failing tests**

Append to `tests/rack/model.test.mjs`:

```js
test('nextId counts only ids that carry its own prefix', () => {
  assert.equal(M.nextId([{id: 'z7'}, {id: 'i2'}], 'i'), 'i3');
});

test('nextRackName follows the highest "Rack N" in use', () => {
  assert.equal(M.nextRackName([]), 'Rack 1');
  assert.equal(M.nextRackName(['Rack 1']), 'Rack 2');
  assert.equal(M.nextRackName(['Lab', 'Rack 3', 'Rack 1']), 'Rack 4');
});
```

In `check_rack_no_idb`, before `return bad`:

```python
    # Without a library, New rack still counts up rather than naming every rack "Rack 1".
    page.on("dialog", lambda d: d.dismiss())
    for want in ("Rack 2", "Rack 3"):
        page.click("#libMenu > summary")
        page.click("#libItems button:has-text('New rack')")
        try:
            page.wait_for_function("(n) => window.__rack.doc().racks[0].name === n", arg=want, timeout=5000)
        except Exception:
            bad.append(f"rack page without IndexedDB: New rack is named {page.evaluate('() => window.__rack.doc().racks[0].name')!r}, expected {want!r}")
            break
```

In `check_rack_library`, after the `for k, v in want.items()` loop:

```python
    # list() reads a stored record through parseDoc, as get() does.
    listed = page.evaluate("""async () => {
      await new Promise((res, rej) => { const o = indexedDB.open('portrayal-racks', 1);
        o.onerror = rej; o.onsuccess = () => { const tx = o.result.transaction('docs', 'readwrite');
          tx.objectStore('docs').put({format: 'portrayal-rack', version: 1, id: 'doc-raw',
            racks: [{name: 42, frame: {}, items: []}], updatedAt: 1});
          tx.oncomplete = () => { o.result.close(); res(); }; tx.onerror = rej; }; });
      const L = await import('/site/rack/library.js');
      const lib = await L.openLibrary();
      const name = (await lib.list()).find(x => x.id === 'doc-raw')?.name;
      await lib.remove('doc-raw');
      return name;
    }""")
    if listed != "42":
        bad.append(f"library: list() names a stored rack {listed!r}, expected '42' (read through parseDoc)")
```

Add three new checks:

```python
@extra("the Explorer lens: Escape reads back like Done; a lens showing another device hands back nothing")
def check_rack_lens_edges(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    page.goto(f"{base}/index.html", wait_until="load")
    page.evaluate("""() => { window.__lens = import('/site/rack/explorer-lens.js').then(L =>
      L.openLens({ref: 'as7726-32x', cfg: 'ac-f2b', title: 'AS7726', swaps: {'port-1': 'generic/qsfp-lc@2'}})); }""")
    page.wait_for_function("() => !!document.querySelector('.rk-lens iframe')?.contentWindow?.portrayalEmbed",
                           timeout=READY_MS)
    page.evaluate("async () => { await document.querySelector('.rk-lens iframe').contentWindow.portrayalEmbed.ready; }")
    page.focus(".rk-lens-done")
    page.keyboard.press("Escape")
    r = page.evaluate("async () => await window.__lens")
    if not r or r.get("swaps", {}).get("port-1") != "generic/qsfp-lc@2":
        bad.append(f"lens: Escape read back {r!r}")
    if page.query_selector(".rk-lens"):
        bad.append("lens: the overlay is still open after Escape")
    page.evaluate("""() => { window.__lens2 = import('/site/rack/explorer-lens.js').then(L =>
      L.openLens({ref: 'no-such-device', cfg: 'base', title: 'Nothing'})); }""")
    page.click(".rk-lens-done", timeout=READY_MS)
    if page.evaluate("async () => await window.__lens2") is not None:
        bad.append("lens: a lens that never showed its device handed something back")
    return bad


@extra("rack.html: the library menu renames and marks the current rack; the summary lists depth warnings")
def check_rack_menu_and_warnings(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    page.goto(f"{base}/rack.html?probe=1", wait_until="load")
    page.wait_for_function("() => window.__rack && window.__rack.ready", timeout=READY_MS)
    page.evaluate("() => window.__rack.ready")
    page.once("dialog", lambda d: d.accept("Renamed rack"))
    page.click("#libMenu > summary")
    page.click("#libItems button:has-text('Rename')")
    page.wait_for_function("() => window.__rack.doc().racks[0].name === 'Renamed rack'", timeout=READY_MS)
    if (page.text_content("#rackName") or "") != "Renamed rack":
        bad.append("menu: the rack name in the bar did not follow a rename")
    page.click("#libMenu > summary")
    cur = page.wait_for_selector("#libItems .rk-current", timeout=READY_MS)
    if (cur.text_content() or "") != "Renamed rack":
        bad.append(f"menu: the current rack is marked {cur.text_content()!r}")
    page.click("#libMenu > summary")
    pick(page, "front", 10, "R740", "r740xd")
    page.wait_for_selector('svg[data-pane="front"] [data-device-ref="r740xd"][data-panel="mounted"]', timeout=READY_MS)
    page.click("#frameBtn")
    page.fill("#fUsable", "500")
    page.dispatch_event("#fUsable", "change")
    page.wait_for_function("() => window.__rack.doc().racks[0].frame.usableDepth === 500", timeout=READY_MS)
    page.click("#frameBtn")                       # back to the summary
    page.wait_for_selector(".rk-side .rk-error", timeout=READY_MS)
    if "this rack allows 500 mm" not in (page.text_content(".rk-side") or ""):
        bad.append(f"summary: no depth warning for the R740xd ({page.text_content('.rk-side')!r})")
    return bad


@extra("rack.html: the frame form keeps keyboard focus across a change")
def check_rack_frame_focus(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    page.goto(f"{base}/rack.html?probe=1", wait_until="load")
    page.wait_for_function("() => window.__rack && window.__rack.ready", timeout=READY_MS)
    page.evaluate("() => window.__rack.ready")
    page.click("#frameBtn")
    page.evaluate("() => { document.querySelector('#fNumbering').dataset.old = '1'; }")
    page.focus("#fNumbering")
    page.select_option("#fNumbering", "top-down")
    page.wait_for_function("() => { const s = document.querySelector('#fNumbering'); return s && !s.dataset.old; }",
                           timeout=READY_MS)
    if page.evaluate("() => document.activeElement && document.activeElement.id") != "fNumbering":
        bad.append("frame form: focus left the control that was just changed")
    return bad
```

- [ ] **Step 2: Run them and confirm which fail**

Run: `node --test tests/rack/model.test.mjs`
Expected: FAIL. `nextId` gives `i8`, and `M.nextRackName is not a function`.

Run: `python3 check-browser.py --only check_rack_no_idb,check_rack_library,check_rack_frame_focus,check_rack_lens_edges,check_rack_menu_and_warnings`
Expected:
- `check_rack_no_idb` fails: the new rack is "Rack 1".
- `check_rack_library` fails: the name is `42`, a number.
- `check_rack_frame_focus` fails.
- `check_rack_lens_edges` and `check_rack_menu_and_warnings` pass. They pin behavior that had no test.

- [ ] **Step 3: Fix each**

- **`site/rack/model.js`:**
  - In `nextId`, change the first line to `const used = list.filter(x => String(x.id).startsWith(prefix)).map(x => Number(String(x.id).slice(prefix.length))).filter(Number.isInteger);`.
  - Add:

    ```js
    // "Rack N" for a new rack: one past the highest N in use, so names never
    // repeat - with or without a library to count.
    export function nextRackName(names) {
      const used = names.map(n => /^Rack (\d+)$/.exec(String(n))?.[1]).filter(Boolean).map(Number);
      return `Rack ${Math.max(0, ...used) + 1}`;
    }
    ```
- **`site/rack-page.js`:**
  - **New rack:** import `nextRackName`. In the New rack action, replace ``newDoc({name: `Rack ${(await S.lib.list()).length + 1}`})`` with `newDoc({name: nextRackName([...(await S.lib.list()).map(x => x.name), rack().name])})`.
  - **Focus restore:** in `renderSide`, as its first line, add:

    ```js
      // Rebuilding the panel must not take keyboard focus away (a frame edit
      // redraws the form): the control that had it gets it back, by id.
      const had = document.activeElement;
      const focusId = had && $('side').contains(had) ? had.id : '';
    ```

    Directly after `$('side').replaceChildren(...kids);`, add `if (focusId) document.getElementById(focusId)?.focus();`.
  - **Boot's `try`:** in `bootInner`, replace `try { const last = localStorage.getItem(LAST); if (last) doc = await getDoc(last); } catch { /* none */ }` with:

    ```js
      let last = null;
      try { last = localStorage.getItem(LAST); } catch { /* storage blocked: no last rack */ }
      if (last) doc = await getDoc(last);   // getDoc already reports null rather than throwing
    ```
- **`site/rack/library.js` `list()`:** replace the `all.map(…)` line with:

  ```js
      return all.map(d => {
        // Read as get() reads it, so a migrated or older record lists by the
        // name it opens with; one that will not parse still lists as stored
        // (opening it says why).
        let name = d.racks?.[0]?.name ?? 'Rack';
        try { name = parseDoc(d).racks[0].name; } catch { /* listed as stored */ }
        return {id: d.id, name, updatedAt: d.updatedAt ?? 0};
      }).sort((a, b) => b.updatedAt - a.updatedAt);
  ```
- **`explorer.html` `applyPendingFields`:** wrap the body so `ready` always settles:

  ```js
  function applyPendingFields() {
    const map = pendingFields;
    pendingFields = null;
    try {
      if (map) {
        for (const [path, vals] of Object.entries(map)) shell.setFields(path, vals);
        writeLocation();
      }
    } finally {
      // Settled either way - a URL naming none is done applying them too, and a
      // throw here must not leave the embed's `ready` pending for ever.
      fieldsSettled();
    }
  }
  ```

  No test drives this: making `shell.setFields` throw would need a hook into Explorer's shell that the page does not expose. The lens checks cover the normal path.
- **`chassis-index.py`:** change `h = c.get("h") or RU` to `h = c.get("h") if c.get("h") is not None else RU`, with the comment `# a stated 0 (a zero-U part's face) is a height, not a missing one`. This is latent: no device has `h: 0` today.

- [ ] **Step 4: Run everything touched**

Run: `node --test tests/rack/*.test.mjs && ./chassis-index.py && git diff --exit-code site/rack/chassis.json`
Expected: tests pass, and `chassis.json` is unchanged.

Run: `python3 check-browser.py --only check_rack_no_idb,check_rack_library,check_rack_frame_focus,check_rack_lens_edges,check_rack_menu_and_warnings,check_rack_lens,check_rack_page,check_rack_shrink,check_rack_import_keeps_library`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add explorer.html site/rack-page.js site/rack/model.js site/rack/library.js chassis-index.py tests/rack/model.test.mjs check-browser.py
git commit -m "rack: Phase 1a's deferred minor fixes

The frame form keeps focus across an edit; new racks count up without a
library; list() reads records through parseDoc; nextId counts only its own
prefix; Explorer's embed always settles ready; chassis-index keeps a stated
zero height. New checks pin the lens's Escape and null paths, the library
menu, and the summary's depth warnings.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Phase 1b wrap-up

**Files:**
- Modify: `rack.html` (`#devNote`), `check-browser.py` (`check_rack_dev_note`), `docs/superpowers/specs/2026-09-26-rack-builder-design.md` (the status line)

- [ ] **Step 1: The in-development note says what is next** (needs PR #60, see "Before you start")

In `check_rack_dev_note`, replace

```python
    for want in ("still being built", "Coming next", "cabling"):
```

with

```python
    for want in ("still being built", "Coming next: cabling."):
```

After that loop, add:

```python
    if "exports" in body.lower():
        bad.append("dev note: it still lists exports as coming, and they have shipped")
```

Run: `python3 check-browser.py --only check_rack_dev_note`
Expected: FAIL. The note still reads "Coming next: exports (…), then cabling."

In `rack.html`, change `#devNote`'s second paragraph to `<p>Coming next: cabling.</p>`. Leave the pill and the first paragraph as PR #60 wrote them.

Run it again. Expected: pass.

- [ ] **Step 2: Run the whole suite from a clean start**

Run: `node --test tests/rack/*.test.mjs && ./chassis-index.py && git diff --exit-code site/rack/chassis.json && python3 check-contract.py && python3 check-browser.py`
Expected:
- every node test passes, including the new `imports`, `export-data`, `dcim` and `bom` suites;
- the contract passes;
- the browser suite lists every new `ok`: svg-export leaf, rack faces (8 screws), export sheet, draw.io group faces, export draw.io, export 3D, DCIM types, device CSV, BOM, lens edges, menu and warnings, frame focus, and dev note.

If a showcase 3D or page-load check times out, re-run it on `main`. It is environmental only if it fails there too (issue #59).

- [ ] **Step 3: Check the whole flow by hand, as a user would, at `http://localhost:8932/rack.html`**

1. Build a small rack:
   - a four-post frame, 24U, tapped 12-24;
   - an ASR-9006 at U2 with a line card seated through Explorer;
   - an AS7726 at U14 front;
   - a TM-280 at U14 rear.
2. Take each export: the **Export** menu, sheet SVG, front only, PNG. Open them. Both faces are there, with ears (2 screws per ear per U), the card and a readable title block.
3. **draw.io:** open it at app.diagrams.net. There are two pages, U1 is at the bottom, the card's ports are connection points, and the rear page does not show the AS7726 behind the TM-280.
4. **3D:** in 2D the menu offers "switch to 3D". In 3D, download the GLB and open it in a glTF viewer; the nodes are named `device-i…`.
5. **NetBox types zip:** read NOTES.txt.
6. **NetBox device import CSV:** check that the positions match the rail labels, then switch the frame to "U1 at the top" and export again.
7. **BOM:** the screws are 12-24 and number 4 × the U used.
8. **Rack file (.json)** from Export matches **Save as .json** from the library menu.

- [ ] **Step 4: Mark the phase in the spec and commit**

Change the spec's `**Status:**` line to:
`design approved; Phase 0 implemented; Phase 1a implemented (plan: docs/superpowers/plans/2026-09-26-rack-builder-phase1a-build-a-rack.md); Phase 1b implemented (plan: docs/superpowers/plans/2026-09-27-rack-builder-phase1b-exports.md); Phase 2 (cabling) next`

```bash
git add rack.html check-browser.py docs/superpowers/specs/2026-09-26-rack-builder-design.md
git commit -m "rack: Phase 1b is implemented - exports ship, cabling is next

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

## Not in Phase 1b (so nobody adds it here)

- Cables in any export: draw.io edges, the cable schedule, cable lines in the BOM, and NetBox cable import. These are **Phase 2** (spec §9.4). `rackNotes` says "N cables are not in this export yet" if a document ever carries some.
- Zero-U items in any export. The catalog has none, and `rackNotes` names any that a file carries.
- Elevation images inside the DCIM zip. `exporter.html` renders them for a whole library; spec §8's row asks only for the YAMLs.
- A notes cell drawn on the draw.io canvas. The notes ride as a comment inside `<mxfile>`.

## Carried to Phase 2

- **The showcase adapter's `id = e.ref`** (`site/showcase/rack.js` `build2dElevation`) isn't unique if a cast repeats a ref.
  - Left alone here because this phase must not change the showcase, and today's cast never repeats a ref.
  - Phase 2's cable code keys the showcase's cables to items, so it is the right place for a unique id.
- **Nautobot's device-import columns** follow Nautobot 2.x's natural-key CSV convention. Task 4 checks them against the docs, but no Nautobot instance imports the file in CI. The same goes for NetBox.
- **draw.io's `numDisp=descend`** is verified by hand in app.diagrams.net (Task 7 step 5). No automated check renders draw.io.
- **`explorer.html`'s `fieldsSettled` fix** has no automated test (Task 12).

## Self-review: spec §8 rows → tasks

| Spec §8 row / requirement | Task(s) |
|---|---|
| Built from the saved model through `configuredFace`, never the DOM; anything unresolved is listed | 3 (`faceNotes`, `rackNotes`), 6 (`faceOf`/`faceNotesFor`; the sheet is drawn fresh), 7–11 (each file carries its notes) |
| **SVG sheet**: front and rear side by side plus a title block (name, frame, depths, holes, date); each face alone | 1 (a leaf `standalone`), 2 (ears match 3D and the BOM), 3 (`titleLines`), 6 |
| **PNG**: the sheet at 2× via `rasterize` | 6 |
| **draw.io**: one page per face; port cells carry `portrayal-path` | 3 (`perFaceItems`, `drawioU`), 7 |
| **GLB / USDZ**: from the 3D scene after `complete()`; in 2D, a "switch to 3D" entry | 8 |
| **DCIM device types**: NetBox or Nautobot YAML for every distinct device and module, via `makeZip` | 4 (matching, `moduleTypePath`), 9 |
| **DCIM device import (CSV)**: one row per item; NetBox and Nautobot columns; positions follow the frame's numbering | 4 (`deviceImportRows`), 10 |
| **BOM (CSV)**: devices, modules, optics (and plugs) with counts; mounting hardware 2 per ear per U, cage nuts or screws of the thread | 2, 5, 11 |
| **Rack file**: the §5 `.json` | 6 (listed in Export; it stays in the library menu) |
| §7.2 top bar **Export ▾** | 6 |
| §11 "each export produces a non-empty file" | 6–11 (each check reads its file's content, not just its size) |
| Controller item: `#devNote` becomes "Coming next: cabling." | 13 |
| Phase 1a "Carried to Phase 1b" minors | 12 (all but the showcase adapter id, carried to Phase 2 with its reason) |

**Deferred or deviated on purpose:**
- **BOM "taken from `swaps`":** this plan counts what the configured faces seat, which is defaults overridden by swaps, including a swapped carrier's own defaults. That is the effective set §8 means. Counting `swaps` alone would omit every default PSU, fan and blank, and re-deriving defaults would duplicate `swap.js`'s nested-carrier logic. Task 9 step 2 verifies that defaults carry `data-ref`, and names the fallback.
- **The "(Phase 2)" parts of the draw.io and BOM rows** (cables as edges, cable lines by media, connector and length) are deferred by the spec itself.

### Critical files for implementation

- `/Volumes/External/portrayal-site/site/rack/exports.js` (new)
- `/Volumes/External/portrayal-site/site/rack/export-data.js` (new)
- `/Volumes/External/portrayal-site/site/rack-page.js`
- `/Volumes/External/portrayal-site/site/drawio.js`
- `/Volumes/External/portrayal-site/check-browser.py`