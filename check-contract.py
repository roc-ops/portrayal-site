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


def check(cond, what, detail=""):
    (notes if cond else problems).append(
        f"{'ok  ' if cond else 'FAIL'}  {what}{('  — ' + detail) if detail and not cond else ''}")
    return cond


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
        got = {n.strip().split(" as ")[0] for n in names.split(",") if n.strip()}
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
# renderer may keep its own.
rails = HERE / "site" / "rack" / "rails.js"
rtxt = rails.read_text() if rails.is_file() else ""
check(bool(rtxt), "site/rack/rails.js exists", "the rail has no single description")
for name in ("RU", "RAIL_W", "OPENING", "HOLE_CC", "HOLE_DY", "HOLE_SQUARE", "HOLE_ROUND", "HOLE_SIZE", "SIDES"):
    check(re.search(rf"export const {name}\b", rtxt) is not None,
          f"rails.js exports {name}", "missing")
shim = (HERE / "site" / "showcase" / "rails.js")
check(shim.is_file() and "export * from '../rack/rails.js'" in shim.read_text()
      and "export const" not in shim.read_text(),
      "site/showcase/rails.js only re-exports site/rack/rails.js",
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
check("from './rack/rails.js'" in r3d, "rack3d.js draws its rails from rails.js")
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
check(bool(n_word) and n_word.group(1) == WORDS.get(len(docs)),
      f"schema.html's intro counts {len(docs)} documents",
      f"it says {n_word.group(1) if n_word else 'nothing'}")
kn = re.search(r"const KNOWN = new Set\(\[([\s\S]*?)\]\)", SJS)
known = set(re.findall(r"'([^']+)'", kn.group(1))) if kn else set()
for name, doc in docs.items():
    unknown = {k: at for k, at in schemawalk.keywords(doc).items() if k not in known}
    check(bool(known) and not unknown,
          f"schema.js renders every keyword {name} uses",
          "new upstream: " + ", ".join(f"{k} (first at {at})" for k, at in sorted(unknown.items()))
          + " - teach site/schema.js to render it, then add it to KNOWN")

# ── the hero: a cabled switch ────────────────────────────────────────────
# The front page's hero is the S9600 with real parts seated in it (spec
# 2026-09-26-hero-cabled-switch §3-§4): no colored marks, no text badges, no
# floating callout, and every link in its table seats parts the drawing's
# cages actually accept.
hero = (HERE / "site" / "hero-reveal.js").read_text()
cab = (HERE / "site" / "rack" / "cables.js").read_text()
check(re.search(r"export const JACKETS\s*=\s*\{", cab) is not None
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
        names |= {n.split(" as ")[-1].strip() for n in grp.split(",") if n.strip()}
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
    for _names, _mod in re.findall(r"import\s*\{([^}]*)\}\s*from\s*'@portrayal/kit/([\w-]+)'", _src):
        _want = {n.split(" as ")[0].strip() for n in _names.split(",") if n.strip()}
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
_snip = next((m for m in re.finditer(r'<pre class="kit-snippet"><code>(.*?)</code></pre>', _kit_html, re.S)
              if "importmap" in m.group(1)), None)
_snipmap = {}
if _snip:
    _raw = _snip.group(1).replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&")
    _js = re.search(r"\{.*\}", _raw, re.S)
    try: _snipmap = json.loads(_js.group(0))["imports"] if _js else {}
    except ValueError: _snipmap = {}
_used = set()
for _stem in _exfiles:
    _used |= set(re.findall(r"from\s*'(@portrayal/kit/[\w-]+)'", (_exdir / f"{_stem}.js").read_text()))
check(bool(_used) and all(u in _snipmap and _snipmap[u].endswith(".js") for u in _used),
      "the 'Getting the files' import map resolves every @portrayal/kit module the recipes import, to a .js file",
      f"recipes use {sorted(_used)}; snippet maps {_snipmap}")
# American English on the kit page, as everywhere in this site's prose.
_kit_prose = _kit_html + _kps + "".join((_exdir / f"{s}.js").read_text() for s in _exfiles)
_brit = sorted(set(re.findall(r"\b(\w*(?:utilis|behaviour|colour|centre|favourite|recognis|organis)\w*)\b", _kit_prose, re.I)))
check(not _brit, "the kit page, its runner and its recipes are in American English", f"{_brit}")

# THE DOCS MENU: Schema and Using the kit, one menu, on every page with a nav.
_DOCS_PAGES = ["index.html", "schema.html", "kit.html", "explorer.html", "components.html",
               "annotate.html", "drawio.html", "exporter.html", "drawings.html", "rack.html"]
for _p in _DOCS_PAGES:
    _t = (HERE / _p).read_text()
    _m = re.search(r'<details class="navmenu"[^>]*data-docs[^>]*>(.*?)</details>', _t, re.S)
    _ok = bool(_m) and 'href="schema.html"' in _m.group(1) and 'href="kit.html"' in _m.group(1) \
          and "<summary>Docs</summary>" in _m.group(1)
    _nav = _t.split("</nav>")[0]
    check(_ok and re.search(r'<a href="schema\.html"[^>]*>Schema</a>', _nav) is None,
          f"{_p}: the header has a Docs menu (Schema, Using the kit) in place of the Schema link",
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

# ── the rack builder's chassis index ───────────────────────────────────────
# The catalog grays out what will not fit, which needs every device's RU and
# depth; those live only in 158 configs.json files (7.9 MB). chassis-index.py
# distils them into site/rack/chassis.json, and refresh-assets.sh regenerates
# it after every sync - this is what fails if a sync forgot to.
import importlib.util as _ilu
_spec = _ilu.spec_from_file_location("chassis_index", HERE / "chassis-index.py")
if _spec and (HERE / "chassis-index.py").is_file():
    _ci = _ilu.module_from_spec(_spec); _spec.loader.exec_module(_ci)
    _out = HERE / "site" / "rack" / "chassis.json"
    check(_out.is_file() and _out.read_text() == _ci.text(),
          "site/rack/chassis.json matches assets/dist", "run ./chassis-index.py")
else:
    check(False, "chassis-index.py exists", "the rack builder's catalog has no sizes")

# RACK-FACE MANAGERS (docs/superpowers/specs/2026-10-07-rack-face-managers-design.md §3):
# the catalog holds the first one, as a 1U sheet part on the rail face, and the
# vendored relief can build a sheet body - without it the part is a solid block
# hiding the ports it serves.
_cat = json.loads((HERE / "site" / "rack" / "chassis.json").read_text())["devices"]
_mgr = _cat.get("fhd-cmp5dr", {})
check(_mgr.get("mount") == "rack-face" and _mgr.get("ru") == 1 and _mgr.get("shell") == "sheet",
      "fhd-cmp5dr is in the catalog as a 1U rack-face sheet part",
      "rebuild /Volumes/External/portrayal-upstream from main and run ./refresh-assets.sh")
check("sheetShell" in (HERE / "vendor" / "relief.js").read_text(),
      "the vendored relief.js builds sheet bodies",
      "run ./refresh-assets.sh against an upstream main that has #827")

# PATHWAYS (docs/superpowers/specs/2026-10-07-cable-routing-pathways-design.md §3):
# the three FS managers, each with the ids a route can pass through. A ring's
# component is on the top view and its end on the front, so both are indexed.
_g = lambda n, v: (_cat.get(n, {}).get("guides") or {}).get(v, [])
check(all(n in _cat for n in ("fhd-cmp5dr", "cmh-4drb1u", "cmh-sfd1u")),
      "the FHD-CMP5DR, CMH-4DRB1U and CMH-SFD1U are in the catalog",
      "rebuild /Volumes/External/portrayal-upstream from main (#852) and run ./refresh-assets.sh")
check(set(_g("fhd-cmp5dr", "top")) >= {f"guide-{i}" for i in range(1, 6)}
      and set(_g("fhd-cmp5dr", "front")) >= {f"guide-{i}" for i in range(1, 6)},
      "fhd-cmp5dr's five rings are indexed on its top and front views",
      "run ./chassis-index.py")
check(bool(_g("cmh-sfd1u", "front")) and bool((_cat.get("cmh-4drb1u", {}).get("passes") or {})),
      "the duct of cmh-sfd1u and the brush pass of cmh-4drb1u are indexed",
      "run ./chassis-index.py")
check(set(_g("cmh-4drb1u", "front")) >= {f"guide-{i}" for i in range(1, 5)},
      "cmh-4drb1u's four D-rings are indexed on its front view",
      "run ./chassis-index.py")
check(_cat.get("fhd-cmp5dr", {}).get("capacity", {}).get("count") == 30,
      "fhd-cmp5dr carries its stated capacity, 30",
      "run ./chassis-index.py")

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
_sb = re.search(r"^/schemas/v1/\*\.json[ \t]*\n((?:[ \t]+.*\n?)*)", _hd, re.M)
check(bool(_sb) and re.search(r"Content-Type:", _sb.group(1)) is None
      and re.search(r"Access-Control-Allow-Origin:\s*\*", _sb.group(1)) is not None
      and not re.search(r"^/schemas/\*\s*$", _hd, re.M),
      "/schemas/v1/*.json is readable from any origin, typed by its extension - no Content-Type rule to mislabel a 404",
      "no /schemas/v1/*.json block with Access-Control-Allow-Origin, a Content-Type override in it, or a broad /schemas/* block")
_schemas = sorted(d for d in _srv if d.startswith("schemas/") and d.endswith(".json"))
check({"schemas/v1/device.schema.json", "schemas/v1/component.schema.json"} <= set(_schemas),
      "the device and component schemas are served under /schemas/v1/", f"{_schemas}")
for _rel in _schemas:
    check(json.loads(_srv[_rel].read_text()).get("$id") == f"https://portrayal.dev/{_rel}",
          f"{_rel}: its $id is the URL it is served at", f"$id {json.loads(_srv[_rel].read_text()).get('$id')!r}")
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
for _m in _pages_md:
    _t = _sp.run([sys.executable, str(HERE / "tools" / "build-public.py"), "--print", f"{_m}.md"], capture_output=True, text=True).stdout
    check(re.match(r'---\ntitle: "[^"\n]+"\n(?:description: "[^\n]+"\n)?url: https://portrayal\.dev/\S*\n---\n\S', _t) is not None
          and "\u2014 devices" not in _t and not re.search(r"\]\((?:https://portrayal\.dev/)?[^)\s]*\.html", _t),
          f"{_m}.md: frontmatter, a body, no runtime placeholder, every site link canonical",
          _t[:200].replace("\n", " | "))
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

# ── zeroU stays empty in every shipped rack fixture ──────────────────────
# Cable managers are items with `on`, never 0U records: `zeroU` is reserved for
# a later phase, so no fixture we ship may put anything in it.
_fx = []
for _p in sorted((HERE / "tools").rglob("*.json")) + sorted((HERE / "site").rglob("*.json")) + sorted((HERE / "tests").rglob("*.json")):
    try:
        _d = json.loads(_p.read_text())
    except Exception:
        continue
    for _r in (_d.get("racks") if isinstance(_d, dict) and isinstance(_d.get("racks"), list) else []):
        if isinstance(_r, dict) and "zeroU" in _r:
            _fx.append((str(_p.relative_to(HERE)), _r["zeroU"]))
_cb = (HERE / "check-browser.py").read_text()
for _m in re.finditer(r'"zeroU":\s*([^\n,]*)', _cb):
    _fx.append((f"check-browser.py fixture #{len(_fx)}", [] if _m.group(1).strip() == "[]" else _m.group(1)))
check(_fx and all(z == [] for _, z in _fx),
      f"zeroU stays empty in every shipped rack fixture ({len(_fx)} found: tools/dcim-verify/acceptance.rack.json and the check-browser.py fixtures)",
      "; ".join(f"{n}: {z!r}" for n, z in _fx if z != []))

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

if problems:
    print("contract: %d checks passed, %d FAILED" % (len(notes), len(problems)))
    for p in problems:
        print("  " + p)
    print("\nEither this site needs updating for a deliberate change over there,")
    print("or something drifted that was not meant to. Both are worth knowing now")
    print("rather than when a page renders wrong.")
    sys.exit(1)

print(f"contract: {len(notes)} checks passed")
