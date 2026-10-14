// Cables that share part of their route can be combed into a bundle. The
// bundle's route (the trunk) is worked out from where its cables run together,
// and the size check reads the cable types: a bundle's diameter is
// sqrt(sum(d^2) / 0.8), held against 63.5 mm and against each pathway's
// opening on the trunk. It warns and never refuses. With the cable types'
// bend radii it checks the bend too, and names a member it cannot check
// rather than passing it. straps() places the hook-and-loop straps, every
// 12 in unless the bundle says otherwise, and the exports count them.
import {loadCatalog} from '@portrayal/kit/rack/catalog';
import {loadCableTypes} from '@portrayal/kit/rack/cable-types';
import {newDoc} from '@portrayal/kit/rack/model';
import {createRackEditor} from '@portrayal/kit/rack/editor';
import {describe} from '@portrayal/kit/rack/queries';
import {bundleCheck, straps} from '@portrayal/kit/rack/bundles';
import {bundleExports, bundleNotes, strapBomRows} from '@portrayal/kit/rack/export-data';

const DIST = 'assets/dist/';  // wherever you host the compiled files

export async function run(host) {
  const {chassisOf} = await loadCatalog(DIST);
  const {diameterOf, bendOf} = await loadCableTypes(DIST);   // each type's outside diameter and bend radius
  const editor = createRackEditor({doc: newDoc(), chassisOf});
  const end = (item, path) => ({item, path, view: 'front'});
  const made = editor.apply([
    {op: 'place', ref: 's9600-72xc', face: 'front', ru: 20, label: 'agg-1', as: 'agg'},
    {op: 'place', ref: 'as7726-32x', face: 'front', ru: 10, label: 'leaf-1', as: 'leaf'},
    {op: 'cable.add', a: end('@agg', 'port-1'), b: end('@leaf', 'port-1'), media: 'os2', as: 'fiber'},
    {op: 'cable.add', a: end('@agg', 'port-2'), b: end('@leaf', 'port-2'), media: 'cat6a', as: 'copper'},
  ]);
  if (made.error) throw new Error(made.error);

  // What needs the drawings comes in as ctx.route (see the rack recipe); the
  // cable diameters ride along on it. Without ctx.route a bundle is still
  // made, and is reported not checked.
  const route = {chassisOf, guidesOf: () => [], portX: () => -100, diameterOf};
  const {fiber, copper} = made.created;
  const bundled = editor.apply({op: 'bundle.create', cables: [fiber, copper], label: 'uplinks'}, {ctx: {route}});
  if (bundled.error) throw new Error(bundled.error);

  const rack = editor.rack();
  const bundle = rack.bundles[0];
  const ctx = {chassisOf, route, diameterOf, bendOf};
  const check = bundleCheck(rack, bundle, ctx);   // {checked, size, bend, warnings, notes, ...}
  const placed = straps(rack, bundle, ctx);        // {every, count, straps: [{segment, t, along_mm, point, dir, on}]}

  // The same bundles as the exports read them: a note per bundle for the
  // cable schedule, and the bill of materials' strap line.
  const records = bundleExports(rack, ctx);
  const [strapLine] = strapBomRows(records);

  const out = document.createElement('output');
  out.className = 'kit-text';
  out.textContent = `${describe(rack, ctx, {section: 'bundles'})}\n\n` +
    `${bundle.label}: about ${check.size.max_mm} mm across at ${check.size.at}, ` +
    `limit ${check.size.limit_mm} mm; ${check.warnings.length} warnings; ` +
    `${placed.count} straps, every ${placed.every.value} ${placed.every.unit}; ` +
    `bend radius ${check.bend.radius_mm} mm, set by ${check.bend.by}.\n\n` +
    `${bundleNotes(records).join('\n')}\nBOM: ${strapLine.qty} x ${strapLine.model}.`;
  host.append(out);
  return {members: bundle.members.length, checked: check.checked, size: check.size.max_mm,
          limit: check.size.limit_mm, warnings: check.warnings, straps: placed.count,
          bend: check.bend.radius_mm, bendBy: check.bend.by, strapQty: strapLine.qty};
}
