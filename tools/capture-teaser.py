#!/usr/bin/env python3
"""Capture the coming-soon teaser's two visuals from the real front-page hero.

The teaser (coming-soon/) is public and self-contained: it must not ship the
vendored Portrayal kit or assets/ while Portrayal is private. So it shows
pixels captured from the real renderer instead of running it:

  coming-soon/hero-switch.png   the 2D hero with the divider fully open - the
                                whole S9600-72XC, every seated part, every cable
  coming-soon/hero-3d.webm/.mp4 the 3D hero over exactly one sway period, so it
                                loops seamlessly (VP9 WebM + H.264 MP4)
  coming-soon/hero-3d-poster.jpg the video's first frame, for loading and for
                                reduced motion

Run from the repo root:  python3 tools/capture-teaser.py
It serves this checkout itself, on a free port, in the dark theme the teaser
uses. The 3D sway is driven through the hero's ?heroprobe=1 hook `aim(az)` as
a sine between the hero's own +/-SWAY limits, one period of PERIOD seconds, so
the last frame meets the first. The recording is made in the page with
MediaRecorder on the canvas (no ffmpeg needed).
"""
import base64, contextlib, socket, subprocess, sys, time
from pathlib import Path

from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent.parent
OUT = HERE / "coming-soon"
PERIOD = 20.0          # seconds for one full left-right-left sway
FPS = 30
WIDTH = 1120           # the teaser's content width, CSS px
SCALE = 2              # device pixel ratio: a sharp still on high-dpi screens
VIDEO_SCALE = 1.5      # the video's DPR: sharp enough, and a few MB, not tens


def free_port():
    with contextlib.closing(socket.socket()) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def main():
    port = free_port()
    server = subprocess.Popen([sys.executable, "serve.py", str(port), "--bind", "127.0.0.1"],
                              cwd=HERE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    base = f"http://127.0.0.1:{port}"
    try:
        time.sleep(1)
        with sync_playwright() as p:
            browser = p.chromium.launch(args=["--use-angle=metal", "--ignore-gpu-blocklist",
                                              "--enable-gpu-rasterization"])
            still(browser, base)
            video(browser, base)
            browser.close()
    finally:
        server.terminate()


def still(browser, base):
    page = browser.new_page(viewport={"width": WIDTH + 64, "height": 900},
                            device_scale_factor=SCALE, color_scheme="dark")
    page.goto(f"{base}/index.html", wait_until="load")
    page.wait_for_selector("#hero-reveal [data-hero-cable]", timeout=120000)
    # Divider fully open: the whole addressable drawing, nothing of the PNG.
    page.evaluate("""() => { const r = document.querySelector('#hero-reveal .reveal-range');
        r.value = '0'; r.dispatchEvent(new Event('input', {bubbles: true})); }""")
    # The divider's own handle and the two side tags are controls, not the picture.
    page.add_style_tag(content="#hero-reveal .reveal-handle, #hero-reveal .reveal-tags,"
                               " #hero-reveal .reveal-range { display: none !important; }")
    page.wait_for_timeout(500)
    page.locator("#hero-reveal .reveal-frame").screenshot(path=str(OUT / "hero-switch.png"))
    page.close()
    print("still:", OUT / "hero-switch.png")


def video(browser, base):
    page = browser.new_page(viewport={"width": WIDTH + 64, "height": 900},
                            device_scale_factor=VIDEO_SCALE, color_scheme="dark")
    page.goto(f"{base}/index.html?heroprobe=1", wait_until="load")
    page.locator("#hero-3d").scroll_into_view_if_needed()
    page.wait_for_function("() => window.__hero3d && window.__hero3d.tubes.length >= 21", timeout=240000)
    page.add_style_tag(content="[data-hero-hint] { display: none !important; }")
    page.evaluate("() => window.__hero3d.aim(0)")
    page.wait_for_timeout(1500)   # faces and relief settle

    # Poster: the first frame of the loop. A screenshot of the canvas element,
    # not toDataURL - a WebGL canvas without preserveDrawingBuffer reads back
    # blank between frames, which is what the first capture got.
    page.locator("#hero-3d canvas").screenshot(path=str(OUT / "hero-3d-poster.jpg"), type="jpeg", quality=88)

    for mime, name in (("video/webm;codecs=vp9", "hero-3d.webm"),
                       ("video/mp4;codecs=avc1.640028", "hero-3d.mp4")):
        data = page.evaluate("""async ([mime, period, fps]) => {
            if (!MediaRecorder.isTypeSupported(mime)) return {error: 'unsupported ' + mime};
            // Recorded from a 2D copy, filled in the same task as each render:
            // the WebGL canvas's buffer is not preserved, and recording it
            // directly gave a frozen first frame.
            const gl = document.querySelector('#hero-3d canvas');
            const canvas = document.createElement('canvas');
            canvas.width = gl.width; canvas.height = gl.height;
            const ctx = canvas.getContext('2d');
            const copy = () => ctx.drawImage(gl, 0, 0);
            const stream = canvas.captureStream(fps);
            const rec = new MediaRecorder(stream, {mimeType: mime, videoBitsPerSecond: 2500000});
            const chunks = [];
            rec.ondataavailable = e => e.data.size && chunks.push(e.data);
            const done = new Promise(r => rec.onstop = r);
            const sway = window.__hero3d.sway;
            window.__hero3d.aim(0); copy();
            await new Promise(r => requestAnimationFrame(r));
            rec.start();
            const t0 = performance.now();
            let frames = 0;
            await new Promise(resolve => {
                const step = () => {
                    const t = (performance.now() - t0) / 1000;
                    if (t >= period) return resolve();
                    window.__hero3d.aim(sway * Math.sin(2 * Math.PI * t / period));
                    copy();
                    frames++;
                    requestAnimationFrame(step);
                };
                requestAnimationFrame(step);
            });
            window.__hero3d.aim(0); copy();
            await new Promise(r => requestAnimationFrame(r));
            rec.stop();
            await done;
            const blob = new Blob(chunks, {type: mime.split(';')[0]});
            const buf = new Uint8Array(await blob.arrayBuffer());
            let bin = '';
            for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
            return {b64: btoa(bin), fps: frames / period};
        }""", [mime, PERIOD, FPS])
        if "error" in data:
            print(name, data["error"]); continue
        (OUT / name).write_bytes(base64.b64decode(data["b64"]))
        print(f"video: {OUT / name}  {(OUT / name).stat().st_size / 1e6:.1f} MB  "
              f"rendered {data['fps']:.1f} fps")
    page.close()


if __name__ == "__main__":
    main()
