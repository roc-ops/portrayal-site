#!/usr/bin/env python3
"""Create a rack's cables in Nautobot from the Portrayal Rack Builder's 3-cables.csv.

Nautobot cannot import a cable whose ends are given by name: its importer takes
each end by id, and from a file that names the ends it creates cables with no
ends at all. So the Rack Builder's Nautobot kit carries a file that names each
end (device, kind of port, port name) and this script, which looks each end up
through Nautobot's REST API and creates the cable by id.

    export NAUTOBOT_URL=https://nautobot.example.com
    export NAUTOBOT_TOKEN=...                        # an API token; never printed
    python3 import_cables.py 3-cables.csv            # a dry run: nothing is created
    python3 import_cables.py 3-cables.csv --apply    # create the cables

Import the kit's devices and modules first: a card's ports exist only once its
module is in its bay. Python 3, standard library only. The script talks to the
host in NAUTOBOT_URL and to no other, follows no redirect, and uses no proxy.
It reports every row. It exits 0 when every row was (or, in a dry run, would
be) created, 1 when a row could not be, and 2 when it could not start.
"""
import csv
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid

COLUMNS = ['a_device', 'a_type', 'a_name', 'b_device', 'b_type', 'b_name', 'type', 'status', 'label', 'color',
           'length', 'length_unit']
REQUIRED = COLUMNS[:6]
# The kinds of end a row can name, and the REST list each is found in.
ENDPOINTS = {
    'dcim.interface': 'interfaces', 'dcim.frontport': 'front-ports', 'dcim.rearport': 'rear-ports',
    'dcim.consoleport': 'console-ports', 'dcim.consoleserverport': 'console-server-ports',
    'dcim.powerport': 'power-ports', 'dcim.poweroutlet': 'power-outlets'}
KIND = {'dcim.interface': 'interface', 'dcim.frontport': 'front port', 'dcim.rearport': 'rear port',
        'dcim.consoleport': 'console port', 'dcim.consoleserverport': 'console server port',
        'dcim.powerport': 'power port', 'dcim.poweroutlet': 'power outlet'}
TIMEOUT = 60


class Stop(Exception):
    """The script cannot go on; the message says why."""


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class Api:
    """Nautobot's REST API at one host. The token goes in the Authorization
    header of requests to that host and nowhere else."""

    def __init__(self, base, token):
        base = (base or '').strip().rstrip('/')
        u = urllib.parse.urlsplit(base)
        if u.scheme not in ('http', 'https') or not u.netloc:
            raise Stop('NAUTOBOT_URL must be an http or https address, such as https://nautobot.example.com.')
        if u.username or u.password or '@' in u.netloc:
            raise Stop('NAUTOBOT_URL must not carry a user name or a password.')
        if not token:
            raise Stop('NAUTOBOT_TOKEN is not set.')
        self.base, self.scheme, self.netloc, self.token = base, u.scheme, u.netloc, token
        # No proxy and no redirect: every request goes to this host itself.
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    def clean(self, text):
        return str(text).replace(self.token, '***')

    def url(self, path):
        full = path if path.startswith(('http://', 'https://')) else self.base + path
        u = urllib.parse.urlsplit(full)
        if (u.scheme, u.netloc) != (self.scheme, self.netloc):
            raise Stop('Refused to contact %s://%s: it is not the host in NAUTOBOT_URL.' % (u.scheme, u.netloc))
        return full

    def request(self, method, path, body=None, content_type='application/json'):
        req = urllib.request.Request(self.url(path), data=body, method=method, headers={
            'Authorization': 'Token ' + self.token, 'Accept': 'application/json', 'Content-Type': content_type,
            'User-Agent': 'portrayal-import-cables/1'})
        try:
            with self.opener.open(req, timeout=TIMEOUT) as r:
                status, raw = r.status, r.read()
        except urllib.error.HTTPError as e:
            status, raw = e.code, e.read() or b''
            if status in (301, 302, 303, 307, 308):
                raise Stop('Nautobot answered with a redirect (HTTP %s). Set NAUTOBOT_URL to the address it answers at.' % status)
        except (urllib.error.URLError, OSError) as e:
            raise Stop('Could not reach Nautobot: %s' % self.clean(getattr(e, 'reason', e)))
        text = raw.decode('utf-8', 'replace')
        try:
            return status, json.loads(text), text
        except ValueError:
            return status, None, text

    def listing(self, path, query):
        """Every result of a paginated list, or (None, why)."""
        out, nxt = [], '%s?%s' % (path, urllib.parse.urlencode(query))
        for _ in range(100):
            status, data, text = self.request('GET', nxt)
            if status in (401, 403):
                raise Stop('Nautobot refused the token (HTTP %s).' % status)
            if status != 200 or not isinstance(data, dict):
                return None, 'HTTP %s: %s' % (status, self.clean(text)[:300])
            out.extend(data.get('results') or [])
            nxt = data.get('next')
            if not nxt:
                return out, None
            u = urllib.parse.urlsplit(nxt)          # a proxy in front may report another scheme or host: keep the path
            nxt = u.path + ('?' + u.query if u.query else '')
        return None, 'the list did not end after 100 pages'


