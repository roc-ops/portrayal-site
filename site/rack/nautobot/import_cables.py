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
    python3 import_cables.py --help                  # this text

NAUTOBOT_URL is the address Nautobot answers at (with its path, if it has one;
no query, no user name). NAUTOBOT_TOKEN is an API token of a user who may add
cables: space around it is dropped, and one that holds a space, a control
character or a character that is not ASCII is refused, without being shown.
Without --apply nothing is created: that is the default.

Import the kit's devices and modules first: a card's ports exist only once its
module is in its bay. Python 3, standard library only. The script talks to the
host in NAUTOBOT_URL and to no other, follows no redirect, and uses no proxy.

It reports every row, by its line number in the file. Run it again after a
failure: a cable an earlier run made (both ports already joined to each other)
is reported as "already connected" and left alone. It exits 0 when no row
failed (each was, or in a dry run would be, created, or was already connected),
1 when a row could not be done, 2 when it could not start or had to stop, and
130 when it was interrupted. It never prints a traceback: an error it did not
expect is one line that names the kind of error and nothing else, so that no
part of the token can come out with it.
"""
import csv
import http.client
import ipaddress
import json
import os
import re
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
MAX_LENGTH = 32767                           # Nautobot's cable length: a PositiveSmallIntegerField
MAX_ROWS = 20000                             # far more cables than a rack has; a larger file is not a rack's
# What a terminal or a CSV reader may act on: the control characters, the line
# and paragraph separators, and the marks that change the direction text is
# shown in (they can make a line read as something it is not).
CONTROL = re.compile('[\\x00-\\x1f\\x7f-\\x9f\\u2028\\u2029\\u061c\\u200e\\u200f\\u202a-\\u202e\\u2066-\\u2069]')
TOKEN_OK = re.compile(r'[\x21-\x7e]+')       # printable ASCII with no space: what an HTTP header can carry
NEEDS_QUOTES = re.compile('[,"\\x00-\\x1f\\x7f-\\x9f\\u2028\\u2029]')
USAGE = 'usage: python3 import_cables.py [3-cables.csv] [--apply]   (--help says more)'
WHOLE = re.compile(r'[0-9]+')                # not str.isdigit: it accepts '²' and other digits int() refuses


class Stop(Exception):
    """The script cannot go on; the message says why."""


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def plain(text):
    """Text as a terminal may show it: a control character (an escape sequence, a
    bell, a line break) or a direction mark in a file's value or a server's
    answer becomes '?'."""
    return CONTROL.sub('?', str(text))


def spellings(secret):
    """Every way a text may spell `secret`, longest first: as it is, with the
    space around it dropped, and as Python (a str or a bytes repr, which is how
    http.client quotes a header it refuses), JSON or a URL would escape it."""
    out = set()
    for s in {secret or '', (secret or '').strip()}:
        if s.strip():                                # never a blank: hiding every space would hide the message
            out.update((s, repr(s)[1:-1], ascii(s)[1:-1], repr(s.encode('utf-8', 'replace'))[2:-1],
                        repr(s.encode('latin-1', 'replace'))[2:-1], json.dumps(s)[1:-1],
                        json.dumps(s, ensure_ascii=False)[1:-1], urllib.parse.quote(s, safe=''), urllib.parse.quote_plus(s)))
    return sorted(out, key=len, reverse=True)


def hide(text, secret):
    """`text` with every spelling of `secret` replaced."""
    text = str(text)
    for s in spellings(secret):
        text = text.replace(s, '***')
    return text


def token_of(env):
    """The API token, checked at the door: read once, the space around it
    dropped (a token read from a file often ends in a line break). What cannot
    go in an HTTP header is refused here, in words that do not repeat it."""
    token = (env.get('NAUTOBOT_TOKEN') or '').strip()
    if not token:
        raise Stop('NAUTOBOT_TOKEN is not set.')
    if not TOKEN_OK.fullmatch(token):
        raise Stop('NAUTOBOT_TOKEN holds a space, a control character or a character that is not ASCII, so it is not '
                   'an API token. Set it again, to the token alone. It is not shown here.')
    return token


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
        if '?' in base or '#' in base:
            raise Stop('NAUTOBOT_URL must not carry a query or a fragment (a "?" or a "#"): give the address alone.')
        if not token or not TOKEN_OK.fullmatch(token):
            raise Stop('NAUTOBOT_TOKEN is not set to an API token.')
        # `base` keeps a path (https://host/nautobot); `origin` is the scheme and host alone.
        self.base, self.scheme, self.netloc, self.token = base, u.scheme, u.netloc, token
        self.origin = '%s://%s' % (u.scheme, u.netloc)
        self.unencrypted = u.scheme == 'http' and not self.loopback(u.hostname)
        # No proxy and no redirect: every request goes to this host itself.
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    @staticmethod
    def loopback(host):
        try:
            return ipaddress.ip_address(host or '').is_loopback
        except ValueError:
            return (host or '').lower() == 'localhost'

    def clean(self, text):
        return hide(text, self.token)

    def url(self, path, from_root=False):
        """`path` is under the base URL. A link the server gave (`from_root`) already
        holds the base's own path, so it is joined to the host alone."""
        full = path if path.startswith(('http://', 'https://')) else (self.origin if from_root else self.base) + path
        u = urllib.parse.urlsplit(full)
        if (u.scheme, u.netloc) != (self.scheme, self.netloc):
            raise Stop('Refused to contact %s://%s: it is not the host in NAUTOBOT_URL.' % (u.scheme, u.netloc))
        return full

    def request(self, method, path, body=None, content_type='application/json', from_root=False):
        req = urllib.request.Request(self.url(path, from_root), data=body, method=method, headers={
            'Authorization': 'Token ' + self.token, 'Accept': 'application/json', 'Content-Type': content_type,
            'User-Agent': 'portrayal-import-cables/1'})
        try:
            with self.opener.open(req, timeout=TIMEOUT) as r:
                status, raw = r.status, r.read()
        except urllib.error.HTTPError as e:
            status, raw = e.code, e.read() or b''
            if status in (301, 302, 303, 307, 308):
                raise Stop('Nautobot answered with a redirect (HTTP %s). Set NAUTOBOT_URL to the address it answers at.' % status)
        except (urllib.error.URLError, OSError, http.client.HTTPException) as e:
            # The reason is the system's own words (connection refused, a certificate that does not
            # match): cleaned all the same. Any other error goes to main(), which prints its kind alone.
            raise Stop('Could not reach Nautobot: %s' % self.clean(getattr(e, 'reason', None) or e or type(e).__name__))
        text = raw.decode('utf-8', 'replace')
        try:
            return status, json.loads(text), text
        except ValueError:
            return status, None, text

    def listing(self, path, query):
        """Every result of a paginated list, or (None, why)."""
        out, nxt, root = [], '%s?%s' % (path, urllib.parse.urlencode(query)), False
        for _ in range(100):
            status, data, text = self.request('GET', nxt, from_root=root)
            if status in (401, 403):
                raise Stop('Nautobot refused the token (HTTP %s).' % status)
            if status != 200 or not isinstance(data, dict):
                return None, 'HTTP %s: %s' % (status, self.clean(text)[:300])
            out.extend(r for r in data.get('results') or [] if isinstance(r, dict))
            nxt = data.get('next')
            if not nxt:
                return out, None
            # A proxy in front may report another scheme or host: keep the path, which
            # already holds the base URL's own (https://host/nautobot/api/...).
            u = urllib.parse.urlsplit(nxt)
            nxt, root = u.path + ('?' + u.query if u.query else ''), True
        return None, 'the list did not end after 100 pages'

    def one(self, path):
        """One object by its address, or (None, why)."""
        status, data, text = self.request('GET', path)
        if status in (401, 403):
            raise Stop('Nautobot refused the token (HTTP %s).' % status)
        if status != 200 or not isinstance(data, dict):
            return None, 'HTTP %s: %s' % (status, self.clean(text)[:300])
        return data, None


