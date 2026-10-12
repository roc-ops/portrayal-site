// site/rack/reading.js
// ONE READING OF A RACK, SHARED (portrayal-site#192).
//
// What the page works out from a rack - the route of every cable, its path,
// its length, the fill, the findings, the bundles and their straps
// (route-context.js routeFacts) - takes seconds on a large rack, and it was
// worked out again by everyone who wanted it: each redraw, each export, and
// each call an assistant made, which is why a tool call on a rack of 275
// cables took half a minute. A rack is never changed in place (the editor
// replaces it: vendor/rack/editor.js), so what was read for a rack OBJECT is
// true for as long as that object is the rack. It is read once and handed to
// every reader.
//
// WHAT IT IS KEYED ON, and so what makes it be read again:
//   - the rack object. Every step (an edit, an undo, a redo, another document)
//     is a new one, and is read afresh.
//   - `chassisOf`, the catalogue's lookup: the page gets one when its
//     catalogue loads, and a reading made with another is not handed out.
//   Nothing else a reading depends on can change under a page: the drawings
//   and the cable types are files of the site's build.
//
// WHAT IS NOT KEPT: a reading for which anything failed to load (routeFacts'
// `whole`: a face, a plug's panel, a duct's drawing, the cables' faces), and
// one that threw. Each is given to whoever asked, as before, and the next ask
// reads again, so a fetch that failed once is not the rack's answer for good.
//
// A RACK THAT DIFFERS IN NOTHING A ROUTE READS (a change that is not a step:
// the routed lengths the page itself writes, the DCIM settings) is a new
// object with the same reading: `sameReading(before, after)` says so, as
// rack-page.js keepRoutes does for the routes the page draws by. The kit
// reads a cable's routed length off its path, never off the cable, and no
// route reads the DCIM settings.
//
// THE ANSWERS BUILT ON A READING (`once`): what an assistant's tool reads
// from the kit for a rack - a window of describe, one inspect - is the same
// for the same rack object, reading and question, and the kit lays every
// cable again each time it is asked (it keeps which lay it chose, not the
// lay). They are kept for the rack object, with the objects they were built
// from, and go when it does.

import {routeFacts} from './route-context.js';

// rack -> {chassisOf, promise, dead}
const kept = new WeakMap();

/** The routes of `rack` (route-context.js routeFacts' answer), read once for
 *  this rack object and `chassisOf`. `cableFacts` are the caller's, when it
 *  has just read them (the reading does not read them again); a later caller
 *  is handed the same answer whether it has them or not, so they must be this
 *  rack's. Rejects as routeFacts does. */
export function routesOf(rack, chassisOf, {cableFacts = null} = {}) {
  const hit = kept.get(rack);
  if (hit && !hit.dead && hit.chassisOf === chassisOf) return hit.promise;
  const entry = {chassisOf, promise: null, dead: false};
  entry.promise = routeFacts(rack, chassisOf, {cableFacts}).then(
    rf => { if (!rf?.whole) entry.dead = true; return rf; },
    err => { entry.dead = true; throw err; });
  kept.set(rack, entry);
  return entry.promise;
}

/** `after` is `before` in everything a route reads: the reading of one is the
 *  other's. Nothing happens when `before` has none. */
export function sameReading(before, after) {
  const hit = kept.get(before);
  if (hit && !hit.dead && before !== after) kept.set(after, hit);
}

/** Whether a reading of `rack` is held (finished or on its way) for `chassisOf`. */
export const hasReading = (rack, chassisOf) => { const hit = kept.get(rack); return !!hit && !hit.dead && hit.chassisOf === chassisOf; };

// AN ANSWER, ONCE FOR A RACK AND A QUESTION. `key` names the question and
// `deps` are the objects the answer was built with (the route context, the
// cable types' lookups, the catalogue's): the same rack object, key and deps
// give the kept answer; anything else works it out with `make` and keeps
// that. An answer that throws, a promise that rejects, and one `keep(value)`
// turns down are given and not kept. At most ANSWERS_KEPT a rack, the oldest
// out first. Answers live with the rack object and go when it does.
export const ANSWERS_KEPT = 600;
const answers = new WeakMap();   // rack -> Map(key -> {deps, value})
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
export function once(rack, key, deps, make, keep = () => true) {
  let map = answers.get(rack);
  if (!map) answers.set(rack, map = new Map());
  const hit = map.get(key);
  if (hit && same(hit.deps, deps)) return hit.value;
  const value = make();
  const entry = {deps, value};
  const drop = () => { if (map.get(key) === entry) map.delete(key); };
  map.delete(key);
  map.set(key, entry);
  while (map.size > ANSWERS_KEPT) map.delete(map.keys().next().value);
  if (value && typeof value.then === 'function') value.then(v => { if (!keep(v)) drop(); }, drop);
  else if (!keep(value)) drop();
  return value;
}
