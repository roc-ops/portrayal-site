#!/usr/bin/env python3
"""Verify what NetBox and Nautobot really accept on import, for the Portrayal
Rack Builder's Phase 2c (cable import).

    python3 verify.py plan    [netbox|nautobot|all]   # offline: what a run would do
    python3 verify.py run     [netbox|nautobot|all]   # do it, write result.json
    python3 verify.py cleanup [netbox|nautobot|all]   # delete the pt-verify- objects
                              [--dry-run]

Connection details come ONLY from environment variables:
    NETBOX_URL  NETBOX_USER  NETBOX_PASSWORD  [NETBOX_TOKEN]
    NAUTOBOT_URL  NAUTOBOT_TOKEN  [NAUTOBOT_USER  NAUTOBOT_PASSWORD]
Nothing here prints, logs or stores a credential. Standard library only.

Every object this creates has a name (a cable: a label; a type: a model)
that starts with PREFIX, and cleanup deletes only objects whose own name
starts with PREFIX, checked again on this side before each delete.
"""
import csv
import datetime
import html.parser
import http.cookiejar
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

PREFIX = 'pt-verify-'
HERE = os.path.dirname(os.path.abspath(__file__))
FIX = os.path.join(HERE, 'fixture')
OUT = os.path.join(HERE, 'out')
RESULT = os.path.join(HERE, 'result.json')
TIMEOUT = 90
ENV = {
    'netbox': ('NETBOX_URL', 'NETBOX_TOKEN', 'NETBOX_USER', 'NETBOX_PASSWORD'),
    'nautobot': ('NAUTOBOT_URL', 'NAUTOBOT_TOKEN', 'NAUTOBOT_USER', 'NAUTOBOT_PASSWORD'),
}
DEVICES = [PREFIX + n for n in ('core-1', 'leaf-1', 'demarc-i3', 'demarc-i4')]
TYPE_FILES = [  # (kind, fixture file, manufacturer, model)
    ('device-types', 'Cisco--ASR-9006-AC-V2.yaml', 'Cisco', 'ASR-9006-AC-V2'),
    ('device-types', 'Edgecore--7726-32X-O-AC-F.yaml', 'Edgecore', '7726-32X-O-AC-F'),
    ('device-types', 'Telco Systems--TM-280.yaml', 'Telco Systems', 'TM-280'),
    ('module-types', 'Cisco--A9K-16X100GE-TR.yaml', 'Cisco', 'A9K-16X100GE-TR'),
]


# ── secrets ────────────────────────────────────────────────────────────────
def secrets():
    out = []
    for names in ENV.values():
        for n in names[1:]:
            v = os.environ.get(n, '')
            if v:
                out.append(v)
    return sorted(set(out), key=len, reverse=True)


def redact(text):
    s = str(text)
    for v in secrets():
        if len(v) >= 3:
            s = s.replace(v, '***')
            s = s.replace(urllib.parse.quote(v, safe=''), '***')
            s = s.replace(urllib.parse.quote_plus(v), '***')
    s = re.sub(r'(csrfmiddlewaretoken["\'\s=:]+(?:value=)?["\']?)[A-Za-z0-9]{20,}', r'\1***', s)
    s = re.sub(r'(?i)(authorization:\s*)\S+(\s+\S+)?', r'\1***', s)
    return s


def say(*a):
    print(redact(' '.join(str(x) for x in a)), flush=True)


# ── fixture ────────────────────────────────────────────────────────────────
def read(target, *parts):
    with open(os.path.join(FIX, target, *parts), encoding='utf-8') as f:
        return f.read()


def prefixed_yaml(text):
    """The repository's YAML with only its identity lines renamed, so that the
    manufacturer and the type this creates carry PREFIX. Everything else - the
    component lists, the comments - goes in exactly as the repository has it."""
    out, seen = [], set()
    for line in text.split('\n'):
        m = re.match(r'^(manufacturer|model|slug):\s*(.*?)\s*$', line)
        if m and m.group(1) not in seen:
            seen.add(m.group(1))
            v = m.group(2)
            q = v[0] if v[:1] in '\'"' and v[-1:] == v[:1] else ''
            if q:
                v = v[1:-1]
            line = '%s: %s%s%s%s' % (m.group(1), q, PREFIX, v, q)
        out.append(line)
    return '\n'.join(out)


def header_row(text):
    return next(csv.reader(io.StringIO(text)), [])


def row_count(text):
    return max(0, sum(1 for r in csv.reader(io.StringIO(text)) if r) - 1)


# ── http ───────────────────────────────────────────────────────────────────
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


class Refused(Exception):
    pass


class Resp:
    def __init__(self, status, headers, body):
        self.status, self.headers, self.body = status, headers, body

    @property
    def text(self):
        return self.body.decode('utf-8', 'replace')

    def json(self):
        try:
            return json.loads(self.text)
        except ValueError:
            return None

    @property
    def location(self):
        return self.headers.get('Location') or ''


class Client:
    """One instance, one host. A request to any other host is refused, and so
    is a redirect that leaves it."""

    def __init__(self, target):
        url_var = ENV[target][0]
        base = os.environ.get(url_var, '').strip().rstrip('/')
        if not base:
            raise Refused('%s is not set.' % url_var)
        u = urllib.parse.urlsplit(base)
        if u.scheme not in ('http', 'https') or not u.netloc:
            raise Refused('%s must be an http(s) URL.' % url_var)
        if u.username or u.password or '@' in u.netloc:
            raise Refused('%s must not carry credentials.' % url_var)
        self.target, self.base, self.netloc, self.scheme = target, base, u.netloc, u.scheme
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar), NoRedirect())
        self.csrf = ''

    def url(self, path):
        full = path if re.match(r'^https?://', path) else self.base + path
        u = urllib.parse.urlsplit(full)
        if u.netloc != self.netloc or u.scheme != self.scheme:
            raise Refused('refused: %s://%s is not the host in %s' % (u.scheme, u.netloc, ENV[self.target][0]))
        return full

    def request(self, method, path, body=None, headers=None, follow=False):
        full = self.url(path)
        h = {'User-Agent': 'portrayal-dcim-verify/1', 'Referer': self.base + '/'}
        h.update(headers or {})
        req = urllib.request.Request(full, data=body, method=method, headers=h)
        try:
            with self.opener.open(req, timeout=TIMEOUT) as r:
                resp = Resp(r.status, r.headers, r.read())
        except urllib.error.HTTPError as e:
            resp = Resp(e.code, e.headers, e.read() or b'')
        hops = 0
        while follow and resp.status in (301, 302, 303, 307, 308) and resp.location and hops < 5:
            hops += 1
            nxt = urllib.parse.urljoin(full, resp.location)
            full = self.url(nxt)
            req = urllib.request.Request(full, method='GET', headers=h)
            try:
                with self.opener.open(req, timeout=TIMEOUT) as r:
                    resp = Resp(r.status, r.headers, r.read())
            except urllib.error.HTTPError as e:
                resp = Resp(e.code, e.headers, e.read() or b'')
        return resp

    # -- the web UI (session + CSRF) --
    def page(self, path):
        r = self.request('GET', path, follow=True)
        m = re.search(r'name=["\']csrfmiddlewaretoken["\'][^>]*value=["\']([^"\']+)', r.text) or \
            re.search(r'value=["\']([^"\']+)["\'][^>]*name=["\']csrfmiddlewaretoken', r.text)
        if m:
            self.csrf = m.group(1)
        return r

    def form(self, path, fields):
        data = dict(fields)
        data['csrfmiddlewaretoken'] = self.csrf
        body = urllib.parse.urlencode(data).encode('utf-8')
        return self.request('POST', path, body, {'Content-Type': 'application/x-www-form-urlencoded',
                                                 'X-CSRFToken': self.csrf, 'Referer': self.base + path})

    def login(self):
        user = os.environ.get(ENV[self.target][2], '')
        pw = os.environ.get(ENV[self.target][3], '')
        if not user or not pw:
            return False, '%s / %s are not set' % (ENV[self.target][2], ENV[self.target][3])
        p = self.page('/login/')
        if not self.csrf:
            return False, 'the login page (HTTP %s) has no CSRF field' % p.status
        r = self.form('/login/', {'username': user, 'password': pw, 'next': '/'})
        if r.status in (301, 302, 303) and '/login' not in r.location:
            return True, 'signed in'
        errs = page_errors(r.text)
        return False, 'sign-in was not accepted (HTTP %s): %s' % (r.status, '; '.join(errs) or 'no message found')

    # -- the REST API --
    def api_headers(self, csv_body=False):
        h = {'Accept': 'application/json'}
        tok = os.environ.get(ENV[self.target][1], '')
        if tok:
            # NetBox 4.7: "Bearer nbt_<key>.<token>" for a v2 token, "Token <token>" for v1.
            word = 'Bearer' if (self.target == 'netbox' and tok.startswith('nbt_')) else 'Token'
            h['Authorization'] = '%s %s' % (word, tok)
        elif self.csrf:
            h['X-CSRFToken'] = self.csrf       # session auth: the cookie jar carries the session
        h['Content-Type'] = 'text/csv' if csv_body else 'application/json'
        return h

    def api(self, method, path, data=None, csv_text=None):
        body = None
        if csv_text is not None:
            body = csv_text.encode('utf-8')
        elif data is not None:
            body = json.dumps(data).encode('utf-8')
        return self.request(method, path, body, self.api_headers(csv_text is not None))

    def api_list(self, path, max_pages=50):
        """Every result of a paginated list (same host only)."""
        out, nxt, pages = [], path, 0
        while nxt and pages < max_pages:
            pages += 1
            r = self.api('GET', nxt)
            j = r.json()
            if r.status != 200 or not isinstance(j, dict):
                return out, 'HTTP %s: %s' % (r.status, clip(r.text))
            out.extend(j.get('results') or [])
            nxt = j.get('next')
            if nxt:
                u = urllib.parse.urlsplit(nxt)
                nxt = u.path + ('?' + u.query if u.query else '')   # some proxies report another scheme
        return out, None


