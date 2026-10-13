// WHAT A ROUTE NEEDS FROM THE DRAWINGS (the site's half; route.js is pure).
// Each placed item's configured faces give its guides - ring ends, ducts,
// pass-throughs - and its ports, which are turned here into route.js's rack
// coordinates: mm from the rack's center line, right as seen from the front.
// A rear-facing panel is seen mirrored, so its x is negated.

import {configuredFace, DIST} from './face.js';
import {loadCableTypes} from '../../vendor/rack/cable-types.js';
import {bundleFacts, memberPlaces, trunkLay, tieMark} from './bundle-view.js';
import {WIDTH} from '../../vendor/rack/cable-geometry.js';
import {itemBox} from '../../vendor/rack/fit.js';
import {resolveRoute, fill, capacityOver, routePath, pathLength, endPane, ringMarks, ringFindings, bodyFindings, bendFindingsOf, orientMarks} from '../../vendor/rack/route.js';
import {fillNotes, bundleExports} from '../../vendor/rack/export-data.js';
import {anchorsOf} from '../../vendor/rack/bundles.js';
import {traysOf} from '../../vendor/rack/solids.js';
import {portPathOf, mergeSeats, endKey} from '../../vendor/rack/cable-rules.js';
import {RU} from '../../vendor/rack/rails.js';
import {zeroUOf} from '../../vendor/rack/model.js';
import {carriesLane} from '../../vendor/rack/zero-u.js';

const toRack = (x, face, w) => (face === 'rear' ? -(x - w / 2) : x - w / 2);

// A PANE'S AXES against the rack's (Portrayal #930). A ring mark's sense is
// along the rack's axes: x right as seen from the front, y up. Both panes are
// SVG, y down; the rear pane is also seen mirrored, so its x runs the other
// way (toRack above; cable-view.js wayPoint; elevation.js zeroUPaneX).
export const PANE_FLIP = {front: {y: -1}, rear: {x: -1, y: -1}};
export const paneMarks = (marks, pane) => orientMarks(marks, PANE_FLIP[pane === 'rear' ? 'rear' : 'front']);

// rects: [{id, kind?, cls?, run?, x, y, w, h}] in face coordinates; a ring END
// (`<via>-end`, kind ring) stands for its ring; `guide--<via>` is a duct; `pass--<via>` a pass-through.
// A RING'S RUN AND DEPTH (Portrayal #930): `runs` is {via: 'x'|'y'|'z'}, the
// ring component's data-guide-run (guideRunsOf); a ring with none runs along
// x, as route.js ringOf takes it. A ring along x is seen from the side on an
// elevation, so its `-end` rect's width is the band's thickness along the
// run, a drawn figure (6.8 mm for the FS snap-in ring), and is its `depth`;
// any other ring is left to the kit's estimate.
export function guidesFromRects(rects, face, faceW, apertures = {}, runs = {}) {
  const out = [];
  for (const r of rects) {
    let via = null, kind = null;
    if (r.kind === 'ring' && r.id.endsWith('-end')) { via = r.id.slice(0, -4); kind = 'ring'; }
    else if (r.cls === 'guide' && r.id.startsWith('guide--')) { via = r.id.slice(7); kind = 'duct'; }
    else if (r.cls === 'pass' && r.id.startsWith('pass--')) { via = r.id.slice(6); kind = 'pass'; }
    if (!via) continue;
    // A ring's opening is its component's (top view); a duct's cross-section is
    // taken as square on its drawn height - an estimate, and marked so (kit
    // 0.7.0 bundles.js pathwaysOn: a stated aperture wins over an estimate); a
    // pass is its rect.
    const aperture = kind === 'ring' ? (apertures[via] ?? null)
      : kind === 'duct' ? {w: r.h, h: r.h, estimated: true} : {w: r.w, h: r.h};
    const g = {via, kind, face, x: toRack(r.x + r.w / 2, face, faceW), box: {x: r.x, y: r.y, w: r.w, h: r.h}, aperture};
    // EVERY GUIDE CARRIES ITS RUN (kit 0.7.0): a ring's from its component
    // (guideRunsOf), x when it states none; a duct's from its own
    // data-guide-run, which the compiler writes on every duct guide, x when
    // missing; a pass-through goes through the panel, along z.
    if (kind === 'ring') {
      g.run = runs[via] ?? 'x';
      if (g.run === 'x' && r.w > 0) g.depth = r.w;
    } else g.run = kind === 'duct' ? (r.run || 'x') : 'z';
    out.push(g);
  }
  return out;
}

