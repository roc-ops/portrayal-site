#!/usr/bin/env python3
"""Work out how many seconds each unit of check-browser.py takes on CI, from
the logs of green `checks` runs, and print - or write - the SECONDS table that
check-browser.py deals its shards by.

WHY THIS EXISTS. check-browser.py cuts its pass into shards balanced by a table
of seconds per unit (see THE SHARDS there). That table was once read off one
unsharded run by hand, and by hand it went stale: units were added, a few grew
to a minute and a half, and a shard that the table called level ran past its 20
minutes. A stale number costs balance, never coverage - but balance is what
keeps a job inside its timeout. So the table is measured, by this script, from
what the jobs themselves printed, and regenerating it is one command.

    python3 tools/shard-weights.py RUN [RUN ...]          # print the table
    python3 tools/shard-weights.py --write RUN [RUN ...]  # rewrite it in check-browser.py

RUN is the id of a green `checks` run (the number in its URL). For each one the
script asks `gh` for the run's jobs, takes the "browser (i of n)" ones, fetches
each job's log, and reads the line check-browser.py's took() prints the moment a
unit ends:

      9.3s  load  1.59  browser   327 MB  free  6228 MB  drawings.html

The label on the end is turned back into a unit name: a page of PAGES is its own
file name, an @extra is the name of its function (EXTRA_CHECKS holds the pair),
and the blocks main() wires in by hand are FIXED below, by the label main()
prints for them. "the hero's cables and caption" is the second half of the
index.html unit, so its seconds are added to the page's.

TWO CORRECTIONS, both about the first unit of a job. check-browser.py resets its
clock when the browser has launched, so launch is not in the first unit - but
the first page a fresh browser opens is still about 11 s slower than the same
page later (20.7 s against 9.3 s for the page next to it), the server's and the
browser's caches being cold. That is the job's cost, not the unit's, and a unit
that happens to be first in its shard would otherwise be weighed 11 s too heavy.
So a unit's first-of-job sample is dropped when the unit was measured anywhere
else (another run dealt it elsewhere); and when every sample of it was a first,
FIRST_UNIT_EXTRA is taken off instead.

The weight of a unit is the MEDIAN of its samples, not the mean: runners differ
by a third from one run to the next and one slow runner should not move a
weight. Several runs make the median steadier; one run is enough to be useful.

Units not seen in any log are left out of the table and weigh DEFAULT_SECONDS in
check-browser.py. The table lists only units of LISTED_FROM seconds or more -
the many small ones need no line, and a new check needs none until it is slow.
"""
import argparse
import importlib.util
import json
import pathlib
import re
import statistics
import subprocess
import sys

REPO = "roc-ops/portrayal-site"
HERE = pathlib.Path(__file__).resolve().parent.parent
BEGIN, END = "# SECONDS: begin", "# SECONDS: end"
FIRST_UNIT_EXTRA = 11.0
LISTED_FROM = 4.0

# The units main() wires in by hand, by the label it prints for each. The same
# list is in check-browser.py as FIXED_UNITS, which names the units; these are
# the labels, which the file does not keep in one place.
FIXED_LABELS = {
    "the stage rail: 7 stages": "stage-rail",
    "the hero in 3D": "hero-3d",
    "the 2D hero stands on its own": "hero-2d",
    "stage 4: a loose end on the rear is named": "rear-loose",
    "schema.html shows every property in the schemas": "schema-coverage",
    "explorer embed mode": "embed",
    "the marks harness": "marks-harness",
    "the hero's cables and caption": "index.html",
}

TOOK = re.compile(r"^\s*(\d+(?:\.\d+)?)s\s+load\s+\S+(?:\s+browser\s+\d+ MB\s+free\s+\d+ MB)?\s+(.+?)\s*$")
SHARD = re.compile(r"^shard \d+/\d+: ")
STAMP = re.compile(r"^\d{4}-\d\d-\d\dT[\d:.]+Z ")


def load_check_browser():
    """check-browser.py as a module, for PAGES and EXTRA_CHECKS. Its name has a
    hyphen, so it cannot be imported; nothing at its top level starts a browser."""
    spec = importlib.util.spec_from_file_location("check_browser", HERE / "check-browser.py")
    mod = importlib.util.module_from_spec(spec)
    saved, sys.argv = sys.argv, ["check-browser.py"]
    try:
        spec.loader.exec_module(mod)
    finally:
        sys.argv = saved
    return mod


