// WHERE A BODY SITS IN THE UNITS ITS ITEM TAKES. One answer for the 2D
// elevation (elevation.js), its cable anchors (route-context.js portY) and the
// 3D rack (rack3d.js), so a body, its ports and its ears agree in both views.
//
// A rack item is placed by its bottom unit, and takes whole units: the rack
// file has no half position yet (designed, not built). So:
//
//   - A BODY OF ONE UNIT OR MORE is exactly where each view has always put
//     it. In 2D it is centred in its span (`units` x RU, the height the fit
//     rules give it: fit.js itemsWithU, never under one unit). In 3D it
//     stands on the bottom of its lowest unit (`stand`).
//   - A BODY UNDER ONE UNIT (catalogue `ru` below 1: the Fibrain XCU10, half a
//     unit, 22.2 mm) occupies the LOWER part of its unit: its span is its own
//     catalogue `ru` x RU, starting at the item's bottom, and the body is
//     centred in that, in both views. It was centred in the whole unit in 2D
//     and stood on the bottom in 3D, 11 mm apart, with a full-unit ear and
//     two screws round a half-unit body in both.
//
// Returns {units, span, inset, half}: `units` the span in U, `span` in mm,
// `inset` the gap in mm between the span's bottom and the body's (the same
// gap is above it, when centred), `half` whether the body is under one unit.
// The body's box above the item's bottom is [inset, inset + h].
//
// Nothing here places, fits or stores anything: the item's unit and the
// units it takes in the rack are the kit's, and unchanged.
import {RU} from '../../vendor/rack/rails.js';

export function bodySpan(ru, units, h, stand = false) {
  const half = typeof ru === 'number' && ru > 0 && ru < 1;
  const u = half ? ru : units;
  const span = u * RU;
  return {units: u, span, inset: stand && !half ? 0 : (span - h) / 2, half};
}

// The one rail hole a half-unit body's ear is fixed by: the lowest of its
// unit's three (rails.js HOLE_DY[0], 6.35 mm above the unit's bottom), which
// is the one inside the lower half.
export const HALF_HOLE = 0;
