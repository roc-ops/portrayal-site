import {
  svg, overlay, node, box, ring, clearOverlay, resetFrame, setFrame, setDrawing,
  el, svgEl, declared, setState, clearStates, setExports, saveSvg,
  title, lead, kv, controls, setPanel, VIEWS, CONFIGS, VIEW, CONFIG,
} from '../artifact.js';

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
    enter() {
      resetFrame();
      note = el('p', {class: 'panel-lead', text: 'Pick a scenario.'});
      setPanel(
        title('Live state'),
        lead('Bind these classes to telemetry and the drawing becomes the dashboard.'),
        controls([
          {label: 'Healthy', run: () => note.textContent = scenarios.healthy()},
          {label: 'Mixed speeds', run: () => note.textContent = scenarios.mixed()},
          {label: 'Fault', run: () => note.textContent = scenarios.fault()},
          {label: 'All off', run: () => note.textContent = scenarios.off()},
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
      note.textContent = scenarios.mixed();
      setExports([{label: 'SVG', title: 'Download with the current states applied',
        run: () => saveSvg(svg, `${dev}.${CONFIG}.${VIEW}.state.svg`)}]);
    },
    exit() { clearStates(); clearOverlay(); },
  };
}
