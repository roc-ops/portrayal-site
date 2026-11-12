// @portrayal/kit/viewer3d as kit.html runs its recipes: the vendored module,
// with this site's DIST read through its packs (packs.js).
import {createViewer as kitViewer} from '../../vendor/viewer3d.js';
import {onSite} from './packs.js';

export * from '../../vendor/viewer3d.js';
export const createViewer = (container, opts) => kitViewer(container, onSite(opts));
