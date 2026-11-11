// THE FACTS TABLE'S MODEL (roc-ops/portrayal-site#15, step 1): what the library
// states about a few devices, side by side, with every missing figure shown as
// missing. No page code here and no fetching - the page hands over what it
// loaded, and tests/facts pins what comes back.
//
// A comparison where a missing figure is a blank next to a real one is a lie by
// omission, so a fact never has an empty value: it has a STATE, and the state
// is what the page prints beside it, in words, so a greyscale print carries it.
//
//   derived  counted or measured off the drawing or the chassis
//   stated   read from an attribute the model carries
//   unknown  nobody has put it in the model: printed "not modelled"
//
// The proposal's `partial` and `attested-absent` states are not here: they need
// a sum of occupants and a per-fact gaps register, which are later parts.

export const NOT_MODELLED = 'not modelled';

// The marker each state prints. Words, not colour.
export const STATE_TAG = {derived: 'derived', stated: 'stated', unknown: 'no figure in the model', absent: 'none recorded'};

// rack.json's `mount` values that mean the box does not go in a rack's units.
// `rack-side` and `rack-face` are parts that mount on a rack and keep their units.
const NOT_RACK = new Set(['desktop', 'wall', 'din-rail', 'ceiling']);

const known = v => v !== null && v !== undefined && v !== '';
const stated = (key, label, value, unit, detail) => ({key, label, state: 'stated', value, unit, detail});
const derived = (key, label, value, unit, detail) => ({key, label, state: 'derived', value, unit, detail});
const unknown = (key, label, unit) => ({key, label, state: 'unknown', value: null, unit});

// THE PORTS A FACE DRAWS, by media and speed. A port is a `<g>` of class port;
// the aperture inside a cage carries `data-inner` and is not a second port. A
// port whose speed the drawing does not state is counted under speed null, not
// dropped and not given a speed.
const PORT = /<g\b[^>]*\bdata-class="port"[^>]*>/g;
const attr = (tag, name) => tag.match(new RegExp(`\\sdata-${name}="([^"]*)"`))?.[1] ?? null;

export function countPorts(svg) {
  const by = new Map();
  for (const tag of String(svg).match(PORT) || []) {
    if (/\sdata-inner=/.test(tag)) continue;
    const media = attr(tag, 'media') ?? 'unlabelled', speed = attr(tag, 'speed');
    const k = `${media}\t${speed ?? ''}`;
    by.set(k, (by.get(k) || 0) + 1);
  }
  return [...by].map(([k, n]) => {
    const [media, speed] = k.split('\t');
    return {media, speed: speed || null, n};
  }).sort((a, b) => a.media.localeCompare(b.media) || String(a.speed).localeCompare(String(b.speed)));
}

const portKey = p => `ports.${p.media}.${p.speed ?? 'speed-unknown'}`;
const portLabel = p => `${p.media} ports, ${p.speed ?? 'speed not modelled'}`;

// ONE DEVICE'S TABLE-ONE FACTS, as a list. `rack` is the device's entry in
// rack.json, `source` its source.json, `configs` its configs.json, `faces` the
// SVG text of its default front and rear (null for one that could not be read).
export function deviceFacts({name, rack = null, source = null, configs = null, faces = null}) {
  const ch = source?.chassis || {};
  const out = [];
  for (const [k, label] of [['width', 'Width'], ['height', 'Height'], ['depth', 'Depth']]) {
    out.push(known(ch[k]) ? derived(`size.${k}`, label, ch[k], 'mm') : unknown(`size.${k}`, label, 'mm'));
  }
  const {width: w, height: h, depth: d} = ch;
  out.push(known(w) && known(h) && known(d)
    ? derived('size.volume', 'Volume', Math.round(w * h * d / 1e4) / 100, 'L')
    : unknown('size.volume', 'Volume', 'L'));

  const mount = rack?.mount ?? null;
  if (mount && NOT_RACK.has(mount)) out.push(derived('mount.ru', 'Rack units', 'not rack mounted', null, mount));
  else if (known(ch.ru)) out.push(stated('mount.ru', 'Rack units', ch.ru, 'U', mount || undefined));
  else out.push(unknown('mount.ru', 'Rack units'));

  out.push(known(ch['weight-kg']) ? stated('physical.weight-kg', 'Weight', ch['weight-kg'], 'kg')
                                  : unknown('physical.weight-kg', 'Weight', 'kg'));

  const drawn = faces ? ['front', 'rear'].filter(v => faces[v] != null) : [];
  if (!drawn.length) {
    out.push(unknown('ports.total', 'Ports (front and rear)'));
  } else {
    const ports = drawn.flatMap(v => countPorts(faces[v]));
    const merged = new Map();
    for (const p of ports) {
      const k = portKey(p);
      merged.set(k, {...p, n: (merged.get(k)?.n || 0) + p.n});
    }
    const all = [...merged.values()];
    out.push(derived('ports.total', 'Ports (front and rear)', all.reduce((s, p) => s + p.n, 0), null,
      drawn.length === 2 ? undefined : `${drawn[0]} only; the other face is not modelled`));
    for (const p of all) out.push({...derived(portKey(p), portLabel(p), p.n), group: 'ports'});
  }

  const bays = configs?.bays;
  out.push(bays && typeof bays === 'object'
    ? derived('bays.count', 'Bays', Object.values(bays).reduce((s, l) => s + (l?.length || 0), 0))
    : unknown('bays.count', 'Bays'));
  return {name, facts: out};
}

