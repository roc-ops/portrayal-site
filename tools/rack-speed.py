#!/usr/bin/env python3
"""How long the Rack Builder takes on a rack file, and where the time goes.

Not a check: it asserts nothing and CI does not run it. It is the measure that
portrayal-site#192 was written from, kept so the next change to the page's
speed is measured the same way. The budgets that ARE checks are in
check-browser.py (check_rack_speed_budgets), as ratios against a small rack.

    python3 tools/rack-speed.py path/to/a.rack.json [another.rack.json ...]
        [--runs 3] [--no-3d] [--settle 300] [--url http://127.0.0.1:8932]
        [--gpu] [--json out.json]

It opens each file through the page's own Open .json input, in headless
Chromium, under ?probe=1. By default that is software GL (SwiftShader), as CI
has: the absolute figures are pessimistic and the ratios are the point, and
in 3D nearly all of the time is the frames themselves. --gpu asks Chromium for
the machine's own GPU (ANGLE on Metal, on a Mac that has one), which is what a
visitor has; the report names the renderer it got. It prints the median over
--runs of:

  first 2D draw          from the file being chosen to the page being idle
  redraw after an edit   one cable's end moved to another port; one device moved
                         (each taken back with Undo, which is timed as well)
  each assistant tool    the page's own tools, run in sequence with no edit
                         between them, the whole sequence twice: `first` is
                         each tool's first call on the rack, `again` its second
  pair switch            Front / Rear to Left / Right, and back
  3D                     first paint (a canvas), the cables hung, and settle
                         (the scene complete, every part's detail built), or
                         "not settled in N s"; with the longest stretch the
                         page could not answer in, the frames drawn and what
                         one frame draws (draw calls, triangles)

and beside each: how many times the routes were read (route-context.js
routeFacts, each a new context) and how many cables the kit laid, and for a
redraw where its time went (the cables' faces, the routes by stage, the panes,
the cable layer, the side panel).

A rack file is the visitor's own: none is committed, and this writes nothing
but --json.
"""
import argparse
import contextlib
import json
import pathlib
import socket
import statistics
import subprocess
import sys
import time
import urllib.request

HERE = pathlib.Path(__file__).resolve().parent.parent

# A stand-in for the browser's WebMCP, as check-browser.py's: what the page registers, kept to call.
STAND_IN_MODEL_CONTEXT = """
window.__tools = {};
const mc = {registerTool(t, o) {
  window.__tools[t.name] = t;
  o?.signal?.addEventListener('abort', () => delete window.__tools[t.name]);
  return Promise.resolve();
}};
Object.defineProperty(Document.prototype, 'modelContext', {get: () => mc, configurable: true});
"""

# Run `act`, then wait until a redraw has finished since and the page is idle. Answers the wall time in ms,
# the counts it cost, and the redraw's own breakdown. All inside the page, so no round trip is timed.
TIMED_JS = """async ([src, arg, ms, needDraw]) => {
  const R = window.__rack, sleep = t => new Promise(r => setTimeout(r, t));
  const before = R.reads(), drawn = R.drawn(), t0 = performance.now();
  const out = await (0, eval)(`(${src})`)(arg);
  const end = Date.now() + ms;
  let settled = false;
  while (Date.now() < end) {
    await new Promise(r => queueMicrotask(r));
    if ((!needDraw || R.drawn() > drawn) && R.idle()) {
      // a redraw can queue another (a routed length stored, a notice): idle must hold across a task
      await sleep(0);
      if (R.idle()) { settled = true; break; }
    }
    await sleep(5);
  }
  const t1 = performance.now(), after = R.reads();
  return {ms: t1 - t0, settled, out: out ?? null, reads: after.routeFacts - before.routeFacts, lays: after.lays - before.lays,
          times: R.times(), routes: after.last};
}"""

