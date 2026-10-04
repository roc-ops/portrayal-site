# Rack Builder Phase 2c: an import kit for NetBox and Nautobot (implementation plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the Rack Builder's DCIM exports import end to end, in order, into NetBox and into Nautobot: the prerequisites a file can create, the devices, the modules, the cables.
- The Export menu's four DCIM entries become **one zip per target**: "NetBox import (.zip)" and "Nautobot import (.zip)". Each is a kit: its files are numbered in import order, and a `README.txt` says what to do with each, what must already exist, and everything the kit could not carry.
- NetBox kit: `types/…`, `1-rack.csv`, `2-devices.csv`, `3-modules.csv`, `4-cables.csv`, `README.txt`.
- Nautobot kit: `types/…`, `1-devices.csv`, `2-modules.csv`, `3-cables.csv`, `import_cables.py`, `README.txt`. Nautobot imports a cable's ends by id only, so the kit ships a file that names the ends and a script that looks them up and creates each cable.
- A small **DCIM import settings** form (site or location, device role) whose values are stored in the rack file.
- A **verification kit in the repository** (`tools/dcim-verify/`) that imports the really exported kits into a real NetBox and Nautobot. The user runs it; Task 10 says how, and what output proves each ruling.

**Architecture:**
- **`site/rack/dcim-rules.js`** (new, pure, node-tested) holds every rule a kit follows: a type file's own name lists, what a cable end is called and which kind of component it is, the modules and cables rows, the media and length rules, and the README's text.
- **`site/rack/export-data.js`** (pure) keeps the devices rows, which gain the import settings and the rule for rows a target would refuse, and gains the rack row.
- **`site/rack/model.js`** (pure) gains the optional `dcim` settings of a rack. **`site/rack/dcim-form.js`** (new) is their panel form.
- **`site/rack/exports.js`** fetches the type files, reads the faces through the readers the other exports use (`seatedPartsOf`, `cableEnds`), and builds each kit with `dcimKit`.
- **`site/rack/nautobot/import_cables.py`** (new) is a real file in the repository, served with the site and fetched into the Nautobot zip. It is never built from strings in JavaScript.
- **`site/rack-page.js`** only wires: the menu entries, the settings form.
- **`tools/dcim-verify/`** (new) holds the verification kit: the column probes that produced `result.json`, a scripted export of the acceptance rack's two kits, and `kits.py`, which imports them.

**Tech stack:**
- Vanilla ES modules with no bundler, served by `serve.py`.
- `node --test tests/rack/*.test.mjs` for the pure modules.
- Playwright checks in `check-browser.py`, registered with `@extra` and run with `python3 check-browser.py --only <function names, comma-separated>`.
- `python3 check-contract.py` for the text contracts. It also runs the two Python test files this plan adds (Tasks 6 and 10), so the pre-push hook and CI run them with no change to either.
- Python 3 standard library only for `import_cables.py` and `tools/dcim-verify/`.

**Spec:** `docs/superpowers/specs/2026-09-26-rack-builder-design.md`, §8 (the DCIM rows of the exports table), §9.4 (its last item, cable import) and §12. Read §5, §8 and §9 before starting. Task 11 brings the spec's wording up to date.

**Rulings:** `.superpowers/sdd/rack-2c/rack-2c-rulings.md` (eleven, binding). The ones a task depends on are restated in that task.

**Ground truth:** `.superpowers/sdd/rack-2c/result.json`, the output of the verification kit run by the user on 2026-10-04 against a real NetBox 4.7.2 and a real Nautobot 3.2.6. Every column name, accepted value and error text in this plan is from it. Where another document disagrees with it, it wins.

## Before you start

- Work on the branch `rack-builder-2c`, in its worktree. Run `git fetch origin && git rebase origin/main` before Task 1. This plan was written against `origin/main` at `6974f254`.
- If a "replace" block no longer matches character for character after the rebase, make the same change to the code as it now stands and say so in your task report.
- `.superpowers/` is not tracked by git. Tasks 9 and 10 copy files from `.superpowers/sdd/rack-2c/dcim-verify-kit/`, which the controller's worktree has. If yours does not, ask the controller for it before Task 9. Tasks 1 to 8 do not need it.
- Serve locally with `python3 serve.py 8932`. `file://` does not work. `check-browser.py` starts its own server.
- Run `uptime` before debugging a browser check that times out: a loaded machine makes the checks slow, and that is not a failure of the page.
- **No task contacts the user's NetBox or Nautobot.** No task reads, asks for, stores or uses a credential for them. The acceptance run (Task 10, Step 7) is the user's.

## Global constraints

- **Never edit anything under `vendor/` or `assets/`.** They are upstream snapshots. The kits read `assets/exports/` as it is.
- No bundler, no npm, no new dependency. Modules import each other by relative path.
- These must not touch the DOM or fetch, because `node --test` imports them: `site/rack/model.js`, `site/rack/fit.js`, `site/rack/rails.js`, `site/rack/export-data.js`, `site/rack/cable-rules.js`, and the new `site/rack/dcim-rules.js`.
- **The showcase must not change.** A tool page must not import `site/showcase/artifact.js` (`tests/rack/imports.test.mjs` enforces it).
- **A DCIM CSV is written verbatim**: `toCsv` with its default cell, never `bomCell`. A formula-guard apostrophe would corrupt a name on import.
- **A port's name comes from a type file's own name lists, never from convention alone** (ruling 4). Anything that does not resolve gets no row and a README line.
- **A row a target would refuse is not written** (ruling 3): NetBox takes each file whole or not at all. It is left out, and the README says which, why, and what to do.
- **NetBox reads a comma in a device or port cell of a cable row as a list.** Such a cable is left out and said.
- **The kit never offers a file to feed Nautobot's own cable importer** (ruling 7): a row whose ends are given by name is accepted and creates a cable with no ends.
- **Every export says what it could not carry**, in the file, and the status line counts only what the file holds. A type file or a face that cannot be read never fails a kit silently or with a generic message: the kit comes without that part and its README says which.
- **An old document opens unchanged.** A rack with no `dcim` field has none after loading and saving. A rack with no cables still exports a correct kit.
- **A device's name is `uniqueNames`' and its U is `positionOf`**, the same in every file of a kit and in every other export.
- **Plugs are derived, never stored.** A kit lists what `item.swaps` and the configuration seat, never a plug a cable seats.
- Handlers read `rack()` at click or change time, not a rack captured when a panel or a menu was built.
- Anything keyed by an id from a file goes through `CSS.escape` in a selector and `textContent` (or a property such as `value`) in the DOM. A name from a file is text, never markup.
- Forms are panel forms in the side panel. No `prompt()`, no new `confirm()`.
- No new `site/rack/rack.css` rule is needed by this plan. If you add one, scope it under `.rk-…` or a `data-` attribute this page owns.
- Probe hooks live only under `?probe=1` (`window.__rack`). This plan adds none to the page: it extends what the existing `window.__rack.failExport` can make fail.
- UI copy and comments are American English. UI copy is sentence case, with no "please" and no exclamation marks.
- **Never pass an async function as a `page.wait_for_function` predicate.** A promise is truthy at once. Wait on a synchronous predicate, then `page.evaluate` the awaiting.
- In a browser check: a cable group or layer is waited for by presence, not visibility (`wait_sel` does this); never query the side panel or the menu right after a document-state wait (wait for the expected text or element); no fixed sleep except to guard a negative assertion.
- Browser checks are `@extra`-registered, each `@extra(...)` line directly above its `def`, and run with `--only`. Local full-suite runs can flake on showcase 3D and page-load timeouts (issue #59). Treat a failure as environmental **only if it reproduces on `main`**.
- **Security.** No task may read, request, store or use credentials for the user's instances. `import_cables.py` and `tools/dcim-verify/` read them from environment variables the user sets, never print or write them, and are run by the user.
- Every commit message ends with a `Co-Authored-By:` trailer naming the model that wrote it. The commands below show `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; an implementer on another model uses its own.

## Facts the tasks rely on (verified 2026-10-04 on `origin/main` at `6974f254`)

Every code block in Tasks 1 to 11 was applied, in order, to a scratch copy of the repository at that commit, and its tests were run there: each task's new tests against the previous task's code (they fail as the task says), then against the task's own code (they pass). "What was and was not executed", at the end of this section, says exactly how far that goes.

**What the real instances established (`result.json`)**
- **NetBox 4.7.2, through the UI's import pages.** An import file is one transaction: one refused row refuses the whole file.
  - The repository's device-type and module-type YAML import as they are. A site, a device role and the manufacturers must exist first.
  - Racks: `site,name,status,width,u_height` is accepted, and so is `desc_units` (`true` for a rack numbered top down). Status `planned` is accepted.
  - Devices: the columns of `NETBOX_COLUMNS`. A blank `role` or `site` is refused ("Record 1 role: This field is required."), and with a blank site the rack is not found. Two full-depth devices sharing a U front and rear are refused: "Record 3 position: U14 is already occupied or does not have sufficient space to accommodate this device type: … (1.0U)".
  - Modules: `device,module_bay,module_type,status` is accepted. `status` is required. A `manufacturer` column is refused ("Unrecognized header: manufacturer").
  - After the module import, the card's ports exist as `<bay position>/<leaf>`: `slot-2/p0` to `slot-2/p15`.
  - Cables: `side_a_device,side_a_type,side_a_name,side_b_device,side_b_type,side_b_name,type,status,label,color,length,length_unit,description` is accepted. Types `smf-os2`, `mmf-om3`, `mmf-om4`, `mmf-om5`, `cat6`, `cat6a`, `dac-passive` and `aoc` are accepted; `os2` is refused. Status must be `planned`, not `Planned`. `1.5,ft` is accepted. A header without `type` is accepted. An unknown column is refused. A console port to an interface is refused ("Incompatible termination types: consoleport and interface"). A port already cabled is refused ("Side A: … is already connected"). A missing port is refused ("B side termination not found: …").
- **Nautobot 3.2.6, CSV to the REST API as `text/csv`** (the UI's Import Objects job uses the same parser).
  - Devices: the columns of `NAUTOBOT_COLUMNS`. A blank `role__name` or `location__name` is refused. **Nautobot accepted the two devices sharing U14.**
  - Modules: `module_type__manufacturer__name,module_type__model,parent_module_bay__parent_device__name,parent_module_bay__name,status__name` is accepted. The card's ports get the same names, `slot-2/p0`…, and are listed by `GET /api/dcim/interfaces/?device=<device name>`.
  - **Cables: a row whose ends are given by name is ACCEPTED BUT NOT CONNECTED.** The end columns are ignored and an empty cable is created. A row works only as `termination_a_type,termination_a_id,termination_b_type,termination_b_id` (ids), with `type`, `status__name` (`Planned`), `label`, `color`, `length` (a whole number: `1.5` is answered "A valid integer is required.") and `length_unit`. A header without `color`, `length` and `length_unit` is accepted. The answer to an accepted POST is HTTP 201 and a JSON list whose items carry `termination_a_id` and `termination_b_id`.
  - A console port to an interface is refused ("Incompatible termination types: interface and consoleport").
  - Device-type YAML through Nautobot's UI was **not exercised**: no UI sign-in was given, so the types were created over REST.

**The vendored type files (`assets/exports/{netbox,nautobot}/`, read-only)**
- 2,474 YAML files, listed in `assets/exports/files.json` (`{netbox: [...], nautobot: [...]}`, each path starting with its target folder). `assets/exports/index.json` maps a device ref to its device-type paths per target.
- The exporter writes every component as `  - name: X` under a top-level `section:` line, with its other fields indented four spaces beneath (`    position: slot-2`). A value is plain, or quoted with `'…'` (a `'` doubled) or `"…"`. A line-based reader agrees with a YAML library on every one of the 2,474 files (checked while writing this plan).
- Sections that hold cable ends: `interfaces`, `front-ports`, `rear-ports`, `console-ports`, `console-server-ports`, `power-ports`, `power-outlets`. Bays are under `module-bays`, each with a `name` and a `position`.
- **A bay's `position` is the drawing's bay id; its `name` is for display.** `Edgecore/7726-32X-O-AC-F.yaml` has `Fan 1` at `fan-1`; `Casa Systems/C40G-CHASSIS-AC.yaml` has `Front 0` at `front-0`; `Cisco/ASR-9006-AC-V2.yaml` has `slot-2` at `slot-2`. No device type has two bays with one position.
- Every component name in every module type starts with `{module}/` and holds the token once. No module type has `module-bays`, so a module seated inside a card has no bay to be imported into.
- A console port is under `console-ports`, named `Console`, or `Console (USB-C)` and the like, not by its drawing path: `Telco Systems/TM-280.yaml` lists `Console`, and the drawing's path for it is `con`. The drawing marks a console port with `data-role="console"`.
- The fixture's types: `Cisco/ASR-9006-AC-V2.yaml` (no interfaces, 11 bays), `Edgecore/7726-32X-O-AC-F.yaml` (`mgmt-eth`, `port-1` to `port-32`, …), `Telco Systems/TM-280.yaml` (`port-1-1`, `port-2-1`, `port-3-1`, `copper-3-1`, `port-2-2`; console `Console`; power `dc-in`), `module-types/Cisco/A9K-16X100GE-TR.yaml` (`{module}/p0` to `{module}/p15`). The NetBox and Nautobot copies of these four list the same names.
- All three fixture device types are `is_full_depth: true`.

**The document (`site/rack/model.js`, pure)**
- `parseDoc` builds each rack from the fields it knows: `id`, `name`, `frame`, `items`, `zeroU`, `cables`. **A rack-level field it does not know is dropped.** So `dcim` is read explicitly (Task 5). `VERSION` is 1 and stays 1.
- `withFrame`, `renamed` and the other edits return a new rack. `positionOf(frame, ru, u)` is the lowest-numbered U a device covers, as the frame counts.

**The exports (`site/rack/exports.js`, `site/rack/export-data.js`)**
- `dcimContext(rack, chassisOf, target, {modules = true})` resolves to `{items, types, modules, parts, notes}`. `items` is `itemsWithU(rack, chassisOf)` (each item with its height `u`, and `mount` when it is not a rack's). `types` is `Map(item id -> {path, guess, candidates, otherVendor, chassisManufacturer, manufacturer, model, isFullDepth} | null)`. `parts` is `[{path, ref, itemId, label}]`: every seated part of every item, one per path, read off both of the device's configured panels by `seatedPartsOf`. A part's path ends `/module` (a bay's occupant) or `-occupant` (a cage's). `modules` is one `{ref, comp, model, path}` per distinct part ref; `path` is its module-type file or `null`.
- Today `dcimContext` awaits `yamlHead(await fetchText(...))` with no catch: one type file that fails to load fails the whole export with "That export didn't work. Try again." Task 7 fixes that.
- `dcimTypesZip`, `deviceImportCsv` and export-data.js `dcimNotesText` are today's DCIM exports. Task 8 removes them.
- `deviceImportRows({rack, items, types, target})` writes one row per item, with `role` and `site` (or `role__name` and `location__name`) blank, and a comment "Shares its U with …; <target> refuses this while either type is full depth." That comment is false for Nautobot.
- `uniqueNames(items)` gives `Map(id -> {name, renamed})`; a repeated label becomes `` `${label}-${id}` ``. `cableNames(rack)` gives `Map(cable id -> name)`. `cableFindings(rack, ends)` gives one `{cable, name, loose: [{side, end, reason}], warnings, checked}` per cable.
- `rackNotes(rack, {cables = true})` returns the zero-U line and, unless `cables: false`, "N cables are not in this export yet."
- `cableEnds(rack)` resolves to cable-plugs.js `cableFacts(rack)`, or `UNCHECKED` (`{seats: {}, ends: new Map(), unchecked: true}`) if reading the faces fails. `faceOf(item, view)` resolves to the configured face (`{text, ports, seat, …}`) or `null`.
- `failExport(what)` (probe only, reached through `window.__rack.failExport` under `?probe=1`) sets a module-level `probeFail` object; `{facts: true}` makes `cableEnds` fail.
- `toCsv(columns, rows, notes = [], {cell = csvCell})` writes CRLF lines. `exportStatus({notes, left, leftText})` reads "Downloaded, with N notes in the file." `makeZip(entries, date)` (`site/bundle.js`) takes `[{name, bytes}]` and resolves to a `Blob`, entries in the order given.
- `fetchText(url)` memoizes a successful fetch and forgets a failed one.

**The page (`site/rack-page.js`)**
- `BUILD` maps an export kind to a builder; `runExport(kind)` handles `json` and `to-3d` itself; `renderExports()` builds the menu's buttons with `act(kind, text, title)`, each `[data-export="<kind>"]`.
- `renderSide()` shows the panel for `S.sel`: `{kind: 'frame'}` is the frame form. A form's fields commit on `change`. `S.focusNext` names the element that takes the keyboard after the next redraw. `select(sel)` sets `S.sel` and redraws.
- `commit(nextRack)` keeps the 3D scene when `items`, `frame` and the cables are unchanged, so a settings change rebuilds nothing.
- `.rk-side label` and `.rk-side input` style a panel form's fields already; `.rk-actions` its buttons.

**How the checks run**
- The pre-push hook (`hooks/pre-push`) runs `python3 check-contract.py`, then `node --test tests/*/*.test.mjs`, then `python3 check-browser.py` when the push touches the site. CI (`.github/workflows/checks.yml`) runs the same three, the browser pass in four shards.
- `check-contract.py` already runs other programs (`tools/build-public.py --list`, `tools/nos_platforms.py`) and checks what the site serves: `_srv` maps each served path to its source. It reads `git ls-files`, so **a new file is served only once it is staged or committed.** `tools/` is never served; `site/` is.
- `check-contract.py` imports `check-browser.py` and requires every `@extra(...)` line to be directly above a `def`, and each such function to be a unit. A new `@extra` check needs no other registration.
- On this commit: `node --test tests/rack/*.test.mjs` passes 160 tests; `python3 check-contract.py` prints `contract: 296 checks passed`.
- `check-browser.py` helpers: `EXPORT_FIXTURE` (four devices, no cables: `core-1` an ASR-9006 at U2 with the 16x100GE card in `slot-2`; `leaf-1` an AS7726 at U14; two TM-280s labelled `demarc` on the rear at U14 and U20, named `demarc-i3` and `demarc-i4`), `CABLE_FIXTURE` (the same rack, named "Cable test", with `c1` leaf-1 `port-1` to core-1 `slot-2/module/p0`, os2, label "A1", 2 m; `c2` leaf-1 `mgmt-eth` to the demarc at U14 `port-2-1`, cat6a; `c3` leaf-1 `port-2`, an empty cage and so a loose end, to the demarc at U20 `port-2-1`), `EMPTY_FIXTURE`, `open_fixture(page, base, fixture)`, `open_cabled(page, base, fixture=None)`, `export_file(page, kind)`, `export_status(page)`, `notes_status(n)`, `read_csv(dl)`, `wait_fn(page, label, expr)`, `wait_sel(page, label, selector)`, `READY_MS`.
- **leaf-1 (front) and the demarc at U14 (rear) share a U, and both types are full depth.** NetBox refuses that pair; Nautobot accepts it.

**What was and was not executed while writing this plan**
- Executed: every node test, red then green; `python3 check-contract.py` (299 checks at the end); each new or changed browser check with `--only`, red then green where the red run is quoted; the whole browser suite once after Task 11.
- Executed against a **local mock only**: `import_cables.py` (`tests/rack/import_cables_test.py`), and `tools/dcim-verify/kits.py` (`selftest.py`, and once more by hand with the two kits really exported from the page for `acceptance.rack.json`). The mock answers in the shapes `result.json` records.
- **Not executed: anything against a real NetBox or Nautobot.** No kit made by this plan's code has been imported into one. Task 10, Step 7 is that run, and it is the user's. What only it can prove is listed there.

## File map

| File | Responsibility | Task |
|---|---|---|
| `site/rack/dcim-rules.js` (new) | A type file's name lists; what a cable end is called; the modules and cables rows; the README | 1, 3, 4 |
| `tests/rack/dcim-import.test.mjs` (new) | Node suite for those rules, against the vendored YAML | 1, 3, 4 |
| `site/rack/export-data.js` | The devices rows with the settings and the left-out rule; the rack row; NOTES.txt retired | 2, 8 |
| `tests/rack/dcim.test.mjs` | Node tests for the devices rows | 2, 8 |
| `site/rack/model.js`, `tests/rack/model.test.mjs` | The optional `dcim` settings of a rack | 5 |
| `site/rack/dcim-form.js` (new) | The settings, as a panel form | 5 |
| `site/rack-page.js` | The settings entry and form; one import entry per target | 5, 8 |
| `site/rack/nautobot/import_cables.py` (new) | Creates the cables in Nautobot from `3-cables.csv` | 6 |
| `tests/rack/import_cables_test.py` (new) | Its tests, against a mock Nautobot | 6 |
| `check-contract.py` | Runs the two Python test files; checks the script is served | 6, 10 |
| `site/rack/exports.js` | `dcimContext` with name lists and tolerant of a failed type file; `dcimKit`; the old builders removed | 2, 7, 8 |
| `tools/dcim-verify/` (new) | `verify.py` and `fixture/` (moved in), `acceptance.rack.json`, `export_kits.py`, `kits.py`, `selftest.py`, `README.md` | 9, 10 |
| `.gitignore` | What the verification kit writes | 9 |
| `rack.html` | The dev note | 11 |
| `check-browser.py` | Every new and changed check | 2, 5, 7, 8, 9, 11 |
| `docs/superpowers/specs/2026-09-26-rack-builder-design.md` | The status line; §8's DCIM rows; §9.4's last item | 11 |

**Names used across tasks** (each is defined by the task shown, and used unchanged after it):

| Name | Where | Task |
|---|---|---|
| `SECTIONS`, `typeLists(text)`, `bayAt(lists, position)`, `resolveEnd({path, device, moduleAt, consoles})` | dcim-rules.js | 1 |
| `deviceImportRows({rack, items, types, target, dcim})` → `{columns, rows, left}`; `NETBOX_RACK_COLUMNS`, `rackImportRows({rack, dcim})` | export-data.js | 2 |
| `device_rows(page, target="nautobot")` | check-browser.py | 2, rewritten in 8 |
| `MODULE_COLUMNS`, `moduleImportRows({target, parts, names, kept, deviceOf, moduleOf})` | dcim-rules.js | 3 |
| `CABLE_TYPE`, `cableType(media)`, `canMeet(a, b)`, `importLength(cable, target)`, `CABLE_IMPORT_COLUMNS`, `cableImportRows({rack, target, names, kept, resolve, ends, unchecked, uOf})` | dcim-rules.js | 3 |
| `KIT_FILES`, `KIT_SCRIPT`, `kitReadme({target, rack, date, dcim, typeFiles, manufacturers, rows, left, notes, script})` → `{text, notes}` | dcim-rules.js | 4 |
| `dcimOf(rack)`, `withDcim(rack, patch)` | model.js | 5 |
| `dcimForm({rack, onChange, onDone})` | dcim-form.js | 5 |
| `[data-export="dcim-settings"]`, `#dcimForm`, `#dSite`, `#dRole`, `#dStatus`, `#dDone` | the page | 5 |
| `site/rack/nautobot/import_cables.py`: `main(argv, env, out)`, `Api`, `Stop` | the script | 6 |
| `dcimKit(rack, chassisOf, target, {date})` → `{name, data, type, notes, files}`; `failExport({type})`, `failExport({script})` | exports.js | 7 |
| `KIT_JS`, `built_kit(page, target, patch, fail)`, `kit_rows(kit, name)`, `readme_lists(text)`, `KIT_TYPES` | check-browser.py | 7 |
| `[data-export="netbox-import"]`, `[data-export="nautobot-import"]`; `export_kit(page, target)`, `DEVICES_FILE` | the page; check-browser.py | 8 |
| `tools/dcim-verify/acceptance.rack.json`, `export_kits.py` | the verification kit | 9 |
| `tools/dcim-verify/kits.py` (`plan`, `run`), `selftest.py` | the verification kit | 10 |

---

### Task 1: What a port is called: a type file's own name lists, a bay by its position, and one rule for a cable end

Ruling 4: a port's name comes from the type files, never from convention alone. A fixed port is its drawing path looked up in the matched device type's own name lists, and the list it is in gives the end's kind (`dcim.interface`, `dcim.frontport`, `dcim.rearport`, `dcim.consoleport`, …). A card port `<bay>/module/<leaf>` is the module bay whose **position** is `<bay>`, then `{module}/<leaf>` in the seated module type's lists, giving `<position>/<leaf>`. This task writes that rule as pure functions, and tests it against the vendored YAML read as text. No export changes yet.

**Files:**
- Create: `site/rack/dcim-rules.js`
- Create: `tests/rack/dcim-import.test.mjs`

**Interfaces:**
- Consumes: nothing from the repository's code. The tests read `assets/exports/` with `node:fs`.
- Produces, all exported from `site/rack/dcim-rules.js`:
  - `SECTIONS` → `[[section, type], …]`: the seven sections that hold cable ends, in lookup order, each with the DCIM type of an end found there.
  - `typeLists(text)` → `{manufacturer, model, sections: {<section>: string[]}, bays: [{name, position}]}`. `text` is a device-type or module-type YAML. Never throws: text that is not a type file gives empty lists.
  - `bayAt(lists, position)` → `{name, position}` or `null`.
  - `resolveEnd({path, device, moduleAt = () => null, consoles = []})` → `{ok: true, name, type}` (plus `bay` for a card port) or `{ok: false, reason}`. `device` is the item's device type as `typeLists` gives it, or `null`. `moduleAt(bayId)` gives the `typeLists` of the module type seated in that bay, or `null`. `consoles` is the paths of the console ports the device's drawing has. `reason` is a phrase with no period.

- [ ] **Step 1: Write the failing tests**

Create `tests/rack/dcim-import.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as D from '../../site/rack/dcim-rules.js';

// The vendored type files, read as text - what the page fetches.
const EXPORTS = new URL('../../assets/exports/', import.meta.url);
const yaml = path => fs.readFileSync(new URL(path, EXPORTS), 'utf8');
const lists = path => D.typeLists(yaml(path));
const ASR = 'netbox/device-types/Cisco/ASR-9006-AC-V2.yaml', LEAF = 'netbox/device-types/Edgecore/7726-32X-O-AC-F.yaml',
  TM = 'netbox/device-types/Telco Systems/TM-280.yaml', CARD = 'netbox/module-types/Cisco/A9K-16X100GE-TR.yaml';

test('a type file gives its own name lists, by section, and its bays by name and position', () => {
  const tm = lists(TM);
  assert.equal(tm.manufacturer, 'Telco Systems');
  assert.equal(tm.model, 'TM-280');
  assert.deepEqual(tm.sections.interfaces, ['port-1-1', 'port-2-1', 'port-3-1', 'copper-3-1', 'port-2-2']);
  assert.deepEqual(tm.sections['console-ports'], ['Console']);
  assert.deepEqual(tm.sections['power-ports'], ['dc-in']);
  assert.deepEqual(tm.bays, []);
  const asr = lists(ASR);
  assert.deepEqual(asr.sections.interfaces, []);
  assert.deepEqual(asr.bays.find(b => b.position === 'slot-2'), {name: 'slot-2', position: 'slot-2'});
  assert.equal(asr.bays.length, 11);
  // A quoted name is read without its quotes; a name is not a path until a bay's position replaces {module}.
  assert.deepEqual(lists(CARD).sections.interfaces.slice(0, 2), ['{module}/p0', '{module}/p1']);
  // A bay's name is for display; its position is the drawing's bay id.
  assert.deepEqual(lists(LEAF).bays[0], {name: 'Fan 1', position: 'fan-1'});
  assert.deepEqual(D.bayAt(lists('netbox/device-types/Casa Systems/C40G-CHASSIS-AC.yaml'), 'front-0'),
    {name: 'Front 0', position: 'front-0'});
  assert.equal(D.bayAt(lists(LEAF), 'Fan 1'), null);
  // Not a type file at all: empty lists, never a throw.
  assert.deepEqual(D.typeLists('').sections.interfaces, []);
  assert.deepEqual(D.typeLists(undefined).bays, []);
});

test('the NetBox and Nautobot copies of the fixture types name the same things', () => {
  for (const p of [ASR, LEAF, TM, CARD]) {
    const nb = lists(p), nt = lists(p.replace(/^netbox\//, 'nautobot/'));
    assert.deepEqual(nt.sections, nb.sections, p);
    assert.deepEqual(nt.bays, nb.bays, p);
  }
});

test("the fixture's cable ends resolve to the names the real instances made", () => {
  const leaf = lists(LEAF), asr = lists(ASR), tm = lists(TM), card = lists(CARD);
  for (const path of ['port-1', 'port-2', 'mgmt-eth'])
    assert.deepEqual(D.resolveEnd({path, device: leaf}), {ok: true, name: path, type: 'dcim.interface'});
  assert.deepEqual(D.resolveEnd({path: 'port-2-1', device: tm}), {ok: true, name: 'port-2-1', type: 'dcim.interface'});
  // result.json, inventory_after_modules: the card in slot-2 gave core-1 the interfaces slot-2/p0 to slot-2/p15.
  assert.deepEqual(D.resolveEnd({path: 'slot-2/module/p0', device: asr, moduleAt: bay => (bay === 'slot-2' ? card : null)}),
    {ok: true, name: 'slot-2/p0', type: 'dcim.interface', bay: {name: 'slot-2', position: 'slot-2'}});
  assert.deepEqual(D.resolveEnd({path: 'dc-in', device: tm}), {ok: true, name: 'dc-in', type: 'dcim.powerport'});
});

test('a console port is found by its own list, never by its path alone', () => {
  const tm = lists(TM);
  // The drawing calls it "con"; the type file calls its only console port "Console".
  assert.deepEqual(D.resolveEnd({path: 'con', device: tm, consoles: ['con']}),
    {ok: true, name: 'Console', type: 'dcim.consoleport'});
  // Two drawn, one listed: which one is it? Not said.
  assert.deepEqual(D.resolveEnd({path: 'con', device: tm, consoles: ['con', 'con-usb']}),
    {ok: false, reason: 'the device type TM-280 does not say which of its console ports con is'});
  // Not drawn as a console at all: it is just a path the file does not list.
  assert.deepEqual(D.resolveEnd({path: 'con', device: tm}),
    {ok: false, reason: 'the device type TM-280 lists no port named con'});
  // "Console (<path>)" names it exactly.
  const two = D.typeLists('model: X\nconsole-ports:\n  - name: Console (usb)\n  - name: Console (rj45)\n');
  assert.deepEqual(D.resolveEnd({path: 'usb', device: two, consoles: ['usb', 'rj45']}),
    {ok: true, name: 'Console (usb)', type: 'dcim.consoleport'});
});

test('an end that does not resolve says why, and gets no name', () => {
  const asr = lists(ASR), card = lists(CARD), leaf = lists(LEAF);
  const why = arg => { const r = D.resolveEnd(arg); assert.equal(r.ok, false); assert.equal('name' in r, false); return r.reason; };
  assert.equal(why({path: 'port-1', device: null}), 'its device has no device type');
  assert.equal(why({path: 'port-99', device: leaf}), 'the device type 7726-32X-O-AC-F lists no port named port-99');
  assert.equal(why({path: 'slot-9/module/p0', device: asr, moduleAt: () => card}),
    'the device type ASR-9006-AC-V2 has no module bay at position slot-9');
  assert.equal(why({path: 'slot-2/module/p0', device: asr}), 'what is seated in slot-2 has no module type');
  assert.equal(why({path: 'slot-2/module/p99', device: asr, moduleAt: () => card}),
    'the module type A9K-16X100GE-TR lists no port named {module}/p99');
  assert.equal(why({path: 'slot-2/module/mic-0/module/p0', device: asr, moduleAt: () => card}),
    'it is a port of a module inside a card, and the card has no module bay to import that module into');
  // The Edgecore AS7326-56X draws port-57 where its type file lists "57": no convention bridges that.
  assert.equal(why({path: 'port-57', device: lists('netbox/device-types/Edgecore/7326-56X-O-48V-B.yaml')}),
    'the device type 7326-56X-O-48V-B lists no port named port-57');
});

test('the list a name is in gives the end its type: a cassette has front and rear ports, not interfaces', () => {
  const cassette = lists('netbox/module-types/FS.com/FHD-1MTP6LCDOS2A.yaml');
  const dev = D.typeLists('model: Panel\nmodule-bays:\n  - name: Bay 1\n    position: bay-1\n');
  assert.deepEqual(D.resolveEnd({path: 'bay-1/module/1', device: dev, moduleAt: () => cassette}),
    {ok: true, name: 'bay-1/1', type: 'dcim.frontport', bay: {name: 'Bay 1', position: 'bay-1'}});
  assert.deepEqual(D.resolveEnd({path: 'bay-1/module/MTP-1', device: dev, moduleAt: () => cassette}),
    {ok: true, name: 'bay-1/MTP-1', type: 'dcim.rearport', bay: {name: 'Bay 1', position: 'bay-1'}});
  // The drawing's own name for that adapter is lc1, which the file does not list.
  assert.equal(D.resolveEnd({path: 'bay-1/module/lc1', device: dev, moduleAt: () => cassette}).reason,
    'the module type FHD-1MTP6LCDOS2A lists no port named {module}/lc1');
});

test('every vendored type file is read whole: each "- name:" line is a name, a module port carries {module}/ once', () => {
  const files = JSON.parse(yaml('files.json'));
  let n = 0;
  for (const target of ['netbox', 'nautobot']) for (const path of files[target]) {
    const text = yaml(path), l = D.typeLists(text);
    const named = Object.values(l.sections).reduce((s, v) => s + v.length, 0) + l.bays.length;
    assert.equal(named, text.split('\n').filter(x => x.startsWith('  - name:')).length, path);
    assert.ok(l.model, path);
    assert.equal(new Set(l.bays.map(b => b.position)).size, l.bays.length, `${path}: two bays share a position`);
    if (path.includes('/module-types/'))
      for (const name of Object.values(l.sections).flat())
        assert.ok(name.startsWith('{module}/') && name.indexOf('{module}', 1) < 0, `${path}: ${name}`);
    n++;
  }
  assert.ok(n > 2000, `${n} files`);
});
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `node --test tests/rack/dcim-import.test.mjs`
Expected: the file fails to load: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '…/site/rack/dcim-rules.js'`, and the summary reads `# pass 0`.

- [ ] **Step 3: Write the rules**

Create `site/rack/dcim-rules.js`:

```js
// WHAT A DCIM IMPORT KIT SAYS, as data (spec §8, §9.4; Phase 2c). Pure: no DOM,
// no fetch, so `node --test` covers every rule the NetBox and Nautobot kits
// follow: what a port is called in a type file, which rows a file may hold,
// and what the README says of the rest. site/rack/exports.js fetches the type
// files and the faces, and asks here.

// ── a type file's own names ─────────────────────────────────────────────
// The sections of a device-type or module-type YAML that hold cable ends, in
// the order a name is looked up, with the type a DCIM gives an end found there.
export const SECTIONS = [
  ['interfaces', 'dcim.interface'], ['front-ports', 'dcim.frontport'], ['rear-ports', 'dcim.rearport'],
  ['console-ports', 'dcim.consoleport'], ['console-server-ports', 'dcim.consoleserverport'],
  ['power-ports', 'dcim.powerport'], ['power-outlets', 'dcim.poweroutlet']];

const unquote = v => (/^'.*'$/.test(v) ? v.slice(1, -1).replace(/''/g, "'") : /^".*"$/.test(v) ? JSON.parse(v) : v);

// THE NAME LISTS OF ONE TYPE FILE, read as text: the exporter writes every
// component as "  - name: X" under a top-level "section:" line, with its other
// fields indented beneath, so no YAML library is needed (the site has none).
// `sections` holds each known section's names in file order; `bays` each
// module bay's name and position; `model` and `manufacturer` the identity
// lines, as the file writes them.
export function typeLists(text) {
  const sections = Object.fromEntries(SECTIONS.map(([s]) => [s, []]));
  const bays = [], head = {};
  let section = null, bay = null;
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const top = line.match(/^([A-Za-z_][\w-]*):\s*(.*?)\s*$/);
    if (top) {
      section = top[2] === '' ? top[1] : null;
      bay = null;
      if ((top[1] === 'manufacturer' || top[1] === 'model') && !(top[1] in head)) head[top[1]] = unquote(top[2]);
      continue;
    }
    if (!section) continue;
    const item = line.match(/^  - name:\s*(.*?)\s*$/);
    if (item) {
      const name = unquote(item[1]);
      bay = null;
      if (section === 'module-bays') { bay = {name, position: ''}; bays.push(bay); }
      else if (Object.hasOwn(sections, section)) sections[section].push(name);
      continue;
    }
    const pos = bay && line.match(/^    position:\s*(.*?)\s*$/);
    if (pos) bay.position = unquote(pos[1]);
  }
  return {manufacturer: head.manufacturer ?? null, model: head.model ?? null, sections, bays};
}

// A name's section and end type in one type file, first section first.
function findName(lists, name) {
  for (const [section, type] of SECTIONS) if (lists.sections[section].includes(name)) return {section, type};
  return null;
}
// The module bay a drawing's bay id is: the one whose POSITION is that id. A
// bay's name is for display ("Fan 1", "Front 0"); its position is what a
// DCIM puts in place of {module}.
export const bayAt = (lists, position) => lists?.bays.find(b => b.position === position) ?? null;

const MODULE = '/module/';
// WHAT A CABLE END IS CALLED IN THE DCIM, and which kind of component it is.
// Never built by convention alone: the name must be in the matched type
// file's own lists, and the list it is in gives the type.
//   path      the end's port path on the drawing ("port-1", "slot-2/module/p0")
//   device    typeLists of the item's device type, or null when it has none
//   moduleAt  bay id -> typeLists of the module type seated there, or null
//   consoles  the paths of the console ports the device's drawing has
// Returns {ok: true, name, type}, or {ok: false, reason}: a phrase with no
// period, for "Cable X is not in this file: end A, <end>, <reason>."
export function resolveEnd({path, device, moduleAt = () => null, consoles = []}) {
  if (!device) return {ok: false, reason: 'its device has no device type'};
  const p = String(path), at = p.indexOf(MODULE);
  if (at < 0) {
    const hit = findName(device, p);
    if (hit) return {ok: true, name: p, type: hit.type};
    if (consoles.includes(p)) {
      const listed = device.sections['console-ports'];
      if (listed.includes(`Console (${p})`)) return {ok: true, name: `Console (${p})`, type: 'dcim.consoleport'};
      if (listed.length === 1 && consoles.length === 1) return {ok: true, name: listed[0], type: 'dcim.consoleport'};
      return {ok: false, reason: `the device type ${device.model} does not say which of its console ports ${p} is`};
    }
    return {ok: false, reason: `the device type ${device.model} lists no port named ${p}`};
  }
  const bayId = p.slice(0, at), leaf = p.slice(at + MODULE.length);
  if (leaf.includes(MODULE))
    return {ok: false, reason: 'it is a port of a module inside a card, and the card has no module bay to import that module into'};
  const bay = bayAt(device, bayId);
  if (!bay) return {ok: false, reason: `the device type ${device.model} has no module bay at position ${bayId}`};
  const module = moduleAt(bayId);
  if (!module) return {ok: false, reason: `what is seated in ${bayId} has no module type`};
  const hit = findName(module, `{module}/${leaf}`);
  if (!hit) return {ok: false, reason: `the module type ${module.model} lists no port named {module}/${leaf}`};
  return {ok: true, name: `${bay.position}/${leaf}`, type: hit.type, bay};
}
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `node --test tests/rack/*.test.mjs`
Expected: `# tests 167`, `# pass 167`, `# fail 0`. The last new test reads all 2,474 vendored type files and takes about a tenth of a second.

- [ ] **Step 5: Commit**

```bash
git add site/rack/dcim-rules.js tests/rack/dcim-import.test.mjs
git commit -m "rack: what a port is called in a DCIM - read from the type file's own name lists

A fixed port is its drawing path looked up in the device type's sections, and
the section gives the end its kind. A card port is the bay whose position is
the drawing's bay id, then the module type's {module}/leaf: position/leaf, the
name a real NetBox and Nautobot gave it. A console port is found in its own
list. An end that does not resolve gets a reason and no name. Tested against
every vendored type file.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The devices file's rows: the import settings, the rows a target would refuse, and the rack row

Three rulings meet in the devices rows.
- Ruling 2: NetBox needs `site` and `role` on every device, Nautobot `location` and `role`. The rows take them from a `dcim` argument (`{site, role}`; Task 5 stores it in the rack). Blank ones stay blank.
- Ruling 3: a row NetBox would refuse is not written, because one refused row refuses the whole file. That is the later-placed of two devices sharing a U front and rear while either type is full depth. The rack's own order is the order devices were placed. **Nautobot keeps both**: it accepted that pair.
- The same reasoning covers a device with no device type, on both targets: the type is a required column, so the row would refuse the file. It is left out and said.
- Ruling 2 again: the rack row, `1-rack.csv`, is written from the frame.

`deviceImportRows` gains a third result, `left`, with a sentence per device left out. Until Task 8 the page still exports the devices CSV on its own, so in this task that sentence goes to the status line (`left`), and four browser checks that read the NetBox devices file to learn every device's name or position read the Nautobot one instead, through a new helper.

**Files:**
- Modify: `site/rack/export-data.js`, `site/rack/exports.js`, `tests/rack/dcim.test.mjs`, `check-browser.py`

**Interfaces:**
- Consumes (all exist in `export-data.js`): `uniqueNames(items)`, `positionOf(frame, ru, u)`, `mountText(mount)`, `otherVendorNote(...)`, `TARGET_NAME`, `NETBOX_COLUMNS`, `NAUTOBOT_COLUMNS`, the module's own `overlaps(a, b)`.
- Produces, exported from `site/rack/export-data.js`:
  - `deviceImportRows({rack, items, types, target = 'netbox', dcim = {}})` → `{columns, rows, left}`. `left` is `[{id, name, reason}]`, `reason` a whole sentence. A row no longer carries the "Shares its U with …" comment or the "No … device type" comment: such a device is either kept without comment (Nautobot's pair) or left out.
  - `NETBOX_RACK_COLUMNS` → `['site', 'name', 'status', 'width', 'u_height', 'desc_units']`.
  - `rackImportRows({rack, dcim = {}})` → `{columns, rows}` with one row.
- Produces, in `check-browser.py`: `device_rows(page, target="nautobot")` → the device import's rows for a target, as the page exports them. Task 8 rewrites its body; its callers do not change again.

- [ ] **Step 1: Write the failing node tests**

In `tests/rack/dcim.test.mjs`, replace

```js
test('a device with no type and no configuration name leaves the parenthesis out', () => {
  const item = {id: 'i1', ref: 'mystery', cfg: '', label: 'm', ru: 2, u: 1, face: 'front', turned: false};
  const {rows} = X.deviceImportRows({rack: RACK, items: [item], types: new Map([['i1', null]])});
  assert.equal(rows[0].comments, 'No NetBox device type for mystery; add one before importing.');
  const {rows: none} = X.deviceImportRows({rack: RACK, items: [{...item, cfg: undefined}], types: new Map()});
  assert.equal(none[0].comments, 'No NetBox device type for mystery; add one before importing.');
```

with

```js
test('a device with no type is left out of the file, and said; no configuration name leaves the parenthesis out', () => {
  const item = {id: 'i1', ref: 'mystery', cfg: '', label: 'm', ru: 2, u: 1, face: 'front', turned: false};
  const why = 'm is not in the devices file: there is no NetBox device type for mystery. Add the type and the device by hand.';
  const got = X.deviceImportRows({rack: RACK, items: [item], types: new Map([['i1', null]])});
  assert.deepEqual(got.rows, []);
  assert.deepEqual(got.left, [{id: 'i1', name: 'm', reason: why}]);
  const none = X.deviceImportRows({rack: RACK, items: [{...item, cfg: undefined}], types: new Map()});
  assert.deepEqual([none.rows, none.left[0].reason], [[], why]);
  assert.match(X.deviceImportRows({rack: RACK, items: [{...item, cfg: 'dc'}], types: new Map(), target: 'nautobot'}).left[0].reason,
    /there is no Nautobot device type for mystery \(dc\)\./);
```

In `tests/rack/dcim.test.mjs`, replace

```js
  const {columns, rows} = X.deviceImportRows({rack: RACK, items: ITEMS, types: TYPES, target: 'netbox'});
  assert.deepEqual(columns, ['name', 'role', 'manufacturer', 'device_type', 'status', 'site', 'rack',
                             'position', 'face', 'comments']);
  assert.deepEqual(rows.map(r => [r.name, r.position, r.face, r.manufacturer, r.device_type]), [
    ['demarc-i4', 20, 'rear', 'Telco Systems', 'TM-280'], ['leaf-1', 14, 'front', 'Edgecore', '7726-32X-O-AC-F'],
    ['demarc-i3', 14, 'rear', 'Telco Systems', 'TM-280'], ['core-1', 2, 'front', 'Cisco', 'ASR-9006-AC-V2']]);
  assert.ok(rows.every(r => r.status === 'planned' && r.role === '' && r.site === '' && r.rack === 'Export test'));
  assert.equal(rows[0].comments, 'Named demarc-i4 because another device here is also demarc.');
  assert.equal(rows[1].comments, 'Device type 7726-32X-O-AC-F is a best guess for configuration ac-f2b. ' +
    'Shares its U with demarc-i3 on the rear; NetBox refuses this while either type is full depth.');
  assert.equal(rows[3].comments, 'Device type ASR-9006-AC-V2 is a best guess for configuration base.');
```

with

```js
  const {columns, rows, left} = X.deviceImportRows({rack: RACK, items: ITEMS, types: TYPES, target: 'netbox'});
  assert.deepEqual(columns, ['name', 'role', 'manufacturer', 'device_type', 'status', 'site', 'rack',
                             'position', 'face', 'comments']);
  // demarc-i3 shares U14 with leaf-1, which was placed first: NetBox would refuse it, and the file with it.
  assert.deepEqual(rows.map(r => [r.name, r.position, r.face, r.manufacturer, r.device_type]), [
    ['demarc-i4', 20, 'rear', 'Telco Systems', 'TM-280'], ['leaf-1', 14, 'front', 'Edgecore', '7726-32X-O-AC-F'],
    ['core-1', 2, 'front', 'Cisco', 'ASR-9006-AC-V2']]);
  assert.ok(rows.every(r => r.status === 'planned' && r.role === '' && r.site === '' && r.rack === 'Export test'));
  assert.equal(rows[0].comments, 'Named demarc-i4 because another device here is also demarc.');
  assert.equal(rows[1].comments, 'Device type 7726-32X-O-AC-F is a best guess for configuration ac-f2b.');
  assert.equal(rows[2].comments, 'Device type ASR-9006-AC-V2 is a best guess for configuration base.');
  assert.deepEqual(left, [{id: 'i3', name: 'demarc-i3', reason:
    'demarc-i3 is not in the devices file: it shares U14 with leaf-1 on the front, and NetBox refuses two devices in one U, ' +
    'front and rear, while either type is full depth. One refused row refuses the whole file. Import demarc-i3 by hand ' +
    "after changing the type's depth, or place it elsewhere."}]);
});

test('the import settings fill role and site, or role and location; blank ones stay blank', () => {
  const dcim = {site: ' Lab 1 ', role: 'Router'};
  const nb = X.deviceImportRows({rack: RACK, items: ITEMS, types: TYPES, target: 'netbox', dcim}).rows;
  assert.ok(nb.every(r => r.site === 'Lab 1' && r.role === 'Router'));
  const nt = X.deviceImportRows({rack: RACK, items: ITEMS, types: TYPES, target: 'nautobot', dcim}).rows;
  assert.ok(nt.every(r => r.location__name === 'Lab 1' && r.role__name === 'Router'));
  const blank = X.deviceImportRows({rack: RACK, items: ITEMS, types: TYPES, target: 'netbox', dcim: {site: null}}).rows;
  assert.ok(blank.every(r => r.site === '' && r.role === ''));
});

test('the rack row is written from the frame: 19 inch, its height, planned, and whether U1 is at the top', () => {
  assert.deepEqual(X.rackImportRows({rack: RACK, dcim: {site: 'Lab 1', role: 'Router'}}), {
    columns: ['site', 'name', 'status', 'width', 'u_height', 'desc_units'],
    rows: [{site: 'Lab 1', name: 'Export test', status: 'planned', width: 19, u_height: 24, desc_units: 'false'}]});
  const down = {...RACK, frame: {...RACK.frame, numbering: 'top-down'}};
  assert.deepEqual(X.rackImportRows({rack: down}).rows[0], {site: '', name: 'Export test', status: 'planned', width: 19,
    u_height: 24, desc_units: 'true'});
  assert.equal(X.toCsv(...Object.values(X.rackImportRows({rack: down, dcim: {site: 'A, B'}}))),
    'site,name,status,width,u_height,desc_units\r\n"A, B",Export test,planned,19,24,true\r\n');
```

In `tests/rack/dcim.test.mjs`, replace

```js
  assert.deepEqual(X.deviceImportRows({rack, items: ITEMS, types: TYPES}).rows.map(r => r.position), [5, 11, 11, 14]);
});

test('Nautobot rows use natural-key columns; a device with no type says so', () => {
  const types = new Map([...TYPES, ['i1', null]]);
  const {columns, rows} = X.deviceImportRows({rack: RACK, items: ITEMS, types, target: 'nautobot'});
  assert.deepEqual(columns, ['name', 'role__name', 'device_type__manufacturer__name', 'device_type__model',
    'status__name', 'location__name', 'rack__name', 'position', 'face', 'comments']);
  assert.deepEqual([rows[1].device_type__manufacturer__name, rows[1].device_type__model, rows[1].status__name,
                    rows[1].rack__name], ['Edgecore', '7726-32X-O-AC-F', 'Planned', 'Export test']);
  assert.equal(rows[3].device_type__model, '');
  assert.equal(rows[3].comments, 'No Nautobot device type for asr-9006 (base); add one before importing.');
```

with

```js
  assert.deepEqual(X.deviceImportRows({rack, items: ITEMS, types: TYPES}).rows.map(r => r.position), [5, 11, 14]);
  assert.deepEqual(X.deviceImportRows({rack, items: ITEMS, types: TYPES, target: 'nautobot'}).rows.map(r => r.position), [5, 11, 11, 14]);
  assert.match(X.deviceImportRows({rack, items: ITEMS, types: TYPES}).left[0].reason, /^demarc-i3 is not in the devices file: it shares U11 with leaf-1/);
});

test('Nautobot rows use natural-key columns, keep two devices that share a U, and leave out a device with no type', () => {
  const types = new Map([...TYPES, ['i1', null]]);
  const {columns, rows, left} = X.deviceImportRows({rack: RACK, items: ITEMS, types, target: 'nautobot'});
  assert.deepEqual(columns, ['name', 'role__name', 'device_type__manufacturer__name', 'device_type__model',
    'status__name', 'location__name', 'rack__name', 'position', 'face', 'comments']);
  assert.deepEqual([rows[1].device_type__manufacturer__name, rows[1].device_type__model, rows[1].status__name,
                    rows[1].rack__name], ['Edgecore', '7726-32X-O-AC-F', 'Planned', 'Export test']);
  // Nautobot 3.2.6 accepted leaf-1 and demarc-i3 at U14, front and rear: both rows stay, and neither is called refused.
  assert.deepEqual(rows.map(r => r.name), ['demarc-i4', 'leaf-1', 'demarc-i3']);
  assert.ok(rows.every(r => !/refuses/.test(r.comments)));
  assert.deepEqual(left, [{id: 'i1', name: 'core-1', reason:
    'core-1 is not in the devices file: there is no Nautobot device type for asr-9006 (base). Add the type and the device by hand.'}]);
```

In `tests/rack/dcim.test.mjs`, replace

```js
test('the shared-U note names every device it shares with', () => {
  const full = {manufacturer: 'M', model: 'X', isFullDepth: true, guess: false};
  const items = [
    {id: 'a', ref: 'r', cfg: 'base', label: 'tall', ru: 10, u: 6, face: 'front', turned: false},
    {id: 'b', ref: 'r', cfg: 'base', label: 'one', ru: 11, u: 1, face: 'rear', turned: false},
    {id: 'c', ref: 'r', cfg: 'base', label: 'two', ru: 13, u: 1, face: 'rear', turned: false},
    {id: 'd', ref: 'r', cfg: 'base', label: 'three', ru: 15, u: 1, face: 'rear', turned: false}];
  const types = new Map(items.map(i => [i.id, full]));
  const {rows} = X.deviceImportRows({rack: RACK, items, types, target: 'netbox'});
  assert.equal(rows.find(r => r.name === 'tall').comments,
    'Shares its U with one, two and three on the rear; NetBox refuses this while either type is full depth.');
  assert.equal(rows.find(r => r.name === 'one').comments,
    'Shares its U with tall on the front; NetBox refuses this while either type is full depth.');
```

with

```js
test('NetBox: of two devices sharing a U front and rear, the later-placed is left out while either type is full depth', () => {
  const full = {manufacturer: 'M', model: 'X', isFullDepth: true, guess: false}, half = {...full, isFullDepth: false};
  const items = [
    {id: 'a', ref: 'r', cfg: 'base', label: 'tall', ru: 10, u: 6, face: 'front', turned: false},
    {id: 'b', ref: 'r', cfg: 'base', label: 'one', ru: 11, u: 1, face: 'rear', turned: false},
    {id: 'c', ref: 'r', cfg: 'base', label: 'two', ru: 13, u: 1, face: 'rear', turned: false},
    {id: 'd', ref: 'r', cfg: 'base', label: 'three', ru: 20, u: 1, face: 'rear', turned: false}];
  const all = new Map(items.map(i => [i.id, full]));
  const got = X.deviceImportRows({rack: RACK, items, types: all, target: 'netbox'});
  assert.deepEqual(got.rows.map(r => r.name), ['three', 'tall']);
  assert.deepEqual(got.left.map(l => l.id), ['b', 'c']);
  assert.match(got.left[0].reason, /^one is not in the devices file: it shares U11 with tall on the front, and NetBox refuses/);
  // The rack's own order is the order they were placed: placed first, kept.
  const rearFirst = X.deviceImportRows({rack: RACK, items: [items[1], items[0]], types: all, target: 'netbox'});
  assert.deepEqual([rearFirst.rows.map(r => r.name), rearFirst.left.map(l => l.name)], [['one'], ['tall']]);
  assert.match(rearFirst.left[0].reason, /it shares U10 with one on the rear/);
  // A device left out takes no room: the next one is judged against what is in the file.
  const chain = [items[1], items[0], {...items[2], ru: 12}];
  assert.deepEqual(X.deviceImportRows({rack: RACK, items: chain, types: all, target: 'netbox'}).left.map(l => l.name), ['tall']);
  // Neither type full depth: NetBox takes both. Either one: it does not.
  assert.deepEqual(X.deviceImportRows({rack: RACK, items, types: new Map(items.map(i => [i.id, half])), target: 'netbox'}).left, []);
  assert.deepEqual(X.deviceImportRows({rack: RACK, items, types: new Map([...all, ['a', half]]), target: 'netbox'}).left.map(l => l.id), ['b', 'c']);
  // The same face is the page's own rule (fit.js), not this one; Nautobot keeps every pair.
  assert.deepEqual(X.deviceImportRows({rack: RACK, items, types: all, target: 'nautobot'}).left, []);
```

In `tests/rack/dcim.test.mjs`, replace

```js
  const {rows} = X.deviceImportRows({rack, items, types: new Map(), target: 'netbox'});
```

with

```js
  const types = new Map([['a', {manufacturer: 'M', model: 'X', isFullDepth: false, guess: false}]]);
  const {rows} = X.deviceImportRows({rack, items, types, target: 'netbox'});
```

- [ ] **Step 2: Run the node tests and see them fail**

Run: `node --test tests/rack/dcim.test.mjs`
Expected: `# pass 29`, `# fail 7`. The seven: "a device with no type is left out of the file, and said…", "NetBox rows: top down…", "the import settings fill role and site…", "the rack row is written from the frame…", "positions follow a top-down frame", "Nautobot rows use natural-key columns, keep two devices that share a U…", "NetBox: of two devices sharing a U front and rear…".

- [ ] **Step 3: Change the browser checks**

In `check-browser.py`, replace

```python

@extra("rack.html: Export - device import CSVs name each device's type, position and face as NetBox and Nautobot read them")
```

with

```python

def device_rows(page, target="nautobot"):
    """The device import's rows for one target, as exported from the page. Nautobot's
    file is the default because it holds every device with a type: NetBox's leaves
    out a device NetBox would refuse (two full-depth devices sharing a U)."""
    return read_csv(export_file(page, f"{target}-devices"))[1]


@extra("rack.html: Export - device import CSVs name each device's type, position and face as NetBox and Nautobot read them")
```

In `check-browser.py`, replace

```python
            "demarc-i3": ("Telco Systems", "TM-280", "14", "rear"), "demarc-i4": ("Telco Systems", "TM-280", "20", "rear")}
    for name, (man, dt, pos, face) in want.items():
        r = by.get(name)
        if not r or (r["manufacturer"], r["device_type"], r["position"], r["face"]) != (man, dt, pos, face):
            bad.append(f"NetBox CSV: {name} is {r and (r['manufacturer'], r['device_type'], r['position'], r['face'])}")
```

with

```python
            "demarc-i4": ("Telco Systems", "TM-280", "20", "rear")}
    for name, (man, dt, pos, face) in want.items():
        r = by.get(name)
        if not r or (r["manufacturer"], r["device_type"], r["position"], r["face"]) != (man, dt, pos, face):
            bad.append(f"NetBox CSV: {name} is {r and (r['manufacturer'], r['device_type'], r['position'], r['face'])}")
    # demarc-i3 shares U14 with leaf-1 and both types are full depth: NetBox would refuse the whole file for it.
    status = export_status(page)
    if set(by) != set(want) or "demarc-i3 is not in the devices file: it shares U14 with leaf-1 on the front" not in status:
        bad.append(f"NetBox CSV: rows {sorted(by)}; the status reads {status!r}")
```

In `check-browser.py`, replace

```python
        bad.append(f"Nautobot CSV: leaf-1 is {leaf}")
```

with

```python
        bad.append(f"Nautobot CSV: leaf-1 is {leaf}")
    # Nautobot accepts the pair at U14, so its file keeps both, and calls neither refused.
    if sorted(r["name"] for r in rows) != ["core-1", "demarc-i3", "demarc-i4", "leaf-1"] or any("refuses" in r["comments"] for r in rows):
        bad.append(f"Nautobot CSV: rows {[(r['name'], r['comments']) for r in rows]}")
```

In `check-browser.py`, replace

```python
    if got != {"core-1": "14", "leaf-1": "11", "demarc-i3": "11", "demarc-i4": "5"}:
        bad.append(f"NetBox CSV: top-down positions {got}")
```

with

```python
    if got != {"core-1": "14", "leaf-1": "11", "demarc-i4": "5"}:
        bad.append(f"NetBox CSV: top-down positions {got}")
    got = {r["name"]: r["position"] for r in device_rows(page, "nautobot")}
    if got != {"core-1": "14", "leaf-1": "11", "demarc-i3": "11", "demarc-i4": "5"}:
        bad.append(f"Nautobot CSV: top-down positions {got}")
```

In `check-browser.py`, replace

```python
    # The device CSV carries its rows' comments and nothing else.
    _, rows, _ = read_csv(export_file(page, "netbox-devices"))
    status = page.inner_text("#exportStatus")
```

with

```python
    # The device CSV carries its rows' comments and nothing else.
    rows = device_rows(page)
    status = page.inner_text("#exportStatus")
```

In `check-browser.py`, replace

```python
    _, drows, _ = read_csv(export_file(page, "netbox-devices"))
    names = {r["name"] for r in drows}
```

with

```python
    names = {r["name"] for r in device_rows(page)}
```

In `check-browser.py`, replace

```python
          return {sched: (await X.cableScheduleCsv(rack, of)).data, dev: (await X.deviceImportCsv(rack, of, 'netbox')).data};
```

with

```python
          return {sched: (await X.cableScheduleCsv(rack, of)).data, dev: (await X.deviceImportCsv(rack, of, 'nautobot')).data};
```

In `check-browser.py`, replace

```python
    # The device import's position is the reference: NetBox's own word for it.
    _, drows, _ = read_csv(export_file(page, "netbox-devices"))
    pos = {r["name"]: r["position"] for r in drows}
```

with

```python
    # The device import's position is the reference: a DCIM's own word for it.
    pos = {r["name"]: r["position"] for r in device_rows(page)}
```

Run: `python3 check-browser.py --only check_rack_export_device_csv`
Expected: `FAIL`, with "NetBox CSV: rows ['core-1', 'demarc-i3', 'demarc-i4', 'leaf-1']; the status reads 'Downloaded, with 4 notes in the file.'" and "Nautobot CSV: rows […Nautobot refuses this while either type is full depth…]".

- [ ] **Step 4: The rows**

In `site/rack/export-data.js`, replace

```js
// One row per rail item, top down. Role and site/location are left blank on
// purpose: both are required, and this rack knows neither - a blank one
// fails the import loudly instead of filing devices under a guess.
export function deviceImportRows({rack, items, types, target = 'netbox'}) {
  const T = TARGET_NAME[target] || 'NetBox';
  const names = uniqueNames(items);
  // Top down by the U a device's TOP occupies, not where it starts (ru is
  // its bottom): a tall device reaches higher than its ru alone would say.
  const topU = it => it.ru + it.u - 1;
  const sorted = [...items].sort((a, b) => topU(b) - topU(a) || (a.face === b.face ? 0 : a.face === 'front' ? -1 : 1));
  const rows = sorted.map(it => {
    const t = types.get(it.id) || null;
    const n = names.get(it.id);
    const notes = [];
    if (!t) notes.push(`No ${T} device type for ${it.ref}${it.cfg ? ` (${it.cfg})` : ''}; add one before importing.`);
    else if (t.otherVendor)
      notes.push(otherVendorNote({label: it.label, ref: it.ref, T, manufacturer: t.chassisManufacturer, path: t.path}));
    else if (t.guess) notes.push(`Device type ${t.model} is a best guess for configuration ${it.cfg}.`);
    if (n.renamed) notes.push(`Named ${n.name} because another device here is also ${String(it.label || it.ref).trim()}.`);
    const mt = mountText(it.mount);
    if (mt) notes.push(`${mt[0].toUpperCase()}${mt.slice(1)}.`);
    if (it.turned) notes.push('Mounted turned: its rear panel faces out.');
    const others = items.filter(o => o.id !== it.id && o.face !== it.face && overlaps(o, it));
    if (others.length && (t?.isFullDepth || others.some(o => types.get(o.id)?.isFullDepth))) {
      const named = others.map(o => names.get(o.id).name);
      const list = named.length > 1 ? `${named.slice(0, -1).join(', ')} and ${named.at(-1)}` : named[0];
      notes.push(`Shares its U with ${list} on the ${others[0].face}; ${T} refuses this while either type is full depth.`);
    }
    const position = positionOf(rack.frame, it.ru, it.u);
    const comments = notes.join(' ');
    return target === 'nautobot'
      ? {name: n.name, role__name: '', device_type__manufacturer__name: t?.manufacturer ?? '',
         device_type__model: t?.model ?? '', status__name: 'Planned', location__name: '',
         rack__name: rack.name, position, face: it.face, comments}
      : {name: n.name, role: '', manufacturer: t?.manufacturer ?? '', device_type: t?.model ?? '',
         status: 'planned', site: '', rack: rack.name, position, face: it.face, comments};
  });
  return {columns: target === 'nautobot' ? NAUTOBOT_COLUMNS : NETBOX_COLUMNS, rows};
```

with

```js
// THE DEVICE IMPORT: one row per rail item the target will take, top down.
// `dcim` is the rack's import settings ({site, role}, model.js dcimOf): NetBox's
// site and role, Nautobot's location and role. Both are required by both
// targets and are written as given; blank ones stay blank, and the kit's
// README says the file will be refused until they are filled in.
//
// A ROW THE TARGET WOULD REFUSE IS NOT WRITTEN (Phase 2c ruling 3). Both
// targets take a device file whole or not at all, so one such row would
// refuse every device. `left` lists each device left out, with the sentence
// the README carries:
//   - a device with no device type (the type is a required column), on both;
//   - on NetBox only, the later-placed of two devices that share a U front
//     and rear while either type is full depth. The rack's own order is the
//     order they were placed. Nautobot 3.2 accepts such a pair, so its file
//     keeps both.
export function deviceImportRows({rack, items, types, target = 'netbox', dcim = {}}) {
  const T = TARGET_NAME[target] || 'NetBox';
  const names = uniqueNames(items);
  const site = String(dcim?.site ?? '').trim(), role = String(dcim?.role ?? '').trim();
  const kept = [], left = [];
  for (const it of items) {
    const t = types.get(it.id) || null, name = names.get(it.id).name;
    if (!t) {
      left.push({id: it.id, name, reason: `${name} is not in the devices file: there is no ${T} device type for ` +
        `${it.ref}${it.cfg ? ` (${it.cfg})` : ''}. Add the type and the device by hand.`});
      continue;
    }
    const clash = target === 'nautobot' ? null
      : kept.find(o => o.face !== it.face && overlaps(o, it) && (t.isFullDepth || types.get(o.id).isFullDepth));
    if (clash) {
      left.push({id: it.id, name, reason: `${name} is not in the devices file: it shares U${positionOf(rack.frame, it.ru, it.u)} ` +
        `with ${names.get(clash.id).name} on the ${clash.face}, and ${T} refuses two devices in one U, front and rear, while ` +
        `either type is full depth. One refused row refuses the whole file. Import ${name} by hand after changing the ` +
        `type's depth, or place it elsewhere.`});
      continue;
    }
    kept.push(it);
  }
  // Top down by the U a device's TOP occupies, not where it starts (ru is
  // its bottom): a tall device reaches higher than its ru alone would say.
  const topU = it => it.ru + it.u - 1;
  const sorted = [...kept].sort((a, b) => topU(b) - topU(a) || (a.face === b.face ? 0 : a.face === 'front' ? -1 : 1));
  const rows = sorted.map(it => {
    const t = types.get(it.id);
    const n = names.get(it.id);
    const notes = [];
    if (t.otherVendor)
      notes.push(otherVendorNote({label: it.label, ref: it.ref, T, manufacturer: t.chassisManufacturer, path: t.path}));
    else if (t.guess) notes.push(`Device type ${t.model} is a best guess for configuration ${it.cfg}.`);
    if (n.renamed) notes.push(`Named ${n.name} because another device here is also ${String(it.label || it.ref).trim()}.`);
    const mt = mountText(it.mount);
    if (mt) notes.push(`${mt[0].toUpperCase()}${mt.slice(1)}.`);
    if (it.turned) notes.push('Mounted turned: its rear panel faces out.');
    const position = positionOf(rack.frame, it.ru, it.u);
    const comments = notes.join(' ');
    return target === 'nautobot'
      ? {name: n.name, role__name: role, device_type__manufacturer__name: t.manufacturer ?? '',
         device_type__model: t.model ?? '', status__name: 'Planned', location__name: site,
         rack__name: rack.name, position, face: it.face, comments}
      : {name: n.name, role, manufacturer: t.manufacturer ?? '', device_type: t.model ?? '',
         status: 'planned', site, rack: rack.name, position, face: it.face, comments};
  });
  return {columns: target === 'nautobot' ? NAUTOBOT_COLUMNS : NETBOX_COLUMNS, rows, left};
}

// THE RACK, as NetBox imports one (Phase 2c ruling 2): written from the frame.
// A device row names its rack, and the device import does not create it.
// desc_units is NetBox's "units are numbered top-to-bottom".
export const NETBOX_RACK_COLUMNS = ['site', 'name', 'status', 'width', 'u_height', 'desc_units'];
export function rackImportRows({rack, dcim = {}}) {
  return {columns: NETBOX_RACK_COLUMNS, rows: [{site: String(dcim?.site ?? '').trim(), name: rack.name, status: 'planned',
    width: 19, u_height: rack.frame.heightRU, desc_units: rack.frame.numbering === 'top-down' ? 'true' : 'false'}]};
```

- [ ] **Step 5: The devices CSV says what it left out**

In `site/rack/exports.js`, replace

```js
// The device import (spec §8): one row per rail item. Pure CSV so it
// imports as is; each row's notes are in its own comments column, and those
// are the notes the file carries. A rack-level note (zero-U items, cables)
// has no row to sit in, so it comes back as `left`.
export async function deviceImportCsv(rack, chassisOf, target) {
  const ctx = await dcimContext(rack, chassisOf, target, {modules: false});
  const {columns, rows} = deviceImportRows({rack, items: ctx.items, types: ctx.types, target});
  return {name: `${fileStem(rack.name)}-${target}-devices.csv`, data: toCsv(columns, rows),
          type: 'text/csv', notes: rows.map(r => r.comments).filter(Boolean), left: rackNotes(rack)};
```

with

```js
// The device import (spec §8): one row per rail item the target will take.
// Pure CSV so it imports as is; each row's notes are in its own comments
// column, and those are the notes the file carries. A rack-level note (zero-U
// items, cables) and a device left out of the file (export-data.js
// deviceImportRows) have no row to sit in, so they come back as `left`.
export async function deviceImportCsv(rack, chassisOf, target) {
  const ctx = await dcimContext(rack, chassisOf, target, {modules: false});
  const {columns, rows, left} = deviceImportRows({rack, items: ctx.items, types: ctx.types, target});
  return {name: `${fileStem(rack.name)}-${target}-devices.csv`, data: toCsv(columns, rows),
          type: 'text/csv', notes: rows.map(r => r.comments).filter(Boolean),
          left: [...rackNotes(rack), ...left.map(l => l.reason)]};
```

- [ ] **Step 6: Run everything this task touches and see it pass**

Run: `node --test tests/rack/*.test.mjs`
Expected: `# tests 169`, `# pass 169`, `# fail 0`.

Run: `python3 check-browser.py --only check_rack_export_device_csv,check_rack_export_cable_schedule,check_rack_export_cable_failures,check_rack_one_u,check_rack_export_notes_truthful,check_rack_mount_flag,check_rack_mount_flag_3d_exports,check_rack_export_empty,check_rack_export_other_vendor`
Expected: nine `ok` lines.

- [ ] **Step 7: Commit**

```bash
git add site/rack/export-data.js site/rack/exports.js tests/rack/dcim.test.mjs check-browser.py
git commit -m "rack: the devices file holds only rows its target takes, and takes the site and role

NetBox refuses two full-depth devices sharing a U front and rear, and one
refused row refuses the file: the later-placed of the two is left out, with a
sentence saying why and what to do. Nautobot accepts the pair, so its file
keeps both and no longer calls them refused. A device with no device type is
left out for both. The rows take a site or location and a role when given.
The rack row for NetBox is written from the frame.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The modules file and the cables file, as rows

Rulings 5, 6 and 7, as pure functions.
- **Modules.** One row per part seated in a bay (its path ends `/module`) whose module type resolves and whose bay resolves by position, on a device the devices file holds. NetBox: `device, module_bay` (the bay's **name**), `module_type` (its model), `status`. Nautobot: the five lookup columns the real instance accepted. A part seated in a cage (an optic, a plug) is not a module. A module inside a card is not written, and that is said.
- **Cables, NetBox.** A row only when its ends were checked and both landed, both devices are in the devices file, both ends resolve (`resolveEnd`), neither a device name nor a port name holds a comma, the two kinds of end can be cabled together, and no earlier row uses either port. Everything else is a sentence in `left`, worded with the cable names the other exports use.
- **Cables, Nautobot.** The same rules, minus the comma rule, in columns of this plan's own (`a_device, a_type, a_name, …`) for `import_cables.py` (Task 6). They are deliberately not Nautobot's importer's columns.
- **Media** become cable types both targets accepted; unset or unknown media is a blank type. **Lengths** are written in `m` or `ft` only, rounded up to what the target stores: two decimal places for NetBox, a whole number for Nautobot.

**Files:**
- Modify: `site/rack/dcim-rules.js`, `tests/rack/dcim-import.test.mjs`

**Interfaces:**
- Consumes: `resolveEnd`, `bayAt` (Task 1); `endName(rack, end, uOf)` and `lengthParts(length)` from `site/rack/cable-rules.js`; `cableFindings(rack, ends)` and `TARGET_NAME` from `site/rack/export-data.js`.
- Produces, exported from `site/rack/dcim-rules.js`:
  - `MODULE_COLUMNS` → `{netbox: [...], nautobot: [...]}`.
  - `moduleImportRows({target = 'netbox', parts, names, kept, deviceOf, moduleOf})` → `{columns, rows, left: string[]}`. `parts` is `[{itemId, path, ref}]`; `names` is `uniqueNames(items)`; `kept` is a `Set` of the ids of the devices in the devices file; `deviceOf(itemId)` gives that item's device type as `typeLists`, or `null`; `moduleOf(ref)` gives `{manufacturer, model, lists}` for a part's module type, or `null`.
  - `CABLE_TYPE`, `cableType(media)` → a cable type, or `''`.
  - `canMeet(typeA, typeB)` → whether a DCIM cables those two kinds of end together.
  - `importLength(cable, target = 'netbox')` → `{value, unit, note}`; `note` is a phrase with no period, or `null`.
  - `CABLE_IMPORT_COLUMNS` → `{netbox: [...], nautobot: [...]}`.
  - `cableImportRows({rack, target = 'netbox', names, kept, resolve, ends = new Map(), unchecked = false, uOf})` → `{columns, rows, left: string[], notes: string[]}`. `resolve(end)` gives `resolveEnd`'s answer for that end; `ends` is `cableFacts(rack).ends`; `uOf` is `endName`'s (how tall a device is).

- [ ] **Step 1: Write the failing tests**

In `tests/rack/dcim-import.test.mjs`, replace

```js
import * as D from '../../site/rack/dcim-rules.js';
```

with

```js
import * as D from '../../site/rack/dcim-rules.js';
import * as X from '../../site/rack/export-data.js';
import * as M from '../../site/rack/model.js';
```

Append to the end of `tests/rack/dcim-import.test.mjs`:

```js

// ── the modules and cables files ────────────────────────────────────────
// check-browser.py's cable fixture, as far as the rules read it.
const FRAME = M.normalizeFrame({heightRU: 24});
const ITEMS = [
  {id: 'i1', ref: 'asr-9006', cfg: 'base', label: 'core-1', ru: 2, u: 10, face: 'front', turned: false},
  {id: 'i2', ref: 'as7726-32x', cfg: 'ac-f2b', label: 'leaf-1', ru: 14, u: 1, face: 'front', turned: false},
  {id: 'i3', ref: 'tm-280', cfg: 'base', label: 'demarc', ru: 14, u: 1, face: 'rear', turned: false},
  {id: 'i4', ref: 'tm-280', cfg: 'base', label: 'demarc', ru: 20, u: 1, face: 'rear', turned: false}];
const end = (item, path) => ({item, path, view: 'front'});
const CABLES = [
  {id: 'c1', a: end('i2', 'port-1'), b: end('i1', 'slot-2/module/p0'), media: 'os2', purpose: 'uplink', label: 'A1',
   length: {value: 2, unit: 'm', source: 'entered'}, route: []},
  {id: 'c2', a: end('i2', 'mgmt-eth'), b: end('i3', 'port-2-1'), media: 'cat6a', purpose: 'management', label: '', route: []},
  {id: 'c3', a: end('i2', 'port-2'), b: end('i4', 'port-2-1'), media: 'os2', purpose: 'uplink', label: '', route: []}];
const RACK = {name: 'Cable test', frame: FRAME, zeroU: [], items: ITEMS, cables: CABLES};
const NAMES = X.uniqueNames(ITEMS);
const DEVICE = {i1: lists(ASR), i2: lists(LEAF), i3: lists(TM), i4: lists(TM)};
const CARD_TYPE = {manufacturer: 'Cisco', model: 'A9K-16X100GE-TR', lists: lists(CARD)};
const PARTS = [{itemId: 'i1', path: 'slot-2/module', ref: 'cisco/a9k-16x100ge-tr@1'},
               {itemId: 'i1', path: 'slot-2/module/p0-occupant', ref: 'generic/qsfp-lc@2'},
               {itemId: 'i2', path: 'port-1-occupant', ref: 'generic/qsfp-lc@2'}];
const moduleOf = ref => (ref === 'cisco/a9k-16x100ge-tr@1' ? CARD_TYPE : null);
const resolve = e => D.resolveEnd({path: e.path, device: DEVICE[e.item], consoles: ['con'],
  moduleAt: bay => (e.item === 'i1' && bay === 'slot-2' ? CARD_TYPE.lists : null)});
// Every end lands, except leaf-1 port-2: an empty cage.
const landed = (cables, loose = {}) => new Map(cables.flatMap(c => [c.a, c.b]).map(e =>
  [`${e.item}|${e.view}|${e.path}`, {info: null, reason: loose[`${e.item}|${e.path}`] ?? null}]));
const ENDS = landed(CABLES, {'i2|port-2': 'port-2 holds no optic'});
const ALL = new Set(['i1', 'i2', 'i3', 'i4']), NETBOX_KEPT = new Set(['i1', 'i2', 'i4']);
const cableRows = (over = {}) => D.cableImportRows({rack: RACK, target: 'netbox', names: NAMES, kept: NETBOX_KEPT, resolve,
  ends: ENDS, ...over});

test('the modules file: one row per card in a bay, by the bay NAME; an optic is not a module', () => {
  const nb = D.moduleImportRows({target: 'netbox', parts: PARTS, names: NAMES, kept: ALL, deviceOf: id => DEVICE[id], moduleOf});
  // result.json: NetBox took exactly these columns (status is required; a manufacturer column is refused).
  assert.deepEqual(nb, {columns: ['device', 'module_bay', 'module_type', 'status'], left: [],
    rows: [{device: 'core-1', module_bay: 'slot-2', module_type: 'A9K-16X100GE-TR', status: 'planned'}]});
  const nt = D.moduleImportRows({target: 'nautobot', parts: PARTS, names: NAMES, kept: ALL, deviceOf: id => DEVICE[id], moduleOf});
  assert.deepEqual(nt.columns, ['module_type__manufacturer__name', 'module_type__model',
    'parent_module_bay__parent_device__name', 'parent_module_bay__name', 'status__name']);
  assert.deepEqual(nt.rows, [{module_type__manufacturer__name: 'Cisco', module_type__model: 'A9K-16X100GE-TR',
    parent_module_bay__parent_device__name: 'core-1', parent_module_bay__name: 'slot-2', status__name: 'Planned'}]);
});

test('the modules file names a bay by its name, found by its position; what it cannot carry is said', () => {
  const fan = {manufacturer: 'Edgecore', model: 'FAN-F', lists: D.typeLists('model: FAN-F\n')};
  const parts = [{itemId: 'i2', path: 'fan-1/module', ref: 'fan'},                // name "Fan 1", position fan-1
                 {itemId: 'i2', path: 'nowhere/module', ref: 'fan'},              // no bay at that position
                 {itemId: 'i1', path: 'slot-2/module/mic-0/module', ref: 'fan'},  // a module inside a card
                 {itemId: 'i3', path: 'bay/module', ref: 'fan'}, {itemId: 'i3', path: 'bay-2/module', ref: 'fan'},
                 {itemId: 'i4', path: 'bay/module', ref: 'no-type'}];
  const got = D.moduleImportRows({target: 'netbox', parts, names: NAMES, kept: NETBOX_KEPT, deviceOf: id => DEVICE[id],
    moduleOf: ref => (ref === 'fan' ? fan : null)});
  assert.deepEqual(got.rows, [{device: 'leaf-1', module_bay: 'Fan 1', module_type: 'FAN-F', status: 'planned'}]);
  assert.deepEqual(got.left, [
    'leaf-1 nowhere: FAN-F is not in the modules file. The device type 7726-32X-O-AC-F has no module bay at position nowhere.',
    'core-1 slot-2/module/mic-0: FAN-F is not in the modules file. It is a module inside a card, and no module type here has a module bay to import it into.',
    'The modules of demarc-i3 are not in the modules file: demarc-i3 is not in the devices file.']);
});

test('media become cable types both targets accepted; anything else is blank', () => {
  assert.deepEqual(['os2', 'om3', 'om4', 'om5', 'cat6', 'cat6a', 'dac', 'aoc'].map(D.cableType),
    ['smf-os2', 'mmf-om3', 'mmf-om4', 'mmf-om5', 'cat6', 'cat6a', 'dac-passive', 'aoc']);
  assert.deepEqual(['', undefined, null, 'copper', 'toString', 'smf-os2'].map(D.cableType), ['', '', '', '', '', '']);
});

test('a length is written in m or ft, rounded up to what the target stores', () => {
  const len = (value, unit) => ({length: {value, unit, source: 'entered'}});
  assert.deepEqual(D.importLength(len(2, 'm'), 'netbox'), {value: 2, unit: 'm', note: null});
  assert.deepEqual(D.importLength(len(1.5, 'ft'), 'netbox'), {value: 1.5, unit: 'ft', note: null});
  assert.deepEqual(D.importLength(len(0.07, 'm'), 'netbox'), {value: 0.07, unit: 'm', note: null});
  assert.deepEqual(D.importLength(len(1.234, 'm'), 'netbox'), {value: 1.24, unit: 'm',
    note: '1.234 m is written as 1.24 m: NetBox keeps two decimal places, and a length is rounded up'});
  // result.json: Nautobot answered 1.5 with "A valid integer is required."
  assert.deepEqual(D.importLength(len(1.5, 'ft'), 'nautobot'), {value: 2, unit: 'ft',
    note: '1.5 ft is written as 2 ft: Nautobot takes whole numbers, and a length is rounded up'});
  assert.deepEqual(D.importLength(len(3, 'm'), 'nautobot'), {value: 3, unit: 'm', note: null});
  assert.deepEqual(D.importLength(len(30, 'cm'), 'netbox'), {value: '', unit: '',
    note: 'its length (30 cm) is not carried: the kit writes lengths in m or ft only'});
  assert.deepEqual(D.importLength({}, 'netbox'), {value: '', unit: '', note: null});
  assert.deepEqual(D.importLength({lengthAsWritten: 'long'}, 'nautobot'), {value: '', unit: '',
    note: 'its length as written in the rack file is not carried'});
});

test('which ends one cable may join', () => {
  assert.ok(D.canMeet('dcim.interface', 'dcim.interface') && D.canMeet('dcim.interface', 'dcim.frontport'));
  assert.ok(D.canMeet('dcim.consoleport', 'dcim.rearport') && D.canMeet('dcim.powerport', 'dcim.poweroutlet'));
  assert.ok(!D.canMeet('dcim.consoleport', 'dcim.interface') && !D.canMeet('dcim.interface', 'dcim.consoleport'));
  assert.ok(!D.canMeet('dcim.interface', 'dcim.powerport') && !D.canMeet('dcim.nonsense', 'dcim.interface'));
});

test("NetBox's cables file: the columns the real instance took, and only rows it would take", () => {
  const got = cableRows();
  assert.deepEqual(got.columns, ['side_a_device', 'side_a_type', 'side_a_name', 'side_b_device', 'side_b_type',
    'side_b_name', 'type', 'status', 'label', 'color', 'length', 'length_unit', 'description']);
  // The row result.json's cables_good imported, device names apart.
  assert.deepEqual(got.rows, [{side_a_device: 'leaf-1', side_a_type: 'dcim.interface', side_a_name: 'port-1',
    side_b_device: 'core-1', side_b_type: 'dcim.interface', side_b_name: 'slot-2/p0', type: 'smf-os2', status: 'planned',
    label: 'A1', color: '', length: 2, length_unit: 'm', description: 'uplink'}]);
  assert.equal(X.toCsv(got.columns, got.rows).split('\r\n')[1],
    'leaf-1,dcim.interface,port-1,core-1,dcim.interface,slot-2/p0,smf-os2,planned,A1,,2,m,uplink');
  assert.deepEqual(got.left, [
    'Cable c2 is not in the cables file: end B is on demarc-i3, which is not in the devices file.',
    'Cable c3 is not in the cables file: end A, leaf-1 (U14) port-2, is not connected (port-2 holds no optic).']);
  assert.deepEqual(got.notes, []);
});

test("Nautobot's cables file is for the script: ends by name, every device kept, whole lengths", () => {
  const cables = [...CABLES, {id: 'c4', a: end('i4', 'port-2-2'), b: end('i3', 'port-2-2'), media: 'cat6', purpose: '', label: '',
    length: {value: 1.5, unit: 'ft', source: 'entered'}, route: []}];
  const rack = {...RACK, cables};
  const got = D.cableImportRows({rack, target: 'nautobot', names: NAMES, kept: ALL, resolve,
    ends: landed(cables, {'i2|port-2': 'port-2 holds no optic'})});
  assert.deepEqual(got.columns, ['a_device', 'a_type', 'a_name', 'b_device', 'b_type', 'b_name', 'type', 'status', 'label',
    'color', 'length', 'length_unit']);
  assert.deepEqual(got.rows.map(r => Object.values(r).join('|')), [
    'leaf-1|dcim.interface|port-1|core-1|dcim.interface|slot-2/p0|smf-os2|Planned|A1||2|m',
    'leaf-1|dcim.interface|mgmt-eth|demarc-i3|dcim.interface|port-2-1|cat6a|Planned|c2|||',
    'demarc-i4|dcim.interface|port-2-2|demarc-i3|dcim.interface|port-2-2|cat6|Planned|c4||2|ft']);
  assert.deepEqual(got.left, ['Cable c3 is not in the cables file: end A, leaf-1 (U14) port-2, is not connected (port-2 holds no optic).']);
  assert.deepEqual(got.notes, ['Cable c4: 1.5 ft is written as 2 ft: Nautobot takes whole numbers, and a length is rounded up.']);
});

test('a cable the target would refuse is left out, each with its reason', () => {
  const one = (cable, over = {}) => {
    const rack = {...RACK, cables: [cable]};
    return D.cableImportRows({rack, target: 'netbox', names: NAMES, kept: ALL, resolve, ends: landed([cable]), ...over, rack: over.rack || rack});
  };
  const cab = (a, b, more = {}) => ({id: 'c9', a, b, media: 'cat6', purpose: '', label: 'X', route: [], ...more});
  // Console port to interface: result.json, "Incompatible termination types: consoleport and interface".
  assert.deepEqual(one(cab(end('i4', 'con'), end('i2', 'mgmt-eth'))).left,
    ['Cable X is not in the cables file: NetBox does not cable a console port to an interface.']);
  assert.match(one(cab(end('i4', 'con'), end('i2', 'mgmt-eth')), {target: 'nautobot'}).left[0], /Nautobot does not cable a console port to an interface\.$/);
  // An end the type file does not name, with the reason the resolution gives.
  assert.deepEqual(one(cab(end('i2', 'port-99'), end('i4', 'port-2-1'))).left,
    ['Cable X is not in the cables file: end A, leaf-1 (U14) port-99: the device type 7726-32X-O-AC-F lists no port named port-99.']);
  // Ends that could not be checked: none is written. A loose end might be among them.
  assert.deepEqual(one(cab(end('i2', 'port-1'), end('i4', 'port-2-1')), {unchecked: true}).left,
    ['Cable X is not in the cables file: its ends could not be checked.']);
  assert.deepEqual(one(cab(end('i2', 'port-1'), end('i4', 'port-2-1')), {ends: new Map()}).left,
    ['Cable X is not in the cables file: its ends could not be checked.']);
  // A removed device is a loose end, in the words the other exports use.
  const gone = cab(end('i9', 'port-1'), end('i4', 'port-2-1'));
  assert.deepEqual(one(gone, {ends: landed([gone], {'i9|port-1': 'the device was removed'})}).left,
    ["Cable X is not in the cables file: end A, a removed device's port-1, is not connected (the device was removed)."]);
  // A comma in a device name: NetBox would read two devices. Nautobot's script looks the name up whole.
  const items = ITEMS.map(i => (i.id === 'i2' ? {...i, label: 'leaf, one'} : i));
  const rack = {...RACK, items, cables: [cab(end('i2', 'port-1'), end('i4', 'port-2-1'))]};
  const over = {rack, names: X.uniqueNames(items), ends: landed(rack.cables)};
  assert.deepEqual(one(rack.cables[0], over).left,
    ['Cable X is not in the cables file: end A: NetBox reads a comma in a device or port name as a list, so "leaf, one" cannot be written.']);
  assert.equal(one(rack.cables[0], {...over, target: 'nautobot'}).rows[0].a_device, 'leaf, one');
});

test('one port, one cable in the file; a label, or the id; an unknown media and a DAC are said', () => {
  const cab = (id, a, b, more = {}) => ({id, a, b, media: 'cat6', purpose: '', label: '', route: [], ...more});
  const cables = [cab('c1', end('i2', 'mgmt-eth'), end('i4', 'port-2-1')),
                  cab('c2', end('i4', 'port-2-1'), end('i2', 'port-3'), {label: 'second'}),
                  cab('c3', end('i2', 'port-4'), end('i2', 'port-5'), {media: 'dac'}),
                  cab('c4', end('i2', 'port-6'), end('i2', 'port-7'), {media: 'coax'}),
                  cab('c5', end('i2', 'port-8'), end('i2', 'port-9'), {media: ''})];
  const got = D.cableImportRows({rack: {...RACK, cables}, target: 'netbox', names: NAMES, kept: ALL, resolve, ends: landed(cables)});
  assert.deepEqual(got.rows.map(r => [r.label, r.type]), [['c1', 'cat6'], ['c3', 'dac-passive'], ['c4', ''], ['c5', '']]);
  assert.deepEqual(got.left, ['Cable second is not in the cables file: end A, demarc (U20) port-2-1, already has cable c1 in this file.']);
  assert.deepEqual(got.notes, ['Cable c4: its media (coax) has no NetBox cable type, so its type is blank.',
    'A DAC is written as dac-passive. Change the type of one that is active.']);
});

test('a rack with no cables gets a header and no rows', () => {
  const got = D.cableImportRows({rack: {...RACK, cables: []}, target: 'netbox', names: NAMES, kept: ALL, resolve});
  assert.deepEqual([got.rows, got.left, got.notes], [[], [], []]);
  assert.equal(X.toCsv(got.columns, got.rows),
    'side_a_device,side_a_type,side_a_name,side_b_device,side_b_type,side_b_name,type,status,label,color,length,length_unit,description\r\n');
});
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `node --test tests/rack/dcim-import.test.mjs`
Expected: `# tests 17`, `# pass 7`, `# fail 10`: every test from "the modules file: one row per card in a bay…" on fails, each because a function of `D` is not defined (`D.moduleImportRows is not a function`, `D.cableType` is `undefined`, and so on).

- [ ] **Step 3: Write the rows**

In `site/rack/dcim-rules.js`, replace

```js
// files and the faces, and asks here.
```

with

```js
// files and the faces, and asks here.

import {endName, lengthParts} from './cable-rules.js';
import {cableFindings, TARGET_NAME} from './export-data.js';
```

Append to the end of `site/rack/dcim-rules.js`:

```js

// ── the modules file (Phase 2c ruling 5) ────────────────────────────────
// A card's ports exist in a DCIM only once a module of its type is in its bay,
// so the modules are imported before the cables. NetBox finds the bay by the
// device's name and the bay's NAME, and the module type by its model alone (a
// manufacturer column is refused); Nautobot by the lookups below. Both were
// accepted by the real instances (NetBox 4.7.2, Nautobot 3.2.6).
export const MODULE_COLUMNS = {
  netbox: ['device', 'module_bay', 'module_type', 'status'],
  nautobot: ['module_type__manufacturer__name', 'module_type__model', 'parent_module_bay__parent_device__name',
             'parent_module_bay__name', 'status__name']};

// One row per part seated in a BAY (its path ends "/module") that has a module
// type, on a device the devices file holds, in a bay the device type has at
// that position. A part seated in a cage (an optic, a plug) is not a module:
// the cage is the interface. A module inside a card is not written: no module
// type here has a module bay of its own to import it into.
//   parts     [{itemId, path, ref}], what each device has seated (exports.js)
//   names     uniqueNames(items); kept: the ids of the devices in the devices file
//   deviceOf  item id -> typeLists of its device type, or null
//   moduleOf  part ref -> {manufacturer, model, lists} of its module type, or null
// `left` holds one sentence for each thing the file does not carry.
export function moduleImportRows({target = 'netbox', parts, names, kept, deviceOf, moduleOf}) {
  const rows = [], left = [], said = new Set();
  for (const p of parts) {
    if (!String(p.path).endsWith('/module')) continue;
    const type = moduleOf(p.ref);
    if (!type) continue;                       // a part with no module type is already in the kit's notes
    const device = names.get(p.itemId)?.name ?? '';
    const bayId = p.path.slice(0, -'/module'.length);
    if (!kept.has(p.itemId)) {
      if (!said.has(p.itemId)) left.push(`The modules of ${device} are not in the modules file: ${device} is not in the devices file.`);
      said.add(p.itemId);
      continue;
    }
    if (bayId.includes(MODULE)) {
      left.push(`${device} ${bayId}: ${type.model} is not in the modules file. It is a module inside a card, and no module type here has a module bay to import it into.`);
      continue;
    }
    const lists = deviceOf(p.itemId), bay = bayAt(lists, bayId);
    if (!bay) {
      left.push(`${device} ${bayId}: ${type.model} is not in the modules file. The device type ${lists?.model ?? ''} has no module bay at position ${bayId}.`);
      continue;
    }
    rows.push(target === 'nautobot'
      ? {module_type__manufacturer__name: type.manufacturer, module_type__model: type.model,
         parent_module_bay__parent_device__name: device, parent_module_bay__name: bay.name, status__name: 'Planned'}
      : {device, module_bay: bay.name, module_type: type.model, status: 'planned'});
  }
  return {columns: MODULE_COLUMNS[target === 'nautobot' ? 'nautobot' : 'netbox'], rows, left};
}

// ── the cables file (Phase 2c rulings 6 and 7) ──────────────────────────
// The Rack Builder's media as a DCIM's cable type. Both targets accepted each
// of these and refused "os2". A media this page does not know, or none, is a
// blank type: the column is optional.
export const CABLE_TYPE = {os2: 'smf-os2', om3: 'mmf-om3', om4: 'mmf-om4', om5: 'mmf-om5', cat6: 'cat6', cat6a: 'cat6a',
                           dac: 'dac-passive', aoc: 'aoc'};
export const cableType = media => (Object.hasOwn(CABLE_TYPE, media ?? '') ? CABLE_TYPE[media] : '');

// Which kinds of end a DCIM lets one cable join (NetBox and Nautobot share the
// table; both refused a console port to an interface).
const PORTS = ['dcim.frontport', 'dcim.rearport'];
const MEETS = {
  'dcim.interface': ['dcim.interface', ...PORTS],
  'dcim.frontport': ['dcim.interface', 'dcim.consoleport', 'dcim.consoleserverport', ...PORTS],
  'dcim.rearport': ['dcim.interface', 'dcim.consoleport', 'dcim.consoleserverport', ...PORTS],
  'dcim.consoleport': ['dcim.consoleserverport', ...PORTS],
  'dcim.consoleserverport': ['dcim.consoleport', ...PORTS],
  'dcim.powerport': ['dcim.poweroutlet'],
  'dcim.poweroutlet': ['dcim.powerport']};
export const canMeet = (a, b) => (MEETS[a] || []).includes(b);
const KIND = {'dcim.interface': 'an interface', 'dcim.frontport': 'a front port', 'dcim.rearport': 'a rear port',
              'dcim.consoleport': 'a console port', 'dcim.consoleserverport': 'a console server port',
              'dcim.powerport': 'a power port', 'dcim.poweroutlet': 'a power outlet'};

// A cable's length as a target takes it: {value, unit, note}. Only m and ft
// are written (the units the page offers). NetBox keeps two decimal places and
// refuses a third; Nautobot takes a whole number only. Either way a length is
// rounded UP, never down: a cable cut short does not reach.
export function importLength(cable, target = 'netbox') {
  const p = lengthParts(cable.length);
  if (!p) return {value: '', unit: '', note: cable.lengthAsWritten != null ? 'its length as written in the rack file is not carried' : null};
  if (p.unit !== 'm' && p.unit !== 'ft')
    return {value: '', unit: '', note: `its length (${p.value} ${p.unit}) is not carried: the kit writes lengths in m or ft only`};
  const value = target === 'nautobot' ? Math.ceil(p.value) : Math.ceil(p.value * 100 - 1e-9) / 100;
  const note = value === p.value ? null
    : `${p.value} ${p.unit} is written as ${value} ${p.unit}: ${target === 'nautobot' ? 'Nautobot takes whole numbers' : 'NetBox keeps two decimal places'}, and a length is rounded up`;
  return {value, unit: p.unit, note};
}

export const CABLE_IMPORT_COLUMNS = {
  netbox: ['side_a_device', 'side_a_type', 'side_a_name', 'side_b_device', 'side_b_type', 'side_b_name', 'type', 'status',
           'label', 'color', 'length', 'length_unit', 'description'],
  // Read by import_cables.py, NOT by Nautobot's own importer: Nautobot takes a cable's ends by id only.
  nautobot: ['a_device', 'a_type', 'a_name', 'b_device', 'b_type', 'b_name', 'type', 'status', 'label', 'color', 'length',
             'length_unit']};

// One row per cable the target will take. NetBox takes the file whole or not
// at all, so a cable it would refuse is left out and said, in `left`, with its
// reason. A row needs: its ends checked and both landed; both devices in the
// devices file; both ends named by the type files (`resolve`, resolveEnd over
// this rack); no comma in a device or port name (NetBox reads one as a list);
// two kinds of end a DCIM joins; and no port already used by an earlier row.
//   ends       cable-plugs.js cableFacts(rack).ends; unchecked: reading them failed
//   names      uniqueNames(items); kept: the ids of the devices in the devices file
//   resolve    end -> resolveEnd's answer for that end
//   uOf        endName's: how tall a device is
// `notes` are about rows that ARE written: a type left blank, a length changed.
export function cableImportRows({rack, target = 'netbox', names, kept, resolve, ends = new Map(), unchecked = false, uOf}) {
  const T = TARGET_NAME[target] || 'NetBox', nautobot = target === 'nautobot';
  const rows = [], left = [], notes = [], used = new Map();
  let dac = false;
  for (const f of cableFindings(rack, ends)) {
    const c = f.cable;
    let why = [], sides = [];
    if (unchecked || !f.checked) why = ['its ends could not be checked'];
    else if (f.loose.length)
      why = f.loose.map(l => `end ${l.side}, ${endName(rack, l.end, uOf)}, is not connected (${l.reason})`);
    else {
      sides = [['A', c.a], ['B', c.b]].map(([side, end]) => {
        const device = names.get(end.item)?.name ?? '';
        if (!kept.has(end.item)) return {why: `end ${side} is on ${device}, which is not in the devices file`};
        const r = resolve(end);
        if (!r.ok) return {why: `end ${side}, ${endName(rack, end, uOf)}: ${r.reason}`};
        const comma = [device, r.name].find(x => x.includes(','));
        if (!nautobot && comma != null) return {why: `end ${side}: NetBox reads a comma in a device or port name as a list, so "${comma}" cannot be written`};
        return {side, end, device, name: r.name, type: r.type, key: JSON.stringify([device, r.type, r.name])};
      });
      why = sides.filter(s => s.why).map(s => s.why);
      if (!why.length && !canMeet(sides[0].type, sides[1].type))
        why = [`${T} does not cable ${KIND[sides[0].type]} to ${KIND[sides[1].type]}`];
      if (!why.length)
        why = sides.filter(s => used.has(s.key))
          .map(s => `end ${s.side}, ${endName(rack, s.end, uOf)}, already has cable ${used.get(s.key)} in this file`);
    }
    if (why.length) { left.push(`Cable ${f.name} is not in the cables file: ${why.join('; ')}.`); continue; }
    const [a, b] = sides;
    for (const s of sides) used.set(s.key, f.name);
    const type = cableType(c.media);
    if (c.media && !type) notes.push(`Cable ${f.name}: its media (${c.media}) has no ${T} cable type, so its type is blank.`);
    dac ||= c.media === 'dac';
    const len = importLength(c, target);
    if (len.note) notes.push(`Cable ${f.name}: ${len.note}.`);
    rows.push(nautobot
      ? {a_device: a.device, a_type: a.type, a_name: a.name, b_device: b.device, b_type: b.type, b_name: b.name, type,
         status: 'Planned', label: c.label || c.id, color: '', length: len.value, length_unit: len.unit}
      : {side_a_device: a.device, side_a_type: a.type, side_a_name: a.name, side_b_device: b.device, side_b_type: b.type,
         side_b_name: b.name, type, status: 'planned', label: c.label || c.id, color: '', length: len.value,
         length_unit: len.unit, description: c.purpose || ''});
  }
  if (dac) notes.push('A DAC is written as dac-passive. Change the type of one that is active.');
  return {columns: CABLE_IMPORT_COLUMNS[nautobot ? 'nautobot' : 'netbox'], rows, left, notes};
}
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `node --test tests/rack/*.test.mjs`
Expected: `# tests 179`, `# pass 179`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add site/rack/dcim-rules.js tests/rack/dcim-import.test.mjs
git commit -m "rack: the modules and cables files as rows, with a reason for every cable left out

Modules: one row per card in a bay, by the bay's name, found by its position;
an optic is not a module. Cables: a row only when both ends landed, both
devices are in the devices file, both ends are named by the type files, and
the two kinds of end can be cabled; NetBox also refuses a comma in a name.
Media become the cable types both targets accepted. A length is written in m
or ft, rounded up to what the target stores. Nautobot's rows name each end,
for the script that will look it up.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: README.txt, as text

Ruling 1: a `README.txt` says what to do with each file, what must already exist, and everything the kit could not carry. It replaces `NOTES.txt` and keeps its content. Ruling 2: if the site or the role is empty, the kit is still exported and the README's first lines say the devices file will be refused until they are filled in, naming the columns. Ruling 11: the Nautobot README says how the `types/` folder is imported and marks that step as not verified against Nautobot 3.2. Ruling 7: it says how to run `import_cables.py`, and that `3-cables.csv` must not be given to Nautobot's own importer.

**Files:**
- Modify: `site/rack/dcim-rules.js`, `tests/rack/dcim-import.test.mjs`

**Interfaces:**
- Consumes: `TARGET_NAME` (already imported in `dcim-rules.js`).
- Produces, exported from `site/rack/dcim-rules.js`:
  - `KIT_FILES` → `{netbox: {rack, devices, modules, cables}, nautobot: {devices, modules, cables}}`: each file's name in its kit.
  - `KIT_SCRIPT` → `'import_cables.py'`.
  - `kitReadme({target = 'netbox', rack, date, dcim = {}, typeFiles = 0, manufacturers = [], rows = {}, left = [], notes = [], script = true})` → `{text, notes}`. `rows` is how many rows each CSV holds (`{rack, devices, modules, cables}`); `typeFiles` how many YAML files are under `types/`; `left` a sentence for each thing the files leave out; `notes` what else needs saying; `script` whether `import_cables.py` is in the zip. The returned `notes` are the lines the README carries beyond its instructions (the warning, `left`, `notes`): what the page's status line counts.

- [ ] **Step 1: Write the failing tests**

Append to the end of `tests/rack/dcim-import.test.mjs`:

```js

// ── README.txt ──────────────────────────────────────────────────────────
const DAY = new Date(2026, 9, 4);
const README_RACK = {name: 'Cable test', frame: FRAME};

test("the NetBox kit's README: what must exist, each file in import order with its row count, then what is not carried", () => {
  const got = D.kitReadme({target: 'netbox', rack: README_RACK, date: DAY, dcim: {site: 'Lab 1', role: 'Router'}, typeFiles: 7,
    manufacturers: ['Cisco', 'Edgecore', 'Telco Systems'], rows: {rack: 1, devices: 3, modules: 1, cables: 1},
    left: ['demarc-i3 is not in the devices file: because.', 'Cable c2 is not in the cables file: why.'], notes: ['A best guess.']});
  assert.equal(got.text, [
    'NetBox import kit for Cable test, from the Portrayal Rack Builder, 2026-10-04.',
    '',
    'BEFORE YOU IMPORT, NetBox must already have:',
    '- the site "Lab 1"',
    '- the device role "Router"',
    '- these manufacturers: Cisco, Edgecore, Telco Systems',
    '',
    'IMPORT IN THIS ORDER. NetBox takes each CSV file whole or not at all: one refused row refuses the file.',
    '1. types/device-types/, then types/module-types/ (7 files): Device Types > Import and Module Types > Import, format YAML, one file at a time. The module types must be in before step 4.',
    '2. 1-rack.csv (1 row): Racks > Import. Creates the rack "Cable test", 24U, numbered from the bottom.',
    '3. 2-devices.csv (3 rows): Devices > Import. Every device is planned.',
    "4. 3-modules.csv (1 row): Modules > Import. This creates each card's ports, so it comes before the cables.",
    '5. 4-cables.csv (1 row): Cables > Import.',
    '   NetBox finds a device by its name in every site, and a module type by its model in every manufacturer: a name it already has twice is refused as not unique.',
    '',
    'NOT IN THIS KIT:',
    '- demarc-i3 is not in the devices file: because.',
    '- Cable c2 is not in the cables file: why.',
    '',
    'NOTES:',
    '- A best guess.',
    ''].join('\n'));
  // What the status line counts: the lines the file carries beyond its instructions.
  assert.deepEqual(got.notes, ['demarc-i3 is not in the devices file: because.', 'Cable c2 is not in the cables file: why.', 'A best guess.']);
});

test('blank settings: the first lines say the devices file will be refused, and name the columns', () => {
  const nb = D.kitReadme({target: 'netbox', rack: README_RACK, date: DAY, dcim: {}, typeFiles: 1, rows: {rack: 1, devices: 1, modules: 0, cables: 0}});
  const warn = "2-devices.csv WILL BE REFUSED as it is: its site and role columns are blank, and NetBox requires both. 1-rack.csv's site " +
    'column is blank too. Set the site and the device role under Export, DCIM import settings, and export again; or fill those columns in by hand.';
  assert.deepEqual(nb.text.split('\n').slice(0, 4), ['NetBox import kit for Cable test, from the Portrayal Rack Builder, 2026-10-04.', '', warn, '']);
  assert.deepEqual(nb.notes, [warn]);
  assert.ok(nb.text.includes('- a site (none is set in this kit)\n- a device role (none is set in this kit)\n'));
  // A file with no rows is still in the kit, and the README says it is empty.
  assert.ok(nb.text.includes('4. 3-modules.csv (no rows: it holds its header only, so skip it): Modules > Import.'));
  assert.ok(nb.text.includes('5. 4-cables.csv (no rows: it holds its header only, so skip it): Cables > Import.'));
  assert.ok(nb.text.includes('NOT IN THIS KIT:\n- Nothing: every device, card and cable in this rack is in the files.\n'));
  assert.ok(!nb.text.includes('NOTES:'));
  // One blank column: only that one is named.
  assert.equal(D.kitReadme({target: 'netbox', rack: README_RACK, date: DAY, dcim: {site: 'Lab 1'}, rows: {}}).text.split('\n')[2],
    '2-devices.csv WILL BE REFUSED as it is: its role column is blank, and NetBox requires it. Set the device role under Export, ' +
    'DCIM import settings, and export again; or fill that column in by hand.');
  const nt = D.kitReadme({target: 'nautobot', rack: README_RACK, date: DAY, dcim: {role: 'R'}, rows: {}});
  assert.equal(nt.text.split('\n')[2],
    '1-devices.csv WILL BE REFUSED as it is: its location__name column is blank, and Nautobot requires it. Set the location under Export, ' +
    'DCIM import settings, and export again; or fill that column in by hand.');
});

test("the Nautobot kit's README: the rack and the Planned status must exist, the types step is unverified, the cables go through the script", () => {
  const down = {...README_RACK, frame: {...FRAME, numbering: 'top-down'}};
  const got = D.kitReadme({target: 'nautobot', rack: down, date: DAY, dcim: {site: 'Lab 1', role: 'R'}, typeFiles: 2,
    manufacturers: ['Cisco'], rows: {devices: 4, modules: 1, cables: 2}});
  for (const line of [
    'Nautobot import kit for Cable test, from the Portrayal Rack Builder, 2026-10-04.',
    '- the location "Lab 1", of a location type that allows devices and racks',
    '- the role "R", for devices',
    '- a status named Planned, for devices, modules and cables',
    '- these manufacturers: Cisco',
    '- the rack "Cable test" in that location: 24U, numbered from the top (descending units). This kit has no rack file for Nautobot.',
    "1. types/device-types/, then types/module-types/ (2 files): Device Types > Import and Module Types > Import, one YAML file per import. This step is written from Nautobot's source and was NOT verified against Nautobot 3.2.",
    '2. 1-devices.csv (4 rows): Devices > Import, or POST it to /api/dcim/devices/ as text/csv. Every device is planned.',
    "3. 2-modules.csv (1 row): Modules > Import, or POST it to /api/dcim/modules/ as text/csv. This creates each card's ports, so it comes before the cables.",
    "4. 3-cables.csv (2 rows), with import_cables.py. DO NOT give 3-cables.csv to Nautobot's own importer: Nautobot takes a cable's ends by id only, and from a file that names them it creates cables with no ends.",
    '     export NAUTOBOT_TOKEN=...     (an API token; the script never prints it)',
    '     python3 import_cables.py 3-cables.csv             (a dry run: what it would create, and what it cannot find)',
    '     python3 import_cables.py 3-cables.csv --apply     (creates the cables)',
    "   A cable's purpose is not carried: a Nautobot cable has no description."])
    assert.ok(got.text.split('\n').includes(line), line);
  assert.deepEqual(got.notes, []);
  assert.ok(!got.text.includes('1-rack.csv'));
  // The script could not be fetched: the kit comes without it, and says where it is.
  const bare = D.kitReadme({target: 'nautobot', rack: README_RACK, date: DAY, dcim: {site: 'L', role: 'R'}, rows: {}, script: false});
  const gone = 'import_cables.py could not be fetched, so it is not in this zip. It is at https://portrayal.dev/site/rack/nautobot/import_cables.py.';
  assert.deepEqual(bare.notes, [gone]);
  assert.ok(bare.text.includes(`NOT IN THIS KIT:\n- ${gone}\n`) && !bare.text.includes('python3 import_cables.py'));
});

test('the files of a kit are numbered in import order', () => {
  assert.deepEqual(D.KIT_FILES, {
    netbox: {rack: '1-rack.csv', devices: '2-devices.csv', modules: '3-modules.csv', cables: '4-cables.csv'},
    nautobot: {devices: '1-devices.csv', modules: '2-modules.csv', cables: '3-cables.csv'}});
  assert.equal(D.KIT_SCRIPT, 'import_cables.py');
});
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `node --test tests/rack/dcim-import.test.mjs`
Expected: `# tests 21`, `# pass 17`, `# fail 4`: the four new tests, with `D.kitReadme is not a function` and, in the last, `D.KIT_FILES` being `undefined`.

- [ ] **Step 3: Write the README**

Append to the end of `site/rack/dcim-rules.js`:

```js

// ── README.txt (Phase 2c ruling 1) ──────────────────────────────────────
// What to do with each file, in order; what must already exist; and
// everything the kit could not carry. It replaces NOTES.txt and keeps its
// content (`notes`).
//   rows      how many rows each CSV holds: {rack, devices, modules, cables}
//   typeFiles how many YAML files are under types/
//   left      a sentence for each device, module and cable the files leave out
//   notes     what the types and the written rows need said (a best-guess type,
//             a length that was rounded)
//   script    whether import_cables.py is in the zip (Nautobot)
// Returns {text, notes}: `notes` are the lines the file carries beyond its
// instructions, which is what the page's status line counts.
export const KIT_FILES = {
  netbox: {rack: '1-rack.csv', devices: '2-devices.csv', modules: '3-modules.csv', cables: '4-cables.csv'},
  nautobot: {devices: '1-devices.csv', modules: '2-modules.csv', cables: '3-cables.csv'}};
export const KIT_SCRIPT = 'import_cables.py';
const isoDay = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const rowsText = n => (n ? `${n} ${n === 1 ? 'row' : 'rows'}` : 'no rows: it holds its header only, so skip it');

export function kitReadme({target = 'netbox', rack, date, dcim = {}, typeFiles = 0, manufacturers = [], rows = {},
                           left = [], notes = [], script = true}) {
  const nautobot = target === 'nautobot', T = TARGET_NAME[nautobot ? 'nautobot' : 'netbox'];
  const F = KIT_FILES[nautobot ? 'nautobot' : 'netbox'];
  const site = String(dcim?.site ?? '').trim(), role = String(dcim?.role ?? '').trim();
  const place = nautobot ? 'location' : 'site', cols = nautobot ? ['location__name', 'role__name'] : ['site', 'role'];
  const blank = [!site && cols[0], !role && cols[1]].filter(Boolean);
  const warning = blank.length
    ? `${F.devices} WILL BE REFUSED as it is: its ${blank.join(' and ')} ${blank.length === 1 ? 'column is' : 'columns are'} blank, and ` +
      `${T} requires ${blank.length === 1 ? 'it' : 'both'}.${!nautobot && !site ? ` ${F.rack}'s site column is blank too.` : ''} ` +
      `Set the ${[!site && place, !role && 'device role'].filter(Boolean).join(' and the ')} under Export, DCIM import settings, ` +
      `and export again; or fill ${blank.length === 1 ? 'that column' : 'those columns'} in by hand.`
    : '';
  const numbered = rack.frame.numbering === 'top-down' ? 'numbered from the top' : 'numbered from the bottom';
  const out = [`${T} import kit for ${rack.name}, from the Portrayal Rack Builder, ${isoDay(date)}.`, ''];
  if (warning) out.push(warning, '');

  out.push(`BEFORE YOU IMPORT, ${T} must already have:`);
  out.push(site ? `- the ${place} "${site}"${nautobot ? ', of a location type that allows devices and racks' : ''}`
                : `- a ${place}${nautobot ? ', of a location type that allows devices and racks' : ''} (none is set in this kit)`);
  out.push(role ? `- the ${nautobot ? 'role' : 'device role'} "${role}"${nautobot ? ', for devices' : ''}`
                : `- a ${nautobot ? 'role for devices' : 'device role'} (none is set in this kit)`);
  if (nautobot) out.push('- a status named Planned, for devices, modules and cables');
  if (manufacturers.length) out.push(`- these manufacturers: ${manufacturers.join(', ')}`);
  if (nautobot)
    out.push(`- the rack "${rack.name}" in that location: ${rack.frame.heightRU}U, ${numbered}` +
             `${rack.frame.numbering === 'top-down' ? ' (descending units)' : ''}. This kit has no rack file for Nautobot.`);
  out.push('');

  const types = `types/device-types/, then types/module-types/ (${typeFiles} ${typeFiles === 1 ? 'file' : 'files'})`;
  if (nautobot) {
    out.push('IMPORT IN THIS ORDER. Nautobot takes each CSV file whole or not at all.',
      typeFiles ? `1. ${types}: Device Types > Import and Module Types > Import, one YAML file per import. This step is written ` +
                  'from Nautobot\'s source and was NOT verified against Nautobot 3.2.'
                : '1. types/: no files, so there is nothing to import.',
      `2. ${F.devices} (${rowsText(rows.devices)}): Devices > Import, or POST it to /api/dcim/devices/ as text/csv. Every device is planned.`,
      `3. ${F.modules} (${rowsText(rows.modules)}): Modules > Import, or POST it to /api/dcim/modules/ as text/csv. ` +
        "This creates each card's ports, so it comes before the cables.",
      `4. ${F.cables} (${rowsText(rows.cables)}), with ${KIT_SCRIPT}. DO NOT give ${F.cables} to Nautobot's own importer: ` +
        'Nautobot takes a cable\'s ends by id only, and from a file that names them it creates cables with no ends.');
    if (script)
      out.push('     export NAUTOBOT_URL=https://nautobot.example.com',
        '     export NAUTOBOT_TOKEN=...     (an API token; the script never prints it)',
        `     python3 ${KIT_SCRIPT} ${F.cables}             (a dry run: what it would create, and what it cannot find)`,
        `     python3 ${KIT_SCRIPT} ${F.cables} --apply     (creates the cables)`,
        "   Python 3, standard library only. It talks to that URL's host and no other.");
    out.push("   A cable's purpose is not carried: a Nautobot cable has no description.", '');
  } else {
    out.push('IMPORT IN THIS ORDER. NetBox takes each CSV file whole or not at all: one refused row refuses the file.',
      typeFiles ? `1. ${types}: Device Types > Import and Module Types > Import, format YAML, one file at a time. ` +
                  'The module types must be in before step 4.'
                : '1. types/: no files, so there is nothing to import.',
      `2. ${F.rack} (${rowsText(rows.rack)}): Racks > Import. Creates the rack "${rack.name}", ${rack.frame.heightRU}U, ${numbered}.`,
      `3. ${F.devices} (${rowsText(rows.devices)}): Devices > Import. Every device is planned.`,
      `4. ${F.modules} (${rowsText(rows.modules)}): Modules > Import. This creates each card's ports, so it comes before the cables.`,
      `5. ${F.cables} (${rowsText(rows.cables)}): Cables > Import.`,
      '   NetBox finds a device by its name in every site, and a module type by its model in every manufacturer: a name it ' +
      'already has twice is refused as not unique.', '');
  }

  const missing = nautobot && !script
    ? [`${KIT_SCRIPT} could not be fetched, so it is not in this zip. It is at https://portrayal.dev/site/rack/nautobot/${KIT_SCRIPT}.`] : [];
  const gone = [...missing, ...left];
  out.push('NOT IN THIS KIT:', ...(gone.length ? gone.map(n => `- ${n}`) : ['- Nothing: every device, card and cable in this rack is in the files.']), '');
  if (notes.length) out.push('NOTES:', ...notes.map(n => `- ${n}`), '');
  return {text: `${out.join('\n').trimEnd()}\n`, notes: [...(warning ? [warning] : []), ...gone, ...notes]};
}
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `node --test tests/rack/*.test.mjs`
Expected: `# tests 183`, `# pass 183`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add site/rack/dcim-rules.js tests/rack/dcim-import.test.mjs
git commit -m "rack: a kit's README - what must exist, each file in import order, and what is left out

Its first lines say the devices file will be refused while the site or the
role is blank, and name the columns. Each file is listed with its row count,
or as empty. The Nautobot README says the rack and a Planned status must
exist, that its types step is not verified against 3.2, how to run
import_cables.py, and never to give the cables file to Nautobot's own
importer.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The DCIM import settings: two names in the rack file, and a panel form

Ruling 2: the Rack Builder asks for the site (NetBox) or location (Nautobot) and the device role, in a small "DCIM import settings" panel form reachable from the Export menu. The status is not asked: it is fixed to planned. The values are stored in the rack document, as a new optional `dcim: {site, role}` on the rack.

The ruling expects the loader to keep unknown fields. It does not: `parseDoc` builds each rack from the fields it knows and drops the rest. So this task reads `dcim` explicitly. **The format's version stays 1.** `parseDoc` refuses a newer version outright, which is for a change an older page would misread; an older page that opens a file with `dcim` reads the rack whole and loses only these two names when it saves. A rack that was never given the settings has no `dcim` key at all, so a file written before this task opens, and saves, exactly as it was.

**Files:**
- Create: `site/rack/dcim-form.js`
- Modify: `site/rack/model.js`, `site/rack-page.js`, `tests/rack/model.test.mjs`, `check-browser.py`

**Interfaces:**
- Consumes: `el` from `site/rack/dom.js`; in the page, `rack()`, `commit(nextRack)`, `select(sel)`, `S.focusNext`, `S.cable`, `paintCableMode()`, `renderExports`'s `act(kind, text, title)`.
- Produces:
  - `site/rack/model.js`: `dcimOf(rack)` → `{site, role}`, two trimmed strings, whatever the rack holds (`''` for anything that is not a string). `withDcim(rack, patch)` → a new rack whose `dcim` has the patch applied and trimmed; fields of `dcim` this page does not know are kept. `parseDoc` keeps a rack's `dcim` when it is an object, normalized the same way, and adds no `dcim` key otherwise.
  - `site/rack/dcim-form.js`: `dcimForm({rack, onChange, onDone})` → a `div#dcimForm` with `input#dSite`, `input#dRole`, `p#dHelp`, `p#dStatus` and `button#dDone`. `onChange({site})` or `onChange({role})` fires on a field's `change`.
  - The page: the Export menu gains `[data-export="dcim-settings"]`, "DCIM import settings", which opens the form in the side panel (`S.sel = {kind: 'dcim'}`), puts the keyboard in `#dSite`, and leaves Cable mode.

- [ ] **Step 1: Write the failing node tests**

In `tests/rack/model.test.mjs`, replace

```js

test('nextId counts only ids that carry its own prefix', () => {
```

with

```js

test('the DCIM import settings are optional: an old file opens unchanged, a new one keeps them', () => {
  const doc = extra => ({format: 'portrayal-rack', version: 1, id: 'doc-1',
    racks: [{id: 'r1', name: 'A', frame: {}, items: [], zeroU: [], cables: [], ...extra}]});
  // No `dcim` in the file: none in the rack, so saving it writes what was read.
  const old = M.parseDoc(doc({}));
  assert.equal('dcim' in old.racks[0], false);
  assert.deepEqual(M.parseDoc(M.serialize(old)), old);
  assert.deepEqual(M.dcimOf(old.racks[0]), {site: '', role: ''});
  // In the file: read as two trimmed strings, with anything else it holds kept.
  const kept = M.parseDoc(doc({dcim: {site: ' Lab 1 ', role: 7, tenant: 'acme'}})).racks[0];
  assert.deepEqual(kept.dcim, {site: 'Lab 1', role: '', tenant: 'acme'});
  // Not an object: not settings.
  for (const bad of ['Lab 1', ['Lab 1'], null, 3]) assert.equal('dcim' in M.parseDoc(doc({dcim: bad})).racks[0], false);
  // The format's version did not change for it.
  assert.equal(M.VERSION, 1);
});

test('withDcim sets one name and keeps the other, and returns a new rack', () => {
  const rack = M.newRack();
  assert.equal('dcim' in rack, false);
  const a = M.withDcim(rack, {site: ' Lab 1 '});
  assert.deepEqual(a.dcim, {site: 'Lab 1', role: ''});
  assert.equal('dcim' in rack, false);
  const b = M.withDcim({...a, dcim: {...a.dcim, tenant: 'acme'}}, {role: 'Router'});
  assert.deepEqual(b.dcim, {site: 'Lab 1', role: 'Router', tenant: 'acme'});
  assert.deepEqual(M.dcimOf(M.withDcim(b, {site: ''})), {site: '', role: 'Router'});
  assert.deepEqual(M.dcimOf({dcim: 'nonsense'}), {site: '', role: ''});
  assert.deepEqual(M.dcimOf(undefined), {site: '', role: ''});
});

test('nextId counts only ids that carry its own prefix', () => {
```

Run: `node --test tests/rack/model.test.mjs`
Expected: `# pass 12`, `# fail 2`: the two new tests ("…an old file opens unchanged, a new one keeps them" fails where `M.dcimOf` is not a function; "withDcim sets one name…" fails the same way).

- [ ] **Step 2: Write the failing browser check**

In `check-browser.py`, add before `def main():`

```python
@extra("rack.html: DCIM import settings - a panel form from the Export menu stores the site and role in the rack file; an old file is unchanged")
def check_rack_dcim_settings(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    open_fixture(page, base)
    saved = lambda: json.loads(pathlib.Path(export_file(page, "json").path()).read_text(encoding="utf-8"))["racks"][0]
    # A rack never given the settings has no such field: its file is what it was.
    if "dcim" in saved() or page.evaluate("() => 'dcim' in window.__rack.doc().racks[0]"):
        bad.append("settings: a rack that was never given them has a dcim field")

    page.click("#exportMenu > summary")
    page.click('#exportItems [data-export="dcim-settings"]')
    wait_sel(page, "settings: the form", "#dcimForm")
    if page.evaluate("() => document.getElementById('exportMenu').open"):
        bad.append("settings: the Export menu stayed open")
    wait_fn(page, "settings: the first field takes the keyboard", "() => document.activeElement?.id === 'dSite'")
    if page.input_value("#dSite") != "" or page.input_value("#dRole") != "":
        bad.append("settings: the fields of a new rack are not empty")
    if page.inner_text("#dStatus") != "Status: planned, for every device, module and cable.":
        bad.append(f"settings: the status line reads {page.inner_text('#dStatus')!r}")

    page.fill("#dSite", "  Lab <b>1</b>  ")
    page.dispatch_event("#dSite", "change")
    wait_fn(page, "settings: the site is in the document, trimmed",
            "() => window.__rack.doc().racks[0].dcim?.site === 'Lab <b>1</b>'")
    # The panel is rebuilt by the commit: the field is there again, with its value as text, and no markup was made of it.
    wait_fn(page, "settings: the form shows the stored site", "() => document.getElementById('dSite')?.value === 'Lab <b>1</b>'")
    if page.query_selector("#side b"):
        bad.append("settings: a name was read as markup")
    page.fill("#dRole", "Router")
    page.dispatch_event("#dRole", "change")
    wait_fn(page, "settings: the role is in the document", "() => window.__rack.doc().racks[0].dcim?.role === 'Router'")
    got = saved()
    if got.get("dcim") != {"site": "Lab <b>1</b>", "role": "Router"}:
        bad.append(f"settings: the rack file holds {got.get('dcim')!r}")

    # A field of a panel built for an earlier rack acts on the rack as it is now.
    page.evaluate("""() => {
      window.__stale = document.getElementById('dRole');
      const r = window.__rack.doc().racks[0];
      window.__rack.replaceRack({...r, name: 'Renamed since'});
    }""")
    wait_fn(page, "settings: the rename landed", "() => window.__rack.doc().racks[0].name === 'Renamed since'")
    page.evaluate("() => { window.__stale.value = 'Switch'; window.__stale.dispatchEvent(new Event('change')); }")
    wait_fn(page, "settings: a stale field's change landed", "() => window.__rack.doc().racks[0].dcim?.role === 'Switch'")
    now = page.evaluate("() => { const r = window.__rack.doc().racks[0]; return [r.name, r.dcim.site, r.items.length]; }")
    if now != ["Renamed since", "Lab <b>1</b>", 4]:
        bad.append(f"settings: a stale field wrote over the rack as it was: {now}")

    page.click("#dDone")
    wait_fn(page, "settings: Done closes the form", "() => !document.getElementById('dcimForm')")
    # Reopened, in Cable mode: the form shows what is stored, and the mode is left.
    page.click("#cableBtn")
    page.click("#exportMenu > summary")
    page.click('#exportItems [data-export="dcim-settings"]')
    wait_fn(page, "settings: reopened with the stored names",
            "() => document.getElementById('dSite')?.value === 'Lab <b>1</b>' && document.getElementById('dRole')?.value === 'Switch'")
    if page.get_attribute("#cableBtn", "aria-pressed") != "false":
        bad.append("settings: opening the form left Cable mode on")
    return bad
```

Run: `python3 check-browser.py --only check_rack_dcim_settings`
Expected: `FAIL`, "Page.click: Timeout 30000ms exceeded." The menu has no such entry yet.

- [ ] **Step 3: The settings in the document**

In `site/rack/model.js`, replace

```js
export const renamed = (rack, name) => ({...rack, name: String(name)});
```

with

```js
export const renamed = (rack, name) => ({...rack, name: String(name)});

// DCIM IMPORT SETTINGS (Phase 2c ruling 2): the names a NetBox or Nautobot
// import needs and a rack does not otherwise know. `site` is NetBox's site and
// Nautobot's location; `role` is the device role. An OPTIONAL field of a rack:
// a rack that was never given them has no `dcim` key at all, so a file written
// before this field existed opens, and saves, exactly as it was. dcimOf reads
// it whatever is there: two trimmed strings.
const plain = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const word = v => (typeof v === 'string' ? v.trim() : '');
export const dcimOf = rack => ({site: word(plain(rack?.dcim).site), role: word(plain(rack?.dcim).role)});
// Fields of `dcim` this page does not know are kept as they are.
export const withDcim = (rack, patch) =>
  ({...rack, dcim: {...plain(rack.dcim), ...dcimOf({dcim: {...plain(rack.dcim), ...patch}})}});
```

In `site/rack/model.js`, replace

```js
      cables: readCables(Array.isArray(r.cables) ? r.cables : []),
    })),
```

with

```js
      cables: readCables(Array.isArray(r.cables) ? r.cables : []),
      // Optional, and only when the file has it (dcimOf): no version bump, since a
      // page that does not know the field reads the rack whole and loses two names.
      ...(r.dcim && typeof r.dcim === 'object' && !Array.isArray(r.dcim)
        ? {dcim: {...structuredClone(r.dcim), ...dcimOf(r)}} : {}),
    })),
```

Run: `node --test tests/rack/*.test.mjs`
Expected: `# tests 185`, `# pass 185`, `# fail 0`.

- [ ] **Step 4: The form**

Create `site/rack/dcim-form.js`:

```js
// DCIM IMPORT SETTINGS, as a form (Phase 2c ruling 2). NetBox needs a site and
// a device role on every device, Nautobot a location and a role; the rack
// knows neither, so it asks. Like frame-form.js, this builds elements and
// reports what the user did; the page decides what a change means. The names
// are stored in the rack file (model.js dcimOf) and written into the import
// kits' files as typed. The status is not asked: everything is planned.

import {el} from './dom.js';
import {dcimOf} from './model.js';

export function dcimForm({rack, onChange, onDone}) {
  const d = dcimOf(rack);
  const field = (label, control) => el('label', {}, [label, control]);
  const site = el('input', {id: 'dSite', type: 'text', value: d.site, autocomplete: 'off', 'aria-describedby': 'dHelp'});
  site.addEventListener('change', () => onChange({site: site.value}));
  const role = el('input', {id: 'dRole', type: 'text', value: d.role, autocomplete: 'off', 'aria-describedby': 'dHelp'});
  role.addEventListener('change', () => onChange({role: role.value}));
  const done = el('button', {type: 'button', id: 'dDone', text: 'Done'});
  done.addEventListener('click', onDone);
  return el('div', {id: 'dcimForm', class: 'rk-dcim'}, [
    el('h3', {text: 'DCIM import settings'}),
    field('Site (NetBox) or location (Nautobot)', site),
    field('Device role', role),
    el('p', {id: 'dHelp', class: 'rk-muted',
             text: 'The names as your NetBox or Nautobot has them. They go into the import kits as typed; both must exist there before you import. Left empty, the kit still exports and its README says which columns to fill in.'}),
    el('p', {id: 'dStatus', class: 'rk-muted', text: 'Status: planned, for every device, module and cable.'}),
    el('div', {class: 'rk-actions'}, [done]),
  ]);
}
```

A name is put in an input's `value` and nowhere else, so a name with markup in it stays text. No new CSS: `.rk-side label`, `.rk-side input`, `.rk-side .rk-muted` and `.rk-actions` already style it.

- [ ] **Step 5: Wire it into the page**

In `site/rack-page.js`, replace

```js
import {newDoc, nextRackName, withFrame, renamed, positionOf, withItem, updateItem, withoutItem} from './rack/model.js';
import {openLibrary, autosaver, downloadDoc, readDocFile} from './rack/library.js';
import {drawElevation, uAtY, panelFor} from './rack/elevation.js';
import {fits, reaches, availableDepth, itemsWithU, heightOf, shrinkRack} from './rack/fit.js';
import {loadChassis, chassisLookup, catalogEntries} from './rack/chassis.js';
import {frameForm} from './rack/frame-form.js';
```

with

```js
import {newDoc, nextRackName, withFrame, renamed, positionOf, withItem, updateItem, withoutItem, dcimOf, withDcim} from './rack/model.js';
import {openLibrary, autosaver, downloadDoc, readDocFile} from './rack/library.js';
import {drawElevation, uAtY, panelFor} from './rack/elevation.js';
import {fits, reaches, availableDepth, itemsWithU, heightOf, shrinkRack} from './rack/fit.js';
import {loadChassis, chassisLookup, catalogEntries} from './rack/chassis.js';
import {frameForm} from './rack/frame-form.js';
import {dcimForm} from './rack/dcim-form.js';
```

In `site/rack-page.js`, replace

```js
let exporting = false;
async function runExport(kind) {
  if (kind === 'json') { downloadDoc(S.doc); return; }
  if (kind === 'to-3d') { setMode('3d'); return; }
```

with

```js
// The DCIM import settings are a form in the side panel, as the frame's is: a
// different activity from Cable mode, so opening it turns that off.
function openDcimSettings() {
  if (S.cable.on) { S.cable = {on: false, a: null}; paintCableMode(); }
  S.focusNext = 'dSite';
  select({kind: 'dcim'});
}
let exporting = false;
async function runExport(kind) {
  if (kind === 'json') { downloadDoc(S.doc); return; }
  if (kind === 'to-3d') { setMode('3d'); return; }
  if (kind === 'dcim-settings') { openDcimSettings(); return; }
```

In `site/rack-page.js`, replace

```js
    el('hr'),
    act('netbox-types', 'NetBox device types (.zip)'),
```

with

```js
    el('hr'),
    act('dcim-settings', 'DCIM import settings', 'The site or location and the device role the NetBox and Nautobot files name'),
    act('netbox-types', 'NetBox device types (.zip)'),
```

In `site/rack-page.js`, replace

```js
    onFrame: patch => commitFrame(patch)});
  else if (sel.kind === 'u') body = catalogPanel({entries: S.entries, rack: r, face: sel.face, ru: sel.ru,
```

with

```js
    onFrame: patch => commitFrame(patch)});
  else if (sel.kind === 'dcim') body = dcimForm({rack: r,
    // The rack as it is when a field changes, not as it was when the form was
    // built. A change that leaves the settings as they are commits nothing: a
    // field removed while it has focus can fire 'change' a second time.
    onChange: patch => {
      const now = rack(), next = withDcim(now, patch);
      if (JSON.stringify(dcimOf(next)) !== JSON.stringify(dcimOf(now))) commit(next);
    },
    onDone: () => select(null)});
  else if (sel.kind === 'u') body = catalogPanel({entries: S.entries, rack: r, face: sel.face, ru: sel.ru,
```

The form's `onChange` reads `rack()` when a field changes, so a field of a panel built for an earlier rack writes to the rack as it is now. A settings change commits a rack whose `items`, `frame` and `cables` are the same objects, so the 3D scene is kept.

- [ ] **Step 6: Run the checks and see them pass**

Run: `python3 check-browser.py --only check_rack_dcim_settings,check_rack_frame_focus,check_rack_export_empty`
Expected: three `ok` lines.

- [ ] **Step 7: Commit**

```bash
git add site/rack/model.js site/rack/dcim-form.js site/rack-page.js tests/rack/model.test.mjs check-browser.py
git commit -m "rack: DCIM import settings - the site or location and the device role, kept in the rack file

A panel form, opened from the Export menu, asks for the two names a NetBox or
Nautobot import needs and a rack does not know. They are stored as an optional
dcim field of the rack. A rack never given them has no such field, so an older
file opens and saves unchanged, and the format's version stays 1.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `import_cables.py`: the script that creates the cables in Nautobot

Ruling 7. Nautobot cannot import a cable by its ends' names, and a name-based row is silently created unconnected. So the Nautobot kit ships `3-cables.csv` (Task 3's rows) and this script: Python 3, standard library only, run by the user against their Nautobot with `NAUTOBOT_URL` and `NAUTOBOT_TOKEN` in the environment. It looks up each end's id through the REST API and creates the cable by id.

What it must do, each of which a test pins:
- **A dry run by default**: it prints what it would create and what it cannot find, and sends no POST. It creates only with `--apply`.
- **It never prints the token**, and sends it only in the `Authorization` header of requests to the host in `NAUTOBOT_URL`.
- **It talks only to that host**: no redirect is followed, no proxy is used, a paginated list's `next` is asked for on that host whatever host it names, and a URL that carries credentials is refused.
- **It reports each row**, and exits 0 when every row was (or would be) created, 1 when one could not be, 2 when it could not start.
- It creates each cable exactly as the real Nautobot 3.2.6 accepted one: a `text/csv` POST to `/api/dcim/cables/` with `termination_a_type,termination_a_id,termination_b_type,termination_b_id,status__name` and only the other columns that have a value. It checks that the cable came back with its ends, and says so loudly if it did not.
- A port that already has a cable is left alone, so a second run after a partial one is safe.
- It lists a device's ports with `?device=<name>`, the filter the real instance honored, and first checks that the filter is honored at all: a device name nothing has must list nothing. A Nautobot that ignored the filter would let a port be taken from the wrong device.

The script lives at `site/rack/nautobot/import_cables.py`, a real file the site serves; Task 7 fetches it into the zip. Its tests run it against a mock Nautobot, a local HTTP server that answers in the shapes `result.json` records. `check-contract.py` runs those tests, so the pre-push hook and CI's "contract and modules" job run them with no change to either.

**Files:**
- Create: `site/rack/nautobot/import_cables.py`
- Create: `tests/rack/import_cables_test.py`
- Modify: `check-contract.py`

**Interfaces:**
- Consumes: the columns of Task 3's `CABLE_IMPORT_COLUMNS.nautobot`: `a_device, a_type, a_name, b_device, b_type, b_name, type, status, label, color, length, length_unit`.
- Produces: `site/rack/nautobot/import_cables.py`, run as `python3 import_cables.py [3-cables.csv] [--apply]`. For its tests it exposes `main(argv=None, env=None, out=None)` → exit code, `Api(base, token)` and `Stop`.

- [ ] **Step 1: Write the failing tests**

Create `tests/rack/import_cables_test.py`:

```python
#!/usr/bin/env python3
"""Tests of site/rack/nautobot/import_cables.py against a mock Nautobot.

    python3 tests/rack/import_cables_test.py

The mock is a local HTTP server that answers the few REST calls the script
makes, in the shapes a real Nautobot 3.2.6 gave (the verification run of
2026-10-04): a paginated list for a GET, a JSON list for a text/csv POST. No
real Nautobot is contacted, and the token used here is made up.
"""
import contextlib
import http.server
import importlib.util
import io
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import threading
import unittest
import urllib.parse

HERE = pathlib.Path(__file__).resolve().parent
SCRIPT = HERE.parent.parent / 'site' / 'rack' / 'nautobot' / 'import_cables.py'
spec = importlib.util.spec_from_file_location('import_cables', SCRIPT)
import_cables = importlib.util.module_from_spec(spec)
spec.loader.exec_module(import_cables)

TOKEN = 'made-up-token-0123456789abcdef'
HEADER = 'a_device,a_type,a_name,b_device,b_type,b_name,type,status,label,color,length,length_unit\n'
GOOD = HEADER + ('leaf-1,dcim.interface,port-1,core-1,dcim.interface,slot-2/p0,smf-os2,Planned,A1,,2,m\n'
                 'leaf-1,dcim.interface,mgmt-eth,demarc-i3,dcim.interface,port-2-1,cat6a,Planned,c2,,,\n')


class Mock:
    """What the mock Nautobot holds, and what it was asked."""

    def __init__(self):
        self.devices = ['core-1', 'leaf-1', 'demarc-i3']
        self.ports = {  # (list, device) -> names
            ('interfaces', 'leaf-1'): ['port-1', 'port-2', 'mgmt-eth'],
            ('interfaces', 'core-1'): ['slot-2/p0', 'slot-2/p1'],
            ('interfaces', 'demarc-i3'): ['port-2-1'],
            ('console-ports', 'demarc-i3'): ['Console']}
        self.cabled = set()          # port ids that already have a cable
        self.requests = []           # (method, path, headers, body)
        self.ignore_device_filter = False
        self.drop_ends = False       # create the cable without its ends, as a name-based import does
        self.redirect = None
        self.page_size = 1000

    def port_id(self, lst, device, name):
        return '%s:%s:%s' % (lst, device, name)


def handler(mock):
    class H(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def send(self, code, data, headers=None):
            body = json.dumps(data).encode()
            self.send_response(code)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            for k, v in (headers or {}).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(body)

        def record(self, body=''):
            mock.requests.append((self.command, self.path, dict(self.headers), body))
            if mock.redirect:
                self.send(302, {}, {'Location': mock.redirect})
                return False
            if self.headers.get('Authorization') != 'Token ' + TOKEN:
                self.send(403, {'detail': 'Invalid token.'})
                return False
            return True

        def do_GET(self):
            if not self.record():
                return
            u = urllib.parse.urlsplit(self.path)
            q = {k: v[0] for k, v in urllib.parse.parse_qs(u.query).items()}
            lst = u.path.strip('/').split('/')[-1]
            if lst == 'devices':
                rows = [{'id': 'dev:' + d, 'name': d} for d in mock.devices if d == q.get('name')]
            else:
                device = q.get('device')
                if device not in mock.devices and not mock.ignore_device_filter:
                    return self.send(400, {'device': ['Select a valid choice. %s is not one of the available choices.' % device]})
                rows = [{'id': mock.port_id(l, d, n), 'name': n, 'cable': {'id': 'x'} if mock.port_id(l, d, n) in mock.cabled else None}
                        for (l, d), names in mock.ports.items() for n in names
                        if l == lst and (mock.ignore_device_filter or d == device)]
            offset = int(q.get('offset', 0))
            page, more = rows[offset:offset + mock.page_size], offset + mock.page_size < len(rows)
            nxt = None
            if more:
                q['offset'] = str(offset + mock.page_size)
                nxt = 'http://another-name.invalid%s?%s' % (u.path, urllib.parse.urlencode(q))   # as behind a proxy
            self.send(200, {'count': len(rows), 'next': nxt, 'results': page})

        def do_POST(self):
            body = self.rfile.read(int(self.headers.get('Content-Length') or 0)).decode()
            if not self.record(body):
                return
            if self.headers.get('Content-Type') != 'text/csv' or self.path != '/api/dcim/cables/':
                return self.send(400, {'detail': 'not a CSV cable import'})
            head, row = [l.split(',') for l in body.strip().split('\n')]
            d = dict(zip(head, row))
            if d.get('length') and not d['length'].isdigit():
                return self.send(400, [{'length': ['A valid integer is required.']}])
            made = {'id': 'cable-%d' % len(mock.requests), 'label': d.get('label', ''),
                    'termination_a_type': d['termination_a_type'], 'termination_a_id': d['termination_a_id'],
                    'termination_b_type': d['termination_b_type'], 'termination_b_id': d['termination_b_id']}
            if mock.drop_ends:
                made.update(termination_a_type=None, termination_a_id=None, termination_b_type=None, termination_b_id=None)
            else:
                mock.cabled.update([d['termination_a_id'], d['termination_b_id']])
            self.send(201, [made])
    return H


class ImportCables(unittest.TestCase):
    def setUp(self):
        self.mock = Mock()
        self.server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler(self.mock))
        threading.Thread(target=self.server.serve_forever, kwargs={'poll_interval': 0.01}, daemon=True).start()
        self.url = 'http://127.0.0.1:%d' % self.server.server_address[1]
        self.dir = tempfile.TemporaryDirectory()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.dir.cleanup()

    def csv(self, text):
        path = os.path.join(self.dir.name, '3-cables.csv')
        with open(path, 'w', encoding='utf-8', newline='') as f:
            f.write(text)
        return path

    def run_script(self, text=GOOD, *flags, env=None):
        out, err = io.StringIO(), io.StringIO()
        env = {'NAUTOBOT_URL': self.url, 'NAUTOBOT_TOKEN': TOKEN} if env is None else env
        with contextlib.redirect_stderr(err):
            code = import_cables.main(['import_cables.py', self.csv(text), *flags], env, out)
        return code, out.getvalue(), err.getvalue()

    def posts(self):
        return [r for r in self.mock.requests if r[0] == 'POST']

    def test_a_dry_run_creates_nothing_and_says_what_it_would(self):
        code, out, err = self.run_script()
        self.assertEqual((code, err), (0, ''))
        self.assertEqual(self.posts(), [])
        self.assertTrue(all(m == 'GET' for m, *_ in self.mock.requests))
        lines = out.strip().split('\n')
        self.assertEqual(lines[0], 'Nautobot at %s. A dry run: nothing is created. Add --apply to create the cables.' % self.url[7:])
        self.assertEqual(lines[1], 'row 1 A1: would connect leaf-1 port-1 to core-1 slot-2/p0 (smf-os2, 2 m, Planned).')
        self.assertEqual(lines[2], 'row 2 c2: would connect leaf-1 mgmt-eth to demarc-i3 port-2-1 (cat6a, Planned).')
        self.assertEqual(lines[3], '2 rows: 2 would be created, 0 cannot be. Nothing was created.')

    def test_apply_creates_each_cable_by_id_as_the_real_instance_took_it(self):
        code, out, _ = self.run_script(GOOD, '--apply')
        self.assertEqual(code, 0)
        posts = self.posts()
        self.assertEqual([p[1] for p in posts], ['/api/dcim/cables/'] * 2)
        self.assertEqual(posts[0][2].get('Content-Type'), 'text/csv')
        # The columns Nautobot 3.2.6 accepted (cables_good): ends by type and id, status by name.
        self.assertEqual(posts[0][3],
                         'termination_a_type,termination_a_id,termination_b_type,termination_b_id,status__name,type,label,length,length_unit\n'
                         'dcim.interface,interfaces:leaf-1:port-1,dcim.interface,interfaces:core-1:slot-2/p0,Planned,smf-os2,A1,2,m\n')
        # A blank cell is left out with its column rather than sent blank.
        self.assertEqual(posts[1][3],
                         'termination_a_type,termination_a_id,termination_b_type,termination_b_id,status__name,type,label\n'
                         'dcim.interface,interfaces:leaf-1:mgmt-eth,dcim.interface,interfaces:demarc-i3:port-2-1,Planned,cat6a,c2\n')
        self.assertIn('row 1 A1: connected leaf-1 port-1 to core-1 slot-2/p0 (smf-os2, 2 m, Planned).', out)
        self.assertTrue(out.strip().endswith('2 rows: 2 created, 0 not.'))

    def test_what_it_cannot_find_is_reported_per_row_and_the_rest_still_goes(self):
        text = HEADER + ('leaf-1,dcim.interface,port-9,core-1,dcim.interface,slot-2/p0,smf-os2,Planned,missing-port,,,\n'
                         'nobody,dcim.interface,port-1,core-1,dcim.interface,slot-2/p0,smf-os2,Planned,missing-device,,,\n'
                         'demarc-i3,dcim.consoleport,Console,leaf-1,dcim.nonsense,port-1,,Planned,odd-kind,,,\n'
                         'leaf-1,dcim.interface,port-1,core-1,dcim.interface,slot-2/p0,smf-os2,Planned,fine,,1.5,ft\n'
                         'leaf-1,dcim.interface,port-1,core-1,dcim.interface,slot-2/p0,smf-os2,Planned,A1,,,\n'
                         'leaf-1,dcim.interface,port-1,core-1,dcim.interface,slot-2/p1,smf-os2,Planned,again,,,\n')
        code, out, _ = self.run_script(text, '--apply')
        self.assertEqual(code, 1)
        self.assertIn('row 1 missing-port: cannot connect leaf-1 port-9 to core-1 slot-2/p0 (smf-os2, Planned): '
                      'leaf-1 has no interface named port-9.', out)
        self.assertIn('there is no device named nobody.', out)
        self.assertIn('row 3 odd-kind: cannot connect demarc-i3 Console to leaf-1 port-1 (Planned): '
                      'dcim.nonsense is not a kind of end this script knows.', out)
        self.assertIn('row 4 fine: cannot connect leaf-1 port-1 to core-1 slot-2/p0 (smf-os2, 1.5 ft, Planned): '
                      'its length 1.5 is not a whole number, and Nautobot takes only whole numbers.', out)
        self.assertIn('row 5 A1: connected', out)
        # One port, one cable: the row after it finds the port taken.
        self.assertIn('row 6 again: cannot connect leaf-1 port-1 to core-1 slot-2/p1 (smf-os2, Planned): leaf-1 port-1 already has a cable.', out)
        self.assertEqual(len(self.posts()), 1)
        self.assertTrue(out.strip().endswith('6 rows: 1 created, 5 not.'))

    def test_a_port_that_already_has_a_cable_is_left_alone_so_a_second_run_is_safe(self):
        self.assertEqual(self.run_script(GOOD, '--apply')[0], 0)
        self.mock.requests.clear()
        code, out, _ = self.run_script(GOOD, '--apply')
        self.assertEqual((code, self.posts()), (1, []))
        self.assertIn('leaf-1 port-1 already has a cable; core-1 slot-2/p0 already has a cable.', out)

    def test_a_cable_created_without_its_ends_is_not_called_connected(self):
        self.mock.drop_ends = True
        code, out, _ = self.run_script(GOOD, '--apply')
        self.assertEqual(code, 1)
        self.assertIn('WITHOUT ITS ENDS. Delete it in Nautobot; it connects nothing.', out)
        self.assertNotIn(': connected ', out)

    def test_the_token_is_never_printed(self):
        for flags in ((), ('--apply',)):
            code, out, err = self.run_script(GOOD + 'nobody,dcim.interface,x,core-1,dcim.interface,y,,,z,,,\n', *flags)
            self.assertNotIn(TOKEN, out + err)
        # Not even when Nautobot refuses it, or echoes it back.
        code, out, err = self.run_script(env={'NAUTOBOT_URL': self.url, 'NAUTOBOT_TOKEN': 'wrong-' + TOKEN})
        self.assertEqual(code, 2)
        self.assertNotIn(TOKEN, out + err)
        self.assertIn('Nautobot refused the token (HTTP 403).', err)
        self.assertTrue(all(h.get('Authorization', '').startswith('Token ') for _, _, h, _ in self.mock.requests))

    def test_it_talks_to_one_host_only(self):
        # A redirect is not followed, wherever it points.
        self.mock.redirect = 'http://elsewhere.invalid/api/'
        code, out, err = self.run_script()
        self.assertEqual(code, 2)
        self.assertIn('Nautobot answered with a redirect (HTTP 302). Set NAUTOBOT_URL to the address it answers at.', err)
        self.mock.redirect = None
        # A "next" page that names another host is asked for on this one.
        self.mock.page_size = 1
        code, out, _ = self.run_script()
        self.assertEqual(code, 0, out)
        api = import_cables.Api(self.url, TOKEN)
        with self.assertRaises(import_cables.Stop):
            api.url('http://elsewhere.invalid/api/dcim/cables/')
        # A URL that carries credentials, or is not http, is refused before any request.
        self.mock.requests.clear()
        for bad in ('http://user:pw@127.0.0.1:1', 'ftp://127.0.0.1', '', 'nautobot.example.com'):
            self.assertEqual(self.run_script(env={'NAUTOBOT_URL': bad, 'NAUTOBOT_TOKEN': TOKEN})[0], 2)
        self.assertEqual(self.run_script(env={'NAUTOBOT_URL': self.url})[2].strip(), 'NAUTOBOT_TOKEN is not set.')
        self.assertEqual(self.mock.requests, [])

    def test_a_nautobot_that_ignores_the_device_filter_stops_the_run(self):
        self.mock.ignore_device_filter = True
        code, out, err = self.run_script(GOOD, '--apply')
        self.assertEqual((code, self.posts()), (2, []))
        self.assertIn('ignores the device filter', err)

    def test_a_file_that_is_not_the_kits_is_refused_with_a_sentence(self):
        code, _, err = self.run_script('side_a_device,side_a_type,side_a_name\nx,y,z\n')
        self.assertEqual(code, 2)
        self.assertIn("is not the Rack Builder's 3-cables.csv: it has no a_device, a_type, a_name, b_device, b_type, b_name column.", err)
        self.assertEqual(self.run_script(HEADER)[1].strip().split('\n')[-1], '0 rows: 0 would be created, 0 cannot be. Nothing was created.')
        with contextlib.redirect_stderr(io.StringIO()) as err:
            self.assertEqual(import_cables.main(['import_cables.py', 'a.csv', '--delete'], {}, io.StringIO()), 2)
        self.assertEqual(err.getvalue().strip(), 'usage: python3 import_cables.py [3-cables.csv] [--apply]')

    def test_it_runs_as_a_program_with_the_standard_library_alone(self):
        r = subprocess.run([sys.executable, '-I', str(SCRIPT), self.csv(GOOD)], capture_output=True, text=True,
                           env={'NAUTOBOT_URL': self.url, 'NAUTOBOT_TOKEN': TOKEN, 'PATH': os.environ.get('PATH', '')})
        self.assertEqual((r.returncode, r.stderr), (0, ''))
        self.assertIn('2 rows: 2 would be created, 0 cannot be. Nothing was created.', r.stdout)


if __name__ == '__main__':
    unittest.main(verbosity=1)
```

- [ ] **Step 2: Have the contract check run them, and check the script is served**

In `check-contract.py`, replace

```python

# ── report ───────────────────────────────────────────────────────────────
```

with

```python

# ── the Nautobot cable import script (Rack Builder Phase 2c) ─────────────────
# Nautobot cannot import a cable by its ends' names, so the Rack Builder's
# Nautobot kit carries a script that looks the ends up and creates each cable
# by id. It is a real file, site/rack/nautobot/import_cables.py, which the page
# fetches into the zip - so it must be served, and it is tested here, against
# a mock Nautobot, on every push and in CI: nobody runs it by hand until a
# user does, against their own instance.
_ict = HERE / "tests" / "rack" / "import_cables_test.py"
_icr = _sp.run([sys.executable, str(_ict)], capture_output=True, text=True) if _ict.is_file() else None
check(_icr is not None and _icr.returncode == 0,
      "site/rack/nautobot/import_cables.py passes its tests against a mock Nautobot",
      (_icr.stderr[-600:] if _icr else "no tests/rack/import_cables_test.py"))
check("site/rack/nautobot/import_cables.py" in _srv,
      "the build serves site/rack/nautobot/import_cables.py, which the Nautobot kit fetches",
      "the file is not tracked, or tools/build-public.py does not copy it")

# ── report ───────────────────────────────────────────────────────────────
```

- [ ] **Step 3: Run both and see them fail**

Run: `python3 tests/rack/import_cables_test.py`
Expected: it stops before any test: `FileNotFoundError: [Errno 2] No such file or directory: '…/site/rack/nautobot/import_cables.py'`.

Run: `python3 check-contract.py`
Expected: `contract: 296 checks passed, 2 FAILED`, the two being "site/rack/nautobot/import_cables.py passes its tests against a mock Nautobot" and "the build serves site/rack/nautobot/import_cables.py, which the Nautobot kit fetches".

- [ ] **Step 4: Write the script**

Create `site/rack/nautobot/import_cables.py`:

```python
#!/usr/bin/env python3
"""Create a rack's cables in Nautobot from the Portrayal Rack Builder's 3-cables.csv.

Nautobot cannot import a cable whose ends are given by name: its importer takes
each end by id, and from a file that names the ends it creates cables with no
ends at all. So the Rack Builder's Nautobot kit carries a file that names each
end (device, kind of port, port name) and this script, which looks each end up
through Nautobot's REST API and creates the cable by id.

    export NAUTOBOT_URL=https://nautobot.example.com
    export NAUTOBOT_TOKEN=...                        # an API token; never printed
    python3 import_cables.py 3-cables.csv            # a dry run: nothing is created
    python3 import_cables.py 3-cables.csv --apply    # create the cables

Import the kit's devices and modules first: a card's ports exist only once its
module is in its bay. Python 3, standard library only. The script talks to the
host in NAUTOBOT_URL and to no other, follows no redirect, and uses no proxy.
It reports every row. It exits 0 when every row was (or, in a dry run, would
be) created, 1 when a row could not be, and 2 when it could not start.
"""
import csv
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid

COLUMNS = ['a_device', 'a_type', 'a_name', 'b_device', 'b_type', 'b_name', 'type', 'status', 'label', 'color',
           'length', 'length_unit']
REQUIRED = COLUMNS[:6]
# The kinds of end a row can name, and the REST list each is found in.
ENDPOINTS = {
    'dcim.interface': 'interfaces', 'dcim.frontport': 'front-ports', 'dcim.rearport': 'rear-ports',
    'dcim.consoleport': 'console-ports', 'dcim.consoleserverport': 'console-server-ports',
    'dcim.powerport': 'power-ports', 'dcim.poweroutlet': 'power-outlets'}
KIND = {'dcim.interface': 'interface', 'dcim.frontport': 'front port', 'dcim.rearport': 'rear port',
        'dcim.consoleport': 'console port', 'dcim.consoleserverport': 'console server port',
        'dcim.powerport': 'power port', 'dcim.poweroutlet': 'power outlet'}
TIMEOUT = 60


class Stop(Exception):
    """The script cannot go on; the message says why."""


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class Api:
    """Nautobot's REST API at one host. The token goes in the Authorization
    header of requests to that host and nowhere else."""

    def __init__(self, base, token):
        base = (base or '').strip().rstrip('/')
        u = urllib.parse.urlsplit(base)
        if u.scheme not in ('http', 'https') or not u.netloc:
            raise Stop('NAUTOBOT_URL must be an http or https address, such as https://nautobot.example.com.')
        if u.username or u.password or '@' in u.netloc:
            raise Stop('NAUTOBOT_URL must not carry a user name or a password.')
        if not token:
            raise Stop('NAUTOBOT_TOKEN is not set.')
        self.base, self.scheme, self.netloc, self.token = base, u.scheme, u.netloc, token
        # No proxy and no redirect: every request goes to this host itself.
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    def clean(self, text):
        return str(text).replace(self.token, '***')

    def url(self, path):
        full = path if path.startswith(('http://', 'https://')) else self.base + path
        u = urllib.parse.urlsplit(full)
        if (u.scheme, u.netloc) != (self.scheme, self.netloc):
            raise Stop('Refused to contact %s://%s: it is not the host in NAUTOBOT_URL.' % (u.scheme, u.netloc))
        return full

    def request(self, method, path, body=None, content_type='application/json'):
        req = urllib.request.Request(self.url(path), data=body, method=method, headers={
            'Authorization': 'Token ' + self.token, 'Accept': 'application/json', 'Content-Type': content_type,
            'User-Agent': 'portrayal-import-cables/1'})
        try:
            with self.opener.open(req, timeout=TIMEOUT) as r:
                status, raw = r.status, r.read()
        except urllib.error.HTTPError as e:
            status, raw = e.code, e.read() or b''
            if status in (301, 302, 303, 307, 308):
                raise Stop('Nautobot answered with a redirect (HTTP %s). Set NAUTOBOT_URL to the address it answers at.' % status)
        except (urllib.error.URLError, OSError) as e:
            raise Stop('Could not reach Nautobot: %s' % self.clean(getattr(e, 'reason', e)))
        text = raw.decode('utf-8', 'replace')
        try:
            return status, json.loads(text), text
        except ValueError:
            return status, None, text

    def listing(self, path, query):
        """Every result of a paginated list, or (None, why)."""
        out, nxt = [], '%s?%s' % (path, urllib.parse.urlencode(query))
        for _ in range(100):
            status, data, text = self.request('GET', nxt)
            if status in (401, 403):
                raise Stop('Nautobot refused the token (HTTP %s).' % status)
            if status != 200 or not isinstance(data, dict):
                return None, 'HTTP %s: %s' % (status, self.clean(text)[:300])
            out.extend(data.get('results') or [])
            nxt = data.get('next')
            if not nxt:
                return out, None
            u = urllib.parse.urlsplit(nxt)          # a proxy in front may report another scheme or host: keep the path
            nxt = u.path + ('?' + u.query if u.query else '')
        return None, 'the list did not end after 100 pages'


class Finder:
    """Finds a row's ends. A device is looked up by its name, which must be one
    device; its ports are listed once per kind and kept."""

    def __init__(self, api):
        self.api, self.devices, self.ports = api, {}, {}

    def check_filters(self):
        """A device filter this Nautobot ignores would list every device's
        ports, and a port could then be taken from the wrong device. A name
        nothing has must list nothing."""
        nobody = 'portrayal-no-such-device-' + uuid.uuid4().hex
        found, _ = self.api.listing('/api/dcim/interfaces/', {'device': nobody, 'limit': 1, 'depth': 0})
        if found:
            raise Stop('This Nautobot ignores the device filter on /api/dcim/interfaces/, so a port cannot be '
                       'tied to its device. Nothing was looked up or created.')

    def device(self, name):
        if name not in self.devices:
            found, err = self.api.listing('/api/dcim/devices/', {'name': name, 'limit': 50, 'depth': 0})
            if err:
                self.devices[name] = 'the devices named %s could not be listed (%s)' % (name, err)
            else:
                same = [d for d in found if d.get('name') == name]
                self.devices[name] = None if len(same) == 1 else (
                    'there is no device named %s' % name if not same else '%d devices are named %s' % (len(same), name))
        return self.devices[name]

    def end(self, device, kind, name):
        """(port, None) or (None, why)."""
        if kind not in ENDPOINTS:
            return None, '%s is not a kind of end this script knows' % (kind or 'a blank type')
        why = self.device(device)
        if why:
            return None, why
        key = (kind, device)
        if key not in self.ports:
            self.ports[key] = self.api.listing('/api/dcim/%s/' % ENDPOINTS[kind], {'device': device, 'limit': 1000, 'depth': 0})
        found, err = self.ports[key]
        if err:
            return None, "%s's %ss could not be listed (%s)" % (device, KIND[kind], err)
        same = [p for p in found if p.get('name') == name]
        if not same:
            return None, '%s has no %s named %s' % (device, KIND[kind], name)
        if len(same) > 1:
            return None, '%s has %d %ss named %s' % (device, len(same), KIND[kind], name)
        if same[0].get('cable'):
            return None, '%s %s already has a cable' % (device, name)
        return same[0], None


def read_rows(path):
    try:
        with open(path, newline='', encoding='utf-8-sig') as f:
            reader = csv.DictReader(f)
            header = reader.fieldnames or []
            rows = [r for r in reader if any((v or '').strip() for v in r.values())]
    except OSError as e:
        raise Stop('Could not read %s: %s' % (path, e.strerror or e))
    missing = [c for c in REQUIRED if c not in header]
    if missing:
        raise Stop('%s is not the Rack Builder\'s 3-cables.csv: it has no %s column. '
                   'Use the 3-cables.csv from the Nautobot import kit.' % (path, ', '.join(missing)))
    return rows


def cable_csv(row, a, b):
    """One cable as Nautobot's importer takes it: its ends by type and id, and
    only the other columns that have a value."""
    cell = lambda k: (row.get(k) or '').strip()
    cols = [('termination_a_type', cell('a_type')), ('termination_a_id', a['id']),
            ('termination_b_type', cell('b_type')), ('termination_b_id', b['id']),
            ('status__name', cell('status') or 'Planned')]
    cols += [(k, cell(k)) for k in ('type', 'label', 'color', 'length', 'length_unit') if cell(k)]
    out = []
    for cells in ([k for k, _ in cols], [v for _, v in cols]):
        out.append(','.join('"%s"' % str(c).replace('"', '""') if any(x in str(c) for x in ',"\r\n') else str(c)
                            for c in cells))
    return '\n'.join(out) + '\n'


def describe(row):
    cell = lambda k: (row.get(k) or '').strip()
    extra = ', '.join(x for x in (cell('type'), ('%s %s' % (cell('length'), cell('length_unit'))).strip(),
                                  cell('status') or 'Planned') if x)
    return '%s %s to %s %s (%s)' % (cell('a_device'), cell('a_name'), cell('b_device'), cell('b_name'), extra)


def run(argv, env, out):
    args = [a for a in argv[1:] if not a.startswith('--')]
    flags = [a for a in argv[1:] if a.startswith('--')]
    if any(f not in ('--apply',) for f in flags) or len(args) > 1:
        raise Stop('usage: python3 import_cables.py [3-cables.csv] [--apply]')
    apply = '--apply' in flags
    path = args[0] if args else '3-cables.csv'
    api = Api(env.get('NAUTOBOT_URL'), env.get('NAUTOBOT_TOKEN'))
    say = lambda text: print(api.clean(text), file=out, flush=True)
    rows = read_rows(path)
    say('Nautobot at %s. %s' % (api.netloc, 'Creating cables.' if apply else 'A dry run: nothing is created. Add --apply to create the cables.'))
    finder = Finder(api)
    finder.check_filters()
    good = bad = 0
    for n, row in enumerate(rows, 1):
        cell = lambda k: (row.get(k) or '').strip()
        name = 'row %d %s' % (n, cell('label') or '(no label)')
        length = cell('length')
        problems = []
        if length and not length.isdigit():
            problems.append('its length %s is not a whole number, and Nautobot takes only whole numbers' % length)
        a, why_a = finder.end(cell('a_device'), cell('a_type'), cell('a_name'))
        b, why_b = finder.end(cell('b_device'), cell('b_type'), cell('b_name'))
        problems += [w for w in (why_a, why_b) if w]
        if not problems and a['id'] == b['id']:
            problems.append('both ends are the same port')
        if problems:
            bad += 1
            say('%s: cannot connect %s: %s.' % (name, describe(row), '; '.join(problems)))
            continue
        if not apply:
            good += 1
            a['cable'] = b['cable'] = True               # a later row naming the same port is caught here too
            say('%s: would connect %s.' % (name, describe(row)))
            continue
        status, data, text = api.request('POST', '/api/dcim/cables/', cable_csv(row, a, b).encode('utf-8'), 'text/csv')
        made = (data[0] if isinstance(data, list) and data else data) if status in (200, 201) else None
        if not isinstance(made, dict):
            bad += 1
            say('%s: Nautobot refused %s: HTTP %s %s' % (name, describe(row), status, text[:600]))
            continue
        if made.get('termination_a_id') != a['id'] or made.get('termination_b_id') != b['id']:
            bad += 1
            say('%s: Nautobot created cable %s WITHOUT ITS ENDS. Delete it in Nautobot; it connects nothing.'
                % (name, made.get('id')))
            continue
        good += 1
        a['cable'] = b['cable'] = True
        say('%s: connected %s.' % (name, describe(row)))
    total = '%d row%s' % (len(rows), '' if len(rows) == 1 else 's')
    if apply:
        say('%s: %d created, %d not.' % (total, good, bad))
    else:
        say('%s: %d would be created, %d cannot be. Nothing was created.' % (total, good, bad))
    return 1 if bad else 0


def main(argv=None, env=None, out=None):
    try:
        return run(argv or sys.argv, env if env is not None else os.environ, out or sys.stdout)
    except Stop as e:
        token = (env if env is not None else os.environ).get('NAUTOBOT_TOKEN') or ''
        print(str(e).replace(token, '***') if token else str(e), file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
```

- [ ] **Step 5: Run both and see them pass**

Run: `python3 tests/rack/import_cables_test.py`
Expected: `Ran 10 tests` and `OK`, in under a second.

The contract check asks git what the site serves, so stage the new file first.

Run: `git add site/rack/nautobot/import_cables.py && python3 check-contract.py`
Expected: `contract: 298 checks passed`.

- [ ] **Step 6: Commit**

```bash
git add site/rack/nautobot/import_cables.py tests/rack/import_cables_test.py check-contract.py
git commit -m "rack: import_cables.py - creates a rack's cables in Nautobot from a file that names their ends

Nautobot imports a cable's ends by id only, and from a file that names them it
creates cables with no ends. The script reads the kit's 3-cables.csv, looks
each end up through the REST API, and creates each cable by id. A dry run by
default; --apply creates. It never prints the token, talks to one host only,
reports every row, and leaves a port that already has a cable alone. Standard
library only. Tested against a mock Nautobot, from check-contract.py.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The kits: `dcimKit` builds one zip per target

Ruling 1. `dcimKit(rack, chassisOf, target)` builds the whole kit for a target from the rules of Tasks 1 to 4 and the script of Task 6. This task adds the builder and checks it by calling it from the page; Task 8 puts it in the menu.

What `exports.js` adds to the pure rules:
- `dcimContext` keeps each device type's and each module type's own name lists (`typeLists` of the fetched YAML), which the resolution needs.
- **A type file that cannot be read costs that one type, never the export.** The device or the part is then one with no type, a note says which file it was, and the left-out rule of Task 2 lists the device. Today one such file fails the whole export with a generic message.
- The console ports each cabled device's drawing has (`data-role="console"`), which `resolveEnd` needs to name a console port.
- The cabled ends, through `cableEnds`, the reading every other export uses. If that reading fails, no cable is written (a loose end might be among them) and each is listed with "its ends could not be checked".
- For Nautobot, `import_cables.py`, fetched from `site/rack/nautobot/`. If it cannot be fetched the kit still comes, without it, and the README says where the script is.

Every CSV is in the zip even with no rows. The status line counts the README's own notes.

**Files:**
- Modify: `site/rack/exports.js`, `check-browser.py`

**Interfaces:**
- Consumes: `typeLists`, `resolveEnd`, `moduleImportRows`, `cableImportRows`, `kitReadme`, `KIT_FILES`, `KIT_SCRIPT` (Tasks 1, 3, 4); `deviceImportRows`, `rackImportRows`, `uniqueNames` (Task 2, `export-data.js`); `dcimOf` (Task 5, `model.js`); `portPathOf` from `cable-rules.js`; in `exports.js` itself, `dcimContext`, `faceOf`, `cableEnds`, `fetchText`, `exportUrl`, `probeFail`; `makeZip`, `toCsv`, `fileStem`, `heightOf`, `UNCHECKED` (already imported there).
- Produces, exported from `site/rack/exports.js`:
  - `dcimContext(rack, chassisOf, target, {modules = true, cables = true})`: as before, plus `lists` on each entry of `types`, `type` (`{manufacturer, model, lists}` or `null`) on each entry of `modules`, and a note instead of a throw for a type file that cannot be read. `cables: false` leaves the "cables are not in this export yet" note out. (Task 8 removes the option: by then no caller wants the note.)
  - `dcimKit(rack, chassisOf, target, {date = new Date()})` → `Promise<{name, data, type: 'application/zip', notes, files}>`. `name` is `<stem>-netbox-import.zip` or `<stem>-nautobot-import.zip`. `files` maps each text file's name to its text. `notes` are the README's.
  - `failExport` (probe only) also takes `{type: '<text in a type file's path>'}` and `{script: true}`.
- Produces, in `check-browser.py`: `KIT_JS`, `built_kit(page, target, patch=None, fail=None)` → `{name, type, notes, files, status, names, zip}`; `kit_rows(kit, name)`; `readme_lists(text)` → `(left, notes)`; `KIT_TYPES`.

- [ ] **Step 1: Write the failing checks**

In `check-browser.py`, add before `def main():`

```python
# One import kit, built by exports.js dcimKit from the rack on the page (with
# `patch` applied: {numbering, dcim, cables: 'none'}), while `fail` is what the
# probe makes fail. Returns its name, its README notes, the status line the
# page would show, and the zip, read: the entry names in order, each text file.
KIT_JS = """async ([target, patch, fail]) => {
  const X = await import('/site/rack/exports.js'), C = await import('/site/rack/chassis.js'),
        E = await import('/site/rack/export-data.js');
  const of = C.chassisLookup(await C.loadChassis());
  const r = window.__rack.doc().racks[0];
  const rack = {...r, ...(patch.numbering ? {frame: {...r.frame, numbering: patch.numbering}} : {}),
                ...(patch.dcim ? {dcim: patch.dcim} : {}), ...(patch.cables === 'none' ? {cables: []} : {})};
  window.__rack.failExport(fail);
  try {
    const k = await X.dcimKit(rack, of, target, {date: new Date(2026, 9, 4)});
    return {name: k.name, type: k.type, notes: k.notes, files: k.files, status: E.exportStatus(k),
            zip: Array.from(new Uint8Array(await k.data.arrayBuffer()))};
  } finally { window.__rack.failExport(null); }
}"""


def built_kit(page, target, patch=None, fail=None):
    got = page.evaluate(KIT_JS, [target, patch or {}, fail])
    with zipfile.ZipFile(io.BytesIO(bytes(got.pop("zip")))) as z:
        got["names"] = z.namelist()
        got["zip"] = {n: z.read(n).decode("utf-8") for n in got["names"]}
    return got


def kit_rows(kit, name):
    return list(csv.DictReader(io.StringIO(kit["zip"][name], newline="")))


def readme_lists(text):
    """The README's two lists: what is not in the kit (none, when it says "Nothing"), and the notes."""
    part = lambda head: [l[2:] for l in text.partition(head + "\n")[2].partition("\n\n")[0].split("\n")
                         if l.startswith("- ") and not l.startswith("- Nothing: every device, card and cable")]
    return part("NOT IN THIS KIT:"), part("NOTES:")


KIT_TYPES = ["types/device-types/Cisco/ASR-9006-AC-V2.yaml", "types/device-types/Edgecore/7726-32X-O-AC-F.yaml",
             "types/device-types/Telco Systems/TM-280.yaml", "types/module-types/Cisco/A9K Slot Cover.yaml",
             "types/module-types/Cisco/A9K-16X100GE-TR.yaml", "types/module-types/Cisco/A9K-3KW-AC.yaml",
             "types/module-types/Cisco/ASR-9006-FAN.yaml"]


@extra("rack.html: the NetBox import kit - types, rack, devices, modules and cables in import order, only rows NetBox takes, and a README for the rest")
def check_rack_dcim_kit_netbox(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    try:
        open_cabled(page, base)
    except RuntimeError as e:
        return bad + [f"NetBox kit: {e}"]
    kit = built_kit(page, "netbox")
    if (kit["name"], kit["type"]) != ("Cable-test-netbox-import.zip", "application/zip"):
        bad.append(f"NetBox kit: named {kit['name']!r}, type {kit['type']!r}")
    want = KIT_TYPES + ["1-rack.csv", "2-devices.csv", "3-modules.csv", "4-cables.csv", "README.txt"]
    if kit["names"] != want:
        bad.append(f"NetBox kit: entries {kit['names']}")
    if any(kit["zip"].get(n) != t for n, t in kit["files"].items()):
        bad.append("NetBox kit: a file in the zip is not the text the builder reports")
    if "model: 7726-32X-O-AC-F" not in kit["zip"].get(KIT_TYPES[1], ""):
        bad.append("NetBox kit: the Edgecore YAML is not the exported file")

    # The fixture has never been given a site or a role: the files leave them blank, and the README's first lines say so.
    if kit["zip"]["1-rack.csv"] != "site,name,status,width,u_height,desc_units\r\n,Cable test,planned,19,24,false\r\n":
        bad.append(f"NetBox kit: the rack file reads {kit['zip']['1-rack.csv']!r}")
    readme = kit["zip"]["README.txt"]
    lines = readme.split("\n")
    if lines[0] != "NetBox import kit for Cable test, from the Portrayal Rack Builder, 2026-10-04." or \
            not lines[2].startswith("2-devices.csv WILL BE REFUSED as it is: its site and role columns are blank"):
        bad.append(f"NetBox kit: the README opens {lines[:3]}")

    # Devices: demarc-i3 shares U14 with leaf-1, both full depth. NetBox refused that file whole; the row is left out and said.
    devices = kit_rows(kit, "2-devices.csv")
    got = [(r["name"], r["manufacturer"], r["device_type"], r["status"], r["rack"], r["position"], r["face"]) for r in devices]
    if got != [("demarc-i4", "Telco Systems", "TM-280", "planned", "Cable test", "20", "rear"),
               ("leaf-1", "Edgecore", "7726-32X-O-AC-F", "planned", "Cable test", "14", "front"),
               ("core-1", "Cisco", "ASR-9006-AC-V2", "planned", "Cable test", "2", "front")]:
        bad.append(f"NetBox kit: the devices file holds {got}")
    left, notes = readme_lists(readme)
    if left != ["demarc-i3 is not in the devices file: it shares U14 with leaf-1 on the front, and NetBox refuses two devices in "
                "one U, front and rear, while either type is full depth. One refused row refuses the whole file. Import demarc-i3 "
                "by hand after changing the type's depth, or place it elsewhere.",
                "Cable c2 is not in the cables file: end B is on demarc-i3, which is not in the devices file.",
                "Cable c3 is not in the cables file: end A, leaf-1 (U14) port-2, is not connected (port-2 holds no optic)."]:
        bad.append(f"NetBox kit: the README's NOT IN THIS KIT list is {left}")
    if not any("ASR-9006-AC-V2 is a best guess" in n for n in notes) or not any("generic/qsfp-lc@2: no NetBox module type" in n for n in notes):
        bad.append(f"NetBox kit: the README's notes lost the types' notes: {notes}")

    # Modules: every card in a bay, by the bay's name. The card in slot-2 is what gives core-1 its ports.
    modules = kit_rows(kit, "3-modules.csv")
    if list(modules[0].keys()) != ["device", "module_bay", "module_type", "status"] or len(modules) != 11 or \
            {"device": "core-1", "module_bay": "slot-2", "module_type": "A9K-16X100GE-TR", "status": "planned"} not in modules or \
            any(r["device"] != "core-1" or r["status"] != "planned" for r in modules):
        bad.append(f"NetBox kit: the modules file holds {modules}")
    # Cables: the one cable NetBox would take, as the real instance imported it (result.json, cables_good).
    cables = kit["zip"]["4-cables.csv"].split("\r\n")
    if cables != ["side_a_device,side_a_type,side_a_name,side_b_device,side_b_type,side_b_name,type,status,label,color,length,length_unit,description",
                  "leaf-1,dcim.interface,port-1,core-1,dcim.interface,slot-2/p0,smf-os2,planned,A1,,2,m,uplink", ""]:
        bad.append(f"NetBox kit: the cables file reads {cables}")
    # The status counts what the README carries: its warning, what is left out, and its notes.
    n = 1 + len(left) + len(notes)
    if len(kit["notes"]) != n or kit["status"] != notes_status(n):
        bad.append(f"NetBox kit: the README carries {n} notes; the builder reports {len(kit['notes'])} and the status reads {kit['status']!r}")
    if any("not in this export yet" in t for t in kit["zip"].values()):
        bad.append("NetBox kit: a file still says cables are not in this export")

    # With the settings: every device row and the rack row carry them, and the warning is gone.
    kit = built_kit(page, "netbox", {"dcim": {"site": "Lab 1", "role": "Router"}, "numbering": "top-down"})
    if kit["zip"]["1-rack.csv"].split("\r\n")[1] != "Lab 1,Cable test,planned,19,24,true":
        bad.append(f"NetBox kit with settings, top-down: the rack row reads {kit['zip']['1-rack.csv']!r}")
    rows = kit_rows(kit, "2-devices.csv")
    if any((r["site"], r["role"]) != ("Lab 1", "Router") for r in rows) or {r["name"]: r["position"] for r in rows} != \
            {"demarc-i4": "5", "leaf-1": "11", "core-1": "14"}:
        bad.append(f"NetBox kit with settings, top-down: the devices are {[(r['name'], r['site'], r['role'], r['position']) for r in rows]}")
    readme = kit["zip"]["README.txt"]
    if "WILL BE REFUSED" in readme or '- the site "Lab 1"\n- the device role "Router"\n' not in readme or \
            "it shares U11 with leaf-1" not in readme or "numbered from the top." not in readme:
        bad.append(f"NetBox kit with settings: the README reads {readme[:600]!r}")

    # A rack with no cables still exports a correct kit: the cables file is its header, and the README says it is empty.
    kit = built_kit(page, "netbox", {"cables": "none"})
    if kit["names"] != want or kit["zip"]["4-cables.csv"].count("\r\n") != 1 or len(kit_rows(kit, "3-modules.csv")) != 11 or \
            "5. 4-cables.csv (no rows: it holds its header only, so skip it): Cables > Import." not in kit["zip"]["README.txt"]:
        bad.append(f"NetBox kit with no cables: {kit['names']}, cables {kit['zip']['4-cables.csv']!r}")
    if readme_lists(kit["zip"]["README.txt"])[0] != [left[0]]:
        bad.append(f"NetBox kit with no cables: NOT IN THIS KIT is {readme_lists(kit['zip']['README.txt'])[0]}")

    # A type file that cannot be read costs that type, not the export: the kit says which file, and what it leaves out for it.
    kit = built_kit(page, "netbox", fail={"type": "TM-280"})
    left, notes = readme_lists(kit["zip"]["README.txt"])
    if [r["name"] for r in kit_rows(kit, "2-devices.csv")] != ["leaf-1", "core-1"] or \
            "types/device-types/Telco Systems/TM-280.yaml" in kit["names"]:
        bad.append(f"NetBox kit, a type file failing: devices {[r['name'] for r in kit_rows(kit, '2-devices.csv')]}, entries {kit['names']}")
    for want_note in ("demarc (tm-280): its NetBox device type, netbox/device-types/Telco Systems/TM-280.yaml, couldn't be read, so it has none here.",):
        if want_note not in notes:
            bad.append(f"NetBox kit, a type file failing: the notes do not say so: {notes}")
    if not any(l.startswith("demarc-i4 is not in the devices file: there is no NetBox device type for tm-280 (base).") for l in left):
        bad.append(f"NetBox kit, a type file failing: the device is not listed as left out: {left}")
    return bad


@extra("rack.html: the Nautobot import kit - devices, modules, a cables file for import_cables.py and the script itself; never a file for Nautobot's own cable import")
def check_rack_dcim_kit_nautobot(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    try:
        open_cabled(page, base)
    except RuntimeError as e:
        return bad + [f"Nautobot kit: {e}"]
    kit = built_kit(page, "nautobot", {"dcim": {"site": "Lab 1", "role": "Router"}})
    want = KIT_TYPES + ["1-devices.csv", "2-modules.csv", "3-cables.csv", "import_cables.py", "README.txt"]
    if kit["name"] != "Cable-test-nautobot-import.zip" or kit["names"] != want:
        bad.append(f"Nautobot kit: {kit['name']!r} with entries {kit['names']}")
    # The script in the zip is the repository's file, byte for byte.
    served = page.evaluate("async () => (await fetch('/site/rack/nautobot/import_cables.py')).text()")
    if kit["zip"].get("import_cables.py") != served or "NAUTOBOT_TOKEN" not in served:
        bad.append("Nautobot kit: import_cables.py is not the file the site serves")

    # Nautobot accepted two devices at U14, front and rear: its file keeps all four.
    devices = kit_rows(kit, "1-devices.csv")
    if [(r["name"], r["role__name"], r["location__name"], r["status__name"], r["position"], r["face"]) for r in devices] != [
            ("demarc-i4", "Router", "Lab 1", "Planned", "20", "rear"), ("leaf-1", "Router", "Lab 1", "Planned", "14", "front"),
            ("demarc-i3", "Router", "Lab 1", "Planned", "14", "rear"), ("core-1", "Router", "Lab 1", "Planned", "2", "front")]:
        bad.append(f"Nautobot kit: the devices file holds {devices}")
    modules = kit_rows(kit, "2-modules.csv")
    if len(modules) != 11 or {"module_type__manufacturer__name": "Cisco", "module_type__model": "A9K-16X100GE-TR",
                             "parent_module_bay__parent_device__name": "core-1", "parent_module_bay__name": "slot-2",
                             "status__name": "Planned"} not in modules:
        bad.append(f"Nautobot kit: the modules file holds {modules}")
    cables = kit["zip"]["3-cables.csv"].split("\r\n")
    if cables != ["a_device,a_type,a_name,b_device,b_type,b_name,type,status,label,color,length,length_unit",
                  "leaf-1,dcim.interface,port-1,core-1,dcim.interface,slot-2/p0,smf-os2,Planned,A1,,2,m",
                  "leaf-1,dcim.interface,mgmt-eth,demarc-i3,dcim.interface,port-2-1,cat6a,Planned,c2,,,", ""]:
        bad.append(f"Nautobot kit: the cables file reads {cables}")
    # No file in the kit can be fed to Nautobot's own cable importer: none has its id columns.
    if any("termination_a" in t for n, t in kit["zip"].items() if n.endswith(".csv")):
        bad.append("Nautobot kit: a CSV has Nautobot's own cable columns")
    readme = kit["zip"]["README.txt"]
    left, notes = readme_lists(readme)
    if left != ["Cable c3 is not in the cables file: end A, leaf-1 (U14) port-2, is not connected (port-2 holds no optic)."]:
        bad.append(f"Nautobot kit: NOT IN THIS KIT is {left}")
    for line in ("4. 3-cables.csv (2 rows), with import_cables.py. DO NOT give 3-cables.csv to Nautobot's own importer: Nautobot "
                 "takes a cable's ends by id only, and from a file that names them it creates cables with no ends.",
                 "     python3 import_cables.py 3-cables.csv --apply     (creates the cables)",
                 '- the rack "Cable test" in that location: 24U, numbered from the bottom. This kit has no rack file for Nautobot.',
                 "This step is written from Nautobot's source and was NOT verified against Nautobot 3.2."):
        if line not in readme:
            bad.append(f"Nautobot kit: the README lacks {line[:70]!r}")
    if "WILL BE REFUSED" in readme or len(kit["notes"]) != len(left) + len(notes) or kit["status"] != notes_status(len(left) + len(notes)):
        bad.append(f"Nautobot kit: {len(left) + len(notes)} README notes; the builder reports {len(kit['notes'])}, status {kit['status']!r}")

    # The script cannot be fetched: the kit still comes, without it, and says where it is.
    kit = built_kit(page, "nautobot", fail={"script": True})
    if "import_cables.py" in kit["names"] or readme_lists(kit["zip"]["README.txt"])[0][0] != \
            "import_cables.py could not be fetched, so it is not in this zip. It is at https://portrayal.dev/site/rack/nautobot/import_cables.py.":
        bad.append(f"Nautobot kit without the script: entries {kit['names']}, {readme_lists(kit['zip']['README.txt'])[0][:1]}")
    # The cabled ends cannot be read: no cable is written (a loose end might be among them), and each is listed.
    kit = built_kit(page, "nautobot", fail={"facts": True})
    left = readme_lists(kit["zip"]["README.txt"])[0]
    if kit["zip"]["3-cables.csv"].count("\r\n") != 1 or left != [f"Cable {c} is not in the cables file: its ends could not be checked." for c in ("A1", "c2", "c3")]:
        bad.append(f"Nautobot kit, ends unchecked: cables {kit['zip']['3-cables.csv']!r}, left {left}")
    if len(kit_rows(kit, "1-devices.csv")) != 4:
        bad.append("Nautobot kit, ends unchecked: the devices file lost rows")
    return bad
```

Run: `python3 check-browser.py --only check_rack_dcim_kit_netbox,check_rack_dcim_kit_nautobot`
Expected: two `FAIL` lines, each "Page.evaluate: TypeError: X.dcimKit is not a function".

- [ ] **Step 2: The builder**

In `site/rack/exports.js`, replace

```js
        drawioCables, drawioMediaKey, cableBomNotes, uniqueEntryIds, rearNoDrawing} from './export-data.js';
import {cableFacts, UNCHECKED} from './cable-plugs.js';
import {mergeSeats, endKey, endName} from './cable-rules.js';
```

with

```js
        drawioCables, drawioMediaKey, cableBomNotes, uniqueEntryIds, rearNoDrawing, uniqueNames, rackImportRows} from './export-data.js';
import {cableFacts, UNCHECKED} from './cable-plugs.js';
import {mergeSeats, endKey, endName, portPathOf} from './cable-rules.js';
import {dcimOf} from './model.js';
import {typeLists, resolveEnd, moduleImportRows, cableImportRows, kitReadme, KIT_FILES, KIT_SCRIPT} from './dcim-rules.js';
```

In `site/rack/exports.js`, replace

```js
export async function dcimContext(rack, chassisOf, target, {modules = true} = {}) {
  const T = TARGET_NAME[target];
  const [index, files, comps] = await Promise.all([
    fetchJson(`${EXPORTS_BASE}index.json`), fetchJson(`${EXPORTS_BASE}files.json`), components()]);
  const items = itemsWithU(rack, chassisOf);
  const notes = [...rackNotes(rack), ...mountNotes(items, chassisOf, rack.frame)];
  const types = new Map();
  for (const it of items) {
    const manufacturer = chassisOf(it.ref)?.manufacturer;
    const m = matchDeviceType({cfg: it.cfg, manufacturer, paths: index[it.ref]?.[target] || []});
    if (!m) { types.set(it.id, null); notes.push(`${it.label} (${it.ref}): no ${T} device type.`); continue; }
    const head = yamlHead(await fetchText(exportUrl(m.path)));
    // matchDeviceType falls back past the manufacturer filter when no file is in
    // the chassis's own folder; that shows as a file from another vendor's.
    const otherVendor = vendorOf(m.path) !== manufacturer;
    // chassisManufacturer is the chassis catalog's value; `manufacturer` below is the YAML's.
    types.set(it.id, {...m, otherVendor, chassisManufacturer: manufacturer, manufacturer: head.manufacturer ?? '', model: head.model ?? '',
                      isFullDepth: head.isFullDepth});
```

with

```js
// WHAT A RACK IS IN A DCIM: each item's device type (the matched file, its
// identity lines and its own name lists), and - with `modules` - every seated
// part with its module type. `cables: false` is for a file that carries the
// cables, and so does not say they are left out. A type file that cannot be
// read costs that one type, never the export: the device or the part is then
// one with no type, and a note says which file it was.
export async function dcimContext(rack, chassisOf, target, {modules = true, cables = true} = {}) {
  const T = TARGET_NAME[target];
  const [index, files, comps] = await Promise.all([
    fetchJson(`${EXPORTS_BASE}index.json`), fetchJson(`${EXPORTS_BASE}files.json`), components()]);
  const items = itemsWithU(rack, chassisOf);
  const notes = [...rackNotes(rack, {cables}), ...mountNotes(items, chassisOf, rack.frame)];
  const types = new Map();
  const readType = path => (probeFail.type && path.includes(probeFail.type)
    ? Promise.reject(new Error('probe: this type file cannot be read')) : fetchText(exportUrl(path)));
  for (const it of items) {
    const manufacturer = chassisOf(it.ref)?.manufacturer;
    const m = matchDeviceType({cfg: it.cfg, manufacturer, paths: index[it.ref]?.[target] || []});
    if (!m) { types.set(it.id, null); notes.push(`${it.label} (${it.ref}): no ${T} device type.`); continue; }
    let text;
    try { text = await readType(m.path); }
    catch (err) {
      console.warn('[portrayal] export: a device type file', m.path, err);
      types.set(it.id, null);
      notes.push(`${it.label} (${it.ref}): its ${T} device type, ${m.path}, couldn't be read, so it has none here.`);
      continue;
    }
    const head = yamlHead(text);
    // matchDeviceType falls back past the manufacturer filter when no file is in
    // the chassis's own folder; that shows as a file from another vendor's.
    const otherVendor = vendorOf(m.path) !== manufacturer;
    // chassisManufacturer is the chassis catalog's value; `manufacturer` below is the YAML's.
    types.set(it.id, {...m, otherVendor, chassisManufacturer: manufacturer, manufacturer: head.manufacturer ?? '', model: head.model ?? '',
                      isFullDepth: head.isFullDepth, lists: typeLists(text)});
```

In `site/rack/exports.js`, replace

```js
      const path = moduleTypePath(files[target] || [], model);
      out.modules.push({ref, comp, model, path});
      if (!path) notes.push(`${ref}${model ? ` (${model})` : ''}: no ${T} module type; seated in ${uniq(labels).join(', ')}.`);
```

with

```js
      let path = moduleTypePath(files[target] || [], model), type = null;
      if (path) {
        // The module type's own identity and name lists: what a module row names, and what a card's port is called.
        try {
          const lists = typeLists(await readType(path));
          type = {manufacturer: lists.manufacturer ?? '', model: lists.model ?? '', lists};
        } catch (err) {
          console.warn('[portrayal] export: a module type file', path, err);
          notes.push(`${ref}${model ? ` (${model})` : ''}: its ${T} module type, ${path}, couldn't be read, so it has none here; seated in ${uniq(labels).join(', ')}.`);
          path = null;
        }
      } else notes.push(`${ref}${model ? ` (${model})` : ''}: no ${T} module type; seated in ${uniq(labels).join(', ')}.`);
      out.modules.push({ref, comp, model, path, type});
```

In `site/rack/exports.js`, replace

```js
          left: [...rackNotes(rack), ...left.map(l => l.reason)]};
}
```

with

```js
          left: [...rackNotes(rack), ...left.map(l => l.reason)]};
}

// The console ports each cabled device's drawing has, by item id: a console
// port is named in a type file by its own list, not by its path (dcim-rules.js
// resolveEnd), and the drawing says which ports those are (data-role). Only
// devices with a cabled end are read. A panel with no drawing has none: its
// ends are loose already.
async function consolePorts(rack, items) {
  const cabled = new Set((rack.cables || []).flatMap(c => [c.a.item, c.b.item]));
  const out = new Map();
  for (const it of items) {
    if (!cabled.has(it.id)) continue;
    const paths = [];
    for (const view of ['front', 'rear']) {
      const f = await faceOf(it, view);
      if (!f) continue;
      const doc = new DOMParser().parseFromString(f.text, 'image/svg+xml');
      for (const n of doc.querySelectorAll('[data-class="port"][data-role="console"][data-path]'))
        paths.push(portPathOf(n.getAttribute('data-path')));
    }
    out.set(it.id, uniq(paths));
  }
  return out;
}

// The Nautobot kit's script: a real file of the site, fetched as any other.
const SCRIPT_URL = `site/rack/nautobot/${KIT_SCRIPT}`;

// THE IMPORT KIT (Phase 2c ruling 1): ONE zip per target, its files numbered
// in the order they are imported, with a README.txt that says what to do with
// each, what must already exist, and everything the kit could not carry.
//   NetBox:   types/…, 1-rack.csv, 2-devices.csv, 3-modules.csv, 4-cables.csv
//   Nautobot: types/…, 1-devices.csv, 2-modules.csv, 3-cables.csv and
//             import_cables.py, which creates the cables from that file
// Every CSV is written verbatim (no formula guard: an importer reads it
// literally) and is in the zip even with no rows. A device's name is
// uniqueNames' and its U is positionOf, the same in every file. A row the
// target would refuse is left out and listed in the README (dcim-rules.js,
// export-data.js deviceImportRows): NetBox takes a file whole or not at all.
// `files` is each text file by name, for a caller that wants one without
// unzipping; `notes` are the README's own, which is what the status counts.
export async function dcimKit(rack, chassisOf, target, {date = new Date()} = {}) {
  const nautobot = target === 'nautobot', F = KIT_FILES[nautobot ? 'nautobot' : 'netbox'];
  const ctx = await dcimContext(rack, chassisOf, target, {cables: false});
  const dcim = dcimOf(rack), enc = new TextEncoder();
  const entries = [], files = {}, left = [];
  const add = (name, text) => { files[name] = text; entries.push({name, bytes: enc.encode(text)}); };

  const paths = uniq([...ctx.types.values()].filter(Boolean).map(t => t.path)
    .concat(ctx.modules.map(m => m.path).filter(Boolean))).sort();
  let typeFiles = 0;
  for (const p of paths) {
    try { entries.push({name: `types/${p.split('/').slice(1).join('/')}`, bytes: enc.encode(await fetchText(exportUrl(p)))}); typeFiles++; }
    catch { left.push(`${p} couldn't be fetched, so it is not in this zip.`); }
  }
  const manufacturers = uniq([...[...ctx.types.values()].filter(Boolean).map(t => t.manufacturer),
                              ...ctx.modules.filter(m => m.type).map(m => m.type.manufacturer)].filter(Boolean)).sort();

  const names = uniqueNames(ctx.items);
  const dev = deviceImportRows({rack, items: ctx.items, types: ctx.types, target, dcim});
  const out = new Set(dev.left.map(l => l.id));
  const kept = new Set(ctx.items.filter(i => !out.has(i.id)).map(i => i.id));
  const deviceOf = id => ctx.types.get(id)?.lists ?? null;
  const moduleOf = ref => ctx.modules.find(m => m.ref === ref)?.type ?? null;
  const mod = moduleImportRows({target, parts: ctx.parts, names, kept, deviceOf, moduleOf});

  // The cabled ends, as the page reads them; with no cables nothing is read.
  const cabled = (rack.cables || []).length > 0;
  const facts = cabled ? await cableEnds(rack) : UNCHECKED;
  const consoles = cabled ? await consolePorts(rack, ctx.items) : new Map();
  const seated = new Map(ctx.parts.filter(p => p.path.endsWith('/module'))
    .map(p => [`${p.itemId}|${p.path.slice(0, -'/module'.length)}`, moduleOf(p.ref)?.lists ?? null]));
  const resolve = end => resolveEnd({path: portPathOf(end.path), device: deviceOf(end.item),
    consoles: consoles.get(end.item) || [], moduleAt: bay => seated.get(`${end.item}|${bay}`) ?? null});
  const cab = cableImportRows({rack, target, names, kept, resolve, ends: facts.ends,
                               unchecked: cabled && !!facts.unchecked, uOf: heightOf(chassisOf)});

  const rows = {devices: dev.rows.length, modules: mod.rows.length, cables: cab.rows.length};
  if (!nautobot) {
    const r = rackImportRows({rack, dcim});
    rows.rack = r.rows.length;
    add(F.rack, toCsv(r.columns, r.rows));
  }
  add(F.devices, toCsv(dev.columns, dev.rows));
  add(F.modules, toCsv(mod.columns, mod.rows));
  add(F.cables, toCsv(cab.columns, cab.rows));
  let script = false;
  if (nautobot) {
    // The script is a real file of the site (site/rack/nautobot/), fetched into
    // the zip. If it cannot be, the kit still comes, and says where the script is.
    try {
      if (probeFail.script) throw new Error('probe: the script cannot be fetched');
      entries.push({name: KIT_SCRIPT, bytes: enc.encode(await fetchText(SCRIPT_URL))});
      script = true;
    } catch (err) { console.warn(`[portrayal] export: ${KIT_SCRIPT}`, err); }
  }
  const notes = [...ctx.notes, ...cab.notes];
  if (!ctx.items.length) notes.unshift('This rack has no devices, so there is nothing to import.');
  const readme = kitReadme({target, rack, date, dcim, typeFiles, manufacturers, rows, script,
                            left: [...left, ...dev.left.map(l => l.reason), ...mod.left, ...cab.left], notes: uniq(notes)});
  add('README.txt', readme.text);
  return {name: `${fileStem(rack.name)}-${nautobot ? 'nautobot' : 'netbox'}-import.zip`, data: await makeZip(entries, date),
          type: 'application/zip', notes: readme.notes, files};
}
```

In `site/rack/exports.js`, replace

```js
// to draw ({pane: 'front'}), to see each export without it. Anything that is
```

with

```js
// to draw ({pane: 'front'}), or a DCIM type file whose path holds a text fail
// to be read ({type: 'TM-280'}), or the Nautobot kit's script fail to be
// fetched ({script: true}), to see each export without it. Anything that is
```

`probeFail` is declared lower in the module, with `let`; both new uses read it when an export runs, long after the module has loaded.

- [ ] **Step 3: Run the checks and see them pass**

Run: `python3 check-browser.py --only check_rack_dcim_kit_netbox,check_rack_dcim_kit_nautobot,check_rack_export_dcim_types,check_rack_export_other_vendor,check_rack_export_emptied_slot`
Expected: five `ok` lines. The last three are today's DCIM checks, which still pass: the old exports are untouched until Task 8.

- [ ] **Step 4: Look at a kit**

Serve the site (`python3 serve.py 8932`), open `http://localhost:8932/rack.html?probe=1`, build or open a rack with a cable, and run in the console:

```js
const X = await import('/site/rack/exports.js'), C = await import('/site/rack/chassis.js');
const kit = await X.dcimKit(window.__rack.doc().racks[0], C.chassisLookup(await C.loadChassis()), 'netbox');
console.log(kit.files['README.txt']); console.log(kit.files['4-cables.csv']);
```

The README lists the files in import order, and every cable is either a row or a line under "NOT IN THIS KIT".

- [ ] **Step 5: Commit**

```bash
git add site/rack/exports.js check-browser.py
git commit -m "rack: one import kit per target - types, devices, modules and cables, with a README

dcimKit builds the NetBox kit (types, 1-rack, 2-devices, 3-modules, 4-cables)
and the Nautobot kit (types, 1-devices, 2-modules, 3-cables, import_cables.py),
each with a README that says what to do, what must exist and what is left out.
A cable end is named from the type files. A type file that cannot be read
costs that type and is said, instead of failing the export. Not in the menu
yet.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The menu: one import kit per target; the old DCIM exports and their notes retired

Ruling 1: the Export menu's per-target entries become one zip per target, "NetBox import (.zip)" and "Nautobot import (.zip)", replacing the separate "device types (.zip)" and "device import (.csv)" entries. Ruling 9: the notes that say cables are left out are retired for both kits, which carry them.

So `dcimTypesZip`, `deviceImportCsv` and `dcimNotesText` go, `dcimContext` stops taking a `cables` option, and every check that exported one of the four old kinds reads the kit instead. `rackNotes` keeps its `cables` option and its sentence (its own tests pin both); after this task no export asks for the sentence.

**Files:**
- Modify: `site/rack-page.js`, `site/rack/exports.js`, `site/rack/export-data.js`, `tests/rack/dcim.test.mjs`, `check-browser.py`

**Interfaces:**
- Consumes: `dcimKit` (Task 7); `built_kit`, `kit_rows`, `readme_lists` (Task 7, `check-browser.py`); `device_rows` (Task 2).
- Produces:
  - The Export menu: `[data-export="netbox-import"]` "NetBox import (.zip)" and `[data-export="nautobot-import"]` "Nautobot import (.zip)", after `[data-export="dcim-settings"]`. The kinds `netbox-types`, `nautobot-types`, `netbox-devices` and `nautobot-devices` are gone.
  - `site/rack/exports.js` no longer exports `dcimTypesZip` or `deviceImportCsv`. `dcimContext(rack, chassisOf, target, {modules = true})`.
  - `site/rack/export-data.js` no longer exports `dcimNotesText`.
  - `check-browser.py`: `export_kit(page, target)` → `(download, {"names": [...], "zip": {entry: text}})`, the kit as the menu downloads it, in the shape `kit_rows` reads; `DEVICES_FILE`; `device_rows` reads the kit.

- [ ] **Step 1: Move the checks to the kits**

Ten blocks, in the file's own order. Between them they add `export_kit` and `DEVICES_FILE`, replace `check_rack_export_dcim_types` and `check_rack_export_device_csv` whole, rewrite `device_rows` to read the kit, and change the lines of five other checks that exported an old kind (`check_rack_export_other_vendor`, `check_rack_mount_flag`, `check_rack_mount_flag_3d_exports`, `check_rack_export_notes_truthful`, `check_rack_export_empty`) and of `check_rack_export_cable_failures`.

In `check-browser.py`, replace

```python
@extra("rack.html: Export - NetBox and Nautobot device types zip every device and part, with NOTES.txt")
def check_rack_export_dcim_types(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    open_fixture(page, base)
    want = {"device-types/Cisco/ASR-9006-AC-V2.yaml", "device-types/Edgecore/7726-32X-O-AC-F.yaml",
            "device-types/Telco Systems/TM-280.yaml", "module-types/Cisco/A9K-16X100GE-TR.yaml",
            "module-types/Cisco/A9K-3KW-AC.yaml", "module-types/Cisco/ASR-9006-FAN.yaml",
            "module-types/Cisco/A9K Slot Cover.yaml", "NOTES.txt"}
    for target, T in (("netbox", "NetBox"), ("nautobot", "Nautobot")):
        dl = export_file(page, f"{target}-types")
        if dl.suggested_filename != f"Export-test-{target}-types.zip":
            bad.append(f"{T} types: named {dl.suggested_filename!r}")
        with zipfile.ZipFile(dl.path()) as z:
            listing = z.namelist()
            names = set(listing)
            notes = z.read("NOTES.txt").decode() if "NOTES.txt" in names else ""
            head = z.read("device-types/Edgecore/7726-32X-O-AC-F.yaml").decode() \
                if "device-types/Edgecore/7726-32X-O-AC-F.yaml" in names else ""
        if names != want:
            bad.append(f"{T} types: entries differ - missing {sorted(want - names)}, extra {sorted(names - want)}")
        if len(listing) != len(want):
            bad.append(f"{T} types: {len(listing)} entries, expected {len(want)} (a duplicate?)")
        devices = sorted(n for n in names if n.startswith("device-types/"))
        if len(devices) != 3:
            bad.append(f"{T} types: {len(devices)} device types, expected 3 (two TM-280s share one): {devices}")
        if "ASR-9006-AC-V2 is a best guess" not in notes:
            bad.append(f"{T} types: NOTES.txt does not flag the ASR-9006's guessed type")
        if "generic/qsfp-lc@2" not in notes or f"no {T} module type" not in notes:
            bad.append(f"{T} types: NOTES.txt does not list the optic with no module type")
        if "model: 7726-32X-O-AC-F" not in head:
            bad.append(f"{T} types: the Edgecore YAML is not the exported file")
```

with

```python
def export_kit(page, target):
    """An import kit as the Export menu downloads it: the download, and what
    kit_rows and readme_lists read - {"names": entries in order, "zip": {entry: text}}."""
    dl = export_file(page, f"{target}-import")
    with zipfile.ZipFile(dl.path()) as z:
        names = z.namelist()
        return dl, {"names": names, "zip": {n: z.read(n).decode("utf-8") for n in names}}


DEVICES_FILE = {"netbox": "2-devices.csv", "nautobot": "1-devices.csv"}


@extra("rack.html: Export - one import kit per target in the menu, with every device and part's type under types/ and a README")
def check_rack_export_dcim_types(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    open_fixture(page, base)
    page.click("#exportMenu > summary")
    wait_sel(page, "menu: the import kits", '#exportItems [data-export="nautobot-import"]')
    kinds = page.evaluate("() => [...document.querySelectorAll('#exportItems [data-export]')].map(b => [b.dataset.export, b.textContent])")
    page.click("#exportMenu > summary")
    dcim = [k for k in kinds if "netbox" in k[0] or "nautobot" in k[0] or "dcim" in k[0]]
    if dcim != [["dcim-settings", "DCIM import settings"], ["netbox-import", "NetBox import (.zip)"],
                ["nautobot-import", "Nautobot import (.zip)"]]:
        bad.append(f"menu: the DCIM entries are {dcim}")
    want = {"types/device-types/Cisco/ASR-9006-AC-V2.yaml", "types/device-types/Edgecore/7726-32X-O-AC-F.yaml",
            "types/device-types/Telco Systems/TM-280.yaml", "types/module-types/Cisco/A9K-16X100GE-TR.yaml",
            "types/module-types/Cisco/A9K-3KW-AC.yaml", "types/module-types/Cisco/ASR-9006-FAN.yaml",
            "types/module-types/Cisco/A9K Slot Cover.yaml"}
    for target, T in (("netbox", "NetBox"), ("nautobot", "Nautobot")):
        dl, kit = export_kit(page, target)
        status = export_status(page)
        if dl.suggested_filename != f"Export-test-{target}-import.zip":
            bad.append(f"{T} kit: named {dl.suggested_filename!r}")
        types = [n for n in kit["names"] if n.startswith("types/")]
        if set(types) != want or len(types) != len(want):
            bad.append(f"{T} kit: types differ - missing {sorted(want - set(types))}, extra {sorted(set(types) - want)}, {len(types)} entries")
        if len(kit["names"]) != len(set(kit["names"])) or kit["names"][-1] != "README.txt" or "NOTES.txt" in kit["names"]:
            bad.append(f"{T} kit: entries {kit['names']}")
        left, notes = readme_lists(kit["zip"]["README.txt"])
        if not any("ASR-9006-AC-V2 is a best guess" in n for n in notes):
            bad.append(f"{T} kit: the README does not flag the ASR-9006's guessed type")
        if not any("generic/qsfp-lc@2" in n and f"no {T} module type" in n for n in notes):
            bad.append(f"{T} kit: the README does not list the optic with no module type")
        if "model: 7726-32X-O-AC-F" not in kit["zip"].get("types/device-types/Edgecore/7726-32X-O-AC-F.yaml", ""):
            bad.append(f"{T} kit: the Edgecore YAML is not the exported file")
        # The status counts the README's own lines: the blank-settings warning, what is left out, the notes.
        if status != notes_status(1 + len(left) + len(notes)):
            bad.append(f"{T} kit: the README carries {1 + len(left) + len(notes)} notes, but the status reads {status!r}")
```

In `check-browser.py`, replace

```python
    return read_csv(export_file(page, f"{target}-devices"))[1]


@extra("rack.html: Export - device import CSVs name each device's type, position and face as NetBox and Nautobot read them")
def check_rack_export_device_csv(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    open_fixture(page, base)
    dl = export_file(page, "netbox-devices")
    if dl.suggested_filename != "Export-test-netbox-devices.csv":
        bad.append(f"NetBox CSV: named {dl.suggested_filename!r}")
    cols, rows, _ = read_csv(dl)
    if cols != ["name", "role", "manufacturer", "device_type", "status", "site", "rack", "position", "face", "comments"]:
        bad.append(f"NetBox CSV: columns {cols}")
    by = {r["name"]: r for r in rows}
    want = {"core-1": ("Cisco", "ASR-9006-AC-V2", "2", "front"), "leaf-1": ("Edgecore", "7726-32X-O-AC-F", "14", "front"),
            "demarc-i4": ("Telco Systems", "TM-280", "20", "rear")}
    for name, (man, dt, pos, face) in want.items():
        r = by.get(name)
        if not r or (r["manufacturer"], r["device_type"], r["position"], r["face"]) != (man, dt, pos, face):
            bad.append(f"NetBox CSV: {name} is {r and (r['manufacturer'], r['device_type'], r['position'], r['face'])}")
    # demarc-i3 shares U14 with leaf-1 and both types are full depth: NetBox would refuse the whole file for it.
    status = export_status(page)
    if set(by) != set(want) or "demarc-i3 is not in the devices file: it shares U14 with leaf-1 on the front" not in status:
        bad.append(f"NetBox CSV: rows {sorted(by)}; the status reads {status!r}")
    if not all(r["status"] == "planned" and r["rack"] == "Export test" for r in rows):
        bad.append("NetBox CSV: status or rack column wrong")
    if "best guess" not in by.get("core-1", {}).get("comments", ""):
        bad.append("NetBox CSV: core-1's guessed type is not said in comments")

    dl = export_file(page, "nautobot-devices")
    cols, rows, _ = read_csv(dl)
    if dl.suggested_filename != "Export-test-nautobot-devices.csv" or "device_type__model" not in (cols or []):
        bad.append(f"Nautobot CSV: {dl.suggested_filename!r} with columns {cols}")
    leaf = next((r for r in rows if r["name"] == "leaf-1"), {})
    if (leaf.get("device_type__model"), leaf.get("status__name")) != ("7726-32X-O-AC-F", "Planned"):
        bad.append(f"Nautobot CSV: leaf-1 is {leaf}")
    # Nautobot accepts the pair at U14, so its file keeps both, and calls neither refused.
    if sorted(r["name"] for r in rows) != ["core-1", "demarc-i3", "demarc-i4", "leaf-1"] or any("refuses" in r["comments"] for r in rows):
        bad.append(f"Nautobot CSV: rows {[(r['name'], r['comments']) for r in rows]}")

    # A DCIM CSV is imported as is: a label that opens like a formula stays verbatim (only the BOM guards it).
    eq = page.evaluate("""async () => {
      const X = await import('/site/rack/exports.js');
      const r = window.__rack.doc().racks[0];
      const rack = {...r, items: r.items.filter(i => i.id === 'i2').map(i => ({...i, label: '=leaf'}))};
      return (await X.deviceImportCsv(rack, () => ({manufacturer: 'Edgecore'}), 'netbox')).data;
    }""")
    if not eq.split("\r\n")[1].startswith("=leaf,"):
        bad.append(f"NetBox CSV: a label starting with '=' is not verbatim: {eq[:200]!r}")

    # Positions follow the frame's numbering.
    page.click("#frameBtn")
    page.select_option("#fNumbering", "top-down")
    page.wait_for_function("() => window.__rack.doc().racks[0].frame.numbering === 'top-down'", timeout=READY_MS)
    _, rows, _ = read_csv(export_file(page, "netbox-devices"))
    got = {r["name"]: r["position"] for r in rows}
    if got != {"core-1": "14", "leaf-1": "11", "demarc-i4": "5"}:
        bad.append(f"NetBox CSV: top-down positions {got}")
    got = {r["name"]: r["position"] for r in device_rows(page, "nautobot")}
    if got != {"core-1": "14", "leaf-1": "11", "demarc-i3": "11", "demarc-i4": "5"}:
        bad.append(f"Nautobot CSV: top-down positions {got}")
    return bad


@extra("rack.html: Export - a device type from another vendor's file is said so in the notes, the CSV and the zip's NOTES")
```

with

```python
    return list(csv.DictReader(io.StringIO(export_kit(page, target)[1]["zip"][DEVICES_FILE[target]], newline="")))


@extra("rack.html: Export - the kits' devices files name each device's type, position and face as NetBox and Nautobot read them")
def check_rack_export_device_csv(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    open_fixture(page, base)
    _, kit = export_kit(page, "netbox")
    rows = kit_rows(kit, "2-devices.csv")
    if list(rows[0].keys()) != ["name", "role", "manufacturer", "device_type", "status", "site", "rack", "position", "face", "comments"]:
        bad.append(f"NetBox devices: columns {list(rows[0].keys())}")
    by = {r["name"]: r for r in rows}
    want = {"core-1": ("Cisco", "ASR-9006-AC-V2", "2", "front"), "leaf-1": ("Edgecore", "7726-32X-O-AC-F", "14", "front"),
            "demarc-i4": ("Telco Systems", "TM-280", "20", "rear")}
    for name, (man, dt, pos, face) in want.items():
        r = by.get(name)
        if not r or (r["manufacturer"], r["device_type"], r["position"], r["face"]) != (man, dt, pos, face):
            bad.append(f"NetBox devices: {name} is {r and (r['manufacturer'], r['device_type'], r['position'], r['face'])}")
    # demarc-i3 shares U14 with leaf-1 and both types are full depth: NetBox would refuse the whole file for it.
    left = readme_lists(kit["zip"]["README.txt"])[0]
    if set(by) != set(want) or not any(l.startswith("demarc-i3 is not in the devices file: it shares U14 with leaf-1 on the front") for l in left):
        bad.append(f"NetBox devices: rows {sorted(by)}; the README lists {left}")
    if not all(r["status"] == "planned" and r["rack"] == "Export test" for r in rows):
        bad.append("NetBox devices: status or rack column wrong")
    if "best guess" not in by.get("core-1", {}).get("comments", ""):
        bad.append("NetBox devices: core-1's guessed type is not said in comments")

    rows = device_rows(page, "nautobot")
    leaf = next((r for r in rows if r["name"] == "leaf-1"), {})
    if (leaf.get("device_type__model"), leaf.get("status__name")) != ("7726-32X-O-AC-F", "Planned"):
        bad.append(f"Nautobot devices: leaf-1 is {leaf}")
    # Nautobot accepts the pair at U14, so its file keeps both, and calls neither refused.
    if sorted(r["name"] for r in rows) != ["core-1", "demarc-i3", "demarc-i4", "leaf-1"] or any("refuses" in r["comments"] for r in rows):
        bad.append(f"Nautobot devices: rows {[(r['name'], r['comments']) for r in rows]}")

    # A DCIM CSV is imported as is: a label that opens like a formula stays verbatim (only the BOM guards it).
    eq = page.evaluate("""async () => {
      const X = await import('/site/rack/exports.js');
      const r = window.__rack.doc().racks[0];
      const rack = {...r, items: r.items.filter(i => i.id === 'i2').map(i => ({...i, label: '=leaf'}))};
      return (await X.dcimKit(rack, () => ({manufacturer: 'Edgecore'}), 'netbox')).files['2-devices.csv'];
    }""")
    if not eq.split("\r\n")[1].startswith("=leaf,"):
        bad.append(f"NetBox devices: a label starting with '=' is not verbatim: {eq[:200]!r}")

    # Positions follow the frame's numbering.
    page.click("#frameBtn")
    page.select_option("#fNumbering", "top-down")
    page.wait_for_function("() => window.__rack.doc().racks[0].frame.numbering === 'top-down'", timeout=READY_MS)
    got = {r["name"]: r["position"] for r in device_rows(page, "netbox")}
    if got != {"core-1": "14", "leaf-1": "11", "demarc-i4": "5"}:
        bad.append(f"NetBox devices: top-down positions {got}")
    got = {r["name"]: r["position"] for r in device_rows(page, "nautobot")}
    if got != {"core-1": "14", "leaf-1": "11", "demarc-i3": "11", "demarc-i4": "5"}:
        bad.append(f"Nautobot devices: top-down positions {got}")
    return bad


@extra("rack.html: Export - a device type from another vendor's file is said so in the notes, the devices file and the kit's README")
```

In `check-browser.py`, replace

```python
      const csv = await X.deviceImportCsv(rack, stub, 'netbox');
      const zip = await X.dcimTypesZip(rack, stub, 'netbox');
      const buf = zip.data instanceof Blob ? await zip.data.arrayBuffer() : zip.data;
      return {note: ctx.notes.find(n => n.includes('core-1')) || '', flag: ctx.types.get('i1')?.otherVendor,
              csv: csv.data, zipBytes: Array.from(new Uint8Array(buf.buffer ?? buf))};
```

with

```python
      const kit = await X.dcimKit(rack, stub, 'netbox');
      return {note: ctx.notes.find(n => n.includes('core-1')) || '', flag: ctx.types.get('i1')?.otherVendor,
              csv: kit.files['2-devices.csv'], readme: kit.files['README.txt']};
```

In `check-browser.py`, replace

```python
    with zipfile.ZipFile(io.BytesIO(bytes(got["zipBytes"]))) as z:
        zipNotes = z.read("NOTES.txt").decode() if "NOTES.txt" in z.namelist() else ""
    if "another vendor's (Cisco) file" not in zipNotes:
        bad.append(f"other vendor: the zip's NOTES.txt is {zipNotes!r}")
```

with

```python
    if "another vendor's (Cisco) file" not in got["readme"]:
        bad.append(f"other vendor: the kit's README is {got['readme']!r}")
```

In `check-browser.py`, replace

```python
    _, crows, _ = read_csv(export_file(page, "netbox-devices"))
    if not any("needs a shelf" in r["comments"] for r in crows):
        bad.append(f"device CSV: no mount comment {[r['comments'] for r in crows]}")
```

with

```python
    crows = device_rows(page, "netbox")
    if not any("needs a shelf" in r["comments"] for r in crows):
        bad.append(f"devices file: no mount comment {[r['comments'] for r in crows]}")
```

In `check-browser.py`, replace

```python
    for target, T in (("netbox", "NetBox"),):
        with zipfile.ZipFile(export_file(page, f"{target}-types").path()) as z:
            notes = z.read("NOTES.txt").decode()
        if din not in notes or desk not in notes:
            bad.append(f"{T} types: NOTES.txt lacks the mount notes: {notes[:400]!r}")
    _, crows, _ = read_csv(export_file(page, "netbox-devices"))
    comments = " ".join(r["comments"] for r in crows)
    if "A DIN-rail device, so it needs a shelf or DIN-rail bracket." not in comments:
        bad.append(f"device CSV: no DIN-rail comment: {comments[:300]!r}")
```

with

```python
    _, kit = export_kit(page, "netbox")
    notes = kit["zip"]["README.txt"]
    if din not in notes or desk not in notes:
        bad.append(f"NetBox kit: the README lacks the mount notes: {notes[:400]!r}")
    comments = " ".join(r["comments"] for r in kit_rows(kit, "2-devices.csv"))
    if "A DIN-rail device, so it needs a shelf or DIN-rail bracket." not in comments:
        bad.append(f"devices file: no DIN-rail comment: {comments[:300]!r}")
```

In `check-browser.py`, replace

```python
@extra("rack.html: Export - a swap that failed is in the BOM's and the zip's notes; the status counts only what the file carries")
```

with

```python
@extra("rack.html: Export - a swap that failed is in the BOM's and the kits' notes; the status counts only what the file carries")
```

In `check-browser.py`, replace

```python
        with zipfile.ZipFile(export_file(page, f"{target}-types").path()) as z:
            zip_notes = z.read("NOTES.txt").decode()
        if failed not in zip_notes:
            bad.append(f"{target} types: a swap that could not be loaded is not in NOTES.txt: {zip_notes!r}")

    # The device CSV carries its rows' comments and nothing else.
    rows = device_rows(page)
    status = page.inner_text("#exportStatus")
    carried = len([r for r in rows if r["comments"]])
    if not carried or status != notes_status(carried):
        bad.append(f"device CSV: {carried} rows have comments, but the status reads {status!r}")
    got = page.evaluate("""async () => {
      const X = await import('/site/rack/exports.js'), E = await import('/site/rack/export-data.js');
      const r = window.__rack.doc().racks[0];
      const lookup = () => ({manufacturer: 'Edgecore', ru: 1});
      const wired = {...r, items: r.items.filter(i => i.id === 'i2'), cables: [{}], zeroU: [{}, {}]};
      const csv = await X.deviceImportCsv(wired, lookup, 'netbox');
      // A model's notes, with a scene that exports nothing: only the notes are under test.
      const scene = {running: () => false, complete: async () => {}, three: {scene: {userData: {}}},
                     toGLB: async () => new Uint8Array(4), toUSDZ: async () => new Uint8Array(4)};
      const ghost = {...r, items: [...r.items, {id: 'i9', ref: 'no-such-device', cfg: 'base', label: 'mystery',
        ru: 22, face: 'front', turned: false, swaps: {}, fields: {}}]};
      const glb = await X.modelFile(scene, ghost, 'glb');
      const extras = [...scene.three.scene.userData.portrayal.notes];
      const usdz = await X.modelFile(scene, ghost, 'usdz');
      return {csvStatus: E.exportStatus(csv), csvData: csv.data, glbNotes: glb.notes, extras,
              glbStatus: E.exportStatus(glb), usdzStatus: E.exportStatus(usdz), usdzNotes: usdz.notes};
    }""")
    want = ("Downloaded, with 1 note in the file. Not in the file: 2 zero-U items are not in this export yet. "
            "1 cable is not in this export yet.")
    if got["csvStatus"] != want:
        bad.append(f"device CSV with cables: the status reads {got['csvStatus']!r}")
    if "not in this export yet" in got["csvData"]:
        bad.append("device CSV with cables: a rack-level note is in the file after all; the status is wrong")
```

with

```python
        _, kit = export_kit(page, target)
        status = export_status(page)
        left, notes = readme_lists(kit["zip"]["README.txt"])
        if failed not in notes:
            bad.append(f"{target} kit: a swap that could not be loaded is not in the README's notes: {notes!r}")
        # The kit's notes are its README's: the blank-settings warning, what is left out, and the notes.
        if status != notes_status(1 + len(left) + len(notes)):
            bad.append(f"{target} kit: the README carries {1 + len(left) + len(notes)} notes, but the status reads {status!r}")

    got = page.evaluate("""async () => {
      const X = await import('/site/rack/exports.js'), E = await import('/site/rack/export-data.js');
      const r = window.__rack.doc().racks[0];
      const lookup = () => ({manufacturer: 'Edgecore', ru: 1});
      const wired = {...r, items: r.items.filter(i => i.id === 'i2'), zeroU: [{}, {}],
        cables: [{id: 'c1', a: {item: 'i2', path: 'port-1', view: 'front'}, b: {item: 'i2', path: 'port-2', view: 'front'},
                  media: 'os2', purpose: '', label: '', route: []}]};
      const kit = await X.dcimKit(wired, lookup, 'netbox');
      // A model's notes, with a scene that exports nothing: only the notes are under test.
      const scene = {running: () => false, complete: async () => {}, three: {scene: {userData: {}}},
                     toGLB: async () => new Uint8Array(4), toUSDZ: async () => new Uint8Array(4)};
      const ghost = {...r, items: [...r.items, {id: 'i9', ref: 'no-such-device', cfg: 'base', label: 'mystery',
        ru: 22, face: 'front', turned: false, swaps: {}, fields: {}}]};
      const glb = await X.modelFile(scene, ghost, 'glb');
      const extras = [...scene.three.scene.userData.portrayal.notes];
      const usdz = await X.modelFile(scene, ghost, 'usdz');
      return {kitStatus: E.exportStatus(kit), kitNotes: kit.notes, readme: kit.files['README.txt'], glbNotes: glb.notes, extras,
              glbStatus: E.exportStatus(glb), usdzStatus: E.exportStatus(usdz), usdzNotes: usdz.notes};
    }""")
    # A kit carries the cables, so it never says they are left out; what it does leave out (zero-U items) is in its README.
    left, notes = readme_lists(got["readme"])
    if "2 zero-U items are not in this export yet." not in notes or any("cable is not in this export yet" in n for n in left + notes):
        bad.append(f"kit with cables and zero-U items: the README's notes are {notes}")
    if got["kitStatus"] != notes_status(len(got["kitNotes"])) or len(got["kitNotes"]) != 1 + len(left) + len(notes):
        bad.append(f"kit with cables and zero-U items: {len(got['kitNotes'])} notes, README {1 + len(left) + len(notes)}, status {got['kitStatus']!r}")
```

In `check-browser.py`, replace

```python
    for target, T in (("netbox", "NetBox"), ("nautobot", "Nautobot")):
        dl = export_file(page, f"{target}-types")
        ok_status(f"{target}-types")
        with zipfile.ZipFile(dl.path()) as z:
            names = z.namelist()
            notes = z.read("NOTES.txt").decode() if "NOTES.txt" in names else ""
        if names != ["NOTES.txt"]:
            bad.append(f"empty rack {T} types: entries {names}")
        if f"This rack has no devices, so there are no {T} types in this zip." not in notes or "Every device" in notes:
            bad.append(f"empty rack {T} types: NOTES.txt reads {notes!r}")
        dl = export_file(page, f"{target}-devices")
        cols, rows, text = read_csv(dl)
        if rows or not cols or cols[0] != "name" or text.count("\r\n") != 1:
            bad.append(f"empty rack {T} devices: not a header alone: {text!r}")
        if page.inner_text("#exportStatus") != "Downloaded.":
            bad.append(f"empty rack {T} devices: the status reads {page.inner_text('#exportStatus')!r}")
```

with

```python
    for target, T, files in (("netbox", "NetBox", ["1-rack.csv", "2-devices.csv", "3-modules.csv", "4-cables.csv"]),
                             ("nautobot", "Nautobot", ["1-devices.csv", "2-modules.csv", "3-cables.csv", "import_cables.py"])):
        _, kit = export_kit(page, target)
        ok_status(f"{target}-import")
        if kit["names"] != files + ["README.txt"]:
            bad.append(f"empty rack {T} kit: entries {kit['names']}")
        # Every CSV is there with its header alone - except the NetBox rack file, which is the rack itself.
        for name in files:
            text = kit["zip"].get(name, "")
            if name.endswith(".csv") and text.count("\r\n") != (2 if name == "1-rack.csv" else 1):
                bad.append(f"empty rack {T} kit: {name} is not a header alone: {text!r}")
        readme = kit["zip"]["README.txt"]
        if "This rack has no devices, so there is nothing to import." not in readme_lists(readme)[1] or \
                "1. types/: no files, so there is nothing to import." not in readme or \
                "(no rows: it holds its header only, so skip it)" not in readme:
            bad.append(f"empty rack {T} kit: the README reads {readme!r}")
```

In `check-browser.py`, replace

```python
          return {sched: (await X.cableScheduleCsv(rack, of)).data, dev: (await X.deviceImportCsv(rack, of, 'nautobot')).data};
```

with

```python
          return {sched: (await X.cableScheduleCsv(rack, of)).data, dev: (await X.dcimKit(rack, of, 'nautobot')).files['1-devices.csv']};
```

Run: `python3 check-browser.py --only check_rack_export_dcim_types`
Expected: `FAIL`, "Page.wait_for_function: Timeout 60000ms exceeded." The menu has no `nautobot-import` entry yet.

- [ ] **Step 2: Retire NOTES.txt's tests**

In `tests/rack/dcim.test.mjs`, delete

```js
test('a rack with no devices does not claim every device matched', () => {
  assert.equal(X.dcimNotesText({rackName: 'Empty', target: 'netbox', date: DAY, notes: [], devices: 0}),
    'NetBox types for Empty, from the Portrayal Rack Builder, 2026-09-27.\n\n' +
    'This rack has no devices, so there are no NetBox types in this zip.\n');
  assert.equal(X.dcimNotesText({rackName: 'Empty', target: 'nautobot', date: DAY, notes: ['a'], devices: 0}),
    'Nautobot types for Empty, from the Portrayal Rack Builder, 2026-09-27.\n\n' +
    'This rack has no devices, so there are no Nautobot types in this zip.\n- a\n');
  assert.match(X.dcimNotesText({rackName: 'R', target: 'netbox', date: DAY, notes: [], devices: 2}), /Every device and part/);
});
```

In `tests/rack/dcim.test.mjs`, replace

```js
test('NOTES.txt heads its list, or says everything matched', () => {
  assert.equal(X.dcimNotesText({rackName: 'Export test', target: 'netbox', date: DAY, notes: []}),
    'NetBox types for Export test, from the Portrayal Rack Builder, 2026-09-27.\n\n' +
    'Every device and part in this rack matched a NetBox type.\n');
  assert.equal(X.dcimNotesText({rackName: 'R', target: 'nautobot', date: DAY, notes: ['a', 'b']}),
    'Nautobot types for R, from the Portrayal Rack Builder, 2026-09-27.\n\n- a\n- b\n');
});

test('a type from another vendor says so in the row\'s comments, as NOTES.txt does', () => {
```

with

```js
test('a type from another vendor says so in the row\'s comments, as the README does', () => {
```

- [ ] **Step 3: The menu**

In `site/rack-page.js`, replace

```js
import {sheetSvg, sheetPng, drawioFile, modelFile, dcimTypesZip, deviceImportCsv, bomCsv, cableScheduleCsv, failExport} from './rack/exports.js';
```

with

```js
import {sheetSvg, sheetPng, drawioFile, modelFile, dcimKit, bomCsv, cableScheduleCsv, failExport} from './rack/exports.js';
```

In `site/rack-page.js`, replace

```js
  'netbox-types': () => dcimTypesZip(rack(), chassisOf, 'netbox'),
  'nautobot-types': () => dcimTypesZip(rack(), chassisOf, 'nautobot'),
  'netbox-devices': () => deviceImportCsv(rack(), chassisOf, 'netbox'),
  'nautobot-devices': () => deviceImportCsv(rack(), chassisOf, 'nautobot'),
```

with

```js
  'netbox-import': () => dcimKit(rack(), chassisOf, 'netbox'),
  'nautobot-import': () => dcimKit(rack(), chassisOf, 'nautobot'),
```

In `site/rack-page.js`, replace

```js
    act('netbox-types', 'NetBox device types (.zip)'),
    act('nautobot-types', 'Nautobot device types (.zip)'),
    act('netbox-devices', 'NetBox device import (.csv)', 'Fill in role and site before importing'),
    act('nautobot-devices', 'Nautobot device import (.csv)', 'Fill in role and location before importing'),
```

with

```js
    act('netbox-import', 'NetBox import (.zip)',
        'Device and module types, the rack, devices, modules and cables, numbered in import order, with a README'),
    act('nautobot-import', 'Nautobot import (.zip)',
        'Device and module types, devices, modules and cables, a script that creates the cables, and a README'),
```

`rack()` is read when the entry is clicked, as for every other export.

- [ ] **Step 4: Remove the old builders**

In `site/rack/exports.js`, replace

```js
// sheet, a comment in the draw.io file, NOTES.txt in a zip, a comments
// column or a notes section in a CSV - rather than dropping it. A file with
// no place for a note (a USDZ, a device CSV's rack-level notes) returns it
// as `left` instead, with `leftText` when one sentence says it better, and
// the status line says so (exportStatus).
```

with

```js
// sheet, a comment in the draw.io file, README.txt in an import kit, a notes
// section in a CSV - rather than dropping it. A file with no place for a
// note (a USDZ) returns it as `left` instead, with `leftText` when one
// sentence says it better, and the status line says so (exportStatus).
```

In `site/rack/exports.js`, replace

```js
        stemOf, vendorOf, otherVendorNote, deviceImportRows, toCsv, dcimNotesText, isSeatedPath, TARGET_NAME,
```

with

```js
        stemOf, vendorOf, otherVendorNote, deviceImportRows, toCsv, isSeatedPath, TARGET_NAME,
```

In `site/rack/exports.js`, replace

```js
// part with its module type. `cables: false` is for a file that carries the
// cables, and so does not say they are left out. A type file that cannot be
// read costs that one type, never the export: the device or the part is then
// one with no type, and a note says which file it was.
export async function dcimContext(rack, chassisOf, target, {modules = true, cables = true} = {}) {
  const T = TARGET_NAME[target];
  const [index, files, comps] = await Promise.all([
    fetchJson(`${EXPORTS_BASE}index.json`), fetchJson(`${EXPORTS_BASE}files.json`), components()]);
  const items = itemsWithU(rack, chassisOf);
  const notes = [...rackNotes(rack, {cables}), ...mountNotes(items, chassisOf, rack.frame)];
```

with

```js
// part with its module type. The import kits carry the cables, so no note
// here says they are left out. A type file that cannot be read costs that one
// type, never the export: the device or the part is then one with no type,
// and a note says which file it was.
export async function dcimContext(rack, chassisOf, target, {modules = true} = {}) {
  const T = TARGET_NAME[target];
  const [index, files, comps] = await Promise.all([
    fetchJson(`${EXPORTS_BASE}index.json`), fetchJson(`${EXPORTS_BASE}files.json`), components()]);
  const items = itemsWithU(rack, chassisOf);
  const notes = [...rackNotes(rack, {cables: false}), ...mountNotes(items, chassisOf, rack.frame)];
```

In `site/rack/exports.js`, delete

```js
export async function dcimTypesZip(rack, chassisOf, target, {date = new Date()} = {}) {
  const ctx = await dcimContext(rack, chassisOf, target);
  const enc = new TextEncoder();
  const paths = uniq([...ctx.types.values()].filter(Boolean).map(t => t.path)
    .concat(ctx.modules.map(m => m.path).filter(Boolean))).sort();
  const entries = [];
  for (const p of paths) {
    try { entries.push({name: p.split('/').slice(1).join('/'), bytes: enc.encode(await fetchText(exportUrl(p)))}); }
    catch { ctx.notes.push(`${p} couldn't be fetched, so it is not in this zip.`); }
  }
  entries.push({name: 'NOTES.txt', bytes: enc.encode(dcimNotesText({rackName: rack.name, target, date, notes: ctx.notes,
                                                                    devices: ctx.items.length}))});
  return {name: `${fileStem(rack.name)}-${target}-types.zip`, data: await makeZip(entries, date),
          type: 'application/zip', notes: ctx.notes};
}

// The device import (spec §8): one row per rail item the target will take.
// Pure CSV so it imports as is; each row's notes are in its own comments
// column, and those are the notes the file carries. A rack-level note (zero-U
// items, cables) and a device left out of the file (export-data.js
// deviceImportRows) have no row to sit in, so they come back as `left`.
export async function deviceImportCsv(rack, chassisOf, target) {
  const ctx = await dcimContext(rack, chassisOf, target, {modules: false});
  const {columns, rows, left} = deviceImportRows({rack, items: ctx.items, types: ctx.types, target});
  return {name: `${fileStem(rack.name)}-${target}-devices.csv`, data: toCsv(columns, rows),
          type: 'text/csv', notes: rows.map(r => r.comments).filter(Boolean),
          left: [...rackNotes(rack), ...left.map(l => l.reason)]};
}
```

In `site/rack/exports.js`, replace

```js
  const ctx = await dcimContext(rack, chassisOf, target, {cables: false});
```

with

```js
  const ctx = await dcimContext(rack, chassisOf, target);
```

- [ ] **Step 5: Remove NOTES.txt's text**

In `site/rack/export-data.js`, replace

```js
// cables (the sheet, draw.io, the 3D model, the BOM, the cable schedule)
// passes {cables: false}; one that does not (the DCIM types and the device
// import) keeps the line.
```

with

```js
// cables passes {cables: false}, and since Phase 2c every export does: the
// sheet, draw.io, the 3D model, the BOM, the cable schedule and both DCIM
// import kits. The line is kept for an export that one day does not.
```

In `site/rack/export-data.js`, replace

```js
// The one wording for "this type is another vendor's file", shared by
// NOTES.txt and the device CSV's comments column.
```

with

```js
// The one wording for "this type is another vendor's file", shared by a
// kit's README and its devices file's comments column.
```

In `site/rack/export-data.js`, delete

```js
}

// `devices` is how many the rack has: with none, nothing matched anything.
export function dcimNotesText({rackName, target, date, notes, devices}) {
  const T = TARGET_NAME[target] || 'NetBox';
  const list = notes.map(n => `- ${n}`);
  const body = (devices === 0 ? [`This rack has no devices, so there are no ${T} types in this zip.`, ...list]
    : list.length ? list : [`Every device and part in this rack matched a ${T} type.`]).join('\n');
  return `${T} types for ${rackName}, from the Portrayal Rack Builder, ${isoDate(date)}.\n\n${body}\n`;
```

- [ ] **Step 6: Run everything this task touches and see it pass**

Run: `node --test tests/rack/*.test.mjs`
Expected: `# tests 183`, `# pass 183`, `# fail 0` (two tests went with `dcimNotesText`).

Run: `grep -rn "dcimTypesZip\|deviceImportCsv\|dcimNotesText\|netbox-types\|nautobot-devices" site tests check-browser.py`
Expected: no output.

Run: `python3 check-browser.py --only check_rack_export_dcim_types,check_rack_export_device_csv,check_rack_export_other_vendor,check_rack_export_emptied_slot,check_rack_mount_flag,check_rack_mount_flag_3d_exports,check_rack_export_notes_truthful,check_rack_export_empty,check_rack_export_cable_schedule,check_rack_export_cable_failures,check_rack_one_u,check_rack_dcim_kit_netbox,check_rack_dcim_kit_nautobot,check_rack_dcim_settings`
Expected: fourteen `ok` lines.

- [ ] **Step 7: Commit**

```bash
git add site/rack-page.js site/rack/exports.js site/rack/export-data.js tests/rack/dcim.test.mjs check-browser.py
git commit -m "rack: Export - one import kit per target, in place of the types zip and the devices CSV

NetBox import (.zip) and Nautobot import (.zip) replace the four DCIM entries.
The kits carry the cables, so no DCIM export says cables are left out any
more, and NOTES.txt is the kit's README. The old builders are removed, and
the checks that read them read the kits.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The verification kit moves into the repository, with an acceptance rack and a scripted export of its two kits

Ruling 10: the verification kit moves into the repository, under `tools/dcim-verify/`, so the acceptance can be run again after any Portrayal sync; it has no credentials, reads environment variables only, names everything `pt-verify-…`, and keeps its dry run and cleanup. This task moves in what exists (the column probes that produced `result.json`), and adds the two things the acceptance needs from the page:
- **`acceptance.rack.json`**: the rack the acceptance imports. It is the cable fixture with every name the rack can give prefixed `pt-verify-` (the rack, the devices, the cable labels, the site and the role), so that everything the kits create in an instance can be found again and deleted. It has six cables, chosen so that the two kits between them hold a card port, a cross-face copper run, a cable with no media and a decimal length in feet, a loose end, a cable to the device NetBox's file leaves out, and a console port cabled to an interface.
- **`export_kits.py`**: opens that rack in the Rack Builder, headless, and clicks Export > NetBox import and Export > Nautobot import, as a user would. The two downloads are saved untouched.

A browser check holds the acceptance rack's kits to what the real-instance run expects, so a Portrayal sync that renames a port or a type shows up in CI, not in the user's NetBox.

**Files:**
- Create: `tools/dcim-verify/verify.py` and `tools/dcim-verify/fixture/` (copied, unchanged), `tools/dcim-verify/acceptance.rack.json`, `tools/dcim-verify/export_kits.py`
- Modify: `.gitignore`, `check-browser.py`

**Interfaces:**
- Consumes: `open_cabled`, `export_file`, `export_status`, `free_port`, `wait_for` from `check-browser.py`; `built_kit`, `kit_rows`, `readme_lists` (Task 7); the menu entries of Task 8.
- Produces: `tools/dcim-verify/acceptance.rack.json`; `python3 tools/dcim-verify/export_kits.py`, which writes `tools/dcim-verify/kits/pt-verify-rack-netbox-import.zip` and `tools/dcim-verify/kits/pt-verify-rack-nautobot-import.zip` (or into `$PT_VERIFY_KITS`).

- [ ] **Step 1: Move the kit in, unchanged**

```bash
mkdir -p tools/dcim-verify
cp .superpowers/sdd/rack-2c/dcim-verify-kit/verify.py tools/dcim-verify/verify.py
cp -R .superpowers/sdd/rack-2c/dcim-verify-kit/fixture tools/dcim-verify/fixture
shasum -a 256 tools/dcim-verify/verify.py
find tools/dcim-verify/fixture -type f | wc -l
```

Expected: the checksum is `7f38d245f6a84347067e9e57afa9c70713dd66feb2607f5ee63b7392903d223b`, and there are 56 fixture files. Do not copy `result.json` or `out/`: they are a run's output, and name the user's hosts. Do not copy `README.md`: Task 10 writes the new one.

`verify.py` finds its fixture and writes its results beside itself, so it needs no edit. Check that it still runs offline:

Run: `python3 tools/dcim-verify/verify.py plan | tail -3`
Expected: the last line is `Nothing was sent. "verify.py run" does this; "verify.py cleanup" removes it.`

- [ ] **Step 2: Keep a run's output out of git**

In `.gitignore`, replace

```text
/public/
.wrangler/
```

with

```text
/public/

# What tools/dcim-verify writes: the exported kits, a run's results, and the
# pages of refused imports. A result names a test instance's host.
/tools/dcim-verify/kits/
/tools/dcim-verify/out/
/tools/dcim-verify/result.json
/tools/dcim-verify/kits-result.json
.wrangler/
```

- [ ] **Step 3: Write the failing check**

In `check-browser.py`, add before `def main():`

```python
@extra("rack.html: the acceptance rack (tools/dcim-verify) exports the kits its real-instance run expects: prefixed names, the rows each target takes, a reason for the rest")
def check_rack_dcim_acceptance_kits(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    fixture = json.loads((HERE / "tools" / "dcim-verify" / "acceptance.rack.json").read_text(encoding="utf-8"))
    try:
        open_cabled(page, base, fixture)
    except RuntimeError as e:
        return bad + [f"acceptance rack: {e}"]
    nb, nt = built_kit(page, "netbox"), built_kit(page, "nautobot")
    # Everything the kits name that the rack can name carries the prefix cleanup deletes by.
    own = {"1-rack.csv": ["site", "name"], "2-devices.csv": ["name", "role", "site", "rack"], "3-modules.csv": ["device"],
           "4-cables.csv": ["side_a_device", "side_b_device", "label"]}
    for name, cols in own.items():
        for r in kit_rows(nb, name):
            if any(not r[c].startswith("pt-verify-") for c in cols):
                bad.append(f"acceptance rack: {name} has a name without the prefix: {r}")
    for r in kit_rows(nt, "3-cables.csv") + kit_rows(nt, "1-devices.csv"):
        if any(not r[c].startswith("pt-verify-") for c in r if c in ("a_device", "b_device", "label", "name", "role__name", "location__name", "rack__name")):
            bad.append(f"acceptance rack: a Nautobot row has a name without the prefix: {r}")
    if "WILL BE REFUSED" in nb["zip"]["README.txt"] + nt["zip"]["README.txt"]:
        bad.append("acceptance rack: a kit says its devices file will be refused; the rack's settings are not in it")
    # NetBox: three of the four devices, and three cables - one of them with no type and a decimal length in feet.
    if [r["name"] for r in kit_rows(nb, "2-devices.csv")] != ["pt-verify-demarc-i4", "pt-verify-leaf-1", "pt-verify-core-1"]:
        bad.append(f"acceptance rack: NetBox devices {[r['name'] for r in kit_rows(nb, '2-devices.csv')]}")
    got = [(r["label"], r["side_a_name"], r["side_b_name"], r["type"], r["length"], r["length_unit"]) for r in kit_rows(nb, "4-cables.csv")]
    if got != [("pt-verify-A1", "port-1", "slot-2/p0", "smf-os2", "2", "m"), ("pt-verify-mgmt", "mgmt-eth", "port-2-1", "cat6a", "", ""),
               ("pt-verify-blank", "port-3", "slot-2/p1", "", "1.5", "ft")]:
        bad.append(f"acceptance rack: NetBox cables {got}")
    left = readme_lists(nb["zip"]["README.txt"])[0]
    if [l.split(":")[0] for l in left] != ["pt-verify-demarc-i3 is not in the devices file", "Cable pt-verify-loose is not in the cables file",
                                           "Cable pt-verify-pair is not in the cables file", "Cable pt-verify-console is not in the cables file"]:
        bad.append(f"acceptance rack: NetBox leaves out {left}")
    # Nautobot: all four devices, four cables with whole lengths, and a console port to an interface refused by name.
    if len(kit_rows(nt, "1-devices.csv")) != 4:
        bad.append(f"acceptance rack: Nautobot devices {[r['name'] for r in kit_rows(nt, '1-devices.csv')]}")
    got = [(r["label"], r["type"], r["length"], r["length_unit"]) for r in kit_rows(nt, "3-cables.csv")]
    if got != [("pt-verify-A1", "smf-os2", "2", "m"), ("pt-verify-mgmt", "cat6a", "", ""), ("pt-verify-pair", "cat6", "2", "ft"),
               ("pt-verify-blank", "", "2", "ft")]:
        bad.append(f"acceptance rack: Nautobot cables {got}")
    left, notes = readme_lists(nt["zip"]["README.txt"])
    if left != ["Cable pt-verify-loose is not in the cables file: end A, pt-verify-leaf-1 (U14) port-2, is not connected (port-2 holds no optic).",
                "Cable pt-verify-console is not in the cables file: Nautobot does not cable a console port to an interface."]:
        bad.append(f"acceptance rack: Nautobot leaves out {left}")
    if "Cable pt-verify-pair: 1.5 ft is written as 2 ft: Nautobot takes whole numbers, and a length is rounded up." not in notes:
        bad.append(f"acceptance rack: the README does not say a length was rounded up: {notes}")
    return bad
```

Run: `python3 check-browser.py --only check_rack_dcim_acceptance_kits`
Expected: `FAIL`, "[Errno 2] No such file or directory: '…/tools/dcim-verify/acceptance.rack.json'".

- [ ] **Step 4: The acceptance rack**

Create `tools/dcim-verify/acceptance.rack.json`:

```json
{
  "format": "portrayal-rack",
  "version": 1,
  "id": "doc-dcim-acceptance",
  "racks": [
    {
      "id": "r1",
      "name": "pt-verify-rack",
      "frame": {"kind": "four-post", "heightRU": 24, "numbering": "bottom-up",
                "holes": {"style": "square", "thread": null}, "railDepth": 740, "usableDepth": 1000, "ref": null},
      "dcim": {"site": "pt-verify-site", "role": "pt-verify-role"},
      "items": [
        {"id": "i1", "ref": "asr-9006", "cfg": "base", "label": "pt-verify-core-1", "ru": 2, "face": "front", "turned": false,
         "swaps": {"slot-2": "cisco/a9k-16x100ge-tr@1", "slot-2/module/p0": "generic/qsfp-lc@2", "slot-2/module/p1": "generic/qsfp-lc@2"},
         "fields": {}},
        {"id": "i2", "ref": "as7726-32x", "cfg": "ac-f2b", "label": "pt-verify-leaf-1", "ru": 14, "face": "front", "turned": false,
         "swaps": {"port-1": "generic/qsfp-lc@2", "port-3": "generic/qsfp-lc@2"}, "fields": {}},
        {"id": "i3", "ref": "tm-280", "cfg": "base", "label": "pt-verify-demarc", "ru": 14, "face": "rear", "turned": false,
         "swaps": {}, "fields": {}},
        {"id": "i4", "ref": "tm-280", "cfg": "base", "label": "pt-verify-demarc", "ru": 20, "face": "rear", "turned": false,
         "swaps": {}, "fields": {}}
      ],
      "zeroU": [],
      "cables": [
        {"id": "c1", "a": {"item": "i2", "path": "port-1", "view": "front"}, "b": {"item": "i1", "path": "slot-2/module/p0", "view": "front"},
         "media": "os2", "purpose": "uplink", "label": "pt-verify-A1", "length": {"value": 2, "unit": "m", "source": "entered"}, "route": []},
        {"id": "c2", "a": {"item": "i2", "path": "mgmt-eth", "view": "front"}, "b": {"item": "i4", "path": "port-2-1", "view": "front"},
         "media": "cat6a", "purpose": "management", "label": "pt-verify-mgmt", "route": []},
        {"id": "c3", "a": {"item": "i2", "path": "port-2", "view": "front"}, "b": {"item": "i3", "path": "port-2-1", "view": "front"},
         "media": "os2", "purpose": "uplink", "label": "pt-verify-loose", "route": []},
        {"id": "c4", "a": {"item": "i4", "path": "port-2-2", "view": "front"}, "b": {"item": "i3", "path": "port-2-2", "view": "front"},
         "media": "cat6", "purpose": "handoff", "label": "pt-verify-pair", "length": {"value": 1.5, "unit": "ft", "source": "entered"}, "route": []},
        {"id": "c5", "a": {"item": "i2", "path": "port-3", "view": "front"}, "b": {"item": "i1", "path": "slot-2/module/p1", "view": "front"},
         "media": "", "purpose": "uplink", "label": "pt-verify-blank", "length": {"value": 1.5, "unit": "ft", "source": "entered"}, "route": []},
        {"id": "c6", "a": {"item": "i4", "path": "con", "view": "front"}, "b": {"item": "i3", "path": "copper-3-1", "view": "front"},
         "media": "cat6", "purpose": "console", "label": "pt-verify-console", "route": []}
      ]
    }
  ]
}
```

Run: `python3 check-browser.py --only check_rack_dcim_acceptance_kits`
Expected: `ok`.

- [ ] **Step 5: The scripted export**

Create `tools/dcim-verify/export_kits.py`:

```python
#!/usr/bin/env python3
"""Export the two import kits for acceptance.rack.json, as a user would.

    python3 tools/dcim-verify/export_kits.py

Starts this repository's own dev server, opens rack.html in a headless
browser, opens acceptance.rack.json, and clicks Export > NetBox import and
Export > Nautobot import. The two downloads are saved, untouched, under
tools/dcim-verify/kits/. kits.py imports them. Needs Playwright, as
check-browser.py does; it contacts nothing but the local server.
"""
import importlib.util
import json
import os
import pathlib
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent.parent
OUT = pathlib.Path(os.environ.get('PT_VERIFY_KITS') or HERE / 'kits')


def main():
    spec = importlib.util.spec_from_file_location('check_browser', ROOT / 'check-browser.py')
    cb = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(cb)
    from playwright.sync_api import sync_playwright
    fixture = json.loads((HERE / 'acceptance.rack.json').read_text(encoding='utf-8'))
    port = cb.free_port()
    server = subprocess.Popen([sys.executable, str(ROOT / 'serve.py'), str(port), '--bind', '127.0.0.1'], cwd=ROOT,
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        base = f'http://127.0.0.1:{port}'
        cb.wait_for(f'{base}/rack.html')
        OUT.mkdir(parents=True, exist_ok=True)
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            page = browser.new_page(accept_downloads=True)
            cb.open_cabled(page, base, fixture)
            for target in ('netbox', 'nautobot'):
                dl = cb.export_file(page, f'{target}-import')
                status = cb.export_status(page)
                dest = OUT / dl.suggested_filename
                dl.save_as(dest)
                print(f'{dest}  ({status})')
            browser.close()
    finally:
        server.terminate()
    return 0


if __name__ == '__main__':
    sys.exit(main())
```

Run: `python3 tools/dcim-verify/export_kits.py`
Expected: two lines, each a path under `tools/dcim-verify/kits/` followed by `(Downloaded, with 9 notes in the file.)`. It takes a few seconds.

Run: `unzip -l tools/dcim-verify/kits/pt-verify-rack-nautobot-import.zip | tail -7 && git status --short tools/`
Expected: the listing ends with `1-devices.csv`, `2-modules.csv`, `3-cables.csv`, `import_cables.py`, `README.txt`; `git status` shows `tools/dcim-verify/` as new and does not list `kits/`.

- [ ] **Step 6: Commit**

```bash
git add tools/dcim-verify/verify.py tools/dcim-verify/fixture tools/dcim-verify/acceptance.rack.json tools/dcim-verify/export_kits.py .gitignore check-browser.py
git commit -m "tools: the DCIM verification kit moves into the repository, with an acceptance rack

tools/dcim-verify/ holds the column probes that established what NetBox 4.7
and Nautobot 3.2 accept, a rack whose every name carries the pt-verify-
prefix, and a script that exports its two import kits from the page as a user
would. A browser check holds those kits to what the acceptance expects.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: The acceptance: `kits.py` imports the really exported kits, and the user runs it

Ruling 10: the kit imports the Rack Builder's real exported kits for the acceptance rack into each instance, **for NetBox through the UI import pages in the README's order; for Nautobot the CSVs over `text/csv` and then the kit's own `import_cables.py`**, and reports per file and per row, plus a comparison of the cables each instance ends up with against the rack's.

`kits.py` reuses `verify.py`'s client (one host per target, no redirect off it, credentials from the environment and redacted from everything it writes), its UI import, its `text/csv` POST and its result record. What it adds: reading the two zips, creating first what each README says must already exist, sending each file in the README's order, running the kit's own script as a subprocess, and the comparison.

One thing it changes in what it sends, and says so per step: a manufacturer and a type are renamed with the `pt-verify-` prefix, in each YAML's identity lines and in the CSV cells that name them. A rack cannot name those, and without the prefix the run would create a "Cisco" in the user's instance that cleanup could not tell from theirs. Every other cell goes in as the kit has it. A kit holding any other name without the prefix is refused before anything is sent.

`selftest.py` runs `kits.py` end to end against a mock NetBox and Nautobot, and `check-contract.py` runs it. **That shows the tool works. It does not show that a real instance accepts the kits.** Step 7 is that run, and only the user can do it.

**Files:**
- Create: `tools/dcim-verify/kits.py`, `tools/dcim-verify/selftest.py`, `tools/dcim-verify/README.md`
- Modify: `check-contract.py`

**Interfaces:**
- Consumes: from `tools/dcim-verify/verify.py`: `Client`, `Run`, `Refused`, `nb_import`, `nt_csv`, `nt_post_json`, `nt_ui_type`, `NT_TEMPLATES`, `prefixed_yaml`, `header_row`, `targets`, `say`, `redact`, `clip`, `PREFIX`, `ENV`. The two zips of Task 9. `site/rack/nautobot/import_cables.py` (Task 6), as it is inside the Nautobot zip.
- Produces: `python3 tools/dcim-verify/kits.py plan|run [netbox|nautobot|all] [--continue]`, which writes `tools/dcim-verify/kits-result.json` (or `$PT_VERIFY_RESULT`) and exits 0 only when no step failed. Per target its steps are: `login`, the `prereq_…` steps, one `types_…` step per YAML, `kit_racks` (NetBox), `kit_devices`, `kit_modules`, `kit_cables` (NetBox), `script_dry_run` and `script_apply` (Nautobot), and `cables_compared`.

- [ ] **Step 1: Write the failing self-test**

Create `tools/dcim-verify/selftest.py`:

```python
#!/usr/bin/env python3
"""kits.py, run end to end against a mock NetBox and a mock Nautobot.

    python3 tools/dcim-verify/selftest.py

No real instance is contacted and no browser is needed: the two kits are
small ones built here (with the repository's real import_cables.py), and the
mock is a local HTTP server that answers as the real instances did in the
verification run of 2026-10-04. It shows that kits.py sends each file in the
README's order, prefixes only the cells it says it does, runs the kit's own
script, compares the cables, refuses a kit with a name it could not clean up,
and keeps every credential out of its output. It does NOT show that a real
NetBox or Nautobot accepts the files: only "kits.py run" does.
"""
import csv
import http.server
import io
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import threading
import unittest
import urllib.parse
import zipfile

HERE = pathlib.Path(__file__).resolve().parent
SCRIPT = HERE.parent.parent / 'site' / 'rack' / 'nautobot' / 'import_cables.py'
PASSWORD, TOKEN = 'made-up-pass-phrase-77', 'made-up-token-0123456789abcdef'
CSRF = 'CSRFCSRFCSRFCSRFCSRFCSRF12345678'
PAGE = '<html><form><input type="hidden" name="csrfmiddlewaretoken" value="%s"></form>%%s</html>' % CSRF

DEVICE_YAML = '---\nmanufacturer: Acme\nmodel: SW-1\nslug: acme-sw-1\nu_height: 1.0\nis_full_depth: true\ninterfaces:\n  - name: port-1\n    type: 1000base-t\nmodule-bays:\n  - name: Slot 1\n    position: slot-1\n'
MODULE_YAML = "---\nmanufacturer: Acme\nmodel: CARD-1\ninterfaces:\n  - name: '{module}/p0'\n    type: 1000base-t\n"
README = 'NetBox import kit\n\nNOT IN THIS KIT:\n- Cable pt-verify-loose is not in the cables file: end A is not connected.\n\nNOTES:\n- A note.\n'
NETBOX = {
    'types/device-types/Acme/SW-1.yaml': DEVICE_YAML, 'types/module-types/Acme/CARD-1.yaml': MODULE_YAML,
    '1-rack.csv': 'site,name,status,width,u_height,desc_units\r\npt-verify-site,pt-verify-rack,planned,19,24,false\r\n',
    '2-devices.csv': 'name,role,manufacturer,device_type,status,site,rack,position,face,comments\r\n'
                     'pt-verify-a,pt-verify-role,Acme,SW-1,planned,pt-verify-site,pt-verify-rack,2,front,\r\n'
                     'pt-verify-b,pt-verify-role,Acme,SW-1,planned,pt-verify-site,pt-verify-rack,4,front,\r\n',
    '3-modules.csv': 'device,module_bay,module_type,status\r\npt-verify-a,Slot 1,CARD-1,planned\r\n',
    '4-cables.csv': 'side_a_device,side_a_type,side_a_name,side_b_device,side_b_type,side_b_name,type,status,label,color,length,length_unit,description\r\n'
                    'pt-verify-b,dcim.interface,port-1,pt-verify-a,dcim.interface,slot-1/p0,cat6,planned,pt-verify-c1,,1.5,ft,uplink\r\n',
    'README.txt': README}
NAUTOBOT = {
    'types/device-types/Acme/SW-1.yaml': DEVICE_YAML, 'types/module-types/Acme/CARD-1.yaml': MODULE_YAML,
    '1-devices.csv': 'name,role__name,device_type__manufacturer__name,device_type__model,status__name,location__name,rack__name,position,face,comments\r\n'
                     'pt-verify-a,pt-verify-role,Acme,SW-1,Planned,pt-verify-site,pt-verify-rack,2,front,\r\n'
                     'pt-verify-b,pt-verify-role,Acme,SW-1,Planned,pt-verify-site,pt-verify-rack,4,front,\r\n',
    '2-modules.csv': 'module_type__manufacturer__name,module_type__model,parent_module_bay__parent_device__name,parent_module_bay__name,status__name\r\n'
                     'Acme,CARD-1,pt-verify-a,Slot 1,Planned\r\n',
    '3-cables.csv': 'a_device,a_type,a_name,b_device,b_type,b_name,type,status,label,color,length,length_unit\r\n'
                    'pt-verify-b,dcim.interface,port-1,pt-verify-a,dcim.interface,slot-1/p0,cat6,Planned,pt-verify-c1,,2,ft\r\n',
    'README.txt': README.replace('NetBox', 'Nautobot')}
# The rack the two kits stand for: one cable in the files, one the README says is left out.
RACK = {'racks': [{'name': 'pt-verify-rack', 'frame': {'heightRU': 24, 'numbering': 'bottom-up'},
                   'cables': [{'id': 'c1', 'label': 'pt-verify-c1'}, {'id': 'c2', 'label': 'pt-verify-loose'}]}]}


class State:
    def __init__(self):
        self.posts = []           # (path, content type, body or form data)
        self.cables = []          # rows of the cable CSVs that were accepted
        self.refuse = None        # an import kind the mock NetBox refuses
        self.ports = {'pt-verify-a': ['port-1', 'slot-1/p0'], 'pt-verify-b': ['port-1']}


def handler(st):
    class H(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def send(self, code, body, ct='application/json', loc=None):
            b = (body if isinstance(body, str) else json.dumps(body)).encode()
            self.send_response(code)
            self.send_header('Content-Type', ct)
            self.send_header('Content-Length', str(len(b)))
            if loc:
                self.send_header('Location', loc)
            self.end_headers()
            self.wfile.write(b)

        def do_GET(self):
            u = urllib.parse.urlsplit(self.path)
            q = {k: v[0] for k, v in urllib.parse.parse_qs(u.query).items()}
            if not u.path.startswith('/api/'):
                return self.send(200, PAGE % '', 'text/html')
            lst = u.path.strip('/').split('/')[-1]
            if lst == 'status':
                return self.send(200, {'netbox-version': '4.7.2', 'nautobot-version': '3.2.6'})
            rows = []
            if lst == 'devices' and 'name' in q:
                rows = [{'id': 'dev:' + q['name'], 'name': q['name']}] if q['name'] in st.ports else []
            elif lst == 'interfaces':
                if q.get('device') not in st.ports:
                    return self.send(400, {'device': ['Select a valid choice.']})
                rows = [{'id': '%s:%s' % (q['device'], n), 'name': n, 'cable': None} for n in st.ports[q['device']]]
            elif lst == 'cables':
                for r in st.cables:
                    if 'side_a_device' in r:
                        end = lambda s: [{'object_type': r['side_%s_type' % s], 'object': {'name': r['side_%s_name' % s], 'device': {'name': r['side_%s_device' % s]}}}]
                        rows.append({'id': 1, 'label': r['label'], 'type': r['type'], 'status': {'value': r['status']},
                                     'length': float(r['length']) if r['length'] else None, 'description': r['description'],
                                     'length_unit': {'value': r['length_unit']} if r['length_unit'] else None,
                                     'a_terminations': end('a'), 'b_terminations': end('b')})
                    else:
                        rows.append({'id': 'c', 'label': r.get('label'), 'type': r.get('type', ''), 'length': int(r['length']) if r.get('length') else None,
                                     'length_unit': r.get('length_unit', ''), 'termination_a_id': r['termination_a_id'], 'termination_b_id': r['termination_b_id']})
            self.send(200, {'results': rows, 'next': None})

        def do_POST(self):
            body = self.rfile.read(int(self.headers.get('Content-Length') or 0)).decode()
            ct = self.headers.get('Content-Type', '')
            if self.path == '/login/':
                st.posts.append((self.path, ct, urllib.parse.parse_qs(body)))
                return self.send(302, '', 'text/html', '/')
            if not self.path.startswith('/api/'):                       # NetBox's bulk import pages
                form = {k: v[0] for k, v in urllib.parse.parse_qs(body).items()}
                kind = self.path.strip('/').split('/')[1]
                st.posts.append((self.path, ct, form))
                if form.get('csrfmiddlewaretoken') != CSRF or kind == st.refuse:
                    return self.send(200, PAGE % '<div class="alert alert-danger">Record 1 position: U14 is already occupied</div>', 'text/html')
                if kind == 'cables':
                    st.cables += list(csv.DictReader(io.StringIO(form['data'], newline='')))
                return self.send(302, '', 'text/html', self.path.replace('import/', '') + '?modified_by_request=1')
            if self.headers.get('Authorization') != 'Token ' + TOKEN:
                return self.send(403, {'detail': 'Invalid token.'})
            st.posts.append((self.path, ct, body))
            if ct == 'text/csv':
                rows = list(csv.DictReader(io.StringIO(body, newline='')))
                if self.path == '/api/dcim/cables/':
                    st.cables += rows
                    return self.send(201, [dict(r, id='cable-1') for r in rows])
                return self.send(201, [{'id': 'o', 'name': r.get('name', ''), 'display': r.get('name', '')} for r in rows])
            d = json.loads(body)
            return self.send(201, {'id': 'obj-%d' % len(st.posts), 'name': d.get('name') or d.get('model')} if isinstance(d, dict) else [{}])
    return H


class Kits(unittest.TestCase):
    def setUp(self):
        self.st = State()
        self.server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler(self.st))
        threading.Thread(target=self.server.serve_forever, kwargs={'poll_interval': 0.01}, daemon=True).start()
        self.url = 'http://127.0.0.1:%d' % self.server.server_address[1]
        self.dir = tempfile.TemporaryDirectory()
        self.zips(NETBOX, NAUTOBOT)
        with open(os.path.join(self.dir.name, 'rack.json'), 'w', encoding='utf-8') as f:
            json.dump(RACK, f)

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.dir.cleanup()

    def zips(self, netbox, nautobot):
        for name, files in (('pt-verify-rack-netbox-import.zip', netbox), ('pt-verify-rack-nautobot-import.zip', nautobot)):
            with zipfile.ZipFile(os.path.join(self.dir.name, name), 'w') as z:
                for n, text in files.items():
                    z.writestr(n, text)
                if 'nautobot' in name:
                    z.writestr('import_cables.py', SCRIPT.read_text(encoding='utf-8'))

    def kits(self, *args):
        env = {'PATH': os.environ.get('PATH', ''), 'PT_VERIFY_KITS': self.dir.name,
               'PT_VERIFY_RESULT': os.path.join(self.dir.name, 'kits-result.json'),
               'PT_VERIFY_FIXTURE': os.path.join(self.dir.name, 'rack.json'),
               'NETBOX_URL': self.url, 'NETBOX_USER': 'someone', 'NETBOX_PASSWORD': PASSWORD,
               'NAUTOBOT_URL': self.url, 'NAUTOBOT_TOKEN': TOKEN}
        r = subprocess.run([sys.executable, str(HERE / 'kits.py'), *args], env=env, capture_output=True, text=True, timeout=120)
        path = env['PT_VERIFY_RESULT']
        text = pathlib.Path(path).read_text(encoding='utf-8') if os.path.isfile(path) else ''
        return r, (json.loads(text) if text else None), text + r.stdout + r.stderr

    def steps(self, result, target):
        return {s['id']: s for s in result['targets'][target]['steps']}

    def test_netbox_gets_the_kit_in_the_readmes_order_through_the_import_pages(self):
        r, result, raw = self.kits('run', 'netbox')
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        imports = [p for p, _, _ in self.st.posts if p.endswith('/import/')]
        self.assertEqual(imports, ['/dcim/sites/import/', '/dcim/device-roles/import/', '/dcim/manufacturers/import/',
                                   '/dcim/device-types/import/', '/dcim/module-types/import/', '/dcim/racks/import/',
                                   '/dcim/devices/import/', '/dcim/modules/import/', '/dcim/cables/import/'])
        data = {p: f['data'] for p, _, f in self.st.posts if p.endswith('/import/')}
        # A manufacturer and a type gain the prefix; nothing else in a file changes.
        self.assertIn('manufacturer: pt-verify-Acme\nmodel: pt-verify-SW-1\nslug: pt-verify-acme-sw-1\n', data['/dcim/device-types/import/'])
        self.assertEqual(data['/dcim/racks/import/'], NETBOX['1-rack.csv'])
        self.assertEqual(data['/dcim/devices/import/'], NETBOX['2-devices.csv'].replace(',Acme,SW-1,', ',pt-verify-Acme,pt-verify-SW-1,'))
        self.assertEqual(data['/dcim/modules/import/'], NETBOX['3-modules.csv'].replace(',CARD-1,', ',pt-verify-CARD-1,'))
        self.assertEqual(data['/dcim/cables/import/'], NETBOX['4-cables.csv'])
        steps = self.steps(result, 'netbox')
        self.assertTrue(all(s['accepted'] for s in steps.values()), [(k, s['accepted']) for k, s in steps.items()])
        self.assertEqual(steps['kit_devices']['notes'], ["4 manufacturer and type cell(s) prefixed; every other cell is the kit's"])
        self.assertEqual([(c['cable'], c['ok']) for c in steps['cables_compared']['created']], [('pt-verify-c1', True), ('pt-verify-loose', True)])
        self.assertEqual(steps['cables_compared']['created'][1]['kit'], 'Cable pt-verify-loose is not in the cables file: end A is not connected.')
        self.assertEqual(steps['cables_compared']['created'][0]['instance'], 'as written')

    def test_nautobot_gets_the_csvs_as_text_csv_and_its_cables_from_the_kits_own_script(self):
        r, result, raw = self.kits('run', 'nautobot')
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        csvs = [(p, b) for p, ct, b in self.st.posts if ct == 'text/csv']
        self.assertEqual([p for p, _ in csvs], ['/api/dcim/devices/', '/api/dcim/modules/', '/api/dcim/cables/'])
        self.assertEqual(csvs[0][1], NAUTOBOT['1-devices.csv'].replace(',Acme,SW-1,', ',pt-verify-Acme,pt-verify-SW-1,'))
        self.assertEqual(csvs[1][1], NAUTOBOT['2-modules.csv'].replace('Acme,CARD-1,', 'pt-verify-Acme,pt-verify-CARD-1,'))
        # The cable was created by the kit's script, by id: no file with the ends' names went to Nautobot's importer.
        self.assertEqual(csvs[2][1], 'termination_a_type,termination_a_id,termination_b_type,termination_b_id,status__name,type,label,length,length_unit\n'
                                     'dcim.interface,pt-verify-b:port-1,dcim.interface,pt-verify-a:slot-1/p0,Planned,cat6,pt-verify-c1,2,ft\n')
        steps = self.steps(result, 'nautobot')
        self.assertIsNone(steps['login']['accepted'])               # no NAUTOBOT_USER: the types went in over REST
        self.assertTrue(all(s['accepted'] for k, s in steps.items() if k != 'login'), [(k, s['accepted']) for k, s in steps.items()])
        self.assertIn('row 1 pt-verify-c1: would connect pt-verify-b port-1 to pt-verify-a slot-1/p0 (cat6, 2 ft, Planned).',
                      steps['script_dry_run']['messages'])
        self.assertIn('1 row: 1 created, 0 not.', steps['script_apply']['messages'])
        self.assertEqual(steps['cables_compared']['created'][0]['instance'], 'as written')

    def test_a_refused_file_and_a_cable_that_did_not_arrive_fail_the_run(self):
        self.st.refuse = 'cables'
        r, result, raw = self.kits('run', 'netbox')
        self.assertEqual(r.returncode, 1)
        steps = self.steps(result, 'netbox')
        self.assertFalse(steps['kit_cables']['accepted'])
        self.assertIn('Record 1 position: U14 is already occupied', ' '.join(steps['kit_cables']['messages']))
        self.assertFalse(steps['cables_compared']['accepted'])
        self.assertEqual(steps['cables_compared']['created'][0]['instance'], 'NOT FOUND')

    def test_a_kit_with_a_name_cleanup_could_not_find_is_refused_before_anything_is_sent(self):
        self.zips(dict(NETBOX, **{'2-devices.csv': NETBOX['2-devices.csv'].replace('pt-verify-b,', 'core-1,')}), NAUTOBOT)
        r, result, raw = self.kits('run', 'netbox')
        self.assertEqual((r.returncode, self.st.posts), (1, []))
        self.assertIn("2-devices.csv row 2: name is 'core-1', which does not start with pt-verify-", raw)

    def test_no_credential_reaches_the_output_and_plan_sends_nothing(self):
        r, result, raw = self.kits('run')
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertNotIn(PASSWORD, raw)
        self.assertNotIn(TOKEN, raw)
        self.assertNotIn(CSRF, raw)
        self.st.posts.clear()
        r, _, _ = self.kits('plan')
        self.assertEqual((r.returncode, self.st.posts), (0, []))
        self.assertIn('every name the kit creates starts with pt-verify-: yes', r.stdout)
        self.assertIn('left out by the kit: Cable pt-verify-loose is not in the cables file: end A is not connected.', r.stdout)


if __name__ == '__main__':
    unittest.main(verbosity=1)
```

- [ ] **Step 2: Have the contract check run it**

In `check-contract.py`, replace

```python
      "the file is not tracked, or tools/build-public.py does not copy it")
```

with

```python
      "the file is not tracked, or tools/build-public.py does not copy it")
# THE ACCEPTANCE KIT (tools/dcim-verify/) imports the Rack Builder's exported
# kits into a real NetBox and Nautobot, and only a person with instances runs
# that. What runs here is its self-test: kits.py end to end against a mock of
# both, so the tool still works on the day somebody needs it.
_kst = HERE / "tools" / "dcim-verify" / "selftest.py"
_ksr = _sp.run([sys.executable, str(_kst)], capture_output=True, text=True) if _kst.is_file() else None
check(_ksr is not None and _ksr.returncode == 0,
      "tools/dcim-verify/kits.py passes its self-test against a mock NetBox and Nautobot",
      (_ksr.stderr[-600:] if _ksr else "no tools/dcim-verify/selftest.py"))
```

Run: `python3 tools/dcim-verify/selftest.py`
Expected: `FAILED (failures=5)`: there is no `kits.py` to run.

Run: `python3 check-contract.py`
Expected: `contract: 298 checks passed, 1 FAILED`, "tools/dcim-verify/kits.py passes its self-test against a mock NetBox and Nautobot".

- [ ] **Step 3: Write `kits.py`**

Create `tools/dcim-verify/kits.py`:

```python
#!/usr/bin/env python3
"""Acceptance for the Rack Builder's DCIM import kits (Phase 2c, ruling 10).

Imports the two zips the Rack Builder REALLY exports for acceptance.rack.json
(made by export_kits.py, into kits/) into a NetBox and a Nautobot test
instance, in the order each kit's README gives, and reports per file and per
row, then compares the cables each instance ends up with against the rack's.

    python3 tools/dcim-verify/export_kits.py                  # the two zips, from the page
    python3 tools/dcim-verify/kits.py plan [netbox|nautobot]  # offline: what a run would send
    python3 tools/dcim-verify/kits.py run  [netbox|nautobot]  # do it, write kits-result.json
    python3 tools/dcim-verify/verify.py cleanup               # delete every pt-verify- object

NetBox: the kit's files through the web UI's import pages. Nautobot: the
CSVs to the REST API as text/csv, then the kit's own import_cables.py.

Connection details come ONLY from environment variables, as for verify.py:
    NETBOX_URL  NETBOX_USER  NETBOX_PASSWORD  [NETBOX_TOKEN]
    NAUTOBOT_URL  NAUTOBOT_TOKEN  [NAUTOBOT_USER  NAUTOBOT_PASSWORD]
Nothing here prints, logs or stores a credential. Standard library only.

A kit's files go in as they are, with ONE change, so that everything created
carries the pt-verify- prefix and cleanup can find it: a manufacturer and a
type are renamed with the prefix, in the YAML's identity lines and in the CSV
cells that name them. Each step records how many cells it changed. Every other
name (rack, devices, cable labels, site, role) is the fixture's own, which
already starts with the prefix; a kit with a name that does not is refused.
"""
import csv
import datetime
import io
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.parse
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import verify as V  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
KITS = os.environ.get('PT_VERIFY_KITS') or os.path.join(HERE, 'kits')
RESULT = os.environ.get('PT_VERIFY_RESULT') or os.path.join(HERE, 'kits-result.json')
FIXTURE = os.environ.get('PT_VERIFY_FIXTURE') or os.path.join(HERE, 'acceptance.rack.json')
P = V.PREFIX
ZIP = {'netbox': 'pt-verify-rack-netbox-import.zip', 'nautobot': 'pt-verify-rack-nautobot-import.zip'}
FILES = {'netbox': [('1-rack.csv', 'racks'), ('2-devices.csv', 'devices'), ('3-modules.csv', 'modules'), ('4-cables.csv', 'cables')],
         'nautobot': [('1-devices.csv', 'devices'), ('2-modules.csv', 'modules')]}
# The cells that name a manufacturer or a type, which gain the prefix.
TYPE_CELLS = {'2-devices.csv': ['manufacturer', 'device_type'], '3-modules.csv': ['module_type'],
              '1-devices.csv': ['device_type__manufacturer__name', 'device_type__model'],
              '2-modules.csv': ['module_type__manufacturer__name', 'module_type__model']}
# The cells that must already carry the prefix: the names the fixture gives.
OWN_CELLS = {'1-rack.csv': ['site', 'name'], '2-devices.csv': ['name', 'role', 'site', 'rack'], '3-modules.csv': ['device'],
             '4-cables.csv': ['side_a_device', 'side_b_device', 'label'],
             '1-devices.csv': ['name', 'role__name', 'location__name', 'rack__name'],
             '2-modules.csv': ['parent_module_bay__parent_device__name'], '3-cables.csv': ['a_device', 'b_device', 'label']}
ENDPOINTS = {'dcim.interface': 'interfaces', 'dcim.frontport': 'front-ports', 'dcim.rearport': 'rear-ports',
             'dcim.consoleport': 'console-ports', 'dcim.consoleserverport': 'console-server-ports',
             'dcim.powerport': 'power-ports', 'dcim.poweroutlet': 'power-outlets'}


# ── a kit, read ────────────────────────────────────────────────────────────
class Kit:
    def __init__(self, target):
        path = os.path.join(KITS, ZIP[target])
        if not os.path.isfile(path):
            raise V.Refused('%s is not there. Run "python3 tools/dcim-verify/export_kits.py" first.' % path)
        self.target, self.path = target, path
        with zipfile.ZipFile(path) as z:
            self.names = z.namelist()
            self.files = {n: z.read(n).decode('utf-8') for n in self.names}

    def rows(self, name):
        return list(csv.DictReader(io.StringIO(self.files.get(name, ''), newline='')))

    def types(self):
        """(kind, entry, text), device types first, as the README orders them."""
        out = [(n.split('/')[1], n, self.files[n]) for n in self.names if n.startswith('types/') and n.endswith('.yaml')]
        return sorted(out, key=lambda t: (t[0] != 'device-types', t[1]))

    def left_out(self):
        """The README's NOT IN THIS KIT lines."""
        part = self.files.get('README.txt', '').partition('NOT IN THIS KIT:\n')[2].partition('\n\n')[0]
        return [l[2:] for l in part.split('\n') if l.startswith('- ')]

    def problems(self):
        """Why this kit must not be imported into someone's instance: a name
        it would create that the cleanup could not find again."""
        bad = []
        for name, cols in OWN_CELLS.items():
            for n, row in enumerate(self.rows(name), 1):
                for c in cols:
                    if not str(row.get(c) or '').startswith(P):
                        bad.append('%s row %d: %s is %r, which does not start with %s' % (name, n, c, row.get(c), P))
        return bad


def prefixed_cells(name, text):
    """The file with its manufacturer and type cells prefixed; how many changed."""
    cols = TYPE_CELLS.get(name) or []
    rows = list(csv.reader(io.StringIO(text, newline='')))
    if not rows or not cols:
        return text, 0
    idx = [rows[0].index(c) for c in cols if c in rows[0]]
    n = 0
    for r in rows[1:]:
        for i in idx:
            if i < len(r) and r[i]:
                r[i] = P + r[i]
                n += 1
    b = io.StringIO()
    csv.writer(b, lineterminator='\r\n').writerows(rows)
    return b.getvalue(), n


def slug(s):
    return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')


def read_type(text):
    """A type YAML as the exporter writes it, without a YAML library: its
    top-level scalars, and each section's items with their own scalars."""
    unq = lambda v: v[1:-1].replace("''", "'") if len(v) > 1 and v[0] == v[-1] == "'" else (json.loads(v) if v[:1] == '"' and v[-1:] == '"' else v)
    d, section, item = {}, None, None
    for line in text.split('\n'):
        m = re.match(r'^([A-Za-z_][\w-]*):\s*(.*?)\s*$', line)
        if m:
            section, item = (m.group(1), None) if m.group(2) == '' else (None, None)
            if m.group(2) != '':
                d.setdefault(m.group(1), unq(m.group(2)))
            else:
                d[section] = []
            continue
        if section is None:
            continue
        m = re.match(r'^  - name:\s*(.*?)\s*$', line)
        if m:
            item = {'name': unq(m.group(1))}
            d[section].append(item)
            continue
        m = item is not None and re.match(r'^    ([a-z_]+):\s*(.*?)\s*$', line)
        if m:
            item[m.group(1)] = unq(m.group(2))
    return d


# ── steps shared by both targets ───────────────────────────────────────────
def skipped(run, sid, title, why):
    s = run.step(sid, title, 'accept')
    s['messages'] = [why]
    run.done(s)
    return s


def rack_cables(kit, cable_file, found):
    """Every cable of the rack file against the kit and the instance: in the
    file and connected as written, or left out with the README's sentence."""
    with open(FIXTURE, encoding='utf-8') as f:
        rack = json.load(f)['racks'][0]
    in_file = {r['label'] for r in kit.rows(cable_file)}
    left = kit.left_out()
    out, ok = [], True
    for c in rack.get('cables') or []:
        label = c.get('label') or c.get('id')
        why = next((l for l in left if l.startswith('Cable %s is not in the cables file' % label)), None)
        state = found.get(label)
        if label in in_file:
            good = state == 'as written'
            out.append({'cable': label, 'kit': 'in the cables file', 'instance': state or 'NOT FOUND', 'ok': good})
        else:
            good = why is not None and state is None
            out.append({'cable': label, 'kit': why or 'LEFT OUT WITH NO README LINE', 'instance': state or 'not there, as expected', 'ok': good})
        ok = ok and good
    return out, ok


def compared(run, kit, cable_file, found, problems):
    s = run.step('cables_compared', "the instance's cables against the kit's rows and the rack's cables", 'accept')
    table, ok = rack_cables(kit, cable_file, found)
    s['created'] = table
    s['messages'] = problems
    s['accepted'] = ok and not problems
    run.done(s)


# ── NetBox: the README's order, through the web UI ─────────────────────────
def run_netbox(run, kit):
    c = V.Client('netbox')
    ok, why = c.login()
    s = run.step('login', 'sign in to the web UI (session form + CSRF)', 'accept', request={'method': 'POST', 'path': '/login/'})
    s['accepted'], s['messages'] = ok, [why]
    run.done(s)
    if not ok:
        return
    st = c.api('GET', '/api/status/')
    run.info['version'] = (st.json() or {}).get('netbox-version') if st.status == 200 else None
    have, _ = c.api_list('/api/dcim/devices/?' + urllib.parse.urlencode({'name__isw': P, 'limit': 50}))
    if [o for o in have if str(o.get('name') or '').startswith(P)] and '--continue' not in sys.argv:
        skipped(run, 'preflight', 'the instance already has %s devices' % P,
                'Run "verify.py cleanup netbox" first, or pass --continue.')['accepted'] = False
        return
    rack = kit.rows('1-rack.csv')[0]
    role = next((r['role'] for r in kit.rows('2-devices.csv')), P + 'role')
    mans = sorted({read_type(t).get('manufacturer', '') for _, _, t in kit.types()} - {''})
    # What the README says must already exist: a site, a device role, the manufacturers.
    V.nb_import(c, run, 'prereq_site', 'README prerequisite: the site', 'sites',
                'name,slug,status\n%s,%s,planned\n' % (rack['site'], slug(rack['site'])), 'csv', 'accept')
    V.nb_import(c, run, 'prereq_role', 'README prerequisite: the device role', 'device-roles',
                'name,slug,color\n%s,%s,9e9e9e\n' % (role, slug(role)), 'csv', 'accept')
    V.nb_import(c, run, 'prereq_manufacturers', 'README prerequisite: the manufacturers', 'manufacturers',
                'name,slug\n' + ''.join('%s%s,%s\n' % (P, m, slug(P + m)) for m in mans), 'csv', 'accept')
    for kind, entry, text in kit.types():
        V.nb_import(c, run, 'types_' + re.sub(r'\W+', '_', entry[6:-5]), 'README step 1: %s (identity lines prefixed)' % entry,
                    kind, V.prefixed_yaml(text), 'yaml', 'accept')
    for step, (name, kind) in enumerate(FILES['netbox'], 2):
        text, n = prefixed_cells(name, kit.files[name])
        title = 'README step %d: %s, %d row%s' % (step, name, len(kit.rows(name)), '' if len(kit.rows(name)) == 1 else 's')
        if not kit.rows(name):
            skipped(run, 'kit_' + kind, title, 'no rows: the README says to skip it')
            continue
        V.nb_import(c, run, 'kit_' + kind, title, kind, text, 'csv', 'accept',
                    notes=['%d manufacturer and type cell(s) prefixed; every other cell is the kit\'s' % n])
    # What NetBox now holds, against the kit's rows.
    cables, err = c.api_list('/api/dcim/cables/?' + urllib.parse.urlencode({'label__isw': P, 'limit': 200}))
    have = {}
    for o in cables:
        ends = []
        for side in ('a_terminations', 'b_terminations'):
            for t in o.get(side) or []:
                obj = t.get('object') or {}
                ends.append((t.get('object_type'), (obj.get('device') or {}).get('name'), obj.get('name')))
        unit = o.get('length_unit')
        have[o.get('label')] = {'ends': sorted(ends), 'type': o.get('type') or '', 'length': o.get('length'),
                                'unit': (unit.get('value') if isinstance(unit, dict) else unit) or '',
                                'status': (o.get('status') or {}).get('value') if isinstance(o.get('status'), dict) else o.get('status'),
                                'description': o.get('description') or ''}
    found, problems = {}, [err] if err else []
    for r in kit.rows('4-cables.csv'):
        want = {'ends': sorted([(r['side_a_type'], r['side_a_device'], r['side_a_name']), (r['side_b_type'], r['side_b_device'], r['side_b_name'])]),
                'type': r['type'], 'length': float(r['length']) if r['length'] else None, 'unit': r['length_unit'],
                'status': r['status'], 'description': r['description']}
        got = have.get(r['label'])
        if got and got['length'] is not None:
            got['length'] = float(got['length'])
        found[r['label']] = 'as written' if got == want else ('DIFFERS: %s' % json.dumps(got) if got else None)
        if got != want:
            problems.append('%s: the kit says %s, NetBox has %s' % (r['label'], json.dumps(want), json.dumps(got)))
    for label in have:
        if label not in found:
            found[label] = 'IN NETBOX BUT NOT IN THE KIT'
            problems.append('%s is in NetBox and not in the kit' % label)
    compared(run, kit, '4-cables.csv', found, problems)


# ── Nautobot: the CSVs as text/csv, then the kit's own script ──────────────
def rest_type(c, run, sid, title, kind, d):
    """Without a UI sign-in: the type built through the REST API from the
    kit's YAML. It lets the later steps run; it does not test the YAML import."""
    body = {'manufacturer': {'name': P + d['manufacturer']}, 'model': P + d['model']}
    if kind == 'device-types':
        body.update({'u_height': int(float(d.get('u_height', 1))), 'is_full_depth': str(d.get('is_full_depth', 'true')) == 'true'})
    s = V.nt_post_json(c, run, sid, title + ' [REST fallback, not the UI import]', '/api/dcim/%s/' % kind, body)
    if not s['accepted']:
        return s
    parent = 'device_type' if kind == 'device-types' else 'module_type'
    for section, ep in V.NT_TEMPLATES:
        rows = []
        for t in d.get(section) or []:
            row = {parent: s['object_id'], 'name': t['name']}
            if section == 'module-bays':
                row['position'] = str(t.get('position', ''))
            else:
                row['type'] = t.get('type', 'other')
            rows.append(row)
        if rows:
            r = c.api('POST', '/api/dcim/%s/' % ep, rows)
            if r.status not in (200, 201):
                s['notes'].append('%s: HTTP %s %s' % (ep, r.status, V.clip(r.text, 600)))
                s['accepted'] = False
    return s


def run_script(run, kit, sid, title, flags):
    """The kit's own import_cables.py, as shipped, against the kit's own
    3-cables.csv. It gets the URL and the token from the environment, as a
    user's would; its output is recorded, redacted."""
    s = run.step(sid, title, 'accept', request={'method': 'RUN', 'path': 'python3 import_cables.py 3-cables.csv ' + ' '.join(flags)})
    s['path_used'] = "the kit's own import_cables.py, unchanged"
    if 'import_cables.py' not in kit.files:
        s['accepted'], s['messages'] = False, ['the kit has no import_cables.py']
        run.done(s)
        return s
    with tempfile.TemporaryDirectory() as d:
        for n in ('import_cables.py', '3-cables.csv'):
            with open(os.path.join(d, n), 'w', encoding='utf-8', newline='') as f:
                f.write(kit.files[n])
        env = {k: os.environ[k] for k in ('NAUTOBOT_URL', 'NAUTOBOT_TOKEN', 'PATH') if k in os.environ}
        r = subprocess.run([sys.executable, 'import_cables.py', '3-cables.csv', *flags], cwd=d, env=env,
                           capture_output=True, text=True, timeout=600)
    s['http_status'] = r.returncode
    s['accepted'] = r.returncode == 0
    s['messages'] = [V.redact(l) for l in (r.stdout + r.stderr).split('\n') if l.strip()]
    run.done(s)
    return s


def run_nautobot(run, kit):
    c = V.Client('nautobot')
    if not os.environ.get('NAUTOBOT_TOKEN'):
        skipped(run, 'token', 'NAUTOBOT_TOKEN is set', 'NAUTOBOT_TOKEN is not set.')['accepted'] = False
        return
    st = c.api('GET', '/api/status/')
    s = run.step('api', 'reach the REST API with the token', 'accept', request={'method': 'GET', 'path': '/api/status/'})
    s['http_status'], s['accepted'] = st.status, st.status == 200
    run.info['version'] = (st.json() or {}).get('nautobot-version') if st.status == 200 else None
    run.done(s)
    if not s['accepted']:
        return
    have, _ = c.api_list('/api/dcim/devices/?' + urllib.parse.urlencode({'name__isw': P, 'limit': 50, 'depth': 0}))
    if [o for o in have if str(o.get('name') or '').startswith(P)] and '--continue' not in sys.argv:
        skipped(run, 'preflight', 'the instance already has %s devices' % P,
                'Run "verify.py cleanup nautobot" first, or pass --continue.')['accepted'] = False
        return
    ui, why = c.login()
    s = run.step('login', 'sign in to the web UI (only for the type YAML import, README step 1)', 'accept',
                 request={'method': 'POST', 'path': '/login/'})
    s['accepted'], s['messages'] = (ui if os.environ.get('NAUTOBOT_USER') else None), [why]
    run.done(s)
    with open(FIXTURE, encoding='utf-8') as f:
        frame = json.load(f)['racks'][0]['frame']
    dev = kit.rows('1-devices.csv')[0]
    types = [(kind, entry, read_type(text), text) for kind, entry, text in kit.types()]
    # What the README says must already exist.
    for man in sorted({d.get('manufacturer', '') for _, _, d, _ in types} - {''}):
        V.nt_post_json(c, run, 'prereq_manufacturer_' + re.sub(r'\W+', '_', man), 'README prerequisite: manufacturer %s' % man,
                       '/api/dcim/manufacturers/', {'name': P + man})
    V.nt_post_json(c, run, 'prereq_role', 'README prerequisite: the role, for devices', '/api/extras/roles/',
                   {'name': dev['role__name'], 'color': '9e9e9e', 'content_types': ['dcim.device']})
    V.nt_post_json(c, run, 'prereq_location_type', 'README prerequisite: a location type that allows devices and racks',
                   '/api/dcim/location-types/', {'name': P + 'loctype', 'nestable': False, 'content_types': ['dcim.device', 'dcim.rack']})
    V.nt_post_json(c, run, 'prereq_location', 'README prerequisite: the location', '/api/dcim/locations/',
                   {'name': dev['location__name'], 'location_type': {'name': P + 'loctype'}, 'status': {'name': 'Active'}})
    V.nt_post_json(c, run, 'prereq_rack', 'README prerequisite: the rack', '/api/dcim/racks/',
                   {'name': dev['rack__name'], 'location': {'name': dev['location__name']}, 'status': {'name': 'Active'},
                    'u_height': frame['heightRU'], 'desc_units': frame.get('numbering') == 'top-down'})
    for kind, entry, d, text in types:
        sid = 'types_' + re.sub(r'\W+', '_', entry[6:-5])
        if ui:
            r = V.nt_ui_type(c, run, sid, 'README step 1, through the UI: %s (identity lines prefixed)' % entry, kind, V.prefixed_yaml(text))
            if r['accepted']:
                continue
            sid += '_rest'
        rest_type(c, run, sid, entry, kind, d)
    for step, (name, kind) in enumerate(FILES['nautobot'], 2):
        text, n = prefixed_cells(name, kit.files[name])
        title = 'README step %d: %s, %d row%s' % (step, name, len(kit.rows(name)), '' if len(kit.rows(name)) == 1 else 's')
        if not kit.rows(name):
            skipped(run, 'kit_' + kind, title, 'no rows: the README says to skip it')
            continue
        V.nt_csv(c, run, 'kit_' + kind, title, '/api/dcim/%s/' % kind, text, 'accept',
                 notes=['%d manufacturer and type cell(s) prefixed; every other cell is the kit\'s' % n])
    run_script(run, kit, 'script_dry_run', 'README step 4: import_cables.py, a dry run', [])
    run_script(run, kit, 'script_apply', 'README step 4: import_cables.py --apply', ['--apply'])
    # What Nautobot now holds, against the kit's rows: each cable's two ends by id.
    cables, err = c.api_list('/api/dcim/cables/?' + urllib.parse.urlencode({'label__isw': P, 'limit': 200, 'depth': 0}))
    have = {o.get('label'): o for o in cables}
    ports, found, problems = {}, {}, [err] if err else []

    def port_id(device, kind, name):
        key = (kind, device)
        if key not in ports:
            ports[key] = c.api_list('/api/dcim/%s/?%s' % (ENDPOINTS.get(kind, 'interfaces'),
                                                           urllib.parse.urlencode({'device': device, 'limit': 1000, 'depth': 0})))[0]
        return next((p.get('id') for p in ports[key] if p.get('name') == name), None)

    val = lambda v: (v.get('value') if isinstance(v, dict) else v) or ''
    for r in kit.rows('3-cables.csv'):
        want = {'ends': sorted([str(port_id(r['a_device'], r['a_type'], r['a_name'])), str(port_id(r['b_device'], r['b_type'], r['b_name']))]),
                'type': r['type'], 'length': int(r['length']) if r['length'] else None, 'unit': r['length_unit']}
        o = have.get(r['label'])
        got = o and {'ends': sorted([str(o.get('termination_a_id')), str(o.get('termination_b_id'))]), 'type': val(o.get('type')),
                     'length': o.get('length'), 'unit': val(o.get('length_unit'))}
        found[r['label']] = 'as written' if got == want else ('DIFFERS: %s' % json.dumps(got) if got else None)
        if got != want:
            problems.append('%s: the kit says %s, Nautobot has %s' % (r['label'], json.dumps(want), json.dumps(got)))
    for label in have:
        if label not in found:
            found[label] = 'IN NAUTOBOT BUT NOT IN THE KIT'
            problems.append('%s is in Nautobot and not in the kit' % label)
    compared(run, kit, '3-cables.csv', found, problems)


# ── plan (offline) and main ────────────────────────────────────────────────
def plan(target):
    kit = Kit(target)
    host = urllib.parse.urlsplit(os.environ.get(V.ENV[target][0], '')).netloc or '<%s not set>' % V.ENV[target][0]
    V.say('\n== %s, at %s: %s ==' % (target, host, kit.path))
    V.say('   credentials: ' + ', '.join('%s %s' % (n, 'set' if os.environ.get(n) else 'not set') for n in V.ENV[target][1:]))
    bad = kit.problems()
    V.say('   every name the kit creates starts with %s: %s' % (P, 'yes' if not bad else 'NO - a run is refused'))
    for b in bad[:10]:
        V.say('     ' + b)
    V.say('   prerequisites created first (the README says they must exist): site or location, role, manufacturers'
          + (', the rack' if target == 'nautobot' else ''))
    for kind, entry, text in kit.types():
        V.say('   import  %-58s as a %s YAML, identity lines prefixed' % (entry, kind[:-1]))
    for name, kind in FILES[target]:
        text, n = prefixed_cells(name, kit.files[name])
        V.say('   import  %-16s %d row(s), %d cell(s) prefixed, columns: %s' % (name, len(kit.rows(name)), n, ','.join(V.header_row(text))))
    if target == 'nautobot':
        V.say('   run     import_cables.py 3-cables.csv (dry run), then --apply: %d row(s)' % len(kit.rows('3-cables.csv')))
    V.say('   compare the cables the instance has with the kit\'s rows and the rack file\'s cables')
    for l in kit.left_out():
        V.say('   left out by the kit: ' + l)


def write_result(runs, started):
    out = {'kit': 'portrayal dcim-verify kits 1', 'prefix': P, 'started': started,
           'finished': datetime.datetime.now().isoformat(timespec='seconds'), 'targets': {}}
    for r in runs:
        out['targets'][r.target] = {'host': urllib.parse.urlsplit(os.environ.get(V.ENV[r.target][0], '')).netloc,
                                    'info': r.info, 'steps': r.steps}

    def clean(v):
        if isinstance(v, str):
            return V.redact(v)
        if isinstance(v, list):
            return [clean(x) for x in v]
        if isinstance(v, dict):
            return {k: clean(x) for k, x in v.items()}
        return v

    with open(RESULT, 'w', encoding='utf-8') as f:
        f.write(json.dumps(clean(out), indent=1, ensure_ascii=False) + '\n')


def main(argv):
    cmd = argv[1] if len(argv) > 1 else ''
    if cmd not in ('plan', 'run'):
        V.say(__doc__)
        return 2
    rc = 0
    if cmd == 'plan':
        for t in V.targets(argv[2:]):
            try:
                plan(t)
            except V.Refused as e:
                V.say('  [%s] %s' % (t, e))
                rc = 1
        V.say('\nNothing was sent. "kits.py run" does this; "verify.py cleanup" removes it.')
        return rc
    started, runs = datetime.datetime.now().isoformat(timespec='seconds'), []
    for t in V.targets(argv[2:]):
        V.say('== %s ==' % t)
        run = V.Run(t)
        runs.append(run)
        try:
            kit = Kit(t)
            bad = kit.problems()
            if bad:
                raise V.Refused('the kit has names without the %s prefix, which cleanup could not remove: %s' % (P, '; '.join(bad[:5])))
            (run_netbox if t == 'netbox' else run_nautobot)(run, kit)
        except V.Refused as e:
            s = run.step('refused', 'the run was refused', 'accept')
            s['accepted'], s['messages'] = False, [str(e)]
            run.done(s)
        except Exception as e:                              # noqa: BLE001 - every run reports
            s = run.step('crashed', 'the run stopped', 'accept')
            s['accepted'], s['messages'] = False, ['%s: %s' % (type(e).__name__, V.redact(e))]
            run.done(s)
        write_result(runs, started)
    V.say('\nWrote %s' % RESULT)
    for run in runs:
        failed = [s for s in run.steps if s['accepted'] is False]
        V.say('%s: %d steps, %d failed%s' % (run.target, len(run.steps), len(failed),
                                             '' if not failed else ': ' + ', '.join(s['id'] for s in failed)))
        rc |= 1 if failed else 0
    return rc


if __name__ == '__main__':
    sys.exit(main(sys.argv))
```

- [ ] **Step 4: Write the README**

Create `tools/dcim-verify/README.md`:

````markdown
# dcim-verify

Checks the Rack Builder's NetBox and Nautobot exports against real instances. Two
tools, both Python 3 standard library only, both run by a person who has test
instances and their credentials:

- **`kits.py`**: the acceptance. Imports the two import kits the Rack Builder really
  exports (`export_kits.py` makes them) into a NetBox and a Nautobot, in the order each
  kit's README gives, and compares the cables each ends up with against the rack's.
  Run it after a change to the DCIM exports, and after a Portrayal sync.
- **`verify.py`**: the column probes. Imports small hand-written files, good and bad,
  to learn what each instance accepts and what it says when it refuses. Its run of
  2026-10-04 against NetBox 4.7.2 and Nautobot 3.2.6 is what the kits' columns, values
  and README wording were written from.

Nothing here is served by the site, and nothing here is run by CI against a real
instance. CI runs `selftest.py`, which runs `kits.py` against a local mock.

## Run the acceptance

```sh
# in your own shell; the scripts read these and nothing else
export NETBOX_URL=http://netbox.test:8880
export NETBOX_USER=...            NETBOX_PASSWORD=...     # the web UI sign-in: NetBox imports go through the UI
export NETBOX_TOKEN=...                                    # optional: without it the REST reads use the session
export NAUTOBOT_URL=http://nautobot.test:8881
export NAUTOBOT_TOKEN=...                                  # the CSVs and import_cables.py use the REST API
export NAUTOBOT_USER=...          NAUTOBOT_PASSWORD=...    # optional: imports the type YAML through the UI

python3 tools/dcim-verify/export_kits.py           # exports both kits from the page into tools/dcim-verify/kits/
python3 tools/dcim-verify/kits.py plan             # offline: every file it would send, every cell it would change
python3 tools/dcim-verify/kits.py run              # both targets; or: run netbox / run nautobot
python3 tools/dcim-verify/verify.py cleanup --dry-run
python3 tools/dcim-verify/verify.py cleanup        # delete every pt-verify- object
```

`export_kits.py` needs Playwright (`pip install playwright && playwright install
chromium`), as `check-browser.py` does. It opens `acceptance.rack.json` in the Rack
Builder and clicks Export > NetBox import and Export > Nautobot import.

`kits.py run` writes `kits-result.json` and exits 0 only when every step passed. A
second run needs a `cleanup` first; `--continue` skips that check.

### What it does

| | NetBox | Nautobot |
|---|---|---|
| What the README says must exist | a site, a device role, the manufacturers: created through the UI's import pages | manufacturers, a role, a location type and location, the rack: created through REST JSON |
| README step 1, `types/` | each YAML through Device Types > Import and Module Types > Import | through the UI's import pages when `NAUTOBOT_USER` is set; otherwise built over REST from the YAML ("REST fallback"), which does not test the YAML import |
| The CSV files | `1-rack.csv`, `2-devices.csv`, `3-modules.csv`, `4-cables.csv`, each through its UI import page | `1-devices.csv`, `2-modules.csv` to the REST API as `text/csv` |
| The cables | in `4-cables.csv` | the kit's own `import_cables.py 3-cables.csv`, a dry run and then `--apply` |
| The comparison | each cable NetBox has, by label: its two ends (kind, device, port), type, status, length, unit and description, against the kit's row | each cable Nautobot has, by label: its two ends by id, type, length and unit, against the kit's row |

The last step, `cables_compared`, also lists every cable of `acceptance.rack.json`: in
the cables file and connected as written, or left out with the README's sentence and
absent from the instance.

### What a passing run shows

| Step in `kits-result.json` | Shows |
|---|---|
| `kit_racks`, `kit_devices` accepted (NetBox) | the rack file and a devices file with the site and role filled in import; the device left out of the file (`pt-verify-demarc-i3`, which shares U14) is what kept NetBox from refusing it |
| `kit_devices` accepted with 4 rows (Nautobot) | Nautobot takes the pair NetBox refuses, and the file keeps both |
| `kit_modules` accepted | every seated card imports by device name and bay name |
| `kit_cables` accepted (NetBox) | every port name in the file exists: the names came from the type files, a card port as `<bay position>/<leaf>`; a blank type and a decimal length import |
| `script_dry_run`, `script_apply` exit 0 (Nautobot) | `import_cables.py` finds every end by name and creates every cable by id, with whole-number lengths |
| `cables_compared` accepted | each instance holds exactly the cables its kit lists, connected as written, and every other cable of the rack is named in the README |
| the `types_…` steps, without `_rest` in their id (Nautobot, with a UI sign-in) | Nautobot's own YAML import takes the kit's `types/` folder |

## Safety

- Every object created is named `pt-verify-…` (a cable: its label; a type: its model).
  `acceptance.rack.json` names its rack, devices, cable labels, site and role that way.
- A manufacturer and a type cannot be named by the rack, so `kits.py` renames them with
  the prefix as it sends them: in each YAML's identity lines (`manufacturer`, `model`,
  `slug`) and in the CSV cells that name them. Each step records how many cells it
  changed. Every other cell goes in as the kit has it.
- `kits.py` refuses a kit that would create a name without the prefix, before it sends
  anything.
- `cleanup` asks for objects by that prefix, then checks each returned name on this side
  before deleting it, so a filter the instance ignores cannot widen it.
- Each target talks to the host in its own `…_URL` and no other: a request or a redirect
  to another host is refused. A URL that carries credentials is refused.
- No credential is printed, logged or written. Console output, the result files and the
  saved pages pass through a redactor that replaces each credential's value with `***`.

## The column probes

```sh
python3 tools/dcim-verify/verify.py plan       # offline
python3 tools/dcim-verify/verify.py run        # writes result.json; a refused UI import's page goes under out/
```

`fixture/` holds the probe files. A file named `…-v-…` is a variant whose result is not
known beforehand; `…-x-…` is one expected to be refused, sent to capture the instance's
error text. `result.json` records, per step, the request, whether it was accepted, and
the instance's own messages.
````

- [ ] **Step 5: Run the self-test and the offline plan, and see them pass**

Run: `python3 tools/dcim-verify/selftest.py`
Expected: `Ran 5 tests` and `OK`, in about a second.

Run: `python3 check-contract.py`
Expected: `contract: 299 checks passed`.

Run: `python3 tools/dcim-verify/kits.py plan` (after Task 9's `export_kits.py`; no environment variable is needed)
Expected, for each target: "every name the kit creates starts with pt-verify-: yes"; seven `import  types/…` lines; for NetBox `1-rack.csv` 1 row and 0 cells prefixed, `2-devices.csv` 3 rows and 6 cells, `3-modules.csv` 11 rows and 11 cells, `4-cables.csv` 3 rows and 0 cells; for Nautobot `1-devices.csv` 4 rows and 8 cells, `2-modules.csv` 11 rows and 22 cells, and "run     import_cables.py 3-cables.csv (dry run), then --apply: 4 row(s)"; then the "left out by the kit:" lines (four for NetBox, two for Nautobot). The last line is `Nothing was sent. "kits.py run" does this; "verify.py cleanup" removes it.`

- [ ] **Step 6: Commit**

```bash
git add tools/dcim-verify/kits.py tools/dcim-verify/selftest.py tools/dcim-verify/README.md check-contract.py
git commit -m "tools: kits.py - the acceptance that imports the exported kits into a real NetBox and Nautobot

It sends each kit's files in the order its README gives: through NetBox's
import pages, and to Nautobot as text/csv followed by the kit's own
import_cables.py. Then it compares the cables each instance holds with the
kit's rows and the rack's cables. Manufacturers and types gain the pt-verify-
prefix so cleanup can find them; a kit with any other unprefixed name is
refused. A self-test runs it against a mock of both, from check-contract.py.
The run against real instances is the user's.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 7: THE ACCEPTANCE, run by the user**

The implementer stops here and reports. **The user** runs this, in their own shell, against their test instances. Nobody else has, or may ask for, the credentials.

```sh
cd <the repository>
python3 tools/dcim-verify/export_kits.py           # the two kits, exported from the page

export NETBOX_URL=http://10.33.100.50:8880
export NETBOX_USER=...        NETBOX_PASSWORD=...
export NAUTOBOT_URL=http://10.33.100.50:8881
export NAUTOBOT_TOKEN=...
export NAUTOBOT_USER=...      NAUTOBOT_PASSWORD=...  # optional: also imports the type YAML through Nautobot's UI (ruling 11)

python3 tools/dcim-verify/verify.py cleanup        # the instances still hold the 2026-10-04 probe run's pt-verify- objects
python3 tools/dcim-verify/kits.py plan             # offline: read what it will send
python3 tools/dcim-verify/kits.py run              # both targets; writes tools/dcim-verify/kits-result.json
python3 tools/dcim-verify/verify.py cleanup        # afterwards
```

`kits.py run` prints one line per step, `ACCEPTED`, `REJECTED` or `NOT RUN`, with the instance's own messages beneath a rejected one, and ends with `netbox: N steps, 0 failed` and `nautobot: N steps, 0 failed` when everything passed (exit code 0). What proves each ruling:

| Ruling | What to look for in the output or in `kits-result.json` |
|---|---|
| 1, one kit per target, files in import order | Each `README step N: <file>` line is `ACCEPTED`, in the order printed. NetBox: steps 1 to 5; Nautobot: steps 1 to 4. |
| 2, site, role, status; the rack file | NetBox `kit_racks` (`1-rack.csv`, 1 row) and `kit_devices` are `ACCEPTED`: a devices file with `site` and `role` filled in, naming a rack the rack file created, all `planned`. Nautobot `kit_devices` is `ACCEPTED` with `location__name` and `role__name` filled in. |
| 3, rows NetBox would refuse are left out | NetBox `kit_devices` is `ACCEPTED` with **3 rows**. `pt-verify-demarc-i3` (at U14 behind `pt-verify-leaf-1`) is the row that made the whole file fail on 2026-10-04 ("U14 is already occupied…"); it is absent, and `kits.py plan` prints the README line naming it. Nautobot `kit_devices` is `ACCEPTED` with **4 rows**. |
| 4, port names from the type files | NetBox `kit_cables` is `ACCEPTED` (one missing port would refuse the file, "termination not found"). `cables_compared` shows `pt-verify-A1` and `pt-verify-blank` connected to `slot-2/p0` and `slot-2/p1`, the names the module import produced. |
| 5, the modules file | `kit_modules` is `ACCEPTED` on both, 11 rows: every part seated in a bay of `pt-verify-core-1`. |
| 6, NetBox cables | NetBox `kit_cables` is `ACCEPTED` with 3 rows, among them `pt-verify-blank` with a blank type and `1.5 ft`. In `cables_compared`, the three are "as written" (ends, type, status, length, unit, description), and `pt-verify-loose`, `pt-verify-pair` and `pt-verify-console` each carry their README sentence and "not there, as expected". |
| 7, Nautobot cables through the script | `script_dry_run` exits 0 and prints four "would connect" rows and "Nothing was created."; `script_apply` exits 0 with "4 rows: 4 created, 0 not." In `cables_compared`, `pt-verify-A1`, `pt-verify-mgmt`, `pt-verify-pair` and `pt-verify-blank` are "as written": each cable's two ends, by id, are the ports the file names, and `pt-verify-pair` and `pt-verify-blank` are 2 ft. `pt-verify-console` is left out with "Nautobot does not cable a console port to an interface." Neither credential appears in the output. |
| 8, best-guess types | The device rows import against the types in the kit's own `types/` folder (`kit_devices` `ACCEPTED`); the README's "best guess" lines are in `kits/…zip`'s `README.txt`. |
| 9, the cable notes retired | `unzip -p tools/dcim-verify/kits/pt-verify-rack-netbox-import.zip README.txt | grep -c "not in this export yet"` prints 0. |
| 10, the acceptance itself | Both summary lines read `0 failed`, and both `cables_compared` steps are `ACCEPTED`. |
| 11, Nautobot's type YAML through its UI | With `NAUTOBOT_USER` and `NAUTOBOT_PASSWORD` set: the seven `README step 1, through the UI: types/…` lines are `ACCEPTED` and no step id ends `_rest`. Without them the lines read "[REST fallback, not the UI import]" and ruling 11 stays unconfirmed. |

If a step is `REJECTED`, the instance's own message is under it and in `kits-result.json`; a refused NetBox import's page is saved under `tools/dcim-verify/out/`. Send the controller `kits-result.json` (it holds no credential; it does name the two hosts). A rejection is a finding about the kit, to be fixed in the task that owns the rule, not worked around in `kits.py`.

- [ ] **Step 8: Only if the run confirms ruling 11**

Ruling 11 keeps "This step is written from Nautobot's source and was NOT verified against Nautobot 3.2." in the Nautobot README unless the acceptance run, with a UI sign-in, shows the seven type files importing through Nautobot's UI. If it does, and only then, make this change and commit it; otherwise leave the sentence.

In `site/rack/dcim-rules.js`, in `kitReadme`, replace

```js
      typeFiles ? `1. ${types}: Device Types > Import and Module Types > Import, one YAML file per import. This step is written ` +
                  'from Nautobot\'s source and was NOT verified against Nautobot 3.2.'
                : '1. types/: no files, so there is nothing to import.',
```

with

```js
      typeFiles ? `1. ${types}: Device Types > Import and Module Types > Import, one YAML file per import.`
                : '1. types/: no files, so there is nothing to import.',
```

The same sentence is pinned in two tests, which change with it. In `tests/rack/dcim-import.test.mjs`, in the test "the Nautobot kit's README: the rack and the Planned status must exist, the types step is unverified, the cables go through the script", the expected line becomes `'1. types/device-types/, then types/module-types/ (2 files): Device Types > Import and Module Types > Import, one YAML file per import.'`. In `check-browser.py`, in `check_rack_dcim_kit_nautobot`, delete the line `"This step is written from Nautobot's source and was NOT verified against Nautobot 3.2."):` and end the line before it with `):` in place of its trailing comma.

Run: `node --test tests/rack/*.test.mjs && python3 check-browser.py --only check_rack_dcim_kit_nautobot`
Expected: `# fail 0`, and `ok`.

```bash
git add site/rack/dcim-rules.js tests/rack/dcim-import.test.mjs check-browser.py
git commit -m "rack: the Nautobot kit's types step is verified - its README no longer says otherwise

The acceptance run imported the kit's types folder through Nautobot 3.2's own
import pages.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Wrap-up: the dev note, the spec, the whole suite

**Files:**
- Modify: `rack.html`, `check-browser.py`, `docs/superpowers/specs/2026-09-26-rack-builder-design.md`

**Interfaces:**
- Consumes: everything Tasks 1 to 10 produced. Produces no code interface.

- [ ] **Step 1: Write the failing check for the dev note**

In `check-browser.py`, replace

```python
                 "Coming next: cable import for NetBox and Nautobot."):
        if want not in body:
            bad.append(f"dev note: the note doesn't mention {want!r}")
    for gone in ("Coming next: cabling.", "Coming next: cables in the exports and in 3D."):
```

with

```python
                 "Export has an import kit for NetBox and one for Nautobot: types, devices, modules and cables, in import order, with a README.",
                 "Set the site and the device role they name under Export, DCIM import settings."):
        if want not in body:
            bad.append(f"dev note: the note doesn't mention {want!r}")
    for gone in ("Coming next: cabling.", "Coming next: cables in the exports and in 3D.",
                 "Coming next: cable import for NetBox and Nautobot."):
```

Run: `python3 check-browser.py --only check_rack_dev_note`
Expected: `FAIL`: the note doesn't mention "Export has an import kit for NetBox and one for Nautobot…", doesn't mention "Set the site and the device role they name…", and still says "Coming next: cable import for NetBox and Nautobot."

- [ ] **Step 2: The dev note**

In `rack.html`, replace

```html
        <p>Coming next: cable import for NetBox and Nautobot.</p>
```

with

```html
        <p>Export has an import kit for NetBox and one for Nautobot: types, devices, modules and cables, in import order, with a README.</p>
        <p>Set the site and the device role they name under Export, DCIM import settings.</p>
```

Run: `python3 check-browser.py --only check_rack_dev_note`
Expected: `ok`.

- [ ] **Step 3: Bring the spec up to date**

In `docs/superpowers/specs/2026-09-26-rack-builder-design.md`, replace

```markdown
**Status:** design approved; Phase 0 implemented; Phase 1a implemented (plan: docs/superpowers/plans/2026-09-26-rack-builder-phase1a-build-a-rack.md); Phase 1b implemented (plan: docs/superpowers/plans/2026-09-27-rack-builder-phase1b-exports.md); Phase 2a (cabling on the page) implemented (plan: docs/superpowers/plans/2026-10-03-rack-builder-phase2a-cabling.md); Phase 2b (cables in the exports and in 3D) implemented (plan: docs/superpowers/plans/2026-10-03-rack-builder-phase2b-cable-exports.md); Phase 2c (NetBox and Nautobot cable import) next
```

with

```markdown
**Status:** design approved; Phase 0 implemented; Phase 1a implemented (plan: docs/superpowers/plans/2026-09-26-rack-builder-phase1a-build-a-rack.md); Phase 1b implemented (plan: docs/superpowers/plans/2026-09-27-rack-builder-phase1b-exports.md); Phase 2a (cabling on the page) implemented (plan: docs/superpowers/plans/2026-10-03-rack-builder-phase2a-cabling.md); Phase 2b (cables in the exports and in 3D) implemented (plan: docs/superpowers/plans/2026-10-03-rack-builder-phase2b-cable-exports.md); Phase 2c (NetBox and Nautobot import kits: devices, modules and cables) implemented (plan: docs/superpowers/plans/2026-10-04-rack-builder-phase2c-dcim-import.md)
```

In `docs/superpowers/specs/2026-09-26-rack-builder-design.md`, replace

```markdown
| DCIM device types | NetBox or Nautobot YAML for every distinct device and module in the rack, zipped with `makeZip`. |
| **DCIM device import (CSV)** | One row per item, with NetBox's `device_type`, `rack`, `position`, `face` and `name` columns, plus Nautobot's equivalents. Positions follow the frame's numbering. |
```

with

```markdown
| **DCIM import kit**, one zip per target | Files numbered in import order, zipped with `makeZip`, with a `README.txt` that says what to do with each, what must already exist, and what the kit could not carry. `types/`: NetBox or Nautobot YAML for every distinct device and module in the rack. NetBox: `1-rack.csv`, `2-devices.csv`, `3-modules.csv`, `4-cables.csv`. Nautobot: `1-devices.csv`, `2-modules.csv`, `3-cables.csv` and `import_cables.py`, which creates the cables from that file (Nautobot imports a cable's ends by id only). One device row per item, with NetBox's `device_type`, `rack`, `position`, `face` and `name` columns or Nautobot's equivalents; positions follow the frame's numbering. The site or location and the device role come from the rack's optional `dcim` settings. A row the target would refuse is left out and named in the README. |
```

In `docs/superpowers/specs/2026-09-26-rack-builder-design.md`, replace

```markdown
- **NetBox cable import comes last**, as Phase 2c. It is no longer blocked on the upstream `{module}` naming token: the token is in the vendored module types (a card's interfaces are named `'{module}/p0'`…). It needs the modules installed first - a card port's interface exists in NetBox only once a module of that type is in its bay, so a module import comes before the cables - and the import columns of both targets verified against a real instance (the Phase 2b plan's "Not in Phase 2b" records what is established).
```

with

```markdown
- **NetBox and Nautobot cable import** (Phase 2c) is part of each target's import kit (§8). A port's name comes from the matched type file's own name lists, never from convention alone: a fixed port is its drawing path looked up there, and a card port `<bay>/module/<leaf>` is `<bay position>/<leaf>`, the name the module's `{module}/<leaf>` gets once the module is in the bay whose position is `<bay>`. So the modules file comes before the cables file. The columns and values of both targets were verified against a real NetBox 4.7 and Nautobot 3.2 (`tools/dcim-verify/`).
```

The first block is the end of the `**Status:**` line; the second replaces §8's two DCIM rows with one; the third is §9.4's last item.

- [ ] **Step 4: Run the whole suite from a clean start**

Run: `uptime`, then `node --test tests/*/*.test.mjs && ./chassis-index.py && git diff --exit-code site/rack/chassis.json && python3 check-contract.py && python3 check-browser.py`
Expected:
- `# tests 191`, `# pass 191`, `# fail 0` (183 of them under `tests/rack/`);
- `contract: 299 checks passed`;
- `browser: 129 checks passed, 15 pages, 7 stage rail, and 25 in the marks harness`, with every line `ok`, among them the four new checks (DCIM import settings, the NetBox import kit, the Nautobot import kit, the acceptance rack) and the two rewritten ones (one import kit per target in the menu, the kits' devices files).

If a showcase 3D or page-load check times out, run `uptime`, then re-run that check on `main`. It is environmental only if it fails there too (issue #59).

- [ ] **Step 5: Check the whole flow by hand, as a user would, at `http://localhost:8932/rack.html`**

1. Build a small rack: a four-post frame, 24U; an AS7726 at U14 front with an optic in port 1; an ASR-9006 at U2 with a 16x100GE card in slot 2 and an optic in its first port; a TM-280 at U20 rear and another at U14 rear.
2. Cable the two optics (OS2, label "A1", 2 m), the AS7726's management jack to a copper port of the TM-280 at U20, and an empty cage to a copper port of the TM-280 at U14.
3. Open Export. The DCIM entries are "DCIM import settings", "NetBox import (.zip)" and "Nautobot import (.zip)"; there is no "device types" or "device import" entry.
4. Export the NetBox import without setting anything. Unzip it: `types/`, `1-rack.csv` to `4-cables.csv`, `README.txt`. The README's first lines say `2-devices.csv` will be refused and name the `site` and `role` columns. The TM-280 at U14 is not in `2-devices.csv` and is named under "NOT IN THIS KIT", with its cable; the loose cable is there too, with its reason. `4-cables.csv` has two rows, one of them ending at `slot-2/p0`.
5. Open Export, DCIM import settings. Type a site and a role, press Done, and export again: every device row and the rack row carry them, and the warning is gone. Save the rack file and look in it: `"dcim": {"site": …, "role": …}`.
6. Export the Nautobot import. `1-devices.csv` has all four devices. `3-cables.csv` has `a_device`, `a_type`, `a_name` columns, and none named `termination_…`. `import_cables.py` is in the zip and is the file at `site/rack/nautobot/import_cables.py`. The README tells you to run the script and not to give `3-cables.csv` to Nautobot's own importer.
7. In the unzipped Nautobot kit, run `python3 import_cables.py 3-cables.csv` with no environment variables: it prints `NAUTOBOT_URL must be an http or https address, such as https://nautobot.example.com.` and exits 2. It contacted nothing.
8. Open a rack saved before this phase: it opens as it was, and saving it again writes no `dcim` field.
9. Open a rack with no cables and export both kits: the cables file is its header alone, and the README says it has no rows.
10. Export the cable schedule, the BOM, the sheet and draw.io: unchanged by this phase.

- [ ] **Step 6: Commit**

```bash
git add rack.html check-browser.py docs/superpowers/specs/2026-09-26-rack-builder-design.md
git commit -m "rack: Phase 2c is implemented - an import kit for NetBox and one for Nautobot

Each kit holds the types, the devices, the modules and the cables, in import
order, with a README that says what must exist and what is left out; NetBox's
has the rack, Nautobot's the script that creates its cables. The dev note and
the spec say so. The acceptance against real instances is the user's run of
tools/dcim-verify.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Rulings the plan could not follow

None was impossible. Two are followed by the nearest workable thing, and five with a refinement the code or the real instances called for:

- **Ruling 2, "the loader keeps unknown fields".** It does not: `parseDoc` builds each rack from the fields it knows and drops any other rack-level field. So Task 5 reads `dcim` explicitly, keeps any field inside it that the page does not know, and adds no `dcim` key to a rack that has none. No version bump: the loader's rule is to refuse a newer version, which would lock a file out of an older page for the sake of two names that page can safely ignore.
- **Ruling 10, "imports the Rack Builder's REAL exported kits".** The acceptance imports the two zips exactly as the page exported them, with one change: a manufacturer and a type gain the `pt-verify-` prefix, in the YAML's identity lines and in the CSV cells that name them (Task 10). The ruling also requires the prefix and a cleanup "as now", and a rack cannot name a manufacturer or a type; without the change the run would create a "Cisco" and its types in the user's instance that cleanup could not tell from the user's own. `kits.py` records how many cells it changed per file, and refuses a kit holding any other unprefixed name.
- **Ruling 3, the rows left out.** The ruling names the shared-U case. The plan also leaves out a device with **no device type**, on both targets, by the ruling's own reasoning: the type is a required column, so that row too would refuse the whole file. Today it is written with a blank type and a comment.
- **Ruling 5, "one row per seated card".** The modules file holds every part seated in a bay that has a module type: line cards, and also power supplies, fan trays and slot covers. They are in the kit's `types/` folder as module types, their bays are module bays, and leaving them out would import a device with parts missing. A part with no module type is not a row, as ruled.
- **Ruling 6, the conditions for a cable row.** Three more than the ruling lists, each a case the real NetBox refuses or cannot judge: a port an earlier row already uses (possible only in a hand-edited rack file; NetBox answers "is already connected" and refuses the file); cabled ends that could not be read at all (no row is written, since a loose end might be among them, and each cable is listed with "its ends could not be checked"); and a length with a third decimal place, which is rounded up to two for NetBox, with a note.
- **Ruling 7, the script.** It creates each cable with the request the real Nautobot accepted, a `text/csv` POST naming the ends by type and id, one cable per request so that each row is reported on its own. Before looking anything up it checks that this Nautobot honors the `device` filter, and stops if it does not. A cable's purpose is not carried, because a Nautobot cable has no description; the README says so.
- **Ruling 4, a console port.** "The drawing path looked up in the name lists" finds no console port: the type files name it `Console`, not by its path. So a path the drawing marks as a console port resolves to `Console (<path>)` when the type file lists that, or to the type's only console port when the drawing also has only one; two drawn and no way to tell them apart is "does not resolve". The name still comes from the file's own list.

## Not in Phase 2c (so nobody adds it here)

- **Cassette and adapter-panel ports.** A cassette's module type lists `front-ports` `{module}/1`… and `rear-ports` `{module}/MTP-1`, while its drawing's paths are `lc1`…. No rule here bridges that, so a cable to one is left out with "the module type … lists no port named {module}/lc1". The module types also map no front port to a rear port. Both are for the upstream exporter (a numbering the drawing and the YAML share; `port-mappings` for NetBox, `rear_port` for Nautobot), not for a table in this site.
- **A module inside a card** (a MIC in a line card). No module type has a module bay, so there is nothing to import it into; its ports are left out and said.
- **The other device types whose drawing paths are not their YAML's names** (the Smartoptics passive units, the CSFP line cards, `as7326-56x`'s `port-57`). A cable to such a port is left out with its reason. Fixing the names is upstream.
- **A prerequisites file.** The kit does not create the site or location, the role, the manufacturers, or (for Nautobot) the rack. The README lists them. Only the acceptance kit creates them, for its own run.
- **A Nautobot rack file.** As ruled, the Nautobot kit has none.
- **Updating what an instance already has.** A kit creates. Importing it twice, or into an instance that holds some of it, is refused by the instance (NetBox) or skipped per port (`import_cables.py`).
- **A Nautobot app or Job** in place of the script, and any NetBox REST route. NetBox takes the files through its own import pages.
- **Active or passive DAC.** A DAC is written `dac-passive`, and the README says to change one that is active.
- **Cable colors.** The `color` column is written blank.
- **`side_a_site` / `side_b_site`, tenants, and devices of the same name in two sites.** NetBox finds a device by name in every site; the README says a name it already has twice is refused.
- **Power.** Power ports resolve by name like any port, but the Rack Builder's media have no power cable, and no power feed or outlet is written.
- **Zero-U items, breakouts, cable managers, cables between racks, routes.** As in Phase 2b; `rackNotes` keeps the zero-U line in the README.
- **Removing `rackNotes`' `cables` option.** No export asks for the sentence after Task 8, but the option and its tests stay.
- **A version bump of the rack file.** `dcim` is optional and the version stays 1.
- **`exporter.html`.** The site's DCIM export page is a different tool and is untouched.
- **Other versions.** The columns were verified against NetBox 4.7.2 and Nautobot 3.2.6 only.
- **The showcase.** Nothing in it changes.
