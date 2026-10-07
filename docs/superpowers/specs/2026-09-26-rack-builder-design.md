# Rack Builder: the showcase's rack, as a tool people drive

**Date:** 2026-09-26
**Status:** design approved; Phase 0 implemented; Phase 1a implemented (plan: docs/superpowers/plans/2026-09-26-rack-builder-phase1a-build-a-rack.md); Phase 1b implemented (plan: docs/superpowers/plans/2026-09-27-rack-builder-phase1b-exports.md); Phase 2a (cabling on the page) implemented (plan: docs/superpowers/plans/2026-10-03-rack-builder-phase2a-cabling.md); Phase 2b (cables in the exports and in 3D) implemented (plan: docs/superpowers/plans/2026-10-03-rack-builder-phase2b-cable-exports.md); Phase 2c (NetBox and Nautobot import kits: devices, modules and cables) implemented (plan: docs/superpowers/plans/2026-10-04-rack-builder-phase2c-dcim-import.md); rack-face cable managers (0RU) implemented (plan: docs/superpowers/plans/2026-10-07-rack-face-managers.md); cable routing through pathways implemented (plan: docs/superpowers/plans/2026-10-07-cable-routing-pathways.md)
**Builds on:** `2026-09-24-showcase-staged-rack-design.md`, `2026-09-25-showcase-inspect-is-explorer-design.md`, `2026-09-25-showcase-patching-plan-design.md`
**Upstream:** roc-ops/Portrayal issue (filed 2026-09-26) for a `{module}` naming token on module-type ports; landed, and in the vendored module types (§9.4)

---

## 1. Why

The showcase on `index.html` builds one rack in scripted stages: rails, mount, populate, optics, cable, filter, takeaway. Every piece a user would need to build *their own* rack is already there, but only as narrative: the cast is hard-coded (`CAST`, rack.js:45), placement is an auto-stacking loop (`loadMeta`), and the patching plan is a file (`patching.json`).

Rack Builder is a new tool page, alongside Explorer, Components and Annotate, where the user:

1. creates a rack by frame and height in RU;
2. clicks an RU and assigns a device from the full catalog;
3. clicks a placed device to open it in Explorer, seats modules and optics, and gets the changes back on that device;
4. (Phase 2) cables port to port;
5. exports the whole rack, as configured, in every format the site offers.

Most of the *drawing* exists. What is new is *authoring*: placement, collision, persistence and the cabling interaction. Plus one real gap found while designing (§4): most existing exports do not carry a device's configured state at all.

## 2. Decisions made while brainstorming

| # | Question | Decision |
|---|---|---|
| D1 | Phasing | **Phase 0** configured-face foundation and export fixes, **Phase 1** rack builder without cables, **Phase 2** cabling. |
| D2 | Racks per document | **One rack**, in a file format that holds an array of racks, so rows of racks later need no migration. |
| D3 | How devices sit | **Front and rear faces can share an RU when depths allow** (half-depth sharing). The format also has a **zero-U** item list, which is empty today because the catalog has no zero-U gear. |
| D4 | Frames | **Two-post and four-post** as frame types, with **user-set depths**, so a real four-post rack can be modeled without a rack item in Portrayal. Doors, panels and a Portrayal rack item come later. The frame can reference one then (§5.1). |
| D5 | Rail holes | Per rack: **square (cage nut)** or **tapped (round)** with an optional thread label (12-24, 10-32, M6). |
| D6 | Persistence | **A browser library of named racks** (IndexedDB), with autosave and `.json` Save/Open. No share links. |
| D7 | Layout | **Front and rear elevations side by side**, with the inspector and catalog on the right (mockup option B). |
| D8 | Exports | Everything carries the **as-configured** state. New: NetBox/Nautobot **device import CSV** and a **BOM** that includes mounting hardware. |
| D9 | Cable length | **Optional, typed by the user.** No estimate. Routing waypoints and a length source are in the format for later (§9.6). |

## 3. Phases