SETTLE_3D_JS = """async ({ms}) => {
  const sleep = t => new Promise(r => setTimeout(r, t));
  const t0 = performance.now(), deadline = Date.now() + ms;
  let paint = null, hung = null, longest = 0, lastTick = performance.now();
  const gl = () => { const c = document.querySelector('#stage3d canvas'), g = c?.getContext('webgl2') ?? c?.getContext('webgl');
    const e = g?.getExtension('WEBGL_debug_renderer_info'); return g ? (e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER)) : null; };
  const drawn = s => { const i = s?.three?.renderer?.info; return i ? {frames: i.render.frame, calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures} : null; };
  // the longest stretch the page could not run a timer in: how long it would not have answered a click
  const beat = setInterval(() => { const n = performance.now(); longest = Math.max(longest, n - lastTick); lastTick = n; }, 50);
  try {
    while (Date.now() < deadline) {
      if (paint == null && document.querySelector('#stage3d canvas')) paint = performance.now() - t0;
      const s = window.__rack.scene();
      if (!s) { await sleep(100); continue; }
      hung ??= performance.now() - t0;
      const done = await Promise.race([Promise.resolve(s.complete?.()).then(() => true),
                                       sleep(Math.max(0, deadline - Date.now())).then(() => false)]);
      if (!done) break;
      await sleep(500);           // past the page's 300 ms rebuild debounce
      if (window.__rack.scene() !== s) continue;
      const tubes = (s.rackCables?.tubes ?? []).length;
      return {settled: true, paint, hung, ms: performance.now() - t0 - 500, tubes, longest, drawn: drawn(s), renderer: gl()};
    }
    const s = window.__rack.scene() ?? window.__rack.loadingScene?.();
    return {settled: false, paint, hung, ms: performance.now() - t0, tubes: (s?.rackCables?.tubes ?? []).length, longest, drawn: drawn(s), renderer: gl()};
  } finally { clearInterval(beat); }
}"""


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


def timed(page, src, arg=None, ms=600000, need_draw=True):
    return page.evaluate(TIMED_JS, [src, arg, ms, need_draw])


def open_file(page, base, doc, ms):
    """A fresh page, then the file through Open .json: the first draw, timed from the file being chosen."""
    page.goto(f"{base}/rack.html?probe=1", wait_until="load")
    page.wait_for_function("() => window.__rack && window.__rack.ready", timeout=120000)
    page.evaluate("() => window.__rack.ready")
    page.evaluate("() => new Promise(async done => { while (!window.__rack.idle()) await new Promise(r => setTimeout(r, 20)); done(); })")
    if page.evaluate("() => window.__rack.view()") != "faces":
        page.click('#view2d [data-view="faces"]')
    was = page.evaluate("() => ({id: window.__rack.doc().id, drawn: window.__rack.drawn(), reads: window.__rack.reads()})")
    t0 = time.time()
    page.set_input_files("#openFile", files=[{"name": "speed.rack.json", "mimeType": "application/json",
                                              "buffer": json.dumps(doc).encode()}])
    page.wait_for_function("was => window.__rack.doc().id !== was.id && window.__rack.drawn() > was.drawn && window.__rack.idle()",
                           arg=was, timeout=ms, polling=20)
    wall = (time.time() - t0) * 1000
    got = page.evaluate("was => { const r = window.__rack.reads(); return {times: window.__rack.times(), routes: r.last, reads: r.routeFacts - was.reads.routeFacts, lays: r.lays - was.reads.lays}; }", was)
    return {"ms": wall, **got}


# One cable's end moved to another free port of the same panel: the first free port that the command takes.
MOVE_END_JS = """async () => {
  const R = window.__rack, r = R.doc().racks[0];
  for (const c of r.cables) {
    const free = await R.query.freePorts(c.a.item);
    if (!Array.isArray(free)) continue;
    for (const p of free.filter(p => p.view === c.a.view).slice(0, 6)) {
      const res = R.apply({op: 'cable.update', id: c.id, a: {item: c.a.item, path: p.path, view: p.view}});
      if (!res.error && !res.noop) return {cable: c.id, to: p.path};
    }
  }
  return {error: 'no cable end could be moved'};
}"""

# One device moved to the first other unit the kit lets it stand at.
MOVE_ITEM_JS = """() => {
  const R = window.__rack, r = R.doc().racks[0];
  const cabled = new Set(r.cables.flatMap(c => [c.a.item, c.b.item]));
  for (const it of r.items.filter(i => cabled.has(i.id) && !i.on)) {
    for (let ru = r.frame.heightRU; ru >= 1; ru--) {
      if (ru === it.ru) continue;
      const res = R.apply({op: 'move', id: it.id, ru});
      if (!res.error && !res.noop) return {item: it.id, from: it.ru, to: ru};
    }
  }
  return {error: 'no device could be moved'};
}"""

TOOL_JS = """async ([n, a]) => {
  const res = await window.__tools[n].execute(a);
  const text = res?.content?.[0]?.text ?? '';
  return {isError: !!res?.isError, chars: text.length, head: text.split('\\n')[0].slice(0, 100)};
}"""


