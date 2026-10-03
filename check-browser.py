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
import csv
import io
import json
import math
import os
import pathlib
import re
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import zipfile
import xml.etree.ElementTree as ET

HERE = pathlib.Path(__file__).resolve().parent

# Every page this repository serves. Named rather than globbed: a page added
# here should be a line in a diff, and a page that goes away should fail this
# list rather than quietly stop being checked.
PAGES = ["index.html", "explorer.html", "annotate.html", "components.html",
         "compare.html", "drawings.html", "drawio.html", "exporter.html",
         "schema.html", "kit.html", "schematic.html", "marks-harness.html",
         "viewer3d-harness.html", "rack.html", "contribute.html"]

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
# alone has taken most of READY_MS; the patched rack's 3D mount then seats
# the plan and hangs fourteen tubes on top of it. A separate, longer budget keeps the
# 3D walk from flaking without loosening every 2D wait.
#
# 240 s, not 120: copper now lands on real RJ45 plugs, and three of them are
# on the R740xd. A device with ANY override has every one of its faces
# re-seated and re-rasterised by the kit's 3D build, and the R740xd's are the
# heaviest faces in the rack - measured with SwiftShader, stage 4 in 3D went
# from 4.7 s to 8.7 s entered directly, and CI's CPU-rendered runner then
# overran 120 s twice (roc-ops/portrayal-site#33). This is a time budget,
# not a correctness check: every assertion after it is unchanged.
READY_3D_MS = 240000

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


# TIME, AS IT GOES. Each check prints how long it took the moment it ends, with
# the machine's load: a check that times out on CI is then legible as slow on
# its own or slow because the box was busy, rather than as a bare Timeout.
CLOCK = [time.time()]
def took(label):
    now = time.time()
    load = os.getloadavg()[0] if hasattr(os, "getloadavg") else float("nan")
    print(f"  {now - CLOCK[0]:6.1f}s  load {load:5.2f}{memory()}  {label}", flush=True)
    CLOCK[0] = now


# On Linux (CI), what the browser holds and what the box has left, in MB - so
# a late check that times out can be told apart from a browser that has grown
# across the run. Elsewhere, nothing.
def memory():
    try:
        rss = 0
        for d in pathlib.Path("/proc").iterdir():
            if d.name.isdigit():
                try:
                    st = (d / "status").read_text()
                except OSError:
                    continue
                if "chrom" in st.split("\n", 1)[0] or "headless" in st.split("\n", 1)[0]:
                    rss += int(next((l.split()[1] for l in st.splitlines() if l.startswith("VmRSS:")), 0))
        avail = next(int(l.split()[1]) for l in open("/proc/meminfo") if l.startswith("MemAvailable:"))
        return f"  browser {rss // 1024:5d} MB  free {avail // 1024:5d} MB"
    except (OSError, StopIteration, ValueError):
        return ""


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


# EVERY COPPER END ON THE FACE SHOWN SITS ON ITS RJ45 PLUG (Portrayal #610):
# the plug's cablePoints point (path exactly `<port>-occupant`), read here
# off relief.js itself, is where one of the cable group's paths starts or
# ends - within 0.05 mm, since the jack's own center is under half a mm away.
# Returns what misses.
COPPER_ON_PLUGS_JS = """async (view) => {
    const {cablePoints} = await import('/vendor/relief.js');
    const plan = await (await fetch('/site/showcase/patching.json')).json();
    const svg = document.querySelector('#stageRack svg');
    const inv = svg.getScreenCTM().inverse();
    const ends = g => [...g.querySelectorAll('path')].flatMap(p => {
        const n = (p.getAttribute('d').match(/-?[\\d.]+(?:e-?\\d+)?/g) || []).map(Number);
        return n.length < 4 ? [] : [[n[0], n[1]], [n.at(-2), n.at(-1)]]; });
    const miss = [];
    plan.links.forEach((l, i) => {
        if (l.media !== 'copper') return;
        for (const e of [l.from, l.to]) {
            if ((e[2] || 'front') !== view) continue;
            const dev = svg.querySelector(`[data-device-ref="${e[0]}"]`);
            const plugs = dev ? cablePoints(dev).filter(p => p.at && p.path === e[1] + '-occupant') : [];
            if (plugs.length !== 1) { miss.push(`${i} ${e[0]} ${e[1]}: ${plugs.length} plug points`); continue; }
            const p = plugs[0];
            const q = new DOMPoint(+p.at[0], +p.at[1]).matrixTransform(inv.multiply(p.el.getScreenCTM()));
            const g = svg.querySelector(`[data-cables="${view}"] [data-cable][data-link-index="${i}"]`);
            const d = g ? Math.min(...ends(g).map(([x, y]) => Math.hypot(x - q.x, y - q.y))) : Infinity;
            if (!(d <= 0.05)) miss.push(`${i} ${e[0]} ${e[1]}: ${d.toFixed(2)} mm off its plug`);
        }
    });
    return miss;
}"""

# PART 3, Z-ORDER: a lead from a higher port hangs in front of the plugs and
# leads below it, so the cables are painted lowest-top first. A cable's top is
# the highest (smallest y) start or end of any of its paths - its highest
# connector. Returns [[linkIndex, top], ...] in DOM order.
CABLE_TOPS_JS = """() => [...document.querySelectorAll('#stageRack svg [data-cables] [data-cable]')].map(g => {
    const ys = [...g.querySelectorAll('path')].flatMap(p => {
        const n = (p.getAttribute('d').match(/-?[\\d.]+(?:e-?\\d+)?/g) || []).map(Number);
        return n.length < 4 ? [] : [n[1], n.at(-1)]; });
    return [+g.dataset.linkIndex, Math.min(...ys)]; })"""


# TAGS KEEP CLEAR (fix round 1): a cable tag - cross-face or not-connected -
# covers no port of any device, no seated plug's cable point, and no other
# tag. Boxes in client pixels, shrunk 0.5 px so touching is not overlapping.
TAGS_CLEAR_JS = """async () => {
    const {cablePoints} = await import('/vendor/relief.js');
    const svg = document.querySelector('#stageRack svg');
    const box = e => { const r = e.getBoundingClientRect();
        return {l: r.left + 0.5, t: r.top + 0.5, r: r.right - 0.5, b: r.bottom - 0.5}; };
    const hit = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
    const tags = [...svg.querySelectorAll('[data-tag], [data-not-connected]')]
        .map(t => ({name: t.dataset.tag || 'not-connected ' + t.dataset.notConnected,
                    b: box(t.querySelector('rect') || t)}));
    const ports = [...svg.querySelectorAll('[data-device-ref] [data-class="port"]')]
        .map(p => ({name: p.closest('[data-device-ref]').dataset.deviceRef + ' ' + p.dataset.path, b: box(p)}));
    const plugs = [...svg.querySelectorAll('[data-device-ref]')].flatMap(g => cablePoints(g)
        .filter(p => p.at).map(p => {
            const q = new DOMPoint(+p.at[0], +p.at[1]).matrixTransform(p.el.getScreenCTM());
            return {name: g.dataset.deviceRef + ' ' + p.path, b: {l: q.x, r: q.x, t: q.y, b: q.y}}; }));
    const inside = (a, pt) => pt.b.l >= a.l && pt.b.l <= a.r && pt.b.t >= a.t && pt.b.t <= a.b;
    const bad = [];
    tags.forEach((t, k) => {
        for (const p of ports) if (hit(t.b, p.b)) { bad.push(`${t.name} covers port ${p.name}`); break; }
        for (const p of plugs) if (inside(t.b, p)) { bad.push(`${t.name} covers plug ${p.name}`); break; }
        for (const o of tags.slice(k + 1)) if (hit(t.b, o.b)) bad.push(`${t.name} overlaps ${o.name}`);
    });
    return bad;
}"""


def tag_problems(page, view):
    bad = page.evaluate(TAGS_CLEAR_JS)
    return [f"stage cable in 2D, {view}: tags cover the drawing or each other: {bad[:5]}"] if bad else []


def z_order_problems(page, view):
    """Every pair of drawn cables: the one whose top is higher is later in the DOM."""
    tops = page.evaluate(CABLE_TOPS_JS)
    bad = [f"{b} (top {tb:.2f}) is painted over {a} (top {ta:.2f})"
           for k, (a, ta) in enumerate(tops) for (b, tb) in tops[k + 1:] if ta < tb - 0.01]
    return [f"stage cable in 2D, {view}: a lower cable is painted over a higher one: {bad[:4]}"] if bad else []


# THE RAIL IS LIVE ONLY ONCE IT HAS BOOTED. showcase.js awaits the drawing
# (a fetch, which the load event does not wait for) before stage-rail.js's
# boot() gives the rungs their onclick, and boot() then enters stage 0 and
# marks it ready. A rung clicked between `load` and that is a button with no
# handler: the click is dropped, the page stays on rails, and the check waits
# out READY_MS for a stage nobody asked for. A fast machine boots before the
# first click lands; a 2-CPU CI runner often does not - which is why each run
# failed a different stage check (roc-ops/portrayal-site#59). So a check that
# drives the rail opens the page through here, and clicks only once the rail
# has said it is ready - the same signal every stage after it is waited on by.
def open_showcase(page, base, query=""):
    page.goto(f"{base}/index.html{query}", wait_until="load")
    page.wait_for_selector(f'[data-stage-ready="{STAGES[0]}"]', state="attached", timeout=READY_MS)


def check_rear_loose(page, base):
    """A loose end on the REAR is named, whichever face is showing - even when
    Rear is clicked while the first face is still building.

    No stage can loosen a rear end: the rear's plugs (the R740xd's iDRAC and
    NDC) sit in the server's own ports, which no stage swaps. So the
    checker serves a plan whose iDRAC end (link 13) names a port the R740xd's
    rear does not have - the same data error a mistyped patching.json would
    be - and asserts the panel names it.

    Its other end (eps201 port-48) lands on the FRONT, and its far end is
    loose, so the front shows it as an unplugged lead with a text-only
    not-connected tag (no stage fixes a data error), not a cross-face tag;
    the rear, where neither end lands, draws nothing for it."""
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    plan = json.loads((HERE / "site" / "showcase" / "patching.json").read_text())
    plan["links"][13]["from"] = ["r740xd", "idrac9-absent", "rear"]
    page.route("**/site/showcase/patching.json",
               lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(plan)))
    try:
        def named():
            return page.eval_on_selector_all('#sidePanel li:has([data-plan-row="13"]) [data-loose]',
                                             "ls => ls.map(l => l.textContent)")
        def one(when):
            got = named()
            if len(got) != 1 or "idrac9-absent" not in got[0]:
                bad.append(f"stage cable: the rear iDRAC end is not named loose {when}: {got}")
            if len(page.query_selector_all('#sidePanel [data-loose]')) != 1:
                bad.append(f"stage cable: loose lines other than the rear iDRAC end {when}")
            return got
        open_showcase(page, base)
        # Entered as usual, on the front: the rear end is still judged.
        page.click('.stage-rail button[data-stage="cable"]', timeout=READY_MS)
        page.wait_for_selector('[data-stage-ready="cable"]', timeout=READY_MS)
        got = one("while the front is shown")
        lead = page.evaluate("""() => {
            const g = document.querySelector('#stageRack svg [data-cables="front"] [data-cable][data-link-index="13"]');
            const t = document.querySelector('#stageRack svg [data-not-connected][data-link-index="13"]');
            return {lead: !!g && g.hasAttribute('data-loose-lead'), tag: t && t.textContent,
                    button: !!t && (t.getAttribute('role') === 'button' || t.hasAttribute('tabindex')),
                    crossFace: !!document.querySelector('#stageRack svg [data-tag][data-link-index="13"]')
                               || !!(g && g.querySelector('[data-tag]'))}; }""")
        if not lead["lead"] or not lead["tag"] or "idrac9-absent" not in lead["tag"] \
                or lead["button"] or lead["crossFace"]:
            bad.append(f"stage cable: on the front, the port-48 cable whose rear end is loose is not "
                       f"an unplugged lead with a text-only not-connected tag ({lead})")
        page.click('#stageTabs [data-view="rear"]')
        page.wait_for_selector('#stageRack svg [data-cables="rear"]', timeout=READY_MS)
        if named() != got:
            bad.append("stage cable: the rear loose line changed on flipping to Rear")
        if page.query_selector('#stageRack svg [data-cables="rear"] [data-link-index="13"]'):
            bad.append("stage cable: on the rear, where neither end of link 13 lands, something is drawn for it")
        # Again, with Rear clicked the moment the toggle exists: the first
        # face is still building, and the panel must still come out right.
        page.click('.stage-rail button[data-stage="optics"]', timeout=READY_MS)
        page.wait_for_selector('[data-stage-ready="optics"]', timeout=READY_MS)
        page.click('.stage-rail button[data-stage="cable"]', timeout=READY_MS)
        page.click('#stageTabs [data-view="rear"]', timeout=READY_MS)
        page.wait_for_selector('[data-stage-ready="cable"]', timeout=READY_MS)
        page.wait_for_selector('#stageRack svg [data-cables="rear"]', timeout=READY_MS)
        one("after an early Rear click")
    except Exception as e:
        bad.append(f"stage cable: rear loose end - {str(e).splitlines()[0]}")
    return bad


def check_hero(page):
    """The front page's hero (spec 2026-09-26-hero-cabled-switch §4): every
    link in its table seats a real part on the right of the slider, its port
    lamps are lit, and nothing else is drawn - no colored marks, no text
    badges, no floating callout, and nothing at all on the flat PNG side.
    Runs on index.html as the page walk already loaded it."""
    bad = []
    try:
        page.wait_for_selector('#hero-reveal .reveal-rich svg[data-hero-seated]',
                               state="attached", timeout=READY_MS)
    except Exception:
        return ["hero: the rich SVG never said it was seated (data-hero-seated)"]
    got = page.evaluate("""() => {
        const rich = document.querySelector('#hero-reveal .reveal-rich svg');
        const flat = document.querySelector('#hero-reveal .reveal-png');
        return {seated: rich.querySelectorAll('[data-path$="-occupant"][data-ref]').length,
                marks: rich.querySelectorAll('.pt-mark, .pt-label').length,
                callout: document.querySelectorAll('#hero-reveal .reveal-callout, #hero-reveal .reveal-call, #hero-reveal [data-callout]').length,
                lampsOn: rich.querySelectorAll('[data-path^="led-port-"][data-state="on"]').length,
                refused: rich.getAttribute('data-hero-refused') || '',
                flatKids: flat.parentElement.querySelectorAll('svg, [data-cable]').length}; }""")
    if got["seated"] < 21: bad.append(f"hero: {got['seated']} seated occupants, expected at least 21")
    if got["refused"]: bad.append(f"hero: the kit refused or failed {got['refused']}")
    if got["marks"] or got["callout"]: bad.append(f"hero: marks/badges/callout still drawn ({got})")
    if got["lampsOn"] < 21: bad.append(f"hero: only {got['lampsOn']} port lamps on")
    if got["flatKids"]: bad.append("hero: the flat PNG side carries drawing")
    return bad


# Samples a point on a hero cable's main path where the pointer really lands on
# that cable (a higher cable hangs in front of the ones below it, so the start
# of a lower cable is often covered), in page coordinates. null if none is.
HERO_CABLE_POINT_JS = """port => {
    const g = document.querySelector(`#hero-reveal [data-hero-cable="${port}"]`);
    const p = g && g.querySelector('path[data-main]');
    if (!p) return null;
    const svg = p.ownerSVGElement, m = p.getScreenCTM(), n = p.getTotalLength();
    for (let i = 1; i < 60; i++) {
        const q = p.getPointAtLength(n * i / 60);
        const s = new DOMPoint(q.x, q.y).matrixTransform(m);
        const hit = document.elementFromPoint(s.x, s.y);
        if (hit && hit.closest('[data-hero-cable]') === g) return [s.x, s.y];
    }
    return null; }"""

HERO_CAPTION = '#hero-caption-2d'


def check_hero_cables(page):
    """The hero's cables (spec 2026-09-26-hero-cabled-switch §4): one per link,
    each starting at its own seated part's cable point, painted higher-in-
    front, and one caption line that names port-67 until a cable is hovered,
    focused or tapped. Every assertion below records on every run: a failure
    to draw the cables fails each of them by name rather than skipping them.
    Runs on index.html as the page walk already loaded it."""
    bad = []
    try:
        page.wait_for_selector('#hero-reveal [data-hero-cable]', state="attached", timeout=READY_MS)
    except Exception:
        pass
    def step(name, fn):
        try:
            fn()
        except Exception as e:
            bad.append(f"hero: {name} - {str(e).splitlines()[0]}")
    caption = lambda: page.inner_text(HERO_CAPTION, timeout=5000)

    def starts():
        rows = page.evaluate("""async () => {
            const {cablePoints} = await import('/vendor/relief.js');
            const svg = document.querySelector('#hero-reveal .reveal-rich svg');
            const inv = svg.getScreenCTM().inverse();
            const pts = cablePoints(svg).filter(p => p.at).map(p => { const q = new DOMPoint(p.at[0], p.at[1])
                .matrixTransform(inv.multiply(p.el.getScreenCTM())); return {path: p.path, x: q.x, y: q.y}; });
            return [...svg.querySelectorAll('[data-hero-cable]')].map(g => {
                const port = g.dataset.heroCable;
                const d = g.querySelector('path[data-main]')?.getAttribute('d') || '';
                const m = d.match(/^M\\s*([-\\d.]+)[ ,]([-\\d.]+)/);
                const mine = pts.filter(p => p.path === port + '-occupant' || p.path.startsWith(port + '-occupant/'));
                return {port, near: mine.some(p => m && Math.hypot(p.x - +m[1], p.y - +m[2]) < 12)};
            }); }""")
        if len(rows) < 21: bad.append(f"hero: {len(rows)} cables, expected one per link (21)")
        off = [r["port"] for r in rows if not r["near"]]
        if off: bad.append(f"hero: cables not starting at their connector {off}")
    step("cable starts", starts)

    def order():
        # Painting order: a cable whose top connector is higher comes later in the DOM.
        tops = page.evaluate("() => [...document.querySelectorAll('#hero-reveal [data-hero-cable]')].map(g => +g.dataset.top)")
        if not tops or tops != sorted(tops, reverse=True):
            bad.append(f"hero: cables are not painted higher-in-front ({tops})")
    step("painting order", order)

    def faded():
        # Every cable is inside the one side-fade mask, and runs past the
        # device's edge into the fade.
        got = page.evaluate("""() => {
            const all = [...document.querySelectorAll('#hero-reveal [data-hero-cable]')];
            const out = all.filter(g => !g.closest('[mask="url(#hero-side-fade)"]')).map(g => g.dataset.heroCable);
            const short = all.filter(g => { const b = g.querySelector('path[data-main]').getBBox();
                return !(b.x < -30 || b.x + b.width > 466); }).map(g => g.dataset.heroCable);
            return {mask: !!document.querySelector('#hero-reveal mask#hero-side-fade'), out, short}; }""")
        if not got["mask"] or got["out"]: bad.append(f"hero: cables outside the side fade {got}")
        if got["short"]: bad.append(f"hero: cables that stop short of the frame's edge {got['short']}")
    step("side fade", faded)

    def default_caption():
        if "port-67" not in caption():
            bad.append(f"hero: the caption's default is not port-67 ({caption()!r})")
    step("default caption", default_caption)

    def colors():
        # Jacket colors come from cables.js's colorOfJacket (Task 1): an SR
        # link (port-4, jacket mm) draws aqua, a DAC (port-12) draws black.
        got = page.evaluate("""() => {
            const stroke = port => document.querySelector(
                `#hero-reveal [data-hero-cable="${port}"] path[data-main]`)?.getAttribute('stroke') || '';
            return {mm: stroke('port-4'), dac: stroke('port-12')}; }""")
        if got["mm"].lower() != "#2bb3c8":
            bad.append(f"hero: port-4 (mm) is not aqua #2bb3c8 ({got['mm']!r})")
        if got["dac"].lower() != "#15171a":
            bad.append(f"hero: port-12 (dac) is not black #15171a ({got['dac']!r})")
    step("jacket colors", colors)

    split_of = lambda: page.evaluate("() => document.querySelector('#hero-reveal .reveal-stage').style.getPropertyValue('--split')")
    set_split = lambda v: page.evaluate("""v => { const r = document.querySelector('#hero-reveal .reveal-range');
            r.value = String(v); r.dispatchEvent(new Event('input')); }""", v)

    def hover():
        # The whole rich side shown, so the pointer can reach port-13's cable;
        # the split put back afterwards, so later steps see the page as loaded.
        before = page.evaluate("() => document.querySelector('#hero-reveal .reveal-range').value")
        set_split(0)
        try:
            at = page.evaluate(HERO_CABLE_POINT_JS, "port-13")
            if not at:
                bad.append("hero: nowhere on port-13's cable can the pointer reach it"); return
            page.mouse.move(at[0], at[1])
            cap = caption()
            if "port-13" not in cap or "25G DAC" not in cap:
                bad.append(f"hero: hovering port-13's cable did not name it in the caption ({cap!r})")
            # A POINTER HELD STILL ON A CABLE KEEPS ITS CAPTION (feedback: the
            # caption oscillated). The hovered cable is redrawn on top by a
            # <use>; if anything in that copy takes the pointer, the cable
            # sees pointerleave, the copy goes, the cable sees pointerenter...
            # So: several points along the visible stroke, each held and
            # sampled 20 times, and every sample must name the cable.
            spots = page.evaluate("""() => { const p = document.querySelector('[data-hero-cable="port-13"] path[data-main]');
                const L = p.getTotalLength(), m = p.getScreenCTM();
                return [0.08, 0.14, 0.2, 0.26].map(f => { const q = p.getPointAtLength(L * f);
                    const s = new DOMPoint(q.x, q.y).matrixTransform(m); return [s.x, s.y]; }); }""")
            flicker = []
            for x, y in spots:
                if not page.evaluate("([x, y]) => !!document.elementFromPoint(x, y)?.closest('#hero-reveal')", [x, y]):
                    continue
                page.mouse.move(x, y)
                samples = []
                for _ in range(20):
                    page.wait_for_timeout(30)
                    samples.append("port-13" in caption())
                if not all(samples) and any(samples):
                    flicker.append(f"({x:.0f},{y:.0f}) {samples.count(True)}/20")
            if flicker:
                bad.append(f"hero: the caption flickers with the pointer held on port-13's cable {flicker}")
            page.mouse.move(0, 0)
            if "port-67" not in caption():
                bad.append(f"hero: leaving the cable did not restore the caption ({caption()!r})")
        finally:
            set_split(before)
        if split_of() != "50%":
            bad.append(f"hero: the hover step left the split at {split_of()!r}")
    step("hover", hover)

    def grip():
        # THE GRIP DRAGS EVEN OVER A CABLE. The handle is pointer-events: none,
        # so a press on the grip lands on whatever is under it; with the split
        # on a cable's column, that is the cable.
        found = page.evaluate("""() => {
            const stage = document.querySelector('#hero-reveal .reveal-stage');
            const r = document.querySelector('#hero-reveal .reveal-range');
            for (const g of document.querySelectorAll('#hero-reveal [data-hero-cable]')) {
                const x = +g.querySelector('path[data-main]').getAttribute('d').match(/^M\\s*([-\\d.]+)/)[1];
                // The split just left of the cable, and the press a few px
                // right of the grip's center - still well inside the grip -
                // where the cable shows (left of the split is the PNG).
                r.value = String((x - 1 + 44) / 524 * 100); r.dispatchEvent(new Event('input'));
                const b = document.querySelector('#hero-reveal .reveal-grip').getBoundingClientRect();
                const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
                for (let px = 0; px <= b.width / 2 - 3; px++) {
                    const hit = document.elementFromPoint(cx + px, cy);
                    if (hit && hit.closest('[data-hero-cable]'))
                        return {port: g.dataset.heroCable, at: [cx + px, cy], split: stage.style.getPropertyValue('--split')};
                }
            }
            return null; }""")
        if not found:
            bad.append("hero: no cable column puts a cable under the grip (the drag test has nothing to test)"); return
        try:
            page.mouse.move(*found["at"]); page.mouse.down()
            page.mouse.move(found["at"][0] + 90, found["at"][1], steps=4); page.mouse.up()
            if split_of() == found["split"]:
                bad.append(f"hero: the grip over {found['port']}'s cable did not drag the divider ({found})")
        finally:
            set_split(50)
    step("grip over a cable", grip)

    def pin_then_drag():
        # A TOUCH-PINNED CABLE LETS GO WHEN THE DIVIDER IS GRABBED. Real touch
        # input through CDP, so the stage's capture-phase grip handler sees it
        # as a finger would: tap port-44's cable to pin it, then drag the grip.
        cdp = page.context.new_cdp_session(page)
        def touch(kind, x=None, y=None):
            pts = [] if kind == "touchEnd" else [{"x": x, "y": y, "id": 1}]
            cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": pts})
        set_split(0)
        try:
            at = page.evaluate(HERO_CABLE_POINT_JS, "port-44")
            if not at:
                bad.append("hero: nowhere on port-44's cable can a finger reach it"); return
            touch("touchStart", *at); touch("touchEnd")
            if "port-44" not in caption():
                bad.append(f"hero: a tap on port-44's cable did not pin it ({caption()!r})"); return
            g = page.evaluate("""() => { const b = document.querySelector('#hero-reveal .reveal-grip').getBoundingClientRect();
                return [b.x + b.width / 2, b.y + b.height / 2]; }""")
            before = split_of()
            touch("touchStart", *g)
            for dx in (20, 40, 60, 80):
                touch("touchMove", g[0] + dx, g[1])
            touch("touchEnd")
            if split_of() == before:
                bad.append(f"hero: a touch drag on the grip did not move the divider ({before})")
            if "port-67" not in caption():
                bad.append(f"hero: dragging the divider left port-44 pinned ({caption()!r})")
        finally:
            cdp.detach()
            set_split(50)
    step("pin, then drag the grip", pin_then_drag)

    def sag():
        # sag2d SETS EACH DROP (ruling R3): a cable's first control point sits
        # sag2d(run) * SAG_SCALE below its start, clamped only where the curve
        # would otherwise leave the frame (below HANG_FLOOR) - and a longer
        # run hangs deeper.
        got = page.evaluate("""async () => {
            const H = await import('/site/hero-reveal.js');
            const {sag2d} = await import('/site/showcase/cables.js');
            if (!(H.SAG_SCALE > 0) || !(H.HANG_FLOOR > 0)) return {missing: true};
            const maxY = (y0, y1, y2, y3) => { let m = -Infinity; for (let i = 0; i <= 200; i++) { const t = i / 200, u = 1 - t;
                m = Math.max(m, u*u*u*y0 + 3*u*u*t*y1 + 3*u*t*t*y2 + t*t*t*y3); } return m; };
            const rows = [...document.querySelectorAll('#hero-reveal [data-hero-cable]')].map(g => {
                const n = g.querySelector('path[data-main]').getAttribute('d').match(/-?[\\d.]+/g).map(Number);
                const [x0, y0, , y1, , y2, x3, y3] = n;
                const run = Math.abs(x3 - x0), want = sag2d(run) * H.SAG_SCALE, drop = y1 - y0;
                const low = maxY(y0, y1, y2, y3), wantLow = maxY(y0, y0 + want, y2, y3);
                const free = Math.abs(drop - want) < 0.05;
                const fair = free ? low <= H.HANG_FLOOR + 0.1
                                  : drop < want && wantLow > H.HANG_FLOOR && low <= H.HANG_FLOOR + 0.1;
                return {port: g.dataset.heroCable, run, drop, want, low, free, fair};
            });
            return {rows}; }""")
        if got.get("missing"):
            bad.append("hero: hero-reveal.js exports no SAG_SCALE / HANG_FLOOR to hold the sag to"); return
        rows = got["rows"]
        unfair = [f"{r['port']} drop {r['drop']:.1f} vs sag2d {r['want']:.1f}" for r in rows if not r["fair"]]
        if unfair: bad.append(f"hero: drops not set by sag2d, nor clamped only to stay in the frame {unfair}")
        free = [r for r in rows if r["free"]]
        pairs = [(a, b) for a in free for b in free if a["run"] + 1 < b["run"] and a["drop"] + 1 < b["drop"]]
        if not pairs: bad.append("hero: no two cables of different run lengths hang to different sag2d drops")
    step("sag", sag)

    def faded_tails():
        # A TAIL IN THE FADE DOES NOT TAKE THE POINTER. A mask hides a stroke
        # without stopping it hit-testing, so an invisible tail near the frame's
        # edge would take hovers and block the drag there.
        set_split(0)
        try:
            hits = page.evaluate("""() => {
                const out = [];
                for (const g of document.querySelectorAll('#hero-reveal [data-hero-cable]')) {
                    const p = g.querySelector('path[data-main]'), m = p.getScreenCTM(), n = p.getTotalLength();
                    for (let i = 0; i <= 80; i++) {
                        const q = p.getPointAtLength(n * i / 80);
                        if (q.x > -22 && q.x < 458) continue;           // only the outer half of the fade
                        const s = new DOMPoint(q.x, q.y).matrixTransform(m);
                        const hit = document.elementFromPoint(s.x, s.y);
                        if (hit && hit.closest('[data-hero-cable]')) { out.push(g.dataset.heroCable); break; }
                    }
                }
                return out; }""")
            if hits: bad.append(f"hero: faded tails still take the pointer {hits}")
        finally:
            set_split(50)
    step("faded tails", faded_tails)

    def keyboard():
        page.focus('#hero-reveal [data-hero-cable="port-4"]', timeout=5000)
        if "port-4 " not in caption() + " ":
            bad.append(f"hero: focusing port-4's cable did not name it ({caption()!r})")
        page.evaluate("() => document.activeElement.blur()")
        if "port-67" not in caption():
            bad.append(f"hero: blurring the cable did not restore the caption ({caption()!r})")
    step("keyboard", keyboard)

    def tap():
        # A tap on a cable selects it and leaves the divider where it was;
        # a tap outside restores the default.
        got = page.evaluate("""() => {
            const stage = document.querySelector('#hero-reveal .reveal-stage');
            const before = stage.style.getPropertyValue('--split');
            const g = document.querySelector('#hero-reveal [data-hero-cable="port-44"] path[data-main]');
            const o = {bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: true, clientX: 5, clientY: 5};
            g.dispatchEvent(new PointerEvent('pointerdown', o));
            g.dispatchEvent(new PointerEvent('pointerup', o));
            g.dispatchEvent(new PointerEvent('pointerleave', o));
            const cap = document.querySelector('#hero-caption-2d').textContent;
            const after = stage.style.getPropertyValue('--split');
            document.body.dispatchEvent(new PointerEvent('pointerdown', o));
            return {cap, before, after, restored: document.querySelector('#hero-caption-2d').textContent}; }""")
        if "port-44" not in got["cap"]: bad.append(f"hero: tapping port-44's cable did not select it {got}")
        if got["before"] != got["after"]: bad.append(f"hero: tapping a cable moved the divider {got}")
        if "port-67" not in got["restored"]: bad.append(f"hero: tapping outside did not restore the caption {got}")
    step("tap", tap)

    def roving():
        # ONE TAB STOP FOR THE CABLES, AND NEVER AN INVISIBLE FOCUS (WCAG
        # 2.4.7). Tab lands on the cable set once; the arrow keys walk all 21,
        # left to right by where each cable starts; Home and End go to the ends.
        # Every cable that takes focus is in the revealed (right-hand) side -
        # the divider moves, range input and all, to show one that was under
        # the flat PNG - lit, named, and marked by a visible focus stroke.
        set_split(50)
        page.evaluate("() => document.activeElement && document.activeElement.blur()")
        state = lambda: page.evaluate("""() => {
            const stage = document.querySelector('#hero-reveal .reveal-stage');
            const all = [...document.querySelectorAll('#hero-reveal [data-hero-cable]')];
            const zero = all.filter(x => x.getAttribute('tabindex') === '0').map(x => x.dataset.heroCable);
            const a = document.activeElement;
            const g = a && a.closest ? a.closest('#hero-reveal [data-hero-cable]') : null;
            if (!g) return {port: null, zero};
            const p = g.querySelector('path[data-main]');
            const m = p.getAttribute('d').match(/^M\\s*([-\\d.]+)[ ,]([-\\d.]+)/);
            const at = new DOMPoint(+m[1], +m[2]).matrixTransform(p.getScreenCTM());
            const f = document.querySelector('#hero-reveal .reveal-frame').getBoundingClientRect();
            const split = parseFloat(stage.style.getPropertyValue('--split'));
            const range = +document.querySelector('#hero-reveal .reveal-range').value;
            const ring = g.querySelector('[data-focus-ring]');
            const cs = ring && getComputedStyle(ring);
            const marked = !!ring && cs.visibility === 'visible' && cs.display !== 'none'
                && cs.stroke !== 'none' && +cs.strokeOpacity > 0 && +cs.opacity > 0 && +cs.strokeWidth.replace('px', '') > 0;
            return {port: g.dataset.heroCable, startX: at.x, splitX: f.left + split / 100 * f.width,
                    split, range, marked, zero, lit: g.classList.contains('cable-on'),
                    cap: document.querySelector('#hero-caption-2d').textContent}; }""")
        order = page.evaluate("""() => [...document.querySelectorAll('#hero-reveal [data-hero-cable]')].map(g => {
            const p = g.querySelector('path[data-main]'), m = p.getAttribute('d').match(/^M\\s*([-\\d.]+)/);
            return [g.dataset.heroCable, +m[1]]; }).sort((a, b) => a[1] - b[1]).map(r => r[0])""")
        try:
            page.focus('header a.gh', timeout=5000)
            st = None
            for _ in range(12):
                page.keyboard.press("Tab")
                st = state()
                if st["port"]: break
            if not st or not st["port"]:
                bad.append("hero: Tab never reached the cables"); return
            if len(st["zero"]) != 1:
                bad.append(f"hero: {len(st['zero'])} cables are tab stops, expected one ({st['zero'][:6]})")
            page.keyboard.press("Home")
            seen = []
            for k in range(len(order)):
                if k: page.keyboard.press("ArrowRight")
                st = state()
                seen.append(st["port"])
                if not st["port"]: bad.append(f"hero: arrow key {k} left the cables"); break
                if st["startX"] < st["splitX"] - 0.5:
                    bad.append(f"hero: focused {st['port']} starts under the flat side "
                               f"(start {st['startX']:.0f}px, split {st['splitX']:.0f}px)")
                if abs(st["range"] - st["split"]) > 0.01:
                    bad.append(f"hero: the split and the range input disagree on {st['port']} ({st['split']} vs {st['range']})")
                if not st["marked"]: bad.append(f"hero: focused {st['port']} has no visible focus mark")
                if not st["lit"] or st["port"] + " " not in st["cap"] + " ":
                    bad.append(f"hero: focused {st['port']} is not lit and named ({st['cap']!r})")
                if st["zero"] != [st["port"]]:
                    bad.append(f"hero: on {st['port']} the tab stop is {st['zero']}")
            if seen != order:
                bad.append(f"hero: the arrow keys did not walk all {len(order)} cables left to right ({seen} vs {order})")
            page.keyboard.press("ArrowLeft")
            if state()["port"] != order[-2]: bad.append(f"hero: ArrowLeft from {order[-1]} did not go to {order[-2]}")
            page.keyboard.press("Home")
            if state()["port"] != order[0]: bad.append(f"hero: Home did not go to {order[0]}")
            page.keyboard.press("End")
            if state()["port"] != order[-1]: bad.append(f"hero: End did not go to {order[-1]}")
            page.keyboard.press("Tab")
            if state()["port"]: bad.append("hero: a second Tab stayed in the cables (more than one tab stop)")
            page.keyboard.press("Shift+Tab")
            if state()["port"] != order[-1]: bad.append(f"hero: Shift+Tab did not come back to {order[-1]} ({state()['port']})")
        finally:
            page.evaluate("() => document.activeElement && document.activeElement.blur()")
            set_split(50)
    step("keyboard: one tab stop, revealed and marked", roving)

    def press_pins():
        # ENTER AND SPACE PIN, as a tap does; Space does not scroll the page.
        set_split(0)
        unpin = "() => document.body.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, pointerType: 'mouse'}))"
        blur = "() => document.activeElement && document.activeElement.blur()"
        try:
            for key, port in (("Enter", "port-44"), (" ", "port-13")):
                name = "Space" if key == " " else key
                page.focus(f'#hero-reveal [data-hero-cable="{port}"]', timeout=5000)
                y0 = page.evaluate("() => scrollY")
                page.keyboard.press(key)
                page.wait_for_timeout(150)
                if page.evaluate("() => scrollY") != y0: bad.append(f"hero: {name} on a cable scrolled the page")
                pressed = page.get_attribute(f'#hero-reveal [data-hero-cable="{port}"]', "aria-pressed")
                page.evaluate(blur)
                if port not in caption(): bad.append(f"hero: {name} on {port}'s cable did not pin it ({caption()!r})")
                if pressed != "true": bad.append(f"hero: {name} on {port}'s cable left aria-pressed {pressed!r}")
                page.evaluate(unpin)
                if "port-67" not in caption(): bad.append(f"hero: a press off the cable did not let {port} go ({caption()!r})")
        finally:
            page.evaluate(blur)
            page.evaluate(unpin)
            set_split(50)
    step("keyboard: Enter and Space pin", press_pins)

    def one_name():
        # A cable is named once: aria-label or <title>, never both saying it.
        got = page.evaluate("""() => [...document.querySelectorAll('#hero-reveal [data-hero-cable]')].map(g => {
            const label = g.getAttribute('aria-label') || '';
            const title = [...g.children].find(c => c.tagName.toLowerCase() === 'title')?.textContent || '';
            return {port: g.dataset.heroCable, named: !!(label || title), twice: !!label && label === title}; })""")
        if len(got) != 21: bad.append(f"hero: {len(got)} cables to name, expected 21")
        if [g for g in got if not g["named"]]: bad.append(f"hero: unnamed cables {[g['port'] for g in got if not g['named']]}")
        if [g for g in got if g["twice"]]: bad.append(f"hero: cables named twice (aria-label and <title>) {[g['port'] for g in got if g['twice']][:5]}")
    step("one name per cable", one_name)
    return bad


