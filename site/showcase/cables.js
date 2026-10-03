// The cable geometry moved to site/rack/cables.js, where the Rack Builder
// shares it (rack builder spec §10). This file is only the old address:
// patch-view.js, hero-reveal.js and hero-3d.js keep their lines unchanged
// and get the very same bindings.
export * from '../rack/cables.js';
