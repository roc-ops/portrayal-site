// THE BUNDLE PANELS, for the side panel and the cable list (portrayal-site#142;
// Portrayal docs/cable-bundles-design.md sections 3 and 7). Like cable-panel.js,
// these build elements and report what the user did; the page sends the kit's
// bundle.* commands with the render's routing context. Every control has an id,
// so the page can hand keyboard focus back to it after a redraw.

import {el} from './dom.js';
import {endName} from '../../vendor/rack/cable-rules.js';
import {bundleOfCable, waypointText} from '../../vendor/rack/bundles.js';
import {bundleSummary, sizeLine, bendLine, peelText} from './bundle-view.js';

const button = (id, text, fn, extra = {}) => {
  const b = el('button', {type: 'button', id, text, ...extra});
  if (fn) b.addEventListener('click', fn);
  return b;
};
const field = (label, control) => el('label', {}, [label, control]);

// WHAT IS SAID OF A BUNDLE, wherever it is listed: its size, its warnings
// (size, and since kit 0.8.0, Portrayal #922, each place the bend is too
// tight), the radius the bend check found (bundle-view.js bendLine), and the
// kit's notes, which name the members whose bend it left unchecked. `fact` is
// bundle-view.js bundleFacts' entry; null before the routes are known.
export function bundleFindings(fact) {
  if (!fact) return [el('span', {class: 'rk-muted', 'data-bundle-note': 'true', text: 'Not checked: the routes are not known yet.'})];
  const out = [];
  const size = fact.drawn && fact.check.checked ? sizeLine(fact) : null;
  if (size) out.push(el('span', {class: 'rk-muted', 'data-bundle-size': fact.id, text: size}));
  for (const w of fact.check.warnings) out.push(el('span', {class: 'rk-warn', 'data-bundle-warning': fact.id, text: w}));
  const bend = bendLine(fact.check);
  if (bend) out.push(el('span', {class: 'rk-muted', 'data-bundle-bend': fact.id, text: bend}));
  for (const n of fact.check.notes) out.push(el('span', {class: 'rk-muted', 'data-bundle-note': fact.id, text: n}));
  return out;
}

// A BUNDLE'S HEADER ROW in the cable list: its name as a button that selects
// it, the one-line summary, then what is said of it.
// IN THE TREE (portrayal-site#190, cable-tree.js) it is a row that opens and
// closes over its members: `tree` is {open, rows (its members' rows),
// warned (how many of them carry a warning), some(n) (that count in words)}.
// The disclosure mark is a click target of its own; the name selects the
// bundle and toggles nothing. Closed, the row keeps its name, its summary
// (how many cables, its size) and its warnings; rack.css folds the rest away.
export function bundleHeader({bundle, fact, selected, onSelect, tree}) {
  const row = button(`bundleRow-${bundle.id}`, fact?.name ?? bundle.id, () => onSelect(bundle.id),
    {'data-bundle-row': bundle.id, 'aria-pressed': String(selected), tabindex: '-1'});
  const summary = el('span', {class: 'rk-cable-meta rk-muted', 'data-bundle-summary': bundle.id, id: `bundleSummary-${bundle.id}`,
    text: fact ? bundleSummary(fact) : `${bundle.members.length} cables`});
  const group = el('ul', {role: 'group'}, tree.rows);
  group.hidden = !tree.open;
  return el('li', {'data-bundle-item': bundle.id, 'data-tree-key': bundle.id, id: `bundleItem-${bundle.id}`, class: 'rk-bundle-head rk-tree-parent',
    role: 'treeitem', 'aria-level': '1', 'aria-expanded': String(tree.open), 'aria-selected': String(selected),
    'aria-labelledby': `bundleRow-${bundle.id} bundleSummary-${bundle.id}`}, [
    el('span', {class: 'rk-twist', 'data-tree-toggle': bundle.id, 'aria-hidden': 'true'}),
    row, summary,
    ...(tree.warned ? [el('span', {class: 'rk-warn', 'data-member-warnings': String(tree.warned), text: tree.some(tree.warned)})] : []),
    ...bundleFindings(fact),
    group]);
}

