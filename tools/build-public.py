#!/usr/bin/env python3
"""Assemble public/, the folder portrayal.dev serves (wrangler.jsonc).

The repository root is not publishable as-is: it carries prototypes, harness
pages, check scripts and design docs beside the site. This copies only what the
public site is, from TRACKED files only - an untracked render sitting in
assets/exports/ on one machine must not ship from that machine and not from CI.

    tools/build-public.py            build public/ (replacing it)
    tools/build-public.py --out DIR  build somewhere else
    tools/build-public.py --list     print "served-path<TAB>source-path", build nothing
    tools/build-public.py --print P  print P, a file the build generates (sitemap.xml, index.md)

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
  - generated from PAGES, so a page added or removed there is added or
    removed with it: sitemap.xml, and each page's Markdown copy (index.md
    beside index.html, tools/page_markdown.py) that worker/index.mjs answers
    with when a request asks for text/markdown. --list names this script as
    their source.
coming-soon/ itself stays in the repo, whole, as the rollback: point
wrangler.jsonc back at it.
"""
import os
import shutil
import subprocess
import sys
from pathlib import Path
from xml.sax.saxutils import escape

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE / "tools"))
from page_markdown import markdown, page_url  # noqa: E402

PAGES = ["index.html", "explorer.html", "rack.html", "components.html", "annotate.html",
         "exporter.html", "drawio.html", "drawings.html", "schema.html", "lint.html", "kit.html",
         "kit-frame.html", "contribute.html", "components/catalog.html"]
DIRS = ["site", "brand", "assets", "vendor"]
SHARED = ["404.html", "_redirects", "favicon.svg", "portrayal-mark.svg", "media"]   # from coming-soon/
ONLY_FULL = ["_headers", "robots.txt", "schemas"]                                    # from publish/

# Pages served but not listed in the sitemap, and given no Markdown copy:
# kit-frame.html only hosts a kit recipe inside kit.html's iframe, and is not a
# page to land on.
NOT_LISTED = {"kit-frame.html"}
LISTED = [p for p in PAGES if p not in NOT_LISTED]


def sitemap():
    """sitemap.xml (sitemaps.org protocol). No <lastmod>: the deploy checks out
    at depth 1, so git cannot say when each page last changed."""
    urls = "".join(f"  <url><loc>{escape(page_url(p))}</loc></url>\n"
                   for p in LISTED)
    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
            f"{urls}</urlset>\n")


# Served path -> what writes it.
GENERATED = {"sitemap.xml": sitemap,
             **{p[:-len(".html")] + ".md": (lambda p=p: markdown(p, (HERE / p).read_text()))
                for p in LISTED}}


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
    if "--print" in argv:
        print(GENERATED[argv[argv.index("--print") + 1]](), end="")
        return
    if "--list" in argv:
        rows = {**m, **{dest: "tools/build-public.py" for dest in GENERATED}}
        for dest, src in sorted(rows.items()):
            print(f"{dest}\t{src}")
        return
    out = Path(argv[argv.index("--out") + 1]) if "--out" in argv else HERE / "public"
    if out.exists():
        shutil.rmtree(out)
    for dest, src in m.items():
        target = out / dest
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(HERE / src, target)
    for dest, make in GENERATED.items():
        (out / dest).write_text(make())
    print(f"{out}: {len(m) + len(GENERATED)} files")


if __name__ == "__main__":
    main(sys.argv[1:])
