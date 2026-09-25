# Showcase 2D-First Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the staged showcase 2D-first. That means one rail design shared by both renderers, a 2D/3D switch on every stage, a "Look closer" that you click on the drawing, and the ROADM ring drawn in 2D as three site racks.

**Architecture:**
- A new `rails.js` becomes the only description of a rail. `build2dElevation` and `rack3d.js` both draw from it.
- The stage rail owns a persisted `mode` and passes it to each stage on the lease it already mints. Stages branch between `build2dElevation` and `mount3d`.
- A new `svg2d.js` gives the geometry of elements inside a composed 2D drawing. Highlights, hover outlines and cable anchors all use it.
- A new `ring2d.js` draws one site of the ring as a front/rear pair with cables and stubs. Sites come from `ring.js`'s `sitesOf`, which takes connected components after dropping span links.

**Tech Stack:** Vanilla ES modules with no bundler and no npm, three.js via `site/rack3d.js`, Python 3.12 checks, and Playwright in `check-browser.py`.

**Spec:** `docs/superpowers/specs/2026-09-25-showcase-2d-first-design.md`. Background is in `docs/superpowers/specs/2026-09-24-showcase-staged-rack-design.md`.

## Global Constraints

- **Nothing fabricates data.** Labels, counts, states and component references are read off the compiled faces or the index. A panel claim must match what is drawn or exported.
- **No npm, no JS test runner.** Tests are `python3 check-contract.py` (about 1 s) and `python3 check-browser.py` (about 4 min; it starts its own server on a free port). "Write the failing test" means a `check(...)` in the contract, or a step in `check_stages` in `check-browser.py`.
- **Every contract check records on every run.** A check that only calls `check(False, …)` on a violation is not acceptable here.
- **Default mode is 2D.** There is one switch for the whole ladder. It is persisted in `localStorage` under `portrayal.showcase.mode`, and every read and write is wrapped in `try/catch`. With storage blocked the page still works; it just forgets.
- **Stage UI writes go through the lease** (`ui.setPanel`, `ui.setExports`, `ui.scrim`, `ui.unscrim`, and the new `ui.strip`). No file under `site/showcase/stages/` imports `setPanel`, `setExports` or `loading` from `artifact.js`, or reads `epoch`. The contract already enforces this. After every await, check `ui.live()` before touching anything.
- **Rail geometry lives only in `site/showcase/rails.js`.** It uses EIA-310 hole positions of 6.35, 22.22 and 38.10 mm within each U, holes 465.1 mm apart centre to centre, a 26 mm rail face, an opening of 450.85 mm, U numbers on the outboard half of both rails, and holes on the inboard half.
- **Sites are derived from the topology:** connected components after dropping `span` links. Never parse `site-a-…` or any other device-id prefix.
- **The 2D ring caption always says:** *"Grouped by site, as the ring's topology divides it. Physically all three share one lab rack (U{min}–{max})."* The U range is computed from the lab.
- **Look closer (click on the drawing, plus the index strip) appears only in stages 1–3.** Stage 6 shows a 2D elevation, but clicking a device there does nothing.
- **Don't touch** ports 8177/8178, `.gitignore:26`, or bare `git stash`. Spelling follows the file being edited.
- **Commits end with** `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

## File Structure

| file | responsibility |
|---|---|
| `site/showcase/rails.js` | **Create.** The rail, once: dimensions, hole positions, and per-side geometry. No DOM, no three.js. |
| `site/showcase/svg2d.js` | **Create.** Geometry inside a composed 2D SVG: `boxIn`, `highlight`, `clearHighlights`. |
| `site/showcase/ring2d.js` | **Create.** Draws one site of the ring as front and rear elevations, with cables and stubs. |
| `site/showcase/rack.js` | **Modify.** `build2dElevation` draws rails from `rails.js` and gains `view` and `baseRU`. `RAIL`/`INNER` constants move out. `RU` is re-exported from `rails.js`. |
| `site/rack3d.js` | **Modify.** `buildRack()` draws posts, holes and U numbers from `rails.js`. |
| `site/showcase/stage-rail.js` | **Modify.** Adds `mode`, `setMode`, a forced re-enter, `ui.mode` and `ui.strip`, and clears the tabs and strip on vacate. |
| `site/showcase/spoke-host.js` | **Modify.** `lookCloser` (in the panel) becomes `renderStrip` (under the stage). Adds `wireDevices` for click-on-drawing. |
| `site/showcase/ring.js` | **Modify.** Adds `sitesOf(lab)` and `cssColor(link, lab)`. |
| `site/showcase/stages/00`–`03`, `06` | **Modify.** Branch on `ui.mode`. |
| `site/showcase/stages/04-cable.js`, `05-filter.js` | **Modify.** Add a 2D branch using `ring2d.js` and site tabs. |
| `index.html` | **Modify.** Adds the `show-bar` (site tabs slot plus the mode switch) and the `look-strip`. |
| `site/site.css` | **Modify.** Styles the bar, switch, strip, device hover, stubs and highlight. |
| `check-contract.py`, `check-browser.py` | **Modify.** One set of checks per task. |

### Interfaces shared across tasks

```js
// rails.js
export const RU = 44.45;
export const RAIL_W = 26;            // rail face width, mm
export const OPENING = 450.85;       // between the rails' inner edges
export const HOLE_CC = 465.1;        // EIA-310, hole centre to hole centre across the rack
export const HOLE_DY = [6.35, 22.22, 38.10];  // within each U, from its bottom
export const HOLE_SIZE = 6.5;        // square cage-nut hole
// x in mm from the rack's centre line, + to the right
export const SIDES;                  // [{side:'left'|'right', inner, outer, hole, number}]

// svg2d.js
export function boxIn(root, el);         // -> {x,y,width,height} in root's user units, or null
export function highlight(root, el, tag = 'hl');  // draws a rect over el, marks el[data-highlight]; returns the rect
export function clearHighlights(root, tag = 'hl');

// rack.js (changed signature — defaults keep every current caller working)
export async function build2dElevation({stack, heightRU, overrides, view = 'front', baseRU = 1});
// every device group: <g data-device-name={label} data-device-ref={ref}>
// every rail hole: data-rail-hole="left|right"; every rail number: data-rail-num="left|right"

// stage-rail.js
export let mode;                       // '2d' | '3d'
export async function setMode(m);      // persists, repaints the switch, re-enters the current stage
// lease: {mine, live(), mode, setPanel, setExports, scrim, unscrim, strip()}

// spoke-host.js
export function renderStrip(returnTo);         // fills #lookStrip for a cast stage
export function wireDevices(root, returnTo);   // click/Enter/hover on [data-device-ref] in a 2D drawing

// ring.js
export function sitesOf(lab);    // -> [{devices, ids:Set, label, ruMin, ruMax}], ordered top to bottom by U
export function cssColor(link, lab);   // colorOf as '#rrggbb'

// ring2d.js
export async function drawSite2d({lab, sites, index});
//   -> {svg, cables:[{link, el}], stubs:[{link, li, end, far, el}]}
```

---

## Task 1: `rails.js`, and 2D rails drawn from it

Fixes the mirrored right rail and the non-EIA hole heights in 2D. Stage 6's SVG and PNG exports change too, because they use the same function.

**Files:**
- Create: `site/showcase/rails.js`
- Modify: `site/showcase/rack.js` (constants at lines 17–19, the rail loop inside `build2dElevation`, about lines 160–186)
- Modify: `check-contract.py`, `check-browser.py`

**Interfaces:**
- Produces: `rails.js` as above. `build2dElevation` tags each hole `data-rail-hole` and each number `data-rail-num`.
- Consumes: nothing new.

- [ ] **Step 1: Write the failing contract check**

Add a new section to `check-contract.py`, before `# ── report ──`:

