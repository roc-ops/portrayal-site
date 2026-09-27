// The compiled drawings, zipped: pick a scope, get the SVGs.
import {faceFile} from './faces.js';
import { createDevicePicker } from '../vendor/devsel.js';
import { jdist } from '../vendor/dist.js';
import { makeZip } from './bundle.js';
import { bindScopes } from './scope.js';

const $ = id => document.getElementById(id);
const DIST = 'assets/dist/';
const FACES = ['front', 'rear', 'left', 'right', 'top', 'bottom'];

let DEVICES = [], COMPONENTS = [], DEV = null, SCOPE = null;

const NORM = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const nsOf = man => NORM(String(man).split(/\s+/)[0]);
const allVendors = () => !!$('allven')?.checked;

/** The vendor's modules, for whichever vendors the scope covers. */
function modulesFor(key) {
  const want = new Set(SCOPE.devicesFor(key).map(d => nsOf(d.manufacturer)));
  return COMPONENTS.filter(c => c.kind === 'module' && want.has(c.ns) && c.files?.default);
}

/**
 * Every drawing a device has, as {path, url}.
 *
 * A device is compiled once per CONFIGURATION - `as5912-54x.ac-f2b.front.svg`
 * alongside a bare `as5912-54x.front.svg` for the default - so "all
 * configurations" is roughly four times the bytes of the default one. The
 * config index is the authority on which exist; guessing filenames would ship a
 * zip full of 404s.
 */
async function filesFor(dev, faces, everyConfig) {
  const cfg = await jdist(`${DIST}${dev.name}.configs.json`).catch(() => null);
  // `configs` is a LIST of objects each carrying a `name`, not a map keyed by
  // name. Object.keys() on it yields "0", "1", "2" - which built URLs like
  // as5912-54x.0.front.svg and 404'd every one, silently, because a face a
  // device does not have is a normal thing to skip.
  const configs = everyConfig
    ? (Array.isArray(cfg?.configs) ? cfg.configs.map(c => c?.name).filter(Boolean)
       : Object.keys(cfg?.configs || {}))
    : [];
  const out = [];
  for (const face of faces) {
    out.push({path: `devices/${dev.name}/${dev.name}.${face}.svg`,
              url: `${DIST}${dev.name}.${face}.svg`,
              device: dev.name, version: dev.version ?? null,
              config: cfg?.default ?? null, face});
    // One entry per distinct FILE: since Portrayal #670 configurations that
    // draw a face identically share one, named after the first of them.
    const seen = new Set();
    for (const c of configs) {
      const f = faceFile(cfg || {device: dev.name}, c, face);
      if (seen.has(f)) continue;
      seen.add(f);
      out.push({path: `devices/${dev.name}/${f}`, url: `${DIST}${f}`,
                device: dev.name, version: dev.version ?? null, config: c, face});
    }
  }
  return {files: out, cfg};
}

const README = (label, n, faces, devs = []) => `# Portrayal drawings

${label} — ${n} file${n === 1 ? '' : 's'}, ${faces.join(' and ')}.
Generated ${new Date().toISOString().slice(0, 10)}.

## What this is a drawing OF

Each device carries a version that moves when its drawing does. A major bump
means a slot moved or an id was renamed - the two changes that invalidate a
coordinate or a reference taken from these files. Check these against the
library before trusting anything you cached from an older copy.

${devs.map(d => `    ${(d.model || d.name).padEnd(22)} ${d.version || '?'}`).join('\n')}

\`index.json\` carries the same list, and a version on every file entry.

Flat SVG in real millimetres. Every port, PSU, fan, LED, bay and region carries
a stable DOM id and a \`data-path\`, so you can find a named thing in the file
and colour it, label it, or link it to something else:

    document.querySelector('#port-12')
    document.querySelectorAll('[data-class="port"]')

\`index.json\` names every file with its device, configuration and face, so a
script does not have to parse filenames. Each device's \`configs.json\` is
alongside its drawings when the manifest is included.

## Layout

    devices/<device>/<device>.<config>.<face>.svg
    components/<vendor>--<part>--<version>--<skin>.svg

A device with no configuration in the name is that device's default. Components
are the modules that go in a chassis - line cards, supervisors, supplies, fans.

## Licence

Apache-2.0, like the library. The geometry is Portrayal's own, drawn from
measurements and datasheets; no vendor stencil or CAD is redistributed.

Generated from portrayal.dev.
`;

