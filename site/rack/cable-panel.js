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
import {spareText, needsText, SPARE_HELP} from './spare.js';

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
    text: routed && Number.isFinite(routed.measured)
      ? `${routed.value} ${routed.unit || 'm'} (routed, ${routed.measured} m measured). Type a length to override it.` : ''});
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
// length shorter than what its route needs (the kit's routed length, whatever
// stock size it rounds up to) IS a signal, and says so as a warning ("0.5 m
// cord, 0.02 m spare without dressing room; the route needs 0.68 m"). One line
// under the count says what the drawing shows. A cable not in it (not routed, a loose end, a length
// the page cannot convert) says its length as before.
// What a cable says under its ends: label, media, purpose, then its cord and spare, or its length.
export const cableMeta = (c, spare = null) =>
  [c.label, MEDIA_LABELS[c.media] || c.media, c.purpose, spare ? spareText(spare) : lengthText(c.length)].filter(Boolean).join(' · ');
export function cableList({rack, ends, notes = [], on, uOf, selectedId = null, mode3d = false, onFilter, onSelect, onEdit, onDelete,
                           spares = new Map(), bundles = null, selectedBundle = null, onBundleSelect = () => {}, onBundleNew = null}) {
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

  const rowOf = c => {
    const picked = c.id === selectedId;
    const row = el('button', {type: 'button', id: `cableRow-${c.id}`, 'data-cable-row': c.id,
      'aria-pressed': String(picked), text: `${endName(rack, c.a, uOf)} → ${endName(rack, c.b, uOf)}`});
    row.addEventListener('click', () => onSelect(c.id));
    const kids = [row];
    const spare = spares.get(c.id) ?? null;
    const meta = cableMeta(c, spare);
    if (meta) kids.push(el('span', {class: 'rk-cable-meta rk-muted', ...(spare ? {'data-spare': spareText(spare)} : {}), text: meta}));
    const needs = spare ? needsText(spare) : null;
    if (needs) kids.push(el("span", {class: "rk-warn", "data-spare-short": c.id, text: `${spareText(spare)}; ${needs}.`}));
    for (const [k, e] of [['a', c.a], ['b', c.b]])
      if (why(e)) kids.push(el('span', {class: 'rk-loose', 'data-loose': k, text: `Loose end ${k.toUpperCase()}: ${why(e)}.`}));
    for (const w of mismatch(c.media, info(c.a), info(c.b)))
      kids.push(el('span', {class: 'rk-warn', 'data-warning': 'true', text: w}));
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
    const li = el('li', {'data-cable-item': c.id, ...(inB ? {class: 'rk-bundled'} : {})}, kids);
    li.hidden = !picked && !matches(c, on);
    return li;
  };
  // Each bundle's header, then its members in combing order; then the cables in no bundle.
  const groups = bundlesOf(rack);
  const inAny = new Set(groups.flatMap(b => b.members.map(m => m.cable)));
  const rows = [
    ...groups.flatMap(b => [bundleHeader({bundle: b, fact: bundles?.get(b.id) ?? null, selected: selectedBundle === b.id, onSelect: onBundleSelect}),
      ...b.members.map(m => cables.find(c => c.id === m.cable)).filter(Boolean).map(rowOf)]),
    ...cables.filter(c => !inAny.has(c.id)).map(rowOf)];

  return el('div', {id: 'cableList', class: 'rk-cables'}, [
    el('h3', {text: 'Cables'}),
    filterRow('purpose', 'Purpose'),
    filterRow('media', 'Media'),
    el('p', {class: 'rk-muted', 'data-filter-count': 'true', 'data-matching': String(shown),
             'data-total': String(cables.length), text: `${shown} of ${cables.length} ${cables.length === 1 ? 'cable matches' : 'cables match'}.`}),
    ...(spares.size ? [el('p', {class: 'rk-muted', 'data-spare-help': 'true', text: SPARE_HELP})] : []),
    ...notes.map(n => el('p', {class: 'rk-warn', 'data-route-warning': 'true', text: n})),
    el('ul', {}, rows),
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
