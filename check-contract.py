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
for s in ("inspect", "callouts", "state", "select"):
    p = HERE / "site" / "showcase" / "spokes" / f"{s}.js"
    check(p.is_file(), f"spoke {s}.js exists", "not re-homed yet")
    if p.is_file():
        check("export default function" in p.read_text(),
              f"spoke {s}.js default-exports a factory",
              "a spoke must take {dev, cfg} so it can serve more than one device")

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

# THE CAST IS VENDORED. Stages 1-3 and 6 mount four devices named in
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
        if not cfg or not (DIST / f"{ref}.{cfg}.front.svg").is_file():
            missing.append(f"{ref}.{cfg}.front.svg")
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

# ── stage 4 cables a real topology ───────────────────────────────────────
# labs.json is the ROADM ring: 9 devices, 30 links, each end naming a device
# and a port. It is LOAD-BEARING for stage 4, which is why it is copied with a
# bare cp rather than through the `[ -f ] &&` loop that carries
# vendors/overlays/gaps - those are vendored-but-unread, so a silent miss
# costs nothing, and this one would ship a broken stage behind a green
# refresh. That is the fields.js/optical.js shape, twice in three days.
labs = jload("labs.json")
check(labs is not None, "labs.json is vendored", "stage 4 has no topology to draw")
if labs is not None:
    # PARSED IS NOT USABLE. `{}` and `[]` both parse, and a guard of `if labs:`
    # let `{}` through as vendored while recording none of the checks below -
    # the silent green the bare cp exists to prevent. So once the file parses,
    # all three checks record on every run, and an unusable lab fails all three.
    lablist = labs.get("labs") if isinstance(labs, dict) else None
    ring = (lablist[0] if isinstance(lablist, list) and lablist
            and isinstance(lablist[0], dict) else None)
    if ring is None:
        why = (f"labs.json parsed as {type(labs).__name__}, not an object" if not isinstance(labs, dict)
               else "labs.json has no `labs` list" if not isinstance(lablist, list)
               else "labs.json's `labs` list is empty" if not lablist
               else "labs.json's first lab is not an object")
        check(False, "labs.json's first lab has devices", why)
        check(False, "labs.json's first lab has links", why)
        check(False, "every link endpoint resolves to a drawn data-path", why)
        check(False, "the lab has more than one media to filter by", why)
        check(False, "every link endpoint's port declares a data-group", why)
        check(False, "purpose() classifies every link", why)
    else:
        devs = ring.get("devices") if isinstance(ring.get("devices"), list) else []
        links = ring.get("links") if isinstance(ring.get("links"), list) else []
        check(bool(devs), "labs.json's first lab has devices", "no devices list, or it is empty")
        check(bool(links), "labs.json's first lab has links", "no links list, or it is empty")
        # EVERY CABLE END MUST LAND ON A DRAWN PORT. portAnchor resolves an end
        # by data-path against the compiled faces, so an endpoint naming a port
        # that is not drawn is a cable that silently does not appear. The port
        # is ep[1], never a tx/rx suffix: no vendored face carries one.
        byid = {d.get("id"): d.get("ref") for d in devs if isinstance(d, dict)}
        paths = {}
        for ref in set(v for v in byid.values() if v):
            p = set()
            for f in DIST.glob(f"{ref}.*.svg"):
                p |= set(re.findall(r'data-path="([^"]+)"', f.read_text()))
            paths[ref] = p
        ends = [ep for l in links if isinstance(l, dict) for ep in (l.get("from"), l.get("to"))]
        bad = [str(ep) for ep in ends
               if not (isinstance(ep, list) and len(ep) >= 2
                       and ep[1] in paths.get(byid.get(ep[0]) or "", ()))]
        check(bool(ends) and not bad,
              f"every link endpoint resolves to a drawn data-path ({len(ends) - len(bad)}/{len(ends)})",
              f"{len(bad)} unresolved, e.g. {bad[:3]}" if ends else "no endpoints to resolve")

        # ── stage 5 filters on what the drawing already says ────────────
        # A link's purpose is the group of the ports it connects, and every
        # port these links name carries data-group on its face: eth4 -> mgmt,
        # xc34 -> xc, port-line/port-osc -> line. So purpose filtering needs
        # no upstream field and no table in the page. Asserted because it is
        # the premise of the stage: if a link's port stops carrying a group,
        # the filter silently offers one bucket.
        media = sorted({l["media"] for l in links if isinstance(l, dict) and "media" in l})
        check(len(media) > 1, "the lab has more than one media to filter by",
              f"only {media} - a filter with one value demonstrates nothing")

        groups = {}
        for ref in set(v for v in byid.values() if v):
            for f in DIST.glob(f"{ref}.*.svg"):
                for pth, attrs in re.findall(r'data-path="([^"]+)"([^>]*)', f.read_text()):
                    g = re.search(r'data-group="([^"]+)"', attrs)
                    if g:
                        groups.setdefault((ref, pth), g.group(1))
        ungrouped = [f"{ep[0]}:{ep[1]}" for l in links if isinstance(l, dict)
                     for ep in (l.get("from"), l.get("to"))
                     if isinstance(ep, list) and len(ep) >= 2
                     and (byid.get(ep[0]), ep[1]) not in groups]
        check(not ungrouped, "every link endpoint's port declares a data-group",
              f"{len(ungrouped)} without one, e.g. {ungrouped[:3]} - purpose filtering "
              "reads the group off the face, so a port without one cannot be classified")

        # The same partition ring.js's purpose() derives, recomputed here the
        # same way: `line` splits into a ring span (carries span) or an OSC
        # loop (both ends on the same device), everything else falls through
        # to its own group name. Every link must land in a bucket - an
        # unclassified link would mean the filter's rows silently miss a
        # cable the picture still draws.
        def group_of(ep):
            if not (isinstance(ep, list) and len(ep) >= 2):
                return None
            return groups.get((byid.get(ep[0]), ep[1]))

        def link_purpose(l):
            gf, gt = group_of(l.get("from")), group_of(l.get("to"))
            if gf == "mgmt" or gt == "mgmt":
                return "management"
            g = gf or gt
            if g == "xc":
                return "cross-connect"
            if g == "line":
                f, t = l.get("from"), l.get("to")
                same_dev = isinstance(f, list) and isinstance(t, list) and f[0] == t[0]
                return "ring-span" if l.get("span") else ("osc-loop" if same_dev else "line")
            return g

        classified = [l for l in links if isinstance(l, dict) and link_purpose(l) is not None]
        check(bool(links) and len(classified) == len(links),
              f"purpose() classifies every link ({len(classified)}/{len(links)})",
              f"{len(links) - len(classified)} unclassified" if links else "no links to classify")

