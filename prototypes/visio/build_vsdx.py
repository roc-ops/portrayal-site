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
# A closed rectangle in the shape's OWN coordinate space, as every Visio
# rectangle is written: corners as formulas of Width and Height, so the outline
# follows the shape when it is resized. Round 1 omitted this entirely.
RECT_GEOMETRY = """<Section N="Geometry" IX="0">
<Cell N="NoFill" V="0"/><Cell N="NoLine" V="0"/>
<Row T="MoveTo" IX="1"><Cell N="X" V="0" F="Width*0"/><Cell N="Y" V="0" F="Height*0"/></Row>
<Row T="LineTo" IX="2"><Cell N="X" V="1" F="Width*1"/><Cell N="Y" V="0" F="Height*0"/></Row>
<Row T="LineTo" IX="3"><Cell N="X" V="1" F="Width*1"/><Cell N="Y" V="1" F="Height*1"/></Row>
<Row T="LineTo" IX="4"><Cell N="X" V="0" F="Width*0"/><Cell N="Y" V="1" F="Height*1"/></Row>
<Row T="LineTo" IX="5"><Cell N="X" V="0" F="Width*0"/><Cell N="Y" V="0" F="Height*0"/></Row>
</Section>"""


def cell(name, v, f=None):
    return f'<Cell N="{name}" V="{esc(v)}"' + (f' F="{esc(f)}"/>' if f else '/>')


