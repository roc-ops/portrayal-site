# Showcase Inspect-is-Explorer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the showcase's Inspect lens *be* Explorer, embedded in a same-origin frame. That gives the lens removable parts, module and cassette swaps, config and view dropdowns, and a working 2D/3D switch. It also makes the FHD-1UFCE open populated.

**Architecture:**
- `explorer.html` gains an `embed=1` mode. It hides the site bar and its own 2D/3D buttons and exposes `window.portrayalEmbed = {ready, setMode, current}`.
- Opening Inspect puts a frame over the stage and side panel, seeded from the rack with `device`/`config`/`view`/`swap=encodeSwaps(overrides[ref])`.
- While the lens is open, the showcase's switch drives the frame's mode through the API.
- On close, the frame's swaps are written back into `overrides`, but only when it is still on the cast configuration. Otherwise the landing stage shows a one-line notice.
- Callouts, Live state and Select stay the showcase's own inline lenses.

**Tech Stack:** vanilla ES modules, no npm. The kit's `vendor/shell.js`, `vendor/swap.js` (`encodeSwaps`) and `site/optics.js` (`swapsNow`). Python 3.12 checks, and Playwright in `check-browser.py`.

**Spec:** `docs/superpowers/specs/2026-09-25-showcase-inspect-is-explorer-design.md`

## Global Constraints

- **The showcase talks to the frame only through `window.portrayalEmbed`** (`ready`, `setMode`, `current`). It never clicks hidden buttons inside it, parses its URL, or reaches into its DOM. The browser *tests* may drive Explorer's own UI inside the frame, because that is how a person would use it.
- **Without `embed=1`, Explorer is exactly as it is today.**
- **Write swaps back only when the frame's `config` equals the cast `cfg`** for that device. Otherwise the landing stage shows exactly: *"Your swaps in <config> stayed in the lens; the rack uses <cast cfg>."*
- **The frame URL's `swap=` comes from `encodeSwaps`** (`vendor/swap.js`). It carries its own escaping, so it is appended raw, never through `URLSearchParams`.
- **Stage UI writes go through the lease.** After every await, check `ui.live()` before touching anything. A lens opened by a click the visitor has since overtaken must not paint, show a frame, or write `overrides`.
- **Nothing fabricates data.** Labels come from the cast and the index.
- **Every contract check records on every run.**
- **No npm, and no JS test runner.** Tests are `python3 check-contract.py` and `python3 check-browser.py`, which starts its own server. Save the browser check's full output to a file and never pipe it through `tail`.
- **Don't touch** ports 8177/8178, `.gitignore:26`, or bare `git stash`. `vendor/` is upstream's; don't edit it.
- **Commits end with** `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

## File Structure

| file | responsibility |
|---|---|
| `site/showcase/rack.js` | **Modify.** The `fhd-1ufce` cast entry uses `cfg: 'populated'`. |
| `explorer.html` | **Modify.** An `embed=1` flag: hide `.site-bar` and `#mode`, and define `window.portrayalEmbed`. |
| `index.html` | **Modify.** Add a `#lensFrame` host inside `.show-body`. |
| `site/site.css` | **Modify.** When a frame is open, the frame replaces the stage and side panel. |
| `site/showcase/spoke-host.js` | **Modify.** Inspect becomes a frame lens: `openFrame`, the read-back on close, and `lensMode`. |
| `site/showcase/stage-rail.js` | **Modify.** `setMode` forwards to an open lens; add `notice(text)`, shown once on the next stage entered. |
| `site/showcase/spokes/inspect.js` | **Delete.** The frame replaces it. |
| `check-contract.py`, `check-browser.py` | **Modify.** |

### Interfaces shared across tasks

```js
// explorer.html, only when ?embed=1
window.portrayalEmbed = {
  ready,        // Promise<void>: resolves when the shell has loaded the device and applied swap=
  setMode(m),   // '2d' | '3d' -> Promise<void>: Explorer's own setMode
  current(),    // -> {device, config, view, mode, swaps, pulled}
};

// stage-rail.js
export function notice(text);  // shown once, as <p class="panel-notice" role="status">, atop the next stage entered

// spoke-host.js
export function lensMode(m);   // an open frame lens follows the showcase's switch; no-op otherwise
```

