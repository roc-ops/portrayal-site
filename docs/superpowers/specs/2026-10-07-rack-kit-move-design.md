# The rack core moves into @portrayal/kit

**Date:** 2026-10-07
**Status:** design approved in conversation; spec awaiting review
**Builds on:** `2026-10-07-rack-face-managers-design.md` (#120), `2026-10-07-cable-routing-pathways-design.md` (#127), and the Refactor agent's `2026-10-07-rack-command-core-design.md` (its piece 1, which lands first)
**Split:** piece 2 of four in the command-core spec §1, agreed between the two sessions and confirmed by Jason (memory: `rack-kit-split`)

---

## 1. Why

The Rack Builder's core is site-only today. It covers the rack file, fit rules, managers, cables, routes and the export rules, and it sits in `site/rack/`. Jason wants it in `@portrayal/kit`, so anyone can build, check and export racks, not only portrayal.dev.

| Piece | Owner | What |
|---|---|---|
| 1 | Refactor agent | The command core: `validate`, `commands`, `history`, `editor`, `queries` and `rack.schema.json`, with `rack-page.js` going through `apply()` |
| **2 (this spec)** | this session | The pure core moves to upstream `kit/rack/`; upstream builds `rack.json`; the site vendors both |
| 3 | Refactor agent | The builder as a kit component, with the 2D elevation and the 3D rack scene |
| 4 | Refactor agent | Annotate and Explorer hooks upstream |

Cable-management piece 3 (bundles and straps) is built in the kit after this lands.

## 2. Decisions

| # | Question | Decision |
|---|---|---|
| D1 | Scope | **The pure core only.** Drawing (2D elevation, 3D scene, `cable-view`, `route-context`) waits for piece 3. |
| D2 | The catalog in the kit | **Upstream builds `rack.json`** into `library/dist/`. The kit reads it through `dist`. |
| D3 | How the site uses the kit | **Every import is rewritten once** to `vendor/rack/<module>.js`. The site's copies are deleted, with no shims. |
| D4 | Tests | **They move upstream** with their modules. The site keeps tests for what stays in the site. |
| D5 | Sentences the moved modules produce | **The kit's sentence wins.** It is upstream's text, in British spelling, and the site shows it as is. A translation layer is not built. Every sentence that changes on the site is listed in the site PR. |
| D6 | Identifiers and data keys | **Unchanged** (`colorOf`, `COLORS`, `"color"`). Only comments and prose follow British spelling. |
| D7 | Version | Kit **0.3.0**: new exports, nothing removed. |
| D8 | Landing | Upstream PR first, landed by Portrayal's merge agent. Then the site PR, landed by the Portrayal-site merge agent. |

## 3. What moves

| Site today | Kit `kit/rack/` | Notes |
|---|---|---|
| `model.js`, `fit.js`, `managers.js`, `rails.js`, `cable-rules.js`, `route.js`, `route-path.js` | same names | Pure already. `isRackMount` moves from `export-data.js` into `fit.js`, beside `isRackFace`, which undoes the `fit.js` → `export-data.js` import. |
| `export-data.js`, `dcim-rules.js` | same names | No DOM, so they move whole. They now import `isRackMount` from `./fit.js`. |
| `cables.js` | `cable-geometry.js` | Only the pure parts move: `hangPoints3d`, `routePoints3d`, `danglePoints3d`, `clearOf`, `COLORS`/`colorOf`, `JACKETS`/`colorOfJacket`, `PLUGS`/`plugColorOf`, `WIDTH`, `TAG_H`, `sag2d`, `LEAD`, `LEAD_DROP`. `drawCables2d`, `drawCables3d`, `ends2d`, `looseOn` and `plugAt` stay in `site/rack/cables.js`, which imports the geometry from the kit. |
| `chassis.js` | `catalog.js` | `loadCatalog(dist) → Promise<{chassisOf, entries, devices}>` reads `rack.json` through `dist` (`../dist.js` `jdist`). `chassisLookup` and `catalogEntries` move with it. |
| the Refactor agent's `validate.js`, `commands.js`, `history.js`, `editor.js`, `queries.js` | same names | Pure, and written for the kit. The exact list is the one in its PR description. |
| `rack.schema.json` | upstream `spec/schemas/rack.schema.json` | Published like the other schemas, at `portrayal.dev/schemas/v1/`. |

**Stays in the site (piece 3):** `elevation.js`, `face.js`, `cable-view.js`, the drawing half of `cables.js`, `route-context.js`, `scene3d.js`, `rack3d.js`, `exports.js`, the panels, `drag.js`, `zoom.js`, `dom.js`, `library.js` and `rack-page.js`.

**Rule:** nothing in `kit/rack/` imports outside it, except `catalog.js` → `../dist.js`. Nothing in it touches `document`, `window`, `DOMParser`, `fetch` (other than through `jdist`) or `localStorage`. 3D geometry takes `THREE` as a parameter.

## 4. `rack.json`, built upstream

`spec/tools/portrayal/rack_index.py`, run by `./build.sh`, writes `library/dist/rack.json`:

```json
{"format": 1, "generated-from": "devices.json and <name>.configs.json, by rack_index.py",
 "devices": {"fhd-cmp5dr": {"manufacturer": "FS.com", "model": "FHD-CMP5DR", "family": null,
   "ru": 1, "h": 44.0, "w": 483.0, "d": 110.0, "airflow": null, "default": "base",
   "configs": ["base"], "mount": "rack-face", "shell": "sheet",
   "capacity": {"count": 30, "basis": "..."},
   "guides": {"top": ["guide-1", "..."], "front": ["guide-1", "..."]}}}}
```

- **Content:** exactly what the site's `chassis-index.py` writes today, key for key, so the site's behavior does not change.
  - `ru` is as stated, else derived from height.
  - `mount` is written only when it is not `rack`. `shell` and `capacity` are written only when present.
  - `guides` and `passes` are per view (top, front, rear) of the default configuration. They follow the `marked()` rules: a `data-guide` element by its id, a ring end `<id>-end` with `data-kind="ring"` as `<id>`, `guide--<id>` as `<id>`, `pass--<id>` as `<id>`, and a `data-group="guides"` element with `data-ref` by its id.
- **Contract:** it is listed in `docs/format-stability.md` as a published file with `format: 1`, and gets a `CHANGELOG.md` entry. A change that removes or renames a key is a contract change.
- **Tests:** pytest cases for each `marked()` rule, a rack-face mount, a sheet shell and a stated capacity.

## 5. The kit's layout

- **`kit/package.json`:**
  - one export per module, for example `"./rack/model": "./rack/model.js"`, `"./rack/catalog": "./rack/catalog.js"`;
  - `files` gains `rack/*.js`;
  - version `0.3.0`;
  - `test` runs `node --check` on every `rack/*.js`.
- **`kit/README.md`:** a "Racks" section listing each module and its main functions. It includes a minimal example (load the catalog, create a rack, place a device and a manager, add a cable, read its route, produce a BOM and a schedule) and a link to `rack.schema.json`.
- **Comments and prose:** British spelling (D6). Identifiers and data keys are unchanged.

## 6. The site after the move

- **`refresh-assets.sh`:** vendors `kit/rack/*.js` into `vendor/rack/`, and `dist/rack.json` with the rest of `dist`.
- **Imports:**
  - every import of a moved module is rewritten to `vendor/rack/<module>.js`;
  - the moved files are deleted from `site/rack/`;
  - `chassis-index.py` and `site/rack/chassis.json` are deleted;
  - `site/rack/cables.js` keeps its drawing half and imports `cable-geometry.js`;
  - the page loads the catalog with `loadCatalog(dist)` in place of `loadChassis`.
- **`check-contract.py`:**
  - `vendor/rack/` matches the kit;
  - `rack.json` carries the facts the `chassis.json` checks assert today (the FHD-CMP5DR's mount, ru, shell and capacity; the three managers' guides and passes);
  - no `site/rack/*.js` exports a name that a `vendor/rack/` module exports.
- **Tests:** node tests for moved modules are deleted from `tests/rack/`. Tests for what stays import from `vendor/rack/`.
- **Sentences (D5):** every sentence the moved modules produce is checked for American/British differences, and each one that changes is listed in the site PR. Browser-check expectations change only for those.

## 7. Order

1. **Wait** for the Refactor agent's command-core PR to land on the site.
2. **Upstream PR** (roc-ops/Portrayal), landed by Portrayal's merge agent:
   - `rack_index.py` and `rack.json`, with tests;
   - `kit/rack/*`, with the site's tests ported to `spec/tests/js/rack-*.mjs`;
   - `spec/schemas/rack.schema.json`, with its publication;
   - kit 0.3.0, the README, `format-stability.md` and `CHANGELOG.md`.
3. **Site PR**, after upstream lands, landed by the Portrayal-site merge agent: re-pull Portrayal, vendor, rewrite imports, delete copies, update `check-contract.py` and the tests, and run every check.

Until step 3, the site runs on its own copies, unchanged.

## 8. Testing

- **Upstream:**
  - the ported unit tests, with every assertion kept;
  - `rack_index.py` pytest cases;
  - a schema test that every site fixture rack validates against `rack.schema.json`;
  - `cd kit && npm test`;
  - upstream lint and gates.
- **Site:**
  - `node --test tests/*/*.test.mjs`;
  - `check-contract.py`;
  - the full `check-browser.py`, which is the acceptance test. It must pass with no expectation changed, apart from the sentences listed under D5.

## 9. Out of scope

- Drawing in the kit: elevation, 3D scene, cable view, route context, exports that build files from the DOM (piece 3).
- The builder as a component (piece 3), and the Annotate and Explorer hooks (piece 4).
- Bundles and straps (cable management piece 3, after this).
- Codes-plus-values messages instead of sentences (D5 chose sentences).
- Precomputing guide positions and apertures into `rack.json`, which would make `route-context.js` lighter. Worth doing in piece 3.
