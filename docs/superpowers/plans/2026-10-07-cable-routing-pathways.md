# Cable routing through pathways: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route Rack Builder cables through cable-manager rings, ducts and brush strips and up the lanes beside the rails. Routes are automatic until you edit them. Warn when a pathway is over-full, and turn each route into a stock length.

**Architecture:**
- A new pure module, `site/rack/route.js`, holds the rules: automatic route, resolving waypoints, geometry, length, fill. It knows nothing of the DOM or the site, so the later rack kit project can move it upstream as is.
- A site adapter, `site/rack/route-context.js`, reads guides and port positions out of the configured faces and hands them to `route.js` as plain numbers.
- Drawing extends `cables.js` (2D and 3D, three.js passed in) and `cable-view.js`.
- Editing is a new `route-panel.js` plus a picking mode on the page.

**Tech Stack:** Vanilla ES modules, no bundler; `node --test`; Python + Playwright `check-browser.py` and `check-contract.py`; three.js via `site/rack3d.js`.

**Spec:** `docs/superpowers/specs/2026-10-07-cable-routing-pathways-design.md`

## Global Constraints

- American English in prose, comments and UI text. The upstream repo is British; do not "fix" upstream text.
- No bundler, no npm, no new dependency. Modules import each other by relative path.
- **Kit-ready (spec D8):** `site/rack/route.js` imports only `./rails.js` and `./model.js`. It touches no DOM, `window`, `document` or `fetch`. 3D geometry functions take `THREE` as their first parameter.
- Lanes: `left-front`, `right-front`, `left-rear`, `right-rear`; two-post `left`, `right`. Sides are as seen from the FRONT of the rack.
- `LANE_GAP = 40` mm: a lane runs in the middle of a 40 mm gutter outside each rail.
- Fill limit 40% of an aperture's area. Typical diameters (mm): cat6 6.0, cat6a 7.5, os2/om3/om4/om5 3.0, dac 5.0, aoc 3.0, unset 6.0.
- Length: path + 0.15 m per end, rounded up to 0.5, 1, 1.5, 2, 3, 5, 7, 10, 15, 20, 30 m, then the next 5 m. Stored as `{value, unit: 'm', source: 'routed', measured}`. A length with source `entered` is never overwritten.
- Short jumper: no manager on either end, same pane, ends within 2U → empty route.
- Nothing is silently deleted: an unresolved waypoint stays stored and is skipped with a note.
- No rack-file version bump.
- Commit after every task, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Working sessions stop at an open PR. The **merge agent** lands on `main`. Never push with `--no-verify`.

## Review Focus

1. **A cable on a turned device or a rear-face device.** The exit side must be computed in rack coordinates, as seen from the front. A rear pane's left is the rack's right. Covered in Task 3.
2. **An edited route whose manager is removed.** The route stays stored, draws without that waypoint, and says so. Reset brings back the automatic route. Covered in Tasks 3 and 8.
3. **A typed length beside a routed one.** Typing a length must stop the routed upkeep for that cable. Clearing the field must let it resume. Covered in Tasks 4 and 5.
4. **Two-post frames.** Lanes are `left`/`right`; ends on opposite faces share one lane. Covered in Task 3.
5. **A rack with no managers at all.** Every cable gets lanes only, or no route for short jumpers, and nothing throws. Covered in Task 3.

---

## File map

| File | Change |
|---|---|
| `chassis-index.py` | index `guides`/`passes` from top, front, rear; also `-end` ring ends |
| `site/schema.js`, `schema.html`, `check-contract.py` | the `lab` schema tab (sync needs) |
| `site/rack/model.js` | `readCables`: route shapes, `routeEdited`, `routeAsWritten` |
| `site/rack/route.js` (new) | lanes, `autoRoute`, `resolveRoute`, `routeText`, geometry, `routedLength`, `stockLength`, `fill`, `withRoutedLengths` |
| `site/rack/route-context.js` (new) | `routeFacts(rack, chassisOf)` from configured faces |
| `site/rack/cables.js` | `routed2d`; `routePoints3d`; `drawCables2d`/`drawCables3d` read waypoints |
| `site/rack/cable-view.js` | waypoints per pane, lane offsets, fill outlines, pick targets |
| `site/rack/elevation.js` | `laneGap` option widens the gutters |
| `site/rack3d.js` | `deviceBoxes` skips sheet bodies; `metrics()` gains `railDepth` |
| `site/rack/scene3d.js` | waypoint positions for the 3D tubes |
| `site/rack/route-panel.js` (new) | the Route list in the cable form |
| `site/rack-page.js`, `site/rack/cable-panel.js` | facts upkeep, routed lengths, the Route list, picking mode |
| `site/rack/export-data.js`, `site/rack/exports.js` | schedule columns, BOM mark, DCIM comment, fill and draw.io notes |
| `tests/rack/route.test.mjs` (new), `model.test.mjs`, `export-cables.test.mjs`, `bom.test.mjs` | tests |
| `check-browser.py` | `check_rack_cable_routes` |

---

### Task 1: Sync Portrayal main (#852), index pathways, add the lab schema tab

**Files:**
- Modify: `chassis-index.py` (`marked`, and the views loop in `build()`)
- Modify: `site/schema.js` (`SOURCES`), `schema.html` (tabs and "Three documents:")
- Modify: `check-contract.py` (the rack-face block added in piece 1)
- Regenerated: `assets/**`, `vendor/**`, `site/rack/chassis.json`

**Interfaces:**
- Produces: `chassis.json` entries may carry:
  - `guides: {top?, front?, rear?: string[]}`, which are via ids (`guide-1`, `duct`);
  - `passes: {front?, rear?: string[]}`, which are via ids (`rear-brush`);
  - `capacity: {count, basis}`.
- For `fhd-cmp5dr`: `guides.top` includes `guide-1`…`guide-5`, and `guides.front` includes the same ids (from the `-end` ring ends).
- `cmh-4drb1u` and `cmh-sfd1u` are in the catalog.

- [ ] **Step 1: Check that nobody else is syncing.**

```bash
gh pr list -R roc-ops/portrayal-site --state open --json number,title,headRefName
```

If an open PR touches `assets/`, note it in the report and continue; the merge agent rebases.

- [ ] **Step 2: Update and build the upstream clone.** Never build from `/Volumes/External/Network-Device-Visualization`.

```bash
uptime
cd /Volumes/External/portrayal-upstream && git checkout main && git pull && ./build.sh
```

Expected: the build ends without error, and `library/dist/cmh-sfd1u.configs.json` exists.

- [ ] **Step 3: Write the failing contract checks.** In `check-contract.py`, in the rack-face block from piece 1 (search for `fhd-cmp5dr is in the catalog`), add after it:

```python
# PATHWAYS (docs/superpowers/specs/2026-10-07-cable-routing-pathways-design.md §3):
# the three FS managers, each with the ids a route can pass through. A ring's
# component is on the top view and its end on the front, so both are indexed.
_g = lambda n, v: (_cat.get(n, {}).get("guides") or {}).get(v, [])
check(all(n in _cat for n in ("fhd-cmp5dr", "cmh-4drb1u", "cmh-sfd1u")),
      "the FHD-CMP5DR, CMH-4DRB1U and CMH-SFD1U are in the catalog",
      "rebuild /Volumes/External/portrayal-upstream from main (#852) and run ./refresh-assets.sh")
check(set(_g("fhd-cmp5dr", "top")) >= {f"guide-{i}" for i in range(1, 6)}
      and set(_g("fhd-cmp5dr", "front")) >= {f"guide-{i}" for i in range(1, 6)},
      "fhd-cmp5dr's five rings are indexed on its top and front views",
      "run ./chassis-index.py")
check(bool(_g("cmh-sfd1u", "front")) and bool((_cat.get("cmh-4drb1u", {}).get("passes") or {})),
      "the duct of cmh-sfd1u and the brush pass of cmh-4drb1u are indexed",
      "run ./chassis-index.py")
check(_cat.get("fhd-cmp5dr", {}).get("capacity", {}).get("count") == 30,
      "fhd-cmp5dr carries its stated capacity, 30",
      "run ./chassis-index.py")
```

- [ ] **Step 4: Run it to see it fail.**

```bash
python3 check-contract.py 2>&1 | grep -E "CMH|rings are indexed|duct of|capacity"
```

Expected: FAIL lines.

- [ ] **Step 5: Index pathways from three views, with ring ends.** In `chassis-index.py`, replace `marked()`:

```python
def marked(path):
    """The ids a route can pass through on one compiled face, as the route
    names them (docs/superpowers/specs/2026-10-07-cable-routing-pathways-design.md §4):
    a ring component carrying `data-guide` is its own id (`guide-1`); a ring's
    end on a front or rear view, `<id>-end` with `data-kind="ring"`, stands for
    the same ring; a duct rect `guide--<id>` is `<id>`; a pass-through
    `pass--<id>` is `<id>`."""
    if not path.is_file():
        return [], []
    root = ET.parse(path).getroot()
    guides, passes = set(), set()
    for e in root.iter():
        i = e.get("id") or ""
        if not i:
            continue
        if e.get("data-class") == "pass" and i.startswith("pass--"):
            passes.add(i[len("pass--"):])
        elif e.get("data-class") == "guide" and i.startswith("guide--"):
            guides.add(i[len("guide--"):])
        elif e.get("data-kind") == "ring" and i.endswith("-end"):
            guides.add(i[:-len("-end")])
        elif e.get("data-guide"):
            guides.add(i)
    return sorted(guides), sorted(passes)
```

and change the views loop to `for view in ("top", "front", "rear"):`.

- [ ] **Step 6: Refresh, re-index and inspect.**

```bash
./refresh-assets.sh && ./chassis-index.py
python3 -c "import json;d=json.load(open('site/rack/chassis.json'))['devices'];[print(n, {k: d[n].get(k) for k in ('mount','ru','guides','passes','capacity')}) for n in ('fhd-cmp5dr','cmh-4drb1u','cmh-sfd1u')]"
grep -o 'id="pass--[^"]*"\|id="guide--[^"]*"\|data-guide-aperture="[^"]*"' assets/dist/cmh-*.base.*.svg assets/dist/fhd-cmp5dr.base.top.svg | sort -u | head -30
```

Record the output in the report. Task 5 relies on these ids and aperture attributes.

- [ ] **Step 7: The lab schema tab (sync needs).** `refresh-assets.sh` now copies `assets/schemas/lab.schema.json`.
  - In `site/schema.js` `SOURCES`, add after `listing`:

```js
  // A LAB: placements in a rack, rack-face parts on a host (Portrayal #852, lab.schema.json).
  lab:       {url: 'assets/schemas/lab.schema.json',       label: 'a lab of devices placed in a rack'},
```

  - In `schema.html`, add after the listing tab:

```html
          <button role="tab" data-schema="lab" aria-selected="false">Lab</button>
```

  - Change "Three documents:" to "Four documents:".
  - If the listing tab or another tab carries `hidden` for a schema that is absent, match that pattern. Read how `present` in `site/schema.js` decides.

- [ ] **Step 8: Run every check.**