---

## Task 1: The FHD-1UFCE opens populated

**Files:** modify `site/showcase/rack.js` (the `CAST` entry for `fhd-1ufce`, about line 44) and `check-contract.py`.

**Interfaces:** Produces the cast `cfg: 'populated'` for `fhd-1ufce`, which Task 3 seeds into the frame.

- [ ] **Step 1: Write the failing check.** Add this to `check-contract.py`, near the existing cast-vendored checks:

```python
# THE FHD-1UFCE OPENS POPULATED. Its `base` is an empty tray; the showcase is
# about what a rack holds, so it opens with its four cassettes - and the
# configuration named must exist in the device's own index.
cast_src = (HERE / "site" / "showcase" / "rack.js").read_text()
m = re.search(r"\{ref:\s*'fhd-1ufce',\s*cfg:\s*'([^']+)'", cast_src)
fhd_cfg = m.group(1) if m else None
check(fhd_cfg == "populated", "the cast FHD-1UFCE opens in its populated configuration",
      f"cfg is {fhd_cfg!r}")
fhd_idx = jload("fhd-1ufce.configs.json") or {}
check(any(c.get("name") == "populated" for c in fhd_idx.get("configs", [])),
      "fhd-1ufce's index carries a 'populated' configuration")
```

- [ ] **Step 2: Run it and confirm it fails.** Run `python3 check-contract.py`. You should get a FAIL: `cfg is 'base'`.
- [ ] **Step 3: Change the cast entry.** In `rack.js`, change `{ref: 'fhd-1ufce',  cfg: 'base', …}` to `cfg: 'populated'`.
- [ ] **Step 4: Run both checks.** `python3 check-contract.py` should be green. Run `python3 check-browser.py > <scratch>/b.log 2>&1` and read the log; it should be green. Stage 1's fit arithmetic is unchanged because the enclosure is still 1U. Confirm that the stage 1 2D drawing now shows four cassettes in the FHD, with a throwaway screenshot.
- [ ] **Step 5: Commit.**

```bash
git add site/showcase/rack.js check-contract.py
git commit -m "showcase: the FHD-1UFCE opens with its four cassettes, not an empty tray

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 2: Explorer's embed mode

**Files:** modify `explorer.html` (its `<style>`, and the end of its module `<script>`), `check-contract.py` and `check-browser.py`.

**Interfaces:** Produces `window.portrayalEmbed` as above. Consumes the shell's `ready`, `state` and `pulledPaths()`, `swapsNow` from `site/optics.js` (already imported by the page), and the page's own `setMode` and `mode`.

Two facts already hold. **The shell hides its device picker by itself inside a frame** (`vendor/shell.js`, around line 1780: `parent === window` mounts the picker, and otherwise `el.dev.hidden = true`). And it applies `swap=` on load when the URL names the device. So embed mode only has to hide the site bar and Explorer's own mode buttons, and expose the API.

- [ ] **Step 1: Write the failing checks.** Contract:

```python
# EXPLORER'S EMBED MODE. The showcase's Inspect lens is Explorer in a frame;
# it talks to the frame only through window.portrayalEmbed.
ex = (HERE / "explorer.html").read_text()
check("get('embed') === '1'" in ex or 'get("embed") === "1"' in ex,
      "explorer.html reads ?embed=1")
for k in ("portrayalEmbed", "ready", "setMode", "current"):
    check(k in ex, f"explorer.html's embed API carries {k}")
