#!/bin/sh
# Re-vendor the compiled output and viewer modules this site depends on.
#
# The site holds a *snapshot* of Portrayal's build artifacts, not a live link:
# the schemas are at v0 and the drawings change under us. Re-run this after a
# ./build.sh over there, then check the showcase still behaves.
set -e
SRC="${1:-/Volumes/External/Network-Device-Visualization/library}"
HERE="$(cd "$(dirname "$0")" && pwd)"

for m in viewer3d.js relief.js share.js swap.js; do
  cp "$SRC/demo2/$m" "$HERE/vendor/$m"
done

# The 3D viewer needs every view of the featured device, plus the component
# index it resolves swapped-in modules through.
cp "$SRC"/dist/as7726-32x.* "$HERE/assets/dist/"
cp "$SRC"/dist/components.json "$HERE/assets/dist/"

# Swapped-in module skins the 3D build resolves through components.json.
mkdir -p "$HERE/assets/dist/components"
cp "$SRC"/dist/components/*.svg "$HERE/assets/dist/components/"

# The rack elevation needs the front of every device it stacks; the 3D rack
# needs all six faces of each, because relief is extracted per face.
for d in asr-9001.asr-9001-s as7946-30xb.ac-psu as5912-54x.ac-f2b s9510-28dc.ac dcp-sc-28p.default; do
  cp "$SRC"/dist/$d.*.svg "$HERE/assets/dist/"
done
for d in asr-9001 as7946-30xb as5912-54x s9510-28dc dcp-sc-28p; do
  cp "$SRC/dist/$d.configs.json" "$HERE/assets/dist/"
done

# The schemas, rendered by the schema browser rather than linked as raw JSON.
mkdir -p "$HERE/assets/schemas"
cp "$SRC"/../spec/schemas/*.json "$HERE/assets/schemas/"

# Facts the page states about the library are DERIVED here, not typed into the
# HTML. The counts drift every time a device lands upstream, and a page that
# claims eleven devices when there are twenty-one is worse than one that claims
# nothing.
python3 - "$SRC" "$HERE" <<'PYEOF'
import json, glob, os, sys, collections, datetime

src, here = sys.argv[1], sys.argv[2]
dist = os.path.join(src, 'dist')

devs = json.load(open(os.path.join(dist, 'devices.json')))['devices']
comps = json.load(open(os.path.join(dist, 'components.json')))['components']

vendors = sorted({d.get('manufacturer') for d in devs if d.get('manufacturer')})
by_class = collections.Counter(c.get('class') for c in comps)

configs = 0
for f in glob.glob(os.path.join(dist, '*.configs.json')):
    try:
        configs += len(json.load(open(f)).get('configs') or [])
    except Exception:
        pass

schema = 'v0'
try:
    sid = json.load(open(os.path.join(src, '..', 'spec', 'schemas',
                                      'device.schema.json')))['$id']
    schema = [p for p in sid.split('/') if p.startswith('v')][-1]
except Exception:
    pass

stats = {
    'schema': schema,
    'devices': len(devs),
    'vendors': len(vendors),
    'vendorNames': vendors,
    'components': len(comps),
    'byClass': by_class.most_common(),          # ranked pairs; a dict would be re-sorted
    'configurations': configs,
    'generated': datetime.date.today().isoformat(),
}
out = os.path.join(here, 'assets', 'dist', 'stats.json')
json.dump(stats, open(out, 'w'), indent=1)
print(f"stats: {stats['devices']} devices, {stats['vendors']} vendors, "
      f"{stats['components']} components, {stats['configurations']} configurations, "
      f"schema {stats['schema']}")
PYEOF

echo "vendored from $SRC"
du -sh "$HERE/assets/dist" "$HERE/vendor"
