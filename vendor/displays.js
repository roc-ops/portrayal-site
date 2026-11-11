// WHAT A DISPLAY SHOWS (docs/display-content-design.md).
//
// A rack file can say what a display shows with `displays`, a map of the path
// of the display to its content, as `states` says what a part is:
//
//   {text: ['line one', 'line two']}   drawn in the display's font, cut to its
//                                      columns and rows
//   {digits: '04'}                     the digits of a segment display
//   {image: 'data:image/png;base64,...'}  a picture scaled into the window
//
// WHAT A DISPLAY IS comes from the library (`kind`, `characters`, `rows` and the
// window on an element of a contract, published on the drawing as `data-display-kind`,
// `data-characters`, `data-display-rows` and `data-display-window`, and in components.json and
// configs.json as `displays`). A display that does not say its kind is not
// listed and cannot be set: nothing here guesses a window.
//
// ONE RULE FOR BOTH HALVES. shell.js paints the 2D drawing and relief.js the
// documents the 3D scene rasterises, so the painter lives here and has no
// three in it, as fields.js does. Everything above `paintDisplays` is pure and
// reads no DOM, so the rack's rules and an agent use it under node.

export const KINDS = ['pixel', 'character', 'segment'];
// what each kind takes: a pixel screen draws anything, a character grid can
// only spell, a segment cell can only light its segments
export const TAKES = {pixel: ['text', 'image'], character: ['text'], segment: ['digits']};

// A MONOSPACE CELL, as lint estimates one: 0.62 em across and 1.25 em a line.
// The text is set with textLength off, so a font whose advance is narrower
// than this leaves a little room at the right, and one that is wider is cut by
// the window's clip. The rows and columns that are said are not the font's.
export const ADVANCE = 0.62;
export const LINE = 1.25;
export const FONT = "'DejaVu Sans Mono', 'Liberation Mono', monospace";
export const INK = '#f4f8ff';
// the share of a window left clear on each side of its text
export const INSET = 0.03;

