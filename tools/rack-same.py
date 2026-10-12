#!/usr/bin/env python3
"""Does this checkout's Rack Builder show, say and download exactly what another checkout's does?

For a change that must change nothing (a speed change: portrayal-site#192).
Not a check: it needs a second checkout to compare with, and CI has none.

    git worktree add /somewhere/main origin/main        # or: git archive origin/main | tar -x -C /somewhere/main
    python3 tools/rack-same.py --main /somewhere/main path/to/a.rack.json [...]
        [--fixtures] [--edits 15] [--tools few|all] [--glb] [--gpu] [--settle 600]

It serves both checkouts, opens each rack file in both through Open .json
(headless Chromium, ?probe=1), and compares, after the file opens and after
each of a list of edits made the same way in both:

  - both panes' drawings, whole (so every cable's drawn path), in Front / Rear
    and, after the open and after the last edit, in Left / Right;
  - the side panel's words: the cable list's rows, every route warning (a
    folded kind is opened first) and the notices raised;
  - what the page read: routes, paths (the kit's points), fill, rings, bodies,
    bends, bundles, tie straps, the cables' facts, and the rack document;
  - each assistant tool's text;
  - what each edit answered (its summary, or its refusal).

and, after the open and after the last edit, every download: the rack file,
the sheet (.svg), front and rear sheets, draw.io, the bill of materials, the
cable schedule, and both DCIM kits entry by entry. With --glb the 3D scene is
built in both and the GLB and USDZ are compared: byte for byte, and where the
bytes differ, by content (every node's name, transform and mesh data, in any
order), saying which.

The edits are chosen from the rack as the other checkout has it: a cable's end
moved, its media and its label changed, a cable removed and added back, a
device moved and renamed, undo, redo, the frame grown, the DCIM settings (not a
step), a route edited by hand and reset, a bundle made, the rack renamed.

Prints one line per comparison that differs, and `same: N comparisons` or
`DIFFERENT: N of M` at the end; exits 1 on any difference.
"""
import argparse
import contextlib
import hashlib
import importlib.util
import io
import json
import pathlib
import socket
import struct
import subprocess
import sys
import time
import urllib.request
import zipfile

HERE = pathlib.Path(__file__).resolve().parent.parent

STAND_IN_MODEL_CONTEXT = """
window.__tools = {};
const mc = {registerTool(t, o) {
  window.__tools[t.name] = t;
  o?.signal?.addEventListener('abort', () => delete window.__tools[t.name]);
  return Promise.resolve();
}};
Object.defineProperty(Document.prototype, 'modelContext', {get: () => mc, configurable: true});
"""

# Every notice the side panel shows is kept as it appears: a notice is shown by one redraw and gone at the next.
WATCH_NOTICES = """() => {
  window.__notices = [];
  const seen = () => { for (const p of document.querySelectorAll('#side .rk-notice:not([data-kept])')) {
    const t = p.textContent; if (window.__notices.at(-1) !== t && !window.__notices.includes(t)) window.__notices.push(t); } };
  new MutationObserver(seen).observe(document.getElementById('side'), {childList: true, subtree: true});
  seen();
}"""

# The page has drawn the rack as it is: a redraw has replaced the panes since `was` (when one is due), the routes it
# holds are this rack's, the panes are not marked busy, and nothing has moved for a while. Written against the
# probe hooks every checkout has, so it runs on one from before this script.
SETTLE_JS = """async ([due, ms, quiet]) => {
  const sleep = t => new Promise(r => setTimeout(r, t));
  const end = Date.now() + ms, was = window.__paneWas ?? null;
  const front = () => document.querySelector('#paneFront > svg');
  const ok = () => { const r = window.__rack, rack = r.doc().racks[0];
    return (!due || front() !== was) && (!(rack.cables || []).length || r.routesCurrent().current || r.routes() === null)
      && !document.getElementById('panes').hasAttribute('aria-busy'); };
  let since = null, node = front(), doc = window.__rack.doc();
  while (Date.now() < end) {
    if (ok() && front() === node && window.__rack.doc() === doc) { since ??= Date.now(); if (Date.now() - since >= quiet) return true; }
    else { since = null; node = front(); doc = window.__rack.doc(); }
    await sleep(50);
  }
  return false;
}"""
MARK_JS = "() => { window.__paneWas = document.querySelector('#paneFront > svg'); }"

