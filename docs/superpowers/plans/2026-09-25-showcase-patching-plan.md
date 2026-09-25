# Showcase stages 4–5: patching plan and hanging cables, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stages 4 (Cable) and 5 (Filter) keep the rack built in stages 0–3, now with an AS4630-54TE top-of-rack switch. They cable it with a 14-cable example plan through the FHD-1UFCE patch panel, as hanging cables that land on real connectors in 2D and 3D.

**Architecture:**
- `site/showcase/patching.json` holds the plan: devices, the seats it needs, and links.
- `site/showcase/plan.js` loads the plan and applies its seats to `rack.js`'s shared `overrides` under the fill rule.
- `site/showcase/cables.js` owns the endpoints, the sag, the colors and the drawing, for both SVG and three.js.
- `site/showcase/patch-view.js` is the stage body that stages 4 and 5 share: 2D with a Front/Rear toggle, or 3D.
- `rack3d.js` gains `cableAnchor` and `deviceBoxes`.
- `ring.js` and `ring2d.js` are retired.

**Tech stack:** vanilla ES modules (no npm or bundler), three.js through the page's import map, the Portrayal kit vendored in `vendor/` (`swap.js`, `relief.js`). The tests are `check-contract.py` (static checks over the files and the compiled dist) and `check-browser.py` (a Playwright walk).

**Spec:** `docs/superpowers/specs/2026-09-25-showcase-patching-plan-design.md`

## Global Constraints

- **Never touch ports 8177/8178**: they are the user's servers on the live checkout. Work only in the worktree.
- **Never edit `vendor/` or `assets/dist/`**: they are the vendored upstream snapshot. Never change `.gitignore:26`. Never run a bare `git stash`.
- **Every write after an `await` in a stage path checks `ui.live()` first.** This is the stage lease (`stage-rail.js`); this defect class has recurred in every round.
- **R11:** a stage builds its panel whether or not 3D mounted. Without WebGL the panel still works and says 3D is unavailable.
- **2D is the default mode.** The walk's 2D reset must keep holding.
- **Contract:** every check in `check-contract.py` records on every run. Use the file's `check(cond, what, detail)` and never skip a check behind an `if`; record a FAIL instead.
- **Running `check-browser.py`:** run it in the FOREGROUND with an explicit Bash timeout of at least 600000 ms (the 120 s default backgrounds it). Save the output to a file and read it; never pipe it through `tail`.
- **Throwaway Playwright proofs** run in both WebGL and forced-no-WebGL modes. Don't commit them.
- **Prose** is American English (color, center, fiber). Upstream Portrayal writes British ("fibre"); quote its identifiers as they are.
- **Honesty:** the stage 4 and 5 panels lead with *"An example patching plan for this rack, not a real lab."*
- **Commit messages** end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Findings since the spec

I probed these in a browser against `rack.js`'s `build2dElevation`. They are binding.

- **F1: a boot can't be seated by overrides.**
  - The kit's swap path seats plugs into an optic's cages (`port-1-occupant/tx`), but it never chains a boot onto a plug. `swap.js`'s `builtOccupants` says so: "a chained tier is the build's business; the kit swaps cages". A `…-occupant/tx-occupant` key seats nothing.
  - **Ruling:** the plan seats **plugs only**. `cablePoints` then returns each plug's own point, which is its documented behavior when no boot is seated.
  - The spec's "plus boot" is dropped. Boots come back when the kit gains chained swaps, a follow-up upstream issue for the controller to raise with the user.
- **F2: seat keys are drawing paths below a bay.** All confirmed, as `rack.js` overrides:
  - device cage: `port-1`; plug in its optic: `port-1-occupant/tx`, `…/rx`;
  - card slot: `slot-2`; the card's cage: `slot-2/module/p0`; plug: `slot-2/module/p0-occupant/tx`;
  - FHD adapter: `bay-1/module/lc1` (the module-less `bay-1/lc1` does NOT seat).
- **F3: `cablePoints(root)` paths.**
  - An optic's plugs: `port-1-occupant/tx-occupant` and `…/rx-occupant`.
  - A duplex plug in an FHD adapter: `bay-1/module/lc1-occupant/a` and `…/b`.
  - So the connectors of the end `[dev, P]` are the points whose path starts with `P + '-occupant/'`.
  - `at` is in the marker's own frame; map it through `p.el.getScreenCTM()`.
  - `cablePoints` works on any root, so pass the device's `<g data-device-ref>` to keep paths unique per device.
- **F4: the AS4630 only seats once it is in `CAST`.** Its cage ids are `port-49` to `port-52` (SFP) and `port-53`/`port-54` (QSFP28, accepting `generic/qsfp-lc@1`), but `loadMeta` indexes cast devices only.
- **F5: the 3D curve.** Each hanging stretch uses the normalized catenary `f(t) = (cosh(k(2t−1)) − cosh k)/(cosh k − 1)` with `k = 1.2`, scaled by the sag. That is a real catenary shape, with no solver.

---

## File structure

| File | Responsibility |
|---|---|
| `site/showcase/rack.js` (modify) | `CAST` gains `eps201`; comments |
| `site/showcase/patching.json` (create) | The plan: devices, seats, 14 links |
| `site/showcase/plan.js` (create) | `loadPlan`, `applyPlanSeats` (the fill rule), `planSeatsMade`, `looseReason`, `countsBy`, `endView`, `isFiber` |
| `site/showcase/cables.js` (create) | Colors, sag, `ends2d`, `drawCables2d`, `hangPoints3d`, `drawCables3d` |
| `site/showcase/patch-view.js` (create) | Shared stage body: seats, the 2D Front/Rear view with tags and hover, 3D tubes, panel pieces |
| `site/rack3d.js` (modify) | `cableAnchor(which, prefix, o)`, `deviceBoxes()` |
| `site/showcase/stages/04-cable.js` (rewrite) | Stage 4 on `patch-view.js` |
| `site/showcase/stages/05-filter.js` (rewrite) | Stage 5 on `patch-view.js`, with filters from the plan |
| `site/showcase/ring.js`, `ring2d.js` (delete) | Retired in Task 5 |
| `site/site.css` (modify) | Cable hover and ghost styles; drop the ring styles |
| `check-contract.py`, `check-browser.py` (modify) | Per task |

---

### Task 1: The AS4630-54TE joins the cast

**Files:**
- Modify: `site/showcase/rack.js` (the `CAST` at about line 43, and the cast comment above it)
- Modify: `check-contract.py` (the cast section at about lines 338–375)
- Modify: `check-browser.py` (`len(cast) != 4` at about line 528, and the Inspect coverage at about 522–530 and 706–708)

**Interfaces:**
- Produces: `CAST` with five entries in this order: `asr-9006`, `r740xd`, `eps201`, `as7726-32x`, `fhd-1ufce`. `eps201` is `{ref: 'eps201', cfg: 'ac-f2b', label: 'AS4630-54TE'}`.

- [ ] **Step 1: Write the failing contract check.** In `check-contract.py`, after the block that builds `cast` (just after the `for ref, cfg in cast:` loop), add:

```python
# THE CAST IS FIVE, BOTTOM-UP, AND THE COPPER SWITCH SITS BETWEEN THE SERVER
# AND THE 100G SWITCH (patching spec §3). Stage 4's plan cables the server and
# every management port to it, so a cast without it has nowhere to land them.
check([r for r, _ in cast] == ["asr-9006", "r740xd", "eps201", "as7726-32x", "fhd-1ufce"],
      "the cast is the five patched devices, bottom-up",
      f"CAST is {[r for r, _ in cast]}")
check(dict(cast).get("eps201") == "ac-f2b",
      "the AS4630-54TE is cast front-to-back, matching the AS7726-32X",
      f"eps201 cfg is {dict(cast).get('eps201')!r}")
```

- [ ] **Step 2: Run it and see it fail.** Run `python3 check-contract.py`. Expected: `FAILED` on "the cast is the five patched devices".

- [ ] **Step 3: Add the device.** In `site/showcase/rack.js`, make `CAST`:

```js
export const CAST = [
  {ref: 'asr-9006',   cfg: 'base',             label: 'ASR-9006'},
  {ref: 'r740xd',     cfg: 'sff24-rc5-1b2a3a', label: 'R740xd'},
  {ref: 'eps201',     cfg: 'ac-f2b',           label: 'AS4630-54TE'},
  {ref: 'as7726-32x', cfg: 'ac-f2b',           label: 'AS7726-32X'},
  {ref: 'fhd-1ufce',  cfg: 'populated',       label: 'FHD-1UFCE'},
];
```

Extend the cast comment above it with one sentence: *"the AS4630-54TE is the copper top-of-rack switch stage 4's plan lands the server and every management port on, uplinked to the AS7726-32X over its two QSFP28 ports."* Also change the phrase "four devices" in the `check-contract.py` cast comment to "five devices".

- [ ] **Step 4: Update the browser walk for five devices.** In `check-browser.py`, replace `if len(cast) != 4:` and its message with:

```python
    if len(cast) != 5:
        bad.append(f"inspect frame: could not read the five cast configurations from rack.js ({cast})")
```

In the Inspect section, the walk proves all cast devices open on their cast config through `opened_on_cast`, and the `set(cast) - opened_on_cast` check will now demand `eps201` too. Add an Inspect open for it next to the AS7726 Callouts → Inspect step, using the helpers already in that section:

```python
        # The fifth cast device: the copper top-of-rack switch.
        page.click('.stage-rail button[data-stage="populate"]')
        page.wait_for_selector('[data-stage-ready="populate"]', timeout=READY_MS)
        page.click('[data-spoke-device="eps201"][data-spoke-lens="inspect"]')
        page.wait_for_selector('#lensFrame iframe', state="visible", timeout=READY_3D_MS)
        explorer_frame("eps201")
        page.click('#spokeBack')
        page.wait_for_selector('[data-stage-ready="populate"]', timeout=READY_MS)
```

