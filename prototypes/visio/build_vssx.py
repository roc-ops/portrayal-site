#!/usr/bin/env python3
"""Portrayal -> a Visio STENCIL (.vssx): a library you drag devices from.

The drawing (.vsdx) is proven; this is the same shapes in the container Visio
opens as a stencil, which is what makes a module something you DRAG IN rather
than something we place for you.

The part set is not guesswork. We hold vendor stencils in the intake -
Smartoptics' own, for the very devices this prototype tests with - and this
mirrors what they contain:

    [Content_Types].xml          document.xml is stencil.main+xml, not drawing
    _rels/.rels                  document, core, app, custom
    visio/document.xml           the usual settings
    visio/_rels/...rels          masters, pages, windows
    visio/masters/masters.xml    one <Master> each: name, size, a Rel
    visio/masters/masterN.xml    <MasterContents> holding the shape
    visio/masters/_rels/...      each master's image
    visio/pages/pages.xml        one empty page, self-contained - no page part
    visio/windows.xml            empty

Two things the vendor files taught us that no documentation did: real Visio
writes attributes in SINGLE quotes, and connection rows are numbered from ZERO.
Neither matters for what we emit, but both matter for anything that reads it.

Each master is the shape the drawing already proved: a group holding the
faceplate and, behind it, an invisible locked sub-shape per port and bay, each
named and carrying its path, media and speed as Shape Data.
"""

import json, os, uuid, zipfile
import build_vsdx as bv

HERE = os.path.dirname(os.path.abspath(__file__))
XML = bv.XML
NS, NSR = bv.NS, bv.NSR
REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
VREL = 'http://schemas.microsoft.com/visio/2010/relationships'


def guid():
    return '{%s}' % str(uuid.uuid4()).upper()


def master_entry(i, item, w_in, h_in):
    """One row in the stencil's shape list: what you see and drag."""
    return (f"<Master ID='{i}' NameU='{bv.esc(item['name'])}' IsCustomNameU='1' "
            f"Name='{bv.esc(item['name'])}' IsCustomName='1' "
            f"Prompt='{bv.esc(item.get('prompt', ''))}' IconSize='1' AlignName='2' "
            f"MatchByName='0' IconUpdate='0' UniqueID='{guid()}' BaseID='{guid()}' "
            f"PatternFlags='0' Hidden='0' MasterType='2'>"
            "<PageSheet LineStyle='0' FillStyle='0' TextStyle='0'>"
            f"<Cell N='PageWidth' V='{bv.n(w_in)}'/><Cell N='PageHeight' V='{bv.n(h_in)}'/>"
            "<Cell N='ShdwOffsetX' V='0.125'/><Cell N='ShdwOffsetY' V='-0.125'/>"
            "<Cell N='PageScale' V='1' U='IN_F'/><Cell N='DrawingScale' V='1' U='IN_F'/>"
            "<Cell N='DrawingSizeType' V='4'/><Cell N='DrawingScaleType' V='0'/>"
            "<Cell N='InhibitSnap' V='0'/><Cell N='DrawingResizeType' V='1'/>"
            "</PageSheet>"
            f"<Rel r:id='rId{i}'/></Master>")


