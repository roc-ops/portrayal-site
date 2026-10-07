#!/usr/bin/env python3
"""Run check-browser.py's hero-3D check on its own, with one thing broken.

WHY THIS EXISTS AT ALL. `--only` cannot reach check_hero_3d: it is called from
main() behind `want("hero-3d")` and is not a registered @extra, so

    python3 check-browser.py --only check_hero_3d

exits 0 having run nothing whatsoever - a green answer to a question nobody
asked. The other hand-wired units are the same: check_hero, check_hero_cables,
check_hero_fallbacks, check_stages, check_rear_loose, check_schema_coverage,
check_embed. `--shard i/n` does reach them, but drags the rest of the shard
along (stage-rail alone is weighted 219 s).

So this imports check-browser.py by path, starts serve.py on a free port, and
calls the check directly - handing it a browser whose every new page carries an
init script that breaks ONE thing. That is what makes a timing change provable:
a poll that waits for the right condition is only correct if the assertion
behind it STILL FAILS, with its original wording, when the condition is
genuinely false.

Run from the repo root:  python3 tools/hero-3d-unit.py [scenario ...]
                         python3 tools/hero-3d-unit.py            # all of them
                         python3 tools/hero-3d-unit.py --file OTHER.py healthy

With no scenario it runs them all. Exit 0 means every scenario did what its
table entry says. `--file` takes any copy of check-browser.py, which is how two
versions are compared:

    git show <sha>:check-browser.py > /tmp/old.py
    python3 tools/hero-3d-unit.py --file /tmp/old.py lateZoom

Importing a copy from any path is safe: of every module-level statement in
check-browser.py, only `HERE = Path(__file__).resolve().parent` mentions
__file__, and no HERE-reading helper runs at import time. Only functions that
READ HERE break when relocated - site/showcase/patching.json, assets/dist/,
assets/schemas/, tools/dcim-verify/ - and check_hero_3d reads none of them, it
only drives the browser against `base`.

TWO INJECTIONS THAT LOOK RIGHT AND PROVE NOTHING, learned the hard way:

  1. Do NOT delay global requestAnimationFrame to simulate a slow runner.
     Playwright's own actionability checks use rAF for element stability, so
     both the old and the new code die at `Locator.scroll_into_view_if_needed:
     Timeout 9956ms exceeded` and the comparison says nothing at all. Break the
     value the assertion READS instead (see lateZoom, which stalls distance()).
     `slowFrames` is kept below as the documented dead end: with every frame
     1.5 s apart, even the fixed 800 ms wait passed, because the round trips
     around it had already stretched its real budget past 800 ms. That is why
     these flakes are intermittent rather than deterministic.

  2. A fault whose window is under ~100 ms cannot be discriminated through
     Playwright at all - a poll's first look is itself a CDP round trip. See
     flickerCaption/flickerLate: a caption reverting 30 ms and then 60 ms after
     the pointer reached it was caught whether or not the poll had a floor.

Load matters more than anything here. At a 1-minute load average of 150 these
runs took 529 s and died at `Locator.bounding_box: Timeout 30000ms exceeded`,
measuring a canvas; the same work at load 10-50 is clean in 10-50 s. Gate on
~/.claude/merge-agent/portrayal-site/when-calm.sh, or read the load first.

WHAT THIS EXPECTS OF THE TREE. `lateZoom` is the regression test for the polled
waits, so it FAILS - with "after a click, the wheel did not zoom (689 -> 689)" -
on any tree whose scroll-capture step still sleeps a fixed 800 ms. That is the
tool working, not the tool broken. On such a tree the pause step may also report
"the render loop did not resume on screen" out of nowhere, which is the #114
flake itself; it was seen here on a 12-core Mac at a load average of 31.

TO ADD A SCENARIO: give BEND a `CFG.yourFault` branch that breaks exactly one
observable, then add a SCENARIOS row naming the message that must survive it,
word for word. A row whose message is None asserts a clean run instead.
"""
import argparse
import importlib.util
import json
import pathlib
import subprocess
import sys
import time

HERE = pathlib.Path(__file__).resolve().parent.parent