def check_hero_fallbacks(browser, base):
    """The 2D hero stands on its own: its caption names port-67 before
    anything is fetched, so it is never empty even when the drawing cannot
    load; and a 3D module that fails to load costs only the 3D panel - the
    2D hero still seats its parts and hangs its 21 cables. Records every run."""
    bad = []
    page = browser.new_page(viewport={"width": 1280, "height": 900})
    try:
        page.route("**/assets/dist/s9600-72xc.front.svg", lambda r: r.abort())
        page.goto(f"{base}/index.html", wait_until="load")
        try:
            page.wait_for_function("() => /port-67/.test(document.querySelector('#hero-caption-2d')?.textContent || '')",
                                   timeout=10000)
        except Exception:
            cap = page.inner_text('#hero-caption-2d')
            bad.append(f"hero: with the drawing unreachable, the 2D caption is not the port-67 default ({cap!r})")
    except Exception as e:
        bad.append(f"hero: caption default without the drawing - {str(e).splitlines()[0]}")
    finally:
        page.close()
    page = browser.new_page(viewport={"width": 1280, "height": 900})
    try:
        page.route("**/site/hero-3d.js", lambda r: r.fulfill(status=500, body="broken"))
        page.goto(f"{base}/index.html", wait_until="load")
        try:
            page.wait_for_function("() => document.querySelector('#hero-reveal .reveal-rich svg[data-hero-seated]')"
                                   " && document.querySelectorAll('#hero-reveal [data-hero-cable]').length === 21",
                                   timeout=READY_MS)
        except Exception:
            n = page.evaluate("() => document.querySelectorAll('#hero-reveal [data-hero-cable]').length")
            bad.append(f"hero: with site/hero-3d.js failing to load, the 2D hero did not draw ({n} cables)")
    except Exception as e:
        bad.append(f"hero: 2D without the 3D module - {str(e).splitlines()[0]}")
    finally:
        page.close()
    return bad


# THE WALK'S WEBGL-TROUBLE TEST, as the stage checks run it inline: the site's
# own webglTrouble(), so the walk and the page agree on whether 3D can start.
WEBGL_TROUBLE_JS = "async () => !!(await import('/site/webgl.js')).webglTrouble()"


def webgl_trouble(page):
    return page.evaluate(WEBGL_TROUBLE_JS)


# A browser with WebGL switched off, as far as a page can tell: every WebGL
# context request comes back null, which is what Chrome hands a page when
# graphics acceleration is off (site/webgl.js).
NO_WEBGL_JS = """(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...rest) {
        return /webgl/i.test(kind) ? null : get.call(this, kind, ...rest);
    };
})();"""

HERO_3D_CAPTION = '#hero-caption-3d'

# WHEN EACH HERO STARTED, on the page's own clock: `cables` when the 2D hero
# first had a cable in it, `build` when the 3D panel first had a canvas or its
# no-WebGL note - i.e. when the 3D build began. The 3D build waits for the 2D
# hero to settle, so `build` must come after `cables`.
HERO_TIMES_JS = """(() => {
    window.__heroT = {};
    new MutationObserver(() => {
        const T = window.__heroT, now = performance.now();
        if (T.cables == null && document.querySelector('#hero-reveal [data-hero-cable]')) T.cables = now;
        if (T.build == null && document.querySelector('#hero-3d canvas, #hero-3d .hero-3d-note:not([hidden])')) T.build = now;
    }).observe(document, {subtree: true, childList: true, attributes: true, attributeFilter: ['hidden']});
})();"""

HERO_3D_UNEXERCISED = ("the hero in 3D: this runner has no WebGL, so the build, the stage's role=img label, "
                       "the pick, the pointer, the framing, the scroll capture and the pause were NOT exercised "
                       "(the forced-off page still ran)")


def check_hero_3d(browser, base):
    """The hero's 3D panel (spec 2026-09-26-hero-cabled-switch §5, §7 phase 2):
    scrolled to, it builds one device and one tube per link; picking a tube -
    by the test hook and by a real pointer raycast - writes that link's
    caption, and a miss restores port-67; off screen the render loop stops.
    Without WebGL - the runner's own, or forced off in a second page - the
    still image and the one-line note show and the page throws nothing. Every
    assertion records on every run; returns (problems, notes), and on a
    runner with no WebGL the notes say what that left unexercised."""
    bad, skipped = [], []

    def step(name, fn):
        try:
            fn()
        except Exception as e:
            bad.append(f"hero 3D: {name} - {str(e).splitlines()[0]}")

    def waited(page, why):
        # The 3D build began only after the 2D hero had drawn its cables.
        t = page.evaluate("() => window.__heroT || {}")
        if t.get("cables") is None or t.get("build") is None or t["build"] <= t["cables"]:
            bad.append(f"hero 3D ({why}): the 3D build did not wait for the 2D hero "
                       f"(2D cables at {t.get('cables')}, 3D build at {t.get('build')} ms)")

    def no_webgl(page, why):
        page.wait_for_function("() => /WebGL/.test(document.querySelector('#hero-3d')?.innerText || '')",
                               timeout=READY_MS)
        if not page.query_selector('#hero-3d [data-hero-still]') or "WebGL" not in page.inner_text('#hero-3d'):
            bad.append(f"hero 3D without WebGL ({why}): no still image and note")
        if page.query_selector('#hero-3d canvas'):
            bad.append(f"hero 3D without WebGL ({why}): a canvas was left in the panel")
        cap = page.inner_text(HERO_3D_CAPTION)
        if "port-67" not in cap:
            bad.append(f"hero 3D without WebGL ({why}): the caption does not show the port-67 default ({cap!r})")

    page = browser.new_page(viewport={"width": 1280, "height": 900})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    try:
        page.add_init_script(HERO_TIMES_JS)
        page.goto(f"{base}/index.html?heroprobe=1", wait_until="load")
        step("scroll to the panel", lambda: page.locator('#hero-3d').scroll_into_view_if_needed(timeout=10000))
        if webgl_trouble(page):
            step("no WebGL on this runner", lambda: no_webgl(page, "the runner's"))
            step("waits for the 2D hero (the runner's)", lambda: waited(page, "the runner's"))
            skipped.append(HERO_3D_UNEXERCISED)
        else:
            ready = [False]
            def built():
                page.wait_for_function("() => window.__hero3d && window.__hero3d.tubes.length >= 21",
                                       timeout=READY_3D_MS)
                ready[0] = True
                got = page.evaluate("""() => ({tubes: window.__hero3d.tubes.map(t => t.port),
                                               devices: window.__hero3d.devices(),
                                               still: !!document.querySelector('#hero-3d [data-hero-still]:not([hidden])')})""")
                if got["devices"] != 1: bad.append(f"hero 3D: {got['devices']} devices, expected one")
                if len(got["tubes"]) != 21 or len(set(got["tubes"])) != 21:
                    bad.append(f"hero 3D: tubes {got['tubes']}, expected one per link (21)")
                if got["still"]: bad.append("hero 3D: the still image is still showing over a built scene")
            step("build", built)
            step("waits for the 2D hero", lambda: waited(page, "built"))

            def colors():
                # Same rows as the 2D check: an SR link (port-4, jacket mm)
                # tubes aqua, a DAC (port-12) tubes black - both from
                # cables.js's colorOfJacket, the same table the 2D hero uses.
                if not ready[0]: bad.append("hero 3D: colors - the scene never built"); return
                got = page.evaluate("""() => {
                    const hex = port => { const t = window.__hero3d.tubes.find(x => x.port === port);
                        return t ? '#' + t.mesh.material.color.getHexString() : ''; };
                    return {mm: hex('port-4'), dac: hex('port-12')}; }""")
                if got["mm"].lower() != "#2bb3c8":
                    bad.append(f"hero 3D: port-4 (mm) tube is not aqua #2bb3c8 ({got['mm']!r})")
                if got["dac"].lower() != "#15171a":
                    bad.append(f"hero 3D: port-12 (dac) tube is not black #15171a ({got['dac']!r})")
            step("jacket colors", colors)

            def lamps():
                # The 3D faces are cut with the SAME lamps the 2D drawing
                # shows: every lamp 2D lit (ports, chassis, the management
                # pair) reaches the renderer as that state's class, nothing 2D
                # left dark is lit, and the status display reads 02. The 3D
                # switch once stood with every lamp out.
                if not ready[0]: bad.append("hero 3D: lamps - the scene never built"); return
                got = page.evaluate("""() => {
                    const rich = document.querySelector('#hero-reveal .reveal-rich svg');
                    const lit2d = {};
                    for (const el of rich.querySelectorAll('[data-path][data-state]'))
                        if (el.dataset.state !== 'off') lit2d[el.dataset.path] = 'state-' + el.dataset.state;
                    const st = window.__hero3d.states();
                    const lit3d = {};
                    for (const [p, c] of Object.entries(st))
                        if (c !== 'state-off' && !p.startsWith('status-display/')
                            && rich.querySelector(`[data-path="${p}"]`)) lit3d[p] = c;
                    return {lit2d, lit3d, d1: st['status-display/digit-1'], d2: st['status-display/digit-2']}; }""")
                if len(got["lit2d"]) < 21 + 5:
                    bad.append(f"hero 3D: lamps - 2D lit only {len(got['lit2d'])}, so there is nothing to compare")
                if got["lit2d"] != got["lit3d"]:
                    diff = sorted(set(got["lit2d"].items()) ^ set(got["lit3d"].items()))
                    bad.append(f"hero 3D: lamps disagree with 2D {diff[:6]}")
                if (got["d1"], got["d2"]) != ("state-0", "state-2"):
                    bad.append(f"hero 3D: status display is {got['d1']}/{got['d2']}, expected 02")
            step("lamps", lamps)

            def named():
                # The built scene says what it shows, with the still hidden.
                got = page.evaluate("""() => { const s = document.querySelector('#hero-3d .hero-3d-stage');
                    return s && {role: s.getAttribute('role'), label: s.getAttribute('aria-label') || '',
                                 still: !!document.querySelector('#hero-3d [data-hero-still]:not([hidden])')}; }""")
                if not got or got["role"] != "img" or "S9600-72XC" not in got["label"]:
                    bad.append(f"hero 3D: the stage is not role=img with a label naming the S9600-72XC ({got})")
                elif got["still"]:
                    bad.append("hero 3D: the stage's label was checked with the still image showing")
            step("the stage is an image, named", named)

            def default_caption():
                cap = page.inner_text(HERO_3D_CAPTION, timeout=5000)
                if "port-67" not in cap: bad.append(f"hero 3D: the caption's default is not port-67 ({cap!r})")
            step("default caption", default_caption)

            def pick():
                if not ready[0]: bad.append("hero 3D: pick - the scene never built"); return
                cap = page.evaluate("() => window.__hero3d.pick('port-13')")
                if "port-13" not in (cap or ""): bad.append(f"hero 3D: picking port-13's tube gave {cap!r}")
                shown = page.inner_text(HERO_3D_CAPTION)
                if shown != cap: bad.append(f"hero 3D: pick returned {cap!r} but the caption reads {shown!r}")
                two = page.inner_text(HERO_CAPTION)
                if "port-13" in two: bad.append("hero 3D: picking in 3D wrote the 2D caption")
            step("pick", pick)

            def pointer():
                # A real raycast: the pointer onto a point of port-44's tube that
                # the ray reaches first, with the turn stopped so it stays put.
                if not ready[0]: bad.append("hero 3D: pointer - the scene never built"); return
                page.evaluate("() => window.__hero3d.stop()")
                at = page.evaluate("() => window.__hero3d.pointAt('port-44')")
                if not at: bad.append("hero 3D: nowhere on port-44's tube can the pointer reach it"); return
                page.mouse.move(at[0], at[1])
                page.wait_for_timeout(100)
                cap = page.inner_text(HERO_3D_CAPTION)
                if "port-44" not in cap: bad.append(f"hero 3D: the pointer on port-44's tube gave {cap!r}")
                box = page.locator('#hero-3d canvas').bounding_box()
                page.mouse.move(box["x"] + 4, box["y"] + 4)
                page.wait_for_timeout(100)
                cap = page.inner_text(HERO_3D_CAPTION)
                if "port-67" not in cap: bad.append(f"hero 3D: a miss did not restore port-67 ({cap!r})")
            step("pointer", pointer)

            def framed():
                # Every tube's opaque stretch inside the canvas at the opening
                # frame and at both ends of the sway (spec §5: each tube fades
                # out before the frame's edge).
                if not ready[0]: bad.append("hero 3D: framing - the scene never built"); return
                sway = page.evaluate("() => window.__hero3d.sway")
                for name, az in (("the opening frame", None), ("the sway's left end", -sway),
                                 ("the sway's right end", sway)):
                    e = page.evaluate("az => window.__hero3d.opaqueNdc(az)", az)
                    if not (e["minX"] >= -1 and e["maxX"] <= 1 and e["minY"] >= -1 and e["maxY"] <= 1):
                        bad.append(f"hero 3D: at {name} a tube's opaque stretch leaves the canvas "
                                   f"(NDC x {e['minX']:.2f}..{e['maxX']:.2f}, y {e['minY']:.2f}..{e['maxY']:.2f})")
            step("framing", framed)

            def scroll_capture():
                # R4: until a click on the panel, the wheel scrolls the page and
                # the camera stays put; after one, the wheel zooms.
                if not ready[0]: bad.append("hero 3D: scroll capture - the scene never built"); return
                def center():
                    page.locator('#hero-3d').scroll_into_view_if_needed()
                    page.evaluate("() => document.querySelector('#hero-3d').scrollIntoView({block: 'center'})")
                    b = page.locator('#hero-3d canvas').bounding_box()
                    return b["x"] + b["width"] / 2, b["y"] + b["height"] / 2
                x, y = center()
                page.mouse.move(x, y)
                if not page.is_visible('#hero-3d [data-hero-hint]'):
                    bad.append("hero 3D: no hint on the panel before it is activated")
                d0 = page.evaluate("() => window.__hero3d.distance()")
                y0 = page.evaluate("() => scrollY")
                page.mouse.wheel(0, 240)
                page.wait_for_timeout(500)
                d1 = page.evaluate("() => window.__hero3d.distance()")
                y1 = page.evaluate("() => scrollY")
                if y1 == y0: bad.append("hero 3D: before activation, the wheel over the panel did not scroll the page")
                if abs(d1 - d0) > 0.5: bad.append(f"hero 3D: before activation, the wheel zoomed ({d0:.0f} -> {d1:.0f})")
                x, y = center()
                page.mouse.click(x, y)
                page.wait_for_timeout(200)
                if page.is_visible('#hero-3d [data-hero-hint]'):
                    bad.append("hero 3D: the hint is still showing after a click activated the panel")
                d2 = page.evaluate("() => window.__hero3d.distance()")
                y2 = page.evaluate("() => scrollY")
                page.mouse.wheel(0, -240)
                page.wait_for_timeout(800)
                d3 = page.evaluate("() => window.__hero3d.distance()")
                if abs(d3 - d2) < 1: bad.append(f"hero 3D: after a click, the wheel did not zoom ({d2:.0f} -> {d3:.0f})")
                if page.evaluate("() => scrollY") != y2: bad.append("hero 3D: after a click, the wheel scrolled the page too")
                page.keyboard.press("Escape")
                page.wait_for_timeout(200)
                if not page.is_visible('#hero-3d [data-hero-hint]'):
                    bad.append("hero 3D: Escape did not let the panel go (no hint back)")
            step("scroll capture", scroll_capture)

            def pause():
                if not ready[0]: bad.append("hero 3D: pause - the scene never built"); return
                page.evaluate("() => window.scrollTo(0, document.documentElement.scrollHeight)")
                page.wait_for_timeout(600)
                if page.evaluate("() => window.__hero3d.running()"):
                    bad.append("hero 3D: the render loop runs with the panel off screen")
                page.locator('#hero-3d').scroll_into_view_if_needed()
                page.wait_for_timeout(600)
                if not page.evaluate("() => window.__hero3d.running()"):
                    bad.append("hero 3D: the render loop did not resume on screen")
            step("pause off screen", pause)
    except Exception as e:
        bad.append(f"hero 3D: {str(e).splitlines()[0]}")
    finally:
        page.close()
    bad += [f"hero 3D: uncaught {e}" for e in errors]

    # Forced off, whatever the runner has: the R11 path records every run.
    page = browser.new_page(viewport={"width": 1280, "height": 900})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    try:
        page.add_init_script(NO_WEBGL_JS)
        page.add_init_script(HERO_TIMES_JS)
        page.goto(f"{base}/index.html", wait_until="load")
        step("scroll to the panel (forced off)",
             lambda: page.locator('#hero-3d').scroll_into_view_if_needed(timeout=10000))
        step("forced no WebGL", lambda: no_webgl(page, "forced off"))
        step("waits for the 2D hero (forced off)", lambda: waited(page, "forced off"))
    except Exception as e:
        bad.append(f"hero 3D without WebGL (forced off): {str(e).splitlines()[0]}")
    finally:
        page.close()
    bad += [f"hero 3D without WebGL: uncaught {e}" for e in errors]
    return bad, skipped


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
        if not isinstance(cur.get("fields"), dict):
            bad.append(f"embed: current().fields is {cur.get('fields')!r}, expected a dict")
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
    # ?patchprobe=1 only exposes window.__patch3d (patch-view.js), which
    # cable_3d below measures; it changes nothing the page does.
    page.goto(f"{base}/index.html?patchprobe=1", wait_until="load")

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
        up = other.split("/")[-1].split("@")[0].upper()
        if len(loose) != 4 or not all("seat it in stage 2 (Populate)" in t and up in t for t in loose):
            bad.append(f"fill rule: expected 4 named loose ends on slot-2, naming {up}, got {loose}")
        # The count is of the plan's seats the rack still holds: the plan's
        # twelve cages and plugs under slot-2 went with its card.
        first = seated.get("first")
        if first is None or seated_count() != first - 12:
            bad.append(f"fill rule: 'seated for the plan' says {seated_count()}, expected {first} - 12")
        # PART 2: a cable whose far end cannot land hangs as an UNPLUGGED LEAD
        # from the end that can, tagged "not connected" with why - here the
        # card the visitor seated. Four of them on the front (slot-2's p0-p3),
        # and no cable group left as a few mm of strand: every group has a run
        # longer than 20 mm (a strand to a duplex merge is about 10).
        # Product names read as the product does, in capitals, the same in
        # the tag and in the panel's loose lines.
        card = other.split("/")[-1].split("@")[0].upper()
        leads = page.eval_on_selector_all(
            '#stageRack svg [data-cables="front"] [data-cable][data-loose-lead]',
            """gs => gs.map(g => [+g.dataset.linkIndex, g.ownerSVGElement.querySelector(
                `[data-not-connected][data-link-index="${g.dataset.linkIndex}"]`)?.textContent || ''])""")
        if len(leads) != 4 or not all("slot-2" in t and card in t for _, t in leads):
            bad.append(f"fill rule: expected 4 unplugged leads on the front, each tagged not connected "
                       f"naming slot-2's {card}, got {leads}")
        short = page.eval_on_selector_all('#stageRack svg [data-cables] [data-cable]', """gs => gs
            .filter(g => !g.hasAttribute('data-loose-lead')
                         && ![...g.querySelectorAll('path')].some(p => p.getTotalLength() > 20))
            .map(g => g.dataset.linkIndex)""")
        if short:
            bad.append(f"fill rule: cable groups with no main run and no lead (strands going nowhere): {short}")
        bad.extend(z_order_problems(page, "front, with loose leads"))
        bad.extend(tag_problems(page, "front, with loose leads"))
        # Loose lines are per end, not per face drawn: a flip keeps them.
        page.click('#stageTabs [data-view="rear"]')
        page.wait_for_selector('#stageRack svg [data-cables="rear"]', timeout=READY_MS)
        if len(page.query_selector_all('#sidePanel [data-loose]')) != 4:
            bad.append("fill rule: the loose-end lines changed on flipping to Rear")
        # 3D, the same rack: each loose link's landed end has a DANGLING TUBE,
        # starting on its connector and hanging free, out of every device box.
        try:
            page.evaluate("() => { delete window.__patch3d; }")
            page.click('#stageMode [data-mode="3d"]')
            page.wait_for_selector('[data-stage-ready="cable"]', timeout=READY_3D_MS)
            if not page.evaluate("async () => !!(await import('/site/webgl.js')).webglTrouble()"):
                page.wait_for_function("() => window.__patch3d && window.__patch3d.tubes.length === 14",
                                       timeout=READY_3D_MS)
                r = page.evaluate("""() => {
                    const {tubes, anchors, boxes} = window.__patch3d;
                    const loose = tubes.filter(t => t.loose.length);
                    const inside = [];
                    for (const t of loose) for (const p of t.points)
                        for (const b of boxes) if (b.box.containsPoint(p)) { inside.push(`${t.i}:${b.ref}`); break; }
                    return {loose: loose.map(t => ({i: t.i, mesh: !!t.mesh, n: t.points.length,
                                                    drop: t.points.length ? t.points[0].y - t.points.at(-1).y : 0})),
                            inside: [...new Set(inside)],
                            off: anchors.filter(a => loose.some(t => t.i === a.i) && !(a.firstGap <= 1))
                                        .map(a => `${a.i}:${a.side}`)}; }""")
                dangling = [t for t in r["loose"] if t["mesh"] and t["n"] > 2 and t["drop"] > 100]
                if len(r["loose"]) != 4 or len(dangling) != 4:
                    bad.append(f"fill rule in 3D: expected 4 loose links with dangling tubes, got {r['loose']}")
                if r["inside"]:
                    bad.append(f"fill rule in 3D: dangling tube points inside devices {r['inside']}")
                if r["off"]:
                    bad.append(f"fill rule in 3D: dangling tubes not starting at their connector {r['off']}")
        finally:
            page.click('#stageMode [data-mode="2d"]')
            page.wait_for_selector('[data-stage-ready="cable"]', timeout=READY_MS)
        # The tag goes where the fix is: stage 2, which seats slot-2's card.
        page.wait_for_selector('#stageRack svg [data-cable-tags="front"] [data-not-connected]', timeout=READY_MS)
        page.click('#stageRack svg [data-cable-tags="front"] [data-not-connected]')
        page.wait_for_selector('[data-stage-ready="populate"]', timeout=READY_MS)
        # Put the plan's card back, for the rest of the walk.
        page.click('.stage-rail button[data-stage="populate"]')
        page.wait_for_selector('[data-stage-ready="populate"]', timeout=READY_MS)
        page.select_option('#sidePanel select[data-bay="slot-2"]', "cisco/a9k-16x100ge-tr@1", timeout=READY_MS)
        page.wait_for_function("() => document.querySelector('#sidePanel [data-readout]')?.textContent.startsWith('seated — slot-2')", timeout=READY_MS)
        # Back on stage 4 the plan refills slot-2's cages: the count is the
        # first visit's again, not inflated by the re-seat.
        page.click('.stage-rail button[data-stage="cable"]')
        page.wait_for_selector('[data-stage-ready="cable"]', timeout=READY_MS)
        if seated_count() != seated.get("first"):
            bad.append(f"fill rule: 'seated for the plan' says {seated_count()} on a revisit, "
                       f"{seated.get('first')} on the first")
        if page.query_selector('#sidePanel [data-loose]'):
            bad.append("fill rule: loose ends remain after the plan's card is re-seated")

    def unseated_cage():
        # RULING R1, ONE STAGE OVER: an Unseat on stage 3 takes the optic's
        # plugs with it. Unseat an AS7726 cage the plan cables, then stage 4
        # keeps the empty cage, names its cable loose with stage 3 as the place
        # to fix it, and no `<cage>-occupant/` key is left behind in rack.js's
        # overrides (nor counted as a plan seat). Then seat it back.
        plan = json.loads((HERE / "site" / "showcase" / "patching.json").read_text())
        dev, cage = "as7726-32x", "port-1"
        row = next(i for i, l in enumerate(plan["links"])
                   if [dev, cage] in ([l["from"][0], l["from"][1]], [l["to"][0], l["to"][1]]))
        # The plan's plugs under the cage: the walk's own stage-3 seat put the
        # optic there before stage 4 first ran, so only the plugs are the plan's.
        plugs = sum(1 for k in plan["seats"][dev] if k.startswith(cage + "-occupant/"))
        def to_cage():
            page.click('.stage-rail button[data-stage="optics"]')
            page.wait_for_selector('[data-stage-ready="optics"]', timeout=READY_MS)
            page.select_option('#sidePanel select[data-cage]', cage, timeout=READY_MS)
            page.wait_for_function("(c) => document.querySelector('#sidePanel [data-cage-row] .mono')?.textContent === c",
                                   arg=cage, timeout=READY_MS)
        def to_cable():
            page.click('.stage-rail button[data-stage="cable"]')
            page.wait_for_selector('[data-stage-ready="cable"]', timeout=READY_MS)
        to_cage()
        page.click('#sidePanel [data-unseat]', timeout=READY_MS)
        page.wait_for_function("(c) => document.querySelector('#sidePanel [data-readout]')?.textContent.startsWith('unseated — ' + c)",
                               arg=cage, timeout=READY_MS)
        to_cable()
        loose = page.eval_on_selector_all('#sidePanel [data-loose]',
            "ls => ls.map(l => [+l.closest('li').querySelector('[data-plan-row]').dataset.planRow, l.textContent])")
        if not loose or any(i != row or "stage 3 (Seat optics)" not in t for i, t in loose):
            bad.append(f"stage 3 unseat: expected {dev} {cage}'s cable (row {row}) loose, naming stage 3, got {loose}")
        left = page.evaluate("""async ([d, c]) => Object.keys((await import('/site/showcase/rack.js')).overrides[d] || {})
            .filter(k => k.startsWith(c + '-occupant/'))""", [dev, cage])
        if left:
            bad.append(f"stage 3 unseat: {dev} {cage}'s plugs outlived its optic: {left}")
        first = seated.get("first")
        if first is None or seated_count() != first - plugs:
            bad.append(f"stage 3 unseat: 'seated for the plan' says {seated_count()}, expected {first} - {plugs}")
        # The unplugged lead's tag goes where the fix is: stage 3, which
        # seats the cage's optic.
        fix = f'#stageRack svg [data-not-connected][data-fix-stage="optics"][data-link-index="{row}"]'
        if not page.query_selector(fix):
            bad.append(f"stage 3 unseat: no not-connected tag on row {row} leading to stage 3 (optics)")
        else:
            page.click(fix)
            page.wait_for_selector('[data-stage-ready="optics"]', timeout=READY_MS)
        # Restore: seat the optic back, and stage 4 refills its plugs.
        to_cage()
        page.click('#sidePanel [data-seat]', timeout=READY_MS)
        page.wait_for_function("(c) => document.querySelector('#sidePanel [data-readout]')?.textContent.startsWith('seated — ' + c)",
                               arg=cage, timeout=READY_MS)
        to_cable()
        if page.query_selector('#sidePanel [data-loose]') or seated_count() != first:
            bad.append(f"stage 3 unseat: re-seating {cage} did not restore the plan "
                       f"({seated_count()} seated, {len(page.query_selector_all('#sidePanel [data-loose]'))} loose)")

    seated = {}
    # The plan's seats the rack still holds, read off plan.js itself - the
    # panel no longer lists them (feedback: by stage 4 the visitor knows what
    # is seated, and the list pushed the cables below the fold).
    def seated_count():
        return page.evaluate("""async () => {
            const R = await import('/site/showcase/rack.js');
            const P = await import('/site/showcase/plan.js');
            return P.planSeatsMade(R.overrides).length; }""")

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
        # Spec §6 item 7, amended: every end lands on a connector the plan
        # seats, copper on RJ45 plugs (#610); boots are not drawn yet (#611).
        side_text = page.inner_text('#sidePanel')
        if "RJ45 plugs in the copper jacks" not in side_text or "Portrayal #611" not in side_text:
            bad.append("stage cable: the panel does not say copper lands on RJ45 plugs, boots not yet (Portrayal #611)")
        # Every copper end on the front sits on its plug; nothing is unplugged.
        miss = page.evaluate(COPPER_ON_PLUGS_JS, "front")
        if miss:
            bad.append(f"stage cable in 2D: copper ends not on their RJ45 plug on the front: {miss}")
        if page.query_selector('#stageRack svg [data-not-connected]'):
            bad.append("stage cable in 2D: a not-connected tag on a fresh rack (front)")
        # PART 3: higher cables are painted over lower ones - named for the
        # AS4630-54TE's QSFP28 pair too, port-53 (link 6) above port-54
        # (link 7), whose leads looked crossed where they left the plugs.
        bad.extend(z_order_problems(page, "front"))
        bad.extend(tag_problems(page, "front"))
        order = page.eval_on_selector_all('#stageRack svg [data-cables="front"] [data-cable]',
                                          "gs => gs.map(g => +g.dataset.linkIndex)")
        if 6 in order and 7 in order and order.index(6) < order.index(7):
            bad.append("stage cable in 2D: the port-53 cable (link 6) is painted under the port-54 cable (link 7)")
        # A plan row is a button a keyboard reaches, so it shows a focus ring.
        page.keyboard.press("Shift")
        page.focus('#sidePanel [data-plan-row="0"]')
        ring = page.eval_on_selector('#sidePanel [data-plan-row="0"]', """b => {
            const s = getComputedStyle(b);
            return {fv: b.matches(':focus-visible'), style: s.outlineStyle, width: parseFloat(s.outlineWidth)}; }""")
        if not ring["fv"] or ring["style"] == "none" or not ring["width"] > 0:
            bad.append(f"stage cable: a focused plan row shows no focus ring ({ring})")
        page.evaluate("() => document.activeElement?.blur()")
        # THE CABLES ARE ABOVE THE FOLD: after the title, the question and the
        # one honesty line, the panel starts at the counts - no parts list.
        kids = page.eval_on_selector_all('#sidePanel > *', "ks => ks.map(k => k.dataset.counts || k.className)")
        at = kids.index("purpose") if "purpose" in kids else 99
        if at > 3 or page.query_selector('#sidePanel dt:text-is("seated for the plan")'):
            bad.append(f"stage cable: the counts are not at the top of the panel ({kids[:6]})")
        # Spec §6 panel items 3 and 5: counts by purpose AND media, and the
        # plan grouped by purpose - one group per purpose, in first-seen order,
        # every row keeping its original link index.
        plan = json.loads((HERE / "site" / "showcase" / "patching.json").read_text())
        for field in ("purpose", "media"):
            want = list(dict.fromkeys(l[field] for l in plan["links"]))
            got = page.eval_on_selector_all(f'#sidePanel [data-counts="{field}"] dt', "ds => ds.map(d => d.textContent)")
            if got != want:
                bad.append(f"stage cable: counts by {field} are {got}, the plan has {want}")
        groups = page.eval_on_selector_all('#sidePanel [data-plan-group]', "gs => gs.map(g => g.dataset.planGroup)")
        want_groups = list(dict.fromkeys(l["purpose"] for l in plan["links"]))
        if groups != want_groups:
            bad.append(f"stage cable: the plan is grouped as {groups}, not by purpose {want_groups}")
        rows = page.eval_on_selector_all('#sidePanel [data-plan-group] [data-plan-row]', "rs => rs.map(r => +r.dataset.planRow)")
        if sorted(rows) != list(range(len(plan["links"]))):
            bad.append(f"stage cable: grouped rows do not carry each link index once: {rows}")
        # What the plan seated on this first visit; kept_card holds later
        # visits to it (earlier stages seat some of the plan's refs themselves,
        # so it is not simply every seat in the file).
        seated["first"] = seated_count()
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
        # The rear elevation seats the plan too: the R740xd's rear copper ends
        # (NDC ports 1-2, iDRAC) sit on their RJ45 plugs.
        miss = page.evaluate(COPPER_ON_PLUGS_JS, "rear")
        if miss:
            bad.append(f"stage cable in 2D: copper ends not on their RJ45 plug on the rear: {miss}")
        if page.query_selector('#stageRack svg [data-not-connected]'):
            bad.append("stage cable in 2D: a not-connected tag on a fresh rack (rear)")
        bad.extend(z_order_problems(page, "rear"))
        bad.extend(tag_problems(page, "rear"))
        # Spec §6: seen from behind, a cross-face cable arrives from the LEFT.
        side = page.evaluate("""() => {
            const svg = document.querySelector('#stageRack svg');
            const rails = [...svg.querySelectorAll('[data-rail]')].map(r => r.getBoundingClientRect().left);
            const tags = [...svg.querySelectorAll('[data-tag]')].map(t => t.getBoundingClientRect().right);
            return {rail: Math.min(...rails), tags};
        }""")
        if not side["tags"] or not all(t < side["rail"] for t in side["tags"]):
            bad.append(f"stage cable: on the rear, a tag is not left of the left rail ({side})")
        # A row whose cable is not on this face flips to the face that has it.
        page.click('#sidePanel [data-plan-row="0"]')
        page.wait_for_selector('#stageRack svg [data-cables="front"] [data-cable][data-link-index="0"].on',
                               timeout=READY_MS)
        page.click('#stageTabs [data-view="rear"]')
        page.wait_for_selector('#stageRack svg [data-cables="rear"]', timeout=READY_MS)
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
        # THE HIGHLIGHT IS THE PORT (feedback: a square round the TX bore sat on
        # one corner of the port and "looks funny"). The box frames the whole
        # cage the optic went into, and the TX bore is ringed inside it.
        fit = page.evaluate("""() => {
            const el = document.querySelector('#stageRack svg [data-highlight="hl"]');
            const box = document.querySelector('#stageRack svg [data-highlight-box="hl"]');
            const ring = document.querySelector('#stageRack svg [data-highlight-box="hl-bore"]');
            if (!el || !box) return {why: 'no highlight'};
            const p = el.getBoundingClientRect(), b = box.getBoundingClientRect();
            const r = ring && ring.getBoundingClientRect();
            const inside = (o, i) => i.left >= o.left - 0.5 && i.right <= o.right + 0.5
                                  && i.top >= o.top - 0.5 && i.bottom <= o.bottom + 0.5;
            return {path: el.getAttribute('data-path'), covers: inside(b, p), ring: !!r,
                    ringInside: !!r && inside(b, r)}; }""")
        if not re.fullmatch(r"port-\d+", fit.get("path") or "") or not fit.get("covers"):
            bad.append(f"stage optics in 2D: the highlight does not frame the whole port ({fit})")
        if not fit.get("ring") or not fit.get("ringInside"):
            bad.append(f"stage optics in 2D: the TX bore is not ringed inside the port ({fit})")

    def filter_management():
        # "Show me just management": the plan's management cables at full
        # strength and every other cable ghosted, on the face shown and after
        # the Front/Rear toggle redraws it; the counts read off the plan (both
        # numbers derived from patching.json, not from what the page wrote).
        plan = json.loads((HERE / "site" / "showcase" / "patching.json").read_text())
        want = sum(1 for l in plan["links"] if l["purpose"] == "management")
        mgmt = {str(i) for i, l in enumerate(plan["links"]) if l["purpose"] == "management"}
        # THE FILTERS LEAD: the purpose row is the first thing after the title
        # and the question, ahead of the legend and the plan list.
        kids = page.eval_on_selector_all('#sidePanel > *', """ks => ks.map(k =>
            k.matches('[data-filter-row]') || k.querySelector('[data-filter-row]') ? 'filters'
            : (k.dataset.counts ? 'counts' : k.className))""")
        if "filters" not in kids or kids.index("filters") > 2 or "counts" in kids:
            bad.append(f"stage filter: the filters are not at the top of the panel ({kids[:6]})")
        # Spec §7: the same content as stage 4, the line on where ends land included.
        if "RJ45 plugs in the copper jacks" not in page.inner_text('#sidePanel'):
            bad.append("stage filter: the panel does not say copper lands on RJ45 plugs")
        page.click('#sidePanel [data-filter-purpose="management"]', timeout=READY_MS)
        page.wait_for_function(
            """([w, t]) => { const c = document.querySelector('#sidePanel [data-filter-count]');
                return !!c && c.dataset.matching === String(w) && c.dataset.total === String(t); }""",
            arg=[want, len(plan["links"])], timeout=READY_MS)
        lit = page.eval_on_selector_all('#stageRack svg [data-cable]:not(.ghost)', "gs => gs.length")
        ghost = page.eval_on_selector_all('#stageRack svg [data-cable].ghost', "gs => gs.length")
        if (lit, ghost) != (want, 14 - want):
            bad.append(f"stage filter in 2D: {lit} lit and {ghost} ghosted, expected {want} and {14 - want}")
        # The toggle redraws the face; the filter must hold on both.
        for view in ("rear", "front"):
            page.click(f'#stageTabs [data-view="{view}"]', timeout=READY_MS)
            page.wait_for_selector(f'#stageRack svg [data-cables="{view}"]', timeout=READY_MS)
            got = page.eval_on_selector_all('#stageRack svg [data-cable]',
                                            "gs => gs.map(g => [g.dataset.linkIndex, g.classList.contains('ghost')])")
            wrong = [i for i, ghosted in got if ghosted == (i in mgmt)]
            if not got or wrong:
                bad.append(f"stage filter in 2D: on the {view} after the toggle, cables {wrong} "
                           f"are ghosted wrongly ({len(got)} drawn)")

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

    # THE FILL RULE, once, after the stage walk: a card the visitor seats is
    # kept, and its cables are named loose ends.
    try:
        kept_card()
    except Exception as e:
        bad.append(f"fill rule: a visitor's slot-2 card - failed ({str(e).splitlines()[0]})")
    try:
        unseated_cage()
    except Exception as e:
        bad.append(f"stage 3 unseat: a plan cage emptied on stage 3 - failed ({str(e).splitlines()[0]})")

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

    def cable_3d():
        # Without WebGL there is no scene to measure, and the panel is what
        # answers (R11): all fourteen of the plan's rows.
        if page.evaluate("async () => !!(await import('/site/webgl.js')).webglTrouble()"):
            n = len(page.query_selector_all('#sidePanel [data-plan-row]'))
            if n != 14:
                bad.append(f"stage cable in 3D without WebGL: {n} of 14 plan rows")
            return
        # Fourteen tubes; each fiber tube starts at its connector; no sampled
        # point inside a device body (spec §5.3's clearance rule).
        page.wait_for_function("() => window.__patch3d && window.__patch3d.tubes.length === 14",
                               timeout=READY_3D_MS)
        r = page.evaluate("""() => {
            const {tubes, anchors, boxes} = window.__patch3d;
            const inside = [];
            for (const t of tubes) for (const p of t.points)
                for (const b of boxes) if (b.box.containsPoint(p)) { inside.push(`${t.i}:${b.ref}`); break; }
            const off = anchors.filter(a => a.firstGap > 1).map(a => `${a.i}:${a.side} ${a.firstGap.toFixed(1)}`);
            const back = anchors.filter(a => !(a.out > 1)).map(a => `${a.i}:${a.side} ${a.out.toFixed(1)}`);
            return {n: tubes.filter(t => t.mesh).length, inside: [...new Set(inside)].slice(0, 5), off, back,
                    fiber: anchors.length, tabs: document.getElementById('stageTabs')?.childElementCount ?? 0};
        }""")
        if r["n"] != 14: bad.append(f"stage cable in 3D: {r['n']} of 14 tubes")
        if r["inside"]: bad.append(f"stage cable in 3D: tube points inside devices {r['inside']}")
        if r["off"]: bad.append(f"stage cable in 3D: fiber tubes not starting at their connector {r['off']}")
        if r["back"]: bad.append(f"stage cable in 3D: fiber runs not leaving straight out of the face {r['back'][:5]}")
        if not r["fiber"]: bad.append("stage cable in 3D: no fiber connector anchored")
        # Copper too: every end of all fourteen (28) is anchored on its seated
        # connector's cablePoints, so the firstGap check above holds copper
        # tubes to within 1 mm of their cableAnchor as well.
        ends = page.evaluate("() => [...new Set(window.__patch3d.anchors.map(a => `${a.i}:${a.side}`))].length")
        if ends != 28:
            bad.append(f"stage cable in 3D: {ends} of 28 cable ends anchored on a connector")
        # PART 3 in 3D: a higher connector's lead reaches further out of the
        # face than the one below it, so it hangs in front: port-53 (link 6)
        # over port-54 (link 7), both on the AS4630-54TE.
        reach = page.evaluate("""() => Object.fromEntries(window.__patch3d.anchors
            .filter(a => a.side === 'from' && (a.i === 6 || a.i === 7)).map(a => [a.i, a.out]))""")
        if not (reach.get("6", 0) > reach.get("7", 0) + 1):
            bad.append(f"stage cable in 3D: the port-53 lead does not reach out past the port-54 one ({reach})")
        if r["tabs"]: bad.append("stage cable in 3D: the 2D-only Front/Rear tabs are showing")

    def filter_3d():
        # Without WebGL the panel answers (R11): the count still narrows.
        plan = json.loads((HERE / "site" / "showcase" / "patching.json").read_text())
        want = sum(1 for l in plan["links"] if l["purpose"] == "management")
        page.click('#sidePanel [data-filter-purpose="management"]', timeout=READY_3D_MS)
        m = page.get_attribute('#sidePanel [data-filter-count]', "data-matching")
        if m != str(want):
            bad.append(f"stage filter in 3D: the panel counts {m} management cables, expected {want}")
        if page.evaluate("async () => !!(await import('/site/webgl.js')).webglTrouble()"):
            return
        # Spec §7: what the filter leaves out fades to a GHOST (opacity 0.12,
        # still shown), it does not vanish. Every material of a tube counts:
        # its main run and any duplex strands.
        r = page.evaluate("""(ghost) => {
            const shown = o => { for (let n = o; n; n = n.parent) if (!n.visible) return false; return true; };
            const mats = t => { const ms = []; t.mesh.traverse(o => { if (o.material) ms.push(o); }); return ms; };
            const tubes = window.__patch3d.tubes.filter(t => t.mesh);
            return {
              full: tubes.filter(t => mats(t).every(o => o.material.opacity === 1)).length,
              ghost: tubes.filter(t => mats(t).every(o => shown(o) && o.material.transparent
                                                     && o.material.opacity === ghost)).length,
              meshes: tubes.length };
        }""", 0.12)
        if r["full"] != want: bad.append(f"stage filter in 3D: {r['full']} tubes at full strength, expected {want}")
        if r["ghost"] != len(plan["links"]) - want:
            bad.append(f"stage filter in 3D: {r['ghost']} tubes ghosted at 0.12 and shown, expected "
                       f"{len(plan['links']) - want} ({r})")

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
        for name in ("optics", "cable", "filter"):
            try:
                page.click(f'.stage-rail button[data-stage="{name}"]', timeout=READY_3D_MS)
                page.wait_for_selector(f'[data-stage-ready="{name}"]', timeout=READY_3D_MS)
                if not layers_are("3d"):
                    bad.append(f"stage {name} in 3D: the 2D drawing is showing")
                if name == "optics":
                    seat_optic_3d()
                if name == "cable":
                    cable_3d()
                if name == "filter":
                    filter_3d()
            except Exception as e:
                bad.append(f"stage {name} in 3D: {str(e).splitlines()[0]}")
        page.click('#stageMode [data-mode="2d"]')
        page.wait_for_selector('[data-stage-ready="filter"]', timeout=READY_MS)
        if not layers_are("2d"):
            bad.append("stage filter: switching back to 2D did not replace the 3D picture")
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


