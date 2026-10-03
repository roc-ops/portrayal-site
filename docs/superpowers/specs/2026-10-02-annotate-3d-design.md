# Annotate in 3D

Date: 2026-10-02. Status: approved in conversation, pending written-spec review.
Issue: #46. Kit prerequisite: roc-ops/Portrayal#664, merged in roc-ops/Portrayal#667 and already vendored.

## 1. Why

Annotate is 2D only. A reader sets a device up there (optics seated, lamps lit, parts highlighted in colours, labels written) and can see the result only as a flat face. Explorer has a 2D/3D toggle, and the kit's 3D viewer now carries everything Annotate's document needs:
- coloured marks on many parts at once (`setMarks`);
- lamp colours a host chooses (`setLampColors`);
- lamp states (`setStates`), swaps (`load({overrides})`) and fields (`setFields`).

**What it is for, as decided: seeing it on screen.** A reader views the device they annotated in 3D, to check it or to show it on a call. The files a reader takes away stay what they are:
- **2D files** (SVG, PNG, GIF, draw.io, OmniGraffle) carry the marks.
- **3D files** (GLB, USDZ) are the plain model, without highlight plates.

**Success looks like this:**
- Switching to 3D shows the same document: every mark in its colour, every lamp lit as set, every optic seated, every label in a legend.
- Editing in 3D works as in 2D: click a part, add a mark, set a state.
- Explorer behaves exactly as it does today.

## 2. Approach

Approach A, as chosen: **a shared site module**. Explorer's generic 3D wiring moves out of `explorer.html` into `site/mode3d.js`. Explorer and Annotate both use it, and each page adds what is its own.

Rejected:
- **(B) Copy the wiring into Annotate.** Explorer's 3D code carries hard-won ordering fixes, recorded in its comments: states before the early return, pulled covers before the load, the swap key in the load key. Every one would have to be made twice, and the two pages would drift.
- **(C) A 3D mode in the kit's shell.** This is the right home if other embedders want a toggle. But it means designing a shell API before a second page has proved the shape. Revisit once `site/mode3d.js` has two callers.

## 3. The work, as three PRs

| # | Repository | What | Depends on |
|---|---|---|---|
| 1 | Portrayal (kit) | The GLB/USDZ export hides the mark plates, as it already hides the selection halo | nothing |
| 2 | portrayal-site | Extract `site/mode3d.js` from `explorer.html`, with no behaviour change | nothing |
| 3 | portrayal-site | Annotate gets 3D, built on `mode3d.js` | 2, and a site sync that carries 1 |

PRs 1 and 2 run in parallel. The 3D export in PR 3 relies on PR 1 having reached `vendor/`.

### 3.1 Kit: exports leave the marks out

`exportData()` in `kit/viewer3d.js` hides the selection halo for the duration of an export: "a selection marker is not part of the model". The mark halos (`markObjs`) are not hidden. So a GLB taken while marks are held carries the plates as plain geometry, with no depth test.

**Change:** hide every mark object in the same `try` / `finally` as the selection halo, and restore them afterwards.

**Test:** a scene with two marks. The exported GLB contains no mark meshes, and `marks()` and the on-screen halos are unchanged after the export.

**CHANGELOG:** under Changed. A host that wanted plates in its GLB loses them; no site page relies on that.

### 3.2 Site: `site/mode3d.js`

`site/mode3d.js` holds what `explorer.html` does for 3D today that is not specific to Explorer:
- the 2D/3D buttons;
- the capability gate: the 3D button is disabled below portrayal level 3, with the build's reason on hover;
- loading `vendor/viewer3d.js` and three.js lazily on the first press;
- `setMode`, which hides the stage it isn't using, merges the tree in 3D, and hides the view picker;
- `sync3d` with its ordering: states, then pulled covers, then the early return on an unchanged load key, then load with overrides, then reselect;
- the background colour following the shell's stage;
- fields;
- shared selection: a click in 3D selects through the shell, and a click on nothing clears;
- the FRU bar;
- the GLB/USDZ download bar.

**Interface:** `createMode3d(shell, {host, extras})` returns:
- `mode()`, the current mode;
- `setMode(m)`;
- `sync()`, which re-sends the page's state;
- `viewer()`, which resolves the viewer or null;
- `on('mode', fn)`.

`extras(viewer)` is where a page mounts its own chrome. Explorer keeps:
- the hover readout;
- the graphics diagnostics overlay.

The `?debug=1` handle, which puts the viewer on `window.__viewer`, moves into the module. A browser check reaches the scene through it, and Annotate's check needs it as much as Explorer's.

**Data hooks:** a page supplies `states()`, `pulled()` and `overrides()`. Explorer's are today's `liveStates`, `livePulled` and `swapOverrides`. The module calls them at the same points `sync3d` does now. A page can also supply `afterSync(viewer)`, which Annotate uses to send marks and lamp colours.

**No behaviour change.** Explorer's existing 3D browser checks pass unchanged.

### 3.3 Site: Annotate in 3D

#### The document reaches the scene

