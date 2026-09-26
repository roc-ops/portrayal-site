// The same cabled switch, in 3D (spec 2026-09-26-hero-cabled-switch §5).
//
// Under the 2D reveal, a second panel shows the S9600-72XC alone - no rack -
// with the SAME parts seated and the SAME cables hung, read from the same
// table (hero-reveal.js's PORTS). The parts are seated by the kit, through
// rack3d.js's createRackScene with the rows' `seat` maps as the device's
// overrides; the cables leave the points the kit says each connector's cable
// leaves from (cableAnchor), and hang with cables.js's own 3D shape. A cable's
// color comes from cables.js's colorOfJacket and its caption from
// hero-reveal.js, so the two panels cannot disagree about what a link is or
// what it looks like.
//
// It costs nothing until it is nearly on screen: an IntersectionObserver
// builds it once, and until then - or for good, without WebGL - the panel
// shows the compiled front face as a still image.
//
// IT WAITS ITS TURN. The build starts only after `after` - the 2D hero's own
// promise, which settles (resolved or failed) once its parts are seated and
// its cables hung - and then only when the browser is next idle, so the front
// page's first paint and the 2D hero never compete with three.js. On a narrow
// screen the panel must be on screen, not merely near it, to start.
import {PORTS, DEFAULT_PORT, captionOf} from './hero-reveal.js';
import {hangPoints3d, LEAD, WIDTH, clearOf, colorOfJacket} from './showcase/cables.js';
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
// Kept short and high: a shorter run hangs shallower (cables.js's sag3d grows
// with the run), and a shallow hang is what lets the fitted camera come in
// close enough for the switch to read large in a 3.86:1 panel.
const SIDE_OUT = 40;
const TAIL_Y = -4, TAIL_STEP = 3;

// THE FADE: a tube is opaque over its first FADE_FROM of its length and fades
// to nothing over the rest, by a per-vertex alpha ramp (the color attribute's
// fourth channel). The faded stretch takes no pointer, as in 2D.
const FADE_FROM = 2 / 3;
const DIM = 0.22;                 // the other cables' opacity while one is picked

const FLOOR_Y = -210;             // the studio floor, below the lowest hang
const STUDIO = 0x7D848C;          // the studio: one even mid gray

const el = (tag, cls, attrs = {}) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};

// When the browser is next idle, or after IDLE_MS at the latest.
const IDLE_MS = 1500;
const idle = () => new Promise(done => {
  if ('requestIdleCallback' in window) requestIdleCallback(() => done(), {timeout: IDLE_MS});
  else setTimeout(done, 200);
});

// What the scene shows, for a screen reader: the stage is one image.
const LABEL = 'The UfiSpace S9600-72XC with its optics and cables, in 3D';