def port_shape(sid, z, face_h_in, tint=False, vb=(0, 0, 0, 0), locked=False,
               container=False):
    """One port or bay: a rectangle a connector can glue to.

    ROUND 2. Two fixes, both found by round 1 opening in Visio and Lucidchart
    with 43 shapes that could not be clicked in either:

    - A shape needs an explicit GEOMETRY section. Position and size alone give
      Visio nothing to draw or hit-test, so round 1 produced 43 empty shapes.
    - Invisible has to mean a TRANSPARENT FILL, not an absent one. A shape with
      FillPattern 0 has no surface to click; one with a fully transparent fill
      still hit-tests. That is how a stencil's invisible connection targets are
      built, and it is what we do in the draw.io and OmniGraffle exports too.

    Identity rides on the shape, not on the connection point: a Connect names
    a connection point by INDEX, so the port's name has to come from the shape
    it belongs to. Hence one shape per port, its path in NameU, and the same
    path again as Shape Data the user can read and a User cell they cannot
    edit by accident. A row carries either a name or an index, not both, so
    this row is keyed by index - it is the shape around it that is named.
    """
    x, y = (z['x'] - vb[0]) / MM, (z['y'] - vb[1]) / MM
    w, h = max(z['w'], 0.4) / MM, max(z['h'], 0.4) / MM
    pin_y = face_h_in - y - h / 2          # flip: Visio counts y upward
    path = z.get('path') or z['id']
    props = [('PortPath', 'Port', path)]
    for k in ('cls', 'group', 'media', 'speed', 'model'):
        if z.get(k):
            props.append((k.capitalize(), k.capitalize(), z[k]))
    # ROUND 7, VARIANT B: locked so a port cannot be dragged out of its own
    # device and does not compete with it for the click.
    lock = (cell('LockMoveX', '1') + cell('LockMoveY', '1') + cell('LockDelete', '1')
            + cell('LockSelect', '1')) if locked else ''
    # Visio's own structured-diagram machinery: a shape that says it is a
    # Container becomes something other shapes are dropped INTO and carried
    # with. That is what "seat a card in a slot" would mean here - as against
    # a card merely parked on top of a slot, which is all a drawing can do
    # otherwise. Containers have to be selectable, so this is never locked.
    if container and z['cls'] == 'bay':
        lock = (cell('DisplayMode', '2')
                + '<Section N="User">'
                + f'<Row N="msvStructureType">{cell("Value", "Container", chr(34) + "Container" + chr(34))}</Row>'
                + f'<Row N="msvSDContainerResize">{cell("Value", "0")}</Row>'
                + f'<Row N="msvSDContainerMargin">{cell("Value", "0")}</Row>'
                + '</Section>')
    # A Shape Data value is a FORMULA, and a string one has to be quoted.
    # Round 8 wrote bare values and Visio read them as numbers: every string
    # showed as 0 in the Shape Data pane, while a speed of 100 came through
    # because it happened to be a number.
    rows = ''.join(
        f'<Row N="{esc(nm)}"><Cell N="Label" V="{esc(lab)}"/>'
        f'<Cell N="Value" V="{esc(val)}" F="&quot;{esc(val)}&quot;"/>'
        f'<Cell N="Type" V="0"/></Row>'
        for nm, lab, val in props)
    # A BAY gets two more points, at its left and right edges on the centre
    # line - rails, in the sense a rack has rails. A module is a 1-D shape and
    # glues by its two ENDS, so a slot needs two places to hold it, not one.
    # Type 0 is an inward point, which is what an end may attach to.
    rails = (f'<Row IX="2">' + cell('X', '0', 'Width*0')
             + cell('Y', n(h / 2), 'Height*0.5')
             + cell('DirX', '0') + cell('DirY', '0') + cell('Type', '0') + '</Row>'
             f'<Row IX="3">' + cell('X', n(w), 'Width*1')
             + cell('Y', n(h / 2), 'Height*0.5')
             + cell('DirX', '0') + cell('DirY', '0') + cell('Type', '0') + '</Row>'
             ) if z['cls'] == 'bay' else ''
    # ROUND 4. Transparency in the FILE is a fraction, 0 to 1, whatever the
    # ShapeSheet documentation says about percentages - that is the number the
    # user interface shows. Round 3 wrote 100 meaning 100% and got a solid
    # white box over every port, which is what the screenshots showed. 1 is
    # fully transparent, and the fill still hit-tests, which is the whole
    # reason for filling it at all.
    if tint:
        skin = (cell('FillPattern', '1')
                + cell('FillForegnd', '#0aa0ff' if z['cls'] == 'port' else '#f5a623')
                + cell('FillForegndTrans', '0.5') + cell('FillBkgndTrans', '0.5')
                + cell('LinePattern', '1') + cell('LineWeight', '0.005')
                + cell('LineColor', '#0aa0ff' if z['cls'] == 'port' else '#f5a623'))
    else:
        skin = (cell('FillPattern', '1') + cell('FillForegnd', '#ffffff')
                + cell('FillForegndTrans', '1') + cell('FillBkgndTrans', '1')
                + cell('LinePattern', '0') + cell('LineWeight', '0'))
    nameu = shapename(path)
    return f'''<Shape ID="{sid}" NameU="{esc(nameu)}" Name="{esc(nameu)}" Type="Shape">
{cell('PinX', n(x + w / 2))}{cell('PinY', n(pin_y))}
{cell('Width', n(w))}{cell('Height', n(h))}
{cell('LocPinX', n(w / 2), 'Width*0.5')}{cell('LocPinY', n(h / 2), 'Height*0.5')}
{cell('Angle', '0')}{skin}{lock}
{RECT_GEOMETRY}
<Section N="Connection"><Row IX="1">
{cell('X', n(w / 2), 'Width*0.5')}{cell('Y', n(h / 2), 'Height*0.5')}
{cell('DirX', '0')}{cell('DirY', '0')}{cell('Type', '0')}
</Row>{rails}</Section>
<Section N="Property">{rows}</Section>
<Section N="User"><Row N="PortrayalPath">{cell('Value', path)}</Row></Section>
</Shape>'''


def shapename(path):
    """A Visio shape name cannot carry a slash.

    Round 8 named each port after its path, and the ones with a path like
    ndc/module/port-1 - a port on a card seated in a bay - came out as
    "Sheet.15" while plain names like mgmt survived.

    Round 9 tried dots and they failed the same way, which should have been
    obvious: a dot is Visio's OWN separator, as in Sheet.14. Underscores.
    The full path stays in Shape Data, which is where a machine should read it
    from anyway.
    """
    return str(path).replace('/', '_')


