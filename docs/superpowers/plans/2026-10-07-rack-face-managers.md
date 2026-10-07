# Rack-face cable managers: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Place 0RU rack-face cable managers (FS FHD-CMP5DR) in the Rack Builder, either on a device or on a bare U. Draw them in 2D and 3D, and carry them through every export.

**Architecture:**
- A manager is an ordinary item in `rack.items`, with optional `on` (host item id) and `unit`, and an always-stored `ru`.
- New pure logic goes in `site/rack/managers.js`: hosts, placement, moving with a host, settling a loaded rack. `fit.js` gains a rack-face branch.
- Drawing and exports branch on the `mount: 'rack-face'` that `itemsWithU` already puts on non-rack items.

**Tech Stack:** Vanilla ES modules, no bundler; `node --test` for unit tests; Python + Playwright `check-browser.py` and `check-contract.py`; three.js via `site/rack3d.js`.

**Spec:** `docs/superpowers/specs/2026-10-07-rack-face-managers-design.md`

## Global Constraints

- American English in prose, comments and UI text. The upstream repo is British; do not "fix" upstream text.
- No bundler, no npm, no new dependency. Modules import each other by relative path.
- Every refusal is a sentence the page shows as it is.
- Nothing is silently deleted. A manager whose host goes stays, unhosted.
- Rack file `version` becomes **2**.
- `zeroU` stays reserved for side-mounted gear and is not used here.
- A manager's chassis in tests: `{ru: 1, h: 44, d: 110, mount: 'rack-face', shell: 'sheet'}` (upstream `fhd-cmp5dr`, 110 mm projection).
- Commit after every task, with the attribution line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Working sessions stop at an open PR with a code review. The **merge agent** lands on `main`. Never push `main`.

## Review Focus

1. **A host moved so that one of its managers collides** (another manager already on that U and face) must be refused with the manager's reason, and leave the rack unchanged. Covered in Task 3.
2. **Two managers on a 2U host move together by one U.** A sibling's old spot must not refuse the move. Covered in Task 3.
3. **A rack saved by an older page (version 1) opens unchanged.** A version-2 file in an older page is refused with a sentence. Covered in Task 2.
4. **A front manager over a rear-mounted host on a four-post rack.** The host must be on the manager's face. A manager dropped there is bare, not attached across the rack. Covered in Task 3.
5. **The NetBox kit with a manager in it.** The manager row must not knock its host out as "shares U ... full depth", and must have a blank position and face. Covered in Task 6.

---

## File map

| File | Change |
|---|---|
| `chassis-index.py` | writes `shell`, `capacity`, `guides`, `passes` |
| `check-contract.py` | the FHD-CMP5DR is in the catalog; the vendored relief builds sheet bodies |
| `site/rack/model.js` | version 2; `on`/`unit` read and written; `withoutItem` detaches |
| `site/rack/fit.js` | `isRackFace`; a rack-face branch of `fits`; rack devices against managers; `availableDepth` ignores managers |
| `site/rack/managers.js` (new) | `hostAt`, `managersOf`, `placement`, `settleManagers`, `moveItem` |
| `site/rack/export-data.js` | `mountOf`/`mountPick` for rack-face; `managerNotes`; `perFaceItems`; `deviceImportRows` |
| `site/rack/exports.js` | manager notes on sheets, draw.io and BOM; BOM hardware |
| `site/rack/elevation.js` | managers drawn last; the far face only when free; gutter marker; pointer events |
| `site/rack/manager-panel.js` (new) | the host's "Cable managers" rows; the manager's inspector |
| `site/rack/picker.js` | rack-face tag; an `onlyMount` filter |
| `site/rack/drag.js` | preview uses `placement` for a manager |
| `site/rack-page.js` | place, patch, load and remove through managers.js; panels |
| `site/rack3d.js` | rack-face depth placement; invisible sheet box; `guideAnchor` |
| `tests/rack/managers.test.mjs` (new) | managers.js |
| `tests/rack/fit.test.mjs`, `model.test.mjs`, `export-data.test.mjs`, `bom.test.mjs`, `dcim.test.mjs` | new cases |
| `check-browser.py` | `check_rack_face_managers` |

---

### Task 1: Refresh the vendored snapshot, and index what managers need

**Files:**
- Modify: `chassis-index.py`
- Modify: `check-contract.py` (near line 1206, beside the existing `chassis.json` check)
- Regenerated: `assets/dist/**`, `vendor/**`, `site/rack/chassis.json`

**Interfaces:**
- Produces: `chassis.json` entries may carry:
  - `shell: 'sheet'`;
  - `capacity: {count: number, basis: string}`;
  - `guides: {front?: string[], rear?: string[]}`;
  - `passes: {front?: string[], rear?: string[]}`.
- For `fhd-cmp5dr`: `{ru: 1, mount: 'rack-face', shell: 'sheet', d: 110, ...}`.

- [ ] **Step 1: Check that nobody else is syncing.** The live checkout is shared, and another session may be refreshing assets. Look for open PRs touching `assets/dist`:

```bash
gh pr list -R roc-ops/portrayal-site --search "assets in:title" --state open
```

If one is open, coordinate through the merge agent before continuing.

- [ ] **Step 2: Update and build the upstream clone.** Never build from `/Volumes/External/Network-Device-Visualization`; `refresh-assets.sh` refuses it.

```bash
cd /Volumes/External/portrayal-upstream && git checkout main && git pull && ./build.sh
```

Expected: the build ends without error, and `library/dist/fhd-cmp5dr.configs.json` exists.

- [ ] **Step 3: Write the failing contract check.** In `check-contract.py`, after the `chassis.json matches assets/dist` check, add:

```python
# RACK-FACE MANAGERS (docs/superpowers/specs/2026-10-07-rack-face-managers-design.md §3):
# the catalog holds the first one, as a 1U sheet part on the rail face, and the
# vendored relief can build a sheet body - without it the part is a solid block
# hiding the ports it serves.
_cat = json.loads((HERE / "site" / "rack" / "chassis.json").read_text())["devices"]
_mgr = _cat.get("fhd-cmp5dr", {})
check(_mgr.get("mount") == "rack-face" and _mgr.get("ru") == 1 and _mgr.get("shell") == "sheet",
      "fhd-cmp5dr is in the catalog as a 1U rack-face sheet part",
      "rebuild /Volumes/External/portrayal-upstream from main and run ./refresh-assets.sh")
check("sheetShell" in (HERE / "vendor" / "relief.js").read_text(),
      "the vendored relief.js builds sheet bodies",
      "run ./refresh-assets.sh against an upstream main that has #827")
```

- [ ] **Step 4: Run it to see it fail.**

```bash
python3 check-contract.py 2>&1 | grep -E "fhd-cmp5dr|sheet bodies"
```

Expected: both lines FAIL.

- [ ] **Step 5: Index the new fields.** In `chassis-index.py`:
  - add `import xml.etree.ElementTree as ET` beside the other imports;
  - add this function above `build()`.

```python
def marked(path):
    """The ids a route can pass through on one compiled face: elements carrying
    `data-guide` (a ring on a component, a duct rect) and pass-throughs
    (`data-class="pass"`). Empty until upstream's guides and passes land."""
    if not path.is_file():
        return [], []
    root = ET.parse(path).getroot()
    guides = sorted({e.get("id") for e in root.iter() if e.get("data-guide") and e.get("id")})
    passes = sorted({e.get("id") for e in root.iter() if e.get("data-class") == "pass" and e.get("id")})
    return guides, passes
```

Then, inside the loop in `build()`, after the `mount` block, add:

```python
        # a sheet body (rack3d.js hides its box), the vendor's stated cable
        # capacity, and the ids a route can pass through (spec §3): each only
        # when the device has it, so the file barely grows
        entry = out[d["name"]]
        if c.get("shell"):
            entry["shell"] = c["shell"]
        perf = (idx.get("attrs") or {}).get("performance") or {}
        if perf.get("cable-capacity") is not None:
            entry["capacity"] = {"count": perf["cable-capacity"], "basis": perf.get("cable-capacity-basis", "")}
        for view in ("front", "rear"):
            g, p = marked(DIST / f"{d['name']}.{idx.get('default')}.{view}.svg")
            if g:
                entry.setdefault("guides", {})[view] = g
            if p:
                entry.setdefault("passes", {})[view] = p
```

- [ ] **Step 6: Refresh and re-index.**

```bash
./refresh-assets.sh && ./chassis-index.py
python3 -c "import json;print(json.load(open('site/rack/chassis.json'))['devices']['fhd-cmp5dr'])"
```

