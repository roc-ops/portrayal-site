// Numbers the page states about the library, filled in from the snapshot.
//
// These used to be typed into the HTML, and had already drifted: the page
// claimed eleven devices when the library held twenty-one. `refresh-assets.sh`
// counts them when it vendors the drawings, so they move when the assets do and
// nobody has to remember to come back and edit a paragraph.
const FALLBACK_HIDE = 'the figures beside it';

fetch('assets/dist/stats.json')
  .then(r => r.ok ? r.json() : Promise.reject(new Error(String(r.status))))
  .then(s => {
    const lineCards = (s.byClass || []).find(([cls]) => cls === 'line-card');
    const values = {
      schema: s.schema,
      devices: s.devices,
      vendors: s.vendors,
      components: s.components,
      lineCards: lineCards ? lineCards[1] : null,
      configurations: s.configurations,
      generated: s.generated,
    };
    for (const [key, value] of Object.entries(values)) {
      if (value === null || value === undefined) continue;
      for (const el of document.querySelectorAll(`[data-stat="${key}"]`)) {
        el.textContent = value;
      }
    }
    if (s.vendorNames?.length) {
      for (const el of document.querySelectorAll('[data-stat="vendors"]')) {
        el.title = s.vendorNames.join(', ');
      }
    }
  })
  .catch(err => {
    // An em dash where a number should be reads as broken. If the snapshot has
    // no stats file, say so once rather than leaving placeholders on the page.
    console.warn('[portrayal] stats unavailable', err);
    for (const el of document.querySelectorAll('[data-stat]')) {
      if (el.textContent.trim() === '—') el.textContent = 'not counted';
    }
  });
