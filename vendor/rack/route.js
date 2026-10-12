// CABLE ROUTES.
// Pure: the rack, a cable, and a ctx the page fills from the drawings -
//   ctx.chassisOf(ref), ctx.guidesOf(itemId) -> [{via, kind, face, x}],
//     a ring also with its `aperture`, and optionally its `run` ('x', 'y' or
//     'z'; 'x' when not given) and `depth` (mm along the run; RING_DEPTH when
//     not given, and then estimated),
//   ctx.portX(end) -> x or null,
//   and optionally ctx.portBoxesOf(itemId) -> [{path, view, x, y, w?, h?}],
//     every port of a device, cabled or not (#1013, portBoxesOn below),
// with every x in RACK coordinates: mm from the rack's centre line, positive
// to the right as seen from the FRONT. This file imports no DOM and nothing of
// the site's pages, so the rack kit can take it as it is.

import {uLabel, zeroUOf, bundlesOf, rollOf} from './model.js';
import {followTrunk} from './bundle-route.js';
import {RU, OPENING, RAIL_W} from './rails.js';
import {throughRings, cornersOf, STRAIGHT_DEG} from './route-path.js';
import {zeroUOnLane, zeroUX, carriesLane, runsThrough, STANDOFF} from './zero-u.js';
import {isZeroUPart, zeroUSpan, neighbours, anchorY, laneY, setbackOf, rollPoint, centreX, isQuarter} from './fit.js';
import {solidsOf, traysOf, detour, legCrossings, CLEAR} from './solids.js';
import {surfacesOf, hang, heldStretch, drapeOf, bendOf, newCrossing} from './resting.js';

export const LANE_GAP = 40;          // mm: a lane runs in the middle of a 40 mm gutter outside each rail
const SHORT = 2;                     // U: a jumper this close, with no manager, just hangs

export const lanesOf = frame => (frame.kind === 'two-post'
  ? ['left', 'right'] : ['left-front', 'right-front', 'left-rear', 'right-rear']);
// The rings, ducts, pass-throughs and trays a device offers a route, as
// rack.json lists them (guides and passes per view, trays by id): one sorted
// list of ids, whatever the view. A tray's id shares the namespace of the
// others (docs/cable-lay-design.md section 2.1), so `{item, via}` names it.
export const pathwaysOf = chassis =>
  [...new Set([...['guides', 'passes'].flatMap(k => Object.values(chassis?.[k] || {}).flat()),
    ...(Array.isArray(chassis?.trays) ? chassis.trays.map(t => t?.id).filter(v => typeof v === 'string') : [])])].sort();
const laneFor = (frame, side, pane) => (frame.kind === 'two-post' ? side : `${side}-${pane}`);
const itemOf = (rack, id) => rack.items.find(i => i.id === id) || null;

// Which face an end's port is seen from: its item's face, or the other one
// for the panel that faces away (a turned item swaps the two).
// Mirrors cable-rules.js paneOf, duplicated so this file stays kit-ready.
export function endPane(rack, end) {
  const it = itemOf(rack, end.item);
  if (!it) return null;
  const outward = (end.view === 'rear') === !!it.turned;
  return outward ? it.face : (it.face === 'front' ? 'rear' : 'front');
}

// A RING'S PASS (roc-ops/Portrayal#930): a cable goes through a D-ring along
// its run, entering one face and leaving the other, the ring's depth apart.
// RING_DEPTH is the depth taken when a ring states none: ESTIMATED, from the
// two FS rings measured so far, whose bands are 6.8 mm (fs/d-ring-snap-in)
// and 9.9 mm (fs/cmh-5dr1u-ring) thick along the run.
export const RING_DEPTH = 10;
export function ringOf(g) {
  if (g?.kind !== 'ring') return null;
  const stated = typeof g.depth === 'number' && g.depth > 0;
  return {run: ['x', 'y', 'z'].includes(g.run) ? g.run : 'x', depth: stated ? g.depth : RING_DEPTH, estimated: !stated};
}

// THE GUIDES OF AN ITEM AS IT IS MOUNTED. `ctx.guidesOf` gives each where the
// item would hold it upright; rolled 180 degrees (`roll`) every guide is
// across its centre line from there, so the ring nearest a port is another
// ring. An item rolled a quarter turn is an outline and offers none.
function mountedGuides(m, ctx) {
  const gs = ctx.guidesOf(m.id);
  if (isQuarter(m)) return [];
  if (rollOf(m) !== 180) return gs;
  const cx = centreX(m, ctx.chassisOf);
  return gs.map(g => ({...g, x: 2 * cx - g.x}));
}

// The manager an end leaves through, in order: one hosted on its item on that
// face; else, of the devices of a unit or less adjacent on that face (ABOVE
// first, then BELOW: fit.js neighbours), the first with a manager hosted on
// it on that face, else itself if it declares guides on that face. A manager
// must declare guides on that face. null when there is none.
function managerOf(rack, it, pane, ctx) {
  const guided = m => mountedGuides(m, ctx).some(g => g.face === pane);
  const hosted = rack.items.find(m => m.on === it.id && m.face === pane && guided(m));
  if (hosted) return hosted;
  {
    for (const o of neighbours(rack, it, ctx.chassisOf).filter(o => o.face === pane && !o.on)) {
      const carried = rack.items.find(m => m.on === o.id && m.face === pane && guided(m));
      if (carried) return carried;
      if (guided(o)) return o;
    }
  }
  return null;
}

// The waypoints through one end's manager, from the port out to `side`.
function through(m, pane, portX, side, crossing, ctx) {
  if (!m) return [];
  const gs = mountedGuides(m, ctx).filter(g => g.face === pane);
  const rings = gs.filter(g => g.kind === 'ring');
  if (rings.length) {
    // The rings on the way out: from the port toward `side`. A ring behind
    // the port would have the cable enter and leave by one face (#930); a
    // port within half a ring's depth of its centre is under it, and goes
    // through. Stricter than throughRings' side test, which also calls a
    // point steeper than 45 degrees off the run neither side: that would
    // let the automatic route reach back for a ring up to the manager's
    // stand-off behind the port (55 mm on an FHD-CMP5DR), which is the
    // hook it must not draw; every route chosen here passes that test.
    // A ring that runs along x only: one that runs up or across the face is
    // not on the way along the tray.
    const half = g => ringOf(g).depth / 2;
    const out = rings.filter(g => ringOf(g).run === 'x'
                                  && (side === 'left' ? g.x <= portX + half(g) : g.x >= portX - half(g)))
      .sort((a, b) => (side === 'left' ? b.x - a.x : a.x - b.x));
    if (out.length) return out.map(g => ({item: m.id, via: g.via}));
  }
  const duct = gs.find(g => g.kind === 'duct');
  if (duct) return [{item: m.id, via: duct.via}];
  const pass = crossing && gs.find(g => g.kind === 'pass');
  return pass ? [{item: m.id, via: pass.via}] : [];
}

// A PATCH ALONG ONE MANAGER (#949, docs/cable-lay-design.md section 4.1,
// "Local patches"): both ends leave through the same manager on the same face,
// so the cable runs along it port to port, through the rings BETWEEN the two
// ports in order from end a, and never out to a gutter and back. A ring is
// between when its centre is, the ends included: not the half-depth reach of
// `through`, which takes a ring whose centre is just behind a port on the way
// out to a gutter. Here the cable turns toward the other port at once, and a
// ring behind it is a step back the patch does not need (on the owner's rack
// of #949, a leaf port 3.1 mm short of a ring's centre, cabled away from it,
// measured 5.5 cm longer through it, and a stock size). A ring outside the
// stretch is left alone; with no ring between, the cord goes through the one
// ring nearest the middle of its two ports (below), so a manager with a ring
// along x never gives an empty route. A manager with no ring that runs along
// x, but a duct, runs in the duct.
function along(m, pane, ax, bx, ctx, passes = null) {
  const gs = mountedGuides(m, ctx).filter(g => g.face === pane);
  const rings = gs.filter(g => g.kind === 'ring' && ringOf(g).run === 'x');
  if (rings.length) {
    const lo = Math.min(ax, bx), hi = Math.max(ax, bx);
    const between = rings.filter(g => g.x >= lo && g.x <= hi)
      .sort((p, q) => (ax <= bx ? p.x - q.x : q.x - p.x));
    if (between.length) return between.map(g => ({item: m.id, via: g.via}));
    // NO RING BETWEEN (owner's decision, 2026-10-09): a ring holds the cord
    // even where it does not turn it, so the route is never direct: the ring
    // nearest the middle of the two ports, of two as near the one on end a's
    // side. A ring outside the stretch can be one the cord would enter and
    // leave by one face (#930: both ports on its one side, not steep enough
    // to be under it), which ringFindings reports; so the nearest ring the
    // cord passes through is taken (`passes`, the test routePath makes), and
    // only when none passes, the nearest.
    const mid = (ax + bx) / 2, aSide = Math.sign(ax - mid);
    const order = [...rings].sort((p, q) => Math.abs(p.x - mid) - Math.abs(q.x - mid)
      || aSide * (q.x - p.x));
    const near = order.find(g => passes?.(g)) ?? order[0];
    return [{item: m.id, via: near.via}];
  }
  const duct = gs.find(g => g.kind === 'duct');
  return duct ? [{item: m.id, via: duct.via}] : [];
}

const sameWp = (a, b) => (a.lane ? a.lane === b.lane && a.ru === b.ru : a.item === b.item && a.via === b.via);
const dedupe = list => list.filter((w, i) => i === 0 || !sameWp(w, list[i - 1]));

// The route by the gutter on `side`: out through end a's manager, along the
// lane (across the top when the ends are on two faces), in through end b's.
function byGutter(rack, A, B, mA, mB, side, ctx) {
  const crossing = A.pane !== B.pane;
  const f = rack.frame;
  const laneA = laneFor(f, side, A.pane), laneB = laneFor(f, side, B.pane);
  const lanes = laneA === laneB
    ? [{lane: laneA, ru: A.it.ru}, {lane: laneA, ru: B.it.ru}]
    : (() => { const top = Math.max(A.it.ru, B.it.ru);
        return [{lane: laneA, ru: A.it.ru}, {lane: laneA, ru: top}, {lane: laneB, ru: top}, {lane: laneB, ru: B.it.ru}]; })();
  const outA = through(mA, A.pane, A.x, side, crossing, ctx);
  const outB = through(mB, B.pane, B.x, side, crossing, ctx).reverse();
  return dedupe([...outA, ...lanes, ...outB]);
}

// THE AUTOMATIC ROUTE. Two ends that leave through one manager on one face
// run along it (`along`). Any other route takes a gutter, chosen from BOTH
// ends (section 4.1, "Opposite ways"): when both ports stand on the same side
// of the centre line, that side (a port at the centre counts as left);
// when they stand on opposite sides, the side whose path (routePath, with its
// detours) is the shorter, end a's side on a tie or when either port is not
// found and so cannot be measured.
// A jumper within SHORT units, on one face, with no manager at either end,
// takes no gutter: it just hangs, and the route is empty. `{gutter: true}`
// asks for the gutter route all the same: what a member of a bundle takes
// (#1012, resolveRoute), since the bundle is dressed down a gutter and a cord
// in it does not hang across the faces.
export function autoRoute(rack, cable, ctx, {gutter = false} = {}) {
  const ends = [cable.a, cable.b].map(e => {
    const it = itemOf(rack, e.item), pane = it && endPane(rack, e);
    // A port not found only defaults the SIDE (to the left, as a port at the centre does);
    // no length is ever measured from it (portPoint).
    return it && pane ? {e, it, pane, x: ctx.portX(e) ?? 0} : null;
  });
  if (ends.some(x => !x)) return [];
  const [A, B] = ends;
  const mA = managerOf(rack, A.it, A.pane, ctx), mB = managerOf(rack, B.it, B.pane, ctx);
  if (!gutter && !mA && !mB && A.pane === B.pane && Math.abs(A.it.ru - B.it.ru) <= SHORT) return [];
  if (mA && mA === mB && A.pane === B.pane) {
    // whether the cord goes through a ring from port to port, as routePath
    // decides it; unknown (a port not found) counts as through. From the
    // ports, not their plugs' reach points: a reach moves an end along z
    // only, which a ring that runs along x does not count (route-path.js)
    const pa = portPoint(rack, cable.a, ctx), pb = portPoint(rack, cable.b, ctx);
    const passes = g => {
      const p = pointOf(rack, {item: mA.id, via: g.via}, ctx);
      return !(pa && pb && p) || !throughRings([pa, p, pb],
        [null, {...ringOf(g), diameter: cableDiameter(cable, ctx), portBefore: true, portAfter: true}, null]).back.length;
    };
    return along(mA, A.pane, A.x, B.x, ctx, passes);
  }
  const sideOf = x => (x <= 0 ? 'left' : 'right');
  const sA = sideOf(A.x), sB = sideOf(B.x);
  if (sA === sB) return byGutter(rack, A, B, mA, mB, sA, ctx);
  const routes = {[sA]: byGutter(rack, A, B, mA, mB, sA, ctx), [sB]: byGutter(rack, A, B, mA, mB, sB, ctx)};
  // The detours are part of the path (a gutter beside a zero-U PDU can cost
  // the one side 25 cm round it), and measuring them is the dear part, so the
  // side is decided once per rack, context and cable, as solidsOf reads its
  // bodies once per rack and context.
  let per = sideMemo.get(rack);
  if (!per) sideMemo.set(rack, per = new WeakMap());
  let byCable = per.get(ctx);
  if (!byCable) per.set(ctx, byCable = new WeakMap());
  if (!byCable.has(cable)) {
    // Measured as a route edited by hand, so the measure does not come back
    // here; and under an id no bundle holds, so it is the cable's own path.
    const measure = route => pathLength(routePath(rack, {...cable, id: Symbol('side'), route, routeEdited: true}, ctx))?.measured;
    const la = measure(routes[sA]), lb = measure(routes[sB]);
    // within a micron is a tie: a mirrored pair of paths that sag (#949 step
    // 3) can measure apart in the last bits of a float
    byCable.set(cable, la == null || lb == null || la <= lb + 1e-6 ? sA : sB);
  }
  return routes[byCable.get(cable)];
}
const sideMemo = new WeakMap();
// where each cable's turns were given room (routePath), per rack and context
const roomMemo = new WeakMap();

