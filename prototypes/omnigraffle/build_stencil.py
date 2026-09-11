#!/usr/bin/env python3
"""Portrayal -> OmniGraffle, one device, as a prototype.

The same representation the draw.io export settled on (site/drawio.js): the
compiled face as ONE image, plus one invisible, named shape over every port and
bay. A line drawn to a port attaches to that shape, so the diagram records WHICH
port it landed on, not a point on a picture.

Why not magnets: a line attached to a magnet stores only the magnet's INDEX
(`Head: {ID, Info: n}`), never a name - the same trap as draw.io's exitX/exitY.
A shape per port keeps the address; it also shows in OmniGraffle's sidebar by
`Name`, and carries `UserInfo` key/value data a script can read.

Why PDF: OmniGraffle embeds images as files, and PDF is the format the one
working SVG-to-stencil tool uses. rsvg-convert, not cairosvg - every compiled
face uses CSS var() for lamp colours and cairosvg cannot parse it.

True scale: the PDF page is the face's own size in mm, so 1 mm is 72/25.4 pt
and every Bounds below is in points on that footing.

UNVERIFIED IN OMNIGRAFFLE - it is not installed where this was written. Several
variants are written so one session on a Mac that has it answers the open
questions at once; see README.md.
"""
import copy, gzip, json, os, plistlib, shutil, subprocess, sys, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.dirname(os.path.dirname(HERE))
DIST = os.path.join(SITE, 'assets', 'dist')
TPL = os.path.join(HERE, 'templates')
OUT = os.path.join(HERE, 'out')
PT = 72 / 25.4                      # points per millimetre
GAP = 50.0                          # points between stencil items on the sheet

TINT = {'port': (0.0, 0.627, 1.0, 0.22), 'bay': (0.961, 0.651, 0.137, 0.16)}


def rect(x, y, w, h):
    return '{{%s, %s}, {%s, %s}}' % tuple(f'{v:.4f}'.rstrip('0').rstrip('.') for v in (x, y, w, h))


def color(rgba):
    r, g, b, a = rgba
    return {'r': r, 'g': g, 'b': b, 'a': a, 'space': 'srgb'}


def no_draw():
    return {'fill': {'Draws': 'NO'}, 'stroke': {'Draws': 'NO'}, 'shadow': {'Draws': 'NO'}}


def zone_shape(gid, z, ox, oy, device, face, tinted):
    style = no_draw()
    if tinted:
        c = color(TINT[z['cls']])
        style = {'fill': {'Color': c}, 'stroke': {'Color': c, 'Width': 0.5}, 'shadow': {'Draws': 'NO'}}
    info = {'portrayal-device': device, 'portrayal-face': face, 'portrayal-path': z['path'],
            'portrayal-class': z['cls']}
    for k in ('group', 'media', 'speed', 'model'):
        if z.get(k):
            info[f'portrayal-{k}'] = z[k]
    return {
        'Class': 'ShapedGraphic', 'ID': gid, 'Shape': 'Rectangle', 'Name': z['path'],
        'Bounds': rect(ox + z['x'] * PT, oy + z['y'] * PT,
                       max(z['w'], 0.5) * PT, max(z['h'], 0.5) * PT),
        # one magnet, dead centre: a socket takes a cable in the middle, and the
        # draw.io export does the same with points=[[0.5,0.5,0]]
        'Magnets': ['{0, 0}'],
        'Style': style,
        'UserInfo': info,
    }


def face_group(ids, face, zones, vb, image_id, ox, oy, device, label, tinted, grouped=True):
    """Front of the z-order FIRST: OmniGraffle paints the first graphic on top,
    the reverse of SVG. Ports, then bays, then the picture behind them all."""
    kids = []
    for cls in ('port', 'bay'):
        for z in zones:
            if z['cls'] == cls:
                kids.append(zone_shape(next(ids), z, ox, oy, device, face, tinted))
    kids.append({
        'Class': 'ShapedGraphic', 'ID': next(ids), 'ImageID': image_id,
        'Name': f'{label} {face} face',
        'Bounds': rect(ox, oy, vb[2] * PT, vb[3] * PT),
        # HOW THE IMAGE FILLS ITS SHAPE. A working stencil sets both, and the
        # second build - image registered, these absent - still drew nothing.
        'ManualSizeImage': 'NO', 'StretchImage': True,
        'Magnets': [], 'Style': no_draw(),
    })
    if not grouped:
        return kids
    return {'Class': 'Group', 'ID': next(ids), 'Name': f'{label} {face}',
            'Graphics': kids, 'Style': no_draw(),
            'UserInfo': {'portrayal-device': device, 'portrayal-face': face}}


def counter(start=1):
    n = start
    while True:
        yield n
        n += 1


