// THE CABLE PANELS, for the side panel (spec §9.2, §9.4). Like frame-form.js
// and inspector.js, these build elements and report what the user did; the
// page decides what a change means. No prompt() and no confirm() (Phase 2
// ruling 10): the side panel is rebuilt on every redraw, and every control
// here has an id so the page can hand keyboard focus back to it.

import {el} from './dom.js';
import {MEDIA, MEDIA_LABELS, UNITS, mismatch, parseLength, lengthText, endName, endKey, countsBy,
        matches} from '../../vendor/rack/cable-rules.js';
import {bundlesOf, bundleOfCable} from '../../vendor/rack/bundles.js';
import {bundleHeader, memberLine} from './bundle-panel.js';
import {spareText, needsText, SPARE_HELP, FIGURES_HELP} from './spare.js';
import {LOOSE, wireTree} from './cable-tree.js';

const option = (value, text, current) =>
  el('option', {value, text, ...(String(current ?? '') === String(value) ? {selected: ''} : {})});
const field = (label, control) => el('label', {}, [label, control]);
const button = (id, text, fn, type = 'button') => {
  const b = el('button', {type, id, text});
  if (fn) b.addEventListener('click', fn);
  return b;
};

// ONE CABLE, AS A FORM - a new one or one being edited (the same form). The
// ends are fixed: they were picked on the drawing. `cable` gives the starting
// values ({media, purpose, label, length}; an `id` means it is being edited);
// `infoA` and `infoB` are the ends' connectors (cable-rules.js connectorOf),
// for the warning beside the media; `purposes` are the ones the rack already
// uses, offered as suggestions. A media mismatch is a WARNING and never stops
// a save (spec §9.3). onSave gets {media, purpose, label} and, ONLY when the
// length field or its unit was changed, `length`: the new one, or null when
// the field was emptied. No `length` key means the length was left alone -
// the cable keeps whatever it has, including one kept as written.
export function cableForm({title, endA, endB, cable, infoA = null, infoB = null, purposes = [], routed = null,
                           onSave, onCancel}) {
  const media = el('select', {id: 'cMedia', 'aria-describedby': 'cWarn'}, [
    option('', 'Not set', cable.media),
    // (kit 0.30.0: `power` is an AC cord or a DC feed, `ground` a bonding wire)
    ...MEDIA.map(m => option(m, MEDIA_LABELS[m], cable.media)),
    // A media from a file this page does not know stays selectable as itself.
    ...(cable.media && !MEDIA.includes(cable.media) ? [option(cable.media, cable.media, cable.media)] : [])]);
  const purpose = el('input', {id: 'cPurpose', type: 'text', value: cable.purpose || '',
                               list: 'cPurposes', autocomplete: 'off'});
  const label = el('input', {id: 'cLabel', type: 'text', value: cable.label || ''});
  const length = el('input', {id: 'cLength', type: 'text', inputmode: 'decimal', 'aria-describedby': 'cError',
                              value: cable.length ? String(cable.length.value) : ''});
  // A unit from a file this page does not know stays selectable as itself.
  const oddUnit = cable.length?.unit && !UNITS.includes(cable.length.unit) ? cable.length.unit : null;
  const unit = el('select', {id: 'cUnit'}, [...UNITS, ...(oddUnit ? [oddUnit] : [])]
    .map(u => option(u, u, cable.length?.unit || 'm')));
  // What the fields held when the form opened, whatever the cable had: a
  // length left alone is not sent at all, so it is kept exactly - even one
  // this form's rule would refuse, or one the loader could only keep as written.
  const loaded = {text: length.value, unit: unit.value};
  // A routed length is the page's measurement: shown, not an entry. Typing
  // one saves it as entered; clearing the field saves no length, and the
  // routed upkeep resumes on the next render.
  const routedNote = el('p', {id: 'cRouted', class: 'rk-muted',
    // (kit 0.22.0: a routed length holds `need`, what the cord must at least be, where it held `measured`)
    text: routed && Number.isFinite(routed.need)
      ? `${routed.value} ${routed.unit || 'm'} (routed: the route needs ${routed.need} m). Type a length to override it.` : ''});
  const warn = el('p', {id: 'cWarn', class: 'rk-warn', role: 'status'});
  const err = el('p', {id: 'cError', class: 'rk-error', role: 'alert'});
  const showWarn = () => { warn.textContent = mismatch(media.value, infoA, infoB).join(' '); };
  media.addEventListener('change', showWarn);
  const clearErr = () => { err.textContent = ''; };
  length.addEventListener('input', clearErr);
  unit.addEventListener('change', clearErr);
  showWarn();

  const form = el('form', {id: 'cableForm', class: 'rk-cable-form', novalidate: ''}, [
    el('h3', {text: title}),
    el('p', {id: 'cEndA', class: 'rk-muted', text: `A: ${endA}`}),
    el('p', {id: 'cEndB', class: 'rk-muted', text: `B: ${endB}`}),
    field('Media', media),
    warn,
    field('Purpose', purpose),
    el('datalist', {id: 'cPurposes'}, purposes.map(p => el('option', {value: p}))),
    field('Label', label),
    el('div', {class: 'rk-length'}, [field('Length', length), field('Unit', unit)]),
    routedNote,
    err,
    el('div', {class: 'rk-actions'}, [
      button('cSave', cable.id ? 'Save' : 'Add cable', null, 'submit'),
      button('cCancel', 'Cancel', onCancel)]),
  ]);
  // A form, so Enter in any field saves.
  form.addEventListener('submit', ev => {
    ev.preventDefault();
    if (length.value === loaded.text && unit.value === loaded.unit) {
      err.textContent = '';
      onSave({media: media.value, purpose: purpose.value.trim(), label: label.value.trim()});
      return;
    }
    // A NEW value cannot ride on a unit this page does not know; clearing the
    // field is not a new value, and saves no length whatever the unit says.
    const len = length.value.trim() && oddUnit && unit.value === oddUnit
      ? {ok: false, reason: 'Choose m or ft for the new length.'}
      : parseLength(length.value, unit.value);
    if (!len.ok) { err.textContent = len.reason; length.focus(); return; }
    err.textContent = '';
    onSave({media: media.value, purpose: purpose.value.trim(), label: label.value.trim(), length: len.length});
  });
  return form;
}

