// The draw.io export page: pick a scope, get a library.
import { createDevicePicker } from '../vendor/devsel.js';
import { jdist } from '../vendor/dist.js';
import { entry, library, rackDiagram, loadFace, portsOf, RACK, SCALE } from './drawio.js';

const $ = id => document.getElementById(id);
const DIST = 'assets/dist/';
let DEVICES = [], DEV = null, COMPONENTS = [];

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

/**
 * The scopes on offer for the selected device, narrowest first.
 *
 * A library per vendor stops working the moment a vendor has hundreds of
 * devices - the ASR 9000 Series alone is the whole of Cisco here, and Juniper
 * will be worse. The model already carries the hierarchy in `portfolio`:
 * series inside family inside line. Series is usually what someone means by
 * "the switches I work on".
 *
 * family and line are scoped WITHIN the manufacturer, because "Service
 * Provider" is a line at both Cisco and Edgecore and a library mixing them is
 * nobody's mental model. Everything is the one deliberately cross-vendor
 * option. Six of the current devices carry no portfolio at all, so a scope is
 * only offered when the selected device actually has that field.
 */
function scopesFor(dev) {
  const p = dev.portfolio || {};
  const sameMan = d => d.manufacturer === dev.manufacturer;
  const out = [];
  const add = (key, label, pred) => {
    const n = DEVICES.filter(pred).length;
    if (n) out.push({key, label, pred, n});
  };
  for (const [field, key] of [['series', 'series'], ['family', 'family'], ['line', 'line']]) {
    if (p[field]) {
      add(key, p[field], d => sameMan(d) && (d.portfolio || {})[field] === p[field]);
    }
  }
  add('vendor', dev.manufacturer, sameMan);
  add('all', 'everything', () => true);
  // Two scopes that select the same devices are one choice wearing two hats -
  // an ASR 9000 Series library and a Cisco library are the same eight files
  // today, and offering both invites someone to wonder what the difference is.
  return out.filter((s, i) => i === 0 || s.n !== out[i - 1].n);
}

let SCOPES = [];

function fillScopes() {
  const dev = DEVICES.find(d => d.name === DEV);
  SCOPES = dev ? scopesFor(dev) : [];
  for (const id of ['scope', 'rscope']) {
    const sel = $(id);
    if (!sel) continue;
    const was = sel.value;
    sel.innerHTML = SCOPES
      .map(s => `<option value="${s.key}">${s.label} (${s.n})</option>`).join('');
    if (SCOPES.some(s => s.key === was)) sel.value = was;
  }
}

const scopeOf = key => SCOPES.find(s => s.key === key) || SCOPES[0];
const inScope = key => DEVICES.filter((scopeOf(key) || {pred: () => true}).pred);

const vendorTag = key => {
  const s = scopeOf(key);
  return (s ? s.label : 'portrayal').toLowerCase().replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'portrayal';
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

async function buildRackDiagram() {
  const btn = $('dl-rack'), stat = $('stat-diag');
  const units = Number($('units').value);
  const gap = $('gap').checked ? 1 : 0;
  const both = $('rfaces').value === 'both';
  const faces = both ? ['front', 'rear'] : [$('rfaces').value];
  btn.disabled = true;
  try {
    const scope = $('scope').value;
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
      const kind = p.family || p.series || null;
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

    // A unit of air between devices, so two chassis of the same colour do not
    // read as one tall one. It costs rack height, which is why it is a choice.
    // Anything that overflows starts another rack rather than being dropped -
    // a device missing from a diagram is worse than a diagram that is wide.
    const pages = [];
    let tooTall = [];
    for (const {label, items} of [...groups.values()]
           .sort((a, b) => a.label.localeCompare(b.label))) {
      const racks = [];
      let current = [], u = 1;
      const flush = () => {
        if (current.length) { racks.push({mounted: current}); current = []; u = 1; }
      };
      for (const m of items) {
        if (m.ru > units) { tooTall.push(m.name); continue; }
        if (u + m.ru - 1 > units) flush();
        current.push({...m, u});
        u += m.ru + gap;
      }
      flush();
      if (!racks.length) continue;
      // Only number racks when a group actually needed more than one.
      // The page already says whose these are; a cabinet only needs its number.
      racks.forEach((r, i) => {
        r.label = racks.length > 1 ? `Rack ${i + 1}` : '';
      });
      pages.push({label, racks});
    }
    if (!pages.length) { stat.textContent = `nothing fits in ${units}U`; return; }
    const racksAll = pages.flatMap(p => p.racks);
    const mounted = racksAll.flatMap(r => r.mounted);

    const xml = rackDiagram(pages, {units, faces});
    save(xml, `portrayal-${vendorTag(scope)}-rack-${units}u${both ? '-both' : ''}.drawio`,
         'application/xml');
    const rears = mounted.filter(m => m.faces.rear).length;
    stat.textContent =
      `${mounted.length} devices, ${racksAll.length} rack${racksAll.length === 1 ? '' : 's'} of ${units}U ` +
      `across ${pages.length} page${pages.length === 1 ? '' : 's'}` +
      (both ? `, ${rears} with a rear face` : '') +
      `, ${(xml.length / 1048576).toFixed(1)} MB` +
      (tooTall.length ? ` — ${tooTall.length} taller than the rack` : '') +
      (missing.length ? ` — ${missing.length} skipped` : '');
  } catch (err) {
    stat.textContent = `failed: ${err.message}`;
  } finally {
    btn.disabled = false;
  }
}

function describe() {
  const d = DEVICES.find(x => x.name === DEV);
  if (!d) return;
  const nmods = modulesFor($('scope')?.value).length;
  const lbl = $('mods-count');
  if (lbl) lbl.textContent = nmods ? ` (${nmods})` : '';
  if ($('mods')) $('mods').disabled = !nmods;
  $('detail').innerHTML =
    `<strong>${d.model || d.name}</strong> — ${d.manufacturer}. Standalone entries are ${Math.round(SCALE * 25.4)}px per inch ` +
    `(${SCALE}px/mm); rack entries are ${RACK.width}×${RACK.unit} per RU, which is ` +
    `draw.io's own mounting width once the U-number gutter is taken off.`;
}

(async () => {
  try {
    DEVICES = (await jdist(`${DIST}devices.json`)).devices;
    COMPONENTS = (await jdist(`${DIST}components.json`).catch(() => ({}))).components || [];
  } catch (err) {
    $('note').textContent = `could not load the device index: ${err.message}`;
    return;
  }
  const want = new URLSearchParams(location.search).get('device');
  DEV = DEVICES.some(d => d.name === want) ? want : DEVICES[0].name;
  createDevicePicker({mount: $('pick'), devices: DEVICES, value: DEV,
                      onchange: name => { DEV = name; fillScopes(); describe(); }});
  $('scope').addEventListener('change', describe);
  fillScopes();
  describe();
  $('dl-lib').onclick = () => buildLibrary({rack: false});
  $('dl-rack-lib').onclick = () => buildLibrary({rack: true});
  $('dl-rack').onclick = buildRackDiagram;
})();
