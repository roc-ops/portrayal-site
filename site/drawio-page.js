// The draw.io export page: pick a scope, get a library.
import { createDevicePicker } from '../vendor/devsel.js';
import { jdist } from '../vendor/dist.js';
import { entry, library, rackDiagram, loadFace, portsOf, RACK, SCALE } from './drawio.js';

const $ = id => document.getElementById(id);
const DIST = 'assets/dist/';
let DEVICES = [], DEV = null, COMPONENTS = [], SIZES = {};

// A component's namespace is its vendor's first word, lowercased - casa for
// Casa Systems, ufispace for UfiSpace. Checked against every namespace in the
// index; std/ and common/ are generic parts belonging to no vendor, which is
// the same reason the DCIM exporter refuses to give them a manufacturer.
const NORM = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const nsOf = man => NORM(String(man).split(/\s+/)[0]);

/** The default face for a device: the NOS-neutral front if there is one, else
 *  the first configuration's. The picture is the same either way; the
 *  configurations differ in what is seated, which a device type does not carry. */
const faceUrl = (d, face) => `${DIST}${d.name}.${face}.svg`;

/** The vendor's line cards, supervisors, supplies - the things that go IN the
 *  chassis. For a modular vendor these outnumber the chassis many times over:
 *  eight Cisco devices against 128 Cisco components. */
function modulesFor(key) {
  const devs = inScope(key);
  const wanted = new Set(devs.map(d => nsOf(d.manufacturer)));
  return COMPONENTS.filter(c => c.kind === 'module' && wanted.has(c.ns) && c.files?.default);
}

function save(text, name, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], {type}));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/** The composite the device picker groups by: `line · family`, or the series
 *  when a device has no line or family, or nothing at all. */
const groupLabel = d => {
  const p = d.portfolio || {};
  return [p.line, p.family].filter(Boolean).join(' · ') || p.series || '';
};

/**
 * The scopes on offer: the selected VENDOR's groups, then this device, then all
 * of the vendor.
 *
 * These are the same headings the device picker shows above the device list -
 * "Data Center · Ethernet Switch", "Service Provider · Aggregation Router" - so
 * the two menus name the same things. An earlier version listed taxonomy rungs
 * instead (series, then family, then line) which meant you could only ever
 * export the group the selected device happened to be in, and the words did not
 * match the menu directly above it.
 *
 * Every group the vendor has is listed, not only the current device's, because
 * choosing "the other family" should not require selecting a device in it
 * first.
 */
function scopesFor(dev) {
  const mine = DEVICES.filter(d => d.manufacturer === dev.manufacturer);
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
  // Devices with no portfolio at all would otherwise be reachable only through
  // the vendor, which is fine - but say so rather than leaving them invisible.
  const loose = mine.filter(d => !groupLabel(d));
  if (loose.length && seen.size) {
    const set = new Set(loose.map(d => d.name));
    out.push({key: 'g:ungrouped', label: 'ungrouped', n: loose.length,
              pred: d => set.has(d.name)});
  }
  // Shown as "selected device (AS7726-32X)" rather than just the model. The
  // bare name reads as a fixed entry for that one box; naming the ROLE says it
  // follows the device menu above, and the model in brackets says which one it
  // is following right now. `label` stays the model, because that is what the
  // filename wants.
  out.push({key: 'device', label: dev.model || dev.name, n: 1,
            display: `selected device (${dev.model || dev.name})`,
            pred: d => d.name === dev.name});
  out.push({key: 'vendor', label: `all of ${dev.manufacturer}`, n: mine.length,
            pred: d => d.manufacturer === dev.manufacturer});
  return out;
}

let SCOPES = [];

function fillScopes() {
  const dev = DEVICES.find(d => d.name === DEV);
  SCOPES = dev ? scopesFor(dev) : [];
  // Open on the group the selected device belongs to - the one the picker had
  // it filed under - rather than on whatever sorts first.
  const home = dev ? `g:${groupLabel(dev)}` : null;
  // Three menus, one per card: the two libraries and the rack diagram each
  // choose their own scope. Sharing one meant asking for a rack picture of the
  // thing you were looking at also changed what a library download contained.
  for (const id of ['scope', 'rscope', 'dscope']) {
    const sel = $(id);
    if (!sel) continue;
    const was = sel.value;
    sel.innerHTML = SCOPES
      .map(s => `<option value="${s.key}">${s.display || `${s.label} (${s.n})`}</option>`)
      .join('');
    sel.value = SCOPES.some(s => s.key === was) ? was
              : (SCOPES.some(s => s.key === home) ? home : SCOPES[0]?.key);
    // A family name is longer than the card is wide, so the closed select shows
    // it cut off. The full text on hover costs nothing and saves opening the
    // menu to find out what is already chosen.
    const showTitle = () => { sel.title = sel.selectedOptions[0]?.text || ''; };
    showTitle();
    sel.removeEventListener('change', showTitle);
    sel.addEventListener('change', showTitle);
  }
}

