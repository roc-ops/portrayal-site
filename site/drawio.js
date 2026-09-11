// Portrayal -> draw.io, as a shape library or a rack diagram.
//
// The representation is the one that survived the bake-off: the compiled SVG as
// an image for the picture, plus one invisible, connectable cell per port. That
// is the only shape that is both exact and addressable - an edge drawn to a port
// records source="port-12" rather than a coordinate on the device, which is the
// whole argument for exporting from a model that names things.
//
// The alternatives and why they lost, since the question will come up again:
// a stencil is ~30x smaller and vector, but mxStencil renders no text at all, so
// a faceplate loses every port number and every silkscreen line; and although a
// stencil CAN carry named connection points, draw.io writes exitX/exitY into the
// edge and never the name. One cell per element is addressable but needs path
// conversion to look right and runs to hundreds of cells a device.

const MM = 25.4;

// Standalone entries are drawn at 2 px/mm, which is legible on a blank canvas.
export const SCALE = 2;

// draw.io's own rack wants something else entirely. rackCabinet3 is 180 wide and
// one RU is 14.8, and marginLeft is 9 with the U numbers OFF but 33 with them ON
// - mxRack.js sets it that way itself when you toggle numbering. Using 9 with
// numbering on puts every device 24 units too far left AND 24 too wide, which
// reads as "the rack will not fit its contents".
export const RACK = {
  outer: 180, unit: 14.8, marginL: 33, marginR: 9, marginTop: 21, marginBottom: 22,
};
RACK.width = RACK.outer - RACK.marginL - RACK.marginR;      // 138

const esc = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

// ── reading the compiled drawing ─────────────────────────────────────────
// A real transform stack, because the compiled output is not only translates.
// A C40G mounts its supervisors on their side -
//   transform="translate(214.75,118.645) rotate(90) translate(-15.235,-172.75)"
// - and reading just the first translate put twelve of its ports 80 mm below
// the chassis. 65 rotates and 8 scales across the current faces.
//
// Matrices are SVG's [a b c d e f]: x' = a·x + c·y + e, y' = b·x + d·y + f.
const I = [1, 0, 0, 1, 0, 0];
const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

function parseTransform(str) {
  let m = I;
  if (!str) return m;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let t;
  while ((t = re.exec(str))) {
    const n = t[2].split(/[\s,]+/).map(Number).filter(Number.isFinite);
    const rad = d => d * Math.PI / 180;
    switch (t[1]) {
      case 'matrix':    if (n.length >= 6) m = mul(m, n.slice(0, 6)); break;
      case 'translate': m = mul(m, [1, 0, 0, 1, n[0] || 0, n[1] || 0]); break;
      case 'scale':     m = mul(m, [n[0] ?? 1, 0, 0, n[1] ?? n[0] ?? 1, 0, 0]); break;
      case 'skewX':     m = mul(m, [1, 0, Math.tan(rad(n[0] || 0)), 1, 0, 0]); break;
      case 'skewY':     m = mul(m, [1, Math.tan(rad(n[0] || 0)), 0, 1, 0, 0]); break;
      case 'rotate': {
        const c = Math.cos(rad(n[0] || 0)), s2 = Math.sin(rad(n[0] || 0));
        const R = [c, s2, -s2, c, 0, 0];
        // rotate(a cx cy) is translate(cx cy) rotate(a) translate(-cx -cy)
        m = (n.length >= 3)
          ? mul(mul(mul(m, [1, 0, 0, 1, n[1], n[2]]), R), [1, 0, 0, 1, -n[1], -n[2]])
          : mul(m, R);
        break;
      }
    }
  }
  return m;
}

