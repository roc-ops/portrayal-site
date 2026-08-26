# Portrayal — identity direction 01, "Anodized"

Settled 26 Aug 2026. Exploration page: `exploration.html` (also published at
https://claude.ai/code/artifact/fe154c19-adea-4716-acaa-93cc06b4e887).

Nothing here is committed to the Portrayal repository. These are assets for the
site and for whoever eventually restyles the demo.

## What is being branded

Portrayal is a **neutral substrate**, not a product. It compiles YAML device
manifests into flat SVG in real millimeters, where every port, PSU, fan, LED,
bay and region carries a stable DOM id and a `data-path`. What gets built on
that is deliberately open — documentation, monitoring overlays, DCIM
integration where clicking a port follows its connection, rack layouts, install
guides, configuration-accurate drawings populated from discovery.

That plurality is the point. The identity must not pick a favorite. It is
closer to the branding of a font foundry or a rendering library than of a SaaS
application.

Two consequences, both load-bearing:

1. **The mark must not depict a use case, and must not depict a specific piece
   of gear.** The core is domain-neutral; `spec/DESIGN.md` calls networking
   profile #1, not the only profile. An RJ45 or a QSFP cage in the logo would
   put profile #2 at war with the brand.
2. **The brand color never appears on the canvas.** The device drawing is the
   content, rendered in real grays and metals, and status color has to be the
   loudest thing on screen. Brand lives in chrome, docs, site and mark.

## The reserved colors

The explorer gives the user magenta, green, yellow, cyan, orange, white and
pink as marking colors. Those are spoken for. A brand color drawn from that
set would read as an annotation somebody made rather than as chrome. This is
the single hardest constraint on the palette and it is why the accent is a
warm metal — it is nowhere near any of them.

## The mark

**01 Select.** A field of five elements — four quiet, one tall — with one
element lit and wrapped in a selection ring.

The field is mildly irregular on purpose. A perfectly regular grid reads as an
abstract tool; a field with structure reads as a device. It stays abstract
enough that the elements can be ports, bays, slots, cells, or something in a
domain nobody has modeled yet.

The ring, not the fill, is what makes it work small. When the lit element gets
too small to read as a distinct color, the ring still says *this one*.

Files:

| File | Use |
|---|---|
| `portrayal-mark.svg` | Primary, 64-unit grid, full color. Anything ≥ 24px. |
| `portrayal-mark-16.svg` | Redrawn on the 16px pixel grid — fewer, chunkier elements, every edge on a whole pixel, and a full pixel of dark ground between the ring and the lit element. Not a scaled copy: rendered at 16px the 64px mark blurs ring and fill into one brass blob. Verified by rasterizing at 16 and inspecting on both grounds. |
| `portrayal-mark-mono.svg` | Single ink via `currentColor`, separated by opacity. Inline use, print, stamps. |
| `favicon.svg` | Copy of the 16px variant. |

### Rejected candidates, and why

- **Marquee** — corner ticks, nothing lit. Says *addressable* rather than
  *active*, which is arguably more accurate, but the ticks thin out badly below
  20px.
- **Callout** — a leader line to a label that isn't there. The most expressive
  and the one that scales into a whole system; also the most fragile, since a
  2px diagonal is the first thing to vanish at favicon size. Kept as the
  system's grammar rather than as the mark. See "Callouts" below.
- **Lift** — the element pulled out of plane, recess left behind. Good nod at
  the 3D work and at modularity; recess and lifted copy merge into a blur at
  16px.
- **Aperture** — inversion, the singled-out element being the hollow one. The
  best small-size performer of the six. **Held in reserve**: if 01 proves too
  soft at 16px in real use, this is the monochrome and favicon variant to
  switch to. Not adopted because a hole in a field says *empty bay* as readily
  as *selected*, and in this domain that ambiguity is real.
- **Trace** — the lit element with a path leaving it. The only candidate
  pointing outward at integration rather than inspection, but it reads as a
  network-diagram logo, which is the one neighborhood this project should
  avoid.

## Palette

Warm metal on a cool ground. The grays are the demo's own, tightened and given
a slight blue bias so the brass has something to be warm against. Full token
set in `tokens.css`.

| Role | Dark | Light |
|---|---|---|
| Accent | `#C79350` | `#8E6729` |
| Accent, raised | `#E3BC84` | `#B4873D` |
| Accent, dimmed | `#8A6432` | `#C3A87D` |
| Void (recesses, apertures) | `#0A0C0E` | `#DDE1E6` |
| Ground | `#0E1013` | `#EDEFF2` |
| Surface | `#16181B` | `#FFFFFF` |
| Line | `#2C3137` | `#D2D8DE` |
| Ink | `#E4E7EA` | `#13171B` |
| Ink muted | `#9AA1A8` | `#565E67` |
| Ink faint | `#6B727A` | `#838B94` |

Brass must stay matte. Saturated or gradient-shaded, a metal accent drifts
toward luxury goods and crypto; anodized is the register.

Both themes ship. The app defaults to dark and always will. The site follows
the system with a user toggle — `tokens.css` handles all three states
(explicit light, explicit dark, and the unstamped system default).

## Typography

Three faces, three jobs, no overlap. Deliberately not the category defaults.

| Role | Face | Notes |
|---|---|---|
| Display | Archivo 700/800 | Headlines and wordmark. Squared-off density close to panel lettering. Tracking −0.03em; never below 1.4rem. |
| Body | IBM Plex Sans 400/500 | Running copy and docs. Set near 65 characters. |
| Utility | IBM Plex Mono 500 | Ids, `data-path`s, provenance, maturity, callout labels, eyebrows. Uppercase takes 0.14em. |

Plex carries an engineering pedigree that Inter does not, and the mono is the
project's silkscreen voice — it is already how the explorer labels things.

## Wordmark

- **A · lowercase lockup** — mark + `portrayal` in Archivo 700, tight. Default.
- **B · silkscreen lockup** — mark + `PORTRAYAL` in Plex Mono, 0.22em tracking.
  For panel-flavoured contexts and narrow strips.
- **C · domain lockup** — `portrayal.dev` in Archivo 600 with the accent on
  `.dev`, mark omitted. For the site header and anywhere the domain is the
  point.

## Domain

**`portrayal.dev` is canonical. `portrayal.io` redirects to it.**

`.dev` is a generic TLD, HSTS-preloaded at the TLD level so every `.dev` is
HTTPS-only in every browser, and it reads as *developer substrate* — which is
what this is. `.io` became the open-source default largely by accident, via
GitHub Pages handing out `*.github.io`; it reads as *product* or *company*, it
is expensive, and as the country-code TLD for the British Indian Ocean
Territory it carries a long-tail sovereignty question that a generic TLD does
not. Nothing retires overnight and `.io` is not going anywhere soon, but it is
a non-zero risk with no upside here.

Hold `.io` anyway — as a redirect, and so nobody else has it. Keep it off the
README, the docs and the logo.

**This flips if Portrayal becomes a commercial product with the open-source
project as its front door.** Then `.io` is the parent and `.dev` is the docs,
and the wordmark leads with `.io`. Revisit before launch, not after.

## Callouts — the system's grammar

The leader line rejected as a mark is the right device everywhere else. A brass
leader from a ringed element to a monospace label is literally what the product
does, it is already in the explorer, and it is how technical documentation has
looked for a century. Use it for the site hero, docs figures, and social cards.

Related: **real faceplates in the illustration layer.** The mark stays abstract
for neutrality, but wherever the drawing is big enough to read — hero, docs,
social — use actual output from the library with actual callouts on it. That is
more convincing than any stylised port silhouette, because it is the genuine
artifact. Recognition where there is room for it; neutrality where there isn't.

## The dark stage, and why the drawing has low contrast on it

Settled 26 Aug 2026, with numbers, so it does not get reopened by eye.

The compiled chassis fill is `#3a3f45` — mid-dark metal, and not ours to
change. Measured against the stage it sits on:

| Stage | Contrast |
|---|---|
| Light `#EDEFF2` | 9.22:1 |
| Dark `#0E1013` (shipping) | 1.79:1 |
| Pure black, the best case by darkening | 1.98:1 |

The chassis sits in a dead zone: **you cannot darken your way to contrast.** To
clear the 3:1 minimum for meaningful graphics the surround has to be *lighter*
than about `#888888` — a light drafting table, not a dark stage.

**Decision: keep the stage dark.** The drawing's own internal contrast carries
legibility — black port apertures, lit LEDs, silkscreen — which is how the
project's own explorer has always worked. A light stage would also fight the 3D
canvas, which is a rendered scene and stays dark, so tabs would flip between a
bright slab and a dark one.

Revisit by making the 2D stage a light drafting table in both themes if the
drawing ever proves hard to read in practice. That is a one-token change.

## Open

- The 16px variant has been checked as a raster on both grounds and holds. It
  has not been checked in a real browser tab strip or plugin list, next to
  neighbors competing for attention. If it goes soft there, switch the small
  variant to Aperture.
- No social card / OG image yet.
- No wordmark as outlined paths — currently live text in Archivo.
