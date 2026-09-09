# A bay inside a component is emitted in a different shape from a bay on a device

Against `spec/tools/portrayal/render.py`, `spec/tools/portrayal/components_index.py`
and `kit/shell.js` at `acbe4fd5`. No patch attached: the fix is in render.py's
output shape and that is upstream's call.

## Symptom

A component that hosts bays of its own has them drawn and seated with their
defaults, and two things are wrong with them downstream:

- the tree calls an occupied bay **open**, and
- there is no way to change what is in one.

On `dcp-2`, seat `smartoptics/dcp-f-a22@1` in `slot-2`. The drawing shows both
its PPM bays carrying `PPM-DUMMY`; the tree reads `ppm-1 — open`, `ppm-2 —
open`; and selecting either gives an inspector with a class and a path and no
occupant control. The contract, the drawing and the seated default are all
correct. Nothing offers to change it, and the tree contradicts the picture.

## Not one device

39 components across the library declare their own bays, 84 nested bays in
total — the Cisco A9K modular line cards and SIPs, the Dell 14G risers, these
Smartoptics shelf cards. `component.schema.json` already describes the case and
puts the count at 51 across 25 components, so it has grown by two thirds since
that line was written.

## Root cause: two shapes for one idea

A bay on a DEVICE face is a group that contains its opening and its occupant:

    <g id="slot-1" data-path="slot-1" data-class="bay">
      <rect id="slot-1--opening" .../>
      <g id="slot-1--module" data-path="slot-1/module" data-ref="…dcp-2-blank@1:1.2.0"> … </g>
    </g>

A bay inside a COMPONENT is a bare rect, with its occupant as a SIBLING:

    <rect id="dcp-f-a22--ppm-1" data-path="dcp-f-a22/ppm-1" data-class="bay" .../>
    <g id="dcp-f-a22--ppm-1--module" data-path="dcp-f-a22/ppm-1/module"
       data-ref="…ppm-dummy@1:1.0.0" transform="translate(147.3,2.5)"> … </g>

Everything downstream assumes the first shape, so both symptoms fall out of the
second:

**The tree.** `shell.js:544` decides occupancy with
`n.el.querySelector('[data-ref]')` — a DESCENDANT query. A rect has no
descendants, so an occupied nested bay is always "open".

**The swap.** `swap.js` `bayGroup()` finds the bay by `data-path` and
`applyOverrides` then does `g.querySelector('#<id>--module')?.remove()` followed
by `g.appendChild(...)`. Against a rect that removes nothing — the dummy is a
sibling, and its id does not match the pattern either — and appends the new
occupant INSIDE a `<rect>`, where SVG will not render it. Measured on one
`dcp-2` front face, seating `ppm-ad1-1510@1` into `slot-1/module/ppm-1` after
seating the A22:

    occupant nodes after the swap:
      g  data-ref=…ppm-ad1-1510@1   parent: rect     <- appended, will not draw
      g  data-ref=…ppm-dummy@1      parent: g        <- never removed

So the drawing is unchanged and the DOM now claims two occupants for one bay.

**And the index.** Separately, `components_index.py` emits `parts`, `elements`,
`body`, `files`, `skins` and the rest, but never `bays`. So even with the shape
fixed, nothing the shell loads knows what a nested bay accepts or defaults to;
that lives only in the component's contract on disk.

## What we think it needs

Offered as a starting point, not a design.

1. **render.py emits a component's bays in the device shape** — a `<g>` carrying
   `data-path` and `data-class="bay"`, with the opening and the occupant inside
   it. That alone fixes the "open" mislabel and makes `bayGroup` +
   `appendChild` land in the right place, with no change to `swap.js` or to the
   tree.

2. **`components_index.py` carries a component's `bays`**, normalised to the
   shape a device bay already has — the contract writes `size: [55.4, 19.5]`
   while a device bay carries `size: {w, h}`, and one shape means one code path
   in the consumer rather than two.

3. **The shell resolves a nested bay.** A `data-class="bay"` node whose path is
   not a device bay is a nested one: its carrier is the path up to the last
   `/module`, whose `data-ref` names the component, whose bays come from (2).
   `shell.js:812` and `:860` both key on `b.id === path` against the device's
   list and would need that resolution. `state.cfgBays` needs to key on the full
   path too, so two carriers of the same model do not share an answer.

Whether a nested bay belongs in `state.meta.bays` under its full path or is
resolved on demand changes what `bays` means elsewhere — the `N bays` count in
the status line among them — which is the judgement call we are not making for
you.

## Correction

An earlier version of this note claimed `swap.js` already handled nested bays
and cited a two-pass `applyOverrides` measurement as evidence. That was wrong.
The measurement only checked that a node with the right `data-path` existed
afterwards; it did not check that the node would render or that the previous
occupant had gone. Neither is true, for the reason above. The seating machinery
does not handle the component shape, and item 1 is what makes it able to.