def tool_calls(doc):
    rack = doc["racks"][0]
    cables = rack.get("cables") or []
    items = rack.get("items") or []
    cabled = {c["a"]["item"] for c in cables}
    dev = next((i for i in items if i["id"] in cabled), items[0] if items else None)
    calls = [("describe_rack", {}), ("describe_rack cables", {"section": "cables", "offset": 0, "limit": 50})]
    if cables:
        calls += [(f"inspect cable {cables[0]['id']}", {"id": cables[0]["id"]}), (f"inspect cable {cables[-1]['id']}", {"id": cables[-1]["id"]})]
    if dev:
        calls += [(f"inspect device {dev['id']}", {"id": dev["id"]}), (f"list_free_ports {dev['id']}", {"id": dev["id"]}),
                  ("check_fit", {"ref": dev["ref"], "face": "front"})]
    if rack.get("bundles"):
        calls.append((f"inspect bundle {rack['bundles'][0]['id']}", {"id": rack["bundles"][0]["id"]}))
    calls.append(("find_devices", {"text": "patch panel"}))
    if cables:
        calls.append(("edit_rack dry_run (a cable relabelled)", {"dry_run": True, "commands": [{"op": "cable.update", "id": cables[0]["id"], "label": "speed"}]}))
    calls += [("export_rack cable schedule", {"kind": "cable schedule"}), ("export_rack bill of materials", {"kind": "bill of materials"})]
    return [(label, label.split(" ")[0], args) for label, args in calls]


def one_run(browser, base, doc, args):
    out = {}
    context = browser.new_context(viewport={"width": 1600, "height": 1000}, accept_downloads=True)
    page = context.new_page()
    # a click is answered when the page next has a moment, and a large rack keeps it busy for a minute at a time
    page.set_default_timeout(args.timeout * 1000)
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(STAND_IN_MODEL_CONTEXT)
    try:
        ms = args.timeout * 1000
        out["first 2D draw"] = open_file(page, base, doc, ms)
        if not args.only_3d:
            two_d(page, doc, out, ms)
        if not args.no_3d:
            page.click('#mode [data-mode="3d"]')
            out["3D"] = page.evaluate(SETTLE_3D_JS, {"ms": args.settle * 1000})
            page.click('#mode [data-mode="2d"]')
        out["errors"] = errors
    finally:
        context.close()
    return out


def two_d(page, doc, out, ms):
    if True:
        out["redraw, nothing changed"] = timed(page, "() => { window.__rack.redraw(); }", ms=ms)
        for label, js in (("one cable's end moved", MOVE_END_JS), ("one device moved", MOVE_ITEM_JS)):
            got = timed(page, js, ms=ms)
            if (got.get("out") or {}).get("error"):
                out[f"redraw, {label}"] = {"skipped": got["out"]["error"]}
                continue
            out[f"redraw, {label}"] = got
            out[f"redraw, {label}, undone"] = timed(page, "() => { window.__rack.undo(); }", ms=ms)
        for turn in ("first", "again"):
            for label, name, a in tool_calls(doc):
                out[f"tool {label} ({turn})"] = timed(page, TOOL_JS, [name, a], ms=ms, need_draw=False)
        out["pair switch to Left / Right"] = timed(page, "() => { document.querySelector('#view2d [data-view=\"sides\"]').click(); }", ms=ms)
        out["pair switch to Front / Rear"] = timed(page, "() => { document.querySelector('#view2d [data-view=\"faces\"]').click(); }", ms=ms)


def med(xs):
    xs = [x for x in xs if x is not None]
    return statistics.median(xs) if xs else None


def secs(ms):
    return "-" if ms is None else f"{ms / 1000:7.2f} s"


