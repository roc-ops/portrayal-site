/**
 * A device as a SCHEMATIC: drawn for connecting, not for where things are.
 *
 * The compiled drawing is a FOOTPRINT - true millimetres, every part where it
 * really is. That is the right picture for a rack elevation and the wrong one
 * for a topology, where what you need is "how many ports, of what kind, and
 * let me draw a cable to one". Electronics has meant exactly these two words
 * for decades: one component, drawn once where it physically sits and once for
 * connecting. Naming them the same way is the shortest explanation available -
 * anyone who has drawn a circuit already knows what to expect.
 *
 * It was called a "miniature" first, which was wrong: this is not a smaller
 * version of the drawing, it is a different drawing of the same device.
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

// A STUB IS AS WIDE AS ITS DEVICE'S LONGEST NAME. At a fixed 46 an AIS800's
// `mgmt-inband-1` ran past its stub into the body, and a C100G's `psu-monitor`
// was cut off by the symbol's own edge - a name you cannot read is a port you
// cannot pick. 5 px a character is a generous width for draw.io's 8 px
// Helvetica, and every stub on a device takes the same width so the edges stay
// straight. 46 stays the floor.
const CHAR = 5, INSET = 8;
const stubWidth = labels =>
  Math.max(STUB, Math.ceil(Math.max(0, ...labels.map(l => l.length)) * CHAR + INSET));

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * A cell that CARRIES WHAT THE MODEL KNOWS, not just what it looks like.
 *
 * draw.io cannot be told from a file which shapes a container will accept -
 * `container`, `collapsible` and `childLayout` are all it has, and none of them
 * restricts by type. Enforcing "this slot takes a BDM" needs the Extension API
 * and a plugin, which is not something an exported file can ask for.
 *
 * What a file CAN do is carry the constraint. Custom attributes on an <object>
 * survive a round trip, show in Edit Data, and can be read back - so a diagram
 * someone builds from these can be checked against the library afterwards even
 * though draw.io let them put anything anywhere while they were drawing.
 */
const dataCell = (id, value, style, x, y, w, h, parent, data = {}, extra = '') => {
  const attrs = Object.entries(data)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
  return `<object label="${esc(value)}"${attrs} id="${esc(id)}">` +
    `<mxCell style="${style}" vertex="1" parent="${esc(parent)}">` +
    `<mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry">` +
    `${extra}</mxGeometry></mxCell></object>`;
};

const cell = (id, value, style, x, y, w, h, parent = '1') =>
  `<mxCell id="${esc(id)}" value="${esc(value)}" style="${style}" vertex="1" ` +
  `parent="${esc(parent)}"><mxGeometry x="${x}" y="${y}" width="${w}" ` +
  `height="${h}" as="geometry"/></mxCell>`;

/** Natural sort, so port-2 comes before port-10. */
const byId = (a, b) => String(a.id).localeCompare(String(b.id), undefined,
                                                 {numeric: true});

const shortRef = r => String(r || '').split('/').pop().split('@')[0];

/**
 * Split a device into the bands the symbol draws.
 *
 * A CHASSIS SHOWS EVERY SLOT, NOT EVERY POPULATED SLOT. This is the difference
 * between a symbol you can plan with and a picture of one particular build. A
 * C100G has fourteen front slots; the default configuration seats modules in
 * two of them, so banding by "bays that have ports" drew a fourteen-slot chassis
 * as a two-slot one. The other twelve are where the rest of the line cards go,
 * and somewhere to put them is the entire reason to draw the chassis small.
 *
 * So bays come from the compiled index, in declared order, and a bay with
 * nothing in it is drawn as an empty slot saying what it accepts. Ports are
 * matched to their bay by path - an MX960's are already `fpc0/module/port-3` -
 * which is also what makes a swapped card follow its band without this code
 * knowing what a card is.
 *
 * Ports belonging to no bay - a fixed-config box's, or a chassis's own
 * management - band by the port group the model declares.
 */
