// THE RACK'S CABLES ON ITS TWO PANES. cables.js owns the geometry (the hang,
// the strands, the side column, the unplugged lead); this is the Rack
// Builder's adapter over it: where an end is in a pane, how wide a pane is
// when there are cables, and what a tag says.
//
// AN END IS FOUND BY ITEM AND PANEL, never by device ref (Phase 2 ruling 3):
// two items can share a ref, and each item is in both panes. cable-rules.js
// cablePlan says which pane shows an end's panel; in that pane the item has
// exactly one [data-item-id][data-panel] group.
//
// WHERE AN END LANDS: on the cable points of the plug seated for it
// (cable-plugs.js) or of a DAC or AOC end seated in its cage, which carries
// its own; failing those, on the center of the port itself - an MPO adapter,
// a connector with no plug in the library. An end with a reason to be loose
// (cable-rules.js looseReason) does not land at all.

import {cablePoints} from '../../vendor/relief.js';
import {drawCables2d, plugAt, WIDTH} from './cables.js';
import {routed2d} from '../../vendor/rack/route-path.js';
import {combOffset, trunkMarks, trunkMembers, strapAt, drawableRuns, bundleSummary, STRAP_DRAWN, bendViolations,
        trunkIndexOf} from './bundle-view.js';
import {svgEl} from './dom.js';
import {LANE_GAP} from '../../vendor/rack/route.js';
import {paneMarks} from './route-context.js';
import {zeroUOnLane, zeroUX} from '../../vendor/rack/zero-u.js';
import {RU, RAIL_W, OPENING} from '../../vendor/rack/rails.js';
import {cablePlan, endKey, endName, tagText, portPathOf, matches} from '../../vendor/rack/cable-rules.js';

// mm beside the rack for cross-face tails and their tags (the showcase's
// own figure), and below it for a lead hanging from the lowest device.
export const ROOM = 260;
const DROP = 40;

// BOTH PANES WIDEN BY THE SAME COLUMN (ruling 5), so they keep one U scale
// and one zoom: the front pane to its right, the rear pane to its left - the
// two columns meet between the panes. Call it on both, before the zoom is
// applied (zoom.js reads the viewBox), and only when the rack has cables.
// `both`: routed cables tag their gutter on either side of the rack, so
// each pane also widens on its outer side.
export function widenForCables(svg, both = false) {
  const b = svg.getAttribute('viewBox').split(/\s+/).map(Number);
  svg.dataset.baseBox = b.join(' ');
  const rear = svg.dataset.pane === 'rear';
  svg.setAttribute('viewBox', [rear || both ? b[0] - ROOM : b[0], b[1], b[2] + ROOM * (both ? 2 : 1), b[3] + DROP].join(' '));
}

// ROOM BELOW, AS MUCH AS THE CABLES TOOK. A cable's sag grows with its length
// (cables.js sag2d), and a lead from the lowest device hangs below the rack
// with its tag, so no fixed DROP holds them all and the pane would clip what
// is past its box - for a loose lead, the only control the pane has for that
// cable. Call it after drawRackCables has run on BOTH panes: it measures what
// the cable and tag layers occupy and grows both viewBoxes downward by the
// same amount (the most either needs), so the panes keep one height, one
// origin and one U scale. Returns whether anything grew: the caller then
// applies the zoom again. data-base-box stays the box before any widening.
const MARGIN = 8;   // mm below the lowest stroke: half a stroke's width, and air
export function roomForCables(svgs) {
  const box = svg => svg.getAttribute('viewBox').split(/\s+/).map(Number);
  let over = 0;
  for (const svg of svgs) {
    const [, y, , h] = box(svg);
    for (const layer of svg.querySelectorAll(':scope > [data-cables], :scope > [data-cable-tags]')) {
      const b = layer.getBBox();
      if (b.width || b.height) over = Math.max(over, b.y + b.height + MARGIN - (y + h));
    }
  }
  if (!(over > 0)) return false;
  for (const svg of svgs) {
    const b = box(svg);
    svg.setAttribute('viewBox', [b[0], b[1], b[2], b[3] + Math.ceil(over)].join(' '));
  }
  return true;
}

