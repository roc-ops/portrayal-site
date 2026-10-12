// A CORD'S SPARE (site/rack/spare.js) IS THE KIT'S (kit 0.22.0, rack file
// version 4: rack/route.js spareOf). The page draws a cable's path and nothing
// more, so the list, the hover label and the agent's text say the spare, and
// every figure in them is the kit's: the stock, the need, the spare. The site
// worked the spare out itself until 0.22.0, adding back a dressing allowance it
// read as what `endAllowance` held on top of the kit's table; the kit moved
// that allowance out and named it end play, and the old sum would now say
// 0.2 m less spare for every cord. The first test holds that it does not.
//
// The expected figures are worked from the points of the kit's path and the
// kit's table, never from spareOf itself, so the two have to agree.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sparesOf, spareFor, looseIn, spareText, spareAmount, needsText, SPARE_HELP} from '../../site/rack/spare.js';
import {cableMeta} from '../../site/rack/cable-panel.js';
import {cableText} from '../../site/rack/agent-text.js';
import * as R from '../../vendor/rack/route.js';
import {endKey} from '../../vendor/rack/cable-rules.js';

// The lacer of bend-findings.test.mjs: a switch at U40, a panel at U41 with a
// lacer on it, and a cord from one to the other through the lacer's ring.
const CMP = {ru: 1, w: 483, h: 44, d: 110, mount: 'rack-face', shell: 'sheet', guides: {front: ['guide-3']},
  solids: [{part: 'tray/floor', box: {x: 17.3, y: 1.5, z: 0, w: 448.4, h: 1.5, d: 100}}]};
const SIZES = {sw: {ru: 1, w: 438, h: 43.5, d: 536}, panel: {ru: 1, w: 448, h: 44, d: 432.8}, cmp: CMP};
const chassisOf = ref => SIZES[ref] ?? null;
const RING = {via: 'guide-3', kind: 'ring', face: 'front', run: 'x', depth: 6.8, x: 0, aperture: {w: 32, h: 29.5}};
const item = (id, ref, ru, extra = {}) => ({id, ref, cfg: 'base', label: id.toUpperCase(), ru, face: 'front', turned: false,
  swaps: {}, fields: {}, ...extra});
const rackOf = cables => ({id: 'r1', name: 'lay', frame: {kind: 'four-post', heightRU: 42, numbering: 'bottom-up', railDepth: 740},
  items: [item('sw', 'sw', 40), item('pp', 'panel', 41), item('cm', 'cmp', 41, {on: 'pp', unit: 1})], zeroU: [], cables});
const ctxOf = () => ({chassisOf, guidesOf: id => (id === 'cm' ? [RING] : []),
  portX: end => ({'sw|p1': -40, 'pp|lc1': 40})[`${end.item}|${end.path}`] ?? null});
const cord = (media, length, id = 'c1') => ({id, a: {item: 'sw', path: 'p1', view: 'front'}, b: {item: 'pp', path: 'lc1', view: 'front'},
  media, purpose: 'uplink', label: '', route: [{item: 'cm', via: 'guide-3'}], routeEdited: true, ...(length ? {length} : {})});
const routed = (media, id = 'c1') => {
  const c = cord(media, null, id), r = rackOf([c]);
  const got = R.routedLength(r, c, ctxOf());
  return {...c, length: {value: got.value, unit: 'm', source: 'routed', need: Math.round(got.need * 100) / 100}};
};
// The run of the kit's path for a cable, in metres, from its points.
const runOf = (r, c, ctx) => {
  const p = R.routePath(r, c, ctx).points;
  return p.reduce((m, q, i) => (i ? m + Math.hypot(q.x - p[i - 1].x, q.y - p[i - 1].y, q.z - p[i - 1].z) : 0), 0) / 1000;
};
// What a cord of `stock` metres must at least be: the run, what is inside the two ports, and the maker's short tolerance.
const needOf = (r, c, ctx, stock) => runOf(r, c, ctx) + 2 * R.END_ALLOWANCE_BY_MEDIA[c.media] + R.shortTolerance(c, stock);
const near = (got, want, what) => assert.ok(Math.abs(got - want) < 1e-9, `${what}: ${got}, expected ${want}`);

