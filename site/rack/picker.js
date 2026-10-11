// AN EMPTY U, AND WHAT COULD GO THERE (rack feedback round 1). Narrowed step
// by step - vendor, then device, then configuration - instead of one long
// button list: search and "only what fits" stay, and fit is shown right in
// the device list, same as the old catalog did it row by row.
//
// The panel owns its own redraws: typing, ticking the checkbox, and changing
// the vendor/device/configuration selects all update just the pieces that
// changed (the device list's options, the vendor counts, the configuration
// list, the fit line) rather than being rebuilt from S.pick by the page -
// rebuilding the whole panel on every keystroke would recreate #catQuery and
// drop focus mid-word.

import {el} from './dom.js';
import {fits} from '../../vendor/rack/fit.js';
import {placement, hostAt} from '../../vendor/rack/managers.js';
import {uLabel} from '../../vendor/rack/model.js';
import {mountPick} from '../../vendor/rack/export-data.js';
import {attachPoints, isZeroUPart, isNarrow, fitsZeroU, unitsOf, spanText} from '../../vendor/rack/fit.js';

const wordsOf = q => q.toLowerCase().split(/\s+/).filter(Boolean);
const hay = e => `${e.manufacturer ?? ''} ${e.model ?? ''} ${e.family ?? ''} ${e.name}`.toLowerCase();
const ALL = 'all';

