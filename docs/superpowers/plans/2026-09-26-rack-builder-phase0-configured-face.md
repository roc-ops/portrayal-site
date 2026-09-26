# Rack Builder Phase 0: one configured face for every export (implementation plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every drawing and export of a specific device carries its configured state: seated cards, optics, optic fields, and the rear face. All of it goes through one function, `configuredFace()`.

**Architecture:**
- A new module, `site/rack/face.js`, fetches a compiled face and seats the swaps on it with swap.js's `seatFace` (bays, cages and rear holes, on any view). It then paints optic fields with fields.js's `paintFields`, reads the ports with drawio.js's `readSvg`, and memoizes the result.
- The consumers move onto it:
  - the showcase 2D elevation;
  - draw.io port cells, which gain a `portrayal-path` attribute;
  - stage 6's draw.io export (front and rear) and its GLB/USDZ export;
  - Explorer's new "as configured" SVG/PNG download.

**Tech stack:**
- Vanilla ES modules with no build step, served by `serve.py`.
- Browser checks in `check-browser.py`, using Playwright's sync API.

**Spec:** `docs/superpowers/specs/2026-09-26-rack-builder-design.md` (§4). Read §4 before starting.

## Global constraints

- **Never edit anything under `vendor/` or `assets/`.** They are snapshots of the upstream Portrayal project, and `./refresh-assets.sh` overwrites them. Use their exports; don't change them.
- There is no bundler, no npm and no new dependency. Modules import each other by relative path.
- Prose in comments and UI copy uses American English (color, center). Upstream code in `vendor/` is British, so leave that alone.
- Showcase behavior must not change, except for the fixes this plan makes on purpose (rear seating, draw.io content, and the GLB wait).
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Serve locally with `python3 serve.py 8932`. `file://` does not work, because pages fetch SVGs.

## Facts the tasks rely on (verified 2026-09-26)

- `vendor/swap.js:1462`: `seatFace(rootEl, {bays, cages}, overrides, loadSkin, compByRef)` → `{applied, refused, failed, rear, ...}`.
  - It runs `applyFaceOverrides` and then `applyRearOverrides`.
  - It works on a detached, `DOMParser`-parsed root; `seatViews` already does this.
  - `compByRef` is a **synchronous** `ref => component`.
  - `loadSkin` is `async ref => {comp, text} | null`.
- `vendor/fields.js:81`: `paintFields(el, vals)`.
  - Explorer applies fields to paths sorted shortest first.
  - Each path matches `[data-path="<path>"]` and `[data-projection][data-of="<path>"]` (vendor/relief.js:1162).
- `site/drawio.js:124`: `readSvg(text)` → `{vb, zones}`. Each zone is `{id, cls: 'port'|'bay', path, group, media, speed, model, x, y, w, h}`, and `path` is the element's `data-path`.
- `site/drawio.js:205`: `portsOf(zones, {bays})`.
- A seated module or optic carries `data-ref="<ref>:<version>"`, e.g. `data-ref="generic/qsfp-lc@2:…"`. Tests match on the `data-ref="<ref>` prefix.
- Test fixtures, all present in `assets/dist/`:
  - `asr-9006`, config `base`: front bay `slot-2` accepts `cisco/a9k-16x100ge-tr@1`. That card's first port is at path `slot-2/module/p0`, the path `site/showcase/patching.json` cables to.
  - `as7726-32x`, config `ac-f2b`:
    - rear bay `psu-2` accepts `common/psu-dc-650@2`; its default is the AC unit;
    - front cage `port-1` accepts `generic/qsfp-lc@2`;
    - the optic's fields live on path `port-1-occupant`, with key `label`.
- `site/rack3d.js:937`: the scene exposes `complete()`, which resolves when the deferred relief pass is done.
- In `check-browser.py`:
  - checks are `fn(page, base) -> list[str]` of problems;
  - stages are entered with `page.click('.stage-rail button[data-stage="<id>"]')` followed by `page.wait_for_selector('[data-stage-ready="<id>"]', timeout=READY_MS)`.
- `exporter.html:418` and `site/drawings-page.js:203` both honor `?device=`. `drawio.html` does not.

## File map

| File | Change |
|---|---|
| `site/rack/face.js` | **Create.** `components`, `findComp`, `loadSkin`, `applyFields`, `configuredFace` |
| `check-browser.py` | Add a registry of extra checks and an `--only` flag; add one check per task |
| `site/showcase/rack.js` | `loadMeta` and `loadSkin` come from face.js; `build2dElevation` draws configured faces for every view |
| `site/drawio.js` | Port cells become `<object portrayal-path=…>` |
| `site/showcase/stages/06-takeaway.js` | draw.io from configured front and rear faces; GLB/USDZ await `complete()`; panel copy (Task 4); rebuilt on `enterPatched` so it shows and exports the cables (Task 4b) |
| `site/showcase/cables.js`, `site/showcase/patch-view.js` | The cable layer is a drawing, not UI; `cableFace` / `cabledElevationSvg`; `handle.scene` (Task 4b) |
| `explorer.html` | "As configured" SVG/PNG menu items; DCIM and Drawings links carry `?device=` |

---

### Task 1: `configuredFace()` and a fast way to run one check

**Files:**
- Create: `site/rack/face.js`
- Modify: `check-browser.py`:
  - add the registry, `run_extra`, and `check_configured_face` just above `def main():` (line 1355 after the 2026-09-26 rebase);
  - in `main()`, add the `--only` argument, the early branch and the full-run call.

**Interfaces:**
- Produces:
  - `configuredFace({ref, cfg, view='front', swaps={}, fields={}, turned=false}) → Promise<{ref, cfg, view, text, vb, zones, ports, seat:{applied, refused, failed}} | null>`.
    - The result is frozen and memoized; treat it as read-only.
    - It resolves to `null` when the compiled face does not exist.
    - `view` in the result is the face actually drawn; `turned` swaps front and rear.
  - `components() → Promise<Array>`
  - `findComp(list, ref)`
  - `loadSkin(ref) → Promise<{comp, text} | null>`
  - `applyFields(root, fields) → root`
  - `DIST = 'assets/dist/'`
  - In `check-browser.py`:
    - the `@extra(label)` decorator, which registers a check;
    - `run_extra(browser, base, only, problems, notes) → int` (the number failed);
    - `--only name1,name2`, which runs only those registered checks, by function name.

- [ ] **Step 1: Add the check registry and the `--only` flag to `check-browser.py`**

Just above `def main():`, add:

```python
# CHECKS ADDED FOR THE RACK BUILDER, registered rather than hand-wired into
# main() one block at a time, so `--only` can run one of them in seconds while
# a task is being built. Each is fn(page, base) -> list of problems.
EXTRA_CHECKS = []


def extra(label):
    def register(fn):
        EXTRA_CHECKS.append((label, fn))
        return fn
    return register


def run_extra(browser, base, only, problems, notes):
    failed = 0
    for label, fn in EXTRA_CHECKS:
        if only and fn.__name__ not in only:
            continue
        page = browser.new_page()
        try:
            bad = fn(page, base)
        except Exception as e:
            bad = [f"{label}: {str(e).splitlines()[0]}"]
        finally:
            page.close()
        if bad:
            failed += 1
            problems.append(f"FAIL  {label}")
            problems += [f"        {b}" for b in dict.fromkeys(bad)]
        else:
            notes.append(f"ok    {label}")
    return failed
```

