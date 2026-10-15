// site/rack/agent-text.js
// THE AGENT TOOLS' TEXT (spec 2026-10-08-rack-agent-tools-2-design.md): the
// bound every answer keeps, and the pieces that keep it. Pure, no DOM: tested
// in Node.

import {estimatedWords} from './capacity-text.js';

// Chrome's WebMCP guidance: tool output of about 1.5K characters at most.
export const LIMIT = 1500;

// What each figure in a cable's lengths means, in one sentence: said in the
// cable's text here and under the cable list (spare.js re-exports it).
export const FIGURES_HELP = 'Needs is the path inside the ports, less the maker\'s allowance; routed is the measured path; stock size is the next stock length; short means the cord is shorter than it needs.';

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

// ONE FREE PORT, OR A RUN OF THEM, AS list_free_ports SAYS IT (queries.js
// freePorts). A data port: its speed, media and cage. An outlet of a part
// beside the rack (kit 0.36.0, Portrayal #1068): its connector, its label on
// the part, the unit it is at, and the plug a cord takes there. A device's
// power or ground end: what it is, its connector and its plug.
export function freeLine(p) {
  const plug = p.plug ? `, plug ${p.plug}` : '';
  if (p.type !== undefined || p.u !== undefined)
    return `${p.path}, ${p.view}: ${[p.connector ?? p.type ?? p.kind, p.label].filter(Boolean).join(' ')}${p.u != null ? ` at U${p.u}` : ''}${plug}`;
  if (p.kind && p.kind !== 'data') return `${p.path}, ${p.view}: ${[p.kind, p.connector].filter(Boolean).join(', ')}${plug}`;
  return `${p.path}, ${p.view}: ${[p.speed, p.media, p.cage].filter(Boolean).join(' ') || 'port'}`;
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
// (settable and displays: kit 0.45.0 and 0.47.0, what state.set and display.set take, and what each is set to now)
export const INSPECT_SECTIONS = ['bays', 'cages', 'fields', 'settable', 'displays', 'cables'];
const TITLE = {bays: 'Bays', cages: 'Cages', fields: 'Fields', settable: 'Lamps, digits and outlets state.set takes', displays: 'Displays display.set takes', cables: 'Cables'};
const orWords = xs => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} or ${xs.at(-1)}`);
// paths in runs: led-port-0/lamp .. led-port-52/lamp is one entry
const pathsText = paths => cutList(runs([...paths].sort((a, b) => a.localeCompare(b, 'en', {numeric: true})).map(path => ({path})), () => 0).map(r => r.path), 6);
// WHAT A DEVICE'S PARTS CAN BE SET TO (inspect's `settable`, [{can, paths}], grouped by vocabulary) and what it
// is set to now (`states`); and its displays ([{path, text, shows}]), as the kit gives them
export function settableLines(o) {
  const now = Object.entries(o.states ?? {});
  return [...(now.length ? [`set now: ${cutList(now.map(([p, s]) => `${p} ${s}`), 10)}`] : []),
    ...(o.settable ?? []).map(g => `${pathsText(g.paths)} can be ${orWords(g.can)}`)];
}
export const displayLines = o => (o.displays ?? []).map(d =>
  `${d.path}: ${d.text}; ${d.shows ? `shows ${clip(JSON.stringify(d.shows), 100)}` : 'shows nothing'}`);
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
  const ways = pathwaysLine(o.pathways);
  if (ways) out.push(ways);
  // what state.set and display.set take, in one line: the lists are sections of their own, further on
  const nset = (o.settable ?? []).reduce((n, g) => n + g.paths.length, 0);
  if (nset) out.push(`state.set takes ${nset} paths of lamps, digits, outlets or breakers${o.states ? `; set now: ${cutList(Object.entries(o.states).map(([p, s]) => `${p} ${s}`), 3)}` : ''} (section settable lists them).`);
  if (o.displays?.length) out.push(`display.set takes ${cutList(o.displays.map(d => d.path), 3)} (section displays says what each shows).`);
  if (o.slots === 'not loaded') out.push(NOT_LOADED);
  return out;
}

// A PART'S PATHWAYS (kit 0.35.0, Portrayal #1065: inspect's `pathways` of an
// item or a part beside the rack, [{via, kind, holds_spare}]), by kind, each
// kind saying whether it holds spare; null for none.
const KIND_ORDER = ['duct', 'tray', 'ring', 'pass', null];
const KIND_NAME = {duct: 'duct', tray: 'tray', ring: 'ring', pass: 'pass-through', null: 'of no known kind'};
export function pathwaysLine(ways) {
  if (!Array.isArray(ways) || !ways.length) return null;
  const groups = KIND_ORDER.map(k => ways.filter(w => (w.kind ?? null) === k))
    .concat([ways.filter(w => !KIND_ORDER.includes(w.kind ?? null))]).filter(g => g.length);
  return `Pathways: ${groups.map(g => `${KIND_NAME[g[0].kind ?? null] ?? g[0].kind} ${cutList(g.map(w => w.via), 6)}`
    + ` (${g.every(w => w.holds_spare) ? 'holds spare' : g.some(w => w.holds_spare) ? 'some hold spare' : 'holds no spare'})`).join('; ')}.`;
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
    settable: settableLines(o),
    displays: displayLines(o),
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
// SPARE (spare.js): `spare` is the cable's in the words its row in the list
// says ("1 m cord, 0.57 m spare"), or null, and `needs` the sentence for a
// pinned length under what the route needs. Both are the kit's figures (kit
// 0.22.0, rack file version 4): its `slack` on inspect is that same spare, the
// stock less the need, with where it is: `at_ends_m` in the curves into the
// two ports, each place it is said to be stored, and `unplaced_m`, what is to
// store and has no place (`said` false: nobody chose; true: a list was given).
// The length carries `need`. Before 0.22.0 the kit's slack was another figure
// (an entered length less the routed one), and both were said, each by name.
// A LOOP IN A DUCT (kit 0.35.0, Portrayal #1065): `kind: 'duct'` and the
// kit's `load`, how full the duct is with the spare in it against the count
// its maker states (slack.js spareLoad); never a capacity the data lacks.
const loadWords = l => (!l ? '' : !l.stated ? ' (a duct whose maker states no cable capacity)'
  // (kit 0.39.0: a cable the count does not take in, a fibre cord against a count of cat6, is not counted against it)
  : l.notCounted ? ` (a duct whose stated capacity is for ${l.media ? `${l.media} cables` : `cables of ${l.diameter} mm or more`}, which ${l.cableMedia ?? 'this cable'} is not counted against)`
  : !l.compared ? ' (a duct whose stated capacity names no kind of cable)'
  // (kit 0.40.0: a count the library estimates for a maker that states none is said to be an estimate)
  : l.estimated ? ` (a duct holding ${l.count} ${l.media ? `${l.media} ` : ''}cables' worth ${l.over ? 'past' : 'against'} ${estimatedWords(l.capacity, l.media)} (its maker states none))`
  : ` (a duct holding ${l.count} ${l.media ? `${l.media} ` : ''}cables' worth of the ${l.capacity} its maker states${l.over ? ', past it' : ''})`);