def ends_of(cable):
    """The ids of a cable's two ends, as Nautobot reports them, or None."""
    if not isinstance(cable, dict):
        return None
    a, b = cable.get('termination_a_id'), cable.get('termination_b_id')
    return {a, b} if a and b and a != b else None


def ref_id(ref):
    """The id of a related object, as Nautobot gives one: {id, ...}, or the id alone."""
    return (ref.get('id') if isinstance(ref, dict) else ref) or None


def cable_id(port):
    return ref_id(port.get('cable'))


class Finder:
    """Finds a row's ends. A device is looked up by its name, which must be one
    device, and its id is kept; its ports are listed once per kind and kept. A
    port is used only when Nautobot says it is on that very device, by id:
    the list was asked for by the device's name, and a filter this Nautobot
    ignores, or reads another way (a name shaped like another device's id),
    would otherwise hand over another device's port."""

    def __init__(self, api):
        self.api, self.devices, self.ports, self.cables, self.modules = api, {}, {}, {}, {}

    def check_filters(self):
        """A device filter this Nautobot ignores would list every device's
        ports. A name nothing has must list nothing, or be refused as no
        device's name (HTTP 400); any other answer is not a check, and stops
        the run with what Nautobot said."""
        nobody = 'portrayal-no-such-device-' + uuid.uuid4().hex
        found, err = self.api.listing('/api/dcim/interfaces/', {'device': nobody, 'limit': 1, 'depth': 0})
        if found:
            raise Stop('This Nautobot ignores the device filter on /api/dcim/interfaces/, so a port cannot be '
                       'tied to its device. Nothing was looked up or created.')
        if err and not err.startswith('HTTP 400:'):
            raise Stop('Could not check that this Nautobot keeps a list of ports to one device (%s). '
                       'Nothing was looked up or created.' % err)

    def device(self, name):
        """(the device's id, None) or (None, why)."""
        if name not in self.devices:
            found, err = self.api.listing('/api/dcim/devices/', {'name': name, 'limit': 50, 'depth': 0})
            if err:
                self.devices[name] = None, 'the devices named %s could not be listed (%s)' % (name, err)
            else:
                same = [d for d in found if d.get('name') == name]
                if len(same) == 1 and same[0].get('id'):
                    self.devices[name] = same[0]['id'], None
                else:
                    self.devices[name] = None, ('there is no device named %s' % name if not same
                                                else 'Nautobot gave the device named %s no id' % name if len(same) == 1
                                                else '%d devices are named %s' % (len(same), name))
        return self.devices[name]

    def module_device(self, mid):
        """The id of the device a module is in, through its bay (and, for a
        module in a module's bay, up to the device), or None."""
        first = mid
        if first not in self.modules:
            dev = None
            for _ in range(5):
                module, _err = self.api.one('/api/dcim/modules/%s/?depth=1' % urllib.parse.quote(str(mid), safe=''))
                bay = (module or {}).get('parent_module_bay')
                if bay and not (isinstance(bay, dict) and ('parent_device' in bay or 'parent_module' in bay)):
                    bay, _err = self.api.one('/api/dcim/module-bays/%s/?depth=0' % urllib.parse.quote(str(ref_id(bay)), safe=''))
                if not isinstance(bay, dict):
                    break
                dev, mid = ref_id(bay.get('parent_device')), ref_id(bay.get('parent_module'))
                if dev or not mid:
                    break
            self.modules[first] = dev
        return self.modules[first]

    def owner(self, port):
        """The id of the device a port is on: its own, or its module's."""
        dev, mod = ref_id(port.get('device')), ref_id(port.get('module'))
        return dev or (self.module_device(mod) if mod else None)

    def end(self, device, kind, name):
        """(port, None) or (None, why). A port that already has a cable is found
        like any other: what that means is for the row to decide."""
        if kind not in ENDPOINTS:
            return None, '%s is not a kind of end this script knows' % (kind or 'a blank type')
        dev, why = self.device(device)
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
        if not same[0].get('id') or self.owner(same[0]) != dev:
            return None, ('Nautobot does not say that the %s named %s it listed for %s is on that device, '
                          'so it is not used' % (KIND[kind], name, device))
        return dict(same[0], _kind=kind), None

    def cable(self, cid):
        if cid not in self.cables:
            self.cables[cid] = self.api.one('/api/dcim/cables/%s/' % urllib.parse.quote(str(cid), safe=''))
        return self.cables[cid]

    def far_end(self, port, cid):
        """What the cable on `port` goes to, in words."""
        cable, err = self.cable(cid)
        if err or not ends_of(cable):
            return 'a cable this script could not read (%s)' % (err or 'it lists no ends')
        other = [i for i in ends_of(cable) if i != port['id']]
        kind = cable.get('termination_b_type') if cable.get('termination_a_id') == port['id'] else cable.get('termination_a_type')
        if other and kind in ENDPOINTS:
            obj, err = self.api.one('/api/dcim/%s/%s/?depth=1' % (ENDPOINTS[kind], urllib.parse.quote(str(other[0]), safe='')))
            if obj and obj.get('name'):
                dev = obj.get('device')
                return ('%s %s' % (dev.get('name', '') if isinstance(dev, dict) else '', obj['name'])).strip()
        return 'another port (id %s)' % (other[0] if other else '?')