export function bandsOf(ports, bays = []) {
  const bands = [];
  const claimed = new Set();
  for (const bay of bays) {
    const id = bay.id;
    const mine = ports.filter(p => String(p.path || p.id).startsWith(`${id}/`));
    mine.forEach(p => claimed.add(p));
    // A blank faceplate is what a free slot ships with, not something in it.
    // Naming it would make twelve empty slots read as twelve fitted modules.
    const occ = bay.occupant || bay.default;
    const occupant = /blank|filler/i.test(shortRef(occ)) ? null : occ;
    bands.push({
      isBay: true,
      face: bay.face || null,
      key: id,
      label: occupant ? `${id} · ${shortRef(occupant)}` : id,
      occupant: occupant || null,
      ports: mine.sort(byId),
      // EMPTY MEANS NOTHING IS SEATED, not that nothing was drawn. Deciding it
      // from the port count called a slot empty when it held a card with no
      // ports on this face - which several do: a DOCSIS US 16X8 does its work
      // on the RF side and shows nothing on the front. Saying "empty, accepts
      // bdm / bdm2" about a slot with a card in it is worse than saying
      // nothing, because somebody planning a build would fill it twice.
      slot: occupant ? null : {accepts: (bay.accepts || []).map(shortRef)},
    });
  }
  const rest = new Map();
  for (const p of ports) {
    if (claimed.has(p)) continue;
    const seg = String(p.path || p.id).split('/');
    const k = seg.length > 1 ? seg[0] : (p.group || p.media || 'ports');
    if (!rest.has(k)) rest.set(k, {key: k, label: k, ports: [], slot: null,
                                   face: p.face || null});
    rest.get(k).ports.push(p);
  }
  for (const b of rest.values()) b.ports.sort(byId);
  return [...rest.values(), ...bands];
}

/** The label a stub carries: the last path segment, which is the port's own name. */
const stubLabel = p => String(p.path || p.id).split('/').pop();

/**
 * One device as draw.io cells.
 *
 * Returns {xml, w, h}. Ports alternate left and right down each band, so a
 * forty-port card is twenty rows rather than forty, and both edges get used.
 */
