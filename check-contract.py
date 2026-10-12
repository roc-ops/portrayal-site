#!/usr/bin/env python3
"""What this site needs from Portrayal, asserted rather than assumed.

The drawings are rebuilt over there constantly. When
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
skips = []   # checks that could not run here, printed by name so a pass never hides one


def check(cond, what, detail=""):
    (notes if cond else problems).append(
        f"{'ok  ' if cond else 'FAIL'}  {what}{('  — ' + detail) if detail and not cond else ''}")
    return cond


# THE NAMES IN A JS `{a, b as c}` LIST. `side` 0 is the name the other module
# knows (an import's source name), -1 the name this one does (an export's
# public name). Split on `as` between any whitespace: `split(" as ")` read
# `a\n  as b`, or two spaces, as one name, "a\n  as b", which no module
# exports and nothing matches - and comments inside the braces as names.
_JS_COMMENT = re.compile(r"/\*.*?\*/|//[^\n]*", re.S)
_JS_AS = re.compile(r"\s+as\s+")


def js_names(group, side):
    return {_JS_AS.split(n.strip())[side].strip()
            for n in _JS_COMMENT.sub("", group).split(",") if n.strip()}


check(js_names("a,\n  b\tas\n  c,  d  as  e, // why\n  f /* old */ as g,\n", 0) == {"a", "b", "d", "f"}
      and js_names("a,\n  b\tas\n  c,  d  as  e, // why\n  f /* old */ as g,\n", -1) == {"a", "c", "e", "g"}
      and js_names("alias, basket as last", 0) == {"alias", "basket"},
      "an import or export list is read name by name: `as` across a line break, a tab or two spaces, "
      "comments, a trailing comma, and names that only contain `as`")


def face_file(idx, cfg, view):
    """The file that draws `view` of configuration `cfg` (Portrayal #670): the
    kit's faceFile, in Python. A drawing is written once and shared by every
    configuration that draws it identically, so the name is looked up in
    configs[].files, falling back to the one the build wrote before #670."""
    for c in (idx or {}).get("configs", []):
        if isinstance(c, dict) and c.get("name") == cfg and (c.get("files") or {}).get(view):
            return c["files"][view]
    return f"{(idx or {}).get('device')}.{cfg}.{view}.svg"


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
    "swap.js": ["applyOverrides", "applyFaceOverrides"],
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

# ── the Runbook is retired, and the four 2D lenses are spokes ────────────
# THE RUNBOOK IS RETIRED. Its content was hand-written, AS7726-specific MOP
# prose rather than a lens over compiled data, so no stage regenerates it. A
# half-retirement - the module gone and the button still shipping, or the
# reverse - is the failure worth guarding, so both sides are asserted.
idx = (HERE / "index.html").read_text()
check('data-tab="runbook"' not in idx, "index.html has no Runbook tab button")
for f in sorted((HERE / "site" / "showcase").rglob("*.js")) + [HERE / "site" / "showcase.js"]:
    check("runbook" not in f.read_text().lower(),
          f"{f.relative_to(HERE)} has no Runbook reference",
          "the tab is retired; a dangling reference is a half-retirement")

# The four 2D lenses are spokes now - reached from a device in the rack, not
# siblings in a tab strip. Each is its own file and takes the device as an
# argument, because the same lens is used on four different devices.
for s in ("callouts", "state", "select"):
    p = HERE / "site" / "showcase" / "spokes" / f"{s}.js"
    check(p.is_file(), f"spoke {s}.js exists", "not re-homed yet")
    if p.is_file():
        check("export default function" in p.read_text(),
              f"spoke {s}.js default-exports a factory",
              "a spoke must take {dev, cfg} so it can serve more than one device")

# INSPECT IS EXPLORER, IN A FRAME. The inline lens could not remove a part,
# swap a module or show 3D; Explorer can, so the lens is Explorer in a
# same-origin frame, seeded with the rack's swaps and spoken to only through
# window.portrayalEmbed.
sh = (HERE / "site" / "showcase" / "spoke-host.js").read_text()
check(not (HERE / "site" / "showcase" / "spokes" / "inspect.js").exists(),
      "the inline Inspect lens is gone; Inspect is Explorer in a frame")
check(re.search(r"inspect:\s*\{[^}]*frame:\s*true", sh) is not None,
      "spoke-host's Inspect lens is a frame lens")
check("encodeSwaps(" in sh and "swap=" in sh,
      "the Inspect frame carries the rack's swaps via encodeSwaps")
# AND NO swap= IS HAND-ROLLED. Every swap= in the code (comments aside) must be
# `swap=${v}` where v is the one variable holding encodeSwaps(...) - not a
# second encoder, not a URLSearchParams key (which would re-escape what
# encodeSwaps already escaped), not string concatenation.
sh_code = re.sub(r"(?m)^\s*//.*$", "", sh)                    # whole-line comments
sh_code = re.sub(r"(?<![:'\"])//[^\n'\"`]*$", "", sh_code, flags=re.M)  # trailing ones
enc_vars = re.findall(r"\b(?:const|let|var)\s+(\w+)\s*=\s*encodeSwaps\(", sh_code)
uses = [m.group(0) for m in re.finditer(r"swap=\S{0,24}", sh_code)]
bad_uses = [u for u in uses
            if not (len(enc_vars) == 1 and re.match(r"swap=\$\{" + re.escape(enc_vars[0]) + r"\}", u))]
check(len(enc_vars) == 1 and bool(uses) and not bad_uses
      and not re.search(r"URLSearchParams\([^)]*\bswap\b", sh_code)
      and not re.search(r"\.(?:set|append)\(\s*['\"]swap['\"]", sh_code),
      f"every swap= in spoke-host.js is the encodeSwaps result, appended raw ({len(uses)} use(s))",
      f"encodeSwaps variables {enc_vars}; swap= uses {uses}; not from it: {bad_uses}; "
      "a swap key handed to URLSearchParams or set()/append() would also fail this")
check(".contentWindow" not in sh.replace("contentWindow?.portrayalEmbed", "").replace("contentWindow.portrayalEmbed", ""),
      "spoke-host reaches into the frame only through portrayalEmbed")

# ── the stage rail ───────────────────────────────────────────────────────
# THE RAIL'S STAGE LIST IS NAMED, NOT GLOBBED - the same rule PAGES follows in
# check-browser.py, and for the same reason: a stage added should be a line in
# a diff, and a stage that goes away should fail this check rather than quietly
# stop being reachable. So the list and the directory must agree exactly.
rail = (HERE / "site" / "showcase" / "stage-rail.js")
check(rail.is_file(), "site/showcase/stage-rail.js exists")
if rail.is_file():
    r = rail.read_text()
    m = re.search(r"export const STAGES\s*=\s*\[(.*?)\]", r, re.S)
    check(bool(m), "stage-rail.js declares STAGES", "the rail needs an explicit order")
    if m:
        listed = re.findall(r"'([a-z0-9-]+)'", m.group(1))
        on_disk = sorted(p.stem.split("-", 1)[1]
                         for p in (HERE / "site" / "showcase" / "stages").glob("*.js"))
        check(sorted(listed) == on_disk,
              "the rail's STAGES match the stage modules on disk",
              f"listed {sorted(listed)} but found {on_disk}")
        check(len(listed) == 7, "there are seven stages", f"found {len(listed)}")

# Every stage is real now, so no stage file - nor the rail itself - may still
# carry the "not built yet" placeholder. A fallback that outlives its purpose
# turns a missing stage into a blank panel instead of an error.
unbuilt = [p.name for p in sorted((HERE / "site" / "showcase" / "stages").glob("*.js"))
           if "not built yet" in p.read_text()]
if rail.is_file() and "not built yet" in rail.read_text():
    unbuilt.append(rail.name)
check(not unbuilt, "no stage file has an unbuilt-stage fallback",
      f"found the placeholder in {unbuilt} - all seven stages exist now")

# ── spokes: a device, a lens, and the way back ───────────────────────────
# A SPOKE IS A RENDERER SWITCH. The lenses drive the inlined 2D face
# (#stage2d); stages 1-3 drive the 3D rack. So opening one swaps renderers,
# and it must go back to the stage it came from - a detour with no way back is
# a dead end. Every check below records whether or not the file exists, so a
# missing spoke-host is counted as failures rather than skipped.
host = HERE / "site" / "showcase" / "spoke-host.js"
h = host.read_text() if host.is_file() else ""
check(host.is_file(), "site/showcase/spoke-host.js exists",
      "the four lenses are re-homed but nothing opens them")
for name in ("openSpoke", "closeSpoke"):
    check(f"export async function {name}" in h or f"export function {name}" in h,
          f"spoke-host.js exports {name}")
check("returnTo" in h, "openSpoke records where to return to",
      "a spoke with no way back is a dead end")

# CALLOUTS, LIVE STATE AND SELECT ARE WRITTEN AGAINST THE AS7726's FRONT FACE.
# They name its paths (port-14, region:mgmt-block, led-psu1/lamp...), so on any
# other device they would ring nothing and toggle nothing. Inspect reads
# whatever the drawing carries, so it is the one lens every device gets. The
# availability table is the single place that decides, so it is read here.
avail = {}
m = re.search(r"export const LENS_DEVICES\s*=\s*\{(.*?)\};", h, re.S)
if m:
    for lens, val in re.findall(r"(\w+)\s*:\s*(\[[^\]]*\]|'\*')", m.group(1)):
        avail[lens] = "*" if val == "'*'" else re.findall(r"'([a-z0-9-]+)'", val)
check(avail.get("inspect") == "*"
      and all(avail.get(l) == ["as7726-32x"] for l in ("callouts", "state", "select")),
      "Callouts, Live state and Select are offered only on as7726-32x; Inspect on every device",
      f"LENS_DEVICES in spoke-host.js reads {avail or 'nothing'}")

# THE FHD-1UFCE OPENS POPULATED. Its `base` is an empty tray; the showcase is
# about what a rack holds, so it opens with its four cassettes - and the
# configuration named must exist in the device's own index.
cast_src = (HERE / "site" / "showcase" / "rack.js").read_text()
m = re.search(r"\{ref:\s*'fhd-1ufce',\s*cfg:\s*'([^']+)'", cast_src)
fhd_cfg = m.group(1) if m else None
check(fhd_cfg == "populated", "the cast FHD-1UFCE opens in its populated configuration",
      f"cfg is {fhd_cfg!r}")
fhd_idx = jload("fhd-1ufce.configs.json") or {}
check(any(c.get("name") == "populated" for c in fhd_idx.get("configs", [])),
      "fhd-1ufce's index carries a 'populated' configuration")

# THE CAST IS VENDORED. Stages 1-3 and 6 mount five devices named in
# rack.js's CAST, and a cast device whose index or face is missing does not
# fail anything visible: loadMeta drops it from the rack and the stage paints
# a rack one device short. So each cast ref needs its configs.json and the
# compiled front face of its cast configuration - the cfg written in CAST, or
# the index's own `default` where CAST gives none. Records on every run: a
# CAST this cannot read is itself a failure, not a skipped check.
rack_js = HERE / "site" / "showcase" / "rack.js"
m = re.search(r"export const CAST\s*=\s*\[(.*?)\];", rack_js.read_text() if rack_js.is_file() else "", re.S)
cast = []
if m:
    for body in re.findall(r"\{([^}]*)\}", m.group(1)):
        ref = re.search(r"\bref\s*:\s*'([^']+)'", body)
        cfg = re.search(r"\bcfg\s*:\s*'([^']+)'", body)
        if ref:
            cast.append((ref.group(1), cfg.group(1) if cfg else None))
if not cast:
    check(False, "rack.js's CAST names the cast devices",
          "could not parse `export const CAST = [...]` in site/showcase/rack.js"
          if rack_js.is_file() else "site/showcase/rack.js is missing")
else:
    missing = []
    for ref, cfg in cast:
        idx_path = DIST / f"{ref}.configs.json"
        if not idx_path.is_file():
            missing.append(idx_path.name)
            continue
        if cfg is None:
            try:
                cfg = json.loads(idx_path.read_text()).get("default")
            except Exception as e:
                missing.append(f"{idx_path.name} unreadable ({e})")
                continue
        _ff = face_file(json.loads(idx_path.read_text()), cfg, "front") if cfg else None
        if not cfg or not (DIST / _ff).is_file():
            missing.append(_ff or f"{ref}.{cfg}.front.svg")

    # THE CAST IS FIVE, BOTTOM-UP, AND THE COPPER SWITCH SITS BETWEEN THE SERVER
    # AND THE 100G SWITCH (patching spec §3). Stage 4's plan cables the server and
    # every management port to it, so a cast without it has nowhere to land them.
    check([r for r, _ in cast] == ["asr-9006", "r740xd", "eps201", "as7726-32x", "fhd-1ufce"],
          "the cast is the five patched devices, bottom-up",
          f"CAST is {[r for r, _ in cast]}")
    check(dict(cast).get("eps201") == "ac-f2b",
          "the AS4630-54TE is cast front-to-back, matching the AS7726-32X",
          f"eps201 cfg is {dict(cast).get('eps201')!r}")

    check(not missing,
          f"the cast is vendored: {len(cast)} devices, each with its index and front face",
          f"missing {missing} - loadMeta would drop the device and the rack comes up short")

# STAGES THAT MOUNT THE RACK GO THROUGH rack.js's mount3d, which wraps
# guard3d. A stage that calls createRackScene directly loses the WebGL guard,
# and the symptom is the scrim never coming down - which reads as a slow build
# rather than a browser with acceleration switched off.
offenders = [p.name for p in sorted((HERE / "site" / "showcase" / "stages").glob("*.js"))
             if "createRackScene" in p.read_text()]
check(not offenders, "no stage calls createRackScene directly",
      f"{offenders} - mount through rack.js's mount3d so guard3d still wraps it")

# A STAGE WRITES THE SHARED UI THROUGH ITS LEASE, NEVER DIRECTLY. The rail
# hands each enter() a lease (stage-rail.js) whose setPanel, setExports and
# scrim are no-ops once that entry is stale. A stage importing setPanel,
# setExports or the loading scrim from artifact.js has stepped round it - the
# stale-panel defect recurred four times under per-caller guards exactly like
# that - and one reading the rail's global `epoch` can capture a CURRENT epoch
# in a click handler on a panel that is not current, which is how a stale
# seat looked fresh. Both are asserted on every run, whatever is on disk.
BANNED = {"setPanel", "setExports", "loading"}
IMPORT_FROM = re.compile(r"import\s*\{([^}]*)\}\s*from\s*['\"]([^'\"]+)['\"]", re.S)
stage_files = sorted((HERE / "site" / "showcase" / "stages").glob("*.js"))
direct, epoch_readers = [], []
for p in stage_files:
    for names, src in IMPORT_FROM.findall(p.read_text()):
        got = js_names(names, 0)
        if src.endswith("/artifact.js") and got & BANNED:
            direct.append(f"{p.name}: {sorted(got & BANNED)}")
        if src.endswith("/stage-rail.js") and "epoch" in got:
            epoch_readers.append(p.name)
check(bool(stage_files) and not direct,
      f"no stage imports setPanel, setExports or loading directly ({len(stage_files)} stages)",
      f"{direct or 'no stage files found'} - write through the lease enter(ui) is given")
check(bool(stage_files) and not epoch_readers,
      "no stage reads the rail's global epoch",
      f"{epoch_readers or 'no stage files found'} - capture ui.mine / ui.live() from the lease instead")

# A LENS REDRAWS THROUGH THE `redraw` ITS SPOKE HANDS IT, bound to that
# spoke's lifetime, so a lens control that outlives its spoke is refused
# before it touches the stage. A lens importing setDrawing has stepped round
# that.
lens_direct = [p.name for p in sorted((HERE / "site" / "showcase" / "spokes").glob("*.js"))
               if any(src.endswith("/artifact.js") and "setDrawing" in names
                      for names, src in IMPORT_FROM.findall(p.read_text()))]
check(not lens_direct, "no lens calls artifact.js's setDrawing itself",
      f"{lens_direct} - use the redraw spoke-host.js passes in")

# STAGE 2's WHOLE CLAIM IS THAT THE BAY KNOWS WHAT IT ACCEPTS - so the
# accepted list has to come from the compiled index, not from a list this page
# invents. A hardcoded accepts array here would be the page fabricating the
# answer it is meant to demonstrate.
pop = (HERE / "site" / "showcase" / "stages" / "02-populate.js")
if pop.is_file():
    s = pop.read_text()
    check("baysOf" in s, "stage 2 reads the bays from the index",
          "the accepted list must come from the manifest, not from this page")
    check(not re.search(r"accepts\s*[:=]\s*\[", s),
          "stage 2 does not hardcode an accepted list",
          "found an inline accepts array - that is the page fabricating data")
    # Each slot offers its OWN accepts: pooling the group's lists back into
    # one menu is the old refusal demo, which read as a broken dropdown.
    check(not re.search(r"flatMap\(\s*\w+\s*=>\s*\w+\.accepts", s),
          "stage 2 offers each slot only its own accepts",
          "found accepts pooled across bays - a slot would offer cards it refuses")
    # The set headings are the cards' roles from the component index, not
    # names written here.
    check("attrs?.role" in s and not re.search(r"['\"](Route switch processors|Line cards)['\"]", s),
          "stage 2 heads each slot set with its cards' role from the index",
          "a hardcoded heading would be the page naming hardware it should read")

# STAGE 3'S WHOLE CLAIM IS THAT SPEED AND LANES ARE NOT ON THE GENERIC OPTIC -
# a speed table here would be the page inferring the one fact the component
# index withholds. speeds.yaml and pluggables.yaml belong upstream; a second
# copy here would drift from them silently.
opt = (HERE / "site" / "showcase" / "stages" / "03-optics.js")
if opt.is_file():
    s = opt.read_text()
    check(not re.search(r"(100G|400G|25G)\s*['\"]?\s*:", s),
          "stage 3 does not keep its own speed table",
          "speeds belong to the component index; a copy here will drift")
    check(not re.search(r"100GE?\b|lanes\s*[:=]\s*4\b", s),
          "stage 3 does not quietly infer 100G or 4 lanes",
          "R15: the generic optic carries no speed or lane count - showing that gap is the point")

# ── one rail, drawn twice ──────────────────────────────────────────────────
# The 2D rails and the 3D posts were two ideas of a rail. The right 2D rail
# was a copy of the left instead of its mirror, so its numbers sat inside and
# its holes outside. rails.js now holds the only description, and neither
# renderer may keep its own. It is the kit's since 0.3.0 (kit/rack/rails.js).
rails = HERE / "vendor" / "rack" / "rails.js"
rtxt = rails.read_text() if rails.is_file() else ""
check(bool(rtxt), "vendor/rack/rails.js exists", "the rail has no single description")
for name in ("RU", "RAIL_W", "OPENING", "HOLE_CC", "HOLE_DY", "HOLE_SQUARE", "HOLE_ROUND", "HOLE_SIZE", "SIDES"):
    check(re.search(rf"export const {name}\b", rtxt) is not None,
          f"rails.js exports {name}", "missing")
shim = (HERE / "site" / "showcase" / "rails.js")
check(shim.is_file() and "export * from '../../vendor/rack/rails.js'" in shim.read_text()
      and "export const" not in shim.read_text(),
      "site/showcase/rails.js only re-exports vendor/rack/rails.js",
      "the rail has a second description")
# THE MIRROR, STRUCTURALLY (spec §6). SIDES is computed from the constants
# above; recompute it here from the same numbers and hold its shape, so a
# right rail that copies the left instead of mirroring it fails here. On
# each side, outward from the opening: inner edge, hole centres, number
# centres, outer edge - |inner| < |hole| < |number| < |outer|.
def rails_num(name):
    m = re.search(rf"export const {name}\s*=\s*([0-9.]+)", rtxt)
    return float(m.group(1)) if m else None
r_open, r_w, r_cc = rails_num("OPENING"), rails_num("RAIL_W"), rails_num("HOLE_CC")
fac = re.search(r"number:\s*s\s*\*\s*\(OPENING / 2 \+ RAIL_W \* ([0-9.]+)\)", rtxt)
mirror_bad = []
if None in (r_open, r_w, r_cc) or not fac:
    mirror_bad.append("could not read OPENING/RAIL_W/HOLE_CC or the number factor from rails.js")
else:
    for side, sgn in (("left", -1), ("right", 1)):
        g = {"inner": sgn * r_open / 2, "outer": sgn * (r_open / 2 + r_w),
             "hole": sgn * r_cc / 2, "number": sgn * (r_open / 2 + r_w * float(fac.group(1)))}
        a = {k: abs(v) for k, v in g.items()}
        if not (a["number"] > a["hole"] > a["inner"] and a["number"] < a["outer"]):
            mirror_bad.append(f"{side}: {g}")
        if any((v > 0) != (sgn > 0) for v in g.values()):
            mirror_bad.append(f"{side} is not on its own side of the centre line: {g}")
check(not mirror_bad,
      "rails.js SIDES mirror: on each side |number| > |hole| > |inner| and |number| < |outer|",
      "; ".join(mirror_bad))
rack_js = (HERE / "site" / "showcase" / "rack.js").read_text()
check("from './rails.js'" in rack_js, "rack.js draws its rails from rails.js")
check(not re.search(r"const\s+(RAIL|INNER)\s*=", rack_js),
      "rack.js keeps no rail constants of its own",
      "RAIL/INNER belong to rails.js")
check("0.22" not in rack_js and "0.78" not in rack_js,
      "rack.js has no non-EIA hole fractions", "holes must come from HOLE_DY")

r3d = (HERE / "site" / "rack3d.js").read_text()
check("from '../vendor/rack/rails.js'" in r3d, "rack3d.js draws its rails from rails.js")
check(not re.search(r"\[\s*6\.35\s*,\s*22\.22", r3d),
      "rack3d.js keeps no hole positions of its own", "HOLE_DY belongs to rails.js")

# ── the 2D/3D switch ───────────────────────────────────────────────────────
# 2D is the default and the product; 3D is a second view of the same data.
# One switch for the whole ladder, remembered across stages and visits.
sr = (HERE / "site" / "showcase" / "stage-rail.js").read_text()
check("export async function setMode" in sr, "stage-rail.js exports setMode")
check("portrayal.showcase.mode" in sr, "the mode is persisted under its key")
check("function readMode" in sr
      and re.search(r"===\s*'3d'\s*\?\s*'3d'\s*:\s*'2d'", sr) is not None
      and re.search(r"catch\s*\{\s*return\s+'2d'", sr) is not None,
      "the mode defaults to 2D, including when storage is unreadable",
      "readMode must return '2d' unless storage says '3d', and '2d' when it throws")
# R11: a stage whose enter() throws gets its scrim cleared and a one-line
# panel message, and is never marked ready.
es = sr[sr.find("async function enterStage"):sr.find("export async function setMode")]
check(re.search(r"try\s*\{\s*await MODULES\[name\]\.enter\(", es) is not None
      and "loading.hidden = true" in es[es.find("catch"):]
      and "This stage could not be drawn." in es,
      "enterStage catches a throwing enter(): clears the scrim and says so in the panel")
idx_html = (HERE / "index.html").read_text()
check('id="stageMode"' in idx_html, "index.html carries the 2D/3D switch")

# ── look closer: on the drawing, with an index strip ───────────────────────
# It used to sit 400 px down a side panel clipped at 520 px. Now it is the
# drawing itself (2D) plus an always-visible strip under the stage (2D and 3D).
sh = (HERE / "site" / "showcase" / "spoke-host.js").read_text()
check("export function renderStrip" in sh, "spoke-host.js exports renderStrip")
check("export function wireDevices" in sh, "spoke-host.js exports wireDevices")
check('id="lookStrip"' in (HERE / "index.html").read_text(), "index.html carries the look strip")
stage_txt = "".join(p.read_text() for p in (HERE / "site" / "showcase" / "stages").glob("*.js"))
# ONE CLICK HELPER. The cast devices and the ROADM ring's stubs once carried
# two copies of the pointer logic, and the stubs' copy lost the double-click
# window. The cast devices and the patched rack's cross-face tags both go
# through svg2d.js's wireClicks; neither keeps its own.
s2d = (HERE / "site" / "showcase" / "svg2d.js").read_text()
pv_src = (HERE / "site" / "showcase" / "patch-view.js").read_text()
check("export function wireClicks" in s2d and "dblMs" in s2d,
      "svg2d.js exports wireClicks, with a double-click window")
own = [n for n, t in (("spoke-host.js", sh), ("patch-view.js", pv_src))
       if "wireClicks(" not in t or "'pointerdown'" in t]
check(not own, "wireDevices and the cable tags both click through wireClicks",
      f"{own} keep their own pointer handling")
check("lookCloser(" not in stage_txt, "no stage puts Look closer in its side panel")

# Stage 3: an older buildPanel (awaiting an uncached skin) must not paint
# over a newer one - a cage switched while the skin loads keeps its panel.
opt = (HERE / "site" / "showcase" / "stages" / "03-optics.js").read_text()
bp = opt[opt.find("async function buildPanel"):opt.find("async function doSeat")]
bl = bp.splitlines()
after_await = [bl[i + 1].strip() for i, l in enumerate(bl[:-1]) if re.search(r"=\s*await\b", l)]
check("++buildSeq" in bp and after_await and all("current()" in l for l in after_await),
      "stage 3's buildPanel paints only when it is the newest build",
      "every post-await check in buildPanel must ask my === buildSeq")

# ── a download is what its title says ────────────────────────────────────
# panZoom rewrites the live viewBox, so a copy of the live node is the crop
# the visitor last zoomed to. standalone() writes panZoom's recorded base
# frame onto the clone instead, for every export at once; no stage keeps a
# private workaround (stage 6's elevationText swapped the live viewBox).
art = (HERE / "site" / "showcase" / "artifact.js").read_text()
svg_export = (HERE / "site" / "svg-export.js").read_text()
check("node.__ptBase = baseFrame" in art and "__ptBase?.()" in svg_export,
      "exports use panZoom's base frame, not the current crop",
      "panZoom must record its base frame and standalone() must apply it to the clone")
check("elevationText" not in stage_txt,
      "no stage keeps its own un-zoom workaround for exports")

# ── explorer's embed mode ────────────────────────────────────────────────
# EXPLORER'S EMBED MODE. The showcase's Inspect lens is Explorer in a frame;
# it talks to the frame only through window.portrayalEmbed.
ex = (HERE / "explorer.html").read_text()
check("get('embed') === '1'" in ex or 'get("embed") === "1"' in ex,
      "explorer.html reads ?embed=1")
# Held against the FROZEN OBJECT ITSELF, not the page: "ready", "setMode" and
# "current" all appear in explorer.html for other reasons, so a bare substring
# test would pass with the embed API gone. The block is the one guarded by
# EMBED; each key must be a property of the object it freezes.
emb = re.search(r"if\s*\(EMBED\)\s*\{[\s\S]*?window\.portrayalEmbed\s*=\s*Object\.freeze\(\{([\s\S]*?)\n\s*\}\);", ex)
check(bool(emb), "explorer.html freezes window.portrayalEmbed inside its EMBED block",
      "no `if (EMBED) { ... window.portrayalEmbed = Object.freeze({ ... });` found")
for k in ("ready", "setMode", "current"):
    check(bool(emb) and re.search(rf"(?m)^\s*{k}\s*:", emb.group(1)) is not None,
          f"explorer.html's frozen portrayalEmbed has a {k} property",
          "the embed block is missing" if not emb else f"no `{k}:` in the frozen object")

# ── the sponsor credit ───────────────────────────────────────────────────
# RocNet Supply's one ask for Portrayal going open source (roc-ops/Portrayal#446)
# is a visible credit: the text, linked, with its logo - both variants, served
# from here rather than hotlinked (roc-ops/portrayal-site#25).
SPONSOR = "https://www.rocnetsupply.com/"
LOGOS = ["brand/sponsor/RocNet-Primary-Logo.svg", "brand/sponsor/RocNet-Primary-Logo-white.svg"]
for logo in LOGOS:
    lp = HERE / logo
    check(lp.is_file() and b"<script" not in lp.read_bytes(),
          f"the sponsor logo {logo} is served locally and carries no script",
          "missing, or it grew a <script>")
for page in ("index.html", "schema.html"):
    s = (HERE / page).read_text()
    foot = re.search(r"<footer[\s\S]*?</footer>", s)
    f = foot.group(0) if foot else ""
    link = re.search(r'<a class="footer-sponsor" href="([^"]+)">([\s\S]*?)</a>', f)
    check(bool(link) and link.group(1) == SPONSOR and "Sponsored by RocNet Supply" in link.group(2)
          and all(f'src="{l}"' in link.group(2) for l in LOGOS),
          f"{page}'s footer credits RocNet Supply, linked, with both local logos",
          "the credit, its link or a logo variant is missing from the footer")
hot = sorted(str(p.relative_to(HERE)) for p in HERE.glob("*.html")
             if re.search(r"""(src|href)=["']https?://(www\.)?rocnetsupply\.com/hubfs""", p.read_text()))
check(not hot, "no page hotlinks RocNet's logo", f"hotlinked from {hot}")

# ── the patching plan (stages 4-5) ───────────────────────────────────────
# An INVENTED plan, labelled as such, whose every end is proven here against
# the compiled faces - that is what keeps "invented" from becoming "made up".
PLAN = HERE / "site" / "showcase" / "patching.json"
plan, plan_err = None, ""
try:
    plan = json.loads(PLAN.read_text())
except Exception as e:
    plan_err = str(e)
check(plan is not None, "patching.json parses", plan_err)
comps = {f"{c['ns']}/{c['name']}@{c['major'][1:]}": c
         for c in json.loads((DIST / "components.json").read_text())["components"]}

def face_text(dev, view):
    idx = json.loads((DIST / f"{dev}.configs.json").read_text())
    cfg = dict(cast).get(dev) or idx.get("default")
    for name in (face_file(idx, cfg, view), f"{dev}.{view}.svg"):
        if (DIST / name).is_file():
            return (DIST / name).read_text()
    return ""

def skin_text(ref):
    ns, rest = ref.split("/")
    name, major = rest.split("@")
    hits = sorted((DIST / "components").glob(f"{ns}--{name}--v{major}--*.svg"))
    return hits[0].read_text() if hits else ""

def port_tag(text, path):
    """The opening tag of a port element with that data-path, carrying a
    connection point - or None."""
    m = re.search(r'<g [^>]*data-path="%s"[^>]*data-class="port"[^>]*>' % re.escape(path), text)
    if not m:
        return None
    tail = text[m.end():m.end() + 4000]
    return m.group(0) if "data-cp=" in tail else None

def end_tag(dev, path, view, seats):
    """The port element a plan end lands on, as its opening tag, or None."""
    if "/module/" in path:                       # below a bay: the seated card's skin,
        bay, rest = path.split("/module/", 1)     # if the plan seats one there -
        ref = seats.get(dev, {}).get(bay)          # otherwise it's already part of the
        if ref:                                     # cast config's own compiled face
            return port_tag(skin_text(ref), f"{comps[ref]['name']}/{rest}") or port_tag(skin_text(ref), rest)
        return port_tag(face_text(dev, view), path)
    return port_tag(face_text(dev, view), path)

def resolves(dev, path, view, seats):
    return end_tag(dev, path, view, seats) is not None

if plan:
    seats = plan.get("seats", {})
    cast_refs = [r for r, _ in cast]
    check(all(d["id"] in cast_refs and d["ref"] == d["id"] for d in plan.get("devices", [])),
          "every plan device is a cast device", str(plan.get("devices")))
    links = plan.get("links", [])
    check(len(links) == 14, "the plan has its fourteen cables", f"{len(links)}")
    bad_ends = [e for l in links for e in (l["from"], l["to"])
                if not resolves(e[0], e[1], e[2] if len(e) > 2 else "front", seats)]
    check(not bad_ends, "every plan end is a drawn port with a connection point", str(bad_ends))
    check(all(l.get("media") in ("os2", "copper") for l in links),
          "every link's media is os2 or copper", str({l.get("media") for l in links}))
    check(all(l.get("purpose") in ("uplink", "core", "server", "management") for l in links),
          "every link names its purpose", str({l.get("purpose") for l in links}))
    # A fiber end is a connector the plan seats: an optic with its two plugs,
    # or a duplex plug in an adapter. Every seat must be one its cage accepts.
    def cage_accepts(dev, key):
        idx = json.loads((DIST / f"{dev}.configs.json").read_text())
        dev_cages = {c["id"]: c for v in (idx.get("cages") or {}).values() for c in v}
        bays = {b["id"]: b for v in (idx.get("bays") or {}).values() for b in v}
        if key in dev_cages: return dev_cages[key].get("accepts") or []
        if key in bays: return bays[key].get("accepts") or []
        if "-occupant/" in key:                  # a plug in an optic's cage
            host, bore = key.rsplit("-occupant/", 1)
            opt = seats.get(dev, {}).get(host)
            return next((c.get("accepts") or [] for c in comps.get(opt, {}).get("cages") or []
                         if c.get("id") == bore), [])
        if "/module/" in key:                    # a card's or cassette's own cage
            bay, rest = key.split("/module/", 1)
            card = seats.get(dev, {}).get(bay)
            if not card:                         # the cast config's own module: the one it names
                cfg = next(c for c in idx["configs"] if c["name"] == dict(cast)[dev])
                # (the FHD's cassettes), else the bay's default (the R740xd's NDC)
                card = (cfg.get("bays") or {}).get(bay) or (bays.get(bay) or {}).get("default")
            return next((c.get("accepts") or [] for c in comps.get(card, {}).get("cages") or []
                         if c.get("id") == rest), [])
        return []
    refused = [(d, k, r) for d, ss in seats.items() for k, r in ss.items() if r not in cage_accepts(d, k)]
    check(not refused, "every plan seat is one its cage or bay accepts", str(refused))
    # EVERY END SEATS A CONNECTOR, fiber and copper alike: an optic (whose
    # plugs follow it) or a duplex plug for fiber, an RJ45 plug for copper
    # (Portrayal #610). A cable lands on what the plan seats, never a bare jack.
    unseated = [e for l in links for e in (l["from"], l["to"]) if e[1] not in seats.get(e[0], {})]
    check(not unseated, "every end seats a connector", str(unseated))
    RJ45_PLUG = "generic/rj45-plug@1"
    copper_bad = [(e[0], e[1], seats.get(e[0], {}).get(e[1])) for l in links if l["media"] == "copper"
                  for e in (l["from"], l["to"])
                  if seats.get(e[0], {}).get(e[1]) != RJ45_PLUG or RJ45_PLUG not in cage_accepts(e[0], e[1])]
    check(not copper_bad, "every copper end seats an RJ45 plug its jack accepts", str(copper_bad))
    # Spec §8: MEDIA MATCHES AT BOTH ENDS. An os2 end is a cage that takes
    # the LC-faced QSFP (on the device, or on the card the plan seats), or an
    # FHD adapter that takes the LC duplex plug; a copper end is a port the
    # compiled face or card skin marks data-media="rj45".
    FIBER_TAKES = ("generic/qsfp-lc@1", "generic/qsfp-lc@2", "generic/lc-duplex-plug@2")
    def media_ok(media, end):
        dev, path = end[0], end[1]
        if media == "os2":
            return any(r in cage_accepts(dev, path) for r in FIBER_TAKES)
        if media == "copper":
            tag = end_tag(dev, path, end[2] if len(end) > 2 else "front", seats) or ""
            return 'data-media="rj45"' in tag
        return False
    mismatched = [(l["media"], e[0], e[1]) for l in links for e in (l["from"], l["to"])
                  if not media_ok(l["media"], e)]
    check(not mismatched, "media matches at both ends of every plan cable", str(mismatched))
else:
    for what in ("every plan device is a cast device", "the plan has its fourteen cables",
                 "every plan end is a drawn port with a connection point",
                 "every link's media is os2 or copper", "every link names its purpose",
                 "every plan seat is one its cage or bay accepts", "every end seats a connector",
                 "every copper end seats an RJ45 plug its jack accepts",
                 "media matches at both ends of every plan cable"):
        check(False, what, "patching.json is missing or unreadable")

# Stage 4 cables THIS rack now, not the ROADM ring: cables.js draws them from
# the kit's own cablePoints, and the stage keeps no colors of its own.
# The geometry lives in site/rack/ since the Rack Builder shares it; the
# showcase's old address is a re-export and holds no code of its own, so the
# hero's and patch-view.js's imports (checked further down) still resolve.
CAB = HERE / "site" / "rack" / "cables.js"
cab = CAB.read_text() if CAB.is_file() else ""
check("export function drawCables2d" in cab and "cablePoints" in cab,
      "cables.js draws 2D cables from the kit's cablePoints", "missing")
SHIM = HERE / "site" / "showcase" / "cables.js"
shim = SHIM.read_text() if SHIM.is_file() else ""
check("export * from '../rack/cables.js';" in shim and "function" not in shim,
      "site/showcase/cables.js only re-exports site/rack/cables.js",
      "the showcase file is missing, or defines code of its own")
s4 = (HERE / "site" / "showcase" / "stages" / "04-cable.js").read_text()
check("ring.js" not in s4 and "ring2d.js" not in s4 and "labs.json" not in s4 and "loadLab" not in s4,
      "stage 4 no longer reads the ROADM ring", "04-cable.js still imports the ring")
check("not a real lab" in (HERE / "site" / "showcase" / "patch-view.js").read_text()
      if (HERE / "site" / "showcase" / "patch-view.js").is_file() else False,
      "the patched stages say the plan is invented", "no honesty line in patch-view.js")
# NO COLORS OF THEIR OWN: every color a cable is drawn in comes from
# cables.js's COLORS/colorOf. So the files that draw or light the plan -
# stage 4, stage 5 and patch-view.js - carry no color literal (#rrggbb or longer,
# 0xrrggbb, rgb()/hsl()) and never define COLORS or colorOf again;
# and rack3d.js's cable code this branch added (cableAnchor through
# deviceBoxes) carries no color literal or `color:` at all. rack3d.js's
# older hex colors, which predate the cables, are out of scope.
COLOR_LIT = re.compile(r"#[0-9a-fA-F]{6}|\b0x[0-9a-fA-F]{6}\b|\b(?:rgba?|hsla?)\(")
COLOR_DEF = re.compile(r"\b(?:const|let|var|function)\s+(?:COLORS|colorOf)\b")
colored = []
for rel in ("stages/04-cable.js", "stages/05-filter.js", "patch-view.js"):
    f = HERE / "site" / "showcase" / rel
    t = f.read_text() if f.is_file() else ""
    if COLOR_LIT.search(t) or COLOR_DEF.search(t):
        colored.append(rel)
r3d_all = (HERE / "site" / "rack3d.js").read_text()
m = re.search(r"async function cableAnchor.*?\n  function disposeTree", r3d_all, re.S)
if not m or COLOR_LIT.search(m.group(0)) or re.search(r"\bcolor\s*:", m.group(0)):
    colored.append("rack3d.js cableAnchor/deviceBoxes" + ("" if m else " (not found)"))
check(not colored, "the patched stages keep no colors of their own",
      f"colors belong to cables.js: {colored}")

# Stage 5 filters the same plan, on axes read off it: a purpose or media
# added to patching.json gets its own button without 05-filter.js changing.
s5 = (HERE / "site" / "showcase" / "stages" / "05-filter.js").read_text()
check("countsBy" in s5 and not re.search(r"""['"`](uplink|core|server|management|os2|copper)['"`]""", s5),
      "stage 5's filters are read off the plan", "a hardcoded purpose or media in 05-filter.js")
check("ring.js" not in s5 and "ring2d.js" not in s5 and "labs.json" not in s5,
      "stage 5 no longer reads the ROADM ring", "05-filter.js still imports the ring")
check(not (HERE / "site" / "showcase" / "ring.js").exists() and not (HERE / "site" / "showcase" / "ring2d.js").exists(),
      "the ROADM ring's showcase code is retired", "ring.js or ring2d.js still present")

# Stage 4 in 3D: the tubes start on the kit's connector points through
# rack3d.js's own face->room chain, and their geometry lives in cables.js.
r3d = (HERE / "site" / "rack3d.js").read_text()
check("async function cableAnchor" in r3d and "cablePoints" in r3d and "function deviceBoxes" in r3d,
      "rack3d.js anchors cables on the kit's connector points", "cableAnchor/deviceBoxes missing")
PV = HERE / "site" / "showcase" / "patch-view.js"
check(PV.is_file() and not re.search(r"TubeGeometry|CatmullRom", PV.read_text()),
      "patch-view.js leaves the cable geometry to cables.js", "tube geometry in patch-view.js")

# ── the schema page keeps up with the schemas ─────────────────────────────
# The schema FILES cannot drift: refresh-assets.sh copies them over on every
# sync. What drifts is the page that renders them. It knew every keyword in use
# and still never descended into a map, so `views`, `configurations` and
# `groups` - 146 of the device schema's 230 properties - were missing from a
# page whose headline promised it "cannot drift". These are the halves of that
# promise a file can check; check-browser.py checks that every property in the
# files is actually on the page.
import schemawalk
SJS = (HERE / "site" / "schema.js").read_text()
SHTML = (HERE / "schema.html").read_text()
docs = schemawalk.documents()
alldocs = schemawalk.all_documents()
sources = set(re.findall(r"url:\s*'assets/schemas/([^']+)'", SJS))
# One of the pair may be staged ahead of the sync that brings it: Portrayal #677
# replaces overlay.schema.json with listing.schema.json, and the page hides the
# tab of whichever the site does not carry.
_nos_pair = {"overlay.schema.json", "listing.schema.json"}
check(bool(docs) and set(docs) <= sources and sources - set(docs) <= _nos_pair
      and len(_nos_pair & set(docs)) == 1,
      f"schema.js renders every vendored schema ({len(docs)})",
      f"vendored {sorted(docs)}, SOURCES names {sorted(sources)} - a schema "
      "added upstream needs an entry in SOURCES and a tab in schema.html")
keys = set(re.findall(r"^\s*(\w+):\s*\{url:", SJS, re.M))
tabs = set(re.findall(r'data-schema="([^"]+)"', SHTML))
check(keys == tabs, "schema.html has one tab per SOURCES entry",
      f"tabs {sorted(tabs)}, SOURCES {sorted(keys)}")
WORDS = {2: "Two", 3: "Three", 4: "Four", 5: "Five", 6: "Six"}
n_word = re.search(r"\b(Two|Three|Four|Five|Six) documents:", SHTML)
check(bool(n_word) and n_word.group(1) == WORDS.get(len(alldocs)),
      f"schema.html's intro counts {len(alldocs)} documents",
      f"it says {n_word.group(1) if n_word else 'nothing'}")
site_urls = set(re.findall(r"url:\s*'(site/[^']+)'", SJS))
check({f"site/rack/{n}" for n in schemawalk.site_documents()} <= site_urls,
      "schema.js renders every site-owned schema",
      f"site-owned {sorted(schemawalk.site_documents())}, SOURCES names {sorted(site_urls)}")
kn = re.search(r"const KNOWN = new Set\(\[([\s\S]*?)\]\)", SJS)
known = set(re.findall(r"'([^']+)'", kn.group(1))) if kn else set()
for name, doc in alldocs.items():
    unknown = {k: at for k, at in schemawalk.keywords(doc).items() if k not in known}
    check(bool(known) and not unknown,
          f"schema.js renders every keyword {name} uses",
          "new upstream: " + ", ".join(f"{k} (first at {at})" for k, at in sorted(unknown.items()))
          + " - teach site/schema.js to render it, then add it to KNOWN")
# KNOWING A KEYWORD IS NOT RENDERING WHAT IS UNDER IT. `if` was in KNOWN for
# as long as the schemas used it, and schema.js drew an `if` as a sentence and
# never descended into it - so when component.schema.json's `kind: kit`
# condition (Portrayal #905) put a property under /if, the keyword check passed
# and the page lost the property; only the browser's property count caught it.
# Every keyword a property's pointer passes through must be one schema.js
# builds a `${ptr}/<keyword>` pointer for.
_through = set()
for name, doc in alldocs.items():
    for ptr in schemawalk.property_pointers(doc):
        segs, i = ptr.split("/")[1:], 0
        while i < len(segs):
            kw = segs[i]
            _through.add(kw)
            i += 1 if kw in schemawalk.SINGLE else 2   # a map key or a list index follows the others
_combined = "${ptr}/${kw}" in SJS
_undrawn = sorted(k for k in _through & (set(schemawalk.MAPS) | set(schemawalk.LISTS) | set(schemawalk.SINGLE))
                  if k != "$defs" and not re.search(r"\$\{ptr\}/" + re.escape(k) + r"\b", SJS)
                  and not (_combined and k in schemawalk.LISTS and f"'{k}'" in SJS))
check(not _undrawn, "schema.js descends into every keyword a property sits under",
      f"no ${{ptr}}/<kw> pointer for {_undrawn} - the rows under them are not on the page")

# ── the hero: a cabled switch ────────────────────────────────────────────
# The front page's hero is the S9600 with real parts seated in it (spec
# 2026-09-26-hero-cabled-switch §3-§4): no colored marks, no text badges, no
# floating callout, and every link in its table seats parts the drawing's
# cages actually accept.
hero = (HERE / "site" / "hero-reveal.js").read_text()
# The table is the kit's (kit/rack/cable-geometry.js); cables.js re-exports it.
cab = (HERE / "vendor" / "rack" / "cable-geometry.js").read_text()
check(re.search(r"\bJACKETS\b[^;]*from '\.\./\.\./vendor/rack/cable-geometry\.js'",
                (HERE / "site" / "rack" / "cables.js").read_text()) is not None
      and re.search(r"export const JACKETS\s*=\s*\{", cab) is not None
      and all(re.search(rf"\b{k}\s*:", cab.split("export const JACKETS", 1)[-1][:400]) for k in ("mm", "sm", "dac", "cu")),
      "cables.js names the four jacket colors the hero draws (mm, sm, dac, cu)",
      "no JACKETS export with mm/sm/dac/cu")
check("pt-mark" not in hero and "pt-label" not in hero,
      "the hero draws no colored port marks or text badges", "pt-mark/pt-label still in hero-reveal.js")
check((not re.search(r"callout", hero, re.I) or "no floating callout" in hero)
      and "reveal-call" not in hero,
      "the hero has no floating callout", "a callout is still built in hero-reveal.js")
# Every row seats real parts its cage accepts (spec §7), read off the dist.
s96 = json.loads((DIST / "s9600-72xc.configs.json").read_text())
cage_acc = {c["id"]: c.get("accepts") or [] for v in s96.get("cages", {}).values() for c in v}
comp_by = {f"{c['ns']}/{c['name']}@{c['major'][1:]}": c
           for c in json.loads((DIST / "components.json").read_text())["components"]}
rows = re.findall(r"'([a-z0-9-]+)':\s*\{[^}]*?seat:\s*\{([^}]*)\}[^}]*?jacket:\s*'([a-z]+)'", hero, re.S)
bad_hero = []
for port, seat, jacket in rows:
    pairs = dict(re.findall(r"'([^']+)':\s*'([^']+)'", seat))
    if not pairs:
        bad_hero.append(f"{port}: seats nothing")
    for key, ref in pairs.items():
        if ref not in comp_by:
            bad_hero.append(f"{port}: {ref} is not a component"); continue
        if "-occupant/" in key:
            host, bore = key.rsplit("-occupant/", 1)
            opt = pairs.get(host)
            ok = any(c.get("id") == bore and ref in (c.get("accepts") or [])
                     for c in (comp_by.get(opt, {}).get("cages") or []))
        else:
            ok = ref in cage_acc.get(key, [])
        if not ok:
            bad_hero.append(f"{port}: {key} does not accept {ref}")
    if jacket not in ("mm", "sm", "dac", "cu"):
        bad_hero.append(f"{port}: jacket {jacket}")
# EXACTLY 21: the walk holds the page to one cable and one tube per link (21),
# so a row the parse misses - or one added without the walk's count moving -
# fails here by name, not as a count mismatch in the browser.
check(len(rows) == 21 and not bad_hero, "every hero link (21) seats real parts its cage accepts, with a jacket",
      f"{len(rows)} rows parsed, expected 21; {bad_hero[:5]}")
# Cable colors come from cables.js's colorOfJacket (Task 1): the hero keeps
# no color table and no jacketColor stand-in of its own. (The hero keeps its
# LAMP colors - those are lamp states, not cables.)
check(re.search(r"import\s*\{[^}]*\bcolorOfJacket\b[^}]*\}\s*from\s*'\./showcase/cables\.js'", hero) is not None
      and re.search(r"\bjacketColor\b", hero) is None
      and "JACKETS = {" not in hero and "COLORS = {" not in hero,
      "the hero's cable colors come from cables.js's colorOfJacket",
      "no colorOfJacket import from ./showcase/cables.js, a jacketColor left behind, or a jacket/color table of its own")

# ── the hero in 3D ───────────────────────────────────────────────────────
# The same switch, cabled, as a model (spec §5). Every check below records
# whether or not the files exist, so a missing panel fails by name.
idx_html = (HERE / "index.html").read_text()
h3_path = HERE / "site" / "hero-3d.js"
h3 = h3_path.read_text() if h3_path.exists() else ""
r3d = (HERE / "site" / "rack3d.js").read_text()
panel = re.search(r'<div[^>]*\bid="hero-3d"[^>]*>.*?</div>\s*(<p[^>]*>)?', idx_html, re.S)
check(panel is not None and re.search(r'<p[^>]*\bid="hero-caption-3d"[^>]*\bdata-hero-caption\b', panel.group(0)) is not None,
      "index.html has the 3D panel #hero-3d with its caption #hero-caption-3d[data-hero-caption] in or just under it",
      "no #hero-3d, or no #hero-caption-3d[data-hero-caption] in or right after it")
# DYNAMICALLY: a static import that fails to load (or throws while it
# evaluates) fails the whole module script, and the 2D hero with it. Loaded
# with import(), a broken 3D module costs only the 3D panel.
check(re.search(r"import\(\s*'\./site/hero-3d\.js'\s*\)\s*\.then\([^)]*\bheroThree\b", idx_html) is not None
      and re.search(r"import\s*\{[^}]*\}\s*from\s*'\./site/hero-3d\.js'", idx_html) is None,
      "index.html loads site/hero-3d.js with import() and calls heroThree, with no static import of it",
      "hero-3d.js imported statically, or no import('./site/hero-3d.js').then(... heroThree ...)")
check(re.search(r"\bcreateRackScene\b", h3) is not None and "IntersectionObserver" in h3
      and re.search(r"\brails\s*:\s*false\b", h3) is not None,
      "hero-3d.js builds through createRackScene, lazily (IntersectionObserver), with rails: false",
      "site/hero-3d.js missing, or no createRackScene / IntersectionObserver / rails: false")
check(re.search(r"import\s*\{[^}]*\bhangPoints3d\b[^}]*\bcolorOfJacket\b[^}]*\}\s*from\s*'\./showcase/cables\.js'", h3) is not None
      or re.search(r"import\s*\{[^}]*\bcolorOfJacket\b[^}]*\bhangPoints3d\b[^}]*\}\s*from\s*'\./showcase/cables\.js'", h3) is not None,
      "hero-3d.js takes its tubes' shape and colors from cables.js",
      "no hangPoints3d/colorOfJacket import from ./showcase/cables.js")
check(re.search(r"import\s*\{[^}]*\bcaptionOf\b[^}]*\}\s*from\s*'\./hero-reveal\.js'", h3) is not None
      and re.search(r"\bjacketColor\b", h3) is None and "COLORS" not in h3,
      "hero-3d.js takes its captions from hero-reveal.js and keeps no color table of its own",
      "no captionOf import from ./hero-reveal.js, a jacketColor left behind, or a COLORS table of its own")
# THE 3D BUILD WAITS ITS TURN: after the 2D hero has settled and the browser
# is idle (requestIdleCallback), and on a narrow screen only once the panel is
# actually on screen (rootMargin 0px under max-width 700px). check-browser.py
# holds the order; this holds the idle wait and the narrow-screen margin.
check("requestIdleCallback" in h3
      and re.search(r"matchMedia\(\s*'\(max-width:\s*700px\)'\s*\)", h3) is not None
      and re.search(r"'0px'", h3) is not None,
      "hero-3d.js waits for an idle moment and uses rootMargin 0px on narrow screens (max-width 700px)",
      "no requestIdleCallback, or no matchMedia('(max-width: 700px)') with a '0px' rootMargin in hero-3d.js")
check(re.search(r"opts\.rails\s*(?:!==\s*false|\?\?\s*true)", r3d) is not None,
      "rack3d.js reads opts.rails, defaulting to true", "no opts.rails in createRackScene")

# The 2D and 3D heroes stand in one studio: site.css's --hero-studio (the
# 2D backdrop) must be hero-3d.js's STUDIO.
_css = (HERE / "site" / "site.css").read_text()
_h3 = (HERE / "site" / "hero-3d.js").read_text()
_c2 = re.search(r"--hero-studio:\s*#([0-9A-Fa-f]{6})", _css)
_c3 = re.search(r"const STUDIO = 0x([0-9A-Fa-f]{6})", _h3)
check(bool(_c2 and _c3) and _c2.group(1).lower() == _c3.group(1).lower(),
      "the 2D hero's studio backdrop is the 3D hero's studio color",
      f"--hero-studio {_c2 and _c2.group(1)} vs STUDIO {_c3 and _c3.group(1)}")

# ── the kit page ─────────────────────────────────────────────────────────
# kit.html shows each example's own file and runs that same file, importing the
# kit the way an embedder would: `@portrayal/kit/<module>`, mapped by the page's
# import map onto ./vendor/<module>.js. A sync that renames or removes anything
# an example uses fails here, before a reader meets a broken recipe.
_kit = (HERE / "kit.html")
_kit_html = _kit.read_text() if _kit.exists() else ""
check(bool(_kit_html), "kit.html exists", "no kit.html")
_im = re.search(r'<script type="importmap">\s*(\{.*?\})\s*</script>', _kit_html, re.S)
_imap = json.loads(_im.group(1))["imports"] if _im else {}
_kitmods = {k.split("/", 2)[2]: v for k, v in _imap.items() if k.startswith("@portrayal/kit/")}
check(bool(_kitmods) and all(v == f"./vendor/{m}.js" and (VENDOR / f"{m}.js").exists()
                             for m, v in _kitmods.items()),
      "kit.html's import map sends every @portrayal/kit/<module> to an existing ./vendor/<module>.js",
      f"{_kitmods}")
check(_imap.get("three") == "./vendor/three/three.module.js"
      and _imap.get("three/addons/") == "./vendor/three/addons/",
      "kit.html's import map resolves three and three/addons/ to the vendored copy", f"{_imap}")
_exdir = HERE / "site" / "kit-examples"
_exfiles = sorted(p.stem for p in _exdir.glob("*.js")) if _exdir.exists() else []
_listed = re.findall(r'data-example="([^"]+)"', _kit_html)
check(bool(_exfiles) and sorted(_listed) == _exfiles and len(set(_listed)) == len(_listed),
      "kit.html lists every example in site/kit-examples/ exactly once, and nothing else",
      f"files {_exfiles} vs listed {_listed}")

def _exports(mod):
    t = (VENDOR / f"{mod}.js").read_text()
    names = set(re.findall(r"^export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)", t, re.M))
    for grp in re.findall(r"^export\s*\{([^}]*)\}", t, re.M):
        names |= js_names(grp, -1)
    return names

for _stem in _exfiles:
    _src = (_exdir / f"{_stem}.js").read_text()
    check(re.search(r"^export\s+async\s+function\s+run\s*\(\s*host\s*\)", _src, re.M) is not None,
          f"kit example {_stem} exports async function run(host)", "no `export async function run(host)`")
    check(re.search(r"from\s+'(?:\.\.?/)+(?:vendor|site)/", _src) is None,
          f"kit example {_stem} imports the kit by package name, never by path",
          "a ./vendor or ./site path import")
    check("const DIST = 'assets/dist/';" in _src or "DIST" not in _src,
          f"kit example {_stem} names where the compiled files live as const DIST", "no const DIST = 'assets/dist/';")
    for _names, _mod in re.findall(r"import\s*\{([^}]*)\}\s*from\s*'@portrayal/kit/([\w/-]+)'", _src):
        _want = js_names(_names, 0)
        _have = _exports(_mod) if _mod in _kitmods else set()
        check(_mod in _kitmods and _want <= _have,
              f"kit example {_stem}: @portrayal/kit/{_mod} exports {sorted(_want)}",
              f"missing {sorted(_want - _have)}" if _mod in _kitmods else "module not in kit.html's import map")
# THE RUNNER KEEPS ONE FAILURE IN ITS OWN PANE: run() is awaited inside a try,
# and the catch writes data-error, so a throwing recipe cannot take the others down.
_kp = (HERE / "site" / "kit-page.js")
_kps = _kp.read_text() if _kp.exists() else ""
check(re.search(r"try\s*\{(?:(?!catch).)*?await\s+mod\.run\(", _kps, re.S) is not None and "dataset.error" in _kps,
      "kit-page.js runs each example inside try/catch and records data-error",
      "no try { … await mod.run( … } with dataset.error")

_frame = (HERE / "kit-frame.html")
_fh = _frame.read_text() if _frame.exists() else ""
_fm = re.search(r'<script type="importmap">\s*(\{.*?\})\s*</script>', _fh, re.S)
check(bool(_fm) and json.loads(_fm.group(1))["imports"] == _imap and "<base" not in _fh,
      "kit-frame.html sits beside kit.html and carries the same import map",
      "the frame's import map differs from kit.html's, or it has a <base> (jdist resolves against location, not <base>)")

# THE "GETTING THE FILES" MAP MUST WORK WITH THE RECIPES AS WRITTEN: every
# @portrayal/kit/<module> a recipe imports is a key of the snippet's map, and
# each maps to a .js file. A folder mapping ("@portrayal/kit/": "…/") resolves
# @portrayal/kit/dist to …/dist, with no .js - a 404 for anyone who copies it.
# The snippet that IS the import map: the section also shows `npm install`.
import html as _html
# A snippet is a <pre> whose class list has kit-snippet, whatever else the tag
# carries, around a <code>. Either quote ends an import's module name.
_SNIPPET = re.compile(r'<pre\b[^>]*\bclass="[^"]*(?<![\w-])kit-snippet(?![\w-])[^"]*"[^>]*>\s*<code\b[^>]*>(.*?)</code>\s*</pre>', re.S)
_KIT_FROM = re.compile(r"""from\s*['"](@portrayal/kit/[\w/-]+)['"]""")
_KIT_IMPORT = re.compile(r"""import\s*\{([^}]*)\}\s*from\s*['"]@portrayal/kit/([\w/-]+)['"]""")


def kit_snippets(page):
    """(the page's kit-snippet blocks as text, what could not be read). The
    second list is what makes the first trustworthy: a block the pattern did
    not match, or a mention of @portrayal/kit/ in a snippet that is not an
    `import {names} from` line, is code the checks below would pass unread."""
    blocks = [_html.unescape(s) for s in _SNIPPET.findall(page)]
    unread = []
    if len(blocks) != page.count("kit-snippet"):
        unread.append(f"kit-snippet is written {page.count('kit-snippet')} times and {len(blocks)} blocks were read "
                      '- each must be <pre class="kit-snippet"><code>...</code></pre>')
    for b in blocks:
        if "importmap" in b:
            continue
        said, read = b.count("@portrayal/kit/"), len(_KIT_IMPORT.findall(b))
        if said != read:
            unread.append(f"a snippet names @portrayal/kit/ {said} times and {read} were read as "
                          f"`import {{names}} from '@portrayal/kit/<module>'`: {b.strip().splitlines()[0][:70]}")
    return blocks, unread


_snippets, _snip_unread = kit_snippets(_kit_html)
_snip = next((s for s in _snippets if "importmap" in s), None)
_snipmap = {}
if _snip:
    _raw = _snip
    _js = re.search(r"\{.*\}", _raw, re.S)
    try: _snipmap = json.loads(_js.group(0))["imports"] if _js else {}
    except ValueError: _snipmap = {}
# THE PAGE'S OWN SNIPPETS COUNT TOO. A <pre class="kit-snippet"> is code a
# reader copies, exactly like a recipe, but nothing runs it: the rack section
# names resolveRoute, ringMarks, solidsOf and the rest only there. So the
# modules a snippet imports must be in the map as well, and (below, once the
# kit's package.json is read) every name a snippet imports must be exported.
check(len(_snippets) >= 4 and not _snip_unread,
      f"every kit-snippet on kit.html was read, and every @portrayal/kit/ module one names is an import line "
      f"that was parsed ({len(_snippets)} blocks)",
      "; ".join(_snip_unread) or f"only {len(_snippets)} blocks read")
_used = set()
for _stem in _exfiles:
    _used |= set(_KIT_FROM.findall((_exdir / f"{_stem}.js").read_text()))
_snip_used = {u for s in _snippets for u in _KIT_FROM.findall(s)}
_unmapped = sorted(u for u in _used | _snip_used if not (u in _snipmap and _snipmap[u].endswith(".js")))
check(bool(_used) and not _unmapped,
      "the 'Getting the files' import map resolves every @portrayal/kit module the recipes and the page's "
      "snippets import, to a .js file",
      f"not mapped to a .js file: {_unmapped}; recipes use {sorted(_used)}, snippets {sorted(_snip_used)}")


def kit_import_problems(src, exports_of):
    """What is wrong with the `import {names} from '@portrayal/kit/<module>'`
    lines in `src`: a module the kit does not export (exports_of gives None),
    or a name the module does not export."""
    out = []
    for names, mod in _KIT_IMPORT.findall(src):
        have = exports_of(mod)
        want = js_names(names, 0)
        if have is None:
            out.append(f"@portrayal/kit/{mod} is not a module the vendored kit exports")
        elif want - have:
            out.append(f"@portrayal/kit/{mod} does not export {sorted(want - have)}")
    return out
# American English on the kit page, as everywhere in this site's prose.
_kit_prose = _kit_html + _kps + "".join((_exdir / f"{s}.js").read_text() for s in _exfiles)
# ...and the Lint rules page's own words (portrayal-site#159): the page, its
# script and the severity labels. Not the rules: they are Portrayal's text,
# rendered as written.
for _lp in ("lint.html", "site/lint-page.js", "site/lintcodes.js"):
    _kit_prose += (HERE / _lp).read_text() if (HERE / _lp).exists() else ""
_brit = sorted(set(re.findall(r"\b(\w*(?:utilis|behaviour|colour|centre|favourite|recognis|organis)\w*)\b", _kit_prose, re.I)))
check(not _brit, "the kit page, its runner, its recipes and the Lint rules page are in American English", f"{_brit}")

# THE PAGE KEEPS UP WITH THE KIT (#156). The schema page cannot drift - the
# schema files are copied on every refresh and the browser check renders every
# property - but kit.html is written by hand, and it sat at 0.1.0 documenting
# the viewer modules while the site vendored 0.7.0 and the whole rack core.
# refresh-assets.sh copies the kit's package.json to vendor/kit-package.json;
# the page must state its version, and every module in its `exports` must be
# named by a section (data-modules="...") or listed below with the reason it
# is not on the page yet. A kit that adds a module therefore cannot be
# refreshed in without one or the other.
KIT_NOT_DOCUMENTED_YET = {
    "relief": "viewer3d raises parts with it; no recipe calls it on its own",
    "bevel": "viewer3d builds the bevelled chassis with it; no recipe calls it on its own",
    "fields": "the 3D section names viewer.setFields; the module's form helpers (fieldRows, fieldAccepts, encodeFields) have no recipe",
    "share": "the 3D recipe exports GLB and USDZ through viewer.download, which uses it; its own functions have no recipe",
    "gif": "marks.toGif loads it; the annotate section names toGif, but the module's own API has no recipe",
    "devsel": "the shell's device picker uses it; no recipe filters devices on its own",
    "nosnames": "a NOS listing's port names; no recipe yet",
    "optical": "a fibre path's far end; no recipe yet",
    "zones": "the ports and bays of a face in mm, for the diagram exports; no recipe yet",
    "drawio": "draw.io export; the draw.io page (drawio.html) is where the site shows it, with no kit recipe yet",
    "omnigraffle": "OmniGraffle export; shown on drawio.html#omnigraffle, with no kit recipe yet",
}
_kpkg_f = VENDOR / "kit-package.json"
try:
    _kpkg = json.loads(_kpkg_f.read_text())
except Exception as _e:
    _kpkg = {}
    check(False, "vendor/kit-package.json is readable", f"{_e} - run ./refresh-assets.sh")
_kver = _kpkg.get("version") if isinstance(_kpkg.get("version"), str) else ""
_kexp = sorted(k[2:] for k in (_kpkg.get("exports") or {}) if isinstance(k, str) and k.startswith("./"))
# NOT VACUOUS: no exports read, or no sections found, is a failure - an empty
# list is documented by an empty page.
check(_kpkg.get("name") == "@portrayal/kit" and bool(re.fullmatch(r"\d+\.\d+\.\d+(?:-[\w.]+)?", _kver or "")),
      "vendor/kit-package.json is @portrayal/kit's package.json, with a version",
      f"name {_kpkg.get('name')!r}, version {_kver!r} - run ./refresh-assets.sh")
check(len(_kexp) >= 10 and "marks" in _kexp and "rack/editor" in _kexp,
      f"vendor/kit-package.json lists the kit's exports ({len(_kexp)} read)",
      f"read {_kexp}")
# EVERY NAME A SNIPPET IMPORTS IS ONE THE VENDORED KIT EXPORTS. The recipes
# are held to this above; the snippets were not read at all, so a refresh that
# dropped or renamed ringMarks left the page documenting an import that fails.
_snip_imports = [m for s in _snippets for m in _KIT_IMPORT.findall(s)]
_snip_bad = sorted({b for s in _snippets for b in kit_import_problems(
    s, lambda m: _exports(m) if m in _kexp and (VENDOR / f"{m}.js").is_file() else None)})
check(bool(_snip_imports) and not _snip_bad,
      f"every name kit.html's snippets import from @portrayal/kit is exported by the vendored kit "
      f"({len(_snip_imports)} import lines)",
      "; ".join(_snip_bad) or "no kit-snippet imports from @portrayal/kit - has the markup changed?")
_kip = lambda src: kit_import_problems(src, lambda m: {"a", "b"} if m == "rack/m" else None)
_kip_bad = [what for what, got, want in [
    ("a removed export", _kip("import {a, gone} from '@portrayal/kit/rack/m';"), "does not export ['gone']"),
    ("a removed module", _kip("import {a} from '@portrayal/kit/rack/none';"), "rack/none is not a module"),
    ("a renamed import", _kip("import {gone as a} from '@portrayal/kit/rack/m';"), "does not export ['gone']"),
] if not any(want in g for g in got)]
_kip_bad += [f"a good import: {g}" for g in _kip("import {a, b as c} from '@portrayal/kit/rack/m';\nimport {x} from './x.js';")]
check(not _kip_bad,
      "the snippet import check fails a removed export, a removed module and a renamed import, and passes a good one",
      "; ".join(_kip_bad))
# ...and it fails a broken import WHEREVER it is written. Each of these is a
# snippet importing a name the module does not export; the first two were
# passed unread, one for an attribute on the <pre> and one for its quotes.
def _page_problems(page):
    blocks, unread = kit_snippets(page)
    return unread + [b for s in blocks for b in _kip(s)]
_pre = lambda tag, code: f'<p>x</p>\n{tag}<code>{code}</code></pre>\n'
_gone = "import {a, gone} from '@portrayal/kit/rack/m';"
_sn_cases = {
    "an attribute on the <pre>": _pre('<pre class="kit-snippet" data-x>', _gone),
    "double quotes": _pre('<pre class="kit-snippet">', _gone.replace("'", "&quot;")),
    "another class beside it": _pre('<pre class="wide kit-snippet">', _gone),
    "a <pre> with no <code>": '<pre class="kit-snippet">' + _gone + "</pre>",
    "a dynamic import": _pre('<pre class="kit-snippet">', "const m = await import('@portrayal/kit/rack/none');"),
    "a namespace import": _pre('<pre class="kit-snippet">', "import * as m from '@portrayal/kit/rack/none';"),
}
_sn_bad = [name for name, page in _sn_cases.items() if not _page_problems(page)]
_sn_bad += [f"a good page: {b}" for b in _page_problems(
    _pre('<pre class="kit-snippet" data-x>', 'import {a} from "@portrayal/kit/rack/m";\n// a, from the kit')
    + _pre('<pre class="kit-snippet">', "npm install @portrayal/kit three")
    + _pre('<pre class="kit-snippet">', '&lt;script type="importmap"&gt;{"imports": {"@portrayal/kit/rack/m": "m.js"}}'))]
check(not _sn_bad,
      "a broken import in a snippet fails whatever the <pre> carries and whichever quotes it uses, and a snippet "
      "that could not be read is a failure, not a pass",
      "; ".join(_sn_bad))
_said = re.findall(r'data-kit-version="([^"]*)"', _kit_html)
_cdn = re.findall(r"@portrayal/kit@([^/\"'\s]+)/", _kit_html)
check(len(_said) == 1, "kit.html states the kit's version once (data-kit-version)",
      f"found data-kit-version {_said}")
check(bool(_cdn), "kit.html's CDN import map pins @portrayal/kit to a version",
      "no @portrayal/kit@<version>/ URL on the page")
_off = sorted({v for v in _said + _cdn if v != _kver})
check(bool(_kver) and bool(_said) and not _off,
      f"kit.html states the vendored kit's version ({_kver})",
      f"the page also says {_off}; vendor/kit-package.json says {_kver!r} - "
      "update kit.html (data-kit-version and the CDN map) to the vendored kit")

# WHAT NPM HAS. The vendored kit can be ahead of the last release: 0.7.0 was
# vendored while npm's latest was 0.2.0, which has no rack/* at all, so the
# page's `npm install` and CDN map could not deliver what it documents. While
# that is so, #files must carry a note that says it (data-kit-unpublished,
# naming the npm version in data-kit-npm); once the vendored version is
# published, the note must go. Update KIT_NPM_LATEST when a kit release is
# published (`npm view @portrayal/kit version`).
KIT_NPM_LATEST = "0.2.0"
_vt = lambda v: tuple(int(x) for x in re.findall(r"\d+", (v or "").split("-")[0])[:3]) or (0,)
_files_m = re.search(r'<section\s+class="kit-sec"[^>]*\bid="files"[^>]*>(.*?)</section>', _kit_html, re.S)
_files = _files_m.group(1) if _files_m else ""
check(bool(_files_m), "kit.html has its Getting the files section (#files)")
_notes = re.findall(r'<p class="kit-note" data-kit-unpublished>(.*?)</p>', _files, re.S)
_npm_said = re.findall(r'data-kit-npm="([^"]*)"', _kit_html)
# A VERSION IS A WHOLE TOKEN. `"0.15.0" in note` passed a note bumped in one
# place and not the other ("documents 0.15.0 ... until 0.14.0 is published"),
# and passed 0.1.0 inside 10.1.0. Every version the note names is read, and
# they must be exactly the two it is about.
_VERSION = re.compile(r"(?<![\w.])\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?(?!\.?\w)")


def kit_note_problems(notes, npm_said, kver, npm_latest):
    """What is wrong with #files' not-on-npm note(s) while kit `kver` is
    documented and npm's latest is `npm_latest`: [] for one note that names
    those two versions and no other."""
    if not notes:
        return [f"no data-kit-unpublished note - add one to #files, naming {kver} and {npm_latest}, "
                "or update KIT_NPM_LATEST if the kit has been published"]
    out = []
    if len(notes) > 1:
        out.append(f"{len(notes)} data-kit-unpublished notes - keep one")
    if npm_said != [npm_latest]:
        out.append(f"data-kit-npm says {npm_said}, KIT_NPM_LATEST is {npm_latest!r} - they must agree, once")
    for note in notes:
        named = set(_VERSION.findall(note))
        if named != {kver, npm_latest}:
            out.append(f"the note is stale: it names {sorted(named) or 'no version'}, and must name {kver} "
                       f"(documented) and {npm_latest} (npm's latest) and no other version - update the note, "
                       "or KIT_NPM_LATEST if the kit has been published")
    return out


_note = lambda doc, npm: (f'This page documents kit {doc}: npm\'s latest is <span data-kit-npm="{npm}">{npm}</span>. '
                          f'Until {doc} is published, use a checkout.')
_knp_cases = [
    ("no note", ([], [], "0.15.0", "0.2.0"), "add one"),
    ("a half-bumped note", ([_note("0.15.0", "0.2.0").replace("Until 0.15.0", "Until 0.14.0")], ["0.2.0"],
                            "0.15.0", "0.2.0"), "stale"),
    ("a note for the last kit", ([_note("0.14.0", "0.2.0")], ["0.2.0"], "0.15.0", "0.2.0"), "stale"),
    ("a version inside another", ([_note("10.1.0", "0.2.0")], ["0.2.0"], "0.1.0", "0.2.0"), "stale"),
    ("an old npm version", ([_note("0.15.0", "0.2.0")], ["0.2.0"], "0.15.0", "0.3.0"), "KIT_NPM_LATEST is '0.3.0'"),
    ("two notes", ([_note("0.15.0", "0.2.0")] * 2, ["0.2.0"], "0.15.0", "0.2.0"), "keep one"),
]
_knp_bad = [f"{name}: {kit_note_problems(*a)}" for name, a, want in _knp_cases
            if not any(want in s for s in kit_note_problems(*a))]
_knp_bad += [f"a stale note is told to add one: {s}" for s in kit_note_problems(*_knp_cases[1][1]) if "add one" in s]
_knp_bad += [f"a current note: {s}" for s in kit_note_problems([_note("0.15.0", "0.2.0")], ["0.2.0"], "0.15.0", "0.2.0")]
check(not _knp_bad,
      "the not-on-npm note check fails a missing, half-bumped, outdated or doubled note, each in its own words, "
      "and passes a current one",
      "; ".join(_knp_bad))
if _kver and _vt(_kver) > _vt(KIT_NPM_LATEST):
    _note_bad = kit_note_problems(_notes, _npm_said, _kver, KIT_NPM_LATEST)
    check(not _note_bad,
          f"kit.html's #files says the documented kit {_kver} is not on npm (npm's latest is {KIT_NPM_LATEST})",
          "; ".join(_note_bad))
else:
    check(not _notes and not _npm_said,
          f"kit {_kver} is on npm, so kit.html carries no not-on-npm note",
          "remove the data-kit-unpublished note from #files")
_secs = re.findall(r'<section\s+class="kit-sec"[^>]*\bid="([^"]+)"[^>]*>', _kit_html)
_docd = {}
for _tag in re.findall(r'<section\s+class="kit-sec"[^>]*>', _kit_html):
    _mm = re.search(r'\bdata-modules="([^"]*)"', _tag)
    for _mod in (_mm.group(1).split() if _mm else []):
        _docd.setdefault(_mod, []).append(re.search(r'\bid="([^"]+)"', _tag).group(1))
check(len(_secs) >= 8 and len(_docd) >= 5,
      f"kit.html's sections name the modules they document ({len(_secs)} sections, {len(_docd)} modules named)",
      f"sections {_secs}, modules {sorted(_docd)}")
_undoc = [m for m in _kexp if m not in _docd and m not in KIT_NOT_DOCUMENTED_YET]
check(not _undoc,
      "every module the vendored kit exports is documented on kit.html or listed in KIT_NOT_DOCUMENTED_YET",
      f"{_undoc} - document each in a section of kit.html (data-modules) or list it with a reason")
_both = sorted(set(_docd) & set(KIT_NOT_DOCUMENTED_YET))
check(not _both, "no module is both documented on kit.html and listed as not documented yet",
      f"{_both} - take it off KIT_NOT_DOCUMENTED_YET")
_stale = sorted((set(_docd) | set(KIT_NOT_DOCUMENTED_YET)) - set(_kexp)) if _kexp else []
check(not _stale, "kit.html and KIT_NOT_DOCUMENTED_YET name only modules the vendored kit exports",
      f"{_stale} - the kit no longer exports them")
check(all(isinstance(v, str) and len(v) > 10 for v in KIT_NOT_DOCUMENTED_YET.values()),
      "every KIT_NOT_DOCUMENTED_YET entry gives its reason")

# THE DOCS MENU: Schema and Using the kit, one menu, on every page with a nav.
_DOCS_PAGES = ["index.html", "schema.html", "lint.html", "kit.html", "explorer.html", "components.html",
               "annotate.html", "drawio.html", "exporter.html", "drawings.html", "rack.html"]
for _p in _DOCS_PAGES:
    _t = (HERE / _p).read_text()
    _m = re.search(r'<details class="navmenu"[^>]*data-docs[^>]*>(.*?)</details>', _t, re.S)
    _ok = bool(_m) and 'href="schema.html"' in _m.group(1) and 'href="kit.html"' in _m.group(1) \
          and 'href="lint.html"' in _m.group(1) \
          and "<summary>Docs</summary>" in _m.group(1)
    _nav = _t.split("</nav>")[0]
    check(_ok and re.search(r'<a href="schema\.html"[^>]*>Schema</a>', _nav) is None,
          f"{_p}: the header has a Docs menu (Schema, Lint rules, Using the kit) in place of the Schema link",
          "no <details class=navmenu data-docs> with both links, or a bare Schema link left in the nav")

# THE SOURCE MANIFEST, ONCE PER DEVICE (Portrayal #669). A face no longer embeds
# its manifest; it names it by digest (source-sha256), and the manifest is
# <device>.source.json beside the drawings. The kit page's "read the device"
# recipe reads it, so every device in the index must have one, and a face's
# digest must be that file's.
import hashlib as _hl
_devs = [d["name"] for d in jload("devices.json")["devices"]]
_nosrc = [d for d in _devs if not (DIST / f"{d}.source.json").is_file()]
check(not _nosrc, "every device in devices.json has its <device>.source.json",
      f"{len(_nosrc)} missing, e.g. {_nosrc[:3]}")
_s9 = DIST / "s9600-72xc.front.svg"
_m = re.search(r"<metadata>(.*?)</metadata>", _s9.read_text(), re.S) if _s9.exists() else None
_digest = json.loads(_m.group(1)).get("source-sha256") if _m else None
_srcf = DIST / "s9600-72xc.source.json"
check(bool(_digest) and _srcf.is_file() and _hl.sha256(_srcf.read_bytes()).hexdigest() == _digest,
      "s9600-72xc's front face names its source.json by the file's sha256",
      f"digest {_digest!r}")

# THE DCIM EXPORTS COVER THE LIBRARY. refresh-assets.sh regenerates them by
# running Portrayal's exporter; when a stale installed `portrayal` package
# shadowed the clone's (Portrayal #561), the exporter could not find a single
# manifest after #669 and index.json came out empty - with no failure anywhere.
_ex = HERE / "assets" / "exports" / "index.json"
_exi = json.loads(_ex.read_text()) if _ex.exists() else {}
# A device with no console port, interface or module bay exports nothing, on
# purpose: the exporter prints `skip <device>: nothing to export` and
# refresh-assets.sh keeps those names in skipped.json (the first was the Nokia
# outdoor ONT enclosure, Portrayal #768). Such a device has no index entry. It
# is the only excuse: a device in neither file is an export that failed, and a
# skipped list that is more than a twentieth of the library is the #561
# failure again under another name.
_skf = HERE / "assets" / "exports" / "skipped.json"
_skip = set(json.loads(_skf.read_text()).get("nothing-to-export") or []) if _skf.exists() else set()
_nexp = [d for d in _devs if d not in _exi and d not in _skip]
check(not _nexp, "the DCIM exports index has an entry for every device in devices.json "
      "that the exporter did not skip as having nothing to export",
      f"{len(_nexp)} of {len(_devs)} missing, e.g. {_nexp[:3]}")
_both = sorted(_skip & set(_exi)); _stray = sorted(_skip - set(_devs))
check(not _both and not _stray and len(_skip) * 20 <= len(_devs),
      "skipped.json names only devices with no export, and few of them",
      f"{len(_skip)} skipped of {len(_devs)}; also exported: {_both[:3]}; not in devices.json: {_stray[:3]}")

# ONE PLACE NAMES A FACE FILE (Portrayal #670). A drawing is written once and
# shared by every configuration that draws it identically, named after the
# first of them, so `<device>.<config>.<view>.svg` stops existing for most
# configurations. site/faces.js resolves a face through configs[].files; no
# other site code may build a per-configuration face name by hand.
_hand = []
for _f in sorted(list((HERE / "site").rglob("*.js")) + list(HERE.glob("*.html")) + [HERE / "brand" / "build-brand.py"]):
    if _f.name == "faces.js": continue
    _t = _f.read_text()
    for _mm in re.finditer(r"\$\{[^}]+\}\.\$\{[^}]+\}\.\$\{[^}]+\}\.svg[`'\"]|\{[a-z_]+\}\.\{[a-z_]+\}\.\{?[a-z_]*\}?\.?front\.svg|\.base\.front\.svg", _t):
        _hand.append(f"{_f.relative_to(HERE)}:{_t[:_mm.start()].count(chr(10)) + 1}")
check(not _hand, "no site code builds a per-configuration face file name by hand (site/faces.js resolves them)",
      f"{len(_hand)}: " + ", ".join(_hand))

# EVERY CONFIGURATION NAMES ITS FACES (Portrayal #670). configs[].files maps each
# configuration's views to the one file that draws them, and site/faces.js
# resolves through it; a name there with no file behind it is a face the site
# would ask for and 404.
_nofiles, _dangling = [], []
for _cf in sorted(DIST.glob("*.configs.json")):
    for _c in json.loads(_cf.read_text()).get("configs", []):
        if not isinstance(_c, dict): continue
        _fl = _c.get("files")
        if not _fl: _nofiles.append(f"{_cf.name[:-13]}.{_c.get('name')}"); continue
        _dangling += [f for f in _fl.values() if not (DIST / f).is_file()]
check(not _nofiles and not _dangling,
      "every configuration names its faces in configs[].files, and every file named exists",
      f"{len(_nofiles)} without files (e.g. {_nofiles[:3]}), {len(_dangling)} dangling (e.g. {_dangling[:3]})")
# and the site resolves them with the kit's own faceFile once the kit carries it
_vd = (VENDOR / "dist.js").read_text()
_fj = (HERE / "site" / "faces.js").read_text()
check("export function faceFile" not in _vd
      or re.search(r"export\s*\{\s*faceFile\s*\}\s*from\s*'\.\./vendor/dist\.js'", _fj) is not None,
      "site/faces.js re-exports the vendored kit's faceFile rather than keeping its own copy",
      "vendor/dist.js exports faceFile but site/faces.js defines its own")

# WHICH NOS A SOFTWARE VENDOR'S EXPORTS RUN, before and after Portrayal #677.
# #677 replaces per-hardware NOS overlays (overlays.json, exporter --nos) with
# NOS vendor listings (listings.json; --nos removed - passing it is an error).
# tools/nos_platforms.py reads whichever the build has: the exporter flags, and
# the default_platform the DCIM exports are tagged with. Held against both
# shapes here, so the refresh neither aborts nor silently drops the tagging.
import subprocess as _sp, tempfile as _tf
def _nosrun(files):
    with _tf.TemporaryDirectory() as _d:
        for _n, _doc in files.items():
            (Path(_d) / _n).write_text(json.dumps(_doc))
        _run = lambda cmd: _sp.run([sys.executable, str(HERE / "tools" / "nos_platforms.py"), cmd, _d],
                                   capture_output=True, text=True)
        _a, _p = _run("args"), _run("platforms")
        return (_a.returncode, _a.stdout.split(), _p.returncode,
                json.loads(_p.stdout) if _p.returncode == 0 and _p.stdout.strip() else None)
_L = {"listings": {"arrcus/as7726-32x": {"ns": "arrcus", "manufacturer": "Arrcus", "nos": "arcos",
                                          "hardware": "as7726-32x"}}}
_O = {"overlays": {"as7726-32x": {"arcos": {"nos": "arcos", "identity": {"vendor": "Arrcus"}}}}}
_have = (HERE / "tools" / "nos_platforms.py").exists()
check(_have and _nosrun({"listings.json": _L}) == (0, [], 0, {"arrcus": "arcos"}),
      "after #677 (listings.json): no --nos flags, and Arrcus exports are tagged arcos",
      f"{_nosrun({'listings.json': _L}) if _have else 'no tools/nos_platforms.py'}")
check(_have and _nosrun({"overlays.json": _O}) == (0, ["--nos", "arcos"], 0, {"arrcus": "arcos"}),
      "before #677 (overlays.json): --nos arcos, and Arrcus exports are tagged arcos",
      f"{_nosrun({'overlays.json': _O}) if _have else 'no tools/nos_platforms.py'}")
check(_have and _nosrun({}) == (0, [], 0, {}),
      "with neither file, no flags and no tagging - and no failure",
      f"{_nosrun({}) if _have else 'no tools/nos_platforms.py'}")
_ra = (HERE / "refresh-assets.sh").read_text()
_ovr = [l for l in _ra.splitlines() if "overlays.json" in l and not l.lstrip().startswith("#")
        and not l.lstrip().startswith("for f in vendors.json")]
check("tools/nos_platforms.py" in _ra and not _ovr and "listings.json" in _ra,
      "refresh-assets.sh takes NOS flags and platforms from tools/nos_platforms.py, and vendors listings.json",
      f"refresh-assets.sh still reads overlays.json itself ({_ovr}), or does not copy listings.json")

# THE SCHEMA PAGE KNOWS WHICH SCHEMAS EXIST WITHOUT ASKING FOR ONE THAT DOES NOT.
# refresh-assets.sh writes assets/schemas/index.json beside the files it copies;
# schema.js offers a tab per file listed there. Probing for a missing file was a
# 404 on every visit, which the page sweep rightly calls a break.
_six = HERE / "assets" / "schemas" / "index.json"
_listed = json.loads(_six.read_text()).get("schemas") if _six.exists() else None
_vend = sorted(p.name for p in (HERE / "assets" / "schemas").glob("*.schema.json"))
check(_listed == _vend, "assets/schemas/index.json lists exactly the vendored schema files",
      f"index {_listed} vs files {_vend}")
check("index.json" in (HERE / "site" / "schema.js").read_text() and "method: 'HEAD'" not in (HERE / "site" / "schema.js").read_text(),
      "schema.js reads assets/schemas/index.json instead of probing for files",
      "schema.js still probes schema files with HEAD requests")
check("assets/schemas/index.json" in (HERE / "refresh-assets.sh").read_text(),
      "refresh-assets.sh writes assets/schemas/index.json", "no index.json written for the schemas")

# ── the rack builder's catalogue and core: the kit's ─────────────────────
# The catalog grays out what will not fit, which needs every device's RU and
# depth. Portrayal builds that index now (rack_index.py -> dist/rack.json, kit
# 0.3.0) and the site vendors it with the rest of dist; it used to distil its
# own, site/rack/chassis.json, with chassis-index.py.
import os
import importlib.util as _ilu
_rj = HERE / "assets" / "dist" / "rack.json"
_rack = json.loads(_rj.read_text()) if _rj.is_file() else {}
check(_rack.get("format") == 1 and bool(_rack.get("devices")),
      "assets/dist/rack.json is the rack catalogue, format 1",
      f"format {_rack.get('format')!r}, {len(_rack.get('devices') or {})} devices - "
      "rebuild the Portrayal clone ($PORTRAYAL_UPSTREAM) from main and run ./refresh-assets.sh")
_devs = json.loads((HERE / "assets" / "dist" / "devices.json").read_text()).get("devices") or []
check({d["name"] for d in _devs} <= set(_rack.get("devices") or {}),
      "every device in devices.json is in rack.json",
      "rack.json and devices.json are from different builds")

# THE CORE IS THE KIT'S (kit/rack/, vendored into vendor/rack/). Exactly the
# kit's files, byte for byte, at the commit refresh-assets.sh vendored from
# (vendor/rack/SOURCE) - not the clone's HEAD, which moves under a snapshot that
# did not. That needs the upstream clone; without it the check SKIPS out loud.
# Always: every module the site imports, each able to resolve its own imports.
VRACK = VENDOR / "rack"
_vrack = sorted(p.name for p in VRACK.glob("*.js")) if VRACK.is_dir() else []
_srcf = VRACK / "SOURCE"


def source_commit(text):
    """(what vendor/rack/SOURCE says, the commit it names): the first line
    that is not a comment, and that line again only if it is a full 40-hex
    SHA - else "". Only the second is ever handed to git: `HEAD`, a branch or
    a short SHA would resolve in the clone, and the vendored core would then
    be compared with whatever that name points at today."""
    said = next((ln.strip() for ln in text.splitlines() if ln.strip() and not ln.lstrip().startswith("#")), "")
    return said, (said if re.fullmatch(r"[0-9a-f]{40}", said) else "")


_src_said, _src_sha = source_commit(_srcf.read_text() if _srcf.is_file() else "")
check(bool(_src_sha),
      "vendor/rack/SOURCE names the Portrayal commit the rack core was vendored from, as a full SHA",
      f"got {_src_said!r} - run ./refresh-assets.sh")
_sc_full = "0123456789abcdef0123456789abcdef01234567"
_sc_bad = [f"{said!r} was taken as a commit" for said in
           ("HEAD", "main", _sc_full[:12], _sc_full.upper(), "--help", _sc_full + "0", "")
           if source_commit(f"# a comment\n{said}\n")[1]]
_sc_bad += [] if source_commit(f"# a comment\n\n  {_sc_full}\n") == (_sc_full, _sc_full) else ["a full SHA was refused"]
check(not _sc_bad, "only a full 40-hex SHA in vendor/rack/SOURCE is handed to git; HEAD, a branch or a short SHA is not",
      "; ".join(_sc_bad))
# $PORTRAYAL_UPSTREAM, else ../Portrayal beside this repository: the same default
# as refresh-assets.sh and tools/publish-schemas.sh (README, "Where Portrayal is").
_upstream = Path(os.environ.get("PORTRAYAL_UPSTREAM") or (HERE.parent / "Portrayal"))
# Without the caller's GIT_* variables: under a git hook GIT_DIR names THIS
# repository and would override -C, so every upstream commit looked missing.
_git_env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
_git = lambda *a: _sp.run(["git", "-C", str(_upstream), *a], capture_output=True, env=_git_env)
if not (_upstream / ".git").exists():
    skips.append(f"vendor/rack/ holds exactly the kit's rack/*.js - no upstream clone at {_upstream} "
                 "(set PORTRAYAL_UPSTREAM to check the vendored rack core against its source)")
elif not _src_sha:
    check(False, "vendor/rack/ holds exactly the kit's rack/*.js",
          f"vendor/rack/SOURCE says {_src_said or '(nothing)'!r}, which is not a full commit SHA - run ./refresh-assets.sh")
elif _git("cat-file", "-e", f"{_src_sha}^{{commit}}").returncode != 0:
    check(False, "vendor/rack/ holds exactly the kit's rack/*.js",
          f"commit {_src_sha} is not in {_upstream} - git -C {_upstream} fetch, or run ./refresh-assets.sh")
else:
    _ls = _git("ls-tree", "--name-only", f"{_src_sha}:kit/rack")
    _want = sorted(n for n in _ls.stdout.decode().split() if n.endswith(".js"))
    _diff = [f for f in _want if f in _vrack
             and _git("show", f"{_src_sha}:kit/rack/{f}").stdout != (VRACK / f).read_bytes()]
    check(_ls.returncode == 0 and _vrack == _want and not _diff,
          f"vendor/rack/ holds exactly the kit's rack/*.js at {_src_sha[:12]}",
          f"only vendored {sorted(set(_vrack) - set(_want))}, only in kit {sorted(set(_want) - set(_vrack))}, "
          f"contents differ {_diff} - run ./refresh-assets.sh")
# vendor/kit-package.json is the kit's package.json at the same commit, so the
# version and exports kit.html is held to are the ones that were vendored.
if (_upstream / ".git").exists() and _src_sha and _git("cat-file", "-e", f"{_src_sha}^{{commit}}").returncode == 0:
    _pk = _git("show", f"{_src_sha}:kit/package.json")
    check(_pk.returncode == 0 and (VENDOR / "kit-package.json").is_file()
          and _pk.stdout == (VENDOR / "kit-package.json").read_bytes(),
          f"vendor/kit-package.json is kit/package.json at {_src_sha[:12]}", "run ./refresh-assets.sh")
for _m in ("rails", "model", "fit", "managers", "cable-rules", "route-path", "route", "export-data",
           "dcim-rules", "cable-geometry", "catalog", "validate", "commands", "history", "editor", "queries"):
    check(f"{_m}.js" in _vrack, f"vendor/rack/{_m}.js is vendored", "run ./refresh-assets.sh")
_RIMP = re.compile(r"""^\s*(?:import|export)\b[^'"]*from\s*['"](\.\.?/[\w./-]+\.js)['"]""", re.M)
for _f in _vrack:
    for _dep in sorted(set(_RIMP.findall((VRACK / _f).read_text()))):
        check((VRACK / _dep).resolve().is_file(), f"vendor/rack/{_f} can resolve {_dep}",
              "the kit's rack core needs a kit module that is not vendored")

# NO SECOND COPY. A site/rack/ module may re-export a kit name
# (export {...} from '../../vendor/rack/...'), never declare one of its own:
# that is how the site's copies drifted from the kit's before the move.
_DECL = re.compile(r"^\s*export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)", re.M)
_REEXP = re.compile(r"^\s*export\s*\{([^}]*)\}\s*from", re.M)
# A local list, `export {a, b as c}` with no `from`, exports names this module
# declared, so it counts as declaring them (the exported name, after `as`).
_LOCEXP = re.compile(r"^\s*export\s*\{([^}]*)\}(?!\s*from\b)", re.M)
_local_exports = lambda t: sorted(n for g in _LOCEXP.findall(t) for n in js_names(g, -1))
_kit_names = set()
for _f in _vrack:
    _t = (VRACK / _f).read_text()
    _kit_names |= set(_DECL.findall(_t))
    _kit_names |= {n for g in _REEXP.findall(_t) for n in js_names(g, -1)}
    _kit_names |= set(_local_exports(_t))
_redef = sorted(f"{p.name}: {n}" for p in sorted((HERE / "site" / "rack").glob("*.js"))
                for _t in [p.read_text()] for n in _DECL.findall(_t) + _local_exports(_t) if n in _kit_names)
check(bool(_kit_names) and not _redef, "no site/rack module redefines a name the kit's rack core exports",
      "; ".join(_redef) + " - import it from vendor/rack/ (re-export it if others import it from here)")

# RACK-FACE MANAGERS (docs/superpowers/specs/2026-10-07-rack-face-managers-design.md §3):
# the catalog holds the first one, as a 1U sheet part on the rail face, and the
# vendored relief can build a sheet body - without it the part is a solid block
# hiding the ports it serves.
_cat = _rack.get("devices") or {}
_mgr = _cat.get("fhd-cmp5dr", {})
check(_mgr.get("mount") == "rack-face" and _mgr.get("ru") == 1 and _mgr.get("shell") == "sheet",
      "fhd-cmp5dr is in the catalog as a 1U rack-face sheet part",
      "rebuild the Portrayal clone ($PORTRAYAL_UPSTREAM) from main and run ./refresh-assets.sh")
check("sheetShell" in (HERE / "vendor" / "relief.js").read_text(),
      "the vendored relief.js builds sheet bodies",
      "run ./refresh-assets.sh against an upstream main that has #827")

# PATHWAYS (docs/superpowers/specs/2026-10-07-cable-routing-pathways-design.md §3):
# the three FS managers, each with the ids a route can pass through. A ring's
# component is on the top view and its end on the front, so both are indexed.
_g = lambda n, v: (_cat.get(n, {}).get("guides") or {}).get(v, [])
check(all(n in _cat for n in ("fhd-cmp5dr", "cmh-4drb1u", "cmh-sfd1u")),
      "the FHD-CMP5DR, CMH-4DRB1U and CMH-SFD1U are in the catalog",
      "rebuild the Portrayal clone ($PORTRAYAL_UPSTREAM) from main (#852) and run ./refresh-assets.sh")
check(set(_g("fhd-cmp5dr", "top")) >= {f"guide-{i}" for i in range(1, 6)}
      and set(_g("fhd-cmp5dr", "front")) >= {f"guide-{i}" for i in range(1, 6)},
      "fhd-cmp5dr's five rings are indexed on its top and front views",
      "rebuild the Portrayal clone ($PORTRAYAL_UPSTREAM) from main and run ./refresh-assets.sh")
check(bool(_g("cmh-sfd1u", "front")) and bool((_cat.get("cmh-4drb1u", {}).get("passes") or {})),
      "the duct of cmh-sfd1u and the brush pass of cmh-4drb1u are indexed",
      "rebuild the Portrayal clone ($PORTRAYAL_UPSTREAM) from main and run ./refresh-assets.sh")
check(set(_g("cmh-4drb1u", "front")) >= {f"guide-{i}" for i in range(1, 5)},
      "cmh-4drb1u's four D-rings are indexed on its front view",
      "rebuild the Portrayal clone ($PORTRAYAL_UPSTREAM) from main and run ./refresh-assets.sh")
check(_cat.get("fhd-cmp5dr", {}).get("capacity", {}).get("count") == 30,
      "fhd-cmp5dr carries its stated capacity, 30",
      "rebuild the Portrayal clone ($PORTRAYAL_UPSTREAM) from main and run ./refresh-assets.sh")
# THE FS HORIZONTAL MANAGERS (Portrayal #868, portrayal-site#130): every CMH /
# USCMH is rack-mounted on its ears in its own U (not `rack-face`, which is the
# FHD-CMP5DR's place in front of another device), and has its front pathway
# indexed: a duct, or its rings. check_rack_fs_manager_guides then reads them
# back through the route context, with each ring's opening.
_hmgr = sorted(n for n in _cat if re.fullmatch(r"(us)?cmh-[a-z0-9-]+", n))
_hbad = [n for n in _hmgr if _cat[n].get("mount", "rack") != "rack" or not (_cat[n].get("ru") or 0) >= 1
         or not _g(n, "front")]
check(len(_hmgr) >= 23 and not _hbad,
      f"the {len(_hmgr)} FS horizontal managers are rack-mounted in their own U with their front pathway indexed",
      f"{len(_hmgr)} found; wrong mount, no ru or no front guide: {_hbad}")
# THE RING STOPGAP IS GONE (portrayal-site#130): site/rack/route-context.js
# ringGroupsOf reads a ring group by its data-guide="ring" declaration and its
# opening, not by data-group="guides". So no vendored drawing may draw a
# guides group that does not declare itself, or its ring would drop out of
# every route.
_gtag = re.compile(r'<g\b[^>]*\bdata-group="guides"[^>]*>')
_undeclared = sorted({f"{p.name}: {re.search(r'id=\"([^\"]*)\"', t_).group(1) if 'id=' in t_ else '?'}"
                      for p in DIST.glob("*.svg") for _txt in [p.read_text()] if 'data-group="guides"' in _txt
                      for t_ in _gtag.findall(_txt)
                      if 'data-guide="ring"' not in t_ or "data-guide-aperture=" not in t_})
_ring_files = sum(1 for p in DIST.glob("*.svg") if 'data-guide="ring"' in p.read_text())
check(_ring_files > 0 and not _undeclared,
      f"every data-group=\"guides\" group in assets/dist declares data-guide=\"ring\" and its aperture ({_ring_files} drawings with rings)",
      f"undeclared: {_undeclared[:8]} - restore the data-group fallback in route-context.js ringGroupsOf, or fix upstream")

# ── every nav names the Rack Builder ───────────────────────────────────────
for page_name in ("drawings.html", "explorer.html", "components.html", "schema.html",
                  "annotate.html", "drawio.html", "exporter.html", "index.html", "rack.html", "kit.html"):
    p = HERE / page_name
    check(p.is_file() and 'href="rack.html"' in p.read_text(),
          f"{page_name} links the Rack Builder", "the nav is copied by hand; add it there")

# ── what portrayal.dev serves (roc-ops/portrayal-site#58, #61) ────────────────
# wrangler.jsonc's assets.directory is what goes live: public/, which
# tools/build-public.py assembles from tracked files and the deploy workflow
# builds. These read the build's manifest (--list: served path -> source), so
# they check what WILL be served without copying the site to do it. The
# Portrayal README links the hero video and validators dereference the
# schemas' $ids, so both must be there.
_wr = json.loads(re.sub(r"^\s*//.*$", "", (HERE / "wrangler.jsonc").read_text(), flags=re.M))
_bp = _sp.run([sys.executable, str(HERE / "tools" / "build-public.py"), "--list"], capture_output=True, text=True)
_srv = {d: HERE / s_ for d, s_ in (l.split("\t") for l in _bp.stdout.splitlines() if "\t" in l)}
check(_bp.returncode == 0 and len(_srv) > 100, "tools/build-public.py lists what the site serves",
      (_bp.stderr or _bp.stdout)[-300:])
_dy = (HERE / ".github" / "workflows" / "deploy.yml").read_text()
check(_wr["assets"].get("directory") == "./public" and re.search(r"^/public/$", (HERE / ".gitignore").read_text(), re.M)
      and "tools/build-public.py" in _dy,
      "wrangler.jsonc deploys ./public, which is gitignored and built by the deploy workflow",
      f"directory={_wr['assets'].get('directory')!r}; /public/ ignored and built in deploy.yml?")
# NOTHING THAT IS NOT THE SITE: the root carries prototypes, harness pages,
# check scripts, tools and design docs beside the pages.
_PRIVATE = re.compile(r"^(prototypes|tests|tools|docs|hooks|upstream-work|coming-soon|publish|\.github|\.superpowers)/"
                      r"|^[^/]+\.(py|sh|md|jsonc)$|^(marks-harness|viewer3d-harness|compare|schematic)\.html$")
# A page's Markdown copy (index.md beside index.html) is the page, not a doc.
_private = [d for d in _srv if _PRIVATE.search(d) and not (d.endswith(".md") and d[:-3] + ".html" in _srv)]
check(not _private, "the build serves no prototype, harness, check script, tool or doc", f"{_private[:8]}")
# EVERY PAGE A SERVED PAGE LINKS IS SERVED: a page added later and linked from
# a nav, but not added to build-public.py's PAGES, would be a live 404.
_linked = sorted({h for d, f in _srv.items() if d.endswith(".html") and "/" not in d
                  for h in re.findall(r'href="([a-z0-9-]+\.html)(?:#[^"]*)?"', f.read_text())})
check(all(h in _srv for h in _linked), "every page a served page links is served too",
      f"linked but not built: {[h for h in _linked if h not in _srv]}")
check((_srv.get("index.html") or Path()).resolve() == (HERE / "index.html").resolve(),
      "the served front page is the full site's index.html, not the teaser", f"{_srv.get('index.html')}")
_MEDIA = ["hero-3d.mp4", "hero-3d.webm", "hero-3d-poster.jpg", "hero-switch.png"]
check(all(f"media/{m}" in _srv for m in _MEDIA),
      "the site serves the hero media at /media/ - the README links there",
      f"missing {[m for m in _MEDIA if f'media/{m}' not in _srv]}")
_rd = _srv["_redirects"].read_text() if "_redirects" in _srv else ""
check(all(re.search(rf"^/{re.escape(m)}\s+/media/{re.escape(m)}\s+301\b", _rd, re.M) for m in _MEDIA),
      "the old root media paths 301 to /media/", "_redirects lacks a 301 for one of " + ", ".join(_MEDIA))
# EVERY portrayal.dev URL THE PORTRAYAL README LINKS STAYS SERVED (#61). The
# README is on GitHub and npm, where a link cannot be updated once people
# have followed it, so each path it names is pinned here and must be in the
# build: a file as it is, a page as <path>.html (the Worker serves it
# extensionless). With an upstream clone, a link the README gains must be
# added here too, so it is held from then on; without one, that half is a
# named skip and the pinned list is still checked.
# THREE READMES, NOT ONE: the repository's, the kit's (it is the npm page of
# @portrayal/kit) and the components README the first two send people to. A
# path is as written after the host; the bare host is "" and is the front page.
_README_LINKS = ["media/hero-3d.mp4", "components/catalog", "assets/dist/components.json",
                 "schemas/v2/rack.schema.json", "schemas/v3/rack.schema.json"]
_READMES = ["README.md", "kit/README.md", "library/components/README.md"]
_PD_URL = re.compile(r"https://(?:www\.)?portrayal\.dev(?![\w-]|\.\w)(/[^\s)\"'<>\]`]*)?")


def portrayal_dev_paths(text):
    """Every portrayal.dev path `text` links, without query, fragment or the
    punctuation that follows a URL in prose: "" for the site's root."""
    return {m.group(1).rstrip(".,;:").split("#")[0].split("?")[0].strip("/") if m.group(1) else ""
            for m in _PD_URL.finditer(text)}


_shown = lambda paths: ["/" + p for p in sorted(paths)]
_served_as = lambda p: next((c for c in (p, f"{p}.html", f"{p}/index.html" if p else "index.html") if c in _srv), None)
check(all(_served_as(p) for p in _README_LINKS),
      f"the {len(_README_LINKS)} portrayal.dev URLs Portrayal's READMEs link are served",
      f"not built: {_shown(p for p in _README_LINKS if not _served_as(p))}")
_pdp = portrayal_dev_paths("see https://portrayal.dev/components/catalog. Or [the file](https://www.portrayal.dev/"
                           "assets/dist/components.json?x=1#top), `https://portrayal.dev/schemas/v2/rack.schema.json`,"
                           " <https://portrayal.dev/>, https://portrayal.dev and https://portrayal.device/x")
check(_pdp == {"components/catalog", "assets/dist/components.json", "schemas/v2/rack.schema.json", ""}
      and portrayal_dev_paths("It is at https://portrayal.dev. Not https://portrayal.dev.example/x") == {""}
      and portrayal_dev_paths("no link to portrayal.dev here") == set(),
      "a README's portrayal.dev links are read whole: no trailing punctuation, query or fragment, the bare host "
      "as the root even at a sentence's end, and no other host", f"read {_shown(_pdp)}")
# The root README is the one that must link something: no links read from it
# is a pattern that stopped matching, not a README with nothing to hold.
_no_readme = [r for r in _READMES if not (_upstream / r).is_file()]
if _no_readme:
    skips.append(f"the portrayal.dev links in Portrayal's {', '.join(_no_readme)} are all pinned - "
                 f"not found under {_upstream}")
for _rel in (r for r in _READMES if r not in _no_readme):
    _readme_up = _upstream / _rel
    _up_links = portrayal_dev_paths(_readme_up.read_text())
    # The front page is always served (checked above), so the root needs no pin.
    _unpinned = _up_links - set(_README_LINKS) - {""}
    check((bool(_up_links) or _rel != "README.md") and not _unpinned,
          f"every portrayal.dev URL in Portrayal's {_rel} is pinned in _README_LINKS ({len(_up_links)} linked)",
          f"not pinned: {_shown(_unpinned)} - add each to _README_LINKS in check-contract.py, without the "
          "leading slash, and serve it" if _unpinned else f"no portrayal.dev link read from {_readme_up}")
# THE ROLLBACK STILL WORKS: coming-soon/ is kept whole, and its page still
# shows the 3D video from media/, so pointing wrangler.jsonc back at it is a
# one-line change.
_ci = (HERE / "coming-soon" / "index.html").read_text()
check(re.search(r'<video[^>]*>\s*(?:<source[^>]*src="/?media/hero-3d\.(?:webm|mp4)"[^>]*>\s*)+', _ci) is not None
      and not re.search(r'(?:src|poster)="(?!/?media/)[^"]*hero-(?:3d|switch)', _ci),
      "the teaser (the rollback) still shows the 3D video, loading its hero media from media/",
      "no <video> sourced from media/, or a hero src/poster outside media/")
check(_wr["assets"].get("not_found_handling") == "404-page" and "404.html" in _srv,
      "an unknown path is a 404, not a page with a 200 (validators read that as a schema)",
      f"not_found_handling={_wr['assets'].get('not_found_handling')!r}, 404.html served={'404.html' in _srv}")
# THE SCHEMAS: each at the URL its own $id names, as JSON, readable
# cross-origin. Published from a Portrayal release by tools/publish-schemas.sh.
_hd = _srv["_headers"].read_text() if "_headers" in _srv else ""
# Every label: v1, v2 (the rack file from version 3, Portrayal #921), and any
# label a published schema sits under.
_schemas = sorted(d for d in _srv if d.startswith("schemas/") and d.endswith(".json"))
for _lb in sorted({"v1", "v2"} | {d.split("/")[1] for d in _schemas}):
    _sb = re.search(rf"^/schemas/{_lb}/\*\.json[ \t]*\n((?:[ \t]+.*\n?)*)", _hd, re.M)
    check(bool(_sb) and re.search(r"Content-Type:", _sb.group(1)) is None
          and re.search(r"Access-Control-Allow-Origin:\s*\*", _sb.group(1)) is not None
          and not re.search(r"^/schemas/\*\s*$", _hd, re.M),
          f"/schemas/{_lb}/*.json is readable from any origin, typed by its extension - no Content-Type rule to mislabel a 404",
          f"no /schemas/{_lb}/*.json block with Access-Control-Allow-Origin, a Content-Type override in it, or a broad /schemas/* block")
# EVERY PUBLISHED SCHEMA RESOLVES (#58). Read from the folder, publish/schemas/,
# not from the build's list: a file put there by hand and never added is in
# the folder and not in the list, and a check that walked the list would pass
# without it. Each file must parse, carry a $id that is the URL it is served
# at, and be in the build's list (tools/build-public.py --list, which is what
# goes live) as that same file.
_PUBLISHED = ["schemas/v1/component.schema.json", "schemas/v1/device.schema.json", "schemas/v1/lab.schema.json",
              "schemas/v1/listing.schema.json", "schemas/v1/marks.schema.json", "schemas/v1/rack.schema.json",
              "schemas/v2/rack.schema.json", "schemas/v3/rack.schema.json"]


def schema_faults(root, served):
    """{served path: what is wrong with it} for every file under `root`, a
    schemas/ folder, and for every schemas/ path in `served` (served path ->
    source file); and how many files were read."""
    faults, seen = {}, 0
    for f in sorted(p for p in Path(root).rglob("*") if p.is_file() and p.name != ".DS_Store"):
        rel = "schemas/" + f.relative_to(root).as_posix()
        seen += 1
        if not re.fullmatch(r"schemas/v[1-9][0-9]*/[a-z0-9-]+\.schema\.json", rel):
            faults[rel] = "not <vN>/<name>.schema.json: the headers and the publish script know no other shape"
            continue
        try:
            got = json.loads(f.read_text()).get("$id")
        except (ValueError, AttributeError) as e:
            faults[rel] = f"does not parse as a JSON object ({e})"
            continue
        if got != f"https://portrayal.dev/{rel}":
            faults[rel] = f"$id is {got!r}, not https://portrayal.dev/{rel}"
        elif rel not in served or Path(served[rel]).resolve() != f.resolve():
            faults[rel] = "not in the build's list (tools/build-public.py --list): git add it"
    for rel in served:
        if rel.startswith("schemas/") and not (Path(root) / rel[len("schemas/"):]).is_file():
            faults[rel] = "served, but not a file under publish/schemas/"
    return faults, seen


_sf, _sn = schema_faults(HERE / "publish" / "schemas", _srv)
# NOT VACUOUS: eight are published and a label is permanent, so fewer than
# eight read is a folder that moved or a URL that went away.
check(_sn >= len(_PUBLISHED) and set(_PUBLISHED) <= set(_schemas) and not _sf,
      f"every schema under publish/schemas/ parses, is served, and has the URL it is served at as its $id ({_sn} files)",
      f"read {_sn}, want at least {len(_PUBLISHED)}; published and gone: {sorted(set(_PUBLISHED) - set(_schemas))}; "
      f"{_sf}")
for _rel in _schemas:
    check(_rel not in _sf, f"{_rel}: its $id is the URL it is served at", _sf.get(_rel, ""))
# THE CHECK ABOVE CAN FAIL: a folder of its own making, seven small schemas
# under the published names, with one fault put in at a time; each is caught
# by name. Nothing here reads publish/schemas/, so a published file that goes
# missing is reported by the check above and not by a traceback from this one.
def _schema_mutants():
    out = {}
    with _tf.TemporaryDirectory() as _d:
        _root = Path(_d) / "schemas"
        _doc = lambda rel: json.dumps({"$id": f"https://portrayal.dev/{rel}", "type": "object"})

        def _clean():
            _sh.rmtree(_root, ignore_errors=True)
            for rel in _PUBLISHED:
                f = _root / rel[len("schemas/"):]
                f.parent.mkdir(parents=True, exist_ok=True)
                f.write_text(_doc(rel))
        _served = lambda: {"schemas/" + p.relative_to(_root).as_posix(): p for p in _root.rglob("*.json")}
        _clean(); _all = _served()
        out["clean"] = schema_faults(_root, _all)
        (_root / "v1" / "lab.schema.json").write_text(_doc("schemas/v2/lab.schema.json"))
        out["wrong $id"] = schema_faults(_root, _all)
        _clean(); (_root / "v3").mkdir(exist_ok=True); (_root / "v3" / "new.schema.json").write_text(_doc("schemas/v1/lab.schema.json"))
        out["added with another label's $id"] = schema_faults(_root, _served())
        _clean(); (_root / "v1" / "marks.schema.json").write_text("{")
        out["does not parse"] = schema_faults(_root, _all)
        _clean(); (_root / "v1" / "new.schema.json").write_text(_doc("schemas/v1/new.schema.json"))
        out["not added"] = schema_faults(_root, _all)
        _clean(); (_root / "v2" / "rack.schema.json").unlink()
        out["served and gone"] = schema_faults(_root, _all)
    return out


import shutil as _sh
_sm_ = _schema_mutants()
_n = len(_PUBLISHED)
_want = {"clean": ([], _n), "wrong $id": (["schemas/v1/lab.schema.json"], _n),
         "added with another label's $id": (["schemas/v3/new.schema.json"], _n + 1),
         "does not parse": (["schemas/v1/marks.schema.json"], _n), "not added": (["schemas/v1/new.schema.json"], _n + 1),
         "served and gone": (["schemas/v2/rack.schema.json"], _n - 1)}
check({k: (sorted(v[0]), v[1]) for k, v in _sm_.items()} == _want,
      "the published-schema check fails a wrong $id, a file that does not parse, one never added and one that went away",
      f"{_sm_}")
# ROBOTS.TXT (RFC 9309): a real group, not only comments. Cloudflare's managed
# robots.txt is comments alone, so without this file agent-readiness scanners
# (isitagentready.com) find no User-agent and fail it. A sitemap, once served,
# is named in it.
_rb = _srv["robots.txt"].read_text() if "robots.txt" in _srv else ""
check(re.search(r"^User-agent:\s*\S", _rb, re.M | re.I) is not None
      and re.search(r"^(Allow|Disallow):", _rb, re.M | re.I) is not None
      and re.search(r"^Disallow:\s*/\s*$", _rb, re.M | re.I) is None,
      "/robots.txt is served with a User-agent group that allows the site",
      "publish/robots.txt missing, not built, has no User-agent/Allow line, or disallows /")
# CONTENT SIGNALS (contentsignals.org) in the User-agent: * group, all three
# declared; the Worker sends the same on each Markdown copy.
_cs = re.search(r"^User-agent:\s*\*\s*\n(?:(?!User-agent:).*\n)*?Content-Signal:\s*(.+?)\s*$", _rb, re.M | re.I)
_cw = re.search(r'CONTENT_SIGNAL = "([^"]+)"', (HERE / "worker" / "index.mjs").read_text())
check(bool(_cs) and {k.split("=")[0].strip() for k in _cs.group(1).split(",")} == {"ai-train", "search", "ai-input"}
      and bool(_cw) and _cw.group(1) == _cs.group(1),
      "robots.txt declares Content Signals for ai-train, search and ai-input, and the Worker sends the same",
      f"robots.txt: {_cs.group(1) if _cs else None!r}, worker: {_cw.group(1) if _cw else None!r}")
check("sitemap.xml" not in _srv or re.search(r"^Sitemap:\s*https://portrayal\.dev/sitemap\.xml\s*$", _rb, re.M | re.I),
      "robots.txt names the sitemap the site serves", "add Sitemap: https://portrayal.dev/sitemap.xml to publish/robots.txt")
# SITEMAP.XML (sitemaps.org): build-public.py generates it from PAGES, so it
# follows the pages. Every public page is listed at its canonical URL - the
# extensionless one Cloudflare serves with a 200, not /x.html, which 307s -
# and kit-frame.html, which only hosts a recipe in kit.html's iframe, is not.
import xml.etree.ElementTree as _ET
import urllib.parse as _url
_smr = _sp.run([sys.executable, str(HERE / "tools" / "build-public.py"), "--print", "sitemap.xml"], capture_output=True, text=True)
try:
    _sm = _ET.fromstring(_smr.stdout)
    _locs = [u.findtext("{http://www.sitemaps.org/schemas/sitemap/0.9}loc") for u in _sm]
except _ET.ParseError as _e:
    _sm, _locs = None, [f"unparseable: {_e}"]
# THE EXPECTATION COMES FROM PAGES, because that is what the sitemap is
# generated from. Reading it out of the source text rather than importing the
# module keeps the two independent: a check that re-ran the generator's own
# logic would only prove it agrees with itself.
#
# This filtered everything served by `"/" not in d` before, which worked while
# every page sat at the repository root and quietly excluded the first one that
# did not. components/catalog.html is listed in the sitemap, correctly, and was
# not in this check's expectation. The slash was doing two jobs - telling a page
# from a file inside site/, brand/ or vendor/, which are also served and also
# end in .html - and PAGES draws that line properly.
_bp_pages = re.findall(r'"([^"]+\.html)"',
                       re.search(r"^PAGES = \[(.*?)\]",
                                 (HERE / "tools" / "build-public.py").read_text(), re.S | re.M).group(1))
_want = sorted("https://portrayal.dev/" + ("" if d == "index.html" else d[:-5])
               for d in _bp_pages if d not in ("404.html", "kit-frame.html"))
check("sitemap.xml" in _srv and _sm is not None and _sm.tag == "{http://www.sitemaps.org/schemas/sitemap/0.9}urlset"
      and sorted(_locs) == _want,
      "/sitemap.xml lists every public page once, at its canonical extensionless URL",
      f"want {_want}, got {_locs}")
# MARKDOWN FOR AGENTS: worker/index.mjs answers Accept: text/markdown on a
# page with its Markdown copy, which build-public.py generates beside it. The
# Worker runs only on run_worker_first's paths, so that list, the copies and
# the sitemap's pages must be the same pages: a page missing from the list
# never answers in Markdown, and a path in it with no copy gets a Link header
# naming a 404.
_pages_md = sorted(d[:-3] for d in _srv if d.endswith(".md") and d[:-3] + ".html" in _srv)
_rwf = _wr["assets"].get("run_worker_first")
check(isinstance(_rwf, list) and sorted("index" if p == "/" else p.lstrip("/") for p in _rwf) == _pages_md
      and sorted(_pages_md) == sorted(u.removeprefix("https://portrayal.dev/") or "index" for u in _locs),
      "the Worker runs on exactly the pages that have a Markdown copy, which are the sitemap's pages",
      f"run_worker_first={_rwf}, copies={_pages_md}")
check(_wr.get("main") == "./worker/index.mjs" and (HERE / "worker" / "index.mjs").exists()
      and _wr["assets"].get("binding") == "ASSETS"
      and list((HERE / "tests" / "worker").glob("*.test.mjs")),
      "wrangler.jsonc runs worker/index.mjs with the assets bound as ASSETS, and tests/worker/ tests it (checks.yml runs tests/*/*.test.mjs)",
      f"main={_wr.get('main')!r}, binding={_wr['assets'].get('binding')!r}")
# A RUNTIME PLACEHOLDER is what a script replaces as soon as it runs: a count
# that is still an em dash ("Lint rules —", "— devices") or a status line
# ("Reading the rules…", "loading…"). In prose an em dash sits between words;
# a placeholder one ends a line, starts one, or follows a "·" separator.
_PLACEHOLDER = re.compile(r"(?m)\u2014[ \t]*$|^[ \t]*\u2014|\u00b7[ \t]*\u2014|\u2014 devices"
                          r"|^[^\w\n]*[A-Za-z]+ing\b[^.!?\n]*\u2026[^\w\n]*$")
for _m in _pages_md:
    _t = _sp.run([sys.executable, str(HERE / "tools" / "build-public.py"), "--print", f"{_m}.md"], capture_output=True, text=True).stdout
    _body = _t.split("\n---\n", 1)[-1]
    _ph = _PLACEHOLDER.search(_body)
    check(re.match(r'---\ntitle: "[^"\n]+"\n(?:description: "[^\n]+"\n)?url: https://portrayal\.dev/\S*\n---\n\S', _t) is not None
          and _ph is None and not re.search(r"\]\((?:https://portrayal\.dev/)?[^)\s]*\.html", _t),
          f"{_m}.md: frontmatter, a body, no runtime placeholder, every site link canonical",
          f"placeholder {_ph.group(0)!r}" if _ph else _t[:200].replace("\n", " | "))
# A PAGE'S DATA FILE: a page whose content a script draws names the file in its
# <head> (rel="alternate" type="application/json"). Its Markdown copy lists it,
# _headers sends it as a Link header at the page's URL, and it is served.
for _m in _pages_md:
    _h = _srv[_m + ".html"].read_text()
    for _href in re.findall(r'<link\b(?=[^>]*\brel="alternate")(?=[^>]*\btype="application/json")[^>]*\bhref="([^"]+)"', _h):
        _abs = _url.urljoin(f"https://portrayal.dev/{_m}.html", _href)
        _path = _abs.removeprefix("https://portrayal.dev")
        _at = "/" if _m == "index" else f"/{_m}"
        _blk = re.search(rf"^{re.escape(_at)}[ \t]*\n((?:[ \t]+.*\n?)*)", _hd, re.M)
        _md = _sp.run([sys.executable, str(HERE / "tools" / "build-public.py"), "--print", f"{_m}.md"], capture_output=True, text=True).stdout
        check(_path.lstrip("/") in _srv and f"]({_abs})" in _md
              and bool(_blk) and f'<{_path}>; rel="alternate"; type="application/json"' in _blk.group(1),
              f"{_m}: its data file {_path} is served, listed in its Markdown copy, and sent as a Link header",
              f"served={_path.lstrip('/') in _srv}, in copy={f']({_abs})' in _md}, _headers block for {_at}={bool(_blk)}")
# Links on a page in a folder resolve as the browser resolves them: ../kit.html
# is /kit, and a sibling in the folder keeps the folder (/components/catalog).
sys.path.insert(0, str(HERE / "tools"))
from page_markdown import absolute as _absolute
check(_absolute("../kit.html", "components/catalog.html") == "https://portrayal.dev/kit"
      and _absolute("../index.html#showcase", "components/catalog.html") == "https://portrayal.dev/#showcase"
      and _absolute("kit.html", "index.html") == "https://portrayal.dev/kit"
      and _absolute("catalog.html#x", "components/catalog.html") == "https://portrayal.dev/components/catalog#x"
      and _absolute("components/catalog.html", "index.html") == "https://portrayal.dev/components/catalog",
      "a Markdown copy's links resolve against the page's own URL", "page_markdown.absolute")
# tools/publish-schemas.sh copies in only schemas whose $id matches, and refuses the rest.
_pub = HERE / "tools" / "publish-schemas.sh"
def _pubrun(ids):
    with _tf.TemporaryDirectory() as _src, _tf.TemporaryDirectory() as _dst:
        for _n, _id in ids.items():
            (Path(_src) / _n).write_text(json.dumps({"$id": _id, "type": "object"}))
        _r = _sp.run(["sh", str(_pub), "--from-dir", _src, "--to", _dst], capture_output=True, text=True)
        return _r.returncode, sorted(p.name for p in (Path(_dst) / "v1").glob("*.json")) if (Path(_dst) / "v1").exists() else []
_ok = {"device.schema.json": "https://portrayal.dev/schemas/v1/device.schema.json"}
_bad = {"device.schema.json": "https://example.com/device.schema.json"}
def _pubref(ref):
    with _tf.TemporaryDirectory() as _dst:
        _r = _sp.run(["sh", str(_pub), ref, "--to", _dst], capture_output=True, text=True)
        return _r.returncode, (Path(_dst) / "v1").exists()
def _pubtwice(force):
    with _tf.TemporaryDirectory() as _src, _tf.TemporaryDirectory() as _dst:
        _f = Path(_src) / "device.schema.json"
        _f.write_text(json.dumps({"$id": _ok["device.schema.json"], "type": "object"}))
        _sp.run(["sh", str(_pub), "--from-dir", _src, "--to", _dst], capture_output=True)
        _f.write_text(json.dumps({"$id": _ok["device.schema.json"], "type": "array"}))
        _r = _sp.run(["sh", str(_pub), "--from-dir", _src, "--to", _dst] + (["--force"] if force else []),
                     capture_output=True, text=True)
        return _r.returncode, json.loads((Path(_dst) / "v1" / "device.schema.json").read_text())["type"]
check(_pub.exists() and _pubref("no-such-ref-xyz") == (_pubref("no-such-ref-xyz")[0] or 1, False)
      and _pubref("no-such-ref-xyz")[0] != 0,
      "tools/publish-schemas.sh fails on a ref that does not exist, and leaves no schemas/v1 behind",
      f"{_pubref('no-such-ref-xyz') if _pub.exists() else 'no script'}")
check(_pub.exists() and _pubtwice(False)[0] != 0 and _pubtwice(False)[1] == "object" and _pubtwice(True) == (0, "array"),
      "v1/ is permanent: tools/publish-schemas.sh will not change a published schema without --force",
      f"{(_pubtwice(False), _pubtwice(True)) if _pub.exists() else 'no script'}")
check(_pub.exists() and _pubrun(_ok) == (0, ["device.schema.json"]) and _pubrun(_bad)[0] != 0,
      "tools/publish-schemas.sh publishes a schema whose $id is its URL and refuses one whose is not",
      f"{(_pubrun(_ok), _pubrun(_bad)) if _pub.exists() else 'no tools/publish-schemas.sh'}")
# EACH SCHEMA UNDER ITS OWN LABEL (Portrayal #921): the rack schema's $id is
# /schemas/v2/, so it goes there, beside a v1 one already published, which stays.
def _publabels():
    with _tf.TemporaryDirectory() as _src, _tf.TemporaryDirectory() as _dst:
        (Path(_dst) / "v1").mkdir()
        (Path(_dst) / "v1" / "rack.schema.json").write_text('{"$id": "https://portrayal.dev/schemas/v1/rack.schema.json"}')
        for _n, _id in {"device.schema.json": _ok["device.schema.json"],
                        "rack.schema.json": "https://portrayal.dev/schemas/v2/rack.schema.json"}.items():
            (Path(_src) / _n).write_text(json.dumps({"$id": _id, "type": "object"}))
        _r = _sp.run(["sh", str(_pub), "--from-dir", _src, "--to", _dst], capture_output=True, text=True)
        return (_r.returncode, sorted(str(p.relative_to(_dst)) for p in Path(_dst).rglob("*.json")),
                json.loads((Path(_dst) / "v1" / "rack.schema.json").read_text())["$id"])
check(_pub.exists() and _publabels() == (0, ["v1/device.schema.json", "v1/rack.schema.json", "v2/rack.schema.json"],
                                         "https://portrayal.dev/schemas/v1/rack.schema.json"),
      "tools/publish-schemas.sh puts each schema under the label its own $id names, and keeps a v1 one already published",
      f"{_publabels() if _pub.exists() else 'no tools/publish-schemas.sh'}")

# ── ORIGIN-TRIAL TOKENS (roc-ops/portrayal-site#134) ─────────────────────
# A page opts into a Chrome origin trial with <meta http-equiv="origin-trial">.
# The token carries its own expiry, and when that passes Chrome silently stops
# honoring it: the feature just goes away on the live site and no check fails.
# So each token on a published page is decoded here and failed 30 days ahead.
# The layout is a 1-byte version, a 64-byte signature, a 4-byte big-endian
# payload length, then the JSON payload.
import base64 as _b64, struct as _struct, time as _time
_OT_ORIGINS = ("https://portrayal.dev", "https://portrayal.dev:443")
_OT_WARN = 30 * 86400


def origin_trial_problems(page, content, now):
    """What is wrong with one origin-trial token on `page`, as of Unix time
    `now`: [] for a token that is ours, names a feature and has more than 30
    days left."""
    try:
        raw = _b64.b64decode(content, validate=True)
        n = _struct.unpack(">I", raw[65:69])[0]
        d = json.loads(raw[69:69 + n])
    except Exception as e:
        return [f"{page}: an origin-trial token does not decode ({e})"]
    feature = d.get("feature") or ""
    out = []
    if not feature.strip():
        out.append(f"{page}: an origin-trial token names no feature")
    if d.get("origin") not in _OT_ORIGINS:
        out.append(f"{page}: the {feature or '?'} origin-trial token is for {d.get('origin')!r}, not https://portrayal.dev")
    exp = d.get("expiry")
    if not isinstance(exp, int) or exp - now <= _OT_WARN:
        when = _time.strftime("%Y-%m-%d", _time.gmtime(exp)) if isinstance(exp, int) else repr(exp)
        state = "expired" if isinstance(exp, int) and exp <= now else "expires"
        out.append(f"{page}: the {feature or '?'} origin-trial token {state} {when} - renew it at "
                   f"developer.chrome.com/origintrials, or remove the tag if {feature or 'the feature'} "
                   f"has shipped in stable Chrome")
    return out


_OT_META = re.compile(r"""<meta\b(?=[^>]*\bhttp-equiv=["']?origin-trial\b)[^>]*\bcontent=(["'])(.*?)\1""", re.I)
_now = int(_time.time())
_ot_seen = []
for _d in _bp_pages:
    _f = _srv.get(_d) or HERE / _d
    for _q, _c in _OT_META.findall(_f.read_text() if _f.is_file() else ""):
        _ot_seen.append(_d)
        _bad = origin_trial_problems(_d, _c, _now)
        check(not _bad, f"{_d}: its origin-trial token is for portrayal.dev, names a feature, "
                        f"and has more than 30 days left", "; ".join(_bad))
if not _ot_seen:
    check(True, "no published page carries an origin-trial token, so none can expire")


# The check itself, against tokens made here: one that expires tomorrow, one
# already expired, one for another origin, one naming no feature, and one that
# is fine. A check that could not fail would pass every one of these.
def _ot_token(**payload):
    body = json.dumps(payload).encode()
    return _b64.b64encode(b"\x02" + b"\x00" * 64 + _struct.pack(">I", len(body)) + body).decode()
_ot_ok = dict(origin="https://portrayal.dev:443", feature="WebMCP", expiry=_now + 90 * 86400, isSubdomain=True)
_ot_cases = {
    "expires tomorrow": (dict(_ot_ok, expiry=_now + 86400), "expires"),
    "expired": (dict(_ot_ok, expiry=_now - 86400), "expired"),
    "another origin": (dict(_ot_ok, origin="https://example.com"), "not https://portrayal.dev"),
    "no feature": (dict(_ot_ok, feature=""), "names no feature"),
}
_ot_bad = [f"{name}: {origin_trial_problems('x.html', _ot_token(**p), _now)}"
           for name, (p, want) in _ot_cases.items()
           if not any(want in s for s in origin_trial_problems("x.html", _ot_token(**p), _now))]
_ot_bad += [f"fine token: {s}" for s in origin_trial_problems("x.html", _ot_token(**_ot_ok), _now)]
_ot_bad += [f"without :443: {s}" for s in
            origin_trial_problems("x.html", _ot_token(**dict(_ot_ok, origin="https://portrayal.dev")), _now)]
_ot_bad += [] if origin_trial_problems("x.html", "not a token", _now) else ["garbage decoded as a token"]
check(not _ot_bad,
      "the origin-trial check fails a token that expires within 30 days, has expired, is for another origin "
      "or names no feature, and passes a good one",
      "; ".join(_ot_bad))

# ── the browser pass, in shards ──────────────────────────────────────────
# CI runs check-browser.py as a matrix of `--shard i/n` jobs. That is only as
# good as two things nobody would notice breaking: that the n shards between
# them run every unit exactly once, and that the workflow asks for all n. A
# check that lands in no shard fails nothing - it just stops being run - so
# both are held here, where a new page or a new @extra changes the answer.
_cb_spec = _ilu.spec_from_file_location("check_browser", HERE / "check-browser.py")
_cb = _ilu.module_from_spec(_cb_spec)
_cb_spec.loader.exec_module(_cb)            # playwright is imported inside main(), not here
_cb_src = (HERE / "check-browser.py").read_text()
_units = _cb.units()
_registered = re.findall(r"^@extra\(.*\)\ndef (\w+)\(", _cb_src, re.M)
check(len(_units) == len(set(_units))
      and sorted(_registered) == sorted(fn.__name__ for _, fn in _cb.EXTRA_CHECKS)
      and set(_registered) | set(_cb.PAGES) | set(_cb.FIXED_UNITS) | {_cb.MARKS_UNIT} == set(_units),
      "check-browser: every page, every hand-wired block, every @extra and the marks harness is a unit, under a name of its own",
      f"{len(_units)} units, {len(set(_units))} names; {len(_registered)} @extra in the file, "
      f"{len(_cb.EXTRA_CHECKS)} registered")
_split_bad = []
for _n in range(1, 13):
    _plan = _cb.shard_plan(_n)
    _dealt = [u for _s in _plan for u in _s]
    if len(_plan) != _n or sorted(_dealt) != sorted(_units) or _plan != _cb.shard_plan(_n):
        _split_bad.append(f"n={_n}: {len(_dealt)} dealt, {len(set(_dealt))} distinct, of {len(_units)}")
check(not _split_bad,
      "check-browser: --shard i/n deals every unit to exactly one shard, the same way each time, for n = 1 to 12",
      "; ".join(_split_bad))
# `--only <name>` is how one check is verified while it is being written, and a
# name that matched no registered @extra used to run nothing and exit 0 - a
# green run that had asserted nothing. The same false green as a unit in no
# shard, reached by a typo instead, so it is held here too.
_only_bad = []
# The first case is only a case while that name is still a function here and
# still not an @extra; a rename that left it meaningless would otherwise pass.
if "check_hero_3d" in _registered or not callable(getattr(_cb, "check_hero_3d", None)):
    _only_bad.append("check_hero_3d is no longer a non-@extra function in check-browser.py - "
                     "name one that is")
# THE LAST CASE IS THE ONE THAT HID. Before any of this, a list with one wrong
# name among good ones ran the good ones and printed their `ok` lines, so the run
# looked healthy while doing less than it was asked - harder to notice than a run
# that printed nothing, and the reason one bad name has to refuse the whole list.
for _arg, _why in [("check_hero_3d", "a function in the file that is not an @extra"),
                   ("totally_bogus_name_xyz", "a name that is nothing at all"),
                   ("", "--only with no name"),
                   (f"{_registered[0]},totally_bogus_name_xyz",
                    "a list with one wrong name among registered ones")]:
    try:
        _cb.parse_only(_arg)
        _only_bad.append(f"accepted {_why}")
    except SystemExit:
        pass
_pair = _registered[:2]
try:
    if _cb.parse_only(",".join(_pair)) != set(_pair):
        _only_bad.append("a pair of registered names did not come back as itself")
except SystemExit as _e:
    _only_bad.append(f"refused the registered {_pair}: {_e}")
check(not _only_bad,
      "check-browser: --only refuses a name that is no registered @extra, and still takes the ones that are",
      "; ".join(_only_bad))
# main() guards each block with want(<unit>): every hand-wired unit has its
# guard, the page loop and the extras take theirs from the same set, and a
# name that is not a unit raises rather than reading as "not mine".
_main = _cb_src[_cb_src.index("\ndef main():"):]
_guards = re.findall(r'\bwant\((?:"([^"]+)"|(MARKS_UNIT))\)', _main)
_guarded = {a or _cb.MARKS_UNIT for a, b in _guards}
check(_guarded == set(_cb.FIXED_UNITS) | {"index.html", _cb.MARKS_UNIT}
      and "if not want(name):" in _main
      and "run_extra(browser, base, mine, problems, notes)" in _main
      and "if unit not in known:" in _main,
      "check-browser: main() asks want() for every hand-wired unit, the page loop and the extras ask the same set, and an unknown name raises",
      f"guards {sorted(_guarded)} against units {sorted(set(_cb.FIXED_UNITS) | {'index.html', _cb.MARKS_UNIT})}")
# The workflow: a matrix of 1..n, each run as --shard <i>/n with the same n.
_wf = (HERE / ".github" / "workflows" / "checks.yml").read_text()
_wf_code = "\n".join(l for l in _wf.splitlines() if not l.lstrip().startswith("#"))
_mx = re.search(r"^\s*shard:\s*\[([\d,\s]+)\]\s*$", _wf_code, re.M)
_of = re.findall(r"check-browser\.py\s+--shard\s+\$\{\{\s*matrix\.shard\s*\}\}/(\d+)", _wf_code)
_runs = re.findall(r"check-browser\.py.*", _wf_code)
_mx_list = [int(x) for x in _mx.group(1).split(",")] if _mx else []
check(len(_of) == 1 and len(_runs) == 1 and _mx_list == list(range(1, int(_of[0]) + 1))
      and re.search(r"^\s*fail-fast:\s*false\s*$", _wf_code, re.M) is not None,
      "checks.yml runs the browser pass as every shard of the n it names, 1 to n, and one failing shard does not cancel the rest",
      f"matrix {_mx_list}, --shard .../{_of}, {len(_runs)} check-browser line(s)")

# ── the Nautobot cable import script (Rack Builder Phase 2c) ─────────────────
# Nautobot cannot import a cable by its ends' names, so the Rack Builder's
# Nautobot kit carries a script that looks the ends up and creates each cable
# by id. It is a real file, site/rack/nautobot/import_cables.py, which the page
# fetches into the zip - so it must be served, and it is tested here, against
# a mock Nautobot, on every push and in CI: nobody runs it by hand until a
# user does, against their own instance.
_ict = HERE / "tests" / "rack" / "import_cables_test.py"
_icr = _sp.run([sys.executable, str(_ict)], capture_output=True, text=True) if _ict.is_file() else None
check(_icr is not None and _icr.returncode == 0,
      "site/rack/nautobot/import_cables.py passes its tests against a mock Nautobot",
      (_icr.stderr[-600:] if _icr else "no tests/rack/import_cables_test.py"))
check("site/rack/nautobot/import_cables.py" in _srv,
      "the build serves site/rack/nautobot/import_cables.py, which the Nautobot kit fetches",
      "the file is not tracked, or tools/build-public.py does not copy it")
# THE ACCEPTANCE KIT (tools/dcim-verify/) imports the Rack Builder's exported
# kits into a real NetBox and Nautobot, and only a person with instances runs
# that. What runs here is its self-test: kits.py end to end against a mock of
# both (and the client's own test: a token request never carries the web
# session), so the tool still works on the day somebody needs it.
_kst = HERE / "tools" / "dcim-verify" / "selftest.py"
_ksr = _sp.run([sys.executable, str(_kst)], capture_output=True, text=True) if _kst.is_file() else None
check(_ksr is not None and _ksr.returncode == 0,
      "tools/dcim-verify/kits.py passes its self-test against a mock NetBox and Nautobot",
      (_ksr.stderr[-600:] if _ksr else "no tools/dcim-verify/selftest.py"))

# ── zeroU in every shipped rack fixture has the kit's shape ─────────────
# zeroU was reserved until kit 0.6.0 (Portrayal #926) gave it its parts: an
# entry is {id, ref, cfg, label, at, offsetMm, between?}, read and placed by
# the kit (model.js zeroUOf, fit.js fitsZeroU). A fixture we ship that puts
# something else there tests a file no page writes. (Rack-face cable managers
# are still items with `on`, never zero-U entries.) The browser checks build
# their zero-U racks through the page, or write one in an older page's own
# shape on purpose (check_rack_v2_migrates), so only the JSON files are read.
_fx = []
for _p in sorted((HERE / "tools").rglob("*.json")) + sorted((HERE / "site").rglob("*.json")) + sorted((HERE / "tests").rglob("*.json")):
    try:
        _d = json.loads(_p.read_text())
    except Exception:
        continue
    for _r in (_d.get("racks") if isinstance(_d, dict) and isinstance(_d.get("racks"), list) else []):
        if isinstance(_r, dict) and "zeroU" in _r:
            _fx.append((str(_p.relative_to(HERE)), _r["zeroU"]))
_zbad = [(n, z) for n, z in _fx if not isinstance(z, list) or not all(
    isinstance(e, dict) and all(isinstance(e.get(k), str) and e.get(k) for k in ("ref", "at"))
    and isinstance(e.get("offsetMm", 0), (int, float)) for e in z)]
check(_fx and not _zbad,
      f"every shipped rack fixture's zeroU holds the kit's zero-U entries ({len(_fx)} found, tools/dcim-verify/acceptance.rack.json among them)",
      "; ".join(f"{n}: {z!r}" for n, z in _zbad) or "no shipped rack fixture has a zeroU record")

# ── report ───────────────────────────────────────────────────────────────
# ── THE COMPONENT CATALOG (components/catalog.html) ─────────────────────
# The page that stands in for Portrayal's CATALOGUE.md once #843 stops
# committing it. Upstream's README links it, so the ways it can quietly stop
# being reachable or stop being complete are worth failing the build over.
_cat = HERE / "components" / "catalog.html"
check(_cat.exists(), "components/catalog.html is in the tree")
_cat_html = _cat.read_text() if _cat.exists() else ""

# A PAGE NOT IN build-public.py's PAGES IS NOT PUBLISHED, and nothing else
# says so: the site builds, deploys, and serves a 404 at a URL upstream links.
_bp_src = (HERE / "tools" / "build-public.py").read_text()
check('"components/catalog.html"' in _bp_src,
      "components/catalog.html is in build-public.py PAGES",
      "the page would not be published, and /components/catalog would 404")

# A PAGE NOT IN check-browser.py's PAGES IS NEVER SWEPT, so it can 404 on its
# own assets or throw on load and every check still passes.
_cb_html = (HERE / "check-browser.py").read_text()
check('"components/catalog.html"' in _cb_html,
      "components/catalog.html is in check-browser.py PAGES",
      "the page sweep would skip it, so a broken page would pass CI")

# IT IS THE ONLY PAGE IN A SUBDIRECTORY, and the masthead it shares with the
# others is written with relative hrefs. Unprefixed, `href="explorer.html"`
# resolves to /components/explorer.html and every nav link 404s, which no
# check of the page's own content would notice.
_flat = re.findall(r'(?:href|src)="(?!\.\./|https?:|#|/)([a-z0-9-]+(?:\.html|/[^"]*))"', _cat_html)
check(not _flat,
      "components/catalog.html reaches its siblings and assets through ../",
      f"these would resolve under /components/: {sorted(set(_flat))[:6]}")

# The rows come from the shared module, not from a copy of its rules inlined
# into the page, so tests/catalog pins what the page renders.
check("site/catalog-page.js" in _cat_html,
      "components/catalog.html renders through site/catalog-page.js")

# ── refresh-assets.sh REFUSES BEFORE IT COPIES ──────────────────────────
# Run for real, as a copy in a scratch folder (the script works on the folder
# it is in), against a library and a kit that are in no git checkout: it must
# refuse, and vendor/ must be as it was. It used to copy the kit's modules and
# empty vendor/rack/ first, then find it could not name the commit. And with
# no library at all, the advice reads in the order it is followed: clone,
# build, or else point PORTRAYAL_UPSTREAM somewhere.
def _refresh_dry():
    with _tf.TemporaryDirectory() as _d:
        _d = Path(_d)
        for _sub in ("site/vendor/rack", "up/library/dist", "up/kit/rack"):
            (_d / _sub).mkdir(parents=True)
        (_d / "site" / "refresh-assets.sh").write_text((HERE / "refresh-assets.sh").read_text())
        (_d / "site" / "vendor" / "rack" / "kept.js").write_text("export const kept = 1;\n")
        (_d / "up" / "library" / "dist" / "devices.json").write_text('{"devices": []}')
        (_d / "up" / "kit" / "new.js").write_text("export const fresh = 1;\n")
        (_d / "up" / "kit" / "rack" / "new.js").write_text("export const fresh = 1;\n")
        _env = {k: v for k, v in os.environ.items() if not k.startswith(("GIT_", "PORTRAYAL_"))}
        # No repository above the scratch folder, whatever the temp folder sits in.
        _env["GIT_CEILING_DIRECTORIES"] = str(_d.resolve().parent)
        # The script refuses a library under a folder named as Portrayal's
        # working tree is, and a dist older than its checkout. A TMPDIR under
        # such a folder, or a commit made a second after the scratch dist, is
        # neither, so both refusals are switched off: what is tested here is
        # the refusals that come after them.
        _env.update(PORTRAYAL_ALLOW_LIVE="1", PORTRAYAL_ALLOW_STALE="1", GIT_CONFIG_GLOBAL=os.devnull,
                    GIT_CONFIG_NOSYSTEM="1")
        _run = lambda *a: _sp.run(["sh", str(_d / "site" / "refresh-assets.sh"), *a],
                                  capture_output=True, text=True, env=_env)
        _vendor = lambda: sorted(str(f.relative_to(_d / "site" / "vendor"))
                                 for f in (_d / "site" / "vendor").rglob("*") if f.is_file())
        _r = _run(str(_d / "up" / "library"))
        _left = _vendor()
        _none = _run(str(_d / "nowhere"))
        # The same kit, now in a commit, but with no package.json: the last
        # thing the script copies from it.
        _g = lambda *a: _sp.run(["git", "-c", "user.name=check", "-c", "user.email=check@example.invalid",
                                 "-c", "commit.gpgsign=false", *a], cwd=_d / "up", capture_output=True, env=_env)
        _g("init", "-q"); _g("add", "-A"); _made = _g("commit", "-q", "-m", "a kit with no package.json")
        _nopkg = _run(str(_d / "up" / "library"))
        return _r, _left, _none, _made.returncode, _nopkg, _vendor()
_rf, _rf_left, _rf_none, _rf_made, _rf_nopkg, _rf_nopkg_left = _refresh_dry()
check(_rf_made == 0 and _rf_nopkg.returncode == 1 and "refusing" in _rf_nopkg.stderr
      and "package.json" in _rf_nopkg.stderr and _rf_nopkg_left == ["rack/kept.js"],
      "refresh-assets.sh refuses a kit with no package.json before it copies anything into vendor/",
      f"commit made: {_rf_made == 0}; exit {_rf_nopkg.returncode}, vendor/ holds {_rf_nopkg_left} "
      f"(wanted only rack/kept.js): {_rf_nopkg.stderr.strip()[-200:]}")
check(_rf.returncode == 1 and "refusing" in _rf.stderr and "not in a git checkout" in _rf.stderr
      and _rf_left == ["rack/kept.js"],
      "refresh-assets.sh refuses a kit it cannot name the commit of before it copies anything into vendor/",
      f"exit {_rf.returncode}, vendor/ holds {_rf_left} (wanted only rack/kept.js): {_rf.stderr.strip()[-200:]}")
_rf_at = [_rf_none.stderr.find(s) for s in ("git clone ", "./build.sh", "PORTRAYAL_UPSTREAM")]
check(_rf_none.returncode == 1 and -1 < _rf_at[0] < _rf_at[1] < _rf_at[2],
      "refresh-assets.sh with no library says clone, then build, then the PORTRAYAL_UPSTREAM alternative",
      f"exit {_rf_none.returncode}, found at {_rf_at}: {_rf_none.stderr.strip()[-300:]}")

# ── THE PRE-PUSH HOOK'S IDEA OF "THE SITE" ──────────────────────────────
# hooks/pre-push runs the browser pass only when PORTRAYAL_HOOK_BROWSER asks
# for it (#144: CI runs it on every PR), and even then only when the push
# touches the site, which it decides with one regex. It listed .html as `[^/]+\.html$` - a file at the
# repository root - which was every page until components/catalog.html, the
# first in a subdirectory: editing it skipped the pass entirely, and nothing
# said so. The hook is the gate people trust before CI sees the branch, so the
# rule is exercised here against the real function rather than eyeballed.
#
# OVER-TRIGGERING IS SAFE AND UNDER-TRIGGERING IS THE BUG: a push that runs the
# pass it did not need costs minutes; one that skips the pass it was asked for
# and did need is a page nobody checked.
_hook_src = (HERE / "hooks" / "pre-push").read_text()
_hook_fn = re.search(r"^touches_the_site\(\) \{.*?^\}", _hook_src, re.S | re.M)
def _touches(path):
    return _sp.run(["sh", "-c", f"{_hook_fn.group(0)}\nprintf '%s\\n' \"$1\" | touches_the_site", "_", path],
                   capture_output=True).returncode == 0
_want_pass = ["index.html", "components/catalog.html", "site/rack/exports.js",
              "assets/dist/components.json", "vendor/relief.js", "brand/tokens.css",
              "tests/rack/dcim.test.mjs", "check-browser.py", "serve.py"]
_want_skip = ["README.md", "docs/superpowers/specs/x.md", "tools/build-public.py",
              "check-contract.py", "coming-soon/index.html"]
check(_hook_fn is not None, "hooks/pre-push defines touches_the_site")
_hook_bad = ([f"{p} should run the browser pass" for p in _want_pass if not _touches(p)]
             + [f"{p} should not" for p in _want_skip if _touches(p)])
check(not _hook_bad,
      "hooks/pre-push runs the browser pass for every page, including one in a subdirectory",
      "; ".join(_hook_bad))
# THE HOOK ITSELF, RUN: in a scratch repository with stand-ins for the two
# checks, fed what git feeds it. Where the browser pass sits in the file says
# nothing about whether a push gets through, so each case asserts the exit
# status and what ran. A scratch repository has no tests/, so every run also
# leaves the node tests out, and has to say so.
_STUB = "import os, sys\nopen('ran', 'a').write('%s\\n')\nsys.exit(int(os.environ.get('STUB_EXIT', '0')))\n"
def _hook_runs():
    with _tf.TemporaryDirectory() as _d:
        _env = {k: v for k, v in os.environ.items() if not k.startswith(("GIT_", "PORTRAYAL_"))}
        _env.update(GIT_CONFIG_GLOBAL=os.devnull, GIT_CONFIG_NOSYSTEM="1")
        _g = lambda *a: _sp.run(["git", "-c", "user.name=check", "-c", "user.email=check@example.invalid",
                                 "-c", "commit.gpgsign=false", *a],
                                cwd=_d, capture_output=True, text=True, env=_env)
        _g("init", "-q")
        (Path(_d) / "check-contract.py").write_text(_STUB % "contract")
        (Path(_d) / "check-browser.py").write_text(_STUB % "browser")
        (Path(_d) / "README.md").write_text("one\n")
        _g("add", "-A"); _g("commit", "-q", "-m", "one")
        (Path(_d) / "index.html").write_text("<p>two</p>\n")
        _g("add", "-A"); _g("commit", "-q", "-m", "two")
        _c1, _c2 = _g("rev-parse", "HEAD~1").stdout.strip(), _g("rev-parse", "HEAD").stdout.strip()
        def _push(remote_sha, **extra):
            (Path(_d) / "ran").write_text("")
            _r = _sp.run(["sh", str(HERE / "hooks" / "pre-push"), "origin", "/nowhere"], cwd=_d, text=True,
                         input=f"refs/heads/b {_c2} refs/heads/b {remote_sha}\n" if remote_sha else "",
                         capture_output=True, env={**_env, **extra})
            return _r.returncode, (Path(_d) / "ran").read_text().split(), _r.stdout + _r.stderr
        return {"default": _push(_c1), "asked": _push(_c1, PORTRAYAL_HOOK_BROWSER="1"),
                "unknown": _push("0123456789abcdef0123456789abcdef01234567"),
                "failing": _push(_c1, STUB_EXIT="3"),
                "nothing": _push("")}, bool(_c1 and _c2)
_hr, _hr_made = _hook_runs()
_skip_lines = lambda out, what: [l for l in out.splitlines() if l.startswith("pre-push: skipped") and what in l]
check(_hr_made and _hr["default"][:2] == (0, ["contract"]) and len(_skip_lines(_hr["default"][2], "check-browser.py")) == 1,
      "hooks/pre-push, run: a default push exits 0 having run the contract check and not the browser pass, and says so",
      f"exit {_hr['default'][0]}, ran {_hr['default'][1]}: {_hr['default'][2][-300:]}")
check(_hr["asked"][0] == 0 and (_hr["asked"][1] == ["contract", "browser"]
                                or (_hr["asked"][1] == ["contract"] and _skip_lines(_hr["asked"][2], "no playwright"))),
      "hooks/pre-push, run: with PORTRAYAL_HOOK_BROWSER=1 a push that touches a page exits 0 having run the browser "
      "pass, or says it has no playwright",
      f"exit {_hr['asked'][0]}, ran {_hr['asked'][1]}: {_hr['asked'][2][-300:]}")
check(_hr["unknown"][:2] == (0, ["contract"]),
      "hooks/pre-push, run: a force-push over a commit this clone does not have exits 0 and is checked, not exit 128",
      f"exit {_hr['unknown'][0]}, ran {_hr['unknown'][1]}: {_hr['unknown'][2][-300:]}")
check(_hr["failing"][0] == 3 and _hr["nothing"][:2] == (0, []),
      "hooks/pre-push, run: a failing contract check stops the push with its own status, and a push of nothing runs nothing",
      f"failing: exit {_hr['failing'][0]}; nothing: exit {_hr['nothing'][0]}, ran {_hr['nothing'][1]}")
_hr_notes = [l for l in _hr["default"][2].splitlines() if "skipped" in l]
check(len(_skip_lines(_hr["default"][2], "node tests")) == 1 and len(_hr_notes) == 2,
      "hooks/pre-push, run: each check left out is one `pre-push: skipped` line",
      f"{_hr_notes}")

# ── THE LINT RULES PAGE (portrayal-site#159) ────────────────────────────
# lint.html renders assets/dist/lint-rules.json, Portrayal's rule table
# (Portrayal #952, format 1 in its docs/format-stability.md), and the schema
# page links every rule code its descriptions mention to lint.html#<code>. So
# the file must be here and must list rules, and every code the schema page
# would link must have an entry: a link to a rule the page does not list lands
# on nothing. The pattern for "a code" is site/lintcodes.js's own LINT_CODE,
# read from the file, so this checks exactly what the page links.
_lr_f = DIST / "lint-rules.json"
try:
    _lr = json.loads(_lr_f.read_text())
except Exception as _e:
    _lr = {}
    check(False, "assets/dist/lint-rules.json is readable", f"{_e} - run ./refresh-assets.sh")
_lr_rules = _lr.get("rules") if isinstance(_lr.get("rules"), list) else []
_lr_codes = [r.get("code") for r in _lr_rules if isinstance(r, dict)]
_lr_retired = [r.get("code") for r in (_lr.get("retired") or []) if isinstance(r, dict)]
# NOT VACUOUS: an empty table renders an empty page, and every check below
# would pass on it. Portrayal had 170 rules when the page landed.
check(_lr.get("format") == 1 and len(_lr_rules) >= 100,
      f"assets/dist/lint-rules.json is format 1 and lists the linter's rules ({len(_lr_rules)})",
      f"format {_lr.get('format')!r}, {len(_lr_rules)} rules - run ./refresh-assets.sh against a current build")
_LR_KEYS = ("code", "scope", "rule", "why", "fix", "severity")
_lr_short = [r.get("code", "?") for r in _lr_rules
             if not isinstance(r, dict) or not all(isinstance(r.get(k), str) and r.get(k) for k in _LR_KEYS)
             or not all(isinstance(r.get(k), bool) for k in ("fails", "warns", "fails-at-verified"))]
check(_lr_rules and not _lr_short,
      "every rule in lint-rules.json has a code, scope, rule, why, fix, severity and the three booleans",
      f"{len(_lr_short)} short, e.g. {_lr_short[:5]}")
_lr_dupe = sorted({c for c in _lr_codes + _lr_retired if (_lr_codes + _lr_retired).count(c) > 1})
check(not _lr_dupe and all(isinstance(c, str) and re.fullmatch(r"L\d{1,3}", c) for c in _lr_codes),
      "lint-rules.json names each code once, as L<digits>, so each is one anchor on lint.html",
      f"repeated {_lr_dupe[:5]}")
_lc_js = (HERE / "site" / "lintcodes.js").read_text() if (HERE / "site" / "lintcodes.js").exists() else ""
_lc_m = re.search(r"^export const LINT_CODE = /(.+)/g;$", _lc_js, re.M)
check(bool(_lc_m), "site/lintcodes.js defines LINT_CODE as a one-line /.../g literal")
_LINT_CODE = re.compile(_lc_m.group(1)) if _lc_m else re.compile(r"(?!)")
_SCH = HERE / "assets" / "schemas"
_lr_known = set(_lr_codes) | set(_lr_retired)
_linked = {}
def _prose_codes(text):
    # schema.js's richText: code spans (`...`) are never linked
    return [m.group(0) for i, part in enumerate(re.split(r"`([^`]+)`", text)) if i % 2 == 0
            for m in _LINT_CODE.finditer(part)]
def _walk_prose(node, fname):
    if isinstance(node, dict):
        for k, v in node.items():
            if k in ("description", "$comment") and isinstance(v, str):
                for c in _prose_codes(v):
                    _linked.setdefault(c, set()).add(fname)
            else:
                _walk_prose(v, fname)
    elif isinstance(node, list):
        for v in node:
            _walk_prose(v, fname)
for _sf in sorted(_SCH.glob("*.schema.json")):
    _walk_prose(json.loads(_sf.read_text()), _sf.name)
# NOT VACUOUS: the schemas cite dozens of rules; finding none means the pattern
# or the walk broke, not that there is nothing to link.
check(len(_linked) >= 20, f"the schema page links rule codes from the schemas' prose ({len(_linked)} codes)",
      f"found {sorted(_linked)}")
_lr_missing = sorted((c for c in _linked if c not in _lr_known), key=lambda c: int(c[1:]))
check(not _lr_missing,
      "every rule code the schema page links has an entry in lint-rules.json",
      "; ".join(f"{c} (in {', '.join(sorted(_linked[c]))})" for c in _lr_missing[:8])
      + " - a code that is not a lint rule needs LINT_CODE in site/lintcodes.js to leave it out")
check("splitCodes" in SJS and "ruleHref" in SJS and "from './lintcodes.js'" in SJS,
      "site/schema.js links rule codes through site/lintcodes.js")
# The kit page is written by hand, so a code there is linked by hand: every
# rule code in its prose (outside <pre> and <code>) is inside an
# <a href="lint.html#<code>">, and has an entry.
_kit_prose_html = re.sub(r"<(pre|code|script|style)\b.*?</\1>", " ", _kit_html, flags=re.S)
_kit_codes, _kit_bare = [], []
for _m in _LINT_CODE.finditer(re.sub(r"<[^>]+>", lambda t: " " * len(t.group(0)), _kit_prose_html)):
    _kit_codes.append(_m.group(0))
    _before = _kit_prose_html[:_m.start()]
    _a = _before.rfind("<a ")
    if _a < 0 or "</a>" in _before[_a:] or f'href="lint.html#{_m.group(0)}"' not in _before[_a:]:
        _kit_bare.append(_m.group(0))
check(not _kit_bare, f"every rule code kit.html mentions links to its entry on lint.html ({len(_kit_codes)} mentioned)",
      f"{_kit_bare} - wrap each in <a href=\"lint.html#<code>\">")
_kit_unknown = sorted(set(_kit_codes) - _lr_known)
check(not _kit_unknown, "every rule code kit.html mentions has an entry in lint-rules.json", f"{_kit_unknown}")
_lint_html = (HERE / "lint.html").read_text() if (HERE / "lint.html").exists() else ""
check('src="site/lint-page.js"' in _lint_html and "assets/dist/lint-rules.json" in
      ((HERE / "site" / "lint-page.js").read_text() if (HERE / "site" / "lint-page.js").exists() else ""),
      "lint.html renders the vendored lint-rules.json through site/lint-page.js")

# THE FIRST DEVICE (roc-ops/portrayal-site#19): a visit with no ?device= opens
# on FEATURED_DEVICE, named once in site/featured.js, so it has to stay in the
# library and keep a populated default. If it leaves, the shell falls back to
# the C100G and its empty base without a word; if its default becomes a base,
# the page opens on an empty chassis again. And every page that MAKES A SHELL
# has to ask there: the Explorer and Annotate hand it firstDevice(), and the
# showcase boots on FEATURED_DEVICE in a configuration of its own choosing,
# which is held to one the device has that is not a base. The pages that pick
# a device without a shell are read by the check after these three.
_feat_js = (HERE / "site" / "featured.js").read_text() if (HERE / "site" / "featured.js").is_file() else ""
_fd = re.search(r"export const FEATURED_DEVICE = '([a-z0-9-]+)';", _feat_js)
_fd_name = _fd and _fd.group(1)
_fd_meta = json.loads((DIST / f"{_fd_name}.configs.json").read_text()) \
    if _fd_name and (DIST / f"{_fd_name}.configs.json").is_file() else {}
_fd_kinds = {c.get("name"): c.get("kind") for c in _fd_meta.get("configs", [])}
_fd_kind = _fd_kinds.get(_fd_meta.get("default"))
_fd_listed = _fd_name in {d["name"] for d in json.loads((DIST / "devices.json").read_text())["devices"]}
check(_fd_listed and _fd_kind not in (None, "base")
      and re.search(r"get\('device'\)\s*\|\|\s*FEATURED_DEVICE", _feat_js) is not None,
      f"a first visit opens on {_fd_name}, a listed device whose default ({_fd_meta.get('default')}) is not a base, "
      "and a ?device= still wins",
      f"site/featured.js: FEATURED_DEVICE={_fd_name!r} listed={_fd_listed} default kind={_fd_kind!r}, or "
      "firstDevice() is not ?device= || FEATURED_DEVICE")
# every root page that calls createShell({, so a new shell page cannot open on
# the index's first device without failing here
_shell_pages = sorted(p.name for p in HERE.glob("*.html") if re.search(r"\bcreateShell\(\{", p.read_text()))
_no_first = [n for n in _shell_pages
             if not re.search(r"createShell\(\{[^}]*\bdevice:\s*firstDevice\(\),", (HERE / n).read_text(), re.S)
             or not re.search(r"import \{ firstDevice \} from './site/featured\.js';", (HERE / n).read_text())]
check({"explorer.html", "annotate.html"} <= set(_shell_pages) and not _no_first,
      f"every page that makes a shell ({', '.join(_shell_pages)}) opens on site/featured.js's firstDevice()",
      f"createShell is not given `device: firstDevice()` in {_no_first or 'a page that is gone'}; pages found: {_shell_pages}")
_art_src = (HERE / "site" / "showcase" / "artifact.js").read_text()
_art_cfg = re.search(r"^export const CFG = '([^']+)';", _art_src, re.M)
_art_cfg_name = _art_cfg and _art_cfg.group(1)
check(re.search(r"^import \{FEATURED_DEVICE\} from '\.\./featured\.js';", _art_src, re.M) is not None
      and re.search(r"^export const DEV = FEATURED_DEVICE;", _art_src, re.M) is not None
      and _fd_kinds.get(_art_cfg_name) not in (None, "base"),
      f"the showcase boots on the featured device, in {_art_cfg_name}, a configuration it has that is not a base",
      f"site/showcase/artifact.js: DEV is not FEATURED_DEVICE, or CFG={_art_cfg_name!r} is kind "
      f"{_fd_kinds.get(_art_cfg_name)!r} on {_fd_name}")

# EVERY PAGE THAT OPENS ON A DEVICE, not only the ones that make a shell. The
# export pages read the device index themselves and fell back to its first
# entry; the photo overlay named a device of its own, the schematic prototype a
# vendor. Each asks site/featured.js now, and this holds them to it three ways:
#   - every page ON DISK (the root's *.html and components/*.html) is READ
#     here, with every site/ module it reaches, and the number read is
#     asserted, so a page this could not open cannot pass by contributing
#     nothing. Each is one check-browser.py serves (its PAGES), or is named in
#     _FIRST_NOT_SWEPT with why not; a page in neither fails;
#   - the pages found opening on a device are exactly the ones named below, so
#     a new page that reads ?device= or mounts a device picker fails until it
#     is given a rule and a browser check;
#   - none of what was read falls back to the index's first entry, or to a
#     device named beside the ?device= it reads. THIS ONE IS A SPELLING CHECK:
#     it knows `DEVICES[0]`, `.at(0)`, `.shift()` and a destructured first on
#     the names the pages give the index (DEVICES, devices, devs), and a
#     fallback spelled another way passes it. What catches that is the browser
#     check each page is required to have. featured.js is the one file
#     allowed the first entry, for a link naming a device the library lacks,
#     which lands where it always did.
# Named with the file that asks and the browser check that opens the page.
_FIRST_PAGES = {
    "explorer.html": ("explorer.html", "firstDevice()", "check_explorer_first_device"),
    "annotate.html": ("annotate.html", "firstDevice()", "check_annotate_first_device"),
    "index.html": ("site/showcase/artifact.js", "DEV = FEATURED_DEVICE", "check_showcase_first_device"),
    "exporter.html": ("exporter.html", "firstListed(DEVICES)", "check_exporter_first_device"),
    "drawio.html": ("site/drawio-page.js", "firstListed(DEVICES)", "check_drawio_first_device"),
    "drawings.html": ("site/drawings-page.js", "firstListed(DEVICES)", "check_drawings_first_device"),
    "compare.html": ("compare.html", "firstDevice()", "check_compare_first_device"),
    "schematic.html": ("schematic.html", "firstListed(DEVICES)", "check_schematic_first_device"),
    "viewer3d-harness.html": ("viewer3d-harness.html", "firstListed(devs.map(", "check_harness3d_first_device"),
}
_FEATURED_JS = "site/featured.js"
_SITE_IMPORT = re.compile(r"""(?:\bfrom\s*|\bimport\s*\(?\s*|<script\b[^>]*\bsrc=)['"]([^'"]+\.js)['"]""")
_OPENS_ON = re.compile(r"get\('device'\)|createDevicePicker\(|createShell\(\{|firstDevice\(|firstListed\(|FEATURED_DEVICE")
_FALLS_BACK = re.compile(r"\b(?:DEVICES|devices|devs)\s*(?:\[\s*0\s*\]|\.at\(\s*0\s*\)|\.shift\(\s*\))"
                         r"|\[\s*\w+\s*(?:,[^\]=]*)?\]\s*=\s*(?:DEVICES|devices|devs)\b"
                         r"|get\('device'\)\s*(?:\|\||\?\?)\s*['\"`]")
# On disk and not in check-browser.py's page sweep, with the reason. Read here
# all the same, and held to opening on no device.
_FIRST_NOT_SWEPT = {"kit-frame.html": "hosts one kit recipe inside kit.html's iframe; check_kit_page opens it there"}


def _page_sources(page):
    """{path: text} of a page and every site/ module it reaches by a static
    import or a script tag. vendor/ is Portrayal's and is not followed."""
    seen, todo = {}, [HERE / page]
    while todo:
        f = todo.pop()
        rel = f.relative_to(HERE).as_posix()
        if rel in seen or not f.is_file():
            continue
        seen[rel] = f.read_text()
        for ref in _SITE_IMPORT.findall(seen[rel]):
            # a page's own URLs resolve against the page, a module's against the module
            t = (f.parent / ref).resolve()
            if t.is_relative_to(HERE / "site"):
                todo.append(t)
    return seen


_first_disk = sorted(p.relative_to(HERE).as_posix()
                     for p in list(HERE.glob("*.html")) + list((HERE / "components").glob("*.html")))
_first_unswept = sorted(set(_first_disk) - set(_cb.PAGES) - set(_FIRST_NOT_SWEPT))
_first_gone = sorted((set(_cb.PAGES) | set(_FIRST_NOT_SWEPT)) - set(_first_disk))
_first_read = {pg: _page_sources(pg) for pg in _first_disk}
_first_unread = sorted(pg for pg, src in _first_read.items() if not src.get(pg, "").strip())
_first_found = sorted(pg for pg, src in _first_read.items()
                      if any(_OPENS_ON.search(t) for rel, t in src.items() if rel != _FEATURED_JS))
_first_stray = sorted({f"{rel}: {m.group(0)}" for src in _first_read.values() for rel, t in src.items()
                       if rel != _FEATURED_JS for m in _FALLS_BACK.finditer(t)})
_first_wrong = sorted(
    pg for pg, (asker, call, browser) in _FIRST_PAGES.items()
    if call not in _first_read.get(pg, {}).get(asker, "")
    or _FEATURED_JS not in _first_read.get(pg, {})
    or not re.search(r"\bimport \{\s*(?:firstDevice|firstListed|firstListed, namesDevice|FEATURED_DEVICE)\s*\} from '[./a-z]*featured\.js';",
                     _first_read[pg][asker])
    or browser not in _registered)
_first_rule = re.search(r"if \(!want\) return FEATURED_DEVICE;\n\s*return devices\.some\(d => d\.name === want\) \? want : devices\[0\]\.name;",
                        _feat_js) is not None
# what is wrong first, then what to do about it
_first_faults = [m for bad, m in [
    (_first_unswept, f"{_first_unswept} on disk but neither in check-browser.py's PAGES nor in _FIRST_NOT_SWEPT: "
                     "add the page to PAGES, or name it in _FIRST_NOT_SWEPT with the reason"),
    (_first_gone, f"{_first_gone} named in PAGES or _FIRST_NOT_SWEPT but not on disk: remove the name"),
    (_first_unread, f"{_first_unread} read as empty"),
    (len(_first_read) != 18, f"{len(_first_read)} pages read, 18 expected: a page was added or removed - bump the count here"),
    (_first_found != sorted(_FIRST_PAGES) or len(_first_found) != 9,
     f"the pages that open on a device are not the 9 named: new {sorted(set(_first_found) - set(_FIRST_PAGES))}, "
     f"gone {sorted(set(_FIRST_PAGES) - set(_first_found))}. A new page: have it ask site/featured.js, add it to "
     "_FIRST_PAGES with a check_<page>_first_device in check-browser.py, and bump the count"),
    (_first_stray, f"{_first_stray} falls back to a first device of its own: ask firstDevice() or firstListed() instead"),
    (_first_wrong, f"{_first_wrong} does not import and call site/featured.js in the file _FIRST_PAGES names, "
                   "or its browser check is not registered with @extra"),
    (not _first_rule, "site/featured.js firstListed() is no longer `no device ? FEATURED_DEVICE : listed ? want : "
                      "the first listed`: restore it, or update this check and the browser checks with the new rule"),
] if bad]
check(not _first_faults,
      f"{len(_first_found)} of the {len(_first_read)} pages on disk open on a device, and each asks site/featured.js "
      f"and has a browser check that opens it: {', '.join(_first_found)}",
      "; ".join(_first_faults))

for s in skips:
    print(f"SKIP  {s}")
if problems:
    print("contract: %d checks passed, %d FAILED" % (len(notes), len(problems)))
    for p in problems:
        print("  " + p)
    print("\nEither this site needs updating for a deliberate change over there,")
    print("or something drifted that was not meant to. Both are worth knowing now")
    print("rather than when a page renders wrong.")
    sys.exit(1)

print(f"contract: {len(notes)} checks passed" + (f", {len(skips)} SKIPPED" if skips else ""))
