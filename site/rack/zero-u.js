// ZERO-U: PARTS BESIDE THE RACK, AND NARROW PARTS ON ONE RAIL.
// Pure: no DOM, no fetch, no page imports, so node --test reads it and the rack
// kit can take it as it is (upstream docs/vertical-cable-managers-design.md,
// point 6 and section 7 step 4: the site draws `rack-side` parts in its
// `zeroU` record). Everything here is the site's until the kit has it:
// the kit's commands, fit rules and model are used, never copied or changed.
//
// A ZERO-U ITEM lives in rack.zeroU, never in rack.items, and takes no rack
// unit:
//   {id: 'z1', ref, cfg, label, at, offsetMm, between?}
// - `at` is one of the frame's attachment points (fit.js attachPoints): `left`
//   or `right` on a two-post, `left-front` ... `right-rear` on a four-post. It
//   is also the name of the cable lane that runs beside that upright, which is
//   how a route passes through the duct (lanes through a duct, below).
// - `offsetMm` is its bottom, in mm above the bottom of the rails: the shape
//   the rack schema reserved. It is always a whole number of U here
//   (offsetOf), and `ru` is read back from it (ruOfZ).
// - `between: true` says the part stands between this rack and the next one on
//   that side, one duct serving both (the design's "beside or between racks").
//   A document holds one rack today, so it is drawn and exported as it is
//   beside this one, and says so.
//
// A NARROW RACK-FACE PART (upstream design 3.4: a chassis.width under 450 mm,
// the clear opening of a 19-inch rack) may carry `side: left | right` on its
// item. It claims its units on that face and side only; any other rack-face
// part, and a narrow one with no side, claims both sides (upstream L142).

import {RU, RAIL_W, OPENING} from '../../vendor/rack/rails.js';
import {attachPoints, fits, isRackFace} from '../../vendor/rack/fit.js';
import {nextId, withItem, uLabel, positionOf} from '../../vendor/rack/model.js';
import {apply as applyKit, COMMANDS} from '../../vendor/rack/commands.js';
import {validate, same} from '../../vendor/rack/validate.js';
import {laneX, DIAMETERS, FILL_LIMIT} from '../../vendor/rack/route.js';

export const isRackSide = c => c?.mount === 'rack-side';
export const NARROW_MM = 450;
export const isNarrowFace = c => isRackFace(c) && Number(c?.w) > 0 && Number(c.w) < NARROW_MM;
// The gap between the duct and the upright: no source dimensions it (upstream
// gaps.json, `bracket-stand-off`), so the duct is drawn against the upright.
export const STANDOFF = 0;

const no = reason => ({ok: false, reason});
const OK = {ok: true};
const mm = x => Math.round(x);
const list = rack => (Array.isArray(rack?.zeroU) ? rack.zeroU : []);
// The entries this page can place and draw: an object with a ref, an id and an
// attachment point. Anything else in the record is kept as written and left alone.
export const zeroUOf = rack => list(rack).filter(z => z && typeof z === 'object' && !Array.isArray(z)
  && typeof z.ref === 'string' && z.ref && typeof z.id === 'string' && z.id && typeof z.at === 'string');
export const zeroUById = (rack, id) => zeroUOf(rack).find(z => z.id === id) ?? null;
export const offsetOf = ru => Math.round((ru - 1) * RU * 100) / 100;
export const ruOfZ = z => Math.max(1, Math.round((Number(z.offsetMm) || 0) / RU) + 1);
export const heightOfZ = (z, chassisOf) => Math.max(1, chassisOf(z.ref)?.ru ?? 1);
export const zSpan = (z, chassisOf) => { const lo = ruOfZ(z); return [lo, lo + heightOfZ(z, chassisOf) - 1]; };
export const sideOfAt = at => (String(at).startsWith('right') ? 'right' : 'left');
// The face an attachment point is on: a four-post's front or rear upright, or
// null on a two-post, whose one pair of uprights both panes see.
export const faceOfAt = at => (/-(front|rear)$/.exec(String(at))?.[1] ?? null);
const nameOf = (z, chassisOf) => z.label || chassisOf(z.ref)?.model || z.ref;
const uSpanText = (frame, lo, hi) => {
  const [a, b] = [uLabel(frame, lo), uLabel(frame, hi)].sort((x, y) => x - y);
  return a === b ? `U${a}` : `U${a}-U${b}`;
};
export const whereText = (rack, z, chassisOf) => {
  const [lo, hi] = zSpan(z, chassisOf);
  return `${z.between ? 'between racks' : 'beside the rack'} at ${z.at}, ${uSpanText(rack.frame, lo, hi)}`;
};