def build(items, out, locked=True):
    parts, masters, mrels, ctypes = {}, [], [], []
    for i, item in enumerate(items, 1):
        vb = item['vb']
        w_in, h_in = vb[2] / bv.MM, vb[3] / bv.MM
        shape, _ = bv.one_group(item, 'rId1', 1, False, locked, False)
        parts[f'visio/masters/master{i}.xml'] = (
            f"{XML}\n<MasterContents xmlns='{NS}' xmlns:r='{NSR}' xml:space='preserve'>"
            f"<Shapes>{shape}</Shapes></MasterContents>")
        parts[f'visio/masters/_rels/master{i}.xml.rels'] = (
            f'{XML}\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/'
            f'relationships"><Relationship Id="rId1" Type="{REL}/image" '
            f'Target="../media/image{i}.png"/></Relationships>')
        parts[f'visio/media/image{i}.png'] = item['png']
        masters.append(master_entry(i, item, w_in, h_in))
        mrels.append(f'<Relationship Id="rId{i}" Type="{VREL}/master" '
                     f'Target="master{i}.xml"/>')
        ctypes.append(f'<Override PartName="/visio/masters/master{i}.xml" '
                      f'ContentType="application/vnd.ms-visio.master+xml"/>')

    parts['visio/masters/masters.xml'] = (
        f"{XML}\n<Masters xmlns='{NS}' xmlns:r='{NSR}' xml:space='preserve'>"
        + ''.join(masters) + '</Masters>')
    parts['visio/masters/_rels/masters.xml.rels'] = (
        f'{XML}\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/'
        f'relationships">' + ''.join(mrels) + '</Relationships>')
    parts['visio/document.xml'] = (
        f"{XML}\n<VisioDocument xmlns='{NS}' xmlns:r='{NSR}' xml:space='preserve'>"
        "<DocumentSettings TopPage='0' DefaultTextStyle='0' DefaultLineStyle='0' "
        "DefaultFillStyle='0' DefaultGuideStyle='0'/>"
        "<Colors/><FaceNames/><StyleSheets/></VisioDocument>")
    parts['visio/_rels/document.xml.rels'] = (
        f'{XML}\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/'
        f'relationships">'
        f'<Relationship Id="rId1" Type="{VREL}/masters" Target="masters/masters.xml"/>'
        f'<Relationship Id="rId2" Type="{VREL}/pages" Target="pages/pages.xml"/>'
        f'<Relationship Id="rId3" Type="{VREL}/windows" Target="windows.xml"/>'
        '</Relationships>')
    # A stencil still carries a page, and it is self-contained - there is no
    # page part behind it. Straight from the vendor file.
    parts['visio/pages/pages.xml'] = (
        f"{XML}\n<Pages xmlns='{NS}' xmlns:r='{NSR}' xml:space='preserve'>"
        "<Page ID='0' NameU='Page-1' Name='Page-1' ViewScale='-1' ViewCenterX='0' "
        "ViewCenterY='0'><PageSheet LineStyle='0' FillStyle='0' TextStyle='0'>"
        "<Cell N='PageWidth' V='8.5'/><Cell N='PageHeight' V='11'/>"
        "<Cell N='PageScale' V='1' U='IN_F'/><Cell N='DrawingScale' V='1' U='IN_F'/>"
        "<Cell N='DrawingSizeType' V='0'/><Cell N='DrawingScaleType' V='0'/>"
        "</PageSheet></Page></Pages>")
    parts['visio/windows.xml'] = (
        f"{XML}\n<Windows ClientWidth='0' ClientHeight='0' xmlns='{NS}' "
        f"xmlns:r='{NSR}' xml:space='preserve'/>")
    parts['_rels/.rels'] = (
        f'{XML}\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/'
        f'relationships">'
        f'<Relationship Id="rId1" Type="{VREL}/document" Target="visio/document.xml"/>'
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/'
        'relationships/metadata/core-properties" Target="docProps/core.xml"/>'
        f'<Relationship Id="rId3" Type="{REL}/extended-properties" Target="docProps/app.xml"/>'
        f'<Relationship Id="rId4" Type="{REL}/custom-properties" Target="docProps/custom.xml"/>'
        '</Relationships>')
    parts['docProps/core.xml'] = (
        f'{XML}\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/'
        '2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">'
        '<dc:title>Portrayal</dc:title><dc:creator>portrayal.dev</dc:creator>'
        '</cp:coreProperties>')
    parts['docProps/app.xml'] = (
        f'{XML}\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/'
        '2006/extended-properties"><Application>Portrayal</Application></Properties>')
    parts['docProps/custom.xml'] = (
        f'{XML}\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/'
        '2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/'
        'officeDocument/2006/docPropsVTypes"><property '
        'fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="RecalcDocument">'
        '<vt:bool>true</vt:bool></property></Properties>')
    parts['[Content_Types].xml'] = (
        f'{XML}\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.'
        'relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
        '<Default Extension="png" ContentType="image/png"/>'
        '<Override PartName="/visio/document.xml" '
        'ContentType="application/vnd.ms-visio.stencil.main+xml"/>'
        '<Override PartName="/visio/masters/masters.xml" '
        'ContentType="application/vnd.ms-visio.masters+xml"/>'
        + ''.join(ctypes) +
        '<Override PartName="/visio/pages/pages.xml" '
        'ContentType="application/vnd.ms-visio.pages+xml"/>'
        '<Override PartName="/visio/windows.xml" '
        'ContentType="application/vnd.ms-visio.windows+xml"/>'
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.'
        'openxmlformats-package.core-properties+xml"/>'
        '<Override PartName="/docProps/app.xml" ContentType="application/vnd.'
        'openxmlformats-officedocument.extended-properties+xml"/>'
        '<Override PartName="/docProps/custom.xml" ContentType="application/vnd.'
        'openxmlformats-officedocument.custom-properties+xml"/></Types>')

    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml', parts.pop('[Content_Types].xml'))
        for name, data in parts.items():
            if isinstance(data, bytes):
                z.writestr(name, data, zipfile.ZIP_STORED)
            else:
                z.writestr(name, data)
    return out


def main():
    D = os.path.join(HERE, 'out')
    comps = json.load(open(os.path.join(D, 'comp', 'component-zones.json')))['components']
    mods = json.load(open(os.path.join(D, 'mod', 'modular-zones.json')))['devices']
    ports = json.load(open(os.path.join(HERE, 'out', '..', 'out', 's9510-28dc.ports.json'))) \
        if False else json.load(open(bv.PORTS))
    C = os.path.join(D, 'comp')
    items = []
    for face in ('front', 'rear'):
        items.append({'name': f'S9510-28DC {face}', 'prompt': 'UfiSpace S9510-28DC',
                      'png': open(os.path.join(D, f'{face}.png'), 'rb').read(),
                      'zones': ports[face], 'vb': ports['viewBox']})
    for name, label in (('dcp-2', 'Smartoptics DCP-2'), ('r740xd', 'Dell R740xd')):
        for face, f in mods.get(name, {}).items():
            png = os.path.join(D, 'mod', f'{name}.{face}.png')
            if os.path.exists(png) and f['zones']:
                items.append({'name': f'{name} {face}', 'prompt': label,
                              'png': open(png, 'rb').read(),
                              'zones': f['zones'], 'vb': f['vb']})
    for key, file, label in (
            ('dcp-f-a22', 'smartoptics--dcp-f-a22--v1--default.png', 'DCP-F-A22 line card'),
            ('ppm-ad1-1510', 'smartoptics--ppm-ad1-1510--v1--default.png', 'PPM 1510 filter'),
            ('ppm-dummy', 'smartoptics--ppm-dummy--v1--default.png', 'PPM blank')):
        c = comps[key]
        items.append({'name': key, 'prompt': label,
                      'png': open(os.path.join(C, file), 'rb').read(),
                      'zones': c['zones'], 'vb': c['vb']})
    out = build(items, os.path.join(D, 'portrayal.vssx'))
    print(f'{len(items)} masters -> {os.path.basename(out)} '
          f'{os.path.getsize(out)} bytes')
    for it in items:
        print(f'   {it["name"]:22} {len(it["zones"]):3} zones')


if __name__ == '__main__':
    main()
