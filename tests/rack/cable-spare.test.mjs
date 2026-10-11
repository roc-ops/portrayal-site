// A CORD'S SPARE (site/rack/spare.js): the cord's length less what its route
// uses, which is the kit's path and the kit's sourced end allowance at each
// end, and not the dressing allowance the kit's routed length adds on top.
// The page draws a cable's path and nothing more, so the list, the hover
// label and the agent's text say the spare; a cord with more spare than half
// of itself says how much of it is not drawn.
//
// The expected figures here are worked from the path's points and the kit's
// table, never from spare.js's own route to them (the kit's `measured` less
// the dressing allowance), so the two have to agree.
import test from 'node:test';
import assert from 'node:assert/strict';
import {dressingAllowance, usedMetres, spareOf, sparesOf, spareFor, looseIn, spareText, spareAmount, undrawnText,
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

test('the dressing allowance is what the kit adds on top of its table, the same for every media', () => {
  const d = dressingAllowance();
  assert.ok(d >= 0);
  for (const [media, table] of Object.entries(END_ALLOWANCE_BY_MEDIA))
    near(endAllowance({media}) - table, d, `${media}'s end allowance less its table figure`);
});

test('what a routed cable uses is its path and the table figure at each end', () => {
  for (const [media, table] of Object.entries(END_ALLOWANCE_BY_MEDIA))
    near(usedMetres(pathOf(300, {media})), 0.3 + 2 * table, `${media} on a 300 mm path`);
  assert.equal(usedMetres(null), null);
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
  near(s4.spare - (0.5 - pathLength(pathOf(267, c4)).measured), 2 * dressingAllowance(), 'c4 over the routed length');
  assert.equal(spareText(s4), '0.5 m cord, 0.21 m spare');
  assert.equal(spareText(s12), '1 m cord, 0.58 m spare');
  assert.equal(spareAmount(s12), '0.58 m');
});

test('a cord whose spare is more than half of it is large, and says how much is not drawn', () => {
  const c4 = routed('c4', 'om4', 267), c12 = routed('c12', 'om4', 397);
  const s4 = spareOf(c4, pathOf(267, c4)), s12 = spareOf(c12, pathOf(397, c12));
  assert.equal(s4.large, false);
  assert.equal(undrawnText(s4), null);
  assert.equal(s12.large, true);
  assert.equal(undrawnText(s12), '0.58 m of this cord is not drawn: the picture shows its path only.');
  // exactly half is not more than half
  const table = END_ALLOWANCE_BY_MEDIA.cat6;
  const half = {id: 'h', media: 'cat6', length: {value: 2, unit: 'm', source: 'entered'}};
  const at = spareOf(half, pathOf((1 - 2 * table) * 1000, half));
  near(at.spare, 1, 'a 2 m cord using exactly 1 m');
  assert.equal(at.large, false);
  assert.equal(spareOf(half, pathOf((1 - 2 * table) * 1000 - 1, half)).large, true);
});

test('a length in feet is said in feet, cord and spare both', () => {
  const c = {id: 'c1', media: 'om4', length: {value: 3, unit: 'ft', source: 'entered'}};
  const s = spareOf(c, pathOf(397, c));
  const want = 3 * 0.3048 - (0.397 + 2 * END_ALLOWANCE_BY_MEDIA.om4);
  near(s.spare, want, 'metres under the words');
  assert.equal(spareText(s), `3 ft cord, ${Math.round(want / 0.3048 * 100) / 100} ft spare`);
  assert.equal(spareText(s), '3 ft cord, 1.61 ft spare');
  assert.equal(s.large, true);   // 0.49 m of a 0.91 m cord
  assert.equal(undrawnText(s), '1.61 ft of this cord is not drawn: the picture shows its path only.');
  // the same cord entered in metres says the same length in metres
  const m = {...c, length: {value: 0.9144, unit: 'm', source: 'entered'}};
  assert.equal(spareText(spareOf(m, pathOf(397, m))), '0.9144 m cord, 0.49 m spare');
});

test('a cord shorter than what its route uses is short, not spare', () => {
  const c = {id: 'c1', media: 'om4', length: {value: 1, unit: 'ft', source: 'entered'}};
  const s = spareOf(c, pathOf(397, c));
  assert.ok(s.spare < 0);
  assert.equal(spareText(s), '1 ft cord, 0.39 ft short');
  assert.equal(s.large, false);
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
  assert.match(cableText(e, {spare: '2 m cord, 1.58 m spare'}), /; slack 1\.38 m beyond the routed length; 2 m cord, 1\.58 m spare /);
  assert.match(cableText(e), /; slack 1\.38 m$/m);
  assert.match(SPARE_HELP, /path/);
  assert.match(SPARE_HELP, /not drawn yet/);
});
