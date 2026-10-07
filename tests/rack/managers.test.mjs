import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../../site/rack/model.js';
import * as G from '../../site/rack/managers.js';

const SIZES = {'as7726-32x': {ru: 1, h: 43.5, d: 515}, 'r740xd': {ru: 2, h: 86.8, d: 737.5},
               'fhd-cmp5dr': {ru: 1, h: 44, d: 110, mount: 'rack-face', shell: 'sheet'}};
const chassisOf = ref => SIZES[ref] || null;
const add = (rack, ref, ru, extra = {}) => M.withItem(rack, {ref, cfg: 'x', ru, label: extra.label ?? ref, ...extra}).rack;

test('placement: on a device on that face it attaches; elsewhere it stands alone', () => {
  const r = add(M.newRack(), 'r740xd', 10, {label: 'srv'});
  assert.deepEqual(G.placement(r, {face: 'front', ru: 11}, chassisOf), {face: 'front', ru: 11, on: 'i1', unit: 2});
  assert.deepEqual(G.placement(r, {face: 'rear', ru: 11}, chassisOf), {face: 'rear', ru: 11});
  assert.deepEqual(G.placement(r, {face: 'front', ru: 12}, chassisOf), {face: 'front', ru: 12});
});

test('placement never hosts a manager on another manager', () => {
  const r = add(M.newRack(), 'fhd-cmp5dr', 10);
  assert.equal(G.hostAt(r, 'front', 10, chassisOf), null);
});

test('moveItem: a host carries its managers, both of a 2U host by one U', () => {
  let r = add(M.newRack(), 'r740xd', 10, {label: 'srv'});
  r = add(r, 'fhd-cmp5dr', 10, {on: 'i1', unit: 1});
  r = add(r, 'fhd-cmp5dr', 11, {on: 'i1', unit: 2});
  const m = G.moveItem(r, 'i1', {ru: 11}, chassisOf);
  assert.equal(m.ok, true);
  assert.deepEqual(m.rack.items.map(i => i.ru), [11, 11, 12]);
});

test('moveItem: a host is refused when a manager of its would collide, and nothing changes', () => {
  let r = add(M.newRack(), 'as7726-32x', 10, {label: 'leaf'});
  r = add(r, 'fhd-cmp5dr', 10, {on: 'i1', unit: 1, label: 'mgr-a'});
  r = add(r, 'fhd-cmp5dr', 20, {label: 'mgr-b'});
  const m = G.moveItem(r, 'i1', {ru: 20}, chassisOf);
  assert.deepEqual(m, {ok: false, reason: 'mgr-a moves with it: Taken by mgr-b on the front.'});
});

test('moveItem: a manager dropped on a device attaches, and dropped on empty space detaches', () => {
  let r = add(M.newRack(), 'as7726-32x', 10);
  r = add(r, 'fhd-cmp5dr', 30);
  const on = G.moveItem(r, 'i2', {ru: 10, face: 'front'}, chassisOf);
  assert.deepEqual([on.rack.items[1].on, on.rack.items[1].unit], ['i1', 1]);
  const off = G.moveItem(on.rack, 'i2', {ru: 5}, chassisOf);
  assert.equal('on' in off.rack.items[1], false);
});

test('settleManagers: a missing host detaches; a stale ru follows the host; a non-manager loses on', () => {
  const rack = {...M.newRack(), items: [
    {id: 'i1', ref: 'as7726-32x', cfg: 'x', label: 'leaf', ru: 12, face: 'front', turned: false, swaps: {}, fields: {}},
    {id: 'i2', ref: 'fhd-cmp5dr', cfg: 'x', label: 'mgr-1', ru: 9, face: 'front', turned: false, swaps: {}, fields: {}, on: 'i1', unit: 1},
    {id: 'i3', ref: 'fhd-cmp5dr', cfg: 'x', label: 'mgr-2', ru: 30, face: 'front', turned: false, swaps: {}, fields: {}, on: 'i9', unit: 1},
    {id: 'i4', ref: 'r740xd', cfg: 'x', label: 'srv', ru: 1, face: 'front', turned: false, swaps: {}, fields: {}, on: 'i1', unit: 1}]};
  const {rack: s, notices} = G.settleManagers(rack, chassisOf);
  assert.equal(s.items[1].ru, 12);
  assert.equal('on' in s.items[2], false);
  assert.equal('on' in s.items[3], false);
  assert.deepEqual(notices, [
    'mgr-1 was out of step with leaf, so it moved to U12 with it.',
    'mgr-2: the device it was on is not in this rack, so it stays at U30 on its own.',
    'srv is not a cable manager, so it is not on another device.']);
});