# ── one rail, drawn twice ──────────────────────────────────────────────────
# The 2D rails and the 3D posts were two ideas of a rail. The right 2D rail
# was a copy of the left instead of its mirror, so its numbers sat inside and
# its holes outside. rails.js now holds the only description, and neither
# renderer may keep its own.
rails = HERE / "site" / "showcase" / "rails.js"
rtxt = rails.read_text() if rails.is_file() else ""
check(bool(rtxt), "site/showcase/rails.js exists", "the rail has no single description")
for name in ("RU", "RAIL_W", "OPENING", "HOLE_CC", "HOLE_DY", "HOLE_SIZE", "SIDES"):
    check(re.search(rf"export const {name}\b", rtxt) is not None,
          f"rails.js exports {name}", "missing")
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
check("from './showcase/rails.js'" in r3d, "rack3d.js draws its rails from rails.js")
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
# ONE CLICK HELPER. The cast devices and the ring's stubs used to carry two
# copies of the pointer logic, and the stubs' copy lost the double-click
# window. Both now go through svg2d.js's wireClicks; neither keeps its own.
s2d = (HERE / "site" / "showcase" / "svg2d.js").read_text()
r2d_src = (HERE / "site" / "showcase" / "ring2d.js").read_text()
check("export function wireClicks" in s2d and "dblMs" in s2d,
      "svg2d.js exports wireClicks, with a double-click window")
own = [n for n, t in (("spoke-host.js", sh), ("ring2d.js", r2d_src))
       if "wireClicks(" not in t or "'pointerdown'" in t]
