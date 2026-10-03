# Rack Builder Phase 2a: cabling on the page (implementation plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `rack.html` gets cabling. The user presses **Cable**, clicks a port at each end (on either face), fills in a short form, and the cable hangs on the drawing:
- a cable between two ports in one pane hangs between them;
- a front-to-rear run leaves by the rack edge, with a tag naming the far end;
- an end that cannot land (an empty cage, a card that no longer has the port, a removed device) hangs as an unplugged lead, with the reason;
- a cable list in the side panel filters by purpose and media, and a row or a tag selects a cable and lights it in both panes;
- cables survive a move, and are never silently deleted by a remove, a shrink or an Explorer change.

Cables in the exports and in 3D are **Phase 2b**, a separate plan.

**Architecture:**
- **`site/rack/cables.js`** is the showcase's cable geometry, moved (spec §10). `site/showcase/cables.js` stays as a one-line re-export, so the showcase and the hero are untouched.
- **`site/rack/cable-rules.js`** holds every cable rule as pure functions with no DOM: the end identity, which pane shows an end, one cable per port, the edits, the media vocabulary and its proposal, the mismatch warning, which plug a slot takes, why an end is loose, the list's filter. `node --test` covers it. The loader's cable validation is in `site/rack/model.js`.
- **`site/rack/cable-plugs.js`** reads each cabled end off its configured face and derives the plugs. Plugs are an overlay computed at draw time; nothing is written into `item.swaps`.
- **`site/rack/cable-view.js`** is the Rack Builder's adapter over `cables.js`: it finds an end by item id and panel, widens both panes when the rack has cables, draws, and lights.
- **`site/rack/cable-panel.js`** builds the side-panel forms: the cable form, the cable list, and the question asked when a cabled device is removed.
- **`site/rack-page.js`** only wires these together.

**Tech stack:**
- Vanilla ES modules with no bundler, served by `serve.py`.
- `node --test tests/rack/*.test.mjs` for the pure modules.
- Playwright checks in `check-browser.py`, registered with `@extra` and run with `python3 check-browser.py --only <function names, comma-separated>`.
- `python3 check-contract.py` for the text contracts.

**Spec:** `docs/superpowers/specs/2026-09-26-rack-builder-design.md`.
- This plan covers §9.1 (the model), §9.2 (the interaction), §9.3 (the rules), the cable list of §9.4, §9.5 and §9.6 (what is left out and what is only preserved), and the `site/rack/cables.js` row of §10.
- The rest of §9.4 (the cable schedule, cables on the SVG, PNG, GLB and draw.io exports, NetBox cable import) is Phase 2b.
- Read §5, §9, §10 and §11 before starting.

## Before you start

- Work on the branch `rack-builder-2a`. Run `git fetch origin && git rebase origin/main` before Task 1.
- **The branch `rack-mount-flag` is about to merge to `main`** (a desktop, wall or DIN-rail device is flagged; `itemsWithU` items may carry `mount`; such a device gets no ears). Nothing in this plan reads `mount`, and no check here relies on ears. If it has merged by the time you rebase, the "replace this" blocks in `site/rack-page.js` may sit a few lines from where this plan found them; if one no longer matches character for character, make the same change to the code as it now stands and say so in your task report.
- Serve locally with `python3 serve.py 8932`. `file://` does not work.

## Global constraints