# ONE INIT SCRIPT, ONE FAULT. Everything the hero's probe hands the check goes
# through a single `window.__hero3d =` assignment, so intercepting that is
# enough to bend what the check reads without touching anything global.
BEND = r"""(() => {
  const CFG = __CFG__;
  let held, hintBuried = false;

  Object.defineProperty(window, '__hero3d', {
    configurable: true,
    get: () => held,
    set: v => {
      held = v;

      // The camera never moves: "after a click, the wheel did not zoom".
      if (CFG.pinDistance) { const d = v.distance(); v.distance = () => d; }

      // The camera creeps on every read, so the step that asserts the wheel
      // did NOT zoom before activation has something to catch.
      if (CFG.driftDistance) { const d0 = v.distance(); let n = 0; v.distance = () => d0 + ++n; }

      // THE FRAME THE DOLLY LANDS ON, LATE - the root cause itself.
      // OrbitControls applies the wheel's scale in the first
      // controls.update() after it, and that runs in the render loop
      // (site/rack3d.js), so until a frame is drawn the camera really is
      // still where it was. That is all this reports, for CFG.lateZoom ms
      // after each wheel. Nothing global is touched, so Playwright's own
      // waits are not starved along with it.
      if (CFG.lateZoom) {
        const real = v.distance.bind(v);
        let stall = 0, frozen = real();
        window.addEventListener('wheel', () => { frozen = real(); stall = Date.now() + CFG.lateZoom; }, true);
        v.distance = () => (Date.now() < stall ? frozen : real());
      }

      // THE DEAD END (see the module docstring): this starves Playwright too.
      // Kept so nobody re-derives it believing it discriminates.
      if (CFG.slowFrames) {
        const ms = CFG.slowFrames;
        window.requestAnimationFrame = cb => setTimeout(() => cb(performance.now()), ms);
      }
    },
  });

  // The hint will not take `hidden`, in one direction or the other.
  if (CFG.hintStuck || CFG.hintGone) {
    const desc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'hidden');
    Object.defineProperty(HTMLElement.prototype, 'hidden', {
      configurable: true,
      get() { return desc.get.call(this); },
      set(v) {
        if (this.hasAttribute && this.hasAttribute('data-hero-hint')) {
          if (CFG.hintStuck) return;                              // never hides
          if (hintBuried) { desc.set.call(this, true); return; }   // never comes back
        }
        desc.set.call(this, v);
      },
    });
  }
  // Armed only AFTER Escape, so the hint is there to begin with, as the step
  // before it expects.
  if (CFG.hintGone) document.addEventListener('keydown',
      e => { if (e.key === 'Escape') hintBuried = true; }, true);

  // The wheel moves no page, or moves it when it must not.
  if (CFG.noPageScroll) window.addEventListener('wheel', e => e.preventDefault(),
                                                {capture: true, passive: false});
  if (CFG.pageScrolls) window.addEventListener('wheel', () => window.scrollBy(0, 7), true);

  // The picking handler never registers, so the caption keeps whatever it had.
  if (CFG.deafPointer) {
    const add = HTMLCanvasElement.prototype.addEventListener;
    HTMLCanvasElement.prototype.addEventListener = function (type, ...rest) {
      if (type === 'pointermove') return;
      return add.call(this, type, ...rest);
    };
  }

  // The caption names the tube and then stops, CFG.flickerCaption ms later,
  // with the pointer still on it.
  if (CFG.flickerCaption) document.addEventListener('pointermove', () => {
    setTimeout(() => {
      const c = document.querySelector('#hero-caption-3d');
      if (c && /port-44/.test(c.textContent)) c.textContent = 'port-67 - reverted by the harness';
    }, CFG.flickerCaption);
  });

  // The caption names port-44 whatever the pointer is over, so a miss cannot
  // restore port-67. Runs after the panel's own pointermove handler.
  if (CFG.captionStuck44) document.addEventListener('pointermove', () => {
    const c = document.querySelector('#hero-caption-3d');
    if (c) c.textContent = 'port-44 pinned by the harness';
  });
})();"""