Update the comments that say "all four" to "all five".

- [ ] **Step 5: Run both suites.**
  - Run `python3 check-contract.py`. Expected: `contract: N checks passed`, with N = the previous count + 2.
  - Run `python3 check-browser.py > "$SCRATCH/t1-browser.txt" 2>&1` with a Bash timeout of 600000 ms, then read the file. Expected: `browser: 15 checks passed`.
  - Any stage whose own claim hardcodes a device count fails here. Fix the claim to read the count from `CAST`, never from a literal.

- [ ] **Step 6: Commit.**

```bash
git add site/showcase/rack.js check-contract.py check-browser.py
git commit -m "showcase: the AS4630-54TE joins the cast as the copper top-of-rack switch

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The plan file, its seats, and the fill rule

**Files:**
- Create: `site/showcase/patching.json`
- Create: `site/showcase/plan.js`
- Modify: `check-contract.py` (a new `# ── the patching plan ──` section, before `# ── report ──`)
- Modify: `check-browser.py` (a page-context probe step, run once after the stage walk)

**Interfaces:**
- Consumes: `CAST` (Task 1), `overrides` and `shortRef` from `rack.js`.
- Produces, in `plan.js`:
  - `loadPlan(): Promise<Plan>`;
  - `applyPlanSeats(plan, overrides): {made: Seat[], kept: Kept[]}`, where `Seat = {dev, key, ref}` and `Kept = {dev, key, ref, have}`;
  - `planSeatsMade(): Seat[]`, every seat any call has made in this page's life;
  - `looseReason(plan, kept, end): string`;
  - `countsBy(plan, field): Map<string, number>`;
  - `endView(end): 'front' | 'rear'`;
  - `isFiber(link): boolean`.
- Plan shape: `{name, title, description, devices: [{id, ref}], seats: {dev: {key: ref}}, links: [{media, purpose, from: End, to: End}]}`, where `End = [dev, path]` or `[dev, path, 'rear']`.

- [ ] **Step 1: Write the plan file.** Create `site/showcase/patching.json` with exactly this content. Seats are listed parents before children; `applyPlanSeats` relies on that order.

```json
{
  "name": "showcase-rack",
  "title": "Example patching plan for the showcase rack",
  "description": "Invented for the showcase, not a real lab: fourteen cables through the FHD-1UFCE patch panel and the AS4630-54TE top-of-rack switch. Every end is proven against the compiled faces by check-contract.py.",
  "devices": [
    {"id": "asr-9006", "ref": "asr-9006"},
    {"id": "r740xd", "ref": "r740xd"},
    {"id": "eps201", "ref": "eps201"},
    {"id": "as7726-32x", "ref": "as7726-32x"},
    {"id": "fhd-1ufce", "ref": "fhd-1ufce"}
  ],
  "seats": {
    "asr-9006": {
      "slot-0": "cisco/a9k-rsp880-se@1",
      "slot-1": "cisco/a9k-rsp880-se@1",
      "slot-2": "cisco/a9k-16x100ge-tr@1",
      "slot-2/module/p0": "generic/qsfp-lc@1",
      "slot-2/module/p0-occupant/tx": "generic/lc-plug@2",
      "slot-2/module/p0-occupant/rx": "generic/lc-plug@2",
      "slot-2/module/p1": "generic/qsfp-lc@1",
      "slot-2/module/p1-occupant/tx": "generic/lc-plug@2",
      "slot-2/module/p1-occupant/rx": "generic/lc-plug@2",
      "slot-2/module/p2": "generic/qsfp-lc@1",
      "slot-2/module/p2-occupant/tx": "generic/lc-plug@2",
      "slot-2/module/p2-occupant/rx": "generic/lc-plug@2",
      "slot-2/module/p3": "generic/qsfp-lc@1",
      "slot-2/module/p3-occupant/tx": "generic/lc-plug@2",
      "slot-2/module/p3-occupant/rx": "generic/lc-plug@2"
    },
    "eps201": {
      "port-53": "generic/qsfp-lc@1",
      "port-53-occupant/tx": "generic/lc-plug@2",
      "port-53-occupant/rx": "generic/lc-plug@2",
      "port-54": "generic/qsfp-lc@1",
      "port-54-occupant/tx": "generic/lc-plug@2",
      "port-54-occupant/rx": "generic/lc-plug@2"
    },
    "as7726-32x": {
      "port-1": "generic/qsfp-lc@1",
      "port-1-occupant/tx": "generic/lc-plug@2",
      "port-1-occupant/rx": "generic/lc-plug@2",
      "port-2": "generic/qsfp-lc@1",
      "port-2-occupant/tx": "generic/lc-plug@2",
      "port-2-occupant/rx": "generic/lc-plug@2",
      "port-29": "generic/qsfp-lc@1",
      "port-29-occupant/tx": "generic/lc-plug@2",
      "port-29-occupant/rx": "generic/lc-plug@2",
      "port-30": "generic/qsfp-lc@1",
      "port-30-occupant/tx": "generic/lc-plug@2",
      "port-30-occupant/rx": "generic/lc-plug@2",
      "port-31": "generic/qsfp-lc@1",
      "port-31-occupant/tx": "generic/lc-plug@2",
      "port-31-occupant/rx": "generic/lc-plug@2",
      "port-32": "generic/qsfp-lc@1",
      "port-32-occupant/tx": "generic/lc-plug@2",
      "port-32-occupant/rx": "generic/lc-plug@2"
    },
    "fhd-1ufce": {
      "bay-1/module/lc1": "generic/lc-duplex-plug@2",
      "bay-1/module/lc2": "generic/lc-duplex-plug@2",
      "bay-2/module/lc1": "generic/lc-duplex-plug@2",
      "bay-2/module/lc2": "generic/lc-duplex-plug@2"
    }
  },
  "links": [
    {"media": "os2", "purpose": "uplink", "from": ["as7726-32x", "port-1"], "to": ["fhd-1ufce", "bay-1/module/lc1"]},
    {"media": "os2", "purpose": "uplink", "from": ["as7726-32x", "port-2"], "to": ["fhd-1ufce", "bay-1/module/lc2"]},
    {"media": "os2", "purpose": "uplink", "from": ["asr-9006", "slot-2/module/p0"], "to": ["fhd-1ufce", "bay-2/module/lc1"]},
    {"media": "os2", "purpose": "uplink", "from": ["asr-9006", "slot-2/module/p1"], "to": ["fhd-1ufce", "bay-2/module/lc2"]},
    {"media": "os2", "purpose": "core", "from": ["as7726-32x", "port-31"], "to": ["asr-9006", "slot-2/module/p2"]},
    {"media": "os2", "purpose": "core", "from": ["as7726-32x", "port-32"], "to": ["asr-9006", "slot-2/module/p3"]},
    {"media": "os2", "purpose": "core", "from": ["eps201", "port-53"], "to": ["as7726-32x", "port-29"]},
    {"media": "os2", "purpose": "core", "from": ["eps201", "port-54"], "to": ["as7726-32x", "port-30"]},
    {"media": "copper", "purpose": "server", "from": ["r740xd", "ndc/module/port-1", "rear"], "to": ["eps201", "port-1"]},
    {"media": "copper", "purpose": "server", "from": ["r740xd", "ndc/module/port-2", "rear"], "to": ["eps201", "port-2"]},
    {"media": "copper", "purpose": "management", "from": ["as7726-32x", "mgmt-eth"], "to": ["eps201", "port-45"]},
    {"media": "copper", "purpose": "management", "from": ["asr-9006", "slot-0/module/mgt-lan-0"], "to": ["eps201", "port-46"]},
    {"media": "copper", "purpose": "management", "from": ["asr-9006", "slot-1/module/mgt-lan-0"], "to": ["eps201", "port-47"]},
    {"media": "copper", "purpose": "management", "from": ["r740xd", "idrac9", "rear"], "to": ["eps201", "port-48"]}
  ]
}
```

- [ ] **Step 2: Write the failing contract checks.** In `check-contract.py`, add a new section before `# ── report ──`. It resolves every end against the compiled dist, and against the component skin of the card the plan seats when the end is below a seated bay. Seats are checked against the `accepts` of the cage they fill.