```bash
python3 check-contract.py && node --test tests/*/*.test.mjs
uptime
python3 check-browser.py --only check_schema_coverage
```

Expected: PASS. A failure in an area this task did not touch is a sync problem: report it, don't patch around it.

- [ ] **Step 9: Commit.**

```bash
git add chassis-index.py check-contract.py site/schema.js schema.html site/rack/chassis.json assets vendor
git commit -m "sync: Portrayal main with #852 - the CMH managers, guides and passes indexed, the lab schema tab

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Cables keep routes, edits and routed lengths

**Files:**
- Modify: `site/rack/model.js` (`readCables`)
- Test: `tests/rack/model.test.mjs`

**Interfaces:**
- Produces: `readCables` output per cable:
  - `route`: only `{item: string, via: string}` or `{lane: string, ru: integer}` entries, kept in order;
  - `routeAsWritten`: present only when some entries were not one of those shapes, holding the original array;
  - `routeEdited: true` only when the input had `routeEdited === true`;
  - a `length` with source `routed` keeps `measured`.

- [ ] **Step 1: Write the failing tests.** Append to `tests/rack/model.test.mjs`:

```js
test('a cable keeps its edited route; a malformed waypoint is kept aside, not dropped', () => {
  const [c] = M.readCables([{id: 'c1', a: {item: 'i1', path: 'p'}, b: {item: 'i2', path: 'q'}, routeEdited: true,
    route: [{item: 'i3', via: 'guide-2'}, {lane: 'left-front', ru: 12}, {lane: 'left-front'}, 'x']}]);
  assert.deepEqual(c.route, [{item: 'i3', via: 'guide-2'}, {lane: 'left-front', ru: 12}]);
  assert.deepEqual(c.routeAsWritten, [{item: 'i3', via: 'guide-2'}, {lane: 'left-front', ru: 12}, {lane: 'left-front'}, 'x']);
  assert.equal(c.routeEdited, true);
});

test('routeEdited is only ever true; an automatic cable has none', () => {
  const [c] = M.readCables([{id: 'c1', a: {}, b: {}, routeEdited: 'yes', route: []}]);
  assert.equal('routeEdited' in c, false);
  assert.equal('routeAsWritten' in c, false);
});

test('a routed length keeps its measurement', () => {
  const [c] = M.readCables([{id: 'c1', a: {}, b: {}, length: {value: 2, unit: 'm', source: 'routed', measured: 1.62}}]);
  assert.deepEqual(c.length, {value: 2, unit: 'm', source: 'routed', measured: 1.62});
});
```

- [ ] **Step 2: Run them to see them fail.**

```bash
node --test tests/rack/model.test.mjs
```

Expected: the first two FAIL. The third may already pass (`{...len}` keeps `measured`); keep it as a guard.

- [ ] **Step 3: Implement.** In `site/rack/model.js`, above `readCables`, add:

```js
// A ROUTE (docs/superpowers/specs/2026-10-07-cable-routing-pathways-design.md §4)
// is waypoints in order: {item, via}, an element of a placed device's drawing,
// or {lane, ru}, a lane beside the rails at a U. An entry of neither shape is
// not thrown away: the whole route as written moves to `routeAsWritten`, as a
// length this page cannot use moves to `lengthAsWritten`.
const isWaypoint = w => w && typeof w === 'object' && !Array.isArray(w) && (
  (typeof w.item === 'string' && w.item && typeof w.via === 'string' && w.via) ||
  (typeof w.lane === 'string' && w.lane && Number.isInteger(w.ru)));
const readRoute = r => {
  const list = Array.isArray(r) ? r : [];
  const kept = list.filter(isWaypoint).map(w => ('lane' in w ? {lane: w.lane, ru: w.ru} : {item: w.item, via: w.via}));
  return kept.length === list.length ? {route: kept} : {route: kept, routeAsWritten: structuredClone(list)};
};
```

In `readCables`, replace `route: Array.isArray(c.route) ? c.route : []` with the spread below, and keep only a true `routeEdited`:

```js
              ...readRoute(c.route), ...(c.routeEdited === true ? {routeEdited: true} : {})});
```

Because `...c` comes first in that object literal, delete `c.routeEdited` and `c.routeAsWritten` from `c` before the push. Then a non-true value or a stale `routeAsWritten` does not survive through the spread:

```js
    delete c.routeEdited; delete c.routeAsWritten;