const plain = v => !!v && typeof v === 'object' && !Array.isArray(v);
const count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const orList = names => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`);
const num = x => String(Math.round(x * 1e4) / 1e4);

// ── what the library says a display is ─────────────────────────────────────

/**
 * The displays of one part, from its published `displays`
 * ({element: {kind, characters, rows?, at, size, glyphs?}}) and the path the
 * part stands at. A pixel or a character element is a display of its own, at
 * `<part>/<element>`; the segment cells of a part are ONE display, at the path
 * of the part, whose digits are the cells from left to right. Each record:
 * {path, kind, columns, rows, window: [x, y, w, h], digits?: [{path, glyphs}]}.
 * `rows` is null for a pixel display, which has none.
 */
export function displayRecords(base, elements) {
  const out = [];
  const cells = [];
  for (const [id, e] of Object.entries(plain(elements) ? elements : {})) {
    if (!plain(e) || !KINDS.includes(e.kind) || !Array.isArray(e.at) || !Array.isArray(e.size)) continue;
    const window = [e.at[0], e.at[1], e.size[0], e.size[1]];
    if (e.kind === 'segment') { cells.push({path: `${base}/${id}`, window, glyphs: Array.isArray(e.glyphs) ? e.glyphs : []}); continue; }
    const columns = Number.isInteger(e.characters) && e.characters > 0 ? e.characters : null;
    if (!columns) continue;
    out.push({path: `${base}/${id}`, kind: e.kind, columns, rows: e.kind === 'pixel' ? null : (Number.isInteger(e.rows) && e.rows > 0 ? e.rows : 1), window});
  }
  if (cells.length) {
    cells.sort((a, b) => a.window[0] - b.window[0] || a.window[1] - b.window[1]);
    const x0 = Math.min(...cells.map(c => c.window[0])), y0 = Math.min(...cells.map(c => c.window[1]));
    const x1 = Math.max(...cells.map(c => c.window[0] + c.window[2])), y1 = Math.max(...cells.map(c => c.window[1] + c.window[3]));
    out.push({path: base, kind: 'segment', columns: cells.length, rows: 1, window: [x0, y0, x1 - x0, y1 - y0],
              digits: cells.map(c => ({path: c.path, glyphs: c.glyphs}))});
  }
  return out;
}

/** The display a drawing node is, read off its `data-*`, or null. */
export function displayOfNode(node) {
  const kind = node?.getAttribute?.('data-display-kind');
  const win = String(node?.getAttribute?.('data-display-window') || '').trim().split(/\s+/).map(Number);
  if (!KINDS.includes(kind) || win.length !== 4 || !win.every(Number.isFinite)) return null;
  const columns = Number.parseInt(node.getAttribute('data-characters') || '', 10);
  const rows = Number.parseInt(node.getAttribute('data-display-rows') || '', 10);
  return {path: node.getAttribute('data-path'), kind, window: win,
          columns: Number.isInteger(columns) && columns > 0 ? columns : null,
          rows: kind === 'pixel' ? null : (Number.isInteger(rows) && rows > 0 ? rows : 1)};
}

// ── what a rack file may say ───────────────────────────────────────────────

/** What a content says it is: 'text', 'digits' or 'image', or null when it is none of them or more than one. */
export function contentKind(content) {
  if (!plain(content)) return null;
  const keys = Object.keys(content);
  return keys.length === 1 && ['text', 'digits', 'image'].includes(keys[0]) ? keys[0] : null;
}

// the one `{text, digits, image}` check that needs no display: the shape
export function shapeRefusal(content) {
  if (!plain(content)) return 'A display shows {text: [lines]}, {digits: "04"} or {image: a data URL or a library asset}.';
  const keys = Object.keys(content);
  if (keys.length !== 1 || !['text', 'digits', 'image'].includes(keys[0]))
    return `A display shows one of text, digits or image, and ${keys.length ? `not ${keys.map(k => `"${k}"`).join(' and ')}` : 'this says none'}.`;
  const [k] = keys;
  if (k === 'text' && !(Array.isArray(content.text) && content.text.every(l => typeof l === 'string')))
    return 'The text of a display is a list of lines, each a string.';
  if (k === 'digits' && typeof content.digits !== 'string') return 'The digits of a display are a string such as "04".';
  if (k === 'image' && (typeof content.image !== 'string' || !content.image)) return 'The image of a display is a data URL or the path of a library asset.';
  return null;
}

/**
 * Can this display show this content? null when it can, else the sentence.
 * `who` names the display for the sentence ("network-module/module/lcd on PDU 1").
 */
export function contentRefusal(display, content, who = display?.path) {
  const bad = shapeRefusal(content);
  if (bad) return bad;
  const k = contentKind(content);
  const takes = TAKES[display.kind];
  if (!takes.includes(k)) {
    const sort = {pixel: 'a pixel display', character: 'a character display', segment: 'a segment display'}[display.kind];
    return `${who} is ${sort}, which takes ${orList(takes.map(t => ({text: 'text', digits: 'digits', image: 'an image'}[t])))} and not ${{text: 'text', digits: 'digits', image: 'an image'}[k]}.`;
  }
  if (k === 'digits') {
    const bad = [...content.digits].filter(c => !glyphOf(display, c));
    if (bad.length) return `${who} cannot show ${[...new Set(bad)].map(c => `"${c}"`).join(', ')}: its digits are ${glyphNames(display).join(' ')}.`;
  }
  if (k === 'image' && !isAssetPath(content.image)) {
    const got = imageInfo(content.image);
    if (got.error) return `${who}: ${got.error}`;
  }
  return null;
}

// ── digits ─────────────────────────────────────────────────────────────────

const glyphNames = display => display?.digits?.[0]?.glyphs || [];
/** The state a character lights on a digit of this display, or null when it has none. */
function glyphOf(display, ch) {
  const want = ch === ' ' ? 'blank' : ch.toLowerCase();
  const have = glyphNames(display);
  return have.includes(want) ? want : null;
}

/**
 * What a digit string lights: [{path, glyph}] one for each digit of the
 * display, the string right-aligned as a display is, so "4" on two digits
 * is a blank and a 4. Longer than the display it is cut to its leftmost
 * digits (`clipped` says how many were dropped). Characters the display has no
 * glyph for are left out of `cells` and listed in `unknown`.
 */
export function layoutDigits(display, digits) {
  const cells = display.digits || [];
  const chars = [...String(digits)];
  const kept = chars.slice(0, cells.length);
  const pad = Math.max(0, cells.length - kept.length);
  const out = [];
  const unknown = [];
  cells.forEach((cell, i) => {
    const ch = i < pad ? ' ' : kept[i - pad];
    const glyph = glyphOf(display, ch);
    if (glyph) out.push({path: cell.path, glyph}); else unknown.push(ch);
  });
  return {cells: out, clipped: Math.max(0, chars.length - cells.length), unknown};
}

// ── text ───────────────────────────────────────────────────────────────────

/**
 * Text laid out in a display: `{lines, columns, rows, fontSize, lineHeight, x, y, clippedLines, clippedColumns}`
 * in the millimetres of the part's frame. A character display has its rows and
 * columns, and the font is the biggest that fits both. A pixel display has
 * only its columns (the longest line seen on it); it sets the font by those
 * and takes as many lines as the window is tall enough for.
 */
export function layoutText(display, lines) {
  const [wx, wy, ww, wh] = display.window;
  const columns = display.columns;
  // the text keeps INSET of the window clear on each side, as a screen has its margin
  const fitWide = ww * (1 - 2 * INSET) / (columns * ADVANCE);
  const room = wh * (1 - 2 * INSET);
  let fontSize, rows;
  if (display.kind === 'pixel') {
    fontSize = fitWide;
    rows = Math.max(1, Math.floor(room / (fontSize * LINE)));
  } else {
    rows = display.rows || 1;
    fontSize = Math.min(fitWide, room / (rows * LINE));
  }
  const lineHeight = fontSize * LINE;
  const clean = lines.map(l => [...l.replace(/[\u0000-\u001f\u007f]/g, ' ')]);
  let clippedColumns = 0;
  const kept = clean.slice(0, rows).map(cs => { if (cs.length > columns) clippedColumns += 1; return cs.slice(0, columns).join(''); });
  const block = columns * fontSize * ADVANCE;
  return {lines: kept, columns, rows, fontSize, lineHeight,
          x: wx + (ww - block) / 2, y: wy + (display.kind === 'pixel' ? wh * INSET : (wh - rows * lineHeight) / 2),
          clippedLines: Math.max(0, clean.length - rows), clippedColumns};
}

// ── images ─────────────────────────────────────────────────────────────────

// A rack file is not a place for a photograph: the picture is kept in the file
// as its data URL, so it is held to a few hundred kilobytes
export const MAX_IMAGE_BYTES = 512 * 1024;
const DATA_URL = /^data:(image\/(?:svg\+xml|png|jpeg|jpg|gif))((?:;[a-z0-9=._+-]+)*?)(;base64)?,([\s\S]*)$/i;
// the path of an asset in the build: relative, plain, ending in an image type
export const ASSET_PATH = /^(?!.*\.\.)[A-Za-z0-9][A-Za-z0-9._/-]*\.(?:svg|png|jpe?g|gif)$/i;
export const isAssetPath = s => typeof s === 'string' && ASSET_PATH.test(s);

const bytesOfBase64 = text => { const bin = atob(text.replace(/\s+/g, '')); return Uint8Array.from(bin, c => c.charCodeAt(0)); };
const base64Of = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const textOf = bytes => new TextDecoder().decode(bytes);

// GIF: the first frame alone. Everything after the first image block is
// dropped, with the loop extension, so no viewer animates it, and the picture
// is not decoded: its blocks are copied as they are
function firstGifFrame(b) {
  if (b.length < 14) return null;
  let pos = 13 + ((b[10] & 0x80) ? 3 * 2 ** ((b[10] & 7) + 1) : 0);
  let gce = null;
  const skipBlocks = at => { let p = at; while (p < b.length && b[p] !== 0) p += b[p] + 1; return p + 1; };
  while (pos < b.length) {
    if (b[pos] === 0x21) {
      const end = skipBlocks(pos + 2);
      if (b[pos + 1] === 0xf9) gce = b.subarray(pos, end);
      pos = end;
    } else if (b[pos] === 0x2c) {
      let p = pos + 10;
      if (b[pos + 9] & 0x80) p += 3 * 2 ** ((b[pos + 9] & 7) + 1);
      p = skipBlocks(p + 1);
      if (p > b.length) return null;
      const head = b.subarray(0, 13 + ((b[10] & 0x80) ? 3 * 2 ** ((b[10] & 7) + 1) : 0));
      return Uint8Array.from([...head, ...(gce || []), ...b.subarray(pos, p), 0x3b]);
    } else return null;
  }
  return null;
}

function sizeOfSvg(text) {
  const tag = /<svg\b[^>]*>/i.exec(text)?.[0];
  if (!tag) return null;
  const attr = n => new RegExp(`\\s${n}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag)?.[1];
  const vb = attr('viewBox')?.trim().split(/[\s,]+/).map(Number);
  if (vb?.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0) return {w: vb[2], h: vb[3]};
  const w = /^\s*([0-9.]+)\s*(?:px|mm|cm|in|pt)?\s*$/i.exec(attr('width') || ''), h = /^\s*([0-9.]+)\s*(?:px|mm|cm|in|pt)?\s*$/i.exec(attr('height') || '');
  if (w && h && Number(w[1]) > 0 && Number(h[1]) > 0) return {w: Number(w[1]), h: Number(h[1])};
  return null;
}
function sizeOfPng(b) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < 24 || !sig.every((v, i) => b[i] === v)) return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return {w: dv.getUint32(16), h: dv.getUint32(20)};
}
function sizeOfJpeg(b) {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let p = 2;
  while (p + 9 < b.length) {
    if (b[p] !== 0xff) { p += 1; continue; }
    const m = b[p + 1];
    if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return {h: (b[p + 5] << 8) | b[p + 6], w: (b[p + 7] << 8) | b[p + 8]};
    p += 2 + ((b[p + 2] << 8) | b[p + 3]);
  }
  return null;
}
function sizeOfGif(b) {
  if (b.length < 10 || !['GIF87a', 'GIF89a'].includes(String.fromCharCode(...b.subarray(0, 6)))) return null;
  return {w: b[6] | (b[7] << 8), h: b[8] | (b[9] << 8)};
}

