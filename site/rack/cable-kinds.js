// THE KINDS OF POWER CABLING, for the cable form (portrayal-site#202).
// The kit has two media for it (cable-rules.js MEDIA): `power`, a conductor
// that carries power, and `ground`, a bonding conductor. `power` is an AC cord
// or a DC feed, told apart by what its ends say (their AC or DC), so the form
// offers three KINDS over those two media, and the file holds the media alone:
// a kind is chosen, never stored.

export const KINDS = [
  {id: 'ac', media: 'power', label: 'Power cable (AC)'},
  {id: 'dc', media: 'power', label: 'DC feed'},
  {id: 'ground', media: 'ground', label: 'Ground wire'}];

export const kindLabel = id => KINDS.find(k => k.id === id)?.label ?? '';
export const mediaOfKind = id => KINDS.find(k => k.id === id)?.media ?? '';

// The kind a media and its two ends make, or null for a media that is no power
// cabling. A power media with a DC end is a DC feed; one that states nothing is
// an AC cord, as the kit reads it.
export function kindOfMedia(media, a = null, b = null) {
  if (media === 'ground') return 'ground';
  if (media !== 'power') return null;
  return a?.mode === 'dc' || b?.mode === 'dc' ? 'dc' : 'ac';
}

// The kit's mismatch cannot tell an AC cord from a DC feed (one media), so the
// kind chosen is held against the AC or DC each end states: a warning where it
// contradicts one, nothing where the end says nothing.
const ACDC = {ac: 'AC', dc: 'DC'};
export function kindWarnings(kind, a = null, b = null) {
  if (kind !== 'ac' && kind !== 'dc') return [];
  const out = [];
  for (const [k, e] of [['A', a], ['B', b]])
    if (e?.family === 'power' && ACDC[e.mode] && e.mode !== kind)
      out.push(`${kindLabel(kind)} does not suit end ${k}, which is ${ACDC[e.mode]} power.`);
  return out;
}

// Whether the form offers kinds at all: the cable is power cabling already, or
// an end says it is power or ground.
export const offersKinds = (media, a = null, b = null) =>
  media === 'power' || media === 'ground' || [a, b].some(e => e?.family === 'power' || e?.family === 'ground');