// THE REAL OUTLINE, NOT THE RECTANGLES INSIDE IT. The walk in readSvg measures
// rects and circles and nothing else, because a path has no box until something
// lays it out. That was right for an SFP cage, which is one rect, and wrong for
// every jack drawn as a housing: an RJ45 is mostly path with one small latch
// rect in it, so on the S9510-28DC the TOD, BITS and console jacks came out as
// 7.6 x 2.3 mm strips across the top of a 15.8 x 13.2 mm jack - 8% of it - and
// a line could not be landed on them in draw.io or in OmniGraffle. The coax
// timing inputs fared little better, at about 55%. A port whose art is ALL path
// had no box at all and was dropped.
//
// The browser can measure a whole group, so where there is a browser it does,
// with the same CTM arithmetic relief.js uses and all four corners so a rotated
// card still gets its full box. Where there is no document - a test runner, a
// worker - the walked box stands, which is what every export had before.
function layoutZones(text, zones) {
  if (typeof document === 'undefined' || !zones.length) return;
  const div = document.createElement('div');
  div.style.cssText = 'position:absolute;left:-10000px;top:0;width:1000px;visibility:hidden';
  div.innerHTML = text;
  document.body.append(div);
  try {
    const svg = div.querySelector('svg');
    const rootCtm = svg && svg.getScreenCTM();
    if (!rootCtm) return;
    const inv = rootCtm.inverse();
    for (const z of zones) {
      const el = svg.querySelector(`[id="${CSS.escape(z.id)}"]`);
      if (!el || typeof el.getBBox !== 'function') continue;
      let b;
      try { b = el.getBBox(); } catch (e) { continue; }
      if (!(b.width > 0 && b.height > 0)) continue;
      const m = inv.multiply(el.getScreenCTM());
      let x = Infinity, y = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [px, py] of [[b.x, b.y], [b.x + b.width, b.y],
                              [b.x + b.width, b.y + b.height], [b.x, b.y + b.height]]) {
        const ax = m.a * px + m.c * py + m.e, ay = m.b * px + m.d * py + m.f;
        x = Math.min(x, ax); y = Math.min(y, ay); x1 = Math.max(x1, ax); y1 = Math.max(y1, ay);
      }
      Object.assign(z, {x, y, x1, y1});
    }
  } finally { div.remove(); }
}

/** `layout: false` keeps the rect-and-circle walk alone - the old answer, kept
 *  so the two can be compared, and used wherever there is no document. */
export function readSvg(text, {layout = true} = {}) {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = doc.documentElement;
  if (root.querySelector('parsererror')) throw new Error('unparseable SVG');
  const vb = (root.getAttribute('viewBox') || '0 0 0 0').split(/\s+/).map(Number);
  const zones = [];
  const num = (el, a, d = 0) => {
    const v = parseFloat(el.getAttribute(a));
    return Number.isFinite(v) ? v : d;
  };
  // A rotated rectangle's bounds are the bounds of its transformed corners.
  const grow = (z, ctm, x, y, w, h) => {
    if (!z) return;
    for (const [px, py] of [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]) {
      const [ax, ay] = apply(ctm, px, py);
      z.x = Math.min(z.x, ax); z.y = Math.min(z.y, ay);
      z.x1 = Math.max(z.x1, ax); z.y1 = Math.max(z.y1, ay);
    }
  };
  (function walk(el, ctm, zone) {
    ctm = mul(ctm, parseTransform(el.getAttribute?.('transform')));
    const tag = el.tagName;
    // What a thing IS comes from the model, not from the shape of its id.
    // Guessing by name found 1 port on an ASR 9001 (whose ports are named tod,
    // svc-lan, sync-0) and none at all on a C100G, whose 44 ports live on
    // seated modules and are named front-6--module--xg0.
    const cls = el.getAttribute?.('data-class');
    let {port, bay} = zone;
    // Outermost wins WITHIN a class, not across classes. A cage inside a port
    // is part of that port - not a second thing to plug into - but a port on a
    // card seated in a bay is very much its own port: that is where the 44
    // ports of a C100G live, named front-6--module--xg0, and nesting them
    // under their bay loses every one of them.
    if (tag === 'g' && el.id) {
      // The model's own words about the thing, carried through. A miniature
      // symbol needs to know which bay a port belongs to and what kind of port
      // it is; geometry alone cannot say either.
      const meta = {
        path: el.getAttribute('data-path') || el.id,
        group: el.getAttribute('data-group') || null,
        media: el.getAttribute('data-media') || null,
        speed: el.getAttribute('data-speed') || null,
        model: el.getAttribute('data-model') || null,
      };
      if (cls === 'port' && !port) {
        port = {id: el.id, cls, ...meta,
                x: Infinity, y: Infinity, x1: -Infinity, y1: -Infinity};
        zones.push(port);
      } else if (cls === 'bay' && !bay) {
        bay = {id: el.id, cls, ...meta,
               x: Infinity, y: Infinity, x1: -Infinity, y1: -Infinity};
        zones.push(bay);
      }
    }
    const z = port || bay;
    if (tag === 'rect') {
      const x = num(el, 'x'), y = num(el, 'y');
      const w = num(el, 'width'), h = num(el, 'height');
      grow(port, ctm, x, y, w, h); if (bay !== port) grow(bay, ctm, x, y, w, h);
    } else if (tag === 'circle') {
      const r = num(el, 'r');
      const x = num(el, 'cx') - r, y = num(el, 'cy') - r;
      grow(port, ctm, x, y, 2 * r, 2 * r); if (bay !== port) grow(bay, ctm, x, y, 2 * r, 2 * r);
    } else if (tag === 'path' || tag === 'line' || tag === 'polygon') {
      // No bbox without laying it out; a port is never only a path, so its
      // rects carry it. Noted so the count stays honest if that changes.
      if (z) z.hasPath = true;
    }
    for (const c of el.children) walk(c, ctm, {port, bay});
  })(root, I, {port: null, bay: null});
  if (layout) layoutZones(text, zones);
  const sized = zones
    .filter(z => Number.isFinite(z.x))
    .map(z => ({id: z.id, cls: z.cls, path: z.path, group: z.group,
                media: z.media, speed: z.speed, model: z.model,
                x: z.x, y: z.y, w: z.x1 - z.x, h: z.y1 - z.y}));
  return {vb, zones: sized};
}