async function build(btn) {
  const key = $('scope').value;
  const faces = $('faces').value === 'all' ? FACES : $('faces').value.split(',');
  const everyConfig = $('cfgs').checked;
  const withMods = $('mods').checked;
  const withMeta = $('meta').checked;
  const stat = $('stat');
  btn.disabled = true;
  try {
    const devs = SCOPE.devicesFor(key);
    if (!devs.length) { stat.textContent = 'nothing in scope'; return; }

    const wanted = [];
    const configIndexes = {};
    let n = 0;
    for (const d of devs) {
      stat.textContent = `listing ${++n}/${devs.length}…`;
      const {files, cfg} = await filesFor(d, faces, everyConfig);
      wanted.push(...files);
      if (cfg) configIndexes[d.name] = cfg;
    }
    if (withMods) {
      for (const c of modulesFor(key)) {
        wanted.push({path: `components/${c.files.default.split('/').pop()}`,
                     url: `${DIST}${c.files.default}`,
                     component: `${c.ns}/${c.name}`, model: (c.attrs || {}).model || null});
      }
    }

    const entries = [];
    const missing = [];
    const enc = new TextEncoder();
    let got = 0;
    for (const w of wanted) {
      stat.textContent = `fetching ${++got}/${wanted.length}…`;
      const res = await fetch(w.url);
      // A face a device does not have is not an error - not everything is
      // drawn on six sides - so it is left out and counted, not thrown.
      if (!res.ok) { missing.push(w.path); continue; }
      entries.push({name: w.path, bytes: new Uint8Array(await res.arrayBuffer())});
    }
    if (!entries.length) { stat.textContent = 'nothing to download'; return; }

    const have = new Set(entries.map(e => e.name));
    if (withMeta) {
      entries.push({name: 'index.json', bytes: enc.encode(JSON.stringify({
        scope: SCOPE.labelFor(key),
        generated: new Date().toISOString().slice(0, 10),
        faces, everyConfig,
        // WHICH DRAWING THIS IS, not just which device. A device carries a
        // semantic version that moves when the drawing does, and a major bump
        // means a slot moved or an id was renamed - the two changes that
        // invalidate a coordinate or a reference somebody cached from this zip.
        // Without it a holder cannot tell a stale bundle from a current one.
        // roc-ops/portrayal-site#14.
        devices: devs.map(d => ({name: d.name, model: d.model,
                                 version: d.version ?? null})),
        files: wanted.filter(w => have.has(w.path)),
      }, null, 1))});
      for (const [name, cfg] of Object.entries(configIndexes)) {
        entries.push({name: `devices/${name}/configs.json`,
                      bytes: enc.encode(JSON.stringify(cfg, null, 1))});
      }
    }
    entries.push({name: 'README.md',
                  bytes: enc.encode(README(SCOPE.labelFor(key), entries.length,
                                           faces, devs))});

    stat.textContent = 'compressing…';
    const blob = await makeZip(entries, new Date());
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `portrayal-drawings-${SCOPE.tagFor(key)}.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    const raw = entries.reduce((t, e) => t + e.bytes.length, 0);
    stat.textContent =
      `${entries.length} files, ${(blob.size / 1048576).toFixed(1)} MB ` +
      `(${(raw / 1048576).toFixed(1)} MB uncompressed)` +
      (missing.length ? ` — ${missing.length} not drawn` : '');
  } catch (err) {
    stat.textContent = `failed: ${err.message}`;
  } finally {
    btn.disabled = false;
  }
}

function describe() {
  $('allven-count').textContent = ` (${DEVICES.length})`;
  $('scope').disabled = allVendors();
  const n = modulesFor($('scope').value).length;
  $('mods-count').textContent = n ? ` (${n})` : '';
  $('mods').disabled = !n;
}

(async () => {
  try {
    DEVICES = (await jdist(`${DIST}devices.json`)).devices;
    COMPONENTS = (await jdist(`${DIST}components.json`).catch(() => ({}))).components || [];
  } catch (err) {
    $('stat').textContent = `could not load the device index: ${err.message}`;
    return;
  }
  const want = new URLSearchParams(location.search).get('device');
  DEV = DEVICES.some(d => d.name === want) ? want : DEVICES[0].name;
  SCOPE = bindScopes({
    selects: ['scope'],
    devices: () => DEVICES,
    currentDevice: () => DEVICES.find(d => d.name === DEV),
    allVendors,
  });
  createDevicePicker({mount: $('pick'), devices: DEVICES, value: DEV,
                      onchange: name => { DEV = name; SCOPE.refresh(); describe(); }});
  SCOPE.refresh();
  describe();
  $('scope').addEventListener('change', describe);
  $('allven').addEventListener('change', describe);
  $('dl').onclick = e => build(e.currentTarget);
})();
