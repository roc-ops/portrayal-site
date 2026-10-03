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
 * The legend panel's rows: as marks.js's strip, one per labelled mark that
 * reached something - here on any face - in document order. The swatch is the
 * ring colour, else the lamp colour; hollow when there is no ring.
 */
export function legendItems(doc, scene) {
  return ((doc && doc.marks) || []).flatMap((m, i) => {
    if (!m.label || !scene.byMark[i] || !scene.byMark[i].paths.length) return [];
    const c = hex(m.color), l = hex(m.lamp);
    return [{label: m.label, color: c || l || '#8d939a', hollow: !c}];
  });
}
