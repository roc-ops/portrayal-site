# Showcase Staged Rack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the seven-tab showcase with a spine of seven ordered stages that build one rack up, demoting the four 2D lenses to spokes reached from a device and retiring the Runbook.

**Architecture:** `site/showcase.js` (1213 lines, seven sibling tabs over module globals) is split into an artifact layer, a stage rail, one module per stage and one per spoke. Stages are ordered and cumulative; the rail replaces the tab strip. Stages 0–3 build the cast rack in 3D; stage 4 cuts to the ROADM ring from `labs.json` as a second, real rack.

**Tech Stack:** Vanilla ES modules, no bundler, no npm. three.js via `site/rack3d.js`. Python 3.12 for the checks. Playwright for `check-browser.py`.

**Spec:** `docs/superpowers/specs/2026-09-24-showcase-staged-rack-design.md`

## Global Constraints

- **Nothing fabricates data.** The standing rule at the top of `site/showcase.js`: labels, states and component references are read off the compiled SVG's own attributes, and a state is only applied to an element that declares it in `data-states`. This forbids hand-authored links in stage 4 and is why stage 4 uses the ROADM ring.
- **There is no npm, no `package.json`, no JS test runner.** The test surface is `python3 check-contract.py` (file-level, ~1s), `python3 check-browser.py` (Playwright, ~2min, starts its own server on a free port), and the 25 in-page checks in `marks-harness.html`. "Write the failing test" means adding a `check(...)` to `check-contract.py` or a page-drive to `check-browser.py`.
- **`check(cond, what, detail="")`** is the contract's only assertion helper. `detail` is printed *only on failure*.
- **Never `git stash` bare.** The stash stack is shared across worktrees. Use a WIP commit, or `git stash push -u -m "<unique-tag>"`.
- **Ports 8177 and 8178 are the user's long-running servers** on the real checkout. Do not kill them. For your own preview use `python3 serve.py <free-port>` and pick something nobody owns; several 89xx ports were taken on 2026-09-24.
- **Do not "fix" `.gitignore:26`.** It deliberately negates one tracked PNG that `site/hero-reveal.js` uses as the front-page hero.
- **Spelling:** this repo writes `artifact`, `color`, `center` (American) but `behaviour` and `fibre` (British). Match the file you are editing.
- **`labs.json` gets a hard `cp`, never the soft `[ -f … ] &&` loop.** See Task 7.
- **The `epoch` guard is lifted verbatim.** Every `enter()` that awaits must check `stale(mine)` after each await.

---

## File Structure

| file | responsibility |
|---|---|
| `site/showcase/artifact.js` | **Create.** The compiled drawing and everything over it: load, frame, pan/zoom, overlay, states, exports, panel builders. Today's module globals, made explicit. |
| `site/showcase/stage-rail.js` | **Create.** Stage order, progression, activation, the `epoch` guard, `data-stage-ready`. |
| `site/showcase/stages/00-rails.js` … `06-takeaway.js` | **Create.** One per stage, each `{title, question, enter(), exit()}`. |
| `site/showcase/spokes/inspect.js`, `callouts.js`, `state.js`, `select.js` | **Create.** The four 2D lenses, moved from `showcase.js`, parameterized by device. |
| `site/showcase/rack.js` | **Create.** The cast rack: stack definition, `loadMeta`, 2D elevation, 3D mount. Extracted from the `rack` tab. |
| `site/showcase.js` | **Modify.** Becomes the entry point: import the rail, wire the buttons, boot. Everything else moves out. |
| `index.html` | **Modify.** Tab strip → stage rail. Runbook button deleted. |
| `refresh-assets.sh` | **Modify.** Hard `cp` for `labs.json`. |
| `check-contract.py` | **Modify.** Six new assertions. |
| `check-browser.py` | **Modify.** Drive the rail. |

**Why these boundaries:** files that change together live together. A stage owns its question, its overlay and its panel, so a stage is one file. The four lenses share nothing with each other but everything with `artifact.js`, so they are siblings over a common layer. `rack.js` is separate from the stages because stages 0–4 all mount it.

### The `artifact.js` export surface

Every stage and spoke imports from here. Exact names, because a task's implementer sees only their own task:

```js
// live state — reassigned by loadDrawing()
export let svg, overlay, BASE_FRAME;
export let VIEW, CONFIG;
// constants
export const DEV = 'as7726-32x', CFG = 'ac-f2b', DIST = 'assets/dist/';
export const VIEWS, CONFIGS;
// dom handles
export const stage2d, stage3d, stageRack, loading, panel, hint, srcLine, exportSlot;
// dom helpers
export function el(tag, attrs = {}, kids = []);
export function svgEl(tag, attrs = {});
// the drawing
export async function loadDrawing();
export async function setDrawing(view, config);
export function node(path);                       // -> Element | null
export function box(path);                        // -> {x,y,width,height} | null
// frame
export function setFrame(x, y, w, h);
export function resetFrame();
export function panZoom(node, baseFrame);         // baseFrame is a () => [x,y,w,h]
// overlay
export function ring(path, cls = 'pt-ring', pad = 0.9);
export function clearOverlay();
// states
export function declared(path);                   // -> string[]
export function setState(path, state);            // -> boolean, false if refused
export function clearStates();
// exports
export function setExports(items);                // items: [{label, title?, run}]
export function save(data, filename, type);
export function saveSvg(node, filename);
export function standalone(node);
// panel
export function title(t);
export function lead(html);
export function kv(rows);                         // rows: [[key, value, highlight?]]
export function controls(defs);                   // defs: [{label, toggle?, run(btn, wrap)}]
export function setPanel(...kids);
```

**ES module live bindings gotcha — read this before Task 1.** `loadDrawing()` reassigns `svg`, `overlay` and `BASE_FRAME`. `export let` gives importers a *live binding*, so `import {svg} from './artifact.js'` reads the current value on every access and the move stays mechanical. But this only works if consumers **never destructure at module top level** and never cache it:

```js
// CORRECT — reads the live binding at call time
import {svg, node} from '../artifact.js';
function paint() { svg.addEventListener('click', onClick); }

// WRONG — captures the value at import time, before any drawing is loaded
import * as A from '../artifact.js';
const {svg} = A;                       // svg is undefined forever
```

If this bites, the fix is an accessor (`export const current = () => ({svg, overlay, BASE_FRAME})`), but do not pre-emptively introduce it in Task 1 — Task 1 must be a pure move with no behavior change.

---

## Task 1: Extract `artifact.js`

A pure move. Nothing changes on screen; the seven tabs still work exactly as before. The reviewer's gate is "the diff is mechanical and both checks still pass."

**Files:**
- Create: `site/showcase/artifact.js`
- Modify: `site/showcase.js:1-305` (the helpers move out; the tabs stay for now)

**Interfaces:**
- Consumes: nothing.
- Produces: the full export surface above. Tasks 2–10 all import from it.

- [ ] **Step 1: Write the failing test**

Add to `check-contract.py`, in a new section before `# ── report ──`:

