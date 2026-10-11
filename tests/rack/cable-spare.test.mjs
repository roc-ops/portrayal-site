// A CORD'S SPARE (site/rack/spare.js): the cord's length less what its route
// uses, which is the kit's path and the kit's sourced end allowance at each
// end, and not the dressing allowance the kit's routed length adds on top.
// The page draws a cable's path and nothing more, so the list, the hover
// label and the agent's text say the spare. No cord is marked for having much
// of it; an entered cord shorter than the stock size its route asks for is.
//
// The expected figures here are worked from the path's points and the kit's
// table, never from spare.js's own route to them (the kit's `measured` less
// the dressing allowance), so the two have to agree.
import test from 'node:test';
import assert from 'node:assert/strict';
import {dressingAllowance, usedMetres, spareOf, sparesOf, spareFor, looseIn, spareText, spareAmount, asksText,
        SPARE_HELP} from '../../site/rack/spare.js';
import {cableMeta} from '../../site/rack/cable-panel.js';
import {cableText} from '../../site/rack/agent-text.js';
import {endAllowance, pathLength, stockLength, END_ALLOWANCE_BY_MEDIA} from '../../vendor/rack/route.js';
import {endKey} from '../../vendor/rack/cable-rules.js';

// A path of `mm` millimetres in three legs, as routePath hands one over: its
// points and its cable's end allowance.
const pathOf = (mm, cable) => ({points: [{x: 0, y: 0, z: 0}, {x: mm / 2, y: 0, z: 0}, {x: mm / 2, y: mm / 4, z: 0}, {x: mm / 2, y: mm / 4, z: mm / 4}],
  allowance: endAllowance(cable)});
// A cable as the page keeps it once routed: the kit's stock size, in metres.
const routed = (id, media, mm) => {
  const c = {id, media, a: {item: 'sw', path: `port-${id}`, view: 'front'}, b: {item: 'pp', path: `port-${id}`, view: 'front'}};
  const got = pathLength(pathOf(mm, c));
  return {...c, length: {value: got.value, unit: 'm', source: 'routed', measured: Math.round(got.measured * 100) / 100}};
};
const near = (got, want, what) => assert.ok(Math.abs(got - want) < 1e-9, `${what}: ${got}, expected ${want}`);

test('the dressing allowance is read for each media: what the kit adds on top of that media\'s table figure', () => {
  for (const [media, table] of Object.entries(END_ALLOWANCE_BY_MEDIA)) {
    near(dressingAllowance({media}), endAllowance({media}) - table, `${media}'s end allowance less its table figure`);
    assert.ok(dressingAllowance({media}) >= 0);
  }
  // a cable with no media, or one the table does not know, takes the copper cord's figure, as the kit does
  for (const c of [null, {}, {media: 'coax'}]) {
    assert.equal(endAllowance(c), endAllowance({media: 'cat6'}));
    near(dressingAllowance(c), endAllowance(c) - END_ALLOWANCE_BY_MEDIA.cat6, 'no media');
  }
});

test('what a routed cable uses is its path and the table figure at each end', () => {
  for (const [media, table] of Object.entries(END_ALLOWANCE_BY_MEDIA))
    near(usedMetres(pathOf(300, {media}), {media}), 0.3 + 2 * table, `${media} on a 300 mm path`);
  near(usedMetres(pathOf(300, null), null), 0.3 + 2 * END_ALLOWANCE_BY_MEDIA.cat6, 'no media on a 300 mm path');
  assert.equal(usedMetres(null, {media: 'om4'}), null);
});