const storedWords = s => [
  `${len(s.at_ends_m)} at the two ends`,
  ...(s.stored ?? []).map(e => (e.end ? `${len(e.metres) ?? 'a length'} at end ${String(e.end).toUpperCase()}`
    : `${len(e.metres) ?? 'a length'} as a ${e.form} in ${e.item} ${e.via}${e.ok === false ? ', where it cannot be stored' : e.kind === 'duct' ? loadWords(e.load) : ''}`)),
  ...(s.unplaced_m > 0 ? [`${len(s.unplaced_m)} ${s.said && !(s.stored ?? []).length ? 'left unplaced by choice' : 'not placed'}`] : []),
].join(', ');
// The page draws a loop where the kit stores spare in a duct or on a tray
// (spare-loops.js); spare at an end, or in a place it cannot be stored, is
// listed only.
const drawnLoop = s => (s.stored ?? []).some(e => e.item && e.ok !== false && e.metres > 0);
// WHERE ITS SPARE CAN GO (kit 0.35.0: inspect's `spare_places`), as the kit's
// refusals end: the ducts and trays on its route, or an end.
const ENDS = 'at an end ({end: a} or {end: b})';
const placesLine = ps => (ps.length ? `Spare can go in: ${cutList(ps.map(p => `${p.item} ${p.via}`), 8)}, or ${ENDS}.` : `Spare can go only ${ENDS}.`);
// The kit's spare findings named by kind where the kind says more than the sentence.
const FINDING_KIND = {'spare-capacity-unstated': 'capacity not stated', 'spare-capacity-estimated': 'capacity estimated', 'spare-over-capacity': 'over capacity'};
// A bend is the kit's sentence and its advice, said whole (a pair of turns on one short leg is one sentence of up
// to 182 characters with the kit's own names, and longer with a long label).
const bendLines = c => (c.route?.bends ?? []).filter(x => x.text).map(x => `Tight bend: ${x.text}${x.advice ? ` ${x.advice}` : ''}`);
// A cable that enters and leaves a ring by one face (kit 0.35.0, #1067: inspect's route.ring_findings,
// `{item, via, text}`), one whole sentence each.
const ringLines = c => (c.route?.ring_findings ?? []).filter(x => x.text).map(x => `Ring: ${clip(x.text, 300)}`);
// What the kit finds of its spare (0.22.0: spare-unplaced, spare-short, spare-over, spare-off-route).
// (0.35.0: spare-capacity-unstated and spare-over-capacity, a duct's load, named by kind)
const spareLines = c => (c.spare_findings ?? []).map(f => `Spare${FINDING_KIND[f.kind] ? `, ${FINDING_KIND[f.kind]}` : ''}: ${clip(f.text, 200)}`);
/** What the kit finds of one cable's lay, as inspect says it: bends, ring findings and spare findings. */
export const findingLines = c => [...bendLines(c), ...ringLines(c), ...spareLines(c)];
export function cableText(c, {spare = null, needs = null} = {}) {
  const stock = len(c.routed?.stock);
  const lines = [
    `${c.id}: ${endText(c.a)} <-> ${endText(c.b)}`,
    [`media ${c.media || 'not known'}`, c.purpose ? `purpose ${clip(c.purpose, 60)}` : null, c.label ? `label ${clip(c.label, 80)}` : null].filter(Boolean).join(', '),
    `length ${c.length ? `${len(c.length)}${c.length.source ? ` (${c.length.source})` : ''}${c.length.need != null ? `, needs ${len(c.length.need)}` : ''}` : 'not known'}` +
      (c.routed ? `; routed ${len(c.routed.metres)}${stock ? `, stock size ${stock}` : ''}` : '; routed length not measured') +
      // One spare: the row's words when the page can say them (no loose end),
      // else the kit's figure; then where the kit says it is.
      (spare ? `; ${spare}${needs ? `; ${needs}` : ''}` : c.slack ? `; spare ${len(c.slack.metres)}` : '') +
      (c.slack && c.slack.metres >= 0 ? ` (${storedWords(c.slack)}; ${drawnLoop(c.slack) ? 'the stored loop is drawn' : 'spare is listed, not drawn'})`
        : spare || c.slack ? ' (the drawing shows the path only)' : ''),
    ...(c.length?.need != null || c.routed ? [FIGURES_HELP] : []),
    `route: ${c.route?.edited ? 'drawn by hand' : 'its own'}${c.route?.text ? `: ${clip(c.route.text, 300)}` : ''}`,
  ];
  // A bundled cable (kit 0.7.0): which bundle, and where it joins and leaves it.
  if (c.bundle) lines.push(`In bundle ${c.bundle.id}${c.bundle.join ? `, joining at ${wayText(c.bundle.join) ?? c.bundle.join}` : ''}` +
    `${c.bundle.leave ? ` and leaving at ${wayText(c.bundle.leave) ?? c.bundle.leave}` : ''}; inspect ${c.bundle.id} for the bundle.`);
  const ways = Object.entries(c.passes ?? {}).filter(([, ids]) => ids.length).map(([it, ids]) => `{item: ${it}, via: ${cutList(ids, 6)}}`);
  if (c.lanes?.length) ways.push(`{lane, ru} with lane ${cutList(c.lanes.map(l => l.id ?? l), 8)}`);
  if (ways.length) lines.push(`Waypoints it can take: ${ways.join('; ')}`);
  // WHAT IT LIES ON (kit 0.14.0, #949 step 3: inspect's route.rests): each
  // ring whose sill holds it, each tray it runs along or lands on (the face,
  // its role there, and on a held face the tie slots it uses) and each body a
  // free span comes to rest on.
  const rests = (c.route?.rests ?? []).map(x => (x.kind === 'ring' ? `the sill of ${wayText({item: x.item, via: x.via}) ?? `${x.item} ${x.via}`}`
    : x.kind === 'tray' ? `${wayText({item: x.item, via: x.via}) ?? `${x.item} ${x.via}`} (${x.face ?? 'top'} face, ${x.role ?? 'resting'}`
      + `${x.ties?.length ? `, tie slots ${x.ties.join(', ')}` : ''})`
    : `${x.item}${x.part && x.part !== 'envelope' ? ` (${clip(x.part, 60)})` : ''}`));
  if (rests.length) lines.push(`Rests on: ${cutList(rests, 8)}.`);
  // Each solid body the route still passes through after its detours (kit
  // 0.11.0, #949: inspect's route.crosses): what, between which two stops,
  // and where it enters, in mm. A warning, never a refusal.
  for (const x of c.route?.crosses ?? []) {
    const stop = w => (w?.end ? `its ${w.end} end` : wayText(w) ?? 'a waypoint');
    const [a, b] = x.between ?? [];
    lines.push(`Crosses a body: ${x.item}${x.part && x.part !== 'envelope' ? ` (${clip(x.part, 60)})` : ''}` +
      ` between ${stop(a)} and ${stop(b)}${Array.isArray(x.at) ? `, entering at ${x.at.join(', ')} mm` : ''}.`);
  }
  // WHAT THE LAY FINDS (kit 0.21.0, #1007 and #1013: inspect's route.bends
  // and route.covers), each in the kit's sentence: a corner with less room
  // than the cable's bend radius, and the ports a span of it runs in front of.
  // (a pair of turns on one short leg is one sentence of up to 182 characters with the kit's own names, and
  // longer with a long label: the kit's sentence is said whole, and its advice, where it gives one, after it)
  lines.push(...bendLines(c), ...ringLines(c));
  if (c.route?.covers?.text) lines.push(`In front of other ports: ${clip(c.route.covers.text, 300)}`);
  lines.push(...spareLines(c));
  if (Array.isArray(c.spare_places)) lines.push(placesLine(c.spare_places));
  // How it was pinned by hand in a pathway, as the file has it (cable.lay).
  if (c.lay?.length) lines.push(`Laid by hand: ${cutList(c.lay.map(e => `${e.item} ${e.via}${e.face ? `, ${e.face} face` : ''}${e.position != null ? `, position ${e.position}` : ''}`), 6)}.`);
  if (c.unchecked || c.loose == null) lines.push('Its ends could not be checked, so whether they land is not known.');
  for (const l of c.loose ?? []) lines.push(`Loose: the ${l.end} end: ${l.reason}`);
  for (const m of c.mismatch ?? []) lines.push(`Mismatch: ${m}`);
  return fit(lines.join('\n'));
}

