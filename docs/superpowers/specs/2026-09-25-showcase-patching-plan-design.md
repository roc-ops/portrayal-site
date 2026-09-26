# Showcase stages 4–5: patch the rack we built, with cables that hang

**Date:** 2026-09-25
**Status:** design approved, ready for an implementation plan
**Builds on:** `2026-09-25-showcase-inspect-is-explorer-design.md` (roc-ops/portrayal-site#24), stage 2 dropdowns (#26)
**Upstream:** roc-ops/Portrayal#610 (RJ45 jacks accept no plug), filed from this design

---

## 1. Why

Feedback round 5, on stage 4 (Cable) and stage 5 (Filter):

1. **Stages 4 and 5 leave the rack.** Stages 0–3 build one rack: ASR-9006, R740xd, AS7726-32X and FHD-1UFCE. Stage 4 then switches to a different cast, `labs.json`'s three-site ROADM ring, with devices the visitor has never seen. The user wants stages 4 and 5 to keep the same rack and cable it through its patch panel, using a plan we write.
2. **The cables don't look like cables.** They are near-straight curves that overlap in the front-to-rear gap. The reference is homelable.net's rack canvas: every cable hangs between its two ports with a natural sag, short patch leads loop tightly, long runs hang deep, and color shows cable type.

**Portrayal already models connectors, so the cables should land on them.** Its connector parts (`generic/lc-plug@2`, `generic/lc-duplex-plug@2`, `common/lc-boot@1`, `generic/rj45-plug@1`, `common/rj45-boot@1`) seat through the same cage and occupant mechanism as optics. `vendor/relief.js`'s `cablePoints(svg)` returns one point per seated connector: the end of the boot, with its depth. That point is where a cable leaves.

## 2. Decisions made while brainstorming

| # | Question | Decision |
|---|---|---|
| D1 | The ASR-9006's cast config is the empty chassis, so it has no ports | Stage 4 **fills only empty slots** the plan needs and says so in the panel; a slot the visitor filled is kept. |
| D2 | Layout of front and rear | **Front only, with a Front/Rear toggle.** A cable whose other end is on the rear leaves the rack's side with a tag. |
| D3 | The R740xd is copper only, and the AS7726 has no copper data ports | **Add a copper top-of-rack switch: Edgecore AS4630-54TE** (`eps201`): 48× 1G RJ45, 4× SFP28, 2× QSFP28. |
| D4 | 3D | **The same cables in 3D,** as catenary tubes. |
| D5 | Architecture | **A plan file plus one shared cable geometry module** (option 1 of 3). |
| D6 | Land cables on connectors | **Every fiber end seats a real LC connector** and the cable starts at its `cablePoints` point. Copper can't yet (§5.4). |

## 3. The rack

`site/showcase/rack.js`'s `CAST` gains a fifth device. From the bottom up, with one free U between devices as now:

| Device | ref | cast config | U |
|---|---|---|---|
| ASR-9006 | `asr-9006` | `base` | 10 |
| R740xd | `r740xd` | `sff24-rc5-1b2a3a` | 2 |
| **AS4630-54TE** | `eps201` | `ac-f2b` (front-to-back, matching the AS7726) | 1 |
| AS7726-32X | `as7726-32x` | `ac-f2b` | 1 |
| FHD-1UFCE | `fhd-1ufce` | `populated` | 1 |

`RACK_U` still comes from `loadMeta` and `RACK_SIZES`. Every stage shows the new device: stages 0–3 and 6, Inspect (Explorer), and the "Look closer" strip.

## 4. The patching plan

### 4.1 The file

`site/showcase/patching.json` uses the shape of a Portrayal lab (`labs.json`), so it could be upstreamed later without reshaping:

```json
{
  "name": "showcase-rack",
  "title": "Example patching plan for the showcase rack",
  "description": "Invented for the showcase; not a real lab.",
  "devices": [{"id": "asr-9006", "ref": "asr-9006"}, "..."],
  "seats": {"asr-9006": {"slot-0": "cisco/a9k-rsp880-se@1", "...": "..."}},
  "links": [
    {"media": "os2", "purpose": "uplink",
     "from": ["as7726-32x", "port-1"], "to": ["fhd-1ufce", "bay-1/module/lc1"]}
  ]
}
```

- `devices[].id` is the cast ref.
- `seats` holds what the plan needs seated: cards, optics, plugs and boots, keyed the way `swap.js` keys overrides.
- `purpose` is new. It is one of `uplink`, `core`, `server` or `management`.

### 4.2 The 14 cables

| purpose | from → to | media |
|---|---|---|
| uplink | AS7726 `port-1`, `port-2` → FHD cassette 1 `bay-1/module/lc1`, `lc2` (leaves via the rear MTP trunk) | OS2 fiber |
| uplink | ASR `slot-2` card `p0`, `p1` → FHD cassette 2 `bay-2/module/lc1`, `lc2` | OS2 fiber |
| core | AS7726 `port-31`, `port-32` → ASR `slot-2` card `p2`, `p3` | OS2 fiber |
| core | AS4630 `port-53`, `port-54` (QSFP28) → AS7726 `port-29`, `port-30` | OS2 fiber |
| server | R740xd rear `ndc/module/port-1`, `-2` → AS4630 `port-1`, `port-2` | copper |
| management | AS7726 `mgmt-eth`, `slot-0` RSP `mgt-lan-0`, `slot-1` RSP `mgt-lan-0`, R740xd `idrac9` → AS4630 `port-45` to `port-48` | copper |

The implementation reads exact port paths off the seated faces. The contract (§8) proves every one.

### 4.3 What the plan seats

- **Cards (D1):** `slot-0` and `slot-1` get `cisco/a9k-rsp880-se@1`. `slot-2` gets `cisco/a9k-16x100ge-tr@1`, not the 4X100GE-SE: its 16 QSFP ports declare connection points and optic cages, while the 4X100GE-SE's CPAK ports declare neither.
- **Optics:** every cabled QSFP cage gets `generic/qsfp-lc@1`. That covers the AS7726, the AS4630 QSFP28 ports and the 16X100GE-TR.
- **Connectors (D6):**
  - Each optic has two cages that each accept `generic/lc-plug@2`. Each gets an LC plug, with `common/lc-boot@1` chained onto it.
  - Each FHD cassette adapter the plan uses gets `generic/lc-duplex-plug@2`, with a boot.

**The fill rule (D1):** a plan seat is applied only when the target holds its configuration default (a slot cover, an empty cage, or no override).
- A slot or cage the visitor already filled is left alone.
- If a cable's port doesn't exist on the visitor's card, that cable becomes a **loose end**. The panel says why, for example *"slot-2 holds A9K-24X10GE-1G-SE, which has no p2; seat the plan's card in stage 2 to connect it."*

The seats are written into `rack.js`'s `overrides`, the module state every stage and Inspect already share. So the filled cards, optics and plugs show in Inspect (Explorer's `swap=`) and in stage 6's exports. The panel lists every seat stage 4 made.

