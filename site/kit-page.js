// The kit page's runner. Each <figure class="kit-ex" data-example="NN-name">
// shows site/kit-examples/NN-name.js and runs that same module into its pane,
// so what a reader copies is exactly what just ran here.
//
//   data-run="view"   runs when the figure first scrolls into view
//   data-run="click"  runs only when asked (the 3D recipe: it is heavy)
//   data-run="frame"  runs in kit-frame.html inside an iframe, for a
//                     recipe that styles :root (createShell does)
//
// A recipe that throws keeps its failure in its own pane (data-error) and the
// rest carry on. Results land on the figure as data-result and on
// window.__kit, which is what check-browser.py reads.
import {highlight} from './kit-highlight.js';

const kit = window.__kit = {results: {}, copyText: {}, run: null};
const gen = {};                                  // name -> run generation

async function source(name) {
  if (kit.copyText[name] == null) {
    const r = await fetch(`site/kit-examples/${name}.js`);
    if (!r.ok) throw new Error(`${name}.js: HTTP ${r.status}`);
    kit.copyText[name] = await r.text();
  }
  return kit.copyText[name];
}

async function runOne(fig) {
  const name = fig.dataset.example;
  const my = gen[name] = (gen[name] || 0) + 1;   // a newer run supersedes this one
  const pane = fig.querySelector('.kit-result');
  delete fig.dataset.result; delete fig.dataset.error;
  pane.querySelector('.kit-host')?.viewer?.dispose?.();
  pane.replaceChildren();
  pane.classList.add('busy');
  // A SUPERSEDED RUN CLEANS UP AFTER ITSELF. Two runs can be in flight at once
  // (Run again pressed while the first is still importing), and the older one
  // must neither mount into the pane the newer one owns nor leave a live 3D
  // viewer behind - a WebGL context and a render loop nobody can see.
  let host = null;
  const drop = () => { host?.viewer?.dispose?.(); host?.remove(); };
  try {
    let result;
    if (fig.dataset.run === 'frame') {
      result = await inFrame(pane, name);
    } else {
      const mod = await import(`./kit-examples/${name}.js`);
      if (gen[name] !== my) return;                      // superseded before it mounted
      host = document.createElement('div');
      host.className = 'kit-host';
      pane.append(host);
      result = await mod.run(host);
      if (gen[name] !== my) { drop(); return; }          // superseded while it ran
    }
    if (gen[name] !== my) return;
    kit.results[name] = result;
    fig.dataset.result = JSON.stringify(result ?? {});
  } catch (err) {
    if (gen[name] !== my) { drop(); return; }
    pane.replaceChildren(Object.assign(document.createElement('p'),
      {className: 'kit-fail', textContent: `This example failed: ${err?.message || err}`}));
    fig.dataset.error = String(err?.message || err);
  } finally {
    if (gen[name] === my) pane.classList.remove('busy');
  }
}

// A recipe that styles :root runs in its own document. The frame imports the
// same module and posts back what run() returned.
function inFrame(pane, name) {
  return new Promise((resolve, reject) => {
    const f = document.createElement('iframe');
    f.className = 'kit-frame';
    f.title = `${name} running on its own page`;
    f.src = `kit-frame.html?ex=${encodeURIComponent(name)}`;
    const onMsg = e => {
      if (e.source !== f.contentWindow || e.data?.kitExample !== name) return;
      removeEventListener('message', onMsg);
      e.data.error ? reject(new Error(e.data.error)) : resolve(e.data.result);
    };
    addEventListener('message', onMsg);
    pane.append(f);
  });
}

kit.run = name => runOne(document.querySelector(`figure.kit-ex[data-example="${CSS.escape(name)}"]`));

async function wire(fig) {
  const name = fig.dataset.example;
  const code = fig.querySelector('pre code');
  try {
    code.innerHTML = highlight(await source(name));
  } catch (err) {
    code.textContent = `// could not load ${name}.js: ${err.message}`;
  }
  fig.querySelector('[data-act="run"]').addEventListener('click', () => runOne(fig));
  fig.querySelector('[data-act="copy"]').addEventListener('click', async ev => {
    const text = await source(name);
    try { await navigator.clipboard.writeText(text); ev.target.textContent = 'Copied'; }
    catch { ev.target.textContent = 'Select and copy'; }
    setTimeout(() => { ev.target.textContent = 'Copy'; }, 1500);
  });
}

// ?kitfail=1 adds a recipe whose module does not exist, run through the same
// runOne as every other, so the checks can prove a failure stays in its own
// pane. Nothing links to it.
if (new URLSearchParams(location.search).get('kitfail') === '1') {
  const first = document.querySelector('figure.kit-ex');
  const fig = first.cloneNode(true);
  fig.dataset.example = 'kitfail';
  fig.dataset.run = 'view';
  fig.querySelector('pre code').textContent = '// a recipe whose module is missing';
  fig.querySelector('.kit-result').replaceChildren();
  first.before(fig);
  fig.querySelector('[data-act="run"]').addEventListener('click', () => runOne(fig));
  runOne(fig);
}

// THE 3D RECIPE BUILDS ON A CLICK. It fetches six faces and compiles shaders,
// which no reader should pay for by scrolling past it. Without WebGL the pane
// says why, in the site's own words (webgl.js), rather than offering a button
// that can only fail.
async function armClick(fig) {
  const pane = fig.querySelector('.kit-result');
  const {webglTrouble} = await import('./webgl.js');
  const why = webglTrouble();
  if (why) {
    pane.replaceChildren(Object.assign(document.createElement('p'),
      {className: 'kit-fail', textContent: `3D needs WebGL: ${why}`}));
    fig.dataset.error = `webgl: ${why}`;
    // and no Run again either: it could only replace the reason with a failure
    const again = fig.querySelector('[data-act="run"]');
    again.disabled = true;
    again.title = 'This browser has no WebGL, so the 3D recipe cannot run here.';
    return;
  }
  const b = Object.assign(document.createElement('button'),
    {type: 'button', className: 'kit-build', textContent: 'Build the 3D view'});
  b.dataset.act = 'build';
  b.onclick = () => runOne(fig);
  pane.replaceChildren(b);
}

const io = new IntersectionObserver(entries => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    io.unobserve(e.target);
    runOne(e.target);
  }
}, {rootMargin: '200px'});

for (const fig of document.querySelectorAll('figure.kit-ex')) {
  if (fig.dataset.example === 'kitfail') continue;
  wire(fig);
  if (fig.dataset.run === 'view' || fig.dataset.run === 'frame') io.observe(fig);
  if (fig.dataset.run === 'click') armClick(fig);
}

// The table of contents marks the section in view.
const toc = [...document.querySelectorAll('.kit-toc a[href^="#"]')];
const spy = new IntersectionObserver(entries => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    for (const a of toc) a.toggleAttribute('aria-current', a.getAttribute('href') === `#${e.target.id}`);
  }
}, {rootMargin: '-40% 0px -55% 0px'});
for (const a of toc) {
  const s = document.getElementById(a.getAttribute('href').slice(1));
  if (s) spy.observe(s);
}
