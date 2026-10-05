#!/usr/bin/env python3
"""verify.py cleanup, against a hostile local mock.

    python3 tools/dcim-verify/test_cleanup.py

cleanup is the only code here that DELETES from a real instance, with an
administrator's credentials. What keeps it to this kit's own objects is one
check on this side: an object is deleted only when its OWN identifying field
(a cable's label, a type's model, anything else's name) is text that starts
with pt-verify-. These tests give it an instance that does everything else
wrong: it ignores the name filter, or refuses it; it lists objects that carry
the prefix anywhere but in that field, or nearly in it (a space before it,
another case); it pages; its `next` link names another host; an id is shaped
like a path. In every case: no DELETE for anything else, none at all under
--dry-run, and no request to the other host.

The mocks listen on 127.0.0.1 only; nothing real is contacted.
"""
import contextlib
import http.server
import io
import json
import os
import sys
import threading
import unittest
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import verify as V  # noqa: E402

TOKEN, PASSWORD = 'made-up-token-0123456789abcdef', 'made-up-pass-phrase-77'
P = V.PREFIX
# Never to be deleted, whatever list they are in: `field` is that list's identifying field.
def others(field):
    return [
        {'id': 101, field: 'core-1'},                                                     # no prefix at all
        {'id': 102, field: 'core-2', 'description': P + 'x', 'display': P + 'core-2', 'slug': P + 'core-2',
         'comments': P, 'tags': [P + 'tag'], 'asset_tag': P + '1', 'serial': P,
         'name' if field != 'name' else 'label': P + 'in-another-field',
         'manufacturer': {'name': P + 'Acme'}, 'device': {'name': P + 'a'}, 'site': {'name': P + 'site'}},
        {'id': 103, field: ' ' + P + 'leading-space'},
        {'id': 104, field: '\t' + P + 'leading-tab'},
        {'id': 105, field: P.upper() + 'upper-case'},
        {'id': 106, field: 'Pt-Verify-title-case'},
        {'id': 107, field: 'x' + P + 'inside'},
        {'id': 108, field: P[:-1]},                                                       # the prefix, one character short
        {'id': 109, field: None},
        {'id': 110, field: [P + 'a-list']},
        {'id': 111, field: {'value': P + 'a-dict'}},
        {'id': 112},
        {field: P + 'no-id'},                                                             # nothing to address a DELETE to
        {'id': None, field: P + 'null-id'},
        {'id': '', field: P + 'blank-id'},
        {'id': True, field: P + 'bool-id'},
        'not an object',
    ]


class State:
    def __init__(self):
        self.objects = {}            # list path -> its objects
        self.requests = []           # (method, path, headers)
        self.ignore_filter = True    # the list comes back whole, whatever __isw asks
        self.refuse_filter = False   # the list refuses __isw (HTTP 400), as a version without it would
        self.page_size = 3
        self.next_host = None        # the scheme and host a `next` link names, when not this server's
        self.prefix = ''             # the base URL's path
        self.fail_delete = False


