# Showcase Inspect is Explorer: removable parts, module swaps, config dropdowns, and 3D in the lens

**Date:** 2026-09-25
**Status:** design approved, ready for an implementation plan
**Builds on:** `2026-09-25-showcase-2d-first-design.md` (merged in roc-ops/portrayal-site#23)

---

## 1. Why

The user's third round of feedback was about the device lens (Inspect):

1. **R740xd.** Explorer lets you remove the front bezel to see the drives behind it, and take off the system cover to see what's under it. Inspect lets you do neither.
2. **Configurations are a wall of buttons.** The R740xd has 40, and you have to scroll to see them. This should be a dropdown.
3. **The 2D/3D switch does nothing while a lens is open.** By design, a spoke has always been a 2D face. The user expects to see the device in 3D.
4. **Inspect can't swap modules.** On the ASR-9006, Inspect shows six blank slot covers with no way to seat a card, and that holds even when you enter from stage 2 (Populate). The same goes for the FHD-1UFCE's cassettes.
5. **The FHD-1UFCE opens empty.** It should default to its populated configuration rather than the empty `base`.

**Explorer already does items 1–4.** It is the Portrayal kit's device shell, `createShell` from `vendor/shell.js`, plus about 400 lines of glue in `explorer.html` for 3D, pulled parts and swap sync. The shell renders config and view as `<select>`s. It has an occupant `<select>` that swaps a bay's module and an optic `<select>` for cages. It also provides `setPulled` for removable parts.

**Why not mount the shell inside the showcase page:** `shell.js` injects page-wide CSS (`body` becomes a full-height flex column; `header`, `main`, `button` and `select` are all restyled), and it finds its elements by global id. Mounted inside `index.html`, it would restyle the whole showcase. It is also vendored from upstream, so scoping it here would be overwritten by the next sync. That is why Explorer is its own page.

**Decision (option A, approved):** Inspect *is* Explorer, embedded in a same-origin frame. Option B (an "Open in Explorer" link) was rejected because you leave the showcase and your swaps don't come back. Option C (rebuilding these features into the showcase's lens) was rejected because it would duplicate about 1,850 lines of kit shell plus Explorer's glue.

---

## 2. Explorer gains an embed mode

`explorer.html` is a site file, not a vendored one. When the page is loaded with `?embed=1`:

- **The site chrome is hidden.** The top bar and site `<nav>` are not shown.
- **The shell's device picker (`#devpick`) is hidden.** A lens is about one device, and changing device inside it would break "back to stage N".
- **Explorer's own 2D/3D buttons (`#mode`) are hidden.** The showcase's switch is the only one on screen.
- **Everything else stays:** the config and view dropdowns, the occupant and optic dropdowns, pulling parts, the parts tree, the inspector, and the FRU box.
- **A small API is exposed on `window`,** only in embed mode:

  ```js
  window.portrayalEmbed = {
    ready,          // a Promise that resolves once the shell has loaded the device (shell.ready)
    setMode(m),     // '2d' | '3d', Explorer's own setMode
    current(),      // -> {device, config, view, mode, swaps, pulled}
                    //    swaps  = swapsNow(shell), a plain object
                    //    pulled = shell.pulledPaths(), the parts currently removed
  };
  ```

  The showcase uses this API and nothing else inside the frame. It does not click hidden buttons, parse the frame's URL, or reach into the frame's DOM.

Without `embed=1`, Explorer is exactly as it is today.

---

## 3. Inspect opens Explorer in a frame

Every way into Inspect opens the frame instead of today's inline Inspect lens. That covers clicking a device on the 2D drawing, the "Look closer" strip, and the spoke's lens bar.

