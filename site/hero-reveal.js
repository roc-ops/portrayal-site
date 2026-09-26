// The tagline, demonstrated instead of claimed.
//
// Left of the divider is `ufispace-s9600-72xc.front.png` - the raster we ship
// to a DCIM, and a picture in the ordinary sense. Right of it is the compiled
// SVG of the SAME drawing, with the real parts of a deployment seated in its
// cages, its port lamps saying which links are up, and the status display set.
// Nothing is redrawn between the two sides: identical geometry, identical
// aspect. What the slider reveals is the addressability, which is the only
// difference there is.
//
// The link data here is illustrative. It is shaped like a real deployment and
// is not one - no hostname from anybody's network appears on this page.
import {applyFaceOverrides} from '../vendor/swap.js';
import {jdist} from '../vendor/dist.js';
import {cablePoints} from '../vendor/relief.js';
import {COLORS, WIDTH, sag2d, plugAt} from './showcase/cables.js';

const SVG = 'assets/dist/s9600-72xc.front.svg';
const PNG = 'assets/exports/netbox/elevation-images/UfiSpace/'
          + 'ufispace-s9600-72xc.front.png';

// A seven-segment digit names the segments it lights, so setting one is a
// matter of saying which. The drawing's own face is `0`.
const SEGMENTS = {
  0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd',
  6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcfgd',
};