```

- [ ] **Step 4: Run the tests.**

```bash
node --test tests/*/*.test.mjs
```

Expected: PASS. Older tests that assert `route: []` still pass.

- [ ] **Step 5: Commit.**

```bash
git add site/rack/model.js tests/rack/model.test.mjs
git commit -m "rack: a cable keeps its edited route, and a waypoint it cannot read is kept aside

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The automatic route, and resolving a route

**Files:**
- Create: `site/rack/route.js`
- Test: create `tests/rack/route.test.mjs`

**Interfaces:**
- Consumes: `attachPoints` is in `fit.js`, which imports `export-data.js`. To stay kit-ready, `route.js` does not import `fit.js`. It defines its own `lanesOf(frame)`.
- Produces (all pure). A **ctx** is `{chassisOf, guidesOf(itemId) -> [{via, kind: 'ring'|'duct'|'pass', face: 'front'|'rear', x}], portX(end) -> number|null}`. `x` values are rack coordinates: mm from the rack's center line, positive to the right as seen from the FRONT.
  - `LANE_GAP = 40`;
  - `lanesOf(frame) -> string[]`;
  - `endPane(rack, end) -> 'front'|'rear'|null`;
  - `autoRoute(rack, cable, ctx) -> waypoint[]`;
  - `resolveRoute(rack, cable, ctx) -> {waypoints: waypoint[], gone: waypoint[], auto: boolean}`;
  - `routeText(route) -> string`.

- [ ] **Step 1: Write the failing tests.** Create `tests/rack/route.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../../site/rack/model.js';
import * as R from '../../site/rack/route.js';

const SIZES = {'sw': {ru: 1, d: 515}, 'pp': {ru: 1, d: 100},
  'fhd-cmp5dr': {ru: 1, d: 110, mount: 'rack-face', shell: 'sheet'},
  'cmh-sfd1u': {ru: 1, d: 80}};
const chassisOf = ref => SIZES[ref] || null;
const add = (rack, ref, ru, extra = {}) => M.withItem(rack, {ref, cfg: 'x', ru, label: extra.label ?? ref, ...extra}).rack;
// Rings of an FHD-CMP5DR, x in rack coordinates (as its front view places them).
const RINGS = [-205, -110, 0, 110, 205].map((x, i) => ({via: `guide-${i + 1}`, kind: 'ring', face: 'front', x}));
const ctxFor = (rack, ports, extra = {}) => ({chassisOf,
  guidesOf: id => {
    const it = rack.items.find(i => i.id === id);
    if (it?.ref === 'fhd-cmp5dr') return RINGS.map(r => ({...r, face: it.face}));
    if (it?.ref === 'cmh-sfd1u') return [{via: 'duct', kind: 'duct', face: it.face, x: 0}];
    return extra[id] ?? [];
  },
  portX: end => ports[`${end.item}|${end.path}`] ?? 0});
const cable = (a, b, extra = {}) => ({id: 'c1', a: {view: 'front', ...a}, b: {view: 'front', ...b}, route: [], ...extra});

test('a port left of center leaves through the nearest ring, then every ring out to the left', () => {
  let r = add(M.newRack(), 'sw', 20, {label: 'sw'});
  r = add(r, 'fhd-cmp5dr', 20, {on: 'i1', unit: 1});
  r = add(r, 'pp', 30);
  const ctx = ctxFor(r, {'i1|p1': -100, 'i3|q1': -150});
  assert.deepEqual(R.autoRoute(r, cable({item: 'i1', path: 'p1'}, {item: 'i3', path: 'q1'}), ctx), [
    {item: 'i2', via: 'guide-2'}, {item: 'i2', via: 'guide-1'},
    {lane: 'left-front', ru: 20}, {lane: 'left-front', ru: 30}]);
});

test('a port right of center goes right; a port at the center goes left', () => {
  let r = add(M.newRack(), 'sw', 20);
  r = add(r, 'fhd-cmp5dr', 20, {on: 'i1', unit: 1});
  r = add(r, 'pp', 30);
  const right = R.autoRoute(r, cable({item: 'i1', path: 'p'}, {item: 'i3', path: 'q'}), ctxFor(r, {'i1|p': 120, 'i3|q': 120}));
  assert.deepEqual(right.slice(0, 2), [{item: 'i2', via: 'guide-4'}, {item: 'i2', via: 'guide-5'}]);
  assert.equal(right[2].lane, 'right-front');
  const mid = R.autoRoute(r, cable({item: 'i1', path: 'p'}, {item: 'i3', path: 'q'}), ctxFor(r, {'i1|p': 0, 'i3|q': 0}));
  assert.deepEqual(mid[0], {item: 'i2', via: 'guide-3'});
  assert.equal(mid.find(w => w.lane).lane, 'left-front');
});

test('a 1U duct directly above is the manager when the device has none', () => {
  let r = add(M.newRack(), 'sw', 20);
  r = add(r, 'cmh-sfd1u', 21);
  r = add(r, 'pp', 30);
  const route = R.autoRoute(r, cable({item: 'i1', path: 'p'}, {item: 'i3', path: 'q'}), ctxFor(r, {'i1|p': -50, 'i3|q': -50}));
  assert.deepEqual(route[0], {item: 'i2', via: 'duct'});
});

test('a short jumper with no manager has no route', () => {
  let r = add(M.newRack(), 'sw', 20);
  r = add(r, 'pp', 22);
  assert.deepEqual(R.autoRoute(r, cable({item: 'i1', path: 'p'}, {item: 'i2', path: 'q'}), ctxFor(r, {})), []);
});

test('a rack with no managers: lanes only, and nothing throws', () => {
  let r = add(M.newRack(), 'sw', 5);
  r = add(r, 'pp', 30);
  assert.deepEqual(R.autoRoute(r, cable({item: 'i1', path: 'p'}, {item: 'i2', path: 'q'}), ctxFor(r, {'i1|p': 10, 'i2|q': -10})),
    [{lane: 'right-front', ru: 5}, {lane: 'right-front', ru: 30}]);
});

test('the same face, different sides: the A side is taken, and B crosses its own rings to it', () => {
  let r = add(M.newRack(), 'sw', 20);
  r = add(r, 'fhd-cmp5dr', 20, {on: 'i1', unit: 1});
  r = add(r, 'pp', 30);
  r = add(r, 'fhd-cmp5dr', 30, {on: 'i3', unit: 1});
  const route = R.autoRoute(r, cable({item: 'i1', path: 'p'}, {item: 'i3', path: 'q'}), ctxFor(r, {'i1|p': -100, 'i3|q': 150}));
  assert.equal(route.filter(w => w.lane).every(w => w.lane === 'left-front'), true);
  // B's rings, in the order the cable meets them from the lane: outermost left first, to the one nearest its port.
  assert.deepEqual(route.slice(-4), [{item: 'i4', via: 'guide-1'}, {item: 'i4', via: 'guide-2'}, {item: 'i4', via: 'guide-3'}, {item: 'i4', via: 'guide-4'}]);
});

test('opposite faces: front lane to rear lane on the A side, joined at the higher U', () => {
  let r = add(M.newRack(), 'sw', 20);
  r = add(r, 'pp', 30, {face: 'rear'});
  const route = R.autoRoute(r, cable({item: 'i1', path: 'p'}, {item: 'i2', path: 'q'}), ctxFor(r, {'i1|p': -100, 'i2|q': 100}));
  assert.deepEqual(route, [{lane: 'left-front', ru: 20}, {lane: 'left-front', ru: 30}, {lane: 'left-rear', ru: 30}]);
});

test('a rear-face end measures its side as seen from the front', () => {
  let r = add(M.newRack(), 'sw', 20, {face: 'rear'});
  r = add(r, 'pp', 30, {face: 'rear'});
  // x is already rack coordinates (front view): -100 is the rack's left.
  const route = R.autoRoute(r, cable({item: 'i1', path: 'p'}, {item: 'i2', path: 'q'}), ctxFor(r, {'i1|p': -100, 'i2|q': -100}));
  assert.equal(route[0].lane, 'left-rear');
});

test('two-post: lanes are left and right, and opposite faces share one', () => {
  let r = add(M.newRack({kind: 'two-post'}), 'sw', 20);
  r = add(r, 'pp', 30, {face: 'rear'});
  assert.deepEqual(R.lanesOf(r.frame), ['left', 'right']);
  const route = R.autoRoute(r, cable({item: 'i1', path: 'p'}, {item: 'i2', path: 'q'}), ctxFor(r, {'i1|p': -100}));
  assert.deepEqual(route, [{lane: 'left', ru: 20}, {lane: 'left', ru: 30}]);
});

test('resolveRoute: edited routes are kept; a gone waypoint is reported, not dropped', () => {
  let r = add(M.newRack(), 'sw', 20);
  r = add(r, 'pp', 30);
  const c = cable({item: 'i1', path: 'p'}, {item: 'i2', path: 'q'},
    {routeEdited: true, route: [{item: 'i9', via: 'guide-1'}, {lane: 'left-front', ru: 25}, {lane: 'nowhere', ru: 3}]});
  const got = R.resolveRoute(r, c, ctxFor(r, {}));
  assert.deepEqual(got, {waypoints: [{lane: 'left-front', ru: 25}],
    gone: [{item: 'i9', via: 'guide-1'}, {lane: 'nowhere', ru: 3}], auto: false});
  const auto = R.resolveRoute(r, {...c, routeEdited: undefined}, ctxFor(r, {}));
  assert.equal(auto.auto, true);
});

test('routeText reads as the schedule prints it', () => {
  assert.equal(R.routeText([{item: 'i2', via: 'guide-3'}, {item: 'i2', via: 'guide-1'}, {lane: 'left-front', ru: 12},
    {lane: 'left-front', ru: 24}, {item: 'i5', via: 'duct'}], id => ({i2: 'mgr-1', i5: 'pp-duct'}[id] ?? id)),
    'mgr-1 ring 3 > mgr-1 ring 1 > left-front U12-U24 > pp-duct duct');
});
```

- [ ] **Step 2: Run them to see them fail.**

```bash
node --test tests/rack/route.test.mjs
```

Expected: FAIL, `Cannot find module`.

- [ ] **Step 3: Implement `site/rack/route.js`** (the routing half; Task 4 adds geometry and fill):

```js
// CABLE ROUTES (docs/superpowers/specs/2026-10-07-cable-routing-pathways-design.md).
// Pure: the rack, a cable, and a ctx the page fills from the drawings -
//   ctx.chassisOf(ref), ctx.guidesOf(itemId) -> [{via, kind, face, x}],
//   ctx.portX(end) -> x or null,
// with every x in RACK coordinates: mm from the rack's center line, positive
// to the right as seen from the FRONT. This file imports no DOM and nothing of
// the site's pages, so the rack kit can take it as it is.

import {uLabel} from './model.js';

export const LANE_GAP = 40;          // mm: a lane runs in the middle of a 40 mm gutter outside each rail
const SHORT = 2;                     // U: a jumper this close, with no manager, just hangs

export const lanesOf = frame => (frame.kind === 'two-post'
  ? ['left', 'right'] : ['left-front', 'right-front', 'left-rear', 'right-rear']);
const laneFor = (frame, side, pane) => (frame.kind === 'two-post' ? side : `${side}-${pane}`);
const itemOf = (rack, id) => rack.items.find(i => i.id === id) || null;

// Which face an end's port is seen from: its item's face, or the other one
// for the panel that faces away (a turned item swaps the two).
export function endPane(rack, end) {
  const it = itemOf(rack, end.item);
  if (!it) return null;
  const outward = (end.view === 'rear') === !!it.turned;
  return outward ? it.face : (it.face === 'front' ? 'rear' : 'front');
}

const unitsOf = (ctx, it) => Math.max(1, ctx.chassisOf(it.ref)?.ru ?? 1);
const spans = (ctx, it, u) => u >= it.ru && u <= it.ru + unitsOf(ctx, it) - 1;

// The manager an end leaves through: one hosted on its item on that face, else
// a 1U device just above or below it on that face that declares a guide or a
// pass. null when there is neither.
function managerOf(rack, it, pane, ctx) {
  const hosted = rack.items.find(m => m.on === it.id && m.face === pane
                                     && ctx.guidesOf(m.id).some(g => g.face === pane));
  if (hosted) return hosted;
  const above = it.ru + unitsOf(ctx, it), below = it.ru - 1;
  return rack.items.find(o => o.id !== it.id && o.face === pane && !o.on && unitsOf(ctx, o) === 1
    && (spans(ctx, o, above) || spans(ctx, o, below))
    && ctx.guidesOf(o.id).some(g => g.face === pane)) || null;
}

// The waypoints through one end's manager, from the port out to `side`.
function through(m, pane, portX, side, crossing, ctx) {
  if (!m) return [];
  const gs = ctx.guidesOf(m.id).filter(g => g.face === pane);
  const rings = gs.filter(g => g.kind === 'ring');
  if (rings.length) {
    const near = rings.reduce((a, b) => (Math.abs(b.x - portX) < Math.abs(a.x - portX) ? b : a));
    const out = rings.filter(g => (side === 'left' ? g.x <= near.x : g.x >= near.x))
      .sort((a, b) => (side === 'left' ? b.x - a.x : a.x - b.x));
    return out.map(g => ({item: m.id, via: g.via}));
  }
  const duct = gs.find(g => g.kind === 'duct');
  if (duct) return [{item: m.id, via: duct.via}];
  const pass = crossing && gs.find(g => g.kind === 'pass');
  return pass ? [{item: m.id, via: pass.via}] : [];
}

const sameWp = (a, b) => (a.lane ? a.lane === b.lane && a.ru === b.ru : a.item === b.item && a.via === b.via);
const dedupe = list => list.filter((w, i) => i === 0 || !sameWp(w, list[i - 1]));

export function autoRoute(rack, cable, ctx) {
  const ends = [cable.a, cable.b].map(e => {
    const it = itemOf(rack, e.item), pane = it && endPane(rack, e);
    return it && pane ? {e, it, pane, x: ctx.portX(e) ?? 0} : null;
  });
  if (ends.some(x => !x)) return [];
  const [A, B] = ends;
  const mA = managerOf(rack, A.it, A.pane, ctx), mB = managerOf(rack, B.it, B.pane, ctx);
  if (!mA && !mB && A.pane === B.pane && Math.abs(A.it.ru - B.it.ru) <= SHORT) return [];
  const side = A.x <= 0 ? 'left' : 'right';
  const crossing = A.pane !== B.pane;
  const f = rack.frame;
  const laneA = laneFor(f, side, A.pane), laneB = laneFor(f, side, B.pane);
  const lanes = laneA === laneB
    ? [{lane: laneA, ru: A.it.ru}, {lane: laneA, ru: B.it.ru}]
    : (() => { const top = Math.max(A.it.ru, B.it.ru);
        return [{lane: laneA, ru: A.it.ru}, {lane: laneA, ru: top}, {lane: laneB, ru: top}, {lane: laneB, ru: B.it.ru}]; })();
  const outA = through(mA, A.pane, A.x, side, crossing, ctx);
  const outB = through(mB, B.pane, B.x, side, crossing, ctx).reverse();
  return dedupe([...outA, ...lanes, ...outB]);
}

// Does a waypoint still stand for something in this rack?
function resolves(rack, w, ctx) {
  if (w.lane) return lanesOf(rack.frame).includes(w.lane) && w.ru >= 1 && w.ru <= rack.frame.heightRU;
  return !!itemOf(rack, w.item) && ctx.guidesOf(w.item).some(g => g.via === w.via);
}

// THE ROUTE A CABLE FOLLOWS: the stored one once edited, else the automatic
// one. A stored waypoint that no longer resolves is skipped, and reported.
export function resolveRoute(rack, cable, ctx) {
  const auto = cable.routeEdited !== true;
  const list = auto ? autoRoute(rack, cable, ctx) : (cable.route || []);
  const waypoints = [], gone = [];
  for (const w of list) (resolves(rack, w, ctx) ? waypoints : gone).push(w);
  return {waypoints, gone, auto};
}

// The route as a line of text: "mgr-1 ring 3 > left-front U12-U24 > ...".
// Consecutive points on one lane read as one run. `nameOf(itemId)` names an item.
// U's are as stored; pass `frame` to label them the way the rack counts.
export function routeText(route, nameOf = id => id, frame = null) {
  const u = n => (frame ? uLabel(frame, n) : n);
  const viaText = v => (/^guide-(\d+)$/.test(v) ? `ring ${v.slice(6)}` : v);
  const out = [];
  for (const w of route) {
    const last = out[out.length - 1];
    if (w.lane && last?.lane === w.lane) { last.to = w.ru; continue; }
    out.push(w.lane ? {lane: w.lane, from: w.ru, to: w.ru} : {text: `${nameOf(w.item)} ${viaText(w.via)}`});
  }
  return out.map(p => (p.lane ? `${p.lane} U${u(p.from)}${p.to !== p.from ? `-U${u(p.to)}` : ''}` : p.text)).join(' > ');
}
```

- [ ] **Step 4: Run the tests.**

```bash
node --test tests/rack/route.test.mjs && node --test tests/*/*.test.mjs
```

Expected: PASS. If a test disagrees with the rules, check it against the spec §5 rule it names before changing either. Report any change.

- [ ] **Step 5: Commit.**

```bash
git add site/rack/route.js tests/rack/route.test.mjs
git commit -m "rack: a cable's automatic route through its managers and the lanes, and a route resolved

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Geometry, routed length and fill

**Files:**
- Modify: `site/rack/route.js` (append)
- Test: `tests/rack/route.test.mjs` (append)