def clip(s, n=1500):
    s = redact(s)
    return s if len(s) <= n else s[:n] + ' …[%d more characters]' % (len(s) - n)


# ── reading an HTML response for its messages ──────────────────────────────
ERR_CLASSES = ('alert', 'errorlist', 'invalid-feedback', 'text-danger', 'toast', 'has-error', 'help-block',
               'form-errors', 'messages')
VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'}


class Messages(html.parser.HTMLParser):
    """The text of every element whose class marks a message. Tags are kept on
    a stack and an end tag closes everything opened since its start, as a
    browser does, so an unclosed <p> or <li> cannot lose a message."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack, self.bufs, self.out, self.skip = [], [], [], 0

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'):
            self.skip += 1
        if tag in VOID:
            return
        cls = dict(attrs).get('class') or ''
        root = any(c in cls for c in ERR_CLASSES)
        self.stack.append((tag, root))
        if root:
            self.bufs.append([])

    def _flush(self):
        t = ' '.join(' '.join(self.bufs.pop()).split())
        if t:
            self.out.append(t)

    def handle_endtag(self, tag):
        if tag in ('script', 'style') and self.skip:
            self.skip -= 1
        if tag in VOID or not any(t == tag for t, _ in self.stack):
            return
        while self.stack:
            t, root = self.stack.pop()
            if root:
                self._flush()
            if t == tag:
                break

    def handle_data(self, data):
        if self.bufs and not self.skip:
            for b in self.bufs:
                b.append(data)

    def close(self):
        super().close()
        while self.bufs:
            self._flush()


def page_errors(text):
    p = Messages()
    try:
        p.feed(text)
        p.close()
    except Exception:
        pass
    out = []
    for t in p.out:
        if t not in out:
            out.append(t)
    plain = re.sub(r'<(script|style)\b.*?</\1>', ' ', text, flags=re.S | re.I)
    plain = html.unescape(re.sub(r'<[^>]+>', '\n', plain))
    for line in plain.split('\n'):
        line = ' '.join(line.split())
        if re.match(r'^(Record \d+|Row \d+)\b', line) and not any(line in t for t in out):
            out.append(line)
    return [clip(t, 2000) for t in out]


def save_page(name, text):
    """A rejected import's page, kept for a second look. The CSRF token is cut."""
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, re.sub(r'[^A-Za-z0-9._-]+', '-', name) + '.html')
    with open(path, 'w', encoding='utf-8') as f:
        f.write(redact(text))
    return os.path.relpath(path, HERE)


# ── a run's record ─────────────────────────────────────────────────────────
class Run:
    def __init__(self, target):
        self.target, self.steps, self.inventory, self.info = target, [], {}, {}

    def step(self, sid, title, expected='accept', **kw):
        s = {'id': sid, 'title': title, 'expected': expected, 'request': None, 'http_status': None,
             'accepted': None, 'messages': [], 'created': [], 'notes': []}
        s.update(kw)
        self.steps.append(s)
        return s

    def done(self, s):
        mark = {True: 'ACCEPTED', False: 'REJECTED', None: 'NOT RUN'}[s['accepted']]
        odd = ''
        if s['accepted'] is not None and s['expected'] in ('accept', 'reject'):
            if (s['expected'] == 'accept') != s['accepted']:
                odd = '   <-- not what was expected (%s)' % s['expected']
        say('  [%s] %-9s %s%s' % (self.target, mark, s['title'], odd))
        for m in s['messages'][:6]:
            say('        ', clip(m, 300))
        for n in s['notes'][:4]:
            say('         note:', clip(n, 300))


def request_record(method, path, text=None, fmt=None):
    rec = {'method': method, 'path': path}
    if text is not None:
        rec['format'] = fmt
        if fmt == 'csv':
            rec['header_row'] = header_row(text)
            rec['rows'] = row_count(text)
            rec['body'] = text
        else:
            rec['body_head'] = text[:400]
    return rec


# ── placeholders in the fixture CSVs ────────────────────────────────────────
def card_name(inv, device, wanted):
    """The interface a card port got. `wanted` is the name this kit expects
    ('slot-2/p0'); when the instance named it otherwise, the real one."""
    names = [i['name'] for i in (inv.get(device, {}).get('interfaces') or [])]
    if wanted in names or not names:
        return wanted, None
    leaf = wanted.split('/')[-1]
    bay = wanted.split('/')[0]
    cands = [n for n in names if re.search(r'(^|[^A-Za-z0-9])' + re.escape(leaf) + r'$', n)]
    pick = next((n for n in cands if bay in n), cands[0] if cands else None)
    if pick:
        return pick, 'expected %s on %s; the instance has %s, used instead' % (wanted, device, pick)
    return wanted, 'expected %s on %s; no such interface, and none ends in %s' % (wanted, device, leaf)