// ONE TABLE, because a port has one set of facts about it - and both panels,
// 2D and 3D, read it.
//
// THE BADGES ARE GONE. The ports used to carry a colored box and an optic
// name in it (`SR`, `LR4`, `4x25`); now each row names the REAL PART it
// seats, and the drawing shows that part in the cage. `seat` is keyed as the
// kit keys a swap: the cage (`port-4`) takes the optic or cable end, and an
// optic's own LC cages (`port-4-occupant/tx`, `/rx`) take its plugs. A cable
// end is its own connector and takes none. check-contract.py proves every ref
// is a component the cage (or the optic's bore) accepts.
//
// `state` is up, carrying an overlay service, or wanting a look; `speed`,
// `label` (the link type) and `note` are caption text only, never drawn on
// the device. `jacket` is the cable's color class: `mm` multimode or AOC,
// `sm` single-mode, `dac` twinax, `cu` copper.
//
// THE TWO SR4 LINKS ARE AOCs. A real 100G SR4 is an MPO-connector optic, and
// the library has no MPO QSFP optic to seat (spec §3). So `port-64` and
// `port-70` are 100G active optical cables, which the library does have, and
// every link in this table is a part that exists.
//
// There is no floating callout: the caption line under the frame says what a
// link is.
//
// Each row keeps `seat: {...}` before `jacket: '...'` and holds no other
// braces - check-contract.py reads the table by that shape.
export const PORTS = {
  'oob':      {state: 'up',        label: '1G',   speed: '1G',
               note: 'management · to oob-sw · gi1/0/24',
               seat: {'oob': 'generic/rj45-plug@1'},
               jacket: 'cu'},
  'port-4':   {state: 'up',        label: 'SR',   speed: '25G',
               note: 'to spine-a · et-0/0/12',
               seat: {'port-4': 'generic/sfp-lc@1',
                      'port-4-occupant/tx': 'generic/lc-plug@2',
                      'port-4-occupant/rx': 'generic/lc-plug@2'},
               jacket: 'mm'},
  'port-5':   {state: 'up',        label: 'SR',   speed: '25G',
               note: 'to spine-a · et-0/0/13',
               seat: {'port-5': 'generic/sfp-lc@1',
                      'port-5-occupant/tx': 'generic/lc-plug@2',
                      'port-5-occupant/rx': 'generic/lc-plug@2'},
               jacket: 'mm'},
  'port-6':   {state: 'up',        label: 'SR',   speed: '25G',
               note: 'to spine-b · et-0/0/12',
               seat: {'port-6': 'generic/sfp-lc@1',
                      'port-6-occupant/tx': 'generic/lc-plug@2',
                      'port-6-occupant/rx': 'generic/lc-plug@2'},
               jacket: 'mm'},
  'port-7':   {state: 'up',        label: 'SR',   speed: '25G',
               note: 'to spine-b · et-0/0/13',
               seat: {'port-7': 'generic/sfp-lc@1',
                      'port-7-occupant/tx': 'generic/lc-plug@2',
                      'port-7-occupant/rx': 'generic/lc-plug@2'},
               jacket: 'mm'},
  'port-12':  {state: 'up',        label: 'DAC',  speed: '25G',
               note: 'to leaf-c · swp7',
               seat: {'port-12': 'generic/sfp-cable@1'},
               jacket: 'dac'},
  'port-13':  {state: 'attention', label: 'DAC',  speed: '25G',
               note: 'to leaf-c · swp8 · CRC errors rising',
               seat: {'port-13': 'generic/sfp-cable@1'},
               jacket: 'dac'},
  'port-14':  {state: 'up',        label: 'DAC',  speed: '25G',
               note: 'to leaf-c · swp9',
               seat: {'port-14': 'generic/sfp-cable@1'},
               jacket: 'dac'},
  'port-15':  {state: 'up',        label: 'DAC',  speed: '25G',
               note: 'to leaf-c · swp10',
               seat: {'port-15': 'generic/sfp-cable@1'},
               jacket: 'dac'},
  'port-20':  {state: 'up',        label: 'SR',   speed: '25G',
               note: 'to storage-04 · enp1s0f0',
               seat: {'port-20': 'generic/sfp-lc@1',
                      'port-20-occupant/tx': 'generic/lc-plug@2',
                      'port-20-occupant/rx': 'generic/lc-plug@2'},
               jacket: 'mm'},
  'port-21':  {state: 'up',        label: 'SR',   speed: '25G',
               note: 'to storage-04 · enp1s0f1',
               seat: {'port-21': 'generic/sfp-lc@1',
                      'port-21-occupant/tx': 'generic/lc-plug@2',
                      'port-21-occupant/rx': 'generic/lc-plug@2'},
               jacket: 'mm'},
  'port-28':  {state: 'up',        label: 'DAC',  speed: '10G',
               note: 'to backup-01 · eno1',
               seat: {'port-28': 'molex/sfp-plus-passive-dac@1'},
               jacket: 'dac'},
  'port-29':  {state: 'up',        label: 'DAC',  speed: '10G',
               note: 'to backup-02 · eno1',
               seat: {'port-29': 'molex/sfp-plus-passive-dac@1'},
               jacket: 'dac'},
  'port-36':  {state: 'up',        label: 'AOC',  speed: '25G',
               note: 'to hypervisor-11 · vmnic2',
               seat: {'port-36': 'generic/sfp-cable@1'},
               jacket: 'mm'},
  'port-37':  {state: 'up',        label: 'AOC',  speed: '25G',
               note: 'to hypervisor-11 · vmnic3',
               seat: {'port-37': 'generic/sfp-cable@1'},
               jacket: 'mm'},
  'port-44':  {state: 'attention', label: 'LR',   speed: '25G',
               note: 'to hypervisor-12 · vmnic2 · CRC errors rising',
               seat: {'port-44': 'generic/sfp-lc@1',
                      'port-44-occupant/tx': 'generic/lc-plug@2',
                      'port-44-occupant/rx': 'generic/lc-plug@2'},
               jacket: 'sm'},
  'port-45':  {state: 'up',        label: 'LR',   speed: '25G',
               note: 'to hypervisor-12 · vmnic3',
               seat: {'port-45': 'generic/sfp-lc@1',
                      'port-45-occupant/tx': 'generic/lc-plug@2',
                      'port-45-occupant/rx': 'generic/lc-plug@2'},
               jacket: 'sm'},
  'port-64':  {state: 'service',   label: 'AOC',  speed: '100G',
               note: 'vni 110100 · to border-1 · a 100G AOC',
               seat: {'port-64': 'fs/qsfp28-aoc@1'},
               jacket: 'mm'},
  'port-67':  {state: 'service',   label: 'LR4',  speed: '100G',
               note: 'vni 110100 · to border-2',
               seat: {'port-67': 'generic/qsfp-lc@2',
                      'port-67-occupant/tx': 'generic/lc-plug@2',
                      'port-67-occupant/rx': 'generic/lc-plug@2'},
               jacket: 'sm'},
  // Deliberately degraded: a 100G AOC is four lanes and only three are up, so
  // the lamps and the part disagree on purpose - three of its four lane lamps
  // lit, and the caption says why.
  'port-70':  {state: 'attention', label: 'AOC',  speed: '100G', lanesUp: 3,
               note: 'vni 110300 · to border-1 · a 100G AOC · lane 4 down',
               seat: {'port-70': 'siemon/qsfp28-aoc@1'},
               jacket: 'mm'},
  'port-71':  {state: 'service',   label: '4x25', speed: '4 x 25G',
               note: 'vni 110300 · to border-2 · broken out, all four up',
               seat: {'port-71': 'amphenol/qsfp28-passive-dac@1'},
               jacket: 'dac'},
};