```python
# ── the patching plan (stages 4-5) ───────────────────────────────────────
# An INVENTED plan, labelled as such, whose every end is proven here against
# the compiled faces - that is what keeps "invented" from becoming "made up".
PLAN = HERE / "site" / "showcase" / "patching.json"
plan = None
try:
    plan = json.loads(PLAN.read_text())
except Exception as e:
    check(False, "patching.json parses", str(e))
comps = {f"{c['ns']}/{c['name']}@{c['major'][1:]}": c
         for c in json.loads((DIST / "components.json").read_text())["components"]}

def face_text(dev, view):
    idx = json.loads((DIST / f"{dev}.configs.json").read_text())
    cfg = dict(cast).get(dev) or idx.get("default")
    for name in (f"{dev}.{cfg}.{view}.svg", f"{dev}.{view}.svg"):
        if (DIST / name).is_file():
            return (DIST / name).read_text()
    return ""

def skin_text(ref):
    ns, rest = ref.split("/")
    name, major = rest.split("@")
    hits = sorted((DIST / "components").glob(f"{ns}--{name}--v{major}--*.svg"))
    return hits[0].read_text() if hits else ""

def port_on(text, path):
    """A port element with that data-path, carrying a connection point."""
    m = re.search(r'<g [^>]*data-path="%s"[^>]*data-class="port"[^>]*>' % re.escape(path), text)
    if not m:
        return False
    tail = text[m.end():m.end() + 4000]
    return "data-cp=" in tail

def resolves(dev, path, view, seats):
    if "/module/" in path:                       # below a bay: the seated card's skin
        bay, rest = path.split("/module/", 1)
        ref = seats.get(dev, {}).get(bay)
        if not ref:
            return False
        return port_on(skin_text(ref), f"{comps[ref]['name']}/{rest}") or port_on(skin_text(ref), rest)
    return port_on(face_text(dev, view), path)

if plan:
    seats = plan.get("seats", {})
    cast_refs = [r for r, _ in cast]
    check(all(d["id"] in cast_refs and d["ref"] == d["id"] for d in plan.get("devices", [])),
          "every plan device is a cast device", str(plan.get("devices")))
    links = plan.get("links", [])
    check(len(links) == 14, "the plan has its fourteen cables", f"{len(links)}")
    bad_ends = [e for l in links for e in (l["from"], l["to"])
                if not resolves(e[0], e[1], e[2] if len(e) > 2 else "front", seats)]
    check(not bad_ends, "every plan end is a drawn port with a connection point", str(bad_ends))
    check(all(l.get("media") in ("os2", "copper") for l in links),
          "every link's media is os2 or copper", str({l.get("media") for l in links}))
    check(all(l.get("purpose") in ("uplink", "core", "server", "management") for l in links),
          "every link names its purpose", str({l.get("purpose") for l in links}))
    # A fiber end is a connector the plan seats: an optic with its two plugs,
    # or a duplex plug in an adapter. Every seat must be one its cage accepts.
    def cage_accepts(dev, key):
        idx = json.loads((DIST / f"{dev}.configs.json").read_text())
        dev_cages = {c["id"]: c for v in (idx.get("cages") or {}).values() for c in v}
        bays = {b["id"]: b for v in (idx.get("bays") or {}).values() for b in v}
        if key in dev_cages: return dev_cages[key].get("accepts") or []
        if key in bays: return bays[key].get("accepts") or []
        if "-occupant/" in key:                  # a plug in an optic's cage
            host, bore = key.rsplit("-occupant/", 1)
            opt = seats.get(dev, {}).get(host)
            return next((c.get("accepts") or [] for c in comps.get(opt, {}).get("cages") or []
                         if c.get("id") == bore), [])
        if "/module/" in key:                    # a card's or cassette's own cage
            bay, rest = key.split("/module/", 1)
            card = seats.get(dev, {}).get(bay)
            if not card:                         # the cast config's own module (the FHD's cassettes)
                cfg = next(c for c in idx["configs"] if c["name"] == dict(cast)[dev])
                card = (cfg.get("bays") or {}).get(bay)
            return next((c.get("accepts") or [] for c in comps.get(card, {}).get("cages") or []
                         if c.get("id") == rest), [])
        return []
    refused = [(d, k, r) for d, ss in seats.items() for k, r in ss.items() if r not in cage_accepts(d, k)]
    check(not refused, "every plan seat is one its cage or bay accepts", str(refused))
    fiber_unseated = [e for l in links if l["media"] == "os2" for e in (l["from"], l["to"])
                      if e[1] not in seats.get(e[0], {})]
    check(not fiber_unseated, "every fiber end seats a connector", str(fiber_unseated))
else:
    for what in ("every plan device is a cast device", "the plan has its fourteen cables",
                 "every plan end is a drawn port with a connection point",
                 "every plan seat is one its cage or bay accepts", "every fiber end seats a connector"):
        check(False, what, "patching.json is missing or unreadable")
```

`DIST` and `json` already exist in `check-contract.py`; confirm them with `grep -n "^DIST\|^import" check-contract.py`, and define `DIST = HERE / "assets" / "dist"` if it is absent.

- [ ] **Step 3: Run it and see it fail.** Run `python3 check-contract.py`. Expected: FAILs on "patching.json parses" and on the five checks in the `else` branch.

  **If "every plan end is a drawn port with a connection point" still fails once the file exists:** print `bad_ends` and fix the PATH in `patching.json` against the compiled face. Never weaken `port_on`. The paths above were read off the dist on 2026-09-25, but for card ports the skin prefixes its own name (`a9k-16x100ge-tr/p0`), which is why `resolves` tries both forms.

- [ ] **Step 4: Write `plan.js`.** Create `site/showcase/plan.js`:

```js
// The patching plan stages 4 and 5 cable (patching.json), and the one rule for
// applying its seats to the rack. The plan is INVENTED - the panel says so -
// and check-contract.py proves every end against the compiled faces.
//
// THE FILL RULE (spec §4.3). A plan seat is applied only where the rack holds
// nothing of the visitor's: no override at that key. A key the visitor set,
// to anything other than the plan's ref (a different card, or null for a bay
// emptied in the Inspect lens), is KEPT, and nothing under it is the plan's to
// fill - its cables become loose ends, and looseReason says why.

import {shortRef} from './rack.js';

let memo = null;
export async function loadPlan() {
  if (memo) return memo;
  const r = await fetch(new URL('./patching.json', import.meta.url));
  if (!r.ok) throw new Error(`patching.json: HTTP ${r.status}`);
  memo = await r.json();
  return memo;
}

export const endView = end => end[2] || 'front';
export const isFiber = link => link.media !== 'copper';

const made = [];
export const planSeatsMade = () => made.slice();

// Is `key` below `parent` - a card's cage under its slot, a plug under its optic?
const below = (key, parent) => key.startsWith(parent + '/') || key.startsWith(parent + '-occupant');

export function applyPlanSeats(plan, overrides) {
  const now = [], kept = [];
  for (const [dev, seats] of Object.entries(plan.seats || {})) {
    const ov = overrides[dev] = overrides[dev] || {};
    const blocked = [];
    for (const [key, ref] of Object.entries(seats)) {       // the file lists parents first
      if (blocked.some(b => below(key, b))) continue;
      if (!Object.hasOwn(ov, key)) {
        ov[key] = ref;
        const s = {dev, key, ref};
        now.push(s); made.push(s);
      } else if (ov[key] !== ref) {
        kept.push({dev, key, ref, have: ov[key]});
        blocked.push(key);
      }
    }
  }
  return {made: now, kept};
}

// Why an end did not land, from what the fill rule kept - never a guess.
export function looseReason(plan, kept, [dev, path]) {
  const k = kept.find(x => x.dev === dev && (path === x.key || below(path, x.key)));
  if (k) return `${dev} ${k.key} holds ${k.have ? shortRef(k.have) : 'nothing'}, not the plan's ${shortRef(k.ref)} — seat it in stage 2 to connect this cable`;
  return `${dev} ${path} is not on the drawing`;
}

// {value -> count} for a link field (media, purpose), in first-seen order:
// derived from the plan, so a new value shows up with its own count.
export function countsBy(plan, field) {
  const m = new Map();
  for (const l of plan.links || []) m.set(l[field], (m.get(l[field]) || 0) + 1);
  return m;
}
```

- [ ] **Step 5: Add a browser probe that proves the seats land.** In `check-browser.py`, after the stage walk (next to the other page-context checks), add:

```python
    # THE PLAN'S SEATS LAND (patching Task 2): applied to a fresh overrides map,
    # every fiber end shows its connectors on the 2D elevation - 2 per optic
    # end, 2 per duplex adapter end - read through relief.js's cablePoints, the
    # kit's own reading, scoped to each device's group.
    got = page.evaluate("""async () => {
        const R = await import('/site/showcase/rack.js');
        const P = await import('/site/showcase/plan.js');
        const {cablePoints} = await import('/vendor/relief.js');
        await R.loadMeta();
        const plan = await P.loadPlan();
        const ov = {};
        const {made, kept} = P.applyPlanSeats(plan, ov);
        const svg = await R.build2dElevation({stack: R.CAST.filter(e => e.ru != null),
                                              heightRU: R.RACK_U, overrides: ov});
        svg.style.cssText = 'position:fixed;left:0;top:0;width:10px;height:10px;opacity:0';
        document.body.append(svg);
        const short = [];
        for (const l of plan.links.filter(P.isFiber)) for (const [dev, path] of [l.from, l.to]) {
            const g = svg.querySelector(`[data-device-ref="${dev}"]`);
            const n = g ? cablePoints(g).filter(p => p.path.startsWith(path + '-occupant/')).length : 0;
            if (n !== 2) short.push(`${dev}:${path}=${n}`);
        }
        svg.remove();
        return {made: made.length, kept: kept.length, short};
    }""")
    if got["kept"] or got["short"] or not got["made"]:
        bad.append(f"plan seats: made {got['made']}, kept {got['kept']}, ends without two connectors {got['short']}")
```

The probe imports modules into the walk's page but never touches the stage's own `overrides`; it writes a fresh map. Place it after the stage walk anyway, so no stage entry is running while it builds.

- [ ] **Step 6: Run both suites.**
  - Contract: all pass.
  - Browser, foreground with a 600000 ms timeout, output to a file: `browser: 15 checks passed`, or 16 if you counted the probe as its own check. Follow the file's counting.
  - Then make the probe fail on purpose: change one `lc-plug` seat's key to `…-occupant/xx`, confirm the walk reports it, and revert.

- [ ] **Step 7: Commit.**

```bash
git add site/showcase/patching.json site/showcase/plan.js check-contract.py check-browser.py
git commit -m "showcase: the example patching plan, its seats and the fill rule

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `cables.js` and stage 4 in 2D

**Files:**
- Create: `site/showcase/cables.js`
- Create: `site/showcase/patch-view.js`
- Rewrite: `site/showcase/stages/04-cable.js`. Delete the old 2D and 3D bodies; 3D becomes a "coming in Task 4" branch that mounts the rack with seats and builds the panel.
- Modify: `site/site.css` (cable hover styles), `check-contract.py`, `check-browser.py`

