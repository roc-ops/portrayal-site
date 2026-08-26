#!/bin/sh
# Re-vendor the compiled output and viewer modules this site depends on.
#
# The site holds a *snapshot* of Portrayal's build artifacts, not a live link:
# the schemas are at v0 and the drawings change under us. Re-run this after a
# ./build.sh over there, then check the showcase still behaves.
set -e
SRC="${1:-/Volumes/External/Network-Device-Visualization/library}"
HERE="$(cd "$(dirname "$0")" && pwd)"

# The viewer modules moved out of demo2/ into their own library/viewer/ tree.
# dist.js is new and non-optional: viewer3d.js imports it, and it is the fetch
# memo that stopped components.json coming down three times a load.
#
# The Explorer is the shell plus its own panel, so the shell's graph comes too:
# shell.js -> devsel.js, swap.js, dist.js, and the Explorer itself reads
# states.js. marks.js arrives with the Annotator; gif.js and hl.js when
# something here imports them.
#
# These modules are Portrayal's to own - they are how you talk to a drawing.
# The pages built on them are this repository's.
for m in viewer3d.js relief.js share.js swap.js dist.js shell.js devsel.js states.js; do
  cp "$SRC/viewer/$m" "$HERE/vendor/$m"
done

# Every device, because the Explorer offers the whole library and a picker with
# holes in it looks broken.
#
# This is a bigger snapshot than the showcase needs - but it costs the VISITOR
# nothing: devices.json drives the picker and a device's files are fetched only
# when someone selects it. The cost is repository and deploy size, which is the
# argument for building assets/ on deploy rather than for shipping fewer
# devices. See issue #6.
#
# components.json only, NOT components-detail.json: provenance and relief moved
# out to that second file, and nothing here reads either field - the viewer
# takes ns, name, major, body and skins. Vendoring it would add 1.9 MB nobody
# fetches.
cp "$SRC"/dist/devices.json "$HERE/assets/dist/"
cp "$SRC"/dist/components.json "$HERE/assets/dist/"
for f in "$SRC"/dist/*.svg "$SRC"/dist/*.configs.json; do
  cp "$f" "$HERE/assets/dist/"
done

# Swapped-in module skins, resolved through components.json.
mkdir -p "$HERE/assets/dist/components"
cp "$SRC"/dist/components/*.svg "$HERE/assets/dist/components/"
for d in asr-9001 as7946-30xb as5912-54x s9510-28dc dcp-sc-28p; do
  cp "$SRC/dist/$d.configs.json" "$HERE/assets/dist/"
done

# The DCIM exports, GENERATED rather than copied.
#
# The old step copied $SRC/exports/nautobot, a build artifact whose shape is
# whatever the last ./build.sh over there produced. Running the exporter here
# instead means this page shows the current behaviour of the current exporter,
# which is the whole point of having the page - it is where the "a CCAP chassis
# exports nothing" defect was noticed.
#
# Prefers dcim_export.py; falls back to the older nautobot_export.py so the site
# still builds against a checkout that predates roc-ops/ndv#21.
EXPORTS="$HERE/assets/exports"
rm -rf "$EXPORTS"
mkdir -p "$EXPORTS"
# Overridable so the site can be built against a clone while a change to the
# exporter is still in review:
#   PORTRAYAL_TOOLS=/path/to/clone/spec/tools/portrayal ./refresh-assets.sh
TOOLS="${PORTRAYAL_TOOLS:-$SRC/../spec/tools/portrayal}"
INDEX="$EXPORTS/index.json"

if [ -f "$TOOLS/dcim_export.py" ]; then
  : > "$EXPORTS/.paths"
  for d in "$SRC"/devices/*/*/device.yaml; do
    name=$(basename "$(dirname "$d")")
    python3 "$TOOLS/dcim_export.py" "$d" --out "$EXPORTS"       --nos arcos --nos sonic --dist "$SRC/dist"       | sed "s|^|$name\t|" >> "$EXPORTS/.paths"
  done
  # Module types are per component, not per device: one pass over the library.
  python3 "$TOOLS/dcim_export.py" --modules "$SRC" --out "$EXPORTS" >/dev/null 2>&1 || \
    echo "  note: this exporter has no --modules pass" >&2

  python3 - "$EXPORTS" "$SRC" <<'PYEOF'
