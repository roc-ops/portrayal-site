// The same device in 3D. createViewer builds a chassis-sized box from the six
// compiled faces and raises the parts that stand proud of them. It takes the
// same paths and lamp states as the drawing. three.js is a peer dependency:
// the page's import map says where it lives.
import {createViewer} from '@portrayal/kit/viewer3d';

const DIST = 'assets/dist/';  // wherever you host the compiled files

export async function run(host) {
  const stage = document.createElement('div');
  stage.style.cssText = 'height: 380px; position: relative;';
  host.append(stage);

  const viewer = createViewer(stage, {dist: DIST});
  host.viewer = viewer;                                  // so a rerun can dispose it
  await viewer.load({device: 's9600-72xc', config: 'base'});

  await viewer.setStates({'led-port-12/lamp': 'state-on'});   // same state, same path, as in 2D
  viewer.select('port-12');                              // halo it and turn to face it

  const bar = document.createElement('p');
  const glb = Object.assign(document.createElement('button'), {type: 'button', textContent: 'Download GLB'});
  glb.onclick = () => viewer.download('glb');
  bar.append(glb);
  host.append(bar);

  return {loaded: true, selected: viewer.selection, lit: viewer.states()['led-port-12/lamp']};
}