```python
# ── the showcase is modules, not one file ────────────────────────────────
# showcase.js was 1213 lines holding seven tabs over shared globals. A stage
# or a spoke that needs the drawing imports it; it does not reach for a global
# that happens to be in scope. Asserted on the file layout because the
# behaviour needs a browser and this check must stay under a second.
art = HERE / "site" / "showcase" / "artifact.js"
check(art.is_file(), "site/showcase/artifact.js exists",
      "the artifact layer has not been extracted yet")
if art.is_file():
    a = art.read_text()
    for name in ("loadDrawing", "setDrawing", "panZoom", "setExports", "setPanel"):
        check(f"export function {name}" in a or f"export async function {name}" in a,
              f"artifact.js exports {name}",
              f"{name} is still private to showcase.js")
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `python3 check-contract.py`
Expected: `contract: 54 checks passed, 1 FAILED` naming `site/showcase/artifact.js exists`.

- [ ] **Step 3: Create `site/showcase/artifact.js`**

Move, verbatim, from `site/showcase.js`: the `DEV`/`CFG`/`DIST`/`VIEW`/`CONFIG`/`src`/`VIEWS`/`CONFIGS` block (lines 12–32), `$`/`el`/`svgEl` (34–48), the stage handles (50–58), `loadDrawing`/`setDrawing` (61–95), `node`/`box` (99–119), the frame block and `panZoom` (121–180), `ring`/`declared`/`setState`/`clearStates` and `clearOverlay` (182–210), the export block (211–280) and the panel builders (281–304).

Add `export` to each declaration. Keep the comments — they carry the reasoning and several are load-bearing (the `getBBox`-walks-the-CTM note, the "pan and zoom ride on top" note, the `preserveAspectRatio` note).

`src()` stays private; `loadDrawing` and `setDrawing` are the only callers.

- [ ] **Step 4: Rewire `site/showcase.js`**

Replace the moved lines with one import naming everything the remaining seven tabs use:

```js
import {
  svg, overlay, BASE_FRAME, VIEW, CONFIG, DEV, CFG, DIST, VIEWS, CONFIGS,
  stage2d, stage3d, stageRack, loading, panel, hint, srcLine, exportSlot,
  el, svgEl, loadDrawing, setDrawing, node, box,
  setFrame, resetFrame, panZoom, ring, clearOverlay,
  declared, setState, clearStates,
  setExports, save, saveSvg, standalone,
  title, lead, kv, controls, setPanel,
} from './showcase/artifact.js';
```

`index.html` already loads `site/showcase.js` as a module — confirm with `grep -n 'showcase.js' index.html` and check for `type="module"`. If it is not a module, add it, because a bare script cannot `import`.

- [ ] **Step 5: Run both checks**

Run: `python3 check-contract.py`
Expected: `contract: 60 checks passed` (54 + the 6 new).

Run: `python3 check-browser.py`
Expected: `browser: 13 checks passed, 12 pages and 25 in the marks harness`. A `404 /site/showcase/artifact.js` here means the import path is wrong; an `uncaught: ... is not defined` means a name was missed in the import list.

- [ ] **Step 6: Verify by eye, on your own port**

Run: `python3 serve.py 8967` and open `http://localhost:8967/index.html`. Click all seven tabs. Each must behave exactly as before — this task changed no behavior.

- [ ] **Step 7: Commit**

```bash
git add site/showcase/artifact.js site/showcase.js check-contract.py index.html
git commit -m "showcase: extract the artifact layer, no behaviour change

The drawing and everything over it - load, frame, pan/zoom, overlay,
states, exports, panel builders - moves to site/showcase/artifact.js so a
stage or a spoke can import it instead of relying on a module global that
happens to be in scope. The seven tabs are untouched and still work.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 2: Re-home the four lenses as spokes, and drop the Runbook

The four lenses move to `spokes/` and are parameterized by device. The Runbook is **not carried across** — that is the retirement. Doing both in one task is deliberate: retiring it separately would mean editing line numbers this move has already shifted, which is how a half-retirement ships.

**Files:**
- Create: `site/showcase/spokes/inspect.js`, `callouts.js`, `state.js`, `select.js`
- Modify: `site/showcase.js` — the four IIFEs leave, `runbook` is deleted, `TABS` and `NEEDS_DEFAULT` updated
- Modify: `index.html:125` — delete the Runbook button
- Modify: `check-contract.py`

**Interfaces:**
- Consumes: the whole `artifact.js` surface from Task 1.
- Produces: each spoke module default-exports a factory:
  ```js
  export default function makeSpoke({dev, cfg}) {
    return {hint: '<string>', enter(): Promise<void>|void, exit(): void};
  }
  ```
  `dev` is a device ref string (`'asr-9006'`), `cfg` a configuration id (`'ac-f2b'`). Task 4's rail and Task 5's stages construct these. Until Task 4 lands, `showcase.js` calls each factory once with `{dev: DEV, cfg: CFG}` so the tabs keep working.

- [ ] **Step 1: Write the failing test**

Add to `check-contract.py`, in the same section as Task 1:

```python
# THE RUNBOOK IS RETIRED. Its content was hand-written, AS7726-specific MOP
# prose rather than a lens over compiled data, so no stage regenerates it. A
# half-retirement - the module gone and the button still shipping, or the
# reverse - is the failure worth guarding, so both sides are asserted.
idx = (HERE / "index.html").read_text()
check('data-tab="runbook"' not in idx, "index.html has no Runbook tab button")
for f in sorted((HERE / "site" / "showcase").rglob("*.js")) + [HERE / "site" / "showcase.js"]:
    check("runbook" not in f.read_text().lower(),
          f"{f.relative_to(HERE)} has no Runbook reference",
          "the tab is retired; a dangling reference is a half-retirement")

# The four 2D lenses are spokes now - reached from a device in the rack, not
# siblings in a tab strip. Each is its own file and takes the device as an
# argument, because the same lens is used on four different devices.
for s in ("inspect", "callouts", "state", "select"):
    p = HERE / "site" / "showcase" / "spokes" / f"{s}.js"
    check(p.is_file(), f"spoke {s}.js exists", "not re-homed yet")
    if p.is_file():
        check("export default function" in p.read_text(),
              f"spoke {s}.js default-exports a factory",
              "a spoke must take {dev, cfg} so it can serve more than one device")
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `python3 check-contract.py`
Expected: FAILs for the four missing spoke files, the four factory checks, and `index.html has no Runbook tab button`.

- [ ] **Step 3: Move `inspect` to a spoke**

Create `site/showcase/spokes/inspect.js`. Take `site/showcase.js:307-376` and wrap it:

```js
import {
  svg, node, box, ring, clearOverlay, resetFrame, setFrame, setDrawing,
  el, svgEl, declared, setState, clearStates, setExports, saveSvg,
  title, lead, kv, controls, setPanel, VIEWS, CONFIGS, VIEW, CONFIG,
} from '../artifact.js';

export default function makeInspect({dev, cfg}) {
  // ... the IIFE's private lets, unchanged ...
  return {
    hint: '…',                        // copied verbatim
    enter() { /* body, with `DEV` -> `dev` and `CFG` -> `cfg` */ },
    exit() { /* body */ },
  };
}
```

The only edits inside the body are `DEV` → `dev` and `CFG` → `cfg`. Everything else is verbatim, including the export filenames (`` `${dev}.${CONFIG}.${VIEW}.selection.svg` ``).

- [ ] **Step 4: Move `callouts`, `state` and `select` the same way**

`callouts` is `site/showcase.js:378-503`, `state` is `505-586`, `select` is `588-639`. Same wrapper, same `DEV` → `dev` / `CFG` → `cfg` substitution. Do not refactor their internals — a behavior change hidden inside a move is the expensive kind to find.

