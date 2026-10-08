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
instance. CI runs `selftest.py`, which runs `kits.py` against a local mock, and with it
the client's own tests (`test_client.py`: a token request never carries the web
session, no credential comes out however an error spells it, no proxy is used, a base
URL with a path pages through a list) and cleanup's (`test_cleanup.py`: only this kit's
own objects are deleted, whatever the instance answers). The self-tests write nothing
into this directory: their result file, kits and saved pages go to a temporary one.

## What has been run against real instances

On 2026-10-04 the kits the Rack Builder exported for `acceptance.rack.json` (at commit
`2bbe359e`) were imported into a real NetBox 4.7.2 (through the UI's import pages, in
the README's order: 17 steps, none failed) and a real Nautobot 3.2.6 (the type files
through its own UI import, the CSVs as `text/csv`, then the kit's own
`import_cables.py`: a dry run, `--apply`, and `--apply` a second time: 25 steps, none
failed). The devices and the cables each instance held were compared with the kit's
rows. That run showed:

- with a second location on the Nautobot holding a rack of the same name as the kit's,
  the devices file was accepted and every device was in the rack of its own location:
  `rack__name` and `rack__location__name` together find exactly one rack;
- `import_cables.py` ties each port to its device by id on a real Nautobot, a card's
  port (`slot-2/p0`) through its module's bay included;
- the second `import_cables.py --apply` of the same file reported every row as already
  connected and exited 0;
- the kits' boundary values were accepted at their exact limits: a 64-character device
  name, a 100-character cable label, a 200-character description, a length of
  999999.99 m, and a length rounding up to 32767;
- two devices whose names differ only by case were imported under the names the kit
  gave them;
- Nautobot 3.2.6's own UI import took all seven type files of the Nautobot kit's
  `types/` folder, so that kit's README does not call the step unverified. The step is
  checked only when `NAUTOBOT_USER` and `NAUTOBOT_PASSWORD` are set: without them the
  `types_…` steps carry `_rest` in their id and test nothing about the YAML import.

Earlier runs the same day (16 and 21 steps, then 17 and 23) found a bug in this kit's
client, since fixed: the session cookie rode along with the API token, and Nautobot
refused every such request ("CSRF Failed: CSRF token missing"). A token request now
goes through a client with no cookie jar (`test_client.py` holds that); only the UI
pages use the jar.

**Still proven only against a mock**, never against a real instance:

- every refusal path of `import_cables.py`: an ambiguous device, a port already in
  another cable, a redirect, a refused token (401 or 403), a cable that does not show
  both of its ends after it is created;
- an instance with real data in it, beyond the one same-named rack the acceptance
  makes: every run so far was against instances holding nothing else under these names;
- any version other than NetBox 4.7.2 and Nautobot 3.2.6.

## Run the acceptance