// ── fit ───────────────────────────────────────────────────────────────────
// A RACK-SIDE PART: on an attachment point of this frame, within the rack's
// height by its stated `ru` (not its drawn height: the 45U ducts are drawn
// 2108 mm, a little over 45U, as their covers are), and never overlapping
// another zero-U part on the same attachment point (upstream L154).
export function fitsZeroUSide(rack, cand, chassisOf, {ignoreId = null} = {}) {
  const f = rack.frame, c = chassisOf(cand.ref);
  if (!c) return no(`No size is known for ${cand.ref}.`);
  if (!isRackSide(c)) return no(`${c.model ?? cand.ref} is not a rack-side part: only a part that stands beside the rack goes there.`);
  const points = attachPoints(f.kind);
  if (!points.includes(cand.at)) return no(`${cand.at} is not a side of a ${f.kind} frame: use ${points.join(', ')}.`);
  if (!Number.isInteger(cand.ru) || cand.ru < 1) return no('Below U1.');
  const u = Math.max(1, c.ru ?? 1), top = cand.ru + u - 1;
  if (cand.ru > f.heightRU) return no(`U${cand.ru} is past the top of this ${f.heightRU}U rack.`);
  if (top > f.heightRU)
    return no(`${u}U tall; ${f.heightRU - cand.ru + 1}U from U${uLabel(f, cand.ru)} to the top of this ${f.heightRU}U rack.`);
  for (const o of zeroUOf(rack)) {
    if (o.id === ignoreId || o.at !== cand.at) continue;
    const [lo, hi] = zSpan(o, chassisOf);
    if (cand.ru <= hi && lo <= top) return no(`Overlaps ${nameOf(o, chassisOf)} at ${o.at}.`);
  }
  return OK;
}

// A NARROW PART ON ONE SIDE: the kit's own rack-face rules, judged in the rack
// as this side sees it - a narrow part on the other side of the same face is
// not there - and on every unit the part spans, not only its bottom one.
const sideOf = (it, chassisOf) => (isNarrowFace(chassisOf(it.ref)) && (it.side === 'left' || it.side === 'right') ? it.side : null);
export const sidedItem = (rack, id, chassisOf) => {
  const it = rack.items.find(i => i.id === id);
  return it && sideOf(it, chassisOf) ? it : null;
};
export function fitsSided(rack, cand, chassisOf, {ignoreId = null} = {}) {
  const c = chassisOf(cand.ref);
  if (!c) return no(`No size is known for ${cand.ref}.`);
  if (cand.side != null && !isNarrowFace(c))
    return no(`${c.model ?? cand.ref} spans the opening, so it has no side.`);
  const seen = cand.side == null ? rack : {...rack, items: rack.items.filter(o =>
    !(o.face === cand.face && sideOf(o, chassisOf) && sideOf(o, chassisOf) !== cand.side))};
  const u = isRackFace(c) ? Math.max(1, c.ru ?? 1) : 1;
  for (let k = 0; k < u; k++) {
    const r = fits(seen, {ref: cand.ref, face: cand.face, ru: cand.ru + k}, chassisOf, {ignoreId});
    if (!r.ok) return r;
  }
  return OK;
}
// Any item, as the summary checks it: a narrow part on a side by its side.
export const fitsItem = (rack, it, chassisOf) => (sideOf(it, chassisOf)
  ? fitsSided(rack, {ref: it.ref, face: it.face, ru: it.ru, side: it.side}, chassisOf, {ignoreId: it.id})
  : fits(rack, {ref: it.ref, ru: it.ru, face: it.face, ...(it.on ? {on: it.on, unit: it.unit} : {})}, chassisOf, {ignoreId: it.id}));