export function schematic(name, ports, {id = 'dev', x = 0, y = 0, bays = [],
                                        showEmpty = false} = {}) {
  // ONLY WHAT YOU CAN CONNECT TO. A band with no stubs is a row of nothing: an
  // empty slot, or a card that does its work on the other side of the chassis.
  // Both were noise in a symbol whose whole purpose is being cabled, and on a
  // C100G they were most of it - 22 of 33 bands. Where a card can go is a
  // question the configuration answers; this is the answer, not the form.
  const all = bandsOf(ports, bays);
  const bands = showEmpty ? all : all.filter(b => b.ports.length);

  // ONE COLUMN. Splitting the symbol by face was a misread of a complaint about
  // the configurator's slot list, and it costs something real: with two columns
  // the inner stubs route their cables through the gutter between them rather
  // than straight out, which is the one thing the shape exists to avoid. Bands
  // are ordered front then rear and carry their face as data; a bay id says
  // which side it is on anyway.
  const bandsByFace = [...new Set(bands.map(b => b.face).filter(Boolean))];
  bands.sort((a, b) => bandsByFace.indexOf(a.face) - bandsByFace.indexOf(b.face));

  const rows = b => Math.max(1, Math.ceil(b.ports.length / 2));
  const bodyH = bands.reduce((a, b) => a + rows(b) * PITCH + PAD, 0);
  const h = HEAD + bodyH + PAD;
  const stub = stubWidth(bands.flatMap(b => b.ports.map(stubLabel)));
  const w = stub + BODY + stub;
  const cells = [];

  cells.push(cell(id, name,
    'rounded=1;arcSize=6;html=1;fillColor=#1f2529;strokeColor=#0f1316;' +
    'fontColor=#e4e7ea;fontSize=11;fontStyle=1;verticalAlign=top;' +
    'spacingTop=4;container=1;collapsible=0;',
    x, y, w, h));

  let cy = HEAD;
  for (const b of bands) {
    const bh = rows(b) * PITCH;
    const style = b.slot
      ? 'rounded=0;html=1;dashed=1;dashPattern=3 3;fillColor=#22282c;' +
        'strokeColor=#454f57;fontColor=#7c848c;fontSize=8;' +
        'verticalAlign=middle;align=center;container=0;collapsible=0;'
      : 'rounded=0;html=1;fillColor=#2b3238;strokeColor=#3d464e;' +
        'fontColor=#9aa1a8;fontSize=9;verticalAlign=middle;align=center;' +
        'container=1;collapsible=0;';
    const label = b.slot
      ? `${b.key} — empty${b.slot.accepts.length
          ? ` · ${b.slot.accepts.slice(0, 2).join(' / ')}` : ''}`
      : b.ports.length ? (b.label || b.key)
      : `${b.label || b.key} — no ports on this face`;
    const bandId = `${id}-${b.key}`;
    // NOTHING COLLAPSES. A band folded to one row, and its siblings stayed
    // exactly where they were - draw.io shrinks the cell and does not reflow
    // what is around it, so collapsing bought a gap rather than a smaller
    // symbol. A control that hides your connection points and saves no space is
    // worse than no control. The band stays a container so its stubs travel
    // with it when it is moved; it is simply not foldable.
    const alt = '';
    cells.push(dataCell(bandId, label, style, stub, cy, BODY, bh, id, {
      'portrayal-bay': b.isBay ? b.key : null,
      'portrayal-face': b.face || null,
      'portrayal-accepts': b.slot ? b.slot.accepts.join(', ') : null,
      'portrayal-occupant': b.occupant || null,
      tooltip: b.slot
        ? `empty slot — accepts ${b.slot.accepts.join(', ') || 'a module'}`
        : `${b.ports.length} port${b.ports.length === 1 ? '' : 's'}`
          + (b.face ? ` · ${b.face}` : ''),
    }, alt));

    b.ports.forEach((p, i) => {
      const onRight = i % 2 === 1;
      const ry = Math.floor(i / 2) * PITCH;
      // A CABLE COMES IN FROM OUTSIDE, whichever way it was drawn. `points`
      // alone only holds a cable dropped on the point itself, which is what
      // the UI pins; one dropped on the stub's body, or written by a script
      // without entryX, floats - and draw.io's orthogonal router then took it
      // down through the device and onto the stub's top edge. `portConstraint`
      // names the side it may arrive on, so a floating cable ends where a
      // pinned one does.
      const pt = onRight ? 'points=[[1,0.5,0]];portConstraint=east;'
                         : 'points=[[0,0.5,0]];portConstraint=west;';
      cells.push(dataCell(`${id}-${b.key}-${stubLabel(p)}`, stubLabel(p),
        'rounded=0;html=1;fillColor=#3a444c;strokeColor=#4d5860;' +
        `fontColor=#e4e7ea;fontSize=8;verticalAlign=middle;${pt}` +
        `align=${onRight ? 'left' : 'right'};` +
        `spacing${onRight ? 'Left' : 'Right'}=3;` +
        'container=0;movable=0;resizable=0;deletable=0;connectable=1;',
        onRight ? BODY : -stub, ry, stub, PITCH, bandId, {
          'portrayal-port': p.path || p.id,
          'portrayal-media': p.media || null,
          'portrayal-speed': p.speed || null,
          'portrayal-face': p.face || b.face || null,
          tooltip: [p.media, p.speed].filter(Boolean).join(' · ') || null,
        }));
    });
    cy += bh + PAD;
  }
  return {xml: cells.join(''), w, h};
}

/** A whole page of schematics, laid out in a row. */
export function schematicPage(devices, {label = 'Schematics'} = {}) {
  const GAP = 60;
  let x = 0, tallest = 0;
  const parts = devices.map((d, i) => {
    const m = schematic(d.name, d.ports, {id: `m${i}`, x, y: 0, bays: d.bays});
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