```

Browser: add a page-level check to `check-browser.py`, alongside the PAGES loop. It does not belong in `PAGES` itself, which lists plain page loads:

```python
def check_embed(page, base):
    """explorer.html?embed=1: the site bar and mode buttons hidden, the API live."""
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    page.goto(f"{base}/explorer.html?embed=1&device=r740xd&view=front", wait_until="load")
    try:
        page.wait_for_function("() => window.portrayalEmbed", timeout=READY_MS)
        cur = page.evaluate("async () => { await window.portrayalEmbed.ready; return window.portrayalEmbed.current(); }")
        if cur.get("device") != "r740xd":
            bad.append(f"embed: current().device is {cur.get('device')!r}")
        for sel in (".site-bar", "#mode"):
            if page.is_visible(sel):
                bad.append(f"embed: {sel} is visible")
    except Exception as e:
        bad.append(f"embed: {e}")
    return bad
```

Call it in `main()` with its own page, record `ok    explorer embed mode` or the failures, and count it in the summary line. Also confirm that plain `explorer.html` still shows `.site-bar` and `#mode`. It is in `PAGES`; add a two-line visibility check to it.

- [ ] **Step 2: Run both and confirm they fail.**
- [ ] **Step 3: Implement.** Near the top of Explorer's module script, after `const shell = createShell(...)`:

```js
// EMBED MODE. The showcase's Inspect lens is this page in a frame. There the
// site bar is the outer page's, the device is the lens's, and the 2D/3D switch
// is the showcase's - so all three step aside, and the outer page talks to
// this one only through window.portrayalEmbed. Without ?embed=1 nothing here
// changes. (The shell already hides its own device picker inside a frame.)
const EMBED = new URLSearchParams(location.search).get('embed') === '1';
document.body.classList.toggle('embed', EMBED);
```

Put this in Explorer's `<style>`:

```css
body.embed .site-bar, body.embed #mode { display: none; }
```

At the end of the module script, after `setMode` and `mode` are defined:

```js
if (EMBED) {
  window.portrayalEmbed = Object.freeze({
    ready: shell.ready,
    setMode: m => setMode(m),
    current: () => ({
      device: state.device, config: state.cfg, view: state.view, mode,
      swaps: {...swapsNow(shell)},
      pulled: typeof shell.pulledPaths === 'function' ? shell.pulledPaths() : [],
    }),
  });
}
```

`mode` is a `let` in the page script. `current()` reads it when called, so it is always the live value. If `swapsNow` isn't already imported where this runs, import it from `./site/optics.js` as the page already does.

- [ ] **Step 4: Run both checks.** Contract and browser should be green, with the full browser log saved. By eye, `python3 serve.py 8967` and open `explorer.html?embed=1&device=asr-9006` directly. There should be no site bar and no 2D/3D buttons. The config/view dropdowns, tree, inspector and occupant dropdown should all be present. The plain `explorer.html` should be unchanged.
- [ ] **Step 5: Commit.**

```bash
git add explorer.html check-contract.py check-browser.py
git commit -m "explorer: an embed mode for the showcase's lens

?embed=1 hides the site bar and Explorer's own 2D/3D buttons - the outer page
owns both - and exposes window.portrayalEmbed {ready, setMode, current}, the
one way the showcase talks to the frame. Without the flag nothing changes.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 3: Inspect opens Explorer in the frame

**Files:**
- modify `index.html` (inside `.show-body`), `site/site.css`, `site/showcase/spoke-host.js`, `site/showcase/stage-rail.js`, `check-contract.py` and `check-browser.py`
- delete `site/showcase/spokes/inspect.js`

**Interfaces:**
- Consumes: `portrayalEmbed` (Task 2); `CAST` with `fhd-1ufce` populated (Task 1); `overrides` (rack.js); `encodeSwaps` (`vendor/swap.js`); `mode`, `suspend`, `activate` and the lease (stage-rail.js).
- Produces: `lensMode(m)` (spoke-host.js) and `notice(text)` (stage-rail.js).

- [ ] **Step 1: Write the failing checks.**

Contract: update the first staged-rack plan's spoke-file check. It currently loops over `("inspect", "callouts", "state", "select")`, requiring each spoke file and its factory. Make it loop over `("callouts", "state", "select")` and add:

```python
sh = (HERE / "site" / "showcase" / "spoke-host.js").read_text()
check(not (HERE / "site" / "showcase" / "spokes" / "inspect.js").exists(),
      "the inline Inspect lens is gone; Inspect is Explorer in a frame")
