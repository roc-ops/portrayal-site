// A published face has no rack ears: the library draws a device between its
// ear folds. ears2d draws the generic L-bracket over the face you already
// hold, from the plan the 3D viewer builds (earPlan), so a page can offer the
// ears as a choice. The plan is null where the device gets none: a face as
// wide as the rack (482.6 mm), whose ears are built in and already drawn, or
// a device that is not rack-mounted. The ear is silver unless the device
// states chassis.ears.color. clearEars takes it off again.
import {jdist} from '@portrayal/kit/dist';
import {earPlan, drawEars, clearEars, faceSize} from '@portrayal/kit/ears2d';

const DIST = 'assets/dist/';  // wherever you host the compiled files

export async function run(host) {
  const text = await fetch(`${DIST}s9600-72xc.front.svg`).then(r => r.text());
  host.insertAdjacentHTML('beforeend', text);
  const svg = host.querySelector('svg');

  // The plan reads the chassis from configs.json and the width the front declares.
  const meta = await jdist(`${DIST}s9600-72xc.configs.json`);
  const plan = earPlan(meta, faceSize(svg)[0]);
  const shapes = drawEars(svg, plan, 'front');   // the viewBox grows to hold them

  // A blanking panel is as wide as the rack face: its ears are part of its
  // drawing, so it gets no plan and nothing is drawn over it.
  const blank = await jdist(`${DIST}fhu-bps-2u.configs.json`);
  const blankPlan = earPlan(blank, blank.chassis.w);

  const out = document.createElement('output');
  out.className = 'kit-text';
  out.textContent = `S9600-72XC: ${plan.flange} mm flange each side, ${plan.color}, ${shapes} shapes drawn. ` +
    `FHU-BPS-2U: ${blankPlan ? 'a generic ear' : 'no generic ear (built in)'}.`;
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.textContent = 'Rack ears';
  toggle.className = 'on';
  toggle.onclick = () => {
    const on = toggle.classList.toggle('on');
    if (on) drawEars(svg, plan, 'front'); else clearEars(svg);
  };
  host.append(toggle, out);
  return {flange: plan.flange, color: plan.color, shapes,
          viewBox: svg.getAttribute('viewBox'), blank: blankPlan};
}