Expected: the entry shows `'mount': 'rack-face'`, `'ru': 1`, `'shell': 'sheet'` and `'d': 110.0`. `capacity`, `guides` and `passes` appear only if `cm-brush-passes` / `cm-guides` have merged upstream. Write in the PR body which ones are present.

- [ ] **Step 7: Inspect the manager's front drawing for Task 5.** Record what paints:

```bash
grep -o '<[a-z]* [^>]*\(id\|data-ref\)="[^"]*"' assets/dist/fhd-cmp5dr.*.front.svg | head -40
```

Note the ids of the rings (expected `guide-1` to `guide-5`, as component instances with `data-ref`) and whether any full-size background rect exists. Task 5 relies on the rings carrying `data-ref`.

- [ ] **Step 8: Run all checks.**

```bash
python3 check-contract.py && node --test tests/*/*.test.mjs
```

Expected: everything passes. If the refresh broke unrelated checks, stop and report: that is a sync problem, not this feature.

- [ ] **Step 9: Commit.**

```bash
git add chassis-index.py check-contract.py site/rack/chassis.json assets vendor
git commit -m "sync: refresh from Portrayal main for the FHD-CMP5DR; index shell, capacity, guides, passes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The rack file holds managers (version 2)

**Files:**
- Modify: `site/rack/model.js`
- Test: `tests/rack/model.test.mjs`

**Interfaces:**
- Produces:
  - `VERSION === 2`;
  - `withItem(rack, {..., on?, unit?})`;
  - `detached(item) -> item` without `on`/`unit`;
  - `withoutItem(rack, id)` also detaches managers on `id`;
  - items read by `parseDoc` keep `on` (string) and `unit` (integer of 1 or more).

- [ ] **Step 1: Write the failing tests.** Append to `tests/rack/model.test.mjs`:

```js
test('version 2: a version-1 file opens unchanged, and a manager keeps its host', () => {
  const v1 = {format: 'portrayal-rack', version: 1, racks: [{id: 'r1', name: 'A', frame: {kind: 'four-post'},
    items: [{id: 'i1', ref: 'as7726-32x', cfg: 'x', ru: 20, face: 'front'}], zeroU: [], cables: []}]};
  const d = M.parseDoc(v1);
  assert.equal(d.version, 2);
  assert.equal(d.racks[0].items[0].on, undefined);
  const v2 = {...v1, version: 2, racks: [{...v1.racks[0], items: [...v1.racks[0].items,
    {id: 'i2', ref: 'fhd-cmp5dr', cfg: 'x', ru: 20, face: 'front', on: 'i1', unit: 1}]}]};
  const m = M.parseDoc(v2).racks[0].items[1];
  assert.deepEqual([m.on, m.unit, m.ru], ['i1', 1, 20]);
});

test('a newer file than this page knows is refused with a sentence', () => {
  assert.throws(() => M.parseDoc({format: 'portrayal-rack', version: 3, racks: [{}]}),
    /version 3; this page reads up to version 2/);
});

test('a malformed host or unit is dropped on load, not guessed at', () => {
  const d = M.parseDoc({format: 'portrayal-rack', version: 2, racks: [{frame: {}, items: [
    {id: 'i1', ref: 'fhd-cmp5dr', cfg: 'x', ru: 3, face: 'front', on: '', unit: 0}], cables: []}]});
  const it = d.racks[0].items[0];
  assert.equal('on' in it, false);
  assert.equal('unit' in it, false);
});

test('removing a host leaves its managers in place, unhosted', () => {
  let r = M.newRack();
  ({rack: r} = M.withItem(r, {ref: 'as7726-32x', cfg: 'x', ru: 20}));
  ({rack: r} = M.withItem(r, {ref: 'fhd-cmp5dr', cfg: 'x', ru: 20, on: 'i1', unit: 1}));
  const after = M.withoutItem(r, 'i1');
  assert.equal(after.items.length, 1);
  assert.deepEqual(after.items[0].ru, 20);
  assert.equal('on' in after.items[0], false);
  assert.equal('unit' in after.items[0], false);
});
```

- [ ] **Step 2: Run them to see them fail.**

```bash
node --test tests/rack/model.test.mjs
```

Expected: the four new tests FAIL (version is 1; `on` is not read).

- [ ] **Step 3: Implement.** In `site/rack/model.js`:

```js
export const VERSION = 2;
// MIGRATIONS[n - 1] takes a version-n document to version n + 1.
//   1 -> 2: rack-face managers (`on`, `unit` on an item). Nothing in a
//   version-1 file changes; the bump is so an older page refuses a file
//   holding a manager instead of drawing it as a 1U device over its host.
export const MIGRATIONS = [d => ({...d, version: 2})];
```

Replace `withItem` so it takes and keeps a host:

```js
export function withItem(rack, {ref, cfg, ru, face = 'front', turned = false, label = ref,
                                swaps = {}, fields = {}, on, unit}) {
  const item = {id: nextId(itemIdsInUse(rack), 'i'), ref, cfg, label, ru,
                face: face === 'rear' ? 'rear' : 'front', turned: !!turned,
                swaps: {...swaps}, fields: structuredClone(fields), ...hostOf({on, unit})};
  return {rack: {...rack, items: [...rack.items, item]}, item};
}
```

Add above `withItem`:

```js
// A RACK-FACE MANAGER'S HOST (spec §4): `on` names the item it bolts over and
// `unit` which of that item's units, from 1 at its bottom. Both or neither;
// settleManagers (managers.js) is what checks them against the catalog.
const hostOf = ({on, unit}) => (typeof on === 'string' && on && Number.isInteger(unit) && unit >= 1
  ? {on, unit} : {});
export const detached = ({on, unit, ...rest}) => rest;
```

Replace `withoutItem`:

```js
// A manager on the removed item stays where it is, unhosted (spec D3): it
// bolts to the rack, not to the device.
export const withoutItem = (rack, id) => ({...rack, items: rack.items.filter(i => i.id !== id)
  .map(i => (i.on === id ? detached(i) : i))});
