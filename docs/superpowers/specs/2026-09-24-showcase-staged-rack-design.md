# Showcase redesign — one rack, built up in stages

**Date:** 2026-09-24
**Status:** design approved, ready for an implementation plan
**Supersedes:** the seven-tab showcase in `index.html` + `site/showcase.js`

---

## 1. Why

The showcase today is seven sibling tabs over one device (`as7726-32x`), each a
different lens on the same compiled face. It demonstrates *capabilities* but
answers no question in particular, and the order you click them in does not
matter. A reader learns that the drawing is addressable without ever being shown
why that is worth anything.

The redesign keeps every existing lens but hangs them off a **spine**: one rack,
built up in ordered stages, where each stage poses a question a network engineer
actually asks and the drawing answers it. The agreed shape is **"A toward C"** —
a single rack assembled in stages, with the existing per-device lenses demoted to
spokes reached from it.

Nothing here fabricates data. That is the standing rule at the top of
`site/showcase.js` and it constrains several decisions below, most importantly
§4.

---

## 2. The stage ladder

Seven ordered, cumulative stages. Each names a question; the drawing answers it.

| # | stage | the question it answers |
|---|-------|------------------------|
| 0 | Rails | is this to scale? |
| 1 | Mount | will it fit? |
| 2 | Populate (line cards) | what does this bay accept? — **the refusal is the point** |
| 3 | Seat optics | what media / speed / lanes? |
| 4 | Cable | what is connected to what? |
| 5 | Filter | show me just management |
| 6 | Take it away | draw.io / DCIM / GLB / SVG |

Stage 2 is the load-bearing one. A bay that *refuses* an incompatible card is the
single clearest demonstration that the model knows something real about the
hardware, rather than drawing a picture of it.

**Cast:** ASR-9006 (modular, `data-under` interior reveal), AS7726-32X (optics),
FHD-1UFCE (fibre path), R740xd (teardown spoke).

---

## 3. Architecture — a spine, with the existing tabs as spokes

### 3.1 What replaces what

`site/showcase.js` is 1213 lines holding seven tabs behind one contract —
`{hint, enter(), exit?()}` — sharing module globals (`svg`, `overlay`, `VIEW`,
`CONFIG`, and a hardcoded `DEV = 'as7726-32x'`).

Stages are **ordered and cumulative**: stage 3 assumes the cards stage 2 seated.
Tabs are independent and reset to the front face of the default config on entry
(`NEEDS_DEFAULT`). These are different control models, so the staged spine is not
an eighth tab — it replaces the tab strip with a **stage rail**.

| today | becomes |
|---|---|
| Inspect, Callouts, Live state, Select & regions | **spokes**, reached by clicking a device in the rack |
| 3D, Rack | absorbed into the spine — stages 1–3 *are* the rack, in 3D |
| Runbook | **retired** (see §7) |

Only Runbook is retired. It is the one tab whose content is hand-written,
AS7726-specific MOP prose rather than a lens over compiled data, so there is
nothing for a stage to regenerate.

### 3.2 Decomposition

1213 lines plus seven stages in one file is past what should live together. Split
along the seam that already exists:

| module | holds |
|---|---|
| `site/showcase/stage-rail.js` | stage order, progression, the epoch guard |
| `site/showcase/stages/*.js` | one file per stage — `{title, question, enter(), exit()}` |
| `site/showcase/spokes/*.js` | the four 2D lenses, re-homed and device-parameterized |
| `site/showcase/artifact.js` | loading, frame, overlay — today's globals made explicit |

`activate()`'s `epoch` counter is lifted **verbatim**. It exists so that an
`enter()` which awaits cannot paint over the view that replaced it, and it is
load-bearing for every stage that fetches — and for the 3D↔2D renderer swap a
spoke performs (§3.4).

### 3.3 Page layout — vertical ladder (decision: **B**)

Ladder on the left (~108px), stage centre, side panel right.

```
┌──────────┬────────────────────────┬──────────────┐
│ 0 Rails ✓│                        │ STAGE 2      │
│ 1 Mount ✓│         [rack]         │ "what does   │
│ 2 Populate│                       │  this bay    │
│ 3 Optics │   click a device       │  accept?"    │
│ 4 Cable  │      → spoke           │ REFUSED      │
│ 5 Filter │                        │ MPA-1X100G   │
│ 6 Export │                        │ bay is 40G   │
└──────────┴────────────────────────┴──────────────┘
```