check(re.search(r"inspect:\s*\{[^}]*frame:\s*true", sh) is not None,
      "spoke-host's Inspect lens is a frame lens")
check("encodeSwaps(" in sh and "swap=" in sh,
      "the Inspect frame carries the rack's swaps via encodeSwaps")
check(".contentWindow" not in sh.replace("contentWindow?.portrayalEmbed", "").replace("contentWindow.portrayalEmbed", ""),
      "spoke-host reaches into the frame only through portrayalEmbed")
```

Browser: add these to the spoke walk in `check_stages`. Use `page.frame(url=re.compile(r"explorer\.html"))` to get the frame. `EMBED_READY` evaluates `async () => { await window.portrayalEmbed.ready; return true; }` inside the frame.

```python
        # INSPECT IS EXPLORER. Open it on the ASR-9006 from stage 2, seat a line
        # card through Explorer's own occupant dropdown, come back, and the
        # rack has it.
        page.click('.stage-rail button[data-stage="populate"]')
        page.wait_for_selector('[data-stage-ready="populate"]', timeout=READY_MS)
        page.click('[data-spoke-device="asr-9006"][data-spoke-lens="inspect"]')
        page.wait_for_selector('#lensFrame iframe', state="visible", timeout=READY_3D_MS)
        fr = next(f for f in page.frames if "explorer.html" in f.url)
        fr.wait_for_function("() => window.portrayalEmbed", timeout=READY_3D_MS)
        fr.evaluate("async () => { await window.portrayalEmbed.ready; }")
        if fr.is_visible(".site-bar") or fr.is_visible("#devpick") or fr.is_visible("#mode"):
            bad.append("inspect frame: site bar, device picker or mode buttons visible")
        # slot-3 accepts line cards (asr-9006 index); a9k-4x100ge-se@1 is one of them.
        fr.click('#stage-svg [data-path="slot-3"]')
        fr.wait_for_selector("#occ", timeout=READY_MS)
        fr.select_option("#occ", "cisco/a9k-4x100ge-se@1")
        # The showcase's switch drives the frame.
        page.click('#stageMode [data-mode="3d"]')
        fr.wait_for_function("() => window.portrayalEmbed.current().mode === '3d'", timeout=READY_3D_MS)
        if not fr.is_visible("#stage-3d"):
            bad.append("inspect frame: 3D selected but Explorer's 3D stage is hidden")
        page.click('#stageMode [data-mode="2d"]')
        fr.wait_for_function("() => window.portrayalEmbed.current().mode === '2d'", timeout=READY_MS)
        page.click('#spokeBack')
        page.wait_for_selector('[data-stage-ready="populate"]', timeout=READY_MS)
        if "a9k-4x100ge-se" not in page.inner_text("#sidePanel"):
            bad.append("inspect frame: a card seated in Explorer did not come back to the rack")
        # The config rule: switch the FHD to its empty base inside the lens,
        # close, and the rack is unchanged with a notice saying why.
        page.click('[data-spoke-device="fhd-1ufce"][data-spoke-lens="inspect"]')
        fr = next(f for f in page.frames if "explorer.html" in f.url)
        fr.wait_for_function("() => window.portrayalEmbed", timeout=READY_3D_MS)
        fr.evaluate("async () => { await window.portrayalEmbed.ready; }")
        fr.select_option("#cfg", "base")
        page.click('#spokeBack')
        page.wait_for_selector('[data-stage-ready="populate"]', timeout=READY_MS)
        if "stayed in the lens" not in page.inner_text("#sidePanel"):
            bad.append("inspect frame: switching config in the lens gave no notice")
```

If a selector here doesn't exist in Explorer's real DOM (`#stage-svg`, `#occ`, `#cfg`, `#stage-3d` are read from `vendor/shell.js` and `explorer.html`), fix the selector to the real one and note it in your report. Do not change Explorer to fit the test.