def check_schema_coverage(page, base):
    """Every property in every schema file is a row on schema.html.

    The page renders the files at runtime, which keeps the WORDS current and
    says nothing about whether the renderer reaches them. It once stopped at
    the first map, and 146 of the device schema's 230 properties were simply
    not on the page. Each row carries its JSON pointer in data-ptr; the files
    are walked with the same rules by schemawalk.py, and the two must agree.
    """
    import schemawalk
    bad = []
    for fname, doc in schemawalk.documents().items():
        key = fname.split(".")[0]
        page.goto(f"{base}/schema.html?doc={key}", wait_until="load")
        try:
            page.wait_for_selector("#schema-body .sc-prop", timeout=15000)
        except Exception:
            bad.append(f"{fname}: the page rendered no properties")
            continue
        shown = set(page.eval_on_selector_all(
            "#schema-body .sc-prop[data-ptr]", "ns => ns.map(n => n.dataset.ptr)"))
        want = schemawalk.property_pointers(doc)
        missing = sorted(want - shown)
        if missing:
            bad.append(f"{fname}: {len(missing)} of {len(want)} properties not rendered, e.g. "
                       + ", ".join(missing[:5]))
        raw = page.eval_on_selector_all("#schema-body .sc-raw", "ns => ns.length")
        if raw:
            bad.append(f"{fname}: {raw} node(s) fall back to raw JSON - a keyword the viewer does not render")
    return bad


# CHECKS ADDED FOR THE RACK BUILDER, registered rather than hand-wired into
# main() one block at a time, so `--only` can run one of them in seconds while
# a task is being built. Each is fn(page, base) -> list of problems.
EXTRA_CHECKS = []


def extra(label):
    def register(fn):
        EXTRA_CHECKS.append((label, fn))
        return fn
    return register


def run_extra(browser, base, only, problems, notes):
    failed = 0
    for label, fn in EXTRA_CHECKS:
        if only and fn.__name__ not in only:
            continue
        CLOCK[0] = time.time()
        page = browser.new_page()
        try:
            bad = fn(page, base)
        except Exception as e:
            bad = [f"{label}: {str(e).splitlines()[0]}"]
        finally:
            page.close()
        if bad:
            failed += 1
            problems.append(f"FAIL  {label}")
            problems += [f"        {b}" for b in dict.fromkeys(bad)]
        else:
            notes.append(f"ok    {label}")
        took(label)
    return failed


@extra("the Explorer lens opens a device with its swaps and fields, and hands them back")
def check_rack_lens(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    page.goto(f"{base}/index.html", wait_until="load")
    page.evaluate("""() => { window.__lens = import('/site/rack/explorer-lens.js').then(L =>
      L.openLens({ref: 'as7726-32x', cfg: 'ac-f2b', title: 'AS7726',
                  swaps: {'port-1': 'generic/qsfp-lc@2'},
                  fields: {'port-1-occupant': {label: 'LENS-1'}}})); }""")
    page.wait_for_selector(".rk-lens iframe", timeout=READY_MS)
    # SYNCHRONOUS PREDICATE: a promise-returning one is truthy the instant it is
    # called, before it ever settles - wait_for_function has no way to tell "not
    # yet" from "still pending" apart, so it returns on the first poll. The
    # awaiting happens after, in a plain evaluate.
    page.wait_for_function(
        "() => !!document.querySelector('.rk-lens iframe')?.contentWindow?.portrayalEmbed",
        timeout=READY_MS)
    page.evaluate(
        "async () => { await document.querySelector('.rk-lens iframe').contentWindow.portrayalEmbed.ready; }")
    page.click(".rk-lens-done")
    r = page.evaluate("async () => await window.__lens")
    if not r:
        bad.append("lens: resolved null")
    else:
        if r.get("device") != "as7726-32x":
            bad.append(f"lens: device {r.get('device')!r}")
        if r.get("swaps", {}).get("port-1") != "generic/qsfp-lc@2":
            bad.append(f"lens: swaps {r.get('swaps')!r}")
        if r.get("fields", {}).get("port-1-occupant", {}).get("label") != "LENS-1":
            bad.append(f"lens: fields {r.get('fields')!r}")
    if page.query_selector(".rk-lens"):
        bad.append("lens: the overlay is still open after Done")
    return bad


@extra("configuredFace seats cards, rear bays, optics and fields")
def check_configured_face(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    page.goto(f"{base}/index.html", wait_until="load")
    r = page.evaluate("""async () => {
      const F = await import('/site/rack/face.js');
      const out = {};
      const plain = await F.configuredFace({ref: 'asr-9006', cfg: 'base', view: 'front'});
      const card = await F.configuredFace({ref: 'asr-9006', cfg: 'base', view: 'front',
        swaps: {'slot-2': 'cisco/a9k-16x100ge-tr@1'}});
      out.plainHasCardPort = plain.zones.some(z => z.path === 'slot-2/module/p0');
      out.cardZone = card.zones.some(z => z.path === 'slot-2/module/p0');
      out.cardPort = card.ports.some(p => p.path === 'slot-2/module/p0');
      const rear = await F.configuredFace({ref: 'as7726-32x', cfg: 'ac-f2b', view: 'rear',
        swaps: {'psu-2': 'common/psu-dc-650@2'}});
      out.rearPsu = rear.text.includes('data-ref="common/psu-dc-650@2');
      const opt = await F.configuredFace({ref: 'as7726-32x', cfg: 'ac-f2b', view: 'front',
        swaps: {'port-1': 'generic/qsfp-lc@2'},
        fields: {'port-1-occupant': {label: 'PROBE-LR4'}}});
      out.optic = opt.text.includes('data-ref="generic/qsfp-lc@2');
      out.label = opt.text.includes('PROBE-LR4');
      const turned = await F.configuredFace({ref: 'as7726-32x', cfg: 'ac-f2b', view: 'front', turned: true});
      out.turned = turned.view === 'rear';
      out.memo = F.configuredFace({ref: 'asr-9006', cfg: 'base', view: 'front'})
             === F.configuredFace({view: 'front', cfg: 'base', ref: 'asr-9006'});
      out.missing = (await F.configuredFace({ref: 'asr-9006', cfg: 'no-such-cfg', view: 'front'})) === null;
      return out;
    }""")
    expect = {"plainHasCardPort": False, "cardZone": True, "cardPort": True, "rearPsu": True,
              "optic": True, "label": True, "turned": True, "memo": True, "missing": True}
    for k, want in expect.items():
        if r.get(k) != want:
            bad.append(f"configuredFace: {k} is {r.get(k)!r}, expected {want!r}")
    return bad



# THE KIT PAGE'S RECIPES, RUN. Each <figure data-example> runs its own file
# into its pane and records what it returned; this holds every one to what its
# section promises. KIT_EXPECT grows one entry per recipe.
KIT_EXPECT = {
    "01-drawing": lambda r: r.get("lit") == ["port-12"],
    "02-telemetry": lambda r: r.get("colored") == 5,
    "03-metadata": lambda r: r.get("device") == "UfiSpace S9600-72XC" and "base" in r.get("configs", [])
                   and r.get("chassis", {}).get("w") == 436 and r.get("chassis", {}).get("ru") == 2
                   and r.get("devices", 0) >= 100 and r.get("verified") is True,
    "05-viewer3d": lambda r: True,     # clicked and asserted on its own below
    "04-seat": lambda r: r.get("seated", 0) >= 3 and r.get("refused") == [] and r.get("url", "").startswith("port-4~"),
    "06-marks": lambda r: r.get("marks") == 3 and r.get("svgBytes", 0) > 1000 and len(r.get("share", "")) > 10,
    "07-shell": lambda r: r.get("shell") is True and r.get("device") == "s9600-72xc",
}

@extra("kit.html: every recipe runs and returns what its section promises")
def check_kit_page(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"kit: uncaught {e}"))
    page.goto(f"{base}/kit.html", wait_until="load")
    bg_before = page.evaluate("getComputedStyle(document.body).backgroundColor")   # before any recipe ran
    names = page.eval_on_selector_all("figure.kit-ex", "fs => fs.map(f => [f.dataset.example, f.dataset.run])")
    if sorted(n for n, _ in names) != sorted(KIT_EXPECT):
        bad.append(f"kit: figures {sorted(n for n, _ in names)} vs expected {sorted(KIT_EXPECT)}")
    for name, mode in names:
        fig = f'figure[data-example="{name}"]'
        if mode == "click":
            continue                     # the 3D recipe has its own step (Task 4)
        page.locator(fig).scroll_into_view_if_needed()
        try:
            page.wait_for_selector(f"{fig}[data-result], {fig}[data-error]", timeout=READY_MS)
        except Exception:
            bad.append(f"kit: {name} never finished"); continue
        err = page.get_attribute(fig, "data-error")
        if err: bad.append(f"kit: {name} failed: {err}"); continue
        res = json.loads(page.get_attribute(fig, "data-result"))
        if not KIT_EXPECT.get(name, lambda r: True)(res):
            bad.append(f"kit: {name} returned {res}")
    # the shell recipe runs in its own document: the guide's colors are untouched
    page.locator('figure[data-example="07-shell"]').scroll_into_view_if_needed()
    page.wait_for_selector('figure[data-example="07-shell"][data-result], figure[data-example="07-shell"][data-error]',
                           timeout=READY_MS)
    if page.evaluate("getComputedStyle(document.body).backgroundColor") != bg_before:
        bad.append("kit: the shell recipe changed the guide page's own colors")
    # 01: a click on a port says its data-path
    page.click('figure[data-example="01-drawing"] .kit-result [data-path="port-12"]', force=True)
    said = page.text_content('figure[data-example="01-drawing"] .kit-result output') or ""
    if "port-12" not in said: bad.append(f"kit: clicking port-12 printed {said!r}")
    # Run again, twice fast: one drawing in the pane, not two
    page.click('figure[data-example="01-drawing"] [data-act="run"]')
    page.click('figure[data-example="01-drawing"] [data-act="run"]')
    page.wait_for_selector('figure[data-example="01-drawing"][data-result]', timeout=READY_MS)
    page.wait_for_timeout(500)
    n = page.eval_on_selector_all('figure[data-example="01-drawing"] .kit-result svg', "e => e.length")
    if n != 1: bad.append(f"kit: after two quick reruns pane 01 holds {n} drawings")
    # Copy gives the file's text, not the highlighted markup
    copied = page.evaluate("async () => { document.querySelector('figure[data-example=\"01-drawing\"] [data-act=\"copy\"]').click();"
                           " await new Promise(r => setTimeout(r, 50)); return window.__kit.copyText['01-drawing']; }")
    src = page.evaluate("() => fetch('site/kit-examples/01-drawing.js').then(r => r.text())")
    if copied != src: bad.append("kit: Copy did not produce the example's exact source")
    # 05: 3D builds on a click, selects port-12 and lights its lamp - or, with
    # no WebGL here, says why instead of showing a black box.
    fig3 = 'figure[data-example="05-viewer3d"]'
    if not page.query_selector(fig3):
        bad.append("kit: no 05-viewer3d figure")
    elif webgl_trouble(page):
        print("  note  kit.html 3D recipe not exercised: this runner has no WebGL")
    else:
        page.locator(fig3).scroll_into_view_if_needed()
        page.click(f"{fig3} .kit-result button[data-act='build']")
        page.wait_for_selector(f"{fig3}[data-result], {fig3}[data-error]", timeout=READY_3D_MS)
        err = page.get_attribute(fig3, "data-error")
        res = json.loads(page.get_attribute(fig3, "data-result") or "{}")
        if err or not (res.get("loaded") and res.get("selected") == "port-12" and res.get("lit") == "state-on"):
            bad.append(f"kit: 3D recipe returned {res} / {err}")
        # a fast rerun on a fresh page leaves one viewer, not two stacked
        page.goto(f"{base}/kit.html?fresh=1#three-d", wait_until="load")   # a query forces a real reload
        page.locator(fig3).scroll_into_view_if_needed()
        # watch the pane for the whole race: the most hosts it ever holds at once
        page.evaluate("""f => { window.__kitMaxHosts = 0; const pane = document.querySelector(f + ' .kit-result');
            new MutationObserver(() => { window.__kitMaxHosts = Math.max(window.__kitMaxHosts,
                pane.querySelectorAll('.kit-host').length); }).observe(pane, {childList: true, subtree: true}); }""", fig3)
        # both clicks in one task, so both runs are in flight before either import lands
        page.evaluate("""f => { document.querySelector(f + " .kit-result button[data-act='build']").click();
                                document.querySelector(f + " [data-act='run']").click(); }""", fig3)
        page.wait_for_selector(f"{fig3}[data-result], {fig3}[data-error]", timeout=READY_3D_MS)
        page.wait_for_timeout(1500)
        most = page.evaluate("window.__kitMaxHosts")
        hosts = page.eval_on_selector_all(f"{fig3} .kit-result .kit-host", "e => e.length")
        canvases = page.eval_on_selector_all(f"{fig3} .kit-result canvas", "e => e.length")
        if most > 1 or hosts != 1 or canvases != 1:
            bad.append(f"kit: a fast 3D rerun stacked {most} viewers at once (ends with {hosts} hosts, {canvases} canvases)")
    # a failing recipe stays in its own pane
    page.goto(f"{base}/kit.html?kitfail=1", wait_until="load")
    page.wait_for_selector('figure[data-example="kitfail"][data-error]', timeout=READY_MS)
    txt = page.text_content('figure[data-example="kitfail"] .kit-result') or ""
    if "failed" not in txt: bad.append(f"kit: a failing recipe's pane says {txt!r}")
    page.locator('figure[data-example="01-drawing"]').scroll_into_view_if_needed()
    page.wait_for_selector('figure[data-example="01-drawing"][data-result]', timeout=READY_MS)
    return bad


@extra("kit.html: without WebGL the 3D recipe says why")
def check_kit_no_webgl(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"kit: uncaught {e}"))
    page.add_init_script(NO_WEBGL_JS)
    page.goto(f"{base}/kit.html", wait_until="load")
    fig3 = 'figure[data-example="05-viewer3d"]'
    page.locator(fig3).scroll_into_view_if_needed()
    page.wait_for_selector(f"{fig3}[data-error]", timeout=READY_MS)
    txt = page.text_content(f"{fig3} .kit-result") or ""
    if "webgl" not in txt.lower(): bad.append(f"kit: the no-WebGL 3D pane says {txt!r}")
    run = page.query_selector(f"{fig3} [data-act='run']")
    if run and run.is_visible() and run.is_enabled():
        run.click()
        page.wait_for_timeout(1500)
    txt = page.text_content(f"{fig3} .kit-result") or ""
    if "failed" in txt.lower() or "webgl" not in txt.lower():
        bad.append(f"kit: without WebGL, Run again on the 3D recipe leaves {txt!r}")
    return bad


DOCS_PAGES = ["index.html", "schema.html", "kit.html", "explorer.html", "components.html",
              "annotate.html", "drawio.html", "exporter.html", "drawings.html",
              "contribute.html"]


# EVERY FACE RESOLVES (Portrayal #670). Each distinct drawing is written once,
# named after the first configuration that draws it, and configs[].files says
# which file each configuration's face is - so `s9600-72xc.base.front.svg` does
# not exist (base draws ac's front). This drives the site's per-configuration
# readers on devices #670 renamed, and fails on any face request that 404s.

# THE SCHEMA PAGE'S NOS TAB FOLLOWS THE SCHEMAS (Portrayal #677). #677 replaces
# overlay.schema.json with listing.schema.json. The page shows a tab for each
# schema file the site carries and none for one it does not, so it is right on
# both sides of the change. After: served with the overlay schema gone and a
# listing schema in its place.

# THE DCIM EXPORT PAGE AFTER PORTRAYAL #677. A NOS vendor lists the hardware
# it supports, and each listing exports as a device type under that vendor's
# own folder: UfiSpace's S9510-28DC-BN0B and Arrcus's S9510-28DC-BN0B are the
# same switch, filed by the two companies that sell it. The page named options
# by file name alone (two identical "S9510-28DC-BN0B · no NOS" rows) and kept a
# NOS picker that matched nothing.
@extra("exporter.html: a NOS vendor's listing is its own labeled type, and bundles take listings or leave them")
def check_exporter_listings(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"exporter: uncaught {e}"))
    page.goto(f"{base}/exporter.html?device=s9510-28dc", wait_until="load")
    page.wait_for_function("() => document.querySelectorAll('#variant option').length >= 2", timeout=READY_MS)
    labels = page.eval_on_selector_all("#variant option", "os => os.map(o => o.textContent)")
    if len(set(labels)) != len(labels): bad.append(f"exporter: duplicate labels {labels}")
    for want in ("UfiSpace · S9510-28DC-BN0B", "Arrcus · S9510-28DC-BN0B"):
        if not any(l.startswith(want) for l in labels): bad.append(f"exporter: no option {want!r} in {labels}")
    if any("no NOS" in l for l in labels): bad.append(f"exporter: 'no NOS' labels {labels}")
    if page.query_selector("#bnos"): bad.append("exporter: the NOS picker that matches nothing is still there")
    plan = lambda scope, listings: page.evaluate(
        "([s, l]) => window.__exporter.planBundle('netbox', s, l, 'UfiSpace')", [scope, listings])
    lis = "netbox/device-types/Arrcus/S9510-28DC-BN0B.yaml"
    own = "netbox/device-types/UfiSpace/S9510-28DC-BN0B.yaml"
    try:
        with_l, without = plan("vendor", True), plan("vendor", False)
        if lis not in with_l or own not in with_l:
            bad.append("exporter: a UfiSpace bundle with listings lacks the Arrcus listing or the UfiSpace type")
        if lis in without or own not in without:
            bad.append("exporter: a UfiSpace bundle without listings still carries the Arrcus listing")
        if any("/device-types/Arrcus/" in r for r in plan("all", False)):
            bad.append("exporter: 'everything' without listings still carries NOS vendor types")
    except Exception as e:
        bad.append(f"exporter: no window.__exporter.planBundle ({str(e).splitlines()[0]})")
    return bad

@extra("schema.html shows a NOS tab for the NOS schema the site carries - overlay before #677, listing after")
def check_schema_nos_tab(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"schema: uncaught {e}"))
    tabs = "() => [...document.querySelectorAll('.show-tabs button')].filter(b => !b.hidden).map(b => b.dataset.schema)"
    have = "listing" if (pathlib.Path(__file__).resolve().parent / "assets" / "schemas" / "listing.schema.json").exists() else "overlay"
    other = "overlay" if have == "listing" else "listing"
    # as vendored - and without asking for a schema the site does not carry
    misses = []
    page.on("response", lambda r: misses.append(r.url) if r.status == 404 else None)
    page.goto(f"{base}/schema.html", wait_until="load")
    page.wait_for_selector("#schema-body .sc-prop", timeout=READY_MS)
    page.wait_for_timeout(500)
    got = page.evaluate(tabs)
    if got != ["device", "component", have]:
        bad.append(f"schema: with {have}.schema.json vendored the tabs are {got}")
    if misses: bad.append(f"schema: the page asked for missing files {misses}")
    # the other side of #677: this snapshot's NOS schema gone, the other one served
    stub = {"$schema": "https://json-schema.org/draft/2020-12/schema", "title": other, "type": "object",
            "properties": {"hardware": {"type": "string", "description": "a property to find"}}}
    page.route(f"**/assets/schemas/{have}.schema.json", lambda r: r.fulfill(status=404, body="the other side of #677"))
    page.route(f"**/assets/schemas/{other}.schema.json", lambda r: r.fulfill(json=stub))
    page.route("**/assets/schemas/index.json", lambda r: r.fulfill(json={"schemas": sorted(
        ["component.schema.json", "device.schema.json", f"{other}.schema.json"])}))
    page.goto(f"{base}/schema.html?doc={other}", wait_until="load")
    page.wait_for_selector("#schema-body .sc-prop", timeout=READY_MS)
    page.wait_for_timeout(500)
    got = page.evaluate(tabs)
    order = ["device", "component", "listing"] if other == "listing" else ["device", "component", "overlay"]
    if got != order:
        bad.append(f"schema: with only {other}.schema.json the tabs are {got}")
    if not page.query_selector('#schema-body .sc-prop[data-ptr="/properties/hardware"]'):
        bad.append(f"schema: ?doc={other} did not render the {other} schema")
    return bad

@extra("every face resolves through configs[].files (Portrayal #670)")
def check_faces_after_670(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"670: uncaught {e}"))
    missed = []
    page.on("response", lambda r: missed.append(r.url.rsplit("/", 1)[-1])
            if "/assets/dist/" in r.url and r.url.endswith(".svg") and r.status == 404 else None)
    page.goto(f"{base}/kit.html", wait_until="load")
    for name in ("01-drawing", "02-telemetry", "03-metadata", "04-seat", "06-marks"):
        fig = f'figure[data-example="{name}"]'
        page.locator(fig).scroll_into_view_if_needed()
        page.wait_for_selector(f"{fig}[data-result], {fig}[data-error]", timeout=READY_MS)
        if page.get_attribute(fig, "data-error"):
            bad.append(f"670: kit recipe {name} failed: {page.get_attribute(fig, 'data-error')}")
    got = page.evaluate("""async () => {
        const F = await import('/site/rack/face.js');
        const out = {};
        for (const [ref, cfg, views] of [['r740xd', 'sff24-rc5-1b2a3a', ['front', 'rear', 'top']],
                                         ['fhd-1ufce', 'populated', ['front', 'top', 'left']],
                                         ['s9600-72xc', 'base', ['front', 'rear']]])
          for (const view of views)
            out[`${ref}.${cfg}.${view}`] = !!(await F.configuredFace({ref, cfg, view}));
        return out; }""")
    for k, ok in got.items():
        if not ok: bad.append(f"670: configuredFace({k}) found no face")
    # the hero's 3D panel builds s9600-72xc `base`, every face of which #670 renames
    if not webgl_trouble(page):
        page.goto(f"{base}/index.html?heroprobe=1", wait_until="load")
        page.locator("#hero-3d").scroll_into_view_if_needed()
        try:
            page.wait_for_function("() => window.__hero3d && window.__hero3d.tubes.length >= 21", timeout=READY_3D_MS)
        except Exception:
            bad.append("670: the hero's 3D panel never built")
    if missed: bad.append(f"670: {len(missed)} face requests 404d, e.g. {sorted(set(missed))[:4]}")
    return bad