- [ ] **Step 5: Delete the Runbook and rewire**

In `site/showcase.js`: delete lines 640–695 (the `runbook` IIFE and its section comment). Then:

```js
import makeInspect  from './showcase/spokes/inspect.js';
import makeCallouts from './showcase/spokes/callouts.js';
import makeState    from './showcase/spokes/state.js';
import makeSelect   from './showcase/spokes/select.js';

const inspect  = makeInspect({dev: DEV, cfg: CFG});
const callouts = makeCallouts({dev: DEV, cfg: CFG});
const state    = makeState({dev: DEV, cfg: CFG});
const select   = makeSelect({dev: DEV, cfg: CFG});

const TABS = {inspect, callouts, state, select, three, rack};
const NEEDS_DEFAULT = new Set(['callouts', 'state', 'select']);
```

In `index.html`, delete line 125. Then check line 105, which reads "Six of the tabs below drive a single compiled artifact" — with the Runbook gone that becomes **five**. Fix the prose; a stale count in the copy is the kind of thing that survives for months.

- [ ] **Step 6: Run both checks**

Run: `python3 check-contract.py`
Expected: all green, count risen by 11.

Run: `python3 check-browser.py`
Expected: 13 passed. An `uncaught` naming `runbook` means a reference survived; the contract should have caught it first.

- [ ] **Step 7: Verify by eye**

`python3 serve.py 8967`. Six tabs, no Runbook. Each of the four lenses behaves as before.

- [ ] **Step 8: Commit**

```bash
git add site/showcase/spokes/ site/showcase.js index.html check-contract.py
git commit -m "showcase: the four 2D lenses become spokes, and the Runbook retires

Inspect, Callouts, Live state and Select move to site/showcase/spokes/ and
take {dev, cfg}, because the staged spine uses the same lens on four
different devices rather than one lens on one hardcoded box.

The Runbook is not carried across. Its content was hand-written,
AS7726-specific MOP prose rather than a lens over compiled data, so nothing
in the staged design regenerates it. Retired in the same commit as the move
so there are no line numbers to chase afterwards, and asserted from both
sides - no module reference and no tab button - because a half-retirement
ships a dead button.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 3: The stage rail, and stage 0 (Rails)

The rail replaces the tab strip. Stage 0 draws empty rack rails at true scale and answers "is this to scale?". `three` and `rack` tabs are removed here, because stages 1–3 absorb them.

**Files:**
- Create: `site/showcase/stage-rail.js`, `site/showcase/stages/00-rails.js`, `site/showcase/rack.js`
- Modify: `site/showcase.js`, `index.html`, `site/site.css`, `check-contract.py`

**Interfaces:**
- Consumes: `artifact.js`.
- Produces:
  ```js
  // stage-rail.js
  export const STAGES = ['rails','mount','populate','optics','cable','filter','takeaway'];
  export async function activate(name);      // by stage name
  export function stale(mine);               // epoch guard, lifted verbatim
  export let epoch;
  export async function boot();
  // every stage module
  export default function makeStage() {
    return {title: '<string>', question: '<string>', enter(): Promise<void>, exit(): void};
  }
  // rack.js
  export const CAST;                         // [{ref, cfg, ru, label}]
  export async function loadMeta();
  export function chassisOf(ref);            // -> {w,h,d,ru}
  export function baysOf(ref);               // -> {bayId: {...}}
  export async function mount3d({stack, heightRU, overrides}); // -> scene | null
  export async function build2dElevation({stack, heightRU});   // -> SVGElement
  ```
  `mount3d` wraps `guard3d` + `createRackScene` and returns `null` when WebGL is unavailable, having already shown the reason via `loading`.

- [ ] **Step 1: Write the failing test**

```python
# THE RAIL'S STAGE LIST IS NAMED, NOT GLOBBED - the same rule PAGES follows in
# check-browser.py, and for the same reason: a stage added should be a line in
# a diff, and a stage that goes away should fail this check rather than quietly
# stop being reachable. So the list and the directory must agree exactly.
rail = (HERE / "site" / "showcase" / "stage-rail.js")
check(rail.is_file(), "site/showcase/stage-rail.js exists")
if rail.is_file():
    r = rail.read_text()
    m = re.search(r"export const STAGES\s*=\s*\[(.*?)\]", r, re.S)
    check(bool(m), "stage-rail.js declares STAGES", "the rail needs an explicit order")
    if m:
        listed = re.findall(r"'([a-z0-9-]+)'", m.group(1))
        on_disk = sorted(p.stem.split("-", 1)[1]
                         for p in (HERE / "site" / "showcase" / "stages").glob("*.js"))
        check(sorted(listed) == on_disk,
              "the rail's STAGES match the stage modules on disk",
              f"listed {sorted(listed)} but found {on_disk}")
        check(len(listed) == 7, "there are seven stages", f"found {len(listed)}")
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `python3 check-contract.py`
Expected: FAIL on `site/showcase/stage-rail.js exists`.

- [ ] **Step 3: Extract `rack.js` from the `rack` tab**

Move from `site/showcase.js:891-1167`: `RU`/`UNITS`/`RAIL`/`INNER`, `loadMeta`, `entryOf`/`baysOf`/`chassisOf`/`byRef`/`loadSkin`/`shortRef`, `build2d` and the `to3d` body.

Rename the `STACK` constant to `CAST` and change it to the spec's cast:

```js
// The cast. Each earns its place: the ASR-9006 is modular and carries
// data-under, the AS7726-32X is the optics story, the FHD-1UFCE is the fibre
// path, and the R740xd is the teardown spoke.
export const CAST = [
  {ref: 'fhd-1ufce',  cfg: 'default', ru: 1,  label: 'FHD-1UFCE'},
  {ref: 'as7726-32x', cfg: 'ac-f2b',  ru: 2,  label: 'AS7726-32X'},
  {ref: 'r740xd',     cfg: 'default', ru: 3,  label: 'R740xd'},
  {ref: 'asr-9006',   cfg: 'default', ru: 6,  label: 'ASR-9006'},
];
```

Confirm each `cfg` against the vendored index before trusting it:

```bash
for d in fhd-1ufce as7726-32x r740xd asr-9006; do
  echo -n "$d: "; python3 -c "import json,sys; print(list(json.load(open('assets/dist/'+sys.argv[1]+'.configs.json'))['configs']))" $d
done
```

Use the real ids this prints. A wrong `cfg` is a silent empty rack, not an error.

Turn `to3d`'s body into `mount3d({stack, heightRU, overrides})`, keeping the `guard3d` wrapper and its comment — that comment records why the scrim used to never come down, and the failure it prevents is invisible until it happens.

- [ ] **Step 4: Write `stage-rail.js`**

Lift `activate`, `epoch` and `stale` from `site/showcase.js:1169-1199` **verbatim**, changing only the lookup: stages come from a registry keyed by name, and there is no `NEEDS_DEFAULT` (a stage owns its own setup).

```js
export let epoch = 0;
export const stale = mine => mine !== epoch;

export const STAGES = ['rails','mount','populate','optics','cable','filter','takeaway'];
const MODULES = {};   // name -> {title, question, enter, exit}
let current = null;

export async function activate(name) {
  if (current === name) return;
  epoch++;
  if (current) await MODULES[current].exit?.();
  loading.hidden = true;
  exportSlot.replaceChildren();
  stageHost.removeAttribute('data-stage-ready');     // see Task 10
  current = name;
  document.querySelectorAll('.stage-rail button').forEach(b =>
    b.setAttribute('aria-selected', String(b.dataset.stage === name)));
  paintRail(name);
  await MODULES[name].enter();
  stageHost.setAttribute('data-stage-ready', name);
}
```

