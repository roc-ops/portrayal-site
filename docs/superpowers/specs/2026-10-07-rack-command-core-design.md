# Rack Builder command core

**Date:** 2026-10-07
**Status:** design approved in conversation; spec awaiting review
**Builds on:** `2026-09-26-rack-builder-design.md` (§5 the rack file, §9 cables), `2026-10-07-rack-face-managers-design.md`
**Asked for by:** the "Agent integration research" session (agents with bring-your-own inference will drive the Rack Builder next)

---

## 1. Why, and where this sits

Two things are planned for the Rack Builder: it moves into `@portrayal/kit` (upstream `kit/`) so the site and Portrayal stop drifting, and AI agents drive it. Jason chose to do the move first, and to build the agent command layer in the kit on top of it. So the builder's API must be command-based: every edit a named command that is checked, applied whole or not at all, undoable step by step, and announced. Then the agent layer (WebMCP, the MCP-B relay, a chat box, all site-side and later) is mostly wrapping.

Today the edits are trapped in closures in `site/rack-page.js` (`place`, `patchItem`, `attachManager`, `commitFrame`, `putDcim`, the cable form's save, the remove panel's buttons), each re-checking the rack by hand, and all funnelled through `commit(nextRack, undoable)` with a single level of Undo in `S.undo`.

The work is split into four pieces, each with its own spec, plan and PRs:

| Piece | Delivers | Where |
|---|---|---|
| **1 (this spec)** | The command core: commands, `apply`, history, a headless editor, queries, the rack schema. `rack-page.js` rewired onto it. Undo/Redo on every edit. | site, kit-ready |
| 2 | The core moves to `kit/rack/`: model, fit, managers, rails, cable rules and this spec's modules, with the `fit.js` -> `export-data.js` tangle undone. The site re-vendors. The rack schema moves to upstream `spec/schemas/`. | upstream PR, then a site sync |
| 3 | The builder as a kit component: `mount`, `getDoc`/`loadDoc`, `apply`, `on('change')`, selection get/set, `export(kind)` returning `{name, data, type, notes}`. Needs elevation, `face.js` and the exports untangled from site paths. | upstream, then site |
| 4 | Annotate and Explorer hooks: Annotate's `doc` gets a live get/set; `shell.js`'s `createShell` gets a supported way out; Explorer's lamp states become state, not DOM classes; a marks JSON Schema. | upstream; independent of 1-3 |

Decided in conversation (2026-10-07):

| # | Question | Decision |
|---|---|---|
| D1 | Build piece 1 in the site or upstream first | **Site first**, kit-ready, proved against the existing browser checks; piece 2 is then a mechanical move (as cable piece 2 and the draw.io move were). |
| D2 | What is undoable | **Every edit**, one step per `apply` (a batch is one step). Permanent Undo and Redo buttons, Cmd/Ctrl+Z and Shift+Cmd/Ctrl+Z. Snapshots, capped at 100, not persisted across reloads. DCIM import settings stay outside the history, as today. |
| D3 | A batch that creates something and then uses it | Commands may name what they create (`as: "srv"`) and later commands in the same batch refer to it as `"@srv"`. |
| D4 | Where command argument shapes live | One table, `COMMANDS`, in `commands.js`: name, description, a JSON Schema for the arguments. `apply` checks against it; the agent layer registers tools from it. |

## 2. Modules

All new modules are pure: no DOM, no `fetch` except through what they are handed, no import of a site path (`../faces.js`, `../svg-export.js`, ...). They import only from `site/rack/` modules that are themselves on piece 2's move list. Comments in them are written in British spelling, since they are upstream's code from piece 2 on.

### 2.1 `site/rack/commands.js`

One function per command, `(rack, args, ctx) -> result`, where `ctx` is `{chassisOf}` and a result is either

```js
{rack, summary, findings: [{kind: 'note' | 'error', text}], created?: {as?: id, ...}}
```

or `{error: 'plain-English reason'}`. A command that changes nothing returns the **same rack object** it was given (see §3.4).