import json, os, re, sys, glob
import yaml
root, lib = sys.argv[1], sys.argv[2]

# What the export produced, keyed by device, so the page offers what exists
# rather than predicting filenames.
index = {}
for line in open(os.path.join(root, '.paths')):
    dev, _, rest = line.partition('\t')
    # NOT \S+ : "Casa Systems" has a space in it, so a non-whitespace run stops
    # at the manufacturer and never reaches .yaml.
    m = re.match(r'(.+\.yaml)', rest.strip())
    if not m:
        continue
    rel = os.path.relpath(m.group(1), root)
    index.setdefault(dev, {}).setdefault(rel.split(os.sep)[0], []).append(rel)
for dev in index:
    for t in index[dev]:
        index[dev][t].sort()

# Everything in the tree, so a bundle can be assembled without guessing.
files = {}
for target in ('netbox', 'nautobot'):
    base = os.path.join(root, target)
    if not os.path.isdir(base):
        continue
    files[target] = sorted(os.path.relpath(p, root)
                           for p in glob.glob(os.path.join(base, '**', '*'), recursive=True)
                           if os.path.isfile(p))

# The facts the YAML schemas cannot carry. Everything here is something the
# PRODUCTS support and the LIBRARIES cannot import, so this file is a measure of
# that gap and shrinks as they catch up.
enrichment = {'device-types': {}, 'module-bays': {}}
for f in sorted(glob.glob(os.path.join(lib, 'devices', '*', '*', 'device.yaml'))):
    dev = yaml.safe_load(open(f))
    man = dev.get('manufacturer')
    for view in (dev.get('views') or {}).values():
        for b in ((view.get('components') or {}).get('bays') or []):
            if not b.get('accepts'):
                continue
            key = man + '/' + dev['model'].split(' (')[0]
            name = (b['id'].replace('psu-', 'PSU ').replace('fan-', 'Fan ')
                    .replace('front-', 'Front ').replace('rear-', 'Rear '))
            enrichment['module-bays'].setdefault(key, {})[name] = {
                'accepts': [a.split('/')[-1].split('@')[0] for a in b['accepts']]}

# default_platform: a NOS-suffixed device type is named for that NOS, and
# platform is the field both products use to say so.
for dev, targets in index.items():
    for rel in targets.get('netbox', []):
        m = re.search(r'-(arcos|sonic)\.yaml$', rel)
        if m:
            enrichment['device-types'][rel[:-5]] = {'default_platform': m.group(1)}

json.dump(index, open(os.path.join(root, 'index.json'), 'w'), indent=1, sort_keys=True)
json.dump(files, open(os.path.join(root, 'files.json'), 'w'), indent=1)
json.dump(enrichment, open(os.path.join(root, 'enrichment.json'), 'w'), indent=1, sort_keys=True)
n = sum(len(v) for v in files.values())
print("exports: %d files, %d devices, %d bay constraints, %d platform hints"
      % (n, len(index), len(enrichment['module-bays']), len(enrichment['device-types'])))
PYEOF
  rm -f "$EXPORTS/.paths"
else
  echo "  note: dcim_export.py not found, copying the legacy nautobot tree" >&2
  cp -R "$SRC/exports/nautobot" "$EXPORTS/nautobot"
fi

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

# Readiness, checked by asking for the modules themselves.
#
# Portrayal's own advice, and it applies here: a directory answers 200 whether
# or not the library shipped. A copy that half-failed leaves the tree looking
# right and every tool page blank, so assert on the files - and on the export
# each page actually imports, because an empty file is also a file.
missing=0
for m in viewer3d.js relief.js share.js swap.js dist.js shell.js devsel.js states.js; do
  f="$HERE/vendor/$m"
  if [ ! -s "$f" ] || ! grep -q '^export' "$f"; then
    echo "  MISSING or empty: vendor/$m" >&2
    missing=1
  fi
done
# relief.js, share.js and swap.js are imported by other MODULES rather than by
# any page, so nothing in this repository names them and a missing one surfaces
# only as a broken tool at runtime. They are on the list above for that reason.
if [ "$missing" != "0" ]; then
  echo "vendoring incomplete - check $SRC/viewer" >&2
  exit 1
fi

echo "vendored from $SRC"
du -sh "$HERE/assets/dist" "$HERE/vendor"
