// SAVING A DRAWING, for any page. `standalone` and `save` lived in the
// showcase's artifact.js, which looks up the showcase's own elements when it
// loads - so a tool page (the Rack Builder) could not use them. They are
// here now, with no DOM lookups at load; artifact.js re-exports them, so the
// showcase's imports are unchanged.

export function save(data, filename, type) {
  const url = URL.createObjectURL(new Blob([data], {type}));
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// A standalone copy of what is on screen.
//
// The compiled drawing already carries its own <style> and its own semantics, so
// the export keeps every id and data-path - the file you get out is as
// addressable as the one on the page. What does NOT travel is this site's own
// CSS: overlay callouts and rack rails are styled by site.css and painted from
// --pt-* tokens that mean nothing outside this document. Those get their
// computed values written back as presentation attributes.
//
// Deliberately narrow: only attributes naming a --pt- token and only elements
// with our own classes are touched. Resolving every element would multiply the
// file size, and the compiled stylesheet's own custom properties - --led-color
// and the rest - must be left alone or a lit LED exports unlit.
//
// Nor does the page's UI. spoke-host.js's wireDevices makes each device on a
// 2D elevation a button - tabindex, role, aria-label, the pt-device class and
// a hover <title> - and marks all of it with data-pt-ui: on an element, the
// attribute names (and `.class`es) it added; on a node it added, "*". Those
// come off the clone here, the class BEFORE the baking pass below (pt-device
// would otherwise match its /pt-/ test and bake computed paint onto every
// device group), the nodes after it, so the two lists stay index-aligned.
//
// NOR THE VISITOR'S VIEW OF IT. panZoom works by rewriting the live viewBox
// and sets touch-action and cursor inline; a copy of those is whatever crop
// the visitor last zoomed to, under a title that promises the whole drawing.
// So the clone - never the live node - gets back the base frame panZoom
// recorded, and loses panZoom's inline style.
export function standalone(node) {
  const clone = node.cloneNode(true);
  const base = node.__ptBase?.();
  if (base) clone.setAttribute('viewBox', base.join(' '));
  clone.style?.removeProperty('touch-action');
  clone.style?.removeProperty('cursor');
  if (clone.getAttribute('style')?.trim() === '') clone.removeAttribute('style');
  const orig = [node, ...node.querySelectorAll('*')];
  const copy = [clone, ...clone.querySelectorAll('*')];
  for (const ce of copy) {
    const ui = ce.getAttribute?.('data-pt-ui');
    if (ui == null || ui === '*') continue;
    for (const t of ui.split(/\s+/).filter(Boolean)) {
      if (t.startsWith('.')) ce.classList.remove(t.slice(1));
      else ce.removeAttribute(t);
    }
    if (ce.getAttribute('class') === '') ce.removeAttribute('class');
    ce.removeAttribute('data-pt-ui');
  }
  const PROPS = ['fill', 'stroke', 'stroke-width', 'stroke-linejoin', 'stroke-linecap',
                 'opacity', 'font-family', 'font-size', 'font-weight', 'paint-order'];
  for (let i = 0; i < orig.length; i++) {
    const oe = orig[i], ce = copy[i];
    if (!ce.getAttribute) continue;
    const ours = /\b(pt|dim)-/.test(ce.getAttribute('class') || '');
    const tokened = [...ce.attributes].some(a => a.value.includes('var(--pt-'));
    if (!ours && !tokened) continue;
    const cs = getComputedStyle(oe);
    for (const prop of PROPS) {
      const v = cs.getPropertyValue(prop);
      if (v) ce.setAttribute(prop, v.trim());
    }
  }
  clone.querySelectorAll('[data-pt-ui="*"]').forEach(n => n.remove());
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
         new XMLSerializer().serializeToString(clone);
}

export const saveSvg = (node, filename) => save(standalone(node), filename, 'image/svg+xml');
