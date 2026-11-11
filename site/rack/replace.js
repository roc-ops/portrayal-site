// REPLACE A PLACED DEVICE: one device out and another in at the same place, as
// one step. Both commands go in one batch, so the kit refuses the two together
// and one Undo takes back both.
//
// The new device keeps the old one's bottom U, the way every place and move is
// said. A taller one that has no room above keeps the old one's top instead, so
// a device under a neighbour can still grow downwards.

import {fits, itemUnits, unitsOf} from '../../vendor/rack/fit.js';

// `without` is the rack with the old device gone, as the editor's preview of the
// remove gives it: what the new device is judged against.
export function replaceSpot(without, item, entry, chassisOf) {
  const there = ru => fits(without, {ref: entry.name, face: item.face, ru}, chassisOf).ok;
  const bottom = item.ru, top = item.ru + itemUnits(item, chassisOf) - unitsOf(entry);
  return there(bottom) || !there(top) ? bottom : top;
}

export const replaceCommands = (item, {ref, cfg, ru, label}) => [
  {op: 'remove', id: item.id},
  {op: 'place', ref, cfg, face: item.face, ru, label},
];
