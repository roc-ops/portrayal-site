// The body stages 4 and 5 share: the cast rack with the plan's seats, cabled.
// In 2D the front or the rear elevation (the Front/Rear toggle lives in
// #stageTabs, which the rail empties on vacate); in 3D the mounted rack and
// its tubes. Every write after an await is behind ui.live().

import {stage3d, stageRack, el, svgEl, lead, kv, panZoom} from './artifact.js';
import {CAST, RACK_U, loadMeta, overrides, build2dElevation, mount3d, chassisOf}
  from './rack.js';
import {loadPlan, applyPlanSeats, looseReason, looseWhy, productName, countsBy, endView} from './plan.js';
import {drawCables2d, drawCables3d, looseOn, colorOf} from './cables.js';
import {wireClicks} from './svg2d.js';
// A circular import: stage-rail.js imports the stages, which import this. It
// is safe because activate is only ever read inside a click handler, never
// while the modules are being evaluated.
import {activate} from './stage-rail.js';

// mm of room beside the rack for cross-face tails and their tags.
const ROOM = 260;

export const HONEST = 'An example patching plan for this rack, not a real lab.';

// Where the cables land (spec §6 item 7), the same line on stages 4 and 5.
export const LANDS = 'Every end lands on a connector the plan seats: LC plugs in the optics, duplex LC plugs in the patch panel, RJ45 plugs in the copper jacks. Boots are not drawn yet (Portrayal #611).';

// One entry per color the plan draws, named for what it is.
export function legendFor(plan) {
  const seen = new Map();
  for (const l of plan.links) {
    const k = l.media === 'copper' ? `copper · ${l.purpose}` : l.media.toUpperCase() + ' fiber';
    if (!seen.has(k)) seen.set(k, colorOf(l));
  }
  const wrap = el('div', {class: 'cable-legend'});
  for (const [k, c] of seen) {
    const sw = el('span', {class: 'swatch'}); sw.style.background = c;
    wrap.append(el('span', {class: 'legend-item'}, [sw, k]));
  }
  return wrap;
}

// The honesty line, what the fill rule kept of the visitor's, the counts by
// purpose and media (unless the stage's own controls carry them), and the
// legend. NOT what the plan seated: by stage 4 the visitor has watched the
// rack being populated, and that list pushed the cables below the fold.
export function panelHead(plan, kept, {counts = true} = {}) {
  const kids = [lead(`<strong>${HONEST}</strong>`)];
  for (const k of kept) kids.push(el('p', {class: 'panel-lead', 'data-kept': k.key,
    text: `Kept your ${k.dev} ${k.key}: ${k.have ? productName(k.have) : 'empty'}.`}));
  for (const field of counts ? ['purpose', 'media'] : []) {
    const d = kv([...countsBy(plan, field)].map(([v, n]) => [v, String(n)]));
    d.dataset.counts = field;
    kids.push(d);
  }
  kids.push(legendFor(plan));
  return kids;
}

// `head` leads the panel (the stage's title and question); `top(handle)` comes
// straight after it, ahead of the shared head - the stage's own controls, when
// they are the point of the stage (stage 5's filters); `extraPanel(handle)`
// follows the shared head. `counts: false` drops the shared counts, for a
// stage whose controls already show them. Returns the handle the stage keeps,
// or null when the entry went stale.
export async function enterPatched(ui, {head = [], top = () => [], counts = true, onDrawn,
                                        extraPanel = () => []} = {}) {
  ui.scrim('Patching the rack…');
  await loadMeta();
  if (!ui.live()) return null;
  const plan = await loadPlan();
  if (!ui.live()) return null;
  const {kept} = applyPlanSeats(plan, overrides);
  const handle = {mode: ui.mode, plan, kept, drawn: [], loose: plan.links.map(() => []),
                  view: 'front', setView: null, highlight: null, dispose: () => {}};
  // Every end judged against its own face, off-screen, in either mode: the
  // panel's loose lines never depend on which face is shown, or on a flip
  // that overtook the first draw. In 2D this comes FIRST: a cable whose far
  // end is on the other face and loose is drawn as an unplugged lead, not
  // with a tag to that face, so each draw needs to know. In 3D the scene
  // finds its own loose ends, and the two run side by side.
  let loose;
  if (ui.mode === '2d') {
    loose = await looseEnds(ui, plan);
    if (!ui.live()) return null;
    handle.loose = loose;
    await enter2d(ui, handle, onDrawn);
  } else {
    [, loose] = await Promise.all([enter3d(ui, handle, onDrawn), looseEnds(ui, plan)]);
  }
  if (!ui.live()) { handle.dispose(); return null; }
  handle.loose = loose;
  ui.setPanel(...head, ...top(handle), ...panelHead(plan, kept, {counts}), ...extraPanel(handle),
              planList(plan, handle));
  ui.strip();
  return handle;
}

