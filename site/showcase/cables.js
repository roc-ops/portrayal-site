// Cables that hang. One module for both views, so the sag and the colors
// cannot differ between 2D and 3D (spec §5).
//
// WHERE A CABLE STARTS. Every end is a connector the plan seated - an LC
// plug in each of an optic's two cages, a duplex plug in a cassette's
// adapter, or an RJ45 plug in a copper jack (roc-ops/Portrayal#610) - and the
// kit's relief.js cablePoints() names the point each one leaves from. Its
// `at` is in the marker's own frame, so it is mapped through the marker's
// CTM (relief.js says to). An end whose connector is not there is loose.
//
// WHICH CABLE IS IN FRONT. A lead from a higher port hangs down in front of
// the plugs and leads below it, so in 2D the cables are painted lowest-top
// first, and in 3D a higher connector's lead reaches a little further out
// of the face before it bends.
//
// A CABLE THAT CANNOT LAND at one end hangs from the end that can as an
// unplugged lead: in 2D down past its connector to an open plug outline and
// a "not connected" tag; in 3D a tube hanging free in front of the rack.

import {cablePoints} from '../../vendor/relief.js';
import {svgEl} from './artifact.js';

// OS2 jackets are yellow; copper is colored by what it is for.
export const COLORS = {os2: '#e8c547', copper: {server: '#5aa7ff', management: '#9aa3ad'}};
export const colorOf = l => l.media === 'copper'
  ? (COLORS.copper[l.purpose] || COLORS.copper.server) : (COLORS[l.media] || COLORS.os2);

// JACKETS: what a cable's outer sheath looks like, by what it is. Multimode
// fiber and AOCs are aqua, single-mode is yellow (the same yellow as os2), a
// twinax DAC is black, and copper patch leads are blue. The front-page hero
// colors its cables by these; the showcase's plan keeps colorOf.
export const JACKETS = {mm: '#2bb3c8', sm: COLORS.os2, dac: '#15171a', cu: COLORS.copper.server};
export const colorOfJacket = j => JACKETS[j] || JACKETS.sm;

// PLUGS: what an LC plug's plastic looks like, by the fiber it carries, as in
// a real rack - single-mode UPC is blue, OM3/OM4 multimode is aqua, the same
// aqua as its jacket. The library draws every lc-plug neutral gray; the
// front-page hero recolors the plugs it seats from this table. A jacket with
// no plug color (a DAC, copper) has none to change.
export const PLUGS = {sm: '#2a6fd4', mm: JACKETS.mm};
export const plugColorOf = j => PLUGS[j] || null;

export const WIDTH = 3;          // mm: a patch lead, to scale
const MERGE = 10;                // mm below a duplex pair where the two strands join
// How far a cable hangs below the lower of its two ends: a little always, more
// the farther apart they are, and a few mm more per cable already hung between
// the same two devices, so parallel runs fan out instead of stacking.
// A tag's pitch, in mm: its pill is 18 tall (patch-view.js), plus a gap.
export const TAG_H = 20;
export const sag2d = (dist, fan = 0) => 14 + 0.3 * dist + 5 * fan;

const esc = s => (window.CSS && CSS.escape ? CSS.escape(s) : String(s));

// Is a cablePoints path a connector seated at `path`? An RJ45 plug's point
// is the occupant itself, `<path>-occupant`; an optic's LC plugs, or a duplex
// plug's two, are below it, `<path>-occupant/...`. Never `port-10-occupant`
// for `port-1`.
export const plugAt = (cp, path) => cp === `${path}-occupant` || cp.startsWith(`${path}-occupant/`);

// An end's connector points in `svg`'s user space, left to right. null when
// the end has no connector drawn. `svg` must be in the document, displayed
// and laid out: this reads getScreenCTM, which is null otherwise.
export function ends2d(svg, dev, path) {
  const g = svg.querySelector(`[data-device-ref="${esc(dev)}"]`);
  if (!g) return null;
  const inv = svg.getScreenCTM().inverse();
  const pts = cablePoints(g).filter(p => p.at && plugAt(p.path, path));
  if (!pts.length) return null;
  return pts.map(p => {
    const q = new DOMPoint(+p.at[0], +p.at[1]).matrixTransform(inv.multiply(p.el.getScreenCTM()));
    return [q.x, q.y];
  }).sort((a, b) => a[0] - b[0]);
}

const mean = ps => [ps.reduce((s, p) => s + p[0], 0) / ps.length,
                    ps.reduce((s, p) => s + p[1], 0) / ps.length];