// Does a waypoint still stand for something in this rack? A guide the page
// reads off the drawings, or a tray the catalogue lists.
function resolves(rack, w, ctx) {
  if (w.lane) return lanesOf(rack.frame).includes(w.lane) && w.ru >= 1 && w.ru <= rack.frame.heightRU;
  return !!itemOf(rack, w.item) && (ctx.guidesOf(w.item).some(g => g.via === w.via) || !!trayOf(rack, w, ctx));
}

// THE TRAY A WAYPOINT NAMES (docs/cable-lay-design.md section 2.1), placed
// (solids.js traysOf), or null. A ring or a duct of the same id wins: the
// namespace is one, and lint holds an id to one pathway (L170).
export const trayOf = (rack, w, ctx) => (w?.item && !w.lane
  ? traysOf(rack, ctx).find(t => t.item === w.item && t.via === w.via) ?? null : null);

// A CABLE'S OWN ROUTE: the stored one once edited, else the automatic one. A
// stored waypoint that no longer resolves is skipped, and reported.
// `{gutter: true}` is autoRoute's: the automatic route of a short jumper as a
// bundle member takes it, by the gutter. A route edited by hand is as stored.
export function ownRoute(rack, cable, ctx, {gutter = false} = {}) {
  const auto = cable.routeEdited !== true;
  const list = auto ? autoRoute(rack, cable, ctx, {gutter}) : (cable.route || []);
  const waypoints = [], gone = [];
  for (const w of list) (resolves(rack, w, ctx) ? waypoints : gone).push(w);
  return {waypoints, gone, auto};
}

// A BUNDLE'S TRUNK as it resolves today: its stored waypoints, less those that
// no longer stand for anything (reported as `gone`, and skipped).
export function trunkRoute(rack, bundle, ctx) {
  const waypoints = [], gone = [];
  for (const w of bundle.route || []) (resolves(rack, w, ctx) ? waypoints : gone).push(w);
  return {waypoints, gone};
}

// The bundle a cable is drawn in: one holding it and at least one other cable
// (a bundle of fewer is kept and listed, but not drawn: #921 decision 5).
export function drawnBundleOf(rack, cableId) {
  return bundlesOf(rack).find(b => b.members.length >= 2 && b.members.some(m => m.cable === cableId)) ?? null;
}

// THE ROUTE A CABLE FOLLOWS. A member of a bundle (#921) follows its own route
// up to where it joins the trunk, the trunk to where it leaves, then its own
// route on to its far port (bundle-route.js followTrunk); the result then also
// names its `bundle`, `join` and `leave`, so a drawing can tell the bundled
// part from the leads. `gone` is the cable's own; a trunk's is the bundle's
// (trunkRoute). Any other cable follows its own route.
// A MEMBER'S OWN ROUTE IS THE GUTTER ROUTE (#1012): a jumper within two units
// that would hang on its own (autoRoute) is taken out to the gutter when it
// is in a bundle, so it meets a trunk down that gutter where its own units
// are. A member whose route still does not meet the trunk (the trunk is down
// the other gutter, or through a manager it does not use) joins and leaves it
// at the elements nearest its two ports (trunkMeasures).
export function resolveRoute(rack, cable, ctx) {
  const b = drawnBundleOf(rack, cable.id);
  const trunk = b ? trunkRoute(rack, b, ctx).waypoints : [];
  if (!trunk.length) return ownRoute(rack, cable, ctx);
  const own = ownRoute(rack, cable, ctx, {gutter: true});
  const f = followTrunk(own.waypoints, trunk, b.members.find(m => m.cable === cable.id), trunkMeasures(rack, cable, trunk, ctx));
  return {...own, waypoints: f.waypoints, bundle: b.id, join: f.join, leave: f.leave};
}

// WHAT followTrunk ASKS OF THE DRAWINGS for a member whose own route never
// meets the trunk (bundle-route.js): `aNearStart()`, whether its a port is
// nearer the trunk's first waypoint than its last (true when a point is not
// found), and `nearest(end, elements)`, the index of the trunk element (a
// pathway or a lane node; a segment is not a place to join) nearest the port
// of end 'a' or 'b', or null when the port is not found. Two elements as near
// go to the one whose key sorts first, so the answer does not depend on which
// way the trunk was written.
// Exported because two callers need the one measure: bundles.js layoutOf,
// which must join a member where resolveRoute does, and a page that calls
// followTrunk itself.
export function trunkMeasures(rack, cable, trunk, ctx) {
  const aNearStart = () => {
    const p = portPoint(rack, cable.a, ctx), s = trunk.length && pointOf(rack, trunk[0], ctx), e = trunk.length && pointOf(rack, trunk.at(-1), ctx);
    return !(p && s && e) || dist(p, s) <= dist(p, e);
  };
  const nearest = (end, elements) => {
    const p = portPoint(rack, cable[end], ctx);
    if (!p) return null;
    let best = null, least = Infinity;
    elements.forEach((e, i) => {
      if (e.kind === 's') return;
      const q = pointOf(rack, e.kind === 'p' ? {item: e.item, via: e.via} : {lane: e.lane, ru: e.u}, ctx);
      if (!q) return;
      const d = dist(p, q);
      if (d < least - 1e-9 || (Math.abs(d - least) <= 1e-9 && e.key < elements[best].key)) { least = d; best = i; }
    });
    return best;
  };
  return {aNearStart, nearest};
}

// The route as a line of text: "mgr-1 ring 3 > left-front U12-U24 > ...".
// Consecutive points on one lane read as one run. `nameOf(itemId)` names an item.
// U's are as stored; pass `frame` to label them the way the rack counts.
export function routeText(route, nameOf = id => id, frame = null) {
  const u = n => (frame ? uLabel(frame, n) : n);
  const viaText = v => (/^guide-(\d+)$/.test(v) ? `ring ${v.slice(6)}` : v);
  const out = [];
  for (const w of route) {
    const last = out[out.length - 1];
    if (w.lane && last?.lane === w.lane) { last.to = w.ru; continue; }
    out.push(w.lane ? {lane: w.lane, from: w.ru, to: w.ru} : {text: `${nameOf(w.item)} ${viaText(w.via)}`});
  }
  return out.map(p => (p.lane ? `${p.lane} U${u(p.from)}${p.to !== p.from ? `-U${u(p.to)}` : ''}` : p.text)).join(' > ');
}

// ── geometry, in rack coordinates (mm) ────────────────────────────────────
// x from the centre line, right as seen from the front; y up from the floor of
// U1; z 0 on the front rail plane, negative toward the rear. The page's 2D and
// 3D draw from their own drawings; this is the rack's own measure, so the
// length is the same whatever is on screen.
const railDepthOf = f => (f.kind === 'two-post' ? 0 : f.railDepth);
export const laneX = side => (side === 'left' ? -1 : 1) * (OPENING / 2 + RAIL_W + LANE_GAP / 2);
// WHERE A LANE IS ACROSS THE RACK at a U (#926): the centre line of a zero-U
// part that carries the lane there (a duct standing at that upright); else,
// beside a zero-U part that stands in the gutter and carries no lane (a
// zero-U PDU, #949), the middle of a gutter as wide as the usual one just
// outboard of it; else the middle of the gutter. The route stays {lane, ru};
// only where the lane runs changes, so a length is measured where the cable
// runs.
// WHY OUTBOARD of a PDU, and not inboard or in front: inboard of it is the
// rail and the ears of every device fixed there, so there is no room; in
// front of it (along z) would take the lane off the rail plane every port
// leg and every front-to-back crossing is measured in, and out past the back
// of a rear PDU, outside the rack. Outboard keeps the lane in its own plane,
// beside the PDU, where a cable dresses down the side channel of a real rack.
// A zero-U part standing at that upright at that U that carries no lane: it
// stands in the gutter (against the upright's outer face, STANDOFF 0).
const besideLane = (rack, lane, ru, chassisOf) => zeroUOf(rack).find(z => {
  const c = chassisOf(z.ref);
  if (z.at !== lane || !isZeroUPart(c) || carriesLane(c) || !(Number(c.w) > 0)) return false;
  const [lo, hi] = zeroUSpan(z, chassisOf);
  return ru >= lo && ru <= hi;
}) ?? null;
export function laneXAt(rack, lane, ru, chassisOf) {
  if (typeof chassisOf !== 'function') return laneX(String(lane).split('-')[0]);
  const z = zeroUOnLane(rack, lane, ru, chassisOf);
  if (z) return zeroUX(z, chassisOf);
  const p = besideLane(rack, lane, ru, chassisOf);
  if (!p) return laneX(String(lane).split('-')[0]);
  const s = Math.sign(zeroUX(p, chassisOf)) || -1;
  return s * (OPENING / 2 + RAIL_W + STANDOFF + (Number(chassisOf(p.ref)?.w) || 0) + LANE_GAP / 2);
}
const planeZ = (f, pane) => (pane === 'rear' ? -railDepthOf(f) : 0);
// Where a panel of a rack device is, in depth: the one on the face it is
// mounted on stands its setback behind that rail (fit.js setbackOf), and its
// far panel the chassis depth beyond.
function panelZ(rack, it, pane, ctx) {
  const d = ctx.chassisOf(it.ref)?.d ?? 0, s = setbackOf(rack, it, ctx.chassisOf);
  const own = it.face === 'front' ? 0 - s : -railDepthOf(rack.frame) + s;
  return pane === it.face ? own : it.face === 'front' ? own - d : own + d;
}

export function pointOf(rack, w, ctx) {
  const f = rack.frame;
  if (w.lane) {
    const [, pane = 'front'] = w.lane.split('-');
    return {x: laneXAt(rack, w.lane, w.ru, ctx?.chassisOf), y: laneY(w.ru), z: planeZ(f, pane)};
  }
  const it = itemOf(rack, w.item), g = it && ctx.guidesOf(it.id).find(x => x.via === w.via);
  if (!g) {
    // a tray: the middle of its largest floor rectangle, on its upward face
    const t = it && trayOf(rack, w, ctx);
    if (!t) return null;
    const f = t.floors.reduce((m, b) => ((b.x1 - b.x0) * (b.z1 - b.z0) > (m.x1 - m.x0) * (m.z1 - m.z0) ? b : m));
    return {x: (f.x0 + f.x1) / 2, y: t.top, z: (f.z0 + f.z1) / 2};
  }
  // A rack-face part stands out from its rail plane by half its depth; a rack
  // device's guide is on its face, at the rail plane.
  const c = ctx.chassisOf(it.ref) || {};
  // A guide on a rack device's FAR panel is the chassis depth in, as portPoint puts a port there.
  const out = c.mount === 'rack-face' ? (c.d ?? 0) / 2 : 0;
  const z = c.mount !== 'rack-face' ? panelZ(rack, it, g.face, ctx)
    : g.face === 'rear' ? planeZ(f, 'rear') - out : planeZ(f, 'front') + out;
  // the guide where it is as mounted: turned with the item by its roll
  return {...rollPoint(rack, it, {x: g.x, y: anchorY(rack, it, ctx.chassisOf)}, ctx.chassisOf), z};
}

export function portPoint(rack, end, ctx) {
  const it = itemOf(rack, end.item), pane = it && endPane(rack, end);
  if (!pane) return null;
  // No port found on the drawing: no point, and so no length - never an invented x of 0.
  const x = ctx.portX(end);
  if (x == null) return null;
  // On its own face a panel is at that rail, less its setback; the far panel is the chassis depth away.
  const z = panelZ(rack, it, pane, ctx);
  // `portX` and `portY` give the port as the item would hold it upright; its
  // roll turns it to where it is drawn (fit.js rollPoint)
  return {...rollPoint(rack, it, {x, y: ctx.portY?.(end) ?? anchorY(rack, it, ctx.chassisOf)}, ctx.chassisOf), z};
}

