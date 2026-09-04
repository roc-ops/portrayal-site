// The tagline, demonstrated instead of claimed.
//
// Left of the divider is `ufispace-s9600-72xc.front.png` - the raster we ship
// to a DCIM, and a picture in the ordinary sense. Right of it is the compiled
// SVG of the SAME drawing, with ports coloured, the status display set, and a
// callout you can move with the pointer. Nothing is redrawn between the two
// sides: identical geometry, identical aspect. What the slider reveals is the
// addressability, which is the only difference there is.
//
// The link data here is illustrative. It is shaped like a real deployment and
// is not one - no hostname from anybody's network appears on this page.
const SVG = 'assets/dist/s9600-72xc.front.svg';
const PNG = 'assets/exports/netbox/elevation-images/UfiSpace/'
          + 'ufispace-s9600-72xc.front.png';

// A seven-segment digit names the segments it lights, so setting one is a
// matter of saying which. The drawing's own face is `0`.
const SEGMENTS = {
  0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd',
  6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcfgd',
};

// ONE TABLE, because a port has one set of facts about it.
//
// `state` is the colour: up, carrying an overlay service, or wanting a look.
// `label` is what goes IN the box, and it is the OPTIC rather than the speed.
// A cage already tells you its ceiling - an SFP28 hole is at most 25G - but
// nothing on the front of the device says whether there is an SR, an LR or a
// twinax DAC in it. That is the fact a photograph structurally cannot carry,
// which makes it the one worth the four characters. Speed goes in the callout,
// where there is room for the rest of it.
//
// A broken-out QSFP is the exception: `4x25` says both that it is split and
// what to, which beats `BKT` in the same width.
const PORTS = {
  'oob':      {state: 'up',        label: '1G',   speed: '1G',
               note: 'management · to oob-sw · gi1/0/24'},
  'port-4':   {state: 'up',        label: 'SR',   speed: '25G',
               note: 'to spine-a · et-0/0/12'},
  'port-5':   {state: 'up',        label: 'SR',   speed: '25G',
               note: 'to spine-a · et-0/0/13'},
  'port-6':   {state: 'up',        label: 'SR',   speed: '25G',
               note: 'to spine-b · et-0/0/12'},
  'port-7':   {state: 'up',        label: 'SR',   speed: '25G',
               note: 'to spine-b · et-0/0/13'},
  'port-12':  {state: 'up',        label: 'DAC',  speed: '25G',
               note: 'to leaf-c · swp7'},
  'port-13':  {state: 'attention', label: 'DAC',  speed: '25G',
               note: 'to leaf-c · swp8 · CRC errors rising'},
  'port-14':  {state: 'up',        label: 'DAC',  speed: '25G',
               note: 'to leaf-c · swp9'},
  'port-15':  {state: 'up',        label: 'DAC',  speed: '25G',
               note: 'to leaf-c · swp10'},
  'port-20':  {state: 'up',        label: 'SR',   speed: '25G',
               note: 'to storage-04 · enp1s0f0'},
  'port-21':  {state: 'up',        label: 'SR',   speed: '25G',
               note: 'to storage-04 · enp1s0f1'},
  'port-28':  {state: 'up',        label: 'DAC',  speed: '10G',
               note: 'to backup-01 · eno1'},
  'port-29':  {state: 'up',        label: 'DAC',  speed: '10G',
               note: 'to backup-02 · eno1'},
  'port-36':  {state: 'up',        label: 'AOC',  speed: '25G',
               note: 'to hypervisor-11 · vmnic2'},
  'port-37':  {state: 'up',        label: 'AOC',  speed: '25G',
               note: 'to hypervisor-11 · vmnic3'},
  'port-44':  {state: 'attention', label: 'LR',   speed: '25G',
               note: 'to hypervisor-12 · vmnic2 · CRC errors rising'},
  'port-45':  {state: 'up',        label: 'LR',   speed: '25G',
               note: 'to hypervisor-12 · vmnic3'},
  'port-64':  {state: 'service',   label: 'SR4',  speed: '100G',
               note: 'vni 110100 · to border-1'},
  'port-67':  {state: 'service',   label: 'LR4',  speed: '100G',
               note: 'vni 110100 · to border-2'},
  // Deliberately degraded: an SR4 is four lanes and only three are up, so the
  // lamps and the optic disagree on purpose - and the colour says why.
  'port-70':  {state: 'attention', label: 'SR4',  speed: '100G', lanesUp: 3,
               note: 'vni 110300 · to border-1 · lane 4 down'},
  'port-71':  {state: 'service',   label: '4x25', speed: '4 x 25G',
               note: 'vni 110300 · to border-2 · broken out, all four up'},
};


