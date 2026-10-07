# Cable routing through pathways in the Rack Builder

**Date:** 2026-10-07
**Status:** design approved in conversation; spec awaiting review
**Builds on:** `2026-10-07-rack-face-managers-design.md` (piece 1, merged as #120), `2026-09-26-rack-builder-design.md` (§9.6 routing plumbing)
**Upstream:** roc-ops/Portrayal `docs/cable-managers-design.md`; #852 merged guides (`ring`, `duct`), pass-throughs and the CMH-4DRB1U and CMH-SFD1U

---

## 1. Why, and where this sits

Piece 1 put cable managers in the rack. A cable still hangs from port to port and ignores them. This piece routes cables: through a manager's rings, ducts and brush strips, then up or down a lane beside the rails to the other end. It also measures the route into a length and warns when a pathway is over-full.

| Piece | Delivers | Where |
|---|---|---|
| 1 (merged, #120) | Rack-face managers placed, drawn and exported | site |
| **2 (this spec)** | Pathways, automatic and editable routes, fill warnings, routed lengths | site, written kit-ready (§2 D8) |
| Rack kit | The rack core, then the builder, move into `@portrayal/kit` | upstream, its own spec |
| 3 | Bundles: membership and numbering, peel-off, size by the tightest pathway, Velcro straps | kit |

## 2. Decisions

| # | Question | Decision |
|---|---|---|
| D1 | How a route is made | **Automatic first, editable.** A cable follows a route worked out from the rack. Editing it stores your waypoints, and they stay. |
| D2 | Vertical runs | **Four lanes**, one just outside each post: `left-front`, `right-front`, `left-rear`, `right-rear` (two-post: `left`, `right`), the frame's existing attachment points. No free points off the lanes. |
| D3 | Length | **Measured from the route, rounded up to a stock length**, stored with source `routed`. A typed length always wins. |
| D4 | A full pathway | **Warn, never refuse.** Fill at 40% of the opening, and the vendor's rating where there is one. |
| D5 | Where the automatic route lives | **Worked out each time, stored only once edited** (`routeEdited`). |
| D6 | Waypoint kinds | `{item, via}` names an element of a placed device's drawing; `{lane, ru}` names a lane at a U. |
| D7 | draw.io | Unchanged here; bending edges needs the kit's `drawio.js`. |
| D8 | The kit | New code is pure (no DOM, no site imports), and 3D geometry takes three.js as a parameter, so the rack kit project moves files, not rewrites. |

## 3. Dependency: refreshing the vendored snapshot

`./refresh-assets.sh` against upstream `main` (with #852), then `./chassis-index.py`. This brings in:
- the CMH-4DRB1U (1U, four steel rings and a brush strip; capacity 87) and the CMH-SFD1U (1U finger duct);
- guide and pass markup;
- `attrs.performance.cable-capacity`, which turns on piece 1's capacity line.

`chassis-index.py` indexes `guides` and `passes` from the **top** view as well as front and rear, because ring components sit on the top view (piece 1 deferred item).

The same refresh does what the next sync is known to need: a SOURCES entry for upstream's `lab.schema.json`, its tab on `schema.html`, and that page's word count.

## 4. Data model

A waypoint in `cable.route` is one of:

- `{item, via}`. `via` is an element id in that item's compiled drawing: a ring (`guide-3`, carrying `data-guide="ring"`), a duct (`guide--duct`, `data-class="guide"`), or a pass-through (`data-class="pass"`). Its kind, aperture and run direction are read from the drawing (`data-guide`, `data-guide-aperture`, `data-guide-run`, or the pass rect's size), never stored in the rack file.
  A ring's component lives on the top view; on the front and rear views it appears as its end, `<id>-end` with `data-kind="ring"` (FHD-CMP5DR `guide-1-end`). So `via` is always the ring's own id (`guide-1`), and a face finds it as `<via>` or `<via>-end`. 2D positions come from the face's `-end` element; aperture and run from the top view's component.
- `{lane, ru}`. `lane` is one of the frame's attachment points (`fit.js` `attachPoints`). `ru` is a U, bottom-up.

A cable gains `routeEdited: true` when its route has been edited. Without it, the stored `route` is ignored and the automatic route applies. **Reset route** clears both.

A routed length is `{value, unit: 'm', source: 'routed', measured}`, where `measured` is the path length in meters before rounding. A length with source `entered` is never overwritten.

A waypoint that no longer resolves (its item is gone, or its element is not in the drawing) stays in the stored route and is skipped when drawing, with a note: *"Cable c4: waypoint guide-2 on mgr-1 is gone, so the route skips it."*

There is no version bump. `route` exists; `routeEdited` and the `routed` source are new fields an older page keeps and ignores. `readCables` keeps `routeEdited` only when it is `true`, and keeps a waypoint only when it has one of the two shapes; any other entry is kept as written in `routeAsWritten`, as lengths are today.

## 5. The automatic route (`site/rack/route.js`, pure)

`autoRoute(rack, cable, ctx) -> waypoint[]`. `ctx` supplies `chassisOf`, and `guidesOf(item) -> [{id, kind, x, aperture, run}]` and `portX(end) -> mm` read from the drawings (the page fills both from the configured faces it already holds).

For each end:

1. **Its manager:**
   - the rack-face manager hosted on the end's item, on the same face;
   - else the 1U rack device directly above or below it on that face, if it declares a guide or pass;
   - else none.
2. **Its exit side:** left or right by `portX` against the panel's center. A port exactly at the center goes left.
3. **Through the manager:**
   - rings: the ring nearest the port, then each ring between it and the exit side, ending at the outermost;
   - a duct: the duct;
   - a pass-through: only when the two ends are on opposite faces.
4. **The lane:** `{lane: '<side>-<face>', ru: end.ru}`. On two-post: `<side>`.

Then the ends are joined:
- one lane: up or down it between the two U's;
- the same face, different sides: the route takes the A end's side, and the B end's rings carry it across;
- opposite faces: the A end's side, front lane to rear lane at the higher end's U.

**No route** (an empty list) when no manager is involved and the ends are within 2U of each other on the same face: the cable hangs directly as today. Consecutive duplicate waypoints are dropped.

## 6. Editing (`site/rack/route-panel.js`, the cable form)

- The cable form shows a **Route** list. While automatic, it reads "Automatic" with the chosen waypoints grayed. Rows read "mgr-1 ring 3", "left-front lane U24", "pp-1 duct".
- Each row has ↑, ↓ and ✕. The list has **Add waypoint** and **Reset route**.
- Any edit stores the full list with `routeEdited: true`. Each edit is one `commit` with Undo text.
- **Add waypoint** is a picking mode, like Cable mode:
  - a click on a ring, a duct or a pass-through in 2D adds `{item, via}`;
  - a click in a rail gutter at a U adds `{lane, ru}`: the left gutter is the left lane, the right gutter the right lane, and the pane gives front or rear.
  - The waypoint goes after the selected row, or at the end. Esc stops picking.
- An unresolved waypoint's row is marked "gone", with ✕.
- Moving a device never rewrites a stored route.

## 7. Drawing

**2D** (`cables.js` and `cable-view.js`):
- **The path:** a routed cable runs from its port to each waypoint in its end's pane: ring ends and ducts at their drawn centers, lanes in the rail gutter at the U's middle. Short rounded corners join the straight segments.
- **Cross-face cables** keep today's convention: each pane draws its half and ends in the tag naming the far end. The tail runs in the lane's gutter, not the separate column.
- **Gutter width:** grows to 40 mm when the rack has routed cables. Cables sharing a lane are offset a few millimeters each, in the order they join it.
- **Over-full pathways** are outlined in the warning color.
- **Unrouted cables** hang as today.

**3D** (`cables.js`, three.js passed in):
- **Waypoint positions:**
  - a ring or duct is the center of its opening, from `guideAnchor`;
  - a pass-through is the center of its rect;
  - a lane point is 40 mm outside its post, at its face's rail plane, at the U's middle.
- **The path:** the tube runs through them in order, with corners of at least a 30 mm radius. It keeps today's straight lead out of the connector, and runs taut between waypoints.
- **Cables sharing an opening** are spread on a small grid inside it.
- **Clipping:** segments are pushed out of device boxes with `clearOf`. A sheet manager's box is not an obstacle.

## 8. Fill and length (`route.js`, pure)

**Fill:**
- **Typical diameters:**

| Media | mm |
|---|---|
| Cat6 | 6.0 |
| Cat6A | 7.5 |
| OS2, OM3, OM4, OM5 (duplex) | 3.0 |
| DAC | 5.0 |
| AOC | 3.0 |
| unset | 6.0 |

- **Fill of a pathway:** the total cable cross-section ÷ the aperture area (w × h), against 40%. Lanes have no limit.
- **A manager with `capacity`** is also checked on its total count.
- **Warnings** go in the cable list notes and the sheet notes: *"guide-2 on mgr-1: 14 cables, 132% of a 40% fill."* Nothing is refused.

**Length:**
- **What is measured:** the path through the waypoints, using the rack's own sizes (U height, rail depth, rack width, the 40 mm lane gap), so 2D, 3D and exports agree. An unrouted cable measures straight between its ports.
- **Allowances:** add 0.15 m per end.
- **Rounding:** up to 0.5, 1, 1.5, 2, 3, 5, 7, 10, 15, 20 or 30 m, then to the next 5 m.
- **Kept current:** recomputed on every redraw for cables without an entered length.
- **The form** shows "2 m (routed, 1.62 m measured)" beside the editable field.

## 9. Exports

| Export | Change |
|---|---|
| Rack JSON | `route`, `routeEdited`, `routed` lengths |
| SVG / PNG sheets | Routed paths through `cable-view.js`; fill warnings in the notes |
| Cable schedule CSV | New **Route** column (`mgr-1 ring 3 > mgr-1 ring 1 > left-front U12-U24 > pp-1 ring 1`) and **Length source** (`entered` or `routed`); length uses a routed one when none is entered |
| BOM | Cable lines group by the length used; routed ones are marked |
| NetBox / Nautobot cables | Routed length when none is entered, with a comment saying so |
| GLB / USDZ | Routed tubes, as the scene |
| draw.io | Unchanged; a note says routes are not drawn there |

## 10. Testing

- **`tests/rack/route.test.mjs`:**
  - automatic route cases: opposite halves of a switch with an FHD-CMP5DR; ring order; a 1U CMH-SFD1U as the manager; a short jumper with no route; opposite faces; two-post;
  - resolving waypoints: gone item, gone element, duplicates;
  - fill: diameters, 40% limit, vendor rating;
  - length: geometry, allowances, rounding including past 30 m;
  - model round trip.
- **Export tests:** schedule columns, BOM grouping, DCIM comment.
- **`check-browser.py` `check_rack_cable_routes`:**
  - **The rack:** a switch at U20 with an FHD-CMP5DR, a patch panel at U30, a CMH-SFD1U at U29, and two cables from opposite halves of the switch.
  - **2D:** paths cross the expected ring ends and gutters.
  - **3D:** tube points pass within the ring apertures and lane positions.
  - **Editing:** an added lane waypoint survives a reload, and Reset returns to automatic.
  - **Length:** a routed length shows in the form and the schedule.
- **`check-contract.py`:** the three managers are in the catalog with guide and pass ids indexed from top, front and rear.

## 11. Out of scope

- Bundles, numbering and Velcro straps (piece 3, in the kit).
- Moving the rack code into the kit, and routes in draw.io (the rack kit project).
- Ladder racks, void space, side managers in the lanes. The lane model leaves room for them.
- Free points off the lanes.
- Bend radius per media.
- Routing between racks.
