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
import { applyFields } from './rack/face.js';
import { earPlan, frontWidthOfText } from '../vendor/ears2d.js';
import { RU, RAIL_W, HOLE_DY, HOLE_SIZE, SIDES } from '../vendor/rack/rails.js';
import { earHoles } from './rack/ear-holes.js';
import { itemBox, unitsOf } from '../vendor/rack/fit.js';

// what fields.js paintFields stashes a node's drawn value under
const STASHED = ['data-portrayal-fill', 'data-portrayal-stroke', 'data-portrayal-r',
                 'data-portrayal-transform', 'data-portrayal-display'];

export { RU };                    // EIA-310 rack unit; rails.js is the one source
const RACK_W = 482.6;               // 19in rail-to-rail outer width
const RACK_FACE_Z = 11;             // front plane of the mounting posts
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
  // `span` and `centre` are `wide` and `aimX` for a scene whose tags are laid
  // out: `span` times the width from the farthest tag to the right rail, and how
  // much of the way to the middle of that width the camera looks.
  iso:   {dir: [0.4647, 0.1608, 0.8707], aim: 0.42, margin: 1.72, z: -60,
          wide: 1.1, aimX: 0, span: 0.75, centre: 0.5},
  front: {dir: [0, 0, 1],                aim: 0.50, margin: 1.12, z: -60,
          wide: 2.4, aimX: -0.28, span: 1.5, centre: 1},
};
// Face raster density for the rack. The single-device viewer defaults to 4 and
// is looked at from arm's length; a rack is seen from further back, across six
// devices at once, so it had no business being denser than the close-up. Kept
// as an option because a host wanting a poster-quality still can pay for it.
const PXMM_RELIEF = 5;
// The top and underside, which a rack almost entirely hides - see the note by
// COARSE below.
const PXMM_HIDDEN = 2;

// THE FACES ARE RASTERISED ON THE CPU while a scene that asks for it is alive
// (`opts.cpuCanvases`; the Rack Builder's). relief.js cuts every face, and
// every part of one, as a 2D canvas, and keeps it as its texture's image. A
// browser puts a 2D canvas of any size on the GPU, so on a large rack those
// canvases held more GPU memory than the textures drawn from them: 1.6 GB of
// 2.5 GB, measured on one, before a single cable was hung. A 2D context asked
// for with no options is asked for with `willReadFrequently`, which keeps it
// in main memory; the textures uploaded from it are the same. One rule for the
// page while any such scene is alive (counted), and gone with the last.
// (put back only if it is still this rule: one laid over it since is left standing)
let cpuCanvasScenes = 0, ownGetContext = null, cpuGetContext = null;
function holdCpuCanvases() {
  if (cpuCanvasScenes++ === 0) {
    ownGetContext = HTMLCanvasElement.prototype.getContext;
    const own = ownGetContext;
    cpuGetContext = function (kind, options, ...rest) {
      return own.call(this, kind, kind === '2d' && options === undefined ? {willReadFrequently: true} : options, ...rest);
    };
    HTMLCanvasElement.prototype.getContext = cpuGetContext;
  }
}
function releaseCpuCanvases() {
  if (cpuCanvasScenes > 0 && --cpuCanvasScenes === 0) {
    if (HTMLCanvasElement.prototype.getContext === cpuGetContext) HTMLCanvasElement.prototype.getContext = ownGetContext;
    ownGetContext = cpuGetContext = null;
  }
}