- **Never edit anything under `vendor/` or `assets/`.** They are upstream snapshots, and `./refresh-assets.sh` overwrites them.
- No bundler, no npm, no new dependency. Modules import each other by relative path.
- **The showcase's behavior and its exports must not change.** `site/showcase/cables.js` stays as a re-export of the moved module. `site/hero-reveal.js`, `site/hero-3d.js`, `check-contract.py` and `check-browser.py`'s import of `/site/showcase/cables.js` keep working. Every change to `site/rack/cables.js` after the move is additive: a new option with the old behavior as its default, or new keys in a table.
- **A tool page must not import `site/showcase/artifact.js`** (`tests/rack/imports.test.mjs` enforces it).
- These must not touch the DOM or fetch, because `node --test` imports them: `site/rack/model.js`, `site/rack/fit.js`, `site/rack/rails.js`, `site/rack/export-data.js`, and the new `site/rack/cable-rules.js`.
- **Plugs are derived, never stored.** A cabled end seats the plug its port takes as an overlay computed from `rack.cables` and merged over the item's swaps at draw time. Nothing is written into `item.swaps`. The BOM and the DCIM exports are not given the plugs.
- **An end is `{item, path, view}`.** `view` is the device's own panel, `front` or `rear`, not the pane that shows it. In 2D an end is found by `[data-item-id][data-panel]`, never by device ref.
- **No `site/rack3d.js` change, and no cables in 3D, in Phase 2a.**
- **Do not touch the exports** (`site/rack/exports.js`, `site/rack/export-data.js`). Every export keeps saying, through `rackNotes`, that N cables are not in this export yet.
- **Forms are panel forms in the side panel**, like the frame form. No `prompt()` and no new `confirm()`.
- **A media mismatch is a warning, never a block. The loader never drops a cable. A cable is never silently deleted.**
- **The drag controller is off in Cable mode.** A port click resolves to the outermost `data-class="port"` above the click.
- Cable and tag CSS lives in `site/site.css`, which `rack.html` does not load: what is needed is copied into `site/rack/rack.css`.
- Prose in comments and UI copy is American English. UI copy is sentence case, with no "please" and no exclamation marks.
- **Never pass an async function as a `page.wait_for_function` predicate.** A promise is truthy at once. Wait on a synchronous predicate, then `page.evaluate` the awaiting.
- Browser checks are `@extra`-registered and run with `--only`. Local full-suite runs flake on showcase 3D and page-load timeouts (issue #59). Treat a failure as environmental **only if it reproduces on `main`**.
- Every commit message ends with a `Co-Authored-By:` trailer naming the model that wrote it. The commands below show `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; an implementer on another model uses its own.

## Facts the tasks rely on (verified 2026-10-03 on `origin/main` at `32567ca3`)

**The cable geometry (`site/showcase/cables.js`, 415 lines, moved by Task 1)**
- It imports `cablePoints` from `../../vendor/relief.js` and `svgEl` from `./artifact.js`. `vendor/relief.js` reads `location` when it loads, so the module does not import under node: it is checked in the browser.
- It exports exactly these 19 names: `COLORS`, `colorOf`, `JACKETS`, `colorOfJacket`, `PLUGS`, `plugColorOf`, `WIDTH`, `TAG_H`, `sag2d`, `plugAt`, `ends2d`, `LEAD_DROP`, `drawCables2d`, `looseOn`, `LEAD`, `hangPoints3d`, `danglePoints3d`, `clearOf`, `drawCables3d`.
- `colorOf(link)` is `link.media === 'copper' ? (COLORS.copper[link.purpose] || COLORS.copper.server) : (COLORS[link.media] || COLORS.os2)`, with `COLORS = {os2: '#e8c547', copper: {server: '#5aa7ff', management: '#9aa3ad'}}`.
- `drawCables2d(svg, plan, view, {edgeX, tag, looseTag, farLoose = () => false, outboard = 1})`:
  - `plan` is `{links: [{media, purpose, from: [dev, path, view?], to: [dev, path, view?]}]}`. An end is "on this face" when its third entry equals `view`.
  - It finds an end's connector points with `ends2d(svg, dev, path)`, which looks the device up by `[data-device-ref="<dev>"]` and takes the first match. The svg must be in the document and laid out (`getScreenCTM`).
  - It appends two layers: `g[data-cables="<view>"]` (the drawing) and `g[data-cable-tags="<view>"][data-pt-ui="*"]` (screen UI).
  - Each cable is a `g[data-cable][data-link-index][data-media][data-purpose][tabindex="0"]` whose first child is a `<title>`. Each stroke is two `<path>`s, a dark under-stroke and then the colored one, so the last `<path>` child of a cable group carries its color.
  - Both ends land on this face: a hanging cable. One lands and the other is on the other face: the cable hangs to `[edgeX, y]` and `tag(at, farEnd, link)` is called. One lands and the other is loose (on this face, or `farLoose(i, side)` says so of the other): an unplugged lead with `data-loose-lead="<the side that did not land>"`, and `looseTag(at, farEnd, link, i)` is called. `farEnd` is the link's own `from` or `to` array (the same object).
  - Every tag gets `data-link-index` and `data-cable-tag`. It returns one record per link: `{link, i, g, tag, loose, tagged, dangling}`, with `g` null when nothing was drawn.
- `plugAt(cablePointPath, path)` is true for `<path>-occupant` and `<path>-occupant/...`, never `port-10-occupant` for `port-1`.
- Who reads the file:
  - `site/showcase/patch-view.js:10` (`drawCables2d, drawCables3d, looseOn, colorOf`);
  - `site/hero-reveal.js:16` and `site/hero-3d.js:25`, each from `'./showcase/cables.js'`;
  - `check-browser.py:609`, a dynamic `import('/site/showcase/cables.js')`;
  - `check-contract.py` reads it **as text** at lines 769 and 866 (`drawCables2d`, `cablePoints`, `export const JACKETS = {` with `mm`, `sm`, `dac`, `cu`), and at lines 909 and 937 requires the hero files to import from `'./showcase/cables.js'`.
- The cable CSS is `site/site.css` lines 849 to 858.
- The showcase pill (`site/showcase/patch-view.js` `cableFace`): `ROOM = 260` mm beside the rack and 40 mm below; the rear face widens to the left and the front to the right; `edgeX` is 8 mm outside the base viewBox; a tag pill is `7 × characters + 12` wide and 18 tall.

**Drawings, slots and seats**
- `cablePoints(svg)` (`vendor/relief.js:995`) returns one `{at, path, el, …}` per `[data-cp="cable"]` marker under `svg`, where `path` is the owner's `data-path`. 25 component skins carry the marker: the plugs (`generic/lc-plug@2`, `generic/lc-duplex-plug@2`, `generic/rj45-plug@1`, SC, MPO and coax plugs) **and the DAC and AOC cable ends** (`generic/qsfp-cable@1`, `generic/sfp-cable@1`, the Amphenol, Molex, Volex, FS and Siemon ones). Optics carry none: a cable lands on the plugs in an optic's bores.
- A port is `data-class="port"` with `data-path` and `data-media` (the connector or form factor: `qsfp28`, `sfp`, `rj45`, `rj45-serial`). Examples: `port-1` on `as7726-32x`; `slot-2/module/p0` on a seated `cisco/a9k-16x100ge-tr@1`; `port-2-1` on `tm-280`.
- **A seated optic or plug is not inside its cage.** `vendor/swap.js` seats a device cage's occupant as the cage's next sibling, at `<port>-occupant` (a card cage's occupant is a child of the card's group). A seated optic is `data-class="transceiver"`; its two bores are `data-class="port"` at `<port>-occupant/tx` and `/rx`; a plug in a bore is at `<port>-occupant/tx-occupant`.
- `faceCages(rootEl, deviceCages, compByRef)` (`vendor/swap.js:1163`) returns every slot of a parsed face, the device's own (`configs.json` `cages[view]`) and those of whatever is seated. Each has `id` (the drawing path, which is also the key a swaps map uses), `kind`, `interface`, `accepts` and `bores`.
  - `kind: 'cage'` takes an optic or a DAC: `interface` `sfp`, `qsfp`, `qsfp-dd`, `osfp`, `xfp`, `cfp…`. No cage accepts a plug.
  - `kind: 'connector'` takes a plug: `rj45` accepts `generic/rj45-plug@1`; `lc` (an optic's bore) accepts `generic/lc-plug@2`; `lc-duplex` (a cassette adapter, with `bores: ['1', '2']`) accepts `generic/lc-duplex-plug@2`; `mpo` accepts the MPO plugs.
- `site/showcase/patching.json` seats plugs with exactly these keys: `port-1-occupant/tx`, `slot-2/module/p0-occupant/tx`, `mgmt-eth`, `bay-1/module/lc1`.
- Slots of the fixture's devices (`assets/dist/<ref>.configs.json`):
  - `as7726-32x` front: `port-1` to `port-32` (cage, `qsfp`), `mgmt-eth` and `console` (connector, `rj45`).
  - `tm-280` front: `con`, `port-2-1`, `port-2-2`, `copper-3-1` (connector, `rj45`); `port-1-1`, `port-3-1` (cage, `sfp`).
  - `asr-9006`: no device cages; `slot-0` to `slot-5` are bays whose default is `cisco/a9k-slot-cover@1` (drawn at `slot-2/module`, `attrs.model` "A9K Slot Cover"); the card `cisco/a9k-16x100ge-tr@1` has 16 `qsfp` cages `p0` to `p15`.
- Component attrs (`assets/dist/components.json`): `generic/qsfp-lc@2` is `{face: 'lc-duplex', 'form-factor': 'qsfp', media: 'fiber'}`, with no mode; one vendor SFP states `mode: 'single-mode'`; DACs state `cable-kind: 'dac'` (also `acc`, `aec`), AOCs `cable-kind: 'aoc'`, `generic/qsfp-cable@1` `face: 'cable'`; the copper SFP is `{face: 'rj45', media: 'copper'}`; the plugs are `{connector: 'rj45', media: 'rj45'}` and `{connector: 'lc', media: 'fiber'}`.
- `site/rack/face.js` exports `configuredFace({ref, cfg, view, swaps, fields, turned})` (memoized, resolves to a frozen `{text, vb, zones, ports, seat}` or `null`), `components()`, `findComp(list, ref)` and `DIST`. `jdist(url)` (`vendor/dist.js`) rejects on a 404.
- Chassis sizes (`site/rack/chassis.json`): `asr-9006` is 10U, `as7726-32x` and `tm-280` are 1U.

**The page**
- `site/rack/elevation.js`:
  - `drawElevation({items, frame, view, …})` returns `<svg data-pane="<view>">` with viewBox `-32 -18 514.85 <heightRU × 44.45 + 30>` and no width or height.
  - Each item has exactly one `g[data-item-id][data-device-ref][data-panel]` per pane (`mounted`, `through` or `missing`), drawn from `configuredFace` with the item's `swaps`. On the pane it is mounted on, it also has `g.rk-ears[data-item-id]`, which has no `data-panel`.
  - `panelFor(item, pane)` is `((item.face === pane) !== !!item.turned) ? 'front' : 'rear'`, and is exported.
  - With `hitTargets`, each U has `rect.rk-u[data-u][data-face]`.
- `site/rack-page.js`:
  - State `S`; `rack()` is `S.doc.racks[0]`; `itemById(id)`.
  - `commit(nextRack)` autosaves, calls `render()` and `scheduleRebuild3d()`. `select(sel)` sets `S.sel` and calls `render()`.
  - `render()` is async: it draws both panes, replaces them, applies the zoom unless `#panes` is hidden (3D), then calls `renderSide()`. `S.draws` drops a render that was overtaken.
  - `renderSide()` rebuilds `#side` from `S.sel` (`null`, `frame`, `u`, `move`, or else an item) and restores keyboard focus by element id.
  - `onPaneClick` runs `drag?.consumeClick()` first, then move mode, then a `through` panel, then `[data-item-id]`, then `[data-u]`.
  - `setMode('3d')` does not call `render()`.
  - The `keydown` handler ignores keys whose target is an `input`, `select` or `textarea`.
  - `window.__rack = {ready, doc, flush, scene}` exists with `?probe=1`.
- `site/rack/drag.js` `onPointerDown` starts a drag on a press over any `[data-item-id]` panel or ears group.
- `site/rack/zoom.js` reads each pane's `viewBox` (`factorForFit`) and sizes the SVGs by style; it must run after any change to a viewBox.
- `site/rack/model.js`: `parseDoc` keeps `cables` as an opaque `structuredClone` (line 123); `nextId(list, prefix)` returns one past the highest id in `list`; `withItem`, `updateItem` and `withoutItem` do not touch `cables`. `tests/rack/model.test.mjs` line 97 pins the opaque copy.
- `rack.html` `.rk-bar`, in order: `#devNote`, `#libMenu`, `#frameSummary`, `#frameBtn`, `#exportMenu`, `#exportStatus`, `#rkZoom`, `#rkMode`, `#libNote`. `.rk-zoom` has `margin-left: auto`, so anything before it leaves `#rkMode` where it is. `#devNote` ends "Coming next: cabling."
- `rack.html` loads `brand/tokens.css` (which defines `--pt-font-mono`, `--pt-brass`, `--pt-warn`), `site/toolbar.css`, `site/tool-theme.css` and `site/rack/rack.css`. It does not load `site/site.css`.
- `site/rack/export-data.js` `rackNotes(rack)` returns "N cables are not in this export yet." when the rack has cables.

**The test harness**
- `tests/rack/*.test.mjs`: 88 tests pass on this commit. Node is v22.
- `python3 check-contract.py` prints `contract: 291 checks passed`.
- `check-browser.py`:
  - Each `@extra` check gets `browser.new_page()`, a fresh context with empty storage. New checks go before `def main():`.
  - `EXPORT_FIXTURE` is a 24U four-post rack: `i1` `asr-9006` "core-1" at U2 front with `slot-2` holding the 16x100GE card; `i2` `as7726-32x` "leaf-1" at U14 front with an optic in `port-1`; `i3` and `i4` `tm-280`, both "demarc", at U14 and U20 rear; no cables.
  - `open_fixture(page, base, fixture=EXPORT_FIXTURE)` loads a fixture through `#openFile` and waits for its name and its items.
  - `wait_fn(page, label, expr, timeout=READY_MS)` and `wait_sel(page, label, selector, timeout=READY_MS)` raise `RuntimeError` naming the step. `render_token(page)` and `wait_rendered(page, label, token)` wait for the panes to be redrawn. `export_file(page, kind)` returns a download. `read_csv(dl)` returns `(fieldnames, rows, text)`. `webgl_trouble(page)` says whether this runner has no WebGL.
  - `READY_MS = 60000`, `READY_3D_MS = 240000`.
  - A Playwright `page.click` refuses to click an element whose center another element covers. A plug seated over a jack is the jack's sibling, so a check clicks `<port>-occupant` there; where a cable or another panel may cover a device, a check uses `page.dispatch_event(selector, "click")`.
  - `check_rack_dev_note` requires "still being built" and "Coming next: cabling." in the note, and refuses the word "exports".

## File map

| File | Responsibility | Task |
|---|---|---|
| `site/rack/cables.js` | The cable geometry, moved from the showcase; later an `ends` option and the Rack Builder's media colors | 1, 5 |
| `site/showcase/cables.js` | A one-line re-export of the moved module | 1 |
| `check-contract.py` | Reads the moved file; holds the re-export | 1 |
| `tests/rack/imports.test.mjs` | The moved module imports nothing from the showcase; the old file only re-exports | 1 |
| `site/rack/cable-rules.js` | Pure cable rules | 2, 3 |
| `site/rack/model.js` | `readCables`: the loader validates cables and never drops one | 2 |
| `tests/rack/cables.test.mjs`, `tests/rack/cable-media.test.mjs`, `tests/rack/model.test.mjs` | Node suites for the rules and the loader | 2, 3 |
| `site/rack/cable-plugs.js` | What each cabled end has on its face, and the derived plugs | 4 |
| `site/rack/cable-view.js` | The panes' cable layer: widen, find an end, draw, pick a port, light | 5, 7, 8 |
| `site/rack/cable-panel.js` | The cable form, the cable list, the remove question | 6, 8, 9 |
| `site/rack-page.js` | Wiring: the overlay, drawing, Cable mode, the panels, the lifecycle, 3D | 4, 5, 7, 8, 9, 10 |
| `rack.html`, `site/rack/rack.css` | The Cable button, cable and panel styles, the dev note | 5, 6, 7, 8, 10 |
| `check-browser.py` | The cable fixture, helpers and every new check | 1, 4 to 10 |
| `docs/superpowers/specs/2026-09-26-rack-builder-design.md` | The status line | 10 |

**The cable fixture** (`CABLE_FIXTURE`, added to `check-browser.py` by Task 4) is the export fixture's rack with cables. It holds a port on a seated card that holds an optic, an optic port, a copper port, a cross-face pair, an empty cage, and two devices with one ref. `check_rack_cable_plugs` (Task 4), `check_rack_cables_drawn` (5), `check_rack_cable_mode` (7), `check_rack_cable_list` (8), `check_rack_cable_lifecycle` (9) and `check_rack_cables_3d` (10) use it.

---

### Task 1: The cable geometry moves to `site/rack/cables.js`; the showcase re-exports it

**Files:**
- Move: `site/showcase/cables.js` to `site/rack/cables.js`
- Create: `site/showcase/cables.js` (a re-export)
- Modify: `check-contract.py` (two text reads, one new check), `tests/rack/imports.test.mjs`, `check-browser.py` (add `check_cables_moved`)

**Interfaces:**
- Produces: `site/rack/cables.js` exports the same 19 names with the same behavior: `COLORS`, `colorOf`, `JACKETS`, `colorOfJacket`, `PLUGS`, `plugColorOf`, `WIDTH`, `TAG_H`, `sag2d`, `plugAt`, `ends2d`, `LEAD_DROP`, `drawCables2d`, `looseOn`, `LEAD`, `hangPoints3d`, `danglePoints3d`, `clearOf`, `drawCables3d`. It imports `svgEl` from `./dom.js` and nothing from `site/showcase/`.
- Produces: `site/showcase/cables.js` is `export * from '../rack/cables.js';` and nothing else, so every existing import of it gets the same bindings.

- [ ] **Step 1: Write the failing tests**

In `tests/rack/imports.test.mjs`, add at the end:

```js
test('the cable geometry lives in site/rack, and the showcase file only re-exports it', () => {
  const moved = read('site/rack/cables.js');
  assert.match(moved, /export function drawCables2d/);
  assert.match(moved, /export async function drawCables3d/);
  assert.doesNotMatch(moved, /from\s+'[^']*showcase\//, 'site/rack/cables.js imports from the showcase');
  const shim = read('site/showcase/cables.js');
  assert.match(shim, /export \* from '\.\.\/rack\/cables\.js';/);
  assert.doesNotMatch(shim, /\bfunction\b|\bconst\b|\bimport\b/, 'site/showcase/cables.js still holds code of its own');
});
```

In `check-browser.py`, before `def main():`, add:

```python
@extra("cables.js lives in site/rack, and the showcase's old address re-exports the same bindings")
def check_cables_moved(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    page.goto(f"{base}/index.html", wait_until="load")
    r = page.evaluate("""async () => {
      const names = ['COLORS', 'colorOf', 'JACKETS', 'colorOfJacket', 'PLUGS', 'plugColorOf', 'WIDTH', 'TAG_H',
                     'sag2d', 'plugAt', 'ends2d', 'LEAD_DROP', 'drawCables2d', 'looseOn', 'LEAD', 'hangPoints3d',
                     'danglePoints3d', 'clearOf', 'drawCables3d'];
      let R;
      try { R = await import('/site/rack/cables.js'); }
      catch (err) { return {error: String(err.message || err)}; }
      const S = await import('/site/showcase/cables.js');
      return {missing: names.filter(n => !(n in R)), differ: names.filter(n => R[n] !== S[n]),
              extra: Object.keys(S).filter(n => !(n in R))};
    }""")
    if r.get("error"):
        return bad + [f"cables moved: site/rack/cables.js does not load ({r['error']})"]
    for k in ("missing", "differ", "extra"):
        if r[k]:
            bad.append(f"cables moved: {k} {r[k]}")
    return bad
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `node --test tests/rack/imports.test.mjs`
Expected: FAIL, `ENOENT: no such file or directory` for `site/rack/cables.js`.

Run: `python3 check-browser.py --only check_cables_moved`
Expected: FAIL, `cables moved: site/rack/cables.js does not load (Failed to fetch dynamically imported module: …)`.

- [ ] **Step 3: Move the file and leave a re-export behind**

```bash
git mv site/showcase/cables.js site/rack/cables.js
```

In `site/rack/cables.js`, replace

```js
// Cables that hang. One module for both views, so the sag and the colors
// cannot differ between 2D and 3D (spec §5).
```

with

```js
// Cables that hang. One module for both views, so the sag and the colors
// cannot differ between 2D and 3D (spec §5) - and one module for the showcase
// and the Rack Builder, so a cable hangs the same way in both. It lived in
// site/showcase/ until the Rack Builder needed it (rack builder spec §10);
// site/showcase/cables.js re-exports it for the showcase and the hero.
```

and replace

```js
import {svgEl} from './artifact.js';
```

with

```js
import {svgEl} from './dom.js';
```

Leave `import {cablePoints} from '../../vendor/relief.js';` as it is: `site/rack/` is as deep as `site/showcase/`. Change nothing else in the file.

Create `site/showcase/cables.js`:

```js
// The cable geometry moved to site/rack/cables.js, where the Rack Builder
// shares it (rack builder spec §10). This file is only the old address:
// patch-view.js, hero-reveal.js and hero-3d.js keep their lines unchanged
// and get the very same bindings.
export * from '../rack/cables.js';
```

The node test refuses the words `function`, `const` and `import` in this file, comments included, so keep the comment as written.

- [ ] **Step 4: Run the contract check and watch it fail on the old path**

Run: `python3 check-contract.py`
Expected: `contract: 289 checks passed, 2 FAILED`, naming `cables.js draws 2D cables from the kit's cablePoints` and `cables.js names the four jacket colors the hero draws (mm, sm, dac, cu)`. Both read the old file as text.

- [ ] **Step 5: Repoint the contract at the moved file**

In `check-contract.py`, replace

```python
CAB = HERE / "site" / "showcase" / "cables.js"
cab = CAB.read_text() if CAB.is_file() else ""
check("export function drawCables2d" in cab and "cablePoints" in cab,
      "cables.js draws 2D cables from the kit's cablePoints", "missing")
```

with

```python
# The geometry lives in site/rack/ since the Rack Builder shares it; the
# showcase's old address is a re-export and holds no code of its own, so the
# hero's and patch-view.js's imports (checked further down) still resolve.
CAB = HERE / "site" / "rack" / "cables.js"
cab = CAB.read_text() if CAB.is_file() else ""
check("export function drawCables2d" in cab and "cablePoints" in cab,
      "cables.js draws 2D cables from the kit's cablePoints", "missing")
SHIM = HERE / "site" / "showcase" / "cables.js"
shim = SHIM.read_text() if SHIM.is_file() else ""
check("export * from '../rack/cables.js';" in shim and "function" not in shim,
      "site/showcase/cables.js only re-exports site/rack/cables.js",
      "the showcase file is missing, or defines code of its own")
```

and replace

```python
cab = (HERE / "site" / "showcase" / "cables.js").read_text()
```

with

```python
cab = (HERE / "site" / "rack" / "cables.js").read_text()
```

Leave the two hero checks that match `'./showcase/cables.js'` alone: the hero still imports from there.

- [ ] **Step 6: Run everything the move can reach**

Run: `node --test tests/rack/*.test.mjs && python3 check-contract.py && python3 check-browser.py --only check_cables_moved,check_takeaway_cables_2d,check_takeaway_cables_3d,check_takeaway_drawio`
Expected: 89 node tests pass; `contract: 292 checks passed`; the four browser checks are `ok`.

Then run the whole browser suite once, because the hero and the showcase's stages import the moved module and are not `@extra` checks: `python3 check-browser.py`
Expected: no new failure. If a showcase 3D or page-load check times out, re-run it on `main`; it is environmental only if it fails there too (issue #59).

- [ ] **Step 7: Commit**

```bash
git add site/rack/cables.js site/showcase/cables.js check-contract.py tests/rack/imports.test.mjs check-browser.py
git commit -m "rack: the cable geometry moves to site/rack/cables.js, and the showcase re-exports it

The Rack Builder draws its cables with the showcase's own geometry (spec
§10). site/showcase/cables.js stays as a one-line re-export, so
patch-view.js, the hero and check-browser's import are unchanged; the
contract reads the moved file and holds the re-export to holding no code.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The cable model, pure: ends, panes, one cable per port, edits, and a loader that never drops a cable

**Files:**
- Create: `site/rack/cable-rules.js`, `tests/rack/cables.test.mjs`
- Modify: `site/rack/model.js` (add `readCables`; `parseDoc` uses it), `tests/rack/model.test.mjs` (one assertion)

**Interfaces:**
- Consumes: `nextId(list, prefix)` and `uLabel(frame, u)` from `site/rack/model.js`.
- Produces, from `site/rack/cable-rules.js` (no DOM, no fetch):
  - `endKey(end) → string`, `'<item>|<view>|<path>'`; `sameEnd(a, b) → boolean`.
  - `paneOf(item, view) → 'front' | 'rear'`: the pane that shows that panel of the item. The inverse of `elevation.js`'s `panelFor`.
  - `portPathOf(path) → string`: the path with everything from the first `-occupant` dropped.
  - `endName(rack, end) → string`, for example `"demarc (U14) port-2-1"`, or `"a removed device's port-2-1"`. `cableName(cable) → string`, its label or its id. `tagText(rack, end) → string`, `"→ demarc port-2-1"`, at most 32 characters.
  - `portFree(rack, end, {ignoreId}) → {ok: true} | {ok: false, reason}` and `canCable(rack, a, b, {ignoreId}) → {ok: true} | {ok: false, reason}`.
  - `withCable(rack, {a, b, media, purpose, label, length}) → {rack, cable}`; `updateCable(rack, id, patch) → rack` (`length: null` in the patch removes the length); `withoutCable(rack, id) → rack`; `cablesOf(rack, itemId) → cable[]`; `withoutCablesOf(rack, itemId) → rack`. Each returns a new rack and leaves `rack.items` and `rack.frame` the same objects.
  - `UNITS = ['m', 'ft']`; `parseLength(text, unit) → {ok: true, length: {value, unit, source: 'entered'} | null} | {ok: false, reason}`; `lengthText(length) → string`.
  - `cablePlan(rack) → {links: [{id, media, purpose, from: [itemId, path, pane], to: [itemId, path, pane]}]}`, the shape `drawCables2d` takes. An end whose item is gone has pane `'none'`; an empty media is `'unset'`.
- Produces, from `site/rack/model.js`: `readCables(list) → cable[]`, used by `parseDoc`. Every cable in is a cable out, as `{…unknown fields, id, a, b, media, purpose, label, length?, route}`.

- [ ] **Step 1: Write the failing tests**

Create `tests/rack/cables.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../../site/rack/model.js';
import * as C from '../../site/rack/cable-rules.js';

// A small rack: a switch and a router on the front, two identical demarcs on the rear.
function rack() {
  let r = M.newRack({name: 'Cable test'});
  for (const it of [
    {ref: 'asr-9006', cfg: 'base', ru: 2, label: 'core-1'},
    {ref: 'as7726-32x', cfg: 'ac-f2b', ru: 14, label: 'leaf-1'},
    {ref: 'tm-280', cfg: 'base', ru: 14, face: 'rear', label: 'demarc'},
    {ref: 'tm-280', cfg: 'base', ru: 20, face: 'rear', label: 'demarc'}]) r = M.withItem(r, it).rack;
  return r;
}
const end = (item, path, view = 'front') => ({item, path, view});

test('an end is {item, path, view}; its key tells apart two devices with one ref and two panels of one device', () => {
  assert.equal(C.endKey(end('i3', 'port-2-1')), 'i3|front|port-2-1');
  assert.notEqual(C.endKey(end('i3', 'port-2-1')), C.endKey(end('i4', 'port-2-1')));
  assert.notEqual(C.endKey(end('i3', 'port-1', 'front')), C.endKey(end('i3', 'port-1', 'rear')));
  assert.ok(C.sameEnd(end('i1', 'p'), {item: 'i1', path: 'p', view: 'front', extra: 1}));
});

test('paneOf is the inverse of panelFor, for every face and turn', () => {
  // elevation.js's rule, restated: which panel of the device faces a pane.
  const panelFor = (item, pane) => (((item.face === pane) !== !!item.turned) ? 'front' : 'rear');
  for (const face of ['front', 'rear']) for (const turned of [false, true]) {
    const item = {face, turned};
    for (const view of ['front', 'rear'])
      assert.equal(panelFor(item, C.paneOf(item, view)), view, JSON.stringify({face, turned, view}));
  }
  assert.equal(C.paneOf({face: 'front', turned: false}, 'front'), 'front');
  assert.equal(C.paneOf({face: 'rear', turned: false}, 'front'), 'rear', 'a rear-mounted device shows its front in the rear pane');
  assert.equal(C.paneOf({face: 'front', turned: true}, 'front'), 'rear', 'a turned device shows its front in the other pane');
  assert.equal(C.paneOf({face: 'rear', turned: true}, 'rear'), 'rear');
});

test('portPathOf drops the occupant and everything under it', () => {
  assert.equal(C.portPathOf('port-1'), 'port-1');
  assert.equal(C.portPathOf('port-1-occupant'), 'port-1');
  assert.equal(C.portPathOf('port-1-occupant/tx'), 'port-1');
  assert.equal(C.portPathOf('port-1-occupant/tx-occupant'), 'port-1');
  assert.equal(C.portPathOf('slot-2/module/p0-occupant/rx'), 'slot-2/module/p0');
  assert.equal(C.portPathOf('port-10'), 'port-10');
});

test('withCable allocates c ids, copies the ends, and omits an unset length', () => {
  const r0 = rack();
  const {rack: r1, cable: c1} = C.withCable(r0, {a: end('i2', 'port-1'), b: end('i1', 'slot-2/module/p0'),
    media: 'os2', purpose: 'uplink', label: 'A1', length: {value: 2, unit: 'm', source: 'entered'}});
  assert.deepEqual(c1, {id: 'c1', a: {item: 'i2', path: 'port-1', view: 'front'},
    b: {item: 'i1', path: 'slot-2/module/p0', view: 'front'}, media: 'os2', purpose: 'uplink', label: 'A1',
    length: {value: 2, unit: 'm', source: 'entered'}, route: []});
  assert.equal(r0.cables.length, 0, 'the original rack is untouched');
  const {rack: r2, cable: c2} = C.withCable(r1, {a: end('i2', 'mgmt-eth'), b: end('i3', 'port-2-1')});
  assert.equal(c2.id, 'c2');
  assert.ok(!('length' in c2));
  assert.deepEqual([c2.media, c2.purpose, c2.label, c2.route], ['', '', '', []]);
  assert.equal(r2.items, r0.items, 'a cable edit leaves the items array itself alone');
  assert.equal(C.updateCable(r2, 'c1', {media: 'om4', length: null}).cables[0].media, 'om4');
  assert.ok(!('length' in C.updateCable(r2, 'c1', {length: null}).cables[0]));
  assert.deepEqual(C.updateCable(r2, 'c2', {length: {value: 3, unit: 'ft', source: 'entered'}}).cables[1].length,
    {value: 3, unit: 'ft', source: 'entered'});
  assert.deepEqual(C.withoutCable(r2, 'c1').cables.map(c => c.id), ['c2']);
});

test('one cable per port: a taken port is refused with a sentence that names the device, its U and the cable', () => {
  const {rack: r} = C.withCable(rack(), {a: end('i2', 'port-1'), b: end('i3', 'port-2-1'), label: 'A1'});
  assert.deepEqual(C.portFree(r, end('i2', 'port-2')), {ok: true});
  assert.deepEqual(C.portFree(r, end('i2', 'port-1')),
    {ok: false, reason: 'leaf-1 (U14) port-1 already has a cable (A1).'});
  assert.deepEqual(C.portFree(r, end('i3', 'port-2-1')),
    {ok: false, reason: 'demarc (U14) port-2-1 already has a cable (A1).'});
  assert.deepEqual(C.portFree(r, end('i4', 'port-2-1')), {ok: true}, 'the other demarc is another device');
  assert.deepEqual(C.portFree(r, end('i2', 'port-1', 'rear')), {ok: true}, 'the same path on the other panel is another port');
  assert.deepEqual(C.portFree(r, end('i2', 'port-1'), {ignoreId: 'c1'}), {ok: true}, 'editing a cable does not collide with itself');
  assert.deepEqual(C.canCable(r, end('i2', 'port-2'), end('i2', 'port-2')),
    {ok: false, reason: 'A cable needs two different ports.'});
  assert.deepEqual(C.canCable(r, end('i2', 'port-2'), end('i4', 'port-2-1')), {ok: true});
  assert.equal(C.canCable(r, end('i2', 'port-2'), end('i2', 'port-1')).ok, false);
  const unlabeled = C.withCable(rack(), {a: end('i2', 'port-1'), b: end('i3', 'port-2-1')}).rack;
  assert.match(C.portFree(unlabeled, end('i2', 'port-1')).reason, /\(c1\)\.$/, 'a cable with no label is named by its id');
});

test('endName and tagText say which device, and survive a removed one', () => {
  const r = rack();
  assert.equal(C.endName(r, end('i4', 'port-2-1')), 'demarc (U20) port-2-1');
  assert.equal(C.endName({...r, frame: {...r.frame, numbering: 'top-down'}}, end('i4', 'port-2-1')), 'demarc (U23) port-2-1');
  assert.equal(C.endName(r, end('i9', 'port-1')), "a removed device's port-1");
  assert.equal(C.tagText(r, end('i3', 'port-2-1')), '→ demarc port-2-1');
  assert.equal(C.tagText(r, end('i9', 'port-1')), '→ removed port-1');
  const long = C.tagText(r, end('i1', 'slot-2/module/a-very-long-port-name-indeed'));
  assert.equal(long.length, 32);
  assert.ok(long.endsWith('…'));
});

test('cablesOf and withoutCablesOf find a device\'s cables by its id, at either end', () => {
  let r = C.withCable(rack(), {a: end('i2', 'port-1'), b: end('i1', 'slot-2/module/p0')}).rack;
  r = C.withCable(r, {a: end('i2', 'mgmt-eth'), b: end('i3', 'port-2-1')}).rack;
  r = C.withCable(r, {a: end('i4', 'port-2-1'), b: end('i1', 'slot-2/module/p1')}).rack;
  assert.deepEqual(C.cablesOf(r, 'i2').map(c => c.id), ['c1', 'c2']);
  assert.deepEqual(C.cablesOf(r, 'i3').map(c => c.id), ['c2']);
  assert.deepEqual(C.cablesOf(r, 'i9'), []);
  assert.deepEqual(C.withoutCablesOf(r, 'i2').cables.map(c => c.id), ['c3']);
  // Removing the item alone keeps its cables: they become loose ends.
  assert.equal(M.withoutItem(r, 'i2').cables.length, 3);
  // Moving it keeps them too: a cable names the item's id, not its place.
  assert.deepEqual(M.updateItem(r, 'i2', {ru: 16, face: 'rear'}).cables, r.cables);
});

test('parseLength takes a positive number or nothing; lengthText prints it', () => {
  assert.deepEqual(C.parseLength('', 'm'), {ok: true, length: null});
  assert.deepEqual(C.parseLength('  ', 'ft'), {ok: true, length: null});
  assert.deepEqual(C.parseLength('2.5', 'm'), {ok: true, length: {value: 2.5, unit: 'm', source: 'entered'}});
  assert.deepEqual(C.parseLength('10', 'ft'), {ok: true, length: {value: 10, unit: 'ft', source: 'entered'}});
  assert.deepEqual(C.parseLength('3', 'yards'), {ok: true, length: {value: 3, unit: 'm', source: 'entered'}});
  for (const bad of ['0', '-1', 'abc', 'Infinity'])
    assert.deepEqual(C.parseLength(bad, 'm'), {ok: false, reason: 'Enter a length above 0, or leave it empty.'}, bad);
  assert.equal(C.lengthText({value: 2, unit: 'm'}), '2 m');
  assert.equal(C.lengthText({value: 10, unit: 'ft'}), '10 ft');
  assert.equal(C.lengthText(undefined), '');
});

test('cablePlan hands cables.js each end as [item id, path, pane]', () => {
  let r = rack();
  r = C.withCable(r, {a: end('i2', 'port-1'), b: end('i1', 'slot-2/module/p0'), media: 'os2', purpose: 'uplink'}).rack;
  r = C.withCable(r, {a: end('i2', 'mgmt-eth'), b: end('i3', 'port-2-1')}).rack;
  r = C.withCable(r, {a: end('i2', 'port-2'), b: end('i9', 'port-2-1')}).rack;
  assert.deepEqual(C.cablePlan(r).links, [
    {id: 'c1', media: 'os2', purpose: 'uplink', from: ['i2', 'port-1', 'front'], to: ['i1', 'slot-2/module/p0', 'front']},
    {id: 'c2', media: 'unset', purpose: '', from: ['i2', 'mgmt-eth', 'front'], to: ['i3', 'port-2-1', 'rear']},
    {id: 'c3', media: 'unset', purpose: '', from: ['i2', 'port-2', 'front'], to: ['i9', 'port-2-1', 'none']}]);
  assert.deepEqual(C.cablePlan(M.newRack()).links, []);
});

test('the loader keeps every cable: it fixes the shape and never drops one', () => {
  const d = M.parseDoc({format: 'portrayal-rack', version: 1, racks: [{frame: {}, items: [{id: 'i1', ref: 'x', ru: 1}],
    cables: [
      {id: 'c1', a: {item: 'i1', path: 'port-1', view: 'front'}, b: {item: 'gone', path: 'port-2', view: 'rear'},
       media: 'os2', purpose: 'uplink', label: 'A1', length: {value: '2', unit: 'm', source: 'entered'},
       route: [{item: 'i1'}], color: 'red'},
      {id: 'c1', a: {item: 'i1', path: 'port-3'}, b: null, media: 'os1', length: {value: 0}},
      {},
      'nonsense',
      {id: 'c2', a: {item: 'i1', path: 'p', view: 'sideways'}, b: {item: 'i1', path: 'q'}, length: {value: 3, unit: 'ft', source: 'routed'}},
    ]}]});
  const cs = d.racks[0].cables;
  assert.equal(cs.length, 5, 'five in, five out');
  assert.deepEqual(cs[0], {id: 'c1', a: {item: 'i1', path: 'port-1', view: 'front'},
    b: {item: 'gone', path: 'port-2', view: 'rear'}, media: 'os2', purpose: 'uplink', label: 'A1',
    length: {value: 2, unit: 'm', source: 'entered'}, route: [{item: 'i1'}], color: 'red'},
    'a missing item is kept; route and unknown fields survive');
  assert.equal(new Set(cs.map(c => c.id)).size, 5, 'ids are unique');
  assert.equal(cs[4].id, 'c2', 'a declared id is not taken by a repaired one before it');
  assert.deepEqual(cs[1].b, {item: '', path: '', view: 'front'});
  assert.equal(cs[1].media, 'os1', 'an unknown media is kept as written');
  assert.ok(!('length' in cs[1]), 'a length that is not a positive number is dropped, the cable is not');
  assert.deepEqual(cs[2].a, {item: '', path: '', view: 'front'});
  assert.deepEqual([cs[3].media, cs[3].purpose, cs[3].label, cs[3].route], ['', '', '', []]);
  assert.equal(cs[4].a.view, 'front');
  assert.deepEqual(cs[4].length, {value: 3, unit: 'ft', source: 'routed'});
});

test('a cabled document survives serialize and parse unchanged', () => {
  let d = M.newDoc({name: 'Cabled'});
  let r = M.withItem(d.racks[0], {ref: 'as7726-32x', cfg: 'ac-f2b', ru: 14}).rack;
  r = M.withItem(r, {ref: 'tm-280', cfg: 'base', ru: 14, face: 'rear'}).rack;
  r = C.withCable(r, {a: end('i1', 'mgmt-eth'), b: end('i2', 'port-2-1'), media: 'cat6a', purpose: 'management',
    label: 'M1', length: {value: 3, unit: 'ft', source: 'entered'}}).rack;
  r = C.withCable(r, {a: end('i1', 'port-2'), b: end('i2', 'port-1-1')}).rack;
  d = {...d, racks: [r]};
  assert.deepEqual(M.parseDoc(M.serialize(d)), d);
});
```

In `tests/rack/model.test.mjs`, in the test `parseDoc fills what an older writer left out, and keeps zeroU and cables`, replace

```js
  assert.deepEqual([d.racks[0].zeroU, d.racks[0].cables], [[{id: 'z1'}], [{id: 'c1'}]]);
```

with

```js
  assert.deepEqual(d.racks[0].zeroU, [{id: 'z1'}]);
  assert.deepEqual(d.racks[0].cables, [{id: 'c1', a: {item: '', path: '', view: 'front'},
    b: {item: '', path: '', view: 'front'}, media: '', purpose: '', label: '', route: []}]);
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `node --test tests/rack/*.test.mjs`
Expected: FAIL. `tests/rack/cables.test.mjs` fails with `Cannot find module '…/site/rack/cable-rules.js'`, and the `model.test.mjs` test fails on the cables assertion (`{id: 'c1'}` is still an opaque copy).

- [ ] **Step 3: Write the cable model**

Create `site/rack/cable-rules.js`:

```js
// THE CABLE RULES (spec §9). Pure: no DOM, no fetch, so the page, the side
// panel and `node --test` all read one definition. A rule that says no gives
// a sentence, in the style of fit.js.
//
// A cable is {id, a, b, media, purpose, label, length?, route}; an END is
// {item, path, view}: the item's id, the port's data-path, and the device's
// OWN panel ('front' or 'rear') the port is on - not the pane that shows it.

import {nextId, uLabel} from './model.js';

// ── ends ────────────────────────────────────────────────────────────────
export const endKey = end => `${end.item}|${end.view}|${end.path}`;
export const sameEnd = (a, b) => endKey(a) === endKey(b);

// WHICH PANE SHOWS A DEVICE'S PANEL: the inverse of elevation.js's panelFor.
// A device's front is on the face it is mounted on, unless it is turned.
const OTHER = {front: 'rear', rear: 'front'};
export const paneOf = (item, view) => (((view === 'front') !== !!item.turned) ? item.face : OTHER[item.face]);

// THE PORT A CLICKED PATH BELONGS TO. A seated optic and its plugs are drawn
// beside their cage, at `<port>-occupant` and below it, so a click on either
// is a click on the port: everything from the first `-occupant` on is dropped.
export const portPathOf = path => String(path).split('-occupant')[0];

const itemOf = (rack, end) => rack.items.find(i => i.id === end.item) || null;
// An end as a person reads it. Labels repeat (two "demarc"), so the U is in it.
export function endName(rack, end) {
  const it = itemOf(rack, end);
  return it ? `${it.label} (U${uLabel(rack.frame, it.ru)}) ${end.path}` : `a removed device's ${end.path}`;
}
export const cableName = c => c.label || c.id;
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
// The text of a cross-face tag: the far end, short enough for the side column.
export function tagText(rack, end) {
  const it = itemOf(rack, end);
  return clip(`→ ${it ? it.label : 'removed'} ${end.path}`, 32);
}

// ── one cable per port (spec §9.3) ──────────────────────────────────────
export function portFree(rack, end, {ignoreId = null} = {}) {
  const k = endKey(end);
  const other = (rack.cables || []).find(c => c.id !== ignoreId && (endKey(c.a) === k || endKey(c.b) === k));
  return other ? {ok: false, reason: `${endName(rack, end)} already has a cable (${cableName(other)}).`} : {ok: true};
}
export function canCable(rack, a, b, opts = {}) {
  if (sameEnd(a, b)) return {ok: false, reason: 'A cable needs two different ports.'};
  for (const e of [a, b]) { const f = portFree(rack, e, opts); if (!f.ok) return f; }
  return {ok: true};
}

// ── edits: each returns a new rack ──────────────────────────────────────
const endOf = e => ({item: e.item, path: e.path, view: e.view === 'rear' ? 'rear' : 'front'});
export function withCable(rack, {a, b, media = '', purpose = '', label = '', length = null}) {
  const cable = {id: nextId(rack.cables || [], 'c'), a: endOf(a), b: endOf(b), media, purpose, label,
                 ...(length ? {length} : {}), route: []};
  return {rack: {...rack, cables: [...(rack.cables || []), cable]}, cable};
}
// `length: null` in the patch removes the length; anything else is merged.
export function updateCable(rack, id, patch) {
  return {...rack, cables: rack.cables.map(c => {
    if (c.id !== id) return c;
    const next = {...c, ...patch};
    if (next.length == null) delete next.length;
    return next;
  })};
}
export const withoutCable = (rack, id) => ({...rack, cables: rack.cables.filter(c => c.id !== id)});
export const cablesOf = (rack, itemId) =>
  (rack.cables || []).filter(c => c.a.item === itemId || c.b.item === itemId);
export const withoutCablesOf = (rack, itemId) =>
  ({...rack, cables: (rack.cables || []).filter(c => c.a.item !== itemId && c.b.item !== itemId)});

// ── length ──────────────────────────────────────────────────────────────
export const UNITS = ['m', 'ft'];
export function parseLength(text, unit = 'm') {
  const t = String(text ?? '').trim();
  if (!t) return {ok: true, length: null};
  const value = Number(t);
  if (!Number.isFinite(value) || value <= 0) return {ok: false, reason: 'Enter a length above 0, or leave it empty.'};
  return {ok: true, length: {value, unit: UNITS.includes(unit) ? unit : 'm', source: 'entered'}};
}
export const lengthText = l => (l && l.value > 0 ? `${l.value} ${l.unit || 'm'}` : '');

// ── the plan cables.js draws ────────────────────────────────────────────
// The rack's cables in the shape drawCables2d takes: an end is [item id,
// path, PANE]. An end whose device is gone is on no pane ('none'), so the
// drawer hangs the other end as an unplugged lead. A cable with no media is
// 'unset', which cables.js colors neutral.
export function cablePlan(rack) {
  const end = e => { const it = itemOf(rack, e); return [e.item, e.path, it ? paneOf(it, e.view) : 'none']; };
  return {links: (rack.cables || []).map(c =>
    ({id: c.id, media: c.media || 'unset', purpose: c.purpose || '', from: end(c.a), to: end(c.b)}))};
}
```

In `site/rack/model.js`, add this above the comment `// READ A FILE, OR REFUSE IT WITH A SENTENCE.`:

```js
// CABLES ARE NEVER DROPPED ON LOAD (spec §9.3: a cable is never silently
// deleted). A cable that names a missing item, an unknown media or no port at
// all is kept and shown as a loose end; what is normalized is only its shape:
// a unique id, two ends, strings where the page reads strings, a length that
// is a positive number, and a route array. Fields this page does not know are
// kept as they are.
const readEnd = e => ({item: String(e?.item ?? ''), path: String(e?.path ?? ''),
                       view: e?.view === 'rear' ? 'rear' : 'front'});
export function readCables(list) {
  const declared = list.map(c => ({id: String(c?.id ?? '')}));
  const out = [];
  const seen = new Set();
  for (const raw of list) {
    const {length: len, ...c} = raw && typeof raw === 'object' ? structuredClone(raw) : {};
    let id = c.id == null ? '' : String(c.id);
    if (!id || seen.has(id)) id = nextId([...declared, ...out], 'c');
    seen.add(id);
    const length = len && Number(len.value) > 0
      ? {...len, value: Number(len.value), unit: len.unit === 'ft' ? 'ft' : 'm', source: String(len.source ?? 'entered')}
      : null;
    out.push({...c, id, a: readEnd(c.a), b: readEnd(c.b), media: String(c.media ?? ''),
              purpose: String(c.purpose ?? ''), label: String(c.label ?? ''),
              ...(length ? {length} : {}), route: Array.isArray(c.route) ? c.route : []});
  }
  return out;
}
```

and in `parseDoc`, replace

```js
      cables: Array.isArray(r.cables) ? structuredClone(r.cables) : [],
```

with

```js
      cables: readCables(Array.isArray(r.cables) ? r.cables : []),
```

- [ ] **Step 4: Run the tests**

Run: `node --test tests/rack/*.test.mjs`
Expected: 100 tests pass (89 before this task, 11 new).

- [ ] **Step 5: Commit**

```bash
git add site/rack/cable-rules.js site/rack/model.js tests/rack/cables.test.mjs tests/rack/model.test.mjs
git commit -m "rack: the cable model - ends, one cable per port, edits, and a loader that never drops a cable

An end is {item, path, view}, the view being the device's own panel;
paneOf says which pane shows it. portFree and canCable refuse a taken port
with a sentence. parseDoc now normalizes each cable's shape and keeps every
one, a missing device or an unknown media included.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The media rules, pure: the vocabulary, the proposal, the mismatch warning, the plug a slot takes, why an end is loose, and the list's filter

**Files:**
- Modify: `site/rack/cable-rules.js` (append)
- Create: `tests/rack/cable-media.test.mjs`

**Interfaces:**
- Produces, from `site/rack/cable-rules.js`:
  - `MEDIA = ['os2', 'om3', 'om4', 'om5', 'cat6', 'cat6a', 'dac', 'aoc']` and `MEDIA_LABELS`, a label for each.
  - `mediaKind(media) → {family, mode}`: `family` is `'fiber'`, `'copper'`, `'dac'`, `'aoc'` or `null`; `mode` is `'single-mode'`, `'multimode'` or `null`.
  - `connectorOf({attrs, portMedia, iface}) → {family, mode}`: what an end's connector is. `attrs` is the seated part's `attrs` (or `null` when nothing is seated), `portMedia` the port's `data-media`, `iface` its slot's `interface`.
  - `proposeMedia(a, b) → string`: a media from two `connectorOf` results, or `''`.
  - `mismatch(media, a, b) → string[]`: warning sentences, `[]` when nothing is known to be wrong.
  - `plugFor(slot) → ref | null`; `plugSeats(path, slots, swaps) → {slotId: plugRef}`; `mergeSeats(swaps, plugs) → swaps` (the item's own win).
  - `holderPath(path) → string | null` (`'slot-2/module/p2'` gives `'slot-2'`); `looseReason(end, facts) → string | null`, where `facts` is `{item, drawing, port, cage, occupied, holder: {path, part} | null}`.
  - `countsBy(cables, field) → Map` in first-seen order; `matches(cable, on) → boolean`, where `on` is `{purpose, media}` and `null` on an axis means it is not narrowing.

- [ ] **Step 1: Write the failing tests**

Create `tests/rack/cable-media.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../../site/rack/cable-rules.js';

const end = (item, path, view = 'front') => ({item, path, view});

test('the media enum is the eight the rulings name, each with a label and a kind', () => {
  assert.deepEqual(C.MEDIA, ['os2', 'om3', 'om4', 'om5', 'cat6', 'cat6a', 'dac', 'aoc']);
  for (const m of C.MEDIA) { assert.ok(C.MEDIA_LABELS[m], m); assert.ok(C.mediaKind(m).family, m); }
  assert.deepEqual(C.mediaKind('os2'), {family: 'fiber', mode: 'single-mode'});
  assert.deepEqual(C.mediaKind('om5'), {family: 'fiber', mode: 'multimode'});
  assert.deepEqual(C.mediaKind('cat6'), {family: 'copper', mode: null});
  assert.deepEqual(C.mediaKind(''), {family: null, mode: null});
  assert.deepEqual(C.mediaKind('os1'), {family: null, mode: null}, 'a media from a newer file is kept, not known');
});

test('connectorOf reads the seated part first, then the port', () => {
  assert.deepEqual(C.connectorOf({attrs: {face: 'lc-duplex', media: 'fiber'}}), {family: 'fiber', mode: null});
  assert.deepEqual(C.connectorOf({attrs: {media: 'sfp', mode: 'single-mode'}}), {family: 'fiber', mode: 'single-mode'});
  assert.deepEqual(C.connectorOf({attrs: {media: 'fiber', mode: 'multi-mode'}}), {family: 'fiber', mode: 'multimode'});
  assert.deepEqual(C.connectorOf({attrs: {'cable-kind': 'dac'}}), {family: 'dac', mode: null});
  assert.deepEqual(C.connectorOf({attrs: {'cable-kind': 'aec'}}), {family: 'dac', mode: null});
  assert.deepEqual(C.connectorOf({attrs: {'cable-kind': 'aoc'}}), {family: 'aoc', mode: null});
  assert.deepEqual(C.connectorOf({attrs: {face: 'cable'}}), {family: 'dac', mode: null});
  assert.deepEqual(C.connectorOf({attrs: {face: 'rj45', media: 'copper'}}), {family: 'copper', mode: null});
  assert.deepEqual(C.connectorOf({attrs: {connector: 'rj45', media: 'rj45'}}), {family: 'copper', mode: null}, 'an RJ45 plug');
  assert.deepEqual(C.connectorOf({attrs: {connector: 'lc', media: 'fiber'}}), {family: 'fiber', mode: null}, 'an LC plug');
  assert.deepEqual(C.connectorOf({attrs: {}, portMedia: 'rj45'}), {family: null, mode: null},
    'a seated part that says nothing is unknown, whatever its cage is');
  assert.deepEqual(C.connectorOf({portMedia: 'rj45', iface: 'rj45'}), {family: 'copper', mode: null});
  assert.deepEqual(C.connectorOf({portMedia: 'rj45-serial'}), {family: 'copper', mode: null});
  assert.deepEqual(C.connectorOf({iface: 'lc-duplex'}), {family: 'fiber', mode: null});
  assert.deepEqual(C.connectorOf({portMedia: 'qsfp28', iface: 'qsfp'}), {family: null, mode: null});
  assert.deepEqual(C.connectorOf(), {family: null, mode: null});
});

test('proposeMedia follows the rulings: sm -> os2, mm -> om4, unstated fiber -> os2, copper -> cat6a, DAC -> dac, unknown -> blank', () => {
  const sm = {family: 'fiber', mode: 'single-mode'}, mm = {family: 'fiber', mode: 'multimode'};
  const fiber = {family: 'fiber', mode: null}, cu = {family: 'copper', mode: null};
  const none = {family: null, mode: null};
  assert.equal(C.proposeMedia(sm, sm), 'os2');
  assert.equal(C.proposeMedia(mm, mm), 'om4');
  assert.equal(C.proposeMedia(fiber, fiber), 'os2');
  assert.equal(C.proposeMedia(fiber, mm), 'om4', 'the end that states a mode decides between fibers');
  assert.equal(C.proposeMedia(cu, cu), 'cat6a');
  assert.equal(C.proposeMedia({family: 'dac', mode: null}, none), 'dac');
  assert.equal(C.proposeMedia(none, {family: 'aoc', mode: null}), 'aoc');
  assert.equal(C.proposeMedia(none, cu), 'cat6a', 'the first end that knows decides');
  assert.equal(C.proposeMedia(cu, mm), 'cat6a');
  assert.equal(C.proposeMedia(none, none), '');
  assert.equal(C.proposeMedia(null, undefined), '');
});

test('a mismatch is a list of warnings, never a refusal', () => {
  const sm = {family: 'fiber', mode: 'single-mode'}, mm = {family: 'fiber', mode: 'multimode'};
  const fiber = {family: 'fiber', mode: null}, cu = {family: 'copper', mode: null};
  const none = {family: null, mode: null};
  assert.deepEqual(C.mismatch('os2', sm, fiber), []);
  assert.deepEqual(C.mismatch('', none, none), []);
  assert.deepEqual(C.mismatch('cat6a', cu, none), [], 'an unknown end is not a mismatch');
  assert.deepEqual(C.mismatch('os2', fiber, cu),
    ['The ends differ: A is fiber, B is copper.', 'OS2 single-mode fiber does not suit end B, which is copper.']);
  assert.deepEqual(C.mismatch('os2', sm, mm), ['The ends differ: A is single-mode, B is multimode.']);
  assert.deepEqual(C.mismatch('cat6', fiber, fiber),
    ['Cat 6 copper does not suit end A, which is fiber.', 'Cat 6 copper does not suit end B, which is fiber.']);
  assert.deepEqual(C.mismatch('dac', {family: 'dac', mode: null}, {family: 'aoc', mode: null}),
    ['The ends differ: A is a DAC, B is an AOC.', 'DAC (twinax) does not suit end B, which is an AOC.']);
  assert.deepEqual(C.mismatch('os1', fiber, cu), ['The ends differ: A is fiber, B is copper.'],
    'an unknown media has no family to disagree with');
});

test('plugFor chooses by the slot\'s interface, and only a plug the slot accepts', () => {
  assert.equal(C.plugFor({interface: 'rj45', accepts: ['generic/rj45-plug@1']}), 'generic/rj45-plug@1');
  assert.equal(C.plugFor({interface: 'lc', accepts: ['common/lc-dust-cap@1', 'generic/lc-plug@2']}), 'generic/lc-plug@2');
  assert.equal(C.plugFor({interface: 'lc-duplex', accepts: ['generic/lc-duplex-plug@2']}), 'generic/lc-duplex-plug@2');
  assert.equal(C.plugFor({interface: 'qsfp', accepts: ['generic/qsfp-lc@2', 'generic/qsfp-cable@1']}), null, 'a cage takes an optic, not a plug');
  assert.equal(C.plugFor({interface: 'mpo', accepts: ['generic/mpo12-plug@1']}), null, 'no known plug: not an error');
  assert.equal(C.plugFor({interface: 'rj45', accepts: []}), null);
  assert.equal(C.plugFor(null), null);
});

test('plugSeats seats the port\'s own plug, or one in each bore of what the port holds', () => {
  const jack = {id: 'mgmt-eth', interface: 'rj45', accepts: ['generic/rj45-plug@1']};
  const cage = {id: 'port-1', interface: 'qsfp', accepts: ['generic/qsfp-lc@2']};
  const bore = (id) => ({id, interface: 'lc', accepts: ['common/lc-dust-cap@1', 'generic/lc-plug@2']});
  const slots = [jack, cage, bore('port-1-occupant/tx'), bore('port-1-occupant/rx'),
                 {id: 'port-1-occupant/tx-occupant/boot', interface: 'lc', accepts: ['generic/lc-plug@2']},
                 bore('port-10-occupant/tx'),
                 {id: 'bay-1/module/lc1', interface: 'lc-duplex', accepts: ['generic/lc-duplex-plug@2'], bores: ['1', '2']},
                 bore('bay-1/module/lc1/1'), bore('bay-1/module/lc1/2')];
  assert.deepEqual(C.plugSeats('mgmt-eth', slots), {'mgmt-eth': 'generic/rj45-plug@1'});
  assert.deepEqual(C.plugSeats('port-1', slots),
    {'port-1-occupant/tx': 'generic/lc-plug@2', 'port-1-occupant/rx': 'generic/lc-plug@2'},
    'the optic\'s two bores, not port-10\'s and not a slot further down');
  assert.deepEqual(C.plugSeats('bay-1/module/lc1', slots), {'bay-1/module/lc1': 'generic/lc-duplex-plug@2'},
    'a duplex adapter takes one duplex plug, not one per bore');
  assert.deepEqual(C.plugSeats('port-2', slots), {}, 'an empty cage gets nothing');
  assert.deepEqual(C.plugSeats('port-1', slots, {'port-1-occupant/tx': 'common/lc-dust-cap@1'}),
    {'port-1-occupant/rx': 'generic/lc-plug@2'}, 'a bore the user capped is the user\'s');
  assert.deepEqual(C.plugSeats('mgmt-eth', slots, {'mgmt-eth': null}), {}, 'a jack the user emptied stays empty');
  assert.deepEqual(C.plugSeats('bay-1/module/lc1', slots, {'bay-1/module/lc1/2': 'common/lc-dust-cap@1'}), {},
    'an adapter with a bore the user filled is left alone');
});

test('mergeSeats lays the item\'s own swaps over the plugs and changes neither', () => {
  const swaps = {'port-1': 'generic/qsfp-lc@2', 'mgmt-eth': null};
  const plugs = {'port-1-occupant/tx': 'generic/lc-plug@2', 'mgmt-eth': 'generic/rj45-plug@1'};
  assert.deepEqual(C.mergeSeats(swaps, plugs),
    {'port-1': 'generic/qsfp-lc@2', 'mgmt-eth': null, 'port-1-occupant/tx': 'generic/lc-plug@2'});
  assert.deepEqual(swaps, {'port-1': 'generic/qsfp-lc@2', 'mgmt-eth': null});
  assert.deepEqual(C.mergeSeats(undefined, undefined), {});
});

test('looseReason says why an end does not land, or null when it does', () => {
  const ok = {item: true, drawing: true, port: true, cage: false, occupied: false, holder: null};
  assert.equal(C.looseReason(end('i2', 'mgmt-eth'), ok), null);
  assert.equal(C.looseReason(end('i2', 'port-1'), {...ok, cage: true, occupied: true}), null);
  assert.equal(C.looseReason(end('i2', 'port-2'), {...ok, cage: true}), 'port-2 holds no optic');
  assert.equal(C.looseReason(end('i1', 'slot-2/module/p2'),
    {...ok, port: false, holder: {path: 'slot-2', part: 'A9K-24X10GE'}}), 'slot-2 holds A9K-24X10GE, which has no port p2');
  assert.equal(C.looseReason(end('i1', 'slot-2/module/p2'), {...ok, port: false, holder: {path: 'slot-2', part: null}}),
    'slot-2 is empty');
  assert.equal(C.looseReason(end('i2', 'port-99'), {...ok, port: false}), 'port-99 is not on this panel');
  assert.equal(C.looseReason(end('i2', 'port-1'), {item: true, drawing: false}), 'this panel has no drawing');
  assert.equal(C.looseReason(end('i9', 'port-1'), {item: false}), 'the device was removed');
  assert.equal(C.looseReason(end('i9', 'port-1'), undefined), 'the device was removed');
  assert.equal(C.holderPath('slot-2/module/p2'), 'slot-2');
  assert.equal(C.holderPath('slot-1/module/ppm-1/module/x0'), 'slot-1/module/ppm-1');
  assert.equal(C.holderPath('port-1'), null);
});

test('countsBy and matches drive the list\'s two filters', () => {
  const cables = [{media: 'os2', purpose: 'uplink'}, {media: 'cat6a', purpose: 'management'},
                  {media: 'os2', purpose: ''}];
  assert.deepEqual([...C.countsBy(cables, 'media')], [['os2', 2], ['cat6a', 1]]);
  assert.deepEqual([...C.countsBy(cables, 'purpose')], [['uplink', 1], ['management', 1], ['', 1]]);
  assert.deepEqual([...C.countsBy(undefined, 'media')], []);
  const n = on => cables.filter(c => C.matches(c, on)).length;
  assert.equal(n({purpose: null, media: null}), 3);
  assert.equal(n({purpose: null, media: 'os2'}), 2);
  assert.equal(n({purpose: 'uplink', media: 'os2'}), 1);
  assert.equal(n({purpose: '', media: null}), 1, 'the empty purpose is a value of its own');
  assert.equal(n(), 3);
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `node --test tests/rack/cable-media.test.mjs`
Expected: FAIL, 9 tests, the first with `C.MEDIA` undefined (`deepEqual(undefined, [...])`) and the rest with `C.connectorOf is not a function` and the like.

- [ ] **Step 3: Append the rules**

Append to `site/rack/cable-rules.js`:

```js
// ── media ───────────────────────────────────────────────────────────────
export const MEDIA = ['os2', 'om3', 'om4', 'om5', 'cat6', 'cat6a', 'dac', 'aoc'];
export const MEDIA_LABELS = {
  os2: 'OS2 single-mode fiber', om3: 'OM3 multimode fiber', om4: 'OM4 multimode fiber',
  om5: 'OM5 multimode fiber', cat6: 'Cat 6 copper', cat6a: 'Cat 6A copper',
  dac: 'DAC (twinax)', aoc: 'AOC (active optical)'};

const FIBER_SM = {family: 'fiber', mode: 'single-mode'}, FIBER_MM = {family: 'fiber', mode: 'multimode'};
const KIND = {os2: FIBER_SM, om3: FIBER_MM, om4: FIBER_MM, om5: FIBER_MM,
              cat6: {family: 'copper', mode: null}, cat6a: {family: 'copper', mode: null},
              dac: {family: 'dac', mode: null}, aoc: {family: 'aoc', mode: null}};
const UNKNOWN = {family: null, mode: null};
// What a media IS: its connector family (fiber, copper, dac, aoc) and, for
// fiber, its mode. A media this page does not know has neither.
export const mediaKind = media => KIND[media] || UNKNOWN;

// What an END's connector is, from what is known about it: the attrs of the
// part seated in the port (an optic, a DAC end - null when nothing is), the
// port's own data-media, and its slot's interface. Same shape as mediaKind.
export function connectorOf({attrs = null, portMedia = '', iface = ''} = {}) {
  const a = attrs || {};
  const kind = String(a['cable-kind'] || '');
  if (kind === 'aoc') return {family: 'aoc', mode: null};
  if (kind || a.face === 'cable') return {family: 'dac', mode: null};
  const mode = /^single/.test(a.mode || '') ? 'single-mode' : /^multi/.test(a.mode || '') ? 'multimode' : null;
  const face = String(a.face || a.connector || '');      // an optic states `face`, a plug `connector`
  if (a.media === 'fiber' || mode || /^(lc|sc|mpo)/.test(face)) return {family: 'fiber', mode};
  if (a.media === 'copper' || face === 'rj45') return {family: 'copper', mode: null};
  if (attrs) return UNKNOWN;                    // something is seated, and it does not say
  if (/^rj45/.test(portMedia) || iface === 'rj45') return {family: 'copper', mode: null};
  if (/^(lc|sc|mpo)/.test(iface) || portMedia === 'fiber') return {family: 'fiber', mode: null};
  return UNKNOWN;
}

// THE MEDIA A NEW CABLE IS OFFERED, from its two ends: single-mode fiber ->
// os2; multimode -> om4; fiber that states no mode -> os2; copper -> cat6a;
// a DAC or AOC end -> itself; nothing known -> '', and the user picks. The
// first end that knows decides, unless it is fiber of no stated mode and the
// other is fiber that states one.
export function proposeMedia(a, b) {
  const known = [a, b].filter(e => e && e.family);
  if (!known.length) return '';
  const pick = known.find(e => e.family === 'fiber' && e.mode && known[0].family === 'fiber') || known[0];
  if (pick.family === 'fiber') return pick.mode === 'multimode' ? 'om4' : 'os2';
  return {copper: 'cat6a', dac: 'dac', aoc: 'aoc'}[pick.family] || '';
}

const NAMED = {fiber: 'fiber', copper: 'copper', dac: 'a DAC', aoc: 'an AOC'};
// A MISMATCH IS A WARNING, never a refusal (spec §9.3): the sentences to show
// beside the media field, or [] when nothing is known to be wrong.
export function mismatch(media, a, b) {
  const out = [];
  const fa = a?.family, fb = b?.family;
  if (fa && fb && fa !== fb) out.push(`The ends differ: A is ${NAMED[fa]}, B is ${NAMED[fb]}.`);
  if (fa === 'fiber' && fb === 'fiber' && a.mode && b.mode && a.mode !== b.mode)
    out.push(`The ends differ: A is ${a.mode}, B is ${b.mode}.`);
  const m = mediaKind(media);
  if (m.family) for (const [k, e] of [['A', a], ['B', b]])
    if (e?.family && e.family !== m.family)
      out.push(`${MEDIA_LABELS[media]} does not suit end ${k}, which is ${NAMED[e.family]}.`);
  return out;
}

// ── plugs: derived, never stored ────────────────────────────────────────
// The plug a slot takes, by its interface, when the slot accepts it. A slot
// with no known plug here (an MPO adapter, a cage - which takes an optic or
// a DAC, not a plug) has none: its cable ends at the port's own center, or
// on the cable point a seated DAC end carries. That is not an error.
const PLUGS = {lc: 'generic/lc-plug@2', 'lc-duplex': 'generic/lc-duplex-plug@2', rj45: 'generic/rj45-plug@1'};
export function plugFor(slot) {
  const p = PLUGS[slot?.interface];
  return p && (slot.accepts || []).includes(p) ? p : null;
}
// The seats a cabled end at `path` adds, as {slotId: plugRef}: the port's own
// slot when it takes a plug (an RJ45 jack, a duplex adapter), else the slots
// one step under what is seated in it (an optic's tx and rx bores). `slots`
// is the face's slot list (swap.js faceCages); a slot the user's own `swaps`
// already speak for - or, for an adapter, any of its bores - is left alone.
export function plugSeats(path, slots, swaps = {}) {
  const own = k => Object.hasOwn(swaps || {}, k);
  const free = s => !own(s.id) && !(s.bores || []).some(b => own(`${s.id}/${b}`));
  const seat = list => Object.fromEntries(list.filter(s => plugFor(s) && free(s)).map(s => [s.id, plugFor(s)]));
  const exact = slots.filter(s => s.id === path);
  if (exact.some(plugFor)) return seat(exact);
  const under = `${path}-occupant/`;
  return seat(slots.filter(s => s.id.startsWith(under) && !s.id.slice(under.length).includes('/')));
}
// The swaps a face is drawn with: the item's own, over the derived plugs.
export const mergeSeats = (swaps, plugs) => ({...(plugs || {}), ...(swaps || {})});

// ── loose ends (spec §9.3) ──────────────────────────────────────────────
// The bay a card port's path sits in: 'slot-2/module/p2' -> 'slot-2'.
export function holderPath(path) {
  const i = String(path).lastIndexOf('/module/');
  return i < 0 ? null : path.slice(0, i);
}
// WHY AN END DOES NOT LAND, from what its panel has now - or null when it
// lands. `facts` is what cable-plugs.js read off the face:
//   {item, drawing, port, cage, occupied, holder: {path, part} | null}
// item: the device is still in the rack; drawing: its panel has one; port: a
// port is drawn at the end's path; cage: that port takes an optic; occupied:
// something is seated in it; holder: the bay above the path and what it holds.
export function looseReason(end, facts) {
  if (!facts || !facts.item) return 'the device was removed';
  if (!facts.drawing) return 'this panel has no drawing';
  if (!facts.port) {
    const h = facts.holder;
    if (!h) return `${end.path} is not on this panel`;
    const leaf = end.path.slice(h.path.length + '/module/'.length);
    return h.part ? `${h.path} holds ${h.part}, which has no port ${leaf}` : `${h.path} is empty`;
  }
  if (facts.cage && !facts.occupied) return `${end.path} holds no optic`;
  return null;
}

// ── the list's filter (stage 5's two axes) ──────────────────────────────
// {value -> count} for a cable field, in first-seen order.
export function countsBy(cables, field) {
  const m = new Map();
  for (const c of cables || []) m.set(c[field], (m.get(c[field]) || 0) + 1);
  return m;
}
// `on` is {purpose, media}; null on an axis means it is not narrowing.
export const matches = (cable, on = {}) =>
  (on.purpose == null || cable.purpose === on.purpose) && (on.media == null || cable.media === on.media);
```

- [ ] **Step 4: Run the tests**

Run: `node --test tests/rack/*.test.mjs`
Expected: 109 tests pass (100 before this task, 9 new).

- [ ] **Step 5: Commit**

```bash
git add site/rack/cable-rules.js tests/rack/cable-media.test.mjs
git commit -m "rack: the media rules - eight media, a proposal, a mismatch warning, plugs by interface, loose-end reasons

All pure. A mismatch is a list of sentences, never a refusal. A slot's plug
is chosen by its interface (lc, lc-duplex, rj45) and only if the slot
accepts it; a cage or an MPO adapter gets none. looseReason says why an end
does not land from what its panel has now.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 4: Derived plugs: a cabled end is drawn with the plug its port takes, and nothing is stored

**Files:**
- Create: `site/rack/cable-plugs.js`
- Modify: `site/rack-page.js` (imports, `S`, `render()`, the probe), `check-browser.py` (add `CABLE_FIXTURE`, `PLUGS_JS`, `check_rack_cable_plugs`)

**Interfaces:**
- Consumes: `configuredFace`, `components`, `findComp`, `DIST` from `site/rack/face.js`; `jdist` from `vendor/dist.js`; `faceCages` from `vendor/swap.js`; `endKey`, `plugSeats`, `connectorOf`, `looseReason`, `holderPath`, `mergeSeats` from `site/rack/cable-rules.js` (Tasks 2 and 3).
- Produces: `site/rack/cable-plugs.js` exports `cableFacts(rack, extra = []) → Promise<{seats, ends}>`:
  - `seats` is `{[itemId]: {[slotId]: plugRef}}`, the derived plugs of every cabled end;
  - `ends` is a `Map` from `endKey(end)` to `{facts, info, reason}`: `facts` as `looseReason` reads them, `info` a `connectorOf` result, `reason` the loose-end sentence or `null` when the end lands;
  - `extra` is a list of ends that are not cabled yet; they are read into `ends` and get no plugs.
- Produces: `S.cableFacts` in `site/rack-page.js` holds the last render's result. `window.__rack.cableFacts()` (with `?probe=1`) returns `{seats, reasons}`, where `reasons` is `{[endKey]: string | null}`.
- Produces: `CABLE_FIXTURE` and `PLUGS_JS` in `check-browser.py`, used by every later cable check.

- [ ] **Step 1: Write the failing check**

In `check-browser.py`, before `def main():`, add:

```python
# THE CABLE FIXTURE: the export fixture's rack with the cases cabling has to
# get right - a port on a seated card that holds an optic (core-1's
# slot-2/module/p0), an optic port (leaf-1's port-1), a copper port
# (leaf-1's mgmt-eth), a cross-face pair (leaf-1 shows its front in the front
# pane, the rear-mounted demarc shows its front in the rear pane), an empty
# cage (leaf-1's port-2), and two devices with one ref (the two tm-280
# demarcs, each cabled on the same port path).
#   c1  leaf-1 port-1   -> core-1 slot-2/module/p0   fiber, both in the front pane
#   c2  leaf-1 mgmt-eth -> demarc (U14) port-2-1     copper, front pane to rear pane
#   c3  leaf-1 port-2   -> demarc (U20) port-2-1     end A is an empty cage: a loose end
CABLE_FIXTURE = {
    "format": "portrayal-rack", "version": 1, "id": "doc-cable-fixture",
    "racks": [{
        "id": "r1", "name": "Cable test",
        "frame": {"kind": "four-post", "heightRU": 24, "numbering": "bottom-up",
                  "holes": {"style": "square", "thread": None},
                  "railDepth": 740, "usableDepth": 1000, "ref": None},
        "items": [
            {"id": "i1", "ref": "asr-9006", "cfg": "base", "label": "core-1", "ru": 2, "face": "front",
             "turned": False, "swaps": {"slot-2": "cisco/a9k-16x100ge-tr@1",
                                        "slot-2/module/p0": "generic/qsfp-lc@2"}, "fields": {}},
            {"id": "i2", "ref": "as7726-32x", "cfg": "ac-f2b", "label": "leaf-1", "ru": 14, "face": "front",
             "turned": False, "swaps": {"port-1": "generic/qsfp-lc@2"}, "fields": {}},
            {"id": "i3", "ref": "tm-280", "cfg": "base", "label": "demarc", "ru": 14, "face": "rear",
             "turned": False, "swaps": {}, "fields": {}},
            {"id": "i4", "ref": "tm-280", "cfg": "base", "label": "demarc", "ru": 20, "face": "rear",
             "turned": False, "swaps": {}, "fields": {}},
        ],
        "zeroU": [],
        "cables": [
            {"id": "c1", "a": {"item": "i2", "path": "port-1", "view": "front"},
             "b": {"item": "i1", "path": "slot-2/module/p0", "view": "front"},
             "media": "os2", "purpose": "uplink", "label": "A1",
             "length": {"value": 2, "unit": "m", "source": "entered"}, "route": []},
            {"id": "c2", "a": {"item": "i2", "path": "mgmt-eth", "view": "front"},
             "b": {"item": "i3", "path": "port-2-1", "view": "front"},
             "media": "cat6a", "purpose": "management", "label": "", "route": []},
            {"id": "c3", "a": {"item": "i2", "path": "port-2", "view": "front"},
             "b": {"item": "i4", "path": "port-2-1", "view": "front"},
             "media": "os2", "purpose": "uplink", "label": "", "route": []},
        ]}]}

# How many seated plugs of each kind one item's panel shows in one pane.
PLUGS_JS = """([pane, item]) => {
  const g = document.querySelector(`svg[data-pane="${pane}"] [data-item-id="${item}"][data-panel]`);
  const n = ref => (g ? g.querySelectorAll(`[data-ref^="${ref}"]`).length : -1);
  return {lc: n('generic/lc-plug@2'), rj45: n('generic/rj45-plug@1')};
}"""


@extra("rack.html: a cabled end seats the plug its port takes, drawn but never stored")
def check_rack_cable_plugs(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    plugs = lambda pane, item: page.evaluate(PLUGS_JS, [pane, item])

    # No cables, no plugs: the export fixture draws exactly as before.
    open_fixture(page, base)
    if page.evaluate("() => typeof window.__rack.cableFacts") != "function":
        return bad + ["cable plugs: window.__rack has no cableFacts probe"]
    for pane, item in (("front", "i1"), ("front", "i2"), ("rear", "i3"), ("rear", "i4")):
        got = plugs(pane, item)
        if got != {"lc": 0, "rj45": 0}:
            bad.append(f"cable plugs: with no cables, {item} shows plugs {got}")

    open_fixture(page, base, CABLE_FIXTURE)
    wait_sel(page, "cable plugs: leaf-1's copper plug",
             'svg[data-pane="front"] [data-item-id="i2"][data-panel] [data-ref^="generic/rj45-plug@1"]')
    wait_sel(page, "cable plugs: the far demarc's copper plug",
             'svg[data-pane="rear"] [data-item-id="i4"][data-panel] [data-ref^="generic/rj45-plug@1"]')
    # An LC plug in each bore of each cabled optic, an RJ45 plug in each cabled
    # jack, and nothing in the empty cage.
    for pane, item, want in (("front", "i2", {"lc": 2, "rj45": 1}), ("front", "i1", {"lc": 2, "rj45": 0}),
                             ("rear", "i3", {"lc": 0, "rj45": 1}), ("rear", "i4", {"lc": 0, "rj45": 1})):
        got = plugs(pane, item)
        if got != want:
            bad.append(f"cable plugs: {item} on the {pane} shows {got}, expected {want}")
    if page.query_selector('svg[data-pane="front"] [data-item-id="i2"][data-panel] [data-path="port-2-occupant"]'):
        bad.append("cable plugs: the empty cage port-2 was given an occupant")

    # Derived, not stored: the document's swaps are the file's own.
    swaps = page.evaluate("() => window.__rack.doc().racks[0].items.map(i => i.swaps)")
    want_swaps = [i["swaps"] for i in CABLE_FIXTURE["racks"][0]["items"]]
    if swaps != want_swaps:
        bad.append(f"cable plugs: plugs were written into item.swaps: {swaps}")

    facts = page.evaluate("() => window.__rack.cableFacts()")
    want_seats = {
        "i1": {"slot-2/module/p0-occupant/tx": "generic/lc-plug@2", "slot-2/module/p0-occupant/rx": "generic/lc-plug@2"},
        "i2": {"port-1-occupant/tx": "generic/lc-plug@2", "port-1-occupant/rx": "generic/lc-plug@2",
               "mgmt-eth": "generic/rj45-plug@1"},
        "i3": {"port-2-1": "generic/rj45-plug@1"},
        "i4": {"port-2-1": "generic/rj45-plug@1"}}
    if facts["seats"] != want_seats:
        bad.append(f"cable plugs: the derived seats are {facts['seats']}")
    want_reasons = {"i2|front|port-1": None, "i1|front|slot-2/module/p0": None, "i2|front|mgmt-eth": None,
                    "i3|front|port-2-1": None, "i2|front|port-2": "port-2 holds no optic",
                    "i4|front|port-2-1": None}
    if facts["reasons"] != want_reasons:
        bad.append(f"cable plugs: the loose-end reasons are {facts['reasons']}")

    # The BOM reads item.swaps, so it lists the two optics and no plug.
    _, rows, _ = read_csv(export_file(page, "bom"))
    if any(r["section"] == "Plugs" for r in rows):
        bad.append("cable plugs: the BOM lists a plug, and a derived plug is not a part of the rack")
    optics = next((int(r["qty"]) for r in rows if r["section"] == "Optics" and r["ref"] == "generic/qsfp-lc@2"), None)
    if optics != 2:
        bad.append(f"cable plugs: the BOM counts {optics} QSFP optics, expected 2")
    return bad
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `python3 check-browser.py --only check_rack_cable_plugs`
Expected: FAIL, `cable plugs: window.__rack has no cableFacts probe`.

- [ ] **Step 3: Write the module**

Create `site/rack/cable-plugs.js`:

```js
// WHAT EACH CABLED END HAS, READ OFF ITS PANEL - and the plugs that follow.
//
// PLUGS ARE DERIVED, NEVER STORED (Phase 2 ruling 1). A cable lands on a
// connector: an LC plug in each bore of an optic, a duplex plug in a
// cassette's adapter, an RJ45 plug in a copper jack. The file records only
// the cable, {item, path, view} at each end; the plugs are worked out here
// from the cables and laid over the item's swaps when the page draws
// (cable-rules.js mergeSeats). Nothing is written into item.swaps, so
// Explorer, the BOM and the DCIM exports never see a plug the user did not
// seat.
//
// The slots a face has depend on what is seated in it (an optic's bores
// exist only while the optic does), so this needs the face itself: the
// item's panel as configured by its OWN swaps, parsed, and swap.js's
// faceCages over it. The rules - which plug a slot takes, why an end is
// loose, what its connector is - are cable-rules.js's, and node tests them.

import {configuredFace, components, findComp, DIST} from './face.js';
import {jdist} from '../../vendor/dist.js';
import {faceCages} from '../../vendor/swap.js';
import {endKey, plugSeats, connectorOf, looseReason, holderPath} from './cable-rules.js';

const at = (root, path) => root.querySelector(`[data-path="${CSS.escape(path)}"]`);
const refOf = el => (el?.getAttribute('data-ref') || '').split(':')[0];
// A part as it is named in a reason: its model, or its ref's name in capitals.
function partName(list, ref) {
  if (!ref) return 'a part';
  return findComp(list, ref)?.attrs?.model || ref.split('/').pop().split('@')[0].toUpperCase();
}

// One panel of one item, as its own swaps configure it: the parsed face and
// every slot on it. null when that panel has no compiled drawing.
async function readPanel(item, view, list) {
  const face = await configuredFace({ref: item.ref, cfg: item.cfg, view,
                                     swaps: item.swaps || {}, fields: item.fields || {}});
  if (!face) return null;
  const root = new DOMParser().parseFromString(face.text, 'image/svg+xml').documentElement;
  const idx = await jdist(`${DIST}${item.ref}.configs.json`).catch(() => null);
  return {root, slots: faceCages(root, idx?.cages?.[view] || [], x => findComp(list, x))};
}

// One end against its panel: the facts looseReason reads, the connector
// mismatch and proposeMedia read, and the plug seats the end adds.
function readEnd(end, item, panel, list) {
  if (!item) return {facts: {item: false}, info: connectorOf(), seats: {}};
  if (!panel) return {facts: {item: true, drawing: false}, info: connectorOf(), seats: {}};
  const {root, slots} = panel;
  const port = at(root, end.path);
  const isPort = !!port && port.getAttribute('data-class') === 'port';
  const slot = slots.find(s => s.id === end.path) || null;
  const occupant = at(root, `${end.path}-occupant`);
  const bay = holderPath(end.path);
  const card = bay ? at(root, `${bay}/module`) : null;
  const facts = {item: true, drawing: true, port: isPort, cage: slot?.kind === 'cage', occupied: !!occupant,
                 holder: bay ? {path: bay, part: card ? partName(list, refOf(card)) : null} : null};
  const info = connectorOf({attrs: occupant ? (findComp(list, refOf(occupant))?.attrs || {}) : null,
                            portMedia: port?.getAttribute('data-media') || '', iface: slot?.interface || ''});
  return {facts, info, seats: isPort ? plugSeats(end.path, slots, item.swaps || {}) : {}};
}

// The last answer, kept: render() asks on every redraw, and most redraws (a
// selection, a zoom) change neither the cables nor what is seated.
let memo = {key: '', value: null};

// EVERY CABLED END OF THE RACK, read once per redraw:
//   seats  {itemId: {slotId: plugRef}}   the derived plugs, per item
//   ends   Map(endKey -> {facts, info, reason})   reason is null when the end lands
// `extra` ends (the two ends of a cable still being made) are read as well,
// for the form's media proposal and warning; they get no plugs.
export async function cableFacts(rack, extra = []) {
  const cabled = (rack.cables || []).flatMap(c => [c.a, c.b]);
  const ends = [...cabled, ...extra];
  const out = {seats: {}, ends: new Map()};
  if (!ends.length) return out;
  const items = new Map(rack.items.map(i => [i.id, i]));
  const key = JSON.stringify([cabled.map(endKey), extra.map(endKey),
    [...new Set(ends.map(e => e.item))].map(id => items.get(id) || null)
      .map(i => i && [i.id, i.ref, i.cfg, i.swaps, i.fields])]);
  if (memo.key === key) return memo.value;
  const list = await components();
  const panels = new Map();
  const panelOf = (item, view) => {
    const k = `${item.id}|${view}`;
    if (!panels.has(k)) panels.set(k, readPanel(item, view, list));
    return panels.get(k);
  };
  const hasCable = new Set(cabled.map(endKey));
  for (const end of ends) {
    const k = endKey(end);
    if (out.ends.has(k)) continue;
    const item = items.get(end.item) || null;
    const got = readEnd(end, item, item ? await panelOf(item, end.view) : null, list);
    out.ends.set(k, {facts: got.facts, info: got.info, reason: looseReason(end, got.facts)});
    if (item && hasCable.has(k)) out.seats[item.id] = {...(out.seats[item.id] || {}), ...got.seats};
  }
  // An empty component index is a fetch that failed (face.js asks again next
  // time), so an answer built on it is not kept.
  if (list.length) memo = {key, value: out};
  return out;
}
```

- [ ] **Step 4: Draw with the overlay**

In `site/rack-page.js`:

Imports. Replace

```js
import {exportStatus} from './rack/export-data.js';
```

with

```js
import {exportStatus} from './rack/export-data.js';
import {cableFacts} from './rack/cable-plugs.js';
import {mergeSeats} from './rack/cable-rules.js';
```

State. Replace

```js
  zoom: loadZoom(), svgs: [], undo: null, mode: loadMode(), scene3d: null, scene3dRack: null, camera3d: null,
  pick: {query: '', vendor: 'all', fitsOnly: true, device: null, cfgByRef: {}}};
```

with

```js
  zoom: loadZoom(), svgs: [], undo: null, mode: loadMode(), scene3d: null, scene3dRack: null, camera3d: null,
  // What the last redraw read off the cabled ends: the derived plugs, and why an end is loose.
  cableFacts: {seats: {}, ends: new Map()},
  pick: {query: '', vendor: 'all', fitsOnly: true, device: null, cfgByRef: {}}};
```

`render()`. Replace

```js
  const items = itemsWithU(r, chassisOf);
  const selectedId = S.sel?.kind === 'item' || S.sel?.kind === 'move' ? S.sel.id : null;
  let front, rear;
  try {
    [front, rear] = await Promise.all(['front', 'rear'].map(view => drawElevation({
```

with

```js
  const selectedId = S.sel?.kind === 'item' || S.sel?.kind === 'move' ? S.sel.id : null;
  let front, rear, facts;
  try {
    // PLUGS ARE DERIVED, NEVER STORED: a cabled end is drawn with the plug its
    // port takes, laid over the item's own swaps for this drawing only. The
    // document, Explorer and the exports keep reading item.swaps.
    facts = await cableFacts(r);
    const items = itemsWithU(r, chassisOf).map(it => (facts.seats[it.id]
      ? {...it, swaps: mergeSeats(it.swaps, facts.seats[it.id])} : it));
    [front, rear] = await Promise.all(['front', 'rear'].map(view => drawElevation({
```

Still in `render()`, keep what was read for the side panel and the probe. There are two `if (mine !== S.draws) return;` lines; this is the second, the one followed by `replaceChildren`. Replace

```js
  if (mine !== S.draws) return;
  $('paneFront').replaceChildren(front);
```

with

```js
  if (mine !== S.draws) return;
  S.cableFacts = facts;
  $('paneFront').replaceChildren(front);
```

The probe, at the end of the file. Replace

```js
  window.__rack = {ready, doc: () => S.doc, flush: () => S.save.flush(), scene: () => S.scene3d};
```

with

```js
  window.__rack = {ready, doc: () => S.doc, flush: () => S.save.flush(), scene: () => S.scene3d,
    // The last redraw's cable facts, as plain data: the derived plug seats per
    // item, and each cabled end's loose-end reason (null when it lands).
    cableFacts: () => ({seats: S.cableFacts.seats,
      reasons: Object.fromEntries([...S.cableFacts.ends].map(([k, v]) => [k, v.reason]))})};
```

The overlay is per item, not per panel: `drawElevation` hands each panel of an item the same swaps, and a seat whose slot is not on that panel is ignored, as a card swap already is on the panel that does not show the card.

- [ ] **Step 5: Run the check, and the checks the redraw can reach**

Run: `python3 check-browser.py --only check_rack_cable_plugs,check_rack_faces,check_rack_place,check_rack_export_bom`
Expected: all four `ok`.

- [ ] **Step 6: Commit**

```bash
git add site/rack/cable-plugs.js site/rack-page.js check-browser.py
git commit -m "rack: a cabled end is drawn with the plug its port takes - derived at draw time, never stored

cable-plugs.js reads each cabled end off its configured face: which slots
it has, what is seated, and so which plugs follow and whether the end can
land at all. The page lays the plugs over the item's swaps for the drawing
only; item.swaps, Explorer and the BOM never see them.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Cables drawn in both panes; the panes widen together when there are cables; zoom intact

**Files:**
- Modify: `site/rack/cables.js` (an `ends` option on `drawCables2d`; media colors)
- Create: `site/rack/cable-view.js`
- Modify: `site/rack-page.js` (import, `render()`), `site/rack/rack.css` (cable and tag styles), `check-browser.py` (add `open_cabled`, `PANES_JS`, `check_cable_colors`, `check_rack_cables_drawn`)

**Interfaces:**
- Consumes: `drawCables2d`, `plugAt` from `site/rack/cables.js` (Task 1); `cablePoints` from `vendor/relief.js`; `cablePlan`, `endKey`, `endName`, `tagText` from `site/rack/cable-rules.js` (Task 2); `S.cableFacts` (Task 4); `CABLE_FIXTURE` (Task 4).
- Produces, in `site/rack/cables.js`: `drawCables2d(svg, plan, view, {…, ends = ends2d})`, where `ends(svg, dev, path)` returns the end's connector points or `null`; and `COLORS` gains `om3`, `om4`, `om5`, `cat6`, `cat6a`, `dac`, `aoc`, `unset`. With no `ends` passed, and for every media and purpose the showcase uses, nothing changes.
- Produces, from `site/rack/cable-view.js`:
  - `ROOM = 260`;
  - `widenForCables(svg)`: widens one pane's viewBox by `ROOM` (front to the right, rear to the left) and 40 below, and records the old one in `svg.dataset.baseBox`;
  - `portBox(svg, itemId, path) → {x, y, w, h} | null`, in the pane's user space;
  - `drawRackCables(svg, rack, reasons) → records`, where `reasons` is a `Map` from `endKey` to the loose-end sentence or `null`. Every cable group and every tag it draws carries `data-cable-id="<cable id>"`.
- Produces, in `check-browser.py`: `open_cabled(page, base, fixture=None)` and `PANES_JS`.

- [ ] **Step 1: Write the failing checks**

In `check-browser.py`, before `def main():`, add:

```python
def open_cabled(page, base, fixture=None):
    open_fixture(page, base, fixture or CABLE_FIXTURE)
    wait_sel(page, "cable fixture: the rear pane's cables", 'svg[data-pane="rear"] [data-cable-id]')
    wait_sel(page, "cable fixture: the front pane's cables", 'svg[data-pane="front"] [data-cable-id]')


# Both panes as drawn: the viewBox, the rendered box, U1's hit rectangle (the
# shared U scale), and every cable group and tag.
PANES_JS = """() => {
  const box = e => { const r = e.getBoundingClientRect(); return {x: r.x, w: r.width, h: r.height, top: r.top, bottom: r.bottom}; };
  return Object.fromEntries(['front', 'rear'].map(p => {
    const svg = document.querySelector(`svg[data-pane="${p}"]`);
    return [p, {
      vb: svg.getAttribute('viewBox').split(/\\s+/).map(Number),
      box: box(svg),
      u1: box(svg.querySelector('rect.rk-u[data-u="1"]')),
      layers: svg.querySelectorAll('[data-cables], [data-cable-tags]').length,
      cables: [...svg.querySelectorAll('[data-cables] [data-cable]')].map(g => ({
        id: g.dataset.cableId || null, lead: g.dataset.looseLead || null,
        color: [...g.children].filter(n => n.tagName === 'path').pop()?.getAttribute('stroke') || null,
        box: box(g)})),
      tags: [...svg.querySelectorAll('[data-cable-tags] [data-cable-tag]')].map(t => ({
        id: t.dataset.cableId || null, text: t.querySelector('text').textContent,
        loose: t.classList.contains('not-connected'), why: t.querySelector('title')?.textContent || ''})),
    }];
  }));
}"""


@extra("cables.js colors the Rack Builder's media without changing a showcase color")
def check_cable_colors(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    page.goto(f"{base}/index.html", wait_until="load")
    got = page.evaluate("""async () => {
      const {colorOf} = await import('/site/rack/cables.js');
      const links = [['os2', 'uplink'], ['copper', 'server'], ['copper', 'management'], ['copper', 'other'],
                     ['om3', ''], ['om4', ''], ['om5', ''], ['cat6', ''], ['cat6a', ''], ['dac', ''], ['aoc', ''],
                     ['unset', ''], ['something-else', '']];
      return links.map(([media, purpose]) => [media, purpose, colorOf({media, purpose})]);
    }""")
    want = [["os2", "uplink", "#e8c547"], ["copper", "server", "#5aa7ff"], ["copper", "management", "#9aa3ad"],
            ["copper", "other", "#5aa7ff"],
            ["om3", "", "#2bb3c8"], ["om4", "", "#2bb3c8"], ["om5", "", "#9acd32"], ["cat6", "", "#5aa7ff"],
            ["cat6a", "", "#5aa7ff"], ["dac", "", "#15171a"], ["aoc", "", "#3a3f45"], ["unset", "", "#9aa3ad"],
            ["something-else", "", "#e8c547"]]
    for g, w in zip(got, want):
        if g != w:
            bad.append(f"cable colors: {g[0]} / {g[1]!r} is {g[2]}, expected {w[2]}")
    return bad


@extra("rack.html: cables hang in both panes, a cross-face run leaves by a tag, a loose end hangs unplugged; the panes widen together and zoom still works")
def check_rack_cables_drawn(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    near = lambda a, b, tol=0.6: abs(a - b) <= tol

    # No cables: the panes are exactly as they were.
    open_fixture(page, base)
    plain = page.evaluate(PANES_JS)
    for p in ("front", "rear"):
        if not near(plain[p]["vb"][2], 514.85, 0.01) or plain[p]["layers"]:
            bad.append(f"cables drawn: with no cables the {p} pane is {plain[p]['vb']} with {plain[p]['layers']} cable layers")

    try:
        open_cabled(page, base)
    except RuntimeError as e:
        return bad + [f"cables drawn: {e}"]
    got = page.evaluate(PANES_JS)
    front, rear = got["front"], got["rear"]

    # Both panes widen by the same 260 mm column - the front to its right, the
    # rear to its left - and by 40 mm below.
    pf, pr = plain["front"]["vb"], plain["rear"]["vb"]
    if not (near(front["vb"][0], pf[0], 0.01) and near(front["vb"][2], pf[2] + 260, 0.01)
            and near(front["vb"][3], pf[3] + 40, 0.01)):
        bad.append(f"cables drawn: the front pane's viewBox is {front['vb']}, from {pf}")
    if not (near(rear["vb"][0], pr[0] - 260, 0.01) and near(rear["vb"][2], pr[2] + 260, 0.01)
            and near(rear["vb"][3], pr[3] + 40, 0.01)):
        bad.append(f"cables drawn: the rear pane's viewBox is {rear['vb']}, from {pr}")
    # One U scale: the two panes are the same size, and U1 sits at the same height in both.
    if not (near(front["box"]["w"], rear["box"]["w"]) and near(front["box"]["h"], rear["box"]["h"])):
        bad.append(f"cables drawn: the panes differ in size ({front['box']} / {rear['box']})")
    if not (near(front["u1"]["h"], rear["u1"]["h"], 0.3) and near(front["u1"]["top"], rear["u1"]["top"], 1)):
        bad.append(f"cables drawn: U1 is not level across the panes ({front['u1']} / {rear['u1']})")

    ids = lambda pane, key: sorted(c["id"] or "?" for c in pane[key])
    if ids(front, "cables") != ["c1", "c2"] or ids(rear, "cables") != ["c2", "c3"]:
        bad.append(f"cables drawn: front draws {ids(front, 'cables')}, rear {ids(rear, 'cables')}; "
                   "expected c1, c2 and c2, c3")
    by = lambda pane, key, cid: next((c for c in pane[key] if c["id"] == cid), None)
    # c1: both ends in the front pane - a cable hanging from the switch's optic to the router's card port.
    c1 = by(front, "cables", "c1")
    if c1:
        leaf, core = (page.eval_on_selector(f'svg[data-pane="front"] [data-item-id="{i}"][data-panel]',
                      "g => { const r = g.getBoundingClientRect(); return {top: r.top, bottom: r.bottom}; }")
                      for i in ("i2", "i1"))
        if not (leaf["top"] - 1 <= c1["box"]["top"] <= leaf["bottom"] and c1["box"]["bottom"] > core["top"]):
            bad.append(f"cables drawn: c1 spans {c1['box']}, not from leaf-1 {leaf} down into core-1 {core}")
        if c1["color"] != "#e8c547" or c1["lead"]:
            bad.append(f"cables drawn: c1 is {c1['color']}, lead {c1['lead']}; expected OS2 yellow, plugged at both ends")
    if by(front, "tags", "c1"):
        bad.append("cables drawn: c1 has a tag, and both its ends are in one pane")
    # c2: front pane to rear pane - each pane hangs it off to the side column, with a tag naming the far end.
    for pane, name, text in ((front, "front", "→ demarc port-2-1"), (rear, "rear", "→ leaf-1 mgmt-eth")):
        tag = by(pane, "tags", "c2")
        if not tag or tag["text"] != text or tag["loose"]:
            bad.append(f"cables drawn: c2's tag on the {name} is {tag}, expected {text!r}")
    c2 = by(front, "cables", "c2")
    if c2 and c2["color"] != "#5aa7ff":
        bad.append(f"cables drawn: c2 is {c2['color']}, expected copper blue")
    # c3: its far end is an empty cage - an unplugged lead in the rear pane, tagged with the reason.
    c3, tag3 = by(rear, "cables", "c3"), by(rear, "tags", "c3")
    if not c3 or c3["lead"] != "from":
        bad.append(f"cables drawn: c3 on the rear is {c3}, expected an unplugged lead for its A end")
    if not tag3 or not tag3["loose"] or tag3["why"] != "port-2 holds no optic":
        bad.append(f"cables drawn: c3's not-connected tag is {tag3}")
    if len(front["tags"]) != 1 or len(rear["tags"]) != 2:
        bad.append(f"cables drawn: {len(front['tags'])} front tags and {len(rear['tags'])} rear tags, expected 1 and 2")

    # Zoom and Fit still work on the widened panes.
    panes_h = page.eval_on_selector("#panes", "p => p.getBoundingClientRect().height")
    if (page.text_content("#zoomLevel") or "") != "Fit" or front["box"]["h"] > panes_h + 1:
        bad.append(f"cables drawn: at Fit the front pane is {front['box']['h']} tall in a {panes_h} area")
    page.click("#zoomIn")
    zoomed = page.evaluate(PANES_JS)
    if not (zoomed["front"]["box"]["w"] > front["box"]["w"] + 1
            and near(zoomed["front"]["box"]["w"], zoomed["rear"]["box"]["w"])):
        bad.append(f"cables drawn: zooming in gave {zoomed['front']['box']['w']} and {zoomed['rear']['box']['w']} wide panes")
    if ids(zoomed["front"], "cables") != ["c1", "c2"]:
        bad.append("cables drawn: zooming lost the cables")
    page.click("#zoomFit")
    if (page.text_content("#zoomLevel") or "") != "Fit":
        bad.append("cables drawn: Fit did not come back")
    return bad
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `python3 check-browser.py --only check_cable_colors,check_rack_cables_drawn`
Expected: both FAIL.
- `check_cable_colors`: `cable colors: om3 / '' is #e8c547, expected #2bb3c8`, and the same for the other new media.
- `check_rack_cables_drawn`: `cables drawn: cable fixture: the rear pane's cables: … Timeout 60000ms exceeded.` (it waits out the full minute).

- [ ] **Step 3: Let `drawCables2d` take another way to find an end, and color the new media**

In `site/rack/cables.js`:

Replace

```js
export const COLORS = {os2: '#e8c547', copper: {server: '#5aa7ff', management: '#9aa3ad'}};
```

with

```js
export const COLORS = {os2: '#e8c547', copper: {server: '#5aa7ff', management: '#9aa3ad'},
  // The Rack Builder's media (cable-rules.js MEDIA), beside the showcase's
  // two: OM3 and OM4 aqua, OM5 lime green, Cat 6 and 6A blue, a DAC black, an
  // AOC dark gray, and a neutral gray for a cable whose media is not set.
  // Added keys only: colorOf, and every color the showcase draws, are unchanged.
  om3: '#2bb3c8', om4: '#2bb3c8', om5: '#9acd32', cat6: '#5aa7ff', cat6a: '#5aa7ff',
  dac: '#15171a', aoc: '#3a3f45', unset: '#9aa3ad'};
```

The comment block above `drawCables2d` stays. Directly below it, replace

```js
export function drawCables2d(svg, plan, view, {edgeX, tag, looseTag, farLoose = () => false,
                                               outboard = 1}) {
```

with

```js
// `ends(svg, dev, path)` finds an end's connector points; it defaults to
// ends2d, which looks a device up by its ref. The Rack Builder passes its
// own (cable-view.js), which looks an item up by its id and panel.
export function drawCables2d(svg, plan, view, {edgeX, tag, looseTag, farLoose = () => false,
                                               outboard = 1, ends = ends2d}) {
```

and inside the function, replace

```js
    const pts = here.map(([k, e]) => [k, ends2d(svg, e[0], e[1])]);
```

with

```js
    const pts = here.map(([k, e]) => [k, ends(svg, e[0], e[1])]);
```

`looseOn` keeps calling `ends2d`: only the showcase uses it.

- [ ] **Step 4: Write the Rack Builder's cable layer**

Create `site/rack/cable-view.js`:

```js
// THE RACK'S CABLES ON ITS TWO PANES. cables.js owns the geometry (the hang,
// the strands, the side column, the unplugged lead); this is the Rack
// Builder's adapter over it: where an end is in a pane, how wide a pane is
// when there are cables, and what a tag says.
//
// AN END IS FOUND BY ITEM AND PANEL, never by device ref (Phase 2 ruling 3):
// two items can share a ref, and each item is in both panes. cable-rules.js
// cablePlan says which pane shows an end's panel; in that pane the item has
// exactly one [data-item-id][data-panel] group.
//
// WHERE AN END LANDS: on the cable points of the plug seated for it
// (cable-plugs.js) or of a DAC or AOC end seated in its cage, which carries
// its own; failing those, on the center of the port itself - an MPO adapter,
// a connector with no plug in the library. An end with a reason to be loose
// (cable-rules.js looseReason) does not land at all.

import {cablePoints} from '../../vendor/relief.js';
import {drawCables2d, plugAt} from './cables.js';
import {svgEl} from './dom.js';
import {cablePlan, endKey, endName, tagText} from './cable-rules.js';

// mm beside the rack for cross-face tails and their tags (the showcase's
// own figure), and below it for a lead hanging from the lowest device.
export const ROOM = 260;
const DROP = 40;

// BOTH PANES WIDEN BY THE SAME COLUMN (ruling 5), so they keep one U scale
// and one zoom: the front pane to its right, the rear pane to its left - the
// two columns meet between the panes. Call it on both, before the zoom is
// applied (zoom.js reads the viewBox), and only when the rack has cables.
export function widenForCables(svg) {
  const b = svg.getAttribute('viewBox').split(/\s+/).map(Number);
  svg.dataset.baseBox = b.join(' ');
  const rear = svg.dataset.pane === 'rear';
  svg.setAttribute('viewBox', [rear ? b[0] - ROOM : b[0], b[1], b[2] + ROOM, b[3] + DROP].join(' '));
}

const panelGroup = (svg, itemId) => svg.querySelector(`[data-item-id="${CSS.escape(itemId)}"][data-panel]`);

// A port's box in the pane's own user space, or null when the pane does not
// draw it. `svg` must be in the document and laid out (getScreenCTM).
export function portBox(svg, itemId, path) {
  const port = panelGroup(svg, itemId)?.querySelector(`[data-path="${CSS.escape(path)}"]`);
  if (!port) return null;
  const b = port.getBBox();
  const m = svg.getScreenCTM().inverse().multiply(port.getScreenCTM());
  const ps = [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]]
    .map(([x, y]) => new DOMPoint(x, y).matrixTransform(m));
  const xs = ps.map(p => p.x), ys = ps.map(p => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return {x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y};
}

// An end's connector points in the pane's user space, left to right: the
// cable points of what is seated at the port, else the port's own center.
function endPoints(svg, itemId, path) {
  const g = panelGroup(svg, itemId);
  if (!g || g.dataset.panel === 'missing') return null;
  const inv = svg.getScreenCTM().inverse();
  const pts = cablePoints(g).filter(p => p.at && plugAt(p.path, path));
  if (pts.length) return pts.map(p => {
    const q = new DOMPoint(+p.at[0], +p.at[1]).matrixTransform(inv.multiply(p.el.getScreenCTM()));
    return [q.x, q.y];
  }).sort((a, b) => a[0] - b[0]);
  const box = portBox(svg, itemId, path);
  return box ? [[box.x + box.w / 2, box.y + box.h / 2]] : null;
}

// EVERY CABLE WITH AN END ON THIS PANE, drawn onto it. `reasons` is Map(endKey
// -> why that end is loose, or null), from cable-plugs.js cableFacts. Call
// after widenForCables, with the pane in the document and laid out. Each
// cable group and each tag carries data-cable-id; returns drawCables2d's
// records.
export function drawRackCables(svg, rack, reasons) {
  const pane = svg.dataset.pane, rear = pane === 'rear';
  const base = svg.dataset.baseBox.split(' ').map(Number);
  const edgeX = rear ? base[0] - 8 : base[0] + base[2] + 8;
  const cables = rack.cables;
  const plan = cablePlan(rack);
  const endAt = (i, side) => cables[i][side === 'from' ? 'a' : 'b'];
  const loose = (i, side) => reasons.get(endKey(endAt(i, side))) != null;
  // Which ends on this pane are loose, by the [item, path] drawCables2d asks with.
  const looseHere = new Set();
  plan.links.forEach((link, i) => {
    for (const side of ['from', 'to'])
      if (link[side][2] === pane && loose(i, side)) looseHere.add(`${link[side][0]}|${link[side][1]}`);
  });
  // drawCables2d hands a tag the far end as the plan's own array.
  const farEnd = (link, far) => { const i = plan.links.indexOf(link); return endAt(i, far === link.from ? 'from' : 'to'); };
  // A tag's pill sits in the side column, outboard of the point it labels.
  const pill = (t, at, label) => {
    const w = 7 * label.length + 12;
    const x = rear ? at[0] - 4 - w : at[0] + 4;
    t.append(svgEl('rect', {x, y: at[1] - 9, width: w, height: 18, rx: 4}));
    const tx = svgEl('text', {x: x + 6, y: at[1] + 4}); tx.textContent = label; t.append(tx);
    return t;
  };
  const recs = drawCables2d(svg, plan, pane, {
    edgeX, outboard: rear ? -1 : 1,
    ends: (s, itemId, path) => (looseHere.has(`${itemId}|${path}`) ? null : endPoints(s, itemId, path)),
    farLoose: loose,
    // The far end is in the other pane: the tag names it.
    tag: (at, far, link) => pill(svgEl('g', {class: 'cable-tag', tabindex: '0', role: 'button'}), at,
                                 tagText(rack, farEnd(link, far))),
    // The far end does not land anywhere: the tag says so, and its title says why.
    looseTag: (at, far, link) => {
      const t = svgEl('g', {class: 'cable-tag not-connected', tabindex: '0', role: 'button'});
      const why = svgEl('title', {});
      why.textContent = reasons.get(endKey(farEnd(link, far))) || 'not connected';
      t.append(why);
      return pill(t, at, '✕ not connected');
    },
  });
  for (const rec of recs) {
    const c = cables[rec.i];
    for (const n of [rec.g, rec.tag]) if (n) n.setAttribute('data-cable-id', c.id);
    const title = rec.g?.querySelector('title');
    if (title) title.textContent = `${endName(rack, c.a)} → ${endName(rack, c.b)}${c.media ? ` · ${c.media}` : ''}`;
  }
  return recs;
}
```

Append to `site/rack/rack.css`:

```css
/* CABLES (spec §9). cables.js draws them; these are the showcase's own rules
   for a cable and its tag, copied from site/site.css, which this page does
   not load. */
[data-cables] [data-cable] { cursor: pointer; transition: opacity 120ms; }
.cable-focus [data-cable]:not(.on), .cable-focus [data-cable-tag]:not(.on) { opacity: 0.18; }
[data-cable].ghost, [data-cable-tag].ghost { opacity: 0.12; }
.cable-tag { cursor: pointer; }
.cable-tag rect { fill: var(--pt-surface); stroke: var(--pt-line); }
.cable-tag text { font: 500 11px var(--pt-font-mono); fill: var(--pt-ink); }
.cable-tag:hover rect, .cable-tag:focus-visible rect { stroke: var(--pt-brass); }
.cable-tag.not-connected rect { stroke-dasharray: 3 2; }
```

- [ ] **Step 5: Draw them on the page**

In `site/rack-page.js`:

Imports. Replace

```js
import {mergeSeats} from './rack/cable-rules.js';
```

with

```js
import {mergeSeats} from './rack/cable-rules.js';
import {widenForCables, drawRackCables} from './rack/cable-view.js';
```

`render()`, where the new panes have just been put in the document. Replace

```js
  S.svgs = [front, rear];
```

with

```js
  S.svgs = [front, rear];
  // With cables, both panes widen by the same side column, before the zoom
  // below reads their viewBox; with none they are exactly as they were.
  const cabled = r.cables.length > 0;
  if (cabled) for (const svg of S.svgs) widenForCables(svg);
```

and replace

```js
  if (!$('panes').hidden) { applyZoom($('panes'), S.svgs, S.zoom); setZoomLabel(); }
```

with

```js
  if (!$('panes').hidden) {
    applyZoom($('panes'), S.svgs, S.zoom);
    setZoomLabel();
    // Cables are measured off the laid-out panes (getScreenCTM), so they are
    // drawn only while the panes show; setMode() redraws on the way back from 3D.
    if (cabled) {
      const reasons = new Map([...facts.ends].map(([k, v]) => [k, v.reason]));
      for (const svg of S.svgs) drawRackCables(svg, r, reasons);
    }
  }
```

Leave the comment above that `if` as it is: it still explains why the zoom is skipped while `#panes` is hidden.

- [ ] **Step 6: Run the checks**

Run: `python3 check-browser.py --only check_cable_colors,check_rack_cables_drawn,check_rack_cable_plugs,check_rack_zoom,check_rack_drag,check_cables_moved,check_takeaway_cables_2d`
Expected: all seven `ok`. `check_rack_zoom` and `check_rack_drag` use racks with no cables, so they prove the panes are unchanged there; `check_takeaway_cables_2d` proves the showcase still draws through the default `ends2d`.

- [ ] **Step 7: Commit**

```bash
git add site/rack/cables.js site/rack/cable-view.js site/rack-page.js site/rack/rack.css check-browser.py
git commit -m "rack: cables hang in both panes - a cross-face run leaves by a tag, a loose end hangs unplugged

cable-view.js finds an end by item id and panel, on the cable points of
its derived plug (or of a seated DAC end), else the port's center.
drawCables2d takes that lookup as an option, ends2d still its default, and
COLORS gains the Rack Builder's media beside the showcase's two. With
cables both panes widen by the same 260 mm column, so one U scale and one
zoom still hold; with none they are untouched.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The cable form: media, purpose, label, length, with the mismatch warning inline

**Files:**
- Create: `site/rack/cable-panel.js`
- Modify: `site/rack/rack.css`, `check-browser.py` (add `FORM_JS`, `check_rack_cable_form`)

**Interfaces:**
- Consumes: `el` from `site/rack/dom.js`; `MEDIA`, `MEDIA_LABELS`, `UNITS`, `mismatch`, `parseLength` from `site/rack/cable-rules.js` (Tasks 2 and 3).
- Produces: `site/rack/cable-panel.js` exports `cableForm({title, endA, endB, cable, infoA, infoB, purposes, onSave, onCancel}) → HTMLFormElement`:
  - `title` is the heading; `endA` and `endB` are the two ends as text;
  - `cable` gives the starting values `{media, purpose, label, length}`, and an `id` when it is being edited (the button then reads "Save", otherwise "Add cable");
  - `infoA` and `infoB` are `connectorOf` results or `null`; `purposes` is a list of suggestions;
  - `onSave({media, purpose, label, length})` is called with `length` as `{value, unit, source: 'entered'}` or `null`; `onCancel()`.
  - Its controls have the ids `cableForm`, `cEndA`, `cEndB`, `cMedia`, `cWarn`, `cPurpose`, `cPurposes` (the datalist), `cLabel`, `cLength`, `cUnit`, `cError`, `cSave`, `cCancel`.

This task builds the form on its own; Task 7 opens it for a new cable and Task 8 for an existing one.

- [ ] **Step 1: Write the failing check**

In `check-browser.py`, before `def main():`, add:

```python
# The cable form on its own, in a host over the page: what it shows, what it
# warns, and what it hands back. window.__form records the callbacks.
FORM_JS = """async (opts) => {
  let P;
  try { P = await import('/site/rack/cable-panel.js'); }
  catch (err) { return String(err.message || err); }
  document.getElementById('formHost')?.remove();
  const host = document.createElement('aside');
  host.id = 'formHost';
  host.className = 'rk-side';
  host.style.cssText = 'position:fixed;left:0;top:0;z-index:50;width:20rem;max-height:100vh';
  document.body.append(host);
  window.__form = {saved: null, cancelled: 0};
  host.append(P.cableForm({...opts, onSave: f => { window.__form.saved = f; },
                           onCancel: () => { window.__form.cancelled += 1; }}));
  return '';
}"""


@extra("rack.html: the cable form offers the eight media, warns on a mismatch without blocking, and checks the length")
def check_rack_cable_form(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    page.goto(f"{base}/rack.html?probe=1", wait_until="load")
    page.wait_for_function("() => window.__rack && window.__rack.ready", timeout=READY_MS)
    page.evaluate("() => window.__rack.ready")
    saved = lambda: page.evaluate("() => window.__form.saved")
    warn = lambda: (page.text_content("#formHost #cWarn") or "")

    # A NEW CABLE between a fiber end and a copper end, offered as OS2.
    err = page.evaluate(FORM_JS, {
        "title": "New cable", "endA": "leaf-1 (U14) port-3", "endB": "demarc (U20) port-2-2",
        "cable": {"media": "os2", "purpose": "", "label": "", "length": None},
        "infoA": {"family": "fiber", "mode": None}, "infoB": {"family": "copper", "mode": None},
        "purposes": ["uplink", "management"]})
    if err:
        return bad + [f"cable form: cable-panel.js does not load ({err})"]
    if (page.text_content("#formHost h3") or "") != "New cable":
        bad.append("cable form: no New cable heading")
    if (page.text_content("#cEndA"), page.text_content("#cEndB")) != ("A: leaf-1 (U14) port-3", "B: demarc (U20) port-2-2"):
        bad.append("cable form: the two ends are not named")
    values = page.eval_on_selector_all("#cMedia option", "os => os.map(o => o.value)")
    if values != ["", "os2", "om3", "om4", "om5", "cat6", "cat6a", "dac", "aoc"]:
        bad.append(f"cable form: the media offered are {values}")
    if page.input_value("#cMedia") != "os2" or (page.text_content("#cSave") or "") != "Add cable":
        bad.append("cable form: a new cable does not open on its proposed media with an Add cable button")
    if page.eval_on_selector_all("#cPurposes option", "os => os.map(o => o.value)") != ["uplink", "management"]:
        bad.append("cable form: the rack's purposes are not offered")
    if "The ends differ: A is fiber, B is copper." not in warn() or "does not suit end B" not in warn():
        bad.append(f"cable form: the mismatch warning reads {warn()!r}")
    page.select_option("#cMedia", "cat6a")
    if "does not suit end A" not in warn():
        bad.append(f"cable form: the warning did not follow the media ({warn()!r})")
    page.select_option("#cMedia", "")
    if warn() != "The ends differ: A is fiber, B is copper.":
        bad.append(f"cable form: with no media the warning reads {warn()!r}")
    # A length that is not a number stops the save, with a sentence.
    page.fill("#cLength", "abc")
    page.click("#cSave")
    if (page.text_content("#cError") or "") != "Enter a length above 0, or leave it empty." or saved() is not None:
        bad.append(f"cable form: a bad length gave {page.text_content('#cError')!r} and saved {saved()}")
    # A warning does not: the mismatched cable saves.
    page.fill("#cPurpose", " uplink ")
    page.fill("#cLabel", "A7")
    page.fill("#cLength", "2.5")
    page.select_option("#cUnit", "ft")
    page.click("#cSave")
    want = {"media": "", "purpose": "uplink", "label": "A7", "length": {"value": 2.5, "unit": "ft", "source": "entered"}}
    if saved() != want:
        bad.append(f"cable form: saved {saved()}, expected {want}")
    page.click("#cCancel")
    if page.evaluate("() => window.__form.cancelled") != 1:
        bad.append("cable form: Cancel did not report")

    # EDITING: the same form, opened on the cable's own values.
    page.evaluate(FORM_JS, {
        "title": "Edit cable", "endA": "a", "endB": "b",
        "cable": {"id": "c1", "media": "om9", "purpose": "core", "label": "B1",
                  "length": {"value": 3, "unit": "m", "source": "entered"}},
        "infoA": None, "infoB": None, "purposes": []})
    got = [page.input_value(s) for s in ("#cMedia", "#cPurpose", "#cLabel", "#cLength", "#cUnit")]
    if got != ["om9", "core", "B1", "3", "m"] or (page.text_content("#cSave") or "") != "Save":
        bad.append(f"cable form: editing opens on {got} with a {page.text_content('#cSave')!r} button")
    if warn():
        bad.append(f"cable form: a warning with nothing known about the ends ({warn()!r})")
    page.fill("#cLength", "")
    page.press("#cLabel", "Enter")
    want = {"media": "om9", "purpose": "core", "label": "B1", "length": None}
    if saved() != want:
        bad.append(f"cable form: Enter saved {saved()}, expected {want}")
    return bad
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `python3 check-browser.py --only check_rack_cable_form`
Expected: FAIL, `cable form: cable-panel.js does not load (Failed to fetch dynamically imported module: …)`.

- [ ] **Step 3: Write the form**

Create `site/rack/cable-panel.js`:

```js
// THE CABLE PANELS, for the side panel (spec §9.2, §9.4). Like frame-form.js
// and inspector.js, these build elements and report what the user did; the
// page decides what a change means. No prompt() and no confirm() (Phase 2
// ruling 10): the side panel is rebuilt on every redraw, and every control
// here has an id so the page can hand keyboard focus back to it.

import {el} from './dom.js';
import {MEDIA, MEDIA_LABELS, UNITS, mismatch, parseLength} from './cable-rules.js';

const option = (value, text, current) =>
  el('option', {value, text, ...(String(current ?? '') === String(value) ? {selected: ''} : {})});
const field = (label, control) => el('label', {}, [label, control]);
const button = (id, text, fn, type = 'button') => {
  const b = el('button', {type, id, text});
  if (fn) b.addEventListener('click', fn);
  return b;
};

// ONE CABLE, AS A FORM - a new one or one being edited (the same form). The
// ends are fixed: they were picked on the drawing. `cable` gives the starting
// values ({media, purpose, label, length}; an `id` means it is being edited);
// `infoA` and `infoB` are the ends' connectors (cable-rules.js connectorOf),
// for the warning beside the media; `purposes` are the ones the rack already
// uses, offered as suggestions. A media mismatch is a WARNING and never stops
// a save (spec §9.3). onSave gets {media, purpose, label, length}, with
// length null when the field is empty.
export function cableForm({title, endA, endB, cable, infoA = null, infoB = null, purposes = [],
                           onSave, onCancel}) {
  const media = el('select', {id: 'cMedia'}, [
    option('', 'Not set', cable.media),
    ...MEDIA.map(m => option(m, MEDIA_LABELS[m], cable.media)),
    // A media from a file this page does not know stays selectable as itself.
    ...(cable.media && !MEDIA.includes(cable.media) ? [option(cable.media, cable.media, cable.media)] : [])]);
  const purpose = el('input', {id: 'cPurpose', type: 'text', value: cable.purpose || '',
                               list: 'cPurposes', autocomplete: 'off'});
  const label = el('input', {id: 'cLabel', type: 'text', value: cable.label || ''});
  const length = el('input', {id: 'cLength', type: 'text', inputmode: 'decimal',
                              value: cable.length ? String(cable.length.value) : ''});
  const unit = el('select', {id: 'cUnit'}, UNITS.map(u => option(u, u, cable.length?.unit || 'm')));
  const warn = el('p', {id: 'cWarn', class: 'rk-warn', role: 'status'});
  const err = el('p', {id: 'cError', class: 'rk-error', role: 'alert'});
  const showWarn = () => { warn.textContent = mismatch(media.value, infoA, infoB).join(' '); };
  media.addEventListener('change', showWarn);
  showWarn();

  const form = el('form', {id: 'cableForm', class: 'rk-cable-form', novalidate: ''}, [
    el('h3', {text: title}),
    el('p', {id: 'cEndA', class: 'rk-muted', text: `A: ${endA}`}),
    el('p', {id: 'cEndB', class: 'rk-muted', text: `B: ${endB}`}),
    field('Media', media),
    warn,
    field('Purpose', purpose),
    el('datalist', {id: 'cPurposes'}, purposes.map(p => el('option', {value: p}))),
    field('Label', label),
    el('div', {class: 'rk-length'}, [field('Length', length), field('Unit', unit)]),
    err,
    el('div', {class: 'rk-actions'}, [
      button('cSave', cable.id ? 'Save' : 'Add cable', null, 'submit'),
      button('cCancel', 'Cancel', onCancel)]),
  ]);
  // A form, so Enter in any field saves.
  form.addEventListener('submit', ev => {
    ev.preventDefault();
    const len = parseLength(length.value, unit.value);
    if (!len.ok) { err.textContent = len.reason; length.focus(); return; }
    err.textContent = '';
    onSave({media: media.value, purpose: purpose.value.trim(), label: label.value.trim(), length: len.length});
  });
  return form;
}
```

Append to `site/rack/rack.css`:

```css
/* The cable form, in the side panel. A warning takes no room until it has
   something to say. */
.rk-warn { color: var(--pt-warn); font-size: 0.85rem; margin: 0 0 0.6rem; }
.rk-warn:empty { display: none; }
.rk-cable-form p { margin: 0 0 0.4rem; }
.rk-length { display: grid; grid-template-columns: minmax(0, 1fr) 5rem; gap: 0.5rem; }
```

- [ ] **Step 4: Run the check**

Run: `python3 check-browser.py --only check_rack_cable_form`
Expected: `ok`.

- [ ] **Step 5: Commit**

```bash
git add site/rack/cable-panel.js site/rack/rack.css check-browser.py
git commit -m "rack: the cable form - eight media, purpose, label, length in m or ft, and a mismatch warning that never blocks

A panel form for the side panel, the same for a new cable and for one
being edited. The warning follows the media as it is changed; only a
length that is not a positive number stops a save.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Cable mode: click a port, then another, on either face

**Files:**
- Modify: `rack.html` (the Cable button), `site/rack/rack.css`, `site/rack/cable-view.js` (add `portAt`, `markPort`), `site/rack-page.js`, `check-browser.py` (add `port_sel`, `check_rack_cable_mode`)

**Interfaces:**
- Consumes: `panelFor` from `site/rack/elevation.js`; `endKey`, `sameEnd`, `paneOf`, `portPathOf`, `portFree`, `canCable`, `withCable`, `updateCable`, `endName`, `proposeMedia`, `countsBy` from `site/rack/cable-rules.js`; `portBox` from `site/rack/cable-view.js` (Task 5); `cableForm` from `site/rack/cable-panel.js` (Task 6); `cableFacts(rack, extra)` (Task 4); `open_cabled`, `PLUGS_JS` (Tasks 4 and 5).
- Produces, from `site/rack/cable-view.js`: `portAt(target, group) → path | null` (the port a click inside a panel group is on) and `markPort(svg, itemId, path)` (appends a `rect.rk-end-pick` round a port).
- Produces, in `site/rack-page.js`:
  - `S.cable = {on, a}`: Cable mode, and the picked A end;
  - `S.sel` gains `{kind: 'cable-form', id, a, b}`: `id` null and `a`, `b` set for a new cable; `id` set for an existing one;
  - `setCableMode(on)`, `paintCableMode()`, `pendingEnds()`, `onCableClick(ev)`, `cableModePanel()`, `cableFormPanel(sel)`.
- Produces, in the page: `#cableBtn` (`aria-pressed`), the class `rk-cabling` on `#panes` while the mode is on, `#cableHelp` with `#cableStep` in the side panel.

- [ ] **Step 1: Write the failing check**

In `check-browser.py`, before `def main():`, add:

```python
def port_sel(pane, item, path):
    return f'svg[data-pane="{pane}"] [data-item-id="{item}"][data-panel] [data-path="{path}"]'


@extra("rack.html: Cable mode - click one port, then another, on either face; a taken port says why; Esc backs out; nothing drags")
def check_rack_cable_mode(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    try:
        open_cabled(page, base)
    except RuntimeError as e:
        return bad + [f"cable mode: {e}"]
    cables = lambda: page.evaluate("() => window.__rack.doc().racks[0].cables")
    pressed = lambda: page.get_attribute("#cableBtn", "aria-pressed")
    marks = lambda pane: page.eval_on_selector_all(f'svg[data-pane="{pane}"] .rk-end-pick', "els => els.length")
    notice = lambda: (page.text_content(".rk-side .rk-notice") or "") if page.query_selector(".rk-side .rk-notice") else ""
    if not page.query_selector("#cableBtn"):
        return bad + ["cable mode: no Cable button in the top bar"]

    # Off: a click on a port is a click on its device.
    page.click(port_sel("rear", "i4", "port-2-2"))
    wait_sel(page, "cable mode: off, a port click selects the device", "#iLabel")

    page.click("#cableBtn")
    wait_sel(page, "cable mode: the help panel", "#cableStep")
    if pressed() != "true" or not page.evaluate("() => document.getElementById('panes').classList.contains('rk-cabling')"):
        bad.append("cable mode: the button is not pressed, or the panes are not marked as cabling")

    # One cable per port. leaf-1's port-1 holds an optic, which is drawn
    # beside its cage: a click on the optic is a click on the port.
    page.click(port_sel("front", "i2", "port-1-occupant"))
    wait_sel(page, "cable mode: the refusal", ".rk-side .rk-notice")
    if notice() != "leaf-1 (U14) port-1 already has a cable (A1).":
        bad.append(f"cable mode: a taken port said {notice()!r}")
    if marks("front") or marks("rear"):
        bad.append("cable mode: a refused port was picked")

    # A then B, both in the rear pane: the two demarcs share a ref and a port path.
    token = render_token(page)
    page.click(port_sel("rear", "i3", "port-2-2"))
    wait_rendered(page, "cable mode: the A end", token)
    wait_sel(page, "cable mode: the A end's outline", 'svg[data-pane="rear"] .rk-end-pick')
    step = page.text_content("#cableStep") or ""
    if "From demarc (U14) port-2-2." not in step:
        bad.append(f"cable mode: after the A end the panel reads {step!r}")
    page.click(port_sel("rear", "i4", "port-2-2"))
    wait_sel(page, "cable mode: the form", "#cableForm")
    if (page.text_content("#cEndA"), page.text_content("#cEndB")) != ("A: demarc (U14) port-2-2", "B: demarc (U20) port-2-2"):
        bad.append(f"cable mode: the form names {page.text_content('#cEndA')!r} and {page.text_content('#cEndB')!r}")
    if page.input_value("#cMedia") != "cat6a":
        bad.append(f"cable mode: two copper jacks proposed {page.input_value('#cMedia')!r}, expected cat6a")
    if marks("rear") != 2:
        bad.append(f"cable mode: {marks('rear')} ports are outlined while the form is open, expected both ends")
    page.fill("#cPurpose", "access")
    page.fill("#cLabel", "X1")
    page.fill("#cLength", "1.5")
    page.click("#cSave")
    wait_fn(page, "cable mode: the new cable", "() => window.__rack.doc().racks[0].cables.length === 4")
    # The view is the DEVICE's panel: these two show their front in the rear pane.
    want = {"id": "c4", "a": {"item": "i3", "path": "port-2-2", "view": "front"},
            "b": {"item": "i4", "path": "port-2-2", "view": "front"}, "media": "cat6a", "purpose": "access",
            "label": "X1", "length": {"value": 1.5, "unit": "m", "source": "entered"}, "route": []}
    if cables()[3] != want:
        bad.append(f"cable mode: the new cable is {cables()[3]}")
    wait_sel(page, "cable mode: the new cable drawn", 'svg[data-pane="rear"] [data-cables] [data-cable-id="c4"]')
    if page.evaluate(PLUGS_JS, ["rear", "i3"]) != {"lc": 0, "rj45": 2}:
        bad.append("cable mode: the new cable's end did not get its plug")
    if pressed() != "true":
        bad.append("cable mode: adding a cable left Cable mode")
    # That port is taken now; its plug is drawn over the jack, so the click lands on the plug.
    page.click(port_sel("rear", "i3", "port-2-2-occupant"))
    wait_sel(page, "cable mode: the second refusal", ".rk-side .rk-notice")
    if notice() != "demarc (U14) port-2-2 already has a cable (X1).":
        bad.append(f"cable mode: the port just cabled said {notice()!r}")

    # Esc: first the picked end, then the mode.
    page.click(port_sel("front", "i2", "port-3"))
    wait_sel(page, "cable mode: an A end on the front", 'svg[data-pane="front"] .rk-end-pick')
    page.keyboard.press("Escape")
    wait_fn(page, "cable mode: Esc drops the picked end", "() => !document.querySelector('.rk-end-pick')")
    if pressed() != "true":
        bad.append("cable mode: the first Esc left Cable mode")
    page.keyboard.press("Escape")
    wait_fn(page, "cable mode: Esc leaves the mode",
            "() => document.getElementById('cableBtn').getAttribute('aria-pressed') === 'false'")
    if page.evaluate("() => document.getElementById('panes').classList.contains('rk-cabling')"):
        bad.append("cable mode: the panes are still marked as cabling after leaving")

    # Cancel adds nothing. Two empty cages say nothing about a media, so none is proposed.
    page.click("#cableBtn")
    page.click(port_sel("front", "i2", "port-3"))
    wait_sel(page, "cable mode: A again", 'svg[data-pane="front"] .rk-end-pick')
    page.click(port_sel("front", "i2", "port-4"))
    wait_sel(page, "cable mode: the form again", "#cableForm")
    if page.input_value("#cMedia") != "":
        bad.append(f"cable mode: two empty cages proposed {page.input_value('#cMedia')!r}")
    page.click("#cCancel")
    wait_fn(page, "cable mode: Cancel closes the form", "() => !document.getElementById('cableForm')")
    if len(cables()) != 4 or pressed() != "true":
        bad.append(f"cable mode: after Cancel there are {len(cables())} cables, pressed {pressed()}")

    # No drag in Cable mode: a press and a move on a device leaves it where it is.
    box = page.eval_on_selector('svg[data-pane="rear"] [data-item-id="i4"][data-panel]',
                                "g => { const r = g.getBoundingClientRect(); return {x: r.x + 8, y: r.y + r.height / 2}; }")
    page.mouse.move(box["x"], box["y"])
    page.mouse.down()
    page.mouse.move(box["x"], box["y"] - 90, steps=6)
    dragging = page.query_selector("#dragStatus") is not None
    page.mouse.up()
    if dragging or page.evaluate("() => window.__rack.doc().racks[0].items.find(i => i.id === 'i4').ru") != 20:
        bad.append("cable mode: a device could be dragged while cabling")

    # 3D has no ports to click: switching leaves Cable mode.
    page.click('#rkMode [data-mode="3d"]')
    if pressed() != "false":
        bad.append("cable mode: still on after switching to 3D")
    return bad
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `python3 check-browser.py --only check_rack_cable_mode`
Expected: FAIL, `cable mode: no Cable button in the top bar`.

- [ ] **Step 3: The button and its styles**

In `rack.html`, replace

```html
    <button type="button" id="frameBtn">Frame</button>
```

with

```html
    <button type="button" id="frameBtn">Frame</button>
    <button type="button" id="cableBtn" aria-pressed="false">Cable</button>
```

Append to `site/rack/rack.css`:

```css
/* Cable mode: the pressed button; ports as the thing to click; the cables out
   of the pointer's way, so a port under one can be clicked (their tags, in
   their own layer, still take a click); and the outline round a picked end. */
.rk-bar > button[aria-pressed="true"] { border-color: var(--pt-brass); color: var(--pt-brass); }
.rk-cabling [data-class="port"], .rk-cabling [data-class="port"] *,
.rk-cabling [data-class="transceiver"], .rk-cabling [data-class="transceiver"] * { cursor: crosshair; }
.rk-cabling [data-cables] { pointer-events: none; }
.rk-end-pick { fill: none; stroke: var(--pt-brass); stroke-width: 1.5; pointer-events: none; }
```

- [ ] **Step 4: Which port a click is on**

In `site/rack/cable-view.js`, replace

```js
import {cablePlan, endKey, endName, tagText} from './cable-rules.js';
```

with

```js
import {cablePlan, endKey, endName, tagText, portPathOf} from './cable-rules.js';
```

and append:

```js

// WHICH PORT A CLICK IS ON, as its data-path, or null. `group` is the item's
// panel group and `target` the element clicked inside it. The outermost
// data-class="port" above the click wins (the rule zones.js's readSvg uses):
// a duplex adapter, not one of its bores. A seated optic or plug is NOT
// inside its cage - swap.js seats it beside the cage, at `<port>-occupant` -
// so a click on either is mapped back to the port by its path
// (cable-rules.js portPathOf), and counts only if that port is drawn.
export function portAt(target, group) {
  let hit = null;
  for (let n = target; n && n !== group; n = n.parentNode) {
    const p = n.getAttribute?.('data-path');
    if (p && (n.getAttribute('data-class') === 'port' || p.includes('-occupant'))) hit = p;
  }
  if (hit == null) return null;
  const path = portPathOf(hit);
  return group.querySelector(`[data-path="${CSS.escape(path)}"][data-class="port"]`) ? path : null;
}

// A brass outline round a picked port, in the pane's own layer: screen UI
// (data-pt-ui), so it never reaches a file.
export function markPort(svg, itemId, path) {
  const b = svg ? portBox(svg, itemId, path) : null;
  if (!b) return;
  svg.append(svgEl('rect', {x: b.x - 1.5, y: b.y - 1.5, width: b.w + 3, height: b.h + 3, rx: 2,
    class: 'rk-end-pick', 'data-pt-ui': '*'}));
}
```

- [ ] **Step 5: Wire the mode into the page**

In `site/rack-page.js`:

Imports. Replace

```js
import {drawElevation, uAtY} from './rack/elevation.js';
```

with

```js
import {drawElevation, uAtY, panelFor} from './rack/elevation.js';
```

and replace

```js
import {mergeSeats} from './rack/cable-rules.js';
import {widenForCables, drawRackCables} from './rack/cable-view.js';
```

with

```js
import {mergeSeats, endKey, sameEnd, paneOf, portFree, canCable, withCable, updateCable, endName,
        proposeMedia, countsBy} from './rack/cable-rules.js';
import {widenForCables, drawRackCables, portAt, markPort} from './rack/cable-view.js';
import {cableForm} from './rack/cable-panel.js';
```

State. Replace

```js
  cableFacts: {seats: {}, ends: new Map()},
```

with

```js
  cableFacts: {seats: {}, ends: new Map()},
  // Cable mode: on or off, and the A end picked and waiting for its B.
  cable: {on: false, a: null},
```

`setMode`. Replace

```js
  if (m === '3d') { rebuild3d(); return; }
```

with

```js
  if (m === '3d') {
    // 3D has no ports to click, so Cable mode ends here, and a new cable not
    // yet added goes with it. The side panel is redrawn to say so (render()
    // is not called on the way into 3D).
    if (pendingEnds().length) S.sel = null;
    S.cable = {on: false, a: null};
    paintCableMode();
    renderSide();
    rebuild3d();
    return;
  }
```

`setDoc`: an A end picked in one rack means nothing in the next. Replace

```js
  S.doc = doc; S.sel = null; S.undo = null;
  try { localStorage.setItem(LAST, doc.id); }
```

with

```js
  S.doc = doc; S.sel = null; S.undo = null; S.cable.a = null;
  try { localStorage.setItem(LAST, doc.id); }
```

The mode's own functions go after `setDoc`. Replace

```js
  renderLibrary();
  if (S.mode === '3d') rebuild3d();
}
```

with

```js
  renderLibrary();
  if (S.mode === '3d') rebuild3d();
}

// ── Cable mode (spec §9.2) ──────────────────────────────────────────────
// A tool state beside 2D/3D: while it is on, a click in a pane picks a port
// instead of selecting a device, and the drag controller is off. The A end
// waits in S.cable.a; the B end opens the cable form with both.
const pendingEnds = () => (S.sel?.kind === 'cable-form' && !S.sel.id ? [S.sel.a, S.sel.b] : []);
function paintCableMode() {
  $('cableBtn').setAttribute('aria-pressed', String(S.cable.on));
  $('panes').classList.toggle('rk-cabling', S.cable.on);
}
function setCableMode(on) {
  S.cable = {on: !!on && S.mode === '2d', a: null};
  // Entering clears the selection; leaving drops a new cable not yet added.
  if (S.cable.on || (S.sel?.kind === 'cable-form' && !S.sel.id)) S.sel = null;
  paintCableMode();
  render();
}
function onCableClick(ev) {
  if (S.sel?.kind === 'cable-form') return;      // the form is open: finish or cancel it first
  const group = ev.target.closest('[data-item-id][data-panel]');
  const item = group ? itemById(group.dataset.itemId) : null;
  const path = item && group.dataset.panel !== 'missing' ? portAt(ev.target, group) : null;
  if (!path) return;
  // The end's view is the device's own panel, not the pane it was clicked in.
  const end = {item: item.id, path, view: panelFor(item, group.closest('svg').dataset.pane)};
  if (S.cable.a && sameEnd(S.cable.a, end)) { S.cable.a = null; render(); return; }   // the same port again: unpick it
  const free = portFree(rack(), end);
  if (!free.ok) { S.notice = {text: free.reason, kind: 'error'}; render(); return; }
  if (!S.cable.a) { S.cable.a = end; render(); return; }
  S.sel = {kind: 'cable-form', id: null, a: S.cable.a, b: end};
  S.cable.a = null;
  render();
}
function cableModePanel() {
  const a = S.cable.a;
  return el('div', {id: 'cableHelp'}, [
    el('h3', {text: 'Cable'}),
    el('p', {id: 'cableStep', class: 'rk-muted', role: 'status', text: a
      ? `From ${endName(rack(), a)}. Click the port at the other end, on either face. Esc starts over.`
      : 'Click the port at one end, on either face. Esc leaves Cable mode.'})]);
}
// The form for a new cable (sel.a and sel.b, picked on the drawing) or for
// an existing one (sel.id). What is known about each end comes from the
// render that drew this panel (S.cableFacts).
function cableFormPanel(sel) {
  const r = rack();
  const cable = sel.id ? r.cables.find(c => c.id === sel.id) : null;
  if (sel.id && !cable) { S.sel = null; return summary(); }
  const a = cable ? cable.a : sel.a, b = cable ? cable.b : sel.b;
  const info = e => S.cableFacts.ends.get(endKey(e))?.info || null;
  return cableForm({
    title: cable ? 'Edit cable' : 'New cable', endA: endName(r, a), endB: endName(r, b),
    cable: cable || {media: proposeMedia(info(a), info(b)), purpose: '', label: '', length: null},
    infoA: info(a), infoB: info(b),
    purposes: [...countsBy(r.cables, 'purpose').keys()].filter(Boolean),
    onSave: fields => {
      S.sel = null;
      if (cable) { commit(updateCable(r, cable.id, fields)); return; }
      const ok = canCable(r, a, b);
      if (!ok.ok) { S.notice = {text: ok.reason, kind: 'error'}; render(); return; }
      commit(withCable(r, {a, b, ...fields}).rack);
    },
    onCancel: () => select(null)});
}
```

`render()`: read the two ends of a cable being made as well, for the form's proposal and warning. Replace

```js
    facts = await cableFacts(r);
```

with

```js
    facts = await cableFacts(r, pendingEnds());
```

and outline what is picked. Replace

```js
      for (const svg of S.svgs) drawRackCables(svg, r, reasons);
    }
  }
```

with

```js
      for (const svg of S.svgs) drawRackCables(svg, r, reasons);
    }
    // The picked A end, and both ends while a new cable's form is open.
    for (const e of [...pendingEnds(), ...(S.cable.a ? [S.cable.a] : [])]) {
      const it = itemById(e.item);
      if (it) markPort(S.svgs.find(s => s.dataset.pane === paneOf(it, e.view)), it.id, e.path);
    }
  }
```

`renderSide()`. Replace

```js
  if (!sel) body = summary();
```

with

```js
  if (!sel) body = S.cable.on ? cableModePanel() : summary();
  else if (sel.kind === 'cable-form') body = cableFormPanel(sel);
```

and at its end, replace

```js
  if (focusId) document.getElementById(focusId)?.focus();
```

with

```js
  const back = focusId ? document.getElementById(focusId) : null;
  if (back) back.focus();
  // A cable form that just opened takes the keyboard at its first field.
  else if (S.sel?.kind === 'cable-form') $('cMedia')?.focus();
```

`onPaneClick`. Replace

```js
  if (drag?.consumeClick()) return; // this drag's own trailing click (some engines fire one), not a fresh click
```

with

```js
  if (drag?.consumeClick()) return; // this drag's own trailing click (some engines fire one), not a fresh click
  if (S.cable.on) return onCableClick(ev);
```

`bootInner`. Replace

```js
  $('paneFront').addEventListener('pointerdown', drag.onPointerDown);
  $('paneRear').addEventListener('pointerdown', drag.onPointerDown);
```

with

```js
  // The drag controller is off in Cable mode: a press on a port must stay a click.
  const press = ev => { if (!S.cable.on) drag.onPointerDown(ev); };
  $('paneFront').addEventListener('pointerdown', press);
  $('paneRear').addEventListener('pointerdown', press);
  $('cableBtn').addEventListener('click', () => setCableMode(!S.cable.on));
```

The `keydown` handler, in `bootInner`. Replace

```js
    const id = S.sel?.kind === 'item' || S.sel?.kind === 'move' ? S.sel.id : null;
    if (ev.key === 'Escape' && S.sel) {
```

with

```js
    // In Cable mode Esc backs out one step: the open form, then the picked
    // end, then the mode itself.
    if (ev.key === 'Escape' && S.cable.on) {
      ev.preventDefault();
      if (S.sel?.kind === 'cable-form') select(null);
      else if (S.cable.a) { S.cable.a = null; render(); }
      else setCableMode(false);
      return;
    }
    const id = S.sel?.kind === 'item' || S.sel?.kind === 'move' ? S.sel.id : null;
    if (ev.key === 'Escape' && S.sel) {
```

- [ ] **Step 6: Run the checks**

Run: `python3 check-browser.py --only check_rack_cable_mode,check_rack_cables_drawn,check_rack_drag,check_rack_inspect,check_rack_mode_toggle_stable,check_rack_frame_focus`
Expected: all six `ok`. `check_rack_drag` and `check_rack_inspect` prove a click and a drag behave as before with Cable mode off; `check_rack_mode_toggle_stable` proves the new button did not move the 2D/3D switch.

- [ ] **Step 7: Commit**

```bash
git add rack.html site/rack/rack.css site/rack/cable-view.js site/rack-page.js check-browser.py
git commit -m "rack: Cable mode - click a port at each end, on either face, and the form adds the cable

A port click resolves to the outermost port above it; a click on a seated
optic or plug, which is drawn beside its cage, is mapped back to the port.
The end's view is the device's own panel, whichever pane it was clicked
in. A taken port is refused with its reason; Esc backs out a step at a
time; the drag controller is off while cabling; 3D leaves the mode.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 8: The cable list: filter by purpose and media, select by a row or a tag, light both panes, edit and delete

**Files:**
- Modify: `site/rack/cable-panel.js` (add `cableList`), `site/rack/cable-view.js` (add `paintCables`), `site/rack-page.js`, `site/rack/rack.css`, `check-browser.py` (add `LIST_JS`, `LIT_JS`, `check_rack_cable_list`)

**Interfaces:**
- Consumes: `lengthText`, `endName`, `endKey`, `countsBy`, `matches`, `mismatch`, `MEDIA_LABELS`, `withoutCable` from `site/rack/cable-rules.js`; `cableForm`, `cableFormPanel(sel)` and `S.sel = {kind: 'cable-form', id}` (Tasks 6 and 7); `S.cableFacts.ends` (Task 4); the `data-cable-id` on every cable group and tag (Task 5); `open_cabled`, `PLUGS_JS`.
- Produces, from `site/rack/cable-panel.js`: `cableList({rack, ends, on, selectedId, onFilter, onSelect, onEdit, onDelete}) → HTMLElement` (`#cableList`):
  - `ends` is `cableFacts`' `Map`; `on` is `{purpose, media}`;
  - one `li[data-cable-item="<id>"]` per cable, holding `button[data-cable-row="<id>"][aria-pressed]`, a `.rk-cable-meta` line, a `[data-loose="a"|"b"]` line per loose end, a `[data-warning]` line per mismatch, and `#cableEdit` and `#cableDelete` on the selected row;
  - `button[data-filter-purpose="<value>"]` and `button[data-filter-media="<value>"]` with `aria-pressed`, labeled `"<value or 'not set'> (<count>)"`;
  - `p[data-filter-count][data-matching][data-total]`, "N of M cables match.";
  - `onFilter(nextOn)`, `onSelect(id)`, `onEdit(id)`, `onDelete(id)`.
- Produces, from `site/rack/cable-view.js`: `paintCables(svgs, rack, {selectedId, on})`, which toggles `.cable-focus` on each pane and `.on` and `.ghost` on each `[data-cable-id]`.
- Produces, in `site/rack-page.js`: `S.sel` gains `{kind: 'cable', id}`; `S.cableFilter = {purpose, media}`; `selectedCable()`, `cableListPanel()`, `homePanel()`.

- [ ] **Step 1: Write the failing check**

In `check-browser.py`, before `def main():`, add:

```python
# The cable list as shown: each row's id, text, pressed and hidden state, its
# loose-end and warning lines, and the filter buttons and count.
LIST_JS = """() => {
  const list = document.getElementById('cableList');
  if (!list) return null;
  const count = list.querySelector('[data-filter-count]');
  return {
    rows: [...list.querySelectorAll('li[data-cable-item]')].map(li => ({
      id: li.dataset.cableItem, hidden: li.hidden,
      text: li.querySelector('[data-cable-row]').textContent,
      pressed: li.querySelector('[data-cable-row]').getAttribute('aria-pressed') === 'true',
      meta: li.querySelector('.rk-cable-meta')?.textContent || '',
      loose: Object.fromEntries([...li.querySelectorAll('[data-loose]')].map(s => [s.dataset.loose, s.textContent])),
      warnings: [...li.querySelectorAll('[data-warning]')].map(s => s.textContent)})),
    purpose: [...list.querySelectorAll('[data-filter-purpose]')].map(b => b.textContent),
    media: [...list.querySelectorAll('[data-filter-media]')].map(b => b.textContent),
    count: count.textContent, matching: count.dataset.matching, total: count.dataset.total,
  };
}"""

# Per pane: is it in focus mode, which cable ids are lit, which are ghosted.
LIT_JS = """() => Object.fromEntries(['front', 'rear'].map(p => {
  const svg = document.querySelector(`svg[data-pane="${p}"]`);
  const ids = sel => [...new Set([...svg.querySelectorAll(sel)].map(n => n.dataset.cableId))].sort();
  return [p, {focus: svg.classList.contains('cable-focus'), on: ids('[data-cable-id].on'),
              parts: svg.querySelectorAll('[data-cable-id].on').length, ghost: ids('[data-cable-id].ghost')}];
}))"""


@extra("rack.html: the cable list - rows with reasons and warnings, filters that ghost, a row or a tag selects and lights both panes, edit and delete")
def check_rack_cable_list(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    try:
        open_cabled(page, base)
    except RuntimeError as e:
        return bad + [f"cable list: {e}"]
    cables = lambda: page.evaluate("() => window.__rack.doc().racks[0].cables")
    row = lambda cid: f'#cableList [data-cable-row="{cid}"]'
    # A synchronous predicate: is this row pressed (or, with want=False, not pressed)?
    pressed_js = lambda cid, want=True: (
        f"""() => (document.querySelector('#cableList [data-cable-row="{cid}"]')"""
        f"""?.getAttribute('aria-pressed') === 'true') === {'true' if want else 'false'}""")

    try:
        wait_sel(page, "cable list: the list under the summary", "#cableList")
    except RuntimeError as e:
        return bad + [str(e)]
    got = page.evaluate(LIST_JS)
    by = {r["id"]: r for r in got["rows"]}
    if list(by) != ["c1", "c2", "c3"]:
        return bad + [f"cable list: the rows are {list(by)}"]
    if by["c2"]["text"] != "leaf-1 (U14) mgmt-eth → demarc (U14) port-2-1":
        bad.append(f"cable list: c2 reads {by['c2']['text']!r}")
    if by["c1"]["meta"] != "A1 · OS2 single-mode fiber · uplink · 2 m":
        bad.append(f"cable list: c1's details read {by['c1']['meta']!r}")
    if by["c3"]["loose"] != {"a": "Loose end A: port-2 holds no optic."} or by["c1"]["loose"] or by["c2"]["loose"]:
        bad.append(f"cable list: the loose ends are {[(r['id'], r['loose']) for r in got['rows']]}")
    if by["c3"]["warnings"] != ["OS2 single-mode fiber does not suit end B, which is copper."] or by["c1"]["warnings"]:
        bad.append(f"cable list: the warnings are {[(r['id'], r['warnings']) for r in got['rows']]}")
    if got["purpose"] != ["uplink (2)", "management (1)"] or got["media"] != ["os2 (2)", "cat6a (1)"]:
        bad.append(f"cable list: the filters are {got['purpose']} and {got['media']}")
    if (got["count"], got["matching"], got["total"]) != ("3 of 3 cables match.", "3", "3"):
        bad.append(f"cable list: the count reads {got['count']!r}")

    # A ROW selects its cable: lit in BOTH panes (the run and its tag in each), every other one dimmed.
    page.click(row("c2"))
    wait_fn(page, "cable list: row c2 selected", pressed_js("c2"))
    lit = page.evaluate(LIT_JS)
    for p in ("front", "rear"):
        if not lit[p]["focus"] or lit[p]["on"] != ["c2"] or lit[p]["parts"] != 2:
            bad.append(f"cable list: with c2 selected the {p} pane is {lit[p]}")
    if not page.is_visible("#cableEdit") or not page.is_visible("#cableDelete"):
        bad.append("cable list: the selected row has no Edit and Delete")
    page.click(row("c2"))
    wait_fn(page, "cable list: a second click lets the row go", pressed_js("c2", False))
    if page.evaluate(LIT_JS)["front"]["focus"]:
        bad.append("cable list: the panes are still dimmed with nothing selected")

    # A TAG selects its cable too, by a click or from the keyboard.
    page.click('svg[data-pane="rear"] [data-cable-tag][data-cable-id="c3"]')
    wait_fn(page, "cable list: the rear tag selects c3", pressed_js("c3"))
    page.focus('svg[data-pane="front"] [data-cable-tag][data-cable-id="c2"]')
    page.keyboard.press("Enter")
    wait_fn(page, "cable list: Enter on the front tag selects c2", pressed_js("c2"))
    if page.evaluate(LIT_JS)["rear"]["on"] != ["c2"]:
        bad.append("cable list: the front tag did not light the cable's rear end")
    page.keyboard.press("Escape")
    wait_fn(page, "cable list: Esc lets the selection go", pressed_js("c2", False))

    # THE FILTERS ghost what they leave out and hide its row; the two axes combine.
    page.click('#cableList [data-filter-media="os2"]')
    got = page.evaluate(LIST_JS)
    if (got["count"], got["matching"]) != ("2 of 3 cables match.", "2"):
        bad.append(f"cable list: filtering to os2 reads {got['count']!r}")
    if [r["id"] for r in got["rows"] if r["hidden"]] != ["c2"]:
        bad.append("cable list: the os2 filter did not hide c2's row alone")
    lit = page.evaluate(LIT_JS)
    if lit["front"]["ghost"] != ["c2"] or lit["rear"]["ghost"] != ["c2"]:
        bad.append(f"cable list: the os2 filter ghosted {lit['front']['ghost']} and {lit['rear']['ghost']}")
    if page.get_attribute('#cableList [data-filter-media="os2"]', "aria-pressed") != "true":
        bad.append("cable list: the pressed filter is not marked")
    page.click('#cableList [data-filter-purpose="management"]')
    if page.evaluate(LIST_JS)["matching"] != "0":
        bad.append("cable list: os2 and management together should match nothing")
    page.click('#cableList [data-filter-media="os2"]')
    if page.evaluate(LIST_JS)["matching"] != "1":
        bad.append("cable list: management alone should match c2")
    page.click('#cableList [data-filter-purpose="management"]')
    lit = page.evaluate(LIT_JS)
    if page.evaluate(LIST_JS)["matching"] != "3" or lit["front"]["ghost"] or lit["rear"]["ghost"]:
        bad.append("cable list: releasing the filters did not bring every cable back")

    # EDIT reuses the form, opened on the cable's own values.
    page.click(row("c1"))
    wait_sel(page, "cable list: Edit", "#cableEdit")
    page.click("#cableEdit")
    wait_sel(page, "cable list: the form", "#cableForm")
    vals = [page.input_value(s) for s in ("#cMedia", "#cPurpose", "#cLabel", "#cLength", "#cUnit")]
    if vals != ["os2", "uplink", "A1", "2", "m"] or (page.text_content("#cSave") or "") != "Save":
        bad.append(f"cable list: the edit form opens on {vals}")
    page.select_option("#cMedia", "om4")
    page.fill("#cLabel", "A2")
    page.click("#cSave")
    wait_fn(page, "cable list: the edit saved",
            "() => window.__rack.doc().racks[0].cables[0].label === 'A2'")
    c1 = cables()[0]
    if (c1["media"], c1["a"], c1["length"]) != ("om4", {"item": "i2", "path": "port-1", "view": "front"},
                                                {"value": 2, "unit": "m", "source": "entered"}):
        bad.append(f"cable list: after the edit c1 is {c1}")
    wait_fn(page, "cable list: the edited cable stays selected", pressed_js("c1"))
    color = page.eval_on_selector('svg[data-pane="front"] [data-cables] [data-cable-id="c1"]',
                                  "g => [...g.children].filter(n => n.tagName === 'path').pop().getAttribute('stroke')")
    if color != "#2bb3c8":
        bad.append(f"cable list: c1 is drawn {color} after becoming OM4, expected aqua")

    # DELETE takes the cable, its drawing and its derived plug.
    page.click(row("c3"))
    wait_sel(page, "cable list: Delete", "#cableDelete")
    page.click("#cableDelete")
    wait_fn(page, "cable list: c3 deleted", "() => window.__rack.doc().racks[0].cables.length === 2")
    wait_fn(page, "cable list: c3 off the drawing",
            """() => !document.querySelector('svg[data-pane="rear"] [data-cable-id="c3"]')""")
    if page.evaluate(PLUGS_JS, ["rear", "i4"]) != {"lc": 0, "rj45": 0}:
        bad.append("cable list: the deleted cable's plug is still seated on the far demarc")

    # What is left survives a reload (autosave).
    page.evaluate("() => window.__rack.flush()")
    page.reload(wait_until="load")
    page.wait_for_function("() => window.__rack && window.__rack.ready", timeout=READY_MS)
    page.evaluate("() => window.__rack.ready")
    wait_sel(page, "cable list: the list after a reload", "#cableList")
    if [r["id"] for r in page.evaluate(LIST_JS)["rows"]] != ["c1", "c2"]:
        bad.append("cable list: the cables did not survive a reload")
    return bad
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `python3 check-browser.py --only check_rack_cable_list`
Expected: FAIL, `cable list: the list under the summary: … Timeout 60000ms exceeded.`

- [ ] **Step 3: The list**

In `site/rack/cable-panel.js`, replace

```js
import {MEDIA, MEDIA_LABELS, UNITS, mismatch, parseLength} from './cable-rules.js';
```

with

```js
import {MEDIA, MEDIA_LABELS, UNITS, mismatch, parseLength, lengthText, endName, endKey, countsBy,
        matches} from './cable-rules.js';
```

and append:

```js

// THE CABLE LIST (spec §9.4): every cable as a row, stage 5's two filters
// over them, and the selected row's actions. `ends` is cableFacts' Map
// (endKey -> {info, reason}); `on` is the filter, {purpose, media}, null on
// an axis that is not narrowing. A row names both ends, then says what is
// known and what is wrong: a loose end with its reason (spec §9.3), a media
// mismatch as a warning. A row the filter leaves out is hidden; the count
// line says how many match.
export function cableList({rack, ends, on, selectedId = null, onFilter, onSelect, onEdit, onDelete}) {
  const cables = rack.cables;
  const info = e => ends.get(endKey(e))?.info || null;
  const why = e => ends.get(endKey(e))?.reason || null;
  const shown = cables.filter(c => matches(c, on)).length;

  const filterRow = (field, title) => el('div', {class: 'rk-filter', 'data-filter-row': field}, [
    el('span', {class: 'rk-muted', text: title}),
    ...[...countsBy(cables, field)].map(([v, n], k) => {
      const b = el('button', {type: 'button', id: `cableFilter-${field}-${k}`, [`data-filter-${field}`]: v,
        'aria-pressed': String(on[field] === v), text: `${v || 'not set'} (${n})`});
      b.addEventListener('click', () => onFilter({...on, [field]: on[field] === v ? null : v}));
      return b;
    })]);

  const rows = cables.map(c => {
    const picked = c.id === selectedId;
    const row = el('button', {type: 'button', id: `cableRow-${c.id}`, 'data-cable-row': c.id,
      'aria-pressed': String(picked), text: `${endName(rack, c.a)} → ${endName(rack, c.b)}`});
    row.addEventListener('click', () => onSelect(c.id));
    const kids = [row];
    const meta = [c.label, MEDIA_LABELS[c.media] || c.media, c.purpose, lengthText(c.length)].filter(Boolean).join(' · ');
    if (meta) kids.push(el('span', {class: 'rk-cable-meta rk-muted', text: meta}));
    for (const [k, e] of [['a', c.a], ['b', c.b]])
      if (why(e)) kids.push(el('span', {class: 'rk-loose', 'data-loose': k, text: `Loose end ${k.toUpperCase()}: ${why(e)}.`}));
    for (const w of mismatch(c.media, info(c.a), info(c.b)))
      kids.push(el('span', {class: 'rk-warn', 'data-warning': 'true', text: w}));
    if (picked) kids.push(el('div', {class: 'rk-actions'}, [
      button('cableEdit', 'Edit', () => onEdit(c.id)),
      button('cableDelete', 'Delete', () => onDelete(c.id))]));
    const li = el('li', {'data-cable-item': c.id}, kids);
    li.hidden = !matches(c, on);
    return li;
  });

  return el('div', {id: 'cableList', class: 'rk-cables'}, [
    el('h3', {text: 'Cables'}),
    filterRow('purpose', 'Purpose'),
    filterRow('media', 'Media'),
    el('p', {class: 'rk-muted', 'data-filter-count': 'true', 'data-matching': String(shown),
             'data-total': String(cables.length), text: `${shown} of ${cables.length} cables match.`}),
    el('ul', {}, rows),
  ]);
}
```

Append to `site/rack/rack.css`:

```css
/* The cable list, under the summary. A row the filter leaves out is hidden
   (li is a grid here, which would otherwise outrank the hidden attribute). */
.rk-cables { margin-top: 1rem; }
.rk-cables ul { list-style: none; margin: 0.4rem 0 0; padding: 0; display: grid; gap: 0.5rem; }
.rk-cables li { display: grid; gap: 0.2rem; font-size: 0.85rem; }
.rk-cables li[hidden] { display: none; }
.rk-cables [data-cable-row] { text-align: left; }
.rk-cables button[aria-pressed="true"] { border-color: var(--pt-brass); color: var(--pt-brass); }
.rk-cables .rk-warn { margin: 0; }
.rk-filter { display: flex; flex-wrap: wrap; gap: 0.3rem; align-items: center; margin: 0 0 0.4rem; }
.rk-filter button { padding: 0.15rem 0.5rem; font-size: 0.8rem; }
.rk-loose { color: var(--pt-warn); }
```

- [ ] **Step 4: Which cables are lit**

In `site/rack/cable-view.js`, replace

```js
import {cablePlan, endKey, endName, tagText, portPathOf} from './cable-rules.js';
```

with

```js
import {cablePlan, endKey, endName, tagText, portPathOf, matches} from './cable-rules.js';
```

and append:

```js

// WHICH CABLES ARE LIT. The selected cable keeps its paint and every other
// one dims (.cable-focus on the pane, .on on the cable and its tag) - in
// both panes at once, so a cross-face run lights at both ends. A cable the
// list's filter leaves out fades to a ghost (.ghost), as in stage 5. Classes
// only: nothing is redrawn.
export function paintCables(svgs, rack, {selectedId = null, on = {}} = {}) {
  const out = new Set(rack.cables.filter(c => !matches(c, on)).map(c => c.id));
  for (const svg of svgs) {
    svg.classList.toggle('cable-focus', selectedId != null);
    for (const n of svg.querySelectorAll('[data-cable-id]')) {
      n.classList.toggle('on', n.dataset.cableId === selectedId);
      n.classList.toggle('ghost', out.has(n.dataset.cableId));
    }
  }
}
```

- [ ] **Step 5: Wire the list, the selection and the tags into the page**

In `site/rack-page.js`:

Imports. Replace

```js
import {mergeSeats, endKey, sameEnd, paneOf, portFree, canCable, withCable, updateCable, endName,
        proposeMedia, countsBy} from './rack/cable-rules.js';
import {widenForCables, drawRackCables, portAt, markPort} from './rack/cable-view.js';
import {cableForm} from './rack/cable-panel.js';
```

with

```js
import {mergeSeats, endKey, sameEnd, paneOf, portFree, canCable, withCable, updateCable, withoutCable,
        endName, proposeMedia, countsBy} from './rack/cable-rules.js';
import {widenForCables, drawRackCables, portAt, markPort, paintCables} from './rack/cable-view.js';
import {cableForm, cableList} from './rack/cable-panel.js';
```

State. Replace

```js
  cable: {on: false, a: null},
```

with

```js
  cable: {on: false, a: null},
  // The cable list's filter: the viewer's, not the document's.
  cableFilter: {purpose: null, media: null},
```

`setDoc`: a filter belongs to the rack it was set on. Replace

```js
  S.doc = doc; S.sel = null; S.undo = null; S.cable.a = null;
```

with

```js
  S.doc = doc; S.sel = null; S.undo = null; S.cable.a = null;
  S.cableFilter = {purpose: null, media: null};
```

`cableFormPanel`: a saved cable is now left selected, and the list's functions follow it. Replace

```js
    onSave: fields => {
      S.sel = null;
      if (cable) { commit(updateCable(r, cable.id, fields)); return; }
      const ok = canCable(r, a, b);
      if (!ok.ok) { S.notice = {text: ok.reason, kind: 'error'}; render(); return; }
      commit(withCable(r, {a, b, ...fields}).rack);
    },
    onCancel: () => select(null)});
}
```

with

```js
    // A saved cable is left selected: lit on the drawing, its row open in the list.
    onSave: fields => {
      if (cable) { S.sel = {kind: 'cable', id: cable.id}; commit(updateCable(r, cable.id, fields)); return; }
      const ok = canCable(r, a, b);
      if (!ok.ok) { S.sel = null; S.notice = {text: ok.reason, kind: 'error'}; render(); return; }
      const made = withCable(r, {a, b, ...fields});
      S.sel = {kind: 'cable', id: made.cable.id};
      commit(made.rack);
    },
    onCancel: () => select(cable ? {kind: 'cable', id: cable.id} : null)});
}