SNAP_JS = """async () => {
  const sleep = t => new Promise(r => setTimeout(r, t));
  const R = window.__rack;
  // a folded kind of warning is opened, so every sentence is in the panel to read
  for (const d of document.querySelectorAll('#side details[data-route-more]:not([open])')) d.querySelector('summary').click();
  await sleep(30);
  const side = document.getElementById('side').cloneNode(true);
  for (const n of side.querySelectorAll('details[data-route-more] > summary, .rk-notice:not([data-kept])')) n.remove();
  const plain = v => JSON.parse(JSON.stringify(v ?? null));
  const pane = id => { const svg = document.querySelector(`#${id} > svg`); if (!svg) return null;
    const c = svg.cloneNode(true); c.removeAttribute('style');
    for (const n of c.querySelectorAll('.rk-agent-touched')) { n.classList.remove('rk-agent-touched'); if (!n.getAttribute('class')) n.removeAttribute('class'); }
    return c.outerHTML; };
  const doc = plain(R.doc());
  return {
    panes: {front: pane('paneFront'), rear: pane('paneRear')},
    headings: [document.getElementById('headFront').textContent, document.getElementById('headRear').textContent],
    rows: [...document.querySelectorAll('#side [data-cable-item]')].map(li => li.textContent),
    warnings: [...document.querySelectorAll('#side [data-route-warning]')].map(p => p.textContent),
    side: side.textContent,
    notices: [...(window.__notices ?? [])],
    routes: plain(R.routes()), paths: plain(R.paths()), fill: plain(R.fill()), rings: plain(R.rings()), bodies: plain(R.bodies()),
    bends: plain(R.bends()), bundles: plain(R.bundles()), anchors: plain(R.anchors?.()), tieStraps: plain(R.tieStraps?.()),
    facts: plain(R.cableFacts()), history: plain(R.history()),
    doc: {...doc, id: null},
  };
}"""

TOOL_JS = """async ([n, a]) => {
  const res = await window.__tools[n].execute(a);
  return {isError: !!res?.isError, text: (res?.content ?? []).map(c => c.text).join('\\n')};
}"""