// A device face's texture is cut where its cavities and modules are, and the cut is not drawn.
const FACE_ALPHA_TEST = 0.08;

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
  //
  // setLabelColors() takes the same three later, for a host whose reader picks
  // the stage after the scene is built (the Rack Builder's swatches).
  const LABEL_DEFAULTS = {tag: '#D7DBDF', unit: '#6B727A', emph: '#E4E7EA'};
  const labelTones = o => ({
    tag: o.labelColor ?? LABEL_DEFAULTS.tag,
    unit: o.labelUnitColor ?? o.labelColor ?? LABEL_DEFAULTS.unit,
    emph: o.labelEmphasisColor ?? LABEL_DEFAULTS.emph,
  });
  let LABEL = labelTones(opts);

  // How far back every faceplate sits from the mounting rails. FLUSH UNLESS
  // TOLD (decided 2026-10-11, with rack file version 4): the kit stands a
  // faceplate on its rail plane unless the file states a setback, and so does
  // this. It was 30 mm unless told, the setback the showcase was first drawn
  // with, which put every plug of a scene built without the option 30 mm
  // behind the path the kit starts it at. An entry's own `setback` (mm, the
  // kit's fit.js setbackOf: the item's, its device's ear position or the
  // frame's) is added to it for that entry.
  const RECESS = opts.recess ?? 0;

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
  // (faces rasterised in main memory while this scene is alive: holdCpuCanvases,
  // above; taken once the renderer stands, so a scene that never starts holds nothing)
  const CPU_CANVASES = !!opts.cpuCanvases;
  if (CPU_CANVASES) holdCpuCanvases();
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  container.append(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  // FEWER FRAMES WHILE THE DETAIL IS BEING BUILT (`opts.buildFrameMs`,
  // portrayal-site#192). A rack in full detail is tens of thousands of draw
  // calls a frame (40,000 for 25 parts with 43 cables), and the loop below
  // drew one at every animation frame while the relief pass was still adding
  // to it: on a fast GPU a quarter of the build's time went on frames nobody
  // was steering, and with software GL nearly all of it, so a large rack never
  // finished. A host that passes `buildFrameMs` gets a frame at most that
  // often WHILE A DETAIL PASS IS RUNNING AND NOBODY IS HANDLING THE VIEW: the
  // scene still fills in as it is built, a few times a second. The moment the
  // pointer moves over the stage, a button or the wheel is used, or the camera
  // is still easing to rest, every frame is drawn as before; and once the
  // detail is in, every frame is drawn as before. Nothing is drawn that was
  // not, and no other caller passes the option.
  // AND NEVER MORE THAN A FIFTH OF THE TIME: where a frame is slow (software
  // GL takes over a second for one), `buildFrameMs` apart is back to back, so
  // the wait is also four times what the last frame took, measured to the
  // next animation frame the browser gave.
  const BUILD_FRAME_MS = opts.buildFrameMs > 0 ? opts.buildFrameMs : 0;
  const HANDLED_MS = 1000;      // how long after the last touch the view counts as handled (the easing runs on)
  let detailing = 0, lastFrame = -Infinity, handledAt = -Infinity, handling = false, frameCost = 0, costDue = false;
  const onHandle = () => { handledAt = performance.now(); };
  const onHandleStart = () => { handling = true; }, onHandleEnd = () => { handling = false; handledAt = performance.now(); };
  // A CAMERA THAT HAS MOVED IS ALWAYS DRAWN. The controls move the camera in their own pointer handlers as well as
  // in the loop's update(), so "did update() move it" misses a drag's last step; their `change` event does not.
  // Until that frame is drawn the camera's matrices are the last frame's, and a host asking what is under the
  // pointer (the Rack Builder's hover) would be answered for a view that is no longer the one on screen.
  let cameraMoved = false;
  const onCameraMoved = () => { cameraMoved = true; };
  // HOW FAR THE CAMERA HAS MOVED from a pose taken earlier (`poseOf`: where it
  // is and what it looks at, which is all the controls change), as a share of
  // its distance to its target: the controls ease to rest by ever smaller
  // steps, for seconds after a drag, long after a step is too small to see.
  const poseOf = () => ({p: camera.position.clone(), t: controls.target.clone()});
  const movedFrom = (pose, share) => {
    const d = Math.max(1, camera.position.distanceTo(controls.target));
    return camera.position.distanceTo(pose.p) / d > share || controls.target.distanceTo(pose.t) / d > share;
  };
  // A FRAME ONLY WHEN SOMETHING ASKS FOR ONE (opt-in, `opts.onDemand`; the Rack
  // Builder's). A rack in detail is tens of thousands of draw calls a frame, and
  // the loop drew one at every animation frame whether anything had changed or
  // not: 39% of a finished large scene's main thread was redrawing a picture
  // nobody had touched. With the option a frame is drawn only once the scene is
  // `dirty`: the camera moved (the controls' `change`, a resize, a reframe),
  // something was added to the scene or restyled in it (this file's own builds
  // and its setters, and a host's restyle through `requestFrame()`), or the
  // reader did anything at all (a pointer, a key or the wheel anywhere in the
  // document, which is where every hover and pick starts). The loop still runs
  // at every animation frame, so the controls ease as before; it only stops
  // drawing the same picture again. Without the option every frame is drawn.
  // A camera easing to rest is drawn only once it has moved DRAW_MOVE (about an
  // eighth of a pixel on a stage 1000 px tall) from the frame on screen, so its
  // last unseen steps draw nothing and the picture is never further than that
  // from the camera.
  const ON_DEMAND = !!opts.onDemand;
  const DRAW_MOVE = 1e-4;
  let dirty = true, drawnPose = null;
  const requestFrame = () => { dirty = true; };
  const READER_EVENTS = ['pointermove', 'pointerdown', 'pointerup', 'keydown', 'keyup', 'wheel'];
  if (ON_DEMAND) for (const type of READER_EVENTS) document.addEventListener(type, requestFrame, {capture: true, passive: true});
  if (BUILD_FRAME_MS || ON_DEMAND) controls.addEventListener('change', onCameraMoved);
  // LIGHTER WHILE MOVING (opt-in, `opts.lightWhileMoving`; the Rack Builder's).
  // A device's relief detail - every cage, port, plug, pin and vent as a mesh
  // of its own - is nearly all of a large rack's draw calls (139,000 a frame
  // on one, 650 ms a frame on a fast GPU), and while the camera is dragged or
  // zoomed nobody reads it. So with the option the relief of a device with a
  // body is drawn on a layer of its own (RELIEF_LAYER), and while the camera
  // is handled - from the controls' `start` (a press on the stage, the wheel)
  // until MOTION_REST_MS after their `end` and the camera's last move (its
  // easing included) - the camera does not show that layer: the device is its
  // faces, flat, and a module seated in it its own faceplate (its textured
  // plane stays on the common layer), and the holes its face is punched with
  // for its cavities are drawn dark (the face's own materials, opaque while
  // moving) rather than see-through. At rest the detail is drawn again. A
  // sheet part (a lacer, a manager) is nothing but its detail, and keeps it.
  // Hover picking rays the cables and bundles only (hover.js hoverAt3d, on
  // the common layer), so it is the same moving or not.
  const LIGHT_MOVING = !!opts.lightWhileMoving;
  const RELIEF_LAYER = 1, MOTION_REST_MS = 200;
  camera.layers.enable(RELIEF_LAYER);
  const faceMats = new Set();      // the detailed faces' own materials, opaque while moving
  // (a step of the camera under LIGHT_MOVE, about half a pixel, is the easing's tail, not a move: the detail comes back)
  const LIGHT_MOVE = 3e-4;
  let lightHeld = false, movedAt = -Infinity, light = false, lightPose = poseOf(), lightTimer = 0, easedOut = false;
  // (the detail comes back from a timer of its own, not from the frame loop: the easing after a drag lasts a number of
  // FRAMES, so where frames are slow it outlasts the hand by seconds, and the restore waited for its last step. Once the
  // timer has restored the detail, the easing's remaining steps do not take it away again: `easedOut`, until the next press)
  function restoreLight() {
    lightTimer = 0;
    if (!alive || lightHeld) return;
    const left = MOTION_REST_MS - (performance.now() - movedAt);
    if (left > 0) { lightTimer = setTimeout(restoreLight, left); return; }
    easedOut = true;
    if (light) setLight(false);       // (which asks for the frame that draws it)
  }
  const armLight = () => { clearTimeout(lightTimer); lightTimer = setTimeout(restoreLight, MOTION_REST_MS); };
  if (LIGHT_MOVING) {
    // (from the controls' `start`, so a drag's first frame is already light, to MOTION_REST_MS after their `end` or the last move)
    controls.addEventListener('start', () => { lightHeld = true; easedOut = false; clearTimeout(lightTimer); lightTimer = 0; });
    controls.addEventListener('end', () => { lightHeld = false; movedAt = performance.now(); armLight(); });
    controls.addEventListener('change', () => {
      if (!easedOut && movedFrom(lightPose, LIGHT_MOVE)) { movedAt = performance.now(); if (!lightHeld) armLight(); }
      lightPose = poseOf();
    });
  }
  // (a mesh kept on the common layer while moving: a module's faceplate, or a piece of art, drawn as a textured plane)
  const flatPart = o => o.geometry?.type === 'PlaneGeometry' && !Array.isArray(o.material) && o.material?.isMeshBasicMaterial && !!o.material.map;
  function setLight(on) {
    light = on;
    if (on) camera.layers.disable(RELIEF_LAYER); else camera.layers.enable(RELIEF_LAYER);
    for (const m of faceMats) {
      if (on) { m.transparent = false; m.alphaTest = 0; } else { m.transparent = true; m.alphaTest = FACE_ALPHA_TEST; }
      m.needsUpdate = true;
    }
    requestFrame();
  }
  if (BUILD_FRAME_MS) {
    controls.addEventListener('start', onHandleStart);
    controls.addEventListener('end', onHandleEnd);
    for (const type of ['pointermove', 'pointerdown', 'wheel']) renderer.domElement.addEventListener(type, onHandle, {passive: true});
  }
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
  // NO FACE RASTER LONGER THAN `opts.maxFacePx` ON A SIDE (opt-in; the Rack
  // Builder passes 4096). A part standing the height of the rack is 1867 mm
  // tall: at 5 px/mm one face is a 9335 px canvas and a 9335 px texture,
  // past what many GPUs take at all, and the four on one large rack held more
  // GPU memory between them than a dozen switches. Such a part is drawn at
  // the density that fits, its own scope copied from the one it would have
  // had, with only the density changed (same overrides, states and paths).
  const MAX_FACE_PX = opts.maxFacePx > 0 ? opts.maxFacePx : 0;
  const capped = new Map();
  const cappedScope = (base, mm) => {
    const px = base.pxmm ?? PXMM;
    if (!MAX_FACE_PX || !(mm * px > MAX_FACE_PX)) return base;
    const want = Math.floor(MAX_FACE_PX / mm * 100) / 100, key = `${base === COARSE ? 'c' : 'r'}${want}`;
    if (!capped.has(key)) capped.set(key, {...base, pxmm: want});
    return capped.get(key);
  };
  // (the face's longest side in mm, as faceFrames lays it: front and rear W x H, the sides D x H, top and bottom W x D)
  const scopeFor = (view, chassis = null) => {
    const {w = 0, h = 0, d = 0} = chassis || {};
    return (view === 'top' || view === 'bottom') ? cappedScope(COARSE, Math.max(w, d))
      : cappedScope(relief, view === 'left' || view === 'right' ? Math.max(d, h) : Math.max(w, h));
  };

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
  // (tagMinX, tagMaxX: x of the farthest front tag's outer edge on the left and of the farthest
  // rear tag's on the right, null until layoutTags has run or while a column is empty;
  // framed: the view last framed; cameraTouched: the viewer has moved it since)
  let tagMinX = null, tagMaxX = null, framed, cameraTouched = false;
  controls.addEventListener('start', () => { cameraTouched = true; });
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
    // THE TAGS' OWN REACH, once they are laid out (layoutTags): the picture is
    // centred on the span from the farthest front tag's edge to the farthest rear
    // tag's (the right rail's outer edge while there is none), and given room by
    // that span, not by a fixed guess at it.
    const tagged = tagMinX !== null || tagMaxX !== null;
    const left = tagMinX ?? -(RACK_W / 2 + 10), right = tagMaxX ?? RACK_W / 2 + 10;
    const target = new THREE.Vector3(!tagged ? RACK_W * (v.aimX || 0) : (left + right) / 2 * v.centre, H * v.aim, v.z);
    controls.target.copy(target);
    framed = which;
    cameraTouched = false;

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
    const across = !tagged ? RACK_W * v.wide : (right - left) * v.span;
    const need = Math.max(H / (2 * half), across / (2 * half * aspect),
                          (depth * 1.15) / (2 * half * aspect));
    camera.position.copy(target)
      .addScaledVector(new THREE.Vector3(...v.dir), need * v.margin);

    controls.update();                       // now a no-op delta
    controls.enableDamping = damped;
    requestFrame();
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
  // The text is drawn white and tinted by the material, so a label changes
  // colour without being drawn again: `tone` is which of LABEL's it follows.
  function labelSprite(text, px, tone) {
    const cv = document.createElement('canvas');
    const probe = cv.getContext('2d');
    probe.font = `600 ${px}px ui-monospace, monospace`;
    cv.width = Math.ceil(probe.measureText(text).width) + 12;
    cv.height = px + 12;
    const c = cv.getContext('2d');
    c.font = `600 ${px}px ui-monospace, monospace`;
    c.fillStyle = '#ffffff';
    c.textBaseline = 'middle';
    c.fillText(text, 6, cv.height / 2);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({map: tex(cv), depthTest: false,
                                                        color: new THREE.Color(LABEL[tone])}));
    s.scale.set(cv.width / px * 22, cv.height / px * 22, 1);
    s.userData.labelTone = tone;
    return s;
  }

  // ── rack ───────────────────────────────────────────────────────────────
  const railMat = new THREE.MeshLambertMaterial({color: 0xB9BFC6});
  const holeMat = new THREE.MeshBasicMaterial({color: 0x15181b});
  // THE GENERIC EAR IS SILVER (Portrayal #909, relief.js EAR.SILVER #c8cacc)
  // unless the device states `chassis.ears.color`: one material per colour.
  const earMats = new Map();
  const earMatOf = color => {
    const c = color || '#c8cacc';
    if (!earMats.has(c)) earMats.set(c, new THREE.MeshLambertMaterial({color: new THREE.Color(c)}));
    return earMats.get(c);
  };
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
        // (numbered as the caller's frame counts, when it says how: `opts.unitLabel`, 1 at the bottom otherwise)
        const num = typeof opts.unitLabel === 'function' ? opts.unitLabel(u + 1) : u + 1;
        const n = labelSprite(String(num), 30, num % 5 === 0 ? 'emph' : 'unit');
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
    requestFrame();
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
  //
  // THE EAR IS AS TALL AS THE SPAN ITS ITEM FILLS, `lo` to `hi` in mm above
  // the bottom of the rails (the kit's fit.js itemBox), and is fixed at the
  // rail holes that span holds (ear-holes.js, over the kit's holesIn), as the
  // 2D elevation draws it: two screws a unit, a unit's middle hole left
  // empty, and one screw for a half unit, at the one hole that half holds.
  function rackEars(lo, hi, halfW, depth, mountZ = RACK_FACE_Z, dir = 1, earMat = earMatOf(null)) {
    const g = new THREE.Group();
    const h = hi - lo - (hi - lo >= RU ? 4.5 : 2);
    const yMid = (lo + hi) / 2;
    const screws = earHoles(lo, hi);
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
      // no bracket where the ears are the device's own (earMat null): its
      // face draws them, and only the screws holding it to the rail are added
      if (earMat) {
        const flange = new THREE.Mesh(new THREE.BoxGeometry(24, h, 3), earMat);
        flange.position.set(earX, yMid, mountZ + dir * 1.5);
        g.add(flange);
        const leg = new THREE.Mesh(new THREE.BoxGeometry(3, h, legLen), earMat);
        leg.position.set(side * (halfW + 1.5), yMid, mountZ - dir * legLen / 2);
        g.add(leg);
      }
      for (const y of screws) {
        const head = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 2.2, 14), screwMat);
        head.rotation.x = Math.PI / 2;
        head.position.set(holeX, y, mountZ + dir * 4.1);
        g.add(head);
      }
    }
    return g;
  }

  // ── devices ────────────────────────────────────────────────────────────
  const mounted = [];   // {entry, group}
  // The leader lines from each device tag to its device. Their own group, so an
  // export can set them aside (withoutLeaders) and they are cleared on rebuild.
  const leaders = new THREE.Group();
  leaders.name = 'tag-leaders';
  scene.add(leaders);
  const TAG_GAP = 120;      // mm clear between the farthest part beside the rack and the tags' inner edge
  const TAG_GAP_Z = 40;   // mm clear in front of the rack's frontmost part, so a tag clears it from the side too
  const TAG_GAP_Z_REAR = 120;   // the same behind the rearmost part, more of it: from the left side the rear column is the far one, and perspective draws it in toward the rack
  const TAG_STEP = 4;      // mm between two tags in a column
  // The scene without its leaders for as long as `fn` runs (an export): a Line is
  // written to a GLB, unlike a sprite.
  async function withoutLeaders(fn) {
    scene.remove(leaders);
    try { return await fn(); } finally { if (alive) scene.add(leaders); }
  }
  function clearLeaders() {
    for (const l of [...leaders.children]) { leaders.remove(l); l.geometry.dispose(); l.material.dispose(); }
  }

  // THE TAGS STAND IN ONE COLUMN OUTSIDE EVERYTHING BESIDE THE RACK, each with a
  // leader to its device. The column's inner edge is read from the scene - the
  // farthest left of anything in it but the tags: a part beside the rack, a cable
  // run - and its depth from the frontmost part, so from the side a tag is beside
  // the rack rather than over it. Tags are right-aligned, so a leader leaves each
  // at one x. Two devices at one height do not share a place: the column steps
  // down, a tag never above the one before it. Run when the scene is complete,
  // and again by a host that stands parts or hangs cables after build().
  const extent = new THREE.Box3(), partBox = new THREE.Box3();
  function layoutTags() {
    clearLeaders();
    const tags = mounted.filter(m => m.tag).sort((a, b) => b.group.position.y - a.group.position.y);
    if (!tags.length) { tagMinX = tagMaxX = null; requestFrame(); return; }
    let outer = -RACK_W / 2, outerR = RACK_W / 2, front = RACK_FACE_Z, rear = RACK_FACE_Z;
    for (const o of scene.children) {
      if (o === leaders || o.isLight || o.isSprite) continue;
      partBox.makeEmpty().expandByObject(o);
      if (partBox.isEmpty()) continue;
      outer = Math.min(outer, partBox.min.x);
      outerR = Math.max(outerR, partBox.max.x);
      if (o.name !== 'patch-cables') { front = Math.max(front, partBox.max.z); rear = Math.min(rear, partBox.min.z); }   // (a cable run is not a part a tag must clear in depth)
    }
    // A tag is REAR when its part stands at the rear: a rear-facing device, or a zero-U part at a rear
    // upright. A part spanning front to back (full depth) keeps its tag at the front.
    const atRear = m => {
      extent.setFromObject(m.group);
      if (extent.min.z <= REAR_FACE_Z + 1 && extent.max.z >= RACK_FACE_Z - 1) return false;
      const zu = m.group.userData.zeroU;
      return zu ? /rear$/.test(zu.at) : m.entry.face === 'rear';
    };
    const colL = outer - TAG_GAP, colR = outerR + TAG_GAP;
    const floors = {front: Infinity, rear: Infinity};
    let min = null, max = null;
    for (const m of tags) {
      const isRear = atRear(m), side = isRear ? 'rear' : 'front';
      const w = m.tag.scale.x, h = m.tag.scale.y;
      const y = Math.min(m.group.position.y, floors[side] - h / 2 - TAG_STEP);   // (floor: the bottom edge of the tag above, in this column)
      // front column: left of everything, right-aligned, in front; rear column: right of everything, left-aligned, behind
      const col = isRear ? colR : colL;
      m.tag.position.set(isRear ? col + w / 2 : col - w / 2, y, isRear ? rear - TAG_GAP_Z_REAR - w / 2 : front + TAG_GAP_Z + w / 2);
      floors[side] = y - h / 2;
      if (isRear) max = Math.max(max ?? -Infinity, col + w); else min = Math.min(min ?? Infinity, col - w);
      // the leader ends on the near face of the part: inside its edge nearest the column, at the tag's own height or the nearest the part has
      extent.setFromObject(m.group);
      const end = new THREE.Vector3(isRear ? extent.max.x - 20 : extent.min.x + 20, Math.min(Math.max(y, extent.min.y + 4), extent.max.y - 4),
                                    isRear ? extent.min.z : extent.max.z);
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(col, y, m.tag.position.z), end]),
                                  new THREE.LineBasicMaterial({color: new THREE.Color(LABEL.unit), depthTest: false, transparent: true, opacity: 0.85}));
      line.userData.labelTone = 'unit';
      line.userData.leaderOf = m.entry.id ?? null;
      line.renderOrder = 1;
      leaders.add(line);
    }
    tagMinX = min; tagMaxX = max;
    if (!cameraTouched) frameCamera(framed);   // the opening view is fitted to the tags; one the viewer has moved is left alone
    requestFrame();   // (the tags moved and the leaders are new)
  }

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
  // ONE BUILD FOR EVERY MOUNT OF A PLAIN PART (opt-in, `entry.share`). Fifty-six
  // of one lacer on a large rack were fifty-six identical sets of canvases,
  // textures and relief meshes - most of the build's time and of its GPU
  // memory. A mount the host marks `share` (the Rack Builder: a part no cable,
  // swap or written field reaches, so nothing is seated in it and nothing of it
  // is dimmed or painted for itself) and that has no face of its own in this
  // scene (SYNTH: a bay swap, a part pulled) is built from the first mount of
  // the same faces at the same size: one geometry, one set of materials and
  // textures. Cleared with the mounts (buildAll, dispose).
  const SHARED = new Map();
  function shareKey(entry) {
    if (!entry.share || pulledFor(entry).size) return null;
    if (RACK_VIEWS.some(v => SYNTH.has(faceKey(entry, v)))) return null;
    const {w, h, d, shell} = entry.chassis || {};
    return `${faceUrl(entry, 'front')}|${w}x${h}x${d}|${shell ?? ''}`;
  }
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
    const ov = entry.overrides || {};
    const fields = entry.fields || {};
    const hasFields = Object.keys(fields).length > 0;
    if (!Object.keys(ov).length && !hasFields) return;
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
    const seated = Object.keys(ov).length
      ? await seatViews(faces, {bays: entry.bays, cages: entry.cages}, ov, loadSkin, byRef) : {};
    // WHAT WAS WRITTEN ON A PART (item.fields: an optic's latch colour, its
    // label), painted into the same text with the rule 2D uses (face.js
    // applyFields -> fields.js paintFields), after the seating so a seated
    // optic is there to paint. Painted into THIS mount's text rather than into
    // relief's scope-wide field registry: that one is keyed by data-path alone
    // and a scene holds many devices whose optics share a path.
    // The stash paintFields leaves (the colour as drawn) is taken off again:
    // relief repaints the registry over every document it reads and puts back
    // whatever a stash names, which would undo this.
    if (hasFields) {
      for (const [view, root] of Object.entries(faces)) {
        applyFields(root, fields);
        for (const attr of STASHED) {
          root.removeAttribute(attr);
          for (const n of root.querySelectorAll(`[${attr}]`)) n.removeAttribute(attr);
        }
        seated[view] = {...(seated[view] || {}), applied: true};
      }
    }
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
      {map: canvasTex(cv), transparent: true, alphaTest: FACE_ALPHA_TEST}) : plain();

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
    // A PART BUILT ONCE FOR EVERY MOUNT OF IT (`shareKey`, below): a mount after
    // the first takes the first's materials and, as they arrive, its detail.
    const key = shareKey(entry);
    const tpl = key && SHARED.get(key);
    const flatCv = {};
    if (!tpl) await Promise.all([
      ...FACES.map(F => svgCanvas(f(F.view), F.fw(), F.fh(), false, false,
                                  scopeFor(F.view, entry.chassis))
        .then(cv => { flatCv[F.view] = cv; }).catch(() => {})),
      svgCanvas(f('bottom'), W, D, true, true, scopeFor('bottom', entry.chassis))
        .then(cv => { flatCv.bottom = cv; }).catch(() => {}),
    ]);
    // (the same array, not a copy, for a shared part: the detail pass puts each
    // face's finished material into it, and every mount of the part shows it)
    const mats = tpl ? tpl.body.material : ['right', 'left', 'top', 'bottom', 'front', 'rear']
      .map(v => mat(flatCv[v]));

    const group = new THREE.Group();
    // NAMED ONLY WHEN THE CALLER NAMES THE MOUNT. The Rack Builder passes each
    // item's id, so its GLB says which node is which device; the showcase and
    // the hero pass none, so their scenes and exports are exactly as before.
    if (entry.id) group.name = `device-${entry.id}`;
    const body = new THREE.Mesh(tpl ? tpl.body.geometry : new THREE.BoxGeometry(W, H, D), mats);
    // A SHEET BODY HAS NO SIDES (upstream docs/cable-managers-design.md §4):
    // its views are elevations, so painting them on a box stands a picture of
    // the part on every side. The box stays, invisible, as the frame its relief
    // is built in - as kit/viewer3d.js does.
    // (a shared part's materials are the first mount's, already set, and perhaps lent to its stand-in now)
    const sheet = entry.chassis?.shell === 'sheet';
    if (sheet && !tpl) for (const m of mats) m.visible = false;
    if (tpl?.body.userData.standIn) body.userData.standIn = tpl.body.userData.standIn;
    // (the first mount of a shared part keeps the record the others are built from)
    const rec = key && !tpl ? {body, sharers: [], faces: [], detail: null} : null;
    if (rec) SHARED.set(key, rec);
    group.add(body);
    meshes.forEach(m => group.add(m));
    // A SHEET BODY STANDS AS A PLAIN BOX UNTIL ITS DETAIL ARRIVES
    // (`opts.standIn`, portrayal-site#190). Everything a sheet part is made
    // of is built by the relief pass below, which is not awaited: until it
    // lands the part is not there at all, and whatever a host hangs in or on
    // it (the Rack Builder's lane cables and their straps, in a vertical
    // manager) hangs in the air. So its box, which is there already as the
    // frame its relief is built in, is shown at once: plain and see-through,
    // a body that is still being built. The first face of detail hides it
    // again, exactly as it was, and that is before complete() resolves.
    // IT IS THE BOX ITSELF, WITH ITS OWN MATERIALS LENT, not a second mesh: a
    // new mesh, geometry or material would take an id, and a USDZ names its
    // parts by those, so every file after would differ by a number. No other
    // caller passes the option.
    let stoodIn = null;
    if (sheet && opts.standIn && !tpl) {
      stoodIn = mats.map(m => ({m, own: {visible: m.visible, map: m.map, color: m.color.getHex(), transparent: m.transparent, opacity: m.opacity,
                                         alphaTest: m.alphaTest, depthWrite: m.depthWrite}}));
      for (const {m} of stoodIn) {
        m.visible = true; m.map = null; m.color.setHex(0x3a3f44); m.transparent = true; m.opacity = 0.35; m.alphaTest = 0; m.depthWrite = false;
        m.needsUpdate = true;
      }
      body.userData.standIn = true;
    }
    const dropStandIn = () => {
      if (!stoodIn) return;
      for (const {m, own} of stoodIn) {
        m.visible = own.visible; m.map = own.map; m.color.setHex(own.color); m.transparent = own.transparent; m.opacity = own.opacity;
        m.alphaTest = own.alphaTest; m.depthWrite = own.depthWrite; m.needsUpdate = true;
      }
      for (const b of [body, ...(rec?.sharers ?? []).map(s => s.body)]) delete b.userData.standIn;
      stoodIn = null;
    };

    // THE SPAN IT FILLS, AND WHERE ITS BODY IS IN IT: the kit's (fit.js
    // itemBox). `lo` and `hi` are the edges of the span, in mm above the
    // bottom of the rails, from the catalogue's height in units (in halves
    // since rack file version 4: a half-unit panel at 12.5 is the upper half
    // of U12); the body is centred in it, always, as the 2D elevation, the
    // side panes and the kit's solids have it. It stood on the bottom of its
    // lowest unit here, up to 6.35 mm below where the kit's routes took it to
    // be. Without a catalogue entry the span is the drawing's height in units.
    // A part beside the rack is no rack item: it stands on its bottom, in
    // millimetres (`mm`, the kit's zeroUBottomMm, as its solid does since kit
    // 0.30.0, #1030), else on its bottom unit.
    const box = entry.chassis?.ru != null && entry.mount !== 'rack-side'
      ? itemBox(null, {ru: entry.ru, ref: entry.ref, roll: entry.roll}, () => entry.chassis)
      : (u => { const lo = Number.isFinite(entry.mm) ? entry.mm : (entry.ru - 1) * RU; return {lo, hi: lo + u * RU}; })(Math.max(1, Math.round(H / RU)));
    // WHICH RAIL THIS ENTRY BOLTS TO. `face: 'rear'` (default 'front') mounts
    // on the rear plane instead of the front one - REAR_FACE_Z on a four-post
    // frame, or the back of the single front pair otherwise (REAR_MOUNT_Z).
    // `turned` is the general name for what `reversed` always meant here:
    // the device's OTHER panel faces out. `reversed` keeps working - it is
    // read as a synonym, never required alongside `turned`.
    const face = entry.face === 'rear' ? 'rear' : 'front';
    const turned = !!(entry.turned ?? entry.reversed);
    const mountZ = face === 'rear' ? REAR_MOUNT_Z : RACK_FACE_Z;
    // A RACK-FACE PART (spec §8) has its mounting face on the rail plane and
    // its body outward: toward the viewer from the front rails, away from the
    // rear ones. A rack device's body goes the other way, between the rails.
    const rackFace = entry.mount === 'rack-face';
    const back = RECESS + (Number.isFinite(entry.setback) ? entry.setback : 0);
    const z = rackFace
      ? (face === 'rear' ? mountZ - D / 2 : mountZ + D / 2)
      : (face === 'rear' ? mountZ + back + D / 2 : mountZ - back - D / 2);
    group.position.set(0, entry.mount === 'rack-side' ? box.lo + H / 2 : (box.lo + box.hi) / 2, z);
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
    //
    // AND NONE WHERE THE KIT'S PLAN GIVES NONE (Portrayal #909, ears2d.js
    // earPlan): a front as wide as the rack face has its ears built in - a
    // blanking panel, a shelf, a full-width patch panel - and its own face
    // draws them; a sheet body, or ears stated `behind`, get none either.
    // Judged on the front's declared width, as the 2D elevation judges it.
    // Such a device still gets the screw heads that hold it to the rail.
    const frontW = await svgSource(f('front'), relief).then(frontWidthOfText).catch(() => null);
    const noEars = !!entry.mount && entry.mount !== 'rack';
    const plan = noEars ? null : earPlan(entry.index || {chassis: entry.chassis}, frontW);
    const ears = noEars ? new THREE.Group()
      : rackEars(box.lo, box.hi, W / 2, D, mountZ, face === 'rear' ? -1 : 1, plan ? earMatOf(plan.color) : null);
    ears.userData.ears = noEars ? null : plan ? 'generic' : 'built-in';
    if (entry.id && !noEars) ears.name = `ears-${entry.id}`;   // named as the device is, only when the caller names mounts
    scene.add(ears);

    // The device's tag, beside the left rail - a rail label, so it goes with
    // the rails. None for a part the caller marks `untagged` (the Rack Builder
    // marks its cable managers): they take no row either, so the equipment
    // tags close up toward the rail.
    let tag = null;
    if (RAILS && !entry.untagged) {
      tag = labelSprite(entry.label, 30, 'tag');
      tag.userData.tagOf = entry.id ?? null;   // (the device it names, by the id its group is named by)
      // (where it stands is layoutTags's, once the whole rack is: this is only
      // a place for it while the rack is still being built)
      tag.position.set(-(RACK_W / 2 + 120) - tag.scale.x / 2, group.position.y, 46);
      scene.add(tag);
    }
    scene.add(group);
    mounted.push({entry, group, tag, ears});
    // A HOST THAT STANDS A MOUNT SOMEWHERE OF ITS OWN (`opts.onMount`) does it
    // here, before the mount is ever drawn, not after the whole stack is
    // built: the Rack Builder's parts beside the rack (rack/scene3d.js).
    opts.onMount?.({id: entry.id ?? null, ref: entry.ref, group});
    requestFrame();

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
    // A LATER MOUNT OF A SHARED PART builds no detail of its own: each face's
    // detail, as the first mount's pass lands it, is copied into this group
    // (Object3D.clone: new meshes on the same geometry and materials), and
    // the host styles it as it would its own (`opts.onFace`). Its scene is
    // complete when the first mount's is.
    if (tpl) {
      const take = (view, per) => {
        const copies = per.map(m => m.clone());
        copies.forEach(m => group.add(m));
        if (copies.length) opts.onFace?.({id: entry.id ?? null, ref: entry.ref, view, group, meshes: copies});
        requestFrame();
      };
      tpl.sharers.push({entry, body, take});
      for (const {view, per} of tpl.faces) take(view, per);
      if (tpl.body.userData.standIn === 'failed')
        opts.onDetailFailed?.({id: entry.id ?? null, ref: entry.ref, label: entry.label ?? entry.ref, error: null});
      pending.push(tpl.detail);
      return group;
    }
    const mine = epoch;
    const shownNow = VISIBLE_FACES[VIEW] || VISIBLE_FACES.iso;
    const order = [...FACES].sort((a, b) =>
      (shownNow.has(b.view) ? 1 : 0) - (shownNow.has(a.view) ? 1 : 0));
    const detail = (async () => {
      // (held until the host lets the detail start, then a few at a time: `opts.holdDetail`, below)
      if (detailHeld) { await detailHeld; await detailTurn(); }
      try {
        if (mine !== epoch) return;
        for (const F of order) {
          const per = [];
          await buildFaceRelief(F, {scope: scopeFor(F.view, entry.chassis), src: f(F.view), faceCv, faceSvg,
            facePunch, meshes: per, FRU_GROUPS: {}, FRU_META: {}, BODY_META: {},
            D, bodyBoxMesh: null});
          if (mine !== epoch) return;
          // (the relief of a device with a body on its own layer, left out while the camera moves: `opts.lightWhileMoving`)
          if (LIGHT_MOVING && !sheet) for (const m of per) m.traverse(o => { if (!flatPart(o)) o.layers.set(RELIEF_LAYER); });
          per.forEach(m => { group.add(m); meshes.push(m); });
          // A HOST MAY STYLE A FACE'S DETAIL AS IT ARRIVES (`opts.onFace`): called
          // in the same task the meshes join the device, so nothing is drawn
          // between. The Rack Builder reads the covers off it (rack/covers.js).
          // No other caller passes it, and nothing here changes without it.
          if (per.length) opts.onFace?.({id: entry.id ?? null, ref: entry.ref, view: F.view, group, meshes: per});
          // (and every other mount of a shared part takes it, in the same task)
          if (rec && per.length) { rec.faces.push({view: F.view, per}); for (const s of rec.sharers) s.take(F.view, per); }
          if (per.length) dropStandIn();
          const i = MAT_SLOT[F.view], cv = faceCv[F.view];
          if (cv && body.material[i] && !sheet) {
            const prev = body.material[i];
            body.material[i] = mat(cv);
            if (LIGHT_MOVING) {
              faceMats.delete(prev); faceMats.add(body.material[i]);
              if (light) { body.material[i].transparent = false; body.material[i].alphaTest = 0; }
            }
            prev.map && prev.map.dispose();
            prev.dispose();
          }
          requestFrame();
        }
        dropStandIn();   // a part whose drawing builds nothing is not left as a box
        requestFrame();
      } catch (err) {
        // ITS DETAIL COULD NOT BE BUILT (a file that did not load): the box
        // stays, so nothing hangs in the air, but it is marked as one that
        // is not coming (duller, and `standIn: 'failed'`), and the host is
        // told once so its page can say so (`opts.onDetailFailed`). The
        // failure is still the pass's: complete() rejects as it did.
        if (mine === epoch && stoodIn) {
          for (const {m} of stoodIn) { m.color.setHex(0x5a4a3a); m.opacity = 0.2; m.needsUpdate = true; }
          for (const {entry: e, body: b} of [{entry, body}, ...(rec?.sharers ?? [])]) {
            b.userData.standIn = 'failed';
            opts.onDetailFailed?.({id: e.id ?? null, ref: e.ref, label: e.label ?? e.ref, error: err});
          }
          requestFrame();
        }
        throw err;
      } finally {
        if (detailHeld) detailDone();   // (the next device's pass may start)
      }
    })();
    if (rec) rec.detail = detail;
    // (complete() still rejects with it; this only keeps a failure the host was told of from also being an unhandled one)
    if (opts.onDetailFailed) detail.catch(() => {});
    // (counted while it runs, for the loop: fewer frames while a detail pass is in hand, `opts.buildFrameMs`)
    if (BUILD_FRAME_MS) { detailing++; const done = () => { detailing--; }; detail.then(done, done); }
    pending.push(detail);
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
      // `id` is the mount's own (a Rack Builder item's id): two mounts of one
      // model at any U are then told apart without naming a U.
      return mounted.find(m =>
        (which.id == null || m.entry.id === which.id) &&
        (which.ru == null || m.entry.ru === which.ru) &&
        (which.ref == null || m.entry.ref === which.ref) &&
        (which.label == null || m.entry.label === which.label)) || null;
    }
    // A rack may hold the same model twice, so a bare ref is the first of them.
    // Pass {ref, ru} - or {label} - to name which.
    return mounted.find(m => m.entry.ref === which)
        || mounted.find(m => m.entry.label === which) || null;
  }
  async function elementAnchor(which, find, o = {}) {
    const m = findMounted(which);
    if (!m) return null;
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
      try { el = find(doc); }
      catch (e) { return null; }        // a name that cannot be a selector
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
        view, path: el.getAttribute?.('data-path') ?? el.getAttribute?.('data-of') ?? null, id: el.id || null,
        mm: {x: r.x, y: r.y, w: r.w, h: r.h},
        ref: entry.ref, ru: entry.ru, label: entry.label,
      };
    }
    return null;
  }
  const portAnchor = (which, path, o = {}) => (path
    // (as its own drawing, or as the projection of a seated module's back, whose parts carry their path as data-of)
    ? elementAnchor(which, doc => doc.svg.querySelector(`[data-path="${CSS.escape(path)}"], [data-of="${CSS.escape(path)}"]`), o)
    : Promise.resolve(null));
  // WHERE A NAMED PART OF A MANAGER IS (spec §8), for routing in piece 2: a
  // ring is `guide-1` to `guide-5`, on the FHD-CMP5DR's top view (its front
  // only has the end rects), so the search covers every view.
  const guideAnchor = (which, elementId, o = {}) =>
    elementAnchor(which, doc => doc.svg.getElementById?.(elementId) ?? doc.svg.querySelector(`#${CSS.escape(elementId)}`), o);

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
      // (the face's cable points read once for it, not once for every cable
      // end asked after: 900 ends of one large rack read a 600-port face's
      // points 900 times, ten seconds of its build. The face text, and so
      // its points, are fixed for as long as the doc is cached: faceDoc.)
      const pts = (doc.cablePoints ??= cablePoints(doc.svg)).filter(p => p.at && (p.path === prefix + '-occupant'
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
  // something (a cable) out of the metal: the showcase and the hero, which
  // have no rack file. The Rack Builder does not read these: it keeps its
  // cables out of the kit's solid bodies (solids.js solidsOf, kit 0.11.0, by
  // way of rack/scene3d.js solidBoxes), in which a sheet part is its plates.
  function deviceBoxes() {
    // Here a sheet manager is left out whole: its envelope is mostly open.
    return mounted.filter(({entry}) => entry.chassis?.shell !== 'sheet').map(({entry, group}) => {
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
  // THE DETAIL WAITS FOR THE HOST (opt-in, `opts.holdDetail`; the Rack
  // Builder's, which hangs its cables first). On a large rack the relief pass
  // is thousands of rasterisations, and run beside the cables it took most of
  // their main thread: cables hung at 95-103 s on one rack where they need
  // about 11 s of work. With the option every device's relief pass waits,
  // after the device stands, until the host calls `startDetail()`: a sheet
  // part stands as its plain box meanwhile (`opts.standIn`). Once started it
  // stays started. No other caller passes it.
  let startDetail = null;
  const detailHeld = opts.holdDetail ? new Promise(go => { startDetail = go; }) : null;
  // ...AND THEN A FEW AT A TIME, each started in a task of its own: let go all
  // together, seventy devices' first faces were read in one task of 7 s, and
  // the page got its scene only after it. DETAIL_AT_ONCE passes run at once
  // (a pass waits on its images' decoding, so a few overlap that), in the order
  // the devices were built.
  const DETAIL_AT_ONCE = 4;
  let detailRunning = 0;
  const detailWaiting = [];
  const nextDetail = () => {
    while (detailRunning < DETAIL_AT_ONCE && detailWaiting.length) { detailRunning++; setTimeout(detailWaiting.shift()); }
  };
  const detailTurn = () => new Promise(go => { detailWaiting.push(go); nextDetail(); });
  const detailDone = () => { detailRunning--; nextDetail(); };
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
      const h = e.chassis?.ru != null ? unitsOf(e.chassis) : Math.max(1, Math.round((e.chassis?.h || RU) / RU));
      top = Math.max(top, Math.ceil((e.ru || 1) + h - 1));
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
    clearLeaders();
    tagMinX = tagMaxX = null;
    requestFrame();
    clearSvgOverrides(relief);
    SYNTH.clear();            // the keys those overrides were registered under
    SHARED.clear();           // and the parts built once for those mounts
    faceMats.clear();         // and their detailed faces' materials
    dropAnchorDocs();         // measured against overrides that are now gone
    // A BUILD OVERTAKEN STOPS (dispose, a lost context, another build: each
    // bumps `epoch`): the devices still to come are not built for a scene
    // nobody will see, holding canvases and textures the next one needs.
    const mine = epoch;
    if (!alive) return;       // (disposed before it was asked to build)
    await hydrate();
    if (mine !== epoch) return;
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
      if (mine !== epoch) return;
      await buildDevice(entry);
    }
    layoutTags();
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
    requestFrame();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  // `running` is the host's to switch: a panel scrolled out of sight has no
  // business drawing sixty frames a second (the front page hero pauses it).
  // Every other caller never touches it, and the loop runs as it always did.
  let raf = 0, alive = true, running = true;
  // A LOST CONTEXT IS NEVER DRAWN INTO (as vendor/viewer3d.js). A GPU reset or
  // memory pressure takes the context away; a frame drawn on it then compiles a
  // program the context cannot answer for and three.js throws from inside the
  // loop (reading 'trim' of a null info log). So on a loss the loop stops, the
  // uploads are released now, while GL calls are silent no-ops (left for later,
  // those deletes reach the restored context with the old one's handles: "object
  // does not belong to this context"), and the host is told (`opts.onContextLost`).
  // The scene is not drawn again: its uploads are gone. On restore the host is
  // told (`opts.onContextRestored`) and builds a new scene if it wants one.
  let contextLost = false;
  function onContextLost(ev) {
    if (!alive) return;                 // dispose() forces this loss on purpose
    ev.preventDefault();
    contextLost = true;
    cancelAnimationFrame(raf);
    raf = 0;
    epoch++;                            // a deferred relief pass adds nothing more to it
    for (const m of mounted) { disposeTree(m.group); disposeTree(m.ears); }
    disposeTree(scene);
    opts.onContextLost?.();
  }
  function onContextRestored() {
    if (!alive) return;
    opts.onContextRestored?.();
  }
  renderer.domElement.addEventListener('webglcontextlost', onContextLost);
  renderer.domElement.addEventListener('webglcontextrestored', onContextRestored);
  function tick() {
    if (!alive || !running || contextLost) { raf = 0; return; }
    // (a frame held back while the detail is being built and nobody is handling the view: `opts.buildFrameMs`, above)
    const now = BUILD_FRAME_MS ? performance.now() : 0;
    if (costDue) { frameCost = now - lastFrame; costDue = false; }
    // (the camera is kept where the controls have it at every animation frame, held back or not, and a camera
    // that has moved since the last frame is drawn: `cameraMoved`, above)
    controls.update();
    // (lighter while the camera moves, and in detail again once it has been still a moment: `opts.lightWhileMoving`)
    if (LIGHT_MOVING) {
      // (the timer, above, has the say once the hand is off; this takes the detail away at the first frame of a move)
      const moving = lightHeld || (!easedOut && performance.now() - movedAt < MOTION_REST_MS);
      if (moving !== light) setLight(moving);
    }
    // (and with `opts.onDemand`, only a scene something has changed: `dirty`, above, or a camera moved enough to see)
    if (ON_DEMAND && cameraMoved && drawnPose && !movedFrom(drawnPose, DRAW_MOVE)) cameraMoved = false;
    if (cameraMoved || ((!ON_DEMAND || dirty) && !(BUILD_FRAME_MS && detailing > 0 && !handling && now - handledAt > HANDLED_MS && now - lastFrame < Math.max(BUILD_FRAME_MS, Math.min(5000, 4 * frameCost))))) {
      cameraMoved = false;
      dirty = false;
      if (ON_DEMAND) drawnPose = poseOf();
      renderer.render(scene, camera);
      lastFrame = now;
      costDue = !!BUILD_FRAME_MS;
    }
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
    guideAnchor,
    // Where each cable leaves a seated connector under a path prefix:
    // [{position, normal, view, path}], one per relief.js cable point, or [].
    cableAnchor,
    // LET GO OF THE FACES THE ANCHORS WERE MEASURED ON: each mount's faces,
    // parked in the document as hidden SVG (faceDoc), with their cable
    // points. A host that has asked for every anchor it needs (the Rack
    // Builder, once its cables are hung) frees them: on a large rack they were
    // hundreds of documents and over 400,000 live nodes. They are a cache: an
    // anchor asked for later reads its face again, from the same text.
    releaseAnchors: dropAnchorDocs,
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
    metrics: () => ({RU, rackWidth: RACK_W, faceZ: RACK_FACE_Z, railDepth: FRAME ? RAIL_DEPTH : 34, recess: RECESS,
                     heightRU: UNITS, pxmm: PXMM}),
    // THE STAGE, after the fact: the colour behind the rack, and the labels'
    // colours to read against it - {labelColor, labelUnitColor,
    // labelEmphasisColor}, as at construction; one left out is its default.
    setBackground(c) { scene.background = new THREE.Color(c); requestFrame(); },
    setLabelColors(o = {}) {
      LABEL = labelTones(o);
      // (the sprites and the tags' leaders)
      scene.traverse(x => { if (x.userData.labelTone) x.material.color.set(LABEL[x.userData.labelTone]); });
      requestFrame();
    },
    layoutTags,
    resize,
    reframe: frameCamera,
    // Ask for a frame: a host that has changed what the scene shows (a
    // restyle, something added) says so, for a scene that draws only then
    // (`opts.onDemand`). Harmless without the option: every frame is drawn.
    requestFrame,
    // Stop and restart the render loop, for a host that knows it is not seen.
    pause() { running = false; cancelAnimationFrame(raf); raf = 0; },
    resume() { if (alive && !running) { running = true; requestFrame(); tick(); } },
    running: () => alive && running && !contextLost,
    // Whether the GL context was taken away (and the scene with it): see onContextLost.
    contextLost: () => contextLost,
    // What the scene resolved: the stack with chassis, bays and the component
    // index filled in, and the height it settled on. Asked for in
    // roc-ops/portrayal-site#10 - a consumer that used to compute heightRU from
    // chassis.ru should not have to re-fetch what this just read.
    resolved: () => ({heightRU: UNITS, stack: RESOLVED.map(e => ({...e}))}),
    // Export what is on screen, including whatever is currently seated in a bay.
    // The text one mounted device's face was cut from (`slot` is its place in the
    // stack): its seated parts and written fields are in it, as the texture has them.
    faceText: (slot, view) => RESOLVED[slot] ? svgSource(faceSrc(RESOLVED[slot], view), relief) : Promise.resolve(null),
    // (written in full detail, the faces as built, even from a camera still moving: `opts.lightWhileMoving`;
    // the tags' leaders are the page's, as the tags are: never in a file)
    toGLB: () => { if (light) setLight(false); return withoutLeaders(() => toGLB(scene)); },
    toUSDZ: () => { if (light) setLight(false); return withoutLeaders(() => toUSDZ(scene)); },
    three: {THREE, scene, camera, renderer, controls},
    // Resolves when the deferred faces - sides, rear, underside - have all been
    // installed. build() does not wait for these on purpose; this is here for a
    // host that wants a complete scene before exporting or grabbing a still.
    complete: async () => { await Promise.all(pending); },
    // Let the held relief pass start (`opts.holdDetail`); a no-op without the option, or once started.
    startDetail() { startDetail?.(); },
    // Whether the scene is still the host's: false once disposed.
    alive: () => alive,
    dispose() {
      // ONCE. A second dispose would force the loss of a context already lost,
      // which the browser reports ("loseContext: context lost").
      if (!alive) return;
      alive = false;
      SHARED.clear();
      faceMats.clear();
      if (CPU_CANVASES) releaseCpuCanvases();
      dropAnchorDocs();
      epoch++;      // stops any deferred relief pass from touching a dead scene
      pending = [];  // and drops the closures it was holding
      cancelAnimationFrame(raf);
      clearTimeout(lightTimer);
      ro.disconnect();
      renderer.domElement.removeEventListener('dblclick', onDblClick);
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', onContextRestored);
      if (BUILD_FRAME_MS) for (const type of ['pointermove', 'pointerdown', 'wheel']) renderer.domElement.removeEventListener(type, onHandle);
      if (ON_DEMAND) for (const type of READER_EVENTS) document.removeEventListener(type, requestFrame, {capture: true});
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
      // (not one the browser has already taken: losing it again only says so in the console)
      if (!renderer.getContext().isContextLost()) renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}