Chosen because it is the only layout where all seven stage names are legible at
once — which is what makes the ladder teach anything — and it seats each stage's
question directly above the answer it produces. The rack is tall and narrow, so
the width the ladder costs is width the stage did not need.

Rejected: a horizontal rail on top (keeps today's geometry but forces seven terse
labels into one row); a scroll-driven spine with a sticky rack (best-looking,
but scroll-jacking fights the rack's own `panZoom`, stage order stops being
clickable, and stage 2's payload is a *refusal* — that wants a deliberate click,
not a scroll past).

### 3.4 Spokes — stage swap with a breadcrumb (decision: **A**)

The four lenses drive an inlined **2D** face (`#stage2d`); stages 1–3 are the
**3D** rack (`#stageRack`). A spoke is therefore a *renderer switch*, not a panel
swap.

Clicking a device replaces the rack with that device's 2D face at full stage
width. The ladder stays in place but dims, and a breadcrumb names the way back:

```
‹ back to stage 2 · Populate  ·  asr-9006 — spoke
[ Inspect | Callouts | Live state | Select ]
```

Chosen because a spoke genuinely *is* a context switch — different renderer,
different artifact, different question — and a split view spends scarce width
pretending otherwise, right after the ladder took 108px. It also needs no new
machinery: the existing `epoch` guard already covers the async swap.

Rejected: a split with the rack shrunk to a locator strip (costs width the face
came to use); an overlay sheet over a dimmed rack (clearest "how do I get back",
but it occludes the very rack it is preserving, and a modal over a pannable 3D
stage needs focus-trapping to be keyboard-sane).

---

## 4. Stage 4 has its own rack, and its own rails

**Decision: (c)** — stages 0–3 build the cast rack; stage 4 cuts to the ROADM
ring as a second, real rack. This is the spine's one deliberate scene change,
justified because cabling is inherently multi-device, and it is the only option
that keeps stage 4 honest.

`labs.json` is a real topology: **9 devices, 30 links** (24 `smf`, 6 `ethernet`),
a three-site ROADM ring spanning RU 16–36. But all 9 devices are instances of
just two refs — `dcp-r-34d-cs` and `dcp-sc-28p` — **none of the §2 cast**.

The alternatives both failed: re-casting stages 0–3 to the ring costs the
ASR-9006's `data-under` teardown and the AS7726's optics story; hand-authoring
links for the cast violates the file's own standing rule against fabricating
data.

**Stage 4 draws its own rails.** "Is this to scale?" is answered once, at stage
0, for the cast rack. Re-answering it with a different elevation would muddy the
claim, so the ring arrives with its own rails rather than being mounted into
stage 0's.

### 4.1 Endpoint arity

48 of the 60 link endpoints are **3-tuples ending in `tx`/`rx`**; 12 are
2-tuples:

> **Correction.** An earlier draft of this section said resolving a fibre end
> means `portAnchor(…/tx)`. That is wrong: **no vendored face carries a `tx` or
> `rx` data-path.** `tx`/`rx` appear only on a *pluggable optic's* skin
> (`generic/qsfp-lc@1` and `generic/sfp-lc@1` both have `tx`, `rx` and their
> bores), so they exist only once an optic is seated — which is what
> `a7255061` fixed and what `vendor/swap.js:76` describes. The ROADM's `xc34`
> is a `connector` with `bores: ["1","2"]` and nothing seated, so
> `xc34/tx` will never resolve.
>
> **Stage 4 anchors every end at the port path itself** (`ep[1]`), which the
> contract assertion in §6.3 proves resolves for all 60 ends. `tx`/`rx` are
> semantic: they say which strand of the pair a tube is, and the stage uses
> them only to offset the two tubes of a pair so both are visible. The
> `bores: ["1","2"]` sub-paths are available as a later refinement, but which
> bore is TX is **not stated in the data**, so the stage must not pretend to
> know.