def rowname(path):
    """Visio row names are identifiers: letters, digits and underscore."""
    n = ''.join(c if c.isalnum() else '_' for c in str(path))
    return ('p_' + n) if not n[:1].isalpha() else n


def points_shape(sid, rid, w_in, h_in, zones, vb, item):
    """ROUND 7, VARIANT A: the device as ONE shape, ports as CONNECTION POINTS.

    The sub-shape design gave Visio 40 separately clickable things stacked on a
    picture, and all three complaints follow from that: the device is hard to
    grab because every port is in the way, a port can be dragged out of its own
    device, and glue stopped following the device once the ports moved into a
    group's coordinate space.

    A connection point is Visio's own answer to "a place on a shape you attach
    to". It cannot be selected, cannot be dragged off, and moves with the shape
    because it is PART of the shape rather than a neighbour of it.

    What it costs: a bay stops being an area you can drop onto and becomes a
    point like any other, and per-port data lives on the device rather than on
    38 separate shapes - so it goes into User rows, one per port, named after
    the port and holding everything the model knows about it.

    NOT the design that won. Tested as r7a and it was inert - not selectable,
    no connection points, a bare picture - because these sections were emitted
    AFTER ForeignData, where the schema puts them before it. Corrected here so
    the shape form is right if the stencil ever wants it, but round 7 chose the
    locked group instead, on evidence.
    """
    rows, users = [], []
    for z in zones:
        path = z.get('path') or z['id']
        cx = (z['x'] - vb[0] + z['w'] / 2) / MM
        cy = h_in - (z['y'] - vb[1] + z['h'] / 2) / MM      # Visio counts y up
        nm = rowname(path)
        rows.append(f'<Row N="{esc(nm)}">'
                    + cell('X', n(cx), f'Width*{n(cx / w_in)}')
                    + cell('Y', n(cy), f'Height*{n(cy / h_in)}')
                    + cell('DirX', '0') + cell('DirY', '0') + cell('Type', '0')
                    + '</Row>')
        meta = '|'.join(str(z.get(k) or '') for k in ('cls', 'group', 'media', 'speed'))
        users.append(f'<Row N="{esc(nm)}">' + cell('Value', path)
                     + cell('Prompt', meta) + '</Row>')
    props = ''.join(
        f'<Row N="{esc(k)}"><Cell N="Label" V="{esc(k)}"/>'
        f'<Cell N="Value" V="{esc(v)}" F="&quot;{esc(v)}&quot;"/>'
        f'<Cell N="Type" V="0"/></Row>'
        for k, v in (('Device', item.get('ref') or item['name']),
                     ('Face', item.get('face') or ''),
                     ('Ports', str(len(zones)))) if v)
    return f'''<Shape ID="{sid}" NameU="{esc(item["name"])}" Name="{esc(item["name"])}" Type="Foreign">
{cell('PinX', n(w_in / 2))}{cell('PinY', n(h_in / 2))}
{cell('Width', n(w_in))}{cell('Height', n(h_in))}
{cell('LocPinX', n(w_in / 2), 'Width*0.5')}{cell('LocPinY', n(h_in / 2), 'Height*0.5')}
{cell('Angle', '0')}
{cell('ImgOffsetX', '0')}{cell('ImgOffsetY', '0')}
{cell('ImgWidth', n(w_in), 'Width*1')}{cell('ImgHeight', n(h_in), 'Height*1')}
{cell('LineWeight', '0')}{cell('LinePattern', '0')}{cell('FillPattern', '0')}
<Section N="Connection">{''.join(rows)}</Section>
<Section N="User">{''.join(users)}</Section>
<Section N="Property">{props}</Section>
<ForeignData ForeignType="Bitmap" CompressionType="PNG"><Rel r:id="{rid}"/></ForeignData>
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


def connector(sid, a, b, ida, idb):
    """A cable between two ports.

    ROUND 3. Three things round 2 still lacked, all of which Visio needs before
    it treats this as a connector that is really attached:

    - `OneD`, the cell that makes a shape one-dimensional at all.
    - Glue FORMULAS in the endpoint cells. The <Connect> elements alone are the
      documented shorthand, but a file Visio wrote itself also carries
      PAR(PNT(Sheet.n!Connections.X1, ...)) - the formula that makes an end
      follow its port rather than merely start beside it.
    - Trigger cells, which are what recalculate those ends when the port moves.

    Round 2's own fix stands: the geometry is a unit line in the shape's OWN
    space, from (0,0) to (Width,0), placed and rotated by Begin/End.
    """
    import math
    dx, dy = b[0] - a[0], b[1] - a[1]
    length = math.hypot(dx, dy) or 0.01
    glue = lambda sheet, axis: (f'PAR(PNT(Sheet.{sheet}!Connections.X1,'
                                f'Sheet.{sheet}!Connections.Y1))')
    return f'''<Shape ID="{sid}" NameU="Cable" Name="Cable" Type="Shape">
{cell('OneD', '1')}
{cell('PinX', n((a[0] + b[0]) / 2))}{cell('PinY', n((a[1] + b[1]) / 2))}
{cell('Width', n(length))}{cell('Height', '0')}
{cell('LocPinX', n(length / 2), 'Width*0.5')}{cell('LocPinY', '0', 'Height*0.5')}
{cell('Angle', n(math.atan2(dy, dx)))}
{cell('BeginX', n(a[0]), glue(ida, 'X'))}{cell('BeginY', n(a[1]), glue(ida, 'Y'))}
{cell('EndX', n(b[0]), glue(idb, 'X'))}{cell('EndY', n(b[1]), glue(idb, 'Y'))}
{cell('BegTrigger', n(ida), f'_XFTRIGGER(Sheet.{ida}!EventXFMod)')}
{cell('EndTrigger', n(idb), f'_XFTRIGGER(Sheet.{idb}!EventXFMod)')}
{cell('LineWeight', '0.02')}{cell('LinePattern', '1')}{cell('LineColor', '#d0021b')}
{cell('FillPattern', '0')}
<Section N="Geometry" IX="0">
<Cell N="NoFill" V="1"/>
<Row T="MoveTo" IX="1"><Cell N="X" V="0" F="Width*0"/><Cell N="Y" V="0" F="Height*0"/></Row>
<Row T="LineTo" IX="2"><Cell N="X" V="{n(length)}" F="Width*1"/><Cell N="Y" V="0" F="Height*0"/></Row>
</Section>
</Shape>'''


# ── package ──────────────────────────────────────────────────────────────
def page_xml(shapes, connects):
    return (f'{XML}\n<PageContents xmlns="{NS}" xmlns:r="{NSR}" xml:space="preserve">'
            f'<Shapes>{shapes}</Shapes>'
            + (f'<Connects>{connects}</Connects>' if connects else '')
            + '</PageContents>')


def one_group(item, rid, sid, tint=False, locked=True, container=False,
              anchor=False):
    """A device or module as ONE group: its faceplate, and its ports behind it.

    Returns (xml, next_sid). The group's own space runs 0..Width, 0..Height, so
    the children are written in face coordinates whatever the group sits on the
    page - which is what lets a chassis and the cards that go in it share a page.
    """
    vb = item['vb']
    w_in, h_in = vb[2] / MM, vb[3] / MM
    ox, oy = item.get('at', (0, 0))
    first = sid
    kids = []
    for z in item['zones']:
        kids.append(port_shape(sid, z, h_in, tint, vb, locked, container))
        sid += 1
    if item.get('png'):
        kids.append(image_shape(sid, rid, w_in, h_in))   # LAST: Visio paints it in front
        sid += 1
    # A connection point on the GROUP itself. Visio can glue one shape to
    # another shape's connection point - not just a connector to a shape - and
    # a shape glued that way moves when its target moves. If that holds, it is
    # what "the card is in the slot" means in a file: the card's own point
    # bound to the slot's, so the chassis carries it.
    if item.get('oned'):
        # Visio's own rack equipment is a 1-D shape with the artwork inside it,
        # glued at both ends to the rails. The ends are what attach; the
        # picture just rides along. Same idea one level down: a card is a 1-D
        # shape whose ends glue to the two points of a bay, so moving the
        # chassis moves the card, and <Connects> records which bay holds it.
        bx, by = ox, oy + h_in / 2
        ex, ey = ox + w_in, oy + h_in / 2
        oned_cells = (cell('OneD', '1')
                      + cell('BeginX', n(bx)) + cell('BeginY', n(by))
                      + cell('EndX', n(ex)) + cell('EndY', n(ey))
                      + cell('LocPinX', n(w_in / 2), 'Width*0.5')
                      + cell('LocPinY', n(h_in / 2), 'Height*0.5'))
    else:
        oned_cells = (cell('LocPinX', n(w_in / 2), 'Width*0.5')
                      + cell('LocPinY', n(h_in / 2), 'Height*0.5'))
    anchor_xml = ('<Section N="Connection"><Row IX="1">'
                  + cell('X', n(w_in / 2), 'Width*0.5')
                  + cell('Y', n(h_in / 2), 'Height*0.5')
                  + cell('DirX', '0') + cell('DirY', '0') + cell('Type', '0')
                  + '</Row></Section>') if anchor else ''
    xml = (f'<Shape ID="{sid}" NameU="{esc(item["name"])}" Name="{esc(item["name"])}" '
           f'Type="Group">'
           + cell('PinX', n(ox + w_in / 2)) + cell('PinY', n(oy + h_in / 2))
           + cell('Width', n(w_in)) + cell('Height', n(h_in))
           + oned_cells
           + cell('Angle', '0') + cell('SelectMode', '1') + cell('DisplayMode', '2')
           + anchor_xml
           + f'<Shapes>{"".join(kids)}</Shapes></Shape>')
    return xml, sid + 1


def build(pages_in, out, tint=False, locked=True, container=False, anchor=False):
    """pages_in: [{'title', 'w', 'h', 'items': [item, ...]}]

    An item is {'name', 'png', 'zones', 'vb', 'at': (x_in, y_in)}. A page can
    hold as many as it likes - a chassis and the cards that go in it, say.
    """
    enc_pages, page_parts, media, page_rels = [], [], [], []
    for i, pg in enumerate(pages_in, 1):
        shapes, sid, imgs = [], 1, []
        for item in pg['items']:
            rid = None
            if item.get('png'):
                imgs.append(item['png'])
                rid = f'rId{len(imgs)}'
            xml, sid = one_group(item, rid, sid, tint, locked, container,
                                 anchor and item.get('anchor', True))
            shapes.append(xml)
        page_parts.append((f'visio/pages/page{i}.xml', page_xml(''.join(shapes), '')))
        for k, png in enumerate(imgs, 1):
            media.append((f'visio/media/p{i}image{k}.png', png))
        page_rels.append(''.join(
            f'<Relationship Id="rId{k}" Type="http://schemas.openxmlformats.org/'
            f'officeDocument/2006/relationships/image" Target="../media/p{i}image{k}.png"/>'
            for k in range(1, len(imgs) + 1)))
        enc_pages.append(f'''<Page ID="{i - 1}" NameU="{esc(pg["title"])}" Name="{esc(pg["title"])}"
 ViewScale="-1" ViewCenterX="{n(pg["w"] / 2)}" ViewCenterY="{n(pg["h"] / 2)}"><PageSheet>
{cell('PageWidth', n(pg['w']))}{cell('PageHeight', n(pg['h']))}
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
<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties" Target="docProps/custom.xml"/>
</Relationships>''',
        'docProps/core.xml': f'''{XML}
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
 xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Portrayal</dc:title>