def fill(text, inv, core=PREFIX + 'core-1'):
    notes, missing = [], []

    def card(m):
        name, note = card_name(inv, core, m.group(1))
        if note and note not in notes:
            notes.append(note)
        return name

    text = re.sub(r'@card\(([^)]*)\)', card, text)

    def ident(m):
        kind, device, name = m.group(1), m.group(2), m.group(3)
        key = {'interfaces': 'interfaces', 'console-ports': 'console_ports', 'module-bays': 'module_bays'}[kind]
        for o in inv.get(device, {}).get(key) or []:
            if o.get('name') == name and o.get('id'):
                return str(o['id'])
        missing.append('%s %s on %s' % (kind, name, device))
        return ''

    text = re.sub(r'@id\(([a-z-]+)\|([^|)]*)\|([^)]*)\)', ident, text)
    return text, notes, missing


# ── NetBox: the web UI's bulk import ───────────────────────────────────────
NB_IMPORT = {
    'sites': '/dcim/sites/import/', 'manufacturers': '/dcim/manufacturers/import/',
    'device-roles': '/dcim/device-roles/import/', 'racks': '/dcim/racks/import/',
    'device-types': '/dcim/device-types/import/', 'module-types': '/dcim/module-types/import/',
    'devices': '/dcim/devices/import/', 'modules': '/dcim/modules/import/', 'cables': '/dcim/cables/import/',
}
NB_STEPS = [
    # (id, title, kind, file, expected)
    ('prereq_sites', 'prerequisite: a site', 'sites', 'prereq-sites.csv', 'accept'),
    ('prereq_manufacturers', 'prerequisite: manufacturers', 'manufacturers', 'prereq-manufacturers.csv', 'accept'),
    ('prereq_device_roles', 'prerequisite: a device role', 'device-roles', 'prereq-device-roles.csv', 'accept'),
    ('prereq_racks', 'prerequisite: a 24U rack', 'racks', 'prereq-racks.csv', 'accept'),
    ('probe_rack_top_down', 'probe: a rack numbered top down (desc_units)', 'racks', 'probe-rack-top-down.csv', 'unknown'),
]
NB_MODULE_STEPS = [
    ('modules', 'modules CSV: the line card in core-1 slot-2', 'modules.csv', 'accept'),
    ('modules_v_position_accessor', 'modules variant: bay named by module_bay.position (slot-3)',
     'modules-v-position-accessor.csv', 'unknown'),
    ('modules_x_no_status', 'modules variant: no status column (slot-4)', 'modules-v-no-status.csv', 'reject'),
    ('modules_x_manufacturer_column', 'modules variant: a manufacturer column (slot-4)',
     'modules-v-manufacturer-column.csv', 'reject'),
    ('modules_v_replicate', 'modules variant: replicate_components / adopt_components (slot-5)',
     'modules-v-replicate.csv', 'unknown'),
]
NB_CABLE_STEPS = [
    ('cables_with_bad_row', 'cables CSV: two good rows and one naming a port that does not exist', 'cables.csv', 'reject'),
    ('cables_good', 'cables CSV: the two good rows alone (OS2 with a card port; Cat6a)', 'cables-good.csv', 'accept'),
    ('cables_v_minimal', 'cables variant: only the six side_* columns and a label', 'cables-v-minimal.csv', 'unknown'),
    ('cables_v_site', 'cables variant: side_a_site / side_b_site', 'cables-v-site.csv', 'unknown'),
    ('cables_v_decimal_ft', 'cables variant: length 1.5 ft, OM4, connected', 'cables-v-decimal-ft.csv', 'unknown'),
    ('cables_v_types', 'cables variant: dac-passive, aoc (with a color), mmf-om3, mmf-om5, cat6',
     'cables-v-dac-aoc.csv', 'unknown'),
    ('cables_x_media_slug', "cables: Portrayal's own media id (os2) as the type", 'cables-x-media-slug.csv', 'reject'),
    ('cables_x_status_label', 'cables: status spelled as its label (Planned)', 'cables-x-status-label.csv', 'reject'),
    ('cables_x_unknown_column', 'cables: an unknown column (media)', 'cables-x-unknown-column.csv', 'reject'),
    ('cables_x_console_to_interface', 'cables: a console port to an interface', 'cables-x-console-to-interface.csv', 'reject'),
    ('cables_x_console_wrong_type', 'cables: a console port named as dcim.interface',
     'cables-x-console-wrong-type.csv', 'reject'),
    ('cables_x_port_in_use', 'cables: a port that already has a cable', 'cables-x-port-in-use.csv', 'reject'),
]


def nb_import(c, run, sid, title, kind, text, fmt, expected, notes=None):
    path = NB_IMPORT[kind]
    s = run.step(sid, title, expected, request=request_record('POST', path, text, fmt))
    s['path_used'] = 'NetBox web UI bulk import (what a person uses)'
    s['notes'].extend(notes or [])
    try:
        g = c.page(path)
        if g.status != 200 or not c.csrf:
            s['http_status'] = g.status
            s['accepted'] = False
            s['messages'] = ['the import page did not load (HTTP %s)' % g.status] + page_errors(g.text)[:5]
            run.done(s)
            return s
        fields = {'import_method': 'direct', 'data': text, 'format': fmt}
        if fmt == 'csv':
            fields['csv_delimiter'] = ','
        r = c.form(path, fields)
        s['http_status'] = r.status
        if r.status in (301, 302, 303):
            s['location'] = r.location
            if '/login' in r.location:
                s['accepted'] = False
                s['messages'] = ['redirected to the login page']
            else:
                s['accepted'] = True
                after = c.request('GET', urllib.parse.urljoin(c.base + path, r.location), follow=True)
                s['messages'] = [m for m in page_errors(after.text) if re.search(r'(?i)import', m)][:4]
        else:
            s['accepted'] = False
            s['messages'] = page_errors(r.text)
            s['page'] = save_page('netbox-%s' % sid, r.text)
            if not s['messages']:
                s['notes'].append('no message could be read from the page; see %s' % s['page'])
    except Refused:
        raise
    except Exception as e:                              # noqa: BLE001 - every step reports
        s['accepted'] = False
        s['messages'] = ['%s: %s' % (type(e).__name__, redact(e))]
    run.done(s)
    return s


NB_LISTS = {'interfaces': 'interfaces', 'console_ports': 'console-ports', 'front_ports': 'front-ports',
            'rear_ports': 'rear-ports', 'power_ports': 'power-ports', 'module_bays': 'module-bays'}


def nb_inventory(c, run, sid, title):
    s = run.step(sid, title, 'accept', request={'method': 'GET', 'path': '/api/dcim/<components>/?device=<name>&limit=1000'})
    inv, errs = {}, []
    for d in DEVICES:
        inv[d] = {}
        for key, ep in NB_LISTS.items():
            q = urllib.parse.urlencode({'device': d, 'limit': 1000})
            items, err = c.api_list('/api/dcim/%s/?%s' % (ep, q))
            if err:
                errs.append('%s %s: %s' % (d, ep, err))
            rows = []
            for o in items:
                dev = (o.get('device') or {}).get('name')
                if dev not in (None, d):
                    continue                       # a filter this version ignores must not mix devices
                row = {'id': o.get('id'), 'name': o.get('name')}
                if key == 'module_bays':
                    row['position'] = o.get('position')
                    row['installed_module'] = (o.get('installed_module') or {}).get('id')
                if key == 'interfaces':
                    row['type'] = (o.get('type') or {}).get('value') if isinstance(o.get('type'), dict) else o.get('type')
                    row['module'] = (o.get('module') or {}).get('id') if isinstance(o.get('module'), dict) else o.get('module')
                rows.append(row)
            inv[d][key] = rows
    run.inventory[sid] = inv
    s['accepted'] = not errs
    s['messages'] = errs[:8]
    s['created'] = ['%s: %d interfaces' % (d, len(inv[d]['interfaces'])) for d in DEVICES]
    core = [i['name'] for i in inv[DEVICES[0]]['interfaces']]
    s['notes'].append('%s interfaces: %s' % (DEVICES[0], ', '.join(core[:40]) or '(none)'))
    run.done(s)
    return inv