```

In `readItem`, add `...hostOf({on: i.on == null ? undefined : String(i.on), unit: i.unit})` to the returned object, after `fields`.

- [ ] **Step 4: Run the tests.**

```bash
node --test tests/*/*.test.mjs
```

Expected: everything passes. If an older test asserted `version: 1` literally, change it to `M.VERSION`. Do not change what it checks.

- [ ] **Step 5: Commit.**

```bash
git add site/rack/model.js tests/rack/model.test.mjs
git commit -m "rack: the file is version 2, and an item can name the device it bolts over

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Where a manager may go, and how it moves

**Files:**
- Modify: `site/rack/fit.js`
- Create: `site/rack/managers.js`
- Test: `tests/rack/fit.test.mjs`, create `tests/rack/managers.test.mjs`

**Interfaces:**
- Consumes: `withItem`, `withoutItem`, `detached`, `uLabel` from model.js (Task 2).
- Produces:
  - from `fit.js`: `isRackFace(chassis) -> boolean`; `fits(rack, {ref, ru, face, on?, unit?}, chassisOf, {ignoreId})` with rack-face rules.
  - from `managers.js`:
    - `hostAt(rack, face, ru, chassisOf, {ignoreId}) -> item | null`;
    - `managersOf(rack, hostId) -> item[]`;
    - `placement(rack, {face, ru}, chassisOf, {ignoreId}) -> {face, ru, on?, unit?}`;
    - `settleManagers(rack, chassisOf) -> {rack, notices: string[]}`;
    - `moveItem(rack, id, patch, chassisOf) -> {ok: true, rack} | {ok: false, reason}`.

- [ ] **Step 1: Write the failing fit tests.** In `tests/rack/fit.test.mjs`, add `'fhd-cmp5dr': {ru: 1, h: 44, d: 110, mount: 'rack-face', shell: 'sheet'}` and `'deep-1u': {ru: 1, h: 44, d: 800}` to `SIZES`, then append:

```js
const mgr = (rack, ru, face = 'front', extra = {}) =>
  M.withItem(rack, {ref: 'fhd-cmp5dr', cfg: 'x', ru, face, label: `MGR${ru}${face[0]}`, ...extra}).rack;

test('rack-face: one manager per U per face; the other face is free', () => {
  const r = mgr(M.newRack(), 20);
  assert.equal(F.fits(r, {ref: 'fhd-cmp5dr', ru: 20, face: 'front'}, chassisOf).reason, 'Taken by MGR20f on the front.');
  assert.deepEqual(F.fits(r, {ref: 'fhd-cmp5dr', ru: 20, face: 'rear'}, chassisOf), {ok: true});
});

test('rack-face: a manager and a rack device share a U, either way round', () => {
  const r = place(M.newRack(), 'as7726-32x', 20);
  assert.deepEqual(F.fits(r, {ref: 'fhd-cmp5dr', ru: 20, face: 'front', on: 'i1', unit: 1}, chassisOf), {ok: true});
  assert.deepEqual(F.fits(mgr(M.newRack(), 20), {ref: 'as7726-32x', ru: 20, face: 'front'}, chassisOf), {ok: true});
});

test('rack-face: past the top is refused', () => {
  assert.equal(F.fits(M.newRack(), {ref: 'fhd-cmp5dr', ru: 43, face: 'front'}, chassisOf).reason,
    'U43 is past the top of this 42U rack.');
});

test('rack-face: a rear manager is refused where a front device reaches past the rear rail', () => {
  const r = place(M.newRack(), 'deep-1u', 10);     // 800 mm > 740 rail depth
  assert.equal(F.fits(r, {ref: 'fhd-cmp5dr', ru: 10, face: 'rear'}, chassisOf).reason,
    'DEEP-1U is 800 mm deep and reaches past the rear rail; a rear manager here would hit it.');
  assert.equal(F.fits(mgr(M.newRack(), 10, 'rear'), {ref: 'deep-1u', ru: 10, face: 'front'}, chassisOf).reason,
    '800 mm deep; it would reach past the rear rail into MGR10r.');
});

test('rack-face: two-post rails pass every body, so a rear manager needs an empty U', () => {
  const r = place(M.newRack({kind: 'two-post'}), 'tm-280', 5);
  assert.match(F.fits(r, {ref: 'fhd-cmp5dr', ru: 5, face: 'rear'}, chassisOf).reason, /reaches past the rear rail/);
  assert.deepEqual(F.fits(r, {ref: 'fhd-cmp5dr', ru: 6, face: 'rear'}, chassisOf), {ok: true});
});

test('rack-face: a host is a rack device on the same face, and the unit is within its height', () => {
  const r = place(M.newRack(), 'r740xd', 10);      // 2U, front
  assert.equal(F.fits(r, {ref: 'fhd-cmp5dr', ru: 12, face: 'front', on: 'i1', unit: 3}, chassisOf).reason,
    'R740XD is 2U; there is no unit 3 on it.');
  assert.equal(F.fits(r, {ref: 'fhd-cmp5dr', ru: 10, face: 'rear', on: 'i1', unit: 1}, chassisOf).reason,
    'R740XD is on the front; a manager on it goes on the front too.');
});

test('availableDepth ignores managers: they stand outside the rails', () => {
  const r = mgr(place(M.newRack(), 'as7726-32x', 20), 20, 'rear');
  assert.equal(F.availableDepth(r, r.items[0], chassisOf), r.frame.usableDepth);
});

test('shrinkRack moves a hosted manager with its host, and drops it with its host', () => {
  let r = place(M.newRack(), 'as7726-32x', 30);
  r = mgr(r, 30, 'front', {on: 'i1', unit: 1});
  const {rack: s} = F.shrinkRack(r, 10, chassisOf);
  assert.deepEqual(s.items.map(i => i.ru), [1, 1]);
  r = place(place(M.newRack(), 'tm-280', 1), 'as7726-32x', 2);
  r = mgr(r, 1, 'front', {on: 'i1', unit: 1});
  const {rack: t, removed} = F.shrinkRack(r, 1, chassisOf);
  assert.deepEqual(removed.map(i => i.id).sort(), ['i1', 'i3']);
  assert.deepEqual(t.items.map(i => i.id), ['i2']);
});
```

The last shrink case works because the manager and the TM-280 at U1 form the bottom cluster, which is dropped first. Check that against `shrinkRack`'s bottom-first rule when you run it.

- [ ] **Step 2: Run them to see them fail.**

```bash
node --test tests/rack/fit.test.mjs
```

Expected: the new tests FAIL. For example, the manager is refused as "Taken by AS7726-32X on the front."

- [ ] **Step 3: Implement the fit rules.** In `site/rack/fit.js`, under `REACH_MM`, add:

```js
// A RACK-FACE PART (spec §5): bolted to the rail face at a U, projecting
// outward - forward of the front rails, or behind the rear ones. It takes no
// U, so rack devices never collide with it, except a device deep enough to
// come out through the far rail into a manager there.
export const isRackFace = c => c?.mount === 'rack-face';
// The depth between the rails a body must exceed to come out of the far one:
// two-post rails are one plane, so any body does.
const between = f => (f.kind === 'two-post' ? 0 : f.railDepth);

function fitsRackFace(rack, cand, c, chassisOf, {ignoreId = null} = {}) {
  const f = rack.frame, rd = between(f);
  if (cand.ru < 1) return {ok: false, reason: 'Below U1.'};
  if (cand.ru > f.heightRU) return {ok: false, reason: `U${cand.ru} is past the top of this ${f.heightRU}U rack.`};
  if (cand.face === 'rear' && rd + c.d > f.usableDepth)
    return {ok: false, reason: `${mm(c.d)} mm out from the rear rail; this rack allows ${mm(f.usableDepth - rd)} mm there.`};
  if (cand.on != null) {
    const host = rack.items.find(i => i.id === cand.on), hc = host && chassisOf(host.ref);
    if (!host || isRackFace(hc)) return {ok: false, reason: 'A cable manager goes on a rack device.'};
    const hu = Math.max(1, hc?.ru ?? 1);
    if (!(Number.isInteger(cand.unit) && cand.unit >= 1 && cand.unit <= hu))
      return {ok: false, reason: `${host.label} is ${hu}U; there is no unit ${cand.unit} on it.`};
    if (host.face !== cand.face)
      return {ok: false, reason: `${host.label} is on the ${host.face}; a manager on it goes on the ${host.face} too.`};
  }
  for (const o of rack.items) {
    if (o.id === ignoreId) continue;
    const oc = chassisOf(o.ref);
    if (!oc || !overlaps([cand.ru, cand.ru], span(o, chassisOf))) continue;
    if (isRackFace(oc)) {
      if (o.face === cand.face) return {ok: false, reason: `Taken by ${o.label} on the ${o.face}.`};
      continue;
    }
    if (o.face !== cand.face && oc.d > rd)
      return {ok: false, reason: `${o.label} is ${mm(oc.d)} mm deep and reaches past the ${cand.face} rail; ` +
                                 `a ${cand.face} manager here would hit it.`};
  }
  return {ok: true};
}
```

In `fits`:
- right after `if (!c) return ...`, add `if (isRackFace(c)) return fitsRackFace(rack, cand, c, chassisOf, {ignoreId});`
- inside the loop, after `if (!oc || !overlaps(...)) continue;`, add:

```js
    if (isRackFace(oc)) {
      if (o.face !== cand.face && c.d > between(f))
        return {ok: false, reason: `${mm(c.d)} mm deep; it would reach past the ${o.face} rail into ${o.label}.`};
      continue;
    }
```

In `availableDepth`, change the `other` filter to also require `!isRackFace(chassisOf(o.ref))`.

- [ ] **Step 4: Run the fit tests.**

```bash
node --test tests/rack/fit.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Write the failing managers tests.** Create `tests/rack/managers.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../../site/rack/model.js';
import * as G from '../../site/rack/managers.js';

const SIZES = {'as7726-32x': {ru: 1, h: 43.5, d: 515}, 'r740xd': {ru: 2, h: 86.8, d: 737.5},
               'fhd-cmp5dr': {ru: 1, h: 44, d: 110, mount: 'rack-face', shell: 'sheet'}};
const chassisOf = ref => SIZES[ref] || null;
const add = (rack, ref, ru, extra = {}) => M.withItem(rack, {ref, cfg: 'x', ru, label: extra.label ?? ref, ...extra}).rack;

test('placement: on a device on that face it attaches; elsewhere it stands alone', () => {
  const r = add(M.newRack(), 'r740xd', 10, {label: 'srv'});
  assert.deepEqual(G.placement(r, {face: 'front', ru: 11}, chassisOf), {face: 'front', ru: 11, on: 'i1', unit: 2});
  assert.deepEqual(G.placement(r, {face: 'rear', ru: 11}, chassisOf), {face: 'rear', ru: 11});
  assert.deepEqual(G.placement(r, {face: 'front', ru: 12}, chassisOf), {face: 'front', ru: 12});
});

test('placement never hosts a manager on another manager', () => {
  const r = add(M.newRack(), 'fhd-cmp5dr', 10);
  assert.equal(G.hostAt(r, 'front', 10, chassisOf), null);
});

test('moveItem: a host carries its managers, both of a 2U host by one U', () => {
  let r = add(M.newRack(), 'r740xd', 10, {label: 'srv'});
  r = add(r, 'fhd-cmp5dr', 10, {on: 'i1', unit: 1});
  r = add(r, 'fhd-cmp5dr', 11, {on: 'i1', unit: 2});
  const m = G.moveItem(r, 'i1', {ru: 11}, chassisOf);
  assert.equal(m.ok, true);
  assert.deepEqual(m.rack.items.map(i => i.ru), [11, 11, 12]);
});

test('moveItem: a host is refused when a manager of its would collide, and nothing changes', () => {
  let r = add(M.newRack(), 'as7726-32x', 10, {label: 'leaf'});
  r = add(r, 'fhd-cmp5dr', 10, {on: 'i1', unit: 1, label: 'mgr-a'});
  r = add(r, 'fhd-cmp5dr', 20, {label: 'mgr-b'});
  const m = G.moveItem(r, 'i1', {ru: 20}, chassisOf);
  assert.deepEqual(m, {ok: false, reason: 'mgr-a moves with it: Taken by mgr-b on the front.'});
});

test('moveItem: a manager dropped on a device attaches, and dropped on empty space detaches', () => {
  let r = add(M.newRack(), 'as7726-32x', 10);
  r = add(r, 'fhd-cmp5dr', 30);
  const on = G.moveItem(r, 'i2', {ru: 10, face: 'front'}, chassisOf);
  assert.deepEqual([on.rack.items[1].on, on.rack.items[1].unit], ['i1', 1]);
  const off = G.moveItem(on.rack, 'i2', {ru: 5}, chassisOf);
  assert.equal('on' in off.rack.items[1], false);
});

test('settleManagers: a missing host detaches; a stale ru follows the host; a non-manager loses on', () => {
  const rack = {...M.newRack(), items: [
    {id: 'i1', ref: 'as7726-32x', cfg: 'x', label: 'leaf', ru: 12, face: 'front', turned: false, swaps: {}, fields: {}},
    {id: 'i2', ref: 'fhd-cmp5dr', cfg: 'x', label: 'mgr-1', ru: 9, face: 'front', turned: false, swaps: {}, fields: {}, on: 'i1', unit: 1},
    {id: 'i3', ref: 'fhd-cmp5dr', cfg: 'x', label: 'mgr-2', ru: 30, face: 'front', turned: false, swaps: {}, fields: {}, on: 'i9', unit: 1},
    {id: 'i4', ref: 'r740xd', cfg: 'x', label: 'srv', ru: 1, face: 'front', turned: false, swaps: {}, fields: {}, on: 'i1', unit: 1}]};
  const {rack: s, notices} = G.settleManagers(rack, chassisOf);
  assert.equal(s.items[1].ru, 12);
  assert.equal('on' in s.items[2], false);
  assert.equal('on' in s.items[3], false);
  assert.deepEqual(notices, [
    'mgr-1 was out of step with leaf, so it moved to U12 with it.',
    'mgr-2: the device it was on is not in this rack, so it stays at U30 on its own.',
    'srv is not a cable manager, so it is not on another device.']);
});
```

- [ ] **Step 6: Run them to see them fail.**

```bash
node --test tests/rack/managers.test.mjs
```

Expected: FAIL with `Cannot find module`.

- [ ] **Step 7: Implement `site/rack/managers.js`.**

```js
// RACK-FACE MANAGERS (spec docs/superpowers/specs/2026-10-07-rack-face-managers-design.md).
// Pure, like fit.js: the rack, the change, and a chassisOf(ref) lookup. A
// manager is an item; `on` and `unit` say which device it bolts over, and its
// `ru` always says where it is. Everything that moves a manager or its host
// comes through here, so the two can never drift apart.

import {fits, isRackFace} from './fit.js';
import {detached, uLabel} from './model.js';

const unitsOf = (chassisOf, ref) => Math.max(1, chassisOf(ref)?.ru ?? 1);

// The rack device on `face` whose U span holds `ru` - what a manager placed
// there bolts over - or null. Never another manager.
export function hostAt(rack, face, ru, chassisOf, {ignoreId = null} = {}) {
  return rack.items.find(o => o.id !== ignoreId && o.face === face && !isRackFace(chassisOf(o.ref))
    && ru >= o.ru && ru <= o.ru + unitsOf(chassisOf, o.ref) - 1) ?? null;
}

export const managersOf = (rack, hostId) => rack.items.filter(i => i.on === hostId);

// Where a manager put at (face, ru) goes: onto the device there, or alone.
export function placement(rack, {face, ru}, chassisOf, {ignoreId = null} = {}) {
  const host = hostAt(rack, face, ru, chassisOf, {ignoreId});
  return host ? {face, ru, on: host.id, unit: ru - host.ru + 1} : {face, ru};
}

// THE RACK AS OPENED, MADE CONSISTENT (spec §4). parseDoc cannot see the
// catalog, so this is where a host is checked: every repair is a sentence.
export function settleManagers(rack, chassisOf) {
  const notices = [];
  const byId = new Map(rack.items.map(i => [i.id, i]));
  const items = rack.items.map(i => {
    if (!('on' in i)) return i;
    if (!isRackFace(chassisOf(i.ref))) {
      notices.push(`${i.label} is not a cable manager, so it is not on another device.`);
      return detached(i);
    }
    const host = byId.get(i.on);
    if (!host || isRackFace(chassisOf(host.ref)) || host.face !== i.face) {
      notices.push(`${i.label}: the device it was on is not in this rack, so it stays at U${uLabel(rack.frame, i.ru)} on its own.`);
      return detached(i);
    }
    const unit = Math.min(Math.max(1, i.unit), unitsOf(chassisOf, host.ref));
    const ru = host.ru + unit - 1;
    if (ru === i.ru && unit === i.unit) return i;
    notices.push(`${i.label} was out of step with ${host.label}, so it moved to U${uLabel(rack.frame, ru)} with it.`);
    return {...i, ru, unit};
  });
  return {rack: {...rack, items}, notices};
}

// ONE MOVE (a patch with `ru` and/or `face`), checked whole. A manager is
// re-hosted by where it lands. A rack device takes its managers with it: they
// are all moved first and then each is checked against the rack as it would
// be, so two managers of one host never refuse each other's old place.
export function moveItem(rack, id, patch, chassisOf) {
  const it = rack.items.find(i => i.id === id);
  const next = {...it, ...patch};
  if (isRackFace(chassisOf(it.ref))) {
    const placed = {...detached(next), ...placement(rack, next, chassisOf, {ignoreId: id})};
    const f = fits(rack, placed, chassisOf, {ignoreId: id});
    return f.ok ? {ok: true, rack: {...rack, items: rack.items.map(i => (i.id === id ? placed : i))}} : f;
  }
  const f = fits(rack, next, chassisOf, {ignoreId: id});
  if (!f.ok) return f;
  const moved = new Map(managersOf(rack, id).map(m => [m.id, {...m, face: next.face, ru: next.ru + m.unit - 1}]));
  const after = {...rack, items: rack.items.map(i => (i.id === id ? next : moved.get(i.id) ?? i))};
  for (const m of moved.values()) {
    const g = fits(after, m, chassisOf, {ignoreId: m.id});
    if (!g.ok) return {ok: false, reason: `${m.label} moves with it: ${g.reason}`};
  }
  return {ok: true, rack: after};
}
```

- [ ] **Step 8: Run the tests.**

```bash
node --test tests/*/*.test.mjs
```

Expected: PASS.

- [ ] **Step 9: Commit.**

```bash
git add site/rack/fit.js site/rack/managers.js tests/rack/fit.test.mjs tests/rack/managers.test.mjs
git commit -m "rack: where a cable manager may go, and a host that carries its managers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The page places, moves, opens and removes managers