// THE ANSWER FOR A PART BESIDE THE RACK (kit 0.6.0, #926: inspect's
// `kind: 'zeroU'`): what it is, where it stands, and whether a lane runs
// through it.
export function zeroUText(z) {
  const what = [z.manufacturer, z.model].filter(Boolean).join(' ') || z.ref;
  return fit([
    `${z.id}${z.label ? ` ${clip(z.label, 60)}` : ''}: ${what} (${z.ref}), cfg ${z.cfg || 'none'}`,
    `zero-U, ${z.where ?? `at ${z.at}, bottom U${z.ru}`}${z.u ? `, runs beside ${z.u}U` : ''}${z.between ? ', serving the next rack too' : ''}.`,
    z.lane ? `The ${z.lane} cable lane runs through it.` : 'No cable lane runs through it.',
    // its duct and windows, which a route and cable.slack may name (kit 0.35.0)
    ...(pathwaysLine(z.pathways) ? [pathwaysLine(z.pathways), `A route names them as {item: ${z.id}, via}.`] : []),
    // its lamps, outlets and breakers (state.set) and its displays (display.set), as a device's are said
    ...(settableLines(z).length ? ['Lamps, digits and outlets state.set takes:', ...settableLines(z)] : []),
    ...(displayLines(z).length ? ['Displays display.set takes:', ...displayLines(z)] : []),
    'Move it with zerou.update, take it away with zerou.remove.',
  ].join('\n'));
}

