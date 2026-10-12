// site/rack/agent-read.js
// WHAT AN ASSISTANT READS OF THE ROUTES, ANSWERED ONCE FOR A RACK
// (portrayal-site#192). Two of the kit's queries lay cables: `describe` with
// the routes, whose two lines of totals ("Findings: ...", "Spare: ...") lay
// every cable of the rack, and `inspect` of a cable or a bundle. The kit keeps
// which lay of a cable it chose, not the lay, so each call laid them all
// again; and describe_rack calls describe once for every smaller window it
// tries until the answer fits (agent-tools.js), seven times on a rack of 275
// cables. Here each is asked of the kit once for a rack object and what it was
// built from (reading.js `once`), and a smaller window of a describe already
// answered is put together without asking the kit to lay anything.
//
// No text is written here: every line is the kit's.
//
// Pure apart from what it is handed (the kit's two queries), so it is tested
// in Node.

import {once} from './reading.js';

// What an answer with the routes was built from: the route context, the cable
// types' two lookups, the catalogue's, and the reader of the cables' faces.
const depsOf = ctx => [ctx.route ?? null, ctx.diameterOf ?? null, ctx.bendOf ?? null, ctx.chassisOf ?? null, ctx.cableFacts ?? null];

// A WINDOW OF DESCRIBE WITH THE ROUTES. The kit's answer for a window is, in
// order: its first line, the frame's line, the lines the routes give (the
// totals of the findings and of the spare, which do not depend on the window),
// then the window's own lines, of which only a bundle's reads the routes.
//
// The first window asked of a section and offset is asked of the kit whole.
// It is then asked again WITHOUT the routes, which lays nothing, and the two
// are compared: if the answer with the routes is exactly the one without, with
// some lines put in after the second, those lines are the routes' and nothing
// else in the window read them. A smaller window of the same section and
// offset (describe_rack's next try) lists a prefix of the same entries, so it
// is the kit's answer without the routes with the same lines put in at the
// same place. If the two do not line up that way (a bundle is listed, or the
// kit has changed how it writes an answer), nothing is put together: every
// window is asked of the kit whole, as before.
const linesOf = text => text.split('\n');
function routeLines(withRoutes, without) {
  if (typeof withRoutes !== 'string' || typeof without !== 'string') return null;
  const w = linesOf(withRoutes), p = linesOf(without), k = w.length - p.length;
  if (k < 0 || p.length < 2) return null;
  const lines = w.slice(2, 2 + k);
  return [...p.slice(0, 2), ...lines, ...p.slice(2)].join('\n') === withRoutes ? lines : null;
}
const put = (without, lines) => { const p = linesOf(without); return [...p.slice(0, 2), ...lines, ...p.slice(2)].join('\n'); };

// What was learnt of a section and offset: rack -> Map(family -> {deps, limit, lines}), `lines` null where the two
// answers did not line up. Kept with the rack object, and only for the makings it was learnt with.
const learnt = new WeakMap();
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/** describe(rack, ctx, win) of the kit, once for a rack object, a window and
 *  what `ctx` was built from. Without the routes it is the kit's, asked each
 *  time: it lays nothing.
 *
 *  `read` is the rack to ask the kit of WITH the routes (reading.js askOf):
 *  the rack they were read from, when `rack` differs from it only in routed
 *  lengths rewritten, for which the kit has every cable decided; else `rack`.
 *  The routes' lines are the same for both (they read no stored length), and
 *  the window's own lines, which say each cable's length, are always `rack`'s.
 *  Where the routes' lines cannot be told apart from the window's (a bundle is
 *  listed), `rack` is asked whole. */
export function describeOnce(describe, rack, win = {}, ctx = {}, read = rack) {
  if (!ctx.route) return describe(rack, ctx, win);
  const deps = depsOf(ctx), {section = null, offset = null, limit = null} = win ?? {};
  return once(rack, `describe ${JSON.stringify([section, offset, limit])}`, deps, () => {
    const family = JSON.stringify([section, offset]);
    const without = of => describe(of, {...ctx, route: undefined}, win);
    let map = learnt.get(read);
    if (!map) learnt.set(read, map = new Map());
    const known = map.get(family);
    const windowed = Number.isInteger(limit);
    if (known?.lines && same(known.deps, deps) && windowed && limit <= known.limit) {
      const plain = without(rack);
      if (typeof plain === 'string') return put(plain, known.lines);
    }
    if (!windowed) return describe(rack, ctx, win);
    // asked of `read` with the routes and without: what the routes add, and whether it is only lines of their own
    const answer = describe(read, ctx, win);
    let lines = null;
    if (typeof answer === 'string') { try { lines = routeLines(answer, without(read)); } catch { lines = null; } }
    if (typeof answer === 'string' && !(known && same(known.deps, deps) && known.limit >= limit)) map.set(family, {deps, limit, lines});
    if (read === rack) return answer;
    if (lines) { const plain = without(rack); if (typeof plain === 'string') return put(plain, lines); }
    return describe(rack, ctx, win);
  });
}

/** inspect(rack, id, ctx) of the kit. A cable's and a bundle's, read with the
 *  routes, are asked once for a rack object and what `ctx` was built from;
 *  anything else lays nothing and is asked each time. `stands(facts)` says
 *  whether a reading of the cables' faces is one to build a kept answer on
 *  (cable-plugs.js factsStand): an inspect read while a panel could not be
 *  loaded is given and not kept, so the next ask reads the faces again. */
export function inspectOnce(inspect, rack, id, ctx = {}, stands = () => true) {
  const lays = ctx.route && ((rack.cables ?? []).some(c => c.id === id) || (rack.bundles ?? []).some(b => b.id === id));
  if (!lays) return inspect(rack, id, ctx);
  let stood = true;
  const facts = ctx.cableFacts && (async (...args) => { const f = await ctx.cableFacts(...args); if (!stands(f)) stood = false; return f; });
  return once(rack, `inspect ${id}`, depsOf(ctx), () => inspect(rack, id, facts ? {...ctx, cableFacts: facts} : ctx), () => stood);
}
