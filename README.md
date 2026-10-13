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

Then open http://127.0.0.1:8932/. It must be served over HTTP — the showcase
fetches compiled SVGs, so opening `index.html` from disk will not work.

It listens on this machine only. To open it from another machine on your
network, opt in with `PORTRAYAL_SERVE_HOST=0.0.0.0 python3 serve.py 8932` (or
`--bind 0.0.0.0`).

## Refreshing the drawings

`assets/dist/` and `vendor/` are a **snapshot** of Portrayal's build output. The
schemas are at v0 and the drawings change, so after a `./build.sh` over there:

```sh
./refresh-assets.sh
```

**Where Portrayal is.** `refresh-assets.sh`, `check-contract.py` and
`tools/publish-schemas.sh` all read the same upstream checkout:
`$PORTRAYAL_UPSTREAM` if it is set, otherwise a sibling folder `../Portrayal`
next to this repository. Use a clone of its own, not a tree you are working in:
Portrayal's `./build.sh` rebuilds `library/dist` in place, and a refresh that
reads it mid-build vendors a tree with holes in it.

```sh
git clone https://github.com/roc-ops/Portrayal.git ../Portrayal
(cd ../Portrayal && ./build.sh)
./refresh-assets.sh
```

Anywhere else, set the variable for every one of the three:

```sh
export PORTRAYAL_UPSTREAM=/path/to/your/Portrayal-clone
```

A git worktree of this repository is not next to `../Portrayal`, so from a
worktree set `PORTRAYAL_UPSTREAM` explicitly. Without an upstream,
`check-contract.py` still runs, and reports the check that compares
`vendor/rack/` with the kit's source as SKIPPED.

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

The kit page is covered too, since #156. A refresh copies the kit's
`package.json` to `vendor/kit-package.json`, and the contract fails when:

- the version `kit.html` states (`data-kit-version`, and every
  `@portrayal/kit@<version>` in its CDN import map) is not that package's
  `version`; or
- a module in that package's `exports` is neither named by a section of
  `kit.html` (`data-modules="…"` on its `section.kit-sec`) nor listed in
  `KIT_NOT_DOCUMENTED_YET` in `check-contract.py`, with the reason.

When it fails after a refresh, the kit moved on and the page did not. Bump the
version on `kit.html`, then for each new module either document it (add it to
a section's `data-modules`, with prose or a recipe in `site/kit-examples/` that
shows it) or add it to `KIT_NOT_DOCUMENTED_YET` with a reason. A module that
leaves the kit has to leave the page and the list as well; the check fails on
a name in either that the kit no longer exports.

A version bump is also a cue to re-read the prose, not only the module lists:
a section can name every module and still describe what that version no longer
does. The bundles section said `inspect` gives `bend: null` until the
re-vendor to 0.10.0, for example, which stopped being true when 0.8.0 added
the bend check. Re-read each section whose modules changed in the release.

While the vendored kit is newer than the last npm release (`KIT_NPM_LATEST`
in `check-contract.py`), `#files` must carry the `data-kit-unpublished` note
saying so, since its `npm install` and CDN map cannot deliver the documented
modules. When a release is published, update `KIT_NPM_LATEST`; the check then
asks for the note to be removed.

Then the half that needs a browser:

```sh
python3 check-browser.py
```

It opens all twelve pages and presses Run on the marks harness, and fails on a
404 or an uncaught exception — not on console noise, so it says nothing about a
machine with no GPU. It needs Playwright (`pip install playwright && playwright
install chromium`), which is why it is not part of `refresh-assets.sh`: the
refresh should run anywhere a build does.

## What runs where

| Check | On every push (the hook) | In CI, every pull request | Locally, by hand |
|---|---|---|---|
| `check-contract.py` | yes, seconds | yes | any time |
| `node --test tests/*/*.test.mjs` | yes, under a second | yes | any time |
| `check-browser.py` | only with `PORTRAYAL_HOOK_BROWSER=1` | yes, five shards | your change's own `--only` checks, or the whole pass |

Install the hook once per clone:

```sh
git config core.hooksPath hooks
```

`hooks/pre-push` then runs the contract check (and the rack builder's node
tests) on every push. It does not run the browser pass unless asked: CI runs
that on every pull request, against a clean checkout, and a hook that cost
eleven to twenty minutes on every push was a hook people retired with
`--no-verify` (#144). Before pushing a change to a page, run its own checks,
which take seconds:

```sh
python3 check-browser.py --only <check>[,<check>]
```

To have the hook run the whole pass for one push:

```sh
PORTRAYAL_HOOK_BROWSER=1 git push
```

Even then it runs only when the push touches anything a page loads: `vendor/`,
`site/`, `assets/`, `brand/`, `tests/`, any `.html` outside `coming-soon/`, or
the server itself. A README fix skips it. Missing Playwright is a loud skip
rather than a refusal; `PORTRAYAL_HOOK_STRICT=1` makes it a failure.

Whatever the hook leaves out, it says: one `pre-push: skipped ...` line for
each check that did not run, with the reason. A force-push over commits this
clone never fetched has nothing to diff against, so it is checked as a new
branch is.

Over SSH, an asked-for pass also wants a keepalive:

```sh
git config core.sshCommand "ssh -o ServerAliveInterval=30"
```

Git opens the connection before it runs the hook and holds it idle until the
hook is done, and GitHub closes an idle SSH connection before the browser pass
ends - so without a keepalive a push that passed every check still fails, with
"Connection to github.com closed by remote host" (#79). An HTTPS remote does
not need it. The hook warns before the pass if it is missing.

`.github/workflows/checks.yml` runs all three on every pull request. The
hook and the workflow are not redundant: the workflow checks a CLEAN CHECKOUT,
which is the only place a page that depends on an untracked file shows up as
broken. The hook runs against your tree, where that file is sitting there
working. The front page's hero was missing from every fresh clone for exactly
that reason, and only the workflow saw it.

The workflow runs the browser pass as five jobs at once, `python3
check-browser.py --shard 1/5` to `5/5`, because one job on a two-CPU runner had
reached twenty minutes. The shards are balanced by how long each check takes on
CI, from the table at THE SHARDS in `check-browser.py` (measured from green runs
by `python3 tools/shard-weights.py --write <run id> ...`); a check not in the
table is weighed as a short one, so a new check needs no entry. `python3
check-browser.py --plan 5` prints who runs what. The contract check fails if
the shards ever stop covering every check exactly once, or if the workflow
stops asking for all of them. Without `--shard` the script runs everything, as
the hook does when asked.

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

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md): setup, the checks in the order CI runs
them, and what makes a change a one-way door. A device drawn wrong, a missing
device or a fault in a `vendor/` module belongs to
[Portrayal](https://github.com/roc-ops/Portrayal) and is fixed there. Security
reports follow [SECURITY.md](SECURITY.md), never a public issue; conduct is
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Licence

Apache-2.0, as Portrayal is: see [LICENSE](LICENSE). [NOTICE](NOTICE) lists
what is not this repository's own work: Portrayal's modules, drawings and
exports (each set with Portrayal's NOTICE beside it), the third-party code
bundled in `vendor/three/` and `vendor/mcp-b/` with their licences, and the
sponsor logos in `brand/sponsor/`, which are RocNet Supply's marks and not
under the licence.
