# OmniGraffle export — one-device prototype

The UfiSpace S9510-28DC as an OmniGraffle stencil, built the way the draw.io
export is: the compiled face as one image, with an invisible, named shape over
every port and bay, so a line drawn to a port records *which* port.

**First test, 2026-09-11: structure worked, images did not.** The zipped
stencil with a binary plist opened in OmniGraffle, and every port and bay came
through by name in the sidebar and could be selected. But the faceplate was
blank.

The cause was the image registry. OmniGraffle resolves `ImageID: n` to the nth
file named in the document's `ImageList`; a PDF merely sitting in the package
is not enough. The first build copied the template tool's empty list. A known
working stencil, davidfsmith/AWS-OmniGraffle-Stencils as of 2026, lists every
file and keeps one empty `ImageLinkBack` entry per image, and the builder now
does the same. Its self-check fails if any `ImageID` does not resolve through
the list.

**Second test, 2026-09-11: still blank.** With the registry filled, the tinted
stencil drew its port boxes and no faceplate. The sheet thumbnail showed the
faceplate, but that was the packed `preview.jpeg`, not OmniGraffle drawing the
image; packages no longer carry one, so a thumbnail can no longer pass for a
working canvas.

A key-by-key diff against the working AWS stencil left three differences on
the image itself. Theirs sets `StretchImage: true` and `ManualSizeImage: NO`,
which say how the image fills its shape; ours set neither. Theirs sit at the
top level; ours sit inside a group. Their plist is gzipped. All five main
variants now carry the two sizing flags, and `out/diagnostics/` separates the
rest.

Checked without OmniGraffle: every file parses, every image is listed and
present, every line end names a shape that exists, the port boxes land on the
jacks when drawn over the rendered PDF, and Apple's own PDF renderer draws the
faceplate PDF correctly.

## Third test: the diagnostic ladder

Open these in order and note which ones show the faceplate on the canvas.

| file | what it changes | if it draws |
|---|---|---|
| `S9510-28DC tinted.gstencil` | adds the two sizing flags | fixed; the flags were the cause |
| `diagnostics/1 AWS control.gstencil` | the AWS file itself, one image of ours, no group, no ports | our PDF is fine |
| `diagnostics/2 ungrouped.gstencil` | ours, flags, gzipped, no group | the group was hiding it |
| `diagnostics/3 grouped gzipped.gstencil` | ours, flags, gzipped, grouped | gzip was the difference |

If only the control draws, the fault is in something we write that the control
does not, and the next build copies more of the control.

**Third test, 2026-09-11: all four blank on the canvas, including the control.**
The control is the AWS document itself with one image re-pointed at our
faceplate, so nothing structural we write is to blame. And OmniGraffle does
decode the faceplate: the sidebar thumbnails show it in the control and both
diagnostics, and those packages carry no preview image any more. It reads the
image and draws it small, but not on the canvas.

The PDFs themselves differ sharply, though both come from the same renderer,
cairo 1.18.4 via rsvg-convert:

| | AWS icon | our faceplate |
|---|---|---|
| page | 48 × 48 pt | 1247.24 × 123.31 pt |
| embedded fonts | 0 | 13 |
| soft masks | 0 | 12 |
| gradient patterns | 0 | 23 |
| embedded bitmaps | 0 | 2 |

Those come from the faceplate's gradients, transparency and text. Apple's
thumbnail renderer draws them; OmniGraffle's canvas plausibly does not.

## Fourth test

| file | what it is | if it draws on the canvas |
|---|---|---|
| `diagnostics/4 AWS original.gstencil` | an AWS stencil exactly as published | this OmniGraffle draws embedded PDFs; if it is blank too, the problem is not in any file |
| `diagnostics/5 AWS control PNG.gstencil` | the control, with our faceplate as PNG | PDF was the problem; PNG works |
| `diagnostics/6 device PNG.gstencil` | the whole device, ports and all, faceplate as PNG | this is what the real export would ship |

The PNGs are 8 px/mm, a 3520 px wide front.

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
| 3 port names in sidebar | yes, zipped binary variant, first build |
| 4 key/value data survives the drag | |
| 5 line snaps to an invisible port | |
| 5b tinted needed? | |
| 6 zipped, binary plist | opens; faceplate blank until the ImageList fix |
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