- [ ] **Step 2: Run both and confirm they fail.**

- [ ] **Step 3: Add the frame host.** In `index.html`, inside `.show-body` and after `<aside class="show-side">…</aside>`:

```html
          <!-- The Inspect lens: Explorer in a frame, over the stage and panel
               while it is open. site/showcase/spoke-host.js fills it. -->
          <div class="lens-frame" id="lensFrame" hidden></div>
```

In `site/site.css`, read `.show-body`'s real layout first. It is a row: rail, stage, side panel.

```css
.show-body.frame-open #stageHost,
.show-body.frame-open .show-side { display: none; }
.lens-frame { flex: 1 1 auto; min-width: 0; min-height: 560px; position: relative; }
.lens-cover { position: absolute; inset: 0; margin: 0; display: grid; place-items: center;
              background: var(--pt-ground); color: var(--pt-ink-muted); }
.lens-frame iframe { display: block; width: 100%; height: 100%; min-height: 560px;
                     border: 0; background: var(--pt-ground); }
```

If `.show-body` is a grid rather than flex, make `.lens-frame` span the stage and side-panel columns instead, and note it in your report.

- [ ] **Step 4: Inspect becomes a frame lens.** In `spoke-host.js`:

```js
import {encodeSwaps} from '../../vendor/swap.js';
import {CAST, overrides} from './rack.js';   // extend the existing rack.js import if one exists
import {mode, notice} from './stage-rail.js'; // extend the existing stage-rail import

const lensHost = document.getElementById('lensFrame');
const body = lensHost.closest('.show-body');
```

Change the `LENSES` entry to `inspect: {frame: true, label: 'Inspect'},`, delete `import makeInspect`, and delete `site/showcase/spokes/inspect.js`.

In `openSpoke`, right after `const ui = await suspend(); if (!ui.live()) return;`, add:

```js
  if (LENSES[lens].frame) return openFrame({dev, cfg, lens, returnTo, origin, ui});
```

Then add:

```js
// INSPECT IS EXPLORER, IN A FRAME. The kit's shell injects page-wide CSS and
// finds its parts by global id, so it cannot be mounted inside this page; a
// same-origin frame gives it a page of its own. It is seeded from the rack -
// the cast configuration and the swaps already made - and talks back only
// through window.portrayalEmbed.
//
// THE FRAME IS SHOWN AT ONCE, UNDER ITS OWN OVERLAY. Explorer fits its
// drawing to its stage when it loads, and a frame loaded inside a hidden
// container measures zero - it would open mis-fitted. So the host is shown
// immediately at full size, with an overlay saying what is loading, and the
// overlay comes off when Explorer says it is ready. A click that overtakes
// the load removes the whole host, so nothing is left behind.
async function openFrame({dev, cfg, lens, returnTo, origin, ui}) {
  const name = CAST.find(e => e.ref === dev)?.label || dev;
  const q = new URLSearchParams({embed: '1', device: dev, config: cfg, view: 'front'});
  const sw = encodeSwaps(overrides[dev] || {});
  const frame = el('iframe', {title: `${name} in Explorer`,
    src: `explorer.html?${q}${sw ? `&swap=${sw}` : ''}`});   // swap= carries its own escaping
  const cover = el('p', {class: 'lens-cover', role: 'status', text: `Opening ${name} in Explorer…`});
  lensHost.replaceChildren(frame, cover);
  lensHost.hidden = false;
  body.classList.add('frame-open');
  const drop = () => { lensHost.hidden = true; lensHost.replaceChildren(); body.classList.remove('frame-open'); };
  let api = null;
  try {
    await new Promise((res, rej) => {
      frame.addEventListener('load', res, {once: true});
      frame.addEventListener('error', rej, {once: true});
    });
    api = frame.contentWindow?.portrayalEmbed || null;
    if (!api) throw new Error('explorer.html did not expose portrayalEmbed');
    await api.ready;
    if (ui.live()) await api.setMode(mode);
  } catch (err) {
    console.warn('[portrayal] could not open Explorer for', dev, err);
    api = null;
  }
  if (!ui.live()) { drop(); return; }
  if (!api) { drop(); await activate(returnTo); return; }
  cover.remove();
  open = {dev, cfg, lens, frame, api, returnTo, origin};
  hint.textContent = '';
  document.body.classList.add('spoke-open');
  showCrumb();
  frame.focus();
}

// THE SWAPS COME BACK - if they still mean what the rack means. Explorer's
// swaps, like the rack's overrides, are a delta against a configuration's
// defaults; made on another configuration they would say something else on
// the cast's, so they stay in the lens and the stage says so.
function readBack({dev, api}) {
  let cur = null;
  try { cur = api?.current?.(); } catch (err) { console.warn('[portrayal] reading the lens back', err); }
  if (!cur) return;
  const castCfg = CAST.find(e => e.ref === dev)?.cfg;
  if (cur.config === castCfg) overrides[dev] = {...cur.swaps};
  else notice(`Your swaps in ${cur.config} stayed in the lens; the rack uses ${castCfg}.`);
}

// The rail's 2D/3D switch, while a frame lens is open, is the frame's.
export function lensMode(m) {
  if (open?.api) open.api.setMode(m).catch(err => console.warn('[portrayal] lens mode', err));
}
```