**Interfaces:**
- Consumes: Task 3's `resolveRoute`, `endPane`, `LANE_GAP`, and ctx.
- ctx gains `guidesOf` entries with `aperture: {w, h} | null` (mm), plus `portY(end) -> number|null`, the port's height above the rack floor in mm (null means the middle of its item's lowest U).
- Produces:
  - `DIAMETERS`; `FILL_LIMIT = 0.4`; `STOCK_M`; `END_ALLOWANCE_M = 0.15`;
  - `pointOf(rack, w, ctx) -> {x, y, z}` (mm; y up from the floor, z 0 at the front rail plane, negative toward the rear);
  - `portPoint(rack, end, ctx) -> {x, y, z} | null`;
  - `routedLength(rack, cable, ctx) -> {measured: number, value: number} | null` (meters);
  - `stockLength(m) -> number`;
  - `fill(rack, ctx) -> [{item, via, count, percent, over, cables: string[]}]` (pathways with an aperture, at least one cable);
  - `capacityOver(rack, ctx) -> [{item, count, capacity}]`;
  - `withRoutedLengths(rack, ctx) -> rack` (the same object when nothing changed).

- [ ] **Step 1: Write the failing tests.** Append to `tests/rack/route.test.mjs`:

```js
import {RU, OPENING, RAIL_W} from '../../site/rack/rails.js';

test('stock lengths round up, then by 5 m past 30', () => {
  assert.deepEqual([0.2, 0.5, 0.51, 1.62, 2.01, 9.9, 29.1, 30.2, 41].map(R.stockLength),
    [0.5, 0.5, 1, 2, 3, 10, 30, 35, 45]);
});

test('a lane point sits in its gutter at the U middle, on its face\'s rail plane', () => {
  const r = M.newRack();
  const p = R.pointOf(r, {lane: 'left-rear', ru: 10}, ctxFor(r, {}));
  assert.deepEqual(p, {x: -(OPENING / 2 + RAIL_W + R.LANE_GAP / 2), y: 9.5 * RU, z: -r.frame.railDepth});
});

test('a routed length measures the path, adds 0.15 m an end, and rounds to stock', () => {
  let r = add(M.newRack(), 'sw', 1);
  r = add(r, 'pp', 21);
  const ctx = {...ctxFor(r, {'i1|p': -100, 'i2|q': -100}), portY: () => null};
  const got = R.routedLength(r, cable({item: 'i1', path: 'p'}, {item: 'i2', path: 'q'}), ctx);
  // port -> left lane (|dx| = lane x - 100) at U1, up 20U, back to the port at U21.
  const dx = OPENING / 2 + RAIL_W + R.LANE_GAP / 2 - 100;
  const mm = 2 * dx + 20 * RU;
  assert.ok(Math.abs(got.measured - (mm / 1000 + 0.3)) < 1e-9, `measured ${got.measured}`);
  assert.equal(got.value, R.stockLength(got.measured));
});

test('fill: Cat6 through one ring, against 40% of its opening', () => {
  let r = add(M.newRack(), 'sw', 20);
  r = add(r, 'fhd-cmp5dr', 20, {on: 'i1', unit: 1});
  r = add(r, 'pp', 30);
  const ctx = ctxFor(r, {'i1|p': -205, 'i3|q': -205});
  const g0 = ctx.guidesOf;
  ctx.guidesOf = id => g0(id).map(g => ({...g, aperture: {w: 32, h: 29.5}}));
  r = {...r, cables: Array.from({length: 14}, (_, k) => ({id: `c${k}`, media: 'cat6', route: [],
    a: {item: 'i1', path: 'p', view: 'front'}, b: {item: 'i3', path: 'q', view: 'front'}}))};
  const f = R.fill(r, ctx).find(x => x.via === 'guide-1');
  const pct = Math.round(14 * Math.PI * 9 / (0.4 * 32 * 29.5) * 100);
  assert.deepEqual([f.count, f.percent, f.over], [14, pct, true]);
});

test('capacity: a manager over its stated count', () => {
  SIZES['fhd-cmp5dr'].capacity = {count: 2, basis: 'test'};
  let r = add(M.newRack(), 'sw', 20);
  r = add(r, 'fhd-cmp5dr', 20, {on: 'i1', unit: 1});
  r = add(r, 'pp', 30);
  r = {...r, cables: [0, 1, 2].map(k => ({id: `c${k}`, media: 'cat6', route: [],
    a: {item: 'i1', path: 'p', view: 'front'}, b: {item: 'i3', path: 'q', view: 'front'}}))};
  assert.deepEqual(R.capacityOver(r, ctxFor(r, {'i1|p': -100})), [{item: 'i2', count: 3, capacity: 2}]);
  delete SIZES['fhd-cmp5dr'].capacity;
});

test('withRoutedLengths fills unset lengths, updates routed ones, and never touches an entered one', () => {
  let r = add(M.newRack(), 'sw', 1);
  r = add(r, 'pp', 21);
  const base = {a: {item: 'i1', path: 'p', view: 'front'}, b: {item: 'i2', path: 'q', view: 'front'}, route: []};
  r = {...r, cables: [{id: 'c1', ...base}, {id: 'c2', ...base, length: {value: 7, unit: 'ft', source: 'entered'}},
                      {id: 'c3', ...base, length: {value: 9, unit: 'm', source: 'routed', measured: 8.7}}]};
  const ctx = {...ctxFor(r, {'i1|p': -100, 'i2|q': -100}), portY: () => null};
  const out = R.withRoutedLengths(r, ctx);
  assert.equal(out.cables[0].length.source, 'routed');
  assert.deepEqual(out.cables[1].length, {value: 7, unit: 'ft', source: 'entered'});
  assert.equal(out.cables[2].length.value, out.cables[0].length.value);
  assert.equal(R.withRoutedLengths(out, ctx), out);
});
```

- [ ] **Step 2: Run them to see them fail.**

```bash
node --test tests/rack/route.test.mjs
```

Expected: the new tests FAIL (`stockLength is not a function`, ...).

- [ ] **Step 3: Implement.** Append to `site/rack/route.js`, and add `import {RU, OPENING, RAIL_W} from './rails.js';` at the top:

```js
// ── geometry, in rack coordinates (mm) ────────────────────────────────────
// x from the center line, right as seen from the front; y up from the floor of
// U1; z 0 on the front rail plane, negative toward the rear. The page's 2D and
// 3D draw from their own drawings; this is the rack's own measure, so the
// length is the same whatever is on screen.
const railDepthOf = f => (f.kind === 'two-post' ? 0 : f.railDepth);
const laneX = side => (side === 'left' ? -1 : 1) * (OPENING / 2 + RAIL_W + LANE_GAP / 2);
const planeZ = (f, pane) => (pane === 'rear' ? -railDepthOf(f) : 0);

export function pointOf(rack, w, ctx) {
  const f = rack.frame;
  if (w.lane) {
    const [side, pane = 'front'] = w.lane.split('-');
    return {x: laneX(side), y: (w.ru - 0.5) * RU, z: planeZ(f, pane)};
  }
  const it = itemOf(rack, w.item), g = it && ctx.guidesOf(it.id).find(x => x.via === w.via);
  if (!g) return null;
  // A rack-face part stands out from its rail plane by half its depth; a rack
  // device's guide is on its face, at the rail plane.
  const c = ctx.chassisOf(it.ref) || {};
  const out = c.mount === 'rack-face' ? (c.d ?? 0) / 2 : 0;
  const z = g.face === 'rear' ? planeZ(f, 'rear') - out : planeZ(f, 'front') + out;
  return {x: g.x, y: (it.ru - 0.5) * RU, z};
}

export function portPoint(rack, end, ctx) {
  const it = itemOf(rack, end.item), pane = it && endPane(rack, end);
  if (!pane) return null;
  const f = rack.frame, d = ctx.chassisOf(it.ref)?.d ?? 0;
  // On its own face a panel is at that rail; the far panel is the chassis depth away.
  const z = pane === it.face ? planeZ(f, pane) : (it.face === 'front' ? -d : -railDepthOf(f) + d);
  return {x: ctx.portX(end) ?? 0, y: ctx.portY?.(end) ?? (it.ru - 0.5) * RU, z};
}

const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);

export const STOCK_M = [0.5, 1, 1.5, 2, 3, 5, 7, 10, 15, 20, 30];
export const END_ALLOWANCE_M = 0.15;
export const stockLength = m => STOCK_M.find(s => s >= m - 1e-9) ?? Math.ceil(m / 5) * 5;

export function routedLength(rack, cable, ctx) {
  const a = portPoint(rack, cable.a, ctx), b = portPoint(rack, cable.b, ctx);
  if (!a || !b) return null;
  const mids = resolveRoute(rack, cable, ctx).waypoints.map(w => pointOf(rack, w, ctx)).filter(Boolean);
  const pts = [a, ...mids, b];
  let mm = 0;
  for (let k = 1; k < pts.length; k++) mm += dist(pts[k - 1], pts[k]);
  const measured = mm / 1000 + 2 * END_ALLOWANCE_M;
  return {measured, value: stockLength(measured)};
}

// ── fill ──────────────────────────────────────────────────────────────────
// Typical outside diameters (mm): a sketch of fill, not a measurement.
export const DIAMETERS = {cat6: 6.0, cat6a: 7.5, os2: 3.0, om3: 3.0, om4: 3.0, om5: 3.0, dac: 5.0, aoc: 3.0};
const UNSET_D = 6.0;
export const FILL_LIMIT = 0.4;
const areaOf = media => Math.PI * ((DIAMETERS[media] ?? UNSET_D) / 2) ** 2;

// Every pathway with an aperture that a cable passes through, filled against
// FILL_LIMIT of its opening. Lanes have no limit and are not listed.
export function fill(rack, ctx) {
  const at = new Map();
  for (const c of rack.cables || []) {
    for (const w of resolveRoute(rack, c, ctx).waypoints) {
      if (w.lane) continue;
      const g = ctx.guidesOf(w.item).find(x => x.via === w.via);
      if (!g?.aperture) continue;
      const key = `${w.item}|${w.via}`;
      const e = at.get(key) || {item: w.item, via: w.via, aperture: g.aperture, area: 0, cables: []};
      if (e.cables.includes(c.id)) continue;
      e.area += areaOf(c.media);
      e.cables.push(c.id);
      at.set(key, e);
    }
  }
  return [...at.values()].map(e => {
    const percent = Math.round(e.area / (FILL_LIMIT * e.aperture.w * e.aperture.h) * 100);
    return {item: e.item, via: e.via, count: e.cables.length, percent, over: percent > 100, cables: e.cables};
  });
}

// Managers whose stated capacity the cables through them exceed.
export function capacityOver(rack, ctx) {
  const by = new Map();
  for (const c of rack.cables || [])
    for (const w of resolveRoute(rack, c, ctx).waypoints)
      if (w.item) (by.get(w.item) || by.set(w.item, new Set()).get(w.item)).add(c.id);
  const out = [];
  for (const [item, set] of by) {
    const cap = ctx.chassisOf(itemOf(rack, item)?.ref)?.capacity?.count;
    if (cap && set.size > cap) out.push({item, count: set.size, capacity: cap});
  }
  return out;
}

// ── keeping routed lengths current ────────────────────────────────────────
// A cable with no length, or a routed one, gets the length its route measures;
// an entered length is the user's and is never touched. Returns the same rack
// when nothing changed, so the page can tell whether to save.
export function withRoutedLengths(rack, ctx) {
  let changed = false;
  const cables = (rack.cables || []).map(c => {
    if (c.length && c.length.source !== 'routed') return c;
    const got = routedLength(rack, c, ctx);
    if (!got) return c;
    const measured = Math.round(got.measured * 100) / 100;
    if (c.length?.value === got.value && c.length?.measured === measured) return c;
    changed = true;
    return {...c, length: {value: got.value, unit: 'm', source: 'routed', measured}};
  });
  return changed ? {...rack, cables} : rack;
}
```

