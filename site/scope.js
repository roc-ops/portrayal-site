// Which devices a download covers, in the words the device picker already uses.
//
// Shared because there are two exporters now and there will be more. The
// alternative - a copy per page - drifts, and this took several passes to get
// right: it is the vendor's own GROUPS, all of them, not a taxonomy ladder, and
// not only the group the selected device happens to be in.

/** The composite the device picker groups by: `line · family`, or the series
 *  when a device has neither, or nothing at all. */
export const groupLabel = d => {
  const p = d.portfolio || {};
  return [p.line, p.family].filter(Boolean).join(' · ') || p.series || '';
};

/**
 * Scopes for one selected device: the vendor's groups, then this device, then
 * all of the vendor.
 *
 * Every group the VENDOR has is offered, not only the current device's -
 * choosing "the other family" should not require selecting a device in it
 * first. The scope is the thing being chosen; the device is just where the page
 * happened to open.
 */
export function scopesFor(dev, devices) {
  const mine = devices.filter(d => d.manufacturer === dev.manufacturer);
  const out = [];
  const seen = new Map();
  for (const d of mine) {
    const g = groupLabel(d);
    if (!g) continue;
    if (!seen.has(g)) seen.set(g, []);
    seen.get(g).push(d.name);
  }
  for (const [label, names] of [...seen.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const set = new Set(names);
    out.push({key: `g:${label}`, label, n: names.length, pred: d => set.has(d.name)});
  }
  const loose = mine.filter(d => !groupLabel(d));
  if (loose.length && seen.size) {
    const set = new Set(loose.map(d => d.name));
    out.push({key: 'g:ungrouped', label: 'ungrouped', n: loose.length,
              pred: d => set.has(d.name)});
  }
  // Named for the ROLE, with the model in brackets: listed as a bare model it
  // reads as a fixed entry for that one box rather than a slot following the
  // device menu above.
  out.push({key: 'device', label: dev.model || dev.name, n: 1,
            display: `selected device (${dev.model || dev.name})`,
            pred: d => d.name === dev.name});
  out.push({key: 'vendor', label: `all of ${dev.manufacturer}`, n: mine.length,
            pred: d => d.manufacturer === dev.manufacturer});
  return out;
}

/**
 * Keep one or more <select>s filled for the current device.
 *
 * Returns { refresh, devicesFor, labelFor, tagFor } - `refresh` after the
 * device changes, the rest to read a chosen scope back.
 */
export function bindScopes({selects, devices, currentDevice, allVendors}) {
  let scopes = [];
  const els = () => selects.map(id => document.getElementById(id)).filter(Boolean);

  function refresh() {
    const dev = currentDevice();
    scopes = dev ? scopesFor(dev, devices()) : [];
    const home = dev ? `g:${groupLabel(dev)}` : null;
    for (const sel of els()) {
      const was = sel.value;
      sel.innerHTML = scopes
        .map(s => `<option value="${s.key}">${s.display || `${s.label} (${s.n})`}</option>`)
        .join('');
      sel.value = scopes.some(s => s.key === was) ? was
                : (scopes.some(s => s.key === home) ? home : scopes[0]?.key);
      // A family name is longer than a card is wide, so the closed select shows
      // it cut off; the full text on hover saves opening the menu to find out
      // what is already chosen.
      const title = () => { sel.title = sel.selectedOptions[0]?.text || ''; };
      title();
      sel.removeEventListener('change', title);
      sel.addEventListener('change', title);
    }
  }

  const find = key => scopes.find(s => s.key === key) || scopes[0];
  return {
    refresh,
    scopes: () => scopes,
    devicesFor: key => allVendors?.() ? devices()
      : devices().filter((find(key) || {pred: () => true}).pred),
    labelFor: key => allVendors?.() ? 'all vendors' : (find(key)?.label || ''),
    tagFor: key => {
      if (allVendors?.()) return 'all-vendors';
      const s = find(key);
      const label = s ? s.label.replace(/^all of /, '') : 'portrayal';
      return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
        || 'portrayal';
    },
  };
}
