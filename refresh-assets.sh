#!/bin/sh
# Re-vendor the compiled output and viewer modules this site depends on.
#
# The site holds a *snapshot* of Portrayal's build artifacts, not a live link:
# the drawings are rebuilt over there constantly and change under us. Re-run this after a
# ./build.sh over there, then check the showcase still behaves.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"

# Build against OUR CLONE, never against Portrayal's working tree.
#
# This is not tidiness. Their tree is a live workspace: ./build.sh over there
# does `rm -rf library/dist` and rebuilds it, so reading it mid-build yields a
# tree that is missing files rather than one that is merely stale. That has
# already happened here once - a modules pass rendered 117 of 170 faceplates
# because 53 skins did not exist for the seconds it took them to rebuild, and
# nothing in the output said so. Worse, it is THEIR tree: a stray write from
# here lands in someone else's uncommitted work.
#
# The clone is a full checkout and builds its own dist, so it needs nothing
# from over there. By default it is a sibling folder, ../Portrayal; anywhere
# else, set PORTRAYAL_UPSTREAM (check-contract.py and tools/publish-schemas.sh
# read the same variable and the same default):
#
#   git clone https://github.com/roc-ops/Portrayal.git ../Portrayal
#   (cd ../Portrayal && ./build.sh)
#
UPSTREAM="${PORTRAYAL_UPSTREAM:-$HERE/../Portrayal}"
SRC="${1:-$UPSTREAM/library}"
# The viewer modules used to live in library/viewer. They are now portrayal-kit,
# a published package at the repository root with its own package.json and an
# exports map - the consumer half, which reads compiled artifacts and never
# reads YAML. Derived from SRC so a caller pointing at another checkout's
# library still finds the kit beside it.
KIT="${PORTRAYAL_KIT:-$(cd "$SRC/.." && pwd -P)/kit}"

# Refuse to read Portrayal's working tree. A comment saying "use the clone" is
# advice; this is the part that makes it true. PORTRAYAL_ALLOW_LIVE=1 is the
# deliberate escape hatch, and it is deliberately ugly to type.
if [ ! -d "$SRC" ]; then
  echo "no library at $SRC" >&2
  echo "clone it first:" >&2
  echo "  git clone https://github.com/roc-ops/Portrayal.git ${UPSTREAM}" >&2
  echo "or point PORTRAYAL_UPSTREAM at an existing clone." >&2
  echo "  (cd ${UPSTREAM} && ./build.sh)" >&2
  exit 1
