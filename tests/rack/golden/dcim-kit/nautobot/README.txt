Nautobot import kit for Cable test, from the Portrayal Rack Builder,
  2026-10-04.

Before you import, Nautobot must already have:
- the location "Lab 1", of a location type that allows devices and racks
- the role "Router", for devices
- a status named Planned, for devices, modules and cables
- these manufacturers: BATM/Telco Systems, Cisco, Edgecore
- the rack "Cable test" in that location: 24U, numbered from the bottom. This
  kit has no rack file for Nautobot.

Import in this order. Nautobot takes each CSV file whole or not at all.
Step 1: types/device-types/, then types/module-types/ (7 files): Device Types
        > Import and Module Types > Import, one YAML file per import.
Step 2: 1-devices.csv (4 rows): Devices > Import, or POST it to
        /api/dcim/devices/ as text/csv. Every device is planned.
Step 3: 2-modules.csv (11 rows): Modules > Import, or POST it to
        /api/dcim/modules/ as text/csv. This creates each card's ports, so it
        comes before the cables.
Step 4: 3-cables.csv (2 rows), with import_cables.py. Warning: do not give
        3-cables.csv to Nautobot's own importer. Nautobot takes a cable's ends
        by id only, and from a file that names them it creates cables with no
        ends.
        export NAUTOBOT_URL=https://nautobot.example.com
        export NAUTOBOT_TOKEN=...     (an API token; the script never prints it)
        python3 import_cables.py 3-cables.csv             (a dry run: what it would create, and what it cannot find)
        python3 import_cables.py 3-cables.csv --apply     (creates the cables)
        Python 3, standard library only. It talks to that URL's host and no
        other. Run it again after a failure: a cable it already made is
        reported as already connected, and left alone.
        A cable's purpose is not carried into Nautobot by this kit.

If Nautobot is not empty:
- If a rack named "Cable test" is in another location too, that one is not
  used: 1-devices.csv finds the rack by its name and its location together
  (rack__name, rack__location__name), so the rack must be the one in the
  location "Lab 1".
- Step 3 and import_cables.py find a device by its name in every location: a
  device name Nautobot already has twice is refused, and the script says so
  for each row that names it.

Not in this kit:
- Cable c3 is not in the cables file: end A, leaf-1 (U14) port-2, is not
  connected (port-2 holds no optic).

Notes:
- core-1 (asr-9006, configuration base): ASR-9006-AC-V2 is a best guess among
  2 Nautobot device types; none names this configuration.
- leaf-1 (as7726-32x, configuration ac-f2b): 7726-32X-O-AC-F is a best guess
  among 8 Nautobot device types; none names this configuration.
- generic/qsfp-lc@2: no Nautobot module type; seated in core-1, leaf-1.
- common/psu-ac-650@3: no Nautobot module type; seated in leaf-1.
- common/fan-module@1: no Nautobot module type; seated in leaf-1.
- Cable c2: length measured along its route.