// THE ANSWER FOR A BUNDLE (kit 0.7.0, #921: inspect's `kind: 'bundle'`): its
// members and where each joins and leaves, its trunk, size, straps and
// warnings. What needs the routes is said not measured, never read as a pass.
// Its bend (kit 0.8.0, #922: `bend` was null before) is the radius it needs
// and the cable that sets it; a member with no radius is named unchecked,
// never passed, and each too-tight place is in the warnings already.
const wayText = w => (w ? (w.lane ? `${w.lane} U${w.ru}` : `${w.item} ${w.via}`) : null);
export function bundleText(b) {
  const size = b.size ? `about ${Math.round(b.size.max_mm)} mm across, against ${Math.round(b.size.limit_mm)} mm` +
    `${b.size.limitBy?.text ? ` at ${clip(b.size.limitBy.text, 80)}` : ''}${b.size.estimated?.length ? ' (an estimate)' : ''}` : null;
  const every = b.straps?.every;
  const lines = [
    `${b.id} ${clip(b.name, 60)}: number ${b.number}${b.label ? `, label ${clip(b.label, 60)}` : ''}, ${b.members.length} cable${b.members.length === 1 ? '' : 's'}`,
    ...b.members.map(m => `${m.cable}${m.join ? `: joins at ${wayText(m.join) ?? m.join}` : ''}${m.leave ? `, leaves at ${wayText(m.leave) ?? m.leave}` : ''}` +
      `${m.a ? `; peels off for its a end at ${wayText(m.a)}` : ''}${m.b ? `; peels off for its b end at ${wayText(m.b)}` : ''}`),
    `route: ${b.route?.text ? clip(b.route.text, 300) : 'nowhere yet'}`,
    // by kind, as the kit counts them (0.22.0: straps().kinds); a count is not "every 12 in" unless it is the spacing straps
    `straps: ${every ? `spaced every ${every.value} ${every.unit}` : 'no spacing straps'}${b.straps?.count != null ? `; ${b.straps.count} in all` +
      `${b.straps.kinds ? ` (${b.straps.kinds.spacing} spaced, ${b.straps.kinds.breakout} where a cable joins or leaves, ${b.straps.kinds.anchor} at tray tie slots)` : ''}` : ''}`,
    b.checked ? [size ?? 'size not known', b.length?.metres != null ? `trunk ${len(b.length.metres)}` : null].filter(Boolean).join('; ')
      : (b.members.length < 2 ? 'Fewer than two cables, so it is not drawn or checked.' : 'Not checked: the routes are not known here.'),
    b.bend ? `bend: ${b.bend.radius_mm > 0 ? `radius ${Math.round(b.bend.radius_mm)} mm${b.bend.by ? `, set by ${b.bend.by}` : ''}` : 'no radius known'}` +
      `${b.bend.unchecked?.length ? `; not checked for ${b.bend.unchecked.join(', ')}` : ''}` +
      `${b.bend.violations?.length ? `; ${b.bend.violations.length} place${b.bend.violations.length === 1 ? '' : 's'} too tight` : ''}` : null,
    ...(b.gone ?? []).map(w => `Gone from its route: ${wayText(w)}.`),
    ...(b.warnings ?? []).map(w => `Warning: ${w}`),
    ...(b.notes ?? []).map(n => `Note: ${n}`),
  ];
  return fit(lines.filter(x => x != null).join('\n'));
}
