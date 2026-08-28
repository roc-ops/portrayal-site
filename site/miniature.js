/**
 * A device as a MINIATURE: the schematic symbol, not the footprint.
 *
 * The compiled drawing is a footprint - true millimetres, every part where it
 * really is. That is the right picture for a rack elevation and the wrong one
 * for a topology, where what you need is "how many ports, of what kind, and
 * let me draw a cable to one". Electronics has had this split for decades: a
 * part has a footprint for the board and a SYMBOL for the schematic, with pins
 * arranged for legibility rather than position. Nobody confuses the two.
 *
 * There is no standard for this in networking. ISO 14617 and IEC 60617 cover
 * diagram symbols generally, tried to merge in the late 1990s, and abandoned
 * it; neither reaches port-level network equipment. So every vendor draws its
 * own, and they all arrive at the same shape - a compact block with the ports
 * as stubs around the edge. This generates that shape from the model.
 *
 * WHAT THE SYMBOL MAY THROW AWAY, AND WHAT IT MAY NOT. Position is a layout
 * convenience here and can go. Identity cannot: every stub keeps the port's own
 * id, so a cable drawn to it is drawn to a thing the model can name. A pretty
 * symbol whose ports are anonymous would be worth nothing to this project.
 *
 * EVERY CONNECTION POINT IS ON THE OUTSIDE EDGE. That is the point of the
 * exercise rather than a detail of it: a cable to a port in the middle of a
 * faceplate has to cross the device to get there, and every such cable makes
 * the diagram worse. Stubs on the perimeter give clean routing for free.
 */

// A stub is one port. The pitch is a rack unit's worth of room, which is about
// the smallest a label stays readable at 100%.
const PITCH = 16, STUB = 46, BODY = 150, HEAD = 26, PAD = 6;

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const cell = (id, value, style, x, y, w, h, parent = '1') =>
  `<mxCell id="${esc(id)}" value="${esc(value)}" style="${style}" vertex="1" ` +
  `parent="${esc(parent)}"><mxGeometry x="${x}" y="${y}" width="${w}" ` +
  `height="${h}" as="geometry"/></mxCell>`;

/** Natural sort, so port-2 comes before port-10. */
const byId = (a, b) => String(a.id).localeCompare(String(b.id), undefined,
                                                 {numeric: true});

/**
 * Split ports into the bands the symbol draws.
 *
 * A modular chassis says which bay a port is on in its own path - an MX960's
 * ports are `fpc0/module/port-3` - so the bands are the bays, and swapping a
 * card changes the band without the generator knowing anything about cards. A
 * fixed-config box has no bays, so it bands by the port group the model already
 * declares, which is what puts the four SFP+ in one row and the RJ45s in
 * another rather than in one undifferentiated column of forty.
 */
export function bandsOf(ports) {
  const bands = new Map();
  const key = p => {
    const seg = String(p.path || p.id).split('/');
    if (seg.length > 1) return seg[0];              // the bay it is seated in
    return p.group || p.media || 'ports';
  };
  for (const p of ports) {
    const k = key(p);
    if (!bands.has(k)) bands.set(k, {key: k, ports: []});
    bands.get(k).ports.push(p);
  }
  for (const b of bands.values()) b.ports.sort(byId);
  return [...bands.values()];
}

/** The label a stub carries: the last path segment, which is the port's own name. */
const stubLabel = p => String(p.path || p.id).split('/').pop();

/**
 * One device as draw.io cells.
 *
 * Returns {xml, w, h}. Ports alternate left and right down each band, so a
 * forty-port card is twenty rows rather than forty, and both edges get used.
 */
export function miniature(name, ports, {id = 'dev', x = 0, y = 0} = {}) {
  const bands = bandsOf(ports);
  const rows = b => Math.ceil(b.ports.length / 2);
  const bodyH = bands.reduce((a, b) => a + rows(b) * PITCH + PAD, 0);
  const h = HEAD + bodyH + PAD;
  const w = STUB + BODY + STUB;
  const cells = [];

  cells.push(cell(id, name,
    'rounded=1;arcSize=6;html=1;fillColor=#1f2529;strokeColor=#0f1316;' +
    'fontColor=#e4e7ea;fontSize=11;fontStyle=1;verticalAlign=top;' +
    'spacingTop=4;container=1;collapsible=0;',
    x, y, w, h));

  let cy = HEAD;
  for (const b of bands) {
    const bh = rows(b) * PITCH;
    cells.push(cell(`${id}-${b.key}`, b.key,
      'rounded=0;html=1;fillColor=#2b3238;strokeColor=#3d464e;' +
      'fontColor=#9aa1a8;fontSize=9;verticalAlign=middle;align=center;',
      STUB, cy, BODY, bh, id));
    b.ports.forEach((p, i) => {
      const right = i % 2 === 1;
      const ry = cy + Math.floor(i / 2) * PITCH;
      // The connection point sits on the OUTER edge of the stub, so a cable
      // leaves the symbol without crossing it.
      const pt = right ? 'points=[[1,0.5,0]];' : 'points=[[0,0.5,0]];';
      cells.push(cell(`${id}-${stubLabel(p)}`, stubLabel(p),
        'rounded=0;html=1;fillColor=#3a444c;strokeColor=#4d5860;' +
        `fontColor=#e4e7ea;fontSize=8;verticalAlign=middle;${pt}` +
        `align=${right ? 'left' : 'right'};spacing${right ? 'Left' : 'Right'}=3;`,
        right ? STUB + BODY : 0, ry, STUB, PITCH, id));
    });
    cy += bh + PAD;
  }
  return {xml: cells.join(''), w, h};
}

/** A whole page of miniatures, laid out in a row. */
export function miniaturePage(devices, {label = 'Miniatures'} = {}) {
  const GAP = 60;
  let x = 0, tallest = 0;
  const parts = devices.map((d, i) => {
    const m = miniature(d.name, d.ports, {id: `m${i}`, x, y: 0});
    x += m.w + GAP;
    tallest = Math.max(tallest, m.h);
    return m.xml;
  });
  return `<mxfile host="portrayal"><diagram name="${esc(label)}" id="mini">` +
    `<mxGraphModel grid="0" page="0" pageScale="1" ` +
    `pageWidth="${Math.ceil(x - GAP + 20)}" pageHeight="${Math.ceil(tallest + 20)}">` +
    `<root><mxCell id="0"/><mxCell id="1" parent="0"/>${parts.join('')}` +
    `</root></mxGraphModel></diagram></mxfile>`;
}