// ── The cable list (spec §9.4) ──────────────────────────────────────────
// Shown under the summary (or under Cable mode's help) whenever the rack has
// cables. The filter is the viewer's, not the document's: S.cableFilter.
const selectedCable = () =>
  (S.sel?.kind === 'cable' || (S.sel?.kind === 'cable-form' && S.sel.id) ? S.sel.id : null);
function cableListPanel() {
  const r = rack();
  if (!r.cables.length) return null;
  // A filter value no cable has any more (its last cable was edited or
  // deleted) would hide every row with no button left to release it.
  const on = {...S.cableFilter};
  for (const f of ['purpose', 'media']) if (on[f] != null && !countsBy(r.cables, f).has(on[f])) on[f] = null;
  S.cableFilter = on;
  return cableList({rack: r, ends: S.cableFacts.ends, on, selectedId: selectedCable(),
    onFilter: next => {
      S.cableFilter = next;
      renderSide();
      paintCables(S.svgs, r, {selectedId: selectedCable(), on: next});
    },
    // A second click on the selected row lets it go.
    onSelect: id => select(selectedCable() === id ? null : {kind: 'cable', id}),
    onEdit: id => select({kind: 'cable-form', id}),
    onDelete: id => { S.sel = null; commit(withoutCable(r, id)); }});
}
// What the side panel shows with nothing selected, or with a cable selected:
// the summary (or Cable mode's help), then the cable list.
const homePanel = () =>
  el('div', {}, [S.cable.on ? cableModePanel() : summary(), cableListPanel()].filter(Boolean));
