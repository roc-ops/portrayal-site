// ONE FACE OF A RACK, drawn from data: the rails with this rack's holes, and
// every item on it. The Rack Builder draws both faces with it; the showcase's
// build2dElevation is an adapter over it, so the two can never disagree about
// what a rail or a device looks like.
//
// What a pane shows of an item (feedback round 3 §2 - there is no more
// "ghost"; every device shows a real panel on both faces):
//   mounted  - on this face: its outward panel, plus rack ears when `ears`
//   through  - on the other face: its far panel, whether or not it reaches
//   missing  - no compiled drawing for that panel: an outline saying so
//
// Every device goes through configuredFace, with its own swaps and fields.

import {RU, RAIL_W, OPENING, HOLE_DY, HOLE_SQUARE, HOLE_ROUND, SIDES} from '../../vendor/rack/rails.js';
import {configuredFace} from './face.js';
import {svgEl} from './dom.js';
import {uLabel} from '../../vendor/rack/model.js';
import {isRackMount} from '../../vendor/rack/export-data.js';
import {faceOfAt, sideOfAt, STANDOFF} from '../../vendor/rack/zero-u.js';

// Which of the device's own panels faces `pane`. On its own face that is its
// front, unless it is turned; on the other face, the reverse.
export const panelFor = (item, pane) => (((item.face === pane) !== !!item.turned) ? 'front' : 'rear');

// RAIL COLORS. The showcase draws its rails from the site's theme tokens, so
// they follow light and dark mode. The Rack Builder draws them as metal:
// fixed colors that stay silver in either theme, taken from site/rack3d.js's
// own rail, hole, ear and screw materials so 2D and 3D agree.
const THEMED = {rail: 'var(--pt-surface-2)', railLine: 'var(--pt-line)', hole: 'var(--pt-ground)',
                num: 'var(--pt-ink-muted)', ear: 'var(--pt-ink-muted)', earOpacity: 0.35,
                earLine: 'var(--pt-ink-muted)', screw: 'var(--pt-ink-muted)', screwLine: 'var(--pt-ink)'};
const METAL = {rail: '#B9BFC6', railLine: '#8D949C', hole: '#15181B', num: '#2B3036',
               ear: '#A8AEB5', earOpacity: 1, earLine: '#6F767E', screw: '#8D949C', screwLine: '#3A4047'};

