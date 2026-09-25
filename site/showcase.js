// portrayal.dev — the showcase.
//
// One rack, built up in seven ordered stages. This file is only the entry
// point: the rail and its stages live in site/showcase/, the drawing layer
// they share in site/showcase/artifact.js, and the rack in site/showcase/rack.js.
//
// Nothing here fabricates data. Labels, states and component references are
// read off the compiled SVG's own attributes, and a state is only ever applied
// to an element that declares it in data-states.

import {VIEW, CONFIG, DEV, DIST, loading, loadDrawing} from './showcase/artifact.js';
import {boot} from './showcase/stage-rail.js';

(async () => {
  // The drawing is loaded before any stage, though no stage draws it: the
  // spokes a stage opens work on it, and this is where a page opened from
  // disk finds out it has to be served.
  try {
    await loadDrawing();
  } catch (err) {
    loading.textContent = `Could not load ${DIST}${DEV}.${CONFIG}.${VIEW}.svg — ${err.message}. This page must be served over HTTP, not opened from disk.`;
    return;
  }
  await boot();
})();
