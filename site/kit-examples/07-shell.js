// The Explorer, as a drop-in: device picker, faces, a tree of every part, and
// the inspector. createShell mounts all of it into an element you give it and
// styles the page it lands in, so give it a page (or a frame) of its own.
// explorer.html on this site is the full example, with 3D wired to it.
import {createShell} from '@portrayal/kit/shell';

const DIST = 'assets/dist/';  // wherever you host the compiled files

export async function run(host) {
  const shell = createShell({
    title: 'Explorer',
    dist: DIST.replace(/\/$/, ''),     // the shell takes the folder without a trailing slash
    mount: host,
    device: 's9600-72xc',
  });
  await shell.ready;
  return {shell: true, device: shell.state.device};
}
