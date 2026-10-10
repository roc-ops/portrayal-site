// THE DEVICE A FIRST VISIT OPENS ON (roc-ops/portrayal-site#19), for every
// page that opens on one: the Explorer, Annotate and the showcase, the three
// export pages (DCIM, draw.io, drawings), and the pages that are not deployed
// (the photo overlay, the schematic prototype, the 3D harness).
//
// Left to the shell, a page with no ?device= opens on the C100G, whose default
// is its `base` configuration: fourteen empty bays and no ports, the opposite
// of what any of these pages is there to show. 220 of 256 devices default to a
// base, so "the first device whose default is not a base" lands on whatever
// sorts first among the rest; a named device says what the page shows. The
// AS7726-32X's default is an orderable SKU with 73 ports and 143 lamps on one
// 1RU face.
//
// ONE RULE, HERE. A page that wrote its own would be a second answer to the
// same question, and the two would drift the first time the library moved.
// check-contract.py fails if this device leaves the library or its default
// becomes a base, and if a page that opens on a device does not ask here.
export const FEATURED_DEVICE = 'as7726-32x';

// What a shell page hands createShell as `device`: the device its link names,
// and this one when the link names none. The shell prefers `opts.device` over
// ?device=, so the URL's is passed back in - a link that names a device still
// opens on it.
export const firstDevice = (search = location.search) =>
  new URLSearchParams(search).get('device') || FEATURED_DEVICE;

// The same answer for a page that reads the device index itself and so can
// tell a device that exists from one that does not: the export pages, whose
// picker needs a listed name. A link that names a listed device opens on it; a
// link that names none, or one the library does not have, is a first visit.
// These pages fell back to the first entry of the index, which is whatever
// sorts first: a breaker panel today, a C100G before it.
export const firstListed = (devices, search = location.search) => {
  const want = new URLSearchParams(search).get('device');
  return devices.some(d => d.name === want) ? want : FEATURED_DEVICE;
};