<dc:creator>portrayal.dev</dc:creator></cp:coreProperties>''',
        'docProps/custom.xml': f'''{XML}
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties"
 xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
<property fmtid="{{D5CDD505-2E9C-101B-9397-08002B2CF9AE}}" pid="2" name="RecalcDocument">
<vt:bool>true</vt:bool></property></Properties>''',
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
                                 + ''.join(enc_pages) + '</Pages>',
        'visio/pages/_rels/pages.xml.rels': f'{XML}\n'
        + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + ''.join(f'<Relationship Id="rId{i}" Type="http://schemas.microsoft.com/visio/2010/'
                  f'relationships/page" Target="page{i}.xml"/>'
                  for i in range(1, len(pages_in) + 1))
        + '</Relationships>',
    }
    for i, (name, text) in enumerate(page_parts, 1):
        parts[name] = text
        parts[f'visio/pages/_rels/page{i}.xml.rels'] = (
            f'{XML}\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/'
            f'relationships">{page_rels[i - 1]}</Relationships>')
    overrides = ''.join(
        f'<Override PartName="/visio/pages/page{i}.xml" ContentType="application/vnd.ms-visio.page+xml"/>'
        for i in range(1, len(pages_in) + 1))
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
<Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/>
</Types>'''
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml', parts.pop('[Content_Types].xml'))
        for name, text in parts.items():
            z.writestr(name, text)
        for name, data in media:
            z.writestr(name, data, zipfile.ZIP_STORED)
    return out


