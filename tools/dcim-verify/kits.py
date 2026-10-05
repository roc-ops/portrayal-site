#!/usr/bin/env python3
"""Acceptance for the Rack Builder's DCIM import kits (Phase 2c, ruling 10).

Imports the two zips the Rack Builder REALLY exports for acceptance.rack.json
(made by export_kits.py, into kits/) into a NetBox and a Nautobot test
instance, in the order each kit's README gives, and reports per file and per
row, then compares the cables each instance ends up with against the rack's.

    python3 tools/dcim-verify/export_kits.py                  # the two zips, from the page
    python3 tools/dcim-verify/kits.py plan [netbox|nautobot]  # offline: what a run would send
    python3 tools/dcim-verify/kits.py run  [netbox|nautobot]  # do it, write kits-result.json
    python3 tools/dcim-verify/verify.py cleanup               # delete every pt-verify- object

NetBox: the kit's files through the web UI's import pages. Nautobot: the
CSVs to the REST API as text/csv, then the kit's own import_cables.py.

Connection details come ONLY from environment variables, as for verify.py:
    NETBOX_URL  NETBOX_USER  NETBOX_PASSWORD  [NETBOX_TOKEN]
    NAUTOBOT_URL  NAUTOBOT_TOKEN  [NAUTOBOT_USER  NAUTOBOT_PASSWORD]
Nothing here prints, logs or stores a credential. Standard library only.

A kit's files go in as they are, with ONE change, so that everything created
carries the pt-verify- prefix and cleanup can find it: a manufacturer and a
type are renamed with the prefix, in the YAML's identity lines and in the CSV
cells that name them. Each step records how many cells it changed. Every other
name (rack, devices, cable labels, site, role) is the fixture's own, which
already starts with the prefix; a kit with a name that does not is refused.
"""
import csv
import datetime
import io
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.parse
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import verify as V  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
KITS = os.environ.get('PT_VERIFY_KITS') or os.path.join(HERE, 'kits')
RESULT = os.environ.get('PT_VERIFY_RESULT') or os.path.join(HERE, 'kits-result.json')
FIXTURE = os.environ.get('PT_VERIFY_FIXTURE') or os.path.join(HERE, 'acceptance.rack.json')
P = V.PREFIX
ZIP = {'netbox': 'pt-verify-rack-netbox-import.zip', 'nautobot': 'pt-verify-rack-nautobot-import.zip'}
FILES = {'netbox': [('1-rack.csv', 'racks'), ('2-devices.csv', 'devices'), ('3-modules.csv', 'modules'), ('4-cables.csv', 'cables')],
         'nautobot': [('1-devices.csv', 'devices'), ('2-modules.csv', 'modules')]}
# The cells that name a manufacturer or a type, which gain the prefix.
TYPE_CELLS = {'2-devices.csv': ['manufacturer', 'device_type'], '3-modules.csv': ['module_type'],
              '1-devices.csv': ['device_type__manufacturer__name', 'device_type__model'],
              '2-modules.csv': ['module_type__manufacturer__name', 'module_type__model']}
# The cells that must already carry the prefix: the names the fixture gives.
OWN_CELLS = {'1-rack.csv': ['site', 'name'], '2-devices.csv': ['name', 'role', 'site', 'rack'], '3-modules.csv': ['device'],
             '4-cables.csv': ['side_a_device', 'side_b_device', 'label'],
             '1-devices.csv': ['name', 'role__name', 'location__name', 'rack__name'],
             '2-modules.csv': ['parent_module_bay__parent_device__name'], '3-cables.csv': ['a_device', 'b_device', 'label']}
ENDPOINTS = {'dcim.interface': 'interfaces', 'dcim.frontport': 'front-ports', 'dcim.rearport': 'rear-ports',
             'dcim.consoleport': 'console-ports', 'dcim.consoleserverport': 'console-server-ports',
             'dcim.powerport': 'power-ports', 'dcim.poweroutlet': 'power-outlets'}