Note: the length test's expected `measured` is unrounded, while `withRoutedLengths` stores it to 2 decimals. Keep both as written.

- [ ] **Step 4: Run the tests.**

```bash
node --test tests/*/*.test.mjs
```

Expected: PASS. Check by hand that the fill test's `percent` is the spec's formula: area ÷ (0.4 × w × h).

- [ ] **Step 5: Commit.**

```bash
git add site/rack/route.js tests/rack/route.test.mjs
git commit -m "rack: a route measured into a stock length, and how full each ring and duct is

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Route facts from the drawings, and routed lengths kept current

**Files:**
- Create: `site/rack/route-context.js`
- Modify: `site/rack-page.js` (render path: compute facts, keep lengths, show length in the form); `site/rack/cable-panel.js` (length line)
- Test: browser check in Task 10; a node test for the pure helper below

**Interfaces:**
- Consumes: `configuredFace({ref, cfg, view, swaps, fields})` from `site/rack/face.js` → `{text, root, vb, zones, ports}`, where `ports` are zones `{id, cls, x, y, w, h, path?}` in face coordinates.
- Produces:
  - `routeFacts(rack, chassisOf) -> Promise<{ctx, routes: Map<cableId, {waypoints, gone, auto}>, fill, over, lengths}>`, where `ctx` is a full route ctx;
  - `guidesFromSvg(text, face, faceWidth) -> [{via, kind, face, x, box: {x, y, w, h}, aperture}]` (pure over an SVG string; exported for tests).

- [ ] **Step 1: Write the failing test for the pure parser.** Create `tests/rack/route-context.test.mjs`. `DOMParser` is not in node, so it parses through a minimal shim. The helper takes a `parse` argument for exactly this reason.

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {guidesFromRects} from '../../site/rack/route-context.js';

test('guidesFromRects maps ring ends, ducts and passes to via ids in rack coordinates', () => {
  // Face 483 wide: rack x = face x - 241.5 on the front; mirrored on the rear.
  const rects = [
    {id: 'guide-1-end', kind: 'ring', x: 32.3, y: 0, w: 6.8, h: 41},
    {id: 'guide--duct', cls: 'guide', x: 20, y: 5, w: 443, h: 30},
    {id: 'pass--rear-brush', cls: 'pass', x: 9, y: 6, w: 465, h: 32},
    {id: 'chassis-faceplate', x: 0, y: 0, w: 483, h: 44}];
  const front = guidesFromRects(rects, 'front', 483);
  assert.deepEqual(front.map(g => [g.via, g.kind, Math.round(g.x * 10) / 10]),
    [['guide-1', 'ring', -205.8], ['duct', 'duct', 0], ['rear-brush', 'pass', 0]]);
  assert.deepEqual(front.find(g => g.via === 'duct').aperture, {w: 30, h: 30});
  assert.deepEqual(front.find(g => g.via === 'rear-brush').aperture, {w: 465, h: 32});
  const rear = guidesFromRects(rects, 'rear', 483);
  assert.equal(Math.round(rear[0].x * 10) / 10, 205.8);
});
```

Run `node --test tests/rack/route-context.test.mjs`. Expected: FAIL (module missing).

- [ ] **Step 2: Implement `site/rack/route-context.js`.**

```js
// WHAT A ROUTE NEEDS FROM THE DRAWINGS (the site's half; route.js is pure).
// Each placed item's configured faces give its guides - ring ends, ducts,
// pass-throughs - and its ports, which are turned here into route.js's rack
// coordinates: mm from the rack's center line, right as seen from the front.
// A rear-facing panel is seen mirrored, so its x is negated.

import {configuredFace} from './face.js';
import {resolveRoute, fill, capacityOver, routedLength, endPane} from './route.js';
import {portPathOf} from './cable-rules.js';
import {RU} from './rails.js';

const toRack = (x, face, w) => (face === 'rear' ? -(x - w / 2) : x - w / 2);

// rects: [{id, kind?, cls?, x, y, w, h}] in face coordinates; a ring END
// (`<via>-end`, kind ring) stands for its ring; `guide--<via>` is a duct; `pass--<via>` a pass-through.
export function guidesFromRects(rects, face, faceW, apertures = {}) {
  const out = [];
  for (const r of rects) {
    let via = null, kind = null;
    if (r.kind === 'ring' && r.id.endsWith('-end')) { via = r.id.slice(0, -4); kind = 'ring'; }
    else if (r.cls === 'guide' && r.id.startsWith('guide--')) { via = r.id.slice(7); kind = 'duct'; }
    else if (r.cls === 'pass' && r.id.startsWith('pass--')) { via = r.id.slice(6); kind = 'pass'; }
    if (!via) continue;
    // A ring's opening is its component's (top view); a duct's cross-section is
    // taken as square on its drawn height - an estimate; a pass is its rect.
    const aperture = kind === 'ring' ? (apertures[via] ?? null)
      : kind === 'duct' ? {w: r.h, h: r.h} : {w: r.w, h: r.h};
    out.push({via, kind, face, x: toRack(r.x + r.w / 2, face, faceW), box: {x: r.x, y: r.y, w: r.w, h: r.h}, aperture});
  }
  return out;
}

// Rects of an SVG string with their translate() ancestors applied: enough for
// compiled faces, whose guides are plain rects under translated groups.
function rectsOf(text) {
  const root = new DOMParser().parseFromString(text, 'image/svg+xml').documentElement;
  const offset = el => {
    let dx = 0, dy = 0;
    for (let p = el.parentElement; p && p !== root; p = p.parentElement) {
      const m = /translate\(\s*([-\d.]+)[ ,]+([-\d.]+)\s*\)/.exec(p.getAttribute('transform') || '');
      if (m) { dx += +m[1]; dy += +m[2]; }
    }
    return [dx, dy];
  };
  return [...root.querySelectorAll('rect[id]')].map(el => {
    const [dx, dy] = offset(el), n = a => parseFloat(el.getAttribute(a)) || 0;
    return {id: el.id, kind: el.getAttribute('data-kind'), cls: el.getAttribute('data-class'),
            x: n('x') + dx, y: n('y') + dy, w: n('width'), h: n('height')};
  });
}

// A ring component's opening, from the top view: `data-guide-aperture="w h"`.
function aperturesOf(text) {
  const root = new DOMParser().parseFromString(text, 'image/svg+xml').documentElement;
  const out = {};
  for (const el of root.querySelectorAll('[data-guide-aperture]')) {
    const [w, h] = el.getAttribute('data-guide-aperture').split(/\s+/).map(Number);
    if (el.id && w > 0 && h > 0) out[el.id] = {w, h};
  }
  return out;
}

const faceOf = it => view => configuredFace({ref: it.ref, cfg: it.cfg, view, swaps: it.swaps || {}, fields: it.fields || {}})
  .catch(() => null);

export async function routeFacts(rack, chassisOf) {
  const guides = new Map(), ports = new Map();
  await Promise.all(rack.items.map(async it => {
    const c = chassisOf(it.ref) || {};
    const get = faceOf(it);
    const [front, rear, top] = await Promise.all([get('front'), get('rear'), c.guides?.top ? get('top') : null]);
    const aps = top ? aperturesOf(top.text) : {};
    const list = [];
    // Its outward panel is on its face; the other panel faces the other way.
    const facing = {front: it.turned ? (it.face === 'front' ? 'rear' : 'front') : it.face};
    facing.rear = facing.front === 'front' ? 'rear' : 'front';
    for (const [view, f] of [['front', front], ['rear', rear]]) {
      if (!f) continue;
      const w = f.vb?.[2] ?? 483;
      list.push(...guidesFromRects(rectsOf(f.text), facing[view], w, aps));
      for (const p of f.ports || [])
        ports.set(`${it.id}|${view}|${p.path ?? p.id}`, {x: toRack(p.x + p.w / 2, facing[view], w), y: p.y + p.h / 2, faceH: f.vb?.[3] ?? RU});
    }
    guides.set(it.id, list);
  }));
  const itemOf = id => rack.items.find(i => i.id === id);
  const port = end => ports.get(`${end.item}|${end.view === 'rear' ? 'rear' : 'front'}|${portPathOf(end.path)}`) ?? null;
  const ctx = {
    chassisOf,
    guidesOf: id => guides.get(id) ?? [],
    portX: end => port(end)?.x ?? null,
    // Height above the floor: the item's top, less the port's depth into its face.
    portY: end => { const p = port(end), it = itemOf(end.item);
      if (!p || !it) return null;
      const u = Math.max(1, chassisOf(it.ref)?.ru ?? 1);
      return (it.ru - 1 + u) * RU - p.y * (u * RU / p.faceH); },
  };
  const routes = new Map((rack.cables || []).map(c => [c.id, resolveRoute(rack, c, ctx)]));
  const lengths = new Map((rack.cables || []).map(c => [c.id, routedLength(rack, c, ctx)]));
  return {ctx, routes, fill: fill(rack, ctx), over: capacityOver(rack, ctx), lengths, endPane: e => endPane(rack, e)};
}
```

Before relying on it, check two things and adapt:
- **Port zones:** look at what a port zone carries for its cable path. Search `site/rack/cable-plugs.js` for how a port zone is matched to an end's `path`. Use the same key instead of `p.path ?? p.id` if it differs.
- **Ring components:** whether the top view's ring components carry the `id` the ring ends name (`guide-1` for `guide-1-end`). Check in `assets/dist/fhd-cmp5dr.base.top.svg`, as recorded in Task 1.

- [ ] **Step 3: Keep routed lengths and facts current on the page.** In `site/rack-page.js`:
  - add `import {routeFacts} from './rack/route-context.js';` and `import {withRoutedLengths} from './rack/route.js';`;
  - add `S.routes = null` to the state.

In the async part of `render()` that already awaits faces for cables (search `cableFacts(`), after the cable facts resolve, add:

```js
  // ROUTES (spec §5, §8): resolved from the drawings each render. A routed
  // length is the document's, so when one changes it is saved, without an
  // Undo - it is the page's measurement, not an edit.
  if ((rack().cables || []).length) {
    const at = S.doc;
    const facts = await routeFacts(rack(), chassisOf).catch(err => { console.warn('[portrayal] routes', err); return null; });
    if (facts && S.doc === at) {
      S.routes = facts;
      const next = withRoutedLengths(rack(), facts.ctx);
      if (next !== rack()) {
        S.doc = {...S.doc, racks: S.doc.racks.map(r => (r.id === next.id ? next : r))};
        S.save.saveSoon(S.doc);
      }
    }
  } else S.routes = null;
```

