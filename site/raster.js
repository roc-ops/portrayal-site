// Rasterise a compiled drawing to PNG in the browser.
//
// The DCIM libraries carry an images tree and neither YAML schema has a field
// for one, so the pictures are pure convention - which means they can be made
// at download time instead of being carried in the repository. They were 74% of
// this repository's pack from 319 blobs, against 4.6 MB for 2043 SVGs, because
// PNG does not delta-compress and a rebuild rewrites every one of them.
//
// The output is the browser's renderer rather than cairosvg's. Checked against
// a cairosvg render of the same face: same geometry, same silkscreen, same
// lamps. Both resolve `var(--led-color, #3a3f44)` to the fallback, which is the
// unlit faceplate - the right picture for a type, which has no live state.

/** 2 px/mm at the drawing's own scale, matching what the exporter wrote. */
const SCALE = 2;

const cache = new Map();

async function svgImage(url) {
  if (!cache.has(url)) {
    cache.set(url, (async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
      const text = await res.text();
      const bytes = new TextEncoder().encode(text);
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      }
      const img = new Image();
      await new Promise((ok, no) => {
        img.onload = ok;
        img.onerror = () => no(new Error(`${url}: not renderable`));
        // A data URI, not a blob URL: an <img> loading an SVG is a document of
        // its own and will not reach back out for anything, so everything the
        // drawing needs has to already be inside it. It is - the compiled
        // output is flat by design.
        img.src = 'data:image/svg+xml;base64,' + btoa(bin);
      });
      return img;
    })().catch(e => { cache.delete(url); throw e; }));
  }
  return cache.get(url);
}

/** One compiled face as PNG bytes, or null if it is not there. */
export async function rasterize(url, scale = SCALE) {
  let img;
  try {
    img = await svgImage(url);
  } catch {
    return null;
  }
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(img, 0, 0, w, h);
  const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
  if (!blob) return null;
  return new Uint8Array(await blob.arrayBuffer());
}