```

`render()`: light and ghost what was just drawn. Replace

```js
      for (const svg of S.svgs) drawRackCables(svg, r, reasons);
    }
```

with

```js
      for (const svg of S.svgs) drawRackCables(svg, r, reasons);
      paintCables(S.svgs, r, {selectedId: selectedCable(), on: S.cableFilter});
    }
```

`renderSide()`. Replace

```js
  const r = rack(), sel = S.sel;
  let body;
  if (!sel) body = S.cable.on ? cableModePanel() : summary();
```

with

```js
  const r = rack();
  if (S.sel?.kind === 'cable' && !r.cables.some(c => c.id === S.sel.id)) S.sel = null;   // that cable is gone
  const sel = S.sel;
  let body;
  if (!sel || sel.kind === 'cable') body = homePanel();
```

`onPaneClick`. Replace

```js
  if (S.cable.on) return onCableClick(ev);
```

with

```js
  // A cable, or the tag of one that leaves for the other face, selects that
  // cable - in Cable mode too, where only the tags take clicks (rack.css).
  const cab = ev.target.closest('[data-cable-id]');
  if (cab) return select({kind: 'cable', id: cab.dataset.cableId});
  if (S.cable.on) return onCableClick(ev);
```

`bootInner`. Replace

```js
  $('cableBtn').addEventListener('click', () => setCableMode(!S.cable.on));
