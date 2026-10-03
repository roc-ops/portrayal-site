// A rack you can walk round, built from the same list the 2D elevation uses.
//
// Adapted from the project's own `demo/rack.html`: the rails, the EIA-310 hole
// spacing, the U scale, the L-bracket ears and the recessed mounting all come
// from there, because those are the details that make an elevation read as a
// real rack rather than a stack of boxes. The cabling and topology work in that
// page is deliberately left out - it is not mature enough to put on a front
// page, and it is not what this tab is arguing.
//
// The argument is that 2D and 3D are two views of ONE source. Both are handed
// the same stack array, and a module swapped in one is a swap in the other,
// because both resolve it through swap.js against the same compiled faces.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { configureRelief, buildFaceRelief, canvasTex, svgCanvas, svgSource,
         setSvgOverride, clearSvgOverrides, createReliefScope,
         setPulled as setReliefPulled, applyPulled, nodeTools, cablePoints,
         setNodeStates, nodeStates } from '../vendor/relief.js';
import { toGLB, toUSDZ } from '../vendor/share.js';
import { seatViews, refusalReason } from '../vendor/swap.js';
import { jdist } from '../vendor/dist.js';
import { faceFile } from './faces.js';
import { RU, RAIL_W, HOLE_DY, HOLE_SIZE, SIDES } from './rack/rails.js';

export { RU };                      // EIA-310 rack unit; rails.js is the one source
const RACK_W = 482.6;               // 19in rail-to-rail outer width
const RACK_FACE_Z = 11;             // front plane of the mounting posts
const RECESS_DEFAULT = 30;          // how far back the faceplate sits from the rails
const EAR_GRIP_MAX = 76.2;          // 3in: how far an ear runs back along a flank

// Named opening views. `iso` is the direction this stage was composed with,
// kept as a unit vector so its look survives the distance being fitted; `front`
// is straight on, which is the 3D answer to a 2D elevation and lets a viewer
// toggle between the two without the picture jumping.
//
// Each carries where it looks AT as a fraction of rack height, and how much
// room to leave. Straight on needs less than the oblique view, which is turned
// away from the camera and foreshortened.
// `wide` is how much room to leave across, as a multiple of the rail width, and
// `aimX` shifts what the camera looks at sideways by the same measure. Both
// exist because the scene is not symmetric about the rails: device tags start
// 120 mm out on the left and run further left again by the width of their own
// text, while the U numbers sit on each post's own outboard half (rails.js's
// SIDES), so content spans roughly -510 mm on the left to about +251 mm on the
// right (the right rail's outer edge). Straight on that asymmetry is the whole
// picture and the tags fall off the edge without it; obliquely the margin
// already swallows it.
const VIEWS = {
  iso:   {dir: [0.4647, 0.1608, 0.8707], aim: 0.42, margin: 1.72, z: -60,
          wide: 1.1, aimX: 0},
  front: {dir: [0, 0, 1],                aim: 0.50, margin: 1.12, z: -60,
          wide: 2.4, aimX: -0.28},
};
// Face raster density for the rack. The single-device viewer defaults to 4 and
// is looked at from arm's length; a rack is seen from further back, across six
// devices at once, so it had no business being denser than the close-up. Kept
// as an option because a host wanting a poster-quality still can pay for it.
const PXMM_RELIEF = 5;
// The top and underside, which a rack almost entirely hides - see the note by
// COARSE below.
const PXMM_HIDDEN = 2;

// BoxGeometry takes its materials as [+x, -x, +y, -y, +z, -z].
const MAT_SLOT = {right: 0, left: 1, top: 2, bottom: 3, front: 4, rear: 5};

// WHERE EACH FACE SITS ON A DEVICE, in device-local millimetres: the plane's
// centre, how it is turned, and the size of the drawing painted on it.
//
// Written once because two things read it. The builder puts the relief for a
// face in this frame, and portAnchor() answers where a drawn port is in the
// same frame - and an anchor computed against a second, hand-copied idea of
// where the front plane is would be right until one of them moved. That is
// exactly the failure a consumer reported when the only way to place a port
// was to read RACK_FACE_Z out of this file: see the note on portAnchor.
//
// The underside is authored mirrored in both axes, which is what flipLX/flipLY
// carry - the same pair relief.js uses when it rasterises that face.
function faceFrames(W, H, D) {
  return [
    {view: 'front',  fw: W, fh: H, pos: [0, 0, D / 2],  rot: [0, 0, 0]},
    {view: 'rear',   fw: W, fh: H, pos: [0, 0, -D / 2], rot: [0, Math.PI, 0]},
    {view: 'right',  fw: D, fh: H, pos: [W / 2, 0, 0],  rot: [0, Math.PI / 2, 0]},
    {view: 'left',   fw: D, fh: H, pos: [-W / 2, 0, 0], rot: [0, -Math.PI / 2, 0]},
    {view: 'top',    fw: W, fh: D, pos: [0, H / 2, 0],  rot: [-Math.PI / 2, 0, 0]},
    {view: 'bottom', fw: W, fh: D, pos: [0, -H / 2, 0], rot: [Math.PI / 2, 0, 0],
     flipLX: true, flipLY: true},
  ];
}

// THE VIEWS A DEVICE IS BUILT FROM, derived from the table above rather than
// written out again, so a face added there is seated as well as drawn. The
// dimensions do not decide which views exist, so any box will do to ask.
const RACK_VIEWS = faceFrames(1, 1, 1).map(f => f.view);

// What each opening view can actually see. Everything else is built afterwards.
// 'front' is dead-on, so only the front face; 'iso' looks down from the front
// right, so it also catches the right side and the top of the topmost device.
const VISIBLE_FACES = {
  front: new Set(['front']),
  iso:   new Set(['front', 'right', 'top']),
};

