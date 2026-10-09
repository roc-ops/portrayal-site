#!/bin/sh
# three.js, vendored rather than fetched from a CDN at runtime.
#
# The import maps used to point at unpkg, so no 3D tab could start until 1.4 MB
# arrived from a third party - serialised, because the addons are only reached
# once `three` itself resolves. A slow link made that seconds, and a network
# that blocks unpkg made it a failure that looks like our bug.
#
# It is also the rule we hold our own exports to: the draw.io library embeds its
# artwork and the drawings zip is self-contained, on the principle that the
# answer to "can I use this" is "take a copy", never "link to mine". This is us
# taking our own advice. See portrayal-site#16.
#
# Immutable once fetched. Bump VERSION deliberately; it is not part of the
# refresh, because a viewer that suddenly builds against a different three is
# not a thing that should happen by running a sync script.
set -eu
VERSION=0.161.0
cd "$(dirname "$0")"
base="https://unpkg.com/three@${VERSION}"
curl -sSfL "$base/build/three.module.js" -o three.module.js
# MIT asks that the notice travel with the copy; the addons carry no header of their own.
curl -sSfL "$base/LICENSE" -o LICENSE
python3 - "$base" <<'PY'
import os, re, sys, posixpath, urllib.request
base = sys.argv[1] + '/examples/jsm/'
seen, queue = set(), ['controls/OrbitControls.js',
                      'exporters/GLTFExporter.js',
                      'exporters/USDZExporter.js']
while queue:
    rel = posixpath.normpath(queue.pop())
    if rel in seen:
        continue
    seen.add(rel)
    dst = os.path.join('addons', rel)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    urllib.request.urlretrieve(base + rel, dst)
    for spec in re.findall(r"from\s+'([^']+)'", open(dst, encoding='utf-8').read()):
        if spec.startswith('.'):
            queue.append(posixpath.normpath(posixpath.join(posixpath.dirname(rel), spec)))
        elif spec != 'three' and not spec.startswith('three/'):
            raise SystemExit(f'unexpected bare specifier {spec!r} in {rel}')
print(f'addons: {len(seen)} files')
PY
echo "three ${VERSION} vendored -> $(du -sh . | cut -f1)"
