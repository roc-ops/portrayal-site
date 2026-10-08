import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {newDoc, parseDoc, serialize, withItem} from '../../vendor/rack/model.js';
import {withFrame} from '../../vendor/rack/model.js';
import {createRackEditor} from '../../vendor/rack/editor.js';
import {laneX} from '../../vendor/rack/route.js';
import {RU, OPENING, RAIL_W} from '../../vendor/rack/rails.js';
import {fitsZeroUSide, fitsSided, fitsItem, applySite, needsSite, withZeroUEditor, keepSiteFields,
        laneXAt, zeroUX, ductOnLane, zeroUFill, zeroUOf, ruOfZ, zSpan, offsetOf, isNarrowFace,
        ZERO_U_COMMANDS, ALL_COMMANDS, zeroULines} from '../../site/rack/zero-u.js';

const devices = JSON.parse(readFileSync(new URL('../../assets/dist/rack.json', import.meta.url))).devices;
const chassisOf = ref => devices[ref] ?? null;
const ctx = {chassisOf};
const DUCT = 'cmv-sfd45u5w', DUCT42 = 'cmv-sfd42u9w', BRACKET = 'cmv-5u3w';
const rackOf = (kind = 'two-post', heightRU = 45) => withFrame(newDoc({kind}).racks[0], {heightRU});
const run = (rack, cmds) => applySite(rack, cmds, ctx);

test('the catalogue has the rack-side ducts and the narrow bracket this works with', () => {
  assert.equal(chassisOf(DUCT).mount, 'rack-side');
  assert.equal(chassisOf(DUCT).ru, 45);
  assert.equal(chassisOf(BRACKET).mount, 'rack-face');
  assert.ok(isNarrowFace(chassisOf(BRACKET)));
  assert.ok(!isNarrowFace(chassisOf('fhd-cmp5dr')));
});

test('a rack-side part fits on an upright of this frame, within its height by its ru', () => {
  const r = rackOf();
  assert.deepEqual(fitsZeroUSide(r, {ref: DUCT, at: 'left', ru: 1}, chassisOf), {ok: true});
  assert.match(fitsZeroUSide(r, {ref: DUCT, at: 'left', ru: 2}, chassisOf).reason, /45U tall; 44U from U2/);
  assert.match(fitsZeroUSide(rackOf('two-post', 42), {ref: DUCT, at: 'left', ru: 1}, chassisOf).reason, /45U tall/);
  assert.match(fitsZeroUSide(r, {ref: DUCT, at: 'left-front', ru: 1}, chassisOf).reason, /not a side of a two-post frame: use left, right/);
  assert.deepEqual(fitsZeroUSide(rackOf('four-post'), {ref: DUCT, at: 'left-rear', ru: 1}, chassisOf), {ok: true});
  assert.match(fitsZeroUSide(r, {ref: 'fhd-cmp5dr', at: 'left', ru: 1}, chassisOf).reason, /not a rack-side part/);
  assert.match(fitsZeroUSide(r, {ref: 'nope', at: 'left', ru: 1}, chassisOf).reason, /No size is known/);
  assert.match(fitsZeroUSide(r, {ref: DUCT, at: 'left', ru: 0}, chassisOf).reason, /Below U1/);
});

test('zerou.place puts the part in zeroU, never in items, at offsetMm from the bottom', () => {
  const r = rackOf();
  const res = run(r, {op: 'zerou.place', ref: DUCT, at: 'left', ru: 1});
  assert.ok(!res.error, res.error);
  assert.equal(res.rack.items.length, 0);
  assert.deepEqual(res.rack.zeroU, [{id: 'z1', ref: DUCT, cfg: 'base', label: 'CMV-SFD45U5W', at: 'left', offsetMm: 0}]);
  assert.match(res.summary, /Placed CMV-SFD45U5W beside the rack at left, U1-U45\./);
  assert.deepEqual(res.created.ids, ['z1']);
  assert.ok(res.step);
  // The other upright is free; the same one is taken.
  const two = run(res.rack, {op: 'zerou.place', ref: DUCT, at: 'right', ru: 1, between: true});
  assert.equal(two.rack.zeroU[1].id, 'z2');
  assert.equal(two.rack.zeroU[1].between, true);
  assert.match(two.summary, /between racks at right/);
  assert.match(run(res.rack, {op: 'zerou.place', ref: DUCT, at: 'left', ru: 1}).error, /Overlaps CMV-SFD45U5W at left/);
  // A shorter part stacks above another on the same upright when they do not overlap.
  const r50 = rackOf('two-post', 50);
  const low = run(r50, {op: 'zerou.place', ref: 'cmv-5u3w', at: 'left', ru: 1});
  assert.match(low.error, /not a rack-side part/);
});

