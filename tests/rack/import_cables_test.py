#!/usr/bin/env python3
"""Tests of site/rack/nautobot/import_cables.py against a mock Nautobot.

    python3 tests/rack/import_cables_test.py

The mock is a local HTTP server that answers the few REST calls the script
makes, in the shapes a real Nautobot 3.2.6 gave (the verification run of
2026-10-04): a paginated list for a GET, a JSON list for a text/csv POST. No
real Nautobot is contacted, and the token used here is made up.
"""
import contextlib
import http.server
import importlib.util
import io
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import threading
import unittest
import urllib.parse

HERE = pathlib.Path(__file__).resolve().parent
SCRIPT = HERE.parent.parent / 'site' / 'rack' / 'nautobot' / 'import_cables.py'
spec = importlib.util.spec_from_file_location('import_cables', SCRIPT)
import_cables = importlib.util.module_from_spec(spec)
spec.loader.exec_module(import_cables)

TOKEN = 'made-up-token-0123456789abcdef'
HEADER = 'a_device,a_type,a_name,b_device,b_type,b_name,type,status,label,color,length,length_unit\n'
GOOD = HEADER + ('leaf-1,dcim.interface,port-1,core-1,dcim.interface,slot-2/p0,smf-os2,Planned,A1,,2,m\n'
                 'leaf-1,dcim.interface,mgmt-eth,demarc-i3,dcim.interface,port-2-1,cat6a,Planned,c2,,,\n')


class Mock:
    """What the mock Nautobot holds, and what it was asked."""

    def __init__(self):
        self.devices = ['core-1', 'leaf-1', 'demarc-i3']
        self.ports = {  # (list, device) -> names
            ('interfaces', 'leaf-1'): ['port-1', 'port-2', 'mgmt-eth'],
            ('interfaces', 'core-1'): ['slot-2/p0', 'slot-2/p1'],
            ('interfaces', 'demarc-i3'): ['port-2-1'],
            ('console-ports', 'demarc-i3'): ['Console']}
        self.cabled = set()          # port ids that already have a cable
        self.requests = []           # (method, path, headers, body)
        self.ignore_device_filter = False
        self.drop_ends = False       # create the cable without its ends, as a name-based import does
        self.redirect = None
        self.page_size = 1000

    def port_id(self, lst, device, name):
        return '%s:%s:%s' % (lst, device, name)


