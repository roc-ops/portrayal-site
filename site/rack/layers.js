// SHOW: WHICH LAYERS THE PANES DRAW (portrayal-site#197, part 1). A layer is a
// kind of thing the drawing holds that the reader can switch off:
//
//   data       every cable but a power cord, a DC feed or a ground wire;
//   power      power cords, DC feeds and ground wires;
//   bundles    a bundle's envelope and tag, and every strap of it, ties included;
//   managers   cable managers: horizontal, vertical and lacers;
//   pdus       power equipment: PDUs and power panels.
//
// A device is not a layer: a switch or a server is always drawn. Five presets
// are one click each (Elevation, Equipment only, Data cabling, Power,
// Everything) and name a set of layers; the layers can also be picked one by one.
//
// A VIEW SETTING. It is the reader's, remembered in this browser; it is never
// in the rack file and never in the URL. NO DOWNLOAD READS IT YET, and neither
// does the 3D scene: this part is the front, rear and side panes only.
//
// IN 2D it is an attribute on the panes (data-hide, the layers that are off)
// and a data-layer on what each layer holds, and rack.css does the rest.
// Nothing is redrawn when the choice changes. What is selected, or lit as a
// cable the reader picked, stays shown (rack.css).

export const LAYERS_KEY = 'portrayal.rack.layers';
// [id, the button's word, what it says in full (its title and its accessible name)]
export const LAYERS = [['data', 'Data', 'Data cables'],
                       ['power', 'Power', 'Power cords, DC feeds and ground wires'],
                       ['bundles', 'Bundles', 'Bundles and their straps'],
                       ['managers', 'Managers', 'Cable managers: horizontal, vertical and lacers'],
                       ['pdus', 'PDUs', 'Power equipment: PDUs and power panels']];
export const LAYER_IDS = LAYERS.map(l => l[0]);
// [id, the button's word, what it shows, the layers it turns on]
export const PRESETS = [['elevation', 'Elevation', 'Devices and cable managers, no cables', ['managers']],
                        ['equipment', 'Equipment only', 'Devices alone', []],
                        ['data', 'Data cabling', 'Everything but power', ['data', 'bundles', 'managers']],
                        ['power', 'Power', 'Devices, PDUs and power cords', ['power', 'pdus']],
                        ['everything', 'Everything', 'As the drawing always was', [...LAYER_IDS]]];
export const LAYERS_DEFAULT = [...LAYER_IDS];

const inOrder = on => LAYER_IDS.filter(id => on.includes(id));
/** The id of the preset that turns on exactly `on` (in any order), or null. */
export function presetOf(on) {
  const now = inOrder([...(on ?? [])]).join(' ');
  return PRESETS.find(p => p[3].join(' ') === now)?.[0] ?? null;
}

export function loadLayers(store = globalThis.localStorage) {
  try {
    const v = JSON.parse(store.getItem(LAYERS_KEY));
    return Array.isArray(v) && v.every(id => LAYER_IDS.includes(id)) ? inOrder(v) : [...LAYERS_DEFAULT];
  } catch { return [...LAYERS_DEFAULT]; }
}
export function saveLayers(on, store = globalThis.localStorage) { try { store.setItem(LAYERS_KEY, JSON.stringify(inOrder(on))); } catch { /* forgets */ } }

/** The layer a cable of this medium is in. */
export const layerOfMedia = media => (media === 'power' || media === 'ground' ? 'power' : 'data');
/** The layer a part of this kind is in, or null: devices are not a layer. */
export function layerOfKind(kind) {
  return kind === 'cable manager' ? 'managers' : kind === 'pdu' ? 'pdus' : null;
}

export const MENU_MARGIN = 8;
/** How far to move a panel sideways (px, + is right) to sit inside a window `width` wide with `margin` to spare:
 *  its right edge in first, then its left edge (a panel wider than the window keeps its left edge in view). */
export function shiftIntoWindow(left, right, width, margin = MENU_MARGIN) {
  let by = Math.min(0, width - margin - right);
  if (left + by < margin) by = margin - left;
  return by;
}

