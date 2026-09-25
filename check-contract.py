#!/usr/bin/env python3
"""What this site needs from Portrayal, asserted rather than assumed.

The schemas are at v0 and the drawings are rebuilt over there constantly. When
something this site reads goes away, the failure is silent: a tab renders
slightly wrong, or a download comes out empty, and nobody notices until someone
looks. This turns that into a build failure.

It is deliberately a list of what we USE, not a copy of Portrayal's schema. The
point is the contract between the two repositories - if a check here fails,
either the site has to change or the drift was unintentional over there.

Run by ./refresh-assets.sh straight after vendoring. Exits non-zero on a break.
"""
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
DIST = HERE / "assets" / "dist"
VENDOR = HERE / "vendor"

problems = []
notes = []


def check(cond, what, detail=""):
    (notes if cond else problems).append(
        f"{'ok  ' if cond else 'FAIL'}  {what}{('  — ' + detail) if detail and not cond else ''}")
    return cond


def jload(rel):
    try:
        return json.loads((DIST / rel).read_text())
    except Exception as e:
        problems.append(f"FAIL  {rel} unreadable — {e}")
        return None


# ── the indexes, and their SHAPE ─────────────────────────────────────────
# Shape matters as much as presence. `configs` is a LIST of objects each with a
# `name`; reading it as a map keyed by name yielded "0", "1", "2" and built a
# zip of 404s, silently, because a missing face is a normal thing to skip.
devices = jload("devices.json")
if devices is not None:
    check(isinstance(devices.get("devices"), list), "devices.json .devices is a list")
    d = (devices.get("devices") or [{}])[0]
    for k in ("name", "model", "manufacturer"):
        check(k in d, f"devices.json entry has .{k}")
    check("portfolio" in d or any("portfolio" in x for x in devices["devices"]),
          "devices.json entries carry .portfolio", "the scope menus group by line/family")

comps = jload("components.json")
if comps is not None:
    check(isinstance(comps.get("components"), list), "components.json .components is a list")
    mods = [c for c in comps.get("components", []) if c.get("kind") == "module"]
    check(bool(mods), "components.json has kind=module entries")
    if mods:
        m = mods[0]
        for k in ("ns", "name", "major", "class", "files"):
            check(k in m, f"components.json module has .{k}")
        check(isinstance(m.get("files"), dict) and "default" in m["files"],
              "component .files.default names a skin")

# EVERY config index, not a sample. A shape check that looks at one device is
# a shape check that misses the device that changed - the first version of this
# examined devices[0] only, and a configs list turned into a map elsewhere in
# the library sailed straight past it.
cfg_files = sorted(DIST.glob("*.configs.json"))
check(bool(cfg_files), "config indexes exist")
bad_shape, missing_ru, bad_name = [], [], []
for f in cfg_files:
    try:
        cfg = json.loads(f.read_text())
    except Exception as e:
        problems.append(f"FAIL  {f.name} unreadable — {e}")
        continue
    if not isinstance(cfg.get("configs"), list):
        bad_shape.append(f.name)
    elif cfg["configs"] and "name" not in cfg["configs"][0]:
        bad_name.append(f.name)
    if "ru" not in (cfg.get("chassis") or {}):
        missing_ru.append(f.name)
check(not bad_shape, f".configs is a LIST in all {len(cfg_files)} config indexes",
      f"read as a map its keys are array indices and every URL 404s: {bad_shape[:3]}")
check(not bad_name, "every config entry carries .name", f"{bad_name[:3]}")
check(not missing_ru, "every .chassis carries .ru",
      f"rack exports size devices by it: {missing_ru[:3]}")

check((DIST / "sizes.json").exists(), "sizes.json written",
      "the export pages estimate download size from it")

# ── the compiled drawing ─────────────────────────────────────────────────
# These attributes ARE the product as far as this site is concerned: without
# them a drawing is a picture rather than something addressable.
face = None
if devices is not None and devices.get("devices"):
    for dev in devices["devices"]:
        p = DIST / f"{dev['name']}.front.svg"
        if p.exists():
            face = p.read_text()
            break
if face is None:
    problems.append("FAIL  no compiled front face found to check")
else:
    for attr in ("data-path", "data-class", "data-device"):
        check(attr in face, f"compiled SVG carries {attr}")
    # ACROSS THE LIBRARY, NOT ON ONE DEVICE. Sampling the first compiled front
    # face and demanding ports on it broke the day base configurations landed:
    # a C100G's default is now a bare chassis - fourteen blanks, no modules, no
    # ports and no lamps - which is a change we asked for, not drift. The
    # classes still have to EXIST, or the exports find nothing; they just do not
    # have to exist on whichever device sorts first.
    faces = sorted(DIST.glob("*.front.svg"))
    for cls in ("port", "led", "region", "chassis"):
        n = sum(1 for f in faces if f'data-class="{cls}"' in f.read_text())
        check(n > 0, f'data-class="{cls}" on {n} of {len(faces)} front faces',
              "the draw.io export finds ports by it")
    check(re.search(r'\.state-[a-z]+', face) is not None,
          "the .state-* stylesheet is compiled in",
          "the live-state tab drives colour with it")
    check(re.search(r'viewBox="[\d.]+ [\d.]+ [\d.]+ [\d.]+"', face) is not None,
          "viewBox is present and numeric", "everything scales from it")

