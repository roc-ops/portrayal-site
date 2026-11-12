// THE KIT AS kit.html RUNS ITS RECIPES, OVER THIS SITE'S PACKS.
//
// A recipe is written for the published kit and a build served as one file
// per drawing: it hands createViewer and createShell where the compiled files
// live as a string, DIST. This site serves the library as packs (site/dist.js),
// which no plain URL reaches. So the import maps kit.html and kit-frame.html
// run the recipes with (not the one the page shows readers) send
// @portrayal/kit/viewer3d and @portrayal/kit/shell to the modules beside this
// one: the vendored module as it is, except that a `dist` naming this site's
// folder is read through siteDist (the kit's packedDist). Any other `dist`,
// and everything else the module exports, passes through untouched.
import {siteDist, DIST} from '../dist.js';

const HERE = new URL(DIST, location.href).href;
const PACKED = await siteDist();

/** `opts`, with a `dist` that names this site's folder (with or without its
 *  trailing slash, as the viewer and the shell each take it) made packedDist's. */
export function onSite(opts = {}) {
  const d = opts.dist;
  if (typeof d !== 'string') return opts;
  return new URL(d.endsWith('/') ? d : `${d}/`, location.href).href === HERE ? {...opts, dist: PACKED} : opts;
}