// The line under a member's row: which bundle, and where a peel point sends it off.
export function memberLine(rack, bundle, fact, cableId) {
  const peel = peelText(rack, bundle, cableId);
  return el('span', {class: 'rk-muted', 'data-bundle-of': bundle.id,
                     text: `In ${fact?.name ?? bundle.id}${peel ? `; ${peel}` : ''}.`});
}

// The cables not in any bundle, which a new bundle or bundle.add can take.
export const unbundled = rack => (rack.cables || []).filter(c => !bundleOfCable(rack, c.id));

// A NEW BUNDLE: tick the cables that run together. `picked` are ticked to
// begin with (the cable selected in the list). onCreate({cables, label})
// answers {error} to show here, or nothing.
export function bundleForm({rack, picked = [], uOf, onCreate, onCancel, onLate = null}) {
  const free = unbundled(rack);
  const err = el('p', {id: 'bError', class: 'rk-error', role: 'alert'});
  const boxes = free.map(c => {
    const box = el('input', {type: 'checkbox', id: `bPick-${c.id}`, 'data-bundle-pick': c.id,
                             ...(picked.includes(c.id) ? {checked: ''} : {})});
    return el('label', {class: 'rk-bundle-pick'}, [box, ` ${c.id} · ${endName(rack, c.a, uOf)} → ${endName(rack, c.b, uOf)}`]);
  });
  const label = el('input', {id: 'bLabel', type: 'text', value: ''});
  const form = el('form', {id: 'bundleForm', class: 'rk-cable-form', novalidate: ''}, [
    el('h3', {text: 'New bundle'}),
    el('p', {class: 'rk-muted', text: 'Tick two or more cables that run together. The bundle follows the route they share, with a Velcro strap every 12 in, one before each point where a cable leaves, and one at each tray tie slot it lies on.'}),
    el('fieldset', {class: 'rk-bundle-picks'}, [el('legend', {text: 'Cables'}), ...boxes]),
    field('Label', label),
    err,
    el('div', {class: 'rk-actions'}, [
      button('bCreate', 'Bundle them', null, {type: 'submit'}),
      button('bCancel', 'Cancel', onCancel)]),
  ]);
  form.addEventListener('submit', ev => {
    ev.preventDefault();
    const cables = [...form.querySelectorAll('[data-bundle-pick]')].filter(b => b.checked).map(b => b.dataset.bundlePick);
    if (cables.length < 2) { err.textContent = 'Tick two or more cables.'; return; }
    // (an answer may come a moment later: a command sent just after an edit
    // waits for the rack's routes. By then a redraw may have replaced this
    // form, and a refusal written here would be seen by nobody: it goes to
    // the page's notice, onLate.)
    const show = res => { err.textContent = res?.error ?? ''; };
    const res = onCreate({cables, label: label.value.trim()});
    if (typeof res?.then === 'function') res.then(late => (late?.error && !err.isConnected ? onLate?.(late.error) : show(late)));
    else show(res);
  });
  return form;
}

