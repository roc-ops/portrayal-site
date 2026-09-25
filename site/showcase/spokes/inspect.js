import {
  svg, node, box, ring, clearOverlay, resetFrame, setFrame, setDrawing,
  el, svgEl, declared, setState, clearStates, setExports, saveSvg,
  title, lead, kv, controls, setPanel, VIEWS, CONFIGS, VIEW, CONFIG, DEV,
} from '../artifact.js';
import {configsOf} from '../rack.js';

export default function makeInspect({dev, cfg}) {
  let readout, onMove, onLeave, hoverRing;
  // CONFIGS carries the AS7726's labels. Any other device offers the
  // configurations its own index lists, so a button can never ask for a
  // compile that does not exist.
  const cfgs = dev === DEV ? CONFIGS : configsOf(dev).map(id => ({id, label: id}));
  const FIELDS = [
    ['data-class', 'class'], ['data-ref', 'contract'], ['data-media', 'media'],
    ['data-speed', 'speed'], ['data-lanes', 'lanes'], ['data-group', 'group'],
    ['data-role', 'role'], ['data-model', 'model'], ['data-sku', 'sku'],
    ['data-part-number', 'part'], ['data-members', 'members'], ['data-states', 'states'],
    ['data-for', 'belongs to'],
  ];
  function show(target) {
    clearOverlay();
    if (!target) {
      readout.replaceChildren(el('p', {class: 'panel-lead', text: 'Move over the drawing.'}));
      return;
    }
    const path = target.getAttribute('data-path');
    hoverRing = ring(path, 'pt-ring');
    const rows = [['path', path, true]];
    for (const [attr, label] of FIELDS) {
      const v = target.getAttribute(attr);
      if (v) rows.push([label, v]);
    }
    readout.replaceChildren(kv(rows));
  }
  return {
    hint: 'Hover any element; everything shown is read off its own attributes. Switch to the rear and try AC against DC — the PSU modules and the airflow stripe both change, because a configuration is a different compile.',
    enter() {
      resetFrame();
      readout = el('div', {class: 'readout'});
      const viewRow = controls(VIEWS.map(v => ({
        label: v, run: () => setDrawing(v, CONFIG, dev),
      })));
      const cfgRow = controls(cfgs.map(c => ({
        label: c.label, run: () => setDrawing(VIEW, c.id, dev),
      })));
      const mark = () => {
        [...viewRow.children].forEach(b => b.setAttribute('aria-pressed', String(b.textContent === VIEW)));
        [...cfgRow.children].forEach((b, i) => b.setAttribute('aria-pressed', String(cfgs[i].id === CONFIG)));
      };
      mark();
      // The readout goes first. It is the only thing here that changes while you
      // move the mouse, and putting the view and config rows above it pushed it
      // below the fold of the panel.
      setPanel(
        title('Inspect'),
        el('p', {class: 'panel-title', text: 'element'}),
        readout,
        el('p', {class: 'panel-title', text: 'view'}), viewRow,
        el('p', {class: 'panel-title', text: 'configuration'}), cfgRow,
        el('p', {class: 'panel-lead', html: 'A configuration populates the bays. Swapping AC for DC swaps the <em>modules</em> — the drawing is recompiled per configuration, not recolored.'}),
      );
      show(null);
      setExports([{label: 'SVG', title: 'Download this view as SVG',
        run: () => saveSvg(svg, `${dev}.${CONFIG}.${VIEW}.svg`)}]);
      onMove = ev => {
        const t = ev.target.closest?.('[data-path]');
        show(t && t !== svg ? t : null);
      };
      onLeave = () => show(null);
      svg.addEventListener('pointermove', onMove);
      svg.addEventListener('pointerleave', onLeave);
    },
    exit() {
      svg.removeEventListener('pointermove', onMove);
      svg.removeEventListener('pointerleave', onLeave);
      clearOverlay();
    },
  };
}