const DEFAULT_PORT = 'port-67';
// LAMPS ARE SET BY STATE, NOT BY COLOUR.
// This faceplate declares what each lamp can be - `off ok fail` on the PSUs,
// `off locked frequency-locked acquiring fail` on the sync lamp, plain
// `off on` per lane on the QSFP28 quads - so the code names the state and the
// table decides what that looks like. Writing `#48d08a` at each call site
// would be asserting a colour the drawing never agreed to.
//
// Note what this switch does NOT have: any speed-coded port lamp. The QSFP28
// ports carry four on/off lamps apiece, one per lane, which is how you read a
// breakout by eye - four lit is a whole 100G, two lit is two lanes of a split.
const LAMP = {
  'off': null,
  'on': '#48d08a',
  'ok': '#48d08a',
  'locked': '#48d08a',
  'frequency-locked': '#8fd3ff',
  'acquiring': '#e0a94a',
  'fail': '#e0574f',
  'boot-failed': '#e0574f',
};

// The chassis lamps of a switch that is up and happy, in that lamp's own
// vocabulary rather than a colour each.
const CHASSIS = {
  'led-sys': 'ok', 'led-fan': 'ok', 'led-ps0': 'ok', 'led-ps1': 'ok',
  'led-sync': 'locked',
};

// HOW MANY LANES AN OPTIC USES. The lamp count is not a free choice - it
// follows from what is plugged in. A 100G SR4 or LR4 is one link carried on
// four lanes, so four lamps; a 4x25 breakout is four links on the same four
// lanes, so also four. Anything in a single-lane cage uses one, though the
// SFP28 ports have no lamps to show it with.
//
// A port whose lit lamps disagree with this is degraded, and says so in brass
// rather than leaving the arithmetic to the viewer.
const OPTIC_LANES = {
  'SR4': 4, 'LR4': 4, '4x25': 4,
  'SR': 1, 'LR': 1, 'ER': 1, 'DAC': 1, 'AOC': 1, '1G': 1,
};

function lanesFor(spec) {
  const all = OPTIC_LANES[spec.label] || 0;
  return {all, up: spec.lanesUp == null ? all : spec.lanesUp};
}

