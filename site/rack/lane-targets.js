// The lane pick targets of a route being edited: one per U on each gutter beside
// a rail and, on a four-post (kit 0.42.0), one per U on the inner lane, the
// upright's own centre line between the rail and a part beside it. In the
// pane's user space; the rear pane mirrors the sides.

import {RU, RAIL_W, OPENING} from '../../vendor/rack/rails.js';
import {LANE_GAP, INNER} from '../../vendor/rack/route.js';

export function laneTargets(frame, view) {
  const sides = frame.kind === 'two-post' ? ['left', 'right'] : ['left', 'right'].map(sd => `${sd}-${view}`);
  const lanes = frame.kind === 'two-post' ? sides : [...sides, ...sides.map(s => `${s}${INNER}`)];
  const targets = [];
  for (const lane of lanes) {
    const left = (view === 'front') === lane.startsWith('left'), inner = lane.endsWith(INNER);
    const x = inner ? (left ? -RAIL_W : OPENING) : left ? -RAIL_W - LANE_GAP : OPENING + RAIL_W;
    for (let ru = 1; ru <= frame.heightRU; ru++)
      targets.push({lane, ru, x, y: (frame.heightRU - ru) * RU, w: inner ? RAIL_W : LANE_GAP, h: RU});
  }
  return targets;
}