/** The things a cable can be drawn to: ports, and optionally the bays that hold
 *  the cards whose ports they are. Sorted so port-2 precedes port-10. */
export function portsOf(zones, {bays = false} = {}) {
  return zones
    .filter(z => z.cls === 'port' || (bays && z.cls === 'bay'))
    // Bays FIRST, then ports. A later sibling draws on top in draw.io, and a
    // bay is a big cell containing the ports of whatever is seated in it - so
    // sorting the two together by id lets a slot land above its own card's
    // ports and swallow every click meant for them.
    .sort((a, b) =>
      (a.cls === b.cls ? 0 : a.cls === 'bay' ? -1 : 1) ||
      a.id.length - b.id.length || a.id.localeCompare(b.id));
}

// ── cells ────────────────────────────────────────────────────────────────
const cell = (id, value, style, x, y, w, h, parent = '1') =>
  `<mxCell id="${esc(id)}" value="${esc(value)}" style="${style}" vertex="1" ` +
  `parent="${esc(parent)}"><mxGeometry x="${x.toFixed(2)}" y="${y.toFixed(2)}" ` +
  `width="${Math.max(w, 0.5).toFixed(2)}" height="${Math.max(h, 0.5).toFixed(2)}" ` +
  `as="geometry"/></mxCell>`;

const model = cells =>
  `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells.join('')}` +
  `</root></mxGraphModel>`;

// One connection point per port, dead centre. Without this a port gets draw.io's
// DEFAULT perimeter points - the four sides and the corners, never a centre -
// which is right for a box you draw an arrow to and wrong for a socket you plug
// a cable into. The third field is the perimeter flag: 0 means "exactly at this
// fraction", not "project outwards to the outline".
const PORT_POINT = 'points=[[0.5,0.5,0]];';

/** SVG text as a data URI. draw.io omits ";base64" - the semicolon would
 *  terminate the style token it sits in. */
export function svgDataUri(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return 'data:image/svg+xml,' + btoa(bin);
}

/**
 * One device: the compiled face as an image, with a connectable cell per port.
 *
 * The root is a GROUP rather than the image itself. Resizing an image vertex
 * does not rescale its children, so ports slid off the faceplate the moment a
 * rack resized it; group children scale with the group. `visible` tints the
 * ports so they can be seen while judging - shipped exports leave them
 * invisible, which is the point of putting them over an exact picture.
 */