### 4.4 Honesty

The panel's first line is *"An example patching plan for this rack, not a real lab."* The old header comment in `04-cable.js`, which rejected inventing links, is replaced by this rule: the plan is labeled as invented, and every end in it is proven against the compiled faces.

## 5. Cable geometry: `site/showcase/cables.js`

One module owns the sag rule, the colors and the endpoint resolution for both views.

### 5.1 Endpoints

- **2D:** for fiber, call `cablePoints(faceSvg)` on each seated face and take the point whose `path` is the connector (the boot's point, because `cablePoints` groups plug and boot into one connector).
- **3D:** `rack3d.js` gains `cableAnchor(entry, connectorPath)`, returning `{position, normal}` in world space. It reads the same `cablePoints` result, including the depth from the boot's `data-z-out`, and maps it through the face-to-world transform `portAnchor` already uses.
- **Duplex:** at an optic, the two LC plugs are two points. The cable is drawn as two strands that merge about 25 mm out.
- **Copper (§5.4):** the jack's own connection point: 2D from the face, 3D from `portAnchor`.

### 5.2 2D curve

- **The curve:** a cubic Bézier with both control points straight below their ends, so the cable drops out of each connector and hangs in a U. The drop is a base value plus a term proportional to the distance between the ends.
- **Parallel cables fan out:** each cable in a group of parallel runs gets its own small sag offset, so two uplinks read as two cables, not one line drawn twice.
- **Stroke:** 3 mm to scale, with round caps and a thin dark edge. Cables are drawn above the faces.

### 5.3 3D curve

- **Leads:** a straight lead of about 40 mm along the connector's outward normal.
- **Catenary:** the stretch between the two leads is a catenary with slack proportional to the chord, sampled into a `CatmullRomCurve3`, then drawn as a `TubeGeometry` of radius 1.5 mm.
- **Front to rear:** the cable leaves the front, goes round the rack's right-hand side outside the posts, hangs there, and reaches the rear port.
- **Clearance:** every sampled point must lie outside every device body box and outside the face planes' interior. A stretch that would enter the metal is pushed outward along the face normal.
- **Duplex:** two thin tubes that merge into one.

### 5.4 Copper: the known gap

No RJ45 jack in the library declares a cage that accepts `generic/rj45-plug@1` (roc-ops/Portrayal#610). Until that lands, copper cables anchor on the jack's connection point, with no plug drawn, and the panel says so in one line. When #610 lands, the plan's `seats` gain the RJ45 plugs and boots, and copper takes the fiber path. No other change is needed.

*Amended 2026-09-26:* #610 has landed (via Portrayal #619/#620). The plan seats a `generic/rj45-plug@1` at every copper end, and copper lands on the plug's cable point in 2D and 3D, exactly as fiber does; the rear elevation seats the plan too, for the R740xd's iDRAC and NDC. Boots are not seated or drawn until Portrayal #611 lands.

### 5.5 Colors

The color table lives in `cables.js`, keyed by media and then purpose:
- OS2 fiber: yellow, the industry jacket color;
- copper data: blue;
- copper management: gray.

The legend is built from the plan, so a new media type or purpose gets its own entry automatically.

## 6. Stage 4 · Cable, "What is connected to what?"

- **2D (default):**
  - the rack's front elevation, through `build2dElevation`, with the plan's seats applied;
  - cables on top;
  - a **Front / Rear** toggle above the drawing (`view: 'rear'` elevation);
  - a cable whose other end is on the rear leaves past the right-hand edge with a tag such as *"→ R740xd rear · NIC 1"*, and clicking the tag flips the view. On the rear, the cable arrives from the matching side (the left, when seen from behind).
- **Interaction:** hovering a cable highlights it and dims the rest, with a tooltip naming both ends. Clicking a plan row in the panel highlights that cable.
- **3D:** the same rack with the plan's seats, and 14 tubes. Clicking a panel row highlights that tube.
- **Panel:**
  1. the honesty line;
  2. the seats stage 4 made;
  3. counts by purpose and media;
  4. the legend;
  5. the plan grouped by purpose;
  6. a named line for any loose end;
  7. a one-line note that copper has no plug yet (#610).
- **Rules that still apply:**
  - every write after an `await` goes through `ui.live()`;
  - the panel is built without WebGL (R11);
  - the "Look closer" strip is unchanged.

## 7. Stage 5 · Filter, "Show me just management."

- **Same content as stage 4:** the same rack, seats and cables, in 2D and 3D, with the Front/Rear toggle.
- **Filters:** two rows, both built from the plan.
  - purpose: uplink 4, core 4, server 2, management 4;
  - media: fiber 8, copper 6.
  - The two rows combine, and each button shows its count.
- **Non-matching cables fade to a ghost** instead of disappearing. The panel says *"4 of 14 cables"*.
- **Seats:** entering stage 5 applies stage 4's seats first, by the same code path.

## 8. Testing

**Contract** (`check-contract.py`, every check recording on every run):
- `CAST` has the five devices, in order, and each cast config exists in its index.
- Every `patching.json` device is in `CAST`.
- Every link end resolves to a port on the compiled face, or on the face of the card the plan seats there, and that port declares a connection point.
- Media matches at both ends.
- Every fiber end's plan seat names a plug that its cage accepts, and the boot chains onto that plug.
- The stages 4/5 files don't import `ring.js` or `ring2d.js`, and don't read `labs.json`.
- The filter values are derived from the plan: no hardcoded purpose or media list in `05-filter.js`.
- 2D and 3D take their colors and sag from `cables.js`: no color table or sag constant in the stage files or `rack3d.js`.
- The honesty line is present in `04-cable.js`.

**Browser walk** (`check-browser.py`):
1. **Stage 4 in 2D:**
   - 14 cables are drawn;
   - every fiber cable's ends sit on a `cablePoints` point of a seated connector;
   - the panel lists the seats;
   - `slot-2` holds the 16X100GE-TR when it was empty.
2. **The fill rule:** seat a different line card in `slot-2` during stage 2, then enter stage 4. The card is kept, and its cables show as loose ends with the reason.
3. **Front/Rear:**
   - the "→ R740xd rear" tag flips to Rear;
   - that cable lands on `ndc/module/port-1`;
   - the toggle returns to Front.
4. **Stage 4 in 3D:**
   - 14 tubes;
   - each fiber tube's first point is within 1 mm of its `cableAnchor`;
   - no sampled tube point is inside a device body box.
5. **Stage 5:** management leaves 4 cables at full opacity and ghosts 10, in 2D and in 3D.
6. **No WebGL:** stages 4 and 5 still build their panels.
7. **Stages 0–3 and 6:** the five-device rack is drawn, and the existing walk steps pass.

## 9. Order of work

1. **The AS4630-54TE joins the cast.** Stages 0–3 and 6, and Inspect, show five devices. Existing checks are updated.
2. **`patching.json`, the plan's seats and the fill rule**, applied on entering stages 4 and 5, with the contract checks of §8.
3. **`cables.js` and the 2D stage 4:** endpoints, sag, colors, the Front/Rear toggle and tags, hover and panel.
4. **3D stage 4:** `cableAnchor` in `rack3d.js`, catenary tubes and the clearance rule.
5. **Stage 5 on the plan, then retire** `ring.js`, `ring2d.js`, their CSS and the ring checks.

## 10. Out of scope

- Stage 6's GLB/USDZ export of the cable tubes. Its exports carry the seated plugs and boots, but not the cables.
- RJ45 plugs, which wait on roc-ops/Portrayal#610.
- Picking a cable by clicking it in the 3D canvas.
- Cable bundling, cable managers and lacing bars.
- Upstreaming `patching.json` as a Portrayal lab.
