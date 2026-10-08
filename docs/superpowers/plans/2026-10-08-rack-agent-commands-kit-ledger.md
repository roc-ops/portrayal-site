# SDD ledger — plan: docs/plans/2026-10-08-rack-agent-commands.md
Spec: docs/rack-agent-commands-design.md (committed). Plan: untracked by upstream's .gitignore (docs/plans).
Branch: claude/rack-agent-commands on origin/claude/rack-kit-move (#896 OPEN at start)

## Pre-flight scan
The plan's drafter ran every task's code and tests green in a scratch copy of this worktree before handing it over. The controller checked task-to-task interfaces by reading the Interfaces blocks.
| Pair / task | Produces → consumes | Found |
|---|---|---|
| T2 → T3-T9 | loadSlots → {slotsOf, compByRef}; ed.apply/preview per-call ctx | consistent |
| T3 → T4, T6, T7, T9 | slot module + inspect(item) | consistent |
| T5 | selectCables | standalone |
| T6/T7/T8/T9 shared commands.js | sequential edits | no conflict |
| T10 | describe/catalog/rack.json kind + devices_index profile | standalone |
| T11 | descriptions over every touched command | after T6-T9 |
| each task | tests vs code | verified green by the drafter in scratch |

## Rulings
- Ruling K1: #896 is still OPEN, so Task 1 runs its export check and baseline on origin/claude/rack-kit-move now, and the rebase plus re-check runs before Task 11 (as the plan says) — cost if wrong: names may shift at rebase; Task 1's check catches it.
- Ruling K2: upstream's plan file stays untracked (docs/plans is .gitignored by #453); briefs come from it on disk — cost if wrong: none; the spec is the committed record.

## Progress
Task 1: complete (no changes) — every plan name exported on 40a0ece90 (#896 head); baseline 41 passed, kit npm test OK, comment spelling clean. Machine load 32-77.
Task 2: dispatched (BASE 02af2bc59, sonnet)
Task 2: ⚠️ resolved — the commit trailer is Opus 5.5 (checked with git log).
Task 2: complete (commits 02af2bc59..3aa8f1d12, review clean)
Task 2: minor (deferred): a device file parsing to null/{} gives an empty slots entry, not null; apply/preview(cmds, null) throws on destructuring (pre-existing); uneven comment wrap in withCtx; a malformed components.json entry stops the map loop partway
Task 3: dispatched (BASE 3aa8f1d12, sonnet)
Task 3: ⚠️ resolved — Ruling K3: inspect reads `accepts` directly instead of slotOptions. slotOptions only adds the "— empty —" row and the "(ships with)" mark, and inspect already reports `default` and `holds`; fit validates through acceptSwaps (Task 6) — cost if wrong: an agent sees no explicit "empty" option.
Task 3: ⚠️ noted for Tasks 6/7/9 — holdsAt, resolverFor, slotsFor, partsMissing and the partName fallback get their direct tests there.
Task 3: complete (commits 3aa8f1d12..f5c919bd1, review clean)
Task 3: minor (deferred): slotTree.addBay recursion has no depth cap; itemFacts calls slotsOf/chassisOf unguarded; slots export out of alphabetical order (brief-mandated); the bad-cfg test checks cages only, not bays
Task 4: dispatched (BASE f5c919bd1, sonnet)
Task 4: ⚠️ resolved — rack-inspect.mjs test count checked by the controller.
Task 4: complete (commits f5c919bd1..38fd1c076, review clean)
Task 4: minor (deferred): cableInfo awaits ctx.cableFacts without a catch, so a rejecting reader rejects inspect (site Task 4 should treat it as unchecked or catch it); no RED step recorded
Task 5: dispatched (BASE 38fd1c076, haiku)
Task 5: complete (commits 38fd1c076..29e47e67a, review clean)
Task 5: minor (deferred): a non-string `path` in a selector may throw in portPathOf rather than giving a sentence
Task 6: dispatched (BASE 29e47e67a, sonnet)
- Ruling K4 (Task 6 Important, and Minor 1): `fit` returns `unchanged(rack)` whenever the slot would hold the same part afterwards. With slots loaded, that's judged by holdsAt before and after, so seating the configuration's default or emptying an already-empty built slot is a no-op too. Without slots, by `own(was, path) && was[path] === ref`. Re-seating never prunes what sits inside — cost if wrong: an explicit null over an empty build isn't recorded (no visible effect).
Task 6: minor (deferred): a cable two levels deep under a swapped carrier with a same-id bay isn't flagged (edge case)
Task 6: fix round 1 dispatched (FIX_BASE 79787ef52)
- Ruling K5: accept the fix's order — the 'does not take' check runs before the same-part no-op, so re-fitting a part the slot doesn't list is refused, not silently accepted. This is stricter than K4's wording and keeps the brief's cut-at-eight test — cost if wrong: re-fitting an old refused part errors instead of no-op.
Task 6: fix round 1/5 (1 addressed, 0 open; commits 79787ef52..017704ae2)
Task 6: complete (commits 29e47e67a..017704ae2, review clean after 1 fix round)
- Ruling K6: Jason's routing run (2026-10-08) showed cable.route accepts made-up waypoints and that slack isn't reported. Task 9b is added to the plan (before Task 10): `pathwaysOf` in route.js, waypoint checks in cableRoute when chassisOf is given, and `slack` on inspect's cable. Bend radius and slack storage are left to a follow-up after the ZeroRU session's bundles land — cost if wrong: one more task in this PR.
Task 7: dispatched (BASE 017704ae2, sonnet)
Task 7: complete (commits 017704ae2..db6f81c11, review clean)
Task 7: minor (deferred): '__proto__' as a path or key without compByRef is a silent no-op (prototype set); value '' is stored for unpatterned text fields (treat as reset?); a stale undeclared key can't be reset with ctx loaded
Task 8: dispatched (BASE db6f81c11, sonnet)
Task 8: complete (commits db6f81c11..6b036801b, review clean)
Task 8: minor (deferred): endOf duplicated from cable-rules.js; an end stored without `view` counts as moved on re-send; the summary omits field edits made alongside a move; an older conflicting unmoved end blocks moving the other end
Task 9: dispatched (BASE 6b036801b, sonnet)
Task 9: ⚠️ resolved — the reviewer traced the site's call shapes (inspector, Explorer lens, unchanged cfg) by hand: unchanged apart from the documented clear.
Task 9: complete (commits 6b036801b..21cc30d36, review clean)
Task 9: minor (deferred, CARRY TO TASK 11): the CLEARED text "Your Explorer changes were for the old configuration" names a site page and now reaches agents. Reword (e.g. "Its swaps and fields were for the old configuration, so they were cleared.") in Task 11's wording pass, and check the site uses the import, not the literal.
Task 9: minor (deferred): no tests for the inspector/Explorer patch shapes, non-mutation after the swaps filter, `{cfg, swaps}` with slots, or same-cfg preserving swaps; a possible empty swaps key when an item had none
Task 9b: dispatched (BASE 21cc30d36, sonnet)
- Ruling K7 (Task 9b Critical 1): check only waypoints that are not already in the cable's stored route (deep-equal). The page's whole-list resends that carry an old stale waypoint still pass, and made-up new names are still refused — cost if wrong: a stale waypoint stays stored until the user removes it.
- Ruling K8 (Task 9b Important 3): for {item, via}, use `ctx.guidesOf(itemId)` when the caller gives it (the configured face; the site passes it for agent calls). Otherwise use rack.json's default-configuration ids, but skip the check for an item whose cfg isn't the default or which has swaps — cost if wrong: on such items without guidesOf, a bad via isn't caught.
- Ruling K9 (Task 9b Important 2): slack is null for a length unit other than m or ft; a missing unit counts as m.
Task 9b: fix round 1 dispatched (FIX_BASE 34acefc2b)
Task 9b: fix round 1/5 (3 addressed + 1 minor, 0 open; commits 34acefc2b..137d917f8)
Task 9b: complete (commits 21cc30d36..137d917f8, review clean after 1 fix round)
Task 9b: minor (deferred): slack double-rounds (it uses the rounded routed metres); negative slack is returned as-is (informative)
Task 10: dispatched (BASE 137d917f8, sonnet)
Task 10: complete (commits 137d917f8..ac87c6004, review clean)
Task 10: CARRY TO SITE PLAN Task 1: describe's default head changed from "Rack 1: 42U four-post…" to "Rack 1 (r1): N items, M cables." then "42U four-post…" (no name). Update site tests agent-tools.test.mjs:92 and queries.test.mjs:34, and leave about 30 extra characters of headroom in describe_rack's 1,500 budget. The site must cap `limit` (the kit window is unbounded).
Task 10: minor (CARRY TO TASK 11): a format-stability.md sentence that devices.json gained `profile` and contract stays 2; a real-library kind test (fhd-1ufce → patch panel, mx960 → router)
Task 10: minor (deferred): `(undefined)` when a rack has no id; an unknown section reads as both; tm-8001 is a switch while tm-8104/8106 are network devices (description-driven)
Task 11: pending the #896 rebase check (still OPEN); dispatched on the current base (BASE ac87c6004, sonnet)
Task 11: complete (commits ac87c6004..23b1f9138, review clean)
Task 11: minor (deferred): the README doesn't say inspect/selectCables take the same ctx; `view` is missing from the README selector list; the wording test doesn't walk nested `items` schemas; one long line in format-stability.md
Final review: dispatched (opus) over 40a0ece90..23b1f9138
Final review: With fixes — Important 1 (selectCables loose ignores facts.unchecked); Minors 1-6; full triage recorded in the reviewer report (all deferred minors "can wait" apart from the carried ones, which are done).
- Ruling K10: the fix wave takes Important 1, Minor 1 (portPathOf in fit's cut-cable check), Minor 2 (cable.route description names the refusal), Minor 3 (guidesOf `|| []`), plus a kit test pinning the site's patch shapes (inspector and Explorer lens). Minors 4-6 wait; 6 is local-only, from the gitignored plan file — cost if wrong: small.
Final fix wave: dispatched (FIX_BASE 23b1f9138, sonnet)
- Ruling K12 (recorded as K11 in the message to the fixer): drop the separate 'Fixed' changelog fragment, because these fixes ship with the unreleased feature; fold the note into rack-agent-commands.md — cost if wrong: none.
Final fix wave: re-review clean (commits 23b1f9138..67c28b407). BRANCH DONE; still owed: the #896 rebase and re-check, then push and the upstream PR (needs Jason's go-ahead).
Rebased onto origin/main after #896 merged (head 97b45c297): every plan name still exported; 118 passed, 1 skipped; npm test ok; changelog 45 fragments OK. Ready to push and open the upstream PR — waiting on Jason.
