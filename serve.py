#!/usr/bin/env python3
"""A dev server that is not the bottleneck.

`python -m http.server` speaks HTTP/1.0 and closes the connection after every
response. Over loopback that costs nothing. Over a real interface - opening the
site at a LAN address so another machine, or another browser profile, can reach
it - every one of the ~24 requests a single 3D device needs pays a fresh TCP
handshake. Measured on one machine, same files, same server binary:

    http://localhost:8177        1-5 ms per file
    http://10.22.11.75:8932    166-1113 ms per file

which turned a 1.5 s first 3D load into ten seconds, and looked exactly like an
application regression. It was not one.

So: HTTP/1.1 with keep-alive, threaded, and cache headers that let a browser
reuse a drawing it already has. The compiled SVGs are immutable for a given
config name - a rebuild writes new content under the same name only when the
drawing genuinely changed - so they are given a short cache lifetime with
revalidation rather than no-store, which is what the viewer library asks for
today. Not a production server; it is a dev server that does not lie to you
about how fast the site is.
"""
import argparse, functools, http.server, socketserver, sys


class Handler(http.server.SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"       # the whole point: keep the connection

    def end_headers(self):
        path = self.path.split("?")[0]
        if path.startswith(("/assets/", "/vendor/", "/brand/")):
            # Immutable-ish build output. Revalidation is cheap on a kept-alive
            # connection and correct if a refresh rewrites a file in place.
            self.send_header("Cache-Control", "public, max-age=60, must-revalidate")
        else:
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, fmt, *args):
        if VERBOSE:
            super().log_message(fmt, *args)


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("port", nargs="?", type=int, default=8177)
    ap.add_argument("--bind", default="0.0.0.0")
    ap.add_argument("-v", "--verbose", action="store_true")
    a = ap.parse_args()
    VERBOSE = a.verbose
    handler = functools.partial(Handler, directory=str(__import__("pathlib").Path(__file__).parent))
    with Server((a.bind, a.port), handler) as httpd:
        print(f"serving {__file__.rsplit('/',1)[0]} on http://{a.bind}:{a.port} "
              f"(HTTP/1.1, keep-alive)", file=sys.stderr)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