def round8():
    """The ship candidate: a locked group, and no cable of our own.

    Round 7 settled the shape of a device: one Group, every port an invisible
    LOCKED sub-shape. Locked against selection, movement and deletion, so the
    device is the only thing to grab and a port cannot be dragged out of it -
    and, tested, a connector still glues to a locked port perfectly well.

    The pre-drawn cable is gone. It existed to test whether glue survives a
    round trip and it answered that by failing usefully: its endpoints are
    page-level formulas that do not account for the group's coordinate space,
    so it detaches visually while Visio still believes it is attached. A cable
    the user draws is written by Visio itself and behaves correctly. We ship
    devices; Visio does cables better than we can hand-craft them.
    """
    d = json.load(open(os.path.join(HERE, 'out', 'mod', 'modular-zones.json')))
    ports = json.load(open(PORTS))
    jobs = {'s9510-28dc': [{'name': f's9510-28dc {face}', 'face': face,
                            'ref': 'ufispace/s9510-28dc',
                            'png': open(os.path.join(HERE, 'out', f'{face}.png'), 'rb').read(),
                            'zones': ports[face], 'vb': ports['viewBox']}
                           for face in ('front', 'rear')]}
    for name in d['devices']:
        faces = []
        for face, f in d['devices'][name].items():
            png = os.path.join(HERE, 'out', 'mod', f'{name}.{face}.png')
            if os.path.exists(png) and f['zones']:
                faces.append({'name': f'{name} {face}', 'face': face, 'ref': name,
                              'png': open(png, 'rb').read(),
                              'zones': f['zones'], 'vb': f['vb']})
        if faces:
            jobs[name] = faces
    for name, faces in jobs.items():
        out = os.path.join(HERE, 'out', f'{name}.r8.vsdx')
        build(faces, out, locked=True, cable=False)
        print(f'{name}: {sum(len(f["zones"]) for f in faces)} zones over {len(faces)} faces, '
              f'{os.path.getsize(out)} bytes')