# The edits, each worked out from the rack as it is in the first page and then made, word for word, in both.
# Each answers {cmd} (a command for window.__rack.apply), {call: 'undo'|'redo'}, {bundle: cmd}, or {skip: why}.
EDITS = [
    ("a cable's end moved", True, """async () => {
      const R = window.__rack, r = R.doc().racks[0];
      for (const c of r.cables) {
        const free = await R.query.freePorts(c.a.item);
        if (!Array.isArray(free)) continue;
        const p = free.find(p => p.view === c.a.view && !/occupant/.test(p.path));
        if (p) return {cmd: {op: 'cable.update', id: c.id, a: {item: c.a.item, path: p.path, view: p.view}}};
      }
      return {skip: 'no free port beside a cabled one'};
    }"""),
    ("a cable's media changed", True, """() => { const c = window.__rack.doc().racks[0].cables[0];
      return c ? {cmd: {op: 'cable.update', id: c.id, media: c.media === 'om4' ? 'os2' : 'om4'}} : {skip: 'no cable'}; }"""),
    ("a cable's label changed", True, """() => { const c = window.__rack.doc().racks[0].cables.at(-1);
      return c ? {cmd: {op: 'cable.update', id: c.id, label: 'same-check'}} : {skip: 'no cable'}; }"""),
    ("a cable removed", True, """() => { const c = window.__rack.doc().racks[0].cables.at(-1);
      if (!c) return {skip: 'no cable'};
      window.__removed = {a: c.a, b: c.b, media: c.media};
      return {cmd: {op: 'cable.remove', id: c.id}}; }"""),
    ("the cable added back", True, """() => (window.__removed ? {cmd: {op: 'cable.add', ...window.__removed}} : {skip: 'no cable was removed'})"""),
    ("a device moved", True, """() => {
      const R = window.__rack, r = R.doc().racks[0];
      const cabled = new Set(r.cables.flatMap(c => [c.a.item, c.b.item]));
      const its = r.items.filter(i => !i.on), order = [...its.filter(i => cabled.has(i.id)), ...its.filter(i => !cabled.has(i.id))];
      for (const it of order) for (let ru = r.frame.heightRU; ru >= 1; ru--) {
        if (ru === it.ru) continue;
        const f = R.query.fitsAt({ref: it.ref, face: it.face, ru});
        if (f.ok) return {cmd: {op: 'move', id: it.id, ru}};
      }
      return {skip: 'no free unit'};
    }"""),
    ("a device renamed", True, """() => { const it = window.__rack.doc().racks[0].items[0];
      return it ? {cmd: {op: 'patch', id: it.id, label: `${it.label} (same)`}} : {skip: 'no device'}; }"""),
    ("undo", True, "() => ({call: 'undo'})"),
    ("redo", True, "() => ({call: 'redo'})"),
    ("the frame grown", True, """() => ({cmd: {op: 'frame', heightRU: window.__rack.doc().racks[0].frame.heightRU + 2}})"""),
    ("the DCIM settings", False, """() => ({cmd: {op: 'dcim', site: 'Same Site', role: 'same-role'}})"""),
    ("a route edited by hand", True, """() => {
      const R = window.__rack, r = R.doc().racks[0], routes = new Map(R.routes() ?? []);
      const c = r.cables.find(c => (routes.get(c.id) ?? []).length >= 2) ?? r.cables.find(c => (routes.get(c.id) ?? []).length);
      if (!c) return {skip: 'no cable has a waypoint'};
      window.__routed = c.id;
      return {cmd: {op: 'cable.route', id: c.id, route: routes.get(c.id).slice(0, -1), summary: 'Waypoint removed.'}};
    }"""),
    ("the route reset", True, """() => (window.__routed ? {cmd: {op: 'cable.route.reset', id: window.__routed, summary: 'Route reset to automatic.'}} : {skip: 'no route was edited'})"""),
    ("a bundle made", True, """() => {
      const r = window.__rack.doc().racks[0], taken = new Set((r.bundles ?? []).flatMap(b => b.members.map(m => m.cable)));
      const by = new Map();
      for (const c of r.cables) if (!taken.has(c.id)) { const k = [c.a.item, c.b.item].sort().join('|'); by.set(k, [...(by.get(k) ?? []), c.id]); }
      const pair = [...by.values()].find(ids => ids.length >= 2);
      return pair ? {bundle: {op: 'bundle.create', cables: pair.slice(0, 3), label: 'same'}} : {skip: 'no two free cables share their devices'};
    }"""),
    ("the rack renamed", True, """() => ({cmd: {op: 'rename', name: `${window.__rack.doc().racks[0].name} same`}})"""),
]

DO_JS = """async e => {
  const R = window.__rack;
  if (e.call === 'undo') { R.undo(); return {call: 'undo', history: R.history()}; }
  if (e.call === 'redo') { R.redo(); return {call: 'redo', history: R.history()}; }
  if (e.bundle) return await R.bundleCommand(e.bundle);
  const res = R.apply(e.cmd);
  return {error: res.error ?? null, noop: !!res.noop, summary: res.summary ?? null, created: res.created ?? null,
          findings: (res.findings ?? []).map(f => f.text)};
}"""

EXPORTS = ["json", "sheet-svg", "front-svg", "rear-svg", "drawio", "bom", "cables", "netbox-import", "nautobot-import"]

SCENE_SETTLED_JS = """async ({ms}) => {
  const sleep = t => new Promise(r => setTimeout(r, t));
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const s = window.__rack.scene();
    if (!s) { await sleep(200); continue; }
    const done = await Promise.race([Promise.resolve(s.complete?.()).then(() => true), sleep(Math.max(0, deadline - Date.now())).then(() => false)]);
    if (!done) break;
    await sleep(800);
    if (window.__rack.scene() !== s) continue;
    return true;
  }
  return false; }"""


def free_port():
    with contextlib.closing(socket.socket()) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def wait_for(url, timeout=30):
    end = time.time() + timeout
    while time.time() < end:
        try:
            with urllib.request.urlopen(url) as r:
                if r.status == 200:
                    return True
        except OSError:
            time.sleep(0.2)
    return False


