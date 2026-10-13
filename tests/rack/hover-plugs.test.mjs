// THE OTHER CABLES' PLUGS DIM WITH THEIR TUBES (#179). A plug is a mesh of its
// device (group `device-<item>`, tagged userData.portrayalPath by relief.js),
// outside the cable and bundle groups; it is found by the cable's end and goes
// with its cable: lit while the cable is, dimmed with the rest otherwise, and
// put back exactly when the hover ends.
import test from 'node:test';
import assert from 'node:assert/strict';
import {litFor, paintHover3d, holdUndimmed} from '../../site/rack/hover.js';

class Node3 {
  constructor(name, userData = {}, material = null) {
    this.name = name; this.userData = userData; this.children = []; this.isMesh = !!material; this.material = material;
  }
  add(...c) { this.children.push(...c); return this; }
  traverse(fn) { fn(this); for (const c of this.children) c.traverse(fn); }
  getObjectByName(n) { let hit = null; this.traverse(o => { if (!hit && o.name === n) hit = o; }); return hit; }
}
const mat = () => ({transparent: false, opacity: 1, depthWrite: true, needsUpdate: false});

// c1: sw1 port-1 to sw2 port-1; c2: sw1 port-2 to sw2 port-2; port-3 on sw1 is a seated optic with no cable.
const rack = {cables: [
  {id: 'c1', a: {item: 'sw1', view: 'front', path: 'port-1'}, b: {item: 'sw2', view: 'front', path: 'port-1-occupant/tx'}},
  {id: 'c2', a: {item: 'sw1', view: 'front', path: 'port-2'}, b: {item: 'sw2', view: 'front', path: 'port-2'}},
], bundles: []};

function build() {
  const m = {c1: mat(), c2: mat(), body1: mat(), body2: mat(),
    p: {'sw1|port-1': mat(), 'sw1|port-2': mat(), 'sw1|port-3': mat(), 'sw2|port-1': mat(), 'sw2|port-2': mat()}};
  const plug = (item, port) => new Node3(`plug-${item}-${port}`, {portrayalPath: `${port}-occupant`}, m.p[`${item}|${port}`]);
  const world = new Node3('root').add(
    new Node3('patch-cables').add(new Node3('cable-c1').add(new Node3('t', {}, m.c1)), new Node3('cable-c2').add(new Node3('t', {}, m.c2))),
    new Node3('device-sw1').add(new Node3('body', {}, m.body1), plug('sw1', 'port-1'), plug('sw1', 'port-2'), plug('sw1', 'port-3')),
    new Node3('device-sw2').add(new Node3('body', {}, m.body2), plug('sw2', 'port-1'), plug('sw2', 'port-2')));
  return {m, scene: {three: {scene: world}}};
}
const dimmed = x => x.transparent === true && x.opacity < 0.2 && x.depthWrite === false;
const untouched = x => x.transparent === false && x.opacity === 1 && x.depthWrite === true;

test('hovering c1 dims c2\'s plugs at both ends and leaves c1\'s lit', () => {
  const {m, scene} = build();
  paintHover3d(scene, litFor(rack, {kind: 'cable', id: 'c1'}));
  assert.ok(dimmed(m.c2), 'c2\'s tube dims (as before)');
  assert.ok(dimmed(m.p['sw1|port-2']) && dimmed(m.p['sw2|port-2']), 'c2\'s plugs dim');
  assert.ok(untouched(m.p['sw1|port-1']) && untouched(m.p['sw2|port-1']), 'c1\'s plugs stay lit, at either spelling of the end');
});

test('a plug no cable ends at, and the devices themselves, are not dimmed', () => {
  const {m, scene} = build();
  paintHover3d(scene, litFor(rack, {kind: 'cable', id: 'c1'}));
  assert.ok(untouched(m.p['sw1|port-3']) && untouched(m.body1) && untouched(m.body2));
});

test('leaving restores every plug exactly, and an export holds them undimmed', async () => {
  const {m, scene} = build();
  paintHover3d(scene, litFor(rack, {kind: 'cable', id: 'c2'}));
  assert.ok(dimmed(m.p['sw1|port-1']));
  await holdUndimmed(scene, async () => assert.ok(untouched(m.p['sw1|port-1']) && untouched(m.p['sw2|port-1'])));
  assert.ok(dimmed(m.p['sw1|port-1']), 'dimmed again after the export');
  paintHover3d(scene, null);
  for (const p of Object.values(m.p)) assert.ok(untouched(p));
});