def round7():
    """The two answers to "the device is hard to grab and its cables fall off".

    A: one shape, ports as connection points - Visio's own idea of an
       attachment place, part of the shape rather than a neighbour of it.
    B: the group kept, but every port locked so it cannot be selected, moved
       or deleted, leaving the device the only thing there is to grab.

    Built for the S9510, which is known to work, and for the R740xd, where all
    three complaints were found.
    """
    d = json.load(open(os.path.join(HERE, 'out', 'mod', 'modular-zones.json')))
    ports = json.load(open(PORTS))
    jobs = {'s9510-28dc': [{'name': f's9510-28dc {face}', 'face': face,
                            'ref': 'ufispace/s9510-28dc',
                            'png': open(os.path.join(HERE, 'out', f'{face}.png'), 'rb').read(),
                            'zones': ports[face], 'vb': ports['viewBox']}
                           for face in ('front', 'rear')]}
    for name in ('r740xd',):
        jobs[name] = [{'name': f'{name} {face}', 'face': face, 'ref': name,
                       'png': open(os.path.join(HERE, 'out', 'mod', f'{name}.{face}.png'), 'rb').read(),
                       'zones': f['zones'], 'vb': f['vb']}
                      for face, f in d['devices'][name].items()]
    for name, faces in jobs.items():
        for tag, kw in (('r7a-points', dict(points=True, cable=False)),
                        ('r7b-locked', dict(locked=True))):
            out = os.path.join(HERE, 'out', f'{name}.{tag}.vsdx')
            build(faces, out, **kw)
            print(f'{name} {tag}: {sum(len(f["zones"]) for f in faces)} zones, '
                  f'{os.path.getsize(out)} bytes')


