// THE STAGE'S COLOUR, as the Explorer and Annotate offer it. Their swatches are
// the shell's (vendor/shell.js mountStage), which this page does not run, so the
// four colours and the key they are remembered under are repeated here - the
// same key on purpose: a reader who chose a light stage in the Explorer has
// chosen it here too. Black is the shell's default, as it is there.
//
// As there, the colour is the ground behind the drawing in 2D and the scene's
// background in 3D. A rack's U numbers and device tags are drawn ON the stage,
// so they turn with it: in 3D through rack3d.js setLabelColors
// (roc-ops/portrayal-site#9 asked for the light one), in 2D through the site's
// own light or dark palette laid over the panes (rack.css, [data-stage]). A
// device's own faces are its drawing and do not.

export const STAGE_KEY = 'portrayal.stage';
export const STAGE_SWATCHES = [['#ffffff', 'white'], ['#c5c9ce', 'light grey'],
                               ['#3b3f45', 'dark grey'], ['#101214', 'black']];
export const STAGE_DEFAULT = '#101214';

// A colour that is not one of the four (a hand-edited store) is judged by how
// light it is.
const lightness = c => {
  const m = /^#?([0-9a-f]{6})$/i.exec(c || '');
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  return (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
};
// 'light' or 'dark': which of the site's palettes reads on this stage.
export const stageTone = c => (lightness(c) > 0.55 ? 'light' : 'dark');

// What the 3D labels are on each stage: dark ink on the two light ones, and on
// the dark grey the plain numbers lifted, since #6B727A all but vanishes on it.
// The black stage is rack3d.js's own defaults, so it passes nothing.
const LIGHT = {labelColor: '#2b3035', labelUnitColor: '#5a6168', labelEmphasisColor: '#101214'};
const LABELS = {'#ffffff': LIGHT, '#c5c9ce': LIGHT, '#3b3f45': {labelUnitColor: '#9aa1a8'}, '#101214': {}};
export const labelsFor = c => LABELS[String(c).toLowerCase()] ?? (stageTone(c) === 'light' ? LIGHT : {});

// A BUNDLE'S STRAP ON EACH STAGE. A hook-and-loop strap is black, which is
// what it is on a light stage and on paper (a sheet is fixed ink on white).
// On a dark stage a black strap is not seen: #24282d on #101214 was 1.3 to 1.
// There it is a light neutral, and on either it has a rim of the opposite
// tone, so it stands off the stage and off every cable colour, the black DAC
// and the grey of an unset cable included: whichever of the two a cable is
// close to, the other is not. `core` and `rim` are what the 2D bar is drawn
// in (rack.css repeats them per stage; the bar's own attributes are the
// light pair, for a file) and `core` the 3D band's colour.
export const STRAP_PAINT = {light: {core: '#1b1d20', rim: '#ffffff'}, dark: {core: '#d5d9de', rim: '#0b0c0d'}};
export const strapPaint = c => STRAP_PAINT[stageTone(c)];
// The least a strap measures on screen in 2D, in CSS px, along the run and
// across it: at Fit on a 42U rack a 10 mm bar is 4 or 5 px, and less on a
// small window. Drawn as a second, non-scaling stroke under the true one: 7,
// so that 6 whole pixels are the strap's own colour once its edges are blended.
export const STRAP_MIN_PX = 7;

export function loadStage() {
  try {
    const c = localStorage.getItem(STAGE_KEY);
    return /^#[0-9a-f]{6}$/i.test(c || '') ? c : STAGE_DEFAULT;
  } catch { return STAGE_DEFAULT; }
}
function saveStage(c) { try { localStorage.setItem(STAGE_KEY, c); } catch { /* private mode */ } }

// The swatches, into `host` (the shell's #stagebg markup), calling `onStage`
// with each colour picked. `get()` is the colour to start with.
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