`paintRail(name)` marks every rung before `name` as done (`aria-current` / a `done` class) so the ladder shows cumulative progress, which is the whole point of it being a ladder.

Set `data-stage-ready` **after** `enter()` resolves and **only if** `!stale(mine)`. A stage whose `enter()` throws must never set it — that is what makes Task 10's checker fail loudly rather than pass quietly.

- [ ] **Step 5: Write `stages/00-rails.js`**

```js
import {stageRack, loading, title, lead, kv, setPanel, setExports, saveSvg} from '../artifact.js';
import {build2dElevation} from '../rack.js';

export default function makeRails() {
  let built = null;
  return {
    title: 'Rails',
    question: 'Is this to scale?',
    async enter() {
      // An empty rack: rails and RU marks, nothing mounted. The claim is that
      // 44.45mm is 44.45mm, so the numbers are read off the geometry rather
      // than printed beside it.
      built = await build2dElevation({stack: [], heightRU: 12});
      stageRack.hidden = false;
      stageRack.replaceChildren(built);
      setPanel(
        title('Rails'),
        lead('Every drawing here is authored at true size, so an elevation is composition rather than illustration.'),
        kv([['rack unit', '44.45 mm', true], ['height', '12 U — 533.4 mm'], ['inner width', '450.85 mm']]),
      );
      setExports([{label: 'SVG', run: () => saveSvg(built, 'rack-rails.svg')}]);
    },
    exit() { stageRack.hidden = true; built = null; },
  };
}
```

`build2dElevation` must tolerate `stack: []`. Check the extracted `build2d` for a loop that assumes at least one entry and guard it if so.

- [ ] **Step 6: Replace the tab strip in `index.html`**

```html
<div class="stage-rail" role="tablist" aria-label="Showcase stages" aria-orientation="vertical">
  <button role="tab" data-stage="rails"    aria-selected="true">0 · Rails</button>
  <button role="tab" data-stage="mount"    aria-selected="false">1 · Mount</button>
  <button role="tab" data-stage="populate" aria-selected="false">2 · Populate</button>
  <button role="tab" data-stage="optics"   aria-selected="false">3 · Seat optics</button>
  <button role="tab" data-stage="cable"    aria-selected="false">4 · Cable</button>
  <button role="tab" data-stage="filter"   aria-selected="false">5 · Filter</button>
  <button role="tab" data-stage="takeaway" aria-selected="false">6 · Take it away</button>
</div>
```

Delete the old `.show-tabs` block. In `site/site.css` add `.stage-rail` as a 108px left column per the spec's §3.3 layout, reusing `.show-tabs`' button styling so this is a layout change rather than a restyle. `aria-orientation="vertical"` matters: a vertical tablist takes Up/Down arrows, not Left/Right.

Stages 1–6 do not exist yet. Register only `rails` in `MODULES` and have `activate` show a one-line "not built yet" panel for an unregistered name, so the rail is clickable without throwing. **Remove that fallback in Task 9** — a fallback that outlives its purpose hides a missing stage.

- [ ] **Step 7: Run both checks**

