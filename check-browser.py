#!/usr/bin/env python3
"""The half of this site's checks that needs a browser.

`check-contract.py` reads files. This opens them, because the failures that
have actually cost time here are not in any file on its own:

  - A vendored module imports a module nobody vendored. The contract check now
    walks that graph statically, but only because a sync shipped exactly that
    and passed 40 checks on a site where every page 404s on its first import.
    A page that loads is the assertion that cannot be fooled by a list.
  - The marks harness has 25 checks and, until now, ran only when somebody
    remembered to open the page and press Run.
  - A page asks for a file that is gitignored. It is there in the tree of
    everyone who has run refresh-assets.sh and in nobody else's, so it works
    for every person who could notice and fails for every person who cannot.
    The front page's hero raster was exactly this. WHICH MEANS: run this on a
    clean checkout to catch that class - CI does, a pre-push hook cannot.

THE GATE IS DELIBERATELY NARROW: a same-origin response of 400 or worse, and an
uncaught exception. Both mean something that should be here is not, or did not
run. Console warnings are NOT a failure - a CI box has no GPU, WebGL falls back
or fails, and a gate that reads console noise on a 3D page would cry wolf until
somebody turned it off. That is the failure mode worth avoiding most.

Run it locally the same way CI does:

    python3 check-browser.py              # starts its own server on a free port
    python3 check-browser.py --url http://localhost:8932   # against one already up
"""
import argparse
import contextlib
import json
import pathlib
import re
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

HERE = pathlib.Path(__file__).resolve().parent

# Every page this repository serves. Named rather than globbed: a page added
# here should be a line in a diff, and a page that goes away should fail this
# list rather than quietly stop being checked.
PAGES = ["index.html", "explorer.html", "annotate.html", "components.html",
         "compare.html", "drawings.html", "drawio.html", "exporter.html",
         "schema.html", "schematic.html", "marks-harness.html",
         "viewer3d-harness.html"]

# REQUESTS THAT ARE MEANT TO MISS. compare.html overlays a photograph on a
# drawing and asks for one per view; this repository has never shipped any, and
# the page is built to carry on without them. Anything else 404ing is a break.
EXPECTED_404 = re.compile(r"/reference/")

# How long a page gets to finish its own loading. The 3D harness fetches a
# device and builds its meshes; the rest are far quicker and are not made
# slower by a ceiling they never reach.
SETTLE_MS = 9000

# How long a stage, or a spoke, gets to say it is ready. 60 seconds accounts for
# slow CI runners: stage 4 measured 5-17s on a loaded machine, and a GitHub
# runner renders WebGL on the CPU.
READY_MS = 60000

# How long a stage gets in 3D. The first entry into 3D compiles WebGL shaders,
# and on a cold or loaded machine - or a runner rendering on the CPU - that
# alone has taken most of READY_MS; the ring's 3D mount then builds nine
# devices and thirty tubes on top of it. A separate, longer budget keeps the
# 3D walk from flaking without loosening every 2D wait.
READY_3D_MS = 120000

# THE CAST, READ FROM rack.js - the configuration each cast device is cast in,
# parsed the way check-contract.py parses it, so the Inspect lens is held to
# what the rack says rather than to a copy written here that could drift.
def cast_cfgs():
    src = (HERE / "site" / "showcase" / "rack.js").read_text()
    m = re.search(r"export const CAST\s*=\s*\[(.*?)\];", src, re.S)
    out = {}
    for body in re.findall(r"\{([^}]*)\}", m.group(1) if m else ""):
        ref = re.search(r"\bref\s*:\s*'([^']+)'", body)
        cfg = re.search(r"\bcfg\s*:\s*'([^']+)'", body)
        if ref and cfg:
            out[ref.group(1)] = cfg.group(1)
    return out


def free_port():
    with contextlib.closing(socket.socket()) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def wait_for(url, timeout=30):
    end = time.time() + timeout
    while time.time() < end:
        try:
            with urllib.request.urlopen(url) as r:
                if r.status == 200:
                    return True
        except (urllib.error.URLError, ConnectionError):
            time.sleep(0.2)
    return False


def check(page, base, name):
    """Open one page; return its problems as a list of strings."""
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))

    def on_response(r):
        if r.status >= 400 and r.url.startswith(base) and not EXPECTED_404.search(r.url):
            bad.append(f"{r.status} {r.url[len(base):]}")

    page.on("response", on_response)
    page.goto(f"{base}/{name}", wait_until="load")
    page.wait_for_timeout(SETTLE_MS)
    return bad


# EVERY STAGE, NOT JUST THE ONE THAT LOADS. This checker used to open a page
# and stop, so on index.html only the default tab's enter() ever ran and six
# tabs' code never executed here at all. The staged showcase puts every stage
# behind a click and each fetches its own artifacts, so a mistyped path would
# pass the contract, pass this check, and 404 on first open - the fields.js /
# optical.js shape again.
#
# Safe without a GPU: site/webgl.js's webglTrouble() returns a sentence rather
# than letting three.js throw, and this checker fails only on uncaught errors
# and 4xx. The 3D stages contribute real 404 coverage with nothing rendered.
#
# This list must match the STAGES list in site/showcase/stage-rail.js in both
# content and order. check-contract.py verifies the rail against the stage files,
# not against this list, so a mismatch here would silently skip stages.
STAGES = ["rails", "mount", "populate", "optics", "cable", "filter", "takeaway"]


def slot_bays():
    """The ASR-9006's `slots` group, read off the index stage 2 reads."""
    idx = json.loads((HERE / "assets" / "dist" / "asr-9006.configs.json").read_text())
    return [b for b in idx.get("bays", {}).get("front", []) if b.get("group") == "slots"]


def accepted_card(bay_id):
    """A card `bay_id` accepts other than its slot cover, read off the index."""
    idx = json.loads((HERE / "assets" / "dist" / "asr-9006.configs.json").read_text())
    bay = next((b for b in idx.get("bays", {}).get("front", []) if b.get("id") == bay_id), None)
    return next((r for r in (bay or {}).get("accepts", []) if r != bay.get("default")), None)


