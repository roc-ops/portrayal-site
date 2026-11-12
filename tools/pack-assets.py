#!/usr/bin/env python3
"""Make assets/ small enough to serve: ship the drawings as packs, pack what a page
fetches in bulk.

    tools/pack-assets.py <site root> <built dist>   after a refresh: copy, then pack
    tools/pack-assets.py <site root>                pack a tree as it stands

portrayal.dev is served from a host that takes a limited number of files per
version, and two kinds of file made up most of the count:

  - the drawings, one file per face and per skin. refresh-assets.sh writes them
    as packs instead, with Portrayal's own spec/tools/dev/dist_packs.py, into
    assets/dist/packs/ (site/dist.js reads them). Given the built dist, this
    script copies loose only the PLAIN_FILES names that pages and recipes read by
    name, and refuses a tree that holds any other drawing outside a pack.
    assets/dist/default-faces.json says which file draws each device's default
    face (site/faces.js defaultFace).
  - the DCIM exports, one YAML per device type and per target. They are packed
    into assets/exports/packs/<target>/<manufacturer>.json, a map of the path
    files.json lists to the file's text (site/exports-pack.js exportText).

It also rewrites assets/dist/sizes.json, so it lists the drawings the site serves,
loose or packed. refresh-assets.sh runs this before check-contract.py; a second
run changes nothing.
"""
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path, PurePosixPath

# Devices whose plain faces stay: the kit's recipes (site/kit-examples) and the
# home page fetch these by plain name, as a user of Portrayal's own build would.
KEEP_PLAIN = ['s9600-72xc', 'evma8365x']

VIEWS = ['front', 'rear', 'left', 'right', 'top', 'bottom']
TARGETS = ['netbox', 'nautobot', 'fibre-maps']

# The drawings served as loose files beside the packs, by their dist paths: the
# plain faces of the KEEP_PLAIN devices, which the recipes and the home page
# fetch by name, and the skins recipe 04 (site/kit-examples/04-seat.js) seats.
# No pack holds a plain face, so these are read by their plain URL, never
# through site/dist.js.
PLAIN_SKINS = ['components/generic--sfp-lc--v1--default.svg', 'components/generic--lc-plug--v2--default.svg']
PLAIN_FILES = [f'{dev}.{view}.svg' for dev in KEEP_PLAIN for view in VIEWS] + PLAIN_SKINS


# ── the drawings' packs (Portrayal spec/tools/dev/dist_packs.py) ──────────────
# devices/<device>.json holds the faces the default configuration names and
# devices/<device>.more.json every other face a configuration names;
# components/<ns>.<k>.json holds a namespace's skins, chunk k found through
# components/index.json. Each is {"files": {<dist path>: <svg text>}, ...}.

def pack_entries(dist):
    """(path, text) for every drawing in every pack under dist/packs. One pack is
    held at a time: together they are hundreds of megabytes."""
    packs = Path(dist) / 'packs'
    for p in sorted(packs.rglob('*.json')) if packs.is_dir() else []:
        if p.relative_to(packs).as_posix() == 'components/index.json':
            continue
        yield from sorted((json.loads(p.read_bytes()).get('files') or {}).items())


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


def copy_plain(built, dist):
    """Copy the PLAIN_FILES from the built dist into the site's. A file the build
    does not have stops the run, and so does a drawing in the site's dist that is
    neither one of them nor in a pack: the packs are the only other way to a face."""
    packs = dist / 'packs'
    if not (packs / 'devices').is_dir() or not (packs / 'components' / 'index.json').is_file():
        sys.exit(f'no packs under {packs}: run Portrayal spec/tools/dev/dist_packs.py first')
    for rel in PLAIN_FILES:
        if not (built / rel).is_file():
            sys.exit(f'not copied - {built / rel} is not in the build')
        (dist / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(built / rel, dist / rel)
    left = sorted(p.relative_to(dist).as_posix() for p in dist.rglob('*.svg')
                  if p.relative_to(dist).as_posix() not in PLAIN_FILES)
    if left:
        sys.exit('drawings left outside the packs, first: %s (%d in all)' % (left[0], len(left)))
    print('plain: %d drawings copied loose' % len(PLAIN_FILES))


def write_sizes(dist):
    """A size index for the drawings, so a page can say how big a download will
    be BEFORE it builds it (a whole-vendor draw.io library is tens of megabytes).
    Keyed by the drawing's dist path, for the packed drawings and the loose ones:
    a pack entry's size is the bytes of the file it was made from."""
    found = {rel: len(text.encode('utf-8')) for rel, text in pack_entries(dist)}
    for path in dist.rglob('*.svg'):
        found[path.relative_to(dist).as_posix()] = path.stat().st_size
    sizes = {rel: found[rel] for rel in sorted(found, key=PurePosixPath)}
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
    if len(argv) not in (1, 2):
        sys.exit(__doc__)
    root = Path(argv[0])
    dist = root / 'assets' / 'dist'
    if len(argv) == 2:
        copy_plain(Path(argv[1]), dist)
    faces = default_faces(dist)
    (dist / 'default-faces.json').write_text(json.dumps(faces, separators=(',', ':'), sort_keys=True))
    print('faces: %d devices indexed' % len(faces))
    write_sizes(dist)
    pack_exports(root / 'assets' / 'exports')


if __name__ == '__main__':
    main(sys.argv[1:])
