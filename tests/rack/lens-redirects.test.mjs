// A PART THE LIBRARY REPLACED, THROUGH THE EXPLORER LENS (kit 0.32.0, "a replaced
// part leaves a redirect"). A saved rack names a part by ref; the Explorer shows
// only the refs a slot takes today, so a replaced `@1` holder named in the rack
// was dropped when the lens wrote back. The page hands the kit's `redirects` to
// the lens (the refs go in as their replacements) and to the patch that takes
// the lens's answer (the same, for any that come back old).
import test from 'node:test';
import assert from 'node:assert/strict';
import {redirectsOf} from '../../vendor/redirects.js';
import {createRackEditor} from '../../vendor/rack/editor.js';
import * as M from '../../vendor/rack/model.js';
import {swapsForLens} from '../../site/rack/lens-redirects.js';
import {chassisOf, slotsOf, compByRef} from './fixtures/kit-slots.mjs';

// fs/fhd-fap12lcd-os2@1 stands where fs/fhd-fap12lcd-os2-old@1 stood.
const OLD = 'fs/fhd-fap12lcd-os2-old@1', NEW = 'fs/fhd-fap12lcd-os2@1';
const redirects = redirectsOf([{ns: 'fs', name: 'fhd-fap12lcd-os2', major: 1, supersedes: [{ref: OLD}]}]);

test('the swaps a lens opens with name the replacement of a replaced ref, and nothing else moves', () => {
  assert.equal(redirects.follow(OLD), NEW, 'the fixture redirect resolves');
  const {swaps, moved} = swapsForLens({'bay-1': OLD, 'bay-2': 'fs/fhd-fap6scd-os2@1', 'bay-3': ''}, redirects);
  assert.deepEqual(swaps, {'bay-1': NEW, 'bay-2': 'fs/fhd-fap6scd-os2@1', 'bay-3': ''});
  assert.deepEqual(moved, [{path: 'bay-1', from: OLD, to: NEW}]);
});

test('no redirects, or none that apply, hands the same swaps', () => {
  const swaps = {'bay-1': NEW};
  assert.equal(swapsForLens(swaps, null).swaps, swaps);
  assert.equal(swapsForLens(swaps, redirects).swaps['bay-1'], NEW);
  assert.deepEqual(swapsForLens(undefined, redirects).swaps, {});
});

test('a patch from the lens that still names the old ref keeps the holder as its replacement, once redirects are in the context', () => {
  const doc = M.newDoc();
  const ed = createRackEditor({doc, chassisOf});
  const placed = ed.apply({op: 'place', ref: 'fhd-1ufce', face: 'front', ru: 3}, {origin: 'ui'});
  assert.ok(!placed.error, placed.error);
  const id = ed.rack().items[0].id;
  // without redirects the old ref is a ref the slot does not take: it is left out
  const lost = ed.apply({op: 'patch', id, swaps: {'bay-1': OLD}}, {origin: 'ui', ctx: {slotsOf, compByRef}});
  assert.ok(!lost.error, lost.error);
  assert.equal(ed.rack().items[0].swaps?.['bay-1'], undefined, 'without redirects the holder is dropped');
  // with them it is kept, as the replacement
  const kept = ed.apply({op: 'patch', id, swaps: {'bay-1': OLD}}, {origin: 'ui', ctx: {slotsOf, compByRef, redirects}});
  assert.ok(!kept.error, kept.error);
  assert.equal(ed.rack().items[0].swaps['bay-1'], NEW);
});
