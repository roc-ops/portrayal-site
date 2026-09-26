// WHERE A DEVICE MAY GO (spec §6). Pure: the rack, the candidate, and a
// chassisOf(ref) -> {ru, h, d} that the page backs with site/rack/chassis.json.
// Every refusal is a sentence, because the catalog shows it beside the device
// it grays out - "no" without a reason is a puzzle.
//
// Depth along the rack: a front-face device runs [0, d] back from the front
// rail; a rear-face one runs [railDepth - d, railDepth] forward from the rear
// rail. On four posts the two share a U when those do not overlap, which is
// dFront + dRear <= railDepth. Two-post rails are one plane that every body
// passes through, so there a U is never shared.

import {RU} from './rails.js';

export const REACH_MM = 50;   // within this of the far rail, a device's far panel is visible there

const mm = x => Math.round(x);
export function span(item, chassisOf) {
  const u = chassisOf(item.ref)?.ru ?? 1;
  return [item.ru, item.ru + Math.max(1, u) - 1];
}
const overlaps = (a, b) => a[0] <= b[1] && b[0] <= a[1];

export function fits(rack, cand, chassisOf, {ignoreId = null} = {}) {
  const f = rack.frame, c = chassisOf(cand.ref);
  if (!c) return {ok: false, reason: `No size is known for ${cand.ref}.`};
  const lo = cand.ru, hi = cand.ru + Math.max(1, c.ru) - 1;
  if (lo < 1) return {ok: false, reason: 'Below U1.'};
  if (hi > f.heightRU)
    return {ok: false, reason: `${c.ru}U needed; ${f.heightRU - lo + 1}U free from U${lo} to the top.`};
  if (c.d > f.usableDepth) return {ok: false, reason: `${mm(c.d)} mm deep; this rack allows ${mm(f.usableDepth)} mm.`};
  for (const o of rack.items) {
    if (o.id === ignoreId) continue;
    const oc = chassisOf(o.ref);
    if (!oc || !overlaps([lo, hi], span(o, chassisOf))) continue;
    if (o.face === cand.face) return {ok: false, reason: `Taken by ${o.label} on the ${o.face}.`};
    if (f.kind === 'two-post')
      return {ok: false, reason: `Taken by ${o.label}; two-post rails are shared by front and rear.`};
    if (c.d + oc.d > f.railDepth)
      return {ok: false, reason: `${mm(c.d)} mm deep; ${Math.max(0, mm(f.railDepth - oc.d))} mm free behind ${o.label}.`};
  }
  return {ok: true};
}

// Does this item show its other panel on the other face's elevation, or only
// a ghost of the space it takes?
export function reaches(item, rack, chassisOf) {
  if (rack.frame.kind === 'two-post') return true;
  return (chassisOf(item.ref)?.d ?? 0) >= rack.frame.railDepth - REACH_MM;
}

// The depth this item could have where it stands: what the other face leaves
// on the U range it shares, or the rack's usable depth.
export function availableDepth(rack, item, chassisOf) {
  const f = rack.frame;
  if (f.kind === 'two-post') return f.usableDepth;
  const mine = span(item, chassisOf);
  const other = rack.items.filter(o => o.id !== item.id && o.face !== item.face
                                       && overlaps(mine, span(o, chassisOf)));
  if (!other.length) return f.usableDepth;
  return Math.min(f.usableDepth, f.railDepth - Math.max(...other.map(o => chassisOf(o.ref)?.d ?? 0)));
}

// Every item with the U height its chassis entry gives it (or 1, unknown or
// not) - what the elevation, the 3D view and any export (Phase 1b) all need
// beside the item's own fields, so each draws the same rack.
export const itemsWithU = (rack, chassisOf) =>
  rack.items.map(i => ({...i, u: Math.max(1, chassisOf(i.ref)?.ru ?? 1)}));

export const attachPoints = kind => (kind === 'four-post'
  ? ['left-front', 'right-front', 'left-rear', 'right-rear'] : ['left', 'right']);

