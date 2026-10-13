// A PART THE LIBRARY REPLACED, AT THE EXPLORER LENS (kit 0.32.0, kit/redirects.js).
// A saved rack may name a holder by a ref whose major was removed; Explorer shows
// only what a slot takes today and would drop it. The lens opens with the swaps
// read through the kit's `redirects`, so the replacement is what Explorer holds
// and what comes back. Pure, so the page and the tests share one rule.

import {followSwaps} from '../../vendor/redirects.js';

// {swaps, moved}: the swaps as the lens should open with them. `redirects` null
// (a components.json from before the key, or one that did not load) changes nothing.
export function swapsForLens(swaps, redirects) {
  return followSwaps(swaps && typeof swaps === 'object' ? swaps : {}, redirects);
}
