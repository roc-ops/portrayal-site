// ONE RAIL, DRAWN TWICE. The 2D elevation (rack.js) and the 3D rack
// (rack3d.js) both draw their rails from this, and neither keeps a copy.
// They used to disagree: 26 mm rails in 2D, 16 mm posts in 3D, and the right
// 2D rail a copy of the left rather than its mirror, so it had numbers
// inside and cage-nut holes outside.
//
// EIA-310: hole centres 465.1 mm (18.312 in) apart across the rack, and
// within each U at 0.25, 0.875 and 1.5 in from its bottom edge.
//
// x is measured in mm from the rack's centre line, positive to the right.
// Numbers sit on each rail's OUTBOARD half and holes on its INBOARD half,
// so a device's ears land between the rails, where the screws go.

export const RU = 44.45;
export const RAIL_W = 26;
export const OPENING = 450.85;
export const HOLE_CC = 465.1;
export const HOLE_DY = [6.35, 22.22, 38.10];
// THE HOLES AN EAR CAN USE between two heights (mm above the bottom of the
// rails): every hole centre at least HOLE_EDGE inside the range. A half unit
// does not repeat the pattern: its lower half holds the hole at 6.35 and its
// upper half the one at 38.10, and the middle hole sits on the line between
// them, where no ear of either half can use it. A drawing lays the slots of
// a generic ear through this, over the span fit.js itemBox gives (`lo`, `hi`);
// the kit itself draws no ear, so its caller is the page.
export const HOLE_EDGE = 3;
export function holesIn(lo, hi) {
  const out = [];
  for (let u = Math.floor(lo / RU); u * RU < hi; u++)
    for (const dy of HOLE_DY) {
      const y = u * RU + dy;
      if (y >= lo + HOLE_EDGE && y <= hi - HOLE_EDGE) out.push(y);
    }
  return out;
}
// THE HOLES. EIA-310's square hole for a cage nut is 0.375 in (9.5 mm) - the
// 6.5 mm drawn before was a guess that read as a round-hole rail. A tapped
// rail is drawn round at about a 12-24's major diameter (0.216 in); a 10-32
// (4.8 mm) or an M6 (6 mm) would be within a pixel of it at any zoom.
export const HOLE_SQUARE = 9.5;
export const HOLE_ROUND = 5.5;
// The square hole, which is what rack3d.js and the showcase draw.
export const HOLE_SIZE = HOLE_SQUARE;

export const SIDES = ['left', 'right'].map(side => {
  const s = side === 'left' ? -1 : 1;
  return Object.freeze({
    side,
    inner: s * OPENING / 2,                    // the rail's edge facing the opening
    outer: s * (OPENING / 2 + RAIL_W),         // its edge facing away
    hole: s * HOLE_CC / 2,                     // hole centres: 7.1 mm into the rail
    number: s * (OPENING / 2 + RAIL_W * 0.7),  // number centres: the outboard half
  });
});
