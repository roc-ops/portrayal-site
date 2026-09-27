// A device's source manifest is published once, as <device>.source.json: what
// the device is, its chassis in millimeters, its configurations. Every face
// names that file by its SHA-256 in <metadata>, so a drawing can be checked
// against the source it was drawn from. devices.json lists the library; jdist
// fetches JSON once and shares it with anything else on the page that asks.
import {jdist} from '@portrayal/kit/dist';

const DIST = 'assets/dist/';  // wherever you host the compiled files

const sha256 = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
  .map(b => b.toString(16).padStart(2, '0')).join('');

export async function run(host) {
  const face = await fetch(`${DIST}s9600-72xc.front.svg`).then(r => r.text());
  const doc = new DOMParser().parseFromString(face, 'image/svg+xml');
  const meta = JSON.parse(doc.querySelector('metadata').textContent);

  const bytes = await fetch(`${DIST}s9600-72xc.source.json`).then(r => r.arrayBuffer());
  const verified = await sha256(bytes) === meta['source-sha256'];   // the face was drawn from this
  const {chassis, configurations} = JSON.parse(new TextDecoder().decode(bytes));
  const configs = Object.keys(configurations || {});

  const {devices} = await jdist(`${DIST}devices.json`);

  const dl = document.createElement('dl');
  dl.className = 'kit-facts';
  for (const [k, v] of [['device', meta.device], ['chassis', `${chassis.width} × ${chassis.height} mm, ${chassis.ru}U`],
                        ['configurations', configs.join(', ')], ['library', `${devices.length} devices`],
                        ['source', verified ? 'matches the face it was drawn from' : 'does NOT match the face']]) {
    dl.insertAdjacentHTML('beforeend', `<dt>${k}</dt><dd></dd>`);
    dl.lastElementChild.textContent = v;
  }
  host.append(dl);
  return {device: meta.device, configs, chassis: {w: chassis.width, h: chassis.height, ru: chassis.ru},
          devices: devices.length, verified};
}