// Ring GROUPS: a device whose D-rings are drawn as groups on its face (`<g
// id="guide-N" data-guide="ring" data-guide-aperture="w h" ...>`, no `-end`
// rect) has rings too: the FS CMH-4DRB1U, CMH-5DR1U(-N), CMH-6DR1U (its
// guides and its two end rings) and USCMH-5DR1U. groups: [{id, x, w,
// aperture}] where x is the group's left edge and w its width, in face
// coordinates (its translate plus its child rects' extent), and aperture the
// opening the ring component declares, or null. Its run from `runs` as for
// guidesFromRects; no depth (a group is the whole ring, not its band), so the
// kit's estimate is taken.
export function ringGroupsFrom(groups, face, faceW, runs = {}) {
  return groups.map(g => ({via: g.id, kind: 'ring', face, x: toRack(g.x + g.w / 2, face, faceW),
                           box: {x: g.x, y: 0, w: g.w, h: 0}, aperture: g.aperture ?? null, run: runs[g.id] ?? 'x'}));
}

// One guide per (via, face): a ring seen as an end rect and again as a group
// is listed once, the first found (the rect, which carries the aperture).
export function dedupeGuides(list) {
  const seen = new Set();
  return list.filter(g => { const k = `${g.via}|${g.face}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

// The box of a compiled path's `d`. Compiled paths are ABSOLUTE (M H V L A Z,
// as the obround passes are); a relative command is not read and the path
// gives no box (null). A half-circle arc adds the bulge of its radius.
export function pathBox(d) {
  if (/[a-z]/.test(d.replace(/e[-+]?\d/gi, ''))) return null;
  const toks = d.match(/[A-Za-z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) || [];
  let x = 0, y = 0, i = 0, cmd = '';
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (px, py) => { x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py); };
  const num = () => +toks[i++];
  while (i < toks.length) {
    if (/[A-Za-z]/.test(toks[i])) cmd = toks[i++];
    if (cmd === 'Z') continue;
    if (cmd === 'M' || cmd === 'L') { x = num(); y = num(); }
    else if (cmd === 'H') x = num();
    else if (cmd === 'V') y = num();
    else if (cmd === 'A') {
      const rx = num(); num(); num(); num(); const sweep = num(), nx = num(), ny = num();
      if (nx === x && ny !== y) add(nx + ((sweep === 1) === (ny > y) ? rx : -rx), (y + ny) / 2);
      else if (ny === y && nx !== x) add((x + nx) / 2, ny + ((sweep === 1) === (nx < x) ? rx : -rx));
      x = nx; y = ny;
    } else return null;
    add(x, y);
  }
  return x0 <= x1 ? {x: x0, y: y0, w: x1 - x0, h: y1 - y0} : null;
}

const rootOf = text => new DOMParser().parseFromString(text, 'image/svg+xml').documentElement;
const translate = el => {
  const m = /translate\(\s*([-\d.]+)[ ,]+([-\d.]+)\s*\)/.exec(el.getAttribute('transform') || '');
  return m ? [+m[1], +m[2]] : [0, 0];
};
// The summed translate() of el's ancestors (below the root), and of itself when `own`.
function offset(el, root, own = false) {
  let dx = 0, dy = 0;
  for (let p = own ? el : el.parentElement; p && p !== root; p = p.parentElement) {
    const [x, y] = translate(p); dx += x; dy += y;
  }
  return [dx, dy];
}

// Rects of an SVG with their translate() ancestors applied: enough for
// compiled faces, whose guides are plain rects under translated groups.
function rectsOf(root) {
  const rects = [...root.querySelectorAll('rect[id]')].map(el => {
    const [dx, dy] = offset(el, root), n = a => parseFloat(el.getAttribute(a)) || 0;
    return {id: el.id, kind: el.getAttribute('data-kind'), cls: el.getAttribute('data-class'),
            run: el.getAttribute('data-guide-run'), x: n('x') + dx, y: n('y') + dy, w: n('width'), h: n('height')};
  });
  // Pass-throughs drawn as paths (obround windows): the box of their `d`.
  const paths = [...root.querySelectorAll('[data-class="pass"][id^="pass--"]:not(rect)')].flatMap(el => {
    const b = pathBox(el.getAttribute('d') || '');
    if (!b) return [];
    const [dx, dy] = offset(el, root);
    return [{id: el.id, kind: null, cls: 'pass', run: null, x: b.x + dx, y: b.y + dy, w: b.w, h: b.h}];
  });
  return [...rects, ...paths];
}

// Ring groups of a face: each group that declares itself a ring (Portrayal
// #868, `guide: {kind: ring, aperture}` on the component), its horizontal
// extent from its child rects, and its opening. Until #868 the site took any
// `data-group="guides"` group for a ring, with no opening, so those rings were
// routed through and never fill-checked; every such group in the vendored
// drawings now carries data-guide="ring" and its aperture, and that stopgap
// is gone (portrayal-site#130; check-contract.py holds it so).
function ringGroupsOf(root) {
  const out = [];
  for (const g of root.querySelectorAll('g[data-guide="ring"][data-ref][id]')) {
    const [gx] = offset(g, root, true);
    let lo = Infinity, hi = -Infinity;
    for (const r of g.querySelectorAll('rect')) {
      const [cx] = offset(r, g);               // translates between the rect and the group
      const x = (parseFloat(r.getAttribute('x')) || 0) + cx, w = parseFloat(r.getAttribute('width')) || 0;
      lo = Math.min(lo, x); hi = Math.max(hi, x + w);
    }
    if (lo > hi) { lo = 0; hi = 0; }
    out.push({id: g.id, x: gx + lo, w: hi - lo, aperture: apertureOf(g)});
  }
  return out;
}

// A ring component's opening: `data-guide-aperture="w h"`, or null.
function apertureOf(el) {
  const [w, h] = (el.getAttribute('data-guide-aperture') || '').split(/\s+/).map(Number);
  return w > 0 && h > 0 ? {w, h} : null;
}
// Every ring opening a view declares, by id (the top view, for rings whose
// faces draw only their `-end` rects).
function aperturesOf(root) {
  const out = {};
  for (const el of root.querySelectorAll('[data-guide-aperture]')) {
    const ap = apertureOf(el);
    if (el.id && ap) out[el.id] = ap;
  }
  return out;
}

// A ring component's run (Portrayal #930): `data-guide-run` on the element
// that carries data-guide="ring" - on the top view, where aperturesOf reads,
// and on an elevation that draws the ring's own component (a CMH-6DR1U's
// rings are on its front view only). The first view to name a ring wins.
export function guideRunsOf(roots) {
  const out = {};
  for (const root of roots) if (root)
    for (const el of root.querySelectorAll('[data-guide="ring"][data-guide-run]'))
      if (el.id && !(el.id in out)) out[el.id] = el.getAttribute('data-guide-run');
  return out;
}

// A face that could not be read is null, and `failed.n` counts it: the facts are then incomplete.
const faceOf = (it, failed) => view => configuredFace({ref: it.ref, cfg: it.cfg, view, swaps: it.swaps || {}, fields: it.fields || {}, ends: true})
  .catch(() => { failed.n++; return null; });

// A ZERO-U DUCT'S CHANNEL: as wide as its drawn guide (`data-guide-run="y"`, the
// guide rect on its front view) and, an estimate, as deep as the part, so
// marked `estimated`. Null when the drawing has no such guide. The kit reads it
// as ctx.zeroUAperture (route.js fill, bundles.js pathwaysOn).
export function ductAperture(rects, depth) {
  const g = rects.find(r => r.cls === 'guide' && r.id.startsWith('guide--'));
  return g && g.w > 0 && depth > 0 ? {w: g.w, h: depth, estimated: true} : null;
}
async function zeroUApertures(rack, chassisOf) {
  const out = new Map();
  await Promise.all(zeroUOf(rack).map(async z => {
    const c = chassisOf(z.ref);
    if (!carriesLane(c)) return;
    const f = await configuredFace({ref: z.ref, cfg: z.cfg, view: 'front', swaps: {}, fields: {}}).catch(() => null);
    const ap = f ? ductAperture(rectsOf(rootOf(f.text)), c.d) : null;
    if (ap) out.set(z.id, ap);
  }));
  return out;
}

// THE DETOURS OF A PATH, by the waypoints they follow (Portrayal #949,
// docs/cable-lay-design.md 1.3). routePath adds points where a straight leg
// would cross a solid body; they are never stored, and each detour names the
// two stops its leg lies between ({end: 'a'}, a waypoint, or {end: 'b'}).
// The drawings place their own points for the waypoints, so a detour is put
// in after the waypoint its leg starts from: [{after, points}], `after` an
// index into `waypoints` (-1: straight after end a), `points` in rack mm.
// A detour whose stop is not among the waypoints (one the kit could not
// place) is dropped, never put at a guessed place.
const sameStop = (w, s) => (s.lane ? w.lane === s.lane && w.ru === s.ru : !w.lane && w.item === s.item && w.via === s.via);
export function detourStops(waypoints, detours) {
  const out = [];
  let from = -1;
  for (const d of detours || []) {
    const [a] = d.between || [];
    let at;
    if (a?.end === 'a') at = -1;
    else if (a?.end === 'b') at = waypoints.length - 1;
    else {
      at = waypoints.findIndex((w, i) => i >= from && sameStop(w, a));
      if (at < 0) continue;
    }
    from = Math.max(from, at);
    out.push({after: at, points: d.points.map(p => ({x: p.x, y: p.y, z: p.z}))});
  }
  return out;
}

// THE LEAD POINTS OF A PATH, by the ring they stand beside (kit 0.17.0,
// Portrayal #973, docs/cable-lay-design.md 3.4). Where a cable comes to a
// ring from behind its approach point the kit leads it square: level with the
// stop before, to a point beside the approach point (`at: 'lead'`, with the
// ring's `item` and `via`), and from there onto the run. The 3D scene draws
// every point of the path, so a lead point is one more of them; the panes
// place a ring by its own drawing, so they are handed each ring's lead points
// to draw before it or after it, as they are handed the detours:
// [{at, before, points}], `at` an index into `waypoints`, `before` whether the
// points come before the ring's own (the cable's way in) or after it (its way
// out), `points` in rack mm. The kit's points are in the route's order, so a
// ring passed twice is matched in turn. A lead point straight out of a plug
// (`end`, no item) is along z, which an elevation sees end on: it is the
// port's own point there, and is not listed.
export function leadStops(waypoints, points) {
  const out = [];
  let w = -1, entered = false;
  const next = q => waypoints.findIndex((x, i) => i > w && sameStop(x, q));
  for (const q of points || []) {
    if (!q.item || !q.via) continue;
    // the next stop that names this ring: the first of its points, or its
    // entry (or face) again once this visit has been through
    const again = w >= 0 && sameStop(waypoints[w], q) && entered && (q.at === 'entry' || q.at === 'face');
    if (w < 0 || !sameStop(waypoints[w], q) || again) {
      const k = next(q);
      if (k < 0) { if (!again) continue; } else { w = k; entered = false; }
    }
    if (q.at !== 'lead') { if (q.at !== 'approach') entered = true; continue; }
    const before = !entered, last = out.at(-1);
    if (last && last.at === w && last.before === before) last.points.push({x: q.x, y: q.y, z: q.z});
    else out.push({at: w, before, points: [{x: q.x, y: q.y, z: q.z}]});
  }
  return out;
}

// WHERE A TIGHT BEND IS, by the waypoints it lies between (kit 0.17.0,
// route.js bendFindings: `between: [from, to]`, each {end: 'a'}, a waypoint,
// or {end: 'b'}), as indices into `waypoints` (-1: end a; waypoints.length:
// end b), for the panes: a ring is drawn round the corner on the pane that
// places both. null where a stop is not among the waypoints.
export function bendStops(waypoints, finding) {
  // null: a stop the route does not have (never -1, which is end a)
  const idx = (s, from) => {
    if (s?.end === 'a') return -1;
    if (s?.end === 'b') return waypoints.length;
    const k = s ? waypoints.findIndex((w, i) => i >= from && sameStop(w, s)) : -1;
    return k < 0 ? null : k;
  };
  const [a, b] = finding?.between || [];
  const i = idx(a, 0);
  if (i == null) return null;
  const j = idx(b, Math.max(0, i));
  return j == null ? null : [i, j];
}

// THE PLUG'S REACH (kit 0.13.0, Portrayal #960): how far, in mm, the far end
// of what is seated at an end stands out of its panel - the `z` of relief.js
// cablePoints on the panel as the page draws it, with the derived plugs laid
// over the item's swaps (cable-plugs.js cableFacts), so an optic's standing
// out is in it. The kit starts the route's first and last legs there (`at:
// 'reach'`), and the 3D scene starts its tube there, so drawn and measured
// agree. A map of endKey -> mm; an end with no connector drawn (an MPO
// adapter, a loose end) is not in it, and the kit takes its media's figure.
const plugAt = (cp, path) => cp === `${path}-occupant` || cp.startsWith(`${path}-occupant/`);
// `facts`, when the caller has them (rack-page.js render reads them just
// before), are cableFacts' answer, and are not read again.
export async function plugReaches(rack, facts = null) {
  const out = new Map();
  const ends = (rack.cables || []).flatMap(c => [c.a, c.b]).filter(e => e?.item && e.path);
  if (!ends.length) return out;
  // imported here: relief.js reads the page's address at load, and this module
  // is also loaded where there is no page (the node tests of the agent tools)
  const {cablePoints} = await import('../../vendor/relief.js');
  if (!facts?.seats || facts.unchecked) {
    const {cableFacts} = await import('./cable-plugs.js');
    facts = await cableFacts(rack).catch(() => null);
  }
  const items = new Map(rack.items.map(i => [i.id, i]));
  const roots = new Map();
  const rootOfPanel = (it, view) => {
    const k = `${it.id}|${view}`;
    if (!roots.has(k)) roots.set(k, configuredFace({ref: it.ref, cfg: it.cfg, view,
      swaps: mergeSeats(it.swaps, facts?.seats?.[it.id]), fields: it.fields || {}})
      .then(f => (f ? rootOf(f.text) : null)).catch(() => null));
    return roots.get(k);
  };
  await Promise.all(ends.map(async e => {
    const it = items.get(e.item);
    if (!it) return;
    const root = await rootOfPanel(it, e.view === 'rear' ? 'rear' : 'front');
    if (!root) return;
    const zs = cablePoints(root).filter(p => p.at && plugAt(p.path, e.path)).map(p => +p.z).filter(Number.isFinite);
    if (zs.length) out.set(endKey(e), Math.max(0, ...zs));
  }));
  return out;
}

// The cable types (cable-types.json), loaded once a page: every route reads
// a cable's diameter from them (kit 0.11.0: what a pass-through must fit and
// a detour keeps clear by), and the bundles their bend radii. null when they
// cannot be read: the kit then takes each cable's media's typical figure.
let typesOnce = null;
export const cableTypes = () => (typesOnce ??= loadCableTypes(DIST).catch(() => null));

// A BUNDLE'S CHECK READS THE CABLE TYPES (portrayal-site#164): each member's
// diameter for its size, and its installed bend radius (`bendOf`) for its
// bend. Without `bendOf` the kit says the bend "is not checked: the cable
// types are not loaded", so every path that checks a bundle - the page's
// panels and list, the agent's tools, the exports - builds its context here,
// and none spells the pair out for itself. `types` is loadCableTypes' answer,
// or null when they could not be read: the context is then left as it is.
export const withCableTypes = (ctx, types) =>
  (types ? {...ctx, diameterOf: types.diameterOf, bendOf: types.bendOf} : ctx);

export async function routeFacts(rack, chassisOf, {cableFacts: given = null} = {}) {
  const guides = new Map(), ports = new Map(), failed = {n: 0};
  const typesReady = cableTypes();
  // The ducts beside the rack, read from their drawings with the faces.
  const ducts = zeroUApertures(rack, chassisOf);
  await Promise.all(rack.items.map(async it => {
    const c = chassisOf(it.ref) || {};
    const get = faceOf(it, failed);
    const [front, rear, top] = await Promise.all([get('front'), get('rear'), c.guides?.top ? get('top') : null]);
    const roots = {front: front && rootOf(front.text), rear: rear && rootOf(rear.text), top: top && rootOf(top.text)};
    const aps = top ? aperturesOf(roots.top) : {};
    const runs = guideRunsOf([roots.top, roots.front, roots.rear]);
    const list = [];
    // Its outward panel is on its face; the other panel faces the other way.
    const facing = {front: it.turned ? (it.face === 'front' ? 'rear' : 'front') : it.face};
    facing.rear = facing.front === 'front' ? 'rear' : 'front';
    for (const [view, f] of [['front', front], ['rear', rear]]) {
      if (!f) continue;
      const w = f.vb?.[2] ?? 483, root = roots[view];
      list.push(...guidesFromRects(rectsOf(root), facing[view], w, aps, runs),
                ...ringGroupsFrom(ringGroupsOf(root), facing[view], w, runs));
      for (const p of f.ports || [])
        ports.set(`${it.id}|${view}|${p.path ?? p.id}`, {x: toRack(p.x + p.w / 2, facing[view], w), y: p.y + p.h / 2, faceH: f.vb?.[3] ?? RU});
    }
    guides.set(it.id, dedupeGuides(list));
  }));
  // EVERYTHING THE CONTEXT READS IS IN HAND BEFORE IT IS MADE (kit 0.17.0,
  // Portrayal #973): the kit keeps what it decides for a cable per rack,
  // context and cable, so a context is made whole, once, and never changed.
  // One is built here on every call, from the rack and the drawings as they
  // are now, and frozen: a device moved, a cable's type changed, a port
  // swapped or a plug's reach read is a new call and a new context, and
  // writing to this one throws. Nothing it closes over (the guides, the
  // ports, the channels, the reaches) is written to after this line.
  const [channels, types, reachOf] = await Promise.all([ducts, typesReady, plugReaches(rack, given)]);
  const itemOf = id => rack.items.find(i => i.id === id);
  const port = end => ports.get(`${end.item}|${end.view === 'rear' ? 'rear' : 'front'}|${portPathOf(end.path)}`) ?? null;
  const ctx = Object.freeze({
    chassisOf,
    guidesOf: id => guides.get(id) ?? [],
    portX: end => port(end)?.x ?? null,
    // Height above the floor: the item's top, less the port's depth into its face.
    portY: end => { const p = port(end), it = itemOf(end.item);
      if (!p || !it) return null;
      // The drawing is centred, unscaled, in the span the item fills (the
      // kit's fit.js itemBox, `lo` to `hi`: where elevation.js, the side panes
      // and the 3D rack stand the body, and the kit its solids), so a port of
      // a half-unit panel is where every view draws it, in either half.
      const b = itemBox(rack, it, chassisOf);
      return (b.lo + b.hi) / 2 + p.faceH / 2 - p.y; },
    // A duct beside the rack: its channel, from its drawing (ductAperture), or
    // null. The kit's fill and capacityOver count the cables through it, and a
    // bundle's size check reads it, so the page does not count them itself.
    zeroUAperture: z => channels.get(z?.id) ?? null,
    // EACH CABLE'S DIAMETER (kit 0.11.0, #949): a pass-through must fit it and
    // a detour keeps clear of a body by its radius, so the route context carries
    // the cable types' lookup, as the bundles' context does.
    // AND HOW IT HANGS, RESTS AND BENDS: a free span by its own type's drape
    // (`typeOf`, kit 0.14.0) and no tighter than its installed bend radius
    // (`bendOf`), which is also the radius every turn of its path is given
    // room for and judged by (kit 0.17.0: each cable by its own type's, never
    // one figure for the rack). Without the cable types the kit takes each
    // cable's media's figure.
    ...(types ? {diameterOf: types.diameterOf, typeOf: types.typeOf, bendOf: types.bendOf} : {}),
    // Each end from the far end of its seated plug (kit 0.13.0), so every
    // length the page shows is the kit's, measured the way the 3D scene draws it.
    plugReachOf: end => reachOf.get(endKey(end)) ?? null,
  });
  const routes = new Map((rack.cables || []).map(c => [c.id, resolveRoute(rack, c, ctx)]));
  // THE PATH OF EACH CABLE, measured once (route.js routePath): its length,
  // its ring marks and its detours all come from this one reading.
  const paths = new Map((rack.cables || []).map(c => [c.id, routePath(rack, c, ctx)]));
  const lengths = new Map((rack.cables || []).map(c => [c.id, pathLength(paths.get(c.id))]));
  // THE RINGS, DECIDED ONCE (Portrayal #930): per cable, one mark per
  // resolved waypoint - null for a lane, a duct or a pass, and for a ring the
  // kit's {run, depth, sense, back} in the rack's axes. The 2D panes turn them
  // to their own axes (cable-view.js) and the 3D scene passes them as they are
  // (scene3d.js); neither decides a ring itself. A ring that HOLDS a cable
  // reaching just into it past its port (kit 0.12.0, `held: true` on the
  // path's ring) is a pass like any other: its mark is {back: false} with its
  // sense, so both drawings take the cable through it.
  const marks = new Map((rack.cables || []).map(c => [c.id, paths.get(c.id)?.marks ?? ringMarks(rack, c, ctx)]));
  // THE DETOURS (kit 0.11.0, #949): the points the kit added round a solid
  // body, after the waypoint each one follows, so both drawings go round the
  // body the way the length was measured (detourStops).
  const detours = new Map((rack.cables || []).map(c => [c.id, detourStops(routes.get(c.id).waypoints, paths.get(c.id)?.detours)]));
  // THE LEAD POINTS (kit 0.17.0, #973), beside the ring each one stands at,
  // for the panes (leadStops); the 3D scene reads them off the path itself.
  const leads = new Map((rack.cables || []).map(c => [c.id, leadStops(routes.get(c.id).waypoints, paths.get(c.id)?.points)]));
  // A ring a route would enter and leave by one face, and a body a route
  // still crosses after its detours: shown with fill and capacity.
  const labelOf = id => rack.items.find(i => i.id === id)?.label ?? (rack.zeroU || []).find(z => z.id === id)?.label ?? id;
  const rings = ringFindings(rack, ctx, labelOf);
  const bodies = bodyFindings(rack, ctx, labelOf);
  // THE TIGHT BENDS ARE THE KIT'S (kit 0.17.0, #973: route.js bendFindings):
  // each corner of a cable's path with less room than its own installed bend
  // radius, with the kit's sentence and where it is (`at`, rack mm). The
  // page's notice says them and both drawings ring them; nothing here
  // measures a bend. `stops` is where the panes look for it (bendStops).
  // EACH CABLE IS LAID ONCE WHERE THE KIT LETS THE PAGE HAND ITS PATH BACK. The
  // kit keeps which lay of a cable it chose, not the lay: every rack-wide
  // reading (routePath, and so fill, capacityOver, ringFindings, bodyFindings,
  // bendFindings, anchorsOf, spareOf, withRoutedLengths) lays every cable
  // again. bendFindingsOf takes the path a caller already has, and is what
  // bendFindings calls for each cable, so this is the same list from the
  // paths read above, with one walk of the rack fewer.
  const bends = (rack.cables || []).flatMap(c => bendFindingsOf(rack, c, ctx, labelOf, paths.get(c.id)))
    .map(f => ({...f, stops: bendStops(routes.get(f.cable)?.waypoints ?? [], f)}));
  // THE BUNDLES (portrayal-site#142): each one's size check and straps from the
  // kit, with the cable types' diameters and bend radii (loaded once a page;
  // without them the kit counts each cable by its media), and where each
  // member rides its trunk. The 2D panes, the 3D scene, the cable list and the
  // sheet all read these, so they agree.
  const bctx = withCableTypes({route: ctx}, types);
  const bundles = bundleFacts(rack, bctx);
  // WHERE EACH MEMBER LIES IN ITS BUNDLE, AND HOW THICK THE BUNDLE IS THERE
  // (bundle-view.js trunkLay): worked out once here from the kit's layout and
  // points, so the panes, the scene and a sheet all draw one lay. A drawing
  // figure: no length, route or check reads it.
  for (const f of bundles.values()) {
    try { f.lay = trunkLay(rack, f, {paths, ctx, diameterOf: types?.diameterOf ?? null, width: WIDTH}); }
    catch (err) { f.lay = null; console.warn('[portrayal] a bundle\'s lay could not be worked out', err); }
  }
  // AND AS THE EXPORTS READ THEM (Portrayal #923, kit 0.9.0): one record per
  // bundle from the kit's bundleExports, measured with the same context, for
  // the cable schedule's notes and the BOM's strap line.
  const bundleRecords = bundleExports(rack, bctx);
  // EVERY TIE SLOT A STRAP IS AT, AND THE ONES A SINGLE CABLE IS TIED AT
  // (kit 0.22.0): the BOM counts the first, the drawings stand a band at each
  // of the second (a bundle's own are among its straps, along its trunk).
  const ties = tieStraps(rack, bctx, ctx, paths);
  const places = memberPlaces(rack, routes, bundles);
  // Ducts beside the rack are the kit's to count (#926): fill and capacityOver
  // read ctx.zeroUAperture, so each is listed once, by the kit.
  // `types` goes with them, so a bundle command sent before the page's own
  // load of the cable types has finished still checks the bend (bundleCtx).
  // `rack` is the rack these were read from: a reader that holds them beside a
  // rack asks whether it is still that one (rack-page.js routesNow).
  // (`readRack` is the rack these were read from, for good: `rack` is re-pointed when a rack that differs in
  // nothing a route reads takes its place, rack-page.js keepRoutes)
  return {rack, readRack: rack, ctx, types, bctx, complete: failed.n === 0, routes, paths, marks, detours, leads, fill: fill(rack, ctx),
          over: capacityOver(rack, ctx), ringFindings: rings, bodyFindings: bodies, bendFindings: bends, lengths,
          endPane: e => endPane(rack, e), bundles, bundleRecords, places, anchors: ties.slots, tieStraps: ties.marks};
}

// THE TIE STRAPS OF SINGLE CABLES (kit 0.22.0, bundles.js anchorsOf): one
// strap at each tray tie slot a lone cord is tied at, shared by every cord at
// that slot. The kit names the slot ({item, via, tie}) with its width and the
// cables there; where the slot is comes from its tray (solids.js traysOf: a
// plan rectangle, and the heights of the tray's two faces), and which face
// the cables are on from the first one's own path (`rests`: held under the
// plate, or resting on it). `slots` is every slot, a bundle's among them, as
// strapBomRows takes them; `marks` are the ones no bundle is tied at:
// [{item, via, tie, width_mm, cables, run, held, at: {x, y, z}}], `at` on the
// face of the plate the cables are on, in rack mm.
export function tieStraps(rack, bctx, ctx, paths) {
  let slots = [], trays = [];
  try { slots = anchorsOf(rack, bctx); trays = traysOf(rack, ctx); }
  catch (err) { console.warn('[portrayal] the tie straps could not be read', err); return {slots: [], marks: []}; }
  const marks = [];
  for (const s of slots) {
    if (s.bundles.length) continue;
    const t = trays.find(x => x.item === s.item && x.via === s.via);
    const rest = s.cables.map(id => (paths.get(id)?.rests || []).find(r => r.kind === 'tray' && r.item === s.item && r.via === s.via)).find(Boolean);
    const mark = tieMark(s, t, rest);
    if (mark) marks.push(mark);
  }
  return {slots, marks};
}

// A TIGHT BEND IS SHOWN FOR A CABLE THAT IS PLUGGED IN AT BOTH ENDS. The kit
// lays a path between two ports whether or not anything is seated in them.
// The page draws a cable with a loose end as an unplugged lead, or not at
// all, and says why it is not connected; it neither says nor rings a bend of
// a path it does not draw. `isLoose(end)` is the page's own answer for an end
// (cable-plugs.js cableFacts: a reason it does not land). The notice, the
// panes and the 3D scene all take their findings through here, so they agree.
export function landedBends(findings, rack, isLoose) {
  const byId = new Map((rack?.cables || []).map(c => [c.id, c]));
  return (findings || []).filter(f => { const c = byId.get(f.cable); return !!c && !isLoose(c.a) && !isLoose(c.b); });
}

// WHERE A TIGHT BEND IS RINGED, as rack mm [x, y, z] (kit 0.27.0, Portrayal
// #1026). Two turns on one short leg are ONE finding, whose `at` is the middle
// of the leg between them: a ring there rings neither corner. The kit's
// `turns[].at` are the two corners, so a pair is ringed at each, with the
// finding's one sentence for both; a single bend has no `turns` and is ringed
// at its `at`, as it always was.
export function bendPoints(f) {
  const turns = (f?.turns || []).map(t => t.at).filter(Array.isArray);
  if (turns.length) return turns;
  return Array.isArray(f?.at) ? [f.at] : [];
}

// THE BEND NOTICE (kit 0.17.0, Portrayal #973): the kit's sentences for the
// corners of the cables' paths that are short of their bend radius, the first
// three and how many more. '' when there is none.
// A finding that put a lead into a ring too close for it (kit 0.27.0) carries
// what would give it room in a field of its own, `advice`; the kit's schedule
// notes say it once for each. So does this: after the sentences, each distinct
// advice of the findings the notice names, once.
export function bendNotice(findings, most = 3) {
  const all = (findings || []).filter(f => f.text);
  const shown = all.length > most ? all.slice(0, most) : all;
  const said = shown.map(f => f.text);
  if (all.length > most) said.push(`And ${all.length - most} more.`);
  for (const advice of new Set(shown.map(f => f.advice).filter(Boolean))) said.push(advice);
  return said.join(' ');
}

// WHAT THE ROUTES WARN OF, as sentences: the kit's fill, capacity and gone
// waypoint notes (export-data.js fillNotes), then each ring a route would
// enter and leave by one face (route.js ringFindings), then each solid body a
// route still passes through after its detours (route.js bodyFindings, kit
// 0.11.0). The cable list and the exports' notes both read this, so they say
// the same things. `bodies: false` leaves the bodies out, for the cable
// schedule, which writes each into its own cable's row instead.
// `bends` are the tight bends to list after them, each the kit's sentence
// (route.js bendFindings): the page gives the ones it rings (landedBends).
// The exports give none; their notes do not carry bends yet.
// READ ONCE FOR A RACK, A SET OF ROUTES AND A NAMER. The side panel is drawn
// again on every selection, hover of a row and edit, and each ringFindings and
// bodyFindings lays every cable of the rack again (the kit keeps which lay it
// chose, not the lay). A rack is never changed in place, so the same rack
// object with the same routes and the same `nameOf` gives the same sentences:
// they are kept beside the routes, and worked out again only when one of the
// three is another object.
const notesMemo = new WeakMap();   // facts -> {rack, nameOf, rings, crossed}
// `asRead: true` takes the ring and body findings routeFacts read with these
// routes (its own namer: each item's or zero-U part's label, else its id),
// and lays nothing again. For a caller whose `nameOf` is that same naming of
// the rack the routes are for: the page, whose routes are read again whenever
// a step changes a label (rack-page.js routesNow). An export names devices
// its own way and does not pass it.
export function routeNotes(rack, facts, nameOf = id => id, {bodies = true, bends = [], asRead = false} = {}) {
  if (!facts) return [];
  if (asRead && Array.isArray(facts.ringFindings) && Array.isArray(facts.bodyFindings))
    return [...fillNotes(rack, facts, nameOf), ...facts.ringFindings.map(f => f.text), ...(bodies ? facts.bodyFindings : []).map(f => f.text),
            ...(bends || []).map(f => f.text)];
  let m = notesMemo.get(facts);
  if (!m || m.rack !== rack || m.nameOf !== nameOf) notesMemo.set(facts, m = {rack, nameOf, rings: null, crossed: null});
  m.rings ??= facts.ctx ? ringFindings(rack, facts.ctx, nameOf) : (facts.ringFindings || []);
  if (bodies) m.crossed ??= facts.ctx ? bodyFindings(rack, facts.ctx, nameOf) : (facts.bodyFindings || []);
  return [...fillNotes(rack, facts, nameOf), ...m.rings.map(f => f.text), ...(bodies ? m.crossed : []).map(f => f.text),
          ...(bends || []).map(f => f.text)];
}