def split_rows(text):
    rows = list(csv.reader(io.StringIO(text)))
    def one(r):
        b = io.StringIO()
        w = csv.writer(b, lineterminator='\n')
        w.writerow(rows[0])
        w.writerow(r)
        return b.getvalue()
    return rows[0], [(r, one(r)) for r in rows[1:] if r]


def moved(header, row, to='16'):
    r = list(row)
    r[header.index('position')] = to
    b = io.StringIO()
    w = csv.writer(b, lineterminator='\n')
    w.writerow(header)
    w.writerow(r)
    return b.getvalue()


def run_netbox(run):
    c = Client('netbox')
    ok, why = c.login()
    s = run.step('login', 'sign in to the web UI (session form + CSRF)', 'accept',
                 request={'method': 'POST', 'path': '/login/'})
    s['accepted'], s['messages'] = ok, [why]
    run.done(s)
    if not ok:
        return
    st = c.api('GET', '/api/status/')
    run.info['version'] = (st.json() or {}).get('netbox-version') if st.status == 200 else None
    run.info['api_auth'] = 'token' if os.environ.get('NETBOX_TOKEN') else 'session cookie'
    have, _ = c.api_list('/api/dcim/devices/?' + urllib.parse.urlencode({'name__isw': PREFIX, 'limit': 50}))
    have = [o for o in have if str(o.get('name') or '').startswith(PREFIX)]
    if have and '--continue' not in sys.argv:
        s = run.step('preflight', 'the instance already has %s devices' % PREFIX, 'accept')
        s['accepted'] = False
        s['messages'] = ['%d device(s) named %s… exist. Run "verify.py cleanup netbox" first, or pass --continue.'
                         % (len(have), PREFIX)]
        run.done(s)
        return
    for sid, title, kind, fname, exp in NB_STEPS:
        nb_import(c, run, sid, title, kind, read('netbox', 'csv', fname), 'csv', exp)
    for kind, fname, man, model in TYPE_FILES:
        nb_import(c, run, 'types_%s_%s' % (kind.replace('-', '_'), re.sub(r'\W+', '_', model)),
                  '%s YAML: %s %s (the repository file; identity lines prefixed)' % (kind[:-1], man, model),
                  kind, prefixed_yaml(read('netbox', kind, fname)), 'yaml', 'accept')
    nb_import(c, run, 'devices_as_exported', 'devices CSV as the Rack Builder writes it today (role and site blank)',
              'devices', read('netbox', 'csv', 'devices-as-exported.csv'), 'csv', 'reject')
    text = read('netbox', 'csv', 'devices.csv')
    whole = nb_import(c, run, 'devices', 'devices CSV, role and site filled in (four devices, one file)',
                      'devices', text, 'csv', 'unknown',
                      notes=['leaf-1 (front) and demarc-i3 (rear) share U14 and both types are full depth, '
                             'as in the repository fixture.'])
    if not whole['accepted']:
        header, rows = split_rows(text)
        for row, one in rows:
            name = row[0]
            r = nb_import(c, run, 'devices_row_%s' % name[len(PREFIX):], 'devices CSV, one row: %s' % name,
                          'devices', one, 'csv', 'unknown')
            if not r['accepted']:
                nb_import(c, run, 'devices_row_%s_moved' % name[len(PREFIX):],
                          'devices CSV, one row: %s moved to U16 so the later steps can run' % name,
                          'devices', moved(header, row), 'csv', 'accept')
    inv = nb_inventory(c, run, 'inventory_before_modules', 'list each device\'s components before any module')
    for sid, title, fname, exp in NB_MODULE_STEPS:
        nb_import(c, run, sid, title, 'modules', read('netbox', 'csv', fname), 'csv', exp)
    inv = nb_inventory(c, run, 'inventory_after_modules',
                       'list each device\'s components after the modules (the {module} answer)')
    for sid, title, fname, exp in NB_CABLE_STEPS:
        text, notes, _ = fill(read('netbox', 'csv', fname), inv)
        nb_import(c, run, sid, title, 'cables', text, 'csv', exp, notes=notes)
    cables, err = c.api_list('/api/dcim/cables/?' + urllib.parse.urlencode({'label__isw': PREFIX, 'limit': 200}))
    s = run.step('cables_listed', 'the cables the instance now has', 'accept',
                 request={'method': 'GET', 'path': '/api/dcim/cables/?label__isw=%s' % PREFIX})
    s['accepted'] = err is None
    s['messages'] = [err] if err else []
    for o in cables:
        if not str(o.get('label') or '').startswith(PREFIX):
            continue
        ends = []
        for side in ('a_terminations', 'b_terminations'):
            for t in o.get(side) or []:
                obj = t.get('object') or {}
                ends.append('%s %s %s' % (t.get('object_type'), (obj.get('device') or {}).get('name'), obj.get('name')))
        s['created'].append({'label': o.get('label'), 'type': o.get('type'), 'ends': ends,
                             'status': (o.get('status') or {}).get('value') if isinstance(o.get('status'), dict) else o.get('status'),
                             'length': o.get('length'), 'length_unit': o.get('length_unit'), 'color': o.get('color')})
    run.done(s)


# ── Nautobot: the REST API's text/csv, which the UI's import job also uses ──
def nt_post_json(c, run, sid, title, path, data, expected='accept'):
    s = run.step(sid, title, expected, request={'method': 'POST', 'path': path, 'format': 'json', 'body': data})
    s['path_used'] = 'REST API JSON (a prerequisite, not an import under test)'
    try:
        r = c.api('POST', path, data)
        s['http_status'] = r.status
        s['accepted'] = r.status in (200, 201)
        j = r.json()
        if s['accepted']:
            s['created'] = [str((j or {}).get('name') or (j or {}).get('model') or (j or {}).get('id'))]
            s['object_id'] = (j or {}).get('id')
        else:
            s['messages'] = [clip(json.dumps(j) if j is not None else r.text)]
    except Refused:
        raise
    except Exception as e:                              # noqa: BLE001
        s['accepted'] = False
        s['messages'] = ['%s: %s' % (type(e).__name__, redact(e))]
    run.done(s)
    return s


NT_KEEP = ('id', 'name', 'label', 'model', 'display', 'position', 'face', 'type', 'length', 'length_unit', 'color',
           'termination_a_type', 'termination_a_id', 'termination_b_type', 'termination_b_id')


def brief(o):
    out = {}
    for k in NT_KEEP:
        if isinstance(o, dict) and k in o:
            v = o[k]
            out[k] = v.get('value', v.get('name', v.get('id'))) if isinstance(v, dict) else v
    return out


def nt_csv(c, run, sid, title, path, text, expected, notes=None, missing=None):
    s = run.step(sid, title, expected, request=request_record('POST', path, text, 'csv'))
    s['path_used'] = 'REST API, Content-Type: text/csv (the parser and serializers the UI import job uses)'
    s['notes'].extend(notes or [])
    if missing:
        s['accepted'] = None
        s['messages'] = ['not sent: no id could be found for ' + '; '.join(missing)]
        run.done(s)
        return s
    try:
        r = c.api('POST', path, csv_text=text)
        s['http_status'] = r.status
        j = r.json()
        s['accepted'] = r.status in (200, 201)
        if s['accepted']:
            objs = j if isinstance(j, list) else [j]
            s['created'] = [brief(o) for o in objs if isinstance(o, dict)]
            if 'cables' in path:
                for o in s['created']:
                    if not o.get('termination_a_id') or not o.get('termination_b_id'):
                        s['notes'].append('ACCEPTED BUT NOT CONNECTED: cable %s was created with an end missing, '
                                          'so its end columns were ignored.' % o.get('label'))
        else:
            s['messages'] = [clip(json.dumps(j) if j is not None else r.text, 4000)]
    except Refused:
        raise
    except Exception as e:                              # noqa: BLE001
        s['accepted'] = False
        s['messages'] = ['%s: %s' % (type(e).__name__, redact(e))]
    run.done(s)
    return s