// A point or box of an element, in the pane's user space.
export function inPane(svg, el) {
  const b = el.getBBox(), m = svg.getScreenCTM().inverse().multiply(el.getScreenCTM());
  const c = [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]]
    .map(([x, y]) => new DOMPoint(x, y).matrixTransform(m));
  const xs = c.map(p => p.x), ys = c.map(p => p.y);
  return {x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys)};
}

// A pathway's element in a pane: a ring (#via or #via-end), a duct
// (#guide--via) or a pass (#pass--via) inside the item's group.
export function wayEl(svg, w) {
  const g = svg.querySelector(`[data-item-id="${CSS.escape(w.item)}"][data-panel="mounted"]`);
  return g && (['', '-end'].map(s => g.querySelector(`[id="${CSS.escape(w.via + s)}"]`)).find(Boolean)
    || g.querySelector(`[id="guide--${CSS.escape(w.via)}"], [id="pass--${CSS.escape(w.via)}"]`));
}

// A waypoint's point in a pane, or null when it is not on this pane.
// Lanes: sides are the rack's as seen from the front, so the rear pane mirrors them.
// A lane through a zero-U duct (the kit's zero-u.js) runs up the duct's channel: `ductX(lane,
// ru)` is the duct's centre in rack x, or null where no duct stands.
// `shift` (mm, across the run) combs a bundle's members side by side on its lane (bundle-view.js combOffset).
function wayPoint(svg, w, view, frame, k, ductX = () => null, shift = 0) {
  if (w.lane) {
    const [side, face] = w.lane.split('-');
    if (face && face !== view) return null;
    const paneLeft = view === 'front' ? side === 'left' : side === 'right';
    const off = (k % 6) * 3;                       // cables sharing a lane, a little apart
    const xr = ductX(w.lane, w.ru);
    const x = xr != null ? (view === 'rear' ? OPENING / 2 - xr : OPENING / 2 + xr) + (paneLeft ? -off : off)
      : paneLeft ? -RAIL_W - LANE_GAP / 2 - off : OPENING + RAIL_W + LANE_GAP / 2 + off;
    return [x + shift, frame.heightRU * RU - (w.ru - 0.5) * RU];
  }
  const el = wayEl(svg, w);
  if (!el) return null;
  const b = inPane(svg, el);
  return [b.x + b.w / 2, b.y + b.h / 2];
}

const panelGroup = (svg, itemId) => svg.querySelector(`[data-item-id="${CSS.escape(itemId)}"][data-panel]`);

// A port's box in the pane's own user space, or null when the pane does not
// draw it. `svg` must be in the document and laid out (getScreenCTM).
export function portBox(svg, itemId, path) {
  const port = panelGroup(svg, itemId)?.querySelector(`[data-path="${CSS.escape(path)}"]`);
  if (!port) return null;
  const b = port.getBBox();
  const m = svg.getScreenCTM().inverse().multiply(port.getScreenCTM());
  const ps = [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]]
    .map(([x, y]) => new DOMPoint(x, y).matrixTransform(m));
  const xs = ps.map(p => p.x), ys = ps.map(p => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return {x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y};
}

// An end's connector points in the pane's user space, left to right: the
// cable points of what is seated at the port, else the port's own center.
function endPoints(svg, itemId, path) {
  const g = panelGroup(svg, itemId);
  if (!g || g.dataset.panel === 'missing') return null;
  const inv = svg.getScreenCTM().inverse();
  const pts = cablePoints(g).filter(p => p.at && plugAt(p.path, path));
  if (pts.length) return pts.map(p => {
    const q = new DOMPoint(+p.at[0], +p.at[1]).matrixTransform(inv.multiply(p.el.getScreenCTM()));
    return [q.x, q.y];
  }).sort((a, b) => a[0] - b[0]);
  const box = portBox(svg, itemId, path);
  return box ? [[box.x + box.w / 2, box.y + box.h / 2]] : null;
}