// THE CABLE LIST (spec §9.4): every cable as a row, stage 5's two filters
// over them, and the selected row's actions. `ends` is cableFacts' Map
// (endKey -> {info, reason}); `on` is the filter, {purpose, media}, null on
// an axis that is not narrowing. A row names both ends, then says what is
// known and what is wrong: a loose end with its reason (spec §9.3), a media
// mismatch as a warning. A row the filter leaves out is hidden; the count
// line says how many match. `uOf` is endName's: how tall a device is, for
// the U a row names it with.
// BUNDLES (portrayal-site#142): with any, the cables are grouped by bundle,
// each group under its bundle's header row (bundle-panel.js bundleHeader:
// name, members, size, warnings), and the rest follow. `bundles` is
// bundle-view.js bundleFacts' Map, or null before the routes are known. A
// selected cable gets a Bundle button (onBundleNew) or, in a bundle, one that
// opens it (onBundleSelect). A rack with no bundles lists exactly as before.
// SPARE (spare.js): `spares` is sparesOf's Map (cable id -> its spare). A cable
// in it says its cord and its spare where it said its length ("1 m cord, 0.58
// m spare"). No row is marked for having much spare: most cords do. An entered
// length shorter than what its route needs (the kit's `need`, kit 0.22.0)
// IS a signal, and says so as a warning ("0.3 m cord, 0.12 m short; the route
// needs 0.42 m"). One line
// under the count says what the drawing shows. A cable not in it (not routed, a loose end, a length
// the page cannot convert) says its length as before.
// A TREE (portrayal-site#190, cable-tree.js): the list is role="tree". Each
// bundle's header is a row that opens and closes over its members
// (aria-expanded, its members in a role="group" beneath it), the cables in no
// bundle are a group of their own ("Not bundled") when the rack has a bundle,
// and every row is a treeitem with one Tab stop between them. A row that is
// closed still says its name, how many cables it holds and its size, and how
// many of them carry a warning (a loose end, a media mismatch, a cord shorter
// than its route). `tree` is the page's: {open(key), stop (the row that had
// the Tab stop), onToggle(key, open), onStop(id)}; without it every row is
// open. Each row says where it is among its siblings that show (aria-setsize,
// aria-posinset). A row's own button, its id and
// its data-* are as they were.
// THE WARNINGS, ONE SECTION THAT OPENS (portrayal-site#192). Every route
// warning used to stand above the cable list, a sentence each: a rack being
// built with dozens of tight bends had its bundles and cables pushed out of
// sight. They are now one row above the tree, "Warnings (N)", CLOSED until the
// reader opens it, so the tree is always in view; it takes the page's warning
// colour while N is above zero, and is absent when there is nothing to warn
// of. N counts FINDINGS, not sentences: a cable with three tight corners is
// one (route-context.js routeWarnings), as the kit's describe counts cables.
//
// Opened, the findings are listed by kind, each kind with its count ("Tight
// bends (12)"); a kind of more than WARNINGS_FOLD findings is itself a row
// that opens. A finding names its cable (as its row in the tree does) or its
// manager, and is a button: it pins that cable, or selects that manager, as
// the tree's row does. Under it are the sentences, each the kit's or the
// page's own, word for word as they were (a route warning keeps
// `data-route-warning`).
//
// The kinds, in order: the route's (`fill`, `capacity`, `gone`, `rings`,
// `bodies`, `bends`), then what each cable's own row already says and still
// says: a loose end, a media mismatch, a cord shorter than its route needs.
//
// IT IS A DISCLOSURE, NOT PART OF THE TREE: each row that opens is a button
// with aria-expanded and aria-controls, in the Tab order ahead of the tree's
// one stop; Enter and Space open and close it. The tree's roving focus and
// its arrow keys are the tree's alone. What is open is the reader's, kept per
// rack document with the tree's rows (`open(key)`, `onToggle(key, on)`: keys
// `warnings` and `warnings/<kind>`); nothing opens by itself when a warning
// appears, and the count is the rack's as it is at every redraw of the panel.
export const WARNINGS_FOLD = 5;
export const WARNING_KINDS = {
  fill: 'Pathways over their fill', capacity: 'More cables than a manager states', gone: 'Waypoints that are gone',
  rings: 'Rings entered and left by one face', bodies: 'Cables through a body', bends: 'Tight bends',
  loose: 'Loose ends', mismatch: 'Media mismatches', short: 'Cords shorter than their route'};