def handler(st):
    class H(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def send(self, code, data, cookies=(), loc=None, ct='application/json'):
            body = data if isinstance(data, bytes) else (data if isinstance(data, str) else json.dumps(data)).encode()
            self.send_response(code)
            self.send_header('Content-Type', ct)
            self.send_header('Content-Length', str(len(body)))
            for c in cookies:
                self.send_header('Set-Cookie', c)
            if loc:
                self.send_header('Location', loc)
            self.end_headers()
            self.wfile.write(body)

        def any(self):
            self.rfile.read(int(self.headers.get('Content-Length') or 0))
            st.requests.append((self.command, self.path, dict(self.headers)))
            u = urllib.parse.urlsplit(self.path)
            path = u.path[len(st.prefix):] if st.prefix and u.path.startswith(st.prefix + '/') else u.path
            q = {k: v[0] for k, v in urllib.parse.parse_qs(u.query).items()}
            if path.startswith('/login/'):                                # NetBox without a token: the web sign-in
                if self.command == 'GET':
                    return self.send(200, '<form><input type="hidden" name="csrfmiddlewaretoken" value="FORMFORMFORMFORMFORMFORM1234"></form>',
                                     ['csrftoken=csrfcookie-xyz789; Path=/'], ct='text/html')
                return self.send(302, '', ['sessionid=sess-abc123; Path=/'], '/', ct='text/html')
            if not path.startswith('/api/'):
                return self.send(200, '<form><input type="hidden" name="csrfmiddlewaretoken" value="FORMFORMFORMFORMFORMFORM1234"></form>', ct='text/html')
            if self.command == 'DELETE':
                return self.send(500 if st.fail_delete else 204, b'')
            rows = st.objects.get(path, [])
            isw = next((k for k in q if k.endswith('__isw')), None)
            if isw and st.refuse_filter:
                return self.send(400, {isw: ['Unknown filter field']})
            if isw and not st.ignore_filter:
                rows = [o for o in rows if isinstance(o, dict) and str(o.get(isw[:-5]) or '').lower().startswith(q[isw].lower())]
            offset = int(q.get('offset', 0))
            nxt = None
            if offset + st.page_size < len(rows):
                q['offset'] = str(offset + st.page_size)
                nxt = '%s%s?%s' % (st.next_host or 'http://%s' % self.headers.get('Host'), u.path, urllib.parse.urlencode(q))
            self.send(200, {'count': len(rows), 'next': nxt, 'results': rows[offset:offset + st.page_size]})

        do_GET = do_POST = do_DELETE = any
    return H


class Elsewhere(http.server.BaseHTTPRequestHandler):
    """The host a `next` link names. Nothing may ever reach it."""
    log = []

    def log_message(self, *a):
        pass

    def any(self):
        Elsewhere.log.append((self.command, self.path, self.headers.get('Authorization'), self.headers.get('Cookie')))
        body = json.dumps({'results': [{'id': 999, 'name': P + 'from-elsewhere', 'label': P + 'from-elsewhere',
                                        'model': P + 'from-elsewhere'}], 'next': None}).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    do_GET = do_POST = do_DELETE = any


class Cleanup(unittest.TestCase):
    def setUp(self):
        self.st = State()
        Elsewhere.log = []
        self.server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler(self.st))
        self.elsewhere = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Elsewhere)
        for s in (self.server, self.elsewhere):
            threading.Thread(target=s.serve_forever, kwargs={'poll_interval': 0.01}, daemon=True).start()
        self.url = 'http://127.0.0.1:%d' % self.server.server_address[1]
        self.saved = dict(os.environ)
        for k in list(os.environ):
            if k.startswith(('NETBOX_', 'NAUTOBOT_')) or k.lower().endswith('_proxy'):
                del os.environ[k]
        os.environ.update({'NETBOX_URL': self.url, 'NETBOX_TOKEN': TOKEN, 'NAUTOBOT_URL': self.url, 'NAUTOBOT_TOKEN': TOKEN})

    def tearDown(self):
        for s in (self.server, self.elsewhere):
            s.shutdown()
            s.server_close()
        os.environ.clear()
        os.environ.update(self.saved)

    def fill(self, target):
        """Every list cleanup asks for, holding this kit's objects among everything it must leave. Returns the
        DELETE paths that are right: each of this kit's objects, once."""
        want = []
        for n, (ep, field) in enumerate(V.CLEAN[target]):
            mine = [{'id': n * 10 + k, field: '%s%s-%d' % (P, field, k)} for k in range(1, 6)]
            mine.append({'id': 'uuid-%d' % n, field: P})                                 # the prefix alone is this kit's too
            rows = others(field)
            # This kit's objects are spread through the list, so every page holds some of each.
            for k, o in enumerate(mine):
                rows.insert(k * 3, o)
            self.st.objects[ep] = rows
            want += ['%s%s%s/' % (self.st.prefix, ep, o['id']) for o in mine]
        return want

    def run_cleanup(self, *args):
        out = io.StringIO()
        self.st.requests.clear()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
            code = V.guarded(V.main, ['verify.py', 'cleanup', *args])
        return code, out.getvalue()

    def deletes(self):
        return [p for m, p, _ in self.st.requests if m == 'DELETE']

    def test_only_objects_whose_own_field_starts_with_the_prefix_are_deleted_whatever_the_filter_did(self):
        for target in ('netbox', 'nautobot'):
            for mode in ('ignored', 'refused', 'kept'):
                self.st.ignore_filter, self.st.refuse_filter = mode == 'ignored', mode == 'refused'
                want = self.fill(target)
                code, text = self.run_cleanup(target)
                self.assertEqual(sorted(self.deletes()), sorted(want), '%s, the filter %s' % (target, mode))
                self.assertEqual(code, 0, text)
                # Said by name, and nothing else is: not one of the objects left alone is called deleted.
                self.assertEqual(text.count(' deleted /api/'), len(want), text)
                for word in ('core-1', 'core-2', 'leading-space', 'upper-case', 'title-case', 'inside', 'a-list', 'a-dict', 'no-id',
                             'null-id', 'blank-id', 'bool-id', 'in-another-field'):
                    self.assertNotIn(word, text, '%s, the filter %s' % (target, mode))
                # Every page was read: this kit's objects sat on each of them.
                lists = [p for m, p, _ in self.st.requests if m == 'GET' and 'offset=' in p]
                self.assertGreaterEqual(len(lists), len(V.CLEAN[target]) * 3, 'paged')
                self.assertTrue(all(h.get('Authorization', '').endswith(TOKEN) for _, _, h in self.st.requests))

    def test_a_dry_run_deletes_nothing_and_names_what_it_would(self):
        for target in ('netbox', 'nautobot'):
            want = self.fill(target)
            code, text = self.run_cleanup(target, '--dry-run')
            self.assertEqual((code, self.deletes()), (0, []), target)
            self.assertTrue(all(m == 'GET' for m, _, _ in self.st.requests), 'a dry run only reads')
            self.assertEqual(text.count(' would delete /api/'), len(want), text)
            self.assertNotIn(' deleted ', text)
        # Wherever the flag stands on the command line.
        self.fill('netbox')
        self.assertEqual((self.run_cleanup('--dry-run', 'netbox')[0], self.deletes()), (0, []))
        self.assertEqual((self.run_cleanup('all', '--dry-run')[0], self.deletes()), (0, []))

    def test_a_next_link_to_another_host_is_never_followed_there(self):
        for host in ('http://127.0.0.1:%d' % self.elsewhere.server_address[1], 'http://localhost:%d' % self.elsewhere.server_address[1]):
            self.st.next_host = host
            for target in ('netbox', 'nautobot'):
                want = self.fill(target)
                code, text = self.run_cleanup(target)
                # The other host got no request, so no token, and nothing it could have listed was deleted.
                self.assertEqual(Elsewhere.log, [], host)
                self.assertFalse(any('999' in p for p in self.deletes()))
                self.assertNotIn('from-elsewhere', text)
                # The link's path was asked for on THIS host, so the later pages were still cleaned up.
                self.assertEqual(sorted(self.deletes()), sorted(want), target)
                self.assertTrue(all(h.get('Host', '').startswith('127.0.0.1:%d' % self.server.server_address[1]) for _, _, h in self.st.requests))

    def test_a_base_url_with_a_path_pages_and_deletes_under_that_path(self):
        self.st.prefix = '/netbox'
        os.environ['NETBOX_URL'] = self.url + '/netbox/'
        want = self.fill('netbox')
        code, text = self.run_cleanup('netbox')
        paths = [p for _, p, _ in self.st.requests]
        self.assertTrue(all(p.startswith('/netbox/api/') for p in paths), paths[:5])
        self.assertFalse(any('/netbox/netbox' in p for p in paths), 'the base URL\'s path was put in twice')
        self.assertEqual((code, sorted(self.deletes())), (0, sorted(want)))

    def test_an_id_shaped_like_a_path_stays_one_segment_of_its_own_list(self):
        self.fill('netbox')
        self.st.objects['/api/dcim/devices/'] = [{'id': '../../users/users/1', 'name': P + 'path'}, {'id': '7/../../sites/1', 'name': P + 'path-2'},
                                                 {'id': '5?force=1#x', 'name': P + 'query'}]
        self.run_cleanup('netbox')
        got = [p for p in self.deletes() if p.startswith('/api/dcim/devices/')]
        self.assertEqual(got, ['/api/dcim/devices/..%2F..%2Fusers%2Fusers%2F1/', '/api/dcim/devices/7%2F..%2F..%2Fsites%2F1/',
                               '/api/dcim/devices/5%3Fforce%3D1%23x/'])
        self.assertFalse(any('/users/' in p or '?' in p for p in self.deletes()))

    def test_netbox_without_a_token_signs_in_and_deletes_with_the_sessions_csrf_value(self):
        del os.environ['NETBOX_TOKEN']
        os.environ.update({'NETBOX_USER': 'someone', 'NETBOX_PASSWORD': PASSWORD})
        want = self.fill('netbox')
        code, text = self.run_cleanup('netbox')
        self.assertEqual((code, sorted(self.deletes())), (0, sorted(want)), text)
        for m, p, h in self.st.requests:
            if m == 'DELETE':
                low = {k.lower(): v for k, v in h.items()}
                self.assertEqual((low.get('x-csrftoken'), 'sessionid=sess-abc123' in low.get('cookie', '')), ('csrfcookie-xyz789', True))
        for secret in (PASSWORD, 'csrfcookie-xyz789', 'sess-abc123'):
            self.assertNotIn(secret, text)
        # Without a token Nautobot is not touched at all.
        del os.environ['NAUTOBOT_TOKEN']
        code, text = self.run_cleanup('nautobot')
        self.assertEqual((code, self.st.requests), (1, []))
        self.assertIn('NAUTOBOT_TOKEN is not set.', text)

    def test_a_delete_the_instance_refuses_and_a_list_it_will_not_give_are_failures_that_are_said(self):
        self.fill('netbox')
        self.st.fail_delete = True
        code, text = self.run_cleanup('netbox')
        self.assertEqual(code, 1)
        self.assertIn('COULD NOT DELETE (HTTP 500', text)
        self.st.fail_delete, self.st.refuse_filter = False, True
        self.st.objects = {}
        code, text = self.run_cleanup('netbox')
        self.assertEqual((code, self.deletes()), (0, []))
        self.assertIn('nothing named pt-verify-', text)


if __name__ == '__main__':
    unittest.main(verbosity=1)