// A CABLE'S COLOR COMES FROM cables.js, the showcase's one table, so the hero
// and the showcase cannot disagree about what a jacket looks like. This is a
// stopgap on cables.js's EXISTING colors: multimode borrows the OS2 yellow and
// twinax the management gray, because cables.js has no aqua or black yet.
// Task 1 of the hero plan replaces this with cables.js's `colorOfJacket` and
// restores aqua (`mm`) and black (`dac`).
export function jacketColor(j) {
  switch (j) {
    case 'sm': return COLORS.os2;
    case 'cu': return COLORS.copper.server;
    case 'mm': return COLORS.os2;
    case 'dac': return COLORS.copper.management;
    default: return COLORS.os2;
  }
}

// The port the caption names when nothing is hovered, focused or tapped, so
// the caption line is never empty.
export const DEFAULT_PORT = 'port-67';

// One line of caption per link: `port-67 · 100G LR4 · vni 110100 · to border-2`.
export const captionOf = port => {
  const p = PORTS[port];
  return p ? `${port} · ${p.speed} ${p.label} · ${p.note}` : '';
};

// LAMPS ARE SET BY STATE, NOT BY COLOR.
// This faceplate declares what each lamp can be - `off ok fail` on the PSUs,
// `off locked frequency-locked acquiring fail` on the sync lamp, `off link`
// and `off activity` on the management jack, and plain `off on` on every port
// lamp - so the code names the state and the table decides what that looks
// like. Writing `#48d08a` at each call site would be asserting a color the
// drawing never agreed to.
//
// OFF AND ON IS ALL A PORT LAMP CAN SAY (spec §4, amendment F1). There is no
// amber on a port: a link that wants a look still lights `on`, because the
// link is up, and the rising CRC errors are the caption's to say.
//
// Note what this switch does NOT have: any speed-coded port lamp. The QSFP28
// ports carry four on/off lamps apiece, one per lane, which is how you read a
// breakout by eye - four lit is a whole 100G, two lit is two lanes of a split.
const LAMP = {
  'off': null,
  'on': '#48d08a',
  'ok': '#48d08a',
  'link': '#48d08a',
  'activity': '#e0a94a',
  'locked': '#48d08a',
  'frequency-locked': '#8fd3ff',
  'acquiring': '#e0a94a',
  'fail': '#e0574f',
  'boot-failed': '#e0574f',
};

// The chassis lamps of a switch that is up and happy, in that lamp's own
// vocabulary rather than a color each.
const CHASSIS = {
  'led-sys': 'ok', 'led-fan': 'ok', 'led-ps0': 'ok', 'led-ps1': 'ok',
  'led-sync': 'locked',
};

// HOW MANY LANES A LINK USES. The lamp count is not a free choice - it
// follows from what is plugged in. A 100G LR4 or AOC is one link carried on
// four lanes, so four lamps; a 4x25 breakout is four links on the same four
// lanes, so also four. Anything in a single-lane cage uses one - an AOC in an
// SFP28 cage is a 25G AOC, one lane - and its one arrow lamp shows it.
//
// A port whose lit lamps disagree with this is degraded, and the caption
// says so rather than leaving the arithmetic to the viewer.
const OPTIC_LANES = {
  'LR4': 4, '4x25': 4,
  'SR': 1, 'LR': 1, 'DAC': 1, '1G': 1,
  'AOC': {quad: 4, single: 1},
};

function lanesFor(spec, quad = false) {
  let all = OPTIC_LANES[spec.label] ?? 0;
  if (typeof all === 'object') all = quad ? all.quad : all.single;
  return {all, up: spec.lanesUp == null ? all : spec.lanesUp};
}

const el = (t, cls, html) => {
  const e = document.createElement(t);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};

