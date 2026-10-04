#!/usr/bin/env python3
"""Tests of site/rack/nautobot/import_cables.py against a mock Nautobot.

    python3 tests/rack/import_cables_test.py

The mock is a local HTTP server that answers the few REST calls the script
makes, in the shapes a real Nautobot 3.2.6 gave (the verification run of
2026-10-04): a paginated list for a GET, a JSON list for a text/csv POST. No
real Nautobot is contacted, and the token used here is made up.
"""
import contextlib
import csv
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
        self.devices = ['core-1', 'leaf-1', 'demarc-i3']          # a name twice is an ambiguous device
        self.ports = {  # (list, device) -> names (a name twice is an ambiguous port)
            ('interfaces', 'leaf-1'): ['port-1', 'port-2', 'mgmt-eth'],
            ('interfaces', 'core-1'): ['slot-2/p0', 'slot-2/p1'],
            ('interfaces', 'demarc-i3'): ['port-2-1'],
            ('console-ports', 'demarc-i3'): ['Console']}
        self.cables = {}             # cable id -> {termination_a_id, termination_b_id, ...}
        self.cabled = {}             # port id -> the id of the cable it is in
        self.requests = []           # (method, path, headers, body)
        self.ignore_device_filter = False
        self.drop_ends = False       # create the cable without its ends, as a name-based import does
        self.omit_fields = False     # the POST answer leaves the termination fields out (the cable is right)
        self.wrong_ids = False       # the POST answer names other ends
        self.stored_wrong = False    # the POST answer is right and the cable, fetched again, is not
        self.redirect = None
        self.page_size = 1000
        self.prefix = ''             # the base URL's path, as when Nautobot is served under /nautobot
        self.echo = False            # an error body repeats the request's Authorization header
        self.pad = 0                 # characters before the echo, to put the token across a cut
        self.refuse = False          # a POST is refused
        self.fail_lists = False      # a GET of a list fails, with the echo

    def port_id(self, lst, device, name):
        return '%s:%s:%s' % (lst, device, name)

    def cable(self, a, b, lst_a='interface', lst_b='interface'):
        """A cable that was already there: its ends and both ports' membership."""
        cid = 'old-%d' % (len(self.cables) + 1)
        self.cables[cid] = {'id': cid, 'termination_a_type': 'dcim.' + lst_a, 'termination_a_id': a,
                            'termination_b_type': 'dcim.' + lst_b, 'termination_b_id': b}
        self.cabled[a] = self.cabled[b] = cid
        return cid


def csv_rows(body):
    rows = list(csv.reader(io.StringIO(body, newline='')))
    return dict(zip(rows[0], rows[1]))