// EVERY CABLE WITH AN END ON THIS PANE, drawn onto it. `reasons` is Map(endKey
// -> why that end is loose, or null), from cable-plugs.js cableFacts. Call
// after widenForCables, with the pane in the document and laid out. Each
// cable group and each tag carries data-cable-id; returns drawCables2d's
// records.
// A TAG'S PILL NEVER OUTGROWS THE ROOM beside the pane: its text, whatever it
// is, is cut by code point to what ROOM holds (7 mm a character and 12 mm of
// padding, after the 8 mm the column starts out and 4 mm of margin each
// side), with an ellipsis. The tag's title keeps the full text.
const MAX_CHARS = Math.floor((ROOM - 8 - 8 - 12) / 7);
export function pillText(text) {
  const cs = Array.from(String(text));
  return cs.length > MAX_CHARS ? `${cs.slice(0, MAX_CHARS - 1).join('')}…` : String(text);
}

// `uOf` is endName's (how tall a device is), for the U in a cable's title.
// `routes` is S.routes: its routes (cable id -> waypoints), the ring marks
// for them (cable id -> one per waypoint, route.js ringMarks) and fill.
export function drawRackCables(svg, rack, reasons, uOf, routes = null) {
  const pane = svg.dataset.pane, rear = pane === 'rear';
  const base = svg.dataset.baseBox.split(' ').map(Number);
  const edgeX = rear ? base[0] - 8 : base[0] + base[2] + 8;
  const cables = rack.cables;
  const plan = cablePlan(rack);
  // Each link's waypoints in this pane, in order from its a end. Cables
  // sharing a lane here are offset a little apart.
  // One lane slot per bundle and lane, taken in turn with the cables' own.
  const used = new Map(), slots = new Map();
  const bundleSlot = (bid, lane) => {
    const k = `${bid}|${lane}`;
    if (!slots.has(k)) { slots.set(k, used.get(lane) || 0); used.set(lane, slots.get(k) + 1); }
    return slots.get(k);
  };
  const chassisOf = routes?.ctx?.chassisOf;
  const ductX = (lane, ru) => { const z = chassisOf && zeroUOnLane(rack, lane, ru, chassisOf); return z ? zeroUX(z, chassisOf) : null; };
  if (routes?.routes) {
    // THE RINGS AS THE KIT DECIDED THEM (Portrayal #930): a mark's sense is
    // along the rack's axes, x right as seen from the front and y up. This
    // pane's y runs down, and the rear pane is seen mirrored, so its x runs
    // the other way too (wayPoint, elevation.js zeroUPaneX). Unturned, a rear
    // ring or one that runs up the rack is entered from the wrong face and
    // drawn as a hook (route-context.js paneMarks).
    for (const link of plan.links) {
      const ws = routes.routes.get(link.id)?.waypoints;
      if (!ws?.length) continue;
      const marks = routes.marks?.get(link.id);
      const turned = marks?.length === ws.length ? paneMarks(marks, pane) : null;
      // One offset per cable and lane, so its own run up the lane is vertical.
      const mine = new Map();
      const pts = [], rings = [];
      // A BUNDLE'S MEMBER, where it rides the trunk, shares one lane slot with
      // the rest of its bundle and is combed inside the band (drawBundles2d).
      const place = routes.places?.get(link.id);
      ws.forEach((w, k) => {
        const inBundle = place && k >= place.stretch[0] && k <= place.stretch[1];
        const key = w.lane ? `${w.lane}` : null;
        if (key && inBundle) mine.set(`in|${key}`, bundleSlot(place.bundle, key));
        else if (key && !mine.has(key)) { mine.set(key, used.get(key) || 0); used.set(key, mine.get(key) + 1); }
        const slot = key ? mine.get(inBundle ? `in|${key}` : key) : 0;
        const p = wayPoint(svg, w, pane, rack.frame, slot, ductX, inBundle && key ? combOffset(place, WIDTH) : 0);
        // A waypoint this pane cannot place is dropped, and its mark with it.
        if (p) { pts.push(p); rings.push(turned?.[k] ?? null); }
      });
      if (pts.length) {
        link.via2d = {[pane]: pts};
        if (turned) link.rings2d = {[pane]: rings};
      }
    }
  }
  const endAt = (i, side) => cables[i][side === 'from' ? 'a' : 'b'];
  const loose = (i, side) => reasons.get(endKey(endAt(i, side))) != null;
  // Which ends on this pane are loose, by the [item, path] drawCables2d asks with.
  const looseHere = new Set();
  plan.links.forEach((link, i) => {
    for (const side of ['from', 'to'])
      if (link[side][2] === pane && loose(i, side)) looseHere.add(`${link[side][0]}|${link[side][1]}`);
  });
  // drawCables2d hands a tag the far end as the plan's own array.
  const farEnd = (link, far) => { const i = plan.links.indexOf(link); return endAt(i, far === link.from ? 'from' : 'to'); };
  // A tag's pill sits in the side column, outboard of the point it labels.
  const pill = (t, at, text) => {
    const label = pillText(text);
    const w = 7 * Array.from(label).length + 12;
    const x = at[0] < OPENING / 2 ? at[0] - 4 - w : at[0] + 4;
    t.append(svgEl('rect', {x, y: at[1] - 9, width: w, height: 18, rx: 4}));
    const tx = svgEl('text', {x: x + 6, y: at[1] + 4}); tx.textContent = label; t.append(tx);
    return t;
  };
  const recs = drawCables2d(svg, plan, pane, {
    edgeX, outboard: rear ? -1 : 1,
    ends: (s, itemId, path) => (looseHere.has(`${itemId}|${path}`) ? null : endPoints(s, itemId, path)),
    farLoose: loose,
    // The far end is in the other pane: the tag names it.
    // Its title carries the full text, which the pill may have had to cut.
    tag: (at, far, link) => {
      const t = svgEl('g', {class: 'cable-tag', tabindex: '0', role: 'button'});
      const end = farEnd(link, far), it = rack.items.find(i => i.id === end.item);
      const full = svgEl('title', {});
      full.textContent = `→ ${it ? it.label : 'removed'} ${end.path}`;
      t.append(full);
      return pill(t, at, tagText(rack, end));
    },
    // The far end does not land anywhere: the tag says so, and its title says why.
    looseTag: (at, far, link) => {
      const t = svgEl('g', {class: 'cable-tag not-connected', tabindex: '0', role: 'button'});
      const why = svgEl('title', {});
      why.textContent = `✕ not connected — ${reasons.get(endKey(farEnd(link, far))) || 'not connected'}`;
      t.append(why);
      return pill(t, at, '✕ not connected');
    },
  });
  if (routes?.bundles) drawBundles2d(svg, rack, routes, pane, (w, bid) =>
    wayPoint(svg, w, pane, rack.frame, w.lane ? bundleSlot(bid, w.lane) : 0, ductX));
  for (const rec of recs) {
    const c = cables[rec.i];
    for (const n of [rec.g, rec.tag]) if (n) n.setAttribute('data-cable-id', c.id);
    // A STROKE IS CLICK-THROUGH: nothing handles a click on it, so it must not
    // take the click meant for the device or the empty U beneath. Only its
    // tag is a control. (The showcase's cable is a focus stop; here it is not.)
    if (rec.g) {
      rec.g.setAttribute('pointer-events', 'none');
      rec.g.removeAttribute('tabindex');
      rec.g.removeAttribute('data-pt-ui');
    }
    const title = rec.g?.querySelector('title');
    if (title) title.textContent = `${endName(rack, c.a, uOf)} → ${endName(rack, c.b, uOf)}${c.media ? ` · ${c.media}` : ''}`;
  }
  // A pathway filled past its limit, and a manager with more cables through it
  // than it states, are outlined where this pane draws them.
  const overs = [...(routes?.fill || []).filter(f => f.over),
    ...(routes?.over || []).map(o => ({item: o.item, via: null}))];
  for (const f of overs) {
    // A zero-U duct over its fill or count: the whole part (it is not an item).
    const z = svg.querySelector(`[data-zerou-id="${CSS.escape(f.item)}"]`);
    const e = z ?? (f.via == null ? panelGroup(svg, f.item) : wayEl(svg, f));   // a manager over its count: the whole part
    if (!e) continue;
    const b = inPane(svg, e);
    svg.append(svgEl('rect', {x: b.x, y: b.y, width: b.w, height: b.h, fill: 'none', stroke: 'var(--pt-warn)',
      'stroke-width': 1.2, 'pointer-events': 'none', 'data-fill-over': `${f.item}|${f.via ?? ''}`, 'data-pt-ui': '*'}));
  }
  return recs;
}