A pure function `docToScene(doc, faces)` lives in its own file, `site/annotate3d.js`, so it can be tested without a page. `faces` is `{view: svgRoot}`, the shell's held faces (`state.faces`, all of a configuration's views once `loadFaces()` has run).

For each mark, it resolves `mark.select` with `marks.match()` on every face, keeps the outermost matches, and reads their `data-path`. It returns:
- `marks`: `[{path, color}]`, from each mark's `color`;
- `lamps`: `{path: hex}`, from each mark's `lamp`;
- `states`: `{path: 'state-<name>'}`, from each mark's `state`. It replaces any state the element already has, as `marks.apply` does in 2D, which removes the element's `state-*` classes before adding the mark's;
- `missing`: the indexes of marks that matched nothing on any face.

Colours are validated with the same hex rule as `marks.js`; an invalid one is dropped, not passed on.

Annotate passes `states()` from `docToScene` to `mode3d`, and its `afterSync` sends `setMarks(marks)` and `setLampColors(lamps)`. Swaps and fields travel as they do in Explorer.

**On every document change while in 3D** (Annotate's existing `render()` path), the page calls `sync()`. The viewer coalesces calls and keeps marks across rebuilds, so the page always sends the whole picture.

#### Editing

Clicking a part in 3D selects it in the tree through the shell, so these all work as in 2D:
- **+ selection**;
- the state chips;
- the lamp colour picker.

Rule buttons and typed selectors add marks as before. Their 2D match counts stay as they are.

A mark row shows **not in 3D** when either is true:
- `docToScene` reports it missing;
- the viewer's `marks` report lists one of its paths in `missing`.

#### Legend

In 3D, an HTML panel beside the stage lists each mark's colour swatch and label: the same entries, in the same order, as the 2D legend strip. The legend checkbox shows or hides it.

Two points settled after the first release (#95):
- **The swatch** is the ring colour, else the lamp colour, else the colour the mark's state paints, read off the mounted drawing as `marks.js` reads it: the matched lamp's computed `--led-color`, then a probe carrying the state's class. The page supplies that as `colorOf(mark)` to `legendItems`, which holds the result to the hex rule.
- **Membership differs from the 2D strip in one case, on purpose.** A row needs the mark to have reached a part the scene can place: a `data-path`, on any face. The 2D strip lists a mark that matched anything in the drawing. A legend is a key to what is beside it, so a mark the scene cannot show gets no row in 3D; its mark row says "not in 3D".

#### Exports in 3D

- **GLB and USDZ appear,** through `mode3d`'s bar. With PR 1 synced, they are the plain model.
- **SVG, open, PNG, GIF, draw.io, OmniGraffle, crop and the crop clear** stay in the bar but are disabled, with the title "2D only: switch to 2D to export the drawing".
- **Share URL** stays enabled.

#### What 3D leaves alone

- **The crop** stays in the document and applies again in 2D. In 3D the framing is the camera.
- **Blink rings** are a 2D device for a still picture. In 3D the lamps really blink.

#### The share link records the mode

The share URL carries `?mode=3d` beside the `#…` document, and a page opened with it starts in 3D. The marks document schema (`marks.js` v1) does not change.

#### Failure

- **A device below level 3:** the 3D button is disabled, with the reason.
- **The viewer fails to load:** a message in the 3D stage and the mode back to 2D. The failed load is not cached, so a retry works, as in Explorer's `ensureViewer`.

## 4. Testing

**PR 1, kit:** the export test in 3.1, plus the kit's existing viewer tests.

**PR 2, extraction:**
- Explorer's existing 3D checks pass unchanged: the 3D view, swap, states, pulled covers, the merged tree, and GLB.
- A new check: Explorer fetches no `three` module until 3D is pressed.

**PR 3, Annotate 3D:**
- **Unit test for `docToScene`, on hand-built documents and faces:**
  - colours become paths across every face, outermost only;
  - lamp colours and states map correctly;
  - a selector matching nothing on any face is reported missing;
  - an invalid colour is dropped.
- **New browser check, `check_annotate_3d`, on the S9510-28DC.** Switch to 3D, then confirm:
  - three marks in three colours are held by the viewer (`marks()`);
  - a custom lamp colour reaches it (`lampColors()`);
  - a lamp state reaches it (`states()`);
  - a mark on silkscreen text shows "not in 3D";
  - a click on a part selects it in the tree;
  - seating an optic in 3D keeps every mark;
  - a 3D to 2D to 3D round trip leaves the document unchanged;
  - `?mode=3d` opens in 3D;
  - the 2D-only exports are disabled with their title;
  - a GLB downloads, and once PR 1 is synced it contains no mark meshes.
- **Proving the check can fail:** break one piece on purpose, for example stop sending lamp colours, and confirm the check fails.

**Gates for every PR:**
- the site's `check-contract.py` and the full `check-browser.py`;
- the push through the real pre-push hook with an SSH keepalive, with no `--no-verify`;
- our code review, then the merge agent.

## 5. Out of scope

- Labels drawn in the scene beside their parts. The legend panel is the decision. Floating labels would need occlusion and collision handling.
- 3D files that carry the marks, and a PNG snapshot of the 3D camera. Both were offered and not chosen.
- A 3D mode in the kit's shell (approach C).