In `main()`, after `ap.add_argument("--url", …)`, add:

```python
    ap.add_argument("--only", help="run only these registered extra checks, by function "
                                   "name, comma-separated - skips the page sweep and the stages")
```

Directly after `browser = pw.chromium.launch()`, add:

```python
            only = set(filter(None, (args.only or "").split(",")))
            if only:
                failed_things += run_extra(browser, base, only, problems, notes)
                browser.close()
                for line in notes + problems:
                    print("  " + line)
                return 1 if failed_things else 0
```

Directly before the marks-harness block (`page = browser.new_page()` / `passed, failed = run_marks_harness(page, base)`), add:

```python
            failed_things += run_extra(browser, base, None, problems, notes)
```

- [ ] **Step 2: Write the failing check**

Add this below `run_extra`:

```python
@extra("configuredFace seats cards, rear bays, optics and fields")
def check_configured_face(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    page.goto(f"{base}/index.html", wait_until="load")
    r = page.evaluate("""async () => {
      const F = await import('/site/rack/face.js');
      const out = {};
      const plain = await F.configuredFace({ref: 'asr-9006', cfg: 'base', view: 'front'});
      const card = await F.configuredFace({ref: 'asr-9006', cfg: 'base', view: 'front',
        swaps: {'slot-2': 'cisco/a9k-16x100ge-tr@1'}});
      out.plainHasCardPort = plain.zones.some(z => z.path === 'slot-2/module/p0');
      out.cardZone = card.zones.some(z => z.path === 'slot-2/module/p0');
      out.cardPort = card.ports.some(p => p.path === 'slot-2/module/p0');
      const rear = await F.configuredFace({ref: 'as7726-32x', cfg: 'ac-f2b', view: 'rear',
        swaps: {'psu-2': 'common/psu-dc-650@2'}});
      out.rearPsu = rear.text.includes('data-ref="common/psu-dc-650@2');
      const opt = await F.configuredFace({ref: 'as7726-32x', cfg: 'ac-f2b', view: 'front',
        swaps: {'port-1': 'generic/qsfp-lc@2'},
        fields: {'port-1-occupant': {label: 'PROBE-LR4'}}});
      out.optic = opt.text.includes('data-ref="generic/qsfp-lc@2');
      out.label = opt.text.includes('PROBE-LR4');
      const turned = await F.configuredFace({ref: 'as7726-32x', cfg: 'ac-f2b', view: 'front', turned: true});
      out.turned = turned.view === 'rear';
      out.memo = F.configuredFace({ref: 'asr-9006', cfg: 'base', view: 'front'})
             === F.configuredFace({view: 'front', cfg: 'base', ref: 'asr-9006'});
      out.missing = (await F.configuredFace({ref: 'asr-9006', cfg: 'no-such-cfg', view: 'front'})) === null;
      return out;
    }""")
    expect = {"plainHasCardPort": False, "cardZone": True, "cardPort": True, "rearPsu": True,
              "optic": True, "label": True, "turned": True, "memo": True, "missing": True}
    for k, want in expect.items():
        if r.get(k) != want:
            bad.append(f"configuredFace: {k} is {r.get(k)!r}, expected {want!r}")
    return bad
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `python3 check-browser.py --only check_configured_face`
Expected: `FAIL  configuredFace seats …`, with an import error for `/site/rack/face.js` (404).

- [ ] **Step 4: Create `site/rack/face.js`**

```js
// ONE DEVICE FACE, AS CONFIGURED. Every consumer that draws or exports a
// specific device - the 2D elevation, draw.io, Explorer's download, and the
// Rack Builder - asks here, so none of them can show the base build while
// another shows the cards and optics the reader seated.
//
//   configuredFace({ref, cfg, view, swaps, fields, turned})
//
// fetches <ref>.<cfg>.<view>.svg and then, on a detached copy:
//   1. seats `swaps` through swap.js's seatFace - bays, then cages, then the
//      rear holes that show a swapped bay's back - on ANY view, not only the
//      front. (build2dElevation seated the front alone, which is how rear
//      plugs and PSUs went missing from the rear elevation.)
//   2. paints `fields` (an optic's latch color, its label) the way Explorer
//      does: shortest path first, on the part and on its projections.
//   3. reads ports and bays with drawio.js's readSvg, so a port on a seated
//      card or optic is a port like any other.
//
// `turned` means the device's other panel faces out, so front and rear swap.
// Resolves to null when the face was never compiled. Results are memoized on
// the whole argument and frozen: treat them as read-only.

import {jdist} from '../../vendor/dist.js';
import {seatFace} from '../../vendor/swap.js';
import {paintFields} from '../../vendor/fields.js';
import {readSvg, portsOf} from '../drawio.js';

export const DIST = 'assets/dist/';
const OPPOSITE = {front: 'rear', rear: 'front'};

let COMPONENTS = null;
export function components() {
  if (!COMPONENTS) {
    COMPONENTS = jdist(`${DIST}components.json`)
      .then(j => j.components || [])
      .catch(err => { console.warn('[portrayal] no component index', err); return []; });
  }
  return COMPONENTS;
}

const refKey = c => `${c.ns}/${c.name}@${c.major.slice(1)}`;
export const findComp = (list, ref) => list.find(c => refKey(c) === String(ref).split(':')[0]);

export async function loadSkin(ref) {
  const c = findComp(await components(), ref);
  if (!c) return null;
  const skin = c.skins?.includes('default') ? 'default' : c.skins?.[0];
  const r = await fetch(`${DIST}components/${c.ns}--${c.name}--${c.major}--${skin}.svg`);
  if (!r.ok) return null;
  return {comp: c, text: await r.text()};
}

export function applyFields(root, fields) {
  const entries = Object.entries(fields || {}).sort(([a], [b]) => a.length - b.length);
  for (const [path, vals] of entries) {
    const p = CSS.escape(path);
    for (const el of root.querySelectorAll(`[data-path="${p}"],[data-projection][data-of="${p}"]`))
      paintFields(el, vals);
  }
  return root;
}

const canon = v => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])]))
  : v;

const MEMO = new Map();
export function configuredFace({ref, cfg, view = 'front', swaps = {}, fields = {}, turned = false}) {
  const args = {ref, cfg, view, swaps: swaps || {}, fields: fields || {}, turned: !!turned};
  const key = JSON.stringify(canon(args));
  if (!MEMO.has(key)) {
    MEMO.set(key, build(args).catch(err => { MEMO.delete(key); throw err; }));
  }
  return MEMO.get(key);
}