```

with

```js
  $('cableBtn').addEventListener('click', () => setCableMode(!S.cable.on));
  // A cable and a tag are focusable: Enter or Space selects, as a click does.
  $('panes').addEventListener('keydown', ev => {
    const cab = ev.key === 'Enter' || ev.key === ' ' ? ev.target.closest?.('[data-cable-id]') : null;
    if (cab) { ev.preventDefault(); select({kind: 'cable', id: cab.dataset.cableId}); }
  });
```

- [ ] **Step 6: Run the checks**

Run: `python3 check-browser.py --only check_rack_cable_list,check_rack_cable_mode,check_rack_cables_drawn,check_rack_menu_and_warnings,check_rack_inspect`
Expected: all five `ok`. `check_rack_cable_mode` still passes with the new cable left selected; `check_rack_menu_and_warnings` proves the summary is unchanged for a rack with no cables.

- [ ] **Step 7: Commit**

```bash
git add site/rack/cable-panel.js site/rack/cable-view.js site/rack-page.js site/rack/rack.css check-browser.py
git commit -m "rack: the cable list - filters that ghost, a row or a tag selects and lights both panes, edit and delete

Each row names both ends by device and U, then says what is wrong: a loose
end with its reason, a media mismatch as a warning. Purpose and media
filter together, as in the showcase's stage 5. Selecting a row, a cable or
a cross-face tag lights that cable in both panes and opens its row; Edit
reuses the cable form.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Cables follow their devices: a move keeps them, a remove asks, a shrink and a changed port leave loose ends with reasons

