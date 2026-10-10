// THE 2D/3D SWITCH, SHARED. The 3D scene is a module mounted into a container
// beside the SVG stage - same page, same tree, same inspector, no iframe and no
// message protocol. It was Explorer's alone; Annotate needs every piece of it,
// and the ordering fixes below were each paid for once and should not be paid
// for twice. A page hands in what is ITS state - which lamps are lit, what is
// pulled, what is swapped - and mounts its own chrome through `extras`.
//
// The viewer is imported on first use: it drags in three.js and a WebGL
// context, and someone who never presses 3D should pay for neither.

export const MODE3D_CSS = `
  #mode { display:flex; gap:0.2rem; }
  #mode button { border-radius:0; }
  #mode button:first-child { border-radius:6px 0 0 6px; }
  #mode button:last-child { border-radius:0 6px 6px 0; margin-left:-1px; }
  #mode button:disabled { opacity:0.45; cursor:not-allowed; }
  #mode button:disabled:hover { background:var(--pt-surface-2); }
  /* NOT position: relative HERE. .stage-host is position:absolute; inset:0, and
     overriding that collapses the stage to nothing. */
  #stage-3d { background:var(--pt-surface); }
  #stage-3d canvas { display:block; }
  #frus { display:flex; gap:0.2rem; flex-wrap:wrap; }
  #frus[hidden] { display:none; }        /* display:flex outranks the hidden attribute */
  #frus button { font-family:ui-monospace, monospace; font-size:0.72rem; padding:0.26rem 0.42rem; }
  #glx { position:absolute; bottom:0.6rem; left:0.7rem; z-index:5; display:flex;
         gap:0.3rem; align-items:center; font-size:0.72rem; }
  #glx button:disabled { opacity:0.55; cursor:progress; }
  #glx .msg { color:var(--dim); }
  #glx .msg.bad { color:var(--warn); }
`;