// One end's strands: a duplex pair joins MERGE below its connectors, and the
// cable proper starts there. Returns [start, strandPaths].
function gather(pts) {
  if (pts.length < 2) return [pts[0], []];
  const [mx] = mean(pts);
  const m = [mx, Math.max(...pts.map(p => p[1])) + MERGE];
  return [m, pts.map(p => `M${p[0]} ${p[1]} C${p[0]} ${p[1] + MERGE * 0.6} ${m[0]} ${m[1] - MERGE * 0.6} ${m[0]} ${m[1]}`)];
}

const hang = (a, b, s) => `M${a[0]} ${a[1]} C${a[0]} ${Math.max(a[1], b[1]) + s} ${b[0]} ${Math.max(a[1], b[1]) + s} ${b[0]} ${b[1]}`;

function stroke(g, d, color, w) {
  g.append(svgEl('path', {d, fill: 'none', stroke: '#000', 'stroke-opacity': 0.45,
    'stroke-width': w + 1.2, 'stroke-linecap': 'round'}));
  g.append(svgEl('path', {d, fill: 'none', stroke: color, 'stroke-width': w, 'stroke-linecap': 'round'}));
}

// AN UNPLUGGED LEAD. How far it hangs below its connector: the sag of a
// 140 mm run (56 mm), and LEAD_STEP more per lead already hung from the same
// device, so their open plugs do not sit on each other. It drifts LEAD_SIDE
// outboard as it falls. Its tag is not at its free end, over the devices
// below, but in the side column with the cross-face tags, a thin leader
// line running to it.
export const LEAD_DROP = sag2d(140);
const LEAD_STEP = 8;
const LEAD_SIDE = 12;
const PLUG_W = 7, PLUG_H = 10;   // mm: the open plug outline at the free end

// The lead from `a` down to its free end, and the open plug there - a hollow
// outline, nose down, with its contacts showing: nothing is in it. Returns
// the bottom of the plug, where the leader to its tag starts.
function leadDown(g, a, color, drop, outboard) {
  const b = [a[0] + outboard * LEAD_SIDE, a[1] + drop];
  stroke(g, `M${a[0]} ${a[1]} C${a[0]} ${a[1] + drop * 0.55} ${b[0]} ${b[1] - drop * 0.45} ${b[0]} ${b[1]}`,
         color, WIDTH);
  const plug = svgEl('g', {'data-open-plug': 'true'});
  plug.append(svgEl('rect', {x: b[0] - PLUG_W / 2, y: b[1], width: PLUG_W, height: PLUG_H, rx: 1,
    fill: 'none', stroke: color, 'stroke-width': 1.2}));
  plug.append(svgEl('line', {x1: b[0] - PLUG_W / 2 + 1.5, y1: b[1] + PLUG_H - 2,
    x2: b[0] + PLUG_W / 2 - 1.5, y2: b[1] + PLUG_H - 2, stroke: color, 'stroke-width': 0.8,
    'stroke-dasharray': '0.8 0.8'}));
  g.append(plug);
  return [b[0], b[1] + PLUG_H];
}