// THE PORTS A SPAN CAN COVER (#1013, docs/cable-lay-design.md section 1.7).
// Every port the kit can place, as a box on the panel it is on: {item, path,
// view, x0, x1, y0, y1, z, out}, x and y in rack mm, `z` the panel and `out`
// the way it looks (+1 out of the front, -1 out of the rear).
// - `ctx.portBoxesOf(itemId)`, when the page gives it, lists every port of a
//   device, cabled or not: [{path, view, x, y, w?, h?}], `x` and `y` the
//   centre of the port's box where portX and portY put a port (x from the
//   centre line, y up from the floor of U1), `w` and `h` its size in mm. It
//   is an ADDITIVE, OPTIONAL reader: a context without it is as valid as it
//   was. A reader that throws, or an entry it cannot read, is left out.
// - Every cabled port is known without it (portX and portY place it), and is
//   added where the reader did not list it. So with no reader a span is still
//   judged against the ports that hold a cable, and against no others: what
//   is reported is true, and a port with no cable in it can be missed.
// The list says what it holds: `judged` is 'all' when the reader was given
// and answered for every device, else 'cabled' (no reader, or one that threw
// for a device): a finding carries it, so a reader of one knows whether a
// port with no cable in it could have been seen.
// PORT_BOX is the box of a port whose size is not given: ESTIMATED, about
// the opening of an RJ45 jack or an SFP cage (no one figure fits every port);
// such a box is `estimated`, and a finding that rests on one says so.
// Read once per rack and context, as solidsOf reads its bodies.
const PORT_BOX = {w: 12, h: 10};
const portMemo = new WeakMap();
function portBoxesOn(rack, ctx) {
  const keyed = ctx !== null && typeof ctx === 'object';
  let per = portMemo.get(rack);
  if (!per) portMemo.set(rack, per = new WeakMap());
  if (keyed && per.has(ctx)) return per.get(ctx);
  const out = [], seen = new Set();
  const size = v => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
  // A PORT BOX STANDS WHERE THE BODY DOES: the reader gives each port where
  // an upright item would hold it, as portX and portY do, and the roll of the
  // item turns it (fit.js rollPoint), a quarter turn swapping its width and
  // height. `mounted` is a point that is already as mounted (portPoint's).
  const add = (it, path, view, ux, uy, w0, h0, mounted = false) => {
    const pane = endPane(rack, {item: it.id, view});
    const key = `${it.id}|${path}|${view}`;
    if (!pane || seen.has(key) || !Number.isFinite(ux) || !Number.isFinite(uy)) return;
    seen.add(key);
    const {x, y} = mounted ? {x: ux, y: uy} : rollPoint(rack, it, {x: ux, y: uy}, ctx.chassisOf);
    const [w, h] = isQuarter(it) ? [h0, w0] : [w0, h0];
    const hw = (size(w) ?? PORT_BOX.w) / 2, hh = (size(h) ?? PORT_BOX.h) / 2;
    out.push({item: it.id, path, view, x: x, y: y, x0: x - hw, x1: x + hw, y0: y - hh, y1: y + hh,
      z: panelZ(rack, it, pane, ctx), out: pane === 'rear' ? -1 : 1, ...(size(w) && size(h) ? {} : {estimated: true})});
  };
  let all = typeof ctx?.portBoxesOf === 'function';
  if (typeof ctx?.portBoxesOf === 'function') for (const it of rack.items) {
    let list = null;
    try { list = ctx.portBoxesOf(it.id); } catch { list = null; all = false; }
    for (const b of Array.isArray(list) ? list : [])
      if (b && typeof b.path === 'string') add(it, b.path, b.view === 'rear' ? 'rear' : 'front', b.x, b.y, b.w, b.h);
  }
  for (const c of rack.cables || []) for (const e of [c.a, c.b]) {
    const it = e && itemOf(rack, e.item);
    let p = null;
    try { p = it ? portPoint(rack, e, ctx) : null; } catch { p = null; }
    if (p) add(it, e.path, e.view === 'rear' ? 'rear' : 'front', p.x, p.y, undefined, undefined, true);
  }
  out.judged = all ? 'all' : 'cabled';
  if (keyed) per.set(ctx, out);
  return out;
}
// HOW FAR OUT OF A PANEL A CABLE STILL COVERS A PORT, mm: a span nearer the
// panel than this, in front of a port, is in the way of the plug that seats
// there and of the hand that seats it. ESTIMATED: the longest plug the kit
// knows stands 64.8 out of its cage (PLUG_REACH, a DAC), and the figure is
// that and room to hold it; no source states one. The spans it is for stand
// within a plug and a bend radius of the panel, well inside it.
const COVER_DEPTH = 100;
// Where the leg p -> q first passes in front of a port's box, the box grown by
// the cable's radius `r`, no further out of the panel than COVER_DEPTH; null
// when it does not. A leg that only touches the box's edge does not cover it.
function legOver(p, q, b, r) {
  let t0 = 0, t1 = 1;
  const clip = (v0, v1, lo, hi) => {
    const d = v1 - v0;
    if (Math.abs(d) < 1e-12) return v0 >= lo && v0 <= hi;
    const a = (lo - v0) / d, c = (hi - v0) / d;
    t0 = Math.max(t0, Math.min(a, c)); t1 = Math.min(t1, Math.max(a, c));
    return t0 < t1 - 1e-9;
  };
  if (!clip(p.x, q.x, b.x0 - r, b.x1 + r) || !clip(p.y, q.y, b.y0 - r, b.y1 + r)
      || !clip((p.z - b.z) * b.out, (q.z - b.z) * b.out, -1e-6, COVER_DEPTH)) return null;
  return {x: p.x + (q.x - p.x) * t0, y: p.y + (q.y - p.y) * t0, z: p.z + (q.z - p.z) * t0};
}

const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);

// THE PLUG'S REACH (#960, docs/cable-lay-design.md section 1.5). A cable
// leaves the far end of its plug, not the port face, and runs straight out
// along the face's normal for the plug's depth before it can turn. So each
// route's first and last leg starts at the REACH POINT: the port's point moved
// out of its face by the plug's reach. The reach, in mm out of the face the
// port is on, is `ctx.plugReachOf(end, cable)` when the page gives a number
// (the far end of the plug seated there, with whatever it seats in: relief.js
// cablePoints' `z`, an optic's standing-out included); else PLUG_REACH by the
// cable's media, the cable's own plug and boot as the library models them
// standing out of the face they seat in:
//   - LC fibre (os2, om3, om4, om5): 27.6, generic/lc-plug@2 (relief `out`
//     12.5) and common/lc-boot@1 (15.1);
//   - copper (cat6, cat6a): 39.4, generic/rj45-plug@1 (13.0) and
//     common/rj45-boot@1 (26.4). It assumes the boot abuts the plug's rear;
//     an overlapping boot reaches less (the boot's 11.9 x 8.13 opening slides
//     over the 11.68 x 7.93 plug body, so this likely errs long by a few mm);
//   - a DAC or an AOC: 64.8, generic/qsfp-cable@1, whose cable point is the
//     far end of its stub (head 19.8, strain relief 15, stub 30: the straight
//     run before the first allowed bend), the stub from a drawing. Not
//     generic/sfp-cable@1's 68.7: its stub rests on an estimated reading;
//   - a cable whose media is not set, the copper figure, as its diameter takes
//     the copper one (UNSET_D).
// It does not see an optic in a cage: a port that holds one stands the plug
// further out, which only the page knows.
export const PLUG_REACH = {os2: 27.6, om3: 27.6, om4: 27.6, om5: 27.6, cat6: 39.4, cat6a: 39.4, dac: 64.8, aoc: 64.8};
const UNSET_REACH = 39.4;
function plugReach(cable, end, ctx) {
  let v = null;
  try { v = typeof ctx?.plugReachOf === 'function' ? ctx.plugReachOf(end, cable) : null; } catch { v = null; }
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v;
  return (typeof cable?.media === 'string' && Object.hasOwn(PLUG_REACH, cable.media)) ? PLUG_REACH[cable.media] : UNSET_REACH;
}
// The reach point of an end whose port is at `p`: out of the face its port is
// seen from, +z for the front, -z for the rear, by the plug's reach.
function reachPoint(rack, end, p, mm) {
  const out = endPane(rack, end) === 'rear' ? -1 : 1;
  return {x: p.x, y: p.y, z: p.z + out * mm};
}

// THE LARGEST RADIUS A LAY IS OPENED OUT FOR (#973), mm: approach points,
// lead points and detours are placed for a cable's installed bend radius up
// to this, twice a power cord's 42.6 and more than three times a Cat 6A
// cord's 30. It is a bound on what the kit moves, not on what it reports: a
// cable that needs more is laid as one of this radius, and every corner
// short of its own radius is still in `bends`.
const ROOM_MAX = 100;

export const STOCK_M = [0.5, 1, 1.5, 2, 3, 5, 7, 10, 15, 20, 30];
// THE END ALLOWANCE (#962, docs/cable-lay-design.md section 1.6). This
// table is its sourced part, in metres an end, by media: only what is
// physically there and not in the path.
// A routed path runs from port face to port face, the plug outside the face
// included (PLUG_REACH, above), while a stock cord's nominal length takes in
// its plugs, tip to tip, unless its maker measures it otherwise. So each end
// adds
//   - the part of the plug INSIDE the port, when the nominal length includes
//     it: the plug's length less its reach out of the face, from the library
//     parts PLUG_REACH reads; and
//   - half of how much SHORTER than its nominal length the maker allows a
//     cord to be (its minus tolerance). A plus tolerance only adds slack, so
//     it adds nothing here.
//     That part is no longer in this table: it is shortTolerance (below),
//     which has a floor and grows with the cord. THE TABLE IS THE INSIDE PART
//     ALONE (rack file version 4, docs/rack-file-v4-design.md section 3.2).
// Service loops and dressing slack are not in this table either: they are the
// spare (END_PLAY_M and what is stored, below), where they can be seen.
//   - LC fibre (os2, om3, om4, om5): 13.1 mm, the plug inside. generic/lc-plug@2:
//     its rear stands 25.6 behind the housing's front, 12.5 of it out of the
//     bore (an estimate in the bracket 12.2 to 13.97 that SENKO's
//     DS-LC-000004 drawing allows). Nothing short: FS's patch cable
//     datasheet for fibre cords, its Cable Length Tolerances table, states
//     every duplex and simplex length +x/-0 (+10 cm/-0 cm from 0.5 m, +15 cm/-0 cm from 5 m).
//   - copper (cat6, cat6a), and a cable with no media: 34.5 mm. 9.5 inside,
//     generic/rj45-plug@1 (22.48 long, CommScope 2843005, 13.0 of it out of
//     the jack, an estimate resting on the latch); plus 25, half of 1 per
//     cent of a 5 m cord. FS, Panduit and Siemon state no copper cord
//     tolerance; Belden's CAT6+ modular cord (C601106001, Overall Length
//     Tolerances) states +0.2/-0 m to 2 m, Brand-Rex's 10GPlus Cat6A
//     patchcord (GD056534v18) a bracketed length of +/- 1%. The two disagree,
//     and the one that allows a short cord is taken, at 5 m, the longest
//     cord a rack's own routes come to as a rule.
//   - DAC: 25 mm, half of the +/-5 cm the FS 10G SFP+ DAC datasheet states
//     for lengths to 5 m (section VII, the L / TOLERANCE table). Its drawing
//     dimensions L between the two heads, so the heads, the part in the cage
//     included, come with the cord and add nothing; the head's 19.8 out of
//     the cage, which the path counts, is left as margin.
//   - AOC: 52.4 mm, the plug inside: generic/qsfp-cable@1 (SFF-8661 Figure
//     5-1, the head's stop in the cage), the same head PLUG_REACH reads. No
//     maker held says how it measures an AOC (FS's AOC drawing gives no L),
//     so tip to tip is assumed; nothing short: L-com's AOCQSP28100 drawing,
//     OVERALL CABLE LENGTH TOLERANCE, is +x/-0 at every length.
// The kit does not know what a port holds: an LC cord into an optic's
// receptacle enters it as it would an adapter's, and an AOC's head enters
// the cage; an SFP head (47.5 inside, SFF-8432) is taken at the QSFP figure.
export const END_ALLOWANCE_BY_MEDIA = {os2: 0.0131, om3: 0.0131, om4: 0.0131, om5: 0.0131,
  cat6: 0.0095, cat6a: 0.0095, dac: 0, aoc: 0.0524};
const UNSET_ALLOWANCE = 0.0095;
// What is inside the port at each end of a cable, in metres: its media's
// figure from the table (the copper cord's for a cable with no media, or
// none the table knows).
export const endAllowance = cable => ((typeof cable?.media === 'string'
  && Object.hasOwn(END_ALLOWANCE_BY_MEDIA, cable.media))
  ? END_ALLOWANCE_BY_MEDIA[cable.media] : UNSET_ALLOWANCE);

// ── THE LENGTHS, NAMED (docs/rack-file-v4-design.md section 3.2) ───────────
// path     the routed points, port face to port face;
// need     the path, what is inside the two ports, and the short tolerance
//          of the maker: what the cord must at least be;
// stock    the length bought: pinned by the user, or chosen here;
// spare    stock less need: real cable, and it is somewhere;
// end play the part of the spare that stays at the two ends, in the curves
//          into the ports, and is never coiled: END_PLAY_M an end;
// to store the spare less the end play, never below zero.
// END_PLAY_M is the 0.1 m an end the kit added before as a dressing
// allowance, under the name of what it is and moved out of the need into the
// spare; no stock size changes for the move.
export const END_PLAY_M = 0.1;
// THE STOCK BREAK (#983): a cord up to this much short of full end play is
// still chosen. A twentieth of the end play, and more than the spread of the
// LC plug depth estimate at two ends.
export const BREAK_TOL_M = 0.01;
// More to store than this with nowhere said for it is a finding.
export const UNPLACED_WARN_M = 0.3;
// HOW MUCH SHORTER THAN ITS NOMINAL LENGTH A MAKER LETS A CORD BE, in metres
// over both ends, for a cord of `stock` metres. Copper (and a cable with no
// media, or one the table does not know): the greater of 50 mm and 1 per
// cent of the length - to 5 m the 25 mm an end the table held, 70 mm at 7 m,
// 300 mm at 30 m. DAC: its stated 50 mm at every length. Fibre and AOC: none,
// their makers state plus tolerances only.
const NO_SHORT = ['os2', 'om3', 'om4', 'om5', 'aoc'];
export function shortTolerance(cable, stock) {
  const media = typeof cable?.media === 'string' ? cable.media : '';
  if (NO_SHORT.includes(media)) return 0;
  if (media === 'dac') return 0.05;
  return Math.max(0.05, 0.01 * (Number(stock) > 0 ? Number(stock) : 0));
}
const pathMetres = path => { let mm = 0; for (let k = 1; k < path.points.length; k++) mm += dist(path.points[k - 1], path.points[k]); return mm / 1000; };
// What a cord of `stock` metres along `path` must at least be.
export const needOf = (path, cable, stock) => pathMetres(path) + 2 * endAllowance(cable) + shortTolerance(cable, stock);
// THE STOCK SIZE CHOSEN: the smallest with the need, the end play at both
// ends and any `values` the slack entries state inside it, to within
// BREAK_TOL_M. `needAt(s)` is the need of a cord of s metres, since a copper
// cord's tolerance grows with it; sizes are tried in order.
function chooseStock(needAt, values = 0) {
  const fits = s => s + BREAK_TOL_M >= needAt(s) + 2 * END_PLAY_M + values - 1e-9;
  for (const s of STOCK_M) if (fits(s)) return s;
  for (let s = 35; s < 100000; s += 5) if (fits(s)) return s;
  return null;
}
// The stock size for a need that is already known (it does not grow with the cord).
export const stockLength = (need, {values = 0} = {}) => chooseStock(() => need, values);

