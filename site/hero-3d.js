// The same cabled switch, in 3D (spec 2026-09-26-hero-cabled-switch §5).
//
// Under the 2D reveal, a second panel shows the S9600-72XC alone - no rack -
// with the SAME parts seated and the SAME cables hung, read from the same
// table (hero-reveal.js's PORTS). The parts are seated by the kit, through
// rack3d.js's createRackScene with the rows' `seat` maps as the device's
// overrides; the cables leave the points the kit says each connector's cable
// leaves from (cableAnchor), and hang with cables.js's own 3D shape. A cable's
// color and its caption come from hero-reveal.js, so the two panels cannot
// disagree about what a link is or what it looks like.
//
// It costs nothing until it is nearly on screen: an IntersectionObserver
// builds it once, and until then - or for good, without WebGL - the panel
// shows the compiled front face as a still image.
import {PORTS, DEFAULT_PORT, jacketColor, captionOf} from './hero-reveal.js';
import {hangPoints3d, LEAD, WIDTH, clearOf} from './showcase/cables.js';
import {guard3d} from './webgl.js';

const REF = 's9600-72xc';
const STILL = `assets/dist/${REF}.front.svg`;

// HIGHER CONNECTORS REACH FURTHER OUT before they bend, so a lead from a
// higher port hangs in front of the ones below it - the showcase's stage 4
// rule (cables.js `reaches`, which is not exported): LEAD, and REACH_STEP more
// per row of cabled connectors below.
const REACH_STEP = 4;             // mm, as cables.js
const ROW = 2;                    // mm: connectors this close in height are one row

// WHERE EACH CABLE GOES: out to the nearer side, SIDE_OUT beyond the rack's
// half-width, and below the device - nested as in 2D, the cable starting
// nearest its edge running out highest, TAIL_STEP above the next.
const RACK_HALF = 482.6 / 2;
const SIDE_OUT = 160;
const TAIL_Y = -30, TAIL_STEP = 6;

// THE FADE: a tube is opaque over its first FADE_FROM of its length and fades
// to nothing over the rest, by a per-vertex alpha ramp (the color attribute's
// fourth channel). The faded stretch takes no pointer, as in 2D.
const FADE_FROM = 2 / 3;
const DIM = 0.22;                 // the other cables' opacity while one is picked

const FLOOR_Y = -210;             // the studio floor, below the lowest hang

const el = (tag, cls, attrs = {}) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};

