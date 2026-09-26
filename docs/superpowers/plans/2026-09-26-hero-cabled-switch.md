# Front-page hero: a cabled switch in 2D and 3D, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The front-page hero's addressable side becomes the S9600-72XC with its real seated parts and hanging cables, where hovering names a cable in one fixed caption line. A second panel shows the same switch in 3D.

**Architecture:**
- `site/hero-reveal.js` keeps the before/after slider. Its `PORTS` table becomes the one link table for both panels: each row gains `seat` (kit override keys), `jacket` and `label`.
- The seated face is built through the kit's `applyFaceOverrides`. Connector points come from `relief.js`'s `cablePoints`; the sag rule and colors come from `site/showcase/cables.js`.
- A new `site/hero-3d.js` builds the 3D panel lazily through `site/rack3d.js`'s `createRackScene`, which gains a `rails: false` option.

**Tech stack:** vanilla ES modules, three.js via the page's import map, the vendored Portrayal kit (`vendor/`). Tests are `check-contract.py` and `check-browser.py` (Playwright).

**Spec:** `docs/superpowers/specs/2026-09-26-hero-cabled-switch-design.md`

## Global Constraints

- **Prerequisite:** the Portrayal sync to `e9fb842e` or later is on `main`, so `assets/dist` has #621's cable ends. Base the branch on `origin/main` once that lands.
- **`site/showcase/cables.js` is held by the Rack Builder session** (the stage-6 cable handoff). Task 1 edits it only after that work is on `main`, or with that session's agreement (§Findings F3). No other task edits it.
- **Where to work:** never touch the live checkout at `/Volumes/External/portrayal-site`. It is on another session's branch and serves 8177/8178. Work in `.claude/worktrees/<name>` off `origin/main`. Never edit `vendor/` or `assets/dist/`. No bare `git stash`.
- **The left PNG side of the slider is unchanged:** no parts, no cables, no caption hooks.
- **No floating callouts.** One fixed caption line per panel (`[data-hero-caption]`). Its default text is the `port-67` row.
- **Colors come from `cables.js`.** The hero keeps no color table.
- **Cables never leave their frame.** They fade out at the side edges.
- **Every contract check records on every run.** `check-browser.py` runs in the FOREGROUND with an explicit Bash timeout of 600000 ms and its output goes to a file (never piped through `tail`). Every new check is shown failing first.
- **No WebGL:** the page still works, and the 3D panel shows its still image and a one-line note.
- **Prose** is in American English.
- **Commits** end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Findings since the spec

All probed in a browser against the synced dist on 2026-09-26. They are binding.

- **F1: the port lamps are on/off only.**
  - The S9600 face declares `off on` on its 96 port lamps (`led-port-N/lamp`, four per QSFP28 port, one per lane).
  - **Ruling:** lamps show `on` for a link that is up (including `attention` and `service` rows) and `off` otherwise. The degraded 100G link lights 3 of its 4 lane lamps.
  - Amber is not available on these lamps, so "CRC errors rising" and every other warning live in the caption only.
  - This amends spec D4 and §4 "Lamps".