// ── lanes through a duct ──────────────────────────────────────────────────
// The lane beside an upright runs through the duct standing there: a lane
// waypoint at a U the duct spans is in its channel, at its centre line. The
// route itself is the kit's ({lane, ru}); only where the lane IS changes.
export function ductOnLane(rack, lane, ru, chassisOf) {
  return zeroUOf(rack).find(z => z.at === lane && isRackSide(chassisOf(z.ref))
    && ru >= zSpan(z, chassisOf)[0] && ru <= zSpan(z, chassisOf)[1]) ?? null;
}
// The duct's centre line, in rack x (mm from the centre line, right as seen from the front).
export function zeroUX(z, chassisOf) {
  const w = Number(chassisOf(z.ref)?.w) || 0, s = sideOfAt(z.at) === 'left' ? -1 : 1;
  return s * (OPENING / 2 + RAIL_W + STANDOFF + w / 2);
}
// Where a lane waypoint is across the rack: the duct's centre when one stands
// there, else the kit's lane, in the middle of the gutter.
export function laneXAt(rack, lane, ru, chassisOf) {
  const z = chassisOf ? ductOnLane(rack, lane, ru, chassisOf) : null;
  return z ? zeroUX(z, chassisOf) : laneX(sideOfAt(lane));
}

// ── fill ──────────────────────────────────────────────────────────────────
// A duct's fill: every cable whose route runs on its lane through a U it spans,
// counted once, against FILL_LIMIT of its channel (`apertureOf(z)` -> {w, h}
// mm, or null when the drawing does not say), and against its stated capacity.
// Warn, never refuse (piece 2's D4). The entries have route.js fill()'s shape,
// with the zero-U item's id as `item`, so the notes word them the same way.
const UNSET_D = 6.0;
const areaOf = media => Math.PI * ((DIAMETERS[media] ?? UNSET_D) / 2) ** 2;
export function zeroUFill(rack, routes, chassisOf, apertureOf = () => null) {
  const fill = [], over = [];
  for (const z of zeroUOf(rack)) {
    const c = chassisOf(z.ref);
    if (!isRackSide(c)) continue;
    const [lo, hi] = zSpan(z, chassisOf);
    const through = [];
    for (const cable of rack.cables || []) {
      const ws = (routes?.get(cable.id)?.waypoints || []);
      const on = ws.map((w, k) => [w, k]).filter(([w]) => w.lane === z.at);
      const hits = on.some(([w, k]) => {
        if (w.ru >= lo && w.ru <= hi) return true;
        const nx = ws[k + 1];
        return nx?.lane === z.at && Math.min(w.ru, nx.ru) <= hi && Math.max(w.ru, nx.ru) >= lo;
      });
      if (hits) through.push(cable);
    }
    if (!through.length) continue;
    const via = c.guides?.front?.[0] ?? c.guides?.rear?.[0] ?? 'duct';
    const ap = apertureOf(z);
    if (ap?.w > 0 && ap?.h > 0) {
      const area = through.reduce((a, x) => a + areaOf(x.media), 0);
      const percent = Math.round(area / (FILL_LIMIT * ap.w * ap.h) * 100);
      fill.push({item: z.id, via, count: through.length, percent, over: percent > 100, cables: through.map(x => x.id), zeroU: true});
    }
    const cap = c.capacity?.count;
    if (cap && through.length > cap) over.push({item: z.id, count: through.length, capacity: cap});
  }
  return {fill, over};
}

// ── the commands ─────────────────────────────────────────────────────────
// Run as the kit's are (commands.js): pure, the rack and {chassisOf} in, a new
// rack out, or {error: sentence}; one that changes nothing hands back the rack
// it was given.
export const ZERO_GONE = 'That part is no longer beside the rack.';
const done = (rack, summary, extra = {}) => ({rack, summary, findings: [], ...extra});
const unchanged = rack => done(rack, '');
const withZeroU = (rack, zs) => ({...rack, zeroU: zs});

