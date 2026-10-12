// A PORT IS ADDRESSED BY ITS PATH (site/rack/part-path.js). The back of a
// module seated in a bay is drawn on the rear face as a projection, whose
// parts have drawing ids of their own ("bay-1-rear--b01"); the port there is
// {path: "bay-1/module/b01", view: "rear"}. An id given as a path is refused
// before the kit is asked, with the path to use.
import test from 'node:test';
import assert from 'node:assert/strict';
import {isProjectionId, projectionIdRefusal} from '../../site/rack/part-path.js';

test('a projection\'s drawing id is told from a path', () => {
  for (const id of ['bay-1-rear--b01', 'bay-12-rear--b01--1', 'slot-2-rear--p0']) assert.equal(isProjectionId(id), true, id);
  for (const path of ['bay-1/module/b01', 'port-1', 'bay-1', 'mgmt-eth', 'slot-2/module/p0', 'drawer/module/slot-1/module/lc01', 'port-1-occupant/lc1', '', null, 7])
    assert.equal(isProjectionId(path), false, String(path));
});

test('a cable end given a drawing id is refused with the path to use, in either end or a selector, anywhere in a batch', () => {
  const end = (path, view = 'rear') => ({item: 'i1', path, view});
  assert.equal(projectionIdRefusal({op: 'cable.add', a: end('bay-1/module/b01'), b: end('port-1', 'front')}), null);
  assert.equal(projectionIdRefusal([{op: 'place', ref: 'x', face: 'front', ru: 1}, {op: 'rename', name: 'r'}]), null);
  const want = 'bay-1-rear--b01 is a drawing id, not a port. A port on the back of a seated module is addressed by its path with view rear: {path: "bay-1/module/b01", view: "rear"}.';
  assert.equal(projectionIdRefusal({op: 'cable.add', a: end('bay-1-rear--b01'), b: end('port-1', 'front')}), want);
  assert.equal(projectionIdRefusal([{op: 'rename', name: 'r'}, {op: 'cable.update', id: 'c1', b: end('bay-1-rear--b01')}]), want);
  assert.equal(projectionIdRefusal({op: 'cable.remove', select: end('bay-1-rear--b01')}), want);
  assert.match(projectionIdRefusal({op: 'cable.add', a: end('bay-3-rear--b02--1'), b: end('p', 'front')}), /\{path: "bay-3\/module\/b02\/1", view: "rear"\}/);
});