// The over-capacity list's title (kit 0.40.0): a row whose manager states no count is measured against the library's
// estimate, and the sentence says so; the title does not call that a stated count.
export function capacityKindTitle(rows) {
  const est = rows.filter(r => r.estimated === true).length;
  if (!est) return WARNING_KINDS.capacity;
  return est === rows.length ? "More cables than a manager's estimated capacity" : 'More cables than a manager states or is estimated to hold';
}
const twist = () => el('span', {class: 'rk-twist', 'aria-hidden': 'true'});
function discloser(id, text, bodyId, open, onToggle, attrs = {}) {
  const b = el('button', {type: 'button', id, class: 'rk-warnings-row', 'aria-expanded': String(open), 'aria-controls': bodyId, ...attrs},
               [twist(), el('span', {class: 'rk-tree-name', text})]);
  b.addEventListener('click', () => {
    const on = b.getAttribute('aria-expanded') !== 'true';
    b.setAttribute('aria-expanded', String(on));
    document.getElementById(bodyId).hidden = !on;
    onToggle(on);
  });
  return b;
}
/** `kinds`: [{kind, rows: [{cable | item: id, or neither, texts, route}]}], `route` true for the routes' sentences.
 *  `nameOf({cable | item})` is the finding's name. null when there is nothing to warn of. */