export function catalogPanel({entries, rack, face, ru, half: onHalf = null, chassisOf, pick, onState, onPlace, onlyMount = null}) {
  // fit() only depends on the rack, this U and this face - all fixed for the
  // life of this panel - so it is computed once per entry, not on every
  // keystroke.
  const live = entries.filter(e => e.ru !== 0 && (!onlyMount || (e.mount ?? 'rack') === onlyMount));
  // A ZERO-U PART (the kit's fit.js fitsZeroU) stands beside an upright, its bottom level with
  // this U, and takes none; a NARROW RAIL PART goes on one rail. Each is judged
  // where it would go - the upright, the rail - as chosen below (state.at, state.side).
  const points = attachPoints(rack.frame.kind);
  const fitCache = new Map();
  // A DEVICE THAT MAY START ON A HALF UNIT (rack file version 4): one whose
  // height is not a whole number of units (the kit's unitsOf: a half-unit
  // panel, a 1.5U or 3.5U device). In a whole unit it is offered both of that
  // unit's halves, the lower one first (state.half), as a zero-U part is
  // offered each upright; in a half that was picked as one (`half`: the free
  // half beside another panel, which the pane offers as a target of its own)
  // it goes on that half. Every other device is judged at the position
  // picked, and the kit refuses a whole-unit one on a half, or in a unit
  // whose other half is taken, in its own sentence.
  const mayHalf = e => !isZeroUPart(e) && e.mount !== 'rack-face' && !Number.isInteger(unitsOf(e));
  const HALVES = ['lower', 'upper'];
  const whole = onHalf == null && Number.isInteger(ru);
  const ruAt = (e, half) => (mayHalf(e) && whole && half === 'upper' ? ru + 0.5 : ru);
  // `choice` is the upright, the rail or the half; null means the one chosen now.
  const fitFor = (e, choice = null) => {
    const at = choice ?? state.at, side = choice ?? state.side, half = choice ?? state.half;
    const key = isZeroUPart(e) ? `${e.name}|${at}` : isNarrow(e) ? `${e.name}|${side}` : mayHalf(e) ? `${e.name}|${half}` : e.name;
    if (!fitCache.has(key)) fitCache.set(key, isZeroUPart(e) ? fitsZeroU(rack, {ref: e.name, at, ru}, chassisOf)
      : isNarrow(e) ? fits(rack, {ref: e.name, face, ru, side}, chassisOf)
      : fits(rack, {ref: e.name, ...(e.mount === 'rack-face' ? placement(rack, {face, ru}, chassisOf) : {ru: ruAt(e, half), face})}, chassisOf));
    return fitCache.get(key);
  };
  // In the list, a part with a choice fits when ANY choice does (the line below
  // the list says whether the chosen one does): a bracket whose left rail is
  // taken here still goes on the right one.
  const choices = e => (isZeroUPart(e) ? points : isNarrow(e) ? ['left', 'right'] : mayHalf(e) && whole ? HALVES : [null]);
  const fitOf = {get: name => { const e = byRefOf(name), all = choices(e).map(c => fitFor(e, c));
    return all.find(f => f.ok) ?? fitFor(e); }};
  // A U a rack device spans on this face is not empty: a rack-face part would attach to it.
  const host = hostAt(rack, face, Math.floor(ru), chassisOf);
  const byRef = new Map(live.map(e => [e.name, e]));
  const byRefOf = name => byRef.get(name);

  let state = {query: '', vendor: ALL, fitsOnly: true, device: null, cfgByRef: {}, ...pick};
  if (!points.includes(state.at)) state.at = points.includes(`left-${face}`) ? `left-${face}` : points[0];
  if (state.side !== 'right') state.side = 'left';
  // the half chosen is this unit's: another unit starts on its lower half again
  if (state.half !== 'upper' || state.halfAt !== ru) state.half = 'lower';
  const setState = patch => { state = {...state, ...patch}; onState(patch); };

  const afterQuery = () => { const ws = wordsOf(state.query); return live.filter(e => ws.every(w => hay(e).includes(w))); };
  const afterFit = list => state.fitsOnly ? list.filter(e => fitOf.get(e.name).ok) : list;
  const afterVendor = list => state.vendor === ALL ? list : list.filter(e => (e.manufacturer ?? '') === state.vendor);

  const query = el('input', {id: 'catQuery', type: 'search', placeholder: 'R740xd, 400G, patch panel',
                             value: state.query, 'aria-label': 'Search devices'});
  const fitsOnly = el('input', {id: 'catFitsOnly', type: 'checkbox', ...(state.fitsOnly ? {checked: ''} : {})});
  const vendor = el('select', {id: 'catVendor', 'aria-label': 'Vendor'});
  const device = el('select', {id: 'catDevice', size: '10', 'aria-label': 'Device'});
  const cfg = el('select', {id: 'catCfg', 'aria-label': 'Configuration'});
  const fitLine = el('p', {id: 'catFit'});
  const empty = el('p', {class: 'rk-muted'});
  const place = el('button', {type: 'button', id: 'catPlace', text: 'Place'});
  const at = el('select', {id: 'catAt', 'aria-label': 'Upright'},
    points.map(p => el('option', {value: p, text: p, ...(p === state.at ? {selected: ''} : {})})));
  const between = el('input', {id: 'catBetween', type: 'checkbox', ...(state.between ? {checked: ''} : {})});
  const side = el('select', {id: 'catSide', 'aria-label': 'Rail'},
    ['left', 'right'].map(p => el('option', {value: p, text: `${p} rail`, ...(p === state.side ? {selected: ''} : {})})));
  const atRow = el('label', {}, ['Beside the upright', at]);
  const betweenRow = el('label', {class: 'rk-check'}, [between, ' Between racks (serves the next rack too)']);
  const sideRow = el('label', {}, ['Rail', side]);
  const half = el('select', {id: 'catHalf', 'aria-label': 'Half of the unit'},
    HALVES.map(p => el('option', {value: p, text: `${p} half of U${uLabel(rack.frame, Math.floor(ru))}`, ...(p === state.half ? {selected: ''} : {})})));
  const halfRow = el('label', {}, ['Starts on the', half]);

  function renderVendorOptions(fitted) {
    const counts = new Map();
    for (const e of fitted) counts.set(e.manufacturer ?? '', (counts.get(e.manufacturer ?? '') ?? 0) + 1);
    const names = [...counts.keys()].sort((a, b) => a.localeCompare(b));
    vendor.replaceChildren(
      el('option', {value: ALL, text: `All vendors (${fitted.length})`}),
      ...names.map(m => el('option', {value: m, text: `${m || '(unknown)'} (${counts.get(m)})`})));
    if (state.vendor !== ALL && !counts.has(state.vendor)) setState({vendor: ALL});
    vendor.value = state.vendor;
  }

  function renderDeviceOptions(list) {
    device.replaceChildren(...list.map(e => {
      const f = fitOf.get(e.name);
      const prefix = state.vendor === ALL ? `${e.manufacturer ?? ''} ${e.model}`.trim() : e.model;
      const mp = mountPick(e.mount);
      const tag = isZeroUPart(e) ? 'zero-U, stands beside the rack' : mp?.tag;
      const text = `${prefix} · ${e.mount === 'rack-face' || isZeroUPart(e) ? 0 : e.ru}U · ${Math.round(e.d ?? 0)} mm${tag ? ` · ${tag}` : ''}${f.ok ? '' : ' — doesn\'t fit'}`;
      return el('option', {value: e.name, text, 'data-fits': f.ok ? 'true' : 'false'});
    }));
    if (!list.some(e => e.name === state.device)) setState({device: list[0]?.name ?? null});
    device.value = state.device ?? '';
  }

  function renderCfgAndFit() {
    const entry = state.device ? byRef.get(state.device) : null;
    // `hidden` alone loses to the panel's own label display rule: the style says it too.
    const show = (n, on) => { n.hidden = !on; n.style.display = on ? '' : 'none'; };
    show(atRow, !!entry && isZeroUPart(entry)); show(betweenRow, !!entry && isZeroUPart(entry));
    show(sideRow, !!entry && isNarrow(entry));
    show(halfRow, !!entry && mayHalf(entry) && whole);
    if (!entry) {
      cfg.replaceChildren();
      cfg.disabled = true;
      fitLine.textContent = '';
      fitLine.className = 'rk-muted';
      return;
    }
    cfg.disabled = false;
    const configs = entry.configs?.length ? entry.configs : [entry.default ?? ''];
    const chosen = state.cfgByRef[entry.name] ?? entry.default ?? configs[0];
    cfg.replaceChildren(...configs.map(c => el('option', {value: c, text: c, ...(c === chosen ? {selected: ''} : {})})));
    // the half chosen last time may be taken here: start on the one that fits
    if (mayHalf(entry) && whole && !fitFor(entry).ok) {
      const other = HALVES.find(h => fitFor(entry, h).ok);
      if (other) { setState({half: other, halfAt: ru}); half.value = other; }
    }
    const f = fitFor(entry);
    fitLine.textContent = !f.ok ? f.reason
      : isZeroUPart(entry) ? `Fits here: it stands beside the rack at ${state.at}, its bottom level with U${uLabel(rack.frame, ru)}, and takes no U.`
      : isNarrow(entry) ? `Fits here: it mounts on the ${state.side} rail's face and takes no U of its own.`
      : entry.mount === 'rack-face' && host ? `Fits here: it mounts on the rail face over ${host.label}, and takes no U of its own.`
      : mayHalf(entry) ? `Fits here: ${spanText(rack.frame, {ru: ruAt(entry, state.half), ref: entry.name}, chassisOf)}.`
      : (mountPick(entry.mount)?.fit ?? 'Fits here.');
    fitLine.className = f.ok ? 'rk-muted' : 'rk-error';
  }

  function renderEmpty(list, queriedVendored) {
    empty.replaceChildren();
    if (list.length !== 0) return;
    empty.append('No devices match.');
    if (state.fitsOnly && queriedVendored.length > 0)
      empty.append(el('br'), document.createTextNode('Untick Only what fits here to see the rest.'));
  }

  function redraw() {
    const queried = afterQuery();
    const fitted = afterFit(queried);
    renderVendorOptions(fitted);
    // Vendor may have just reset to "all" (its previous choice had zero
    // matches), so the device list is filtered after that settles.
    const list = afterVendor(fitted);
    renderDeviceOptions(list);
    renderEmpty(list, afterVendor(queried));
    renderCfgAndFit();
  }

  function doPlace() {
    const entry = state.device ? byRef.get(state.device) : null;
    if (!entry) return;
    const f = fitFor(entry);
    if (!f.ok) { fitLine.textContent = f.reason; fitLine.className = 'rk-error'; return; }
    const chosenCfg = cfg.value || entry.default || entry.configs?.[0] || '';
    setState({cfgByRef: {...state.cfgByRef, [entry.name]: chosenCfg}});
    onPlace(entry, chosenCfg, isZeroUPart(entry) ? {at: state.at, between: !!state.between}
      : isNarrow(entry) ? {side: state.side} : mayHalf(entry) ? {ru: ruAt(entry, state.half)} : {});
  }

  query.addEventListener('input', () => { setState({query: query.value}); redraw(); });
  query.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); doPlace(); } });
  fitsOnly.addEventListener('change', () => { setState({fitsOnly: fitsOnly.checked}); redraw(); });
  vendor.addEventListener('change', () => { setState({vendor: vendor.value}); redraw(); });
  device.addEventListener('change', () => { setState({device: device.value}); renderCfgAndFit(); });
  device.addEventListener('dblclick', doPlace);
  cfg.addEventListener('change', () => setState({cfgByRef: {...state.cfgByRef, [state.device]: cfg.value}}));
  place.addEventListener('click', doPlace);
  // The upright and the rail change what fits: the lists follow.
  at.addEventListener('change', () => { setState({at: at.value}); redraw(); });
  between.addEventListener('change', () => setState({between: between.checked}));
  side.addEventListener('change', () => { setState({side: side.value}); redraw(); });
  half.addEventListener('change', () => { setState({half: half.value, halfAt: ru}); redraw(); });

  redraw();
  queueMicrotask(() => query.focus());

  return el('div', {class: 'rk-picker'}, [
    // a half picked as one is named as the kit names a span: "the upper half of U12"
    el('h3', {text: `${whole ? `U${uLabel(rack.frame, ru)}` : (t => t[0].toUpperCase() + t.slice(1))(spanText(rack.frame, {ru, ref: ''}, () => ({ru: 0.5})))} · ${face}, ${host ? `${whole ? 'on' : 'beside'} ${host.label}` : 'empty'}`}),
    el('label', {}, ['Search', query]),
    el('label', {class: 'rk-check'}, [fitsOnly, ' Only what fits here']),
    el('label', {}, ['Vendor', vendor]),
    el('label', {}, ['Device', device]),
    empty,
    el('label', {}, ['Configuration', cfg]),
    atRow, betweenRow, sideRow, halfRow,
    fitLine,
    el('div', {class: 'rk-actions'}, [place]),
  ]);
}
