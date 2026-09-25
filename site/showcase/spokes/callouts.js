import {
  svg, overlay, node, box, ring, clearOverlay, resetFrame, setFrame,
  el, svgEl, declared, setState, clearStates, setExports, saveSvg,
  title, lead, kv, controls, setPanel, VIEWS, CONFIGS, VIEW, CONFIG, BASE_FRAME,
} from '../artifact.js';

export default function makeCallouts({dev, cfg}) {
  // Datasheet-style annotation. What is authored is only *which* elements are
  // worth pointing at and which side they leave from; every coordinate, and
  // most of the label text, is derived from the drawing.
  //
  // Leaders never cross because anchors and label slots are both laid out in
  // ascending x within a side, so their order is preserved by construction.
  const TARGETS = [
    {path: 'port-1',             side: 'up'},
    {path: 'port-32',            side: 'up'},
    {path: 'region:mgmt-block',  side: 'up'},
    {path: 'region:status-leds', side: 'down'},
    {path: 'region:intake',      side: 'down', note: 'front-to-back airflow'},
    {path: 'mgmt-eth',           side: 'down'},
  ];

  const LABEL = 7;      // mm — ~12px once the 438mm drawing is laid out
  const SUB = 5;
  const CH = 0.6;       // IBM Plex Mono advance, as a fraction of the em
  const width = (text, size) => text.length * size * CH;

  // A sub-label built from the element's own attributes wherever it has them.
  function describe(n, fallback) {
    const a = k => n.getAttribute(k);
    if (a('data-class') === 'port') {
      return [a('data-media'), a('data-speed'), a('data-lanes') && `${a('data-lanes')} lanes`]
        .filter(Boolean).join(' · ');
    }
    if (a('data-class') === 'region') {
      const m = (a('data-members') || '').split(/\s+/).filter(Boolean);
      if (m.length) return `${m.length} members`;
    }
    if (a('data-model')) return [a('data-model'), a('data-sku')].filter(Boolean).join(' · ');
    return fallback || a('data-class') || '';
  }

  function layout(side, W) {
    const rows = TARGETS.filter(t => t.side === side)
      .map(t => {
        const n = node(t.path), b = box(t.path);
        if (!n || !b) return null;
        const label = t.path;
        const sub = describe(n, t.note);
        return {...t, n, b, label, sub, w: Math.max(width(label, LABEL), width(sub, SUB))};
      })
      .filter(Boolean)
      .sort((a, r) => (a.b.x + a.b.width / 2) - (r.b.x + r.b.width / 2));

    // Three passes. Forward: sit each block under its own anchor, pushed right
    // only as far as the previous block requires. Backward: pull anything that
    // overhangs the right edge back in, carrying its neighbors with it.
    // Forward again: nothing may end up left of the frame.
    //
    // Shifting the whole row by the right-hand overflow - the obvious fix - is
    // wrong: it drags the left-most label off the other edge.
    const GAP = 22, MIN = 8;
    let prev = MIN;
    for (const r of rows) {
      r.tx = Math.max(r.b.x + r.b.width / 2 - 10, prev);
      prev = r.tx + r.w + GAP;
    }
    for (let i = rows.length - 1; i >= 0; i--) {
      const limit = i === rows.length - 1 ? W - rows[i].w : rows[i + 1].tx - rows[i].w - GAP;
      rows[i].tx = Math.min(rows[i].tx, limit);
    }
    prev = MIN;
    for (const r of rows) {
      r.tx = Math.max(r.tx, prev);
      prev = r.tx + r.w + GAP;
    }
    return rows;
  }

  return {
    hint: 'Anchors, routing and most of the label text are derived from the drawing. Only the choice of what to point at is authored.',
    enter() {
      const W = BASE_FRAME[2], H = BASE_FRAME[3];
      setFrame(-14, -46, W + 34, H + 46 + 52);
      clearOverlay();

      for (const side of ['up', 'down']) {
        const up = side === 'up';
        const ty = up ? -30 : H + 26;
        for (const r of layout(side, W)) {
          const ax = r.b.x + r.b.width / 2;
          const ay = up ? r.b.y : r.b.y + r.b.height;
          const stub = up ? ay - 7 : ay + 7;
          overlay.append(
            svgEl('path', {class: 'pt-leader', d:
              `M ${ax} ${ay} L ${ax} ${stub} L ${r.tx - 9} ${ty} L ${r.tx - 2} ${ty}`}),
            svgEl('circle', {class: 'pt-dot', cx: ax, cy: ay, r: 0.9}));

          const t1 = svgEl('text', {class: 'pt-label', x: r.tx, y: ty + LABEL * 0.34});
          t1.textContent = r.label;
          const t2 = svgEl('text', {class: 'pt-label-sub', x: r.tx, y: ty + LABEL * 0.34 + SUB + 1.6});
          t2.textContent = r.sub;
          overlay.append(t1, t2);
          ring(r.path, 'pt-ring-soft', 1.1);
        }
      }

      // A real dimension, off the file's own frame, clear of the labels.
      const dy = H + 44;
      overlay.append(svgEl('path', {class: 'pt-dim',
        d: `M 0 ${dy - 2.5} V ${dy + 2.5} M 0 ${dy} H ${W} M ${W} ${dy - 2.5} V ${dy + 2.5}`}));
      const dt = svgEl('text', {class: 'pt-label-sub', x: W / 2, y: dy - 2.5, 'text-anchor': 'middle'});
      dt.textContent = `${W} × ${H} mm`;
      overlay.append(dt);

      setExports([{label: 'SVG', title: 'Download the annotated figure',
        run: () => saveSvg(svg, `${dev}.${CONFIG}.${VIEW}.callouts.svg`)}]);
      setPanel(
        title('Callouts'),
        lead('The annotated figure a datasheet or an install guide needs — generated, not drawn. Because the anchors are real geometry, the figure cannot drift from the hardware.'),
        kv([
          ['anchors', 'getBBox()', true],
          ['routing', 'sorted, so leaders cannot cross'],
          ['sub-labels', 'from data-media / speed / lanes / members'],
          ['authored', 'which element, which side'],
        ]),
      );
    },
    exit() { clearOverlay(); resetFrame(); },
  };
}
