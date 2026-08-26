# DCIM export rework — ready to hand over

Built against the Portrayal working tree at `33837d7` (branch
`casa-furniture-and-layer-model`). **Not delivered yet**: `origin/main` is two
days and one whole reorganisation behind — it still has the `ndv-spec/tools/ndv/`
layout, while this targets `spec/tools/portrayal/`. There is nothing current to
open a PR against until that branch is pushed.

    dcim_export.py    replaces spec/tools/portrayal/nautobot_export.py
    build.sh.patch    the export loop in build.sh

## What it changes

**A NOS is optional.** The old exporter emitted a file only once it resolved
switch interfaces for a NOS profile, so a CCAP chassis or an optical shelf —
whose ports are line-card bays, and which run neither ArcOS nor SONiC — produced
nothing, despite having console ports, module bays, a weight and a part number.
The C100G now exports: 13 RU, 61.23 kg, 33 module bays, images.

**One device type per SKU, not per device.** A configuration carrying its own
part number is a separate type — `7726-32X-O-AC-F` against `7726-32X-O-AC-B` —
because that is what both libraries model; their own Edgecore entries are filed
as `5912-54X-O-AC-F.yaml`. Configurations that differ only in how bays are
populated collapse into one: a device type is the empty chassis, and what is
seated in a bay belongs to the device. The C100G's `bdm2m-11plus1` and
`docsis-classic` are two redundancy schemes for one chassis.

**Both libraries.** Writes `netbox/` and `nautobot/` trees in the layout each
library uses, so the output drops straight into a clone. The device-type
document is identical for both: the schemas share all 25 properties, NetBox's
enums are a strict superset (227 interface types against 115, nothing
Nautobot-only), and NetBox's two extra required fields are always written.

**Elevation images.** `front_image`/`rear_image` plus PNGs rendered from the
compiled faces at 2 px/mm — the range the libraries' own images sit in.

**Nothing dropped.** `comments` carries the datasheet, the maturity the model
claims, and the attrs the schema has no field for. A bay's `accepts` list goes
in its description.

## Verified

45 device types per target, 38 images (10 MB), **44 of 45 validate against both
libraries' real schemas**.

## Two things to know before merging

**The one validation failure is a float artifact, not a bad value.** `weight:
39.69` fails `multipleOf: 0.01` because `39.69 % 0.01 = 0.00999…`; `61.23`
passes. Any producer hits this, and the libraries' own CI would too. Worth
raising with them rather than working around silently.

**cairosvg cannot parse `var()`.** Every custom property in the compiled output
is a lamp colour and every one carries a fallback, so the renderer resolves
`var(--led-color, #3a3f44)` to its fallback first. That yields the unlit
faceplate, which is the right picture for a device type — it has no live state.

## Not done, deliberately

**Module types.** PSUs and fan trays should be their own module types, each
carrying its own `power-ports` — the inlet belongs to the supply, not the
chassis. 178 module contracts already exist in the library. This is the next
piece.

**Bay restriction.** Neither library can yet express what a bay accepts as data
(netbox-community/devicetype-library#4497, nautobot/devicetype-library#24). Both
products can — NetBox 4.7 bay types, Nautobot 2.4.11 module families. When the
schemas catch up, a front-to-back AC chassis can accept only front-to-back AC
supplies, and the `accepts` prose becomes a real constraint.
