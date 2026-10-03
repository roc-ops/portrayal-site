# Rack Builder Phase 2b: cables in the exports (implementation plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the cables a user draws on `rack.html` (Phase 2a) reach every export that can carry them, and the 3D view:
- a **cable schedule** CSV, one row per cable;
- a **Cables** section in the bill of materials, by media, length and connector;
- cables on the **SVG and PNG sheet**, drawn as the page draws them, with tags that survive on paper;
- the **draw.io** export on **one page** with a front and a rear cabinet side by side, and each landed cable as an edge between two port cells;
- the showcase's **stage 6 draw.io** export gaining the plan's cables as edges;
- cables and their derived plugs in the **3D view**, and so in the **GLB and USDZ**;
- the note "N cables are not in this export yet" retired from each export as it gains cables.

NetBox and Nautobot cable import is **Phase 2c**, a separate plan.

**Architecture:**
- **`site/rack/export-data.js`** (pure, node-tested) gains every cable rule an export follows: which note an export still owes, what each cable's ends are found to be, the schedule's rows, the BOM's cable lines, the draw.io cabinet ids, the label fix, and the mapping from the rack's cables to the vendor's.
- **`site/rack/exports.js`** reads the cabled ends once per export through `cable-plugs.js` `cableFacts` (the reading the page uses), draws the sheet's cables with `cable-view.js` (the code the page uses), and hands draw.io's cables to `vendor/drawio.js` `rackDiagram`.
- **`site/rack/scene3d.js`** seats the derived plugs in the 3D scene and hangs the cables with `cables.js` `drawCables3d`, which gains one additive option. **`site/rack3d.js`** gains one additive line: a mount can be found by its id.
- **`site/rack-page.js`** only wires: one menu entry, one commit rule, one sentence.
- **`site/showcase/stages/06-takeaway.js`** passes the plan's links to `rackDiagram` as cables.

**Tech stack:**
- Vanilla ES modules with no bundler, served by `serve.py`.
- `node --test tests/rack/*.test.mjs` for the pure modules.
- Playwright checks in `check-browser.py`, registered with `@extra` and run with `python3 check-browser.py --only <function names, comma-separated>`.
- `python3 check-contract.py` for the text contracts.

