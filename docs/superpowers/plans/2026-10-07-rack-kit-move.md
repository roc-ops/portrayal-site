# The rack core moves into @portrayal/kit: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the Rack Builder's pure core from `site/rack/` into upstream `kit/rack/`, have upstream build `rack.json`, and make the site vendor both with its behavior unchanged.

**Architecture:** Two repositories and two PRs.
- **Upstream (roc-ops/Portrayal), Tasks 1–5:**
  - a new index, `rack_index.py`, writes `library/dist/rack.json`;
  - the pure modules are copied into `kit/rack/` with their comments in British spelling, and their tests ported to `spec/tests/js/rack-*.mjs` behind one pytest wrapper;
  - the kit goes to 0.3.0.
- **The site (roc-ops/portrayal-site), Tasks 6–8, after upstream lands:**
  - vendors `kit/rack/` and `rack.json`;
  - rewrites every import of a moved module to `vendor/rack/`;
  - deletes its copies;
  - must pass every check with nothing changed except listed sentences.

**Tech Stack:**
- Upstream: Python 3 indexes and pytest; ES modules in `kit/`, with `node --check` and `node --test`.
- Site: vanilla ES modules, `node --test`, and Playwright `check-browser.py`.

**Spec:** `docs/superpowers/specs/2026-10-07-rack-kit-move-design.md` (in the site repo)

## Global Constraints

- **Kit imports:** nothing in `kit/rack/` imports outside `kit/rack/`, except `catalog.js` → `../dist.js`.
- **No browser or IO calls in `kit/rack/`:** no `document`, `window`, `DOMParser`, `localStorage`, and no `fetch` except through `jdist`.
- **3D geometry** takes `THREE` as its first parameter.
- **Spelling (D6):** comments and README prose in `kit/` and upstream docs use British spelling. Identifiers, data keys, file names and user-facing sentences are NOT respelled at the copy step; sentences are handled under D5.
- **The kit's sentence wins (D5):** a sentence a moved module produces stays as written upstream. Every one that reads differently on the site is listed in the site PR.
- **Kit version** `0.3.0`. New exports only; nothing removed.
- **`rack.json`:** `format: 1`, with content key-for-key what `chassis-index.py` writes today.
- **The site's behavior must not change.** The full `check-browser.py` must pass with no expectation changed except the D5 sentences.
- **Order:**
  - Task 1 and Tasks 2–3 may start now.
  - Task 4 waits for the Refactor agent's command-core PR to land on the site.
  - Task 6 waits for the upstream PR to land.
- **Work in worktrees, never in the live trees:**
  - Upstream: `/Volumes/External/Network-Device-Visualization` is a live tree others use. Create a worktree for branch `claude/rack-kit-move`.
  - Site: work in this session's worktree.
- **Landing:**
  - Upstream PRs are landed by Portrayal's merge agent: check its session name with ListAgents (the "PR Merger" session is likely).
  - Site PRs are landed by the "Portrayal-site merge agent".
  - Never push `main`, and never use `--no-verify`. At high load, use `sh ~/.claude/merge-agent/portrayal-site/when-calm.sh git push ...`.
