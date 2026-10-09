// WHAT A ROUTE NEEDS FROM THE DRAWINGS (the site's half; route.js is pure).
// Each placed item's configured faces give its guides - ring ends, ducts,
// pass-throughs - and its ports, which are turned here into route.js's rack
// coordinates: mm from the rack's center line, right as seen from the front.
// A rear-facing panel is seen mirrored, so its x is negated.

import {configuredFace} from './face.js';
import {resolveRoute, fill, capacityOver, routedLength, endPane, ringMarks, ringFindings, orientMarks} from '../../vendor/rack/route.js';
import {fillNotes} from '../../vendor/rack/export-data.js';
import {portPathOf} from '../../vendor/rack/cable-rules.js';
import {RU} from '../../vendor/rack/rails.js';
import {zeroUOf, zeroUFill, isRackSide} from './zero-u.js';

const toRack = (x, face, w) => (face === 'rear' ? -(x - w / 2) : x - w / 2);

// A PANE'S AXES against the rack's (Portrayal #930). A ring mark's sense is
// along the rack's axes: x right as seen from the front, y up. Both panes are
// SVG, y down; the rear pane is also seen mirrored, so its x runs the other
// way (toRack above; cable-view.js wayPoint; elevation.js zeroUPaneX).
export const PANE_FLIP = {front: {y: -1}, rear: {x: -1, y: -1}};
export const paneMarks = (marks, pane) => orientMarks(marks, PANE_FLIP[pane === 'rear' ? 'rear' : 'front']);

// rects: [{id, kind?, cls?, x, y, w, h}] in face coordinates; a ring END
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
    // taken as square on its drawn height - an estimate; a pass is its rect.
    const aperture = kind === 'ring' ? (apertures[via] ?? null)
      : kind === 'duct' ? {w: r.h, h: r.h} : {w: r.w, h: r.h};
    const g = {via, kind, face, x: toRack(r.x + r.w / 2, face, faceW), box: {x: r.x, y: r.y, w: r.w, h: r.h}, aperture};
    if (kind === 'ring') {
      g.run = runs[via] ?? 'x';
      if (g.run === 'x' && r.w > 0) g.depth = r.w;
    }
    out.push(g);
  }
  return out;
}

// Ring GROUPS: a device whose D-rings are drawn as groups (`<g id="guide-N"
// data-group="guides" data-ref=...>`, no `-end` rect) still has rings. groups:
// [{id, x, w}] where x is the group's left edge and w its width, in face
// coordinates (its translate plus its child rects' extent). Aperture unknown.
// Its run from `runs` as for guidesFromRects; no depth (a group is the whole
// ring, not its band), so the kit's estimate is taken.
export function ringGroupsFrom(groups, face, faceW, runs = {}) {
  return groups.map(g => ({via: g.id, kind: 'ring', face, x: toRack(g.x + g.w / 2, face, faceW),
                           box: {x: g.x, y: 0, w: g.w, h: 0}, aperture: null, run: runs[g.id] ?? 'x'}));
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
            x: n('x') + dx, y: n('y') + dy, w: n('width'), h: n('height')};
  });
  // Pass-throughs drawn as paths (obround windows): the box of their `d`.
  const paths = [...root.querySelectorAll('[data-class="pass"][id^="pass--"]:not(rect)')].flatMap(el => {
    const b = pathBox(el.getAttribute('d') || '');
    if (!b) return [];
    const [dx, dy] = offset(el, root);
    return [{id: el.id, kind: null, cls: 'pass', x: b.x + dx, y: b.y + dy, w: b.w, h: b.h}];
  });
  return [...rects, ...paths];
}

// Ring groups of a face: each group's horizontal extent from its child rects.
function ringGroupsOf(root) {
  const out = [];
  for (const g of root.querySelectorAll('g[data-group="guides"][data-ref][id]')) {
    const [gx] = offset(g, root, true);
    let lo = Infinity, hi = -Infinity;
    for (const r of g.querySelectorAll('rect')) {
      const [cx] = offset(r, g);               // translates between the rect and the group
      const x = (parseFloat(r.getAttribute('x')) || 0) + cx, w = parseFloat(r.getAttribute('width')) || 0;
      lo = Math.min(lo, x); hi = Math.max(hi, x + w);
    }
    if (lo > hi) { lo = 0; hi = 0; }
    out.push({id: g.id, x: gx + lo, w: hi - lo});
  }
  return out;
}

