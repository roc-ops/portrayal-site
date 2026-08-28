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
      key: id,
      label: occupant ? `${id} · ${shortRef(occupant)}` : id,
      occupant: occupant || null,
      ports: mine.sort(byId),
      // An empty slot is not a failure to draw something; it is the fact that
      // the slot is free, which is what somebody planning a build needs.
      slot: mine.length ? null : {accepts: (bay.accepts || []).map(shortRef)},
    });
  }
  const rest = new Map();
  for (const p of ports) {
    if (claimed.has(p)) continue;
    const seg = String(p.path || p.id).split('/');
    const k = seg.length > 1 ? seg[0] : (p.group || p.media || 'ports');
    if (!rest.has(k)) rest.set(k, {key: k, label: k, ports: [], slot: null});
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
export function miniature(name, ports, {id = 'dev', x = 0, y = 0, bays = []} = {}) {
  const bands = bandsOf(ports, bays);
  const rows = b => Math.max(1, Math.ceil(b.ports.length / 2));
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
    // A BAND IS A CONTAINER, which buys two things draw.io already knows how to
    // do. Its stubs are its children, so collapsing it folds a forty-port card
    // into one row and the symbol stops being mostly cable stubs. And an empty
    // slot being a container is what lets a module miniature be DROPPED into
    // it: draw.io reparents the shape to the slot it lands on, so the chassis
    // ends up actually holding the card rather than having one placed near it.
    //
    // Collapsed hides the stubs and with them their connection points, so
    // nothing starts collapsed except the slots that have nothing to connect
    // to. Folding a card away is a choice the reader makes.
    const style = b.slot
      ? 'rounded=0;html=1;dashed=1;dashPattern=3 3;fillColor=#22282c;' +
        'strokeColor=#454f57;fontColor=#7c848c;fontSize=8;' +
        'verticalAlign=middle;align=center;container=1;collapsible=0;' +
        'childLayout=stackLayout;horizontalStack=0;resizeParent=0;marginTop=0;'
      : 'rounded=0;html=1;fillColor=#2b3238;strokeColor=#3d464e;' +
        'fontColor=#9aa1a8;fontSize=9;verticalAlign=middle;align=center;' +
        'container=1;collapsible=1;';
    const label = b.slot
      ? `${b.key} — empty${b.slot.accepts.length
          ? ` · ${b.slot.accepts.slice(0, 2).join(' / ')}` : ''}`
      : b.label || b.key;
    const bandId = `${id}-${b.key}`;
    // alternateBounds is the size it takes when folded: one row, still labelled.
    const alt = b.slot ? ''
      : `<mxRectangle x="${STUB}" y="${cy}" width="${BODY}" height="${PITCH}" ` +
        `as="alternateBounds"/>`;
    cells.push(dataCell(bandId, label, style, STUB, cy, BODY, bh, id, {
      'portrayal-bay': b.slot || b.ports.length ? b.key : null,
      'portrayal-accepts': b.slot ? b.slot.accepts.join(', ') : null,
      'portrayal-occupant': b.occupant || null,
      tooltip: b.slot
        ? `empty slot — accepts ${b.slot.accepts.join(', ') || 'a module'}`
        : `${b.ports.length} port${b.ports.length === 1 ? '' : 's'}`,
    }, alt));

    b.ports.forEach((p, i) => {
      const right = i % 2 === 1;
      // Relative to the BAND now, so a stub folds away with its card. The left
      // column sits at a negative x, which is where it has always been drawn -
      // outside the body, on the perimeter of the symbol.
      const ry = Math.floor(i / 2) * PITCH;
      const pt = right ? 'points=[[1,0.5,0]];' : 'points=[[0,0.5,0]];';
      // A stub is a place to land a cable and nothing else: not a container,
      // not a drop target, and not something to drag out of the symbol by
      // accident. Its id and media travel with it so a diagram built from this
      // can still be joined back to the model.
      cells.push(dataCell(`${id}-${stubLabel(p)}`, stubLabel(p),
        'rounded=0;html=1;fillColor=#3a444c;strokeColor=#4d5860;' +
        `fontColor=#e4e7ea;fontSize=8;verticalAlign=middle;${pt}` +
        `align=${right ? 'left' : 'right'};spacing${right ? 'Left' : 'Right'}=3;` +
        'container=0;movable=0;resizable=0;deletable=0;connectable=1;',
        right ? BODY : -STUB, ry, STUB, PITCH, bandId, {
          'portrayal-port': p.path || p.id,
          'portrayal-media': p.media || null,
          'portrayal-speed': p.speed || null,
          tooltip: [p.media, p.speed].filter(Boolean).join(' · ') || null,
        }));
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
    const m = miniature(d.name, d.ports, {id: `m${i}`, x, y: 0, bays: d.bays});
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

/**
 * The modules as a draw.io SHAPE LIBRARY, so a free slot can be filled.
 *
 * The chassis symbol draws its empty slots; this is what goes in them. A
 * library rather than a page because that is how draw.io lets you keep shapes
 * to hand and drag one in - the same mechanism the faceplate library already
 * uses, carrying miniatures instead of images.
 */
export function moduleLibrary(modules) {
  const entries = modules.map((m, i) => {
    const {xml, w, h} = miniature(m.name, m.ports, {id: `mod${i}`});
    return {
      // A LIBRARY ENTRY IS A WHOLE MODEL, not a run of cells. The faceplate
      // library has always wrapped its cells this way; this one did not, and
      // draw.io answered by loading the file and showing an empty library
      // rather than by complaining - the same silent shrug it gives malformed
      // XML. The roots are what it parses against.
      xml: `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>` +
           `${xml}</root></mxGraphModel>`,
      w, h,
      title: m.name,
      tags: `portrayal miniature module ${m.name}`,
    };
  });
  const payload = JSON.stringify(entries)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<mxlibrary>${payload}</mxlibrary>`;
}
