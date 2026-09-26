// ONE FACE OF A RACK, drawn from data: the rails with this rack's holes, and
// every item on it. The Rack Builder draws both faces with it; the showcase's
// build2dElevation is an adapter over it, so the two can never disagree about
// what a rail or a device looks like.
//
// What a pane shows of an item:
//   mounted  - on this face: its outward panel
//   through  - on the other face, deep enough to reach this one: its far panel
//   ghost    - on the other face and short of this one: a dashed outline, so
//              the space it takes is visible without hiding the free depth
//              behind it
//   missing  - no compiled drawing for that panel: an outline saying so
//
// Every device goes through configuredFace, with its own swaps and fields.

import {RU, RAIL_W, OPENING, HOLE_DY, HOLE_SQUARE, HOLE_ROUND, SIDES} from './rails.js';
import {configuredFace} from './face.js';
import {svgEl} from './dom.js';
import {uLabel} from './model.js';

// Which of the device's own panels faces `pane`. On its own face that is its
// front, unless it is turned; on the other face, the reverse.
export const panelFor = (item, pane) => (((item.face === pane) !== !!item.turned) ? 'front' : 'rear');

function drawRails(out, frame, baseRU, totalH) {
  const X = x => x + OPENING / 2;
  const round = frame.holes?.style === 'tapped';
  for (const s of SIDES) {
    out.append(svgEl('rect', {x: X(Math.min(s.inner, s.outer)), y: 0, width: RAIL_W, height: totalH,
      'data-rail': s.side, fill: 'var(--pt-surface-2)', stroke: 'var(--pt-line)', 'stroke-width': 1}));
  }
  for (let i = 0; i < frame.heightRU; i++) {
    const u = baseRU + i;
    const yBottom = totalH - i * RU;
    for (const s of SIDES) {
      const x0 = X(Math.min(s.inner, s.outer));
      out.append(svgEl('line', {x1: x0, y1: yBottom - RU, x2: x0 + RAIL_W, y2: yBottom - RU,
        stroke: 'var(--pt-line)', 'stroke-width': 0.8}));
      for (const dy of HOLE_DY) {
        const hole = {fill: 'var(--pt-ground)', stroke: 'var(--pt-line)', 'stroke-width': 0.5,
                      'data-rail-hole': s.side};
        out.append(round
          ? svgEl('circle', {cx: X(s.hole), cy: yBottom - dy, r: HOLE_ROUND / 2, ...hole})
          : svgEl('rect', {x: X(s.hole) - HOLE_SQUARE / 2, y: yBottom - dy - HOLE_SQUARE / 2,
                           width: HOLE_SQUARE, height: HOLE_SQUARE, rx: 0.6, ...hole}));
      }
      const t = svgEl('text', {x: X(s.number), y: yBottom - RU / 2 + 4,
        'text-anchor': 'middle', 'font-family': 'IBM Plex Mono, monospace',
        'font-size': 11, 'font-weight': 500, fill: 'var(--pt-ink-muted)', 'data-rail-num': s.side});
      t.textContent = String(uLabel(frame, u));
      out.append(t);
    }
  }
}

// The selection ring is drawn, not styled: CSS outline does not render on
// an SVG group.
const ring = (top, ruH) => svgEl('rect', {x: -3, y: top - 1.5, width: OPENING + 6, height: ruH * RU + 3,
  rx: 3, fill: 'none', stroke: 'var(--pt-brass)', 'stroke-width': 2.5, class: 'rk-sel-ring',
  'pointer-events': 'none'});

function outline(top, ruH, text, attrs) {
  const g = svgEl('g', attrs);
  g.append(svgEl('rect', {x: 0.5, y: top + 0.5, width: OPENING - 1, height: ruH * RU - 1, rx: 2,
    fill: 'var(--pt-surface-2)', 'fill-opacity': 0.35, stroke: 'var(--pt-ink-muted)',
    'stroke-width': 1, 'stroke-dasharray': '4 3'}));
  const t = svgEl('text', {x: OPENING / 2, y: top + ruH * RU / 2 + 4, 'text-anchor': 'middle',
    'font-size': 11, 'font-family': 'IBM Plex Mono, monospace', fill: 'var(--pt-ink-muted)'});
  t.textContent = text;
  g.append(t);
  return g;
}

