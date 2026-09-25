// The ROADM ring in 2D, one site at a time.
//
// 3D racks the whole ring in the one physical lab rack it shares. 2D draws
// it the way the topology divides it: a site (ring.js's sitesOf - the parts
// left connected when the span links are dropped) as its front and rear
// elevations side by side. Every in-site cable is drawn between the real
// ports the compiled faces put it on; a span link, whose far end is in
// another site, ends in a stub that names that end and takes you there.
//
// Exports:
//   siteCaption - the sentence every 2D ring stage leads with: sites are the
//                topology's, the rack is one.
//   drawSite2d - the picture of one site, composed and attached.
//   siteView   - the site tabs, the stub jumps and the way back, for any
//                stage that shows the ring in 2D (stage 4 cables it, stage 5
//                filters it).

import {DIST, stageRack, svgEl, panZoom} from './artifact.js';
import {build2dElevation} from './rack.js';
import {boxIn, highlight, clearHighlights, wireClicks} from './svg2d.js';
import {cssColor} from './ring.js';

// Millimetres, like everything else in the drawing.
const GAP = 240;           // between the front and rear elevations: cables cross here, stubs sit here
const TOP = 24;            // above both elevations, for FRONT / REAR
const STRAND = 3.2;        // tx above, rx below the port centre; the 3D strand spacing
const BOW = 30;            // how far a front-to-front run bows out past its elevation's edge
const STUB_IN = 44;        // a stub pill's near edge, this far into the gap (clear of the bows)
// A stub is three lines - far site, far device, far port - big enough to read
// with the whole site in view (a site is about 1270 mm across a stage a few
// hundred pixels wide). It shrinks toward STUB_FONT_MIN only if the longest
// line would not fit between STUB_IN and the far elevation's rail.
const STUB_FONT = 12;
const STUB_FONT_MIN = 10;
const STUB_LEAD = 1.2;     // line height, in ems
const STUB_PAD = 4;
const STUB_SEP = 4;        // between two stacked pills
const RAIL_CLEAR = 8;      // a pill stops this far short of the other elevation's outer edge

