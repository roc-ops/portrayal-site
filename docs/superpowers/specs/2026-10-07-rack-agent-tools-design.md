# Rack Builder agent tools

**Date:** 2026-10-07
**Status:** design approved in conversation; spec awaiting review
**Builds on:** the Refactor agent's `2026-10-07-rack-command-core-design.md` (piece 1: `commands.js`, `editor.js`, `queries.js`, `rack.schema.json`), which must be merged first
**Research:** the "Agent integration research" session, 2026-10-07 (memory: `agent-driven-tools`)

---

## 1. Why, and where this sits

Jason wants AI agents to drive the site's tools: build a rack, cable it, export it. Inference is **bring your own**: portrayal.dev hosts no model and pays for no tokens. Piece 1 of the move to the kit made every Rack Builder edit a named command, checked, applied whole or not at all, undoable and announced. This spec is the thin layer that hands those commands to agents.

Order of the wider work, as decided in conversation:

| Step | What | State |
|---|---|---|
| Piece 1 | The rack command core | Refactor agent; must merge before this starts |
| **This spec** | Rack Builder agent tools: WebMCP registration, the MCP-B relay behind a switch, agent edits shown | site only |
| Later | Read-only site-wide tools on every page (search devices, open a tool), which pass isitagentready.com's WebMCP check | site only, reuses §4.2 |
| Later | Annotate and Explorer tools, after their piece 4 hooks | site only, reuses §4.2 |
| Later | An in-page chat box with the user's own key (OpenRouter Connect first) | site only, reuses §3's tools |

Decided in conversation (2026-10-07):

| # | Question | Decision |
|---|---|---|
| D1 | Audience first | **Desktop AI users** (Claude Desktop, Claude Code, Cursor) through the MCP-B relay, plus WebMCP for browsers that have it. The chat box comes later, for discovery. |
| D2 | Tool shape | **Few, coarse tools**: read tools plus one `edit_rack` that takes a batch of commands, the shape draw.io and Excalidraw use. Not one tool per command. |
| D3 | The relay | **Behind a "Connect your desktop AI" switch**, off by default, because it opens a socket to the visitor's machine and raises Chrome's Local Network Access prompt. |
| D4 | WebMCP origin trial | **Join it** (Chrome 149-156): Jason registers portrayal.dev; the token is a `<meta>` tag. |
| D5 | Agent edits on the page | **Shown**: a notice that names the assistant, and a short highlight of what it touched. |
| D6 | Where the code lives | **The site, permanently.** The tools are portrayal.dev's choice of how agents reach the builder, not part of the drawing library. When piece 2 moves the core to `vendor/rack/`, only import paths change here. |

## 2. Facts this rests on (checked 2026-10-07)

- **WebMCP** is a W3C Community Group draft. The API is `document.modelContext.registerTool(tool, {signal})`. The older `navigator.modelContext` is deprecated in Chromium 150 but still served during the trial, and isitagentready's checker reads both. A tool is `{name, title?, description, inputSchema, execute, annotations?}`, with the annotations `readOnlyHint`, `untrustedContentHint` and `consequentialHint`. Aborting the signal unregisters the tool.
- **Chrome's guidance** (developer.chrome.com/docs/ai/webmcp): tool descriptions of about 500 characters or less, parameter descriptions of about 150 or less, **tool output of about 1.5K characters or less**, action verbs in names, words rather than codes in enums, strict checking in code and loose checking in the schema, and the visible page updated after a tool runs.
- **MCP-B local relay** (docs.mcp-b.ai):
  - The page loads `@mcp-b/global` (a WebMCP runtime where the browser has none) and the relay's `embed.js`.
  - `embed.js` injects a hidden iframe that picks up tools registered on `document.modelContext`, including ones registered later, and forwards them over a WebSocket to `127.0.0.1:9333`.
  - The user runs `npx @mcp-b/webmcp-local-relay` as a stdio MCP server in their desktop client. `--widget-origin` restricts which origins may connect, and `data-relay-port` on the script changes the port.
  - Tools keep their names; two tabs with the same tool get a suffix.
