// THE RACK BUILDER'S 3D VIEW. A thin adapter over rack3d.js's createRackScene,
// the same one the showcase mounts (site/showcase/rack.js's mount3d) - one
// source, several views, and a swap in the side panel reaches both.
//
// This module owns none of the page's state: it is handed a rack and a way
// to look up a device's physical size, and it hands back a built scene (or
// null) for the page to hold onto, rebuild and dispose.

import {el} from './dom.js';
import {cableFacts, UNCHECKED} from './cable-plugs.js';
import {mergeSeats, cablePlan3d, endKey} from './cable-rules.js';
import {drawCables3d} from './cables.js';
import {laneX} from './route.js';
import {RU} from './rails.js';

const NO_WEBGL = "3D isn't available in this browser, so the rack is shown in 2D only.";

// THE RACK'S CABLES AS TUBES (Phase 2b ruling 5), drawn once the devices are
// built. An end is found on the mount of its own item (rack3d.js findMounted
// by id: two items can share a ref) and on the device's own panel:
//   - an end the page calls loose (cable-plugs.js: an empty cage, a removed
//     device) does not land, so 2D and 3D agree on which cables hang free;
//   - an end with a plug or a DAC end seated lands on its cable points;
//   - any other end lands on the center of its port, as it does in 2D.
// Where a route's waypoints are in the room. A ring, duct or pass by its
// drawing (guideAnchor, which tries the ring's own components and the guide
// and pass rects); a lane LANE_GAP/2 outside the posts at the U's middle.
// Cables that share a waypoint are spread on a small grid so their tubes do
// not overlap.
const SPREAD = 6;   // mm between cables sharing a waypoint
function waypointsFor(scene, routes, THREE) {
  const used = new Map();
  const m = scene.metrics();
  return async link => {
    const r = routes?.get(link.id);
    if (!r) return [];
    const out = [];
    for (const w of r.waypoints) {
      let p = null, run = 'x';
      if (w.lane) {
        const [side, face = 'front'] = w.lane.split('-');
        p = new THREE.Vector3(laneX(side), (w.ru - 0.5) * RU, face === 'rear' ? m.faceZ - m.railDepth : m.faceZ);
        run = 'y';
      } else {
        // A ring: x and z from its top-view component, y from the center of
        // its end rect, so the point is the center of the OPENING. A duct runs
        // along x like a ring; a pass crosses the face, along z.
        const [top, end] = await Promise.all([w.via, `${w.via}-end`].map(id => scene.guideAnchor({id: w.item}, id)));
        if (top || end) {
          p = (top || end).position.clone();
          if (top && end) p.y = end.position.y;
        } else {
          const duct = await scene.guideAnchor({id: w.item}, `guide--${w.via}`);
          const pass = duct ? null : await scene.guideAnchor({id: w.item}, `pass--${w.via}`);
          if (duct || pass) p = (duct || pass).position.clone();
          if (pass) run = 'z';
        }
      }
      if (!p) continue;
      // Spread across the run: the first cable at 0, then +-1 steps, on a 3x3
      // grid (it wraps after 9 cables sharing a waypoint).
      const key = w.lane ? `${w.lane}|${w.ru}` : `${w.item}|${w.via}`;
      const k = used.get(key) || 0; used.set(key, k + 1);
      const off = n => ((n + 1) % 3 - 1) * SPREAD;   // 0, +1, -1, 0, ...
      const [u, v] = run === 'x' ? ['y', 'z'] : run === 'y' ? ['x', 'z'] : ['x', 'y'];
      p[u] += off(k % 3); p[v] += off(Math.floor(k / 3) % 3);
      out.push(p);
    }
    return out;
  };
}

