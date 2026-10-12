// ONE READING OF A RACK (site/rack/reading.js, portrayal-site#192): the routes
// are read once for a rack object and handed to every reader; an answer built
// on them is kept for the rack object, the question and what it was built
// from; and the kinds the cable list folds its warnings by are the sentences
// routeNotes gives, in its order.
import test from 'node:test';
import assert from 'node:assert/strict';
import {routesOf, sameReading, hasReading, once, ANSWERS_KEPT} from '../../site/rack/reading.js';
import {routeNotes, routeNoteGroups, reads} from '../../site/rack/route-context.js';
import {newRack} from '../../vendor/rack/model.js';

const chassisOf = () => null;
// a rack with nothing in it reads no drawing, so it is read here as the page reads one
const empty = () => ({...newRack(), items: [], cables: []});

test('a rack object is read once, whoever asks, and another rack object is read afresh', async () => {
  const r = empty(), was = reads.routeFacts;
  const [a, b] = await Promise.all([routesOf(r, chassisOf), routesOf(r, chassisOf)]);
  assert.equal(a, b, 'two readers of one rack object are handed one reading');
  assert.equal(await routesOf(r, chassisOf), a, 'and so is a later one');
  assert.equal(reads.routeFacts - was, 1, 'the routes were read once');
  assert.equal(a.whole, true, 'nothing failed to load, so it is one to keep');
  // the same content in another object is another rack: an edit makes one, and it is read
  const r2 = {...r};
  assert.notEqual(await routesOf(r2, chassisOf), a);
  assert.equal(reads.routeFacts - was, 2);
});

test('the reading is for the catalogue it was read with', async () => {
  const r = empty(), other = () => null, was = reads.routeFacts;
  const a = await routesOf(r, chassisOf);
  assert.equal(hasReading(r, chassisOf), true);
  assert.equal(hasReading(r, other), false);
  assert.notEqual(await routesOf(r, other), a, 'another lookup is another reading');
  assert.equal(reads.routeFacts - was, 2);
});

test('a rack that differs in nothing a route reads shares the reading; one that was never read gives none to share', async () => {
  const r = empty(), was = reads.routeFacts;
  const a = await routesOf(r, chassisOf);
  const lengthsWritten = {...r, dcim: {site: 'x'}};
  sameReading(r, lengthsWritten);
  assert.equal(await routesOf(lengthsWritten, chassisOf), a);
  assert.equal(reads.routeFacts - was, 1, 'nothing was read again');
  assert.equal(a.readRack, r, 'and it still says which rack it was read from');
  const unread = empty(), next = {...unread};
  sameReading(unread, next);
  assert.equal(hasReading(next, chassisOf), false);
});

test('a reading that could not load everything, and one that threw, are given and not kept', async () => {
  // a cabled end whose panel cannot be read here (there is no page to fetch a drawing from)
  const r = {...empty(), items: [{id: 'i1', ref: 'no-such-device', cfg: 'base', label: 'x', ru: 1, face: 'front', turned: false, swaps: {}, fields: {}}],
             cables: []};
  const warn = console.warn;
  console.warn = () => {};
  try {
    const was = reads.routeFacts;
    const a = await routesOf(r, chassisOf).catch(() => null);
    assert.ok(a === null || a.whole === false, 'a face could not be read');
    assert.equal(hasReading(r, chassisOf), false, 'so the reading is not one to hand out');
    await routesOf(r, chassisOf).catch(() => null);
    assert.equal(reads.routeFacts - was, 2, 'the next ask reads again');
  } finally { console.warn = warn; }
});

test('once: the same rack object, question and makings give the kept answer; any other is worked out', () => {
  const r = {}, ctx = {}, types = {};
  let made = 0;
  const ask = (rack, key, deps) => once(rack, key, deps, () => ({n: ++made}));
  const a = ask(r, 'describe', [ctx, types]);
  assert.equal(ask(r, 'describe', [ctx, types]), a);
  assert.equal(made, 1);
  assert.notEqual(ask(r, 'describe 2', [ctx, types]), a, 'another question');
  assert.notEqual(ask({}, 'describe', [ctx, types]), a, 'another rack object');
  assert.notEqual(ask(r, 'describe', [{}, types]), a, 'another route context');
  assert.equal(made, 4);
  // the newest makings are the ones kept
  assert.equal(ask(r, 'describe', [ctx, types]).n, 5, 'the answer for the makings before was put out by the one after');
});

