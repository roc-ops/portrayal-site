// Covers on, see-through or off (portrayal-site#190): the setting is one of
// three, remembered in the browser, and a cover is told by its data-path.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {COVERS_KEY, COVER_STATES, COVERS_DEFAULT, COVER_FADE, COVER_PLATE, loadCovers, saveCovers, underCover, coverPathsIn} from '../../site/rack/covers.js';

const store = (v = null) => { const m = new Map(v == null ? [] : [[COVERS_KEY, v]]); return {getItem: k => m.get(k) ?? null, setItem: (k, x) => { m.set(k, String(x)); }, map: m}; };

test('three settings, see-through to begin with, and only those three are read back', () => {
  assert.deepEqual(COVER_STATES.map(s => s[0]), ['on', 'see', 'off']);
  assert.equal(COVERS_DEFAULT, 'see');
  assert.equal(loadCovers(store()), 'see');
  for (const s of ['on', 'see', 'off']) assert.equal(loadCovers(store(s)), s);
  for (const junk of ['', 'On', 'open', 'true', '{}']) assert.equal(loadCovers(store(junk)), 'see', junk);
  const s = store(); saveCovers('off', s);
  assert.equal(s.map.get(COVERS_KEY), 'off');
  const blocked = {getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }};
  assert.equal(loadCovers(blocked), 'see');
  assert.doesNotThrow(() => saveCovers('on', blocked));
  assert.ok(COVER_FADE > 0.1 && COVER_FADE < 0.5, 'a see-through cover is plainly there and plainly seen through');
});

test('a mesh is a cover by its path: a cover group, or a node under one, and nothing that only starts alike', () => {
  const paths = new Set(['cover-1', 'cover-2']);
  assert.equal(underCover(paths, 'cover-1'), true);
  assert.equal(underCover(paths, 'cover-2/lip-left'), true);
  assert.equal(underCover(paths, 'cover-10'), false);
  assert.equal(underCover(paths, 'cover'), false);
  assert.equal(underCover(paths, 'finger-left-1'), false);
  assert.equal(underCover(paths, undefined), false);
  assert.equal(underCover(null, 'cover-1'), false);
});

test("the vertical manager's drawing marks its two covers on the front, and no other group is taken for one", () => {
  const front = readFileSync(new URL('../../assets/dist/cmv-sfd42u9w.base.front.svg', import.meta.url), 'utf8');
  assert.deepEqual(coverPathsIn(front), ['cover-1', 'cover-2']);
  const left = readFileSync(new URL('../../assets/dist/cmv-sfd42u9w.base.left.svg', import.meta.url), 'utf8');
  assert.deepEqual(coverPathsIn(left), [], 'the side view marks the cover by kind, which has no path');
  assert.deepEqual(coverPathsIn('<g data-group="body" data-path="base"/><g data-path="a&amp;b" data-class="mechanical" data-group="cover"/>'), ['a&b']);
  // a part of a cover group that is not a plate is not a cover: a screw that holds one, a part with no class
  assert.deepEqual(coverPathsIn('<g data-path="thumbscrew-left" data-class="screw" data-group="cover"/><g data-path="x" data-group="cover"/>'), []);
  assert.deepEqual(coverPathsIn(null), []);
  // a rack-mounted finger duct marks its covers the same way, and a lacer marks none
  assert.deepEqual(coverPathsIn(readFileSync(new URL('../../assets/dist/cmh-dfd1u.base.front.svg', import.meta.url), 'utf8')), ['front-cover']);
  assert.deepEqual(coverPathsIn(readFileSync(new URL('../../assets/dist/fhd-cmp5dr.base.front.svg', import.meta.url), 'utf8')), []);
});