**Interfaces:**
- Consumes:
  - `loadPlan`, `applyPlanSeats`, `planSeatsMade`, `looseReason`, `countsBy`, `endView`, `isFiber` (Task 2);
  - `CAST`, `RACK_U`, `loadMeta`, `overrides`, `build2dElevation`, `mount3d`, `chassisOf`, `shortRef`, `enqueueRebuild` (`rack.js`);
  - `panZoom`, `el`, `svgEl`, `title`, `lead`, `kv`, `stageRack`, `stage3d` (`artifact.js`).
- Produces, in `cables.js`:
  - `COLORS`, `colorOf(link)`, `sag2d(dist, fan)`;
  - `ends2d(svg, dev, path, fiber) -> [[x, y], ...] | null`;
  - `drawCables2d(svg, plan, view, {edgeX}) -> Drawn[]`, where `Drawn = {link, i, g: SVGGElement | null, loose: string[] /* 'from' | 'to' */, tagged: boolean}`.
- Produces, in `patch-view.js`:
  - `enterPatched(ui, {title, question, onDrawn, extraPanel}) -> Promise<Handle | null>`, where `Handle = {mode, plan, drawn: Drawn[] | Tube[], setView(view), highlight(i | null), dispose()}`;
  - `panelHead(plan, seats) -> Node[]`;
  - `legendFor(plan) -> Node`.

- [ ] **Step 1: Write the failing contract checks.** Add to the patching section in `check-contract.py`:

```python
CAB = HERE / "site" / "showcase" / "cables.js"
cab = CAB.read_text() if CAB.is_file() else ""
check("export function drawCables2d" in cab and "cablePoints" in cab,
      "cables.js draws 2D cables from the kit's cablePoints", "missing")
s4 = (HERE / "site" / "showcase" / "stages" / "04-cable.js").read_text()
check("ring.js" not in s4 and "ring2d.js" not in s4 and "labs.json" not in s4 and "loadLab" not in s4,
      "stage 4 no longer reads the ROADM ring", "04-cable.js still imports the ring")
check("not a real lab" in (HERE / "site" / "showcase" / "patch-view.js").read_text()
      if (HERE / "site" / "showcase" / "patch-view.js").is_file() else False,
      "the patched stages say the plan is invented", "no honesty line in patch-view.js")
check(not re.search(r"#[0-9a-fA-F]{6}", s4),
      "stage 4 keeps no colors of its own", "colors belong to cables.js")
```

Run it. Expected: 4 FAILs.

- [ ] **Step 2: Write `cables.js`, the 2D half.** Create `site/showcase/cables.js`:

```js
// Cables that hang. One module for both views, so the sag and the colors
// cannot differ between 2D and 3D (spec §5).
//
// WHERE A CABLE STARTS. A fiber end is a connector the plan seated - an LC
// plug in each of an optic's two cages, or a duplex plug in a cassette's
// adapter - and the kit's relief.js cablePoints() names the point each one
// leaves from. Its `at` is in the marker's own frame, so it is mapped through
// the marker's CTM (relief.js says to). A copper end has no plug to seat yet
// (roc-ops/Portrayal#610): it starts at the jack's center.

import {cablePoints} from '../../vendor/relief.js';
import {svgEl} from './artifact.js';

// OS2 jackets are yellow; copper is colored by what it is for.
export const COLORS = {os2: '#e8c547', copper: {server: '#5aa7ff', management: '#9aa3ad'}};
export const colorOf = l => l.media === 'copper'
  ? (COLORS.copper[l.purpose] || COLORS.copper.server) : (COLORS[l.media] || COLORS.os2);

export const WIDTH = 3;          // mm: a patch lead, to scale
const MERGE = 10;                // mm below a duplex pair where the two strands join
// How far a cable hangs below the lower of its two ends: a little always, more
// the farther apart they are, and a few mm more per cable already hung between
// the same two devices, so parallel runs fan out instead of stacking.
export const sag2d = (dist, fan = 0) => 14 + 0.3 * dist + 5 * fan;

const esc = s => (window.CSS && CSS.escape ? CSS.escape(s) : String(s));

export function ends2d(svg, dev, path, fiber) {
  const g = svg.querySelector(`[data-device-ref="${esc(dev)}"]`);
  if (!g) return null;
  const inv = svg.getScreenCTM().inverse();
  if (fiber) {
    const pre = `${path}-occupant/`;
    const pts = cablePoints(g).filter(p => p.at && p.path.startsWith(pre));
    if (!pts.length) return null;
    return pts.map(p => {
      const q = new DOMPoint(p.at[0], p.at[1]).matrixTransform(inv.multiply(p.el.getScreenCTM()));
      return [q.x, q.y];
    }).sort((a, b) => a[0] - b[0]);
  }
  const port = g.querySelector(`[data-path="${esc(path)}"]`);
  if (!port) return null;
  const b = port.getBoundingClientRect();
  const c = new DOMPoint(b.x + b.width / 2, b.y + b.height / 2).matrixTransform(inv);
  return [[c.x, c.y]];
}

const mean = ps => [ps.reduce((s, p) => s + p[0], 0) / ps.length,
                    ps.reduce((s, p) => s + p[1], 0) / ps.length];

// One end's strands: a duplex pair joins MERGE below its connectors, and the
// cable proper starts there. Returns [start, strandPaths].
function gather(pts) {
  if (pts.length < 2) return [pts[0], []];
  const [mx, my] = mean(pts);
  const m = [mx, Math.max(...pts.map(p => p[1])) + MERGE];
  return [m, pts.map(p => `M${p[0]} ${p[1]} C${p[0]} ${p[1] + MERGE * 0.6} ${m[0]} ${m[1] - MERGE * 0.6} ${m[0]} ${m[1]}`)];
}

const hang = (a, b, s) => `M${a[0]} ${a[1]} C${a[0]} ${Math.max(a[1], b[1]) + s} ${b[0]} ${Math.max(a[1], b[1]) + s} ${b[0]} ${b[1]}`;

function stroke(g, d, color, w) {
  g.append(svgEl('path', {d, fill: 'none', stroke: '#000', 'stroke-opacity': 0.45,
    'stroke-width': w + 1.2, 'stroke-linecap': 'round'}));
  g.append(svgEl('path', {d, fill: 'none', stroke: color, 'stroke-width': w, 'stroke-linecap': 'round'}));
}

// Every link with at least one end on `view`: both ends -> a hanging cable;
// one end -> a cable hanging off to `edgeX` with a tag naming the far end
// (spec §6: front-to-rear runs go round the side). A fiber end whose
// connectors are missing, or a copper end whose port is, is recorded loose.
export function drawCables2d(svg, plan, view, {edgeX, tag}) {
  const layer = svgEl('g', {'data-cables': view, 'data-pt-ui': '*'});
  svg.append(layer);
  const fans = new Map();
  const out = [];
  plan.links.forEach((link, i) => {
    const fiber = link.media !== 'copper';
    const sides = [['from', link.from], ['to', link.to]];
    const here = sides.filter(([, e]) => (e[2] || 'front') === view);
    const rec = {link, i, g: null, loose: [], tagged: false};
    out.push(rec);
    if (!here.length) return;
    const pts = here.map(([k, e]) => [k, ends2d(svg, e[0], e[1], fiber)]);
    for (const [k, p] of pts) if (!p) rec.loose.push(k);
    const live = pts.filter(([, p]) => p);
    if (!live.length) return;
    const g = svgEl('g', {'data-cable': 'true', 'data-link-index': String(i),
      'data-media': link.media, 'data-purpose': link.purpose, tabindex: '0'});
    const color = colorOf(link);
    const key = [link.from[0], link.to[0]].sort().join('|');
    const fan = fans.get(key) || 0; fans.set(key, fan + 1);
    const starts = live.map(([, p]) => {
      const [s, strands] = gather(p);
      for (const d of strands) stroke(g, d, color, WIDTH * 0.6);
      return s;
    });
    if (starts.length === 2) {
      const [a, b] = starts;
      stroke(g, hang(a, b, sag2d(Math.hypot(b[0] - a[0], b[1] - a[1]), fan)), color, WIDTH);
    } else if (here.length === 1) {
      const a = starts[0];
      const b = [edgeX, a[1] + 30 + 6 * fan];
      stroke(g, hang(a, b, sag2d(Math.abs(b[0] - a[0]), fan)), color, WIDTH);
      const other = sides.find(([, e]) => (e[2] || 'front') !== view)[1];
      g.append(tag(b, other, link));
      rec.tagged = true;
    }
    const t = svgEl('title', {});
    t.textContent = `${link.from[0]} ${link.from[1]} → ${link.to[0]} ${link.to[1]} · ${link.purpose}, ${link.media}`;
    g.prepend(t);
    layer.append(g);
    rec.g = g;
  });
  return out;
}
```

- [ ] **Step 3: Write `patch-view.js`, the shared stage body in 2D.** Create `site/showcase/patch-view.js`:

```js
// The body stages 4 and 5 share: the cast rack with the plan's seats, cabled.
// In 2D the front or the rear elevation (the Front/Rear toggle lives in
// #stageTabs, which the rail empties on vacate); in 3D the mounted rack and
// its tubes (Task 4). Every write after an await is behind ui.live().

import {stage3d, stageRack, el, svgEl, title, lead, kv, panZoom} from './artifact.js';
import {CAST, RACK_U, loadMeta, overrides, build2dElevation, shortRef} from './rack.js';
import {loadPlan, applyPlanSeats, planSeatsMade, looseReason, countsBy} from './plan.js';
import {drawCables2d, colorOf} from './cables.js';

export const HONEST = 'An example patching plan for this rack, not a real lab.';

export function legendFor(plan) {
  const seen = new Map();
  for (const l of plan.links) {
    const k = l.media === 'copper' ? `copper · ${l.purpose}` : l.media.toUpperCase() + ' fiber';
    if (!seen.has(k)) seen.set(k, colorOf(l));
  }
  const wrap = el('div', {class: 'cable-legend'});
  for (const [k, c] of seen) {
    const sw = el('span', {class: 'swatch'}); sw.style.background = c;
    wrap.append(el('span', {class: 'legend-item'}, [sw, k]));
  }
  return wrap;
}

export function panelHead(plan, kept) {
  const seats = planSeatsMade();
  const kids = [lead(`<strong>${HONEST}</strong>`)];
  if (seats.length) {
    const top = seats.filter(s => !s.key.includes('-occupant') && !/\/module\/p\d+$|^port-\d+$/.test(s.key));
    kids.push(kv([['seated for the plan', `${seats.length} parts`, true],
                  ...top.map(s => [`${s.dev} ${s.key}`, shortRef(s.ref)])]));
  }
  for (const k of kept) kids.push(el('p', {class: 'panel-lead', 'data-kept': k.key,
    text: `Kept your ${k.dev} ${k.key}: ${k.have ? shortRef(k.have) : 'empty'}.`}));
  kids.push(kv([...countsBy(plan, 'purpose')].map(([p, n]) => [p, String(n)])));
  kids.push(legendFor(plan));
  return kids;
}

// `view` in 2D is 'front' | 'rear'. Returns the handle the stage keeps, or
// null when the entry went stale.
export async function enterPatched(ui, {head, onDrawn, extraPanel = () => []}) {
  ui.scrim('Patching the rack…');
  await loadMeta();
  if (!ui.live()) return null;
  const plan = await loadPlan();
  if (!ui.live()) return null;
  const {kept} = applyPlanSeats(plan, overrides);
  const handle = {mode: ui.mode, plan, kept, drawn: [], view: 'front',
                  setView: null, highlight: null, dispose: () => {}};
  if (ui.mode === '2d') await enter2d(ui, handle, onDrawn);
  if (!ui.live()) return null;
  ui.setPanel(...head, ...panelHead(plan, kept), ...extraPanel(handle), planList(plan, handle));
  ui.strip();
  return handle;
}

function planList(plan, handle) {
  const ul = el('ul', {class: 'plan-list'});
  plan.links.forEach((l, i) => {
    const b = el('button', {type: 'button', 'data-plan-row': String(i),
      text: `${l.from[0]} ${l.from[1]} → ${l.to[0]} ${l.to[1]}`});
    b.onclick = () => handle.highlight?.(i);
    const loose = handle.drawn[i]?.loose || [];
    const li = el('li', {'data-purpose': l.purpose}, [b]);
    for (const k of loose) li.append(el('span', {class: 'loose', 'data-loose': k,
      text: ' — loose: ' + looseReason(plan, handle.kept, l[k])}));
    ul.append(li);
  });
  return ul;
}

async function enter2d(ui, handle, onDrawn) {
  stage3d.hidden = true; stageRack.hidden = false;
  const tabs = document.getElementById('stageTabs');
  let seq = 0;
  const draw = async view => {
    const mine = ++seq;
    const stack = CAST.filter(e => e.ru != null);
    const svg = await build2dElevation({stack, heightRU: RACK_U, overrides, view});
    if (!ui.live() || mine !== seq) return;
    stageRack.replaceChildren(svg);
    const base = svg.getAttribute('viewBox').split(/\s+/).map(Number);
    // Room past the right-hand rail for tails and their tags.
    const vb = [base[0], base[1], base[2] + 180, base[3] + 40];
    svg.setAttribute('viewBox', vb.join(' '));
    panZoom(svg, () => vb);
    const edgeX = base[0] + base[2] + 8;
    handle.view = view;
    handle.drawn = drawCables2d(svg, handle.plan, view, {edgeX, tag: (at, far, link) => {
      const t = svgEl('g', {'data-tag': far.join(':'), class: 'cable-tag', tabindex: '0', role: 'button'});
      const label = `→ ${far[0]} ${far[2] || 'front'} · ${far[1]}`;
      t.append(svgEl('rect', {x: at[0] + 4, y: at[1] - 9, width: 7 * label.length + 12, height: 18, rx: 4}));
      const tx = svgEl('text', {x: at[0] + 10, y: at[1] + 4}); tx.textContent = label; t.append(tx);
      t.onclick = e => { e.stopPropagation(); if (ui.live()) handle.setView(far[2] || 'front'); };
      return t;
    }});
    wireHover(svg);
    paint(view);
    onDrawn?.(handle);
  };
  const buttons = ['front', 'rear'].map(v => {
    const b = el('button', {type: 'button', role: 'tab', 'data-view': v,
      text: v === 'front' ? 'Front' : 'Rear', 'aria-selected': 'false'});
    b.onclick = () => { if (ui.live()) handle.setView(v); };
    return b;
  });
  const paint = v => buttons.forEach(b => b.setAttribute('aria-selected', String(b.dataset.view === v)));
  if (tabs) { tabs.setAttribute('aria-label', 'Rack face'); tabs.replaceChildren(...buttons); }
  handle.setView = v => draw(v);
  handle.highlight = i => {
    const svg = stageRack.querySelector('svg');
    if (!svg) return;
    svg.classList.toggle('cable-focus', i != null);
    for (const g of svg.querySelectorAll('[data-cable]')) g.classList.toggle('on', g.dataset.linkIndex === String(i));
  };
  await draw('front');
  if (ui.live()) ui.unscrim();
}

function wireHover(svg) {
  for (const g of svg.querySelectorAll('[data-cable]')) {
    const on = () => { svg.classList.add('cable-focus'); g.classList.add('on'); };
    const off = () => { svg.classList.remove('cable-focus'); g.classList.remove('on'); };
    g.addEventListener('mouseenter', on); g.addEventListener('mouseleave', off);
    g.addEventListener('focus', on); g.addEventListener('blur', off);
  }
}
```

`build2dElevation` already takes `view` (`rack.js`, `view = 'front'` in its signature). Rear elevations come from the compiled `…rear.svg` faces. If `build2dElevation` mirrors nothing for rear, that is correct: the compiled rear faces are drawn as seen from behind.

- [ ] **Step 4: Rewrite stage 4.** Replace `site/showcase/stages/04-cable.js` with:

```js
// Stage 4 - Cable. "What is connected to what?"
//
// The rack stages 0-3 built, cabled to an example plan (patching.json): the
// plan is invented and says so, and check-contract.py proves every end of it
// against the compiled faces. Fiber lands on real connectors the plan seats
// (LC plugs in the optics, duplex plugs in the patch panel); copper lands on
// the jack, because no RJ45 port accepts a plug yet (roc-ops/Portrayal#610).
// patch-view.js is the body stage 5 shares; this file owns the question.

import {stage3d, stageRack, title, lead} from '../artifact.js';
import {enterPatched} from '../patch-view.js';

export default function makeCable() {
  let handle = null;
  return {
    title: 'Cable',
    question: 'What is connected to what?',
    async enter(ui) {
      const h = await enterPatched(ui, {
        head: [title('Stage 4 · Cable'), lead('<strong>What is connected to what?</strong>')],
        extraPanel: () => [lead('Fiber ends land on the plugs the plan seats; copper lands on the jack, which accepts no plug yet (Portrayal #610). Hover a cable, or pick a row, to follow it.')],
      });
      if (!ui.live()) { h?.dispose(); return; }
      handle = h;
    },
    exit() {
      handle?.dispose(); handle = null;
      stage3d.hidden = true; stage3d.replaceChildren();
      stageRack.hidden = true; stageRack.replaceChildren();
    },
  };
}
```

In 3D, until Task 4, `enterPatched` builds only the panel, so the 3D walk still sees a ready stage. Add this line to `enterPatched` for the 3D branch now, and Task 4 replaces it:

```js
  if (ui.mode === '3d') { stageRack.hidden = true; stage3d.hidden = false; ui.unscrim(); }
```

- [ ] **Step 5: Cable styles.** Append to `site/site.css`:

```css
/* Stages 4-5: cables that hang (patch-view.js / cables.js). Hover or a plan
 * row lights one cable and dims the rest; stage 5 ghosts what its filters
 * leave out. */
[data-cables] [data-cable] { cursor: pointer; transition: opacity 120ms; }
.cable-focus [data-cable]:not(.on) { opacity: 0.18; }
[data-cable].ghost { opacity: 0.12; }
.cable-tag rect { fill: var(--pt-surface); stroke: var(--pt-line); }
.cable-tag text { font: 500 11px var(--pt-font-mono); fill: var(--pt-ink); }
.cable-tag { cursor: pointer; }
.cable-legend { display: flex; flex-wrap: wrap; gap: 0.3rem 0.9rem; font-size: 0.78rem; color: var(--pt-ink-muted); }
.cable-legend .swatch { display: inline-block; width: 14px; height: 4px; border-radius: 2px; margin-right: 0.35rem; vertical-align: middle; }
.plan-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.2rem; font-size: 0.76rem; }
.plan-list button { all: unset; cursor: pointer; font-family: var(--pt-font-mono); color: var(--pt-ink-muted); }
.plan-list button:hover { color: var(--pt-brass); }
.plan-list .loose { color: var(--pt-warn); }
```

- [ ] **Step 6: Replace the stage 4 walk steps.** In `check-browser.py`, replace the `CLAIMS` entry for `"cable"` (and its function) with:

```python
    def cable_2d():
        # All fourteen are drawn on front or rear, every fiber end on a plug.
        page.wait_for_selector('#stageRack svg [data-cables="front"]', timeout=READY_MS)
        front = page.eval_on_selector_all('#stageRack svg [data-cable]', "gs => gs.map(g => g.dataset.linkIndex)")
        tagged = page.eval_on_selector_all('#stageRack svg [data-tag]', "ts => ts.length")
        if len(front) != 14:
            bad.append(f"stage cable in 2D: {len(front)} of 14 cables drawn on the front")
        if tagged != 2 + 1:   # two server links and the iDRAC run to the rear
            bad.append(f"stage cable in 2D: {tagged} rear tags on the front, expected 3")
        if page.query_selector('#sidePanel [data-loose]'):
            bad.append("stage cable in 2D: a loose end on a fresh rack: " +
                       page.inner_text('#sidePanel .plan-list'))
        if "not a real lab" not in page.inner_text('#sidePanel'):
            bad.append("stage cable: the panel does not say the plan is invented")
        # The plan's card is in slot-2, and its connectors are what the cables start on.
        if not page.query_selector('#stageRack svg [data-device-ref="asr-9006"] '
                                   '[data-path="slot-2/module"][data-ref^="cisco/a9k-16x100ge-tr@1"]'):
            bad.append("stage cable: slot-2 does not hold the plan's A9K-16X100GE-TR")
        # Front/Rear: the server tag flips to the rear, where that cable lands on the NIC.
        page.click('#stageRack svg [data-tag^="r740xd:ndc/module/port-1"]')
        page.wait_for_selector('#stageRack svg [data-cables="rear"]', timeout=READY_MS)
        if page.get_attribute('#stageTabs [data-view="rear"]', "aria-selected") != "true":
            bad.append("stage cable: the rear tag did not select Rear")
        if not page.query_selector('#stageRack svg [data-cables="rear"] [data-cable][data-link-index="8"]'):
            bad.append("stage cable: on the rear, the R740xd NIC 1 cable is not drawn")
        page.click('#stageTabs [data-view="front"]')
        page.wait_for_selector('#stageRack svg [data-cables="front"]', timeout=READY_MS)
```

Register it as `"cable": ("every cable is drawn, and the rear tag flips the face", cable_2d)`. Link index 8 is the first server link in `patching.json`.

Add a fill-rule step right after the stage 2 dropdown claim:

```python
    def kept_card():
        # A card the visitor chose is kept: seat a different line card in
        # slot-2 on stage 2, then stage 4 must keep it and name the loose ends.
        page.click('.stage-rail button[data-stage="populate"]')
        page.wait_for_selector('[data-stage-ready="populate"]', timeout=READY_MS)
        slot2 = next(b for b in slot_bays() if b["id"] == "slot-2")
        other = next(r for r in slot2["accepts"]
                     if r not in ("cisco/a9k-16x100ge-tr@1", "cisco/a9k-slot-cover@1"))
        page.select_option('#sidePanel select[data-bay="slot-2"]', other, timeout=READY_MS)
        page.wait_for_function("() => document.querySelector('#sidePanel [data-readout]')?.textContent.startsWith('seated — slot-2')", timeout=READY_MS)
        page.click('.stage-rail button[data-stage="cable"]')
        page.wait_for_selector('[data-stage-ready="cable"]', timeout=READY_MS)
        if not page.query_selector(f'#stageRack svg [data-device-ref="asr-9006"] [data-path="slot-2/module"][data-ref^="{other}"]'):
            bad.append("fill rule: stage 4 replaced the visitor's slot-2 card")
        loose = page.eval_on_selector_all('#sidePanel [data-loose]', "ls => ls.map(l => l.textContent)")
        if len(loose) != 4 or not all("seat it in stage 2" in t for t in loose):
            bad.append(f"fill rule: expected 4 named loose ends on slot-2, got {loose}")
        # Put the plan's card back, for the rest of the walk.
        page.click('.stage-rail button[data-stage="populate"]')
        page.wait_for_selector('[data-stage-ready="populate"]', timeout=READY_MS)
        page.select_option('#sidePanel select[data-bay="slot-2"]', "cisco/a9k-16x100ge-tr@1", timeout=READY_MS)
        page.wait_for_function("() => document.querySelector('#sidePanel [data-readout]')?.textContent.startsWith('seated — slot-2')", timeout=READY_MS)
```

The walk runs `kept_card()` once, after the stage walk and before the Inspect section. Because the visitor re-seats the plan's card by hand, `slot-2` then equals the plan's ref, so its children fill on the next stage 4 entry.

- [ ] **Step 7: Run both suites, and prove the checks can fail.**
  - Contract: all pass.
  - Browser: foreground, 600000 ms, to a file; all pass.
  - Mutation 1: change `patching.json` link 8's `"rear"` to `"front"`. `cable_2d` must fail (tag count, rear cable). Revert.
  - Mutation 2: make `applyPlanSeats` overwrite kept keys. `kept_card` must fail. Revert.
  - Throwaway Playwright proof, WebGL and no-WebGL: stage 4 in 2D shows 14 cables with no page errors, and the no-WebGL 3D entry builds the panel.

- [ ] **Step 8: Commit.** Commit in two logical steps: `cables.js` + `patch-view.js` + CSS, then the stage 4 rewrite + tests.

```bash
git add site/showcase/cables.js site/showcase/patch-view.js site/site.css
git commit -m "showcase: cables that hang, landed on the plan's connectors (2D)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git add site/showcase/stages/04-cable.js check-contract.py check-browser.py
git commit -m "showcase: stage 4 cables the rack we built, front and rear

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Stage 4 in 3D

**Files:**
- Modify: `site/rack3d.js`. Add `cablePoints` to the `relief.js` import at line 16; add `cableAnchor` and `deviceBoxes` beside `portAnchor` (about line 677) and in the returned API (about line 865).
- Modify: `site/showcase/cables.js` (the 3D half), `site/showcase/patch-view.js` (the 3D branch), `check-browser.py`, `check-contract.py`

**Interfaces:**
- Produces:
  - `scene.cableAnchor(which, prefix, {view}?) -> Promise<Array<{position: Vector3, normal: Vector3, view, path}>>`, one entry per `cablePoints` connector whose path starts with `prefix + '-occupant/'`. It returns `[]` when there are none.
  - `scene.deviceBoxes() -> Array<{ref, box: Box3}>`, the mounted chassis bodies in world space.
  - In `cables.js`: `hangPoints3d(THREE, A, B, rackW) -> Vector3[]`, where `A` and `B` are `{points: Vector3[], normal: Vector3}`, and `drawCables3d(scene, plan) -> Promise<Tube[]>`, where `Tube = {link, i, mesh: Group | null, loose: string[], points: Vector3[]}`.

- [ ] **Step 1: Write the failing walk step.** Add to `check-browser.py`, in the 3D part of the walk (where stages 3/4 are exercised in 3D):

```python
    def cable_3d():
        # Fourteen tubes; each fiber tube starts at its connector; no sampled
        # point inside a device body (spec §5.3's clearance rule).
        page.wait_for_function("() => window.__patch3d && window.__patch3d.tubes.length === 14",
                               timeout=READY_3D_MS)
        r = page.evaluate("""() => {
            const {tubes, anchors, boxes} = window.__patch3d;
            const inside = [];
            for (const t of tubes) for (const p of t.points)
                for (const b of boxes) if (b.box.containsPoint(p)) { inside.push(`${t.i}:${b.ref}`); break; }
            const off = anchors.filter(a => a.firstGap > 1).map(a => `${a.i}:${a.side} ${a.firstGap.toFixed(1)}`);
            return {n: tubes.filter(t => t.mesh).length, inside: [...new Set(inside)].slice(0, 5), off};
        }""")
        if r["n"] != 14: bad.append(f"stage cable in 3D: {r['n']} of 14 tubes")
        if r["inside"]: bad.append(f"stage cable in 3D: tube points inside devices {r['inside']}")
        if r["off"]: bad.append(f"stage cable in 3D: fiber tubes not starting at their connector {r['off']}")
```

`window.__patch3d` is a test hook that `patch-view.js` sets only when `location.search` contains `patchprobe=1`. Load the 3D part of the walk with that parameter, following how the walk builds its URLs (`page.goto(f"{base}/index.html?patchprobe=1")` for this step's page). Call `cable_3d()` after clicking `.stage-rail button[data-stage="cable"]` in 3D. Run the walk and expect FAIL (no hook yet).

- [ ] **Step 2: Add `cableAnchor` and `deviceBoxes` to `rack3d.js`.** Change the `relief.js` import at line 16 to also import `cablePoints`. Add this beside `portAnchor`:

```js
  // WHERE A CABLE LEAVES A SEATED CONNECTOR, in the room: relief.js's
  // cablePoints on the mount's own face (faceDoc is the seated face - see
  // overrideFaces), each point's own-frame `at` mapped into face millimetres
  // through its marker's CTM, lifted by the point's resolved `z`, then
  // through the same face->device->room chain portAnchor uses. One entry per
  // connector under `prefix` (an optic's two plugs; a duplex plug's a and b).
  async function cableAnchor(which, prefix, o = {}) {
    const m = findMounted(which);
    if (!m || !prefix) return [];
    const {entry, group} = m;
    const {w: W, h: H, d: D} = entry.chassis;
    const frames = faceFrames(W, H, D);
    group.updateMatrixWorld(true);
    const q = group.getWorldQuaternion(new THREE.Quaternion());
    for (const view of o.view ? [o.view] : ['front', 'rear']) {
      const fr = frames.find(x => x.view === view);
      const doc = fr && await faceDoc(entry, view);
      if (!doc) continue;
      const pts = cablePoints(doc.svg).filter(p => p.at && p.path.startsWith(prefix + '-occupant/'));
      if (!pts.length) continue;
      const inv = doc.svg.getScreenCTM().inverse();
      const rot = new THREE.Euler(...fr.rot);
      const normal = new THREE.Vector3(0, 0, 1).applyEuler(rot).applyQuaternion(q).normalize();
      return pts.map(p => {
        const mm = new DOMPoint(p.at[0], p.at[1]).matrixTransform(inv.multiply(p.el.getScreenCTM()));
        const lx = (fr.flipLX ? -1 : 1) * (mm.x - fr.fw / 2);
        const ly = (fr.flipLY ? -1 : 1) * (fr.fh / 2 - mm.y);
        const local = new THREE.Vector3(lx, ly, p.z).applyEuler(rot).add(new THREE.Vector3(...fr.pos));
        return {position: group.localToWorld(local), normal: normal.clone(), view, path: p.path};
      });
    }
    return [];
  }

  // Each mounted chassis as a world-space box, for a host that must keep
  // something (a cable) out of the metal.
  function deviceBoxes() {
    return mounted.map(({entry, group}) => {
      const {w, h, d} = entry.chassis;
      group.updateMatrixWorld(true);
      const box = new THREE.Box3(new THREE.Vector3(-w / 2, -h / 2, -d / 2), new THREE.Vector3(w / 2, h / 2, d / 2));
      return {ref: entry.ref, box: box.applyMatrix4(group.matrixWorld)};
    });
  }