export function warningsSection({kinds, nameOf, open = () => false, onToggle = () => {}, onPick = () => {}}) {
  const n = kinds.reduce((m, k) => m + k.rows.length, 0);
  if (!n) return null;
  const shown = open('warnings');
  const body = el('div', {id: 'warningsBody', class: 'rk-warnings-body'}, kinds.map(({kind, rows}) => {
    const title = `${kind === 'capacity' ? capacityKindTitle(rows) : WARNING_KINDS[kind] ?? kind} (${rows.length})`, listId = `warningList-${kind}`;
    const folds = rows.length > WARNINGS_FOLD, kindOpen = !folds || open(`warnings/${kind}`);
    // (a list by role, not `ul` and `li`: the rows of the tree are the panel's only list items, and are read as such)
    const list = el('div', {id: listId, class: 'rk-warnings-list', role: 'list'}, rows.map((r, k) => {
      const texts = r.texts.map(text => el('p', {class: 'rk-warn', ...(r.route ? {'data-route-warning': 'true'} : {'data-warning-text': 'true'}), text}));
      const name = r.cable || r.item ? nameOf(r) : null;
      if (!name) return el('div', {'data-warning-row': kind, role: 'listitem'}, texts);
      const pick = el('button', {type: 'button', id: `warningRow-${kind}-${k}`, 'data-warning-pick': r.cable ? `cable ${r.cable}` : `item ${r.item}`,
                                 text: r.texts.length > 1 ? `${name} (${r.texts.length})` : name});
      pick.addEventListener('click', () => onPick(r));
      return el('div', {'data-warning-row': kind, role: 'listitem'}, [pick, ...texts]);
    }));
    list.hidden = !kindOpen;
    return el('div', {class: 'rk-warnings-kind', 'data-warning-kind': kind, 'data-count': String(rows.length)}, [
      folds ? discloser(`warningKind-${kind}`, title, listId, kindOpen, on => onToggle(`warnings/${kind}`, on))
            : el('p', {class: 'rk-warnings-title', id: `warningKind-${kind}`, text: title}),
      list]);
  }));
  body.hidden = !shown;
  return el('div', {class: 'rk-warnings', 'data-warnings': 'true', 'data-count': String(n)}, [
    discloser('warningsToggle', `Warnings (${n})`, 'warningsBody', shown, on => onToggle('warnings', on)), body]);
}

// What a cable says under its ends: label, media, purpose, then its cord and spare, or its length.
export const cableMeta = (c, spare = null) =>
  [c.label, MEDIA_LABELS[c.media] || c.media, c.purpose, spare ? spareText(spare) : lengthText(c.length)].filter(Boolean).join(' · ');
