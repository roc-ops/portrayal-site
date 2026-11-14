// tests/rack/rear-panel-back-end.test.mjs
// A CABLE TO THE BACK OF A PANEL ON THE REAR RAILS: what the page hands the kit and says of it.
// The kit places the far end of such a cable where the other end of the same adapter stands, and measures it.
// It says when an end cannot be reached.
// The page reads the parts lists that needs, for every device with a cable on a seated part.
// It lists the kit's sentence for an end it cannot reach in the cable list, and says it in the cable's text.
// The panes are drawn in check-browser.py (check_rack_rear_panel_back_end). The rules are the kit's.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {seatedRefsOf, routeWarnings} from '../../site/rack/route-context.js';
import {cableText, findingLines} from '../../site/rack/agent-text.js';
import {WARNING_KINDS} from '../../site/rack/cable-panel.js';
import {parseDoc} from '../../vendor/rack/model.js';

const rack = parseDoc(readFileSync(new URL('./back-end/rear-panel-back-end.rack.json', import.meta.url), 'utf8')).racks[0];
const SAID = 'This end cannot be reached: no drawing places port b01 of XCU10 rear.';

test('the parts lists are read for a device with a cable on a part seated in it, and for no other', () => {
  assert.deepEqual(seatedRefsOf(rack).sort(), ['lmfs-f', 'xcu']);
  const plain = {...rack, cables: [{...rack.cables[0], a: {item: 'i1', path: 'port-1', view: 'front'}, b: {item: 'i2', path: 'pon', view: 'rear'}}]};
  assert.deepEqual(seatedRefsOf(plain), [], 'ports of the device itself need none');
  assert.deepEqual(seatedRefsOf({...rack, cables: []}), []);
  assert.deepEqual(seatedRefsOf({...rack, cables: [{...rack.cables[0], a: {item: 'gone', path: 'a/module/b'}}]}), ['xcu']);
});

test('the cable list gives the kit\'s sentence for an end it cannot reach, once for the cable', () => {
  const facts = {unreached: [{kind: 'end-unreachable', cable: 'c1', ends: [{end: 'b', item: 'i2', path: rack.cables[0].b.path, view: 'rear'}], text: SAID}],
    fill: [], over: [], routes: new Map(), ringFindings: [], bodyFindings: []};
  const got = routeWarnings(rack, facts, id => id, {asRead: true}).find(k => k.kind === 'unreached');
  assert.deepEqual(got.rows, [{cable: 'c1', texts: [SAID]}]);
  assert.equal(WARNING_KINDS.unreached, 'Ends that cannot be reached');
  assert.equal(routeWarnings(rack, {...facts, unreached: []}, id => id, {asRead: true}).some(k => k.kind === 'unreached'), false);
  assert.equal(routeWarnings(rack, {...facts, unreached: undefined}, id => id, {asRead: true}).some(k => k.kind === 'unreached'), false);
});

const cable = extra => ({id: 'c1', kind: 'cable', a: {item: 'i1', path: 'lt-1/module/port-1'}, b: {item: 'i2', path: rack.cables[0].b.path, view: 'rear'},
  media: 'os2', length: null, route: {edited: false}, loose: [], mismatch: [], ...extra});

test('a routed length is said when the kit gives one, and "routed length not measured" when it does not', () => {
  const measured = cableText(cable({routed: {metres: 1.416, stock: {value: 1.5, unit: 'm'}}}));
  assert.match(measured, /; routed 1\.42 m, stock size 1\.5 m/);
  assert.doesNotMatch(measured, /not measured/);
  assert.match(cableText(cable({routed: null})), /routed length not measured/);
});

test('an end the kit cannot reach is said in the kit\'s own sentence, as a line of its own, with no length', () => {
  const c = cable({routed: null, route: {edited: false, unreached: {ends: [{end: 'b', item: 'i2', path: rack.cables[0].b.path, view: 'rear'}], text: SAID}}});
  const lines = cableText(c).split('\n');
  assert.ok(lines.includes(SAID), 'the sentence byte for byte');
  assert.match(cableText(c), /routed length not measured/);
  assert.doesNotMatch(cableText(c), /not connected/);
  assert.deepEqual(findingLines(c), [SAID]);
  assert.deepEqual(findingLines(cable({routed: null})), []);
});

test('a loose end is still said as it was', () => {
  const lines = cableText(cable({routed: null, loose: [{end: 'a', reason: 'lt-1/module/port-1 holds no optic'}]})).split('\n');
  assert.ok(lines.includes('Loose: the a end: lt-1/module/port-1 holds no optic'));
});
