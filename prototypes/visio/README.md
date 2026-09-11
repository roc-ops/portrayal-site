# Visio export, prototype

Same device as the OmniGraffle prototype, the UfiSpace S9510-28DC, for the same
reason: it is the one we both know by eye now, and it has the awkward ports.

`build_vsdx.py` writes `out/s9510-28dc.vsdx`. Faces come from
`assets/dist/s9510-28dc.{front,rear}.svg` via `rsvg-convert` at 8 px/mm, and the
port geometry is `../omnigraffle/s9510-28dc.ports.json` — the same extraction the
draw.io and OmniGraffle exports use, so all three agree on where a port is.

    rsvg-convert -w 3520 ../../assets/dist/s9510-28dc.front.svg -o out/front.png
    python3 build_vsdx.py

## A drawing first, not a stencil

The thing we eventually want is a stencil (`.vssx`) — a library you drag from,
the analogue of what we ship for draw.io and OmniGraffle. This builds a drawing
(`.vsdx`) first, deliberately:

- A drawing is what everything opens. Visio for the web opens one, Lucidchart
  imports one. A stencil may need the desktop application and a licence.
- The minimal part set for a drawing has a known-good, browser-side reference
  implementation (mermaid-to-visio, MIT). For a stencil, the minimum Visio will
  accept is not documented anywhere authoritative — Microsoft's published spec
  describes what Visio *Services reads*, not what the Visio *client requires to
  author*.

So the drawing answers the risky questions — does Visio accept our shapes, and
does a cable record which port it is attached to — before we also gamble on a
container the vendor will not describe.

## The identity question

Visio records a connector's attachment as a shape id plus a numeric part, not as
a name. Connection points can be named, but recovering that name means joining a
number back to the shape's rows by their order in the file, which is undocumented
and looks fragile.

So each port here is **its own invisible sub-shape**, as in the other two
exports, and the cable glues to that shape directly. Each port is named three
ways, because which of them survives a round trip is exactly what we do not know:

| where | what it is | who sees it |
|---|---|---|
| `Shape/@NameU` + `@Name` | the port's path | the shape name, and what a `Connect` points at |
| `Section N="Connection"` row name | the port's path | a named connection point |
| `Section N="Property"` (Shape Data) | path, class, group, media, speed | the user, in the Shape Data window |
| `Section N="User"` | the path again | nobody; a machine id a user cannot edit by accident |

## What the file currently contains

Two pages, front and rear. On each: the faceplate as a `Foreign` shape backed by
a PNG part, an invisible shape over each of the 43 ports and bays, and — on the
front — a cable pre-drawn from `tod` to `usb`, glued at both ends.

Checked locally before sending: the zip is valid, every XML part parses, every
relationship target exists, and every part is covered by a content type. None of
that means Visio will open it, which is the whole point of the test.

## Test log

### Round 1 — `out/s9510-28dc.vsdx` (superseded)

**Visio opened it without offering to repair it, and both faceplates drew.**
That settled the two things worth knowing about the container: the part tree and
relationships are right, and the `Foreign`/`ForeignData` image mechanism works.

Two failures, both in the shape XML and both mine:

- **None of the 43 port shapes could be selected or glued to**, in Visio or in
  Lucidchart. They had a position and a size but no `Geometry` section, which is
  what gives a Visio shape an outline to draw and to hit-test. Round 1 wrote 43
  shapes with nothing in them.
- **The cable rendered in the corner of the page, under the power supply**, and
  was not attached. Its geometry was written in PAGE coordinates; a 1-D shape's
  geometry is in its OWN space, running (0,0) to (Width,0), with Begin/End
  placing and rotating it.

Lucidchart is what ruled out the other explanation: it let the faceplate be
moved freely and the ports still could not be selected, so this was our shapes
being empty rather than a read-only viewer.

### Round 2 — `out/s9510-28dc.{tinted,invisible}.vsdx`

Both fixes above, plus one that follows from the first: an invisible shape needs
a **transparent fill, not an absent one**. `FillPattern 0` leaves no surface to
click; a fully transparent fill still hit-tests.

Two files on purpose, so that "I cannot click it" is readable as a result:

| file | port shapes |
|---|---|
| `tinted` | blue ports, amber bays, half transparent — you can see what to aim at |
| `invisible` | transparent fill, no outline — what we would ship |