def nt_ui_type(c, run, sid, title, kind, text):
    path = '/dcim/%s/import/' % kind
    s = run.step(sid, title, 'accept', request=request_record('POST', path, text, 'yaml'))
    s['path_used'] = 'Nautobot web UI import (one YAML document; what a person uses)'
    try:
        g = c.page(path)
        if g.status != 200 or not c.csrf:
            s['http_status'], s['accepted'] = g.status, False
            s['messages'] = ['the import page did not load (HTTP %s)' % g.status]
            run.done(s)
            return s
        r = c.form(path, {'data': text, 'format': 'yaml'})
        s['http_status'] = r.status
        if r.status in (301, 302, 303) and '/login' not in r.location:
            s['accepted'], s['location'] = True, r.location
        else:
            s['accepted'] = False
            s['messages'] = page_errors(r.text) or ['HTTP %s, no message found' % r.status]
            s['page'] = save_page('nautobot-%s' % sid, r.text)
    except Refused:
        raise
    except Exception as e:                              # noqa: BLE001
        s['accepted'] = False
        s['messages'] = ['%s: %s' % (type(e).__name__, redact(e))]
    run.done(s)
    return s


NT_TEMPLATES = [('console-ports', 'console-port-templates'), ('interfaces', 'interface-templates'),
                ('power-ports', 'power-port-templates'), ('module-bays', 'module-bay-templates')]


def nt_rest_type(c, run, sid, title, kind, jname):
    """Without a UI sign-in: the same type built through the REST API from the
    YAML's content. NOT what a person does; it only lets the later steps run."""
    d = json.loads(read('nautobot', 'json', jname))
    body = {'manufacturer': {'name': PREFIX + d['manufacturer']}, 'model': PREFIX + d['model'],
            'comments': d.get('comments', '')}
    if kind == 'device-types':
        body.update({'u_height': int(float(d.get('u_height', 1))), 'is_full_depth': bool(d.get('is_full_depth', True)),
                     'part_number': d.get('part_number', '')})
    s = nt_post_json(c, run, sid, title + ' [REST fallback, not the UI import]', '/api/dcim/%s/' % kind, body)
    if not s['accepted']:
        return s
    parent = 'device_type' if kind == 'device-types' else 'module_type'
    for section, ep in NT_TEMPLATES:
        rows = []
        for t in d.get(section) or []:
            row = {parent: s['object_id'], 'name': t['name']}
            if section == 'module-bays':
                row['position'] = str(t.get('position', ''))
            else:
                row['type'] = t.get('type', 'other')
            if section == 'interfaces' and t.get('mgmt_only'):
                row['mgmt_only'] = True
            rows.append(row)
        if not rows:
            continue
        r = c.api('POST', '/api/dcim/%s/' % ep, rows)
        if r.status not in (200, 201):
            s['notes'].append('%s: HTTP %s %s' % (ep, r.status, clip(r.text, 600)))
            s['accepted'] = False
    return s


NT_LISTS = {'interfaces': 'interfaces', 'console_ports': 'console-ports', 'front_ports': 'front-ports',
            'rear_ports': 'rear-ports', 'power_ports': 'power-ports'}


def nt_inventory(c, run, sid, title):
    s = run.step(sid, title, 'accept', request={'method': 'GET', 'path': '/api/dcim/<components>/?device=<name>&limit=1000'})
    inv, errs, all_modules = {}, [], None
    for d in DEVICES:
        inv[d] = {}
        q = urllib.parse.urlencode({'parent_device': d, 'limit': 1000, 'depth': 0})
        bays, err = c.api_list('/api/dcim/module-bays/?' + q)
        if err:
            errs.append('%s module-bays: %s' % (d, err))
        inv[d]['module_bays'] = [{'id': b.get('id'), 'name': b.get('name'), 'position': b.get('position'),
                                  'installed_module': (b.get('installed_module') or {}).get('id')
                                  if isinstance(b.get('installed_module'), dict) else b.get('installed_module')}
                                 for b in bays]
        mods = [b['installed_module'] for b in inv[d]['module_bays'] if b.get('installed_module')]
        if all_modules is None:
            all_modules, err = c.api_list('/api/dcim/modules/?' + urllib.parse.urlencode({'limit': 1000, 'depth': 0}))
            if err:
                errs.append('modules: %s' % err)
        bay_ids = {b['id'] for b in inv[d]['module_bays']}
        for m in all_modules or []:
            pb = m.get('parent_module_bay')
            pb = pb.get('id') if isinstance(pb, dict) else pb
            if pb in bay_ids and m.get('id') not in mods:
                mods.append(m.get('id'))
                for b in inv[d]['module_bays']:
                    if b['id'] == pb:
                        b['installed_module'] = m.get('id')
        for key, ep in NT_LISTS.items():
            seen, rows = set(), []
            queries = [{'device': d}] + [{'module': m} for m in mods]
            for qd in queries:
                qd.update({'limit': 1000, 'depth': 0})
                items, err = c.api_list('/api/dcim/%s/?%s' % (ep, urllib.parse.urlencode(qd)))
                if err:
                    errs.append('%s %s %s: %s' % (d, ep, 'module' if 'module' in qd else 'device', err))
                for o in items:
                    if o.get('id') in seen:
                        continue
                    seen.add(o.get('id'))
                    mod = o.get('module')
                    rows.append({'id': o.get('id'), 'name': o.get('name'),
                                 'module': mod.get('id') if isinstance(mod, dict) else mod,
                                 'via': 'module' if 'module' in qd else 'device'})
            inv[d][key] = rows
    run.inventory[sid] = inv
    s['accepted'] = not errs
    s['messages'] = errs[:8]
    s['created'] = ['%s: %d interfaces' % (d, len(inv[d]['interfaces'])) for d in DEVICES]
    core = [i['name'] for i in inv[DEVICES[0]]['interfaces']]
    s['notes'].append('%s interfaces: %s' % (DEVICES[0], ', '.join(core[:40]) or '(none)'))
    run.done(s)
    return inv