Read `render()` to place this where awaiting is already done, and where a later redraw of the cable list sees `S.routes`. Do not trigger another `render()` from inside it.

In `cableFormPanel`, pass `routed: cable?.length?.source === 'routed' ? cable.length : null` to `cableForm`. In `site/rack/cable-panel.js`'s `cableForm`, beside the length field, show a muted line when `routed` is set and the field is empty, e.g. `2 m (routed, 1.62 m measured)`. Typing a length saves it with source `entered`, as today. Clearing the field saves no length, so the routed upkeep resumes on the next render.

- [ ] **Step 4: Run the tests.**

```bash
node --test tests/*/*.test.mjs
uptime
python3 check-browser.py --only check_rack_page,check_rack_library
```

Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add site/rack/route-context.js tests/rack/route-context.test.mjs site/rack-page.js site/rack/cable-panel.js
git commit -m "rack: routes resolved from the drawings, and routed lengths kept current

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Routes in 2D

**Files:**
- Modify: `site/rack/elevation.js` (`drawElevation` gains `laneGap`)
- Modify: `site/rack/cables.js` (`routed2d`; `drawCables2d` reads `link.via2d`)
- Modify: `site/rack/cable-view.js` (waypoints per pane, lane offsets, fill outlines)
- Modify: `site/rack-page.js` (pass `laneGap` when the rack has cables; pass `S.routes` to the cable view)
- Test: browser check in Task 10

**Interfaces:**
- Consumes: `S.routes` (Task 5): `routes.get(id).waypoints`, `fill`, `over`; `LANE_GAP` from route.js.
- Produces:
  - `drawElevation({..., laneGap = 0})`;
  - plan links may carry `via2d: {front: [[x, y], ...], rear: [...]}` in pane coordinates, in order from the `from` end;
  - `routed2d(points, r = 4) -> path d`;
  - over-full pathways drawn as `rect[data-fill-over="<item>|<via>"]`.

- [ ] **Step 1: The wider gutter.** In `drawElevation`, add `laneGap = 0` to the options and replace the viewBox computation:

```js
  // Lanes (cable routing spec §7): with routed cables the gutter beside each
  // rail widens to the lane gap, so a run up the side has room.
  const g = Math.max(6, laneGap);
  const out = svgEl('svg', {xmlns: 'http://www.w3.org/2000/svg', 'data-pane': view,
    viewBox: `${-RAIL_W - g} -18 ${OPENING + RAIL_W * 2 + g * 2} ${totalH + 30}`});
```

Keep the gutter mark and its transparent rect where they are (they use `-RAIL_W - 6`).

- [ ] **Step 2: `routed2d` and drawing through waypoints.** In `site/rack/cables.js`:

```js
// A ROUTED CABLE (routing spec §7): straight runs between its waypoints, each
// corner rounded by r, so it reads as dressed cable rather than a hang.
export function routed2d(pts, r = 4) {
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let k = 1; k < pts.length - 1; k++) {
    const [p, q, s] = [pts[k - 1], pts[k], pts[k + 1]];
    const cut = (a, b) => { const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, t = Math.min(r, L / 2) / L;
      return [b[0] + (a[0] - b[0]) * t, b[1] + (a[1] - b[1]) * t]; };
    const i = cut(p, q), o = cut(s, q);
    d += ` L${i[0]} ${i[1]} Q${q[0]} ${q[1]} ${o[0]} ${o[1]}`;
  }
  const z = pts[pts.length - 1];
  return `${d} L${z[0]} ${z[1]}`;
}
```

In `drawCables2d`:
- In the two-ends branch: `const via = link.via2d?.[view];` and, when `via?.length`, `stroke(g, routed2d([a, ...via, b]), color, WIDTH)` instead of `hang(...)`.
- In the tagged cross-face branch (`rec.tagged = true`), when `via?.length`, place the tag at the last waypoint's height instead of `a[1] + 30`. Draw `routed2d([a, ...via, [edgeX, y]])`.

Leave the loose-lead branch unchanged. The showcase passes no `via2d`, so it is unaffected.

- [ ] **Step 3: Waypoints per pane in `cable-view.js`.** Where the Rack Builder builds its plan for `drawCables2d`, add `via2d` from `routes`:

```js
import {LANE_GAP} from './route.js';
import {RU, RAIL_W, OPENING} from './rails.js';

// A waypoint's point in a pane, or null when it is not on this pane.
// Lanes: sides are the rack's as seen from the front, so the rear pane mirrors them.
function wayPoint(svg, w, view, frame, k) {
  if (w.lane) {
    const [side, face] = w.lane.split('-');
    if (face && face !== view) return null;
    const paneLeft = view === 'front' ? side === 'left' : side === 'right';
    const off = (k % 6) * 3;                       // cables sharing a lane, a little apart
    const x = paneLeft ? -RAIL_W - LANE_GAP / 2 - off : OPENING + RAIL_W + LANE_GAP / 2 + off;
    return [x, frame.heightRU * RU - (w.ru - 0.5) * RU];
  }
  const g = svg.querySelector(`[data-item-id="${CSS.escape(w.item)}"][data-panel]`);
  const el = g && ['', '-end'].map(s => g.querySelector(`[id="${CSS.escape(w.via + s)}"]`)).find(Boolean)
    || g?.querySelector(`[id="guide--${CSS.escape(w.via)}"], [id="pass--${CSS.escape(w.via)}"]`);
  if (!el) return null;
  const b = el.getBBox(), inv = svg.getScreenCTM().inverse();
  const c = new DOMPoint(b.x + b.width / 2, b.y + b.height / 2).matrixTransform(inv.multiply(el.getScreenCTM()));
  return [c.x, c.y];
}
```

For each link, set `link.via2d = {front: [...], rear: [...]}`:
- map the cable's resolved waypoints (in order from `a`, the plan's `from`) through `wayPoint` for each pane, keeping non-null points;
- `k` is the count of cables that have already used that lane in this pane.

Read how cable-view builds the plan (search `cablePlan(`), and add `via2d` there from a `routes` argument that `rack-page.js` passes in as `S.routes?.routes`.

**Fill outlines:** after drawing, for each `S.routes.fill` entry with `over`, outline its element in each pane where it is found. Use a `rect` with `data-fill-over="<item>|<via>"`, `fill: none`, `stroke: var(--pt-warn)`, `stroke-width: 1.2` and `pointer-events: none`, sized from the element's bbox mapped as above.

- [ ] **Step 4: Pass the lane gap and routes from the page.** In `rack-page.js`, where `drawElevation` is called for the panes, pass `laneGap: (rack().cables || []).length ? LANE_GAP : 0`. Pass `S.routes` to the cable-view call.

- [ ] **Step 5: Look at it.** Run `uptime`, then `python3 serve.py 8932`, and build in the browser:
  - an `as7726-32x` at U20 with an `fhd-cmp5dr` on it;
  - an `fhd-1ufce` patch panel at U30;
  - two cables from ports on opposite halves of the switch to the panel.

Expected: each cable runs through the rings on its side into that side's gutter and up to U30, with no hang. Take a screenshot for the report.

- [ ] **Step 6: Run checks and commit.**

```bash
node --test tests/*/*.test.mjs
python3 check-browser.py --only check_rack_page,check_rack_elevation,check_rack_face_managers,check_hero_cables
git add site/rack/elevation.js site/rack/cables.js site/rack/cable-view.js site/rack-page.js
git commit -m "rack 2D: a routed cable runs through its rings and up its lane, and a full ring is outlined

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Routes in 3D

**Files:**
- Modify: `site/rack3d.js` (`deviceBoxes` skips sheet bodies; `metrics()` adds `railDepth`)
- Modify: `site/rack/cables.js` (`routePoints3d`; `drawCables3d` option `waypoints`)
- Modify: `site/rack/scene3d.js` (`hangCables` supplies waypoint positions)
- Test: browser check in Task 10

**Interfaces:**
- Consumes: `scene.guideAnchor({id}, elementId)` (piece 1, searches all views); `routes` from Task 5.
- Produces:
  - `routePoints3d(THREE, A, B, wps, r = 30) -> Vector3[]`;
  - `drawCables3d(scene, plan, {..., waypoints: async (link) => Vector3[]})`;
  - a tube's points pass through each waypoint within its grid spread.

- [ ] **Step 1: Boxes and metrics.** In `site/rack3d.js`:
  - in `deviceBoxes()`, skip entries whose `entry.chassis?.shell === 'sheet'`: `.filter(({entry}) => entry.chassis?.shell !== 'sheet')` before the `map`, with a comment that a sheet manager is open, so a route passes through it;
  - add `railDepth: FRAME ? RAIL_DEPTH : 34` to `metrics()`, the depth from the front plane to the rear mounting plane as this file uses it.

- [ ] **Step 2: `routePoints3d`.** In `site/rack/cables.js`:

```js
// A ROUTED RUN (routing spec §7): straight out of each connector as a hang
// does, then taut through every waypoint, each corner rounded by easing r mm
// either side of it - the CatmullRom tube does the rest.
export function routePoints3d(THREE, A, B, wps, r = 30) {
  const a = startOf(THREE, A), b = startOf(THREE, B);
  const outA = a.clone().addScaledVector(A.normal, A.reach ?? LEAD);
  const outB = b.clone().addScaledVector(B.normal, B.reach ?? LEAD);
  const path = [outA, ...wps, outB];
  const pts = [a, outA];
  for (let k = 1; k < path.length - 1; k++) {
    const [p, q, s] = [path[k - 1], path[k], path[k + 1]];
    const ease = (from, to) => { const d = to.distanceTo(from); return to.clone().lerp(from, Math.min(r, d / 2) / (d || 1)); };
    pts.push(ease(p, q), q.clone(), ease(s, q));
  }
  pts.push(outB, b);
  return pts;
}
```

In `drawCables3d`, add `waypoints = null` to the options. Before building `pts` for a two-ended link:

```js
    const wps = !dangling && waypoints ? await waypoints(link) : [];
    if (!live()) return null;
    const pts = clearOf(dangling ? danglePoints3d(THREE, landed[0])
      : wps.length ? routePoints3d(THREE, ends[0], ends[1], wps) : hangPoints3d(THREE, ends[0], ends[1], rackW), boxes);
```

- [ ] **Step 3: Waypoint positions in `scene3d.js`.** `mountRack3d` takes `routes` (Task 5's `S.routes?.routes`) and passes `waypoints` to `drawCables3d`:

```js
import {LANE_GAP} from './route.js';
import {RU} from './rails.js';

