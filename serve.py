#!/usr/bin/env python3
"""Serve the site. The showcase fetches compiled SVGs, so file:// will not do.

    python3 serve.py [port]
"""
import http.server
import sys
import os

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8932


class Server(http.server.ThreadingHTTPServer):
    # Threaded, not TCPServer: building the 3D model opens a face texture, a
    # punch mask and a component skin at the same time, and a single-threaded
    # handler holding one keep-alive connection deadlocks the whole page.
    daemon_threads = True
    allow_reuse_address = True
    # The default backlog is 5. The 3D build arrives as a burst of dozens of
    # requests, and connections past the backlog are dropped by the kernel
    # rather than refused, which the browser experiences as an indefinite hang.
    request_queue_size = 128


class Handler(http.server.SimpleHTTPRequestHandler):
    # HTTP/1.1 so the browser reuses connections instead of opening one per
    # asset. SimpleHTTPRequestHandler already sends Content-Length for files,
    # which is what makes keep-alive safe here.
    protocol_version = 'HTTP/1.1'

    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      '.svg': 'image/svg+xml', '.js': 'text/javascript',
                      '.json': 'application/json', '.css': 'text/css'}

    def end_headers(self):
        # Revalidate, do not refuse to cache. A blanket no-store meant the
        # browser re-downloaded every drawing each time something asked for it -
        # the AS7726 front view came down six times in one session, 457 KB of
        # the same 76 KB file. must-revalidate still catches a refreshed
        # snapshot, because SimpleHTTPRequestHandler answers a conditional
        # request with 304 when the mtime has not moved.
        self.send_header('Cache-Control', 'no-cache, must-revalidate')
        super().end_headers()

    def log_message(self, fmt, *args):
        msg = fmt % args
        if ' 404 ' in msg or ' 500 ' in msg:
            sys.stderr.write(f'{self.address_string()} {msg}\n')


os.chdir(os.path.dirname(os.path.abspath(__file__)))
with Server(('', PORT), Handler) as httpd:
    print(f'portrayal.dev preview -> http://localhost:{PORT}/')
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print('\nstopped')
