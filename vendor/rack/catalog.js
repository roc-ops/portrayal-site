// THE RACK CATALOGUE (rack.json, written by rack_index.py beside devices.json):
// every device's rack units, depth, mount, shell, stated cable capacity, the
// ids a cable route can pass through and, where a device is not simply its
// envelope, the `solids` a route may not (solids.js). Loaded once per page through `dist`, the
// same build every other kit module reads.

import {jdist} from '../dist.js';
import {redirectsOf} from '../redirects.js';

const urlOf = (dist, path) => (typeof dist === 'function' ? dist(path) : `${String(dist).replace(/\/$/, '')}/${path}`);

export const chassisLookup = devices => ref => (Object.hasOwn(devices, ref) ? devices[ref] : null);

const cmp = (a, b) => String(a ?? '').localeCompare(String(b ?? ''));
export const catalogEntries = devices => Object.entries(devices)
  .map(([name, e]) => ({name, ...e}))
  .sort((a, b) => cmp(a.manufacturer, b.manufacturer) || cmp(a.model, b.model));

export async function loadCatalog(dist) {
  const j = await jdist(urlOf(dist, 'rack.json'));
  if (j?.format !== 1) throw new Error(`rack.json: format ${j?.format}; this kit reads format 1`);
  const devices = j.devices || {};
  return {chassisOf: chassisLookup(devices), entries: catalogEntries(devices), devices};
}

// THE PARTS OF THE DEVICES IN A RACK, for the commands that check a bay, a
// cage or a field (`fit`, `field`, and `place` and `patch` with a
// configuration). Each device's `<ref>.configs.json` is fetched once, through
// `jdist`, and `components.json` once; what comes back is a synchronous
// lookup, so the commands stay pure. A device whose file cannot be fetched is
// null, as an unknown one is, and the commands refuse it with a sentence;
// nothing here throws to the caller. A ref is a device's name in the build,
// which holds no dot or slash, so nothing else is fetched.
const DEVICE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const compKey = c => `${c.ns}/${c.name}@${String(c.major).replace(/^v/, '')}`;

// WHAT A PDU MEASURES, from its class (`pdu-class` at the top of its
// configs.json, docs/format-stability.md): nothing, its input, its branches
// too, or each outlet. null for a device that is no PDU, or a class this kit
// does not know.
const METERING = {basic: 'none', switched: 'none', 'metered-input': 'input', 'switched-metered-input': 'input',
  'metered-branch': 'branch', 'switched-metered-branch': 'branch', 'metered-outlet': 'outlet', managed: 'outlet'};
export const meteringOf = pduClass => (Object.hasOwn(METERING, pduClass) ? METERING[pduClass] : null);
// THE FACTS A RACK ENTRY IS CHECKED AGAINST, for one device and the
// configuration an entry names (its default when it names none): what the
// device measures, what each placed part can be set to (`states`), the slots it
// offers a hanging part and the mount points it hangs by, each as its
// configs.json states it. `names` is the name a DCIM knows a settable part by
// where that is not its path (an outlet `outlet-a2` is A2), {} when the
// catalogue gives none. `slots` is what loadSlots answered for the device;
// null when that is not loaded or it has no such configuration.
export function configFacts(slots, cfg) {
  if (!slots || slots.error) return null;
  const name = cfg || slots.default;
  const c = (slots.configs || []).find(k => k.name === name);
  if (!c) return null;
  return {config: c.name, pduClass: slots['pdu-class'] ?? null, metering: meteringOf(slots['pdu-class']),
          states: c.states || {}, names: c.names || {}, ...(c.displays ? {displays: c.displays} : {}), slots: c.slots || [], mountPoints: c['mount-points'] || []};
}

export async function loadSlots(dist, refs = []) {
  const comps = new Map();
  let list = [];
  try {
    list = (await jdist(urlOf(dist, 'components.json')))?.components || [];
    for (const c of list) comps.set(compKey(c), c);
  } catch { /* every part is unknown: compByRef answers null */ list = []; }
  const slots = new Map();
  await Promise.all([...new Set(refs)].filter(r => typeof r === 'string' && DEVICE_NAME.test(r)).map(async ref => {
    try {
      const j = await jdist(urlOf(dist, `${ref}.configs.json`));
      slots.set(ref, {bays: j?.bays || {}, cages: j?.cages || {}, configs: j?.configs || [], default: j?.default ?? null,
                      'pdu-class': j?.['pdu-class'] ?? null});
    } catch { slots.set(ref, null); }
  }));
  return {
    slotsOf: ref => slots.get(ref) ?? null,
    compByRef: ref => (ref == null ? null : comps.get(String(ref).split(':')[0]) ?? null),
    // the removed refs a published part stands in for (kit/redirects.js); a
    // components.json from before the key reads as none
    redirects: redirectsOf(list),
  };
}
