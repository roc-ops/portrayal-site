// The catalog's sizes (chassis-index.py -> site/rack/chassis.json), loaded
// once. A failed load is not remembered: the next ask tries again, so one
// network hiccup does not leave the page with an empty catalog for good.

let INDEX = null;
export function loadChassis(url = 'site/rack/chassis.json') {
  if (!INDEX) {
    INDEX = fetch(url)
      .then(r => { if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return r.json(); })
      .then(j => j.devices || {})
      .catch(err => { INDEX = null; throw err; });
  }
  return INDEX;
}

export const chassisLookup = devices => ref => devices[ref] || null;

const cmp = (a, b) => String(a ?? '').localeCompare(String(b ?? ''));
export const catalogEntries = devices => Object.entries(devices)
  .map(([name, e]) => ({name, ...e}))
  .sort((a, b) => cmp(a.manufacturer, b.manufacturer) || cmp(a.model, b.model));
