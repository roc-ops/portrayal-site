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

### Still open

- Shape Data: not yet confirmed visible with the right values in Visio.
- The stencil (`.vssx`). Everything above is a DRAWING. A stencil is the same
  shapes in a different container, and its minimal part set is the one thing no
  authoritative source describes.
- Vector faceplates - see below.

## Testing notes