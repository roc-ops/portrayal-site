#!/usr/bin/env python3
"""Portrayal -> Visio, as a .vsdx drawing. A prototype, not the shipped export.

The same idea as the draw.io and OmniGraffle exports: the compiled faceplate as
one picture, plus an invisible shape over every port and bay, so a connector
drawn to a port attaches to THAT PORT rather than to a point on a picture.

Why a drawing (.vsdx) first, when the thing we eventually want is a stencil
(.vssx): a drawing is the format everything opens. Visio for the web opens one,
Lucidchart imports one, and the minimal part tree for a drawing is the one piece
of this format with a known-good browser-side reference implementation
(mermaid-to-visio, MIT). The stencil's minimal part set is not documented
anywhere authoritative, so it is worth finding out whether Visio accepts our
shapes at all before also gambling on a container it will not describe.

The identity question this prototype exists to answer:

  Visio records a connector's attachment as a SHAPE ID plus a numeric part, not
  as a name. Connection points can be named, but recovering that name means
  joining a number back to the shape's rows by their order in the file, which is
  not documented and looks fragile. So each port here is its own sub-shape, and
  a connector glued to it names the port's shape directly. Every port also
  carries its path as Shape Data, which is what a human sees in Visio's Shape
  Data window, and again as a User cell, which a human cannot edit by accident.

Units: Visio works in inches internally, with the page origin at the BOTTOM
left and y increasing upward. Portrayal's geometry is millimetres from the TOP
left, so every y is flipped here.
"""

import json, os, struct, zipfile

MM = 25.4                                   # inches per millimetre is 1/MM
XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
NS = 'http://schemas.microsoft.com/office/visio/2012/main'
NSR = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

HERE = os.path.dirname(os.path.abspath(__file__))
PORTS = os.path.join(HERE, '..', 'omnigraffle', 's9510-28dc.ports.json')


def esc(s):
    return (str(s).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
            .replace('"', '&quot;').replace("'", '&apos;'))


def n(v):
    return f'{round(float(v), 6):g}'


def png_size(path):
    with open(path, 'rb') as fh:
        return struct.unpack('>II', fh.read(24)[16:24])


# ── shapes ───────────────────────────────────────────────────────────────
def cell(name, v, f=None):
    return f'<Cell N="{name}" V="{esc(v)}"' + (f' F="{esc(f)}"/>' if f else '/>')


def port_shape(sid, z, face_h_in):
    """One port or bay: an invisible rectangle a connector can glue to.

    Named three ways on purpose, because which one survives a round trip
    through Visio is exactly what we do not know yet: the shape's own NameU,
    a named connection point, and a Shape Data row the user can read.
    """
    x, y = z['x'] / MM, z['y'] / MM
    w, h = max(z['w'], 0.4) / MM, max(z['h'], 0.4) / MM
    pin_y = face_h_in - y - h / 2          # flip: Visio counts y upward
    path = z.get('path') or z['id']
    props = [('PortPath', 'Port', path)]
    for k in ('cls', 'group', 'media', 'speed', 'model'):
        if z.get(k):
            props.append((k.capitalize(), k.capitalize(), z[k]))
    rows = ''.join(
        f'<Row N="{esc(nm)}"><Cell N="Label" V="{esc(lab)}"/>'
        f'<Cell N="Value" V="{esc(val)}"/><Cell N="Type" V="0"/></Row>'
        for nm, lab, val in props)
    return f'''<Shape ID="{sid}" NameU="{esc(path)}" Name="{esc(path)}" Type="Shape">
{cell('PinX', n(x + w / 2))}{cell('PinY', n(pin_y))}
{cell('Width', n(w))}{cell('Height', n(h))}
{cell('LocPinX', n(w / 2), 'Width*0.5')}{cell('LocPinY', n(h / 2), 'Height*0.5')}
{cell('LineWeight', '0')}{cell('LinePattern', '0')}{cell('FillPattern', '0')}
<Section N="Connection"><Row N="{esc(path)}">
{cell('X', n(w / 2), 'Width*0.5')}{cell('Y', n(h / 2), 'Height*0.5')}
</Row></Section>
<Section N="Property">{rows}</Section>
<Section N="User"><Row N="PortrayalPath">{cell('Value', path)}</Row></Section>
</Shape>'''


