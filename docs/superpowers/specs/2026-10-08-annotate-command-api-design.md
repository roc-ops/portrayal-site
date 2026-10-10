# Annotate command API

**Date:** 2026-10-08
**Status:** implemented
**Agent API status:** `window.portrayalAnnotate` is stable for agent adapters since #146 (calls are serialised, every load is bounded, and a document is laid on the drawing as built).
**Piece:** 4a of the Rack Builder kit move (see `2026-10-07-rack-command-core-design.md` §1). Piece 4b, the Explorer API, gets its own spec.
**Builds on:** the Rack Builder command core (#132), whose generic `history.js` and `validate.js` this reuses; the rack kit move (roc-ops/Portrayal#896 and its site half), which vendors them to `vendor/rack/`.

---

## 1. Why, and where this sits

Agents with bring-your-own inference are to drive Annotate as they now drive the Rack Builder. The Rack Builder got there through one command layer: named, pure, validated commands, one `apply`, undo step by step, and change events. The site-side adapters (WebMCP, the relay) wrap that layer. Annotate needs the same layer.

Annotate is closer than the Rack Builder was. Its document is already a published shape, `kit/marks.js`'s `{v:1, device, config, view, legend, crop, marks, swaps, fields}`, with pure `normalise`/`encode`/`decode`/`apply`, and the module was written with an MCP client in mind. Three things are missing:

1. **No live way in.** `annotate.html` holds the document in a module-local `let doc`, mutates it in place from a dozen handlers, and reads the URL hash once at boot.
2. **No undo.**
3. **No schema** an agent can read.

Decided 2026-10-08:

| # | Question | Decision |
|---|---|---|
| D1 | How piece 4 is split | **Annotate first (4a), Explorer next (4b)**, as separate specs and PRs. |
| D2 | Where the marks schema goes | **Upstream now**: `spec/schemas/marks.schema.json` in roc-ops/Portrayal, beside the device and component schemas, with an upstream test. The site gets it on the next sync. |
| D3 | How marks are addressed | Every mark **added by a command gets an id** (`m1`, `m2`, …). Marks loaded without one keep none, as `normalise` requires, and are addressed by their exact `select`. |
| D4 | Undo | **Yes**, on every mark, lamp, crop and legend edit, using the rack core's generic `history.js`. |

**Where the code lives.** `annotate.html` and `explorer.html` are site pages; only `kit/marks.js`, `kit/shell.js` and their siblings are upstream. So everything in this spec is site code except the schema (D2). The new modules are pure and kit-ready, as the rack core was before its move.

## 2. Modules

### 2.1 `site/annotate/commands.js` (new, pure)

Pure functions over a normalised marks document, plus a `COMMANDS` table and an `apply` in the shape of `vendor/rack/commands.js`:

- one function per command, `(doc, args) -> {doc, summary, findings, created?} | {error}`;
- a command that changes nothing returns the same document object;
- `apply(doc, cmd | cmd[])` validates arguments against each command's schema (with `vendor/rack/validate.js`), runs a batch all-or-nothing, and supports `as` / `@name` in id positions (`mark`). A name binds to the id the mark was given, so a later command in the same batch that renames the mark (`mark.update` with `id`) leaves `@name` pointing at an id no mark has, and that use is refused as gone. It returns `{doc, summary, findings, created: {[name]: id, ids}, noop, step}` or `{error, index}`;
- every command takes no `rack` argument (this is one document), and every argument property has a description under about 150 characters, for agents.

| Command | Arguments | Effect | Refusals |
|---|---|---|---|
| `mark.add` | `select, color?, state?, label?, lamp?, id?, as?` | Appends a mark. `id` is given, or the next free `m<n>`, past every id in use. `color` defaults to the page's next palette color only when the page sends it; a command never invents ink. | an `id` already in use; an empty `select`; `lamp` not a hex color |
| `mark.update` | `mark, select?, color?, state?, label?, lamp?, id?` | Changes the named fields. `id` names, or renames, the mark. | MARK_GONE ("There is no mark X."); an ambiguous `select` (below); a new `id` in use |
| `mark.remove` | `mark` | Removes it. | as `mark.update` |
| `mark.move` | `mark, to` | Moves the mark to index `to` (0-based), as the row's up and down buttons do. | as `mark.update`; `to` outside the list |
| `marks.clear` | none | Removes every mark. | none |
| `lamp.state` | `path, state` | The tree chip: sets `state` on the mark selecting `[data-path='<path>']`, adding one if there is none. Setting the state it already has clears it. A mark left saying nothing is removed. This is today's `setState`. | none |
| `lamp.color` | `path, hex` (`hex` null clears) | The tree swatch: today's `setLamp` / `clearLamp`, including "a color on a lamp turned off clears the off". | `hex` not a hex color |
| `crop` | `rect` (`{x, y, w, h}` or null) | Sets or clears the crop. The page clamps it to the drawing (`marks.clampCrop`) before sending, as today. | a rect with a non-positive width or height |
| `legend` | `on` (boolean, or a legend object) | Sets `legend`, as `normalise` reads it. | none |

**Addressing (D3).** A `mark` argument is a whole number (the mark's 0-based index, which is how the page's rows address it and what `describe()` lists), or a string: first an id, then an exact `select` of a mark with no id. When two id-less marks share that selector, the command refuses with "Two marks select X; give one an id first (mark.update with id)." `mark.update {mark, id}` is how an agent names an id-less mark.

The sentences above are new except where a command reproduces today's page behaviour (`lamp.state`, `lamp.color`), whose effects match the page's current functions exactly.

### 2.2 `site/annotate/editor.js` (new, pure)

`createMarksEditor({doc})`, shaped like `createRackEditor`:

```js
ed.getDoc()
ed.loadDoc(doc)          -> {findings}   // normalise; clears history; emits cause 'load'
ed.apply(cmds, {origin}) -> apply's result
ed.preview(cmds)
ed.undo(); ed.redo()     -> {summary} | null
ed.retarget(patch)       // the shell's fields, never a step; emits cause 'target'.
                         // A new drawing's re-cut crop (marks.clampCrop) also goes through it.
ed.canUndo / canRedo / undoSummary / redoSummary
ed.on('change', fn)      // {cause, origin, step, commands, summary, findings, before, after}
```

History is `vendor/rack/history.js`.

**Typing is one step.** The row editor sends a `mark.update` on every keystroke. `apply(cmds, {origin, merge})` takes an optional `merge` key (the page passes `<mark index>:<field>`). When the newest step was recorded with the same key and nothing else happened since, the new edit replaces that step: same `before`, new `after`. A burst of typing in one field is then one undo step. The editor does it with `history.js` as it is: it undoes the old step and records the merged one.

**The shell owns the target.** `device`, `config`, `view`, `swaps` and `fields` change only through `retarget`, which the page calls when the shell reports a load, a swap or a field. They are never history steps. An undo or redo restores marks, crop and legend and keeps the current target fields, generalizing the Rack Builder's "Undo never takes the DCIM settings back". Without this, undoing a mark after switching devices would write a `device` the shell is not showing.

### 2.3 The page, `annotate.html`

- **One way in for edits.** Every handler that mutated `doc` in place sends a command through `edit(cmd)`: the row editor, the remove `x`, Clear all, the tree chips, the lamp swatch, the crop drag and Clear crop, the legend box. `edit` calls `ed.apply`. The editor's change listener re-renders. It does not write the hash: the page never has on an edit, only in the share handler and the `?mode=3d` writer. A static test, like the Rack Builder's one-way-in test, fails if the page assigns to `doc.*` or splices `doc.marks`.
- **`loadDoc(doc)` (async)** is today's hash-restore block, lifted into a function: normalise, `ed.loadDoc`, retarget the shell, apply the pending swaps and fields, render. It resolves `{findings}`, which hold today's "N swap(s) do not fit this drawing" as data. Overlapping calls: the newest wins, and an overtaken call resolves `{error: 'Overtaken by a newer document.', replaced: true}`; one whose drawing a newer load replaced resolves `{error: 'Overtaken by a newer drawing: ...', replaced: true}`. `replaced` was added on 2026-10-10 and is additive: `error` is unchanged, and `replaced: true` beside it says nothing failed, something newer was asked for. Calls run one at a time: a newer call waits for the one before it (bounded) before it compares the document with the drawing, since the shell names a new device or configuration before it has loaded it. Every load a call starts is the call's own promise, raced against a 20 s bound; one that does not finish resolves with a `drawing` finding ("... did not finish loading"), drops the document's swaps and fields, and leaves the document naming the drawing last shown. A call that stays on the same device and configuration reloads it anyway when the drawing carries swaps, written parts or turns the configuration did not build, so a document is always laid on the drawing as built and its swaps are the only ones seated.
- **`hashchange`** calls `loadDoc(marks.decode(location.hash))`. The page's own `replaceState` fires no event, so only a pasted link or a navigation reaches it. A hash that decodes to the current document is a no-op.
- **Undo and Redo** buttons sit in the marks panel, shown while there is a step, each described by its step's summary, with Cmd/Ctrl+Z and Shift+Cmd/Ctrl+Z outside inputs. This is the Rack Builder's rule.
- **`window.portrayalAnnotate`** is set synchronously on every load (not only `?embed=1`): `{ready, settled, getDoc, setDoc: loadDoc, apply, preview, undo, redo, history, describe, on}`. `ready` always resolves, to one of three shapes: `{}` once the drawing is up and any document in the link is laid on it; `{error}` when the page could not start or its link could not be restored; `{error, replaced: true}` when a pick or a newer document overtook the link before it had loaded (the same `error` as before 2026-10-10, with `replaced` added beside it). `apply` and the rest are the editor's, with `origin` passed through. The WebMCP and relay adapters for Annotate are separate site work, over this object, and are not part of this spec.
- **`describe()`** is page-level, because it reads the last render's per-mark report. It returns the target (device, config, view); legend and crop; then one line per mark with its id (or index), `select`, `state`, `color`, `label`, `lamp` and **how many elements it matched**, with 0 flagged as "matches nothing". That is how an agent learns its selector missed. It stays under about 1.5K characters by dropping labels first, then the tail, and saying so.

## 3. The marks schema (upstream, D2)

A PR to roc-ops/Portrayal adds `spec/schemas/marks.schema.json` (2020-12, `$id` `https://portrayal.dev/schemas/v1/marks.schema.json`). It describes what `normalise` returns: `v` (const 1), `device`, `config`, `view` (strings); `legend` (boolean or object); `crop` (`{x, y, w, h}` or null); `marks` (each `{id?, select, color, state, label, lamp}`, `lamp` a hex pattern or empty); `swaps` (`{path: ref | null}`); `fields` (`{path: {key: string | null}}`). Unknown keywords stay inside the site schema page's `KNOWN` set.

An upstream test validates `normalise()` of the module's own fixtures and of a document with every field set. The PR follows upstream's process (its tests, its review, British spelling). The site picks the file up on the next `refresh-assets.sh` sync; the site's contract then requires the `SOURCES` entry and the Marks tab, which are added in that sync's PR, not here.

## 4. Edge cases

- **Bad selectors** stay non-fatal, as `marks.js` treats them. `mark.add` accepts any non-empty string, and `describe()` reports what it matched.
- **Edits mid-load.** Mark commands are allowed while the drawing loads. Marks are selectors, so `render()` applies them when the drawing exists.
- **A mark that says nothing.** `lamp.state` and `lamp.color` remove a mark left with no state, color, label or lamp, as today. `mark.update` does not: an agent emptying a mark's fields keeps the mark until `mark.remove`.
- **`legend` objects** are carried through whole, as `normalise` keeps them.

## 5. Testing

- **Node (`tests/annotate/`):**
  - each command's effect and refusals;
  - no-ops returning the same document;
  - the addressing rules: by id, by select, and ambiguous;
  - id assignment past ids in use;
  - `lamp.state`/`lamp.color` matching today's page functions case by case;
  - `apply` atomicity and `@name`;
  - editor history, including undo keeping the target fields after a `retarget`;
  - `COMMANDS` descriptions within bounds;
  - the one-way-in static check.
- **Browser (`check-browser.py`):** the existing Annotate checks unchanged, plus a new check driving `window.portrayalAnnotate`:
  - `setDoc` with a document naming a device, a mark and a swap;
  - `apply` of `mark.add`/`mark.update`/`mark.remove`, then undo and redo;
  - a pasted hash (`location.hash = …`) restoring a document;
  - `describe()` flagging a selector that matches nothing.
  - #146: back-to-back `setDoc` on one device landing on the second call's drawing, a device load and a configuration load that never finish answering with a finding, and a `setDoc` naming no swaps clearing the seated ones.
- **Upstream:** the schema test (§3).

## 6. How it lands

1. **Upstream PR:** `spec/schemas/marks.schema.json` and its test. Independent; it can open now.
2. **Site PR:** `site/annotate/{commands,editor}.js`, the page rewire, and the tests. It imports `vendor/rack/history.js` and `vendor/rack/validate.js`, so it **starts after the rack kit move's site half lands**.
3. **The next sync** brings the schema and its Marks tab.

A follow-up upstream PR may move `history.js` and `validate.js` out of `kit/rack/` to a general place, with `kit/rack/` re-exporting them (agreed 2026-10-08). It is not needed for this spec.

## 7. Out of scope

- Explorer's API (piece 4b).
- The WebMCP and relay adapters for Annotate (separate site work).
- Persisting undo across reloads.
- A `selector` builder for agents beyond `lamp.state`/`lamp.color`'s path form.
