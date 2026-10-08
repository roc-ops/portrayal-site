// site/rack/agent-text.js
// THE AGENT TOOLS' TEXT (spec 2026-10-08-rack-agent-tools-2-design.md): the
// bound every answer keeps, and the pieces that keep it. Pure, no DOM: tested
// in Node.

// Chrome's WebMCP guidance: tool output of about 1.5K characters at most.
export const LIMIT = 1500;

// Cut at the last whole line that fits, and say how many lines were left out.
export function fit(text, limit = LIMIT) {
  if (text.length <= limit) return text;
  const lines = text.split('\n');
  for (let keep = lines.length - 1; keep >= 1; keep--) {
    const left = lines.length - keep;
    const out = [...lines.slice(0, keep), `(${left} more line${left === 1 ? '' : 's'} left out.)`].join('\n');
    if (out.length <= limit) return out;
  }
  return `${text.slice(0, limit - 1)}…`;
}

export function ranges(ns) {
  const s = [...new Set(ns)].sort((a, b) => a - b), out = [];
  for (let i = 0; i < s.length; i++) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    out.push(i === j ? `U${s[i]}` : `U${s[i]}-U${s[j]}`);
    i = j;
  }
  return out.join(', ');
}

// One line cut at `n` characters.
export const clip = (s, n) => (String(s).length <= n ? String(s) : `${String(s).slice(0, n - 1)}…`);

// A list cut at `n`, then "and k more".
export const cutList = (xs, n = 8) => (xs.length <= n ? xs.join(', ') : `${xs.slice(0, n).join(', ')} and ${xs.length - n} more`);

// RUNS: neighbors whose paths differ only in one number, counting up by one,
// and whose key matches, become one entry: port-1..48, port-1..32-occupant.
// A 56-port switch is a few lines, not 56.
export function runs(list, keyOf) {
  const out = [];
  for (const e of list) {
    const m = /^(.*?)(\d+)(\D*)$/.exec(String(e.path));
    const k = keyOf(e), last = out.at(-1);
    if (m && last?.m && last.key === k && last.m[1] === m[1] && last.m[3] === m[3] && Number(m[2]) === last.to + 1) {
      last.to = Number(m[2]);
      last.n++;
      continue;
    }
    out.push({e, key: k, m, to: m ? Number(m[2]) : null, n: 1});
  }
  return out.map(r => ({...r.e, n: r.n, path: r.n > 1 ? `${r.m[1]}${r.m[2]}..${r.to}${r.m[3]}` : r.e.path}));
}

// The lines from `offset` that fit in `room` characters. A line too long to
// fit alone is cut, so a page always moves forward.
export function windowLines(lines, offset, room) {
  const out = [];
  let used = 0;
  for (let i = offset; i < lines.length; i++) {
    const add = lines[i].length + (out.length ? 1 : 0);
    if (used + add > room) {
      if (!out.length) out.push(clip(lines[i], room));
      break;
    }
    out.push(lines[i]);
    used += add;
  }
  return out;
}

// ── inspect ──────────────────────────────────────────────────────────────
// The kit's inspect (vendor/rack/queries.js) answers with plain data; this is
// how an agent reads it (spec 2026-10-08 section 3): the device, then its bays,
// cages, fields and cables, in runs.
export const INSPECT_SECTIONS = ['bays', 'cages', 'fields', 'cables'];
const TITLE = {bays: 'Bays', cages: 'Cages', fields: 'Fields', cables: 'Cables'};
const NOT_LOADED = 'Its parts list could not be loaded, so its bays, cages and fields are not shown.';
const paren = s => (s ? ` (${s})` : '');
const both = (...xs) => xs.filter(Boolean).join(', ');
const takes = accepts => `takes ${accepts.length}${accepts.length ? `: ${cutList(accepts.map(a => a.ref))}` : ''}`;

// The device line, and up to `configs` of its configurations.
export function itemHead(o, {configs = 8} = {}) {
  const what = [o.manufacturer, o.model].filter(Boolean).join(' ') || o.ref;
  const line = [`${o.id ?? o.ref}${o.label ? ` ${clip(o.label, 60)}` : ''}: ${what} (${o.ref}), cfg ${o.cfg || 'none'}`,
    o.ru != null ? `ru ${o.ru} ${o.face}` : 'not placed',
    ...(o.turned ? ['turned'] : []), ...(o.on ? [`on ${o.on} unit ${o.unit}`] : []),
    ...(o.managers?.length ? [`carries ${o.managers.join(' ')}`] : [])].join(', ');
  const out = [line];
  const cs = o.configs ?? [];
  if (configs > 0 && cs.length) {
    out.push(...cs.slice(0, configs).map(c =>
      `config ${c.name}${c.name === o.cfg ? ' (in use)' : ''}${c.airflow ? `, ${c.airflow}` : ''}: ${clip(c.description ?? '', 70)}`));
    if (cs.length > configs) out.push(`and ${cs.length - configs} more configs.`);
  }
  if (o.slots === 'not loaded') out.push(NOT_LOADED);
  return out;
}