async function build({ref, cfg, view, swaps, fields, turned}) {
  const shown = turned ? (OPPOSITE[view] || view) : view;
  const res = await fetch(`${DIST}${ref}.${cfg}.${shown}.svg`);
  if (!res.ok) return null;
  let text = await res.text();
  const seat = {applied: 0, refused: [], failed: []};
  const hasSwaps = Object.keys(swaps).length > 0;
  const hasFields = Object.keys(fields).length > 0;
  if (hasSwaps || hasFields) {
    const root = new DOMParser().parseFromString(text, 'image/svg+xml').documentElement;
    if (hasSwaps) {
      const idx = await jdist(`${DIST}${ref}.configs.json`);
      const list = await components();
      const r = await seatFace(root,
        {bays: idx?.bays?.[shown] || [], cages: idx?.cages?.[shown] || []},
        swaps, loadSkin, x => findComp(list, x));
      seat.applied = r.applied; seat.refused = r.refused; seat.failed = r.failed;
    }
    if (hasFields) applyFields(root, fields);
    text = new XMLSerializer().serializeToString(root);
  }
  const {vb, zones} = readSvg(text);
  return Object.freeze({ref, cfg, view: shown, text, vb, zones,
                        ports: portsOf(zones, {bays: true}), seat});
}
```

- [ ] **Step 5: Run the check and confirm it passes**

Run: `python3 check-browser.py --only check_configured_face`
Expected: `ok    configuredFace seats cards, rear bays, optics and fields`, exit 0.

If `label` alone fails, the optic's label field key may not be `label`. Find the field names with `grep -o '"fields":[^]]*' assets/dist/components.json | head` and use the real key in the check. Don't change face.js for this.

- [ ] **Step 6: Commit**

```bash
git add site/rack/face.js check-browser.py
git commit -m "rack: configuredFace - one device face as configured, for every export

Seats swaps on any view (bays, cages, rear holes), paints optic fields,
reads ports on seated cards. check-browser.py gains a registry of extra
checks and --only to run one of them.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The showcase elevation draws configured faces on every view

**Files:**
- Modify: `site/showcase/rack.js`:
  - `loadMeta` at lines 94-104;
  - `loadSkin` at lines 145-153;
  - `build2dElevation` at lines 197-234.

**Context (main, commit `1f686179`):**
- `build2dElevation` already seats every view, via `applyFaceOverrides` against `baysOf(e.ref)[view]` / `cagesOf(e.ref)[view]`.
- Two gaps remain, and this task closes them:
  - (a) it skips `applyRearOverrides`, the rear-hole pass that `seatFace` adds;
  - (b) `baysOf` / `cagesOf` read `loadMeta`'s index, which only loads `CAST`. A device outside the cast, which is every Rack Builder device, seats nothing.
- `configuredFace` loads each device's own `configs.json`, so it fixes both.
- Modify: `check-browser.py`, to add `check_rear_elevation`.

**Interfaces:**
- Consumes: `configuredFace`, `components` and `loadSkin` from `site/rack/face.js` (Task 1).
- Produces: `build2dElevation({stack, heightRU, overrides, view, baseRU})`.
  - The signature is unchanged.
  - Rear views are now seated.
  - Stack entries may carry `turned`.

- [ ] **Step 1: Write the failing check**

```python
@extra("the rear elevation seats a swapped rear bay")
def check_rear_elevation(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    page.goto(f"{base}/index.html", wait_until="load")
    html = page.evaluate("""async () => {
      const {build2dElevation} = await import('/site/showcase/rack.js');
      const svg = await build2dElevation({
        stack: [{ref: 'as7726-32x', cfg: 'ac-f2b', u: 1, ru: 1, label: 'probe'}],
        heightRU: 2, view: 'rear',
        overrides: {'as7726-32x': {'psu-2': 'common/psu-dc-650@2'}}});
      return svg.outerHTML;
    }""")
    if 'data-ref="common/psu-dc-650@2' not in html:
        bad.append("rear elevation: psu-2 swap to common/psu-dc-650@2 not seated")
    return bad
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `python3 check-browser.py --only check_rear_elevation`
Expected: FAIL with `psu-2 swap … not seated`. The check never calls `loadMeta`, so `baysOf('as7726-32x')` is `{}` and today's elevation has no bays to seat against. That is gap (b) above.

- [ ] **Step 3: Route rack.js through face.js**

At the top of `site/showcase/rack.js`, next to the other imports, add:

```js
import {configuredFace, components as faceComponents, loadSkin as faceLoadSkin} from '../rack/face.js';
```

In `loadMeta()`, replace this line:

```js
  try { components = (await jdist(`${DIST}components.json`)).components; }
  catch (err) { console.warn('[portrayal] no component index', err); components = []; }
```

with:

```js
  components = await faceComponents();
```

Replace the whole `export async function loadSkin(ref) { … }` (lines 145-153) with:

```js
// One skin loader for the showcase and every configured face, so the two can
// never resolve a component differently.
export const loadSkin = faceLoadSkin;
```

Keep `byRef` as it is. Stage 3 reads it synchronously after `loadMeta`.

In `build2dElevation`, replace the start of the loop body:

```js
    const url = `${DIST}${e.ref}.${e.cfg}.${view}.svg`;
    const text = await fetch(url).then(r => r.ok ? r.text() : null);
    if (!text) continue;
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
```

with:

```js
    // The face as configured, on whichever view is asked for - front OR rear.
    const face = await configuredFace({ref: e.ref, cfg: e.cfg, view,
                                       swaps: ov?.[e.ref] || {}, turned: !!e.turned});
    if (!face) continue;
    const doc = new DOMParser().parseFromString(face.text, 'image/svg+xml');
```

Delete everything from `const mine = ov?.[e.ref];` through the closing `}` of the `if (mine && Object.keys(mine).length) { … applyFaceOverrides … }` block, including its "Each face is seated against ITS OWN bays and cages" comment. Move that comment's substance (per-view keys; the R740xd's rear RJ45 plugs; rear swaps from the Inspect lens) into the comment above `configuredFace(...)` in the loop, because it still explains why the view matters. Also update the comment block above `build2dElevation` so it says that devices are drawn through `configuredFace`, which seats bays, cages and rear holes on any view.

- [ ] **Step 4: Run the new check and the showcase regression**

Run: `python3 check-browser.py --only check_rear_elevation`
Expected: ok.

Run: `python3 check-browser.py`
Expected: every existing check still passes: the pages, the 7-stage rail, the stage 4 rear loose end, embed, and the marks harness.

- [ ] **Step 5: Commit**

```bash
git add site/showcase/rack.js check-browser.py
git commit -m "showcase: the elevation draws configured faces, so the rear seats too

build2dElevation seated overrides on the front face only; it now draws
every device through configuredFace on whichever view it is asked for.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: draw.io port cells carry their drawing path

**Files:**
- Modify: `site/drawio.js`: `deviceCells`, lines 255-313 (the two port `cell(...)` calls).
- Modify: `check-browser.py`, to add `check_drawio_port_paths`.