test('the kit place of a rack-side part is refused: it would land on the rails', () => {
  const r = rackOf();
  assert.ok(needsSite(r, [{op: 'place', ref: DUCT, face: 'front', ru: 1}], chassisOf));
  const res = run(r, {op: 'place', ref: DUCT, face: 'front', ru: 1});
  assert.match(res.error, /stands beside the rack, not on its rails: place it with zerou\.place/);
  assert.ok(!needsSite(r, [{op: 'place', ref: 'fhd-cmp5dr', face: 'front', ru: 1}], chassisOf));
});

test('zerou.update moves, renames and marks between; a no-op hands back the rack; remove takes it away', () => {
  const r = run(rackOf('two-post', 48), {op: 'zerou.place', ref: DUCT, at: 'left', ru: 1}).rack;
  const up = run(r, {op: 'zerou.update', id: 'z1', ru: 3, at: 'right', label: 'duct-A'});
  assert.ok(!up.error, up.error);
  assert.deepEqual(up.rack.zeroU[0], {id: 'z1', ref: DUCT, cfg: 'base', label: 'duct-A', at: 'right', offsetMm: offsetOf(3)});
  assert.equal(ruOfZ(up.rack.zeroU[0]), 3);
  assert.deepEqual(zSpan(up.rack.zeroU[0], chassisOf), [3, 47]);
  assert.match(run(r, {op: 'zerou.update', id: 'z1', ru: 5}).error, /45U tall/);
  const same = run(r, {op: 'zerou.update', id: 'z1', ru: 1});
  assert.ok(same.noop);
  assert.equal(same.rack, r);
  const between = run(r, {op: 'zerou.update', id: 'z1', between: true});
  assert.equal(between.rack.zeroU[0].between, true);
  const back = run(between.rack, {op: 'zerou.update', id: 'z1', between: false});
  assert.ok(!('between' in back.rack.zeroU[0]));
  const gone = run(r, {op: 'zerou.remove', id: 'z1'});
  assert.deepEqual(gone.rack.zeroU, []);
  assert.match(run(gone.rack, {op: 'zerou.remove', id: 'z1'}).error, /no longer beside the rack/);
});

test('a batch mixes kit and site commands, binds @names across both, and refuses bad arguments with a sentence', () => {
  const r = rackOf();
  const res = run(r, [
    {op: 'zerou.place', ref: DUCT, at: 'left', ru: 1, as: 'duct'},
    {op: 'place', ref: 'fhd-cmp5dr', face: 'front', ru: 10, as: 'mgr'},
    {op: 'zerou.update', id: '@duct', label: 'vcm-1'}]);
  assert.ok(!res.error, res.error);
  assert.deepEqual(res.created, {duct: 'z1', mgr: 'i1', ids: ['z1', 'i1']});
  assert.equal(res.rack.zeroU[0].label, 'vcm-1');
  assert.equal(res.rack.items[0].ref, 'fhd-cmp5dr');
  assert.match(res.summary, /Placed CMV-SFD45U5W .* Placed FHD-CMP5DR at U10 on the front\. Moved vcm-1/);
  assert.deepEqual(run(r, {op: 'zerou.place', ref: DUCT, ru: 1}), {error: 'zerou.place needs at, some text.', index: 0});
  assert.deepEqual(run(r, {op: 'zerou.place', ref: DUCT, at: 'left', ru: 1, side: 'left'}), {error: 'zerou.place does not take side.', index: 0});
  assert.equal(run(r, [{op: 'zerou.update', id: '@x'}]).error, 'Nothing earlier in this batch is called x.');
  // The table an agent reads has every command, the site's after the kit's.
  assert.ok(Object.keys(ZERO_U_COMMANDS).every(op => op in ALL_COMMANDS));
  assert.ok('place' in ALL_COMMANDS);
});

test('narrow rail parts: one on each rail at the same U, never two on one rail, and a full-width manager is refused there', () => {
  const r = rackOf('two-post', 42);
  const res = run(r, [{op: 'side.place', ref: BRACKET, face: 'front', ru: 10, side: 'left'},
                      {op: 'side.place', ref: BRACKET, face: 'front', ru: 10, side: 'right'}]);
  assert.ok(!res.error, res.error);
  assert.deepEqual(res.rack.items.map(i => [i.id, i.side, i.ru]), [['i1', 'left', 10], ['i2', 'right', 10]]);
  assert.match(res.summary, /on the left rail\. .*on the right rail\./);
  // The bracket is 5U: its upper units are taken on its side too.
  assert.match(run(res.rack, {op: 'side.place', ref: BRACKET, face: 'front', ru: 13, side: 'left'}).error, /Taken by CMV-5U3W/);
  assert.ok(!run(res.rack, {op: 'side.place', ref: BRACKET, face: 'front', ru: 15, side: 'left'}).error);
  // A full-width manager claims both sides.
  assert.match(run(res.rack, {op: 'place', ref: 'fhd-cmp5dr', face: 'front', ru: 12}).error, /Taken by/);
  // A wide part has no side.
  assert.match(run(r, {op: 'side.place', ref: 'fhd-cmp5dr', face: 'front', ru: 10, side: 'left'}).error, /spans the opening/);
  // Each fits where it is, judged by its side.
  for (const it of res.rack.items) assert.deepEqual(fitsItem(res.rack, it, chassisOf), {ok: true});
});