function zPlace(rack, {ref, cfg, at, ru, between = false, label}, {chassisOf}) {
  const f = fitsZeroUSide(rack, {ref, at, ru}, chassisOf);
  if (!f.ok) return {error: f.reason};
  const c = chassisOf(ref);
  const id = nextId(list(rack).filter(z => z && typeof z.id === 'string'), 'z');
  const z = {id, ref, cfg: cfg ?? c?.default ?? '', label: label ?? c?.model ?? ref, at, offsetMm: offsetOf(ru),
             ...(between ? {between: true} : {})};
  const next = withZeroU(rack, [...list(rack), z]);
  return done(next, `Placed ${z.label} ${whereText(next, z, chassisOf)}.`, {created: {id}});
}

function zUpdate(rack, {id, at, ru, between, label}, {chassisOf}) {
  const z = zeroUById(rack, id);
  if (!z) return {error: ZERO_GONE};
  const want = {at: at ?? z.at, ru: ru ?? ruOfZ(z)};
  const f = fitsZeroUSide(rack, {ref: z.ref, ...want}, chassisOf, {ignoreId: id});
  if (!f.ok) return {error: f.reason};
  const {between: _b, ...rest} = z;
  const was = !!z.between, now = between == null ? was : !!between;
  const next = {...rest, at: want.at, offsetMm: offsetOf(want.ru),
                ...(label != null ? {label: String(label).trim() || chassisOf(z.ref)?.model || z.ref} : {}),
                ...(now ? {between: true} : {})};
  if (same(next, z)) return unchanged(rack);
  const out = withZeroU(rack, list(rack).map(o => (o === z ? next : o)));
  return done(out, `Moved ${next.label} to ${whereText(out, next, chassisOf)}.`);
}

function zRemove(rack, {id}, {chassisOf}) {
  const z = zeroUById(rack, id);
  if (!z) return {error: ZERO_GONE};
  return done(withZeroU(rack, list(rack).filter(o => o !== z)), `Removed ${nameOf(z, chassisOf)} from beside the rack.`);
}

const GONE_ITEM = 'That device is no longer in the rack.';
const at = (rack, it, chassisOf) => `U${positionOf(rack.frame, it.ru, Math.max(1, chassisOf(it.ref)?.ru ?? 1))}`;
function sidePlace(rack, {ref, cfg, face, ru, side, label}, {chassisOf}) {
  const f = fitsSided(rack, {ref, face, ru, side}, chassisOf);
  if (!f.ok) return {error: f.reason};
  const c = chassisOf(ref);
  const name = label ?? c?.model ?? ref;
  const {rack: next, item} = withItem(rack, {ref, cfg: cfg ?? c?.default ?? '', face, ru, label: name});
  const out = {...next, items: next.items.map(i => (i.id === item.id ? {...i, side} : i))};
  return done(out, `Placed ${name} at ${at(out, item, chassisOf)} on the ${item.face}, on the ${side} rail.`, {created: {id: item.id}});
}
function sideSet(rack, {id, side}, {chassisOf}) {
  const it = rack.items.find(i => i.id === id);
  if (!it) return {error: GONE_ITEM};
  const want = side ?? null;
  if ((it.side ?? null) === want) return unchanged(rack);
  // A narrow part goes on its own (it is not over a device): `on` would put it across the host.
  const f = fitsSided(rack, {ref: it.ref, face: it.face, ru: it.ru, side: want ?? undefined}, chassisOf, {ignoreId: id});
  if (!f.ok) return {error: f.reason};
  const {side: _s, ...kept} = it;
  const {on: _o, unit: _u, ...bare} = kept;
  const next = want ? {...bare, side: want} : kept;
  const out = {...rack, items: rack.items.map(i => (i.id === id ? next : i))};
  return done(out, want ? `Put ${it.label} on the ${want} rail.` : `Put ${it.label} across both rails.`);
}
// The kit's move would judge a narrow part as if it took both sides.
function sideMove(rack, {id, ru, face}, {chassisOf}) {
  const it = rack.items.find(i => i.id === id);
  if (!it) return {error: GONE_ITEM};
  const want = {ru: ru ?? it.ru, face: face ?? it.face};
  if (want.ru === it.ru && want.face === it.face) return unchanged(rack);
  if (want.ru > rack.frame.heightRU) return {error: `U${want.ru} is past the top of this ${rack.frame.heightRU}U rack.`};
  const f = fitsSided(rack, {ref: it.ref, ...want, side: it.side}, chassisOf, {ignoreId: id});
  if (!f.ok) return {error: f.reason};
  const out = {...rack, items: rack.items.map(i => (i.id === id ? {...i, ...want} : i))};
  return done(out, `Moved ${it.label} to ${at(out, {...it, ...want}, chassisOf)} on the ${want.face}.`);
}