// THE BUNDLES ON THIS PANE (portrayal-site#142; design section 6). Each drawn
// bundle's trunk is one band as wide as the bundle (the kit's size check),
// under its members, which are combed inside it where they ride and leave it
// at their join and leave points; its straps are bars across it at the kit's
// positions (bundles.js straps: a trunk segment and how far along it). The
// band passes a ring the way its members do (bundle-view.js trunkMarks), and
// those marks are in the rack's axes, so they are turned to this pane's like
// any cable's (paneMarks: front {y: -1}, rear {x: -1, y: -1}). A stretch of the
// trunk on the other face is not drawn here, nor are its straps. The bands go
// in the cables' layer, so a sheet keeps them; they take no click.
// `place(w, bundleId)` is a trunk waypoint's point on this pane, or null.
const BAND = '#8b939c';
const STRAP = '#24282d';
const BEND_WARN = '#d9822b';
function drawBundles2d(svg, rack, routes, pane, place) {
  const layer = svg.querySelector(':scope > [data-cables]');
  if (!layer) return;
  const bands = svgEl('g', {'data-bundles': pane, 'pointer-events': 'none'});
  const bars = svgEl('g', {'data-bundle-straps': pane, 'pointer-events': 'none'});
  for (const f of routes.bundles.values()) {
    const L = f.check?.layout;
    if (!f.drawn || !L?.trunk?.length) continue;
    const pts = L.trunk.map(w => place(w, f.id));
    const runs = drawableRuns(pts);
    if (!runs.length) continue;
    const D = Math.max(f.diameter ?? 0, WIDTH * 2);
    const marks = paneMarks(trunkMarks(L.trunk, trunkMembers(f, routes.routes, routes.marks, routes.places)), pane);
    const g = svgEl('g', {'data-bundle-id': f.id, 'data-diameter': String(Math.round(D * 10) / 10)});
    const title = svgEl('title', {});
    title.textContent = `${f.name}: ${bundleSummary(f)}`;
    g.append(title);
    for (const run of runs) {
      const rings = marks.slice(run.from, run.from + run.points.length);
      const d = routed2d(run.points, 4, rings.some(Boolean) ? rings : null);
      g.append(svgEl('path', {d, fill: 'none', stroke: '#000', 'stroke-opacity': 0.4, 'stroke-width': D + 1.2,
                              'stroke-linecap': 'round', 'stroke-linejoin': 'round'}),
               svgEl('path', {d, fill: 'none', stroke: BAND, 'stroke-opacity': 0.7, 'stroke-width': D,
                              'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'data-bundle-trunk': f.id}));
    }
    // A corner too tight for the bundle's bend radius (kit 0.8.0, Portrayal
    // #922): ringed where this pane places it. Nothing before 0.8.0.
    for (const v of bendViolations(f.check)) {
      const p = pts[trunkIndexOf(L.trunk, v.waypoint)];
      if (!p) continue;
      const ring = svgEl('circle', {cx: p[0], cy: p[1], r: D / 2 + 6, fill: 'none', stroke: BEND_WARN, 'stroke-width': 1.6,
                                    'data-bend-violation': f.id});
      const t = svgEl('title', {});
      t.textContent = `${f.name}: too tight a bend at ${v.at}${v.short_mm != null ? `, ${v.short_mm} mm short` : ''}`;
      ring.append(t);
      g.append(ring);
    }
    bands.append(g);
    for (const s of f.straps?.straps ?? []) {
      const at = strapAt(pts, s);
      if (!at) continue;
      const half = D / 2 + 2, n = [-at.dir[1], at.dir[0]];
      bars.append(svgEl('line', {x1: at.at[0] - n[0] * half, y1: at.at[1] - n[1] * half,
        x2: at.at[0] + n[0] * half, y2: at.at[1] + n[1] * half, stroke: STRAP, 'stroke-width': STRAP_DRAWN,
        'data-strap': f.id, 'data-along': String(s.along_mm)}));
    }
  }
  if (!bands.childElementCount) return;
  // Under every cable, so the members show inside the band; the straps over them.
  layer.prepend(bands);
  layer.append(bars);
}

// WHICH PORT A CLICK IS ON, as its data-path, or null. `group` is the item's
// panel group and `target` the element clicked inside it. The outermost
// data-class="port" above the click wins (the rule zones.js's readSvg uses):
// a duplex adapter, not one of its bores. A seated optic or plug is NOT
// inside its cage - swap.js seats it beside the cage, at `<port>-occupant` -
// so a click on either is mapped back to the port by its path
// (cable-rules.js portPathOf), and counts only if that port is drawn.
export function portAt(target, group) {
  let hit = null;
  for (let n = target; n && n !== group; n = n.parentNode) {
    const p = n.getAttribute?.('data-path');
    if (p && (n.getAttribute('data-class') === 'port' || p.includes('-occupant'))) hit = p;
  }
  if (hit == null) return null;
  const path = portPathOf(hit);
  return group.querySelector(`[data-path="${CSS.escape(path)}"][data-class="port"]`) ? path : null;
}

// A brass outline round a picked port, in the pane's own layer: screen UI
// (data-pt-ui), so it never reaches a file.
export function markPort(svg, itemId, path) {
  const b = svg ? portBox(svg, itemId, path) : null;
  if (!b) return;
  svg.append(svgEl('rect', {x: b.x - 1.5, y: b.y - 1.5, width: b.w + 3, height: b.h + 3, rx: 2,
    class: 'rk-end-pick', 'data-pt-ui': '*'}));
}

// WHICH CABLES ARE LIT. The selected cable keeps its paint and every other
// one dims (.cable-focus on the pane, .on on the cable and its tag) - in
// both panes at once, so a cross-face run lights at both ends. A cable the
// list's filter leaves out fades to a ghost (.ghost), as in stage 5 - except
// the selected cable, which is never ghosted. Classes only: nothing is redrawn.
export function paintCables(svgs, rack, {selectedId = null, on = {}} = {}) {
  const out = new Set(rack.cables.filter(c => !matches(c, on)).map(c => c.id));
  for (const svg of svgs) {
    svg.classList.toggle('cable-focus', selectedId != null);
    for (const n of svg.querySelectorAll('[data-cable-id]')) {
      n.classList.toggle('on', n.dataset.cableId === selectedId);
      n.classList.toggle('ghost', n.dataset.cableId !== selectedId && out.has(n.dataset.cableId));
    }
  }
}

// WHICH BUNDLE IS LIT: the selected one's band is outlined in brass, in both
// panes (.on on its [data-bundle-id] group). Classes only, as paintCables.
export function paintBundles(svgs, selectedId = null) {
  for (const svg of svgs)
    for (const n of svg.querySelectorAll('[data-bundle-id]')) n.classList.toggle('on', n.dataset.bundleId === selectedId);
}

// WHERE A ROUTE'S NEXT WAYPOINT CAN BE CLICKED. Each target is {item, via, box}
// (a ring, duct, brush or pass) or {lane, ru, x, y, w, h}, in the pane's user
// space. They are transparent rects in a layer above the cables.
export function drawPickTargets(svg, targets) {
  svg.querySelector('[data-pick]')?.remove();
  const layer = svgEl('g', {'data-pick': '', 'data-pt-ui': '*'});
  for (const t of targets) {
    const b = t.box || t;
    layer.append(svgEl('rect', {x: b.x, y: b.y, width: b.w, height: b.h, fill: 'transparent', style: 'cursor: crosshair',
      ...(t.lane ? {'data-pick-lane': t.lane, 'data-pick-ru': t.ru} : {'data-pick-item': t.item, 'data-pick-via': t.via})}));
  }
  svg.append(layer);
}
