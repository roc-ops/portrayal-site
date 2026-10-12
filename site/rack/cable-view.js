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
import {drawCables2d, plugAt, WIDTH, TAG_H} from './cables.js';
import {bundleSummary, strapDrawn, TIE_HALF, tieCentre, bendViolations, drawnDiameter, fitText} from './bundle-view.js';
import {svgEl} from './dom.js';
import {STRAP_PAINT, STRAP_MIN_PX} from './stage.js';
import {partSel, pathOfEl} from './part-path.js';
import {LANE_GAP, laneXAt} from '../../vendor/rack/route.js';
import {throughRings} from '../../vendor/rack/route-path.js';
import {paneMarks, landedBends} from './route-context.js';
import {spareText} from './spare.js';
import {noteStrap, packSpan, lineSpan} from './strap-size.js';
import {RU, RAIL_W, OPENING} from '../../vendor/rack/rails.js';
import {positionOf} from '../../vendor/rack/model.js';
import {cablePlan, endKey, endName, portPathOf, matches} from '../../vendor/rack/cable-rules.js';

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
  const port = panelGroup(svg, itemId)?.querySelector(partSel(path));
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

// A tag's text is fitted to the pill by shortening the middle of a part, never its end (bundle-view.js fitText).
const fitTag = (parts, cut) => fitText(parts, cut, MAX_CHARS);