**Files:**
- Create: `site/rack/manager-panel.js`
- Modify: `site/rack-page.js` (`place` ~181, `patchItem` ~195, `setDoc` ~258, `renderSide` ~739)
- Modify: `site/rack/picker.js` (`catalogPanel`), `site/rack/drag.js` (~line 65), `site/rack/export-data.js` (`mountOf`, `mountPick`)
- Test: `tests/rack/export-data.test.mjs`; the browser check in Task 8

**Interfaces:**
- Consumes: `placement`, `moveItem`, `settleManagers`, `hostAt` (Task 3); `isRackFace` (Task 3); `withItem`, `withoutItem`, `detached` (Task 2).
- Produces:
  - `managerRows({host, rack, chassisOf, onAdd(unit), onSelect(id), onRemove(id)}) -> Element`;
  - `managerInspector({item, rack, chassis, host, hostHere, onPatch, onDetach, onAttach, onSelectHost, onMove, onRemove, onExplore}) -> Element`;
  - `catalogPanel({..., onlyMount})`.
  - Element ids used by Task 8: `#mgrRows`, `#mgrAdd-<unit>`, `#mSelectHost`, `#mDetach`, `#mAttach`, `#mCapacity`.

- [ ] **Step 1: Write the failing unit test for the picker's words.** Append to `tests/rack/export-data.test.mjs`. Import `mountPick` and `mountText` if the file does not already.