/**
 * What a data URL is: `{href, mime, w, h}` with the picture's own size, where
 * `href` is the URL to draw (a GIF as its first frame), or `{error}` with the
 * sentence. Sniffed from the bytes, not trusted from the type it declares.
 */
export function imageInfo(url) {
  if (isAssetPath(url)) return {error: `the library asset ${url} has not been loaded; load it first (loadDisplayImages)`};
  const m = DATA_URL.exec(String(url));
  if (!m) return {error: 'an image is a data URL of an SVG, PNG, JPEG or GIF, or the path of a library asset.'};
  if (m[4].length > MAX_IMAGE_BYTES * 1.4) return {error: `the image is over ${MAX_IMAGE_BYTES / 1024} KiB; a rack file is not the place for it.`};
  let bytes;
  try { bytes = m[3] ? bytesOfBase64(m[4]) : new TextEncoder().encode(decodeURIComponent(m[4])); } catch { return {error: 'the image data cannot be read.'}; }
  if (bytes.length > MAX_IMAGE_BYTES) return {error: `the image is over ${MAX_IMAGE_BYTES / 1024} KiB; a rack file is not the place for it.`};
  const declared = m[1].toLowerCase().replace('jpg', 'jpeg');
  const is = (mime, size) => { const s = size; return s && s.w > 0 && s.h > 0 ? {mime, ...s} : null; };
  const svg = declared === 'image/svg+xml' ? is('image/svg+xml', sizeOfSvg(textOf(bytes))) : null;
  if (declared === 'image/svg+xml') {
    if (!svg) return {error: 'the SVG has no size; give it a viewBox, or a width and a height.'};
    return {...svg, href: `data:image/svg+xml;base64,${base64Of(bytes)}`};
  }
  if (declared === 'image/png') {
    const s = is('image/png', sizeOfPng(bytes));
    return s ? {...s, href: `data:image/png;base64,${base64Of(bytes)}`} : {error: 'the PNG cannot be read.'};
  }
  if (declared === 'image/jpeg') {
    const s = is('image/jpeg', sizeOfJpeg(bytes));
    return s ? {...s, href: `data:image/jpeg;base64,${base64Of(bytes)}`} : {error: 'the JPEG cannot be read.'};
  }
  const s = is('image/gif', sizeOfGif(bytes));
  const first = s ? firstGifFrame(bytes) : null;
  return first ? {...s, href: `data:image/gif;base64,${base64Of(first)}`, firstFrame: true} : {error: 'the GIF cannot be read.'};
}