// THE DEVICES SIDE BY SIDE: one row per fact key, one cell per device, in the
// order the devices were given. A device with no such fact gets a cell of its
// own state, never a gap in the row: an unknown fact is `unknown`, and a port
// kind another device has but this one does not is a drawn zero when its faces
// were read, `unknown` when they were not.
export function alignFacts(devices) {
  const order = [], rows = new Map();
  for (const dev of devices) for (const f of dev.facts) {
    if (!rows.has(f.key)) { rows.set(f.key, {key: f.key, label: f.label, unit: f.unit ?? null, group: f.group ?? null}); order.push(f.key); }
  }
  const fixed = order.filter(k => !k.startsWith('ports.') || k === 'ports.total');
  const ports = order.filter(k => k.startsWith('ports.') && k !== 'ports.total').sort();
  const seq = [...fixed.slice(0, fixed.indexOf('ports.total') + 1), ...ports, ...fixed.slice(fixed.indexOf('ports.total') + 1)];
  return seq.map(k => {
    const row = rows.get(k);
    return {...row, cells: devices.map(dev => {
      const f = dev.facts.find(x => x.key === k);
      if (f) return f;
      const total = dev.facts.find(x => x.key === 'ports.total');
      return total?.state === 'derived' ? derived(k, row.label, 0) : unknown(k, row.label);
    })};
  });
}

// AUTHORED ATTRIBUTES, section by section, in the model's own organisation.
// `attrs` is a device's `attrs` (section -> key -> value). Sections and keys are
// sorted alphabetically, the same for every column; a key is aligned by its
// exact name only, so `weight` and `weight-configured-kg` stay two rows. No
// arithmetic is done on a value: they are free text with units in the string.
// A device without a section says so in that section, in every row.
export function authoredSections(devices) {
  const names = new Set();
  for (const d of devices) for (const s of Object.keys(d.attrs || {})) names.add(s);
  return [...names].sort().map(section => {
    const keys = new Set();
    for (const d of devices) for (const k of Object.keys(d.attrs?.[section] || {})) keys.add(k);
    const has = devices.map(d => d.attrs?.[section] != null && typeof d.attrs[section] === 'object');
    return {
      section,
      missingIn: devices.filter((_, i) => !has[i]).map(d => d.name),
      rows: [...keys].sort().map(key => ({
        key,
        cells: devices.map((d, i) => !has[i]
          ? {state: 'absent', text: `no ${section} attributes recorded`}
          : known(d.attrs[section][key])
            ? {state: 'stated', text: attrText(d.attrs[section][key])}
            : {state: 'unknown', text: NOT_MODELLED}),
      })),
    };
  });
}

// A value as the model wrote it. Strings are shown whole; anything else is its JSON.
export const attrText = v => typeof v === 'string' ? v : JSON.stringify(v);

// A FACT AS THE CELL PRINTS IT: the number plainly, its unit, then the state's word.
export function factText(f) {
  if (f.state === 'unknown') return NOT_MODELLED;
  return f.unit ? `${f.value} ${f.unit}` : String(f.value);
}

// THE DEVICES A URL NAMES, kept to the ones the library has, once each, in order.
export function devicesFromSearch(search, known_) {
  const have = new Set(known_);
  const seen = new Set();
  return (new URLSearchParams(search).get('devices') || '').split(',').map(s => s.trim())
    .filter(n => n && have.has(n) && !seen.has(n) && seen.add(n));
}