test('the spare is the kit\'s for every media: stock less need, with the end play in it, not 0.2 m under', () => {
  for (const media of Object.keys(R.END_ALLOWANCE_BY_MEDIA)) {
    const c = routed(media), r = rackOf([c]), ctx = ctxOf();
    const s = spareFor(r, c, ctx), k = R.spareOf(r, c, ctx);
    assert.ok(s && k, media);
    // each figure is the kit's own
    assert.deepEqual([s.cord, s.need, s.spare, s.endPlay, s.toStore, s.pinned], [k.stock_m, k.need_m, k.spare_m, k.end_play_m, k.to_store_m, k.pinned], media);
    // ...and the kit's is the stock less the path, the inside of the two ports and the short tolerance
    near(s.need, needOf(r, c, ctx, s.cord), `${media}: need`);
    near(s.spare, s.cord - needOf(r, c, ctx, s.cord), `${media}: spare`);
    // THE FAULT THIS MODULE HAD COMING: the dressing as `endAllowance` less the table is 0 now,
    // and the cord less the kit's `measured` would be 0.2 m under the spare
    assert.equal(R.endAllowance(c) - R.END_ALLOWANCE_BY_MEDIA[media], 0, `${media}: the allowance holds no dressing`);
    near(s.spare - (s.cord - R.pathLength(R.routePath(r, c, ctx)).measured), 2 * R.END_PLAY_M, `${media}: over the old sum`);
    assert.ok(s.spare >= 2 * R.END_PLAY_M - R.BREAK_TOL_M - 1e-9, `${media}: a routed cord has its end play, to the stock break`);
    assert.equal(s.needs, null);
    assert.equal(needsText(s), null);
    assert.deepEqual(Object.keys(s).sort(), ['cord', 'endPlay', 'need', 'needs', 'pinned', 'spare', 'toStore', 'unit', 'value']);
    assert.equal(spareText(s), `${s.cord} m cord, ${Math.round(s.spare * 100) / 100} m spare`);
    assert.equal(spareAmount(s), `${Math.round(s.spare * 100) / 100} m`);
  }
  assert.equal(R.END_PLAY_M, 0.1);
});

test('a length in feet is said in feet, cord and spare both', () => {
  const c = cord('om4', {value: 3, unit: 'ft', source: 'entered'}), r = rackOf([c]), ctx = ctxOf();
  const s = spareFor(r, c, ctx);
  const want = 3 * 0.3048 - needOf(r, c, ctx, 3 * 0.3048);
  near(s.spare, want, 'metres under the words');
  assert.equal(s.pinned, true);
  assert.equal(spareText(s), `3 ft cord, ${Math.round(want / 0.3048 * 100) / 100} ft spare`);
  assert.equal(needsText(s), null);
  // the same cord entered in metres says the same length in metres
  const m = cord('om4', {value: 0.9144, unit: 'm', source: 'entered'});
  assert.equal(spareText(spareFor(rackOf([m]), m, ctx)), `0.9144 m cord, ${Math.round(want * 100) / 100} m spare`);
  // and a length a DCIM gave is pinned as an entered one is
  assert.equal(spareFor(rackOf([{...c, length: {value: 3, unit: 'ft', source: 'dcim'}}]), {...c, length: {value: 3, unit: 'ft', source: 'dcim'}}, ctx).pinned, true);
});

test('a pinned cord under the kit\'s need is short, and says the kit\'s need in its own unit', () => {
  const ctx = ctxOf();
  const probe = cord('om4', {value: 9, unit: 'm', source: 'entered'}), need = needOf(rackOf([probe]), probe, ctx, 9);
  // 5 cm under the need
  const value = Math.floor((need - 0.05) * 100) / 100;
  const c = cord('om4', {value, unit: 'm', source: 'entered'}), r = rackOf([c]);
  const s = spareFor(r, c, ctx);
  assert.ok(s.spare < 0);
  near(s.needs, need, 'the need is the kit\'s');
  assert.equal(R.spareOf(r, c, ctx).need_m, s.needs);
  assert.equal(spareText(s), `${value} m cord, ${Math.round((need - value) * 100) / 100} m short`);
  assert.equal(needsText(s), `the route needs ${Math.round(need * 100) / 100} m`);
  // in feet
  const f = cord('om4', {value: 0.5, unit: 'ft', source: 'entered'}), sf = spareFor(rackOf([f]), f, ctx);
  assert.match(spareText(sf), /^0\.5 ft cord, [\d.]+ ft short$/);
  assert.equal(needsText(sf), `the route needs ${Math.round(need / 0.3048 * 100) / 100} ft`);
  // a routed length never is, whatever it says
  assert.equal(spareFor(r, {...c, length: {...c.length, source: 'routed'}}, ctx).needs, null);
});

