// WHAT AN EXPORT SAYS, as data (spec §8). Pure: no DOM, no fetch - so
// `node --test` covers every rule an export follows: file names, CSV
// quoting, the title block, which cabinet draws which device, the notes,
// and (below, Tasks 4-5) DCIM matching and the bill of materials.
// site/rack/exports.js does the fetching and drawing, and asks here.

import {uLabel} from './model.js';

export const uniq = list => [...new Set(list)];

// One stem for every file a rack exports - the one its .json already uses.
export const fileStem = name =>
  String(name ?? '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-|-$/g, '') || 'rack';

const pad = n => String(n).padStart(2, '0');
export const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// RFC 4180: a cell with a comma, a quote, a line break or an edge space is
// quoted, its quotes doubled. Nothing else is touched - a part number that
// starts with "-" is a part number, not a formula to defuse.
export const csvCell = v => {
  const s = v == null ? '' : String(v);
  return /[",\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export function toCsv(columns, rows, notes = []) {
  const line = cells => cells.map(csvCell).join(',');
  const out = [line(columns), ...rows.map(r => line(columns.map(c => r[c])))];
  if (notes.length) out.push('', line(['Notes']), ...notes.map(n => line([n])));
  return `${out.join('\r\n')}\r\n`;
}

export function holesText(frame) {
  if (frame.holes?.style !== 'tapped') return 'Square holes (cage nuts)';
  return `Tapped holes, ${frame.holes.thread || 'thread not stated'}`;
}

// The sheet's title block (spec §8): rack name, frame, depths, holes, date.
export function titleLines(rack, date) {
  const f = rack.frame;
  const kind = f.kind === 'two-post' ? 'Two-post' : 'Four-post';
  const numbering = f.numbering === 'top-down' ? 'U1 at the top' : 'U1 at the bottom';
  const depth = f.kind === 'two-post'
    ? `Usable depth ${Math.round(f.usableDepth)} mm`
    : `Rail depth ${Math.round(f.railDepth)} mm · usable depth ${Math.round(f.usableDepth)} mm`;
  return [rack.name, `${kind} frame, ${f.heightRU}U, ${numbering}`, depth, holesText(f),
          `Drawn ${isoDate(date)} with the Portrayal Rack Builder`];
}

export function wrapText(text, width) {
  const lines = [];
  let cur = '';
  for (const w of String(text).split(/\s+/).filter(Boolean)) {
    if (cur && cur.length + 1 + w.length > width) { lines.push(cur); cur = w; }
    else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) lines.push(cur);
  return lines;
}

// Notes inside an XML file (draw.io). "--" may not appear in a comment.
export function xmlComment(notes) {
  if (!notes.length) return '';
  const body = notes.map(n => `- ${n}`).join('\n').replace(/-{2,}/g, '-');
  return `<!--\nNotes from the Portrayal Rack Builder:\n${body}\n-->`;
}

// What one pane could not show of one item. `u` is the U label as the frame
// numbers it; `panel` is the device's own panel facing `pane`.
export function faceNotes({label, u, pane, panel, face}) {
  const at = `${label} at U${u}`;
  if (!face) return [`${at}: no ${panel} drawing, so the ${pane} shows an outline.`];
  const {refused = [], failed = []} = face.seat || {};
  const out = [];
  if (refused.length)
    out.push(`${at}: ${refused.join(', ')} refused the part chosen and ${refused.length === 1 ? 'is' : 'are'} shown empty.`);
  if (failed.length)
    out.push(`${at}: the part chosen for ${failed.join(', ')} couldn't be loaded, so the drawing shows what the configuration seats there.`);
  return out;
}

const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
export function rackNotes(rack) {
  const out = [];
  const z = rack.zeroU?.length || 0, c = rack.cables?.length || 0;
  if (z) out.push(`${count(z, 'zero-U item is', 'zero-U items are')} not in this export yet.`);
  if (c) out.push(`${count(c, 'cable is', 'cables are')} not in this export yet.`);
  return out;
}

// createRackScene has no fields input yet (site/rack/scene3d.js).
export function threeDNotes(rack) {
  const withFields = rack.items.filter(i => Object.keys(i.fields || {}).length).map(i => i.label);
  return withFields.length ? [`Optic labels and colors are not in the 3D model yet: ${withFields.join(', ')}.`] : [];
}

// The U a DCIM calls a device's position: the lowest-numbered U it covers,
// counted the way this frame counts.
export const positionOf = (frame, ru, u) => Math.min(uLabel(frame, ru), uLabel(frame, ru + u - 1));

// draw.io's cabinet counts from 1 at the TOP, and its `u` is the device's top U.
export const drawioU = (heightRU, ru, u) => heightRU - (ru + u - 1) + 1;

const overlaps = (a, b) => a.ru <= b.ru + b.u - 1 && b.ru <= a.ru + a.u - 1;
// ONE CABINET PER FACE. What you see from a side is what is mounted there,
// plus the far panel of anything that nothing mounted on this side covers.
// Behind a mounted device, the other side's device is hidden - two pictures
// in one U of a draw.io cabinet overlap, and the 2D pane already draws the
// mounted one on top.
export function perFaceItems(items) {
  const out = {front: [], rear: [], hidden: []};
  for (const pane of ['front', 'rear']) {
    for (const it of items) {
      if (it.face === pane) { out[pane].push(it); continue; }
      const by = items.find(o => o.face === pane && overlaps(o, it));
      if (by) out.hidden.push({item: it, pane, by});
      else out[pane].push(it);
    }
  }
  return out;
}
