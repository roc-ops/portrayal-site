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
         setSvgOverride, clearSvgOverrides, createReliefScope } from '../vendor/relief.js';
import { toGLB, toUSDZ } from '../vendor/share.js';
import { applyOverrides } from '../vendor/swap.js';
import { jdist } from '../vendor/dist.js';

export const RU = 44.45;            // EIA-310 rack unit
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
// exist because the scene is not symmetric about the rails: RU numbers sit
// 34 mm to the left of them and device tags start 120 mm out and run further
// left again by the width of their own text, so content spans roughly -510 to
// +241 mm. Straight on that asymmetry is the whole picture and the tags fall off
// the edge without it; obliquely the margin already swallows it.
const VIEWS = {
  iso:   {dir: [0.4647, 0.1608, 0.8707], aim: 0.42, margin: 1.72, z: -60,
          wide: 1.1, aimX: 0},
  front: {dir: [0, 0, 1],                aim: 0.50, margin: 1.12, z: -60,
          wide: 2.4, aimX: -0.28},
};
const PXMM_RELIEF = 8;

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

  configureRelief({THREE, renderer, PXMM: PXMM_RELIEF, FRU_PATHS: new Set()});

  // This scene's own override map. relief.js used to keep ONE, module-wide, so
  // two scenes in a page showing the same device with different occupants fought
  // over it - and clearSvgOverrides() emptied everything, meaning one scene
  // building or disposing silently wiped the other's. roc-ops/ndv#31 fixed that
  // by making a scope a thing you can hold; holding one is what makes a
  // side-by-side rack possible in a single document instead of two iframes.
  const relief = createReliefScope();

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
    // Whichever of height or width needs more room wins.
    const need = Math.max(H / (2 * half), (RACK_W * v.wide) / (2 * half * aspect));
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
  function buildRack() {
    disposeTree(rack);                       // dispose BEFORE detaching, or
    for (const c of [...rack.children]) rack.remove(c);   // there is nothing left to walk
    const H = UNITS * RU;
    for (const side of [-1, 1]) {
      const x = side * (RACK_W / 2 - 8);
      const post = new THREE.Mesh(new THREE.BoxGeometry(16, H, 34), railMat);
      post.position.set(x, H / 2, RACK_FACE_Z - 17);
      rack.add(post);
      // three mounting holes per U, on the EIA-310 0.5/0.625/0.625in spacing
      for (let u = 0; u < UNITS; u++) {
        for (const dy of [6.35, 22.22, 38.10]) {
          const h = new THREE.Mesh(new THREE.BoxGeometry(6.5, 6.5, 1), holeMat);
          h.position.set(x, u * RU + dy, RACK_FACE_Z + 0.3);
          rack.add(h);
        }
      }
    }
    // U numbering up the left rail, counted from the floor as racks are
    for (let u = 1; u <= UNITS; u++) {
      const s = labelSprite(String(u), 30, u % 5 === 0 ? LABEL_EMPH : LABEL_UNIT);
      s.position.set(-(RACK_W / 2 + 34), (u - 1) * RU + RU / 2, 46);
      rack.add(s);
    }
  }
  buildRack();
  scene.add(rack);

  // An L bracket per side: a flange flat on the rack face taking two screws, and
  // a leg running back along the flank of the device. The gear sits recessed, so
  // the leg spans that gap - which is what a flat plate cannot do and why it
  // looked wrong as one.
  function rackEars(ru, ruHeight, halfW, depth) {
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
      const holeX = side * (RACK_W / 2 - 8);
      const earX = side * (halfW + 12);
      const flange = new THREE.Mesh(new THREE.BoxGeometry(24, h, 3), earMat);
      flange.position.set(earX, yBase + ruHeight * RU / 2, RACK_FACE_Z + 1.5);
      g.add(flange);
      const leg = new THREE.Mesh(new THREE.BoxGeometry(3, h, legLen), earMat);
      leg.position.set(side * (halfW + 1.5), yBase + ruHeight * RU / 2, RACK_FACE_Z - legLen / 2);
      g.add(leg);
      for (let u = 0; u < ruHeight; u++) {
        for (const dy of [6.35, 38.10]) {
          const head = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 2.2, 14), screwMat);
          head.rotation.x = Math.PI / 2;
          head.position.set(holeX, yBase + u * RU + dy, RACK_FACE_Z + 4.1);
          g.add(head);
        }
      }
    }
    return g;
  }

  // ── devices ────────────────────────────────────────────────────────────
  const mounted = [];   // {entry, group}

  // Apply a bay override map to a device's compiled faces before relief is
  // taken from them. relief.js consults its override table ahead of its own
  // cache, so one substitution per face reaches the texture, the cavity mask
  // and everything else built from that text.
  async function overrideFaces(entry) {
    const ov = entry.overrides;
    if (!ov || !Object.keys(ov).length || !entry.bays) return;
    const byRef = ref => (entry.componentIndex || []).find(
      c => `${c.ns}/${c.name}@${c.major.slice(1)}` === ref.split(':')[0]);
    const loadSkin = async ref => {
      const c = byRef(ref);
      if (!c) return null;
      const skin = c.skins?.includes('default') ? 'default' : c.skins?.[0];
      return {comp: c, text: await svgSource(
        `${DIST}components/${c.ns}--${c.name}--${c.major}--${skin}.svg`, relief)};
    };
    for (const [view, bays] of Object.entries(entry.bays)) {
      if (!bays.length) continue;
      if (!bays.some(b => Object.prototype.hasOwnProperty.call(ov, b.id))) continue;
      const url = `${DIST}${entry.ref}.${entry.cfg}.${view}.svg`;
      let text;
      try { text = await svgSource(url, relief); } catch { continue; }
      const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
      if (doc.querySelector('parsererror')) continue;
      const n = await applyOverrides(doc.documentElement, bays, ov, loadSkin);
      if (n) setSvgOverride(url, new XMLSerializer().serializeToString(doc), relief);
    }
  }

  async function buildDevice(entry) {
    const {w: W, h: H, d: D} = entry.chassis;
    const f = v => `${DIST}${entry.ref}.${entry.cfg}.${v}.svg`;
    const FACES = [
      {view: 'front', fw: () => W, fh: () => H, pos: () => [0, 0, D / 2],  rot: [0, 0, 0]},
      {view: 'rear',  fw: () => W, fh: () => H, pos: () => [0, 0, -D / 2], rot: [0, Math.PI, 0]},
      {view: 'right', fw: () => D, fh: () => H, pos: () => [W / 2, 0, 0],  rot: [0, Math.PI / 2, 0]},
      {view: 'left',  fw: () => D, fh: () => H, pos: () => [-W / 2, 0, 0], rot: [0, -Math.PI / 2, 0]},
      {view: 'top',   fw: () => W, fh: () => D, pos: () => [0, H / 2, 0],  rot: [-Math.PI / 2, 0, 0]},
    ];
    const meshes = [], faceCv = {}, faceSvg = {}, facePunch = {};
    for (const F of FACES) {
      await buildFaceRelief(F, {scope: relief, src: f(F.view), faceCv, faceSvg, facePunch, meshes,
        FRU_GROUPS: {}, FRU_META: {}, BODY_META: {}, D, bodyBoxMesh: null});
    }
    const bottomCv = await svgCanvas(f('bottom'), W, D, true, true, relief).catch(() => null);
    const plain = () => new THREE.MeshLambertMaterial({color: 0x3a3f44});
    const mat = cv => cv ? new THREE.MeshLambertMaterial(
      {map: canvasTex(cv), transparent: true, alphaTest: 0.08}) : plain();
    const mats = [faceCv.right, faceCv.left, faceCv.top, bottomCv, faceCv.front, faceCv.rear].map(mat);

    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), mats);
    group.add(body);
    meshes.forEach(m => group.add(m));

    const ruHeight = Math.max(1, Math.round(H / RU));
    group.position.set(0, (entry.ru - 1) * RU + H / 2, RACK_FACE_Z - RECESS - D / 2);

    // The ears live in RACK space, not device space. Parenting them to the
    // device and cancelling only the Y offset left them displaced by the Z
    // recess, which is what put a pair of white slabs out beside each unit.
    const ears = rackEars(entry.ru, ruHeight, W / 2, D);
    scene.add(ears);

    const tag = labelSprite(entry.label, 30, LABEL_TAG);
    tag.position.set(-(RACK_W / 2 + 120) - tag.scale.x / 2, group.position.y, 46);
    scene.add(tag);
    scene.add(group);
    mounted.push({entry, group, tag, ears});
    return group;
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
  let RESOLVED = [], COMPONENTS = null;
  async function hydrate() {
    const configs = new Map();
    for (const e of STACK) {
      if ((e.chassis && e.bays) || configs.has(e.ref)) continue;
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
        chassis: e.chassis || cfg?.chassis || {},
        bays: e.bays || cfg?.bays || {},
        componentIndex: e.componentIndex || COMPONENTS || []});
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
    for (const m of mounted) {
      scene.remove(m.group); scene.remove(m.tag); scene.remove(m.ears);
      disposeTree(m.group); disposeTree(m.ears);
    }
    mounted.length = 0;
    clearSvgOverrides(relief);
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
      await buildDevice(entry);
    }
  }

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  let raf = 0, alive = true;
  (function tick() {
    if (!alive) return;
    controls.update();
    renderer.render(scene, camera);
    raf = requestAnimationFrame(tick);
  })();

  return {
    build: buildAll,
    // The scene owns its copy of the stack, so a host that mutates its own array
    // changes nothing here. This is how a swap reaches the 3D rack.
    setOverrides(ref, ov) {
      const e = STACK.find(x => x.ref === ref);
      if (e) e.overrides = {...ov};
    },
    resize,
    reframe: frameCamera,
    // What the scene resolved: the stack with chassis, bays and the component
    // index filled in, and the height it settled on. Asked for in
    // roc-ops/portrayal-site#10 - a consumer that used to compute heightRU from
    // chassis.ru should not have to re-fetch what this just read.
    resolved: () => ({heightRU: UNITS, stack: RESOLVED.map(e => ({...e}))}),
    // Export what is on screen, including whatever is currently seated in a bay.
    toGLB: () => toGLB(scene),
    toUSDZ: () => toUSDZ(scene),
    three: {THREE, scene, camera, renderer, controls},
    dispose() {
      alive = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener('dblclick', onDblClick);
      controls.dispose();
      for (const m of mounted) { disposeTree(m.group); disposeTree(m.ears); }
      mounted.length = 0;
      clearSvgOverrides(relief);
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