def management_by_site():
    """How many management links each 2D ring site draws, in sitesOf's order.

    Recomputed here from the data, the way ring.js does it, so the filter
    assertion checks the page against the lab rather than against a number
    the page wrote itself. A site is a connected component once the span
    links are dropped, ordered top to bottom by its highest U. A link is
    management when either end's port is in the mgmt group on its device's
    default-config faces (ring.js's loadGroupMaps). A site draws a link as a
    cable when both ends are in it, as a stub when one is.
    """
    lab = json.loads((HERE / "assets" / "dist" / "labs.json").read_text())["labs"][0]
    devs = {d["id"]: d for d in lab["devices"]}
    par = {i: i for i in devs}

    def root(x):
        while par[x] != x:
            x = par[x]
        return x
    for l in lab["links"]:
        if not l.get("span"):
            a, b = root(l["from"][0]), root(l["to"][0])
            if a != b:
                par[a] = b
    comps = {}
    for i in devs:
        comps.setdefault(root(i), set()).add(i)
    sites = sorted(comps.values(), key=lambda ids: -max(devs[i]["ru"] for i in ids))

    groups = {}
    for ref in {d["ref"] for d in devs.values()}:
        idx = json.loads((HERE / "assets" / "dist" / f"{ref}.configs.json").read_text())
        g = {}
        for view in idx.get("views", []):
            f = HERE / "assets" / "dist" / f"{ref}.{idx['default']}.{view}.svg"
            if not f.is_file():
                continue
            for tag in re.findall(r"<[^>]+>", f.read_text()):
                pth = re.search(r'\sdata-path="([^"]+)"', tag)
                grp = re.search(r'\sdata-group="([^"]+)"', tag)
                if pth and grp:
                    g[pth.group(1)] = grp.group(1)
        groups[ref] = g

    def mgmt(l):
        return any(groups.get(devs[ep[0]]["ref"], {}).get(ep[1]) == "mgmt" for ep in (l["from"], l["to"]))
    return [sum(1 for l in lab["links"] if mgmt(l) and (l["from"][0] in ids or l["to"][0] in ids))
            for ids in sites]


def check_embed(page, base):
    """explorer.html?embed=1: the site bar and mode buttons hidden, the API live."""
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    page.goto(f"{base}/explorer.html?embed=1&device=r740xd&view=front", wait_until="load")
    try:
        # SYNCHRONOUS: the showcase reads window.portrayalEmbed off this same
        # `load` event, before it ever awaits `.ready`. If the object only
        # showed up later, that read would find nothing.
        if not page.evaluate("() => !!window.portrayalEmbed"):
            bad.append("embed: window.portrayalEmbed missing at load")
        early = page.evaluate("() => window.portrayalEmbed.current()")
        if not isinstance(early, dict):
            bad.append(f"embed: current() before ready returned {early!r}")
        cur = page.evaluate("async () => { await window.portrayalEmbed.ready; return window.portrayalEmbed.current(); }")
        if cur.get("device") != "r740xd":
            bad.append(f"embed: current().device is {cur.get('device')!r}")
        for sel in (".site-bar", "#mode"):
            if page.is_visible(sel):
                bad.append(f"embed: {sel} is visible")
    except Exception as e:
        bad.append(f"embed: {e}")
    return bad