**Spec:** `docs/superpowers/specs/2026-09-26-rack-builder-design.md`.
- This plan covers §9.4 (the cable schedule; cables on the SVG, PNG and GLB exports; cables as draw.io edges; stage 6's draw.io edges) and the "(Phase 2) cables" sentence of §8's BOM row. §8's draw.io row ("one page per face") is overridden by ruling 1 below and is corrected in Task 11.
- §9.4's last item (NetBox cable import) is Phase 2c. §9.5 and §9.6 stay as they are: nothing here reads `route`.
- Read §5, §8, §9 and §10 before starting.

**Rulings:** `.superpowers/sdd/rack-2b/rack-2b-rulings.md` (twelve, binding). The ones a task depends on are restated in that task.

## Before you start

- Work on the branch `rack-builder-2b`, in its worktree. Run `git fetch origin && git rebase origin/main` before Task 1. This plan was written against `origin/main` at `52b0af2e`.
- If a "replace this" block no longer matches character for character after the rebase, make the same change to the code as it now stands and say so in your task report.
- Serve locally with `python3 serve.py 8932`. `file://` does not work. `check-browser.py` starts its own server.
- Run `uptime` before debugging a browser check that times out: a loaded machine makes the 3D checks slow, and that is not a failure of the page.

## Global constraints

- **Never edit anything under `vendor/` or `assets/`.** They are upstream snapshots, and `./refresh-assets.sh` overwrites them. `vendor/drawio.js` is used as it is.
- No bundler, no npm, no new dependency. Modules import each other by relative path.
- These must not touch the DOM or fetch, because `node --test` imports them: `site/rack/model.js`, `site/rack/fit.js`, `site/rack/rails.js`, `site/rack/export-data.js`, `site/rack/cable-rules.js`.
- **The showcase must not change, except stage 6's draw.io export (Task 7).** `site/showcase/cables.js` stays a one-line re-export. Every change to `site/rack/cables.js` and `site/rack3d.js` is additive and inert for the showcase: a new option whose default is today's behavior.
- **A tool page must not import `site/showcase/artifact.js`** (`tests/rack/imports.test.mjs` enforces it).
- **Plugs are derived, never stored.** A drawn product (the sheet, draw.io's faces, the 3D scene) lays the derived plugs over an item's swaps for that drawing only. Nothing is written into `item.swaps`. An export that lists parts (the BOM's parts, the DCIM exports) never lists a plug.
- **An end is `{item, path, view}`.** `view` is the device's own panel, not the pane that shows it. The pane is `paneOf(item, view)`.
- **Every export says what it could not carry**, in the file, and the status line counts only what the file holds. A failure reading one face, or drawing one pane's cables, never fails a whole export: the export comes without that part and says so.
- **A rack with no cables is untouched.** Its sheet is byte for byte what it was (Task 4 pins it); its BOM, its draw.io cabinets and its 3D scene gain nothing.
- **The DCIM exports are not touched.** The device-type zips and the device-import CSVs keep saying "N cables are not in this export yet" until Phase 2c.
- **Cable mode stays 2D-only.** In 3D the Cable button stays disabled. Selecting a cable in 3D does not light it in the scene.
- **No color literal for a cable outside `site/rack/cables.js`.** Edge and tube colors come from `COLORS` and `colorOf`.
- Handlers read `rack()` at click time, not a rack captured when a panel or a menu was built.
- Anything keyed by an id from a file goes through `CSS.escape` in a selector and `textContent` in the DOM. A cable's label is text, never markup.
- No new `site/rack/rack.css` rule is needed by this plan. If you add one, scope it under `.rk-…` or a `data-` attribute this page owns.
- Probe hooks live only under `?probe=1` (`window.__rack`). This plan adds none: the scene's cables are read through the existing `window.__rack.scene()`.
- UI copy and comments are American English. UI copy is sentence case, with no "please" and no exclamation marks.
- **Never pass an async function as a `page.wait_for_function` predicate.** A promise is truthy at once. Wait on a synchronous predicate, then `page.evaluate` the awaiting.
- In a browser check: a cable group or layer is waited for by presence, not visibility (`wait_sel` does this for `[data-cable-id` and `[data-cables` selectors); never query the side panel right after a document-state wait (wait for the expected text or element); no fixed sleep except to guard a negative assertion.
- Browser checks are `@extra`-registered and run with `--only`. Local full-suite runs flake on showcase 3D and page-load timeouts (issue #59). Treat a failure as environmental **only if it reproduces on `main`**.
- Every commit message ends with a `Co-Authored-By:` trailer naming the model that wrote it. The commands below show `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; an implementer on another model uses its own.

## Facts the tasks rely on (verified 2026-10-03 on `origin/main` at `52b0af2e`)

Every code block in Tasks 1 to 11 was applied, in order, to a scratch copy of the repository at that commit, and its tests were run there: each task's new tests against the previous task's code (they fail as the task says), then against the task's own code (they pass). After Task 11, all 142 node tests, `check-contract.py` (292 checks) and every `check_rack_*`, `check_takeaway_*`, `check_cable*` and `check_drawio*` browser check (70 checks) passed, on a machine with WebGL. The whole browser suite was not run.

**The cable rules (`site/rack/cable-rules.js`, pure)**
- `endKey(end)` is `` `${item}|${view}|${path}` ``. `paneOf(item, view)` is the pane that shows that panel. `endName(rack, end)` is `"leaf-1 (U14) port-2"`, or `"a removed device's port-2"`. `cableName(c)` is the label, or the id.
- `lengthText(length)` is `"2 m"`, or `''`. `MEDIA_LABELS` maps the eight media to labels (`os2` is "OS2 single-mode fiber", `cat6a` is "Cat 6A copper"). `mismatch(media, infoA, infoB)` returns warning sentences, each ending in a period.
- `cablePlan(rack)` gives `{links: [{id, media, purpose, from: [item, path, PANE], to}]}`: the third element is the pane, which is right for 2D and wrong for 3D.
- `mergeSeats(swaps, plugs)` is `{...plugs, ...swaps}`, and tolerates `undefined` for either.

**The cabled ends (`site/rack/cable-plugs.js`)**
- `cableFacts(rack)` is async and resolves to a frozen `{seats, ends}`. `seats` is `{itemId: {slotId: plugRef}}`. `ends` is `Map(endKey -> {facts, info, reason})`: `reason` is `null` when the end lands, else a phrase with no period ("port-2 holds no optic", "the device was removed"); `info` is `{family, mode}` with `family` one of `fiber`, `copper`, `dac`, `aoc` or `null`.
- A panel that fails to load is already handled there: its ends read "this panel has no drawing". The answer is memoized, and shared with the page.
- `UNCHECKED` is `{seats: {}, ends: new Map(), unchecked: true}`. A rack with no cables resolves to an answer with no seats and no ends.
- It needs a browser (`DOMParser`, `CSS.escape`) but no layout: an export can call it.

**The panes' cable layer (`site/rack/cable-view.js`, `site/rack/cables.js`)**
- `ROOM` is 260 (exported). `widenForCables(svg)` needs `svg.dataset.pane` (`drawElevation` sets it), records `data-base-box`, widens the front pane to the right and the rear pane to the left by `ROOM`, and grows both 40 taller.
- `drawRackCables(svg, rack, reasons)` takes `Map(endKey -> reason | null)`. The svg must be **in the document and laid out** (`getScreenCTM`, `getBBox`). A `visibility:hidden` fixed host is enough; a nested `<svg>` inside the sheet works.
- It appends `g[data-cables="<pane>"]`, holding one `g[data-cable][data-cable-id]` per cable drawn (fixed stroke colors, no class, `pointer-events="none"`, no `tabindex`, no `data-pt-ui`), and `g[data-cable-tags="<pane>"][data-pt-ui="*"]`, holding one `g.cable-tag[tabindex][role=button][data-cable-tag][data-cable-id]` per tag (a `<title>`, a `<rect>`, a `<text>`; a loose end's tag also has the class `not-connected`). A tag's paint comes only from `site/rack/rack.css`.
- `roomForCables(svgs)` grows every pane's viewBox downward by what the lowest cable or tag needs, and returns whether it grew. Call it after `drawRackCables` on every pane.
- `site/svg-export.js` `standalone(node)` removes every `[data-pt-ui="*"]` node, so today a sheet could not keep a tag.
- `COLORS` (cables.js) has `os2`, `om3`, `om4`, `om5`, `cat6`, `cat6a`, `dac`, `aoc`, `unset`, and the showcase's `copper: {server, management}`. `colorOf({media, purpose})` colors `copper` by purpose, a known media by itself, and anything else as `os2`. The page passes `media || 'unset'`.
- `drawCables3d(scene, plan, {live})` asks `scene.cableAnchor({ref}, path, {view})` for each end, names each cable group `` `cable-${i}` `` inside a group `patch-cables`, and returns `{tubes, anchors, boxes, group}`. A tube is `{link, i, mesh, loose, points, starts, dangling}`: `loose` lists the sides (`'from'`, `'to'`) that got no anchor; with one landed the mesh is an unplugged lead (`dangling`), with none it is `null`. The showcase's links carry no `id`.

**The exports (`site/rack/exports.js`, `site/rack/export-data.js`)**
- `rackNotes(rack)` (export-data.js:112) returns the zero-U line and "N cables are not in this export yet." Callers: `faceNotesFor` (the sheet and draw.io), `modelFile`, `dcimContext`, `deviceImportCsv` (as `left`), `bomCsv`.
- `faceNotesFor(rack, items, panes, chassisOf)` (exports.js:42) is called by `sheetSvg` and `drawioFile` only.
- `sheetSvg` (exports.js:69) builds the whole sheet detached and attaches it to a hidden host only for `standalone`. Its geometry: `FACE_W = OPENING + RAIL_W * 2 + 12` (514.85), `M = 24`, `GAP = 48`, `HEAD = 28`. A pane's viewBox is `-32 -18 514.85 <heightRU × 44.45 + 30>`.
- `drawioFile` (exports.js:132) builds two groups, "Front" and "Rear": two `<diagram>` pages. That is why a user saw only the front.
- `toCsv(columns, rows, notes, {cell})` writes the header, the rows, then a blank line, a `Notes` row and one note per line, CRLF. `bomCell` guards a cell that opens as a formula. `uniqueNames(items)` reads `id`, `label` and `ref`, and gives a repeated label `` `${label}-${id}` ``; the device import calls it over the same items in the same order as `rack.items`.
- `exportStatus({notes, left, leftText})` reads "Downloaded, with N notes in the file." A builder's `notes` must be exactly the notes the file carries.
- A sheet with real devices already carries `var(--led-color, …)` and `cursor` in the compiled drawings' own stylesheets. What a sheet must not carry is `var(--pt-`.

**`vendor/drawio.js` (read-only)**
- `rackDiagram(groups, {faces = ['front'], labels = true, cables = [], cableStyle, notes = []})`. One `<diagram>` per group, named `esc(group.label)`. A group may name its own `faces`; its racks stand left to right, 370 apart for one face (a 180-wide cabinet and a 190 gap).
- A cabinet's cell is `<mxCell id="g<gi>r<r>-<face>" value="<esc(label ? `${label} · ${face}` : face)>" …>`, with `esc` replacing `&`, `<`, `>` and `"`. A mounted entry's cell id is `` `${slug(m.id ?? m.name)}-g${gi}r${r}-${face}` `` (`slug` turns each run outside `A-Za-z0-9._-` into `-`); a port's is that plus `-<port id>`, so `slot-2/module/p0` is `…-slot-2--module--p0`.
- A cable is `{id, a: {item, path, view?}, b, media, purpose, label, length}`. `item` is matched to `m.id ?? m.name`; with no `view`, any face matches. Both ends in one group: one `<object label portrayal-cable portrayal-media portrayal-purpose portrayal-length id="cable-<slug(id)>"><mxCell edge="1" source target>`. A cable the vendor cannot place is left out, with a note that prints the mounted ids.
- `cableStyle` as an object is merged over the vendor's colors and looked up by `String(cable.media || '').toLowerCase()`, then `default`. The edge style is the vendor's fixed string plus `strokeColor=<color>;`.
- A port cell exists for every port with `cls === 'port'`, keyed by `p.path || p.id`. **An empty cage is a port cell**: the vendor would draw an edge to it.
- None of the fixture's devices (`asr-9006`, `as7726-32x`, `tm-280`) has a port on its rear panel.

**3D (`site/rack3d.js`, `site/rack/scene3d.js`, `site/rack-page.js`)**
- `findMounted(which)` (rack3d.js:764) matches an object by `ru`, `ref` and `label` only. Two items of one ref cannot be told apart by id. `check-contract.py` forbids color literals only between `async function cableAnchor` and `function disposeTree`, so `findMounted` may change.
- A stack entry's `id` survives into `m.entry.id`. `cableAnchor(which, prefix, {view})` returns one `{position, normal, view, path}` per cable point of what is seated at `prefix`, or `[]`; `view` is the device's own panel. `portAnchor(which, path, {view})` returns `{position, normal, …}` at the port's center, or `null`.
- Overrides are per mount. The scene's `dispose()` disposes everything in the scene, a cable group included.
- `mountRack3d` (scene3d.js) passes `overrides: item.swaps || {}` and draws no cables.
- `commit()` (rack-page.js:214) skips the 3D rebuild when `items` and `frame` are the same objects, and re-points `S.scene3dRack` if the scene was current. `rebuild3d()` (rack-page.js:73) makes the same test when it finishes. `sceneForExport` rebuilds when `S.scene3dRack !== rack()`.
- `CABLES_2D` (rack-page.js:32) is the Cable button's title in 3D and the text of `#cable3dNote`.
- three.js's USDZ exporter names every prim `Object_<n>`: a USDZ carries the cables' geometry and not their names.
- The headless Chromium the checks use has WebGL here (software). `webgl_trouble(page)` says when a runner has none.

**The showcase's stage 6 (`site/showcase/stages/06-takeaway.js`)**
- `buildDrawio()` (line 85) is a module function that takes nothing; the menu item is `run: buildDrawio`. It builds one group with one rack and `faces: ['front', 'rear']`, and its mounted entries carry no `id`.
- `enterPatched` returns a handle with `plan` (`{devices: [{id, ref}], links}`), `kept` and `loose` (per link, the sides that do not land). The plan has 14 links: 8 `os2`, 2 `copper` for `server`, 4 `copper` for `management`; a link is `{media, purpose, from: [device, path, view?], to}` with no `id`. `plan.js` exports `looseReason(plan, kept, [device, path])` and `endView(end)`.
- `check_takeaway_drawio` asserts `value="rear"`, which holds while the rack's label is `''`.

**The test harness**
- `node --test tests/rack/*.test.mjs`: 127 tests pass on this commit. Node is v22. `python3 check-contract.py` prints `contract: 292 checks passed`.
- `check-browser.py`: each `@extra` check gets a fresh page. New checks go before `def main():`.
  - `EXPORT_FIXTURE` (no cables), `CABLE_FIXTURE` (the same rack with `c1` leaf-1 `port-1` to core-1 `slot-2/module/p0`, os2, label "A1", 2 m; `c2` leaf-1 `mgmt-eth` to the demarc at U14 `port-2-1`, cat6a, front pane to rear pane; `c3` leaf-1 `port-2`, an empty cage and so a loose end, to the demarc at U20 `port-2-1`, os2), `ROOM_FIXTURE` (42U: `c1` from U42 to U1, `c2` from the lowest device to a device that is not there), `EMPTY_FIXTURE`.
  - `open_fixture(page, base, fixture)`, `open_cabled(page, base, fixture=None)` (waits for both panes' cables), `cable_fixture(doc_id, name, edit)`, `export_file(page, kind, timeout)` (returns a download), `export_status(page)` (waits for the status line to settle), `notes_status(n)`, `read_csv(dl)` (returns `(fieldnames, rows, text)`, splitting at `"\r\n\r\nNotes\r\n"`), `wait_fn`, `wait_sel`, `webgl_trouble(page)`.
  - `READY_MS = 60000`, `READY_3D_MS = 240000`.

## File map

| File | Responsibility | Task |
|---|---|---|
| `site/rack/export-data.js` | The pure cable rules of the exports | 1, 3, 5, 6 |
| `tests/rack/export-cables.test.mjs` | Node suite for those rules (new) | 1, 3, 5, 6 |
| `site/rack/exports.js` | The schedule; the BOM's cables; the cabled sheet; draw.io on one page with edges; the model's notes | 2, 3, 4, 5, 6, 10 |
| `site/rack-page.js` | The menu entry; which commits rebuild the 3D scene; the 3D sentence | 2, 9 |
| `site/showcase/stages/06-takeaway.js` | Stage 6's draw.io export with cable edges | 7 |
| `site/rack3d.js` | `findMounted` by id (one condition) | 8 |
| `site/rack/cables.js` | `drawCables3d`: an `anchor` option, `cable-<id>` names | 8 |
| `site/rack/cable-rules.js` | `cablePlan3d`; `sameCables3d` | 8, 9 |
| `tests/rack/cables.test.mjs` | Node tests for those two | 8, 9 |
| `site/rack/scene3d.js` | Derived plugs and cables in the 3D scene | 8 |
| `rack.html` | The dev note | 11 |
| `check-browser.py` | Every new and changed check | 2 to 11 |
| `docs/superpowers/specs/2026-09-26-rack-builder-design.md` | The status line; §8's draw.io row | 11 |

**Names used across tasks** (each is defined by the task shown, and used unchanged after it):

| Name | Where | Task |
|---|---|---|
| `rackNotes(rack, {cables = true})` | export-data.js | 1 |
| `UNCHECKED_NOTE`, `cableFindings(rack, ends)`, `cableNotes(rack, ends, {undrawn})` | export-data.js | 1 |
| `CABLE_COLUMNS`, `cableScheduleRows(rack, ends)` | export-data.js | 1 |
| `cableEnds(rack)`, `cableScheduleCsv(rack)` | exports.js | 2 |
| `cableBomRows(rack, ends)` | export-data.js | 3 |
| `faceNotesFor(rack, items, panes, chassisOf, {cables = true})`, `cabledItems(rack, base)` | exports.js | 4 |
| `rearSuffix(items)`, `drawioId(id, pane, suffix)`, `rearCabinetLabel(xml, label)` | export-data.js | 5 |
| `drawioMedia(link)`, `drawioCables(rack, {ends, idOf, drawn})` | export-data.js | 6 |
| `cablePlan3d(rack)` | cable-rules.js | 8 |
| `drawCables3d(scene, plan, {live, anchor})`; `scene.rackCables` | cables.js; scene3d.js | 8 |
| `sameCables3d(a, b)` | cable-rules.js | 9 |

---

### Task 1: The pure cable rules of the exports: which note an export owes, what each cable's ends are, and the schedule's rows

Three exports (the sheet, draw.io, the 3D model) say the same things about a cable: this end is loose, for this reason; this media does not suit that end. Two more (the schedule, the BOM) read the same findings. This task writes those rules once, as pure functions, and the cable schedule's rows on top of them. No export changes yet.

**Files:**
- Modify: `site/rack/export-data.js`
- Create: `tests/rack/export-cables.test.mjs`

**Interfaces:**
- Consumes (all exist): `endKey(end)`, `endName(rack, end)`, `cableName(cable)`, `mismatch(media, infoA, infoB)`, `MEDIA_LABELS` from `site/rack/cable-rules.js`; `uLabel(frame, u)` from `site/rack/model.js`; `uniqueNames(items)` in `export-data.js` itself.
- Produces, all exported from `site/rack/export-data.js`:
  - `rackNotes(rack, {cables = true} = {})` → `string[]`. With `cables: false` the "N cables are not in this export yet." line is left out; the zero-U line is not.
  - `UNCHECKED_NOTE` → the sentence an export carries when the cabled ends could not be read.
  - `cableFindings(rack, ends = new Map())` → one `{cable, name, loose: [{side: 'A' | 'B', end, reason}], warnings: string[], checked: boolean}` per cable, in the rack's order. `ends` is `cableFacts(rack).ends`.
  - `cableNotes(rack, ends = new Map(), {undrawn = false} = {})` → `string[]`: one note per cable with a loose end, one per mismatch warning.
  - `CABLE_COLUMNS` and `cableScheduleRows(rack, ends = new Map())` → `{columns, rows, notes}`.

- [ ] **Step 1: Write the failing tests**

Create `tests/rack/export-cables.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import * as X from '../../site/rack/export-data.js';
import * as M from '../../site/rack/model.js';

// check-browser.py's cable fixture, as far as the rules read it.
const FRAME = M.normalizeFrame({heightRU: 24});
const RACK = {name: 'Cable test', frame: FRAME, zeroU: [], items: [
  {id: 'i1', ref: 'asr-9006', label: 'core-1', ru: 2, face: 'front', turned: false},
  {id: 'i2', ref: 'as7726-32x', label: 'leaf-1', ru: 14, face: 'front', turned: false},
  {id: 'i3', ref: 'tm-280', label: 'demarc', ru: 14, face: 'rear', turned: false},
  {id: 'i4', ref: 'tm-280', label: 'demarc', ru: 20, face: 'rear', turned: false}],
  cables: [
    {id: 'c1', a: {item: 'i2', path: 'port-1', view: 'front'}, b: {item: 'i1', path: 'slot-2/module/p0', view: 'front'},
     media: 'os2', purpose: 'uplink', label: 'A1', length: {value: 2, unit: 'm', source: 'entered'}, route: []},
    {id: 'c2', a: {item: 'i2', path: 'mgmt-eth', view: 'front'}, b: {item: 'i3', path: 'port-2-1', view: 'front'},
     media: 'cat6a', purpose: 'management', label: '', route: []},
    {id: 'c3', a: {item: 'i2', path: 'port-2', view: 'front'}, b: {item: 'i4', path: 'port-2-1', view: 'front'},
     media: 'os2', purpose: 'uplink', label: '', route: []}]};
const FIBER = {family: 'fiber', mode: null}, COPPER = {family: 'copper', mode: null}, NONE = {family: null, mode: null};
// What cable-plugs.js cableFacts(rack).ends holds for that rack.
const ENDS = new Map([
  ['i2|front|port-1', {info: FIBER, reason: null}], ['i1|front|slot-2/module/p0', {info: FIBER, reason: null}],
  ['i2|front|mgmt-eth', {info: COPPER, reason: null}], ['i3|front|port-2-1', {info: COPPER, reason: null}],
  ['i2|front|port-2', {info: NONE, reason: 'port-2 holds no optic'}], ['i4|front|port-2-1', {info: COPPER, reason: null}]]);

test('an export that carries the cables drops the cable line, and only that line', () => {
  const rack = {zeroU: [{}], cables: [{}, {}]};
  assert.deepEqual(X.rackNotes(rack), ['1 zero-U item is not in this export yet.', '2 cables are not in this export yet.']);
  assert.deepEqual(X.rackNotes(rack, {cables: true}), X.rackNotes(rack));
  assert.deepEqual(X.rackNotes(rack, {cables: false}), ['1 zero-U item is not in this export yet.']);
  assert.deepEqual(X.rackNotes({zeroU: [], cables: [{}]}, {cables: false}), []);
});

test('each cable is read once: its loose ends with reasons, its mismatch warnings, whether it was checked', () => {
  const f = X.cableFindings(RACK, ENDS);
  assert.deepEqual(f.map(x => [x.name, x.loose.map(l => [l.side, l.reason]), x.warnings, x.checked]), [
    ['A1', [], [], true],
    ['c2', [], [], true],
    ['c3', [['A', 'port-2 holds no optic']], ['OS2 single-mode fiber does not suit end B, which is copper.'], true]]);
  assert.deepEqual(X.cableFindings(RACK).map(x => [x.loose.length, x.warnings.length, x.checked]),
    [[0, 0, false], [0, 0, false], [0, 0, false]]);
  assert.deepEqual(X.cableFindings({items: [], cables: undefined}), []);
});

test('the notes a drawn export carries name the cable, the end as the page names it, and the reason', () => {
  assert.deepEqual(X.cableNotes(RACK, ENDS), [
    'Cable c3: end A, leaf-1 (U14) port-2, is not connected (port-2 holds no optic).',
    'Cable c3: OS2 single-mode fiber does not suit end B, which is copper.']);
  assert.equal(X.cableNotes(RACK, ENDS, {undrawn: true})[0],
    'Cable c3 is not drawn: end A, leaf-1 (U14) port-2, is not connected (port-2 holds no optic).');
  const gone = {...RACK, items: RACK.items.filter(i => i.id !== 'i1')};
  const ends = new Map([...ENDS, ['i1|front|slot-2/module/p0', {info: NONE, reason: 'the device was removed'}]]);
  assert.equal(X.cableNotes(gone, ends)[0],
    "Cable A1: end B, a removed device's slot-2/module/p0, is not connected (the device was removed).");
  assert.deepEqual(X.cableNotes({...RACK, cables: []}, ENDS), []);
});

test('the cable schedule: one row per cable, devices named as the device import names them', () => {
  const {columns, rows, notes} = X.cableScheduleRows(RACK, ENDS);
  assert.deepEqual(columns, ['cable', 'a_device', 'a_u', 'a_port', 'b_device', 'b_u', 'b_port', 'media', 'purpose',
    'length', 'length_unit', 'status', 'notes']);
  assert.equal(columns, X.CABLE_COLUMNS);
  assert.deepEqual(rows[0], {cable: 'A1', a_device: 'leaf-1', a_u: 14, a_port: 'port-1', b_device: 'core-1', b_u: 2,
    b_port: 'slot-2/module/p0', media: 'OS2 single-mode fiber', purpose: 'uplink', length: 2, length_unit: 'm',
    status: 'connected', notes: ''});
  assert.deepEqual(rows[1], {cable: 'c2', a_device: 'leaf-1', a_u: 14, a_port: 'mgmt-eth', b_device: 'demarc-i3',
    b_u: 14, b_port: 'port-2-1', media: 'Cat 6A copper', purpose: 'management', length: '', length_unit: '',
    status: 'connected', notes: ''});
  assert.equal(rows[2].status, 'loose end');
  assert.equal(rows[2].b_device, 'demarc-i4');
  assert.equal(rows[2].notes,
    'End A is not connected: port-2 holds no optic. OS2 single-mode fiber does not suit end B, which is copper.');
  assert.deepEqual(notes, ['Devices that share a label are named as the device import names them: demarc-i3, demarc-i4.']);
  // The same names the device import gives.
  const names = X.uniqueNames(RACK.items);
  assert.equal(rows[1].b_device, names.get('i3').name);
});

test('the cable schedule: positions follow the frame, a removed device leaves blanks, an unknown media is its own name', () => {
  const rack = {...RACK, frame: {...FRAME, numbering: 'top-down'}, items: RACK.items.filter(i => i.id !== 'i1'),
    cables: [{...RACK.cables[0], media: 'toString', length: {value: 30, unit: 'cm', source: 'entered'}},
             {...RACK.cables[1], media: '', lengthAsWritten: {value: 'about 3', unit: 'm'}},
             {...RACK.cables[1], id: 'c9', lengthAsWritten: 'long'}]};
  const ends = new Map([...ENDS, ['i1|front|slot-2/module/p0', {info: NONE, reason: 'the device was removed'}]]);
  const {rows} = X.cableScheduleRows(rack, ends);
  assert.deepEqual([rows[0].a_u, rows[0].b_device, rows[0].b_u, rows[0].b_port, rows[0].status],
    [11, '', '', 'slot-2/module/p0', 'loose end']);
  assert.deepEqual([rows[0].media, rows[0].length, rows[0].length_unit], ['toString', 30, 'cm']);
  assert.deepEqual([rows[1].media, rows[1].length, rows[1].length_unit], ['', '', '']);
  assert.equal(rows[1].notes, 'Length as written in the file: {"value":"about 3","unit":"m"}.');
  assert.equal(rows[2].notes, 'Length as written in the file: long.');
});

test('the cable schedule says so when there are no cables, and when the ends were not checked', () => {
  assert.deepEqual(X.cableScheduleRows({...RACK, cables: []}, new Map()),
    {columns: X.CABLE_COLUMNS, rows: [], notes: ['This rack has no cables, so there is nothing to list.']});
  const {rows, notes} = X.cableScheduleRows(RACK);
  assert.deepEqual(rows.map(r => r.status), ['not checked', 'not checked', 'not checked']);
  assert.equal(notes[0], 'Cable ends could not be checked, so loose ends are not marked.');
  assert.equal(notes[0], X.UNCHECKED_NOTE);
});

test('a schedule cell that opens as a formula is guarded, as the BOM guards it', () => {
  const rack = {...RACK, cables: [{...RACK.cables[0], label: '=A1', purpose: '-x'}]};
  const {columns, rows} = X.cableScheduleRows(rack, ENDS);
  const csv = X.toCsv(columns, rows, [], {cell: X.bomCell});
  assert.match(csv, /\r\n'=A1,leaf-1,14,port-1,core-1,2,slot-2\/module\/p0,OS2 single-mode fiber,'-x,2,m,connected,\r\n$/);
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `node --test tests/rack/export-cables.test.mjs`
Expected: 7 tests, 7 failures. The first fails on an assertion (`rackNotes` ignores its option); the rest with `TypeError: X.cableFindings is not a function` and the like.

- [ ] **Step 3: Write the rules**

In `site/rack/export-data.js`, replace

```js
import {uLabel} from './model.js';
```

with

```js
import {uLabel} from './model.js';
import {endKey, endName, cableName, mismatch, MEDIA_LABELS} from './cable-rules.js';
```

(`cable-rules.js` is pure and imports only `model.js`, so `export-data.js` stays importable under node.)

Then replace the whole of `rackNotes`:

```js
export function rackNotes(rack) {
  const out = [];
  const z = rack.zeroU?.length || 0, c = rack.cables?.length || 0;
  if (z) out.push(`${count(z, 'zero-U item is', 'zero-U items are')} not in this export yet.`);
  if (c) out.push(`${count(c, 'cable is', 'cables are')} not in this export yet.`);
  return out;
}
```

with

```js
// What a rack holds that an export leaves out. An export that carries the
// cables (the sheet, draw.io, the 3D model, the BOM, the cable schedule)
// passes {cables: false}; one that does not (the DCIM types and the device
// import) keeps the line.
export function rackNotes(rack, {cables = true} = {}) {
  const out = [];
  const z = rack.zeroU?.length || 0, c = rack.cables?.length || 0;
  if (z) out.push(`${count(z, 'zero-U item is', 'zero-U items are')} not in this export yet.`);
  if (cables && c) out.push(`${count(c, 'cable is', 'cables are')} not in this export yet.`);
  return out;
}

// ── CABLES IN THE EXPORTS (spec §9.4) ───────────────────────────────────
// Every export that carries cables reads them through these, so a loose end
// or a mismatch is worded once. `ends` is cable-plugs.js cableFacts(rack).ends:
// Map(endKey -> {info, reason}), reason null when the end lands. A cable
// whose ends are not in the map was not checked (reading the faces failed).
export const UNCHECKED_NOTE = 'Cable ends could not be checked, so loose ends are not marked.';
export function cableFindings(rack, ends = new Map()) {
  return (rack.cables || []).map(cable => {
    const got = s => ends.get(endKey(cable[s]));
    const loose = [['A', 'a'], ['B', 'b']].filter(([, s]) => got(s)?.reason != null)
      .map(([side, s]) => ({side, end: cable[s], reason: got(s).reason}));
    return {cable, name: cableName(cable), loose, checked: !!got('a') && !!got('b'),
            warnings: mismatch(cable.media, got('a')?.info, got('b')?.info)};
  });
}
// The notes a drawn export carries: each loose end with its reason, each
// media mismatch. `undrawn` is for a file that leaves a cable with a loose
// end out altogether (draw.io) where the others draw its unplugged lead.
export function cableNotes(rack, ends = new Map(), {undrawn = false} = {}) {
  const out = [];
  for (const f of cableFindings(rack, ends)) {
    if (f.loose.length) {
      const why = f.loose.map(l => `end ${l.side}, ${endName(rack, l.end)}, is not connected (${l.reason})`);
      out.push(`Cable ${f.name}${undrawn ? ' is not drawn' : ''}: ${why.join('; ')}.`);
    }
    for (const w of f.warnings) out.push(`Cable ${f.name}: ${w}`);
  }
  return out;
}

// Own keys only: a hand-edited media named like something every object has
// (toString) is its own name, not a label.
const mediaLabel = m => (Object.hasOwn(MEDIA_LABELS, m) ? MEDIA_LABELS[m] : String(m ?? ''));
const asWritten = v => (typeof v === 'string' ? v : JSON.stringify(v));

// THE CABLE SCHEDULE: one row per cable, in the rack's own order. A device is
// named as the device import names it (uniqueNames over the same items), so
// the two files agree. A length the page could not use (model.js
// lengthAsWritten) is quoted in the notes, never put in the numeric column.
export const CABLE_COLUMNS = ['cable', 'a_device', 'a_u', 'a_port', 'b_device', 'b_u', 'b_port', 'media', 'purpose',
  'length', 'length_unit', 'status', 'notes'];
export function cableScheduleRows(rack, ends = new Map()) {
  const names = uniqueNames(rack.items);
  const byId = new Map(rack.items.map(i => [i.id, i]));
  const named = new Set();
  const side = e => {
    const it = byId.get(e.item);
    if (!it) return ['', '', e.path];
    if (names.get(it.id).renamed) named.add(names.get(it.id).name);
    return [names.get(it.id).name, uLabel(rack.frame, it.ru), e.path];
  };
  const findings = cableFindings(rack, ends);
  const rows = findings.map(f => {
    const c = f.cable, [aDev, aU, aPort] = side(c.a), [bDev, bU, bPort] = side(c.b);
    const notes = [...f.loose.map(l => `End ${l.side} is not connected: ${l.reason}.`), ...f.warnings];
    if (c.lengthAsWritten != null) notes.push(`Length as written in the file: ${asWritten(c.lengthAsWritten)}.`);
    return {cable: f.name, a_device: aDev, a_u: aU, a_port: aPort, b_device: bDev, b_u: bU, b_port: bPort,
            media: mediaLabel(c.media), purpose: c.purpose, length: c.length ? c.length.value : '',
            length_unit: c.length ? c.length.unit : '',
            status: !f.checked ? 'not checked' : f.loose.length ? 'loose end' : 'connected', notes: notes.join(' ')};
  });
  const notes = [];
  if (!rows.length) notes.push('This rack has no cables, so there is nothing to list.');
  if (findings.some(f => !f.checked)) notes.push(UNCHECKED_NOTE);
  if (named.size) notes.push(`Devices that share a label are named as the device import names them: ${[...named].join(', ')}.`);
  return {columns: CABLE_COLUMNS, rows, notes};
}
```

`cableScheduleRows` calls `uniqueNames`, which is a function declaration further down the same file: that is fine.

- [ ] **Step 4: Run the tests and see them pass**

Run: `node --test tests/rack/*.test.mjs`
Expected: `# pass 134`, `# fail 0` (the 127 there were, and these 7). `tests/rack/export-data.test.mjs` still passes: `rackNotes(rack)` with no option is unchanged.

- [ ] **Step 5: Commit**

```bash
git add site/rack/export-data.js tests/rack/export-cables.test.mjs
git commit -m "rack: the exports' cable rules - which note an export owes, each cable's findings, the schedule's rows

rackNotes takes {cables: false} for an export that carries the cables.
cableFindings reads each cable once: its loose ends with their reasons, its
mismatch warnings, whether its ends were checked. cableNotes words them for
a drawn export; cableScheduleRows makes one row per cable, naming devices as
the device import does. Pure, and tested with node.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The cable schedule CSV

Spec §9.4: "A cable schedule CSV." Ruling 9: the file is `<stem>-cables.csv`, menu kind `cables`, always in the menu; a rack with no cables gets the header and a note. It is a spreadsheet document, so its cells take the BOM's formula guard.

**Files:**
- Modify: `site/rack/exports.js`, `site/rack-page.js`, `check-browser.py`

**Interfaces:**
- Consumes: `cableScheduleRows(rack, ends)` → `{columns, rows, notes}` (Task 1); `cableFacts(rack)` and `UNCHECKED` from `site/rack/cable-plugs.js`; `toCsv`, `bomCell`, `fileStem` (already imported in `exports.js`).
- Produces, exported from `site/rack/exports.js`:
  - `cableEnds(rack)` → `Promise<{seats, ends, unchecked?}>`: `cableFacts(rack)`, or `UNCHECKED` if reading the faces throws. Every later task's export reads the cabled ends through it.
  - `cableScheduleCsv(rack)` → `Promise<{name, data, type: 'text/csv', notes}>`.
- The Export menu gains `[data-export="cables"]`, "Cable schedule (.csv)".

- [ ] **Step 1: Write the failing check**

In `check-browser.py`, add before `def main():`

```python
@extra("rack.html: Export - the cable schedule lists each cable with its ends, media, length and status, named as the device import names them")
def check_rack_export_cable_schedule(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    try:
        open_cabled(page, base)
    except RuntimeError as e:
        return bad + [f"cable schedule: {e}"]
    dl = export_file(page, "cables")
    status = export_status(page)
    if dl.suggested_filename != "Cable-test-cables.csv":
        bad.append(f"cable schedule: named {dl.suggested_filename!r}")
    cols, rows, text = read_csv(dl)
    if cols != ["cable", "a_device", "a_u", "a_port", "b_device", "b_u", "b_port", "media", "purpose",
                "length", "length_unit", "status", "notes"]:
        bad.append(f"cable schedule: columns {cols}")
    want = [
        {"cable": "A1", "a_device": "leaf-1", "a_u": "14", "a_port": "port-1", "b_device": "core-1", "b_u": "2",
         "b_port": "slot-2/module/p0", "media": "OS2 single-mode fiber", "purpose": "uplink", "length": "2",
         "length_unit": "m", "status": "connected", "notes": ""},
        {"cable": "c2", "a_device": "leaf-1", "a_u": "14", "a_port": "mgmt-eth", "b_device": "demarc-i3", "b_u": "14",
         "b_port": "port-2-1", "media": "Cat 6A copper", "purpose": "management", "length": "", "length_unit": "",
         "status": "connected", "notes": ""},
        {"cable": "c3", "a_device": "leaf-1", "a_u": "14", "a_port": "port-2", "b_device": "demarc-i4", "b_u": "20",
         "b_port": "port-2-1", "media": "OS2 single-mode fiber", "purpose": "uplink", "length": "", "length_unit": "",
         "status": "loose end",
         "notes": "End A is not connected: port-2 holds no optic. "
                  "OS2 single-mode fiber does not suit end B, which is copper."}]
    if rows != want:
        bad.append(f"cable schedule: rows {rows}")
    notes = [l for l in text.partition("\r\nNotes\r\n")[2].split("\r\n") if l]
    if notes != ["\"Devices that share a label are named as the device import names them: demarc-i3, demarc-i4.\""]:
        bad.append(f"cable schedule: the notes section reads {notes}")
    # One note in the notes section and one row with notes: two in the file.
    if status != notes_status(2):
        bad.append(f"cable schedule: the status reads {status!r}")
    if "not in this export yet" in text:
        bad.append("cable schedule: it says cables are not in this export")
    # The device import names the same two devices the same way.
    _, drows, _ = read_csv(export_file(page, "netbox-devices"))
    names = {r["name"] for r in drows}
    if not {"demarc-i3", "demarc-i4", "leaf-1", "core-1"} <= names:
        bad.append(f"cable schedule: the device import names {sorted(names)}, and the schedule's are not among them")

    # A label that opens as a formula is guarded; a length kept as written is in the notes, not the number.
    odd = page.evaluate("""async () => {
      const X = await import('/site/rack/exports.js');
      const r = window.__rack.doc().racks[0];
      const cables = [{...r.cables[0], label: '=SUM(A1)', length: undefined, lengthAsWritten: {value: 'about 3', unit: 'm'}}];
      return (await X.cableScheduleCsv({...r, cables})).data;
    }""")
    line = odd.split("\r\n")[1]
    if not line.startswith("'=SUM(A1),leaf-1,14,port-1,core-1,2,slot-2/module/p0,OS2 single-mode fiber,uplink,,,connected,"):
        bad.append(f"cable schedule: a formula-like label or a length as written is wrong: {line!r}")
    if 'Length as written in the file: {""value"":""about 3"",""unit"":""m""}.' not in line:
        bad.append(f"cable schedule: the length as written is not quoted in the notes: {line!r}")

    # No cables: the header alone, and a note saying so.
    open_fixture(page, base)
    dl = export_file(page, "cables")
    status = export_status(page)
    cols, rows, text = read_csv(dl)
    if dl.suggested_filename != "Export-test-cables.csv" or rows or not cols or cols[0] != "cable":
        bad.append(f"cable schedule, no cables: {dl.suggested_filename!r} with rows {rows}")
    if "This rack has no cables, so there is nothing to list." not in text.partition("\r\nNotes\r\n")[2]:
        bad.append(f"cable schedule, no cables: the notes do not say so: {text!r}")
    if status != notes_status(1):
        bad.append(f"cable schedule, no cables: the status reads {status!r}")
    return bad
```

- [ ] **Step 2: Run it and see it fail**

Run: `python3 check-browser.py --only check_rack_export_cable_schedule`
Expected: `FAIL`, with `Page.click: Timeout 30000ms exceeded.` (the menu has no `[data-export="cables"]` entry; the run waits out that timeout).

- [ ] **Step 3: Build the file**

In `site/rack/exports.js`, replace

```js
        bomRows, BOM_COLUMNS, bomCell, hardwareNotes, partManufacturer, firstSentence} from './export-data.js';
```

with

```js
        bomRows, BOM_COLUMNS, bomCell, hardwareNotes, partManufacturer, firstSentence,
        cableScheduleRows} from './export-data.js';
import {cableFacts, UNCHECKED} from './cable-plugs.js';
```

and append at the end of the file:

```js
// ── CABLES (spec §9.4) ──────────────────────────────────────────────────
// What each cabled end has on its panel, for an export: cable-plugs.js's own
// reading (memoized, so the page and every export share one). A panel that
// fails to load is already a loose end with a reason there. If the reading
// itself fails, the export still comes: no end is judged, and the file says
// so (export-data.js UNCHECKED_NOTE) rather than calling every end connected.
export const cableEnds = rack => cableFacts(rack).catch(err => {
  console.warn("[portrayal] export: could not read the cables' faces", err);
  return UNCHECKED;
});

// THE CABLE SCHEDULE (spec §9.4): one row per cable. A spreadsheet opens it,
// so its cells go through bomCell, as the BOM's do. The notes the file
// carries are its notes section and each row's notes column.
export async function cableScheduleCsv(rack) {
  const facts = await cableEnds(rack);
  const {columns, rows, notes} = cableScheduleRows(rack, facts.ends);
  return {name: `${fileStem(rack.name)}-cables.csv`, data: toCsv(columns, rows, notes, {cell: bomCell}),
          type: 'text/csv', notes: [...notes, ...rows.map(r => r.notes).filter(Boolean)]};
}
```

- [ ] **Step 4: Put it in the menu**

In `site/rack-page.js`, replace

```js
import {sheetSvg, sheetPng, drawioFile, modelFile, dcimTypesZip, deviceImportCsv, bomCsv} from './rack/exports.js';
```

with

```js
import {sheetSvg, sheetPng, drawioFile, modelFile, dcimTypesZip, deviceImportCsv, bomCsv, cableScheduleCsv} from './rack/exports.js';
```

In `BUILD`, replace

```js
  bom: () => bomCsv(rack(), chassisOf),
  glb:
```

with

```js
  bom: () => bomCsv(rack(), chassisOf),
  cables: () => cableScheduleCsv(rack()),
  glb:
```

(`rack()` is read when the entry is clicked, as for every other export.) In `renderExports`, replace

```js
    act('bom', 'Bill of materials (.csv)'),
```

with

```js
    act('bom', 'Bill of materials (.csv)'),
    act('cables', 'Cable schedule (.csv)'),
```

- [ ] **Step 5: Run the check and see it pass**

Run: `python3 check-browser.py --only check_rack_export_cable_schedule,check_rack_export_device_csv,check_rack_export_empty`
Expected: three `ok` lines.

- [ ] **Step 6: Commit**

```bash
git add site/rack/exports.js site/rack-page.js check-browser.py
git commit -m "rack: Export - a cable schedule (.csv), one row per cable

Each cable with its two ends (device, U, port), media, purpose, length and
unit, whether it is connected or a loose end, and its notes. Devices are
named as the device import names them. Cells are formula-guarded, as the
BOM's are. A rack with no cables gets the header and a note saying so.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The BOM's Cables section

Spec §8: the BOM lists "cables grouped by media, connector and length, with 'length not set' where it's empty". Ruling 10: one line per distinct media and length with a quantity; the description says the ends' connector family when it is known; derived plugs are never parts; the BOM's "cables are not in this export yet" note goes.

A line's key is media, length **and** the connector text, so that the spec's "grouped by … connector" holds: two cables of one media and length whose ends take different connectors are two lines.

**Files:**
- Modify: `site/rack/export-data.js`, `tests/rack/export-cables.test.mjs`, `site/rack/exports.js`, `check-browser.py`

**Interfaces:**
- Consumes: `endKey`, `lengthText(length)` from `site/rack/cable-rules.js`; `mediaLabel` (a private helper Task 1 added to `export-data.js`); `rackNotes(rack, {cables: false})` (Task 1); `cableEnds(rack)` and the `UNCHECKED` import (Task 2).
- Produces: `cableBomRows(rack, ends = new Map())`, exported from `site/rack/export-data.js` → rows `{section: 'Cables', qty, manufacturer: '', model, description, ref: ''}`, sorted by model, then description. `bomCsv` appends them after the mounting hardware.

- [ ] **Step 1: Write the failing node tests**

Append to `tests/rack/export-cables.test.mjs`:

```js
test('the BOM lists cables by media, length and connector, with "length not set" where there is none', () => {
  const two = {...RACK.cables[0], id: 'c7', label: 'A2', a: RACK.cables[0].b, b: RACK.cables[0].a};
  const rows = X.cableBomRows({...RACK, cables: [...RACK.cables, two]}, ENDS);
  assert.deepEqual(rows, [
    {section: 'Cables', qty: 1, manufacturer: '', model: 'Cat 6A copper', description: 'length not set; copper at both ends', ref: ''},
    {section: 'Cables', qty: 2, manufacturer: '', model: 'OS2 single-mode fiber', description: '2 m; fiber at both ends', ref: ''},
    {section: 'Cables', qty: 1, manufacturer: '', model: 'OS2 single-mode fiber', description: 'length not set; copper at one end', ref: ''}]);
});

test('the BOM: a length kept as written is not set, a unit is part of the line, an unknown end adds nothing', () => {
  const c = RACK.cables[1];
  const rack = {...RACK, cables: [
    {...c, id: 'a', length: {value: 3, unit: 'm'}}, {...c, id: 'b', length: {value: 3, unit: 'ft'}},
    {...c, id: 'c', lengthAsWritten: 'long'}, {...c, id: 'd', media: ''}, {...c, id: 'e', media: 'toString'}]};
  assert.deepEqual(X.cableBomRows(rack).map(r => [r.qty, r.model, r.description]), [
    [1, 'Cat 6A copper', '3 ft'], [1, 'Cat 6A copper', '3 m'], [1, 'Cat 6A copper', 'length not set'],
    [1, 'Media not set', 'length not set'], [1, 'toString', 'length not set']]);
  const mixed = new Map([['i2|front|mgmt-eth', {info: COPPER}], ['i3|front|port-2-1', {info: FIBER}]]);
  assert.equal(X.cableBomRows({...RACK, cables: [c]}, mixed)[0].description,
    'length not set; copper at one end, fiber at the other');
  assert.deepEqual(X.cableBomRows({...RACK, cables: []}), []);
  assert.deepEqual(X.cableBomRows({items: []}), []);
});
```

- [ ] **Step 2: Write the failing browser check**

In `check-browser.py`, add before `def main():`

```python
@extra("rack.html: Export - the BOM lists cables by media, length and connector, never a plug, and no longer says cables are left out")
def check_rack_export_bom_cables(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    try:
        open_cabled(page, base)
    except RuntimeError as e:
        return bad + [f"BOM cables: {e}"]
    cols, rows, text = read_csv(export_file(page, "bom"))
    status = export_status(page)
    cables = [(r["qty"], r["manufacturer"], r["model"], r["description"], r["ref"]) for r in rows if r["section"] == "Cables"]
    want = [("1", "", "Cat 6A copper", "length not set; copper at both ends", ""),
            ("1", "", "OS2 single-mode fiber", "2 m; fiber at both ends", ""),
            ("1", "", "OS2 single-mode fiber", "length not set; copper at one end", "")]
    if cables != want:
        bad.append(f"BOM cables: the Cables section is {cables}")
    if [r["section"] for r in rows][-3:] != ["Cables"] * 3:
        bad.append(f"BOM cables: the cables are not the last section: {[r['section'] for r in rows]}")
    if any(r["section"] == "Plugs" or "plug" in r["ref"] for r in rows):
        bad.append("BOM cables: a derived plug is listed as a part")
    notes = text.partition("\r\nNotes\r\n")[2]
    if "not in this export yet" in notes:
        bad.append(f"BOM cables: the notes still say cables are left out: {notes!r}")
    n = len([l for l in notes.split("\r\n") if l])
    if status != notes_status(n):
        bad.append(f"BOM cables: {n} notes in the file, but the status reads {status!r}")

    # A rack with no cables has no Cables section, and its BOM is what it was.
    open_fixture(page, base)
    _, rows, text = read_csv(export_file(page, "bom"))
    if any(r["section"] == "Cables" for r in rows) or "cable" in text.partition("\r\nNotes\r\n")[2].lower():
        bad.append("BOM cables: a rack with no cables has a Cables row or a cable note")
    # Zero-U items are still said to be left out; only the cable line is retired.
    kept = page.evaluate("""async () => {
      const X = await import('/site/rack/exports.js'), C = await import('/site/rack/chassis.js');
      const of = C.chassisLookup(await C.loadChassis());
      const r = window.__rack.doc().racks[0];
      return (await X.bomCsv({...r, zeroU: [{}]}, of)).notes;
    }""")
    if "1 zero-U item is not in this export yet." not in kept:
        bad.append(f"BOM cables: the zero-U note is gone: {kept}")
    return bad
```

`check_rack_cables_3d` asserts today that the BOM says its cables are left out. In it, replace

```python
    # The BOM says the same, through the same notes.
    bom = pathlib.Path(export_file(page, "bom").path()).read_text(encoding="utf-8")
    if "3 cables are not in this export yet." not in bom:
        bad.append("cables 3D: the BOM's notes do not say its 3 cables are left out")
```

with

```python
    # The BOM carries the cables now (check_rack_export_bom_cables), so it does not say they are left out.
    bom = pathlib.Path(export_file(page, "bom").path()).read_text(encoding="utf-8")
    if "not in this export yet" in bom:
        bad.append("cables 3D: the BOM still says cables are not in it")
```

- [ ] **Step 3: Run both and see them fail**

Run: `node --test tests/rack/export-cables.test.mjs`
Expected: 9 tests, 2 failures, both `TypeError: X.cableBomRows is not a function`.

Run: `python3 check-browser.py --only check_rack_export_bom_cables`
Expected: `FAIL`, with "the Cables section is []" and "the notes still say cables are left out".

- [ ] **Step 4: Write the rows**

In `site/rack/export-data.js`, replace

```js
import {endKey, endName, cableName, mismatch, MEDIA_LABELS} from './cable-rules.js';
```

with

```js
import {endKey, endName, cableName, mismatch, lengthText, MEDIA_LABELS} from './cable-rules.js';
```

and append at the end of the file:

```js
// CABLES IN THE BOM (spec §8): one line per media, length and connector, with
// a quantity. A cable with no length - or one whose length the page could not
// use - is "length not set". The connector is what each end's port takes, as
// cable-plugs.js read it (`ends`, as for cableFindings); the two ends are
// said in one order, so A-to-B and B-to-A are one line. The plugs a cable is
// drawn with are part of the cable: they are never lines of their own.
const FAMILY = {fiber: 'fiber', copper: 'copper', dac: 'DAC', aoc: 'AOC'};
const familyOf = info => (info && Object.hasOwn(FAMILY, info.family ?? '') ? FAMILY[info.family] : null);
function connectorText(a, b) {
  const known = [familyOf(a), familyOf(b)].filter(Boolean).sort();
  if (known.length === 2) return known[0] === known[1] ? `${known[0]} at both ends` : `${known[0]} at one end, ${known[1]} at the other`;
  return known.length ? `${known[0]} at one end` : '';
}
export function cableBomRows(rack, ends = new Map()) {
  const lines = new Map();
  for (const c of rack.cables || []) {
    const info = s => ends.get(endKey(c[s]))?.info;
    const length = lengthText(c.length) || 'length not set';
    const connector = connectorText(info('a'), info('b'));
    const key = JSON.stringify([c.media, length, connector]);
    const l = lines.get(key);
    if (l) l.qty++;
    else lines.set(key, {section: 'Cables', qty: 1, manufacturer: '', model: mediaLabel(c.media) || 'Media not set',
                         description: [length, connector].filter(Boolean).join('; '), ref: ''});
  }
  return [...lines.values()].sort((a, b) => a.model.localeCompare(b.model) || a.description.localeCompare(b.description));
}
```

- [ ] **Step 5: Put them in the BOM**

In `site/rack/exports.js`, in the import of `./export-data.js`, replace

```js
        cableScheduleRows} from './export-data.js';
```

with

```js
        cableScheduleRows, cableBomRows} from './export-data.js';
```

In the comment above `bomCsv`, replace

```js
// mounting hardware, 4 x U per device. A spreadsheet opens this one, so
// its cells go through bomCell (formula guard); the DCIM CSVs stay verbatim.
```

with

```js
// mounting hardware, 4 x U per device, and the cables by media, length and
// connector. A spreadsheet opens this one, so its cells go through bomCell
// (formula guard); the DCIM CSVs stay verbatim.
```

In `bomCsv`, replace

```js
  notes.unshift(...rackNotes(rack), ...mountNotes(items, chassisOf, rack.frame));
  if (!items.length) notes.push('This rack has no devices, so there is nothing to list.');
```

with

```js
  // The BOM carries the cables, so it no longer says they are left out. Their
  // connectors come from the faces as the items' OWN swaps configure them:
  // a derived plug is never a part, and never a line here.
  const cabled = (rack.cables || []).length > 0;
  const facts = cabled ? await cableEnds(rack) : UNCHECKED;
  notes.unshift(...rackNotes(rack, {cables: false}), ...mountNotes(items, chassisOf, rack.frame));
  if (cabled && facts.unchecked) notes.push('Cable ends could not be read, so the cable lines do not state their connectors.');
  if (!items.length) notes.push('This rack has no devices, so there is nothing to list.');
```

and replace

```js
  const rows = bomRows({devices, parts: lines, frame: rack.frame, railUs: railItems.map(i => i.u)});
  return
```

with

```js
  const rows = [...bomRows({devices, parts: lines, frame: rack.frame, railUs: railItems.map(i => i.u)}),
                ...cableBomRows(rack, facts.ends)];
  return
```

`seatedPartsOf` is not touched: it reads each face with the item's own swaps, so no plug becomes a part.

- [ ] **Step 6: Run everything this touches and see it pass**

Run: `node --test tests/rack/*.test.mjs`
Expected: `# pass 136`, `# fail 0`.

Run: `python3 check-browser.py --only check_rack_export_bom_cables,check_rack_export_bom,check_rack_cable_plugs,check_rack_export_empty,check_rack_export_notes_truthful,check_rack_mount_flag,check_rack_cables_3d`
Expected: seven `ok` lines. `check_rack_cable_plugs` proves the BOM still lists no plug.

- [ ] **Step 7: Commit**

```bash
git add site/rack/export-data.js site/rack/exports.js tests/rack/export-cables.test.mjs check-browser.py
git commit -m "rack: the BOM lists cables by media, length and connector

A Cables section after the mounting hardware: one line per media, length
and connector, with a quantity, and 'length not set' where a cable has no
usable length. The connector is what each end's port takes. A derived plug
is never a line. The BOM no longer says cables are left out of it.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Cables on the sheet, and on a single face; tags that survive on paper; a rack with no cables pinned byte for byte

Ruling 4: the sheet draws cables as the page does. The derived plugs are seated; every pane is widened by the side column and all grow together; a cross-face run leaves by a tag at the rack edge; a loose end hangs as an unplugged lead with its tag. A tag is part of the drawing on paper, so it must survive `standalone()` with fixed paint of its own, no `tabindex`, no role and no class. The notes block lists loose ends with their reasons and media mismatches. A front-only or rear-only export carries that face's cables and tags. **A rack with no cables produces a sheet byte for byte identical to today's.**

The cable code measures a laid-out drawing, so the order of `sheetSvg` changes: the sheet is attached to its hidden host first, the panes are placed, the cables are drawn, the panes grow, and only then is the title block placed under them.

**Files:**
- Modify: `site/rack/exports.js`, `check-browser.py`

**Interfaces:**
- Consumes: `cableEnds(rack)` (Task 2); `cableNotes(rack, ends)`, `UNCHECKED_NOTE`, `rackNotes(rack, {cables})` (Task 1); `mergeSeats(swaps, plugs)` from `site/rack/cable-rules.js`; `ROOM`, `widenForCables(svg)`, `drawRackCables(svg, rack, reasons)`, `roomForCables(svgs)` from `site/rack/cable-view.js`; `UNCHECKED` from `site/rack/cable-plugs.js`.
- Produces, in `site/rack/exports.js`:
  - `faceNotesFor(rack, items, panes, chassisOf = () => null, {cables = true} = {})` (exported, as before): the new option is passed to `rackNotes`.
  - `cabledItems(rack, base)` (module-private) → `Promise<{cabled, facts, items, reasons}>`: `items` are `base` with the derived plugs laid over each item's swaps; `reasons` is `Map(endKey -> reason | null)`. With no cables: `{cabled: false, facts: UNCHECKED, items: base, reasons: new Map()}`, and nothing is read. Task 6 uses it too.
  - `sheetSvg(rack, chassisOf, {faces, date})`: same signature and result shape as before.

- [ ] **Step 1: Pin the sheet of a rack with no cables**

This check holds the Phase 1b sheet builder as a reference and compares bytes. It passes on the code as it is now, and must keep passing after Step 5. In `check-browser.py`, add before `def main():`

```python
# THE SHEET AS PHASE 1B BUILT IT, kept here as the reference a rack with no
# cables is pinned to: the same faces, title block and notes, laid out by the
# arithmetic exports.js had before cables. For each set of faces it returns
# whether today's sheetSvg gives the same bytes, and where they first differ.
SHEET_1B_JS = """async ([y, m, d]) => {
  const X = await import('/site/rack/exports.js'), E = await import('/site/rack/elevation.js'),
        D = await import('/site/rack/export-data.js'), F = await import('/site/rack/fit.js'),
        R = await import('/site/rack/rails.js'), C = await import('/site/rack/chassis.js'),
        V = await import('/site/svg-export.js'), U = await import('/site/rack/dom.js'),
        L = await import('/site/rack/model.js');
  const chassisOf = C.chassisLookup(await C.loadChassis());
  const rack = window.__rack.doc().racks[0], date = new Date(y, m, d);
  const FACE_W = R.OPENING + R.RAIL_W * 2 + 12, M = 24, GAP = 48, HEAD = 28, LINE = 16, NOTE_LINE = 13;
  const INK = '#1D2125', MUTED = '#5B636B', PAPER = '#FFFFFF', RULE = '#B9BFC6';
  const text = (x, y, s, {size = 11, weight = 400, fill = INK, mono = false} = {}) => {
    const t = U.svgEl('text', {x, y, 'font-size': size, 'font-weight': weight, fill,
      'font-family': mono ? 'IBM Plex Mono, ui-monospace, monospace' : 'Archivo, system-ui, sans-serif'});
    t.textContent = s;
    return t;
  };
  async function before(faces) {
    const items = F.itemsWithU(rack, chassisOf);
    const notes = [...D.rackNotes(rack, {cables: false}), ...D.mountNotes(items, chassisOf, rack.frame)];
    for (const it of items) for (const pane of faces) {
      const panel = E.panelFor(it, pane);
      notes.push(...D.faceNotes({label: it.label, u: L.uLabel(rack.frame, it.ru), pane, panel,
                                 face: await X.faceOf(it, panel)}));
    }
    const all = D.uniq(notes);
    const panes = await Promise.all(faces.map(view =>
      E.drawElevation({items, frame: rack.frame, view, ears: true, metal: true, paper: true})));
    const faceH = rack.frame.heightRU * R.RU + 30;
    const width = M * 2 + faces.length * FACE_W + (faces.length - 1) * GAP;
    const chars = Math.floor((width - M * 2 - 24) / 6.2);
    const noteLines = all.flatMap(n => D.wrapText(n, chars - 2).map((l, i) => (i ? `  ${l}` : `• ${l}`)));
    const sheet = U.svgEl('svg', {xmlns: 'http://www.w3.org/2000/svg'});
    const paper = U.svgEl('rect', {x: 0, y: 0, fill: PAPER});
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
    const box = U.svgEl('rect', {x: M, y: blockY, width: (width - 2 * M).toFixed(2), fill: 'none', stroke: RULE});
    sheet.append(box);
    let yy = blockY + 22;
    D.titleLines(rack, date).forEach((line, i) => {
      sheet.append(text(M + 12, yy, line, i ? {fill: MUTED} : {size: 14, weight: 600}));
      yy += LINE;
    });
    if (noteLines.length) {
      yy += 6;
      sheet.append(text(M + 12, yy, 'Notes', {weight: 600}));
      for (const l of noteLines) { yy += NOTE_LINE; sheet.append(text(M + 12, yy, l, {size: 10, fill: MUTED, mono: true})); }
    }
    const blockH = yy - blockY + 12;
    box.setAttribute('height', blockH.toFixed(2));
    const height = blockY + blockH + M;
    for (const [k, v] of [['width', width], ['height', height]]) {
      sheet.setAttribute(k, v.toFixed(2));
      paper.setAttribute(k, v.toFixed(2));
    }
    sheet.setAttribute('viewBox', `0 0 ${width.toFixed(2)} ${height.toFixed(2)}`);
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:0;top:0;width:800px;visibility:hidden;pointer-events:none';
    document.body.append(host);
    try { host.append(sheet); return V.standalone(sheet); }
    finally { host.remove(); }
  }
  const out = {};
  for (const faces of [['front', 'rear'], ['front'], ['rear']]) {
    const was = await before(faces), now = (await X.sheetSvg(rack, chassisOf, {faces, date})).data;
    let at = 0;
    while (at < was.length && was[at] === now[at]) at++;
    out[faces.join('+')] = {same: was === now, bytes: was.length,
                            ...(was === now ? {} : {was: was.slice(Math.max(0, at - 60), at + 120),
                                                    now: now.slice(Math.max(0, at - 60), at + 120)})};
  }
  return out;
}"""


@extra("rack.html: Export - a rack with no cables gets the sheet it got before cables, byte for byte")
def check_rack_export_sheet_pinned(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    notes_fixture = json.loads(json.dumps(EXPORT_FIXTURE))
    notes_fixture["id"] = "doc-export-pin"
    notes_fixture["racks"][0]["name"] = "Export pin"
    notes_fixture["racks"][0]["zeroU"] = [{"id": "z1"}]
    notes_fixture["racks"][0]["items"].append(
        {"id": "i5", "ref": "no-such-device", "cfg": "base", "label": "mystery", "ru": 22, "face": "front",
         "turned": False, "swaps": {}, "fields": {}})
    for name, fixture in (("the export fixture", EXPORT_FIXTURE), ("a rack with notes", notes_fixture),
                          ("an empty rack", EMPTY_FIXTURE)):
        open_fixture(page, base, fixture)
        got = page.evaluate(SHEET_1B_JS, [2026, 0, 2])
        for faces, r in got.items():
            if r["bytes"] < 2000:
                bad.append(f"sheet pin ({name}, {faces}): the reference sheet is only {r['bytes']} bytes")
            if not r["same"]:
                bad.append(f"sheet pin ({name}, {faces}): the sheet changed for a rack with no cables: "
                           f"was {r['was']!r}, now {r['now']!r}")
    return bad
```

Run: `python3 check-browser.py --only check_rack_export_sheet_pinned`
Expected: `ok`. (`rackNotes(rack, {cables: false})` in the reference is Task 1's; with no cables it returns what `rackNotes(rack)` does.) If this is not `ok` before you change `exports.js`, stop: the reference is wrong for the code you have, and the pin would prove nothing.

- [ ] **Step 2: Write the failing check for a cabled sheet**

In `check-browser.py`, add before `def main():`

```python
# An exported sheet, measured: parsed, attached where it can be laid out, and
# each nested pane read - its box on the sheet, its viewBox, and every stroke,
# plug outline and tag of its cable layers that reaches outside that viewBox
# (a nested <svg> clips what is past its box). Also where the title block starts.
SHEET_PANES_JS = """(text) => {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:0;top:0;visibility:hidden;pointer-events:none';
  host.innerHTML = text.replace(/^<\\?xml[^>]*>\\s*/, '');
  document.body.append(host);
  try {
    const sheet = host.querySelector('svg');
    const num = (n, k) => parseFloat(n.getAttribute(k));
    const panes = [...sheet.querySelectorAll(':scope > svg[data-pane]')].map(svg => {
      const vb = svg.getAttribute('viewBox').split(/\\s+/).map(Number);
      const nodes = [...svg.querySelectorAll('[data-cables] path, [data-cables] rect, [data-cable-tags] rect, [data-cable-tags] text')];
      const out = nodes.map(n => [n, n.getBBox()]).filter(([, b]) =>
        b.x < vb[0] - 0.01 || b.y < vb[1] - 0.01 || b.x + b.width > vb[0] + vb[2] + 0.01 || b.y + b.height > vb[1] + vb[3] + 0.01)
        .map(([n, b]) => `${n.closest('[data-cable-id]')?.dataset.cableId} ${n.tagName} to y ${Math.round(b.y + b.height)} of ${Math.round(vb[1] + vb[3])}`);
      return {pane: svg.dataset.pane, x: num(svg, 'x'), y: num(svg, 'y'), w: num(svg, 'width'), h: num(svg, 'height'),
              vb, nodes: nodes.length, out};
    });
    const block = [...sheet.querySelectorAll(':scope > rect')].find(r => r.getAttribute('fill') === 'none');
    return {width: num(sheet, 'width'), height: num(sheet, 'height'), blockY: num(block, 'y'), panes};
  } finally { host.remove(); }
}"""


@extra("rack.html: Export - the sheet draws the cables as the page does: plugs, tags that survive on paper, loose leads, and notes; one face carries its own")
def check_rack_export_sheet_cables(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    try:
        open_cabled(page, base)
    except RuntimeError as e:
        return bad + [f"sheet cables: {e}"]
    ns = "{http://www.w3.org/2000/svg}"

    def cables_of(text):
        # {pane: {"cables": [ids, in file order], "tags": {id: text}}}
        root = ET.fromstring(text.encode("utf-8"))
        out = {}
        for pane in root.findall(f"{ns}svg"):
            layer = next((g for g in pane.findall(f"{ns}g") if g.get("data-cables")), None)
            tags = next((g for g in pane.findall(f"{ns}g") if g.get("data-cable-tags")), None)
            out[pane.get("data-pane")] = {
                "cables": sorted(g.get("data-cable-id") for g in (layer if layer is not None else [])),
                "tags": {g.get("data-cable-id"): g.find(f"{ns}text").text for g in (tags if tags is not None else [])},
                "tag_nodes": list(tags) if tags is not None else []}
        return out

    dl = export_file(page, "sheet-svg")
    status = export_status(page)
    text = pathlib.Path(dl.path()).read_text(encoding="utf-8")
    if dl.suggested_filename != "Cable-test-sheet.svg":
        bad.append(f"sheet cables: named {dl.suggested_filename!r}")
    got = cables_of(text)
    want = {"front": (["c1", "c2"], {"c2": "→ demarc port-2-1"}),
            "rear": (["c2", "c3"], {"c2": "→ leaf-1 mgmt-eth", "c3": "✕ not connected"})}
    for pane, (ids, tags) in want.items():
        g = got.get(pane, {"cables": None, "tags": None})
        if g["cables"] != ids or g["tags"] != tags:
            bad.append(f"sheet cables: the {pane} pane draws {g['cables']} with tags {g['tags']}, expected {ids} and {tags}")
    # The derived plugs are drawn (an LC plug in each bore of both optics, an RJ45 plug in each jack).
    for ref, n in (("generic/lc-plug@2", 4), ("generic/rj45-plug@1", 3)):
        if text.count(f'data-ref="{ref}') != n:
            bad.append(f"sheet cables: {text.count(f'data-ref="{ref}')} {ref} drawn, expected {n}")
    # A tag is drawing, not a control: fixed ink of its own, nothing of the screen's.
    for pane in got.values():
        for tag in pane["tag_nodes"]:
            rect, label = tag.find(f"{ns}rect"), tag.find(f"{ns}text")
            if (rect.get("fill"), label.get("fill"), label.get("font-size")) != ("#FFFFFF", "#1D2125", "11") \
                    or not rect.get("stroke") or any(tag.get(k) for k in ("class", "tabindex", "role", "style")):
                bad.append(f"sheet cables: a tag is not fixed ink on paper: {ET.tostring(tag, encoding='unicode')[:200]}")
    loose = [t for p in got.values() for t in p["tag_nodes"] if t.get("data-not-connected")]
    if len(loose) != 1 or loose[0].find(f"{ns}rect").get("stroke-dasharray") != "3 2":
        bad.append("sheet cables: the not-connected tag is not dashed, or there is not exactly one")
    for ui_bit in ("tabindex", "data-pt-ui", 'class="cable-tag', 'role="button"', "var(--pt-", "rk-end-pick",
                   "data-base-box", "cable-focus", 'class="on"'):
        if ui_bit in text:
            bad.append(f"sheet cables: screen UI in the file ({ui_bit})")
    for note in ("Cable c3: end A, leaf-1 (U14) port-2, is not connected (port-2 holds no", "does not suit end B, which is copper."):
        if note not in text:
            bad.append(f"sheet cables: the notes block lacks {note!r}")
    if "not in this export yet" in text:
        bad.append("sheet cables: the sheet still says cables are not in it")
    if status != notes_status(2):
        bad.append(f"sheet cables: two notes in the file, but the status reads {status!r}")
    m = page.evaluate(SHEET_PANES_JS, text)
    # 24 + (514.85 + 260) + 48 + (514.85 + 260) + 24: both panes widened by the column, which meet in the middle.
    if abs(m["width"] - 1645.70) > 0.01 or [p["w"] for p in m["panes"]] != [774.85, 774.85]:
        bad.append(f"sheet cables: the sheet is {m['width']} wide with panes {[p['w'] for p in m['panes']]}")
    for p in m["panes"]:
        if p["out"] or not p["nodes"]:
            bad.append(f"sheet cables: the {p['pane']} pane clips {p['out']} (of {p['nodes']} nodes)")
        if abs(p["h"] - p["vb"][3]) > 0.01 or p["y"] + p["h"] > m["blockY"]:
            bad.append(f"sheet cables: the {p['pane']} pane is {p['h']} tall for a viewBox of {p['vb'][3]}, title block at {m['blockY']}")

    # One face alone carries that face's cables and tags.
    front = pathlib.Path(export_file(page, "front-svg").path()).read_text(encoding="utf-8")
    rear = pathlib.Path(export_file(page, "rear-svg").path()).read_text(encoding="utf-8")
    for name, t, pane in (("front", front, "front"), ("rear", rear, "rear")):
        g = cables_of(t)
        ids, tags = want[pane]
        if list(g) != [pane] or g[pane]["cables"] != ids or g[pane]["tags"] != tags:
            bad.append(f"sheet cables, {name} only: draws {[(k, v['cables'], v['tags']) for k, v in g.items()]}")
        mm = page.evaluate(SHEET_PANES_JS, t)
        if abs(mm["width"] - 822.85) > 0.01 or mm["panes"][0]["out"]:
            bad.append(f"sheet cables, {name} only: {mm['width']} wide, clipping {mm['panes'][0]['out']}")

    # The PNG is that sheet at 2x.
    png = pathlib.Path(export_file(page, "sheet-png").path()).read_bytes()
    w = int.from_bytes(png[16:20], "big") if png[:8] == b"\x89PNG\r\n\x1a\n" else 0
    if w not in (3291, 3292):
        bad.append(f"sheet cables: the PNG is {w} px wide, expected the 1645.70 mm sheet at 2x")

    # The same ink in light and dark, cables and tags included.
    seen = {}
    for scheme in ("light", "dark"):
        page.emulate_media(color_scheme=scheme)
        seen[scheme] = page.evaluate("""async () => {
          const X = await import('/site/rack/exports.js'), C = await import('/site/rack/chassis.js');
          const of = C.chassisLookup(await C.loadChassis());
          return (await X.sheetSvg(window.__rack.doc().racks[0], of, {date: new Date(2026, 0, 2)})).data;
        }""")
    if seen["light"] != seen["dark"]:
        bad.append("sheet cables: the cabled sheet differs between light and dark")
    page.emulate_media(color_scheme="light")

    # A 42U rack cabled top to bottom, with a loose lead from its lowest device:
    # the panes grow together to hold the loop and the lead, and nothing is cut off.
    open_cabled(page, base, ROOM_FIXTURE)
    text = pathlib.Path(export_file(page, "sheet-svg").path()).read_text(encoding="utf-8")
    m = page.evaluate(SHEET_PANES_JS, text)
    base_h = 42 * 44.45 + 30
    hs = [p["h"] for p in m["panes"]]
    if len(hs) != 2 or hs[0] != hs[1] or hs[0] <= base_h + 40:
        bad.append(f"sheet cables, 42U: the panes are {hs} tall, expected one height past {base_h + 40}")
    for p in m["panes"]:
        if p["out"] or not p["nodes"]:
            bad.append(f"sheet cables, 42U: the {p['pane']} pane clips {p['out']} (of {p['nodes']} nodes)")
        if p["y"] + p["h"] > m["blockY"]:
            bad.append(f"sheet cables, 42U: the {p['pane']} pane runs into the title block")
    if "Cable c2: end B, a removed device's port-1, is not connected (the device was removed)." not in text:
        bad.append("sheet cables, 42U: the note for the cable to a removed device is missing")
    return bad
```

`check_rack_cables_3d` asserts today that the sheet has no cables. In it, replace

```python
    # 2a draws no cable into a file: the sheet has no cable and no derived
    # plug, and its notes say how many cables it leaves out.
    sheet = pathlib.Path(export_file(page, "sheet-svg").path()).read_text(encoding="utf-8")
    for bit in ("data-cable", "data-cable-tags", "generic/lc-plug@2", "generic/rj45-plug@1", "rk-end-pick"):
        if bit in sheet:
            bad.append(f"cables 3D: the sheet carries {bit!r}, and cables are not in the exports yet")
    if "3 cables are not in this export yet." not in sheet:
        bad.append("cables 3D: the sheet's notes do not say its 3 cables are left out")
```

with

```python
    # The sheet carries the cables now (check_rack_export_sheet_cables): what
    # stays out of it is the screen's - a picked end's outline - and the old note.
    sheet = pathlib.Path(export_file(page, "sheet-svg").path()).read_text(encoding="utf-8")
    for bit in ("rk-end-pick", "not in this export yet"):
        if bit in sheet:
            bad.append(f"cables 3D: the sheet carries {bit!r}")
```

- [ ] **Step 3: Run it and see it fail**

Run: `python3 check-browser.py --only check_rack_export_sheet_cables`
Expected: `FAIL`, starting with "the front pane draws [] with tags {}", "0 generic/lc-plug@2 drawn, expected 4", "the sheet still says cables are not in it" and "the sheet is 1125.7 wide with panes [514.85, 514.85]".

- [ ] **Step 4: The imports and the notes option**

In `site/rack/exports.js`, replace

```js
        cableScheduleRows, cableBomRows} from './export-data.js';
import {cableFacts, UNCHECKED} from './cable-plugs.js';
```

with

```js
        cableScheduleRows, cableBomRows, cableNotes, UNCHECKED_NOTE} from './export-data.js';
import {cableFacts, UNCHECKED} from './cable-plugs.js';
import {mergeSeats} from './cable-rules.js';
import {ROOM, widenForCables, drawRackCables, roomForCables} from './cable-view.js';
```

and replace

```js
// What the panes named could not show, item by item.
export async function faceNotesFor(rack, items, panes, chassisOf = () => null) {
  const notes = [...rackNotes(rack), ...mountNotes(items, chassisOf, rack.frame)];
```

with

```js
// What the panes named could not show, item by item. `cables: false` is for
// a file that carries the cables, and so does not say they are left out.
export async function faceNotesFor(rack, items, panes, chassisOf = () => null, {cables = true} = {}) {
  const notes = [...rackNotes(rack, {cables}), ...mountNotes(items, chassisOf, rack.frame)];
```

`drawioFile` still calls `faceNotesFor` with four arguments, so draw.io keeps its cable note until Task 6.

- [ ] **Step 5: The sheet**

In `site/rack/exports.js`, replace everything from the comment line `// THE SHEET: the faces asked for, side by side, fresh from drawElevation` down to the closing `}` of `sheetSvg` (the line before the `// DRAW.IO (spec §8)` comment) with:

```js
// The cabled ends of a rack as an export draws them: the items with the
// derived plugs laid over their own swaps (for this drawing only - notes, the
// BOM and the DCIM exports keep reading item.swaps), and why each end is
// loose. With no cables it reads nothing and the items are the rack's own.
async function cabledItems(rack, base) {
  if (!(rack.cables || []).length) return {cabled: false, facts: UNCHECKED, items: base, reasons: new Map()};
  const facts = await cableEnds(rack);
  return {cabled: true, facts,
          items: base.map(it => (facts.seats[it.id] ? {...it, swaps: mergeSeats(it.swaps, facts.seats[it.id])} : it)),
          reasons: new Map([...facts.ends].map(([k, v]) => [k, v.reason]))};
}

const boxOf = svg => svg.getAttribute('viewBox').split(/\s+/).map(Number);
const MONO = 'IBM Plex Mono, ui-monospace, monospace';

// A TAG IS PART OF THE DRAWING ON PAPER. On the page it is a control (a
// button, painted by rack.css, in a layer standalone() strips); on the sheet
// it is the only thing that says where a cross-face run goes or that a lead
// is not connected. So the layer stops being screen UI, and each pill gets
// fixed ink of its own: no class, no tabindex, no role, no theme token.
function paperTags(pane) {
  const set = (node, attrs) => { for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v); };
  for (const layer of pane.querySelectorAll(':scope > [data-cable-tags]')) {
    layer.removeAttribute('data-pt-ui');
    for (const tag of layer.querySelectorAll('[data-cable-tag]')) {
      const loose = tag.classList.contains('not-connected');
      for (const a of ['class', 'tabindex', 'role']) tag.removeAttribute(a);
      if (loose) tag.setAttribute('data-not-connected', 'true');
      set(tag.querySelector('rect'), {fill: PAPER, stroke: loose ? MUTED : RULE, 'stroke-width': 1,
                                      ...(loose ? {'stroke-dasharray': '3 2'} : {})});
      set(tag.querySelector('text'), {fill: INK, 'font-family': MONO, 'font-size': 11, 'font-weight': 500});
    }
  }
}

// THE SHEET: the faces asked for, side by side, fresh from drawElevation
// (no hit targets, no selection; ears and metal, as the page draws them),
// over a title block and, when there are any, the notes. The root carries a
// width and height in millimeters-as-pixels, so rasterize() draws it at its
// real size. `paper` gives a missing face's outline fixed ink too, so the
// file is the same in light and dark; `standalone` bakes whatever
// `var(--pt-*)` paint is left while the sheet is attached, as
// cabledElevationSvg does.
//
// WITH CABLES the sheet draws them as the page does (cable-view.js): the
// derived plugs seated, every pane widened by the side column and grown
// together to hold the lowest loop or lead, a cross-face run leaving by a
// tag, a loose end as an unplugged lead with its tag. The cable code
// measures a laid-out drawing, so the sheet is attached to its hidden host
// BEFORE the cables are drawn, and the title block is placed after them.
// A RACK WITH NO CABLES takes none of that: its sheet is byte for byte the
// one this function made before cables (check_rack_export_sheet_pinned).
export async function sheetSvg(rack, chassisOf, {faces = ['front', 'rear'], date = new Date()} = {}) {
  const base = itemsWithU(rack, chassisOf);
  const {cabled, facts, items, reasons} = await cabledItems(rack, base);
  // What a pane could not show is judged on the items' own swaps: a plug
  // nobody chose is never "the part chosen".
  const notes = await faceNotesFor(rack, base, faces, chassisOf, {cables: false});
  if (cabled && facts.unchecked) notes.push(UNCHECKED_NOTE);
  if (cabled) notes.push(...cableNotes(rack, facts.ends));
  const panes = await Promise.all(faces.map(view =>
    drawElevation({items, frame: rack.frame, view, ears: true, metal: true, paper: true})));

  const sheet = svgEl('svg', {xmlns: SVG_NS});
  const paper = svgEl('rect', {x: 0, y: 0, fill: PAPER});
  sheet.append(paper);
  const host = el('div', {'aria-hidden': 'true'});
  host.style.cssText = 'position:fixed;left:0;top:0;width:800px;visibility:hidden;pointer-events:none';
  document.body.append(host);
  try {
    host.append(sheet);
    if (cabled) for (const pane of panes) widenForCables(pane);
    // Every pane has one width: drawElevation's own, plus the column when cabled.
    const faceW = cabled ? FACE_W + ROOM : FACE_W;
    panes.forEach((pane, i) => {
      const x = M + i * (faceW + GAP);
      // The heading sits over the rack, not over the rear pane's column to its left.
      sheet.append(text(x + (cabled && faces[i] === 'rear' ? ROOM : 0), M + 16,
                        faces[i] === 'front' ? 'Front' : 'Rear', {size: 14, weight: 600}));
      pane.setAttribute('x', x.toFixed(2));
      pane.setAttribute('y', String(M + HEAD));
      pane.setAttribute('width', faceW.toFixed(2));
      pane.setAttribute('height', boxOf(pane)[3].toFixed(2));
      sheet.append(pane);
    });
    if (cabled) {
      for (const pane of panes) {
        try { drawRackCables(pane, rack, reasons); }
        catch (err) {
          // One face's cables failing must not cost the sheet: it comes without them, and says so.
          console.warn(`[portrayal] sheet: the ${pane.dataset.pane} face's cables`, err);
          pane.querySelectorAll(':scope > [data-cables], :scope > [data-cable-tags]').forEach(n => n.remove());
          notes.push(`The cables could not be drawn on the ${pane.dataset.pane} face of this sheet.`);
        }
      }
      roomForCables(panes);
      for (const pane of panes) {
        pane.setAttribute('height', boxOf(pane)[3].toFixed(2));
        pane.removeAttribute('data-base-box');
        paperTags(pane);
      }
    }
    const all = uniq(notes);
    const faceH = cabled ? boxOf(panes[0])[3] : rack.frame.heightRU * RU + 30;   // drawElevation's own viewBox height
    const width = M * 2 + faces.length * faceW + (faces.length - 1) * GAP;
    const chars = Math.floor((width - M * 2 - 24) / 6.2);   // 10 px mono runs about 6 px a character
    const noteLines = all.flatMap(n => wrapText(n, chars - 2).map((l, i) => (i ? `  ${l}` : `• ${l}`)));

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
    const stem = fileStem(rack.name);
    return {name: faces.length === 1 ? `${stem}-${faces[0]}.svg` : `${stem}-sheet.svg`,
            data: standalone(sheet), type: 'image/svg+xml', notes: all};
  } finally {
    host.remove();
  }
}
```

What makes the no-cables sheet identical: `faceW` and `faceH` are the same numbers the old code used, `x` is computed by the same expression, the nodes are appended in the same order (paper, then a heading and a pane per face, then the box, the title lines and the notes), and no attribute is added to a pane. Attaching the sheet before filling it changes nothing in what is serialized.

- [ ] **Step 6: Run the checks and see them pass**

Run: `python3 check-browser.py --only check_rack_export_sheet_pinned,check_rack_export_sheet_cables,check_rack_export_sheet,check_rack_export_sheet_theme,check_rack_export_empty,check_rack_cables_3d`
Expected: six `ok` lines. `check_rack_export_sheet_pinned` is the proof that a rack with no cables is untouched.

Then look at one: open `rack.html`, open a cabled rack, export the sheet and the PNG, and open them. The two side columns meet between the panes; each cross-face cable ends in a pill naming its far end; the loose end is a dashed pill at the end of a dashed leader.

- [ ] **Step 7: Commit**

```bash
git add site/rack/exports.js check-browser.py
git commit -m "rack: the sheet draws the cables - plugs, tags on paper, loose leads and notes; a rack with no cables is byte for byte what it was

The SVG and PNG sheet, and each face alone, draw the rack's cables with
the code the page uses: derived plugs seated, panes widened by the side
column and grown together, a cross-face run leaving by a tag, a loose end
as an unplugged lead. A tag is drawing on paper: it keeps fixed ink of its
own and loses its class, tabindex and role. The notes list loose ends with
reasons and media mismatches; the old cable note is gone from the sheet.
One face's cables failing to draw costs that face its cables and a note,
not the sheet.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: draw.io on one page, with a front and a rear cabinet side by side

Ruling 1. A user reported that the draw.io export "only seemed to export the front": the rear was a second page tab. The file becomes **one page, named for the rack**, with two cabinets. `vendor/drawio.js` is not edited, so the layout is made from what it offers: ONE group with `faces: ['front']` and TWO racks. Rack 0 holds what the front pane shows and rack 1 what the rear pane shows (`perFaceItems`, as today), every mounted entry filing its drawing under the key `front`. A rear-cabinet entry gets an id of its own (the item's id plus a suffix), so that Task 6's cable ends can name the cabinet that shows their panel.

The vendor then labels both cabinets "<rack name> · front". The second cabinet's label is corrected by one exact, anchored string replace on that cabinet's cell. If the anchor is not found, the export throws: it must fail where it can be seen, and never ship two "front" cabinets.

No cables yet: a cabled rack's draw.io file keeps saying its cables are left out until Task 6.

**Files:**
- Modify: `site/rack/export-data.js`, `tests/rack/export-cables.test.mjs`, `site/rack/exports.js`, `check-browser.py`

**Interfaces:**
- Consumes: `perFaceItems(items)`, `htmlText(s)`, `drawioU(heightRU, ru, u)` (in `export-data.js`); `faceOf(item, view)`, `faceNotesFor`, `panelFor(item, pane)`, `rackDiagram` (in or imported by `exports.js`).
- Produces, exported from `site/rack/export-data.js`:
  - `rearSuffix(items)` → a string no item id ends with (`'@rear'` unless an id does).
  - `drawioId(id, pane, suffix)` → `String(id)` for the front cabinet, `` `${id}${suffix}` `` for the rear one.
  - `rearCabinetLabel(xml, label)` → the file with the cell `g0r1-front` relabeled "… · rear"; throws if that cell is not found. `label` is the rack label as handed to the vendor (HTML-escaped).
- `drawioFile(rack, chassisOf)` keeps its signature and result shape. The cabinets' cell ids are `g0r0-front` (front) and `g0r1-front` (rear).
- `drawio_page(text)` in `check-browser.py`: one page's cabinets, ids and edges. Task 6's check uses it.

- [ ] **Step 1: Write the failing node tests**

Append to `tests/rack/export-cables.test.mjs`:

```js
test('draw.io: a rear cabinet entry gets an id no item has, whatever the ids are', () => {
  assert.equal(X.rearSuffix(RACK.items), '@rear');
  assert.equal(X.drawioId('i3', 'front', '@rear'), 'i3');
  assert.equal(X.drawioId('i3', 'rear', '@rear'), 'i3@rear');
  const odd = [{id: 'i3'}, {id: 'i3@rear'}, {id: 'x@rear@'}];
  const s = X.rearSuffix(odd);
  assert.equal(s, '@rear@@');
  const ids = odd.map(i => i.id), rear = odd.map(i => X.drawioId(i.id, 'rear', s));
  assert.equal(new Set([...ids, ...rear]).size, 6);
  assert.equal(X.drawioId(7, 'front', s), '7');
});

test("draw.io: the second cabinet's label is changed by one exact replace, escaped as the vendor writes it", () => {
  const cab = (id, value) => `<mxCell id="${id}" value="${value}" style="s" vertex="1" parent="1"></mxCell>`;
  const file = (a, b) => `<mxfile host="portrayal"><!--\nNotes:\n- id="g0r1-front" value="x · front"\n--><diagram name="x">${a}${b}</diagram></mxfile>`;
  assert.equal(X.rearCabinetLabel(file(cab('g0r0-front', 'x · front'), cab('g0r1-front', 'x · front')), 'x'),
    file(cab('g0r0-front', 'x · front'), cab('g0r1-front', 'x · rear')));
  // The label arrives HTML-escaped (htmlText), and the vendor escapes that for XML.
  const label = X.htmlText('R&D <core> "a"');
  const esc = 'R&amp;amp;D &amp;lt;core&amp;gt; &quot;a&quot;';
  assert.equal(X.rearCabinetLabel(file(cab('g0r0-front', `${esc} · front`), cab('g0r1-front', `${esc} · front`)), label),
    file(cab('g0r0-front', `${esc} · front`), cab('g0r1-front', `${esc} · rear`)));
  // A rack with no name: the vendor writes the face alone.
  assert.equal(X.rearCabinetLabel(file(cab('g0r0-front', 'front'), cab('g0r1-front', 'front')), ''),
    file(cab('g0r0-front', 'front'), cab('g0r1-front', 'rear')));
  // No such cell: it throws, and never returns the file unchanged.
  assert.throws(() => X.rearCabinetLabel(file(cab('g0r0-front', 'x · front'), ''), 'x'), /rear cabinet/);
  assert.throws(() => X.rearCabinetLabel(file(cab('g0r0-front', 'x · front'), cab('g0r1-front', 'y · front')), 'x'), /rear cabinet/);
});
```

- [ ] **Step 2: Rewrite the browser check for one page**

In `check-browser.py`, replace the whole of `check_rack_export_drawio`, from its `@extra(` line to its last `return bad`, with:

```python
# One draw.io page, read: its cabinets by cell id, what each one holds (the
# values of the cells whose parent it is), every id, and the edges.
def drawio_page(text):
    root = ET.fromstring(text)
    pages = root.findall("diagram")
    page = pages[0] if pages else None
    cells = list(page.iter("mxCell")) if page is not None else []
    geo = lambda c: c.find("mxGeometry")
    cabinets = {c.get("id"): {"value": c.get("value"), "x": float(geo(c).get("x")),
                              "holds": [k.get("value") for k in cells if k.get("parent") == c.get("id")]}
                for c in cells if re.fullmatch(r"g0r\d+-front", c.get("id") or "")}
    return {"names": [d.get("name") for d in pages], "cabinets": cabinets,
            "ids": [e.get("id") for e in (page.iter() if page is not None else []) if e.get("id")],
            "edges": [o for o in (page.iter("object") if page is not None else [])
                      if o.find("mxCell") is not None and o.find("mxCell").get("edge") == "1"]}


@extra("rack.html: Export - draw.io is one page with a front and a rear cabinet, only what shows from each side, and a seated card's ports")
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
        d = drawio_page(text)
    except ET.ParseError as e:
        return bad + [f"draw.io: not well-formed XML ({e})"]
    # ONE page, named for the rack: the rear is beside the front, not on a second tab.
    if d["names"] != ["Export test"]:
        return bad + [f"draw.io: pages {d['names']}, expected the one page 'Export test'"]
    cab = d["cabinets"]
    if {k: v["value"] for k, v in cab.items()} != {"g0r0-front": "Export test · front", "g0r1-front": "Export test · rear"}:
        return bad + [f"draw.io: cabinets {[(k, v['value']) for k, v in cab.items()]}, expected a front and a rear"]
    front, rear = cab["g0r0-front"], cab["g0r1-front"]
    # Side by side: the vendor's cabinet is 180 wide, and racks stand 190 apart.
    if (front["x"], rear["x"]) != (0.0, 370.0):
        bad.append(f"draw.io: the cabinets are at x {front['x']} and {rear['x']}, expected 0 and 370")
    dup = [i for i, c in Counter(d["ids"]).items() if c > 1]
    if dup:
        bad.append(f"draw.io: duplicate cell ids {dup[:5]}")
    if front["holds"].count("demarc") != 1:
        bad.append("draw.io front cabinet: expected one demarc (U20's, from behind); U14's is behind leaf-1")
    if "leaf-1" not in front["holds"] or "core-1" not in front["holds"]:
        bad.append(f"draw.io front cabinet: holds {front['holds']}")
    if "leaf-1" in rear["holds"]:
        bad.append("draw.io rear cabinet: leaf-1 is drawn, but demarc is mounted in front of it there")
    if rear["holds"].count("demarc") != 2 or "core-1" not in rear["holds"]:
        bad.append("draw.io rear cabinet: expected both demarcs and core-1's rear")
    # A rear cabinet entry has an id of its own, so its cells never collide with the front's.
    if "i1-g0r0-front" not in d["ids"] or "i1-rear-g0r1-front" not in d["ids"] or "i3-rear-g0r1-front" not in d["ids"]:
        bad.append("draw.io: core-1 is not in both cabinets under ids of its own, or the rear demarc is missing")
    card = [o for o in ET.fromstring(text).iter("object") if o.get("portrayal-path") == "slot-2/module/p0"]
    if [o.get("id") for o in card] != ["i1-g0r0-front-slot-2--module--p0"]:
        bad.append(f"draw.io front cabinet: the seated card's port cell is {[o.get('id') for o in card]}")
    if "numDisp=descend;" not in text:
        bad.append("draw.io: a bottom-up rack is not numbered from the bottom")
    if "Front cabinet: demarc is behind leaf-1 and is not drawn there." not in text:
        bad.append("draw.io: the notes comment does not list the device hidden behind leaf-1")
    if not text.startswith('<mxfile host="portrayal"><!--') or text.count("<!--") != 1:
        bad.append(f"draw.io: the notes are not one comment inside <mxfile>: {text[:80]!r}")
    # A rack with no cables: no edge, and no word about cables.
    if d["edges"] or "cable" in text.partition("-->")[0].lower():
        bad.append(f"draw.io: a rack with no cables has {len(d['edges'])} edges or a cable note")
    if "@rear" in text.partition("-->")[0]:
        bad.append("draw.io: an id made for the rear cabinet is in the notes a person reads")

    # draw.io reads a label as HTML (html=1): a name with & and < must reach it
    # HTML-escaped, or the tag-like part is dropped from what it shows.
    got = page.evaluate("""async () => {
      const X = await import('/site/rack/exports.js');
      const r = window.__rack.doc().racks[0];
      const rack = {...r, name: 'R&D <core>', items: r.items.filter(i => i.id === 'i2').map(i => ({...i, label: 'a<b>&c'}))};
      const out = await X.drawioFile(rack, () => ({ru: 1}));
      const doc = new DOMParser().parseFromString(out.data, 'application/xml');
      const shown = v => { const d = document.createElement('div'); d.innerHTML = v; return d.textContent; };
      const values = [...doc.querySelectorAll('[value]')].map(e => e.getAttribute('value')).filter(Boolean);
      const blank = await X.drawioFile({...rack, name: ''}, () => ({ru: 1}));
      return {name: out.name, error: doc.querySelector('parsererror')?.textContent || '',
              page: doc.querySelector('diagram')?.getAttribute('name'), values, shown: values.map(shown),
              blank: [...blank.data.matchAll(/id="g0r\\d-front" value="([^"]*)"/g)].map(m => m[1]),
              blankPage: blank.data.match(/<diagram name="([^"]*)"/)?.[1]};
    }""")
    if got["error"]:
        bad.append(f"draw.io labels: not well-formed XML ({got['error'][:120]})")
    if got["name"] != "R-D-core.drawio":
        bad.append(f"draw.io labels: named {got['name']!r}")
    for want in ("R&D <core> · front", "R&D <core> · rear", "a<b>&c", "▲ a<b>&c"):
        if want not in got["shown"]:
            bad.append(f"draw.io labels: draw.io would not show {want!r}; it shows {sorted(set(got['shown']))}")
    for want in ("R&amp;D &lt;core&gt; · front", "R&amp;D &lt;core&gt; · rear"):
        if want not in got["values"]:
            bad.append(f"draw.io labels: a cabinet's value is not HTML-escaped ({want!r}): {sorted(set(got['values']))}")
    # The page's name is an attribute, not a label: it is the rack's name as typed.
    if got["page"] != "R&D <core>":
        bad.append(f"draw.io labels: the page is named {got['page']!r}")
    # A rack with no name still gets a front and a rear cabinet, and a page with a name.
    if got["blank"] != ["front", "rear"] or got["blankPage"] != "Rack":
        bad.append(f"draw.io labels: a nameless rack's cabinets read {got['blank']} on page {got['blankPage']!r}")
    return bad
```

`check_rack_export_empty` expects a Front and a Rear page. In it, replace

```python
        root = ET.fromstring(pathlib.Path(dl.path()).read_text(encoding="utf-8"))
        if [d.get("name") for d in root.findall("diagram")] != ["Front", "Rear"]:
            bad.append("empty rack drawio: not a Front and a Rear page")
```

with

```python
        d = drawio_page(pathlib.Path(dl.path()).read_text(encoding="utf-8"))
        if d["names"] != ["Empty rack"] or [c["value"] for c in d["cabinets"].values()] != \
                ["Empty rack · front", "Empty rack · rear"] or any(c["holds"] for c in d["cabinets"].values()):
            bad.append(f"empty rack drawio: not one page with an empty front and rear cabinet: {d['names']}, {d['cabinets']}")
```

- [ ] **Step 3: Run both and see them fail**

Run: `node --test tests/rack/export-cables.test.mjs`
Expected: 11 tests, 2 failures (`TypeError: X.rearSuffix is not a function`, `TypeError: X.rearCabinetLabel is not a function`).

Run: `python3 check-browser.py --only check_rack_export_drawio`
Expected: `FAIL`, "draw.io: pages ['Front', 'Rear'], expected the one page 'Export test'".

- [ ] **Step 4: Write the rules**

In `site/rack/export-data.js`, insert immediately before the line `// ── DCIM (spec §8) ─────────────────────────────────────────────────────`:

```js
// DRAW.IO, ONE PAGE (Phase 2b ruling 1). Both cabinets stand on one page so
// a front-to-rear cable is one edge, not two stubs on two tabs. vendor/drawio.js
// lays the racks of ONE group side by side, each drawn once per face the group
// names; so the group names one face, 'front', and holds two racks: rack 0 is
// what the front pane shows, rack 1 what the rear pane shows. 'front' is only
// the key each mounted entry's drawing is filed under.
//
// The vendor finds a cable's port by the mounted entry's id, and an item is
// in both cabinets, so the rear cabinet's entries get the id plus a suffix.
// The suffix is one no item id ends with: a rear id then never equals an item
// id, and two items never share one.
export function rearSuffix(items) {
  let s = '@rear';
  while (items.some(i => String(i.id).endsWith(s))) s += '@';
  return s;
}
export const drawioId = (id, pane, suffix) => (pane === 'rear' ? `${id}${suffix}` : String(id));

// The vendor labels every cabinet "<rack label> · <face key>", so both read
// "· front". The second cabinet's value is put right by ONE exact replace on
// its own cell (id g0r1-front), escaped as the vendor's cell() writes it. If
// that cell is not there the file is wrong, and this throws: the export fails
// where it can be seen, and never ships two "front" cabinets.
const xmlAttr = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export function rearCabinetLabel(xml, label) {
  const cellOf = face => `id="g0r1-front" value="${xmlAttr(label ? `${label} · ${face}` : face)}"`;
  const was = cellOf('front');
  // Past the notes comment: inside a <diagram> every attribute value is escaped, so this text is the cell's own.
  const at = xml.indexOf(was, Math.max(0, xml.indexOf('<diagram')));
  if (at < 0) throw new Error("draw.io: the rear cabinet's label cell was not found");
  return xml.slice(0, at) + cellOf('rear') + xml.slice(at + was.length);
}
```

- [ ] **Step 5: Build the one page**

In `site/rack/exports.js`, replace

```js
        cableScheduleRows, cableBomRows, cableNotes, UNCHECKED_NOTE} from './export-data.js';
```

with

```js
        cableScheduleRows, cableBomRows, cableNotes, UNCHECKED_NOTE, rearSuffix, drawioId, rearCabinetLabel} from './export-data.js';
```

Then replace everything from the comment line `// DRAW.IO (spec §8): one page per face. Each cabinet holds what is mounted` down to the closing `}` of `drawioFile` (the line before the `// GLB / USDZ (spec §8)` comment) with:

```js
// DRAW.IO (spec §8, Phase 2b ruling 1): ONE page, a cabinet per face. Each
// cabinet holds what is mounted on that side and the far panel of whatever
// nothing mounted there covers (perFaceItems); a device hidden behind another
// is listed in the notes. Each face is the configured face that side shows
// (panelFor), so a seated card's ports are connection points carrying
// portrayal-path. The two cabinets are two racks of one group (export-data.js
// says why), and the second one's label is put right afterwards.
export async function drawioFile(rack, chassisOf) {
  const items = itemsWithU(rack, chassisOf);
  const H = rack.frame.heightRU;
  const lists = perFaceItems(items);
  const notes = await faceNotesFor(rack, items, ['front', 'rear'], chassisOf);
  for (const h of lists.hidden)
    notes.push(`${h.pane === 'front' ? 'Front' : 'Rear'} cabinet: ${h.item.label} is behind ${h.by.label} and is not drawn there.`);
  const numDisp = rack.frame.numbering === 'top-down' ? 'ascend' : 'descend';
  const suffix = rearSuffix(items);
  const label = htmlText(rack.name);
  const racks = [];
  for (const pane of ['front', 'rear']) {
    const mounted = await Promise.all(lists[pane].map(async it => {
      const f = await faceOf(it, panelFor(it, pane));
      // Filed under 'front' in both cabinets: it is the group's one face key, not the side shown.
      return {id: drawioId(it.id, pane, suffix), name: htmlText(it.label), u: drawioU(H, it.ru, it.u), ru: it.u,
              faces: f ? {front: {svg: f.text, vb: f.vb, ports: f.ports}} : {}};
    }));
    racks.push({label, units: H, numDisp, mounted});
  }
  const all = uniq(notes);
  // rackDiagram writes the notes as a comment INSIDE <mxfile>: draw.io reads
  // its <diagram> children and skips a comment there. Names and labels are
  // HTML-escaped above because its label cells are html=1; the page's name is
  // an attribute, which the vendor escapes itself.
  const xml = rackDiagram([{label: rack.name || 'Rack', faces: ['front'], racks}], {labels: true, notes: all});
  return {name: `${fileStem(rack.name)}.drawio`, data: rearCabinetLabel(xml, label), type: 'application/xml', notes: all};
}
```

- [ ] **Step 6: Run everything this touches and see it pass**

Run: `node --test tests/rack/*.test.mjs`
Expected: `# pass 138`, `# fail 0`.

Run: `python3 check-browser.py --only check_rack_export_drawio,check_rack_export_empty,check_rack_mount_flag_3d_exports,check_drawio_group_faces`
Expected: four `ok` lines.

Then open one in draw.io (app.diagrams.net, File, Open from, Device): one tab, named for the rack; two cabinets side by side, the second labeled "· rear".

- [ ] **Step 7: Commit**

```bash
git add site/rack/export-data.js site/rack/exports.js tests/rack/export-cables.test.mjs check-browser.py
git commit -m "rack: draw.io is one page - a front and a rear cabinet side by side

The rear was a second page tab, and read as missing. Both cabinets are now
on one page named for the rack: two racks of one group, the second relabeled
rear by one anchored replace that throws if its cell is not there. A rear
cabinet entry has an id of its own, ready for cables to name it.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: draw.io cable edges and notes

Ruling 2. Cables go through `rackDiagram`'s own `cables` option, with a `cableStyle` object keyed by media and built from `site/rack/cables.js` (no color literal in `exports.js`). A cable with a loose end is **not** drawn as an edge (an empty cage is a real port cell, and an edge to it would read as connected); it is listed in the notes with its reason. The export writes its own notes, in the page's words: the vendor's own note for a cable it cannot place prints the mounted ids, and a rear-cabinet id must never be in text a person reads. So the export hands the vendor only cables it knows the vendor can place.

**Files:**
- Modify: `site/rack/export-data.js`, `tests/rack/export-cables.test.mjs`, `site/rack/exports.js`, `check-browser.py`

**Interfaces:**
- Consumes: `cableFindings`, `cableNotes(rack, ends, {undrawn: true})`, `UNCHECKED_NOTE` (Task 1); `rearSuffix`, `drawioId`, `rearCabinetLabel` (Task 5); `cabledItems(rack, base)` and `faceNotesFor(…, {cables: false})` (Task 4); `paneOf(item, view)`, `endName` from `site/rack/cable-rules.js`; `COLORS`, `colorOf` from `site/rack/cables.js`; `drawio_page(text)` in `check-browser.py` (Task 5).
- Produces, exported from `site/rack/export-data.js`:
  - `drawioMedia(link)` → the media key an edge's color is filed under: the cable's media, or `` `copper-${purpose}` `` for the showcase's `copper`. Task 7 uses it.
  - `drawioCables(rack, {ends = new Map(), idOf, drawn})` → `{cables, notes}`. `idOf(itemId, pane)` is the mounted entry's id in that pane's cabinet; `drawn(itemId, pane, path)` says whether that cabinet has a port cell for the path. `cables` are `{id, a: {item, path}, b, media, purpose, label, length?}`, ready for `rackDiagram`.

- [ ] **Step 1: Write the failing node tests**

Append to `tests/rack/export-cables.test.mjs`:

```js
test('draw.io: an edge is filed under the media that colors it', () => {
  assert.equal(X.drawioMedia({media: 'os2', purpose: 'uplink'}), 'os2');
  assert.equal(X.drawioMedia({media: '', purpose: 'x'}), '');
  assert.equal(X.drawioMedia({purpose: 'x'}), '');
  assert.equal(X.drawioMedia({media: 'copper', purpose: 'management'}), 'copper-management');
  assert.equal(X.drawioMedia({media: 'copper', purpose: ''}), 'copper-server');
});

test('draw.io: each end names the cabinet that shows its panel; a loose end or an undrawn port is a note, not an edge', () => {
  const idOf = (id, pane) => X.drawioId(id, pane, '@rear');
  const all = () => true;
  const got = X.drawioCables(RACK, {ends: ENDS, idOf, drawn: all});
  assert.deepEqual(got.cables, [
    {id: 'c1', a: {item: 'i2', path: 'port-1'}, b: {item: 'i1', path: 'slot-2/module/p0'}, media: 'os2',
     purpose: 'uplink', label: 'A1', length: {value: 2, unit: 'm', source: 'entered'}},
    // leaf-1's front panel is in the front cabinet; the rear-mounted demarc's front panel is in the rear one.
    {id: 'c2', a: {item: 'i2', path: 'mgmt-eth'}, b: {item: 'i3@rear', path: 'port-2-1'}, media: 'cat6a',
     purpose: 'management', label: ''}]);
  assert.deepEqual(got.notes, [
    'Cable c3 is not drawn: end A, leaf-1 (U14) port-2, is not connected (port-2 holds no optic).',
    'Cable c3: OS2 single-mode fiber does not suit end B, which is copper.']);
  // A turned device shows its front panel on the other side.
  const turned = {...RACK, items: RACK.items.map(i => (i.id === 'i2' ? {...i, turned: true} : i))};
  assert.equal(X.drawioCables(turned, {ends: ENDS, idOf, drawn: all}).cables[0].a.item, 'i2@rear');
  // A port its cabinet does not draw: the device is hidden there, or the port is not in the drawing.
  const asked = [];
  const hidden = X.drawioCables(RACK, {ends: ENDS, idOf, drawn: (id, pane, path) => { asked.push([id, pane, path]); return id !== 'i3'; }});
  assert.deepEqual(asked, [['i2', 'front', 'port-1'], ['i1', 'front', 'slot-2/module/p0'],
                           ['i2', 'front', 'mgmt-eth'], ['i3', 'rear', 'port-2-1']]);
  assert.deepEqual(hidden.cables.map(c => c.id), ['c1']);
  assert.equal(hidden.notes.at(-1),
    'Cable c2 is not drawn: end B, demarc (U14) port-2-1, has no port drawn in the rear cabinet.');
  // Not checked, and a device gone: the cable is still not an edge to nothing, and no cabinet id is in a note.
  const gone = {...RACK, items: RACK.items.filter(i => i.id !== 'i3')};
  const un = X.drawioCables(gone, {idOf, drawn: all});
  assert.deepEqual(un.cables.map(c => c.id), ['c1', 'c3']);
  assert.deepEqual(un.notes, ["Cable c2 is not drawn: end B, a removed device's port-2-1, names a device that is not in the rack."]);
  assert.ok(![...got.notes, ...hidden.notes, ...un.notes].some(n => n.includes('@rear')));
  assert.deepEqual(X.drawioCables({...RACK, cables: []}, {idOf, drawn: all}), {cables: [], notes: []});
});
```

- [ ] **Step 2: Write the failing browser check**

In `check-browser.py`, add before `def main():`

```python
@extra("rack.html: Export - draw.io draws each landed cable as an edge between port cells, across the two cabinets, in the page's colors; a loose end is a note")
def check_rack_export_drawio_cables(page, base):
    from collections import Counter
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    try:
        open_cabled(page, base)
    except RuntimeError as e:
        return bad + [f"draw.io cables: {e}"]
    dl = export_file(page, "drawio")
    status = export_status(page)
    text = pathlib.Path(dl.path()).read_text(encoding="utf-8")
    try:
        d = drawio_page(text)
    except ET.ParseError as e:
        return bad + [f"draw.io cables: not well-formed XML ({e})"]
    if d["names"] != ["Cable test"] or sorted(d["cabinets"]) != ["g0r0-front", "g0r1-front"]:
        return bad + [f"draw.io cables: pages {d['names']}, cabinets {sorted(d['cabinets'])}"]
    dup = [i for i, c in Counter(d["ids"]).items() if c > 1]
    if dup:
        bad.append(f"draw.io cables: duplicate cell ids {dup[:5]}")
    colors = page.evaluate("async () => (await import('/site/rack/cables.js')).COLORS")
    style = "edgeStyle=orthogonalEdgeStyle;rounded=1;endArrow=none;startArrow=none;strokeWidth=2;fontSize=8;" \
            "labelBackgroundColor=#FFFFFF;strokeColor={};"
    got = {o.get("id"): {"label": o.get("label"), "cable": o.get("portrayal-cable"), "media": o.get("portrayal-media"),
                         "purpose": o.get("portrayal-purpose"), "length": o.get("portrayal-length"),
                         "source": o.find("mxCell").get("source"), "target": o.find("mxCell").get("target"),
                         "style": o.find("mxCell").get("style")} for o in d["edges"]}
    want = {
        # Both ends in the front cabinet: a seated card's port is a cell like any other.
        "cable-c1": {"label": "A1 · 2 m", "cable": "c1", "media": "os2", "purpose": "uplink", "length": "2 m",
                     "source": "i2-g0r0-front-port-1", "target": "i1-g0r0-front-slot-2--module--p0",
                     "style": style.format(colors["os2"])},
        # Front cabinet to rear cabinet, one edge: the demarc's front panel is what the rear shows.
        "cable-c2": {"label": "", "cable": "c2", "media": "cat6a", "purpose": "management", "length": None,
                     "source": "i2-g0r0-front-mgmt-eth", "target": "i3-rear-g0r1-front-port-2-1",
                     "style": style.format(colors["cat6a"])}}
    if got != want:
        bad.append(f"draw.io cables: the edges are {got}")
    for e in got.values():
        for end in (e["source"], e["target"]):
            if end not in d["ids"]:
                bad.append(f"draw.io cables: an edge ends at {end!r}, which is no cell in the file")
    notes = text.partition("-->")[0]
    for note in ("Cable c3 is not drawn: end A, leaf-1 (U14) port-2, is not connected (port-2 holds no optic).",
                 "Cable c3: OS2 single-mode fiber does not suit end B, which is copper."):
        if note not in notes:
            bad.append(f"draw.io cables: the notes lack {note!r}")
    for bit in ("not in this export yet", "@rear", "names no mounted device", "is not a port in"):
        if bit in notes:
            bad.append(f"draw.io cables: the notes a person reads carry {bit!r}")
    n = len([l for l in notes.splitlines() if l.startswith("- ")])
    if n != 4 or status != notes_status(n):
        bad.append(f"draw.io cables: {n} notes in the file, and the status reads {status!r}")

    # An end whose device is hidden in the cabinet that would show it: leaf-1
    # turned shows its ports to the rear, where the demarc at U14 covers it.
    # And a cable with no media takes the neutral color.
    odd = page.evaluate("""async () => {
      const X = await import('/site/rack/exports.js'), C = await import('/site/rack/chassis.js');
      const of = C.chassisLookup(await C.loadChassis());
      const r = window.__rack.doc().racks[0];
      const hidden = await X.drawioFile({...r, items: r.items.map(i => (i.id === 'i2' ? {...i, turned: true} : i))}, of);
      const plain = await X.drawioFile({...r, cables: [{...r.cables[1], media: '', label: '<b>&"'}]}, of);
      const edge = new DOMParser().parseFromString(plain.data, 'application/xml').querySelector('object[portrayal-cable]');
      return {hidden: hidden.notes, hiddenEdges: (hidden.data.match(/portrayal-cable=/g) || []).length,
              style: edge?.querySelector('mxCell').getAttribute('style') || '', label: edge?.getAttribute('label'),
              media: edge?.getAttribute('portrayal-media')};
    }""")
    if "Cable A1 is not drawn: end A, leaf-1 (U14) port-1, has no port drawn in the rear cabinet." not in odd["hidden"] \
            or odd["hiddenEdges"] != 0:
        bad.append(f"draw.io cables: a cable to a hidden device: {odd['hiddenEdges']} edges, notes {odd['hidden']}")
    if not odd["style"].endswith(f"strokeColor={colors['unset']};") or odd["media"] is not None:
        bad.append(f"draw.io cables: a cable with no media is styled {odd['style'][-30:]!r}, media {odd['media']!r}")
    if odd["label"] != '<b>&"':
        bad.append(f"draw.io cables: a cable's label is not its own text: {odd['label']!r}")
    return bad
```

- [ ] **Step 3: Run both and see them fail**

Run: `node --test tests/rack/export-cables.test.mjs`
Expected: 13 tests, 2 failures (`TypeError: X.drawioMedia is not a function`, `TypeError: X.drawioCables is not a function`).

Run: `python3 check-browser.py --only check_rack_export_drawio_cables`
Expected: `FAIL`, starting with "the edges are {}" and "the notes a person reads carry 'not in this export yet'".

- [ ] **Step 4: Write the mapping**

In `site/rack/export-data.js`, replace

```js
import {endKey, endName, cableName, mismatch, lengthText, MEDIA_LABELS} from './cable-rules.js';
```

with

```js
import {endKey, endName, cableName, paneOf, mismatch, lengthText, MEDIA_LABELS} from './cable-rules.js';
```

and insert immediately before the line `// ── DCIM (spec §8) ─────────────────────────────────────────────────────` (after Task 5's `rearCabinetLabel`):

```js
// DRAW.IO CABLES (Phase 2b ruling 2). The vendor colors an edge by looking
// its cable's `media` up in a table, so the media handed to it is the key the
// color is filed under: the cable's own media, except the showcase's
// 'copper', which is colored by purpose and so is keyed with it.
export const drawioMedia = l => (l.media === 'copper' ? `copper-${l.purpose || 'server'}` : String(l.media || ''));

// The rack's cables as vendor/drawio.js rackDiagram takes them, and the notes
// for the ones it is not given. An end names the mounted entry of the CABINET
// that shows its panel (paneOf), by that cabinet's id for the item (`idOf`),
// and carries no `view`: every drawing is filed under one face key.
//   - A cable with a loose end is not an edge: an empty cage is still a port
//     cell, and an edge to it would say "connected". cableNotes says why.
//   - A cable whose port has no cell in its cabinet (`drawn(itemId, pane,
//     path)` is false: the device is hidden behind another there, or the port
//     is not in the drawing) is not an edge either, and is noted here, in
//     words - the vendor's own note would print the cabinet ids.
export function drawioCables(rack, {ends = new Map(), idOf, drawn}) {
  const byId = new Map(rack.items.map(i => [i.id, i]));
  const cables = [], notes = cableNotes(rack, ends, {undrawn: true});
  for (const f of cableFindings(rack, ends)) {
    if (f.loose.length) continue;
    const c = f.cable;
    const sides = [['A', c.a], ['B', c.b]].map(([side, end]) => {
      const it = byId.get(end.item) || null, pane = it ? paneOf(it, end.view) : null;
      return {side, end, it, pane, ok: !!it && drawn(it.id, pane, end.path)};
    });
    const missing = sides.filter(s => !s.ok);
    if (missing.length) {
      const why = missing.map(s => `end ${s.side}, ${endName(rack, s.end)}, ` +
        (s.it ? `has no port drawn in the ${s.pane} cabinet` : 'names a device that is not in the rack'));
      notes.push(`Cable ${f.name} is not drawn: ${why.join('; ')}.`);
      continue;
    }
    const [a, b] = sides.map(s => ({item: idOf(s.it.id, s.pane), path: s.end.path}));
    cables.push({id: c.id, a, b, media: drawioMedia(c), purpose: c.purpose, label: c.label,
                 ...(c.length ? {length: c.length} : {})});
  }
  return {cables, notes};
}
```

- [ ] **Step 5: Hand the cables to the vendor**

In `site/rack/exports.js`, replace

```js
        cableScheduleRows, cableBomRows, cableNotes, UNCHECKED_NOTE, rearSuffix, drawioId, rearCabinetLabel} from './export-data.js';
```

with

```js
        cableScheduleRows, cableBomRows, cableNotes, UNCHECKED_NOTE, rearSuffix, drawioId, rearCabinetLabel,
        drawioCables, drawioMedia} from './export-data.js';
```

and replace

```js
import {ROOM, widenForCables, drawRackCables, roomForCables} from './cable-view.js';
```

with

```js
import {ROOM, widenForCables, drawRackCables, roomForCables} from './cable-view.js';
import {COLORS, colorOf} from './cables.js';
```

Then replace the whole of `drawioFile` again, from its comment line `// DRAW.IO (spec §8, Phase 2b ruling 1): ONE page, a cabinet per face. Each` down to its closing `}`, with:

```js
// DRAW.IO (spec §8, Phase 2b rulings 1 and 2): ONE page, a cabinet per face,
// and the cables as edges between port cells. Each cabinet holds what is
// mounted on that side and the far panel of whatever nothing mounted there
// covers (perFaceItems); a device hidden behind another is listed in the
// notes. Each face is the configured face that side shows (panelFor), drawn
// with the plugs its cables seat, so a seated card's ports are connection
// points carrying portrayal-path. The two cabinets are two racks of one group
// (export-data.js says why), and the second one's label is put right
// afterwards.
//
// A cable is handed to the vendor only when both its ends land and both have
// a port cell (export-data.js drawioCables); the rest are notes, written here
// in the page's words. Edge colors are cables.js's, by media, as on the page.
export async function drawioFile(rack, chassisOf) {
  const base = itemsWithU(rack, chassisOf);
  const {cabled, facts, items} = await cabledItems(rack, base);
  const H = rack.frame.heightRU;
  const lists = perFaceItems(items);
  const notes = await faceNotesFor(rack, base, ['front', 'rear'], chassisOf, {cables: false});
  for (const h of lists.hidden)
    notes.push(`${h.pane === 'front' ? 'Front' : 'Rear'} cabinet: ${h.item.label} is behind ${h.by.label} and is not drawn there.`);
  const numDisp = rack.frame.numbering === 'top-down' ? 'ascend' : 'descend';
  const suffix = rearSuffix(items);
  const label = htmlText(rack.name);
  const racks = [], ports = new Set();
  for (const pane of ['front', 'rear']) {
    const mounted = await Promise.all(lists[pane].map(async it => {
      const f = await faceOf(it, panelFor(it, pane));
      // The port cells this cabinet will hold, as the vendor picks them (cls 'port', by path).
      for (const p of f?.ports || []) if (p.cls === 'port') ports.add(`${it.id}|${pane}|${p.path || p.id}`);
      // Filed under 'front' in both cabinets: it is the group's one face key, not the side shown.
      return {id: drawioId(it.id, pane, suffix), name: htmlText(it.label), u: drawioU(H, it.ru, it.u), ru: it.u,
              faces: f ? {front: {svg: f.text, vb: f.vb, ports: f.ports}} : {}};
    }));
    racks.push({label, units: H, numDisp, mounted});
  }
  const wires = drawioCables(rack, {ends: facts.ends, idOf: (id, pane) => drawioId(id, pane, suffix),
                                    drawn: (id, pane, path) => ports.has(`${id}|${pane}|${path}`)});
  if (cabled && facts.unchecked) notes.push(UNCHECKED_NOTE);
  notes.push(...wires.notes);
  // The vendor looks a cable's color up by its media, lower-cased; the table is the page's own colors.
  const cableStyle = {default: COLORS.unset};
  for (const c of rack.cables || [])
    cableStyle[drawioMedia(c).toLowerCase()] = colorOf({media: c.media || 'unset', purpose: c.purpose});
  const all = uniq(notes);
  // rackDiagram writes the notes as a comment INSIDE <mxfile>: draw.io reads
  // its <diagram> children and skips a comment there. Names and labels are
  // HTML-escaped above because its label cells are html=1; the page's name is
  // an attribute, and a cable's label is plain text, which the vendor escapes.
  const xml = rackDiagram([{label: rack.name || 'Rack', faces: ['front'], racks}],
                          {labels: true, notes: all, cables: wires.cables, cableStyle});
  return {name: `${fileStem(rack.name)}.drawio`, data: rearCabinetLabel(xml, label), type: 'application/xml', notes: all};
}
```

Three things changed from Task 5's version: the faces are drawn from `cabledItems` (so a cabled end shows its plug) while the notes are judged on the items' own swaps; the cable note is retired (`{cables: false}`); and the cables, their style and their notes are added.

- [ ] **Step 6: Run everything this touches and see it pass**

Run: `node --test tests/rack/*.test.mjs`
Expected: `# pass 140`, `# fail 0`.

Run: `python3 check-browser.py --only check_rack_export_drawio_cables,check_rack_export_drawio,check_rack_export_empty,check_rack_mount_flag_3d_exports`
Expected: four `ok` lines. `check_rack_export_drawio` is the proof that a rack with no cables gets no edge and no word about cables.

Then open a cabled rack's file in draw.io: the front-to-rear cable is one line from the front cabinet to the rear one, and it stays attached when a device is dragged.

- [ ] **Step 7: Commit**

```bash
git add site/rack/export-data.js site/rack/exports.js tests/rack/export-cables.test.mjs check-browser.py
git commit -m "rack: draw.io draws each landed cable as an edge between port cells, in the page's colors

A cable whose two ends land and have port cells is an edge, across the two
cabinets when it runs front to rear, colored by media from cables.js. A
cable with a loose end, or with an end its cabinet does not draw, is a note
in the page's words, never an edge to an empty cage. The cable note is
retired from the draw.io export.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Stage 6's draw.io export gains the plan's cables as edges

Spec §9.4 and ruling 3. This is the one deliberate showcase change in Phase 2b: stage 6's draw.io file gains an edge for each link of the patching plan. Its other exports and its page do not change. `check_takeaway_drawio` is extended, not weakened.

Stage 6 already draws both faces of one rack on one page (`faces: ['front', 'rear']`), which is right there because no two showcase devices share a U. So a rear-to-front run is one edge with no id rewriting: each mounted entry takes its device ref as `id`, and an end keeps its `view`.

**Files:**
- Modify: `site/showcase/stages/06-takeaway.js`, `check-browser.py`

**Interfaces:**
- Consumes: `drawioMedia(link)` from `site/rack/export-data.js` (Task 6); `colorOf(link)` from `site/showcase/cables.js`; `looseReason(plan, kept, [device, path])` and `endView(end)` from `site/showcase/plan.js`; the handle `enterPatched` returns (`plan`, `kept`, `loose`).
- Produces: `buildDrawio(h)` takes that handle. Edges are `cable-0` to `cable-13`, with `portrayal-cable` the link's index and `portrayal-media` one of `os2`, `copper-server`, `copper-management`.

- [ ] **Step 1: Extend the check**

In `check-browser.py`, replace the whole of `check_takeaway_drawio`, from its `@extra(` line to its `return bad`, with:

```python
@extra("stage 6 draw.io carries the plan's seated card, front and rear")
def check_takeaway_drawio(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    open_showcase(page, base)
    # Stage 4 fills the plan's seats (the ASR-9006's slot-2 line card) into
    # the shared overrides; stage 6 must export them.
    page.click('.stage-rail button[data-stage="cable"]', timeout=READY_MS)
    page.wait_for_selector('[data-stage-ready="cable"]', timeout=READY_MS)
    page.click('.stage-rail button[data-stage="takeaway"]', timeout=READY_MS)
    page.wait_for_selector('[data-stage-ready="takeaway"]', timeout=READY_MS)
    with page.expect_download(timeout=READY_MS) as dl:
        page.click('#stageExport button:has-text("draw.io")')
    text = pathlib.Path(dl.value.path()).read_text()
    if 'portrayal-path="slot-2/module/p0"' not in text:
        bad.append("stage 6 draw.io: no port cell for the plan's slot-2 card")
    if 'value="rear"' not in text:
        bad.append("stage 6 draw.io: no rear cabinet")
    # The plan's 14 cables are edges between port cells, in cables.js's colors.
    try:
        root = ET.fromstring(text)
    except ET.ParseError as e:
        return bad + [f"stage 6 draw.io: not well-formed XML ({e})"]
    if len(root.findall("diagram")) != 1:
        bad.append("stage 6 draw.io: not one page")
    ids = {e.get("id") for e in root.iter() if e.get("id")}
    edges = {o.get("portrayal-cable"): o for o in root.iter("object") if o.get("portrayal-cable") is not None}
    if sorted(edges, key=int) != [str(i) for i in range(14)]:
        bad.append(f"stage 6 draw.io: edges for cables {sorted(edges)}, expected the plan's 14")
    colors = page.evaluate("async () => (await import('/site/showcase/cables.js')).COLORS")
    by_media = {"os2": colors["os2"], "copper-server": colors["copper"]["server"],
                "copper-management": colors["copper"]["management"]}
    seen = set()
    for i, o in edges.items():
        c = o.find("mxCell")
        if c.get("edge") != "1" or c.get("source") not in ids or c.get("target") not in ids:
            bad.append(f"stage 6 draw.io: cable {i} is not an edge between two cells of the file")
        media = o.get("portrayal-media")
        seen.add(media)
        if not c.get("style", "").endswith(f"strokeColor={by_media.get(media)};"):
            bad.append(f"stage 6 draw.io: cable {i} ({media}) is styled {c.get('style', '')[-28:]!r}")
    if seen != set(by_media):
        bad.append(f"stage 6 draw.io: the edges' media are {sorted(seen)}")
    # The server's NIC is on its rear, the switch port on its front: one edge across the two cabinets.
    nic = edges.get("8")
    if nic is not None:
        ends = (nic.find("mxCell").get("source"), nic.find("mxCell").get("target"))
        if ends != ("r740xd-g0r0-rear-ndc--module--port-1", "eps201-g0r0-front-port-1"):
            bad.append(f"stage 6 draw.io: the rear-to-front cable runs {ends}")
    if "<!--" in text:
        bad.append(f"stage 6 draw.io: the plan as built has a cable that was not drawn: {text[:300]!r}")
    return bad
```

- [ ] **Step 2: Run it and see it fail**

Run: `python3 check-browser.py --only check_takeaway_drawio`
Expected: `FAIL`, "stage 6 draw.io: edges for cables [], expected the plan's 14".

- [ ] **Step 3: Pass the plan's links as cables**

In `site/showcase/stages/06-takeaway.js`, in the header comment, replace

```js
//   draw.io   - a rack diagram through drawio.js's rackDiagram, fed each
//               device's configured face (site/rack/face.js) on front and
//               rear, so the cards, optics and plugs seated here are in it
//               and their ports are connection points.
```

with

```js
//   draw.io   - a rack diagram through drawio.js's rackDiagram, fed each
//               device's configured face (site/rack/face.js) on front and
//               rear, so the cards, optics and plugs seated here are in it
//               and their ports are connection points - and the plan's
//               cables, as edges between those points, in cables.js's colors.
```

Replace

```js
import {rackDiagram} from '../../../vendor/drawio.js';
import {configuredFace} from '../../rack/face.js';
```

with

```js
import {rackDiagram} from '../../../vendor/drawio.js';
import {configuredFace} from '../../rack/face.js';
import {colorOf} from '../cables.js';
import {looseReason, endView} from '../plan.js';
import {drawioMedia} from '../../rack/export-data.js';
```

Replace everything from the comment line `// The cast AS BUILT, both sides: each device's configured face - the cards,` down to the closing `}` of `buildDrawio` (the line before `export default function makeTakeaway() {`) with:

```js
// The cast AS BUILT, both sides: each device's configured face - the cards,
// optics and plugs stages 2-4 seated - so the diagram's port cells include
// the ports on those cards. A side a device was never drawn for is left
// out, and rackDiagram says "no rear drawing" there rather than borrowing
// the other side.
//
// AND AS CABLED (rack builder spec §9.4): each link of the plan is an edge
// between its two port cells. A mounted entry carries its device ref as `id`,
// which is what a link's end names. Both faces are on the one page, so a
// rear-to-front run (the server's NICs to the switch) is one edge. A link
// with a loose end (`h.loose`, as the panel lists it) is not drawn as if it
// were connected: it goes in the file's notes with the panel's own reason.
// Colors are cables.js's, through the media key drawio.js looks them up by.
async function buildDrawio(h) {
  if (!h) return;                 // the stage was left before the click was handled
  const mounted = [];
  for (const e of CAST) {
    if (e.ru == null) continue;   // dropped from the rack - no compiled index
    const faces = {};
    for (const view of ['front', 'rear']) {
      const f = await configuredFace({ref: e.ref, cfg: e.cfg, view,
                                      swaps: overrides[e.ref] || {},
                                      turned: !!e.turned}).catch(() => null);
      if (f) faces[view] = {svg: f.text, vb: f.vb, ports: f.ports};
    }
    if (!faces.front && !faces.rear) continue;
    // TWO NUMBERINGS. The cast counts U from 1 at the BOTTOM (e.ru is the
    // device's bottom U, as rack3d and the elevation read it); rackDiagram
    // counts from 1 at the TOP (numDisp=ascend, as drawio-page.js packs
    // it), and its `u` is where the device's top edge sits. So the device's
    // top U, e.ru + e.u - 1, is flipped: top U 22 of 22 is draw.io's u 1.
    // Passed as-is, the 10U ASR-9006 at the bottom drew at the top.
    mounted.push({id: e.ref, name: e.label, u: RACK_U - (e.ru + e.u - 1) + 1, ru: e.u, faces});
  }
  const refOf = id => (h.plan.devices || []).find(d => d.id === id)?.ref || id;
  const cables = [], notes = [], cableStyle = {};
  h.plan.links.forEach((l, i) => {
    const loose = h.loose[i] || [];
    if (loose.length) {
      notes.push(`The cable from ${l.from[0]} ${l.from[1]} to ${l.to[0]} ${l.to[1]} is not drawn: `
        + `${loose.map(k => looseReason(h.plan, h.kept, l[k])).join('; ')}.`);
      return;
    }
    const end = e => ({item: refOf(e[0]), path: e[1], view: endView(e)});
    cables.push({id: String(i), a: end(l.from), b: end(l.to), media: drawioMedia(l), purpose: l.purpose});
    cableStyle[drawioMedia(l)] = colorOf(l);
  });
  const groups = [{label: 'Cast rack', racks: [{label: '', units: RACK_U, mounted}]}];
  save(rackDiagram(groups, {faces: ['front', 'rear'], labels: true, cables, cableStyle, notes}),
       'cast-rack.drawio', 'application/xml');
}
```

In `enter`, replace

```js
         title: 'Download a draw.io rack diagram - front and rear, as built, with a connection point on every port',
         run: buildDrawio},
```

with

```js
         title: 'Download a draw.io rack diagram - front and rear, as built and cabled, with a connection point on every port',
         run: () => buildDrawio(handle)},
```

(`handle` is read when the button is clicked, so a visitor who has left the stage downloads nothing.) And replace

```js
          ['draw.io', 'rack diagram, front and rear, with the seated cards and optics and a connection point on every port'],
```

with

```js
          ['draw.io', 'rack diagram, front and rear, with the seated cards and optics, a connection point on every port and the cables as edges'],
```

The file keeps no color literal: every edge color is `colorOf(link)`.

- [ ] **Step 4: Run the showcase's checks and see them pass**

Run: `python3 check-browser.py --only check_takeaway_drawio,check_takeaway_cables_2d,check_takeaway_cables_3d,check_drawio_port_paths`
Expected: four `ok` lines.

Run: `python3 check-contract.py`
Expected: `contract: 292 checks passed`.

- [ ] **Step 5: Commit**

```bash
git add site/showcase/stages/06-takeaway.js check-browser.py
git commit -m "showcase: stage 6's draw.io export draws the plan's cables as edges

Each link of the patching plan is an edge between its two port cells, in
cables.js's colors; the server's rear NICs reach the switch's front ports as
one edge each. A link with a loose end is left out and noted with the
panel's own reason. Nothing else of stage 6 changes.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: 3D shows the cables and their plugs

Ruling 5. The 3D view seats the derived plugs and hangs each cable as a tube, in the colors 2D uses; a loose end dangles as the showcase's loose ends do.

Three facts shape the code:
- `findMounted` cannot tell two items of one ref apart. It gains one condition: match by `id` when the caller passes one. Additive: the showcase passes none.
- `cablePlan` names the PANE that shows an end. The scene places a device by its own face and turn, so it needs the device's own PANEL: a new pure `cablePlan3d`.
- `drawCables3d` anchors an end only on a seated connector's cable points. In 2D an end with no connector to seat (a port that takes no plug) lands on the port's center, and an end the page calls loose does not land at all. So that 2D and 3D agree, `drawCables3d` takes an optional `anchor(dev, path, view)`; the Rack Builder's refuses a loose end, tries `cableAnchor`, then falls back to `portAnchor`. With no `anchor`, `drawCables3d` does exactly what it does today.

A link that carries an `id` names its group `cable-<id>`; the showcase's links carry none and keep `cable-<index>`.

This task does not change which commits rebuild the scene: until Task 9, a cable edit made while in 3D shows after the next rebuild (a device edit, or leaving and re-entering 3D).

**Files:**
- Modify: `site/rack3d.js`, `site/rack/cables.js`, `site/rack/cable-rules.js`, `site/rack/scene3d.js`, `tests/rack/cables.test.mjs`, `check-browser.py`

**Interfaces:**
- Consumes: `cableFacts(rack)`, `UNCHECKED` from `site/rack/cable-plugs.js`; `mergeSeats`, `endKey` from `site/rack/cable-rules.js`; the scene API of `createRackScene` (`cableAnchor`, `portAnchor`, `deviceBoxes`, `resolved`, `three`).
- Produces:
  - `findMounted({id})` in `site/rack3d.js`, and so `scene.cableAnchor({id}, …)` and `scene.portAnchor({id}, …)`.
  - `cablePlan3d(rack)` exported from `site/rack/cable-rules.js` → `{links: [{id, media, purpose, from: [itemId, path, panel], to}]}`.
  - `drawCables3d(scene, plan, {live = () => true, anchor = null} = {})` in `site/rack/cables.js`; `anchor(dev, path, view)` resolves to `[{position, normal}, …]` or `[]`.
  - `scene.rackCables` on the scene `mountRack3d` returns: `null` for a rack with no cables; `{failed: true}` when the cables could not be drawn; else `drawCables3d`'s `{tubes, anchors, boxes, group}` plus `checked`. Tasks 9 and 10 and the checks read it through `window.__rack.scene()`.
  - `CABLES_3D_JS` in `check-browser.py`. Task 9's check uses it.

- [ ] **Step 1: Write the failing node test**

Append to `tests/rack/cables.test.mjs`:

```js
test('cablePlan3d hands the 3D scene each end as [item id, path, the device\'s own panel]', () => {
  let r = rack();
  // A turned device: its front panel is shown by the OTHER pane, and is still its front panel.
  r = M.updateItem(r, 'i2', {turned: true});
  r = C.withCable(r, {a: end('i2', 'port-1'), b: end('i1', 'slot-2/module/p0'), media: 'os2', purpose: 'uplink'}).rack;
  r = C.withCable(r, {a: end('i2', 'mgmt-eth'), b: end('i3', 'port-2-1', 'rear')}).rack;
  r = C.withCable(r, {a: end('i9', 'port-1'), b: end('i4', 'port-2-1')}).rack;
  assert.deepEqual(C.cablePlan3d(r).links, [
    {id: 'c1', media: 'os2', purpose: 'uplink', from: ['i2', 'port-1', 'front'], to: ['i1', 'slot-2/module/p0', 'front']},
    {id: 'c2', media: 'unset', purpose: '', from: ['i2', 'mgmt-eth', 'front'], to: ['i3', 'port-2-1', 'rear']},
    {id: 'c3', media: 'unset', purpose: '', from: ['i9', 'port-1', 'front'], to: ['i4', 'port-2-1', 'front']}]);
  // The 2D plan names the pane for the same end.
  assert.deepEqual(C.cablePlan(r).links[0].from, ['i2', 'port-1', 'rear']);
  assert.deepEqual(C.cablePlan3d(M.newRack()).links, []);
  assert.deepEqual(C.cablePlan3d({items: []}).links, []);
});
```

- [ ] **Step 2: Write the failing browser check**

In `check-browser.py`, add before `def main():`

```python
# What the 3D scene holds of the rack's cables: each tube's cable id, group
# name, color, the sides that did not land, and which device (by its place in
# rack.items) each drawn end is nearest - so two devices of one model are told
# apart. Plus the cable groups in the scene graph and each mount's overrides.
CABLES_3D_JS = """() => {
  const s = window.__rack.scene(), rc = s.rackCables;
  if (!rc || rc.failed) return {rc: rc ? 'failed' : null, groups: [], overrides: s.resolved().stack.map(e => e.overrides)};
  const boxes = s.deviceBoxes();
  const nearest = p => boxes.map((b, k) => [b.box.distanceToPoint(p), k]).sort((a, b) => a[0] - b[0])[0];
  const group = s.three.scene.getObjectByName('patch-cables');
  return {
    rc: 'drawn', checked: rc.checked,
    groups: group ? group.children.map(g => g.name) : [],
    tubes: rc.tubes.map(t => ({
      id: t.link.id, loose: t.loose, dangling: !!t.dangling, name: t.mesh ? t.mesh.name : null,
      color: t.mesh ? '#' + t.mesh.children[0].material.color.getHexString() : null,
      // An unplugged lead has one end on a device; its other end hangs free.
      ends: (t.dangling ? t.points.slice(0, 1) : t.points.length ? [t.points[0], t.points.at(-1)] : [])
        .map(p => { const [d, k] = nearest(p); return {item: k, mm: Math.round(d)}; })})),
    anchors: rc.anchors.map(a => `${a.i}:${a.side}:${a.anchor.path}`),
    overrides: s.resolved().stack.map(e => e.overrides)};
}"""


@extra("rack.html: 3D hangs the rack's cables as tubes between the right devices, with their plugs seated; a loose end dangles; a rack with no cables is untouched")
def check_rack_cables_3d_scene(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    # The cable fixture, and a fourth cable to a port that takes no plug (the
    # switch's USB port): in 2D it ends at the port's center, and so it must in 3D.
    fixture = cable_fixture("doc-cable-3d", "Cable 3D", lambda r: r["cables"].append(
        {"id": "c4", "a": {"item": "i2", "path": "usb", "view": "front"},
         "b": {"item": "i3", "path": "port-2-2", "view": "front"}, "media": "", "purpose": "", "label": "", "route": []}))
    try:
        open_cabled(page, base, fixture)
    except RuntimeError as e:
        return bad + [f"3D cables: {e}"]
    if webgl_trouble(page):
        print("[check_rack_cables_3d_scene] WebGL unavailable - not exercised")
        return bad
    page.click('#rkMode [data-mode="3d"]')
    wait_fn(page, "3D cables: the scene", "() => window.__rack.scene() != null", timeout=READY_3D_MS)
    got = page.evaluate(CABLES_3D_JS)
    if got["rc"] != "drawn" or not got.get("checked"):
        return bad + [f"3D cables: the scene's cables are {got['rc']!r}"]
    colors = page.evaluate("async () => (await import('/site/rack/cables.js')).COLORS")
    if got["groups"] != ["cable-c1", "cable-c2", "cable-c3", "cable-c4"]:
        bad.append(f"3D cables: the scene's cable groups are {got['groups']}")
    tubes = {t["id"]: t for t in got["tubes"]}
    # rack.items order: 0 core-1, 1 leaf-1, 2 demarc at U14, 3 demarc at U20.
    want = {"c1": ([], False, colors["os2"], [1, 0]),          # leaf-1 to core-1
            "c2": ([], False, colors["cat6a"], [1, 2]),        # leaf-1 to the demarc at U14, not its twin
            "c3": (["from"], True, colors["os2"], [3]),        # the empty cage is loose: a lead hangs from the demarc at U20
            "c4": ([], False, colors["unset"], [1, 2])}        # no plug at the USB port, and it still lands
    for cid, (loose, dangling, color, items) in want.items():
        t = tubes.get(cid)
        if not t:
            bad.append(f"3D cables: no tube for {cid}")
            continue
        if (t["loose"], t["dangling"], t["color"], t["name"]) != (loose, dangling, color, f"cable-{cid}"):
            bad.append(f"3D cables: {cid} is {t}")
        if [e["item"] for e in t["ends"]] != items or any(e["mm"] > 120 for e in t["ends"]):
            bad.append(f"3D cables: {cid} runs between items {t['ends']}, expected {items}")
    # Each landed end is on a seated connector: an LC plug in each bore of an optic, an RJ45 plug in a jack.
    # An end with no connector seated is anchored on the port itself.
    for a in ("0:from:port-1-occupant/tx-occupant", "0:to:slot-2/module/p0-occupant/rx-occupant",
              "1:from:mgmt-eth-occupant", "1:to:port-2-1-occupant", "2:to:port-2-1-occupant",
              "3:from:usb", "3:to:port-2-2-occupant"):
        if a not in got["anchors"]:
            bad.append(f"3D cables: no anchor {a} among {got['anchors']}")
    if any(a.startswith("2:from:") for a in got["anchors"]):
        bad.append("3D cables: the empty cage's end was anchored")
    # The plugs are in the scene's overrides, over the items' own swaps, and not in the document.
    if got["overrides"][2] != {"port-2-1": "generic/rj45-plug@1", "port-2-2": "generic/rj45-plug@1"} or \
            got["overrides"][1].get("port-1") != "generic/qsfp-lc@2" or \
            got["overrides"][1].get("port-1-occupant/tx") != "generic/lc-plug@2":
        bad.append(f"3D cables: the mounts' overrides are {got['overrides']}")
    swaps = page.evaluate("() => window.__rack.doc().racks[0].items.map(i => i.swaps)")
    if swaps != [i["swaps"] for i in CABLE_FIXTURE["racks"][0]["items"]]:
        bad.append(f"3D cables: plugs were written into item.swaps: {swaps}")

    # No cables: nothing is added to the scene, and the mounts' overrides are the items' swaps.
    page.click('#rkMode [data-mode="2d"]')
    open_fixture(page, base)
    page.click('#rkMode [data-mode="3d"]')
    wait_fn(page, "3D cables: the scene of a rack with no cables", "() => window.__rack.scene() != null", timeout=READY_3D_MS)
    got = page.evaluate(CABLES_3D_JS)
    if got["rc"] is not None or got["groups"] or \
            got["overrides"] != [i["swaps"] for i in EXPORT_FIXTURE["racks"][0]["items"]]:
        bad.append(f"3D cables: a rack with no cables has {got}")
    if page.evaluate("() => !!window.__rack.scene().three.scene.getObjectByName('patch-cables')"):
        bad.append("3D cables: a rack with no cables has a cable group in its scene")
    page.click('#rkMode [data-mode="2d"]')
    return bad
```

- [ ] **Step 3: Run both and see them fail**

Run: `node --test tests/rack/cables.test.mjs`
Expected: 1 failure, `TypeError: C.cablePlan3d is not a function`.

Run: `python3 check-browser.py --only check_rack_cables_3d_scene`
Expected: `FAIL`, "3D cables: the scene's cables are None". (On a runner with no WebGL the check prints that it was not exercised and passes; run it where there is WebGL.)

- [ ] **Step 4: A mount can be found by its id**

In `site/rack3d.js`, in `findMounted`, replace

```js
      return mounted.find(m =>
        (which.ru == null || m.entry.ru === which.ru) &&
```

with

```js
      // `id` is the mount's own (a Rack Builder item's id): two mounts of one
      // model at any U are then told apart without naming a U.
      return mounted.find(m =>
        (which.id == null || m.entry.id === which.id) &&
        (which.ru == null || m.entry.ru === which.ru) &&
```

Nothing else in `site/rack3d.js` changes.

- [ ] **Step 5: `drawCables3d` takes a caller's anchor, and names a cable by its id**

In `site/rack/cables.js`, four replacements, all inside or just above `drawCables3d`. Replace

```js
// the run was kept out of. null when `live()` went false during an await.
export async function drawCables3d(scene, plan, {live = () => true} = {}) {
```

with

```js
// the run was kept out of. null when `live()` went false during an await.
//
// `anchor(dev, path, view)` finds an end's connector points, as
// [{position, normal}, ...] or [] for an end that does not land; it defaults
// to the scene's cableAnchor on the mount of the plan device's ref, which is
// what the showcase needs. The Rack Builder passes its own (scene3d.js),
// which finds a mount by item id. A link that carries an `id` names its group
// `cable-<id>`; one without (the showcase's) keeps `cable-<index>`.
export async function drawCables3d(scene, plan, {live = () => true, anchor = null} = {}) {
```

Replace

```js
  const refOf = id => (plan.devices || []).find(d => d.id === id)?.ref || id;
```

with

```js
  const refOf = id => (plan.devices || []).find(d => d.id === id)?.ref || id;
  const find = anchor || ((dev, path, view) => scene.cableAnchor({ref: refOf(dev)}, path, {view}));
```

Replace

```js
      const got = await scene.cableAnchor({ref: refOf(dev)}, path, {view: view || 'front'});
```

with

```js
      const got = await find(dev, path, view || 'front');
```

Replace

```js
    const g = new THREE.Group(); g.name = `cable-${i}`;
```

with

```js
    const g = new THREE.Group(); g.name = `cable-${link.id ?? i}`;
```

- [ ] **Step 6: The plan the scene reads**

In `site/rack/cable-rules.js`, insert immediately before the line `// ── media ───────────────────────────────────────────────────────────────`:

```js
// The same cables for the 3D scene (cables.js drawCables3d): there an end is
// [item id, path, the device's OWN PANEL]. The scene places a device by its
// face and its turn itself, so it asks which of the device's panels a port is
// on, not which pane shows it. An end whose device is gone names no mount,
// and the scene hangs the other end as an unplugged lead.
export function cablePlan3d(rack) {
  const end = e => [e.item, e.path, e.view === 'rear' ? 'rear' : 'front'];
  return {links: (rack.cables || []).map(c =>
    ({id: c.id, media: c.media || 'unset', purpose: c.purpose || '', from: end(c.a), to: end(c.b)}))};
}
```

- [ ] **Step 7: Plugs and cables in the scene**

Replace the whole of `site/rack/scene3d.js` with:

```js
// THE RACK BUILDER'S 3D VIEW. A thin adapter over rack3d.js's createRackScene,
// the same one the showcase mounts (site/showcase/rack.js's mount3d) - one
// source, several views, and a swap in the side panel reaches both.
//
// This module owns none of the page's state: it is handed a rack and a way
// to look up a device's physical size, and it hands back a built scene (or
// null) for the page to hold onto, rebuild and dispose.

import {el} from './dom.js';
import {cableFacts, UNCHECKED} from './cable-plugs.js';
import {mergeSeats, cablePlan3d, endKey} from './cable-rules.js';
import {drawCables3d} from './cables.js';

const NO_WEBGL = "3D isn't available in this browser, so the rack is shown in 2D only.";

// THE RACK'S CABLES AS TUBES (Phase 2b ruling 5), drawn once the devices are
// built. An end is found on the mount of its own item (rack3d.js findMounted
// by id: two items can share a ref) and on the device's own panel:
//   - an end the page calls loose (cable-plugs.js: an empty cage, a removed
//     device) does not land, so 2D and 3D agree on which cables hang free;
//   - an end with a plug or a DAC end seated lands on its cable points;
//   - any other end lands on the center of its port, as it does in 2D.
// Returns drawCables3d's {tubes, anchors, boxes, group} plus `checked`, or
// {failed: true} when the cables could not be drawn: the rack still stands,
// and an export of it says so.
async function hangCables(scene, rack, facts) {
  const loose = new Set([...facts.ends].filter(([, v]) => v.reason != null).map(([k]) => k));
  try {
    const drawn = await drawCables3d(scene, cablePlan3d(rack), {anchor: async (item, path, view) => {
      if (loose.has(endKey({item, path, view}))) return [];
      const got = await scene.cableAnchor({id: item}, path, {view});
      if (got.length) return got;
      const port = await scene.portAnchor({id: item}, path, {view});
      return port ? [{position: port.position, normal: port.normal, view, path}] : [];
    }});
    return {...drawn, checked: !facts.unchecked};
  } catch (err) {
    console.warn('[portrayal] the cables could not be drawn in 3D', err);
    return {failed: true};
  }
}

// `camera`, when given, is `{position, target}` from a previous build - saved
// by the page just before it disposes the old scene, so a rebuild (a commit,
// or a frame change) restores the orbit instead of snapping back to the
// opening view.
export async function mountRack3d(container, {rack, chassisOf, camera = null}) {
  const frame = rack.frame;
  // PLUGS ARE DERIVED, NEVER STORED: as in 2D, a cabled end is built with the
  // plug its port takes, laid over the item's own swaps for this scene only.
  // If the cables' faces cannot be read the rack is built without plugs, and
  // every end is tried as it is.
  const cabled = (rack.cables || []).length > 0;
  const facts = !cabled ? UNCHECKED : await cableFacts(rack).catch(err => {
    console.warn("[portrayal] 3D: could not read the cables' faces", err);
    return UNCHECKED;
  });
  // The stack rack3d.js reads, mapped from this document's own items.
  // `chassis` is filled from the SAME lookup the 2D elevation and the fit
  // rules use (chassisOf), not fetched again from the compiled index -
  // rack3d.js prefers a caller's own chassis over one it would otherwise
  // fetch, and reading the two views' sizes from one place is the whole
  // argument this rack makes for itself (see rack3d.js's own banner).
  //
  // Optic fields (item.fields) are NOT carried over: createRackScene has no
  // fields input yet, so a swap into a bay shows in 3D but a field edit on an
  // optic does not, until that lands.
  const stack = rack.items.map(item => ({
    id: item.id,
    ref: item.ref, cfg: item.cfg, ru: item.ru, label: item.label,
    face: item.face, turned: item.turned, overrides: mergeSeats(item.swaps, facts.seats[item.id]),
    chassis: chassisOf?.(item.ref) || undefined,
    mount: chassisOf?.(item.ref)?.mount,
  }));

  // Imported here, not at module load: rack-page.js pulls this module in on
  // every visit, most of which never switch to 3D, and three.js (through
  // rack3d.js) is not a cost a 2D-only visit should pay - the showcase's own
  // mount3d (site/showcase/rack.js) makes the same choice for the same
  // reason.
  const {guard3d} = await import('../webgl.js');
  const scene = await guard3d(async () => {
    const {createRackScene} = await import('../rack3d.js');
    const built = createRackScene(container, {
      stack, heightRU: frame.heightRU,
      frame: frame.kind === 'four-post' ? {kind: 'four-post', railDepth: frame.railDepth} : null,
    });
    await built.build();
    // What the scene holds of the cables, for the page and the exports: null
    // for a rack with none (nothing is added to the scene at all).
    built.rackCables = cabled ? await hangCables(built, rack, facts) : null;
    if (camera) {
      built.three.camera.position.copy(camera.position);
      built.three.controls.target.copy(camera.target);
      built.three.controls.update();
    }
    return built;
  }, () => {
    // A fixed, page-level sentence rather than guard3d's own (more technical,
    // chrome://gpu-pointing) message: the Rack Builder always has a working
    // 2D view right behind this one, which the showcase's 3D stages do not,
    // so what a reader needs to know here is simply that 2D is still there.
    container.replaceChildren(el('p', {class: 'rk-notice', role: 'status', text: NO_WEBGL}));
  });
  return scene;
}
```

- [ ] **Step 8: Run everything this touches and see it pass**

Run: `node --test tests/rack/*.test.mjs`
Expected: `# pass 141`, `# fail 0`.

Run: `python3 check-contract.py`
Expected: `contract: 292 checks passed` (no color literal went into `rack3d.js`'s cable code or the showcase).

Run: `python3 check-browser.py --only check_rack_cables_3d_scene,check_takeaway_cables_3d,check_cables_moved,check_rack_3d,check_rack_cables_3d,check_rack_export_3d`
Expected: six `ok` lines. `check_takeaway_cables_3d` proves the showcase's tubes are still `cable-0` to `cable-13`.

Then look: open a cabled rack, switch to 3D. Each cable is a tube in its 2D color; a front-to-rear cable goes round the rack's right side; a loose end hangs free.

- [ ] **Step 9: Commit**

```bash
git add site/rack3d.js site/rack/cables.js site/rack/cable-rules.js site/rack/scene3d.js tests/rack/cables.test.mjs check-browser.py
git commit -m "rack: 3D seats the derived plugs and hangs the cables

The 3D scene is built with each cabled end's plug laid over the item's own
swaps, and each cable hangs as a tube in its 2D color, named cable-<id>. An
end is found on its own item (rack3d.js findMounted takes an id) and its own
panel; an end the page calls loose does not land, and an end with no
connector to seat lands on its port, as in 2D. drawCables3d's new anchor
option defaults to what the showcase has always done.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Which commits rebuild the 3D scene, and the sentence in 3D

Ruling 6. Now that the scene draws cables, a commit that adds or removes a cable, or changes a cable's ends or media, is scene-relevant: it goes the normal debounced rebuild. A commit that changes only a cable's label, purpose or length is not: it keeps today's skip (the scene is kept, and re-pointed at the new rack only if it was current). Phase 1b's export guard must keep holding: an export never saves a model made from a scene that an edit overtook.

Ruling 7. Cable mode stays 2D-only. In 3D the Cable button stays disabled, and its sentence changes, because cables are now shown in 3D: "Cables are added in 2D. Switch to 2D to add one."

The showcase's `copper` media is colored by its purpose, so for that one media the purpose counts as scene-relevant too. None of the Rack Builder's eight media is.

**Files:**
- Modify: `site/rack/cable-rules.js`, `tests/rack/cables.test.mjs`, `site/rack-page.js`, `check-browser.py`

**Interfaces:**
- Consumes: `endKey(end)` (in `cable-rules.js`); `scene.rackCables` and `CABLES_3D_JS` (Task 8).
- Produces:
  - `sameCables3d(a, b)` exported from `site/rack/cable-rules.js` → `true` when racks `a` and `b` have the same cables, in the same order, with the same ends and media.
  - In `site/rack-page.js`: `sameScene(a, b)` (module-private), used by `commit()` and `rebuild3d()`; `CABLES_3D` replaces `CABLES_2D`.
  - In `check-browser.py`: `CABLES_3D` replaces `CABLES_2D`.

- [ ] **Step 1: Write the failing node test**

Append to `tests/rack/cables.test.mjs`:

```js
test('sameCables3d: the scene reads which cables there are, their ends and their media, and nothing else', () => {
  let r = rack();
  r = C.withCable(r, {a: end('i2', 'port-1'), b: end('i1', 'slot-2/module/p0'), media: 'os2', purpose: 'uplink'}).rack;
  r = C.withCable(r, {a: end('i2', 'mgmt-eth'), b: end('i3', 'port-2-1'), media: 'cat6a'}).rack;
  const same = next => C.sameCables3d(r, next);
  assert.equal(same(r), true);
  assert.equal(same({...r, name: 'other'}), true);
  // What the scene does not draw: a label, a purpose, a length, a route.
  assert.equal(same(C.updateCable(r, 'c1', {label: 'A1'})), true);
  assert.equal(same(C.updateCable(r, 'c1', {purpose: 'core'})), true);
  assert.equal(same(C.updateCable(r, 'c1', {length: {value: 2, unit: 'm', source: 'entered'}})), true);
  assert.equal(same(C.updateCable(r, 'c1', {route: [{item: 'i4'}]})), true);
  // What it does: the media (the color), an end (the tube and its plugs), a cable more or fewer, their order.
  assert.equal(same(C.updateCable(r, 'c1', {media: 'om4'})), false);
  assert.equal(same(C.updateCable(r, 'c1', {a: end('i2', 'port-3')})), false);
  assert.equal(same(C.updateCable(r, 'c2', {b: end('i4', 'port-2-1')})), false);
  assert.equal(same(C.updateCable(r, 'c2', {b: end('i3', 'port-2-1', 'rear')})), false);
  assert.equal(same(C.withoutCable(r, 'c2')), false);
  assert.equal(same(C.withCable(r, {a: end('i4', 'port-2-1'), b: end('i2', 'port-4')}).rack), false);
  assert.equal(same({...r, cables: [r.cables[1], r.cables[0]]}), false);
  assert.equal(same({...r, cables: [{...r.cables[0], id: 'c9'}, r.cables[1]]}), false);
  // The showcase's 'copper' is colored by its purpose.
  const cu = C.updateCable(r, 'c2', {media: 'copper', purpose: 'server'});
  assert.equal(C.sameCables3d(cu, C.updateCable(cu, 'c2', {purpose: 'management'})), false);
  assert.equal(C.sameCables3d({items: []}, {items: [], cables: []}), true);
});
```

- [ ] **Step 2: Rewrite the browser check**

In `check-browser.py`, replace everything from the line `CABLES_2D = "Cables are drawn in 2D for now. Switch to 2D to see them or to add one."` down to the last `return bad` of `check_rack_cables_3d` (the line before the two blank lines above `def cable_fixture(doc_id, name, edit):`) with:

```python
CABLES_3D = "Cables are added in 2D. Switch to 2D to add one."


@extra("rack.html: in 3D the cables are drawn and Cable mode is off with a sentence saying where cables are added; the list still selects, edits and deletes; an edit to a cable's ends or media rebuilds the scene, an edit to its label does not")
def check_rack_cables_3d(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    try:
        open_cabled(page, base)
    except RuntimeError as e:
        return bad + [f"cables 3D: {e}"]
    cables = lambda: page.evaluate("() => window.__rack.doc().racks[0].cables")

    # The sheet carries the cables now (check_rack_export_sheet_cables): what
    # stays out of it is the screen's - a picked end's outline - and the old note.
    sheet = pathlib.Path(export_file(page, "sheet-svg").path()).read_text(encoding="utf-8")
    for bit in ("rk-end-pick", "not in this export yet"):
        if bit in sheet:
            bad.append(f"cables 3D: the sheet carries {bit!r}")
    # The BOM carries the cables now (check_rack_export_bom_cables), so it does not say they are left out.
    bom = pathlib.Path(export_file(page, "bom").path()).read_text(encoding="utf-8")
    if "not in this export yet" in bom:
        bad.append("cables 3D: the BOM still says cables are not in it")

    no_webgl = webgl_trouble(page)
    page.click("#cableBtn")
    wait_fn(page, "cables 3D: Cable mode on in 2D",
            "() => document.getElementById('cableBtn').getAttribute('aria-pressed') === 'true'")
    page.click('#rkMode [data-mode="3d"]')
    btn = page.eval_on_selector("#cableBtn", "b => ({disabled: b.disabled, pressed: b.getAttribute('aria-pressed'), title: b.title})")
    if btn != {"disabled": True, "pressed": "false", "title": CABLES_3D}:
        bad.append(f"cables 3D: in 3D the Cable button is {btn}")
    try:
        wait_sel(page, "cables 3D: the sentence", "#cable3dNote")
    except RuntimeError as e:
        return bad + [str(e)]
    if (page.text_content("#cable3dNote") or "") != CABLES_3D:
        bad.append(f"cables 3D: the note reads {page.text_content('#cable3dNote')!r}")

    # The list still works: select, edit, delete.
    pressed = lambda cid: (f"""() => document.querySelector('#cableList [data-cable-row="{cid}"]')"""
                           f"""?.getAttribute('aria-pressed') === 'true'""")
    groups = lambda: page.evaluate(
        "() => (window.__rack.scene().three.scene.getObjectByName('patch-cables')?.children || []).map(g => g.name)")

    def rebuilt(label, old):
        # A new scene object, built: the old one was disposed by the rebuild.
        try:
            page.wait_for_function("s => { const n = window.__rack.scene(); return !!n && n !== s; }",
                                   arg=old, timeout=READY_3D_MS)
        except Exception as e:
            raise RuntimeError(f"{label}: {str(e).splitlines()[0]}") from e
        old.dispose()
        return page.evaluate_handle("() => window.__rack.scene()")

    scene = None
    if not no_webgl:
        wait_fn(page, "cables 3D: the scene", "() => !!window.__rack.scene()", timeout=READY_3D_MS)
        scene = page.evaluate_handle("() => window.__rack.scene()")
        if groups() != ["cable-c1", "cable-c2", "cable-c3"]:
            bad.append(f"cables 3D: the scene's cables are {groups()}")
    page.click('#cableList [data-cable-row="c1"]')
    wait_fn(page, "cables 3D: a row selects", pressed("c1"))
    page.click("#cableEdit")
    wait_sel(page, "cables 3D: the edit form", "#cableForm")
    page.fill("#cLabel", "B9")
    page.click("#cSave")
    wait_fn(page, "cables 3D: the edit saved", "() => window.__rack.doc().racks[0].cables[0].label === 'B9'")
    try:
        if scene:
            # A label is nothing the scene draws: the scene is kept, and is still good for an export.
            page.wait_for_timeout(800)          # past the 300 ms a rebuild would wait
            if not page.evaluate("s => window.__rack.scene() === s", scene):
                bad.append("cables 3D: editing a cable's label rebuilt the 3D scene")
            glb = export_file(page, "glb", timeout=READY_3D_MS)
            if not export_status(page).startswith("Downloaded") or pathlib.Path(glb.path()).stat().st_size < 100:
                bad.append("cables 3D: no GLB after a label edit")
            if not page.evaluate("s => window.__rack.scene() === s", scene):
                bad.append("cables 3D: exporting after a label edit rebuilt the 3D scene")

            # A cable's media is its color: the scene is rebuilt.
            colors = page.evaluate("async () => (await import('/site/rack/cables.js')).COLORS")
            page.click('#cableList [data-cable-row="c2"]')
            wait_fn(page, "cables 3D: row c2 selects", pressed("c2"))
            page.click("#cableEdit")
            wait_sel(page, "cables 3D: c2's edit form", "#cableForm")
            page.select_option("#cMedia", "dac")
            page.click("#cSave")
            scene = rebuilt("cables 3D: the rebuild after a media change", scene)
            got = {t["id"]: t["color"] for t in page.evaluate(CABLES_3D_JS)["tubes"]}
            if got.get("c2") != colors["dac"]:
                bad.append(f"cables 3D: after its media changed to DAC, c2 is {got.get('c2')}, expected {colors['dac']}")

        page.click('#cableList [data-cable-row="c3"]')
        wait_fn(page, "cables 3D: row c3 selects", pressed("c3"))
        page.click("#cableDelete")
        wait_fn(page, "cables 3D: the delete", "() => window.__rack.doc().racks[0].cables.length === 2")
        if scene:
            # A cable fewer is a tube fewer: the scene is rebuilt, and the GLB follows it.
            scene = rebuilt("cables 3D: the rebuild after a delete", scene)
            if groups() != ["cable-c1", "cable-c2"]:
                bad.append(f"cables 3D: after deleting c3 the scene's cables are {groups()}")
            glb = pathlib.Path(export_file(page, "glb", timeout=READY_3D_MS).path()).read_bytes()
            if b'"cable-c1"' not in glb or b'"cable-c3"' in glb:
                bad.append("cables 3D: the GLB exported after a cable delete does not match the rack")
            scene.dispose()
        else:
            print("[check_rack_cables_3d] WebGL unavailable - the rebuild steps were not exercised")
    except RuntimeError as e:
        return bad + [str(e)]

    # Back in 2D: the button works again and what is left is drawn.
    page.click('#rkMode [data-mode="2d"]')
    wait_sel(page, "cables 3D: cables back in 2D", 'svg[data-pane="front"] [data-cables] [data-cable-id="c1"]')
    if page.query_selector("#cable3dNote") or page.eval_on_selector("#cableBtn", "b => b.disabled || !!b.title"):
        bad.append("cables 3D: back in 2D the note is still shown or the button is still off")
    if page.query_selector('svg[data-pane="rear"] [data-cable-id="c3"]') or len(cables()) != 2:
        bad.append("cables 3D: the cable deleted in 3D is still drawn in 2D")

    # With no cable left, the empty state tells the truth of the mode it is in:
    # in 3D there is no Cable mode to use, so it says only that there are none.
    page.click('#rkMode [data-mode="3d"]')
    for cid in [c["id"] for c in cables()]:
        wait_sel(page, f"cables 3D: row {cid}", f'#cableList [data-cable-row="{cid}"]')
        page.click(f'#cableList [data-cable-row="{cid}"]')
        wait_fn(page, f"cables 3D: row {cid} selects", pressed(cid))
        page.click("#cableDelete")
        wait_fn(page, f"cables 3D: {cid} deleted",
                f"() => !window.__rack.doc().racks[0].cables.some(c => c.id === '{cid}')")
    wait_sel(page, "cables 3D: the empty state", "#cableEmpty")
    if (page.text_content("#cableEmpty") or "") != "No cables yet.":
        bad.append(f"cables 3D: in 3D the empty state reads {page.text_content('#cableEmpty')!r}")
    page.click('#rkMode [data-mode="2d"]')
    wait_fn(page, "cables 3D: the 2D empty state",
            "() => document.getElementById('cableEmpty')?.textContent.includes('Use Cable mode')")
    if (page.text_content("#cableEmpty") or "") != "No cables yet. Use Cable mode and click a port at each end.":
        bad.append(f"cables 3D: in 2D the empty state reads {page.text_content('#cableEmpty')!r}")
    return bad
```

`check_rack_export_after_cable_edit` proves that a commit which does not rebuild the scene leaves a stale scene stale. A cable delete now rebuilds, so the check makes its point with a label edit. In it:

Replace

```python
@extra("rack.html: in 3D, a device edit then a cable edit inside the rebuild's wait - the GLB exported next carries the new device")
```

with

```python
@extra("rack.html: in 3D, a device edit then a cable's label edit inside the rebuild's wait - the GLB exported next carries the new device")
```

Replace

```python
    # One page task: a device is added (its rebuild waits 300 ms), a cable is
    # deleted (a cables-only commit, which re-points a CURRENT scene and must
    # leave this stale one stale), and the export is asked for.
```

with

```python
    # One page task: a device is added (its rebuild waits 300 ms), a cable's
    # label is changed (a commit the scene reads nothing of, which re-points a
    # CURRENT scene and must leave this stale one stale), and the export is
    # asked for.
```

Replace

```python
      window.__rack.replaceRack({...r2, cables: r2.cables.slice(1)});
```

with

```python
      window.__rack.replaceRack({...r2, cables: r2.cables.map((c, k) => (k ? c : {...c, label: 'renamed'}))});
```

- [ ] **Step 3: Run both and see them fail**

Run: `node --test tests/rack/cables.test.mjs`
Expected: 1 failure, `TypeError: C.sameCables3d is not a function`.

Run: `python3 check-browser.py --only check_rack_cables_3d`
Expected: `FAIL`: the Cable button's title and the note still read "Cables are drawn in 2D for now…", and then "the rebuild after a media change: Page.wait_for_function: Timeout 240000ms exceeded." This red run waits out that four-minute timeout once.

- [ ] **Step 4: The rule**

In `site/rack/cable-rules.js`, insert immediately before the line `// ── media ───────────────────────────────────────────────────────────────` (after Task 8's `cablePlan3d`):

```js
// WHAT THE 3D SCENE READS OF THE CABLES: which cables there are, in order,
// where each one's two ends are, and its media (its color; the showcase's
// 'copper' is colored by purpose, so there the purpose counts too). Two racks
// that agree on those draw the same tubes and seat the same plugs. A label, a
// length, a route, or the purpose of any other media changes nothing in the
// scene, so an edit to one of those need not rebuild it.
export function sameCables3d(a, b) {
  const ca = a.cables || [], cb = b.cables || [];
  if (ca === cb) return true;
  const key = c => JSON.stringify([c.id, endKey(c.a), endKey(c.b), c.media || '', c.media === 'copper' ? c.purpose || '' : '']);
  return ca.length === cb.length && ca.every((c, i) => key(c) === key(cb[i]));
}
```

- [ ] **Step 5: The page**

In `site/rack-page.js`, eight replacements.

Replace

```js
        cablesOf, withoutCablesOf, cableName, endName, proposeMedia, countsBy} from './rack/cable-rules.js';
```

with

```js
        cablesOf, withoutCablesOf, cableName, endName, proposeMedia, countsBy, sameCables3d} from './rack/cable-rules.js';
```

Replace

```js
const CABLES_2D = 'Cables are drawn in 2D for now. Switch to 2D to see them or to add one.';
```

with

```js
const CABLES_3D = 'Cables are added in 2D. Switch to 2D to add one.';
```

Replace

```js
  // Cables edited while this was building left the items and the frame as
  // they were (commit() could not re-point a scene that did not exist yet):
  // the scene is current for the rack as it is now.
  const now = rack();
  S.scene3d = built;
  S.scene3dRack = now.items === forRack.items && now.frame === forRack.frame ? now : forRack;
}
```

with

```js
  // An edit made while this was building that the scene does not read (a
  // cable's label, the rack's name) could not re-point a scene that did not
  // exist yet: the scene is current for the rack as it is now.
  const now = rack();
  S.scene3d = built;
  S.scene3dRack = sameScene(now, forRack) ? now : forRack;
}
```

Replace

```js
let rebuild3dTimer = null;
```

with

```js
// WHAT THE 3D SCENE READS OF A RACK: its items, its frame, and of its cables
// their ends and media (cable-rules.js sameCables3d). Two racks that agree on
// those build the same scene. A rack-level field the scene comes to read later
// (zeroU) must be added here, or an edit to it will leave the scene, and a GLB
// exported from it, showing the rack as it was.
const sameScene = (a, b) => a.items === b.items && a.frame === b.frame && sameCables3d(a, b);
let rebuild3dTimer = null;
```

Replace

```js
  $('cableBtn').title = is3d ? CABLES_2D : '';
```

with

```js
  $('cableBtn').title = is3d ? CABLES_3D : '';
```

Replace

```js
  // A cable edit (cable-rules.js returns {...rack, cables}) leaves the items
  // array and the frame the very same objects, as a rename does. The 3D view
  // draws neither cables nor the name, so such a commit has nothing to
  // rebuild there. The scene is kept and re-pointed at the new rack, but only
  // if it was current: one that a device edit already made stale (its rebuild
  // still pending) stays stale, so an export still rebuilds it first. An
  // export already running holds the old rack and is discarded by
  // modelExport's guard, as for any commit.
  //
  // THIS TEST KNOWS WHAT THE 3D SCENE READS: `items` and `frame`, nothing
  // else. A rack-level field the scene comes to read later (cables in 2b,
  // zeroU) must be added to it, or an edit to that field will leave the scene,
  // and a GLB exported from it, showing the rack as it was.
  const prev = rack();
  const sameScene = nextRack.items === prev.items && nextRack.frame === prev.frame;
```

with

```js
  // The 3D view draws the cables: a commit that adds or removes one, or
  // changes a cable's ends or media, changes the tubes and the plugs seated
  // for them, and goes the same debounced rebuild a device edit does. A commit
  // the scene reads nothing of (a cable's label, purpose or length, the rack's
  // name) has nothing to rebuild there: the scene is kept and re-pointed at
  // the new rack, but only if it was current. One that an earlier edit already
  // made stale (its rebuild still pending) stays stale, so an export still
  // rebuilds it first. An export already running holds the old rack and is
  // discarded by modelExport's guard, as for any commit.
  const prev = rack();
  const kept = sameScene(prev, nextRack);
```

Replace

```js
  if (!sameScene) scheduleRebuild3d();
  else if (S.scene3d && S.scene3dRack === prev) S.scene3dRack = nextRack;
```

with

```js
  if (!kept) scheduleRebuild3d();
  else if (S.scene3d && S.scene3dRack === prev) S.scene3dRack = nextRack;
```

Replace

```js
  // In 3D the list still selects, edits and deletes; nothing is drawn or lit.
  S.mode === '3d' ? el('p', {id: 'cable3dNote', class: 'rk-muted', role: 'status', text: CABLES_2D}) : null,
```

with

```js
  // In 3D the cables are drawn and the list still selects, edits and deletes;
  // a selected cable is not lit in the scene, and a cable is added in 2D.
  S.mode === '3d' ? el('p', {id: 'cable3dNote', class: 'rk-muted', role: 'status', text: CABLES_3D}) : null,
```

`sameScene` is declared after `rebuild3d` in the file and is only called when a rebuild finishes, long after the module has loaded. `commitFrame` and `undoShrink` already call `scheduleRebuild3d()` themselves, so Undo of a cable delete rebuilds too.

- [ ] **Step 6: Run everything this touches and see it pass**

Run: `node --test tests/rack/*.test.mjs`
Expected: `# pass 142`, `# fail 0`.

Run: `python3 check-browser.py --only check_rack_cables_3d,check_rack_export_after_cable_edit,check_rack_export_overtaken,check_rack_cables_3d_scene,check_rack_3d`
Expected: five `ok` lines. `check_rack_export_overtaken` and `check_rack_export_after_cable_edit` prove Phase 1b's export guard still holds.

- [ ] **Step 7: Commit**

```bash
git add site/rack/cable-rules.js site/rack-page.js tests/rack/cables.test.mjs check-browser.py
git commit -m "rack: a cable's ends or media rebuild the 3D scene, its label does not; in 3D the page says cables are added in 2D

The 3D scene draws the cables, so a commit that adds or removes a cable, or
changes its ends or media, takes the same debounced rebuild a device edit
does. A label, purpose or length edit keeps the scene and re-points it only
if it was current, so an export still rebuilds a stale one first. In 3D the
Cable button stays off, and its sentence now says where cables are added.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: The GLB and USDZ carry the cables; the GLB's notes say what the model could not

Ruling 8. The scene holds the cables (Task 8), so both files carry them with no change to the exporters: in the GLB, a node `patch-cables` with a child `cable-<id>` per cable. What changes is the notes. The model stops saying cables are left out of it, and says instead what the sheet says (loose ends with reasons, media mismatches), plus what is particular to 3D: an end the page calls connected that the scene could not place, and a scene whose cables could not be drawn at all. A USDZ still has no place for notes, so its status line stays "USDZ carries no notes; the GLB does."

**Files:**
- Modify: `site/rack/exports.js`, `check-browser.py`

**Interfaces:**
- Consumes: `scene.rackCables` (Task 8): `null`, `{failed: true}`, or `{tubes: [{link: {id}, loose: ('from' | 'to')[], mesh}], …}`; `cableEnds(rack)` (Task 2); `cableNotes(rack, ends)`, `UNCHECKED_NOTE`, `rackNotes(rack, {cables: false})` (Task 1); `endKey`, `endName`, `cableName` from `site/rack/cable-rules.js`.
- Produces: `modelFile(scene, rack, kind, chassisOf)` keeps its signature and result shape; its `notes` (GLB) or `left` (USDZ) now carry the cable notes.

- [ ] **Step 1: Write the failing check**

In `check-browser.py`, add before `def main():`

```python
@extra("rack.html: Export - the GLB and USDZ carry the cables the scene holds, each named for its cable; the GLB's notes list loose ends and mismatches")
def check_rack_export_3d_cables(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    try:
        open_cabled(page, base)
    except RuntimeError as e:
        return bad + [f"3D export cables: {e}"]

    # The notes, with scenes that export nothing: only what modelFile says is under test.
    got = page.evaluate("""async () => {
      const X = await import('/site/rack/exports.js'), E = await import('/site/rack/export-data.js');
      const r = window.__rack.doc().racks[0];
      const scene = hung => ({running: () => false, complete: async () => {}, three: {scene: {userData: {}}},
                              toGLB: async () => new Uint8Array(4), toUSDZ: async () => new Uint8Array(4), rackCables: hung});
      const link = id => ({id});
      // As the scene hangs this rack: c1 and c2 land, c3 dangles from its B end.
      const hung = {tubes: [{link: link('c1'), loose: [], mesh: {}}, {link: link('c2'), loose: [], mesh: {}},
                            {link: link('c3'), loose: ['from'], mesh: {}}]};
      // The scene could not place c1's B end, and neither end of c2.
      const lost = {tubes: [{link: link('c1'), loose: ['to'], mesh: {}}, {link: link('c2'), loose: ['from', 'to'], mesh: null},
                            {link: link('c3'), loose: ['from'], mesh: {}}]};
      const out = {};
      for (const [k, s] of [['hung', scene(hung)], ['lost', scene(lost)], ['none', scene(null)], ['failed', scene({failed: true})]])
        out[k] = (await X.modelFile(s, r, 'glb')).notes;
      const usdz = await X.modelFile(scene(hung), r, 'usdz');
      out.usdz = {notes: usdz.notes, left: usdz.left, status: E.exportStatus(usdz)};
      out.plain = (await X.modelFile(scene(null), {...r, cables: []}, 'glb')).notes;
      return out;
    }""")
    loose = "Cable c3: end A, leaf-1 (U14) port-2, is not connected (port-2 holds no optic)."
    mism = "Cable c3: OS2 single-mode fiber does not suit end B, which is copper."
    if got["hung"] != [loose, mism]:
        bad.append(f"3D export cables: the notes are {got['hung']}")
    for want in ("Cable A1: end B, core-1 (U2) slot-2/module/p0, could not be placed in the 3D model, so the cable hangs loose there.",
                 "Cable c2: end A, leaf-1 (U14) mgmt-eth, and end B, demarc (U14) port-2-1, could not be placed in the 3D model, "
                 "so the cable is not drawn there."):
        if want not in got["lost"]:
            bad.append(f"3D export cables: an end the scene could not place is not noted ({want!r}): {got['lost']}")
    if len(got["lost"]) != 4:
        bad.append(f"3D export cables: a loose end the page already explains is noted twice: {got['lost']}")
    for k in ("none", "failed"):
        if got[k] != ["The cables could not be drawn in the 3D model."]:
            bad.append(f"3D export cables: a scene with no cables hung ({k}) says {got[k]}")
    if got["plain"]:
        bad.append(f"3D export cables: a rack with no cables has notes {got['plain']}")
    if got["usdz"]["notes"] or got["usdz"]["left"] != [loose, mism] or \
            got["usdz"]["status"] != "Downloaded. USDZ carries no notes; the GLB does.":
        bad.append(f"3D export cables: the USDZ's notes are {got['usdz']}")
    if any("not in this export yet" in n for k in ("hung", "lost", "none", "failed") for n in got[k]):
        bad.append("3D export cables: the model still says cables are not in it")

    if webgl_trouble(page):
        print("[check_rack_export_3d_cables] WebGL unavailable - the files were not exercised")
        return bad
    page.click('#rkMode [data-mode="3d"]')
    wait_fn(page, "3D export cables: the scene", "() => window.__rack.scene() != null", timeout=READY_3D_MS)
    dl = export_file(page, "glb", timeout=READY_3D_MS)
    status = export_status(page)
    glb = pathlib.Path(dl.path()).read_bytes()
    if dl.suggested_filename != "Cable-test.glb" or glb[:4] != b"glTF":
        return bad + [f"3D export cables: {dl.suggested_filename!r} is not a GLB"]
    # A GLB is a JSON chunk, then a binary one: the node names and the scene's extras are in the JSON.
    doc = json.loads(glb[20:20 + int.from_bytes(glb[12:16], "little")].decode("utf-8"))
    names = [n.get("name") for n in doc["nodes"]]
    for want in ("patch-cables", "cable-c1", "cable-c2", "cable-c3", "device-i1", "device-i4"):
        if names.count(want) != 1:
            bad.append(f"3D export cables: the GLB has {names.count(want)} nodes named {want!r}")
    notes = doc["scenes"][0].get("extras", {}).get("portrayal", {}).get("notes", [])
    if notes != [loose, mism]:
        bad.append(f"3D export cables: the GLB's notes are {notes}")
    if status != notes_status(2):
        bad.append(f"3D export cables: the GLB's status reads {status!r}")
    # The cables are geometry in the GLB: each cable group has mesh children.
    by_name = {n.get("name"): n for n in doc["nodes"]}
    for cid in ("c1", "c2", "c3"):
        kids = by_name.get(f"cable-{cid}", {}).get("children", [])
        if not kids or any("mesh" not in doc["nodes"][k] for k in kids):
            bad.append(f"3D export cables: cable-{cid} has no tube in the GLB")

    dl = export_file(page, "usdz", timeout=READY_3D_MS)
    status = export_status(page)
    usdz = pathlib.Path(dl.path()).read_bytes()
    if dl.suggested_filename != "Cable-test.usdz" or usdz[:2] != b"PK":
        bad.append(f"3D export cables: {dl.suggested_filename!r} is not a USDZ")
    if status != "Downloaded. USDZ carries no notes; the GLB does.":
        bad.append(f"3D export cables: the USDZ's status reads {status!r}")
    page.click('#rkMode [data-mode="2d"]')
    return bad
```

- [ ] **Step 2: Run it and see it fail**

Run: `python3 check-browser.py --only check_rack_export_3d_cables`
Expected: `FAIL`, starting with "the notes are ['3 cables are not in this export yet.']".

- [ ] **Step 3: The model's cable notes**

In `site/rack/exports.js`, replace

```js
import {mergeSeats} from './cable-rules.js';
```

with

```js
import {mergeSeats, endKey, endName, cableName} from './cable-rules.js';
```

Replace the comment above `modelFile`:

```js
// GLB / USDZ (spec §8), from the scene the page built - after complete(), so
// the deferred relief pass (optics, plugs) has landed. The notes ride in the
// scene's userData, which GLTFExporter writes as the scene's `extras`. A USDZ
// has no such place, so its notes come back as `left`, not `notes`.
```

with

```js
// What the 3D model carries of the cables, as notes. `hung` is what the scene
// holds (scene3d.js: built.rackCables): drawCables3d's tubes, or {failed}.
//   - nothing hung at all: the model has no cables, and says so;
//   - a loose end, a mismatch: as the sheet says them (cableNotes);
//   - an end the page calls connected that the scene could not place (no
//     drawing of that panel in 3D): the cable hangs loose there, and the
//     model says which end.
function modelCableNotes(rack, hung, facts) {
  if (!(rack.cables || []).length) return [];
  if (!hung || hung.failed) return ['The cables could not be drawn in the 3D model.'];
  const out = [...(facts.unchecked ? [UNCHECKED_NOTE] : []), ...cableNotes(rack, facts.ends)];
  for (const t of hung.tubes) {
    const c = rack.cables.find(x => x.id === t.link.id);
    if (!c) continue;
    const lost = t.loose.map(k => (k === 'from' ? ['A', c.a] : ['B', c.b]))
      .filter(([, e]) => facts.ends.get(endKey(e))?.reason == null);
    if (lost.length)
      out.push(`Cable ${cableName(c)}: ${lost.map(([s, e]) => `end ${s}, ${endName(rack, e)},`).join(' and ')} `
        + `could not be placed in the 3D model, so the cable ${t.mesh ? 'hangs loose' : 'is not drawn'} there.`);
  }
  return out;
}

// GLB / USDZ (spec §8), from the scene the page built - after complete(), so
// the deferred relief pass (optics, plugs) has landed. The scene holds the
// rack's cables as tubes (group `patch-cables`, each `cable-<id>`), so both
// files carry them. The notes ride in the scene's userData, which
// GLTFExporter writes as the scene's `extras`. A USDZ has no such place, so
// its notes come back as `left`, not `notes`.
```

and, in `modelFile`, replace

```js
    const notes = uniq([...rackNotes(rack), ...mountNotes(rack.items, chassisOf, rack.frame), ...threeDNotes(rack), ...missing]);
```

with

```js
    const facts = (rack.cables || []).length ? await cableEnds(rack) : UNCHECKED;
    const notes = uniq([...rackNotes(rack, {cables: false}), ...mountNotes(rack.items, chassisOf, rack.frame),
                        ...threeDNotes(rack), ...missing, ...modelCableNotes(rack, scene.rackCables, facts)]);
```

- [ ] **Step 4: Run everything this touches and see it pass**

Run: `python3 check-browser.py --only check_rack_export_3d_cables,check_rack_export_3d,check_rack_export_notes_truthful,check_rack_mount_flag_3d_exports,check_rack_cables_3d`
Expected: five `ok` lines. `check_rack_export_notes_truthful` passes a scene with no `rackCables` and a rack with no cables: nothing is said about cables there.

- [ ] **Step 5: Commit**

```bash
git add site/rack/exports.js check-browser.py
git commit -m "rack: the GLB's notes list loose ends, mismatches and any end the 3D model could not place

The GLB and USDZ carry the cables the scene holds, each named cable-<id>
in the GLB. The model no longer says cables are left out of it: its notes
say what the sheet's do, which end the scene could not place, and when the
cables could not be drawn at all. A USDZ still carries no notes, and its
status line says so.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Wrap-up: the dev note, the spec, the whole suite

**Files:**
- Modify: `rack.html`, `check-browser.py`, `docs/superpowers/specs/2026-09-26-rack-builder-design.md`

**Interfaces:**
- Consumes: everything Tasks 1 to 10 produced. Produces no code interface.

- [ ] **Step 1: Write the failing check for the dev note**

In `check-browser.py`, in `check_rack_dev_note`, replace

```python
    for want in ("still being built", "You can cable ports in 2D", "Coming next: cables in the exports and in 3D."):
        if want not in body:
            bad.append(f"dev note: the note doesn't mention {want!r}")
    if "Coming next: cabling." in body:
        bad.append("dev note: it still lists cabling as coming, and it has shipped")
```

with

```python
    for want in ("still being built", "You can cable ports in 2D",
                 "Cables are in 3D and in the exports: the sheet, draw.io, the 3D model, the bill of materials and a cable schedule.",
                 "Coming next: cable import for NetBox and Nautobot."):
        if want not in body:
            bad.append(f"dev note: the note doesn't mention {want!r}")
    for gone in ("Coming next: cabling.", "Coming next: cables in the exports and in 3D."):
        if gone in body:
            bad.append(f"dev note: it still says {gone!r}, and that has shipped")
```

Run: `python3 check-browser.py --only check_rack_dev_note`
Expected: `FAIL`, "the note doesn't mention 'Cables are in 3D and in the exports…'" and "it still says 'Coming next: cables in the exports and in 3D.'".

- [ ] **Step 2: The dev note**

In `rack.html`, replace

```html
        <p>You can cable ports in 2D: press Cable, then click the port at each end.</p>
        <p>Coming next: cables in the exports and in 3D.</p>
```

with

```html
        <p>You can cable ports in 2D: press Cable, then click the port at each end.</p>
        <p>Cables are in 3D and in the exports: the sheet, draw.io, the 3D model, the bill of materials and a cable schedule.</p>
        <p>Coming next: cable import for NetBox and Nautobot.</p>
```

Run: `python3 check-browser.py --only check_rack_dev_note`
Expected: `ok`.

- [ ] **Step 3: The DCIM exports still say what they owe**

Nothing to change: confirm it. The device-type zips and the device-import CSVs carry no cables until Phase 2c, and must keep saying so.

Run: `python3 check-browser.py --only check_rack_export_notes_truthful,check_rack_export_dcim_types,check_rack_export_device_csv`
Expected: three `ok` lines. `check_rack_export_notes_truthful` still requires a device CSV's status line to end "1 cable is not in this export yet."

Run: `grep -n "rackNotes(rack)" site/rack/exports.js`
Expected: exactly two lines, in `dcimContext` and in `deviceImportCsv`. Every other caller passes `{cables: false}`.

- [ ] **Step 4: Run the whole suite from a clean start**

Run: `node --test tests/rack/*.test.mjs && ./chassis-index.py && git diff --exit-code site/rack/chassis.json && python3 check-contract.py && python3 check-browser.py`
Expected:
- 142 node tests pass, including the `export-cables` suite;
- `contract: 292 checks passed`;
- the browser suite lists every new `ok`: the cable schedule, the BOM's cables, the sheet pinned, the sheet's cables, draw.io on one page, draw.io's cables, stage 6's draw.io, the 3D scene's cables, cables in 3D, the GLB and USDZ, and the dev note; the showcase's stages and the hero are unchanged.

If a showcase 3D or page-load check times out, run `uptime`, then re-run that check on `main`. It is environmental only if it fails there too (issue #59).

- [ ] **Step 5: Check the whole flow by hand, as a user would, at `http://localhost:8932/rack.html`**

1. Build a small rack: a four-post frame, 24U; an AS7726 at U14 front with an optic in port 1; an ASR-9006 at U2 with a 16x100GE card in slot 2 and an optic in its first port; a TM-280 at U14 rear.
2. Cable the two optics (OS2, label "A1", 2 m), the AS7726's management jack to a copper port of the TM-280, and an empty cage to another copper port.
3. Export the sheet (SVG and PNG): the cables, the plugs, a pill at each cross-face tail, a dashed "not connected" pill, and the loose end in the notes.
4. Export the front only and the rear only: each carries its own cables and pills.
5. Export draw.io and open it in draw.io: one tab; two cabinets; the fiber as an edge inside the front cabinet; the copper as one edge from the front cabinet to the rear one; no edge to the empty cage, and a note for it (File, Properties does not show comments: open the file in a text editor).
6. Export the cable schedule and the BOM, and open both in a spreadsheet: three schedule rows, one of them "loose end"; a Cables section at the end of the BOM; no plug anywhere.
7. Switch to 3D: the Cable button is off and says cables are added in 2D; the cables hang as tubes. Edit a cable's label from the list: the view does not blink. Change its media: the view rebuilds, and the tube has the new color. Delete a cable: its tube goes.
8. Export the GLB and open it in a glTF viewer: nodes `cable-c1` and so on under `patch-cables`.
9. Export the NetBox device import: its status line still says the cables are not in it.
10. Open a rack with no cables and export the sheet and draw.io: no cable, no pill, no cable note.
11. Open the showcase (`index.html`), go to stage 6, export draw.io, and open it: 14 edges, the two server NIC cables running from the rear cabinet to the front one.

- [ ] **Step 6: Mark the phase in the spec and commit**

In `docs/superpowers/specs/2026-09-26-rack-builder-design.md`:
- change the end of the `**Status:**` line from `Phase 2b (cables in the exports and in 3D) next` to
  `Phase 2b (cables in the exports and in 3D) implemented (plan: docs/superpowers/plans/2026-10-03-rack-builder-phase2b-cable-exports.md); Phase 2c (NetBox and Nautobot cable import) next`
- in §8's table, replace the row

```markdown
| draw.io | One page per face. Port cells carry `portrayal-path`. (Phase 2) cables become edges. |
```

  with

```markdown
| draw.io | One page, with a front and a rear cabinet side by side. Port cells carry `portrayal-path`, and each cable that lands is an edge between two of them. |
```

```bash
git add rack.html check-browser.py docs/superpowers/specs/2026-09-26-rack-builder-design.md
git commit -m "rack: Phase 2b is implemented - cables in the exports and in 3D

The cable schedule, the BOM's Cables section, cables on the sheet and in
draw.io (one page, two cabinets), stage 6's draw.io edges, and cables with
their plugs in 3D and in the GLB and USDZ. The dev note says so, and that
cable import for NetBox and Nautobot is next.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Rulings the plan could not follow

None was impossible against the code. Four are followed with a refinement the code called for:

- **Ruling 5, "drawCables3d passes ids when the plan's ends carry them."** The plan's ends do carry item ids, and `findMounted` matches by id, as ruled. But the id reaches the scene through a new optional `anchor(dev, path, view)` argument to `drawCables3d` rather than through a test on the plan's shape. The Rack Builder needs more than the id at that point: an end the page calls loose must not land in 3D either, and an end whose port takes no plug lands on its port's center in 2D and would otherwise dangle in 3D. One caller-supplied function says all three; its default is today's code, so the showcase is untouched.
- **Ruling 9, "status ('connected' / 'loose end')."** A third value exists, `not checked`, for the case where reading the cables' faces failed altogether. Writing "connected" there would be a claim the export cannot support; the file also carries a note saying so.
- **Ruling 10, "one line per distinct (media, length+unit)."** The line's key also includes the connector text, so that spec §8's "grouped by media, connector and length" holds. Two cables of one media and length whose ends take different connectors are two lines, each with a true description, rather than one line whose description fits only one of them.
- **Ruling 6, "changes only a cable's label, purpose or length is not [scene-relevant]."** True for the Rack Builder's eight media, as ruled. For the showcase's `copper` media only (reachable in a hand-edited rack file), the purpose is the color, so there a purpose change rebuilds.

## Not in Phase 2b (so nobody adds it here)

- **Phase 2c: NetBox and Nautobot cable import.** Not started. The DCIM exports are untouched and keep saying "N cables are not in this export yet." What is established, for that plan to start from:
  - **The `{module}` token is in the vendored module types.** Spec §9.4 and §12 call NetBox cable import blocked on it; that is no longer so. 430 files under `assets/exports/netbox/module-types/` contain it, and the same number under `nautobot/`. Example: `module-types/Cisco/A9K-16X100GE-TR.yaml` lists `interfaces` named `'{module}/p0'` to `'{module}/p15'`.
  - **A fixed port's interface name is its drawing path**, by convention only (the repository has no mapping table). On the fixture's devices: `as7726-32x` lists `mgmt-eth` and `port-1` to `port-32` under `interfaces`; `tm-280` lists `port-1-1`, `port-2-1`, `port-3-1`, `copper-3-1`, `port-2-2`. A console port is under `console-ports`, not `interfaces` (`tm-280`'s drawing path `con` is the YAML's `Console`), so not every port path is an interface.
  - **A card port** `<bay>/module/<leaf>` would be `<bay position>/<leaf>` (`slot-2/module/p0` → `slot-2/p0`), **if** NetBox expands `{module}` to the module bay's position. The device types here give each bay the same `name` and `position` (`ASR-9006-AC-V2.yaml`: `ft-0`, `slot-0`, …). UNVERIFIED against a NetBox instance, and UNVERIFIED for nested modules.
  - **The module must be installed first.** A card port's interface exists in NetBox only once a module of that type is in the bay, so a cable import needs a module import file before it. Nothing here writes one.
  - **Cassette ports do not match by convention, and are not interfaces.** `FS.com/FHD-1MTP6LCDOS2A.yaml` has `front-ports` `'{module}/1'`… and `rear-ports` `'{module}/MTP-1'`, while the drawing paths are `bay-1/module/lc1`…. The end's type (`dcim.interface`, `dcim.frontport`, `dcim.rearport`) depends on the YAML section the name is in, so 2c should read each device and module type's own name lists and note every path it cannot match.
  - **Some bay names are not paths** (Casa Systems `C40G-CHASSIS-AC.yaml` has a bay named `Front 0`). How widespread: UNVERIFIED.
  - **Device names** must be `uniqueNames(items)`, as the device import and the cable schedule (Task 1) use.
  - **Both targets' import columns are UNVERIFIED.** From general knowledge only, NetBox's cable import has `side_a_device, side_a_type, side_a_name, side_b_device, side_b_type, side_b_name, type, status, label, color, length, length_unit`; nothing in the repository documents it. Nautobot's columns are unknown here (this repository's Nautobot device CSV uses the `status__name` style, which a cable CSV would probably follow). The media-to-cable-type slugs (`os2` → `smf-os2`, and so on) are guesses. Verify every column and slug against a real instance of each before writing a row.
  - A loose end, or an end on a removed device, cannot be a row: 2c writes a row only when both ends resolve, and notes the rest.
- **Picking ports in 3D.** Cable mode stays 2D-only; in 3D the Cable button is disabled.
- **Lighting a selected cable in 3D.** The list selects, edits and deletes in 3D; the scene does not highlight.
- **Live per-cable patching of the 3D scene.** A cable edit that the scene reads rebuilds the whole scene, debounced, as a device edit does. No tube is added, removed or recolored in place.
- **A curve across the sheet for a front-to-rear run.** It leaves each pane by a tag, as on the page.
- **Optic labels and colors in 3D.** Still noted by `threeDNotes`, as before.
- **Cable names in a USDZ.** three.js's USDZ exporter names every prim `Object_<n>`; the cables' geometry is in the file and their names are not. Notes are still not in a USDZ.
- **Reconciling a DAC's seated ends with its cable line in the BOM.** A DAC or AOC end seated in a cage is a part (it is in `item.swaps`), and the cable between two of them is a Cables line. The BOM lists both.
- **draw.io for a device hidden behind another.** A cable to a device that its cabinet does not draw (another device is mounted in front of it on that side) is a note, not an edge.
- **Breakouts, cable managers, bundling, lacing bars, cables between racks, routing and routed lengths** (spec §9.5, §9.6). `route` is still read by nothing.
- **Zero-U items as cable ends, and zero-U items in any export.** `rackNotes` keeps their line everywhere.
- **A version bump of the rack file.** Nothing here changes the document.
- **The showcase's page, its SVG, PNG, GLB and USDZ exports, and the hero.** Only stage 6's draw.io file changes.