test('the reference rack\'s two kinds of cord: a 0.5 m cord and a 1 m cord on paths 130 mm apart', () => {
  // c4's path is 267 mm and c12's 397 mm on the sample rack: both LC fibre.
  const c4 = routed('c4', 'om4', 267), c12 = routed('c12', 'om4', 397);
  assert.equal(c4.length.value, 0.5);
  assert.equal(c12.length.value, 1);
  const s4 = spareOf(c4, pathOf(267, c4)), s12 = spareOf(c12, pathOf(397, c12));
  near(s4.spare, 0.5 - (0.267 + 2 * END_ALLOWANCE_BY_MEDIA.om4), 'c4');
  near(s12.spare, 1 - (0.397 + 2 * END_ALLOWANCE_BY_MEDIA.om4), 'c12');
  // the dressing allowance is part of the spare: more than the cord less the kit's routed length
  near(s4.spare - (0.5 - pathLength(pathOf(267, c4)).measured), 2 * dressingAllowance(c4), 'c4 over the routed length');
  near(s4.dressing, dressingAllowance(c4), 'c4 dressing');
  // a routed cord is the size the route asks for: nothing to say, and no mark of any kind
  assert.equal(s4.asks, null);
  assert.equal(asksText(s12), null);
  assert.deepEqual(Object.keys(s12).sort(), ['asks', 'cord', 'dressing', 'spare', 'unit', 'used', 'value']);
  assert.equal(spareText(s4), '0.5 m cord, 0.21 m spare');
  assert.equal(spareText(s12), '1 m cord, 0.58 m spare');
  assert.equal(spareAmount(s12), '0.58 m');
});

test('a length in feet is said in feet, cord and spare both', () => {
  const c = {id: 'c1', media: 'om4', length: {value: 3, unit: 'ft', source: 'entered'}};
  const s = spareOf(c, pathOf(397, c));
  const want = 3 * 0.3048 - (0.397 + 2 * END_ALLOWANCE_BY_MEDIA.om4);
  near(s.spare, want, 'metres under the words');
  assert.equal(spareText(s), `3 ft cord, ${Math.round(want / 0.3048 * 100) / 100} ft spare`);
  assert.equal(spareText(s), '3 ft cord, 1.61 ft spare');
  // 3 ft is 0.9144 m, under the 1 m the route asks for
  assert.equal(asksText(s), 'the route asks for 1 m (3.28 ft)');
  // the same cord entered in metres says the same length in metres
  const m = {...c, length: {value: 0.9144, unit: 'm', source: 'entered'}};
  assert.equal(spareText(spareOf(m, pathOf(397, m))), '0.9144 m cord, 0.49 m spare');
});

test('a cord shorter than what its route uses is short, not spare, and the route asks for more', () => {
  const c = {id: 'c1', media: 'om4', length: {value: 1, unit: 'ft', source: 'entered'}};
  const s = spareOf(c, pathOf(397, c));
  assert.ok(s.spare < 0);
  assert.equal(spareText(s), '1 ft cord, 0.39 ft short');
  assert.equal(asksText(s), 'the route asks for 1 m (3.28 ft)');
  // 0.3 m on a 444 mm path: 0.3 - (0.444 + 0.0262) = -0.17
  const m = {id: 'c2', media: 'om4', length: {value: 0.3, unit: 'm', source: 'entered'}};
  const sm = spareOf(m, pathOf(444, m));
  assert.equal(spareText(sm), '0.3 m cord, 0.17 m short');
  assert.equal(asksText(sm), 'the route asks for 1 m');
});

