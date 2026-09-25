import {
  svg, overlay, node, box, ring, clearOverlay, resetFrame, setFrame,
  el, svgEl, declared, setState, clearStates, setExports, saveSvg,
  title, lead, kv, controls, setPanel, VIEWS, CONFIGS, VIEW, CONFIG,
} from '../artifact.js';

export default function makeSelect({dev, cfg}) {
  let picked = new Set(), listEl, selEl, onClick;

  function paint() {
    clearOverlay();
    picked.forEach(p => ring(p));
    listEl.textContent = picked.size
      ? [...picked].join('\n')
      : 'nothing selected';
    selEl.textContent = picked.size
      ? `[data-path="${[...picked][0]}"]${picked.size > 1 ? `, … (${picked.size} total)` : ''}`
      : '—';
  }
  const pick = paths => { picked = new Set(paths); paint(); };

  return {
    hint: 'Click any element to select it. Selection is a set of data-paths — the same strings a DCIM, a ticket or a query would use.',
    enter() {
      resetFrame();
      listEl = el('pre', {class: 'mono', style: 'margin:0;max-height:150px;overflow:auto;font-size:0.72rem;color:var(--pt-ink-muted)'});
      selEl = el('code', {style: 'font-size:0.72rem;color:var(--pt-brass);overflow-wrap:anywhere'});
      setPanel(
        title('Select & regions'),
        lead('Regions are addressable areas, not just decoration: a region can declare its members and be targeted by a NOS entity-map rule.'),
        controls([
          {label: 'All QSFP28', run: () => pick([...svg.querySelectorAll('[data-group="qsfp28"]')].map(n => n.getAttribute('data-path')))},
          {label: 'Odd ports', run: () => pick(Array.from({length: 16}, (_, i) => `port-${i * 2 + 1}`))},
          {label: 'mgmt-block', run: () => pick(['region:mgmt-block'])},
          {label: 'status-leds', run: () => pick(['region:status-leds'])},
          {label: 'Clear', run: () => pick([])},
        ]),
        el('p', {class: 'panel-title', text: 'selection'}),
        listEl,
        el('p', {class: 'panel-title', text: 'as a selector'}),
        selEl,
      );
      onClick = ev => {
        const t = ev.target.closest?.('[data-path]');
        if (!t || t === svg) return;
        const p = t.getAttribute('data-path');
        picked.has(p) ? picked.delete(p) : picked.add(p);
        paint();
      };
      svg.addEventListener('click', onClick);
      setExports([{label: 'SVG', title: 'Download with the selection marked',
        run: () => saveSvg(svg, `${dev}.${CONFIG}.${VIEW}.selection.svg`)}]);
      pick(['region:mgmt-block']);
    },
    exit() { svg.removeEventListener('click', onClick); picked.clear(); clearOverlay(); },
  };
}
