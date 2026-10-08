// FACEPLATE SETBACK: an item's own, or the frame's default, in mm behind the
// rail - read by the file, the fit rules, the commands, the routes and the notes.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../../site/rack/model.js';
import * as F from '../../site/rack/fit.js';
import * as R from '../../site/rack/route.js';
import {COMMANDS} from '../../site/rack/commands.js';
import {mountNotes} from '../../site/rack/export-data.js';

const SIZES = {'sw': {ru: 1, h: 43.5, d: 515, model: 'SW', default: 'x'},
               'deep': {ru: 1, h: 44, d: 700, model: 'DEEP', default: 'x'},
               'mgr': {ru: 1, h: 44, d: 110, mount: 'rack-face', model: 'MGR', default: 'x'}};
const chassisOf = ref => SIZES[ref] || null;
const ctx = {chassisOf};
const run = (op, rack, args) => COMMANDS[op].run(rack, args, ctx);
const add = (rack, ref, ru, extra = {}) => M.withItem(rack, {ref, cfg: 'x', ru, label: extra.label ?? ref, ...extra}).rack;
const doc = rack => ({format: M.FORMAT, version: M.VERSION, id: 'd', racks: [rack]});

test('a file without setbacks reads and writes without them', () => {
  const r = add(M.newRack(), 'sw', 1);
  const back = M.parseDoc(M.serialize(doc(r))).racks[0];
  assert.equal('setback' in back.frame, false);
  assert.equal('setback' in back.items[0], false);
  assert.equal(M.setbackOf(back.items[0], back), 0);
});

test("an item's own setback, 0 included, is kept; anything else is the rack's", () => {
  let r = M.withFrame(M.newRack(), {setback: 25});
  r = add(r, 'sw', 1);
  r = add(r, 'sw', 2, {setback: 0});
  r = add(r, 'sw', 3, {setback: 40});
  const back = M.parseDoc(M.serialize(doc({...r, items: [...r.items, {...r.items[0], id: 'i9', ru: 9, setback: 'deep'}]}))).racks[0];
  assert.equal(back.frame.setback, 25);
  assert.deepEqual(back.items.map(i => M.setbackOf(i, back)), [25, 0, 40, 25]);
  assert.equal('setback' in back.items[3], false);
  // A frame default of 0 is no default: the key goes.
  assert.equal('setback' in M.withFrame(r, {setback: 0}).frame, false);
});

test('a setback adds to the depth a device takes up', () => {
  const r = M.withFrame(M.newRack(), {usableDepth: 540});
  assert.deepEqual(F.fits(r, {ref: 'sw', ru: 1, face: 'front'}, chassisOf), {ok: true});
  assert.equal(F.fits(r, {ref: 'sw', ru: 1, face: 'front', setback: 30}, chassisOf).reason,
    '515 mm deep and set back 30 mm; this rack allows 540 mm.');
  // The rack's default applies to a device that states none.
  assert.equal(F.fits(M.withFrame(r, {setback: 30}), {ref: 'sw', ru: 1, face: 'front'}, chassisOf).ok, false);
});

test('front and rear share a U by depth and setback together', () => {
  // 740 mm between the rails: 700 deep and 30 back leaves 10 behind it, not 515.
  // Flush, the 700 stays inside the rear rail, so a rear manager there is clear.
  const r = add(M.newRack(), 'deep', 10, {face: 'front', setback: 30});
  assert.equal(F.fits(r, {ref: 'sw', ru: 10, face: 'rear'}, chassisOf).reason,
    '515 mm deep; 10 mm free behind deep.');
  const flush = add(M.newRack(), 'deep', 10, {face: 'front'});
  assert.deepEqual(F.fits(flush, {ref: 'mgr', ru: 10, face: 'rear'}, chassisOf), {ok: true});
  assert.equal(F.availableDepth(r, r.items[0], chassisOf), 1000 - 30);
});

test('patch sets a setback, refuses one that does not fit, and null goes back to the rack', () => {
  let r = M.withFrame(M.newRack(), {usableDepth: 540, setback: 10});
  r = add(r, 'sw', 1);
  const set = run('patch', r, {id: 'i1', setback: 20});
  assert.equal(set.rack.items[0].setback, 20);
  assert.equal(run('patch', r, {id: 'i1', setback: 30}).error, '515 mm deep and set back 30 mm; this rack allows 540 mm.');
  const cleared = run('patch', set.rack, {id: 'i1', setback: null});
  assert.equal('setback' in cleared.rack.items[0], false);
  assert.equal(M.setbackOf(cleared.rack.items[0], cleared.rack), 10);
  // Brought forward is never refused, even where the rack is already too shallow for it.
  const shallow = M.withFrame(set.rack, {usableDepth: 500});
  assert.equal(run('patch', shallow, {id: 'i1', setback: 0}).rack.items[0].setback, 0);
  // null on an item with none is no change.
  assert.equal(run('patch', r, {id: 'i1', setback: null}).rack, r);
});

test('frame takes a default setback', () => {
  const r = add(M.newRack(), 'sw', 1);
  const next = run('frame', r, {setback: 30}).rack;
  assert.equal(next.frame.setback, 30);
  assert.equal(run('frame', r, {setback: 0}).rack, r);
});

test('a port on a set-back faceplate is that far in, and its far panel further', () => {
  let r = add(M.newRack(), 'sw', 1, {setback: 30});
  r = add(r, 'sw', 3, {face: 'rear', setback: 20});
  const pctx = {chassisOf, portX: () => 0, portY: () => null};
  assert.equal(R.portPoint(r, {item: 'i1', path: 'p', view: 'front'}, pctx).z, -30);
  assert.equal(R.portPoint(r, {item: 'i1', path: 'p', view: 'rear'}, pctx).z, -545);
  assert.equal(R.portPoint(r, {item: 'i2', path: 'p', view: 'front'}, pctx).z, -740 + 20);
  assert.equal(R.portPoint(r, {item: 'i2', path: 'p', view: 'rear'}, pctx).z, -740 + 535);
});

test('the notes say the rack default once and each device that differs', () => {
  let r = M.withFrame(M.newRack(), {setback: 30});
  r = add(r, 'sw', 1, {label: 'a'});
  r = add(r, 'sw', 2, {label: 'b', setback: 0});
  r = add(r, 'sw', 3, {label: 'c', setback: 45});
  assert.deepEqual(mountNotes(r.items, chassisOf, r.frame), [
    'Faceplates are set back 30 mm from the rail unless noted.',
    'b at U2: faceplate flush with the rail.',
    'c at U3: faceplate set back 45 mm from the rail.']);
  assert.deepEqual(mountNotes(add(M.newRack(), 'sw', 1).items, chassisOf, M.newRack().frame), []);
});