/**
 * The picture fitted into the window: the largest size with its own aspect
 * that fits, centred; `{x, y, w, h, scale, bars}` where `bars` is 'sides', 'top and bottom' or null.
 */
export function fitImage(imgW, imgH, window) {
  const [wx, wy, ww, wh] = window;
  const scale = Math.min(ww / imgW, wh / imgH);
  const w = imgW * scale, h = imgH * scale;
  const bars = Math.abs(w - ww) < 1e-6 && Math.abs(h - wh) < 1e-6 ? null : (w < ww ? 'sides' : 'top and bottom');
  return {x: wx + (ww - w) / 2, y: wy + (wh - h) / 2, w, h, scale, bars};
}

// ── what was cut or fitted, as sentences ───────────────────────────────────

/** What showing `content` on `display` changes about it, one sentence each; [] when it is shown as it is. */
export function contentNotes(display, content, who = display?.path) {
  const k = contentKind(content);
  const out = [];
  if (k === 'text' && TAKES[display.kind].includes('text')) {
    const t = layoutText(display, content.text);
    if (t.clippedLines) out.push(`${who} has ${count(t.rows, 'row')}, so ${count(t.clippedLines, 'line')} of the text ${t.clippedLines === 1 ? 'is' : 'are'} cut.`);
    if (t.clippedColumns) out.push(`${who} has ${count(t.columns, 'column')}${display.kind === 'pixel' ? ' (the longest line seen on it)' : ''}, so ${count(t.clippedColumns, 'line')} ${t.clippedColumns === 1 ? 'is' : 'are'} cut to fit.`);
  }
  if (k === 'digits' && display.kind === 'segment') {
    const d = layoutDigits(display, content.digits);
    if (d.clipped) out.push(`${who} has ${count(display.digits.length, 'digit')}, so the last ${count(d.clipped, 'digit')} of "${content.digits}" ${d.clipped === 1 ? 'is' : 'are'} cut.`);
  }
  if (k === 'image' && display.kind === 'pixel') {
    const info = imageInfo(content.image);
    if (!info.error) {
      const f = fitImage(info.w, info.h, display.window);
      if (f.bars) out.push(`The image on ${who} keeps its proportions, so it is fitted to the window with bars at the ${f.bars}.`);
      if (info.firstFrame) out.push(`The GIF on ${who} shows its first frame.`);
    }
  }
  return out;
}