```sh
# in your own shell; the scripts read these and nothing else
export NETBOX_URL=http://netbox.example.test:8880
export NETBOX_USER=...            NETBOX_PASSWORD=...     # the web UI sign-in: NetBox imports go through the UI
export NETBOX_TOKEN=...                                    # optional: without it the REST reads use the session
export NAUTOBOT_URL=http://nautobot.example.test:8881
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

Each credential is read once and the space around it is dropped, so one read from a
file that ends in a line break works. One that holds a control character or a character
that is not ASCII is refused, without being shown. No proxy is used, whatever
`HTTP_PROXY` says. `PT_VERIFY_KITS`, `PT_VERIFY_RESULT`, `PT_VERIFY_FIXTURE` and
`PT_VERIFY_OUT` move the kits, the result file, the rack file and the saved pages
elsewhere (the self-tests use them).

### What it does

| | NetBox | Nautobot |
|---|---|---|
| What the README says must exist | a site, a device role, the manufacturers: created through the UI's import pages | manufacturers, a role, a location type and location, the rack: created through REST JSON |
| An instance that is not empty | (not exercised) | a second location, `<location>-other`, holding a rack with the same name as the kit's, created first: the devices file must find its rack by name and location together |
| README step 1, `types/` | each YAML through Device Types > Import and Module Types > Import | through the UI's import pages when `NAUTOBOT_USER` is set; otherwise built over REST from the YAML ("REST fallback"), which does not test the YAML import |
| The CSV files | `1-rack.csv`, `2-devices.csv`, `3-modules.csv`, `4-cables.csv`, each through its UI import page | `1-devices.csv`, `2-modules.csv` to the REST API as `text/csv` |
| The cables | in `4-cables.csv` | the kit's own `import_cables.py 3-cables.csv`: a dry run, `--apply`, and `--apply` again on the same file |
| The devices | every device of `2-devices.csv` is on NetBox under its exact name, and nothing else under `pt-verify-` | every device of `1-devices.csv`, the same, and each is in the rack of its own location, not the rack of that name in the other one |
| The comparison | each cable NetBox has, by label: its two ends (kind, device, port), type, status, length, unit and description, against the kit's row | each cable Nautobot has, by label: its two ends by id, type, length and unit, against the kit's row |

The last step, `cables_compared`, also lists every cable of `acceptance.rack.json`: in
the cables file and connected as written, or left out with the README's sentence and
absent from the instance.

### What a passing run shows

| Step in `kits-result.json` | Shows |
|---|---|
| `kit_racks`, `kit_devices` accepted (NetBox) | the rack file and a devices file with the site and role filled in import; the device left out of the file (`pt-verify-demarc-i3`, which shares U14) is what kept NetBox from refusing it |
| `kit_devices` accepted (Nautobot) | Nautobot takes the pair NetBox refuses, and the file keeps both; and with two racks of one name on the instance, `rack__name` and `rack__location__name` together found exactly one (by name alone Nautobot answers "Multiple objects match") |
| `kit_modules` accepted | every seated card imports by device name and bay name |
| `kit_cables` accepted (NetBox) | every port name in the file exists: the names came from the type files, a card port as `<bay position>/<leaf>`; a blank type and a decimal length import |
| `script_dry_run`, `script_apply` exit 0, each with its summary line (Nautobot) | `import_cables.py` finds every end by name and creates every cable by id, with whole-number lengths; the summaries read `N rows: N would be created, 0 already connected, 0 failed. Nothing was created.` and `N rows: N created, 0 already connected, 0 failed.` |
| `script_apply_again` exits 0 with `N rows: 0 created, N already connected, 0 failed.` (Nautobot) | a second run on the same file is safe: every row is recognized as the cable the first run made, and nothing is sent |
| `devices_compared` accepted | on Nautobot, every device is in the rack of its own location (its `rack` in the step's table reads "the rack in its own location"). Each instance holds every device of its kit under the final name the kit gave it: the device named at exactly 64 characters, and `pt-verify-Twin-i6` and `pt-verify-twin-i7` (labels that differ only by case, which the kit renamed; NetBox compares names ignoring case, so both must exist) |
| `cables_compared` accepted | each instance holds exactly the cables its kit lists, connected as written, and every other cable of the rack is named in the README. Among them the boundary cables: a label of exactly 100 characters (both targets), a description of exactly 200 and a length of 999999.99 m (NetBox: the largest it takes), and 32766.5 m, which Nautobot's whole numbers make 32767 (and NetBox keeps as is). The 999999.99 m cable is too long for Nautobot, so its Nautobot row has no length and the README says so |
| the `types_…` steps, without `_rest` in their id (Nautobot, with a UI sign-in) | Nautobot's own YAML import takes the kit's `types/` folder |

### The boundary values

`acceptance.rack.json` carries the values DCIM_LIMITS (`vendor/rack/export-data.js`) screens
at, each exactly AT its limit, which the kit keeps: a device `pt-verify-boundary-name-64-…`
whose final name is 64 characters (the kit prefixes manufacturer and type names, never a
device's, so the `pt-verify-` is part of the rack's own label and counts toward the 64); a
cable labeled with 100 characters whose purpose is 200 characters (NetBox's description);
`pt-verify-limit`, 32766.5 m. Two more devices, `pt-verify-Twin` and `pt-verify-twin`, are
renamed by the kit to `…-i6` and `…-i7`. If a real instance refuses one of these rows, the
limit in DCIM_LIMITS is wrong for that instance: fix the limit, not the run. A kit with the
boundary rack has 6 device rows and 5 cable rows for NetBox, 7 and 6 for Nautobot.

## Safety

- Every object created is named `pt-verify-…` (a cable: its label; a type: its model).
  `acceptance.rack.json` names its rack, devices, cable labels, site and role that way.
- A manufacturer and a type cannot be named by the rack, so `kits.py` renames them with
  the prefix as it sends them: in each YAML's identity lines (`manufacturer`, `model`,
  `slug`) and in the CSV cells that name them. Each step records how many cells it
  changed. Every other cell goes in as the kit has it.
- `kits.py` refuses a kit that would create a name without the prefix, before it sends
  anything. It also refuses a kit whose CSV files do not have exactly the columns the
  Rack Builder writes: with an `id` column NetBox's import updates an object that is
  already there, and a kit is only ever meant to create.
- `cleanup` asks for objects by that prefix, then checks each returned object on this
  side before deleting it: its own identifying field (a cable's label, a type's model,
  anything else's name) must be text that starts with the prefix. A filter the instance
  ignores cannot widen it, and the prefix in any other field, after a space or in
  another case does not count. An id goes into the DELETE address as one quoted path
  segment. `test_cleanup.py` holds all of this against a mock that does everything
  else wrong.
- Each target talks to the host in its own `…_URL` and no other: a request or a redirect
  to another host is refused, a list's `next` link is followed by its path on this
  host only, and no proxy is used. A URL that carries credentials is refused, by `plan`
  too, and is never shown.
- No credential is printed, logged or written. Console output, the result files and the
  saved pages pass through a redactor that replaces each credential with `***`: as it
  is, and as Python, JSON or a URL would escape it (an exception that quotes a refused
  header spells it that way). The session's own CSRF value and cookie values are
  redacted the same way. Nothing prints a traceback: an error nobody caught is one
  redacted line that says the kind of error and where it arose (a function and a line).

## The column probes

```sh
python3 tools/dcim-verify/verify.py plan       # offline
python3 tools/dcim-verify/verify.py run        # writes result.json; a refused UI import's page goes under out/
```

`fixture/` holds the probe files. A file named `…-v-…` is a variant whose result is not
known beforehand; `…-x-…` is one expected to be refused, sent to capture the instance's
error text. `result.json` records, per step, the request, whether it was accepted, and
the instance's own messages.