def read_rows(path):
    """[(line number, row)] for each row with something in it. A line number is the
    file's: where the row's record starts, so a quoted field that runs over lines
    does not shift the rows after it."""
    try:
        with open(path, newline='', encoding='utf-8-sig') as f:
            reader = csv.reader(f)
            header, rows = None, []
            while True:
                start = reader.line_num + 1
                try:
                    cells = next(reader)
                except StopIteration:
                    break
                if header is None:
                    header = [c.strip() for c in cells]
                    continue
                if any(c.strip() for c in cells):
                    rows.append((start, {h: (cells[i] if i < len(cells) else '') for i, h in enumerate(header)}))
    except OSError as e:
        raise Stop('Could not read %s: %s' % (path, e.strerror or e))
    except UnicodeDecodeError:
        raise Stop('%s is not UTF-8 text. Use the 3-cables.csv from the Nautobot import kit as it is.' % path)
    except csv.Error as e:
        raise Stop('%s could not be read as CSV: %s.' % (path, e))
    missing = [c for c in REQUIRED if c not in (header or [])]
    if missing:
        raise Stop('%s is not the Rack Builder\'s 3-cables.csv: it has no %s column. '
                   'Use the 3-cables.csv from the Nautobot import kit.' % (path, ', '.join(missing)))
    if len(rows) > MAX_ROWS:
        raise Stop('%s has %d rows, and this script takes at most %d in one file. Split the file, keeping its '
                   'first line in each part.' % (path, len(rows), MAX_ROWS))
    return rows