// THE PATH A CABLE TAKES, in rack coordinates (mm): its a port, every
// waypoint's point, and its b port, each ring's centre expanded to where the
// cable enters it and where it leaves (throughRings, #930). Each ring's way
// through (`sense`), and whether the cable goes through it at all, is decided
// HERE, once, in the rack's frame. The routed length, fill, capacity, inspect
// and ringFindings read this path; the drawings, which place their points
// from their own pictures, are handed the same decisions (ringMarks) and
// obey them, so what is drawn is what is measured and counted.
// Returns
//   {points: [{x, y, z, at, item?, via?}], rings, findings, marks}
// - `at` is 'a' or 'b' (a port), 'reach' (the far end of that port's plug,
//   with `end` 'a' or 'b', section 1.5: the route's first and last legs start
//   there), 'entry', 'exit' or 'face' (a ring), 'approach' (outside a ring
//   whose opening is placed, where a pass starts and ends, #968),
//   'lead' (a point a turn is given its room at, #973: beside a ring's
//   approach point, with the ring's `item` and `via`, where the cable is led
//   square to it; or straight out of a plug past its reach point, with its
//   `end`), 'pathway' (a duct or a pass-through), 'tray' (a point of a
//   tray's stretch, #949 step 3), 'lane', 'detour' or 'rest' (a point of a
//   free span as it hangs, or as it lands on a surface);
// - `rings`: per ring on the route, {item, via, run, depth, estimated,
//   passed, sense, entry, exit} (sense +1 or -1 along the run; a ring not
//   passed has `face` instead of entry and exit: the ring's own face, where
//   the path's `face` point of a ring whose opening is placed stands back
//   from it at its approach point, #968; one that holds a cable
//   reaching just into it, route-path.js HELD, is passed and `held: true`);
// - `findings`: a ring the route would enter and leave by one face, as
//   {kind: 'doubles-back', cable, item, via};
// - `marks`: parallel to resolveRoute's waypoints, null for a lane, a duct or
//   a pass, and for a ring {run, depth, sense, back}: what a drawing passes
//   to routed2d or routePoints3d (ringMarks);
// - `crossings`: each solid body a leg of the path still crosses (#949,
//   docs/cable-lay-design.md section 1), as {kind: 'crosses-body', cable,
//   item, part, between: [from, to], at: [x, y, z]}: `from` and `to` are the
//   waypoints the leg lies between ({end: 'a'} or 'b' for a port), `at` where
//   it enters the body, in mm;
// - `detours`: per leg that was taken round a body, {between: [from, to],
//   points};
// - `bends`: each corner of the path with less room than the cable's
//   installed bend radius (#973, section 3.4), as {kind: 'tight-bend', cable,
//   point, between: [from, to], at: [x, y, z], angle_deg, legs_mm: [in, out],
//   room_mm, need_mm, short_mm}: `point` is the path point's `at`, `between`
//   the waypoints the corner lies between (as for a crossing), `room_mm` the
//   largest bend its legs leave it (route-path.js cornersOf, a leg between
//   two corners shared by what each needs of it), `need_mm` the cable's
//   radius (`ctx.bendOf(cable)`, else its media's) and `short_mm` the miss.
//   Corners at one point are one finding (#1007, mergeCorners below).
//   The path is laid to leave none (the approach points, lead points and
//   detours below, and no hang that would make one), so what is here is a
//   bend the kit's rules found no room for: often the parts leave none, but
//   a finding does not prove that no other lay would have it;
// - `covers`: each port a span of the path passes in front of (#1013,
//   section 1.7), as {kind: 'port-behind-span', cable, item, path, view,
//   between: [from, to], at: [x, y, z], judged, estimated?}: the port's
//   device, path and view, the waypoints the span lies between (as for a
//   crossing) and where it comes over the port, in mm; `judged` is 'all' or
//   'cabled', which ports were there to judge, and `estimated: true` marks a
//   port taken at the estimated box (portBoxesOn, above). Only a span with
//   no pathway at either end is judged, from a port to a lane or to the
//   other port: that is the span no manager carries. The cable's own two
//   ports are never listed, nor is a port beside one of them (within the
//   cable's bend radius, on the same panel: `beside`, below), and a port is
//   listed once;
// - `rests`: what the cable lies on (docs/cable-lay-design.md section 3):
//   {kind: 'ring', item, via} for a ring on a tray whose sill holds it;
//   {kind: 'tray', item, via, face, role, ties?} for a tray it runs along or
//   lands on, `face` 'top' or 'underside' in the frame of the part, `role`
//   'resting' (the face that looks up) or 'held' (the face that looks down,
//   strapped: `ties`, the indices of the tie slots it uses); and {kind:
//   'body', item, part} for a body a free span comes to rest on.
// RESTING (section 3): a ring on a tray whose catalogue entry places its
// opening holds the cable on its sill, its centre the cable's radius above
// the opening's lowest inside edge, at the side of the opening nearer the
// rail (a cable on its own; the lay of several is step 5); a tray named as a
// waypoint is laid along its run between its neighbours, on the floor at the
// cable's radius, or on the held face where the page pins it there
// (`ctx.trayFaceOf(cable, {item, via})` gives the face, `top` or
// `underside`, and the tray offers it: it has tie slots); and every leg that
// is not held - not a plug, not inside a ring, not a lane's run along the
// frame, not a tray's stretch, not into or out of a detour - is a free span,
// and hangs by the drape of the cable's family (resting.js), landing on any
// surface it would otherwise pass below. `ctx.bendOf(cable)`, when the page
// gives it, is the installed bend radius no curve of a span is tighter than
// (over its drape), and the radius the path's turns are given room for
// (#973); else its media's (resting.js BEND). The drape is the
// family's: its type's when the page gives `ctx.typeOf(id)` (cable-types.js),
// else its media's.
// DETOURS (section 1.3): where a straight leg between two points would cross
// a solid (solids.js solidsOf), points are added that take it round, over the
// near edge first, then round the end, then by a side lane (solids.js
// detour). They are computed, never stored, and they are in `points`
// (`at: 'detour'`), so the length counts them. A leg the rules cannot clear
// is left as drawn and is in `crossings`. The cable's diameter, which a
// pass-through must fit and a detour keeps clear by, is `ctx.diameterOf(cable)`
// when the page gives it, else its media's typical one (DIAMETERS).
// null when either port is not found on its drawing, as for routedLength.
//
// ONE LAY, WHICHEVER END IS WRITTEN FIRST (#986). The lay reads a path from
// its start: cornersOf merges slight turns from the first point, a detour
// goes round the first body it meets, a span at a plug hangs at one end and
// not the other, and each offer at a ring is judged by corners counted from
// the start. So the same cable written end for end could be laid another
// way, measure another length and report other bends. Rather than make each
// of those rules blind to direction, the cable is laid from BOTH ends, as
// written and as its twin (the same cable with its ends exchanged, on the
// same route reversed, the result turned round by turnPath), and one lay is
// kept by a rule that does not know which end was written first: the one
// that crosses fewer bodies, then the one whose corners are less short of
// room in all, then the shorter, and on a tie the one laid from the end
// whose port sorts first (endOrder, by item, then view, then path, which no
// writing of the cable changes). So no cable is laid worse than it was from
// its end a, and every reader still gets a path from its own end a to its
// own end b. Which lay was kept is kept per rack, context and cable, as the
// room is. The page's readers (`plugReachOf`, `trayFaceOf`, `bendOf`,
// `diameterOf`) are handed the twin when it is the twin that is laid: the
// same id, media and type, `a` and `b` exchanged.
export function routePath(rack, cable, ctx) {
  let twin = twins.get(cable);
  if (!twin) twins.set(cable, twin = {...cable, a: cable.b, b: cable.a});
  const asWritten = () => layPath(rack, cable, ctx, null);
  const asTwin = () => { const p = layPath(rack, twin, ctx, [...resolveRoute(rack, cable, ctx).waypoints].reverse()); return p && turnPath(p); };
  const keyed = ctx !== null && typeof ctx === 'object';
  let per = wayMemo.get(rack);
  if (!per) wayMemo.set(rack, per = new WeakMap());
  let byCable = keyed ? per.get(ctx) : null;
  if (keyed && !byCable) per.set(ctx, byCable = new WeakMap());
  const known = byCable?.get(cable);
  if (known) return known === 'twin' ? asTwin() : asWritten();
  const p = asWritten();
  if (!p) return null;
  const q = asTwin();
  const score = x => [x.crossings.length, x.bends.reduce((m, f) => m + f.short_mm, 0), pathLength(x).measured];
  const sp = score(p), sq = score(q);
  // a tenth of a millimetre of room, a micron of length: under that is a tie
  const tol = [0, 0.05, 1e-6];
  let pick = endOrder(cable.a, cable.b) <= 0 ? 'written' : 'twin';
  for (let i = 0; i < 3; i++) if (Math.abs(sp[i] - sq[i]) > tol[i]) { pick = sp[i] < sq[i] ? 'written' : 'twin'; break; }
  byCable?.set(cable, pick);
  return pick === 'twin' ? q : p;
}
// a cable's twin, kept so that what is decided for it (roomMemo) is kept too
const twins = new WeakMap();
// which lay of a cable was kept, per rack and context
const wayMemo = new WeakMap();
// Which end a cable is laid from: negative when `a` sorts before `b`. Two
// ends on one port (never a real cable) are laid as written.
const endKey3 = e => [String(e?.item ?? ''), e?.view === 'rear' ? 'rear' : 'front', String(e?.path ?? '')];
function endOrder(a, b) {
  const p = endKey3(a), q = endKey3(b);
  for (let i = 0; i < 3; i++) { const d = p[i].localeCompare(q[i], 'en', {numeric: true}); if (d) return d; }
  return 0;
}
// A path laid from end b, as its cable reads it from end a: the points in the
// other order, each port, reach and lead point given its other end, a ring's
// entry and exit exchanged and its sense turned; the rings, findings, marks
// (reverseMarks), detours, bends and covers in the other order, each
// `between` the other way round with its ends renamed, a bend's legs
// exchanged. A crossing's and a cover's `at` stay where the lay found them:
// where the path meets the body or the port, from the end it was laid from.
function turnPath(path) {
  const other = e => (e === 'a' ? 'b' : e === 'b' ? 'a' : e);
  const AT = {a: 'b', b: 'a', entry: 'exit', exit: 'entry'};
  const ref = w => (w && w.end ? {...w, end: other(w.end)} : w);
  const between = bt => [ref(bt[1]), ref(bt[0])];
  const rev = list => [...list].reverse();
  return {...path,
    points: rev(path.points).map(p => ({...p, at: AT[p.at] ?? p.at, ...(p.end ? {end: other(p.end)} : {})})),
    rings: rev(path.rings).map(g => (g.passed ? {...g, sense: -g.sense, entry: g.exit, exit: g.entry} : g)),
    findings: rev(path.findings),
    marks: reverseMarks(path.marks),
    crossings: rev(path.crossings).map(c => ({...c, between: between(c.between)})),
    detours: rev(path.detours).map(d => ({between: between(d.between), points: rev(d.points)})),
    bends: rev(path.bends).map(f => ({...f, between: between(f.between), legs_mm: rev(f.legs_mm)})),
    covers: path.covers.map(c => ({...c, between: between(c.between)})),
    rests: path.rests};
}
// The lay itself, from the cable's end a; `given` is the route to lay it on
// (a twin's: its cable's route reversed), else the cable's own.
function layPath(rack, cable, ctx, given) {
  const a = portPoint(rack, cable.a, ctx), b = portPoint(rack, cable.b, ctx);
  if (!a || !b) return null;
  const diameter = cableDiameter(cable, ctx), r = diameter / 2;
  // each port, then its plug's reach point (section 1.5): the first and last
  // legs of the route start there; a plug of no reach adds no point. The leg
  // from a port to its reach point is the plug: straight, and not a span.
  const ra = plugReach(cable, cable.a, ctx), rb = plugReach(cable, cable.b, ctx);
  const stops = [{p: a, at: 'a'}];
  if (ra > 0) stops.push({p: reachPoint(rack, cable.a, a, ra), at: 'reach', end: 'a', hold: true});
  const wps = given ?? resolveRoute(rack, cable, ctx).waypoints;
  const marks = wps.map(() => null);
  const rests = [];
  const rested = (o) => { if (!rests.some(x => x.kind === o.kind && x.item === o.item && (x.via ?? x.part) === (o.via ?? o.part))) rests.push(o); };
  wps.forEach((w, i) => {
    let p = pointOf(rack, w, ctx);
    if (!p) return;
    const g = w.lane ? null : ctx.guidesOf(w.item).find(x => x.via === w.via);
    const tray = !w.lane && !g ? trayOf(rack, w, ctx) : null;
    if (tray) { stops.push({p, w, i, tray}); return; }
    const ring = ringOf(g);
    // A RING ON A TRAY HOLDS THE CABLE ON ITS SILL (section 3): its centre
    // comes down to the lowest inside edge of its opening as mounted, plus
    // the cable's radius, and across its run to the side of the opening
    // nearer the rail the part is fixed to, where a cable on its own lies
    // (position 1, section 4; the lay of several is step 5); a ring whose
    // contract does not place its opening stays where its drawing puts it.
    const open = ring && ringOpening(rack, w, ctx);
    if (open) {
      p = {...p, y: open.box.y0 + r, ...(open.run === 'x' ? {z: railSide(open.box.z0, open.box.z1, railZOf(rack, w.item), r)}
        : {x: (open.box.x0 + open.box.x1) / 2})};
      rested({kind: 'ring', item: w.item, via: w.via});
    }
    stops.push({p, w, i, ring, ...(open ? {open} : {}), ...(w.lane ? {lane: true} : {})});
  });
  if (rb > 0) stops.push({p: reachPoint(rack, cable.b, b, rb), at: 'reach', end: 'b'});
  stops.push({p: b, at: 'b', hold: rb > 0});
  // A TRAY a route names is laid along its run between its neighbours (section
  // 2.1): from where the point before it comes onto the tray to where the
  // point after it leaves, each taken square onto the floor. On the face that
  // looks up it lies on the floor and through the rings standing on it; on
  // the held face, strapped under the plate (heldStretch). The face is the
  // one the page pins (`ctx.trayFaceOf(cable, waypoint)`, `top` or
  // `underside`, named in the frame of the part), where the tray offers it;
  // otherwise the face that looks up. The automatic face is step 5.
  for (let k = stops.length - 1; k >= 0; k--) {
    const s = stops[k];
    if (!s.tray) continue;
    const prev = stops[k - 1]?.p ?? s.p, next = stops[k + 1]?.p ?? s.p;
    const laid = alongTray(rack, s.tray, prev, next, cable, ctx, r);
    rested({kind: 'tray', item: s.w.item, via: s.w.via, face: laid.face, role: laid.role, ...(laid.ties ? {ties: laid.ties} : {})});
    stops.splice(k, 1, ...laid.points.map((p, j) => ({p, w: s.w, i: s.i, trayAt: true, hold: j > 0 && laid.hold[j]})));
  }
  // a ring holds a cable that reaches just into it (route-path.js, HELD):
  // how near depends on the cable's diameter, and it holds only from a port:
  // the port stops and their reach points are the only stops without `w`, so
  // `!stops[k ± 1].w` says the neighbour is a port's (a ring is never first or
  // last, so both neighbours exist)
  const {points, passes, back} = throughRings(stops.map(s => s.p), stops.map((s, k) => (s.ring
    ? {...s.ring, diameter, portBefore: !stops[k - 1].w, portAfter: !stops[k + 1].w} : null)));
  // Label each point with what it is: walk the stops, a ring taking two points when passed.
  // `hold` on a point says the leg into it is not a free span: the plug, the
  // stretch inside a ring, a lane's run along the frame, a tray's stretch.
  const passAt = new Map(passes.map(x => [x.index, x])), backAt = new Map(back.map(x => [x.index, x]));
  // `need` is the cable's installed bend radius, what its corners are judged
  // against; `bend` is the radius the lay is opened out for (#973), the same
  // up to ROOM_MAX: a stiffer cable is laid as one of that radius, and its
  // corners are reported against its own.
  const need = bendOf(cable, ctx), bend = Math.min(need, ROOM_MAX), base = r + CLEAR;
  // the corners of a run of points short of the cable's installed bend
  // radius, a shared leg shared by need (route-path.js cornersOf)
  const tightOf = pts => cornersOf(pts, {share: 'need'}).filter(c => c.room_mm < need - 1e-9);
  // Round the solid bodies (section 1.3), then what still crosses one (1.4).
  // A ring's parts are met by the cable's tube (solids.js legCrossings, #968).
  const solids = solidsOf(rack, ctx);
  // the side lanes at a height, where laneXAt puts them (rule 3 of 1.3)
  const lanesAt = y => {
    const ru = Math.max(1, Math.min(rack.frame.heightRU, Math.floor(y / RU) + 1));
    return [...new Set(lanesOf(rack.frame).map(l => laneXAt(rack, l, ru, ctx?.chassisOf)))];
  };
  const ref = k => (stops[k].w ? (stops[k].w.lane ? {lane: stops[k].w.lane, ru: stops[k].w.ru} : {item: stops[k].w.item, via: stops[k].w.via})
    : {end: stops[k].end ?? stops[k].at});
  // IN FRONT OF A ZERO-U PART (section 1.3, rule 4): the space its outward
  // face looks into, where a PDU's plugs stand, is the last way round it. A
  // leg that would graze the part is taken behind it (solids.js detour), but
  // one that clears it by more than the tube is not a crossing, so nothing
  // there stops a point moved for a bend's room (#973) from freeing a leg to
  // run across that face. `aheadOf` gives the legs of a run of points that
  // pass through that space; no point moved for room may add one, and no
  // hang may: the space is as high as the part, so a span that passes just
  // over the part's top, in front of its face, would sag down into it.
  const fronts = solids.filter(x => x.zeroU === true).map(x => ({item: x.item, part: 'front', holes: [],
    box: {x0: x.box.x0 - r, x1: x.box.x1 + r, y0: x.box.y0 - r, y1: x.box.y1 + r,
      z0: x.away === -1 ? -1e6 : x.box.z1, z1: x.away === -1 ? x.box.z0 : 1e6}}));
  const aheadOf = pts => { const at = []; for (let k = 1; fronts.length && k < pts.length; k++) if (legCrossings(pts[k - 1], pts[k], fronts).length) at.push(k); return at; };
  // THE TAUT PATH for the approach offsets `offs` (stop index -> [before the
  // ring, after it], mm from its band along the run): every stop's points,
  // then the detours between them. `own[i]` is the stop a taut point is of
  // (-1 for a detour point); `stuck` counts the legs no detour clears.
  const lay = (offs, leads = new Map(), runs = {}) => {
    const out = [], rings = [], findings = [], from = [], marks = wps.map(() => null);
    let n = 0;
    stops.forEach((s, k) => {
      const tag = s.w ? (s.w.lane ? {at: 'lane'} : {item: s.w.item, via: s.w.via}) : {at: s.at, ...(s.end ? {end: s.end} : {})};
      const hold = s.hold === true || (s.lane && stops[k - 1]?.lane === true);
      if (!s.ring) {
        // a RUN-OUT (#973, below): the cable goes on straight out of its plug
        // past the reach point, to a lead point its first turn is made at
        const run = s.at === 'reach' ? runs[s.end] ?? 0 : 0, pt = points[n++];
        const port = run > 0 ? (s.end === 'a' ? a : b) : null;
        const lead = port ? {x: pt.x, y: pt.y, z: pt.z + Math.sign(pt.z - port.z) * run, at: 'lead', end: s.end} : null;
        if (lead && s.end === 'b') { from.push(k); out.push(lead); }
        from.push(k);
        out.push({...pt, ...(s.w && !s.w.lane ? {at: s.trayAt ? 'tray' : 'pathway'} : {}), ...tag, ...(hold || (lead && s.end === 'b') ? {hold: true} : {})});
        if (lead && s.end === 'a') { from.push(k); out.push({...lead, hold: true}); }
        return;
      }
      const ring = {item: s.w.item, via: s.w.via, ...s.ring};
      const pass = passAt.get(k);
      if (pass) {
        const entry = points[n++], exit = points[n++];
        // A RING WHOSE OPENING IS PLACED IS SOLID ROUND IT (#968): the cable
        // comes to it along its run from an APPROACH POINT outside the band, at
        // the opening's height and across position, and leaves to another past
        // its far face, each clear of the band by at least the cable's radius
        // and CLEAR (`offs`: further, where the route turns there, below), so
        // whatever reaches the ring (a detour, a hang, a leg from behind or
        // below) ends there and enters through the opening, never through a leg
        const a = s.ring.run, off = offs.get(k) ?? [base, base];
        const approach = s.open && a in entry ? [{...entry, [a]: entry[a] - pass.sense * off[0]}, {...exit, [a]: exit[a] + pass.sense * off[1]}] : null;
        // a LEAD POINT (#973, below): square to the approach point, where the
        // stop before the ring (or after it) stands along the run
        const lead = leads.get(k) ?? [false, false];
        const square = (nb, ap) => (nb && Math.abs(nb[a] - ap[a]) > 1e-6 ? {x: nb.x, y: nb.y, z: nb.z, [a]: ap[a], ...tag, at: 'lead'} : null);
        const before = approach && lead[0] ? square(out[out.length - 1], approach[0]) : null;
        const after = approach && lead[1] ? square(points[n], approach[1]) : null;
        if (before) { from.push(k); out.push(before); }
        if (approach) { from.push(k); out.push({...approach[0], ...tag, at: 'approach'}); }
        from.push(k, k);
        out.push({...entry, ...tag, at: 'entry', ...(approach ? {hold: true} : {})}, {...exit, ...tag, at: 'exit', hold: true});
        if (approach) { from.push(k); out.push({...approach[1], ...tag, at: 'approach', hold: true}); }
        if (after) { from.push(k); out.push(after); }
        rings.push({...ring, passed: true, ...(pass.held ? {held: true} : {}), sense: pass.sense, entry: pass.entry, exit: pass.exit});
        marks[s.i] = {run: s.ring.run, depth: s.ring.depth, sense: pass.sense, back: false};
      } else {
        const no = backAt.get(k);
        // a cable taken to a solid ring's face and back (a finding) stops at
        // the approach point before that face, not on it: the face is the
        // mouth of the opening, and a leg that turned there would graze the
        // ring's legs and seat (#968)
        const a = s.ring.run, at = points[n++];
        const face = s.open && a in at ? {...at, [a]: at[a] - no.sense * base} : at;
        from.push(k);
        out.push({...face, ...tag, at: 'face'});
        rings.push({...ring, passed: false, sense: no.sense, face: at});
        marks[s.i] = {run: s.ring.run, depth: s.ring.depth, sense: no.sense, back: true};
        findings.push({kind: 'doubles-back', cable: cable.id, item: s.w.item, via: s.w.via});
      }
    });
    // the detours leave each end's move to a plane room for two bends (#973,
    // solids.js detour): twice the installed bend radius, or `runs.room`
    // where two right angles' worth is not enough (below)
    const taut = [out[0]], tautLegs = [], detours = [], own = [from[0]];
    let stuck = 0;
    for (let k = 1; k < out.length; k++) {
      const between = [ref(from[k - 1]), ref(from[k])];
      const extra = solids.length ? detour(out[k - 1], out[k], solids, {diameter, lanes: lanesAt, room: runs.room ?? 2 * bend}) : [];
      if (extra === null) stuck++;
      if (extra?.length) {
        detours.push({between, points: extra.map(p => ({x: p.x, y: p.y, z: p.z}))});
        for (const p of extra) { tautLegs.push(between); own.push(-1); taut.push({x: p.x, y: p.y, z: p.z, at: 'detour'}); }
      }
      tautLegs.push(between);
      own.push(from[k]);
      taut.push(out[k]);
    }
    return {rings, findings, marks, taut, tautLegs, detours, own, stuck, ahead: aheadOf(taut)};
  };
  // ROOM AT A RING (#973, section 3.4). An approach point is where a cable
  // comes onto a ring's run, and where it turns onto it: the stretch from
  // there through the ring is the leg that turn bends in, and the radius
  // plus CLEAR of #968 left a right angle about a fifth of the leg its bend
  // radius needs. So, on each side of a ring where the route turns (the stop
  // before or after it does not stand on the run through the ring), the
  // approach point stands the installed bend radius from the band; where
  // two rings follow each other along one run, no further than half way
  // between their bands, and never in or past the band of another ring of
  // the same part. A side the route passes straight through keeps the
  // radius and CLEAR.
  // That is where every path starts. Where a corner between a ring and the
  // stop beside it is still short of room by the kit's own measure
  // (cornersOf, a leg shared by need), these are on offer, each tried by
  // laying the path with it (`offers`, below):
  // - the stop stands back along the run from the approach point, on the
  //   ring's side of it, so the cable turns back on itself to face the ring.
  //   That takes two bends, and two bends share a leg: the approach point
  //   moves out to stand two bend radii past that stop along the run;
  // - the same, and the cable LED SQUARE: along the run, level with that
  //   stop, to a lead point (`at: 'lead'`) beside the approach point, and
  //   from there square onto the run, so that one turn of more than a right
  //   angle is two of a right angle each;
  // - a detour between them comes back beside itself (out past a tray's
  //   edge, up and back in): the approach point stands just far enough along
  //   the run, to either side of the stop, for the leg between the detour's
  //   two turns, and there it may stand nearer the band than the bend radius
  //   (never nearer than the radius and CLEAR);
  // - the two turns at the ring need more of the stretch through it than it
  //   is: the other side's approach point moves out by what is missing;
  // - the approach point back at the radius and CLEAR: a stop that stands
  //   almost over it turns onto the run with its own leg for room.
  // What a ring has no room for (the stop less than two radii from the run,
  // across it; a plug that reaches almost to the run; the next ring in the
  // way) is left as it is, and the corner is in `bends`.
  const offs = new Map(), leads = new Map(), faces = new Map();
  const unit = (u, v) => { const d = Math.hypot(v.x - u.x, v.y - u.y, v.z - u.z); return d > 1e-9 ? {x: (v.x - u.x) / d, y: (v.y - u.y) / d, z: (v.z - u.z) / d} : null; };
  const turnsAt = (u, v, a, sn) => { const d = u && v && unit(u, v); return !!d && Math.acos(Math.max(-1, Math.min(1, sn * d[a]))) * 180 / Math.PI > STRAIGHT_DEG; };
  {
    let n = 0;
    stops.forEach((s, k) => {
      const pass = s.ring ? passAt.get(k) : null;
      if (!pass) { n++; return; }
      const entry = points[n++], exit = points[n++], a = s.ring.run;
      if (!s.open || !(a in entry)) return;
      // how far along the run an approach point may stand from each face: up
      // to the next ring of the same part that way, less the radius and
      // CLEAR, so it never stands in or past another ring's band
      const others = traysOf(rack, ctx).filter(t => t.item === s.w.item).flatMap(t => t.rings).filter(o => o.via !== s.w.via && o.run === a);
      const free = [-pass.sense, pass.sense].map((dir, sd) => {
        const face = (sd ? exit : entry)[a];
        const gaps = others.map(o => (dir > 0 ? o.box[`${a}0`] - face : face - o.box[`${a}1`])).filter(g => g > 0);
        return Math.max(base, Math.min(...gaps, Infinity) - base);
      });
      const side = (nb, turns, face, sd) => {
        if (!nb || !turns) return base;
        // a ring next along the same run: half the way between the two bands
        const cap = nb.ring && nb.ring.run === a ? (Math.abs(face[a] - nb.p[a]) - nb.ring.depth / 2) / 2 : Infinity;
        return Math.max(base, Math.min(bend, cap, free[sd]));
      };
      const before = stops[k - 1], after = stops[k + 1];
      offs.set(k, [side(before, turnsAt(before?.p, entry, a, pass.sense), entry, 0), side(after, turnsAt(exit, after?.p, a, pass.sense), exit, 1)]);
      faces.set(k, {a, out: [-pass.sense, pass.sense], face: [entry[a], exit[a]], free});
    });
  }
  const shortOf = pts => tightOf(pts).reduce((m, c) => m + (need - c.room_mm), 0);
  const lengthOf = pts => pts.reduce((m, p, i) => (i ? m + dist(pts[i - 1], p) : 0), 0);
  const runs = {};
  let L = null;
  // What is decided below is decided once per rack, context and cable, as
  // the side of a route is (autoRoute): every reader of a path asks for it
  // again, and the search is the dear part.
  let per = roomMemo.get(rack);
  if (!per) roomMemo.set(rack, per = new WeakMap());
  let byCable = per.get(ctx);
  if (!byCable) per.set(ctx, byCable = new WeakMap());
  const known = byCable.get(cable);
  if (known) {
    offs.clear(); for (const [k, v] of known.offs) offs.set(k, v);
    for (const [k, v] of known.leads) leads.set(k, v);
    Object.assign(runs, known.runs);
    L = lay(offs, leads, runs);
  } else {
    L = lay(offs, leads, runs);
    // an approach point that stands out at the bend radius must not free its
    // leg to run in front of a zero-U part (above): where it does, that side
    // of the ring keeps the radius and CLEAR, and its corner is in `bends`
    if (L.ahead.length) {
      const L0 = lay(new Map(), leads, runs);
      if (L.ahead.length > L0.ahead.length) {
        for (const i of L.ahead) for (const [k, side] of [[L.own[i - 1], 1], [L.own[i], 0]])
          if (offs.has(k)) { const o = [...offs.get(k)]; o[side] = base; offs.set(k, o); }
        L = lay(offs, leads, runs);
        if (L.ahead.length > L0.ahead.length) { offs.clear(); L = L0; }
      }
    }
    let short = shortOf(L.taut);
    // One change tried: laid, and kept (as the best so far) when it leaves
    // the path's corners less short of room in all, puts no leg newly through
    // a body or in front of a zero-U part, and either leaves no corner of
    // `region` (the stretch it is for) short or makes the path no longer: a
    // cable is not sent a longer way round to make a short corner less short.
    const better = ({o = offs, l = leads, r = runs, region}, best) => {
      const L2 = lay(o, l, r), s2 = shortOf(L2.taut), len = lengthOf(L2.taut);
      if (L2.stuck > L.stuck || L2.ahead.length > L.ahead.length || !(s2 < short - 1e-9) || (region(L2) && len > lengthOf(L.taut) + 1e-9)) return best;
      return !best || s2 < best.s - 1e-9 || (s2 < best.s + 1e-9 && len < best.len - 1e-9) ? {L: L2, s: s2, len, o, l, r} : best;
    };
    const put = (map, k, side, v) => { const m = new Map(map); const o = [...(m.get(k) ?? [false, false])]; o[side] = v; m.set(k, o); return m; };
    // Every change on offer for the path as it stands (the rules above and
    // ROOM AT A PLUG, below).
    const offers = () => {
      const list = [], tight = tightOf(L.taut);
      for (const k of offs.keys()) for (const side of [0, 1]) {
        const cur = offs.get(k)[side], f = faces.get(k);
        if (cur < bend - 1e-9) continue;
        // the stretch this approach point's leg is part of: from the stop
        // before the ring to the ring, or from the ring to the stop after it
        // (the approach point itself: the one before the ring's entry, or after its exit)
        const apOf = (T, sd) => T.taut.findIndex((p, i) => T.own[i] === k && p.at === (sd ? 'exit' : 'entry')) + (sd ? 1 : -1);
        const within = T => {
          const ap = apOf(T, side), lo = side ? ap : T.own.lastIndexOf(k - 1), hi = side ? T.own.indexOf(k + 1) : ap;
          return lo < 0 || hi < 0 ? null : [lo, hi];
        };
        const region = T => { const w = within(T); return !!w && tightOf(T.taut).some(c => c.k >= w[0] && c.k <= w[1]); };
        const w = within(L);
        if (!w || !tight.some(c => c.k >= w[0] && c.k <= w[1])) continue;
        const [lo, hi] = w;
        // how far out of the band, along the run, that stop stands
        const nb = L.taut[side ? hi : lo], d = f.out[side] * (nb[f.a] - f.face[side]);
        if (d < cur + 2 * bend - 1e-6 && d + 2 * bend <= f.free[side] + 1e-9) {
          const o2 = put(offs, k, side, Math.max(cur, d + 2 * bend));
          list.push({o: o2, region}, {o: o2, l: put(leads, k, side, true), region});
        }
        if (d < cur + 2 * bend - 1e-6) {
          // a detour that comes back beside itself there (out past a tray's
          // edge, up, and back in): the leg between its two turns is as long
          // as the stop and the approach point are apart, along the run and
          // across it, and needs two radii; so the approach point may stand
          // just far enough along the run to either side of the stop
          const t = tight.filter(c => c.k >= lo && c.k <= hi && L.taut[c.k].at === 'detour');
          const pair = t.find((c, i) => t[i + 1]?.k === c.k + 1);
          if (pair) {
            const p0 = L.taut[pair.k], p1 = L.taut[pair.k + 1], along = Math.abs(p1[f.a] - p0[f.a]), across2 = dist(p0, p1) ** 2 - along ** 2;
            const step = across2 < 4 * bend * bend ? Math.sqrt(4 * bend * bend - across2) + 0.5 : 0;
            for (const v of [d - step, d + step]) if (step > 0 && v >= base && v <= f.free[side] + 1e-9) list.push({o: put(offs, k, side, v), region});
          }
        }
        // the approach point back at the radius and CLEAR: a stop that stands
        // almost over it turns onto the run with its own leg for room, and a
        // point moved out past it would make the cable come back for it
        if (cur > base + 1e-9) list.push({o: put(offs, k, side, base), region});
        // the two turns' share of the stretch through the ring: what they
        // need of it over what it is, given to the other side
        const cs = cornersOf(L.taut, {share: 'need'}), tanAt = i => { const c = cs.find(x => x.k === i); return c ? Math.tan(c.angle_deg * Math.PI / 360) : 0; };
        const other = offs.get(k)[1 - side], lack = bend * (tanAt(apOf(L, 0)) + tanAt(apOf(L, 1))) - (cur + other + Math.abs(f.face[1] - f.face[0]));
        if (lack > 1e-6 && Number.isFinite(lack) && other + lack + 0.5 <= Math.min(2 * bend, f.free[1 - side])) list.push({o: put(offs, k, 1 - side, other + lack + 0.5), region});
      }
      // ROOM AT A PLUG (#973, section 3.4). A cable leaves its plug straight
      // (1.5), and the plug's reach is the leg its first turn has on that
      // side. Where that turn is short of room (a fibre cord's 27.6 mm plug,
      // turning back past a right angle to a lane on the rail plane), the
      // cable runs on straight out of the plug, half a bend radius, one or
      // one and a half further, to a lead point (`at: 'lead'`, with its
      // `end`), and turns there.
      for (const end of ['a', 'b']) {
        const region = T => { const t = tightOf(T.taut); return T.taut.some((p, i) => p.end === end && (p.at === 'reach' || p.at === 'lead') && t.some(c => c.k === i)); };
        if (!L.taut.some((p, i) => p.end === end && (p.at === 'reach' || p.at === 'lead') && tight.some(c => c.k === i))) continue;
        for (const m of [0.5, 1, 1.5]) if (m * bend > (runs[end] ?? 0) + 1e-9) list.push({r: {...runs, [end]: m * bend}, region});
      }
      // ROOM ROUND A BODY. A detour's planes stand two bend radii from each
      // end, the share of two right angles; where a detour is pulled taut its
      // turn can be wider than a right angle, and a corner at a detour point
      // still short of room is offered two and a half and three radii
      const atDetour = T => tightOf(T.taut).some(c => T.taut[c.k].at === 'detour');
      if (tight.some(c => L.taut[c.k].at === 'detour'))
        for (const m of [2.5, 3]) if (m * bend > (runs.room ?? 2 * bend) + 1e-9) list.push({r: {...runs, room: m * bend}, region: atDetour});
      return list;
    };
    // The best change on offer is made, and the offers are drawn up again,
    // until none helps or six have been made: the best of all of them each
    // time, whichever end of the cable they are nearer. That takes the order
    // of the ends out of the choice; it does not by itself make a cable
    // written the other way round lay the same. What each offer is judged by
    // still reads the path from its start (cornersOf merges slight turns
    // from there, a detour goes round the first body it meets), and two
    // offers can differ by less than that: routePath lays the cable from
    // both ends and keeps one (#986).
    for (let round = 0; round < 6 && short > 0; round++) {
      let best = null;
      for (const c of offers()) best = better(c, best);
      if (!best) break;
      const o = new Map(best.o), l = new Map(best.l);
      offs.clear(); for (const [k, v] of o) offs.set(k, v);
      leads.clear(); for (const [k, v] of l) leads.set(k, v);
      Object.assign(runs, best.r);
      L = best.L; short = best.s;
    }
    byCable.set(cable, {offs: new Map(offs), leads: new Map(leads), runs: {...runs}});
  }
  const {rings, findings, taut, tautLegs, detours} = L;
  for (let i = 0; i < marks.length; i++) marks[i] = L.marks[i];
  // RESTING (section 3): every leg that is not held is a free span, and hangs
  // by the drape of the cable's family, landing on whatever surface it would
  // otherwise pass below (resting.js hang). A leg into or out of a detour
  // point is not: a cable taken round an edge is dressed round it by hand
  // (section 1.3), taut, so it stays clear by what the detour keeps. A sag
  // that would carry the cable into a body its straight leg did not cross is
  // not laid, and nor is one that would leave a corner of the path, the
  // span's own or where it meets what holds it, less room than the straight
  // span leaves it (#973, resting.js hang `fits`). Each span is judged with
  // every other span straight, so no span's hang waits on another's; and
  // where two spans that meet at a point each fit alone and together leave
  // that point short, neither hangs. Which end the path is laid from can
  // still matter here: the corners a hang is judged by are counted from its
  // start (cornersOf), so the same span can hang laid one way and not the
  // other; routePath lays both and keeps one (#986).
  const surfaces = surfacesOf(rack, ctx);
  const drape = drapeOf(cable, ctx);
  const hung = taut.map(() => null);
  // the room each point of the taut path has as a corner (none: all it needs)
  const roomAt = new Map(cornersOf(taut, {share: 'need'}).map(c => [c.k, c.room_mm]));
  const kept = i => Math.min(roomAt.get(i) ?? Infinity, need);
  for (let k = 1; k < taut.length; k++) {
    const p = taut[k - 1], q = taut[k];
    if (q.hold || p.at === 'detour' || q.at === 'detour') continue;
    const head = taut.slice(0, k), tail = taut.slice(k);
    // no point of the hang is itself a corner short of room, and no corner
    // of the path is left less room than it has with the span straight (or
    // than it needs, where it has more)
    const fits = pts => {
      if (newCrossing(p, q, pts, solids, diameter)) return false;
      // nor may it sag into the space in front of a zero-U part that the
      // straight span passes over: that space ends at the part's top
      if (fronts.length && aheadOf([p, ...pts, q]).length && !aheadOf([p, q]).length) return false;
      const i0 = head.length, i1 = head.length + pts.length;
      return cornersOf([...head, ...pts, ...tail], {share: 'need'}).every(c => (c.k >= i0 && c.k < i1 ? c.room_mm >= need - 1e-9
        : c.room_mm >= kept(c.k < i0 ? c.k : c.k - pts.length) - 1e-9));
    };
    const h = hang(p, q, {r, drape, bend: need, surfaces, fits});
    if (h.points.length) hung[k] = h;
  }
  const strung = () => {
    const pts = [taut[0]], legOf = [], at = [0];
    for (let k = 1; k < taut.length; k++) {
      for (const pt of hung[k]?.points ?? []) { legOf.push(tautLegs[k - 1]); pts.push({x: pt.x, y: pt.y, z: pt.z, at: 'rest'}); }
      legOf.push(tautLegs[k - 1]);
      at.push(pts.length);
      pts.push(taut[k]);
    }
    return {pts, legOf, at};
  };
  let S = strung();
  for (let n = 0; n < taut.length; n++) {
    // the points left less room than that by two hangs together: the spans
    // either side of each go back to straight
    let cut = false;
    for (const c of cornersOf(S.pts, {share: 'need'})) {
      const k = S.at.indexOf(c.k);
      if (k < 0 ? c.room_mm >= need - 1e-9 : c.room_mm >= kept(k) - 1e-9) continue;
      for (const j of k < 0 ? S.at.map((v, i) => (v > c.k ? i : -1)).filter(i => i > 0).slice(0, 1) : [k, k + 1]) if (hung[j]) { hung[j] = null; cut = true; }
    }
    if (!cut) break;
    S = strung();
  }
  const final = S.pts, legs = S.legOf;
  for (const h of hung) for (const g of h?.lands ?? []) rested(g.tray ? {kind: 'tray', item: g.item, via: g.via, face: 'top', role: 'resting'}
    : {kind: 'body', item: g.item, part: g.part});
  for (const p of final) delete p.hold;
  const crossings = [];
  const r1 = v => Math.round(v * 10) / 10;
  for (let k = 1; k < final.length && solids.length; k++) {
    for (const x of legCrossings(final[k - 1], final[k], solids, {diameter})) {
      const dup = crossings.some(c => c.item === x.solid.item && c.part === x.solid.part
        && JSON.stringify(c.between) === JSON.stringify(legs[k - 1]));
      if (!dup) crossings.push({kind: 'crosses-body', cable: cable.id, item: x.solid.item, part: x.solid.part,
        between: legs[k - 1], at: [r1(x.at.x), r1(x.at.y), r1(x.at.z)]});
    }
  }
  // WHAT IS STILL TIGHT (#973, section 3.4): each corner of the path with
  // less room than the cable's installed bend radius, by the measure the
  // bundle check uses (cornersOf).
  // One finding a corner (#1007): corners at one point, to the tenth of a
  // millimetre a finding gives its place to, are one (mergeCorners).
  const bends = mergeCorners(final, tightOf(final)).map(c => ({kind: 'tight-bend', cable: cable.id, point: final[c.k].at,
    between: [legs[c.k - 1][0], (legs[c.k] ?? legs[c.k - 1])[1]], at: [r1(final[c.k].x), r1(final[c.k].y), r1(final[c.k].z)],
    angle_deg: c.angle_deg, legs_mm: c.legs_mm, room_mm: c.room_mm, need_mm: need, short_mm: r1(need - c.room_mm)}));
  // WHAT IT COVERS (#1013, section 1.7): with no manager a leg is a free span
  // from a lane to a port, or from port to port, across the faces of the
  // devices between; it crosses no body (only envelopes are solid, 1.1), so
  // nothing above reports it. Each port such a span passes in front of is
  // listed. A leg into or out of a pathway is not judged: a ring, a duct or
  // a tray is where the cord is meant to run, and the advice a finding gives
  // (add a manager) would not apply. Nor is a plug, which stands out of its
  // own port.
  // BESIDE ITS OWN PORT is not in front of another. A cable leaves its plug
  // straight and turns within its bend radius, so whatever way it goes it
  // passes over the ports that stand within that radius of its own: the
  // stacked partner of its port (the same column, the other row, some 11 to
  // 14 mm away) always, and a neighbour or two along the row. No manager
  // moves it off them. So a port on the same panel of the same device as one
  // of the cable's own, whose box comes within the cable's installed bend
  // radius of that own port's centre, is not listed (`beside`). What is left
  // is a span that runs on across a face.
  const covers = [];
  const ports = portBoxesOn(rack, ctx);
  if (ports.length) {
    const same = (e, p) => p.item === e.item && p.path === e.path && p.view === (e.view === 'rear' ? 'rear' : 'front');
    const plug = p => p.at === 'a' || p.at === 'b';
    const own = [cable.a, cable.b].map(e => ports.find(p => same(e, p))).filter(Boolean);
    const beside = port => own.some(o => o.item === port.item && o.view === port.view
      && Math.hypot(Math.max(port.x0 - o.x, 0, o.x - port.x1), Math.max(port.y0 - o.y, 0, o.y - port.y1)) <= need + 1e-9);
    for (let k = 1; k < final.length; k++) {
      const p = final[k - 1], q = final[k], between = legs[k - 1];
      if (between.some(w => w.item) || plug(p) || plug(q) || (p.end && p.end === q.end)) continue;
      for (const port of ports) {
        if (same(cable.a, port) || same(cable.b, port) || beside(port)) continue;
        if (covers.some(c => c.item === port.item && c.path === port.path && c.view === port.view)) continue;
        const at = legOver(p, q, port, r);
        if (at) covers.push({kind: 'port-behind-span', cable: cable.id, item: port.item, path: port.path, view: port.view,
          between, at: [r1(at.x), r1(at.y), r1(at.z)], judged: ports.judged, ...(port.estimated ? {estimated: true} : {})});
      }
    }
  }
  return {points: final, rings, findings, marks, crossings, detours, rests, bends, covers, allowance: endAllowance(cable), media: cable.media};
}