def check_stages(page, base):
    """Walk the stage rail, waiting on each stage's own ready signal, and
    exercise what each stage claims - not only that it loads."""
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))

    def on_response(r):
        if r.status >= 400 and r.url.startswith(base) and not EXPECTED_404.search(r.url):
            bad.append(f"{r.status} {r.url[len(base):]}")

    page.on("response", on_response)
    page.goto(f"{base}/index.html", wait_until="load")

    # WHAT EACH STAGE CLAIMS, driven the way a visitor would. Every one runs
    # on the same page as the walk, so a 404 it causes - stage 3's skin fetch,
    # say - lands in the same listener. Without WebGL these still run: the
    # panel is built either way (R11), and it is the panel that answers.
    def populate():
        # EACH SLOT OFFERS EXACTLY WHAT IT ACCEPTS - the index's own list, the
        # slot cover included - and nothing another slot takes. The empty
        # option appears only for a bay emptied in the Inspect lens, which
        # has not happened yet on this walk.
        for b in slot_bays():
            want = sorted(b.get("accepts", []))
            got = sorted(page.eval_on_selector_all(
                f'#sidePanel select[data-bay="{b["id"]}"] option', "os => os.map(o => o.value)"))
            if got != want:
                bad.append(f"stage populate: {b['id']} offers {got}, but accepts {want}")
        # Headed by what the cards are, per the component index's roles.
        names = page.eval_on_selector_all('#sidePanel .bay-set-name', "ns => ns.map(n => n.textContent)")
        if not any(n.startswith("Route switch processors") for n in names) \
                or not any(n.startswith("Line cards") for n in names):
            bad.append(f"stage populate: the slot sets are not headed by their cards' roles ({names})")
        # Choosing seats: a route processor in slot-0, the slot a line card
        # could never be offered for, and a line card in slot-2. The readout
        # is painted only after the queued redraw, so the drawing is there by
        # the time it says "seated".
        for bay, ref in (("slot-0", accepted_card("slot-0")), ("slot-2", accepted_card("slot-2"))):
            if not ref:
                raise RuntimeError(f"no card {bay} accepts")
            page.select_option(f'#sidePanel select[data-bay="{bay}"]', ref, timeout=READY_MS)
            page.wait_for_function(
                """(b) => { const r = document.querySelector('#sidePanel [data-readout]:not([data-busy])');
                    return !!r && r.textContent.startsWith('seated — ' + b + ':'); }""",
                arg=bay, timeout=READY_MS)
            if not page.query_selector(f'#stageRack svg [data-device-ref="asr-9006"] '
                                       f'[data-path="{bay}/module"][data-ref^="{ref}"]'):
                bad.append(f"stage populate in 2D: {ref} chosen for {bay} is not drawn there")
            if page.eval_on_selector(f'#sidePanel select[data-bay="{bay}"]', "s => s.value") != ref:
                bad.append(f"stage populate: {bay}'s menu does not show the card it now holds")

    def kept_card():
        # A card the visitor chose is kept: seat a different line card in
        # slot-2 on stage 2, then stage 4 must keep it and name the loose ends.
        page.click('.stage-rail button[data-stage="populate"]')
        page.wait_for_selector('[data-stage-ready="populate"]', timeout=READY_MS)
        slot2 = next(b for b in slot_bays() if b["id"] == "slot-2")
        other = next(r for r in slot2["accepts"]
                     if r not in ("cisco/a9k-16x100ge-tr@1", "cisco/a9k-slot-cover@1"))
        page.select_option('#sidePanel select[data-bay="slot-2"]', other, timeout=READY_MS)
        page.wait_for_function("() => document.querySelector('#sidePanel [data-readout]')?.textContent.startsWith('seated — slot-2')", timeout=READY_MS)
        page.click('.stage-rail button[data-stage="cable"]')
        page.wait_for_selector('[data-stage-ready="cable"]', timeout=READY_MS)
        if not page.query_selector(f'#stageRack svg [data-device-ref="asr-9006"] [data-path="slot-2/module"][data-ref^="{other}"]'):
            bad.append("fill rule: stage 4 replaced the visitor's slot-2 card")
        loose = page.eval_on_selector_all('#sidePanel [data-loose]', "ls => ls.map(l => l.textContent)")
        if len(loose) != 4 or not all("seat it in stage 2" in t for t in loose):
            bad.append(f"fill rule: expected 4 named loose ends on slot-2, got {loose}")
        # Put the plan's card back, for the rest of the walk.
        page.click('.stage-rail button[data-stage="populate"]')
        page.wait_for_selector('[data-stage-ready="populate"]', timeout=READY_MS)
        page.select_option('#sidePanel select[data-bay="slot-2"]', "cisco/a9k-16x100ge-tr@1", timeout=READY_MS)
        page.wait_for_function("() => document.querySelector('#sidePanel [data-readout]')?.textContent.startsWith('seated — slot-2')", timeout=READY_MS)

    def cable_2d():
        # All fourteen are drawn on front or rear, every fiber end on a plug.
        page.wait_for_selector('#stageRack svg [data-cables="front"]', timeout=READY_MS)
        front = page.eval_on_selector_all('#stageRack svg [data-cable]', "gs => gs.map(g => g.dataset.linkIndex)")
        tagged = page.eval_on_selector_all('#stageRack svg [data-tag]', "ts => ts.length")
        if len(front) != 14:
            bad.append(f"stage cable in 2D: {len(front)} of 14 cables drawn on the front")
        if tagged != 2 + 1:   # two server links and the iDRAC run to the rear
            bad.append(f"stage cable in 2D: {tagged} rear tags on the front, expected 3")
        if page.query_selector('#sidePanel [data-loose]'):
            bad.append("stage cable in 2D: a loose end on a fresh rack: " +
                       page.inner_text('#sidePanel .plan-list'))
        if "not a real lab" not in page.inner_text('#sidePanel'):
            bad.append("stage cable: the panel does not say the plan is invented")
        # The plan's card is in slot-2, and its connectors are what the cables start on.
        if not page.query_selector('#stageRack svg [data-device-ref="asr-9006"] '
                                   '[data-path="slot-2/module"][data-ref^="cisco/a9k-16x100ge-tr@1"]'):
            bad.append("stage cable: slot-2 does not hold the plan's A9K-16X100GE-TR")
        # Front/Rear: the server tag flips to the rear, where that cable lands on the NIC.
        page.click('#stageRack svg [data-tag^="r740xd:ndc/module/port-1"]')
        page.wait_for_selector('#stageRack svg [data-cables="rear"]', timeout=READY_MS)
        if page.get_attribute('#stageTabs [data-view="rear"]', "aria-selected") != "true":
            bad.append("stage cable: the rear tag did not select Rear")
        if not page.query_selector('#stageRack svg [data-cables="rear"] [data-cable][data-link-index="8"]'):
            bad.append("stage cable: on the rear, the R740xd NIC 1 cable is not drawn")
        page.click('#stageTabs [data-view="front"]')
        page.wait_for_selector('#stageRack svg [data-cables="front"]', timeout=READY_MS)

    def seat_optic():
        page.click('#sidePanel [data-seat]', timeout=READY_MS)
        page.wait_for_selector('#sidePanel [data-readout][data-seated]', timeout=READY_MS)
        if not page.query_selector('#stageRack svg [data-highlight]'):
            bad.append("stage optics in 2D: the seated optic's TX bore is not highlighted on the face")
        # And big enough to find: the stage opens framed on the switch.
        side = page.evaluate("""() => { const r = document.querySelector('#stageRack svg [data-highlight-box]');
            if (!r) return 0; const b = r.getBoundingClientRect(); return Math.min(b.width, b.height); }""")
        if side < 8:
            bad.append(f"stage optics in 2D: the highlight is {side:.1f} px on its shorter side (< 8)")

    def filter_management():
        # The expected count is the one the management button itself states,
        # read off the page, and the total is the lab's own link count - so a
        # new labs.json moves both without this line changing.
        btn = page.locator('#sidePanel .ctl button', has_text=re.compile(r"^management \(\d+\)$"))
        want = int(re.search(r"\((\d+)\)", btn.inner_text(timeout=READY_MS)).group(1))
        btn.click(timeout=READY_MS)
        total = len(json.loads((HERE / "assets" / "dist" / "labs.json").read_text())["labs"][0]["links"])
        page.wait_for_function(
            """([w, t]) => { const c = document.querySelector('#sidePanel [data-filter-count]');
                return !!c && c.dataset.matching === String(w) && c.dataset.total === String(t); }""",
            arg=[want, total], timeout=READY_MS)

    CLAIMS = {
        "populate": ("every slot offers only what it accepts, and a choice seats", populate),
        "optics": ("an optic seats and reads back", seat_optic),
        "cable": ("every cable is drawn, and the rear tag flips the face", cable_2d),
        "filter": ("management filters the count", filter_management),
    }

    for name in STAGES:
        try:
            page.click(f'.stage-rail button[data-stage="{name}"]', timeout=READY_MS)
            # Set by the rail only after enter() resolves, so a stage whose
            # enter() throws never sets it and this times out naming the stage
            # rather than passing quietly.
            page.wait_for_selector(f'[data-stage-ready="{name}"]', timeout=READY_MS)
        except Exception:
            bad.append(f"stage {name} never became ready")
            continue
        if name == "rails":
            geo = page.evaluate("""() => {
              const c = el => { const b = el.getBBox(); return b.x + b.width / 2; };
              const q = (k, s) => document.querySelector(`#stageRack [data-rail-${k}="${s}"]`);
              const out = {};
              for (const s of ['left', 'right']) {
                const h = q('hole', s), n = q('num', s);
                out[s] = h && n ? {hole: c(h), num: c(n)} : null;
              }
              return out;
            }""")
            ok = (geo.get("left") and geo.get("right")
                  and geo["left"]["num"] < geo["left"]["hole"]      # numbers outboard (left of the hole) on the left rail
                  and geo["right"]["num"] > geo["right"]["hole"])   # and to its right on the right rail
            if not ok:
                bad.append(f"stage rails: rail numbers are not outboard of the holes on both rails: {geo}")
        if name in CLAIMS:
            what, run = CLAIMS[name]
            try:
                run()
            except Exception as e:
                bad.append(f"stage {name}: {what} - failed ({str(e).splitlines()[0]})")
        if name == "filter":
            # Spec §5.2: in 2D a site looks like a rack of its own, so a
            # stage that draws the ring by site says it is not one. Stage 4
            # cables the cast rack now; only stage 5 still draws the ring.
            try:
                cap = page.inner_text('#sidePanel [data-site-caption]', timeout=READY_MS)
                if "Physically" not in cap:
                    bad.append(f"stage {name} in 2D: the site caption does not say the rack is shared: {cap!r}")
            except Exception as e:
                bad.append(f"stage {name} in 2D: no site caption in the panel ({str(e).splitlines()[0]})")
        if name == "filter":
            try:
                vis = page.evaluate("""() => [...document.querySelectorAll(
                    '#stageRack [data-cable], #stageRack [data-stub]')]
                    .filter(n => getComputedStyle(n).display !== 'none' && n.getAttribute('visibility') !== 'hidden').length""")
                # 05-filter.js sets data-visible-cables on the panel element itself.
                if vis != int(page.get_attribute('#sidePanel', 'data-visible-cables') or -1):
                    bad.append(f"stage filter in 2D: the drawn count ({vis}) and data-visible-cables disagree")
                # And against the lab, not just against itself: with
                # "management" on, what is visible in the current site is that
                # site's management links, recomputed above from the data.
                at = int(page.get_attribute('#stageTabs [aria-selected="true"]', 'data-tab-index'))
                want = management_by_site()[at]
                if vis != want:
                    bad.append(f"stage filter in 2D: site {at} shows {vis} with management on; "
                               f"the lab has {want} management links there")
            except Exception as e:
                bad.append(f"stage filter in 2D: {e}")

    # THE FILL RULE, once, after the stage walk: a card the visitor seats is
    # kept, and its cables are named loose ends.
    try:
        kept_card()
    except Exception as e:
        bad.append(f"fill rule: a visitor's slot-2 card - failed ({str(e).splitlines()[0]})")

    # Which layer is showing: in 2D the rack drawing and no 3D pane; in 3D the
    # 3D pane and a rack layer that is hidden or empty (stage 6 keeps a
    # hidden elevation there for its exports).
    def layers_are(m):
        return page.evaluate("""m => {
          const r = document.getElementById('stageRack'), t = document.getElementById('stage3d');
          return m === '3d' ? (r.hidden || !r.childElementCount) && !t.hidden
                            : !r.hidden && !!r.querySelector('svg') && t.hidden;
        }""", m)

    # THE SWITCH. 2D is the default; flip stage 1 to 3D, confirm the choice
    # follows to stage 2, then exercise stages 3 and 4 in 3D too (R12): the
    # seat's readout, which in 3D goes through portAnchor, and the patched
    # cast rack (patch-view.js). Then flip back. Each re-entry must reach ready.
    def seat_optic_3d():
        page.click('#sidePanel [data-seat]', timeout=READY_3D_MS)
        # The readout says "seated" only once THIS seat's rebuild ran (the
        # panel it opened on may already carry data-seated from the 2D walk).
        page.wait_for_function(
            """() => { const r = document.querySelector('#sidePanel [data-readout][data-seated]');
                return !!r && r.textContent.startsWith('seated'); }""", timeout=READY_3D_MS)
        text = page.inner_text('#sidePanel')
        # With a scene, portAnchor's position; without WebGL, the panel says
        # so (R11). Anything else - "found no matching path" - is a break.
        if not (re.search(r"x -?\d+\.\d, y -?\d+\.\d, z -?\d+\.\d mm", text)
                or "3D is unavailable in this browser" in text):
            bad.append("stage optics in 3D: the seated optic's tx has neither a position nor "
                       "an 'unavailable' note")

    try:
        if page.get_attribute('#stageMode [data-mode="2d"]', "aria-pressed") != "true":
            bad.append("the switch does not default to 2D")
        page.click('.stage-rail button[data-stage="mount"]')
        page.wait_for_selector('[data-stage-ready="mount"]', timeout=READY_MS)
        if not page.query_selector('#stageRack svg [data-device-ref]'):
            bad.append("stage mount in 2D draws no devices")
        page.click('#stageMode [data-mode="3d"]')
        page.wait_for_selector('[data-stage-ready="mount"]', timeout=READY_3D_MS)
        if not layers_are("3d"):
            bad.append("stage mount: switching to 3D left the 2D drawing showing")
        page.click('.stage-rail button[data-stage="populate"]')
        page.wait_for_selector('[data-stage-ready="populate"]', timeout=READY_3D_MS)
        if page.get_attribute('#stageMode [data-mode="3d"]', "aria-pressed") != "true":
            bad.append("the 3D choice did not follow to the next stage")
        if not layers_are("3d"):
            bad.append("stage populate in 3D: the 2D drawing is showing")
        for name in ("optics", "cable"):
            try:
                page.click(f'.stage-rail button[data-stage="{name}"]', timeout=READY_3D_MS)
                page.wait_for_selector(f'[data-stage-ready="{name}"]', timeout=READY_3D_MS)
                if not layers_are("3d"):
                    bad.append(f"stage {name} in 3D: the 2D drawing is showing")
                if name == "optics":
                    seat_optic_3d()
            except Exception as e:
                bad.append(f"stage {name} in 3D: {str(e).splitlines()[0]}")
        page.click('#stageMode [data-mode="2d"]')
        page.wait_for_selector('[data-stage-ready="cable"]', timeout=READY_MS)
        if not layers_are("2d"):
            bad.append("stage cable: switching back to 2D did not replace the 3D picture")
    except Exception as e:
        bad.append(f"the 2D/3D switch: {str(e).splitlines()[0]}")
    finally:
        # Never leave '3d' stored for the spoke walk below, whatever failed -
        # and wait for the stage to come back in 2D, so the walk starts from a
        # ready page. A failure here is recorded, not swallowed.
        try:
            if page.get_attribute('#stageMode [data-mode="2d"]', "aria-pressed") != "true":
                page.click('#stageMode [data-mode="2d"]', timeout=READY_MS)
            at = page.get_attribute('.stage-rail [data-stage][aria-selected="true"]', "data-stage")
            page.wait_for_selector(f'[data-stage-ready="{at}"]', timeout=READY_3D_MS)
        except Exception as e:
            bad.append(f"the 2D/3D switch: could not restore 2D ({str(e).splitlines()[0]})")

    # A SPOKE IS A RENDERER SWITCH, so open one and come back, from stage 2 -
    # Inspect on the AS7726 (whose drawing the page booted with) and on the
    # ASR-9006, which makes the 2D face actually change device, then each
    # AS7726-only lens once, so their code runs here at all. The return waits
    # on the stage's own ready signal again, because the breadcrumb re-enters
    # the stage rather than just un-hiding it.
    spokes = [("as7726-32x", "inspect"), ("asr-9006", "inspect"),
              ("as7726-32x", "callouts"), ("as7726-32x", "state"), ("as7726-32x", "select")]
    try:
        page.click('.stage-rail button[data-stage="populate"]', timeout=READY_MS)
    except Exception:
        bad.append("could not return to stage 2 for the spokes")
    # LOOK CLOSER, BOTH WAYS IN. By the drawing: stage 2 is in 2D by default,
    # and every device is a real element.
    try:
        page.click('.stage-rail button[data-stage="populate"]')
        page.wait_for_selector('[data-stage-ready="populate"]', timeout=READY_MS)
        page.click('#stageRack svg [data-device-ref="as7726-32x"]')
        page.wait_for_selector('#spokeCrumb:not([hidden])', timeout=READY_MS)
        page.click('#spokeBack')
        page.wait_for_selector('[data-stage-ready="populate"]', timeout=READY_MS)
    except Exception as e:
        bad.append(f"clicking the AS7726-32X on stage 2's drawing did not open a spoke and return ({str(e).splitlines()[0]})")
    # By the strip: always visible under the stage. The walk below opens every
    # other spoke from its buttons.
    if not page.is_visible('#lookStrip'):
        bad.append("the look strip is not visible on a cast stage")
    for dev, lens in spokes:
        try:
            page.wait_for_selector('[data-stage-ready="populate"]', timeout=READY_MS)
            page.click(f'#lookStrip [data-spoke-device="{dev}"][data-spoke-lens="{lens}"]',
                       timeout=READY_MS)
            page.wait_for_selector('.spoke-crumb:not([hidden]) button', timeout=READY_MS)
            page.click('.spoke-crumb button', timeout=READY_MS)
            page.wait_for_selector('[data-stage-ready="populate"]', timeout=READY_MS)
        except Exception:
            bad.append(f"the {lens} spoke on {dev} did not open from stage 2 and return")

    # INSPECT IS EXPLORER. Open it on the ASR-9006 from stage 2, seat a line
    # card through Explorer's own occupant dropdown, come back, and the rack
    # has it. The frame is driven through Explorer's UI because that is how a
    # person uses it; the showcase itself talks to it only via portrayalEmbed.
    #
    # EVERY INSPECT OPENS ON ITS CAST CONFIGURATION. explorer_frame(dev) holds
    # the frame, once Explorer is ready, to the device it was opened for and to
    # that device's cfg in rack.js's CAST - the configuration the rack draws,
    # and the only one whose swaps come back. All five cast devices are opened
    # below, so all five are held to it.
    cast = cast_cfgs()
    if len(cast) != 5:
        bad.append(f"inspect frame: could not read the five cast configurations from rack.js ({cast})")
    opened_on_cast = set()
    def explorer_frame(dev):
        fr = None
        for _ in range(100):
            fr = next((f for f in page.frames if "explorer.html" in f.url), None)
            if fr: break
            page.wait_for_timeout(100)
        if not fr:
            raise RuntimeError("no explorer.html frame")
        fr.wait_for_function("() => window.portrayalEmbed", timeout=READY_3D_MS)
        fr.evaluate("async () => { await window.portrayalEmbed.ready; }")
        cur = fr.evaluate("() => window.portrayalEmbed.current()")
        if cur.get("device") != dev:
            bad.append(f"inspect frame: opened for {dev} but Explorer has {cur.get('device')}")
        elif cur.get("config") != cast.get(dev):
            bad.append(f"inspect frame: {dev} opened on {cur.get('config')}, not its cast "
                       f"configuration {cast.get(dev)}")
        else:
            opened_on_cast.add(dev)
        return fr
    try:
        page.click('.stage-rail button[data-stage="populate"]')
        page.wait_for_selector('[data-stage-ready="populate"]', timeout=READY_MS)
        page.click('[data-spoke-device="asr-9006"][data-spoke-lens="inspect"]')
        page.wait_for_selector('#lensFrame iframe', state="visible", timeout=READY_3D_MS)
        fr = explorer_frame("asr-9006")
        if fr.is_visible(".site-bar") or fr.is_visible("#devpick") or fr.is_visible("#mode"):
            bad.append("inspect frame: site bar, device picker or mode buttons visible")
        # slot-3 accepts line cards (asr-9006 index); a9k-4x100ge-se@1 is one of them.
        # Picked from Explorer's TREE, not its drawing: the bay is filled edge to
        # edge by its slot cover, so a click on the drawing selects the cover
        # (slot-3/module), whose inspector has no occupant menu.
        fr.click('#tree .node[data-path="slot-3"]')
        fr.wait_for_selector("#occ", timeout=READY_MS)
        fr.select_option("#occ", "cisco/a9k-4x100ge-se@1")
        fr.wait_for_function(
            "() => window.portrayalEmbed.current().swaps['slot-3'] === 'cisco/a9k-4x100ge-se@1'",
            timeout=READY_MS)
        # And EMPTY one: slot-2's occupant set to "— open —" in Explorer's own
        # menu. Explorer reports that as a present-but-null swap.
        fr.click('#tree .node[data-path="slot-2"]')
        fr.wait_for_selector("#occ", timeout=READY_MS)
        fr.select_option("#occ", "")
        fr.wait_for_function(
            "() => Object.hasOwn(window.portrayalEmbed.current().swaps, 'slot-2')"
            " && !window.portrayalEmbed.current().swaps['slot-2']", timeout=READY_MS)
        # The showcase's switch drives the frame.
        page.click('#stageMode [data-mode="3d"]')
        fr.wait_for_function("() => window.portrayalEmbed.current().mode === '3d'", timeout=READY_3D_MS)
        if not fr.is_visible("#stage-3d"):
            bad.append("inspect frame: 3D selected but Explorer's 3D stage is hidden")
        page.click('#stageMode [data-mode="2d"]')
        fr.wait_for_function("() => window.portrayalEmbed.current().mode === '2d'", timeout=READY_MS)
        page.click('#spokeBack')
        page.wait_for_selector('[data-stage-ready="populate"]', timeout=READY_MS)
        if page.query_selector('#lensFrame iframe') or page.is_visible('#lensFrame'):
            bad.append("inspect frame: the frame outlived the lens")
        # PROVEN ON THE RACK, NOT ON ANY TEXT: slot-3's own menu must hold
        # the card, and the drawing must seat it.
        row = lambda slot: page.eval_on_selector(
            f'#sidePanel select[data-bay="{slot}"]',
            "s => s.selectedOptions[0]?.textContent || ''")
        seated = row("slot-3")
        if "a9k-4x100ge-se" not in seated:
            bad.append(f"inspect frame: stage 2's slot-3 menu does not show the card ({seated})")
        # The emptied bay: listed as empty, and drawn empty - not its default.
        if "empty" not in row("slot-2"):
            bad.append(f"inspect frame: a bay emptied in Explorer is not shown as empty ({row('slot-2')})")
        if page.query_selector('#stageRack svg [data-device-ref="asr-9006"] [data-path="slot-2/module"]'):
            bad.append("inspect frame: a bay emptied in Explorer is still drawn filled")
        if not page.query_selector('#stageRack svg [data-device-ref="asr-9006"] '
                                   '[data-path="slot-3/module"][data-ref^="cisco/a9k-4x100ge-se@1"]'):
            bad.append("inspect frame: a card seated in Explorer did not come back to the rack's drawing")
        # ONLY LOOKING AT ANOTHER CONFIGURATION IS NOT A SWAP (R3). Switch the
        # FHD to base inside the lens, seat nothing, close: nothing stayed in
        # the lens, so nothing may say it did.
        page.click('[data-spoke-device="fhd-1ufce"][data-spoke-lens="inspect"]')
        page.wait_for_selector('#lensFrame iframe', state="visible", timeout=READY_3D_MS)
        fr = explorer_frame("fhd-1ufce")
        fr.select_option("#cfg", "base")
        fr.wait_for_function("() => window.portrayalEmbed.current().config === 'base'", timeout=READY_MS)
        if fr.evaluate("() => Object.keys(window.portrayalEmbed.current().swaps).length"):
            bad.append("inspect frame: switching the FHD to base alone reported swaps")
        page.wait_for_selector('.spoke-crumb:not([hidden]) button', timeout=READY_MS)
        page.click('#spokeBack')
        page.wait_for_selector('[data-stage-ready="populate"]', timeout=READY_MS)
        if "stayed in the lens" in page.inner_text("#sidePanel"):
            bad.append("inspect frame: a config looked at, with no swaps, still gave the "
                       "\"stayed in the lens\" notice")
        # The config rule: switch the FHD to its empty base inside the lens,
        # close, and the rack is unchanged with a notice saying why.
        page.click('[data-spoke-device="fhd-1ufce"][data-spoke-lens="inspect"]')
        page.wait_for_selector('#lensFrame iframe', state="visible", timeout=READY_3D_MS)
        fr = explorer_frame("fhd-1ufce")
        fr.select_option("#cfg", "base")
        fr.wait_for_function("() => window.portrayalEmbed.current().config === 'base'", timeout=READY_MS)
        # A real swap on that other configuration - a splice cassette in bay-1 -
        # so a write-back that ignored the rule would show on the rack.
        fr.click('#tree .node[data-path="bay-1"]')
        fr.wait_for_selector("#occ", timeout=READY_MS)
        fr.select_option("#occ", "fs/fhd-splice-12-lc@3")
        fr.wait_for_function(
            "() => window.portrayalEmbed.current().swaps['bay-1'] === 'fs/fhd-splice-12-lc@3'",
            timeout=READY_MS)
        page.wait_for_selector('.spoke-crumb:not([hidden]) button', timeout=READY_MS)
        page.click('#spokeBack')
        page.wait_for_selector('[data-stage-ready="populate"]', timeout=READY_MS)
        if "stayed in the lens" not in page.inner_text("#sidePanel"):
            bad.append("inspect frame: switching config in the lens gave no notice")
        # AND THE RACK IS UNCHANGED - read off the drawing, not off `overrides`:
        # the FHD is still drawn populated, its four cassettes the cast's own.
        fhd = '#stageRack svg [data-device-ref="fhd-1ufce"]'
        cast_cassettes = page.query_selector_all(
            f'{fhd} [data-path^="bay-"][data-path$="/module"][data-ref^="fs/fhd-1mtp6lcd-os2-a@4"]')
        if len(cast_cassettes) != 4 or page.query_selector(f'{fhd} [data-ref^="fs/fhd-splice-12-lc@3"]'):
            bad.append(f"inspect frame: the FHD is not drawn as the cast's populated tray after a "
                       f"swap on another configuration ({len(cast_cassettes)} cast cassettes)")
        # A REMOVABLE PART COMES OFF THROUGH EXPLORER'S OWN CONTROL: the pull
        # handle a tree row grows next to its label whenever the part underneath
        # carries `data-behaviour` (shell.js's "◉" span, title "take off this
        # cover to see behind it" for a mounted cover like the bezel). Not a
        # guessed dialog button - the same click a person uses in Explorer itself.
        page.click('[data-spoke-device="r740xd"][data-spoke-lens="inspect"]')
        page.wait_for_selector('#lensFrame iframe', state="visible", timeout=READY_3D_MS)
        fr = explorer_frame("r740xd")
        before = fr.evaluate("() => window.portrayalEmbed.current().pulled.length")
        fr.click('#tree .node[data-path="bezel"] .pull')
        fr.wait_for_function(
            f"() => window.portrayalEmbed.current().pulled.length > {before}",
            timeout=READY_MS)
        if not any("bezel" in p.lower() for p in fr.evaluate("() => window.portrayalEmbed.current().pulled")):
            bad.append("inspect frame: the R740xd bezel did not come off")
        page.click('#spokeBack')
        page.wait_for_selector('[data-stage-ready="populate"]', timeout=READY_MS)
    except Exception as e:
        bad.append(f"inspect frame: {str(e).splitlines()[0]}")

    # CALLOUTS -> INSPECT ON THE AS7726-32X, from the crumb's own lens row. The
    # inline Callouts face named its SVG under the stage; the frame that
    # replaces it must not leave that name there - not while it loads, and not
    # once it is open. This is also the fourth cast device's Inspect open.
    try:
        page.click('.stage-rail button[data-stage="populate"]')
        page.wait_for_selector('[data-stage-ready="populate"]', timeout=READY_MS)
        page.click('#lookStrip [data-spoke-device="as7726-32x"][data-spoke-lens="callouts"]')
        page.wait_for_selector('#spokeCrumb:not([hidden])', timeout=READY_MS)
        if ".svg" not in page.inner_text("#showSrc"):
            bad.append("callouts -> inspect: Callouts did not name its face under the stage, "
                       "so the check below proves nothing")
        # Read in the same task the frame is put in the page, so this is the
        # PENDING path - the cover still up - not the open one.
        at = page.evaluate("""() => new Promise(res => {
            const host = document.getElementById('lensFrame');
            const mo = new MutationObserver(() => {
              if (!host.querySelector('iframe')) return;
              mo.disconnect();
              res({cover: !!host.querySelector('.lens-cover'),
                   src: document.getElementById('showSrc').textContent});
            });
            mo.observe(host, {childList: true});
            [...document.querySelectorAll('#spokeLenses button')]
              .find(b => b.textContent === 'Inspect').click();
        })""")
        if not at["cover"]:
            bad.append("callouts -> inspect: the frame was not loading when read, so this proves nothing")
        if re.search(r"\.svg\b", at["src"]):
            bad.append(f"callouts -> inspect: the loading frame sits over a stale source line ({at['src']!r})")
        explorer_frame("as7726-32x")
        page.wait_for_selector('#spokeCrumb:not([hidden])', timeout=READY_MS)
        if re.search(r"\.svg\b", page.inner_text("#showSrc")):
            bad.append(f"callouts -> inspect: the open frame sits over a stale source line "
                       f"({page.inner_text('#showSrc')!r})")
        page.click('#spokeBack')
        page.wait_for_selector('[data-stage-ready="populate"]', timeout=READY_MS)
    except Exception as e:
        bad.append(f"callouts -> inspect: {str(e).splitlines()[0]}")

    try:
        # The fifth cast device: the copper top-of-rack switch.
        page.click('.stage-rail button[data-stage="populate"]')
        page.wait_for_selector('[data-stage-ready="populate"]', timeout=READY_MS)
        page.click('[data-spoke-device="eps201"][data-spoke-lens="inspect"]')
        page.wait_for_selector('#lensFrame iframe', state="visible", timeout=READY_3D_MS)
        explorer_frame("eps201")
        page.click('#spokeBack')
        page.wait_for_selector('[data-stage-ready="populate"]', timeout=READY_MS)
    except Exception as e:
        bad.append(f"inspect frame: {str(e).splitlines()[0]}")

    missing = sorted(set(cast) - opened_on_cast)
    if missing:
        bad.append(f"inspect frame: not proven to open on its cast configuration: {missing}")

    # MID-LOAD, FOR CERTAIN. Clicks the Inspect button, and the moment the
    # frame is put in the page - inside the same MutationObserver callback, so
    # before its document can have loaded, let alone said it is ready -
    # clicks `second`. Returns what was true right then (the cover up, so it
    # really was mid-load) and right after the second click's synchronous work.
    def click_during_load(dev, second):
        return page.evaluate("""([dev, second]) => new Promise((res, rej) => {
            const host = document.getElementById('lensFrame');
            const t = setTimeout(() => { mo.disconnect(); rej(new Error('no frame appeared')); }, 30000);
            const mo = new MutationObserver(() => {
              if (!host.querySelector('iframe')) return;
              mo.disconnect(); clearTimeout(t);
              const mid = !!host.querySelector('.lens-cover')
                && !document.body.classList.contains('spoke-open');
              document.querySelector(second).click();
              res({mid,
                   frameAfter: !!host.querySelector('iframe') || !host.hidden,
                   crumbAfter: !document.getElementById('spokeCrumb').hidden,
                   dimAfter: document.body.classList.contains('spoke-open')});
            });
            mo.observe(host, {childList: true});
            document.querySelector(
              `#lookStrip [data-spoke-device="${dev}"][data-spoke-lens="inspect"]`).click();
        })""", [dev, second])

    # A RUNG CLICKED WHILE THE FRAME LOADS goes where it was clicked, at once:
    # no frame, no crumb, no dimmed ladder, and the stage asked for comes up.
    try:
        page.click('.stage-rail button[data-stage="populate"]')
        page.wait_for_selector('[data-stage-ready="populate"]', timeout=READY_MS)
        at = click_during_load("asr-9006", '.stage-rail button[data-stage="mount"]')
        mid = at["mid"]
        left = [w for w, k in (("the frame is still up", "frameAfter"),
                               ("the crumb is showing", "crumbAfter"),
                               ("the ladder is dimmed (spoke-open)", "dimAfter")) if at[k]]
        page.wait_for_selector('[data-stage-ready="mount"]', timeout=READY_MS)
        def frame_gone():
            out = []
            if page.is_visible('#lensFrame') or page.query_selector('#lensFrame iframe'):
                out.append("the frame is still up")
            if page.is_visible('#spokeCrumb'):
                out.append("the crumb is showing")
            if page.evaluate("() => document.body.classList.contains('spoke-open')"):
                out.append("the ladder is dimmed (spoke-open)")
            return out
        left += [f"{w} once stage 1 is ready" for w in frame_gone()]
        # And the abandoned load cannot come back when it lands.
        page.wait_for_timeout(2500)
        late = frame_gone()
        if page.get_attribute('#stageHost', "data-stage-ready") != "mount":
            late.append("stage 1 is no longer the ready stage")
        if not mid:
            bad.append("rung click during load: the frame had finished loading before the click, "
                       "so this proves nothing")
        if left or late:
            bad.append(f"rung click during load: at once [{'; '.join(left)}], "
                       f"2.5 s later [{'; '.join(late)}]")
    except Exception as e:
        bad.append(f"rung click during load: {str(e).splitlines()[0]}")

    # 3D CLICKED WHILE THE FRAME LOADS is remembered, and the frame opens in
    # 3D - read at the moment the lens is open, not waited for, because
    # openFrame is what must apply it. Then back to 2D, frame and page both.
    try:
        page.click('.stage-rail button[data-stage="populate"]')
        page.wait_for_selector('[data-stage-ready="populate"]', timeout=READY_MS)
        mid = click_during_load("r740xd", '#stageMode [data-mode="3d"]')["mid"]
        page.wait_for_selector('#spokeCrumb:not([hidden])', timeout=READY_3D_MS)
        fr = explorer_frame("r740xd")
        m = fr.evaluate("() => window.portrayalEmbed.current().mode")
        if not mid:
            bad.append("3D click during load: the frame had finished loading before the click, "
                       "so this proves nothing")
        if m != "3d":
            bad.append(f"3D click during load: the lens opened in {m}, under a switch showing 3D")
        page.click('#stageMode [data-mode="2d"]')
        fr.wait_for_function("() => window.portrayalEmbed.current().mode === '2d'", timeout=READY_MS)
        page.click('#spokeBack')
        page.wait_for_selector('[data-stage-ready="populate"]', timeout=READY_MS)
    except Exception as e:
        bad.append(f"3D click during load: {str(e).splitlines()[0]}")
    finally:
        # 2D IS THE DEFAULT, and nothing after this may start in 3D.
        try:
            if page.get_attribute('#stageMode [data-mode="2d"]', "aria-pressed") != "true":
                page.click('#stageMode [data-mode="2d"]', timeout=READY_MS)
            if page.is_visible('#spokeBack'):
                page.click('#spokeBack', timeout=READY_MS)
            at = page.get_attribute('.stage-rail [data-stage][aria-selected="true"]', "data-stage")
            page.wait_for_selector(f'[data-stage-ready="{at}"]', timeout=READY_3D_MS)
            stored = page.evaluate("() => { try { return localStorage.getItem('portrayal.showcase.mode'); } catch { return null; } }")
            if stored == "3d" or page.get_attribute('#stageMode [data-mode="2d"]', "aria-pressed") != "true":
                bad.append(f"3D click during load: the page was not left in 2D (stored {stored!r})")
        except Exception as e:
            bad.append(f"3D click during load: could not restore 2D ({str(e).splitlines()[0]})")

    # THE PLAN'S SEATS LAND (patching Task 2): applied to a fresh overrides map,
    # every fiber end shows its connectors on the 2D elevation - 2 per optic
    # end, 2 per duplex adapter end - read through relief.js's cablePoints, the
    # kit's own reading, scoped to each device's group.
    got = page.evaluate("""async () => {
        const R = await import('/site/showcase/rack.js');
        const P = await import('/site/showcase/plan.js');
        const {cablePoints} = await import('/vendor/relief.js');
        await R.loadMeta();
        const plan = await P.loadPlan();
        const ov = {};
        const {made, kept} = P.applyPlanSeats(plan, ov);
        const svg = await R.build2dElevation({stack: R.CAST.filter(e => e.ru != null),
                                              heightRU: R.RACK_U, overrides: ov});
        svg.style.cssText = 'position:fixed;left:0;top:0;width:10px;height:10px;opacity:0';
        document.body.append(svg);
        const short = [];
        for (const l of plan.links.filter(P.isFiber)) for (const [dev, path] of [l.from, l.to]) {
            const g = svg.querySelector(`[data-device-ref="${dev}"]`);
            const n = g ? cablePoints(g).filter(p => p.path.startsWith(path + '-occupant/')).length : 0;
            if (n !== 2) short.push(`${dev}:${path}=${n}`);
        }
        svg.remove();
        return {made: made.length, kept: kept.length, short};
    }""")
    if got["kept"] or got["short"] or not got["made"]:
        bad.append(f"plan seats: made {got['made']}, kept {got['kept']}, ends without two connectors {got['short']}")
    return bad


