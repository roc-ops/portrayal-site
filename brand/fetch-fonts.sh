#!/bin/sh
# The two typefaces brand/build-brand.py needs to outline text.
#
# The site itself loads these from Google Fonts at runtime and does not need
# them on disk. The generators do: an SVG rasterised through <img>/canvas is
# font isolated, so anything drawn as live text falls back off-brand. Outlining
# is also what brand/DIRECTION.md asks for before the wordmark goes to print or
# into an asset somebody else embeds.
#
# Not committed. They are third-party OFL files that never change, and this repo
# already has a size problem with binaries (portrayal-site#6). Run this once.
set -eu
cd "$(dirname "$0")"
mkdir -p fonts
# A plain UA gets TTF rather than woff2, which fontTools reads directly.
curl -sSf -A 'Mozilla/5.0' \
  'https://fonts.googleapis.com/css2?family=Archivo:wght@600;700;800&family=IBM+Plex+Mono:wght@400;500' \
  -o /tmp/portrayal-fonts.css
python3 - <<'PY'
import re, urllib.request, os
css = open('/tmp/portrayal-fonts.css').read()
faces = re.findall(
    r"font-family: '([^']+)';\s*font-style: \w+;\s*font-weight: (\d+);.*?src: url\((https[^)]+\.ttf)\)",
    css, re.S)
if not faces:
    raise SystemExit('no TTF faces offered - Google may have changed its UA sniffing')
for fam, wght, url in faces:
    p = os.path.join('fonts', f"{fam.replace(' ', '')}-{wght}.ttf")
    urllib.request.urlretrieve(url, p)
    print(f'{p}  {os.path.getsize(p)} bytes')
PY
echo 'fonts ready — now: python3 build-brand.py wordmark --out wordmark.svg'
