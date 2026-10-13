// ONE SIDE OF A RACK, drawn from data (portrayal-site#187): the Rack
// Builder's Left / Right pair. side-geometry.js has the rule for each number
// here; this draws them. A side pane shows depth and height:
//
//   - THE RACK'S DEPTH: a dashed outline from the front rail plane back by
//     frame.usableDepth, and the posts at the front and rear rail planes
//     (frame.railDepth apart), each 34 mm deep behind its mounting face as the
//     3D rack stands them, with the U numbers on them;
//   - EVERY ITEM, by its own left or right drawing, with its swaps and fields
//     applied as the front pane applies them (face.js configuredFace), in the
//     depth the kit places its body at (solids.js) and at the height the
//     front pane draws it (the kit's fit.js itemBox), so a row lines up across all four
//     panes. Flush on its rail plane, as in 3D;
//   - THE PARTS BESIDE THE RACK (rack.zeroU) and the managers bolted over a
//     device, the same way;
//   - THE CABLES, each through the kit's own points (route.js routePath)
//     dropped onto depth and height: a patch between two ports of one face
//     stays in front of that face, a run up a lane is a vertical on its rail
//     plane, and a run from front to rear is drawn through the rack. Nothing
//     is bent or eased: the corners are the kit's;
//   - THE BUNDLES as the front pane has them: the members packed along the
//     trunk, the envelope only while the bundle or a member is hovered or
//     selected, and each strap a bar across the trunk.
//
// WHAT IS IN FRONT OF WHAT. A pane is looked at from beyond one side of the
// rack. Bodies are painted farthest first (side-geometry.js paintOrder), so
// a nearer one covers a farther one where their boxes overlap. The posts on
// the near side stand in front of every body between the rails. A part
// beside the rack on the near side stands in front of the posts too: it is
// painted last and see-through (NEAR_OPACITY, as the front pane paints a
// vertical manager's cover), because it is a whole rack tall and everything
// a side view is for is behind it. The cables are painted over the bodies
// and the posts and under that part.
//
// VIEW ONLY. Nothing here is a control for placing, moving or cabling: there
// are no U targets and no port targets. An item or a part takes a click
// (rack-page.js selects it); a cable's stroke takes none, and is found by
// geometry (hover.js hoverAt2d), as on the front pane.
//
// The same class and data names as the front pane's cables (cables.js,
// cable-view.js), so the page's dimming, pinning and envelope rules
// (rack.css; hover.js paintHover2d; cable-view.js paintCables, paintBundles)
// apply to a side pane without knowing it is one.

import {RU} from '../../vendor/rack/rails.js';
import {uLabel} from '../../vendor/rack/model.js';
import {isZeroUPart, itemBox} from '../../vendor/rack/fit.js';
import {colorOf, WIDTH} from '../../vendor/rack/cable-geometry.js';
import {cablePlan, endKey, endName} from '../../vendor/rack/cable-rules.js';
import {configuredFace} from './face.js';
import {svgEl, importDrawingNode} from './dom.js';
import {elevationBox} from './elevation.js';
import {bundleSummary, drawnDiameter, TIE_HALF, tieCentre} from './bundle-view.js';
import {strapBarEl, tieAttrs} from './cable-view.js';
import {STRAP_PAINT, STRAP_MIN_PX} from './stage.js';
import {landedBends} from './route-context.js';
import {noteStrap} from './strap-size.js';
import {itemDepth, zeroUDepth, shownSide, sideBox, drawingX, paintOrder, onNearSide, postsOf, depthExtent,
        paneSpanX, sideX, sideY, project, projectedPath, packedPoints, strapBar, labelSize, plugSpans} from './side-geometry.js';

