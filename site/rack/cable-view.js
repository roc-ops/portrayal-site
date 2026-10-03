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
import {drawCables2d, plugAt} from './cables.js';
import {svgEl} from './dom.js';
import {cablePlan, endKey, endName, tagText} from './cable-rules.js';

// mm beside the rack for cross-face tails and their tags (the showcase's
// own figure), and below it for a lead hanging from the lowest device.
export const ROOM = 260;
const DROP = 40;

// BOTH PANES WIDEN BY THE SAME COLUMN (ruling 5), so they keep one U scale
// and one zoom: the front pane to its right, the rear pane to its left - the
// two columns meet between the panes. Call it on both, before the zoom is
// applied (zoom.js reads the viewBox), and only when the rack has cables.
export function widenForCables(svg) {
  const b = svg.getAttribute('viewBox').split(/\s+/).map(Number);
  svg.dataset.baseBox = b.join(' ');
  const rear = svg.dataset.pane === 'rear';
  svg.setAttribute('viewBox', [rear ? b[0] - ROOM : b[0], b[1], b[2] + ROOM, b[3] + DROP].join(' '));
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
export function drawRackCables(svg, rack, reasons) {
  const pane = svg.dataset.pane, rear = pane === 'rear';
  const base = svg.dataset.baseBox.split(' ').map(Number);
  const edgeX = rear ? base[0] - 8 : base[0] + base[2] + 8;
  const cables = rack.cables;
  const plan = cablePlan(rack);
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
  const pill = (t, at, label) => {
    const w = 7 * label.length + 12;
    const x = rear ? at[0] - 4 - w : at[0] + 4;
    t.append(svgEl('rect', {x, y: at[1] - 9, width: w, height: 18, rx: 4}));
    const tx = svgEl('text', {x: x + 6, y: at[1] + 4}); tx.textContent = label; t.append(tx);
    return t;
  };
  const recs = drawCables2d(svg, plan, pane, {
    edgeX, outboard: rear ? -1 : 1,
    ends: (s, itemId, path) => (looseHere.has(`${itemId}|${path}`) ? null : endPoints(s, itemId, path)),
    farLoose: loose,
    // The far end is in the other pane: the tag names it.
    tag: (at, far, link) => pill(svgEl('g', {class: 'cable-tag', tabindex: '0', role: 'button'}), at,
                                 tagText(rack, farEnd(link, far))),
    // The far end does not land anywhere: the tag says so, and its title says why.
    looseTag: (at, far, link) => {
      const t = svgEl('g', {class: 'cable-tag not-connected', tabindex: '0', role: 'button'});
      const why = svgEl('title', {});
      why.textContent = reasons.get(endKey(farEnd(link, far))) || 'not connected';
      t.append(why);
      return pill(t, at, '✕ not connected');
    },
  });
  for (const rec of recs) {
    const c = cables[rec.i];
    for (const n of [rec.g, rec.tag]) if (n) n.setAttribute('data-cable-id', c.id);
    const title = rec.g?.querySelector('title');
    if (title) title.textContent = `${endName(rack, c.a)} → ${endName(rack, c.b)}${c.media ? ` · ${c.media}` : ''}`;
  }
  return recs;
}