// A scene needs six faces that describe one box, which is exactly portrayal
// level 3. Below it the viewer has nothing to extrude the sides from and draws a
// plausible wrong box instead.
const CAN_3D = 3;
const kb = n => n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`;

// HOW MANY MESHES AN EXPORT CARRIES, read off the file itself (#111). An export
// of a scene that has not built yet is a valid, empty file - a 112-byte GLB - and
// reporting its size reads as success. A GLB's JSON chunk lists its meshes; a
// USDZ is an uncompressed zip with one `geometries/Geometry_<id>.usda` per mesh.
// Anything unreadable counts as none: an unreadable file is not the model either.
export function exportMeshes(fmt, data) {
  try {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    if (fmt === 'glb') {
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      if (bytes.byteLength < 20 || dv.getUint32(0, true) !== 0x46546c67) return 0;   // 'glTF'
      if (dv.getUint32(16, true) !== 0x4e4f534a) return 0;                          // 'JSON'
      const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + dv.getUint32(12, true))));
      return Array.isArray(json.meshes) ? json.meshes.length : 0;
    }
    if (fmt === 'usdz') {
      const text = new TextDecoder('latin1').decode(bytes);
      return new Set(text.match(/geometries\/Geometry_\d+\.usda/g) || []).size;
    }
  } catch { /* fall through: not a file we can read */ }
  return 0;
}

const saveFile = (data, filename, type) => {
  const url = URL.createObjectURL(new Blob([data], {type}));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);   // Safari is still reading it
};

// WHY 3D IS NOT SHOWING, in words a reader can act on (Portrayal #746). A
// browser keeps only about sixteen WebGL contexts alive and, after repeated GPU
// resets, refuses new ones until it restarts; three.js reports either as "Error
// creating WebGL context", which on its own tells nobody what to do next.
function why3d(err) {
  const msg = String(err?.message || err);
  if (/WebGL context/i.test(msg))
    return '3D unavailable: the browser would not create a graphics context — ' +
           'reload the page, or close other tabs with 3D open (browsers allow only about 16)';
  return `3D unavailable: ${msg}`;
}
const LOST_MSG = '3D paused — the graphics context was lost; it will resume, or reload the page';
// A SCENE THAT DID NOT BUILD, while 3D itself is up. Not "3D unavailable": the
// viewer is there and the last scene may still be on screen; what failed is
// this device, configuration or swap. A lost or refused context keeps why3d's
// sentence, which says what to do about it.
const BUILD_FAILED = 'the scene failed to build';
function whyBuild(err, retry = 'switch to 2D and back to try again') {
  const msg = String(err?.message || err);
  return /WebGL context/i.test(msg) ? why3d(err)
    : `3D: ${BUILD_FAILED} (${msg}) — ${retry}`;
}

export function createMode3d(shell, opts = {}) {
  const state = shell.state;
  const {
    states = () => ({}),
    pulled = () => (typeof shell.pulledPaths === 'function' ? shell.pulledPaths() : []),
    overrides = () => ({}),
    afterSync = null,
    extras = null,
    onPick = p => shell.select(p && p !== state.sel ? p : null, false),
    // Back in 2D the halo is redrawn by selecting the selection again. On a page
    // where a selection is an action - Annotate's click adds a mark - that
    // re-selection must not count as one, so the page can say how to make it.
    reselect = p => shell.select(p, true),
    // The generic rack ears (#909) as the page has them when the viewer is
    // made: site/ears.js's preference. The page's toggle tells the viewer of
    // every change after that (viewer.setEars), and the viewer keeps them
    // across loads.
    ears = () => false,
  } = opts;
  const listeners = {mode: []};

  const modeBar = document.createElement('span');
  modeBar.id = 'mode';
  modeBar.innerHTML = `<button data-mode="2d" class="on">2D</button><button data-mode="3d">3D</button>`;
  shell.el.fit.before(modeBar);

  const host3d = document.createElement('div');
  host3d.className = 'stage-host';
  host3d.id = 'stage-3d';
  host3d.hidden = true;
  shell.el.stage.appendChild(host3d);

  const fruBox = document.createElement('span');
  fruBox.id = 'frus';
  fruBox.hidden = true;
  shell.el.status.before(fruBox);

  let mode = '2d', viewer = null, loading = null, loadedKey = '';
  // The newest load asked of the viewer, while it is in flight, and the key it
  // is for: see sync(). `builds` counts every load asked for, so an export can
  // tell that the scene was rebuilt under it; `failedKey` is the key whose
  // build last failed, until another build is asked for.
  let inflight = null, builds = 0, failedKey = null;
  // The browser took the WebGL context away and has not handed it back yet.
  let gpuLost = false;
  // The download bar, once mounted, and whether an export from it is running.
  // `exported` is what the last export said - the file's name and size, or why
  // there is none - so the bar can be repainted from state at any time.
  let glx = null, exporting = false, exported = {text: '', bad: false};

  async function ensureViewer() {
    if (viewer) return viewer;
    if (!loading) loading = (async () => {
      const {createViewer} = await import('../vendor/viewer3d.js');
      // THE BACKGROUND IS THE READER'S. The shell owns the swatches and the 2D
      // stage; the scene is told the colour it starts with and every change after.
      const v = createViewer(host3d, {dist: 'assets/dist/', background: shell.stage(), ears: !!ears()});
      shell.on('stage', c => v.setBackground(c));
      // WHAT IS WRITTEN ON A PART reaches the scene as well as the drawing.
      shell.on('fields', ({all}) => v.setFields(all));
      if (Object.keys(state.cfgFields || {}).length) v.setFields(state.cfgFields);
      // A HANDLE FOR MEASURING, not for using: `?debug=1` puts the viewer on
      // window so a console or a browser check can ask it what it holds.
      if (new URLSearchParams(location.search).get('debug') === '1') window.__viewer = v;
      // A click on nothing emits null, and a drag to orbit is filtered before it
      // gets here. What a pick MEANS is the page's: Explorer toggles the
      // selection, Annotate toggles a mark.
      v.on('select', p => onPick(p));
      // A LOST CONTEXT LEAVES THE CANVAS BLANK (Portrayal #746): the viewer stops
      // drawing, rebuilds the scene when the browser hands the context back, and
      // says both. A page's hover readout is its own overlay, not this line, so
      // nothing else has to hold off while the message is up.
      v.on('contextlost', () => { gpuLost = true; shell.el.status.textContent = LOST_MSG; paintDownloads(); });
      v.on('contextrestored', err => {
        gpuLost = false;
        shell.el.status.textContent = err ? why3d(err) : '';
        paintDownloads();
      });
      mountDownloads(v);
      if (extras) extras(v, host3d);
      return v;
    })();
    try {
      viewer = await loading;
    } catch (err) {
      loading = null;               // a rejected promise would poison every retry
      throw err;
    }
    return viewer;
  }

  // A GLB is the one output that survives someone not being able to reach the
  // site. The module does the exporting; the page is two buttons and a line.
  //
  // THE BUTTONS ARE ON ONLY WHILE THE SCENE IS THE ONE ASKED FOR (#111). The
  // viewer exports the scene as it stands, with no wait for a build in flight,
  // so a press before the first build - or during a rebuild for a new config or
  // swap - saved an empty file, or the device before the change, and said it
  // worked. sceneReady() is the same test as settled(), plus that what loaded is
  // what the page now wants.
  const wantKey = () => `${state.device}.${state.cfg}|${swapKey()}`;
  const sceneReady = () => !!viewer && !inflight && loadedKey !== '' && loadedKey === wantKey() && !gpuLost;
  const WAIT_MSG = 'building the scene…';
  // WHY THE BUTTONS ARE OFF, when they are. A build that failed is not a build
  // in progress: "building the scene…" under a scene that will never arrive
  // kept a reader waiting for buttons that were not coming back. A lost context
  // is the status line's to explain.
  const sceneMsg = () => sceneReady() ? ''
    : failedKey !== null && failedKey === wantKey() && !inflight ? `${BUILD_FAILED}, so there is nothing to download`
    : WAIT_MSG;
  function paintDownloads() {
    if (!glx) return;
    const ready = sceneReady();
    glx.bar.dataset.ready = ready ? '1' : '0';
    glx.bar.dataset.failed = !ready && sceneMsg() !== WAIT_MSG ? '1' : '0';
    for (const b of glx.buttons) b.disabled = exporting || !ready;
    if (exporting) return;
    // A file's name and size describe the scene it was saved from, and go when
    // that scene does. A refusal stays beside the reason the buttons are off:
    // it is the only word the reader gets that their press saved nothing.
    if (!ready && !exported.bad) exported = {text: '', bad: false};
    const scene = sceneMsg();
    glx.msg.textContent = [exported.text, scene].filter(Boolean).join(' · ');
    glx.msg.classList.toggle('bad', exported.bad || (!!scene && scene !== WAIT_MSG));
  }

  function mountDownloads(v) {
    if (typeof v.download !== 'function') return;
    const bar = document.createElement('div');
    bar.id = 'glx';
    bar.innerHTML =
      `<button data-fmt="glb" title="Geometry and textures in one file. Opens in Quick Look, Windows 3D Viewer, PowerPoint, Blender, Sketchfab.">Download GLB</button>`
    + `<button data-fmt="usdz" title="AR Quick Look on iPhone and iPad.">USDZ</button>`
    + `<span class="msg"></span>`;
    host3d.appendChild(bar);
    const msg = bar.querySelector('.msg');
    const all = [...bar.querySelectorAll('button')];
    glx = {bar, msg, buttons: all};
    for (const b of all) b.onclick = async () => {
      const fmt = b.dataset.fmt;
      // A page can change its state a moment before it syncs - a config picked,
      // its drawing still fetching - so the press is refused on the state as it
      // is now, not only on how the buttons were last painted.
      if (exporting || !sceneReady()) { paintDownloads(); return; }
      exporting = true;
      exported = {text: '', bad: false};
      all.forEach(x => { x.disabled = true; });
      msg.classList.remove('bad');
      msg.textContent = `building ${fmt.toUpperCase()}…`;
      try {
        let name, size;
        if (typeof v.exportData === 'function' && typeof v.exportName === 'function') {
          // THE SCENE THE PRESS WAS MADE ON, AND ITS NAME, before the wait. The
          // export takes seconds, and nothing stops the reader picking another
          // configuration or seating an optic while it runs: the viewer then
          // rebuilds the scene under the exporter, and the file is the old
          // device, half of each, or the new one - named, after the wait, for
          // whatever was loaded last. So the press remembers which build it
          // saw, and a file is saved only if that is still the scene on screen.
          const built = builds;
          name = `${v.exportName()}.${fmt}`;
          // Exported, then counted, then saved: a file with no meshes is not
          // the model, and is reported as a failure rather than handed over.
          const data = await v.exportData(fmt);
          if (built !== builds || !sceneReady())
            throw new Error('the scene changed while the file was being built, so nothing was saved');
          if (!exportMeshes(fmt, data)) throw new Error('the scene has no geometry yet, so nothing was saved');
          saveFile(data, name, fmt === 'glb' ? 'model/gltf-binary' : 'model/vnd.usdz+zip');
          size = data.byteLength ?? data.length;
        } else {
          ({name, size} = await v.download(fmt));
        }
        exported = {text: `${name} — ${kb(size)}`, bad: false};
      } catch (err) {
        exported = {text: `${fmt.toUpperCase()} failed: ${err.message || err}`, bad: true};
      } finally {
        exporting = false;
        paintDownloads();
      }
    };
    paintDownloads();
  }

  // One button per removable unit, carrying the unit's own path - the name the
  // tree row and the halo already use. toggleFru returns the next state.
  function fruBar(v) {
    fruBox.replaceChildren();
    if (typeof v.frus !== 'function' || typeof v.toggleFru !== 'function') return;
    for (const fru of v.frus() || []) {
      const btn = document.createElement('button');
      btn.dataset.fru = fru.path;
      const paint = st => {
        btn.textContent = `${st.icon} ${st.path}`;
        btn.classList.toggle('on', !!st.out);
        btn.title = `${st.label} — ${st.out ? 'insert' : 'eject'}`
                  + ` (${Math.round(st.travel)} mm travel${st.captive ? ', captive' : ''})`;
      };
      paint(fru);
      btn.onclick = () => {
        const st = v.toggleFru(fru.path);
        if (!st) return;
        paint(st);
        shell.el.status.textContent = st.text || '';
      };
      fruBox.appendChild(btn);
    }
  }

  // THE SWAP STATE IS PART OF WHAT IS ON SCREEN, so it is part of the key. A
  // runtime swap changes no file on disk, so the overrides have to travel with
  // the load AND be visible to the early return.
  const swapKey = () => Object.entries(overrides())
    .sort(([a], [b]) => a < b ? -1 : 1)
    .map(([k, v]) => `${k}=${v || ''}`).join(',');

  async function sync() {
    // Every sync is a possible rebuild: the buttons go off at once, before the
    // first await, if what is wanted is no longer what is loaded.
    paintDownloads();
    if (mode !== '3d') return;
    const v = await ensureViewer();
    const key = wantKey();
    // BEFORE the early return, and before the load: states and pulls set while
    // the drawing was showing are exactly the case where the device and the
    // swaps have not changed and the scene still has to catch up; and build()
    // reads them, so a scene comes up already lit.
    await v.setStates(states());
    await v.setPulled(pulled());
    // The page's own state (Annotate's marks and lamp colours), at the same
    // point and for the same reason. The viewer keeps marks across a rebuild.
    if (afterSync) await afterSync(v);
    // WHAT THE SCENE IS ABOUT TO BE, NOT WHAT IT LAST WAS. The viewer queues
    // loads and builds them in order, so with one in flight the scene will be
    // that load's, whatever loadedKey says. Asking loadedKey alone lost a
    // round trip: on k1, a change to k2 starts a build, a change back to k1
    // while it runs found "k1 is loaded" and returned, and the k2 build then
    // finished under a page that wanted k1 - the wrong scene, and Download
    // buttons that waited for a build nobody had asked for.
    //
    // ONE BUILD PER KEY. loadedKey is only set once a load has finished, so two
    // syncs for the same key while the first build ran - a page re-syncing on
    // every edit, a load event and a render together - each built the whole
    // scene again. A sync for the key already loading waits for that load.
    if (inflight) {
      if (inflight.key === key) {
        await inflight.done;
        if (afterSync) await afterSync(v);
        return;
      }
    } else if (key === loadedKey) return;
    const done = v.load({device: state.device, config: state.cfg, overrides: overrides()});
    const mine = inflight = {key, done};
    builds++;
    failedKey = null;
    paintDownloads();
    try {
      await done;
    } catch (err) {
      // A newer load is queued behind this one: the scene is its to report on.
      if (inflight !== mine) { console.warn('[portrayal] a 3D build that was replaced failed', err); return; }
      // WHAT IS ON SCREEN IS NOT A SCENE OF ANYTHING NOW. loadedKey kept the
      // last good key, so a retry for it returned early and settled() said the
      // scene was built.
      inflight = null;
      loadedKey = '';
      failedKey = key;
      paintDownloads();
      throw err;
    }
    // not the newest any more: the sync that asked for the newer load does the
    // rest once that one has built
    if (inflight !== mine) return;
    inflight = null;
    loadedKey = key;                // only once it is actually the thing on screen
    paintDownloads();
    fruBar(v);
    if (state.sel) v.select(state.sel);
    // AND ONCE MORE ON THE BUILT SCENE. A page that re-syncs on every edit can
    // land a setMarks while the load is still building, after the viewer's own
    // redraw - and then the last report it holds says every mark is missing.
    // Sent again here, the last draw is always against the finished scene.
    if (afterSync) await afterSync(v);
  }

  function pushStates() {
    if (mode !== '3d' || !viewer) return;
    Promise.resolve(viewer.setStates(states()))
      .catch(err => console.warn('[portrayal] 3D state sync failed', err));
  }
  function pushPulled() {
    if (mode !== '3d' || !viewer) return;
    Promise.resolve(viewer.setPulled(pulled()))
      .catch(err => console.warn('[portrayal] 3D pull sync failed', err));
  }
  shell.on('pulled', pushPulled);

  async function setMode(m) {
    if (m === mode) return;
    // THE GATE IS THE MODE'S, NOT THE BUTTON'S (#93). A disabled button stops a
    // press; it does not stop a page that asks for 3D itself - a ?mode=3d link to
    // a device below level 3 - and that opened the wrong box the gate exists to
    // prevent. Refused here, with the button's own reason.
    if (m === '3d' && btn3d.disabled) {
      shell.el.status.textContent = btn3d.title || `3D needs portrayal level ${CAN_3D}`;
      return;
    }
    mode = m;
    for (const b of modeBar.querySelectorAll('button')) b.classList.toggle('on', b.dataset.mode === m);
    shell.el.svgHost.hidden = m !== '2d';
    host3d.hidden = m !== '3d';
    // the FRU bar is 3D chrome; Fit measures the SVG stage, which is 0x0 while hidden
    fruBox.hidden = m !== '3d';
    shell.el.fit.hidden = m === '3d';
    shell.emit('mode', m);
    for (const fn of listeners.mode) fn(m);
    // IN 3D THE VIEW IS NOT A CHOICE: the scene shows all six faces, so the tree
    // merges and the view picker steps aside. Only if the shell can.
    const viewPick = shell.el.view.closest('label') || shell.el.view;
    const canMerge = typeof shell.loadFaces === 'function';
    const merge = m === '3d' && canMerge;
    state.merge = merge;
    viewPick.style.display = merge ? 'none' : '';
    // Faces arriving after the switch can carry marks the first sync could not
    // see, so the scene is synced again once they are all held.
    if (merge) shell.loadFaces().then(() => { shell.refreshTree(); return sync(); })
      .catch(err => console.warn('[portrayal] faces for the merged tree', err));
    else shell.refreshTree();
    if (m === '2d') {
      shell.fit();
      if (state.sel) reselect(state.sel);
      return;
    }
    shell.el.status.textContent = 'loading 3D…';
    try {
      await sync();
      (await ensureViewer()).resize();
      // a context lost while the drawing showed is still lost: keep saying so
      shell.el.status.textContent = gpuLost ? LOST_MSG : '';
    } catch (err) {
      console.warn('[portrayal] 3D unavailable', err);
      // WITH A VIEWER, 3D IS AVAILABLE and it was the scene that failed: the
      // same sentence a failed rebuild gets. Without one the viewer itself
      // could not be made, and why3d says what to do about that. Either way
      // the page goes back to the drawing, so the retry is the 3D button.
      shell.el.status.textContent = viewer ? whyBuild(err, 'press 3D to try again') : why3d(err);
      setMode('2d');
    }
  }
  for (const b of modeBar.querySelectorAll('button')) b.onclick = () => setMode(b.dataset.mode);

  // Absent capability data leaves the button as it was: a device the build has
  // not judged is not a device we refuse to draw.
  const btn3d = modeBar.querySelector('[data-mode="3d"]');
  shell.on('device', (name, meta) => {
    const cap = meta?.capability || shell.device()?.capability;
    const short = cap && cap.level != null && cap.level < CAN_3D;
    btn3d.disabled = !!short;
    if (!short) { btn3d.title = ''; return; }
    const needs = (cap.blocked || []).find(b => b.level === CAN_3D)?.needs;
    btn3d.title = needs ? `3D needs ${needs}` : `3D needs portrayal level ${CAN_3D}`;
    if (mode === '3d') setMode('2d');
  });

  shell.on('select', path => { if (mode === '3d' && viewer) viewer.select(path); });
  const failed = what => err => {
    console.warn(`[portrayal] 3D ${what} failed`, err);
    shell.el.status.textContent = whyBuild(err);
  };
  shell.on('change', () => { sync().catch(failed('swap sync')); });
  shell.on('load', () => {
    sync().catch(failed('reload'));
    // A LOAD DROPS THE FACES IT DID NOT MOUNT. The shell refetches them for a
    // merged tree and says nothing when they are back, and a page whose state
    // reaches every face - a mark on the rear fans - has to be synced again
    // then, as setMode does on the way into 3D.
    if (mode === '3d' && state.merge && typeof shell.loadFaces === 'function')
      shell.loadFaces().then(() => sync()).catch(failed('faces after a reload'));
  });
  addEventListener('resize', () => { if (mode === '3d' && viewer) viewer.resize(); });

  return {
    mode: () => mode, setMode, sync, pushStates,
    viewer: () => viewer,
    // The scene on screen is the one asked for: a viewer, a finished load, and
    // none in flight. What the viewer reports before that - its mark report,
    // while the scene is still building - is about a scene that is not there yet.
    settled: () => !!viewer && !inflight && loadedKey !== '',
    on: (ev, fn) => { (listeners[ev] ||= []).push(fn); },
    el: {modeBar, host3d, fruBox},
  };
}
