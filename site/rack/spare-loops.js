// site/rack/spare-loops.js
// WHERE A CABLE'S SPARE IS STORED, DRAWN (kit 0.35.0, Portrayal #1065). The
// kit stores spare in a finger duct the route uses, or on a tray it rests on,
// and gives the point each stored loop is at (slack.js spareMarks: rack mm,
// and the axis the pathway runs along there). The page draws a loop there, as
// it stands a tie strap at the kit's point (route-context.js tieStraps): x/y
// on the front and rear panes, z/y on the side panes, and in the 3D scene.
// Spare left at an end is not drawn: it is in the curves into the port.
//
// And a PART BESIDE THE RACK IN A ROUTE: the route editor offers its duct and
// each window through its back as pick targets ({item: <zero-U id>, via}),
// which the kit resolves to the lane run through it (route.js resolveRoute).

import {spareMarks, mText} from '../../vendor/rack/slack.js';
import {zeroUPathways} from '../../vendor/rack/route.js';
import {solidsOf} from '../../vendor/rack/solids.js';
import {RU} from '../../vendor/rack/rails.js';
import {svgEl} from './dom.js';

/** Every stored loop in the rack: the kit's spareMarks for each cable that
 *  names a duct or a tray in its `slack`, with the cable's id:
 *  [{cable, item, via, kind, form, metres, at: {x, y, z}, run}]. [] without
 *  the routes; a cable the kit cannot answer for is left out. */
export function spareLoops(rack, ctx) {
  if (!ctx) return [];
  const out = [];
  for (const c of rack?.cables || []) {
    if (!Array.isArray(c.slack) || !c.slack.some(e => e?.item)) continue;
    let ms = [];
    try { ms = spareMarks(rack, c, ctx); } catch (err) { console.warn(`[portrayal] where the spare of ${c.id} is stored could not be read`, err); }
    for (const m of ms) out.push({cable: c.id, ...m, at: {...m.at}});
  }
  return out;
}

/** The front or rear pane a loop is drawn on: the face it is nearer, by its
 *  depth (z is 0 at the front rails and runs negative to the rear). */
export const loopPane = (loop, frame) => (loop.at.z < -(frame?.railDepth ?? 740) / 2 ? 'rear' : 'front');

// A loop's size, mm: long along the duct it lies in, and round seen end on.
export const LOOP_LONG = 22, LOOP_SHORT = 9;
// The size above is for a loop of about a metre; one grows with the length it
// stores, between LOOP_MIN and LOOP_MAX times that, so 0.2 m reads smaller
// than 1.57 m and a very long spare does not swallow the manager it is in.
export const LOOP_MIN = 0.6, LOOP_MAX = 1.5;
/** How many times the plain size a loop of `metres` is drawn: 1 when the
 *  length is not known. */
export const loopScale = metres =>
  (Number.isFinite(metres) ? Math.min(LOOP_MAX, Math.max(LOOP_MIN, 0.5 + 0.5 * metres)) : 1);
/** [rx, ry] of a loop on a pane whose two axes are `axes` (rack axes, ['x',
 *  'y'] for a front or rear pane, ['z', 'y'] for a side pane), of the size
 *  `metres` of spare stores (the plain size without it). */
export function loopRadii(run, axes, metres) {
  const k = loopScale(metres), long = LOOP_LONG * k, short = LOOP_SHORT * k;
  if (!axes.includes(run)) return [short + 2, short + 2];
  return axes[0] === run ? [long, short] : [short, long];
}

/** "c15: 1.54 m spare, a loop in CMH-BS-SFDS1U duct". */
export const loopTitle = (loop, nameOf = id => id) =>
  `${loop.cable}: ${mText(loop.metres)} spare, a ${loop.form ?? 'loop'} in ${nameOf(loop.item)} ${loop.via}`;

// The loop's paint: amber, rimmed, so it reads on a light stage and a dark one.
export const LOOP_PAINT = {core: '#e0a526', rim: '#1b1d20'};

/** What a loop carries on any pane: `data-spare-loop` names it, and
 *  `data-members` its cable, so it is lit and dimmed with the cable as a tie
 *  strap is. */
export const loopAttrs = l => ({'data-spare-loop': `${l.cable}|${l.item}|${l.via}`, 'data-members': l.cable,
  'data-spare-run': l.run, 'data-spare-metres': String(Math.round(l.metres * 100) / 100)});

/** One loop on a pane, at `[cx, cy]` in its user space: two rings, one inside
 *  the other, as a coiled service loop reads, with its title. */
export function loopEl(l, [cx, cy], axes, nameOf) {
  const [rx, ry] = loopRadii(l.run, axes, l.metres);
  const g = svgEl('g', {...loopAttrs(l), 'pointer-events': 'none'});
  const ring = (a, b, dx, dy) => [
    svgEl('ellipse', {cx: cx + dx, cy: cy + dy, rx: a, ry: b, fill: 'none', stroke: LOOP_PAINT.rim, 'stroke-width': 3.6}),
    svgEl('ellipse', {cx: cx + dx, cy: cy + dy, rx: a, ry: b, fill: 'none', stroke: LOOP_PAINT.core, 'stroke-width': 2})];
  // the second turn a little along the run
  const along = rx >= ry ? [2.5, 0] : [0, 2.5];
  g.append(...ring(rx, ry, -along[0], -along[1]), ...ring(rx, ry, along[0], along[1]));
  const t = svgEl('title', {});
  t.textContent = loopTitle(l, nameOf);
  g.append(t);
  return g;
}

/** A part beside the rack's pick targets in the route editor: its duct, the
 *  whole part (`box`, where the pane draws it), and each window through its
 *  back, across the part at the heights the kit has the window's hole in its
 *  back plate (solids.js solidsOf). [{item, via, kind, box}], duct first, so a
 *  window over it takes the click. [] for a part with no pathway. */
export function zeroUTargets(rack, ctx, z, box) {
  const ways = zeroUPathways(rack, z, ctx);
  if (!ways.length) return [];
  const top = rack.frame.heightRU * RU;
  let holes = [];
  try { holes = solidsOf(rack, ctx).filter(s => s.item === z.id).flatMap(s => s.holes || []); } catch { holes = []; }
  const out = [];
  for (const p of ways.filter(p => p.kind === 'duct')) out.push({item: z.id, via: p.via, kind: 'duct', box});
  for (const p of ways.filter(p => p.kind === 'pass')) {
    const h = holes.find(x => x.via === p.via);
    if (h) out.push({item: z.id, via: p.via, kind: 'pass', box: {x: box.x, y: top - h.box.y1, w: box.w, h: h.box.y1 - h.box.y0}});
  }
  return out;
}