In `closeSpoke`, replace `await spoke.exit?.();` and the lines around it with this, so the frame path is handled:

```js
  const was = open;
  open = null;
  panel.replaceChildren();
  exportSlot.replaceChildren();
  if (was.frame) {
    readBack(was);
    lensHost.hidden = true;
    lensHost.replaceChildren();
    body.classList.remove('frame-open');
  } else {
    await was.spoke.exit?.();
    setHost(null);
  }
  document.body.classList.remove('spoke-open');
  crumb.hidden = true;
  stage2d.hidden = true;
```

Then continue exactly as today, using `was.returnTo` and `was.origin`.

**The empty-string swap:** Explorer's `swapsNow` can report an emptied bay as `''`. Confirm that stages 2 and 3 treat a falsy value as "not seated" (`overrides[DEV]?.[b.id]` is falsy for `''`). Also confirm that `build2dElevation` and `mount3d` accept `''` through `swap.js` as "empty this bay". If either does not, report it rather than papering over it.

- [ ] **Step 5: The rail forwards the switch, and shows the notice.** In `stage-rail.js`, `setMode`:

```js
  if (spokeOpen()) { lensMode(m); return; }     // a frame lens follows the switch; an inline one ignores it
```

This goes where the current `if (spokeOpen() || !current) return;` is. Keep the `!current` return below it, and import `lensMode` from `spoke-host.js`.

Add:

```js
// ONE LINE, ONCE, ON THE STAGE THE VISITOR LANDS ON. Written by the rail, not
// by the stage, so it cannot be painted over a stage that has moved on.
let pending = null;
export function notice(text) { pending = text; }
```

In `enterStage`, after `await MODULES[name].enter(...)` succeeds and `!stale(mine)`, add this before setting `data-stage-ready`:

```js
  if (pending && !stale(mine)) {
    panel.prepend(el('p', {class: 'panel-notice', role: 'status', text: pending}));
    pending = null;
  }
```

Add `.panel-notice` to `site/site.css` in the panel's lead style, with a brass left rule.

- [ ] **Step 6: Run both checks.** Contract should be green. For the browser check, save the full log; it should be green, including the new walk. Write a throwaway Playwright proof, not committed, and run it in both WebGL and forced-no-WebGL modes (`page.add_init_script` makes `HTMLCanvasElement.prototype.getContext` return null for the webgl variants). It must cover:
  - open Inspect, then immediately click a rung. No frame is left, the rung's stage is ready, and `overrides` is unchanged.
  - Inspect on all four cast devices opens with their cast configs.
  - A swap made in the lens shows up in stage 1's 2D drawing and in 3D.
  - Switching to Callouts on the AS7726 from an open Inspect frame reads back and removes the frame.
  - Zero pageerrors.
