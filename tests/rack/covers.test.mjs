// Covers on, see-through or off (portrayal-site#190): the setting is one of
// three, remembered in the browser, and a cover is told by its data-path.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {COVERS_KEY, COVER_STATES, COVERS_DEFAULT, COVER_FADE, loadCovers, saveCovers, underCover, coverPathsIn} from '../../site/rack/covers.js';

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
  assert.deepEqual(coverPathsIn('<g data-group="body" data-path="base"/><g data-path="a&amp;b" data-group="cover"/>'), ['a&b']);
  assert.deepEqual(coverPathsIn(null), []);
  // a rack-mounted finger duct marks its covers the same way, and a lacer marks none
  assert.deepEqual(coverPathsIn(readFileSync(new URL('../../assets/dist/cmh-dfd1u.base.front.svg', import.meta.url), 'utf8')), ['front-cover']);
  assert.deepEqual(coverPathsIn(readFileSync(new URL('../../assets/dist/fhd-cmp5dr.base.front.svg', import.meta.url), 'utf8')), []);
});

test('the page paints the three settings, and only inside the panes', () => {
  const css = readFileSync(new URL('../../site/rack/rack.css', import.meta.url), 'utf8');
  assert.ok(css.includes('.rk-panes[data-covers="on"] :is([data-in-front], [data-covers-front]) [data-front="cover"] { opacity: 1; }'));
  assert.ok(css.includes('.rk-panes[data-covers="off"] :is([data-zerou-id], [data-item-id]) :is([data-group="cover"], [data-kind="cover"]) { visibility: hidden; }'));
  assert.ok(!/^\[data-covers|^\[data-front="cover"\]/m.test(css), 'no cover rule reaches a drawing outside the panes');
});
