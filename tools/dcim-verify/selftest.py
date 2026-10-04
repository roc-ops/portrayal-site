#!/usr/bin/env python3
"""kits.py, run end to end against a mock NetBox and a mock Nautobot.

    python3 tools/dcim-verify/selftest.py

No real instance is contacted and no browser is needed: the two kits are
small ones built here (with the repository's real import_cables.py), and the
mock is a local HTTP server that answers as the real instances did in the
verification run of 2026-10-04. It shows that kits.py sends each file in the
README's order, prefixes only the cells it says it does, runs the kit's own
script, compares the cables, refuses a kit with a name it could not clean up,
and keeps every credential out of its output. It does NOT show that a real
NetBox or Nautobot accepts the files: only "kits.py run" does.
"""
import csv
import http.server
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
import zipfile

HERE = pathlib.Path(__file__).resolve().parent
SCRIPT = HERE.parent.parent / 'site' / 'rack' / 'nautobot' / 'import_cables.py'
PASSWORD, TOKEN = 'made-up-pass-phrase-77', 'made-up-token-0123456789abcdef'
CSRF = 'CSRFCSRFCSRFCSRFCSRFCSRF12345678'
PAGE = '<html><form><input type="hidden" name="csrfmiddlewaretoken" value="%s"></form>%%s</html>' % CSRF

DEVICE_YAML = '---\nmanufacturer: Acme\nmodel: SW-1\nslug: acme-sw-1\nu_height: 1.0\nis_full_depth: true\ninterfaces:\n  - name: port-1\n    type: 1000base-t\nmodule-bays:\n  - name: Slot 1\n    position: slot-1\n'
MODULE_YAML = "---\nmanufacturer: Acme\nmodel: CARD-1\ninterfaces:\n  - name: '{module}/p0'\n    type: 1000base-t\n"
# The README as the page writes it today: sentence-case headings, LF, items wrapped with a two-column hanging indent.
README = ('NetBox import kit for pt-verify-rack, from the Portrayal Rack Builder, 2026-10-04.\n\nNot in this kit:\n'
          '- Cable pt-verify-loose is not in the cables file: end A is not\n  connected.\n\nNotes:\n- A note.\n')
NETBOX = {
    'types/device-types/Acme/SW-1.yaml': DEVICE_YAML, 'types/module-types/Acme/CARD-1.yaml': MODULE_YAML,
    '1-rack.csv': 'site,name,status,width,u_height,desc_units\r\npt-verify-site,pt-verify-rack,planned,19,24,false\r\n',
    '2-devices.csv': 'name,role,manufacturer,device_type,status,site,rack,position,face,comments\r\n'
                     'pt-verify-a,pt-verify-role,Acme,SW-1,planned,pt-verify-site,pt-verify-rack,2,front,\r\n'
                     'pt-verify-b,pt-verify-role,Acme,SW-1,planned,pt-verify-site,pt-verify-rack,4,front,\r\n',
    '3-modules.csv': 'device,module_bay,module_type,status\r\npt-verify-a,Slot 1,CARD-1,planned\r\n',
    '4-cables.csv': 'side_a_device,side_a_type,side_a_name,side_b_device,side_b_type,side_b_name,type,status,label,color,length,length_unit,description\r\n'
                    'pt-verify-b,dcim.interface,port-1,pt-verify-a,dcim.interface,slot-1/p0,cat6,planned,pt-verify-c1,,1.5,ft,uplink\r\n',
    'README.txt': README}
NAUTOBOT = {
    'types/device-types/Acme/SW-1.yaml': DEVICE_YAML, 'types/module-types/Acme/CARD-1.yaml': MODULE_YAML,
    '1-devices.csv': 'name,role__name,device_type__manufacturer__name,device_type__model,status__name,location__name,rack__name,position,face,comments\r\n'
                     'pt-verify-a,pt-verify-role,Acme,SW-1,Planned,pt-verify-site,pt-verify-rack,2,front,\r\n'
                     'pt-verify-b,pt-verify-role,Acme,SW-1,Planned,pt-verify-site,pt-verify-rack,4,front,\r\n',
    '2-modules.csv': 'module_type__manufacturer__name,module_type__model,parent_module_bay__parent_device__name,parent_module_bay__name,status__name\r\n'
                     'Acme,CARD-1,pt-verify-a,Slot 1,Planned\r\n',
    '3-cables.csv': 'a_device,a_type,a_name,b_device,b_type,b_name,type,status,label,color,length,length_unit\r\n'
                    'pt-verify-b,dcim.interface,port-1,pt-verify-a,dcim.interface,slot-1/p0,cat6,Planned,pt-verify-c1,,2,ft\r\n',
    'README.txt': README.replace('NetBox', 'Nautobot')}
