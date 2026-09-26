# The front-page hero: a cabled switch, in 2D and in 3D

**Date:** 2026-09-26
**Status:** design approved, ready for an implementation plan
**Depends on:** the Portrayal sync to `e9fb842e` or later, which carries roc-ops/Portrayal#621 (cable ends: DAC, ACC, AEC, AOC)
**Reuses:** `site/showcase/cables.js` (sag, colors, higher-ports-in-front), the kit's seat code (`vendor/swap.js`), `vendor/relief.js` `cablePoints`, and `site/rack3d.js`

---

## 1. Why

The hero on `index.html` (`site/hero-reveal.js`) is a before/after slider over the UfiSpace S9600-72XC. The left side is the flat PNG a DCIM gets; the right side is the compiled SVG, with colored boxes and text badges on the used ports (`DAC`, `SR4`, `LR4`, `4x25`) and a callout that follows the pointer.

It was written before Portrayal had pluggables. Now it does:
- **Optics, plugs and connectors** seat through the kit, and `cablePoints` says where each cable leaves.
- **DAC and AOC cable ends** (#621).
- **RJ45 plugs** (#610).
- **Hanging cables** in the showcase.

The user never liked the pop-ups. They want:
- the badges replaced by the real parts;
- cables hanging from them without running off screen;
- hover to name a cable.

Then, as a second panel, the same switch in 3D, rotatable, because the 2D and 3D drawings are the two things a visitor should see.

## 2. Decisions

| # | Question | Decision |
|---|---|---|
| D1 | Keep the before/after slider? | **Yes.** The left stays the flat PNG, with no parts or cables. The right becomes the real cabled switch. |
| D2 | Where do the cables go? | **They sweep to the nearer side and fade out** at the frame's edges (the mockup's B, v2). No cable managers. They never leave the frame. |
| D3 | Pop-ups | **None.** Hovering or tapping a cable brings it to the front, dims the rest, and fills **one fixed caption line** under the frame. |
| D4 | Status | **On the device's own lamps**, not colored boxes. |
| D5 | 3D | **A second panel below:** the same switch, parts and cables in 3D, turning slowly, orbitable, with the same captions on hover. |
| D6 | 3D background | **A dark studio with a soft floor shadow** for now. It can be revisited with mockups later. |
| D7 | Phasing | **One spec, two phases:** the 2D panel first (it ships on its own), then the 3D panel. |

## 3. One link table for both panels

The hero's `PORTS` table becomes the single source both panels read. Each row keeps its current facts:
- `state`: `up`, `service` or `attention`;
- `speed`;
- `note`: the caption text;
- `lanesUp`: for the degraded link.

Each row also gains:
- `seat`: the override map that seats the row's real part, keyed as the kit keys swaps. This is the part plus its plug(s), where the part takes plugs.
- `jacket`: the cable's color class, one of `mm` (aqua, multimode or AOC), `sm` (yellow, single-mode), `dac` (black, twinax) or `cu` (blue, copper).
- `label`: the caption's link type (`SR`, `LR4`, `DAC`, …). It is **text in the caption**, never drawn on the device.

**Parts per link type.** The implementation reads the exact refs and seat keys off the synced dist; the contract proves each one (§7).

| Link type | Cage | Part seated | Plug(s) | `jacket` |
|---|---|---|---|---|
| 25G SR | SFP28 | `generic/sfp-lc@1` | an LC duplex plug in its cage | `mm` |
| 25G LR | SFP28 | `generic/sfp-lc@1` | an LC duplex plug | `sm` |
| 25G / 10G DAC | SFP28 | the Molex SFP+ DAC cable end, or `generic/sfp-cable@1` | none: the cable end is the connector | `dac` |
| 25G AOC | SFP28 | `generic/sfp-cable@1` | none | `mm` |
| 100G LR4 | QSFP28 | `generic/qsfp-lc@2` | LC plugs in its `tx`/`rx` cages | `sm` |
| 100G SR4 | QSFP28 | a QSFP28 AOC cable end (FS or Siemon) | none | `mm` |
| 4 × 25G breakout | QSFP28 | a QSFP28 DAC cable end (Amphenol) | none | `dac` |
| 1G management | RJ45 `oob` | `generic/rj45-plug@1` | none | `cu` |

**One change to the illustrative link data.** The library has no MPO-connector QSFP optic, which is what a real SR4 uses. So the two SR4 links become 100G AOCs, and their notes say so. The hero's link data is illustrative and says so in the code; with this change, every link is a real part.

## 4. The 2D panel (phase 1)

- **The right side of the slider:** the compiled S9600 front face, with each row's `seat` applied through the kit's face-level seat pass. This is the same code path the showcase uses (`applyFaceOverrides`, with the device's `configs.json` cages and bays and the component index).
- **Cables:**
  - Each connector's start point is read with `cablePoints` on the seated face. That gives the plugs' points for optics, the stub's far end for a cable end (#621 puts the cable point on the stub's `cyl`), and the plug's point for RJ45.
  - The cable hangs with the showcase's sag rule. It then sweeps toward the nearer side and runs past the frame edge, under a horizontal fade mask, so it fades out at the edges.
  - Duplex strands merge as in the showcase. Cables are painted in the showcase's order, **higher ports in front**, and their colors come from `cables.js`'s table by `jacket`.
  - The cable layer is drawing. Hover state is UI.
- **Amendment (2026-09-26, plan finding F1):** the S9600's port lamps declare only `off on`, so a lamp cannot show amber. Up links light `on`, the degraded 100G link lights 3 of its 4 lane lamps, and "wants a look" (the rising CRC errors) is carried in the caption only. The "Lamps" item below is superseded where it says amber.
- **Lamps:**
  - `up` rows light their port lamps green;
  - `attention` rows light them amber;
  - the degraded 100G link lights 3 of 4 lane lamps;
  - `service` rows light them green (the vni is in the caption);
  - the chassis LEDs and the `02` display stay as today.

  The `pt-mark` boxes and `pt-label` badges are removed.
- **Caption:**
  - One fixed line under the frame (`[data-hero-caption]`), in the site's mono style. With nothing hovered, it names the default port (`port-67`), so it is never empty.
  - Hovering or focusing a cable, or tapping it on touch, brings that cable to the front, dims the others, and writes its caption: `port-67 · 100G LR4 · vni 110100 · to border-2`.
  - Each cable group is focusable, for keyboard use.
- **Removed:** the callout that follows the pointer, and its well.
- **The slider:** it reveals the right side as today. The left PNG is untouched: no parts, no cables, no caption changes on that side.
- **Caption above the panel:** the existing tagline stays: *"A picture is worth a thousand words. An addressable picture answers questions."*

## 5. The 3D panel (phase 2)

- **Placement:** a second panel under the 2D one, with its own caption line above it. The wording is to be written with the user; working text: *"The same switch, as a model you can turn over."*
- **Scene:**
  - the S9600 alone, through `rack3d.js`'s `createRackScene` with a one-device stack and the rows' `seat` maps as its overrides, so the parts are seated in 3D by the kit;
  - cables as tubes, built from `cables.js`'s 3D half: the anchor at each connector's cable point (`cableAnchor`), a lead out, then a catenary sweep toward the nearer side;
  - each tube fades out toward its far end (vertex alpha, or a material alpha ramp) before the frame's edge, matching 2D;
  - higher ports get the longer leads, as in stage 4.
- **Background:** a dark studio, a soft ground shadow under the switch, and the page's `--pt-ground` at the edges, so the fading tubes read as deliberate.
- **Motion:**
  - a slow automatic turn until the visitor interacts;
  - drag to orbit, within limits that keep the front readable (no flipping underneath);
  - wheel or pinch to zoom, within limits.
- **Picking:** the pointer over a tube (a raycast against the cable meshes only) lights that cable, dims the others, and writes the same caption text as 2D into this panel's caption line. A tap on touch does the same. The default caption is `port-67`, as in 2D.
- **Loading:**
  - The scene is built only when the panel scrolls near the viewport (IntersectionObserver). Until then, and while it builds, the panel shows a still image of the switch: the compiled front face, which is already on the page, costs no build step and always matches the device.
  - **No WebGL (R11-style):** the still image stays, with one line saying 3D needs WebGL. Nothing else on the page is affected.
- **Performance:** one device, rendered once at load, and the turn pauses when the panel is off screen.

## 6. What does not change

The rest of `index.html`, the showcase, and the flat PNG side.

## 7. Testing

**Contract** (every check records on every run):
- Every `PORTS` row's `seat` names components that exist in `components.json`, and each seat is accepted by its cage or bay on the S9600's front face, including plugs in optic cages and on cards, as the patching plan's checks do.
- Every row has a `jacket` in `{mm, sm, dac, cu}` and a caption `note`.
- `hero-reveal.js` draws no `pt-mark` or `pt-label` and creates no floating callout.
- Cable colors come from `cables.js`; the hero keeps no color table of its own.

**Browser walk** (phase 1):
- The right side has every row's part seated, where the row's port carries a `data-ref` of that part (or its occupant does), and one cable per row starting on its connector's `cablePoints` point.
- The left PNG side has no parts, no cables and no caption hooks.
- Hovering a cable writes its caption into `[data-hero-caption]`, and leaving restores the default.
- There is no floating callout element.
- Painting order follows "higher in front".

**Browser walk** (phase 2):
- Scrolling to the 3D panel builds the scene: one device, and one tube per row.
- A raycast pick at a tube's midpoint writes that row's caption.
- Without WebGL, the still image and the note show, and the page has no errors.

## 8. Out of scope

- Choosing the 3D background from mockups (D6 leaves it for later).
- Clicking a port to open Explorer.
- Live data.
- Any change to the showcase stages.
