#!/usr/bin/env python3
"""Which NOS a software vendor's DCIM exports run, from whichever file the build has.

Portrayal #677 replaces per-hardware NOS overlays (dist `overlays.json`, and the
exporter's `--nos` flag) with NOS vendor listings (dist `listings.json`; the
exporter exports every listing and treats `--nos` as an error). refresh-assets.sh
needs two answers from that, and must get them right on both sides of the change:

  args <dist>       the exporter's --nos flags: one per NOS the overlays declare
                    before #677, none after (listings export without asking)
  platforms <dist>  {vendor, lowercased: nos} as JSON, for the default_platform
                    the DCIM exports are tagged with: `Arrcus` -> `arcos`

A build with neither file prints no flags and an empty map; that is not an error.
"""
import json
import os
import sys


def _load(dist, name, key):
    path = os.path.join(dist, name)
    if not os.path.isfile(path):
        return None
    with open(path) as f:
        return json.load(f).get(key, {})


def platforms(dist):
    out = {}
    listings = _load(dist, "listings.json", "listings")
    if listings is not None:
        for ls in listings.values():
            if ls.get("manufacturer") and ls.get("nos"):
                out[ls["manufacturer"].lower()] = ls["nos"]
        return out
    for per in (_load(dist, "overlays.json", "overlays") or {}).values():
        for ov in per.values():
            vendor = (ov.get("identity") or {}).get("vendor")
            if vendor and ov.get("nos"):
                out[vendor.lower()] = ov["nos"]
    return out


def nos_args(dist):
    if os.path.isfile(os.path.join(dist, "listings.json")):
        return []
    overlays = _load(dist, "overlays.json", "overlays") or {}
    seen = sorted({ov.get("nos") for per in overlays.values() for ov in per.values() if ov.get("nos")})
    return [part for nos in seen for part in ("--nos", nos)]


if __name__ == "__main__":
    cmd, dist = sys.argv[1], sys.argv[2]
    if cmd == "args":
        print(" ".join(nos_args(dist)))
    elif cmd == "platforms":
        print(json.dumps(platforms(dist), sort_keys=True))
    else:
        sys.exit(f"usage: {sys.argv[0]} args|platforms <dist>")