# The rack the two kits stand for: one cable in the files, one the README says is left out.
RACK = {'racks': [{'name': 'pt-verify-rack', 'frame': {'heightRU': 24, 'numbering': 'bottom-up'},
                   'cables': [{'id': 'c1', 'label': 'pt-verify-c1'}, {'id': 'c2', 'label': 'pt-verify-loose'}]}]}


class State:
    def __init__(self):
        self.posts = []           # (path, content type, body or form data)
        self.cables = []          # rows of the cable CSVs that were accepted
        self.refuse = None        # an import kind the mock NetBox refuses
        self.ports = {'pt-verify-a': ['port-1', 'slot-1/p0'], 'pt-verify-b': ['port-1']}


def handler(st):
    class H(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def send(self, code, body, ct='application/json', loc=None):
            b = (body if isinstance(body, str) else json.dumps(body)).encode()
            self.send_response(code)
            self.send_header('Content-Type', ct)
            self.send_header('Content-Length', str(len(b)))
            if loc:
                self.send_header('Location', loc)
            self.end_headers()
            self.wfile.write(b)

        def do_GET(self):
            u = urllib.parse.urlsplit(self.path)
            q = {k: v[0] for k, v in urllib.parse.parse_qs(u.query).items()}
            if not u.path.startswith('/api/'):
                return self.send(200, PAGE % '', 'text/html')
            lst = u.path.strip('/').split('/')[-1]
            if lst == 'status':
                return self.send(200, {'netbox-version': '4.7.2', 'nautobot-version': '3.2.6'})
            rows = []
            if u.path.startswith('/api/dcim/cables/') and lst != 'cables':      # one cable by id: the script re-fetches what it made
                one = next((r for r in st.cables if r.get('id') == lst), None)
                return self.send(200, one) if one else self.send(404, {'detail': 'Not found.'})
            if lst == 'devices' and 'name' in q:
                rows = [{'id': 'dev:' + q['name'], 'name': q['name']}] if q['name'] in st.ports else []
            elif lst == 'interfaces':
                if q.get('device') not in st.ports:
                    return self.send(400, {'device': ['Select a valid choice.']})
                rows = [{'id': '%s:%s' % (q['device'], n), 'name': n, 'cable': None} for n in st.ports[q['device']]]
            elif lst == 'cables':
                for r in st.cables:
                    if 'side_a_device' in r:
                        end = lambda s: [{'object_type': r['side_%s_type' % s], 'object': {'name': r['side_%s_name' % s], 'device': {'name': r['side_%s_device' % s]}}}]
                        rows.append({'id': 1, 'label': r['label'], 'type': r['type'], 'status': {'value': r['status']},
                                     'length': float(r['length']) if r['length'] else None, 'description': r['description'],
                                     'length_unit': {'value': r['length_unit']} if r['length_unit'] else None,
                                     'a_terminations': end('a'), 'b_terminations': end('b')})
                    else:
                        rows.append({'id': r.get('id', 'c'), 'label': r.get('label'), 'type': r.get('type', ''), 'length': int(r['length']) if r.get('length') else None,
                                     'length_unit': r.get('length_unit', ''), 'termination_a_id': r['termination_a_id'], 'termination_b_id': r['termination_b_id']})
            self.send(200, {'results': rows, 'next': None})

        def do_POST(self):
            body = self.rfile.read(int(self.headers.get('Content-Length') or 0)).decode()
            ct = self.headers.get('Content-Type', '')
            if self.path == '/login/':
                st.posts.append((self.path, ct, urllib.parse.parse_qs(body)))
                return self.send(302, '', 'text/html', '/')
            if not self.path.startswith('/api/'):                       # NetBox's bulk import pages
                form = {k: v[0] for k, v in urllib.parse.parse_qs(body).items()}
                kind = self.path.strip('/').split('/')[1]
                st.posts.append((self.path, ct, form))
                if form.get('csrfmiddlewaretoken') != CSRF or kind == st.refuse:
                    return self.send(200, PAGE % '<div class="alert alert-danger">Record 1 position: U14 is already occupied</div>', 'text/html')
                if kind == 'cables':
                    st.cables += list(csv.DictReader(io.StringIO(form['data'], newline='')))
                return self.send(302, '', 'text/html', self.path.replace('import/', '') + '?modified_by_request=1')
            if self.headers.get('Authorization') != 'Token ' + TOKEN:
                return self.send(403, {'detail': 'Invalid token.'})
            st.posts.append((self.path, ct, body))
            if ct == 'text/csv':
                rows = list(csv.DictReader(io.StringIO(body, newline='')))
                if self.path == '/api/dcim/cables/':
                    made = [dict(r, id='cable-%d' % (len(st.cables) + i + 1)) for i, r in enumerate(rows)]
                    st.cables += made
                    return self.send(201, made)
                return self.send(201, [{'id': 'o', 'name': r.get('name', ''), 'display': r.get('name', '')} for r in rows])
            d = json.loads(body)
            return self.send(201, {'id': 'obj-%d' % len(st.posts), 'name': d.get('name') or d.get('model')} if isinstance(d, dict) else [{}])
    return H


class Kits(unittest.TestCase):
    def setUp(self):
        self.st = State()
        self.server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler(self.st))
        threading.Thread(target=self.server.serve_forever, kwargs={'poll_interval': 0.01}, daemon=True).start()
        self.url = 'http://127.0.0.1:%d' % self.server.server_address[1]
        self.dir = tempfile.TemporaryDirectory()
        self.zips(NETBOX, NAUTOBOT)
        with open(os.path.join(self.dir.name, 'rack.json'), 'w', encoding='utf-8') as f:
            json.dump(RACK, f)

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.dir.cleanup()

    def zips(self, netbox, nautobot):
        for name, files in (('pt-verify-rack-netbox-import.zip', netbox), ('pt-verify-rack-nautobot-import.zip', nautobot)):
            with zipfile.ZipFile(os.path.join(self.dir.name, name), 'w') as z:
                for n, text in files.items():
                    z.writestr(n, text)
                if 'nautobot' in name:
                    z.writestr('import_cables.py', SCRIPT.read_text(encoding='utf-8'))

    def kits(self, *args):
        env = {'PATH': os.environ.get('PATH', ''), 'PT_VERIFY_KITS': self.dir.name,
               'PT_VERIFY_RESULT': os.path.join(self.dir.name, 'kits-result.json'),
               'PT_VERIFY_FIXTURE': os.path.join(self.dir.name, 'rack.json'),
               'NETBOX_URL': self.url, 'NETBOX_USER': 'someone', 'NETBOX_PASSWORD': PASSWORD,
               'NAUTOBOT_URL': self.url, 'NAUTOBOT_TOKEN': TOKEN}
        r = subprocess.run([sys.executable, str(HERE / 'kits.py'), *args], env=env, capture_output=True, text=True, timeout=120)
        path = env['PT_VERIFY_RESULT']
        text = pathlib.Path(path).read_text(encoding='utf-8') if os.path.isfile(path) else ''
        return r, (json.loads(text) if text else None), text + r.stdout + r.stderr

    def steps(self, result, target):
        return {s['id']: s for s in result['targets'][target]['steps']}

    def test_netbox_gets_the_kit_in_the_readmes_order_through_the_import_pages(self):
        r, result, raw = self.kits('run', 'netbox')
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        imports = [p for p, _, _ in self.st.posts if p.endswith('/import/')]
        self.assertEqual(imports, ['/dcim/sites/import/', '/dcim/device-roles/import/', '/dcim/manufacturers/import/',
                                   '/dcim/device-types/import/', '/dcim/module-types/import/', '/dcim/racks/import/',
                                   '/dcim/devices/import/', '/dcim/modules/import/', '/dcim/cables/import/'])
        data = {p: f['data'] for p, _, f in self.st.posts if p.endswith('/import/')}
        # A manufacturer and a type gain the prefix; nothing else in a file changes.
        self.assertIn('manufacturer: pt-verify-Acme\nmodel: pt-verify-SW-1\nslug: pt-verify-acme-sw-1\n', data['/dcim/device-types/import/'])
        self.assertEqual(data['/dcim/racks/import/'], NETBOX['1-rack.csv'])
        self.assertEqual(data['/dcim/devices/import/'], NETBOX['2-devices.csv'].replace(',Acme,SW-1,', ',pt-verify-Acme,pt-verify-SW-1,'))
        self.assertEqual(data['/dcim/modules/import/'], NETBOX['3-modules.csv'].replace(',CARD-1,', ',pt-verify-CARD-1,'))
        self.assertEqual(data['/dcim/cables/import/'], NETBOX['4-cables.csv'])
        steps = self.steps(result, 'netbox')
        self.assertTrue(all(s['accepted'] for s in steps.values()), [(k, s['accepted']) for k, s in steps.items()])
        self.assertEqual(steps['kit_devices']['notes'], ["4 manufacturer and type cell(s) prefixed; every other cell is the kit's"])
        self.assertEqual([(c['cable'], c['ok']) for c in steps['cables_compared']['created']], [('pt-verify-c1', True), ('pt-verify-loose', True)])
        self.assertEqual(steps['cables_compared']['created'][1]['kit'], 'Cable pt-verify-loose is not in the cables file: end A is not connected.')
        self.assertEqual(steps['cables_compared']['created'][0]['instance'], 'as written')

    def test_nautobot_gets_the_csvs_as_text_csv_and_its_cables_from_the_kits_own_script(self):
        r, result, raw = self.kits('run', 'nautobot')
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        csvs = [(p, b) for p, ct, b in self.st.posts if ct == 'text/csv']
        self.assertEqual([p for p, _ in csvs], ['/api/dcim/devices/', '/api/dcim/modules/', '/api/dcim/cables/'])
        self.assertEqual(csvs[0][1], NAUTOBOT['1-devices.csv'].replace(',Acme,SW-1,', ',pt-verify-Acme,pt-verify-SW-1,'))
        self.assertEqual(csvs[1][1], NAUTOBOT['2-modules.csv'].replace('Acme,CARD-1,', 'pt-verify-Acme,pt-verify-CARD-1,'))
        # The cable was created by the kit's script, by id: no file with the ends' names went to Nautobot's importer.
        self.assertEqual(csvs[2][1], 'termination_a_type,termination_a_id,termination_b_type,termination_b_id,status__name,type,label,length,length_unit\n'
                                     'dcim.interface,pt-verify-b:port-1,dcim.interface,pt-verify-a:slot-1/p0,Planned,cat6,pt-verify-c1,2,ft\n')
        steps = self.steps(result, 'nautobot')
        self.assertIsNone(steps['login']['accepted'])               # no NAUTOBOT_USER: the types went in over REST
        self.assertTrue(all(s['accepted'] for k, s in steps.items() if k != 'login'), [(k, s['accepted']) for k, s in steps.items()])
        self.assertIn('line 2 pt-verify-c1: would connect pt-verify-b port-1 to pt-verify-a slot-1/p0 (cat6, 2 ft, Planned).',
                      steps['script_dry_run']['messages'])
        self.assertIn('1 row: 1 created, 0 already connected, 0 failed.', steps['script_apply']['messages'])
        self.assertEqual(steps['cables_compared']['created'][0]['instance'], 'as written')

    def test_a_refused_file_and_a_cable_that_did_not_arrive_fail_the_run(self):
        self.st.refuse = 'cables'
        r, result, raw = self.kits('run', 'netbox')
        self.assertEqual(r.returncode, 1)
        steps = self.steps(result, 'netbox')
        self.assertFalse(steps['kit_cables']['accepted'])
        self.assertIn('Record 1 position: U14 is already occupied', ' '.join(steps['kit_cables']['messages']))
        self.assertFalse(steps['cables_compared']['accepted'])
        self.assertEqual(steps['cables_compared']['created'][0]['instance'], 'NOT FOUND')

    def test_a_kit_with_a_name_cleanup_could_not_find_is_refused_before_anything_is_sent(self):
        self.zips(dict(NETBOX, **{'2-devices.csv': NETBOX['2-devices.csv'].replace('pt-verify-b,', 'core-1,')}), NAUTOBOT)
        r, result, raw = self.kits('run', 'netbox')
        self.assertEqual((r.returncode, self.st.posts), (1, []))
        self.assertIn("2-devices.csv row 2: name is 'core-1', which does not start with pt-verify-", raw)

    def test_no_credential_reaches_the_output_and_plan_sends_nothing(self):
        r, result, raw = self.kits('run')
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertNotIn(PASSWORD, raw)
        self.assertNotIn(TOKEN, raw)
        self.assertNotIn(CSRF, raw)
        self.st.posts.clear()
        r, _, _ = self.kits('plan')
        self.assertEqual((r.returncode, self.st.posts), (0, []))
        self.assertIn('every name the kit creates starts with pt-verify-: yes', r.stdout)
        # a README item wraps over two lines: the plan reads it whole
        self.assertIn('left out by the kit: Cable pt-verify-loose is not in the cables file: end A is not connected.', r.stdout)


# The client's own test (a token request never carries the web session) runs with these.
from test_client import TokenRequestsNeverCarryTheSession  # noqa: E402,F401

if __name__ == '__main__':
    unittest.main(verbosity=1)
