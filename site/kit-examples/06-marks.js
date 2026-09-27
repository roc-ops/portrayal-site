// Annotate: a marks document names parts by selector and says what to do to
// each - ring it in a color, set a lamp state, label it. apply() previews it on
// the live drawing; toSvg() writes a standalone SVG with the rings and a legend
// as plain geometry (it opens in Word); encode() fits the document in a URL.
import {apply, toSvg, encode} from '@portrayal/kit/marks';

const DIST = 'assets/dist/';  // wherever you host the compiled files

const doc = {
  device: 's9600-72xc', config: 'base', view: 'front', legend: true,
  marks: [
    {select: '[data-path="port-12"]', color: '#2bb3c8', label: 'uplink to spine-a'},
    {select: '[data-path="led-port-12/lamp"]', state: 'on'},
    {select: '[data-path="port-67"]', color: '#e0574f', label: 'CRC errors rising'},
  ],
};

export async function run(host) {
  const text = await fetch(`${DIST}s9600-72xc.front.svg`).then(r => r.text());
  host.insertAdjacentHTML('beforeend', text);
  const svg = host.querySelector('svg');           // in the document: rings are measured

  apply(svg, doc);                                 // preview on the page
  const standalone = toSvg(svg, doc);              // a file you can save or send
  const share = encode(doc);                       // annotate.html#<this> reopens it in Annotate

  const out = document.createElement('output');
  out.textContent = `annotate.html#${share.slice(0, 48)}…`;
  host.append(out);
  return {marks: doc.marks.length, svgBytes: standalone.length, share};
}