test('an entered cord a little under the routed length still has spare, and says what the route asks for', () => {
  // a 444 mm path of LC fibre: it uses 0.4702 m, its routed length is 0.6702 m, and the kit would choose 1 m
  const c = {id: 'c1', media: 'om4', length: {value: 0.5, unit: 'm', source: 'entered'}};
  const path = pathOf(444, c), s = spareOf(c, path);
  near(pathLength(path).measured, 0.444 + 2 * endAllowance(c), 'routed');
  assert.ok(0.5 - pathLength(path).measured < 0, 'under the routed length');
  near(s.spare, 0.5 - (0.444 + 2 * END_ALLOWANCE_BY_MEDIA.om4), 'spare');
  assert.equal(spareText(s), '0.5 m cord, 0.03 m spare');
  assert.equal(s.asks, 1);
  assert.equal(asksText(s), 'the route asks for 1 m');
  // an entered cord of the size the route asks for, or longer, has nothing to add
  for (const value of [1, 2]) assert.equal(asksText(spareOf({...c, length: {value, unit: 'm', source: 'entered'}}, path)), null);
  // the agent's sentence: the slack names what it is against, so the two signs do not contradict
  const o = {kind: 'cable', id: 'c1', a: {item: 'sw', path: 'port-1', view: 'front'}, b: {item: 'pp', path: 'port-1', view: 'front'},
    media: 'om4', length: {value: 0.5, unit: 'm', source: 'entered'}, routed: {metres: 0.67, stock: 1}, slack: {metres: -0.17},
    route: {edited: false, waypoints: [], text: ''}};
  const said = cableText(o, {spare: spareText(s), dressing: s.dressing, asks: asksText(s)});
  assert.match(said, /; slack -0\.17 m against the routed length, which allows 0\.1 m of dressing at each end; 0\.5 m cord, 0\.03 m spare; the route asks for 1 m \(the cord less/);
  // with no dressing allowance in the kit, the clause goes
  assert.match(cableText(o, {spare: spareText(s), dressing: 0}), /; slack -0\.17 m against the routed length; 0\.5 m cord/);
});

test('no spare is said where it cannot be: no path, no length, a unit the page does not convert', () => {
  const c = routed('c1', 'om4', 300);
  assert.equal(spareOf(c, null), null);
  assert.equal(spareOf({...c, length: null}, pathOf(300, c)), null);
  assert.equal(spareOf({...c, length: {value: 3, unit: 'yd', source: 'entered'}}, pathOf(300, c)), null);
  assert.equal(spareOf({...c, length: undefined, lengthAsWritten: {value: 'long', unit: 'm'}}, pathOf(300, c)), null);
  assert.equal(spareFor({cables: [c]}, c, null), null);
  assert.equal(spareFor({cables: [c]}, null, {}), null);
});

test('sparesOf lists every routed cable but one with a loose end', () => {
  const cs = [routed('c1', 'om4', 267), routed('c2', 'cat6', 900), routed('c3', 'om4', 397), routed('c4', 'dac', 500)];
  const paths = new Map(cs.map((c, k) => [c.id, k === 3 ? null : pathOf([267, 900, 397][k], c)]));
  const ends = new Map([[endKey(cs[2].b), {info: null, reason: 'nothing is seated in that cage'}]]);
  const got = sparesOf({cables: cs}, paths, looseIn(ends));
  assert.deepEqual([...got.keys()], ['c1', 'c2']);
  near(got.get('c2').spare, stockLength(pathLength(paths.get('c2')).measured) - (0.9 + 2 * END_ALLOWANCE_BY_MEDIA.cat6), 'c2');
  assert.equal(sparesOf({cables: cs}, null).size, 0);
});

test('the list\'s line and the agent\'s text carry the same words', () => {
  const c = {...routed('c12', 'om4', 397), label: 'L12', purpose: 'uplink'};
  const s = spareOf(c, pathOf(397, c));
  assert.equal(cableMeta(c, s), 'L12 · OM4 multimode fiber · uplink · 1 m cord, 0.58 m spare');
  assert.equal(cableMeta(c, null), 'L12 · OM4 multimode fiber · uplink · 1 m');
  const o = {kind: 'cable', id: 'c12', a: {item: 'sw', path: 'port-1', view: 'front'}, b: {item: 'pp', path: 'port-1', view: 'front'},
    media: 'om4', purpose: 'uplink', label: 'L12', length: {value: 1, unit: 'm', source: 'routed'},
    routed: {metres: 0.62, stock: 1}, slack: null, route: {edited: false, waypoints: [], text: ''}};
  const said = cableText(o, {spare: spareText(s)});
  assert.match(said, /length 1 m \(routed\); routed 0\.62 m, stock size 1 m; 1 m cord, 0\.58 m spare \(the cord less its path and what its plugs take; the drawing shows the path only\)/);
  assert.doesNotMatch(cableText(o), /spare/);
  // an entered length has the kit's slack too, and each is named
  const e = {...o, length: {value: 2, unit: 'm', source: 'entered'}, slack: {metres: 1.38}};
  assert.match(cableText(e, {spare: '2 m cord, 1.58 m spare', dressing: 0.1}), /; slack 1\.38 m against the routed length, which allows 0\.1 m of dressing at each end; 2 m cord, 1\.58 m spare /);
  assert.match(cableText(e), /; slack 1\.38 m$/m);
  assert.match(SPARE_HELP, /path/);
  assert.match(SPARE_HELP, /is not drawn\.$/);
});
