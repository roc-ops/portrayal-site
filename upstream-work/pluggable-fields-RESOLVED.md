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

## And this repository fills the slot

Annotate built its document with `swaps` and no `fields`, so nothing here filled
slot 8 and a reader who coloured a latch and shared the link lost the colour.
Both pages carry it now.

**Annotate** sets `doc.fields` wherever it sets `doc.swaps`, holds them while a
link's own wait on its drawing, and applies a link's fields AFTER its swaps —
`port-4-occupant` is not in the drawing until the optic is. Nothing had ever
applied `doc.fields` on load, so the reverse direction was missing outright. A
field naming a part the drawing has not got is dropped rather than left in
`cfgFields` painting nothing and riding out in the next link, which is what an
ignored swap already does to itself.

**Explorer**'s link is query parameters, not the m1 document, and the kit reads
only `swap=`, so it needed a string of its own:

    ?…&swap=port-7~generic%2Fqsfp-lc%401
     &fields=port-7-occupant:label~LR4-A,port-7-occupant:latch-color~%23c22f2f

`encodeFields`/`decodeFields` in `site/optics.js`, by `encodeSwaps`'s rules one
separator further: every token is encodeURIComponent'd, so `:` and `,` cannot
appear inside one, and paths and keys are sorted so one state is one string. It
never throws and drops rubbish entry by entry. Read before `writeLocation`
exists, applied after `shell.ready`.

A field for a part the current FACE has not got is kept there, where Annotate
drops it: `cfgFields` spans the views, which is reseat()'s rule, and a document
is applied once against one named drawing.

## Still ours to pick up

Nothing replays `cfgFields` into a reloaded face, so a view round-trip shows the
optic without what is written on it. That is `fields-not-replayed.md`, and it is
a fix of its own rather than part of the share link.