// ONE BUNDLE, IN THE SIDE PANEL: what is said of it, its label and strap
// spacing, its members (each can be peeled off, from a waypoint of the trunk
// on, or altogether), cables to add, and dissolving it. Each callback answers
// {error} to show here, or nothing.
const UNITS = ['in', 'mm'];
// PINNED: while the panel is open its bundle is the page's selection, so its
// members, straps and envelope stay lit and the rest dim (hover.js). The list
// row that would put it down is behind this panel, so the panel says so and
// carries the control: `pinned` and `onPin` (a toggle; the panel stays open).
export function bundleInspector({rack, bundle, fact, uOf, onLabel, onStraps, onAdd, onPeel, onRemove, onClose, onLate = null,
                                 pinned = true, onPin = null}) {
  const err = el('p', {id: 'bError', class: 'rk-error', role: 'alert'});
  // (an answer may come a moment later: a command sent just after an edit
  // waits for the rack's routes. A refusal that comes after a redraw has
  // replaced this panel goes to the page's notice, onLate.)
  const say = res => {
    if (typeof res?.then === 'function') res.then(late => (late?.error && !err.isConnected ? onLate?.(late.error) : say(late)));
    else err.textContent = res?.error ?? '';
  };
  const label = el('input', {id: 'bLabel', type: 'text', value: bundle.label || ''});
  label.addEventListener('change', () => say(onLabel(label.value.trim())));
  const every = bundle.straps && 'every' in bundle.straps ? bundle.straps.every : {value: 12, unit: 'in'};
  const value = el('input', {id: 'bEvery', type: 'text', inputmode: 'decimal', value: every ? String(every.value) : ''});
  const unit = el('select', {id: 'bEveryUnit'}, [...UNITS, 'none'].map(u =>
    el('option', {value: u, text: u === 'none' ? 'no straps' : u, ...((every ? every.unit : 'none') === u ? {selected: ''} : {})})));
  const setStraps = () => {
    if (unit.value === 'none') { say(onStraps({every: null})); return; }
    const v = Number(value.value);
    if (!(v > 0)) { err.textContent = 'The spacing is a number above 0.'; return; }
    say(onStraps({every: {value: v, unit: unit.value}}));
  };
  value.addEventListener('change', setStraps);
  unit.addEventListener('change', setStraps);
  // Where a member can leave: each waypoint of the trunk, and every U along a lane run of it.
  const trunk = [];
  (bundle.route || []).forEach((w, k, all) => {
    const prev = all[k - 1];
    if (w.lane && prev?.lane === w.lane) {
      const step = w.ru > prev.ru ? 1 : -1;
      for (let u = prev.ru + step; u !== w.ru; u += step) trunk.push({lane: w.lane, ru: u});
    }
    trunk.push(w);
  });
  const members = bundle.members.map(m => {
    const c = (rack.cables || []).find(x => x.id === m.cable);
    const at = el('select', {id: `bPeelAt-${m.cable}`, 'aria-label': `Where ${m.cable} leaves`}, [
      el('option', {value: '', text: 'out of the bundle'}),
      ...trunk.map((w, k) => el('option', {value: String(k), text: `from ${waypointText(rack, w)}`}))]);
    const peel = button(`bPeel-${m.cable}`, 'Peel off', () => {
      const w = at.value === '' ? null : trunk[Number(at.value)];
      say(onPeel(m.cable, w));
    });
    const peelAt = peelText(rack, bundle, m.cable);
    return el('li', {'data-bundle-member': m.cable}, [
      el('span', {text: c ? `${c.id} · ${endName(rack, c.a, uOf)} → ${endName(rack, c.b, uOf)}` : m.cable}),
      ...(peelAt ? [el('span', {class: 'rk-muted', text: peelAt})] : []),
      el('div', {class: 'rk-actions'}, [at, peel])]);
  });
  const free = unbundled(rack);
  const pick = el('select', {id: 'bAddPick', 'aria-label': 'Cable to add'}, free.map(c => el('option', {value: c.id, text: c.id})));
  const add = free.length ? el('div', {class: 'rk-actions'}, [pick, button('bAdd', 'Add to bundle', () => say(onAdd([pick.value])))]) : null;
  const pin = onPin ? button('bPin', pinned ? 'Pinned' : 'Pin highlight', onPin,
    {'aria-pressed': String(pinned), title: pinned ? 'Highlighted on the rack. Click to stop highlighting it.' : 'Highlight this bundle on the rack.'}) : null;
  return el('div', {id: 'bundlePanel', class: 'rk-cable-form rk-bundle'}, [
    el('div', {class: 'rk-bundle-title'}, [el('h3', {text: fact?.name ?? bundle.id}), pin].filter(Boolean)),
    el('p', {class: 'rk-muted', 'data-bundle-summary': bundle.id, text: fact ? bundleSummary(fact) : `${bundle.members.length} cables`}),
    el('p', {class: 'rk-bundle-findings'}, bundleFindings(fact)),
    field('Label', label),
    el('div', {class: 'rk-length'}, [field('Velcro strap every', value), field('Unit', unit)]),
    el('h4', {text: 'Cables'}),
    el('ul', {class: 'rk-bundle-members'}, members),
    add,
    err,
    el('div', {class: 'rk-actions'}, [
      button('bRemove', 'Dissolve bundle', onRemove),
      button('bDone', 'Done', onClose)]),
  ].filter(Boolean));
}
