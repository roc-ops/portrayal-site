# Rack-face cable managers in the Rack Builder

**Date:** 2026-10-07
**Status:** implemented
**Builds on:** `2026-09-26-rack-builder-design.md` (§5.3 zero-U, §9.5 out of scope, §9.6 routing plumbing)
**Upstream:** roc-ops/Portrayal `docs/cable-managers-design.md` (#827, merged 2026-10-06); branches `claude/cm-guides`, `claude/cm-brush-passes`, `claude/cm-lab-placement` (unmerged at the time of writing)

---

## 1. Why, and where this sits

Cabling a real rack means cable managers: a 0RU lacer panel such as FS's FHD-CMP5DR bolted in front of a switch, its D-rings taking the switch's cables out to the side, and the cables then running as combed, Velcro-strapped bundles to a patch panel. The Rack Builder draws devices and port-to-port cables. It has no manager, no route and no bundle.

The work is split into three pieces, each with its own spec, plan and PR:

| Piece | Delivers | Needs from upstream |
|---|---|---|
| **1 (this spec)** | Rack-face managers placed in the Rack Builder: on a device or on a bare U, drawn in 2D and 3D, carried by every export | `main` as of #827 |
| 2 | Pathways and routes: a cable's `route` through rings, pass-throughs and rack points, drawn in 3D and simply in 2D | `cm-guides`, `cm-brush-passes` |
| 3 | Bundles: membership and numbering, peel-off, a size limit set by the tightest pathway, Velcro straps every 12 in (configurable) in 2D and 3D, bundles in the cable list and exports | as piece 2 |

### 1.1 The pathway model pieces 2 and 3 will use

A route does not pass through points. It passes through **pathways**: anything a cable or bundle can run through, with a position and an aperture (an opening size and a run direction). The router and the bundle-size check ask a pathway only those two things, so new kinds slot in without changing routes or bundles.

| Pathway | Source | When |
|---|---|---|
| Ring | upstream `guide: {kind: ring, aperture, run}` on a component (FS D-ring: 32.0 x 29.5 mm, run along the tray) | piece 2 |
| Duct | upstream `guides: [{kind: duct, ...}]` on a device view | piece 2, once a duct device is modelled |
| Pass-through | upstream `passes: [{id, at, size, shape, cover}]` | piece 2 |
| Rack point | site: `{anchor, ru, offsetMm}` on the frame, no aperture limit | piece 2 |
| Ladder rack, void space, vertical manager | site, or upstream `rack-top` / `rack-side` | later |

A bundle's maximum diameter is the smaller of 2.5 in and the tightest aperture on its route (decided 2026-10-07). Piece 1 only records what pieces 2 and 3 will read: managers as items with stable ids, and each manager's guide and pass-through ids and capacity in the chassis index.

## 2. Decisions

| # | Question | Decision |
|---|---|---|
| D1 | Where a manager lives in the rack document | **In `items`**, as an item with an optional host (option A). Not `zeroU`, which stays reserved for side-mounted gear; not nested in the host, which leaves an unhosted manager nowhere to live. |
| D2 | Placement shape | Mirrors upstream's lab placement: `face`, and `on` + `unit`, or a bare `ru`. `ru` is always stored, resolved from the host when there is one. |
| D3 | Removing a host | **The manager stays**, at its `ru`, unhosted. It bolts to the rack, not to the host (upstream's own reasoning), and nothing is silently deleted. |
| D4 | Rail screws | A hosted manager **shares the host's rail screws** (confirmed by the user; FS's quick start guide draws its ear over the host's ear, one fastener each side). |
| D5 | Document version | `version` goes from 1 to 2, so an older page refuses the file instead of drawing a manager as a 1U device over its host. |
| D6 | Velcro straps (piece 3) | Drawn in 2D and 3D at a fixed spacing, 12 in by default, configurable. |
| D7 | Bundle size (piece 3) | Limited by the tightest pathway on the route, never above 2.5 in. Ladder racks and void space are later pathway kinds. |

## 3. Dependency: refreshing the vendored snapshot

The site's `assets/dist/` and `vendor/` predate #827: `fhd-cmp5dr` is not in `assets/dist`, and `vendor/viewer3d.js` cannot build a `shell: sheet` body. Piece 1 starts with `./refresh-assets.sh` against upstream `main`, then `chassis-index.py`. If `cm-brush-passes` has merged by then, the refresh also brings `cmh-4drb1u`, an ordinary 1U rack device that needs nothing from this spec.

`chassis-index.py` already writes `mount` when it is not `rack`, and `ru` as stated (so `fhd-cmp5dr` gets `ru: 1, mount: 'rack-face'`). It gains, per device, when present:

- `capacity`: `{count, basis}` from `attrs.performance.cable-capacity` and `cable-capacity-basis` (on `cm-brush-passes`; absent until it merges, and the inspector then omits the line);
- `guides`: ids of the instances carrying `data-guide`, and of `guide--*` rects, from the compiled front view;
- `passes`: ids of `data-class="pass"` rects, per view.

Piece 1 shows `capacity` only. `guides` and `passes` are for piece 2; recording them now means piece 2 does not touch the index script.

## 4. Data model (`site/rack/model.js`)

A rack-face item:

```json
{"id": "i7", "ref": "fhd-cmp5dr", "cfg": "base", "label": "mgr-1",
 "face": "front", "ru": 12, "on": "i4", "unit": 1,
 "swaps": {}, "fields": {}}
```

- `on` is the host's item id; `unit` is which of the host's rack units, from 1 at the host's bottom. A 4U chassis can carry four managers on one face, one per unit.
- `ru` is always present. For a hosted manager it equals `host.ru + unit - 1`, and is rewritten whenever the host moves.
- An unhosted manager has `ru` and no `on` or `unit`.
- `turned` is always `false` for a manager and is not offered. A rear manager faces rearward by virtue of `face: rear`.

`parseDoc` has no chassis index, so it only reads shapes:

- migrates version 1 to 2 with no change to content;
- refuses a version newer than it knows, as today;
- keeps `on` (a non-blank string) and `unit` (an integer of 1 or more) on any item, and drops malformed ones.

`settleManagers(rack, chassisOf)` (`site/rack/managers.js`) runs on every rack the page opens, and returns the rack and a notice per repair:

- drops `on` and `unit` from an item that is not rack-face;
- a manager whose `on` names no rack device on its face becomes unhosted at its stored `ru`. It is never dropped;
- clamps `unit` to the host's height and re-derives `ru` from the host.

`withoutItem` detaches every manager whose `on` names the removed item (D3).

`itemIdsInUse` is unchanged: a manager's id is an item id like any other.

## 5. Fit rules (`site/rack/fit.js`)

`fits()` branches on the candidate's mount. For `rack-face`:

1. **Height.** `ru` is within `1..frame.heightRU`.
2. **One per U per face.** No other rack-face item on the same `ru` and `face` (upstream L135).
3. **Host.** If `on` is set, the host is an item whose mount is `rack`, and `unit` is within 1 to the host's height in U (its chassis `ru`, not its position) (upstream L134). An item is placed by `on` or by `ru`, never both as independent inputs (upstream L133); `ru` is then derived.
4. **The projection is clear.** A front manager projects forward of the front rail; a rear manager rearward of the rear rail.
   - Rear: refused if a front-face item spanning that U is deeper than `railDepth`, and refused if `railDepth + d > usableDepth`.
   - Front: refused if a rear-face item spanning that U is deeper than `railDepth`.
   - Two-post: the same rules with `railDepth = 0`, so a rear manager fits only on a U nothing spans.
5. **Rack devices ignore managers** in their own collision check. A switch can always go behind a manager.

Each refusal is a sentence, as today: *"Taken by mgr-2 on the front."*, *"core-1 is 820 mm deep and reaches past the rear rail; a rear manager here would hit it."*

**Moving a host** moves its managers. The move is allowed only if every one of them still fits at its new `ru`, and a refusal gives the manager's reason.

**`shrinkRack`**: a hosted manager moves with its host's cluster. An unhosted one joins the cluster spanning its U, or is a 1U cluster of its own. A host dropped from the bottom takes its managers with it, and both are listed in `removed`.

## 6. 2D (`site/rack/elevation.js`)

- **Drawn after every rack device**, over its host on its own face, from its own `front` view through `configuredFace`. Upstream draws that view as an open elevation (ears, the tray edge, the rings end-on), so the host's ports show through.
- **The other face** shows a manager only when no item spans that U there. It is then drawn from its `rear` view, as the existing `through` state.
- **No ears are added.** The device's own drawing has its ears and holes. `drawEars` is skipped for `rack-face`, as it is today for any mount that is not `rack`.
- **A marker in the U gutter**, which is also a click target for the manager, shows that a U carries a manager, because the manager itself is mostly see-through.
- The manager's group carries `data-panel="mounted"` and its own `data-item`. It stacks above the host by order, which `elevation.js` already keys on for `mounted`.

## 7. Placing and selecting (`rack-page.js`, `picker.js`, `inspector.js`, `drag.js`)

- **On a device (the main way).** The host's inspector gains a **Cable managers** section with one row per U of the host on its face. An empty row offers **Add...**, which opens the catalog filtered to `rack-face` devices. A filled row shows the manager, with **Select** and **Remove**.
- **On an empty U.** The catalog panel's filter `e.ru !== 0` stays, and rack-face devices (`ru: 1`) appear in it with the tag "0U, mounts on the rail face". `mountPick` must not call them "needs a shelf". Placing one there makes it unhosted. On a U a device spans, the catalog offers to attach it to that device instead.
- **Selecting.** The manager's group takes no pointer events except on its components (the rings) and on its gutter marker, which select the manager. A click anywhere else on it, the ears and tray included, falls through to the host. **Select host** in the manager's inspector steps from manager to host.
- **The manager's inspector:**
  - label, face, host and unit;
  - **Detach** (keeps `ru`, drops `on`/`unit`) or **Attach to the device here**;
  - the capacity line, e.g. *"30 cables (Cat6 24AWG, theoretical, FS datasheet)"*;
  - **Open in Explorer**, **Move**, **Remove**.
  - It has no `turned` or configuration control.
- **Drag.** Dragging a host moves its managers with it. Dragging a manager moves only the manager. Dropped on a U a device spans, it attaches there (`unit` from the U). Dropped on an empty U, it is unhosted.
- Undo covers each of these as one step, through `commit`.

## 8. 3D (`site/rack3d.js`, `site/rack/scene3d.js`)

- The refreshed `viewer3d.js` builds the sheet body: floors and relief, nothing from the face drawings. The host's ports show through.
- `scene3d.js` passes `mount` already. `rack3d.js` places a `rack-face` mount by its mounting plane, not its body:
  - front: the manager's rear (mounting) face on `RACK_FACE_Z`, body projecting toward the viewer by `d`;
  - rear: its mounting face on `REAR_FACE_Z`, turned 180 degrees, projecting rearward.
- `noEars` already holds for any mount but `rack`. That is right here, because the model has its own ears.
- Picking by item id is unchanged. A click on a ring selects the manager.
- **For piece 2:** `scene.guideAnchor({id}, elementId)` returns the world position and normal of a named element on the manager's front face (a ring is `guide-1` to `guide-5`), sharing `portAnchor`'s lookup. Run direction and aperture are read from `data-guide-*` in piece 2, once `cm-guides` has merged. Piece 1 adds it and a test, and nothing draws through it.
- GLB and USDZ exports carry the managers, as exports of the same scene.

## 9. Exports

| Export | Change |
|---|---|
| Rack JSON | Version 2; managers with `on`/`unit`/`ru` (§4) |
| SVG / PNG sheets | Through `elevation.js`. A note per manager: *"mgr-1: FS.com FHD-CMP5DR, 0U, on core-1 U12, front"* |
| draw.io | The manager is its own cell, after and above its host's, so the two move independently in draw.io |
| NetBox / Nautobot kit | Device rows for managers with `rack` set and **no `position` and no `face`**: neither accepts a rack position for a 0U device. The placement goes in `comments`. Upstream's device-type files already write `u_height: 0`. **To verify** against the test instances (§10) |
| BOM | The manager as a line. Hosted: **no cage nuts added** (D4), and a note that the host's screws may need to be longer for two stacked ears. Unhosted: its own 4 holes' hardware |
| Cable schedule | Unchanged; managers have no ports |

`isRackMount()` stays `mount === rack`. Every caller that uses it to mean "needs a shelf" (`mountNotes`, `mountPick`, `mountText`) gets a rack-face case, so a manager is never described as shelf-mounted.

## 10. Testing

- **Unit** (`tests/rack/*.test.mjs`):
  - model: v1 to v2 migration, v2 round trip, a dangling `on`, `ru` re-derived from a host that moved;
  - every rule of §5, one accepted and one refused case each, on four-post and two-post;
  - `shrinkRack` with hosted and unhosted managers, and a dropped host;
  - export rows: DCIM device rows, BOM lines and hardware, sheet notes.
- **`check-contract.py`:**
  - `fhd-cmp5dr` is in `chassis.json` with `mount: 'rack-face'` and `ru: 1`;
  - the vendored viewer builds `shell: sheet`;
  - `zeroU` stays empty in every shipped fixture.
- **`check-browser.py`:** a new stage with a fixture rack carrying an FHD-CMP5DR on a switch, front and rear:
  - in 2D, the manager is drawn over the host, and a click in a gap between rings selects the host;
  - in 3D, a screenshot shows the host's ports through the manager (upstream's own acceptance check);
  - moving the host moves the manager.
  - Run `uptime` before chasing a 3D timeout: earlier ones were machine load, not the page.
- **DCIM:** import a kit with hosted and unhosted managers into NetBox 4.7 and Nautobot 3.2.6 with `tools/dcim-verify/`, and confirm the devices land in the rack with no position.

## 11. Out of scope

- Routing through rings, ducts and pass-throughs (piece 2); bundles and straps (piece 3).
- Side-mounted managers (`zeroU`, upstream `rack-side`), `rack-top`, ladder racks, void space.
- Doors, and a front manager's clearance to one. The frame has no door yet.
- Detachable or rotatable rings: drawn fitted, as upstream models them.
- Reading upstream `labs.json`. The placement shape matches it, so a lab import later is a mapping.
