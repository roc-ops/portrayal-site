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
         "schema.html", "kit.html", "schematic.html", "marks-harness.html",
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
        page.goto(f"{base}/index.html", wait_until="load")
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
    return failed


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
                   and r.get("devices", 0) >= 100,
}

@extra("kit.html: every recipe runs and returns what its section promises")
def check_kit_page(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"kit: uncaught {e}"))
    page.goto(f"{base}/kit.html", wait_until="load")
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
    # a failing recipe stays in its own pane
    page.goto(f"{base}/kit.html?kitfail=1", wait_until="load")
    page.wait_for_selector('figure[data-example="kitfail"][data-error]', timeout=READY_MS)
    txt = page.text_content('figure[data-example="kitfail"] .kit-result') or ""
    if "failed" not in txt: bad.append(f"kit: a failing recipe's pane says {txt!r}")
    page.locator('figure[data-example="01-drawing"]').scroll_into_view_if_needed()
    page.wait_for_selector('figure[data-example="01-drawing"][data-result]', timeout=READY_MS)
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


@extra("draw.io port cells carry portrayal-path, including ports on a seated card")
def check_drawio_port_paths(page, base):
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))
    page.goto(f"{base}/index.html", wait_until="load")
    r = page.evaluate("""async () => {
      const F = await import('/site/rack/face.js');
      const D = await import('/site/drawio.js');
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
    page.goto(f"{base}/index.html", wait_until="load")
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
    page.goto(f"{base}/index.html", wait_until="load")
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
    page.goto(f"{base}/index.html", wait_until="load")
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
      const D = await import('/site/drawio.js');
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

            if hero_cables:
                failed_things += 1
                problems.append("FAIL  the hero's cables and caption")
                problems += [f"        {b}" for b in dict.fromkeys(hero_cables)]
            else:
                notes.append("ok    the hero's cables and caption")

            bad = check_hero_fallbacks(browser, base)
            if bad:
                failed_things += 1
                problems.append("FAIL  the 2D hero stands on its own")
                problems += [f"        {b}" for b in dict.fromkeys(bad)]
            else:
                notes.append("ok    the 2D hero stands on its own")

            bad, skipped = check_hero_3d(browser, base)
            unexercised += skipped
            if bad:
                failed_things += 1
                problems.append("FAIL  the hero in 3D")
                problems += [f"        {b}" for b in dict.fromkeys(bad)]
            else:
                notes.append("ok    the hero in 3D")

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
                bad = check_rear_loose(page, base)
            finally:
                page.close()
            if bad:
                failed_things += 1
                problems.append(f"FAIL  stage 4: a loose end on the rear is named")
                problems += [f"        {b}" for b in dict.fromkeys(bad)]
            else:
                notes.append(f"ok    stage 4: a loose end on the rear is named")

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

            failed_things += run_extra(browser, base, None, problems, notes)

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
