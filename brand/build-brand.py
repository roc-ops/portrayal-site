#!/usr/bin/env python3
"""Build the identity assets that must not depend on a webfont at render time.

Two things need real Archivo outlines rather than live text:

  - the wordmark, so it survives print, embedding, and anywhere the font is not
    loaded (brand/DIRECTION.md lists this as open);
  - the social card, because an SVG rasterised through <img>/canvas is font
    isolated - Google Fonts never applies - so text drawn as text falls back to
    something that is not the brand.

Converting to paths solves both at once: the card then rasterises with no font
available at all.

Fonts live in brand/fonts/ and are fetched by fetch-fonts.sh.
"""
import argparse, json
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen

HERE = Path(__file__).resolve().parent
FONTS = HERE / 'fonts'


class Face:
    def __init__(self, path):
        self.font = TTFont(path)
        self.upm = self.font['head'].unitsPerEm
        self.glyphs = self.font.getGlyphSet()
        self.cmap = self.font.getBestCmap()
        self.hmtx = self.font['hmtx']
        self.kern = self._kern_pairs()

    def _kern_pairs(self):
        """Flat pair kerning out of GPOS. Archivo carries its kerning there, and
        without it 'ay' in portrayal opens up visibly at display size."""
        pairs = {}
        gpos = self.font.get('GPOS')
        if not gpos:
            return pairs
        for lookup in gpos.table.LookupList.Lookup:
            for st in lookup.SubTable:
                st = getattr(st, 'ExtSubTable', st)
                if getattr(st, 'LookupType', None) == 2 or lookup.LookupType == 2:
                    if getattr(st, 'Format', None) != 1 or not hasattr(st, 'PairSet'):
                        continue
                    firsts = st.Coverage.glyphs
                    for gi, ps in zip(firsts, st.PairSet):
                        for rec in ps.PairValueRecord:
                            v = getattr(rec.Value1, 'XAdvance', 0) if rec.Value1 else 0
                            if v:
                                pairs[(gi, rec.SecondGlyph)] = v
        return pairs

    def text_path(self, text, size, tracking_em=0.0, x=0.0, y=0.0):
        """One <path> d for a run of text, baseline at y, growing right from x."""
        scale = size / self.upm
        track = tracking_em * size
        d, pen_x, prev = [], x, None
        for ch in text:
            gname = self.cmap.get(ord(ch))
            if gname is None:
                pen_x += size * 0.5
                continue
            if prev is not None:
                pen_x += self.kern.get((prev, gname), 0) * scale
            pen = SVGPathPen(self.glyphs)
            self.glyphs[gname].draw(pen)
            seg = pen.getCommands()
            if seg:
                # y flips: font units go up, SVG goes down
                d.append(f'<g transform="translate({pen_x:.3f},{y:.3f}) '
                         f'scale({scale:.6f},{-scale:.6f})"><path d="{seg}"/></g>')
            pen_x += self.hmtx[gname][0] * scale + track
            prev = gname
        return ''.join(d), pen_x - x - track

    def width(self, text, size, tracking_em=0.0):
        return self.text_path(text, size, tracking_em)[1]


def wordmark(size=64, tracking=-0.03):
    """mark + `portrayal.dev`, DIRECTION.md lockup C, as outlines."""
    a700 = Face(FONTS / 'Archivo-700.ttf')
    a600 = Face(FONTS / 'Archivo-600.ttf')
    name, w1 = a700.text_path('portrayal', size, tracking, 0, 0)
    tld, w2 = a600.text_path('.dev', size, tracking, w1, 0)
    total = w1 + w2
    asc = size * 0.78
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {total:.1f} {size:.1f}"
     width="{total:.1f}" height="{size:.1f}" role="img" aria-label="portrayal.dev">
  <title>portrayal.dev</title>
  <!-- Outlined from Archivo 700/600 at {tracking}em tracking. Live text needs
       the webfont; this does not. Regenerate with brand/build-brand.py. -->
  <g transform="translate(0,{asc:.2f})">
    <g fill="#E4E7EA">{name}</g>
    <g fill="#C79350">{tld}</g>
  </g>
