// THE 3D STAGE'S COLOUR, as the Explorer and Annotate offer it. Their swatches
// are the shell's (vendor/shell.js mountStage), which this page does not run, so
// the four colours and the key they are remembered under are repeated here -
// the same key on purpose: a reader who chose a light stage in the Explorer has
// chosen it here too. Black is the shell's default, as it is there.
//
// A rack's U numbers and device tags are drawn ON the stage, so they turn with
// it (rack3d.js setLabelColors; roc-ops/portrayal-site#9 asked for the light
// one). A device's own faces are its drawing and do not.

export const STAGE_KEY = 'portrayal.stage';
export const STAGE_SWATCHES = [['#ffffff', 'white'], ['#c5c9ce', 'light grey'],
                               ['#3b3f45', 'dark grey'], ['#101214', 'black']];
export const STAGE_DEFAULT = '#101214';

// What the labels are on each stage: dark ink on the two light ones, and on the
// dark grey the plain numbers lifted, since #6B727A all but vanishes on it.
// The black stage is rack3d.js's own defaults, so it passes nothing.
const LIGHT = {labelColor: '#2b3035', labelUnitColor: '#5a6168', labelEmphasisColor: '#101214'};
const LABELS = {'#ffffff': LIGHT, '#c5c9ce': LIGHT, '#3b3f45': {labelUnitColor: '#9aa1a8'}, '#101214': {}};

// A colour that is not one of the four (a hand-edited store) is judged by how
// light it is.
const lightness = c => {
  const m = /^#?([0-9a-f]{6})$/i.exec(c || '');
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  return (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
};
export const labelsFor = c => LABELS[String(c).toLowerCase()] ?? (lightness(c) > 0.55 ? LIGHT : {});

export function loadStage() {
  try {
    const c = localStorage.getItem(STAGE_KEY);
    return /^#[0-9a-f]{6}$/i.test(c || '') ? c : STAGE_DEFAULT;
  } catch { return STAGE_DEFAULT; }
}
function saveStage(c) { try { localStorage.setItem(STAGE_KEY, c); } catch { /* private mode */ } }

// The swatches, into `host` (the shell's #stagebg markup), calling `onStage`
// with each colour picked. Returns the colour to start with.
export function mountStage(host, onStage) {
  let cur = loadStage();
  const paint = () => {
    for (const sw of host.querySelectorAll('.sw')) {
      const on = sw.dataset.c === cur;
      sw.classList.toggle('on', on);
      sw.setAttribute('aria-pressed', String(on));
    }
  };
  for (const [c, name] of STAGE_SWATCHES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sw'; b.dataset.c = c; b.style.background = c;
    b.title = `${name} background`;
    b.setAttribute('aria-label', `${name} background`);
    b.addEventListener('click', () => { cur = c; saveStage(c); paint(); onStage(c); });
    host.appendChild(b);
  }
  paint();
  return {get: () => cur};
}