// Returns drawCables3d's {tubes, anchors, boxes, group} plus `checked` and the
// `facts` the cables were hung by (an export's notes read those, so they
// describe this scene and not a later reading), or {failed: true} when the
// cables could not be drawn: the rack still stands, and an export of it says so.
async function hangCables(scene, rack, facts, routes) {
  const loose = new Set([...facts.ends].filter(([, v]) => v.reason != null).map(([k]) => k));
  try {
    const drawn = await drawCables3d(scene, cablePlan3d(rack), {anchor: async (item, path, view) => {
      if (loose.has(endKey({item, path, view}))) return [];
      const got = await scene.cableAnchor({id: item}, path, {view});
      if (got.length) return got;
      const port = await scene.portAnchor({id: item}, path, {view});
      return port ? [{position: port.position, normal: port.normal, view, path}] : [];
    }, waypoints: waypointsFor(scene, routes, scene.three.THREE)});
    return {...drawn, checked: !facts.unchecked, facts};
  } catch (err) {
    console.warn('[portrayal] the cables could not be drawn in 3D', err);
    return {failed: true};
  }
}

// `camera`, when given, is `{position, target}` from a previous build - saved
// by the page just before it disposes the old scene, so a rebuild (a commit,
// or a frame change) restores the orbit instead of snapping back to the
// opening view.
export async function mountRack3d(container, {rack, chassisOf, camera = null, failFacts = false, routes = null}) {
  const frame = rack.frame;
  // PLUGS ARE DERIVED, NEVER STORED: as in 2D, a cabled end is built with the
  // plug its port takes, laid over the item's own swaps for this scene only.
  // If the cables' faces cannot be read the rack is built without plugs, and
  // every end is tried as it is.
  const cabled = (rack.cables || []).length > 0;
  const facts = !cabled ? UNCHECKED : await (failFacts ? Promise.reject(new Error('probe: scene cableFacts fails')) : cableFacts(rack)).catch(err => {
    console.warn("[portrayal] 3D: could not read the cables' faces", err);
    return UNCHECKED;
  });
  // The stack rack3d.js reads, mapped from this document's own items.
  // `chassis` is filled from the SAME lookup the 2D elevation and the fit
  // rules use (chassisOf), not fetched again from the compiled index -
  // rack3d.js prefers a caller's own chassis over one it would otherwise
  // fetch, and reading the two views' sizes from one place is the whole
  // argument this rack makes for itself (see rack3d.js's own banner).
  //
  // Optic fields (item.fields) are NOT carried over: createRackScene has no
  // fields input yet, so a swap into a bay shows in 3D but a field edit on an
  // optic does not, until that lands.
  const stack = rack.items.map(item => ({
    id: item.id,
    ref: item.ref, cfg: item.cfg, ru: item.ru, label: item.label,
    face: item.face, turned: item.turned, overrides: mergeSeats(item.swaps, facts.seats[item.id]),
    chassis: chassisOf?.(item.ref) || undefined,
    mount: chassisOf?.(item.ref)?.mount,
  }));

  // Imported here, not at module load: rack-page.js pulls this module in on
  // every visit, most of which never switch to 3D, and three.js (through
  // rack3d.js) is not a cost a 2D-only visit should pay - the showcase's own
  // mount3d (site/showcase/rack.js) makes the same choice for the same
  // reason.
  const {guard3d} = await import('../webgl.js');
  const scene = await guard3d(async () => {
    const {createRackScene} = await import('../rack3d.js');
    const built = createRackScene(container, {
      stack, heightRU: frame.heightRU,
      frame: frame.kind === 'four-post' ? {kind: 'four-post', railDepth: frame.railDepth} : null,
    });
    await built.build();
    // What the scene holds of the cables, for the page and the exports: null
    // for a rack with none (nothing is added to the scene at all).
    built.rackCables = cabled ? await hangCables(built, rack, facts, routes) : null;
    if (camera) {
      built.three.camera.position.copy(camera.position);
      built.three.controls.target.copy(camera.target);
      built.three.controls.update();
    }
    return built;
  }, () => {
    // A fixed, page-level sentence rather than guard3d's own (more technical,
    // chrome://gpu-pointing) message: the Rack Builder always has a working
    // 2D view right behind this one, which the showcase's 3D stages do not,
    // so what a reader needs to know here is simply that 2D is still there.
    container.replaceChildren(el('p', {class: 'rk-notice', role: 'status', text: NO_WEBGL}));
  });
  return scene;
}
