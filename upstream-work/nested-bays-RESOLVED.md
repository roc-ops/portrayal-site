# Nested bays — fixed upstream

Answers `nested-bays.md`. Implemented in Portrayal on branch `nested-bay-shape`.
All three items are done, plus one defect the third uncovered.

## 1. render.py emits a component's bays in the device shape

A bay inside a component is now a group holding its opening and its occupant,
exactly as a bay on a device face is:

    <g id="dcp-f-a22--ppm-1" data-path="…/ppm-1" data-class="bay" data-z-lift="44">
      <rect id="dcp-f-a22--ppm-1--opening" …/>
      <g id="dcp-f-a22--ppm-1--module" data-ref="…ppm-ad1-1510@1:1.0.0"> … </g>
    </g>

The group takes the skin rect's place **in the skin's own draw order** — the
opening is a hole in the plate and has to stay where the plate put it. A
`behind:` bay moves wholesale to the front instead, which is what keeps the
riser plate painting over its cards.

**Verified by pixel-comparing all 2572 compiled drawings against `main`.** 2540
are byte-identical. The 32 that differ are all `r740xd.*.rear`, all the same
316 pixels, and all the same intended change: the riser-2 family strokes its
slot anchor `#454b51`, and that outline used to paint **over** the seated card.
It now sits behind it, which is where a slot edge is, and it still shows when
the bay is empty. The riser-1 skins had already removed that stroke for the
same reason — their comment calls it "one shape drawn twice".

## 2. components_index.py carries a component's bays

All **39 components / 84 bays** now publish, normalised to the device bay's
shape (`size: {w, h}` from the contract's `[w, h]`), with `at`, `accepts` and
`default`.

## 3. The shell resolves a nested bay

`swap.js` gains `nestedBays(rootEl, compByRef)`, used by both `shell.js` and
`viewer3d.js`. **Resolved on demand, not merged into `meta.bays`** — which
nested bays exist depends on what is currently seated, and `meta.bays` means
"the bays this device declares", which the status line counts.

`viewer3d.js` needed one more thing: its per-view guard tests the device's bay
list for an overridden id, so a nested override named no view and the 3D scene
kept the old occupant. Nested paths are the ones carrying `/module/`, which no
device bay id ever does, so recognising them costs a string test rather than a
parse of every view.

## The defect item 3 uncovered

**`seatModule` and `rename` conflated an id base with a path base.** render.py
joins an id with `--` and a path with `/`, so one bay is the element
`slot-1--module--ppm-2` at the path `slot-1/module/ppm-2`. On a device bay those
are the same string and one argument served both by luck.

On a nested bay they diverge, and the first live swap showed it: the removal
looked for an id built out of the path, found nothing, and the seat appended a
**second** occupant beside the first. The bay held two modules and the drawing
showed the old one. Both functions now take the two separately, `pathBase`
defaulting to `idBase` so a device bay reads exactly as before.

## Verified in the explorer

`dcp-2` gained an `ila-node` configuration — an A22 in slot 1 with a
PPM-AD1-1510 in its upper bay — and against it, live:

- the tree reads `ppm-1 — PPM-AD1-1510-2F` / `ppm-2 — PPM-DUMMY`, not "open";
- selecting a nested bay offers the picker with both accepted modules;
- swapping `ppm-2` to the 1510 leaves **one** occupant, ids on `--` and paths on
  `/`, and the tree updates;
- the swap appears in **3D** as well as 2D.

## Tests

- `spec/tests/js/nested-bays.mjs` + `test_nested_bays.py` — resolution off a
  drawing, and that the index publishes what a nested bay accepts.
- `test_bay_occupant_lift.py` — rewritten to assert the invariant (the
  occupant's effective lift is the bay's) rather than the old mechanism, which
  was a copy and is now inheritance.
- `test_composed_lift_not_doubled.py` — unchanged and still green, which is what
  says moving the lift onto the group did not start counting it twice.

## One correction to the note

`nested-bays.md` says item 1 fixes the tree and the swap "with no change to
`swap.js`". Item 1 alone does fix `bayGroup` and `appendChild`; the id/path
conflation above is separate, was invisible while nested bays could not be
swapped at all, and does need `swap.js`.