test('the page paints the three settings, and only inside the panes', () => {
  const css = readFileSync(new URL('../../site/rack/rack.css', import.meta.url), 'utf8');
  assert.ok(css.includes('.rk-panes[data-covers="on"] :is([data-in-front], [data-covers-front]) [data-front="cover"] { opacity: 1; }'));
  assert.equal(COVER_PLATE, '[data-group="cover"][data-class="mechanical"]');
  assert.ok(css.includes(`.rk-panes[data-covers="off"] :is([data-zerou-id], [data-item-id]) :is(${COVER_PLATE}, [data-kind="cover"]) { visibility: hidden; }`));
  assert.ok(!/\[data-group="cover"\](?!\[data-class="mechanical"\])/.test(css), 'no rule takes a cover group whole');
  assert.ok(!/^\[data-covers|^\[data-front="cover"\]/m.test(css), 'no cover rule reaches a drawing outside the panes');
});

// THE WHOLE CATALOGUE: every compiled drawing, what it puts in a `cover` group, and what the control takes of it.
const DIST = new URL('../../assets/dist/', import.meta.url);
const drawings = readdirSync(DIST).filter(f => /\.svg$/.test(f)).map(f => ({f, text: readFileSync(new URL(f, DIST), 'utf8')}));
const attr = (tag, k) => (new RegExp(`\\s${k}="([^"]*)"`).exec(tag) ?? [])[1] ?? null;
const deviceOf = text => attr(/<svg\b[^>]*>/.exec(text)?.[0] ?? '', 'data-device');
const inCover = text => [...text.matchAll(/<[a-zA-Z][^>]*\sdata-group="cover"[^>]*>/g)].map(m => ({cls: attr(m[0], 'data-class'), path: attr(m[0], 'data-path'), ref: (attr(m[0], 'data-ref') ?? '').split('@')[0]}));
// The devices the control touches, by family: cable managers and ducts, nothing else.
const TOUCHED = ['cmh-bs-dfdabs2u', 'cmh-bs-sfds1u', 'cmh-dfd1u', 'cmh-dfds1u', 'cmh-dfds2u', 'cmh-hd-sfdabs3u', 'cmh-hd-sfdabs4u', 'cmh-sfd1u', 'cmh-sfd2u',
  'cmh-sfds1u', 'cmh-sfds2u', 'cmh-uhd-sfdabs1u', 'cmh-uhd-sfdabs2u', 'cmh-uhd-sfdabs3u', 'cmv-dfd45u5w', 'cmv-dfds45u5w', 'cmv-sfd42u9w', 'cmv-sfd45u5w',
  'cmv-sfds45u5w', 'uscmh-5dr1u', 'uscmh-sfdabs1u', 'uscmh-sfdabs2u', 'uscmh-sfdabsb1u', 'uscmh-sfdabsb2u'];
// What a `cover` group holds that is NOT a cover, and is left alone: the Amphenol power panels' thumbscrews.
const LEFT = ['300cb08', '300cb08-c', '300cb08-sc', 'nrg300cb08-ctrl', 'nrg300cb08-ctrl-c', 'nrg300cb08-ctrl-sc', 'nrg300cb08-sens', 'nrg300cb08-sens-c',
  'nrg300cb08-sens-sc', 'nrgils300cb08', 'nrgils300cb08-sc'];

test('over the whole catalogue the control takes the cover plates of cable managers and ducts, and nothing else', () => {
  const taken = new Map(), left = new Map();
  for (const {f, text} of drawings) {
    const dev = deviceOf(text), mine = new Set(coverPathsIn(text));
    for (const part of inCover(text)) {
      const into = mine.has(part.path) && part.cls === 'mechanical' ? taken : left;
      if (!into.has(dev)) into.set(dev, new Set());
      into.get(dev).add(`${part.cls} ${part.path} ${part.ref}`);
      // what is taken is a plate whose own component is a cover; what is left is not a plate
      if (into === taken) assert.match(part.ref, /-cover(-upper|-lower)?$/, `${f}: ${part.path} is taken and is ${part.ref}`);
      else assert.notEqual(part.cls, 'mechanical', `${f}: ${part.path} is a plate in a cover group and is not taken`);
    }
    assert.equal(mine.size, inCover(text).filter(p => p.cls === 'mechanical').length, `${f}: every path taken is a plate of a cover group`);
  }
  assert.deepEqual([...taken.keys()].sort(), [...TOUCHED].sort());
  assert.deepEqual([...left.keys()].sort(), [...LEFT].sort());
  for (const parts of left.values()) for (const p of parts) assert.match(p, /^screw thumbscrew-(left|right) amphenol-ns\/cover-thumbscrew$/);
  assert.ok(!TOUCHED.some(d => LEFT.includes(d)), 'no device is both');
});

test('the kind a side view marks a cover by is only ever on a device whose cover plate is taken', () => {
  // data-kind="cover" is what the side panes hide (rack.css): on the left and right views it must not reach another part
  const kinds = new Set();
  for (const {f, text} of drawings) if (/\.(left|right)\.svg$/.test(f) && /\sdata-kind="cover"/.test(text)) kinds.add(deviceOf(text));
  assert.ok(kinds.size >= 20);
  assert.deepEqual([...kinds].filter(d => !TOUCHED.includes(d)), []);
});