const allVendors = () => !!$('allven')?.checked;
const scopeOf = key => SCOPES.find(s => s.key === key) || SCOPES[0];
const inScope = key => allVendors()
  ? DEVICES
  : DEVICES.filter((scopeOf(key) || {pred: () => true}).pred);

const vendorTag = key => {
  if (allVendors()) return 'all-vendors';
  const s = scopeOf(key);
  // Strip the rung name off the front - a filename wants "ethernet-switch",
  // not "family-ethernet-switch".
  const label = s ? s.label.replace(/^all of /, '') : 'portrayal';
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    || 'portrayal';
};

/** Load every device in scope, skipping any whose face is missing rather than
 *  failing the whole download - a library with a hole in it beats no library. */
async function gather(scope, statusEl, {faces = ['front'], modules = false} = {}) {
  const want = inScope(scope);
  const out = [], missing = [];
  let n = 0, total = want.length * faces.length;
  for (const d of want) {
    const cfg = await jdist(`${DIST}${d.name}.configs.json`).catch(() => null);
    const ru = Math.max(1, Math.round(cfg?.chassis?.ru || 1));
    for (const face of faces) {
      statusEl.textContent = `reading ${++n}/${total}…`;
      try {
        const f = await loadFace(faceUrl(d, face));
        out.push({label: faces.length > 1 ? `${d.model || d.name} (${face})` : (d.model || d.name),
                  ru, face, kind: 'device', ...f,
                  ports: portsOf(f.zones, {bays: $('bays')?.checked})});
      } catch {
        // A device with no rear face is not an error - a shelf may only have
        // one side worth drawing. Only note it if the FRONT is missing too.
        if (face === 'front') missing.push(d.name);
      }
    }
  }
  if (modules) {
    const mods = modulesFor(scope);
    let k = 0;
    for (const c of mods) {
      statusEl.textContent = `reading card ${++k}/${mods.length}…`;
      try {
        const f = await loadFace(`${DIST}${c.files.default}`);
        out.push({label: (c.attrs || {}).model || c.name, ru: 1, face: 'front',
                  kind: 'module', cls: c.class, ...f,
                  ports: portsOf(f.zones, {bays: $('bays')?.checked})});
      } catch {
        missing.push(c.name);
      }
    }
  }
  return {loaded: out, missing};
}

function report(el, loaded, missing, extra = '') {
  const ports = loaded.reduce((a, f) => a + f.ports.length, 0);
  const dev = loaded.filter(f => f.kind === 'device').length;
  const mod = loaded.length - dev;
  const parts = [`${dev} face${dev === 1 ? '' : 's'}`];
  if (mod) parts.push(`${mod} card${mod === 1 ? '' : 's'}`);
  parts.push(`${ports} connectable`);
  el.textContent = parts.join(', ') + extra +
    (missing.length ? ` — ${missing.length} skipped (no compiled front)` : '');
}

async function buildLibrary({rack}) {
  const btn = rack ? $('dl-rack-lib') : $('dl-lib');
  const stat = rack ? $('stat-rack') : $('stat-lib');
  const scope = (rack ? $('rscope') : $('scope')).value;
  btn.disabled = true;
  try {
    const faces = rack ? ['front'] : ($('faces').value === 'both'
      ? ['front', 'rear'] : [$('faces').value]);
    const {loaded, missing} = await gather(scope, stat,
      {faces, modules: !rack && $('mods').checked});
    if (!loaded.length) { stat.textContent = 'nothing to export'; return; }
    const entries = loaded.map(f => entry(f.label, f.text, f.vb, f.ports,
      // A card is not rack-mountable on its own, so it keeps its drawn size
      // even in the rack library; only chassis get a unit height.
      rack && f.kind === 'device' ? {ru: f.ru} : {visible: $('tint').checked}));
    const xml = library(entries);
    save(xml, `portrayal-${vendorTag(scope)}${rack ? '-rack' : ''}.xml`, 'application/xml');
    report(stat, loaded, missing, `, ${(xml.length / 1048576).toFixed(1)} MB`);
  } catch (err) {
    stat.textContent = `failed: ${err.message}`;
  } finally {
    btn.disabled = false;
  }
}

// How tall a rack may get before the next device starts a new one. 42U is the
// common tall cabinet; a device taller than that needs a rack of its own, and
// gets the next real size up rather than a cabinet cut to its exact height,
// because nothing goes in a rack that is precisely as tall as it is.
const PACK_CAP = 42;
const OVERSIZE = [45, 48];

const rackHeightFor = used =>
  used <= PACK_CAP ? used : (OVERSIZE.find(n => n >= used) || used);