def handler(mock):
    class H(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def send(self, code, data, headers=None):
            body = data if isinstance(data, bytes) else json.dumps(data).encode()
            self.send_response(code)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            for k, v in (headers or {}).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(body)

        def echoed(self, code):
            # An error body that repeats the token from the Authorization header, with `pad` characters before it.
            self.send(code, ('x' * mock.pad + 'sent ' + self.headers.get('Authorization', '').replace('Token ', '')).encode())

        def record(self, body=''):
            mock.requests.append((self.command, self.path, dict(self.headers), body))
            if mock.redirect:
                self.send(302, {}, {'Location': mock.redirect})
                return False
            if self.headers.get('Authorization') != 'Token ' + TOKEN:
                self.send(403, {'detail': 'Invalid token.'})
                return False
            return True

        def route(self):
            u = urllib.parse.urlsplit(self.path)
            path = u.path
            if mock.prefix:
                if not path.startswith(mock.prefix + '/'):
                    return None, None, None
                path = path[len(mock.prefix):]
            parts = [urllib.parse.unquote(x) for x in path.strip('/').split('/')]
            q = {k: v[0] for k, v in urllib.parse.parse_qs(u.query).items()}
            return parts, q, u

        def do_GET(self):
            if not self.record():
                return
            parts, q, u = self.route()
            if parts is None:
                return self.send(404, {'detail': 'not found'})
            if mock.fail_lists and len(parts) == 3 and 'portrayal-no-such-device' not in self.path:
                return self.echoed(500)
            lst = parts[2]
            if len(parts) == 4:                                     # /api/dcim/<list>/<id>/
                if lst == 'cables':
                    cable = mock.cables.get(parts[3])
                    if cable is None:
                        return self.send(404, {'detail': 'Not found.'})
                    return self.send(200, dict(cable, **({'termination_a_id': None, 'termination_b_id': None}
                                                           if mock.stored_wrong or mock.drop_ends else {})))
                for (l, d), names in mock.ports.items():
                    for n in names:
                        if l == lst and mock.port_id(l, d, n) == parts[3]:
                            return self.send(200, {'id': parts[3], 'name': n, 'device': {'name': d}})
                return self.send(404, {'detail': 'Not found.'})
            if lst == 'devices':
                rows = [{'id': 'dev:%s:%d' % (d, k), 'name': d} for k, d in enumerate(mock.devices) if d == q.get('name')]
            else:
                device = q.get('device')
                if device not in mock.devices and not mock.ignore_device_filter:
                    return self.send(400, {'device': ['Select a valid choice. %s is not one of the available choices.' % device]})
                rows = [{'id': mock.port_id(l, d, n), 'name': n,
                         'cable': {'id': mock.cabled[mock.port_id(l, d, n)]} if mock.port_id(l, d, n) in mock.cabled else None}
                        for (l, d), names in mock.ports.items() for n in names
                        if l == lst and (mock.ignore_device_filter or d == device)]
            offset = int(q.get('offset', 0))
            page, more = rows[offset:offset + mock.page_size], offset + mock.page_size < len(rows)
            nxt = None
            if more:
                q['offset'] = str(offset + mock.page_size)
                # As behind a proxy: another host name, and the base URL's own path already in it.
                nxt = 'http://another-name.invalid%s%s?%s' % (mock.prefix, u.path[len(mock.prefix):], urllib.parse.urlencode(q))
            self.send(200, {'count': len(rows), 'next': nxt, 'results': page})

        def do_POST(self):
            body = self.rfile.read(int(self.headers.get('Content-Length') or 0)).decode()
            if not self.record(body):
                return
            parts, q, u = self.route()
            if parts != ['api', 'dcim', 'cables'] or self.headers.get('Content-Type') != 'text/csv':
                return self.send(400, {'detail': 'not a CSV cable import'})
            d = csv_rows(body)
            if mock.refuse or mock.echo:
                return self.echoed(400)
            if d.get('length') and not d['length'].isdigit():
                return self.send(400, [{'length': ['A valid integer is required.']}])
            cid = 'cable-%d' % (len(mock.cables) + 1)
            made = {'id': cid, 'label': d.get('label', ''),
                    'termination_a_type': d['termination_a_type'], 'termination_a_id': d['termination_a_id'],
                    'termination_b_type': d['termination_b_type'], 'termination_b_id': d['termination_b_id']}
            stored = dict(made)
            if mock.drop_ends:
                for k in ('termination_a_type', 'termination_a_id', 'termination_b_type', 'termination_b_id'):
                    made[k] = stored[k] = None
            else:
                mock.cabled[d['termination_a_id']] = mock.cabled[d['termination_b_id']] = cid
            mock.cables[cid] = stored
            if mock.omit_fields:
                for k in ('termination_a_type', 'termination_a_id', 'termination_b_type', 'termination_b_id'):
                    del made[k]
            if mock.wrong_ids:
                made.update(termination_a_id='other-1', termination_b_id='other-2')
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

    def run_script(self, text=GOOD, *flags, env=None, raw=None):
        out, err = io.StringIO(), io.StringIO()
        env = {'NAUTOBOT_URL': self.url, 'NAUTOBOT_TOKEN': TOKEN} if env is None else env
        path = self.csv(text) if raw is None else self.raw(raw)
        with contextlib.redirect_stderr(err):
            code = import_cables.main(['import_cables.py', path, *flags], env, out)
        return code, out.getvalue(), err.getvalue()

    def raw(self, data):
        path = os.path.join(self.dir.name, 'raw.csv')
        with open(path, 'wb') as f:
            f.write(data)
        return path

    def posts(self):
        return [r for r in self.mock.requests if r[0] == 'POST']

    def test_a_dry_run_creates_nothing_and_says_what_it_would(self):
        code, out, err = self.run_script()
        self.assertEqual((code, err), (0, ''))
        self.assertEqual(self.posts(), [])
        self.assertTrue(all(m == 'GET' for m, *_ in self.mock.requests))
        lines = out.strip().split('\n')
        self.assertEqual(lines[0], 'Nautobot at %s. A dry run: nothing is created. Add --apply to create the cables.' % self.url[7:])
        # A row is named by its line in the file: the header is line 1.
        self.assertEqual(lines[1], 'line 2 A1: would connect leaf-1 port-1 to core-1 slot-2/p0 (smf-os2, 2 m, Planned).')
        self.assertEqual(lines[2], 'line 3 c2: would connect leaf-1 mgmt-eth to demarc-i3 port-2-1 (cat6a, Planned).')
        self.assertEqual(lines[3], '2 rows: 2 would be created, 0 already connected, 0 failed. Nothing was created.')

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
        self.assertIn('line 2 A1: connected leaf-1 port-1 to core-1 slot-2/p0 (smf-os2, 2 m, Planned).', out)
        self.assertTrue(out.strip().endswith('2 rows: 2 created, 0 already connected, 0 failed.'))
        # Each cable is fetched again by its id, and its ends compared.
        self.assertEqual([p for m, p, *_ in self.mock.requests if p.startswith('/api/dcim/cables/cable-')],
                         ['/api/dcim/cables/cable-1/', '/api/dcim/cables/cable-2/'])

    def test_what_it_cannot_find_is_reported_per_row_and_the_rest_still_goes(self):
        text = HEADER + ('leaf-1,dcim.interface,port-9,core-1,dcim.interface,slot-2/p0,smf-os2,Planned,missing-port,,,\n'
                         'nobody,dcim.interface,port-1,core-1,dcim.interface,slot-2/p0,smf-os2,Planned,missing-device,,,\n'
                         'demarc-i3,dcim.consoleport,Console,leaf-1,dcim.nonsense,port-1,,Planned,odd-kind,,,\n'
                         'leaf-1,dcim.interface,port-1,core-1,dcim.interface,slot-2/p0,smf-os2,Planned,fine,,1.5,ft\n'
                         'leaf-1,dcim.interface,port-1,core-1,dcim.interface,slot-2/p0,smf-os2,Planned,A1,,,\n'
                         'leaf-1,dcim.interface,port-1,core-1,dcim.interface,slot-2/p1,smf-os2,Planned,again,,,\n')
        code, out, _ = self.run_script(text, '--apply')
        self.assertEqual(code, 1)
        self.assertIn('line 2 missing-port: cannot connect leaf-1 port-9 to core-1 slot-2/p0 (smf-os2, Planned): '
                      'leaf-1 has no interface named port-9.', out)
        self.assertIn('there is no device named nobody.', out)
        self.assertIn('line 4 odd-kind: cannot connect demarc-i3 Console to leaf-1 port-1 (Planned): '
                      'dcim.nonsense is not a kind of end this script knows.', out)
        self.assertIn('line 5 fine: cannot connect leaf-1 port-1 to core-1 slot-2/p0 (smf-os2, 1.5 ft, Planned): '
                      'its length 1.5 is not a whole number, and Nautobot takes only whole numbers.', out)
        self.assertIn('line 6 A1: connected', out)
        # One port, one cable: the row after it finds the port taken, and says by which line.
        self.assertIn('line 7 again: cannot connect leaf-1 port-1 to core-1 slot-2/p1 (smf-os2, Planned): '
                      'leaf-1 port-1 is already used by line 6 of this file.', out)
        self.assertEqual(len(self.posts()), 1)
        self.assertTrue(out.strip().endswith('6 rows: 1 created, 0 already connected, 5 failed.'))

    def test_a_second_run_reports_a_finished_cable_as_already_connected_and_exits_0(self):
        self.assertEqual(self.run_script(GOOD, '--apply')[0], 0)
        self.mock.requests.clear()
        for flags in (('--apply',), ()):
            code, out, err = self.run_script(GOOD, *flags)
            self.assertEqual((code, self.posts(), err), (0, [], ''))
            self.assertIn('line 2 A1: already connected: leaf-1 port-1 to core-1 slot-2/p0 (smf-os2, 2 m, Planned).', out)
            self.assertTrue(out.strip().endswith('2 rows: 0 %s, 2 already connected, 0 failed.%s' % (
                'created' if flags else 'would be created', '' if flags else ' Nothing was created.')), out)
        # After a partial failure: the finished row is skipped, the other is made, and the run is clean.
        mock = self.mock
        mock.cables.clear()
        mock.cabled.clear()
        mock.cable('interfaces:leaf-1:port-1', 'interfaces:core-1:slot-2/p0')
        code, out, _ = self.run_script(GOOD, '--apply')
        self.assertEqual(code, 0)
        self.assertIn('line 2 A1: already connected', out)
        self.assertIn('line 3 c2: connected', out)
        self.assertEqual(len(self.posts()), 1)
        self.assertTrue(out.strip().endswith('2 rows: 1 created, 1 already connected, 0 failed.'))

    def test_a_port_in_some_other_cable_is_a_failure_that_says_what_it_is_connected_to(self):
        self.mock.cable('interfaces:leaf-1:port-1', 'interfaces:core-1:slot-2/p1')
        code, out, _ = self.run_script(GOOD, '--apply')
        self.assertEqual(code, 1)
        self.assertIn('line 2 A1: cannot connect leaf-1 port-1 to core-1 slot-2/p0 (smf-os2, 2 m, Planned): '
                      'leaf-1 port-1 already has a cable, to core-1 slot-2/p1.', out)
        self.assertIn('line 3 c2: connected', out)
        self.assertEqual(len(self.posts()), 1)
        # Each port in a different cable: both are named.
        self.mock.cables.clear()
        self.mock.cabled.clear()
        self.mock.cable('interfaces:leaf-1:port-1', 'interfaces:leaf-1:port-2')
        self.mock.cable('interfaces:core-1:slot-2/p0', 'interfaces:demarc-i3:port-2-1')
        code, out, _ = self.run_script(GOOD)
        self.assertEqual(code, 1)
        self.assertIn('leaf-1 port-1 already has a cable, to leaf-1 port-2; core-1 slot-2/p0 already has a cable, to demarc-i3 port-2-1.', out)
        # A cable it cannot read still fails, in words, not a traceback.
        self.mock.cables.clear()
        self.assertEqual(self.run_script(GOOD)[0], 1)

    def test_a_cable_created_without_its_ends_is_not_called_connected(self):
        self.mock.drop_ends = True
        code, out, _ = self.run_script(GOOD, '--apply')
        self.assertEqual(code, 1)
        self.assertIn('Nautobot created cable cable-1, but it does not show both of these ends (its answer). Check it in Nautobot', out)
        self.assertNotIn(': connected ', out)

    def test_the_post_check_fails_a_row_whose_answer_omits_the_ends_or_names_others(self):
        for mode, said in (('omit_fields', 'its answer'), ('wrong_ids', 'its answer'), ('stored_wrong', 'fetched again')):
            self.mock.__init__()
            setattr(self.mock, mode, True)
            code, out, _ = self.run_script(GOOD, '--apply')
            self.assertEqual(code, 1, mode)
            self.assertIn('line 2 A1: Nautobot created cable cable-1, but it does not show both of these ends (%s).' % said, out, mode)
            self.assertNotIn(': connected ', out, mode)
            self.assertTrue(out.strip().endswith('2 rows: 0 created, 0 already connected, 2 failed.'), mode + out)
        # The cable is fetched again by its id, and the answer alone is not trusted.
        self.mock.__init__()
        self.run_script(GOOD, '--apply')
        self.assertIn('/api/dcim/cables/cable-1/', [p for m, p, *_ in self.mock.requests if m == 'GET'])

    def test_an_ambiguous_device_or_port_is_refused_with_the_reason(self):
        self.mock.devices.append('core-1')
        self.mock.ports[('interfaces', 'leaf-1')].append('port-2')
        text = HEADER + ('leaf-1,dcim.interface,port-1,core-1,dcim.interface,slot-2/p0,,Planned,two-devices,,,\n'
                         'leaf-1,dcim.interface,port-2,demarc-i3,dcim.interface,port-2-1,,Planned,two-ports,,,\n')
        code, out, _ = self.run_script(text, '--apply')
        self.assertEqual((code, self.posts()), (1, []))
        self.assertIn('line 2 two-devices: cannot connect leaf-1 port-1 to core-1 slot-2/p0 (Planned): 2 devices are named core-1.', out)
        self.assertIn('line 3 two-ports: cannot connect leaf-1 port-2 to demarc-i3 port-2-1 (Planned): leaf-1 has 2 interfaces named port-2.', out)

    def test_names_that_need_url_encoding_are_asked_for_whole(self):
        name, port = 'rack 1 & #2/\u00e9', 'p 1&#/\u00e9'
        self.mock.devices += [name, 'peer']
        self.mock.ports[('interfaces', name)] = [port]
        self.mock.ports[('interfaces', 'peer')] = ['x']
        text = HEADER + '"%s",dcim.interface,"%s",peer,dcim.interface,x,,Planned,enc,,,\n' % (name, port)
        code, out, _ = self.run_script(text, '--apply')
        self.assertEqual(code, 0, out)
        paths = [p for m, p, *_ in self.mock.requests if m == 'GET']
        quoted = urllib.parse.urlencode({'name': name})
        self.assertTrue(any(quoted in p for p in paths), paths)
        self.assertIn('name=rack+1+%26+%232%2F%C3%A9', ' '.join(paths))
        self.assertIn('device=rack+1+%26+%232%2F%C3%A9', ' '.join(paths))
        self.assertIn('termination_a_id,', self.posts()[0][3])
        self.assertIn('interfaces:%s:%s' % (name, port), self.posts()[0][3])

    def test_a_bom_crlf_and_a_quoted_field_with_a_comma_and_a_newline_are_read(self):
        text = ('\ufeff' + HEADER.strip() + '\r\n'
                'leaf-1,dcim.interface,port-1,core-1,dcim.interface,slot-2/p0,smf-os2,Planned,"A, 1\r\nsecond line",,2,m\r\n'
                'leaf-1,dcim.interface,mgmt-eth,demarc-i3,dcim.interface,port-2-1,cat6a,Planned,c2,,,\r\n')
        code, out, err = self.run_script(GOOD, '--apply', raw=text.encode('utf-8'))
        self.assertEqual((code, err), (0, ''), out)
        # The label's own comma and line break reach Nautobot inside one quoted CSV cell.
        self.assertEqual(csv_rows(self.posts()[0][3])['label'], 'A, 1\r\nsecond line')
        # Row numbers are the file's lines: the second cable is on line 4, after a record that took two lines.
        self.assertIn('line 2 A, 1?second line: connected', out.replace('??', '?'))
        self.assertIn('line 4 c2: connected', out)

    def test_row_numbers_are_the_files_line_numbers_through_blank_lines(self):
        text = HEADER + '\n,,,,,,,,,,,\n' + GOOD.split('\n', 1)[1]
        code, out, _ = self.run_script(text)
        self.assertIn('line 4 A1: would connect', out)
        self.assertIn('line 5 c2: would connect', out)

    def test_control_characters_in_a_value_never_reach_the_terminal(self):
        text = HEADER + 'leaf-1,dcim.interface,port-1,core-1,dcim.interface,slot-2/p0,,Planned,"\x1b[31mred\x07\n\x1b]0;x\x07",,,\n'
        code, out, err = self.run_script(text)
        for bad in ('\x1b', '\x07', '\r'):
            self.assertNotIn(bad, out + err)
        self.assertEqual(len(out.strip().split('\n')), 3)
        self.assertIn('?[31mred???]0;x?', out)

    def test_the_token_is_never_printed(self):
        for flags in ((), ('--apply',)):
            code, out, err = self.run_script(GOOD + 'nobody,dcim.interface,x,core-1,dcim.interface,y,,,z,,,\n', *flags)
            self.assertNotIn(TOKEN, out + err)
        # Not even when Nautobot refuses it.
        code, out, err = self.run_script(env={'NAUTOBOT_URL': self.url, 'NAUTOBOT_TOKEN': 'wrong-' + TOKEN})
        self.assertEqual(code, 2)
        self.assertNotIn(TOKEN, out + err)
        self.assertIn('Nautobot refused the token (HTTP 403).', err)
        self.assertTrue(all(h.get('Authorization', '').startswith('Token ') for _, _, h, _ in self.mock.requests))

    def test_the_token_is_not_printed_when_the_server_echoes_it_even_across_the_cut(self):
        self.mock.echo = True
        # The echo starts after `pad` and five more characters: with pads of 570 to 594 the token straddles the 600 cut.
        for pad in (0, 570, 580, 590, 594, 700):
            self.mock.pad = pad
            code, out, err = self.run_script(GOOD, '--apply')
            self.assertEqual(code, 1)
            text = out + err
            self.assertIn('Nautobot refused', text)
            for k in range(8, len(TOKEN) + 1):          # not the token, and not a piece of it long enough to matter
                self.assertNotIn(TOKEN[:k], text, 'pad %d, %d characters of the token' % (pad, k))

    def test_the_token_is_not_printed_when_a_failed_list_echoes_it_across_the_300_character_cut(self):
        self.mock.fail_lists = True
        for pad in (0, 275, 285, 295, 299, 400):
            self.mock.pad = pad
            code, out, err = self.run_script(GOOD)
            self.assertEqual(code, 1)
            self.assertIn('could not be listed', out)
            for k in range(8, len(TOKEN) + 1):
                self.assertNotIn(TOKEN[:k], out + err, 'pad %d, %d characters of the token' % (pad, k))

    def test_it_talks_to_one_host_only(self):
        # A redirect is not followed, wherever it points.
        self.mock.redirect = 'http://elsewhere.invalid/api/'
        code, out, err = self.run_script()
        self.assertEqual(code, 2)
        self.assertIn('Nautobot answered with a redirect (HTTP 302). Set NAUTOBOT_URL to the address it answers at.', err)
        self.assertEqual(self.mock.requests[-1][1][:5], '/api/')
        self.assertTrue(all(h.get('Host', '').startswith('127.0.0.1') for _, _, h, _ in self.mock.requests))
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

    def test_a_base_url_with_a_path_pages_through_a_list(self):
        self.mock.prefix = '/nautobot'
        self.mock.page_size = 1
        self.mock.ports[('interfaces', 'leaf-1')] += ['port-3', 'port-4']
        text = HEADER + 'leaf-1,dcim.interface,port-4,core-1,dcim.interface,slot-2/p1,,Planned,paged,,,\n'
        code, out, err = self.run_script(text, '--apply', env={'NAUTOBOT_URL': self.url + '/nautobot/', 'NAUTOBOT_TOKEN': TOKEN})
        self.assertEqual((code, err), (0, ''), out)
        self.assertIn('line 2 paged: connected', out)
        paths = [p for m, p, *_ in self.mock.requests]
        self.assertTrue(all(p.startswith('/nautobot/api/') for p in paths), paths)
        self.assertFalse(any('/nautobot/nautobot' in p for p in paths), paths)
        self.assertTrue(any('offset=' in p for p in paths), 'a second page was asked for')

    def test_a_plain_http_address_that_is_not_this_computer_is_warned_about(self):
        for url, warned in (('http://nautobot.example.com', True), ('https://nautobot.example.com', False),
                            ('http://localhost:1', False), ('http://127.0.0.1:1', False), ('http://[::1]:1', False),
                            ('http://10.1.2.3', True)):
            api = import_cables.Api(url, TOKEN)
            self.assertEqual(api.unencrypted, warned, url)
        # The warning goes to stderr, before anything is sent, and the run goes on to its end (here it cannot connect).
        out, err = io.StringIO(), io.StringIO()
        was, import_cables.TIMEOUT = import_cables.TIMEOUT, 1          # nothing answers at a TEST-NET address
        try:
            with contextlib.redirect_stderr(err):
                import_cables.main(['import_cables.py', self.csv(GOOD)], {'NAUTOBOT_URL': 'http://192.0.2.1:9', 'NAUTOBOT_TOKEN': TOKEN}, out)
        finally:
            import_cables.TIMEOUT = was
        self.assertIn('the token will be sent unencrypted.', err.getvalue().split('\n')[0])
        self.assertNotIn(TOKEN, err.getvalue())
        self.assertEqual(self.run_script()[2], '')

    def test_a_nautobot_that_ignores_the_device_filter_stops_the_run(self):
        self.mock.ignore_device_filter = True
        code, out, err = self.run_script(GOOD, '--apply')
        self.assertEqual((code, self.posts()), (2, []))
        self.assertIn('ignores the device filter', err)

    def test_a_file_that_is_not_the_kits_is_refused_with_a_sentence(self):
        code, _, err = self.run_script('side_a_device,side_a_type,side_a_name\nx,y,z\n')
        self.assertEqual(code, 2)
        self.assertIn("is not the Rack Builder's 3-cables.csv: it has no a_device, a_type, a_name, b_device, b_type, b_name column.", err)
        self.assertEqual(self.run_script(HEADER)[1].strip().split('\n')[-1], '0 rows: 0 would be created, 0 already connected, 0 failed. Nothing was created.')
        with contextlib.redirect_stderr(io.StringIO()) as err:
            self.assertEqual(import_cables.main(['import_cables.py', 'a.csv', '--delete'], {}, io.StringIO()), 2)
        self.assertEqual(err.getvalue().strip(), 'usage: python3 import_cables.py [3-cables.csv] [--apply]')

    def test_a_file_that_cannot_be_read_or_a_server_that_breaks_the_protocol_is_a_sentence_not_a_traceback(self):
        code, _, err = self.run_script(raw=b'a_device,a_type\n\xff\xfe,x\n')
        self.assertEqual(code, 2)
        self.assertIn('is not UTF-8 text', err)
        code, _, err = self.run_script(raw=b'a_device,a_type\n"unterminated\n' + b'x' * 200)
        self.assertEqual(code, 2, err)
        self.assertNotIn('Traceback', err)
        csv.field_size_limit(50)
        try:
            code, _, err = self.run_script(raw=b'a_device\n' + b'y' * 100 + b'\n')
        finally:
            csv.field_size_limit(131072)
        self.assertEqual(code, 2)
        self.assertIn('could not be read as CSV', err)
        with contextlib.redirect_stderr(io.StringIO()) as gone:
            self.assertEqual(import_cables.main(['import_cables.py', os.path.join(self.dir.name, 'missing.csv')],
                                                {'NAUTOBOT_URL': self.url, 'NAUTOBOT_TOKEN': TOKEN}, io.StringIO()), 2)
        self.assertIn('Could not read', gone.getvalue())
        # A server that hangs up mid-answer (http.client.RemoteDisconnected is an HTTPException and an OSError)
        # and a bad status line (BadStatusLine is an HTTPException only).
        import http.client
        for exc in (http.client.RemoteDisconnected('closed'), http.client.BadStatusLine('x'), http.client.IncompleteRead(b'x')):
            api = import_cables.Api(self.url, TOKEN)
            def boom(*a, **k):
                raise exc
            api.opener.open = boom
            with self.assertRaises(import_cables.Stop):
                api.request('GET', '/api/')
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stderr(err):
            self.assertEqual(import_cables.main(['import_cables.py', self.csv(GOOD)], {'NAUTOBOT_URL': 'http://127.0.0.1:1', 'NAUTOBOT_TOKEN': TOKEN}, out), 2)
        self.assertIn('Could not reach Nautobot', err.getvalue())

    def test_a_row_is_checked_before_anything_is_asked(self):
        text = HEADER + ('leaf-1,dcim.interface,,core-1,dcim.interface,slot-2/p0,,Planned,no-port,,,\n'
                         ',dcim.interface,port-1,core-1,dcim.interface,slot-2/p0,,Planned,no-device,,,\n'
                         'leaf-1,dcim.interface,port-1,core-1,dcim.interface,slot-2/p0,,Planned,superscript,,\u00b2,m\n'
                         'leaf-1,dcim.interface,port-1,core-1,dcim.interface,slot-2/p0,,Planned,arabic,,\u0662,m\n'
                         'leaf-1,dcim.interface,port-1,core-1,dcim.interface,slot-2/p0,,Planned,signed,,-3,m\n'
                         'leaf-1,dcim.interface,port-1,core-1,dcim.interface,slot-2/p0,,Planned,huge,,32768,m\n'
                         'leaf-1,dcim.interface,port-1,core-1,dcim.interface,slot-2/p0,,Planned,at-limit,,32767,m\n')
        code, out, _ = self.run_script(text)
        self.assertEqual(code, 1)
        self.assertIn('line 2 no-port: cannot connect leaf-1  to core-1 slot-2/p0 (Planned): end A has no port name.', out)
        self.assertIn('line 3 no-device: cannot connect  port-1 to core-1 slot-2/p0 (Planned): end A has no device name.', out)
        for n, label in ((4, 'superscript'), (5, 'arabic'), (6, 'signed')):
            self.assertRegex(out, r'line %d %s: cannot connect .*: its length \S+ is not a whole number' % (n, label))
        self.assertIn('its length 32768 is more than Nautobot stores (32767).', out)
        self.assertIn('line 8 at-limit: would connect', out)
        # The blank cells were not looked up: no request for a device named ''.
        self.assertFalse(any('name=&' in p or p.endswith('name=') for m, p, *_ in self.mock.requests))

    def test_a_unit_with_no_length_is_dropped(self):
        text = HEADER + 'leaf-1,dcim.interface,port-1,core-1,dcim.interface,slot-2/p0,smf-os2,Planned,u,,,ft\n'
        code, out, _ = self.run_script(text, '--apply')
        self.assertEqual(code, 0, out)
        self.assertNotIn('length_unit', self.posts()[0][3])
        self.assertIn('line 2 u: connected leaf-1 port-1 to core-1 slot-2/p0 (smf-os2, Planned).', out)

    def test_it_runs_as_a_program_with_the_standard_library_alone(self):
        r = subprocess.run([sys.executable, '-I', str(SCRIPT), self.csv(GOOD)], capture_output=True, text=True,
                           env={'NAUTOBOT_URL': self.url, 'NAUTOBOT_TOKEN': TOKEN, 'PATH': os.environ.get('PATH', '')})
        self.assertEqual((r.returncode, r.stderr), (0, ''))
        self.assertIn('2 rows: 2 would be created, 0 already connected, 0 failed. Nothing was created.', r.stdout)


if __name__ == '__main__':
    unittest.main(verbosity=1)