# ── the vendored modules ─────────────────────────────────────────────────
# Every symbol a page imports, checked against what the module exports. relief.js
# gained a scope argument on four of these in one afternoon; the defaults meant
# nothing broke, but nothing would have told us either.
WANT = {
    "dist.js": ["jdist"],
    "devsel.js": ["createDevicePicker"],
    "swap.js": ["applyOverrides"],
    "share.js": ["toGLB", "toUSDZ"],
    "relief.js": ["configureRelief", "buildFaceRelief", "canvasTex", "svgCanvas",
                  "svgSource", "setSvgOverride", "clearSvgOverrides",
                  "createReliefScope"],
}
for mod, names in WANT.items():
    src = VENDOR / mod
    if not src.exists():
        problems.append(f"FAIL  vendor/{mod} missing")
        continue
    text = src.read_text()
    for n in names:
        check(re.search(rf"export\s+(async\s+)?(function|const|let)\s+{n}\b", text) is not None
              or re.search(rf"export\s*\{{[^}}]*\b{n}\b", text) is not None,
              f"vendor/{mod} exports {n}")

# ── the graph the modules themselves need ────────────────────────────────
# A vendored module that imports a module nobody vendored is a site that does
# not boot, and NOTHING above would say so: the checks are what the PAGES
# import, and a page importing shell.js is happy whether or not shell.js can
# resolve its own imports. refresh-assets.sh copies a hand-written list, so the
# day upstream splits a module out - fields.js, the shared colour rule, was
# exactly this - the refresh passes, the contract passes, and every page 404s
# on the first import. Walked here instead of listed, because a list is the
# thing that was already wrong.
IMPORT = re.compile(r"""^\s*(?:import|export)\b[^'"]*from\s*['"]\./([\w.-]+\.js)['"]""",
                    re.M)
for src in sorted(VENDOR.glob("*.js")):
    for dep in sorted(set(IMPORT.findall(src.read_text()))):
        check((VENDOR / dep).exists(),
              f"vendor/{src.name} can resolve ./{dep}",
              "add it to the module list in refresh-assets.sh")

# ── the 3D rack seats a face the way the kit does ────────────────────────
# A DEVICE'S FACE IS SEATED BY ONE RULE, and the rack must not keep a second
# copy of it. site/rack3d.js used to run the sequence itself - applyAllOverrides
# for the bays, then applyOccupantOverrides for `cages[view]` - and that list is
# the DEVICE's cages, read from configs.json before any card is seated. Two
# things went wrong with it and neither said anything:
#
#   - A cage on a card is not in that list. On the Nokia 7360 FX shelves the
#     list is EMPTY on every view, because every cage there lives on a card, so
#     `cages.length` was 0 and applyOccupantOverrides was never even called. An
#     optic seated in `nt-a/module/qsfp-2` appeared in 2D and not in 3D.
#   - The rack visited only the views viewsToRewrite named, so a swapped
#     cassette's BACK never reached the rear face: fhd-1ufce has bays on front
#     only, and its rear face carries the `data-rear-of` holes that show them.
#
# swap.js owns both rules now - `seatViews` walks every face, uses `faceCages`
# to read the cages off the face AFTER the bays settle, and seats the rear
# holes. Asserted structurally because the behaviour needs WebGL and CI has no
# GPU: the rack must call it, and must not hand-roll the pass again.
rack = (HERE / "site" / "rack3d.js").read_text()
check("seatViews" in rack,
      "site/rack3d.js seats faces through swap.js's seatViews",
      "the rack is hand-rolling the face pass again - a cage on a seated card "
      "will be skipped in 3D and the rear holes never re-seated")
check(not re.search(r"\bapplyOccupantOverrides\s*\(", rack),
      "site/rack3d.js does not seat cages itself",
      "applyOccupantOverrides called directly means the cage list is the "
      "device's own, not faceCages' - nested cages are silently dropped")

# ── the showcase is modules, not one file ────────────────────────────────
# showcase.js was 1213 lines holding seven tabs over shared globals. A stage
# or a spoke that needs the drawing imports it; it does not reach for a global
# that happens to be in scope. Asserted on the file layout because the
# behaviour needs a browser and this check must stay under a second.
art = HERE / "site" / "showcase" / "artifact.js"
check(art.is_file(), "site/showcase/artifact.js exists",
      "the artifact layer has not been extracted yet")
if art.is_file():
    a = art.read_text()
    for name in ("loadDrawing", "setDrawing", "panZoom", "setExports", "setPanel", "setHost"):
        check(f"export function {name}" in a or f"export async function {name}" in a,
              f"artifact.js exports {name}",
              f"{name} is still private to showcase.js")

# ── report ───────────────────────────────────────────────────────────────
if problems:
    print("contract: %d checks passed, %d FAILED" % (len(notes), len(problems)))
    for p in problems:
        print("  " + p)
    print("\nEither this site needs updating for a deliberate change over there,")
    print("or something drifted that was not meant to. Both are worth knowing now")
    print("rather than when a page renders wrong.")
    sys.exit(1)

print(f"contract: {len(notes)} checks passed")
