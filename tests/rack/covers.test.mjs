// Covers on, see-through or off (portrayal-site#190): the setting is one of
// three, remembered in the browser, and a cover is told by its data-path.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readDistFile, distFaces} from '../dist-files.mjs';
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
  const front = readDistFile('cmv-sfd42u9w.base.front.svg');
  assert.deepEqual(coverPathsIn(front), ['cover-1', 'cover-2']);
  const left = readDistFile('cmv-sfd42u9w.base.left.svg');
  assert.deepEqual(coverPathsIn(left), [], 'the side view marks the cover by kind, which has no path');
  assert.deepEqual(coverPathsIn('<g data-group="body" data-path="base"/><g data-path="a&amp;b" data-class="mechanical" data-group="cover"/>'), ['a&b']);
  // a part of a cover group that is not a plate is not a cover: a screw that holds one, a part with no class
  assert.deepEqual(coverPathsIn('<g data-path="thumbscrew-left" data-class="screw" data-group="cover"/><g data-path="x" data-group="cover"/>'), []);
  assert.deepEqual(coverPathsIn(null), []);
  // a rack-mounted finger duct marks its covers the same way, and a lacer marks none
  assert.deepEqual(coverPathsIn(readDistFile('cmh-dfd1u.base.front.svg')), ['front-cover']);
  assert.deepEqual(coverPathsIn(readDistFile('fhd-cmp5dr.base.front.svg')), []);
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
// (Every device face the site serves, loose or in its device's packs.)
const drawings = distFaces();
const attr = (tag, k) => (new RegExp(`\\s${k}="([^"]*)"`).exec(tag) ?? [])[1] ?? null;
const deviceOf = text => attr(/<svg\b[^>]*>/.exec(text)?.[0] ?? '', 'data-device');
const inCover = text => [...text.matchAll(/<[a-zA-Z][^>]*\sdata-group="cover"[^>]*>/g)].map(m => ({cls: attr(m[0], 'data-class'), path: attr(m[0], 'data-path'), ref: (attr(m[0], 'data-ref') ?? '').split('@')[0]}));
// The devices the control touches, by family: cable managers and ducts, nothing else.
const TOUCHED = ['cmh-bs-dfdabs2u', 'cmh-bs-sfds1u', 'cmh-dfd1u', 'cmh-dfds1u', 'cmh-dfds2u', 'cmh-hd-sfdabs3u', 'cmh-hd-sfdabs4u', 'cmh-sfd1u', 'cmh-sfd2u',
  'cmh-sfds1u', 'cmh-sfds2u', 'cmh-uhd-sfdabs1u', 'cmh-uhd-sfdabs2u', 'cmh-uhd-sfdabs3u', 'cmv-dfd45u5w', 'cmv-dfds45u5w', 'cmv-sfd42u9w', 'cmv-sfd45u5w',
  'cmv-sfds45u5w', 'uscmh-5dr1u', 'uscmh-sfdabs1u', 'uscmh-sfdabs2u', 'uscmh-sfdabsb1u', 'uscmh-sfdabsb2u',
  // added with the cable managers and ducts from Leviton, Belden, StarTech, Hubbell, Panduit and Eaton Tripp Lite
  '491ru-hfr', '49253-2cm', '49253-6mr', '49253-6pm', '49253-bcm', '49253-lpm', '492ru-hfo', '492ru-hfr', '9512-1901', 'bhh191ur', 'bhh192ur', 'bhh193ur',
  'bhh194ur', 'cmduct1ux', 'cmduct2u', 'hm144c', 'hm14c', 'hm24c', 'hm34c', 'hs23c', 'hsd13', 'ncmh2', 'ncmhf2', 'nm1', 'nm2', 'nmf1', 'nmf2', 'nmf3', 'nmf4',
  'pr2hf3wh', 'pr2hf4wh', 'srcableduct1u', 'srcableduct1ufc', 'srcableduct1uhd', 'srcableductvrt', 'wmpvhc45e',
  // the NavePoint cable managers the library added with kit 0.51.0
  '00404167', '00404169', '00404170', '00407295', '00407296', '00407297'];
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
      // what is taken is a plate with a component of its own, whatever its maker calls the cover (-cover, -cover-1ru, 49253-2cv, hm1c); what is left is not a plate
      if (into === taken) assert.match(part.ref, /^[a-z0-9-]+\/[a-z0-9-]+$/, `${f}: ${part.path} is taken and is ${part.ref}`);
      else assert.notEqual(part.cls, 'mechanical', `${f}: ${part.path} is a plate in a cover group and is not taken`);
    }
    assert.equal(mine.size, inCover(text).filter(p => p.cls === 'mechanical').length, `${f}: every path taken is a plate of a cover group`);
  }
  assert.deepEqual([...taken.keys()].sort(), [...TOUCHED].sort());
  assert.deepEqual([...left.keys()].sort(), [...LEFT].sort());
  for (const parts of left.values()) for (const p of parts) assert.match(p, /^screw thumbscrew-(left|right) amphenol-ns\/cover-thumbscrew$/);
  assert.ok(!TOUCHED.some(d => LEFT.includes(d)), 'no device is both');
});

// These cabinets mark their door on the left and right views by kind and have no cover group on the front,
// so the control reaches their side views only.
// The library's newer Chatsworth cabinets (139xx) and Motive vertical managers (326xx) do the same: a door on the side views, no cover group on the front.
const SIDE_ONLY = ['13902-701', '13902-703', '13902-715',
  '13901-701', '13901-703', '13901-715', '13904-701', '13904-703', '13904-715', '13905-701', '13905-703', '13905-715', '13911-701', '13911-703', '13911-715',
  '13912-701', '13912-703', '13912-715', '13914-701', '13914-703', '13914-715', '13915-701', '13915-703', '13915-715',
  '32610-703', '32610-e03', '32611-703', '32611-e03', '32612-703', '32612-e03', '32613-703', '32613-e03', '32614-703', '32614-e03',
  '32620-703', '32620-e03', '32621-703', '32621-e03', '32622-703', '32622-e03', '32623-703', '32623-e03', '32624-703', '32624-e03'];

test('the kind a side view marks a cover by is only ever on a device whose cover plate is taken, or on a side-only cabinet', () => {
  // data-kind="cover" is what the side panes hide (rack.css): on the left and right views it must not reach another part
  const kinds = new Set();
  for (const {f, text} of drawings) if (/\.(left|right)\.svg$/.test(f) && /\sdata-kind="cover"/.test(text)) kinds.add(deviceOf(text));
  assert.ok(kinds.size >= 20);
  assert.deepEqual([...kinds].filter(d => !TOUCHED.includes(d) && !SIDE_ONLY.includes(d)), []);
  // a stale entry fails: each side-only cabinet really carries the side-view kind
  assert.deepEqual(SIDE_ONLY.filter(d => !kinds.has(d)), []);
  // the two lists cannot overlap: no side-only cabinet is touched, nor holds a taken cover plate in any drawing
  assert.deepEqual(SIDE_ONLY.filter(d => TOUCHED.includes(d)), []);
  for (const {f, text} of drawings)
    if (SIDE_ONLY.includes(deviceOf(text))) assert.deepEqual(inCover(text).filter(p => p.cls === 'mechanical'), [], `${f}: a side-only cabinet holds a cover plate`);
});
