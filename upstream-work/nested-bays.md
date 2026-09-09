# A bay inside a seated module cannot be populated

Against `kit/shell.js` and `spec/tools/portrayal/components_index.py` at
`0a08c00f`. No patch attached: the fix is small but the shape of the index entry
is upstream's call.

## Symptom

A component that hosts bays of its own has them drawn, seated with their
defaults, and named correctly in the tree — and there is no way to change what
is in one. The occupant picker never appears for it.

Concretely, on `dcp-2`: seat `smartoptics/dcp-f-a22@1` in `slot-1` and the tree
gains `slot-1/module/ppm-1` holding `smartoptics/ppm-dummy@1`. That bay accepts
`smartoptics/ppm-ad1-1510@1` and always has. Selecting the row gives an empty
inspector. Selecting `slot-2` — a device bay — gives the picker.

It reads as a modelling gap and is not one. The contract is right, the drawing
is right, the default is correctly seated; the only thing missing is the offer.

## Not one device

39 components across the library declare their own bays, 84 nested bays in
total — the Cisco A9K modular line cards and SIPs, the Dell 14G risers, these
Smartoptics shelf cards. None of them can be populated. `component.schema.json`
already describes the case and puts the count at 51 across 25 components, so
it has grown by two thirds since that line was written.

## Root cause

Two lookups key a bay by exact id against the DEVICE's compiled bay list:

    kit/shell.js:812   inspect()   const bay = (state.meta?.bays?.[bayView()] || []).find(b => b.id === path);
    kit/shell.js:860   swapBay()   const bay = (state.meta.bays[bayView()] || []).find(b => b.id === bayId);

For `dcp-2` that list is `slot-1`, `slot-2`, `psu-1`, `psu-2`, `fan-1`. The path
`slot-1/module/ppm-1` is in neither, so `inspect` draws no `<select>` and
`swapBay` returns before it does anything. One cause, two symptoms: a scripted
swap is refused for the same reason the picker is absent.

Underneath that, `components_index.py` emits `parts`, `elements`, `body`,
`files`, `skins` and the rest for each component, but never `bays`. So nothing
the shell loads knows what a nested bay accepts or defaults to. The information
exists only in the component's contract on disk.

## The seating machinery already handles it

Worth stating plainly, because it bounds the work: `swap.js` needs no change.
Measured against the compiled artifacts, two passes of `applyOverrides` on one
`dcp-2` front face —

    pass 1   bays: the device's own      overrides: {slot-1: smartoptics/dcp-f-a22@1}
             -> seats the A22; slot-1/module/ppm-1 appears carrying ppm-dummy@1

    pass 2   bays: [{id: 'slot-1/module/ppm-1', at: [147.3, 2.5],
                     size: {w: 55.4, h: 19.5}, accepts: [...], default: ...}]
             overrides: {slot-1/module/ppm-1: smartoptics/ppm-ad1-1510@1}
             -> seats the 1510, transform translate(175,12.25) translate(-27.7,-9.75),
                children addressed slot-1/module/ppm-1/module/osc/cap-tx and so on

The descriptor in pass 2 was typed out of the A22's contract by hand. That is
the whole of what is missing. `bayGroup` finds the nested opening by
`data-path` like any other, `rename` re-addresses the occupant into it
correctly, and the bay's own `at`/`size` are already in the carrier's
coordinate space, which is the space the nested group sits in.

## What we think it needs

Offered as a starting point, not a design.

1. **`components_index.py` carries a component's `bays`.** Normalised to the
   shape a device bay already has — the contract writes `size: [55.4, 19.5]`
   while a device bay carries `size: {w, h}`, and one shape means one code path
   in the consumer rather than two.

2. **The shell resolves a nested bay.** A tree node with `data-class="bay"`
   whose path is not a device bay is a nested one: its carrier is the path up to
   the last `/module`, whose `data-ref` names the component, whose bays come
   from (1). `swapBay` needs the same resolution, and `state.cfgBays` needs to
   key on the full path so two carriers of the same model do not share an
   answer.

The second half is where the judgement is, which is why there is no patch here:
whether a nested bay belongs in `state.meta.bays` under its full path, or is
resolved on demand, changes what `bays` means elsewhere — the `N bays` count in
the status line among them.

## What we would not change

`swap.js`. It already does this correctly, and the measurement above is the
evidence.
