# OmniGraffle export — one-device prototype

The UfiSpace S9510-28DC as an OmniGraffle stencil, built the way the draw.io
export is: the compiled face as one image, with an invisible, named shape over
every port and bay, so a line drawn to a port records *which* port.

**Not yet opened in OmniGraffle.** It was built on a machine without it. What
could be checked without it was: every file parses, every image a shape names
exists, every line end names a shape that exists, and the port boxes land on
the jacks when drawn over the rendered PDF.

## What is in `out/`

| file | form | what opening it answers |
|---|---|---|
| `S9510-28DC.gstencil` | package, text plist | the baseline: the form the existing SVG-to-stencil tool writes |
| `S9510-28DC tinted.gstencil` | package, text plist | same, with ports tinted blue and bays amber, in case invisible shapes cannot be clicked |
| `S9510-28DC zipped.gstencil` | zip, binary plist | whether the single-file zipped format opens as a stencil (needs 7.16+) |
| `S9510-28DC zipped-text.gstencil` | zip, text plist | whether a text plist is accepted inside the zip |
| `S9510-28DC cabling test.graffle` | package, text plist | whether a line attached to a port shape stays attached |

Each stencil has one sheet, `UfiSpace S9510-28DC`, with two items: the front
(36 ports, 2 PSU bays) and the rear (5 fan bays). Faces are true size,
440 × 43.5 mm.

## Test script, on a Mac with OmniGraffle

1. Open `S9510-28DC.gstencil`. Two items should appear, front and rear.
2. Drag the front onto a new canvas. It should measure 440 × 43.5 mm.
3. Expand it in the sidebar. Expect shapes named `port-0` … `port-27`, `mgmt`,
   `console`, `usb`, `bits`, `tod`, `gnss-ant`, `clk-1pps`, `clk-10mhz`,
   `psu-0`, `psu-1`.
4. Select `port-4` and open the object's key/value data. Expect
   `portrayal-path = port-4`, `portrayal-media = sfp28`, `portrayal-speed = 25g`.
5. Draw a line from `port-2` to `port-4`, then move the device. The line
   should follow. If a port cannot be clicked at all, repeat with the tinted
   stencil and note that.
6. Open both zipped stencils.
7. Open `S9510-28DC cabling test.graffle`. A red line joins `port-2` and
   `port-4`; move the device and it should follow.

| step | result |
|---|---|
| 1 package stencil opens | |
| 2 true size | |
| 3 port names in sidebar | |
| 4 key/value data survives the drag | |
| 5 line snaps to an invisible port | |
| 5b tinted needed? | |
| 6 zipped, binary plist | |
| 6 zipped, text plist | |
| 7 prebuilt line stays attached | |

## Rebuild

```
python3 prototypes/omnigraffle/build_stencil.py
```

Needs `rsvg-convert` and `pdftoppm`. The port geometry in
`s9510-28dc.ports.json` came from `site/drawio.js`'s own extractor, so both
exports agree on where every port is.

## Why these choices

- **PDF, not SVG.** OmniGraffle embeds images as files, and PDF is what the
  working stencil tool uses. `rsvg-convert` rather than cairosvg: every face
  uses CSS `var()` and cairosvg crashes on it.
- **A shape per port, not magnets.** A line on a magnet stores only the
  magnet's index. A named shape keeps the address.
- **One centre magnet per port shape,** matching the draw.io export's single
  centre connection point.