// SEAT EVERY ROW'S REAL PART, the way the showcase seats a face: the kit's
// face-level pass (`applyFaceOverrides`) against the device's own front cages
// and bays from its configs.json, with skins loaded off the component index.
// `svg` must already be IN the document - the kit reads CTMs to place what it
// seats. Marks the SVG `data-hero-seated` with how many seats landed, and
// `data-hero-refused` with any key the kit refused or could not load.
export async function seatHero(svg) {
  const idx = await jdist('assets/dist/s9600-72xc.configs.json');
  const comps = (await jdist('assets/dist/components.json')).components;
  const byRef = ref => comps.find(c => `${c.ns}/${c.name}@${c.major.slice(1)}` === ref.split(':')[0]);
  const loadSkin = async ref => {
    const c = byRef(ref);
    if (!c) return null;
    const skin = c.skins?.includes('default') ? 'default' : c.skins?.[0];
    const r = await fetch(`assets/dist/components/${c.ns}--${c.name}--${c.major}--${skin}.svg`);
    return r.ok ? {comp: c, text: await r.text()} : null;
  };
  const overrides = Object.assign({}, ...Object.values(PORTS).map(p => p.seat || {}));
  const res = await applyFaceOverrides(svg, {bays: idx.bays?.front || [], cages: idx.cages?.front || []},
                                       overrides, loadSkin, byRef);
  const missed = [...res.refused, ...res.failed];
  if (missed.length) svg.setAttribute('data-hero-refused', missed.join(' '));
  svg.setAttribute('data-hero-seated', String(res.applied));
  return res;
}

// PORT LAMPS SAY WHAT IS UP. Every port lamp on the face is set `off` first,
// so a lamp is never lit by accident; then each row lights its own - one lamp
// for a single-lane cage, `lanesFor` of the four for a QSFP28 quad (so the
// degraded `port-70` lights three). The management jack lights its link and
// activity pair in their own states.
function lightPorts(svg) {
  for (const lamp of svg.querySelectorAll('[data-path^="led-port-"][data-states]')) {
    setLamp(lamp, 'off');
  }
  for (const [port, spec] of Object.entries(PORTS)) {
    if (port === 'oob') {
      setLed(svg, 'oob', 'link', 'led-a');
      setLed(svg, 'oob', 'activity', 'led-b');
      continue;
    }
    const quad = !!svg.querySelector(`[id="led-${port}--lane-1"]`);
    const {up} = lanesFor(spec, quad);
    if (quad) {
      for (let i = 1; i <= 4; i++) {
        setLed(svg, `led-${port}`, i <= up ? 'on' : 'off', `lane-${i}`);
      }
    } else {
      setLed(svg, `led-${port}`, up > 0 ? 'on' : 'off');
    }
  }
}

// ── the cables ──────────────────────────────────────────────────────────────
// THE FRAME AROUND THE FACE. The face is 436 x 87.7 mm; the cables need room
// beside it to sweep out and fade, and below it to hang. Both sides of the
// slider get the same frame - the PNG as padding - so the split still lands on
// the same millimeter of the face on both.
export const FACE = {w: 436, h: 87.7};
export const SIDE = 44;          // mm beside the face, each side, for the fade
export const BELOW = 48;         // mm below the face, for the hang (the lowest tail runs out at ~130)
const JOIN = 6;                  // mm below an optic's two plugs where the strands join

const SVGNS = 'http://www.w3.org/2000/svg';
const node = (tag, attrs = {}) => {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
};
const r2 = v => Math.round(v * 100) / 100;

// A link's connector points in the SVG's user space, left to right: an
// optic's two LC plugs, or a cable end's one point (at the stub's far end), or
// the RJ45 plug's. Mapped through each marker's CTM, as cables.js's ends2d
// does - so the SVG must be in the document and laid out.
function pointsOf(svg, all, port) {
  const inv = svg.getScreenCTM().inverse();
  return all.filter(p => p.at && plugAt(p.path, port)).map(p => {
    const q = new DOMPoint(p.at[0], p.at[1]).matrixTransform(inv.multiply(p.el.getScreenCTM()));
    return [q.x, q.y];
  }).sort((a, b) => a[0] - b[0]);
}

