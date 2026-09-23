# A colour field is only painted at build time — fixed upstream

Answers `pluggable-fields.md`. Landed in Portrayal as
[#487](https://github.com/roc-ops/Portrayal/pull/487), which closes all three
issues the note was filed as: #481 the runtime paint, #482 the generics' latch
outline, #483 the share link's missing slot.

## What upstream did

**One helper, not two.** The note asked for a shared rule rather than two
near-copies, and that is what arrived: `kit/fields.js`, `paintFields` and
`unpaintFields`, with no DOM globals of its own and nothing of three in it.
`shell.js` calls it for the 2D drawing the page shows and `relief.js` for the
documents the 3D scene rasterises, so the colour now changes in both — the half
the note said was waiting on the kit.

**It restores what was DRAWN.** The stash is `data-portrayal-fill` /
`data-portrayal-stroke`, written on the node the first time anything repaints it
and read back when the value is cleared. On the node rather than in a map
because the 3D side keeps a document as text and repaints from its own last
output: an attribute survives serialising and a `WeakMap` would not.

**The outline follows the fill, derived.** Item 2 was upstream's call between a
second field and a rule, and they took the rule: `data-stroke-derive="<key>"`
draws the stroke as a fixed darker shade of that key's colour — each channel
times 61/100 — held byte for byte against `render.py`'s `stroke_shade` by
`spec/tests/test_stroke_derive.py`. A red latch gets a red edge without a second
field to keep in step.

**And the share link carries fields.** `marks.js` slot 8 of the m1 document,
alongside the swaps.

## What this repository did about it

`site/optics.js` painted the 2D half itself, marked as temporary. **That is
gone** as of this sync: the kit does it in both places, and the stand-in had to
go rather than merely stop mattering. It stashed what the kit had just painted
as "what was drawn", so with both running, clearing a colour would have restored
the previous choice instead of the skin's own.

The controls themselves stay here. They are a page's business, not the kit's —
the kit's own page still offers no control for a field.

## Still ours to pick up

Annotate builds its document with `swaps` and no `fields`, so nothing on this
site fills slot 8 yet. A reader who colours a latch and shares the link loses
the colour.