// Every link with at least one end landing on `view`:
//   - both ends land -> a hanging cable;
//   - one lands, the other is on the other face and lands there -> a cable
//     hanging off to the side column at `edgeX`, where the tag `tag(at,
//     farEnd, link)` names the far end (spec §6: front-to-rear runs go round
//     the side);
//   - one lands, the other cannot (loose on this face, or `farLoose(i, side)`
//     says so of the other face) -> an unplugged lead hanging from the one
//     that lands, `data-loose-lead`, and a leader from its open plug to the
//     tag `looseTag(at, looseEnd, link, i)` in the same column.
// A link neither of whose ends lands here draws nothing: the panel explains.
// An end on `view` whose connectors are missing is recorded loose.
//
// Cables are painted lowest-top first (a cable's top is its highest
// connector), so a lead from a higher port is in front of the ones below
// it. EVERY TAG is then painted in one layer over all of them, stacked
// TAG_H apart in the column, each as near its cable's height as the ones
// above it allow - so no tag covers a port, a plug or another tag, and no
// cable crosses one. A tag carries its cable's data-link-index, and the
// record keeps it as `tag`.
export function drawCables2d(svg, plan, view, {edgeX, tag, looseTag, farLoose = () => false,
                                               outboard = 1}) {
  // The CABLES are the drawing, and exports keep them (standalone() drops
  // every [data-pt-ui="*"] node). The TAGS beside them are on-screen
  // controls - a cross-face button, a not-connected link to the stage that
  // fixes it - so that layer stays UI and never reaches a file.
  const layer = svgEl('g', {'data-cables': view});
  const tagLayer = svgEl('g', {'data-cable-tags': view, 'data-pt-ui': '*'});
  svg.append(layer, tagLayer);
  const fans = new Map(), leads = new Map();
  const out = [], drawn = [], column = [];
  plan.links.forEach((link, i) => {
    const sides = [['from', link.from], ['to', link.to]];
    const here = sides.filter(([, e]) => (e[2] || 'front') === view);
    const rec = {link, i, g: null, tag: null, loose: [], tagged: false, dangling: false};
    out.push(rec);
    if (!here.length) return;
    const pts = here.map(([k, e]) => [k, ends2d(svg, e[0], e[1])]);
    for (const [k, p] of pts) if (!p) rec.loose.push(k);
    const live = pts.filter(([, p]) => p);
    if (!live.length) return;
    const g = svgEl('g', {'data-cable': 'true', 'data-link-index': String(i),
      'data-media': link.media, 'data-purpose': link.purpose, tabindex: '0',
      'data-pt-ui': 'tabindex'});
    const color = colorOf(link);
    const key = [link.from[0], link.to[0]].sort().join('|');
    const starts = live.map(([, p]) => {
      const [s, strands] = gather(p);
      for (const d of strands) stroke(g, d, color, WIDTH * 0.6);
      return s;
    });
    // The other end, when only one lands: loose here, or on the other face.
    const [landedSide] = live[0];
    const [otherSide, other] = sides.find(([k]) => k !== landedSide);
    const otherHere = (other[2] || 'front') === view;
    if (starts.length === 2) {
      const fan = fans.get(key) || 0; fans.set(key, fan + 1);
      const [a, b] = starts;
      stroke(g, hang(a, b, sag2d(Math.hypot(b[0] - a[0], b[1] - a[1]), fan)), color, WIDTH);
    } else if (otherHere || farLoose(i, otherSide)) {
      const dev = sides.find(([k]) => k === landedSide)[1][0];
      const k = leads.get(dev) || 0; leads.set(dev, k + 1);
      const at = leadDown(g, starts[0], color, LEAD_DROP + LEAD_STEP * k, outboard);
      g.setAttribute('data-loose-lead', otherSide);
      rec.dangling = true;
      column.push({rec, want: at[1] + 12, place: y => {
        // The leader: thin, and dashed, from the open plug to the tag.
        g.append(svgEl('path', {'data-leader': 'true', fill: 'none', stroke: color, 'stroke-width': 0.7,
          'stroke-dasharray': '2 1.5', d: `M${at[0]} ${at[1]} C${at[0]} ${Math.max(at[1], y) + 6} `
            + `${edgeX - outboard * 30} ${y} ${edgeX} ${y}`}));
        return looseTag([edgeX, y], other, link, i);
      }});
    } else {
      const fan = fans.get(key) || 0; fans.set(key, fan + 1);
      const a = starts[0];
      rec.tagged = true;
      column.push({rec, want: a[1] + 30, place: y => {
        const b = [edgeX, y];
        stroke(g, hang(a, b, sag2d(Math.abs(b[0] - a[0]), fan)), color, WIDTH);
        return tag(b, other, link);
      }});
    }
    const t = svgEl('title', {});
    t.textContent = `${link.from[0]} ${link.from[1]} → ${link.to[0]} ${link.to[1]} · ${link.purpose}, ${link.media}`;
    g.prepend(t);
    rec.g = g;
    drawn.push({g, top: Math.min(...live.flatMap(([, p]) => p.map(q => q[1])))});
  });
  // The column, top down: each tag at its cable's height, or TAG_H below
  // the one above it, whichever is lower.
  column.sort((a, b) => a.want - b.want);
  let y = -Infinity;
  for (const c of column) {
    y = Math.max(c.want, y + TAG_H);
    const t = c.place(y);
    t.setAttribute('data-link-index', String(c.rec.i));
    t.setAttribute('data-cable-tag', 'true');
    tagLayer.append(t);
    c.rec.tag = t;
  }
  // Lowest top first; a stable sort keeps plan order between equals.
  drawn.sort((a, b) => b.top - a.top);
  for (const {g} of drawn) layer.append(g);
  return out;
}

// Which ends of the plan do not land on `view`'s drawing: [[linkIndex,
// 'from' | 'to'], ...]. The same test drawCables2d applies, without drawing,
// so the panel can judge every end against its own face whichever is shown.
export function looseOn(svg, plan, view) {
  const out = [];
  plan.links.forEach((link, i) => {
    for (const k of ['from', 'to']) {
      const e = link[k];
      if ((e[2] || 'front') === view && !ends2d(svg, e[0], e[1])) out.push([i, k]);
    }
  });
  return out;
}

