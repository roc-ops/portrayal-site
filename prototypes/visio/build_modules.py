#!/usr/bin/env python3
"""Modules, and whether a bay can actually take one.

Everything so far has shipped a device as it was compiled. This is the case
that cannot be expressed that way: a DCP-2 with an A22 card in a slot, and a
PPM inside the A22. The card and the PPM are separate things the user seats,
so they have to exist as separate shapes.

A drawing cannot offer a library to drag from - that is what a stencil is for -
but it CAN put the cards on the page beside the chassis, which is enough to
answer the question underneath: when you drag a card onto a slot, does Visio
understand that the card is now IN the slot?

Two answers, built side by side:

  drag       the bays stay locked. A card dropped on a slot is parked on top of
             it: correct on screen, and the chassis does not carry it when it
             moves.
  container  each bay declares itself a Visio CONTAINER. Containers are Visio's
             own structured-diagram machinery - a shape that other shapes are
             dropped INTO, are listed as members of, and are carried with. If
             this works, "seat a card in a slot" is a thing the format can say.

A container has to be selectable, so in that variant the bays are not locked -
which brings back the round 7 problem of ports competing for the click. That
trade is the point of the test.
"""

import json, os
import build_vsdx as bv

HERE = os.path.dirname(os.path.abspath(__file__))
D = os.path.join(HERE, 'out')
GAP = 0.3                                    # inches between things on the page


def item(name, png_path, zones, vb, at):
    return {'name': name, 'png': open(png_path, 'rb').read() if png_path else None,
            'zones': zones, 'vb': vb, 'at': at}


def main():
    comps = json.load(open(os.path.join(D, 'comp', 'component-zones.json')))['components']
    mods = json.load(open(os.path.join(D, 'mod', 'modular-zones.json')))['devices']
    C = os.path.join(D, 'comp')
    a22, ppm, dummy = (comps['dcp-f-a22'], comps['ppm-ad1-1510'], comps['ppm-dummy'])
    chassis = mods['dcp-2']['front']

    h = lambda z: z['vb'][3] / bv.MM
    w = lambda z: z['vb'][2] / bv.MM
    page_w = max(w(chassis), w(a22) + GAP + w(ppm) * 2) + GAP * 2
    page_h = h(chassis) + h(a22) + h(ppm) + GAP * 4

    y_chassis = page_h - GAP - h(chassis)
    y_a22 = y_chassis - GAP - h(a22)
    y_ppm = y_a22 - GAP - h(ppm)

    items = [
        item('dcp-2 front', os.path.join(D, 'mod', 'dcp-2.front.png'),
             chassis['zones'], chassis['vb'], (GAP, y_chassis)),
        item('dcp-f-a22', os.path.join(C, 'smartoptics--dcp-f-a22--v1--default.png'),
             a22['zones'], a22['vb'], (GAP, y_a22)),
        item('ppm-ad1-1510', os.path.join(C, 'smartoptics--ppm-ad1-1510--v1--default.png'),
             ppm['zones'], ppm['vb'], (GAP, y_ppm)),
        item('ppm-dummy', os.path.join(C, 'smartoptics--ppm-dummy--v1--default.png'),
             dummy['zones'], dummy['vb'], (GAP + w(ppm) + GAP, y_ppm)),
    ]
    page = [{'title': 'DCP-2 and its cards', 'w': page_w, 'h': page_h, 'items': items}]

    for tag, kw in (('drag', dict(locked=True)),
                    ('container', dict(locked=False, container=True)),
                    # Every card gets a connection point of its own, so it can
                    # be glued to a slot rather than merely dropped on one.
                    ('glue', dict(locked=True, anchor=True))):
        out = os.path.join(D, f'modules-{tag}.vsdx')
        bv.build(page, out, **kw)
        print(f'{tag}: {sum(len(i["zones"]) for i in items)} zones over {len(items)} objects, '
              f'{os.path.getsize(out)} bytes')
    print(f'page {page_w:.1f} x {page_h:.1f} in; a22 carries '
          f'{len([z for z in a22["zones"] if z["cls"] == "bay"])} bays of its own')


if __name__ == '__main__':
    main()