- **Piece 1, as built** (Refactor agent's notes, 2026-10-07):
  - `ed.apply(cmds, {origin})` and `ed.preview(cmds)`.
  - Change events carry `origin`, and undo or redo carries the origin of the step it undoes.
  - Commands marked `system: true` (`lengths.routed`) are refused unless `origin === 'system'`.
  - `@name` resolves only in `id` and a cable end's `item`.
  - `freePorts` entries are `{path, view, label, speed, media}`.
  - **`cable.update` refuses three values that are valid to store but not to send**: a media outside `MEDIA`, a length unit other than m or ft, and a routed length's `measured`. An agent that echoes a cable back unchanged can be refused.

## 3. The tools

Eight tools, `snake_case`, one job each. Every result is plain text of 1.5K characters or less. Errors are the command core's own sentences.

| Tool | Arguments | Does | Annotations |
|---|---|---|---|
| `describe_rack` | none | `describe(rack)`, then the loose ends (`looseEnds`, as `c3: the i4 end does not land: <reason>`), then one line on history: "Undo would take back: Placed X at U12." or "Nothing to undo." | `readOnlyHint`, `untrustedContentHint` |
| `find_devices` | `text?`, `ru?`, `family?`, `mount?` | `catalog(devices, filter)`: one line per device, `ref | manufacturer model | nRU | configs: a, b (default a)`. At most 20, then "and n more: narrow the search." | `readOnlyHint` |
| `check_fit` | `ref`, `face`, `ru?` | With `ru`: `fitsAt`, "Fits." or the reason. Without: `freeUs`, as ranges ("U1-U8, U14, U20-U42"). | `readOnlyHint` |
| `list_free_ports` | `item` | `freePorts`: one line per port, `path (view): label, speed, media`, grouped by view. Over the bound, the remaining ports collapse to a count per view. | `readOnlyHint`, `untrustedContentHint` |
| `edit_rack` | `commands` (1-50), `dry_run?` | `ed.apply(commands, {origin: 'agent'})`, or `ed.preview(commands)` when `dry_run`. On success: the summary, the findings as notes, the ids of what was created (`as` names first), and "Undo takes all of this back in one step." On a dry run, the same summary prefixed "Would:", with nothing changed. On refusal: "Command n (op) was refused: <reason>. Nothing was changed." | none |
| `undo` | none | `ed.undo()`: "Undid: <summary>." or "Nothing to undo." | none |
| `redo` | none | `ed.redo()`: "Redid: <summary>." or "Nothing to redo." | none |
| `export_rack` | `kind` | Runs the page's own export (`runExport(kind)`), so the file arrives through the browser's normal download. It returns the file name and the export's notes, never the file's contents. | none |

### 3.1 `edit_rack`'s schema

`commands` is an array of `{op, ...args}`. Its `items` schema is **generated from `COMMANDS`** when the page loads:

- one `oneOf` branch per command;
- each branch has `op` as a `const`, then the command's own `args` properties and `required`;
- commands with `system: true` are left out, and so is `dcim` (§7 D).

`as` is allowed on `place` and `cable.add`. A command added to `COMMANDS` later becomes callable without touching this file.

The description, which must stay within the 500-character bound, says:
- that the batch is applied whole or not at all, and is one undo step;
- that `as: "srv"` names what a command creates, and `"@srv"` refers to it later in the batch, in `id` and a cable end's `item` only;
- to call `find_devices` for `ref` and `cfg`, and `list_free_ports` for port paths;
- **to send only the fields being changed**, which avoids the echo refusals in §2;
- that `dry_run` checks without changing anything.

`additionalProperties` stays as `COMMANDS` declares it. Validation is strict in code: `apply` already checks every argument against the same schemas and refuses with a sentence. The generated schema is a guide for the agent, not a second gate.

### 3.2 `export_rack`'s kinds

The enum uses words, mapped to the page's export keys:

| `kind` | Page key |
|---|---|
| `sheet svg` | `sheet-svg` |
| `front svg` | `front-svg` |
| `rear svg` | `rear-svg` |
| `sheet png` | `sheet-png` |
| `drawio` | `drawio` |
| `netbox import` | `netbox-import` |
| `nautobot import` | `nautobot-import` |
| `bill of materials` | `bom` |
| `cable schedule` | `cables` |
| `rack file` | `json` |

The 3D model exports (`glb`, `usdz`) and the settings actions (`to-3d`, `dcim-settings`) are not offered.

`runExport` today reports through the export menu's status line and returns nothing. It gains a return value, `{name, notes} | {error}`, which the menu ignores and the tool reads. The NetBox and Nautobot kits need the DCIM settings: when they are missing, the export's own sentence comes back, and the agent tells the user to fill in the settings form (D, §7).

### 3.3 What the tools never do

They never return a document, an SVG or a file body; never read or write `localStorage`; never touch the rack library (open, new, duplicate, delete); never send `lengths.routed` or `dcim` (`edit_rack` refuses a batch holding either, by index, before calling `apply`). Every edit goes through `ed.apply` with `origin: 'agent'`.

## 4. Modules

### 4.1 `site/rack/agent-tools.js`

```js
export function rackTools({ed, devices, chassisOf, queries, runExport}) -> Tool[]
```

- **Pure apart from what it is handed.** No DOM, no `fetch`, no `window`. `queries` is `{describe, catalog, fitsAt, freeUs, freePorts, looseEnds}`, already bound to the page's readers (the probe hook binds them the same way today), and `runExport(kind)` is the page's.
- **Returns plain tool objects**, `{name, title, description, inputSchema, annotations, execute}`, where `execute(args)` resolves to `{content: [{type: 'text', text}], isError?}`.
- **Owns** the result formatting and its 1.5K-character bound (`fit(text)` cuts at the last whole line and says how many lines were left out), the `COMMANDS` to `oneOf` generation (§3.1), and the export-kind map (§3.2).
- **Throws nothing to the caller.** An exception inside a tool comes back as `isError` with "That didn't work: <message>." and is logged.

### 4.2 `site/agent/webmcp.js`, shared by every page that offers tools

```js
export const modelContext = () => document.modelContext ?? navigator.modelContext ?? null;
export function registerTools(tools, {signal}) -> Promise<{registered: number, error?}>
```

- It registers each tool with the signal. When there is no model context, it resolves `{registered: 0}`.
- One tool that fails to register is logged and skipped; the others still register.
- A later page (the homepage, Annotate) calls the same function with its own tools.

### 4.3 `site/agent/relay.js`, the switch

```js
export function relaySwitch({mount, tools, examples}) -> {dispose}
```

- **Renders** the control and its panel into `mount`.
- **Turning it on:**
  1. If `modelContext()` is null, it loads the vendored `@mcp-b/global` (§4.4).
  2. It loads the vendored `embed.js`, with `data-relay-port` left at the default.
  3. It calls `registerTools(tools, {signal})`, unless the page's load-time registration (§4.5) already registered them in this context.
- **Turning it off** removes the relay's iframe and aborts the signal it registered with. If it loaded `@mcp-b/global`, that runtime stays until reload, which is harmless with no tools in it, and the panel says so.
- **Remembers** the choice in `localStorage` (`portrayal.agent.relay`), wrapped in try/catch, so turning it on is once per browser.
- **The panel shows:**
  - The relay command, pinned to the vendored version, with Copy:
    `npx -y @mcp-b/webmcp-local-relay@<ver> --widget-origin https://portrayal.dev`
  - A Claude Desktop / Claude Code config snippet with the same command, with Copy.
  - A status line: "Waiting for your desktop AI..." until the relay reports a connection, then "Connected." This line is shown only if the spike (§6, task 1) finds a status signal. Otherwise it is left out, not guessed.
  - Three example prompts, with Copy. They come from the page:
    - "Build a 42U rack with two leaf switches at the top, a 24-port patch panel between them, and cable every switch uplink to the panel."
    - "What in this rack has loose cable ends, and why?"
    - "Export this rack for NetBox."
  - One line on privacy: "Your AI runs on your computer and talks to this page directly. portrayal.dev sees nothing of it."

### 4.4 Vendored MCP-B files: `vendor/mcp-b/`

`@mcp-b/global` and `@mcp-b/webmcp-local-relay`'s browser build are copied at a pinned version, beside `vendor/three/`, with their licenses and a `VERSION` file. They are loaded only by `relay.js`, and never on page load. Self-hosting keeps a third-party CDN out of a page that may later hold users' API keys (the chat-box step). If the spike finds that the relay's iframe cannot be self-hosted, the fallback is the same pinned files from jsDelivr with Subresource Integrity, recorded in the plan.

### 4.5 `rack-page.js`

At boot, after the editor exists:

```js
const tools = rackTools({ed, devices: S.devices, chassisOf, queries: boundQueries, runExport});
registerTools(tools, {signal: agentAbort.signal});  // native WebMCP, when the browser has it
relaySwitch({mount: $('agentSlot'), tools, examples: EXAMPLES});
```

- **`boundQueries`** binds the queries to the page's readers: `facePorts` through `configuredFace` for `freePorts`, and `cableFacts` for `looseEnds`. The probe hook builds the same binding today; both now share one helper.
- **The origin trial:** `rack.html` gains `<meta http-equiv="origin-trial" content="<token>">`. The token is Jason's to create (§7).
- **The switch's place** is the toolbar, beside the Export menu, as a small "Connect your AI" button that opens the panel as a popover. Final placement is settled in implementation against the page's layout, and must not crowd the toolbar at 375px.

## 5. Agent edits on the page (D5)

The change listener (`onChange`) already turns findings into notices. For `ev.origin === 'agent'`:

- **The notice** is the step's summary prefixed "Your assistant: ", as a `note`, for example "Your assistant: Placed Nexus 93180YC-EX at U12. Added cable c3." Findings follow as today.
- **The highlight:**
  - The items and cables the step touched get a brass outline (`--accent`) in the 2D elevation for about 3 seconds, then fade.
  - Touched means the `id` of every command plus every id in `created`. A cable end's `item` is not counted.
  - The highlight is a class on the drawn elements, so it is never written to the document or the export.
  - In 3D, the touched items are outlined with the scene's existing selection treatment if it has one. If it doesn't, 3D shows only the notice. A new 3D effect is not built for this.
- **Undo and redo** of an agent step say "Undid: <summary>" as for any step. The prefix is only for the edit itself.
- **A dry run** changes nothing and shows nothing.
- **Preference:** someone who wants the page quiet while an agent works can turn the highlight off in the switch's panel. The setting is remembered like the switch.

## 6. Testing

### 6.1 Spike first (plan task 1, throwaway)

Before any tool code, on a local server and then on a preview deploy:

- Does a self-hosted `embed.js`/iframe work?
- Which origin does `--widget-origin` see: the page's, or the iframe's?
- What does Chrome's Local Network Access prompt look like from portrayal.dev, and once it is denied?
- Is there a connection signal for the status line?
- Does `@mcp-b/global` step aside when the browser has native `document.modelContext`?

The answers are written into the plan before task 2.

### 6.2 Node (`tests/rack/agent-tools.test.mjs`)

Tools are built over a real editor and fixture racks, with stub page readers:

- **Schema:** every tool's `inputSchema` validates as JSON Schema; `edit_rack`'s `oneOf` has one branch per non-system command and none for `lengths.routed`; a command added to a stub `COMMANDS` appears without other changes.
- **Bounds:**
  - descriptions are 500 characters or less, and parameter descriptions 150 or less;
  - every result is 1.5K characters or less, for an empty rack, a full 42U rack with 40 cables, and a `find_devices` with no filter.
- **`edit_rack`:**
  - a success records one undo step with `origin: 'agent'`;
  - a refusal names the command's index and op and leaves the rack untouched by reference;
  - `dry_run` leaves the rack and history untouched and emits nothing;
  - `@name` across `place` and `cable.add`;
  - `lengths.routed` is refused.
- **`export_rack`:** maps every kind, refuses an unknown kind with the list of kinds, and returns the notes, not the data.
- **`undo` and `redo`:** with and without anything to take back.
- **No throws:** a throwing stub reader comes back as `isError`.

### 6.3 Browser (`check-browser.py`)

A stand-in `document.modelContext`, injected with `add_init_script` before load, records `registerTool` calls.

- **Load:** the eight tools register on `rack.html` with no switch touched; nothing is fetched from `vendor/mcp-b/`.
- **The tools in the page:**
  - `edit_rack` places a device and adds a cable, and the elevation redraws;
  - the notice starts "Your assistant: ", and the touched items carry the highlight class, which is gone after its time;
  - Undo by button takes the step back and says "Undid: ...";
  - `export_rack('netbox import')` with settings saved triggers a download whose name the tool returned;
  - `describe_rack` reflects the edit.
- **Without native WebMCP:** with no stand-in, turning the switch on loads `vendor/mcp-b/` (the requests are seen), and turning it off removes the relay iframe. A reload remembers the switch.
- **Width:** at 375px the toolbar does not overflow with the button present.

### 6.4 By hand, before the PR

Claude Code is connected through the relay to a local server, then to the preview deploy. It must complete this prompt end to end, with the transcript and the exported zip kept in the PR description:

> "Build a 42U rack with two leaf switches at the top, a 24-port patch panel between them, cable every switch uplink to the panel, then export it for NetBox."

## 7. Needs from Jason

- **A.** Register portrayal.dev for the WebMCP origin trial at developer.chrome.com/origintrials, and give the token. Without it the build still ships: the relay path works, and native WebMCP works for anyone with the flag on.
- **B.** Approve the copy: the switch label, the privacy line, the "Your assistant:" prefix and the three example prompts.
- **C.** After the PR, the by-hand run on the live site with your own desktop client.
- **D.** Not now: whether agents should get the DCIM settings form as a command (`dcim` exists in `COMMANDS`). This spec leaves it out of `edit_rack`'s schema (§3.1) and refuses it in `execute`, so the user stays in charge of what goes into an import.

## 8. Out of scope

- The site-wide read-only tools and the isitagentready.com check: the homepage is what that check loads, and those tools are their own small spec.
- Annotate and Explorer tools (after piece 4).
- The chat box with the user's own key, WebLLM, and Chrome's Prompt API.
- Rack library tools (open, new, duplicate, delete), the 3D model exports, and selection or viewport tools.
- `llms.txt` and Agent Skills discovery files.
- Any MCP server card or `/.well-known` service metadata: there is no server (memory: `agent-readiness-scan`).