// ── the control ──────────────────────────────────────────────────────────
/** Two rows into `host`: the presets and the five layers; `onLayers(array)` on each pick. `get()` is what is on. */
export function mountLayers(host, onLayers) {
  let cur = loadLayers();
  const paint = () => {
    const now = presetOf(cur);
    for (const b of host.querySelectorAll('[data-layers-preset]')) {
      const on = b.dataset.layersPreset === now;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    }
    for (const b of host.querySelectorAll('[data-layers-set]')) {
      const on = cur.includes(b.dataset.layersSet);
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    }
  };
  const pick = next => { cur = inOrder(next); saveLayers(cur); paint(); onLayers([...cur]); };
  const row = (word, items, attr, click) => {
    const r = document.createElement('div');
    r.className = 'rk-layers-row';
    const label = document.createElement('span');
    label.className = 'rk-layers-label';
    label.textContent = word;
    r.append(label);
    for (const [id, text, title] of items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset[attr] = id;
      b.textContent = text;
      b.title = title;
      b.setAttribute('aria-label', title);
      b.addEventListener('click', () => click(id));
      r.append(b);
    }
    host.append(r);
  };
  row('Show', PRESETS.map(p => [p[0], p[1], `${p[1]}: ${p[2]}`]), 'layersPreset', id => pick(PRESETS.find(p => p[0] === id)[3]));
  row('Layers', LAYERS, 'layersSet', id => pick(cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id]));
  // The open panel stays inside the window: placed by the stylesheet, then moved by what is left over.
  const menu = host.closest('details');
  const place = () => {
    host.style.transform = '';
    if (!menu?.open) return;
    const r = host.getBoundingClientRect();
    const by = shiftIntoWindow(r.left, r.right, innerWidth);
    if (by) host.style.transform = `translateX(${by}px)`;
  };
  menu?.addEventListener('toggle', place);
  addEventListener('resize', place);
  paint();
  return {get: () => [...cur]};
}

// ── 2D ───────────────────────────────────────────────────────────────────
/** The panes follow the setting: the layers that are off, as one attribute; rack.css does the rest. */
export function paintLayers2d(panes, on) {
  if (!panes) return;
  const off = LAYER_IDS.filter(id => !on.includes(id));
  if (off.length) panes.dataset.hide = off.join(' '); else delete panes.dataset.hide;
}

const BUNDLE_PARTS = '[data-bundle-id], [data-bundle-tag], [data-bundles], [data-bundle-straps], [data-strap]';
/** Mark what each pane draws with its layer (data-layer). Run after every draw; a part is told by the rack's own
 *  item and its catalogue entry by id, never by the group's data-device-ref (a device's ears are a second group with
 *  the same id and none). */
export function tagLayers2d(svgs, rack, chassisOf) {
  const refOf = new Map([...(rack?.items ?? []), ...(rack?.zeroU ?? [])].map(e => [e.id, e.ref]));
  const mediaOf = new Map((rack?.cables ?? []).map(c => [c.id, c.media]));
  for (const svg of svgs ?? []) {
    if (!svg?.querySelectorAll) continue;
    for (const g of svg.querySelectorAll(':scope > [data-item-id], :scope > [data-zerou-id]')) {
      const layer = layerOfKind(chassisOf(refOf.get(g.dataset.itemId ?? g.dataset.zerouId))?.kind);
      if (layer) g.dataset.layer = layer; else delete g.dataset.layer;
    }
    for (const g of svg.querySelectorAll('[data-cable-id]')) g.dataset.layer = layerOfMedia(mediaOf.get(g.dataset.cableId));
    for (const g of svg.querySelectorAll('[data-spare-loop]'))
      g.dataset.layer = layerOfMedia(mediaOf.get((g.dataset.members ?? '').split(' ')[0]));
    for (const g of svg.querySelectorAll(BUNDLE_PARTS)) g.dataset.layer = 'bundles';
  }
}