def image_shape(sid, rid, w_in, h_in):
    """The faceplate. A Foreign shape whose ForeignData points at a PNG part."""
    return f'''<Shape ID="{sid}" NameU="Faceplate" Name="Faceplate" Type="Foreign">
{cell('PinX', n(w_in / 2))}{cell('PinY', n(h_in / 2))}
{cell('Width', n(w_in))}{cell('Height', n(h_in))}
{cell('LocPinX', n(w_in / 2), 'Width*0.5')}{cell('LocPinY', n(h_in / 2), 'Height*0.5')}
{cell('ImgOffsetX', '0')}{cell('ImgOffsetY', '0')}
{cell('ImgWidth', n(w_in), 'Width*1')}{cell('ImgHeight', n(h_in), 'Height*1')}
{cell('LineWeight', '0')}{cell('LinePattern', '0')}{cell('FillPattern', '0')}
<ForeignData ForeignType="Bitmap" CompressionType="PNG"><Rel r:id="{rid}"/></ForeignData>
</Shape>'''


def connector(sid, a, b):
    """A 1-D line, glued below by <Connect>. Geometry is a straight segment;
    the glue is what makes it follow the ports when they move."""
    return f'''<Shape ID="{sid}" NameU="Cable" Name="Cable" Type="Shape">
{cell('PinX', '0')}{cell('PinY', '0')}{cell('Width', '1')}{cell('Height', '1')}
{cell('LocPinX', '0')}{cell('LocPinY', '0')}
{cell('BeginX', n(a[0]))}{cell('BeginY', n(a[1]))}
{cell('EndX', n(b[0]))}{cell('EndY', n(b[1]))}
{cell('ObjType', '2')}{cell('LineWeight', '0.01')}
<Section N="Geometry" IX="0">
<Cell N="NoFill" V="1"/>
<Row T="MoveTo" IX="1">{cell('X', '0', 'BeginX')}{cell('Y', '0', 'BeginY')}</Row>
<Row T="LineTo" IX="2">{cell('X', '1', 'EndX')}{cell('Y', '1', 'EndY')}</Row>
</Section>
</Shape>'''


# ── package ──────────────────────────────────────────────────────────────
def page_xml(shapes, connects):
    return (f'{XML}\n<PageContents xmlns="{NS}" xmlns:r="{NSR}" xml:space="preserve">'
            f'<Shapes>{shapes}</Shapes>'
            + (f'<Connects>{connects}</Connects>' if connects else '')
            + '</PageContents>')


