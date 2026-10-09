#!/usr/bin/env python3
"""A dev server that is not the bottleneck.

`python -m http.server` speaks HTTP/1.0 and closes the connection after every
response. Over loopback that costs nothing. Over a real interface - opening the
site at a LAN address so another machine, or another browser profile, can reach
it - every one of the ~24 requests a single 3D device needs pays a fresh TCP
handshake. Measured on one machine, same files, same server binary:

    http://localhost:8177        1-5 ms per file
    http://<LAN address>:8932  166-1113 ms per file

which turned a 1.5 s first 3D load into ten seconds, and looked exactly like an
application regression. It was not one.

So: HTTP/1.1 with keep-alive, threaded, and cache headers that let a browser
reuse a drawing it already has. The compiled SVGs are immutable for a given
config name - a rebuild writes new content under the same name only when the
drawing genuinely changed - so they are given a short cache lifetime with
revalidation rather than no-store, which is what the viewer library asks for
today. Not a production server; it is a dev server that does not lie to you
about how fast the site is.

THIS MACHINE ONLY, by default: binding 0.0.0.0 puts a listing of the checkout
on the local network. PORTRAYAL_SERVE_HOST=0.0.0.0 (or --bind) opts back in,
for opening the site from another machine - the same switch as Portrayal's
tools/serve.py.
"""
import argparse, functools, http.server, os, socketserver, sys


class Handler(http.server.SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"       # the whole point: keep the connection

    def end_headers(self):
        path = self.path.split("?")[0]
        if path.startswith(("/assets/", "/vendor/", "/brand/")):
            # Immutable-ish build output. Revalidation is cheap on a kept-alive
            # connection and correct if a refresh rewrites a file in place.
            self.send_header("Cache-Control", "public, max-age=60, must-revalidate")
        else:
            # EVERYTHING ELSE IS SOURCE, AND SOURCE IS BEING EDITED.
            # `no-cache` still lets a reload serve a stale body out of the
            # memory cache. Three times now I have read a stale module, a stale
            # page or a stale device list as a bug in code that was already
            # correct, and scoping the rule to one directory just moved the
            # trap somewhere else. On a dev server nothing outside the built
            # assets above is worth caching at all.
            self.send_header("Cache-Control", "no-store")
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
    ap.add_argument("--bind", default=os.environ.get("PORTRAYAL_SERVE_HOST", "127.0.0.1"))
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
