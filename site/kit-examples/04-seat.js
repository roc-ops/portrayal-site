// Seat a real part in a cage: an SR optic in port-4, with its two LC plugs.
// The keys are drawing paths - the cage, then the optic's own LC bores - and
// the values are component references. applyFaceOverrides draws each part's
// own artwork into the face; encodeSwaps turns the same map into a URL slot.
import {applyFaceOverrides, encodeSwaps} from '@portrayal/kit/swap';
import {jdist} from '@portrayal/kit/dist';

const DIST = 'assets/dist/';  // wherever you host the compiled files

const seats = {
  'port-4': 'generic/sfp-lc@1',
  'port-4-occupant/tx': 'generic/lc-plug@2',
  'port-4-occupant/rx': 'generic/lc-plug@2',
};

export async function run(host) {
  const text = await fetch(`${DIST}s9600-72xc.base.front.svg`).then(r => r.text());
  host.insertAdjacentHTML('beforeend', text);
  const svg = host.querySelector('svg');          // in the document: the kit measures

  const idx = await jdist(`${DIST}s9600-72xc.configs.json`);
  const {components} = await jdist(`${DIST}components.json`);
  const byRef = ref => components.find(c => `${c.ns}/${c.name}@${c.major.slice(1)}` === ref.split(':')[0]);
  const loadSkin = async ref => {
    const c = byRef(ref);
    if (!c) return null;
    const skin = c.skins?.includes('default') ? 'default' : c.skins?.[0];
    const r = await fetch(`${DIST}components/${c.ns}--${c.name}--${c.major}--${skin}.svg`);
    return r.ok ? {comp: c, text: await r.text()} : null;
  };

  const res = await applyFaceOverrides(svg, {bays: idx.bays?.front || [], cages: idx.cages?.front || []},
                                       seats, loadSkin, byRef);
  const out = document.createElement('output');
  out.textContent = `?swaps=${encodeSwaps(seats)}`;
  host.append(out);
  return {seated: res.applied, refused: [...res.refused, ...res.failed], url: encodeSwaps(seats)};
}