const RACK = {type: 'string', description: 'The id of the rack to edit. Only the first rack can be edited today.'};
const AS = {type: 'string', minLength: 1, description: 'A name for what this creates; later commands in the same batch can use "@name" as its id.'};
const ID = what => ({type: 'string', minLength: 1, description: `The id of the ${what}, as describe() lists it, or "@name" from earlier in this batch.`});
const AT = {type: 'string', minLength: 1, description: 'Which upright it stands beside: left or right on a two-post frame; left-front, right-front, left-rear or right-rear on a four-post. The cable lane of the same name runs through it.'};
const RU_ARG = {type: 'integer', minimum: 1, description: 'The U its bottom sits level with, counted from 1 at the bottom of the rails.'};
const BETWEEN = {type: 'boolean', description: 'true when it stands between this rack and the next one, serving both.'};
const SIDE = {enum: ['left', 'right'], description: 'Which rail it is on, as seen from its face.'};
const args = (required, properties) => ({type: 'object', required, additionalProperties: false,
                                         properties: {...properties, rack: RACK}});

export const ZERO_U_COMMANDS = {
  'zerou.place': {run: zPlace, description: 'Stand a rack-side part (a vertical cable manager) beside the rack at an upright, its bottom level with a U. It takes no rack unit. Refused, with the reason, when it does not fit.',
    args: args(['ref', 'at', 'ru'], {ref: {type: 'string', minLength: 1, description: 'The part, as catalog() lists it (its ref); its mount is rack-side.'},
      cfg: {type: 'string', description: "Which of the part's configurations; its default when left out."},
      at: AT, ru: RU_ARG, between: BETWEEN, label: {type: 'string', description: 'The name shown on the drawing; its model when left out.'}, as: AS})},
  'zerou.update': {run: zUpdate, description: 'Move a part beside the rack to another upright or U, say whether it stands between racks, or rename it.',
    args: args(['id'], {id: ID('part beside the rack'), at: AT, ru: RU_ARG, between: BETWEEN, label: {type: 'string', description: 'The name shown on the drawing.'}})},
  'zerou.remove': {run: zRemove, description: 'Take a part away from beside the rack.',
    args: args(['id'], {id: ID('part beside the rack')})},
  'side.place': {run: sidePlace, description: 'Put a narrow rail part (a finger bracket under 450 mm wide) on one rail, its bottom at a U. It takes that side only, so another can stand on the other rail at the same U.',
    args: args(['ref', 'face', 'ru', 'side'], {ref: {type: 'string', minLength: 1, description: 'The part, as catalog() lists it (its ref).'},
      cfg: {type: 'string', description: "Which of the part's configurations; its default when left out."},
      face: {enum: ['front', 'rear'], description: 'Which face of the rack: front or rear.'}, ru: RU_ARG, side: SIDE,
      label: {type: 'string', description: 'The name shown on the drawing; its model when left out.'}, as: AS})},
  'side.set': {run: sideSet, description: 'Put a narrow rail part on the left or right rail, or (side null) across both.',
    args: args(['id', 'side'], {id: ID('rail part'), side: {enum: ['left', 'right', null], description: 'left, right, or null for across both rails.'}})},
};
export const SITE_COMMANDS = ZERO_U_COMMANDS;
export const ALL_COMMANDS = {...COMMANDS, ...ZERO_U_COMMANDS};