// CORNERS AT ONE POINT ARE ONE CORNER (#1007). Two points of a path can stand
// a fraction of a millimetre apart (a ring of almost no depth, a lead point
// almost on an approach point), and cornersOf, which skips only a point
// within a micron of the one before, gives a corner at each: two findings at
// one place, with two angles, where a reader sees one turn. This merges the
// corners of `corners` (cornersOf's, or some of them, in order) whose points
// are the same to a tenth of a millimetre, the precision a finding gives its
// `at` to: `k` is the first's, `angle_deg` the turn from the leg into the
// first to the leg out of the last, `legs_mm` the first's leg in and the
// last's leg out, and `room_mm` the least of theirs. A corner alone at its
// point is returned as it is. Not part of the kit's API: a path's `bends`
// are what a reader takes.
function mergeCorners(pts, corners) {
  const t1 = v => Math.round(v * 10) / 10;
  const key = p => `${t1(p.x)},${t1(p.y)},${t1(p.z)}`;
  const groups = [];
  for (const c of corners) {
    const g = groups.at(-1);
    if (g && key(pts[g.at(-1).k]) === key(pts[c.k])) g.push(c); else groups.push([c]);
  }
  return groups.map(g => {
    if (g.length === 1) return g[0];
    const first = g[0], last = g.at(-1), here = key(pts[first.k]);
    // the legs in and out: to the nearest point either side that is not this one
    let i = first.k - 1, j = last.k + 1;
    while (i > 0 && key(pts[i]) === here) i--;
    while (j < pts.length - 1 && key(pts[j]) === here) j++;
    const u = {x: pts[first.k].x - pts[i].x, y: pts[first.k].y - pts[i].y, z: pts[first.k].z - pts[i].z};
    const v = {x: pts[j].x - pts[last.k].x, y: pts[j].y - pts[last.k].y, z: pts[j].z - pts[last.k].z};
    const nu = Math.hypot(u.x, u.y, u.z), nv = Math.hypot(v.x, v.y, v.z);
    const angle = nu > 1e-6 && nv > 1e-6
      ? t1(Math.acos(Math.max(-1, Math.min(1, (u.x * v.x + u.y * v.y + u.z * v.z) / (nu * nv)))) * 180 / Math.PI)
      : Math.max(...g.map(c => c.angle_deg));
    return {k: first.k, angle_deg: angle, legs_mm: [first.legs_mm[0], last.legs_mm[1]], room_mm: Math.min(...g.map(c => c.room_mm))};
  });
}