export function createRackScene(container, opts = {}) {
  const DIST = opts.dist || 'assets/dist/';
  const STACK = opts.stack || [];
  // `heightRU: 'fit'` sizes the rack to what is actually in it, which cannot be
  // known until the configs are loaded - so UNITS is settled in build(), not
  // here, and the rails are built from it there too. A number still means a
  // number, and stays fixed.
  const FIT = opts.heightRU === 'fit';
  const MIN_RU = opts.minHeightRU ?? 12;
  let UNITS = FIT ? MIN_RU : (opts.heightRU || 12);

  // Label colours, alongside `background`. The dark stage gives three different
  // tones - device tags, plain RU numbers, and the every-fifth emphasis - so
  // each keeps its own default and passing nothing leaves the dark stage exactly
  // as it was.
  //
  // labelColor covers tags AND plain numbers together, which is what a light
  // stage asked for (roc-ops/portrayal-site#9): the emphasis tone is the one
  // that inverts, being the lightest of the three. labelUnitColor is there for
  // pulling the numbers back off the tags when you want the two apart again.
  const LABEL_TAG = opts.labelColor ?? '#D7DBDF';
  const LABEL_UNIT = opts.labelUnitColor ?? opts.labelColor ?? '#6B727A';
  const LABEL_EMPH = opts.labelEmphasisColor ?? '#E4E7EA';

  // How far back the faceplate sits from the mounting rails. Most gear mounts
  // flush and wants 0; the default is the setback the showcase was drawn with,
  // so passing nothing changes nothing.
  const RECESS = opts.recess ?? RECESS_DEFAULT;

  // Which view the scene opens at, and which one double-click returns to.
  // Named rather than a vector, because the useful ones carry their own aim and
  // margin - see VIEWS. roc-ops/portrayal-site#9 was reaching into
  // scene.three.camera to do this by hand.
  const VIEW = VIEWS[opts.view] ? opts.view : 'iso';

  // THE SWITCH ALONE. `rails: false` is the front page hero's view: one device
  // turned over in the hand, not a rack, so no rail posts, no U numbers and no
  // device tag beside the rail. Nothing else changes - the faces, the
  // overrides, the ears and the anchors are built exactly as in a rack. Every
  // other caller passes nothing and keeps the rails.
  const RAILS = opts.rails !== false;

  // FRAME-AWARE POSTS, opt-in. Every existing caller passes no `frame` at all
  // and gets exactly today's single front pair - the code path below reads
  // `FRAME` only to decide whether a REAR pair exists, never to change how
  // the front one is built.
  //
  // `two-post` is written out because a caller may want to say so (and get
  // the two-post default framing/usable-depth rules from model.js), but in
  // this file it draws the same single pair as no frame at all.
  const FRAME = opts.frame && opts.frame.kind === 'four-post' ? opts.frame : null;
  const RAIL_DEPTH = FRAME?.railDepth > 0 ? FRAME.railDepth : 740;
  // The rear mounting face, front rail to back, for a four-post frame.
  const REAR_FACE_Z = RACK_FACE_Z - RAIL_DEPTH;
  // A REAR entry with no four-post rear rail (a two-post frame, or no frame
  // at all) mounts on the back of the single front pair instead - the far
  // face of its 34 mm post box.
  //
  // RULING: this stays as built. The faceplate sits at that back face and the
  // chassis body passes through it toward the front, which is where a device
  // actually bolted to the back of two-post rails physically is - not a
  // drawing shortcut to fix.
  const REAR_MOUNT_Z = FRAME ? REAR_FACE_Z : RACK_FACE_Z - 34;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(opts.background ?? 0x0E1013);
  const camera = new THREE.PerspectiveCamera(42, 1, 20, 12000);
  const renderer = new THREE.WebGLRenderer({antialias: true});
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  container.append(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.minDistance = 200;
  controls.maxDistance = 6000;

  scene.add(new THREE.AmbientLight(0xffffff, 1.5));
  const key = new THREE.DirectionalLight(0xffffff, 1.5);
  key.position.set(0.5, 1, 1.2);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.7);
  fill.position.set(-0.8, 0.3, -0.6);
  scene.add(fill);

  // This scene's own override map. relief.js used to keep ONE, module-wide, so
  // two scenes in a page showing the same device with different occupants fought
  // over it - and clearSvgOverrides() emptied everything, meaning one scene
  // building or disposing silently wiped the other's. roc-ops/ndv#31 fixed that
  // by making a scope a thing you can hold; holding one is what makes a
  // side-by-side rack possible in a single document instead of two iframes.
  const relief = createReliefScope();

  // The scope is passed, not left to the module-level fallback. THREE and the
  // renderer really are per-page, but the raster density and the FRU path set
  // are per-scene, and relief.js used to keep those module-level too - so a
  // second scene calling configureRelief reclaimed them from under the first.
  // A rack asking for 5 px/mm beside a viewer asking for 4 is the same class of
  // collision the override map had, and passing `relief` is what settles it.
  const PXMM = opts.pxmm || PXMM_RELIEF;
  configureRelief({THREE, renderer, PXMM, FRU_PATHS: new Set()}, relief);

  // WHAT THE LAMPS SAY. `opts.states` maps a `data-path` to the state a lamp
  // (or a display digit) should show - `{'led-port-4/lamp': 'on'}` - and goes
  // to relief.js as the `state-*` class the drawing's own stylesheet paints.
  // Set before anything is built, as viewer3d.js does, so the faces are cut
  // from a document that already carries them. Scene-wide: a path lights on
  // every mount that has it.
  if (opts.states) setNodeStates(new Map([...(opts.states instanceof Map
    ? opts.states : Object.entries(opts.states))].map(([p, s]) => [p, `state-${s}`])), relief);

  // A SECOND SCOPE, PURELY FOR DENSITY. A face is rasterised at its own size in
  // millimetres, so a 1RU device's top is 440 x 500 against the front's
  // 440 x 43.5 - about eleven times the area, and there are two of them. On this
  // stack that made the top and underside 251 MB of a 298 MB total: 84% of the
  // texture spent on the two surfaces a rack hides. Every device but the topmost
  // has another sitting on it, and nothing is seen from below without orbiting
  // under the floor.
  //
  // They are not skipped, because there is no polar limit and somebody will
  // orbit under there eventually; they are drawn coarse. Vents and screw heads
  // survive 2 px/mm in a way port lettering would not.
  //
  // Sharing the override map rather than taking a fresh one: the only thing that
  // should differ between these two scopes is density, and a bay swap that
  // reaches the top view must still reach it. roc-ops/portrayal-site#13.
  const COARSE = createReliefScope({PXMM: opts.hiddenPxmm || PXMM_HIDDEN});
  COARSE.overrides = relief.overrides;
  const scopeFor = view => (view === 'top' || view === 'bottom') ? COARSE : relief;

  // ── parts taken off ────────────────────────────────────────────────────
  // WHAT IS NOT THERE. A set of data-paths a device is drawn without - a
  // blanking plate off a bay, the dust caps off the ports a cable actually
  // lands in. The consumer that asked for it (roc-ops/portrayal-site#10) knows
  // its cabled endpoints and emits `xc04/cap-tx`, `xc04/cap-rx`, so an uncapped
  // port reads as a cabled port at a glance.
  //
  // `opts.pulled` is the scene's default and `entry.pulled` is one mount's own
  // answer, REPLACING the default rather than adding to it: three DCP-Rs
  // cross-connected differently have three different lists, and a union
  // uncaps a port on every unit that a cable only reaches on one. An entry
  // that says nothing gets the scene default, so the simple case stays simple.
  //
  // TAKEN OUT OF THE MOUNT'S OWN TEXT, not set on a scope. The scopes are
  // shared by every device in the rack and a device's deferred relief pass
  // interleaves with the next device's build, so a scope-level set could only
  // ever say one thing for the whole scene - which is what made this
  // scene-wide before faces were keyed per mount. Removing the elements from
  // that mount's face instead is per-mount by construction, and it is what
  // extractRelief does with a pulled element anyway once it has found it.
  //
  // It also covers the flat pass for free. A face goes up as a plain raster and
  // grows its relief afterwards, and svgCanvas() consults no pulled set at all,
  // so anything that only reached the relief would drop a part's geometry and
  // leave it painted on the texture underneath.
  let PULLED = new Set(opts.pulled || []);
  const pulledFor = entry => new Set(entry.pulled || PULLED);
  // one scratch scope, re-aimed per mount, purely to borrow relief.js's own
  // matching - nested paths and a part's projections on other faces included
  const PULL_SCOPE = createReliefScope();

  async function pullFaces(entry) {
    const want = pulledFor(entry);
    if (!want.size) return;
    setReliefPulled(want, PULL_SCOPE);
    for (const fr of faceFrames(0, 0, 0)) {
      let text;
      // this mount's own text if a bay swap already made one, else the model's
      try { text = await svgSource(faceSrc(entry, fr.view), relief); } catch { continue; }
      const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
      if (doc.querySelector('parsererror')) continue;
      applyPulled(doc.documentElement, PULL_SCOPE);
      const gone = [...doc.querySelectorAll('[data-portrayal-pulled]')];
      if (!gone.length) continue;              // nothing of this mount's list here
      for (const el of gone) el.remove();
      putFace(entry, fr.view, new XMLSerializer().serializeToString(doc));
    }
  }

  // Framed up front, before a single device exists. Framing at the END of a
  // build meant the whole rack assembled itself somewhere above the default
  // camera and then snapped into place - and did it again on every rebuild,
  // throwing away wherever the viewer had orbited to.
  function frameCamera(which) {
    const v = VIEWS[which] || VIEWS[VIEW] || VIEWS.iso;
    const H = UNITS * RU;
    // Flush the damping residual BEFORE setting the camera, not after.
    //
    // OrbitControls keeps the leftover inertia of the last drag and applies it
    // inside update(), so assigning a position and calling update() lands the
    // camera near the framing rather than on it - measured 195 mm off after a
    // drag, and it stays there, because the residual decays to nothing once
    // spent. Turning damping off makes update() apply the residual once and
    // then zero it, so the first call absorbs the inertia and the second
    // applies a delta of zero, which leaves the assignment intact.
    const damped = controls.enableDamping;
    controls.enableDamping = false;
    controls.update();                       // spend and clear the residual

    // Distance is FITTED to the rack, not a constant. It used to be a flat 980,
    // which framed the 12RU stage this was drawn against and nothing else: a
    // 42RU rack is 1867 mm tall and ran off the top and bottom of the frame,
    // with anything above the mid-twenties simply not on screen. heightRU has
    // always been an option; it was only ever usable at one value.
    //
    // The viewing DIRECTION is the one the stage was composed with, kept as a
    // unit vector so the look does not change - only how far back it sits.
    const target = new THREE.Vector3(RACK_W * (v.aimX || 0), H * v.aim, v.z);
    controls.target.copy(target);

    // The container may not have been measured yet - resize() runs after the
    // first framing - so take the aspect from the element rather than from a
    // camera still holding its constructor default of 1.
    const cw = container.clientWidth || 1;
    const ch = container.clientHeight || 1;
    const aspect = cw / ch;
    const half = Math.tan((camera.fov * Math.PI / 180) / 2);
    // Whichever of height, width or (on a four-post frame) depth needs more
    // room wins. Width and height were the whole story while every rack was
    // one front pair 34 mm deep; a four-post rear pair can sit up to about a
    // metre back, past what H and RACK_W alone would frame - so its depth is
    // folded in here the same way width already is, rather than only ever
    // being checked against the height and width of what is directly in
    // front of the camera.
    const depth = FRAME ? RACK_FACE_Z - REAR_FACE_Z : 0;
    const need = Math.max(H / (2 * half), (RACK_W * v.wide) / (2 * half * aspect),
                          (depth * 1.15) / (2 * half * aspect));
    camera.position.copy(target)
      .addScaledVector(new THREE.Vector3(...v.dir), need * v.margin);

    controls.update();                       // now a no-op delta
    controls.enableDamping = damped;
  }
  frameCamera();

  // Double-click to get back to the opening view. OrbitControls has no such
  // binding of its own - `reset()` restores whatever position it was
  // constructed with, which is the camera's zero, not the framing above - so
  // this calls frameCamera rather than controls.reset().
  //
  // On the renderer's canvas, not the container: a dblclick on a label or the
  // surrounding page is not a request to reframe. Damping is enabled, so the
  // move eases rather than snapping.
  const onDblClick = () => frameCamera();
  renderer.domElement.addEventListener('dblclick', onDblClick);

  // ── labels ─────────────────────────────────────────────────────────────
  function tex(cv) {
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    t.minFilter = THREE.LinearMipmapLinearFilter;
    return t;
  }
  function labelSprite(text, px = 30, color = '#9AA1A8') {
    const cv = document.createElement('canvas');
    const probe = cv.getContext('2d');
    probe.font = `600 ${px}px ui-monospace, monospace`;
    cv.width = Math.ceil(probe.measureText(text).width) + 12;
    cv.height = px + 12;
    const c = cv.getContext('2d');
    c.font = `600 ${px}px ui-monospace, monospace`;
    c.fillStyle = color;
    c.textBaseline = 'middle';
    c.fillText(text, 6, cv.height / 2);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({map: tex(cv), depthTest: false}));
    s.scale.set(cv.width / px * 22, cv.height / px * 22, 1);
    return s;
  }

  // ── rack ───────────────────────────────────────────────────────────────
  const railMat = new THREE.MeshLambertMaterial({color: 0xB9BFC6});
  const holeMat = new THREE.MeshBasicMaterial({color: 0x15181b});
  const earMat = new THREE.MeshLambertMaterial({color: 0xA8AEB5});
  const screwMat = new THREE.MeshLambertMaterial({color: 0x8d949c});

  const rack = new THREE.Group();
  // Every post mesh built, front and rear together - posts() (the API) is
  // just its length, and a rebuild starts it fresh.
  let rackPosts = [];
  // ONE PAIR-BUILDER, called once for the front pair and, on a four-post
  // frame, once more for the rear one - so the two never drift apart, the way
  // 26 mm rails in 2D and 16 mm posts in 3D once did (see the file banner).
  //
  // `mountZ` is where the pair's MOUNTING face sits - the plane a device's
  // ears actually bolt to - and `dir` is which way the post body sits behind
  // it: +1 for the front pair (the box sits at smaller z, behind the face,
  // exactly as before) and -1 for the rear pair (the box sits at larger z,
  // so it is inboard, inside the rack, as the brief asks). Holes and numbers
  // sit just off the mounting face, offset by `dir` the same way the box is,
  // so a rear pair's holes and numbers read from the back.
  function buildPostPair(mountZ, dir) {
    const H = UNITS * RU;
    for (const s of SIDES) {
      // The post is the rail's full face, with its inner edge on the opening,
      // exactly as the 2D elevation draws it.
      const cx = (s.inner + s.outer) / 2;
      const post = new THREE.Mesh(new THREE.BoxGeometry(RAIL_W, H, 34), railMat);
      post.position.set(cx, H / 2, mountZ - dir * 17);
      rack.add(post);
      rackPosts.push(post);
      for (let u = 0; u < UNITS; u++) {
        for (const dy of HOLE_DY) {
          const h = new THREE.Mesh(new THREE.BoxGeometry(HOLE_SIZE, HOLE_SIZE, 1), holeMat);
          h.position.set(s.hole, u * RU + dy, mountZ + dir * 0.3);
          rack.add(h);
        }
        // U numbers ON the rail, on its outboard half, on BOTH rails. They
        // used to float off the left side only.
        const n = labelSprite(String(u + 1), 30, (u + 1) % 5 === 0 ? LABEL_EMPH : LABEL_UNIT);
        n.scale.multiplyScalar(0.45);   // sized to sit inside a 26 mm face; adjust by eye
        n.position.set(s.number, u * RU + RU / 2, mountZ + dir * 0.6);
        rack.add(n);
      }
    }
  }
  function buildRack() {
    disposeTree(rack);                       // dispose BEFORE detaching, or
    for (const c of [...rack.children]) rack.remove(c);   // there is nothing left to walk
    rackPosts = [];
    if (!RAILS) return;
    buildPostPair(RACK_FACE_Z, 1);
    if (FRAME) buildPostPair(REAR_FACE_Z, -1);
  }
  buildRack();
  scene.add(rack);

  // An L bracket per side: a flange flat on the rack face taking two screws, and
  // a leg running back along the flank of the device. The gear sits recessed, so
  // the leg spans that gap - which is what a flat plate cannot do and why it
  // looked wrong as one.
  //
  // `mountZ`/`dir` generalize this the same way buildPostPair does, so an ear
  // on the rear plane sits with its flange just behind that plane, its leg
  // running toward the front, and its screw heads facing the back - the
  // mirror image of a front ear, not a copy of it parented somewhere else.
  // Defaulted to the front pair, so nothing that already calls this changes.
  function rackEars(ru, ruHeight, halfW, depth, mountZ = RACK_FACE_Z, dir = 1) {
    const g = new THREE.Group();
    const yBase = (ru - 1) * RU;
    const h = ruHeight * RU - 4.5;
    // The leg spans the recess and then grips the flank. Only the GRIP is
    // capped: the recess has to be crossed whatever the device, or the ear
    // never reaches it.
    //
    // min(3in, three quarters) rather than three quarters flat. A real ear is a
    // bracket a few inches long, not a rail the length of the box - on a 600 mm
    // chassis the old proportion ran 450 mm back and rendered as a plate over
    // the whole flank. Shallow gear keeps the proportion, because on a 150 mm
    // box three inches would be most of it anyway.
    const legLen = RECESS + Math.min(EAR_GRIP_MAX, depth * 0.75);
    for (const side of [-1, 1]) {
      // The screw lands on the rail's own hole, not a second hand-derived x -
      // rail geometry lives only in rails.js.
      const holeX = SIDES.find(s => s.side === (side < 0 ? 'left' : 'right')).hole;
      const earX = side * (halfW + 12);
      const flange = new THREE.Mesh(new THREE.BoxGeometry(24, h, 3), earMat);
      flange.position.set(earX, yBase + ruHeight * RU / 2, mountZ + dir * 1.5);
      g.add(flange);
      const leg = new THREE.Mesh(new THREE.BoxGeometry(3, h, legLen), earMat);
      leg.position.set(side * (halfW + 1.5), yBase + ruHeight * RU / 2, mountZ - dir * legLen / 2);
      g.add(leg);
      for (let u = 0; u < ruHeight; u++) {
        for (const dy of [6.35, 38.10]) {
          const head = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 2.2, 14), screwMat);
          head.rotation.x = Math.PI / 2;
          head.position.set(holeX, yBase + u * RU + dy, mountZ + dir * 4.1);
          g.add(head);
        }
      }
    }
    return g;
  }

  // ── devices ────────────────────────────────────────────────────────────
  const mounted = [];   // {entry, group}

  // A FACE BELONGS TO A MOUNT, NOT TO A MODEL. The override table is keyed by
  // the URL a face is fetched from, and that URL is `<ref>.<cfg>.<view>.svg` -
  // identical for two of the same model in one rack. So a bay swap on the
  // lower of two ASR-9001s registered against the URL both of them read, and
  // whichever was built second won: both drew the same occupant, and pulling a
  // part from one took it off the other. The rack that shows this is the rack
  // anybody with redundant hardware builds.
  //
  // A mount that needs its own text gets its own key, and the key is only used
  // once there is text registered under it - svgSource() falls through to a
  // fetch otherwise, and a synthetic key has nothing to fetch. So `faceSrc`
  // asks whether this mount has one before handing it out.
  const SYNTH = new Set();
  // A face's file is looked up, never built: see site/faces.js (Portrayal #670).
  const faceUrl = (entry, view) => DIST + faceFile(entry.index || {device: entry.ref}, entry.cfg, view);
  const faceKey = (entry, view) => `${faceUrl(entry, view)}#mount-${entry.slot}`;
  const faceSrc = (entry, view) =>
    SYNTH.has(faceKey(entry, view)) ? faceKey(entry, view) : faceUrl(entry, view);
  function putFace(entry, view, text) {
    const k = faceKey(entry, view);
    setSvgOverride(k, text, relief);
    SYNTH.add(k);
  }

  // Seat a device's compiled faces before relief is taken from them. relief.js
  // consults its override table ahead of its own cache, so one substitution per
  // face reaches the texture, the cavity mask and everything else built from
  // that text.
  //
  // ONE RULE, AND IT IS SWAP.JS'S. This used to run the sequence here - bays,
  // then `applyOccupantOverrides` over `entry.cages[view]` - and that second
  // list is the DEVICE's cages, read from configs.json before any card is
  // seated. It was wrong twice over, silently:
  //
  //   - A cage on a seated CARD is not in it. On the Nokia 7360 FX shelves the
  //     list is empty on every view, because every cage there is on a card, so
  //     the `cages.length` guard meant the occupant pass never ran at all: an
  //     optic in `nt-a/module/qsfp-2` was drawn in 2D and missing in 3D, and
  //     portAnchor on its `-occupant/tx` returned null.
  //   - Only the views `viewsToRewrite` named were visited, so a swapped
  //     cassette's BACK never reached the rear face. fhd-1ufce has bays on
  //     front alone and carries its `data-rear-of` holes on the rear.
  //
  // `seatViews` is both rules, and it is what viewer3d.js runs: every face the
  // map names PLUS every face holding a rear hole, each through `seatFace` -
  // bays at every level, then `faceCages` read off the face AFTER the bays
  // settle, then the rear holes. It is handed every view the rack builds, which
  // costs no extra fetching: buildDevice asks for the same faces and svgSource
  // memoises both hits and misses.
  async function overrideFaces(entry) {
    const ov = entry.overrides;
    if (!ov || !Object.keys(ov).length) return;
    const byRef = ref => (entry.componentIndex || []).find(
      c => `${c.ns}/${c.name}@${c.major.slice(1)}` === ref.split(':')[0]);
    const loadSkin = async ref => {
      const c = byRef(ref);
      if (!c) return null;
      const skin = c.skins?.includes('default') ? 'default' : c.skins?.[0];
      return {comp: c, text: await svgSource(
        `${DIST}components/${c.ns}--${c.name}--${c.major}--${skin}.svg`, relief)};
    };
    // Parsed roots by view. A face that will not fetch or will not parse is
    // left out rather than failing the device: the rack draws what it has.
    const faces = {}, docs = {};
    for (const view of RACK_VIEWS) {
      let text;
      try { text = await svgSource(faceUrl(entry, view), relief); } catch { continue; }
      if (!text) continue;
      const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
      if (doc.querySelector('parsererror')) continue;
      docs[view] = doc;
      faces[view] = doc.documentElement;
    }
    const seated = await seatViews(
      faces, {bays: entry.bays, cages: entry.cages}, ov, loadSkin, byRef);
    for (const [view, r] of Object.entries(seated)) {
      // The divergences the pass exists to prevent, said out loud rather than
      // swallowed - the same three the kit's viewer reports.
      if (r.dropped?.length)
        console.warn(`[portrayal] ${entry.ref}.${view}: ${r.dropped.length} nested `
                     + `bay override(s) never applied - the drawing nests deeper `
                     + `than the walk goes, so 2D and 3D will disagree`, r.dropped);
      // A refused cage is one the build does something to that the kit does not
      // (lifted, mirrored, or in a group carrying states), so it is left empty
      // rather than guessed at; a failed one is a skin that did not load, so the
      // cage keeps what the build seated.
      if (r.refused?.length)
        console.warn(`[portrayal] ${entry.ref}.${view}: ${r.refused.length} cage `
                     + `override(s) refused, so the cage is left empty`,
                     r.refused.map(id => `${id} (${refusalReason(
                       (r.cages || []).find(c => c.id === id))})`));
      if (r.failed?.length)
        console.warn(`[portrayal] ${entry.ref}.${view}: ${r.failed.length} cage `
                     + `override(s) not applied - the optic's skin did not load`, r.failed);
      // An optic needs no further work here once it is in the face text: its
      // nodes carry `data-z-out`, and buildFaceRelief extrudes them forward of
      // the faceplate like any other relief.
      if (r.applied) putFace(entry, view, new XMLSerializer().serializeToString(docs[view]));
    }
  }

  async function buildDevice(entry) {
    const {w: W, h: H, d: D} = entry.chassis;
    const f = v => faceSrc(entry, v);
    // The underside is left out here and rasterised on its own below: it gets
    // no relief pass, and its art is mirrored. Everything else comes from the
    // one table portAnchor() also reads.
    const FACES = faceFrames(W, H, D).filter(fr => fr.view !== 'bottom').map(fr => (
      {view: fr.view, fw: () => fr.fw, fh: () => fr.fh, pos: () => fr.pos, rot: fr.rot}));
      // A rack is not a single device turned over in the hand: it opens at a known
    // view and most of what is built is never seen. At 'front' four of the five
    // faces face nothing; even at 'iso' the left and rear do. So the faces the
    // opening camera can actually see are built first and the device goes up
    // with them, and the rest arrive afterwards without anybody waiting. The
    // total work is the same - the wait before the scrim can drop is not.
    const meshes = [], faceCv = {}, faceSvg = {}, facePunch = {};
    // The five faces are independent: separate URLs, and every result is keyed
    // by view. Building them serially left the main thread idle through each
    // face's image decode in turn, which is most of what a face costs. Each
    // gets its own mesh array so the concat below stays in FACES order rather
    // than in whichever order the decodes happened to finish.
    const plain = () => new THREE.MeshLambertMaterial({color: 0x3a3f44});
    const mat = cv => cv ? new THREE.MeshLambertMaterial(
      {map: canvasTex(cv), transparent: true, alphaTest: 0.08}) : plain();

    // FLAT FIRST. Nearly all of a device's build time is buildFaceRelief turning
    // every cage, dome and vent into its own extruded geometry - measured at
    // 5.4 s across this stack's six front faces, against 0.3 s for fetching,
    // extracting and rasterising the same faces. That relief is what makes a
    // device convincing at arm's length in the single-device viewer. In a rack
    // it is sub-millimetre detail seen from across the room.
    //
    // So the box goes up with plain rasterised faces, which is the whole
    // picture minus the depth, and the relief is added afterwards for anyone
    // who zooms in. Same end state, reached with nobody watching a scrim.
    const flatCv = {};
    await Promise.all([
      ...FACES.map(F => svgCanvas(f(F.view), F.fw(), F.fh(), false, false,
                                  scopeFor(F.view))
        .then(cv => { flatCv[F.view] = cv; }).catch(() => {})),
      svgCanvas(f('bottom'), W, D, true, true, COARSE)
        .then(cv => { flatCv.bottom = cv; }).catch(() => {}),
    ]);
    const mats = ['right', 'left', 'top', 'bottom', 'front', 'rear']
      .map(v => mat(flatCv[v]));

    const group = new THREE.Group();
    // NAMED ONLY WHEN THE CALLER NAMES THE MOUNT. The Rack Builder passes each
    // item's id, so its GLB says which node is which device; the showcase and
    // the hero pass none, so their scenes and exports are exactly as before.
    if (entry.id) group.name = `device-${entry.id}`;
    const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), mats);
    group.add(body);
    meshes.forEach(m => group.add(m));

    const ruHeight = Math.max(1, Math.round(H / RU));
    // WHICH RAIL THIS ENTRY BOLTS TO. `face: 'rear'` (default 'front') mounts
    // on the rear plane instead of the front one - REAR_FACE_Z on a four-post
    // frame, or the back of the single front pair otherwise (REAR_MOUNT_Z).
    // `turned` is the general name for what `reversed` always meant here:
    // the device's OTHER panel faces out. `reversed` keeps working - it is
    // read as a synonym, never required alongside `turned`.
    const face = entry.face === 'rear' ? 'rear' : 'front';
    const turned = !!(entry.turned ?? entry.reversed);
    const mountZ = face === 'rear' ? REAR_MOUNT_Z : RACK_FACE_Z;
    group.position.set(0, (entry.ru - 1) * RU + H / 2,
      face === 'rear' ? mountZ + RECESS + D / 2 : mountZ - RECESS - D / 2);
    // RACKED BACK TO FRONT. `turned` on the entry turns the unit round in its
    // bay: its faceplate looks out of the back of whichever rail it is
    // mounted to, and what you see from the mounting face's own side is its
    // other panel. Not a drawing preference - on the OK ROADM shelf every
    // management port but the controller's is already on a rear face, so
    // turning the controller round is what makes each management run a
    // short rear-to-rear jumper, and that is how it would be installed.
    //
    // A HALF TURN AND NOTHING ELSE. The chassis keeps the depth it already
    // occupies, so the position above stands regardless of `turned` - the
    // half-turn is about the group's own centre, not its position. A front
    // entry is turned exactly when `turned` says so; a rear entry starts
    // turned (its faceplate already looks out the back of the rack, toward
    // the rear plane) and `turned` flips it back to facing forward again -
    // hence the XOR below, not a plain `turned`.
    group.rotation.y = ((face === 'rear') !== turned) ? Math.PI : 0;

    // The ears live in RACK space, not device space. Parenting them to the
    // device and cancelling only the Y offset left them displaced by the Z
    // recess, which is what put a pair of white slabs out beside each unit.
    // A rear entry's ears go on the rail it is actually mounted to.
    // (none for a device the caller marks as not rack-mount: `entry.mount`)
    const ears = entry.mount && entry.mount !== 'rack' ? new THREE.Group()
      : rackEars(entry.ru, ruHeight, W / 2, D, mountZ, face === 'rear' ? -1 : 1);
    scene.add(ears);

    // The device's tag, beside the left rail - a rail label, so it goes with
    // the rails.
    let tag = null;
    if (RAILS) {
      tag = labelSprite(entry.label, 30, LABEL_TAG);
      tag.position.set(-(RACK_W / 2 + 120) - tag.scale.x / 2, group.position.y, 46);
      scene.add(tag);
    }
    scene.add(group);
    mounted.push({entry, group, tag, ears});

    // The faces nobody is looking at yet, plus the underside. Deliberately not
    // awaited: build() resolves once every device is standing, so the scrim
    // comes off then rather than after five faces per device. `mine` guards
    // against a rebuild or a dispose landing while this is still going - the
    // group would be gone and its materials disposed.
    // The relief pass, deliberately not awaited: build() resolves once every
    // device is standing. The faces the opening view can see are done first so
    // a viewer who is already looking gets depth before the hidden sides do.
    // `mine` guards a rebuild or dispose landing mid-pass, when this group and
    // its materials are gone.
    const mine = epoch;
    const shownNow = VISIBLE_FACES[VIEW] || VISIBLE_FACES.iso;
    const order = [...FACES].sort((a, b) =>
      (shownNow.has(b.view) ? 1 : 0) - (shownNow.has(a.view) ? 1 : 0));
    pending.push((async () => {
      for (const F of order) {
        const per = [];
        await buildFaceRelief(F, {scope: scopeFor(F.view), src: f(F.view), faceCv, faceSvg,
          facePunch, meshes: per, FRU_GROUPS: {}, FRU_META: {}, BODY_META: {},
          D, bodyBoxMesh: null});
        if (mine !== epoch) return;
        per.forEach(m => { group.add(m); meshes.push(m); });
        const i = MAT_SLOT[F.view], cv = faceCv[F.view];
        if (cv && body.material[i]) {
          const prev = body.material[i];
          body.material[i] = mat(cv);
          prev.map && prev.map.dispose();
          prev.dispose();
        }
      }
    })());
    return group;
  }

  // ── where a drawn port is, in the room ─────────────────────────────────
  // A host drawing cables between racks needs the world point of a port it can
  // name in the drawing. Before this the only way to get one was to read
  // RACK_FACE_Z out of this file and re-derive the mount transform by hand
  // (roc-ops/portrayal-site#10), and that constant is not enough on its own:
  // the faceplate setback is the caller's to choose through `opts.recess`, and
  // the device's own depth and height are in the same arithmetic. A consumer
  // holding the constant alone is right for the default recess and wrong the
  // moment a scene sets its own - silently, and in millimetres that look
  // plausible. So the answer offered is the anchor itself, computed in the
  // frame the builder actually used.
  //
  // The measurement comes from the drawing rather than from a table of port
  // positions, because the drawing is the only thing that knows: a bay swap
  // changes what is on the face, and svgSource() hands back the overridden
  // text, so an anchor taken after a swap is an anchor on the part now fitted.
  const anchorDocs = new Map();
  function dropAnchorDocs() {
    for (const rec of anchorDocs.values()) if (rec) rec.div.remove();
    anchorDocs.clear();
  }
  async function faceDoc(entry, view) {
    // Cached per MOUNT, and measured from the mount's own face: two of the same
    // model can hold different modules, so an anchor keyed on ref+cfg would
    // hand back the other one's geometry.
    const key = `${entry.slot}|${view}`;
    if (anchorDocs.has(key)) return anchorDocs.get(key);
    let rec = null;
    try {
      const text = await svgSource(faceSrc(entry, view), relief);
      // getBBox and getScreenCTM read nothing from a detached tree, so this has
      // to be in the document - parked off-screen and hidden, never painted.
      const div = document.createElement('div');
      div.style.cssText = 'position:absolute;left:-10000px;top:0;'
        + 'width:1000px;visibility:hidden;pointer-events:none';
      div.innerHTML = text;
      document.body.append(div);
      const svg = div.querySelector('svg');
      if (svg) rec = {div, svg, tools: nodeTools(svg)};
      else div.remove();
    } catch (e) { rec = null; }
    anchorDocs.set(key, rec);
    return rec;
  }
  function findMounted(which) {
    if (which == null) return null;
    if (typeof which === 'object') {
      return mounted.find(m =>
        (which.ru == null || m.entry.ru === which.ru) &&
        (which.ref == null || m.entry.ref === which.ref) &&
        (which.label == null || m.entry.label === which.label)) || null;
    }
    // A rack may hold the same model twice, so a bare ref is the first of them.
    // Pass {ref, ru} - or {label} - to name which.
    return mounted.find(m => m.entry.ref === which)
        || mounted.find(m => m.entry.label === which) || null;
  }
  async function portAnchor(which, path, o = {}) {
    const m = findMounted(which);
    if (!m || !path) return null;
    const {entry, group} = m;
    const {w: W, h: H, d: D} = entry.chassis;
    const frames = faceFrames(W, H, D);
    const views = o.view ? [o.view]
      : ['front', 'rear', 'right', 'left', 'top', 'bottom'];
    group.updateMatrixWorld(true);
    for (const view of views) {
      const fr = frames.find(x => x.view === view);
      const doc = fr && await faceDoc(entry, view);
      if (!doc) continue;
      let el = null;
      try { el = doc.svg.querySelector(`[data-path="${CSS.escape(path)}"]`); }
      catch (e) { return null; }        // a path that cannot be a selector
      if (!el) continue;
      const r = doc.tools.mmRect(el);
      // face millimetres -> the face's own plane (x right, y up, z out of it),
      // then the plane into the device, then the device into the room. The
      // flips are the underside's mirrored art, exactly as relief.js reads it.
      const lx = (fr.flipLX ? -1 : 1) * (r.x + r.w / 2 - fr.fw / 2);
      const ly = (fr.flipLY ? -1 : 1) * (fr.fh / 2 - (r.y + r.h / 2));
      const rot = new THREE.Euler(...fr.rot);
      const local = new THREE.Vector3(lx, ly, 0).applyEuler(rot)
        .add(new THREE.Vector3(...fr.pos));
      return {
        position: group.localToWorld(local),
        // Straight out of the face, so a cable can leave at a right angle
        // instead of starting inside the metal.
        normal: new THREE.Vector3(0, 0, 1).applyEuler(rot)
          .applyQuaternion(group.getWorldQuaternion(new THREE.Quaternion())).normalize(),
        view, path,
        mm: {x: r.x, y: r.y, w: r.w, h: r.h},
        ref: entry.ref, ru: entry.ru, label: entry.label,
      };
    }
    return null;
  }

  // WHERE A CABLE LEAVES A SEATED CONNECTOR, in the room: relief.js's
  // cablePoints on the mount's own face (faceDoc is the seated face - see
  // overrideFaces), each point's own-frame `at` mapped into face millimeters
  // through its marker's CTM (the same mapping nodeTools' mmRect uses), lifted
  // by the point's resolved `z` along the face's own +z, then through the same
  // face->device->room chain portAnchor uses. One entry per connector under
  // `prefix` (an optic's two plugs; a duplex plug's a and b; an RJ45 plug's
  // one), or [] for none.
  async function cableAnchor(which, prefix, o = {}) {
    const m = findMounted(which);
    if (!m || !prefix) return [];
    const {entry, group} = m;
    const {w: W, h: H, d: D} = entry.chassis;
    const frames = faceFrames(W, H, D);
    group.updateMatrixWorld(true);
    const q = group.getWorldQuaternion(new THREE.Quaternion());
    for (const view of o.view ? [o.view] : ['front', 'rear']) {
      const fr = frames.find(x => x.view === view);
      const doc = fr && await faceDoc(entry, view);
      if (!doc) continue;
      // An RJ45 plug's point is the occupant itself, `<prefix>-occupant`; an
      // optic's LC plugs, or a duplex plug's two, are below it. Never
      // `port-10-occupant` for `port-1`.
      const pts = cablePoints(doc.svg).filter(p => p.at && (p.path === prefix + '-occupant'
        || p.path.startsWith(prefix + '-occupant/')));
      if (!pts.length) continue;
      const inv = doc.svg.getScreenCTM().inverse();
      const rot = new THREE.Euler(...fr.rot);
      const normal = new THREE.Vector3(0, 0, 1).applyEuler(rot).applyQuaternion(q).normalize();
      return pts.map(p => {
        const mm = new DOMPoint(+p.at[0], +p.at[1]).matrixTransform(inv.multiply(p.el.getScreenCTM()));
        const lx = (fr.flipLX ? -1 : 1) * (mm.x - fr.fw / 2);
        const ly = (fr.flipLY ? -1 : 1) * (fr.fh / 2 - mm.y);
        const local = new THREE.Vector3(lx, ly, +p.z || 0).applyEuler(rot).add(new THREE.Vector3(...fr.pos));
        return {position: group.localToWorld(local), normal: normal.clone(), view, path: p.path};
      });
    }
    return [];
  }

  // Each mounted chassis as a world-space box, for a host that must keep
  // something (a cable) out of the metal.
  function deviceBoxes() {
    return mounted.map(({entry, group}) => {
      const {w, h, d} = entry.chassis;
      group.updateMatrixWorld(true);
      const box = new THREE.Box3(new THREE.Vector3(-w / 2, -h / 2, -d / 2), new THREE.Vector3(w / 2, h / 2, d / 2));
      return {ref: entry.ref, box: box.applyMatrix4(group.matrixWorld)};
    });
  }

  function disposeTree(root) {
    root.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      for (const m of [].concat(o.material || [])) {
        if (!m) continue;
        for (const k of ['map', 'alphaMap']) m[k] && m[k].dispose();
        m.dispose();
      }
    });
  }

  // The stack a caller writes is {ref, cfg, ru, label, overrides} - the five keys
  // a network model knows natively. `chassis`, `bays` and `componentIndex` are
  // shapes out of Portrayal's compiled dist, and requiring them made Portrayal's
  // index layout part of THIS module's contract: roc-ops/portrayal-site#10
  // reports a consumer shipping a bug from guessing componentIndex was the raw
  // components.json rather than its `.components`. The scene is handed `dist`
  // already, so it reads them itself.
  //
  // Resolved into a parallel array rather than written back onto the caller's
  // objects. An entry that already carries them keeps them, so the callers that
  // pass the full shape today are untouched.
  // Bumped whenever the standing devices are torn down, so deferred face work
  // from a previous build knows its group no longer exists.
  let epoch = 0;
  let pending = [];
  let RESOLVED = [], COMPONENTS = null;
  async function hydrate() {
    const configs = new Map();
    for (const e of STACK) {
      // The configs index is also where the name of the default configuration
      // lives, so an entry without a cfg needs it even when the caller supplied
      // chassis and bays.
      // Cages as well since Portrayal #441: a caller that supplies chassis and
      // bays but not cages still needs the index, or its optics go nowhere.
      // And always since Portrayal #670: it says which file draws each face.
      if (configs.has(e.ref)) continue;
      configs.set(e.ref, jdist(`${DIST}${e.ref}.configs.json`).catch(() => null));
    }
    if (STACK.some(e => !e.componentIndex) && !COMPONENTS) {
      COMPONENTS = await jdist(`${DIST}components.json`)
        .then(d => d.components).catch(() => []);
    }
    RESOLVED = [];
    for (const e of STACK) {
      const cfg = configs.has(e.ref) ? await configs.get(e.ref) : null;
      RESOLVED.push({...e,
        // WHICH MOUNT THIS IS. Two of the same model in one rack are the same
        // `ref` and the same `cfg`, so neither names a device - and everything
        // keyed on the pair silently treated them as one thing. Position in the
        // stack does name one, and unlike `ru` it cannot be duplicated by a
        // caller that gets its numbering wrong.
        slot: RESOLVED.length,
        cfg: e.cfg || cfg?.default,
        chassis: e.chassis || cfg?.chassis || {},
        bays: e.bays || cfg?.bays || {},
        // A PORT THAT TAKES AN OPTIC is a cage (Portrayal #441), listed per view
        // beside the bays, and an override map names both in one namespace.
        cages: e.cages || cfg?.cages || {},
        componentIndex: e.componentIndex || COMPONENTS || [],
        index: cfg});
    }
  }

  // How tall the rack has to be to hold what is in it. A device occupies its own
  // height from where it is mounted, so the top of the stack is the highest
  // (ru + height - 1), not the highest ru.
  function fitUnits() {
    let top = 0;
    for (const e of RESOLVED) {
      const h = e.chassis?.ru || Math.max(1, Math.round((e.chassis?.h || RU) / RU));
      top = Math.max(top, (e.ru || 1) + h - 1);
    }
    return Math.max(MIN_RU, top);
  }

  async function buildAll() {
    epoch++;             // anything still filling in faces is now building for
    pending = [];        // groups that are about to be disposed
    for (const m of mounted) {
      scene.remove(m.group); if (m.tag) scene.remove(m.tag); scene.remove(m.ears);
      disposeTree(m.group); disposeTree(m.ears);
    }
    mounted.length = 0;
    clearSvgOverrides(relief);
    SYNTH.clear();            // the keys those overrides were registered under
    dropAnchorDocs();         // measured against overrides that are now gone
    await hydrate();
    if (FIT) {
      const want = fitUnits();
      if (want !== UNITS) {
        UNITS = want;
        buildRack();
        frameCamera();     // the framing is a function of height; it just moved
      }
    }
    for (const entry of RESOLVED) {
      await overrideFaces(entry);
      await pullFaces(entry);      // after the bay override: it composes onto it
      await buildDevice(entry);
    }
  }

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    // Sizes the element as well as the buffer. Passing updateStyle=false here
    // left the canvas with no CSS size, so at devicePixelRatio > 1 it laid out
    // at buffer size - double its pane, covering whatever sat next to it.
    // roc-ops/ndv#31.
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  // `running` is the host's to switch: a panel scrolled out of sight has no
  // business drawing sixty frames a second (the front page hero pauses it).
  // Every other caller never touches it, and the loop runs as it always did.
  let raf = 0, alive = true, running = true;
  function tick() {
    if (!alive || !running) { raf = 0; return; }
    controls.update();
    renderer.render(scene, camera);
    raf = requestAnimationFrame(tick);
  }
  tick();

  return {
    build: buildAll,
    // The scene owns its copy of the stack, so a host that mutates its own array
    // changes nothing here. This is how a swap reaches the 3D rack.
    setOverrides(ref, ov) {
      const e = STACK.find(x => x.ref === ref);
      if (e) e.overrides = {...ov};
    },
    // The scene's DEFAULT set of parts to draw without: `opts.pulled` at
    // construction, or changed here and picked up by the next build() - the
    // same mutate-then-rebuild shape setOverrides has, and for the same
    // reason: a pull is read when a face is extracted and rasterised, so
    // nothing short of rebuilding those faces can show it.
    // A stack entry carrying its own `pulled` uses that instead, which is how
    // three of one model each lose a different port's cap.
    setPulled(paths) {
      PULLED = new Set(paths || []);
    },
    pulled: () => new Set(PULLED),
    // The lamp states the faces were cut with, `data-path` -> `state-*` class.
    states: () => Object.fromEntries(nodeStates(relief)),
    // The world point of a drawn port, and the way the face it is on is
    // pointing: {position, normal, view, path, mm, ref, ru, label}, or null
    // when nothing on this device carries that data-path. `which` is a ref, a
    // label, or {ref, ru} when a rack holds the same model twice; pass
    // {view} to look at one face instead of searching them.
    portAnchor,
    // Where each cable leaves a seated connector under a path prefix:
    // [{position, normal, view, path}], one per relief.js cable point, or [].
    cableAnchor,
    // The mounted chassis bodies as world-space boxes: [{ref, box}].
    deviceBoxes,
    // How many post meshes are standing - two for a front (or two-post)
    // pair, four once a four-post frame's rear pair joins it. For tests.
    posts: () => rackPosts.length,
    // Each mounted device's own rack-frame placement, for a test that needs
    // to tell a front-mounted unit from a rear-mounted, turned one without
    // reaching into the scene graph by hand: [{ref, face, z, rotY}].
    devices: () => mounted.map(({entry, group}) => ({
      ref: entry.ref, face: entry.face === 'rear' ? 'rear' : 'front',
      z: group.position.z, rotY: group.rotation.y})),
    // The measurements this scene mounts by, for a host that needs the frame
    // rather than one point in it. `faceZ` is only ever meaningful with
    // `recess`, which is why they are handed over together rather than as a
    // constant somebody has to pair up correctly on their own.
    metrics: () => ({RU, rackWidth: RACK_W, faceZ: RACK_FACE_Z, recess: RECESS,
                     heightRU: UNITS, pxmm: PXMM}),
    resize,
    reframe: frameCamera,
    // Stop and restart the render loop, for a host that knows it is not seen.
    pause() { running = false; cancelAnimationFrame(raf); raf = 0; },
    resume() { if (alive && !running) { running = true; tick(); } },
    running: () => alive && running,
    // What the scene resolved: the stack with chassis, bays and the component
    // index filled in, and the height it settled on. Asked for in
    // roc-ops/portrayal-site#10 - a consumer that used to compute heightRU from
    // chassis.ru should not have to re-fetch what this just read.
    resolved: () => ({heightRU: UNITS, stack: RESOLVED.map(e => ({...e}))}),
    // Export what is on screen, including whatever is currently seated in a bay.
    toGLB: () => toGLB(scene),
    toUSDZ: () => toUSDZ(scene),
    three: {THREE, scene, camera, renderer, controls},
    // Resolves when the deferred faces - sides, rear, underside - have all been
    // installed. build() does not wait for these on purpose; this is here for a
    // host that wants a complete scene before exporting or grabbing a still.
    complete: async () => { await Promise.all(pending); },
    dispose() {
      alive = false;
      dropAnchorDocs();
      epoch++;      // stops any deferred relief pass from touching a dead scene
      pending = [];  // and drops the closures it was holding
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener('dblclick', onDblClick);
      controls.dispose();
      for (const m of mounted) { disposeTree(m.group); disposeTree(m.ears); }
      mounted.length = 0;
      disposeTree(scene);
      scene.clear();
      clearSvgOverrides(relief);
      renderer.dispose();
      // A GL CONTEXT IS NOT RELEASED WHEN THE LAST REFERENCE DROPS. The browser
      // keeps around sixteen alive and silently kills the oldest, so a page that
      // builds and tears down scenes - entering and leaving this tab - runs out
      // and the next one fails to start. renderer.dispose() frees the objects,
      // not the context; only this frees the context. viewer3d.js has always
      // done it and this module never has.
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}