def handler(mock):
    class H(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def send(self, code, data, headers=None):
            body = json.dumps(data).encode()
            self.send_response(code)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            for k, v in (headers or {}).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(body)

        def record(self, body=''):
            mock.requests.append((self.command, self.path, dict(self.headers), body))
            if mock.redirect:
                self.send(302, {}, {'Location': mock.redirect})
                return False
            if self.headers.get('Authorization') != 'Token ' + TOKEN:
                self.send(403, {'detail': 'Invalid token.'})
                return False
            return True

        def do_GET(self):
            if not self.record():
                return
            u = urllib.parse.urlsplit(self.path)
            q = {k: v[0] for k, v in urllib.parse.parse_qs(u.query).items()}
            lst = u.path.strip('/').split('/')[-1]
            if lst == 'devices':
                rows = [{'id': 'dev:' + d, 'name': d} for d in mock.devices if d == q.get('name')]
            else:
                device = q.get('device')
                if device not in mock.devices and not mock.ignore_device_filter:
                    return self.send(400, {'device': ['Select a valid choice. %s is not one of the available choices.' % device]})
                rows = [{'id': mock.port_id(l, d, n), 'name': n, 'cable': {'id': 'x'} if mock.port_id(l, d, n) in mock.cabled else None}
                        for (l, d), names in mock.ports.items() for n in names
                        if l == lst and (mock.ignore_device_filter or d == device)]
            offset = int(q.get('offset', 0))
            page, more = rows[offset:offset + mock.page_size], offset + mock.page_size < len(rows)
            nxt = None
            if more:
                q['offset'] = str(offset + mock.page_size)
                nxt = 'http://another-name.invalid%s?%s' % (u.path, urllib.parse.urlencode(q))   # as behind a proxy
            self.send(200, {'count': len(rows), 'next': nxt, 'results': page})

        def do_POST(self):
            body = self.rfile.read(int(self.headers.get('Content-Length') or 0)).decode()
            if not self.record(body):
                return
            if self.headers.get('Content-Type') != 'text/csv' or self.path != '/api/dcim/cables/':
                return self.send(400, {'detail': 'not a CSV cable import'})
            head, row = [l.split(',') for l in body.strip().split('\n')]
            d = dict(zip(head, row))
            if d.get('length') and not d['length'].isdigit():
                return self.send(400, [{'length': ['A valid integer is required.']}])
            made = {'id': 'cable-%d' % len(mock.requests), 'label': d.get('label', ''),
                    'termination_a_type': d['termination_a_type'], 'termination_a_id': d['termination_a_id'],
                    'termination_b_type': d['termination_b_type'], 'termination_b_id': d['termination_b_id']}
            if mock.drop_ends:
                made.update(termination_a_type=None, termination_a_id=None, termination_b_type=None, termination_b_id=None)
            else:
                mock.cabled.update([d['termination_a_id'], d['termination_b_id']])
            self.send(201, [made])
    return H


class ImportCables(unittest.TestCase):
    def setUp(self):
        self.mock = Mock()
        self.server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler(self.mock))
        threading.Thread(target=self.server.serve_forever, kwargs={'poll_interval': 0.01}, daemon=True).start()
        self.url = 'http://127.0.0.1:%d' % self.server.server_address[1]
        self.dir = tempfile.TemporaryDirectory()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.dir.cleanup()

    def csv(self, text):
        path = os.path.join(self.dir.name, '3-cables.csv')
        with open(path, 'w', encoding='utf-8', newline='') as f:
            f.write(text)
        return path

    def run_script(self, text=GOOD, *flags, env=None):
        out, err = io.StringIO(), io.StringIO()
        env = {'NAUTOBOT_URL': self.url, 'NAUTOBOT_TOKEN': TOKEN} if env is None else env
        with contextlib.redirect_stderr(err):
            code = import_cables.main(['import_cables.py', self.csv(text), *flags], env, out)
        return code, out.getvalue(), err.getvalue()

    def posts(self):
        return [r for r in self.mock.requests if r[0] == 'POST']

    def test_a_dry_run_creates_nothing_and_says_what_it_would(self):
        code, out, err = self.run_script()
        self.assertEqual((code, err), (0, ''))
        self.assertEqual(self.posts(), [])
        self.assertTrue(all(m == 'GET' for m, *_ in self.mock.requests))
        lines = out.strip().split('\n')
        self.assertEqual(lines[0], 'Nautobot at %s. A dry run: nothing is created. Add --apply to create the cables.' % self.url[7:])
        self.assertEqual(lines[1], 'row 1 A1: would connect leaf-1 port-1 to core-1 slot-2/p0 (smf-os2, 2 m, Planned).')
        self.assertEqual(lines[2], 'row 2 c2: would connect leaf-1 mgmt-eth to demarc-i3 port-2-1 (cat6a, Planned).')
        self.assertEqual(lines[3], '2 rows: 2 would be created, 0 cannot be. Nothing was created.')

    def test_apply_creates_each_cable_by_id_as_the_real_instance_took_it(self):
        code, out, _ = self.run_script(GOOD, '--apply')
        self.assertEqual(code, 0)
        posts = self.posts()
        self.assertEqual([p[1] for p in posts], ['/api/dcim/cables/'] * 2)
        self.assertEqual(posts[0][2].get('Content-Type'), 'text/csv')
        # The columns Nautobot 3.2.6 accepted (cables_good): ends by type and id, status by name.
        self.assertEqual(posts[0][3],
                         'termination_a_type,termination_a_id,termination_b_type,termination_b_id,status__name,type,label,length,length_unit\n'
                         'dcim.interface,interfaces:leaf-1:port-1,dcim.interface,interfaces:core-1:slot-2/p0,Planned,smf-os2,A1,2,m\n')
        # A blank cell is left out with its column rather than sent blank.
        self.assertEqual(posts[1][3],
                         'termination_a_type,termination_a_id,termination_b_type,termination_b_id,status__name,type,label\n'
                         'dcim.interface,interfaces:leaf-1:mgmt-eth,dcim.interface,interfaces:demarc-i3:port-2-1,Planned,cat6a,c2\n')
        self.assertIn('row 1 A1: connected leaf-1 port-1 to core-1 slot-2/p0 (smf-os2, 2 m, Planned).', out)
        self.assertTrue(out.strip().endswith('2 rows: 2 created, 0 not.'))

    def test_what_it_cannot_find_is_reported_per_row_and_the_rest_still_goes(self):
        text = HEADER + ('leaf-1,dcim.interface,port-9,core-1,dcim.interface,slot-2/p0,smf-os2,Planned,missing-port,,,\n'
                         'nobody,dcim.interface,port-1,core-1,dcim.interface,slot-2/p0,smf-os2,Planned,missing-device,,,\n'
                         'demarc-i3,dcim.consoleport,Console,leaf-1,dcim.nonsense,port-1,,Planned,odd-kind,,,\n'
                         'leaf-1,dcim.interface,port-1,core-1,dcim.interface,slot-2/p0,smf-os2,Planned,fine,,1.5,ft\n'
                         'leaf-1,dcim.interface,port-1,core-1,dcim.interface,slot-2/p0,smf-os2,Planned,A1,,,\n'
                         'leaf-1,dcim.interface,port-1,core-1,dcim.interface,slot-2/p1,smf-os2,Planned,again,,,\n')
        code, out, _ = self.run_script(text, '--apply')
        self.assertEqual(code, 1)
        self.assertIn('row 1 missing-port: cannot connect leaf-1 port-9 to core-1 slot-2/p0 (smf-os2, Planned): '
                      'leaf-1 has no interface named port-9.', out)
        self.assertIn('there is no device named nobody.', out)
        self.assertIn('row 3 odd-kind: cannot connect demarc-i3 Console to leaf-1 port-1 (Planned): '
                      'dcim.nonsense is not a kind of end this script knows.', out)
        self.assertIn('row 4 fine: cannot connect leaf-1 port-1 to core-1 slot-2/p0 (smf-os2, 1.5 ft, Planned): '
                      'its length 1.5 is not a whole number, and Nautobot takes only whole numbers.', out)
        self.assertIn('row 5 A1: connected', out)
        # One port, one cable: the row after it finds the port taken.
        self.assertIn('row 6 again: cannot connect leaf-1 port-1 to core-1 slot-2/p1 (smf-os2, Planned): leaf-1 port-1 already has a cable.', out)
        self.assertEqual(len(self.posts()), 1)
        self.assertTrue(out.strip().endswith('6 rows: 1 created, 5 not.'))

    def test_a_port_that_already_has_a_cable_is_left_alone_so_a_second_run_is_safe(self):
        self.assertEqual(self.run_script(GOOD, '--apply')[0], 0)
        self.mock.requests.clear()
        code, out, _ = self.run_script(GOOD, '--apply')
        self.assertEqual((code, self.posts()), (1, []))
        self.assertIn('leaf-1 port-1 already has a cable; core-1 slot-2/p0 already has a cable.', out)

    def test_a_cable_created_without_its_ends_is_not_called_connected(self):
        self.mock.drop_ends = True
        code, out, _ = self.run_script(GOOD, '--apply')
        self.assertEqual(code, 1)
        self.assertIn('WITHOUT ITS ENDS. Delete it in Nautobot; it connects nothing.', out)
        self.assertNotIn(': connected ', out)

    def test_the_token_is_never_printed(self):
        for flags in ((), ('--apply',)):
            code, out, err = self.run_script(GOOD + 'nobody,dcim.interface,x,core-1,dcim.interface,y,,,z,,,\n', *flags)
            self.assertNotIn(TOKEN, out + err)
        # Not even when Nautobot refuses it, or echoes it back.
        code, out, err = self.run_script(env={'NAUTOBOT_URL': self.url, 'NAUTOBOT_TOKEN': 'wrong-' + TOKEN})
        self.assertEqual(code, 2)
        self.assertNotIn(TOKEN, out + err)
        self.assertIn('Nautobot refused the token (HTTP 403).', err)
        self.assertTrue(all(h.get('Authorization', '').startswith('Token ') for _, _, h, _ in self.mock.requests))

    def test_it_talks_to_one_host_only(self):
        # A redirect is not followed, wherever it points.
        self.mock.redirect = 'http://elsewhere.invalid/api/'
        code, out, err = self.run_script()
        self.assertEqual(code, 2)
        self.assertIn('Nautobot answered with a redirect (HTTP 302). Set NAUTOBOT_URL to the address it answers at.', err)
        self.mock.redirect = None
        # A "next" page that names another host is asked for on this one.
        self.mock.page_size = 1
        code, out, _ = self.run_script()
        self.assertEqual(code, 0, out)
        api = import_cables.Api(self.url, TOKEN)
        with self.assertRaises(import_cables.Stop):
            api.url('http://elsewhere.invalid/api/dcim/cables/')
        # A URL that carries credentials, or is not http, is refused before any request.
        self.mock.requests.clear()
        for bad in ('http://user:pw@127.0.0.1:1', 'ftp://127.0.0.1', '', 'nautobot.example.com'):
            self.assertEqual(self.run_script(env={'NAUTOBOT_URL': bad, 'NAUTOBOT_TOKEN': TOKEN})[0], 2)
        self.assertEqual(self.run_script(env={'NAUTOBOT_URL': self.url})[2].strip(), 'NAUTOBOT_TOKEN is not set.')
        self.assertEqual(self.mock.requests, [])

    def test_a_nautobot_that_ignores_the_device_filter_stops_the_run(self):
        self.mock.ignore_device_filter = True
        code, out, err = self.run_script(GOOD, '--apply')
        self.assertEqual((code, self.posts()), (2, []))
        self.assertIn('ignores the device filter', err)

    def test_a_file_that_is_not_the_kits_is_refused_with_a_sentence(self):
        code, _, err = self.run_script('side_a_device,side_a_type,side_a_name\nx,y,z\n')
        self.assertEqual(code, 2)
        self.assertIn("is not the Rack Builder's 3-cables.csv: it has no a_device, a_type, a_name, b_device, b_type, b_name column.", err)
        self.assertEqual(self.run_script(HEADER)[1].strip().split('\n')[-1], '0 rows: 0 would be created, 0 cannot be. Nothing was created.')
        with contextlib.redirect_stderr(io.StringIO()) as err:
            self.assertEqual(import_cables.main(['import_cables.py', 'a.csv', '--delete'], {}, io.StringIO()), 2)
        self.assertEqual(err.getvalue().strip(), 'usage: python3 import_cables.py [3-cables.csv] [--apply]')

    def test_it_runs_as_a_program_with_the_standard_library_alone(self):
        r = subprocess.run([sys.executable, '-I', str(SCRIPT), self.csv(GOOD)], capture_output=True, text=True,
                           env={'NAUTOBOT_URL': self.url, 'NAUTOBOT_TOKEN': TOKEN, 'PATH': os.environ.get('PATH', '')})
        self.assertEqual((r.returncode, r.stderr), (0, ''))
        self.assertIn('2 rows: 2 would be created, 0 cannot be. Nothing was created.', r.stdout)


if __name__ == '__main__':
    unittest.main(verbosity=1)
