// The drawing is the API. A compiled face is an ordinary SVG: every part carries
// a stable data-path, and a lamp takes its color from a state class the drawing
// already styles. No kit needed - fetch, insert, query.
const DIST = 'assets/dist/';  // wherever you host the compiled files

export async function run(host) {
  const text = await fetch(`${DIST}s9600-72xc.front.svg`).then(r => r.text());
  host.insertAdjacentHTML('beforeend', text);
  const svg = host.querySelector('svg');

  // Find a port by its path, and light its lamp. `state-on` is one of the
  // states this lamp declares (data-states="off on"); the drawing paints it.
  const port = svg.querySelector('[data-path="port-12"]');
  svg.querySelector('[data-path="led-port-12/lamp"]').classList.add('state-on');

  // Any part tells you what it is when clicked: its data-path.
  const out = document.createElement('output');
  out.textContent = 'Click a port.';
  host.append(out);
  svg.addEventListener('click', ev => {
    const part = ev.target.closest('[data-path]');
    if (part) out.textContent = part.dataset.path;
  });

  return {lit: [port.dataset.path]};
}
