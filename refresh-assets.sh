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

echo "vendored from $SRC"
du -sh "$HERE/assets/dist" "$HERE/vendor"
