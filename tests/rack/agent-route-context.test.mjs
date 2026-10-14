// S-0038: a batch of cable.lay or cable.slack is given the route context, so the
// kit's own checks on a ring, a pathway name and a face run for an agent as
// they do for any caller (commands.js guards them with `if (ctx.route)`).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../../vendor/rack/model.js';
import {rackTools} from '../../site/rack/agent-tools.js';
import {createRackEditor} from '../../vendor/rack/editor.js';
import {routes} from '../../site/rack/agent-edit.js';

const CMP = {ru: 1, w: 483, h: 44, d: 110, mount: 'rack-face', shell: 'sheet', guides: {front: ['guide-3']}};
const SIZES = {sw: {ru: 1, w: 438, h: 43.5, d: 536}, panel: {ru: 1, w: 448, h: 44, d: 432.8}, cmp: CMP};
const chassisOf = ref => SIZES[ref] ?? null;
const RING = {via: 'guide-3', kind: 'ring', face: 'front', run: 'x', depth: 6.8, x: 0, aperture: {w: 32, h: 29.5}};
const item = (id, ref, ru, extra = {}) => ({id, ref, cfg: 'base', label: id.toUpperCase(), ru, face: 'front', turned: false,
  swaps: {}, fields: {}, ...extra});
const cord = {id: 'c1', a: {item: 'sw', path: 'p1', view: 'front'}, b: {item: 'pp', path: 'lc1', view: 'front'},
  media: 'om4', purpose: 'uplink', label: '', route: [{item: 'cm', via: 'guide-3'}], routeEdited: true};
const rack = {id: 'r1', name: 'lay', frame: {kind: 'four-post', heightRU: 42, numbering: 'bottom-up', railDepth: 740},
  items: [item('sw', 'sw', 40), item('pp', 'panel', 41), item('cm', 'cmp', 41, {on: 'pp', unit: 1})], zeroU: [], cables: [cord]};
const routeCtx = {chassisOf, guidesOf: id => (id === 'cm' ? [RING] : []),
  portX: end => ({'sw|p1': -40, 'pp|lc1': 40})[`${end.item}|${end.path}`] ?? null};

// The page's context, as the route-aware tools get it: the route context only when asked for.
const setup = async () => {
  const seen = [];
  const context = async (r, refs, opts = {}) => { seen.push(opts); return {chassisOf, ...(opts.route ? {route: routeCtx} : {})}; };
  const ed = createRackEditor({doc: {...M.newDoc(), racks: [rack]}, chassisOf});
  const tools = Object.fromEntries(rackTools({ed, chassisOf, queries: {}, runExport: async () => ({}), context}).map(t => [t.name, t]));
  return {ed, seen, run: args => tools.edit_rack.execute(args)};
};
const text = r => r.content[0].text;

test('routes() asks for the route context for lay, slack and slack.clear', () => {
  for (const op of ['cable.route', 'cable.lay', 'cable.slack', 'cable.slack.clear', 'bundle.add'])
    assert.equal(routes([{op}]), true, op);
  assert.equal(routes([{op: 'cable.add'}, {op: 'place'}]), false);
});

test('cable.lay with a face on a ring is refused', async () => {
  const {run, seen, ed} = await setup();
  const before = ed.rack();
  const res = await run({commands: [{op: 'cable.lay', id: 'c1', at: {item: 'cm', via: 'guide-3'}, face: 'top'}]});
  assert.equal(res.isError, true, text(res));
  assert.match(text(res), /is no tray/);
  assert.deepEqual(seen.at(-1), {route: true});
  assert.equal(ed.rack(), before);
});

test('cable.slack on a pathway that does not exist, and on a ring, is refused', async () => {
  const {run, ed} = await setup();
  const before = ed.rack();
  for (const via of ['zzz', 'guide-3']) {
    const res = await run({commands: [{op: 'cable.slack', id: 'c1', at: {item: 'cm', via}, value: 0.2}]});
    assert.equal(res.isError, true, `${via}: ${text(res)}`);
  }
  assert.equal(ed.rack(), before);
});

test('cable.slack at an end still works', async () => {
  const {run, ed} = await setup();
  const res = await run({commands: [{op: 'cable.slack', id: 'c1', at: {end: 'a'}, value: 0.2}]});
  assert.equal(res.isError, undefined, text(res));
  assert.match(text(res), /at its A end/);
  assert.equal(ed.rack().cables[0].slack.length, 1);
});
