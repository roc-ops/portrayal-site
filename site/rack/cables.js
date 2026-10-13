// Cables that hang. One module for both views, so the sag and the colors
// cannot differ between 2D and 3D (spec §5) - and one module for the showcase
// and the Rack Builder, so a cable hangs the same way in both. It lived in
// site/showcase/ until the Rack Builder needed it (rack builder spec §10);
// site/showcase/cables.js re-exports it for the showcase and the hero.
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

//
// THE GEOMETRY IS THE KIT'S (@portrayal/kit 0.3.0, kit/rack/cable-geometry.js):
// the colour, jacket and plug tables, the 2D sag and the 3D point lists. This
// module keeps the drawing - SVG paths and three.js tubes - and re-exports the
// geometry's public names, so `./cables.js` and site/showcase/cables.js, which
// re-exports this module, answer exactly as they did before the move.

import {cablePoints} from '../../vendor/relief.js';
import {svgEl} from './dom.js';
import {OPENING} from '../../vendor/rack/rails.js';
import {arcPath} from './bend2d.js';
import {reverseMarks} from '../../vendor/rack/route.js';
import {colorOf, WIDTH, TAG_H, sag2d, LEAD_DROP, mergeOf, routePoints3d, hangPoints3d,
        danglePoints3d, reaches, clearOf} from '../../vendor/rack/cable-geometry.js';
import {kitRoute, insideOf} from './bend3d.js';


export {COLORS, colorOf, JACKETS, colorOfJacket, PLUGS, plugColorOf, WIDTH, TAG_H, sag2d,
        LEAD_DROP, LEAD, routePoints3d, hangPoints3d, danglePoints3d, clearOf} from '../../vendor/rack/cable-geometry.js';

const MERGE = 10;                // mm below a duplex pair where the two strands join

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

