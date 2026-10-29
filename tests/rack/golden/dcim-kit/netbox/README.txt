NetBox import kit for Cable test, from the Portrayal Rack Builder, 2026-10-04.

Before you import, NetBox must already have:
- the site "Lab 1"
- the device role "Router"
- these manufacturers: BATM/Telco Systems, Cisco, Edgecore

Import in this order. NetBox takes each CSV file whole or not at all: one
  refused row refuses the file.
Step 1: types/device-types/, then types/module-types/ (7 files): Device Types
        > Import and Module Types > Import, format YAML, one file at a time.
        The module types must be in before step 4.
Step 2: 1-rack.csv (1 row): Racks > Import. Creates the rack "Cable test",
        24U, numbered from the bottom.
Step 3: 2-devices.csv (3 rows): Devices > Import. Every device is planned.
Step 4: 3-modules.csv (11 rows): Modules > Import. This creates each card's
        ports, so it comes before the cables.
Step 5: 4-cables.csv (1 row): Cables > Import.

If NetBox is not empty:
- If the rack "Cable test" is already in that site, skip step 2 and check that
  it is 24U, numbered from the bottom. Step 3 puts the devices in it.
- Steps 4 and 5 find a device by its name in every site, and step 4 finds a
  module type by its model in every manufacturer: a name NetBox already has
  twice is refused as not unique.

Not in this kit:
- demarc-i3 is not in the devices file: it shares U14 with leaf-1 on the
  front, and NetBox refuses two devices in one U, front and rear, while either
  type is full depth. One refused row refuses the whole file. Import demarc-i3
  by hand after changing the type's depth, or place it elsewhere.
- Cable c2 is not in the cables file: end B is on demarc-i3, which is not in
  the devices file.
- Cable c3 is not in the cables file: end A, leaf-1 (U14) port-2, is not
  connected (port-2 holds no optic).

Notes:
- core-1 (asr-9006, configuration base): ASR-9006-AC-V2 is a best guess among
  2 NetBox device types; none names this configuration.
- leaf-1 (as7726-32x, configuration ac-f2b): 7726-32X-O-AC-F is a best guess
  among 8 NetBox device types; none names this configuration.
- generic/qsfp-lc@2: no NetBox module type; seated in core-1, leaf-1.
- common/psu-ac-650@3: no NetBox module type; seated in leaf-1.
- common/fan-module@1: no NetBox module type; seated in leaf-1.
