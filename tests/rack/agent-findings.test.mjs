// The site's share of Portrayal #1067 (kit 0.35.0 and later): what an agent
// reads back of a cable's ring findings, and what edit_rack says of the cables
// an edit touched. The kit's own sentences are said whole.

import test from 'node:test';
import assert from 'node:assert/strict';
import {COMMANDS} from '../../vendor/rack/commands.js';
import {routes, touchedCables, findingNotes} from '../../site/rack/agent-edit.js';
import {cableText, findingLines} from '../../site/rack/agent-text.js';
import {rackTools} from '../../site/rack/agent-tools.js';
import * as M from '../../vendor/rack/model.js';
import * as Q from '../../vendor/rack/queries.js';
import {createRackEditor} from '../../vendor/rack/editor.js';
import {SIZES, chassisOf, slotsOf, compByRef} from './fixtures/kit-slots.mjs';

const RING = {item: 'i3', via: 'ring-2', text: 'c1 enters and leaves ring 2 of i3 by one face; ring 2 holds it on the front.'};
const BEND = {text: 'turns 155.9 degrees at ring 5, between ring 4 and its port on i2.', advice: 'Give it a wider turn.', stop: {item: 'i3', via: 'ring-5'}};
const cable = (extra = {}) => ({kind: 'cable', id: 'c1', a: {item: 'i1', path: 'port-1', view: 'front'}, b: {item: 'i2', path: 'port-1', view: 'front'},
  media: 'cat6', loose: [], ...extra});

test('cableText prints each route.ring_findings sentence whole, after the tight bends', () => {
  const said = cableText(cable({route: {bends: [BEND], ring_findings: [RING, {...RING, via: 'ring-3', text: 'c1 also does it at ring 3.'}]}}));
  const lines = said.split('\n');
  const bend = lines.findIndex(l => l.startsWith('Tight bend: turns 155.9 degrees at ring 5, between ring 4 and its port on i2. Give it a wider turn.'));
  assert.ok(bend >= 0, said);
  assert.equal(lines[bend + 1], `Ring: ${RING.text}`);
  assert.equal(lines[bend + 2], 'Ring: c1 also does it at ring 3.');
  assert.doesNotMatch(cableText(cable({route: {bends: [], ring_findings: []}})), /Ring:/);
  assert.doesNotMatch(cableText(cable()), /Ring:/);
});

test('findingLines: the bends, ring findings and spare findings of a cable, and nothing else', () => {
  const o = cable({route: {bends: [BEND], ring_findings: [RING], covers: {text: 'runs in front of i4 port-3'}},
    spare_findings: [{kind: 'spare-short', text: 'c1 is 0.3 m and needs 0.42 m.'}]});
  assert.deepEqual(findingLines(o), [
    `Tight bend: ${BEND.text} ${BEND.advice}`, `Ring: ${RING.text}`, 'Spare: c1 is 0.3 m and needs 0.42 m.']);
  assert.deepEqual(findingLines(cable()), []);
});

test('cable.lay is in the commands that get the routes', () => {
  assert.equal(routes([{op: 'cable.lay', id: 'c1', item: 'i3', via: 'ring-2', position: 2}]), true);
  assert.equal(routes([{op: 'cable.slack', id: 'c1'}]), true);
  assert.equal(routes([{op: 'place', ref: 'x'}]), false);
});

test('touchedCables: the cables a batch created or names, once each, that the rack now has', () => {
  const rack = {cables: [{id: 'c1'}, {id: 'c2'}, {id: 'c3'}]};
  const res = {created: {ids: ['i4', 'c3']}};
  const cmds = [{op: 'cable.update', id: 'c2'}, {op: 'cable.route', id: 'c1'}, {op: 'cable.lay', id: 'c2'},
    {op: 'cable.remove', id: 'c9'}, {op: 'bundle.add', cables: ['c1', 'c2']}, {op: 'place', ref: 'r'}];
  assert.deepEqual(touchedCables(rack, cmds, res), ['c3', 'c2', 'c1']);
  assert.deepEqual(touchedCables(rack, [{op: 'place', ref: 'r'}], {}), []);
});