Checked before sending: zip valid, every part well-formed, every relationship
target present, every part content-typed, 39 geometry sections where round 1 had
none, and the cable glued to `tod` and `usb` with begin/end across the middle of
the faceplate rather than at the origin.

**Visio opened it and roughly half the ports worked.** Selectable and gluable:
the management and console ports, TOD, BITS, the power supply bays, the fan
bays, and the BOTTOM row of SFP28s. Not selectable: USB, 1PPS, and the TOP row
of SFP28s — while the cable still drew to USB, so USB's shape is present and
something is stopping it being hit.

LEDs and the reset button are not selectable, which is correct: only ports and
bays get a shape, because only they are things a cable or a module connects to.

The failing ports are GEOMETRICALLY IDENTICAL to the working ones — the two
SFP28 rows are the same size and pitch and differ only in y — and no zone
overlaps any other on either face, checked exhaustively. So this is not shapes
covering each other and not a size threshold.

### Round 3 — the four bugs the research found, plus a z-order experiment

Round 2 was wrong in four ways that the ShapeSheet documentation settles:

| bug | what it should be |
|---|---|
| `FillForegndTrans` is a PERCENTAGE, 0-100 | round 2 asked for `1` meaning "all", and got 1% — a nearly solid box |
| the cable had no `OneD` cell | `OneD=1` is what makes a shape one-dimensional at all |
| glue was only `<Connect>` elements | real files also carry `PAR(PNT(...))` formulas and `BegTrigger`/`EndTrigger` |
| no `RecalcDocument` property | documented as required whenever connector positions are involved |

A connection point row is glued to by INDEX, so it is keyed `IX="1"`; the port's
identity comes from the shape around it, whose `NameU` is the port's path.

Two diagnostics ship alongside, to settle why identical shapes behave
differently. The suspect is z-order: we assume Visio paints the FIRST shape at
the back, so the faceplate goes in first and the ports sit over it.

| file | what it isolates |
|---|---|
| `d1-noimage` | the ports alone, no faceplate. If all 38 work, the shapes are fine and the image is the problem |
| `d2-imagelast` | the same ports with the faceplate emitted LAST. If FEWER work, first-is-back is confirmed and the image is not the cause |
| `tinted` | the normal build, ports visible |
| `invisible` | what we would ship |

**Both diagnostics answered, and one of round 3's own fixes was wrong.**

**Z-order: Visio paints the LAST shape in front**, the reverse of what rounds 1
to 3 assumed. `d2-imagelast` drew the faceplate normally with the connectors in
the right places; the other files, with the faceplate first, are the ones where
only some ports would glue. So the faceplate belongs LAST, with the ports behind
it — they are meant to be invisible anyway, and a connector still finds their
connection points through it.

**Transparency is a FRACTION in the file, 0 to 1**, whatever the ShapeSheet
documentation says about percentages — that is the number the user interface
shows. Round 3 wrote `100` meaning 100% and produced a solid white box over
every port, which is exactly what the `invisible` screenshot showed. Round 2's
`1` had been right. Evidence beat the documentation here, and it was the
tinted/invisible pair that made it visible at a glance.

### Round 4 — both findings applied

| file | what it is |
|---|---|
| `r4-imagelast` | the ship candidate: faceplate last, ports invisible behind it |
| `r4-imagefirst` | identical but for z-order, to confirm that is what decides gluability |
| `r4-tinted` | ports visible, no faceplate, as a map of where they are |

**It works.** Cables drawn by hand glue to USB, to the top SFP28 row and to
1PPS — the three that failed in rounds 2 and 3 — and they stay attached when the
device is moved, re-routing rather than detaching. Transparency renders correct
in both faceplate variants, so the fraction was right.

**Z-order was the whole problem.** Nothing was wrong with the port shapes from
round 2 onwards; the faceplate was simply in front of them, and which ports
survived depended on nothing more interesting than where the image happened to
be opaque.

### What is settled

- The package opens in Visio and in Lucidchart with no repair.
- The faceplate goes in as a PNG via `Foreign`/`ForeignData`, LAST in the file.
- A port is an invisible sub-shape: a real `Geometry` section, a fill at full
  transparency so it still hit-tests, `LinePattern` 0, one connection point.