test('a pinned cord that meets the need with less than the end play is not short: it has that much spare, and no warning', () => {
  const ctx = ctxOf();
  const probe = cord('om4', {value: 9, unit: 'm', source: 'entered'}), need = needOf(rackOf([probe]), probe, ctx, 9);
  for (const over of [0, 0.03, 0.19, 0.2, 0.6]) {
    const value = Math.ceil((need + over) * 100) / 100;
    const c = cord('om4', {value, unit: 'm', source: 'entered'}), s = spareFor(rackOf([c]), c, ctx);
    assert.ok(s.spare >= 0, `${value} m`);
    assert.equal(needsText(s), null, `${value} m reaches`);
    assert.doesNotMatch(spareText(s), /short|dressing/);
    near(s.endPlay, Math.min(s.spare, 2 * R.END_PLAY_M), 'the end play is what there is of it');
    near(s.toStore, Math.max(0, s.spare - 2 * R.END_PLAY_M), 'and the rest is to store');
  }
});

test('no spare is said where it cannot be: no context, no length, a unit the page does not convert, no path', () => {
  const c = routed('om4'), r = rackOf([c]), ctx = ctxOf();
  assert.ok(spareFor(r, c, ctx));
  assert.equal(spareFor(r, c, null), null);
  assert.equal(spareFor(r, null, ctx), null);
  assert.equal(spareFor(r, {...c, length: null}, ctx), null);
  assert.equal(spareFor(r, {...c, length: {value: 3, unit: 'yd', source: 'entered'}}, ctx), null);
  assert.equal(spareFor(r, {...c, length: undefined, lengthAsWritten: {value: 'long', unit: 'm'}}, ctx), null);
  // a port the context cannot place: the kit has no path
  const gone = {...c, a: {item: 'nowhere', path: 'p9', view: 'front'}};
  assert.equal(spareFor(rackOf([gone]), gone, ctx), null);
});

test('sparesOf lists every routed cable but one with a loose end, and none without a context', () => {
  const cs = [routed('om4', 'c1'), routed('cat6', 'c2'), routed('om4', 'c3')];
  const r = rackOf(cs), ctx = ctxOf();
  const ends = new Map([[endKey(cs[2].b), {info: null, reason: 'nothing is seated in that cage'}]]);
  // (the three share their two ports here, so one loose end is every cable's: give the third its own)
  cs[2].b = {item: 'pp', path: 'lc2', view: 'front'};
  const ends2 = new Map([[endKey(cs[2].b), {info: null, reason: 'nothing is seated in that cage'}]]);
  assert.equal(ends.size, 1);
  const got = sparesOf(r, {...ctx, portX: end => (end.path === 'lc2' ? 60 : ctx.portX(end))}, looseIn(ends2));
  assert.deepEqual([...got.keys()], ['c1', 'c2']);
  near(got.get('c2').spare, got.get('c2').cord - needOf(r, cs[1], ctx, got.get('c2').cord), 'c2');
  assert.equal(sparesOf(r, null).size, 0);
});

