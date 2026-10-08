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
import {attachPoints} from '../../vendor/rack/fit.js';
import {isRackSide, isNarrowFace, fitsZeroUSide, fitsSided} from './zero-u.js';

const wordsOf = q => q.toLowerCase().split(/\s+/).filter(Boolean);
const hay = e => `${e.manufacturer ?? ''} ${e.model ?? ''} ${e.family ?? ''} ${e.name}`.toLowerCase();
const ALL = 'all';

export function catalogPanel({entries, rack, face, ru, chassisOf, pick, onState, onPlace, onlyMount = null}) {
  // fit() only depends on the rack, this U and this face - all fixed for the
  // life of this panel - so it is computed once per entry, not on every
  // keystroke.
  const live = entries.filter(e => e.ru !== 0 && (!onlyMount || (e.mount ?? 'rack') === onlyMount));
  // A RACK-SIDE PART (zero-u.js) stands beside an upright, its bottom level with
  // this U, and takes none; a NARROW RAIL PART goes on one rail. Each is judged
  // where it would go - the upright, the rail - as chosen below (state.at, state.side).
  const points = attachPoints(rack.frame.kind);
  const fitCache = new Map();
  const fitFor = e => {
    const key = isRackSide(e) ? `${e.name}|${state.at}` : isNarrowFace(e) ? `${e.name}|${state.side}` : e.name;
    if (!fitCache.has(key)) fitCache.set(key, isRackSide(e) ? fitsZeroUSide(rack, {ref: e.name, at: state.at, ru}, chassisOf)
      : isNarrowFace(e) ? fitsSided(rack, {ref: e.name, face, ru, side: state.side}, chassisOf)
      : fits(rack, {ref: e.name, ...(e.mount === 'rack-face' ? placement(rack, {face, ru}, chassisOf) : {ru, face})}, chassisOf));
    return fitCache.get(key);
  };
  const fitOf = {get: name => fitFor(byRefOf(name))};
  // A U a rack device spans on this face is not empty: a rack-face part would attach to it.
  const host = hostAt(rack, face, ru, chassisOf);
  const byRef = new Map(live.map(e => [e.name, e]));
  const byRefOf = name => byRef.get(name);

  let state = {query: '', vendor: ALL, fitsOnly: true, device: null, cfgByRef: {}, ...pick};
  if (!points.includes(state.at)) state.at = points.includes(`left-${face}`) ? `left-${face}` : points[0];
  if (state.side !== 'right') state.side = 'left';
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
      const tag = isRackSide(e) ? 'zero-U, stands beside the rack' : mp?.tag;
      const text = `${prefix} · ${e.mount === 'rack-face' || isRackSide(e) ? 0 : e.ru}U · ${Math.round(e.d ?? 0)} mm${tag ? ` · ${tag}` : ''}${f.ok ? '' : ' — doesn\'t fit'}`;
      return el('option', {value: e.name, text, 'data-fits': f.ok ? 'true' : 'false'});
    }));
    if (!list.some(e => e.name === state.device)) setState({device: list[0]?.name ?? null});
    device.value = state.device ?? '';
  }

  function renderCfgAndFit() {
    const entry = state.device ? byRef.get(state.device) : null;
    atRow.hidden = betweenRow.hidden = !(entry && isRackSide(entry));
    sideRow.hidden = !(entry && isNarrowFace(entry));
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
    const f = fitOf.get(entry.name);
    fitLine.textContent = !f.ok ? f.reason
      : isRackSide(entry) ? `Fits here: it stands beside the rack at ${state.at}, its bottom level with U${uLabel(rack.frame, ru)}, and takes no U.`
      : isNarrowFace(entry) ? `Fits here: it mounts on the ${state.side} rail's face and takes no U of its own.`
      : entry.mount === 'rack-face' && host ? `Fits here: it mounts on the rail face over ${host.label}, and takes no U of its own.`
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
    const f = fitOf.get(entry.name);
    if (!f.ok) { fitLine.textContent = f.reason; fitLine.className = 'rk-error'; return; }
    const chosenCfg = cfg.value || entry.default || entry.configs?.[0] || '';
    setState({cfgByRef: {...state.cfgByRef, [entry.name]: chosenCfg}});
    onPlace(entry, chosenCfg, isRackSide(entry) ? {at: state.at, between: !!state.between}
      : isNarrowFace(entry) ? {side: state.side} : {});
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

  redraw();
  queueMicrotask(() => query.focus());

  return el('div', {class: 'rk-picker'}, [
    el('h3', {text: `U${uLabel(rack.frame, ru)} · ${face}, ${host ? `on ${host.label}` : 'empty'}`}),
    el('label', {}, ['Search', query]),
    el('label', {class: 'rk-check'}, [fitsOnly, ' Only what fits here']),
    el('label', {}, ['Vendor', vendor]),
    el('label', {}, ['Device', device]),
    empty,
    el('label', {}, ['Configuration', cfg]),
    atRow, betweenRow, sideRow,
    fitLine,
    el('div', {class: 'rk-actions'}, [place]),
  ]);
}