// What a part beside the rack on the near side keeps of its own opacity. Its
// drawing alone, see-through over the devices, read as a grey bezel on the
// front of each of them: so it is fainter than the front pane's cover (0.34),
// and what says it is a separate part in front is drawn round it at full
// strength: a dashed outline, a light hatch across it, and its name.
export const NEAR_OPACITY = 0.2;
// What a part beside the far side keeps of its own: behind every body, and seen past them.
export const FAR_OPACITY = 0.3;
// The least a pane's own words measure on screen, in CSS px (sizeSideLabels).
export const LABEL_MIN_PX = {num: 9, word: 11, part: 11};
// A PLUG AS A BLOCK. Its length is the kit's (the plug's reach). Its height is
// A DRAWING FIGURE, 9 mm for every plug: neither the kit nor the cable types
// (cable-types.json: a jacket's diameter and bend radii) states a connector's
// or a boot's size, so nothing here is measured across the run. It is in its
// cable's own colour with a dark rim and a nose line at the port, which is
// how it is told from a strap at a glance: a strap is a neutral bar across a
// trunk, a plug a coloured block along a cable's end.
const PLUG_H = 9;
const PLUG_LINE = '#1b1d20';
// The line round every body, in the stage's own ink: a dark chassis on the dark stage is otherwise not seen.
const EDGE = {fill: 'none', stroke: 'var(--pt-ink-muted)', 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none'};
// mm under the rack a pane always has when the rack has cables (the front pane's DROP).
const DROP = 40;
const MARGIN = 24;
const WORD_ROOM = 24;
// mm under the rack a near part's name may take (its size is capped at this)
const PART_ROOM = 32;

// The metal the front pane's rails are (elevation.js METAL).
const METAL = {rail: '#B9BFC6', railLine: '#8D949C', num: '#2B3036'};
const OUTLINE = {fill: 'var(--pt-surface-2)', ink: 'var(--pt-ink-muted)'};
const BAND = '#8b939c';
const BEND_WARN = '#d9822b';

const n3 = v => Math.round(v * 1000) / 1000;

// A compiled drawing's root, its size and where its own x = 0, y = 0 is (a
// drawing bigger than its face declares the face: elevation.js, #168).
function parsed(text) {
  const root = new DOMParser().parseFromString(text, 'image/svg+xml').documentElement;
  const vb = (root.getAttribute('viewBox') || '').split(/\s+/).map(Number);
  const w = parseFloat(root.getAttribute('width')) || vb[2], h = parseFloat(root.getAttribute('height')) || vb[3];
  const fw = parseFloat(root.getAttribute('data-face-w')), fh = parseFloat(root.getAttribute('data-face-h'));
  const declared = fw > 0 && fh > 0;
  return {root, faceW: declared ? fw : w, faceH: declared ? fh : h,
          ox: declared ? 0 : (Number.isFinite(vb[0]) ? vb[0] : 0), oy: declared ? 0 : (Number.isFinite(vb[1]) ? vb[1] : 0)};
}

/** One side pane as an <svg data-pane="left|right">. `items` are the rack's
 *  with their units (fit.js itemsWithU) and the plugs seated for their cabled
 *  ends, `zeroU` zero-u.js zeroUEntries, as the front pane is given them.
 *  `cabled` leaves the front pane's room under the rack. */
export async function drawSideElevation({rack, items, zeroU = [], pane = 'left', chassisOf, selectedId = null,
                                         selectedZeroU = null, laneGap = 0, cabled = false}) {
  const frame = rack.frame, totalH = frame.heightRU * RU;
  // every body, placed in depth
  const bodies = [];
  for (const it of items) {
    const c = chassisOf(it.ref);
    if (!c || isZeroUPart(c)) continue;
    const span = itemDepth(rack, it, c);
    if (span) bodies.push({kind: 'item', it, c, span});
  }
  const parts = [];
  for (const z of zeroU) {
    const c = chassisOf(z.ref), span = c ? zeroUDepth(rack, z, c) : null;
    if (span) parts.push({kind: 'zerou', z, c, span, near: onNearSide(pane, span)});
  }
  const ext = depthExtent(frame, [...bodies, ...parts].map(b => b.span));
  const {x: bx, w: bw} = paneSpanX(pane, ext);
  // the front pane's own top and height (elevation.js), so a U is at one y in all four panes
  const fb = elevationBox(frame, zeroU, 1, laneGap);
  // (and WORD_ROOM more above it, for FRONT and REAR at the size they are kept readable at)
  // (and as much under it where a part beside the near side is named, below)
  const named = parts.some(x => x.near) ? PART_ROOM + 6 : 0;
  const box = [bx, fb.y - WORD_ROOM, bw, fb.h + WORD_ROOM + Math.max(cabled ? DROP : 0, named)];
  const out = svgEl('svg', {xmlns: 'http://www.w3.org/2000/svg', 'data-pane': pane, 'data-side': 'true', viewBox: box.join(' ')});
  out.dataset.baseBox = box.join(' ');
  out.dataset.depth = ext.join(' ');

  // THE RACK'S DEPTH: from the front rail plane back by usableDepth.
  const deep = Number(frame.usableDepth) || 0;
  if (deep > 0) {
    const a = sideX(pane, 0), b = sideX(pane, -deep);
    out.append(svgEl('rect', {x: Math.min(a, b), y: 0, width: Math.abs(b - a), height: totalH, fill: 'none',
      stroke: 'var(--pt-line)', 'stroke-width': 1, 'stroke-dasharray': '6 4', 'data-side-extent': String(deep), 'pointer-events': 'none'}));
  }
  // which way is the front: a word over each end of the rack
  const word = (z, text, anchor) => {
    const t = svgEl('text', {x: sideX(pane, z), y: -6, 'text-anchor': anchor, 'font-family': 'IBM Plex Mono, monospace',
      'font-size': 11, fill: 'var(--pt-ink-muted)', 'data-side-word': text.toLowerCase(), 'data-side-label': 'word', 'pointer-events': 'none'});
    t.textContent = text;
    out.append(t);
  };
  // FRONT over the front rail plane, REAR over the rearmost post (a two-post has none: over the pane's rear edge)
  const rearmost = Math.min(...postsOf(frame).map(p => p.z0));
  word(0, 'FRONT', pane === 'right' ? 'start' : 'end');
  word(frame.kind === 'two-post' ? ext[0] + 8 : rearmost, 'REAR', pane === 'right' ? 'end' : 'start');

  let styled = false;
  const rings = [];
  const adopt = (g, root) => {
    for (const kid of [...root.childNodes]) {
      if (kid.nodeName === 'style') { if (styled) continue; styled = true; }
      g.append(importDrawingNode(kid) ?? []);
    }
  };
  // One part's group: its drawing in its box, or a dashed outline saying the drawing is missing.
  const draw = async ({ref, cfg, swaps, fields, label, span, y0, h, attrs, units}) => {
    const {view, turn} = shownSide(pane, span);
    const face = await configuredFace({ref, cfg, view, swaps: swaps || {}, fields: fields || {}});
    let b, g;
    if (face) {
      const p = parsed(face.text);
      // the body's bottom above the floor: where the front pane draws it in the span it fills (fit.js itemBox)
      const x = drawingX(pane, span, view, p.faceW), y = sideY(frame, (units ? units(p.faceH) : y0) + p.faceH);
      g = svgEl('g', {transform: `translate(${n3(x - p.ox)} ${n3(y - p.oy)})${turn ? ` rotate(180 ${n3(p.ox + p.faceW / 2)} ${n3(p.oy + p.faceH / 2)})` : ''}`,
        ...attrs, 'data-side-view': view, ...(turn ? {'data-side-turn': 'true'} : {})});
      // the whole box takes a click and the pointer: under the drawing
      g.append(svgEl('rect', {x: p.ox, y: p.oy, width: p.faceW, height: p.faceH, fill: 'transparent', 'data-side-hit': ''}));
      adopt(g, p.root);
      g.append(svgEl('rect', {x: p.ox, y: p.oy, width: p.faceW, height: p.faceH, ...EDGE, 'data-side-edge': '', 'data-pt-ui': '*'}));
      b = {x, y, w: p.faceW, h: p.faceH};
    } else {
      b = sideBox(pane, frame, span, units ? units(h) : y0, h);
      g = svgEl('g', {...attrs, 'data-side-view': 'missing'});
      g.append(svgEl('rect', {x: b.x + 0.5, y: b.y + 0.5, width: Math.max(1, b.w - 1), height: Math.max(1, b.h - 1), rx: 2,
        fill: OUTLINE.fill, 'fill-opacity': 0.35, stroke: OUTLINE.ink, 'stroke-width': 1, 'stroke-dasharray': '4 3', 'data-side-hit': ''}));
      const t = svgEl('text', {x: b.x + b.w / 2, y: b.y + b.h / 2 + 4, 'text-anchor': 'middle', 'font-size': 11,
        'font-family': 'IBM Plex Mono, monospace', fill: OUTLINE.ink});
      t.textContent = `${label} · no ${view} drawing`;
      g.append(t);
    }
    const title = svgEl('title', {});
    title.textContent = label;
    g.prepend(title);
    // where it was put, in rack mm, for a reader of the page: depth from the front rail plane, height from the floor
    g.dataset.depth = `${n3(span.z0)} ${n3(span.z1)}`;
    g.dataset.box = [b.x, b.y, b.w, b.h].map(n3).join(' ');
    return {g, b};
  };
  const zeroUGroup = async ({z, c, span}) => {
    const {g, b} = await draw({ref: z.ref, cfg: z.cfg, label: z.label, span, y0: span.y0, h: z.h || Number(c.h) || 0,
      attrs: {'data-zerou-id': z.id, 'data-device-name': z.label, 'data-device-ref': z.ref, 'data-zerou-at': z.at,
              style: 'cursor: pointer', ...(z.id === selectedZeroU ? {class: 'rk-selected'} : {})}});
    if (z.id === selectedZeroU) rings.push(b);
    return g;
  };

  // FARTHEST FIRST: the parts beside the far side, then every item by how near it is.
  // A part beside the FAR side is behind everything, the whole rack's width
  // away: it is drawn fainter than a body (FAR_OPACITY), on either stage, so
  // it does not join the near part in front of it into one solid column.
  for (const p of parts.filter(x => !x.near)) { const g = await zeroUGroup(p); g.setAttribute('opacity', String(FAR_OPACITY)); g.dataset.sideFar = 'true'; out.append(g); }
  const drawn = await Promise.all(paintOrder(pane, bodies).map(async ({it, c, span}) => {
    // above the floor: the body centred in the span its item fills (the kit's fit.js itemBox), as the front pane centres it
    const box = itemBox(rack, it, chassisOf), whole = (box.hi - box.lo) / RU;
    const units = faceH => (box.lo + box.hi) / 2 - faceH / 2;
    const {g, b} = await draw({ref: it.ref, cfg: it.cfg, swaps: it.swaps, fields: it.fields, label: it.label, span,
      h: Number(c.h) || whole * RU, units,
      attrs: {'data-item-id': it.id, 'data-device-name': it.label, 'data-device-ref': it.ref, 'data-side-face': it.face,
              style: 'cursor: pointer', ...(it.turned ? {'data-side-turned': 'true'} : {}),
              ...(it.id === selectedId ? {class: 'rk-selected'} : {})}});
    if (it.id === selectedId) rings.push(b);
    return g;
  }));
  out.append(...drawn);

  // THE POSTS on the near side, in front of every body between the rails, with the U numbers.
  const posts = svgEl('g', {'data-side-posts': pane, 'pointer-events': 'none'});
  // THE U NUMBERS ARE OVER EVERYTHING but the selection ring: a part beside
  // the near side stands in front of the front posts, and its fingers ran
  // through the numbers. Each number has a rim of the post's own metal, so it
  // reads on whatever it lies over. Appended after the near parts, below.
  const nums = svgEl('g', {'data-side-nums': pane, 'pointer-events': 'none'});
  for (const p of postsOf(frame)) {
    const a = sideX(pane, p.z0), b = sideX(pane, p.z1), x0 = Math.min(a, b), w = Math.abs(b - a);
    posts.append(svgEl('rect', {x: x0, y: 0, width: w, height: totalH, fill: METAL.rail, stroke: METAL.railLine,
      'stroke-width': 1, 'data-side-post': p.at}));
    for (let i = 0; i < frame.heightRU; i++) {
      const yBottom = totalH - i * RU;
      posts.append(svgEl('line', {x1: x0, y1: yBottom - RU, x2: x0 + w, y2: yBottom - RU, stroke: METAL.railLine, 'stroke-width': 0.8}));
      const t = svgEl('text', {x: x0 + w / 2, y: yBottom - RU / 2 + 4, 'text-anchor': 'middle',
        'font-family': 'IBM Plex Mono, monospace', 'font-size': 11, 'font-weight': 500, fill: METAL.num, stroke: METAL.rail, 'stroke-width': 3, 'paint-order': 'stroke',
        'stroke-linejoin': 'round', 'data-side-num': p.at,
        'data-side-label': 'num', 'data-mid': String(yBottom - RU / 2)});
      t.textContent = String(uLabel(frame, 1 + i));
      nums.append(t);
    }
  }
  out.append(posts);

  // THE PARTS BESIDE THE NEAR SIDE, in front of everything. The drawing is
  // see-through (NEAR_OPACITY), so the devices and the lanes behind it are
  // seen; and it is marked as a part of its own, in front: a dashed outline
  // and a light hatch in the stage's ink, and its name up its length. The
  // marks are the page's (data-pt-ui) and take no pointer; the part itself
  // takes a click. The cables go in under this layer (drawSideCables).
  const near = svgEl('g', {'data-side-near': pane});
  const nearParts = parts.filter(x => x.near);
  if (nearParts.length) {
    const defs = svgEl('defs', {});
    const pat = svgEl('pattern', {id: `rk-side-hatch-${pane}`, width: 30, height: 30, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)'});
    pat.append(svgEl('line', {x1: 0, y1: 0, x2: 0, y2: 30, stroke: 'var(--pt-ink-muted)', 'stroke-width': 0.9}));
    defs.append(pat);
    near.append(defs);
  }
  for (const p of nearParts) {
    const g = await zeroUGroup(p);
    g.setAttribute('opacity', String(NEAR_OPACITY));
    near.append(g);
    const [x, y, w, h] = g.dataset.box.split(' ').map(Number);
    const mark = svgEl('g', {'data-side-near-mark': p.z.id, 'pointer-events': 'none', 'data-pt-ui': '*'});
    mark.append(svgEl('rect', {x, y, width: w, height: h, fill: `url(#rk-side-hatch-${pane})`, opacity: 0.16}),
                svgEl('rect', {x, y, width: w, height: h, ...EDGE, 'stroke-dasharray': '6 4'}));
    // ITS NAME, UNDER THE RACK at the part's own foot, running back from the
    // rack's front: below every body and every cable, so it crosses neither
    // at any zoom (up the part's length it ran over the lacers and the patches
    // in front of the rack).
    const frontX = sideX(pane, p.span.z1), foot = Math.max(y + h, totalH) + 4;
    const t = svgEl('text', {x: n3(frontX), y: n3(foot + 11), 'text-anchor': pane === 'right' ? 'start' : 'end', 'font-family': 'IBM Plex Mono, monospace',
      'font-size': 11, fill: 'var(--pt-ink-muted)', 'data-side-label': 'part', 'data-top': String(n3(foot))});
    t.textContent = `${p.z.label}: in front, beside this side of the rack`;
    mark.append(t);
    near.append(mark);
  }
  out.append(near);
  out.append(nums);

  // The selection ring is drawn, not styled, as on the front pane, and last.
  for (const b of rings) out.append(svgEl('rect', {x: b.x - 3, y: b.y - 1.5, width: b.w + 6, height: b.h + 3, rx: 3, fill: 'none',
    stroke: 'var(--pt-brass)', 'stroke-width': 2.5, class: 'rk-sel-ring', 'pointer-events': 'none'}));
  return out;
}

function stroke(g, d, color, w) {
  g.append(svgEl('path', {d, fill: 'none', stroke: '#000', 'stroke-opacity': 0.45, 'stroke-width': w + 1.2,
    'stroke-linecap': 'round', 'stroke-linejoin': 'round'}));
  g.append(svgEl('path', {d, fill: 'none', stroke: color, 'stroke-width': w, 'stroke-linecap': 'round', 'stroke-linejoin': 'round'}));
}

/** THE CABLES AND BUNDLES ON A SIDE PANE. `routes` is route-context.js
 *  routeFacts' answer for this rack (its paths are the kit's points),
 *  `reasons` Map(endKey -> why that end is loose, or null), `centreOf(w, rt)`
 *  where a pack is laid at a ring (scene3d.js stopCentre, bound to this rack
 *  and context), `uOf` endName's. A cable with a loose end is not drawn along
 *  its path, as on the front pane (the cable list says why it is not
 *  connected). Returns {drawn: [cable ids], lo: [X, Y], hi: [X, Y]} or null
 *  when nothing was drawn: the extent of what was, in pane mm. */
export function drawSideCables(svg, rack, routes, reasons = new Map(), {uOf = undefined, centreOf = () => null} = {}) {
  const pane = svg.dataset.pane, frame = rack.frame;
  svg.querySelector(':scope > [data-cables]')?.remove();
  if (!routes?.paths) return null;
  const layer = svgEl('g', {'data-cables': pane});
  const plan = cablePlan(rack);
  const lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
  const see = q => { lo[0] = Math.min(lo[0], q[0]); lo[1] = Math.min(lo[1], q[1]); hi[0] = Math.max(hi[0], q[0]); hi[1] = Math.max(hi[1], q[1]); };
  const loose = e => reasons.get(endKey(e)) != null;
  const drawn = [];
  rack.cables.forEach((c, i) => {
    const path = routes.paths.get(c.id);
    if (!path?.points?.length || loose(c.a) || loose(c.b)) return;
    const place = routes.places?.get(c.id), lay = place ? routes.bundles?.get(place.bundle)?.lay ?? null : null;
    const pts = packedPoints(c.id, path.points, routes.routes?.get(c.id)?.waypoints, place, lay, centreOf, WIDTH);
    const {d, points} = projectedPath(pane, frame, pts);
    if (!d) return;
    points.forEach(see);
    const link = plan.links[i];
    const g = svgEl('g', {'data-cable': 'true', 'data-cable-id': c.id, 'data-link-index': String(i), 'data-media': link.media,
      'data-purpose': link.purpose, 'pointer-events': 'none'});
    const t = svgEl('title', {});
    t.textContent = `${endName(rack, c.a, uOf)} → ${endName(rack, c.b, uOf)}${c.media ? ` · ${c.media}` : ''}`;
    g.append(t);
    stroke(g, d, colorOf(link), WIDTH);
    // THE PLUG AT EACH END, as a block (side-geometry.js plugSpans): the kit's
    // straight run out of the port by the plug's reach. No seated plug or
    // optic has a side drawing to seat here (the devices' indexes list side
    // cages only for grounding studs), so this stands for it: without it a
    // cable starts at a bare panel edge, and the stretch a cable runs out
    // behind a rear device before it turns reads as an overshoot.
    for (const [e, sp] of Object.entries(plugSpans(pts.map((q, k) => ({...q, at: path.points[k].at, end: path.points[k].end}))))) {
      const a = sideX(pane, sp.z0), b = sideX(pane, sp.z1), y = sideY(frame, sp.y);
      const blk = svgEl('g', {'data-side-plug': e});
      blk.append(svgEl('rect', {x: n3(Math.min(a, b)), y: n3(y - PLUG_H / 2), width: n3(Math.abs(b - a)), height: PLUG_H, rx: 2,
        fill: colorOf(link), stroke: PLUG_LINE, 'stroke-width': 1}));
      // the nose: a line across it a third of the way in from the port's face
      const port = sideX(pane, path.points.find(q => q.at === e).z), nose = port + (port === Math.min(a, b) ? 1 : -1) * Math.abs(b - a) / 3;
      blk.append(svgEl('line', {x1: n3(nose), y1: n3(y - PLUG_H / 2), x2: n3(nose), y2: n3(y + PLUG_H / 2), stroke: PLUG_LINE, 'stroke-width': 1}));
      blk.dataset.span = `${n3(Math.min(a, b))} ${n3(Math.max(a, b))} ${n3(y)}`;
      g.append(blk);
      see([Math.min(a, b), y]); see([Math.max(a, b), y]);
    }
    layer.append(g);
    drawn.push(c.id);
  });
  // THE BUNDLES: the envelope stretch by stretch between the trunk's nodes,
  // each as thick as the members that ride it, hidden until its bundle or a
  // member is hovered or selected (rack.css); and the straps, always.
  const onPane = new Set(drawn);
  const bands = svgEl('g', {'data-bundles': pane, 'pointer-events': 'none'});
  const bars = svgEl('g', {'data-bundle-straps': pane, 'pointer-events': 'none'});
  for (const f of routes.bundles?.values() ?? []) {
    const lay = f.lay;
    if (!f.drawn || !lay?.stretches?.length) continue;
    // a node's centre: the kit's point for it, laid on a ring's sill where the kit places the opening
    const at = new Map();
    const pt = i => {
      if (!at.has(i)) {
        const e = lay.T[i], p = lay.pos(i);
        const c = p && e.kind === 'p' ? centreOf({item: e.item, via: e.via}, (lay.at(i)?.diameter ?? 0) / 2) : null;
        at.set(i, p ? project(pane, frame, c ? c.at(p) : p) : null);
      }
      return at.get(i);
    };
    const D = drawnDiameter(f.diameter, WIDTH);
    const g = svgEl('g', {'data-bundle-id': f.id, 'data-members': f.members.join(' '), 'data-diameter': String(Math.round(D * 10) / 10)});
    const title = svgEl('title', {});
    title.textContent = `${f.name}: ${bundleSummary(f)}`;
    g.append(title);
    const env = svgEl('g', {'data-envelope': f.id, visibility: 'hidden', 'data-pt-ui': '*'});
    const rims = svgEl('g', {'data-envelope-rim': f.id, opacity: 0.4}), fills = svgEl('g', {opacity: 0.7});
    env.append(rims, fills);
    let here = 0;
    // NO BUNDLE DRAWING WHERE NONE OF ITS CABLES IS DRAWN (the front pane's
    // rule, cable-view.js): a stretch is drawn only where a member that rides
    // it is drawn on this pane, and a strap only on such a stretch. From the
    // side every landed cable is on both panes, so what this leaves out is a
    // stretch whose riders all have a loose end.
    const shown = st => st.members.some(id => onPane.has(id));
    for (const st of lay.stretches) {
      const p = shown(st) ? pt(st.from) : null, q = p && pt(st.to);
      if (!p || !q) continue;
      here++;
      const d = `M${n3(p[0])} ${n3(p[1])} L${n3(q[0])} ${n3(q[1])}`;
      rims.append(svgEl('path', {d, fill: 'none', stroke: '#000', 'stroke-width': st.diameter + 1.2, 'stroke-linecap': 'round'}));
      fills.append(svgEl('path', {d, fill: 'none', stroke: BAND, 'stroke-width': st.diameter, 'stroke-linecap': 'round',
        'data-bundle-trunk': f.id, 'data-stretch': `${st.from}-${st.to}`, 'data-riders': String(st.members.length)}));
    }
    if (!here) continue;
    g.append(env);
    bands.append(g);
    for (const s of f.straps?.straps ?? []) {
      const hit = lay.stretchAt(s), on = hit && shown(hit.stretch), p = on && pt(hit.stretch.from), q = on && pt(hit.stretch.to);
      const bar = p && q ? strapBar(p, q, hit.f, hit.stretch.diameter / 2 + 2) : null;
      // a strap on a run across the rack is seen end on: counted, not drawn here
      if (!bar) continue;
      const xy = {x1: n3(bar.x1), y1: n3(bar.y1), x2: n3(bar.x2), y2: n3(bar.y2)};
      const el = strapBarEl({'data-strap': f.id, 'data-members': f.members.join(' '), 'data-along': String(s.along_mm), 'data-pack': String(Math.round(hit.stretch.diameter * 100) / 100)}, xy, s);
      // from the side the pack is its circle, as wide as its diameter whichever way the run goes (strap-size.js)
      const len = Math.hypot(bar.x2 - bar.x1, bar.y2 - bar.y1) || 1;
      noteStrap(el, {c: bar.at, n: [(bar.x2 - bar.x1) / len, (bar.y2 - bar.y1) / len], lo: -hit.stretch.diameter / 2, hi: hit.stretch.diameter / 2});
      bars.append(el);
    }
  }
  // THE TIE STRAPS OF SINGLE CABLES (kit 0.22.0; route-context.js tieStraps): a
  // band at the tray's tie slot, where one of its cables is drawn, on the face
  // of the plate the cables are on. From the side it stands across the tray.
  for (const m of routes.tieStraps ?? []) {
    if (!m.cables.some(id => onPane.has(id))) continue;
    const [cx, cy] = project(pane, frame, tieCentre(m));
    bars.append(strapBarEl(tieAttrs(m), {x1: n3(cx), y1: n3(cy - TIE_HALF), x2: n3(cx), y2: n3(cy + TIE_HALF)}, {kind: 'anchor', width_mm: m.width_mm}));
  }
  if (bands.childElementCount) layer.prepend(bands);
  if (bars.childElementCount) layer.append(bars);
  // A corner short of its cable's bend radius, ringed where the kit puts it (as the front pane rings it).
  for (const f of landedBends(routes.bendFindings, rack, loose)) {
    if (!drawn.includes(f.cable) || !Array.isArray(f.at)) continue;
    const [cx, cy] = project(pane, frame, {x: f.at[0], y: f.at[1], z: f.at[2] ?? 0});
    const ring = svgEl('circle', {cx: n3(cx), cy: n3(cy), r: WIDTH / 2 + 6, fill: 'none', stroke: BEND_WARN, 'stroke-width': 1.6,
      'pointer-events': 'none', 'data-bend-finding': f.cable, 'data-pt-ui': '*'});
    const t = svgEl('title', {});
    t.textContent = f.text;
    ring.append(t);
    layer.append(ring);
  }
  if (!layer.childElementCount) return null;
  // over the bodies and the posts, under the part beside the near side and the selection ring
  const near = svg.querySelector(':scope > [data-side-near]');
  if (near) near.before(layer); else svg.append(layer);
  return {drawn, lo, hi};
}

/** Room for the cables: both side panes grow by the same amount in depth
 *  (mirrored, so they stay one width and one scale) and downward, to hold
 *  what drawSideCables drew past their boxes. `extents` are its answers, in
 *  pane order. Returns whether anything grew: the caller applies the zoom again. */
export function roomForSideCables(svgs, extents) {
  let front = 0, rear = 0, down = 0;
  svgs.forEach((svg, k) => {
    const e = extents[k];
    if (!e?.drawn?.length) return;
    const [x, y, w, h] = svg.getAttribute('viewBox').split(/\s+/).map(Number), right = svg.dataset.pane === 'right';
    // in a right pane the front is at the box's left edge; in a left pane at its right
    const overLeft = x - (e.lo[0] - MARGIN), overRight = e.hi[0] + MARGIN - (x + w);
    front = Math.max(front, right ? overLeft : overRight);
    rear = Math.max(rear, right ? overRight : overLeft);
    down = Math.max(down, e.hi[1] + MARGIN - (y + h));
  });
  if (!(front > 0 || rear > 0 || down > 0)) return false;
  [front, rear, down] = [front, rear, down].map(v => Math.max(0, Math.ceil(v)));
  for (const svg of svgs) {
    const [x, y, w, h] = svg.getAttribute('viewBox').split(/\s+/).map(Number), right = svg.dataset.pane === 'right';
    const box = [x - (right ? front : rear), y, w + front + rear, h + down];
    svg.setAttribute('viewBox', box.join(' '));
    svg.dataset.baseBox = box.join(' ');
  }
  return true;
}

/** THE PANE'S OWN WORDS ARE NEVER TOO SMALL TO READ. A side pane at Fit on a
 *  42U rack is drawn at well under a pixel a millimetre, and its U numbers,
 *  FRONT and REAR, and a near part's name are 11 mm tall at true scale. Each
 *  is given the larger of that and LABEL_MIN_PX on screen, from the pane as
 *  it is laid out; a U number is never taller than its unit holds. Call it
 *  after the zoom is applied, and again whenever the zoom or the window
 *  changes. Size only: nothing is redrawn. */
export function sizeSideLabels(svgs) {
  for (const svg of svgs) {
    if (!svg?.dataset?.side) continue;
    const vb = svg.viewBox?.baseVal, w = svg.getBoundingClientRect().width;
    const scale = vb?.width > 0 && w > 0 ? w / vb.width : 0;
    for (const t of svg.querySelectorAll('[data-side-label]')) {
      const kind = t.dataset.sideLabel, fs = labelSize(11, LABEL_MIN_PX[kind] ?? 9, scale, kind === 'num' ? RU * 0.7 : kind === 'part' ? PART_ROOM : 60);
      t.setAttribute('font-size', String(n3(fs)));
      // a U number stays centred in its unit
      if (kind === 'num') t.setAttribute('y', String(n3(Number(t.dataset.mid) + fs * 0.36)));
      // a part's name hangs from the line under the rack
      if (kind === 'part') t.setAttribute('y', String(n3(Number(t.dataset.top) + fs * 0.85)));
    }
  }
}
