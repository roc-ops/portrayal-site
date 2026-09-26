// Cables that hang. One module for both views, so the sag and the colors
// cannot differ between 2D and 3D (spec §5).
//
// WHERE A CABLE STARTS. A fiber end is a connector the plan seated - an LC
// plug in each of an optic's two cages, or a duplex plug in a cassette's
// adapter - and the kit's relief.js cablePoints() names the point each one
// leaves from. Its `at` is in the marker's own frame, so it is mapped through
// the marker's CTM (relief.js says to). A copper end has no plug to seat yet
// (roc-ops/Portrayal#610): it starts at the jack's center.

import {cablePoints} from '../../vendor/relief.js';
import {svgEl} from './artifact.js';

// OS2 jackets are yellow; copper is colored by what it is for.
export const COLORS = {os2: '#e8c547', copper: {server: '#5aa7ff', management: '#9aa3ad'}};
export const colorOf = l => l.media === 'copper'
  ? (COLORS.copper[l.purpose] || COLORS.copper.server) : (COLORS[l.media] || COLORS.os2);

export const WIDTH = 3;          // mm: a patch lead, to scale
const MERGE = 10;                // mm below a duplex pair where the two strands join
// How far a cable hangs below the lower of its two ends: a little always, more
// the farther apart they are, and a few mm more per cable already hung between
// the same two devices, so parallel runs fan out instead of stacking.
// A tag's pitch, in mm: its pill is 18 tall (patch-view.js), plus a gap.
export const TAG_H = 20;
export const sag2d = (dist, fan = 0) => 14 + 0.3 * dist + 5 * fan;

const esc = s => (window.CSS && CSS.escape ? CSS.escape(s) : String(s));

// An end's points in `svg`'s user space, left to right: a fiber end's
// connectors, or a copper end's jack center. null when the end is not drawn.
export function ends2d(svg, dev, path, fiber) {
  const g = svg.querySelector(`[data-device-ref="${esc(dev)}"]`);
  if (!g) return null;
  const inv = svg.getScreenCTM().inverse();
  if (fiber) {
    const pre = `${path}-occupant/`;
    const pts = cablePoints(g).filter(p => p.at && p.path.startsWith(pre));
    if (!pts.length) return null;
    return pts.map(p => {
      const q = new DOMPoint(+p.at[0], +p.at[1]).matrixTransform(inv.multiply(p.el.getScreenCTM()));
      return [q.x, q.y];
    }).sort((a, b) => a[0] - b[0]);
  }
  const port = g.querySelector(`[data-path="${esc(path)}"]`);
  if (!port) return null;
  const b = port.getBoundingClientRect();
  const c = new DOMPoint(b.x + b.width / 2, b.y + b.height / 2).matrixTransform(inv);
  return [[c.x, c.y]];
}

const mean = ps => [ps.reduce((s, p) => s + p[0], 0) / ps.length,
                    ps.reduce((s, p) => s + p[1], 0) / ps.length];

// One end's strands: a duplex pair joins MERGE below its connectors, and the
// cable proper starts there. Returns [start, strandPaths].
function gather(pts) {
  if (pts.length < 2) return [pts[0], []];
  const [mx] = mean(pts);
  const m = [mx, Math.max(...pts.map(p => p[1])) + MERGE];
  return [m, pts.map(p => `M${p[0]} ${p[1]} C${p[0]} ${p[1] + MERGE * 0.6} ${m[0]} ${m[1] - MERGE * 0.6} ${m[0]} ${m[1]}`)];
}

const hang = (a, b, s) => `M${a[0]} ${a[1]} C${a[0]} ${Math.max(a[1], b[1]) + s} ${b[0]} ${Math.max(a[1], b[1]) + s} ${b[0]} ${b[1]}`;

function stroke(g, d, color, w) {
  g.append(svgEl('path', {d, fill: 'none', stroke: '#000', 'stroke-opacity': 0.45,
    'stroke-width': w + 1.2, 'stroke-linecap': 'round'}));
  g.append(svgEl('path', {d, fill: 'none', stroke: color, 'stroke-width': w, 'stroke-linecap': 'round'}));
}

// Every link with at least one end on `view`: both ends -> a hanging cable;
// one end -> a cable hanging off to `edgeX` with a tag (from `tag(at, farEnd,
// link)`) naming the far end (spec §6: front-to-rear runs go round the side).
// A fiber end whose connectors are missing, or a copper end whose port is,
// is recorded loose.
export function drawCables2d(svg, plan, view, {edgeX, tag}) {
  const layer = svgEl('g', {'data-cables': view, 'data-pt-ui': '*'});
  svg.append(layer);
  const fans = new Map();
  const out = [];
  plan.links.forEach((link, i) => {
    const fiber = link.media !== 'copper';
    const sides = [['from', link.from], ['to', link.to]];
    const here = sides.filter(([, e]) => (e[2] || 'front') === view);
    const rec = {link, i, g: null, loose: [], tagged: false};
    out.push(rec);
    if (!here.length) return;
    const pts = here.map(([k, e]) => [k, ends2d(svg, e[0], e[1], fiber)]);
    for (const [k, p] of pts) if (!p) rec.loose.push(k);
    const live = pts.filter(([, p]) => p);
    if (!live.length) return;
    const g = svgEl('g', {'data-cable': 'true', 'data-link-index': String(i),
      'data-media': link.media, 'data-purpose': link.purpose, tabindex: '0'});
    const color = colorOf(link);
    const key = [link.from[0], link.to[0]].sort().join('|');
    const fan = fans.get(key) || 0; fans.set(key, fan + 1);
    const starts = live.map(([, p]) => {
      const [s, strands] = gather(p);
      for (const d of strands) stroke(g, d, color, WIDTH * 0.6);
      return s;
    });
    if (starts.length === 2) {
      const [a, b] = starts;
      stroke(g, hang(a, b, sag2d(Math.hypot(b[0] - a[0], b[1] - a[1]), fan)), color, WIDTH);
    } else if (here.length === 1) {
      const a = starts[0];
      // TAG_H apart per cable already hung between the same two devices, so
      // their tags stack instead of overlapping.
      const b = [edgeX, a[1] + 30 + TAG_H * fan];
      stroke(g, hang(a, b, sag2d(Math.abs(b[0] - a[0]), fan)), color, WIDTH);
      const other = sides.find(([, e]) => (e[2] || 'front') !== view)[1];
      g.append(tag(b, other, link));
      rec.tagged = true;
    }
    const t = svgEl('title', {});
    t.textContent = `${link.from[0]} ${link.from[1]} → ${link.to[0]} ${link.to[1]} · ${link.purpose}, ${link.media}`;
    g.prepend(t);
    layer.append(g);
    rec.g = g;
  });
  return out;
}