def cable_csv(row, a, b):
    """One cable as Nautobot's importer takes it: its ends by type and id, and
    only the other columns that have a value (a unit with no length is dropped)."""
    cell = lambda k: (row.get(k) or '').strip()
    cols = [('termination_a_type', cell('a_type')), ('termination_a_id', a['id']),
            ('termination_b_type', cell('b_type')), ('termination_b_id', b['id']),
            ('status__name', cell('status') or 'Planned')]
    cols += [(k, cell(k)) for k in ('type', 'label', 'color', 'length', 'length_unit')
             if cell(k) and (k != 'length_unit' or cell('length'))]
    # A cell with a comma, a quote, a space at an edge or ANY control character is quoted: a reader
    # that splits lines on a form feed or a line separator must not see a new row in a label.
    quoted = lambda c: '"%s"' % c.replace('"', '""') if c != c.strip() or NEEDS_QUOTES.search(c) else c
    return ''.join(','.join(quoted(str(c)) for c in cells) + '\n' for cells in ([k for k, _ in cols], [v for _, v in cols]))


def describe(row):
    cell = lambda k: (row.get(k) or '').strip()
    length = ('%s %s' % (cell('length'), cell('length_unit'))).strip() if cell('length') else ''
    extra = ', '.join(x for x in (cell('type'), length, cell('status') or 'Planned') if x)
    return '%s %s to %s %s (%s)' % (cell('a_device'), cell('a_name'), cell('b_device'), cell('b_name'), extra)