def build(ports, tinted=False, cabling=False, zipped=False, grouped=True, ext='pdf'):
    """The data.plist for one variant. `cabling` adds one line between two port
    shapes, to prove a connection survives as a reference to a NAMED shape."""
    data = plistlib.load(open(os.path.join(TPL, 'data.plist'), 'rb'))
    sheet = plistlib.load(open(os.path.join(TPL, 'sheet.plist'), 'rb'))
    device, label, vb = ports['device'], 'UfiSpace S9510-28DC', ports['viewBox']
    ids, y, groups = counter(1), 0.0, []
    faces = [('front', 1), ('rear', 2)]
    for face, image_id in faces:
        groups.append(face_group(ids, face, ports[face], vb, image_id, 0.0, y, device, label,
                                 tinted, grouped))
        y += vb[3] * PT + GAP
    graphics = [x for g in groups for x in (g if isinstance(g, list) else [g])]
    if cabling:
        front = {g['Name']: g for g in groups[0]['Graphics']}
        a, b = front['port-2'], front['port-4']
        centre = lambda g: [float(v) for v in g['Bounds'].replace('{', '').replace('}', '').split(',')]
        ax, ay, aw, ah = centre(a); bx, by, bw, bh = centre(b)
        graphics.insert(0, {
            'Class': 'LineGraphic', 'ID': next(ids), 'Name': 'port-2 to port-4',
            'Points': [f'{{{ax + aw / 2:.3f}, {ay + ah / 2:.3f}}}', f'{{{bx + bw / 2:.3f}, {by + bh / 2:.3f}}}'],
            # PIN BOTH ENDS. Naming the shape alone left OmniGraffle to choose the
            # point: in the first editable test one end took the port's centre
            # and the other its edge. `Info` is the magnet an end is pinned to,
            # 1-based as openanvil/omnigraffle-generator records it, and a port
            # shape has exactly one - dead centre.
            'Tail': {'ID': a['ID'], 'Info': 1}, 'Head': {'ID': b['ID'], 'Info': 1},
            'Style': {'stroke': {'Width': 2.0, 'Color': color((0.87, 0.2, 0.2, 1.0)), 'Legacy': False}},
        })
    w = vb[2] * PT + 2 * GAP
    sheet['SheetTitle'] = label
    sheet['CanvasSize'] = '{%d, %d}' % (w, y + GAP)
    sheet['BackgroundGraphic']['Bounds'] = rect(0, 0, w, y + GAP)
    sheet['GraphicsList'] = graphics
    data['Sheets'] = [sheet]
    # THE IMAGE REGISTRY. OmniGraffle resolves `ImageID: n` to the nth name in
    # ImageList - the file merely being in the package is not enough. The first
    # build copied the template tool's EMPTY list, and OmniGraffle opened the
    # stencil with every port and name intact and no faceplate at all. A working
    # stencil (davidfsmith/AWS-OmniGraffle-Stencils, 2026) lists every file,
    # keeps one empty ImageLinkBack entry per image, and sets ImageCounter to the
    # next free id.
    data['ImageList'] = [f'image{image_id}.{ext}' for _, image_id in faces]
    data['ImageLinkBack'] = [{} for _ in faces]
    data['ImageCounter'] = len(faces) + 1
    data['FileType'] = 'zipped' if zipped else 'auto'
    return data


def faces_to_pdf(ports, scratch):
    out = {}
    for face, image_id in (('front', 1), ('rear', 2)):
        src = os.path.join(DIST, f's9510-28dc.{face}.svg')
        dst = os.path.join(scratch, f'image{image_id}.pdf')
        subprocess.run(['rsvg-convert', '-f', 'pdf', '-o', dst, src], check=True)
        out[image_id] = dst
    prev = os.path.join(scratch, 'preview')
    subprocess.run(['pdftoppm', '-jpeg', '-r', '72', '-singlefile', out[1], prev], check=True)
    out['preview'] = prev + '.jpg'
    return out


def faces_to_png(scratch, pxmm=8):
    """THE SAME FACES AS PNG, for the case where OmniGraffle decodes a PDF - its
    sidebar thumbnails show the faceplate - but will not paint it on the canvas.
    8 px/mm is a 3520 px wide front: sharp at any zoom anyone will use."""
    out = {}
    for face, image_id in (('front', 1), ('rear', 2)):
        src = os.path.join(DIST, f's9510-28dc.{face}.svg')
        dst = os.path.join(scratch, f'image{image_id}.png')
        subprocess.run(['rsvg-convert', '-f', 'png', '-w', str(440 * pxmm), '-o', dst, src], check=True)
        out[image_id] = dst
    return out


def write_package(path, data, assets, xml=True, gz=False, images=(1, 2), ext='pdf'):
    """No preview.jpeg in a package: OmniGraffle shows it as the sheet thumbnail,
    which made a blank canvas look like a working one in the second test."""
    if os.path.exists(path):
        shutil.rmtree(path)
    os.makedirs(path)
    raw = plistlib.dumps(data, fmt=plistlib.FMT_XML if xml else plistlib.FMT_BINARY)
    with open(os.path.join(path, 'data.plist'), 'wb') as fp:
        fp.write(gzip.compress(raw) if gz else raw)
    for i in images:
        shutil.copy(assets[i], os.path.join(path, f'image{i}.{ext}'))