// ── 3D ────────────────────────────────────────────────────────────────────
// The same cables as tubes in the mounted rack. Every end starts at the room
// points rack3d.js's cableAnchor finds for its connectors - LC, duplex LC or
// RJ45 plugs, the same cablePoints the 2D half reads.
export const LEAD = 40;           // mm straight out of a connector before it can bend
const REACH_STEP = 4;             // mm further out per row of cabled connectors below, on one face
const MERGE3D = 25;               // mm out from a duplex pair where the strands join
const SIDE_CLEAR = 45;            // mm outside the rack's right post, for front-rear runs
const CLEAR = 5;                  // mm a point pushed out of a chassis ends up past its face
const DANGLE = 150;               // mm an unplugged lead hangs below its connector
const ROW = 2;                    // mm: connectors this close in height are one row
const K = 1.2;                    // catenary shape: f(t) = (cosh(K(2t-1)) - cosh K)/(cosh K - 1)
const cat = t => (Math.cosh(K * (2 * t - 1)) - Math.cosh(K)) / (Math.cosh(K) - 1);
const sag3d = dist => 20 + 0.3 * dist;

// A hanging stretch from p to q: straight between them in x and z, and the
// catenary in y, dipping sag3d of the chord below the straight line mid-way.
function hangBetween(p, q, n = 24) {
  const s = sag3d(p.distanceTo(q));
  const out = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const v = p.clone().lerp(q, t);
    v.y += s * cat(t);
    out.push(v);
  }
  return out;
}

// Where a duplex end's strands join: MERGE3D out from the middle of the pair.
const mergeOf = (THREE, e) => e.points.reduce((s, p) => s.add(p), new THREE.Vector3())
  .multiplyScalar(1 / e.points.length).addScaledVector(e.normal, MERGE3D);

// The main run between two ends, {points, normal} each: from each end's start
// (a duplex pair's merge, or the one point) LEAD straight out, then hanging
// between. Ends on opposite faces go round the rack's right-hand side,
// outside the posts (spec §6).
// `reach` on an end, when set, replaces LEAD (see reaches).
const startOf = (THREE, e) => e.points.length > 1 ? mergeOf(THREE, e) : e.points[0].clone();
export function hangPoints3d(THREE, A, B, rackW) {
  const a = startOf(THREE, A), b = startOf(THREE, B);
  const outA = a.clone().addScaledVector(A.normal, A.reach ?? LEAD);
  const outB = b.clone().addScaledVector(B.normal, B.reach ?? LEAD);
  const pts = [a, outA];
  if (A.normal.dot(B.normal) < -0.5) {
    const x = rackW / 2 + SIDE_CLEAR;
    const sa = new THREE.Vector3(x, outA.y, outA.z), sb = new THREE.Vector3(x, outB.y, outB.z);
    pts.push(...hangBetween(outA, sa).slice(1), ...hangBetween(sa, sb).slice(1),
             ...hangBetween(sb, outB).slice(1));
  } else {
    pts.push(...hangBetween(outA, outB).slice(1));
  }
  pts.push(b);
  return pts;
}

// An unplugged lead from one end, {points, normal, reach}: straight out of
// the face as a run would, then curving down to hang DANGLE below, its free
// end a little further out still - in front of the rack, not in it.
export function danglePoints3d(THREE, E) {
  const a = startOf(THREE, E);
  const out = a.clone().addScaledVector(E.normal, E.reach ?? LEAD);
  const pts = [a, out];
  const n = 12;
  for (let k = 1; k <= n; k++) {
    const t = k / n;
    // Out a further 30 mm, easing off, while it falls ever faster.
    pts.push(out.clone().addScaledVector(E.normal, 30 * Math.sin(t * Math.PI / 2))
      .add(new THREE.Vector3(0, -DANGLE * t * t, 0)));
  }
  return pts;
}

// PART OF WHICH CABLE IS IN FRONT: on each device face, the cabled
// connectors' heights, lowest first, each row a REACH_STEP further out than
// the one below. Sets `reach` on every end ({points, normal, key}).
function reaches(THREE, ends) {
  const rows = new Map();
  const y = e => startOf(THREE, e).y;
  for (const e of ends) {
    const ys = rows.get(e.key) || [];
    if (!ys.some(v => Math.abs(v - y(e)) < ROW)) ys.push(y(e));
    rows.set(e.key, ys);
  }
  for (const ys of rows.values()) ys.sort((a, b) => a - b);
  for (const e of ends) e.reach = LEAD + REACH_STEP * rows.get(e.key).findIndex(v => Math.abs(v - y(e)) < ROW);
}

