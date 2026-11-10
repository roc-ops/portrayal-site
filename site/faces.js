// WHICH FILE DRAWS A FACE (Portrayal #670).
//
// A drawing is written once and shared by every configuration that draws it
// identically, and the file is named after the FIRST of those configurations in
// manifest order - so r740xd's `lff12-mlff4-rlff2-rc0-noriser` front is
// `r740xd.lff12-rc0-noriser.front.svg`, and which name a configuration's face
// carries is not something to guess (configs.json does not list them in manifest
// order). `<device>.configs.json` says which
// file each configuration's face is, in `configs[].files`. Every face the site
// fetches by configuration goes through here; check-contract.py holds that no
// other code builds such a name by hand.
//
// `faceFile` is the kit's own (Portrayal kit/dist.js, since #670): look the
// file up in configs[].files, falling back to the pre-#670 name.
import {jdist, faceFile} from '../vendor/dist.js';
export {faceFile} from '../vendor/dist.js';

// THE DEFAULT FACE. The site does not serve a plain `<device>.<view>.svg` (a copy
// of the default configuration's face) for most devices; tools/pack-assets.py
// leaves them out and writes `default-faces.json`, `{device: {view: file}}`, which
// says which file draws each device's default face. Anything that wants "the"
// face of a device, with no configuration in hand, asks here.

/** default-faces.json, read once per page. */
export const defaultFaces = dist => jdist(`${dist}default-faces.json`);

/** The URL of ref's default face for `view` in a map `defaultFaces` returned, or null. */
export function defaultFaceIn(map, dist, ref, view) {
  const f = map?.[ref]?.[view];
  return f ? dist + f : null;
}

/** The URL of `ref`'s default face for `view`, or null if it has none. */
export async function defaultFace(dist, ref, view) {
  return defaultFaceIn(await defaultFaces(dist), dist, ref, view);
}

/** The URL of `view` of `ref` in configuration `config`, reading ref's configs.json. */
export async function faceUrl(dist, ref, config, view) {
  const index = await jdist(`${dist}${ref}.configs.json`).catch(() => null);
  return dist + faceFile(index || {device: ref}, config, view);
}
