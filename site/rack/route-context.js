// WHAT A ROUTE NEEDS FROM THE DRAWINGS (the site's half; route.js is pure).
// Each placed item's configured faces give its guides - ring ends, ducts,
// pass-throughs - and its ports, which are turned here into route.js's rack
// coordinates: mm from the rack's center line, right as seen from the front.
// A rear-facing panel is seen mirrored, so its x is negated.

import {configuredFace} from './face.js';
import {resolveRoute, fill, capacityOver, routedLength, endPane} from './route.js';
import {portPathOf} from './cable-rules.js';
import {RU} from './rails.js';

const toRack = (x, face, w) => (face === 'rear' ? -(x - w / 2) : x - w / 2);

// rects: [{id, kind?, cls?, x, y, w, h}] in face coordinates; a ring END
// (`<via>-end`, kind ring) stands for its ring; `guide--<via>` is a duct; `pass--<via>` a pass-through.
export function guidesFromRects(rects, face, faceW, apertures = {}) {
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
    out.push({via, kind, face, x: toRack(r.x + r.w / 2, face, faceW), box: {x: r.x, y: r.y, w: r.w, h: r.h}, aperture});
  }
  return out;
}

// Ring GROUPS: a device whose D-rings are drawn as groups (`<g id="guide-N"
// data-group="guides" data-ref=...>`, no `-end` rect) still has rings. groups:
// [{id, x, w}] where x is the group's left edge and w its width, in face
// coordinates (its translate plus its child rects' extent). Aperture unknown.
export function ringGroupsFrom(groups, face, faceW) {
  return groups.map(g => ({via: g.id, kind: 'ring', face, x: toRack(g.x + g.w / 2, face, faceW),
                           box: {x: g.x, y: 0, w: g.w, h: 0}, aperture: null}));
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

const faceOf = it => view => configuredFace({ref: it.ref, cfg: it.cfg, view, swaps: it.swaps || {}, fields: it.fields || {}})
  .catch(() => null);

export async function routeFacts(rack, chassisOf) {
  const guides = new Map(), ports = new Map();
  await Promise.all(rack.items.map(async it => {
    const c = chassisOf(it.ref) || {};
    const get = faceOf(it);
    const [front, rear, top] = await Promise.all([get('front'), get('rear'), c.guides?.top ? get('top') : null]);
    const aps = top ? aperturesOf(rootOf(top.text)) : {};
    const list = [];
    // Its outward panel is on its face; the other panel faces the other way.
    const facing = {front: it.turned ? (it.face === 'front' ? 'rear' : 'front') : it.face};
    facing.rear = facing.front === 'front' ? 'rear' : 'front';
    for (const [view, f] of [['front', front], ['rear', rear]]) {
      if (!f) continue;
      const w = f.vb?.[2] ?? 483, root = rootOf(f.text);
      list.push(...guidesFromRects(rectsOf(root), facing[view], w, aps),
                ...ringGroupsFrom(ringGroupsOf(root), facing[view], w));
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
  return {ctx, routes, fill: fill(rack, ctx), over: capacityOver(rack, ctx), lengths, endPane: e => endPane(rack, e)};
}