| Command | Arguments | Built on | Errors (today's sentences) |
|---|---|---|---|
| `place` | `ref, cfg, face, ru, label?, as?` | `isRackFace` -> `placement`; `fits`; `withItem` | `fits`' reason; unknown `ref` |
| `move` | `id, ru?, face?` | `moveItem` | GONE; `moveItem`'s reasons, incl. "X moves with it: ..." |
| `patch` | `id, cfg?, swaps?, fields?, label?, turned?` | `updateItem` | GONE. Finding (note): "Your Explorer changes were for the old configuration, so they were cleared." under today's condition (`patchItem`) |
| `remove` | `id, cables: 'keep' \| 'remove'` | `withoutItem`, `withoutCablesOf`, `managersOf` | GONE. Summary is today's undo text ("Removed X and its 2 cables. Its cable manager Y stays on the rack.") |
| `attach` | `id` | `moveItem` at its own U and face | GONE; `moveItem`'s reasons; "X is not over a device." when nothing is there (new: today this attaches to nothing and says "Attached X to the device.") |
| `detach` | `id` | `detached` | GONE |
| `frame` | `kind?, heightRU?, numbering?, holes?, railDepth?, usableDepth?` | `withFrame`; `shrinkRack` when the height drops | Finding (note): today's "Moved n devices down and removed m from the bottom to fit hU: ... k cables are kept as loose ends." |
| `rename` | `name` | `renamed` | blank name |
| `dcim` | `site?, role?` | `withDcim` | none |
| `cable.add` | `a, b, media?, purpose?, label?, length?, as?` | `canCable`, `withCable` | NOT_ADDED when an end's item is gone; `canCable`'s reasons |
| `cable.update` | `id, media?, purpose?, label?, length?` | `updateCable` | "That cable is no longer in the rack." |
| `cable.remove` | `id` | `withoutCable` | as `cable.update` |
| `cable.route` | `id, route` | `updateCable(rack, id, {route, routeEdited: true})` | as `cable.update` |
| `cable.route.reset` | `id` | `updateCable(rack, id, {route: [], routeEdited: undefined})` | as `cable.update` |
| `lengths.routed` | none | `withRoutedLengths(rack, ctx)` (`route.js`) | none. **System**: not a history step, not offered to agents |

GONE is today's `'That device is no longer in the rack.'`. The sentences move from `rack-page.js` into `commands.js` unchanged, so the browser checks that assert them keep passing.

`holes` in `frame` is merged with the frame's current `holes`, as `commitFrame` does today.

`dcim` is a command so that agents and the API have one way in, but it is **not** recorded in history (§3.3).

The `cable.route*` and `lengths.routed` rows come from cable-management piece 2 (pathways and routes, branch `claude/cable-routing-pathways`), which lands before this work starts (§6). Route editing and reset are ordinary undoable edits, as piece 2 makes them. `lengths.routed` is the page re-measuring the routed lengths after a render's route facts: a derived update the page saves without an Undo step today, and it stays that way. Two flags in `COMMANDS` say this:

- `step: false` (`dcim`, `lengths.routed`): applied and saved, never recorded in history; an undo or redo restores its snapshot with the current values of what these commands own (`dcim`; the routed lengths are re-measured by the next render anyway);
- `system: true` (`lengths.routed`): the agent adapters do not offer it, and the page sends it with `origin: 'system'`.

If piece 2's final shape differs from this when it lands (its PR is not open at the time of writing), the plan follows what landed: the commands wrap whatever `route.js` and `rack-page.js` do then.

Every command's `summary` is one line for the history and change events: "Placed Nexus 93180YC-EX at U12.", "Moved ... to U20 on the rear.", "Added cable c3.", "Renamed the rack to Core A.". Commands whose edit today raises an Undo notice (`remove`, `detach`, `cable.remove`, a shrinking `frame`) use today's undo text as their summary.

`COMMANDS` is exported alongside:

```js
export const COMMANDS = {
  place: {description: 'Put a device in the rack at a U on a face.',
          args: {type: 'object', required: ['ref', 'face', 'ru'], properties: {...}, additionalProperties: false},
          run: place},
  ...
};
```

The argument schemas use only the keywords `schema.js`'s `KNOWN` set renders, so piece 3 can show them on a page if wanted. A command's `op` is its key.

The table is what an agent reads, so it is written for one (asked for by the agent research, 2026-10-07):

- every argument property has a `description`, under about 150 characters; every command's `description` is under about 500;
- enum values are words, not codes (`front`/`rear`, `keep`/`remove`, the media names);
- a node test enforces both: every property described, the lengths within bounds.

Every command also takes an optional `rack`, the id of the rack it edits. Today only `racks[0]` is editable, so a `rack` naming any other rack is an error ("Only rack r1 can be edited here."); the argument exists now so the command shapes need not change when rows of racks come.

### 2.2 `apply` (in `commands.js`)

```js
apply(rack, cmd | cmd[], ctx) ->
  {rack, summary, findings, created, noop}   // all applied
  {error, index}                              // none applied
```

- A command is `{op, ...args}`. An unknown `op`, or arguments that fail its schema, is an error before anything runs: "place needs ru, a whole number.", "There is no command called 'plce'.".
- A batch runs in order against a working copy. The first error stops it; the rack given in is returned untouched (by reference, no partial result), with `index` saying which command failed.
- `as` / `@name` (D3): a command's `as` binds the id it creates (`place` an item id, `cable.add` a cable id). Before each later command runs, an id position equal to `"@name"` (an `id` argument, or the `item` of a cable end) is replaced with the bound id. Other strings, such as a label of `"@srv"`, are kept as written. An unbound `@name`, or a name bound twice, is an error.
- `summary` of a batch is its commands' summaries joined; `findings` are all of them in order; `created` maps every `as` name to its id, plus `ids`, the ids created in order.
- `noop` is true when every command returned its rack unchanged.
- `apply` never mutates its input, so calling it is also a dry run: the editor's `preview` (§2.4) is `apply` without the commit.

The argument check is a small validator over the subset of JSON Schema the argument schemas use (`type`, `required`, `properties`, `additionalProperties`, `enum`, `minimum`, `items`); no dependency is added.

### 2.3 `site/rack/history.js`

A snapshot stack of racks, each entry `{rack, summary}`:

```js
const h = createHistory({cap: 100});
h.record(before, after, summary);   // a new step; clears redo
h.undo(current) -> {rack, summary} | null
h.redo(current) -> {rack, summary} | null
h.canUndo, h.canRedo, h.undoSummary, h.redoSummary
h.clear()
```

The oldest step is dropped past the cap.

### 2.4 `site/rack/editor.js`: the headless editor

```js
const ed = createRackEditor({doc, chassisOf});
ed.getDoc(); ed.rack();
ed.loadDoc(doc)            -> {findings}            // settleManagers; clears history
ed.apply(cmds, {origin})   -> apply's result         // records history unless noop or dcim-only
ed.preview(cmds)           -> apply's result         // a dry run: nothing committed, recorded or emitted
ed.undo(); ed.redo()       -> {summary} | null
ed.canUndo / canRedo / undoSummary / redoSummary
ed.on('change', fn)        -> unsubscribe
```

A change event is `{cause: 'apply' | 'undo' | 'redo' | 'load', origin, commands, summary, findings, before, after}`, where `before` and `after` are racks. `origin` is whatever the caller of `apply` passed (`'ui'` by default; the agent adapters will pass `'agent'`), and an undo or redo carries the origin of the step it undoes, so the page can later say "Your assistant placed X at U12." without guessing. Selection is not here: it is UI state and joins the component in piece 3.

The document holds an array of racks and the page edits `racks[0]`, as today; the editor does the same, and `getDoc()` returns a new document whenever the rack changes.

### 2.5 `site/rack/queries.js`

| Query | Answers | Built on |
|---|---|---|
| `fitsAt(rack, {ref, face, ru}, ctx)` | `{ok}` or `{ok: false, reason}`, with the manager placement applied as `place` would | `placement`, `fits` |
| `freeUs(rack, {ref, face}, ctx)` | every U the device fits at, bottom-up | `fitsAt` |
| `catalog(devices, {text?, ru?, family?, mount?})` | the devices that can be placed: `{ref, manufacturer, model, ru, mount, configs, default}`, filtered by a case-insensitive match on manufacturer, model or ref, a height and a family | `catalogEntries` over `chassis.json` |
| `freePorts(rack, itemId, ctx)` | per port with no cable, on either panel: `{path, view, label, class, speed, media}`, async | the face's ports (`portsOf`: `data-path`, `data-media`, `data-speed`), `portFree` |
| `suggestMedia(rack, a, b, ctx)` | the media `cable.add` would propose for two ends, and any mismatch sentence, async | `cableFacts`, `proposeMedia`, `mismatch` |
| `looseEnds(rack, ctx)` | each cable end that does not land, with its reason, async | `cableFacts` |
| `describe(rack, ctx)` | a short reading of the rack for an agent: the frame in one line; per item its id, name (label, or model), U range, face, and the manager it carries or the device it is on; per cable `c3: i1/port-1 <-> i4/port-7, om4`. Plain lines, kept under about 1.5K characters for a full 42U rack by abbreviating the item lines once the rack is long, with a closing line saying how many were abbreviated. | `itemsWithU`, `positionOf`, `managersOf` |

`cableFacts` and the faces are read through the network and `DOMParser`, so the port queries are async. `cable-plugs.js` reaches `face.js`, which imports `../faces.js`; that tangle is piece 2's to undo, so `queries.js` takes its readers in `ctx` (`ctx.cableFacts`, `ctx.portsOf(item, view)`) rather than importing them. `catalog` and `describe` are synchronous and need nothing but the data. A port's `label` is its `data-path` made readable (`port-1` -> `port 1`, a group's name when the face gives one); the agent addresses the port by `path` and `view`, which is what `cable.add`'s ends take.

## 3. How an edit flows

### 3.1 The page

`rack-page.js` creates the editor at boot and subscribes to its changes; `S.doc` and `S.undo`/`S.undoText` go. One function replaces `commit()`:

```js
function edit(cmds, {select, focus} = {}) -> boolean
```

It calls `ed.apply`. On `{error}` it sets the error notice and renders. On success it sets the selection (`select` may be a function of `created`) and lets the change listener do the rest.

The change listener does what `commit()` does today: autosave, render, and keep or rebuild the 3D scene (`sameScene` / `keepScene` / `scheduleRebuild3d`). Findings of kind `note` become notices, as today's `addNotice` calls.

### 3.2 What stays in the UI

- The `confirm()` dialogs, and the remove panel's keep-or-remove choice (the UI picks `cables`).
- Cable mode's picking of ends, the cable form, the picker, drag previews.
- `S.focusNext` and focus handling.
- A stale panel's button now sends its command and gets GONE back, instead of re-checking the rack itself. Where the page today renders silently instead of saying GONE (`explore` on a vanished device, a stale remove panel), it keeps doing that: it checks before sending, as now.

### 3.3 Undo and Redo

- Permanent Undo and Redo buttons in the side panel's footer, disabled when there is nothing to undo or redo, each described by its step's summary ("Undo: Removed X."). The button keeps the id `undoShrink`, which the checks and `S.focusNext` use.
- Cmd/Ctrl+Z undoes, Shift+Cmd/Ctrl+Z redoes, outside inputs and with no lens open (the same guards as the arrow keys).
- An undo or redo tells you what it did through the notice: "Undid: Removed X.".
- Opening another rack, a new one, a duplicate or a file clears the history (`loadDoc`).
- **DCIM settings and routed lengths are not steps** (D2, §2.1). `dcim` and `lengths.routed` apply without a history record, and an undo or redo restores its snapshot with the **current** `dcim`, or without the key if the current rack has none. That generalizes today's patching of `S.undo` in `putDcim`: Undo never takes the settings back.
- A drag that ends in a move is one step; the drag's previews are not edits.

### 3.4 No-ops

A command that changes nothing returns the rack it was given. `apply` then reports `noop: true` and the editor records nothing, emits nothing, saves nothing. This replaces `commitFrame`'s JSON comparison for the echoed `change` event (the comment there explains why that echo happens) and `putDcim`'s.

### 3.5 Loading

`loadDoc` runs `settleManagers` on every rack; its repairs come back as findings, which the page shows as notes and autosaves without an undo step, as `setDoc` does today. History is cleared.

### 3.6 The probe hook

`window.__rack` (with `?probe=1`) keeps `ready`, `doc`, `flush`, `scene`, `addNotice`, `failExport`, `failCableFacts`, `failSceneFacts` and `cableFacts` as they are.

`replaceRack(next, undoable)` keeps its meaning for the 31 checks that use it: the rack is put in through the editor as one history step (`ed.replaceRack`, probe use only, not part of the editor's documented API), and an `undoable` `{text}` becomes that step's summary and a notice, as today.

It gains `apply(cmds)`, `undo()`, `redo()` and `history()` (`{canUndo, canRedo, undoSummary, redoSummary}`).

## 4. The rack schema

`site/rack/rack.schema.json`, JSON Schema 2020-12, `$id` under the site's schema URLs. It describes what `parseDoc` accepts at version 2 and `serialize` writes:

- `format` (const `portrayal-rack`), `version` (const 2), `id`, `racks` (min 1).
- A rack: `id`, `name`, `frame` (`kind` enum, `heightRU`, `numbering` enum, `holes` with `style` enum and `thread` enum or null, `railDepth`, `usableDepth`, `ref`), `items`, `zeroU`, `cables`, optional `dcim` (`site`, `role`).
- An item: `id`, `ref`, `cfg`, `label`, `ru` (integer >= 1), `face` enum, `turned`, `swaps`, `fields`, and `on`/`unit` together (`dependentRequired` both ways).
- A cable: `id`, `a`, `b` (an end: `item`, `path`, `view` enum), `media`, `purpose`, `label`, `length` (`value` > 0, `unit`, `source`), `lengthAsWritten`, `route` (array).
- Fields `parseDoc` keeps but does not know are allowed (`additionalProperties` is not closed on items, cables, ends or `dcim`).

It uses only keywords in `schema.js`'s `KNOWN`.

It is published with the others: a `rack` entry in `SOURCES` in `site/schema.js` pointing at `site/rack/rack.schema.json`, a tab in `schema.html`, and the document count in `schema.html` bumped. It cannot live in `assets/schemas/`: `refresh-assets.sh` deletes and re-copies that directory from upstream. `check-contract.py`'s vendored-schema check only reads `assets/schemas/` URLs, so it is unaffected; its tab check (one tab per `SOURCES` key) is satisfied by the new tab. In piece 2 the file moves to upstream `spec/schemas/` and arrives in `assets/schemas/` through a sync.

## 5. Testing

### 5.1 Node (`tests/rack/`, run by `node --test tests/*/*.test.mjs`)

- `commands.test.mjs`: each command's success and each of its errors, with the sentences asserted equal to today's; `patch`'s cleared-changes note; `remove` with `keep` and `remove`; `frame`'s shrink finding and its loose-end count; `holes` merging; no-ops returning the same object.
- `apply.test.mjs`: a batch whose third command fails returns the original rack by reference and `index: 2`; `as`/`@name` across `place` and `cable.add`; an unbound or doubly bound name; unknown `op`; argument-schema refusals.
- `history.test.mjs`: undo/redo order, the cap, redo cleared by a new step.
- `queries.test.mjs`: `catalog`'s filters; `describe` for an empty rack, a rack with a hosted manager and cables, and a full 42U rack under the length bound; `freePorts` and `suggestMedia` with stub readers in `ctx`.
- `commands-table.test.mjs`: every argument property in `COMMANDS` has a description within bounds; every command description within bounds.
- `editor.test.mjs`: change events, their causes and their `origin`, including on undo and redo; `preview` changes nothing and emits nothing; `noop` emits nothing; `dcim` is not a step and survives undo and redo; `loadDoc` clears history and returns settle findings.
- `schema.test.mjs`: every rack fixture `parseDoc` accepts, and `serialize(parseDoc(x))`, validates against `rack.schema.json`, with a small validator in the test (no dependency); a document with `on` but no `unit` does not.
- `one-way-in.test.mjs`: a static check that `rack-page.js`, `drag.js` and the other UI modules in `site/rack/` import none of `withItem`, `updateItem`, `withoutItem`, `withFrame`, `renamed`, `withDcim`, `withCable`, `updateCable`, `withoutCable`, `withoutCablesOf`, `moveItem` or `shrinkRack`. `drag.js` may keep `moveItem` for its preview only if it sends the drop as a `move` command; the test names the exception.

### 5.2 Browser (`check-browser.py`)

- The existing rack checks run unchanged.
- New: Undo and Redo across three different edits (place, move, cable add), by button and by keyboard; Undo after a shrinking frame change restores every position; Redo is cleared by a new edit; `__rack.apply` with a failing batch changes nothing and the page shows the error; a DCIM setting survives Undo.

### 5.3 Contract

`check-contract.py` passes with the new `SOURCES` entry and tab.

## 6. How it lands

**After cable-management piece 2.** That branch rewrites much of `rack-page.js` (the routes block in `render()`, route picking and editing, the cable form's draft, `setDoc`). Implementation starts on `main` once its PR has landed, to avoid two branches rewriting the same file.

One branch and one PR, in reviewable commits:

1. `commands.js` (commands, `COMMANDS`, `apply`) and their node tests.
2. `history.js`, `editor.js` and their tests.
3. `queries.js` and its tests.
4. `rack-page.js` (and `drag.js`) onto the editor: `edit()`, the change listener, Undo/Redo UI and keys, the probe hook, the one-way-in test, the browser checks.
5. `rack.schema.json`, its `SOURCES` entry and tab, the schema test.

Then code review, push, the PR, and a message to the "Portrayal-site merge agent".

## 7. Out of scope

Selection in the API, `export(kind)` returning data, `mount()`, the kit move, Annotate, Explorer, a marks schema (pieces 2-4). WebMCP registration, the MCP-B relay and any chat box (site adapters, after the refactor). Persisting history across reloads. `zeroU` commands: `zeroU` is reserved for side-mounted gear (upstream's future `rack-side`), and none is being added. The 0RU work in progress adds rack-face managers, which are items and are covered by `place`, `move`, `attach` and `detach` (confirmed with the "0RU device support and cable management" session, 2026-10-07).