check(not own, "wireDevices and the ring stubs both click through wireClicks",
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
check("node.__ptBase = baseFrame" in art and "__ptBase?.()" in art,
      "exports use panZoom's base frame, not the current crop",
      "panZoom must record its base frame and standalone() must apply it to the clone")
check("elevationText" not in stage_txt,
      "no stage keeps its own un-zoom workaround for exports")

# ── the ring in 2D, by site ─────────────────────────────────────────────────
# Sites are the connected components left when the span links are dropped:
# structural, so they survive renamed devices. Parsing "site-a-" out of an id
# is the naming-convention guess this project keeps refusing.
ring_js = (HERE / "site" / "showcase" / "ring.js").read_text()
ring2d = HERE / "site" / "showcase" / "ring2d.js"
r2 = ring2d.read_text() if ring2d.is_file() else ""
check("export function sitesOf" in ring_js, "ring.js exports sitesOf")
check(bool(r2), "site/showcase/ring2d.js exists")
src_ring = ring_js + r2 + "".join((HERE / "site" / "showcase" / "stages" / f).read_text()
                                  for f in ("04-cable.js", "05-filter.js"))
check(not re.search(r"""['"`]site-|\bsite-[a-z]\b|split\(\s*['"]-['"]\s*\)""", src_ring),
      "the ring code parses no site out of device ids", "derive sites from the topology")
# Spec §5.2: every 2D ring stage leads with the one caption, built once.
check("export function siteCaption" in r2
      and all("siteCaption(lab, sites)" in (HERE / "site" / "showcase" / "stages" / f).read_text()
              for f in ("04-cable.js", "05-filter.js")),
      "stages 4 and 5 both caption the 2D ring through ring2d.js's siteCaption")
# One legend per colour drawn: a span strand is drawn in its span's colour,
# so it is counted there and not under its media. Built once, in ring.js.
st45 = [(HERE / "site" / "showcase" / "stages" / f).read_text() for f in ("04-cable.js", "05-filter.js")]
check("export function legendOf" in ring_js
      and re.search(r"l\.media === m && !l\.span", ring_js) is not None
      and all("legendEl(lab)" in t and "MEDIA_COLORS" not in t for t in st45),
      "stages 4 and 5 share ring.js's legend, which counts span strands under their span")
# The stage-4 section assigns `ring` inside a conditional block, so it may
# not exist at all when labs.json is missing. Read it defensively; a
# NameError here would crash the contract instead of recording a FAIL.
lab_ring = globals().get("ring")
if lab_ring is not None:
    ring = lab_ring
    ids = [d["id"] for d in ring["devices"]]
    par = {i: i for i in ids}
    def root(x):
        while par[x] != x:
            x = par[x]
        return x
    for l in ring["links"]:
        if not l.get("span"):
            par[root(l["from"][0])] = root(l["to"][0])
    comps = {}
    for i in ids:
        comps.setdefault(root(i), []).append(i)
    check(len(comps) == 3 and sum(map(len, comps.values())) == len(ids),
          "dropping span links splits the ring into 3 sites covering every device",
          f"got {len(comps)} components")
    # sitesOf takes every ring device as 1 U (a site's top is its highest
    # device's bottom U). That holds only while every ref the ring uses says
    # so in its own index; if one stops, this fails rather than the 2D view
    # quietly clipping a taller device.
    ring_refs = sorted({d.get("ref") for d in ring["devices"]})
    tall = []
    for ref in ring_refs:
        idx = jload(f"{ref}.configs.json")
        ru = ((idx or {}).get("chassis") or {}).get("ru")
        if ru != 1:
            tall.append(f"{ref}: {ru}")
    check(bool(ring_refs) and not tall,
          f"every ring device ref is 1 U ({len(ring_refs) - len(tall)}/{len(ring_refs)})",
          f"not 1 U: {tall} - sitesOf's ruMax assumes 1 U")
else:
    check(False, "dropping span links splits the ring into 3 sites covering every device",
          "labs.json is unusable")
    check(False, "every ring device ref is 1 U", "labs.json is unusable")

# ── explorer's embed mode ────────────────────────────────────────────────
# EXPLORER'S EMBED MODE. The showcase's Inspect lens is Explorer in a frame;
# it talks to the frame only through window.portrayalEmbed.
ex = (HERE / "explorer.html").read_text()
check("get('embed') === '1'" in ex or 'get("embed") === "1"' in ex,
      "explorer.html reads ?embed=1")
for k in ("portrayalEmbed", "ready", "setMode", "current"):
    check(k in ex, f"explorer.html's embed API carries {k}")

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