// An optic's two strands meet JOIN below the lower plug, and the cable proper
// starts there. One point is the cable's own start. Returns [start, strands].
function join(pts) {
  if (pts.length < 2) return [pts[0], []];
  const x = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const m = [x, Math.max(...pts.map(p => p[1])) + JOIN];
  return [m, pts.map(p => `M${r2(p[0])} ${r2(p[1])} C${r2(p[0])} ${r2(p[1] + JOIN * 0.6)} `
                          + `${r2(m[0])} ${r2(m[1] - JOIN * 0.6)} ${r2(m[0])} ${r2(m[1])}`)];
}

// THE HANG. Down from the start with the showcase's sag, then a sweep to the
// nearer side and on past the frame's edge, where the fade takes it.
//
// sag2d SETS THE DROP: the first control point sits sag2d(run) * SAG_SCALE
// below the start, `run` being how far the cable goes across to its edge -
// so, as in the showcase's stage 4, a longer run hangs deeper. SAG_SCALE is
// 1: the showcase's own rule, unscaled, which is also the short drop of the
// approved v2 mockup ("fading at the sides").
//
// A CEILING, NEVER A FLOOR. Where that drop would carry the curve's lowest
// point below HANG_FLOOR - out of the frame - it is cut back just far enough
// to keep it in; no drop is ever raised. check-browser.py holds each cable to
// exactly this.
//
// NESTED: `rank` is the cable's place on its side, nearest the edge first.
// The nearer a cable starts to the edge, the higher its tail runs out, so a
// cable from further in loops outside it rather than across it.
export const SAG_SCALE = 1;
export const HANG_FLOOR = FACE.h + BELOW - 4;   // the lowest a curve's center may go
const TAIL_Y = 104, TAIL_STEP = 1.8;

// The lowest point of a cubic's y, sampled.
function lowest(y0, y1, y2, y3) {
  let m = -Infinity;
  for (let i = 0; i <= 64; i++) {
    const t = i / 64, u = 1 - t;
    m = Math.max(m, u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3);
  }
  return m;
}

function sweep(a, rank) {
  const left = a[0] < FACE.w / 2, ex = left ? -SIDE : FACE.w + SIDE;
  const ey = Math.min(TAIL_Y + rank * TAIL_STEP, HANG_FLOOR);
  let s = sag2d(Math.abs(ex - a[0])) * SAG_SCALE;
  if (lowest(a[1], a[1] + s, ey, ey) > HANG_FLOOR) {
    // The ceiling: the largest drop whose curve stays in the frame.
    let lo = 0, hi = s;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (lowest(a[1], a[1] + mid, ey, ey) > HANG_FLOOR) hi = mid; else lo = mid;
    }
    s = lo;
  }
  return `M${r2(a[0])} ${r2(a[1])} C${r2(a[0])} ${r2(a[1] + s)} `
       + `${r2(left ? ex + 60 : ex - 60)} ${r2(ey)} ${r2(ex)} ${r2(ey)}`;
}

// The side fade: opaque over the face's width, to nothing over the outer SIDE
// on each side. One mask over every cable.
function sideFade(svg) {
  const w = FACE.w + 2 * SIDE, h = FACE.h + BELOW;
  let defs = svg.querySelector(':scope > defs');
  if (!defs) { defs = node('defs'); svg.prepend(defs); }
  const grad = node('linearGradient', {id: 'hero-side-fade-ramp', gradientUnits: 'userSpaceOnUse',
                                       x1: -SIDE, y1: 0, x2: FACE.w + SIDE, y2: 0});
  for (const [o, a] of [[0, 0], [SIDE / w, 1], [(SIDE + FACE.w) / w, 1], [1, 0]]) {
    grad.append(node('stop', {offset: r2(o * 1e4) / 1e4, 'stop-color': '#fff', 'stop-opacity': a}));
  }
  const mask = node('mask', {id: 'hero-side-fade', maskUnits: 'userSpaceOnUse',
                             x: -SIDE, y: 0, width: w, height: h});
  mask.append(node('rect', {x: -SIDE, y: 0, width: w, height: h, fill: 'url(#hero-side-fade-ramp)'}));
  // Where a cable takes the pointer: the face's width only. A mask hides the
  // faded tails but does not stop them hit-testing, so each cable's hit path
  // is clipped to the face, where the fade has not begun.
  const hit = node('clipPath', {id: 'hero-cable-hit'});
  hit.append(node('rect', {x: 0, y: 0, width: FACE.w, height: h}));
  defs.append(grad, mask, hit);
}