# ── a kit, read ────────────────────────────────────────────────────────────
class Kit:
    def __init__(self, target):
        path = os.path.join(KITS, ZIP[target])
        if not os.path.isfile(path):
            raise V.Refused('%s is not there. Run "python3 tools/dcim-verify/export_kits.py" first.' % path)
        self.target, self.path = target, path
        with zipfile.ZipFile(path) as z:
            self.names = z.namelist()
            self.files = {n: z.read(n).decode('utf-8') for n in self.names}

    def rows(self, name):
        return list(csv.DictReader(io.StringIO(self.files.get(name, ''), newline='')))

    def types(self):
        """(kind, entry, text), device types first, as the README orders them."""
        out = [(n.split('/')[1], n, self.files[n]) for n in self.names if n.startswith('types/') and n.endswith('.yaml')]
        return sorted(out, key=lambda t: (t[0] != 'device-types', t[1]))

    def readme_list(self, heading):
        """The items of one of the README's lists ("Not in this kit:", "Notes:"). The page
        wraps an item over several lines, each after the first indented two columns;
        an item is read whole, on one line."""
        part = self.files.get('README.txt', '').partition(heading + '\n')[2].partition('\n\n')[0]
        items = []
        for line in part.split('\n'):
            if line.startswith('- '):
                items.append(line[2:])
            elif line.startswith('  ') and items:
                items[-1] += ' ' + line.strip()
        return items

    def left_out(self):
        """The README's "Not in this kit:" items (none when it says "Nothing: ...")."""
        return [l for l in self.readme_list('Not in this kit:') if not l.startswith('Nothing: every device, card and cable')]

    def problems(self):
        """Why this kit must not be imported into someone's instance: a name
        it would create that the cleanup could not find again."""
        bad = []
        for name, cols in OWN_CELLS.items():
            for n, row in enumerate(self.rows(name), 1):
                for c in cols:
                    if not str(row.get(c) or '').startswith(P):
                        bad.append('%s row %d: %s is %r, which does not start with %s' % (name, n, c, row.get(c), P))
        return bad


def prefixed_cells(name, text):
    """The file with its manufacturer and type cells prefixed; how many changed."""
    cols = TYPE_CELLS.get(name) or []
    rows = list(csv.reader(io.StringIO(text, newline='')))
    if not rows or not cols:
        return text, 0
    idx = [rows[0].index(c) for c in cols if c in rows[0]]
    n = 0
    for r in rows[1:]:
        for i in idx:
            if i < len(r) and r[i]:
                r[i] = P + r[i]
                n += 1
    b = io.StringIO()
    csv.writer(b, lineterminator='\r\n').writerows(rows)
    return b.getvalue(), n


def slug(s):
    return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')


def read_type(text):
    """A type YAML as the exporter writes it, without a YAML library: its
    top-level scalars, and each section's items with their own scalars."""
    unq = lambda v: v[1:-1].replace("''", "'") if len(v) > 1 and v[0] == v[-1] == "'" else (json.loads(v) if v[:1] == '"' and v[-1:] == '"' else v)
    d, section, item = {}, None, None
    for line in text.split('\n'):
        m = re.match(r'^([A-Za-z_][\w-]*):\s*(.*?)\s*$', line)
        if m:
            section, item = (m.group(1), None) if m.group(2) == '' else (None, None)
            if m.group(2) != '':
                d.setdefault(m.group(1), unq(m.group(2)))
            else:
                d[section] = []
            continue
        if section is None:
            continue
        m = re.match(r'^  - name:\s*(.*?)\s*$', line)
        if m:
            item = {'name': unq(m.group(1))}
            d[section].append(item)
            continue
        m = item is not None and re.match(r'^    ([a-z_]+):\s*(.*?)\s*$', line)
        if m:
            item[m.group(1)] = unq(m.group(2))
    return d


# ── steps shared by both targets ───────────────────────────────────────────
def skipped(run, sid, title, why):
    s = run.step(sid, title, 'accept')
    s['messages'] = [why]
    run.done(s)
    return s


def rack_cables(kit, cable_file, found):
    """Every cable of the rack file against the kit and the instance: in the
    file and connected as written, or left out with the README's sentence."""
    with open(FIXTURE, encoding='utf-8') as f:
        rack = json.load(f)['racks'][0]
    in_file = {r['label'] for r in kit.rows(cable_file)}
    left = kit.left_out()
    out, ok = [], True
    for c in rack.get('cables') or []:
        label = c.get('label') or c.get('id')
        why = next((l for l in left if l.startswith('Cable %s is not in the cables file' % label)), None)
        state = found.get(label)
        if label in in_file:
            good = state == 'as written'
            out.append({'cable': label, 'kit': 'in the cables file', 'instance': state or 'NOT FOUND', 'ok': good})
        else:
            good = why is not None and state is None
            out.append({'cable': label, 'kit': why or 'LEFT OUT WITH NO README LINE', 'instance': state or 'not there, as expected', 'ok': good})
        ok = ok and good
    return out, ok