**Files:**
- Modify: `site/rack/cable-panel.js` (add `removePanel`), `site/rack-page.js`, `check-browser.py` (add `REASONS_JS`, `select_item`, `check_rack_cable_lifecycle`)

**Interfaces:**
- Consumes: `cablesOf`, `withoutCablesOf` from `site/rack/cable-rules.js` (Task 2); `withoutItem` from `site/rack/model.js`; `homePanel()` (Task 8); `window.__rack.cableFacts()` (Task 4); `open_cabled`, `CABLE_FIXTURE`.
- Produces, from `site/rack/cable-panel.js`: `removePanel({item, count, onBoth, onKeep, onCancel}) → HTMLElement` (`#removePanel`, with the buttons `#removeWithCables`, `#removeKeepCables`, `#removeCancel`).
- Produces, in `site/rack-page.js`: `S.sel` gains `{kind: 'remove', id}`; Remove on a device with cables opens that panel instead of `confirm()`; a shrink's notice says how many cables became loose ends.

What this task changes is the remove question and the shrink notice. The other three behaviors in its check already hold after Tasks 2, 4, 5 and 8, and the check pins them:
- a move keeps the cables, because a cable names its item's id;
- a configuration change or an Explorer write-back (both are `patchItem`, with new `swaps`) never prunes a cable; the next redraw reads the face again and gives the end its reason;
- a file whose cable names a port that is no longer there loads with every cable.

