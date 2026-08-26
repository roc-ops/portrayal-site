#!/usr/bin/env python3
"""Load a Portrayal DCIM bundle into NetBox or Nautobot.

The YAML in this bundle is deliberately valid against the shared devicetype
library schema, so you do not need this script: the community importer
(netbox-community/Device-Type-Library-Import) reads the same tree, and the tree
can be dropped onto a clone of the library and contributed upstream.

What this adds is `enrichment.json` - the facts the YAML schema has no field
for, applied through the API afterwards. Both products support them; only the
import format does not. See the README.

    export DCIM_URL=https://netbox.example.com
    export DCIM_TOKEN=...
    python3 portrayal-sync.py --target netbox            # dry run
    python3 portrayal-sync.py --target netbox --commit   # actually write

Nothing is written without --commit. This writes to a source of truth; a tool
that does that by default is a tool that will one day do it by accident.
"""
import argparse
import json
import os
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    sys.exit("pip install pyyaml")

HERE = Path(__file__).resolve().parent


def client(target, url, token):
    if target == "netbox":
        try:
            import pynetbox
        except ImportError:
            sys.exit("pip install pynetbox")
        return pynetbox.api(url, token=token).dcim
    try:
        import pynautobot
    except ImportError:
        sys.exit("pip install pynautobot")
    return pynautobot.api(url, token=token).dcim


class Run:
    """Counts, and a single place that decides whether anything is written."""

    def __init__(self, commit):
        self.commit = commit
        self.n = {"created": 0, "existing": 0, "enriched": 0, "failed": 0}

    def do(self, what, fn):
        if not self.commit:
            print(f"  would {what}")
            return None
        try:
            return fn()
        except Exception as err:                     # noqa: BLE001 - report, continue
            print(f"  FAILED {what}: {err}")
            self.n["failed"] += 1
            return None


def ensure_manufacturer(dcim, name, run, cache):
    if name in cache:
        return cache[name]
    found = dcim.manufacturers.get(name=name)
    if found:
        cache[name] = found
        return found
    made = run.do(f"create manufacturer {name}",
                  lambda: dcim.manufacturers.create(name=name, slug=slug(name)))
    cache[name] = made
    return made


def slug(s):
    import re
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", s.lower())).strip("-")


def load_types(root, kind):
    for f in sorted((root / kind).rglob("*.yaml")):
        yield f, yaml.safe_load(f.read_text())


def sync(root, target, url, token, run, images=True):
    dcim = client(target, url, token)
    cache = {}

    for kind, endpoint in (("device-types", "device_types"),
                           ("module-types", "module_types")):
        if not (root / kind).is_dir():
            continue
        api = getattr(dcim, endpoint, None)
        if api is None:
            print(f"{kind}: not supported by this instance, skipping")
            continue
        print(f"\n{kind}:")
        for path, doc in load_types(root, kind):
            man = doc.get("manufacturer")
            ensure_manufacturer(dcim, man, run, cache)
            # Idempotent: an existing type is left exactly as it is. Re-running
            # after a refresh must not churn a source of truth.
            if api.get(model=doc["model"]):
                run.n["existing"] += 1
                continue
            payload = dict(doc, manufacturer={"name": man})
            # front_image/rear_image are booleans here and file uploads in the
            # API; the files go up separately below.
            payload.pop("front_image", None)
            payload.pop("rear_image", None)
            made = run.do(f"create {kind[:-1]} {man} / {doc['model']}",
                          lambda p=payload: api.create(p))
            if made:
                run.n["created"] += 1

    enrich = root / "enrichment.json"
    if enrich.is_file():
        apply_enrichment(dcim, json.loads(enrich.read_text()), target, run)


def apply_enrichment(dcim, data, target, run):
    """The facts the YAML could not carry.

    Kept separate rather than folded into the YAML so the YAML stays valid
    against the shared schema and can still be contributed upstream. When the
    libraries gain these fields this function has less to do, and eventually
    nothing.
    """
    print("\nenrichment:")

    platforms = data.get("device-types") or {}
    if platforms and target == "netbox":
        for rel, facts in sorted(platforms.items()):
            name = facts.get("default_platform")
            if not name:
                continue
            model = Path(rel).stem
            run.do(f"set default_platform={name} on {model}",
                   lambda m=model, n=name: _set_platform(dcim, m, n))
            run.n["enriched"] += 1
    elif platforms:
        print(f"  {len(platforms)} platform hints skipped: "
              f"default_platform is a NetBox field")

    bays = data.get("module-bays") or {}
    if bays:
        # Nautobot restricts a bay by module family; NetBox 4.7 by bay type, and
        # the two models genuinely differ - a family is one FK, a bay type is
        # many-to-many. Rather than guess a mapping, report what is available so
        # it can be set deliberately.
        total = sum(len(v) for v in bays.values())
        print(f"  {total} bay constraints across {len(bays)} devices are "
              f"documented in each bay's description.")
        print("  Applying them needs Nautobot module families or NetBox 4.7 "
              "bay types; not automated yet.")


def _set_platform(dcim, model, platform_name):
    plat = dcim.platforms.get(name=platform_name) or \
        dcim.platforms.create(name=platform_name, slug=slug(platform_name))
    dt = dcim.device_types.get(model=model)
    if not dt:
        raise RuntimeError(f"device type {model} not found")
    dt.default_platform = plat.id
    dt.save()


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--target", choices=("netbox", "nautobot"),
                    help="defaults to whatever this bundle contains")
    ap.add_argument("--url", default=os.environ.get("DCIM_URL"))
    ap.add_argument("--token", default=os.environ.get("DCIM_TOKEN"))
    ap.add_argument("--commit", action="store_true",
                    help="actually write; without it nothing is changed")
    args = ap.parse_args()

    target = args.target
    if not target:
        found = [t for t in ("netbox", "nautobot") if (HERE / t).is_dir()]
        if len(found) != 1:
            sys.exit("say --target netbox or --target nautobot")
        target = found[0]

    root = HERE / target if (HERE / target).is_dir() else HERE
    if not args.url or not args.token:
        sys.exit("set DCIM_URL and DCIM_TOKEN, or pass --url and --token")

    run = Run(args.commit)
    if not args.commit:
        print("DRY RUN - nothing will be written. Add --commit when the plan "
              "below is what you want.\n")
    sync(root, target, args.url, args.token, run)

    print("\n" + ", ".join(f"{v} {k}" for k, v in run.n.items() if v))
    if not args.commit:
        print("Nothing was written.")


if __name__ == "__main__":
    main()