// AN UNPLUGGED LEAD (LEAD_DROP, its drop, is in the kit's cable-geometry.js):
// LEAD_STEP more per lead already hung from the same device, so their open
// plugs do not sit on each other, drifting LEAD_SIDE outboard as it falls.
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
// `bendOf(link)` is the cable's bend radius in mm (bend3d.js radiusOf): a routed
// cable's corners are arcs of it (bend2d.js arcPath), or the small cut of old
// where it gives null.
// `ends(svg, dev, path)` finds an end's connector points; it defaults to
// ends2d, which looks a device up by its ref. The Rack Builder passes its
// own (cable-view.js), which looks an item up by its id and panel.
export function drawCables2d(svg, plan, view, {edgeX, tag, looseTag, farLoose = () => false,
                                               outboard = 1, ends = ends2d, bendOf = () => null}) {
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
    const pts = here.map(([k, e]) => [k, ends(svg, e[0], e[1])]);
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
      const via = link.via2d?.[view], rings = link.rings2d?.[view];
      // via2d = [] is the kit's free span with no point between the plugs (a
      // straight run, cable-view.js freeSpan2d); no via2d at all is the old hang.
      stroke(g, via?.length ? arcPath([a, ...via, b], bendOf(link), rings ? [null, ...rings, null] : null).d
        : via ? `M${a[0]} ${a[1]} L${b[0]} ${b[1]}`
        : hang(a, b, sag2d(Math.hypot(b[0] - a[0], b[1] - a[1]), fan)), color, WIDTH);
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
      // via2d runs from the plan's `from` end; a is the end that landed here.
      const via = link.via2d?.[view];
      if (via?.length) {
        // A ROUTED cross-face cable stops at its last waypoint (spec §7): it
        // does not cross the face to the side column. Its tag sits just
        // outboard of that gutter point.
        // Its ring marks (link.rings2d, turned to this pane by its caller)
        // reverse with it: a ring passed from the far end is passed the other way.
        const v = landedSide === 'from' ? via : [...via].reverse();
        const rv = link.rings2d?.[view], rings = rv && (landedSide === 'from' ? rv : reverseMarks(rv));
        const last = v[v.length - 1], dir = last[0] < OPENING / 2 ? -1 : 1;
        column.push({rec, want: last[1], lane: dir, place: y => {
          stroke(g, arcPath([a, ...v], bendOf(link), rings ? [null, ...rings] : null).d, color, WIDTH);
          return tag([last[0] + dir * 6, y], other, link);
        }});
      } else column.push({rec, want: a[1] + 30, place: y => {
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
  const gutterY = new Map();          // routed tags stack per gutter, apart from the column
  for (const c of column) {
    let at;
    if (c.lane) { at = Math.max(c.want, (gutterY.get(c.lane) ?? -Infinity) + TAG_H); gutterY.set(c.lane, at); }
    else at = y = Math.max(c.want, y + TAG_H);
    const t = c.place(at);
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
//
// `anchor(dev, path, view)` finds an end's connector points, as
// [{position, normal}, ...] or [] for an end that does not land; it defaults
// to the scene's cableAnchor on the mount of the plan device's ref, which is
// what the showcase needs. The Rack Builder passes its own (scene3d.js),
// which finds a mount by item id. A link that carries an `id` names its group
// `cable-<id>`; one without (the showcase's) keeps `cable-<index>`.
// `boxes`, when given, are the bodies to keep a hanging cable out of
// ([{ref, box}], world THREE.Box3): the Rack Builder passes the kit's solid
// bodies (scene3d.js solidBoxes); without them, the scene's device boxes.
// `waypoints(link)`, when given, gives a routed cable's points: a list (the
// showcase's waypoints, eased by routePoints3d), or {points, kit: true}, the
// kit's own path points between its two reach points (route.js routePath,
// world Vector3s: the Rack Builder's, scene3d.js), drawn as they are.
// `bendOf(link)`, when given, is the installed bend radius in mm the routed
// tube's corners are rounded to (bend3d.js roundedCurve; the cable types'
// radius, or its bundle's), or null when not known. With it, a routed tube
// is the polyline - each plug's lead, the kit's points - with each corner a
// true arc of that radius kept out of `boxes` (bend3d.js kitRoute,
// clearCurve), and its `tight` lists the corners whose legs could not hold
// one (bend3d.js fitCorners). Without it the corners are eased.
export async function drawCables3d(scene, plan, {live = () => true, anchor = null, waypoints = null, boxes = null,
                                                 bendOf = null} = {}) {
  const {THREE, scene: world} = scene.three;
  const rackW = scene.metrics().rackWidth;
  boxes ??= scene.deviceBoxes();
  const refOf = id => (plan.devices || []).find(d => d.id === id)?.ref || id;
  const find = anchor || ((dev, path, view) => scene.cableAnchor({ref: refOf(dev)}, path, {view}));
  const group = new THREE.Group(); group.name = 'patch-cables';
  const tubes = [], anchors = [];
  // Every end's connectors first: how far a lead reaches out depends on the
  // other cabled connectors on its face.
  const found = [];
  for (const [i, link] of plan.links.entries()) {
    const ends = [], loose = [];
    for (const [side, [dev, path, view]] of [['from', link.from], ['to', link.to]]) {
      const got = await find(dev, path, view || 'front');
      if (!live()) return null;
      const e = got.length ? {points: got.map(g => g.position), normal: got[0].normal,
                              key: `${dev}|${view || 'front'}`, item: dev} : null;
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
    // `waypoints(link)` gives the points, or {points, marks}: the ring marks
    // (route.js ringMarks, in the scene's axes, dropped in step with the
    // points), so each ring is passed through along its run as it was measured.
    const got = !dangling && waypoints ? await waypoints(link) : [];
    if (!live()) return null;
    const wps = Array.isArray(got) ? got : got?.points ?? [];
    const marks = Array.isArray(got) ? null : got?.marks?.length === wps.length ? got.marks : null;
    // A ROUTED cable follows the kit's path, which already goes round every
    // solid body (kit 0.11.0, #949), so nothing pushes it about: clearOf is
    // for the hangs and the unplugged leads only, and a routed tube that
    // still meets metal is a drawing fault the browser check finds.
    // The kit's FREE span (`got.free`: no waypoint, no detour) is drawn on the
    // kit's points too, which are the span as it hangs and what its length is
    // measured on (portrayal-site#178); it is not a routed cable.
    const kitDrawn = !dangling && got?.kit === true;
    const routed = !dangling && wps.length > 0 && !got?.free;
    let pts, bent = null, extended = null, reachGap = null;
    if (kitDrawn) {
      // THE KIT'S PATH (portrayal-site#166): its points are the drawing, from
      // each plug's reach point, which is where the tube leaves its connector
      // (route-context.js passes the plug's cable-point z as plugReachOf), so
      // the drawn tube goes round what the measured path goes round and
      // through each ring as the kit entered it. With a radius each corner is
      // a true arc kept out of the solids, ring parts included (kitRoute).
      const R = bendOf ? bendOf(link) : null;
      // how far the tube's start is from the kit's reach point, each end (mm)
      reachGap = (got.reach ?? []).map((q, k) => (q ? q.distanceTo(ends[k].points.reduce((s, p) => s.add(p), new THREE.Vector3())
        .multiplyScalar(1 / ends[k].points.length)) : null));
      if (R != null) ({pts, bent, extended_mm: extended} = kitRoute(THREE, ends[0], ends[1], wps, R, insideOf(boxes)));
      else {
        const e0 = ends[0].points, e1 = ends[1].points;
        const mean = ps => ps.reduce((q, p) => q.add(p), new THREE.Vector3()).multiplyScalar(1 / ps.length);
        pts = [mean(e0), ...wps, mean(e1)];
      }
    } else if (routed) {
      const R = bendOf ? bendOf(link) : null;
      const lead = R != null ? Math.max(30, R) : 30;
      pts = routePoints3d(THREE, ends[0], ends[1], wps, lead, marks);
    } else pts = clearOf(dangling ? danglePoints3d(THREE, landed[0]) : hangPoints3d(THREE, ends[0], ends[1], rackW), boxes);
    const mat = new THREE.MeshStandardMaterial({color: colorOf(link), roughness: 0.6});
    const g = new THREE.Group(); g.name = `cable-${link.id ?? i}`;
    // A rounded tube is sampled about every 3 mm, so each arc is drawn as one.
    const main = new THREE.Mesh(bent
      ? new THREE.TubeGeometry(bent, Math.max(160, Math.ceil(bent.getLength() / 3)), WIDTH / 2, 8, false)
      : new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'centripetal'), dangling ? 60 : 160, WIDTH / 2, 8, false), mat);
    g.add(main);
    // A duplex end: a thinner strand from each connector into the merge.
    const strands = [];
    for (const e of landed) if (e.points.length > 1) {
      // into where the tube starts: the kit's path starts at the pair's middle,
      // at the plugs' far end; an eased route starts at mergeOf
      const kit = kitDrawn, m = kit ? pts[e === ends[0] ? 0 : pts.length - 1] : mergeOf(THREE, e);
      for (const p of e.points) {
        const s = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(
          kit ? [p, m] : [p, p.clone().addScaledVector(e.normal, 12), m]), 16, WIDTH * 0.3, 6, false), mat);
        g.add(s); strands.push(s);
      }
    }
    group.add(g);
    // Where each connector's run begins, measured off the drawn geometry: a
    // strand's first ring, or the main tube's first or last.
    const starts = [...tubeEnds(THREE, main), ...strands.map(s => tubeEnds(THREE, s)[0])];
    // The corners this drawing rounded tighter than the radius (bend3d.js):
    // its own account of its arcs, kept as `tight` and ringed nowhere. The
    // warning rings are the kit's tight bends, drawn by the Rack Builder
    // (scene3d.js ringBends, kit 0.17.0).
    const tight = bent ? bent.corners.filter(c => c.short_mm > 0) : [];
    tubes.push({link, i, mesh: g, loose, points: pts, starts, dangling, routed, ...(reachGap ? {reachGap} : {}),
                ...(bent ? {bend: {radius_mm: bent.radius, corners: bent.corners, length_mm: bent.getLength(),
                                   polyline_mm: bent.polyline, extended_mm: extended}, tight} : {})});
  }
  world.add(group);
  return {tubes, anchors, boxes, group};
}