test('a narrow part moves by its side, and side.set turns it across or onto a rail', () => {
  const r = run(rackOf('two-post', 42), [{op: 'side.place', ref: BRACKET, face: 'front', ru: 10, side: 'left'},
                                         {op: 'side.place', ref: BRACKET, face: 'front', ru: 20, side: 'right'}]).rack;
  assert.ok(needsSite(r, [{op: 'move', id: 'i2', ru: 10}], chassisOf));
  const moved = run(r, {op: 'move', id: 'i2', ru: 10});
  assert.ok(!moved.error, moved.error);
  assert.equal(moved.rack.items[1].ru, 10);
  // Across both rails, it meets the one on the left.
  assert.match(run(moved.rack, {op: 'side.set', id: 'i2', side: null}).error, /Taken by/);
  assert.match(run(moved.rack, {op: 'side.set', id: 'i2', side: 'left'}).error, /Taken by/);
  const across = run(r, {op: 'side.set', id: 'i2', side: null});
  assert.ok(!('side' in across.rack.items[1]));
  assert.match(across.summary, /across both rails/);
  assert.ok(run(r, {op: 'side.set', id: 'i2', side: 'right'}).noop);
});

test('lanes run through a duct: its centre line where it stands, the gutter elsewhere', () => {
  const r = run(rackOf('two-post', 48), {op: 'zerou.place', ref: DUCT, at: 'left', ru: 2}).rack;
  const x = -(OPENING / 2 + RAIL_W + chassisOf(DUCT).w / 2);
  assert.equal(zeroUX(r.zeroU[0], chassisOf), x);
  assert.equal(laneXAt(r, 'left', 10, chassisOf), x);
  assert.equal(laneXAt(r, 'left', 1, chassisOf), laneX('left'));
  assert.equal(laneXAt(r, 'left', 47, chassisOf), laneX('left'));
  assert.equal(laneXAt(r, 'right', 10, chassisOf), laneX('right'));
  assert.equal(ductOnLane(r, 'left', 46, chassisOf)?.id, 'z1');
});

test('fill: every cable whose lane run passes through the duct, once, against 40% of its channel and its capacity', () => {
  let r = run(rackOf('two-post', 45), {op: 'zerou.place', ref: DUCT, at: 'left', ru: 1}).rack;
  r = {...r, cables: [{id: 'c1', media: 'cat6'}, {id: 'c2', media: 'os2'}, {id: 'c3', media: 'cat6'}]};
  const routes = new Map([
    ['c1', {waypoints: [{lane: 'left', ru: 10}, {lane: 'left', ru: 30}]}],
    ['c2', {waypoints: [{item: 'i1', via: 'guide-1'}, {lane: 'left', ru: 5}]}],
    ['c3', {waypoints: [{lane: 'right', ru: 10}, {lane: 'right', ru: 30}]}]]);
  const {fill, over} = zeroUFill(r, routes, chassisOf, () => ({w: 5, h: 5}));
  assert.equal(fill.length, 1);
  assert.equal(fill[0].item, 'z1');
  assert.equal(fill[0].via, 'duct');
  assert.deepEqual(fill[0].cables, ['c1', 'c2']);
  const area = Math.PI * 9 + Math.PI * 2.25;
  assert.equal(fill[0].percent, Math.round(area / 10 * 100));
  assert.ok(fill[0].over);
  assert.deepEqual(over, []);
  // No aperture: no fill entry, but the count still meets the stated capacity.
  const many = {...r, cables: Array.from({length: 2746}, (_, k) => ({id: `c${k}`, media: 'cat6'}))};
  const all = new Map(many.cables.map(c => [c.id, {waypoints: [{lane: 'left', ru: 3}]}]));
  const got = zeroUFill(many, all, chassisOf);
  assert.deepEqual(got.fill, []);
  assert.deepEqual(got.over, [{item: 'z1', count: 2746, capacity: 2745}]);
  // A run on the lane that only passes the duct's span still counts (its ends are outside it).
  const r48 = run(rackOf('two-post', 48), {op: 'zerou.place', ref: DUCT, at: 'left', ru: 2}).rack;
  const pass = zeroUFill({...r48, cables: [{id: 'c1', media: 'cat6'}]},
    new Map([['c1', {waypoints: [{lane: 'left', ru: 1}, {lane: 'left', ru: 48}]}]]), chassisOf, () => ({w: 93, h: 165}));
  assert.equal(pass.fill[0].count, 1);
});

