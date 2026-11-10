#!/usr/bin/env python3
"""Make assets/ small enough to serve: leave out what a page can derive, pack what
a page fetches in bulk.

    tools/pack-assets.py <site root>

portrayal.dev is served from a host that takes a limited number of files per
version, and two kinds of file made up most of the count:

  - <device>.<view>.svg, a copy of the same view of the device's default
    configuration. The copy is dropped; assets/dist/default-faces.json says which
    file draws each device's default face (site/faces.js defaultFace).
  - the DCIM exports, one YAML per device type and per target. They are packed
    into assets/exports/packs/<target>/<manufacturer>.json, a map of the path
    files.json lists to the file's text (site/exports-pack.js exportText).

It also rewrites assets/dist/sizes.json, after the trim, so it lists only files
that exist. refresh-assets.sh runs this before check-contract.py; it can be run
on a tree as it stands, and a second run changes nothing.

A plain face is deleted only when its bytes equal the default face's. One that
differs, or that configs.json names no face for, is kept and printed.
"""
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

# Devices whose plain faces stay: the kit's recipes (site/kit-examples) and the
# home page fetch these by plain name, as a user of Portrayal's own build would.
KEEP_PLAIN = ['s9600-72xc', 'evma8365x']

VIEWS = ['front', 'rear', 'left', 'right', 'top', 'bottom']
TARGETS = ['netbox', 'nautobot', 'fibre-maps']


def pack_path(rel):
    """The pack a files.json path is in: packs/<target>/<manufacturer>.json.
    site/exports-pack.js packOf does the same; check-contract.py holds them equal."""
    parts = rel.split('/')
    return f'packs/{parts[0]}/{parts[-2]}.json'


def default_faces(dist):
    """{device: {view: file}} for every <device>.configs.json, from the
    configuration its `default` names."""
    out = {}
    for f in sorted(dist.glob('*.configs.json')):
        cfg = json.loads(f.read_text())
        dev = cfg.get('device') or f.name[:-len('.configs.json')]
        chosen = next((c for c in cfg.get('configs', []) if c.get('name') == cfg.get('default')), None)
        out[dev] = dict((chosen or {}).get('files') or {})
    return out


def trim_faces(dist, faces):
    """Delete the plain faces that equal the default face. Returns (deleted, kept)."""
    deleted, kept = 0, 0
    for dev, files in faces.items():
        if dev in KEEP_PLAIN:
            continue
        for view in sorted(set(files) | set(VIEWS)):
            plain = dist / f'{dev}.{view}.svg'
            if not plain.is_file():
                continue
            named = files.get(view)
            if not named:
                print(f'kept {plain.name}: configs.json names no {view} face for the default configuration')
                kept += 1
            elif named == plain.name:
                print(f'kept {plain.name}: it is the default face itself')
                kept += 1
            elif not (dist / named).is_file() or (dist / named).read_bytes() != plain.read_bytes():
                print(f'kept {plain.name}: it differs from {named}')
                kept += 1
            else:
                plain.unlink()
                deleted += 1
    return deleted, kept


def write_sizes(dist):
    """A size index for the drawings, so a page can say how big a download will
    be BEFORE it builds it (a whole-vendor draw.io library is tens of megabytes)."""
    sizes = {}
    for path in sorted(dist.rglob('*.svg')):
        sizes[path.relative_to(dist).as_posix()] = path.stat().st_size
    (dist / 'sizes.json').write_text(json.dumps(sizes, separators=(',', ':')))
    print('sizes: %d drawings indexed, %.1f MB total' % (len(sizes), sum(sizes.values()) / 1048576))


def pack_exports(exports):
    """Build the packs aside, check them against files.json, move them in, and
    only then delete the loose YAML. A run that stops leaves the old state or one
    the next run finishes."""
    listed = json.loads((exports / 'files.json').read_text())
    packs_dir = exports / 'packs'
    wanted = {}
    for target in TARGETS:
        for rel in listed.get(target, []):
            wanted.setdefault(pack_path(rel), []).append(rel)
    built, missing = {}, []
    for pack, rels in sorted(wanted.items()):
        current = None
        if (packs_dir / pack[len('packs/'):]).is_file():
            current = json.loads((packs_dir / pack[len('packs/'):]).read_text(encoding='utf-8'))
        text = {}
        for rel in rels:
            loose = exports / rel
            if loose.is_file():
                text[rel] = loose.read_bytes().decode('utf-8')
            elif current is not None and rel in current:
                text[rel] = current[rel]
            else:
                missing.append(rel)
        built[pack] = text
    if missing:
        sys.exit('not packed - no file or pack entry for %d listed paths, first: %s' % (len(missing), missing[0]))
    tmp = Path(tempfile.mkdtemp(prefix='packs-', dir=exports))
    try:
        for pack, text in built.items():
            out = tmp / pack[len('packs/'):]
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(json.dumps(text, ensure_ascii=False, separators=(',', ':'), sort_keys=True),
                       encoding='utf-8')
        # Check what was written, not what was meant to be.
        for pack, rels in wanted.items():
            written = json.loads((tmp / pack[len('packs/'):]).read_text(encoding='utf-8'))
            for rel in rels:
                loose = exports / rel
                if rel not in written or (loose.is_file() and loose.read_bytes() != written[rel].encode('utf-8')):
                    sys.exit(f'not packed - {rel} does not match its pack entry in {pack}')
        for pack in built:
            dest = packs_dir / pack[len('packs/'):]
            dest.parent.mkdir(parents=True, exist_ok=True)
            os.replace(tmp / pack[len('packs/'):], dest)
        # Packs no longer listed (a manufacturer gone from the exporter) go too.
        for old in sorted(packs_dir.rglob('*.json')):
            if 'packs/' + old.relative_to(packs_dir).as_posix() not in built:
                old.unlink()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    removed = 0
    for target in TARGETS:
        for loose in sorted((exports / target).rglob('*.yaml')):
            loose.unlink()
            removed += 1
    print('packs: %d written, %d loose YAML files removed' % (len(built), removed))


def main(argv):
    if len(argv) != 1:
        sys.exit(__doc__)
    root = Path(argv[0])
    dist = root / 'assets' / 'dist'
    faces = default_faces(dist)
    deleted, kept = trim_faces(dist, faces)
    (dist / 'default-faces.json').write_text(json.dumps(faces, separators=(',', ':'), sort_keys=True))
    print('faces: %d plain faces left out, %d kept, %d devices indexed' % (deleted, kept, len(faces)))
    write_sizes(dist)
    pack_exports(root / 'assets' / 'exports')


if __name__ == '__main__':
    main(sys.argv[1:])
