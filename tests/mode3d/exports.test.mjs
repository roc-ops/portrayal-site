import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportMeshes } from '../../site/mode3d.js';

// A GLB laid out the way GLTFExporter writes one: a 12-byte header, then a
// JSON chunk padded with spaces to four bytes. The empty one is what an export
// of an unbuilt scene gave (#111): an asset, a scene, and no meshes.
function glb(json) {
  let text = JSON.stringify(json);
  while (text.length % 4) text += ' ';
  const body = new TextEncoder().encode(text);
  const out = new Uint8Array(20 + body.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true);          // 'glTF'
  dv.setUint32(4, 2, true);
  dv.setUint32(8, out.length, true);
  dv.setUint32(12, body.length, true);
  dv.setUint32(16, 0x4e4f534a, true);         // 'JSON'
  out.set(body, 20);
  return out.buffer;
}

test('a GLB with no meshes counts none, one with meshes counts them', () => {
  const empty = glb({asset: {version: '2.0'}, scenes: [{nodes: []}], scene: 0});
  assert.equal(exportMeshes('glb', empty), 0);
  assert.equal(exportMeshes('glb', glb({asset: {version: '2.0'}, meshes: [{}, {}, {}]})), 3);
  assert.equal(exportMeshes('glb', new Uint8Array(glb({meshes: [{}]}))), 1);
});

test('anything that is not a GLB counts as no meshes', () => {
  assert.equal(exportMeshes('glb', new ArrayBuffer(0)), 0);
  assert.equal(exportMeshes('glb', new TextEncoder().encode('not a glb at all, really').buffer), 0);
});

test('a USDZ counts its distinct geometry files', () => {
  // the name appears in the local header, the central directory and the
  // reference from model.usda: one geometry, three mentions
  const one = 'PK..geometries/Geometry_12.usda...PK..geometries/Geometry_12.usda...@./geometries/Geometry_12.usda@';
  assert.equal(exportMeshes('usdz', new TextEncoder().encode(one)), 1);
  const two = one + 'PK..geometries/Geometry_40.usda';
  assert.equal(exportMeshes('usdz', new TextEncoder().encode(two)), 2);
  assert.equal(exportMeshes('usdz', new TextEncoder().encode('PK..model.usda...')), 0);
});