test('findingNotes: one Note a finding, led by the cable, in the kit\'s words, and bounded', () => {
  const read = [{id: 'c1', o: cable({route: {bends: [BEND], ring_findings: [RING]}})}, {id: 'c2', o: cable({id: 'c2'})},
    {id: 'c3', o: cable({id: 'c3', spare_findings: [{kind: 'spare-short', text: 'c3 is 0.3 m and needs 0.42 m.'}]})}];
  assert.deepEqual(findingNotes(read), [
    `Note: c1: Tight bend: ${BEND.text} ${BEND.advice}`, `Note: c1: Ring: ${RING.text}`, 'Note: c3: Spare: c3 is 0.3 m and needs 0.42 m.']);
  const many = Array.from({length: 40}, (_, i) => ({id: `c${i}`, o: cable({id: `c${i}`, route: {ring_findings: [RING]}})}));
  const out = findingNotes(many);
  assert.equal(out.length, 13);  // 12 findings, then one line saying how many were left out
  assert.match(out.at(-1), /^Note: 28 more findings on other cables; inspect names them\.$/);
  assert.ok(findingNotes([{id: 'c1', o: cable({route: {ring_findings: [{...RING, text: 'x'.repeat(900)}]}})}])[0].length <= 330);
});

const setup = ({inspect}) => {
  const ed = createRackEditor({doc: M.newDoc(), chassisOf});
  const ctx = async (rack, refs, opts = {}) => ({chassisOf, slotsOf, compByRef, cableFacts: async () => ({ends: new Map()}), ...(opts.route ? {route: {}} : {})});
  const queries = {
    describe: (r, win) => Q.describe(r, {chassisOf}, win), catalog: f => Q.catalog(SIZES, f),
    fitsAt: (r, s) => Q.fitsAt(r, s, {chassisOf}), freeUs: (r, s) => Q.freeUs(r, s, {chassisOf}),
    freePorts: () => ({}), looseEnds: r => Q.looseEnds(r, {cableFacts: async () => ({ends: new Map()})}),
    inspect, selectCables: (r, sel, c) => Q.selectCables(r, sel, c)};
  const tools = Object.fromEntries(rackTools({ed, chassisOf, queries, runExport: async () => ({}), context: ctx}).map(t => [t.name, t]));
  return {ed, run: (n, a) => tools[n].execute(a)};
};
const PLACE = [
  {op: 'place', ref: 'as7726-32x', face: 'front', ru: 40, as: 'a'}, {op: 'place', ref: 'as7726-32x', face: 'front', ru: 38, as: 'b'},
  {op: 'cable.add', a: {item: '@a', path: 'port-1', view: 'front'}, b: {item: '@b', path: 'port-1', view: 'front'}}];

test('edit_rack says what the kit finds of the cables the edit touched, read after the edit', async () => {
  const seen = [];
  const {ed, run} = setup({inspect: (r, id, ctx) => {
    seen.push({id, cables: r.cables.length, route: !!ctx.route});
    return {kind: 'cable', id, route: {bends: [BEND], ring_findings: [RING]}};
  }});
  const res = await run('edit_rack', {commands: PLACE});
  const t = res.content[0].text;
  assert.match(t, /\nNote: c1: Tight bend: turns 155\.9 degrees/);
  assert.match(t, /\nNote: c1: Ring: c1 enters and leaves ring 2/);
  assert.deepEqual(seen, [{id: 'c1', cables: 1, route: true}]);  // after the edit, with the routes
  assert.equal(ed.rack().cables.length, 1);
});

test('edit_rack: a dry run, an edit that touches no cable, and a read that fails say nothing extra', async () => {
  let calls = 0;
  const {run} = setup({inspect: () => { calls++; throw new Error('no routes'); }});
  const dry = await run('edit_rack', {commands: PLACE, dry_run: true});
  assert.doesNotMatch(dry.content[0].text, /Note:/);
  const placed = await run('edit_rack', {commands: [{op: 'place', ref: 'as7726-32x', face: 'front', ru: 10}]});
  assert.doesNotMatch(placed.content[0].text, /Note:/);
  assert.equal(calls, 0);
  const real = await run('edit_rack', {commands: PLACE.map(c => c.ru === 40 ? {...c, ru: 30} : c)});
  assert.equal(real.isError, undefined, real.content[0].text);
  assert.doesNotMatch(real.content[0].text, /Note:/);
  assert.equal(calls, 1);
});