export async function drawElevation({items, frame, view = 'front', baseRU = 1, reaches = () => true,
                                     hitTargets = false, selectedId = null, selectedU = null,
                                     placeholders = true}) {
  const totalH = frame.heightRU * RU;
  const out = svgEl('svg', {xmlns: 'http://www.w3.org/2000/svg', 'data-pane': view,
    viewBox: `${-RAIL_W - 6} -18 ${OPENING + RAIL_W * 2 + 12} ${totalH + 30}`});
  drawRails(out, frame, baseRU, totalH);
  // Under the devices, so a click on a device is the device's; a click on an
  // empty U lands here.
  if (hitTargets) {
    for (let i = 0; i < frame.heightRU; i++) {
      const u = baseRU + i;
      out.append(svgEl('rect', {x: 0, y: totalH - (i + 1) * RU, width: OPENING, height: RU,
        fill: 'transparent', 'data-u': String(u), 'data-face': view,
        class: u === selectedU ? 'rk-u rk-u-selected' : 'rk-u'}));
    }
  }
  let styled = false;
  for (const it of items) {
    const common = {'data-item-id': it.id, 'data-device-name': it.label, 'data-device-ref': it.ref,
                    ...(it.id === selectedId ? {class: 'rk-selected'} : {})};
    const through = it.face !== view;
    const topOf = ruH => totalH - (it.ru - baseRU + ruH) * RU;
    if (through && !reaches(it)) {
      // A ghost lets clicks through to the empty U under it: the space
      // behind a short device is exactly where a half-depth one goes.
      const ruH = it.u ?? 1;
      out.append(outline(topOf(ruH), ruH, `${it.label} · ${it.face}, short of this rail`,
                         {...common, 'data-panel': 'ghost', 'pointer-events': 'none'}));
      if (it.id === selectedId) out.append(ring(topOf(ruH), ruH));
      continue;
    }
    const panel = panelFor(it, view);
    const face = await configuredFace({ref: it.ref, cfg: it.cfg, view: panel,
                                       swaps: it.swaps || {}, fields: it.fields || {}});
    if (!face) {
      if (placeholders) {
        const ruH = it.u ?? 1;
        out.append(outline(topOf(ruH), ruH, `${it.label} · no ${panel} drawing`,
                           {...common, 'data-panel': 'missing'}));
        if (it.id === selectedId) out.append(ring(topOf(ruH), ruH));
      }
      continue;
    }
    const root = new DOMParser().parseFromString(face.text, 'image/svg+xml').documentElement;
    const vb = (root.getAttribute('viewBox') || '').split(/\s+/).map(Number);
    const w = parseFloat(root.getAttribute('width')) || vb[2];
    const h = parseFloat(root.getAttribute('height')) || vb[3];
    const ruH = it.u ?? Math.max(1, Math.round(h / RU));
    const y = topOf(ruH) + (ruH * RU - h) / 2;
    const g = svgEl('g', {transform: `translate(${(OPENING - w) / 2} ${y})`, ...common,
                          'data-panel': through ? 'through' : 'mounted'});
    // Ids are NOT rewritten per device. The compiled drawings carry no <defs>,
    // no url(#...) and no href="#...", so there is nothing to collide - and
    // renaming them would break swap.js, which finds a seated module by the
    // canonical id the compiler gave it. One <style> is enough: every
    // compiled drawing carries the same stylesheet.
    for (const kid of [...root.childNodes]) {
      if (kid.nodeName === 'style') { if (styled) continue; styled = true; }
      g.append(document.importNode(kid, true));
    }
    out.append(g);
    if (it.id === selectedId) out.append(ring(topOf(ruH), ruH));
  }
  return out;
}
