// The draw.io export page: pick a scope, get a library.
import { createDevicePicker } from '../vendor/devsel.js';
import { jdist } from '../vendor/dist.js';
import { entry, library, rackDiagram, loadFace, portsOf, RACK, SCALE } from './drawio.js';

const $ = id => document.getElementById(id);
const DIST = 'assets/dist/';
let DEVICES = [], DEV = null;

/** The default face for a device: the NOS-neutral front if there is one, else
 *  the first configuration's. The picture is the same either way; the
 *  configurations differ in what is seated, which a device type does not carry. */
const faceUrl = d => `${DIST}${d.name}.front.svg`;

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
async function gather(scope, statusEl) {
  const want = inScope(scope);
  const out = [], missing = [];
  let n = 0;
  for (const d of want) {
    statusEl.textContent = `reading ${++n}/${want.length}…`;
    try {
      // devices.json does not carry the chassis height - it lives in the
      // per-device config index, which is also what the 3D rack reads. A
      // device whose RU we cannot find is mounted as 1RU rather than dropped.
      const [face, cfg] = await Promise.all([
        loadFace(faceUrl(d)),
        jdist(`${DIST}${d.name}.configs.json`).catch(() => null),
      ]);
      out.push({dev: d, ru: Math.max(1, Math.round(cfg?.chassis?.ru || 1)),
                ...face, ports: portsOf(face.zones, {bays: $('bays')?.checked})});
    } catch {
      missing.push(d.name);
    }
  }
  return {loaded: out, missing};
}

function report(el, loaded, missing, extra = '') {
  const ports = loaded.reduce((a, f) => a + f.ports.length, 0);
  const n = loaded.length;
  el.textContent = `${n} device${n === 1 ? '' : 's'}, ${ports} connectable${extra}` +
    (missing.length ? ` — ${missing.length} skipped (no compiled front)` : '');
}

async function buildLibrary({rack}) {
  const btn = rack ? $('dl-rack-lib') : $('dl-lib');
  const stat = rack ? $('stat-rack') : $('stat-lib');
  const scope = (rack ? $('rscope') : $('scope')).value;
  btn.disabled = true;
  try {
    const {loaded, missing} = await gather(scope, stat);
    if (!loaded.length) { stat.textContent = 'nothing to export'; return; }
    const entries = loaded.map(f => entry(f.dev.model || f.dev.name, f.text, f.vb, f.ports,
      rack ? {ru: f.ru}
           : {visible: $('tint').checked}));
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
  btn.disabled = true;
  try {
    const {loaded, missing} = await gather($('scope').value, stat);
    if (!loaded.length) { stat.textContent = 'nothing to mount'; return; }
    // Stack from U1 up, skipping anything that will not fit in the cabinet.
    let u = 1;
    const mounted = [];
    for (const f of loaded) {
      const ru = f.ru;
      if (u + ru - 1 > units) break;
      mounted.push({name: f.dev.model || f.dev.name, svg: f.text, vb: f.vb,
                    ports: f.ports, u, ru});
      u += ru;
    }
    const label = (scopeOf($('scope').value) || {}).label || 'Portrayal';
    const xml = rackDiagram(mounted, {units, name: `${label} rack`});
    save(xml, `portrayal-${vendorTag($('scope').value)}-rack-${units}u.drawio`,
         'application/xml');
    const short = loaded.length - mounted.length;
    report(stat, mounted.map(m => ({ports: m.ports})), missing,
      `, ${u - 1} of ${units}U used` + (short ? ` — ${short} did not fit` : ''));
  } catch (err) {
    stat.textContent = `failed: ${err.message}`;
  } finally {
    btn.disabled = false;
  }
}

function describe() {
  const d = DEVICES.find(x => x.name === DEV);
  if (!d) return;
  $('detail').innerHTML =
    `<strong>${d.model || d.name}</strong> — ${d.manufacturer}. Standalone entries are ${Math.round(SCALE * 25.4)}px per inch ` +
    `(${SCALE}px/mm); rack entries are ${RACK.width}×${RACK.unit} per RU, which is ` +
    `draw.io's own mounting width once the U-number gutter is taken off.`;
}

(async () => {
  try {
    DEVICES = (await jdist(`${DIST}devices.json`)).devices;
  } catch (err) {
    $('note').textContent = `could not load the device index: ${err.message}`;
    return;
  }
  const want = new URLSearchParams(location.search).get('device');
  DEV = DEVICES.some(d => d.name === want) ? want : DEVICES[0].name;
  createDevicePicker({mount: $('pick'), devices: DEVICES, value: DEV,
                      onchange: name => { DEV = name; fillScopes(); describe(); }});
  fillScopes();
  describe();
  $('dl-lib').onclick = () => buildLibrary({rack: false});
  $('dl-rack-lib').onclick = () => buildLibrary({rack: true});
  $('dl-rack').onclick = buildRackDiagram;
})();