// The rail plane an item is fixed to, as a z: the front rail's 0, or the
// rear rail's.
const railZOf = (rack, id) => planeZ(rack.frame, itemOf(rack, id)?.face === 'rear' ? 'rear' : 'front');
// A cable of radius r lying across [lo, hi] at the side nearer `rail`.
const railSide = (lo, hi, rail, r) => (Math.abs(lo - rail) <= Math.abs(hi - rail) ? lo + r : hi - r);

// The opening of a ring a waypoint names, where it stands on a tray whose
// catalogue entry places it ({run, box} in rack mm, solids.js traysOf), or null.
function ringOpening(rack, w, ctx) {
  for (const t of traysOf(rack, ctx)) {
    if (t.item !== w.item) continue;
    const o = t.rings.find(x => x.via === w.via);
    if (o) return o;
  }
  return null;
}

// A CABLE ALONG A TRAY (section 2.1), from `prev` to `next`: the points it is
// laid at, and which of them it reaches held (`hold[j]`: the leg into point j
// is part of the tray's stretch, not a free span), with the face it lies on.
// The stretch runs along the tray's run from the floor's square below `prev`
// to the square below `next`, each clamped to the floor.
function alongTray(rack, t, prev, next, cable, ctx, r) {
  const run = t.run, across = run === 'x' ? 'z' : 'x';
  const lo = Math.min(...t.floors.map(f => f[`${run}0`])), hi = Math.max(...t.floors.map(f => f[`${run}1`]));
  const clamp = v => Math.min(hi, Math.max(lo, v));
  const a = clamp(prev[run]), b = clamp(next[run]);
  // which face: the one the file pins (the `face` of the cable's `lay`
  // entry for this tray, rack file version 4), else the page's pin, where
  // the tray offers it (a held face needs tie slots along the stretch:
  // heldStretch is null without one), else the face that looks up
  let asked = layFaceOf(cable, t);
  if (asked == null)
    try { asked = typeof ctx?.trayFaceOf === 'function' ? ctx.trayFaceOf(cable, {item: t.item, via: t.via}) : null; } catch { asked = null; }
  const heldName = t.flipped ? 'top' : 'underside', restName = t.flipped ? 'underside' : 'top';
  const rail = railZOf(rack, t.item);
  if (asked === heldName) {
    const opts = {r, drape: drapeOf(cable, ctx), bend: bendOf(cable, ctx), rail};
    const h = heldStretch(t, a, b, opts);
    if (h) return {points: h.points, hold: h.points.map(() => true), face: heldName, role: 'held', ties: h.ties};
  }
  // the face that looks up: on the floor at the cable's radius, across the
  // tray at the side nearer the rail (position 1) of its rings' openings,
  // else of its largest floor rectangle; and through each ring standing
  // between the two ends, on its sill
  const opens = t.rings.filter(o => o.run === run);
  const f0 = t.floors.reduce((m, f) => ((f.x1 - f.x0) * (f.z1 - f.z0) > (m.x1 - m.x0) * (m.z1 - m.z0) ? f : m));
  const span = opens.length ? [Math.max(...opens.map(o => o.box[`${across}0`])), Math.min(...opens.map(o => o.box[`${across}1`]))]
    : [f0[`${across}0`], f0[`${across}1`]];
  const at = across === 'z' ? railSide(span[0], span[1], rail, r) : (span[0] + span[1]) / 2;
  const pt = (v, y) => (run === 'x' ? {x: v, y, z: at} : {x: at, y, z: v});
  const floorY = t.top + r;
  const points = [pt(a, floorY)], hold = [false];
  const between = opens.filter(o => Math.min(o.box[`${run}1`], Math.max(a, b)) > Math.max(o.box[`${run}0`], Math.min(a, b)) + 1e-6)
    .sort((p, q) => (a <= b ? p.box[`${run}0`] - q.box[`${run}0`] : q.box[`${run}0`] - p.box[`${run}0`]));
  // each ring from its approach point, clear of its band (#968), through its
  // opening on its sill, to the approach point past its far face. The
  // approach points are not clamped to the floor: they stand at the sill,
  // and a ring at the floor's end would have one pulled back into its band
  const dir = a <= b ? 1 : -1, off = r + CLEAR;
  for (const o of between) {
    const [near, far] = a <= b ? [o.box[`${run}0`], o.box[`${run}1`]] : [o.box[`${run}1`], o.box[`${run}0`]];
    const y = o.box.y0 + r;
    points.push(pt(near - dir * off, y), pt(clamp(near), y), pt(clamp(far), y), pt(far + dir * off, y));
    hold.push(false, true, true, true);
  }
  if (Math.abs(b - a) > 1e-6 || points.length > 1) { points.push(pt(b, floorY)); hold.push(false); }
  return {points, hold, face: restName, role: 'resting'};
}