NT_MODULE_STEPS = [
    ('modules', 'modules CSV: the line card in core-1 slot-2 (bay by device name + bay name)', 'modules.csv', 'unknown'),
    ('modules_v_position', 'modules variant: bay by device name + bay position (slot-3)', 'modules-v-position.csv', 'unknown'),
    ('modules_v_bay_id', "modules variant: bay by its id (slot-4), which a file from the Rack Builder can't know",
     'modules-v-bay-id.csv', 'accept'),
    ('modules_v_model_only', 'modules variant: module type by model alone (slot-5)', 'modules-v-model-only.csv', 'unknown'),
    ('modules_x_netbox_columns', "modules: NetBox's columns (device, module_bay, module_type, status)",
     'modules-x-netbox-columns.csv', 'reject'),
]
NT_CABLE_STEPS = [
    ('cables_x_natural_key_names', 'cables: ends by name (termination_a__device__name, termination_a__name)',
     'cables-x-natural-key-names.csv', 'reject'),
    ('cables_x_natural_key_in_id', 'cables: ends by name under termination_a_id__…', 'cables-x-natural-key-in-id.csv', 'reject'),
    ('cables_x_netbox_columns', "cables: NetBox's columns (side_a_device, …)", 'cables-x-netbox-columns.csv', 'reject'),
    ('cables_with_bad_row', 'cables CSV by id: two good rows and one whose end does not exist', 'cables.csv', 'reject'),
    ('cables_good', 'cables CSV by id: the two good rows alone (OS2 with a card port; Cat6a)', 'cables-good.csv', 'accept'),
    ('cables_v_terminations_columns', 'cables variant: terminations__a1__object_type / terminations__a1__id',
     'cables-v-terminations-columns.csv', 'unknown'),
    ('cables_v_decimal_ft', 'cables variant: length 1.5 ft (Nautobot stores a whole number)', 'cables-v-decimal-ft.csv', 'unknown'),
    ('cables_v_types', 'cables variant: dac-passive, aoc (with a color), mmf-om3, mmf-om5, cat6', 'cables-v-dac-aoc.csv', 'unknown'),
    ('cables_x_status_slug', 'cables: a status column holding "planned" instead of status__name', 'cables-x-status-slug.csv', 'reject'),
    ('cables_x_media_slug', "cables: Portrayal's own media id (os2) as the type", 'cables-x-media-slug.csv', 'reject'),
    ('cables_x_console_to_interface', 'cables: a console port to an interface', 'cables-x-console-to-interface.csv', 'reject'),
]


def nt_job_probe(c, run, inv):
    """The UI's CSV import is the "Import Objects" system job. Run it once, with
    one cable row, to see that it takes the columns the REST API took."""
    text, notes, missing = fill(read('nautobot', 'csv', 'cables-job-probe.csv'), inv)
    s = run.step('import_job_probe', 'the UI\'s "Import Objects" job, one cable row', 'unknown',
                 request=request_record('POST', '/api/extras/jobs/<Import Objects>/run/', text, 'csv'))
    s['path_used'] = 'the Import Objects system job, started through the REST API'
    s['notes'].extend(notes)
    try:
        if missing:
            s['messages'] = ['not sent: no id could be found for ' + '; '.join(missing)]
            run.done(s)
            return
        jobs, err = c.api_list('/api/extras/jobs/?' + urllib.parse.urlencode({'job_class_name': 'ImportObjects', 'limit': 10}))
        job = next((j for j in jobs if j.get('job_class_name') == 'ImportObjects'), None)
        if not job:                                # a filter this version does not have: list, and look here
            jobs, err = c.api_list('/api/extras/jobs/?limit=200')
            job = next((j for j in jobs if j.get('job_class_name') == 'ImportObjects' or j.get('name') == 'Import Objects'), None)
        cts, _ = c.api_list('/api/extras/content-types/?' + urllib.parse.urlencode({'app_label': 'dcim', 'model': 'cable'}))
        ct = next((x for x in cts if x.get('model') == 'cable' and x.get('app_label') == 'dcim'), None)
        if not job or not ct:
            s['messages'] = ['could not find the job or the content type (%s)' % (err or 'empty list')]
            run.done(s)
            return
        r = c.api('POST', '/api/extras/jobs/%s/run/' % job['id'],
                  {'data': {'content_type': ct['id'], 'csv_data': text, 'roll_back_if_error': True}})
        s['http_status'] = r.status
        j = r.json() or {}
        jr = (j.get('job_result') or {}).get('id')
        if r.status not in (200, 201, 202) or not jr:
            s['accepted'] = False
            s['messages'] = [clip(r.text)]
            run.done(s)
            return
        status = None
        for _ in range(45):
            time.sleep(2)
            g = c.api('GET', '/api/extras/job-results/%s/' % jr)
            st = (g.json() or {}).get('status')
            status = st.get('value') if isinstance(st, dict) else st
            if status and str(status).upper() in ('SUCCESS', 'FAILURE', 'REVOKED'):
                break
        logs = c.api('GET', '/api/extras/job-results/%s/logs/' % jr).json()
        logs = logs.get('results') if isinstance(logs, dict) else logs
        s['messages'] = ['job status: %s' % status] + [clip('%s: %s' % (l.get('log_level'), l.get('message')), 600)
                                                       for l in (logs or []) if isinstance(l, dict)][:12]
        s['accepted'] = str(status).upper() == 'SUCCESS'
        if status is None or str(status).upper() not in ('SUCCESS', 'FAILURE', 'REVOKED'):
            s['accepted'] = None
            s['notes'].append('the job did not finish in 90 s (is a worker running?)')
    except Refused:
        raise
    except Exception as e:                              # noqa: BLE001
        s['messages'] = ['%s: %s' % (type(e).__name__, redact(e))]
    run.done(s)


