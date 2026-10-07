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
import {fits} from './fit.js';
import {placement} from './managers.js';
import {uLabel} from './model.js';
import {mountPick} from './export-data.js';

const wordsOf = q => q.toLowerCase().split(/\s+/).filter(Boolean);
const hay = e => `${e.manufacturer ?? ''} ${e.model ?? ''} ${e.family ?? ''} ${e.name}`.toLowerCase();
const ALL = 'all';

export function catalogPanel({entries, rack, face, ru, chassisOf, pick, onState, onPlace, onlyMount = null}) {
  // fit() only depends on the rack, this U and this face - all fixed for the
  // life of this panel - so it is computed once per entry, not on every
  // keystroke.
  const live = entries.filter(e => e.ru !== 0 && (!onlyMount || (e.mount ?? 'rack') === onlyMount));
  const fitOf = new Map(live.map(e => [e.name, fits(rack, {ref: e.name, ...(e.mount === 'rack-face'
    ? placement(rack, {face, ru}, chassisOf) : {ru, face})}, chassisOf)]));
  const byRef = new Map(live.map(e => [e.name, e]));

  let state = {query: '', vendor: ALL, fitsOnly: true, device: null, cfgByRef: {}, ...pick};
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
      const text = `${prefix} · ${e.ru}U · ${Math.round(e.d ?? 0)} mm${mp ? ` · ${mp.tag}` : ''}${f.ok ? '' : ' — doesn\'t fit'}`;
      return el('option', {value: e.name, text, 'data-fits': f.ok ? 'true' : 'false'});
    }));
    if (!list.some(e => e.name === state.device)) setState({device: list[0]?.name ?? null});
    device.value = state.device ?? '';
  }

  function renderCfgAndFit() {
    const entry = state.device ? byRef.get(state.device) : null;
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
    fitLine.textContent = f.ok ? (mountPick(entry.mount)?.fit ?? 'Fits here.') : f.reason;
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
    onPlace(entry, chosenCfg);
  }

  query.addEventListener('input', () => { setState({query: query.value}); redraw(); });
  query.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); doPlace(); } });
  fitsOnly.addEventListener('change', () => { setState({fitsOnly: fitsOnly.checked}); redraw(); });
  vendor.addEventListener('change', () => { setState({vendor: vendor.value}); redraw(); });
  device.addEventListener('change', () => { setState({device: device.value}); renderCfgAndFit(); });
  device.addEventListener('dblclick', doPlace);
  cfg.addEventListener('change', () => setState({cfgByRef: {...state.cfgByRef, [state.device]: cfg.value}}));
  place.addEventListener('click', doPlace);

  redraw();
  queueMicrotask(() => query.focus());

  return el('div', {class: 'rk-picker'}, [
    el('h3', {text: `U${uLabel(rack.frame, ru)} · ${face}, empty`}),
    el('label', {}, ['Search', query]),
    el('label', {class: 'rk-check'}, [fitsOnly, ' Only what fits here']),
    el('label', {}, ['Vendor', vendor]),
    el('label', {}, ['Device', device]),
    empty,
    el('label', {}, ['Configuration', cfg]),
    fitLine,
    el('div', {class: 'rk-actions'}, [place]),
  ]);
}