// Where a route's waypoints are in the room. A ring, duct or pass by its
// drawing (guideAnchor, which tries the ring's end and the guide and pass
// rects); a lane LANE_GAP/2 outside the posts at the U's middle. Cables that
// share a waypoint are spread on a small grid so their tubes do not overlap.
function waypointsFor(scene, routes, THREE) {
  const used = new Map();
  const m = scene.metrics();
  return async link => {
    const r = routes?.get(link.id);
    if (!r) return [];
    const out = [];
    for (const w of r.waypoints) {
      let p = null;
      if (w.lane) {
        const [side, face = 'front'] = w.lane.split('-');
        const x = (side === 'left' ? -1 : 1) * (m.rackWidth / 2 + LANE_GAP / 2);
        p = new THREE.Vector3(x, (w.ru - 0.5) * RU, face === 'rear' ? m.faceZ - m.railDepth : m.faceZ);
      } else {
        for (const id of [w.via, `${w.via}-end`, `guide--${w.via}`, `pass--${w.via}`]) {
          const a = await scene.guideAnchor({id: w.item}, id);
          if (a) { p = a.position.clone(); break; }
        }
      }
      if (!p) continue;
      const key = w.lane ? `${w.lane}|${w.ru}` : `${w.item}|${w.via}`;
      const k = used.get(key) || 0; used.set(key, k + 1);
      p.x += ((k % 3) - 1) * 6; p.y += ((Math.floor(k / 3) % 3) - 1) * 6;
      out.push(p);
    }
    return out;
  };
}
```

Wire it in `hangCables`: `drawCables3d(scene, cablePlan3d(rack), {anchor: ..., waypoints: waypointsFor(built, routes, built.three.THREE)})`. Pass `routes` from `mountRack3d`'s new option. In `rack-page.js`, pass `routes: S.routes?.routes ?? null` where it calls `mountRack3d`, and rebuild the 3D scene when routes change. Check `keepScene`/`sameCables3d`: a change in a cable's route must rebuild, so extend `sameCables3d` in `cable-rules.js` to include `JSON.stringify(c.routeEdited ? c.route : null)` in its key. Automatic routes depend on the rack's items, which already rebuild the scene.

- [ ] **Step 4: Look at it.** In 3D with the Task 6 rack: each tube passes through the rings on its side and runs up beside the post. Nothing cuts through the switch or the manager. Take a screenshot.

- [ ] **Step 5: Run checks and commit.**

```bash
node --test tests/*/*.test.mjs
uptime
python3 check-browser.py --only check_rack_face_managers,check_rack_export_3d
git add site/rack3d.js site/rack/cables.js site/rack/scene3d.js site/rack/cable-rules.js site/rack-page.js
git commit -m "rack 3D: a routed cable runs taut through its rings and up the lane outside the post

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Editing a route

**Files:**
- Create: `site/rack/route-panel.js`
- Modify: `site/rack-page.js` (cable form gets the Route list; picking mode in `onPaneClick`; Esc)
- Modify: `site/rack/cable-view.js` (pick targets)
- Test: browser check in Task 10

**Interfaces:**
- Consumes: `resolveRoute`, `routeText` (Task 3); `S.routes` (Task 5); `updateCable(rack, id, patch)` from `cable-rules.js`.
- Produces:
  - `routeList({rows: [{text, gone}], auto, selected, onSelect(i), onUp(i), onDown(i), onRemove(i), onAdd(), onReset()}) -> Element`. Element ids: `#routeList`, `#routeAdd`, `#routeReset`, rows `#routeRow-<i>`, buttons `#routeUp-<i>`, `#routeDown-<i>`, `#routeDel-<i>`.
  - `drawPickTargets(svg, targets)`: transparent rects `[data-pick-item][data-pick-via]` and `[data-pick-lane][data-pick-ru]`.
  - `S.routePick = {cableId, at}`.

- [ ] **Step 1: `route-panel.js`.**

```js
// A CABLE'S ROUTE IN ITS FORM (routing spec §6). Automatic until edited: the
// waypoints the page chose are shown grayed. Any change stores the whole list.
// Like the other panels, every action is a callback.

import {el} from './dom.js';

const button = (id, text, fn, label) => {
  const b = el('button', {type: 'button', id, text, ...(label ? {'aria-label': label} : {})});
  b.addEventListener('click', fn);
  return b;
};

export function routeList({rows, auto, selected = null, onSelect, onUp, onDown, onRemove, onAdd, onReset}) {
  const items = rows.map((r, i) => el('li', {id: `routeRow-${i}`, class: [auto ? 'rk-muted' : '', i === selected ? 'rk-selected' : '', r.gone ? 'rk-gone' : ''].join(' ').trim(),
                                              tabindex: '0'}, [
    `${r.text}${r.gone ? ' (gone)' : ''} `,
    button(`routeUp-${i}`, '↑', () => onUp(i), 'Move up'),
    button(`routeDown-${i}`, '↓', () => onDown(i), 'Move down'),
    button(`routeDel-${i}`, '✕', () => onRemove(i), 'Remove waypoint')]));
  for (const [i, li] of items.entries()) li.addEventListener('click', ev => { if (ev.target === li) onSelect(i); });
  return el('section', {id: 'routeList', class: 'rk-route'}, [
    el('h4', {text: auto ? 'Route: automatic' : 'Route'}),
    rows.length ? el('ol', {}, items) : el('p', {class: 'rk-muted', text: 'Hangs directly between its ports.'}),
    el('div', {class: 'rk-actions'}, [button('routeAdd', 'Add waypoint', onAdd),
                                      ...(auto ? [] : [button('routeReset', 'Reset route', onReset)])]),
  ]);
}
```

- [ ] **Step 2: Wire it into the cable form.** In `rack-page.js`'s `cableFormPanel`, for an existing cable, build rows from `S.routes?.routes.get(cable.id)`:
  - when automatic: `waypoints` with `gone: false`;
  - when edited: the stored `cable.route`, each row's `gone` true when it is in `gone`;
  - text: `routeText([w], id => itemById(id)?.label ?? id, rack().frame)`.

Append `routeList(...)` to the form's element. Each action commits through a guarded helper:

```js
// Every route edit stores the whole list and is one Undo (spec §6).
function editRoute(cableId, list, text) {
  const now = rack(), c = now.cables.find(x => x.id === cableId);
  if (!c) { S.sel = null; render(); return; }
  commit(updateCable(now, cableId, {route: list, routeEdited: true}), {text});
}
```

- `onUp(i)` and `onDown(i)` swap neighbors. `onRemove(i)` splices. `onReset` commits `updateCable(now, id, {route: [], routeEdited: undefined})` with the text "Route reset to automatic."
- The starting list is the shown one (the automatic waypoints when automatic), so the first edit freezes what was shown.
- If `updateCable` filters patch keys, check it and make sure `routeEdited` can be set and removed: `undefined` must delete the key. Add that to `updateCable` with a unit test in `tests/rack/cables.test.mjs` if needed.
- `onAdd`: `S.routePick = {cableId: cable.id, at: selected ?? list.length}`; render.

- [ ] **Step 3: Pick targets and the picking click.** In `cable-view.js`, add `drawPickTargets(svg, targets)`. Each target is `{item, via, box}` in pane coordinates, or `{lane, ru, x, y, w, h}`. Draw transparent rects with `fill: transparent`, `cursor: crosshair` and the data attributes, in a layer `[data-pick]` above the cables.

In `rack-page.js`, when `S.routePick` is set, build targets per pane:
- every item's guides from `S.routes.ctx.guidesOf(id)` whose element is found in that pane, boxed with the same bbox mapping as `wayPoint`;
- a lane target per U on each side's gutter (x from `-RAIL_W - LANE_GAP` to `-RAIL_W`, or `OPENING + RAIL_W` to `OPENING + RAIL_W + LANE_GAP`; lane names mirrored on the rear pane as in `wayPoint`).

In `onPaneClick`, first thing:

```js
  if (S.routePick) {
    const t = ev.target.closest('[data-pick-item], [data-pick-lane]');
    if (!t) return;
    const w = t.dataset.pickLane ? {lane: t.dataset.pickLane, ru: Number(t.dataset.pickRu)}
                                 : {item: t.dataset.pickItem, via: t.dataset.pickVia};
    const {cableId, at} = S.routePick;
    const c = rack().cables.find(x => x.id === cableId);
    if (!c) { S.routePick = null; render(); return; }
    const shown = c.routeEdited ? c.route : (S.routes?.routes.get(cableId)?.waypoints ?? []);
    const list = [...shown.slice(0, at), w, ...shown.slice(at)];
    S.routePick = {cableId, at: at + 1};
    editRoute(cableId, list, 'Waypoint added.');
    return;
  }
```

Esc (where the page handles Esc for Move) also clears `S.routePick`. The cable form shows "Click a ring, duct, brush or the gutter beside a rail. Esc stops." while picking.

- [ ] **Step 4: Look at it.** With the Task 6 rack:
  - select a cable, then **Add waypoint**, then click the right gutter at U25;
  - the route list shows it, and the cable redraws through it;
  - Reset brings back the automatic route;
  - Undo restores the previous list.

- [ ] **Step 5: Run checks and commit.**

```bash
node --test tests/*/*.test.mjs
uptime
python3 check-browser.py --only check_rack_page,check_rack_library
git add site/rack/route-panel.js site/rack/cable-view.js site/rack-page.js site/rack/cable-rules.js tests/rack
git commit -m "rack: a cable's route is listed in its form, and waypoints are added by clicking rings and gutters

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Routes in the exports

**Files:**
- Modify: `site/rack/export-data.js` (`CABLE_COLUMNS`, `cableScheduleRows`, `cableBomRows`, the DCIM cable comment)
- Modify: `site/rack/exports.js` (fill and route notes on sheets, BOM and schedule; the draw.io note; passing routes)
- Test: `tests/rack/export-cables.test.mjs`, `tests/rack/bom.test.mjs`

**Interfaces:**
- Consumes: `routeText` (Task 3); `routeFacts` (Task 5).
- Produces:
  - `CABLE_COLUMNS` gains `route` and `length_source` after `length_unit`;
  - `cableScheduleRows(rack, ends, items, routes = null)`, where `routes` is a `Map<cableId, {waypoints}>`;
  - `fillNotes(rack, facts, nameOf) -> string[]`.

- [ ] **Step 1: Write the failing tests.** Append to `tests/rack/export-cables.test.mjs`, using its existing fixture helpers for a rack with two items and one cable:

```js
test('the schedule carries the route and where the length came from', () => {
  const rack = /* the file's existing one-cable rack fixture */;
  const c = {...rack.cables[0], length: {value: 2, unit: 'm', source: 'routed', measured: 1.62}};
  const r = {...rack, cables: [c]};
  const routes = new Map([[c.id, {waypoints: [{lane: 'left-front', ru: 12}, {lane: 'left-front', ru: 24}]}]]);
  const {columns, rows} = X.cableScheduleRows(r, new Map(), r.items, routes);
  assert.deepEqual(columns.slice(columns.indexOf('length'), columns.indexOf('length') + 4),
    ['length', 'length_unit', 'route', 'length_source']);
  assert.equal(rows[0].route, 'left-front U12-U24');
  assert.equal(rows[0].length_source, 'routed');
});
```

