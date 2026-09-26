// The body stages 4 and 5 share: the cast rack with the plan's seats, cabled.
// In 2D the front or the rear elevation (the Front/Rear toggle lives in
// #stageTabs, which the rail empties on vacate); in 3D the mounted rack and
// its tubes (Task 4). Every write after an await is behind ui.live().

import {stage3d, stageRack, el, svgEl, lead, kv, panZoom} from './artifact.js';
import {CAST, RACK_U, loadMeta, overrides, build2dElevation, mount3d, chassisOf, shortRef}
  from './rack.js';
import {loadPlan, applyPlanSeats, planSeatsMade, looseReason, countsBy} from './plan.js';
import {drawCables2d, colorOf} from './cables.js';
import {wireClicks} from './svg2d.js';

export const HONEST = 'An example patching plan for this rack, not a real lab.';

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

// The honesty line, what the plan seated, what the fill rule kept of the
// visitor's, the counts by purpose and the legend.
export function panelHead(plan, kept) {
  const seats = planSeatsMade();
  const kids = [lead(`<strong>${HONEST}</strong>`)];
  if (seats.length) {
    const top = seats.filter(s => !s.key.includes('-occupant') && !/\/module\/p\d+$|^port-\d+$/.test(s.key));
    kids.push(kv([['seated for the plan', `${seats.length} parts`, true],
                  ...top.map(s => [`${s.dev} ${s.key}`, shortRef(s.ref)])]));
  }
  for (const k of kept) kids.push(el('p', {class: 'panel-lead', 'data-kept': k.key,
    text: `Kept your ${k.dev} ${k.key}: ${k.have ? shortRef(k.have) : 'empty'}.`}));
  kids.push(kv([...countsBy(plan, 'purpose')].map(([p, n]) => [p, String(n)])));
  kids.push(legendFor(plan));
  return kids;
}

// `head` leads the panel (the stage's title and question); `extraPanel(handle)`
// follows the shared head. Returns the handle the stage keeps, or null when
// the entry went stale.
export async function enterPatched(ui, {head = [], onDrawn, extraPanel = () => []} = {}) {
  ui.scrim('Patching the rack…');
  await loadMeta();
  if (!ui.live()) return null;
  const plan = await loadPlan();
  if (!ui.live()) return null;
  const {kept} = applyPlanSeats(plan, overrides);
  const handle = {mode: ui.mode, plan, kept, drawn: [], view: 'front',
                  setView: null, highlight: null, dispose: () => {}};
  if (ui.mode === '2d') await enter2d(ui, handle, onDrawn);
  else await enter3d(ui, handle);
  if (!ui.live()) { handle.dispose(); return null; }
  ui.setPanel(...head, ...panelHead(plan, kept), ...extraPanel(handle), planList(plan, handle));
  ui.strip();
  return handle;
}

// One row per link, in plan order; a row lights its cable, and names any end
// that did not land and why (looseReason: from what the fill rule kept).
function planList(plan, handle) {
  const ul = el('ul', {class: 'plan-list'});
  plan.links.forEach((l, i) => {
    const b = el('button', {type: 'button', 'data-plan-row': String(i),
      text: `${l.from[0]} ${l.from[1]} → ${l.to[0]} ${l.to[1]}`});
    b.onclick = () => handle.highlight?.(i);
    const loose = handle.drawn[i]?.loose || [];
    const li = el('li', {'data-purpose': l.purpose}, [b]);
    for (const k of loose) li.append(el('span', {class: 'loose', 'data-loose': k,
      text: ' — loose: ' + looseReason(plan, handle.kept, l[k])}));
    ul.append(li);
  });
  return ul;
}

// 3D, until Task 4 draws the tubes: the cast mounted with the plan's seats.
// Without WebGL mount3d leaves its reason on the scrim, and the panel is
// built all the same (R11).
async function enter3d(ui, handle) {
  const stack = CAST.map(e => ({...e, chassis: chassisOf(e.ref)}));
  const sc = await mount3d({stack, heightRU: RACK_U, overrides});
  if (!ui.live()) { sc?.dispose(); return; }
  handle.dispose = () => sc?.dispose();
  if (sc) ui.unscrim();
}

async function enter2d(ui, handle, onDrawn) {
  stage3d.hidden = true; stageRack.hidden = false;
  const tabs = document.getElementById('stageTabs');
  let seq = 0;
  const draw = async view => {
    const mine = ++seq;
    const stack = CAST.filter(e => e.ru != null);
    const svg = await build2dElevation({stack, heightRU: RACK_U, overrides, view});
    if (!ui.live() || mine !== seq) return;
    stageRack.replaceChildren(svg);
    const base = svg.getAttribute('viewBox').split(/\s+/).map(Number);
    // Room past the right-hand rail for tails and their tags.
    const vb = [base[0], base[1], base[2] + 260, base[3] + 40];
    svg.setAttribute('viewBox', vb.join(' '));
    panZoom(svg, () => vb);
    const edgeX = base[0] + base[2] + 8;
    handle.view = view;
    handle.drawn = drawCables2d(svg, handle.plan, view, {edgeX, tag: (at, far) => {
      const t = svgEl('g', {'data-tag': far.join(':'), 'data-to-view': far[2] || 'front',
        class: 'cable-tag', tabindex: '0', role: 'button'});
      const label = `→ ${far[0]} ${far[2] || 'front'} · ${far[1]}`;
      t.append(svgEl('rect', {x: at[0] + 4, y: at[1] - 9, width: 7 * label.length + 12, height: 18, rx: 4}));
      const tx = svgEl('text', {x: at[0] + 10, y: at[1] + 4}); tx.textContent = label; t.append(tx);
      return t;
    }});
    // A tag flips the face. Through wireClicks, not an onclick: panZoom
    // captures the pointer on the <svg>, so a plain click never reaches it.
    wireClicks(svg, {targetAt: n => n.closest?.('[data-tag]') || null,
                     open: t => handle.setView(t.dataset.toView), ui});
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
  handle.highlight = i => {
    const svg = stageRack.querySelector('svg');
    if (!svg) return;
    svg.classList.toggle('cable-focus', i != null);
    for (const g of svg.querySelectorAll('[data-cable]')) g.classList.toggle('on', g.dataset.linkIndex === String(i));
  };
  await draw('front');
  if (ui.live()) ui.unscrim();
}

function wireHover(svg) {
  for (const g of svg.querySelectorAll('[data-cable]')) {
    const on = () => { svg.classList.add('cable-focus'); g.classList.add('on'); };
    const off = () => { svg.classList.remove('cable-focus'); g.classList.remove('on'); };
    g.addEventListener('mouseenter', on); g.addEventListener('mouseleave', off);
    g.addEventListener('focus', on); g.addEventListener('blur', off);
  }
}