```

Add `cableAnchor,` and `deviceBoxes,` to the returned object, each with a one-line comment like the one on `portAnchor`.

  **Before relying on it, verify the face-frame convention.** In a throwaway browser proof, mount stage 4 in 3D and compare `cableAnchor({ref:'as7726-32x'}, 'port-1')[0].position` with `portAnchor({ref:'as7726-32x'}, 'port-1').position`. Their x and y must agree within the port's size (under 20 mm), and z must be larger by about the plug's reach.
  - If the y sign is flipped, the group's own frame is centered differently from what `portAnchor` assumes. Fix `cableAnchor` to match `portAnchor` exactly, since `portAnchor` is proven by the ring's tubes.
  - If `p.z` is in the wrong direction for the rear face, apply it along the unrotated local +z before `applyEuler`, as written above.

- [ ] **Step 3: Write `cables.js`, the 3D half.** Append to `site/showcase/cables.js`:

```js
// ── 3D ────────────────────────────────────────────────────────────────────
export const LEAD = 40;           // mm straight out of a connector before it can bend
const MERGE3D = 25;               // mm out from a duplex pair where the strands join
const SIDE_CLEAR = 45;            // mm outside the rack's right post, for front-rear runs
const K = 1.2;                    // catenary shape: f(t) = (cosh(K(2t-1)) - cosh K)/(cosh K - 1)
const cat = t => (Math.cosh(K * (2 * t - 1)) - Math.cosh(K)) / (Math.cosh(K) - 1);
const sag3d = dist => 20 + 0.3 * dist;

// A hanging stretch from p to q: straight between them in x and z, and the
// catenary in y, below the lower end by sag3d of the chord.
function hangBetween(THREE, p, q, n = 24) {
  const s = sag3d(p.distanceTo(q));
  const out = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const v = p.clone().lerp(q, t);
    v.y += s * cat(t);
    out.push(v);
  }
  return out;
}

export function hangPoints3d(THREE, A, B, rackW) {
  const start = e => e.points.length > 1
    ? e.points.reduce((s, p) => s.add(p), new THREE.Vector3()).multiplyScalar(1 / e.points.length)
        .addScaledVector(e.normal, MERGE3D)
    : e.points[0].clone();
  const a = start(A), b = start(B);
  const outA = a.clone().addScaledVector(A.normal, LEAD);
  const outB = b.clone().addScaledVector(B.normal, LEAD);
  const pts = [a, outA];
  if (A.normal.dot(B.normal) < -0.5) {
    // Front to rear: round the right-hand side, outside the posts.
    const x = rackW / 2 + SIDE_CLEAR;
    const sa = new THREE.Vector3(x, outA.y, outA.z), sb = new THREE.Vector3(x, outB.y, outB.z);
    pts.push(...hangBetween(THREE, outA, sa).slice(1), ...hangBetween(THREE, sa, sb).slice(1),
             ...hangBetween(THREE, sb, outB).slice(1));
  } else {
    pts.push(...hangBetween(THREE, outA, outB).slice(1));
  }
  pts.push(b);
  return pts;
}

// Keep a cable out of the metal: a point inside a chassis box is pushed out
// along `normal` to 5 mm past that box's face.
export function clearOf(THREE, pts, boxes, normal) {
  for (const p of pts) for (const {box} of boxes) {
    if (!box.containsPoint(p)) continue;
    const toFace = normal.z >= 0 ? box.max.z + 5 - p.z : box.min.z - 5 - p.z;
    p.addScaledVector(normal, Math.abs(toFace));
  }
  return pts;
}

export async function drawCables3d(scene, plan) {
  const {THREE, scene: world} = scene.three;
  const rackW = scene.metrics().rackWidth;
  const boxes = scene.deviceBoxes();
  const group = new THREE.Group(); group.name = 'patch-cables';
  const tubes = [], anchors = [];
  for (const [i, link] of plan.links.entries()) {
    const fiber = link.media !== 'copper';
    const ends = [];
    const loose = [];
    for (const [side, [dev, path, view]] of [['from', link.from], ['to', link.to]]) {
      let e = null;
      if (fiber) {
        const got = await scene.cableAnchor({ref: dev}, path, {view: view || 'front'});
        if (got.length) e = {points: got.map(g => g.position), normal: got[0].normal};
        for (const g of got) anchors.push({i, side, anchor: g});
      } else {
        const a = await scene.portAnchor({ref: dev}, path, {view: view || 'front'});
        if (a) e = {points: [a.position], normal: a.normal};
      }
      if (!e) loose.push(side);
      ends.push(e);
    }
    if (loose.length) { tubes.push({link, i, mesh: null, loose, points: [], starts: []}); continue; }
    const pts = clearOf(THREE, hangPoints3d(THREE, ends[0], ends[1], rackW), boxes, ends[0].normal);
    const mat = new THREE.MeshStandardMaterial({color: colorOf(link), roughness: 0.6});
    const g = new THREE.Group(); g.name = `cable-${i}`;
    g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'centripetal'),
                                                160, WIDTH / 2, 8, false), mat));
    // Where each connector's run begins: the main tube's first/last point for a
    // single end, each strand's first point for a duplex pair.
    const starts = [];
    for (const e of ends) if (e.points.length === 1) starts.push(e.points[0]);
    for (const e of ends) if (e.points.length > 1) {       // duplex strands into the merge
      starts.push(...e.points);
      const m = e.points.reduce((s, p) => s.add(p), new THREE.Vector3()).multiplyScalar(1 / e.points.length)
        .addScaledVector(e.normal, 25);
      for (const p of e.points) g.add(new THREE.Mesh(new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3([p, p.clone().addScaledVector(e.normal, 12), m]), 16, WIDTH * 0.3, 6, false), mat));
    }
    group.add(g);
    tubes.push({link, i, mesh: g, loose, points: pts, starts});
  }
  world.add(group);
  return {tubes, anchors, boxes, group};
}
```


- [ ] **Step 4: Add the 3D branch of `patch-view.js`.** Replace the Task 3 placeholder line with:

```js
  if (ui.mode === '3d') {
    const {mount3d, chassisOf} = await import('./rack.js');
    const {drawCables3d} = await import('./cables.js');
    const stack = CAST.map(e => ({...e, chassis: chassisOf(e.ref)}));
    const sc = await mount3d({stack, heightRU: RACK_U, overrides});
    if (!ui.live()) { sc?.dispose(); return null; }
    handle.dispose = () => sc?.dispose();
    if (sc) {
      ui.unscrim();
      const r = await drawCables3d(sc, plan);
      if (!ui.live()) { sc.dispose(); return null; }
      handle.drawn = r.tubes;
      handle.highlight = i => {
        for (const t of r.tubes) if (t.mesh) t.mesh.traverse(o => {
          if (o.material) { o.material.transparent = true; o.material.opacity = i == null || t.i === i ? 1 : 0.15; }
        });
      };
      // TEST HOOK, only with ?patchprobe=1: what check-browser.py's 3D step
      // measures - every fiber connector's distance to the nearest start of
      // its cable's geometry.
      if (new URLSearchParams(location.search).get('patchprobe') === '1') {
        window.__patch3d = {tubes: r.tubes, boxes: r.boxes,
          anchors: r.anchors.map(({i, side, anchor}) => ({i, side,
            firstGap: Math.min(...r.tubes[i].starts.map(p => p.distanceTo(anchor.position)), Infinity)}))};
      }
    }
    onDrawn?.(handle);
  }
```

`tube.starts` holds the first point of each connector's run (a strand for a duplex end), so `firstGap` is exact for both kinds of end.

  The 3D "What is connected" panel uses the same `panelHead` and `planList` as 2D. The Front/Rear tabs are 2D only: empty `#stageTabs` on the 3D branch.

- [ ] **Step 5: Add a contract check for shared geometry.** In `check-contract.py`:

```python
r3d = (HERE / "site" / "rack3d.js").read_text()
check("async function cableAnchor" in r3d and "cablePoints" in r3d and "function deviceBoxes" in r3d,
      "rack3d.js anchors cables on the kit's connector points", "cableAnchor/deviceBoxes missing")
check(not re.search(r"TubeGeometry|CatmullRom", (HERE / "site" / "showcase" / "patch-view.js").read_text()),
      "patch-view.js leaves the cable geometry to cables.js", "tube geometry in patch-view.js")
```

- [ ] **Step 6: Run both suites and the proofs.**
  - Contract: all pass.
  - Browser (foreground, 600000 ms, to a file): all pass, including `cable_3d`.
  - Mutation 1: set `LEAD = -40`. The clearance or start-gap checks must fail. Revert.
  - Mutation 2: return `[]` from `cableAnchor`. The tube count must fail. Revert.
  - Throwaway proof with forced no-WebGL: stage 4 in 3D builds its panel, lists 14 rows, and shows no page errors.