- [ ] **Step 1: Write the failing check**

In `check-browser.py`, before `def main():`, add:

```python
REASONS_JS = "() => window.__rack.cableFacts().reasons"


def select_item(page, pane, item):
    # Dispatched to the panel itself: a cable or another device's panel may
    # be drawn over its middle, and onPaneClick reads the same target.
    page.dispatch_event(f'svg[data-pane="{pane}"] [data-item-id="{item}"][data-panel]', "click")
    wait_fn(page, f"select {item}", "() => !!document.getElementById('iLabel')")


@extra("rack.html: cables follow their devices - a move keeps them, a remove asks, a shrink and a changed port leave loose ends with reasons")
def check_rack_cable_lifecycle(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    # Nothing here may open a browser dialog: a device with cables asks in the side panel.
    page.on("dialog", lambda d: (bad.append(f"lifecycle: a browser dialog opened ({d.message!r})"), d.dismiss()))
    try:
        open_cabled(page, base)
    except RuntimeError as e:
        return bad + [f"lifecycle: {e}"]
    doc = lambda: page.evaluate("() => window.__rack.doc().racks[0]")
    reason_is = lambda key, want: (
        f"() => window.__rack.cableFacts().reasons[{json.dumps(key)}] === {json.dumps(want)}")
    before = doc()["cables"]

    # A MOVE keeps the cables: they name the item, not its place.
    select_item(page, "front", "i2")
    page.keyboard.press("ArrowUp")
    wait_fn(page, "lifecycle: leaf-1 moved up", "() => window.__rack.doc().racks[0].items[1].ru === 15")
    if doc()["cables"] != before:
        bad.append("lifecycle: moving a device changed its cables")
    wait_sel(page, "lifecycle: c1 drawn after the move", 'svg[data-pane="front"] [data-cables] [data-cable-id="c1"]')
    if page.get_attribute('svg[data-pane="front"] [data-cables] [data-cable-id="c1"]', "data-loose-lead"):
        bad.append("lifecycle: c1 came loose when its device moved")

    # A CHANGED PORT (a new configuration clears the swaps, as an Explorer
    # change can): the optic is gone, the cable stays, and it says why.
    page.select_option("#iCfg", "ac-b2f")
    wait_fn(page, "lifecycle: port-1 lost its optic", reason_is("i2|front|port-1", "port-1 holds no optic"))
    if len(doc()["cables"]) != 3:
        bad.append("lifecycle: a cable was deleted when its port's optic went")
    wait_sel(page, "lifecycle: c1 hangs loose from its other end",
             'svg[data-pane="front"] [data-cables] [data-cable-id="c1"][data-loose-lead="from"]')
    # The configuration select still has the keyboard, and the page leaves
    # keys typed into a field alone: let go of it before Esc.
    page.evaluate("() => document.activeElement && document.activeElement.blur()")
    page.keyboard.press("Escape")
    wait_sel(page, "lifecycle: the list", "#cableList")
    line = page.text_content('#cableList li[data-cable-item="c1"] [data-loose="a"]') or ""
    if line != "Loose end A: port-1 holds no optic.":
        bad.append(f"lifecycle: the list says {line!r} of c1")

    # A REMOVE asks, in the side panel. Cancel changes nothing.
    select_item(page, "rear", "i3")
    page.click("#iRemove")
    try:
        wait_sel(page, "lifecycle: the remove panel", "#removePanel")
    except RuntimeError as e:
        return bad + [str(e)]
    said = page.text_content("#removePanel") or ""
    if "demarc has 1 cable." not in said:
        bad.append(f"lifecycle: the remove panel reads {said!r}")
    page.click("#removeCancel")
    wait_fn(page, "lifecycle: Cancel returns to the device", "() => !!document.getElementById('iLabel')")
    if len(doc()["items"]) != 4:
        bad.append("lifecycle: Cancel removed the device")
    # Keep: the device goes, its cable stays, loose, and stays listed.
    page.click("#iRemove")
    wait_sel(page, "lifecycle: the remove panel again", "#removeKeepCables")
    page.click("#removeKeepCables")
    wait_fn(page, "lifecycle: demarc (U14) removed", "() => window.__rack.doc().racks[0].items.length === 3")
    if [c["id"] for c in doc()["cables"]] != ["c1", "c2", "c3"]:
        bad.append(f"lifecycle: keeping the cables left {[c['id'] for c in doc()['cables']]}")
    wait_fn(page, "lifecycle: c2's far end is loose", reason_is("i3|front|port-2-1", "the device was removed"))
    wait_sel(page, "lifecycle: the list after the remove", '#cableList li[data-cable-item="c2"] [data-loose="b"]')
    row = page.text_content('#cableList [data-cable-row="c2"]') or ""
    line = page.text_content('#cableList li[data-cable-item="c2"] [data-loose="b"]') or ""
    if row != "leaf-1 (U15) mgmt-eth → a removed device's port-2-1" or line != "Loose end B: the device was removed.":
        bad.append(f"lifecycle: c2 is listed as {row!r} with {line!r}")
    wait_sel(page, "lifecycle: c2 hangs loose on the front",
             'svg[data-pane="front"] [data-cables] [data-cable-id="c2"][data-loose-lead="to"]')
    # Delete: the device and its cable both go.
    select_item(page, "rear", "i4")
    page.click("#iRemove")
    wait_sel(page, "lifecycle: the remove panel for the other demarc", "#removeWithCables")
    page.click("#removeWithCables")
    wait_fn(page, "lifecycle: demarc (U20) removed", "() => window.__rack.doc().racks[0].items.length === 2")
    if [c["id"] for c in doc()["cables"]] != ["c1", "c2"]:
        bad.append(f"lifecycle: deleting its cables left {[c['id'] for c in doc()['cables']]}")

    # A SHRINK that trims a device keeps its cables as loose ends, and Undo brings it all back.
    open_cabled(page, base)
    page.click("#frameBtn")
    page.fill("#fHeight", "3")
    page.dispatch_event("#fHeight", "change")
    wait_fn(page, "lifecycle: shrunk to 3U", "() => window.__rack.doc().racks[0].frame.heightRU === 3")
    if [i["id"] for i in doc()["items"]] != ["i2", "i3", "i4"] or len(doc()["cables"]) != 3:
        bad.append(f"lifecycle: after the shrink the rack holds {[i['id'] for i in doc()['items']]} and {len(doc()['cables'])} cables")
    wait_sel(page, "lifecycle: the shrink notice", ".rk-side .rk-notice")
    note = page.text_content(".rk-side .rk-notice") or ""
    if "core-1" not in note or "1 cable is kept as a loose end." not in note:
        bad.append(f"lifecycle: the shrink notice reads {note!r}")
    wait_fn(page, "lifecycle: c1's far end is loose after the shrink",
            reason_is("i1|front|slot-2/module/p0", "the device was removed"))
    page.click("#undoShrink")
    wait_fn(page, "lifecycle: Undo restores the device", "() => window.__rack.doc().racks[0].items.length === 4")
    wait_fn(page, "lifecycle: c1 lands again after Undo", reason_is("i1|front|slot-2/module/p0", None))

    # A FILE whose cable names a port the slot's part no longer has: the loader
    # keeps the cable, and the reason names the part.
    changed = json.loads(json.dumps(CABLE_FIXTURE))
    changed["id"] = "doc-cable-fixture-changed"
    changed["racks"][0]["name"] = "Cable test, card changed"
    changed["racks"][0]["items"][0]["swaps"] = {}
    open_cabled(page, base, changed)
    if len(doc()["cables"]) != 3:
        bad.append("lifecycle: the loader dropped a cable")
    try:
        wait_fn(page, "lifecycle: a port its card no longer has",
                reason_is("i1|front|slot-2/module/p0", "slot-2 holds A9K Slot Cover, which has no port p0"))
    except RuntimeError as e:
        bad.append(f"{e} (it says {page.evaluate(REASONS_JS).get('i1|front|slot-2/module/p0')!r})")
    return bad
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `python3 check-browser.py --only check_rack_cable_lifecycle`
Expected: FAIL, with `lifecycle: a browser dialog opened ('Remove demarc from the rack?')` and `lifecycle: the remove panel: … Timeout 60000ms exceeded.` The move and the changed-port steps before them pass.

- [ ] **Step 3: The question, as a panel**

In `site/rack/cable-panel.js`, append:

```js