// A cable's outside diameter in mm, for what it must fit and keep clear by:
// the page's `ctx.diameterOf(cable)` (the cable types table, #919: its
// diameterLookup), else its media's typical one.
// A TABLE KEYED BY MEDIA IS READ BY ITS OWN KEYS ONLY: a cable whose media is
// named like something every object has (`constructor`) is a media the table
// does not know, never the function of that name.
const ownMedia = (table, media) => (typeof media === 'string' && Object.hasOwn(table, media) ? table[media] : undefined);
const cableDiameter = (cable, ctx) => {
  const d = typeof ctx?.diameterOf === 'function' ? ctx.diameterOf(cable) : null;
  return typeof d === 'number' && d > 0 ? d : ownMedia(DIAMETERS, cable?.media) ?? UNSET_D;
};

// The marks of a path drawn from its other end, for its points reversed: the
// list reversed, and each ring passed turned to the other sense. A ring not
// passed keeps its sense, which names the face both its neighbours are on.
export const reverseMarks = marks => [...marks].reverse()
  .map(m => (m && (m.sense === 1 || m.sense === -1) && m.back !== true ? {...m, sense: -m.sense} : m));

// MARKS FOR A DRAWING'S OWN AXES. A mark's `sense` is along the rack's axes:
// x right as seen from the front, y up, z out of the front. A drawing whose
// axis runs the other way says so, and each ring on that axis, passed or
// doubled back, has its sense turned: an SVG elevation has y down ({y: -1});
// the rear pane is also seen mirrored ({x: -1, y: -1}); the 3D scene is in
// the rack's own axes and passes its marks unchanged.
export const orientMarks = (marks, flip = {}) => marks.map(m => (m && (m.sense === 1 || m.sense === -1)
  && flip[m.run] === -1 ? {...m, sense: -m.sense} : m));

// THE RING MARKS A DRAWING PASSES ON, parallel to resolveRoute(rack, cable,
// ctx).waypoints: null for a lane, a duct or a pass-through, and for a ring
// routePath's decision, {run, depth, sense, back}, in the rack's axes (a
// drawing that flips one passes them through orientMarks). Drop them in step
// with any waypoint the drawing cannot place. When a port is not found there is no
// decision, and a ring's mark is {run, depth} alone: the drawing then decides
// it from its own points.
export function ringMarks(rack, cable, ctx) {
  const path = routePath(rack, cable, ctx);
  if (path) return path.marks;
  return resolveRoute(rack, cable, ctx).waypoints.map(w => {
    const g = w.lane ? null : ringOf(ctx.guidesOf(w.item).find(x => x.via === w.via));
    return g ? {run: g.run, depth: g.depth} : null;
  });
}

// A path's length, as routedLength gives it, in metres: `value`, the stock
// size chosen; `need`, what a cord of that size must at least be; and
// `measured`, the need and the end play at both ends, which is the figure a
// routed length was before version 4 and is still what two lays are compared
// by. `values` is what the cable's slack entries state, which the size has
// to hold too. The path carries its cable's media and what is inside each
// port (routePath's `media` and `allowance`); a path built by hand without
// them takes a cable with no media's.
export function pathLength(path, {values = 0} = {}) {
  if (!path) return null;
  const cable = {media: path.media};
  const base = pathMetres(path) + 2 * (typeof path.allowance === 'number' ? path.allowance : endAllowance(cable));
  const value = chooseStock(s => base + shortTolerance(cable, s), values);
  const need = base + shortTolerance(cable, value);
  return {measured: need + 2 * END_PLAY_M, value, need};
}
export const routedLength = (rack, cable, ctx) => pathLength(routePath(rack, cable, ctx), {values: slackValues(cable)});

// A length in metres, or null: only metres and feet convert.
const M_PER = {m: 1, ft: 0.3048};
export const toMetres = (value, unit) => (typeof value === 'number' && Number.isFinite(value) && Object.hasOwn(M_PER, unit ?? 'm')
  ? value * M_PER[unit ?? 'm'] : null);
// What the slack entries of a cable state, added up, in metres.
export const slackValues = cable => (Array.isArray(cable?.slack) ? cable.slack : [])
  .reduce((sum, e) => sum + (toMetres(e?.value, e?.unit) ?? 0), 0);
// THE FACE A CABLE IS PINNED TO on one tray, from its `lay` list as the file
// has it: `top` or `underside`, named in the frame of the part, or null. The
// list is kept as written, so anything in it that is no such entry is
// passed over. `position` is kept and not acted on.
export function layFaceOf(cable, {item, via}) {
  if (!Array.isArray(cable?.lay)) return null;
  const e = cable.lay.find(x => x && typeof x === 'object' && x.item === item && x.via === via);
  return e && (e.face === 'top' || e.face === 'underside') ? e.face : null;
}

// THE SPARE OF A CABLE: {need_m, stock_m, spare_m, end_play_m, to_store_m,
// pinned}, or null without a path. It measures the path it is given and
// never reads a saved number but a length the user pinned (any source but
// `routed`), which is the stock then; a pinned length in a unit that does
// not convert, or one kept as written, gives null.
export function spareOf(rack, cable, ctx) {
  let path = null;
  try { path = routePath(rack, cable, ctx); } catch { path = null; }
  if (!path || cable.lengthAsWritten != null) return null;
  const pinned = !!cable.length && cable.length.source !== 'routed';
  const stock = pinned ? toMetres(cable.length.value, cable.length.unit) : pathLength(path, {values: slackValues(cable)})?.value;
  if (stock == null) return null;
  const need = needOf(path, cable, stock), spare = stock - need;
  return {need_m: need, stock_m: stock, spare_m: spare, end_play_m: Math.max(0, Math.min(spare, 2 * END_PLAY_M)),
          to_store_m: Math.max(0, spare - 2 * END_PLAY_M), pinned};
}

// Every ring a cable's route would enter and leave by one face, rack-wide,
// with a sentence for each: what the page and an agent report. A cable whose
// port is not found is not judged.
export function ringFindings(rack, ctx, nameOf = id => id) {
  return (rack.cables || []).flatMap(c => (routePath(rack, c, ctx)?.findings || []).map(f => ({...f,
    text: `${c.id} would enter and leave ${nameOf(f.item)} ${/^guide-(\d+)$/.test(f.via) ? `ring ${f.via.slice(6)}` : f.via} by the same face: route it through the ring, or past it.`})));
}