- [ ] **Step 7: Commit.**

```bash
git add site/rack3d.js site/showcase/cables.js site/showcase/patch-view.js check-contract.py check-browser.py
git commit -m "showcase: stage 4 in 3D - tubes that hang from the plan's connectors

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Stage 5 on the plan, and retire the ring

**Files:**
- Rewrite: `site/showcase/stages/05-filter.js`
- Delete: `site/showcase/ring.js`, `site/showcase/ring2d.js`
- Modify: `site/site.css` (drop the ring-only rules), `site/showcase/rack.js` and `site/showcase/spoke-host.js` (comments that mention the ring), `check-contract.py` (drop the "stage 4 cables a real topology" and "the ring in 2D, by site" sections), `check-browser.py` (the filter claim)

**Interfaces:**
- Consumes: `enterPatched`, `countsBy`, the `Handle` from Tasks 3–4 (`drawn` holds `Drawn[]` in 2D and `Tube[]` in 3D, both carrying `.link` and `.i`).

- [ ] **Step 1: Write the failing walk step.** Replace the `"filter"` claim in `check-browser.py`:

```python
    def filter_management():
        # "Show me just management": 4 cables at full strength, 10 ghosted,
        # counts read off the plan (both rows derived from patching.json).
        plan = json.loads((HERE / "site" / "showcase" / "patching.json").read_text())
        want = sum(1 for l in plan["links"] if l["purpose"] == "management")
        page.click('#sidePanel [data-filter-purpose="management"]', timeout=READY_MS)
        page.wait_for_function(
            """([w, t]) => { const c = document.querySelector('#sidePanel [data-filter-count]');
                return !!c && c.dataset.matching === String(w) && c.dataset.total === String(t); }""",
            arg=[want, len(plan["links"])], timeout=READY_MS)
        lit = page.eval_on_selector_all('#stageRack svg [data-cable]:not(.ghost)', "gs => gs.length")
        ghost = page.eval_on_selector_all('#stageRack svg [data-cable].ghost', "gs => gs.length")
        if (lit, ghost) != (want, 14 - want):
            bad.append(f"stage filter in 2D: {lit} lit and {ghost} ghosted, expected {want} and {14 - want}")
```

Add the 3D counterpart after `cable_3d` in the 3D walk. After clicking the same button, `window.__patch3d.tubes` has exactly `want` tubes with material opacity 1:

```python
    def filter_3d():
        page.click('#sidePanel [data-filter-purpose="management"]', timeout=READY_MS)
        n = page.evaluate("""() => window.__patch3d.tubes.filter(t => t.mesh &&
            t.mesh.children[0].material.opacity === 1).length""")
        if n != 4: bad.append(f"stage filter in 3D: {n} tubes at full strength, expected 4")
```

Run it. Expected: FAIL (there is no `data-filter-purpose` yet).

- [ ] **Step 2: Rewrite stage 5.** Replace `site/showcase/stages/05-filter.js` with:

```js
// Stage 5 - Filter. "Show me just management."
//
// Stage 4's rack and cables, narrowed on two axes read off the plan - purpose
// and media, each with its count - so a purpose added to patching.json gets
// its own button without this file changing. What a filter leaves out fades
// to a ghost rather than vanishing, so the rack still reads as cabled.

import {stage3d, stageRack, el, title, lead} from '../artifact.js';
import {enterPatched} from '../patch-view.js';
import {countsBy} from '../plan.js';

export default function makeFilter() {
  let handle = null;
  const on = {purpose: null, media: null};

  function apply(h, countEl) {
    const match = l => (!on.purpose || l.purpose === on.purpose) && (!on.media || l.media === on.media);
    let n = 0;
    for (const d of h.drawn) {
      const hit = match(d.link); if (hit) n++;
      if (d.g) d.g.classList.toggle('ghost', !hit);
      if (d.mesh) d.mesh.traverse(o => { if (o.material) { o.material.transparent = true; o.material.opacity = hit ? 1 : 0.12; } });
    }
    countEl.dataset.matching = String(n);
    countEl.dataset.total = String(h.plan.links.length);
    countEl.textContent = `${n} of ${h.plan.links.length} cables`;
  }

  function row(h, field, countEl) {
    const wrap = el('div', {class: 'ctl', 'data-filter-row': field});
    const buttons = [];
    for (const [v, n] of countsBy(h.plan, field)) {
      const b = el('button', {type: 'button', 'aria-pressed': 'false', [`data-filter-${field}`]: v,
                              text: `${v} (${n})`});
      b.onclick = () => {
        on[field] = on[field] === v ? null : v;
        for (const x of buttons) x.setAttribute('aria-pressed', String(on[field] === x.getAttribute(`data-filter-${field}`)));
        apply(h, countEl);
      };
      buttons.push(b); wrap.append(b);
    }
    return wrap;
  }

  return {
    title: 'Filter',
    question: 'Show me just management.',
    async enter(ui) {
      on.purpose = null; on.media = null;
      const countEl = el('p', {class: 'panel-lead', 'data-filter-count': 'true'});
      const h = await enterPatched(ui, {
        head: [title('Stage 5 · Filter'), lead('<strong>Show me just management.</strong>')],
        extraPanel: hh => [row(hh, 'purpose', countEl), row(hh, 'media', countEl), countEl],
        // A redraw (the Front/Rear toggle) keeps the filter.
        onDrawn: hh => apply(hh, countEl),
      });
      if (!ui.live()) { h?.dispose(); return; }
      handle = h;
      apply(h, countEl);
    },
    exit() {
      handle?.dispose(); handle = null;
      stage3d.hidden = true; stage3d.replaceChildren();
      stageRack.hidden = true; stageRack.replaceChildren();
    },
  };
}
```

`extraPanel` is called with the handle after the drawing, and `onDrawn` fires after each 2D redraw, so the ghosting survives the Front/Rear toggle. Add a contract check:

```python
s5 = (HERE / "site" / "showcase" / "stages" / "05-filter.js").read_text()
check("countsBy" in s5 and not re.search(r"""['"](uplink|core|server|management|os2|copper)['"]""", s5),
      "stage 5's filters are read off the plan", "a hardcoded purpose or media in 05-filter.js")
check("ring.js" not in s5 and "ring2d.js" not in s5 and "labs.json" not in s5,
      "stage 5 no longer reads the ROADM ring", "05-filter.js still imports the ring")
```

- [ ] **Step 3: Retire the ring.**
  - Run `git rm site/showcase/ring.js site/showcase/ring2d.js`.
  - Then run `grep -rn "ring\.js\|ring2d\|loadLab\|sitesOf\|siteView\|legendEl" site index.html check-*.py`. Every hit must go: imports, CSS rules used only by the ring (the ring-stub, site-caption and span classes; confirm each with a grep for its selector in `site/`), and comments naming the ring in `rack.js` and `spoke-host.js`.
  - In `check-contract.py`, delete the sections headed `# ── stage 4 cables a real topology ──` and `# ── the ring in 2D, by site ──`, from each heading to the next.
  - In `check-browser.py`, delete the ring-only helpers (`management_by_site` and any site-tab steps).
  - Keep `index.html`'s `#stageTabs`, which is now the Front/Rear toggle, and change its static `aria-label="Sites"` to `aria-label="Rack face"`.
  - Add this contract check:

```python
check(not (HERE / "site" / "showcase" / "ring.js").exists() and not (HERE / "site" / "showcase" / "ring2d.js").exists(),
      "the ROADM ring's showcase code is retired", "ring.js or ring2d.js still present")
```

- [ ] **Step 4: Run everything.**
  - Contract: all pass.
  - Browser (foreground, 600000 ms, to a file): all pass.
  - Mutation 1: hardcode `'management'` in `05-filter.js`. The contract must fail. Revert.
  - Mutation 2: make `apply()` hide instead of ghosting. The lit/ghost count must fail. Revert.
  - Throwaway proof, WebGL and no-WebGL: stage 5 in 2D, filter management, toggle to Rear and back, and the filter holds. In 3D, 4 tubes stay lit. No page errors.

- [ ] **Step 5: Commit.**

```bash
git add -A site/showcase/stages/05-filter.js site/showcase/ring.js site/showcase/ring2d.js site/site.css site/showcase/rack.js site/showcase/spoke-host.js index.html check-contract.py check-browser.py
git commit -m "showcase: stage 5 filters the plan, and the ROADM ring is retired

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-review (done while writing)

- **Spec coverage:**
  - §3 → Task 1;
  - §4.1–4.4 → Task 2 (the honesty line lands in Task 3's `patch-view.js`);
  - §5.1/5.2/5.5 → Task 3;
  - §5.3 → Task 4;
  - §5.4 is copper on jacks: `ends2d` and `portAnchor` in Tasks 3 and 4, with the panel line in `04-cable.js`;
  - §6 → Tasks 3 and 4;
  - §7 → Task 5;
  - §8 is spread over every task;
  - §10 needs no work.
- **Spec changes, all in Findings:**
  - boots dropped (F1);
  - seat keys are drawing paths (F2);
  - the 3D curve's formula is written out (F5).
- **Names used across tasks:**
  - `loadPlan`, `applyPlanSeats`, `planSeatsMade`, `looseReason`, `countsBy`, `endView`, `isFiber` (Task 2);
  - `drawCables2d`, `ends2d`, `colorOf`, `hangPoints3d`, `drawCables3d`, `clearOf` (Tasks 3–4);
  - `enterPatched`, `panelHead`, `legendFor`, `HONEST` (Task 3);
  - `cableAnchor`, `deviceBoxes` (Task 4);
  - `Handle.drawn` and `.highlight` (Tasks 3–5).
