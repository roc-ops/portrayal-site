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
import {COLORS} from './showcase/cables.js';

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

// The port the caption names when nothing is hovered (Task 3).
export const DEFAULT_PORT = 'port-67';

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

export async function heroReveal(host) {
  const r = await fetch(SVG);
  if (!r.ok) return;                       // the hero still reads without it
  const doc = new DOMParser().parseFromString(await r.text(), 'image/svg+xml');
  if (doc.querySelector('parsererror')) return;
  const svg = doc.documentElement;
  svg.removeAttribute('width');
  svg.removeAttribute('height');
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
  stage.addEventListener('pointerdown', ev => {
    dragging = true; at(ev);
    // Stops the drag becoming a text selection across the silkscreen.
    ev.preventDefault();
  });
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