export function deviceCells(id, svgText, vb, ports, x, y, w, h, {visible = false} = {}) {
  const sx = w / vb[2], sy = h / vb[3];
  const tint = c => visible
    ? (c === 'bay' ? 'fillColor=#F5A623;opacity=16;strokeColor=#F5A623;'
                   : 'fillColor=#00A0FF;opacity=22;strokeColor=#00A0FF;')
    : 'fillColor=none;strokeColor=none;';
  const out = [cell(id, '', 'group;html=1;', x, y, w, h)];
  out.push(cell(`${id}-face`, '',
    `shape=image;imageAspect=0;editableCssRules=.*;image=${svgDataUri(svgText)};`,
    0, 0, w, h, id));

  // A MODULAR CHASSIS GROUPS ITS PORTS UNDER THE CARD THEY ARE ON. The cells
  // are still at their real positions over the image - this is the footprint,
  // not the miniature - but a bay is now a collapsible container holding its
  // own card's ports. Fold one and its forty connection points go with it,
  // which is the difference between a diagram you can cable and a faceplate
  // wearing forty invisible hit targets. It also gives the bay an identity a
  // cable can be checked against later.
  const bays = ports.filter(p => p.cls === 'bay');
  const owned = new Set();
  for (const b of bays) {
    const mine = ports.filter(p => p.cls === 'port'
      && String(p.path || p.id).startsWith(`${b.id}/`));
    if (!mine.length) continue;
    mine.forEach(p => owned.add(p));
    const bx = b.x * sx, by = b.y * sy;
    const bw = Math.max(b.w * sx, 1.5), bh = Math.max(b.h * sy, 1.5);
    out.push(
      `<object label="" portrayal-bay="${esc(b.id)}"` +
      (b.model ? ` portrayal-module="${esc(b.model)}"` : '') +
      ` id="${esc(`${id}-${b.id}`)}"><mxCell style="${tint('bay')}html=1;` +
      `container=1;collapsible=1;connectable=0;" vertex="1" ` +
      `parent="${esc(id)}"><mxGeometry x="${bx}" y="${by}" width="${bw}" ` +
      `height="${bh}" as="geometry"><mxRectangle x="${bx}" y="${by}" ` +
      `width="${bw}" height="${bh}" as="alternateBounds"/></mxGeometry>` +
      `</mxCell></object>`);
    for (const p of mine) {
      out.push(cell(`${id}-${p.id}`, '',
        `${tint(p.cls)}html=1;connectable=1;${PORT_POINT}`,
        p.x * sx - bx, p.y * sy - by,
        Math.max(p.w * sx, 1.5), Math.max(p.h * sy, 1.5), `${id}-${b.id}`));
    }
  }
  for (const p of ports) {
    if (owned.has(p) || p.cls === 'bay') continue;
    out.push(cell(`${id}-${p.id}`, '', `${tint(p.cls)}html=1;connectable=1;${PORT_POINT}`,
      p.x * sx, p.y * sy, Math.max(p.w * sx, 1.5), Math.max(p.h * sy, 1.5), id));
  }
  // A bay with no ports of its own is still worth being a cell - it is an empty
  // slot - so it keeps the behaviour it had before this change.
  for (const b of bays) {
    if (ports.some(p => p.cls === 'port'
        && String(p.path || p.id).startsWith(`${b.id}/`))) continue;
    out.push(cell(`${id}-${b.id}`, '', `${tint('bay')}html=1;connectable=1;${PORT_POINT}`,
      b.x * sx, b.y * sy, Math.max(b.w * sx, 1.5), Math.max(b.h * sy, 1.5), id));
  }
  return out;
}

/** A library entry for one device, at whatever scale the caller wants. */
export function entry(name, svgText, vb, ports, opts = {}) {
  const {ru = null, visible = false} = opts;
  const w = ru ? RACK.width : vb[2] * SCALE;
  const h = ru ? RACK.unit * ru : vb[3] * SCALE;
  const id = slug(name);
  return {
    w: Math.round(w), h: Math.round(h),
    title: ru ? `${name} (${ru}RU, rack)` : name,
    tags: `portrayal ${name} ${ru ? 'rack' : 'standalone'} port`,
    xml: model(deviceCells(id, svgText, vb, ports, 0, 0, w, h, {visible})),
  };
}

const slug = s => String(s).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-|-$/g, '');

/**
 * <mxlibrary> wrapping a JSON array.
 *
 * The JSON sits in an XML TEXT NODE, so its angle brackets must be escaped or
 * the file is not well-formed XML and draw.io rejects it before it ever reaches
 * the JSON - reporting a JSON error about its own error page, which is a
 * memorably unhelpful way to find out.
 */
export function library(entries, provenance = null) {
  const payload = JSON.stringify(entries)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // WHAT THIS IS A LIBRARY OF, as an XML comment. draw.io ignores it, the file
  // keeps it, and a person who opens the .xml can see which drawings their
  // shapes came from. A device's version moves when its drawing does, and a
  // major bump means a slot moved or an id was renamed - so a shape placed from
  // an old library can disagree with the current drawing about where a port is.
  // The comment is the only place to say so: an mxlibrary has no metadata slot,
  // and putting it in a shape's title would put it in the shape picker.
  // roc-ops/portrayal-site#14.
  const head = provenance ? `<!--\n${String(provenance)
    .replace(/--+/g, '-')}\n-->\n` : '';
  return `${head}<mxlibrary>${payload}</mxlibrary>`;
}