// A strand is drawn and takes the pointer as drawn: it is all on the face.
// The main cable is drawn with pointer-events off, and takes the pointer
// through its own invisible hit path, clipped to the face (see sideFade).
function stroke(g, d, color, w, main = false) {
  const off = main ? {'pointer-events': 'none'} : {};
  g.append(node('path', {d, fill: 'none', stroke: '#000', 'stroke-opacity': 0.5,
                         'stroke-width': r2(w + 0.9), 'stroke-linecap': 'round', ...off}));
  const p = node('path', {d, fill: 'none', stroke: color, 'stroke-width': r2(w), 'stroke-linecap': 'round', ...off});
  if (main) p.setAttribute('data-main', '');
  g.append(p);
  if (main) {
    g.append(node('path', {d, fill: 'none', stroke: 'transparent', 'stroke-width': r2(w + 1.2),
                           'pointer-events': 'stroke', 'clip-path': 'url(#hero-cable-hit)', 'data-hit': ''}));
  }
}

// ONE CABLE PER LINK, hung from its seated part. Painted lowest-top first -
// a group's `data-top` is its highest connector - so a cable from a higher
// port hangs in front of the ones below it, as in the showcase. Returns the
// layer, or null when no connector could be read.
export function drawHeroCables(svg) {
  const all = cablePoints(svg);
  const layer = node('g', {'data-hero-cables': '', mask: 'url(#hero-side-fade)'});
  const drawn = [];
  const found = Object.entries(PORTS).map(([port, row]) => {
    const pts = pointsOf(svg, all, port);
    if (!pts.length) console.warn(`hero: no cable point for ${port}`);
    return {port, row, pts, start: pts.length ? join(pts)[0] : null};
  }).filter(f => f.start);
  // Each side's cables, nearest their edge first; between two at the same
  // distance, the higher one first, since it hangs in front.
  const edgeDist = f => (f.start[0] < FACE.w / 2 ? f.start[0] : FACE.w - f.start[0]);
  const rank = new Map();
  for (const left of [true, false]) {
    found.filter(f => (f.start[0] < FACE.w / 2) === left)
      .sort((a, b) => edgeDist(a) - edgeDist(b) || a.start[1] - b.start[1])
      .forEach((f, k) => rank.set(f.port, k));
  }
  found.forEach(({port, row, pts}) => {
    const g = node('g', {'data-hero-cable': port, 'data-jacket': row.jacket, tabindex: 0,
                         id: `hero-cable-${port}`, role: 'button', 'aria-label': captionOf(port)});
    const t = node('title'); t.textContent = captionOf(port); g.append(t);
    const color = jacketColor(row.jacket);
    const [start, strands] = join(pts);
    for (const d of strands) stroke(g, d, color, WIDTH * 0.4);
    stroke(g, sweep(start, rank.get(port)), color, WIDTH * 0.6, true);
    const top = Math.min(...pts.map(p => p[1]));
    g.setAttribute('data-top', r2(top));
    drawn.push({g, top});
  });
  if (!drawn.length) return null;
  sideFade(svg);
  drawn.sort((a, b) => b.top - a.top);
  for (const {g} of drawn) layer.append(g);
  // The hovered cable, drawn once more over all of them: a <use> of it, so
  // the group itself never moves in the DOM (moving a focused node blurs it).
  layer.append(node('use', {'data-hero-front': '', 'pointer-events': 'none', visibility: 'hidden'}));
  svg.append(layer);
  return layer;
}

// Presses the stage has taken as a grab of the divider's grip or bar. They
// still propagate - the document's listener must see them, to let a pinned
// cable go - but a cable under the grip does not treat one as a tap on it.
const GRABS = new WeakSet();

