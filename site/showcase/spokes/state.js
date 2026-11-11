import {
  svg, overlay, node, box, ring, clearOverlay, resetFrame, setFrame,
  el, svgEl, declared, setState, clearStates, setExports, saveSvg,
  title, lead, kv, controls, setPanel, VIEWS, CONFIGS, VIEW, CONFIG,
} from '../artifact.js';
import {loadMeta, cagesOf, loadSkin, lcRef} from '../rack.js';
import {applyOccupantOverrides} from '../../../vendor/swap.js';

export default function makeState({dev, cfg}) {
  const PORT_LEDS = n => [1, 2, 3, 4].map(i => `port-${n}/led-${i}`);
  const CHASSIS = ['led-loc/lamp', 'led-psu1/lamp', 'led-diag/lamp', 'led-psu2/lamp', 'led-fan/lamp'];
  let note;

  // Speed bands, stated once. Every one of the 32 cages belongs to exactly one
  // band: an earlier version ran 1-12, 13-20 and then 25-32, which left ports
  // 21 to 24 unlit for no reason a reader could work out from the drawing.
  const BANDS = [
    {from: 1,  to: 12, state: 'link-100g', label: '100G'},
    {from: 13, to: 20, state: 'link-40g',  label: '40G'},
    {from: 21, to: 24, state: 'link-10g',  label: '10G'},
    {from: 25, to: 32, state: 'link-25g',  label: '25G'},
  ];
  const PORTS = 32;
  const allPorts = st => { for (let n = 1; n <= PORTS; n++) PORT_LEDS(n).forEach(p => setState(p, st)); };

  // A lit lamp over an empty cage is a contradiction: nothing is plugged in, so
  // nothing can be up. Every cage whose lamp carries a state holds the cage's
  // generic LC optic, through swap.js's own seating; a dark one is empty. The
  // optic carries no speed, so the same one goes in every lit cage. Seats run
  // one after another, so a quick run of buttons never overlaps two of them.
  let queue = Promise.resolve();
  let alive = false;
  const seatLit = (all = false) => queue = queue.then(async () => {
    if (!alive && !all) return;                 // the lens closed while this was queued
    const cages = [], want = {};
    for (const cage of cagesOf(dev).front || []) {
      const m = /^port-(\d+)$/.exec(cage.id);
      const ref = lcRef(cage);
      if (!m || +m[1] > PORTS || !ref) continue;
      const lit = !all && PORT_LEDS(+m[1]).some(p => [...(node(p)?.classList || [])].some(c => c.startsWith('state-')));
      const held = !!svg.querySelector(`[data-path="${cage.id}-occupant"]`);
      if (lit === held) continue;
      cages.push(cage);
      want[cage.id] = lit ? ref : null;
    }
    if (!cages.length) return;
    const out = await applyOccupantOverrides(svg, cages, want, loadSkin);
    if (out.failed.length || out.refused.length) console.warn('[portrayal] live state optics', out);
  }).catch(err => console.warn('[portrayal] live state optics', err));

  const scenarios = {
    healthy() {
      clearStates(); clearOverlay();
      CHASSIS.forEach(p => setState(p, 'on'));
      allPorts('link-100g');
      setState('mgmt-eth/led-left', 'up');
      setState('sfp-leds/lamp-1', 'link-10g');
      return `All ${PORTS} cages up at 100G, management link up, both PSU lamps on.`;
    },
    mixed() {
      clearStates(); clearOverlay();
      CHASSIS.forEach(p => setState(p, 'on'));
      for (const b of BANDS) {
        for (let n = b.from; n <= b.to; n++) PORT_LEDS(n).forEach(p => setState(p, b.state));
      }
      setState('mgmt-eth/led-left', 'up');
      setState('sfp-leds/lamp-1', 'link-10g');
      setState('sfp-leds/lamp-2', 'link-1g');
      return 'Four speeds at once — ' +
        BANDS.map(b => `${b.from}-${b.to} at ${b.label}`).join(', ') +
        '. The colors are the vendor\'s own convention, carried in the compiled stylesheet, not chosen here.';
    },
    fault() {
      clearStates(); clearOverlay();
      CHASSIS.forEach(p => setState(p, 'on'));
      allPorts('link-100g');
      PORT_LEDS(14).forEach(p => setState(p, 'fault'));
      setState('mgmt-eth/led-left', 'up');
      ring('port-14');
      return 'port-14 in fault. Note what did NOT happen: the front PSU lamps declare only off and on, so this drawing cannot show a PSU fault — that fact lives on the rear view. A state the model does not declare is refused rather than faked.';
    },
    off() { clearStates(); clearOverlay(); return 'Everything dark.'; },
  };

  return {
    hint: 'The .state-* stylesheet is compiled into the file. Driving it is a class toggle — no redraw, no image swap.',
    async enter() {
      alive = true;
      await loadMeta();
      resetFrame();
      note = el('p', {class: 'panel-lead', text: 'Pick a scenario.'});
      const run = name => { note.textContent = scenarios[name](); seatLit(); };
      setPanel(
        title('Live state'),
        lead('Bind these classes to telemetry and the drawing becomes the dashboard. A cage with a lit lamp holds an optic; a dark one is empty.'),
        controls([
          {label: 'Healthy', run: () => run('healthy')},
          {label: 'Mixed speeds', run: () => run('mixed')},
          {label: 'Fault', run: () => run('fault')},
          {label: 'All off', run: () => run('off')},
        ]),
        note,
        el('div', {class: 'legend'}, [
          el('span', {html: '<i style="background:#3b82f6"></i> 100G'}),
          el('span', {html: '<i style="background:#f97316"></i> 40G'}),
          el('span', {html: '<i style="background:#f5f7fa"></i> 25G'}),
          el('span', {html: '<i style="background:#22c55e"></i> 10G / up'}),
          el('span', {html: '<i style="background:#ef4444"></i> fault'}),
        ]),
      );
      run('mixed');
      setExports([{label: 'SVG', title: 'Download with the current states and optics applied',
        run: async () => { await queue; saveSvg(svg, `${dev}.${CONFIG}.${VIEW}.state.svg`); }}]);
    },
    // The optics go before the lamps do: setDrawing returns early for the same
    // device, view and configuration, so the next lens would read them otherwise.
    async exit() { alive = false; await seatLit(true); clearStates(); clearOverlay(); },
  };
}