def write_zip(path, data, assets, xml):
    if os.path.exists(path):
        os.remove(path)
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('data.plist', plistlib.dumps(data, fmt=plistlib.FMT_XML if xml else plistlib.FMT_BINARY))
        for k, src in assets.items():
            z.write(src, 'preview.jpeg' if k == 'preview' else f'image{k}.pdf')


def build_aws_control(ports, ext='pdf'):
    """THE CONTROL: davidfsmith/AWS-OmniGraffle-Stencils' own working document,
    changed only where it must be - one image graphic, cloned from theirs, now
    pointing at our front faceplate. Top level, no group, no port shapes. If
    this does not draw, the fault is in our PDF, not in anything we wrote."""
    d = plistlib.loads(gzip.decompress(open(os.path.join(TPL, 'aws-data.plist.gz'), 'rb').read()))
    sheet = d['Sheets'][0]
    g = copy.deepcopy(sheet['GraphicsList'][0])
    vb = ports['viewBox']
    g.update({'ID': 1, 'ImageID': 1, 'Bounds': rect(0, 0, vb[2] * PT, vb[3] * PT),
              'Name': 'S9510-28DC front (AWS control)', 'Notes': 'S9510-28DC front (AWS control)'})
    sheet['GraphicsList'] = [g]
    sheet['CanvasSize'] = '{%d, %d}' % (vb[2] * PT + 2 * GAP, vb[3] * PT + 2 * GAP)
    d['ImageList'], d['ImageLinkBack'], d['ImageCounter'] = [f'image1.{ext}'], [{}], 2
    return d


def check(data, where):
    """What can be proved without OmniGraffle: every ImageID has a file behind
    it, every line end names a shape that exists, ids are unique."""
    seen, images, ends = set(), set(), []
    def walk(gs):
        for g in gs:
            assert g['ID'] not in seen, f'{where}: duplicate ID {g["ID"]}'
            seen.add(g['ID'])
            if 'ImageID' in g:
                images.add(g['ImageID'])
            for end in ('Head', 'Tail'):
                if isinstance(g.get(end), dict):
                    ends.append(g[end]['ID'])
            walk(g.get('Graphics', []))
    for s in data['Sheets']:
        walk(s['GraphicsList'])
    listed = data.get('ImageList') or []
    for i in images:
        assert 1 <= i <= len(listed), f'{where}: ImageID {i} not in ImageList {listed}'
    assert len(data.get('ImageLinkBack') or []) == len(listed), f'{where}: ImageLinkBack/ImageList mismatch'
    for e in ends:
        assert e in seen, f'{where}: line end names missing shape {e}'
    return len(seen)


def main():
    ports = json.load(open(os.path.join(HERE, 's9510-28dc.ports.json')))
    os.makedirs(OUT, exist_ok=True)
    scratch = os.path.join(OUT, '.build')
    os.makedirs(scratch, exist_ok=True)
    assets = faces_to_pdf(ports, scratch)
    png = faces_to_png(scratch)
    pkg = lambda src=None, **o: (lambda p, d: write_package(p, d, src or assets, **o))
    variants = [
        # (file name, how to build it, writer)
        ('S9510-28DC.gstencil',             dict(),                  pkg(xml=True)),
        ('S9510-28DC tinted.gstencil',      dict(tinted=True),       pkg(xml=True)),
        ('S9510-28DC zipped.gstencil',      dict(zipped=True),       lambda p, d: write_zip(p, d, assets, xml=False)),
        ('S9510-28DC zipped-text.gstencil', dict(zipped=True),       lambda p, d: write_zip(p, d, assets, xml=True)),
        ('S9510-28DC cabling test.graffle', dict(cabling=True),      pkg(xml=True)),
        # the diagnostic ladder: each changes one thing, so the one that draws names the fault
        ('diagnostics/1 AWS control.gstencil', dict(aws=True),       pkg(xml=True, gz=True, images=(1,))),
        ('diagnostics/2 ungrouped.gstencil',   dict(grouped=False),  pkg(xml=True, gz=True)),
        ('diagnostics/3 grouped gzipped.gstencil', dict(),           pkg(xml=True, gz=True)),
        # 4 is the AWS stencil itself, unmodified - fetched, not built
        ('diagnostics/5 AWS control PNG.gstencil', dict(aws=True, ext='png'),
                                                      pkg(src=png, xml=True, gz=True, images=(1,), ext='png')),
        ('diagnostics/6 device PNG.gstencil',  dict(ext='png'),      pkg(src=png, xml=True, gz=True, ext='png')),
    ]
    os.makedirs(os.path.join(OUT, 'diagnostics'), exist_ok=True)
    for name, kw, writer in variants:
        kw = dict(kw)
        data = (build_aws_control(ports, ext=kw.get('ext', 'pdf')) if kw.pop('aws', False)
                else build(ports, **kw))
        n = check(data, name)
        writer(os.path.join(OUT, name), data)
        print(f'  {name:36} {n:3} graphics')
    shutil.rmtree(scratch)


if __name__ == '__main__':
    sys.exit(main())