- **The frame's URL** is `explorer.html?embed=1&device=<ref>&config=<the cast cfg>&view=front&swap=<encodeSwaps(overrides[ref])>`. It uses `swap.js`'s `encodeSwaps`, and Explorer reads all four parameters today. The keys are compatible: Explorer's swaps are a delta against the configuration's defaults, keyed by bay id or cage id, with the component ref as the value, and so are the showcase's `overrides[ref]`.
- **Where the frame goes:** it fills the stage and side-panel area while the lens is open. The showcase's breadcrumb ("‹ back to stage N · Name") stays above it, and so do the 2D/3D switch and the ladder, dimmed and still clickable as today.
- **Loading:** the showcase shows its scrim ("Opening <device> in Explorer…") until `portrayalEmbed.ready` resolves. It then applies the current mode with `setMode(mode)` and removes the scrim. Loading is lease-guarded like every other stage write: if the visitor moves on before `ready`, the frame is removed and nothing paints.
- **Mode:** while the lens is open, the showcase's 2D/3D switch calls `portrayalEmbed.setMode(m)`. The frame opens in whichever mode the showcase is in. This fixes §1.3.
- **Swaps flow back on close.** However the lens is closed (back, a rung click, or any other leave), the showcase reads `portrayalEmbed.current()` before removing the frame:
  - If `config` is still the cast configuration, it replaces `overrides[ref]` with `swaps`. A module swapped in Inspect is then seated in the rack at stages 1–3 and 6, and stage 2's refusal logic still applies to anything seated afterwards.
  - If the visitor switched to another configuration, it doesn't write back. Swaps are relative to a configuration's defaults, so they wouldn't mean the same thing on the cast's configuration. The panel of whichever stage the visitor lands on shows one line: *"Your swaps in <config> stayed in the lens; the rack uses <cast cfg>."* It's written through that stage's lease, so it never shows up on a stale entry.
- **Callouts, Live state and Select** are unchanged. They stay the showcase's own lenses, AS7726-32X only (R23), drawn on the inline face as today.

## 4. FHD-1UFCE defaults to `populated`

In `site/showcase/rack.js`, the `CAST` entry for `fhd-1ufce` changes from `cfg: 'base'` to `cfg: 'populated'`, the enclosure with its four cassettes, as its index describes. Its cassette bays can then be swapped in Inspect like any other bay. Stage 1's fit arithmetic is unchanged, because it is still 1U.

---

## 5. Testing

**Contract** (records on every run):
- `explorer.html` checks for `embed` and, when it is set, defines `window.portrayalEmbed` with `ready`, `setMode` and `current`.
- The cast's `fhd-1ufce` config is `populated`, and that configuration exists in its `configs.json`.
- `spoke-host.js` builds the Inspect frame URL with `encodeSwaps`. There must be no hand-rolled `swap=` encoding.

**Browser walk** (`check-browser.py`):
1. Open Inspect on the **ASR-9006** from stage 2. Wait for the frame's `portrayalEmbed.ready`. Assert that the device picker and Explorer's mode buttons are hidden inside the frame.
2. Swap a slot's module through the frame's occupant `<select>`, choosing a line card the slot accepts. Close the lens, and assert that stage 2 now shows it seated.
3. With the lens open, flip the showcase to **3D**. Assert that `portrayalEmbed.current().mode === '3d'`, and that Explorer's 3D stage is visible in the frame.
4. Open Inspect on the **R740xd**. Pull a part (the bezel) through the frame's inspector, and assert that `portrayalEmbed.current().pulled` includes it. This proves removable parts work in the lens.
5. Open Inspect, switch config inside the frame, then close. Assert that `overrides` is unchanged and the panel shows the "stayed in the lens" line.

---

## 6. Order of work

1. **FHD `populated`** (§4). One line, plus its contract check.
2. **Explorer embed mode** (§2), with the contract check. Explorer without `embed` is unchanged.
3. **Inspect opens the frame** (§3): seeding, the loading scrim, mode forwarding, and write-back on close with the config rule. Browser walk items 1–3 and 5.
4. **Removable parts proof** (walk item 4). This needs no new code if §2 and §3 are right, so it may fold into step 3.

## 7. Out of scope

- **Clicking devices in the 3D canvas** to open a lens. The strip still covers 3D.
- **Carrying pulled parts** (bezel off) back to the rack. That state stays in the lens.
- **Explorer's other pages and shell behaviour.** Nothing changes outside `embed=1`.
- **Making `shell.js`'s CSS scopable upstream.** This would allow embedding the shell without a frame someday, and is worth filing as a roc-ops/Portrayal issue. This design does not depend on it.
