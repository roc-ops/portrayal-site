# Rack Builder agent tools, round 2

**Date:** 2026-10-08
**Status:** design approved in conversation; spec awaiting review
**Builds on:**
- `2026-10-07-rack-agent-tools-design.md`: round 1, merged as #134.
- The kit move: roc-ops/Portrayal#896, kit 0.3.0, `kit/rack/`.
- The kit companion spec: roc-ops/Portrayal `docs/rack-agent-commands-design.md`, on branch `claude/rack-agent-commands`. It adds `inspect`, `selectCables`, `fit`, `field`, re-pointing in `cable.update`, `loadSlots`, the per-call editor context, `describe` windows and `catalog` by kind.

**Order:**
1. #896 merges.
2. The site re-vendors `kit/rack/` (the ZeroRU session's follow-up).
3. The kit companion lands.
4. The site re-vendors again.
5. This spec is built.

Work can start against the companion's intended shape and be checked when it merges.

---

## 1. Why

Jason ran the round-1 tools twice on 2026-10-08:
- once through Claude in Chrome clicking the page;
- once through Claude in Chrome calling the tools with `document.modelContext.executeTool(tool, args)`.

Both runs got a rack built, but each "let me open the Explorer" or "let me look at the code" marked a missing tool. An audit of every Rack Builder action against the tools found the same gaps and a few more:

| Gap | Seen as |
|---|---|
| No way to read a device or cable | Optics, cassettes, latch color and cable length were all guessed or done by clicking |
| Swaps and fields were unchecked and replaced whole | A made-up part passed a dry run; latch color was skipped because no tool named the keys |
| No re-pointing, no selectors | 16 cables deleted and rebuilt after one cassette swap |
| No way to start a rack | The agent cleared an old rack to begin |
| Listings cut short with no paging | A 56-port switch's uplinks never appeared; a full rack drops its last cables |
| `find_devices` searches names only | "patch panel", the example in its own description, finds nothing |
| Misleading text | `item` vs `id`, a claimed default that isn't applied, `{value, unit}` unstated, internal function names, "only the first rack" |

The rule from round 1 stands: a few coarse tools. This round adds two tools (eight to ten) and changes four.

## 2. Decisions

| # | Question | Decision |
|---|---|---|
| D1 | Where the logic lives | **In the kit** (the companion spec). The site binds readers, expands selectors and formats text. |
| D2 | Fitting optics and modules | **Through the kit's new `fit` and `field` commands** in `edit_rack`, checked against the loaded parts lists. No separate `fit_optics` tool: a batch of `fit` commands is one undo step. Named types (`{type: 'LR4'}`) come with #897. |
| D3 | Starting a rack | **A `new_rack` tool.** The library is the site's, so the kit has no part in it. The open rack is saved first, as the library's New does. |
| D4 | Selectors | **In `edit_rack`:** `cable.remove` and `cable.update` accept `{select: {...}}` in place of `id`. They are expanded to one command per id before `apply`, and the expanded ids are echoed in the result. |
| D5 | The parts lists | **Loaded per call** with the kit's `loadSlots(dist, refs)`, for every ref in the rack and in the batch, then passed as `ctx` to `ed.apply` and `ed.preview`. Kept warm between calls, and memoized by the kit. |
| D6 | Claude in Chrome | **A hint in the page,** so a browser agent that reads the DOM learns the tools exist and how to call them. This is a `<script type="application/json" id="webmcp-hint">` plus a visually hidden paragraph in `rack.html`. Claude in Chrome doesn't support WebMCP natively; `executeTool` from its JavaScript tool works (§6). |

## 3. Tools

| Tool | Change | Notes |
|---|---|---|
| `inspect` | **new** `{id}` or `{ref}` | Formats the kit's `inspect` within 1,500 characters. Sections: device (ref, model, configs with descriptions, U, face, turned, managers), bays and cages (runs of ports with the same accepts are grouped, `port-49..56 (qsfp28): holds generic/qsfp-lc@2; takes 7: …`), fields (`port-49-occupant: latch-color = #c2b280 (color)`), cables. For a cable: ends, media, purpose, label, length, routed length and stock size, route and valid waypoints, loose and mismatch. Over the bound, `{id, section: 'bays'|'cages'|'fields'|'cables', offset}` pages it, and the first line says so. `{ref}` describes a catalog device with nothing placed. Annotations: read-only, untrusted content. |
| `new_rack` | **new** `{name?, height?, kind?}` | Saves the open rack, then opens a new one through the library's own New path, then applies `rename` / `frame` if given. Returns the new rack's id and name, plus "Undo can't take this back; the old rack is in the library." Annotations: not read-only. |
| `edit_rack` | changed | Selectors (D4). Parts lists loaded (D5). The kit's findings returned (orphaned cables, mismatches, new loose ends). Description rewritten (§5). |
| `describe_rack` | changed | `{section?, offset?, limit?}` through the kit's `describe` window. The first line names the open rack, its id and the totals. Adds DCIM site and role, read-only: "blank; the user sets them under Export > DCIM import settings". |
| `list_free_ports` | changed | `{id, view?, offset?}` (argument renamed from `item` to `id`; `item` is still accepted). Ports are grouped into runs (`port-1..48: 25G sfp28 cage, empty`). Empty cages are marked. The total is in the first line. |
| `find_devices` | changed | `{text?, kind?, ru?, family?, mount?, offset?}`, with the kit's search by kind. The header (`n matches, showing a-b`) comes first, so a cut never loses it. |
| `check_fit`, `undo`, `redo`, `export_rack` | wording only | `export_rack` names blank DCIM settings before a kit export. `undo` says when the step it takes back was the user's own: "Undid your edit: …" (history records `origin`). |

## 4. The `edit_rack` pre-pass

1. **Expand selectors.** For each command with `select`, call the kit's `selectCables(rack, select, ctx)` and replace the command with one per id. An empty selection is a refusal for that command: "No cable matches {item: i3, path: port-9}. Nothing was changed." `{loose: true}` needs `cableFacts` and is async.
2. **Collect refs** from the rack's items and from `place` commands in the batch, then `await loadSlots(dist, refs)`.
3. **Call** `ed.apply(cmds, {origin: 'agent', ctx: {slotsOf, compByRef, cableFacts?, route?}})`, or `ed.preview` for a dry run.
4. **Build the result** in the round-1 order (bindings, Created, undo line, summary, notes). Notes now carry the kit's findings. Expanded selectors add a line: `Removed: c3, c4, c9.`

A load failure for one ref leaves its commands refused by the kit with a sentence. The rest of the batch still applies or refuses as a whole.

## 5. Wording pass

- **Descriptions.** Every tool description and argument description is checked by a Node test:
  - it names only real tools and arguments;
  - it states each default the code applies, and none it doesn't;
  - it gives the shape of any object argument, e.g. "length: {value, unit} with unit m or ft".
- **Argument names.** One name per concept across tools: `id` for an item or cable, `ref` for a catalog device.
- **The open rack.** "Only the first rack can be edited today" becomes "Edits go to the rack that is open; describe_rack names it."
- **Kit sentences.** Any kit sentence the agent sees that names a site page is tracked to #895, which the companion fixes.

## 6. The page hint for browser agents

In `rack.html`, a JSON block a DOM-reading agent can find:

```json
{"webmcp": true, "howTo": "Call these tools from page script: const mc = document.modelContext ?? navigator.modelContext; const t = (await mc.getTools()).find(t => t.name === 'describe_rack'); await mc.executeTool(t, {}). Results are {content: [{type: 'text', text}]}.", "tools": ["describe_rack", "inspect", "..."]}
```

There is also a one-line visually hidden paragraph saying the same. The tool list is written by the page at boot from the registered tools, so it can't drift.

## 7. Testing

- **Node (`tests/rack/agent-tools.test.mjs`):**
  - `inspect` formatting and paging (bound held on a 56-port switch and a 20-device rack).
  - `edit_rack` selector expansion, including an empty selection and `loose`.
  - The `fit` / `field` refusals passed through.
  - The findings in the result.
  - The `describe_rack` window and its first line.
  - `list_free_ports` runs and empty-cage marks.
  - `find_devices` by kind ("patch panel").
  - The description test (§5).
- **Browser (`check-browser.py`, stand-in `document.modelContext`):**
  - `new_rack` (the old rack is in the library, the new one is open);
  - fit an optic, then set its latch color, and the drawing shows the color;
  - swap a cassette, then the orphaned-cable finding, then re-point with `cable.update {a}`;
  - remove the cables on a device by selector;
  - the page hint lists the registered tools.
- **End to end:** Jason's two prompts again, through Claude in Chrome with `executeTool`, including the latch-color and 0.5 m questions. Done means no "open the Explorer" and no "look at the code".

## 8. Out of scope

- Named cable and optic types: roc-ops/Portrayal#897 and its site follow-up.
- An optics control in the Rack Builder's device panel, for people and for click-driven agents.
- Opening or deleting other racks from the library.
- Selection, zoom and 2D/3D tools.
- The DCIM settings stay the user's to set.