// ── drawing it ─────────────────────────────────────────────────────────────

const NS = 'http://www.w3.org/2000/svg';
const MARK = 'data-portrayal-display';
let clipCount = 0;

/** Take every picture and line of text this painted out of `root`, and the glyph classes it set. */
export function unpaintDisplays(root) {
  if (!root?.querySelectorAll) return root;
  for (const n of [...root.querySelectorAll(`[${MARK}]`)]) n.remove();
  // a digit gets back the states it had before a glyph was set on it
  for (const n of root.querySelectorAll('[data-portrayal-glyph]')) {
    n.classList.remove(n.getAttribute('data-portrayal-glyph'));
    n.classList.add(...(n.getAttribute('data-portrayal-glyph-was') || '').split(/\s+/).filter(Boolean));
    n.removeAttribute('data-portrayal-glyph');
    n.removeAttribute('data-portrayal-glyph-was');
  }
  return root;
}

function drawText(node, display, content) {
  const t = layoutText(display, content.text);
  const doc = node.ownerDocument;
  const g = doc.createElementNS(NS, 'g');
  g.setAttribute(MARK, display.path);
  const [wx, wy, ww, wh] = display.window;
  const id = `portrayal-display-clip-${++clipCount}`;
  const clip = doc.createElementNS(NS, 'clipPath');
  clip.setAttribute('id', id);
  const r = doc.createElementNS(NS, 'rect');
  for (const [k, v] of [['x', wx], ['y', wy], ['width', ww], ['height', wh]]) r.setAttribute(k, num(v));
  clip.append(r);
  g.append(clip);
  const body = doc.createElementNS(NS, 'g');
  body.setAttribute('clip-path', `url(#${id})`);
  body.setAttribute('font-family', FONT);
  body.setAttribute('font-size', num(t.fontSize));
  body.setAttribute('fill', INK);
  t.lines.forEach((line, i) => {
    const text = doc.createElementNS(NS, 'text');
    text.setAttribute('x', num(t.x));
    text.setAttribute('y', num(t.y + i * t.lineHeight + t.lineHeight * 0.5 + t.fontSize * 0.35));
    text.setAttribute('xml:space', 'preserve');
    text.setAttribute('style', 'white-space:pre');
    text.textContent = line;
    body.append(text);
  });
  g.append(body);
  return g;
}