```json
{"media":"smf","from":["site-a-roadm01-D1","xc34","tx"],
                 "to":["site-a-roadm01-D2","xc34","rx"]}
{"media":"ethernet","from":["site-a-roadm01-D1","eth4"],
                      "to":["site-a-sc01","port-1"]}
```

Stage 4 must handle both arities. Resolving a fibre end means
`portAnchor(…/tx)` — which is exactly what commit `a7255061` fixed for an optic
seated in a cage on a card. **Stage 4 depends on that fix.**

**Verified:** all **60** endpoints resolve to a `data-path` that exists on a
vendored face. Stage 4 needs no invented data.

---

## 5. Data and build dependencies

### 5.1 `labs.json` must be vendored, hard

It is not vendored today. `refresh-assets.sh` copies three indexes through a
*soft* loop:

```sh
for f in vendors.json overlays.json gaps.json; do
  [ -f "$SRC/dist/$f" ] && cp "$SRC/dist/$f" "$HERE/assets/dist/"
done
```

`labs.json` **must not join that loop.** Those three are vendored-but-unread, so
a silent miss costs nothing. Stage 4 is load-bearing, and `[ -f … ] &&` means a
missing file ships a broken stage behind a green refresh — the exact failure
shape that bit `fields.js` (#487) and `optical.js` (#535) twice in three days.

So: a hard `cp` beside `devices.json`, plus the contract assertion in §6.

`comparable-facts.json` stays unvendored; nothing needs it.

### 5.2 Already present, needing nothing

- Both ring refs are vendored — `dcp-sc-28p` and `dcp-r-34d-cs`, 12 faces and a
  `configs.json` each, and **neither needs a build change**: the wildcard
  `for f in "$SRC"/dist/*.svg "$SRC"/dist/*.configs.json` already copies every
  one. (The explicit per-device list a few lines below it is redundant for
  `configs.json` as a result. Left alone — not this design's business.)
- All four cast devices are vendored: ASR-9006 (24 faces), AS7726-32X (30),
  FHD-1UFCE (18), R740xd (246).
- **Stage 6 needs no new export work.** `site/drawio.js` (516 lines), GLB *and*
  USDZ via `vendor/share.js`, PNG via `site/raster.js`, raw SVG, and the NetBox
  and Nautobot DCIM exports under `assets/exports/`. Stage 6 is wiring.

### 5.3 Stage 5 filters by media *and* by purpose — both work today

Filtering by **media** works and the ring gives a real split: 24 `smf`,
6 `ethernet`.

Filtering by **purpose** also works, which contradicts this design's earlier
assumption that it needed an upstream field. **Every port a link names already
carries `data-group` on the compiled face:**

| port | `data-group` |
|---|---|
| `eth4` (ROADM rear) | `mgmt` |
| `xc34` | `xc` |
| `port-line`, `port-osc`, `port-1510` | `line` |
| `port-1`, `port-2` (controller front) | `rj45-1g` |

`configs.json`'s `cages` carry the same thing plus an explicit
`occupant-attrs.data-group-role` (`management` / `traffic`), and
`data-group-role="management"` appears on 22 elements across the two refs'
faces.

So a link's purpose is **the group of the ports it connects**, read off the
drawing — which is exactly the kind of thing this site claims the model already
knows. The four roles fall out:

- **management** — an end in `group: mgmt`
- **cross-connect** — an end in `group: xc`
- **ring-span** — `group: line` *and* the link carries `span`
- **osc-loop** — `group: line`, no `span`, and both ends on the same device

No upstream change and no fabricated data: stage 5 ships **both axes**.

roc-ops/Portrayal#565 (an optional `role` on a link) is still worth having — it
would let an author *state* the purpose instead of having every consumer
re-derive it, and deriving it depends on group-naming conventions that could
drift. But it is now a convenience, not a prerequisite, and the issue has been
corrected to say so.

---

## 6. Testing

### 6.1 The gap: `check-browser.py` never clicks

Its per-page check is `goto` → settle → collect `pageerror` and any 4xx. On
`index.html` only the **default** tab's `enter()` runs — `inspect`. The other six
tabs' code has never executed in CI.

The spine makes that worse: seven stages, each fetching its own artifacts (four
cast devices for 0–3, two ring refs for stage 4), every one behind a click. A
mistyped path in stage 4 would pass the contract, pass the browser check, and
404 on first open — the `fields.js` / `optical.js` class again, which is the
class `check-browser.py` exists to catch.

### 6.2 Drive the rail

Click each of the seven rungs, settle, collect. **Safe on a GPU-less runner:**
`site/webgl.js`'s `webglTrouble()` returns a sentence rather than letting
three.js throw, and the checker fails only on uncaught errors and 4xx — its own
comment already records that *a CI box has no GPU, WebGL falls back*. So the 3D
stages contribute real 404 coverage even with nothing rendered.

Settle **per stage on a readiness signal**, not a fixed sleep. `SETTLE_MS` is
9000, sized for the 3D harness; seven stages at a flat 9s would add ~1 minute to
a ~2-minute check.

Concretely: each stage sets `data-stage-ready="<n>"` on the stage container when
its `enter()` resolves, and the checker waits for that attribute before
collecting. This keeps the signal in the page rather than in a guessed interval,
and it fails loudly — a stage whose `enter()` throws never sets the attribute,
so the wait times out and names the stage instead of passing quietly.
`run_marks_harness` already uses the weaker form of this (waiting for output to
go quiet); an explicit attribute is cheaper and unambiguous.

### 6.3 Contract assertions to add

File-level, ~1s, no browser:

| assertion | guards |
|---|---|
| `labs.json` present; `labs[0]` has non-empty `devices` and `links` | the hard copy in §5.1 actually landed |
| every link endpoint resolves to a `data-path` on a vendored face | stage 4 cannot reference a port that is not drawn (the 60/60 check) |
| the four cast devices are vendored | stages 0–3 |
| the rail's stage list matches the stage modules on disk | the drift bug class |

The last follows an existing precedent: `PAGES` is *named rather than globbed*,
so "a page added here should be a line in a diff." The stage rail gets the same
rule, with the contract asserting list and directory agree.

---

## 7. Retiring the Runbook

**This happens *during* the decomposition in §3.2, not after it.** The four lenses
that become spokes get carried across to `site/showcase/spokes/`; `runbook`
simply is not carried. Retiring it as a separate later step would mean editing
line numbers that the decomposition has already moved, which is how a
half-retirement happens.

What goes, in the pre-decomposition file:

- `site/showcase.js:640–695` — the `runbook` IIFE (not ported)
- `site/showcase.js:1168` — its key in `TABS`
- `site/showcase.js:1179` — its entry in `NEEDS_DEFAULT`
- `index.html:125` — the tab button

Plus one contract check that no `data-tab="runbook"` survives anywhere and no
module holds a dangling reference. Cheap insurance against a dead button
shipping.

---

## 8. Out of scope

- **Purpose filtering** (§5.3) — needs an upstream optional `role` on a link.
  Filed as roc-ops/Portrayal#565; do not block on it. If it lands before stage 5
  is built, stage 5 gains a second filter axis for free — it is additive.
- **`vendors.json`, `overlays.json`, `gaps.json`** stay vendored-but-unread. The
  1,149 gaps in `gaps.json` are a separate story with its own page.
- **`compare.html`** is a 75-line photo overlay, not a comparison page.
  Untouched here.
- **`data-under` beyond the R740xd spoke.** The attribute is on 55 of 2742
  vendored faces and `shell.js`'s `over(path)` plus `relief.js`'s
  `setPulled`/`applyPulled` already implement it; the site calls none of it.
  Stage 2 and the R740xd spoke use it. A fuller teardown is its own design.

---

## 9. Next step

`superpowers:writing-plans` — turn this into a staged implementation plan. The
decomposition in §3.2 is the natural task boundary:

1. **Rail + artifact module**, with the Runbook dropped and the four lenses
   re-homed as spokes (§3.2, §3.4, §7 — one task, because they are all the same
   file move).
2. **Stages 0–3** against the cast.
3. **Stage 4** — the `labs.json` hard copy (§5.1) and the ring's own rails (§4).
4. **Stages 5–6** — media-only filter, and wiring the exports that already exist.
5. **Test changes** (§6) — drive the rail, add the four contract assertions.

Step 5 lands last only because it asserts what steps 1–4 build; the
`data-stage-ready` attribute it waits on should be added by each stage as that
stage is written, not retrofitted.