def devices_compared(run, kit, device_file, c, query):
    """Every device of the kit's devices file exists on the instance under its
    exact final name, and nothing else under the prefix does. That includes the
    names at the 64-character limit, and two devices whose labels differ only by
    case ("Twin" and "twin"): the kit renamed both, and NetBox, which treats
    names as one ignoring case, must have taken both."""
    s = run.step('devices_compared', "the instance's devices against the kit's devices file", 'accept')
    names = [r['name'] for r in kit.rows(device_file)]
    have, err = c.api_list('/api/dcim/devices/?' + urllib.parse.urlencode(dict(query, name__isw=P, limit=200)))
    got = [str(o.get('name')) for o in have if str(o.get('name') or '').startswith(P)]
    problems = [err] if err else []
    table = []
    for n in names:
        ok = n in got
        table.append({'device': n, 'characters': len(n), 'instance': 'as written' if ok else 'NOT FOUND', 'ok': ok})
        if not ok:
            problems.append('%s is in the kit and not on the instance under that name' % n)
    for n in got:
        if n not in names:
            problems.append('%s is on the instance and not in the kit' % n)
    folded = {}
    for n in names:
        folded.setdefault(n.lower(), []).append(n)
    twins = [v for v in folded.values() if len(v) > 1]
    s['created'] = table
    s['messages'] = problems + ['names that differ only by case, all present: %s' % json.dumps(twins)] * bool(twins and not problems)
    s['accepted'] = not problems
    run.done(s)


def compared(run, kit, cable_file, found, problems):
    s = run.step('cables_compared', "the instance's cables against the kit's rows and the rack's cables", 'accept')
    table, ok = rack_cables(kit, cable_file, found)
    s['created'] = table
    s['messages'] = problems
    s['accepted'] = ok and not problems
    run.done(s)