// EVERY CORNER OF A CABLE'S PATH WITH LESS ROOM THAN ITS BEND RADIUS (#973,
// docs/cable-lay-design.md section 3.4), rack-wide: routePath's `bends`, each
// with a sentence, in the words of the bundle bend check. It warns and never
// refuses. A cable whose port is not found is not judged. `nameOf(itemId)`
// names an item.
export function bendFindings(rack, ctx, nameOf = id => id) {
  return (rack.cables || []).flatMap(c => bendFindingsOf(rack, c, ctx, nameOf));
}
// The same for one cable (#1007): what `inspect` carries. `path` is the
// cable's routePath, for a caller that already has it.
export function bendFindingsOf(rack, c, ctx, nameOf = id => id, path = routePath(rack, c, ctx)) {
  const lab = (w, c) => (w.end ? `its port on ${nameOf((w.end === 'a' ? c.a : c.b).item)}`
    : w.lane ? `${w.lane} U${uLabel(rack.frame, w.ru)}`
    : `${nameOf(w.item)} ${/^guide-(\d+)$/.test(w.via) ? `ring ${w.via.slice(6)}` : w.via}`);
  const an = t => (/^(8|1[18](\.|$))/.test(t) ? 'an' : 'a');
  return (path?.bends || []).map(f => {
    const [a, b] = f.between.map(w => lab(w, c));
    const where = a === b ? `at ${a}` : `between ${a} and ${b}`;
    const kind = c.type || c.media;
    const needs = `${kind ? `the cable (${kind})` : 'the cable'} needs ${f.need_mm} mm`;
    return {...f, text: f.room_mm === 0 ? `${c.id} doubles back ${where}, with no room for a bend; ${needs}.`
      : `${c.id} turns ${f.angle_deg} degrees ${where} with room for ${an(String(f.room_mm))} ${f.room_mm} mm bend; ${needs}, ${f.short_mm} mm short.`};
  });
}

// EVERY CABLE WHOSE SPAN PASSES IN FRONT OF OTHER PORTS (#1013,
// docs/cable-lay-design.md section 1.7), rack-wide: routePath's `covers`, one
// finding a cable, as {kind: 'span-over-ports', cable, count, ports: [{item,
// path, view}], between: [[from, to]], judged, estimated?, text}: `count` the
// ports covered; `judged` 'all' when every port of every device was there to
// judge (`ctx.portBoxesOf`), 'cabled' when only the ports that hold a cable
// were, and then the sentence says so; `estimated: true` when a port listed
// was taken at the estimated box. The sentence names the ports by device and
// says where a horizontal manager would carry the cord. It warns and never
// refuses: on a rack with no manager it is the truth about the rack. A
// cable whose port is not found is not judged. `nameOf(itemId)` names an
// item. A device's ports are named up to six; past that, the first five and
// how many more.
export function coverFindings(rack, ctx, nameOf = id => id) {
  return (rack.cables || []).flatMap(c => coverFindingsOf(rack, c, ctx, nameOf));
}
// The same for one cable (#1007): none, or the one finding. `path` is the
// cable's routePath, for a caller that already has it.
export function coverFindingsOf(rack, c, ctx, nameOf = id => id, path = routePath(rack, c, ctx)) {
  const covers = path?.covers || [];
  if (!covers.length) return [];
  const lab = w => (w.end ? `its port on ${nameOf((w.end === 'a' ? c.a : c.b).item)}` : `${w.lane} U${uLabel(rack.frame, w.ru)}`);
  const and = xs => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
  const by = new Map();
  for (const f of covers) (by.get(f.item) || by.set(f.item, []).get(f.item)).push(f.view === 'rear' ? `${f.path} (rear)` : f.path);
  for (const paths of by.values()) paths.sort((p, q) => p.localeCompare(q, 'en', {numeric: true}));
  const said = [...by].map(([item, paths]) => `${paths.length > 6 ? `${paths.slice(0, 5).join(', ')} and ${paths.length - 5} more` : and(paths)} on ${nameOf(item)}`);
  const between = [...new Map(covers.map(f => [JSON.stringify(f.between), f.between])).values()];
  const where = between.map(bt => `between ${lab(bt[0])} and ${lab(bt[1])}`);
  // THE ADVICE FITS THE SPAN. One that runs between a lane and a port wants
  // a manager at that port's device, to carry it along the face to the
  // gutter. One that hangs from port to port has no gutter to go to: a
  // manager between or beside the two devices carries it along and across,
  // and where the two ports are on one device, beside that device.
  const toLane = [...new Set(between.filter(bt => bt.some(w => w.lane)).flat().filter(w => w.end).map(w => (w.end === 'a' ? c.a : c.b).item))].map(nameOf);
  const direct = between.some(bt => bt.every(w => w.end));
  const ends = [...new Set([c.a.item, c.b.item])].map(nameOf);
  const advice = [
    ...(toLane.length ? [`add a horizontal cable manager above or below ${toLane.join(' or ')} to carry it to the gutter`] : []),
    ...(direct ? [ends.length > 1 ? `${toLane.length ? 'and ' : ''}route its hop from ${ends[0]} to ${ends[1]} through a horizontal cable manager beside either`
      : `${toLane.length ? 'and ' : ''}route it through a horizontal cable manager above or below ${ends[0]}`] : [])];
  const judged = covers.every(f => f.judged === 'all') ? 'all' : 'cabled';
  const estimated = covers.some(f => f.estimated);
  // the ports in the rack's order of devices, then by name, whichever end the path was laid from
  const order = new Map(rack.items.map((it, k) => [it.id, k]));
  const ports = covers.map(f => ({item: f.item, path: f.path, view: f.view}))
    .sort((p, q) => (order.get(p.item) ?? 0) - (order.get(q.item) ?? 0) || p.path.localeCompare(q.path, 'en', {numeric: true}) || p.view.localeCompare(q.view));
  return [{kind: 'span-over-ports', cable: c.id, count: covers.length, ports, between,
    judged, ...(estimated ? {estimated: true} : {}),
    text: `${c.id} crosses in front of ${and(said)} ${and(where)}: ${advice.join(', ') || `add a horizontal cable manager beside ${ends.join(' or ')}`}.${
      judged === 'cabled' ? ' Only ports that hold a cable were judged.' : ''}`}];
}

// A word for a part of a body, as a finding names it.
function partText(part) {
  const p = String(part || '');
  if (p === 'envelope' || p === 'body' || !p) return '';
  // a part of a ring's solid loop (#968): `ring/guide-3/front-leg` is "ring 3 front leg"
  const ring = /^ring\/([^/]+)\/(.+)$/.exec(p);
  if (ring) return `${/^guide-(\d+)$/.test(ring[1]) ? `ring ${ring[1].slice(6)}` : ring[1]} ${ring[2].replace(/-/g, ' ')}`;
  return p.split('/')[0].replace(/--.*$/, '').replace(/-/g, ' ');
}
// A plate a cable meets from above or below: thinner in y than across.
const isFloor = box => (box.y1 - box.y0) <= Math.min(box.x1 - box.x0, box.z1 - box.z0);

// EVERY BODY A CABLE'S PATH STILL CROSSES (#949, docs/cable-lay-design.md
// section 1.4), rack-wide, after the detours: routePath's `crossings`, each
// with a sentence. It warns and never refuses, as fill, size and bend do: a
// device moving can make a route cross something without any cable command.
// A cable whose port is not found is not judged. `nameOf(itemId)` names an
// item or a zero-U part.
export function bodyFindings(rack, ctx, nameOf = id => id) {
  const solids = solidsOf(rack, ctx);
  const lab = (w, c) => (w.end ? `its port on ${nameOf((w.end === 'a' ? c.a : c.b).item)}`
    : w.lane ? `${w.lane} U${uLabel(rack.frame, w.ru)}`
    : `${nameOf(w.item)} ${/^guide-(\d+)$/.test(w.via) ? `ring ${w.via.slice(6)}` : w.via}`);
  return (rack.cables || []).flatMap(c => (routePath(rack, c, ctx)?.crossings || []).map(f => {
    const s = solids.find(x => x.item === f.item && x.part === f.part);
    const body = [nameOf(f.item), partText(f.part)].filter(Boolean).join(' ');
    const [a, b] = f.between.map(w => lab(w, c));
    const holes = (s?.holes || []).map(h => h.via);
    // a plate met from above or below: the way round is over its front edge,
    // onto the face the cable rests on
    const advice = /^ring\//.test(String(f.part)) ? 'route it into the ring along its run, through its opening'
      : s && isFloor(s.box) && f.part !== 'envelope'
      ? `route it over the front edge of the ${partText(f.part) || 'plate'}, or through a ring`
      : holes.length ? `route it round ${nameOf(f.item)}, or through ${holes.join(' or ')} if the cable fits`
      : `route it round ${nameOf(f.item)}, or through a ring or a pass-through it fits`;
    const where = a === b ? `at ${a}` : `between ${a} and ${b}`;
    return {...f, text: `${c.id} passes through ${body} ${where}: ${advice}.`};
  }));
}

// ── fill ──────────────────────────────────────────────────────────────────
// Typical outside diameters (mm): a sketch of fill, not a measurement.
export const DIAMETERS = {cat6: 6.0, cat6a: 7.5, os2: 3.0, om3: 3.0, om4: 3.0, om5: 3.0, dac: 5.0, aoc: 3.0};
const UNSET_D = 6.0;
export const FILL_LIMIT = 0.4;
const areaOf = media => Math.PI * ((ownMedia(DIAMETERS, media) ?? UNSET_D) / 2) ** 2;

// Every pathway with an aperture that a cable passes through, filled against
// FILL_LIMIT of its opening. Lanes have no limit and are not listed.
// A ring counts the cables that pass through it (routePath): one a route
// would take to its face and back is a finding (ringFindings), not a member.
// A ZERO-U PART that carries a lane (#926) is a pathway too: every cable
// whose route runs on its lane through a U it spans counts once, against
// FILL_LIMIT of its channel, `ctx.zeroUAperture(entry)` -> {w, h} mm, or null
// when the drawing does not say (and then it is not listed). Its entry has the
// part's id as `item`, its first guide as `via`, and `zeroU: true`.
export function fill(rack, ctx) {
  const at = new Map();
  for (const c of rack.cables || []) {
    const path = routePath(rack, c, ctx);
    const notThrough = new Set((path?.findings || []).map(f => `${f.item}|${f.via}`));
    for (const w of resolveRoute(rack, c, ctx).waypoints) {
      if (w.lane || notThrough.has(`${w.item}|${w.via}`)) continue;
      const g = ctx.guidesOf(w.item).find(x => x.via === w.via);
      if (!g?.aperture) continue;
      const key = `${w.item}|${w.via}`;
      const e = at.get(key) || {item: w.item, via: w.via, aperture: g.aperture, area: 0, cables: []};
      if (e.cables.includes(c.id)) continue;
      e.area += areaOf(c.media);
      e.cables.push(c.id);
      at.set(key, e);
    }
  }
  const filled = e => Math.round(e.area / (FILL_LIMIT * e.aperture.w * e.aperture.h) * 100);
  const items = [...at.values()].map(e => {
    const percent = filled(e);
    return {item: e.item, via: e.via, count: e.cables.length, percent, over: percent > 100, cables: e.cables};
  });
  const beside = zeroUThrough(rack, ctx).flatMap(({z, c, cables}) => {
    const ap = typeof ctx.zeroUAperture === 'function' ? ctx.zeroUAperture(z) : null;
    if (!(ap?.w > 0 && ap?.h > 0)) return [];
    const percent = filled({aperture: ap, area: cables.reduce((a, x) => a + areaOf(x.media), 0)});
    const via = Object.values(c.guides || {}).flat()[0] ?? 'duct';
    return [{item: z.id, via, count: cables.length, percent, over: percent > 100, cables: cables.map(x => x.id), zeroU: true}];
  });
  return [...items, ...beside];
}

// The zero-U parts that carry a lane, each with the cables whose routes run
// through it, in rack order; a part no cable runs through is left out.
function zeroUThrough(rack, ctx) {
  const parts = zeroUOf(rack).map(z => ({z, c: ctx.chassisOf(z.ref)})).filter(({c}) => carriesLane(c));
  if (!parts.length) return [];
  const routes = (rack.cables || []).map(c => [c, resolveRoute(rack, c, ctx).waypoints]);
  return parts
    .map(({z, c}) => ({z, c, cables: routes.filter(([, ws]) => runsThrough(ws, z, ctx.chassisOf)).map(([cable]) => cable)}))
    .filter(x => x.cables.length);
}

// Managers whose stated capacity the cables through them exceed. As in fill,
// a ring a cable only doubles back from does not carry it.
export function capacityOver(rack, ctx) {
  const by = new Map();
  for (const c of rack.cables || []) {
    const notThrough = new Set((routePath(rack, c, ctx)?.findings || []).map(f => `${f.item}|${f.via}`));
    for (const w of resolveRoute(rack, c, ctx).waypoints)
      if (w.item && !notThrough.has(`${w.item}|${w.via}`)) (by.get(w.item) || by.set(w.item, new Set()).get(w.item)).add(c.id);
  }
  const out = [];
  for (const [item, set] of by) {
    const cap = ctx.chassisOf(itemOf(rack, item)?.ref)?.capacity?.count;
    if (cap && set.size > cap) out.push({item, count: set.size, capacity: cap});
  }
  // a zero-U part that carries a lane, against its own stated capacity (#926)
  for (const {z, c, cables} of zeroUThrough(rack, ctx)) {
    const cap = c.capacity?.count;
    if (cap && cables.length > cap) out.push({item: z.id, count: cables.length, capacity: cap, zeroU: true});
  }
  return out;
}

// ── keeping routed lengths current ────────────────────────────────────────
// A cable with no length, or a routed one, gets the length its route measures;
// an entered length is the user's and is never touched, nor is one the user
// wrote that the page could not read (lengthAsWritten): that intent wins. Returns the same rack
// when nothing changed, so the page can tell whether to save.
// BESIDE A ROUTED LENGTH THE KIT WRITES `need` (version 4), to a centimetre,
// and no longer writes `measured`, which a cable loses at its next measure:
// no saved number changes its meaning under its old name.
export function withRoutedLengths(rack, ctx) {
  let changed = false;
  const cables = (rack.cables || []).map(c => {
    if (c.lengthAsWritten != null || (c.length && c.length.source !== 'routed')) return c;
    const got = routedLength(rack, c, ctx);
    if (!got) return c;
    const need = Math.round(got.need * 100) / 100;
    if (c.length?.value === got.value && c.length?.need === need && !('measured' in c.length)) return c;
    changed = true;
    return {...c, length: {value: got.value, unit: 'm', source: 'routed', need}};
  });
  return changed ? {...rack, cables} : rack;
}