# name: (what to break, the message that must still appear - word for word, or
#        None to demand a clean run)
SCENARIOS = {
    "healthy": ({}, None),
    "pinDistance": ({"pinDistance": 1},
                    "hero 3D: after a click, the wheel did not zoom"),
    "noPageScroll": ({"noPageScroll": 1},
                     "hero 3D: before activation, the wheel over the panel did not scroll the page"),
    "hintStuck": ({"hintStuck": 1},
                  "hero 3D: the hint is still showing after a click activated the panel"),
    "hintGone": ({"hintGone": 1},
                 "hero 3D: Escape did not let the panel go (no hint back)"),
    "deafPointer": ({"deafPointer": 1},
                    "hero 3D: the pointer on port-44's tube gave"),
    "captionStuck44": ({"captionStuck44": 1},
                       "hero 3D: a miss did not restore port-67"),
    # The two assertions that something did NOT happen. Both are caught through
    # the poll's floor, which is why every converted wait keeps one.
    "driftDistance": ({"driftDistance": 1},
                      "hero 3D: before activation, the wheel zoomed"),
    "pageScrolls": ({"pageScrolls": 1},
                    "hero 3D: after a click, the wheel scrolled the page too"),
    # The root cause: the dolly waiting five seconds for its frame. The fixed
    # 800 ms wait this replaced fails here; the poll passes.
    "lateZoom": ({"lateZoom": 5000}, None),
    # Dead ends, kept documented. slowFrames starves Playwright itself; the two
    # flickers are under the round-trip floor, so neither discriminates.
    "slowFrames": ({"slowFrames": 1500}, None),
    "flickerCaption": ({"flickerCaption": 30},
                       "hero 3D: the pointer on port-44's tube gave"),
    "flickerLate": ({"flickerCaption": 60},
                    "hero 3D: the pointer on port-44's tube gave"),
}


class Bent:
    """The browser the check is handed: every page it opens carries the script.

    A shim rather than a subclass - Playwright's Browser is not ours to extend,
    and the check only ever calls new_page() on it."""

    def __init__(self, browser, cfg):
        self._b = browser
        self._js = BEND.replace("__CFG__", json.dumps(cfg))

    def new_page(self, **kw):
        page = self._b.new_page(**kw)
        page.add_init_script(self._js)
        return page

    def __getattr__(self, name):
        return getattr(self._b, name)


def load(path):
    """check-browser.py by path. Its name is not an identifier, and it is
    guarded by `if __name__ == "__main__"`, so importing it runs nothing."""
    spec = importlib.util.spec_from_file_location("check_browser_under_test", path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


def main():
    ap = argparse.ArgumentParser(description="Run check_hero_3d with one thing broken.")
    ap.add_argument("--file", default=str(HERE / "check-browser.py"),
                    help="the check-browser.py to drive (default: this checkout's)")
    ap.add_argument("--label", default="",
                    help="prefix for each result line, e.g. 'old/' when comparing two versions")
    ap.add_argument("scenarios", nargs="*",
                    help=f"any of: {', '.join(SCENARIOS)} (default: all)")
    args = ap.parse_args()

    names = args.scenarios or list(SCENARIOS)
    for n in names:
        if n not in SCENARIOS:
            raise SystemExit(f"hero-3d-unit: {n!r} is not a scenario - {', '.join(SCENARIOS)}")

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        raise SystemExit("hero-3d-unit: no playwright here\n"
                         "  pip install playwright && playwright install chromium")

    cb = load(args.file)
    port = cb.free_port()
    base = f"http://127.0.0.1:{port}"
    # serve.py from THIS checkout, whatever --file points at: the version under
    # test is the Python, never the site.
    server = subprocess.Popen([sys.executable, str(HERE / "serve.py"), str(port), "--bind", "127.0.0.1"],
                              cwd=str(HERE), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    failed = []
    try:
        if not cb.wait_for(f"{base}/index.html"):
            raise SystemExit(f"hero-3d-unit: no server answering at {base}")
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            cb.CLOCK[0] = time.time()
            try:
                for n in names:
                    cfg, must = SCENARIOS[n]
                    began = time.monotonic()
                    bad, notes = cb.check_hero_3d(Bent(browser, cfg), base)
                    took = time.monotonic() - began
                    ok = (not bad) if must is None else any(must in b for b in bad)
                    said = ("clean" if not bad else f"{len(bad)} problems") if must is None \
                        else f"{'caught' if ok else 'MISSED'}: {must}"
                    print(f"{'PASS' if ok else 'FAIL'}  {args.label + n:<28} {took:6.1f}s  {said}", flush=True)
                    for b in bad:
                        print(f"        {b}", flush=True)
                    for b in notes:
                        print(f"        note: {b}", flush=True)
                    if not ok:
                        failed.append(n)
            finally:
                browser.close()
    finally:
        server.terminate()
        server.wait()

    if failed:
        print(f"hero-3d-unit: {len(failed)} of {len(names)} did not do what the table says: "
              f"{', '.join(failed)}")
        return 1
    print(f"hero-3d-unit: {len(names)} scenarios, all as the table says")
    return 0


if __name__ == "__main__":
    sys.exit(main())
