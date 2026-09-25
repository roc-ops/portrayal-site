# Showcase, 2D first — one rail, a 2D/3D switch, a reachable "Look closer", and the ring in 2D

**Date:** 2026-09-25
**Status:** design approved, ready for an implementation plan
**Builds on:** `2026-09-24-showcase-staged-rack-design.md` (the staged rack, merged in roc-ops/portrayal-site#22)

---

## 1. Why

First use of the merged staged showcase turned up four problems:

1. **Stage 0's right rail is mirrored wrong.** Both 2D rails are drawn with the same offsets, so the right rail has its numbers on the inside and its holes on the outside. It should be the mirror image of the left rail: numbers outboard, holes inboard, where a device's ears land between the rails.
2. **Stages 1 onward are 3D only.** The compiled 2D SVG faces are the product. 3D is a second view of the same data. The old showcase had a 2D/3D toggle on its Rack tab; it was dropped when that tab was folded into the stages.
3. **Stage 1's rails aren't stage 0's rails.** `rack3d.js` draws 16 mm silver posts with numbers on the left only. `build2dElevation` draws 26 mm rails with numbers on both. Two renderers, two ideas of a rail.
4. **"Look closer" is buried.** The side panel is clipped at the stage's 520 px. "Look closer" starts about 400 px down, so its buttons fall below the cut and nothing shows that the panel scrolls. The only way to 2D was Inspect, and that was hidden too.

---

## 2. One rail, drawn twice

A new module, `site/showcase/rails.js`, describes the rail **once**. Both `build2dElevation` (rack.js) and `rack3d.js` import it. Neither file keeps its own rail constants.

| property | value | source |
|---|---|---|
| rail face width | 26 mm | the stage 0 rail the user liked |
| opening between rails | 450.85 mm | `INNER`, unchanged |
| hole centre-to-centre across the rack | 465.1 mm (18.312 in) | EIA-310 |
| hole positions within each U, from its bottom | 6.35, 22.22, 38.10 mm (0.25 / 0.875 / 1.5 in) | EIA-310 — rack3d already had these |
| hole size | 6.5 mm square (cage nut) | rack3d's value |
| U numbers | on the **outboard** half of **both** rails | user feedback §1.1 |
| holes | on the **inboard** half of both rails | user feedback §1.1 |

With the opening at 450.85 mm, the rails' inner edges sit at ±225.43 mm. Holes at ±232.55 mm fall 7.1 mm into each rail, inside its inboard half, as they should.

What changes, per renderer:

- **2D:** the right rail becomes a true mirror of the left. Holes move from 22/50/78 % of the U, which is not EIA, to the EIA positions.
- **3D:** posts widen to the 26 mm face and move so their inner edges sit at the opening. Holes move to ±232.55 mm, from ±233.3. U numbers sit on the outboard half of **both** posts, instead of as sprites floating off the left side.

Stage 6's SVG and PNG exports use `build2dElevation`, so they pick up the fix automatically.

---

## 3. The 2D/3D switch

- **Where:** a `2D | 3D` segmented control in the stage header, on the right. It is a real control, with `aria-pressed` on each segment.
- **Default:** **2D.**
- **Scope:** **one switch for the whole ladder.** The choice is remembered across stages, and across visits, in `localStorage`. The read and write are wrapped in `try/catch`, so the page works with storage blocked; it just forgets the choice.
- **Mechanism:** the rail owns `mode`. Switching re-enters the current stage through `activate()`, so the existing stage lease guards the swap the same way it guards a rung click. Each stage reads `ui.mode` on enter.

Per stage:

| stage | 2D | 3D |
|---|---|---|
| 0 Rails | flat rails (today's view, fixed) | the empty rack from `rack3d` |
| 1 Mount | `build2dElevation` with the cast | `mount3d` (today) |
| 2 Populate | 2D elevation redrawn on each seat; the refusal is identical | today |
| 3 Seat optics | 2D elevation, TX bore **highlighted on the face** instead of the portAnchor coordinate | today, portAnchor coordinate shown |
| 4 Cable | the ring by site (§5) | one physical rack (today) |
| 5 Filter | filters the 2D site view (§5) | today |
| 6 Take it away | 2D elevation shown; exports unchanged | today |

Seats and refusals live in `overrides` (rack.js), not in either picture, so a card seated in 2D is there when you switch to 3D, and the reverse.

---

## 4. "Look closer" — on the drawing, with an index strip

- **In 2D, click the thing.** Hovering a device on the elevation outlines it and shows a small lens chip. Clicking it opens that device's spoke: Inspect, plus Callouts, State and Select on the AS7726-32X, per the existing R23. `build2dElevation` already tags every device with `data-device-ref`; the hover and click hook onto those elements. Keyboard users get the same through focusable device groups (Enter opens the spoke).
- **An index strip under the stage,** between the drawing and the footer, always visible, lists every cast device with its lenses. It is how you discover the feature, and it is the **only** entry in 3D, because the canvas cannot be clicked. It replaces the "Look closer" section in the side panel, which is removed.
- **The side panel** holds only the stage's answer again.
- **Where it applies:** the strip and click-to-open both appear in the cast stages, 1–3, and nowhere else. Stage 0 has no devices. The ring devices in stages 4–5 have no spokes. Stage 6 is an export stage: its 2D elevation is shown, but clicking a device there does nothing, and it has no strip.

---

## 5. The ring in 2D, by site

### 5.1 Sites come from the topology

Take the lab's links, drop every link that carries `span`, and find the connected components. For `roadm-ring-demo` that gives exactly three groups of three devices (verified on 2026-09-25). **The code must not parse `site-a-…` or any other id prefix.** The grouping is structural, so it survives renamed devices.

### 5.2 Layout

- **Site tabs:** one per site, in the stage header beside the 2D/3D switch, ordered top to bottom by U. Each tab is labelled with **the label of that site's highest-U device**, shown exactly as the data gives it (for this lab `site-a-sc01`, and so on). The mockups showed "Site A", but producing that from `site-a-sc01` would mean parsing the id prefix, which §5.1 forbids. A tidier name would need a site name in the data, which is part of the multi-rack follow-up in §8.
- **Each site** draws a **front** and a **rear** elevation side by side. Its devices sit at their real U positions, within the site's U range.
- **Cables inside a site** (management, cross-connect and OSC loops; 24 of the 30 links) are drawn in full. Each end is anchored to the real `data-path` element on the face it belongs to. The 6 management runs go from a ROADM's rear `eth4` to the controller's front port, crossing between the two elevations. Colours come from the same palette as 3D (`ring.js`).
- **Span links** (6) end in a **stub** at each end, a pill that names the far end: `→ site B · roadm01-D1 · port-line`. Stub colour is that span's colour.
- **Clicking a stub** switches to the far site's tab, highlights the partner stub and its port, and shows `← back to site A` until the visitor moves on.
- **Caption,** always shown in 2D: *"Grouped by site, as the ring's topology divides it. Physically all three share one lab rack (U16–36)."* The U range is computed from the lab, not typed.

### 5.3 Stage 5 in 2D

The media and purpose toggles hide and show the current site's cables and stubs. **Counts stay global** ("6 of 30"), so the numbers do not change as you switch tabs. The per-link list is unchanged.

### 5.4 3D is unchanged

In 3D, stages 4 and 5 remain one physical rack, as built. 3D is "as built"; 2D is "as the ring sees it".

---

## 6. Testing

### Contract (`check-contract.py`), recording on every run

- `site/showcase/rails.js` exists and exports the rail description. Both `rack.js` and `rack3d.js` import from it. Neither declares its own `RAIL`/hole constants.
- The 2D rail is mirrored. Assert structurally: rails.js exposes a per-side layout, and the right side's number offset is outboard of its hole offset.
- The ring code (`ring.js` and stages 04/05) contains no `site-` prefix parsing: no regex or string split on device ids.
- The site split, recomputed in Python as connected components after dropping `span` links, yields exactly 3 groups that together cover all 9 devices.

### Browser walk (`check-browser.py`)

- Walks every stage in **2D** (the default, and GPU-free).
- Flips one stage to **3D** and back, asserting `data-stage-ready` each time and that the choice persists to the next stage.
- Opens a spoke by **clicking a device on the 2D drawing** (`[data-device-ref="as7726-32x"]`) and returns.
- Stage 4: clicks a span stub and asserts the tab switched and the partner stub is highlighted (a data attribute such as `data-highlight`).
- Stage 5: toggles `management` and asserts `6 of 30`.

---

## 7. Order of work

Each step ships on its own and leaves the page working:

1. **`rails.js`, and both renderers drawing from it.** This fixes §1.1 and §1.3.
2. **The 2D/3D switch** across stages 0–3 and 6.
3. **"Look closer"**: click on the drawing, plus the index strip.
4. **The ring in 2D**: stages 4 and 5, with site tabs, stubs and the filter.

---

## 8. Out of scope

- **Clicking devices in the 3D canvas** (raycast picking). The index strip covers 3D.
- **The R740xd teardown and `data-under`** (R24) and **the FHD-1UFCE fibre path** (R28). Both are still unbuilt, carried over from the first spec.
- **Real multi-rack labs.** When a lab declares multiple racks, stubs will point at real racks and the "grouped by site" caption goes away. That needs an optional multi-rack field on labs upstream. File it as a companion to roc-ops/Portrayal#565, and do not block on it.
- **Anything the user has not yet reviewed.** More feedback is expected after this round ("I'll keep reading and using it").
