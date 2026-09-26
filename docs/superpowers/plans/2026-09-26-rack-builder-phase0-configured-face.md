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
| `site/showcase/stages/06-takeaway.js` | draw.io from configured front and rear faces; GLB/USDZ await `complete()`; panel copy |
| `explorer.html` | "As configured" SVG/PNG menu items; DCIM and Drawings links carry `?device=` |

---

### Task 1: `configuredFace()` and a fast way to run one check

**Files:**
- Create: `site/rack/face.js`
- Modify: `check-browser.py`:
  - add the registry, `run_extra`, and `check_configured_face` just above `def main():` (line 1140);
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
  - `build2dElevation` at lines 197-238.
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
Expected: FAIL with `psu-2 swap … not seated`. Today's elevation seats the front face only.

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

Delete everything from `const mine = ov?.[e.ref];` through the closing `}` of the `if (view === 'front' && mine …)` block, including its comment. Also update the comment block above `build2dElevation` so it says that devices are drawn through `configuredFace`, which seats bays, cages and rear holes on any view.

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
- Cables in any export, the draw.io edge converter, and cable length: Phase 2.
- Moving `rack.js` / `cables.js` / `rails.js` into `site/rack/`, and the hole-style change: Phase 1.