def run_marks_harness(page, base):
    """Press Run and read the results off the page, as a person would."""
    page.goto(f"{base}/marks-harness.html", wait_until="load")
    page.wait_for_timeout(3000)
    page.click("#runtests")
    # The harness rasterises, builds a GIF and compares drawings; it takes a
    # few seconds even when everything passes. Waited for by its own output
    # going quiet rather than by a fixed sleep that would be either flaky or
    # slow: the last line lands and nothing more arrives.
    last, stable = "", 0
    for _ in range(120):
        page.wait_for_timeout(500)
        now = page.inner_text("#selftest")
        if now and now == last:
            stable += 1
            if stable >= 4:
                break
        else:
            stable = 0
        last = now
    passed = len(re.findall(r"^pass\b", last, re.M))
    failed = [l for l in last.splitlines() if re.match(r"^\s*fail\b", l, re.I)]
    return passed, failed


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", help="a server already running; otherwise one is started")
    args = ap.parse_args()

    from playwright.sync_api import sync_playwright   # imported late, so --help works without it

    server = None
    base = args.url.rstrip("/") if args.url else None
    if not base:
        port = free_port()
        base = f"http://127.0.0.1:{port}"
        server = subprocess.Popen([sys.executable, str(HERE / "serve.py"), str(port),
                                   "--bind", "127.0.0.1"],
                                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    problems, notes, failed_things = [], [], 0
    try:
        if not wait_for(f"{base}/index.html"):
            print("check-browser: no server answering at", base, file=sys.stderr)
            return 1
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            for name in PAGES:
                page = browser.new_page()
                try:
                    bad = check(page, base, name)
                    if name == "explorer.html":
                        if not page.is_visible(".site-bar"): bad.append("explorer: .site-bar not visible without embed")
                        if not page.is_visible("#mode"): bad.append("explorer: #mode not visible without embed")
                finally:
                    page.close()
                if bad:
                    failed_things += 1
                    problems.append(f"FAIL  {name}")
                    problems += [f"        {b}" for b in dict.fromkeys(bad)]
                else:
                    notes.append(f"ok    {name}")

            page = browser.new_page()
            try:
                bad = check_stages(page, base)
            finally:
                page.close()
            if bad:
                failed_things += 1
                problems.append(f"FAIL  the stage rail: 7 stages")
                problems += [f"        {b}" for b in dict.fromkeys(bad)]
            else:
                notes.append(f"ok    the stage rail: 7 stages")

            page = browser.new_page()
            try:
                bad = check_embed(page, base)
            finally:
                page.close()
            if bad:
                failed_things += 1
                problems.append(f"FAIL  explorer embed mode")
                problems += [f"        {b}" for b in dict.fromkeys(bad)]
            else:
                notes.append(f"ok    explorer embed mode")

            page = browser.new_page()
            try:
                passed, failed = run_marks_harness(page, base)
            finally:
                page.close()
            browser.close()
    finally:
        if server:
            server.terminate()

    if failed or not passed:
        failed_things += 1
        problems.append(f"FAIL  the marks harness: {passed} passed, {len(failed)} failed")
        problems += [f"        {l.strip()}" for l in failed]
    else:
        notes.append(f"ok    the marks harness: {passed} checks")

    if problems:
        print(f"browser: {len(notes)} passed, {failed_things} FAILED")
        for p in problems:
            print("  " + p)
        print("\nA page that 404s or throws is a page nobody can use. If this is a")
        print("deliberate removal, the list at the top of this file is where it goes.")
        return 1
    print(f"browser: {len(notes)} checks passed, "
          f"{len(PAGES)} pages, {len(STAGES)} stage rail, and {passed} in the marks harness")
    return 0


if __name__ == "__main__":
    sys.exit(main())