export function cableList({rack, ends, notes = [], on, uOf, selectedId = null, mode3d = false, onFilter, onSelect, onEdit, onDelete,
                           spares = new Map(), bundles = null, selectedBundle = null, onBundleSelect = () => {}, onBundleNew = null,
                           tree = null, warnings = null, onWarningPick = () => {}}) {
  const cables = rack.cables;
  const info = e => ends.get(endKey(e))?.info || null;
  const why = e => ends.get(endKey(e))?.reason || null;
  const shown = cables.filter(c => matches(c, on)).length;
  if (!cables.length)
    return el('div', {id: 'cableList', class: 'rk-cables'}, [
      el('h3', {text: 'Cables'}),
      // Cable mode is 2D's: in 3D the sentence above the list says where cables are.
      el('p', {id: 'cableEmpty', class: 'rk-muted',
               text: mode3d ? 'No cables yet.' : 'No cables yet. Use Cable mode and click a port at each end.'})]);

  const filterRow = (field, title) => el('div', {class: 'rk-filter', 'data-filter-row': field}, [
    el('span', {class: 'rk-muted', text: title}),
    ...[...countsBy(cables, field)].map(([v, n], k) => {
      const b = el('button', {type: 'button', id: `cableFilter-${field}-${k}`, [`data-filter-${field}`]: v,
        'aria-pressed': String(on[field] === v), text: `${v || 'not set'} (${n})`});
      b.addEventListener('click', () => onFilter({...on, [field]: on[field] === v ? null : v}));
      return b;
    })]);

  // How many of the rows built so far carry a warning, by cable id.
  const warned = new Set();
  const rowOf = (c, level = 1) => {
    const picked = c.id === selectedId;
    const row = el('button', {type: 'button', id: `cableRow-${c.id}`, 'data-cable-row': c.id, tabindex: '-1',
      'aria-pressed': String(picked), text: `${endName(rack, c.a, uOf)} → ${endName(rack, c.b, uOf)}`});
    row.addEventListener('click', () => onSelect(c.id));
    const kids = [row];
    const spare = spares.get(c.id) ?? null;
    const meta = cableMeta(c, spare);
    if (meta) kids.push(el('span', {class: 'rk-cable-meta rk-muted', id: `cableMeta-${c.id}`, ...(spare ? {'data-spare': spareText(spare)} : {}), text: meta}));
    const needs = spare ? needsText(spare) : null;
    if (needs) kids.push(el("span", {class: "rk-warn", "data-spare-short": c.id, text: `${spareText(spare)}; ${needs}.`}));
    for (const [k, e] of [['a', c.a], ['b', c.b]])
      if (why(e)) kids.push(el('span', {class: 'rk-loose', 'data-loose': k, text: `Loose end ${k.toUpperCase()}: ${why(e)}.`}));
    const wrong = mismatch(c.media, info(c.a), info(c.b));
    for (const w of wrong)
      kids.push(el('span', {class: 'rk-warn', 'data-warning': 'true', text: w}));
    if (needs || wrong.length || why(c.a) || why(c.b)) warned.add(c.id);
    // The selected cable stays on the list even when the filter leaves it out; say so.
    if (picked && !matches(c, on))
      kids.push(el('span', {class: 'rk-muted', 'data-off-filter': 'true', text: 'Not in this filter.'}));
    const inB = bundleOfCable(rack, c.id);
    if (inB) kids.push(memberLine(rack, inB, bundles?.get(inB.id) ?? null, c.id));
    const bundleBtn = !picked || !onBundleNew ? null
      : inB ? button('cableBundleOpen', `Open ${bundles?.get(inB.id)?.name ?? inB.id}`, () => onBundleSelect(inB.id))
        : cables.length >= 2 ? button('cableBundle', 'Bundle…', () => onBundleNew(c.id)) : null;
    if (picked) kids.push(el('div', {class: 'rk-actions'}, [
      button('cableEdit', 'Edit', () => onEdit(c.id)),
      button('cableDelete', 'Delete', () => onDelete(c.id)), bundleBtn].filter(Boolean)));
    const li = el('li', {'data-cable-item': c.id, id: `cableItem-${c.id}`, role: 'treeitem', 'aria-level': String(level),
      'aria-selected': String(picked), 'aria-labelledby': `cableRow-${c.id}${meta ? ` cableMeta-${c.id}` : ''}`,
      ...(inB ? {class: 'rk-bundled'} : {})}, kids);
    li.hidden = !picked && !matches(c, on);
    return li;
  };
  // Each bundle's header, then its members in combing order beneath it; then the cables in no bundle.
  const groups = bundlesOf(rack);
  const inAny = new Set(groups.flatMap(b => b.members.map(m => m.cable)));
  const isOpen = key => (tree ? tree.open(key) : true);
  // where each row is among the rows of its level that the filter leaves in
  const place = lis => { const shown = lis.filter(li => !li.hidden);
    shown.forEach((li, k) => { li.setAttribute('aria-setsize', String(shown.length)); li.setAttribute('aria-posinset', String(k + 1)); }); return lis; };
  const some = n => `${n} cable${n === 1 ? '' : 's'} with a warning`;
  const rows = groups.map(b => {
    const members = b.members.map(m => cables.find(c => c.id === m.cable)).filter(Boolean);
    const kids = place(members.map(c => rowOf(c, 2)));
    return bundleHeader({bundle: b, fact: bundles?.get(b.id) ?? null, selected: selectedBundle === b.id, onSelect: onBundleSelect,
      tree: {open: isOpen(b.id), rows: kids, warned: members.filter(c => warned.has(c.id)).length, some}});
  });
  const free = cables.filter(c => !inAny.has(c.id));
  if (!groups.length) rows.push(...free.map(c => rowOf(c)));
  else if (free.length) {
    const kids = place(free.map(c => rowOf(c, 2))), n = free.filter(c => warned.has(c.id)).length, open = isOpen(LOOSE);
    const group = el('ul', {role: 'group'}, kids);
    group.hidden = !open;
    rows.push(el('li', {'data-tree-group': LOOSE, 'data-tree-key': LOOSE, id: 'cableGroup-none', role: 'treeitem', 'aria-level': '1',
      'aria-expanded': String(open), 'aria-labelledby': 'cableGroupName-none cableGroupCount-none', class: 'rk-tree-parent'}, [
      el('span', {class: 'rk-twist', 'data-tree-toggle': LOOSE, 'aria-hidden': 'true'}),
      el('span', {class: 'rk-tree-name', id: 'cableGroupName-none', 'data-tree-toggle': LOOSE, text: 'Not bundled'}),
      el('span', {class: 'rk-cable-meta rk-muted', id: 'cableGroupCount-none', 'data-group-count': String(free.length),
                  text: `${free.length} cable${free.length === 1 ? '' : 's'}`}),
      ...(n ? [el('span', {class: 'rk-warn', 'data-member-warnings': String(n), text: some(n)})] : []),
      group]));
  }
  // What each cable's own row says and the Warnings section lists too: the same sentences, by kind.
  const cableTitle = id => { const c = cables.find(x => x.id === id); return c ? `${id}: ${endName(rack, c.a, uOf)} → ${endName(rack, c.b, uOf)}` : id; };
  const warningItemName = id => rack.items.find(i => i.id === id)?.label ?? (rack.zeroU || []).find(z => z?.id === id)?.label ?? id;
  const ownWarnings = () => {
    const loose = [], wrong = [], short = [];
    for (const c of cables) {
      const ends = [['a', c.a], ['b', c.b]].filter(([, e]) => why(e)).map(([k, e]) => `Loose end ${k.toUpperCase()}: ${why(e)}.`);
      if (ends.length) loose.push({cable: c.id, texts: ends});
      const bad = mismatch(c.media, info(c.a), info(c.b));
      if (bad.length) wrong.push({cable: c.id, texts: bad});
      const spare = spares.get(c.id) ?? null, needs = spare ? needsText(spare) : null;
      if (needs) short.push({cable: c.id, texts: [`${spareText(spare)}; ${needs}.`]});
    }
    return [{kind: 'loose', rows: loose}, {kind: 'mismatch', rows: wrong}, {kind: 'short', rows: short}].filter(k => k.rows.length);
  };
  const list = el('ul', {role: 'tree', 'aria-label': 'Cables', class: 'rk-tree'}, place(rows));
  wireTree(list, {stop: tree?.stop ?? null, onToggle: tree?.onToggle, onStop: tree?.onStop});

  return el('div', {id: 'cableList', class: 'rk-cables'}, [
    el('h3', {text: 'Cables'}),
    filterRow('purpose', 'Purpose'),
    filterRow('media', 'Media'),
    el('p', {class: 'rk-muted', 'data-filter-count': 'true', 'data-matching': String(shown),
             'data-total': String(cables.length), text: `${shown} of ${cables.length} ${cables.length === 1 ? 'cable matches' : 'cables match'}.`}),
    ...(spares.size ? [el('p', {class: 'rk-muted', 'data-spare-help': 'true', text: SPARE_HELP}), el('p', {class: 'rk-muted', 'data-figures-help': 'true', text: FIGURES_HELP})] : []),
    // (one section that opens, above the tree, when the page gives the routes' warnings by kind: warningsSection;
    // else every sentence, as before)
    ...(warnings ? [warningsSection({kinds: [...warnings.map(k => ({...k, rows: k.rows.map(r => ({...r, route: true}))})), ...ownWarnings()],
                                     nameOf: r => (r.cable ? cableTitle(r.cable) : warningItemName(r.item)),
                                     open: key => tree?.state?.(key) === true, onToggle: (key, on) => tree?.onToggle?.(key, on), onPick: onWarningPick})].filter(Boolean)
                : notes.map(text => el('p', {class: 'rk-warn', 'data-route-warning': 'true', text}))),
    list,
  ]);
}

// REMOVING A DEVICE THAT HAS CABLES asks first (spec §9.3), here in the side
// panel: delete its cables with it, or keep them - a kept cable stays in the
// file and in the list with that end loose ("the device was removed").
export function removePanel({item, count, onBoth, onKeep, onCancel}) {
  const n = `${count} cable${count === 1 ? '' : 's'}`;
  return el('div', {id: 'removePanel', class: 'rk-remove'}, [
    el('h3', {text: `Remove ${item.label}`}),
    el('p', {class: 'rk-muted', text: `${item.label} has ${n}. Delete ${count === 1 ? 'it' : 'them'} too, or keep ${count === 1 ? 'it' : 'them'} as ${count === 1 ? 'a loose end' : 'loose ends'}?`}),
    el('div', {class: 'rk-actions'}, [
      button('removeWithCables', `Remove and delete ${n}`, onBoth),
      button('removeKeepCables', `Remove and keep ${n}`, onKeep),
      button('removeCancel', 'Cancel', onCancel)]),
  ]);
}