```js
test('a rack-face part is placeable on the rail face, never "needs a shelf"', () => {
  assert.equal(mountText('rack-face'), null);
  assert.deepEqual(mountPick('rack-face'),
    {tag: '0U, rail face', fit: 'Fits here: it mounts on the rail face and takes no U of its own.'});
});
```

- [ ] **Step 2: Run it to see it fail.**

```bash
node --test tests/rack/export-data.test.mjs
```

Expected: FAIL. Today `mountText` returns "not a rack-mount device (rack-face), so it needs a shelf or bracket".

- [ ] **Step 3: Implement the words.** In `site/rack/export-data.js`:

```js
// A rack-face part (a 0U cable manager) bolts to the rails like a rack device:
// it needs no shelf, so it has no "needs" sentence - managerNotes says where it is.
const mountOf = mount => isRackMount({mount}) || mount === 'rack-face' ? null
  : MOUNTS[mount] ?? {tag: mount, what: `not a rack-mount device (${mount})`, where: 'a shelf or bracket'};
```

and at the top of `mountPick`:

```js
  if (mount === 'rack-face')
    return {tag: '0U, rail face', fit: 'Fits here: it mounts on the rail face and takes no U of its own.'};
```

Run the test again. Expected: PASS.

- [ ] **Step 4: Create `site/rack/manager-panel.js`.**

```js
// CABLE MANAGERS IN THE SIDE PANEL (spec §7): the rows a host shows, one per
// unit of the host, and the inspector a manager shows instead of a device's.
// Like inspector.js, it changes nothing itself: every action is a callback.

import {el} from './dom.js';

const button = (id, text, fn) => { const b = el('button', {type: 'button', id, text}); b.addEventListener('click', fn); return b; };

export function managerRows({host, rack, chassisOf, onAdd, onSelect, onRemove}) {
  const units = Math.max(1, chassisOf(host.ref)?.ru ?? 1);
  const rows = [];
  for (let unit = units; unit >= 1; unit--) {           // top first, as the rack reads
    const m = rack.items.find(i => i.on === host.id && i.unit === unit);
    const name = units > 1 ? `Unit ${unit}` : 'On this device';
    rows.push(el('li', {}, m
      ? [`${name}: ${m.label} `, button(`mgrSelect-${unit}`, 'Select', () => onSelect(m.id)),
         button(`mgrRemove-${unit}`, 'Remove', () => onRemove(m.id))]
      : [`${name}: none `, button(`mgrAdd-${unit}`, 'Add...', () => onAdd(unit))]));
  }
  return el('section', {class: 'rk-managers', id: 'mgrRows'},
            [el('h4', {text: `Cable managers on the ${host.face}`}), el('ul', {}, rows)]);
}

export function managerInspector({item, rack, chassis, host, hostHere, onPatch, onDetach, onAttach,
                                  onSelectHost, onMove, onRemove, onExplore}) {
  const err = el('p', {class: 'rk-error', role: 'alert'});
  const label = el('input', {id: 'iLabel', type: 'text', value: item.label});
  label.addEventListener('change', () => {
    const r = onPatch({label: label.value.trim() || item.ref});
    if (r && !r.ok) { err.textContent = r.reason; label.value = item.label; }
  });
  const cap = chassis?.capacity;
  const where = host ? `on ${host.label}, unit ${item.unit}` : 'on its own';
  return el('div', {class: 'rk-inspector'}, [
    el('h3', {text: item.label}),
    el('p', {class: 'rk-muted', text: `${chassis?.manufacturer ?? ''} ${chassis?.model ?? item.ref} · 0U cable manager, ` +
                                      `U${item.ru} ${item.face}, ${where}`.trim()}),
    el('label', {}, ['Label', label]),
    ...(cap ? [el('p', {id: 'mCapacity', class: 'rk-muted', text: `${cap.count} cables (${cap.basis})`})] : []),
    el('div', {class: 'rk-actions'}, [
      ...(host ? [button('mSelectHost', 'Select host', onSelectHost), button('mDetach', 'Detach', onDetach)]
               : hostHere ? [button('mAttach', `Attach to ${hostHere.label}`, onAttach)] : []),
      button('iExplore', 'Open in Explorer', onExplore),
      button('iMove', 'Move', onMove),
      button('iRemove', 'Remove', onRemove),
    ]),
    err,
  ]);
}
```

- [ ] **Step 5: Add a mount filter to the catalog.** In `site/rack/picker.js`, change the signature to `catalogPanel({entries, rack, face, ru, chassisOf, pick, onState, onPlace, onlyMount = null})`. Change the `live` line to:

```js
  const live = entries.filter(e => e.ru !== 0 && (!onlyMount || (e.mount ?? 'rack') === onlyMount));
```

and the `fitOf` line so a rack-face entry is checked where it would land:

```js
  const fitOf = new Map(live.map(e => [e.name, fits(rack, {ref: e.name, ...(e.mount === 'rack-face'
    ? placement(rack, {face, ru}, chassisOf) : {ru, face})}, chassisOf)]));
```

Import `placement` from `./managers.js`. Also check whether `catalogEntries` (chassis.js) spreads every index field, `mount` included. It does: `{name, ...e}`.

- [ ] **Step 6: Wire the page.** In `site/rack-page.js`:
  - add `import {placement, moveItem, settleManagers, hostAt} from './rack/managers.js';`
  - add `import {managerRows, managerInspector} from './rack/manager-panel.js';`
  - import `isRackFace` from `./rack/fit.js`;
  - import `detached` from `./rack/model.js`.

Replace `place`:

```js
function place(entry, cfg, face, ru) {
  const at = isRackFace(chassisOf(entry.name)) ? placement(rack(), {face, ru}, chassisOf) : {face, ru};
  const f = fits(rack(), {ref: entry.name, ...at}, chassisOf);
  if (!f.ok) { S.notice = {text: f.reason, kind: 'error'}; render(); return; }
  const {rack: next, item} = withItem(rack(), {ref: entry.name, cfg, ...at, label: entry.model || entry.name});
  S.sel = {kind: 'item', id: item.id};
  commit(next);
}
```

In `patchItem`, replace the `['ru', 'face']` block and the final `commit(updateItem(r, id, patch))` with:

```js
  if (['ru', 'face'].some(k => k in patch)) {
    // Through managers.js: a manager is re-hosted by where it lands, and a
    // host takes its managers with it (spec §5).
    const m = moveItem(r, id, patch, chassisOf);
    if (!m.ok) return m;
    commit(m.rack);
    return {ok: true};
  }
```

Keep the `cfg` notice block above it. Leave the final `commit(updateItem(r, id, patch)); return {ok: true};` in place for patches without `ru`/`face`.

In `setDoc`, before `S.doc = doc`, settle every rack and say what was repaired:

```js
  const notes = [];
  doc = {...doc, racks: doc.racks.map(r => { const s = settleManagers(r, chassisOf); notes.push(...s.notices); return s.rack; })};
```

After `S.dcimDraft = null;`, add `for (const n of notes) addNotice(n);`. `chassisOf` is set at boot (`bootInner`, ~line 999) before any document opens. Check that no `setDoc` call runs earlier: `grep -n "setDoc(" site/rack-page.js`.

In `renderSide`, the `'u'` branch: pass `onlyMount: sel.onlyMount ?? null` to `catalogPanel`.

In the final `else` branch, choose the panel by mount:

```js
    else if (isRackFace(chassisOf(it.ref))) {
      const host = it.on ? itemById(it.on) : null;
      const hostHere = host ? null : hostAt(r, it.face, it.ru, chassisOf);
      body = managerInspector({item: it, rack: r, chassis: chassisOf(it.ref), host, hostHere,
        onPatch: patch => patchItem(it.id, patch),
        onSelectHost: () => select({kind: 'item', id: host.id}),
        onDetach: () => commit(detachedRack(rack(), it.id)),
        onAttach: () => patchItem(it.id, {ru: it.ru, face: it.face}),
        onMove: () => select({kind: 'move', id: it.id}),
        onRemove: () => { if (confirm(`Remove ${it.label} from the rack?`)) { S.sel = null; commit(withoutItem(rack(), it.id)); } },
        onExplore: () => explore(it.id)});
    } else body = el('div', {}, [inspectorPanel({/* the existing arguments, unchanged */}),
      managerRows({host: it, rack: r, chassisOf,
        onAdd: unit => select({kind: 'u', face: it.face, ru: it.ru + unit - 1, onlyMount: 'rack-face'}),
        onSelect: id => select({kind: 'item', id}),
        onRemove: id => commit(withoutItem(rack(), id), {text: `Removed ${itemById(id).label}.`})})]);
```

Move the existing `inspectorPanel({...})` call, with its arguments exactly as they are, into that `el('div', ...)`. Add the helper near `patchItem`:

```js
// Detach: the manager keeps its U and loses its host (spec §7).
const detachedRack = (r, id) => ({...r, items: r.items.map(i => (i.id === id ? detached(i) : i))});
```

`onAttach` works because `moveItem` re-hosts a manager by where it is.

- [ ] **Step 7: Make the drag preview place managers as a drop would.** In `site/rack/drag.js`, import `isRackFace` from `./fit.js` and `placement` from `./managers.js`, and replace the `fits(...)` on line ~65 with:

```js
    const at = isRackFace(chassisOf(d.item.ref)) ? placement(r, {face, ru}, chassisOf, {ignoreId: d.id}) : {ru, face};
    const f = fits(r, {ref: d.item.ref, ...at}, chassisOf, {ignoreId: d.id});
```

The drop already goes through `patchItem`, and so through `moveItem`.

- [ ] **Step 8: Run unit tests and the existing rack browser checks.**

```bash
uptime
node --test tests/*/*.test.mjs
python3 check-browser.py --only check_rack_page,check_rack_elevation,check_rack_library
```

Expected: PASS. If `uptime` shows a load above the CPU count, find and stop the stray processes first.

- [ ] **Step 9: Commit.**

```bash
git add site/rack/manager-panel.js site/rack-page.js site/rack/picker.js site/rack/drag.js site/rack/export-data.js tests/rack/export-data.test.mjs
git commit -m "rack: place a cable manager on a device or a U, move it, detach it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Managers in the 2D elevation

**Files:**
- Modify: `site/rack/elevation.js` (`drawElevation`, ~line 145)
- Test: browser check in Task 8. This module needs a DOM, so it has no node test.

**Interfaces:**
- Consumes: items from `itemsWithU`, which carry `mount: 'rack-face'` and `u: 1` for managers.
- Produces:
  - a manager's `<g data-item-id data-panel="mounted">` drawn after every rack device on its face;
  - `[data-manager-mark="<id>"]`, a clickable gutter marker carrying `data-item-id`.

- [ ] **Step 1: Order and filter.** In `drawElevation`, replace the `order` line with:

```js
  // MANAGERS LAST (spec §6): a rack-face part bolts over its host, so it is
  // drawn after every device. On the other face it shows only where no
  // device spans its U - behind a device it is out of sight.
  const isFace = it => it.mount === 'rack-face';
  const spans = (o, u) => u >= o.ru && u <= o.ru + (o.u ?? 1) - 1;
  const shown = items.filter(it => !(isFace(it) && it.face !== view
                                     && items.some(o => !isFace(o) && spans(o, it.ru))));
  const rank = it => (it.face === view ? 1 : 0) + (isFace(it) ? 2 : 0);
  const order = [...shown].sort((a, b) => rank(a) - rank(b));
```

- [ ] **Step 2: Clicks go through a manager, except on its rings.** After `out.append(g);` add:

```js
    // A manager is mostly air: a click on its tray or ears is meant for the
    // host behind it. Its components (the rings) still take clicks (spec §7).
    if (isFace(it) && !through) {
      g.setAttribute('pointer-events', 'none');
      for (const part of g.querySelectorAll('[data-ref]')) part.setAttribute('pointer-events', 'visiblePainted');
    }
```

The rings are `data-ref` component instances. Task 1 Step 7 recorded this; if it did not, select the ring ids it recorded instead.

- [ ] **Step 3: The gutter marker.** After the loop, before `for (const [top, ruH] of rings)`, add:

```js
  // A U carrying a manager says so in the gutter: the manager itself is mostly
  // see-through. The marker is also how a click reaches it.
  for (const it of shown.filter(i => isFace(i) && i.face === view)) {
    const y0 = totalH - (it.ru - baseRU + 1) * RU;
    out.append(svgEl('path', {d: `M ${-RAIL_W - 5} ${y0 + 4} l 4 ${RU / 2 - 4} l -4 ${RU / 2 - 4} z`,
      fill: 'var(--pt-brass)', 'data-manager-mark': it.id, 'data-item-id': it.id,
      'data-device-name': it.label, style: 'cursor: pointer'}));
  }
```

- [ ] **Step 4: Look at it.** Start the server and, in the browser pane, open the rack page. Place an AS7726 at U20 front, then put an FHD-CMP5DR on it from the inspector's **Add...**.

```bash
python3 serve.py 8932
```

Then open `http://localhost:8932/rack.html`. Expected:
- the manager is drawn over the switch, and the switch's ports are visible between the rings;
- the brass marker sits in the gutter at U20;
- the rear pane shows no manager;
- clicking a ring selects the manager, and clicking between rings selects the switch.

Take a screenshot for the PR.

- [ ] **Step 5: Commit.**

```bash
git add site/rack/elevation.js
git commit -m "rack: a cable manager is drawn over its host, with a gutter mark, and clicks pass through it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Managers in the exports

**Files:**
- Modify: `site/rack/export-data.js` (`perFaceItems` ~292, `deviceImportRows` ~620; new `managerNotes`)
- Modify: `site/rack/exports.js` (`faceNotesFor` ~49, `bomCsv` ~651)
- Test: `tests/rack/export-data.test.mjs`, `tests/rack/dcim.test.mjs`, `tests/rack/bom.test.mjs`

**Interfaces:**
- Consumes: items from `itemsWithU` (with `mount`, `u`, and `on`/`unit` from Task 2).
- Produces: `managerNotes(items, chassisOf, frame) -> string[]`.

- [ ] **Step 1: Write the failing tests.** Append to `tests/rack/export-data.test.mjs`, importing `perFaceItems` and `managerNotes`:

```js
const FRAME = {heightRU: 42, numbering: 'bottom-up'};
const host = {id: 'i1', ref: 'as7726-32x', label: 'leaf-1', ru: 12, u: 1, face: 'front'};
const mgr = {id: 'i2', ref: 'fhd-cmp5dr', label: 'mgr-1', ru: 12, u: 1, face: 'front', mount: 'rack-face', on: 'i1', unit: 1};

test('perFaceItems: a manager is drawn last on its face, and hidden behind a device on the other', () => {
  const p = perFaceItems([mgr, host]);
  assert.deepEqual(p.front.map(i => i.id), ['i1', 'i2']);
  assert.deepEqual(p.rear.map(i => i.id), ['i1']);
  assert.deepEqual(p.hidden.map(h => [h.item.id, h.pane, h.by.id]), [['i2', 'rear', 'i1']]);
});

test('perFaceItems: a manager never hides a device', () => {
  const rear = {id: 'i3', ref: 'tm-280', label: 'demarc', ru: 12, u: 1, face: 'rear'};
  const p = perFaceItems([mgr, rear]);
  assert.equal(p.hidden.some(h => h.by.id === 'i2'), false);
});