Run: `python3 check-contract.py` → green, `there are seven stages` passes (the list has seven names even though only one module exists — the list/disk check compares against the `stages/` directory, so create the six remaining files as one-line stubs that `export default function` returning a "not built yet" stage, or the check will fail. Stubs are correct here: the rail's contract is the list, and Tasks 4–9 fill them in).

Run: `python3 check-browser.py` → 13 passed.

- [ ] **Step 8: Verify by eye**

`python3 serve.py 8967`. The ladder shows seven rungs, stage 0 draws empty rails, arrow keys move between rungs.

- [ ] **Step 9: Commit**

```bash
git add site/showcase/ site/showcase.js index.html site/site.css check-contract.py
git commit -m "showcase: a stage rail replaces the tab strip, and stage 0 draws the rails

Stages are ordered and cumulative where tabs were independent, so this is a
different control model rather than an eighth tab. The rack moves to
site/showcase/rack.js because stages 0-4 all mount it, and the cast replaces
the old six-device stack.

The rail's STAGES list is named rather than globbed, the same rule PAGES
follows, so a stage that goes away fails the contract instead of quietly
becoming unreachable.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 4: Stage 1 — Mount

Mount the cast into the rails in 3D. Answers "will it fit?".

**Files:**
- Modify: `site/showcase/stages/01-mount.js` (replacing the stub)

**Interfaces:**
- Consumes: `rack.js`'s `CAST`, `loadMeta`, `chassisOf`, `mount3d`; `stage-rail.js`'s `stale`, `epoch`.
- Produces: nothing later tasks depend on beyond the stage contract.

- [ ] **Step 1: Write the failing test**

This stage's behavior needs WebGL, which CI does not have, so assert structurally — the same reasoning the existing rack section in `check-contract.py` already records:

```python
# STAGES THAT MOUNT THE RACK GO THROUGH rack.js's mount3d, which wraps
# guard3d. A stage that calls createRackScene directly loses the WebGL guard,
# and the symptom is the scrim never coming down - which reads as a slow build
# rather than a browser with acceleration switched off.
for p in sorted((HERE / "site" / "showcase" / "stages").glob("*.js")):
    s = p.read_text()
    if "createRackScene" in s:
        check(False, f"{p.name} does not call createRackScene directly",
              "mount through rack.js's mount3d so guard3d still wraps it")
```

- [ ] **Step 2: Run it to make sure it fails**

It passes vacuously today (no stage calls `createRackScene`). Prove it can fail: temporarily add `// createRackScene` to `01-mount.js`, run `python3 check-contract.py`, confirm the FAIL names `01-mount.js`, then remove it. A test you have never seen fail is not yet a test.

- [ ] **Step 3: Implement the stage**

```js
import {stage3d, stageRack, loading, title, lead, kv, setPanel, setExports, save} from '../artifact.js';
import {CAST, loadMeta, chassisOf, mount3d} from '../rack.js';
import {stale, epoch} from '../stage-rail.js';

export default function makeMount() {
  let scene = null;
  return {
    title: 'Mount',
    question: 'Will it fit?',
    async enter() {
      const mine = epoch;
      stageRack.hidden = true; stage3d.hidden = false;
      loading.hidden = false; loading.textContent = 'Mounting the cast…';
      await loadMeta();
      if (stale(mine)) return;
      const stack = CAST.map(e => ({...e, chassis: chassisOf(e.ref)}));
      const used = stack.reduce((n, e) => n + (e.chassis?.ru || 1), 0);
      scene = await mount3d({stack, heightRU: 12, overrides: {}});
      if (stale(mine) || !scene) { scene?.dispose(); scene = null; return; }
      loading.hidden = true;
      setPanel(
        title('Mount'),
        lead('The chassis dimensions are in each device manifest, so whether it fits is arithmetic rather than judgement.'),
        kv([['rack', '12 U'], ['occupied', `${used} U`, true], ['free', `${12 - used} U`]]),
      );
      setExports([{label: 'GLB', run: async () => save(await scene.toGLB(), 'rack.glb', 'model/gltf-binary')}]);
    },
    exit() { scene?.dispose(); scene = null; stage3d.hidden = true; stage3d.replaceChildren(); },
  };
}
```

Read `ru` from `chassisOf(e.ref).ru`, not from the `CAST` entry's `ru` — the entry's `ru` is a *position*, the chassis' is a *height*. Conflating them is why a rack silently overlaps.

- [ ] **Step 4: Run both checks**

`python3 check-contract.py` → green. `python3 check-browser.py` → 13 passed (the stage is behind a click, so this only proves nothing broke on load; Task 10 makes it real).

- [ ] **Step 5: Verify by eye**

`python3 serve.py 8967`, click stage 1. The four devices mount. Check the occupied/free arithmetic against what you can see.

- [ ] **Step 6: Commit**

```bash
git add site/showcase/stages/01-mount.js check-contract.py
git commit -m "showcase: stage 1 mounts the cast, and asks whether it fits

Mounts through rack.js's mount3d so guard3d still wraps the scene; a stage
that reached for createRackScene directly would lose the WebGL guard, and
the contract now refuses that.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 5: Stage 2 — Populate, and the refusal

The load-bearing stage. A bay offers only what it *accepts*, and an incompatible card is **refused**. The refusal is the demonstration.

**Files:**
- Modify: `site/showcase/stages/02-populate.js`

**Interfaces:**
- Consumes: `rack.js`'s `baysOf`, `mount3d`, plus the scene's `setOverrides(ref, overrides)` and `build()`.
- Produces: nothing downstream.

- [ ] **Step 1: Write the failing test**

The refusal must come from the manifest, never from a list in this page. Assert that:

```python
# THE REFUSAL COMES FROM THE MANIFEST. Stage 2's whole claim is that the bay
# knows what it accepts - so the accepted list is read from the compiled index
# and a hardcoded array of component refs in the stage would be the page
# inventing the answer it is demonstrating.
pop = (HERE / "site" / "showcase" / "stages" / "02-populate.js")
if pop.is_file():
    s = pop.read_text()
    check("baysOf" in s, "stage 2 reads the bays from the index",
          "the accepted list must come from the manifest, not from this page")
    check(not re.search(r"accepts\s*[:=]\s*\[", s),
          "stage 2 does not hardcode an accepted list",
          "found an inline accepts array - that is the page fabricating data")
```

- [ ] **Step 2: Run it to make sure it fails**

`python3 check-contract.py` → FAIL on `stage 2 reads the bays from the index` (the stub has no `baysOf`).

- [ ] **Step 3: Find a real refusal pair**

Do not guess. Ask the index which bay accepts what:

```bash
python3 -c "
import json
m=json.load(open('assets/dist/asr-9006.configs.json'))
for bay,spec in (m.get('bays') or {}).items():
    print(bay, '->', spec.get('accepts'))
" | head -20
```

Pick one bay and one component that is **not** in its `accepts`. Record both in a comment in the stage, with the reason, so a future reader knows the refusal is real and not staged.

- [ ] **Step 4: Implement the stage**

Panel offers, per bay, only `accepts` — plus one deliberately incompatible card. Choosing it calls `setState` on the bay, which **refuses** an undeclared state and returns `false`; render that refusal:

```js
const ok = setState(bayPath, 'error');
readout.replaceChildren(ok
  ? kv([['bay', bay, true], ['seated', shortRef(ref)]])
  : kv([['bay', bay, true], ['refused', `${shortRef(ref)} — not in accepts`]]));
```

Use the existing `setState` contract from `artifact.js` — it already refuses a state the element does not declare in `data-states`, so the refusal is enforced by the model rather than by an `if` in this file.

- [ ] **Step 5: Run both checks, then verify by eye**

`python3 check-contract.py` → green. `python3 check-browser.py` → 13. Then `python3 serve.py 8967`, click stage 2, seat an accepted card (it appears in 3D), then the incompatible one (it is refused and says why).

- [ ] **Step 6: Commit**

```bash
git add site/showcase/stages/02-populate.js check-contract.py
git commit -m "showcase: stage 2 populates the bays, and refuses what does not fit

The refusal is the point of the stage, so it is enforced by the model: the
accepted list is read from the compiled index and setState already declines a
state the element does not declare. The contract refuses a hardcoded accepts
array here, because a page that invents the answer is not demonstrating it.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 6: Stage 3 — Seat optics

Seat an optic in a cage and read back media, speed and lanes.

**Files:**
- Modify: `site/showcase/stages/03-optics.js`

**Interfaces:**
- Consumes: `rack.js`'s `mount3d` and scene `setOverrides`; `site/optics.js` if it already resolves pluggable facts — check with `grep -n 'export' site/optics.js` before writing anything, and reuse rather than restate.

- [ ] **Step 1: Write the failing test**

```python
# Stage 3 reads media/speed/lanes off the resolved component, not off a table
# in the page. speeds.yaml and pluggables.yaml are upstream's, and a second
# copy here would drift from them silently.
opt = (HERE / "site" / "showcase" / "stages" / "03-optics.js")
if opt.is_file():
    s = opt.read_text()
    check(not re.search(r"(100G|400G|25G)\s*['\"]?\s*:", s),
          "stage 3 does not keep its own speed table",
          "speeds belong to the component index; a copy here will drift")
```

- [ ] **Step 2: Run it to make sure it fails**

Add a line `const SPEEDS = {'100G': 4};` temporarily, run the contract, see it fail, remove it.

- [ ] **Step 3: Implement**

Seat `generic/qsfp-lc@1` (confirm it exists: `grep -c 'qsfp-lc' assets/dist/components.json`) into a cage on the AS7726-32X, then read the occupant's attributes off the compiled component skin via the component index, exactly as `rack.js`'s `byRef`/`loadSkin` already do.

- [ ] **Step 4: Checks, then eye. Step 5: Commit** (message: "showcase: stage 3 seats an optic and reads back what it is")

---

## Task 7: Stage 4 — Cable the ROADM ring

The scene change. Stage 4 brings its own rails and cables the ring from `labs.json`.

**Files:**
- Modify: `refresh-assets.sh`, `check-contract.py`, `site/showcase/stages/04-cable.js`

**Interfaces:**
- Consumes: `rack.js`'s `mount3d`; the scene's `portAnchor(which, path, o)` and `complete()`.
- Produces: nothing downstream.

- [ ] **Step 1: Write the failing test**

```python
# ── stage 4 cables a real topology ───────────────────────────────────────
# labs.json is the ROADM ring: 9 devices, 30 links, each end naming a device
# and a port. It is LOAD-BEARING for stage 4, which is why it is copied with a
# bare cp rather than through the `[ -f ] &&` loop that carries
# vendors/overlays/gaps - those are vendored-but-unread, so a silent miss
# costs nothing, and this one would ship a broken stage behind a green
# refresh. That is the fields.js/optical.js shape, twice in three days.
labs = jload("labs.json")
check(labs is not None, "labs.json is vendored", "stage 4 has no topology to draw")
if labs:
    ring = (labs.get("labs") or [None])[0]
    check(bool(ring and ring.get("devices")), "labs.json's first lab has devices")
    check(bool(ring and ring.get("links")), "labs.json's first lab has links")
    # EVERY CABLE END MUST LAND ON A DRAWN PORT. portAnchor resolves an end by
    # data-path against the compiled faces, so an endpoint naming a port that
    # is not drawn is a cable that silently does not appear.
    byid = {d["id"]: d["ref"] for d in ring["devices"]}
    paths = {}
    for ref in set(byid.values()):
        p = set()
        for f in DIST.glob(f"{ref}.*.svg"):
            p |= set(re.findall(r'data-path="([^"]+)"', f.read_text()))
        paths[ref] = p
    bad = [f"{ep[0]}:{ep[1]}" for l in ring["links"] for ep in (l["from"], l["to"])
           if ep[1] not in paths.get(byid.get(ep[0], ""), ())]
    check(not bad, "every link endpoint resolves to a drawn data-path",
          f"{len(bad)} unresolved, e.g. {bad[:3]}")
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `python3 check-contract.py`
Expected: FAIL `labs.json is vendored` — it is not, today.

- [ ] **Step 3: Vendor `labs.json`**

In `refresh-assets.sh`, beside the existing hard copies:

```sh
cp "$SRC"/dist/devices.json "$HERE/assets/dist/"
cp "$SRC"/dist/components.json "$HERE/assets/dist/"
# labs.json is the ROADM ring the showcase's cable stage draws. A BARE cp, not
# the tolerant loop below: that loop carries indexes nothing reads yet, so a
# miss there is free, and a miss here ships a cable stage with no topology
# behind a refresh that passed.
cp "$SRC"/dist/labs.json "$HERE/assets/dist/"
```

Then run the refresh — **with `PYTHONPATH` set**, per roc-ops/Portrayal#561, or you will build with another checkout's compiler:

```bash
PYTHONPATH=/Volumes/External/portrayal-upstream/spec/tools ./refresh-assets.sh
```

Check nobody else is building first: `ps aux | grep build.sh`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `python3 check-contract.py`
Expected: green, including `every link endpoint resolves to a drawn data-path`.

- [ ] **Step 5: Implement the stage**

Mount the ring with its **own** rails at `heightRU: 42` (the lab declares `rack: {height-ru: 42, rails-only: true}`), then draw one tube per link.

**The trap:** the ring holds nine devices across only two refs, so a bare ref resolves to the *first* match. `rack3d.js` says so itself: *"A rack may hold the same model twice, so a bare ref is the first of them. Pass {ref, ru} - or {label} - to name which."* The lab's `label` equals its `id` and is unique, so:

```js
// NOT portAnchor(dev.ref, port) - that is the first dcp-r-34d-cs every time.
const a = await scene.portAnchor({label: from[0]}, from.slice(1).join('/'));
```

**The second trap — do not build a path out of `tx`/`rx`.** No vendored face carries a `tx` or `rx` data-path. They exist only on a *pluggable optic's* skin (`generic--qsfp-lc--v1` and `generic--sfp-lc--v1` both have `tx`, `rx` and `tx/bore`, `rx/bore`), so they come into being only once an optic is seated — which is what `vendor/swap.js:76` describes. The ROADM's `xc34` is a `connector` with `bores: ["1","2"]` and nothing seated, so `xc34/tx` never resolves. Confirm for yourself:

```bash
grep -oh 'data-path="xc34[^"]*"' assets/dist/dcp-r-34d-cs.*.svg | sort -u
# -> xc34, xc34/1, xc34/1-occupant, xc34/1/bore, xc34/2, ...  and no tx or rx
grep -l 'occupant/tx' assets/dist/*.svg | wc -l      # -> 0
```

So **anchor every end at the port path itself**, `ep[1]`, which is exactly what the Step 1 assertion proves resolves for all 60 ends:

```js
// Both arities collapse to the same anchor: the port. tx/rx are semantic -
// which strand of the pair this tube is - not a path. The lab models every
// fibre individually, so a pair is two tubes; offset them by strand so both
// are visible rather than one hiding inside the other.
const [devId, port, strand] = from;            // strand is 'tx', 'rx' or undefined
const a = await scene.portAnchor({label: devId}, port);
const offset = strand === 'rx' ? +1.2 : strand === 'tx' ? -1.2 : 0;  // mm, across the port
```

`bores: ["1","2"]` gives `xc34/1` and `xc34/2` as a later refinement, but **which bore is TX is not stated in the data** — do not map strand to bore and imply it is known.

Await `scene.complete()` before resolving anchors on rear or side faces — `build()` deliberately does not wait for deferred faces, and a management link runs rear-to-front.

- [ ] **Step 6: Checks, then verify by eye**

`python3 check-contract.py`, `python3 check-browser.py`, then `python3 serve.py 8967` and click stage 4. Thirty tubes. Spot-check one management run: it should leave a ROADM's rear and arrive at the controller's front.

- [ ] **Step 7: Commit**

```bash
git add refresh-assets.sh assets/dist/labs.json site/showcase/stages/04-cable.js check-contract.py
git commit -m "showcase: stage 4 cables the ROADM ring, with its own rails

Stage 4 cuts to the ring rather than cabling the cast: labs.json's nine
devices are all instances of two refs, neither in the cast, and the
alternative was hand-authoring links - which this page's standing rule
forbids. Its own rails, because 'is this to scale' is answered once at stage
0 and re-answering it with a different elevation muddies the claim.

labs.json is copied with a bare cp, not the tolerant loop, because a missing
topology here ships a broken stage behind a green refresh. The contract
asserts all sixty endpoints resolve to a drawn data-path.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 8: Stage 5 — Filter by media and by purpose

Both axes work today. Purpose does **not** need roc-ops/Portrayal#565: every port a link names already carries `data-group` on the compiled face, so a link's purpose is the group of the ports it connects.

**Files:**
- Modify: `site/showcase/stages/05-filter.js`
- Modify: `check-contract.py`

**Interfaces:**
- Consumes: `rack.js`'s `loadMeta` and the scene from Task 7.
- Produces: nothing downstream.

- [ ] **Step 1: Write the failing test**

```python
# STAGE 5 FILTERS ON WHAT THE DRAWING ALREADY SAYS. A link's purpose is the
# group of the ports it connects, and every port these links name carries
# data-group on its face: eth4 -> mgmt, xc34 -> xc, port-line/port-osc ->
# line. So purpose filtering needs no upstream field and no table in the page.
# Asserted because it is the premise of the stage: if a link's port stops
# carrying a group, the filter silently offers one bucket.
if labs:
    ring = (labs.get("labs") or [None])[0]
    media = sorted({l["media"] for l in (ring or {}).get("links", [])})
    check(len(media) > 1, "the lab has more than one media to filter by",
          f"only {media} - a filter with one value demonstrates nothing")
    byid = {d["id"]: d["ref"] for d in ring["devices"]}
    groups = {}
    for ref in set(byid.values()):
        for f in DIST.glob(f"{ref}.*.svg"):
            for pth, attrs in re.findall(r'data-path="([^"]+)"([^>]*)', f.read_text()):
                g = re.search(r'data-group="([^"]+)"', attrs)
                if g:
                    groups.setdefault((ref, pth), g.group(1))
    ungrouped = [f"{ep[0]}:{ep[1]}" for l in ring["links"] for ep in (l["from"], l["to"])
                 if (byid.get(ep[0]), ep[1]) not in groups]
    check(not ungrouped, "every link endpoint's port declares a data-group",
          f"{len(ungrouped)} without one, e.g. {ungrouped[:3]} - purpose filtering "
          "reads the group off the face, so a port without one cannot be classified")
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `python3 check-contract.py`
Expected: with `labs.json` vendored by Task 7 this should **pass** immediately — the groups are already there. Prove it can fail by temporarily pointing `byid` at a ref with no faces (`byid = {k: 'nope' for k in byid}`), running it, seeing the FAIL list the endpoints, then reverting.

- [ ] **Step 3: Implement**

Two independent filter rows via `controls`, both derived from the data — never a literal list, so a third media or a new group shows up without an edit here:

```js
// Media: straight off the link.
const media = [...new Set(links.map(l => l.media))];

// Purpose: the group of the ports it connects, read off the face. `line`
// splits two ways - a ring span carries `span`, an OSC loop has both ends on
// the same device - which is the only inference here, and it comes from the
// lab's own structure rather than from a port-name guess.
function purpose(l) {
  const g = groupOf(l.from[0], l.from[1]) || groupOf(l.to[0], l.to[1]);
  if (g === 'mgmt' || groupOf(l.to[0], l.to[1]) === 'mgmt') return 'management';
  if (g === 'xc') return 'cross-connect';
  if (g === 'line') return l.span ? 'ring-span'
                  : l.from[0] === l.to[0] ? 'osc-loop' : 'line';
  return g || 'other';
}
```

`groupOf(devId, port)` reads `data-group` from the already-loaded face document — `rack.js` has the face documents via the scene; do not re-fetch.

Expected buckets on this lab: management 6, cross-connect 6, osc-loop 12, ring-span 6 — which is the partition the lab's own comments describe, so check your counts against it.

- [ ] **Step 4: Run both checks, then verify by eye**

`python3 check-contract.py`, `python3 check-browser.py`, then `python3 serve.py 8967`, stage 5. Toggle `management` alone: six tubes, each leaving a ROADM's rear for a controller's front.

- [ ] **Step 5: Commit**

```bash
git add site/showcase/stages/05-filter.js check-contract.py
git commit -m "showcase: stage 5 filters by media and by purpose

Purpose needs no upstream field after all. Every port these links name
already carries data-group on its compiled face - eth4 is mgmt, xc34 is xc,
port-line and port-osc are line - so a link's purpose is the group of the
ports it connects, read off the drawing. That is the claim this site makes
about the model, applied to itself.

Only one inference: `line` splits into a ring span (carries span) and an OSC
loop (both ends on the same device), and both come from the lab's structure
rather than a port-name guess.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 9: Stage 6 — Take it away

Wire the exports that already exist. No new export code.

**Files:**
- Modify: `site/showcase/stages/06-takeaway.js`, `site/showcase/stage-rail.js` (remove the Task 3 fallback)

- [ ] **Step 1: Write the failing test**

```python
# Every stage is real now, so the rail's "not built yet" fallback goes. A
# fallback that outlives its purpose turns a missing stage into a blank panel
# instead of an error.
if rail.is_file():
    check("not built yet" not in rail.read_text(),
          "stage-rail.js has no unbuilt-stage fallback",
          "all seven stages exist; the placeholder should be gone")
```

- [ ] **Step 2: Run it to make sure it fails** — FAIL while the fallback is still there.

- [ ] **Step 3: Implement** — `setExports` with draw.io (`site/drawio.js`), GLB and USDZ (the scene's `toGLB`/`toUSDZ`), PNG (`site/raster.js`) and raw SVG. Link the NetBox and Nautobot exports already under `assets/exports/`. Confirm each entry point first: `grep -n 'export' site/drawio.js site/raster.js`.

- [ ] **Step 4: Delete the fallback** from `activate`.

- [ ] **Step 5: Checks, eye — click all seven rungs in order and confirm each downloads. Step 6: Commit** (message: "showcase: stage 6 hands the rack over, in four formats")

---

## Task 10: Drive the rail in `check-browser.py`

Closes the gap the spec's §6.1 names: the browser check has never clicked anything, so six of seven tabs never executed in CI.

**Files:**
- Modify: `check-browser.py`

- [ ] **Step 1: Write the failing test**

This task *is* the test. Add to `check-browser.py`:

```python
# EVERY STAGE, NOT JUST THE ONE THAT LOADS. This checker used to open a page
# and stop, so on index.html only the default tab's enter() ever ran and six
# tabs' code never executed here at all. The staged showcase puts every stage
# behind a click and each fetches its own artifacts, so a mistyped path would
# pass the contract, pass this check, and 404 on first open - the fields.js /
# optical.js shape again.
#
# Safe without a GPU: site/webgl.js's webglTrouble() returns a sentence rather
# than letting three.js throw, and this checker fails only on uncaught errors
# and 4xx. The 3D stages contribute real 404 coverage with nothing rendered.
STAGES = ["rails", "mount", "populate", "optics", "cable", "filter", "takeaway"]


def check_stages(page, base):
    """Walk the stage rail, waiting on each stage's own ready signal."""
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))

    def on_response(r):
        if r.status >= 400 and r.url.startswith(base) and not EXPECTED_404.search(r.url):
            bad.append(f"{r.status} {r.url[len(base):]}")

    page.on("response", on_response)
    page.goto(f"{base}/index.html", wait_until="load")
    for name in STAGES:
        page.click(f'.stage-rail button[data-stage="{name}"]')
        try:
            # Set by the rail only after enter() resolves, so a stage whose
            # enter() throws never sets it and this times out naming the stage
            # rather than passing quietly.
            page.wait_for_selector(f'[data-stage-ready="{name}"]', timeout=20000)
        except Exception:
            bad.append(f"stage {name} never became ready")
    return bad
```

Call it in `main()` after the `PAGES` loop, appending `ok    the stage rail: 7 stages` or the problems, and include it in the final count line.

- [ ] **Step 2: Run it to make sure it fails**

Break one stage on purpose — in `04-cable.js`, change the `labs.json` fetch to `labs-nope.json`. Run `python3 check-browser.py`. Expected: a FAIL naming `404 /assets/dist/labs-nope.json`, and possibly `stage cable never became ready`. Revert.

This step matters more than it looks: it is the only proof that the new coverage actually catches the bug class it was written for.

- [ ] **Step 3: Run the full check**

Run: `python3 check-browser.py`
Expected: `browser: 14 checks passed, 12 pages and 25 in the marks harness`, with the rail as the extra check. Confirm the total runtime stayed near two minutes — if it grew a lot, a stage is falling back to a timeout rather than setting `data-stage-ready`.

- [ ] **Step 4: Commit**

```bash
git add check-browser.py
git commit -m "check-browser: drive the stage rail, not just the page load

This checker opened twelve pages and stopped, so on index.html only the
default stage's enter() ever ran. Every stage is behind a click and fetches
its own artifacts, so a mistyped path passed both guards and 404'd on first
open - which is how fields.js (#487) and optical.js (#535) shipped.

Waits on each stage's own data-stage-ready rather than a fixed sleep: a stage
whose enter() throws never sets it, so this names the stage instead of
passing quietly. Works on a GPU-less runner because webglTrouble() returns a
sentence instead of throwing.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**

| spec section | task |
|---|---|
| §2 stage ladder (0–6) | 3, 4, 5, 6, 7, 8, 9 |
| §3.1 tabs → spokes, 3D/Rack absorbed | 2, 3 |
| §3.2 decomposition | 1, 2, 3 |
| §3.3 layout B | 3 (rail markup + CSS) |
| §3.4 spokes A — stage swap + breadcrumb | **gap — see below** |
| §4 stage 4 = ring, own rails | 7 |
| §4.1 endpoint arity, portAnchor | 7 |
| §5.1 labs.json hard cp | 7 |
| §5.2 nothing to do | — (verified, no task needed) |
| §5.3 stage 5 media *and* purpose (via `data-group`) | 8 |
| §6.1/§6.2 drive the rail | 10 |
| §6.3 contract assertions | 1, 2, 3, 5, 7 |
| §7 Runbook retirement | 2 |

**Gap found and fixed:** §3.4's spoke *mechanic* — clicking a device in the rack to open a lens, the dimmed ladder and the breadcrumb back — had no task. Task 2 re-homes the four lenses but never wires a way to reach them. Added as Task 11 below.

**Placeholder scan:** Tasks 6 and 9 compress their final check/verify/commit steps into one line rather than spelling out near-identical steps again. The commands are identical to Tasks 5, 7 and 8 and are stated there in full. Every code step has real code; no "TBD", no "add error handling".

**Verified against real data, not asserted:** Task 7's endpoint assertion resolves all 60 ends; Task 8's group assertion finds a `data-group` for all 60; Task 8's `purpose()` reproduces the lab's own 6/6/12/6 partition. Two claims in the first draft failed that verification and were corrected in place — `tx`/`rx` are not data-paths (Task 7), and purpose filtering needs no upstream field (Task 8).

**Type consistency:** `mount3d({stack, heightRU, overrides})` is used with all three keys in Tasks 4, 5, 7. `portAnchor(which, path, o)` matches `site/rack3d.js:671`. `setState(path, state) -> boolean` matches the real implementation. `build2dElevation({stack, heightRU})` is consistent in Tasks 3 and 7. Spoke factories are `makeSpoke({dev, cfg})` in Tasks 2 and 11. `stale(mine)` / `epoch` are imported from `stage-rail.js` in every stage.

---

## Task 11: The spoke mechanic — click a device, get a lens

Implements spec §3.4, which Tasks 1–10 left unwired.

**Files:**
- Create: `site/showcase/spoke-host.js`
- Modify: `site/showcase/stage-rail.js`, `index.html`, `site/site.css`, `check-contract.py`

**Interfaces:**
- Consumes: the four `makeSpoke({dev, cfg})` factories from Task 2; `stage-rail.js`'s `activate`, `stale`, `epoch`.
- Produces:
  ```js
  export async function openSpoke({dev, cfg, lens, returnTo});  // lens: 'inspect'|'callouts'|'state'|'select'
  export async function closeSpoke();                           // returns to returnTo
  export function spokeOpen();                                  // -> boolean
  ```

- [ ] **Step 1: Write the failing test**

```python
# A SPOKE IS A RENDERER SWITCH. The lenses drive the inlined 2D face
# (#stage2d); stages 1-4 drive the 3D rack (#stageRack). So opening one swaps
# renderers, and it must go back to the stage it came from - a detour with no
# way back is a dead end.
host = (HERE / "site" / "showcase" / "spoke-host.js")
check(host.is_file(), "site/showcase/spoke-host.js exists",
      "the four lenses are re-homed but nothing opens them")
if host.is_file():
    h = host.read_text()
    for name in ("openSpoke", "closeSpoke"):
        check(f"export async function {name}" in h or f"export function {name}" in h,
              f"spoke-host.js exports {name}")
    check("returnTo" in h, "openSpoke records where to return to",
          "a spoke with no way back is a dead end")
```

- [ ] **Step 2: Run it to make sure it fails**

`python3 check-contract.py` → FAIL `site/showcase/spoke-host.js exists`.

- [ ] **Step 3: Implement**

```js
import {stage2d, stage3d, stageRack, loading, setDrawing, el} from './artifact.js';
import {stale, epoch} from './stage-rail.js';
import makeInspect from './spokes/inspect.js';
import makeCallouts from './spokes/callouts.js';
import makeState from './spokes/state.js';
import makeSelect from './spokes/select.js';

const LENSES = {inspect: makeInspect, callouts: makeCallouts, state: makeState, select: makeSelect};
let open = null;    // {lens, spoke, returnTo}

export const spokeOpen = () => open !== null;

export async function openSpoke({dev, cfg, lens, returnTo}) {
  const mine = epoch;
  if (open) await closeSpoke();
  stage3d.hidden = true; stageRack.hidden = true; stage2d.hidden = false;
  // The lenses read the inlined face, so the artifact has to be the DEVICE's,
  // not whatever the last stage left on the stage.
  await setDrawing('front', cfg);
  if (stale(mine)) return;
  const spoke = LENSES[lens]({dev, cfg});
  await spoke.enter();
  open = {lens, spoke, returnTo};
  document.body.classList.add('spoke-open');     // dims the ladder, per §3.4
  breadcrumb(returnTo, dev);
}

export async function closeSpoke() {
  if (!open) return;
  const {spoke, returnTo} = open;
  await spoke.exit?.();
  open = null;
  document.body.classList.remove('spoke-open');
  stage2d.hidden = true;
  const {activate} = await import('./stage-rail.js');
  await activate(returnTo);                       // rebuilds the stage we left
}
```

`setDrawing(view, config)` takes only view and config — it reads `DEV` from `artifact.js`. To open a spoke on a device other than `DEV`, `artifact.js` needs `setDrawing` to accept an optional device. Add a third parameter defaulting to `DEV` rather than introducing a second loader:

```js
export async function setDrawing(view, config, dev = DEV) { /* … */ }
```

Add the breadcrumb element to `index.html` above the stage, and `.spoke-open .stage-rail {opacity:.35; pointer-events:none}` to `site/site.css`. Wire the rack's existing `stageRack.onpointermove` handler's sibling — an `onclick` on `[data-device-name]` — to call `openSpoke`.

- [ ] **Step 4: Extend the browser check**

In `check_stages`, after the rail walk, open and close one spoke, so the renderer swap is exercised in CI:

```python
    page.click('.stage-rail button[data-stage="populate"]')
    page.wait_for_selector('[data-stage-ready="populate"]', timeout=20000)
    page.click('[data-device-name]')
    try:
        page.wait_for_selector('.spoke-crumb', timeout=20000)
        page.click('.spoke-crumb button')
        page.wait_for_selector('[data-stage-ready="populate"]', timeout=20000)
    except Exception:
        bad.append("a spoke did not open and return")
```

- [ ] **Step 5: Run both checks, then verify by eye**

`python3 check-contract.py` → green. `python3 check-browser.py` → 14 passed. Then `python3 serve.py 8967`: stage 2, click the ASR-9006, a lens opens with the ladder dimmed, the breadcrumb returns you to stage 2 with its cards still seated.

- [ ] **Step 6: Commit**

```bash
git add site/showcase/spoke-host.js site/showcase/artifact.js site/showcase/stage-rail.js index.html site/site.css check-contract.py check-browser.py
git commit -m "showcase: clicking a device opens a lens, and the breadcrumb comes back

A spoke is a renderer switch - the lenses drive the inlined 2D face while the
stages drive the 3D rack - so it takes the whole stage, dims the ladder and
names the way back rather than pretending both fit side by side.

The browser check now opens and closes one, so the swap is exercised in CI
rather than only by hand.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