- **Commits** end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A user-facing sentence silently respelled** during the comment pass, e.g. a refusal reason "color" becoming "colour" in code. Only comments may change in Tasks 2–4. Covered by the comment-only check in Task 2.
2. **`rack.json` differing from `chassis.json`** for any device. Covered by the byte-equivalence test in Task 1 and the site comparison in Task 6.
3. **A site import still pointing at a deleted `site/rack/` module**, in a file only the browser loads (the page, a panel, a check's in-page `import()`). Covered by the grep gate in Task 7.
4. **`check-browser.py` in-page `import('/site/rack/<moved>.js')` calls.** They must move to `/vendor/rack/`. Covered in Task 7.
5. **The kit's `catalog.js` resolving `rack.json` against the wrong base** when the site serves `assets/dist/`. Covered by the page load in Task 7 and its browser checks.

---

## Part A: upstream (roc-ops/Portrayal)

### Task 1: `rack.json`, built upstream

**Files (upstream):**
- Create: `spec/tools/portrayal/rack_index.py`
- Create: `spec/tests/test_rack_index.py`
- Modify: `build.sh` (after the index loop's waits)
- Modify: `docs/format-stability.md`; add a changelog fragment the way upstream's changelog-fragment docs say (read `CHANGELOG.md` and the fragments directory first)

**Interfaces:**
- Produces: `library/dist/rack.json`. Its shape is `{"format": 1, "generated-from": str, "devices": {name: {...}}}`, with the per-device keys as `chassis-index.py` writes them. Python: `rack_index.build(dist: Path) -> dict` and `rack_index.marked(svg: Path) -> (guides, passes)`.

- [ ] **Step 1: Create the upstream worktree.**

```bash
cd /Volumes/External/Network-Device-Visualization && git fetch origin && git worktree add .claude/worktrees/rack-kit-move -b claude/rack-kit-move origin/main
cd .claude/worktrees/rack-kit-move
```

All Part A work happens in that worktree. Read `CONTRIBUTING.md` (or the README's contributing section) and follow its branch, test and commit conventions.

- [ ] **Step 2: Write the failing tests.** Create `spec/tests/test_rack_index.py`:

```python
"""rack.json, the rack catalogue the kit's rack/catalog.js reads: every
device's rack units, depth, mount, shell, stated cable capacity, and the ids a
cable route can pass through, per view of its default configuration."""
import json
from pathlib import Path

import pytest

from portrayal import rack_index

FACE = """<svg xmlns="http://www.w3.org/2000/svg">
  <g id="guide-1" data-guide="ring" data-ref="fs/d-ring-snap-in@1:1.1.0"/>
  <rect id="guide-2-end" data-kind="ring"/>
  <rect id="guide--duct" data-class="guide"/>
  <path id="pass--window-1" data-class="pass"/>
  <g id="guide-3" data-group="guides" data-ref="fs/cmh-4drb1u-ring@1:1.1.0"/>
  <g id="port-1" data-group="ports" data-ref="x"/>
</svg>"""


def test_marked_reads_every_way_a_pathway_is_drawn(tmp_path):
    p = tmp_path / "face.svg"
    p.write_text(FACE)
    assert rack_index.marked(p) == (["duct", "guide-1", "guide-2", "guide-3"], ["window-1"])


def test_marked_on_a_missing_face_is_empty(tmp_path):
    assert rack_index.marked(tmp_path / "nope.svg") == ([], [])


def _dist(tmp_path, chassis, attrs=None, faces=None):
    (tmp_path / "devices.json").write_text(json.dumps({"devices": [
        {"name": "mgr", "manufacturer": "FS.com", "model": "FHD-CMP5DR"}]}))
    (tmp_path / "mgr.configs.json").write_text(json.dumps({
        "chassis": chassis, "default": "base", "configs": [{"name": "base"}], "attrs": attrs or {}}))
    for view, text in (faces or {}).items():
        (tmp_path / f"mgr.base.{view}.svg").write_text(text)
    return tmp_path


def test_a_rack_face_sheet_with_a_capacity(tmp_path):
    d = _dist(tmp_path, {"w": 483, "h": 44, "d": 110, "ru": 1, "mount": "rack-face", "shell": "sheet"},
              {"performance": {"cable-capacity": 30, "cable-capacity-basis": "Cat6"}}, {"front": FACE})
    e = rack_index.build(d)["devices"]["mgr"]
    assert e["mount"] == "rack-face" and e["shell"] == "sheet" and e["ru"] == 1 and e["d"] == 110
    assert e["capacity"] == {"count": 30, "basis": "Cat6"}
    assert e["guides"] == {"front": ["duct", "guide-1", "guide-2", "guide-3"]}
    assert e["passes"] == {"front": ["window-1"]}


def test_a_rack_device_states_no_mount_and_derives_its_units(tmp_path):
    e = rack_index.build(_dist(tmp_path, {"w": 440, "h": 88.9, "d": 300, "mount": "rack"}))["devices"]["mgr"]
    assert "mount" not in e and "shell" not in e and "capacity" not in e and e["ru"] == 2


def test_the_file_states_its_format(tmp_path):
    assert rack_index.build(_dist(tmp_path, {"h": 44}))["format"] == 1
```

Run `python3 -m pytest spec/tests/test_rack_index.py -q`. Expected: FAIL (`ModuleNotFoundError` or `ImportError`). Check how other tests import `portrayal`, e.g. `spec/tests/test_brush_and_passes.py`, and match it.

- [ ] **Step 3: Implement `spec/tools/portrayal/rack_index.py`.** Port the site's `chassis-index.py` exactly. The site file is at `/Volumes/External/portrayal-site/chassis-index.py` on main; read it there or with `git -C /Volumes/External/portrayal-site show origin/main:chassis-index.py`.

```python
#!/usr/bin/env python3
"""The rack catalogue: rack.json, beside devices.json in the build.

What a rack tool needs of every device without opening it: its rack units,
depth, how it mounts, whether its body is sheet, the cable capacity its vendor
states, and the ids a cable route can pass through on each view of its default
configuration. The kit's rack/catalog.js reads it through `dist`, so a rack is
checked against the same numbers wherever it is built.

Run by build.sh after the compiled faces and the indexes it reads exist.

    rack_index.py --dist library/dist
"""
import argparse
import json
import xml.etree.ElementTree as ET
from pathlib import Path

RU = 44.45
FORMAT = 1


def marked(path):
    """The ids a route can pass through on one compiled face, as a route names
    them: a ring component carrying `data-guide`, or a component instance in the
    `guides` group, is its own id (`guide-1`); a ring's end on a front or rear
    view, `<id>-end` with `data-kind="ring"`, stands for the same ring; a duct
    rect `guide--<id>` is `<id>`; a pass-through `pass--<id>` is `<id>`."""
    if not Path(path).is_file():
        return [], []
    root = ET.parse(path).getroot()
    guides, passes = set(), set()
    for e in root.iter():
        i = e.get("id") or ""
        if not i:
            continue
        if e.get("data-class") == "pass" and i.startswith("pass--"):
            passes.add(i[len("pass--"):])
        elif e.get("data-class") == "guide" and i.startswith("guide--"):
            guides.add(i[len("guide--"):])
        elif e.get("data-kind") == "ring" and i.endswith("-end"):
            guides.add(i[:-len("-end")])
        elif e.get("data-guide") or (e.get("data-group") == "guides" and e.get("data-ref")):
            guides.add(i)
    return sorted(guides), sorted(passes)


def build(dist):
    dist = Path(dist)
    devices = json.loads((dist / "devices.json").read_text())["devices"]
    out = {}
    for d in sorted(devices, key=lambda d: d["name"]):
        p = dist / f"{d['name']}.configs.json"
        if not p.is_file():
            continue
        idx = json.loads(p.read_text())
        c = idx.get("chassis") or {}
        # a stated 0 (a zero-U part's face) is a height, not a missing one
        h = c.get("h") if c.get("h") is not None else RU
        entry = {
            "manufacturer": d.get("manufacturer"),
            "model": d.get("model") or d["name"],
            "family": (d.get("portfolio") or {}).get("family"),
            # chassis.ru when stated - 0 included, a zero-U part - else from the height
            "ru": c["ru"] if c.get("ru") is not None else max(1, round(h / RU)),
            "h": h, "w": c.get("w"), "d": c.get("d"), "airflow": c.get("airflow"),
            "default": idx.get("default"),
            "configs": [x["name"] for x in idx.get("configs", [])],
        }
        # only what a device has, so the file barely grows
        if c.get("mount") and c["mount"] != "rack":
            entry["mount"] = c["mount"]
        if c.get("shell"):
            entry["shell"] = c["shell"]
        perf = (idx.get("attrs") or {}).get("performance") or {}
        if perf.get("cable-capacity") is not None:
            entry["capacity"] = {"count": perf["cable-capacity"], "basis": perf.get("cable-capacity-basis", "")}
        for view in ("top", "front", "rear"):
            g, ps = marked(dist / f"{d['name']}.{idx.get('default')}.{view}.svg")
            if g:
                entry.setdefault("guides", {})[view] = g
            if ps:
                entry.setdefault("passes", {})[view] = ps
        out[d["name"]] = entry
    return {"format": FORMAT,
            "generated-from": "devices.json and <name>.configs.json, by rack_index.py",
            "devices": out}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dist", required=True)
    a = ap.parse_args()
    data = build(a.dist)
    (Path(a.dist) / "rack.json").write_text(json.dumps(data, indent=1, sort_keys=True) + "\n")
    print(f"rack_index: {len(data['devices'])} devices -> {a.dist}/rack.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Run it in `build.sh`.** After the index loop's per-pid waits (search `for ix in devices_index`, then the loop that waits on `pids`), add:

```bash
# THE RACK CATALOGUE reads devices.json and the compiled faces, so it runs
# after both exist: rack.json, which the kit's rack/catalog.js loads.
python3 spec/tools/portrayal/rack_index.py --dist "$OUT"
```

Check that `$OUT` is the dist directory in `build.sh`. Also check whether `publish.sh` or a manifest lists the files `dist` ships, and add `rack.json` there if so (grep `labs.json` across the repo for the places a dist file is named).

- [ ] **Step 5: Run the tests, then the build.**

```bash
python3 -m pytest spec/tests/test_rack_index.py -q
uptime
./build.sh
python3 -c "import json;d=json.load(open('library/dist/rack.json'));print(d['format'], len(d['devices']), d['devices']['fhd-cmp5dr'])"
```

Expected: PASS, a build without errors, and an FHD-CMP5DR entry with `mount`, `shell`, `capacity` and `guides`.

- [ ] **Step 6: Equivalence with the site.** Compare against the site's `chassis.json` for the same build. The site's re-pull is at #127, so differences come only from devices upstream changed since then.

```bash
python3 - <<'EOF'
import json
a = json.load(open('library/dist/rack.json'))['devices']
b = json.load(open('/Volumes/External/portrayal-site/site/rack/chassis.json'))['devices']
shared = sorted(set(a) & set(b))
diff = [n for n in shared if a[n] != b[n]]
print(len(shared), 'shared;', len(diff), 'differ:', diff[:20])
EOF
```

For every differing device, confirm the difference comes from an upstream change after the site's snapshot (e.g. #868's CMH ring guide), not from the port. Record the list in the report.

- [ ] **Step 7: Document the file.** In `docs/format-stability.md`, add a section on `rack.json` beside the labs file: its keys, `format: 1`, and that removing or renaming a key is a contract change. Write it in British spelling. Add a changelog fragment.

- [ ] **Step 8: Full upstream checks and commit.**

```bash
python3 -m pytest spec/tests -q -x
git add spec/tools/portrayal/rack_index.py spec/tests/test_rack_index.py build.sh docs/format-stability.md <fragment>
git commit -m "rack_index: rack.json, the rack catalogue the kit's rack modules read

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The pure core in `kit/rack/`, with its tests

**Files (upstream):**
- Create: `kit/rack/rails.js`, `model.js`, `fit.js`, `managers.js`, `cable-rules.js`, `route-path.js`, `route.js`, copied from the site's `site/rack/` on `origin/main`
- Create: `spec/tests/js/rack-rails.mjs`, `rack-model.mjs`, `rack-fit.mjs`, `rack-managers.mjs`, `rack-cables.mjs`, `rack-routed2d.mjs`, `rack-route.mjs`, ported from the site's `tests/rack/{rails,model,fit,managers,cables,routed2d,route}.test.mjs`
- Create: `spec/tests/test_rack_kit_js.py`, one pytest wrapper for every `rack-*.mjs`
- Create: `spec/tools/portrayal/comment_spelling.py` (the D6 check)

**Interfaces:**
- Produces: the modules with the same exports as the site's copies. In addition, `fit.js` exports `isRackMount`, moved from `export-data.js`.

- [ ] **Step 1: Copy the modules from the site's main.**

```bash
S=/Volumes/External/portrayal-site
mkdir -p kit/rack
for m in rails model fit managers cable-rules route-path route; do
  git -C $S show origin/main:site/rack/$m.js > kit/rack/$m.js
done
grep -n "from '" kit/rack/*.js
```

Every import must now be `./<module>.js` within `kit/rack/`. The one exception: `fit.js` imports `isRackMount` from `./export-data.js`, which is not in `kit/rack/` until Task 3. Move it now. Cut `isRackMount` (the definition and its comment) out of the copy, add it to `kit/rack/fit.js` beside `isRackFace`, and remove the import:

```js
// NOT RACK-MOUNT. The catalogue states `mount` only when it is not "rack".
export const isRackMount = chassis => !chassis?.mount || chassis.mount === 'rack';
```

Task 3's `export-data.js` then imports it from `./fit.js`.

- [ ] **Step 2: The comment-spelling check (D6).** Create `spec/tools/portrayal/comment_spelling.py`. It reports American spellings in **comments only**: `//` lines, `/* */` blocks and `#` comments in Python. It never looks at code or strings. It runs over `kit/rack/`.

```python
#!/usr/bin/env python3
"""American spellings in the COMMENTS of the kit's rack modules - prose there is
the project's own, and the project writes British. Code, identifiers, data keys
and strings are not looked at: renaming those would break their callers.

    comment_spelling.py kit/rack            exit 1 and list each finding
"""
import re
import sys
from pathlib import Path

WORDS = {
    "color": "colour", "colors": "colours", "colored": "coloured", "center": "centre",
    "centered": "centred", "centers": "centres", "meter": "metre", "meters": "metres",
    "millimeter": "millimetre", "millimeters": "millimetres", "behavior": "behaviour",
    "gray": "grey", "favor": "favour", "neighbor": "neighbour", "neighbors": "neighbours",
    "catalog": "catalogue", "analyze": "analyse", "organize": "organise", "recognize": "recognise",
    "fiber": "fibre", "labeled": "labelled", "modeled": "modelled", "canceled": "cancelled",
}
WORD = re.compile(r"\b(" + "|".join(WORDS) + r")\b", re.I)


def comments(text):
    """(line number, comment text) for every comment in a JS source."""
    out, block = [], False
    for n, line in enumerate(text.splitlines(), 1):
        if block:
            end = line.find("*/")
            out.append((n, line if end < 0 else line[:end]))
            block = end < 0
            continue
        # a // or /* outside a string: good enough for these files, whose
        # strings hold no comment markers - checked by the test
        m = re.search(r"(?<![:'\"`])//(.*)$", line)
        if m:
            out.append((n, m.group(1)))
        s = line.find("/*")
        if s >= 0 and not m:
            end = line.find("*/", s + 2)
            out.append((n, line[s + 2:] if end < 0 else line[s + 2:end]))
            block = end < 0
    return out


def findings(root):
    for p in sorted(Path(root).rglob("*.js")):
        for n, c in comments(p.read_text()):
            for w in WORD.findall(c):
                yield f"{p}:{n}: {w} -> {WORDS[w.lower()]}"


if __name__ == "__main__":
    bad = list(findings(sys.argv[1] if len(sys.argv) > 1 else "kit/rack"))
    print("\n".join(bad) or "comment spelling: clean")
    sys.exit(1 if bad else 0)
```

Some words stay American because they quote an identifier (e.g. a comment naming `colorOf`, `COLORS`, or a data key `"color"`). Keep those, and wrap the identifier in backticks in the comment. Then make the checker skip words inside backticks: strip `` `...` `` spans from the comment text before matching. Add that, with a test.

- [ ] **Step 3: Respell the comments.** Run `python3 spec/tools/portrayal/comment_spelling.py kit/rack` and fix every finding by editing **comments only**. Then prove no code changed: the copy step is the only change to code, so a comment-stripped diff against the site's copy must be empty, apart from `fit.js`'s moved `isRackMount` and the import lines.

```bash
for m in rails model fit managers cable-rules route-path route; do
  diff <(git -C /Volumes/External/portrayal-site show origin/main:site/rack/$m.js | sed -E 's#//.*$##' | grep -v '^\s*$') \
       <(sed -E 's#//.*$##' kit/rack/$m.js | grep -v '^\s*$') | grep -v "isRackMount\|^---\|^[0-9]" | head
done
```

Expected: no output except the `isRackMount` lines. Block comments (`/* */`) also need checking. If a module uses them, compare with a stripper that handles them (`node -e` with a small regex), and say how in the report.

- [ ] **Step 4: Port the tests.** For each site test, copy it into `spec/tests/js/rack-<name>.mjs` and change its imports. `../../site/rack/X.js` becomes `../../../kit/rack/X.js`, and any `isRackMount` import from `export-data.js` comes from `fit.js`. Keep every assertion. They stay `node:test` files.

```bash
for t in rails model fit managers cables routed2d route; do
  git -C /Volumes/External/portrayal-site show origin/main:tests/rack/$t.test.mjs \
    | sed "s#'../../site/rack/#'../../../kit/rack/#g" > spec/tests/js/rack-$t.mjs
done
grep -n "site/" spec/tests/js/rack-*.mjs
```

Expected: no `site/` references left. If a test imports a module that moves in Task 3 (e.g. `cables.test.mjs` importing `export-data.js`), defer that test file to Task 3 and say so.

- [ ] **Step 5: The pytest wrapper.** Create `spec/tests/test_rack_kit_js.py`:

```python
"""The kit's rack modules, by their own node tests (spec/tests/js/rack-*.mjs):
the rack file, fit rules, cable managers, cables, routes and the export rules,
moved from portrayal-site with their tests."""
import shutil
import subprocess
from pathlib import Path

import pytest

JS = Path(__file__).resolve().parent / "js"
FILES = sorted(JS.glob("rack-*.mjs"))


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
@pytest.mark.parametrize("path", FILES, ids=[p.stem for p in FILES])
def test_rack_module(path):
    p = subprocess.run(["node", "--test", str(path)], capture_output=True, text=True, cwd=str(JS))
    assert p.returncode == 0, p.stdout[-4000:] + p.stderr[-2000:]


def test_rack_tests_exist():
    assert FILES, "no spec/tests/js/rack-*.mjs found"
```

Add a test for the checker in `spec/tests/test_comment_spelling.py`: one comment with "color" fails, "`colorOf`" in backticks passes, and a string `'color'` is not looked at.

- [ ] **Step 6: Run and commit.**

```bash
python3 -m pytest spec/tests/test_rack_kit_js.py spec/tests/test_comment_spelling.py -q
python3 spec/tools/portrayal/comment_spelling.py kit/rack
git add kit/rack spec/tests/js/rack-*.mjs spec/tests/test_rack_kit_js.py spec/tools/portrayal/comment_spelling.py spec/tests/test_comment_spelling.py
git commit -m "kit/rack: the rack file, fit rules, managers, cable rules and routes, from portrayal-site

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Export rules, cable geometry and the catalogue loader

**Files (upstream):**
- Create: `kit/rack/export-data.js`, `kit/rack/dcim-rules.js` (copied), `kit/rack/cable-geometry.js` (split from the site's `cables.js`), `kit/rack/catalog.js` (new; replaces the site's `chassis.js`)
- Create: `spec/tests/js/rack-export-data.mjs`, `rack-bom.mjs`, `rack-export-cables.mjs`, `rack-dcim.mjs`, `rack-dcim-import.mjs`, `rack-cable-media.mjs`, `rack-imports.mjs`, `rack-catalog.mjs`, plus any test deferred from Task 2

**Interfaces:**
- Produces:
  - `catalog.js`: `loadCatalog(dist) -> Promise<{chassisOf, entries, devices}>`; `chassisLookup(devices)`; `catalogEntries(devices)`. `dist` is a base URL string, or a function from a path in the build to its URL, as `kit/dist.js`'s `flatDist`/`packageDist` give.
  - `cable-geometry.js`: `COLORS`, `colorOf`, `JACKETS`, `colorOfJacket`, `PLUGS`, `plugColorOf`, `WIDTH`, `TAG_H`, `sag2d`, `LEAD`, `LEAD_DROP`, `hangPoints3d`, `routePoints3d`, `danglePoints3d`, `clearOf`, plus any helper those use (e.g. `startOf`, `mergeOf`, `hangBetween`, `reaches`, `cat`, `sag3d`). Exported only if the site's drawing half needs them.

- [ ] **Step 1: Copy export-data and dcim-rules.** Copy them from the site's main. In `export-data.js`, delete the `isRackMount` definition and `import {isRackMount} from './fit.js';`. Keep the export name working for callers by re-exporting it: `export {isRackMount} from './fit.js';`. Check every import resolves within `kit/rack/`.

- [ ] **Step 2: Split `cable-geometry.js` out of the site's `cables.js`.** Read the site's `site/rack/cables.js` on main. Move into `kit/rack/cable-geometry.js` every declaration that touches no DOM, `relief.js` or `svgEl`: the colour, jacket and plug tables and functions; `WIDTH`, `TAG_H`, `sag2d`, `LEAD`, `LEAD_DROP`; the 3D catenary helpers; `hangPoints3d`, `routePoints3d`, `danglePoints3d`; `clearOf`. List what moved and what stayed in the report. Task 7 makes the site's `cables.js` import these from the kit and keep its drawing functions. `cable-geometry.js` imports `./rails.js` and `./route-path.js` if those are needed.

- [ ] **Step 3: `catalog.js`.** Read `kit/dist.js` for `jdist`, and for how `flatDist`/`packageDist` express a dist (a base URL, or a function from a path to a URL). Then write:

```js
// THE RACK CATALOGUE (rack.json, written by rack_index.py beside devices.json):
// every device's rack units, depth, mount, shell, stated cable capacity and the
// ids a cable route can pass through. Loaded once per page through `dist`, the
// same build every other kit module reads.

import {jdist} from '../dist.js';

const urlOf = (dist, path) => (typeof dist === 'function' ? dist(path) : `${String(dist).replace(/\/$/, '')}/${path}`);

export const chassisLookup = devices => ref => devices[ref] || null;

const cmp = (a, b) => String(a ?? '').localeCompare(String(b ?? ''));
export const catalogEntries = devices => Object.entries(devices)
  .map(([name, e]) => ({name, ...e}))
  .sort((a, b) => cmp(a.manufacturer, b.manufacturer) || cmp(a.model, b.model));

export async function loadCatalog(dist) {
  const j = await jdist(urlOf(dist, 'rack.json'));
  if (j?.format !== 1) throw new Error(`rack.json: format ${j?.format}; this kit reads format 1`);
  const devices = j.devices || {};
  return {chassisOf: chassisLookup(devices), entries: catalogEntries(devices), devices};
}
```

Check how `packageDist` names files: if it maps a path like `devices.json` to an index-package URL, make sure `rack.json` goes into that package, or document that `loadCatalog` needs a flat dist. Record the decision in the README (Task 4).

Write `spec/tests/js/rack-catalog.mjs`. Stub `globalThis.location` and `globalThis.fetch` as `spec/tests/js/cable-points.mjs` does. Assert:
- `loadCatalog('/d')` fetches `/d/rack.json`;
- a function dist is called with `'rack.json'`;
- the format check refuses `format: 2` with that sentence;
- entries are sorted by manufacturer, then model.

- [ ] **Step 4: Port the tests.** Copy the site's `tests/rack/{export-data,bom,export-cables,dcim,dcim-import,cable-media,imports}.test.mjs` to `spec/tests/js/rack-*.mjs`, with imports rewritten as in Task 2.

`dcim-import.test.mjs` reads the site's vendored type files under `assets/exports/`. Point it at upstream's own export tree, after finding where `library/exports/...` lives in the worktree. If a fixture path differs, change only the path, never an assertion.

`import_cables_test.py` is a Python test of the site's `tools/` script and stays in the site.

- [ ] **Step 5: Spelling, tests, commit.**

```bash
python3 spec/tools/portrayal/comment_spelling.py kit/rack
python3 -m pytest spec/tests/test_rack_kit_js.py -q
git add kit/rack spec/tests/js/rack-*.mjs
git commit -m "kit/rack: export and DCIM rules, cable geometry and the rack catalogue loader

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The command core, the schema, and the kit's 0.3.0

**Blocked until the Refactor agent's command-core PR has landed on portrayal-site `main`.** Its description lists the exact modules and exports. Read it first: `gh pr list -R roc-ops/portrayal-site --state merged --search "command core"`, or ask the "Refactor agent" for the number.

**Files (upstream):**
- Create: `kit/rack/{validate,commands,history,editor,queries}.js` and any other pure module that PR lists, copied from the site's main; `spec/schemas/rack.schema.json`; their tests as `spec/tests/js/rack-*.mjs`; `spec/tests/test_rack_schema.py`
- Modify: `kit/package.json`, `kit/README.md`, `docs/format-stability.md` (the schema list), and wherever upstream registers a published schema (grep `lab.schema.json` across the repo to find every place)

**Interfaces:**
- Produces: kit `0.3.0`. Its `exports` add `./rack/<module>` for every `kit/rack/*.js`, and `files` adds `rack/*.js`. `rack.schema.json` is published at `https://portrayal.dev/schemas/v1/rack.schema.json`.

- [ ] **Step 1: Copy the PR's pure modules and their tests** exactly as in Task 2: Steps 1, 3 and 4 (comments only respelled; imports to `./`; tests ported). If a module imports one that stays in the site, stop and report it. The split assumed they are pure.

- [ ] **Step 2: The schema.** Copy `site/rack/rack.schema.json` (or wherever that PR put it) to `spec/schemas/rack.schema.json`. Set `$id` to `https://portrayal.dev/schemas/v1/rack.schema.json`, matching the other schemas' `$id` form. Register it everywhere `lab.schema.json` is registered. Add `spec/tests/test_rack_schema.py`, which:
  - validates every rack fixture the site ships (copy them into `spec/tests/fixtures/racks/`: `tools/dcim-verify/acceptance.rack.json`, and the fixture dicts in the site's `check-browser.py`, saved as JSON);
  - refuses a rack with a manager whose `unit` is 0.

- [ ] **Step 3: `kit/package.json`.** Set `"version": "0.3.0"`. Add one export per rack module, for example:

```json
"./rack/model": "./rack/model.js",
"./rack/catalog": "./rack/catalog.js"
```

Add `"rack/*.js"` to `files`. Append `&& for f in rack/*.js; do node --check $f || exit 1; done` to `scripts.test`. Run `cd kit && npm test`.

- [ ] **Step 4: README "Racks".** Add a section to `kit/README.md`, in British spelling, covering:
  - what the rack modules are, one line each;
  - the catalogue (`loadCatalog(dist)`, and what `rack.json` holds);
  - a runnable example: load the catalogue, `newDoc`, `withItem` a switch, place an FHD-CMP5DR on it via `placement`, `withCable` between two ports, `resolveRoute` and `routedLength` with a ctx (explain that a ctx comes from the drawings, and a plain one is enough for lanes), then `bomRows` and `cableScheduleRows`;
  - the schema link.

Check the example runs as a node script with the same `location`/`fetch` stubs. Put it in `spec/tests/js/rack-readme-example.mjs` so it stays true.

- [ ] **Step 5: Changelog fragment and commit.**

```bash
cd kit && npm test && cd ..
python3 -m pytest spec/tests/test_rack_kit_js.py spec/tests/test_rack_schema.py -q
git add kit spec/schemas/rack.schema.json spec/tests docs <fragment>
git commit -m "kit 0.3.0: the rack command core and the rack file schema

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Upstream verification and the PR

- [ ] **Step 1: The whole upstream suite and build.**

```bash
uptime
./build.sh && python3 -m pytest spec/tests -q && (cd kit && npm test)
python3 spec/tools/portrayal/lint.py --schemas spec/schemas --library library   # as build.sh calls it; copy its flags
```

Expected: all pass. A failure in an area these tasks didn't touch: report it with the output, and don't patch around it.

- [ ] **Step 2: Push and open the upstream PR.**

```bash
git push -u origin claude/rack-kit-move
gh pr create -R roc-ops/Portrayal --base main --head claude/rack-kit-move \
  --title "kit 0.3.0: the rack core (kit/rack/) and rack.json, from portrayal-site" --body-file <body>
```

The body covers:
- what moved, as the module table;
- `rack.json` and its contract;
- the comment-spelling check;
- the tests: the ported files, kept assertion-for-assertion;
- that the site will vendor this in a following PR.

End it with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

- [ ] **Step 3: Hand over.** Use ListAgents to find Portrayal's merge agent and message it with the PR number. Do not merge it yourself. Tell the "Refactor agent" the PR number too.

---

## Part B: the site (roc-ops/portrayal-site), after the upstream PR lands

### Task 6: Vendor `kit/rack/` and `rack.json`

**Files (site):**
- Modify: `refresh-assets.sh` (the kit loop near `for f in "$KIT"/*.js`, around lines 114 and 482)
- Regenerated: `vendor/rack/*.js`, `assets/dist/rack.json`, and the rest of the snapshot

- [ ] **Step 1: Branch from the site's main** in this session's worktree: `git fetch origin && git switch -c claude/rack-kit-vendor origin/main`.

- [ ] **Step 2: Vendor the subfolder.** In `refresh-assets.sh`, find every loop over `"$KIT"/*.js`: the copy loop and the completeness check near line 482. Extend each to `"$KIT"/rack/*.js` into `vendor/rack/`. Create the folder with `mkdir -p "$HERE/vendor/rack"`. Check that `rack.json` arrives with the rest of `dist`, i.e. whether the script copies `dist/*.json` wholesale or by name. Add it if by name.

- [ ] **Step 3: Re-pull.**

```bash
uptime
cd /Volumes/External/portrayal-upstream && git checkout main && git pull && ./build.sh && cd -
./refresh-assets.sh
ls vendor/rack/ && python3 -c "import json;print(json.load(open('assets/dist/rack.json'))['format'])"
```

- [ ] **Step 4: Compare `rack.json` with the site's `chassis.json`** (Review Focus 2). Run `./chassis-index.py` once more on the new snapshot, then compare it with `assets/dist/rack.json` (`devices` only). They must be identical. Any difference is a porting bug in Task 1: stop and report it.

- [ ] **Step 5: Commit** the snapshot and `refresh-assets.sh`. The site still uses its own copies at this point, so every check must still pass:

```bash
node --test tests/*/*.test.mjs && python3 check-contract.py
git add refresh-assets.sh vendor assets
git commit -m "sync: Portrayal main with kit 0.3.0 - kit/rack vendored, rack.json

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The site imports the kit, and its copies go

**Files (site):**
- Delete: `site/rack/{rails,model,fit,managers,cable-rules,route-path,route,export-data,dcim-rules,chassis}.js`, the command-core modules Task 4 moved, `chassis-index.py`, `site/rack/chassis.json`
- Modify: every file importing them; `site/rack/cables.js` (keeps only drawing, imports `cable-geometry.js`); `site/rack-page.js` (`loadCatalog`); `check-browser.py` (in-page `import('/site/rack/…')`); `check-contract.py`; `refresh-assets.sh` (stop running `chassis-index.py`)

**Interfaces:**
- Consumes: `vendor/rack/*.js` (Task 6), `assets/dist/rack.json`.

- [ ] **Step 1: Rewrite imports.** For each moved module `M`:

```bash
MOVED="rails model fit managers cable-rules route-path route export-data dcim-rules validate commands history editor queries"
for m in $MOVED; do
  grep -rl "from './$m.js'\|from \"./$m.js\"" site/rack | xargs -r sed -i '' "s#from './$m.js'#from '../../vendor/rack/$m.js'#g"
  grep -rl "from './rack/$m.js'" site | xargs -r sed -i '' "s#from './rack/$m.js'#from '../vendor/rack/$m.js'#g"
done
```

Adjust the relative depth per file. `site/rack/*.js` uses `../../vendor/rack/`, and `site/*.js` uses `../vendor/rack/`. Check with `node --check` on each changed file. Imports of `isRackMount` from `export-data.js` keep working through its re-export. Adjust the `MOVED` list to Task 4's real module names.

- [ ] **Step 2: `cables.js` keeps only drawing.** Delete the declarations that moved into `cable-geometry.js` (Task 3, Step 2's list) and import them from `../../vendor/rack/cable-geometry.js`. Re-export the ones other site files import from `./cables.js` (grep `from './cables.js'` and `from './rack/cables.js'`, and `site/showcase/cables.js`, which re-exports it), so those imports keep working.

- [ ] **Step 3: The catalogue.** Replace `loadChassis`/`chassisLookup`/`catalogEntries` from `./rack/chassis.js` in `site/rack-page.js`, and every other caller (`grep -rn "chassis.js\|loadChassis" site`), with `loadCatalog` from the kit. Pass the site's dist base (`assets/dist`; read `site/faces.js` for the base the site uses). Then delete `site/rack/chassis.js`, `site/rack/chassis.json` and `chassis-index.py`, and remove `chassis-index.py` from `refresh-assets.sh`.

- [ ] **Step 4: Delete the moved copies and their tests.**

```bash
for m in $MOVED; do git rm -q site/rack/$m.js; done
git rm -q tests/rack/{rails,model,fit,managers,cables,routed2d,route,export-data,bom,export-cables,dcim,dcim-import,cable-media,imports}.test.mjs
```

Keep `tests/rack/route-context.test.mjs` (route-context stays) and `tests/rack/import_cables_test.py`. Point their imports at `vendor/rack/` where they import a moved module. Also delete the command-core tests Task 4 ported, and keep any test of a module that stayed.

- [ ] **Step 5: The grep gate (Review Focus 3, 4).** Nothing may still name a deleted file:

```bash
for m in $MOVED chassis; do
  grep -rn "site/rack/$m.js\|rack/$m.js'\|'./$m.js'" site check-browser.py check-contract.py tests tools \
    | grep -v vendor/rack
done
```

Expected: no output. `check-browser.py`'s in-page `import('/site/rack/model.js')` and the like become `import('/vendor/rack/model.js')`.

- [ ] **Step 6: `check-contract.py`.**
  - Replace every `chassis.json` check with the same facts read from `assets/dist/rack.json`. Also check `format == 1`.
  - Add a check that `vendor/rack/` holds exactly the kit's `rack/*.js`. Compare the file list with the upstream clone, as the existing vendor checks do (read how `vendor/*.js` is checked).
  - Add a check that no `site/rack/*.js` exports a name that any `vendor/rack/*.js` exports, **apart from deliberate re-exports**. Allow a `export {...} from '../../vendor/rack/...'` line, and reject a function or const redefined.

- [ ] **Step 7: Run and commit.**

```bash
node --test tests/*/*.test.mjs && python3 check-contract.py
uptime
python3 check-browser.py --only check_rack_page,check_rack_library,check_rack_face_managers,check_rack_cable_routes
git add -A site tests check-browser.py check-contract.py refresh-assets.sh chassis-index.py
git commit -m "rack: the core is the kit's - imports from vendor/rack, the site's copies and chassis-index.py go

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Sentences, the full pass, and the site PR

- [ ] **Step 1: List the sentences that changed (D5).** Task 2 changed comments only, so no sentence should have changed. Prove it: diff every string literal in each vendored `vendor/rack/*.js` against the same module on the site's `main` before this branch (`git show origin/main:site/rack/<m>.js`).

```bash
for m in $(ls vendor/rack | sed 's/\.js$//'); do
  f=$(git show origin/main:site/rack/$m.js 2>/dev/null) || continue
  diff <(printf '%s' "$f" | grep -o "'[^']*'\|\`[^\`]*\`\|\"[^\"]*\"" | sort -u) \
       <(grep -o "'[^']*'\|\`[^\`]*\`\|\"[^\"]*\"" vendor/rack/$m.js | sort -u) | sed "s#^#$m: #"
done
```

Expected: no differences, apart from strings in the moved `isRackMount` or `catalog.js`. Record the output in the PR as the D5 list.

- [ ] **Step 2: The full pass.**

```bash
uptime
node --test tests/*/*.test.mjs && python3 check-contract.py && python3 check-browser.py
```

Expected: all pass, with **no expectation changed** (spec §8). A failing check means behavior changed: diagnose it, and fix the code, not the check, unless it is a D5 sentence.

- [ ] **Step 3: Review, push, PR.** After the final whole-branch review:
  - push with `when-calm.sh` (no `--no-verify`);
  - open the site PR (the module list, the D5 list, the deleted files, the checks run);
  - message the "Portrayal-site merge agent" and the "Refactor agent" with the number.

  Once it lands, update the spec status lines, and the memories `rack-builder-into-kit` and `rack-kit-split`, saying piece 2 is done.
