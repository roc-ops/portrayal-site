#!/usr/bin/env python3
"""Load a Portrayal DCIM bundle into NetBox or Nautobot.

The YAML in this bundle is deliberately valid against the shared devicetype
library schema, so you do not need this script: the community importer
(netbox-community/Device-Type-Library-Import) reads the same tree, and the tree
can be dropped onto a clone of the library and contributed upstream.

What this adds is `enrichment.json` - the facts the YAML schema has no field
for, applied through the API afterwards. Both products support them; only the
import format does not. See the README.

`fibre-maps/` is reported and not applied: a cassette's front-to-rear join also
has no field in the import format, but writing those links has not been proved
against a live instance, so the script names them and leaves them to you.

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
        self.n = {"created": 0, "existing": 0, "images": 0,
                  "enriched": 0, "failed": 0}

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


# Which kinds of type can hold a rendered face, per product.
#
# Both products give a DEVICE type front_image/rear_image. Only Nautobot gives a
# MODULE type the same two fields; NetBox's ModuleType carries
# ImageAttachmentsMixin instead, so a picture of a card attaches as a generic
# image attachment against the object rather than living on it, and there is no
# field here to PATCH. The bundle ships module-images/ for both targets either
# way - the files are also what a pull request to the shared devicetype library
# needs, and neither library's YAML schema has a field for them.
IMAGE_FIELD = {
    ("netbox", "device-types"): True,
    ("netbox", "module-types"): False,
    ("nautobot", "device-types"): True,
    ("nautobot", "module-types"): True,
}
IMAGE_DIR = {"device-types": "elevation-images", "module-types": "module-images"}


def image_for(root, kind, doc, face):
    """The rendered face for one type, or None if it was not rendered.

    Device types are keyed by slug, the name the elevation tree already uses.
    Module types have no slug in either schema, so both libraries key their
    module-images tree by MODEL - sanitised the way the YAML filename is,
    because a Cisco part number can contain a slash.
    """
    stem = doc.get("slug") if kind == "device-types" else doc["model"].replace("/", "-")
    if not stem:
        return None
    # The manufacturer's DIRECTORY, which is its name with a slash written as a
    # hyphen (`BATM/Telco Systems` is under `BATM-Telco Systems/`), the way the
    # exporter and the bundle name it.
    p = root / IMAGE_DIR[kind] / doc["manufacturer"].replace("/", "-") / f"{stem}.{face}.png"
    return p if p.is_file() else None


def upload_images(root, kind, doc, obj, target, url, token, run):
    """PATCH the rendered faces onto a type that was just created.

    An image field is a file upload, not JSON, so this goes over requests
    directly rather than through the client - both clients depend on requests,
    so nothing new is being asked for. Only newly created types get a picture:
    an existing one is left alone, which is the same rule the rest of the script
    follows.
    """
    if not IMAGE_FIELD.get((target, kind)):
        return
    for face in ("front", "rear"):
        path = image_for(root, kind, doc, face)
        if not path:
            continue
        what = f"upload {face} image for {doc['model']} ({path.stat().st_size // 1024} KB)"
        if not run.commit:
            print(f"  would {what}")
            continue
        if obj is None:
            continue
        import requests
        def send(p=path, f=face, o=obj):
            with p.open("rb") as fh:
                r = requests.patch(
                    f"{url.rstrip('/')}/api/dcim/{kind}/{o.id}/",
                    headers={"Authorization": f"Token {token}"},
                    files={f"{f}_image": (p.name, fh, "image/png")},
                    timeout=60)
            r.raise_for_status()
            return r
        if run.do(what, send):
            run.n["images"] += 1


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
            # front_image/rear_image are booleans in the YAML and file uploads
            # in the API. Drop them from the JSON and send the files after.
            payload.pop("front_image", None)
            payload.pop("rear_image", None)
            made = run.do(f"create {kind[:-1]} {man} / {doc['model']}",
                          lambda p=payload: api.create(p))
            if made:
                run.n["created"] += 1
            if images:
                upload_images(root, kind, doc, made, target, url, token, run)

    enrich = root / "enrichment.json"
    if enrich.is_file():
        apply_enrichment(dcim, json.loads(enrich.read_text()), target, run)

    report_fibre_maps(root)


def report_fibre_maps(root):
    """Named, not applied - and the difference said out loud.

    A cassette's front-to-rear join has no field in either library's import
    format (netbox#20564 made the link a bidirectional M2M and the front-port
    entry is `{name, type, positions}`), so the bundle ships it beside the type
    as `fibre-maps/`. Creating those links means POSTing relations against a
    live instance after the type exists, which is a write to a source of truth
    that has not been proved against a real NetBox or Nautobot.

    So this does not write them. It says they are here and how many, because a
    script that quietly skips the only part of a cassette that makes it a
    cassette leaves you believing the import was complete.
    """
    maps = sorted((root / "fibre-maps").glob("*/*.yaml"))
    if not maps:
        return
    rows = 0
    for p in maps:
        rows += len((yaml.safe_load(p.read_text()) or {}).get("rows") or [])
    print(f"\nfibre maps: {len(maps)} cassette(s), {rows} front-to-rear rows"
          f"\n  NOT applied - see the README. The type is created with its front"
          f"\n  and rear ports; the join between them is left to you.")


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
    ap.add_argument("--no-images", action="store_true",
                    help="create the types without uploading rendered faces")
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
    sync(root, target, args.url, args.token, run, images=not args.no_images)

    print("\n" + ", ".join(f"{v} {k}" for k, v in run.n.items() if v))
    if not args.commit:
        print("Nothing was written.")


if __name__ == "__main__":
    main()