test('once: what throws, what rejects and what is turned down are not kept; a promise is shared while it runs', async () => {
  const r = {};
  let made = 0;
  assert.throws(() => once(r, 'k', [], () => { made++; throw new Error('no'); }));
  assert.throws(() => once(r, 'k', [], () => { made++; throw new Error('no'); }));
  assert.equal(made, 2, 'a throw is asked again');
  const p1 = once(r, 'p', [], async () => { made++; throw new Error('no'); });
  await assert.rejects(p1);
  await assert.rejects(once(r, 'p', [], async () => { made++; throw new Error('no'); }));
  assert.equal(made, 4, 'a rejection is asked again');
  const slow = once(r, 's', [], () => new Promise(done => setTimeout(() => done(++made), 5)));
  assert.equal(once(r, 's', [], () => { throw new Error('not asked'); }), slow, 'a second asker waits on the first');
  assert.equal(await slow, 5);
  // turned down by `keep`: given to its asker, and asked again by the next
  let ok = false;
  assert.equal(await once(r, 'u', [], async () => 'unchecked', () => ok), 'unchecked');
  ok = true;
  assert.equal(await once(r, 'u', [], async () => 'checked', () => ok), 'checked');
  assert.equal(await once(r, 'u', [], async () => 'never', () => ok), 'checked');
});

test('once: a rack keeps a bounded number of answers, the oldest out first', () => {
  const r = {};
  for (let k = 0; k <= ANSWERS_KEPT; k++) once(r, `q${k}`, [], () => k);
  assert.equal(once(r, `q${ANSWERS_KEPT}`, [], () => 'again'), ANSWERS_KEPT, 'the newest is kept');
  assert.equal(once(r, 'q0', [], () => 'again'), 'again', 'the oldest went');
});

test('the kinds the list folds its warnings by are routeNotes, in order, a kind with none left out', () => {
  const rack = {...empty(), items: [{id: 'i1', label: 'Leaf', ref: 'x'}]};
  const facts = {fill: [{item: 'i1', via: 'guide-1', count: 9, percent: 140, over: true, cables: []}], over: [], routes: new Map(),
                 ringFindings: [{text: 'ring one'}, {text: 'ring two'}], bodyFindings: [{text: 'body one'}]};
  const bends = [{text: 'bend one'}, {text: 'bend two'}];
  const name = id => (id === 'i1' ? 'Leaf' : id);
  const groups = routeNoteGroups(rack, facts, name, {bends, asRead: true});
  assert.deepEqual(groups.map(g => [g.kind, g.notes.length]), [['pathways', 1], ['rings', 2], ['bodies', 1], ['bends', 2]]);
  assert.deepEqual(groups.flatMap(g => g.notes), routeNotes(rack, facts, name, {bends, asRead: true}));
  assert.match(groups[0].notes[0], /^guide-1 on Leaf: 9 cables, 140% of a 40% fill\.$/);
  // the cable schedule leaves the bodies out; a kind with nothing to say is not a kind
  assert.deepEqual(routeNoteGroups(rack, {...facts, fill: []}, name, {bodies: false}).map(g => g.kind), ['rings']);
  assert.deepEqual(routeNoteGroups(rack, null), []);
});

// ── what an assistant reads of the routes (site/rack/agent-read.js) ────────
import {describeOnce, inspectOnce} from '../../site/rack/agent-read.js';

// A describe shaped as the kit's is: a first line, the frame, the routes' lines, then the window's own.
function fakeDescribe({routeInWindow = false} = {}) {
  const calls = [];
  const describe = (rack, ctx, {section = null, offset = 0, limit = 20} = {}) => {
    calls.push({route: !!ctx.route, limit});
    const cables = rack.cables.slice(offset, offset + limit);
    return [`${rack.name}: ${rack.cables.length} cables. Cables ${offset + 1}-${offset + cables.length} shown.`, '42U four-post.',
      ...(ctx.route ? ['Findings: 2 cables cross a body.', 'Spare: 1.2 m; 0 cords not placed.'] : []),
      'Cables:', ...cables.map(c => `${c.id}${routeInWindow && ctx.route ? ', 2 m routed' : ''}`)].join('\n');
  };
  return {describe, calls};
}
const rackOf = n => ({name: 'R', cables: Array.from({length: n}, (_, k) => ({id: `c${k + 1}`})), bundles: []});

