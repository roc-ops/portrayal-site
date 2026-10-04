#!/usr/bin/env python3
"""Export the two import kits for acceptance.rack.json, as a user would.

    python3 tools/dcim-verify/export_kits.py

Starts this repository's own dev server, opens rack.html in a headless
browser, opens acceptance.rack.json, and clicks Export > NetBox import and
Export > Nautobot import. The two downloads are saved, untouched, under
tools/dcim-verify/kits/ (or $PT_VERIFY_KITS). kits.py imports them. Needs
Playwright, as check-browser.py does; it contacts nothing but the local server.
"""
import importlib.util
import json
import os
import pathlib
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent.parent
OUT = pathlib.Path(os.environ.get('PT_VERIFY_KITS') or HERE / 'kits')


def main():
    spec = importlib.util.spec_from_file_location('check_browser', ROOT / 'check-browser.py')
    cb = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(cb)
    from playwright.sync_api import sync_playwright
    fixture = json.loads((HERE / 'acceptance.rack.json').read_text(encoding='utf-8'))
    port = cb.free_port()
    server = subprocess.Popen([sys.executable, str(ROOT / 'serve.py'), str(port), '--bind', '127.0.0.1'], cwd=ROOT,
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        base = f'http://127.0.0.1:{port}'
        if not cb.wait_for(f'{base}/rack.html'):
            print('the local server did not start', file=sys.stderr)
            return 1
        OUT.mkdir(parents=True, exist_ok=True)
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            page = browser.new_page(accept_downloads=True)
            cb.open_cabled(page, base, fixture)
            for target in ('netbox', 'nautobot'):
                dl = cb.export_file(page, f'{target}-import')
                status = cb.export_status(page)
                dest = OUT / dl.suggested_filename
                dl.save_as(dest)
                print(f'{dest}  ({status})')
            browser.close()
    finally:
        server.terminate()
    return 0


if __name__ == '__main__':
    sys.exit(main())