- A cable glues to the PORT, and the port's identity is on the shape around it:
  `NameU`, Shape Data the user can read, and a User cell they cannot edit.
- The cable needs `OneD`, the `PAR(PNT(...))` glue formulas, the trigger cells
  and the document's `RecalcDocument` property.

### Round 5 — modular devices

The S9510 is a fixed switch: two PSU bays, five fan trays, everything else a
port on the chassis itself. A chassis is the case it could not test.

| device | what it exercises | zones |
|---|---|---|
| `mod/asr-9912` | bays at scale - 31 line card slots, 21RU, a 1333 mm page | 31 |
| `mod/r740xd` | bays and ports mixed, and ports on a SEATED CARD | 44 |
| `mod/dcp-2` | a shelf, both faces | 12 |

**The extraction is right, including the nested case.** Comparing what the SVG
holds against what came out: on the R740xd rear 19 zones are "missing" and on
the DCP-2 rear 5 are - and every one of them sits INSIDE a zone that was kept.
`eth0/jack` is not exported because `eth0` is; a jack inside a port is part of
that port, not a second thing to plug into.

What matters is that ports on a seated card DO come through:
`ndc/module/port-1` to `port-4`, the four NIC ports on a card in a bay. That is
the rule `readSvg` states outright - outermost wins WITHIN a class, not across
classes - and it is the rule that keeps a C100G's 44 module-borne ports.

Not yet tested: deeper nesting. This DCP-2 is the DEFAULT configuration, so the
PPM bays inside a seated A22 - the case written up in
`upstream-work/nested-bays.md`, path `slot-2/module/ppm-1` - are not in this
file. One level of nesting works; two is unproven.

### Round 6 — a device is one object

Until now the faceplate and its port shapes were unrelated shapes that happened
to overlap. Dragging a device moved the picture and left all 40 ports behind,
which is what the modular test showed: a box adrift outside the image. Each
device is now a `Group` holding the faceplate and its ports, with `SelectMode`
set so a click selects the group. The ports inside still glue individually.

### Nested BAYS are dropped, and that is not a Visio problem

The modular test found the PCI slots inside the R740xd's risers unselectable.
That is `readSvg`'s rule working as written: outermost wins WITHIN a class, so
`riser-1` (a bay) is kept and `riser-1/module/slot-1` (a bay inside it) is not.
A port on a seated card survives because the classes differ - `ndc` is a bay and
`ndc/module/port-1` is a port.

So a riser is gluable and the three PCI slots in it are not. The same is true of
the PPM slots inside a seated A22, and it is true of the draw.io and OmniGraffle
exports as well - this is `site/drawio.js`, shared by all three. Whether nested
bays should be their own targets is a decision about all three exports, not a
Visio question.

### Modules, and why the stencil matters

The modular files carry no module shapes at all. In draw.io and OmniGraffle each
module is a separate draggable library item; a `.vsdx` DRAWING has no library, so
only the chassis faces were exported. What the faceplate shows is the DEFAULT
configuration as compiled - the ASR 9912 draws its cards, the DCP-2 draws empty
slots - and the bays are connection targets either way.

Dragging a line card into a slot is a thing a STENCIL can express and a drawing
cannot. That is the argument for `.vssx`, and it is the next thing to prototype.

### Round 7 — the sub-shape design is the problem

Round 6's grouping was tested and produced three complaints, all of which come
from the same root: a device is 40 separately clickable things stacked on a
picture.

- **The device is hard to grab.** Every invisible port competes for the click,
  so selecting the device means hunting for a gap between them.
- **A port can be dragged out of its own device.** Clicking a riser and dragging
  left a box adrift outside the faceplate.
- **Cables stopped following the device.** They followed in round 4, ungrouped.
  Moving the ports into a group changed their coordinate space, and the
  page-level glue formulas now resolve somewhere else.

Two answers, built side by side rather than argued about:

| variant | what it is |
|---|---|
| `r7a-points` | the device is ONE shape; each port is a named CONNECTION POINT on it |
| `r7b-locked` | the group kept, every port locked against select, move and delete |

**A is the Visio-native answer** and the one the format research recommended
outright. A connection point is Visio's own idea of "a place on a shape you
attach to": it cannot be selected, cannot be dragged off, and moves with the
shape because it is part of it rather than a neighbour of it. All three
complaints disappear by construction.

What A costs:

