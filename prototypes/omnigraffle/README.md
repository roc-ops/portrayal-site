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

**Fourth test, 2026-09-11: everything draws.** Diagnostics 1, 2, 3, 4 and 6
all paint the faceplate on the canvas: PDF and PNG, grouped and ungrouped,
gzipped and the AWS original. Diagnostics 1 to 3 are the same files that drew
blank in the third test.

What changed was OmniGraffle, not the files. Every earlier window was titled
READ ONLY with no licence banner; every window this time was editable, with a
trial running. So the blank canvases were almost certainly OmniGraffle's
read-only mode declining to paint embedded images, while still drawing them in
the sidebar thumbnails.

**That retracts the PDF explanation given for the third test.** Our faceplate
PDF is far heavier than an AWS icon, but it draws: diagnostic 1 is exactly that
PDF. So the real export can stay vector. The image registry and the two sizing
flags stay too, because the working AWS stencil carries them, but neither is
proven to have been necessary, since every file tested before them was opened
read-only.

OmniGraffle offered to upgrade the package stencils to its single-file format.
That is the form a browser can hand over as one download, so it is the one to
aim for.

## Fifth test, 2026-09-11: in an editable OmniGraffle

| question | result |
|---|---|
| the zipped single-file stencil draws its faceplate | yes |
| a prebuilt line stays attached to two ports when the device moves | yes, but one end took the port's centre and the other its edge |
| a line drawn by hand snaps to an invisible port | yes on Ethernet, USB and every SFP; not on TOD, BITS, console or the coax timing inputs |
| a port's key/value data survives dragging the device onto a canvas | yes |

Both misses had one cause each, and both are fixed in this build:

- **The prebuilt line did not say which point on each port to use**, so
  OmniGraffle chose, differently at each end. Both ends are now pinned to the
  port's one magnet, its centre.
- **The ports that would not take a line were too small to hit.** The shared
  extractor in `site/drawio.js` measured only rectangles and circles, and those
  jacks are drawn mostly with curves. TOD, BITS and console came out as strips
  covering 8% of the jack, the coax inputs about 55%. It now measures each
  port's real laid-out outline, and every port on this device covers its whole
  jack. The draw.io export shares that extractor and had the same tiny targets,
  so it is fixed too.

## Sixth test

1. Open `S9510-28DC cabling test.graffle`. Both ends of the red line should sit
   at the centre of their ports.
2. Drag the front from `S9510-28DC zipped.gstencil` onto a canvas, and draw
   lines to TOD, BITS, console, GNSS ANT, 10MHZ and 1PPS.

**If a file draws blank, check the window title first.** READ ONLY means
OmniGraffle will not paint images there, whatever the file says.

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