# THE PAGE'S LOAD IS NOT THE 3D HERO'S TO HOLD. The hero's 3D build rasterizes
# every face through an <img> on a blob: URL, about 600 of them, and an image
# that starts before `load` holds `load` back until it is done. It used to start
# when the 2D hero had settled and the browser was idle, which comes before
# `load` whenever the page's last fetch is slow - and then `load` waited for the
# whole build: 26-30 s on a busy machine, and the Page.goto timeouts of
# roc-ops/portrayal-site#72. So: hold one of the page's own images (the footer's
# sponsor logo) past the point where the 2D hero has settled and idle has come,
# and the 3D build may not start until that image is let go and `load` fires.
@extra("the 3D hero starts only after the page's load event, so it never holds load back")
def check_hero_after_load(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    held = []
    page.route("**/brand/sponsor/RocNet-Primary-Logo.svg", lambda r: held.append(r))
    page.goto(f"{base}/index.html", wait_until="domcontentloaded")
    page.wait_for_function("() => document.querySelector('#hero-reveal .reveal-rich svg[data-hero-seated]')"
                           " && document.querySelectorAll('#hero-reveal [data-hero-cable]').length === 21",
                           timeout=READY_MS)
    page.wait_for_timeout(3000)       # past hero-3d.js's IDLE_MS, so idle has certainly come
    if not held:
        return bad + ["the sponsor logo was never requested, so nothing held the page's load"]
    if page.evaluate("document.readyState") == "complete":
        bad.append("the page fired load with its sponsor logo still loading")
    # The scene's canvas is the build's first act. (Not the blob: requests
    # themselves: with a route in place Playwright does not report them.)
    if page.query_selector("#hero-3d canvas"):
        bad.append("the 3D hero started building before the page's load event")
    for r in held:
        r.continue_()
    page.wait_for_function("document.readyState === 'complete'", timeout=READY_MS)
    if not webgl_trouble(page):
        try:
            page.wait_for_function("() => document.querySelector('#hero-3d canvas')", timeout=READY_MS)
        except Exception:
            bad.append("the 3D hero did not start once the page had loaded")
    return bad

@extra("the Docs menu opens on every page, level with its neighbors, and Escape closes it")
def check_docs_menu(page, base):
    bad = []
    page.set_viewport_size({"width": 1440, "height": 900})
    for name in DOCS_PAGES:
        page.goto(f"{base}/{name}", wait_until="domcontentloaded")
        d = "details.navmenu[data-docs]"
        try:
            page.wait_for_selector(d, timeout=READY_MS)
        except Exception:
            bad.append(f"{name}: no Docs menu"); continue
        # the label sits on the same baseline as the nav's plain links
        off = page.evaluate("""() => {
            const s = document.querySelector('details.navmenu[data-docs] > summary');
            const nav = s.closest('nav');
            const link = [...nav.querySelectorAll(':scope > a')].find(a => a.offsetParent && a.textContent.trim().length > 2
                                                                  && a.getClientRects().length === 1);
            if (!link) return null;
            const r = x => { const g = document.createRange(); g.selectNodeContents(x.firstChild); return g.getBoundingClientRect().bottom; };
            return Math.abs(r(s) - r(link)); }""")
        if off is not None and off > 0.6:
            bad.append(f"{name}: the Docs label is {off:.1f}px off its neighbors' baseline")
        page.click(f"{d} > summary")
        links = page.eval_on_selector_all(f"{d}[open] .navmenu-items a", "as => as.map(a => a.getAttribute('href'))")
        if links != ["schema.html", "kit.html", "contribute.html"]:
            bad.append(f"{name}: the open Docs menu offers {links}")
        page.keyboard.press("Escape")
        if page.evaluate(f"!!document.querySelector('{d}').open"):
            bad.append(f"{name}: Escape leaves the Docs menu open")
    # a phone-width masthead still fits: the Docs menu must not push the page sideways
    for w in (360, 375):
        page.set_viewport_size({"width": w, "height": 800})
        for name in ("index.html", "schema.html", "kit.html"):
            page.goto(f"{base}/{name}", wait_until="domcontentloaded")
            page.wait_for_timeout(300)
            sw = page.evaluate("document.documentElement.scrollWidth")
            if sw > w: bad.append(f"{name} at {w}px scrolls sideways to {sw}px")
    return bad

@extra("configuredFace snapshots swaps/fields, immune to the caller mutating them before awaiting")
def check_configured_face_snapshot(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    page.goto(f"{base}/index.html", wait_until="load")
    r = page.evaluate("""async () => {
      const F = await import('/site/rack/face.js');
      // The showcase never replaces overrides[dev] - applyPlanSeats, dropBelow
      // and stage 2/3's doSeat all write INTO the same object a build already
      // has a live reference to. Simulate that: mutate the SAME swaps object
      // synchronously, right after calling configuredFace and before this
      // await lets the pending build run any further, so a build that reads
      // `swaps` after its own later awaits would see the mutation instead of
      // what the caller asked for when the key was computed.
      const swaps = {'slot-2': 'cisco/a9k-16x100ge-tr@1'};
      const pending = F.configuredFace({ref: 'asr-9006', cfg: 'base', view: 'front', swaps});
      delete swaps['slot-2'];
      swaps['slot-3'] = 'cisco/a9k-16x100ge-tr@1';
      const face = await pending;
      return {
        origZone: face.zones.some(z => z.path === 'slot-2/module/p0'),
        origPort: face.ports.some(p => p.path === 'slot-2/module/p0'),
        mutatedZone: face.zones.some(z => z.path === 'slot-3/module/p0'),
      };
    }""")
    expect = {"origZone": True, "origPort": True, "mutatedZone": False}
    for k, want in expect.items():
        if r.get(k) != want:
            bad.append(f"configuredFace snapshot: {k} is {r.get(k)!r}, expected {want!r} - "
                       "a build in flight read the caller's swaps object after it was mutated")
    return bad


@extra("configuredFace's memo is bounded, least recently asked-for first out")
def check_face_memo_bound(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    # A blank page on the site's origin: the showcase on index.html can call
    # configuredFace itself, which would throw off the size/eviction counts.
    page.route(f"{base}/__blank.html",
               lambda r: r.fulfill(body="<!doctype html><title>blank</title>", content_type="text/html"))
    page.goto(f"{base}/__blank.html", wait_until="load")
    r = page.evaluate("""async () => {
      const F = await import('/site/rack/face.js');
      F.setFaceMemoLimit(3);
      const ask = i => F.configuredFace({ref: 'as7726-32x', cfg: 'ac-f2b', view: 'front',
                                         fields: {'port-1-occupant': {label: `M${i}`}}});
      const a = ask(1); await a; await ask(2); await ask(3);
      const again = ask(1) === a;          // a hit refreshes it
      await ask(4);                        // evicts 2, the least recently asked-for
      const size = F.faceMemoSize();
      const oneKept = ask(1) === a;
      F.setFaceMemoLimit(F.FACE_MEMO_LIMIT);
      return {again, size, oneKept};
    }""")
    if r != {"again": True, "size": 3, "oneKept": True}:
        bad.append(f"face memo: {r}")
    return bad


@extra("the component index is fetched again after a failure")
def check_components_retry(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    failed = {"n": 0}

    def fail_once(route):
        if failed["n"] == 0:
            failed["n"] += 1
            route.abort()
        else:
            route.continue_()
    # A blank page on the site's origin, so nothing but this check asks for
    # the component index - the first ask is the one the route fails.
    page.route(f"{base}/__blank.html",
               lambda r: r.fulfill(body="<!doctype html><title>blank</title>", content_type="text/html"))
    page.route("**/assets/dist/components.json", fail_once)
    page.goto(f"{base}/__blank.html", wait_until="load")
    r = page.evaluate("""async () => {
      const F = await import('/site/rack/face.js');
      const first = (await F.components()).length;
      const second = (await F.components()).length;
      return {first, second};
    }""")
    if r["first"] != 0 or r["second"] == 0:
        bad.append(f"components retry: {r} (expected the first to fail empty, the second to load)")
    return bad


@extra("the rear elevation seats a swapped rear bay")
def check_rear_elevation(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    page.goto(f"{base}/index.html", wait_until="load")
    html = page.evaluate("""async () => {
      const {build2dElevation} = await import('/site/showcase/rack.js');
      const svg = await build2dElevation({
        stack: [{ref: 'as7726-32x', cfg: 'ac-f2b', u: 1, ru: 1, label: 'probe'}],
        heightRU: 2, view: 'rear',
        overrides: {'as7726-32x': {'psu-2': 'common/psu-dc-650@2'}}});
      return svg.outerHTML;
    }""")
    if 'data-ref="common/psu-dc-650@2' not in html:
        bad.append("rear elevation: psu-2 swap to common/psu-dc-650@2 not seated")
    # mx204 is NOT in CAST, so nothing has primed `loadMeta`'s index for it -
    # this is the case that actually discriminates old code (which reads
    # bays/cages off that index) from configuredFace (which loads the
    # device's own configs.json). as7726-32x above is in CAST, so stage 0's
    # own loadMeta() call already seats it either way, and passes on the old
    # code too.
    html2 = page.evaluate("""async () => {
      const {build2dElevation} = await import('/site/showcase/rack.js');
      const svg = await build2dElevation({
        stack: [{ref: 'mx204', cfg: 'ac', u: 1, ru: 1, label: 'probe'}],
        heightRU: 2, view: 'rear',
        overrides: {'mx204': {'psu-0': 'juniper/mx204-psu-dc@1'}}});
      return svg.outerHTML;
    }""")
    if 'data-ref="juniper/mx204-psu-dc@1' not in html2:
        bad.append("rear elevation: a device outside CAST (mx204) does not seat a rear bay swap")
    return bad


@extra("elevation.js draws both faces of a four-post rack: mounted, through, missing, holes, precedence")
def check_rack_elevation(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    page.goto(f"{base}/index.html", wait_until="load")
    r = page.evaluate("""async () => {
      const E = await import('/site/rack/elevation.js');
      const M = await import('/site/rack/model.js');
      const frame = M.normalizeFrame({kind: 'four-post', heightRU: 24,
                                      holes: {style: 'tapped', thread: '12-24'}});
      // i2 (front, U20) and i3 (rear, U20) share a U - a four-post pair - so
      // each pane's precedence (through drawn before mounted) is exercised.
      const items = [
        {id: 'i1', ref: 'r740xd', cfg: 'sff24-rc5-1b2a3a', label: 'R740xd', ru: 10, u: 2,
         face: 'front', turned: false, swaps: {}, fields: {}},
        {id: 'i2', ref: 'as7726-32x', cfg: 'ac-f2b', label: 'AS7726', ru: 20, u: 1,
         face: 'front', turned: false, swaps: {}, fields: {}},
        {id: 'i3', ref: 'eps201', cfg: 'ac-f2b', label: 'AS4630', ru: 20, u: 1,
         face: 'rear', turned: false, swaps: {}, fields: {}},
      ];
      const draw = view => E.drawElevation({items, frame, view, hitTargets: true,
                                           selectedId: 'i2', selectedU: view === 'front' ? 5 : null});
      const front = await draw('front'), rear = await draw('rear');
      const panel = (svg, id) => svg.querySelector(`[data-item-id="${id}"]`)?.dataset.panel;
      const docOrder = (svg, a, b) => {
        const A = svg.querySelector(`[data-item-id="${a}"]`), B = svg.querySelector(`[data-item-id="${b}"]`);
        return !!(A && B) && !!(A.compareDocumentPosition(B) & Node.DOCUMENT_POSITION_FOLLOWING);
      };
      return {
        pane: [front.dataset.pane, rear.dataset.pane],
        targets: [front.querySelectorAll('rect.rk-u').length, rear.querySelectorAll('rect.rk-u').length],
        front: [panel(front, 'i1'), panel(front, 'i2'), panel(front, 'i3')],
        rear: [panel(rear, 'i1'), panel(rear, 'i2'), panel(rear, 'i3')],
        rearOfServer: !!rear.querySelector('[data-item-id="i1"] [data-path^="idrac9"]'),
        round: front.querySelectorAll('circle[data-rail-hole]').length,
        square: front.querySelectorAll('rect[data-rail-hole]').length,
        selected: front.querySelector('[data-item-id="i2"]').classList.contains('rk-selected')
                  && front.querySelectorAll('.rk-sel-ring').length === 1,
        selectedU: front.querySelector('rect.rk-u[data-u="5"]').classList.contains('rk-u-selected'),
        // The mounted item at a shared U is drawn AFTER (on top of) the
        // through item there, in each pane.
        frontOrder: docOrder(front, 'i3', 'i2'),   // i3 (through) before i2 (mounted)
        rearOrder: docOrder(rear, 'i2', 'i3'),     // i2 (through) before i3 (mounted)
        panelFor: [E.panelFor({face: 'front'}, 'front'), E.panelFor({face: 'front'}, 'rear'),
                   E.panelFor({face: 'rear'}, 'rear'), E.panelFor({face: 'front', turned: true}, 'front')],
      };
    }""")
    want = {"pane": ["front", "rear"], "targets": [24, 24],
            "front": ["mounted", "mounted", "through"], "rear": ["through", "through", "mounted"],
            "rearOfServer": True, "round": 24 * 3 * 2, "square": 0,
            "selected": True, "selectedU": True, "frontOrder": True, "rearOrder": True,
            "panelFor": ["front", "rear", "front", "rear"]}
    for k, v in want.items():
        if r.get(k) != v:
            bad.append(f"elevation: {k} is {r.get(k)!r}, expected {v!r}")
    return bad


@extra("the rack library keeps documents in IndexedDB, and works without it")
def check_rack_library(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    page.goto(f"{base}/index.html", wait_until="load")
    r = page.evaluate("""async () => {
      const L = await import('/site/rack/library.js');
      const M = await import('/site/rack/model.js');
      const lib = await L.openLibrary();
      const a = M.newDoc({name: 'Alpha'}), b = M.newDoc({name: 'Beta'});
      await lib.put(a); await new Promise(r => setTimeout(r, 5)); await lib.put(b);
      const names = (await lib.list()).map(x => x.name);
      const got = await lib.get(a.id);
      const save = L.autosaver(lib, 50);
      save.saveSoon({...a, racks: [{...a.racks[0], name: 'Alpha 2'}]});
      save.saveSoon({...a, racks: [{...a.racks[0], name: 'Alpha 3'}]});
      await save.flush();
      const renamed = (await lib.get(a.id)).racks[0].name;
      await lib.remove(b.id);
      const after = (await lib.list()).map(x => x.name);
      const none = await L.openLibrary({idb: null});
      const off = [none.available, (await none.list()).length, await none.get('x')];
      await none.put(a);   // a no-op, never a throw
      let refused = '';
      try { await L.readDocFile(new File(['{"format":"x"}'], 'x.json')); } catch (e) { refused = e.message; }
      return {available: lib.available, names, same: JSON.stringify(got) === JSON.stringify(a),
              renamed, after, off, refused};
    }""")
    want = {"available": True, "names": ["Beta", "Alpha"], "same": True, "renamed": "Alpha 3",
            "after": ["Alpha 3"], "off": [False, 0, None], "refused": "This is not a Portrayal rack file."}
    for k, v in want.items():
        if r.get(k) != v:
            bad.append(f"library: {k} is {r.get(k)!r}, expected {v!r}")
    # list() reads a stored record through parseDoc, as get() does.
    listed = page.evaluate("""async () => {
      await new Promise((res, rej) => { const o = indexedDB.open('portrayal-racks', 1);
        o.onerror = rej; o.onsuccess = () => { const tx = o.result.transaction('docs', 'readwrite');
          tx.objectStore('docs').put({format: 'portrayal-rack', version: 1, id: 'doc-raw',
            racks: [{name: 42, frame: {}, items: []}], updatedAt: 1});
          tx.oncomplete = () => { o.result.close(); res(); }; tx.onerror = rej; }; });
      const L = await import('/site/rack/library.js');
      const lib = await L.openLibrary();
      const name = (await lib.list()).find(x => x.id === 'doc-raw')?.name;
      await lib.remove('doc-raw');
      return name;
    }""")
    if listed != "42":
        bad.append(f"library: list() names a stored rack {listed!r}, expected '42' (read through parseDoc)")
    return bad


@extra("draw.io port cells carry portrayal-path, including ports on a seated card")
def check_drawio_port_paths(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    page.goto(f"{base}/index.html", wait_until="load")
    r = page.evaluate("""async () => {
      const F = await import('/site/rack/face.js');
      const D = await import('/vendor/drawio.js');
      const f = await F.configuredFace({ref: 'asr-9006', cfg: 'base', view: 'front',
        swaps: {'slot-2': 'cisco/a9k-16x100ge-tr@1'}});
      const xml = D.deviceCells('dev', f.text, f.vb, f.ports, 0, 0, 200, 200).join('');
      const doc = new DOMParser().parseFromString(`<root>${xml}</root>`, 'application/xml');
      return {path: xml.includes('portrayal-path="slot-2/module/p0"'),
              parses: !doc.querySelector('parsererror'),
              bayContainer: xml.includes('portrayal-bay="slot-2"') && xml.includes('container=1;'),
              foldable: xml.includes('collapsible=1')};
    }""")
    if not r["path"]:
        bad.append('draw.io: no port cell with portrayal-path="slot-2/module/p0"')
    if not r["parses"]:
        bad.append("draw.io: deviceCells output is not well-formed XML")
    # A card is still a container of its ports, but with no fold toggle: the
    # "-" draw.io draws on a collapsible container read as a stray icon.
    if not r["bayContainer"]:
        bad.append("draw.io: the slot-2 card is no longer a container of its ports")
    if r["foldable"]:
        bad.append("draw.io: a bay container is collapsible (draws a fold toggle)")
    return bad


@extra("stage 6 draw.io carries the plan's seated card, front and rear")
def check_takeaway_drawio(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    open_showcase(page, base)
    # Stage 4 fills the plan's seats (the ASR-9006's slot-2 line card) into
    # the shared overrides; stage 6 must export them.
    page.click('.stage-rail button[data-stage="cable"]', timeout=READY_MS)
    page.wait_for_selector('[data-stage-ready="cable"]', timeout=READY_MS)
    page.click('.stage-rail button[data-stage="takeaway"]', timeout=READY_MS)
    page.wait_for_selector('[data-stage-ready="takeaway"]', timeout=READY_MS)
    with page.expect_download(timeout=READY_MS) as dl:
        page.click('#stageExport button:has-text("draw.io")')
    text = pathlib.Path(dl.value.path()).read_text()
    if 'portrayal-path="slot-2/module/p0"' not in text:
        bad.append("stage 6 draw.io: no port cell for the plan's slot-2 card")
    if 'value="rear"' not in text:
        bad.append("stage 6 draw.io: no rear cabinet")
    return bad


@extra("stage 6 shows the cables in 2D, and its SVG export keeps them without UI")
def check_takeaway_cables_2d(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    open_showcase(page, base)
    # Straight to stage 6: it must apply the plan's seats itself.
    page.click('.stage-rail button[data-stage="takeaway"]', timeout=READY_MS)
    page.wait_for_selector('[data-stage-ready="takeaway"]', timeout=READY_MS)
    n = page.eval_on_selector_all('#stageRack [data-cable]', "els => els.length")
    if n == 0:
        bad.append("stage 6 2D: no [data-cable] drawn")
    if not page.is_visible('#stageTabs button[data-view="rear"]'):
        bad.append("stage 6 2D: no Front/Rear toggle")
    with page.expect_download(timeout=READY_MS) as dl:
        page.click('#stageExport button:has-text("SVG")')
    text = pathlib.Path(dl.value.path()).read_text()
    got = text.count("data-cable=")
    if got != n:
        bad.append(f"stage 6 SVG: {got} cables exported, {n} drawn on screen")
    for ui_bit in ("data-cable-tags", "data-tag=", "data-not-connected", "cable-focus",
                   'tabindex="0"', "data-pt-ui"):
        if ui_bit in text:
            bad.append(f"stage 6 SVG: screen UI leaked into the export ({ui_bit})")
    return bad


@extra("Explorer downloads the device as configured, and its DCIM link names it")
def check_explorer_configured_download(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    page.goto(f"{base}/explorer.html?device=as7726-32x&config=ac-f2b&view=front"
              f"&swap=port-1~generic%2Fqsfp-lc%402", wait_until="load")
    page.wait_for_selector('#shell svg [data-ref^="generic/qsfp-lc@2"]', timeout=READY_MS)
    page.click("details.navmenu summary")
    with page.expect_download(timeout=READY_MS) as dl:
        page.click('a[data-export="svg"]')
    if dl.value.suggested_filename != "as7726-32x.ac-f2b.front.configured.svg":
        bad.append(f"explorer: download named {dl.value.suggested_filename!r}")
    if 'data-ref="generic/qsfp-lc@2' not in pathlib.Path(dl.value.path()).read_text():
        bad.append("explorer: configured SVG is missing the seated optic")
    # Setting `a.search` on an anchor resolves it against the page's own URL,
    # so the attribute comes back absolute (http://.../exporter.html?device=...)
    # rather than the relative form it started as - hence a substring match.
    href = page.get_attribute('a[href*="exporter.html"]', "href") or ""
    if "device=as7726-32x" not in href:
        bad.append(f"explorer: DCIM export link is {href!r}, expected ?device=as7726-32x")
    return bad


@extra("stage 6 hangs the cables in 3D, and the GLB carries them")
def check_takeaway_cables_3d(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    open_showcase(page, base)
    page.click('.stage-rail button[data-stage="takeaway"]', timeout=READY_MS)
    page.wait_for_selector('[data-stage-ready="takeaway"]', timeout=READY_MS)
    page.click('#stageMode [data-mode="3d"]')
    page.wait_for_selector('#stageExport button:has-text("GLB")', timeout=READY_3D_MS)
    with page.expect_download(timeout=READY_3D_MS) as dl:
        page.click('#stageExport button:has-text("GLB")')
    glb = pathlib.Path(dl.value.path()).read_bytes()
    missing = [i for i in range(14) if f'"cable-{i}"'.encode() not in glb]
    if missing:
        bad.append(f"stage 6 GLB: no node for cable(s) {missing}")
    return bad


@extra("draw.io: a bezel is its own tagged shape, over a face drawn without it")
def check_drawio_covers(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    page.goto(f"{base}/index.html", wait_until="load")
    r = page.evaluate("""async () => {
      const F = await import('/site/rack/face.js');
      const D = await import('/vendor/drawio.js');
      const svgOf = cell => {
        const b64 = cell.getAttribute('style').split('image=data:image/svg+xml,')[1].split(';')[0];
        return new TextDecoder().decode(Uint8Array.from(atob(b64), c => c.charCodeAt(0)));
      };
      const cellsOf = async (ref, cfg) => {
        const f = await F.configuredFace({ref, cfg, view: 'front'});
        const xml = D.deviceCells('dev', f.text, f.vb, f.ports, 0, 0, 400, 80).join('');
        return {xml, doc: new DOMParser().parseFromString(`<root>${xml}</root>`, 'application/xml')};
      };
      const {xml, doc} = await cellsOf('r740xd', 'sff24-rc5-1b2a3a');
      const face = doc.querySelector('mxCell[id="dev-face"]');
      const cover = doc.querySelector('object[portrayal-cover="bezel"]');
      const coverSvg = cover ? svgOf(cover.querySelector('mxCell')) : '';
      const plain = await cellsOf('as7726-32x', 'ac-f2b');
      // The rear has plates classed `bezel` inside parts that do not come off
      // (riser shrouds, trims): none of them is a cover.
      const rearF = await F.configuredFace({ref: 'r740xd', cfg: 'sff24-rc5-1b2a3a', view: 'rear'});
      const rearXml = D.deviceCells('dev', rearF.text, rearF.vb, rearF.ports, 0, 0, 400, 80).join('');
      return {
        parses: !doc.querySelector('parsererror'),
        faceHasBezel: svgOf(face).includes('data-class="bezel"'),
        faceHasDrive: svgOf(face).includes('id="drive-0"'),
        cover: !!cover,
        tags: cover?.getAttribute('tags') || '',
        parent: cover?.querySelector('mxCell')?.getAttribute('parent') || '',
        coverHasBezel: coverSvg.includes('id="bezel"'),
        coverHasDrive: coverSvg.includes('id="drive-0"'),
        coverBelowPorts: cover ? xml.indexOf('portrayal-cover=') < xml.indexOf('portrayal-path=') : false,
        plainCovers: plain.doc.querySelectorAll('object[portrayal-cover]').length,
        rearCovers: (rearXml.match(/portrayal-cover=/g) || []).length,
      };
    }""")
    expect = {"parses": True, "faceHasBezel": False, "faceHasDrive": True, "cover": True,
              "parent": "dev", "coverHasBezel": True, "coverHasDrive": False,
              "coverBelowPorts": True, "plainCovers": 0, "rearCovers": 0}
    for k, want in expect.items():
        if r.get(k) != want:
            bad.append(f"draw.io covers: {k} is {r.get(k)!r}, expected {want!r}")
    # ONE tag: draw.io hides a cell only when every tag on it is hidden.
    if r.get("tags") != "bezel":
        bad.append(f"draw.io covers: tags are {r.get('tags')!r}, expected 'bezel'")
    return bad


@extra("draw.io: a group may name its own faces, a device its own id, a rack its numbering - defaults unchanged")
def check_drawio_group_faces(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    page.goto(f"{base}/index.html", wait_until="load")
    r = page.evaluate("""async () => {
      const D = await import('/vendor/drawio.js');
      const F = await import('/site/rack/face.js');
      const f = await F.configuredFace({ref: 'tm-280', cfg: 'base', view: 'front'});
      const b = await F.configuredFace({ref: 'tm-280', cfg: 'base', view: 'rear'});
      const face = x => ({svg: x.text, vb: x.vb, ports: x.ports});
      const mk = (extra = {}, m = {}) => [{label: 'P', ...extra, racks: [{label: 'R', units: 4,
        mounted: [{name: 'TM', u: 2, ru: 1, faces: {front: face(f), rear: face(b)}, ...m}]}]}];
      const a = D.rackDiagram(mk(), {faces: ['front', 'rear']});
      return {
        same: a === D.rackDiagram(mk({faces: ['front', 'rear']}), {faces: ['front']}),
        rearOnly: (x => !x.includes('value="R · front"') && x.includes('value="R · rear"'))(
          D.rackDiagram(mk({faces: ['rear']}), {faces: ['front', 'rear']})),
        nameIds: a.includes('id="TM-g0r0-front"'),
        ownIds: (x => x.includes('id="i7-g0r0-front"') && !x.includes('id="TM-g0r0-front"'))(
          D.rackDiagram(mk({}, {id: 'i7'}))),
        ascend: a.includes('numDisp=ascend;'),
        descend: D.rackDiagram([{label: 'P', racks: [{label: 'R', units: 4, numDisp: 'descend', mounted: []}]}])
          .includes('numDisp=descend;'),
      };
    }""")
    for k in ("same", "rearOnly", "nameIds", "ownIds", "ascend", "descend"):
        if not r.get(k):
            bad.append(f"rackDiagram: {k} is {r.get(k)!r}")
    return bad


@extra("rack.html: Export - draw.io has a page per face, only what shows from each side, and a seated card's ports")
def check_rack_export_drawio(page, base):
    from collections import Counter
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    open_fixture(page, base)
    dl = export_file(page, "drawio")
    if dl.suggested_filename != "Export-test.drawio":
        bad.append(f"draw.io: named {dl.suggested_filename!r}")
    text = pathlib.Path(dl.path()).read_text(encoding="utf-8")
    try:
        root = ET.fromstring(text)
    except ET.ParseError as e:
        return bad + [f"draw.io: not well-formed XML ({e})"]
    pages = {d.get("name"): d for d in root.findall("diagram")}
    if set(pages) != {"Front", "Rear"}:
        return bad + [f"draw.io: pages {sorted(pages)}, expected Front and Rear"]
    values = {n: [e.get("value") for e in p.iter() if e.get("value") is not None] for n, p in pages.items()}
    for n, p in pages.items():
        dup = [i for i, c in Counter(e.get("id") for e in p.iter() if e.get("id")).items() if c > 1]
        if dup:
            bad.append(f"draw.io {n}: duplicate cell ids {dup[:5]}")
    if values["Front"].count("demarc") != 1:
        bad.append("draw.io Front: expected one demarc (U20's, from behind); U14's is behind leaf-1")
    if "leaf-1" in values["Rear"]:
        bad.append("draw.io Rear: leaf-1 is drawn, but demarc is mounted in front of it there")
    if values["Rear"].count("demarc") != 2 or "core-1" not in values["Rear"]:
        bad.append("draw.io Rear: expected both demarcs and core-1's rear")
    if 'portrayal-path="slot-2/module/p0"' not in ET.tostring(pages["Front"], encoding="unicode"):
        bad.append("draw.io Front: no port cell for core-1's seated card")
    if "numDisp=descend;" not in text:
        bad.append("draw.io: a bottom-up rack is not numbered from the bottom")
    if "is behind leaf-1" not in text:
        bad.append("draw.io: the notes comment does not list the device hidden behind leaf-1")
    if not text.startswith('<mxfile host="portrayal"><!--') or text.count("<!--") != 1:
        bad.append(f"draw.io: the notes are not one comment inside <mxfile>: {text[:80]!r}")

    # draw.io reads a label as HTML (html=1): a name with & and < must reach it
    # HTML-escaped, or the tag-like part is dropped from what it shows.
    got = page.evaluate("""async () => {
      const X = await import('/site/rack/exports.js');
      const r = window.__rack.doc().racks[0];
      const rack = {...r, name: 'R&D <core>', items: r.items.filter(i => i.id === 'i2').map(i => ({...i, label: 'a<b>&c'}))};
      const out = await X.drawioFile(rack, () => ({ru: 1}));
      const doc = new DOMParser().parseFromString(out.data, 'application/xml');
      const shown = v => { const d = document.createElement('div'); d.innerHTML = v; return d.textContent; };
      const values = [...doc.querySelectorAll('[value]')].map(e => e.getAttribute('value')).filter(Boolean);
      return {name: out.name, error: doc.querySelector('parsererror')?.textContent || '',
              values, shown: values.map(shown)};
    }""")
    if got["error"]:
        bad.append(f"draw.io labels: not well-formed XML ({got['error'][:120]})")
    if got["name"] != "R-D-core.drawio":
        bad.append(f"draw.io labels: named {got['name']!r}")
    for want in ("R&D <core> · front", "R&D <core> · rear", "a<b>&c", "▲ a<b>&c"):
        if want not in got["shown"]:
            bad.append(f"draw.io labels: draw.io would not show {want!r}; it shows {sorted(set(got['shown']))}")
    if "R&amp;D &lt;core&gt; · front" not in got["values"]:
        bad.append(f"draw.io labels: the cabinet's value is not HTML-escaped: {sorted(set(got['values']))}")
    return bad


@extra("rack.html: Export - 2D offers a switch to 3D; GLB and USDZ name every device and carry the notes")
def check_rack_export_3d(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    open_fixture(page, base)
    page.click('#rkMode [data-mode="2d"]')
    page.click("#exportMenu > summary")
    page.wait_for_selector('#exportItems [data-export="to-3d"]', timeout=READY_MS)
    if page.query_selector('#exportItems [data-export="glb"]'):
        bad.append("3D export: 2D offers GLB, which only a 3D scene can make")
    page.click('#exportItems [data-export="to-3d"]')
    page.wait_for_function("() => window.__rack.scene() != null", timeout=READY_3D_MS)
    dl = export_file(page, "glb", timeout=READY_3D_MS)
    glb = pathlib.Path(dl.path()).read_bytes()
    if dl.suggested_filename != "Export-test.glb" or glb[:4] != b"glTF":
        bad.append(f"GLB: {dl.suggested_filename!r} is not a GLB")
    missing = [i for i in ("i1", "i2", "i3", "i4") if f'"device-{i}"'.encode() not in glb]
    if missing:
        bad.append(f"GLB: no node for device(s) {missing}")
    if b"Optic labels and colors are not in the 3D model yet: leaf-1." not in glb:
        bad.append("GLB: the notes are not in the scene's extras")
    status = page.inner_text("#exportStatus")
    if status != "Downloaded, with 1 note in the file.":
        bad.append(f"GLB: the status reads {status!r}")
    dl = export_file(page, "usdz", timeout=READY_3D_MS)
    usdz = pathlib.Path(dl.path()).read_bytes()
    if dl.suggested_filename != "Export-test.usdz" or usdz[:2] != b"PK":
        bad.append(f"USDZ: {dl.suggested_filename!r} is not a USDZ")
    else:
        with zipfile.ZipFile(io.BytesIO(usdz)) as z:
            if not any(n.lower().endswith((".usdc", ".usda", ".usd")) for n in z.namelist()):
                bad.append(f"USDZ: no USD entry in the archive: {z.namelist()}")
    # A USDZ has nowhere to put the notes, so the status must not say they are in it.
    status = page.inner_text("#exportStatus")
    if status != "Downloaded. USDZ carries no notes; the GLB does.":
        bad.append(f"USDZ: the status reads {status!r}")
    # The exporters pause the render loop (their texture encoding crawls behind
    # a frame of the rack otherwise); the view must be drawing again after.
    if not page.evaluate("() => window.__rack.scene().running()"):
        bad.append("3D export: the render loop was left paused after an export")
    page.click('#rkMode [data-mode="2d"]')
    return bad


# THE TOOL PAGES FIT A PHONE. At 360px explorer.html scrolled sideways by 6px,
# annotate.html by 287px and components.html by 2645px. Not the tool bar: the
# shell's 23rem side panel (and the Annotator's second one) would not shrink
# below its nowrap tree rows, and a component card would not shrink below its
# monospace title or its true-scale drawing. The Explorer fit at 375px, which
# is why nobody saw it.
NARROW_PAGES = ["explorer.html", "components.html", "annotate.html", "drawio.html",
                "exporter.html", "drawings.html"]


@extra("the tool-bar pages fit a 360px viewport: no sideways scroll, the bar holds its links, menus open on screen")
def check_narrow_tool_pages(page, base):
    bad = []
    page.set_viewport_size({"width": 360, "height": 740})
    for name in NARROW_PAGES:
        page.goto(f"{base}/{name}", wait_until="load")
        page.wait_for_timeout(1500)
        r = page.evaluate(r"""() => {
          const w = document.documentElement.scrollWidth;
          // Name the widest culprits, so a failure says where to look.
          const wide = [...document.querySelectorAll('body *')]
            .filter(e => e.getBoundingClientRect().right > 360.5)
            .slice(0, 4)
            .map(e => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '')
                      + (e.className && typeof e.className === 'string'
                         ? '.' + e.className.trim().split(/\s+/).join('.') : '')
                      + ' right=' + Math.round(e.getBoundingClientRect().right));
          // The bar's links wrap onto a second row on a phone; a bar of fixed
          // height let that row hang over the page's heading.
          const bar = document.querySelector('.site-bar');
          const bottom = bar ? bar.getBoundingClientRect().bottom : 0;
          const spill = bar ? [...bar.querySelectorAll('a, summary')]
            .filter(e => !e.closest('.navmenu-items'))
            .filter(e => e.getBoundingClientRect().bottom > bottom + 0.5)
            .map(e => e.textContent.trim()) : [];
          return {w, wide, spill};
        }""")
        if r["w"] > 360:
            bad.append(f"{name}: scrollWidth {r['w']} at a 360px viewport; past the edge: "
                       + ", ".join(r["wide"]))
        if r["spill"]:
            bad.append(f"{name}: at 360px the tool bar's links hang below the bar, over the page: "
                       + ", ".join(r["spill"]))
        # Each menu in the bar opens on screen. Export starts a row of its own
        # on a phone, and a panel hung from its right edge opened off the left.
        for i in range(page.locator(".site-bar .navmenu > summary").count()):
            summary = page.locator(".site-bar .navmenu > summary").nth(i)
            label = summary.inner_text().strip()
            summary.click()
            box = page.evaluate("""i => {
              const m = document.querySelectorAll('.site-bar .navmenu')[i];
              const r = m.querySelector('.navmenu-items').getBoundingClientRect();
              m.open = false;
              return [Math.round(r.left), Math.round(r.right)];
            }""", i)
            if box[0] < 0 or box[1] > 360:
                bad.append(f"{name}: at 360px the {label} menu opens off screen, "
                           f"from x={box[0]} to x={box[1]}")
    return bad


@extra("rack.html: a 42U four-post rack on first open, frame edits redraw and survive a reload")
def check_rack_page(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    page.goto(f"{base}/rack.html?probe=1", wait_until="load")
    page.wait_for_function("() => window.__rack && window.__rack.ready", timeout=READY_MS)
    page.evaluate("() => window.__rack.ready")
    counts = lambda: page.evaluate("""() => ['front', 'rear'].map(f =>
      document.querySelectorAll(`svg[data-pane="${f}"] rect.rk-u`).length)""")
    if counts() != [42, 42]:
        bad.append(f"rack page: U targets {counts()}, expected [42, 42]")
    page.click("#frameBtn")
    page.fill("#fHeight", "24")
    page.dispatch_event("#fHeight", "change")
    # The side panel is redrawn after each change: wait for it, then the next control.
    page.wait_for_function("""() => document.querySelectorAll('svg[data-pane="front"] rect.rk-u').length === 24""",
                           timeout=READY_MS)
    page.select_option("#fHoles", "tapped")
    page.wait_for_function("""() => document.querySelector('svg[data-pane="front"] circle[data-rail-hole]')""",
                           timeout=READY_MS)
    page.evaluate("() => window.__rack.flush()")
    page.reload(wait_until="load")
    page.wait_for_function("() => window.__rack && window.__rack.ready", timeout=READY_MS)
    page.evaluate("() => window.__rack.ready")
    if counts() != [24, 24]:
        bad.append(f"rack page: after reload U targets {counts()}, expected [24, 24]")
    if not page.query_selector('svg[data-pane="rear"] circle[data-rail-hole]'):
        bad.append("rack page: tapped holes did not survive the reload")
    if page.get_attribute('.site-bar a[href="rack.html"]', "aria-current") != "page":
        bad.append("rack page: the nav does not mark Rack Builder as the current page")
    # The two panes' headings are single-line ("Front" / "Rear"); the frame
    # summary that used to wrap the front heading onto two lines - starting
    # its SVG lower than the rear one's - now lives in the top bar instead.
    front_top = page.eval_on_selector('svg[data-pane="front"]', "s => s.getBoundingClientRect().top")
    rear_top = page.eval_on_selector('svg[data-pane="rear"]', "s => s.getBoundingClientRect().top")
    if abs(front_top - rear_top) > 1:
        bad.append(f"rack page: the two panes' SVGs start at different top edges ({front_top} vs {rear_top})")
    return bad


def pick(page, face, u, query, ref, cfg=None, dispatch=False):
    sel = f'svg[data-pane="{face}"] rect.rk-u[data-u="{u}"]'
    # A `through` panel can visually cover a free U's own hit rectangle (round
    # 3 §2's half-depth case) without blocking a real click - onPaneClick
    # routes a click there itself - but a real, position-based Playwright
    # click still refuses to act on an element another one visually covers,
    # so callers that know the U is covered dispatch straight to the rect,
    # the same target the app's own click handler reads ev.target from (this
    # mirrors check_rack_inspect's identical workaround for a mounted panel).
    if dispatch:
        page.dispatch_event(sel, "click")
    else:
        page.click(sel)
    page.fill("#catQuery", query)
    page.select_option("#catDevice", ref)
    if cfg:
        page.select_option("#catCfg", cfg)
    page.click("#catPlace")


# THE EXPORT FIXTURE: a 24U four-post rack holding the cases every export
# has to get right - a seated card (core-1's slot-2), an optic with a label
# (leaf-1's port-1), a U shared front and rear (U14), and two devices with
# the same label (demarc).
EXPORT_FIXTURE = {
    "format": "portrayal-rack", "version": 1, "id": "doc-export-fixture",
    "racks": [{
        "id": "r1", "name": "Export test",
        "frame": {"kind": "four-post", "heightRU": 24, "numbering": "bottom-up",
                  "holes": {"style": "square", "thread": None},
                  "railDepth": 740, "usableDepth": 1000, "ref": None},
        "items": [
            {"id": "i1", "ref": "asr-9006", "cfg": "base", "label": "core-1", "ru": 2, "face": "front",
             "turned": False, "swaps": {"slot-2": "cisco/a9k-16x100ge-tr@1"}, "fields": {}},
            {"id": "i2", "ref": "as7726-32x", "cfg": "ac-f2b", "label": "leaf-1", "ru": 14, "face": "front",
             "turned": False, "swaps": {"port-1": "generic/qsfp-lc@2"},
             "fields": {"port-1-occupant": {"label": "LR4"}}},
            {"id": "i3", "ref": "tm-280", "cfg": "base", "label": "demarc", "ru": 14, "face": "rear",
             "turned": False, "swaps": {}, "fields": {}},
            {"id": "i4", "ref": "tm-280", "cfg": "base", "label": "demarc", "ru": 20, "face": "rear",
             "turned": False, "swaps": {}, "fields": {}},
        ],
        "zeroU": [], "cables": []}]}


def open_fixture(page, base, fixture=EXPORT_FIXTURE):
    page.goto(f"{base}/rack.html?probe=1", wait_until="load")
    page.wait_for_function("() => window.__rack && window.__rack.ready", timeout=READY_MS)
    page.evaluate("() => window.__rack.ready")
    rack = fixture["racks"][0]
    page.set_input_files("#openFile", files=[{"name": "fixture.rack.json", "mimeType": "application/json",
                                              "buffer": json.dumps(fixture).encode()}])
    page.wait_for_function("(n) => window.__rack.doc().racks[0].name === n", arg=rack["name"], timeout=READY_MS)
    page.wait_for_function(
        """(n) => document.querySelectorAll('svg[data-pane="front"] [data-item-id][data-panel]').length >= n""",
        arg=len(rack["items"]), timeout=READY_MS)


def export_file(page, kind, timeout=READY_MS):
    page.click("#exportMenu > summary")
    with page.expect_download(timeout=timeout) as dl:
        page.click(f'#exportItems [data-export="{kind}"]')
    return dl.value


@extra("rack.html: Export - NetBox and Nautobot device types zip every device and part, with NOTES.txt")
def check_rack_export_dcim_types(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    open_fixture(page, base)
    want = {"device-types/Cisco/ASR-9006-AC-V2.yaml", "device-types/Edgecore/7726-32X-O-AC-F.yaml",
            "device-types/Telco Systems/TM-280.yaml", "module-types/Cisco/A9K-16X100GE-TR.yaml",
            "module-types/Cisco/A9K-3KW-AC.yaml", "module-types/Cisco/ASR-9006-FAN.yaml",
            "module-types/Cisco/A9K Slot Cover.yaml", "NOTES.txt"}
    for target, T in (("netbox", "NetBox"), ("nautobot", "Nautobot")):
        dl = export_file(page, f"{target}-types")
        if dl.suggested_filename != f"Export-test-{target}-types.zip":
            bad.append(f"{T} types: named {dl.suggested_filename!r}")
        with zipfile.ZipFile(dl.path()) as z:
            listing = z.namelist()
            names = set(listing)
            notes = z.read("NOTES.txt").decode() if "NOTES.txt" in names else ""
            head = z.read("device-types/Edgecore/7726-32X-O-AC-F.yaml").decode() \
                if "device-types/Edgecore/7726-32X-O-AC-F.yaml" in names else ""
        if names != want:
            bad.append(f"{T} types: entries differ - missing {sorted(want - names)}, extra {sorted(names - want)}")
        if len(listing) != len(want):
            bad.append(f"{T} types: {len(listing)} entries, expected {len(want)} (a duplicate?)")
        devices = sorted(n for n in names if n.startswith("device-types/"))
        if len(devices) != 3:
            bad.append(f"{T} types: {len(devices)} device types, expected 3 (two TM-280s share one): {devices}")
        if "ASR-9006-AC-V2 is a best guess" not in notes:
            bad.append(f"{T} types: NOTES.txt does not flag the ASR-9006's guessed type")
        if "generic/qsfp-lc@2" not in notes or f"no {T} module type" not in notes:
            bad.append(f"{T} types: NOTES.txt does not list the optic with no module type")
        if "model: 7726-32X-O-AC-F" not in head:
            bad.append(f"{T} types: the Edgecore YAML is not the exported file")
    return bad


def read_csv(dl):
    # read_bytes: read_text would turn the file's CRLF into LF and the Notes split would never match
    text = pathlib.Path(dl.path()).read_bytes().decode("utf-8")
    data = text.partition("\r\n\r\nNotes\r\n")[0]
    reader = csv.DictReader(io.StringIO(data, newline=""))
    return reader.fieldnames, list(reader), text


@extra("rack.html: Export - device import CSVs name each device's type, position and face as NetBox and Nautobot read them")
def check_rack_export_device_csv(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    open_fixture(page, base)
    dl = export_file(page, "netbox-devices")
    if dl.suggested_filename != "Export-test-netbox-devices.csv":
        bad.append(f"NetBox CSV: named {dl.suggested_filename!r}")
    cols, rows, _ = read_csv(dl)
    if cols != ["name", "role", "manufacturer", "device_type", "status", "site", "rack", "position", "face", "comments"]:
        bad.append(f"NetBox CSV: columns {cols}")
    by = {r["name"]: r for r in rows}
    want = {"core-1": ("Cisco", "ASR-9006-AC-V2", "2", "front"), "leaf-1": ("Edgecore", "7726-32X-O-AC-F", "14", "front"),
            "demarc-i3": ("Telco Systems", "TM-280", "14", "rear"), "demarc-i4": ("Telco Systems", "TM-280", "20", "rear")}
    for name, (man, dt, pos, face) in want.items():
        r = by.get(name)
        if not r or (r["manufacturer"], r["device_type"], r["position"], r["face"]) != (man, dt, pos, face):
            bad.append(f"NetBox CSV: {name} is {r and (r['manufacturer'], r['device_type'], r['position'], r['face'])}")
    if not all(r["status"] == "planned" and r["rack"] == "Export test" for r in rows):
        bad.append("NetBox CSV: status or rack column wrong")
    if "best guess" not in by.get("core-1", {}).get("comments", ""):
        bad.append("NetBox CSV: core-1's guessed type is not said in comments")

    dl = export_file(page, "nautobot-devices")
    cols, rows, _ = read_csv(dl)
    if dl.suggested_filename != "Export-test-nautobot-devices.csv" or "device_type__model" not in (cols or []):
        bad.append(f"Nautobot CSV: {dl.suggested_filename!r} with columns {cols}")
    leaf = next((r for r in rows if r["name"] == "leaf-1"), {})
    if (leaf.get("device_type__model"), leaf.get("status__name")) != ("7726-32X-O-AC-F", "Planned"):
        bad.append(f"Nautobot CSV: leaf-1 is {leaf}")

    # A DCIM CSV is imported as is: a label that opens like a formula stays verbatim (only the BOM guards it).
    eq = page.evaluate("""async () => {
      const X = await import('/site/rack/exports.js');
      const r = window.__rack.doc().racks[0];
      const rack = {...r, items: r.items.filter(i => i.id === 'i2').map(i => ({...i, label: '=leaf'}))};
      return (await X.deviceImportCsv(rack, () => ({manufacturer: 'Edgecore'}), 'netbox')).data;
    }""")
    if not eq.split("\r\n")[1].startswith("=leaf,"):
        bad.append(f"NetBox CSV: a label starting with '=' is not verbatim: {eq[:200]!r}")

    # Positions follow the frame's numbering.
    page.click("#frameBtn")
    page.select_option("#fNumbering", "top-down")
    page.wait_for_function("() => window.__rack.doc().racks[0].frame.numbering === 'top-down'", timeout=READY_MS)
    _, rows, _ = read_csv(export_file(page, "netbox-devices"))
    got = {r["name"]: r["position"] for r in rows}
    if got != {"core-1": "14", "leaf-1": "11", "demarc-i3": "11", "demarc-i4": "5"}:
        bad.append(f"NetBox CSV: top-down positions {got}")
    return bad


@extra("rack.html: Export - a device type from another vendor's file is said so in the notes, the CSV and the zip's NOTES")
def check_rack_export_other_vendor(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    open_fixture(page, base)
    # A chassisOf stub whose manufacturer has no files, so the match falls
    # back to the Cisco folder: a file from another vendor.
    got = page.evaluate("""async () => {
      const X = await import('/site/rack/exports.js');
      const r = window.__rack.doc().racks[0];
      const rack = {...r, items: r.items.filter(i => i.id === 'i1')};
      const stub = () => ({manufacturer: 'Nobody Inc'});
      const ctx = await X.dcimContext(rack, stub, 'netbox', {modules: false});
      const csv = await X.deviceImportCsv(rack, stub, 'netbox');
      const zip = await X.dcimTypesZip(rack, stub, 'netbox');
      const buf = zip.data instanceof Blob ? await zip.data.arrayBuffer() : zip.data;
      return {note: ctx.notes.find(n => n.includes('core-1')) || '', flag: ctx.types.get('i1')?.otherVendor,
              csv: csv.data, zipBytes: Array.from(new Uint8Array(buf.buffer ?? buf))};
    }""")
    if got["flag"] is not True:
        bad.append(f"other vendor: otherVendor is {got['flag']!r}, expected true")
    if "another vendor's" not in got["note"]:
        bad.append(f"other vendor: dcimContext note is {got['note']!r}")
    rows = list(csv.DictReader(io.StringIO(got["csv"], newline="")))
    comments = rows[0]["comments"] if rows else ""
    if "another vendor's (Cisco) file" not in comments:
        bad.append(f"other vendor: the CSV comment is {comments!r}")
    with zipfile.ZipFile(io.BytesIO(bytes(got["zipBytes"]))) as z:
        zipNotes = z.read("NOTES.txt").decode() if "NOTES.txt" in z.namelist() else ""
    if "another vendor's (Cisco) file" not in zipNotes:
        bad.append(f"other vendor: the zip's NOTES.txt is {zipNotes!r}")
    return bad


@extra("rack.html: Export - a slot emptied by a null swap yields no part, where its default would have seated one")
def check_rack_export_emptied_slot(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    open_fixture(page, base)
    got = page.evaluate("""async () => {
      const X = await import('/site/rack/exports.js');
      const r = window.__rack.doc().racks[0];
      const it = r.items.find(i => i.id === 'i1');
      const stub = () => ({manufacturer: 'Cisco'});
      const paths = async swaps => (await X.dcimContext({...r, items: [{...it, swaps}]}, stub, 'netbox'))
        .parts.map(p => p.path);
      return {full: await paths({}), emptied: await paths({'slot-5': null})};
    }""")
    if "slot-5/module" not in got["full"]:
        bad.append(f"emptied slot: the default does not seat slot-5 ({got['full']}); the check proves nothing")
    if "slot-5/module" in got["emptied"]:
        bad.append("emptied slot: slot-5 is still a part after a null swap")
    if "slot-4/module" not in got["emptied"]:
        bad.append(f"emptied slot: slot-4's default went missing too: {got['emptied']}")
    return bad


@extra("rack.html: Export - the BOM counts devices, modules, optics and 4 x U of mounting hardware")
def check_rack_export_bom(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    open_fixture(page, base)

    def qty(rows, section, key):
        return next((int(r["qty"]) for r in rows if r["section"] == section and key in (r["model"], r["ref"])), None)

    dl = export_file(page, "bom")
    if dl.suggested_filename != "Export-test-bom.csv":
        bad.append(f"BOM: named {dl.suggested_filename!r}")
    cols, rows, text = read_csv(dl)
    if cols != ["section", "qty", "manufacturer", "model", "description", "ref"]:
        bad.append(f"BOM: columns {cols}")
    for section, key, n in (("Devices", "ASR 9006", 1), ("Devices", "AS7726-32X", 1), ("Devices", "TM-280", 2),
                            ("Line cards", "A9K-16X100GE-TR", 1), ("Blanks", "A9K Slot Cover", 5),
                            ("Power supplies", "A9K-3KW-AC", 3), ("Fans", "ASR-9006-FAN", 2),
                            ("Optics", "generic/qsfp-lc@2", 1),
                            ("Mounting hardware", "Cage nut, M6", 52), ("Mounting hardware", "Screw, M6", 52)):
        got = qty(rows, section, key)
        if got != n:
            bad.append(f"BOM: {section} / {key} is {got}, expected {n}")
    if "\r\nNotes\r\n" not in text or "M6" not in text.partition("\r\nNotes\r\n")[2]:
        bad.append(f"BOM: no notes section naming the M6 assumption: {text[-300:]!r}")

    # A cell that opens as a formula is apostrophe-guarded (a model from the
    # ref, a note from the label), through the same builder the menu uses.
    guarded = page.evaluate("""async () => {
      const X = await import('/site/rack/exports.js');
      const r = window.__rack.doc().racks[0];
      const item = {...r.items[0], id: 'x1', ref: '=evil', label: '=lbl', swaps: {}};
      return (await X.bomCsv({...r, items: [item]}, () => null)).data;
    }""")
    if "'=evil" not in guarded or "'=lbl" not in guarded or re.search(r"(^|\n)=", guarded):
        bad.append(f"BOM: a formula-like cell is not apostrophe-guarded: {guarded[:300]!r}")

    # A seated ref that is not in the component index keeps its row (model = the ref) and is noted.
    unknown = page.evaluate("""async () => {
      const X = await import('/site/rack/exports.js'), F = await import('/site/rack/face.js');
      const r = window.__rack.doc().racks[0];
      const rack = {...r, items: r.items.filter(i => i.id === 'i1')};
      const chassisOf = () => ({manufacturer: 'Cisco'});
      const before = (await X.bomCsv(rack, chassisOf)).data;
      const ref = before.split('\\n').find(l => l.startsWith('Power supplies,'))?.split(',').pop().trim();
      const list = await F.components();
      const at = list.findIndex(c => `${c.ns}/${c.name}@${c.major.slice(1)}` === ref);
      if (at < 0) return {ref, error: 'ref not found in the index'};
      const [gone] = list.splice(at, 1);
      try { return {ref, data: (await X.bomCsv(rack, chassisOf)).data}; }
      finally { list.splice(at, 0, gone); }
    }""")
    if unknown.get("error"):
        bad.append(f"BOM: unindexed-ref probe could not set up: {unknown}")
    else:
        urows = list(csv.DictReader(io.StringIO(unknown["data"].partition("\r\n\r\nNotes\r\n")[0], newline="")))
        krow = next((r for r in urows if r["ref"] == unknown["ref"]), None)
        if not krow or krow["model"] != unknown["ref"]:
            bad.append(f"BOM: an unindexed seated ref is {krow!r}, expected a row whose model is the ref")
        if "not in the component index" not in unknown["data"]:
            bad.append("BOM: no 'not in the component index' note for an unindexed ref")

    # Tapped rails: screws of the chosen thread, no cage nuts.
    page.click("#frameBtn")
    page.select_option("#fHoles", "tapped")
    page.wait_for_selector("#fThread", timeout=READY_MS)
    page.select_option("#fThread", "12-24")
    page.wait_for_function("() => window.__rack.doc().racks[0].frame.holes.thread === '12-24'", timeout=READY_MS)
    _, rows, _ = read_csv(export_file(page, "bom"))
    if qty(rows, "Mounting hardware", "Screw, 12-24") != 52 or qty(rows, "Mounting hardware", "Cage nut, M6"):
        bad.append(f"BOM tapped: hardware rows {[(r['model'], r['qty']) for r in rows if r['section'] == 'Mounting hardware']}")
    return bad


def notes_status(n):
    return f"Downloaded, with {n} note{'' if n == 1 else 's'} in the file." if n else "Downloaded."


def export_status(page):
    page.wait_for_function("""() => { const t = document.getElementById('exportStatus').textContent;
      return !!t && t !== 'Preparing…'; }""", timeout=READY_3D_MS)
    return page.inner_text("#exportStatus")


@extra("rack.html: a desktop device is flagged in the picker and the exports, placeable, with no ears and no rail hardware")
def check_rack_mount_flag(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    page.goto(f"{base}/rack.html?probe=1", wait_until="load")
    page.wait_for_function("() => window.__rack && window.__rack.ready", timeout=READY_MS)
    page.evaluate("() => window.__rack.ready")
    pick(page, "front", 10, "TM-280", "tm-280")
    page.wait_for_selector('svg[data-pane="front"] [data-device-ref="tm-280"]', timeout=READY_MS)
    page.click('svg[data-pane="front"] rect.rk-u[data-u="12"]')
    page.fill("#catQuery", "hlx")
    row = page.inner_text('#catDevice option[value="hlx-tgv"]')
    if "desktop" not in row:
        bad.append(f"picker row for hlx-tgv: {row!r}")
    page.select_option("#catDevice", "hlx-tgv")
    fit = page.inner_text("#catFit")
    if fit != "Fits here, on a shelf: this is a desktop device.":
        bad.append(f"picker fit line: {fit!r}")
    if page.is_disabled("#catPlace"):
        bad.append("picker: Place is disabled for a desktop device")
    page.click("#catPlace")
    try:
        page.wait_for_selector('svg[data-pane="front"] [data-device-ref="hlx-tgv"]', timeout=READY_MS)
    except Exception:
        bad.append("a desktop device was not placed")
        return bad
    ears = page.evaluate("""() => [...document.querySelectorAll('svg[data-pane="front"] g.rk-ears')]
      .map(g => document.querySelector(`svg[data-pane="front"] [data-item-id="${g.dataset.earsFor}"][data-device-ref]`)?.dataset.deviceRef)""")
    if "tm-280" not in ears or "hlx-tgv" in ears:
        bad.append(f"ears are drawn for {ears}, expected tm-280 only")
    page.evaluate("() => window.__rack.flush()")

    note = "at U12: a desktop device, so it needs a shelf."
    dl = export_file(page, "sheet-svg")
    svg = pathlib.Path(dl.path()).read_bytes().decode("utf-8")
    if "a desktop device, so it needs a shelf" not in svg:
        bad.append("sheet: no mount note")
    if svg.count("data-ears-for") != 1:
        bad.append(f"sheet: {svg.count('data-ears-for')} ear groups, expected 1")
    _, rows, text = read_csv(export_file(page, "bom"))
    if note not in text.partition("\r\nNotes\r\n")[2]:
        bad.append(f"BOM: no mount note: {text[-300:]!r}")
    cage = next((int(r["qty"]) for r in rows if r["model"] == "Cage nut, M6"), None)
    if cage != 4:
        bad.append(f"BOM: cage nuts {cage}, expected 4 (the rack-mount 1U device only)")
    dev = next((r for r in rows if r["ref"] == "hlx-tgv"), None)
    if not dev:
        bad.append("BOM: the desktop device is not listed")
    _, crows, _ = read_csv(export_file(page, "netbox-devices"))
    if not any("needs a shelf" in r["comments"] for r in crows):
        bad.append(f"device CSV: no mount comment {[r['comments'] for r in crows]}")
    return bad


@extra("rack.html: a desktop and a DIN-rail device get no 3D ears and are named in the GLB, draw.io, types zip and BOM notes")
def check_rack_mount_flag_3d_exports(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    page.goto(f"{base}/rack.html?probe=1", wait_until="load")
    page.wait_for_function("() => window.__rack && window.__rack.ready", timeout=READY_MS)
    page.evaluate("() => window.__rack.ready")
    for u, q, ref in ((10, "TM-280", "tm-280"), (12, "hlx", "hlx-tgv"), (14, "ais2003", "ais2003")):
        pick(page, "front", u, q, ref)
        page.wait_for_selector(f'svg[data-pane="front"] [data-device-ref="{ref}"]', timeout=READY_MS)
    page.evaluate("() => window.__rack.flush()")
    din = "at U14: a DIN-rail device, so it needs a shelf or DIN-rail bracket."
    desk = "at U12: a desktop device, so it needs a shelf."

    # The BOM of a rack holding only these says nothing of cage nuts it does not count.
    only = page.evaluate("""async () => {
      const X = await import('/site/rack/exports.js'), C = await import('/site/rack/chassis.js');
      const of = C.chassisLookup(await C.loadChassis());
      const r = window.__rack.doc().racks[0];
      return (await X.bomCsv({...r, items: r.items.filter(i => i.ref !== 'tm-280')}, of)).data;
    }""")
    if "Cage nuts and screws" in only or "Mounting hardware" in only:
        bad.append(f"BOM of non-rack devices only: hardware or its note present: {only[-300:]!r}")
    if din not in only or desk not in only:
        bad.append("BOM of non-rack devices only: a mount note is missing")

    dl = export_file(page, "drawio")
    xml = pathlib.Path(dl.path()).read_bytes().decode("utf-8")
    if din not in xml or desk not in xml:
        bad.append("draw.io: the mount notes are not in the file")
    for target, T in (("netbox", "NetBox"),):
        with zipfile.ZipFile(export_file(page, f"{target}-types").path()) as z:
            notes = z.read("NOTES.txt").decode()
        if din not in notes or desk not in notes:
            bad.append(f"{T} types: NOTES.txt lacks the mount notes: {notes[:400]!r}")
    _, crows, _ = read_csv(export_file(page, "netbox-devices"))
    comments = " ".join(r["comments"] for r in crows)
    if "A DIN-rail device, so it needs a shelf or DIN-rail bracket." not in comments:
        bad.append(f"device CSV: no DIN-rail comment: {comments[:300]!r}")

    page.click("#exportMenu > summary")
    page.click('#exportItems [data-export="to-3d"]')
    page.wait_for_function("() => window.__rack.scene() != null", timeout=READY_3D_MS)
    ears = page.evaluate("""async () => {
      const s = window.__rack.scene(); await s.complete();
      const ids = Object.fromEntries(window.__rack.doc().racks[0].items.map(i => [i.ref, i.id]));
      return Object.fromEntries(Object.entries(ids).map(([ref, id]) =>
        [ref, !!s.three.scene.getObjectByName(`ears-${id}`)]));
    }""")
    if ears != {"tm-280": True, "hlx-tgv": False, "ais2003": False}:
        bad.append(f"3D ears by device: {ears}, expected only tm-280")
    dl = export_file(page, "glb", timeout=READY_3D_MS)
    glb = pathlib.Path(dl.path()).read_bytes()
    if din.encode() not in glb or desk.encode() not in glb:
        bad.append("GLB: the mount notes are not in the scene's extras")
    return bad


@extra("rack.html: Export - a model whose 3D view changed under the exporter is not saved or called downloaded")
def check_rack_export_overtaken(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    downloads = []
    page.on("download", lambda d: downloads.append(d.suggested_filename))
    open_fixture(page, base)
    page.click('#rkMode [data-mode="3d"]')
    page.wait_for_function("() => window.__rack.scene() != null", timeout=READY_3D_MS)
    # save() clicks a download link; counting those is the page's own account
    # of what it offered, with no wait for a download that must not come.
    page.evaluate("""() => { window.__saves = [];
      const click = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {
        if (this.download) window.__saves.push(this.download);
        return click.call(this); }; }""")
    overtaken = "The 3D view changed before the model was ready. Try the export again."

    # 1. A switch to 2D in the same task as the click: the export has its
    #    scene in hand and has not yet awaited anything, so the scene is
    #    disposed under it every time.
    page.click("#exportMenu > summary")
    page.wait_for_selector('#exportItems [data-export="glb"]', timeout=READY_MS)
    page.evaluate("""() => { document.querySelector('#exportItems [data-export="glb"]').click();
      document.querySelector('#rkMode [data-mode="2d"]').click(); }""")
    status = export_status(page)
    if status != overtaken:
        bad.append(f"overtaken by 2D: the status reads {status!r}")
    if page.get_attribute("#exportStatus", "title") != status:
        bad.append("overtaken by 2D: the status's title is not its full text, so the cut-off sentence cannot be read")
    saves = page.evaluate("() => window.__saves")
    if saves:
        bad.append(f"overtaken by 2D: a file was offered anyway: {saves}")

    # 2. An edit committed in the same task as the click: the scene on screen
    #    is no longer this rack's, and is rebuilt (disposed) 300 ms later.
    page.click('#rkMode [data-mode="3d"]')
    page.wait_for_function("() => window.__rack.scene() != null", timeout=READY_3D_MS)
    page.click("#frameBtn")
    page.wait_for_selector("#fNumbering", timeout=READY_MS)
    page.click("#exportMenu > summary")
    page.wait_for_selector('#exportItems [data-export="glb"]', timeout=READY_MS)
    page.evaluate("""() => { window.__saves.length = 0;
      document.querySelector('#exportItems [data-export="glb"]').click();
      const sel = document.getElementById('fNumbering');
      sel.value = 'top-down';
      sel.dispatchEvent(new Event('change', {bubbles: true})); }""")
    if page.evaluate("() => window.__rack.doc().racks[0].frame.numbering") != "top-down":
        return bad + ["overtaken by an edit: the edit did not commit; the check proves nothing"]
    status = export_status(page)
    if status != overtaken:
        bad.append(f"overtaken by an edit: the status reads {status!r}")
    saves = page.evaluate("() => window.__saves")
    if saves:
        bad.append(f"overtaken by an edit: a file was offered anyway: {saves}")
    # The same export, left alone, still downloads.
    page.wait_for_function("() => window.__rack.scene() != null", timeout=READY_3D_MS)
    dl = export_file(page, "glb", timeout=READY_3D_MS)
    if dl.suggested_filename != "Export-test.glb" or not export_status(page).startswith("Downloaded"):
        bad.append(f"overtaken: an undisturbed export after it gave {dl.suggested_filename!r}, "
                   f"{page.inner_text('#exportStatus')!r}")
    if downloads != ["Export-test.glb"]:
        bad.append(f"overtaken: downloads were {downloads}, expected only the undisturbed one")
    page.click('#rkMode [data-mode="2d"]')
    return bad


@extra("rack.html: Export - a swap that failed is in the BOM's and the zip's notes; the status counts only what the file carries")
def check_rack_export_notes_truthful(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    fixture = json.loads(json.dumps(EXPORT_FIXTURE))
    fixture["id"] = "doc-export-unseated"
    fixture["racks"][0]["name"] = "Export unseated"
    # A ref the index does not know: the cage keeps what the configuration seats.
    fixture["racks"][0]["items"][1]["swaps"] = {"port-1": "generic/no-such-optic@1"}
    fixture["racks"][0]["items"][1]["fields"] = {}
    open_fixture(page, base, fixture)
    failed = ("leaf-1 at U14: the part chosen for port-1 couldn't be loaded, "
              "so the part the configuration seats there is listed instead.")

    # files.json down: the BOM still comes, and says why manufacturers are blank.
    page.route("**/assets/exports/files.json", lambda r: r.abort())
    _, _, text = read_csv(export_file(page, "bom"))
    page.unroute("**/assets/exports/files.json")
    notes = text.partition("\r\nNotes\r\n")[2]
    if "Manufacturer names could not be loaded, so some are blank." not in notes:
        bad.append(f"BOM without files.json: no note says so: {notes!r}")
    if failed not in notes:
        bad.append(f"BOM: a swap that could not be loaded is not in the notes: {notes!r}")
    if "generic/no-such-optic@1" in text.partition("\r\nNotes\r\n")[0]:
        bad.append("BOM: the part that could not be loaded is listed as if seated; the check's premise is wrong")
    _, _, text = read_csv(export_file(page, "bom"))
    if "Manufacturer names could not be loaded" in text:
        bad.append("BOM: the files.json note is still there once files.json loads")
    status = page.inner_text("#exportStatus")
    n = len([l for l in text.partition("\r\nNotes\r\n")[2].split("\r\n") if l])
    if status != notes_status(n):
        bad.append(f"BOM: {n} notes in the file, but the status reads {status!r}")
    if page.get_attribute("#exportStatus", "title") != status:
        bad.append("status: its title is not its full text")

    for target in ("netbox", "nautobot"):
        with zipfile.ZipFile(export_file(page, f"{target}-types").path()) as z:
            zip_notes = z.read("NOTES.txt").decode()
        if failed not in zip_notes:
            bad.append(f"{target} types: a swap that could not be loaded is not in NOTES.txt: {zip_notes!r}")

    # The device CSV carries its rows' comments and nothing else.
    _, rows, _ = read_csv(export_file(page, "netbox-devices"))
    status = page.inner_text("#exportStatus")
    carried = len([r for r in rows if r["comments"]])
    if not carried or status != notes_status(carried):
        bad.append(f"device CSV: {carried} rows have comments, but the status reads {status!r}")
    got = page.evaluate("""async () => {
      const X = await import('/site/rack/exports.js'), E = await import('/site/rack/export-data.js');
      const r = window.__rack.doc().racks[0];
      const lookup = () => ({manufacturer: 'Edgecore', ru: 1});
      const wired = {...r, items: r.items.filter(i => i.id === 'i2'), cables: [{}], zeroU: [{}, {}]};
      const csv = await X.deviceImportCsv(wired, lookup, 'netbox');
      // A model's notes, with a scene that exports nothing: only the notes are under test.
      const scene = {running: () => false, complete: async () => {}, three: {scene: {userData: {}}},
                     toGLB: async () => new Uint8Array(4), toUSDZ: async () => new Uint8Array(4)};
      const ghost = {...r, items: [...r.items, {id: 'i9', ref: 'no-such-device', cfg: 'base', label: 'mystery',
        ru: 22, face: 'front', turned: false, swaps: {}, fields: {}}]};
      const glb = await X.modelFile(scene, ghost, 'glb');
      const extras = [...scene.three.scene.userData.portrayal.notes];
      const usdz = await X.modelFile(scene, ghost, 'usdz');
      return {csvStatus: E.exportStatus(csv), csvData: csv.data, glbNotes: glb.notes, extras,
              glbStatus: E.exportStatus(glb), usdzStatus: E.exportStatus(usdz), usdzNotes: usdz.notes};
    }""")
    want = ("Downloaded, with 1 note in the file. Not in the file: 2 zero-U items are not in this export yet. "
            "1 cable is not in this export yet.")
    if got["csvStatus"] != want:
        bad.append(f"device CSV with cables: the status reads {got['csvStatus']!r}")
    if "not in this export yet" in got["csvData"]:
        bad.append("device CSV with cables: a rack-level note is in the file after all; the status is wrong")
    for note in ("mystery at U22: no front drawing, so the front shows an outline.",
                 "mystery at U22: no rear drawing, so the rear shows an outline."):
        if note not in got["glbNotes"] or note not in got["extras"]:
            bad.append(f"GLB: a device with no drawing is not in the notes ({note!r}): {got['glbNotes']}")
    if got["glbStatus"] != notes_status(len(got["glbNotes"])):
        bad.append(f"GLB: the status reads {got['glbStatus']!r} for {len(got['glbNotes'])} notes")
    if got["usdzStatus"] != "Downloaded. USDZ carries no notes; the GLB does." or got["usdzNotes"]:
        bad.append(f"USDZ: the status reads {got['usdzStatus']!r}, notes {got['usdzNotes']}")
    return bad


EMPTY_FIXTURE = {
    "format": "portrayal-rack", "version": 1, "id": "doc-export-empty",
    "racks": [{
        "id": "r1", "name": "Empty rack",
        "frame": {"kind": "two-post", "heightRU": 12, "numbering": "bottom-up",
                  "holes": {"style": "tapped", "thread": "12-24"},
                  "railDepth": None, "usableDepth": 1000, "ref": None},
        "items": [], "zeroU": [], "cables": []}]}


@extra("rack.html: Export - an empty two-post rack exports every 2D file well formed, and says it has no devices")
def check_rack_export_empty(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    open_fixture(page, base, EMPTY_FIXTURE)
    page.wait_for_selector('svg[data-pane="rear"] rect[data-rail]', timeout=READY_MS)

    def ok_status(kind):
        status = page.inner_text("#exportStatus")
        if not status.startswith("Downloaded"):
            bad.append(f"empty rack {kind}: the status reads {status!r}")

    for kind, name, panes in (("sheet-svg", "Empty-rack-sheet.svg", 2), ("front-svg", "Empty-rack-front.svg", 1),
                              ("rear-svg", "Empty-rack-rear.svg", 1)):
        dl = export_file(page, kind)
        ok_status(kind)
        text = pathlib.Path(dl.path()).read_text(encoding="utf-8")
        try:
            ET.fromstring(text.encode("utf-8"))
        except ET.ParseError as e:
            bad.append(f"empty rack {kind}: not well-formed XML ({e})")
        if dl.suggested_filename != name or text.count("data-pane=") != panes or "Two-post frame, 12U" not in text:
            bad.append(f"empty rack {kind}: {dl.suggested_filename!r} with {text.count('data-pane=')} panes")
        if "data-item-id" in text:
            bad.append(f"empty rack {kind}: a device is drawn")

    dl = export_file(page, "sheet-png")
    ok_status("sheet-png")
    if pathlib.Path(dl.path()).read_bytes()[:8] != b"\x89PNG\r\n\x1a\n":
        bad.append("empty rack sheet-png: not a PNG")

    dl = export_file(page, "drawio")
    ok_status("drawio")
    try:
        root = ET.fromstring(pathlib.Path(dl.path()).read_text(encoding="utf-8"))
        if [d.get("name") for d in root.findall("diagram")] != ["Front", "Rear"]:
            bad.append("empty rack drawio: not a Front and a Rear page")
    except ET.ParseError as e:
        bad.append(f"empty rack drawio: not well-formed XML ({e})")

    for target, T in (("netbox", "NetBox"), ("nautobot", "Nautobot")):
        dl = export_file(page, f"{target}-types")
        ok_status(f"{target}-types")
        with zipfile.ZipFile(dl.path()) as z:
            names = z.namelist()
            notes = z.read("NOTES.txt").decode() if "NOTES.txt" in names else ""
        if names != ["NOTES.txt"]:
            bad.append(f"empty rack {T} types: entries {names}")
        if f"This rack has no devices, so there are no {T} types in this zip." not in notes or "Every device" in notes:
            bad.append(f"empty rack {T} types: NOTES.txt reads {notes!r}")
        dl = export_file(page, f"{target}-devices")
        cols, rows, text = read_csv(dl)
        if rows or not cols or cols[0] != "name" or text.count("\r\n") != 1:
            bad.append(f"empty rack {T} devices: not a header alone: {text!r}")
        if page.inner_text("#exportStatus") != "Downloaded.":
            bad.append(f"empty rack {T} devices: the status reads {page.inner_text('#exportStatus')!r}")

    cols, rows, text = read_csv(export_file(page, "bom"))
    ok_status("bom")
    if cols != ["section", "qty", "manufacturer", "model", "description", "ref"] or rows:
        bad.append(f"empty rack BOM: columns {cols}, rows {rows}")
    notes = text.partition("\r\nNotes\r\n")[2]
    if "This rack has no devices" not in notes:
        bad.append(f"empty rack BOM: the notes do not say the rack is empty: {text!r}")
    if "Screw" in text or "Cage nut" in text:
        bad.append(f"empty rack BOM: hardware for no devices: {text!r}")

    dl = export_file(page, "json")
    if dl.suggested_filename != "Empty-rack.rack.json":
        bad.append(f"empty rack file: named {dl.suggested_filename!r}")
    return bad


@extra("rack.html: Export - the sheet is the same ink in light and dark, a missing face's outline included")
def check_rack_export_sheet_theme(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    fixture = json.loads(json.dumps(EXPORT_FIXTURE))
    fixture["id"] = "doc-export-theme"
    fixture["racks"][0]["name"] = "Export theme"
    fixture["racks"][0]["items"] = [
        {"id": "i5", "ref": "no-such-device", "cfg": "base", "label": "mystery", "ru": 22, "face": "front",
         "turned": False, "swaps": {}, "fields": {}}]
    seen = {}
    for scheme in ("light", "dark"):
        page.emulate_media(color_scheme=scheme)
        open_fixture(page, base, fixture)
        text = pathlib.Path(export_file(page, "front-svg").path()).read_text(encoding="utf-8")
        root = ET.fromstring(text.encode("utf-8"))
        ns = "{http://www.w3.org/2000/svg}"
        g = next((e for e in root.iter(f"{ns}g") if e.get("data-panel") == "missing"), None)
        if g is None:
            return bad + [f"sheet theme ({scheme}): no missing-face outline in the sheet"]
        rect, label = g.find(f"{ns}rect"), g.find(f"{ns}text")
        seen[scheme] = (rect.get("fill"), rect.get("stroke"), label.get("fill"))
        if "var(--" in text:
            bad.append(f"sheet theme ({scheme}): a theme token is left in the file")
    if seen["light"] != seen["dark"]:
        bad.append(f"sheet: a missing face's outline follows the theme: light {seen['light']}, dark {seen['dark']}")
    # On screen the outline stays the theme's.
    fill = page.evaluate("""() => document.querySelector(
      'svg[data-pane="front"] [data-panel="missing"] rect').getAttribute('fill')""")
    if fill != "var(--pt-surface-2)":
        bad.append(f"the pane's own missing-face outline lost its theme color ({fill})")
    return bad


@extra("the Explorer lens: Escape reads back like Done; a lens showing another device hands back nothing")
def check_rack_lens_edges(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    page.goto(f"{base}/index.html", wait_until="load")
    page.evaluate("""() => { window.__lens = import('/site/rack/explorer-lens.js').then(L =>
      L.openLens({ref: 'as7726-32x', cfg: 'ac-f2b', title: 'AS7726', swaps: {'port-1': 'generic/qsfp-lc@2'}})); }""")
    page.wait_for_function("() => !!document.querySelector('.rk-lens iframe')?.contentWindow?.portrayalEmbed",
                           timeout=READY_MS)
    page.evaluate("async () => { await document.querySelector('.rk-lens iframe').contentWindow.portrayalEmbed.ready; }")
    page.focus(".rk-lens-done")
    page.keyboard.press("Escape")
    r = page.evaluate("async () => await window.__lens")
    if not r or r.get("swaps", {}).get("port-1") != "generic/qsfp-lc@2":
        bad.append(f"lens: Escape read back {r!r}")
    if page.query_selector(".rk-lens"):
        bad.append("lens: the overlay is still open after Escape")
    page.evaluate("""() => { window.__lens2 = import('/site/rack/explorer-lens.js').then(L =>
      L.openLens({ref: 'no-such-device', cfg: 'base', title: 'Nothing'})); }""")
    page.click(".rk-lens-done", timeout=READY_MS)
    got2 = page.evaluate("async () => await window.__lens2")
    if got2 is not None:
        bad.append(f"lens: a lens that never showed its device handed back {got2!r}")
    # A reload whose new document never becomes ready: the lens was shown once,
    # but that is not this document, so Done hands back nothing.
    page.evaluate("""() => { window.__lens3 = import('/site/rack/explorer-lens.js').then(L =>
      L.openLens({ref: 'as7726-32x', cfg: 'ac-f2b', title: 'AS7726'})); }""")
    page.wait_for_function("() => !!document.querySelector('.rk-lens iframe')?.contentWindow?.portrayalEmbed",
                           timeout=READY_MS)
    page.evaluate("async () => { await document.querySelector('.rk-lens iframe').contentWindow.portrayalEmbed.ready; }")
    # The lens resets itself in its own `load` listener. This listener is added
    # after the lens's, so it runs after it: once it has fired for the NEW
    # document (the one carrying the marker), the lens has seen the reload.
    # The old document also has a portrayalEmbed and is also `complete`, so
    # nothing short of the marker and the event tells the two apart.
    page.evaluate("""() => { const f = document.querySelector('.rk-lens iframe');
      window.__lens3Loads = 0;
      f.addEventListener('load', () => { if (f.contentWindow.portrayalEmbed?.lens3) window.__lens3Loads++; });
      f.srcdoc =
      '<script>window.portrayalEmbed = {lens3: true, ready: new Promise(() => {}), ' +
      'current: () => ({device: "as7726-32x", config: "ac-f2b", swaps: {}, fields: {}})}<' + '/script>'; }""")
    page.wait_for_function("() => window.__lens3Loads > 0", timeout=READY_MS)
    page.click(".rk-lens-done", timeout=READY_MS)
    got3 = page.evaluate("async () => await window.__lens3")
    if got3 is not None:
        bad.append(f"lens: a reload that never became ready handed back {got3!r}")
    return bad


@extra("rack.html: the library menu renames and marks the current rack; the summary lists depth warnings")
def check_rack_menu_and_warnings(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    page.goto(f"{base}/rack.html?probe=1", wait_until="load")
    page.wait_for_function("() => window.__rack && window.__rack.ready", timeout=READY_MS)
    page.evaluate("() => window.__rack.ready")
    page.once("dialog", lambda d: d.accept("Renamed rack"))
    page.click("#libMenu > summary")
    page.click("#libItems button:has-text('Rename')")
    page.wait_for_function("() => window.__rack.doc().racks[0].name === 'Renamed rack'", timeout=READY_MS)
    if (page.text_content("#rackName") or "") != "Renamed rack":
        bad.append("menu: the rack name in the bar did not follow a rename")
    page.click("#libMenu > summary")
    # The list is redrawn when the menu opens; wait for that draw, not the previous one.
    try:
        page.wait_for_function("() => document.querySelector('#libItems .rk-current')?.textContent === 'Renamed rack'",
                               timeout=READY_MS)
    except Exception:
        cur = page.evaluate("() => document.querySelector('#libItems .rk-current')?.textContent ?? null")
        bad.append(f"menu: the current rack is marked {cur!r}")
    page.click("#libMenu > summary")
    pick(page, "front", 10, "R740", "r740xd")
    page.wait_for_selector('svg[data-pane="front"] [data-device-ref="r740xd"][data-panel="mounted"]', timeout=READY_MS)
    page.click("#frameBtn")
    page.fill("#fUsable", "500")
    page.dispatch_event("#fUsable", "change")
    page.wait_for_function("() => window.__rack.doc().racks[0].frame.usableDepth === 500", timeout=READY_MS)
    page.click("#frameBtn")                       # back to the summary
    page.wait_for_selector(".rk-side .rk-error", timeout=READY_MS)
    if "this rack allows 500 mm" not in (page.text_content(".rk-side") or ""):
        bad.append(f"summary: no depth warning for the R740xd ({page.text_content('.rk-side')!r})")
    return bad


@extra("rack.html: the frame form keeps keyboard focus across a change")
def check_rack_frame_focus(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    page.goto(f"{base}/rack.html?probe=1", wait_until="load")
    page.wait_for_function("() => window.__rack && window.__rack.ready", timeout=READY_MS)
    page.evaluate("() => window.__rack.ready")
    page.click("#frameBtn")
    page.evaluate("() => { document.querySelector('#fNumbering').dataset.old = '1'; }")
    page.focus("#fNumbering")
    page.select_option("#fNumbering", "top-down")
    page.wait_for_function("() => { const s = document.querySelector('#fNumbering'); return s && !s.dataset.old; }",
                           timeout=READY_MS)
    if page.evaluate("() => document.activeElement && document.activeElement.id") != "fNumbering":
        bad.append("frame form: focus left the control that was just changed")
    return bad


@extra("rack.html: place from the picker; both faces show it; a device that won't fit says why")
def check_rack_place(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    page.goto(f"{base}/rack.html?probe=1", wait_until="load")
    page.wait_for_function("() => window.__rack && window.__rack.ready", timeout=READY_MS)
    page.evaluate("() => window.__rack.ready")
    # A fresh, empty rack, whatever an earlier check left in this browser.
    page.click("#libMenu > summary"); page.click("#libItems button:has-text('New rack')")
    page.wait_for_function("() => window.__rack.doc().racks[0].items.length === 0")

    pick(page, "front", 10, "R740", "r740xd")
    page.wait_for_selector('svg[data-pane="front"] [data-device-ref="r740xd"][data-panel="mounted"]', timeout=READY_MS)
    page.wait_for_selector('svg[data-pane="rear"] [data-device-ref="r740xd"][data-panel="through"]', timeout=READY_MS)
    pick(page, "front", 20, "AS7726", "as7726-32x")
    page.wait_for_selector('svg[data-pane="rear"] [data-device-ref="as7726-32x"][data-panel="through"]', timeout=READY_MS)
    # Behind the switch: the patch panel is too deep, the TM-280 fits - the
    # FHD-1UFCE needs "Only what fits here" off to even show up. AS7726's
    # through panel now covers this U's own hit rectangle, so this dispatches
    # straight to it rather than a real, position-based click.
    page.dispatch_event('svg[data-pane="rear"] rect.rk-u[data-u="20"]', "click")
    page.uncheck("#catFitsOnly")
    page.fill("#catQuery", "FHD")
    opt_text = page.text_content('#catDevice option[value="fhd-1ufce"]') or ""
    if not opt_text.endswith("— doesn't fit"):
        bad.append(f"place: the FHD-1UFCE's option text is {opt_text!r}, expected it to end with \"doesn't fit\"")
    page.select_option("#catDevice", "fhd-1ufce")
    why = page.text_content("#catFit") or ""
    if "mm free behind" not in why:
        bad.append(f"place: the FHD-1UFCE's reason is {why!r}, expected a depth reason")
    before = page.evaluate("() => window.__rack.doc().racks[0].items.length")
    page.click("#catPlace")
    after = page.evaluate("() => window.__rack.doc().racks[0].items.length")
    if after != before:
        bad.append(f"place: pressing Place on a device that doesn't fit added an item ({before} -> {after})")
    pick(page, "rear", 20, "TM-280", "tm-280", dispatch=True)
    page.wait_for_selector('svg[data-pane="rear"] [data-device-ref="tm-280"][data-panel="mounted"]', timeout=READY_MS)
    doc = page.evaluate("() => window.__rack.doc()")
    got = [(i["ref"], i["ru"], i["face"], i["cfg"]) for i in doc["racks"][0]["items"]]
    want = [("r740xd", 10, "front", "sff24-rc5-1b2a3a"), ("as7726-32x", 20, "front", "ac-f2b"),
            ("tm-280", 20, "rear", doc["racks"][0]["items"][2]["cfg"])]
    if got != want:
        bad.append(f"place: items {got}, expected {want}")
    return bad


@extra("rack.html: inspect, move with arrows, face refusal, Explorer round trip, remove")
def check_rack_inspect(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    page.on("dialog", lambda d: d.accept())
    page.goto(f"{base}/rack.html?probe=1", wait_until="load")
    page.wait_for_function("() => window.__rack && window.__rack.ready", timeout=READY_MS)
    page.evaluate("() => window.__rack.ready")
    page.click("#libMenu > summary"); page.click("#libItems button:has-text('New rack')")
    page.wait_for_function("() => window.__rack.doc().racks[0].items.length === 0")
    pick(page, "front", 20, "AS7726", "as7726-32x")
    item = lambda: page.evaluate("() => window.__rack.doc().racks[0].items[0]")
    page.wait_for_selector("#iLabel", timeout=READY_MS)
    # Move with the arrow keys.
    page.keyboard.press("ArrowUp"); page.keyboard.press("ArrowUp")
    page.wait_for_function("() => window.__rack.doc().racks[0].items[0].ru === 22")
    # Another device at U22 on the rear; switching the switch's face to rear is
    # refused. AS7726's own through panel now covers this U's hit rectangle
    # on the rear pane, so this dispatches straight to it.
    pick(page, "rear", 22, "TM-280", "tm-280", dispatch=True)
    page.click('svg[data-pane="front"] [data-device-ref="as7726-32x"]')
    page.select_option("#iFace", "rear")
    err = page.text_content(".rk-side .rk-error") or ""
    if "Taken by" not in err or item()["face"] != "front":
        bad.append(f"inspect: a face change onto an occupied U was not refused ({err!r}, {item()['face']})")
    # Label edit.
    page.fill("#iLabel", "tor-1"); page.dispatch_event("#iLabel", "change")
    page.wait_for_function("() => window.__rack.doc().racks[0].items[0].label === 'tor-1'")
    # Move by clicking a U while in move mode: a free U changes ru and face.
    page.click("#iMove")
    page.wait_for_selector(".rk-side h3:has-text('Move tor-1')", timeout=READY_MS)
    page.click('svg[data-pane="rear"] rect.rk-u[data-u="5"]')
    page.wait_for_function(
        "() => window.__rack.doc().racks[0].items[0].ru === 5 && window.__rack.doc().racks[0].items[0].face === 'rear'",
        timeout=READY_MS)
    # Moving by click onto an occupied U is refused; the reason must survive
    # the redraw (it is written through S.notice, not into the panel the
    # redraw is about to replace), and the item stays where it was.
    page.click("#iMove")
    page.wait_for_selector(".rk-side h3:has-text('Move tor-1')", timeout=READY_MS)
    # The occupying device's own panel is drawn over its U's hit rectangle
    # (elevation.js: "a click on a device is the device's"), so a real click
    # there would hit the device, not the U - dispatch straight to the rect,
    # the same target the app's own click handler reads ev.target from.
    page.dispatch_event('svg[data-pane="rear"] rect.rk-u[data-u="22"]', "click")
    # The reason is written through S.notice, as .rk-notice.rk-error, and
    # only reaches the DOM once the redraw it triggers (select() -> render())
    # finishes - unlike the synchronous onPatch refusals above (which land in
    # the inspector's own, always-present .rk-error), this one needs a wait
    # on the distinct .rk-notice element, not an immediate read of the first
    # .rk-error in the panel.
    page.wait_for_selector(".rk-side .rk-notice", timeout=READY_MS)
    err = page.text_content(".rk-side .rk-notice") or ""
    if "Taken by" not in err or item()["ru"] != 5 or item()["face"] != "rear":
        bad.append(f"inspect: a move-by-click onto an occupied U was not refused ({err!r}, {item()['ru']}, {item()['face']!r})")
    # Move it back to the front for the rest of this check.
    page.click("#iMove")
    page.click('svg[data-pane="front"] rect.rk-u[data-u="10"]')
    page.wait_for_function(
        "() => window.__rack.doc().racks[0].items[0].ru === 10 && window.__rack.doc().racks[0].items[0].face === 'front'",
        timeout=READY_MS)
    # Explorer round trip: seat an optic in the lens through its own URL state.
    page.click("#iExplore")
    page.wait_for_selector(".rk-lens iframe", timeout=READY_MS)
    # A synchronous predicate: a Promise returned from wait_for_function is truthy at once.
    page.wait_for_function("() => !!document.querySelector('.rk-lens iframe')?.contentWindow?.portrayalEmbed",
                           timeout=READY_MS)
    page.evaluate("async () => { await document.querySelector('.rk-lens iframe').contentWindow.portrayalEmbed.ready; }")
    page.evaluate("""() => {
      const w = document.querySelector('.rk-lens iframe').contentWindow;
      // swap= is written raw (it carries its own escaping), so it is appended, not set.
      const rest = w.location.search.replace(/&?swap=[^&]*/, '');
      w.location.replace(`${w.location.pathname}${rest}&swap=port-1~generic%2Fqsfp-lc%402`);
    }""")
    # Synchronous polling: the reloaded frame's API exists and reports the swap.
    page.wait_for_function("""() => {
      const w = document.querySelector('.rk-lens iframe')?.contentWindow;
      try { return !!w?.portrayalEmbed && !!w.portrayalEmbed.current().swaps['port-1']; } catch { return false; } }""",
                           timeout=READY_MS)
    page.click(".rk-lens-done")
    page.wait_for_function("() => (window.__rack.doc().racks[0].items[0].swaps || {})['port-1'] === 'generic/qsfp-lc@2'",
                           timeout=READY_MS)
    page.wait_for_selector('svg[data-pane="front"] [data-device-ref="as7726-32x"] [data-ref^="generic/qsfp-lc@2"]',
                           timeout=READY_MS)
    # A configuration change clears swaps and fields (a delta against the old
    # configuration), and the page says so once, beside the panel it redraws.
    page.select_option("#iCfg", "ac-b2f")
    page.wait_for_function("() => window.__rack.doc().racks[0].items[0].cfg === 'ac-b2f'", timeout=READY_MS)
    page.wait_for_selector(".rk-side .rk-notice", timeout=READY_MS)
    note = page.text_content(".rk-side .rk-notice") or ""
    if "cleared" not in note:
        bad.append(f"inspect: a configuration change did not show the cleared-changes note ({note!r})")
    if item()["swaps"] or item()["fields"]:
        bad.append(f"inspect: a configuration change left swaps/fields behind ({item()['swaps']!r}, {item()['fields']!r})")
    # A configuration changed inside Explorer changes the item's own cfg too.
    page.click("#iExplore")
    page.wait_for_selector(".rk-lens iframe", timeout=READY_MS)
    page.wait_for_function("() => !!document.querySelector('.rk-lens iframe')?.contentWindow?.portrayalEmbed",
                           timeout=READY_MS)
    page.evaluate("async () => { await document.querySelector('.rk-lens iframe').contentWindow.portrayalEmbed.ready; }")
    page.evaluate("""() => {
      const w = document.querySelector('.rk-lens iframe').contentWindow;
      const u = new URL(w.location.href);
      u.searchParams.set('config', 'dc-f2b');
      w.location.replace(u.toString());
    }""")
    # Synchronous polling: the reloaded frame's API exists and reports the config.
    page.wait_for_function("""() => {
      const w = document.querySelector('.rk-lens iframe')?.contentWindow;
      try { return !!w?.portrayalEmbed && w.portrayalEmbed.current().config === 'dc-f2b'; } catch { return false; } }""",
                           timeout=READY_MS)
    page.click(".rk-lens-done")
    page.wait_for_function("() => window.__rack.doc().racks[0].items[0].cfg === 'dc-f2b'", timeout=READY_MS)
    # Remove.
    page.click('svg[data-pane="front"] [data-device-ref="as7726-32x"]')
    page.click("#iRemove")
    page.wait_for_function("() => !window.__rack.doc().racks[0].items.some(i => i.ref === 'as7726-32x')")
    return bad


@extra("rack.html: the device picker narrows by vendor, respects fit, and remembers state across U clicks")
def check_rack_picker(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    page.goto(f"{base}/rack.html?probe=1", wait_until="load")
    page.wait_for_function("() => window.__rack && window.__rack.ready", timeout=READY_MS)
    page.evaluate("() => window.__rack.ready")
    page.click("#libMenu > summary"); page.click("#libItems button:has-text('New rack')")
    page.wait_for_function("() => window.__rack.doc().racks[0].items.length === 0")

    device_refs = lambda: page.eval_on_selector_all("#catDevice option", "os => os.map(o => o.value)")
    fits_false = lambda: page.eval_on_selector_all(
        "#catDevice option", "os => os.filter(o => o.dataset.fits === 'false').length")

    # Near the top of the rack only 3U is free, so any 4U-and-up device does
    # not fit here - unticking "Only what fits here" has to reveal some.
    page.click('svg[data-pane="front"] rect.rk-u[data-u="40"]')
    page.wait_for_selector("#catDevice", timeout=READY_MS)
    if fits_false() != 0:
        bad.append("picker: an option has data-fits=false while 'Only what fits here' is ticked")
    page.uncheck("#catFitsOnly")
    if fits_false() == 0:
        bad.append("picker: unticking 'Only what fits here' revealed nothing that doesn't fit")
    page.check("#catFitsOnly")

    # Lower in the rack, where everything fits: the vendor dropdown narrows
    # the list, and its counts match what the query alone already narrowed to.
    page.click('svg[data-pane="front"] rect.rk-u[data-u="10"]')
    page.wait_for_selector("#catDevice", timeout=READY_MS)

    # "All vendors"'s own count matches the (unfiltered) device list, and the
    # list box fills the side panel's width rather than shrinking to its
    # longest option's intrinsic width.
    all_count = len(device_refs())
    all_text = page.eval_on_selector('#catVendor option[value="all"]', "o => o && o.textContent") or ""
    m_all = re.search(r"\((\d+)\)", all_text)
    if not m_all or int(m_all.group(1)) != all_count:
        bad.append(f"picker: 'All vendors' says {all_text!r} but the device list has {all_count} devices")
    device_width = page.eval_on_selector("#catDevice", "s => s.getBoundingClientRect().width")
    panel_width = page.eval_on_selector(".rk-picker", "el => el.getBoundingClientRect().width")
    if device_width < panel_width * 0.9:
        bad.append(f"picker: #catDevice is {device_width}px wide, less than 90% of the {panel_width}px panel")

    page.fill("#catQuery", "AS77")
    vendor_text = page.eval_on_selector('#catVendor option[value="Edgecore"]', "o => o && o.textContent")
    if not vendor_text:
        bad.append("picker: no Edgecore option in #catVendor for the 'AS77' search")
    else:
        page.select_option("#catVendor", "Edgecore")
        refs = device_refs()
        m = re.search(r"\((\d+)\)", vendor_text)
        if not m or int(m.group(1)) != len(refs):
            bad.append(f"picker: Edgecore's count says {vendor_text!r} but the list has {len(refs)} devices")
        if "as7726-32x" not in refs:
            bad.append("picker: as7726-32x is missing from the filtered Edgecore list")

    # A device with several configurations preselects its default; choosing
    # another one and placing stores that configuration.
    page.select_option("#catDevice", "as7726-32x")
    cfg_value = page.eval_on_selector("#catCfg", "s => s.value")
    if cfg_value != "ac-f2b":
        bad.append(f"picker: as7726-32x's preselected configuration is {cfg_value!r}, expected its default 'ac-f2b'")
    page.select_option("#catCfg", "dc-b2f")
    page.click("#catPlace")
    doc = page.evaluate("() => window.__rack.doc()")
    item = doc["racks"][0]["items"][0]
    if item["ref"] != "as7726-32x" or item["cfg"] != "dc-b2f":
        bad.append(f"picker: placed {item['ref']!r} with cfg {item['cfg']!r}, expected as7726-32x/dc-b2f")

    # Clicking another empty U keeps the chosen vendor and query.
    page.click('svg[data-pane="front"] rect.rk-u[data-u="30"]')
    page.wait_for_selector("#catDevice", timeout=READY_MS)
    if page.eval_on_selector("#catQuery", "i => i.value") != "AS77":
        bad.append("picker: the search query did not survive clicking another U")
    if page.eval_on_selector("#catVendor", "s => s.value") != "Edgecore":
        bad.append("picker: the vendor filter did not survive clicking another U")
    return bad


@extra("rack.html: zoom defaults to Fit, reads relative to it, ctrl+wheel is anchored at the pointer without drift, and it survives a reload")
def check_rack_zoom(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    page.goto(f"{base}/rack.html?probe=1", wait_until="load")
    page.wait_for_function("() => window.__rack && window.__rack.ready", timeout=READY_MS)
    page.evaluate("() => window.__rack.ready")

    level = lambda: page.text_content("#zoomLevel") or ""
    front_box = lambda: page.eval_on_selector('svg[data-pane="front"]', "s => s.getBoundingClientRect()")
    panes_box = lambda: page.eval_on_selector('#panes', "p => p.getBoundingClientRect()")

    if level() != "Fit":
        bad.append(f"zoom: on load the readout is {level()!r}, expected 'Fit'")
    fh, ph = front_box()["height"], panes_box()["height"]
    if fh > ph + 1:
        bad.append(f"zoom: the front SVG's height {fh} exceeds the panes' client height {ph} at Fit")
    fit_width = front_box()["width"]

    # The readout is relative to Fit (a controller ruling), not to the raw
    # column-width factor: two 1.25x steps up from Fit is 1.5625x Fit, which
    # reads as ~156% regardless of what Fit's own factor happens to be in
    # this window.
    page.click("#zoomIn"); page.click("#zoomIn")
    m = re.search(r"(\d+)%", level())
    if not m or abs(int(m.group(1)) - 156) > 1:
        bad.append(f"zoom: two zoom-ins from Fit read {level()!r}, expected about 156%")
    if front_box()["width"] <= fit_width:
        bad.append("zoom: #zoomIn twice did not make the SVG wider than its Fit width")
    before_pct = int(m.group(1)) if m else 0
    page.click("#zoomIn")
    m2 = re.search(r"(\d+)%", level())
    if not m2 or int(m2.group(1)) <= before_pct:
        bad.append(f"zoom: zooming in again did not increase the displayed percentage ({level()!r})")
    zoomed_width = front_box()["width"]

    # Anchoring works by adjusting scrollLeft/scrollTop, which the browser
    # clamps to [0, scrollWidth - clientWidth]: below the zoom level where a
    # pane actually needs a scrollbar, that range is just {0} and no
    # scrollLeft assignment can compensate, so growing from a fixed left edge
    # unavoidably drifts. That's a limit of panning via native overflow, not
    # the bug being fixed here - so this reaches a level that genuinely
    # overflows before testing the anchor invariant.
    for _ in range(10):
        if page.eval_on_selector("#panes", "p => p.scrollWidth > p.clientWidth + 1"):
            break
        page.click("#zoomIn")
    else:
        bad.append("zoom: could not reach a horizontally-overflowing zoom level to test wheel anchoring")

    # ctrl+wheel is anchored at the pointer: a fixed point in the viewport
    # has to land on the same fraction of the SVG's own box before and after
    # - not drift, which a coarser anchor built from column width alone
    # would do, since it leaves out the panes' padding, the gap between the
    # two panes, and the heading above the SVG. The point is clamped to the
    # panes' own visible box (not just a fraction of the SVG's full,
    # possibly-taller-than-the-viewport box), so Playwright's mouse actually
    # lands inside the window rather than off-screen.
    r, pb = front_box(), panes_box()
    fx = r["x"] + min(r["width"], pb["width"]) * 0.3
    fy = r["y"] + min(r["height"], pb["height"]) * 0.5
    fraction = lambda: (lambda b: ((fx - b["x"]) / b["width"], (fy - b["y"]) / b["height"]))(front_box())
    before_fraction = fraction()
    page.mouse.move(fx, fy)
    page.keyboard.down("Control")
    page.mouse.wheel(0, -300)
    page.keyboard.up("Control")
    after_fraction = fraction()
    if (abs(before_fraction[0] - after_fraction[0]) > 0.01
            or abs(before_fraction[1] - after_fraction[1]) > 0.01):
        bad.append(f"zoom: ctrl+wheel drifted the pointer's anchor in the SVG - "
                   f"fraction {before_fraction} -> {after_fraction}, expected <=1% drift")
    if front_box()["width"] <= zoomed_width:
        bad.append("zoom: ctrl+wheel over the panes did not increase the width further")

    page.evaluate("() => window.__rack.flush()")
    page.reload(wait_until="load")
    page.wait_for_function("() => window.__rack && window.__rack.ready", timeout=READY_MS)
    page.evaluate("() => window.__rack.ready")
    if "%" not in level():
        bad.append(f"zoom: after a reload the readout is {level()!r}, expected the zoom to survive")

    page.click("#zoomFit")
    if level() != "Fit":
        bad.append(f"zoom: #zoomFit did not return the readout to 'Fit' ({level()!r})")
    return bad


@extra("rack.html: deleting a rack does not let a pending autosave resurrect it")
def check_rack_delete(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    page.on("dialog", lambda d: d.accept())
    page.goto(f"{base}/rack.html?probe=1", wait_until="load")
    page.wait_for_function("() => window.__rack && window.__rack.ready", timeout=READY_MS)
    page.evaluate("() => window.__rack.ready")
    boot_id = page.evaluate("() => window.__rack.doc().id")
    page.click("#libMenu summary")
    page.click("#libItems >> text=New rack")
    # "New rack" is fired-and-forgotten from its click handler; window.__rack.ready
    # is only boot()'s promise, already settled, so it cannot be waited on again -
    # wait on the one thing that does change: the active document's id.
    page.wait_for_function("(id) => window.__rack.doc().id !== id", arg=boot_id, timeout=READY_MS)
    deleted_id = page.evaluate("() => window.__rack.doc().id")
    # A commit queues a 500ms autosave. Deleting right after it - the case
    # that used to resurrect the rack - means that timer is still pending
    # when remove() runs.
    page.click("#frameBtn")
    page.fill("#fHeight", "24")
    page.dispatch_event("#fHeight", "change")
    page.wait_for_function("""() => document.querySelectorAll('svg[data-pane="front"] rect.rk-u').length === 24""",
                           timeout=READY_MS)
    page.click("#libMenu summary")
    page.click("#libItems >> text=Delete…")
    page.wait_for_function("(id) => window.__rack.doc().id !== id", arg=deleted_id, timeout=READY_MS)
    # Give a stale 500ms timer, if it is still armed, a chance to fire and
    # queue a put() before we flush and check the library.
    page.wait_for_timeout(700)
    page.evaluate("() => window.__rack.flush()")
    remaining = page.evaluate("""async (id) => {
      const {openLibrary} = await import('/site/rack/library.js');
      const lib = await openLibrary();
      const list = await lib.list();
      return list.some(d => d.id === id);
    }""", deleted_id)
    if remaining:
        bad.append("rack page: a deleted rack came back after its pending autosave flushed")
    return bad


@extra("rack.html: opening a .json whose id is already in the library never overwrites it, and switching docs flushes a pending edit first")
def check_rack_import_keeps_library(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    page.goto(f"{base}/rack.html?probe=1", wait_until="load")
    page.wait_for_function("() => window.__rack && window.__rack.ready", timeout=READY_MS)
    page.evaluate("() => window.__rack.ready")
    orig_id = page.evaluate("() => window.__rack.doc().id")

    def set_height(h, wait_redraw=True):
        # #frameBtn toggles the frame form open/closed, so only click it when
        # the form isn't already showing (a second call would otherwise close it).
        if not page.is_visible("#fHeight"):
            page.click("#frameBtn")
        page.fill("#fHeight", str(h))
        page.dispatch_event("#fHeight", "change")
        # dispatch_event runs the change handler (commit(), which updates
        # S.doc synchronously) before returning, so the redraw itself need
        # not be waited on to know the new height is already in S.doc - and
        # for the pending-edit case below, waiting on it would only give a
        # 500ms autosave timer more time to land on its own.
        if wait_redraw:
            page.wait_for_function(
                f"""() => document.querySelectorAll('svg[data-pane="front"] rect.rk-u').length === {h}""",
                timeout=READY_MS)

    # First edit: flush it, then save the doc (as it stands, height 20) to a
    # file - this is the file we later re-import.
    set_height(20)
    page.evaluate("() => window.__rack.flush()")
    first_doc = page.evaluate("() => window.__rack.doc()")
    tmp_path = pathlib.Path(tempfile.mkstemp(suffix=".rack.json")[1])
    tmp_path.write_text(json.dumps(first_doc))

    # Second edit, left pending (no explicit flush): switching to the same
    # rack from the library list must flush it first, or the switch reads
    # back the stale, pre-edit copy. The autosave lands 500ms after the edit,
    # so the edit and the switch are fired from a single page.evaluate (no
    # round trip between them) to make the race deterministic rather than
    # dependent on how long Playwright's own IPC happens to take.
    page.click("#libMenu summary")   # renders #libItems, including the current-rack button, ahead of time
    page.wait_for_selector("#libItems button.rk-current", timeout=READY_MS)
    page.evaluate("""() => {
      const h = document.getElementById('fHeight');
      h.value = '30';
      h.dispatchEvent(new Event('change', {bubbles: true}));
      document.querySelector('#libItems button.rk-current').click();
    }""")
    # Give the click handler (its getDoc/setDoc) and the 500ms autosave timer
    # both time to fully settle before reading the final state - the height
    # can read 30 transiently (before the switch's own read lands) and then
    # drop back to a stale value, so an early poll would miss that.
    page.wait_for_timeout(800)
    got = page.evaluate("() => window.__rack.doc().racks[0].frame.heightRU")
    if got != 30:
        bad.append(f"library switch: doc height is {got} after switching to the current rack, expected 30 "
                    "(a pending edit was lost)")
    page.evaluate("() => window.__rack.flush()")

    # Now import the earlier file (id = orig_id, height 20). The library
    # already holds a document with that id (the one just edited to height
    # 30): importing must not overwrite it.
    page.set_input_files("#openFile", str(tmp_path))
    try:
        page.wait_for_function("(id) => window.__rack.doc().id !== id", arg=orig_id, timeout=5000)
    except Exception:
        pass
    imported = page.evaluate("() => window.__rack.doc()")
    if imported["id"] == orig_id:
        bad.append("import: the imported document kept the original file's id")
    if imported["racks"][0]["frame"]["heightRU"] != 20:
        bad.append(f"import: imported doc height is {imported['racks'][0]['frame']['heightRU']}, expected 20")

    docs = page.evaluate("""async () => {
      const {openLibrary} = await import('/site/rack/library.js');
      const lib = await openLibrary();
      return await lib.list();
    }""")
    if len(docs) != 2:
        bad.append(f"import: library holds {len(docs)} document(s), expected 2 "
                    "(the edited original plus the import)")
    orig = page.evaluate("""async (id) => {
      const {openLibrary} = await import('/site/rack/library.js');
      const lib = await openLibrary();
      return await lib.get(id);
    }""", orig_id)
    if not orig or orig["racks"][0]["frame"]["heightRU"] != 30:
        bad.append(f"import: the original rack in the library reads height "
                    f"{orig and orig['racks'][0]['frame']['heightRU']}, expected 30 (its latest edit)")
    tmp_path.unlink(missing_ok=True)
    return bad


@extra("rack.html: without IndexedDB the note shows, both faces still draw, and Save as .json still works")
def check_rack_no_idb(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    page.add_init_script("Object.defineProperty(window, 'indexedDB', {value: undefined})")
    page.goto(f"{base}/rack.html?probe=1", wait_until="load")
    page.wait_for_function("() => window.__rack && window.__rack.ready", timeout=READY_MS)
    page.evaluate("() => window.__rack.ready")
    if page.is_hidden("#libNote"):
        bad.append("rack page without IndexedDB: #libNote is not shown")
    counts = page.evaluate("""() => ['front', 'rear'].map(f =>
      document.querySelectorAll(`svg[data-pane="${f}"] rect.rk-u`).length)""")
    if counts != [42, 42]:
        bad.append(f"rack page without IndexedDB: U targets {counts}, expected [42, 42]")
    with page.expect_download() as download_info:
        page.click("#libMenu summary")
        page.click("#libItems >> text=Save as .json")
    saved = pathlib.Path(download_info.value.path())
    data = json.loads(saved.read_text())
    if data.get("format") != "portrayal-rack":
        bad.append(f"rack page without IndexedDB: downloaded file format is {data.get('format')!r}, expected 'portrayal-rack'")
    # Without a library, New rack still counts up rather than naming every rack "Rack 1".
    page.on("dialog", lambda d: d.dismiss())
    for want in ("Rack 2", "Rack 3"):
        page.click("#libMenu > summary")
        page.click("#libItems button:has-text('New rack')")
        try:
            page.wait_for_function("(n) => window.__rack.doc().racks[0].name === n", arg=want, timeout=5000)
        except Exception:
            bad.append(f"rack page without IndexedDB: New rack is named {page.evaluate('() => window.__rack.doc().racks[0].name')!r}, expected {want!r}")
            break
    return bad


def wait_fn(page, label, expr, timeout=READY_MS):
    # page.wait_for_function, but a timeout says which step it was - CI-only
    # failures otherwise all look identical ("Timeout 60000ms exceeded.")
    # with no clue which of a dozen waits in the check actually stalled.
    try:
        page.wait_for_function(expr, timeout=timeout)
    except Exception as e:
        raise RuntimeError(f"{label}: {str(e).splitlines()[0]}") from e


def wait_sel(page, label, selector, timeout=READY_MS):
    try:
        return page.wait_for_selector(selector, timeout=timeout)
    except Exception as e:
        raise RuntimeError(f"{label}: {str(e).splitlines()[0]}") from e


def u_center(page, face, u):
    box = page.eval_on_selector(
        f'svg[data-pane="{face}"] rect.rk-u[data-u="{u}"]',
        "el => { const r = el.getBoundingClientRect(); return {x: r.x + r.width / 2, y: r.y + r.height / 2}; }")
    return box["x"], box["y"]


def render_token(page):
    # commit() (rack-page.js) writes the new ru/face onto window.__rack.doc()
    # synchronously, then fires its `render()` WITHOUT awaiting it - render()
    # is itself async (drawElevation awaits configuredFace per item), so the
    # doc model can read as moved a tick before the DOM does. Locally that gap
    # closes before Playwright's next command round-trips; on a loaded CI
    # runner it doesn't, and a bare u_center()+mouse.down() right after the
    # model wait grabs a stale (or momentarily missing) panel, so a fresh drag
    # never even starts. render() replaces both pane <svg>s wholesale on every
    # draw, so capturing the front one here and waiting for it to become a
    # different node (below) is a precise, synchronous "the DOM caught up"
    # signal - not a fixed sleep or frame count.
    return page.evaluate_handle('() => document.querySelector(\'svg[data-pane="front"]\')')


def wait_rendered(page, label, token, timeout=READY_MS):
    try:
        page.wait_for_function(
            'old => document.querySelector(\'svg[data-pane="front"]\') !== old', arg=token, timeout=timeout)
    except Exception as e:
        raise RuntimeError(f"{label}: {str(e).splitlines()[0]}") from e
    finally:
        token.dispose()


@extra("rack.html: drag a device to move it, across faces, with fit feedback and Esc to cancel")
def check_rack_drag(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    page.goto(f"{base}/rack.html?probe=1", wait_until="load")
    wait_fn(page, "initial ready", "() => window.__rack && window.__rack.ready")
    page.evaluate("() => window.__rack.ready")
    page.click("#libMenu > summary"); page.click("#libItems button:has-text('New rack')")
    wait_fn(page, "new rack: items empty", "() => window.__rack.doc().racks[0].items.length === 0")

    pick(page, "front", 20, "AS7726", "as7726-32x")
    wait_sel(page, "place as7726-32x on front U20",
             'svg[data-pane="front"] [data-device-ref="as7726-32x"][data-panel="mounted"]')

    # Drag it from front U20 to front U25 - coordinates come from the U rects'
    # own boxes at the moment of each move, since the layout does not change
    # mid-drag but the rack could be scrolled or zoomed differently than the
    # values above assume.
    x0, y0 = u_center(page, "front", 20)
    page.mouse.move(x0, y0)
    page.mouse.down()
    for u in (22, 25):
        x, y = u_center(page, "front", u)
        page.mouse.move(x, y, steps=3)
    # Mid-drag: a preview outline, a live status line, and the dragged group
    # dimmed - all before the drop.
    if page.eval_on_selector_all("rect.rk-drop", "els => els.length") != 1:
        bad.append("drag: no single rect.rk-drop preview shown mid-drag")
    status = page.text_content("#dragStatus") or ""
    if not status.strip():
        bad.append("drag: #dragStatus has no text mid-drag")
    opacity = page.eval_on_selector('svg[data-pane="front"] [data-device-ref="as7726-32x"]',
                                     "el => getComputedStyle(el).opacity")
    if float(opacity) >= 0.99:
        bad.append(f"drag: the dragged group is not dimmed mid-drag (opacity {opacity})")
    tok = render_token(page)
    page.mouse.up()
    wait_fn(page, "same-pane drag front U20 -> U25",
        "() => window.__rack.doc().racks[0].items[0].ru === 25 && window.__rack.doc().racks[0].items[0].face === 'front'")
    wait_rendered(page, "same-pane drag front U20 -> U25: DOM settle", tok)

    # Drag it onto the rear pane: the face switches.
    x0, y0 = u_center(page, "front", 25)
    page.mouse.move(x0, y0)
    page.mouse.down()
    xr, yr = u_center(page, "rear", 25)
    page.mouse.move((x0 + xr) / 2, y0, steps=2)
    page.mouse.move(xr, yr, steps=3)
    tok = render_token(page)
    page.mouse.up()
    wait_fn(page, "cross-face drag front -> rear U25", "() => window.__rack.doc().racks[0].items[0].face === 'rear'")
    wait_rendered(page, "cross-face drag front -> rear U25: DOM settle", tok)

    # A device already on rear U30 refuses a drop onto it, unchanged, and the
    # reason - not the whole side panel - is what tells the user why.
    pick(page, "rear", 30, "TM-280", "tm-280")
    wait_sel(page, "place tm-280 on rear U30",
             'svg[data-pane="rear"] [data-device-ref="tm-280"][data-panel="mounted"]')
    before = page.evaluate("() => window.__rack.doc().racks[0].items[0]")
    x0, y0 = u_center(page, "rear", before["ru"])
    page.mouse.move(x0, y0)
    page.mouse.down()
    x30, y30 = u_center(page, "rear", 30)
    page.mouse.move(x0, (y0 + y30) / 2, steps=2)
    page.mouse.move(x30, y30, steps=3)
    page.mouse.up()
    wait_sel(page, "refused drop onto occupied rear U30 shows notice", ".rk-side .rk-notice")
    err = page.text_content(".rk-side .rk-notice") or ""
    after = page.evaluate("() => window.__rack.doc().racks[0].items[0]")
    if "Taken by" not in err:
        bad.append(f"drag: dropping onto an occupied U was not refused with 'Taken by' ({err!r})")
    if after["ru"] != before["ru"] or after["face"] != before["face"]:
        bad.append(f"drag: a refused drop changed the item ({before} -> {after})")

    # Some engines (Firefox, Safari) fire a trailing 'click' after a drag that
    # used setPointerCapture; Chromium in this harness does not. Either way,
    # that echo must never be treated as a fresh click - simulate the
    # Firefox-style trailing click here and check it did not re-select or
    # clear the refusal notice still showing from the drop above.
    page.evaluate("""() => {
      const g = document.querySelector('svg[data-pane="rear"] [data-device-ref="as7726-32x"]');
      g.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}));
    }""")
    err_after_echo = page.text_content(".rk-side .rk-notice") or ""
    if "Taken by" not in err_after_echo:
        bad.append(f"drag: a synthetic trailing click after a refused drop cleared the notice ({err_after_echo!r})")

    # A real click right after that - on an empty U - still opens the picker:
    # the echo must not have swallowed this one instead.
    page.click('svg[data-pane="front"] rect.rk-u[data-u="1"]')
    wait_sel(page, "real click on empty front U1 opens picker", "#catQuery")

    # A short click (no movement) still selects.
    page.click('svg[data-pane="rear"] [data-device-ref="as7726-32x"]')
    wait_sel(page, "short click on rear device selects it", "#iLabel")

    # Esc mid-drag cancels: the item stays exactly where it was.
    before = page.evaluate("() => window.__rack.doc().racks[0].items[0]")
    x0, y0 = u_center(page, "rear", before["ru"])
    page.mouse.move(x0, y0)
    page.mouse.down()
    page.mouse.move(x0, max(0, y0 - 80), steps=3)
    page.keyboard.press("Escape")
    page.mouse.up()
    after = page.evaluate("() => window.__rack.doc().racks[0].items[0]")
    if after["ru"] != before["ru"] or after["face"] != before["face"]:
        bad.append(f"drag: Esc mid-drag did not cancel ({before} -> {after})")

    # Two-post: front and rear are the same plane, so dragging one device onto
    # the other's U (even on the other face) is refused.
    page.click("#libMenu > summary"); page.click("#libItems button:has-text('New rack')")
    wait_fn(page, "two-post setup: new rack empty", "() => window.__rack.doc().racks[0].items.length === 0")
    page.click("#frameBtn")
    page.select_option("#fKind", "two-post")
    wait_fn(page, "two-post setup: frame kind switched", "() => window.__rack.doc().racks[0].frame.kind === 'two-post'")
    pick(page, "front", 10, "TM-280", "tm-280")
    wait_sel(page, "two-post: place tm-280 on front U10",
             'svg[data-pane="front"] [data-device-ref="tm-280"][data-panel="mounted"]')
    # The second device sits on the FRONT too (at U20): dragging the first
    # one onto the REAR at U20 makes the candidate's face differ from the
    # occupant's, which is exactly the two-post case ("one plane"), not a
    # same-face "Taken by" collision.
    pick(page, "front", 20, "TM-280", "tm-280")
    wait_fn(page, "two-post: second tm-280 placed on front U20",
            "() => window.__rack.doc().racks[0].items.length === 2")
    x0, y0 = u_center(page, "front", 10)
    page.mouse.move(x0, y0)
    page.mouse.down()
    x20, y20 = u_center(page, "rear", 20)
    page.mouse.move((x0 + x20) / 2, (y0 + y20) / 2, steps=2)
    page.mouse.move(x20, y20, steps=3)
    page.mouse.up()
    wait_sel(page, "two-post refused cross-face drop shows notice", ".rk-side .rk-notice")
    tp_err = page.text_content(".rk-side .rk-notice") or ""
    if "two-post rails are shared" not in tp_err:
        bad.append(f"drag: a two-post drop onto the other face's U was not refused as shared rails ({tp_err!r})")

    # Part 1's regression: a stale S.sel from an earlier click on an EMPTY U
    # (its catalog panel left open) must not keep painting that U's brass
    # highlight forever - a later drag of an unrelated device has to replace
    # the selection, on both a same-pane and a cross-pane drop.
    page.click("#libMenu > summary"); page.click("#libItems button:has-text('New rack')")
    wait_fn(page, "stale-selection setup: new rack empty", "() => window.__rack.doc().racks[0].items.length === 0")
    pick(page, "front", 20, "AS7726", "as7726-32x")
    wait_sel(page, "stale-selection setup: place as7726-32x on front U20",
             'svg[data-pane="front"] [data-device-ref="as7726-32x"][data-panel="mounted"]')
    page.click('svg[data-pane="rear"] rect.rk-u[data-u="12"]')
    wait_sel(page, "stale-selection: click empty rear U12 opens picker", "#catQuery")
    x0, y0 = u_center(page, "front", 20)
    page.mouse.move(x0, y0)
    page.mouse.down()
    xf, yf = u_center(page, "front", 7)
    page.mouse.move((x0 + xf) / 2, (y0 + yf) / 2, steps=2)
    page.mouse.move(xf, yf, steps=3)
    tok = render_token(page)
    page.mouse.up()
    wait_fn(page, "same-pane drag front U20 -> U7 after stale selection",
        "() => window.__rack.doc().racks[0].items[0].ru === 7 && window.__rack.doc().racks[0].items[0].face === 'front'")
    # The stray-rect check below reads rk-u-selected, which drawElevation only
    # sets during the (async) render triggered by this drop - without waiting
    # for it, a stale pre-drop DOM could still show the old selection and be
    # misread as the bug this block exists to catch.
    wait_rendered(page, "same-pane drag front U20 -> U7 after stale selection: DOM settle", tok)
    stray = page.eval_on_selector_all("rect.rk-drop, rect.rk-u-selected", "els => els.length")
    if stray != 0:
        bad.append(f"drag: a stale rk-drop/rk-u-selected rect stayed after a same-pane drop ({stray} found)")

    # Repeat across a cross-pane drop: select empty rear U5 (opens the
    # catalog there), then drag the device from front to rear.
    page.click('svg[data-pane="rear"] rect.rk-u[data-u="5"]')
    wait_sel(page, "stale-selection: click empty rear U5 opens picker", "#catQuery")
    x0, y0 = u_center(page, "front", 7)
    page.mouse.move(x0, y0)
    page.mouse.down()
    xr, yr = u_center(page, "rear", 15)
    page.mouse.move((x0 + xr) / 2, y0, steps=2)
    page.mouse.move(xr, yr, steps=3)
    tok = render_token(page)
    page.mouse.up()
    wait_fn(page, "cross-pane drag front U7 -> rear U15 after stale selection",
        "() => window.__rack.doc().racks[0].items[0].face === 'rear'")
    wait_rendered(page, "cross-pane drag front U7 -> rear U15 after stale selection: DOM settle", tok)
    stray2 = page.eval_on_selector_all("rect.rk-drop, rect.rk-u-selected", "els => els.length")
    if stray2 != 0:
        bad.append(f"drag: a stale rk-drop/rk-u-selected rect stayed after a cross-pane drop ({stray2} found)")
    return bad


@extra("rack.html: shrinking the frame compacts, then trims from the bottom, with Undo")
def check_rack_shrink(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    page.goto(f"{base}/rack.html?probe=1", wait_until="load")
    page.wait_for_function("() => window.__rack && window.__rack.ready", timeout=READY_MS)
    page.evaluate("() => window.__rack.ready")
    page.click("#libMenu > summary"); page.click("#libItems button:has-text('New rack')")
    page.wait_for_function("() => window.__rack.doc().racks[0].items.length === 0")

    # 1U, 1U and a 2U device, at U5, U20 and U30 of a 42U rack.
    pick(page, "front", 5, "MX204", "mx204")
    pick(page, "front", 20, "AS7726", "as7726-32x")
    pick(page, "front", 30, "R740", "r740xd")
    page.wait_for_function("() => window.__rack.doc().racks[0].items.length === 3")
    sorted_items = lambda: sorted(page.evaluate("() => window.__rack.doc().racks[0].items"), key=lambda i: i["ru"])

    page.click("#frameBtn")
    page.fill("#fHeight", "12")
    page.dispatch_event("#fHeight", "change")
    page.wait_for_function("() => window.__rack.doc().racks[0].frame.heightRU === 12")
    got = [(i["ref"], i["ru"]) for i in sorted_items()]
    want = [("mx204", 1), ("as7726-32x", 2), ("r740xd", 3)]
    if got != want:
        bad.append(f"shrink: after compacting to 12U items are {got}, expected {want}")
    page.wait_for_selector(".rk-side .rk-notice", timeout=READY_MS)
    note = (page.text_content(".rk-side .rk-notice") or "").lower()
    if "moved" not in note:
        bad.append(f"shrink: the notice does not mention moving devices ({note!r})")

    # Shrinking further to 3U (from the 12U-compacted state, top at U4) means
    # 1+1+2 = 4U of devices no longer fit in 3U: the bottom one (MX204) goes.
    page.fill("#fHeight", "3")
    page.dispatch_event("#fHeight", "change")
    page.wait_for_function("() => window.__rack.doc().racks[0].frame.heightRU === 3")
    refs = [i["ref"] for i in sorted_items()]
    if refs != ["as7726-32x", "r740xd"]:
        bad.append(f"shrink: shrinking to 3U left {refs}, expected the bottom device (mx204) removed")
    page.wait_for_selector(".rk-side .rk-notice", timeout=READY_MS)
    note2 = page.text_content(".rk-side .rk-notice") or ""
    if "MX204" not in note2:
        bad.append(f"shrink: the removal notice does not name MX204 ({note2!r})")

    # Undo restores the rack from just before this shrink - the 12U-compacted
    # state, frame included - exactly.
    page.click("#undoShrink")
    page.wait_for_function("() => window.__rack.doc().racks[0].items.length === 3")
    got2 = [(i["ref"], i["ru"]) for i in sorted_items()]
    if got2 != want:
        bad.append(f"shrink: Undo did not restore the pre-shrink positions, got {got2}")
    if page.evaluate("() => window.__rack.doc().racks[0].frame.heightRU") != 12:
        bad.append("shrink: Undo did not restore the pre-shrink frame height")
    return bad


@extra("rack.html: each pane shows a device's real panel, ears on the mounted face, through/mounted precedence")
def check_rack_faces(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    page.goto(f"{base}/rack.html?probe=1", wait_until="load")
    page.wait_for_function("() => window.__rack && window.__rack.ready", timeout=READY_MS)
    page.evaluate("() => window.__rack.ready")
    page.click("#libMenu > summary"); page.click("#libItems button:has-text('New rack')")
    page.wait_for_function("() => window.__rack.doc().racks[0].items.length === 0")

    # MX204 (short of a four-post's rear rail) at front U10, TM-280 at rear
    # U10: a four-post pair sharing a U.
    pick(page, "front", 10, "MX204", "mx204")
    page.wait_for_selector('svg[data-pane="front"] [data-device-ref="mx204"][data-panel="mounted"]', timeout=READY_MS)
    # MX204's own through panel now covers this same U's hit rectangle on the
    # rear pane, so this dispatches straight to it.
    pick(page, "rear", 10, "TM-280", "tm-280", dispatch=True)
    page.wait_for_selector('svg[data-pane="rear"] [data-device-ref="tm-280"][data-panel="mounted"]', timeout=READY_MS)

    mx_id = page.eval_on_selector('svg[data-pane="front"] [data-device-ref="mx204"]', "el => el.dataset.itemId")
    tm_id = page.eval_on_selector('svg[data-pane="rear"] [data-device-ref="tm-280"]', "el => el.dataset.itemId")

    # Front pane: MX204 is mounted, with ears.
    if not page.query_selector(f'svg[data-pane="front"] g.rk-ears[data-ears-for="{mx_id}"]'):
        bad.append("faces: no rk-ears group for the front-mounted MX204 in the front pane")

    # Rear pane: MX204 shows its real rear panel as `through`, with no ears;
    # TM-280 is `mounted` there, with ears, and comes after (on top of)
    # MX204's through panel in document order.
    mx_rear = page.query_selector('svg[data-pane="rear"] [data-device-ref="mx204"][data-panel="through"]')
    if not mx_rear:
        bad.append("faces: MX204's rear panel is not data-panel=through in the rear pane")
    elif not mx_rear.query_selector('[data-path="cutout:esd-rear"]'):
        bad.append("faces: the rear pane does not show MX204's real rear panel (missing cutout:esd-rear)")
    if page.query_selector(f'svg[data-pane="rear"] g.rk-ears[data-ears-for="{mx_id}"]'):
        bad.append("faces: MX204's through panel in the rear pane has ears, expected none")
    if not page.query_selector(f'svg[data-pane="rear"] g.rk-ears[data-ears-for="{tm_id}"]'):
        bad.append("faces: no rk-ears group for the rear-mounted TM-280 in the rear pane")
    order = page.eval_on_selector('svg[data-pane="rear"]', """(svg, ids) => {
      const a = svg.querySelector(`[data-item-id="${ids[0]}"][data-panel="through"]`);
      const b = svg.querySelector(`[data-item-id="${ids[1]}"][data-panel="mounted"]`);
      return !!(a && b) && !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    }""", [mx_id, tm_id])
    if not order:
        bad.append("faces: the rear pane does not draw TM-280 (mounted) after MX204 (through)")

    # No leftover ghost wording anywhere on the page.
    body_text = page.text_content("body") or ""
    if "short of this rail" in body_text or "-mounted," in body_text:
        bad.append(f"faces: stale ghost wording is still on the page")

    # A second MX204 at front U20, nothing at rear U20: the rear pane's U20
    # is free even though MX204's through panel there covers its hit target -
    # a click on it opens the picker for that free rear U.
    pick(page, "front", 20, "MX204", "mx204")
    page.wait_for_function("() => window.__rack.doc().racks[0].items.length === 3")
    page.wait_for_selector('svg[data-pane="rear"] rect.rk-u[data-u="20"]', timeout=READY_MS)
    x20, y20 = u_center(page, "rear", 20)
    page.mouse.click(x20, y20)
    page.wait_for_selector(".rk-side h3", timeout=READY_MS)
    heading = page.text_content(".rk-side h3") or ""
    if "rear, empty" not in heading or "U20" not in heading.replace("U 20", "U20"):
        bad.append(f"faces: clicking the free rear U under MX204's through panel opened {heading!r}, not the U20/rear picker")

    # Fix round 1 #1: a through panel opens the picker ONLY when the frame is
    # four-post, the item does not reach this rail, and the U is free here -
    # otherwise a click on it selects the item, same as any other panel.
    #
    # Two-post: front and rear are the same shared plane (fit.js's reaches()
    # is always true there), so a real click on a front device's rear
    # (through) panel selects the device.
    page.click("#libMenu > summary"); page.click("#libItems button:has-text('New rack')")
    page.wait_for_function("() => window.__rack.doc().racks[0].items.length === 0")
    page.click("#frameBtn")
    page.select_option("#fKind", "two-post")
    page.wait_for_function("() => window.__rack.doc().racks[0].frame.kind === 'two-post'")
    pick(page, "front", 10, "TM-280", "tm-280")
    page.wait_for_selector('svg[data-pane="front"] [data-device-ref="tm-280"][data-panel="mounted"]', timeout=READY_MS)
    page.wait_for_selector('svg[data-pane="rear"] [data-device-ref="tm-280"][data-panel="through"]', timeout=READY_MS)
    xr, yr = u_center(page, "rear", 10)
    page.mouse.click(xr, yr)
    page.wait_for_selector("#iLabel, #catQuery", timeout=READY_MS)
    if page.query_selector("#catQuery"):
        bad.append("faces: a two-post click on a front device's rear (through) panel opened the picker instead of selecting the device")

    # Four-post, full depth: R740xd (737.5 mm) reaches the far rail (>= 740 -
    # 50), so its through panel IS its real, present rear - a click there
    # selects it too, not the picker.
    page.click("#libMenu > summary"); page.click("#libItems button:has-text('New rack')")
    page.wait_for_function("() => window.__rack.doc().racks[0].items.length === 0")
    pick(page, "front", 10, "R740", "r740xd")
    page.wait_for_selector('svg[data-pane="front"] [data-device-ref="r740xd"][data-panel="mounted"]', timeout=READY_MS)
    page.wait_for_selector('svg[data-pane="rear"] [data-device-ref="r740xd"][data-panel="through"]', timeout=READY_MS)

    # Two screws per ear per U, on the rail's own holes - rack3d.js's rackEars
    # and the BOM's 4 x U count the same way. The R740xd is 2U: 8 heads.
    r740_id = page.eval_on_selector('svg[data-pane="front"] [data-device-ref="r740xd"]', "el => el.dataset.itemId")
    screws = page.eval_on_selector('svg[data-pane="front"]', """(svg, id) => {
      const ears = svg.querySelector(`g.rk-ears[data-ears-for="${id}"]`);
      const holes = [...svg.querySelectorAll('[data-rail-hole]')].map(h => h.tagName === 'circle'
        ? +h.getAttribute('cy') : +h.getAttribute('y') + +h.getAttribute('height') / 2);
      const heads = ears ? [...ears.querySelectorAll('circle')] : [];
      return {n: heads.length,
              onHoles: heads.every(c => holes.some(y => Math.abs(y - +c.getAttribute('cy')) < 0.01))};
    }""", r740_id)
    if screws["n"] != 8:
        bad.append(f"faces: a 2U device's ears carry {screws['n']} screws, expected 8 (2 per ear per U)")
    if not screws["onHoles"]:
        bad.append("faces: a screw head is not on a rail hole")

    xr2, yr2 = u_center(page, "rear", 10)
    page.mouse.click(xr2, yr2)
    page.wait_for_selector("#iLabel, #catQuery", timeout=READY_MS)
    if page.query_selector("#catQuery"):
        bad.append("faces: a four-post click on a full-depth R740xd's rear (through) panel opened the picker instead of selecting it")
    return bad


@extra("rack.html: the 3D view - frame-aware posts, rear mounting, and the 2D/3D toggle")
def check_rack_3d(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    page.goto(f"{base}/rack.html?probe=1", wait_until="load")
    page.wait_for_function("() => window.__rack && window.__rack.ready", timeout=READY_MS)
    page.evaluate("() => window.__rack.ready")
    page.click("#libMenu > summary"); page.click("#libItems button:has-text('New rack')")
    page.wait_for_function("() => window.__rack.doc().racks[0].items.length === 0")

    # A new rack defaults to four-post. R740xd on the front at U10, TM-280 on
    # the rear at U20 - a front and a rear mount that do not share a U, so
    # neither click is covered by the other's through panel.
    pick(page, "front", 10, "R740", "r740xd")
    page.wait_for_selector('svg[data-pane="front"] [data-device-ref="r740xd"][data-panel="mounted"]', timeout=READY_MS)
    pick(page, "rear", 20, "TM-280", "tm-280")
    page.wait_for_selector('svg[data-pane="rear"] [data-device-ref="tm-280"][data-panel="mounted"]', timeout=READY_MS)

    # THE SAME BRANCH check_stages TAKES: this runner may have no WebGL at
    # all, in which case the 3D view can only ever show its fallback
    # sentence - asserted here instead of failing on a scene that can never
    # exist.
    no_webgl = webgl_trouble(page)
    print(f"[check_rack_3d] WebGL path: {'unavailable - checking the fallback sentence' if no_webgl else 'available - running the full 3D checks'}")

    page.click('#rkMode [data-mode="3d"]')

    if no_webgl:
        page.wait_for_function(
            "() => (document.querySelector('#stage3d')?.textContent || '').includes(\"3D isn't available\")",
            timeout=READY_MS)
        if not page.is_visible("#stage3d"):
            bad.append("rack 3D (no WebGL): #stage3d is not shown with the fallback sentence")
        if page.is_visible("#panes"):
            bad.append("rack 3D (no WebGL): #panes is still visible once 3D is chosen")
        return bad

    page.wait_for_function("() => window.__rack.scene() != null", timeout=READY_MS)
    page.evaluate("async () => { await window.__rack.scene().complete(); }")

    posts = page.evaluate("() => window.__rack.scene().posts()")
    if posts != 4:
        bad.append(f"rack 3D: posts() is {posts}, expected 4 on a four-post rack")

    devices = page.evaluate("() => window.__rack.scene().devices()")
    r740 = next((d for d in devices if d["ref"] == "r740xd"), None)
    tm280 = next((d for d in devices if d["ref"] == "tm-280"), None)
    if not r740 or not tm280:
        bad.append(f"rack 3D: devices() did not report both mounts ({devices})")
    else:
        if abs(tm280["rotY"] - math.pi) > 0.01:
            bad.append(f"rack 3D: the rear-mounted TM-280's rotation.y is {tm280['rotY']}, expected ~pi")
        if not (tm280["z"] < r740["z"]):
            bad.append(f"rack 3D: TM-280's z ({tm280['z']}) is not behind the R740xd's front-mounted z ({r740['z']})")

    # Shrinking the frame while in 3D moves devices - fit.js's shrinkRack
    # compacts everything from the bottom once anything no longer fits - and
    # Undo must restore the ORIGINAL rack. The 3D scene has to follow it
    # (round 1 fix #2: undoShrink() used to leave the shrunk scene standing,
    # never scheduling a rebuild).
    page.click("#frameBtn")
    page.fill("#fHeight", "15")
    page.dispatch_event("#fHeight", "change")
    page.wait_for_selector("#undoShrink", timeout=READY_MS)
    moved = page.evaluate("""() => Object.fromEntries(
      window.__rack.doc().racks[0].items.map(i => [i.ref, i.ru]))""")
    if moved.get("r740xd") == 10 and moved.get("tm-280") == 20:
        bad.append(f"rack 3D shrink: nothing moved, so Undo was not exercised ({moved})")
    page.click("#undoShrink")
    page.wait_for_function("""() => { const it = window.__rack.doc().racks[0].items;
      const r = it.find(i => i.ref === 'r740xd'), t = it.find(i => i.ref === 'tm-280');
      return !!r && !!t && r.ru === 10 && t.ru === 20; }""", timeout=READY_MS)
    # The rebuild is debounced (300ms) - poll the scene until it agrees too.
    page.wait_for_function("""() => { const s = window.__rack.scene(); if (!s) return false;
      const st = s.resolved().stack, r = st.find(i => i.ref === 'r740xd'),
        t = st.find(i => i.ref === 'tm-280'); return !!r && !!t && r.ru === 10 && t.ru === 20; }""",
        timeout=READY_MS)

    # Switch the frame to two-post while still in 3D: the rear pair goes away.
    page.select_option("#fKind", "two-post")
    page.wait_for_function("() => window.__rack.scene() != null && window.__rack.scene().posts() === 2",
                           timeout=READY_MS)

    # Back to 2D: the scene is gone and the panes return, still 42 U each,
    # and NOT stuck at height 0 (round 1 fix #1: render() applied zoom against
    # a #panes that was still `hidden`, measuring a 0 column and leaving every
    # SVG at height:0 once the panes came back).
    page.click('#rkMode [data-mode="2d"]')
    page.wait_for_function("() => window.__rack.scene() == null", timeout=READY_MS)
    if not page.is_visible("#panes"):
        bad.append("rack 3D: #panes is not visible after switching back to 2D")
    counts = page.evaluate("""() => ['front', 'rear'].map(f =>
      document.querySelectorAll(`svg[data-pane="${f}"] rect.rk-u`).length)""")
    if counts != [42, 42]:
        bad.append(f"rack 3D: after switching back to 2D, U targets are {counts}, expected [42, 42]")
    h = page.eval_on_selector('svg[data-pane="front"]', "s => s.getBoundingClientRect().height")
    if not (h > 100):
        bad.append(f"rack 3D: after editing in 3D and switching back to 2D, the front SVG's height is {h}, expected > 100")

    # Reload while in 3D (the mode is remembered) and switch back to 2D: the
    # same blank-pane bug, from the reload direction rather than the toggle.
    page.click('#rkMode [data-mode="3d"]')
    page.wait_for_function("() => window.__rack.scene() != null", timeout=READY_MS)
    page.evaluate("async () => { await window.__rack.scene().complete(); }")
    page.reload(wait_until="load")
    page.wait_for_function("() => window.__rack && window.__rack.ready", timeout=READY_MS)
    page.evaluate("() => window.__rack.ready")
    if page.get_attribute('#rkMode [data-mode="3d"]', "aria-pressed") != "true":
        bad.append("rack 3D: the 3D mode was not remembered across a reload")
    page.wait_for_function("() => window.__rack.scene() != null", timeout=READY_MS)
    page.click('#rkMode [data-mode="2d"]')
    page.wait_for_function("() => window.__rack.scene() == null", timeout=READY_MS)
    h2 = page.eval_on_selector('svg[data-pane="front"]', "s => s.getBoundingClientRect().height")
    if not (h2 > 100):
        bad.append(f"rack 3D: after reloading into remembered 3D and switching back to 2D, the front SVG's height is {h2}, expected > 100")

    # A reload remembers the mode - 2D, just chosen above.
    page.reload(wait_until="load")
    page.wait_for_function("() => window.__rack && window.__rack.ready", timeout=READY_MS)
    page.evaluate("() => window.__rack.ready")
    if page.get_attribute('#rkMode [data-mode="2d"]', "aria-pressed") != "true":
        bad.append("rack 3D: the 2D mode was not remembered across a reload")
    if not page.is_visible("#panes"):
        bad.append("rack 3D: after reload in the remembered 2D mode, #panes is not visible")
    return bad


@extra("rack.html: the 2D/3D switch stays put when the mode changes")
def check_rack_mode_toggle_stable(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    page.goto(f"{base}/rack.html?probe=1", wait_until="load")
    page.wait_for_function("() => window.__rack && window.__rack.ready", timeout=READY_MS)
    page.evaluate("() => window.__rack.ready")
    x = lambda: page.evaluate("() => Math.round(document.getElementById('rkMode').getBoundingClientRect().left)")
    page.click('#rkMode [data-mode="2d"]')
    before = x()
    page.click('#rkMode [data-mode="3d"]')
    in3d = x()
    page.click('#rkMode [data-mode="2d"]')
    after = x()
    if not (before == in3d == after):
        bad.append(f"mode switch: the toggle moved (2D {before}px, 3D {in3d}px, back {after}px)")
    if page.is_visible("#zoomIn"):
        page.click('#rkMode [data-mode="3d"]')
        if page.is_visible("#zoomIn"):
            bad.append("mode switch: the zoom controls are still visible in 3D")
    return bad


@extra("rack.html: rails, ears and screws are the same silver in light and dark")
def check_rack_rails_metal(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    seen = {}
    for scheme in ("light", "dark"):
        page.emulate_media(color_scheme=scheme)
        page.goto(f"{base}/rack.html?probe=1", wait_until="load")
        page.wait_for_function("() => window.__rack && window.__rack.ready", timeout=READY_MS)
        page.evaluate("() => window.__rack.ready")
        page.wait_for_selector('svg[data-pane="front"] rect[data-rail]', timeout=READY_MS)
        seen[scheme] = page.evaluate("""() => {
          const rail = document.querySelector('svg[data-pane="front"] rect[data-rail]');
          return getComputedStyle(rail).fill; }""")
    if seen["light"] != seen["dark"]:
        bad.append(f"rails change with the theme: light {seen['light']}, dark {seen['dark']}")
    # The showcase keeps its themed rails.
    page.goto(f"{base}/index.html", wait_until="load")
    fill = page.evaluate("""async () => {
      const {build2dElevation} = await import('/site/showcase/rack.js');
      const svg = await build2dElevation({stack: [], heightRU: 2});
      return svg.querySelector('rect[data-rail]').getAttribute('fill'); }""")
    if fill != "var(--pt-surface-2)":
        bad.append(f"the showcase's rails lost their theme color ({fill})")
    return bad


@extra("rack.html: an In development pill opens a note on what's done and what's coming")
def check_rack_dev_note(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    page.goto(f"{base}/rack.html?probe=1", wait_until="load")
    page.wait_for_function("() => window.__rack && window.__rack.ready", timeout=READY_MS)
    page.evaluate("() => window.__rack.ready")
    if not page.is_visible("#devNote > summary"):
        return bad + ["dev note: no In development pill in the top bar"]
    if (page.text_content("#devNote > summary") or "").strip() != "In development":
        bad.append(f"dev note: the pill reads {page.text_content('#devNote > summary')!r}")
    if page.is_visible("#devNote .rk-devnote-body"):
        bad.append("dev note: the note is open before it is clicked")
    page.click("#devNote > summary")
    body = page.text_content("#devNote .rk-devnote-body") or ""
    for want in ("still being built", "Coming next: cabling."):
        if want not in body:
            bad.append(f"dev note: the note doesn't mention {want!r}")
    if "exports" in body.lower():
        bad.append("dev note: it still lists exports as coming, and they have shipped")
    box = page.evaluate("""() => { const r = document.querySelector('#devNote .rk-devnote-body').getBoundingClientRect();
                              return [Math.round(r.left), Math.round(r.right), innerWidth]; }""")
    if box[0] < 0 or box[1] > box[2]:
        bad.append(f"dev note: the note opens off screen ({box})")
    return bad


# ...AND THE DESKTOP. components.html draws every part at true scale in a card
# capped at 340px, so a line card or a faceplate spilled out of it and the page
# scrolled sideways at every width - 3729px wide at 1280. A drawing wider than
# its card scrolls inside it instead (roc-ops/portrayal-site#53).
@extra("the tool-bar pages have no horizontal scroll at a 1280px viewport")
def check_wide_tool_pages(page, base):
    bad = []
    page.set_viewport_size({"width": 1280, "height": 800})
    for name in NARROW_PAGES:
        page.goto(f"{base}/{name}", wait_until="load")
        page.wait_for_timeout(1500)
        w = page.evaluate("document.documentElement.scrollWidth")
        if w > 1280:
            bad.append(f"{name}: scrollWidth {w} at a 1280px viewport")
    return bad


# THE DRAWING IS THERE ON A PHONE. Explorer and Annotate put the drawing beside
# a 23rem side panel (Annotate adds a second at 28rem), and on a phone the
# panels took the whole row - the stage was 7px wide at 375 and 0 at 360, so
# the one thing both tools are for could not be seen. Below 720px they stack:
# the drawing full width on top, the panels under it (roc-ops/portrayal-site#54).
@extra("Explorer and Annotate show the drawing on a 360px phone")
def check_phone_stage(page, base):
    bad = []
    page.set_viewport_size({"width": 360, "height": 740})
    for name in ["explorer.html", "annotate.html"]:
        page.goto(f"{base}/{name}", wait_until="load")
        try:
            page.wait_for_selector("#stage svg", timeout=15000)
        except Exception:
            bad.append(f"{name}: no drawing in the stage")
            continue
        r = page.evaluate("""() => {
          const st = document.querySelector('#stage').getBoundingClientRect();
          const panels = [...document.querySelectorAll('main > aside')].map(a => {
            const b = a.getBoundingClientRect();
            return {w: Math.round(b.width), h: Math.round(b.height), top: Math.round(b.top)};
          });
          return {w: Math.round(st.width), h: Math.round(st.height), bottom: Math.round(st.bottom),
                  panels, sw: document.documentElement.scrollWidth,
                  sh: document.documentElement.scrollHeight};
        }""")
        if r["w"] < 300 or r["h"] < 150:
            bad.append(f"{name}: at 360x740 the stage is {r['w']}x{r['h']}px - too small to see the drawing")
        for i, p in enumerate(r["panels"]):
            if p["h"] < 80:
                bad.append(f"{name}: side panel {i} is only {p['h']}px tall on a phone")
            if p["top"] < r["bottom"] - 1:
                bad.append(f"{name}: side panel {i} is beside the stage, not under it")
        if r["sw"] > 360 or r["sh"] > 740:
            bad.append(f"{name}: the page scrolls at 360x740 ({r['sw']}x{r['sh']}) - the tool should fit the screen")
    return bad


# ANNOTATE'S DIAGRAM EXPORTS ARE THE DRAWING AS IT STANDS. The point of the two
# buttons is that what was set up here - an optic seated, a lamp lit, a crop -
# reaches draw.io and OmniGraffle with a connection point on every port, and
# not one on a port the crop cut away. Downloads are caught as blobs, not saved.
@extra("Annotate's draw.io and OmniGraffle exports carry the seated optic, the lamp and the crop")
def check_annotate_diagram_exports(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    page.goto(f"{base}/annotate.html", wait_until="load")
    for crop in (None, {"x": 170, "y": 5, "w": 120, "h": 35}):
        page.evaluate("""async crop => {
          const m = await import('/vendor/marks.js');
          location.hash = m.encode({v: 1, device: 's9510-28dc', config: 'dc', view: 'front',
            legend: false, crop, swaps: {'port-0': 'generic/qsfp-cable@1'},
            marks: [{select: '#led-gnss', state: 'antenna-short'}]});
        }""", crop)
        page.reload(wait_until="load")
        page.wait_for_selector("#stage svg [id='port-0-occupant']", state="attached", timeout=20000)
        r = page.evaluate("""async () => {
          const blobs = [];
          const orig = URL.createObjectURL.bind(URL);
          URL.createObjectURL = b => { blobs.push(b); return orig(b); };
          HTMLAnchorElement.prototype.click = function () {};
          // By type: toGraffle rasterises its face through a blob URL of its
          // own, so the first blob after the click is the SVG, not the file.
          const press = async (act, type) => {
            const n = blobs.length;
            document.querySelector(`button[data-act="${act}"]`).click();
            for (let i = 0; i < 100; i++) {
              const hit = blobs.slice(n).find(b => b.type === type);
              if (hit) return hit;
              await new Promise(ok => setTimeout(ok, 100));
            }
          };
          const dio = await press('drawio', 'application/vnd.jgraph.mxfile');
          const og = await press('graffle', 'application/octet-stream');
          if (!dio || !og) return {missing: true, msg: document.querySelector('#expmsg').textContent};
          const x = new DOMParser().parseFromString(await dio.text(), 'text/xml');
          const face = x.querySelector('mxCell[id$="-face"]')?.getAttribute('style') || '';
          const b64 = (face.match(/image=data:image\\/svg\\+xml,([^;]+)/) || [])[1] || '';
          const svg = new TextDecoder().decode(Uint8Array.from(atob(b64), c => c.charCodeAt(0)));
          const zip = new Uint8Array(await og.arrayBuffer());
          return {parses: !x.querySelector('parsererror'),
                  ports: x.querySelectorAll('object[portrayal-path]').length,
                  optic: svg.includes('id="port-0-occupant'), lit: /#eab308/i.test(svg),
                  zip: zip[0] === 0x50 && zip[1] === 0x4b,
                  plist: new TextDecoder().decode(zip).includes('portrayal-path')};
        }""")
        what = "cropped" if crop else "whole"
        if r.get("missing"):
            bad.append(f"annotate ({what}): an export produced no file - {r['msg']}")
            continue
        if not r["parses"]:
            bad.append(f"annotate ({what}): the .drawio is not well-formed XML")
        if not crop and r["ports"] != 36:
            bad.append(f"annotate (whole): {r['ports']} port cells, expected the S9510-28DC's 36")
        if crop and not 0 < r["ports"] < 36:
            bad.append(f"annotate (cropped): {r['ports']} port cells - the crop did not drop the ports it cut away")
        if not r["optic"]:
            bad.append(f"annotate ({what}): the seated optic is not in the draw.io picture")
        if not r["lit"]:
            bad.append(f"annotate ({what}): the GNSS lamp's antenna-short colour is not in the draw.io picture")
        if not (r["zip"] and r["plist"]):
            bad.append(f"annotate ({what}): the .gstencil is not a zip with named port shapes")
    return bad


# OPTICS ARE THEIR OWN SECTION OF THE LIBRARY, AND THEY LAND ON THEIR BORES.
# An optic is no one vendor's module, so the draw.io page offers every one under
# its own checkbox (#78). The generic QSFP LC optic's face starts at -0.325,-1.4,
# and its two port cells sit where the bores are only if the cells are measured
# from that corner (Portrayal #722) - 8.05,4.70 and 20.55,4.70 at 2 px/mm.
# FS is the scope because it was the vendor whose modules a derived namespace
# lost (`fscom` for `fs`), so its cards being offered at all is half the check.
@extra("draw.io: the optics library, with the LC optic's ports on its bores")
def check_drawio_optics_library(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    page.goto(f"{base}/drawio.html?device=fhd-1ube", wait_until="load")
    # NULL-SAFE, AND SAID OUT LOUD WHEN IT IS NULL. A predicate that reads
    # `.textContent` off a missing element throws, and wait_for_function gives
    # up on a throw instead of polling - which failed this check once in a full
    # pass. The checkbox is static markup, so if it never appears the page that
    # was served is not this tree's drawio.html, and the message says that.
    try:
        page.wait_for_function(
            "(document.getElementById('optics-count')?.textContent || '') !== ''", timeout=15000)
    except Exception:
        has = page.evaluate("!!document.getElementById('optics')")
        return bad + ["draw.io optics: " + (
            "the optics count never filled in" if has else
            f"{page.url} has no optics checkbox - is the server serving this tree?")]
    r = page.evaluate("""async () => {
      const $ = id => document.getElementById(id);
      const mods = $('mods-count')?.textContent || '', optics = $('optics-count')?.textContent || '';
      $('optics').checked = true;
      const blobs = [];
      const orig = URL.createObjectURL.bind(URL);
      URL.createObjectURL = b => { blobs.push(b); return orig(b); };
      HTMLAnchorElement.prototype.click = function () {};
      $('dl-lib').click();
      let lib;
      for (let i = 0; i < 300 && !(lib = blobs.find(b => b.type === 'application/xml')); i++)
        await new Promise(ok => setTimeout(ok, 100));
      if (!lib) return {missing: true, stat: $('stat-lib').textContent};
      const xml = await lib.text();
      const entries = JSON.parse(xml.slice(xml.indexOf('<mxlibrary>') + 11, xml.lastIndexOf('</mxlibrary>'))
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
      const lc = entries.find(e => e.title === 'generic/qsfp-lc');
      const cells = lc ? Object.fromEntries([...lc.xml.matchAll(
        /portrayal-path="([^"]+)"[^>]*><mxCell[^>]*><mxGeometry x="([^"]+)" y="([^"]+)"/g)]
        .map(m => [m[1], [+m[2], +m[3]]])) : {};
      return {mods, optics, cells, titles: entries.map(e => e.title)};
    }""")
    if r.get("missing"):
        return bad + [f"draw.io optics: no library was produced - {r['stat']}"]
    if not r["mods"].strip(" ()").isdigit():
        bad.append("draw.io: FS offers no modules - its namespace is derived again, not read from devices.json")
    if not r["optics"].strip(" ()").isdigit():
        bad.append("draw.io: the optics checkbox has no count")
    if "generic/qsfp-lc" not in r["titles"]:
        bad.append("draw.io optics: no generic/qsfp-lc entry in the library")
    for port, want in {"qsfp-lc/tx": [8.05, 4.7], "qsfp-lc/rx": [20.55, 4.7]}.items():
        got = r["cells"].get(port)
        if not got or any(abs(a - b) > 0.01 for a, b in zip(got, want)):
            bad.append(f"draw.io optics: {port} cell at {got}, expected {want} - on the bore")
    return bad


# THREE.JS IS PAID FOR ON THE PRESS, NOT ON THE PAGE. site/mode3d.js imports
# vendor/viewer3d.js on the first press of 3D, and the viewer pulls three.js
# through the import map; a page that never shows 3D must fetch neither.
@extra("Explorer fetches no three.js and no viewer until 3D is pressed")
def check_explorer_three_lazy(page, base):
    bad, asked = [], []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    page.on("request", lambda r: asked.append(r.url))
    page.goto(f"{base}/explorer.html?device=s9510-28dc", wait_until="load")
    page.wait_for_selector("#stage svg", timeout=READY_MS)
    early = [u for u in asked if "/vendor/three/" in u or u.endswith("/vendor/viewer3d.js")]
    if early:
        bad.append(f"explorer: fetched before 3D was pressed: {early[:3]}")
    if webgl_trouble(page):
        print("[check_explorer_three_lazy] no WebGL here - checked the 2D half only")
        return bad
    page.click('#mode [data-mode="3d"]')
    page.wait_for_function("() => document.querySelector('#stage-3d canvas')", timeout=READY_3D_MS)
    if not any(u.endswith("/vendor/viewer3d.js") for u in asked):
        bad.append("explorer: 3D came up without fetching vendor/viewer3d.js")
    return bad


# ANNOTATE IN 3D SHOWS THE DOCUMENT (portrayal-site#46). On the S9510-28DC:
# three marks in three colours, a lamp colour, a lamp state, a mark that
# matches no face, a mark on a rear-only fan while the front is the drawing, a
# click, an optic seated in 3D and a mode round trip - all read back from the
# viewer itself.
@extra("Annotate in 3D: marks, lamps, states, legend, picks, swaps and exports reach the scene")
def check_annotate_3d(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))

    # A NAMED WAIT. A bare Playwright timeout says only that something took 240s;
    # this says which step it was, and the check stops there with what it has.
    class Stop(Exception):
        pass

    def until(expr, what, timeout=READY_MS):
        try:
            page.wait_for_function(expr, timeout=timeout)
        except Exception:
            st = page.evaluate("""() => ({url: location.pathname + location.search,
              on3d: !!document.querySelector('#mode [data-mode="3d"].on'),
              status: document.querySelector('#status')?.textContent || '',
              marks: window.__viewer ? window.__viewer.marks().length : null,
              rows: [...document.querySelectorAll('#rows .mark .sel')].map(e => e.value),
              paths: window.__viewer ? window.__viewer.marks().map(m => m.path) : null})""")
            bad.append(f"annotate 3D: timed out waiting for {what} - {st}")
            raise Stop()

    doc = {"v": 1, "device": "s9510-28dc", "config": "dc", "view": "front", "legend": True,
           "marks": [
               {"select": "[data-path='port-0']", "color": "#e0574f", "label": "uplink"},
               {"select": "[data-path='port-4']", "color": "#2bb3c8"},
               # fan-2 is drawn on the REAR face only (fans 1-5 exhaust at the back):
               # marked while the front is the drawing, it must still reach 3D
               {"select": "[data-path='fan-2']", "color": "#9b5de5", "label": "exhaust fan"},
               {"select": "#led-gnss", "lamp": "#ff00ff"},
               {"select": "[data-path='led-sync']", "state": "synced"},
               # a PSU this device does not have: nothing on any face to place in 3D
               {"select": "[data-path='psu-9']", "color": "#ffd400"},
           ]}
    page.goto(f"{base}/annotate.html?debug=1", wait_until="load")
    page.wait_for_selector("#stage svg", timeout=READY_MS)
    page.evaluate("""async d => { const m = await import('/vendor/marks.js');
                       location.hash = m.encode(d); }""", doc)
    page.reload(wait_until="load")
    page.wait_for_selector("#stage svg [data-path='port-0']", state="attached", timeout=READY_MS)
    if webgl_trouble(page):
        print("[check_annotate_3d] no WebGL here - checking the fallback only")
        page.click('#mode [data-mode="3d"]')
        page.wait_for_function("() => /3D unavailable/.test(document.querySelector('#status')?.textContent || '')"
                               " || !document.querySelector('#stage-3d').hidden", timeout=READY_MS)
        return bad
    try:
        # A PAN AND AN ARMED CROP IN 2D, THEN 3D (final review). The drag guard is
        # the drawing's: a pan before 3D must not stop 3D clicks adding marks. And
        # an armed crop's veil sits over the stage: going to 3D must disarm it.
        sb = page.locator("#stage svg").bounding_box()
        page.mouse.move(sb["x"] + sb["width"] * 0.3, sb["y"] + sb["height"] * 0.5)
        page.mouse.down()
        page.mouse.move(sb["x"] + sb["width"] * 0.45, sb["y"] + sb["height"] * 0.5, steps=8)
        page.mouse.up()
        page.click("#crop")
        page.click('#mode [data-mode="3d"]')
        until("() => window.__viewer && window.__viewer.marks().length >= 3", "the scene's first marks", READY_3D_MS)
        if page.evaluate("() => document.querySelector('#crop').classList.contains('on')"):
            bad.append("annotate 3D: a crop armed in 2D is still armed in 3D, its veil over the scene")
        # SETTLED, NOT JUST STARTED: marks are sent before the build and again on
        # the built scene, and the rows repaint on the viewer's report. Read once the
        # report has found the ports; if it never does, the assertions below say so.
        try:
            page.wait_for_function("""() => { const r = window.__viewer.markReport;
                return r && !['port-0', 'port-4', 'fan-2'].some(p => r.missing.includes(p)); }""", timeout=READY_MS)
        except Exception:
            pass
        page.wait_for_timeout(300)
        r = page.evaluate("""() => { const v = window.__viewer;
          return {marks: v.marks().map(m => [m.path, m.color]).sort(),
                  lamps: v.lampColors(), states: v.states(),
                  legend: [...document.querySelectorAll('#legend3d .row')].map(e => e.textContent.trim()),
                  notIn3d: [...document.querySelectorAll('#rows .mark')].map(r =>
                    /not in 3D/.test(r.querySelector('.notes').textContent)),
                  off: [...document.querySelectorAll('.btns button[data-act]')]
                         .filter(b => b.dataset.act !== 'share').every(b => b.disabled && /2D only/.test(b.title))}; }""")
        got = dict((p, c) for p, c in r["marks"])
        for path, colour in [("port-0", "#e0574f"), ("port-4", "#2bb3c8"), ("fan-2", "#9b5de5")]:
            if got.get(path) != colour:
                bad.append(f"annotate 3D: mark on {path} is {got.get(path)}, expected {colour}")
        if "#ff00ff" not in [c.lower() for c in r["lamps"].values()]:
            bad.append(f"annotate 3D: the lamp colour never reached the viewer - {r['lamps']}")
        if r["states"].get("led-sync") != "state-synced":
            bad.append(f"annotate 3D: led-sync state is {r['states'].get('led-sync')}")
        if r["legend"] != ["uplink", "exhaust fan"]:
            bad.append(f"annotate 3D: legend rows {r['legend']}, expected ['uplink', 'exhaust fan']")
        if r["notIn3d"] != [False, False, False, False, False, True]:
            bad.append(f"annotate 3D: 'not in 3D' flags {r['notIn3d']}")
        if not r["off"]:
            bad.append("annotate 3D: a 2D-only export is enabled, or lacks its '2D only' title")

        # A CLICK IN 3D IS A CLICK (Review Focus 4). select() frames the camera on
        # the part, centred, so a real click at the canvas centre lands on it - the
        # whole path: canvas, the viewer's select event, onPick, Annotate's toggle.
        # AS IN 2D, where the shell turns a click on the selected part into a
        # deselect: the first click selects port-8 and adds its mark, the second
        # clears the selection and keeps the mark, the third takes the mark off.
        n = len(doc["marks"])
        page.evaluate("() => { window.__viewer.select('port-8'); }")
        page.wait_for_timeout(500)
        box = page.locator("#stage-3d canvas").bounding_box()
        cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        page.mouse.click(cx, cy)
        until(f"() => document.querySelectorAll('#rows .mark').length === {n + 1}", "a 3D click to add a mark")
        if not page.evaluate("() => !!document.querySelector(\".node.sel[data-path='port-8']\")"):
            bad.append("annotate 3D: a click on port-8 did not select it in the tree")
        page.mouse.click(cx, cy)
        page.wait_for_timeout(600)
        second = page.evaluate("() => [document.querySelectorAll('#rows .mark').length, !!document.querySelector('.node.sel')]")
        if second != [n + 1, False]:
            bad.append(f"annotate 3D: a second click gave {second} (rows, selected) - 2D gives [{n + 1}, False]: deselect, keep the mark")
        page.mouse.click(cx, cy)
        until(f"() => document.querySelectorAll('#rows .mark').length === {n}", "a third 3D click to take the mark off")

        # AN OPTIC SEATED IN 3D KEEPS EVERY MARK. Through the inspector, as a
        # reader does it: select the cage in the tree, choose the first optic.
        # Click highlights go off for the select - with them on, a click on port-4's
        # row is a click that takes port-4's mark off, which is Annotate's 2D
        # behaviour and not what this step is about.
        page.click("#clickadd")
        page.click(".node[data-path='port-4']")
        page.click("#clickadd")
        page.wait_for_selector("#optic", timeout=READY_MS)
        optic = page.evaluate("() => [...document.querySelectorAll('#optic option')].map(o => o.value).find(Boolean)")
        page.select_option("#optic", optic)
        until("() => window.__viewer.marks().length >= 3", "the marks after seating an optic", READY_3D_MS)
        page.wait_for_timeout(1500)
        after_swap = page.evaluate("() => window.__viewer.marks().map(m => m.path).sort()")
        if not set(got) <= set(after_swap):
            bad.append(f"annotate 3D: seating {optic} in port-4 lost marks {sorted(set(got) - set(after_swap))}")

        # A 3D -> 2D -> 3D round trip leaves the document and the marks as they were.
        # The DOCUMENT too, not only the scene: returning to 2D re-selects what was
        # selected (port-4, from the swap), and a re-selection that counted as a
        # click took port-4's mark off.
        rows = "() => [...document.querySelectorAll('#rows .mark .sel')].map(e => e.value)"
        before_rows = page.evaluate(rows)
        page.click('#mode [data-mode="2d"]')
        page.click('#mode [data-mode="3d"]')
        until("() => window.__viewer.marks().length >= 3", "the marks after a 2D/3D round trip", READY_3D_MS)
        after = page.evaluate("() => window.__viewer.marks().map(m => m.path).sort()")
        if after != after_swap:
            bad.append(f"annotate 3D: a 2D/3D round trip changed the marks {after_swap} -> {after}")
        if page.evaluate(rows) != before_rows:
            bad.append(f"annotate 3D: a 2D/3D round trip changed the document {before_rows} -> {page.evaluate(rows)}")

        # A CONFIGURATION CHANGE IN 3D (final review). The shell refetches the
        # other faces after the load, and the rear-only fan-2 must be marked again
        # once they are back; and the scene is built once, not once per listener.
        page.evaluate("""() => { const v = window.__viewer; window.__loads = 0;
          const l = v.load; v.load = o => { window.__loads++; return l(o); }; }""")
        page.select_option("#cfg", "ac")
        until("() => window.__viewer.info.config === 'ac'", "the scene to load the ac configuration", READY_3D_MS)
        try:
            page.wait_for_function("() => window.__viewer.marks().some(m => m.path === 'fan-2')", timeout=READY_MS)
        except Exception:
            bad.append("annotate 3D: after a configuration change, the rear-only fan-2 is no longer marked")
        page.wait_for_timeout(1500)
        loads = page.evaluate("() => window.__loads")
        if loads != 1:
            bad.append(f"annotate 3D: a configuration change built the scene {loads} times, not once")
        page.select_option("#cfg", "dc")
        until("() => window.__viewer.info.config === 'dc' && window.__viewer.marks().length >= 3",
              "the dc configuration and its marks back", READY_3D_MS)

        # Back in 2D the exports come back with their own titles (Review Focus 5)
        page.click('#mode [data-mode="2d"]')
        back = page.evaluate("""() => [...document.querySelectorAll('.btns button[data-act]')]
          .every(b => !b.disabled && !/2D only/.test(b.title))""")
        if not back:
            bad.append("annotate: back in 2D, an export is still disabled or still titled '2D only'")

        # A share link made in 3D opens in 3D, with its marks
        page.click('#mode [data-mode="3d"]')
        until("() => window.__viewer.marks().length >= 3", "the marks back in 3D before sharing", READY_3D_MS)
        page.click('.btns button[data-act="share"]')
        url = page.input_value('#share')
        if "?mode=3d#" not in url:
            # Reopening a link that does not say 3D opens the drawing, and the waits
            # below would sit out their timeout and throw away everything above.
            return bad + [f"annotate 3D: the share link does not record the mode - {url[:80]}"]
        page.goto(url.replace("?mode=3d", "?mode=3d&debug=1"), wait_until="load")
        until("() => window.__viewer && window.__viewer.marks().length >= 3", "the shared link to open in 3D with its marks", READY_3D_MS)

        # The GLB is the model: as many meshes with the marks as without (needs PR 1 synced).
        # Only once the halos are DRAWN - counted on a scene whose report still says
        # every mark is missing, there are no plates to leak and this passes vacuously.
        until("""() => { const r = window.__viewer.markReport;
            return r && !['port-0', 'fan-2'].some(p => r.missing.includes(p)); }""",
              "the reopened scene to draw its marks", READY_3D_MS)
        meshes = page.evaluate("""async () => { const v = window.__viewer;
          const count = async () => { const b = await v.exportData('glb'), d = new DataView(b);
            return (JSON.parse(new TextDecoder().decode(new Uint8Array(b, 20, d.getUint32(12, true)))).meshes || []).length; };
          const held = v.marks(); const marked = await count();
          v.setMarks([]); const plain = await count(); v.setMarks(held);
          return [marked, plain]; }""")
        if meshes[0] != meshes[1]:
            bad.append(f"annotate 3D: the GLB carries the marks ({meshes[0]} meshes marked, {meshes[1]} plain)")
    except Stop:
        pass
    return bad


# A LOST GRAPHICS CONTEXT SAYS SO (Portrayal #746). The viewer stops drawing when
# the browser takes the WebGL context away, rebuilds when it is handed back, and
# announces both; site/mode3d.js puts that in the status line, so Explorer and
# Annotate both say why the canvas went blank instead of just going blank. The
# context is lost and restored for real, through WEBGL_lose_context.
@extra("3D says when the graphics context is lost, and clears it when it is back")
def check_3d_context_loss(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    page.goto(f"{base}/explorer.html?device=s9510-28dc&debug=1", wait_until="load")
    page.wait_for_selector("#stage svg", timeout=READY_MS)
    if webgl_trouble(page):
        print("[check_3d_context_loss] no WebGL here - nothing to lose")
        return bad
    page.click('#mode [data-mode="3d"]')
    page.wait_for_function("() => window.__viewer && document.querySelector('#stage-3d canvas')", timeout=READY_3D_MS)
    page.wait_for_function("() => document.querySelector('#status').textContent === ''", timeout=READY_3D_MS)
    lost = page.evaluate("""() => { const c = document.querySelector('#stage-3d canvas');
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      const ext = gl && gl.getExtension('WEBGL_lose_context');
      if (!ext) return false; window.__lose = ext; ext.loseContext(); return true; }""")
    if not lost:
        print("[check_3d_context_loss] no WEBGL_lose_context here - not exercised")
        return bad
    try:
        page.wait_for_function("() => /3D paused/.test(document.querySelector('#status').textContent)", timeout=READY_MS)
    except Exception:
        return bad + [f"3D: the context was lost and the status line says {page.text_content('#status')!r}, not '3D paused'"]
    page.evaluate("() => window.__lose.restoreContext()")
    try:
        page.wait_for_function("() => !/3D paused/.test(document.querySelector('#status').textContent)", timeout=READY_3D_MS)
    except Exception:
        bad.append("3D: the context came back and the status line still says '3D paused'")
    return bad


# A LINK CANNOT ASK FOR WHAT THE BUTTON REFUSES (#93). The 3D button is disabled
# below portrayal level 3 - the scene would be a plausible wrong box - and a
# ?mode=3d link to such a device has to be refused the same way, with the reason,
# rather than opening the box the gate exists to prevent. The S9502-12SM has no
# bottom face (level 2); the S9510-28DC has all six.
@extra("a ?mode=3d link to a device that cannot do 3D stays in 2D and says why")
def check_mode_link_respects_gate(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))

    def open_link(device, config):
        page.goto(f"{base}/annotate.html", wait_until="load")
        page.wait_for_selector("#stage svg", timeout=READY_MS)
        enc = page.evaluate("""async d => (await import('/vendor/marks.js')).encode(d)""",
                            {"v": 1, "device": device, "config": config, "view": "front", "marks": []})
        page.goto(f"{base}/annotate.html?mode=3d#{enc}", wait_until="load")
        page.wait_for_function(f"() => document.querySelector('#devpick')?.value === '{device}'"
                               f" || /{device}/.test(document.querySelector('#expmsg')?.textContent || '')"
                               " || /restored/.test(document.querySelector('#expmsg')?.textContent || '')",
                               timeout=READY_MS)
        page.wait_for_timeout(1500)
        return page.evaluate("""() => ({on3d: !!document.querySelector('#mode [data-mode="3d"].on'),
          disabled: document.querySelector('#mode [data-mode="3d"]').disabled,
          shown3d: !document.querySelector('#stage-3d').hidden,
          status: document.querySelector('#status').textContent})""")

    low = open_link("s9502-12sm", "")
    if not low["disabled"]:
        bad.append(f"gate: the 3D button is not disabled for the S9502-12SM - {low}")
    if low["on3d"] or low["shown3d"]:
        bad.append(f"gate: a ?mode=3d link opened 3D on a device below level 3 - {low}")
    if "3D needs" not in low["status"]:
        bad.append(f"gate: the refused link does not say why - status is {low['status']!r}")
    if webgl_trouble(page):
        return bad
    ok = open_link("s9510-28dc", "dc")
    if not ok["on3d"]:
        bad.append(f"gate: a ?mode=3d link to a level 3 device did not open in 3D - {ok}")
    return bad


# AN EXPORT IN FLIGHT KEEPS ITS BUTTONS OFF (#94). The export handler disables
# the bar while it works; the 3D mode repaints which exports are on offer on
# every mode change, from the mode alone - so switching to 3D and back during a
# slow PNG turned the buttons on again under the export, and a second could be
# started beside it. The PNG is made slow here by holding canvas.toBlob.
@extra("Annotate: switching modes during an export leaves the export buttons off")
def check_annotate_export_survives_mode_switch(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    page.goto(f"{base}/annotate.html?device=s9510-28dc", wait_until="load")
    page.wait_for_selector("#stage svg [data-path='port-0']", state="attached", timeout=READY_MS)
    page.evaluate("""() => {
      HTMLAnchorElement.prototype.click = function () {};          // no download
      const toBlob = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function (cb, ...rest) {
        window.__held = true;
        setTimeout(() => { window.__held = false; toBlob.call(this, cb, ...rest); }, 6000);
      };
    }""")
    page.click('.btns button[data-act="png-4"]')
    page.wait_for_function("() => window.__held === true", timeout=READY_MS)
    page.click('#mode [data-mode="3d"]')
    page.click('#mode [data-mode="2d"]')
    page.wait_for_timeout(300)
    r = page.evaluate("""() => ({held: window.__held,
      on: [...document.querySelectorAll('.btns button[data-act]')].filter(b => !b.disabled).map(b => b.dataset.act)})""")
    if not r["held"]:
        return bad + ["export: the held PNG finished before the mode was switched - nothing was tested"]
    if r["on"]:
        bad.append(f"export: with a PNG still in flight, a mode switch re-enabled {r['on']}")
    page.wait_for_function("() => window.__held === false", timeout=READY_MS)
    try:
        page.wait_for_function("""() => [...document.querySelectorAll('.btns button[data-act]')].every(b => !b.disabled)""",
                               timeout=READY_MS)
    except Exception:
        bad.append("export: the buttons did not come back after the export finished")
    return bad


# THE 3D LEGEND'S SWATCH IS THE STATE'S COLOUR (#95). A labelled mark with only
# a state has no ring and no lamp colour; the 2D strip shows the colour that
# state paints, read off the drawing's own stylesheet, and the 3D panel showed
# grey. Compared here against the matched lamp's own computed colour in the
# live drawing - the way marks.js asks.
@extra("Annotate 3D: a state-only mark's legend swatch is the colour its state paints")
def check_annotate_3d_legend_state_colour(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    page.goto(f"{base}/annotate.html?debug=1", wait_until="load")
    page.wait_for_selector("#stage svg", timeout=READY_MS)
    page.evaluate("""async () => { const m = await import('/vendor/marks.js');
      location.hash = m.encode({v: 1, device: 's9510-28dc', config: 'dc', view: 'front', legend: true,
        marks: [{select: "[data-path='led-sync']", state: 'synced', label: 'in sync'}]}); }""")
    page.reload(wait_until="load")
    page.wait_for_selector("#stage svg [data-path='led-sync']", state="attached", timeout=READY_MS)
    if webgl_trouble(page):
        print("[check_annotate_3d_legend_state_colour] no WebGL here - not exercised")
        return bad
    page.click('#mode [data-mode="3d"]')
    try:
        page.wait_for_function("() => document.querySelector('#legend3d .row .sw')", timeout=READY_3D_MS)
    except Exception:
        return bad + ["legend: no row in the 3D legend for a labelled state-only mark"]
    r = page.evaluate("""() => {
      const rgb = c => { const d = document.createElement('i'); d.style.color = c; document.body.append(d);
                         const v = getComputedStyle(d).color; d.remove(); return v; };
      // as marks.js's litColor: the matched part's lamp, with the mark's state on it.
      // (A probe at the root finds nothing: the stylesheet scopes a state's rule
      // to the component that owns the lamp.)
      const el = document.querySelector("#stage svg [data-path='led-sync']");
      const lamp = el.getAttribute('data-class') === 'led' ? el : el.querySelector('[data-class="led"]');
      const want = getComputedStyle(lamp || el).getPropertyValue('--led-color').trim();
      const sw = document.querySelector('#legend3d .row .sw');
      return {want, wantRgb: rgb(want), got: getComputedStyle(sw).borderTopColor, grey: rgb('#8d939a')}; }""")
    if not r["want"]:
        return bad + ["legend: the drawing paints no colour for state-synced - the check has nothing to compare"]
    if r["got"] != r["wantRgb"]:
        bad.append(f"legend: the 3D swatch is {r['got']}, the state paints {r['want']} ({r['wantRgb']})"
                   + (" - it is the fallback grey" if r["got"] == r["grey"] else ""))
    return bad


# THE ROWS READ THE DOCUMENT THEY ARE DRAWN FROM (#96). The 3D notes are indexed
# by a mark's position, and the scene they read was recomputed only inside the
# sync, which awaits. So deleting the first mark drew the remaining rows against
# the old scene, one position out: the mark now first wore the deleted mark's
# "not in 3D" until the sync caught up. Read here in the same tick as the delete.
@extra("Annotate 3D: after a delete, no row wears another mark's 'not in 3D'")
def check_annotate_3d_rows_after_delete(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    page.goto(f"{base}/annotate.html?debug=1", wait_until="load")
    page.wait_for_selector("#stage svg", timeout=READY_MS)
    page.evaluate("""async () => { const m = await import('/vendor/marks.js');
      location.hash = m.encode({v: 1, device: 's9510-28dc', config: 'dc', view: 'front', legend: true,
        marks: [{select: "[data-path='psu-9']", color: '#ffd400', label: 'nowhere'},
                {select: "[data-path='port-0']", color: '#e0574f', label: 'uplink'},
                {select: "[data-path='port-4']", color: '#2bb3c8', label: 'access'}]}); }""")
    page.reload(wait_until="load")
    page.wait_for_selector("#stage svg [data-path='port-0']", state="attached", timeout=READY_MS)
    if webgl_trouble(page):
        print("[check_annotate_3d_rows_after_delete] no WebGL here - not exercised")
        return bad
    page.click('#mode [data-mode="3d"]')
    flags = "[...document.querySelectorAll('#rows .mark')].map(r => /not in 3D/.test(r.querySelector('.notes').textContent))"
    try:
        page.wait_for_function(f"() => JSON.stringify({flags}) === '[true,false,false]'", timeout=READY_3D_MS)
    except Exception:
        return bad + [f"rows: before the delete the flags never settled to [true, false, false] - {page.evaluate('() => ' + flags)}"]
    r = page.evaluate(f"""() => {{
      document.querySelector('#rows .mark .x').click();
      return {{flags: {flags},
               legend: [...document.querySelectorAll('#legend3d .row')].map(e => e.textContent.trim())}}; }}""")
    if r["flags"] != [False, False]:
        bad.append(f"rows: straight after deleting the first mark the 'not in 3D' flags are {r['flags']}, not [False, False]")
    if r["legend"] != ["uplink", "access"]:
        bad.append(f"rows: straight after the delete the 3D legend reads {r['legend']}, not ['uplink', 'access']")
    return bad


# ONE NOTE FOR A SELECTOR THAT NEVER RAN (#97). Invalid CSS is "skipped - bad
# selector"; in 3D the row also said "not in 3D: nothing the scene builds
# matches this mark", which is a statement about a search that was never made.
@extra("Annotate 3D: an invalid selector says 'skipped', and not 'not in 3D' as well")
def check_annotate_3d_bad_selector_note(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    page.goto(f"{base}/annotate.html?debug=1", wait_until="load")
    page.wait_for_selector("#stage svg", timeout=READY_MS)
    page.evaluate("""async () => { const m = await import('/vendor/marks.js');
      location.hash = m.encode({v: 1, device: 's9510-28dc', config: 'dc', view: 'front', legend: true,
        marks: [{select: "[data-path=", color: '#ffd400'},
                {select: "[data-path='psu-9']", color: '#2bb3c8'},
                {select: "[data-path='port-0']", color: '#e0574f'}]}); }""")
    page.reload(wait_until="load")
    page.wait_for_selector("#stage svg [data-path='port-0']", state="attached", timeout=READY_MS)
    if webgl_trouble(page):
        print("[check_annotate_3d_bad_selector_note] no WebGL here - not exercised")
        return bad
    page.click('#mode [data-mode="3d"]')
    notes = "[...document.querySelectorAll('#rows .mark .notes')].map(n => n.textContent.replace(/\\s+/g, ' ').trim())"
    # settled when the row that really is not in 3D (psu-9) says so
    try:
        page.wait_for_function(f"() => /not in 3D/.test({notes}[1] || '')", timeout=READY_3D_MS)
    except Exception:
        return bad + [f"notes: the psu-9 row never said 'not in 3D' - {page.evaluate('() => ' + notes)}"]
    got = page.evaluate("() => " + notes)
    if "skipped" not in got[0]:
        bad.append(f"notes: the invalid selector's row does not say 'skipped' - {got[0]!r}")
    if "not in 3D" in got[0]:
        bad.append(f"notes: the invalid selector's row also says 'not in 3D' - {got[0]!r}")
    if "not in 3D" in got[2]:
        bad.append(f"notes: port-0, which is in the scene, says 'not in 3D' - {got[2]!r}")
    return bad


# THE ADDRESS SAYS WHAT IS ON SCREEN (#98). A page opened from a 3D link keeps
# ?mode=3d in its address after the reader returns to 2D, so a reload - or a
# copy of the address bar - reopened in 3D. The mode is written on every switch:
# present in 3D, absent in 2D, the page's other parameters and its hash kept.
@extra("Annotate: the address carries ?mode=3d in 3D and drops it in 2D")
def check_annotate_mode_in_address(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    page.goto(f"{base}/annotate.html", wait_until="load")
    page.wait_for_selector("#stage svg", timeout=READY_MS)
    enc = page.evaluate("""async () => (await import('/vendor/marks.js')).encode(
      {v: 1, device: 's9510-28dc', config: 'dc', view: 'front',
       marks: [{select: "[data-path='port-0']", color: '#e0574f'}]})""")
    if webgl_trouble(page):
        print("[check_annotate_mode_in_address] no WebGL here - not exercised")
        return bad
    page.goto(f"{base}/annotate.html?mode=3d&debug=1#{enc}", wait_until="load")
    page.wait_for_function("() => !!document.querySelector('#mode [data-mode=\"3d\"].on')", timeout=READY_3D_MS)
    where = "() => ({q: Object.fromEntries(new URLSearchParams(location.search)), hash: location.hash.length})"
    at3d = page.evaluate(where)
    page.click('#mode [data-mode="2d"]')
    page.wait_for_timeout(300)
    at2d = page.evaluate(where)
    if "mode" in at2d["q"]:
        bad.append(f"address: back in 2D the address still says mode={at2d['q']['mode']}")
    if at2d["q"].get("debug") != "1" or at2d["hash"] != at3d["hash"] or not at2d["hash"]:
        bad.append(f"address: switching to 2D lost another parameter or the document - {at3d} -> {at2d}")
    page.click('#mode [data-mode="3d"]')
    page.wait_for_function("() => !!document.querySelector('#mode [data-mode=\"3d\"].on')", timeout=READY_3D_MS)
    page.wait_for_timeout(300)
    again = page.evaluate(where)
    if again["q"].get("mode") != "3d" or again["q"].get("debug") != "1" or again["hash"] != at3d["hash"]:
        bad.append(f"address: back in 3D the address is {again}, not mode=3d with debug=1 and the document")
    return bad


@extra("svg-export.js is the one save/standalone; the showcase re-exports the same functions")
def check_svg_export_leaf(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    page.goto(f"{base}/index.html", wait_until="load")
    r = page.evaluate("""async () => {
      const S = await import('/site/svg-export.js');
      const A = await import('/site/showcase/artifact.js');
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.innerHTML = '<g data-pt-ui="tabindex" tabindex="0"><rect/></g><g data-pt-ui="*"/>';
      document.body.append(svg);
      const text = S.standalone(svg);
      svg.remove();
      return {same: A.save === S.save && A.standalone === S.standalone && A.saveSvg === S.saveSvg,
              stripped: !text.includes('data-pt-ui') && !text.includes('tabindex'),
              prolog: text.startsWith('<?xml')};
    }""")
    for k in ("same", "stripped", "prolog"):
        if not r.get(k):
            bad.append(f"svg-export: {k} is {r.get(k)!r}")
    return bad


@extra("rack.html: Export - the SVG sheet and PNG carry both faces as configured, a title block and notes, no screen UI")
def check_rack_export_sheet(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    open_fixture(page, base)
    root_tag = lambda t: (re.search(r"<svg[^>]*>", t) or [""])[0]

    dl = export_file(page, "sheet-svg")
    if dl.suggested_filename != "Export-test-sheet.svg":
        bad.append(f"sheet: named {dl.suggested_filename!r}")
    text = pathlib.Path(dl.path()).read_text(encoding="utf-8")
    for ref, want in (("asr-9006", 2), ("as7726-32x", 2), ("tm-280", 4)):   # once per face per item
        got = text.count(f'data-device-ref="{ref}"')
        if got != want:
            bad.append(f"sheet: {ref} drawn {got} times, expected {want}")
    for bit in ('data-pane="front"', 'data-pane="rear"', 'data-ref="cisco/a9k-16x100ge-tr@1',
                'data-ref="generic/qsfp-lc@2', ">Export test<", "Four-post frame, 24U, U1 at the bottom",
                "Rail depth 740 mm · usable depth 1000 mm", "Square holes (cage nuts)"):
        if bit not in text:
            bad.append(f"sheet: missing {bit!r}")
    if not re.search(r"Drawn \d{4}-\d{2}-\d{2} with the Portrayal Rack Builder", text):
        bad.append("sheet: no dated title line")
    for ui_bit in ('class="rk-u', "data-pt-ui", "rk-selected", "rk-sel-ring"):
        if ui_bit in text:
            bad.append(f"sheet: screen UI in the file ({ui_bit})")
    root = root_tag(text)
    if ' width="' not in root or ' height="' not in root:
        bad.append(f"sheet: the root <svg> has no width and height ({root[:120]!r})")

    dl = export_file(page, "front-svg")
    front = pathlib.Path(dl.path()).read_text(encoding="utf-8")
    if dl.suggested_filename != "Export-test-front.svg" or 'data-pane="rear"' in front \
            or 'data-pane="front"' not in front:
        bad.append(f"front only: {dl.suggested_filename!r} is not the front face alone")

    dl = export_file(page, "sheet-png")
    png = pathlib.Path(dl.path()).read_bytes()
    if dl.suggested_filename != "Export-test-sheet.png" or png[:8] != b"\x89PNG\r\n\x1a\n":
        bad.append(f"sheet PNG: {dl.suggested_filename!r} is not a PNG")
    else:
        w, h = int.from_bytes(png[16:20], "big"), int.from_bytes(png[20:24], "big")
        if w < 2000 or h < 2000 or len(png) < 50_000:
            bad.append(f"sheet PNG: {w}x{h}, {len(png)} bytes - not the sheet at 2x")

    dl = export_file(page, "json")
    if dl.suggested_filename != "Export-test.rack.json":
        bad.append(f"rack file: named {dl.suggested_filename!r}")

    # A face nobody drew is listed in the sheet's notes block.
    notes_fixture = json.loads(json.dumps(EXPORT_FIXTURE))
    notes_fixture["id"] = "doc-export-notes"
    notes_fixture["racks"][0]["name"] = "Export notes"
    notes_fixture["racks"][0]["items"].append(
        {"id": "i5", "ref": "no-such-device", "cfg": "base", "label": "mystery", "ru": 22, "face": "front",
         "turned": False, "swaps": {}, "fields": {}})
    open_fixture(page, base, notes_fixture)
    text = pathlib.Path(export_file(page, "sheet-svg").path()).read_text(encoding="utf-8")
    for bit in (">Notes<", "mystery at U22: no front drawing, so the front shows an outline.",
                "mystery at U22: no rear drawing, so the rear shows an outline."):
        if bit not in text:
            bad.append(f"sheet notes: missing {bit!r}")
    return bad


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", help="a server already running; otherwise one is started")
    ap.add_argument("--only", help="run only these registered extra checks, by function "
                                   "name, comma-separated - skips the page sweep and the stages")
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
    unexercised = []          # printed on every run, pass or fail: what this runner could not check
    hero_cables = ["hero: the index.html walk never reached the hero's cables"]
    try:
        if not wait_for(f"{base}/index.html"):
            print("check-browser: no server answering at", base, file=sys.stderr)
            return 1
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            CLOCK[0] = time.time()
            only = set(filter(None, (args.only or "").split(",")))
            if only:
                failed_things += run_extra(browser, base, only, problems, notes)
                browser.close()
                for line in notes + problems:
                    print("  " + line)
                return 1 if failed_things else 0
            for name in PAGES:
                page = browser.new_page()
                try:
                    bad = check(page, base, name)
                    if name == "index.html":
                        bad += check_hero(page)
                        hero_cables = check_hero_cables(page)
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
                took(f"{name}")

            if hero_cables:
                failed_things += 1
                problems.append("FAIL  the hero's cables and caption")
                problems += [f"        {b}" for b in dict.fromkeys(hero_cables)]
            else:
                notes.append("ok    the hero's cables and caption")
            took("the hero's cables and caption")

            bad = check_hero_fallbacks(browser, base)
            if bad:
                failed_things += 1
                problems.append("FAIL  the 2D hero stands on its own")
                problems += [f"        {b}" for b in dict.fromkeys(bad)]
            else:
                notes.append("ok    the 2D hero stands on its own")
            took("the 2D hero stands on its own")

            bad, skipped = check_hero_3d(browser, base)
            unexercised += skipped
            if bad:
                failed_things += 1
                problems.append("FAIL  the hero in 3D")
                problems += [f"        {b}" for b in dict.fromkeys(bad)]
            else:
                notes.append("ok    the hero in 3D")
            took("the hero in 3D")

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
            took(f"the stage rail: 7 stages")

            page = browser.new_page()
            try:
                bad = check_rear_loose(page, base)
            finally:
                page.close()
            if bad:
                failed_things += 1
                problems.append(f"FAIL  stage 4: a loose end on the rear is named")
                problems += [f"        {b}" for b in dict.fromkeys(bad)]
            else:
                notes.append(f"ok    stage 4: a loose end on the rear is named")
            took(f"stage 4: a loose end on the rear is named")

            page = browser.new_page()
            try:
                bad = check_schema_coverage(page, base)
            finally:
                page.close()
            if bad:
                failed_things += 1
                problems.append(f"FAIL  schema.html shows every property in the schemas")
                problems += [f"        {b}" for b in dict.fromkeys(bad)]
            else:
                notes.append(f"ok    schema.html shows every property in the schemas")
            took(f"schema.html shows every property in the schemas")

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
            took(f"explorer embed mode")

            failed_things += run_extra(browser, base, None, problems, notes)

            page = browser.new_page()
            try:
                passed, failed = run_marks_harness(page, base)
            finally:
                page.close()
            took("the marks harness")
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

    for u in unexercised:
        print(f"note  {u}")
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
