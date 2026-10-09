// THE GENERIC RACK EAR, A CHOICE ON A DEVICE PAGE (Portrayal #909, kit 0.8.0
// ears2d.js; silver since kit 0.9.0). Shared by the Explorer and Annotate, and
// wired as the kit's own Explorer (kit/index.html) wires it:
//
// - Ears BUILT INTO a face - a blanking panel, a shelf, a full-width patch
//   panel - are part of the drawing and always shown. The kit's plan
//   (ears2d.js earPlan, relief.js genericEars) is null for such a device, so
//   there is no toggle and nothing is drawn over it.
// - A device modelled between its ear folds gets a generic L-bracket only on
//   request, OFF by default here: in 2D an overlay from ears2d.js (the plan
//   the scene builds from, drawn as render.py `--with ears` draws it), in 3D
//   the viewer's own `setEars`. The button is there only for a device that
//   gets one. Silver (#c8cacc) unless the device states `chassis.ears.color`:
//   that colour is in the plan, which both drawings read.
//
// The Rack Builder draws its ears ON by default, with its own rail geometry
// (site/rack/elevation.js, site/rack3d.js), gated by the same plan.
//
// A VIEWING PREFERENCE, NOT A FACT ABOUT THE DEVICE, so it is remembered per
// viewer, under the kit page's key, and not written into the location: a link
// shares a device, not how its reader likes to look at one.

import { drawEars, clearEars, earPlan, faceSize, frontWidthOfText } from '../vendor/ears2d.js';
import { faceFile } from '../vendor/dist.js';

export const EARS_KEY = 'portrayal.ears';

export const EARS_CSS = `
  #earsbar { display:inline-flex; margin-right:0.2rem; }
  #earsbar[hidden] { display:none; }     /* inline-flex outranks the hidden attribute */
`;

/** Is the generic ear on, as this reader left it? Off unless they turned it on. */
export function earsPreference() {
  try { return localStorage.getItem(EARS_KEY) === '1'; } catch { return false; }
}

/**
 * Mount the "Rack ears" toggle before the shell's Fit button and keep the
 * overlay in step with every face the shell mounts. `viewer()` is the 3D
 * viewer when there is one (mode3d's), which is told on every toggle; a viewer
 * made later reads earsPreference() when it is created. `around(draw)` runs
 * the drawing's change: a page that grows the viewBox itself (Annotate's
 * legend, marks.js) takes its own growth off first and puts it back after,
 * so each restores the box the other left. It is called only when there are
 * ears to draw or to take off.
 * Returns {on(), plan(), sync(), el}.
 */
export function installEars(shell, {viewer = () => null, dist = 'assets/dist/', around = draw => draw()} = {}) {
  const state = shell.state;
  let earsOn = earsPreference();
  let plan = null;
  const bar = document.createElement('span');
  bar.id = 'earsbar';
  bar.hidden = true;
  bar.innerHTML = '<button type="button" aria-pressed="false">Rack ears</button>';
  const btn = bar.querySelector('button');
  shell.el.fit.before(bar);

  // The front's declared width is what says an ear is built in, so a device
  // is judged on its front even while another face is on screen: the mounted
  // front, else the front the merged tree holds, else the front file itself.
  const frontW = {};
  async function frontWidth() {
    const key = `${state.device}.${state.cfg}`;
    if (state.view === 'front' && state.svg) return faceSize(state.svg)?.[0];
    if (state.faces?.front && state.facesFor === key) return faceSize(state.faces.front)?.[0];
    if (!(key in frontW)) {
      frontW[key] = fetch(dist + faceFile(state.meta, state.cfg, 'front'))
        .then(r => (r.ok ? r.text() : '')).then(frontWidthOfText).catch(() => null);
    }
    return frontW[key];
  }

  async function sync() {
    const svg = state.svg;
    const p = (state.module || !state.meta) ? null : earPlan(state.meta, await frontWidth());
    if (svg !== state.svg) return;           // another face arrived while this one asked
    plan = p;
    bar.hidden = !plan;
    bar.dataset.on = earsOn ? '1' : '0';
    btn.classList.toggle('on', earsOn);
    btn.setAttribute('aria-pressed', String(earsOn));
    btn.title = earsOn ? 'Hide the generic rack ears (not part of this face)'
                       : 'Show generic rack ears: an L-bracket each side, to the 482.6 mm rack face';
    if (!svg) return;
    const want = !!(plan && earsOn);
    if (!want && !svg.querySelector('[data-overlay="ears"]')) return;
    const vb = svg.getAttribute('viewBox');
    around(() => { if (want) drawEars(svg, plan, state.view); else clearEars(svg); });
    // the stage is sized from the viewBox: refit when the ears grew or shrank
    // it, and only then, so a swap redrawing them keeps the reader's zoom
    if (svg.getAttribute('viewBox') !== vb) shell.fit();
  }
  const warn = err => console.warn('[portrayal] rack ears', err);
  btn.onclick = () => {
    earsOn = !earsOn;
    try { localStorage.setItem(EARS_KEY, earsOn ? '1' : '0'); } catch { /* private mode */ }
    sync().catch(warn);
    const v = viewer();
    if (v && typeof v.setEars === 'function')
      Promise.resolve(v.setEars(earsOn)).catch(err => console.warn('[portrayal] 3D rack ears', err));
  };
  // every face mounted (a device, a configuration, a view, a module), and
  // every swap, which can append to the drawing after the overlay
  shell.on('load', () => { sync().catch(warn); });
  shell.on('change', () => { sync().catch(warn); });
  return {on: () => earsOn, plan: () => plan, sync, el: bar};
}