// ── one batch, kit and site commands together ────────────────────────────
// Does this batch need the site's own commands? A batch that does not is the
// kit's, untouched. A kit `place` of a rack-side part is refused here (the kit
// would put it on the rails), and a kit `move` of a part on one rail is the
// site's (the kit would judge it as taking both).
const isSite = op => typeof op === 'string' && Object.hasOwn(ZERO_U_COMMANDS, op);
export function needsSite(rack, cmds, chassisOf) {
  return (Array.isArray(cmds) ? cmds : [cmds]).some(c => isSite(c?.op)
    || (c?.op === 'place' && isRackSide(chassisOf(c.ref)))
    || (c?.op === 'move' && typeof c.id === 'string' && !c.id.startsWith('@') && sidedItem(rack, c.id, chassisOf)));
}

const typeWord = s => (s.enum ? `one of ${s.enum.filter(v => v !== null && v !== '').join(', ')}`
  : ({integer: 'a whole number', string: 'some text', boolean: 'true or false', object: 'an object', array: 'a list'})[[].concat(s.type ?? []).find(x => x !== 'null')] || 'a value');
function sentence(op, e) {
  if (e.keyword === 'required') return `${op} needs ${[...e.path, e.missing].join('.')}, ${typeWord(e.schema.properties?.[e.missing] || {})}.`;
  if (e.keyword === 'additionalProperties') return `${op} does not take ${e.path.join('.')}.`;
  return `${op} needs ${e.path.join('.')}, ${typeWord(e.schema)}.`;
}

// The kit's apply, command by command, with the site's commands among them:
// the same answer ({rack, summary, findings, created, noop, step} or
// {error, index}), and "@name" binds across both.
export function applySite(rack, cmds, ctx) {
  const all = Array.isArray(cmds) ? cmds : [cmds];
  const seen = new Set();
  for (const [index, c] of all.entries()) {
    if (c?.as == null) continue;
    if (seen.has(c.as)) return {error: `Two commands in this batch are called ${c.as}.`, index};
    seen.add(c.as);
  }
  const bound = new Map(), created = {}, ids = [], summaries = [], findings = [];
  const swap = v => {
    if (typeof v !== 'string' || !v.startsWith('@')) return {v};
    return bound.has(v.slice(1)) ? {v: bound.get(v.slice(1))} : {error: `Nothing earlier in this batch is called ${v.slice(1)}.`};
  };
  let cur = rack, step = false;
  for (const [index, raw] of all.entries()) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || typeof raw.op !== 'string')
      return {error: 'A command is an object with an op.', index};
    const {as, ...cmd} = raw;
    for (const k of ['id']) if (k in cmd) { const s = swap(cmd[k]); if (s.error) return {error: s.error, index}; cmd[k] = s.v; }
    for (const k of ['a', 'b']) if (cmd[k]?.item != null) {
      const s = swap(cmd[k].item); if (s.error) return {error: s.error, index}; cmd[k] = {...cmd[k], item: s.v};
    }
    let res;
    if (isSite(cmd.op)) {
      const def = ZERO_U_COMMANDS[cmd.op], {op, ...given} = cmd;
      const bad = validate(def.args, as == null ? given : {...given, as})[0];
      if (bad) return {error: sentence(op, bad), index};
      if (given.rack != null && given.rack !== rack.id) return {error: `Only rack ${rack.id} can be edited here.`, index};
      const {rack: _which, ...a} = given;
      res = def.run(cur, a, ctx);
      if (res.error) return {error: res.error, index};
      res = {...res, step: res.rack !== cur};
    } else if (cmd.op === 'place' && isRackSide(ctx.chassisOf(cmd.ref))) {
      const c = ctx.chassisOf(cmd.ref);
      return {error: `${c.model ?? cmd.ref} stands beside the rack, not on its rails: place it with zerou.place.`, index};
    } else if (cmd.op === 'move' && sidedItem(cur, cmd.id, ctx.chassisOf)) {
      const {op: _op, rack: _which, ...a} = cmd;
      res = sideMove(cur, a, ctx);
      if (res.error) return {error: res.error, index};
      res = {...res, step: res.rack !== cur};
    } else {
      const k = applyKit(cur, [cmd], ctx);
      if (k.error) return {error: k.error, index};
      res = {rack: k.rack, summary: k.summary, findings: k.findings, created: k.created?.ids?.length ? {id: k.created.ids[0]} : null, step: k.step};
    }
    if (res.step && res.summary) summaries.push(res.summary);
    step = step || !!res.step;
    findings.push(...(res.findings || []));
    if (res.created) {
      ids.push(res.created.id);
      if (as != null) { bound.set(as, res.created.id); created[as] = res.created.id; }
    }
    cur = res.rack;
  }
  return {rack: cur, summary: summaries.join(' '), findings, created: {...created, ids}, noop: cur === rack, step};
}