def report(name, doc, runs, settle):
    rack = doc["racks"][0]
    print(f"\n## {name}: {len(rack.get('items') or [])} items, {len(rack.get('cables') or [])} cables, {len(rack.get('bundles') or [])} bundles; median of {len(runs)}")
    print(f"{'':46s} {'time':>10s} {'reads':>6s} {'lays':>7s}")
    keys = [k for k in runs[0] if k not in ("3D", "errors")]
    summary = {}
    for k in keys:
        rows = [r.get(k) for r in runs if r.get(k)]
        if not rows or rows[0].get("skipped"):
            print(f"{k:46s} {'skipped: ' + rows[0]['skipped'] if rows else 'missing'}")
            continue
        m = med([r["ms"] for r in rows])
        late = "" if all(r.get("settled", True) for r in rows) else "  (did not settle)"
        print(f"{k:46s} {secs(m):>10s} {med([r['reads'] for r in rows]):6.0f} {med([r['lays'] for r in rows]):7.0f}{late}")
        summary[k] = {"ms": m, "reads": med([r["reads"] for r in rows]), "lays": med([r["lays"] for r in rows])}
        if k.startswith(("first", "redraw")):
            t = rows[len(rows) // 2].get("times") or {}
            parts = [f"{p} {t[p] / 1000:.2f}" for p in ("facts", "routes", "panes", "layout", "cables", "side", "rest") if p in t]
            side = t.get("sidePanel") or {}
            if side:
                parts.append("(side panel: " + ", ".join(f"{p} {side[p] / 1000:.2f}" for p in ("notes", "spares", "list") if p in side) + f"; {side.get('notes_n', 0)} sentences)")
            print(f"{'':6s}where: " + ", ".join(parts))
            rt = rows[len(rows) // 2].get("routes") or {}
            if rt and rows[len(rows) // 2]["reads"]:
                print(f"{'':6s}routes: " + ", ".join(f"{p} {v / 1000:.2f}" for p, v in rt.items()))
            summary[k]["where"] = t
            summary[k]["routes"] = rt
    three = [r["3D"] for r in runs if r.get("3D")]
    if three:
        t = three[len(three) // 2]
        print(f"{'3D first paint':46s} {secs(med([x['paint'] for x in three])):>10s}")
        print(f"{'3D cables hung':46s} {secs(med([x.get('hung') for x in three])):>10s}")
        if all(x["settled"] for x in three):
            print(f"{'3D settle':46s} {secs(med([x['ms'] for x in three])):>10s}   {t['tubes']} tubes; longest stall {med([x['longest'] for x in three]) / 1000:.1f} s")
        else:
            print(f"{'3D settle':46s} not settled in {settle} s   {t['tubes']} tubes hung; longest stall {t['longest'] / 1000:.1f} s")
        d = t.get("drawn") or {}
        if d:
            print(f"{'':6s}a frame: {d['calls']} draw calls, {d['triangles']} triangles, {d['geometries']} geometries, {d['textures']} textures; {d['frames']} frames drawn; {t.get('renderer')}")
        summary["3D"] = three
    errs = [e for r in runs for e in r.get("errors", [])]
    if errs:
        print("uncaught:", *errs[:5], sep="\n  ")
    return summary


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("racks", nargs="+", type=pathlib.Path)
    ap.add_argument("--runs", type=int, default=3)
    ap.add_argument("--no-3d", action="store_true")
    ap.add_argument("--settle", type=int, default=300, help="seconds the 3D scene gets to settle")
    ap.add_argument("--timeout", type=int, default=900, help="seconds any one 2D step gets")
    ap.add_argument("--url", help="a server already running; otherwise one is started")
    ap.add_argument("--gpu", action="store_true", help="ask Chromium for the machine's GPU instead of software GL")
    ap.add_argument("--only-3d", action="store_true", help="open the file and time the 3D scene alone")
    ap.add_argument("--json", type=pathlib.Path)
    args = ap.parse_args()
    from playwright.sync_api import sync_playwright
    server = None
    base = args.url
    if not base:
        port = free_port()
        server = subprocess.Popen([sys.executable, str(HERE / "serve.py"), str(port)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        base = f"http://127.0.0.1:{port}"
    everything = {}
    try:
        if not wait_for(f"{base}/rack.html"):
            sys.exit(f"rack-speed: no server answering at {base}")
        with sync_playwright() as pw:
            browser = pw.chromium.launch(args=["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] if args.gpu else [])
            for path in args.racks:
                doc = json.loads(path.read_text())
                runs = []
                for n in range(args.runs):
                    runs.append(one_run(browser, base, doc, args))
                    print(f"  {path.name}: run {n + 1} of {args.runs} done", file=sys.stderr, flush=True)
                everything[path.name] = {"summary": report(path.name, doc, runs, args.settle), "runs": runs}
            browser.close()
    finally:
        if server:
            server.terminate()
            server.wait(timeout=10)
    if args.json:
        args.json.write_text(json.dumps(everything, indent=1))


if __name__ == "__main__":
    main()