# ── NetBox: the README's order, through the web UI ─────────────────────────
def run_netbox(run, kit):
    c = V.Client('netbox')
    ok, why = c.login()
    s = run.step('login', 'sign in to the web UI (session form + CSRF)', 'accept', request={'method': 'POST', 'path': '/login/'})
    s['accepted'], s['messages'] = ok, [why]
    run.done(s)
    if not ok:
        return
    st = c.api('GET', '/api/status/')
    run.info['version'] = (st.json() or {}).get('netbox-version') if st.status == 200 else None
    have, _ = c.api_list('/api/dcim/devices/?' + urllib.parse.urlencode({'name__isw': P, 'limit': 50}))
    if [o for o in have if str(o.get('name') or '').startswith(P)] and '--continue' not in sys.argv:
        skipped(run, 'preflight', 'the instance already has %s devices' % P,
                'Run "verify.py cleanup netbox" first, or pass --continue.')['accepted'] = False
        return
    rack = kit.rows('1-rack.csv')[0]
    role = next((r['role'] for r in kit.rows('2-devices.csv')), P + 'role')
    mans = sorted({read_type(t).get('manufacturer', '') for _, _, t in kit.types()} - {''})
    # What the README says must already exist: a site, a device role, the manufacturers.
    V.nb_import(c, run, 'prereq_site', 'README prerequisite: the site', 'sites',
                'name,slug,status\n%s,%s,planned\n' % (rack['site'], slug(rack['site'])), 'csv', 'accept')
    V.nb_import(c, run, 'prereq_role', 'README prerequisite: the device role', 'device-roles',
                'name,slug,color\n%s,%s,9e9e9e\n' % (role, slug(role)), 'csv', 'accept')
    V.nb_import(c, run, 'prereq_manufacturers', 'README prerequisite: the manufacturers', 'manufacturers',
                'name,slug\n' + ''.join('%s%s,%s\n' % (P, m, slug(P + m)) for m in mans), 'csv', 'accept')
    for kind, entry, text in kit.types():
        V.nb_import(c, run, 'types_' + re.sub(r'\W+', '_', entry[6:-5]), 'README step 1: %s (identity lines prefixed)' % entry,
                    kind, V.prefixed_yaml(text), 'yaml', 'accept')
    for step, (name, kind) in enumerate(FILES['netbox'], 2):
        text, n = prefixed_cells(name, kit.files[name])
        title = 'README step %d: %s, %d row%s' % (step, name, len(kit.rows(name)), '' if len(kit.rows(name)) == 1 else 's')
        if not kit.rows(name):
            skipped(run, 'kit_' + kind, title, 'no rows: the README says to skip it')
            continue
        V.nb_import(c, run, 'kit_' + kind, title, kind, text, 'csv', 'accept',
                    notes=['%d manufacturer and type cell(s) prefixed; every other cell is the kit\'s' % n])
    # What NetBox now holds, against the kit's rows.
    cables, err = c.api_list('/api/dcim/cables/?' + urllib.parse.urlencode({'label__isw': P, 'limit': 200}))
    have = {}
    for o in cables:
        ends = []
        for side in ('a_terminations', 'b_terminations'):
            for t in o.get(side) or []:
                obj = t.get('object') or {}
                ends.append((t.get('object_type'), (obj.get('device') or {}).get('name'), obj.get('name')))
        unit = o.get('length_unit')
        have[o.get('label')] = {'ends': sorted(ends), 'type': o.get('type') or '', 'length': o.get('length'),
                                'unit': (unit.get('value') if isinstance(unit, dict) else unit) or '',
                                'status': (o.get('status') or {}).get('value') if isinstance(o.get('status'), dict) else o.get('status'),
                                'description': o.get('description') or ''}
    found, problems = {}, [err] if err else []
    for r in kit.rows('4-cables.csv'):
        want = {'ends': sorted([(r['side_a_type'], r['side_a_device'], r['side_a_name']), (r['side_b_type'], r['side_b_device'], r['side_b_name'])]),
                'type': r['type'], 'length': float(r['length']) if r['length'] else None, 'unit': r['length_unit'],
                'status': r['status'], 'description': r['description']}
        got = have.get(r['label'])
        if got and got['length'] is not None:
            got['length'] = float(got['length'])
        found[r['label']] = 'as written' if got == want else ('DIFFERS: %s' % json.dumps(got) if got else None)
        if got != want:
            problems.append('%s: the kit says %s, NetBox has %s' % (r['label'], json.dumps(want), json.dumps(got)))
    for label in have:
        if label not in found:
            found[label] = 'IN NETBOX BUT NOT IN THE KIT'
            problems.append('%s is in NetBox and not in the kit' % label)
    devices_compared(run, kit, '2-devices.csv', c, {})
    compared(run, kit, '4-cables.csv', found, problems)


# ── Nautobot: the CSVs as text/csv, then the kit's own script ──────────────
def rest_type(c, run, sid, title, kind, d):
    """Without a UI sign-in: the type built through the REST API from the
    kit's YAML. It lets the later steps run; it does not test the YAML import."""
    body = {'manufacturer': {'name': P + d['manufacturer']}, 'model': P + d['model']}
    if kind == 'device-types':
        body.update({'u_height': int(float(d.get('u_height', 1))), 'is_full_depth': str(d.get('is_full_depth', 'true')) == 'true'})
    s = V.nt_post_json(c, run, sid, title + ' [REST fallback, not the UI import]', '/api/dcim/%s/' % kind, body)
    if not s['accepted']:
        return s
    parent = 'device_type' if kind == 'device-types' else 'module_type'
    for section, ep in V.NT_TEMPLATES:
        rows = []
        for t in d.get(section) or []:
            row = {parent: s['object_id'], 'name': t['name']}
            if section == 'module-bays':
                row['position'] = str(t.get('position', ''))
            else:
                row['type'] = t.get('type', 'other')
            rows.append(row)
        if rows:
            r = c.api('POST', '/api/dcim/%s/' % ep, rows)
            if r.status not in (200, 201):
                s['notes'].append('%s: HTTP %s %s' % (ep, r.status, V.clip(r.text, 600)))
                s['accepted'] = False
    return s