// A ring component's opening, from the top view: `data-guide-aperture="w h"`.
function aperturesOf(root) {
  const out = {};
  for (const el of root.querySelectorAll('[data-guide-aperture]')) {
    const [w, h] = el.getAttribute('data-guide-aperture').split(/\s+/).map(Number);
    if (el.id && w > 0 && h > 0) out[el.id] = {w, h};
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
const faceOf = (it, failed) => view => configuredFace({ref: it.ref, cfg: it.cfg, view, swaps: it.swaps || {}, fields: it.fields || {}})
  .catch(() => { failed.n++; return null; });

// A ZERO-U DUCT'S CHANNEL: as wide as its drawn guide (`data-guide-run="y"`, the
// guide rect on its front view) and, an estimate, as deep as the part. Null
// when the drawing has no such guide.
export function ductAperture(rects, depth) {
  const g = rects.find(r => r.cls === 'guide' && r.id.startsWith('guide--'));
  return g && g.w > 0 && depth > 0 ? {w: g.w, h: depth} : null;
}
async function zeroUApertures(rack, chassisOf) {
  const out = new Map();
  await Promise.all(zeroUOf(rack).map(async z => {
    const c = chassisOf(z.ref);
    if (!isRackSide(c)) return;
    const f = await configuredFace({ref: z.ref, cfg: z.cfg, view: 'front', swaps: {}, fields: {}}).catch(() => null);
    const ap = f ? ductAperture(rectsOf(rootOf(f.text)), c.d) : null;
    if (ap) out.set(z.id, ap);
  }));
  return out;
}

export async function routeFacts(rack, chassisOf) {
  const guides = new Map(), ports = new Map(), failed = {n: 0};
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
  const itemOf = id => rack.items.find(i => i.id === id);
  const port = end => ports.get(`${end.item}|${end.view === 'rear' ? 'rear' : 'front'}|${portPathOf(end.path)}`) ?? null;
  const ctx = {
    chassisOf,
    guidesOf: id => guides.get(id) ?? [],
    portX: end => port(end)?.x ?? null,
    // Height above the floor: the item's top, less the port's depth into its face.
    portY: end => { const p = port(end), it = itemOf(end.item);
      if (!p || !it) return null;
      // The drawing is centered, unscaled, in its U span (elevation.js).
      const u = Math.max(1, chassisOf(it.ref)?.ru ?? 1);
      return (it.ru - 1 + u) * RU - ((u * RU - p.faceH) / 2 + p.y); },
  };
  const routes = new Map((rack.cables || []).map(c => [c.id, resolveRoute(rack, c, ctx)]));
  const lengths = new Map((rack.cables || []).map(c => [c.id, routedLength(rack, c, ctx)]));
  // THE RINGS, DECIDED ONCE (Portrayal #930): per cable, one mark per
  // resolved waypoint - null for a lane, a duct or a pass, and for a ring the
  // kit's {run, depth, sense, back} in the rack's axes. The 2D panes turn them
  // to their own axes (cable-view.js) and the 3D scene passes them as they are
  // (scene3d.js); neither decides a ring itself.
  const marks = new Map((rack.cables || []).map(c => [c.id, ringMarks(rack, c, ctx)]));
  // A ring a route would enter and leave by one face: shown with fill and capacity.
  const labelOf = id => rack.items.find(i => i.id === id)?.label ?? id;
  const rings = ringFindings(rack, ctx, labelOf);
  // Ducts beside the rack (zero-u.js): the lanes run through them, so they fill
  // as any pathway does, and are counted against their stated capacity.
  const ducts = await zeroUApertures(rack, chassisOf);
  const side = zeroUFill(rack, routes, chassisOf, z => ducts.get(z.id) ?? null);
  return {ctx, complete: failed.n === 0, routes, marks, fill: [...fill(rack, ctx), ...side.fill],
          over: [...capacityOver(rack, ctx), ...side.over], ringFindings: rings, lengths, endPane: e => endPane(rack, e)};
}

// WHAT THE ROUTES WARN OF, as sentences: the kit's fill, capacity and gone
// waypoint notes (export-data.js fillNotes), then each ring a route would
// enter and leave by one face (route.js ringFindings). The cable list and the
// exports' notes both read this, so they say the same things.
export function routeNotes(rack, facts, nameOf = id => id) {
  if (!facts) return [];
  const rings = facts.ctx ? ringFindings(rack, facts.ctx, nameOf) : (facts.ringFindings || []);
  return [...fillNotes(rack, facts, nameOf), ...rings.map(f => f.text)];
}