test('the list\'s line and the agent\'s text carry the same words, and the agent reads the kit\'s slack', () => {
  const c = {...routed('om4', 'c12'), label: 'L12', purpose: 'uplink'}, r = rackOf([c]), ctx = ctxOf();
  const s = spareFor(r, c, ctx), words = spareText(s);
  assert.equal(cableMeta(c, s), `L12 · OM4 multimode fiber · uplink · ${words}`);
  assert.equal(cableMeta(c, null), `L12 · OM4 multimode fiber · uplink · ${c.length.value} m`);
  // inspect's shape since kit 0.22.0: `need` on the length, and `slack` as {metres, at_ends_m, said, stored, unplaced_m}
  const o = {kind: 'cable', id: 'c12', a: {item: 'sw', path: 'port-1', view: 'front'}, b: {item: 'pp', path: 'port-1', view: 'front'},
    media: 'om4', purpose: 'uplink', label: 'L12', length: {value: 1, unit: 'm', source: 'routed', need: 0.42},
    routed: {metres: 0.62, stock: 1}, slack: {metres: 0.58, at_ends_m: 0.2, said: false, stored: [], unplaced_m: 0.38},
    route: {edited: false, waypoints: [], text: ''}};
  const said = cableText(o, {spare: '1 m cord, 0.57 m spare'});
  assert.match(said, /length 1 m \(routed\), needs 0\.42 m; routed 0\.62 m, stock size 1 m; 1 m cord, 0\.57 m spare \(0\.2 m at the two ends, 0\.38 m not placed; spare is listed, not drawn\)/);
  // without the page's words (a loose end), the kit's figure is said
  assert.match(cableText(o), /stock size 1 m; spare 0\.58 m \(0\.2 m at the two ends, 0\.38 m not placed; /);
  // stored places, a place it cannot store in, and unplaced by choice
  const stored = {...o, slack: {metres: 1.58, at_ends_m: 0.2, said: true, unplaced_m: 0.08,
    stored: [{item: 'cm', via: 'tray', form: 'coil', metres: 1, ok: true}, {end: 'a', metres: 0.3}, {item: 'cm2', via: 'tray', form: 'spool', metres: null, ok: false, why: 'x'}]}};
  assert.match(cableText(stored), /\(0\.2 m at the two ends, 1 m as a coil in cm tray, 0\.3 m at end A, a length as a spool in cm2 tray, where it cannot be stored, 0\.08 m not placed; /);
  assert.match(cableText({...o, slack: {...o.slack, said: true}}), /0\.38 m left unplaced by choice/);
  // a pinned cord under its need: the shortfall and the need, and nothing said to be stored
  const short = {...o, length: {value: 0.3, unit: 'm', source: 'entered', need: 0.42}, slack: {metres: -0.12, at_ends_m: 0, said: false, stored: [], unplaced_m: 0},
    spare_findings: [{kind: 'spare-short', text: 'c12 is 0.3 m and needs 0.42 m.'}]};
  const saidShort = cableText(short, {spare: '0.3 m cord, 0.12 m short', needs: 'the route needs 0.42 m'});
  assert.match(saidShort, /; 0\.3 m cord, 0\.12 m short; the route needs 0\.42 m \(the drawing shows the path only\)/);
  assert.match(saidShort, /^Spare: c12 is 0\.3 m and needs 0\.42 m\.$/m);
  // no slack and no spare: nothing is said of either, and the old "against the routed length" clause is gone
  assert.doesNotMatch(cableText({...o, slack: null}), /spare|slack/);
  assert.doesNotMatch(said + saidShort, /dressing|against the routed length/);
  assert.match(SPARE_HELP, /path/);
  assert.match(SPARE_HELP, /is not drawn\.$/);
  // the page source no longer reads the end allowance to derive anything
  const src = readFileSync(new URL('../../site/rack/spare.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /import\s*\{[^}]*(endAllowance|END_ALLOWANCE_BY_MEDIA|pathLength)[^}]*\}/);
});

test('one rounding rule, the kit\'s: a spare, a shortfall and a need are each said to the nearest hundredth, as the schedule says them', () => {
  const ctx = ctxOf();
  const probe = cord('om4', {value: 9, unit: 'm', source: 'entered'}), need = needOf(rackOf([probe]), probe, ctx, 9);
  const r2 = x => Math.round(x * 100) / 100;
  for (const [value, unit] of [[need - 0.003, 'm'], [need - 0.2, 'm'], [need + 0.1968, 'm'], [need + 0.0049, 'm'], [need + 0.386, 'm'],
                               [(need - 0.001) / 0.3048, 'ft'], [(need + 0.1) / 0.3048, 'ft'], [1, 'ft'], [3, 'ft']]) {
    const k = cord('om4', {value, unit, source: 'entered'}), r = rackOf([k]), sk = spareFor(r, k, ctx);
    const per = unit === 'ft' ? 0.3048 : 1;
    const said = Number(spareText(sk).match(/, ([\d.]+) /)[1]);
    assert.equal(said, r2(Math.abs(sk.spare) / per), `${value} ${unit}`);
    if (unit === 'm' && sk.spare >= 0) {
      // THE SCHEDULE'S CELL for the same cord is the same figure (export-data.js: Math.round(spare_m * 100) / 100)
      assert.equal(said, Math.round(R.spareOf(r, k, ctx).spare_m * 100) / 100, `${value} m: the page and the schedule differ`);
    }
    if (/short/.test(spareText(sk))) assert.equal(Number(needsText(sk).match(/needs ([\d.]+) /)[1]), r2(sk.needs / per));
    else assert.equal(needsText(sk), null);
  }
  // a spare of 0.386 m is 0.39 on the page, as in the file: it read 0.38 while the page rounded down
  const c = cord('om4', {value: need + 0.386, unit: 'm', source: 'entered'});
  assert.match(spareText(spareFor(rackOf([c]), c, ctx)), /, 0\.39 m spare$/);
});