// HOVER, FOCUS AND TAP name a cable in the caption line, light it and dim the
// rest. Nothing named: the default port. A tap pins a cable until a tap
// lands anywhere else. The pointer on a cable never moves the divider - the
// stage's drag starts only off a cable (see heroReveal).
function wireCaption(layer, caption) {
  const front = layer.querySelector('[data-hero-front]');
  let pinned = null, shown;       // undefined, so the first show(null) writes the default
  const show = g => {
    if (shown === g) return;
    if (shown) shown.classList.remove('cable-on');
    shown = g;
    if (g) {
      g.classList.add('cable-on');
      layer.classList.add('cables-focus');
      front.setAttribute('href', `#${g.id}`);
      front.setAttribute('visibility', 'visible');
    } else {
      layer.classList.remove('cables-focus');
      front.removeAttribute('href');
      front.setAttribute('visibility', 'hidden');
    }
    if (caption) caption.textContent = captionOf(g ? g.dataset.heroCable : DEFAULT_PORT);
  };
  // Back to what is pinned, else to what has the keyboard, else the default.
  const rest = () => show(pinned || document.activeElement?.closest?.('#hero-reveal [data-hero-cable]') || null);
  for (const g of layer.querySelectorAll('[data-hero-cable]')) {
    g.addEventListener('pointerenter', ev => { if (ev.pointerType !== 'touch' && !ev.buttons) show(g); });
    g.addEventListener('pointerleave', ev => { if (ev.pointerType !== 'touch') rest(); });
    g.addEventListener('focus', () => show(g));
    g.addEventListener('blur', rest);
    g.addEventListener('pointerdown', ev => {
      if (GRABS.has(ev)) return;           // the divider's grip, over this cable
      if (ev.pointerType === 'touch' || ev.pointerType === 'pen') { pinned = g; show(g); }
    });
  }
  // A tap anywhere off a cable lets the pinned one go.
  document.addEventListener('pointerdown', ev => {
    if (!pinned || (!GRABS.has(ev) && ev.target.closest?.('[data-hero-cable]'))) return;
    pinned = null;
    rest();
  });
  show(null);
}

