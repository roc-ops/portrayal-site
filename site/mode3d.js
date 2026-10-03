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

  async function ensureViewer() {
    if (viewer) return viewer;
    if (!loading) loading = (async () => {
      const {createViewer} = await import('../vendor/viewer3d.js');
      // THE BACKGROUND IS THE READER'S. The shell owns the swatches and the 2D
      // stage; the scene is told the colour it starts with and every change after.
      const v = createViewer(host3d, {dist: 'assets/dist/', background: shell.stage()});
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
    for (const b of all) b.onclick = async () => {
      const fmt = b.dataset.fmt;
      all.forEach(x => { x.disabled = true; });
      msg.classList.remove('bad');
      msg.textContent = `building ${fmt.toUpperCase()}…`;
      try {
        const {name, size} = await v.download(fmt);
        msg.textContent = `${name} — ${kb(size)}`;
      } catch (err) {
        msg.textContent = `${fmt.toUpperCase()} failed: ${err.message || err}`;
        msg.classList.add('bad');
      } finally {
        all.forEach(x => { x.disabled = false; });
      }
    };
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
    if (mode !== '3d') return;
    const v = await ensureViewer();
    const key = `${state.device}.${state.cfg}|${swapKey()}`;
    // BEFORE the early return, and before the load: states and pulls set while
    // the drawing was showing are exactly the case where the device and the
    // swaps have not changed and the scene still has to catch up; and build()
    // reads them, so a scene comes up already lit.
    await v.setStates(states());
    await v.setPulled(pulled());
    // The page's own state (Annotate's marks and lamp colours), at the same
    // point and for the same reason. The viewer keeps marks across a rebuild.
    if (afterSync) await afterSync(v);
    if (key === loadedKey) return;
    await v.load({device: state.device, config: state.cfg, overrides: overrides()});
    loadedKey = key;                // only once it is actually the thing on screen
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
      shell.el.status.textContent = '';
    } catch (err) {
      console.warn('[portrayal] 3D unavailable', err);
      shell.el.status.textContent = `3D unavailable: ${err.message || err}`;
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
    shell.el.status.textContent = `3D unavailable: ${err.message || err}`;
  };
  shell.on('change', () => { sync().catch(failed('swap sync')); });
  shell.on('load', () => { sync().catch(failed('reload')); });
  addEventListener('resize', () => { if (mode === '3d' && viewer) viewer.resize(); });

  return {
    mode: () => mode, setMode, sync, pushStates,
    viewer: () => viewer,
    on: (ev, fn) => { (listeners[ev] ||= []).push(fn); },
    el: {modeBar, host3d, fruBox},
  };
}
