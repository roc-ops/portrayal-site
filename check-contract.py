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