export async function heroThree(host, {after = Promise.resolve()} = {}) {
  const probe = new URLSearchParams(location.search).has('heroprobe');
  const caption = document.getElementById('hero-caption-3d');
  // The default names port-67 from the start - with no WebGL too - as in 2D.
  if (caption) caption.textContent = captionOf(DEFAULT_PORT);

  // The still image: the compiled front face, which the 2D panel has already
  // fetched, so it costs nothing and always matches the device.
  const still = el('img', 'hero-3d-still', {'data-hero-still': '', alt:
    'UfiSpace S9600-72XC front panel', decoding: 'async', src: STILL});
  // role=img, labelled: the canvas three.js puts in it says nothing on its
  // own, and the label stays when the still image is hidden over the scene.
  const stage = el('div', 'hero-3d-stage', {role: 'img', 'aria-label': LABEL});
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
  }, {rootMargin: matchMedia('(max-width: 700px)').matches ? '0px' : '200px'});
  io.observe(host);

  async function build() {
    // After the 2D hero, and when the browser is idle (see the top).
    await after.catch(() => {});
    await idle();
    if (!host.isConnected) return;
    const made = await guard3d(async () => {
      const {createRackScene} = await import('./rack3d.js');
      // Every row's seat, merged: the device's overrides, applied once.
      const overrides = Object.assign({}, ...Object.values(PORTS).map(r => r.seat));
      const s = createRackScene(stage, {
        dist: 'assets/dist/',
        stack: [{ref: REF, cfg: 'base', ru: 1, label: 'S9600-72XC', overrides}],
        heightRU: 2, rails: false, recess: 0, background: STUDIO,
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
      if (!host.isConnected) return;
      stage.remove();
      note.textContent = /webgl/i.test(msg)
        ? '3D needs WebGL, which this browser has switched off.'
        : 'The 3D view could not be built here.';
      note.title = msg;
      note.hidden = false;
    });
    if (!made) return;
    if (!host.isConnected) { made.dispose(); return; }
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

    // THE STUDIO: one even mid gray - light enough that a black DAC reads
    // against it (feedback: on the old near-black it vanished), dark enough
    // that the yellow and aqua jackets still do. Where the panel meets the page is the
    // stage's CSS mask's job (site.css), so the page's own ground shows
    // through in either theme and nothing here reads a color.
    scene.background = new THREE.Color(STUDIO);

    // A soft shadow on a floor that shows nothing else.
    renderer.shadowMap.type = THREE.VSMShadowMap;
    const sun = new THREE.DirectionalLight(0xffffff, 0.6);
    sun.position.set(center.x + 120, center.y + 900, center.z + 260);
    sun.target.position.copy(center);
    sun.castShadow = true;
    sun.shadow.mapSize.set(512, 512);
    Object.assign(sun.shadow.camera, {left: -1200, right: 1200, top: 1200, bottom: -1200, near: 100, far: 2000});
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
    s.complete().then(casts)       // the relief pass, when it lands
      .catch(err => console.warn('hero 3D: relief pass', err));

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
    // The page may have let the panel go while the anchors were read.
    if (!host.isConnected) throw new Error('hero 3D: the panel left the page');
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
      const color = new THREE.Color(colorOfJacket(f.row.jacket));
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

    // THE CAMERA: fitted, not guessed. The device and every tube's OPAQUE
    // stretch (its first FADE_FROM) must land inside the canvas - inside the
    // unmasked middle, across, since the stage's CSS mask fades the sides -
    // at the opening view AND at both ends of the sway, so a cable never
    // reaches the panel's edge before it has faded. The distance is the
    // smallest that does that, which is also what makes the switch read large.
    const SWAY = 0.55;
    const LIMIT_X = 0.84, LIMIT_Y = 0.94;    // of the canvas, in NDC
    const samples = [];
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y])
      for (const z of [box.min.z, box.max.z]) samples.push(new THREE.Vector3(x, y, z));
    for (const t of tubes) for (let i = 0; i <= 40; i++) samples.push(t.curve.getPointAt(i / 40 * FADE_FROM));
    const bounds = new THREE.Box3().setFromPoints(samples);
    // Aimed at the middle of the front and the hang, a little into the box.
    const target = new THREE.Vector3((bounds.min.x + bounds.max.x) / 2, (bounds.min.y + bounds.max.y) / 2,
                                     faceZ - 60);
    const dir = new THREE.Vector3(0.30, 0.10, 1).normalize();
    // A long lens: at rack3d's 42 degrees the cables swinging toward the camera
    // at the sway's ends grew with perspective and set the whole fit. At 24
    // the fit is set by the hang itself, and the switch reads larger.
    camera.fov = 24;
    camera.updateProjectionMatrix();
    const openSph = new THREE.Spherical().setFromVector3(dir);
    const probeCam = camera.clone();
    const fits = (az, dist) => {
      const sph = openSph.clone(); sph.theta = az;
      probeCam.aspect = (stage.clientWidth || 1) / (stage.clientHeight || 1);
      probeCam.updateProjectionMatrix();
      probeCam.position.copy(target).add(new THREE.Vector3().setFromSpherical(sph).multiplyScalar(dist));
      probeCam.lookAt(target);
      probeCam.updateMatrixWorld();
      for (const p of samples) {
        const v = p.clone().project(probeCam);
        if (v.z > 1 || Math.abs(v.x) > LIMIT_X || Math.abs(v.y) > LIMIT_Y) return false;
      }
      return true;
    };
    const fitDistance = () => {
      let need = 0;
      // The sway overshoots its turn-back angle by a frame's step; allow it.
      for (const az of [openSph.theta, -SWAY - 0.02, -SWAY / 2, 0, SWAY / 2, SWAY + 0.02]) {
        let lo = 100, hi = 6000;
        for (let i = 0; i < 32; i++) { const mid = (lo + hi) / 2; if (fits(az, mid)) hi = mid; else lo = mid; }
        need = Math.max(need, hi);
      }
      return need;
    };
    // Centered on what the fit is limited by, not on a box: the target is
    // moved up or down until the worst top and the worst bottom, across the
    // sway, sit the same distance in from the canvas's edges.
    const extentY = dist => {
      let lo = Infinity, hi = -Infinity;
      for (const az of [openSph.theta, -SWAY - 0.02, SWAY + 0.02]) {
        fits(az, dist);                    // places probeCam
        for (const p of samples) {
          const v = p.clone().project(probeCam);
          lo = Math.min(lo, v.y); hi = Math.max(hi, v.y);
        }
      }
      return [lo, hi];
    };
    for (let k = 0; k < 4; k++) {
      const d = fitDistance();
      const [lo, hi] = extentY(d);
      // NDC to millimeters at the target, near enough to converge.
      const mmPerNdc = d * Math.tan(camera.fov * Math.PI / 360);
      target.y += (hi + lo) / 2 * mmPerNdc;
    }
    let openDist = fitDistance();
    const frame = () => {
      openDist = fitDistance();
      controls.target.copy(target);
      camera.position.copy(target).addScaledVector(dir, openDist);
      // Zooming in is the visitor's choice, and crops as a zoom does; zooming
      // out stops before the switch is lost.
      controls.minDistance = openDist * 0.45;
      controls.maxDistance = openDist * 1.5;
      controls.update();
    };
    frame();
    // The opening frame, as the test hook measures it.
    const openTarget = target.clone();
    const openDir = dir.clone();
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
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.5;
    controls.addEventListener('change', () => {
      if (!controls.autoRotate) return;
      const az = controls.getAzimuthalAngle();
      if (az > SWAY) controls.autoRotateSpeed = Math.abs(controls.autoRotateSpeed);
      else if (az < -SWAY) controls.autoRotateSpeed = -Math.abs(controls.autoRotateSpeed);
    });
    const stop = () => { controls.autoRotate = false; };

    // THE PAGE KEEPS ITS SCROLL (ruling R4). Until a click or tap on the
    // panel, OrbitControls is off - so the wheel and a swipe scroll the page
    // as they would anywhere else (it only takes the wheel when enabled) -
    // and a quiet hint says how to take hold. A click takes hold: orbit, zoom
    // and pinch work and the sway stops. Leaving the panel, a press outside
    // it, or Escape lets go. Hover naming works either way.
    const canvas = renderer.domElement;
    const hint = el('p', 'hero-3d-hint', {'data-hero-hint': ''});
    hint.textContent = 'Click to turn it';
    host.append(hint);
    let active = false;
    const setActive = on => {
      active = on;
      controls.enabled = on;
      canvas.style.touchAction = on ? 'none' : 'pan-y';
      stage.style.touchAction = on ? 'none' : 'pan-y';
      hint.hidden = on;
      host.toggleAttribute('data-hero-active', on);
      if (on) stop();
    };
    setActive(false);
    canvas.addEventListener('pointerdown', () => { if (!active) setActive(true); });
    canvas.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && active) setActive(false); });
    document.addEventListener('pointerdown', e => { if (active && !host.contains(e.target)) setActive(false); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && active) setActive(false); });

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
        distance: () => camera.position.distanceTo(controls.target),
        // Where every tube's OPAQUE stretch lands on the canvas (NDC, -1..1
        // is inside) at the opening distance and elevation, turned to azimuth
        // `az` (null: the opening azimuth). {minX, maxX, minY, maxY}.
        opaqueNdc(az = null) {
          const cam = camera.clone();
          const off = openDir.clone();
          if (az != null) {
            const sph = new THREE.Spherical().setFromVector3(off);
            sph.theta = az;
            off.setFromSpherical(sph);
          }
          cam.position.copy(openTarget).addScaledVector(off.normalize(), openDist);
          cam.lookAt(openTarget);
          cam.updateMatrixWorld();
          const e = {minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity};
          for (const t of tubes) for (let i = 0; i <= 40; i++) {
            const v = t.curve.getPointAt(i / 40 * FADE_FROM).project(cam);
            e.minX = Math.min(e.minX, v.x); e.maxX = Math.max(e.maxX, v.x);
            e.minY = Math.min(e.minY, v.y); e.maxY = Math.max(e.maxY, v.y);
          }
          return e;
        },
        sway: SWAY,
        // Turn the camera to azimuth `az` about the target, at the opening
        // distance and elevation - the teaser capture (tools/capture-teaser.py)
        // drives the sway itself with this, so its loop is exact.
        aim(az) {
          stop();
          const sph = new THREE.Spherical().setFromVector3(openDir.clone());
          sph.theta = az;
          camera.position.copy(openTarget)
            .addScaledVector(new THREE.Vector3().setFromSpherical(sph).normalize(), openDist);
          controls.target.copy(openTarget);
          camera.lookAt(openTarget);
          controls.update();
          // Rendered now, so a caller can copy the canvas in this same task:
          // the drawing buffer is not preserved, and captureStream on the
          // WebGL canvas itself hands a recorder a stale frame.
          renderer.render(scene, camera);
        },
        // The device's front face's share of the canvas width at the opening.
        deviceShare() {
          const cam = camera.clone();
          cam.position.copy(openTarget).addScaledVector(openDir, openDist);
          cam.lookAt(openTarget); cam.updateMatrixWorld();
          const xs = [box.min.x, box.max.x].map(x => new THREE.Vector3(x, center.y, faceZ).project(cam).x);
          return Math.abs(xs[1] - xs[0]) / 2;
        },
        // Put the camera at the opening frame turned to azimuth `az`.
        view(az) {
          stop();
          const sph = new THREE.Spherical().setFromVector3(openDir.clone());
          if (az != null) sph.theta = az;
          camera.position.copy(openTarget).add(new THREE.Vector3().setFromSpherical(sph).multiplyScalar(openDist));
          controls.target.copy(openTarget);
          controls.update();
        },
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