- **F2: the parts, seat keys and cable points** (all seated with 0 refused through `applyFaceOverrides`).

  | Part | Seat key | Cable point path |
  |---|---|---|
  | SFP LC optic `generic/sfp-lc@1` | `port-N` | plugs: `port-N-occupant/tx` and `/rx`, each taking `generic/lc-plug@2` (**simplex LC plugs**, not a duplex plug); points `port-N-occupant/tx-occupant` and `/rx-occupant` |
  | QSFP LC optic `generic/qsfp-lc@2` | `port-N` | same `tx`/`rx` plugs and points |
  | Molex SFP+ DAC `molex/sfp-plus-passive-dac@1` | `port-N` | `port-N-occupant/body` (at the stub's end, z ≈ 68.7) |
  | SFP cable end `generic/sfp-cable@1` | `port-N` | `port-N-occupant` |
  | FS / Siemon QSFP28 AOC `fs/qsfp28-aoc@1`, `siemon/qsfp28-aoc@1` | `port-N` | `port-N-occupant/body` (z ≈ 64.8) |
  | Amphenol QSFP28 DAC `amphenol/qsfp28-passive-dac@1` | `port-N` | `port-N-occupant/body` |
  | RJ45 plug `generic/rj45-plug@1` | `oob` | `oob-occupant` |

  `cables.js`'s `plugAt(cp, path)` already matches all of these.
- **F3: the `cables.js` color table** has `os2` and `copper` only (`COLORS`). The hero needs aqua (multimode/AOC) and black (DAC). Task 1 adds jacket colors to `cables.js` as an additive export; see the Global Constraints gate.
- **F4: `createRackScene` always draws rack rails.** Task 4 adds an opt-in `rails: false`. The default is unchanged, so every existing caller is unaffected.

---

## File structure

| File | Responsibility |
|---|---|
| `site/showcase/cables.js` (modify, Task 1 only) | Adds `JACKETS` and `colorOfJacket(jacket)`. Additive only. |
| `site/hero-reveal.js` (modify) | The link table (`PORTS` + `seat`/`jacket`/`label`), seating, lamps, cables, caption. The callout, marks and badges are removed. |
| `site/hero-3d.js` (create) | The 3D panel: lazy build, tubes with fades, studio background, auto-turn, orbit limits, picking, still-image fallback. |
| `site/rack3d.js` (modify, Task 4) | `rails: false` option. |
| `index.html` (modify) | The second panel's markup and caption; the 3D panel's module import. |
| `site/site.css` (modify) | Caption line, hover dim, 3D panel frame. Callout-well styles removed. |
| `check-contract.py`, `check-browser.py` (modify) | Hero checks per task. |

---

### Task 1: Jacket colors in `cables.js` (gated: see Global Constraints)

**Files:** Modify `site/showcase/cables.js` (next to `COLORS`, around line 24). Modify `check-contract.py`.

**Interfaces:** Produces `JACKETS = {mm, sm, dac, cu}` and `colorOfJacket(j) -> string`.

- [ ] **Step 1: Failing contract check.** Add to `check-contract.py`, in a new `# ── the hero ──` section before `# ── report ──`:

```python
cab = (HERE / "site" / "showcase" / "cables.js").read_text()
check(re.search(r"export const JACKETS\s*=\s*\{", cab) is not None
      and all(re.search(rf"\b{k}\s*:", cab.split("export const JACKETS", 1)[-1][:400]) for k in ("mm", "sm", "dac", "cu")),
      "cables.js names the four jacket colors the hero draws (mm, sm, dac, cu)",
      "no JACKETS export with mm/sm/dac/cu")
```

Run `python3 check-contract.py`. Expected: FAIL on this check.

- [ ] **Step 2: Add the export** right after `COLORS`:

```js
// JACKETS: what a cable's outer sheath looks like, by what it is. Multimode
// fiber and AOCs are aqua, single-mode is yellow (the same yellow as os2), a
// twinax DAC is black, and copper patch leads are blue. The front-page hero
// colors its cables by these; the showcase's plan keeps colorOf.
export const JACKETS = {mm: '#2bb3c8', sm: COLORS.os2, dac: '#15171a', cu: COLORS.copper.server};
export const colorOfJacket = j => JACKETS[j] || JACKETS.sm;
```

- [ ] **Step 3:** Run `python3 check-contract.py`. Expected: all pass.
- [ ] **Step 4: Commit:** `git commit -m "cables: jacket colors for the hero (mm, sm, dac, cu)"`, with the trailer.

---

### Task 2: The hero's link table, real parts, lamps; no marks, badges or callout

**Files:** Modify `site/hero-reveal.js`, `site/site.css`, `check-contract.py`, `check-browser.py`.

**Interfaces:**
- Consumes `JACKETS` and `colorOfJacket` (Task 1). Consumes `applyFaceOverrides` (`vendor/swap.js`), `jdist` (`vendor/dist.js`) and `cablePoints` (`vendor/relief.js`).
- Produces the exported `PORTS` (the link table). Each row: `{state, label, speed, note, jacket, seat: {key: ref}, lanesUp?}`.
- Produces `export async function seatHero(svg) -> {applied, refused, failed}`, used by Task 3 and by Task 4's still image.

- [ ] **Step 1: Failing contract checks.** Add to the hero section:

```python
hero = (HERE / "site" / "hero-reveal.js").read_text()
check("pt-mark" not in hero and "pt-label" not in hero,
      "the hero draws no colored port marks or text badges", "pt-mark/pt-label still in hero-reveal.js")
check(not re.search(r"callout", hero, re.I) or "no floating callout" in hero,
      "the hero has no floating callout", "a callout is still built in hero-reveal.js")
# Every row seats real parts its cage accepts (spec §7), read off the dist.
s96 = json.loads((DIST / "s9600-72xc.configs.json").read_text())
cage_acc = {c["id"]: c.get("accepts") or [] for v in s96.get("cages", {}).values() for c in v}
comp_by = {f"{c['ns']}/{c['name']}@{c['major'][1:]}": c for c in json.loads((DIST / "components.json").read_text())["components"]}
rows = re.findall(r"'([a-z0-9-]+)':\s*\{[^}]*?seat:\s*\{([^}]*)\}[^}]*?jacket:\s*'([a-z]+)'", hero, re.S)
bad_hero = []
for port, seat, jacket in rows:
    pairs = dict(re.findall(r"'([^']+)':\s*'([^']+)'", seat))
    for key, ref in pairs.items():
        if ref not in comp_by:
            bad_hero.append(f"{port}: {ref} is not a component"); continue
        if "-occupant/" in key:
            host, bore = key.rsplit("-occupant/", 1)
            opt = pairs.get(host)
            ok = any(c.get("id") == bore and ref in (c.get("accepts") or []) for c in (comp_by.get(opt, {}).get("cages") or []))
        else:
            ok = ref in cage_acc.get(key, [])
        if not ok: bad_hero.append(f"{port}: {key} does not accept {ref}")
    if jacket not in ("mm", "sm", "dac", "cu"): bad_hero.append(f"{port}: jacket {jacket}")
check(len(rows) >= 20 and not bad_hero, "every hero link seats real parts its cage accepts, with a jacket",
      f"{len(rows)} rows parsed; {bad_hero[:5]}")
# Cable colors come from cables.js. (The hero keeps its LAMP colors - those
# are lamp states, not cables - so this checks the import, not every hex.)
check(re.search(r"import\s*\{[^}]*colorOfJacket[^}]*\}\s*from\s*'\./showcase/cables\.js'", hero) is not None
      and "JACKETS = {" not in hero,
      "the hero's cable colors come from cables.js", "no colorOfJacket import, or a jacket table of its own")
```

  Keep the parse robust. Rows must be written in the shape shown in Step 3: `seat: {…}` before `jacket: '…'`, one object per port. If the regex proves brittle, move the table to `site/hero-links.json` and check the JSON instead. Say which you chose.

  Run `python3 check-contract.py`. Expected: FAIL on the new checks.

- [ ] **Step 2: Failing browser checks.** Add a hero check to `check-browser.py`, in the pages walk where `index.html` is loaded:

```python
    def hero_parts():
        page.goto(f"{base}/index.html", wait_until="load")
        page.wait_for_selector('#hero-reveal .reveal-rich svg [data-hero-seated]', timeout=READY_MS)
        got = page.evaluate("""() => {
            const rich = document.querySelector('#hero-reveal .reveal-rich svg');
            const flat = document.querySelector('#hero-reveal .reveal-png');
            return {seated: rich.querySelectorAll('[data-path$="-occupant"][data-ref]').length,
                    marks: rich.querySelectorAll('.pt-mark, .pt-label').length,
                    callout: document.querySelectorAll('#hero-reveal .reveal-callout, #hero-reveal [data-callout]').length,
                    lampsOn: rich.querySelectorAll('[data-path^="led-port-"][data-state="on"]').length,
                    flatKids: flat.parentElement.querySelectorAll('svg, [data-cable]').length}; }""")
        if got["seated"] < 21: bad.append(f"hero: {got['seated']} seated occupants, expected at least 21")
        if got["marks"] or got["callout"]: bad.append(f"hero: marks/badges/callout still drawn ({got})")
        if got["lampsOn"] < 21: bad.append(f"hero: only {got['lampsOn']} port lamps on")
        if got["flatKids"]: bad.append("hero: the flat PNG side carries drawing")
```

  `data-hero-seated` is an attribute the hero sets on the rich SVG once seating is done. `data-state` is how the hero records a lamp's state; match whatever the existing lamp code sets, and read it before writing this check. Run the walk (foreground, 600000 ms, to a file). Expected: FAIL.

- [ ] **Step 3: Rewrite the link table.** In `site/hero-reveal.js`, give every `PORTS` row a `jacket` and a `seat`. Keep `state`, `speed`, `note` and `lanesUp`; `label` becomes caption text only. Parts per link type:

```js
const LC = port => ({[port]: 'generic/sfp-lc@1',
  [`${port}-occupant/tx`]: 'generic/lc-plug@2', [`${port}-occupant/rx`]: 'generic/lc-plug@2'});
const QLC = port => ({[port]: 'generic/qsfp-lc@2',
  [`${port}-occupant/tx`]: 'generic/lc-plug@2', [`${port}-occupant/rx`]: 'generic/lc-plug@2'});
const ONE = (port, ref) => ({[port]: ref});
```

  | Rows | seat | jacket |
  |---|---|---|
  | `port-4` to `port-7`, `port-20`, `port-21` (25G SR) | `LC(port)` | `'mm'` |
  | `port-44`, `port-45` (25G LR) | `LC(port)` | `'sm'` |
  | `port-12` to `port-15` (25G DAC) | `ONE(port, 'generic/sfp-cable@1')` | `'dac'` |
  | `port-28`, `port-29` (10G DAC) | `ONE(port, 'molex/sfp-plus-passive-dac@1')` | `'dac'` |
  | `port-36`, `port-37` (25G AOC) | `ONE(port, 'generic/sfp-cable@1')` | `'mm'` |
  | `port-64` (was SR4, now 100G AOC) | `ONE(port, 'fs/qsfp28-aoc@1')` | `'mm'` |
  | `port-70` (was SR4, now 100G AOC) | `ONE(port, 'siemon/qsfp28-aoc@1')` | `'mm'` |
  | `port-67` (100G LR4) | `QLC(port)` | `'sm'` |
  | `port-71` (4 × 25G breakout) | `ONE(port, 'amphenol/qsfp28-passive-dac@1')` | `'dac'` |
  | `oob` (1G management) | `ONE('oob', 'generic/rj45-plug@1')` | `'cu'` |

  For `port-64` and `port-70`, change `label` to `'AOC'`, and add a sentence to the rows' notes saying they are 100G AOCs. Keep `port-70`'s `lanesUp: 3` and its "lane 4 down" note. Rewrite the block comment above `PORTS` to say:
  - the badges are gone;
  - each row names the real part it seats;
  - the SR4 rows are AOCs because the library has no MPO QSFP optic (spec §3);
  - no floating callout.

- [ ] **Step 4: Seat the parts, and remove the marks, badges and callout.** In `heroReveal`, after the SVG is parsed and appended (it must be in the document, because the kit reads CTMs):

```js
import {applyFaceOverrides} from '../vendor/swap.js';
import {jdist} from '../vendor/dist.js';

export async function seatHero(svg) {
  const idx = await jdist('assets/dist/s9600-72xc.configs.json');
  const comps = (await jdist('assets/dist/components.json')).components;
  const byRef = ref => comps.find(c => `${c.ns}/${c.name}@${c.major.slice(1)}` === ref.split(':')[0]);
  const loadSkin = async ref => {
    const c = byRef(ref);
    if (!c) return null;
    const skin = c.skins?.includes('default') ? 'default' : c.skins?.[0];
    const r = await fetch(`assets/dist/components/${c.ns}--${c.name}--${c.major}--${skin}.svg`);
    return r.ok ? {comp: c, text: await r.text()} : null;
  };
  const overrides = Object.assign({}, ...Object.values(PORTS).map(p => p.seat || {}));
  const res = await applyFaceOverrides(svg, {bays: idx.bays?.front || [], cages: idx.cages?.front || []},
                                       overrides, loadSkin, byRef);
  svg.setAttribute('data-hero-seated', String(res.applied));
  return res;
}
```

  - Delete the `pt-mark`/`pt-label` loop.
  - Delete the callout: its element, its pointer handlers, its well in the stage, and the related CSS in `site/site.css` (`.reveal-callout`, the well padding comment). Keep the slider handle and `--split`.
- [ ] **Step 5: Lamps (F1).** Keep the chassis LEDs and the `02` display as they are. For every row:
  - light its port lamps `on`, using `lanesFor` for how many lanes a QSFP28 port lights (`port-70` lights 3 of 4);
  - leave every other port lamp `off`;
  - set state through the face's declared states, as the existing lamp code does.

  Update `lanesFor`'s `OPTIC_LANES` for the new labels (`AOC`: 4 on a QSFP28 port, 1 on an SFP).
- [ ] **Step 6: Run both suites.** Contract: all pass. Browser: `hero_parts` passes. If `seated` or `lampsOn` is off by a few, read the actual DOM and fix the CODE or the check's selector to what the face really carries. Never lower the expected counts below the table's 21 rows.
- [ ] **Step 7: Commit:** `git commit -m "hero: every link seats its real part; lamps say up; no badges or callout"`, with the trailer.

---

### Task 3: Cables that fade at the sides, and the caption line

**Files:** Modify `site/hero-reveal.js`, `site/site.css`, `index.html` (the caption element under the 2D frame), `check-browser.py`.

**Interfaces:** Consumes `PORTS`, `seatHero` (Task 2), and `JACKETS`, `colorOfJacket`, `sag2d`, `WIDTH` and `plugAt` (`cables.js`), plus `cablePoints` (`relief.js`). Produces `[data-hero-caption]` under the 2D frame, and `[data-hero-cable="<port>"]` groups.

- [ ] **Step 1: Failing browser checks.**

```python
    def hero_cables():
        page.goto(f"{base}/index.html", wait_until="load")
        page.wait_for_selector('#hero-reveal [data-hero-cable]', timeout=READY_MS)
        rows = page.evaluate("""async () => {
            const {cablePoints} = await import('/vendor/relief.js');
            const svg = document.querySelector('#hero-reveal .reveal-rich svg');
            const inv = svg.getScreenCTM().inverse();
            const pts = cablePoints(svg).map(p => { const q = new DOMPoint(p.at[0], p.at[1])
                .matrixTransform(inv.multiply(p.el.getScreenCTM())); return {path: p.path, x: q.x, y: q.y}; });
            return [...svg.querySelectorAll('[data-hero-cable]')].map(g => {
                const port = g.dataset.heroCable;
                const d = g.querySelector('path[data-main]')?.getAttribute('d') || '';
                const m = d.match(/^M\\s*([-\\d.]+)[ ,]([-\\d.]+)/);
                const mine = pts.filter(p => p.path === port + '-occupant' || p.path.startsWith(port + '-occupant/'));
                return {port, starts: m ? [+m[1], +m[2]] : null, near: mine.some(p => m && Math.hypot(p.x - +m[1], p.y - +m[2]) < 12)};
            }); }""")
        if len(rows) < 21: bad.append(f"hero: {len(rows)} cables, expected one per link (21)")
        off = [r["port"] for r in rows if not r["near"]]
        if off: bad.append(f"hero: cables not starting at their connector {off}")
        cap = page.inner_text('[data-hero-caption]')
        if "port-67" not in cap: bad.append(f"hero: the caption's default is not port-67 ({cap!r})")
        page.hover('[data-hero-cable="port-13"] path[data-main]', force=True)
        if "port-13" not in page.inner_text('[data-hero-caption]'):
            bad.append("hero: hovering port-13's cable did not name it in the caption")
        page.mouse.move(0, 0)
        # Painting order: a cable whose top connector is higher comes later in the DOM.
        order = page.evaluate("""() => [...document.querySelectorAll('#hero-reveal [data-hero-cable]')].map(g => +g.dataset.top)""")
        if order != sorted(order, reverse=True):
            bad.append("hero: cables are not painted higher-in-front")
```

  Each group carries `data-top`: the smallest y of its connectors. Run the walk. Expected: FAIL.

- [ ] **Step 2: Draw the cables.** In `hero-reveal.js`, after `seatHero`:
  - For each row, collect its connector points with `cablePoints(svg)` filtered by `plugAt(cp.path, port)`, mapped into the SVG's user space through each marker's CTM, exactly as `cables.js`'s `ends2d` does.
  - Join two points (an optic's `tx`/`rx` plugs) about 6 mm below them, as a short strand pair; the cable proper starts at the join. One point starts the cable itself.
  - **Path:** from the start, drop with the showcase's sag, then sweep to the nearer side (`x < 218` goes left) and run past the frame's edge, to `-44` or `480` in the face's 436-wide space. Use `sag2d(dist, fan)` for the drop:

```js
const sweep = (a, fan) => {
  const left = a[0] < 218, ex = left ? -44 : 480;
  const ey = 104 + (fan % 9) * 3.2;
  const s = sag2d(Math.abs(ex - a[0]), fan);
  return `M${a[0]} ${a[1]} C${a[0]} ${a[1] + s} ${left ? ex + 60 : ex - 60} ${ey} ${ex} ${ey}`;
};
```

  - Widen the rich SVG's viewBox by 44 on each side and about 60 below, so the tails have room. Also widen the left PNG frame by the same amounts (padding only), so the slider's split line still aligns.
  - Put all cable groups inside one `<g mask="url(#hero-side-fade)">`. The mask is a horizontal gradient: opaque over the device's width, fading to 0 over the outer 44 on each side.
  - Paint the groups sorted by `data-top` descending, so higher connectors come later and sit in front.
  - Each group is `<g data-hero-cable="port-N" data-top="…" tabindex="0">`. It holds a dark edge path, a colored path (`stroke = colorOfJacket(row.jacket)`, `stroke-width = WIDTH * 0.6`, since the hero is at face scale) with `data-main`, and the strand paths.
- [ ] **Step 3: The caption and hover.**
  - Add `<p class="hero-caption" data-hero-caption></p>` under the 2D frame in `index.html`, below the reveal and above the eyebrow.
  - The caption text for a row is `${port} · ${speed} ${label} · ${note}`.
  - Default: `port-67`.
  - On a cable group's `pointerenter` or `focus`: add `cable-on` to the group and `cables-focus` to the layer, and write that row's caption. On leave or blur: restore.
  - On touch: `pointerdown` selects, and tapping outside restores.
  - CSS: `.cables-focus [data-hero-cable]:not(.cable-on) { opacity: .22 }`, and the caption in the site's mono style.
  - The pointer events must not fight the slider. The slider handle keeps its own drag, and cables sit under the handle in z-order.
- [ ] **Step 4:** Run both suites. Expected: all pass, and `hero_cables` passes.
- [ ] **Step 5: Throwaway screenshot.** Save the hero to the workspace as `hero-2d.png`. Check it by eye against the v2 mockup: cables fade at both edges, and nothing runs off the frame.
- [ ] **Step 6: Commit:** `git commit -m "hero: cables hang from their parts and fade at the sides; one caption line names them"`, with the trailer.

---

### Task 4: The 3D panel

**Files:** Create `site/hero-3d.js`. Modify `site/rack3d.js` (`rails: false`), `index.html` (the panel and its import), `site/site.css`, `check-browser.py`, `check-contract.py`.

**Interfaces:**
- Consumes `PORTS` (Task 2), `createRackScene`, `JACKETS`/`colorOfJacket`, `hangPoints3d`/`LEAD` and `plugAt` (`cables.js`), and `cablePoints`.
- Produces `heroThree(host)`.
- Produces the test hook `window.__hero3d = {tubes: [{port, mesh}], pick(port) -> caption}`, only with `?heroprobe=1`.

- [ ] **Step 1: Failing checks.**
  - **Contract:** `index.html` has `id="hero-3d"` and a `[data-hero-caption]` inside that panel. `site/hero-3d.js` imports `createRackScene`, uses `IntersectionObserver`, and passes `rails: false`.
  - **Browser:**

```python
    def hero_3d():
        page.goto(f"{base}/index.html?heroprobe=1", wait_until="load")
        page.locator('#hero-3d').scroll_into_view_if_needed()
        if webglTrouble():
            if not page.query_selector('#hero-3d [data-hero-still]') or "WebGL" not in page.inner_text('#hero-3d'):
                bad.append("hero 3D without WebGL: no still image and note"); return
            return
        page.wait_for_function("() => window.__hero3d && window.__hero3d.tubes.length >= 21", timeout=READY_3D_MS)
        cap = page.evaluate("() => window.__hero3d.pick('port-13')")
        if "port-13" not in (cap or ""): bad.append(f"hero 3D: picking port-13's tube gave {cap!r}")
```

  Use the walk's existing WebGL-trouble helper. Run: FAIL.

- [ ] **Step 2: `rails: false`.** In `createRackScene`, read `opts.rails` (default `true`). When it is `false`, skip building the rail posts, the U numbers and the rail labels. Everything else, including faces, overrides and `cableAnchor`, is unchanged. Comment it as the front-page hero's switch-alone view.
- [ ] **Step 3: `site/hero-3d.js`.**
  - **Lazy build:** an `IntersectionObserver` on the host (`rootMargin: '200px'`) builds once.
  - **Still image:** until the scene is ready, the host shows the compiled front face with `data-hero-still`. If `guard3d` (`site/webgl.js`) fails, the still image stays and a line reads *"3D needs WebGL, which this browser has switched off."*
  - **Scene:** `createRackScene(host, {dist: 'assets/dist/', stack: [{ref: 's9600-72xc', cfg: 'base', ru: 1, label: 'S9600-72XC', overrides}], heightRU: 2, rails: false, background: 0x0E1013})`, then `await sc.build()`. `overrides` merges every row's `seat`.
  - **Tubes:** for each row, `await sc.cableAnchor({ref: 's9600-72xc'}, port)`, which gives the connector points. Then build a tube with `hangPoints3d` from those points to a side point: x = ±(rack half-width + 160), y below the device, z at the lead's reach.
    - Color: `colorOfJacket`, with a `MeshStandardMaterial` that is transparent, and whose far third fades to alpha 0 (a vertex-color alpha ramp along the tube's length, or two segments with the far one at opacity 0.35 then 0.1; say which).
    - Higher connectors get longer leads, as in stage 4.
  - **Studio:** a ground plane that only receives shadows, under the device, with a soft `DirectionalLight` shadow, and a background gradient into `--pt-ground`.
  - **Motion:** auto-turn (`controls.autoRotate = true`, a slow speed) until the first `pointerdown` or `wheel`. Clamp polar angles so the view never goes underneath, clamp the zoom, and pause the render loop when the host is off screen (the same `IntersectionObserver`).
  - **Picking:** a `Raycaster` on `pointermove` against the tube meshes only. On a hit, light that tube, dim the others (opacity 0.22), and write the row's caption into the panel's `[data-hero-caption]`. On a miss, restore the default (`port-67`). A tap does the same on touch.
  - **Test hook:** `?heroprobe=1` sets `window.__hero3d = {tubes, pick(port)}`. `pick` runs the same lighting and caption code for that port's tube and returns the caption text.
- [ ] **Step 4: Markup.** Add to `index.html`, under the 2D panel's caption:

```html
<p class="tagline tagline-3d">The same switch, as a model you can turn over.</p>
<div class="hero-3d" id="hero-3d"></div>
<p class="hero-caption" data-hero-caption></p>
```

  Import `heroThree` in the page's module script, as `heroReveal` is. The panel's `aspect-ratio` matches the 2D frame. The caption wording is a placeholder the user will replace (spec §5); leave a comment saying so.
- [ ] **Step 5: Run both suites.** Expected: all pass. Then a throwaway proof with WebGL and with forced no-WebGL, and a screenshot `hero-3d.png`: the switch alone, the cables fading, the studio shadow.
- [ ] **Step 6: Commit:** `git commit -m "hero: the same cabled switch in 3D, turning, with the same captions"`, with the trailer.

---

## Self-review

- **Spec coverage:**
  - §3 → Task 2 (table, parts, AOC change);
  - §4 → Tasks 2 and 3, with lamps amended by F1;
  - §5 → Task 4;
  - §6: nothing to do;
  - §7 → the checks in Tasks 1 to 4;
  - §8: excluded.
- **Findings binding the tasks:** F1 (lamps are on/off), F2 (seat keys and cable points), F3 (the `cables.js` gate), F4 (`rails: false`).
- **Names used across tasks:** `PORTS`, `seatHero`, `JACKETS`, `colorOfJacket`, `[data-hero-caption]`, `[data-hero-cable]`, `data-top`, `heroThree`, `window.__hero3d`, `rails: false`.