class Finder:
    """Finds a row's ends. A device is looked up by its name, which must be one
    device; its ports are listed once per kind and kept."""

    def __init__(self, api):
        self.api, self.devices, self.ports = api, {}, {}

    def check_filters(self):
        """A device filter this Nautobot ignores would list every device's
        ports, and a port could then be taken from the wrong device. A name
        nothing has must list nothing."""
        nobody = 'portrayal-no-such-device-' + uuid.uuid4().hex
        found, _ = self.api.listing('/api/dcim/interfaces/', {'device': nobody, 'limit': 1, 'depth': 0})
        if found:
            raise Stop('This Nautobot ignores the device filter on /api/dcim/interfaces/, so a port cannot be '
                       'tied to its device. Nothing was looked up or created.')

    def device(self, name):
        if name not in self.devices:
            found, err = self.api.listing('/api/dcim/devices/', {'name': name, 'limit': 50, 'depth': 0})
            if err:
                self.devices[name] = 'the devices named %s could not be listed (%s)' % (name, err)
            else:
                same = [d for d in found if d.get('name') == name]
                self.devices[name] = None if len(same) == 1 else (
                    'there is no device named %s' % name if not same else '%d devices are named %s' % (len(same), name))
        return self.devices[name]

    def end(self, device, kind, name):
        """(port, None) or (None, why)."""
        if kind not in ENDPOINTS:
            return None, '%s is not a kind of end this script knows' % (kind or 'a blank type')
        why = self.device(device)
        if why:
            return None, why
        key = (kind, device)
        if key not in self.ports:
            self.ports[key] = self.api.listing('/api/dcim/%s/' % ENDPOINTS[kind], {'device': device, 'limit': 1000, 'depth': 0})
        found, err = self.ports[key]
        if err:
            return None, "%s's %ss could not be listed (%s)" % (device, KIND[kind], err)
        same = [p for p in found if p.get('name') == name]
        if not same:
            return None, '%s has no %s named %s' % (device, KIND[kind], name)
        if len(same) > 1:
            return None, '%s has %d %ss named %s' % (device, len(same), KIND[kind], name)
        if same[0].get('cable'):
            return None, '%s %s already has a cable' % (device, name)
        return same[0], None


def read_rows(path):
    try:
        with open(path, newline='', encoding='utf-8-sig') as f:
            reader = csv.DictReader(f)
            header = reader.fieldnames or []
            rows = [r for r in reader if any((v or '').strip() for v in r.values())]
    except OSError as e:
        raise Stop('Could not read %s: %s' % (path, e.strerror or e))
    missing = [c for c in REQUIRED if c not in header]
    if missing:
        raise Stop('%s is not the Rack Builder\'s 3-cables.csv: it has no %s column. '
                   'Use the 3-cables.csv from the Nautobot import kit.' % (path, ', '.join(missing)))
    return rows