def problems_of(row):
    """What is wrong with a row before Nautobot is asked anything."""
    cell = lambda k: (row.get(k) or '').strip()
    out = []
    for side in ('a', 'b'):
        for what, col in (('device', side + '_device'), ('port', side + '_name')):
            if not cell(col):
                out.append('end %s has no %s name' % (side.upper(), what))
    length = cell('length')
    if length and not WHOLE.fullmatch(length):
        out.append('its length %s is not a whole number, and Nautobot takes only whole numbers' % length)
    elif length and int(length) > MAX_LENGTH:
        out.append('its length %s is more than Nautobot stores (%d)' % (length, MAX_LENGTH))
    return out


def run(argv, env, out, err=None):
    err = err or sys.stderr
    args = [a for a in argv[1:] if not a.startswith('-')]
    flags = [a for a in argv[1:] if a.startswith('-')]
    if any(f in ('--help', '-h') for f in flags):
        print((__doc__ or USAGE).strip(), file=out, flush=True)
        return 0
    if any(f not in ('--apply',) for f in flags) or len(args) > 1:
        raise Stop(USAGE)
    apply = '--apply' in flags
    path = args[0] if args else '3-cables.csv'
    api = Api(env.get('NAUTOBOT_URL'), token_of(env))
    # Every line goes through here: the token is hidden, and a control character
    # in a value from the file or the server cannot act on the terminal.
    say = lambda text: print(plain(api.clean(text)), file=out, flush=True)
    rows = read_rows(path)
    if api.unencrypted:
        print('Warning: NAUTOBOT_URL is http, not https, and %s is not this computer: the token will be sent unencrypted.'
              % plain(api.netloc), file=err, flush=True)
    say('Nautobot at %s. %s' % (api.netloc, 'Creating cables.' if apply else 'A dry run: nothing is created. Add --apply to create the cables.'))
    finder = Finder(api)
    finder.check_filters()
    made_count = connected = bad = 0
    claimed = {}                                      # port id -> the line of this file that uses it
    for line, row in rows:
        cell = lambda k: (row.get(k) or '').strip()
        name = 'line %d %s' % (line, cell('label') or '(no label)')
        problems = problems_of(row)
        a = b = None
        if not problems:
            a, why_a = finder.end(cell('a_device'), cell('a_type'), cell('a_name'))
            b, why_b = finder.end(cell('b_device'), cell('b_type'), cell('b_name'))
            problems += [w for w in (why_a, why_b) if w]
        if not problems and a['id'] == b['id']:
            problems.append('both ends are the same port')
        if not problems:
            # A port already in a cable: if it is this row's own cable (both ends joined to each other),
            # an earlier run made it; any other cable is in the way, and the row says what it goes to.
            ca, cb = cable_id(a), cable_id(b)
            if ca and ca == cb:
                cable, why = finder.cable(ca)
                if ends_of(cable) == {a['id'], b['id']}:
                    connected += 1
                    claimed[a['id']] = claimed[b['id']] = line
                    say('%s: already connected: %s.' % (name, describe(row)))
                    continue
                problems.append('both ports are in cable %s, which does not join just them (%s)' % (ca, why or 'its ends differ'))
            else:
                for port, cid, device, pname in ((a, ca, cell('a_device'), cell('a_name')), (b, cb, cell('b_device'), cell('b_name'))):
                    if cid:
                        problems.append('%s %s already has a cable, to %s' % (device, pname, finder.far_end(port, cid)))
            for port, device, pname in ((a, cell('a_device'), cell('a_name')), (b, cell('b_device'), cell('b_name'))):
                if port['id'] in claimed:
                    problems.append('%s %s is already used by line %d of this file' % (device, pname, claimed[port['id']]))
        if problems:
            bad += 1
            say('%s: cannot connect %s: %s.' % (name, describe(row), '; '.join(problems)))
            continue
        claimed[a['id']] = claimed[b['id']] = line
        if not apply:
            made_count += 1
            say('%s: would connect %s.' % (name, describe(row)))
            continue
        status, data, text = api.request('POST', '/api/dcim/cables/', cable_csv(row, a, b).encode('utf-8'), 'text/csv')
        made = (data[0] if isinstance(data, list) and data else data) if status in (200, 201) else None
        if not isinstance(made, dict):
            bad += 1
            say('%s: Nautobot refused %s: HTTP %s %s' % (name, describe(row), status, api.clean(text)[:600]))
            continue
        # Trust neither the answer alone: fetch the cable again by its id and look at both ends.
        want = {a['id'], b['id']}
        again, why = (finder.api.one('/api/dcim/cables/%s/' % urllib.parse.quote(str(made.get('id')), safe=''))
                      if made.get('id') else (None, 'its answer has no id'))
        if ends_of(made) != want or ends_of(again) != want:
            bad += 1
            say('%s: Nautobot created cable %s, but it does not show both of these ends (%s). Check it in Nautobot, '
                'and delete it if it connects nothing.' % (name, made.get('id'), 'fetched again: ' + why if why
                                                           else 'its answer' if ends_of(made) != want else 'fetched again'))
            continue
        made_count += 1
        say('%s: connected %s.' % (name, describe(row)))
    total = '%d row%s' % (len(rows), '' if len(rows) == 1 else 's')
    counts = '%d %s, %d already connected, %d failed' % (made_count, 'created' if apply else 'would be created', connected, bad)
    say('%s: %s.%s' % (total, counts, '' if apply else ' Nothing was created.'))
    return 1 if bad else 0