/**
 * A rack diagram: draw.io's own cabinet, with devices mounted in it.
 *
 * The rails, the U numbering and the snapping are draw.io's - we do not draw a
 * rack, we fill one. `childLayout=rack` snaps a child to whole units, so a
 * device only has to be the right size and at the right U.
 */
/**
 * Rack elevations as a multi-PAGE .drawio: one page per group.
 *
 * `groups` is [{label, racks: [{label, mounted}]}]. Everything on one canvas
 * becomes a wall you navigate rather than a diagram you read, and an .mxfile
 * takes as many <diagram> elements as you give it - each is a tab along the
 * bottom of the editor.
 */
export function rackDiagram(groups, {faces = ['front'], labels = true} = {}) {
  // Each rack carries its own height, because each is grown to its contents.
  const heightOf = units => RACK.marginTop + RACK.marginBottom + units * RACK.unit;
  const style =
    `shape=mxgraph.rackGeneral.rackCabinet3;rackUnitSize=${RACK.unit};` +
    `fillColor2=#f4f4f4;container=1;collapsible=0;childLayout=rack;allowGaps=1;` +
    `marginLeft=${RACK.marginL};marginRight=${RACK.marginR};` +
    `marginTop=${RACK.marginTop};marginBottom=${RACK.marginBottom};` +
    // The label sits ABOVE the cabinet. Centred in it - the default - a name
    // long enough to be useful is wider than 180 units and runs into the rack
    // either side of it.
    `textColor=#666666;numDisp=ascend;html=1;` +
    `verticalLabelPosition=top;verticalAlign=bottom;fontSize=11;fontStyle=1;`;
  // Room for the U gutter between cabinets, and more between racks than between
  // the two sides of one rack - so a front/rear pair reads as a pair.
  const FACE_GAP = 90, RACK_GAP = 190;
  const pairWidth = faces.length * RACK.outer + (faces.length - 1) * FACE_GAP;

  // CONTENT STARTS AT THE ORIGIN. Whatever draw.io decides to scroll to when it
  // opens a file - and it is not the page's top-left, which was tried - the one
  // place it will not be looking is off past the end of an empty canvas. So the
  // first rack is at x=0 and the page is drawn tight around what is on it,
  // leaving only the headroom the cabinet's own label needs above it.
  const TOP = 30;
  const pages = groups.map((group, gi) => {
    const cells = [];
    let x = 0;
    group.racks.forEach((rack, r) => {
      const units = rack.units || 12;
      const h = heightOf(units);
      faces.forEach((face, i) => {
        const rackId = `g${gi}r${r}-${face}`;
        const fx = x + i * (RACK.outer + FACE_GAP);
        // The PAGE is named for the vendor and family, so the cabinet only
        // has to say which rack and which side.
        cells.push(cell(rackId, rack.label ? `${rack.label} · ${face}` : face,
                        style, fx, TOP, RACK.outer, h));
        for (const m of rack.mounted) {
          const f = m.faces[face];
          const ru = m.ru || 1;
          const id = `${slug(m.name)}-g${gi}r${r}-${face}`;
          // A device with nothing drawn on this side does NOT borrow the other
          // side's picture. An optical shelf that is only a front is a real
          // thing, and putting a faceplate on the back of a rack would be a
          // straightforward lie.
          //
          // It says so rather than leaving a hole, though. A rear cabinet with
          // two devices in it and nothing drawn reads as a broken export; the
          // same cabinet saying "no rear drawing" against each device reads as
          // the library being honest about what it has. The unit span is still
          // right, so the device occupies its real U either way.
          if (!f) {
            const top0 = RACK.marginTop + (m.u - 1) * RACK.unit;
            cells.push(cell(`${id}-none`, `no ${face} drawing`,
              'rounded=0;html=1;dashed=1;dashPattern=4 4;fillColor=#f0f0f0;' +
              'strokeColor=#b0b0b0;fontColor=#8a8a8a;fontSize=9;' +
              'verticalAlign=middle;align=center;movable=0;resizable=0;' +
              'editable=0;connectable=0;',
              RACK.marginL, top0, RACK.width, RACK.unit * ru, rackId));
            if (labels) {
              const ly0 = RACK.marginTop + (m.u - 1 + ru) * RACK.unit;
              cells.push(cell(`${id}-label`, `\u25B2 ${m.name}`,
                'text;html=1;strokeColor=none;fillColor=none;align=left;' +
                'verticalAlign=middle;fontSize=9;fontColor=#333333;spacingLeft=4;' +
                'movable=0;resizable=0;editable=0;connectable=0;',
                RACK.marginL, ly0, RACK.width, RACK.unit, rackId));
            }
            continue;
          }
          // Which end U1 is at follows the container's numbering, not the
          // machine room. `numDisp=ascend` prints 1 at the TOP and counts down,
          // so placing from the bottom the way a real rack is counted puts
          // every device against a number it is not in.
          const top = RACK.marginTop + (m.u - 1) * RACK.unit;
          const dh = RACK.unit * ru;
          const sub = deviceCells(id, f.svg, f.vb, f.ports, RACK.marginL, top,
                                  RACK.width, dh, {visible: false});
          // The group keeps the name as its value - Outline lists it, search
          // finds it, an edge endpoint reports it - but does not PRINT it.
          // Drawn, it lands a couple of units off its own device and collides
          // with the U numbers, and a label against the wrong number is worse
          // than none. The faceplate carries the model in silkscreen anyway.
          sub[0] = cell(id, m.name, 'group;html=1;noLabel=1;',
                        RACK.marginL, top, RACK.width, dh, rackId);
          for (let k = 1; k < sub.length; k++) {
            sub[k] = sub[k].replace(/parent="1"/, `parent="${id}"`);
          }
          cells.push(...sub);
          // NAMED IN THE GUTTER BELOW, NOT ON THE DEVICE. Printed on the device
          // the label lands a couple of units off its own faceplate and collides
          // with the U numbers, and a label against the wrong number is worse
          // than none - which is why these were suppressed. In the unit of air
          // that already sits between devices it belongs to nothing, cannot be
          // mistaken for a U number, and the arrow says which way to read it.
          // Rows of white 1RU boxes are otherwise genuinely hard to tell apart.
          if (labels) {
            const ly = RACK.marginTop + (m.u - 1 + ru) * RACK.unit;
            cells.push(cell(`${id}-label`, `▲ ${m.name}`,
              'text;html=1;strokeColor=none;fillColor=none;align=left;' +
              'verticalAlign=middle;fontSize=9;fontColor=#333333;spacingLeft=4;' +
              'movable=0;resizable=0;editable=0;connectable=0;',
              RACK.marginL, ly, RACK.width, RACK.unit, rackId));
          }
        }
      });
      x += pairWidth + RACK_GAP;
    });
    const tallest = Math.max(...group.racks.map(r => heightOf(r.units || 12)));
    // NO dx/dy. Those are draw.io's stored scroll offset, and hard-coding them
    // opened the file scrolled off its own content - the racks above the
    // viewport with a sliver of cabinet showing, which reads as an empty file
    // until you think to zoom out. Omitted, draw.io fits the page itself.
    // PAGE FRAME OFF. With page="1" draw.io opened the file scrolled past the
    // bottom of its own content - the rack feet at the top of the viewport and
    // everything else above it. Putting the content at the origin and drawing
    // the page tight around it both moved it slightly and neither fixed it, so
    // the page is what it is scrolling to rather than the drawing. With no page
    // it has nothing to scroll to but the graph, and fits that instead.
    //
    // pageWidth/pageHeight are kept: they are what a later File > Page Setup or
    // an export reads, and only `page` decides whether a frame is drawn.
    return `<diagram name="${esc(group.label)}" id="page${gi}">` +
      `<mxGraphModel grid="0" page="0" pageScale="1" ` +
      `pageWidth="${Math.ceil(x - RACK_GAP + 20)}" ` +
      `pageHeight="${Math.ceil(tallest + TOP + 20)}"><root>` +
      `<mxCell id="0"/><mxCell id="1" parent="0"/>${cells.join('')}` +
      `</root></mxGraphModel></diagram>`;
  });
  // Front and rear are NOT mirrored. Walking round a rack does reverse
  // left-to-right, but every DCIM elevation - NetBox's and Nautobot's included -
  // shows both sides in the same order, because the point of the pair is to
  // read one device across two views. Mirroring makes that a puzzle.
  return `<mxfile host="portrayal">${pages.join('')}</mxfile>`;
}

/** Fetch a compiled face and read it, once per url. */
const SEEN = new Map();
export async function loadFace(url) {
  if (!SEEN.has(url)) {
    SEEN.set(url, fetch(url).then(async r => {
      if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
      const text = await r.text();
      const {vb, zones} = readSvg(text);
      return {text, vb, zones};
    }).catch(e => { SEEN.delete(url); throw e; }));
  }
  return SEEN.get(url);
}
