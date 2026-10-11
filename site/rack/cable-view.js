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
import {bundleSummary, STRAP_DRAWN, bendViolations, drawnDiameter} from './bundle-view.js';
import {svgEl} from './dom.js';
import {STRAP_PAINT, STRAP_MIN_PX} from './stage.js';
import {LANE_GAP, laneXAt} from '../../vendor/rack/route.js';
import {paneMarks, landedBends} from './route-context.js';
import {spareText} from './spare.js';
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
// `spares` is spare.js sparesOf's Map: a cable in it names its cord and its
// spare in its title, as its row in the list does.
export function drawRackCables(svg, rack, reasons, uOf, routes = null, spares = null) {
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
  // WHERE A LANE RUNS ACROSS THE RACK at a U, as the kit measures it (route.js
  // laneXAt): through a zero-U duct standing there (#926), outboard of a
  // zero-U part that stands in the gutter and carries no lane (a PDU, #949),
  // else the middle of the gutter.
  const ductX = (lane, ru) => (chassisOf ? laneXAt(rack, lane, ru, chassisOf) : null);
  // A DETOUR POINT on this pane (kit 0.11.0, #949): rack mm to the pane's
  // user space, as wayPoint places a lane (x mirrored on the rear pane, y down).
  const detourAt = p => [pane === 'rear' ? OPENING / 2 - p.x : OPENING / 2 + p.x, rack.frame.heightRU * RU - p.y];
  // An OFFSET in rack mm turned to this pane's axes (x mirrored on the rear pane, y down).
  const turn = v => (v ? [rear ? -v.x : v.x, -v.y] : [0, 0]);
  // The kit's height for a ring or tray waypoint (route.js routePath: a
  // ring's entry and exit on its sill, a tray's stretch on its floor), in
  // this pane, at the middle of those points; null when the kit does not
  // lay the cable there (a ring on no tray stays where its drawing is).
  const restAt = (id, w) => {
    const p = routes?.paths?.get(id);
    const rested = (p?.rests ?? []).some(x => (x.kind === 'ring' || x.kind === 'tray') && x.item === w.item && x.via === w.via);
    // (not its approach points, which stand off the ring along its run, nor a
    // lead point, kit 0.17.0, which is level with the stop before the ring)
    const qs = rested ? p.points.filter(q => q.item === w.item && q.via === w.via && q.at !== 'approach' && q.at !== 'lead') : [];
    if (!qs.length) return null;
    return detourAt({x: qs.reduce((a, q) => a + q.x, 0) / qs.length, y: qs.reduce((a, q) => a + q.y, 0) / qs.length});
  };
  if (routes?.routes) {
    // THE RINGS AS THE KIT DECIDED THEM (Portrayal #930): a mark's sense is
    // along the rack's axes, x right as seen from the front and y up. This
    // pane's y runs down, and the rear pane is seen mirrored, so its x runs
    // the other way too (wayPoint, elevation.js zeroUPaneX). Unturned, a rear
    // ring or one that runs up the rack is entered from the wrong face and
    // drawn as a hook (route-context.js paneMarks).
    for (const link of plan.links) {
      const ws = routes.routes.get(link.id)?.waypoints;
      // A cable with no waypoints is still drawn round a body it would cross.
      if (!ws || (!ws.length && !routes.detours?.get(link.id)?.length)) continue;
      const marks = routes.marks?.get(link.id);
      const turned = marks?.length === ws.length ? paneMarks(marks, pane) : null;
      // One offset per cable and lane, so its own run up the lane is vertical.
      const mine = new Map();
      const pts = [], rings = [];
      // A BUNDLE'S MEMBER, where it rides the trunk, shares one lane slot with
      // the rest of its bundle and lies where the bundle's lay puts it
      // (bundle-view.js trunkLay, in rack mm: turned to this pane by `turn`):
      // across the lane on a lane, and at a ring or a tray above the height
      // the kit rests a cable at, the pack standing on the floor.
      const place = routes.places?.get(link.id);
      const lay = place ? routes.bundles?.get(place.bundle)?.lay ?? null : null;
      const laid = (w, k) => (lay && k >= place.stretch[0] && k <= place.stretch[1] ? turn(lay.offset(link.id, lay.indexOf(w))) : [0, 0]);
      const at = ws.map((w, k) => {
        const inBundle = place && k >= place.stretch[0] && k <= place.stretch[1];
        const key = w.lane ? `${w.lane}` : null;
        if (key && inBundle) mine.set(`in|${key}`, bundleSlot(place.bundle, key));
        else if (key && !mine.has(key)) { mine.set(key, used.get(key) || 0); used.set(key, mine.get(key) + 1); }
        const slot = key ? mine.get(inBundle ? `in|${key}` : key) : 0;
        const off = laid(w, k);
        const p = wayPoint(svg, w, pane, rack.frame, slot, ductX, key ? off[0] : 0);
        // RESTING, AS HEIGHT (kit 0.14.0; cable-lay note section 3, "What 2D
        // shows"): where the kit lays the cable at a ring or a tray - on a
        // ring's sill, along a tray's floor line - the pane draws it at that
        // height, not at the middle of the ring's drawing. A tray, which has
        // no element of its own on the pane, is placed by the kit's points.
        const rest = !w.lane ? restAt(link.id, w) : null;
        if (!rest) return p;
        return [p ? p[0] : rest[0], rest[1] + off[1]];
      });
      // BETWEEN TWO OF ITS LANE WAYPOINTS a member passes the lane's other
      // units, and where the members beside it change there (one between two
      // others has gone, and the rest close up) its place changes too: that
      // unit is a point of its line. Where its place does not change, none is
      // added, and it runs straight.
      const between = new Map();
      if (lay) for (let k = place.stretch[0]; k < place.stretch[1]; k++) {
        const [w0, w1] = [ws[k], ws[k + 1]];
        if (!w0.lane || w0.lane !== w1.lane || !at[k] || !at[k + 1]) continue;
        const [i0, i1] = [lay.indexOf(w0), lay.indexOf(w1)];
        if (i0 < 0 || i1 < 0 || i0 === i1) continue;
        const step = i1 > i0 ? 1 : -1, seen = [];
        for (let i = i0; i !== i1 + step; i += step) if (lay.T[i].kind === 'n') { const v = lay.offset(link.id, i); if (v) seen.push({i, x: turn(v)[0]}); }
        const list = [];
        for (let n = 1; n < seen.length - 1; n++) {
          if (Math.abs(seen[n].x - seen[n - 1].x) < 0.01 && Math.abs(seen[n].x - seen[n + 1].x) < 0.01) continue;
          const e = lay.T[seen[n].i];
          const q = wayPoint(svg, {lane: e.lane, ru: e.u}, pane, rack.frame, mine.get(`in|${w0.lane}`) ?? 0, ductX, seen[n].x);
          if (q) list.push(q);
        }
        if (list.length) between.set(k, list);
      }
      // THE DETOURS (kit 0.11.0, #949: route-context.js detourStops), each
      // after the waypoint its leg starts from, so the drawn cable goes round
      // a body as the length was measured. A detour is drawn on this pane when
      // the stops on both sides of its leg are here: the end on this pane, or
      // a waypoint this pane places. A ring's mark is null there.
      const detours = routes.detours?.get(link.id) ?? [];
      const here = k => (k < 0 ? link.from[2] === pane : k >= ws.length ? link.to[2] === pane : at[k] != null);
      const after = k => { for (const d of detours) if (d.after === k && here(k) && here(k + 1))
        for (const q of d.points) { pts.push(detourAt(q)); rings.push(null); } };
      // A LEAD POINT (kit 0.17.0, #973: route-context.js leadStops) is a point
      // of the path like any other: where the kit leads the cable square onto
      // a ring's run, the pane draws the point it turns at, before the ring's
      // own or after it, when it places that ring. A ring's mark is null there.
      const leads = routes.leads?.get(link.id) ?? [];
      const lead = (k, before) => { for (const l of leads) if (l.at === k && l.before === before)
        for (const q of l.points) { pts.push(detourAt(q)); rings.push(null); } };
      after(-1);
      at.forEach((p, k) => {
        // A waypoint this pane cannot place is dropped, and its mark with it.
        if (p) { lead(k, true); pts.push(p); rings.push(turned?.[k] ?? null); lead(k, false); }
        for (const q of between.get(k) ?? []) { pts.push(q); rings.push(null); }
        after(k);
      });
      // which stops this pane places, for a tight bend's ring (below)
      link.here2d = {...link.here2d, [pane]: here};
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
  // A trunk node's own point on this pane, before any member's offset: a lane
  // node on its lane (the bundle's slot), a ring at the height the kit rests a
  // cable there (a member's own rest), else where it is drawn. NULL WHERE
  // THIS PANE DOES NOT DRAW THE NODE: the kit's rest height is the rack's,
  // the same on either pane, so it never places a node by itself - a front
  // lacer's ring has no point on the rear pane, and no stretch or strap there.
  if (routes?.bundles) drawBundles2d(svg, rack, routes, pane, turn, (e, f, i) => {
    if (e.kind === 'n') return wayPoint(svg, {lane: e.lane, ru: e.u}, pane, rack.frame, bundleSlot(f.id, e.lane), ductX);
    const w = {item: e.item, via: e.via}, p = wayPoint(svg, w, pane, rack.frame, 0, ductX);
    let rest = null;
    for (const id of f.lay.at(i)?.members ?? []) if ((rest = restAt(id, w))) break;
    return p && rest ? [p[0], rest[1]] : p;
  });
  drawInFront(svg);
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
    const spare = spares?.get(c.id);
    if (title) title.textContent = `${endName(rack, c.a, uOf)} → ${endName(rack, c.b, uOf)}${c.media ? ` · ${c.media}` : ''}${spare ? ` · ${spareText(spare)}` : ''}`;
  }
  // A CORNER SHORT OF ITS CABLE'S BEND RADIUS (kit 0.17.0, Portrayal #973:
  // route.js bendFindings, through route-context.js) is ringed where it is:
  // the kit's own point (`at`, rack mm) on the pane that shows both stops it
  // lies between, with the kit's sentence as its title. Nothing is measured
  // here. A cable this pane draws without a route (no waypoints, nothing to
  // go round) is ringed on the pane of the end the corner is beside. A cable
  // with a loose end is not drawn along its path, and is not ringed
  // (route-context.js landedBends). The ring is the page's (data-pt-ui): a
  // drawing export leaves it out, and it does not count as the cable drawn.
  for (const f of landedBends(routes?.bendFindings, rack, e => reasons.get(endKey(e)) != null)) {
    const link = plan.links.find(l => l.id === f.cable), ws = routes.routes?.get(f.cable)?.waypoints ?? [];
    if (!link || !f.stops) continue;
    const here = link.here2d?.[pane] ?? (k => (k < 0 ? link.from[2] === pane : k >= ws.length ? link.to[2] === pane : false));
    if (!f.stops.every(here)) continue;
    const [cx, cy] = detourAt({x: f.at[0], y: f.at[1]});
    const ring = svgEl('circle', {cx, cy, r: WIDTH / 2 + 6, fill: 'none', stroke: BEND_WARN, 'stroke-width': 1.6,
      'pointer-events': 'none', 'data-bend-finding': f.cable, 'data-pt-ui': '*'});
    const t = svgEl('title', {});
    t.textContent = f.text;
    ring.append(t);
    svg.append(ring);
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


// WHAT STANDS IN FRONT OF THE CABLES. The cable layer is appended after every
// face, so a cable painted over everything, while in the 3D scene it runs
// behind a lacer's D-ring front legs and inside a vertical manager's duct,
// behind its cover. The panes agree with the scene: the parts the library
// marks as in front are painted again in a layer straight after the cables
// (under the tags, which are controls):
//   - a mounted item's ring ends (`<via>-end`, data-kind="ring"), opaque;
//   - a zero-U part's cover groups (data-group="cover"), see-through, so the
//     run up the lane still reads behind a cover that is plainly there.
// Nothing else: a device the library gives no such mark is left as it was.
// Each is a COPY, placed by the transform its original has on the pane, and a
// copy is paint only: it carries no id, no data-* of the drawing's (a second
// `guide-1-end` would answer wayEl and the route's pick targets) and no
// pointer-events of its own, and the layer takes no pointer, so a click or a
// hover goes through to the original underneath, as before. It is part of the
// drawing, so a sheet keeps it (exports.js draws its cables through here).
export const COVER_OPACITY = 0.34;
function bare(node) {
  for (const n of [node, ...node.querySelectorAll('*')]) {
    if (n.localName === 'title' || n.localName === 'metadata') { n.remove(); continue; }
    for (const a of [...n.attributes]) if (a.name === 'id' || a.name === 'pointer-events' || a.name === 'tabindex' || a.name.startsWith('data-')) n.removeAttribute(a.name);
  }
  return node;
}
export function drawInFront(svg) {
  svg.querySelector(':scope > [data-in-front]')?.remove();
  const layer = svg.querySelector(':scope > [data-cables]');
  if (!layer) return null;
  const over = svgEl('g', {'data-in-front': svg.dataset.pane, 'pointer-events': 'none'});
  const inv = svg.getScreenCTM().inverse();
  const put = (el, kind, owner, opacity) => {
    // its place on the pane: its parent's frame (its own transform comes along with the copy)
    const m = inv.multiply(el.parentNode.getScreenCTM());
    const n = v => Math.round(v * 1e6) / 1e6;
    const g = svgEl('g', {transform: `matrix(${n(m.a)} ${n(m.b)} ${n(m.c)} ${n(m.d)} ${n(m.e)} ${n(m.f)})`, 'data-front': kind, 'data-front-of': owner,
                          ...(opacity < 1 ? {opacity} : {})});
    g.append(bare(el.cloneNode(true)));
    over.append(g);
  };
  for (const g of svg.querySelectorAll(':scope > [data-item-id][data-panel="mounted"]'))
    for (const el of g.querySelectorAll('[data-kind="ring"][id$="-end"]')) put(el, 'ring', g.dataset.itemId, 1);
  for (const z of svg.querySelectorAll(':scope > [data-zerou-id]'))
    for (const el of z.querySelectorAll('[data-group="cover"]')) put(el, 'cover', z.dataset.zerouId, COVER_OPACITY);
  if (!over.childElementCount) return null;
  layer.after(over);
  return over;
}

// THE BUNDLES ON THIS PANE (portrayal-site#142; design section 6). A bundle is
// its members: they are drawn by drawRackCables, each where the bundle's lay
// puts it (bundle-view.js trunkLay), so along the trunk they are the pack.
// What is added here:
//   - THE ENVELOPE: the bundle's diameter as a band, stretch by stretch, each
//     as wide as the members that ride it (the kit's size rule over those
//     members) and about their pack, so it thins as cables peel off. It is
//     NOT shown by default: only while its bundle or one of its members is
//     hovered or selected (rack.css; paintHover2d, paintBundles, paintCables).
//     It is the page's, not the drawing's (data-pt-ui): a sheet leaves it out.
//   - THE STRAPS: a bar across the pack at each of the kit's positions
//     (bundles.js straps: a trunk segment and how far along it), as long as
//     the pack is thick there. Always drawn, and a sheet keeps them. A strap
//     is a group of four lines: a rim under a core at its true size (10 mm
//     along the run), and the same pair again as non-scaling strokes of
//     STRAP_MIN_PX, so at Fit on a tall rack it is never under that on
//     screen, along the run or across it. Its attributes are the paper's
//     paint (a black strap, a white rim); on the page rack.css paints it for
//     the stage (stage.js STRAP_PAINT), so it is seen on a dark stage too.
//   - a ring round a corner too tight for the bundle's bend radius.
// A stretch of the trunk on the other face is not drawn here, nor are its
// straps. They go in the cables' layer and take no click.
// `turn(v)` turns a rack offset to this pane's axes; `base(e, f, i)` is trunk
// node i's own point on this pane (element e of bundle f), or null.
const BAND = '#8b939c';
const BEND_WARN = '#d9822b';
function drawBundles2d(svg, rack, routes, pane, turn, base) {
  const layer = svg.querySelector(':scope > [data-cables]');
  if (!layer) return;
  const bands = svgEl('g', {'data-bundles': pane, 'pointer-events': 'none'});
  const bars = svgEl('g', {'data-bundle-straps': pane, 'pointer-events': 'none'});
  for (const f of routes.bundles.values()) {
    const L = f.check?.layout, lay = f.lay;
    if (!f.drawn || !L?.trunk?.length || !lay) continue;
    const pts = new Map();
    const pt = i => { if (!pts.has(i)) pts.set(i, base(lay.T[i], f, i)); return pts.get(i); };
    // a stretch's two ends on this pane: its nodes' points, moved to its pack's middle
    const ends = st => {
      const p = pt(st.from), q = pt(st.to);
      if (!p || !q) return null;
      const a = turn(st.c0), b = turn(st.c1);
      return [[p[0] + a[0], p[1] + a[1]], [q[0] + b[0], q[1] + b[1]]];
    };
    const D = drawnDiameter(f.diameter, WIDTH);
    const g = svgEl('g', {'data-bundle-id': f.id, 'data-members': f.members.join(' '), 'data-diameter': String(Math.round(D * 10) / 10)});
    const title = svgEl('title', {});
    title.textContent = `${f.name}: ${bundleSummary(f)}`;
    g.append(title);
    // One group for the outlines and one for the bands, each see-through as a
    // whole, so two stretches meeting at a node do not paint the joint twice.
    const env = svgEl('g', {'data-envelope': f.id, visibility: 'hidden', 'data-pt-ui': '*'});
    const rims = svgEl('g', {'data-envelope-rim': f.id, opacity: 0.4}), fills = svgEl('g', {opacity: 0.7});
    env.append(rims, fills);
    let here = 0;
    for (const st of lay.stretches) {
      const e = ends(st);
      if (!e) continue;
      here++;
      const d = `M${e[0][0]} ${e[0][1]} L${e[1][0]} ${e[1][1]}`;
      rims.append(svgEl('path', {d, fill: 'none', stroke: '#000', 'stroke-width': st.diameter + 1.2, 'stroke-linecap': 'round'}));
      fills.append(svgEl('path', {d, fill: 'none', stroke: BAND, 'stroke-width': st.diameter, 'stroke-linecap': 'round',
                                  'data-bundle-trunk': f.id, 'data-stretch': `${st.from}-${st.to}`, 'data-riders': String(st.members.length)}));
    }
    if (!here) continue;
    g.append(env);
    // A corner too tight for the bundle's bend radius (kit 0.8.0, Portrayal
    // #922): ringed where this pane places it.
    for (const v of bendViolations(f.check)) {
      const i = lay.indexOf(v.waypoint), p = i >= 0 ? pt(i) : null;
      if (!p) continue;
      const ring = svgEl('circle', {cx: p[0], cy: p[1], r: (lay.at(i)?.diameter ?? D) / 2 + 6, fill: 'none', stroke: BEND_WARN, 'stroke-width': 1.6,
                                    'data-bend-violation': f.id});
      const t = svgEl('title', {});
      t.textContent = `${f.name}: too tight a bend at ${v.at}${v.short_mm != null ? `, ${v.short_mm} mm short` : ''}`;
      ring.append(t);
      g.append(ring);
    }
    bands.append(g);
    for (const s of f.straps?.straps ?? []) {
      const hit = lay.stretchAt(s), e = hit && ends(hit.stretch);
      if (!e) continue;
      const len = Math.hypot(e[1][0] - e[0][0], e[1][1] - e[0][1]);
      if (!(len > 0)) continue;
      const dir = [(e[1][0] - e[0][0]) / len, (e[1][1] - e[0][1]) / len], n = [-dir[1], dir[0]];
      const c = [e[0][0] + (e[1][0] - e[0][0]) * hit.f, e[0][1] + (e[1][1] - e[0][1]) * hit.f];
      const half = hit.stretch.diameter / 2 + 2;
      const bar = svgEl('g', {'data-strap': f.id, 'data-members': f.members.join(' '), 'data-along': String(s.along_mm), 'data-pack': String(Math.round(hit.stretch.diameter * 100) / 100)});
      const at = {x1: c[0] - n[0] * half, y1: c[1] - n[1] * half, x2: c[0] + n[0] * half, y2: c[1] + n[1] * half};
      const paint = STRAP_PAINT.light, least = {'vector-effect': 'non-scaling-stroke', 'stroke-linecap': 'square', 'data-strap-least': ''};
      bar.append(svgEl('line', {...at, stroke: paint.rim, 'stroke-width': STRAP_DRAWN + 1.6, 'data-strap-part': 'rim'}),
                 svgEl('line', {...at, stroke: paint.rim, 'stroke-width': STRAP_MIN_PX + 2, 'data-strap-part': 'rim', ...least}),
                 svgEl('line', {...at, stroke: paint.core, 'stroke-width': STRAP_DRAWN, 'data-strap-part': 'core'}),
                 svgEl('line', {...at, stroke: paint.core, 'stroke-width': STRAP_MIN_PX, 'data-strap-part': 'core', ...least}));
      bars.append(bar);
    }
  }
  if (!bands.childElementCount) return;
  // Under every cable, so the members show inside the envelope; the straps over them.
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
// A SELECTED BUNDLE (`bundleId`) is lit the same way: its members keep their
// paint and every other cable dims, with its envelope and straps (paintBundles).
export function paintCables(svgs, rack, {selectedId = null, bundleId = null, on = {}} = {}) {
  const out = new Set(rack.cables.filter(c => !matches(c, on)).map(c => c.id));
  const members = new Set(bundleId == null ? [] : ((rack.bundles || []).find(b => b.id === bundleId)?.members ?? []).map(m => m.cable));
  const lit = id => id === selectedId || members.has(id);
  for (const svg of svgs) {
    svg.classList.toggle('cable-focus', selectedId != null || members.size > 0);
    for (const n of svg.querySelectorAll('[data-cable-id]')) {
      n.classList.toggle('on', lit(n.dataset.cableId));
      n.classList.toggle('ghost', !lit(n.dataset.cableId) && out.has(n.dataset.cableId));
    }
    // a selected cable shows the envelope of the bundle it rides
    for (const n of svg.querySelectorAll('[data-bundle-id]'))
      n.classList.toggle('on-member', selectedId != null && (n.dataset.members || '').split(' ').includes(selectedId));
    // A STRAP GOES WITH ITS BUNDLE: lit while its bundle, or a cable that rides
    // it, is the one selected, and dimmed with the rest otherwise (rack.css).
    for (const n of svg.querySelectorAll('[data-strap]'))
      n.classList.toggle('on', n.dataset.strap === bundleId || (selectedId != null && (n.dataset.members || '').split(' ').includes(selectedId)));
  }
}

// WHICH BUNDLE IS LIT: the selected one's envelope shows, outlined in brass, in
// both panes (.on on its [data-bundle-id] group). Classes only, as paintCables.
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