const el = (t, cls, html) => {
  const e = document.createElement(t);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};

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

  // The drawing lives in its own frame so the stage can keep a well above it
  // and below it. An absolutely positioned child is laid out against the
  // padding box, so with padding on the stage the overlay would sit above the
  // image rather than on it - the frame is what keeps them registered.
  const frame = el('div', 'reveal-frame');
  frame.append(media, rich);
  stage.append(frame);
  host.append(stage);

  // ── the addressable half ──────────────────────────────────────────────────
  const NS = 'http://www.w3.org/2000/svg';
  for (const [n, spec] of Object.entries(PORTS)) {
    const g = svg.querySelector(`[id="${n}"][data-class="port"]`);
    if (!g) continue;
    const b = g.getBBox();
    const mark = doc.createElementNS(NS, 'rect');
    mark.setAttribute('x', b.x); mark.setAttribute('y', b.y);
    mark.setAttribute('width', b.width); mark.setAttribute('height', b.height);
    mark.setAttribute('rx', '0.6');
    mark.setAttribute('class', `pt-mark pt-${spec.state}`);
    mark.dataset.port = n;
    g.append(mark);

    // The label sits INSIDE the mark, in the drawing's own millimetres so it
    // scales with everything else. Stroked before it is filled - the map
    // trick - so one treatment holds up over a green wash, a violet one and
    // the dark metal between them.
    if (!spec.label) continue;
    const t = doc.createElementNS(NS, 'text');
    t.setAttribute('x', b.x + b.width / 2);
    t.setAttribute('y', b.y + b.height / 2);
    t.setAttribute('class', 'pt-label');
    t.setAttribute('font-size', spec.label.length > 3 ? '3.5' : '4.2');
    t.textContent = spec.label;
    g.append(t);


    // THE BOTTOM ROW IS UPSIDE DOWN, AND SO IS ITS TEXT.
    // A real switch inverts its lower cages, and the drawing is faithful to
    // that - those port groups carry `rotate(180 ...)`. A label dropped into
    // one inherits the rotation and reads back to front. The rectangle does
    // not care; the text does, so it is turned back about its own centre.
    const m = t.getCTM();
    if (m && (m.a < 0 || m.d < 0)) {
      t.setAttribute('transform',
        `rotate(180 ${b.x + b.width / 2} ${b.y + b.height / 2})`);
    }
  }

  // LAMPS. A lit cage says we know what is in the hole; a lit lamp says the
  // device agrees.
  //
  // All 72 ports carry one as of ndv#79. The 64 SFP28 lamps were there on the
  // face the whole time, drawn as `▲▼` silkscreen in the yellow port band -
  // ink where a lamp belongs - and are now `common/led-arrow-sm`, an up
  // triangle for the top port of a pair and a down triangle for the bottom.
  // Two shapes of lamp, one way of addressing them: the QSFP28 quads take a
  // lane at a time, everything else takes the whole lamp.
  for (const [id, state] of Object.entries(CHASSIS)) setLed(svg, id, state);
  setLed(svg, 'led-oob-l', 'on');
  setLed(svg, 'led-oob-r', 'on');
  for (const [port, spec] of Object.entries(PORTS)) {
    if (port === 'oob') continue;           // its pair is set above
    const {all, up} = lanesFor(spec);
    const quad = svg.querySelector(`[id="led-${port}--lane-1"]`);
    if (quad) {
      for (let i = 1; i <= 4; i++) {
        setLed(svg, `led-${port}`, i <= up ? 'on' : 'off', `lane-${i}`);
      }
    } else {
      // A single-lane cage: one lamp, and `off on` is all it can say. A port
      // that is up but erroring still lights - the link is up, and the cage
      // colour is what carries the complaint.
      setLed(svg, `led-${port}`, up > 0 ? 'on' : 'off');
    }
    void all;
  }

  setDigits(svg, '02');

  // ── the callout ───────────────────────────────────────────────────────────
  // THE ROWS COME FROM THE DRAWING, NOT FROM ARITHMETIC.
  // Two earlier tries were wrong in different ways. Quartering the panel's
  // height put the top row's centre in the second quarter, because there is a
  // bezel above it and the rows are not evenly spread. Reading `getBBox()`
  // gave every port nearly the same number, because that box is local to the
  // port's own group - each one carries its own translate, so they all sit at
  // roughly the same place inside themselves.
  //
  // Measured space is the one coordinate system that answers "where is this on
  // the panel", so the rows are the distinct heights the ports are found at,
  // sorted and numbered. Banded to a quarter of the row pitch so a stray
  // sub-pixel does not invent a fifth row.
  const rowY = new Map();
  for (const n of Object.keys(PORTS)) {
    const g = svg.querySelector(`[id="${n}"][data-class="port"]`);
    if (!g) continue;
    const b = g.getBoundingClientRect();
    rowY.set(n, b.top + b.height / 2 - richMedia.getBoundingClientRect().top);
  }
  const BAND = 8;
  const band = y => Math.round(y / BAND);
  const seen = new Map();
  for (const y of rowY.values()) seen.set(band(y), (seen.get(band(y)) || 0) + 1);
  // A ROW IS A ROW OF PORTS, not any height a port happens to sit at. The
  // management RJ45 is alone in the mgmt cluster and lands between the two
  // lower rows; counting it as a row of its own broke the left/right
  // alternation, putting the two rows either side of it on the same side.
  // Bands holding a single port are folded into the nearest real row.
  const rows = [...seen.entries()].filter(([, n]) => n > 1)
    .map(([b]) => b).sort((a, b) => a - b);
  const rowOf = n => {
    const b = band(rowY.get(n) ?? 0);
    let best = 0;
    for (let i = 1; i < rows.length; i++) {
      if (Math.abs(rows[i] - b) < Math.abs(rows[best] - b)) best = i;
    }
    return best;
  };

  const call = el('div', 'reveal-call');
  stage.append(call);
  // Where the divider currently is. Held here rather than read back off the
  // range input, because the first callout is placed before that input exists.
  let splitPct = 50;
  // Positioned from SCREEN coordinates, not from viewBox arithmetic.
  // `getCTM()` on an element inside a viewBox'd SVG already includes the
  // viewBox-to-viewport scale, so its output is CSS pixels; dividing that by
  // the viewBox width put the card a screen and a half to the right.
  const place = n => {
    const g = svg.querySelector(`[id="${n}"][data-class="port"]`);
    const spec = PORTS[n];
    // A missing `note` is no reason to refuse: every lit port has a state, an
    // optic and a speed worth showing. Bailing out on it meant hover worked on
    // some ports and silently did nothing on others, which reads as the whole
    // feature being broken rather than one field being blank.
    if (!g || !spec) return;
    const b = g.getBoundingClientRect();
    const box = richMedia.getBoundingClientRect();
    const st = stage.getBoundingClientRect();
    if (!box.width) return;
    const cx = b.left + b.width / 2 - box.left;
    const cy = b.top + b.height / 2 - box.top;
    const atPct = (cx / box.width) * 100;
    call.dataset.at = String(atPct);
    call.style.left = `${atPct}%`;

    // THE CALLOUT MOVES WHEN THE PORT DOES.
    // Every port sending its card to the same spot meant stepping along a row
    // changed only the text, and a change of text alone does not read as a
    // response - you had to go and check the card to see anything had
    // happened. So the card takes its side from the port: ports in the top
    // half of the faceplate throw upward, the bottom half downward, and the
    // two rows within each half offset to opposite sides. Neighbours never
    // land in the same place.
    // WHICH HALF IS GEOMETRY; WHICH ROW IS FOR TELLING NEIGHBOURS APART.
    // Deriving the half from the row index went wrong because the management
    // RJ45 sits at its own height and counts as a row of one - five bands, so
    // index 2 of 5 read as the top half when it is plainly in the bottom. The
    // panel's midpoint does not care how many rows there are.
    const above = cy < box.height / 2;
    const side = rowOf(n) % 2 === 0 ? -1 : 1;
    call.classList.toggle('is-above', above);
    // PIXELS, NOT PER CENT. The callout is positioned against the stage, and
    // the stage is taller than the drawing by the whole well beneath it - so a
    // percentage of the media resolved against a bigger box and pushed every
    // card down by a different amount depending on which row its port was in.
    // Three cards that share one baseline were landing at three heights.
    // Measured against the frame, written against the stage - the two differ
    // by the well above the drawing.
    call.style.top = `${cy + (box.top - st.top)}px`;
    // The leader spans from the port to whichever edge of the drawing the card
    // is going to, so it never lies across the ports it is describing.
    call.style.setProperty('--pin',
      `${Math.max(12, (above ? cy : box.height - cy) + 10)}px`);
    call.innerHTML =
      (above ? '' : '<span class="reveal-pin"></span>')
      + `<span class="reveal-card"><b>${n}</b>`
      + `<span class="reveal-speed">${spec.speed}</span>`
      // Only when it adds something: the management port's optic and its speed
      // are both "1G", and printing it twice reads like a rendering fault.
      + (spec.label && spec.label !== spec.speed
          ? `<span class="reveal-optic">${spec.label}</span>` : '')
      + (spec.note ? `<br>${spec.note}` : '') + '</span>'
      + (above ? '<span class="reveal-pin"></span>' : '');
    svg.querySelectorAll('.pt-mark.is-on').forEach(x =>
      x.classList.remove('is-on'));
    const mk = svg.querySelector(`.pt-mark[data-port="${n}"]`);
    if (mk) mk.classList.add('is-on');
    call.dataset.port = n;

    // KEPT INSIDE THE FRAME. The card is centred on its port, so a port near
    // either end hangs half of it off the page - which is exactly where the
    // management port is. The leader still lands on the port; only the card
    // slides back into view.
    call.hidden = atPct < splitPct;
    const card = call.querySelector('.reveal-card');
    if (card) {
      // A NUDGE, NOT A MOVE. The card stays centred over the column of ports
      // it belongs to and shifts a little to one side or the other by row, so
      // stepping from one port to the one below it is visibly a change without
      // the card leaving the column. At 34px it was big enough to drive a card
      // near the left edge into the clamp, which threw it to the frame edge -
      // so one row read as "left" and the next as "further left" rather than
      // as a pair either side of centre.
      const NUDGE = 15;
      card.style.setProperty('--nudge', `${side * NUDGE}px`);
      const cr = card.getBoundingClientRect();
      const over = Math.min(0, cr.left - box.left - 4)
                 + Math.max(0, cr.right - box.right + 4);
      if (over) card.style.setProperty('--nudge', `${side * NUDGE - over}px`);
    }
  };

  place(DEFAULT_PORT);
  // The demo is itself addressable: the callout follows the pointer because
  // every one of these is a real element, not a hotspot drawn over a picture.
  svg.addEventListener('mouseover', ev => {
    const t = ev.target.closest?.('.pt-mark');
    if (t && PORTS[t.dataset.port]) place(t.dataset.port);
  });

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
    splitPct = v;
    stage.style.setProperty('--split', `${v}%`);
    range.value = String(v);
    // Hidden once the divider has passed its port: on that side the drawing is
    // a flat image, and a callout there would be pointing at nothing.
    const at = Number(call.dataset.at);
    call.hidden = Number.isFinite(at) && at < v;
  };
  range.addEventListener('input', () => split(+range.value));
  let dragging = false;
  const at = ev => {
    const box = stage.getBoundingClientRect();
    const x = ('touches' in ev ? ev.touches[0].clientX : ev.clientX) - box.left;
    split(Math.max(0, Math.min(100, (x / box.width) * 100)));
  };
  stage.addEventListener('pointerdown', ev => {
    if (ev.target.closest('.pt-mark')) return;   // a port answers first
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
  // Measured in pixels, so it has to be measured again when the box changes -
  // and the labels come off entirely once a cage is too small to hold one.
  const TIGHT = 640;
  const ro = new ResizeObserver(() => {
    stage.classList.toggle('is-tight',
      richMedia.getBoundingClientRect().width < TIGHT);
    place(call.dataset.port || DEFAULT_PORT);
  });
  ro.observe(richMedia);
}

// A lamp is `off` until something sets its colour, and the drawing exposes
// that as a custom property rather than a fill - so lighting one touches no
// artwork. `part` picks a lamp within a multi-lamp element, which is how the
// QSFP28 quads address their four lanes separately.
function setLed(svg, id, state, part) {
  const colour = LAMP[state];
  const sel = part ? `[id="${id}--${part}"]` : `[id="${id}--lamp"]`;
  const lamp = svg.querySelector(sel);
  if (!lamp) return;
  if (colour) lamp.style.setProperty('--led-color', colour);
  else lamp.style.removeProperty('--led-color');
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