</svg>
'''


DIST = HERE.parent / 'assets' / 'dist'


def _inline_drawing(path):
    """A compiled drawing, ready to nest inside another SVG.

    cairosvg has no custom-property support and reads `var(--led-color, #3a3f44)`
    as a hex literal beginning "ar", so the fallbacks are resolved first. Every
    use in the compiled output is a lamp colour carrying a fallback, and the
    fallback is the unlit faceplate - the right picture for a card, which has no
    live state to show. Same reasoning as the DCIM exporter's rasterize().
    """
    import re
    svg = path.read_text()
    svg = re.sub(r'var\(\s*--[\w-]+\s*,\s*([^)]+?)\s*\)', r'\1', svg)
    svg = re.sub(r'<\?xml[^>]*\?>', '', svg)
    vb = re.search(r'viewBox="([^"]+)"', svg).group(1).split()
    body = svg[svg.index('>', svg.index('<svg')) + 1: svg.rindex('</svg>')]
    return body, [float(v) for v in vb]


def og_card(ref='as7726-32x', cfg='ac-f2b', port='port-12',
            W=1200, H=630):
    """The social card: a real compiled faceplate with a brass callout on it.

    brand/DIRECTION.md asks for exactly this rather than the mark on a colour -
    the card should show the thing the project makes. Every number on it is read
    off the drawing, so it cannot drift into a claim the library does not back.

    All type is outlined. An SVG rasterised through <img>/canvas never loads a
    webfont, so live text here would silently fall back off-brand.
    """
    import re
    # Looked up, not built (Portrayal #670): a configuration's face may be
    # another configuration's file. configs[].files says which.
    idx = json.loads((DIST / f'{ref}.configs.json').read_text())
    face = next((c.get('files', {}).get('front') for c in idx['configs'] if c['name'] == cfg), None)
    src = DIST / (face or f'{ref}.' + cfg + '.front.svg')
    body, (_, _, dw, dh) = _inline_drawing(src)
    raw = src.read_text()

    # The callout target, and its labels, read from the drawing itself.
    g = re.search(r'<g id="%s"[^>]*>' % re.escape(port), raw).group(0)
    tx, ty = (float(v) for v in
              re.search(r'translate\(([\d.]+),([\d.]+)\)', g).groups())
    seg = raw[raw.index(g) + len(g):][:400]
    cw, ch = (float(v) for v in re.search(
        r'<rect[^>]*width="([\d.]+)"[^>]*height="([\d.]+)"', seg).groups())
    media = re.search(r'data-media="([^"]+)"', g).group(1)
    speed = re.search(r'data-speed="([^"]+)"', g).group(1)
    lanes = re.search(r'data-lanes="([^"]+)"', g).group(1)
    model = re.search(r'data-model="([^"]+)"', raw)
    model = model.group(1) if model else ref.upper()
    nports = len(re.findall(r'data-class="port"', raw))

    a700 = Face(FONTS / 'Archivo-700.ttf')
    a600 = Face(FONTS / 'Archivo-600.ttf')
    mono = Face(FONTS / 'IBMPlexMono-400.ttf')

    # Faceplate placement
    pad = 76
    fw = W - pad * 2
    k = fw / dw                       # mm -> px
    fx, fy = pad, 292
    cx = fx + (tx + cw / 2) * k       # the port's centre, in card space
    cy = fy + (ty + ch / 2) * k

    # Leader: down out of the cage, then a short horizontal run to the label.
    y1 = fy + dh * k + 58
    lx = cx + 46
    label = f'{port}'
    sub = f'{media} · {speed} · {lanes} lanes'
    lp, lw = a700.text_path(label, 27, -0.01, lx + 14, y1 + 1)
    sp, sw = mono.text_path(sub, 21, 0, lx + 14, y1 + 32)

    wm_name, w1 = a700.text_path('portrayal', 47, -0.03, pad, 118)
    wm_tld, w2 = a600.text_path('.dev', 47, -0.03, pad + w1, 118)
    tag, _ = a600.text_path('every port, every part, individually addressable',
                            26, -0.01, pad, 166)
    foot, fwid = mono.text_path(
        f'{model}  ·  {dw:g} × {dh:g} mm  ·  {nports} addressable ports',
        20, 0, 0, 0)

    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}"
     viewBox="0 0 {W} {H}">
  <!-- Generated by brand/build-brand.py. Every figure is read off
       assets/dist/{src.name}; nothing here is typed by hand. -->
  <rect width="{W}" height="{H}" fill="#14171A"/>
  <rect x="0" y="0" width="{W}" height="4" fill="#C79350"/>

  <g fill="#E4E7EA">{wm_name}</g>
  <g fill="#C79350">{wm_tld}</g>
  <g fill="#9AA1A8">{tag}</g>

  <svg x="{fx}" y="{fy}" width="{fw}" height="{dh * k}"
       viewBox="0 0 {dw} {dh}">{body}</svg>

  <!-- callout: anchored on {port}'s own centre -->
  <g stroke="#C79350" fill="none" stroke-width="2">
    <rect x="{cx - cw * k / 2 - 3:.1f}" y="{cy - ch * k / 2 - 3:.1f}"
          width="{cw * k + 6:.1f}" height="{ch * k + 6:.1f}" rx="2"/>
    <path d="M {cx:.1f} {cy + ch * k / 2 + 3:.1f} L {cx:.1f} {y1 - 10:.1f}
             L {lx:.1f} {y1 - 10:.1f}"/>
  </g>
  <circle cx="{lx:.1f}" cy="{y1 - 10:.1f}" r="3.5" fill="#C79350"/>
  <g fill="#E4E7EA">{lp}</g>
  <g fill="#9AA1A8">{sp}</g>

  <g fill="#6B727A" transform="translate({W - pad - fwid:.1f},{H - 44})">{foot}</g>
</svg>
'''


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('what', choices=['wordmark', 'og-card'])
    ap.add_argument('--out')
    a = ap.parse_args()
    svg = wordmark() if a.what == 'wordmark' else og_card()
    Path(a.out).write_text(svg) if a.out else print(svg)
    if a.out:
        print(f'wrote {a.out}')
