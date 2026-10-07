#!/usr/bin/env python3
"""Assemble public/, the folder portrayal.dev serves (wrangler.jsonc).

The repository root is not publishable as-is: it carries prototypes, harness
pages, check scripts and design docs beside the site. This copies only what the
public site is, from TRACKED files only - an untracked render sitting in
assets/exports/ on one machine must not ship from that machine and not from CI.

    tools/build-public.py            build public/ (replacing it)
    tools/build-public.py --out DIR  build somewhere else
    tools/build-public.py --list     print "served-path<TAB>source-path", build nothing

--list is what check-contract.py reads, so the contract checks what will be
served without copying ~6,600 files to do it.

WHAT IS SERVED:
  - PAGES, the public pages, and DIRS, what they load;
  - from coming-soon/, the files the teaser and the full site share: the 404
    page, the old-path redirects, the root favicon and mark the 404 page uses,
    and media/, whose URLs are permanent (the Portrayal README links the video,
    roc-ops/portrayal-site#61). One copy, so a recapture updates both;
  - from publish/, what only the full site has: its _headers, its robots.txt,
    and the JSON schemas at the URLs their $ids name (tools/publish-schemas.sh).
coming-soon/ itself stays in the repo, whole, as the rollback: point
wrangler.jsonc back at it.
"""
import os
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent

PAGES = ["index.html", "explorer.html", "rack.html", "components.html", "annotate.html",
         "exporter.html", "drawio.html", "drawings.html", "schema.html", "kit.html",
         "kit-frame.html", "contribute.html"]
DIRS = ["site", "brand", "assets", "vendor"]
SHARED = ["404.html", "_redirects", "favicon.svg", "portrayal-mark.svg", "media"]   # from coming-soon/
ONLY_FULL = ["_headers", "robots.txt", "schemas"]                                    # from publish/


def tracked(*paths):
    out = subprocess.run(["git", "-C", str(HERE), "ls-files", "-z", "--", *paths],
                         check=True, capture_output=True).stdout
    return [p for p in out.decode().split("\0") if p]


def manifest():
    """Every served path and the tracked file it comes from."""
    m = {}
    for p in tracked(*PAGES, *DIRS):
        m[p] = p
    for base, names in (("coming-soon", SHARED), ("publish", ONLY_FULL)):
        for p in tracked(*[f"{base}/{n}" for n in names]):
            m[p[len(base) + 1:]] = p
    missing = [p for p in PAGES if p not in m]
    if missing:
        sys.exit(f"not built - these pages are not tracked: {missing}")
    return m


def main(argv):
    m = manifest()
    if "--list" in argv:
        for dest, src in sorted(m.items()):
            print(f"{dest}\t{src}")
        return
    out = Path(argv[argv.index("--out") + 1]) if "--out" in argv else HERE / "public"
    if out.exists():
        shutil.rmtree(out)
    for dest, src in m.items():
        target = out / dest
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(HERE / src, target)
    print(f"{out}: {len(m)} files")


if __name__ == "__main__":
    main(sys.argv[1:])