- [ ] **Step 7: Commit.**

```bash
git add index.html site/site.css site/showcase/spoke-host.js site/showcase/stage-rail.js check-contract.py check-browser.py
git rm site/showcase/spokes/inspect.js
git commit -m "showcase: Inspect is Explorer, in a frame

The lens now has what Explorer has - removable parts, module and cassette
swaps, config and view dropdowns, and 3D - because it is Explorer. It opens
seeded from the rack, follows the showcase's 2D/3D switch, and hands its swaps
back on close when they still mean what the rack means; swaps made on another
configuration stay in the lens, and the stage says so.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 4: Proof that removable parts work in the lens

**Files:** modify `check-browser.py`.

This needs no product code if Tasks 2 and 3 are right. The spec asks for proof that the R740xd's bezel comes off inside the lens.

- [ ] **Step 1: Write the check.** In the spoke walk, open Inspect on the R740xd, then pull its bezel through Explorer's own inspector:

```python
        page.click('[data-spoke-device="r740xd"][data-spoke-lens="inspect"]')
        fr = next(f for f in page.frames if "explorer.html" in f.url)
        fr.wait_for_function("() => window.portrayalEmbed", timeout=READY_3D_MS)
        fr.evaluate("async () => { await window.portrayalEmbed.ready; }")
        before = fr.evaluate("() => window.portrayalEmbed.current().pulled.length")
        # Explorer's own control for a removable part: select it, then press the
        # inspector's pull button. Read the real selectors from explorer.html /
        # shell.js (the FRU box and the 'pulled' header chip) before relying on these.
        fr.click('#tree >> text=/bezel/i')
        fr.click('#inspect button:has-text("Remove"), #inspect button:has-text("Pull")')
        fr.wait_for_function(f"() => window.portrayalEmbed.current().pulled.length > {before}",
                             timeout=READY_MS)
        if not any("bezel" in p.lower() for p in fr.evaluate("() => window.portrayalEmbed.current().pulled")):
            bad.append("inspect frame: the R740xd bezel did not come off")
        page.click('#spokeBack')
```

- [ ] **Step 2: Run it and confirm it passes.** Also confirm it would fail if pulling were broken: temporarily make `current()` return `pulled: []`, run it, see the failure, then revert. **If the selectors don't match Explorer's real pull control**, find the real control (the header's `#pulled` chip, or the FRU box in `explorer.html`) and use that. Report which one you used.
- [ ] **Step 3: Commit.**

```bash
git add check-browser.py
git commit -m "check-browser: the R740xd bezel comes off inside the Inspect lens

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**

| spec | task |
|---|---|
| §1.1 removable parts in the lens | 3 (Explorer in the frame), proved by 4 |
| §1.2 config dropdown | 3 (the shell's own `<select id="cfg">`) |
| §1.3 2D/3D works while inspecting | 3 (`lensMode`, the walk's 3D flip) |
| §1.4 module and cassette swaps in the lens, flowing back | 3 (occupant select, `readBack`, walk) |
| §1.5 / §4 FHD populated | 1 |
| §2 embed mode, `portrayalEmbed` including `pulled` | 2 |
| §3 frame URL via `encodeSwaps`, scrim until ready, lease guard, mode, write-back with the config rule and the notice, other lenses unchanged | 3. The "scrim" is an overlay on the frame host, not the stage scrim, because the frame must load at full size to fit its drawing. |
| §5 tests | 1–4 |

**Placeholders:** none. Two places tell the implementer to read the real selectors: Explorer's DOM ids in Task 3, and the pull control in Task 4. Both give a concrete default, a named fallback, and a rule: fix the test, not Explorer.

**Type consistency:** `portrayalEmbed.{ready, setMode, current}` has the same shape in Tasks 2, 3 and 4. `current()` returns `{device, config, view, mode, swaps, pulled}` in each. `lensMode(m)` and `notice(text)` are defined in Task 3 and used only there. `LENSES.inspect.frame` is set and read in Task 3.
