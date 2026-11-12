// @portrayal/kit/shell as kit.html runs its recipes: the vendored module,
// with this site's DIST read through its packs (packs.js).
import {createShell as kitShell} from '../../vendor/shell.js';
import {onSite} from './packs.js';

export * from '../../vendor/shell.js';
export const createShell = opts => kitShell(onSite(opts));
