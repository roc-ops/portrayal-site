// A switched PDU's outlet declares the states on and off, and the lamp that
// shows them is a part of its own beside it, bound to the outlet with `for:`.
// A state set on the outlet is shown on its lamp: boundLamps reads those
// bindings off the drawing, and expandStates turns a {path: state} map keyed
// by outlets into one that reaches their lamps too - the one rule the marks
// document, the Explorer's chips and the 3D scene (viewer.setStates) all
// apply. `off` can be lit: offIsSet says the outlet takes state-off rather
// than being cleared, so the Eaton G4 lamp shows its declared off color.
import {boundLamps, expandStates, offIsSet} from '@portrayal/kit/states';

const DIST = 'assets/dist/';  // wherever you host the compiled files

export async function run(host) {
  const text = await fetch(`${DIST}evma8365x.front.svg`).then(r => r.text());
  host.insertAdjacentHTML('beforeend', text);
  const svg = host.querySelector('svg');

  // Your power data, keyed by outlet: A1 on, A3 off.
  const fromPdu = {'outlet-a1': 'state-on', 'outlet-a3': 'state-off'};
  const binds = boundLamps(svg);                   // outlet path -> its lamps
  const applied = expandStates(fromPdu, binds);    // + each outlet's lamp
  for (const [path, cls] of Object.entries(applied))
    for (const el of svg.querySelectorAll(`[data-path="${CSS.escape(path)}"]`)) el.classList.add(cls);

  const a3 = svg.querySelector('[data-path="outlet-a3"]');
  const lamp = el => getComputedStyle(el).getPropertyValue('--led-color').trim();
  const [onLamp] = binds.get('outlet-a1') || [], [offLamp] = binds.get('outlet-a3') || [];

  const out = document.createElement('output');
  out.className = 'kit-text';
  out.textContent = `${binds.size} outlets with a lamp. A1 on: lamp ${lamp(onLamp)}. ` +
    `A3 off: lamp ${lamp(offLamp)}${offIsSet(a3, binds.get('outlet-a3')) ? ' (off is a lit state here)' : ''}.`;
  host.append(out);
  return {outlets: binds.size, applied: Object.keys(applied).length,
          on: lamp(onLamp), off: lamp(offLamp), offIsSet: offIsSet(a3, binds.get('outlet-a3'))};
}