// The plan grouped by purpose, one group per purpose in first-seen order;
// each row keeps its link's index in the file. A row lights its cable
// (flipping to the face that has it), and names any end that did not land
// and why (looseReason: from what the fill rule kept).
function planList(plan, handle) {
  const wrap = el('div', {class: 'plan-list'});
  for (const purpose of countsBy(plan, 'purpose').keys()) {
    const ul = el('ul');
    plan.links.forEach((l, i) => {
      if (l.purpose !== purpose) return;
      const b = el('button', {type: 'button', 'data-plan-row': String(i),
        text: `${l.from[0]} ${l.from[1]} → ${l.to[0]} ${l.to[1]}`});
      b.onclick = () => handle.highlight?.(i);
      const li = el('li', {'data-purpose': l.purpose}, [b]);
      for (const k of handle.loose[i] || []) li.append(el('span', {class: 'loose', 'data-loose': k,
        text: ' — loose: ' + looseReason(plan, handle.kept, l[k])}));
      ul.append(li);
    });
    wrap.append(el('section', {'data-plan-group': purpose},
      [el('p', {class: 'plan-group', text: purpose}), ul]));
  }
  return wrap;
}

// Both faces built off-screen - laid out, since ends2d reads CTMs, but never
// seen - and every end tested on its own. Returns per link the sides that do
// not land, or null when the entry went stale.
async function looseEnds(ui, plan) {
  const out = plan.links.map(() => []);
  const views = [...new Set(plan.links.flatMap(l => [endView(l.from), endView(l.to)]))];
  const host = el('div', {'aria-hidden': 'true'});
  host.style.cssText = 'position:fixed;left:0;top:0;width:800px;visibility:hidden;pointer-events:none';
  document.body.append(host);
  try {
    for (const view of views) {
      const svg = await build2dElevation({stack: CAST.filter(e => e.ru != null), heightRU: RACK_U,
                                          overrides, view});
      if (!ui.live()) return null;
      host.replaceChildren(svg);
      for (const [i, k] of looseOn(svg, plan, view)) out[i].push(k);
    }
  } finally {
    host.remove();
  }
  return out;
}

// 3D: the cast mounted with the plan's seats, and the plan as tubes hanging
// from its connectors (cables.js). There is no face to flip, so #stageTabs
// stays empty and a row lights its tube and dims the rest. Without WebGL
// mount3d leaves its reason on the scrim, and the panel is built all the
// same (R11).
async function enter3d(ui, handle, onDrawn) {
  document.getElementById('stageTabs')?.replaceChildren();
  const stack = CAST.map(e => ({...e, chassis: chassisOf(e.ref)}));
  const sc = await mount3d({stack, heightRU: RACK_U, overrides});
  if (!ui.live()) { sc?.dispose(); return; }
  handle.dispose = () => sc?.dispose();
  if (!sc) return;
  ui.unscrim();
  // Stale here, the scene is handle.dispose's: enterPatched disposes it.
  const r = await drawCables3d(sc, handle.plan, {live: ui.live});
  if (!r || !ui.live()) return;
  handle.drawn = r.tubes;
  handle.highlight = i => {
    for (const t of r.tubes) if (t.mesh) t.mesh.traverse(o => {
      if (!o.material) return;
      const dim = i != null && t.i !== i;
      // Turning transparency on or off recompiles the shader, which three.js
      // does only when told.
      if (o.material.transparent !== dim) { o.material.transparent = dim; o.material.needsUpdate = true; }
      o.material.opacity = dim ? 0.15 : 1;
    });
  };
  // TEST HOOK, only with ?patchprobe=1: what check-browser.py's 3D step
  // measures - every fiber connector's distance to the nearest drawn start
  // of its cable's tubes, and how far that end's run first heads out along
  // the connector's normal (straight out of the face, not back into it).
  if (new URLSearchParams(location.search).get('patchprobe') === '1') {
    // An unplugged lead's points start at the end that landed, whichever it is.
    window.__patch3d = {tubes: r.tubes, boxes: r.boxes,
      anchors: r.anchors.map(({i, side, anchor}) => {
        const pts = r.tubes[i].points;
        const first = side === 'from' || r.tubes[i].dangling;
        const [p0, p1] = first ? [pts[0], pts[1]] : [pts.at(-1), pts.at(-2)];
        return {i, side,
          firstGap: Math.min(Infinity, ...r.tubes[i].starts.map(p => p.distanceTo(anchor.position))),
          out: p0 && p1 ? p1.clone().sub(p0).dot(anchor.normal) : -Infinity};
      })};
  }
  onDrawn?.(handle);
}

