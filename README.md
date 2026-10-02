# portrayal-site

Site and identity work for **Portrayal** — declarative, Git-versioned hardware
device definitions compiled into SVG where every port and every part is
individually addressable.

Kept deliberately outside the Portrayal repository so nothing here disturbs work
in progress there.

```
index.html          the landing page
explorer.html       the device explorer
components.html     the component browser
exporter.html       the DCIM export viewer
schema.html         the schema browser
site/               page styles and the showcase
brand/              identity direction, marks, tokens
vendor/             viewer modules — Portrayal's, vendored
assets/dist/        compiled SVGs — a vendored snapshot, not a live link
assets/schemas/     the three schema documents
assets/exports/     what nautobot_export.py writes, per device per NOS
```

## Who owns what

The line runs between the modules and the pages built on them.

| | Owner |
|---|---|
| `vendor/*.js` — `shell.js`, `viewer3d.js`, `relief.js`, `lamps.js`, `states.js`, `fields.js`, `swap.js`, `devsel.js`, `dist.js`, `share.js`, `marks.js`, `gif.js`, `zones.js`, `drawio.js`, `omnigraffle.js` | **Portrayal.** How you talk to a drawing. Vendored here, changed there. |
| `explorer.html`, `components.html`, `exporter.html`, `index.html`, `schema.html`, `site/*` | **This repository.** What you do with it. |

`shell.js` makes that line a real one rather than a convention: it is the whole
application chrome — stage, tree, inspector, pickers, 2D/3D, selection, bay
swapping — and its own header puts it plainly, *"a page is the shell plus its
own panel."* The Explorer's own panel is state chips on tree rows and syncing an
applied state into the 3D scene. That part is ours.

## Preview

```sh
python3 serve.py 8932
```

Then open http://localhost:8932/. It must be served over HTTP — the showcase
fetches compiled SVGs, so opening `index.html` from disk will not work.

## Refreshing the drawings

`assets/dist/` and `vendor/` are a **snapshot** of Portrayal's build output. The
schemas are at v0 and the drawings change, so after a `./build.sh` over there:

```sh
./refresh-assets.sh
```

That ends by running `check-contract.py`, which asserts what this site reads
from Portrayal — including that every module a vendored module imports was
vendored too. `fields.js` is why that check exists: it arrived as a new module
the hand-written copy list did not name, and nothing would have said so until
every page 404'd on its first import.

The schema page is covered by the same pass. The schema files are copied on
every refresh, so they cannot go stale; what can is `site/schema.js`, the
renderer. The contract fails when a schema appears upstream without a tab, or
uses a JSON Schema keyword the renderer does not know. The browser check then
asserts that every property in every schema file is on the page. It exists
because the renderer once stopped at the first map (`views`,
`configurations`, `groups`), and 146 of the device schema's 230 properties were
missing from a page that said it could not drift.

Then the half that needs a browser:

```sh
python3 check-browser.py
```

It opens all twelve pages and presses Run on the marks harness, and fails on a
404 or an uncaught exception — not on console noise, so it says nothing about a
machine with no GPU. It needs Playwright (`pip install playwright && playwright
install chromium`), which is why it is not part of `refresh-assets.sh`: the
refresh should run anywhere a build does.

## Running both without being asked

```sh
git config core.hooksPath hooks
git config core.sshCommand "ssh -o ServerAliveInterval=30"
```

The second line matters over SSH. Git opens the connection before it runs the
hook and holds it idle until the hook is done, and GitHub closes an idle SSH
connection before the browser pass ends - so without a keepalive a push that
passed every check still fails, with "Connection to github.com closed by remote
host" (#79). An HTTPS remote does not need it. The hook warns before the pass
if it is missing.

`hooks/pre-push` then runs the contract check on every push — under a second —
and the browser pass when the push touches anything a page loads: `vendor/`,
`site/`, `assets/`, `brand/`, a top-level `.html`, or the server itself. A
README fix does not pay the six to nine minutes, which is the difference between a hook
people keep and one they retire with `--no-verify`. Missing Playwright is a
loud skip rather than a refusal; `PORTRAYAL_HOOK_STRICT=1` makes it a failure.

`.github/workflows/checks.yml` runs the same two on every pull request. The
hook and the workflow are not redundant: the workflow checks a CLEAN CHECKOUT,
which is the only place a page that depends on an untracked file shows up as
broken. The hook runs against your tree, where that file is sitting there
working. The front page's hero was missing from every fresh clone for exactly
that reason, and only the workflow saw it.

Then click through the showcase and check it still behaves.

## The showcase

One device — an Edgecore AS7726-32X — driven seven ways off a single compiled
artifact:

| Tab | What it demonstrates |
|---|---|
| Inspect | Element semantics read off the drawing's own attributes; switch face and configuration (AC/DC, airflow) and the modules change with it |
| Callouts | Datasheet-style annotation generated from real geometry |
| Live state | The compiled `.state-*` stylesheet driven as a class toggle |
| Select & regions | Selection as a set of `data-path`s |
| Runbook | An example MOP where each step highlights the hardware it names |
| 3D | The real viewer, orbitable, with GLB and USDZ export, and drafting dimensions projected from the declared chassis |
| Rack | One stack, two renderers: a 2D elevation and a 3D rack (rails, EIA-310 hole spacing, U scale, ears, name labels). Swap an ASR-9001 module and it changes in both |

Wheel zooms, drag pans, double-click fits — on the 2D stages and the rack.

Every tab has a download control in the top-right of the stage, and what comes
out is the state on screen: the current frame, the applied states, the drawn
callouts, the swapped modules. The 2D tabs export SVG that keeps every `id` and
`data-path`, so the file you get is as addressable as the one on the page; the
3D views export GLB and USDZ.

`site/rack3d.js` is adapted from the project's own `demo/rack.html` — the rails,
hole spacing, U scale, L-bracket ears and recessed mounting come from there. Its
cabling and topology work is deliberately left out.

## Derived vs authored

Most of what the showcase displays is read off the compiled drawing. A few
things are written by hand, and the difference matters when reading the code:

| | |
|---|---|
| **Derived** | every coordinate, callout anchor and leader route; sub-labels (`qsfp28 · 100g · 4 lanes`, `7 members`); which states an element will accept; what each bay accepts; chassis dimensions |
| **Authored** | which elements the callouts point at and which side they leave from; the example MOP prose; the live-state speed bands |

A state the model does not declare is refused rather than faked — try a PSU
fault on the front view and nothing happens, because the front PSU lamps declare
only `off` and `on`.

## Known gaps

Tracked as issues on this repo. The big one is
[#1, seating transceivers in the optical cages](https://github.com/roc-ops/portrayal-site/issues/1)
— blocked on artwork, and the thing that most gives away that these are drawings
rather than photographs.

## Identity

Direction 01, "Anodized". See `brand/DIRECTION.md`.

Canonical domain: `portrayal.dev`. `portrayal.io` redirects.