test('describe with the routes is asked of the kit once for a window; a smaller window is put together from the answer without them', () => {
  const {describe, calls} = fakeDescribe(), r = rackOf(30), ctx = {route: {}, chassisOf: () => null};
  const big = describeOnce(describe, r, {offset: 0, limit: 20}, ctx);
  assert.equal(big, describe(r, ctx, {offset: 0, limit: 20}));
  const withRoutes = () => calls.filter(c => c.route).length;
  const before = withRoutes();
  for (const limit of [12, 7, 1]) {
    const small = describeOnce(describe, r, {offset: 0, limit}, ctx);
    assert.equal(withRoutes(), before, `the window of ${limit} was not asked of the kit with the routes`);
    assert.equal(small, describe(r, ctx, {offset: 0, limit}), `and is the kit's own answer for ${limit}`);
    calls.pop();   // the comparison's own call
  }
  // asked again: nothing at all is asked
  const n = calls.length;
  assert.equal(describeOnce(describe, r, {offset: 0, limit: 20}, ctx), big);
  assert.equal(describeOnce(describe, r, {offset: 0, limit: 7}, ctx), describe(r, ctx, {offset: 0, limit: 7}));
  assert.equal(calls.length, n + 1, 'only the comparison asked');
});

test('a larger window, another offset, another rack object and another route context are each asked of the kit whole', () => {
  const {describe, calls} = fakeDescribe(), r = rackOf(60), ctx = {route: {}};
  const routed = () => calls.filter(c => c.route).length;
  describeOnce(describe, r, {offset: 0, limit: 10}, ctx);
  assert.equal(routed(), 1);
  describeOnce(describe, r, {offset: 0, limit: 30}, ctx);
  assert.equal(routed(), 2, 'a larger window lists entries the first never saw');
  describeOnce(describe, r, {offset: 0, limit: 25}, ctx);
  assert.equal(routed(), 2, 'and what it learnt serves the windows under it');
  describeOnce(describe, r, {offset: 30, limit: 10}, ctx);
  assert.equal(routed(), 3, 'another offset');
  describeOnce(describe, {...r}, {offset: 0, limit: 10}, ctx);
  assert.equal(routed(), 4, 'another rack object: an edit');
  describeOnce(describe, r, {offset: 0, limit: 10}, {route: {}});
  assert.equal(routed(), 5, 'another route context');
  // without the routes nothing is kept: the kit lays nothing for it
  const n = calls.length;
  describeOnce(describe, r, {offset: 0, limit: 10}, {});
  describeOnce(describe, r, {offset: 0, limit: 10}, {});
  assert.equal(calls.length, n + 2);
});

test('where a window\'s own lines read the routes, nothing is put together: every window is asked of the kit whole', () => {
  const {describe, calls} = fakeDescribe({routeInWindow: true}), r = rackOf(30), ctx = {route: {}};
  describeOnce(describe, r, {offset: 0, limit: 20}, ctx);
  const before = calls.filter(c => c.route).length;
  const small = describeOnce(describe, r, {offset: 0, limit: 5}, ctx);
  assert.equal(calls.filter(c => c.route).length, before + 1, 'the smaller window was asked with the routes');
  assert.equal(small, describe(r, ctx, {offset: 0, limit: 5}));
  // a refusal is the kit's, and is not put together either
  const refuses = (rack, c, win) => (win.section === 'nope' ? {error: 'There is no section nope.'} : describe(rack, c, win));
  assert.deepEqual(describeOnce(refuses, r, {section: 'nope', offset: 0, limit: 5}, ctx), {error: 'There is no section nope.'});
});

test('inspect of a cable or a bundle with the routes is asked once; a device, and anything without the routes, each time', async () => {
  let asked = 0;
  const inspect = async (rack, id, ctx) => { asked++; if (ctx.cableFacts) await ctx.cableFacts(rack); return {id, n: asked}; };
  const r = {...rackOf(3), bundles: [{id: 'b1'}], items: [{id: 'i1'}]};
  const good = {}, cableFacts = async () => good, ctx = {route: {}, cableFacts};
  const a = await inspectOnce(inspect, r, 'c1', ctx, f => f === good);
  assert.equal(await inspectOnce(inspect, r, 'c1', ctx, f => f === good), a);
  await inspectOnce(inspect, r, 'b1', ctx); await inspectOnce(inspect, r, 'b1', ctx);
  assert.equal(asked, 2, 'a cable and a bundle, once each');
  await inspectOnce(inspect, r, 'i1', ctx); await inspectOnce(inspect, r, 'i1', ctx);
  assert.equal(asked, 4, 'a device is asked each time');
  await inspectOnce(inspect, r, 'c1', {cableFacts}); await inspectOnce(inspect, r, 'c1', {cableFacts});
  assert.equal(asked, 6, 'and so is a cable read without the routes');
  // read while the cables' faces could not all be loaded: given, and asked again
  await inspectOnce(inspect, r, 'c2', ctx, () => false);
  await inspectOnce(inspect, r, 'c2', ctx, () => false);
  assert.equal(asked, 8);
  assert.notEqual(await inspectOnce(inspect, {...r}, 'c1', ctx, f => f === good), a, 'another rack object is asked afresh');
});