async function enter2d(ui, handle, onDrawn) {
  stage3d.hidden = true; stageRack.hidden = false;
  const tabs = document.getElementById('stageTabs');
  let seq = 0;
  let latest = null;
  const draw = view => (latest = paintFace(view));
  const paintFace = async view => {
    const mine = ++seq;
    const stack = CAST.filter(e => e.ru != null);
    const svg = await build2dElevation({stack, heightRU: RACK_U, overrides, view});
    if (!ui.live() || mine !== seq) return;
    stageRack.replaceChildren(svg);
    const base = svg.getAttribute('viewBox').split(/\s+/).map(Number);
    // Room for tails and their tags on the side a cross-face cable goes
    // round (spec §6): past the right-hand rail on the front, and on the rear
    // the matching side, which is the LEFT when seen from behind.
    const rear = view === 'rear';
    const vb = rear ? [base[0] - ROOM, base[1], base[2] + ROOM, base[3] + 40]
                    : [base[0], base[1], base[2] + ROOM, base[3] + 40];
    svg.setAttribute('viewBox', vb.join(' '));
    panZoom(svg, () => vb);
    const edgeX = rear ? base[0] - 8 : base[0] + base[2] + 8;
    handle.view = view;
    // A tag's pill sits in the side column, outboard of the point it labels:
    // right of it on the front, left of it on the rear.
    const pill = (t, at, label, gap = 4) => {
      const w = 7 * label.length + 12;
      const x = rear ? at[0] - gap - w : at[0] + gap;
      t.append(svgEl('rect', {x, y: at[1] - 9, width: w, height: 18, rx: 4}));
      const tx = svgEl('text', {x: x + 6, y: at[1] + 4}); tx.textContent = label; t.append(tx);
      return t;
    };
    handle.drawn = drawCables2d(svg, handle.plan, view, {
      edgeX, outboard: rear ? -1 : 1,
      tag: (at, far) => pill(svgEl('g', {'data-tag': far.join(':'), 'data-to-view': endView(far),
        class: 'cable-tag', tabindex: '0', role: 'button'}), at, `→ ${far[0]} ${endView(far)} · ${far[1]}`),
      // The far end did not land, and the tag says why - a button to the
      // stage that fixes it, or plain text when that is the Inspect lens (or
      // nothing the visitor did).
      farLoose: (i, side) => !!handle.loose[i]?.includes(side),
      looseTag: (at, far) => {
        const {why, stage} = looseWhy(handle.plan, handle.kept, far);
        const t = svgEl('g', {'data-not-connected': far.join(':'), class: 'cable-tag not-connected',
          ...(stage ? {'data-fix-stage': stage, tabindex: '0', role: 'button'} : {})});
        const full = svgEl('title', {}); full.textContent = looseReason(handle.plan, handle.kept, far);
        t.append(full);
        return pill(t, at, `✕ ${why}`);
      },
    });
    // A cross-face tag flips the face; a not-connected tag with a stage goes
    // to it. Through wireClicks, not an onclick: panZoom captures the pointer
    // on the <svg>, so a plain click never reaches either.
    wireClicks(svg, {targetAt: n => n.closest?.('[data-tag], [data-fix-stage]') || null,
                     open: t => t.dataset.fixStage
                       ? activate(t.dataset.fixStage).catch(err => console.warn('[portrayal] fix stage', err))
                       : handle.setView(t.dataset.toView), ui});
    wireHover(svg);
    paint(view);
    onDrawn?.(handle);
  };
  const buttons = ['front', 'rear'].map(v => {
    const b = el('button', {type: 'button', role: 'tab', 'data-view': v,
      text: v === 'front' ? 'Front' : 'Rear', 'aria-selected': 'false'});
    b.onclick = () => { if (ui.live()) handle.setView(v); };
    return b;
  });
  const paint = v => buttons.forEach(b => b.setAttribute('aria-selected', String(b.dataset.view === v)));
  if (tabs) { tabs.setAttribute('aria-label', 'Rack face'); tabs.replaceChildren(...buttons); }
  handle.setView = v => draw(v).catch(err => console.warn('[portrayal] patched rack', v, err));
  const light = i => {
    const svg = stageRack.querySelector('svg');
    if (!svg) return;
    svg.classList.toggle('cable-focus', i != null);
    for (const g of svg.querySelectorAll('[data-cable], [data-cable-tag]')) g.classList.toggle('on', g.dataset.linkIndex === String(i));
  };
  // A row whose cable has no end on the face shown flips to the face that
  // has it first.
  handle.highlight = async i => {
    const l = i == null ? null : handle.plan.links[i];
    if (l && ![endView(l.from), endView(l.to)].includes(handle.view)) {
      await handle.setView(endView(l.from));
      if (!ui.live()) return;
    }
    light(i);
  };
  // The first face, and any flip that overtook it: the scrim comes down on
  // whichever draw is the newest once it has landed.
  // Only the newest draw's failure is the stage's (the rail says so).
  let awaited;
  do {
    awaited = latest ?? draw('front');
    try { await awaited; } catch (err) { if (latest === awaited) throw err; }
  } while (ui.live() && latest !== awaited);
  if (ui.live()) ui.unscrim();
}

// A cable and its tag (in the tags layer, over every cable) light together.
function wireHover(svg) {
  for (const g of svg.querySelectorAll('[data-cable]')) {
    const t = svg.querySelector(`[data-cable-tag][data-link-index="${g.dataset.linkIndex}"]`);
    const on = () => { svg.classList.add('cable-focus'); g.classList.add('on'); t?.classList.add('on'); };
    const off = () => { svg.classList.remove('cable-focus'); g.classList.remove('on'); t?.classList.remove('on'); };
    g.addEventListener('mouseenter', on); g.addEventListener('mouseleave', off);
    g.addEventListener('focus', on); g.addEventListener('blur', off);
  }
}