async function buildRackDiagram() {
  const btn = $('dl-rack'), stat = $('stat-diag');
  const gap = $('gap').checked ? 1 : 0;
  const both = $('rfaces').value === 'both';
  const faces = both ? ['front', 'rear'] : [$('rfaces').value];
  btn.disabled = true;
  try {
    const scope = $('dscope').value;
    // Both sides of every device, so one mounting serves both cabinets and a
    // device sits at the same U in each.
    const {loaded, missing} = await gather(scope, stat, {faces: ['front', 'rear']});
    const devs = loaded.filter(f => f.kind === 'device');
    if (!devs.length) { stat.textContent = 'nothing to mount'; return; }

    const byName = new Map();
    for (const f of devs) {
      const key = f.label.replace(/ \((front|rear)\)$/, '');
      if (!byName.has(key)) byName.set(key, {name: key, ru: f.ru, faces: {}});
      byName.get(key).faces[f.face] = {svg: f.text, vb: f.vb, ports: f.ports};
    }

    // Group before filling. A flat spill across racks is arbitrary - you get
    // whatever alphabetical order happened to give you - whereas a rack per
    // vendor per family is how anyone would actually lay this out, and reads as
    // a labelled list rather than a wall.
    const groupOf = m => {
      const d = DEVICES.find(x => (x.model || x.name) === m.name) || {};
      const p = d.portfolio || {};
      // The same composite the device picker groups by - `line · family` - so a
      // page tab is named the thing someone already picked the device out of.
      const kind = [p.line, p.family].filter(Boolean).join(' · ') || p.series || null;
      return {
        key: `${d.manufacturer || '?'}|${kind || ''}`,
        label: kind ? `${d.manufacturer} — ${kind}` : (d.manufacturer || 'Devices'),
      };
    };
    const groups = new Map();
    for (const m of byName.values()) {
      const g = groupOf(m);
      if (!groups.has(g.key)) groups.set(g.key, {label: g.label, items: []});
      groups.get(g.key).items.push(m);
    }

    // Each rack is grown to hold what is in it rather than being a fixed height
    // the contents rattle around in. Four 1RU boxes with a unit between them is
    // a 7U rack, not a 42U one that is 83% empty. A unit of air goes BETWEEN
    // devices and not after the last one, so the rack ends at the last device.
    const pages = [];
    for (const {label, items} of [...groups.values()]
           .sort((a, b) => a.label.localeCompare(b.label))) {
      const racks = [];
      let current = [], u = 1;
      const flush = () => {
        if (!current.length) return;
        const used = u - 1 - gap;           // drop the trailing gap
        racks.push({mounted: current, units: rackHeightFor(used)});
        current = []; u = 1;
      };
      for (const m of items) {
        if (current.length && u + m.ru - 1 > PACK_CAP) flush();
        current.push({...m, u});
        u += m.ru + gap;
      }
      flush();
      if (!racks.length) continue;
      racks.forEach((r, i) => { r.label = racks.length > 1 ? `Rack ${i + 1}` : ''; });
      pages.push({label, racks});
    }
    if (!pages.length) { stat.textContent = 'nothing to mount'; return; }
    const racksAll = pages.flatMap(p => p.racks);
    const mounted = racksAll.flatMap(r => r.mounted);

    const xml = rackDiagram(pages, {faces});
    save(xml, `portrayal-${vendorTag(scope)}-racks${both ? '-both' : ''}.drawio`,
         'application/xml');
    const rears = mounted.filter(m => m.faces.rear).length;
    const sizes = [...new Set(racksAll.map(r => r.units))].sort((a, b) => a - b);
    stat.textContent =
      `${mounted.length} device${mounted.length === 1 ? '' : 's'}, ` +
      `${racksAll.length} rack${racksAll.length === 1 ? '' : 's'} ` +
      `across ${pages.length} page${pages.length === 1 ? '' : 's'}` +
      `, ${sizes.length === 1 ? `${sizes[0]}U` : `${sizes[0]}–${sizes[sizes.length - 1]}U`}` +
      (both ? `, ${rears} with a rear face` : '') +
      `, ${(xml.length / 1048576).toFixed(1)} MB` +
      (missing.length ? ` — ${missing.length} skipped` : '');
  } catch (err) {
    stat.textContent = `failed: ${err.message}`;
  } finally {
    btn.disabled = false;
  }
}

// Plain words for the classes the model uses, so a count can say what it is.
const CLASS_WORD = {
  'line-card': 'line card', supervisor: 'supervisor', fabric: 'fabric card',
  psu: 'PSU', power: 'power module', cooling: 'fan', fan: 'fan',
  filter: 'air filter', blank: 'blank', mechanical: 'mechanical', inlet: 'inlet',
  switch: 'switch card',
};
const plural = (w, n) => n === 1 ? w : (w.endsWith('h') ? `${w}es` : `${w}s`);

