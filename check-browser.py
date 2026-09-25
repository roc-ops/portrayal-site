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


def check_stages(page, base):
    """Walk the stage rail, waiting on each stage's own ready signal."""
    bad = []
    page.on("pageerror", lambda e: bad.append(f"uncaught: {e}"))

    def on_response(r):
        if r.status >= 400 and r.url.startswith(base) and not EXPECTED_404.search(r.url):
            bad.append(f"{r.status} {r.url[len(base):]}")

    page.on("response", on_response)
    page.goto(f"{base}/index.html", wait_until="load")
    for name in STAGES:
        page.click(f'.stage-rail button[data-stage="{name}"]')
        try:
            # Set by the rail only after enter() resolves, so a stage whose
            # enter() throws never sets it and this times out naming the stage
            # rather than passing quietly. 60-second timeout accounts for stages
            # on slow CI runners: stage 4 measured 5-17s on a loaded machine, and
            # a GitHub runner renders WebGL on the CPU.
            page.wait_for_selector(f'[data-stage-ready="{name}"]', timeout=60000)
        except Exception:
            bad.append(f"stage {name} never became ready")
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