(Use the file's real fixture name in place of the comment. Read the top of the file. If `cableScheduleRows` returns rows only, adapt the destructuring to its real return value and keep the assertions.)

Append to `tests/rack/bom.test.mjs`:

```js
test('a routed cable length is marked as routed in the BOM', () => {
  const rack = {cables: [{id: 'c1', media: 'cat6', a: {item: 'i1'}, b: {item: 'i2'},
    length: {value: 2, unit: 'm', source: 'routed', measured: 1.62}}]};
  const [line] = X.cableBomRows(rack);
  assert.match(line.description, /^2 m \(routed\)/);
});
```

(Use the file's own import name for the export-data module.)

Run both files. Expected: FAIL.

- [ ] **Step 2: Implement.**
  - `CABLE_COLUMNS`: insert `'route', 'length_source'` after `'length_unit'`.
  - `cableScheduleRows`: add the `routes = null` parameter. Per row:
    - `route: routes?.get(c.id) ? routeText(routes.get(c.id).waypoints, id => names.get(id)?.name ?? id, rack.frame) : ''`;
    - `length_source: c.length ? (c.length.source || 'entered') : ''`.
    - Import `routeText` from `./route.js`.
  - `cableBomRows`: `const length = lengthText(c.length) ? \`${lengthText(c.length)}${c.length.source === 'routed' ? ' (routed)' : ''}\` : 'length not set';`.
  - DCIM cable rows: find where a cable row's comment is built in `export-data.js` or `dcim-rules.js` (search `length_unit` in the DCIM cable builder). When `c.length?.source === 'routed'`, append "Length measured along its route." to that row's comments or description, whichever the cable import already writes. Add a test beside the existing DCIM cable tests that asserts it.
  - `fillNotes(rack, facts, nameOf)`: for each `facts.fill` entry with `over`, `` `${f.via} on ${nameOf(f.item)}: ${f.count} cables, ${f.percent}% of a 40% fill.` ``; for each `facts.over`, `` `${nameOf(o.item)}: ${o.count} cables through it, more than its stated ${o.capacity}.` ``; for each resolved route with `gone`, the spec's "Cable <name>: waypoint <via> on <item> is gone, so the route skips it." (a lane reads `<lane> U<n>`).
- In `exports.js`:
  - compute `const facts = (rack.cables || []).length ? await routeFacts(rack, chassisOf).catch(() => null) : null;` once per export that needs it: the sheets (`faceNotesFor`), the cable schedule and the BOM;
  - add `fillNotes(...)` to their notes;
  - pass `facts?.routes` to `cableScheduleRows`;
  - in `drawioFile`, when any cable has a non-empty resolved route, add the note "Cable routes are not drawn in draw.io; the cables run straight between their ports there."

- [ ] **Step 3: Run tests and the export checks.**

```bash
node --test tests/*/*.test.mjs
uptime
python3 check-browser.py --only check_rack_export_drawio,check_rack_export_device_csv,check_rack_export_dcim_types
```

Expected: PASS. If an existing browser check asserts the schedule's exact column list, update its expected list to include the two new columns, and say so in the report.

- [ ] **Step 4: Commit.**

```bash
git add site/rack/export-data.js site/rack/exports.js site/rack/dcim-rules.js tests/rack check-browser.py
git commit -m "rack: routes, routed lengths and full pathways in the schedule, BOM, DCIM kits and notes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: The routing browser check

**Files:**
- Modify: `check-browser.py` (new `@extra` after `check_rack_face_managers`)

**Interfaces:**
- Consumes everything above. Probe API: `window.__rack.{ready, doc, replaceRack, scene}`.

- [ ] **Step 1: Write the check.** Model it on `check_rack_face_managers`: the same page opening, the two-evaluate rack build (the split avoids "Execution context was destroyed"), and the same selectors.

```python
@extra("rack.html: cables route through their manager's rings and up the lanes, in 2D and 3D, edited and reset, with a routed length")
def check_rack_cable_routes(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    page.goto(f"{base}/rack.html?probe=1", wait_until="load")
    page.wait_for_function("() => window.__rack && window.__rack.ready", timeout=READY_MS)
    page.evaluate("() => window.__rack.ready")
    page.click('#rkMode [data-mode="2d"]')
    page.evaluate("""async () => {
      const M = await import('/site/rack/model.js'), C = await import('/site/rack/chassis.js');
      const cat = await C.loadChassis();
      let r = M.newRack({name: 'Routes'});
      ({rack: r} = M.withItem(r, {ref: 'as7726-32x', cfg: cat['as7726-32x'].default, ru: 20, label: 'leaf-1'}));
      ({rack: r} = M.withItem(r, {ref: 'fhd-cmp5dr', cfg: cat['fhd-cmp5dr'].default, ru: 20, label: 'mgr-1', on: 'i1', unit: 1}));
      ({rack: r} = M.withItem(r, {ref: 'fhd-1ufce', cfg: cat['fhd-1ufce'].default, ru: 30, label: 'pp-1'}));
      window.__routesRack = r;
    }""")
    # Two cables from opposite halves of the switch: ports chosen from the
    # switch's own front face, leftmost and rightmost, to the panel's first port.
    page.evaluate("""async () => {
      const F = await import('/site/rack/face.js'), K = await import('/site/rack/cable-rules.js');
      let r = window.__routesRack;
      const sw = await F.configuredFace({ref: 'as7726-32x', cfg: r.items[0].cfg, view: 'front', swaps: {}, fields: {}});
      const pp = await F.configuredFace({ref: 'fhd-1ufce', cfg: r.items[2].cfg, view: 'front', swaps: {}, fields: {}});
      const ports = [...sw.ports].filter(p => p.cls === 'port').sort((a, b) => a.x - b.x);
      const pport = [...pp.ports].filter(p => p.cls === 'port').sort((a, b) => a.x - b.x);
      const pathOf = p => p.path ?? p.id;
      ({rack: r} = K.withCable(r, {a: {item: 'i1', path: pathOf(ports[0]), view: 'front'}, b: {item: 'i3', path: pathOf(pport[0]), view: 'front'}, media: 'cat6'}));
      ({rack: r} = K.withCable(r, {a: {item: 'i1', path: pathOf(ports[ports.length - 1]), view: 'front'}, b: {item: 'i3', path: pathOf(pport[1]), view: 'front'}, media: 'cat6'}));
      window.__rack.replaceRack(r);
    }""")
    page.wait_for_function("() => document.querySelectorAll('#paneFront svg [data-cable]').length === 2", timeout=READY_MS)
    page.wait_for_function("() => window.__rack.doc().racks[0].cables.every(c => c.length && c.length.source === 'routed')", timeout=READY_MS)
    # 2D: each cable's path runs into its side's gutter (x outside the rails).
    sides = page.evaluate("""() => {
      const s = document.querySelector('#paneFront svg');
      return [...s.querySelectorAll('[data-cable] path')].filter(p => !p.dataset.leader).map(p => {
        const b = p.getBBox(); return [Math.round(b.x), Math.round(b.x + b.width)]; });
    }""")
    if not any(x0 < -26 for x0, _ in sides) or not any(x1 > 450.85 + 26 for _, x1 in sides):
        bad.append(f"2D: the cables do not run out to both gutters: {sides}")
    # The automatic routes: through mgr-1's rings, into left-front and right-front.
    routes = page.evaluate("() => window.__rack.routes?.() ?? null")
    if routes is None:
        bad.append("probe: window.__rack.routes() is missing - expose S.routes.routes as [[id, waypoints], ...]")
    else:
        lanes = sorted({w["lane"] for _, ws in routes for w in ws if "lane" in w})
        rings = [w["via"] for _, ws in routes for w in ws if w.get("item") == "i2"]
        if lanes != ["left-front", "right-front"] or not {"guide-1", "guide-5"} <= set(rings):
            bad.append(f"routes: lanes {lanes}, rings {rings}")
    # Edit: select the first cable, add a waypoint in the right gutter at U25, check it is stored and survives a reload.
    page.click('#paneFront svg [data-cable-tags] [data-cable-id], #cableList [id^="cableRow-"]', timeout=READY_MS)
    page.click("#routeAdd")
    page.click('#paneFront svg [data-pick-lane="right-front"][data-pick-ru="25"]')
    page.keyboard.press("Escape")
    stored = page.evaluate("() => window.__rack.doc().racks[0].cables.find(c => c.routeEdited)?.route ?? null")
    if not stored or {"lane": "right-front", "ru": 25} not in stored:
        bad.append(f"edit: the waypoint was not stored: {stored}")
    page.evaluate("() => window.__rack.flush()")
    page.reload(wait_until="load")
    page.wait_for_function("() => window.__rack && window.__rack.ready", timeout=READY_MS)
    page.evaluate("() => window.__rack.ready")
    again = page.evaluate("() => window.__rack.doc().racks[0].cables.find(c => c.routeEdited)?.route ?? null")
    if again != stored:
        bad.append(f"reload: the edited route came back as {again}")
    # Reset returns to automatic.
    page.click('#cableList [id^="cableRow-"]', timeout=READY_MS)
    if page.query_selector("#routeReset"):
        page.click("#routeReset")
    if page.evaluate("() => window.__rack.doc().racks[0].cables.some(c => c.routeEdited)"):
        bad.append("reset: a cable is still marked edited")
    # 3D: the left cable's tube passes near mgr-1's guide-1.
    page.click('#rkMode [data-mode="3d"]')
    page.wait_for_function("() => window.__rack.scene() != null", timeout=READY_3D_MS)
    near = page.evaluate("""async () => {
      const s = window.__rack.scene(); await s.complete?.();
      const a = await s.guideAnchor({id: 'i2'}, 'guide-1');
      const tubes = s.rackCables?.tubes ?? [];
      return Math.min(...tubes.flatMap(t => t.points.map(p => p.distanceTo(a.position))));
    }""")
    if not (near < 20):
        bad.append(f"3D: no tube passes within 20 mm of mgr-1's guide-1 (closest {near})")
    return bad
```

Then:
- add the probe the check asks for: in `rack-page.js`'s `window.__rack`, `routes: () => S.routes ? [...S.routes.routes].map(([id, r]) => [id, r.waypoints]) : null`;
- adjust the cable-selection click to the page's real selector for selecting a cable (read how `check_rack_*` cable checks select a cable, and use that);
- if `scene.rackCables` is not where the tubes are held, read `scene3d.js` (`built.rackCables`) and use the right path.

- [ ] **Step 2: Run it.**

```bash
uptime
python3 check-browser.py --only check_rack_cable_routes
```

Expected: PASS. If the load average is above the CPU count, use `nohup sh ~/.claude/merge-agent/portrayal-site/when-calm.sh ...` or wait. Never kill processes that are not yours.

- [ ] **Step 3: Full local run.**

```bash
node --test tests/*/*.test.mjs && python3 check-contract.py && python3 check-browser.py
```

Expected: PASS.

- [ ] **Step 4: Update the specs' status and commit.** Set the routing spec's **Status** to "implemented (plan: docs/superpowers/plans/2026-10-07-cable-routing-pathways.md)". Add the same note to the Rack Builder spec's status line.

```bash
git add check-browser.py site/rack-page.js docs/superpowers/specs/2026-10-07-cable-routing-pathways-design.md docs/superpowers/specs/2026-09-26-rack-builder-design.md
git commit -m "check: cables route through their rings and lanes in 2D and 3D, edited, reloaded and reset

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

The push and PR come after the final whole-branch review: push without `--no-verify`, open the PR, and message the "Portrayal-site merge agent".
