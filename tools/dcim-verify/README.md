# dcim-verify

Checks the Rack Builder's NetBox and Nautobot exports against real instances. Two
tools, both Python 3 standard library only, both run by a person who has test
instances and their credentials:

- **`kits.py`**: the acceptance. Imports the two import kits the Rack Builder really
  exports (`export_kits.py` makes them) into a NetBox and a Nautobot, in the order each
  kit's README gives, and compares the cables each ends up with against the rack's.
  Run it after a change to the DCIM exports, and after a Portrayal sync.
- **`verify.py`**: the column probes. Imports small hand-written files, good and bad,
  to learn what each instance accepts and what it says when it refuses. Its run of
  2026-10-04 against NetBox 4.7.2 and Nautobot 3.2.6 is what the kits' columns, values
  and README wording were written from.

Nothing here is served by the site, and nothing here is run by CI against a real
instance. CI runs `selftest.py`, which runs `kits.py` against a local mock (and the
client's own test, `test_client.py`).

## What has been run against real instances

On 2026-10-04 the kits the Rack Builder exports for `acceptance.rack.json` were
imported into a real NetBox 4.7 (through the UI's import pages, in the README's order:
16 steps, none failed) and a real Nautobot 3.2.6 (the CSVs as `text/csv`, then the
kit's own `import_cables.py`, a dry run and `--apply`: 21 steps, none failed), and the
cables each held were compared with the kit's rows. That run, signed in to Nautobot's
web UI, also found a bug in this kit's client, now fixed: the session cookie rode along
with the API token, and Nautobot refused every such request ("CSRF Failed: CSRF token
missing"). A token request now goes through a client with no cookie jar
(`test_client.py` holds that); only the UI pages use the jar.

Still unverified: **Nautobot's UI import of the type YAML** (README step 1 of the
Nautobot kit). It is checked only when `NAUTOBOT_USER` and `NAUTOBOT_PASSWORD` are set,
and until a run with them has every `types_…` step accepted with no `_rest` in its id,
the Nautobot kit's README says that step was not verified.

## Run the acceptance

```sh
# in your own shell; the scripts read these and nothing else
export NETBOX_URL=http://netbox.test:8880
export NETBOX_USER=...            NETBOX_PASSWORD=...     # the web UI sign-in: NetBox imports go through the UI
export NETBOX_TOKEN=...                                    # optional: without it the REST reads use the session
export NAUTOBOT_URL=http://nautobot.test:8881
export NAUTOBOT_TOKEN=...                                  # the CSVs and import_cables.py use the REST API
export NAUTOBOT_USER=...          NAUTOBOT_PASSWORD=...    # optional: imports the type YAML through the UI

python3 tools/dcim-verify/export_kits.py           # exports both kits from the page into tools/dcim-verify/kits/
python3 tools/dcim-verify/kits.py plan             # offline: every file it would send, every cell it would change
python3 tools/dcim-verify/kits.py run              # both targets; or: run netbox / run nautobot
python3 tools/dcim-verify/verify.py cleanup --dry-run
python3 tools/dcim-verify/verify.py cleanup        # delete every pt-verify- object
```

`export_kits.py` needs Playwright (`pip install playwright && playwright install
chromium`), as `check-browser.py` does. It opens `acceptance.rack.json` in the Rack
Builder and clicks Export > NetBox import and Export > Nautobot import.

`kits.py run` writes `kits-result.json` and exits 0 only when every step passed. A
second run needs a `cleanup` first; `--continue` skips that check.

### What it does

| | NetBox | Nautobot |
|---|---|---|
| What the README says must exist | a site, a device role, the manufacturers: created through the UI's import pages | manufacturers, a role, a location type and location, the rack: created through REST JSON |
| README step 1, `types/` | each YAML through Device Types > Import and Module Types > Import | through the UI's import pages when `NAUTOBOT_USER` is set; otherwise built over REST from the YAML ("REST fallback"), which does not test the YAML import |
| The CSV files | `1-rack.csv`, `2-devices.csv`, `3-modules.csv`, `4-cables.csv`, each through its UI import page | `1-devices.csv`, `2-modules.csv` to the REST API as `text/csv` |
| The cables | in `4-cables.csv` | the kit's own `import_cables.py 3-cables.csv`, a dry run and then `--apply` |
| The comparison | each cable NetBox has, by label: its two ends (kind, device, port), type, status, length, unit and description, against the kit's row | each cable Nautobot has, by label: its two ends by id, type, length and unit, against the kit's row |

The last step, `cables_compared`, also lists every cable of `acceptance.rack.json`: in
the cables file and connected as written, or left out with the README's sentence and
absent from the instance.

### What a passing run shows

| Step in `kits-result.json` | Shows |
|---|---|
| `kit_racks`, `kit_devices` accepted (NetBox) | the rack file and a devices file with the site and role filled in import; the device left out of the file (`pt-verify-demarc-i3`, which shares U14) is what kept NetBox from refusing it |
| `kit_devices` accepted with 4 rows (Nautobot) | Nautobot takes the pair NetBox refuses, and the file keeps both |
| `kit_modules` accepted | every seated card imports by device name and bay name |
| `kit_cables` accepted (NetBox) | every port name in the file exists: the names came from the type files, a card port as `<bay position>/<leaf>`; a blank type and a decimal length import |
| `script_dry_run`, `script_apply` exit 0 (Nautobot) | `import_cables.py` finds every end by name and creates every cable by id, with whole-number lengths |
| `cables_compared` accepted | each instance holds exactly the cables its kit lists, connected as written, and every other cable of the rack is named in the README |
| the `types_…` steps, without `_rest` in their id (Nautobot, with a UI sign-in) | Nautobot's own YAML import takes the kit's `types/` folder |

## Safety

- Every object created is named `pt-verify-…` (a cable: its label; a type: its model).
  `acceptance.rack.json` names its rack, devices, cable labels, site and role that way.
- A manufacturer and a type cannot be named by the rack, so `kits.py` renames them with
  the prefix as it sends them: in each YAML's identity lines (`manufacturer`, `model`,
  `slug`) and in the CSV cells that name them. Each step records how many cells it
  changed. Every other cell goes in as the kit has it.
- `kits.py` refuses a kit that would create a name without the prefix, before it sends
  anything.
- `cleanup` asks for objects by that prefix, then checks each returned name on this side
  before deleting it, so a filter the instance ignores cannot widen it.
- Each target talks to the host in its own `…_URL` and no other: a request or a redirect
  to another host is refused. A URL that carries credentials is refused.
- No credential is printed, logged or written. Console output, the result files and the
  saved pages pass through a redactor that replaces each credential's value with `***`.

## The column probes

```sh
python3 tools/dcim-verify/verify.py plan       # offline
python3 tools/dcim-verify/verify.py run        # writes result.json; a refused UI import's page goes under out/
```

`fixture/` holds the probe files. A file named `…-v-…` is a variant whose result is not
known beforehand; `…-x-…` is one expected to be refused, sent to capture the instance's
error text. `result.json` records, per step, the request, whether it was accepted, and
the instance's own messages.
