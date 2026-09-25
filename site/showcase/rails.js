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
export const HOLE_SIZE = 6.5;

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