export async function heroThree(host) {
  const probe = new URLSearchParams(location.search).has('heroprobe');
  const caption = document.getElementById('hero-caption-3d');

  // The still image: the compiled front face, which the 2D panel has already
  // fetched, so it costs nothing and always matches the device.
  const still = el('img', 'hero-3d-still', {'data-hero-still': '', alt:
    'UfiSpace S9600-72XC front panel', decoding: 'async', src: STILL});
  const stage = el('div', 'hero-3d-stage');
  const note = el('p', 'hero-3d-note');
  note.hidden = true;
  host.append(still, stage, note);

  let sc = null, building = false, onScreen = false;
  const io = new IntersectionObserver(entries => {
    onScreen = entries.some(e => e.isIntersecting);
    if (onScreen && !sc && !building) {
      building = true;
      build().catch(err => console.error('hero 3D:', err));
    }
    // The turn pauses while the panel is off screen.
    if (sc) onScreen ? sc.resume() : sc.pause();
  }, {rootMargin: '200px'});
  io.observe(host);

  async function build() {
    const made = await guard3d(async () => {
      const {createRackScene} = await import('./rack3d.js');
      // Every row's seat, merged: the device's overrides, applied once.
      const overrides = Object.assign({}, ...Object.values(PORTS).map(r => r.seat));
      const s = createRackScene(stage, {
        dist: 'assets/dist/',
        stack: [{ref: REF, cfg: 'base', ru: 1, label: 'S9600-72XC', overrides}],
        heightRU: 2, rails: false, recess: 0, background: 0x0E1013,
      });
      try {
        s.three.renderer.shadowMap.enabled = true;     // before anything compiles
        await s.build();
        await dress(s);
        return s;
      } catch (err) {
        s.dispose();
        throw err;
      }
    }, msg => {
      // The still image stays, with one line saying why.
      stage.remove();
      note.textContent = /webgl/i.test(msg)
        ? '3D needs WebGL, which this browser has switched off.'
        : 'The 3D view could not be built here.';
      note.title = msg;
      note.hidden = false;
    });
    if (!made) return;
    sc = made;
    still.hidden = true;
    if (!onScreen) sc.pause();
  }

  // ── the studio, the cables, the motion and the picking ────────────────────
  async function dress(s) {
    const {THREE, scene, camera, renderer, controls} = s.three;
    const [{box}] = s.deviceBoxes();
    const center = box.getCenter(new THREE.Vector3());
    const faceZ = box.max.z;

    // THE STUDIO. A gradient from a lit center out to the page's own ground,
    // so the panel's edges are the page and the fading tubes read as meant.
    const ground = getComputedStyle(document.documentElement)
      .getPropertyValue('--pt-ground').trim() || '#0E1013';
    const cv = document.createElement('canvas');
    cv.width = 512; cv.height = 128;
    const c = cv.getContext('2d');
    const g = c.createRadialGradient(256, 58, 8, 256, 64, 300);
    g.addColorStop(0, '#2a2f36');
    g.addColorStop(0.55, '#171a1f');
    g.addColorStop(1, ground);
    c.fillStyle = g; c.fillRect(0, 0, 512, 128);
    const bg = new THREE.CanvasTexture(cv);
    bg.colorSpace = THREE.SRGBColorSpace;
    scene.background = bg;

    // A soft shadow on a floor that shows nothing else.
    renderer.shadowMap.type = THREE.VSMShadowMap;
    const sun = new THREE.DirectionalLight(0xffffff, 0.6);
    sun.position.set(center.x + 120, center.y + 900, center.z + 260);
    sun.target.position.copy(center);
    sun.castShadow = true;
    sun.shadow.mapSize.set(512, 512);
    Object.assign(sun.shadow.camera, {left: -420, right: 420, top: 420, bottom: -420, near: 100, far: 2000});
    sun.shadow.radius = 14;
    sun.shadow.blurSamples = 16;
    scene.add(sun, sun.target);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400),
                                 new THREE.ShadowMaterial({opacity: 0.38}));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(center.x, FLOOR_Y, center.z);
    floor.receiveShadow = true;
    scene.add(floor);
    const casts = () => scene.traverse(o => {
      if (o.isMesh && o !== floor && !o.userData.heroCable) o.castShadow = true;
    });
    casts();
    s.complete().then(casts);      // the relief pass, when it lands

    // THE CABLES. Every row's connector points first: how far a lead reaches
    // depends on how many rows of cabled connectors are below it.
    const found = [];
    for (const [port, row] of Object.entries(PORTS)) {
      const got = await s.cableAnchor({ref: REF}, port, {view: 'front'});
      if (!got.length) { console.warn(`hero 3D: no cable point for ${port}`); continue; }
      const pts = got.map(a => a.position);
      const y = Math.max(...pts.map(p => p.y));
      const x = pts.reduce((t, p) => t + p.x, 0) / pts.length;
      found.push({port, row, pts, normal: got[0].normal, x, y});
    }
    const rows = [];
    for (const f of found) if (!rows.some(v => Math.abs(v - f.y) < ROW)) rows.push(f.y);
    rows.sort((a, b) => a - b);
    const rank = new Map();
    for (const left of [true, false]) {
      found.filter(f => (f.x < center.x) === left)
        .sort((a, b) => (left ? a.x - b.x : b.x - a.x) || b.y - a.y)
        .forEach((f, k) => rank.set(f.port, k));
    }
    const boxes = s.deviceBoxes();
    const group = new THREE.Group();
    group.name = 'hero-cables';
    const tubes = [], picks = [];
    for (const f of found) {
      const reach = LEAD + REACH_STEP * rows.findIndex(v => Math.abs(v - f.y) < ROW);
      const left = f.x < center.x;
      const A = {points: f.pts, normal: f.normal, reach};
      const out = f.pts[0].clone().addScaledVector(f.normal, reach);
      const side = new THREE.Vector3((left ? -1 : 1) * (RACK_HALF + SIDE_OUT),
                                     box.min.y + TAIL_Y - TAIL_STEP * rank.get(f.port), out.z);
      const B = {points: [side], normal: new THREE.Vector3(0, 0, 1), reach: 0};
      // hangPoints3d ends on B's start AND its lead-out, which here are one
      // point: drop the repeat.
      const pts = clearOf(hangPoints3d(THREE, A, B, RACK_HALF * 2)
        .filter((p, i, a) => i === 0 || p.distanceToSquared(a[i - 1]) > 1e-6), boxes);
      const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
      const color = new THREE.Color(jacketColor(f.row.jacket));
      const mat = new THREE.MeshStandardMaterial({color, roughness: 0.55, metalness: 0,
        vertexColors: true, transparent: true});
      const main = new THREE.Mesh(fade(THREE, new THREE.TubeGeometry(curve, 160, WIDTH / 2, 8, false)), mat);
      main.userData = {heroCable: f.port};
      group.add(main);
      // An optic's two strands, from each plug into where they join: the
      // cable's own start.
      if (f.pts.length > 1) {
        for (const p of f.pts) {
          const strand = new THREE.Mesh(fade(THREE, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(
            [p, p.clone().addScaledVector(f.normal, 12), pts[0]]), 16, WIDTH * 0.3, 6, false), 1), mat);
          strand.userData = {heroCable: f.port};
          group.add(strand);
        }
      }
      // What the pointer hits: a fatter, unseen tube along the same curve,
      // because a 3 mm tube is a hard thing to land a pointer on.
      const pick = new THREE.Mesh(new THREE.TubeGeometry(curve, 80, WIDTH * 2, 6, false),
                                  new THREE.MeshBasicMaterial({visible: false}));
      pick.userData = {heroCable: f.port, pick: true};
      group.add(pick);
      picks.push(pick);
      tubes.push({port: f.port, mesh: main, mat, color, curve});
    }
    scene.add(group);

    // THE CAMERA: a little above and to the right, the whole hang in frame.
    const target = new THREE.Vector3(center.x, box.min.y - 75, faceZ - 120);
    const dir = new THREE.Vector3(0.32, 0.30, 1).normalize();
    const frame = () => {
      const cw = stage.clientWidth || 1, ch = stage.clientHeight || 1;
      const half = Math.tan(camera.fov * Math.PI / 360);
      const need = Math.max(470 / (2 * half), 2.3 * (RACK_HALF + SIDE_OUT) / (2 * half * cw / ch));
      controls.target.copy(target);
      camera.position.copy(target).addScaledVector(dir, need);
      controls.minDistance = need * 0.45;
      controls.maxDistance = need * 1.4;
      controls.update();
    };
    frame();
    // Never underneath, and never round the back far enough to lose the front.
    controls.minPolarAngle = 0.25;
    controls.maxPolarAngle = Math.PI / 2 - 0.08;
    controls.minAzimuthAngle = -1.25;
    controls.maxAzimuthAngle = 1.25;
    controls.enablePan = false;
    // Double-click returns to THIS framing, not the rack's.
    stage.addEventListener('dblclick', e => { e.stopPropagation(); frame(); }, true);

    // THE TURN: slow, back and forth across the front, until the visitor
    // takes hold - a full turn would spend half its time on the rear.
    const SWAY = 0.55;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.5;
    controls.addEventListener('change', () => {
      if (!controls.autoRotate) return;
      const az = controls.getAzimuthalAngle();
      if (az > SWAY) controls.autoRotateSpeed = Math.abs(controls.autoRotateSpeed);
      else if (az < -SWAY) controls.autoRotateSpeed = -Math.abs(controls.autoRotateSpeed);
    });
    const stop = () => { controls.autoRotate = false; };
    renderer.domElement.addEventListener('pointerdown', stop, {once: true});
    renderer.domElement.addEventListener('wheel', stop, {once: true, passive: true});

    // PICKING: the pointer over a tube lights it, dims the rest and names it
    // in this panel's caption; a miss restores port-67, as in 2D.
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    function hitAt(clientX, clientY) {
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set((clientX - r.left) / r.width * 2 - 1, -(clientY - r.top) / r.height * 2 + 1);
      ray.setFromCamera(ndc, camera);
      // The faded stretch takes no pointer: a hit there is passed over.
      const hit = ray.intersectObjects(picks, false).find(h => !h.uv || h.uv.x <= FADE_FROM);
      return hit ? hit.object.userData.heroCable : null;
    }
    function show(port) {
      for (const t of tubes) {
        const on = t.port === port;
        t.mat.opacity = port && !on ? DIM : 1;
        t.mat.emissive.copy(on ? t.color : new THREE.Color(0)).multiplyScalar(on ? 0.35 : 0);
      }
      const text = captionOf(port || DEFAULT_PORT);
      if (caption) caption.textContent = text;
      return text;
    }
    show(null);
    const canvas = renderer.domElement;
    canvas.addEventListener('pointermove', e => {
      if (e.pointerType !== 'mouse' || e.buttons) return;
      const port = hitAt(e.clientX, e.clientY);
      show(port);
      canvas.style.cursor = port ? 'pointer' : '';
    });
    canvas.addEventListener('pointerleave', () => show(null));
    // A TAP on touch does the same: a press that did not move is a tap.
    let down = null;
    canvas.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
    canvas.addEventListener('pointerup', e => {
      if (e.pointerType === 'mouse' || !down) return;
      if (Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 6) show(hitAt(e.clientX, e.clientY));
      down = null;
    });

    if (probe) {
      window.__hero3d = {
        tubes: tubes.map(({port, mesh}) => ({port, mesh})),
        pick: port => show(tubes.some(t => t.port === port) ? port : null),
        stop,
        devices: () => s.deviceBoxes().length,
        running: () => s.running(),
        // A client point on `port`'s tube that the ray reaches before any
        // other cable, along its unfaded length; null if there is none.
        pointAt(port) {
          const t = tubes.find(x => x.port === port);
          if (!t) return null;
          controls.update();
          camera.updateMatrixWorld();
          const r = canvas.getBoundingClientRect();
          for (let i = 2; i < 60; i++) {
            const v = t.curve.getPointAt(i / 60 * FADE_FROM).project(camera);
            if (Math.abs(v.x) > 0.98 || Math.abs(v.y) > 0.98) continue;
            const x = r.left + (v.x + 1) / 2 * r.width, y = r.top + (1 - v.y) / 2 * r.height;
            if (hitAt(x, y) === port) return [x, y];
          }
          return null;
        },
      };
    }
  }
}

// The fade, as vertex alpha: a TubeGeometry's rings run along its length
// (its uv.x is the fraction along), so each vertex takes an alpha from where
// its ring is - 1 up to FADE_FROM, then easing to 0 at the far end. `upto`
// of 1 is a strand, opaque throughout.
function fade(THREE, geom, upto = FADE_FROM) {
  const uv = geom.attributes.uv;
  const col = new Float32Array(uv.count * 4);
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i);
    const k = u <= upto ? 0 : Math.min(1, (u - upto) / (1 - upto));
    col.set([1, 1, 1, 1 - k * k * (3 - 2 * k)], i * 4);
  }
  geom.setAttribute('color', new THREE.BufferAttribute(col, 4));
  return geom;
}
