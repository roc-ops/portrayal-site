# Using the kit: an embedder's guide on portrayal.dev

Date: 2026-09-26. Status: approved 2026-09-26, pending written-spec review.

## 1. Why

The site documents the schema (`schema.html`), which is the authoring side. Nothing documents the consumer side: how to use Portrayal's drawings and `@portrayal/kit` in your own web page, in 2D and in 3D.

The kit's own README is a one-line-per-module table and the three.js import-map note. Its code has almost no JSDoc: `shell.js` has none, and `viewer3d.js` documents one function.

**Audience: embedders.** These are developers putting Portrayal drawings and 3D views into their own web apps, such as NOC dashboards, DCIM front ends and internal tools. They want to:
- load a device;
- color a port from telemetry;
- highlight a part;
- show it in 3D;
- export.

Kit internals are not for them.

**Success looks like this:**
- An embedder can go from nothing to a live, telemetry-colored drawing and a 3D view by copying code from one page.
- Every piece of code on the page provably runs against the kit the site vendors.
- A Portrayal sync that breaks an example fails the checks before anyone reads a stale page.

## 2. Approach

Approach A, as chosen: a hand-written, task-ordered page of recipes. Each recipe runs live beside its code.

Rejected:
- **(B) A generated API reference:** there is little JSDoc to draw on, and about 150 exports, most of them internals.
- **(C) Upstream-first docs in Portrayal's `kit/`:** revisit when the kit moves to its own repository.

## 3. The page: `kit.html`, "Using the kit"

Layout follows `schema.html`: the masthead, a left table of contents, one long scrolling page, and the footer with the sponsor credit. American English.

Every section has the same shape:
1. one or two sentences on what it's for;
2. the code;
3. the live result.

Sections, in order:

1. **Start here.**
   - The compiled files: one SVG per device face (`<device>.<config>.<view>.svg`), plus `devices.json`, `components.json` and a `configs.json` per device.
   - The kit is plain ES modules with no build step.
   - three.js is needed only for 3D.
2. **The drawing is the API.** No kit.
   - Fetch `s9600-72xc.base.front.svg` and insert it into the page.
   - Find `port-12` by `data-path`.
   - Light a lamp with a `state-on` class, then with an inline `--led-color`.
   - Color a set of ports from a small fake telemetry table.
   - A click reports the clicked part's `data-path`.
3. **Read the device from the drawing.**
   - The source manifest embedded in the SVG's `<metadata>`: configurations and chassis size.
   - `devices.json` to list the library, fetched with `jdist` from `@portrayal/kit/dist`.
4. **Seat an optic or a cable end.**
   - `applyFaceOverrides` from `@portrayal/kit/swap` seats a real transceiver in a cage, using the device's `configs.json` cages and the component index.
   - `encodeSwaps` puts that state in a URL.
5. **In 3D.**
   - `createViewer(el, {dist})` from `@portrayal/kit/viewer3d`, then `load({device, config})`;
   - `select('port-12')`;
   - `setStates({...})`;
   - `setFields`;
   - `download('glb')`;
   - the three.js import map.
6. **Annotate and export.**
   - A marks document: `select`, `color`, `state`, `label`.
   - `apply`, then `toSvg` / `toPng` / `toGif`.
   - `encode` into a share URL, all from `@portrayal/kit/marks`.
7. **The Explorer shell, as a drop-in.** `createShell` from `@portrayal/kit/shell`: the minimum to mount it. It is brief, and links to `explorer.html` as the full example.
8. **Getting the files.**
   - Today: copy the kit's modules and the compiled files, or point at a copy, and add the import map.
   - Planned: `@portrayal/kit` on npm, and a registry for the compiled files (roc-ops/Portrayal#526, #527, #528).
   - The section says plainly that distribution is being settled, and is to be updated when those land.

**Out of scope:**
- kit internals (`relief.js`, `lamps.js`, the bulk of `swap.js`, `states.js`' census helpers);
- YAML authoring, which is the Schema page's;
- any upstream change;
- npm publishing;
- `coming-soon/`, which stays untouched, so merging does not change portrayal.dev.

## 4. How the live examples work

**One file per example**, in `site/kit-examples/`:
- files: `01-drawing.js`, `02-telemetry.js`, `03-metadata.js`, `04-seat.js`, `05-viewer3d.js`, `06-marks.js`, `07-shell.js`, in `site/kit-examples/`;
- each exports `async function run(host)` and returns a small result object;
- the page fetches the file's text to display it and imports the same file to run it, so what is shown is exactly what runs.

**Real package specifiers:**
- Examples import as an embedder would: `import {createViewer} from '@portrayal/kit/viewer3d'`.
- `kit.html` carries an import map: `@portrayal/kit/` → `./vendor/`, plus `three` and `three/addons/` → `./vendor/three/…`.
- Section 8 shows the same mechanism pointed at the reader's own copy.

**`DIST`:** each example begins with `const DIST = 'assets/dist/';  // wherever you host the compiled files`.

**Running:**
- **2D examples** run when scrolled into view, via an IntersectionObserver. Each pane has "Run again", which clears the pane and reruns, and "Copy", which copies the code.
- **The 3D example** builds only on a click, as the hero's 3D panel does. It goes through `site/webgl.js`' `guard3d`, so a browser without WebGL shows the reason, not a black box.
- **A failing example** shows its error in its pane and does not take the page down.

**Code display:**
- a `<pre><code>` with light keyword/string/comment coloring from a small local highlighter;
- no third-party library;
- colors are theme tokens, in light and dark.

**Page script:** `site/kit-page.js` wires the table of contents, the fetch-and-display, the observers and the buttons.

## 5. Navigation: a Docs menu

The header is full, so "Schema" becomes a **Docs ▾** menu with "Schema" and "Using the kit". It uses the same `<details class="navmenu">` pattern as Export, on every page carrying a nav:
- the masthead pages (`index.html`, `schema.html`, `kit.html`);
- the tool-bar pages (`explorer.html`, `components.html`, `annotate.html`, `drawio.html`, `exporter.html`, `drawings.html`).

`aria-current` / `data-here` marks the page you are on.

This depends on roc-ops/portrayal-site#45 (the menu label alignment fix). The Docs menu must land on or after it.

## 6. Keeping it accurate: checks

**`check-contract.py`:**
- For every example, each `@portrayal/kit/<m>` import names a module that exists as `vendor/<m>.js`.
- Every imported name is an `export` of that module.
- `kit.html` references every file in `site/kit-examples/`, and every example it references exists.
- The Docs menu is present, with both entries, on every page listed in §5.

So a sync that renames or removes something an example uses fails the contract.

**`check-browser.py`:**
- Load `kit.html` and run every 2D example.
- Assert each returns its expected result, for example:
  - `{lit: ['port-12'], clicked: 'port-12'}`;
  - `{colored: N}`;
  - `{configs: [...]}`;
  - `{seated: 1}`;
  - `{marks: 3, svgBytes: >0}`;
  - `{shell: true}`.
- Assert no console errors.
- Click the 3D example: it must report `{loaded: true, selected: 'port-12'}`.
- Without WebGL, skip with a stated reason, as the hero checks do.
- `kit.html` joins the page sweep.

## 7. Risks

- **Examples drifting from the kit.** Mitigated by §6.
- **The 3D example's cost on the page.** It is click-gated, and nothing loads until asked.
- **Section 8 going stale** when npm or the registry land. It names the issues, so an update is a known follow-up.