test('a rack file with zero-U parts and sided items reads back whole, and an older page still reads it', () => {
  let r = rackOf('two-post', 45);
  r = run(r, [{op: 'zerou.place', ref: DUCT, at: 'left', ru: 1, between: true},
              {op: 'side.place', ref: BRACKET, face: 'front', ru: 10, side: 'right'}]).rack;
  const doc = {...newDoc(), racks: [r]};
  const text = serialize(doc);
  // The kit's reader keeps zeroU as written and drops `side`; keepSiteFields puts it back.
  const kitOnly = parseDoc(text);
  assert.deepEqual(kitOnly.racks[0].zeroU, r.zeroU);
  assert.ok(!('side' in kitOnly.racks[0].items[0]));
  const back = keepSiteFields(text, kitOnly);
  assert.deepEqual(back.racks[0], r);
  // The version is the kit's own: nothing here needs an older page to refuse the file.
  assert.equal(JSON.parse(text).version, 2);
  // An entry with no id gets one, past the ids in use.
  const noId = JSON.parse(text);
  noId.racks[0].zeroU.push({ref: DUCT, at: 'right', offsetMm: 0});
  const fixed = keepSiteFields(noId, parseDoc(noId));
  assert.deepEqual(fixed.racks[0].zeroU.map(z => z.id), ['z1', 'z2']);
  assert.equal(zeroUOf(fixed.racks[0]).length, 2);
  assert.deepEqual(zeroULines(back.racks[0], chassisOf), ['z1 | CMV-SFD45U5W | FS.com CMV-SFD45U5W | between racks at left, U1-U45']);
});

test('the editor takes site commands as one undo step, and kit-only batches as before', () => {
  const doc = {...newDoc({kind: 'two-post'}), racks: [rackOf('two-post', 45)]};
  const ed = withZeroUEditor(createRackEditor({doc, chassisOf}), {chassisOf});
  const events = [];
  ed.on('change', ev => events.push(ev));
  const res = ed.apply([{op: 'zerou.place', ref: DUCT, at: 'right', ru: 1}]);
  assert.ok(!res.error, res.error);
  assert.equal(ed.rack().zeroU.length, 1);
  assert.ok(ed.canUndo);
  assert.match(ed.undoSummary, /Placed CMV-SFD45U5W beside the rack at right/);
  assert.equal(events.at(-1).cause, 'apply');
  ed.undo();
  assert.equal(ed.rack().zeroU.length, 0);
  ed.redo();
  assert.equal(ed.rack().zeroU.length, 1);
  // A refusal changes nothing; a dry run changes nothing.
  assert.match(ed.apply({op: 'zerou.place', ref: DUCT, at: 'right', ru: 1}).error, /Overlaps/);
  assert.ok(!ed.preview({op: 'zerou.remove', id: 'z1'}).error);
  assert.equal(ed.rack().zeroU.length, 1);
  // A kit batch goes to the kit's editor untouched.
  const k = ed.apply({op: 'place', ref: 'fhd-cmp5dr', face: 'front', ru: 3});
  assert.equal(k.created.ids[0], 'i1');
  assert.equal(ed.rack().zeroU.length, 1);
  // The page's own command is still refused to anyone else in a site batch.
  assert.match(ed.apply([{op: 'zerou.remove', id: 'z1'}, {op: 'lengths.routed', routeCtx: {}}]).error, /page's own command/);
});

test('a sided item placed through the editor keeps its side across undo', () => {
  const doc = {...newDoc({kind: 'two-post'}), racks: [rackOf('two-post', 42)]};
  const ed = withZeroUEditor(createRackEditor({doc, chassisOf}), {chassisOf});
  ed.apply({op: 'side.place', ref: BRACKET, face: 'front', ru: 4, side: 'right'});
  ed.apply({op: 'patch', id: 'i1', label: 'fb-1'});
  assert.deepEqual([ed.rack().items[0].side, ed.rack().items[0].label], ['right', 'fb-1']);
  ed.undo();
  assert.equal(ed.rack().items[0].side, 'right');
});

test('fitsSided judges the whole span of a tall narrow part', () => {
  let r = rackOf('two-post', 42);
  ({rack: r} = withItem(r, {ref: 'fhd-cmp5dr', cfg: 'base', face: 'front', ru: 14}));
  assert.match(fitsSided(r, {ref: BRACKET, face: 'front', ru: 10, side: 'left'}, chassisOf).reason, /Taken by/);
  assert.deepEqual(fitsSided(r, {ref: BRACKET, face: 'front', ru: 9, side: 'left'}, chassisOf), {ok: true});
  assert.equal(RU, 44.45);
});