def run_nautobot(run):
    c = Client('nautobot')
    if not os.environ.get('NAUTOBOT_TOKEN'):
        s = run.step('token', 'NAUTOBOT_TOKEN is set', 'accept')
        s['accepted'], s['messages'] = False, ['NAUTOBOT_TOKEN is not set.']
        run.done(s)
        return
    st = c.api('GET', '/api/status/')
    s = run.step('api', 'reach the REST API with the token', 'accept', request={'method': 'GET', 'path': '/api/status/'})
    s['http_status'], s['accepted'] = st.status, st.status == 200
    run.info['version'] = (st.json() or {}).get('nautobot-version') if st.status == 200 else None
    if not s['accepted']:
        s['messages'] = [clip(st.text, 400)]
    run.done(s)
    if not s['accepted']:
        return
    have, _ = c.api_list('/api/dcim/devices/?' + urllib.parse.urlencode({'name__isw': PREFIX, 'limit': 50, 'depth': 0}))
    have = [o for o in have if str(o.get('name') or '').startswith(PREFIX)]
    if have and '--continue' not in sys.argv:
        s = run.step('preflight', 'the instance already has %s devices' % PREFIX, 'accept')
        s['accepted'] = False
        s['messages'] = ['%d device(s) named %s… exist. Run "verify.py cleanup nautobot" first, or pass --continue.'
                         % (len(have), PREFIX)]
        run.done(s)
        return
    ui, why = c.login()
    s = run.step('login', 'sign in to the web UI (needed only for the type YAML import)', 'accept',
                 request={'method': 'POST', 'path': '/login/'})
    s['accepted'], s['messages'] = (ui if (os.environ.get('NAUTOBOT_USER')) else None), [why]
    run.done(s)
    for man in ('Cisco', 'Edgecore', 'Telco Systems'):
        nt_post_json(c, run, 'prereq_manufacturer_%s' % re.sub(r'\W+', '_', man), 'prerequisite: manufacturer %s' % man,
                     '/api/dcim/manufacturers/', {'name': PREFIX + man})
    nt_post_json(c, run, 'prereq_role', 'prerequisite: a role for devices', '/api/extras/roles/',
                 {'name': PREFIX + 'role', 'color': '9e9e9e', 'content_types': ['dcim.device']})
    nt_post_json(c, run, 'prereq_location_type', 'prerequisite: a location type that takes devices and racks',
                 '/api/dcim/location-types/', {'name': PREFIX + 'site', 'nestable': False,
                                               'content_types': ['dcim.device', 'dcim.rack']})
    nt_post_json(c, run, 'prereq_location', 'prerequisite: a location', '/api/dcim/locations/',
                 {'name': PREFIX + 'loc', 'location_type': {'name': PREFIX + 'site'}, 'status': {'name': 'Active'}})
    nt_post_json(c, run, 'prereq_rack', 'prerequisite: a 24U rack', '/api/dcim/racks/',
                 {'name': PREFIX + 'rack', 'location': {'name': PREFIX + 'loc'}, 'status': {'name': 'Active'},
                  'u_height': 24})
    nt_csv(c, run, 'probe_rack_top_down', 'probe: a rack from CSV, numbered top down (desc_units)', '/api/dcim/racks/',
           read('nautobot', 'csv', 'probe-rack-top-down.csv'), 'unknown')
    for kind, fname, man, model in TYPE_FILES:
        sid = 'types_%s_%s' % (kind.replace('-', '_'), re.sub(r'\W+', '_', model))
        title = '%s YAML: %s %s (the repository file; identity lines prefixed)' % (kind[:-1], man, model)
        if ui:
            r = nt_ui_type(c, run, sid, title, kind, prefixed_yaml(read('nautobot', kind, fname)))
            if r['accepted']:
                continue
            sid += '_rest'
        nt_rest_type(c, run, sid, '%s %s %s' % (kind[:-1], man, model), kind,
                     '%s--%s.json' % (kind, fname[:-5]))
    nt_csv(c, run, 'devices_as_exported', 'devices CSV as the Rack Builder writes it today (role and location blank)',
           '/api/dcim/devices/', read('nautobot', 'csv', 'devices-as-exported.csv'), 'reject')
    text = read('nautobot', 'csv', 'devices.csv')
    whole = nt_csv(c, run, 'devices', 'devices CSV, role and location filled in (four devices, one file)',
                   '/api/dcim/devices/', text, 'unknown',
                   notes=['leaf-1 (front) and demarc-i3 (rear) share U14 and both types are full depth, '
                          'as in the repository fixture.'])
    if not whole['accepted']:
        header, rows = split_rows(text)
        for row, one in rows:
            name = row[0]
            r = nt_csv(c, run, 'devices_row_%s' % name[len(PREFIX):], 'devices CSV, one row: %s' % name,
                       '/api/dcim/devices/', one, 'unknown')
            if not r['accepted']:
                nt_csv(c, run, 'devices_row_%s_moved' % name[len(PREFIX):],
                       'devices CSV, one row: %s moved to U16 so the later steps can run' % name,
                       '/api/dcim/devices/', moved(header, row), 'accept')
    inv = nt_inventory(c, run, 'inventory_before_modules', 'list each device\'s components before any module')
    for sid, title, fname, exp in NT_MODULE_STEPS:
        text, notes, missing = fill(read('nautobot', 'csv', fname), inv)
        nt_csv(c, run, sid, title, '/api/dcim/modules/', text, exp, notes, missing)
    inv = nt_inventory(c, run, 'inventory_after_modules',
                       'list each device\'s components after the modules (the {module} answer)')
    for sid, title, fname, exp in NT_CABLE_STEPS:
        text, notes, missing = fill(read('nautobot', 'csv', fname), inv)
        nt_csv(c, run, sid, title, '/api/dcim/cables/', text, exp, notes, missing)
    nt_job_probe(c, run, inv)
    cables, err = c.api_list('/api/dcim/cables/?' + urllib.parse.urlencode({'label__isw': PREFIX, 'limit': 200, 'depth': 1}))
    s = run.step('cables_listed', 'the cables the instance now has', 'accept',
                 request={'method': 'GET', 'path': '/api/dcim/cables/?label__isw=%s&depth=1' % PREFIX})
    s['accepted'] = err is None
    s['messages'] = [err] if err else []
    for o in cables:
        if not str(o.get('label') or '').startswith(PREFIX):
            continue
        row = brief(o)
        for side in ('termination_a', 'termination_b'):
            t = o.get(side) or {}
            dev = t.get('device') if isinstance(t, dict) else None
            row[side] = '%s %s' % ((dev or {}).get('name') if isinstance(dev, dict) else dev, t.get('name')) if t else None
        s['created'].append(row)
    run.done(s)


# ── cleanup ────────────────────────────────────────────────────────────────
# (endpoint, the field that must start with PREFIX), in an order that leaves nothing behind.
CLEAN = {
    'netbox': [('/api/dcim/cables/', 'label'), ('/api/dcim/devices/', 'name'), ('/api/dcim/racks/', 'name'),
               ('/api/dcim/device-types/', 'model'), ('/api/dcim/module-types/', 'model'),
               ('/api/dcim/manufacturers/', 'name'), ('/api/dcim/device-roles/', 'name'), ('/api/dcim/sites/', 'name')],
    'nautobot': [('/api/dcim/cables/', 'label'), ('/api/dcim/devices/', 'name'), ('/api/dcim/racks/', 'name'),
                 ('/api/dcim/device-types/', 'model'), ('/api/dcim/module-types/', 'model'),
                 ('/api/dcim/manufacturers/', 'name'), ('/api/extras/roles/', 'name'),
                 ('/api/dcim/locations/', 'name'), ('/api/dcim/location-types/', 'name')],
}


def cleanup(target, dry):
    c = Client(target)
    if target == 'netbox' and not os.environ.get('NETBOX_TOKEN'):
        ok, why = c.login()
        if not ok:
            say('  [netbox] cannot sign in:', why)
            return 1
        c.page('/dcim/sites/import/')              # a page with a CSRF token for the session's DELETEs
    if target == 'nautobot' and not os.environ.get('NAUTOBOT_TOKEN'):
        say('  [nautobot] NAUTOBOT_TOKEN is not set.')
        return 1
    failed = 0
    for ep, field in CLEAN[target]:
        q = {field + '__isw': PREFIX, 'limit': 200}
        if target == 'nautobot':
            q['depth'] = 0
        items, err = c.api_list(ep + '?' + urllib.parse.urlencode(q))
        if err:                                    # a filter this version does not have: list, and filter here
            q.pop(field + '__isw')
            items, err = c.api_list(ep + '?' + urllib.parse.urlencode(q))
        if err:
            say('  [%s] %s: could not list (%s)' % (target, ep, err))
            failed += 1
            continue
        mine = [o for o in items if str(o.get(field) or '').startswith(PREFIX)]   # checked here, whatever the filter did
        for o in mine:
            if dry:
                say('  [%s] would delete %s %s' % (target, ep, o.get(field)))
                continue
            r = c.api('DELETE', '%s%s/' % (ep, o['id']))
            okd = r.status in (200, 204)
            failed += 0 if okd else 1
            say('  [%s] %s %s %s' % (target, 'deleted' if okd else 'COULD NOT DELETE (HTTP %s: %s)' % (r.status, clip(r.text, 300)),
                                     ep, o.get(field)))
        if not mine:
            say('  [%s] %s: nothing named %s…' % (target, ep, PREFIX))
    return 1 if failed else 0


