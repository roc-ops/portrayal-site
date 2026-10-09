// A rack, edited by commands. createRackEditor holds a rack document and takes
// every edit as a named command: a batch lands whole or not at all, a refusal
// says why, and each batch is one undo step. The rack catalog (rack.json)
// says how tall and deep each device is; describe and inspect read the result
// back as text and as data. No drawing is needed for any of it.
import {loadCatalog} from '@portrayal/kit/rack/catalog';
import {newDoc} from '@portrayal/kit/rack/model';
import {createRackEditor} from '@portrayal/kit/rack/editor';
import {describe, inspect} from '@portrayal/kit/rack/queries';
import {routedLength} from '@portrayal/kit/rack/route';

const DIST = 'assets/dist/';  // wherever you host the compiled files

export async function run(host) {
  const {chassisOf} = await loadCatalog(DIST);
  const editor = createRackEditor({doc: newDoc({name: 'Row 1, rack 4'}), chassisOf});
  const heard = [];
  editor.on('change', ev => heard.push(ev.summary));

  // One batch, one undo step. "as" names what a command creates, so a later
  // command in the same batch can say "@agg" before it has an id.
  const built = editor.apply([
    {op: 'place', ref: 's9600-72xc', face: 'front', ru: 20, label: 'agg-1', as: 'agg'},
    {op: 'place', ref: 'as7726-32x', face: 'front', ru: 10, label: 'leaf-1', as: 'leaf'},
    {op: 'zerou.place', ref: 'cmv-sfd42u9w', at: 'left-front', ru: 1, label: 'duct-left'},
    {op: 'cable.add', a: {item: '@agg', path: 'port-1', view: 'front'},
                      b: {item: '@leaf', path: 'port-1', view: 'front'}, media: 'os2', purpose: 'uplink', as: 'up1'},
    {op: 'cable.add', a: {item: '@agg', path: 'port-2', view: 'front'},
                      b: {item: '@leaf', path: 'port-2', view: 'front'}, media: 'os2', purpose: 'uplink'},
  ]);
  if (built.error) throw new Error(built.error);

  // A command that cannot land is refused, with the reason, and changes nothing.
  const refused = editor.apply({op: 'place', ref: 'as7726-32x', face: 'front', ru: 21});

  // Undo takes back one step: here, a move.
  editor.apply({op: 'move', id: built.created.agg, ru: 30});
  editor.undo();

  // The routing context. On a page it comes from the drawings: each part's
  // rings and ducts (guidesOf) and each port's x in mm from the rack's center
  // line (portX). A plain one routes every cable down the gutter beside the
  // rails, which is enough to measure it.
  const route = {chassisOf, guidesOf: () => [], portX: () => -100};
  const rack = editor.rack();
  const cable = await inspect(rack, built.created.up1, {chassisOf, route});
  const length = routedLength(rack, rack.cables[0], route);   // {measured, value}, in meters

  const out = document.createElement('output');
  out.className = 'kit-text';
  out.textContent = `${describe(rack, {chassisOf, route})}\n\nRefused: ${refused.error}\n` +
    `${cable.id} is routed ${length.measured.toFixed(2)} m; buy ${length.value} m.`;
  host.append(out);
  return {items: rack.items.length, zeroU: rack.zeroU.length, cables: rack.cables.length,
          refused: refused.error, aggAt: rack.items.find(i => i.label === 'agg-1').ru,
          routed: length.value, heard: heard.length};
}