| Phase | Delivers | Visible outside the tool |
|---|---|---|
| 0 | `configuredFace()`; every export and the 2D elevation go through it; Explorer 2D download | Yes: the showcase, Explorer and drawio.html exports become correct |
| 1 | `rack.html`: frame, placement, Explorer lens, library, exports, nav entry | New page |
| 2 | Cable mode, cable list, cable exports (including the showcase's plan), NetBox cable import last | New features |

Each phase is shippable on its own. Each gets its own implementation plan.

## 4. Phase 0: one configured face for every consumer

### 4.1 The gap, as audited

| Export | Modules | Optics | Optic fields | Rear | Cables |
|---|---|---|---|---|---|
| draw.io (stage 6, drawio.html) | base config only | no | no | front only in stage 6 | no; drawio.js emits no edges |
| Stage 6 SVG/PNG | yes | yes | no | rear seating skipped (rack.js:229) | no |
| Stage 6 GLB/USDZ | yes | yes | no | supported, unused | no; also not awaiting `scene.complete()` |
| Explorer 3D | yes | yes | yes | yes | n/a |
| Explorer 2D | no download; menu links drop `swap=`/`fields=` | | | | |
| drawings.html | raw base drawings | no | no | unseated | no |

### 4.2 `configuredFace()`

New `site/rack/face.js`:

```js
configuredFace({ref, cfg, view, swaps, fields, turned})
  → {text, root, vb, zones, ports}
```

- Fetches `<ref>.<cfg>.<view>.svg`. When `turned` is set, it fetches the opposite view, because the other panel faces out.
- Seats bays, then cages, then rear holes, on **any** view, through swap.js's `seatFace` and its rear-hole pass. It does not use the front-only `applyFaceOverrides` call.
- Applies optic fields, using the same code Explorer and Annotate use.
- Runs `readSvg` on the result, so `zones` and `ports` include ports on seated cards and optics.
- Is memoized on its whole argument, because elevation, draw.io and exports all ask for the same faces.

### 4.3 Consumers moved onto it

- `build2dElevation` (and its successor, `site/rack/elevation.js`): rear faces now seat.
- draw.io:
  - `deviceCells` takes a configured face.
  - Port cells gain a `portrayal-path` attribute holding the drawing path, so Phase 2 edges can find them without guessing the `/` to `--` mapping.
  - Stage 6 passes `{bays: true}` and emits the rear page as well.
- drawio.html: a **stencil library** keeps its separate card shapes, because that is what a library is for. Anything that depicts a *specific* device or rack uses the configured face.
- Stage 6 GLB/USDZ awaits `scene.complete()` before exporting. This fixes flat optics.
- Explorer gains **Download SVG** and **Download PNG** of the configured current view. Its Export menu links to pages that honor `?device=` (DCIM export, Drawings) open on the current device; those pages take no swaps, so carrying `swap=` would be ignored.

**Acceptance:** stage 6's draw.io, SVG and PNG exports show the same seated cards and optics the stage shows, on both faces. The Explorer 2D download matches the Explorer stage.

## 5. Data model (`site/rack/model.js`)

Pure data, no rendering, no DOM.

```json
{
  "format": "portrayal-rack",
  "version": 1,
  "racks": [{
    "id": "r1",
    "name": "Lab rack 1",
    "frame": {
      "kind": "four-post",
      "heightRU": 42,
      "numbering": "bottom-up",
      "holes": {"style": "square", "thread": null},
      "railDepth": 740,
      "usableDepth": 1000,
      "ref": null
    },
    "items": [{
      "id": "i1", "ref": "asr-9006", "cfg": "base", "label": "core-1",
      "ru": 8, "face": "front", "turned": false,
      "swaps": {"slot-2": "cisco/a9k-16x100ge-tr@1"}, "fields": {}
    }],
    "zeroU": [],
    "cables": []
  }]
}
```

### 5.1 Frame

- `kind`: `two-post` or `four-post`.
- `heightRU`: any positive integer. It is no longer limited to the showcase's `RACK_SIZES`.
- `numbering`: `bottom-up` or `top-down`. This affects labels and exports only. `ru` is always stored bottom-up.
- `holes.style`: `square` or `tapped`. `holes.thread`: `12-24`, `10-32`, `M6` or `null`.
- `railDepth` (four-post only): the distance in mm between the front and rear rails.
- `usableDepth`: the deepest anything may extend from the front rail. On four-post it defaults to `railDepth + 260`; on two-post, to 1000. The user can edit it.
- `ref`: reserved for a future Portrayal rack or cabinet item. When it is set, the item supplies the depths and the frame's own numbers are the fallback. Saved files keep their numbers either way.

### 5.2 Rail items

- `face` is the rail face the ears are on: `front` or `rear`.
- `turned` means the device's rear panel faces out of that face.
- `ru` is the bottom U, 1-based, counted bottom-up.
- `swaps` and `fields` are exactly Explorer's `swapsNow` and `fieldsNow` output.
- `id` is stable and unique within the rack. Cables refer to items by `id`, so two identical switches never collide.

### 5.3 Zero-U items

`{id, ref, cfg, at, offsetMm, swaps, fields}`, where `at` names one of the frame's attachment points.

- A four-post frame has `left-front`, `right-front`, `left-rear` and `right-rear`.
- A two-post frame has `left` and `right`.

The fit rules, the rendering hook (drawn in the side gutter of the relevant pane) and the catalog filter (`chassis.ru === 0`) all exist in v1. The picker shows no zero-U devices until the catalog has some.

### 5.4 Versioning

`version` increments on any breaking change, and `model.js` owns an ordered list of migrations. Opening a newer version than the page knows produces a clear refusal, not a partial load.

## 6. Placement rules (`site/rack/fit.js`)

Pure functions over the model and each device's `chassis` (`ru`, `d` in mm; all 159 catalog devices have `d`). Every rejection returns a **reason string** that the catalog shows when it grays a device out.

- **Height:** `ru + chassis.ru - 1 ≤ heightRU`, and `ru ≥ 1`.
- **Depth budget, four-post:**
  - A front-face item occupies `[0, d]` from the front rail.
  - A rear-face item occupies `[railDepth − d, railDepth]`.
  - Items on opposite faces may share an RU only if these intervals do not overlap.
  - No item may extend beyond `usableDepth`.
- **Two-post:** a device's body passes through the single rail plane whichever face it is mounted on, so **two-post RUs are never shared**. `face` records which side the ears are on, and `d ≤ usableDepth` still applies. *(This corrects the brainstorming summary, which suggested two-post front and rear could share.)*
- **Same face:** items never overlap in RU.
- **Zero-U:** items at the same attachment point may not overlap along its length.

Example reasons: "10U needed, 3U free here", "474 mm deep; 266 mm free behind the front device".

## 7. The page (`rack.html`)

### 7.1 Shell

- `body.tool`, following explorer.html's head, site-bar and `tool-theme.css` conventions.
- **Rack Builder** is added to the hand-copied nav on every tool page and to index.html's masthead and footer. The nav stays hand-copied, as it is today.

### 7.2 Layout (mockup B)

- **Top bar:**
  - the rack name, with a menu that is the **library**: new, open, duplicate, rename, delete, import `.json`, save `.json`;
  - **Frame** settings;
  - the 2D/3D toggle;
  - **Export ▾**;
  - (Phase 2) **Cable**.
- **Center:** Front and Rear elevations side by side, sharing one U scale and scrolling together.
- **Every item appears in both panes.**
  - The face it's mounted on shows its outward panel.
  - The other pane shows its opposite panel if the device reaches that rail, and a ghosted outline if it doesn't.
  - The ghost marks space that is taken without hiding free space behind it.
- **Right panel:** its content depends on the selection.
  - **An empty U:** a catalog with search, filtered by `fit.js`. Devices that don't fit are grayed out with their reason. Choosing one places it with its default config.
  - **An item:** the inspector:
    - label, config, face and turned;
    - its depth against the space available;
    - Open in Explorer, Move and Remove;
    - Move is done by clicking a target U, or with the arrow keys.
  - **Nothing selected:** a rack summary: devices, U used and free, and depth warnings.

### 7.3 Explorer lens

- `site/rack/explorer-lens.js` is lifted from spoke-host.js's `openFrame` and `readBack`.
- It opens `explorer.html?embed=1&device&config&view&swap&fields` in an overlay.
- On close, it writes `current().swaps` and fields back to that item, by item `id`.
- If the user changed the config inside Explorer, the item's `cfg` changes with it. The showcase refuses this case; the builder has no fixed cast, so it has no reason to.

### 7.4 3D

`site/rack/scene3d.js` wraps `createRackScene`. Items map to its `stack`, with `reversed` taken from `turned` and rear-face items placed at the rear rails. The frame depths drive the rail positions.

### 7.5 Library (`site/rack/library.js`)

- IndexedDB database `portrayal-racks`, object store `docs`, keyed by document id. Each document is the §5 file plus `updatedAt`.
- **Autosave:** the working document is written after each change, debounced by 500 ms.
- **Save .json** downloads the file. **Open .json** validates it and migrates it.
- If IndexedDB is unavailable (private window or blocked storage), the page still works: a banner says the library is off, and Save/Open still work.

### 7.6 Rails (`site/rack/rails.js`, from `showcase/rails.js`)

- Holes are drawn per `frame.holes`: 9.5 mm square, or round with an optional thread label.
- The showcase keeps square holes, drawn at the corrected size.

## 8. Exports (`site/rack/exports.js`)

Every export is built from the saved model through `configuredFace()`, never from the DOM. Anything unresolved, such as a missing drawing or a device with no DCIM type, is listed in a notes block or sheet rather than dropped.

| Export | Content |
|---|---|
| SVG sheet | Front and rear side by side, plus a title block: rack name, frame, depths, hole style, date. Each face is also available on its own. |
| PNG | The same sheet at 2×, via `rasterize`. |
| draw.io | One page, with a front and a rear cabinet side by side. Port cells carry `portrayal-path`, and each cable that lands is an edge between two of them. |
| GLB / USDZ | From the 3D scene, after `scene.complete()`. In 2D, a "switch to 3D" button replaces them. |
| **DCIM import kit**, one zip per target | Files numbered in import order, zipped with `makeZip`, with a `README.txt` that says what to do with each, what must already exist, and what the kit could not carry. `types/`: NetBox or Nautobot YAML for every distinct device and module in the rack. NetBox: `1-rack.csv`, `2-devices.csv`, `3-modules.csv`, `4-cables.csv`. Nautobot: `1-devices.csv`, `2-modules.csv`, `3-cables.csv` and `import_cables.py`, which creates the cables from that file (Nautobot imports a cable's ends by id only). One device row per item, with NetBox's `device_type`, `rack`, `position`, `face` and `name` columns or Nautobot's equivalents; positions follow the frame's numbering. The site or location and the device role come from the rack's optional `dcim` settings; they are not what an Undo is about, so settings saved while an Undo is pending are carried into the rack it restores, and the 3D scene, which reads nothing of them, stays current. Nautobot's devices file names the rack by `rack__name` and `rack__location__name` together, because rack names repeat from one location to the next. A line break or another control character in a name (a rack file is anyone's JSON) is written as a space in every file and in the zip's name, and the README names each name that changed. Each README also says what to do on an instance that is not empty: a rack that is already there, and names the instance has twice. A row the target would refuse is left out and named in the README. |
| **BOM (CSV)** | Devices, modules and optics with counts, taken from `swaps`. Mounting hardware too: cage nuts, or screws of the chosen thread, counted as 2 per ear per U the device's ears cover. (Phase 2) cables grouped by media, connector and length, with "length not set" where it's empty. |
| Rack file | The §5 `.json`. |

## 9. Phase 2: cabling

### 9.1 Model

```json
{"id": "c1",
 "a": {"item": "i1", "path": "slot-2/module/p0", "view": "front"},
 "b": {"item": "i4", "path": "bay-1/module/lc1", "view": "front"},
 "media": "os2", "purpose": "uplink", "label": "",
 "length": {"value": 2, "unit": "m", "source": "entered"},
 "route": []}
```

`length` is optional. Its `source` is `entered` today. `route` is empty today.

### 9.2 Interaction

1. **Cable** mode makes every port in both panes clickable. Ports come from `configuredFace`, so card and optic ports are included.
2. The user clicks the A end, then the B end.
3. A popup proposes a `media` taken from the seated optic or port type, and has fields for purpose, label and length.
4. Cables are drawn by the existing `showcase/cables.js` geometry, moved to `site/rack/cables.js`. Front-to-rear runs leave by the rack edge, as in stage 4.

### 9.3 Rules

- One cable per port.
- A media mismatch is a **warning**, not a block.
- A cable to an empty cage is allowed and shows as a **loose end** with a reason, through `plan.js`'s existing `looseReason`.
- Moving an item keeps its cables.
- An Explorer change that removes a port turns its cable into a loose end with a reason. It is never silently deleted.
- Removing an item asks whether to delete its cables.

### 9.4 Cable list and exports

- A cable list panel with stage 5's media and purpose filter and click-to-highlight.
- A cable schedule CSV.
- Cables drawn on the SVG, PNG and GLB exports; cables as draw.io edges between `portrayal-path` port cells.
- The showcase's stage 6 already shows the plan's cables and carries them in its SVG, PNG and GLB exports (moved into Phase 0 as Task 4b, 2026-09-26). Phase 2 adds them to its draw.io export as edges.
- **NetBox and Nautobot cable import** (Phase 2c) is part of each target's import kit (§8). A port's name comes from the matched type file's own name lists, never from convention alone: a fixed port is its drawing path looked up there, and a card port `<bay>/module/<leaf>` is `<bay position>/<leaf>`, the name the module's `{module}/<leaf>` gets once the module is in the bay whose position is `<bay>`. So the modules file comes before the cables file. **Verified against real instances on 2026-10-04**, with `tools/dcim-verify/`: the kits the page exports for an acceptance rack (as exported at `2bbe359e`) were imported, in each README's order, into a NetBox 4.7.2 (17 steps, none failed: the type files, the rack, devices, modules and cables, all through the UI's import pages) and a Nautobot 3.2.6 (25 steps, none failed: the type files through Nautobot's own UI import, the devices and modules as `text/csv`, the cables through `import_cables.py`: a dry run, `--apply`, and `--apply` a second time on the same file, which reported every row as already connected and exited 0); the devices and the cables each instance held matched the kit's rows and the rack's. That run included: a second location on the Nautobot holding a rack with the same name as the kit's, with every device landing in the rack of its own location (`rack__name` with `rack__location__name`); the script tying each port to its device by id, card ports included; the kits' limits at their exact values (a 64-character device name, a 100-character cable label, a 200-character description, 999999.99 m, and a length that rounds up to 32,767); and two devices whose names differ only by case, each imported under the name the kit gave it. **Still proven only against a mock, not a real instance:** every refusal path of `import_cables.py` (an ambiguous device, a port already in another cable, a redirect, a refused token (401 or 403), a cable that does not show both ends after it is created); an instance with real data in it beyond that one same-named rack; and any version other than those two.

### 9.5 Out of scope, as in the patching spec

Cable managers, bundling, lacing bars, and cables between racks.

### 9.6 Plumbing for routing later

- `route` is an ordered list of waypoints, each `{item}` or `{at, offsetMm}`, so a route can later pass through horizontal cable managers (rail items) and vertical managers or ducts (zero-U items).
- `length.source` gains `routed` when routes can produce a length.
- Nothing in v1 reads `route` except the loader, which preserves it.

## 10. Code layout

Every module listed as moved is removed from `site/showcase/`, and the showcase imports from the new location. Showcase behavior must not change, apart from the fixes in §4.3 and the corrected hole size.

| Module | Job | Origin |
|---|---|---|
| `site/rack/face.js` | `configuredFace` | new (Phase 0) |
| `site/rack/model.js` | file format, defaults, migrations, id allocation | new |
| `site/rack/fit.js` | placement rules and reasons | new |
| `site/rack/rails.js` | rail geometry, hole styles | `showcase/rails.js` |
| `site/rack/elevation.js` | one face's 2D elevation, including ghosting and turned items | `build2dElevation` |
| `site/rack/scene3d.js` | 3D wrapper | `mount3d` + `rack3d.js` |
| `site/rack/explorer-lens.js` | Explorer overlay and read-back | `spoke-host.js` |
| `site/rack/library.js` | IndexedDB, autosave, `.json` I/O | new |
| `site/rack/exports.js` | §8 | stage 6 plus new |
| `site/rack/cables.js` | cable geometry (Phase 2) | `showcase/cables.js` |
| `site/rack-page.js` | page wiring only | new |

## 11. Testing

- **Unit tests:** `node --test` on `model.js` and `fit.js`, which have no DOM and no dependencies. They cover:
  - overlap on the same face;
  - the four-post depth budget, including boundary cases;
  - the two-post no-sharing rule;
  - `usableDepth`;
  - zero-U overlap;
  - migrations, including refusing a newer version;
  - round-tripping a saved file.
- **`check-browser.py`** gains rack.html and these checks:
  1. place a device at an RU;
  2. check it appears in both panes;
  3. reload, and check that autosave restored it;
  4. check that a device too deep for a shared RU is grayed out with a reason;
  5. check that each export produces a non-empty file.
- **`check-contract.py`** asserts the fields the builder reads: `chassis.ru`, `chassis.d`, `bays`, `cages`, and `views`.
- **Phase 0 regression:**
  - Stage 6's draw.io output for the showcase rack contains port cells for a seated card's ports. Today it has none.
  - The rear elevation shows rear-seated plugs.
- **Showcase:** after the module moves, the whole showcase runs through the existing browser checks.

## 12. Upstream dependencies

- **`{module}` naming token** on module-type ports (issue filed 2026-09-26). Landed: the vendored module types carry it, so it no longer blocks NetBox cable import (§9.4).
- **A Portrayal rack or cabinet item** (future): `frame.ref` (§5.1) is where it plugs in.
- **Zero-U devices** (future): no site change needed beyond catalog data (§5.3).