**Interfaces:**
- Consumes: `configuredFace` (Task 1).
- Produces: every port cell in `deviceCells` output is `<object label="" portrayal-path="<data-path>" id="<cellId>"><mxCell … connectable=1 …/></object>`. Cell ids are unchanged, so existing diagrams and the library keep their ids. Phase 2 cable edges find a port by `portrayal-path`.

- [ ] **Step 1: Write the failing check**

```python
@extra("draw.io port cells carry portrayal-path, including ports on a seated card")
def check_drawio_port_paths(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    page.goto(f"{base}/index.html", wait_until="load")
    r = page.evaluate("""async () => {
      const F = await import('/site/rack/face.js');
      const D = await import('/site/drawio.js');
      const f = await F.configuredFace({ref: 'asr-9006', cfg: 'base', view: 'front',
        swaps: {'slot-2': 'cisco/a9k-16x100ge-tr@1'}});
      const xml = D.deviceCells('dev', f.text, f.vb, f.ports, 0, 0, 200, 200).join('');
      const doc = new DOMParser().parseFromString(`<root>${xml}</root>`, 'application/xml');
      return {path: xml.includes('portrayal-path="slot-2/module/p0"'),
              parses: !doc.querySelector('parsererror')};
    }""")
    if not r["path"]:
        bad.append('draw.io: no port cell with portrayal-path="slot-2/module/p0"')
    if not r["parses"]:
        bad.append("draw.io: deviceCells output is not well-formed XML")
    return bad
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `python3 check-browser.py --only check_drawio_port_paths`
Expected: FAIL with `no port cell with portrayal-path=…`.

- [ ] **Step 3: Add `portCell` and use it for both port loops**

In `site/drawio.js`, directly below the existing `const cell = …` helper, add:

```js
// A PORT names the drawing path it came from. The cell id is a slug of the
// SVG id, which is namespaced for a port on a seated card
// (slot-2--module--p0); the path (slot-2/module/p0) is what a cable plan,
// Explorer's swaps and the Rack Builder all speak, so a connector drawn later
// finds its port by this attribute instead of reversing the slug.
const portCell = (id, path, style, x, y, w, h, parent) =>
  `<object label="" portrayal-path="${esc(path)}" id="${esc(id)}"><mxCell style="${style}" ` +
  `vertex="1" parent="${esc(parent)}"><mxGeometry x="${x.toFixed(2)}" y="${y.toFixed(2)}" ` +
  `width="${Math.max(w, 0.5).toFixed(2)}" height="${Math.max(h, 0.5).toFixed(2)}" ` +
  `as="geometry"/></mxCell></object>`;
```

In `deviceCells`, change the port cell inside the `for (const b of bays)` loop from:

```js
      out.push(cell(`${id}-${p.id}`, '',
        `${tint(p.cls)}html=1;connectable=1;${PORT_POINT}`,
        p.x * sx - bx, p.y * sy - by,
        Math.max(p.w * sx, 1.5), Math.max(p.h * sy, 1.5), `${id}-${b.id}`));
```

to:

```js
      out.push(portCell(`${id}-${p.id}`, p.path || p.id,
        `${tint(p.cls)}html=1;connectable=1;${PORT_POINT}`,
        p.x * sx - bx, p.y * sy - by,
        Math.max(p.w * sx, 1.5), Math.max(p.h * sy, 1.5), `${id}-${b.id}`));
```

Change the loose-port loop from:

```js
    out.push(cell(`${id}-${p.id}`, '', `${tint(p.cls)}html=1;connectable=1;${PORT_POINT}`,
      p.x * sx, p.y * sy, Math.max(p.w * sx, 1.5), Math.max(p.h * sy, 1.5), id));
```

to:

```js
    out.push(portCell(`${id}-${p.id}`, p.path || p.id, `${tint(p.cls)}html=1;connectable=1;${PORT_POINT}`,
      p.x * sx, p.y * sy, Math.max(p.w * sx, 1.5), Math.max(p.h * sy, 1.5), id));