// `uOf` is endName's (how tall a device is), for the U in a cable's title.
// `routes` is S.routes: its routes (cable id -> waypoints), the ring marks
// for them (cable id -> one per waypoint, route.js ringMarks) and fill.
// `spares` is spare.js sparesOf's Map: a cable in it names its cord and its
// spare in its title, as its row in the list does.
// A CROSS-FACE TAG IS SHOWN WHEN IT IS ASKED FOR (#194). `tags` says which
// of them this drawing carries:
//   'hover'   (the page) every cable's tag, each at its own cable's height,
//             and one tag per bundle where its cables leave the face. rack.css
//             hides them all; a hovered or pinned cable shows its own, a
//             hovered or pinned bundle the bundle's (hover.js, paintCables);
//   'bundles' (a sheet, which cannot be hovered) one tag per bundle and one
//             per cross-face cable no bundle's tag stands for, stacked TAG_H
//             apart in their gutter;
//   'all'     a tag per cable and none per bundle, stacked;
//   'none'    no cross-face tag.
// A not-connected tag is not a cross-face tag: it is always drawn and shown.
export function drawRackCables(svg, rack, reasons, uOf, routes = null, spares = null, {tags = 'hover'} = {}) {
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
  // Whether the kit lays the cable along this waypoint as a tray (its rest of
  // kind 'tray'), not through it as a ring.
  const onTray = (id, w) => (routes?.paths?.get(id)?.rests ?? []).some(x => x.kind === 'tray' && x.item === w.item && x.via === w.via);
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
        // ONLY A TRAY is placed by the kit's points alone. A ring has an
        // element on the pane that draws its manager; where this pane does not
        // draw it (the manager is on the other face), the ring is not placed,
        // and the stretch to it is the other pane's (#194), as a bundle's is.
        if (!p && !onTray(link.id, w)) return null;
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
      // where this pane's points stop before the first waypoint it cannot place, and start again after the last
      let headEnd = null, tailFrom = 0;
      at.forEach((p, k) => {
        // A waypoint this pane cannot place is dropped, and its mark with it.
        if (p) { lead(k, true); pts.push(p); rings.push(turned?.[k] ?? null); lead(k, false); }
        else { headEnd ??= pts.length; tailFrom = pts.length; }
        for (const q of between.get(k) ?? []) { pts.push(q); rings.push(null); }
        after(k);
      });
      // which stops this pane places, for a tight bend's ring (below)
      link.here2d = {...link.here2d, [pane]: here};
      if (pts.length) {
        link.via2d = {[pane]: pts};
        if (turned) link.rings2d = {[pane]: rings};
      }
      // BOTH ENDS HERE, AND A WAYPOINT BETWEEN THEM THAT IS NOT (#194): the
      // cable leaves this face and comes back. It is drawn as it runs, a stub
      // from each end to where it leaves (cables.js `away2d`), never as one
      // line across the face from the last point before to the first after.
      if (headEnd != null && link.from[2] === pane && link.to[2] === pane)
        link.away2d = {[pane]: {head: pts.slice(0, headEnd), tail: pts.slice(tailFrom),
                                headRings: turned ? rings.slice(0, headEnd) : null, tailRings: turned ? rings.slice(tailFrom) : null}};
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
  // ITS REACH (#194): a tag shows only while its cable is under the pointer,
  // so the gap from the cable's end to the pill would end the hover before
  // the pointer got to the tag. An unpainted strip across that gap is the
  // tag's too: from the cable's end (`lead` mm back from the tag's point) to
  // the pill, and NO THICKER THAN THE CABLE'S OWN STROKE, so it lies over
  // nothing the cable's end does not already lie over - never a port or a
  // part beside the rack. A sheet leaves it out (exports.js paperTags).
  const REACH = (WIDTH + 1.2) / 2;
  const pill = (t, at, text, lead = 0) => {
    const label = pillText(text);
    const w = 7 * Array.from(label).length + 12;
    const out = at[0] < OPENING / 2 ? -1 : 1;
    const x = out < 0 ? at[0] - 4 - w : at[0] + 4;
    t.append(svgEl('rect', {x, y: at[1] - 9, width: w, height: 18, rx: 4}));
    const tx = svgEl('text', {x: x + 6, y: at[1] + 4}); tx.textContent = label; t.append(tx);
    t.append(svgEl('path', {d: `M${at[0] - out * (lead + REACH)} ${at[1] - REACH}H${at[0] + out * 4}V${at[1] + REACH}H${at[0] - out * (lead + REACH)}Z`, fill: 'transparent', 'data-tag-reach': ''}));
    return t;
  };
  // a tag in a gutter points from 6 mm outboard of its cable's last point there (cables.js); one in the side column from the cable's end itself
  const leadOf = at => (at[0] === edgeX ? 0 : 6);
  // WHAT A FAR END IS CALLED ON A TAG: its device and its port. Two devices of
  // one label are told apart by their U ("AS7816-64X U40"); a text too long
  // loses the middle of the device's name, never the port.
  const shared = new Set(rack.items.map(i => i.label).filter((l, k, all) => all.indexOf(l) !== k));
  const uOfShared = it => (it && shared.has(it.label) ? ` U${positionOf(rack.frame, it.ru, uOf?.(it) ?? 1)}` : '');
  const deviceOf = it => (it ? `${it.label}${uOfShared(it)}` : 'removed');
  const otherFace = rear ? 'front' : 'rear';
  // every cross-face tag drawn: {id, el, at, kind: 'far' | 'away', far: the far end's item, gutter}
  const marks = [];
  const recs = drawCables2d(svg, plan, pane, {
    edgeX, outboard: rear ? -1 : 1, stackGutter: false,
    ends: (s, itemId, path) => (looseHere.has(`${itemId}|${path}`) ? null : endPoints(s, itemId, path)),
    farLoose: loose,
    // The far end is in the other pane: the tag names it.
    // Its title carries the full text, which the pill may have had to shorten.
    tag: (at, far, link) => {
      const t = svgEl('g', {class: 'cable-tag', tabindex: '0', role: 'button'});
      const end = farEnd(link, far), it = rack.items.find(i => i.id === end.item);
      const full = svgEl('title', {});
      full.textContent = `→ ${deviceOf(it)} ${end.path}`;
      t.append(full);
      marks.push({id: link.id, el: t, at, kind: 'far', far: it ?? null});
      return pill(t, at, fitTag(['→ ', it ? it.label : 'removed', uOfShared(it), ' ', end.path], [1, 4]), leadOf(at));
    },
    // Both ends are on this pane and the cable goes by the other face between them: each stub's tag says so.
    awayTag: (at, link) => {
      const t = svgEl('g', {class: 'cable-tag', tabindex: '0', role: 'button'});
      const c = cables[plan.links.indexOf(link)], full = svgEl('title', {});
      full.textContent = `↔ by the ${otherFace} face: ${endName(rack, c.a, uOf)} → ${endName(rack, c.b, uOf)}`;
      t.append(full);
      marks.push({id: link.id, el: t, at, kind: 'away', far: null});
      return pill(t, at, `↔ by the ${otherFace} face`, leadOf(at));
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
  // WHERE EACH CABLE'S LINE IS ON THIS PANE, as the points it is drawn through
  // (its waypoints here, before its corners are eased), for a strap to be put
  // across its members by (strap-size.js): nothing is read back off the drawing.
  // (through a ring it goes as it is drawn there, in at one face and out at the other: route-path.js throughRings, as routed2d runs it)
  const lines = new Map(plan.links.filter(link => link.via2d?.[pane]?.length > 1).map(link => {
    const via = link.via2d[pane], rings = link.rings2d?.[pane];
    return [link.id, rings ? throughRings(via, rings, {lead: 4}).points : via];
  }));
  if (routes?.bundles) drawBundles2d(svg, rack, routes, pane, turn, lines, (e, f, i) => {
    if (e.kind === 'n') return wayPoint(svg, {lane: e.lane, ru: e.u}, pane, rack.frame, bundleSlot(f.id, e.lane), ductX);
    const w = {item: e.item, via: e.via}, p = wayPoint(svg, w, pane, rack.frame, 0, ductX);
    let rest = null;
    for (const id of f.lay.at(i)?.members ?? []) if ((rest = restAt(id, w))) break;
    return p && rest ? [p[0], rest[1]] : p;
  });
  drawTieStraps2d(svg, rack, routes, pane, detourAt, new Set(recs.filter(rec => rec.g).map(rec => cables[rec.i].id)));
  drawInFront(svg);
  // ONE TAG FOR A BUNDLE WHERE ITS CABLES LEAVE THIS FACE (#194): at the middle
  // of its members' own tag points in a gutter. A bundle that leaves the face
  // in more than one place (its members' points more than LEAVE mm apart, in
  // another gutter, or some to a far end and some by the other face and back)
  // has a tag for each group, each with its own count. A tag names the bundle
  // (data-bundle-tag) and the cables it stands for (data-members).
  const LEAVE = 60;
  const tagLayer = svg.querySelector(':scope > [data-cable-tags]');
  const markOf = new Map(marks.map(m => [m.el, m]));
  for (const rec of recs) for (const t of rec.tags ?? []) { const m = markOf.get(t.el); if (m) m.gutter = t.gutter; }
  const groups = [];
  if (tags === 'hover' || tags === 'bundles') for (const f of routes?.bundles?.values() ?? []) {
    const rides = new Set(f.members);
    const mine = marks.filter(m => m.gutter && rides.has(m.id)).sort((a, b) => a.gutter - b.gutter || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) || a.at[1] - b.at[1] || a.at[0] - b.at[0]);
    const sets = [];
    for (const m of mine) {
      const g = sets.find(x => x[0].gutter === m.gutter && x[0].kind === m.kind && Math.hypot(x[0].at[0] - m.at[0], x[0].at[1] - m.at[1]) <= LEAVE);
      if (g) g.push(m); else sets.push([m]);
    }
    for (const set of sets) {
      const at = [0, 1].map(k => set.reduce((a, m) => a + m.at[k], 0) / set.length), n = new Set(set.map(m => m.id)).size;
      // where they go: the one device every one of them ends on, else the other face
      const fars = new Set(set.map(m => m.far?.id ?? null)), far = fars.size === 1 ? set[0].far : null;
      // [arrow, device or face, its U, count, name]: the device's name is shortened before the bundle's
      const to = set[0].kind === 'away' ? ['↔ ', `by the ${otherFace} face`, ''] : ['→ ', far ? far.label : `${otherFace} face`, uOfShared(far)];
      const t = svgEl('g', {class: 'cable-tag bundle-tag', tabindex: '0', role: 'button', 'data-bundle-tag': f.id, 'data-members': [...new Set(set.map(m => m.id))].join(' ')});
      const full = svgEl('title', {});
      full.textContent = `${f.name}: ${n} cable${n === 1 ? '' : 's'} ${to.join('')}`;
      t.append(full);
      for (const m of set) m.stood = true;
      groups.push({el: t, at, gutter: set[0].gutter, parts: [...to, ` ×${n} · `, f.name], id: f.id});
    }
  }
  // THE DEVICE'S NAME IS KEPT WHOLE BEFORE THE BUNDLE'S: a tag that does not
  // fit with the bundle's name says the bundle's id in its place (the cable
  // list and a sheet's notes give the id beside the name; the title keeps the
  // name), and only a text still too long loses the middle of the device's
  // name. TWO GROUPS NEVER READ THE SAME: two of this pane's tags left with
  // one text each say their bundle's id too.
  const fits = parts => Array.from(parts.join('')).length <= MAX_CHARS;
  const byId = g => fitTag([...g.parts.slice(0, 4), g.id], [1]);
  const said = groups.map(g => (fits(g.parts) ? g.parts.join('') : byId(g)));
  groups.forEach((g, k) => {
    const twice = said.some((x, j) => j !== k && x === said[k] && groups[j].parts.join('') !== g.parts.join(''));
    tagLayer.append(pill(g.el, g.at, twice ? byId(g) : said[k], 6));
  });
  if (tags !== 'hover') {
    // WHAT A FILE CARRIES: the tags it does not are taken off; the rest of each
    // gutter's stand at their own heights, and one that would lie on the one
    // above it is moved TAG_H below it, with a leader back to its own point.
    const kept = [...groups];
    for (const rec of recs) for (const t of rec.tags ?? []) {
      const m = markOf.get(t.el);
      if (!m) continue;                                          // a not-connected tag
      if (tags === 'none' || (tags === 'bundles' && m.stood)) { t.el.remove(); if (rec.tag === t.el) rec.tag = null; }
      else kept.push(m);
    }
    for (const rec of recs) if (rec.tags) rec.tag ??= rec.tags.find(t => t.el.isConnected)?.el ?? null;
    // (a tag in the side column stands on the side of the rack its pill opens to, with that gutter's)
    const low = new Map();
    for (const k of kept.sort((a, b) => a.at[1] - b.at[1])) {
      const side = k.at[0] < OPENING / 2 ? -1 : 1, lead = leadOf(k.at);
      const y = Math.max(k.at[1], (low.get(side) ?? -Infinity) + TAG_H), dy = Math.round((y - k.at[1]) * 100) / 100;
      low.set(side, y);
      if (!dy) continue;
      k.el.setAttribute('transform', `translate(0 ${dy})`);
      k.el.append(svgEl('path', {d: `M${k.at[0] - side * lead} ${k.at[1] - dy}L${k.at[0] + side * 4} ${k.at[1]}`, fill: 'none', stroke: '#5B636B', 'stroke-width': 0.7, 'data-tag-leader': ''}));
    }
  }
  for (const rec of recs) {
    const c = cables[rec.i];
    for (const n of [rec.g, rec.tag, ...(rec.tags ?? []).map(t => t.el)]) if (n) n.setAttribute('data-cable-id', c.id);
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
// `lines` is each cable's line on this pane as points (cable id -> [[x, y], ...]).
// `turn(v)` turns a rack offset to this pane's axes; `base(e, f, i)` is trunk
// node i's own point on this pane (element e of bundle f), or null.
const BAND = '#8b939c';
const BEND_WARN = '#d9822b';
function drawBundles2d(svg, rack, routes, pane, turn, lines, base) {
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
      const at = {x1: c[0] - n[0] * half, y1: c[1] - n[1] * half, x2: c[0] + n[0] * half, y2: c[1] + n[1] * half};
      const bar = strapBarEl({'data-strap': f.id, 'data-members': f.members.join(' '), 'data-along': String(s.along_mm), 'data-pack': String(Math.round(hit.stretch.diameter * 100) / 100)}, at, s);
      // WHERE THE PACK IS, square across the run, for the page to size the strap by (strap-size.js): its
      // riders' own lines where they cross the strap; where none does (a rider this pane does not draw
      // through here), each rider's place in the lay. Kept beside the bar, not on it: a sheet is as it was.
      const riders = hit.stretch.members, reach = hit.stretch.diameter / 2 + 12;
      const p0 = pt(hit.stretch.from), p1 = pt(hit.stretch.to);
      const laid = riders.map(id => {
        const a = turn(lay.offset(id, hit.stretch.from)), b = turn(lay.offset(id, hit.stretch.to));
        return [p0[0] + a[0] + (p1[0] + b[0] - p0[0] - a[0]) * hit.f, p0[1] + a[1] + (p1[1] + b[1] - p0[1] - a[1]) * hit.f];
      });
      noteStrap(bar, {c, n, ...(lineSpan(riders.map(id => lines.get(id)).filter(Boolean), c, n, WIDTH, reach) ?? packSpan(laid, c, n, WIDTH, hit.stretch.diameter))});
      bars.append(bar);
    }
  }
  if (!bands.childElementCount) return;
  // Under every cable, so the members show inside the envelope; the straps over them.
  layer.prepend(bands);
  layer.append(bars);
}

// A STRAP'S BAR, on any pane: a rim and a core, each drawn twice (at the
// strap's own width, and at a least screen width), as rack.css, hover.js and
// the exports read them. `s` is the kit's strap: its `kind` (spacing,
// breakout or anchor; kit 0.22.0) and `width_mm` go on the bar, and its width
// is drawn (bundle-view.js strapDrawn). Every kind has the one look.
export function strapBarEl(attrs, at, s = {}) {
  const drawn = strapDrawn(s);
  const bar = svgEl('g', {...attrs, 'data-strap-kind': s.kind ?? 'spacing', ...(s.width_mm ? {'data-strap-width': String(s.width_mm)} : {})});
  const paint = STRAP_PAINT.light, least = {'vector-effect': 'non-scaling-stroke', 'stroke-linecap': 'square', 'data-strap-least': ''};
  bar.append(svgEl('line', {...at, stroke: paint.rim, 'stroke-width': drawn + 1.6, 'data-strap-part': 'rim'}),
             svgEl('line', {...at, stroke: paint.rim, 'stroke-width': STRAP_MIN_PX + 2, 'data-strap-part': 'rim', ...least}),
             svgEl('line', {...at, stroke: paint.core, 'stroke-width': drawn, 'data-strap-part': 'core'}),
             svgEl('line', {...at, stroke: paint.core, 'stroke-width': STRAP_MIN_PX, 'data-strap-part': 'core', ...least}));
  return bar;
}
// What a tie strap carries, on any pane: `data-strap` names its slot (no
// bundle has that id), `data-members` the cables tied there, so it is lit and
// dimmed with them as a bundle's strap is with its members.
export const tieAttrs = m => ({'data-strap': `tie:${m.item}|${m.via}|${m.tie}`, 'data-tie': `${m.item}|${m.via}|${m.tie}`,
  'data-members': m.cables.join(' '), 'data-tie-face': m.held ? 'held' : 'resting'});

// THE TIE STRAPS OF SINGLE CABLES on a front or rear pane (route-context.js
// tieStraps): a band at the tray's tie slot, on the face of the plate the
// cables are on, across their run. On the pane of the face the tray's part
// is mounted on, and only where one of its cables is drawn there.
function drawTieStraps2d(svg, rack, routes, pane, at2d, drawn) {
  const layer = svg.querySelector(':scope > [data-cables]');
  if (!layer || !routes?.tieStraps?.length) return;
  let bars = layer.querySelector(':scope > [data-bundle-straps]');
  const fresh = !bars;
  if (fresh) bars = svgEl('g', {'data-bundle-straps': pane, 'pointer-events': 'none'});
  for (const m of routes.tieStraps) {
    const it = rack.items.find(i => i.id === m.item);
    if (!it || it.face !== pane) continue;
    if (!m.cables.some(id => drawn.has(id))) continue;
    // the band's middle: off the plate's face, on the side the cables are
    const [cx, cy] = at2d(tieCentre(m));
    // across the run: a run across the rack is seen along its length, and its band stands up; one in depth is seen end on, and its band lies flat
    const d = m.run === 'x' ? [0, TIE_HALF] : [TIE_HALF, 0];
    bars.append(strapBarEl(tieAttrs(m), {x1: cx - d[0], y1: cy - d[1], x2: cx + d[0], y2: cy + d[1]}, {kind: 'anchor', width_mm: m.width_mm}));
  }
  if (fresh && bars.childElementCount) layer.append(bars);
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
    // (its path, as its own drawing or as the projection of a seated module's back: part-path.js)
    const p = pathOfEl(n);
    if (p && (n.getAttribute('data-class') === 'port' || p.includes('-occupant'))) hit = p;
  }
  if (hit == null) return null;
  const path = portPathOf(hit);
  return group.querySelector(partSel(path, '[data-class="port"]')) ? path : null;
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
    // A PINNED CABLE OR BUNDLE KEEPS ITS TAG (#194): the selected cable's own,
    // the selected bundle's one (rack.css shows a tag that is .on-tag or .hot-tag).
    for (const n of svg.querySelectorAll('[data-cable-tag][data-cable-id]')) n.classList.toggle('on-tag', n.dataset.cableId === selectedId);
    for (const n of svg.querySelectorAll('[data-bundle-tag]')) n.classList.toggle('on-tag', bundleId != null && n.dataset.bundleTag === bundleId);
    // a selected cable shows the envelope of the bundle it rides
    for (const n of svg.querySelectorAll('[data-bundle-id]'))
      n.classList.toggle('on-member', selectedId != null && (n.dataset.members || '').split(' ').includes(selectedId));
    // A STRAP GOES WITH ITS BUNDLE: lit while its bundle, or a cable that rides
    // it, is the one selected, and dimmed with the rest otherwise (rack.css).
    // ...and it fades with them: a strap whose bundle's cables are all left out by the filter is a ghost too.
    for (const n of svg.querySelectorAll('[data-strap]')) {
      const ids = (n.dataset.members || '').split(' ').filter(Boolean);
      n.classList.toggle('on', n.dataset.strap === bundleId || (selectedId != null && ids.includes(selectedId)));
      n.classList.toggle('ghost', ids.length > 0 && ids.every(id => out.has(id) && !lit(id)));
    }
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
