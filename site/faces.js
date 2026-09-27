// WHICH FILE DRAWS A FACE (Portrayal #670).
//
// A drawing is written once and shared by every configuration that draws it
// identically, and the file is named after the FIRST of those configurations in
// manifest order - so `s9600-72xc.base.front.svg` does not exist: `base` draws
// the same front as `ac`, which comes first. `<device>.configs.json` says which
// file each configuration's face is, in `configs[].files`. Every face the site
// fetches by configuration goes through here; check-contract.py holds that no
// other code builds such a name by hand.
//
// `faceFile` is the kit's own (`faceFile` in Portrayal's kit/dist.js, same
// signature, same fallback), kept here until the vendored kit carries it. Before
// #670 an index has no `files`, and the fallback is the name the build wrote -
// so this is right on both sides of the change.
import {jdist} from '../vendor/dist.js';

/** The file that draws `view` of configuration `config`, from a loaded configs.json. */
export function faceFile(index, config, view) {
  const f = index?.configs?.find(c => c.name === config)?.files?.[view];
  return f || `${index?.device}.${config}.${view}.svg`;
}

/** The URL of `view` of `ref` in configuration `config`, reading ref's configs.json. */
export async function faceUrl(dist, ref, config, view) {
  const index = await jdist(`${dist}${ref}.configs.json`).catch(() => null);
  return dist + faceFile(index || {device: ref}, config, view);
}