def modular():
    """Build the modular test devices from browser-extracted geometry.

    A chassis is the case the S9510 could not test: bays rather than ports, a
    lot of them, and on the DCP-2 a bay INSIDE a seated module - the nested
    case we wrote up for upstream, whose path is slot-2/module/ppm-1.
    """
    src = os.path.join(HERE, 'out', 'mod', 'modular-zones.json')
    d = json.load(open(src))
    for name, faces_in in d['devices'].items():
        faces = []
        for face, f in faces_in.items():
            png = os.path.join(HERE, 'out', 'mod', f'{name}.{face}.png')
            if not os.path.exists(png):
                continue
            faces.append({'name': f'{name} {face}', 'png': open(png, 'rb').read(),
                          'zones': f['zones'], 'vb': f['vb']})
        if not faces:
            continue
        nested = [z for f in faces for z in f['zones'] if '/module/' in (z.get('path') or '')]
        out = os.path.join(HERE, 'out', 'mod', f'{name}.vsdx')
        build(faces, out, tint=False)
        build(faces, os.path.join(HERE, 'out', 'mod', f'{name}.tinted.vsdx'),
              tint=True, image=False)
        print(f'{name}: {sum(len(f["zones"]) for f in faces)} zones over {len(faces)} faces'
              f', {len(nested)} nested, {os.path.getsize(out)} bytes')


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
    # Two files, because one of them has to be readable as a RESULT. The tinted
    # one shows where every port shape is, so "I cannot click it" means the
    # shape is wrong rather than that it was never found. The invisible one is
    # what we would actually ship.
    VARIANTS = [
        # Round 4. The two that differ ONLY in z-order, to confirm that is what
        # decided which ports were gluable, rather than leaving it inferred.
        ('r4-imagelast',  dict(tint=False)),                    # faceplate in front
        ('r4-imagefirst', dict(tint=False, image_last=False)),  # faceplate behind
        ('r4-tinted',     dict(tint=True, image=False)),        # where the ports are
    ]
    for tag, kw in VARIANTS:
        out = os.path.join(HERE, 'out', f's9510-28dc.{tag}.vsdx')
        build(faces, out, **kw)
        print('wrote', os.path.basename(out), os.path.getsize(out), 'bytes')
    print(sum(len(f['zones']) for f in faces), 'zones over', len(faces), 'pages')


if __name__ == '__main__':
    import sys
    (round8() if '--r8' in sys.argv else
     round7() if '--r7' in sys.argv else
     modular() if '--modular' in sys.argv else main())