# ── plan (offline) ─────────────────────────────────────────────────────────
def plan(target):
    host = urllib.parse.urlsplit(os.environ.get(ENV[target][0], '')).netloc or '<%s not set>' % ENV[target][0]
    say('\n== %s, at %s ==' % (target, host))
    say('   credentials: ' + ', '.join('%s %s' % (n, 'set' if os.environ.get(n) else 'not set') for n in ENV[target][1:]))
    say('   every object is named %s…; nothing else is created, changed or deleted.' % PREFIX)

    def show(method, path, title, text=None, fmt=None, exp=''):
        say('   %-5s %-34s %s%s' % (method, path, title, '  [expect: %s]' % exp if exp else ''))
        if text is not None and fmt == 'csv':
            say('         columns: ' + ','.join(header_row(text)) + '   (%d row%s)' % (row_count(text), '' if row_count(text) == 1 else 's'))
        elif text is not None:
            say('         YAML, %d bytes, begins: %s' % (len(text.encode()), ' | '.join(text.split('\n')[1:4])))

    if target == 'netbox':
        show('POST', '/login/', 'sign in with NETBOX_USER / NETBOX_PASSWORD (session + CSRF)')
        for sid, title, kind, fname, exp in NB_STEPS:
            show('POST', NB_IMPORT[kind], title, read('netbox', 'csv', fname), 'csv', exp)
        for kind, fname, man, model in TYPE_FILES:
            show('POST', NB_IMPORT[kind], '%s %s' % (man, model), prefixed_yaml(read('netbox', kind, fname)), 'yaml', 'accept')
        show('POST', NB_IMPORT['devices'], 'devices as exported today', read('netbox', 'csv', 'devices-as-exported.csv'), 'csv', 'reject')
        show('POST', NB_IMPORT['devices'], 'devices, role and site filled', read('netbox', 'csv', 'devices.csv'), 'csv', 'unknown')
        say('         (if the file is refused: one row at a time, and a refused row again at U16)')
        show('GET', '/api/dcim/interfaces/?device=…', 'list interfaces, ports and module bays of each device')
        for sid, title, fname, exp in NB_MODULE_STEPS:
            show('POST', NB_IMPORT['modules'], title, read('netbox', 'csv', fname), 'csv', exp)
        show('GET', '/api/dcim/interfaces/?device=…', 'list again: the names the card\'s {module} ports got')
        for sid, title, fname, exp in NB_CABLE_STEPS:
            show('POST', NB_IMPORT['cables'], title, read('netbox', 'csv', fname), 'csv', exp)
        show('GET', '/api/dcim/cables/?label__isw=' + PREFIX, 'list the cables made')
    else:
        show('GET', '/api/status/', 'reach the API with NAUTOBOT_TOKEN')
        show('POST', '/login/', 'sign in with NAUTOBOT_USER / NAUTOBOT_PASSWORD, if set (type YAML import only)')
        for p, t in (('/api/dcim/manufacturers/', 'three manufacturers'), ('/api/extras/roles/', 'a role'),
                     ('/api/dcim/location-types/', 'a location type'), ('/api/dcim/locations/', 'a location'),
                     ('/api/dcim/racks/', 'a 24U rack')):
            show('POST', p, 'prerequisite (JSON): ' + t)
        show('POST', '/api/dcim/racks/', 'probe: a top-down rack from CSV', read('nautobot', 'csv', 'probe-rack-top-down.csv'), 'csv', 'unknown')
        for kind, fname, man, model in TYPE_FILES:
            show('POST', '/dcim/%s/import/' % kind, '%s %s (UI; REST fallback without a sign-in)' % (man, model),
                 prefixed_yaml(read('nautobot', kind, fname)), 'yaml', 'accept')
        show('POST', '/api/dcim/devices/', 'devices as exported today', read('nautobot', 'csv', 'devices-as-exported.csv'), 'csv', 'reject')
        show('POST', '/api/dcim/devices/', 'devices, role and location filled', read('nautobot', 'csv', 'devices.csv'), 'csv', 'unknown')
        say('         (if the file is refused: one row at a time, and a refused row again at U16)')
        show('GET', '/api/dcim/interfaces/?device=…', 'list interfaces, ports and module bays of each device')
        for sid, title, fname, exp in NT_MODULE_STEPS:
            show('POST', '/api/dcim/modules/', title, read('nautobot', 'csv', fname), 'csv', exp)
        show('GET', '/api/dcim/interfaces/?device=…', 'list again: the names the card\'s {module} ports got')
        for sid, title, fname, exp in NT_CABLE_STEPS:
            show('POST', '/api/dcim/cables/', title, read('nautobot', 'csv', fname), 'csv', exp)
        show('POST', '/api/extras/jobs/<id>/run/', 'the UI\'s Import Objects job, one cable row',
             read('nautobot', 'csv', 'cables-job-probe.csv'), 'csv', 'unknown')
        show('GET', '/api/dcim/cables/?label__isw=' + PREFIX, 'list the cables made')
    say('   objects: site/location %ssite|loc, rack %srack (+ %srack-topdown), role %srole,' % ((PREFIX,) * 4))
    say('            manufacturers %sCisco, %sEdgecore, %sTelco Systems, their four types,' % ((PREFIX,) * 3))
    say('            devices %s; modules in core-1; cables labelled %s…' % (', '.join(DEVICES), PREFIX))
    say('   @card(slot-2/p0) in a cable file is the card port\'s real name, read from the instance;')
    say('   @id(…) is an object id read from the instance (Nautobot).')


# ── main ───────────────────────────────────────────────────────────────────
def targets(argv):
    t = [a for a in argv if a in ('netbox', 'nautobot', 'all')]
    return ['netbox', 'nautobot'] if not t or 'all' in t else t


def write_result(runs, started):
    out = {'kit': 'portrayal dcim-verify 1', 'prefix': PREFIX, 'started': started,
           'finished': datetime.datetime.now().isoformat(timespec='seconds'), 'targets': {}}
    for r in runs:
        out['targets'][r.target] = {
            'host': urllib.parse.urlsplit(os.environ.get(ENV[r.target][0], '')).netloc, 'info': r.info,
            'steps': r.steps, 'inventory': r.inventory}
    def clean(v):                                   # values only: a key is never instance text
        if isinstance(v, str):
            return redact(v)
        if isinstance(v, list):
            return [clean(x) for x in v]
        if isinstance(v, dict):
            return {k: clean(x) for k, x in v.items()}
        return v

    with open(RESULT, 'w', encoding='utf-8') as f:
        f.write(json.dumps(clean(out), indent=1, ensure_ascii=False) + '\n')


def main(argv):
    cmd = argv[1] if len(argv) > 1 else ''
    if cmd == 'plan':
        for t in targets(argv[2:]):
            plan(t)
        say('\nNothing was sent. "verify.py run" does this; "verify.py cleanup" removes it.')
        return 0
    if cmd == 'cleanup':
        rc = 0
        for t in targets(argv[2:]):
            say('== cleanup %s ==' % t)
            try:
                rc |= cleanup(t, '--dry-run' in argv)
            except Refused as e:
                say('  [%s] %s' % (t, e))
                rc = 1
            except Exception as e:                      # noqa: BLE001
                say('  [%s] %s: %s' % (t, type(e).__name__, e))
                rc = 1
        return rc
    if cmd == 'run':
        started = datetime.datetime.now().isoformat(timespec='seconds')
        runs = []
        for t in targets(argv[2:]):
            say('== %s ==' % t)
            run = Run(t)
            runs.append(run)
            try:
                (run_netbox if t == 'netbox' else run_nautobot)(run)
            except Refused as e:
                s = run.step('refused', 'the run was refused', 'accept')
                s['accepted'], s['messages'] = False, [str(e)]
                run.done(s)
            except Exception as e:                      # noqa: BLE001
                s = run.step('crashed', 'the run stopped', 'accept')
                s['accepted'], s['messages'] = False, ['%s: %s' % (type(e).__name__, redact(e))]
                run.done(s)
            write_result(runs, started)
        say('\nWrote %s' % RESULT)
        for run in runs:
            odd = [s for s in run.steps if s['accepted'] is not None and s['expected'] in ('accept', 'reject')
                   and (s['expected'] == 'accept') != s['accepted']]
            say('%s: %d steps, %d accepted, %d rejected, %d not run; %d went against expectation'
                % (run.target, len(run.steps), sum(1 for s in run.steps if s['accepted'] is True),
                   sum(1 for s in run.steps if s['accepted'] is False),
                   sum(1 for s in run.steps if s['accepted'] is None), len(odd)))
        return 0
    say(__doc__)
    return 2


if __name__ == '__main__':
    sys.exit(main(sys.argv))
