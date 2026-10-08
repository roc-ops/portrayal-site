# Vertical (zero-U) cable managers in the Rack Builder

**Date:** 2026-10-08
**Status:** implemented (roc-ops/portrayal-site#141)
**Builds on:** `2026-10-07-rack-face-managers-design.md` (piece 1), `2026-10-07-cable-routing-pathways-design.md` (piece 2)
**Upstream:** roc-ops/Portrayal `docs/vertical-cable-managers-design.md`, point 6 and section 7 step 4; the six FS ducts and `mount: rack-side` (#894)

## 1. What this adds

A `rack-side` part (an FS vertical finger duct) stands beside an upright, takes no rack unit, and carries the cable lane that runs beside that upright. Narrow `rack-face` parts (the CMV-5U3W finger bracket, under 450 mm wide) go on one rail. Both are the site's for now: the kit's rack core (`vendor/rack/`) is used as it is and not changed, and what the kit would need is listed in section 7.

## 2. Decisions

| # | Question | Decision |
|---|---|---|
| Z1 | Where a rack-side part lives | In the rack's reserved `zeroU` record, never in `items`: `{id: 'z1', ref, cfg, label, at, offsetMm, between?}`. |
| Z2 | Where it stands | `at` is an attachment point of the frame (`fit.js attachPoints`): `left`/`right` on a two-post, `left-front` ... `right-rear` on a four-post. It is also the name of the lane beside that upright. |
| Z3 | Its height | `offsetMm` from the bottom of the rails, always a whole number of U; commands take `ru` (its bottom U). It fits by its stated `ru` against the rack's height, not by its drawn height (the 45U ducts draw 2108 mm). No two rack-side parts overlap on one attachment point (upstream L154). |
| Z4 | Between racks | A document holds one rack, so "between racks" is `between: true` on the part: drawn and exported as beside this rack, and said in the notes and the DCIM comment. A shared part in a two-rack document waits for rows of racks. |
| Z5 | The stand-off from the upright | Not dimensioned by any source (upstream `bracket-stand-off` gap), so the duct is drawn against the upright's outer face. |
| Z6 | Lanes through the duct | A route stays the kit's `{lane, ru}`. A lane waypoint at a U a duct spans on that lane is drawn, in 2D and 3D, at the duct's centre line instead of the 40 mm gutter. |
| Z7 | Fill | Every cable whose lane run passes a U the duct spans counts once, against 40% of its channel: the drawn guide's width by the part's depth (an estimate, as the horizontal ducts' square cross-section is), and against its stated capacity. Warn, never refuse. |
| Z8 | Narrow parts | `side: left | right` on the item. Such a part claims its units on that face and side only; a narrow part with no side, and any other rack-face part, claims both (upstream L142). It is drawn over its rail's holes, turned end over end on the right rail, in 2D and in 3D, and its notes and DCIM comment name the rail. |
| Z9 | The file version | Unchanged (the kit's version 2). A page that predates this keeps `zeroU` as written and draws nothing for it, so the file stays readable and round-trips; the kit's reader drops an item's `side`, which the site's reader puts back. |
| Z10 | Exports | Sheets (SVG, PNG) and the 3D model (GLB, USDZ) draw the parts and carry a note each. The NetBox and Nautobot kits carry each as a device in the rack with no position and no face, its place in the comment; its upstream device type is `u_height: 0`, not full depth. The BOM lists it, with no rail hardware. draw.io keeps the kit's note that zero-U items are not in it. |

## 3. Commands

The site's commands are run as the kit's are (pure, a sentence on refusal), through the kit's editor: a batch that needs one runs through `applySite` and lands as one undo step through the editor's whole-rack step; any other batch is the kit's, untouched.

- `zerou.place {ref, cfg?, at, ru, between?, label?, as?}`
- `zerou.update {id, at?, ru?, between?, label?}`
- `zerou.remove {id}`
- `side.place {ref, cfg?, face, ru, side, label?, as?}`
- `side.set {id, side: left | right | null}`

The kit's `place` of a rack-side part is refused (it would land on the rails), and its `move` of a narrow part on one rail is judged by that side. A narrow part with no side placed or moved by the kit is judged again on every unit it spans. A batch that changes the rack but is no step (the DCIM settings beside a site command that changed nothing) records no undo step, a per-call `ctx` reaches the kit's commands in a site batch and in a dry run, and a site batch's change event carries its commands and findings, so an agent's edit to a part beside the rack is outlined as any other. The agent tools offer the site's commands with the kit's, and describe the parts beside the rack.

## 4. The page

- The catalog lists rack-side parts as "zero-U, stands beside the rack", with the upright and a "between racks" box; narrow parts with a rail. A part with a choice is listed when any choice fits; the line under the list judges the one chosen.
- The elevation widens both panes alike for any part beside the rack, and raises them for a part taller than the rails, so the two panes keep one box.
- A click on the part selects it; its panel edits label, upright, bottom U and "between racks", and removes it. A narrow part's manager panel has a rail control.

## 5. Testing

- `tests/rack/zero-u.test.mjs`: fit, every command and its refusals, mixed batches and `@names`, narrow parts, lanes through a duct, fill and capacity, notes, reading a file back, and the editor's undo.
- `check-browser.py` `check_rack_zero_u`: a duct placed through the catalog beside a two-post, drawn in both panes, a cable's lane through its channel in 2D and 3D, its fill counted, its panel's edit undone, two brackets on one U on opposite rails, a reload, and the NetBox kit's device row.

## 6. Out of scope

Rows of racks and a duct shared by two racks in one document; routing between racks; the in-cabinet zero-U channel; `rack-top`; pass-throughs on the duct's back plate as route waypoints (they are not items).

## 7. For the kit (upstream follow-ups)

Filed as roc-ops/Portrayal#926. The document shape (`side` on an item, the `zeroU` entry) is accepted as it is, with no version bump; the kit takes it over there.


- Rack-side commands and fit (`zerou.*`) and `side` on rack-face placements (`side.*`) in `kit/rack/commands.js`, with `side` kept by `model.js readItem` and `withItem`.
- `fit.js fitsZeroU` measures a part by its drawn `h`; a rack-side part states `ru` and should fit by it.
- `fit.js fitsRackFace` checks a candidate's bottom unit only against others; a 5U narrow bracket should be checked on every unit it spans, and per side.
- `route.js pointOf` measures a lane at the gutter (`laneX`); a lane through a duct should measure at its centre line, so routed lengths agree with the drawing (beside a 138.8 mm duct the lane is 49.4 mm further out than the gutter, at each end of a run).
- `route.js fill` and `capacityOver` know only items; a zero-U part as a pathway belongs there.
- `export-data.js deviceImportRows` and `rackNotes`: a rack-side row and note of their own, so the site does not route zero-U parts through the rack-face wording.
- `queries.js describe` lists `zeroU`; `shrinkRack` and a frame-kind change judge zero-U parts.
- The editor could take extra command tables (`createRackEditor({commands})`), so the site's commands go through `apply` with their findings instead of the whole-rack step.
