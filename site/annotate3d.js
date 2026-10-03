// WHAT AN ANNOTATION SAYS, IN THE SCENE'S TERMS. Annotate's document marks
// parts with CSS selectors against a drawing; the 3D viewer takes paths. This
// resolves every mark against EVERY face the shell holds - a mark on the rear
// PSUs is a mark in 3D even while the front is the drawing on the other tab -
// and returns what the viewer's setMarks, setLampColors and setStates take.
// Pure: faces in, plain objects out, no viewer and no page.

import { match } from '../vendor/marks.js';

// The same rules as marks.js: a colour reaches a CSS value slot, so hex only;
// a state is a class name, so a token.
const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const STATE_RE = /^[a-z0-9-]+$/;
const hex = v => (typeof v === 'string' && HEX_RE.test(v) ? v.toLowerCase() : '');

// A selector that matches a group and its children marks the part once.
function outermost(els) {
  const set = new Set(els);
  return els.filter(e => {
    for (let p = e.parentNode; p && p.nodeType === 1; p = p.parentNode) if (set.has(p)) return false;
    return true;
  });
}

/**
 * @param doc    a marks document ({marks: [{select, color, lamp, state, label}]})
 * @param faces  {view: svgRoot}, every face the shell holds
 * @returns {{marks: {path, color}[], lamps: Object, states: Object,
 *            byMark: {paths: string[], error: string|null}[]}}
 */
export function docToScene(doc, faces) {
  const colour = new Map(), lamps = {}, states = {}, byMark = [];
  for (const m of (doc && doc.marks) || []) {
    const paths = new Set();
    let error = null;
    for (const root of Object.values(faces || {})) {
      if (!root) continue;
      let r;
      try { r = match(root, m); } catch (e) { r = {els: [], error: String(e.message || e)}; }
      if (r.error) { error = r.error; continue; }
      for (const el of outermost(r.els)) if (el.dataset && el.dataset.path) paths.add(el.dataset.path);
    }
    // LATER MARKS WIN, as later rings paint over earlier ones in 2D.
    const c = hex(m.color), l = hex(m.lamp);
    const st = typeof m.state === 'string' && STATE_RE.test(m.state) ? `state-${m.state}` : '';
    for (const p of paths) {
      if (c) { colour.delete(p); colour.set(p, c); }
      if (l) lamps[p] = l;
      // A STATE REPLACES, as marks.apply removes an element's state-* classes
      // before adding the mark's.
      if (st) states[p] = st;
    }
    byMark.push({paths: [...paths], error});
  }
  return {marks: [...colour].map(([path, color]) => ({path, color})), lamps, states, byMark};
}

/**
 * The legend panel's rows: as marks.js's strip, one per labelled mark, in
 * document order. The swatch is the ring colour, else the lamp colour, else the
 * colour the mark's state paints; hollow when there is no ring.
 *
 * WHAT A STATE PAINTS IS THE DRAWING'S TO SAY (#95). marks.js reads it off the
 * live drawing - the lamp's computed --led-color, or a probe carrying the
 * state's class - and that needs a document, which this module does not have.
 * So the page hands in `colorOf(mark)`, and whatever it returns is held to the
 * hex rule before it is used: it lands in a style attribute.
 *
 * ONE DIFFERENCE FROM THE 2D STRIP, kept on purpose: a row needs the mark to
 * have reached a part the SCENE can place - a path, on any face. The strip
 * lists a mark that matched anything in the drawing; a legend is a key to what
 * is beside it, and a row for a mark the scene cannot show would claim a
 * highlight the reader cannot see.
 */
export function legendItems(doc, scene, colorOf = null) {
  return ((doc && doc.marks) || []).flatMap((m, i) => {
    if (!m.label || !scene.byMark[i] || !scene.byMark[i].paths.length) return [];
    const c = hex(m.color), l = hex(m.lamp);
    const st = !c && !l && m.state && colorOf ? hex(colorOf(m)) : '';
    return [{label: m.label, color: c || l || st || '#8d939a', hollow: !c}];
  });
}
