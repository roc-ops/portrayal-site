# Contributing to portrayal-site

This repository is [portrayal.dev](https://portrayal.dev): the pages, the
showcase, the explorer, the rack builder, Annotate and the export pages, built
on modules and drawings that come from
[Portrayal](https://github.com/roc-ops/Portrayal).

**Most fixes belong in Portrayal, not here.** A device drawn wrong, a missing
device, a viewer module that misbehaves (`vendor/*.js`), or a DCIM export with
the wrong data is Portrayal's, and is fixed there; this repository takes a
fresh copy afterwards. What belongs here is what a page does with those
modules: its layout, its controls, its copy, and the site around it.

## Before you start

You need Python 3.12, Node 22 and a POSIX shell. To run the browser checks you
also need Playwright:

```sh
git clone https://github.com/roc-ops/portrayal-site.git
cd portrayal-site
git config core.hooksPath hooks      # the pre-push hook, once per clone
python3 serve.py 8932                # then open http://localhost:8932/
python3 -m pip install playwright && python3 -m playwright install chromium
```

The pages must be served over HTTP: they fetch compiled drawings, so opening
`index.html` from disk does not work.

### A Portrayal clone, when you need one

Most changes need nothing from Portrayal: `vendor/`, `assets/dist/` and
`assets/exports/` are committed copies. You need a clone only to refresh those
copies, and for one contract check that compares the vendored rack core with
its source (without a clone it is a named skip, not a failure).

Keep the clone separate from any Portrayal checkout you work in, build it, and
point `PORTRAYAL_UPSTREAM` at it:

```sh
git clone https://github.com/roc-ops/Portrayal.git ../portrayal-upstream
(cd ../portrayal-upstream && python3 -m pip install -e . && ./build.sh)
export PORTRAYAL_UPSTREAM="$PWD/../portrayal-upstream"
./refresh-assets.sh
```

`refresh-assets.sh` replaces `vendor/`'s Portrayal modules, `assets/dist/`,
`assets/exports/` and the schemas, then runs `check-contract.py`. Do not edit
those copies by hand: the next refresh overwrites them, and the change belongs
upstream. `vendor/three/` and `vendor/mcp-b/` are third-party and pinned; see
`NOTICE`.

## The checks

In the order CI runs them:

```sh
python3 check-contract.py                     # what this site reads from Portrayal; seconds
node --test tests/*/*.test.mjs                # the pure modules; about a second
python3 check-browser.py --only <check>[,<check>]   # your change's own browser checks; seconds
```

- **`check-contract.py`** reads files, not pages: that every module a vendored
  module imports was vendored too, that the schema page knows every schema,
  that the deploy build serves the pages and nothing private, that the CI
  shards cover every check, and the rest. It ends `contract: N checks passed`.
- **`node --test tests/*/*.test.mjs`** runs the modules that need no browser:
  the rack model, Annotate's document model and commands, the agent tools, the
  Worker. A new folder under `tests/` is picked up by the glob.
- **`check-browser.py`** opens the pages in Chromium and fails on a 404, an
  uncaught exception, or a check of its own. Run the checks your change touches
  with `--only`, by function name; an unmatched name is an error, never an
  empty pass. The whole pass, `python3 check-browser.py` with no arguments,
  takes many minutes on a laptop; CI runs it on every pull request in five
  shards (`--shard 1/5` to `5/5`, `--plan 5` prints the split), so you rarely
  need to run it whole yourself.

The pre-push hook (`hooks/pre-push`) runs the first two on every push. It runs
the browser pass only when asked, `PORTRAYAL_HOOK_BROWSER=1 git push`, and then
only if the push touches something a page loads. `git push --no-verify` skips
the hook, which is fine for a work-in-progress branch. README.md, "What runs
where", has the detail, including the SSH keepalive a long hook needs.

A new page check goes in `check-browser.py`, registered so `--only` can name
it. A new page goes in `tools/build-public.py`'s `PAGES`, or it is not
deployed; the contract check fails if a served page links one that is not.

## Pull requests

One change per pull request. The
[template](.github/PULL_REQUEST_TEMPLATE.md) asks what changed, how you checked
it, and the merge danger. A reviewer reads that before the diff.

### Merge danger

**Every merge to `main` deploys to portrayal.dev.** So "it is only the site" is
not a reason to merge on a guess: a broken page is live to everyone until the
revert deploys. Most changes are still **two-way doors**: a revert puts the
site back, and nobody outside the repository has to do anything.

A few are **one-way doors**, and wait for the maintainer to read them. It is
one-way if any of these is true:

- **A public URL goes away or changes meaning:** a page, a `media/` file, a
  schema at the URL its `$id` names, or a share-link or hash format that
  people have already saved. Others link to these, and a saved link cannot be
  updated.
- **A document format a visitor saves changes** (an Annotate document, a rack
  plan) so that one saved before the change no longer opens as it did.
- **It changes how changes are checked, merged or deployed:** a workflow,
  `wrangler.jsonc`, the Worker's routing, the hook, or a repository setting.
  Adding a check to `check-contract.py` or `check-browser.py`, or making one
  stricter, is two-way: a revert removes it. Removing a check, loosening one,
  or changing what one of the named items does is one-way.
- **It changes what an AI client connected through the agent relay can do**
  without the visitor asking for it.

Beside the door, say the **blast radius**: one page, every page that loads a
module, saved documents and links, or CI only.

## Commits

One sentence that says what is true after the change, optionally prefixed with
a scope: `rack: a cable to an unseated port says so instead of vanishing`. The
body says why, when why is not obvious. Sign off every commit
(`git commit -s`): the project accepts contributions under the
[Developer Certificate of Origin](https://developercertificate.org/), and the
sign-off is your statement that you may submit the work under Apache-2.0. There
is no CLA.

## What will not be merged

- Vendor material in any form: product photographs, datasheet figures, CAD,
  stencils. `reference/` is gitignored for the local comparison page; keep it
  there.
- A drawing, an export or a Portrayal module edited here rather than upstream.
- A hostname, private address, local path or credential in a tracked file.
- A page that works only with a file that is not tracked. CI checks a clean
  checkout for exactly this reason.

## Docs

The README says how the site is put together. Design notes go under `docs/`
and record the decision and why, dated; they name no decider and cite no
private tooling. Working plans are not committed.

## Where to ask

Open an issue. There is a form for a page bug and one for a page request; a
modelling defect or a device request goes to
[Portrayal](https://github.com/roc-ops/Portrayal/issues/new/choose).