def gh(*args):
    r = subprocess.run(["gh", "api", *args], capture_output=True, text=True)
    if r.returncode:
        raise SystemExit(f"shard-weights: gh api {' '.join(args)} failed: {r.stderr.strip()}")
    return r.stdout


def browser_logs(run):
    """The log text of every "browser (i of n)" job of a run."""
    jobs = json.loads(gh(f"repos/{REPO}/actions/runs/{run}/jobs?per_page=100"))["jobs"]
    mine = [j for j in jobs if j["name"].startswith("browser (")]
    if not mine:
        raise SystemExit(f"shard-weights: run {run} has no 'browser (i of n)' job")
    for j in mine:
        if j["conclusion"] != "success":
            raise SystemExit(f"shard-weights: run {run}, {j['name']} ended {j['conclusion']}: "
                             "weights are read from green runs only")
    return [(j["name"], gh(f"repos/{REPO}/actions/jobs/{j['id']}/logs")) for j in mine]


def samples_of(log):
    """[(label, seconds, first_of_job)] in the order a job's took() printed them."""
    out, first = [], False
    for raw in log.splitlines():
        line = STAMP.sub("", raw)
        if SHARD.match(line):
            first = True
            continue
        m = TOOK.match(line)
        if m:
            out.append((m.group(2), float(m.group(1)), first))
            first = False
    return out


def label_map(cb):
    labels = dict(FIXED_LABELS)
    labels.update({p: p for p in cb.PAGES})
    labels.update({label: fn.__name__ for label, fn in cb.EXTRA_CHECKS})
    return labels


def unit_of(labels, label):
    if label in labels:
        return labels[label]
    for full, unit in labels.items():     # a label may arrive cut short
        if len(label) >= 60 and full.startswith(label):
            return unit
    return None


def measure(runs, cb):
    labels = label_map(cb)
    firsts, others, unknown = {}, {}, set()
    for run in runs:
        for _, log in browser_logs(run):
            # a unit may print twice in a job (index.html: the page, then its cables)
            per_job = {}
            for label, secs, first in samples_of(log):
                unit = unit_of(labels, label)
                if unit is None:
                    unknown.add(label)
                    continue
                s, f = per_job.get(unit, (0.0, False))
                per_job[unit] = (s + secs, f or first)
            for unit, (secs, first) in per_job.items():
                (firsts if first else others).setdefault(unit, []).append(secs)
    medians = {}
    for unit in set(firsts) | set(others):
        if others.get(unit):
            medians[unit] = statistics.median(others[unit])
        else:
            medians[unit] = max(0.0, statistics.median(firsts[unit]) - FIRST_UNIT_EXTRA)
    return medians, unknown


def table(medians, runs, cb):
    listed = sorted(((u, s) for u, s in medians.items() if s >= LISTED_FROM), key=lambda x: (-x[1], x[0]))
    rest = [s for u, s in medians.items() if s < LISTED_FROM]
    lines = [BEGIN,
             f"# Medians over the browser jobs of green checks runs {', '.join(map(str, runs))}, from",
             "# tools/shard-weights.py; units under %g s are left to DEFAULT_SECONDS." % LISTED_FROM,
             "# (The %d smaller measured units took %.0f s between them.)" % (len(rest), sum(rest)),
             "SECONDS = {"]
    for u, s in listed:
        lines.append(f'    "{u}": {round(s) if s >= 10 else round(s, 1)},')
    lines += ["}", END]
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("runs", nargs="+", type=int, help="ids of green `checks` runs")
    ap.add_argument("--write", action="store_true", help="rewrite the table between the "
                    f"'{BEGIN}' and '{END}' lines of check-browser.py instead of printing it")
    args = ap.parse_args()
    cb = load_check_browser()
    medians, unknown = measure(args.runs, cb)
    for label in sorted(unknown):
        print(f"shard-weights: no unit for the label {label[:100]!r}", file=sys.stderr)
    missing = [u for u in cb.units() if u not in medians]
    print(f"shard-weights: {len(medians)} of {len(cb.units())} units measured; "
          f"{len(missing)} left at DEFAULT_SECONDS", file=sys.stderr)
    new = table(medians, args.runs, cb)
    if not args.write:
        print(new)
        return 0
    path = HERE / "check-browser.py"
    text = path.read_text()
    pat = re.compile(re.escape(BEGIN) + r".*?" + re.escape(END), re.S)
    if len(pat.findall(text)) != 1:
        raise SystemExit(f"shard-weights: check-browser.py needs exactly one '{BEGIN}' ... '{END}' block")
    path.write_text(pat.sub(lambda _: new, text))
    print(f"shard-weights: wrote {path}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