/**
 * Roughly how big a library will be, before it is built.
 *
 * A face goes in as base64, which is 4/3 of the bytes, and the entries are JSON
 * inside XML on top of that. It is an estimate and says so - but the difference
 * between "2 MB" and "70 MB" is the one worth knowing in advance, and an
 * MX10016 front alone is 9.5 MB of SVG. Before Juniper the whole library was
 * 5 MB and nobody needed telling.
 */
function estimate(key, {faces, modules}) {
  let bytes = 0;
  for (const d of inScope(key)) {
    for (const f of faces) bytes += SIZES[`${d.name}.${f}.svg`] || 0;
  }
  if (modules) {
    for (const c of modulesFor(key)) bytes += SIZES[c.files.default.replace(/^.*?dist\//, '')]
      || SIZES[c.files.default] || 0;
  }
  return bytes * 4 / 3;
}

const human = b => b >= 1048576 ? `${(b / 1048576).toFixed(b > 10485760 ? 0 : 1)} MB`
                                : `${Math.max(1, Math.round(b / 1024))} KB`;

function showEstimate() {
  const el = $('estimate');
  if (!el || !Object.keys(SIZES).length) return;
  const faces = $('faces').value === 'both' ? ['front', 'rear'] : [$('faces').value];
  const b = estimate($('scope').value, {faces, modules: $('mods').checked});
  el.textContent = b ? `about ${human(b)}` : '';
  // Past roughly 20 MB draw.io starts to labour on import, and the browser has
  // to hold the whole thing in memory to build it.
  el.className = 'stat' + (b > 20 * 1048576 ? ' warn' : '');
}

function describe() {
  const d = DEVICES.find(x => x.name === DEV);
  if (!d) return;
  const all = $('allven');
  if (all) {
    $('allven-count').textContent = ` (${DEVICES.length})`;
    for (const id of ['scope', 'rscope', 'dscope']) if ($(id)) $(id).disabled = all.checked;
  }
  const mods = modulesFor($('scope')?.value);
  const lbl = $('mods-count');
  if (lbl) lbl.textContent = mods.length ? ` (${mods.length})` : '';
  if ($('mods')) $('mods').disabled = !mods.length;
  // Say WHAT they are. "line cards (8)" on an Edgecore switch was simply
  // false - its eight modules are a fan, five filters and two supplies, and
  // there is not a line card among them.
  // Keyed by the WORD, not the class: `cooling` and `fan` are both fans, and
  // counting them apart printed "7 fans, 2 fans" in one sentence.
  const byClass = {};
  for (const m of mods) {
    const w = CLASS_WORD[m.class] || m.class || 'module';
    byClass[w] = (byClass[w] || 0) + 1;
  }
  const breakdown = Object.entries(byClass)
    .sort((a, b) => b[1] - a[1])
    .map(([w, n]) => `${n} ${plural(w, n)}`)
    .join(', ');
  const ml = $('mods-label');
  if (ml) ml.title = breakdown ? `The things that go in the chassis: ${breakdown}.`
                               : 'This vendor has no modelled modules.';
  showEstimate();
  $('detail').innerHTML =
    `<strong>${d.model || d.name}</strong> — ${d.manufacturer}. Standalone entries are ${Math.round(SCALE * 25.4)}px per inch ` +
    `(${SCALE}px/mm); rack entries are ${RACK.width}×${RACK.unit} per RU, which is ` +
    `draw.io's own mounting width once the U-number gutter is taken off.`;
}

(async () => {
  try {
    DEVICES = (await jdist(`${DIST}devices.json`)).devices;
    COMPONENTS = (await jdist(`${DIST}components.json`).catch(() => ({}))).components || [];
    SIZES = await jdist(`${DIST}sizes.json`).catch(() => ({}));
  } catch (err) {
    $('note').textContent = `could not load the device index: ${err.message}`;
    return;
  }
  const want = new URLSearchParams(location.search).get('device');
  DEV = DEVICES.some(d => d.name === want) ? want : DEVICES[0].name;
  createDevicePicker({mount: $('pick'), devices: DEVICES, value: DEV,
                      onchange: name => { DEV = name; fillScopes(); describe(); }});
  for (const id of ['scope', 'rscope', 'dscope']) $(id).addEventListener('change', describe);
  for (const id of ['faces', 'mods']) $(id).addEventListener('change', showEstimate);
  $('allven').addEventListener('change', describe);
  fillScopes();
  describe();
  $('dl-lib').onclick = () => buildLibrary({rack: false});
  $('dl-rack-lib').onclick = () => buildLibrary({rack: true});
  $('dl-rack').onclick = buildRackDiagram;
})();
