#!/usr/bin/env python3
"""verify.py's client, against a local mock: a token request never carries the
web session; no credential comes out, whatever it holds and whatever goes
wrong; no proxy is used; a base URL with a path pages through a list.

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
import contextlib
import http.client
import http.server
import io
import json
import os
import sys
import tempfile
import threading
import unittest
import unittest.mock
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import verify as V  # noqa: E402

TOKEN, PASSWORD, SESSION, CSRFCOOKIE = 'made-up-token-0123456789abcdef', 'made-up-pass-phrase-77', 'sess-abc123', 'csrfcookie-xyz789'
FORM = 'FORMFORMFORMFORMFORMFORMFORM1234'


class Handler(http.server.BaseHTTPRequestHandler):
    log = []
    prefix = ''          # the base URL's path, as when the instance is served under /netbox
    next_host = None     # the scheme and host a list's `next` link names, when not this server's own

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
        if self.path.startswith('/echo/'):
            # A page that repeats what the session sent: the cookies, the CSRF header, a script's copy of the token.
            return self.reply(200, '<html><script>window.CSRF_TOKEN = "%s";</script><form><input type="hidden" '
                              'name="csrfmiddlewaretoken" value="%s"></form><p class="alert">Cookie: %s</p></html>'
                              % (CSRFCOOKIE, FORM, self.headers.get('Cookie')), 'text/html')
        u = urllib.parse.urlsplit(self.path)
        if u.path.startswith(Handler.prefix + '/api/paged/'):
            # A list of five, two to a page; each `next` holds the base URL's own path, as a real instance's does,
            # and names whatever host Handler.next_host says (a proxy in front may report its own).
            offset = int(urllib.parse.parse_qs(u.query).get('offset', ['0'])[0])
            more = offset + 2 < 5
            nxt = '%s%s?offset=%d' % (Handler.next_host or 'http://%s' % self.headers.get('Host'), u.path, offset + 2) if more else None
            return self.reply(200, json.dumps({'results': [{'id': i} for i in range(offset, min(offset + 2, 5))], 'next': nxt}))
        if self.path.startswith('/api/'):
            return self.reply(200, '{"results": [], "next": null}')
        return self.reply(200, '<html></html>', 'text/html')

    do_GET = do_POST = do_DELETE = handle_any


class Other(http.server.BaseHTTPRequestHandler):
    """Somewhere a request must never go: a proxy, or the host a `next` link names. It records what reaches it."""
    log = []

    def log_message(self, *a):
        pass

    def handle_any(self):
        self.rfile.read(int(self.headers.get('Content-Length') or 0))
        Other.log.append({'method': self.command, 'path': self.path, 'auth': self.headers.get('Authorization'),
                          'cookie': self.headers.get('Cookie')})
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', '30')
        self.end_headers()
        self.wfile.write(b'{"results": [], "next": null} ')

    do_GET = do_POST = do_DELETE = do_CONNECT = handle_any


class TokenRequestsNeverCarryTheSession(unittest.TestCase):
    def setUp(self):
        Handler.log, Handler.prefix, Handler.next_host, Other.log = [], '', None, []
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


def read(path):
    with open(path, encoding='utf-8') as f:
        return f.read()


def fragments(case, secret, text, what):
    """No six characters of a credential in a row, and no traceback."""
    case.assertNotIn('Traceback', text, what)
    for k in range(len(secret) - 5):
        case.assertNotIn(secret[k:k + 6], text, '%s: a piece of a credential' % what)


class NoCredentialComesOut(TokenRequestsNeverCarryTheSession):
    """The rule import_cables.py follows, here: a credential is checked where it
    is read, and no exception's own text reaches the console or a file unredacted."""

    def setUp(self):
        super().setUp()
        self.dir = tempfile.TemporaryDirectory()
        self.other = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Other)
        threading.Thread(target=self.other.serve_forever, kwargs={'poll_interval': 0.01}, daemon=True).start()
        self.was = V.RESULT, V.OUT
        V.RESULT, V.OUT = os.path.join(self.dir.name, 'result.json'), os.path.join(self.dir.name, 'out')

    def tearDown(self):
        V.RESULT, V.OUT = self.was
        self.other.shutdown()
        self.other.server_close()
        self.dir.cleanup()
        super().tearDown()

    def said(self, fn):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = fn()
        return code, out.getvalue() + err.getvalue()

    def test_space_and_a_line_break_around_a_credential_are_dropped_where_it_is_read(self):
        # export NAUTOBOT_TOKEN="$(cat token.txt)" on a CR LF file: http.client refuses "Token x\r" with a ValueError
        # that quotes the header, and the redactor, looking for the value as it is, did not know it escaped.
        for tail in ('\r', '\n', '\r\n', ' ', '\t'):
            Handler.log = []
            os.environ.update({'NAUTOBOT_TOKEN': TOKEN + tail, 'NAUTOBOT_PASSWORD': PASSWORD + tail, 'NAUTOBOT_USER': 'someone' + tail})
            c = V.Client('nautobot')
            self.assertEqual((c.token, c.password, c.user), (TOKEN, PASSWORD, 'someone'), repr(tail))
            self.assertEqual(c.api('GET', '/api/status/').status, 200)
            self.assertEqual(Handler.log[-1]['auth'], 'Token ' + TOKEN, repr(tail))
            self.assertEqual(c.login(), (True, 'signed in'))
            code, text = self.said(lambda: V.main(['verify.py', 'cleanup', 'nautobot', '--dry-run']))
            self.assertEqual(code, 0, text)
            fragments(self, TOKEN, text, repr(tail))

    def test_a_credential_with_a_control_or_a_non_ascii_character_is_refused_without_being_shown(self):
        for name, good in (('NAUTOBOT_TOKEN', TOKEN), ('NAUTOBOT_PASSWORD', PASSWORD)):
            for bad in (good[:9] + '\r' + good[9:], good[:9] + '\n' + good[9:], good[:9] + '\x1b' + good[9:],
                        good[:9] + '\u00e9' + good[9:], good + '\u2028x', good[:9] + '\x7f' + good[9:]):
                Handler.log = []
                os.environ.update({'NAUTOBOT_TOKEN': TOKEN, 'NAUTOBOT_PASSWORD': PASSWORD, name: bad})
                with self.assertRaises(V.Refused) as got:
                    V.Client('nautobot')
                self.assertEqual(str(got.exception), '%s holds a control character or a character that is not ASCII, so it is not used. '
                                                     'Set it again; it is not shown here.' % name)
                # Through the commands: one line, nothing sent, and the result file holds no piece of it either.
                for argv in (['verify.py', 'cleanup', 'nautobot'], ['verify.py', 'run', 'nautobot']):
                    code, text = self.said(lambda: V.guarded(V.main, argv))
                    stored = read(V.RESULT) if argv[1] == 'run' else ''
                    self.assertIn('is not used. Set it again; it is not shown here.', text)
                    fragments(self, bad, text + stored, '%s %s' % (name, ascii(bad)))
                    self.assertEqual(Handler.log, [], ascii(bad))
        # A space inside a password is a password's own; it is used as it is.
        os.environ.update({'NAUTOBOT_TOKEN': TOKEN, 'NAUTOBOT_PASSWORD': 'two words'})
        self.assertEqual(V.Client('nautobot').password, 'two words')

    def test_the_redactor_knows_a_credential_however_an_error_spells_it(self):
        odd = 'ab\\cd\'ef"gh-0123456789-zyxwvu'            # a str repr and a bytes repr each spell this another way
        for token, tail in ((TOKEN, ''), (TOKEN, '\r'), (odd, ''), (odd, '\r\n')):
            os.environ['NAUTOBOT_TOKEN'] = token + tail
            header = ('Token ' + token + tail).encode()
            for text in ('Invalid header value %r' % header, repr('Token ' + token + tail), ascii(token), json.dumps({'t': token + tail}),
                         urllib.parse.quote(token, safe=''), urllib.parse.quote_plus(token + tail), 'Authorization: Token ' + token,
                         str(ValueError('Invalid header value %r' % header)), token):
                for out in (V.redact(text), V.problem(ValueError(text)), V.clip(text)):
                    fragments(self, token, out, ascii(text))

    def test_an_error_deep_in_a_request_reaches_neither_the_console_nor_the_result_file(self):
        os.environ['NAUTOBOT_TOKEN'] = TOKEN
        header = ('Token ' + TOKEN + '\r').encode()
        for exc in (ValueError('Invalid header value %r' % header), RuntimeError(repr('Token ' + TOKEN)), OSError(json.dumps(PASSWORD)),
                    UnicodeEncodeError('latin-1', TOKEN, 0, 1, 'ordinal not in range'), KeyError(TOKEN)):
            what = type(exc).__name__
            with unittest.mock.patch.object(http.client.HTTPConnection, 'putheader', side_effect=exc):
                # A step that reports (the prerequisite POST), a whole run, and cleanup.
                run = V.Run('nautobot')
                code, text = self.said(lambda: V.nt_post_json(V.Client('nautobot'), run, 'x', 'a step', '/api/dcim/manufacturers/', {'name': 'pt-verify-x'}))
                self.assertFalse(run.steps[0]['accepted'])
                self.assertRegex(run.steps[0]['messages'][0], r'^(%s|URLError): ' % what)      # urllib wraps an OSError
                V.write_result([run], 'now')
                stored = read(V.RESULT)
                for argv in (['verify.py', 'run', 'nautobot'], ['verify.py', 'cleanup', 'nautobot']):
                    code, more = self.said(lambda: V.guarded(V.main, argv))
                    text += more
                stored += read(V.RESULT)
            for secret in (TOKEN, PASSWORD):
                fragments(self, secret, text + stored, what)
        # An error nothing catches is one redacted line and exit 2; an interrupt, one line and exit 130.
        def boom(argv):
            raise ValueError('Invalid header value %r' % header)
        code, text = self.said(lambda: V.guarded(boom, []))
        self.assertEqual((code, text), (2, 'Stopped: ValueError: Invalid header value b\'Token ***\\r\'\n'))
        def stop(argv):
            raise KeyboardInterrupt
        code, text = self.said(lambda: V.guarded(stop, []))
        self.assertEqual((code, text.count('\n'), 'Traceback' in text), (130, 1, False))

    def test_a_saved_page_and_a_result_hold_no_csrf_value_and_no_cookie_value(self):
        c = V.Client('nautobot')
        self.assertEqual(c.login(), (True, 'signed in'))
        page = c.page('/echo/')
        for secret in (CSRFCOOKIE, SESSION, FORM):
            self.assertIn(secret, page.text)                       # the page really repeats them
        rel = V.save_page('nautobot-echo', page.text)
        saved = read(os.path.join(V.HERE, rel))
        self.assertTrue(os.path.realpath(os.path.join(V.HERE, rel)).startswith(os.path.realpath(self.dir.name)), 'saved under OUT')
        run = V.Run('nautobot')
        s = run.step('x', 'a step')
        s['messages'], s['notes'] = V.page_errors(page.text) + [page.text], ['X-CSRFToken: ' + c.csrf_cookie()]
        code, text = self.said(lambda: run.done(s))
        V.write_result([run], 'now')
        stored = read(V.RESULT)
        for secret in (CSRFCOOKIE, SESSION, FORM):
            fragments(self, secret, saved + stored + text, 'a session value')
        self.assertIn('window.CSRF_TOKEN = "***"', saved)

    def test_no_proxy_is_used_whatever_the_environment_says(self):
        proxy = 'http://127.0.0.1:%d' % self.other.server_address[1]
        for k in ('NO_PROXY', 'no_proxy'):
            os.environ.pop(k, None)
        os.environ.update({'HTTP_PROXY': proxy, 'http_proxy': proxy, 'HTTPS_PROXY': proxy, 'https_proxy': proxy, 'ALL_PROXY': proxy,
                           'NAUTOBOT_TOKEN': TOKEN})
        c = V.Client('nautobot')
        self.assertEqual(c.login(), (True, 'signed in'))
        c.api('GET', '/api/status/')
        c.api('DELETE', '/api/dcim/manufacturers/1/')
        c.page('/dcim/sites/import/')
        self.assertEqual(Other.log, [], 'a request went through the proxy')
        self.assertEqual(len([r for r in Handler.log if r['auth'] == 'Token ' + TOKEN]), 2)

    def test_a_base_url_with_a_path_pages_through_a_list_and_a_next_link_never_leaves_the_host(self):
        Handler.prefix = '/netbox'
        os.environ['NAUTOBOT_URL'] += '/netbox/'
        os.environ['NAUTOBOT_TOKEN'] = TOKEN
        elsewhere = 'http://127.0.0.1:%d' % self.other.server_address[1]
        for host in (None, elsewhere, 'https://another-name.invalid'):
            Handler.log, Handler.next_host = [], host
            got, err = V.Client('nautobot').api_list('/api/paged/?limit=2')
            self.assertEqual(([o['id'] for o in got], err), ([0, 1, 2, 3, 4], None), host)
            paths = [r['path'] for r in Handler.log]
            self.assertEqual(paths, ['/netbox/api/paged/?limit=2', '/netbox/api/paged/?offset=2', '/netbox/api/paged/?offset=4'], host)
            self.assertEqual(Other.log, [], 'the host a next link named was asked')
        # A request for another host is refused outright, and so is a link the client is handed whole.
        c = V.Client('nautobot')
        for bad in (elsewhere + '/api/dcim/devices/', 'https://127.0.0.1:%d/api/' % self.server.server_address[1]):
            with self.assertRaises(V.Refused):
                c.api('GET', bad)
        self.assertEqual(Other.log, [])


if __name__ == '__main__':
    unittest.main(verbosity=1)
