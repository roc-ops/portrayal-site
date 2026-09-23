# A reload seats the part again and forgets what is written on it

Against `kit/shell.js` at `8af0c591`, after #481 (runtime paint) and #487 (the
share link's fields slot) landed. No patch attached: the fix is four lines in
`reseat()` and it is upstream's to place.

## Symptom

Seat an optic, set its `latch-color` and its `label`, then change the VIEW and
change back — front, rear, front. The optic comes back. The colour and the
label do not: the latch is the default grey again and the label node is empty.

`state.cfgFields` still holds both. The share link still carries both. Only the
drawing has stopped agreeing with them, so what a reader sees and what they are
about to hand someone else have quietly diverged.

## Cause

`loadStage` fetches the compiled face, which knows only the configuration, and
`reseat()` puts every swap back before `load` is emitted — its own comment says
why: "A FRESH FACE IS THE BUILD, and the swaps are not in it." The FIELDS are
not in it either, and nothing replays them. `cfgFields` is written by
`setFields` and read by nothing else; `reseat()` walks `state.touched` against
`cfgOccupants`/`cfgBays` and never looks at it.

It is not a paint bug — #481 fixed the painting, and `paintFields` does the
right thing when it is called. It is that nobody calls it after a reload.

## What we think it needs

`reseat()` replays the fields once the parts are back, after its own loop and
before `load`: for each path in `state.cfgFields` still present on this face,
`paintFields(el, vals)` — the same call `setFields` makes, so text and colour
come back by the one rule rather than two. Nested first is already the order
the loop establishes, and a path this face has not got is skipped and kept, for
the same reason a key it does not have is: the next face may have it.

Worth deciding at the same time whether a CONFIGURATION change should keep
them. `syncCfgBays` clears `cfgFields` wholesale beside `cfgBays` and
`cfgOccupants`, which is defensible - a new configuration is a new build - but
it means a label survives a view change and not a config change, and nothing
says so.

## Downstream, meanwhile

portrayal.dev's `site/optics.js` replays them on `load` through the shell's own
`setFields`, for both its pages. It is four lines and it goes the day
`reseat()` does it.
