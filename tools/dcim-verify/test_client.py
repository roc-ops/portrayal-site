#!/usr/bin/env python3
"""verify.py's client, against a local mock: a token request never carries the
web session.

    python3 tools/dcim-verify/test_client.py

Found in the real-instance run of 2026-10-04: once the client had signed in to
Nautobot's web UI its cookie jar held the session, so every later REST request
that also sent the token was treated as session-authenticated and refused with
"CSRF Failed: CSRF token missing". A token-authenticated request now goes
through an opener with no cookie jar. Only the UI pages use the jar. Without a
token, a REST request rides the session and sends the CSRF cookie's value as
X-CSRFToken, with a Referer, when it is unsafe (POST, DELETE ...).

The mock listens on 127.0.0.1 only; nothing real is contacted.
"""
import http.server
import os
import sys
import threading
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import verify as V  # noqa: E402

TOKEN, PASSWORD, SESSION, CSRFCOOKIE = 'made-up-token-0123456789abcdef', 'made-up-pass-phrase-77', 'sess-abc123', 'csrfcookie-xyz789'
FORM = 'FORMFORMFORMFORMFORMFORMFORM1234'


class Handler(http.server.BaseHTTPRequestHandler):
    log = []

    def log_message(self, *a):
        pass

    def reply(self, code, body, ct='application/json', cookies=(), loc=None):
        b = body.encode()
        self.send_response(code)
        self.send_header('Content-Type', ct)
        self.send_header('Content-Length', str(len(b)))
        for c in cookies:
            self.send_header('Set-Cookie', c)
        if loc:
            self.send_header('Location', loc)
        self.end_headers()
        self.wfile.write(b)

    def handle_any(self):
        n = int(self.headers.get('Content-Length') or 0)
        self.rfile.read(n)
        Handler.log.append({'method': self.command, 'path': self.path, 'cookie': self.headers.get('Cookie'),
                            'csrf': self.headers.get('X-CSRFToken'), 'referer': self.headers.get('Referer'),
                            'auth': self.headers.get('Authorization')})
        if self.path.startswith('/login/') and self.command == 'GET':
            return self.reply(200, '<form><input type="hidden" name="csrfmiddlewaretoken" value="%s"></form>' % FORM,
                              'text/html', ['csrftoken=%s; Path=/' % CSRFCOOKIE])
        if self.path.startswith('/login/'):
            return self.reply(302, '', 'text/html', ['sessionid=%s; Path=/' % SESSION], '/')
        if self.path.startswith('/api/'):
            return self.reply(200, '{"results": [], "next": null}')
        return self.reply(200, '<html></html>', 'text/html')

    do_GET = do_POST = do_DELETE = handle_any


class TokenRequestsNeverCarryTheSession(unittest.TestCase):
    def setUp(self):
        Handler.log = []
        self.server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        threading.Thread(target=self.server.serve_forever, kwargs={'poll_interval': 0.01}, daemon=True).start()
        self.saved = dict(os.environ)
        for k in list(os.environ):
            if k.startswith(('NETBOX_', 'NAUTOBOT_')):
                del os.environ[k]
        os.environ.update({'NAUTOBOT_URL': 'http://127.0.0.1:%d' % self.server.server_address[1], 'NAUTOBOT_USER': 'someone',
                           'NAUTOBOT_PASSWORD': PASSWORD})

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        os.environ.clear()
        os.environ.update(self.saved)

    def api_requests(self):
        return [r for r in Handler.log if r['path'].startswith('/api/')]

    def test_a_client_that_has_signed_in_sends_no_cookie_on_a_token_request(self):
        os.environ['NAUTOBOT_TOKEN'] = TOKEN
        c = V.Client('nautobot')
        self.assertEqual(c.login(), (True, 'signed in'))
        c.page('/dcim/sites/import/')                     # a UI page after sign-in
        c.api('GET', '/api/status/')
        c.api('POST', '/api/dcim/manufacturers/', {'name': 'pt-verify-x'})
        c.api('DELETE', '/api/dcim/manufacturers/1/')
        c.api_list('/api/dcim/devices/?limit=5')
        api = self.api_requests()
        self.assertEqual([r['method'] for r in api], ['GET', 'POST', 'DELETE', 'GET'])
        for r in api:
            self.assertIsNone(r['cookie'], r)
            self.assertEqual(r['auth'], 'Token ' + TOKEN)
            self.assertIsNone(r['csrf'], r)
        # The UI requests still carry the jar: the sign-in's second request has the CSRF cookie, the page has both.
        ui = [r for r in Handler.log if not r['path'].startswith('/api/')]
        self.assertIsNone(ui[0]['cookie'])
        self.assertIn('csrftoken=' + CSRFCOOKIE, ui[1]['cookie'])
        self.assertIn('sessionid=' + SESSION, ui[2]['cookie'])
        self.assertIn('sessionid=' + SESSION, ui[-1]['cookie'])

    def test_without_a_token_a_read_uses_the_session_and_an_unsafe_request_sends_the_csrf_cookie(self):
        c = V.Client('nautobot')
        self.assertEqual(c.login(), (True, 'signed in'))
        c.api('GET', '/api/status/')
        c.api('POST', '/api/dcim/manufacturers/', {'name': 'pt-verify-x'})
        get, post = self.api_requests()
        self.assertIn('sessionid=' + SESSION, get['cookie'])
        self.assertIn('sessionid=' + SESSION, post['cookie'])
        self.assertEqual(post['csrf'], CSRFCOOKIE)         # the cookie's value, not the page's form field
        self.assertNotEqual(post['csrf'], FORM)
        self.assertEqual(post['referer'], c.base + '/')
        self.assertIsNone(post['auth'])


if __name__ == '__main__':
    unittest.main(verbosity=1)
