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

### Round 1 — `out/s9510-28dc.vsdx`

Untested. Questions, in order of what they would cost us:

1. Does Visio open it at all, without offering to repair it?
2. Does the faceplate draw?
3. Are the ports invisible, and does the connector tool snap to them?
4. Does the pre-drawn cable stay attached when the device is moved?
5. Does a port's Shape Data show up, with the right values?
6. Does Lucidchart's import preserve any of it?

Result: _pending_