function drawImage(node, display, content) {
  const info = imageInfo(content.image);
  if (info.error) return null;
  const f = fitImage(info.w, info.h, display.window);
  const doc = node.ownerDocument;
  const g = doc.createElementNS(NS, 'g');
  g.setAttribute(MARK, display.path);
  const img = doc.createElementNS(NS, 'image');
  for (const [k, v] of [['x', f.x], ['y', f.y], ['width', f.w], ['height', f.h]]) img.setAttribute(k, num(v));
  img.setAttribute('href', info.href);
  img.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  g.append(img);
  return g;
}

/**
 * Paint `displays` ({path: content}) into a drawing: `root` is a face's `<svg>`
 * or anything that holds one. Everything this painted before is taken out
 * first, so the map is the whole truth. Text and a picture go in a group
 * placed straight after the window's node, in the frame of its part; the
 * digits of a segment display are set as the state of each cell, through the
 * `state-` class the drawing already has a rule for. A path the drawing does
 * not have, a display that cannot show what it is given, and a picture that
 * has not been loaded are skipped; `rack/displays.js` is what says so.
 * Answers {path: true} for what was drawn.
 */
export function paintDisplays(root, displays) {
  const drew = {};
  if (!root?.querySelectorAll) return drew;
  unpaintDisplays(root);
  const marked = [...root.querySelectorAll('[data-display-kind]')];
  for (const [path, content] of Object.entries(plain(displays) ? displays : {})) {
    const k = contentKind(content);
    if (!k) continue;
    if (k === 'digits') {
      const cells = marked
        .filter(n => n.getAttribute('data-display-kind') === 'segment' && n.getAttribute('data-path')?.startsWith(`${path}/`)
          && n.getAttribute('data-path').slice(path.length + 1).indexOf('/') < 0 && displayOfNode(n))
        .sort((a, b) => displayOfNode(a).window[0] - displayOfNode(b).window[0]);
      if (!cells.length || typeof content.digits !== 'string') continue;
      const glyphs = (cells[0].getAttribute('data-states') || '').split(/\s+/).filter(Boolean);
      const rec = {path, kind: 'segment', columns: cells.length, rows: 1, window: [0, 0, 0, 0],
                   digits: cells.map(n => ({path: n.getAttribute('data-path'), glyphs}))};
      if (contentRefusal(rec, content)) continue;
      const laid = layoutDigits(rec, content.digits);
      for (const c of laid.cells) {
        const n = cells.find(x => x.getAttribute('data-path') === c.path);
        const was = [...n.classList].filter(old => old.startsWith('state-'));
        n.classList.remove(...was);
        n.classList.add(`state-${c.glyph}`);
        n.setAttribute('data-portrayal-glyph', `state-${c.glyph}`);
        n.setAttribute('data-portrayal-glyph-was', was.join(' '));
      }
      drew[path] = true;
      continue;
    }
    const node = marked.find(n => n.getAttribute('data-path') === path);
    const display = displayOfNode(node);
    if (!display || !display.columns || contentRefusal(display, content)) continue;
    const g = k === 'text' ? drawText(node, display, content) : drawImage(node, display, content);
    if (!g) continue;
    node.after(g);
    drew[path] = true;
  }
  return drew;
}

// ── library assets ─────────────────────────────────────────────────────────

const MIME_OF = {svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif'};

/**
 * The same map with each library asset (`{image: 'path/in/the/build.png'}`)
 * read through `bytesOf(path)`, which answers a Uint8Array, and put in as a
 * data URL, so 3D rasterises it and 2D draws it with no further fetch. A
 * picture that cannot be read is left as it was, and its path is in `failed`.
 */
export async function loadDisplayImages(displays, bytesOf) {
  const out = {}, failed = [];
  for (const [path, content] of Object.entries(plain(displays) ? displays : {})) {
    if (contentKind(content) === 'image' && isAssetPath(content.image)) {
      try {
        const bytes = await bytesOf(content.image);
        const mime = MIME_OF[content.image.split('.').pop().toLowerCase()];
        out[path] = {image: `data:${mime};base64,${base64Of(bytes)}`};
        continue;
      } catch { failed.push(path); }
    }
    out[path] = content;
  }
  return {displays: out, failed};
}