fi
case "$(cd "$SRC" && pwd -P)" in
  */Network-Device-Visualization/*)
    if [ "${PORTRAYAL_ALLOW_LIVE:-}" != "1" ]; then
      echo "refusing to build from Portrayal's working tree:" >&2
      echo "  $(cd "$SRC" && pwd -P)" >&2
      echo "That tree is rebuilt in place by their ./build.sh, so a read here" >&2
      echo "can catch it half-written. Build from the clone instead:" >&2
      echo "  (cd ${UPSTREAM} && git pull && ./build.sh) && $0" >&2
      exit 1
    fi
    echo "WARNING: building from Portrayal's live working tree" >&2
    ;;
esac

# A DIST OLDER THAN ITS CHECKOUT IS NOT A SYNC. library/dist is gitignored
# build output: `git pull` moves the kit, the schemas and the sources and
# leaves the drawings and the exports exactly where the last ./build.sh put
# them. Two refreshes in one day vendored a current viewer over three-day-old
# drawings that way, and nothing said so - the counts came out plausible and
# the contract passed. Compare the build against the commit it should come
# from and refuse to go on when it is older; PORTRAYAL_ALLOW_STALE=1 is the
# escape hatch for a deliberate mixed read.
if [ -d "$SRC/../.git" ] || git -C "$SRC" rev-parse --git-dir >/dev/null 2>&1; then
  head_ts=$(git -C "$SRC" log -1 --format=%ct 2>/dev/null || echo 0)
  dist_ts=$(stat -f %m "$SRC/dist/devices.json" 2>/dev/null || stat -c %Y "$SRC/dist/devices.json" 2>/dev/null || echo 0)
  if [ "$dist_ts" -lt "$head_ts" ] && [ "${PORTRAYAL_ALLOW_STALE:-}" != "1" ]; then
    echo "refusing: $SRC/dist was built before the checkout's last commit" >&2
    echo "  dist:     $(date -r "$dist_ts" 2>/dev/null || echo "$dist_ts")" >&2
    echo "  checkout: $(date -r "$head_ts" 2>/dev/null || echo "$head_ts")  $(git -C "$SRC" log -1 --format=%h)" >&2
    echo "rebuild first:  (cd $(cd "$SRC/.." && pwd -P) && ./build.sh) && $0" >&2
    exit 1
  fi
fi
if [ ! -d "$KIT" ]; then
  echo "no portrayal-kit at $KIT" >&2
  echo "The viewer modules moved out of library/viewer into a top-level kit/." >&2
  echo "Set PORTRAYAL_KIT if this checkout puts it somewhere else." >&2
  exit 1
fi
if [ ! -d "$SRC/dist" ]; then
  echo "no compiled output at $SRC/dist - run ./build.sh in $UPSTREAM first" >&2
  exit 1
fi

# EVERY MODULE THE KIT SHIPS, not a list of the ones we remember.
#
# These modules are Portrayal's to own - they are how you talk to a drawing.
# The pages built on them are this repository's, and the demo pages that used
# to sit beside them upstream are gone: this site owns those now.
#
# This was a hand-written list until the list was wrong twice. Both times a
# module was split out upstream and imported by shell.js the same day:
# fields.js, the colour rule shared by the 2D drawing and the 3D scene (#487),
# and optical.js, a fibre path's far end and the words its row shows (#535).
# Both imports are STATIC and at the top of the file, so the failure is not a
# feature degrading - the module graph does not load at all and every page that
# mounts the shell or the 3D relief comes up blank. Both times the refresh
# passed and the counts looked right.
#
# A list cannot know what upstream split out yesterday, so stop keeping one.
# The asymmetry decides it: a module the site does not import costs one file in
# vendor/ and nothing at runtime, because no page fetches it. A module the site
# DOES import and we did not copy costs the whole site.
#
# Some arrive indirectly and would be easy to miss by eye: gif.js is named
# nowhere here, but marks.toGif does `await import('./gif.js')`; dist.js is the
# fetch memo that stopped components.json coming down three times a load.
# check-contract.py walks what the vendored modules actually import and fails
# if one cannot resolve - that check is the backstop, this glob is the fix.
for f in "$KIT"/*.js; do
  cp "$f" "$HERE/vendor/$(basename "$f")"
done
# The Rack Builder's pure core, kit/rack/ since @portrayal/kit 0.3.0. Cleared
# first, for the reason assets/dist is: a module upstream drops should go here
# too, not linger where a stale import could still find it.
rm -rf "$HERE/vendor/rack"
mkdir -p "$HERE/vendor/rack"
for f in "$KIT"/rack/*.js; do
  cp "$f" "$HERE/vendor/rack/$(basename "$f")"
done
# Which commit that was, for check-contract.py: it compares vendor/rack/ with
# kit/rack/ AT this commit, file by file, rather than with the clone's HEAD,
# which moves on while the snapshot here does not.
kit_sha=$(git -C "$KIT" rev-parse HEAD 2>/dev/null || true)
if [ -z "$kit_sha" ]; then
  echo "refusing: $KIT is not in a git checkout, so vendor/rack/SOURCE cannot name its commit" >&2
  exit 1
fi
if [ -n "$(git -C "$KIT" status --porcelain -- rack 2>/dev/null)" ]; then
  echo "WARNING: $KIT/rack has uncommitted changes; vendor/rack/ will not match $kit_sha" >&2
fi
printf '# The Portrayal commit vendor/rack/ was copied from (kit/rack/). Written by refresh-assets.sh.\n%s\n' \
  "$kit_sha" > "$HERE/vendor/rack/SOURCE"

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
# Cleared, not copied over. These are a SNAPSHOT of one build, and a cp into a
# directory that was never emptied is not a snapshot - it is the union of every
# build ever run here. A component that goes away upstream, or one left behind
# by a build against a different checkout, stays on the site forever and nothing
# reports it. $EXPORTS below has always been rm -rf'd; this never was.
rm -rf "$HERE/assets/dist"
mkdir -p "$HERE/assets/dist"

# THE LICENCE TRAVELS WITH WHAT IT COVERS. This site redistributes Portrayal's
# compiled drawings, its DCIM exports and its viewer modules to the public, and
# Apache-2.0 section 4 asks a redistribution to carry the licence and the
# NOTICE. Upstream made them part of the artifact sets for that reason
# (build.sh and publish.sh copy them into dist/ and exports/), and vendoring
# that dropped them: the site claimed Apache-2.0 in prose on its front page and
# shipped no licence text anywhere. Copied beside each set rather than once at
# the root, so a set stays complete wherever it is served from.
# assets/exports is cleared and regenerated further down, so its copy is made
# there rather than here - put it here and the rm -rf takes it straight back out.
for f in LICENSE NOTICE; do
  [ -f "$SRC/dist/$f" ] && cp "$SRC/dist/$f" "$HERE/assets/dist/$f"
done
[ -f "$SRC/../LICENSE" ] && cp "$SRC/../LICENSE" "$HERE/vendor/LICENSE"
[ -f "$SRC/../NOTICE" ] && cp "$SRC/../NOTICE" "$HERE/vendor/NOTICE"
# ...WITH ONE LINE MADE TRUE HERE. Portrayal's NOTICE says three.js is "Not
# bundled", which is right for the kit and wrong beside vendor/three/, where this
# site does bundle it. The rewrite fails loudly rather than skipping, so a change
# to that sentence upstream is seen instead of quietly shipping the old claim.
if [ -f "$HERE/vendor/NOTICE" ]; then
  python3 - "$HERE/vendor/NOTICE" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
old = ("authors. Not bundled. kit/viewer3d.js and kit/share.js import it at run time\n"
       "as an optional peer dependency that the host page supplies.")
new = ("authors. Portrayal's kit does not bundle it: kit/viewer3d.js and kit/share.js\n"
       "import it at run time as an optional peer dependency that the host page\n"
       "supplies. This site supplies it: three.js is bundled in vendor/three/, with\n"
       "its licence and version in vendor/three/LICENSE and fetch-three.sh.")
if old not in s:
    sys.exit("refresh-assets: vendor/NOTICE no longer has the three.js 'Not bundled' "
             "sentence; update the rewrite in refresh-assets.sh")
open(p, "w").write(s.replace(old, new, 1))
PY
fi
cp "$SRC"/dist/devices.json "$HERE/assets/dist/"
cp "$SRC"/dist/components.json "$HERE/assets/dist/"
# labs.json is the ROADM ring lab. No showcase stage draws it since stages 4-5
# moved to the example patching plan (site/showcase/patching.json), but the
# dist keeps it: still a bare cp, so a refresh that loses it says so.
cp "$SRC"/dist/labs.json "$HERE/assets/dist/"
# rack.json is the Rack Builder's catalogue (Portrayal's rack_index.py, kit
# 0.3.0): a bare cp, because the builder cannot place anything without it.
cp "$SRC"/dist/rack.json "$HERE/assets/dist/"
# Published as of the kit split, when the exporter stopped needing a checkout.
# vendors.json carries the alias and lineage registry - who owns a brand now,
# which is what stops an ArcOS box being filed under the metal it runs on.
# overlays.json is the NOS join: the entity-map rules that turn what a box calls
# its own components into the ids on the drawing. portrayal-site#12 has been
# waiting on that artifact existing; it exists now.
# listings.json replaces overlays.json in Portrayal #677; whichever the build has is copied.
for f in vendors.json overlays.json listings.json gaps.json; do
  [ -f "$SRC/dist/$f" ] && cp "$SRC/dist/$f" "$HERE/assets/dist/"
done
# <device>.source.json is the source manifest, published once per device since
# Portrayal #669; a face names it by digest (source-sha256) instead of embedding it.
#
# NOT <face>.elements.json (Portrayal #727/#740), deliberately, like
# components-detail.json above: one per face, for a server that wants a face's
# tree without a DOM. No page here and no vendored module fetches one - the
# Explorer builds the same tree from the SVG with swap.js faceTree - so copying
# them would add 3222 files and 49 MB (at Portrayal dd5fc85a) that nobody
# downloads. The glob below names *.svg, *.configs.json and *.source.json, so
# it cannot pick them up by accident; copy them here the day a page reads one.
for f in "$SRC"/dist/*.svg "$SRC"/dist/*.configs.json "$SRC"/dist/*.source.json; do
  cp "$f" "$HERE/assets/dist/"
done

# Swapped-in module skins, resolved through components.json.
mkdir -p "$HERE/assets/dist/components"
cp "$SRC"/dist/components/*.svg "$HERE/assets/dist/components/"
for d in asr-9001 as7946-30xb as5912-54x s9510-28dc dcp-sc-28p; do
  cp "$SRC/dist/$d.configs.json" "$HERE/assets/dist/"
done

# A size index for the drawings, so a page can say how big a download will be
# BEFORE it builds it. Juniper made this necessary: an MX10016 front is 9.5 MB
# of SVG and 12.7 MB once base64'd into a draw.io library, so a whole-vendor
# library is tens of megabytes and the only warning used to be the wait.
python3 - "$HERE/assets/dist" <<'PYEOF'
import json, os, sys
root = sys.argv[1]
sizes = {}
for dirpath, _, names in os.walk(root):
    for n in names:
        if not n.endswith('.svg'):
            continue
        full = os.path.join(dirpath, n)
        sizes[os.path.relpath(full, root)] = os.path.getsize(full)
json.dump(sizes, open(os.path.join(root, 'sizes.json'), 'w'), separators=(',', ':'))
print("sizes: %d drawings indexed, %.1f MB total"
      % (len(sizes), sum(sizes.values()) / 1048576))
PYEOF

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
# and the licence for this set, after the clear that would have removed it
for f in LICENSE NOTICE; do
  [ -f "$SRC/exports/$f" ] && cp "$SRC/exports/$f" "$EXPORTS/$f"
done
# Derived from SRC, so the exporter and the library it reads are always the same
# checkout. When these could differ, they did: an earlier run took the exporter
# from the clone and the drawings from the live tree, which is how the partial
# render above got in. Override only if you mean to mix them.
TOOLS="${PORTRAYAL_TOOLS:-$SRC/../spec/tools/portrayal}"
# THE CLONE'S OWN `portrayal` PACKAGE, NOT WHATEVER IS INSTALLED (Portrayal #561).
# dcim_export.py imports `portrayal.*`, and running a script puts only its own
# folder on sys.path - so an editable install pointing at some other checkout
# won the import. After #669 moved the manifest out of the drawings, that stale
# copy found no manifests at all and the exports came out empty, silently.
PYTHONPATH="$(cd "$TOOLS/.." && pwd)${PYTHONPATH:+:$PYTHONPATH}"
export PYTHONPATH
INDEX="$EXPORTS/index.json"

if [ -f "$TOOLS/dcim_export.py" ]; then
  # THE EXPORT READS THE BUILD, NOT THE CHECKOUT (roc-ops/ndv#87). It used to
  # take a device.yaml path and reach into library/; it now takes --dist and
  # opens nothing under library/devices or library/components. The device list
  # comes from the build for the same reason: this whole step should work
  # against a release tarball, and globbing their source tree would be the one
  # thing left that does not.
  #
  # Three CLI changes at once, all flagged in that PR as a coordinated break:
  # the positional path became --device NAME, --modules became a bare flag, and
  # rasterising is now --images rather than implied by --dist.
  DEVLIST=$(python3 -c 'import json,sys
print("\n".join(d["name"] for d in json.load(open(sys.argv[1]))["devices"]))' \
    "$SRC/dist/devices.json")
  # THE NOS LIST COMES FROM THE BUILD TOO (roc-ops/ndv#127). A NOS is data: a
  # device's overlays/<nos>.yaml declares it, and the exporter now refuses a
  # --nos that no overlay in the build declares - `--nos sonic`, hard-coded
  # here since the day the flag existed, started exiting non-zero and took
  # every device export with it. Ask overlays.json what is declared instead.
  # AND AFTER PORTRAYAL #677 THERE ARE NO FLAGS AT ALL: a NOS vendor lists the
  # hardware it supports (listings.json), every listing exports, and `--nos` is
  # an error. tools/nos_platforms.py answers for whichever file the build has.
  NOS_ARGS=$(python3 "$HERE/tools/nos_platforms.py" args "$SRC/dist")
  : > "$EXPORTS/.paths"
  # ONE DEVICE PER CALL, DELIBERATELY. A single pass exports all 84 in 1.5s
  # against roughly 25s for the loop, but it prints paths without saying which
  # device each came from - and index.json is keyed by device, because that is
  # what the Exporter page offers a visitor. Naming the device per call gets
  # that attribution from the tool instead of inferring it here from filenames
  # that are SKUs. The 25s is bought on a refresh that already takes minutes.
  for name in $DEVLIST; do
    python3 "$TOOLS/dcim_export.py" --dist "$SRC/dist" --device "$name" \
      --out "$EXPORTS" $NOS_ARGS --images \
      | sed "s|^|$name\t|" >> "$EXPORTS/.paths"
  done
  # Module types are per component, not per device: one pass over the index.
  # --images earns its place here for the same reason it does above - the pass
  # also rasterises each card's faceplate into module-images/, which is the half
  # of a module type a person actually recognises in a rack.
  python3 "$TOOLS/dcim_export.py" --dist "$SRC/dist" --modules \
    --out "$EXPORTS" --images >/dev/null 2>&1 || \
    echo "  note: this exporter has no --modules pass" >&2

  NOS_PLATFORMS=$(python3 "$HERE/tools/nos_platforms.py" platforms "$SRC/dist") \
  python3 - "$EXPORTS" "$SRC" <<'PYEOF'
import json, os, re, sys, glob
import yaml
root, lib = sys.argv[1], sys.argv[2]

# What the export produced, keyed by device, so the page offers what exists
# rather than predicting filenames.
index = {}
# A DEVICE THE EXPORTER DECLINES IS NAMED, NOT JUST ABSENT. dcim_export.py
# writes no type for a device with no console port, interface or module bay -
# "nothing but a header: not worth a file" - and prints `skip <device>: nothing
# to export`. Until the Nokia outdoor ONT enclosure 3FE54221AH (Portrayal
# #768), a box with a door and no ports, no device did that, so a device
# missing from index.json could only mean the export had failed and
# check-contract.py says so. Keep the exporter's own word for it in
# skipped.json, so the contract can tell a device with nothing to export from
# an export that did not run; index.json keeps its shape and gains no empty
# entries.
skipped = []
for line in open(os.path.join(root, '.paths')):
    dev, _, rest = line.partition('\t')
    if rest.strip() == 'skip %s: nothing to export' % dev:
        skipped.append(dev)
        continue
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
#
# fibre-maps/ IS NOT A THIRD LIBRARY, and it is listed here anyway. It is the
# front-to-rear join for a cassette, and it sits outside netbox/ and nautobot/
# because netbox#20564 replaced the FrontPort->RearPort foreign key with a
# bidirectional M2M: the front-port entry in the shared type schema is
# `{name, type, positions}` with `additionalProperties: false`, so the mapping
# now has nowhere to live in either library's YAML. Both targets consume the
# same rows. Leaving it out of this index is what kept it unreachable from the
# Exporter page for a release - the files were vendored and nothing could see
# them.
files = {}
for target in ('netbox', 'nautobot', 'fibre-maps'):
    base = os.path.join(root, target)
    if not os.path.isdir(base):
        continue
    # PNGs are deliberately absent. They were 74% of this repository's pack -
    # 15 MB from 319 blobs against 4.6 MB for 2043 SVGs, because PNG does not
    # delta-compress and a refresh rewrites every one. The exporter still writes
    # them for a local run and for portrayal-sync.py to upload; the bundle
    # renders its own from the compiled drawings, so nothing needs to carry them.
    files[target] = sorted(os.path.relpath(p, root)
                           for p in glob.glob(os.path.join(base, '**', '*'), recursive=True)
                           if os.path.isfile(p) and not p.endswith('.png'))

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

# default_platform: a device type exported for a NOS is filed under the
# software vendor its overlay names (roc-ops/ndv#127: `ArcOS on 7726-32X` under
# Arrcus), and platform is the field both products use to say so. The
# manufacturer directory is the tell now - the `-arcos` suffix that used to
# be is gone, and the exporter knows no NOS by name, so this reads the same
# overlays.json the exporter did. Now tools/nos_platforms.py reads whichever of
# overlays.json and listings.json (Portrayal #677) the build has.
platform_of = json.loads(os.environ.get('NOS_PLATFORMS') or '{}')
for dev, targets in index.items():
    for rel in targets.get('netbox', []):
        m = re.search(r'device-types/([^/]+)/', rel)
        nos = m and platform_of.get(m.group(1).lower())
        if nos:
            enrichment['device-types'][rel[:-5]] = {'default_platform': nos}

json.dump(index, open(os.path.join(root, 'index.json'), 'w'), indent=1, sort_keys=True)
json.dump(files, open(os.path.join(root, 'files.json'), 'w'), indent=1)
json.dump({'nothing-to-export': sorted(skipped)},
          open(os.path.join(root, 'skipped.json'), 'w'), indent=1)
json.dump(enrichment, open(os.path.join(root, 'enrichment.json'), 'w'), indent=1, sort_keys=True)
n = sum(len(v) for v in files.values())
# The fibre maps are counted OUT LOUD rather than folded into the total. They
# are the one set here that arrives from a tree this script does not otherwise
# name, so the day upstream stops writing them the number goes to 0 in front of
# whoever ran the refresh, instead of the total shrinking by five.
print("exports: %d files, %d devices, %d bay constraints, %d platform hints, "
      "%d fibre maps, %d with nothing to export%s"
      % (n, len(index), len(enrichment['module-bays']),
         len(enrichment['device-types']), len(files.get('fibre-maps', [])),
         len(skipped), skipped and ' (%s)' % ', '.join(sorted(skipped)) or ''))
PYEOF
  rm -f "$EXPORTS/.paths"
else
  echo "  note: dcim_export.py not found, copying the legacy nautobot tree" >&2
  cp -R "$SRC/exports/nautobot" "$EXPORTS/nautobot"
fi

# The schemas, rendered by the schema browser rather than linked as raw JSON.
# Cleared first, like assets/dist: a schema that goes away upstream should go
# away here, not linger as a tab nobody can check. check-contract.py then fails
# the refresh if schema.js has no tab for a schema, or meets a keyword it does
# not render; check-browser.py fails if any property is missing from the page.
rm -rf "$HERE/assets/schemas"
mkdir -p "$HERE/assets/schemas"
cp "$SRC"/../spec/schemas/*.json "$HERE/assets/schemas/"
# Which schemas are here, for the schema page: it offers a tab per file listed,
# and asking for one that is not here (overlay before Portrayal #677, listing
# after) would be a 404 on every visit.
python3 -c 'import json,os,sys; d=sys.argv[1]; json.dump({"schemas": sorted(f for f in os.listdir(d) if f.endswith(".schema.json"))}, open(os.path.join(d, "index.json"), "w"), indent=1)' "$HERE/assets/schemas"   # assets/schemas/index.json

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

# NOS vendor listings (Portrayal #677): each is one box a NOS vendor supports.
# Counted apart from `vendors`, which stays the makers of the metal - a listing
# is never drawn, so Arrcus listing a UfiSpace box adds no hardware vendor.
# A build from before #677 has no listings.json and counts none.
listings = {}
try:
    listings = json.load(open(os.path.join(dist, 'listings.json'))).get('listings') or {}
except Exception:
    pass
nos_vendors = sorted({l.get('manufacturer') for l in listings.values() if l.get('manufacturer')})

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
    'listings': len(listings),
    'nosVendors': len(nos_vendors),
    'nosVendorNames': nos_vendors,
    'generated': datetime.date.today().isoformat(),
}
out = os.path.join(here, 'assets', 'dist', 'stats.json')
json.dump(stats, open(out, 'w'), indent=1)
print(f"stats: {stats['devices']} devices, {stats['vendors']} vendors, "
      f"{stats['components']} components, {stats['configurations']} configurations, "
      f"{stats['listings']} listings from {stats['nosVendors']} NOS vendors, "
      f"schema {stats['schema']}")
PYEOF

# Readiness, checked by asking for the modules themselves.
#
# Portrayal's own advice, and it applies here: a directory answers 200 whether
# or not the library shipped. A copy that half-failed leaves the tree looking
# right and every tool page blank, so assert on the files - and on the export
# each page actually imports, because an empty file is also a file.
missing=0
for f in "$KIT"/*.js "$KIT"/rack/*.js; do
  case "$f" in
    "$KIT"/rack/*) m="rack/$(basename "$f")" ;;
    *) m=$(basename "$f") ;;
  esac
  v="$HERE/vendor/$m"
  if [ ! -s "$v" ] || ! grep -q '^export' "$v"; then
    echo "  MISSING or empty: vendor/$m" >&2
    missing=1
  fi
done
# relief.js, share.js and swap.js are imported by other MODULES rather than by
# any page, so nothing in this repository names them and a missing one surfaces
# only as a broken tool at runtime. They are on the list above for that reason.
if [ "$missing" != "0" ]; then
  echo "vendoring incomplete - check $KIT" >&2
  exit 1
fi

echo "vendored from $SRC"
du -sh "$HERE/assets/dist" "$HERE/vendor"

# What we just vendored, checked against what the pages actually read.
#
# The drawings are rebuilt over there constantly; when
# something this site depends on goes away the failure is SILENT - a tab renders
# slightly wrong, or a download comes out empty. This is the only thing that
# turns that into a noise. Non-zero exit fails the refresh.

python3 "$HERE/check-contract.py"