def run_script(run, kit, sid, title, flags, expect=None):
    """The kit's own import_cables.py, as shipped, against the kit's own
    3-cables.csv. It gets the URL and the token from the environment, as a
    user's would; its output is recorded, redacted."""
    s = run.step(sid, title, 'accept', request={'method': 'RUN', 'path': 'python3 import_cables.py 3-cables.csv ' + ' '.join(flags)})
    s['path_used'] = "the kit's own import_cables.py, unchanged"
    if 'import_cables.py' not in kit.files:
        s['accepted'], s['messages'] = False, ['the kit has no import_cables.py']
        run.done(s)
        return s
    with tempfile.TemporaryDirectory() as d:
        for n in ('import_cables.py', '3-cables.csv'):
            with open(os.path.join(d, n), 'w', encoding='utf-8', newline='') as f:
                f.write(kit.files[n])
        env = {k: os.environ[k] for k in ('NAUTOBOT_URL', 'NAUTOBOT_TOKEN', 'PATH') if k in os.environ}
        r = subprocess.run([sys.executable, 'import_cables.py', '3-cables.csv', *flags], cwd=d, env=env,
                           capture_output=True, text=True, timeout=600)
    s['http_status'] = r.returncode
    s['accepted'] = r.returncode == 0
    s['messages'] = [V.redact(l) for l in (r.stdout + r.stderr).split('\n') if l.strip()]
    # An exit code of 0 says no row failed; `expect` is the summary line the run must also print.
    if expect and s['accepted'] and not any(m.startswith(expect) for m in s['messages']):
        s['accepted'] = False
        s['messages'].append('expected the summary "%s"' % expect)
    run.done(s)
    return s