// Each section as lines. Fields are sorted by key first (a stable sort keeps
// the paths in order), so every optic's latch-color can join one run.
export function sectionLines(o) {
  const slotKey = s => JSON.stringify([s.view, s.group ?? s.interface ?? null, s.holds ?? null, (s.accepts ?? []).map(a => a.ref)]);
  const fields = [...(o.fields ?? [])].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return {
    bays: runs(o.bays ?? [], slotKey).map(b =>
      `${b.path}${paren(both(b.group, b.view === 'rear' && 'rear'))}: holds ${b.holds ?? 'nothing'}; ${takes(b.accepts ?? [])}`),
    cages: runs(o.cages ?? [], slotKey).map(c =>
      `${c.path}${paren(both(c.interface, c.view === 'rear' && 'rear'))}: holds ${c.holds ?? 'nothing'}; ${takes(c.accepts ?? [])}`),
    // The kit gives a field's value as it reads, its default when unset: a
    // value equal to the default is said to be the default, and an empty one
    // is shown as "".
    fields: runs(fields, f => JSON.stringify([f.key, f.value ?? null, f.default ?? null, f.type])).map(f => {
      const v = String(f.value ?? f.default ?? '');
      const isDefault = f.value == null || v === String(f.default ?? '');
      return `${f.path}: ${f.key} = ${v === '' ? '""' : clip(v, 160)}${isDefault ? ' (default)' : ''} (${f.type})${f.choices?.length ? `; choices: ${cutList(f.choices)}` : ''}`;
    }),
    cables: (o.cables ?? []).map(c => `${c.id}: its ${c.end} end on ${c.path}${c.view === 'rear' ? ' (rear)' : ''}, to ${c.other}`),
  };
}

// THE ANSWER FOR A DEVICE. Whole when it fits. Otherwise in pages: a page
// starts at {section, offset} and walks on through the later sections while
// it fits, and its first line says what it shows and what to send next.
// `ask` names the device ({id} or {ref, cfg}).
export function inspectText(o, {section = null, offset = 0, ask = {}} = {}) {
  const parts = sectionLines(o);
  if (section == null && !offset) {
    const whole = [...itemHead(o), ...INSPECT_SECTIONS.flatMap(s => (parts[s].length ? [`${TITLE[s]}:`, ...parts[s]] : []))].join('\n');
    if (whole.length <= LIMIT) return whole;
  }
  const firstPage = section == null && !offset;
  const head = itemHead(o, {configs: firstPage ? 3 : 0}).map(l => clip(l, 300));
  const flat = INSPECT_SECTIONS.flatMap(s => parts[s].map((line, i) => ({s, i, line: clip(line, 300)})));
  const si = INSPECT_SECTIONS.indexOf(section ?? INSPECT_SECTIONS[0]);
  const start = flat.findIndex(x => INSPECT_SECTIONS.indexOf(x.s) > si || (INSPECT_SECTIONS.indexOf(x.s) === si && x.i >= offset));
  const name = o.id ?? o.ref;
  if (start < 0) return [`Nothing in ${name} from ${INSPECT_SECTIONS[si]} ${offset} on.`, ...head].join('\n');
  // 200 characters are kept for the first line, which is written last.
  const room = LIMIT - head.join('\n').length - 200;
  const page = [];
  let end = start, last = null;
  for (let k = start; k < flat.length; k++) {
    const x = flat[k];
    const add = [...(x.s !== last ? [`${TITLE[x.s]}:`] : []), x.line];
    if (end > start && [...page, ...add].join('\n').length + 1 > room) break;
    page.push(...add);
    last = x.s;
    end = k + 1;
  }
  const shown = INSPECT_SECTIONS.map(s => {
    const xs = flat.slice(start, end).filter(x => x.s === s);
    return xs.length ? `${s} ${xs[0].i + 1}-${xs.at(-1).i + 1} of ${parts[s].length}` : null;
  }).filter(Boolean).join(', ');
  const next = flat[end];
  const first = `Part of ${name}: ${shown}. ${next ? `Next: ${JSON.stringify({...ask, section: next.s, offset: next.i})}.` : 'That is the end.'}`;
  return [first, ...head, ...page].join('\n');
}

// THE ANSWER FOR A CABLE: its ends, what it is, how long, its route and the
// waypoints it can take, and why an end does not land. `unchecked` (the kit
// could not read the ends' facts) is said, never read as "nothing is loose".
const len = x => (x == null ? null : typeof x === 'number' ? `${Math.round(x * 100) / 100} m` : `${x.value} ${x.unit ?? 'm'}`);
const endText = e => `${e.item}/${e.path}${e.view === 'rear' ? ' (rear)' : ''}${e.name ? ` (${clip(e.name, 60)})` : ''}`;
export function cableText(c) {
  const stock = len(c.routed?.stock);
  const lines = [
    `${c.id}: ${endText(c.a)} <-> ${endText(c.b)}`,
    [`media ${c.media || 'not known'}`, c.purpose ? `purpose ${clip(c.purpose, 60)}` : null, c.label ? `label ${clip(c.label, 80)}` : null].filter(Boolean).join(', '),
    `length ${c.length ? `${len(c.length)}${c.length.source ? ` (${c.length.source})` : ''}` : 'not known'}` +
      (c.routed ? `; routed ${len(c.routed.metres)}${stock ? `, stock size ${stock}` : ''}` : '; routed length not measured') +
      (c.slack ? `; slack ${len(c.slack.metres)}` : ''),
    `route: ${c.route?.edited ? 'drawn by hand' : 'its own'}${c.route?.text ? `: ${clip(c.route.text, 300)}` : ''}`,
  ];
  const ways = Object.entries(c.passes ?? {}).filter(([, ids]) => ids.length).map(([it, ids]) => `{item: ${it}, via: ${cutList(ids, 6)}}`);
  if (c.lanes?.length) ways.push(`{lane, ru} with lane ${cutList(c.lanes.map(l => l.id ?? l), 6)}`);
  if (ways.length) lines.push(`Waypoints it can take: ${ways.join('; ')}`);
  if (c.unchecked || c.loose == null) lines.push('Its ends could not be checked, so whether they land is not known.');
  for (const l of c.loose ?? []) lines.push(`Loose: the ${l.end} end: ${l.reason}`);
  for (const m of c.mismatch ?? []) lines.push(`Mismatch: ${m}`);
  return fit(lines.join('\n'));
}