def cable_csv(row, a, b):
    """One cable as Nautobot's importer takes it: its ends by type and id, and
    only the other columns that have a value."""
    cell = lambda k: (row.get(k) or '').strip()
    cols = [('termination_a_type', cell('a_type')), ('termination_a_id', a['id']),
            ('termination_b_type', cell('b_type')), ('termination_b_id', b['id']),
            ('status__name', cell('status') or 'Planned')]
    cols += [(k, cell(k)) for k in ('type', 'label', 'color', 'length', 'length_unit') if cell(k)]
    out = []
    for cells in ([k for k, _ in cols], [v for _, v in cols]):
        out.append(','.join('"%s"' % str(c).replace('"', '""') if any(x in str(c) for x in ',"\r\n') else str(c)
                            for c in cells))
    return '\n'.join(out) + '\n'


def describe(row):
    cell = lambda k: (row.get(k) or '').strip()
    extra = ', '.join(x for x in (cell('type'), ('%s %s' % (cell('length'), cell('length_unit'))).strip(),
                                  cell('status') or 'Planned') if x)
    return '%s %s to %s %s (%s)' % (cell('a_device'), cell('a_name'), cell('b_device'), cell('b_name'), extra)


def run(argv, env, out):
    args = [a for a in argv[1:] if not a.startswith('--')]
    flags = [a for a in argv[1:] if a.startswith('--')]
    if any(f not in ('--apply',) for f in flags) or len(args) > 1:
        raise Stop('usage: python3 import_cables.py [3-cables.csv] [--apply]')
    apply = '--apply' in flags
    path = args[0] if args else '3-cables.csv'
    api = Api(env.get('NAUTOBOT_URL'), env.get('NAUTOBOT_TOKEN'))
    say = lambda text: print(api.clean(text), file=out, flush=True)
    rows = read_rows(path)
    say('Nautobot at %s. %s' % (api.netloc, 'Creating cables.' if apply else 'A dry run: nothing is created. Add --apply to create the cables.'))
    finder = Finder(api)
    finder.check_filters()
    good = bad = 0
    for n, row in enumerate(rows, 1):
        cell = lambda k: (row.get(k) or '').strip()
        name = 'row %d %s' % (n, cell('label') or '(no label)')
        length = cell('length')
        problems = []
        if length and not length.isdigit():
            problems.append('its length %s is not a whole number, and Nautobot takes only whole numbers' % length)
        a, why_a = finder.end(cell('a_device'), cell('a_type'), cell('a_name'))
        b, why_b = finder.end(cell('b_device'), cell('b_type'), cell('b_name'))
        problems += [w for w in (why_a, why_b) if w]
        if not problems and a['id'] == b['id']:
            problems.append('both ends are the same port')
        if problems:
            bad += 1
            say('%s: cannot connect %s: %s.' % (name, describe(row), '; '.join(problems)))
            continue
        if not apply:
            good += 1
            a['cable'] = b['cable'] = True               # a later row naming the same port is caught here too
            say('%s: would connect %s.' % (name, describe(row)))
            continue
        status, data, text = api.request('POST', '/api/dcim/cables/', cable_csv(row, a, b).encode('utf-8'), 'text/csv')
        made = (data[0] if isinstance(data, list) and data else data) if status in (200, 201) else None
        if not isinstance(made, dict):
            bad += 1
            say('%s: Nautobot refused %s: HTTP %s %s' % (name, describe(row), status, text[:600]))
            continue
        if made.get('termination_a_id') != a['id'] or made.get('termination_b_id') != b['id']:
            bad += 1
            say('%s: Nautobot created cable %s WITHOUT ITS ENDS. Delete it in Nautobot; it connects nothing.'
                % (name, made.get('id')))
            continue
        good += 1
        a['cable'] = b['cable'] = True
        say('%s: connected %s.' % (name, describe(row)))
    total = '%d row%s' % (len(rows), '' if len(rows) == 1 else 's')
    if apply:
        say('%s: %d created, %d not.' % (total, good, bad))
    else:
        say('%s: %d would be created, %d cannot be. Nothing was created.' % (total, good, bad))
    return 1 if bad else 0


def main(argv=None, env=None, out=None):
    try:
        return run(argv or sys.argv, env if env is not None else os.environ, out or sys.stdout)
    except Stop as e:
        token = (env if env is not None else os.environ).get('NAUTOBOT_TOKEN') or ''
        print(str(e).replace(token, '***') if token else str(e), file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
