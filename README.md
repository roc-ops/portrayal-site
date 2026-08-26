# portrayal-site

Site and identity work for **Portrayal** — declarative, Git-versioned hardware
device definitions compiled into SVG where every physical thing is individually
addressable.

Kept deliberately outside the Portrayal repository so nothing here disturbs work
in progress there.

```
index.html          the landing page
site/               page styles and the showcase
brand/              identity direction, marks, tokens
vendor/             viewer modules copied from the Portrayal demo
assets/dist/        compiled SVGs — a vendored snapshot, not a live link
```

## Preview

```sh
python3 serve.py 8932
```

Then open http://localhost:8932/. It must be served over HTTP — the showcase
fetches compiled SVGs, so opening `index.html` from disk will not work.

## Refreshing the drawings

`assets/dist/` and `vendor/` are a **snapshot** of Portrayal's build output. The
schemas are at v0 and the drawings change, so after a `./build.sh` over there:

```sh
./refresh-assets.sh
```

Then click through the showcase and check it still behaves.

## The showcase

One device — an Edgecore AS7726-32X — driven seven ways off a single compiled
artefact:

| Tab | What it demonstrates |
|---|---|
| Inspect | Element semantics read off the drawing's own attributes; switch face and configuration (AC/DC, airflow) and the modules change with it |
| Callouts | Datasheet-style annotation generated from real geometry |
| Live state | The compiled `.state-*` stylesheet driven as a class toggle |
| Select & regions | Selection as a set of `data-path`s |
| Runbook | An example MOP where each step highlights the hardware it names |
| 3D | The real viewer, orbitable, with GLB and USDZ export, and drafting dimensions projected from the declared chassis |
| Rack | One stack, two renderers: a 2D elevation and a 3D rack (rails, EIA-310 hole spacing, U scale, ears, name labels). Swap an ASR-9001 module and it changes in both |

Wheel zooms, drag pans, double-click fits — on the 2D stages and the rack.

Every tab has a download control in the top-right of the stage, and what comes
out is the state on screen: the current frame, the applied states, the drawn
callouts, the swapped modules. The 2D tabs export SVG that keeps every `id` and
`data-path`, so the file you get is as addressable as the one on the page; the
3D views export GLB and USDZ.

`site/rack3d.js` is adapted from the project's own `demo/rack.html` — the rails,
hole spacing, U scale, L-bracket ears and recessed mounting come from there. Its
cabling and topology work is deliberately left out.

## Identity

Direction 01, "Anodized". See `brand/DIRECTION.md`.

Canonical domain: `portrayal.dev`. `portrayal.io` redirects.
