// Color ports from your own data. Here the "telemetry" is a table in the file;
// in a dashboard it is whatever your monitoring returns. Each port is found by
// its data-path and given a fill - the drawing is yours to style.
const DIST = 'assets/dist/';  // wherever you host the compiled files

const telemetry = {            // port -> utilization, 0..1
  'port-4': 0.12, 'port-5': 0.48, 'port-6': 0.71, 'port-7': 0.93, 'port-12': 0.35,
};

const colorFor = u => u > 0.9 ? '#e0574f' : u > 0.6 ? '#e0a94a' : '#48d08a';

export async function run(host) {
  const text = await fetch(`${DIST}s9600-72xc.front.svg`).then(r => r.text());
  host.insertAdjacentHTML('beforeend', text);
  const svg = host.querySelector('svg');

  let colored = 0;
  for (const [path, u] of Object.entries(telemetry)) {
    const port = svg.querySelector(`[data-path="${path}"]`);
    if (!port) continue;
    port.style.outline = 'none';
    for (const shape of port.querySelectorAll('rect, path')) {
      shape.style.fill = colorFor(u);
      shape.style.fillOpacity = '0.55';
    }
    port.insertAdjacentHTML('beforeend', `<title>${path}: ${Math.round(u * 100)}%</title>`);
    colored++;
  }
  return {colored};
}