// Keep a cable out of the metal: a point inside a chassis box is pushed along
// z to CLEAR past whichever of that box's front and rear faces is nearer.
export function clearOf(pts, boxes) {
  for (const p of pts) for (const {box} of boxes) {
    if (!box.containsPoint(p)) continue;
    p.z = box.max.z - p.z <= p.z - box.min.z ? box.max.z + CLEAR : box.min.z - CLEAR;
  }
  return pts;
}

// The world centers of a tube mesh's first and last rings of vertices - where
// the drawn tube actually begins and ends, read off its geometry.
function tubeEnds(THREE, mesh) {
  const pos = mesh.geometry.attributes.position;
  const {tubularSegments: n, radialSegments: r} = mesh.geometry.parameters;
  mesh.updateMatrixWorld(true);
  return [0, n * (r + 1)].map(first => {
    const c = new THREE.Vector3();
    // r distinct vertices: the ring's (r+1)th repeats its first, for the seam.
    for (let j = 0; j < r; j++) c.add(new THREE.Vector3().fromBufferAttribute(pos, first + j));
    return mesh.localToWorld(c.multiplyScalar(1 / r));
  });
}

// Every link of the plan as a tube in `scene` (rack3d.js's scene API). Returns
// {tubes, anchors, boxes, group}: per link {link, i, mesh, loose, points,
// starts} - `loose` naming the sides that did not land; with one of them
// landed, mesh is an unplugged lead hanging from it (`dangling`, its points
// from the landed end); with neither, mesh is null. `starts` are the drawn
// ends of its tubes. Plus every connector anchored, and the chassis boxes
// the run was kept out of. null when `live()` went false during an await.
export async function drawCables3d(scene, plan, {live = () => true} = {}) {
  const {THREE, scene: world} = scene.three;
  const rackW = scene.metrics().rackWidth;
  const boxes = scene.deviceBoxes();
  const refOf = id => (plan.devices || []).find(d => d.id === id)?.ref || id;
  const group = new THREE.Group(); group.name = 'patch-cables';
  const tubes = [], anchors = [];
  // Every end's connectors first: how far a lead reaches out depends on the
  // other cabled connectors on its face.
  const found = [];
  for (const [i, link] of plan.links.entries()) {
    const ends = [], loose = [];
    for (const [side, [dev, path, view]] of [['from', link.from], ['to', link.to]]) {
      const got = await scene.cableAnchor({ref: refOf(dev)}, path, {view: view || 'front'});
      if (!live()) return null;
      const e = got.length ? {points: got.map(g => g.position), normal: got[0].normal,
                              key: `${dev}|${view || 'front'}`} : null;
      for (const g of got) anchors.push({i, side, anchor: g});
      if (!e) loose.push(side);
      ends.push(e);
    }
    found.push({link, i, ends, loose});
  }
  reaches(THREE, found.flatMap(f => f.ends.filter(Boolean)));
  for (const {link, i, ends, loose} of found) {
    if (loose.length === 2) { tubes.push({link, i, mesh: null, loose, points: [], starts: []}); continue; }
    const landed = ends.filter(Boolean);
    const dangling = landed.length === 1;
    const pts = clearOf(dangling ? danglePoints3d(THREE, landed[0])
                                 : hangPoints3d(THREE, ends[0], ends[1], rackW), boxes);
    const mat = new THREE.MeshStandardMaterial({color: colorOf(link), roughness: 0.6});
    const g = new THREE.Group(); g.name = `cable-${i}`;
    const main = new THREE.Mesh(new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3(pts, false, 'centripetal'), dangling ? 60 : 160, WIDTH / 2, 8, false), mat);
    g.add(main);
    // A duplex end: a thinner strand from each connector into the merge.
    const strands = [];
    for (const e of landed) if (e.points.length > 1) {
      const m = mergeOf(THREE, e);
      for (const p of e.points) {
        const s = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(
          [p, p.clone().addScaledVector(e.normal, 12), m]), 16, WIDTH * 0.3, 6, false), mat);
        g.add(s); strands.push(s);
      }
    }
    group.add(g);
    // Where each connector's run begins, measured off the drawn geometry: a
    // strand's first ring, or the main tube's first or last.
    const starts = [...tubeEnds(THREE, main), ...strands.map(s => tubeEnds(THREE, s)[0])];
    tubes.push({link, i, mesh: g, loose, points: pts, starts, dangling});
  }
  world.add(group);
  return {tubes, anchors, boxes, group};
}
