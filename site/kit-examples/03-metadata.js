// Every compiled face carries its whole source manifest in <metadata>, as JSON:
// what the device is, its chassis in millimeters, and its configurations. And
// devices.json lists the library. jdist fetches JSON once and shares the result
// with anything else on the page that asks for the same file.
import {jdist} from '@portrayal/kit/dist';

const DIST = 'assets/dist/';  // wherever you host the compiled files

export async function run(host) {
  const text = await fetch(`${DIST}s9600-72xc.base.front.svg`).then(r => r.text());
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const meta = JSON.parse(doc.querySelector('metadata').textContent);
  const {chassis, configurations} = meta.source;   // chassis in mm; configurations keyed by name
  const configs = Object.keys(configurations || {});

  const {devices} = await jdist(`${DIST}devices.json`);

  const dl = document.createElement('dl');
  dl.className = 'kit-facts';
  for (const [k, v] of [['device', meta.device], ['chassis', `${chassis.width} × ${chassis.height} mm, ${chassis.ru}U`],
                        ['configurations', configs.join(', ')], ['library', `${devices.length} devices`]]) {
    dl.insertAdjacentHTML('beforeend', `<dt>${k}</dt><dd></dd>`);
    dl.lastElementChild.textContent = v;
  }
  host.append(dl);
  return {device: meta.device, configs, chassis: {w: chassis.width, h: chassis.height, ru: chassis.ru}, devices: devices.length};
}
