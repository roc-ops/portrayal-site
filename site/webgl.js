/**
 * Can this browser do 3D at all, and if not, what should we tell somebody?
 *
 * Every 3D surface here used to construct a renderer and assume it worked.
 * three.js THROWS when a context cannot be created, so the exception escaped the
 * click handler, the "Building the rack in 3D…" scrim was never hidden, and the
 * page sat there. The failure is usually nothing to do with the page:
 *
 *   GL_VENDOR = Disabled, GL_RENDERER = Disabled, Sandboxed = yes
 *   ErrorMessage = BindToCurrentSequence failed
 *
 * That is Chrome with hardware acceleration switched off at the GPU-process
 * level. It survives a reload, a new tab and a browser restart, because it is
 * profile state rather than page state - which is exactly why a page that hangs
 * instead of explaining sends somebody looking in the wrong place.
 */

/** null when 3D should work; otherwise a sentence to show the reader. */
export function webglTrouble() {
  let canvas;
  try {
    canvas = document.createElement('canvas');
  } catch {
    return 'This browser cannot create a canvas, so 3D is unavailable.';
  }
  let gl = null;
  try {
    gl = canvas.getContext('webgl2') || canvas.getContext('webgl')
      || canvas.getContext('experimental-webgl');
  } catch (e) {
    return `3D is unavailable: ${e.message}`;
  }
  if (!gl) {
    return 'This browser will not give the page a WebGL context, so 3D cannot '
         + 'start. It is almost always graphics acceleration being off rather '
         + 'than anything on this page: in Chrome, chrome://gpu says why, and '
         + 'Settings → System → "Use graphics acceleration when available" '
         + 'turns it back on. Chrome also disables it by itself after repeated '
         + 'GPU crashes, and that setting survives a restart.';
  }
  // Probing costs a context, and they are scarce. Give it straight back.
  const lose = gl.getExtension('WEBGL_lose_context');
  if (lose) lose.loseContext();
  return null;
}

/**
 * Run a 3D build, reporting rather than hanging. `show` is handed a message to
 * put in front of the reader; it is called for a WebGL failure and for any other
 * error out of `build`, because either way the scrim has to come down.
 */
export async function guard3d(build, show) {
  const trouble = webglTrouble();
  if (trouble) { show(trouble); return null; }
  try {
    return await build();
  } catch (err) {
    const gl = /webgl|context/i.test(err && err.message || '');
    show(gl
      ? 'The 3D view could not start: this browser refused a WebGL context. '
        + 'chrome://gpu will say why; graphics acceleration being off is the '
        + 'usual cause, and Chrome turns it off itself after repeated crashes.'
      : `The 3D view could not be built: ${err && err.message || err}`);
    return null;
  }
}