test('managerNotes says what each manager is and where', () => {
  const of = ref => ({'fhd-cmp5dr': {manufacturer: 'FS.com', model: 'FHD-CMP5DR', mount: 'rack-face'}}[ref] ?? {});
  assert.deepEqual(managerNotes([host, mgr], of, FRAME), ['mgr-1: FS.com FHD-CMP5DR, 0U, on leaf-1 at U12, front.']);
});
```

Append to `tests/rack/dcim.test.mjs`. Reuse that file's existing `deviceImportRows` setup helpers for `types`, and copy the shape of its nearest existing test:

```js
test('a manager is a device row with no position and no face, and never knocks out its host', () => {
  const host = {id: 'i1', ref: 'as7726-32x', cfg: 'x', label: 'leaf-1', ru: 12, u: 1, face: 'front'};
  const mgr = {id: 'i2', ref: 'fhd-cmp5dr', cfg: 'x', label: 'mgr-1', ru: 12, u: 1, face: 'front', mount: 'rack-face', on: 'i1', unit: 1};
  const rack = {name: 'R', frame: {heightRU: 42, numbering: 'bottom-up'}};
  const rearDeep = {id: 'i3', ref: 'tm-280', cfg: 'x', label: 'demarc', ru: 12, u: 1, face: 'rear'};
  const types = new Map([['i1', {model: 'AS7726', manufacturer: 'Edgecore', isFullDepth: true}],
                         ['i2', {model: 'FHD-CMP5DR', manufacturer: 'FS.com', isFullDepth: false}],
                         ['i3', {model: 'TM-280', manufacturer: 'Telco', isFullDepth: true}]]);
  const {rows, left} = deviceImportRows({rack, items: [host, mgr], types, dcim: {site: 's', role: 'r'}});
  const m = rows.find(r => r.name === 'mgr-1');
  assert.deepEqual([m.position, m.face], ['', '']);
  assert.match(m.comments, /0U cable manager on the front rail face at U12, over leaf-1; NetBox has no field for that\./);
  assert.equal(left.length, 0);
  const two = deviceImportRows({rack, items: [rearDeep, mgr], types, dcim: {site: 's', role: 'r'}});
  assert.equal(two.left.length, 0);
});
```

Append to `tests/rack/bom.test.mjs` (import `bomRows` if needed):

```js
test('a hosted manager adds no rail hardware; an unhosted one counts its own U', () => {
  const frame = {holes: {style: 'square'}};
  const qty = railUs => bomRows({frame, railUs}).find(r => r.model === 'Cage nut, M6')?.qty ?? 0;
  assert.equal(qty([1]), 4);          // the host alone
  assert.equal(qty([1, 1]), 8);       // plus one unhosted manager
});
```

The BOM rule itself lives in `bomCsv`'s `railUs`, which Step 3 changes; this test pins the arithmetic it relies on.

- [ ] **Step 2: Run them to see them fail.**

```bash
node --test tests/rack/export-data.test.mjs tests/rack/dcim.test.mjs tests/rack/bom.test.mjs
```

Expected: the perFaceItems, managerNotes and DCIM tests FAIL.

- [ ] **Step 3: Implement.** In `site/rack/export-data.js`, replace `perFaceItems`:

```js
export function perFaceItems(items) {
  // A rack-face manager (spec §6) is drawn last on its own face, never hides
  // anything, and on the other face is hidden by any device spanning its U.
  const isFace = it => it.mount === 'rack-face';
  const out = {front: [], rear: [], hidden: []};
  for (const pane of ['front', 'rear']) {
    for (const it of items) {
      if (it.face === pane) { out[pane].push(it); continue; }
      const by = items.find(o => !isFace(o) && (isFace(it) || o.face === pane) && overlaps(o, it));
      if (by) out.hidden.push({item: it, pane, by});
      else out[pane].push(it);
    }
    out[pane].sort((a, b) => isFace(a) - isFace(b));      // stable: managers last
  }
  return out;
}
```

Add after `mountNotes`:

```js
// WHERE EACH MANAGER IS (spec §9), for the sheets, draw.io and the BOM.
export function managerNotes(items, chassisOf, frame) {
  const byId = new Map(items.map(i => [i.id, i]));
  return items.filter(i => chassisOf(i.ref)?.mount === 'rack-face').map(i => {
    const c = chassisOf(i.ref), host = i.on ? byId.get(i.on) : null;
    const what = [c.manufacturer, c.model].filter(Boolean).join(' ') || i.ref;
    return `${i.label}: ${what}, 0U, ${host ? `on ${host.label} ` : ''}at U${positionOf(frame, i.ru, 1)}, ${i.face}.`;
  });
}
```

In `deviceImportRows`:
- change the `clash` line so a manager is never in a clash:

```js
    const clash = target === 'nautobot' || it.mount === 'rack-face' ? null
      : kept.find(o => o.mount !== 'rack-face' && o.face !== it.face && overlaps(o, it) && (t.isFullDepth || types.get(o.id).isFullDepth));
```

- in the row builder, after the `turned` note:

```js
    const zeroU = it.mount === 'rack-face';
    if (zeroU) {
      const host = it.on ? items.find(o => o.id === it.on) : null;
      notes.push(`0U cable manager on the ${it.face} rail face at U${positionOf(rack.frame, it.ru, 1)}` +
                 `${host ? `, over ${names.get(host.id)?.name ?? host.label}` : ''}; ${T} has no field for that.`);
    }
```

- write `position: zeroU ? '' : position` and `face: zeroU ? '' : it.face` in both target objects.

Check that `dcimContext` builds `ctx.items` with `itemsWithU`, so `mount` is present: `grep -n "itemsWithU" site/rack/exports.js`.

In `site/rack/exports.js`:
- `faceNotesFor` (line ~50): add `...managerNotes(items, chassisOf, rack.frame)` after `...mountNotes(...)`, and import `managerNotes`.
- `bomCsv`: replace `railItems` and the hardware lines:

```js
  const railItems = items.filter(i => isRackMount(chassisOf(i.ref)));
  // A manager on a host shares the host's screws (spec D4); one on its own
  // bolts in with its own, like a 1U device.
  const managers = items.filter(i => i.mount === 'rack-face');
  const railUs = [...railItems.map(i => i.u), ...managers.filter(i => !i.on).map(() => 1)];
```

  - change `if (railItems.length) notes.push(...hardwareNotes(rack.frame));` to `if (railUs.length) ...`;
  - pass `railUs` to `bomRows`;
  - add `managerNotes(items, chassisOf, rack.frame)` to the `notes.unshift(...)`;
  - add, after it:

```js
  for (const m of managers.filter(i => i.on)) {
    const h = items.find(i => i.id === m.on);
    if (h) notes.push(`${m.label} shares ${h.label}'s rail screws; with two ears stacked, longer screws may be needed.`);
  }