def main(argv=None, env=None, out=None):
    """Runs, and says in one line why it stopped. Nothing is printed that did not
    go through `tell`, which hides the token however it is spelled; and an
    error nobody expected is named by its kind alone, never by its own text,
    which may quote what was being sent. So no traceback, ever."""
    token = ''

    def tell(text):
        try:
            print(plain(hide(text, token)), file=sys.stderr, flush=True)
        except Exception:                                # a closed or an ASCII-only stderr: the exit code still says it
            pass

    try:
        env = env if env is not None else os.environ
        token = env.get('NAUTOBOT_TOKEN') or ''
        return run(argv or sys.argv, env, out or sys.stdout)
    except Stop as e:
        tell(e)
        return 2
    except (csv.Error, UnicodeDecodeError, http.client.HTTPException) as e:
        tell('Stopped: %s (%s).' % (type(e).__name__, e))
        return 2
    except KeyboardInterrupt:
        tell('Stopped: interrupted. A cable already created stays; run the script again to go on.')
        return 130
    except Exception as e:                               # noqa: BLE001 - its text is never printed
        tell('Stopped: an error this script did not expect (%s). Its details are not shown, so that the token can '
             'never be printed. A cable already created stays; run the script again to go on.' % type(e).__name__)
        return 2


if __name__ == '__main__':
    sys.exit(main())