```

Leave the empty-bay cell as it is.

- [ ] **Step 4: Confirm nothing parses port cells as bare `<mxCell>`**

Run: `grep -n "mxCell" site/*.js site/showcase/*.js site/showcase/stages/*.js | grep -v "^site/drawio.js"`
Expected: no line that parses `deviceCells` output. If one does, make it accept `<object>`-wrapped cells as well; bays already use that form.

- [ ] **Step 5: Run the check and the full suite**

Run: `python3 check-browser.py --only check_drawio_port_paths`
Expected: ok.

Run: `python3 check-browser.py`
Expected: everything still passes.

Then open `http://localhost:8932/drawio.html`, download one rack elevation, open it in draw.io (desktop or app.diagrams.net), and confirm that dragging a connector onto a port still snaps to the port's center.

- [ ] **Step 6: Commit**

```bash
git add site/drawio.js check-browser.py
git commit -m "drawio: port cells carry portrayal-path, the drawing path of the port

Ids are unchanged; a later cable edge finds its port by path instead of
reversing the namespaced SVG id.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Stage 6 exports the rack as built, front and rear

**Files:**
- Modify: `site/showcase/stages/06-takeaway.js`: the header comment (lines 1-31), the imports (lines 36-41), `buildDrawio` (lines 79-102), the `kv` copy (lines 170-176) and the export items (lines 183-205).
- Modify: `check-browser.py`, to add `check_takeaway_drawio`.

**Interfaces:**
- Consumes: `configuredFace` (Task 1) and `portCell` output (Task 3).
- Produces: `cast-rack.drawio`, with front and rear cabinets and ports on seated cards. GLB and USDZ export only after `scene.complete()`.

- [ ] **Step 1: Write the failing check**

```python
@extra("stage 6 draw.io carries the plan's seated card, front and rear")
def check_takeaway_drawio(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    page.goto(f"{base}/index.html", wait_until="load")
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
    return bad
```

`pathlib` is already imported at the top of check-browser.py (line 33).

- [ ] **Step 2: Run it and confirm it fails**

Run: `python3 check-browser.py --only check_takeaway_drawio`
Expected: FAIL on both lines. Today stage 6 draws base front faces only.

- [ ] **Step 3: Rewrite `buildDrawio` and the imports**

Replace `import {rackDiagram, loadFace, portsOf} from '../../drawio.js';` with:

```js
import {rackDiagram} from '../../drawio.js';
import {configuredFace} from '../../rack/face.js';
```

Replace the body of `buildDrawio` with the following. Keep its numbering comment, which explains the two U numbering schemes.

```js
  // The cast AS BUILT, both sides: each device's configured face - the cards,
  // optics and plugs stages 2-4 seated - so the diagram's port cells include
  // the ports on those cards. A side a device was never drawn for is left
  // out, and rackDiagram says "no rear drawing" there rather than borrowing
  // the other side.
  async function buildDrawio() {
    const mounted = [];
    for (const e of CAST) {
      if (e.ru == null) continue;   // dropped from the rack - no compiled index
      const faces = {};
      for (const view of ['front', 'rear']) {
        const f = await configuredFace({ref: e.ref, cfg: e.cfg, view,
                                        swaps: overrides[e.ref] || {}}).catch(() => null);
        if (f) faces[view] = {svg: f.text, vb: f.vb, ports: f.ports};
      }
      if (!faces.front && !faces.rear) continue;
      // TWO NUMBERINGS. (keep the existing comment here unchanged)
      mounted.push({name: e.label, u: RACK_U - (e.ru + e.u - 1) + 1, ru: e.u, faces});
    }
    const groups = [{label: 'Cast rack', racks: [{label: '', units: RACK_U, mounted}]}];
    save(rackDiagram(groups, {faces: ['front', 'rear'], labels: true}),
         'cast-rack.drawio', 'application/xml');
  }
```

- [ ] **Step 4: GLB/USDZ wait for the finished scene**

Replace the two 3D export items with:

```js
        // complete() first: optics and plugs are extruded by the deferred
        // relief pass, and an export taken before it lands has them flat.
        items.push({label: 'GLB', title: 'Download the mounted rack as a GLB, with the current overrides',
          run: async () => { await scene.complete(); save(await scene.toGLB(), 'cast-rack.glb', 'model/gltf-binary'); }});
        items.push({label: 'USDZ', title: 'Download the mounted rack as a USDZ, with the current overrides',
          run: async () => { await scene.complete(); save(await scene.toUSDZ(), 'cast-rack.usdz', 'model/vnd.usdz+zip'); }});
```

- [ ] **Step 5: Update the copy so it no longer claims the base configuration**

In the `kv` rows, change the draw.io row to:

```js
          ['draw.io', 'rack diagram, front and rear, with the seated cards and optics and a connection point on every port'],
```

Change the draw.io export item's `title` to `'Download a draw.io rack diagram - front and rear, as built, with a connection point on every port'`.

In the header comment, replace the `draw.io` paragraph with:

```
//   draw.io   - a rack diagram through drawio.js's rackDiagram, fed each
//               device's configured face (site/rack/face.js) on front and
//               rear, so the cards, optics and plugs seated here are in it
//               and their ports are connection points.
```

In the GLB/USDZ paragraph, add a line saying the exports await `scene.complete()`.

- [ ] **Step 6: Run the check and the full suite**

Run: `python3 check-browser.py --only check_takeaway_drawio`
Expected: ok.

Run: `python3 check-browser.py`
Expected: everything passes.

- [ ] **Step 7: Commit**

```bash
git add site/showcase/stages/06-takeaway.js check-browser.py
git commit -m "showcase: stage 6 exports the rack as built - draw.io front and rear

draw.io is fed configured faces, so the plan's line card, optics and plugs
are in it with a connection point on each port; GLB and USDZ wait for the
relief pass so optics are not exported flat.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4b: Stage 6 shows the cabling, and its exports carry it

Added 2026-09-26 from the showcase session's handoff (`.superpowers/handoffs/2026-09-26-stage6-cables.md`), at the user's request. Stage 4 (Cable) and stage 5 (Filter) are about the cables, and stage 6 currently drops them. After this task:
- stage 6 shows the plan's cables, in 2D (with the Front/Rear toggle, as in stage 4) and in 3D;
- its SVG and PNG exports carry the cables;
- its GLB and USDZ exports carry the cable tubes.

draw.io edges stay in Phase 2. **Do not change cable geometry or colors**: the user approved the look, including the length-proportional sag.

**Files:**
- Modify: `site/showcase/cables.js`: `drawCables2d`, where the cable layer is marked `data-pt-ui`.
- Modify: `site/showcase/patch-view.js`:
  - extract `cableFace` from `enter2d`'s `paintFace`;
  - add `cabledElevationSvg`;
  - expose the 3D scene on the handle.
- Modify: `site/showcase/stages/06-takeaway.js`: `enter` and `exit` are rebuilt on `enterPatched`.
- Modify: `check-browser.py`, to add `check_takeaway_cables_2d` and `check_takeaway_cables_3d`.

**Interfaces:**
- Consumes (Task 4, same file):
  - `buildDrawio` (configured faces, front and rear);
  - the GLB/USDZ items that `await scene.complete()`;
  - `dcimSection`.

  Keep all three.
- Consumes (main): `enterPatched(ui, {head, top, counts, onDrawn, extraPanel})` → handle `{mode, plan, kept, drawn, loose, view, setView, highlight, dispose}`. It applies the plan's seats itself through `applyPlanSeats`, with the fill rule.
- Produces:
  - `cableFace(svg, handle, view) → {vb}` in patch-view.js. It widens the viewBox for tails and tags, and draws cables and tags onto an elevation that is already attached and laid out.
  - `cabledElevationSvg(handle, view) → Promise<string>`: standalone SVG text of a freshly built, cabled elevation, built off-screen.
  - `handle.scene`: the mounted 3D scene, in 3D mode, or null.

**Facts (verified on main `fdadf2ac`):**
- `drawCables2d` (cables.js:128) creates `layer = svgEl('g', {'data-cables': view, 'data-pt-ui': '*'})` and `tagLayer = svgEl('g', {'data-cable-tags': view, 'data-pt-ui': '*'})`.
- `standalone()` (artifact.js) deletes every `[data-pt-ui="*"]` node from its clone, so every cable is dropped from exports today.
- Each cable `<g data-cable …>` carries `tabindex: '0'`.
- `drawCables2d` uses `getScreenCTM`, so the elevation must be in the document and laid out. `looseEnds` in patch-view.js already builds elevations in a hidden, fixed-position host for this reason.
- `drawCables3d(scene, plan)` adds a `patch-cables` group, with one `cable-<i>` group per link, to `scene.three.scene`. `toGLB()` / `toUSDZ()` export `scene.three.scene`, so the tubes are included.
- The plan has 14 links (`site/showcase/patching.json`).
- The 3D mode is switched with `page.click('#stageMode [data-mode="3d"]')`. A 3D stage gets `READY_3D_MS` (240 s).

- [ ] **Step 1: Write the failing 2D check**

```python
@extra("stage 6 shows the cables in 2D, and its SVG export keeps them without UI")
def check_takeaway_cables_2d(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    page.goto(f"{base}/index.html", wait_until="load")
    # Straight to stage 6: it must apply the plan's seats itself.
    page.click('.stage-rail button[data-stage="takeaway"]', timeout=READY_MS)
    page.wait_for_selector('[data-stage-ready="takeaway"]', timeout=READY_MS)
    n = page.eval_on_selector_all('#stageRack [data-cable]', "els => els.length")
    if n == 0:
        bad.append("stage 6 2D: no [data-cable] drawn")
    if not page.is_visible('#stageTabs button[data-view="rear"]'):
        bad.append("stage 6 2D: no Front/Rear toggle")
    with page.expect_download(timeout=READY_MS) as dl:
        page.click('#stageExport button:has-text("SVG")')
    text = pathlib.Path(dl.value.path()).read_text()
    got = text.count("data-cable=")
    if got != n:
        bad.append(f"stage 6 SVG: {got} cables exported, {n} drawn on screen")
    for ui_bit in ("data-cable-tags", "data-tag=", "data-not-connected", "cable-focus",
                   'tabindex="0"', "data-pt-ui"):
        if ui_bit in text:
            bad.append(f"stage 6 SVG: screen UI leaked into the export ({ui_bit})")
    return bad
```

- [ ] **Step 2: Write the failing 3D check**

```python
@extra("stage 6 hangs the cables in 3D, and the GLB carries them")
def check_takeaway_cables_3d(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    page.goto(f"{base}/index.html", wait_until="load")
    page.click('.stage-rail button[data-stage="takeaway"]', timeout=READY_MS)
    page.wait_for_selector('[data-stage-ready="takeaway"]', timeout=READY_MS)
    page.click('#stageMode [data-mode="3d"]')
    page.wait_for_selector('#stageExport button:has-text("GLB")', timeout=READY_3D_MS)
    with page.expect_download(timeout=READY_3D_MS) as dl:
        page.click('#stageExport button:has-text("GLB")')
    glb = pathlib.Path(dl.value.path()).read_bytes()
    missing = [i for i in range(14) if f'"cable-{i}"'.encode() not in glb]
    if missing:
        bad.append(f"stage 6 GLB: no node for cable(s) {missing}")
    return bad
```

If the CI browser has no WebGL, stage 6 offers no GLB button. That's R11: the panel is still built, and the check times out. `check_stages` already runs stage 4 in 3D under the same conditions, so WebGL is available there. If the 3D check fails only for lack of WebGL, report that rather than weakening the check.

- [ ] **Step 3: Run both and confirm they fail**

Run: `python3 check-browser.py --only check_takeaway_cables_2d,check_takeaway_cables_3d`
Expected:
- 2D: FAIL, `no [data-cable] drawn`.
- 3D: FAIL, `no node for cable(s) [0, …, 13]`.

- [ ] **Step 4: Cables are a drawing, not screen UI (`cables.js`)**

In `drawCables2d`, change the cable layer to:

```js
  // The CABLES are the drawing, and exports keep them (standalone() drops
  // every [data-pt-ui="*"] node). The TAGS beside them are on-screen
  // controls - a cross-face button, a not-connected link to the stage that
  // fixes it - so that layer stays UI and never reaches a file.
  const layer = svgEl('g', {'data-cables': view});
  const tagLayer = svgEl('g', {'data-cable-tags': view, 'data-pt-ui': '*'});
```

On each cable group, mark its focusability as UI, so that `standalone()` strips `tabindex`:

```js
    const g = svgEl('g', {'data-cable': 'true', 'data-link-index': String(i),
      'data-media': link.media, 'data-purpose': link.purpose, tabindex: '0',
      'data-pt-ui': 'tabindex'});
```

The cable's `<title>` (its from → to description) stays: it describes the drawing, not a control.

- [ ] **Step 5: `patch-view.js`: extract `cableFace`, add `cabledElevationSvg`, expose the scene**

Add `standalone` to the existing `./artifact.js` import.

Move the body of `enter2d`'s `paintFace`, from `const base = svg.getAttribute('viewBox')…` through the `handle.drawn = drawCables2d(…)` call, into this exported function. The pill and tag code moves unchanged.

```js
// ONE CABLED FACE, on an elevation already in the document and laid out
// (drawCables2d reads CTMs): the viewBox widened for tails and their tags on
// the side a cross-face cable goes round (spec §6), then the plan's cables
// and tags drawn onto it. The stage and the exports both use this, so a file
// can never show a different cabling from the screen.
export function cableFace(svg, handle, view) {
  const base = svg.getAttribute('viewBox').split(/\s+/).map(Number);
  const rear = view === 'rear';
  const vb = rear ? [base[0] - ROOM, base[1], base[2] + ROOM, base[3] + 40]
                  : [base[0], base[1], base[2] + ROOM, base[3] + 40];
  svg.setAttribute('viewBox', vb.join(' '));
  const edgeX = rear ? base[0] - 8 : base[0] + base[2] + 8;
  const pill = (t, at, label, gap = 4) => {
    const w = 7 * label.length + 12;
    const x = rear ? at[0] - gap - w : at[0] + gap;
    t.append(svgEl('rect', {x, y: at[1] - 9, width: w, height: 18, rx: 4}));
    const tx = svgEl('text', {x: x + 6, y: at[1] + 4}); tx.textContent = label; t.append(tx);
    return t;
  };
  handle.drawn = drawCables2d(svg, handle.plan, view, {
    edgeX, outboard: rear ? -1 : 1,
    tag: (at, far) => pill(svgEl('g', {'data-tag': far.join(':'), 'data-to-view': endView(far),
      class: 'cable-tag', tabindex: '0', role: 'button'}), at, `→ ${far[0]} ${endView(far)} · ${far[1]}`),
    farLoose: (i, side) => !!handle.loose[i]?.includes(side),
    looseTag: (at, far) => {
      const {why, stage} = looseWhy(handle.plan, handle.kept, far);
      const t = svgEl('g', {'data-not-connected': far.join(':'), class: 'cable-tag not-connected',
        ...(stage ? {'data-fix-stage': stage, tabindex: '0', role: 'button'} : {})});
      const full = svgEl('title', {}); full.textContent = looseReason(handle.plan, handle.kept, far);
      t.append(full);
      return pill(t, at, `✕ ${why}`);
    },
  });
  return {vb};
}

// A CABLED ELEVATION AS A FILE: a fresh elevation of `view` with the current
// overrides, cabled by cableFace in a hidden host (laid out, never seen),
// and returned as standalone() text. Fresh rather than the one on screen, so
// hover and focus state and the visitor's pan/zoom never reach a file, and
// so 3D mode, which has no elevation on screen, exports the same thing.
export async function cabledElevationSvg(handle, view = 'front') {
  const svg = await build2dElevation({stack: CAST.filter(e => e.ru != null), heightRU: RACK_U,
                                      overrides, view});
  const host = el('div', {'aria-hidden': 'true'});
  host.style.cssText = 'position:fixed;left:0;top:0;width:800px;visibility:hidden;pointer-events:none';
  document.body.append(host);
  try {
    host.append(svg);
    cableFace(svg, handle, view);
    return standalone(svg);
  } finally {
    host.remove();
  }
}
```

In `paintFace`, replace the moved code with:

```js
    const {vb} = cableFace(svg, handle, view);
    panZoom(svg, () => vb);
    handle.view = view;
```

Keep `wireClicks(…)`, `wireHover(svg)`, `paint(view)` and `onDrawn?.(handle)` after it, unchanged.

In `enterPatched`, add `scene: null` to the initial `handle` object. In `enter3d`, directly after `handle.dispose = () => sc?.dispose();`, add:

```js
  handle.scene = sc;   // stage 6 exports it; null without WebGL
```

- [ ] **Step 6: Rebuild stage 6 on `enterPatched` (`06-takeaway.js`)**

Keep `dcimSection` and `buildDrawio`, both from Task 4. Replace `makeTakeaway`'s state, `buildPng`, `enter` and `exit` with the code below. The header comment gains a paragraph saying that stage 6 is stage 4's cabled rack, applies the plan's seats itself, and exports the cables.

```js
import {stage3d, stageRack, title, lead, kv, save, DIST} from '../artifact.js';
import {CAST, RACK_U, overrides} from '../rack.js';
import {enterPatched, cabledElevationSvg} from '../patch-view.js';
```

Drop the imports this file no longer uses: `el`, `saveSvg`, `standalone`, `panZoom`, `loadMeta`, `chassisOf`, `mount3d` and `build2dElevation`. Keep `rackDiagram`, `configuredFace`, `rasterize` and `setMode`.

```js
export default function makeTakeaway() {
  let handle = null;

  // The face the visitor is looking at in 2D; the front in 3D, which has none.
  const face = () => (handle?.mode === '2d' && handle.view) || 'front';

  async function buildSvg() {
    save(await cabledElevationSvg(handle, face()), `cast-rack-${face()}.svg`, 'image/svg+xml');
  }

  // rasterize() only takes a URL, so the cabled SVG goes through a blob URL.
  async function buildPng() {
    const text = await cabledElevationSvg(handle, face());
    const url = URL.createObjectURL(new Blob([text], {type: 'image/svg+xml'}));
    try {
      const bytes = await rasterize(url, 2);
      if (!bytes) throw new Error('could not rasterize the elevation');
      save(bytes, `cast-rack-${face()}.png`, 'image/png');
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  return {
    title: 'Take it away',
    question: 'Where can it go from here?',
    async enter(ui) {
      let exportsIndex = null;
      try {
        exportsIndex = await fetch('assets/exports/index.json').then(r => r.ok ? r.json() : null);
      } catch (err) {
        console.warn('[portrayal] no export index', err);
      }
      if (!ui.live()) return;
      const is3d = ui.mode === '3d';
      // Stage 4's cabled rack - the plan's seats applied here too, so a
      // visitor who jumps straight to this stage still sees it cabled - under
      // this stage's own panel. The plan list stays: a row still lights its
      // cable.
      const h = await enterPatched(ui, {
        counts: false,
        head: [
          title('Take it away'),
          lead('<strong>Where can it go from here?</strong>'),
          lead('The cast rack as built and cabled here, handed over in the formats a network team uses next.'),
          kv([
            ['draw.io', 'rack diagram, front and rear, with the seated cards and optics and a connection point on every port'],
            ['GLB / USDZ', !is3d ? 'the 3D model with its cables - switch to 3D to build the scene they export'
                                 : 'the mounted, cabled rack as a 3D model'],
            ['SVG', 'the face shown, with its cards, optics and cables'],
            ['PNG', 'a raster of that same face'],
            ['DCIM', 'NetBox and Nautobot device-type YAMLs for each cast device, linked below'],
          ]),
        ],
        extraPanel: () => [lead('<strong>DCIM device types</strong>'), dcimSection(exportsIndex)],
      });
      if (!ui.live()) { h?.dispose(); return; }
      handle = h;

      const items = [
        {label: 'draw.io',
         title: 'Download a draw.io rack diagram - front and rear, as built, with a connection point on every port',
         run: buildDrawio},
        {label: 'SVG', title: 'Download the face shown as an SVG, with its cards, optics and cables',
         run: buildSvg},
        {label: 'PNG', title: 'Download a PNG raster of the face shown, with its cables',
         run: buildPng},
      ];
      if (!is3d) {
        items.push({label: '3D formats (GLB, USDZ) — switch to 3D',
          title: 'GLB and USDZ export the 3D scene, which 2D does not build - this switches to 3D',
          run: () => setMode('3d')});
      } else if (handle.scene) {
        const sc = handle.scene;
        // complete() first: optics and plugs are extruded by the deferred
        // relief pass, and an export taken before it lands has them flat.
        items.push({label: 'GLB', title: 'Download the mounted, cabled rack as a GLB',
          run: async () => { await sc.complete(); save(await sc.toGLB(), 'cast-rack.glb', 'model/gltf-binary'); }});
        items.push({label: 'USDZ', title: 'Download the mounted, cabled rack as a USDZ',
          run: async () => { await sc.complete(); save(await sc.toUSDZ(), 'cast-rack.usdz', 'model/vnd.usdz+zip'); }});
      }
      ui.setExports(items);
    },
    exit() {
      handle?.dispose(); handle = null;
      stage3d.hidden = true; stage3d.replaceChildren();
      // The 2D picture. #stageTabs is the rail's to empty (vacate), not this.
      stageRack.hidden = true; stageRack.replaceChildren();
    },
  };
}
```

`EXPORTS_BASE` stays for `dcimSection`. Use it in the fetch above instead of the literal if you prefer; they are the same string.

`enterPatched` calls `ui.strip()`. Stages 4 and 5 show the "Look closer" strip, and stage 6 did not. If the strip appears on stage 6 and it didn't before, follow the handoff's call and keep stage 4's behavior (the strip shows). Say which you saw in your report.

- [ ] **Step 7: Run the new checks, then the full suite**

Run: `python3 check-browser.py --only check_takeaway_cables_2d,check_takeaway_cables_3d,check_takeaway_drawio`
Expected: all three ok. `check_takeaway_drawio` is Task 4's check, and it must still pass.

Run: `python3 check-browser.py`
Expected: everything passes, including `the stage rail: 7 stages`. The stage 4 and 5 checks also exercise the `cableFace` extraction.

- [ ] **Step 8: Commit**

```bash
git add site/showcase/cables.js site/showcase/patch-view.js site/showcase/stages/06-takeaway.js check-browser.py
git commit -m "showcase: stage 6 shows the cabling, and its SVG, PNG and GLB carry it

The cable layer was marked as screen UI, so standalone() dropped every
cable from every export; the tags stay UI. Stage 6 is stage 4's cabled
rack (plan seats applied on entry) under its own panel, and exports a
freshly built, cabled elevation, so hover state and pan/zoom never reach
a file.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Explorer downloads the device as configured

**Files:**
- Modify: `explorer.html`:
  - the Export menu markup, lines 152-161;
  - the imports, lines 169-173;
  - `writeLocation`, lines 720-739;
  - a new handler next to `writeLocation`.
- Modify: `check-browser.py`, to add `check_explorer_configured_download`.

**Interfaces:**
- Consumes: `configuredFace` (Task 1); `rasterize(url, scale)` from `site/raster.js`; `swapsNow` and `fieldsNow` from `site/optics.js`, which are already imported.
- Produces:
  - menu items `a[data-export="svg"]` and `a[data-export="png"]`, which download `<device>.<cfg>.<view>.configured.svg|png`;
  - `a[data-carry-device]` links (DCIM export, Drawings) whose `?device=` follows the current device.

- [ ] **Step 1: Write the failing check**

```python
@extra("Explorer downloads the device as configured, and its DCIM link names it")
def check_explorer_configured_download(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    page.goto(f"{base}/explorer.html?device=as7726-32x&config=ac-f2b&view=front"
              f"&swap=port-1~generic%2Fqsfp-lc%402", wait_until="load")
    page.wait_for_selector('#shell svg [data-ref^="generic/qsfp-lc@2"]', timeout=READY_MS)
    page.click("details.navmenu summary")
    with page.expect_download(timeout=READY_MS) as dl:
        page.click('a[data-export="svg"]')
    if dl.value.suggested_filename != "as7726-32x.ac-f2b.front.configured.svg":
        bad.append(f"explorer: download named {dl.value.suggested_filename!r}")
    if 'data-ref="generic/qsfp-lc@2' not in pathlib.Path(dl.value.path()).read_text():
        bad.append("explorer: configured SVG is missing the seated optic")
    href = page.get_attribute('a[href^="exporter.html"]', "href") or ""
    if "device=as7726-32x" not in href:
        bad.append(f"explorer: DCIM export link is {href!r}, expected ?device=as7726-32x")
    return bad
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `python3 check-browser.py --only check_explorer_configured_download`
Expected: FAIL with a timeout on `a[data-export="svg"]`, because the item doesn't exist yet.

- [ ] **Step 3: Add the menu items and mark the links that honor `?device=`**

Replace the `navmenu-items` block in `explorer.html` (lines 154-160) with:

```html
      <div class="navmenu-items">
        <a href="#" data-export="svg">This device as configured (SVG)<span class="hint">the current view, with its cards, optics and labels</span></a>
        <a href="#" data-export="png">This device as configured (PNG)<span class="hint">the same view as a 2× raster</span></a>
        <a href="exporter.html" data-carry-device>DCIM export<span class="hint">NetBox &amp; Nautobot device types</span></a>
        <a href="drawio.html">draw.io export<span class="hint">shape library and rack elevations</span></a>
        <a href="drawio.html#omnigraffle">OmniGraffle export<span class="hint">stencils with named ports</span></a>
        <a href="drawings.html" data-carry-device>Drawings<span class="hint">the compiled SVGs, as a zip</span></a>
      </div>
```

- [ ] **Step 4: Add the imports and the handler**

After the `./site/optics.js` import, add:

```js
import { configuredFace } from './site/rack/face.js';
import { rasterize } from './site/raster.js';
```

Directly after the `writeLocation` function, add:

```js
// THE DEVICE AS THE READER CONFIGURED IT, as a file. The same configuredFace
// the showcase and the Rack Builder export through, handed this page's swaps
// and fields, so the download is what is on the stage and not the base build.
function download(blob, name) {
  const a = Object.assign(document.createElement('a'),
                          {href: URL.createObjectURL(blob), download: name});
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function exportConfigured(kind) {
  if (!state.device || !state.meta) return;
  const face = await configuredFace({ref: state.device, cfg: state.cfg, view: state.view,
                                     swaps: swapsNow(shell), fields: fieldsNow(shell)});
  if (!face) return;
  const name = `${state.device}.${state.cfg}.${state.view}.configured`;
  const svgBlob = new Blob([face.text], {type: 'image/svg+xml'});
  if (kind === 'svg') return download(svgBlob, `${name}.svg`);
  const url = URL.createObjectURL(svgBlob);
  try {
    const bytes = await rasterize(url, 2);
    if (bytes) download(new Blob([bytes], {type: 'image/png'}), `${name}.png`);
  } finally {
    URL.revokeObjectURL(url);
  }
}

for (const a of document.querySelectorAll('a[data-export]')) {
  a.addEventListener('click', ev => {
    ev.preventDefault();
    a.closest('details')?.removeAttribute('open');
    exportConfigured(a.dataset.export).catch(err => console.warn('[portrayal] export', err));
  });
}
```

- [ ] **Step 5: Make the device-aware links follow the device**

At the end of `writeLocation()`, after the `if (search !== location.search) { … }` block, add:

```js
  // The pages that honor ?device= open on this one, not on their own default.
  for (const a of document.querySelectorAll('a[data-carry-device]'))
    a.search = `?device=${encodeURIComponent(state.device)}`;
```

- [ ] **Step 6: Run the check and the full suite**

Run: `python3 check-browser.py --only check_explorer_configured_download`
Expected: ok.

Run: `python3 check-browser.py`
Expected: everything passes, including `explorer embed mode`. In embed mode the site bar is hidden, so the new items never show.

Then serve the site, open Explorer, swap a card, choose **Export → This device as configured (PNG)**, and open the PNG to confirm the card is in it.

- [ ] **Step 7: Commit**

```bash
git add explorer.html check-browser.py
git commit -m "explorer: download the device as configured, SVG and PNG

Through configuredFace with the page's swaps and fields. The DCIM and
Drawings menu links now open on the current device.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Phase 0 wrap-up

**Files:**
- Modify: `docs/superpowers/specs/2026-09-26-rack-builder-design.md` (the status line).

- [ ] **Step 1: Run the contract check and the full browser suite, from a clean start**

Run: `python3 check-contract.py && python3 check-browser.py`
Expected: both exit 0. The browser summary lists the five new `ok` lines.

- [ ] **Step 2: Check each change by hand in the browser**

With `python3 serve.py 8932` running:
- Showcase stage 4 → Rear: the rear elevation still draws. Plugs on the rear of the FHD cassettes show where the plan seats them.
- Stage 6: in 2D, download draw.io, SVG and PNG. In 3D, download GLB.
  - Open the `.drawio` file: it has a front and a rear cabinet, and the ASR-9006's line card is drawn in slot 2.
  - Open the GLB in a viewer: the optics have depth, not flat textures.

- [ ] **Step 3: Mark the phase done in the spec and commit**

In the spec header, change `**Status:**` to:
`design approved; Phase 0 implemented (plan: docs/superpowers/plans/2026-09-26-rack-builder-phase0-configured-face.md)`

```bash
git add docs/superpowers/specs/2026-09-26-rack-builder-design.md
git commit -m "spec: Rack Builder Phase 0 is implemented

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

## Not in Phase 0 (so nobody adds it here)

- drawio.html's **stencil library** keeps separate card shapes (spec §4.3). Its rack elevations have no swap input, so a configured face with no swaps would be the base face anyway. There's nothing to change there.
- The draw.io edge converter, cable exports in the Rack Builder, and cable length: Phase 2. (The showcase's stage 6 cables in SVG, PNG and GLB moved into Phase 0 as Task 4b.)
- Moving `rack.js` / `cables.js` / `rails.js` into `site/rack/`, and the hole-style change: Phase 1.