- A bay stops being an AREA to drop a module onto and becomes a point like any
  other. For cabling that is no loss; for "drag a line card into slot 3" it is.
- Per-port data moves off 38 shapes and onto the device, as `User` rows named
  after each port - `User.port_12` holding the path, class, group, media and
  speed. Machine-readable, but no longer a per-port Shape Data pane.
- A `Connect` names a connection point by INDEX, so recovering which port a
  cable is on means mapping that index back to the row order. Within one shape
  that is deterministic, and the row names are in the file.

B keeps per-port shapes and their Shape Data, at the cost of being a fight
against Visio rather than with it.

**B won, and A was inert for a reason worth recording.**

`r7b-locked`: everything works. The ports are there, the device is grabbable,
and a connector drawn in Visio glues to a LOCKED port perfectly well - which was
the open question about locking, and the answer is that locking a shape does not
stop a connector attaching to it.

`r7a-points`: nothing was selectable at all, no connection points, a bare
picture. Not the format's fault - the `Connection`, `User` and `Property`
sections were emitted AFTER `ForeignData`, where the schema puts them before it.
Corrected in `points_shape` so the form is right if the stencil wants it later.

**And our pre-drawn cable is being dropped.** It detaches visually when the
group moves while Visio still believes it is attached: its endpoints are
page-level formulas that do not account for the group's coordinate space. A
cable the USER draws is written by Visio itself and behaves correctly. The cable
existed only to test whether glue survives a round trip; that question is now
answered by drawing one. We ship devices and let Visio do cables.

### Round 8 — the ship candidate

One `Group` per device face. Every port and bay an invisible sub-shape with a
real geometry, a fully transparent fill so it still hit-tests, and locked
against selection, movement and deletion. No cable of ours.

**The 31 line card bays behave**, on a 1333 mm page. Shape Data did not: the
field LABELS were all there and every value read `0` - except a speed of `100`,
which is the clue. Visio reads a Shape Data value as a FORMULA, so a bare
`mgmt` parses as a number and comes out zero while `100` survives by accident.

Some ports also lost their names, showing as `Sheet.15`. Those were the ones
with a path like `ndc/module/port-1` - a port on a card seated in a bay. **A
Visio shape name cannot contain a slash.**

### Round 9 — both fixed

- A Shape Data string is written as a quoted formula, `F="&quot;mgmt&quot;"`.
- A shape is named with dots, `ndc.module.port-1`, while `PortPath` keeps the
  real `ndc/module/port-1`. The name is for Visio; the path is for us.

**Shape Data reads correctly** - `mgmt` gives rj45 and 100m-1g, `port-6` sfp28
and 25g, `port-0` qsfp-dd and 400g, and the nested NIC port gives
`ndc/module/port-2`. Quoting the strings was the fix.

The nested ports were STILL called `Sheet.14`, though: a dot is Visio's own
separator, as in `Sheet.14`, so dots were no better than slashes. Round 10 uses
underscores - `ndc_module_port-1` - and the path stays in Shape Data.

### Round 11 — modules, and whether a bay can take one

Everything until now shipped a device as compiled. This is the case that cannot
be expressed that way: an A22 card seated in a DCP-2 slot, and a PPM inside the
A22. The card and the PPM are things the USER seats, so they have to be separate
shapes.

A drawing has no library to drag from - that is what a stencil is for - but it
can put the cards on the page beside the chassis, which answers the question
underneath: when a card is dragged onto a slot, does Visio understand the card
is IN the slot?

| variant | the bays |
|---|---|
| `modules-drag` | locked. A card dropped on a slot is parked on top of it |
| `modules-container` | each bay declares itself a Visio CONTAINER - a shape others are dropped INTO, listed as members of, and carried with |

The container variant cannot lock its bays, because a container has to be
selectable - which brings back round 7's problem of ports competing for the
click. That trade is the point of the test.

One page holds the DCP-2 front, the A22, and both PPMs. The A22 carries its own
two bays, so the nested case is really in there.

Result: _pending_

### Still open

- Shape Data: not yet confirmed visible with the right values in Visio.
- The stencil (`.vssx`). Everything above is a DRAWING. A stencil is the same
  shapes in a different container, and its minimal part set is the one thing no
  authoritative source describes.
- Vector faceplates - see below.

## Testing notes