const ESC = v => (window.CSS?.escape ? CSS.escape(v) : String(v).replace(/"/g, '\\"'));

// What a stub says, in the one form the drawing's tooltip and the panel's
// button both use: far site, far device, far port.
const stubText = (farSite, there) => `→ ${farSite.label} · ${there[0]} · ${there[1]}`;

// THE CAPTION, for every stage that shows the ring by site (spec §5.2). A
// 2D site looks like a rack of its own, and it is not one: the sites are
// the topology's, and physically every device shares the one lab rack. The
// count comes from the sites, the U range from the lab.
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const countWord = n => (n >= 2 && n <= 9 ? WORDS[n] : String(n));
export function siteCaption(lab, sites) {
  const us = (lab.devices || []).map(d => d.ru);
  const lo = Math.min(...us), hi = Math.max(...us);
  return `Grouped by site, as the ring's topology divides it. Physically all ${countWord(sites.length)} share one lab rack (U${lo}–${hi}).`;
}

const indexMemo = new Map();   // ref -> its configs.json, or null when it failed
async function indexOf(ref) {
  if (indexMemo.has(ref)) return indexMemo.get(ref);
  let idx = null;
  try {
    const {jdist} = await import('../../vendor/dist.js');
    idx = await jdist(`${DIST}${ref}.configs.json`);
  } catch (err) { console.warn('[portrayal] no config index for', ref, err); }
  indexMemo.set(ref, idx);
  return idx;
}

// One site's picture.
//
//   drawSite2d({lab, sites, index, host = stageRack, live = () => true})
//     -> {svg, cables, stubs, unanchored, faces}   or null when !live()
//
//   cables:     [{link, li, el, faces: [fromFace, toFace]}]   in-site links drawn
//   stubs:      [{link, li, end: 'from'|'to', far, el, port, text}] span ends drawn
//               (far is the far end's site index; port is this end's port element;
//               text is "→ far site · device · port")
//   unanchored: in-site links plus span ends that could NOT be drawn, because
//               an end's device did not load or has no such port. It should be 0.
//   faces:      {front, rear}, the two nested elevations
//
// `li` is the link's index in lab.links: the same in every site, which is how
// a stub finds its partner. `live` is checked after every await and before
// the picture is attached to `host`: a picture whose caller has moved on is
// never put up. It is attached BEFORE the cables are anchored, because boxIn
// needs a rendered root.
export async function drawSite2d({lab, sites, index, host = stageRack, live = () => true}) {
  const site = sites[index];
  const siteOf = id => sites.findIndex(s => s.ids.has(id));

  // The stack, as ring.js builds it for 3D: each ref's own configs.json
  // default, the lab id as the label. A device whose index failed is left out,
  // and its ends count as unanchored rather than being drawn at a guess.
  const stack = [];
  for (const d of site.devices) {
    const idx = await indexOf(d.ref);
    if (!live()) return null;
    if (idx) stack.push({ref: d.ref, cfg: idx.default, ru: d.ru, label: d.id, u: 1});
  }
  // One U of rail above and below the site.
  const baseRU = site.ruMin - 1;
  const heightRU = site.ruMax - site.ruMin + 3;
  const front = await build2dElevation({stack, heightRU, overrides: {}, view: 'front', baseRU});
  if (!live()) return null;
  const rear = await build2dElevation({stack, heightRU, overrides: {}, view: 'rear', baseRU});
  if (!live()) return null;

  const vb = front.getAttribute('viewBox');
  const [, , ew, eh] = vb.split(/\s+/).map(Number);
  const W = ew * 2 + GAP, H = TOP + eh;
  const RX = ew + GAP;                          // the rear elevation's left edge
  const svg = svgEl('svg', {xmlns: 'http://www.w3.org/2000/svg', viewBox: `0 0 ${W} ${H}`,
    'data-ring-site': String(index)});
  const faces = {};
  for (const [name, el, x] of [['front', front, 0], ['rear', rear, RX]]) {
    el.setAttribute('x', x);
    el.setAttribute('y', TOP);
    el.setAttribute('width', ew);
    el.setAttribute('height', eh);
    el.setAttribute('data-face', name);
    const t = svgEl('text', {x: x + ew / 2, y: TOP - 6, 'text-anchor': 'middle',
      'font-family': 'IBM Plex Mono, monospace', 'font-size': 12, 'font-weight': 600,
      'letter-spacing': 2, fill: 'var(--pt-ink-muted)'});
    t.textContent = name.toUpperCase();
    svg.append(t, el);
    faces[name] = el;
  }

  host.replaceChildren(svg);

  // An end [devId, port, strand?] -> where it is drawn, or null. The device
  // is found in the front elevation, then the rear; the first face that has
  // the port is the side the end is on.
  const anchor = ep => {
    for (const face of ['front', 'rear']) {
      const g = faces[face].querySelector(`[data-device-name="${ESC(ep[0])}"]`);
      const port = g?.querySelector(`[data-path="${ESC(ep[1])}"]`);
      if (!port) continue;
      const b = boxIn(svg, port);
      if (!b) return null;
      const dy = ep[2] === 'tx' ? -STRAND : ep[2] === 'rx' ? STRAND : 0;
      return {face, port, x: b.x + b.width / 2, y: b.y + b.height / 2 + dy};
    }
    return null;
  };

  const layer = svgEl('g', {'data-cables': 'true', fill: 'none'});
  const leads = svgEl('g', {'data-stub-leads': 'true', fill: 'none'});
  const pills = svgEl('g', {'data-stubs': 'true'});
  svg.append(layer, leads, pills);

  const cables = [], stubs = [];
  const pending = {front: [], rear: []};       // stub ends, laid out per side below
  let unanchored = 0;
  const bowTo = (a, b, edge) => {
    // Both control points on one vertical, placed so the curve's midpoint
    // reaches `edge`: (a + 3X + 3X + b) / 8 = edge.
    const X = (8 * edge - a.x - b.x) / 6;
    return `M${a.x} ${a.y} C${X} ${a.y} ${X} ${b.y} ${b.x} ${b.y}`;
  };

  lab.links.forEach((link, li) => {
    const inFrom = site.ids.has(link.from[0]), inTo = site.ids.has(link.to[0]);
    if (!inFrom && !inTo) return;
    const color = cssColor(link, lab);
    if (inFrom && inTo) {
      const a = anchor(link.from), b = anchor(link.to);
      if (!a || !b) { unanchored++; return; }
      let d;
      if (a.face === 'front' && b.face === 'front') d = bowTo(a, b, ew + BOW);
      else if (a.face === 'rear' && b.face === 'rear') d = bowTo(a, b, RX - BOW);
      else {
        // Across the gap: out of each face towards it.
        const out = p => p.face === 'front' ? ew + GAP * 0.35 : RX - GAP * 0.35;
        d = `M${a.x} ${a.y} C${out(a)} ${a.y} ${out(b)} ${b.y} ${b.x} ${b.y}`;
      }
      const el = svgEl('path', {d, stroke: color, 'stroke-width': 1.6, 'stroke-linecap': 'round',
        'data-cable': 'true', 'data-link-index': String(li), 'data-media': link.media,
        'data-from-face': a.face, 'data-to-face': b.face});
      layer.append(el);
      cables.push({link, li, el, faces: [a.face, b.face]});
      return;
    }
    // A span: only this site's end is drawn, and it ends in a stub.
    const end = inFrom ? 'from' : 'to';
    const here = link[end], there = link[inFrom ? 'to' : 'from'];
    const a = anchor(here);
    const far = siteOf(there[0]);
    if (!a || far < 0) { unanchored++; return; }
    pending[a.face].push({link, li, end, far, a, color, there});
  });

  // Stub pills, a column per side of the gap. Built first and measured (they
  // are attached, so the text has a length), then one font for the whole
  // site: STUB_FONT unless the longest line would cross into the other
  // elevation. Then each column is stacked so no two pills overlap, and the
  // stack is shifted as a whole to sit centred on its ports, inside the
  // drawing.
  const room = GAP - STUB_IN - RAIL_CLEAR;
  const built = [];
  for (const face of ['front', 'rear']) {
    for (const s of pending[face].sort((p, q) => p.a.y - q.a.y)) {
      const far = sites[s.far];
      const g = svgEl('g', {'data-stub': 'true', 'data-link-index': String(s.li), 'data-end': s.end,
        'data-far': String(s.far), tabindex: '0', role: 'button',
        'aria-label': `${s.link.span ? `span ${s.link.span}: ` : ''}go to ${far.label}, ${s.there[0]} ${s.there[1]}`,
        'data-pt-ui': 'tabindex role aria-label'});
      const tip = svgEl('title', {'data-pt-ui': '*'});
      tip.textContent = stubText(far, s.there);
      const rect = svgEl('rect', {rx: 4, fill: 'var(--pt-surface)', stroke: s.color, 'stroke-width': 1.4});
      const text = svgEl('text', {'font-family': 'IBM Plex Mono, monospace', 'font-size': STUB_FONT,
        fill: 'var(--pt-ink)'});
      const lines = [`→ ${far.label}`, s.there[0], s.there[1]].map(t => {
        const ts = svgEl('tspan', {});
        ts.textContent = t;
        return ts;
      });
      text.append(...lines);
      g.append(tip, rect, text);
      pills.append(g);
      built.push({s, face, g, rect, text, lines});
    }
  }
  const widest = Math.max(0, ...built.flatMap(b => b.lines.map(l =>
    l.getComputedTextLength?.() || STUB_FONT * 0.6 * l.textContent.length)));
  const font = widest + STUB_PAD * 2 > room
    ? Math.max(STUB_FONT_MIN, STUB_FONT * (room - STUB_PAD * 2) / widest) : STUB_FONT;
  const lh = font * STUB_LEAD;
  const pillH = lh * 3 + STUB_PAD * 2;

  for (const face of ['front', 'rear']) {
    const col = built.filter(b => b.face === face);
    if (!col.length) continue;
    // Downward, no overlap; then the whole column moves so its mean centre is
    // its ports' mean height, kept inside the drawing.
    const cy = [];
    for (const [i, b] of col.entries()) cy.push(i ? Math.max(b.s.a.y, cy[i - 1] + pillH + STUB_SEP) : b.s.a.y);
    const mean = xs => xs.reduce((t, x) => t + x, 0) / xs.length;
    let shift = mean(col.map(b => b.s.a.y)) - mean(cy);
    shift = Math.min(shift, H - pillH / 2 - 2 - cy[cy.length - 1]);
    shift = Math.max(shift, TOP + pillH / 2 - cy[0]);
    col.forEach((b, i) => {
      const y = cy[i] + shift;
      const {s, rect, text, lines} = b;
      text.setAttribute('font-size', font);
      const tw = Math.max(...lines.map(l => l.getComputedTextLength?.() || font * 0.6 * l.textContent.length));
      const w = tw + STUB_PAD * 2;
      // Front ends lean right into the gap; rear ends lean left into it.
      const x0 = face === 'front' ? ew + STUB_IN : RX - STUB_IN - w;
      rect.setAttribute('x', x0);
      rect.setAttribute('y', y - pillH / 2);
      rect.setAttribute('width', w);
      rect.setAttribute('height', pillH);
      const top = y - pillH / 2 + STUB_PAD;
      lines.forEach((l, k) => {
        l.setAttribute('x', x0 + STUB_PAD);
        l.setAttribute('y', top + lh * k + font * 0.9);
      });
      const px = face === 'front' ? x0 : x0 + w;
      const k = face === 'front' ? 1 : -1;
      leads.append(svgEl('path', {d: `M${s.a.x} ${s.a.y} C${s.a.x + k * 40} ${s.a.y} ${px - k * 30} ${y} ${px} ${y}`,
        stroke: s.color, 'stroke-width': 1.6, 'stroke-linecap': 'round',
        'data-stub-lead': 'true', 'data-link-index': String(s.li)}));
      stubs.push({link: s.link, li: s.li, end: s.end, far: s.far, el: b.g, port: s.a.port,
                  text: stubText(sites[s.far], s.there)});
    });
  }

  return {svg, cables, stubs, unanchored, faces};
}

// ── the view: tabs, stub jumps, and the way back ────────────────────────────
//
//   siteView({ui, lab, sites, host = stageRack, tabs = #stageTabs, onDraw})
//     -> {show(index, {highlightLink, from, focus}) -> Promise<drawn | null>,
//         current() -> {index, drawn} | null,
//         back,      // an element for the stage's panel: holds "← back to …" after a jump
//         status}    // an element for the stage's panel: what this site's picture holds,
//                    // and a button per span end that jumps as its stub does
//
// `ui` is the entry's lease (stage-rail.js). Every write here - the tabs, the
// picture, the highlight, back and status - happens only while it is live
// AND while this is still the newest show(): a tab click or stub jump while
// a site is drawing makes the older draw stale, so it never paints over the
// newer one. The tabs live in #stageTabs, which the rail empties on vacate.
//
// `onDraw(drawn, {index, site})` runs after each picture is up and wired,
// for a stage that marks it further (stage 5's filter).
//
// A stub is a button inside a pan/zoom drawing, wired by svg2d.js's
// wireClicks exactly as a cast device is (spoke-host.js's wireDevices): a
// drag that pans is not a click, a double-click fits the drawing rather than
// jumping, a pointer click jumps after the double-click window, and Enter or
// Space on a focused stub jumps at once, taking focus to the partner stub.
// The stub's tabindex, role, aria-label and <title>, and the highlight, are
// marked data-pt-ui, so an SVG export is the drawing, not the controls.
export function siteView({ui, lab, sites, host = stageRack,
                          tabs = document.getElementById('stageTabs'), onDraw = null}) {
  let seq = 0;
  let now = null;
  const back = document.createElement('div');
  back.setAttribute('data-back-slot', 'true');
  const status = document.createElement('div');
  status.setAttribute('data-site-status', 'true');
  status.className = 'panel-lead';

  const tabButtons = [];
  const paintTabs = index => {
    tabButtons.forEach((b, i) => {
      b.setAttribute('aria-selected', String(i === index));
      b.tabIndex = i === index ? 0 : -1;
    });
  };
  if (ui.live() && tabs) {
    tabs.replaceChildren();
    sites.forEach((s, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', 'false');
      b.setAttribute('data-tab-index', String(i));
      b.textContent = s.label;
      b.onclick = () => { if (ui.live()) show(i); };
      tabButtons.push(b);
      tabs.append(b);
    });
    tabs.onkeydown = ev => {
      const i = tabButtons.indexOf(document.activeElement);
      if (i < 0) return;
      const n = tabButtons.length;
      const to = {ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: n - 1}[ev.key];
      if (to == null) return;
      ev.preventDefault();
      const j = (to + n) % n;
      tabButtons[j].focus();
      if (ui.live()) show(j);
    };
  }

  const mark = (root, el) => {
    const r = highlight(root, el);
    if (!r) return;
    r.setAttribute('data-pt-ui', '*');
    const had = el.getAttribute('data-pt-ui');
    if (had !== '*') el.setAttribute('data-pt-ui', `${had ? had + ' ' : ''}data-highlight`);
  };

  // THE jump, for a stub on the drawing and for its button in the panel
  // alike: only from the picture still on screen, and only while live.
  function jumpFrom(drawn, index, stub, focus) {
    if (!ui.live() || now?.drawn !== drawn || !drawn.svg.isConnected) return;
    show(stub.far, {highlightLink: stub.li, from: index, focus});
  }

  function wire(drawn, index) {
    const {svg, stubs} = drawn;
    wireClicks(svg, {
      targetAt: t => stubs.find(s => s.el.contains(t)) || null,
      open: (stub, {keyboard}) => jumpFrom(drawn, index, stub, keyboard),
      ui,
    });
  }

  async function show(index, {highlightLink = null, from = null, focus = false} = {}) {
    const mine = ++seq;
    const live = () => ui.live() && mine === seq;
    if (!live()) return null;
    now = null;
    host.replaceChildren();
    back.replaceChildren();
    status.textContent = `Drawing ${sites[index].label}…`;
    paintTabs(index);

    const drawn = await drawSite2d({lab, sites, index, host, live});
    if (!drawn || !live()) return null;
    now = {index, drawn};

    const base = drawn.svg.getAttribute('viewBox').split(/\s+/).map(Number);
    panZoom(drawn.svg, () => base);
    wire(drawn, index);

    const site = sites[index];
    const inSite = lab.links.filter(l => site.ids.has(l.from[0]) && site.ids.has(l.to[0])).length;
    const spanEnds = lab.links.filter(l => site.ids.has(l.from[0]) !== site.ids.has(l.to[0])).length;
    status.replaceChildren();
    const line = (k, v) => {
      const p = document.createElement('div');
      const b = document.createElement('strong');
      b.textContent = k;
      p.append(b, ` ${v}`);
      status.append(p);
    };
    line(`${site.label}:`, `${site.devices.length} devices, front and rear.`);
    line('cables drawn', `${drawn.cables.length} / ${inSite} in this site`);
    line('span stubs', `${drawn.stubs.length} / ${spanEnds}, each naming its far end`);
    line('not drawn', drawn.unanchored
      ? `${drawn.unanchored} (an end's device did not load, or has no such port)` : '0');
    status.dataset.cables = String(drawn.cables.length);
    status.dataset.stubs = String(drawn.stubs.length);
    status.dataset.unanchored = String(drawn.unanchored);
    // The span ends again, as real buttons: legible at any zoom, and in the
    // tab order with the rest of the panel. Same text, same jump.
    if (drawn.stubs.length) {
      const head = document.createElement('div');
      const hb = document.createElement('strong');
      hb.textContent = 'span ends';
      head.append(hb, ' - go to the far end:');
      const list = document.createElement('div');
      list.className = 'ring-spans';
      for (const st of drawn.stubs) {
        const b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('data-span-end', 'true');
        b.setAttribute('data-link-index', String(st.li));
        b.style.borderLeftColor = cssColor(st.link, lab);
        b.textContent = st.text;
        // detail 0 is a keyboard (or programmatic) press: focus follows to
        // the partner stub, as Enter on a stub does.
        b.onclick = ev => jumpFrom(drawn, index, st, ev.detail === 0);
        list.append(b);
      }
      status.append(head, list);
    }

    if (highlightLink != null) {
      clearHighlights(drawn.svg);
      const partner = drawn.stubs.find(s => s.li === highlightLink);
      if (partner) {
        mark(drawn.svg, partner.el);
        mark(drawn.svg, partner.port);
        if (focus) partner.el.focus({preventScroll: true});
      }
    }
    if (from != null) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ring-back';
      b.setAttribute('data-back', String(from));
      b.textContent = `← back to ${sites[from].label}`;
      b.onclick = () => { if (ui.live()) show(from, {highlightLink, focus: true}); };
      back.append(b);
    }
    onDraw?.(drawn, {index, site});
    return drawn;
  }

  return {show, current: () => now, back, status};
}