```python
# ── one rail, drawn twice ──────────────────────────────────────────────────
# The 2D rails and the 3D posts were two ideas of a rail. The right 2D rail
# was a copy of the left instead of its mirror, so its numbers sat inside and
# its holes outside. rails.js now holds the only description, and neither
# renderer may keep its own.
rails = HERE / "site" / "showcase" / "rails.js"
rtxt = rails.read_text() if rails.is_file() else ""
check(bool(rtxt), "site/showcase/rails.js exists", "the rail has no single description")
for name in ("RU", "RAIL_W", "OPENING", "HOLE_CC", "HOLE_DY", "HOLE_SIZE", "SIDES"):
    check(re.search(rf"export const {name}\b", rtxt) is not None,
          f"rails.js exports {name}", "missing")
rack_js = (HERE / "site" / "showcase" / "rack.js").read_text()
check("from './rails.js'" in rack_js, "rack.js draws its rails from rails.js")
check(not re.search(r"const\s+(RAIL|INNER)\s*=", rack_js),
      "rack.js keeps no rail constants of its own",
      "RAIL/INNER belong to rails.js")
check("0.22" not in rack_js and "0.78" not in rack_js,
      "rack.js has no non-EIA hole fractions", "holes must come from HOLE_DY")
```

- [ ] **Step 2: Write the failing browser check**

In `check-browser.py`'s `check_stages`, right after stage `rails` becomes ready, add an in-page geometry assertion. It compares the x centre of hole 0 and number 0 on each side:

```python
        if name == "rails":
            geo = page.evaluate("""() => {
              const c = el => { const b = el.getBBox(); return b.x + b.width / 2; };
              const q = (k, s) => document.querySelector(`#stageRack [data-rail-${k}="${s}"]`);
              const out = {};
              for (const s of ['left', 'right']) {
                const h = q('hole', s), n = q('num', s);
                out[s] = h && n ? {hole: c(h), num: c(n)} : null;
              }
              return out;
            }""")
            ok = (geo.get("left") and geo.get("right")
                  and geo["left"]["num"] < geo["left"]["hole"]      # numbers outboard (left of the hole) on the left rail
                  and geo["right"]["num"] > geo["right"]["hole"])   # and to its right on the right rail
            if not ok:
                bad.append(f"stage rails: rail numbers are not outboard of the holes on both rails: {geo}")
```

- [ ] **Step 3: Run both checks and see them fail**

Run `python3 check-contract.py`. The new checks fail: `rails.js exists` and friends.

Run `python3 check-browser.py`. It fails with `rail numbers are not outboard…`, and the output shows the right side with `num < hole`, which is today's bug.

- [ ] **Step 4: Create `site/showcase/rails.js`**

```js
// ONE RAIL, DRAWN TWICE. The 2D elevation (rack.js) and the 3D rack
// (rack3d.js) both draw their rails from this, and neither keeps a copy.
// They used to disagree: 26 mm rails in 2D, 16 mm posts in 3D, and the right
// 2D rail a copy of the left rather than its mirror, so it had numbers
// inside and cage-nut holes outside.
//
// EIA-310: hole centres 465.1 mm (18.312 in) apart across the rack, and
// within each U at 0.25, 0.875 and 1.5 in from its bottom edge.
//
// x is measured in mm from the rack's centre line, positive to the right.
// Numbers sit on each rail's OUTBOARD half and holes on its INBOARD half,
// so a device's ears land between the rails, where the screws go.

export const RU = 44.45;
export const RAIL_W = 26;
export const OPENING = 450.85;
export const HOLE_CC = 465.1;
export const HOLE_DY = [6.35, 22.22, 38.10];
export const HOLE_SIZE = 6.5;

export const SIDES = ['left', 'right'].map(side => {
  const s = side === 'left' ? -1 : 1;
  return Object.freeze({
    side,
    inner: s * OPENING / 2,                    // the rail's edge facing the opening
    outer: s * (OPENING / 2 + RAIL_W),         // its edge facing away
    hole: s * HOLE_CC / 2,                     // hole centres: 7.1 mm into the rail
    number: s * (OPENING / 2 + RAIL_W * 0.7),  // number centres: the outboard half
  });
});
```

- [ ] **Step 5: Draw the 2D rails from it**

In `rack.js`, delete `export const RU`, `export const RAIL` and `export const INNER`. Import from `rails.js` and re-export `RU`, so that `00-rails.js`'s `import {RU} from '../rack.js'` keeps working:

```js
import {RU, RAIL_W, OPENING, HOLE_DY, HOLE_SIZE, SIDES} from './rails.js';
export {RU};
```

In `build2dElevation`, 2D x runs from 0 at the left rail's inner edge, which is how devices are already centred with `(INNER - w) / 2`. Convert a centre-line x with `X = x => x + OPENING / 2`. Replace every `INNER` in the function with `OPENING`, and replace the viewBox and the rail loop:

```js
  const X = x => x + OPENING / 2;          // centre-line mm -> this drawing's x
  const out = svgEl('svg', {xmlns: 'http://www.w3.org/2000/svg',
    viewBox: `${-RAIL_W - 6} -18 ${OPENING + RAIL_W * 2 + 12} ${totalH + 30}`});

  for (const s of SIDES) {
    const x0 = X(Math.min(s.inner, s.outer));
    out.append(svgEl('rect', {x: x0, y: 0, width: RAIL_W, height: totalH, 'data-rail': s.side,
      fill: 'var(--pt-surface-2)', stroke: 'var(--pt-line)', 'stroke-width': 1}));
  }
  for (let i = 0; i < heightRU; i++) {
    const u = baseRU + i;                              // the real U number
    const yBottom = totalH - i * RU;
    for (const s of SIDES) {
      const x0 = X(Math.min(s.inner, s.outer));
      out.append(svgEl('line', {x1: x0, y1: yBottom - RU, x2: x0 + RAIL_W, y2: yBottom - RU,
        stroke: 'var(--pt-line)', 'stroke-width': 0.8}));
      for (const dy of HOLE_DY) {
        out.append(svgEl('rect', {x: X(s.hole) - HOLE_SIZE / 2, y: yBottom - dy - HOLE_SIZE / 2,
          width: HOLE_SIZE, height: HOLE_SIZE, rx: 0.6, fill: 'var(--pt-ground)',
          stroke: 'var(--pt-line)', 'stroke-width': 0.5, 'data-rail-hole': s.side}));
      }
      const t = svgEl('text', {x: X(s.number), y: yBottom - RU / 2 + 4,
        'text-anchor': 'middle', 'font-family': 'IBM Plex Mono, monospace',
        'font-size': 11, 'font-weight': 500, fill: 'var(--pt-ink-muted)', 'data-rail-num': s.side});
      t.textContent = String(u);
      out.append(t);
    }
  }
```

Add `view = 'front', baseRU = 1` to the signature. The face URL becomes `` `${DIST}${e.ref}.${e.cfg}.${view}.svg` ``. A device's y uses `(e.ru - baseRU)` wherever it used `(e.ru - 1)`. Seating overrides stays front-only: skip `applyFaceOverrides` when `view !== 'front'`, and say why in a comment (bays and cages are keyed per view in the index, and the only seats the showcase makes are front seats).

Stage 0 reads its panel off `[data-rail]`. Its selector `svg.querySelectorAll('[data-rail]')` still returns the left and right rects, because the attribute now has a value. Its `inner` computation still gives 450.85.

- [ ] **Step 6: Run both checks and see them pass**

`python3 check-contract.py` should be green. `python3 check-browser.py` should be green, with the rails assertion passing.

- [ ] **Step 7: Verify by eye**

Run `python3 serve.py 8967` and open stage 0. Both rails should have numbers on the outside and holes on the inside, three holes per U, with the lowest hole 6.35 mm above each U line. Take a screenshot and describe it in your report.

- [ ] **Step 8: Commit**

```bash
git add site/showcase/rails.js site/showcase/rack.js check-contract.py check-browser.py
git commit -m "showcase: one rail, and the right 2D rail is the left one's mirror

The right rail was drawn with the left rail's offsets, so its numbers sat
inside and its holes outside. The holes also sat at 22/50/78 % of a U rather
than EIA-310's 0.25/0.875/1.5 in. rails.js now describes the rail once, and
the 2D elevation draws from it: numbers outboard, holes inboard, on both.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 2: the 3D rails drawn from `rails.js`

**Files:**
- Modify: `site/rack3d.js` (`buildRack()`, about lines 328–352)
- Modify: `check-contract.py`

**Interfaces:**
- Consumes: `rails.js` (Task 1).
- Produces: nothing new. The scene's public API is unchanged.

- [ ] **Step 1: Write the failing contract check**

Add to the rails section:

```python
r3d = (HERE / "site" / "rack3d.js").read_text()
check("from './showcase/rails.js'" in r3d, "rack3d.js draws its rails from rails.js")
check(not re.search(r"\[\s*6\.35\s*,\s*22\.22", r3d),
      "rack3d.js keeps no hole positions of its own", "HOLE_DY belongs to rails.js")
```

- [ ] **Step 2: Run it and see it fail**

Run `python3 check-contract.py`. Two FAILs.

- [ ] **Step 3: Rebuild the posts, holes and numbers**

In `rack3d.js`, import `{RAIL_W, HOLE_DY, HOLE_SIZE, SIDES}` from `'./showcase/rails.js'`. Replace the two loops in `buildRack()`:

```js
    const H = UNITS * RU;
    for (const s of SIDES) {
      // The post is the rail's full face, with its inner edge on the opening,
      // exactly as the 2D elevation draws it.
      const cx = (s.inner + s.outer) / 2;
      const post = new THREE.Mesh(new THREE.BoxGeometry(RAIL_W, H, 34), railMat);
      post.position.set(cx, H / 2, RACK_FACE_Z - 17);
      rack.add(post);
      for (let u = 0; u < UNITS; u++) {
        for (const dy of HOLE_DY) {
          const h = new THREE.Mesh(new THREE.BoxGeometry(HOLE_SIZE, HOLE_SIZE, 1), holeMat);
          h.position.set(s.hole, u * RU + dy, RACK_FACE_Z + 0.3);
          rack.add(h);
        }
        // U numbers ON the rail, on its outboard half, on BOTH rails. They
        // used to float off the left side only.
        const n = labelSprite(String(u + 1), 30, (u + 1) % 5 === 0 ? LABEL_EMPH : LABEL_UNIT);
        n.scale.multiplyScalar(0.45);   // sized to sit inside a 26 mm face; adjust by eye
        n.position.set(s.number, u * RU + RU / 2, RACK_FACE_Z + 0.6);
        rack.add(n);
      }
    }
```

Delete the old "U numbering up the left rail" loop. Leave `RACK_W` alone: the ears and the camera framing use it, and it is the 19 in ear-to-ear width, which is not the rail.

- [ ] **Step 4: Check the contract and look at it**

`python3 check-contract.py` should be green. Run `python3 serve.py 8967`, switch to 3D on stage 1 (this needs Task 3; before that, temporarily call `mount3d` from a scratch page or read the stage 1 3D view as it is today). Check that the posts match stage 0's rails, with numbers on both posts on the outboard side. Screenshot the 3D rack at the default framing. If the numbers are illegible or crowd the holes, adjust only the sprite scale factor and record the value in the report.

- [ ] **Step 5: Browser check**

Run `python3 check-browser.py`. It should stay green: 3D is exercised by the flip in Task 3, and until then by the stage walk under the headless GPU.

- [ ] **Step 6: Commit**

```bash
git add site/rack3d.js check-contract.py
git commit -m "rack3d: the posts are rails.js's rails, numbered on both sides

The 3D rack drew 16 mm posts with U numbers floating off the left only, so
stage 1's rails were not stage 0's. It now draws the same 26 mm face, holes
on the same EIA-310 centres, and numbers on the outboard half of both posts.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 3: the 2D/3D switch, with stages 0 and 1 in both modes

**Files:**
- Modify: `site/showcase/stage-rail.js`, `index.html`, `site/site.css`
- Modify: `site/showcase/stages/00-rails.js`, `01-mount.js`
- Modify: `check-contract.py`, `check-browser.py`

**Interfaces:**
- Consumes: `build2dElevation` (Task 1), `mount3d` (existing).
- Produces: `mode`, `setMode`, and `ui.mode` on the lease. Stages 2–6 read `ui.mode` in later tasks.

- [ ] **Step 1: Write the failing checks**

Contract:

```python
# ── the 2D/3D switch ───────────────────────────────────────────────────────
# 2D is the default and the product; 3D is a second view of the same data.
# One switch for the whole ladder, remembered across stages and visits.
sr = (HERE / "site" / "showcase" / "stage-rail.js").read_text()
check("export async function setMode" in sr, "stage-rail.js exports setMode")
check("portrayal.showcase.mode" in sr, "the mode is persisted under its key")
check("function readMode" in sr
      and re.search(r"===\s*'3d'\s*\?\s*'3d'\s*:\s*'2d'", sr) is not None
      and re.search(r"catch\s*\{\s*return\s+'2d'", sr) is not None,
      "the mode defaults to 2D, including when storage is unreadable",
      "readMode must return '2d' unless storage says '3d', and '2d' when it throws")
idx_html = (HERE / "index.html").read_text()
check('id="stageMode"' in idx_html, "index.html carries the 2D/3D switch")
```

Browser: add to `check_stages`, after the linear walk and before the spoke walk:

```python
    # THE SWITCH. 2D is the default; flip stage 1 to 3D, confirm the choice
    # follows to stage 2, then flip back. Each re-entry must reach ready.
    try:
        if page.get_attribute('#stageMode [data-mode="2d"]', "aria-pressed") != "true":
            bad.append("the switch does not default to 2D")
        page.click('.stage-rail button[data-stage="mount"]')
        page.wait_for_selector('[data-stage-ready="mount"]', timeout=READY_MS)
        if not page.query_selector('#stageRack svg [data-device-ref]'):
            bad.append("stage mount in 2D draws no devices")
        page.click('#stageMode [data-mode="3d"]')
        page.wait_for_selector('[data-stage-ready="mount"]', timeout=READY_MS)
        page.click('.stage-rail button[data-stage="populate"]')
        page.wait_for_selector('[data-stage-ready="populate"]', timeout=READY_MS)
        if page.get_attribute('#stageMode [data-mode="3d"]', "aria-pressed") != "true":
            bad.append("the 3D choice did not follow to the next stage")
        page.click('#stageMode [data-mode="2d"]')
        page.wait_for_selector('[data-stage-ready="populate"]', timeout=READY_MS)
    except Exception as e:
        bad.append(f"the 2D/3D switch: {e}")
```

- [ ] **Step 2: Run the checks and see them fail**

Contract: FAIL, because there is no `setMode` and no switch. Browser: FAIL, because `#stageMode` is missing.

- [ ] **Step 3: Add the bar and the switch to `index.html`**

Insert this between the `spoke-crumb` `<nav>` and `.show-body`:

```html
        <!-- Over the stage: the ring's site tabs on the left (stages 4-5, 2D),
             the view switch on the right. stage-rail.js owns both. -->
        <div class="show-bar">
          <div class="stage-tabs" id="stageTabs" role="tablist" aria-label="Sites"></div>
          <div class="stage-mode" id="stageMode" role="group" aria-label="View">
            <button type="button" data-mode="2d" aria-pressed="true">2D</button>
            <button type="button" data-mode="3d" aria-pressed="false">3D</button>
          </div>
        </div>
```

In `site/site.css`, make `.show-bar` a flex row with space-between. Style `.stage-mode` as a segmented control, reusing the `.stage-rail` button colours, with `[aria-pressed="true"]` shown as the selected state. Style `.stage-tabs` as a row of small buttons. It is empty when unused and must take no height then.

- [ ] **Step 4: Make the rail own the mode**

In `stage-rail.js`:

```js
// 2D FIRST. One view for the whole ladder, remembered across stages and
// visits. Storage can be blocked (private windows, previews); then the page
// still works and simply forgets.
const MODE_KEY = 'portrayal.showcase.mode';
function readMode() {
  try { return localStorage.getItem(MODE_KEY) === '3d' ? '3d' : '2d'; }
  catch { return '2d'; }
}
function saveMode(m) { try { localStorage.setItem(MODE_KEY, m); } catch { /* forgets */ } }
export let mode = readMode();

const modeButtons = () => [...document.querySelectorAll('#stageMode [data-mode]')];
function paintMode() {
  for (const b of modeButtons()) b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
}
```

Add `mode` to the lease. It is captured when the lease is minted, so a stage entered in 2D never sees 3D mid-entry:

```js
function lease(mine) {
  const live = () => !stale(mine);
  const m = mode;
  return Object.freeze({
    mine, live, mode: m,
    // ...setPanel, setExports, scrim, unscrim unchanged
  });
}
```

Split `activate()` so the mode switch can re-enter the current stage. `activate` keeps its early return; `enterStage` doesn't have one:

```js
export async function activate(name) {
  if (spokeOpen()) await closeSpoke({resume: false});
  if (current === name) return;
  await enterStage(name);
}

// Leave whatever is current and enter `name`, even when it IS the current
// stage: that is how switching 2D/3D redraws the stage you are on.
async function enterStage(name) {
  epoch++;
  const mine = epoch;
  vacate();
  if (current) await MODULES[current].exit?.();
  if (stale(mine)) return;
  loading.hidden = true;
  current = name;
  paintRail(name);
  hint.textContent = MODULES[name].hint || '';
  srcLine.textContent = '';
  await MODULES[name].enter(lease(mine));
  if (!stale(mine)) stageHost.setAttribute('data-stage-ready', name);
}

export async function setMode(m) {
  if ((m !== '2d' && m !== '3d') || m === mode) return;
  mode = m;
  saveMode(m);
  paintMode();
  // A spoke is always a 2D face; the new mode applies when it closes.
  if (spokeOpen() || !current) return;
  await enterStage(current);
}
```

In `boot()`, call `paintMode()` and wire `for (const b of modeButtons()) b.onclick = () => setMode(b.dataset.mode);`.

- [ ] **Step 5: Stage 0 in both modes**

In `00-rails.js`, `enter(ui)`:
- In `ui.mode === '2d'`, keep today's path exactly: `build2dElevation({stack: [], heightRU: RACK_U})`, and read the panel off the drawn geometry.
- In `'3d'`: `stageRack.hidden = true; stage3d.hidden = false; ui.scrim('Building the empty rack…'); const scene = await mount3d({stack: [], heightRU: RACK_U});`. If `!ui.live()`, dispose and return. Call `ui.unscrim()` only if `scene`. Keep the scene in the closure so `exit()` disposes it. The panel values come from `rails.js` (`RU`, `OPENING`), and the lead says: *"Drawn in 3D from the same rail description as the 2D view."* Confirm that `mount3d` with an empty stack builds just the rack. If it throws, report NEEDS_CONTEXT rather than working around it.
- `exit()` clears both layers: `stageRack` (hide and empty) and `stage3d` (dispose the scene, hide, empty).

- [ ] **Step 6: Stage 1 in both modes**

In `01-mount.js`, compute `stack`, `rows`, `used` and `free` exactly as today. Then:
- In `'2d'`: `const svg = await build2dElevation({stack: CAST.filter(e => e.ru != null), heightRU: RACK_U, overrides}); if (!ui.live()) return;`. Show it in `stageRack` (unhide it and hide `stage3d`), and set `panZoom(svg, () => base)` as stage 0 does. There is no GLB export in 2D; offer `SVG` instead via `saveSvg(svg, 'rack-mounted.svg')`.
- In `'3d'`: today's `mount3d` path, unchanged.
- The panel is identical in both modes (R11).
- `exit()` clears both layers.

- [ ] **Step 7: Run both checks**

Both should be green, including the switch walk. Report the browser runtime.

- [ ] **Step 8: Throwaway Playwright proof (do not commit)**

In a fresh context, confirm:
- stage 0 and stage 1 render in 2D by default;
- setting `localStorage['portrayal.showcase.mode']='3d'` before load starts in 3D;
- with `localStorage` access made to throw (`page.add_init_script` redefining `Storage.prototype.getItem`/`setItem` to throw), the page still loads in 2D and the switch still works within the visit;
- switching mode twice fast (2D→3D→2D) leaves one stage entered, ready, in 2D, with zero pageerrors.

Run it in WebGL and in forced-no-WebGL modes.

- [ ] **Step 9: Commit**

```bash
git add index.html site/site.css site/showcase/stage-rail.js site/showcase/stages/00-rails.js site/showcase/stages/01-mount.js check-contract.py check-browser.py
git commit -m "showcase: a 2D|3D switch, 2D by default, for the whole ladder

The compiled 2D faces are the product and 3D is a second view of them, so
2D is the default. One switch covers every stage and is remembered across
stages and visits; with storage blocked the page still works and forgets.
Switching re-enters the stage through the rail, under the same lease that
guards a rung click.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 4: stages 2, 3 and 6 in 2D

**Files:**
- Create: `site/showcase/svg2d.js`
- Modify: `site/showcase/stages/02-populate.js`, `03-optics.js`, `06-takeaway.js`
- Modify: `check-browser.py`

**Interfaces:**
- Consumes: `ui.mode` (Task 3), `build2dElevation` (Task 1), `enqueueRebuild`, `overrides`.
- Produces: `svg2d.js`'s `boxIn`, `highlight` and `clearHighlights`, which Tasks 5, 6 and 7 use.

- [ ] **Step 1: Write the failing browser check**

The walk already asserts stage 2's refusal (`[data-readout][data-refused]`) and stage 3's seat (`[data-seated]`). They now run in 2D by default, so they pass or fail on the 2D path. Add one assertion after stage 3's seat:

```python
                if not page.query_selector('#stageRack svg [data-highlight]'):
                    bad.append("stage optics in 2D: the seated optic's TX bore is not highlighted on the face")
```

and one after stage 2's accepted seat, if the walk makes one (add a seat if it doesn't):

```python
                if not page.query_selector('#stageRack svg [data-device-ref="asr-9006"]'):
                    bad.append("stage populate in 2D: the ASR-9006 is not drawn")
```

- [ ] **Step 2: Run it and see it fail**

Run `python3 check-browser.py`. It fails: stages 2 and 3 have no 2D drawing yet.

- [ ] **Step 3: Create `site/showcase/svg2d.js`**

```js
// Geometry inside a composed 2D drawing. A face is placed by a transform on
// its group, so an element's getBBox is in its own space; this walks it back
// into the root <svg>'s user units, the same way artifact.js's box() does for
// the inlined drawing.

export function boxIn(root, el) {
  if (!el || !root) return null;
  const b = el.getBBox();
  const m = root.getScreenCTM()?.inverse().multiply(el.getScreenCTM());
  if (!m) return {x: b.x, y: b.y, width: b.width, height: b.height};
  const p = (x, y) => { const q = root.createSVGPoint(); q.x = x; q.y = y; return q.matrixTransform(m); };
  const a = p(b.x, b.y), c = p(b.x + b.width, b.y + b.height);
  return {x: Math.min(a.x, c.x), y: Math.min(a.y, c.y),
          width: Math.abs(c.x - a.x), height: Math.abs(c.y - a.y)};
}

export function highlight(root, el, tag = 'hl', pad = 1.2) {
  const b = boxIn(root, el);
  if (!b) return null;
  el.setAttribute('data-highlight', tag);
  const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  for (const [k, v] of Object.entries({x: b.x - pad, y: b.y - pad, width: b.width + pad * 2,
      height: b.height + pad * 2, rx: 1, class: 'pt-hl', 'data-highlight-box': tag,
      'pointer-events': 'none'})) r.setAttribute(k, v);
  root.append(r);
  return r;
}

export function clearHighlights(root, tag = 'hl') {
  root.querySelectorAll(`[data-highlight-box="${tag}"]`).forEach(n => n.remove());
  root.querySelectorAll(`[data-highlight="${tag}"]`).forEach(n => n.removeAttribute('data-highlight'));
}
```

Add `.pt-hl { fill: none; stroke: var(--pt-brass); stroke-width: 1.4; }` to `site/site.css`.

Note: `boxIn` needs the root attached to the document (getScreenCTM returns null otherwise). Callers must append the drawing to `stageRack` before highlighting.

- [ ] **Step 4: Stage 2 in 2D**

In `02-populate.js`, the side panel, the refusal and the `overrides` writes are unchanged. Add a `draw()` that renders the picture for the current mode:
- In `'2d'`: `build2dElevation({stack: CAST.filter(e => e.ru != null), heightRU: RACK_U, overrides})`. Put the result in `stageRack`, check `ui.live()` after the await, and keep pan/zoom.
- In `'3d'`: today's scene path.

After an accepted seat, redraw through `enqueueRebuild`, exactly where the 3D path rebuilds today. The 2D redraw has no re-entrancy problem, but it goes through the same queue so the pictures land in click order. It also keeps R18: stale seats are dropped before any write. `exit()` clears both layers.

- [ ] **Step 5: Stage 3 in 2D**

The same pattern as stage 2: redraw after a seat or unseat. After the 2D redraw, highlight the TX bore of the seated optic. Its path comes from the same derived occupant path list the panel already builds (it contains `…-occupant/tx/bore` or `…-occupant/tx`). Prefer the `/bore` path when it exists:

```js
const g = svg.querySelector(`[data-device-ref="${DEV}"]`);
const target = g?.querySelector(`[data-path="${CSS.escape(txBorePath)}"]`)
            || g?.querySelector(`[data-path="${CSS.escape(txPath)}"]`);
if (target) highlight(svg, target);
```

In 2D, the panel's position line reads *"TX bore highlighted on the face"* in place of the portAnchor coordinate. If the path isn't on the face, it says so honestly. The 3D path is unchanged.

- [ ] **Step 6: Stage 6 in 2D**

In `'2d'`, show the 2D elevation (the same `build2dElevation` call stage 1 uses). There is no click-on-device here (spec §4). Exports:
- draw.io, SVG, PNG and DCIM are unchanged.
- GLB and USDZ need a scene. In 2D, replace their two buttons with one: `3D formats (GLB, USDZ) — switch to 3D`. Its `run` calls `setMode('3d')` (import it from `stage-rail.js`; stages may import the rail's functions, just not `epoch`).

In `'3d'`, it's today's path.

- [ ] **Step 7: Run both checks**

Contract green, browser green. Then a throwaway Playwright proof in both GPU modes:
- In 2D, seat a card in stage 2, switch to 3D, and confirm it's still seated. Switch back.
- Seat an optic in stage 3 in 2D and confirm the highlight.
- Leave stage 3 while a 2D redraw is queued, and confirm the next stage's panel is intact.
- Zero pageerrors throughout.

- [ ] **Step 8: Commit**

```bash
git add site/showcase/svg2d.js site/site.css site/showcase/stages/02-populate.js site/showcase/stages/03-optics.js site/showcase/stages/06-takeaway.js check-browser.py
git commit -m "showcase: populate, optics and take-it-away draw in 2D too

Seats and refusals live in overrides, not in either picture, so a card
seated in 2D is there in 3D and back again. In 2D the seated optic's TX bore
is highlighted on the face instead of a 3D coordinate. Stage 6 offers the 3D
formats by switching to 3D rather than pretending to export a scene it has
not built.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 5: "Look closer": click the drawing, plus an index strip

**Files:**
- Modify: `site/showcase/spoke-host.js` (the `lookCloser` at about line 163 becomes `renderStrip`; add `wireDevices`)
- Modify: `site/showcase/stage-rail.js` (lease `strip()`; `vacate()` hides the strip)
- Modify: `index.html`, `site/site.css`
- Modify: `site/showcase/stages/01-mount.js`, `02-populate.js`, `03-optics.js` (remove `lookCloser(...)` from the panels; call `ui.strip()`; in 2D call `wireDevices`)
- Modify: `check-contract.py`, `check-browser.py`

**Interfaces:**
- Consumes: `svg2d.js`'s `boxIn` (Task 4), and `openSpoke` and `LENS_DEVICES` (existing).
- Produces: `renderStrip(returnTo)`, `wireDevices(root, returnTo)`, `ui.strip()`.

- [ ] **Step 1: Write the failing checks**

Contract:

```python
# ── look closer: on the drawing, with an index strip ───────────────────────
# It used to sit 400 px down a side panel clipped at 520 px. Now it is the
# drawing itself (2D) plus an always-visible strip under the stage (2D and 3D).
sh = (HERE / "site" / "showcase" / "spoke-host.js").read_text()
check("export function renderStrip" in sh, "spoke-host.js exports renderStrip")
check("export function wireDevices" in sh, "spoke-host.js exports wireDevices")
check('id="lookStrip"' in (HERE / "index.html").read_text(), "index.html carries the look strip")
stage_txt = "".join(p.read_text() for p in (HERE / "site" / "showcase" / "stages").glob("*.js"))
check("lookCloser(" not in stage_txt, "no stage puts Look closer in its side panel")
```

Browser: in the spoke walk, switch the first spoke open from the strip button to **clicking the device on the drawing**. Keep one strip-button open so both paths are exercised:

```python
        # By the drawing: stage 2 is in 2D by default, and every device is a
        # real element.
        page.click('.stage-rail button[data-stage="populate"]')
        page.wait_for_selector('[data-stage-ready="populate"]', timeout=READY_MS)
        page.click('#stageRack svg [data-device-ref="as7726-32x"]')
        page.wait_for_selector('#spokeCrumb:not([hidden])', timeout=READY_MS)
        page.click('#spokeBack')
        page.wait_for_selector('[data-stage-ready="populate"]', timeout=READY_MS)
        # By the strip: always visible under the stage.
        if not page.is_visible('#lookStrip'):
            bad.append("the look strip is not visible on a cast stage")
```

The existing clicks on `[data-spoke-device=…][data-spoke-lens=…]` keep working, because the strip's buttons carry the same attributes.

- [ ] **Step 2: Run the checks and see them fail**

Contract: FAIL. Browser: FAIL (clicking the device opens nothing, and `#lookStrip` is missing).

- [ ] **Step 3: The strip**

In `index.html`, put this between `.show-body` and `.show-foot`:

```html
        <!-- Look closer: every cast device and its lenses, always visible.
             The only way in from 3D; in 2D the drawing is clickable too. -->
        <div class="look-strip" id="lookStrip" hidden></div>
```

In `spoke-host.js`, rename `lookCloser` to `renderStrip(returnTo)`. It fills `#lookStrip` instead of returning a panel element, and unhides it. It starts with a label, **Look closer**, followed by *"click a device on the drawing, or"* when `mode === '2d'`. Then comes one group per cast device, with a button per lens. Keep `data-spoke-device` / `data-spoke-lens` and the R23 note for devices that only get Inspect, shortened to a `title`. Add `export function hideStrip()`, which empties and hides the strip.

In `stage-rail.js`, add `strip: () => { if (live()) renderStrip(current); }` to the lease, and call `hideStrip()` in `vacate()`. `stage-rail.js` already imports from `spoke-host.js`.

- [ ] **Step 4: Click on the drawing**

In `spoke-host.js`:

```js
// IN 2D, THE DEVICE IS THE BUTTON. build2dElevation tags every device group
// with data-device-ref; hovering one outlines it and names its lenses, and
// clicking (or Enter) opens Inspect. A drag that pans the drawing is not a
// click, so a pointer that moved more than a few px since pointerdown opens
// nothing.
export function wireDevices(root, returnTo) {
  for (const g of root.querySelectorAll('[data-device-ref]')) {
    const ref = g.dataset.deviceRef;
    const e = CAST.find(c => c.ref === ref);
    if (!e) continue;
    const lenses = lensesFor(ref);
    g.setAttribute('tabindex', '0');
    g.setAttribute('role', 'button');
    g.setAttribute('aria-label', `${e.label}: look closer (${lenses.length} lens${lenses.length > 1 ? 'es' : ''})`);
    g.classList.add('pt-device');
    let down = null;
    g.addEventListener('pointerdown', ev => { down = {x: ev.clientX, y: ev.clientY}; });
    const open = () => openSpoke({dev: ref, cfg: e.cfg, lens: 'inspect', returnTo,
                                  origin: {dev: ref, lens: 'inspect'}}).catch(err =>
                                  console.warn('[portrayal] open spoke', err));
    g.addEventListener('click', ev => {
      if (down && Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > 4) return;
      open();
    });
    g.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); open(); } });
  }
}
```

In `site/site.css`, `.pt-device { cursor: pointer; }` and `.pt-device:hover, .pt-device:focus-visible { outline: 2px solid var(--pt-brass); outline-offset: 1px; }`. SVG `outline` works on `<g>` in Chromium, Firefox and Safari. If it doesn't render, use `svg2d.highlight(root, g, 'hover')` on `pointerenter` and `clearHighlights(root, 'hover')` on `pointerleave`, and note which you used. The hover "chip" in the mockup is the native `<title>` tooltip: append `<title>${e.label} · ${lenses.join(', ')}</title>` as the group's first child. A custom chip is out of scope.

If `origin` refocus on close expects a strip button, make `closeSpoke` fall back to focusing the device group (`[data-device-ref=origin.dev]`) when no strip button matches.

- [ ] **Step 5: The stages**

In `01-mount.js`, `02-populate.js` and `03-optics.js`:
- remove `lookCloser('…')` from `ui.setPanel(...)`;
- call `ui.strip()` after the panel is set;
- in `'2d'`, call `wireDevices(svg, '<stage name>')` after each 2D draw (and each redraw) is appended.

Stages 0, 4, 5 and 6 call neither function.

- [ ] **Step 6: Run both checks, plus a proof**

Both checks should be green. For the throwaway proof, in 2D:
- A drag across a device pans without opening a spoke.
- Tab to a device, press Enter, and the spoke opens.
- Close it, and focus returns to that device.
- In 3D, the strip is visible and opens spokes.
- Zero pageerrors.

Run this in both GPU modes.

- [ ] **Step 7: Commit**

```bash
git add index.html site/site.css site/showcase/spoke-host.js site/showcase/stage-rail.js site/showcase/stages/01-mount.js site/showcase/stages/02-populate.js site/showcase/stages/03-optics.js check-contract.py check-browser.py
git commit -m "showcase: look closer by clicking the device, or from a strip that is always there

It sat 400 px down a side panel clipped at 520 px, below the cut. In 2D the
devices on the drawing are real elements, so clicking one opens its lens. A
strip under the stage names every device and its lenses, which is how the
feature is found, and the only way in from 3D. The side panel is back to
holding the stage's answer.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 6: the ring in 2D, by site (stage 4)

**Files:**
- Modify: `site/showcase/ring.js` (add `sitesOf`, `cssColor`)
- Create: `site/showcase/ring2d.js`
- Modify: `site/showcase/stage-rail.js` (`vacate()` empties `#stageTabs`)
- Modify: `site/showcase/stages/04-cable.js`, `site/site.css`
- Modify: `check-contract.py`, `check-browser.py`

**Interfaces:**
- Consumes: `build2dElevation({…, view, baseRU})` (Task 1), `svg2d.js` (Task 4), and `loadLab`, `colorOf` and `summarize` (existing).
- Produces: `sitesOf`, `cssColor`, and `drawSite2d`, which Task 7 uses.

- [ ] **Step 1: Write the failing checks**

Contract:

```python
# ── the ring in 2D, by site ─────────────────────────────────────────────────
# Sites are the connected components left when the span links are dropped:
# structural, so they survive renamed devices. Parsing "site-a-" out of an id
# is the naming-convention guess this project keeps refusing.
ring_js = (HERE / "site" / "showcase" / "ring.js").read_text()
ring2d = HERE / "site" / "showcase" / "ring2d.js"
r2 = ring2d.read_text() if ring2d.is_file() else ""
check("export function sitesOf" in ring_js, "ring.js exports sitesOf")
check(bool(r2), "site/showcase/ring2d.js exists")
src_ring = ring_js + r2 + "".join((HERE / "site" / "showcase" / "stages" / f).read_text()
                                  for f in ("04-cable.js", "05-filter.js"))
check(not re.search(r"""['"`]site-|\bsite-[a-z]\b|split\(\s*['"]-['"]\s*\)""", src_ring),
      "the ring code parses no site out of device ids", "derive sites from the topology")
# The stage-4 section assigns `ring` inside a conditional block, so it may
# not exist at all when labs.json is missing. Read it defensively; a
# NameError here would crash the contract instead of recording a FAIL.
lab_ring = globals().get("ring")
if lab_ring is not None:
    ring = lab_ring
    ids = [d["id"] for d in ring["devices"]]
    par = {i: i for i in ids}
    def root(x):
        while par[x] != x:
            x = par[x]
        return x
    for l in ring["links"]:
        if not l.get("span"):
            par[root(l["from"][0])] = root(l["to"][0])
    comps = {}
    for i in ids:
        comps.setdefault(root(i), []).append(i)
    check(len(comps) == 3 and sum(map(len, comps.values())) == len(ids),
          "dropping span links splits the ring into 3 sites covering every device",
          f"got {len(comps)} components")
else:
    check(False, "dropping span links splits the ring into 3 sites covering every device",
          "labs.json is unusable")
```

Browser: stage 4 in 2D (the default):

```python
        if name == "cable":
            try:
                tabs = page.query_selector_all('#stageTabs [role="tab"]')
                if len(tabs) != 3:
                    bad.append(f"stage cable in 2D: expected 3 site tabs, got {len(tabs)}")
                before = page.inner_text('#stageTabs [aria-selected="true"]')
                page.click('#stageRack [data-stub]')
                page.wait_for_selector('#stageRack [data-stub][data-highlight]', timeout=READY_MS)
                after = page.inner_text('#stageTabs [aria-selected="true"]')
                if after == before:
                    bad.append("stage cable in 2D: clicking a stub did not switch site")
                if not page.query_selector('#stageRack [data-cable]'):
                    bad.append("stage cable in 2D: no cables drawn in the site")
            except Exception as e:
                bad.append(f"stage cable in 2D: {e}")
```

- [ ] **Step 2: Run the checks and see them fail**

Contract FAILs on sitesOf, ring2d and the split (the split check passes; the others FAIL). Browser FAIL: there are no tabs yet.

- [ ] **Step 3: `sitesOf` and `cssColor` in `ring.js`**

```js
// THE SITES, FROM THE TOPOLOGY. Drop every span link and what stays
// connected is a site: its controller and its ROADMs, joined by management,
// cross-connect and OSC links. Structural on purpose: nothing reads a site
// out of a device id's prefix. (Do not quote an example id in a comment
// here either; the contract's no-prefix-parsing check scans comments too.)
// Ordered top to bottom by U, and each is labelled by its highest-U device,
// exactly as the data spells it.
export function sitesOf(lab) {
  const parent = new Map(lab.devices.map(d => [d.id, d.id]));
  const root = x => { while (parent.get(x) !== x) x = parent.get(x); return x; };
  for (const l of lab.links || []) {
    if (l.span) continue;
    const a = root(l.from[0]), b = root(l.to[0]);
    if (a !== b) parent.set(a, b);
  }
  const groups = new Map();
  for (const d of lab.devices) {
    const r = root(d.id);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(d);
  }
  return [...groups.values()]
    .map(devs => devs.slice().sort((a, b) => b.ru - a.ru))
    .sort((a, b) => b[0].ru - a[0].ru)
    .map(devs => ({
      devices: devs,
      ids: new Set(devs.map(d => d.id)),
      label: devs[0].label,
      ruMin: Math.min(...devs.map(d => d.ru)),
      ruMax: Math.max(...devs.map(d => d.ru)),   // every ring device is 1 U
    }));
}

export const cssColor = (link, lab) => '#' + colorOf(link, lab).toString(16).padStart(6, '0');
```

The `// every ring device is 1 U` shortcut holds for this lab (both refs are `chassis.ru: 1`). Use `unitsOf` from rack.js instead if it's reachable without loading the cast. Otherwise keep the comment and add a contract check that both ring refs are 1U, so the assumption fails loudly if it stops being true.

- [ ] **Step 4: `ring2d.js`**

`drawSite2d({lab, sites, index})` composes one outer `<svg>` in mm. It holds the site's **front** elevation on the left and its **rear** elevation on the right, each from `build2dElevation({stack, heightRU, overrides: {}, view, baseRU})`:
- `stack` = the site's devices as `{ref, cfg: <configs.json default>, ru, label: id, u: 1}`. Get `cfg` the way `ring.js` does today.
- `baseRU = site.ruMin - 1` and `heightRU = site.ruMax - site.ruMin + 3`, so there is one U of rail above and below.
- Each elevation is a nested `<svg>` whose `viewBox` is copied from the built elevation. It is placed at `x = 0` and at `x = elevationWidth + GAP`, where `GAP = 240` mm. The gap is where cables cross and stubs sit.
- Label each elevation `FRONT` / `REAR` above it.

Then append the outer svg to `stageRack` (it must be attached before `boxIn`) and draw on a `<g data-cables>` layer over both:
- **Anchor** of an end `[devId, port, strand?]` means: find the device group `[data-device-name="${devId}"]` in the front elevation, then in the rear. The first face with `[data-path="${port}"]` wins, and that face tells you which side the end is on. `boxIn(outer, el)` gives the centre. Offset the two strands of a pair by ±3.2 mm vertically: `tx` is −, `rx` is +, and none is 0. This matches the 3D strand spacing.
- **Within-site link** (both ends in `site.ids`): a `<path data-cable data-link-index=i>` with a cubic Bézier. For front→front, bow out to the right of the front elevation by 30 mm, into the gap. For rear→front (management), cross the gap. Use `stroke = cssColor(link, lab)`, `stroke-width 1.6`, `fill none`.
- **Span link** (one end in the site): at this site's end, draw a short lead into the gap and a stub pill: `<g data-stub data-link-index=i data-end=from|to data-far=<far site index>>` holding a rounded `rect` in the span's colour plus `<text>→ ${far.label} · ${farDevId} · ${farPort}</text>`. Make the stub focusable (`tabindex=0`, `role=button`).
- Return `{svg, cables, stubs}`. The link index `i` is the link's index in `lab.links`, which is stable across sites and is how a stub finds its partner.

If an end cannot be anchored, don't draw that cable. Count it, and return the count as `unanchored` so the panel can say so. It should be 0.

- [ ] **Step 5: Stage 4 in 2D**

In `04-cable.js`, in `'2d'`:
- `loadLab()`, check `ui.live()`, then compute `sites = sitesOf(lab)`.
- Render tabs into `#stageTabs`: one `<button role="tab" aria-selected>` per site, labelled `site.label`, with Left/Right arrow roving. It is guarded: build the tabs only while `ui.live()`. `vacate()` (in `stage-rail.js`) empties `#stageTabs`.
- `show(index, {highlightLink, from})` does the following:
  - clears `stageRack`
  - calls `drawSite2d`, checking `ui.live()` after the await
  - sets `aria-selected` on the tab
  - wires stubs: clicking a stub (or pressing Enter on it) calls `show(stub.far, {highlightLink: i, from: index})`
  - if `highlightLink` is set, finds the partner stub (same `data-link-index`) and calls `highlight(svg, partner)`, plus highlights the partner's port element
  - if `from != null`, shows a `← back to ${sites[from].label}` button in the panel that calls `show(from, {highlightLink})`
- The panel is today's summary (devices, links, media counts, spans), plus the caption. Put the caption first, computed from the lab, not typed:
  ```js
  const lo = Math.min(...lab.devices.map(d => d.ru)), hi = Math.max(...lab.devices.map(d => d.ru));
  lead(`Grouped by site, as the ring's topology divides it. Physically all three share one lab rack (U${lo}–${hi}).`)
  ```
  "three" comes from `sites.length`: write it as a word for 2–9 and as a digit otherwise.
- The export in 2D is the current site as SVG (`saveSvg(svg, `ring-${site.label}.svg`)`). GLB is 3D only, so offer "switch to 3D", as in stage 6.
- In `'3d'`, today's path is unchanged.
- `exit()` clears `stageRack`, the 3D ring (existing), and nothing else. `#stageTabs` is the rail's job.

In `site/site.css`, add `[data-stub] { cursor: pointer; }` and a visible focus ring for stubs.

- [ ] **Step 6: Run both checks, plus a proof**

Both checks should be green. For the throwaway proof, in 2D:
- For each site, count drawn cables and stubs. Across the three sites that should be 24 cables in total, and 12 stubs (6 span links × 2 ends).
- Click every stub and confirm it lands on the right site with the partner highlighted. Back returns.
- The management runs start on the REAR elevation.
- Zero `unanchored`.
- Leave stage 4 mid-draw, and stage 3's panel is intact.
- Zero pageerrors.

Run in both GPU modes. Screenshot site A and describe it.

- [ ] **Step 7: Commit**

```bash
git add site/showcase/ring.js site/showcase/ring2d.js site/showcase/stage-rail.js site/showcase/stages/04-cable.js site/site.css check-contract.py check-browser.py
git commit -m "showcase: the ring in 2D, one site at a time, span links as stubs

Each site is a front and rear elevation with its 24 in-site cables drawn
between real ports; management runs cross from the rear eth4 to the front
controller. The 6 span links end in stubs naming the far end, and a stub
takes you there with the partner highlighted. Sites are the components left
when the span links are dropped, never a prefix read out of an id. The view
says plainly that physically all three share one lab rack.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 7: stage 5 filters the 2D site view

**Files:**
- Modify: `site/showcase/stages/05-filter.js`
- Modify: `check-browser.py`

**Interfaces:**
- Consumes: `sitesOf`, `drawSite2d` (Task 6), `purpose` (existing).

- [ ] **Step 1: Write the failing browser check**

The walk already asserts that toggling `management` reads "6 of 30" (`data-matching` / `data-total`). In 2D, add:

```python
                vis = page.evaluate("""() => [...document.querySelectorAll(
                    '#stageRack [data-cable], #stageRack [data-stub]')]
                    .filter(n => getComputedStyle(n).display !== 'none' && n.getAttribute('visibility') !== 'hidden').length""")
                # 05-filter.js sets data-visible-cables on the panel element itself.
                if vis != int(page.get_attribute('#sidePanel', 'data-visible-cables') or -1):
                    bad.append(f"stage filter in 2D: the drawn count ({vis}) and data-visible-cables disagree")
```

- [ ] **Step 2: Run it and see it fail**

Stage 5 has no 2D drawing yet, so it fails.

- [ ] **Step 3: Implement**

In `'2d'`, use the same site tabs and `drawSite2d` as stage 4. Keep the stage's existing filter state (media set and purpose set) and its global counts. After each draw, and after each toggle, go through the current site's `cables` and `stubs` and hide those whose link doesn't match. Use the SVG `visibility="hidden"` attribute so geometry and anchors stay stable. Set `data-visible-cables` from what is visibly drawn in the current site. Counts in the panel stay global ("6 of 30") and don't change with the tab. Stubs follow their link's match. Clicking a stub works as in stage 4. Tabs, back and the caption are shared with stage 4: move the tab and show logic into `ring2d.js` as `export function siteView({ui, lab, sites, onDraw})` if it isn't already there, and use it from both stages. Don't copy it.

In `'3d'`, today's path is unchanged.

- [ ] **Step 4: Run both checks, plus a proof**

Both checks green. Throwaway proof in 2D:
- Management only: site A shows exactly the 2 management cables that site has, and no stubs.
- "Ring span" only: stubs only.
- Switch tabs, and the counts don't change.

Run in both GPU modes, with zero pageerrors.

- [ ] **Step 5: Commit**

```bash
git add site/showcase/stages/05-filter.js site/showcase/ring2d.js check-browser.py
git commit -m "showcase: stage 5 filters the 2D site view, counts stay global

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**

| spec section | task |
|---|---|
| §2 one rail: rails.js, EIA holes, numbers outboard on both, 26 mm face | 1 (2D), 2 (3D) |
| §2 stage 6 SVG/PNG pick up the fix | 1 (shared `build2dElevation`) |
| §3 switch: header, 2D default, one for the ladder, persisted with try/catch, re-enter through the rail | 3 |
| §3 per-stage table: 0, 1 | 3 |
| §3 per-stage table: 2, 3, 6 | 4 |
| §3 per-stage table: 4, 5 | 6, 7 |
| §3 seats survive a mode switch | 4 (proof) |
| §4 click on the drawing, keyboard, index strip, only stages 1–3, panel section removed | 5 |
| §5.1 sites from topology, no prefix parsing | 6 (code + contract) |
| §5.2 tabs, front+rear, in-site cables, stubs, jump + highlight + back, caption with computed U range | 6 |
| §5.3 filter in 2D, global counts | 7 |
| §5.4 3D unchanged | 6, 7 (the `'3d'` branches keep today's path) |
| §6 contract and browser checks | spread across 1–7 |

**Two interpretations, stated so a reviewer can reject them:**
- **Stage 6, and stage 4 in 2D:** GLB and USDZ are offered as "switch to 3D" rather than exported from a scene that was never built. Spec §3 says stage 6's exports are "unchanged". Taken literally, that would mean building a hidden 3D scene in 2D mode just to export it.
- **The hover chip** in the mockup becomes a native `<title>` tooltip plus an outline. A custom floating chip is extra UI the spec does not require.

**Placeholder scan:** none. Every code step has code; the steps that describe layout (Task 6 step 4) give exact attributes, dimensions and the anchor rule.

**Type consistency:**
- `build2dElevation({stack, heightRU, overrides, view, baseRU})` is the same in Tasks 1, 3, 4 and 6.
- `ui.mode` / `ui.strip()` are defined in Tasks 3 and 5 and used in 3–7.
- `boxIn` / `highlight` / `clearHighlights` are defined in Task 4 and used in 5–7.
- `sitesOf` / `cssColor` / `drawSite2d` are defined in Task 6 and used in 7.
- `data-rail-hole` / `data-rail-num` (Task 1) are used by its browser check.
- `data-stub` / `data-cable` / `data-link-index` / `data-highlight` (Tasks 4, 6) are used by the browser checks in 6 and 7.