export async function heroReveal(host) {
  const r = await fetch(SVG);
  if (!r.ok) return;                       // the hero still reads without it
  const doc = new DOMParser().parseFromString(await r.text(), 'image/svg+xml');
  if (doc.querySelector('parsererror')) return;
  const svg = doc.documentElement;
  svg.removeAttribute('width');
  svg.removeAttribute('height');
  // The frame: SIDE beside the face and BELOW under it, for the cables.
  svg.setAttribute('viewBox', `${-SIDE} 0 ${FACE.w + 2 * SIDE} ${FACE.h + BELOW}`);
  svg.setAttribute('overflow', 'hidden');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  const stage = el('div', 'reveal-stage');
  const media = el('div', 'reveal-media');
  const img = el('img', 'reveal-png');
  img.src = PNG;
  img.alt = 'UfiSpace S9600-72XC front panel, as a flat image';
  img.loading = 'lazy';
  img.decoding = 'async';
  media.append(img);

  const rich = el('div', 'reveal-rich');
  const richMedia = el('div', 'reveal-media');
  richMedia.append(svg);
  rich.append(richMedia);

  // The drawing lives in its own frame so the overlay is laid out against
  // the drawing and not against the stage's padding, which holds the tags.
  const frame = el('div', 'reveal-frame');
  frame.append(media, rich);
  stage.append(frame);
  host.append(stage);

  // ── the addressable half ──────────────────────────────────────────────────
  // LAMPS. A seated part says we know what is in the hole; a lit lamp says
  // the device agrees. All 72 ports carry one as of ndv#79: the 64 SFP28
  // lamps are `common/led-arrow-sm`, an up triangle for the top port of a
  // pair and a down triangle for the bottom, and the QSFP28 quads take a lane
  // at a time. Set before the parts are seated, which touches no lamp.
  for (const [id, state] of Object.entries(CHASSIS)) setLed(svg, id, state);
  lightPorts(svg);
  setDigits(svg, '02');

  // THE REAL PARTS. Seated only now the SVG is in the page, because the kit
  // measures. A failure leaves the lamps and the slider working.
  try {
    const res = await seatHero(svg);
    if (res.refused.length || res.failed.length) {
      console.warn('hero: not seated', {refused: res.refused, failed: res.failed});
    }
  } catch (err) {
    console.error('hero: seating failed', err);
  }

  // THE CABLES, from the parts just seated, and the caption line that names
  // them. A failure leaves the parts, the lamps and the slider working.
  try {
    const layer = drawHeroCables(svg);
    if (layer) wireCaption(layer, document.getElementById('hero-caption-2d'));
  } catch (err) {
    console.error('hero: cables failed', err);
  }

  // ── the divider ───────────────────────────────────────────────────────────
  const range = el('input', 'reveal-range');
  range.type = 'range'; range.min = '0'; range.max = '100'; range.value = '50';
  range.setAttribute('aria-label',
    'Reveal the addressable drawing over the flat image');
  const handle = el('div', 'reveal-handle',
    '<span class="reveal-grip" aria-hidden="true"></span>');
  const tags = el('div', 'reveal-tags',
    '<span class="reveal-tag left">a picture</span>'
    + '<span class="reveal-tag right">addressable</span>');
  frame.append(handle, range);
  stage.append(tags);

  const split = v => {
    stage.style.setProperty('--split', `${v}%`);
    range.value = String(v);
  };
  range.addEventListener('input', () => split(+range.value));
  let dragging = false;
  const at = ev => {
    const box = stage.getBoundingClientRect();
    const x = ('touches' in ev ? ev.touches[0].clientX : ev.clientX) - box.left;
    split(Math.max(0, Math.min(100, (x / box.width) * 100)));
  };
  // THE HANDLE ALWAYS DRAGS. It is pointer-events: none (so it never hides
  // the drawing from a hover), which means a press on it lands on whatever is
  // under it - often a cable. So the stage decides first, in the capture
  // phase: a press on the grip, or on the bar itself, starts the drag
  // whatever is under it, and is marked in GRABS - so a cable under the grip
  // does not pin itself, while the document's listener still sees the press
  // and lets any pinned cable go, as it does for any press off a cable. Anywhere else, a press on a cable
  // is asking about the cable (hero cables' own pointerdown), and a press off
  // one moves the divider there, as always.
  const grip = handle.querySelector('.reveal-grip');
  const onHandle = ev => {
    const g = grip.getBoundingClientRect(), h = handle.getBoundingClientRect();
    const gx = g.x + g.width / 2, gy = g.y + g.height / 2;
    return Math.hypot(ev.clientX - gx, ev.clientY - gy) <= g.width / 2 + 4
        || (Math.abs(ev.clientX - (h.x + h.width / 2)) <= h.width / 2 + 3
            && ev.clientY >= h.top && ev.clientY <= h.bottom);
  };
  stage.addEventListener('pointerdown', ev => {
    const grab = onHandle(ev);
    if (!grab && ev.target.closest?.('[data-hero-cable]')) return;
    if (grab) GRABS.add(ev);
    dragging = true; at(ev);
    // Stops the drag becoming a text selection across the silkscreen.
    ev.preventDefault();
  }, {capture: true});
  stage.addEventListener('dragstart', ev => ev.preventDefault());
  stage.addEventListener('selectstart', ev => {
    if (dragging) ev.preventDefault();
  });
  addEventListener('pointermove', ev => { if (dragging) at(ev); });
  addEventListener('pointerup', () => { dragging = false; });
  split(50);
}

// A lamp is `off` until something sets its color, and the drawing exposes
// that as a custom property rather than a fill - so lighting one touches no
// artwork. `part` picks a lamp within a multi-lamp element, which is how the
// QSFP28 quads address their four lanes separately.
function setLed(svg, id, state, part) {
  const sel = part ? `[id="${id}--${part}"]` : `[id="${id}--lamp"]`;
  const lamp = svg.querySelector(sel);
  if (lamp) setLamp(lamp, state);
}

// ONLY A STATE THE LAMP DECLARES. `data-states` is the face's own list of what
// the lamp can be; a state outside it is refused rather than painted, so the
// code cannot light a port lamp amber the drawing never offered. The state set
// is recorded as `data-state`, which is what a check (or a caption) reads.
function setLamp(lamp, state) {
  const declared = (lamp.getAttribute('data-states') || '').split(/\s+/);
  if (!declared.includes(state)) return;
  const color = LAMP[state];
  if (color) lamp.style.setProperty('--led-color', color);
  else lamp.style.removeProperty('--led-color');
  lamp.setAttribute('data-state', state);
}

function setDigits(svg, text) {
  ['digit-1', 'digit-2'].forEach((id, i) => {
    const g = svg.querySelector(`[id="status-display--${id}"]`);
    if (!g) return;
    const on = SEGMENTS[text[i]] || '';
    g.querySelectorAll('[data-seg]').forEach(s =>
      s.setAttribute('opacity', on.includes(s.dataset.seg) ? '1' : '0'));
  });
}
