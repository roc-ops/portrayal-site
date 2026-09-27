// Two element builders every page module uses. The showcase's artifact.js
// re-exports these: a tool page must not import artifact.js, which looks up
// the showcase's own elements when it loads.
export const el = (tag, attrs = {}, kids = []) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'text') n.textContent = v;
    else n.setAttribute(k, v);
  }
  for (const c of [].concat(kids)) n.append(c);
  return n;
};
export const svgEl = (tag, attrs = {}) => {
  const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};

// A client (screen) point mapped into an <svg>'s own user-space y - shared by
// drag.js (the pointer during a drag) and rack-page.js's onPaneClick (a click
// on a through panel, to find the U under it).
export const svgY = (svg, clientX, clientY) =>
  new DOMPoint(clientX, clientY).matrixTransform(svg.getScreenCTM().inverse()).y;