```

- [ ] **Step 4: Run the tests.**

```bash
node --test tests/*/*.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Run the existing export browser checks, to catch a changed note or order.**

```bash
uptime
python3 check-browser.py --only check_rack_export_drawio,check_rack_export_device_csv,check_rack_export_dcim_types
```

Expected: PASS. The fixture has no manager, so nothing in it should change.

- [ ] **Step 6: Commit.**

```bash
git add site/rack/export-data.js site/rack/exports.js tests/rack/export-data.test.mjs tests/rack/dcim.test.mjs tests/rack/bom.test.mjs
git commit -m "rack: cable managers in the sheets, draw.io, the BOM and the DCIM kits

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Managers in 3D

**Files:**
- Modify: `site/rack3d.js` (the mount function ~line 625-700; `portAnchor` ~780; the returned API ~1046)
- Test: browser check in Task 8

**Interfaces:**
- Consumes: `entry.mount` and `entry.chassis.shell`, which `scene3d.js` already passes through `chassisOf`. After Task 1, `shell` is in `chassis.json`.
- Produces: `scene.guideAnchor({id}, elementId) -> {position, normal} | null`; the manager's group is named `device-<id>`.

- [ ] **Step 1: Place a rack-face body outside the rails.** In the mount function, replace the `group.position.set(...)` call with:

```js
    // A RACK-FACE PART (spec §8) has its mounting face on the rail plane and
    // its body outward: toward the viewer from the front rails, away from the
    // rear ones. A rack device's body goes the other way, between the rails.
    const rackFace = entry.mount === 'rack-face';
    const z = rackFace
      ? (face === 'rear' ? mountZ - D / 2 : mountZ + D / 2)
      : (face === 'rear' ? mountZ + RECESS + D / 2 : mountZ - RECESS - D / 2);
    group.position.set(0, (entry.ru - 1) * RU + H / 2, z);
```

The rotation line already turns a rear entry 180 degrees, which is right for a rear manager. `noEars` is already true for any mount but `rack`.

- [ ] **Step 2: A sheet body has no box.** Right after `const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), mats);`, add:

```js
    // A SHEET BODY HAS NO SIDES (upstream docs/cable-managers-design.md §4):
    // its views are elevations, so painting them on a box stands a picture of
    // the part on every side. The box stays, invisible, as the frame its relief
    // is built in - as kit/viewer3d.js does.
    const sheet = entry.chassis?.shell === 'sheet';
    if (sheet) for (const m of mats) m.visible = false;
```

In the relief pass, change `if (cv && body.material[i]) {` to `if (cv && body.material[i] && !sheet) {`, so a refined face never re-paints the invisible box.

- [ ] **Step 3: `guideAnchor`.** Refactor `portAnchor` so its element lookup is a parameter. Rename its body to `elementAnchor(which, find, o)`, where `find(doc) -> Element | null` replaces the `doc.svg.querySelector(\`[data-path=...]\`)` line. Then:

```js
  const portAnchor = (which, path, o = {}) => (path
    ? elementAnchor(which, doc => doc.svg.querySelector(`[data-path="${CSS.escape(path)}"]`), o) : Promise.resolve(null));
  // WHERE A NAMED PART OF A MANAGER IS (spec §8), for routing in piece 2: a
  // ring is `guide-1` to `guide-5` on the FHD-CMP5DR's front.
  const guideAnchor = (which, elementId, o = {view: 'front'}) =>
    elementAnchor(which, doc => doc.svg.getElementById?.(elementId) ?? doc.svg.querySelector(`#${CSS.escape(elementId)}`), o);
```

Keep `portAnchor`'s existing behavior exactly. Add `guideAnchor` to the object the scene returns, beside `portAnchor`.

- [ ] **Step 4: Look at it.** In the browser pane, with the Task 5 rack, switch to 3D. Expected:
- the FHD-CMP5DR stands in front of the switch's face;
- the switch's ports are visible through and between the rings;
- there is no black block.

Take a screenshot for the PR.

- [ ] **Step 5: Commit.**

```bash
git add site/rack3d.js
git commit -m "rack 3D: a cable manager stands outside the rails as a sheet, with guideAnchor for routing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The browser check, and the DCIM import on real instances

**Files:**
- Modify: `check-browser.py` (a new `@extra` after `check_rack_export_other_vendor`)

**Interfaces:**
- Consumes everything above. The probe API is `window.__rack.{ready, doc, replaceRack, scene}`.

- [ ] **Step 1: Write the check.**

```python
@extra("rack.html: a cable manager on a switch - drawn over it, clicked through to it, moved with it, and outside the rails in 3D")
def check_rack_face_managers(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    page.goto(f"{base}/rack.html?probe=1", wait_until="load")
    page.wait_for_function("() => window.__rack && window.__rack.ready", timeout=READY_MS)
    page.evaluate("() => window.__rack.ready")
    page.click('#rkMode [data-mode="2d"]')
    page.evaluate("""async () => {
      const M = await import('/site/rack/model.js'), C = await import('/site/rack/chassis.js');
      const cat = await C.loadChassis();
      let r = M.newRack({name: 'Managers'});
      ({rack: r} = M.withItem(r, {ref: 'as7726-32x', cfg: cat['as7726-32x'].default, ru: 20, label: 'leaf-1'}));
      ({rack: r} = M.withItem(r, {ref: 'fhd-cmp5dr', cfg: cat['fhd-cmp5dr'].default, ru: 20, label: 'mgr-1', on: 'i1', unit: 1}));
      window.__rack.replaceRack(r);
    }""")
    page.wait_for_selector('#paneFront svg [data-item-id="i2"][data-panel="mounted"]', timeout=READY_MS)
    order = page.evaluate("""() => {
      const s = document.querySelector('#paneFront svg');
      const h = s.querySelector('[data-item-id="i1"][data-panel="mounted"]'), m = s.querySelector('[data-item-id="i2"][data-panel="mounted"]');
      return !!(h.compareDocumentPosition(m) & Node.DOCUMENT_POSITION_FOLLOWING);
    }""")
    if not order:
        bad.append("2D: the manager is not drawn after its host")
    if not page.query_selector('#paneFront svg [data-manager-mark="i2"]'):
        bad.append("2D: no gutter mark for the manager")
    if page.query_selector('#paneRear svg [data-item-id="i2"]'):
        bad.append("2D: the manager shows on the rear, behind the switch")
    # A point over the manager whose top element belongs to the host: a gap.
    gap = page.evaluate("""() => {
      const m = document.querySelector('#paneFront svg [data-item-id="i2"]').getBoundingClientRect();
      for (let fx = 0.05; fx < 1; fx += 0.03) for (let fy = 0.2; fy < 0.9; fy += 0.2) {
        const x = m.left + m.width * fx, y = m.top + m.height * fy;
        if (document.elementFromPoint(x, y)?.closest('[data-item-id]')?.dataset.itemId === 'i1') return [x, y];
      }
      return null;
    }""")
    if not gap:
        bad.append("2D: no point over the manager reaches the switch behind it")
    else:
        page.mouse.click(*gap)
        if page.inner_text("#side h3") != "leaf-1":
            bad.append(f"2D: a click between the rings selected {page.inner_text('#side h3')!r}, not leaf-1")
    page.click('#paneFront svg [data-manager-mark="i2"]')
    if page.inner_text("#side h3") != "mgr-1":
        bad.append("2D: the gutter mark does not select the manager")
    page.click("#mSelectHost")
    if not page.query_selector("#mgrRows"):
        bad.append("inspector: the host shows no Cable managers section")
    page.click("#iMove")
    page.click('#paneFront svg [data-u="24"][data-face="front"]')
    items = page.evaluate("() => window.__rack.doc().racks[0].items.map(i => [i.id, i.ru, i.on ?? null])")
    if items != [["i1", 24, None], ["i2", 24, "i1"]]:
        bad.append(f"move: the manager did not follow its host: {items}")
    page.click('#rkMode [data-mode="3d"]')
    page.wait_for_function("() => window.__rack.scene() != null", timeout=READY_3D_MS)
    got = page.evaluate("""async () => {
      const s = window.__rack.scene(); await s.complete?.();
      const g = s.three.scene.getObjectByName('device-i2'), h = s.three.scene.getObjectByName('device-i1');
      const face = s.metrics().faceZ;
      const box = g.children.find(c => c.isMesh && Array.isArray(c.material));
      const a = await s.guideAnchor({id: 'i2'}, 'guide-1');
      return {mgrZ: g.position.z, hostZ: h.position.z, face, hidden: box.material.every(m => !m.visible), anchor: !!a};
    }""")
    if not (got["mgrZ"] > got["face"] > got["hostZ"]):
        bad.append(f"3D: the manager is not in front of the rails ({got})")
    if not got["hidden"]:
        bad.append("3D: the manager's sheet body is drawn as a solid box")
    if not got["anchor"]:
        bad.append("3D: guideAnchor finds no guide-1 on the manager")
    return bad
```

If `#side h3` or `#rkMode [data-mode=...]` differ in `rack.html`, use the real selectors. `check_rack_export_3d` uses the mode buttons the same way.

- [ ] **Step 2: Run it.**

```bash
uptime
python3 check-browser.py --only check_rack_face_managers
```

Expected: PASS. A 3D timeout with a high load average is machine load: stop the stray processes and rerun before debugging the page.

- [ ] **Step 3: Reproduce in the CI-sized container if it is slow.** CI runs on 2 CPUs. If the check passes locally but is close to its timeouts, run it in a `--cpus=2` Playwright container. See the memory note "CI repro: 2-CPU container".

- [ ] **Step 4: Verify the DCIM kits on real instances.** Export the NetBox and the Nautobot kit for a rack with one hosted and one unhosted FHD-CMP5DR. Then import them with `tools/dcim-verify/` into the NetBox 4.7 and Nautobot 3.2.6 test instances, following each kit's README.
  - Load credentials in a subshell from `~/.config/portrayal/dcim-verify.env`. Never print them.
  - Expected: both managers are created in the rack with no position, and every other row lands as before.
  - If either target refuses a blank position or face for a 0U device, stop. Record the exact error in the PR, and bring it back to the user: the fix changes the spec's §9.

- [ ] **Step 5: Full local run.**

```bash
node --test tests/*/*.test.mjs && python3 check-contract.py && python3 check-browser.py
```

Expected: PASS.

- [ ] **Step 6: Commit, update the specs' status, and open the PR.** Set the rack-face spec's **Status** line to "implemented (plan: docs/superpowers/plans/2026-10-07-rack-face-managers.md)". Add the same note to the Rack Builder spec's status line.

```bash
git add check-browser.py docs/superpowers/specs/2026-10-07-rack-face-managers-design.md docs/superpowers/specs/2026-09-26-rack-builder-design.md
git commit -m "check: a cable manager on a switch, in 2D, in the inspector, moved, and in 3D

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin HEAD
```

Open the PR with `gh pr create`. In the body:
- what the snapshot refresh brought in, from Task 1 Step 6;
- the 2D and 3D screenshots;
- the DCIM verification result.

End the body with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Then run a code review, and message the "Portrayal-site merge agent" to land it. Do not merge it yourself.