// THE EDITOR, WITH THE SITE'S COMMANDS. The kit's editor (editor.js) knows
// only its own table, so a batch that needs the site's runs through
// applySite and lands as one undo step through the editor's whole-rack step.
// Every other batch is the kit's, untouched. Findings of such a batch are
// handed back to the caller (the page shows them); the editor's change event
// carries none.
export function withZeroUEditor(ed, {chassisOf}) {
  const ctx = {chassisOf};
  const out = Object.create(ed);
  out.apply = (cmds, opts = {}) => {
    if (!needsSite(ed.rack(), cmds, chassisOf)) return ed.apply(cmds, opts);
    const origin = opts.origin ?? 'ui';
    const all = Array.isArray(cmds) ? cmds : [cmds];
    if (origin !== 'system') {
      const index = all.findIndex(c => typeof c?.op === 'string' && Object.hasOwn(COMMANDS, c.op) && COMMANDS[c.op].system);
      if (index >= 0) return {error: `${all[index].op} is the page's own command.`, index};
    }
    const res = applySite(ed.rack(), all, ctx);
    if (res.error || res.noop) return res;
    ed.replaceRack(res.rack, res.summary || 'Changed the rack.', origin);
    return res;
  };
  out.preview = cmds => (needsSite(ed.rack(), cmds, chassisOf) ? applySite(ed.rack(), cmds, ctx) : ed.preview(cmds));
  return out;
}

// ── reading a file ────────────────────────────────────────────────────────
// The kit's reader (model.js parseDoc) keeps `zeroU` as written but rebuilds
// each item from the fields it knows, so an item's `side` would be lost on
// every load. This puts it back from the file as written (items keep their
// order there), and gives a zero-U entry with no id one, as the reader does
// for items. Anything else stays as the reader made it.
export function keepSiteFields(raw, doc) {
  let d = raw;
  try { d = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return doc; }
  const racks = doc.racks.map((r, k) => {
    const src = Array.isArray(d?.racks?.[k]?.items) ? d.racks[k].items : [];
    const items = r.items.map((it, n) => {
      const side = src[n]?.side;
      return side === 'left' || side === 'right' ? {...it, side} : it;
    });
    const taken = list(r).filter(z => z && typeof z.id === 'string' && z.id);
    const seen = new Set();
    const zeroU = list(r).map(z => {
      if (!z || typeof z !== 'object' || Array.isArray(z)) return z;
      if (typeof z.id === 'string' && z.id && !seen.has(z.id)) { seen.add(z.id); return z; }
      const id = nextId([...taken, ...[...seen].map(x => ({id: x}))], 'z');
      seen.add(id);
      return {...z, id};
    });
    return {...r, items, zeroU};
  });
  return {...doc, racks};
}

// What a rack holds beside it, as a line each: what describe() leaves out.
export function zeroULines(rack, chassisOf) {
  return zeroUOf(rack).map(z => {
    const c = chassisOf(z.ref);
    return `${z.id} | ${z.label} | ${[c?.manufacturer, c?.model].filter(Boolean).join(' ') || z.ref} | ${whereText(rack, z, chassisOf)}`;
  });
}