def tool_calls(doc, how):
    rack = doc["racks"][0]
    cables = rack.get("cables") or []
    items = rack.get("items") or []
    calls = [("describe_rack", {})]
    if cables:
        calls.append(("inspect", {"id": cables[0]["id"]}))
    if how == "few":
        return calls
    calls += [("describe_rack", {"section": "cables", "offset": 0, "limit": 50}), ("describe_rack", {"section": "items"}),
              ("describe_rack", {"section": "bundles"}), ("describe_rack", {"limit": 5})]
    if len(cables) > 60:
        calls.append(("describe_rack", {"section": "cables", "offset": 50, "limit": 50}))
    pick = [cables[k]["id"] for k in sorted({0, len(cables) // 3, len(cables) // 2, len(cables) - 1}) if cables][1:]
    calls += [("inspect", {"id": i}) for i in pick]
    calls += [("inspect", {"id": b["id"]}) for b in (rack.get("bundles") or [])[:2]]
    calls += [("inspect", {"id": z["id"]}) for z in (rack.get("zeroU") or [])[:1]]
    for it in items[:2]:
        calls += [("inspect", {"id": it["id"]}), ("list_free_ports", {"id": it["id"]}), ("check_fit", {"ref": it["ref"], "face": "front"})]
    if cables:
        calls.append(("edit_rack", {"dry_run": True, "commands": [{"op": "cable.update", "id": cables[0]["id"], "label": "dry"}]}))
        calls.append(("edit_rack", {"dry_run": True, "commands": [{"op": "cable.remove", "select": {"loose": True}}]}))
    if len(cables) >= 2:
        calls.append(("edit_rack", {"dry_run": True, "commands": [{"op": "bundle.create", "cables": [cables[0]["id"], cables[1]["id"]]}]}))
    return calls


def glb_content(data):
    """A GLB as what it holds, in no order: each node's name, world-free transform and its mesh's data."""
    magic, _version, _length = struct.unpack_from("<4sII", data, 0)
    if magic != b"glTF":
        return None
    off, js, binary = 12, None, b""
    while off < len(data):
        n, kind = struct.unpack_from("<II", data, off)
        body = data[off + 8: off + 8 + n]
        if kind == 0x4E4F534A:
            js = json.loads(body)
        elif kind == 0x004E4942:
            binary = body
        off += 8 + n
    views, accs = js.get("bufferViews", []), js.get("accessors", [])

    def acc(i):
        if i is None:
            return None
        a = accs[i]
        v = views[a["bufferView"]] if "bufferView" in a else None
        raw = binary[v.get("byteOffset", 0) + a.get("byteOffset", 0): v.get("byteOffset", 0) + v["byteLength"]] if v else b""
        return [a["componentType"], a["type"], a["count"], hashlib.sha1(raw).hexdigest()]

    def image(i):
        im = js["images"][i]
        if "bufferView" in im:
            v = views[im["bufferView"]]
            return hashlib.sha1(binary[v.get("byteOffset", 0): v.get("byteOffset", 0) + v["byteLength"]]).hexdigest()
        return hashlib.sha1(im.get("uri", "").encode()).hexdigest()

    def material(i):
        if i is None:
            return None
        m = json.loads(json.dumps(js["materials"][i]))

        def tex(o):
            if isinstance(o, dict):
                if "index" in o and isinstance(o["index"], int) and "textures" in js and set(o) <= {"index", "texCoord", "scale", "strength", "extensions"}:
                    t = js["textures"][o["index"]]
                    o["index"] = [image(t["source"]) if "source" in t else None, js.get("samplers", [None])[t["sampler"]] if "sampler" in t else None]
                for v in o.values():
                    tex(v)
            elif isinstance(o, list):
                for v in o:
                    tex(v)
        tex(m)
        return m

    def mesh(i):
        if i is None:
            return None
        m = js["meshes"][i]
        return [m.get("name"), [[{k: acc(v) for k, v in sorted(p.get("attributes", {}).items())}, acc(p.get("indices")), material(p.get("material")), p.get("mode")]
                                for p in m["primitives"]]]

    def node(i):
        n = js["nodes"][i]
        own = [n.get("name"), n.get("translation"), n.get("rotation"), n.get("scale"), n.get("matrix"), mesh(n.get("mesh")), n.get("extras")]
        kids = sorted(json.dumps(node(c), sort_keys=True) for c in n.get("children", []))
        return [own, kids]
    roots = sorted(json.dumps(node(i), sort_keys=True) for s in js.get("scenes", []) for i in s.get("nodes", []))
    return {"asset": js.get("asset"), "extensionsUsed": sorted(js.get("extensionsUsed", [])), "roots": roots}


class Side:
    def __init__(self, browser, base, name):
        self.name, self.base = name, base
        self.context = browser.new_context(viewport={"width": 1600, "height": 1000}, accept_downloads=True)
        self.page = self.context.new_page()
        # a click is answered when the page next has a moment, and a large rack's export keeps it busy for a minute
        self.page.set_default_timeout(15 * 60 * 1000)
        self.errors = []
        self.page.on("pageerror", lambda e: self.errors.append(str(e)))
        self.page.add_init_script(STAND_IN_MODEL_CONTEXT)

    def open(self, doc, ms):
        page = self.page
        page.goto(f"{self.base}/rack.html?probe=1", wait_until="load")
        page.wait_for_function("() => window.__rack && window.__rack.ready", timeout=120000)
        page.evaluate("() => window.__rack.ready")
        for sel in ('#mode [data-mode="2d"]', '#view2d [data-view="faces"]'):
            page.click(sel)
        self.settle(False, ms)
        page.evaluate(WATCH_NOTICES)
        page.evaluate(MARK_JS)
        was = page.evaluate("() => window.__rack.doc().id")
        page.set_input_files("#openFile", files=[{"name": "same.rack.json", "mimeType": "application/json", "buffer": json.dumps(doc).encode()}])
        page.wait_for_function("was => window.__rack.doc().id !== was", arg=was, timeout=ms)
        return self.settle(True, ms)

    def settle(self, due, ms, quiet=700):
        return self.page.evaluate(SETTLE_JS, [due, ms, quiet])

    def export(self, kind, ms):
        page = self.page
        page.click("#exportMenu > summary")
        with page.expect_download(timeout=ms) as dl:
            page.click(f'#exportItems [data-export="{kind}"]')
        d = dl.value
        return d.suggested_filename, pathlib.Path(d.path()).read_bytes()

    def close(self):
        self.context.close()


def as_entries(name, data):
    if name.endswith((".zip", ".usdz")):
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            return {n: z.read(n) for n in z.namelist()}, z.namelist()
    return None, None


class Tally:
    def __init__(self):
        self.n, self.bad, self.notes = 0, [], []

    def same(self, where, a, b, show=True):
        self.n += 1
        if a == b:
            return True
        detail = ""
        if show:
            sa, sb = (a if isinstance(a, str) else json.dumps(a, sort_keys=True)), (b if isinstance(b, str) else json.dumps(b, sort_keys=True))
            k = next((i for i in range(min(len(sa), len(sb))) if sa[i] != sb[i]), min(len(sa), len(sb)))
            detail = f"\n      main: ...{sa[max(0, k - 80): k + 120]!r}\n      here: ...{sb[max(0, k - 80): k + 120]!r}"
        self.bad.append(where)
        print(f"  DIFFERENT  {where}{detail}", flush=True)
        return False


def compare_snaps(t, where, a, b):
    for k in a:
        if k == "panes":
            for p in ("front", "rear"):
                t.same(f"{where}: the {a['headings'][0 if p == 'front' else 1]} pane's drawing", a[k][p], b[k][p])
        else:
            t.same(f"{where}: {k}", a[k], b[k])


def compare_exports(t, where, A, B, ms, kinds=EXPORTS):
    for kind in kinds:
        try:
            (na, da), (nb, db) = A.export(kind, ms), B.export(kind, ms)
        except Exception as e:
            t.same(f"{where}: the {kind} download (failed: {str(e).splitlines()[0]})", 0, 1, show=False)
            continue
        t.same(f"{where}: the {kind} download's name", na, nb)
        ea, order_a = as_entries(na, da)
        if ea is None:
            if kind == "json":
                ja, jb = json.loads(da), json.loads(db)
                ja["id"] = jb["id"] = None           # an opened file is given a fresh id in each browser
                t.same(f"{where}: the {kind} download ({len(da)} bytes)", ja, jb)
            else:
                t.same(f"{where}: the {kind} download ({len(da)} bytes)", da.decode("utf-8", "replace"), db.decode("utf-8", "replace"))
            continue
        eb, order_b = as_entries(nb, db)
        t.same(f"{where}: the {kind} download's entries", order_a, order_b)
        for n in order_a:
            t.same(f"{where}: {kind} / {n}", ea[n].decode("utf-8", "replace"), eb.get(n, b"").decode("utf-8", "replace"))


def compare_models(t, where, A, B, settle):
    for S in (A, B):
        S.page.click('#mode [data-mode="3d"]')
    ok = [S.page.evaluate(SCENE_SETTLED_JS, {"ms": settle * 1000}) for S in (A, B)]
    if not all(ok):
        t.notes.append(f"{where}: the 3D scene did not settle in {settle} s ({'main' if not ok[0] else ''}{' and ' if not any(ok) else ''}{'here' if not ok[1] else ''}), so the GLB and USDZ were not compared")
        print(f"  NOT COMPARED  {t.notes[-1]}", flush=True)
    else:
        for kind in ("glb", "usdz"):
            try:
                (na, da), (nb, db) = A.export(kind, settle * 1000), B.export(kind, settle * 1000)
            except Exception as e:
                t.same(f"{where}: the {kind} download (failed: {str(e).splitlines()[0]})", 0, 1, show=False)
                continue
            t.same(f"{where}: the {kind} download's name", na, nb)
            if da == db:
                t.same(f"{where}: the {kind} download, byte for byte ({len(da)} bytes)", 1, 1)
            elif kind == "glb":
                t.notes.append(f"{where}: the GLBs differ in bytes ({len(da)} and {len(db)}) and were compared by content")
                t.same(f"{where}: the glb download, by content (the bytes differ)", glb_content(da), glb_content(db))
            else:
                ea, oa = as_entries(na, da)
                eb, ob = as_entries(nb, db)
                t.notes.append(f"{where}: the USDZs differ in bytes and were compared entry by entry, in any order")
                t.same(f"{where}: the usdz download's entries", sorted(oa), sorted(ob))
                for n in sorted(oa):
                    t.same(f"{where}: usdz / {n}", hashlib.sha1(ea[n]).hexdigest(), hashlib.sha1(eb.get(n, b"")).hexdigest(), show=False)
    for S in (A, B):
        S.page.click('#mode [data-mode="2d"]')
        S.settle(False, 120000)


def tools_same(t, where, A, B, calls):
    for name, a in calls:
        ra, rb = (S.page.evaluate(TOOL_JS, [name, a]) for S in (A, B))
        t.same(f"{where}: {name} {json.dumps(a)}", ra, rb)


def sides_same(t, where, A, B, ms):
    for S in (A, B):
        S.page.evaluate(MARK_JS)
        S.page.click('#view2d [data-view="sides"]')
        S.settle(True, ms)
    compare_snaps(t, f"{where}, Left / Right", A.page.evaluate(SNAP_JS), B.page.evaluate(SNAP_JS))
    for S in (A, B):
        S.page.evaluate(MARK_JS)
        S.page.click('#view2d [data-view="faces"]')
        S.settle(True, ms)


def one_rack(t, browser, bases, name, doc, args):
    A, B = Side(browser, bases[0], "main"), Side(browser, bases[1], "here")
    ms = args.timeout * 1000
    try:
        for S in (A, B):
            if not S.open(doc, ms):
                t.same(f"{name}: {S.name} did not settle after the file opened", 0, 1, show=False)
        where = f"{name}, opened"
        compare_snaps(t, where, A.page.evaluate(SNAP_JS), B.page.evaluate(SNAP_JS))
        tools_same(t, where, A, B, tool_calls(doc, "all"))
        # the tools again: an answer kept from the first call is the answer the other checkout works out again
        tools_same(t, f"{where}, asked again", A, B, tool_calls(doc, args.tools))
        sides_same(t, where, A, B, ms)
        compare_exports(t, where, A, B, ms)
        if args.glb:
            compare_models(t, where, A, B, args.settle)
        done = 0
        for label, step, js in EDITS[: args.edits]:
            e = A.page.evaluate(js)
            if e.get("skip"):
                print(f"  {name}: {label}: skipped ({e['skip']})", flush=True)
                continue
            B.page.evaluate(js)          # the page's own notes of what it chose (window.__removed, window.__routed)
            where = f"{name}, after {label}"
            for S in (A, B):
                S.page.evaluate(MARK_JS)
            ra, rb = (S.page.evaluate(DO_JS, e) for S in (A, B))
            t.same(f"{where}: what the edit answered", ra, rb)
            refused = bool(ra.get("error")) and not e.get("call")
            for S in (A, B):
                if not S.settle(step and not refused and not ra.get("noop"), ms):
                    t.same(f"{where}: {S.name} did not settle", 0, 1, show=False)
            snap_a, snap_b = A.page.evaluate(SNAP_JS), B.page.evaluate(SNAP_JS)
            compare_snaps(t, where, snap_a, snap_b)
            now = snap_a["doc"]
            tools_same(t, where, A, B, tool_calls(now, args.tools))
            done += 1
        where = f"{name}, after its {done} edits"
        now = A.page.evaluate("() => window.__rack.doc()")
        tools_same(t, where, A, B, tool_calls(now, "all"))
        sides_same(t, where, A, B, ms)
        compare_exports(t, where, A, B, ms)
        if args.glb:
            compare_models(t, where, A, B, args.settle)
        for S in (A, B):
            for e in S.errors:
                t.same(f"{name}: an uncaught error {S.name}: {e}", 0, 1, show=False)
    finally:
        A.close()
        B.close()


def fixtures():
    """The rack documents check-browser.py's checks open, and the fixture files under tests/rack/fixtures."""
    spec = importlib.util.spec_from_file_location("check_browser", HERE / "check-browser.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    out = {k: v for k, v in vars(mod).items() if k.endswith("_FIXTURE") and isinstance(v, dict) and v.get("racks")}
    for p in sorted((HERE / "tests" / "rack" / "fixtures").glob("*.json")):
        d = json.loads(p.read_text())
        out[p.name] = d if d.get("racks") else {"format": "portrayal-rack", "version": 4, "id": f"doc-{p.stem}", "racks": [d]}
    make = getattr(mod, "speed_fixture", None)
    if make:
        out["speed_fixture(6)"] = make(6)
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("racks", nargs="*", type=pathlib.Path)
    ap.add_argument("--main", type=pathlib.Path, help="the other checkout, served with its own serve.py")
    ap.add_argument("--urls", nargs=2, metavar=("MAIN", "HERE"), help="two servers already running, the other checkout's first")
    ap.add_argument("--fixtures", action="store_true", help="also every rack document the browser checks open")
    ap.add_argument("--edits", type=int, default=len(EDITS))
    ap.add_argument("--tools", choices=["few", "all"], default="few", help="how many tool calls after each edit (all of them after the open and at the end)")
    ap.add_argument("--glb", action="store_true")
    ap.add_argument("--gpu", action="store_true", help="ask Chromium for the machine's GPU instead of software GL (a 3D scene of a large rack does not settle without one)")
    ap.add_argument("--settle", type=int, default=600, help="seconds a 3D scene gets")
    ap.add_argument("--timeout", type=int, default=900, help="seconds any one 2D step gets")
    args = ap.parse_args()
    if not args.urls and not args.main:
        sys.exit("rack-same: give --main (a checkout to compare with) or --urls")
    from playwright.sync_api import sync_playwright
    servers, bases = [], list(args.urls or [])
    if not bases:
        for root in (args.main, HERE):
            port = free_port()
            servers.append(subprocess.Popen([sys.executable, str(root / "serve.py"), str(port)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
            bases.append(f"http://127.0.0.1:{port}")
    docs = {p.name: json.loads(p.read_text()) for p in args.racks}
    if args.fixtures:
        docs.update(fixtures())
    t = Tally()
    try:
        for b in bases:
            if not wait_for(f"{b}/rack.html"):
                sys.exit(f"rack-same: no server answering at {b}")
        with sync_playwright() as pw:
            browser = pw.chromium.launch(args=["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] if args.gpu else [])
            for name, doc in docs.items():
                before, t0 = (t.n, len(t.bad)), time.time()
                one_rack(t, browser, bases, name, doc, args)
                print(f"{name}: {t.n - before[0]} comparisons, {len(t.bad) - before[1]} different ({time.time() - t0:.0f} s)", flush=True)
            browser.close()
    finally:
        for s in servers:
            s.terminate()
            s.wait(timeout=10)
    for n in t.notes:
        print("note:", n)
    if t.bad:
        print(f"DIFFERENT: {len(t.bad)} of {t.n} comparisons")
        sys.exit(1)
    print(f"same: {t.n} comparisons")


if __name__ == "__main__":
    main()