// SHRINK THE FRAME (feedback round 2 §2): a lower height that leaves devices
// hanging past it is no longer refused - it packs them down instead.
//
// Items whose U spans overlap (on either face - a front/rear pair sharing a
// U is one cluster) move together, keeping their offsets, faces and turned
// state. Clusters close their gaps by packing upward from U1 in their
// original bottom-to-top order; if the packed top still overshoots the new
// height, whole clusters are dropped from the bottom - lowest first - until
// the rest fits, then the remainder is packed again from U1.
export function shrinkRack(rack, newHeight, chassisOf) {
  const heightOf = item => Math.max(1, chassisOf(item.ref)?.ru ?? 1);
  const topOf = item => item.ru + heightOf(item) - 1;
  const withFrameHeight = items => ({...rack, frame: {...rack.frame, heightRU: newHeight}, items});

  if (rack.items.every(i => topOf(i) <= newHeight))
    return {rack: withFrameHeight(rack.items), moved: [], removed: []};

  // Group items into clusters by overlapping U spans (union-find), face
  // ignored - that is exactly what keeps a front/rear pair together.
  const items = rack.items;
  const n = items.length;
  const parent = items.map((_, i) => i);
  const find = x => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      if (overlaps(span(items[i], chassisOf), span(items[j], chassisOf))) {
        const a = find(i), b = find(j);
        if (a !== b) parent[a] = b;
      }
  const groups = new Map();
  items.forEach((it, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(it);
  });
  const clusters = [...groups.values()]
    .map(list => {
      const lo = Math.min(...list.map(i => i.ru));
      const hi = Math.max(...list.map(topOf));
      return {items: list, lo, height: hi - lo + 1};
    })
    .sort((a, b) => a.lo - b.lo); // original bottom-to-top order

  const pack = clusterList => {
    let cursor = 1;
    const moved = [];
    const packed = clusterList.map(c => {
      const shift = cursor - c.lo;
      const packedItems = c.items.map(it => {
        if (shift !== 0) moved.push(it.id);
        return {...it, ru: it.ru + shift};
      });
      cursor += c.height;
      return packedItems;
    });
    return {items: packed.flat(), moved, top: cursor - 1};
  };

  let survivors = clusters;
  let removed = [];
  if (clusters.reduce((h, c) => h + c.height, 0) > newHeight) {
    survivors = clusters.slice();
    while (survivors.length && survivors.reduce((h, c) => h + c.height, 0) > newHeight) {
      const [gone, ...rest] = survivors;
      removed.push(...gone.items);
      survivors = rest;
    }
  }
  const {items: packedItems, moved} = pack(survivors);
  return {rack: withFrameHeight(packedItems), moved, removed};
}

// ZERO-U (spec §5.3): along an attachment point, by offset in mm from the
// bottom of the rails. The catalog has none yet; the rules are here so the
// day it does, placing one is data, not a change to this file.
export function fitsZeroU(rack, cand, chassisOf, {ignoreId = null} = {}) {
  const f = rack.frame;
  if (!attachPoints(f.kind).includes(cand.at))
    return {ok: false, reason: `${cand.at} is not an attachment point of a ${f.kind} frame.`};
  const len = chassisOf(cand.ref)?.h;
  if (!len) return {ok: false, reason: `No size is known for ${cand.ref}.`};
  if (cand.offsetMm < 0 || cand.offsetMm + len > f.heightRU * RU)
    return {ok: false, reason: `${mm(len)} mm long; it runs past the top of the rack.`};
  for (const o of rack.zeroU) {
    if (o.id === ignoreId || o.at !== cand.at) continue;
    const ol = chassisOf(o.ref)?.h ?? 0;
    if (cand.offsetMm < o.offsetMm + ol && o.offsetMm < cand.offsetMm + len)
      return {ok: false, reason: `Overlaps ${o.label ?? o.ref} at ${o.at}.`};
  }
  return {ok: true};
}