def run_nautobot(run, kit):
    c = V.Client('nautobot')
    if not os.environ.get('NAUTOBOT_TOKEN'):
        skipped(run, 'token', 'NAUTOBOT_TOKEN is set', 'NAUTOBOT_TOKEN is not set.')['accepted'] = False
        return
    st = c.api('GET', '/api/status/')
    s = run.step('api', 'reach the REST API with the token', 'accept', request={'method': 'GET', 'path': '/api/status/'})
    s['http_status'], s['accepted'] = st.status, st.status == 200
    run.info['version'] = (st.json() or {}).get('nautobot-version') if st.status == 200 else None
    run.done(s)
    if not s['accepted']:
        return
    have, _ = c.api_list('/api/dcim/devices/?' + urllib.parse.urlencode({'name__isw': P, 'limit': 50, 'depth': 0}))
    if [o for o in have if str(o.get('name') or '').startswith(P)] and '--continue' not in sys.argv:
        skipped(run, 'preflight', 'the instance already has %s devices' % P,
                'Run "verify.py cleanup nautobot" first, or pass --continue.')['accepted'] = False
        return
    ui, why = c.login()
    s = run.step('login', 'sign in to the web UI (only for the type YAML import, README step 1)', 'accept',
                 request={'method': 'POST', 'path': '/login/'})
    s['accepted'], s['messages'] = (ui if os.environ.get('NAUTOBOT_USER') else None), [why]
    run.done(s)
    with open(FIXTURE, encoding='utf-8') as f:
        frame = json.load(f)['racks'][0]['frame']
    dev = kit.rows('1-devices.csv')[0]
    types = [(kind, entry, read_type(text), text) for kind, entry, text in kit.types()]
    # What the README says must already exist.
    for man in sorted({d.get('manufacturer', '') for _, _, d, _ in types} - {''}):
        V.nt_post_json(c, run, 'prereq_manufacturer_' + re.sub(r'\W+', '_', man), 'README prerequisite: manufacturer %s' % man,
                       '/api/dcim/manufacturers/', {'name': P + man})
    V.nt_post_json(c, run, 'prereq_role', 'README prerequisite: the role, for devices', '/api/extras/roles/',
                   {'name': dev['role__name'], 'color': '9e9e9e', 'content_types': ['dcim.device']})
    V.nt_post_json(c, run, 'prereq_location_type', 'README prerequisite: a location type that allows devices and racks',
                   '/api/dcim/location-types/', {'name': P + 'loctype', 'nestable': False, 'content_types': ['dcim.device', 'dcim.rack']})
    V.nt_post_json(c, run, 'prereq_location', 'README prerequisite: the location', '/api/dcim/locations/',
                   {'name': dev['location__name'], 'location_type': {'name': P + 'loctype'}, 'status': {'name': 'Active'}})
    V.nt_post_json(c, run, 'prereq_rack', 'README prerequisite: the rack', '/api/dcim/racks/',
                   {'name': dev['rack__name'], 'location': {'name': dev['location__name']}, 'status': {'name': 'Active'},
                    'u_height': frame['heightRU'], 'desc_units': frame.get('numbering') == 'top-down'})
    for kind, entry, d, text in types:
        sid = 'types_' + re.sub(r'\W+', '_', entry[6:-5])
        if ui:
            r = V.nt_ui_type(c, run, sid, 'README step 1, through the UI: %s (identity lines prefixed)' % entry, kind, V.prefixed_yaml(text))
            if r['accepted']:
                continue
            sid += '_rest'
        rest_type(c, run, sid, entry, kind, d)
    for step, (name, kind) in enumerate(FILES['nautobot'], 2):
        text, n = prefixed_cells(name, kit.files[name])
        title = 'README step %d: %s, %d row%s' % (step, name, len(kit.rows(name)), '' if len(kit.rows(name)) == 1 else 's')
        if not kit.rows(name):
            skipped(run, 'kit_' + kind, title, 'no rows: the README says to skip it')
            continue
        V.nt_csv(c, run, 'kit_' + kind, title, '/api/dcim/%s/' % kind, text, 'accept',
                 notes=['%d manufacturer and type cell(s) prefixed; every other cell is the kit\'s' % n])
    n = len(kit.rows('3-cables.csv'))
    total = '%d row%s' % (n, '' if n == 1 else 's')
    run_script(run, kit, 'script_dry_run', 'README step 4: import_cables.py, a dry run', [],
               '%s: %d would be created, 0 already connected, 0 failed. Nothing was created.' % (total, n))
    run_script(run, kit, 'script_apply', 'README step 4: import_cables.py --apply', ['--apply'],
               '%s: %d created, 0 already connected, 0 failed.' % (total, n))
    # The README says to run it again after a failure: on the same file every row is a cable it already made.
    run_script(run, kit, 'script_apply_again', 'README step 4: import_cables.py --apply, a second time on the same file', ['--apply'],
               '%s: 0 created, %d already connected, 0 failed.' % (total, n))
    # What Nautobot now holds, against the kit's rows: each cable's two ends by id.
    cables, err = c.api_list('/api/dcim/cables/?' + urllib.parse.urlencode({'label__isw': P, 'limit': 200, 'depth': 0}))
    have = {o.get('label'): o for o in cables}
    ports, found, problems = {}, {}, [err] if err else []

    def port_id(device, kind, name):
        key = (kind, device)
        if key not in ports:
            ports[key] = c.api_list('/api/dcim/%s/?%s' % (ENDPOINTS.get(kind, 'interfaces'),
                                                           urllib.parse.urlencode({'device': device, 'limit': 1000, 'depth': 0})))[0]
        return next((p.get('id') for p in ports[key] if p.get('name') == name), None)

    val = lambda v: (v.get('value') if isinstance(v, dict) else v) or ''
    for r in kit.rows('3-cables.csv'):
        want = {'ends': sorted([str(port_id(r['a_device'], r['a_type'], r['a_name'])), str(port_id(r['b_device'], r['b_type'], r['b_name']))]),
                'type': r['type'], 'length': int(r['length']) if r['length'] else None, 'unit': r['length_unit']}
        o = have.get(r['label'])
        got = o and {'ends': sorted([str(o.get('termination_a_id')), str(o.get('termination_b_id'))]), 'type': val(o.get('type')),
                     'length': o.get('length'), 'unit': val(o.get('length_unit'))}
        found[r['label']] = 'as written' if got == want else ('DIFFERS: %s' % json.dumps(got) if got else None)
        if got != want:
            problems.append('%s: the kit says %s, Nautobot has %s' % (r['label'], json.dumps(want), json.dumps(got)))
    for label in have:
        if label not in found:
            found[label] = 'IN NAUTOBOT BUT NOT IN THE KIT'
            problems.append('%s is in Nautobot and not in the kit' % label)
    devices_compared(run, kit, '1-devices.csv', c, {'depth': 0})
    compared(run, kit, '3-cables.csv', found, problems)