def build(faces, out, cable=True):
    """faces: [{'name','png','zones','vb'}] - one page each."""
    pages, page_parts, rels, ctypes, media = [], [], [], [], []
    for i, f in enumerate(faces, 1):
        vb = f['vb']
        w_in, h_in = vb[2] / MM, vb[3] / MM
        sid = 1
        img_rid = 'rId1'
        shapes = [image_shape(sid, img_rid, w_in, h_in)]
        sid += 1
        byid, connects = {}, ''
        for z in f['zones']:
            byid[z.get('path') or z['id']] = (sid, z)
            shapes.append(port_shape(sid, z, h_in))
            sid += 1
        # A cable drawn for us between the first two real ports, so the very
        # first thing we can check is what Visio saved for an attachment it
        # did not have to guess at.
        ports = [p for p in f['zones'] if p['cls'] == 'port']
        if cable and len(ports) >= 2:
            a, b = ports[0], ports[1]
            ida, idb = byid[a.get('path') or a['id']][0], byid[b.get('path') or b['id']][0]
            ca = ((a['x'] + a['w'] / 2) / MM, h_in - (a['y'] + a['h'] / 2) / MM)
            cb = ((b['x'] + b['w'] / 2) / MM, h_in - (b['y'] + b['h'] / 2) / MM)
            shapes.append(connector(sid, ca, cb))
            connects = (f'<Connect FromSheet="{sid}" FromCell="BeginX" FromPart="9" '
                        f'ToSheet="{ida}" ToCell="PinX" ToPart="3"/>'
                        f'<Connect FromSheet="{sid}" FromCell="EndX" FromPart="12" '
                        f'ToSheet="{idb}" ToCell="PinX" ToPart="3"/>')
            sid += 1

        page_parts.append((f'visio/pages/page{i}.xml', page_xml(''.join(shapes), connects)))
        media.append((f'visio/media/image{i}.png', f['png']))
        pages.append(f'''<Page ID="{i - 1}" NameU="{esc(f['name'])}" Name="{esc(f['name'])}"
 ViewScale="-1" ViewCenterX="{n(w_in / 2)}" ViewCenterY="{n(h_in / 2)}"><PageSheet>
{cell('PageWidth', n(w_in))}{cell('PageHeight', n(h_in))}
{cell('ShdwOffsetX', '0.1181')}{cell('ShdwOffsetY', '-0.1181')}
{cell('PageScale', '1')}{cell('DrawingScale', '1')}
{cell('DrawingSizeType', '3')}{cell('DrawingScaleType', '0')}
</PageSheet><Rel r:id="rId{i}"/></Page>''')

    parts = {
        '_rels/.rels': f'''{XML}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/document" Target="visio/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>''',
        'docProps/core.xml': f'''{XML}
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
 xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>S9510-28DC</dc:title>
<dc:creator>portrayal.dev</dc:creator></cp:coreProperties>''',
        'docProps/app.xml': f'''{XML}
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
<Application>Portrayal</Application></Properties>''',
        'visio/document.xml': f'''{XML}
<VisioDocument xmlns="{NS}" xmlns:r="{NSR}" xml:space="preserve">
<DocumentSettings TopPage="0" DefaultTextStyle="0" DefaultLineStyle="0"
 DefaultFillStyle="0" DefaultGuideStyle="0"/>
<Colors/><FaceNames/><StyleSheets/></VisioDocument>''',
        'visio/_rels/document.xml.rels': f'''{XML}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/pages" Target="pages/pages.xml"/>
<Relationship Id="rId2" Type="http://schemas.microsoft.com/visio/2010/relationships/windows" Target="windows.xml"/>
</Relationships>''',
        'visio/windows.xml': f'{XML}\n<Windows xmlns="{NS}" xmlns:r="{NSR}" ClientWidth="1000" ClientHeight="800"/>',
        'visio/pages/pages.xml': f'{XML}\n<Pages xmlns="{NS}" xmlns:r="{NSR}" xml:space="preserve">'
                                 + ''.join(pages) + '</Pages>',
        'visio/pages/_rels/pages.xml.rels': f'''{XML}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'''
        + ''.join(f'<Relationship Id="rId{i}" Type="http://schemas.microsoft.com/visio/2010/relationships/page"'
                  f' Target="page{i}.xml"/>' for i in range(1, len(faces) + 1))
        + '</Relationships>',
    }
    for i, (name, text) in enumerate(page_parts, 1):
        parts[name] = text
        # each page owns its own image, by an explicit relationship
        parts[f'visio/pages/_rels/page{i}.xml.rels'] = f'''{XML}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"
 Target="../media/image{i}.png"/></Relationships>'''

    overrides = ''.join(
        f'<Override PartName="/visio/pages/page{i}.xml" ContentType="application/vnd.ms-visio.page+xml"/>'
        for i in range(1, len(faces) + 1))
    parts['[Content_Types].xml'] = f'''{XML}
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Override PartName="/visio/document.xml" ContentType="application/vnd.ms-visio.drawing.main+xml"/>
<Override PartName="/visio/pages/pages.xml" ContentType="application/vnd.ms-visio.pages+xml"/>
{overrides}
<Override PartName="/visio/windows.xml" ContentType="application/vnd.ms-visio.windows+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>'''

    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        # [Content_Types].xml first, as every OPC writer puts it
        z.writestr('[Content_Types].xml', parts.pop('[Content_Types].xml'))
        for name, text in parts.items():
            z.writestr(name, text)
        for name, data in media:
            z.writestr(name, data, zipfile.ZIP_STORED)
    return out


def main():
    d = json.load(open(PORTS))
    vb = d['viewBox']
    faces = []
    for face in ('front', 'rear'):
        png = os.path.join(HERE, 'out', f'{face}.png')
        if not os.path.exists(png):
            continue
        faces.append({'name': f'S9510-28DC {face}', 'png': open(png, 'rb').read(),
                      'zones': d[face], 'vb': vb})
    out = os.path.join(HERE, 'out', 's9510-28dc.vsdx')
    build(faces, out)
    print('wrote', out, os.path.getsize(out), 'bytes',
          '|', sum(len(f['zones']) for f in faces), 'zones over', len(faces), 'pages')


if __name__ == '__main__':
    main()
