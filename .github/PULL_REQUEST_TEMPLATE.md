<!-- One change per pull request. The reviewer reads this before the diff, so
     say what is true after the change and how you know. -->

## What this changes

<!-- One or two sentences: which page or module, and what it does now. A fix
     to a drawing, an export or a vendor/ module belongs in Portrayal. -->

## How it was checked

<!-- What you opened and what it showed: the page, the URL with its state, the
     browser. Name the check-browser.py checks you ran with --only, and any you
     added. -->

## Checks run locally

- [ ] `python3 check-contract.py` passes
- [ ] `node --test tests/*/*.test.mjs` passes
- [ ] `python3 check-browser.py --only <checks>` passes for the checks this change touches
- [ ] Nothing in `vendor/`, `assets/dist/` or `assets/exports/` edited by hand (`refresh-assets.sh` writes them)
- [ ] No vendor material, local path, private address or credential committed

## Merge danger

<!-- CONTRIBUTING.md, "Merge danger", lists what makes a one-way door. Every
     merge to main deploys. -->

**Door:** <!-- two-way, or one-way and why -->

**Blast radius:** <!-- who notices if this is wrong: one page, every page that
     loads a module, saved documents and links, CI only -->

## Anything a reviewer should look at first

<!-- A judgement you made, a behaviour you are unsure of, a check you skipped. -->