# ── plan (offline) and main ────────────────────────────────────────────────
def plan(target):
    kit = Kit(target)
    host = urllib.parse.urlsplit(os.environ.get(V.ENV[target][0], '')).netloc or '<%s not set>' % V.ENV[target][0]
    V.say('\n== %s, at %s: %s ==' % (target, host, kit.path))
    V.say('   credentials: ' + ', '.join('%s %s' % (n, 'set' if os.environ.get(n) else 'not set') for n in V.ENV[target][1:]))
    bad = kit.problems()
    V.say('   every name the kit creates starts with %s: %s' % (P, 'yes' if not bad else 'NO - a run is refused'))
    for b in bad[:10]:
        V.say('     ' + b)
    V.say('   prerequisites created first (the README says they must exist): site or location, role, manufacturers'
          + (', the rack' if target == 'nautobot' else ''))
    for kind, entry, text in kit.types():
        V.say('   import  %-58s as a %s YAML, identity lines prefixed' % (entry, kind[:-1]))
    for name, kind in FILES[target]:
        text, n = prefixed_cells(name, kit.files[name])
        V.say('   import  %-16s %d row(s), %d cell(s) prefixed, columns: %s' % (name, len(kit.rows(name)), n, ','.join(V.header_row(text))))
    if target == 'nautobot':
        V.say('   run     import_cables.py 3-cables.csv (dry run), then --apply, then --apply again (every row already connected): %d row(s)'
              % len(kit.rows('3-cables.csv')))
    V.say('   compare the devices the instance has with the kit\'s devices file, by exact name')
    V.say('   compare the cables the instance has with the kit\'s rows and the rack file\'s cables')
    for l in kit.left_out():
        V.say('   left out by the kit: ' + l)


def write_result(runs, started):
    out = {'kit': 'portrayal dcim-verify kits 1', 'prefix': P, 'started': started,
           'finished': datetime.datetime.now().isoformat(timespec='seconds'), 'targets': {}}
    for r in runs:
        out['targets'][r.target] = {'host': urllib.parse.urlsplit(os.environ.get(V.ENV[r.target][0], '')).netloc,
                                    'info': r.info, 'steps': r.steps}

    def clean(v):
        if isinstance(v, str):
            return V.redact(v)
        if isinstance(v, list):
            return [clean(x) for x in v]
        if isinstance(v, dict):
            return {k: clean(x) for k, x in v.items()}
        return v

    with open(RESULT, 'w', encoding='utf-8') as f:
        f.write(json.dumps(clean(out), indent=1, ensure_ascii=False) + '\n')


def main(argv):
    cmd = argv[1] if len(argv) > 1 else ''
    if cmd not in ('plan', 'run'):
        V.say(__doc__)
        return 2
    rc = 0
    if cmd == 'plan':
        for t in V.targets(argv[2:]):
            try:
                plan(t)
            except V.Refused as e:
                V.say('  [%s] %s' % (t, e))
                rc = 1
        V.say('\nNothing was sent. "kits.py run" does this; "verify.py cleanup" removes it.')
        return rc
    started, runs = datetime.datetime.now().isoformat(timespec='seconds'), []
    for t in V.targets(argv[2:]):
        V.say('== %s ==' % t)
        run = V.Run(t)
        runs.append(run)
        try:
            kit = Kit(t)
            bad = kit.problems()
            if bad:
                raise V.Refused('the kit has names without the %s prefix, which cleanup could not remove: %s' % (P, '; '.join(bad[:5])))
            (run_netbox if t == 'netbox' else run_nautobot)(run, kit)
        except V.Refused as e:
            s = run.step('refused', 'the run was refused', 'accept')
            s['accepted'], s['messages'] = False, [str(e)]
            run.done(s)
        except Exception as e:                              # noqa: BLE001 - every run reports
            s = run.step('crashed', 'the run stopped', 'accept')
            s['accepted'], s['messages'] = False, ['%s: %s' % (type(e).__name__, V.redact(e))]
            run.done(s)
        write_result(runs, started)
    V.say('\nWrote %s' % RESULT)
    for run in runs:
        failed = [s for s in run.steps if s['accepted'] is False]
        V.say('%s: %d steps, %d failed%s' % (run.target, len(run.steps), len(failed),
                                             '' if not failed else ': ' + ', '.join(s['id'] for s in failed)))
        rc |= 1 if failed else 0
    return rc


if __name__ == '__main__':
    sys.exit(main(sys.argv))
