# A colour field is only painted at build time

Filed upstream as roc-ops/Portrayal#481 (runtime paint), #482 (the generics'
latch outline) and #483 (the share link has no slot for fields).

**FIXED** — all three, in roc-ops/Portrayal#487. See
`pluggable-fields-RESOLVED.md`.

Against `kit/shell.js`, `kit/relief.js`, `spec/tools/portrayal/render.py` and
`library/components/generic/*` at `bca3059f`. No patch attached: the fix lives in
the kit and in four contracts, and both are upstream's.

## Symptom

Seat `generic/sfp-lc@1` in a cage, then set its `latch-color` field at runtime
(`shell.setFields('port-4-occupant', {'latch-color': '#c22f2f'})`). The label
field changes in the drawing and in 3D; the latch colour changes in neither.

## Cause

A part's colour is a field: its node carries `data-fill-from="latch-color"`
(and could carry `data-stroke-from`). `render.py` `fill_from_attrs` paints it —
**at build time only**. At runtime both paths write text and nothing else:

- `shell.js` `setFields` handles `[data-from=key]` and sets `data-<key>`.
- `relief.js` `applyNodeFields`, which the 3D scene uses, does the same.

Neither touches `data-fill-from` or `data-stroke-from`, so a colour chosen at
runtime is ignored in 2D and 3D alike. The kit's own page never offered a
control for fields, so nothing exercised it.

## What we think it needs

1. **Both runtime paths apply the build's rule.** A non-empty value sets
   `fill` on `[data-fill-from=key]` and `stroke` on `[data-stroke-from=key]`; an
   empty value leaves (or restores) what was drawn — `fill_from_attrs`'s
   "empty leaves the default here, where for text it deletes". The two
   functions are near-copies already, so one shared helper would keep them in
   step.

2. **The generics' latch outline follows its fill.** `generic--sfp-lc`'s bail is
   `fill="#2f5fa8" stroke="#20406f" data-fill-from="latch-color"` with no
   `data-stroke-from`, so a red latch is drawn with a dark-blue edge — the
   drawing #278 was written to prevent. Either a second field for the outline,
   or a rule that derives one, is upstream's call.

## Downstream, meanwhile

portrayal.dev's Explorer paints the 2D half itself by the same rule, marked as
temporary, and leaves 3D to the kit.