// REMOVING A DEVICE THAT HAS CABLES asks first (spec §9.3), here in the side
// panel: delete its cables with it, or keep them - a kept cable stays in the
// file and in the list with that end loose ("the device was removed").
export function removePanel({item, count, onBoth, onKeep, onCancel}) {
  const n = `${count} cable${count === 1 ? '' : 's'}`;
  return el('div', {id: 'removePanel', class: 'rk-remove'}, [
    el('h3', {text: `Remove ${item.label}`}),
    el('p', {class: 'rk-muted', text: `${item.label} has ${n}. Delete ${count === 1 ? 'it' : 'them'} too, or keep ${count === 1 ? 'it' : 'them'} as ${count === 1 ? 'a loose end' : 'loose ends'}?`}),
    el('div', {class: 'rk-actions'}, [
      button('removeWithCables', `Remove and delete ${n}`, onBoth),
      button('removeKeepCables', `Remove and keep ${n}`, onKeep),
      button('removeCancel', 'Cancel', onCancel)]),
  ]);
}
```

- [ ] **Step 4: Ask it, and say what a shrink kept**

In `site/rack-page.js`:

Imports. Replace

```js
import {mergeSeats, endKey, sameEnd, paneOf, portFree, canCable, withCable, updateCable, withoutCable,
        endName, proposeMedia, countsBy} from './rack/cable-rules.js';
```

with

```js
import {mergeSeats, endKey, sameEnd, paneOf, portFree, canCable, withCable, updateCable, withoutCable,
        cablesOf, withoutCablesOf, endName, proposeMedia, countsBy} from './rack/cable-rules.js';
```

and replace

```js
import {cableForm, cableList} from './rack/cable-panel.js';
```

with

```js
import {cableForm, cableList, removePanel} from './rack/cable-panel.js';
```

`commitFrame`, where the shrink notice is set. Replace

```js
      S.notice = {text, kind: 'note'};
    } else {
      S.undo = null;
```

with

```js
      // A trimmed device's cables are kept (spec §9.3: never silently
      // deleted); each becomes a loose end, and Undo brings its device back.
      const cut = new Set(removed.flatMap(i => cablesOf(r, i.id).map(c => c.id))).size;
      const kept = cut ? ` ${cut} ${cut === 1 ? 'cable is kept as a loose end' : 'cables are kept as loose ends'}.` : '';
      S.notice = {text: text + kept, kind: 'note'};
    } else {
      S.undo = null;
```

`renderSide()`: the new panel. Replace

```js
  else if (sel.kind === 'move') {
```

with

```js
  else if (sel.kind === 'remove') {
    const it = itemById(sel.id);
    if (!it) { S.sel = null; body = homePanel(); }
    else body = removePanel({item: it, count: cablesOf(r, it.id).length,
      onBoth: () => { S.sel = null; commit(withoutCablesOf(withoutItem(r, it.id), it.id)); },
      onKeep: () => { S.sel = null; commit(withoutItem(r, it.id)); },
      onCancel: () => select({kind: 'item', id: it.id})});
  }
  else if (sel.kind === 'move') {
```

and the inspector's Remove. Replace

```js
      onRemove: () => { if (confirm(`Remove ${it.label} from the rack?`)) { S.sel = null; commit(withoutItem(r, it.id)); } },
```

with

```js
      // A device with cables asks in the side panel, where it can offer the
      // choice a dialog cannot (spec §9.3); one without keeps the plain question.
      onRemove: () => {
        if (cablesOf(r, it.id).length) { select({kind: 'remove', id: it.id}); return; }
        if (confirm(`Remove ${it.label} from the rack?`)) { S.sel = null; commit(withoutItem(r, it.id)); }
      },
```

- [ ] **Step 5: Run the checks**

Run: `python3 check-browser.py --only check_rack_cable_lifecycle,check_rack_inspect,check_rack_shrink,check_rack_cable_list`
Expected: all four `ok`. `check_rack_inspect` removes a device with no cables and still answers the plain `confirm()`; `check_rack_shrink` shrinks a rack with no cables and reads the unchanged notice.

- [ ] **Step 6: Commit**

```bash
git add site/rack/cable-panel.js site/rack-page.js check-browser.py
git commit -m "rack: removing a cabled device asks about its cables; a shrink keeps them as loose ends and says so

In the side panel, not a dialog: delete the cables with the device, or keep
them listed with that end loose. A device trimmed by a frame shrink keeps
its cables too, and Undo lands them again. A check pins the rest of spec
§9.3: a move keeps cables, and a port that is gone leaves a loose end with
its reason, never a deleted cable.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: 3D says cables are drawn in 2D; the dev note; wrap-up

**Files:**
- Modify: `site/rack-page.js`, `site/rack/rack.css`, `rack.html` (`#devNote`), `check-browser.py` (add `CABLES_2D`, `check_rack_cables_3d`; edit `check_rack_dev_note`), `docs/superpowers/specs/2026-09-26-rack-builder-design.md` (the status line)

**Interfaces:**
- Consumes: `homePanel()`, `cableListPanel()` (Task 8); `#cableBtn`, `setMode` (Task 7); `open_cabled`, `export_file`, `webgl_trouble`.
- Produces: in 3D, `#cableBtn` is `disabled` with the sentence as its `title`, and `#cable3dNote` shows the same sentence above the cable list; a commit that changes only cables does not rebuild the 3D scene.

- [ ] **Step 1: Write the failing checks**

In `check-browser.py`, before `def main():`, add:

```python
CABLES_2D = "Cables are drawn in 2D for now. Switch to 2D to see them or to add one."


@extra("rack.html: in 3D, Cable mode is off with a sentence saying why; the list still selects, edits and deletes; no export carries cables yet")
def check_rack_cables_3d(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    try:
        open_cabled(page, base)
    except RuntimeError as e:
        return bad + [f"cables 3D: {e}"]
    cables = lambda: page.evaluate("() => window.__rack.doc().racks[0].cables")

    # 2a draws no cable into a file: the sheet has no cable and no derived
    # plug, and its notes say how many cables it leaves out.
    sheet = pathlib.Path(export_file(page, "sheet-svg").path()).read_text(encoding="utf-8")
    for bit in ("data-cable", "data-cable-tags", "generic/lc-plug@2", "generic/rj45-plug@1", "rk-end-pick"):
        if bit in sheet:
            bad.append(f"cables 3D: the sheet carries {bit!r}, and cables are not in the exports yet")
    if "3 cables are not in this export yet." not in sheet:
        bad.append("cables 3D: the sheet's notes do not say its 3 cables are left out")

    no_webgl = webgl_trouble(page)
    page.click("#cableBtn")
    wait_fn(page, "cables 3D: Cable mode on in 2D",
            "() => document.getElementById('cableBtn').getAttribute('aria-pressed') === 'true'")
    page.click('#rkMode [data-mode="3d"]')
    btn = page.eval_on_selector("#cableBtn", "b => ({disabled: b.disabled, pressed: b.getAttribute('aria-pressed'), title: b.title})")
    if btn != {"disabled": True, "pressed": "false", "title": CABLES_2D}:
        bad.append(f"cables 3D: in 3D the Cable button is {btn}")
    try:
        wait_sel(page, "cables 3D: the sentence", "#cable3dNote")
    except RuntimeError as e:
        return bad + [str(e)]
    if (page.text_content("#cable3dNote") or "") != CABLES_2D:
        bad.append(f"cables 3D: the note reads {page.text_content('#cable3dNote')!r}")

    # The list still works: select, edit, delete.
    pressed = lambda cid: (f"""() => document.querySelector('#cableList [data-cable-row="{cid}"]')"""
                           f"""?.getAttribute('aria-pressed') === 'true'""")
    page.click('#cableList [data-cable-row="c1"]')
    wait_fn(page, "cables 3D: a row selects", pressed("c1"))
    page.click("#cableEdit")
    wait_sel(page, "cables 3D: the edit form", "#cableForm")
    page.fill("#cLabel", "B9")
    page.click("#cSave")
    wait_fn(page, "cables 3D: the edit saved", "() => window.__rack.doc().racks[0].cables[0].label === 'B9'")

    # A cable edit changes nothing the 3D view shows, so it does not rebuild the scene.
    scene = None
    if not no_webgl:
        wait_fn(page, "cables 3D: the scene", "() => !!window.__rack.scene()", timeout=READY_3D_MS)
        scene = page.evaluate_handle("() => window.__rack.scene()")
    page.click('#cableList [data-cable-row="c3"]')
    wait_fn(page, "cables 3D: row c3 selects", pressed("c3"))
    page.click("#cableDelete")
    wait_fn(page, "cables 3D: the delete", "() => window.__rack.doc().racks[0].cables.length === 2")
    if scene:
        page.wait_for_timeout(800)          # past the 300 ms a rebuild would wait
        if not page.evaluate("s => window.__rack.scene() === s", scene):
            bad.append("cables 3D: deleting a cable rebuilt the 3D scene")
        scene.dispose()
    else:
        print("[check_rack_cables_3d] WebGL unavailable - the no-rebuild step was not exercised")

    # Back in 2D: the button works again and what is left is drawn.
    page.click('#rkMode [data-mode="2d"]')
    wait_sel(page, "cables 3D: cables back in 2D", 'svg[data-pane="front"] [data-cables] [data-cable-id="c1"]')
    if page.query_selector("#cable3dNote") or page.eval_on_selector("#cableBtn", "b => b.disabled || !!b.title"):
        bad.append("cables 3D: back in 2D the note is still shown or the button is still off")
    if page.query_selector('svg[data-pane="rear"] [data-cable-id="c3"]') or len(cables()) != 2:
        bad.append("cables 3D: the cable deleted in 3D is still drawn in 2D")
    return bad
```

In `check_rack_dev_note`, replace

```python
    for want in ("still being built", "Coming next: cabling."):
        if want not in body:
            bad.append(f"dev note: the note doesn't mention {want!r}")
    if "exports" in body.lower():
        bad.append("dev note: it still lists exports as coming, and they have shipped")
```

with

```python
    for want in ("still being built", "You can cable ports in 2D", "Coming next: cables in the exports and in 3D."):
        if want not in body:
            bad.append(f"dev note: the note doesn't mention {want!r}")
    if "Coming next: cabling." in body:
        bad.append("dev note: it still lists cabling as coming, and it has shipped")
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `python3 check-browser.py --only check_rack_cables_3d,check_rack_dev_note`
Expected: both FAIL.
- `check_rack_cables_3d`: `cables 3D: in 3D the Cable button is {'disabled': False, 'pressed': 'false', 'title': ''}` and `cables 3D: the sentence: … Timeout 60000ms exceeded.`
- `check_rack_dev_note`: `dev note: the note doesn't mention 'You can cable ports in 2D'`.

- [ ] **Step 3: The sentence, the button, and no needless rebuild**

In `site/rack-page.js`:

The sentence. Replace

```js
const CANT_DRAW = "This rack couldn't be drawn. Reload to try again.";
```

with

```js
const CANT_DRAW = "This rack couldn't be drawn. Reload to try again.";
const CABLES_2D = 'Cables are drawn in 2D for now. Switch to 2D to see them or to add one.';
```

`showMode()`. Replace

```js
  $('rkZoom').inert = is3d;
```

with

```js
  $('rkZoom').inert = is3d;
  // Cable mode needs the panes (Phase 2 ruling 7): in 3D the button is off, and says why.
  $('cableBtn').disabled = is3d;
  $('cableBtn').title = is3d ? CABLES_2D : '';
```

`homePanel`. Replace

```js
const homePanel = () =>
  el('div', {}, [S.cable.on ? cableModePanel() : summary(), cableListPanel()].filter(Boolean));
```

with

```js
const homePanel = () => el('div', {}, [
  S.cable.on ? cableModePanel() : summary(),
  // In 3D the list still selects, edits and deletes; nothing is drawn or lit.
  S.mode === '3d' ? el('p', {id: 'cable3dNote', class: 'rk-muted', role: 'status', text: CABLES_2D}) : null,
  cableListPanel()].filter(Boolean));
```

`commit`. Replace

```js
function commit(nextRack) {
  S.undo = null;
  S.doc = {...S.doc, racks: [nextRack]};
  S.save.saveSoon(S.doc);
  render();
  scheduleRebuild3d();
}
```

with

```js
function commit(nextRack) {
  // A cable edit (cable-rules.js returns {...rack, cables}) leaves the items
  // array and the frame the very same objects, as a rename does. The 3D view
  // draws neither cables nor the name, so such a commit has nothing to
  // rebuild there; the scene is kept and re-pointed at the new rack, so an
  // export does not take it for stale.
  const prev = rack();
  const sameScene = nextRack.items === prev.items && nextRack.frame === prev.frame;
  S.undo = null;
  S.doc = {...S.doc, racks: [nextRack]};
  S.save.saveSoon(S.doc);
  render();
  if (!sameScene) scheduleRebuild3d();
  else if (S.scene3dRack === prev) S.scene3dRack = nextRack;
}
```

Append to `site/rack/rack.css`:

```css
.rk-bar button:disabled { opacity: 0.5; cursor: not-allowed; }
```

- [ ] **Step 4: The dev note**

In `rack.html`, replace

```html
        <p>Coming next: cabling.</p>
```

with

```html
        <p>You can cable ports in 2D: press Cable, then click the port at each end.</p>
        <p>Coming next: cables in the exports and in 3D.</p>
```

Run: `python3 check-browser.py --only check_rack_cables_3d,check_rack_dev_note,check_rack_3d,check_rack_export_overtaken,check_rack_mode_toggle_stable`
Expected: all five `ok`. `check_rack_export_overtaken` proves an export still notices a scene that an edit to the devices overtook.

- [ ] **Step 5: Run the whole suite from a clean start**

Run: `node --test tests/rack/*.test.mjs && ./chassis-index.py && git diff --exit-code site/rack/chassis.json && python3 check-contract.py && python3 check-browser.py`
Expected:
- 109 node tests pass, including the `cables` and `cable-media` suites;
- `contract: 292 checks passed`;
- the browser suite lists every new `ok`: cables moved, cable plugs, cable colors, cables drawn, cable form, cable mode, cable list, cable lifecycle, cables 3D, and the dev note; and the showcase's stages and the hero are unchanged.

If a showcase 3D or page-load check times out, re-run it on `main`. It is environmental only if it fails there too (issue #59).

- [ ] **Step 6: Check the whole flow by hand, as a user would, at `http://localhost:8932/rack.html`**

1. Build a small rack: a four-post frame, 24U; an AS7726 at U14 front with an optic seated in port 1 through Explorer; an ASR-9006 at U2 with a 16x100GE card in slot 2 and an optic in its first port; a TM-280 at U14 rear.
2. Press **Cable**. Click the AS7726's optic, then the card port's optic. The form offers OS2. Add the cable: it hangs between the two, yellow, with an LC plug in each bore.
3. Click the AS7726's management jack, then a copper port on the TM-280 in the rear pane. The form offers Cat 6A. Add it: each pane hangs it off to the middle column, with a tag naming the other end. Both panes are the same size and the U numbers line up.
4. Click an empty cage, then a copper port. The form warns nothing (an empty cage says nothing), and the cable is listed with "Loose end A: port-N holds no optic."
5. Leave Cable mode. Click a tag: the cable lights in both panes and its row opens. Filter by media, then by purpose.
6. Zoom in and out with the buttons and with ctrl+wheel, then Fit.
7. Open the AS7726 in Explorer, remove the optic, press Done: the cable stays, loose, with its reason.
8. Remove the TM-280: the side panel asks about its cable. Keep it, and read the row.
9. Switch to 3D: the Cable button is off and the panel says why. Edit a cable's label from the list.
10. Save as .json, reload the page, open the file: every cable is back.
11. Export the sheet: no cables and no plugs in it, and its notes say how many cables are left out.

- [ ] **Step 7: Mark the phase in the spec and commit**

In `docs/superpowers/specs/2026-09-26-rack-builder-design.md`, change the end of the `**Status:**` line from `Phase 2 (cabling) next` to:
`Phase 2a (cabling on the page) implemented (plan: docs/superpowers/plans/2026-10-03-rack-builder-phase2a-cabling.md); Phase 2b (cables in the exports and in 3D) next`

```bash
git add site/rack-page.js site/rack/rack.css rack.html check-browser.py docs/superpowers/specs/2026-09-26-rack-builder-design.md
git commit -m "rack: Phase 2a is implemented - cabling on the page; 3D says cables are drawn in 2D for now

In 3D the Cable button is off with a sentence saying why, and the list
still selects, edits and deletes. A commit that changes only cables no
longer rebuilds the 3D scene, which draws none yet. The dev note says what
works and what is next: cables in the exports and in 3D.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Rulings the plan could not follow

None was impossible against the code. Two are followed with a refinement the code called for:

- **Ruling 2, "connector types with no known plug (DAC, MPO, unknown) get no plug and the cable ends at the port's own center."** They get no plug, as ruled. But a seated DAC or AOC end carries its own cable point in the drawing (25 component skins do, not only the three plugs), so a cable to one lands on that point, which is where the real cable leaves. The port's center is the fallback when nothing at the port carries a cable point (an MPO adapter, a fixed port with no slot). `cable-view.js`'s header says so.
- **Constraint, "a port click resolves to the outermost `data-class="port"` ancestor."** That is the rule for anything inside a port. A seated optic and its plugs are not inside their cage: `vendor/swap.js` draws them beside it, at `<port>-occupant`. So a click on an optic, or on a plug seated over a jack, has no port ancestor at all. `portAt` applies the ancestor rule, and also maps an `-occupant` path back to its port (`portPathOf`), accepting it only if that port is drawn.

## Not in Phase 2a (so nobody adds it here)

- **Cables in any export.** The cable schedule CSV, cables on the SVG sheet and PNG, draw.io edges (the Rack Builder's and stage 6's), cable lines in the BOM, and NetBox or Nautobot cable import are **Phase 2b** (spec §9.4). `rackNotes` keeps saying "N cables are not in this export yet", and the derived plugs are not drawn in any file.
- **Cables in 3D.** No tubes in the live scene and none in the GLB or USDZ, and no `site/rack3d.js` change. In 3D the page says cables are drawn in 2D for now. Phase 2b.
- **Breakouts.** One cable per port: a QSFP split into four is not modeled.
- **Cable managers, bundling, lacing bars, and cables between racks** (spec §9.5).
- **Routing.** `route` is preserved by the loader and read by nothing; `length.source` stays `entered` (spec §9.6). No length estimate.
- **Plugs as parts.** A derived plug is drawing, not inventory: it is not in `item.swaps`, the BOM or the DCIM exports, and Explorer does not show it.
- **Plugs for connectors other than LC, duplex LC and RJ45.** An MPO, SC or coax end gets no derived plug; its cable ends at the port.
- **A version bump of the rack file.** `cables` was already in version 1, and the cable object is additive.
- **Zero-U items as cable ends.** The catalog has none.
- **The showcase's own cables.** Stages 4 to 6 and the hero draw exactly as before, through the re-export.