function drawRails(out, frame, baseRU, totalH, C = THEMED) {
  const X = x => x + OPENING / 2;
  const round = frame.holes?.style === 'tapped';
  for (const s of SIDES) {
    out.append(svgEl('rect', {x: X(Math.min(s.inner, s.outer)), y: 0, width: RAIL_W, height: totalH,
      'data-rail': s.side, fill: C.rail, stroke: C.railLine, 'stroke-width': 1}));
  }
  for (let i = 0; i < frame.heightRU; i++) {
    const u = baseRU + i;
    const yBottom = totalH - i * RU;
    for (const s of SIDES) {
      const x0 = X(Math.min(s.inner, s.outer));
      out.append(svgEl('line', {x1: x0, y1: yBottom - RU, x2: x0 + RAIL_W, y2: yBottom - RU,
        stroke: C.railLine, 'stroke-width': 0.8}));
      for (const dy of HOLE_DY) {
        const hole = {fill: C.hole, stroke: C.railLine, 'stroke-width': 0.5,
                      'data-rail-hole': s.side};
        out.append(round
          ? svgEl('circle', {cx: X(s.hole), cy: yBottom - dy, r: HOLE_ROUND / 2, ...hole})
          : svgEl('rect', {x: X(s.hole) - HOLE_SQUARE / 2, y: yBottom - dy - HOLE_SQUARE / 2,
                           width: HOLE_SQUARE, height: HOLE_SQUARE, rx: 0.6, ...hole}));
      }
      const t = svgEl('text', {x: X(s.number), y: yBottom - RU / 2 + 4,
        'text-anchor': 'middle', 'font-family': 'IBM Plex Mono, monospace',
        'font-size': 11, 'font-weight': 500, fill: C.num, 'data-rail-num': s.side});
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

// A MISSING FACE'S OUTLINE follows the theme on screen. On paper (the
// exported sheet, fixed ink on white) it is fixed too, like the metal rails:
// a sheet exported from a dark page must not carry dark-theme paint.
const OUTLINE = {fill: 'var(--pt-surface-2)', ink: 'var(--pt-ink-muted)'};
const OUTLINE_PAPER = {fill: '#E4E7EA', ink: '#5B636B'};

function outline(top, ruH, text, attrs, C = OUTLINE) {
  const g = svgEl('g', attrs);
  g.append(svgEl('rect', {x: 0.5, y: top + 0.5, width: OPENING - 1, height: ruH * RU - 1, rx: 2,
    fill: C.fill, 'fill-opacity': 0.35, stroke: C.ink,
    'stroke-width': 1, 'stroke-dasharray': '4 3'}));
  const t = svgEl('text', {x: OPENING / 2, y: top + ruH * RU / 2 + 4, 'text-anchor': 'middle',
    'font-size': 11, 'font-family': 'IBM Plex Mono, monospace', fill: C.ink});
  t.textContent = text;
  g.append(t);
  return g;
}

// RACK EARS (feedback round 3 §2): an L-bracket flange over each rail at a
// mounted device's height, drawn AFTER the device group so it overlaps its
// edges like a real ear. Geometry matches rack3d.js's rackEars and the rails
// in rails.js - the flange runs from the device's own edge (the opening's
// side, x=0 or x=OPENING) out across the rail to just past the hole column
// (SIDES[].hole), and a screw head sits at the first and last hole (HOLE_DY)
// of every U the device covers.
//
// Fix round 1: the flange in the rail's own surface-2/line colours was
// nearly invisible against the rail itself. It reads as metal now - a
// muted-ink flange (not full ink, so it stays a shade behind the device's
// own panel) with a darker screw head and a short slot line.
const EAR_OVERHANG = 3; // mm the flange runs past the hole centre, so the screw head sits inside it
const SCREW_SLOT = 1.6; // mm half-length of each screw head's slot line

function drawEars(out, item, topOf, ruH, C = THEMED) {
  const X = x => x + OPENING / 2;
  const top = topOf(ruH), bottom = topOf(0);
  // Two screws per ear in EVERY U the ear covers - the first and last hole of
  // each U - as rack3d.js's rackEars draws them and as the BOM counts them
  // (4 x U per device). One pair for the whole device read as a 1U ear on a
  // 10U chassis.
  const screwYs = [];
  for (let k = 0; k < ruH; k++) {
    const uBottom = topOf(k);
    screwYs.push(uBottom - HOLE_DY[0], uBottom - HOLE_DY[HOLE_DY.length - 1]);
  }
  const g = svgEl('g', {class: 'rk-ears', 'data-ears-for': item.id, 'data-item-id': item.id,
                        'pointer-events': 'all'});
  for (const s of SIDES) {
    const holeX = X(s.hole);
    const x0 = s.side === 'left' ? holeX - EAR_OVERHANG : OPENING;
    const x1 = s.side === 'left' ? 0 : holeX + EAR_OVERHANG;
    g.append(svgEl('rect', {x: x0, y: top, width: x1 - x0, height: bottom - top,
      fill: C.ear, 'fill-opacity': C.earOpacity, stroke: C.earLine, 'stroke-width': 1}));
    for (const cy of screwYs) {
      g.append(svgEl('circle', {cx: holeX, cy, r: HOLE_ROUND / 2,
        fill: C.screw, stroke: C.screwLine, 'stroke-width': 0.6}));
      g.append(svgEl('line', {x1: holeX - SCREW_SLOT, y1: cy, x2: holeX + SCREW_SLOT, y2: cy,
        stroke: C.screwLine, 'stroke-width': 0.5}));
    }
  }
  out.append(g);
}

// U at a given SVG y coordinate, the inverse of drawElevation's own layout
// (y=0 is the top rail; a U's bottom sits at totalH - (u - baseRU) * RU).
// The pure half of drag support (spec round 2 §1): the drag controller in
// drag.js maps a pointer's screen position into this space, this then maps
// that into a U.
export function uAtY(frame, y, baseRU = 1) {
  const totalH = frame.heightRU * RU;
  const i = Math.floor((totalH - y) / RU);
  return Math.min(baseRU + frame.heightRU - 1, Math.max(baseRU, baseRU + i));
}

// ZERO-U PARTS (the kit's rack/zero-u.js): a duct standing beside an upright, drawn
// as it stands, portrait, outside the rail. `zeroU` entries are {id, ref, cfg,
// label, at, ru, w, h}: w and h the part's chassis width and drawn height in mm,
// ru its bottom U. A two-post's uprights are seen from both panes (its front
// view from the front, its rear view from the rear, mirrored across); a
// four-post's upright is on one face, and only that pane draws the part, by
// its working (front) face. Every pane is widened and raised for every part
// whichever pane draws it, so the two panes keep one box and one U scale.
const zeroUShown = (z, view) => { const f = faceOfAt(z.at); return f == null || f === view; };
const zeroUPanel = (z, view) => (faceOfAt(z.at) == null ? view : 'front');
// Its centre across the pane: rack x is right as seen from the front; the rear pane mirrors it.
const zeroUPaneX = (z, view) => {
  const s = sideOfAt(z.at) === 'left' ? -1 : 1, xr = s * (OPENING / 2 + RAIL_W + STANDOFF + (z.w || 0) / 2);
  return view === 'rear' ? OPENING / 2 - xr : OPENING / 2 + xr;
};
function zeroUBox(zeroU, frame, baseRU, g) {
  const totalH = frame.heightRU * RU;
  const wide = Math.max(0, ...zeroU.map(z => STANDOFF + (z.w || 0) + 4));
  const top = Math.min(-18, ...zeroU.map(z => totalH - (z.ru - baseRU) * RU - (z.h || 0) - 6));
  const side = Math.max(g, wide);
  return {x: -RAIL_W - side, y: top, w: OPENING + RAIL_W * 2 + side * 2, h: totalH + 12 - top};
}
// A NARROW RACK-FACE PART on one rail stands over that rail's holes, not
// across the opening; on the right rail it is the left-hand drawing turned end
// over end (upstream design 3, as built). `side` is as seen from its own face.
const SIDED = new Set(['left', 'right']);
function sidedTransform(it, view, w, h, y) {
  const left = (it.side === 'left') === (it.face === view);
  const cx = OPENING / 2 + (left ? SIDES[0].hole : SIDES[1].hole);
  const x = cx - w / 2;
  const turn = it.side === 'right' ? ` rotate(180 ${w / 2} ${h / 2})` : '';
  return `translate(${x} ${y})${turn}`;
}

export async function drawElevation({items, frame, view = 'front', baseRU = 1,
                                     hitTargets = false, selectedId = null, selectedU = null,
                                     placeholders = true, ears = false, metal = false, paper = false, laneGap = 0,
                                     zeroU = [], selectedZeroU = null}) {
  const C = metal ? METAL : THEMED;
  const totalH = frame.heightRU * RU;
  // Lanes (cable routing spec §7): with routed cables the gutter beside each
  // rail widens to the lane gap, so a run up the side has room.
  const g = Math.max(6, laneGap);
  const box = zeroU.length ? zeroUBox(zeroU, frame, baseRU, g) : null;
  const out = svgEl('svg', {xmlns: 'http://www.w3.org/2000/svg', 'data-pane': view,
    viewBox: box ? `${box.x} ${box.y} ${box.w} ${box.h}` : `${-RAIL_W - g} -18 ${OPENING + RAIL_W * 2 + g * 2} ${totalH + 30}`});
  drawRails(out, frame, baseRU, totalH, C);
  let zStyled = false;
  for (const z of zeroU.filter(x => zeroUShown(x, view))) {
    const panel = zeroUPanel(z, view);
    const face = await configuredFace({ref: z.ref, cfg: z.cfg, view: panel, swaps: {}, fields: {}});
    const bottom = totalH - (z.ru - baseRU) * RU;
    const attrs = {'data-zerou-id': z.id, 'data-device-name': z.label, 'data-device-ref': z.ref,
                   'data-panel': 'zerou', 'data-zerou-at': z.at, style: 'cursor: pointer',
                   ...(z.id === selectedZeroU ? {class: 'rk-selected'} : {})};
    let w = z.w || 0, h = z.h || 0, gz;
    if (face) {
      const root = new DOMParser().parseFromString(face.text, 'image/svg+xml').documentElement;
      const vb = (root.getAttribute('viewBox') || '').split(/\s+/).map(Number);
      w = parseFloat(root.getAttribute('width')) || vb[2] || w;
      h = parseFloat(root.getAttribute('height')) || vb[3] || h;
      gz = svgEl('g', {transform: `translate(${zeroUPaneX(z, view) - w / 2} ${bottom - h})`, ...attrs});
      for (const kid of [...root.childNodes]) {
        if (kid.nodeName === 'style') { if (zStyled) continue; zStyled = true; }
        gz.append(document.importNode(kid, true));
      }
      // The whole part takes a click: its backing rect, under its drawing.
      gz.prepend(svgEl('rect', {x: 0, y: 0, width: w, height: h, fill: 'transparent', 'data-zerou-hit': z.id}));
    } else {
      gz = svgEl('g', attrs);
      if (placeholders) {
        const x0 = zeroUPaneX(z, view) - w / 2;
        const P = paper ? OUTLINE_PAPER : OUTLINE;
        gz.append(svgEl('rect', {x: x0 + 0.5, y: bottom - h + 0.5, width: Math.max(1, w - 1), height: Math.max(1, h - 1), rx: 2,
          fill: P.fill, 'fill-opacity': 0.35, stroke: P.ink, 'stroke-width': 1, 'stroke-dasharray': '4 3'}));
        const t = svgEl('text', {x: x0 + w / 2, y: bottom - h / 2, 'text-anchor': 'middle', 'font-size': 11,
          'font-family': 'IBM Plex Mono, monospace', fill: P.ink, transform: `rotate(-90 ${x0 + w / 2} ${bottom - h / 2})`});
        t.textContent = `${z.label} · no ${panel} drawing`;
        gz.append(t);
      }
    }
    out.append(gz);
    if (z.id === selectedZeroU) {
      out.append(svgEl('rect', {x: zeroUPaneX(z, view) - w / 2 - 3, y: bottom - h - 1.5, width: w + 6, height: h + 3,
        rx: 3, fill: 'none', stroke: 'var(--pt-brass)', 'stroke-width': 2.5, class: 'rk-sel-ring', 'pointer-events': 'none'}));
    }
  }
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
  // Fix round 1: a selection ring is queued here and appended only after
  // every item is drawn, not right after its own item - otherwise a ring
  // drawn for a `through` item (through panels go first, by precedence
  // below) could sit under a `mounted` item's panel drawn later at the same
  // U (a four-post pair sharing it).
  const rings = [];
  // Precedence (round 3 §2): draw every item's `through` panel before any
  // `mounted` one, so a four-post pair sharing a U shows the item actually
  // mounted on this face on top - by data-panel, not by item order.
  // MANAGERS LAST (spec section 6): a rack-face part bolts over its host, so it
  // is drawn after every device. On the other face it shows only where no
  // device spans its U - behind a device it is out of sight.
  const isFace = it => it.mount === 'rack-face';
  const spans = (o, u) => u >= o.ru && u <= o.ru + (o.u ?? 1) - 1;
  const shown = items.filter(it => !(isFace(it) && it.face !== view
                                     && items.some(o => !isFace(o) && spans(o, it.ru))));
  const rank = it => (it.face === view ? 1 : 0) + (isFace(it) ? 2 : 0);
  const order = [...shown].sort((a, b) => rank(a) - rank(b));
  for (const it of order) {
    const common = {'data-item-id': it.id, 'data-device-name': it.label, 'data-device-ref': it.ref,
                    ...(it.id === selectedId ? {class: 'rk-selected'} : {})};
    const through = it.face !== view;
    const topOf = ruH => totalH - (it.ru - baseRU + ruH) * RU;
    const panel = panelFor(it, view);
    const face = await configuredFace({ref: it.ref, cfg: it.cfg, view: panel,
                                       swaps: it.swaps || {}, fields: it.fields || {}});
    // One height for this item, computed before the `!face` branch: `it.u`
    // when it is known (every real caller sets it via fit.js's itemsWithU),
    // falling back to the compiled drawing's own height only when it is not.
    let ruH = it.u ?? 1;
    if (!face) {
      if (placeholders) {
        out.append(outline(topOf(ruH), ruH, `${it.label} · no ${panel} drawing`,
                           {...common, 'data-panel': 'missing', ...(isFace(it) ? {'pointer-events': 'none'} : {})}, paper ? OUTLINE_PAPER : OUTLINE));
        if (it.id === selectedId) rings.push([topOf(ruH), ruH]);
      }
      continue;
    }
    const root = new DOMParser().parseFromString(face.text, 'image/svg+xml').documentElement;
    const vb = (root.getAttribute('viewBox') || '').split(/\s+/).map(Number);
    const w = parseFloat(root.getAttribute('width')) || vb[2];
    const h = parseFloat(root.getAttribute('height')) || vb[3];
    if (it.u == null) ruH = Math.max(1, Math.round(h / RU));
    const y = topOf(ruH) + (ruH * RU - h) / 2;
    const g = svgEl('g', {transform: isFace(it) && SIDED.has(it.side) ? sidedTransform(it, view, w, h, y) : `translate(${(OPENING - w) / 2} ${y})`, ...common,
                          ...(isFace(it) && SIDED.has(it.side) ? {'data-side': it.side} : {}),
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
    // A manager is mostly air: a click on its tray or ears is meant for the
    // host behind it, or the empty U on the far face. This holds on either
    // face. Its rings (data-kind="ring"; any data-ref component too, for
    // future parts) and the gutter mark still take clicks (spec section 7).
    if (isFace(it)) {
      g.setAttribute('pointer-events', 'none');
      for (const part of g.querySelectorAll('[data-kind="ring"], [data-ref]')) {
        part.setAttribute('pointer-events', 'visiblePainted');
      }
    }
    // Ears only on the face the item is actually mounted on, and only after
    // its own group, so they overlap its edges like a real ear.
    // (a desktop, wall or DIN-rail device has none: the Rack Builder marks it
    // with `mount`, which the showcase's items never carry)
    if (!through && ears && isRackMount(it)) drawEars(out, it, topOf, ruH, C);
    if (it.id === selectedId) rings.push([topOf(ruH), ruH]);
  }
  // A U carrying a manager says so in the gutter: the manager itself is mostly
  // see-through. The marker is also how a click reaches it.
  for (const it of shown.filter(i => isFace(i) && i.face === view)) {
    const y0 = totalH - (it.ru - baseRU + 1) * RU;
    const mark = svgEl('g', {'data-manager-mark': it.id, 'data-item-id': it.id,
      'data-device-name': it.label, style: 'cursor: pointer'});
    mark.append(svgEl('rect', {x: -RAIL_W - 6, y: y0, width: RAIL_W + 6, height: RU, fill: 'transparent'}),
      svgEl('path', {d: `M ${-RAIL_W - 5} ${y0 + 4} l 4 ${RU / 2 - 4} l -4 ${RU / 2 - 4} z`,
        fill: 'var(--pt-brass)'}));
    out.append(mark);
  }
  for (const [top, ruH] of rings) out.append(ring(top, ruH));
  return out;
}
