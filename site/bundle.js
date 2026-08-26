// Building the download.
//
// A zip is assembled in the browser rather than pre-built on disk, because the
// useful axes - library, vendor, device, NOS, images - multiply, and any
// pre-built set goes stale the moment the export is refreshed. Assembling from
// the file list means the download is always current and there is nothing to
// invalidate.
//
// No zip library: CompressionStream('deflate-raw') is the deflate every current
// browser already has, and the container format around it is about eighty lines.

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return bytes => {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  };
})();

async function deflate(bytes) {
  const cs = new CompressionStream('deflate-raw');
  const out = new Blob([bytes]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

// Zip stores DOS timestamps, which have two-second resolution and no timezone.
// Everything gets one stamp: the snapshot's, so two downloads of the same
// snapshot are byte-identical.
function dosTime(d) {
  return {
    time: ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() / 2)) & 0xFFFF,
    date: (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF,
  };
}

export async function makeZip(entries, stamp = new Date()) {
  const enc = new TextEncoder();
  const {time, date} = dosTime(stamp);
  const chunks = [], central = [];
  let offset = 0;

  for (const {name, bytes} of entries) {
    const nameBytes = enc.encode(name);
    const crc = CRC(bytes);
    const deflated = await deflate(bytes);
    // A file that deflates larger than it started - already-compressed PNGs do -
    // is stored rather than inflated for nothing.
    const useStore = deflated.length >= bytes.length;
    const body = useStore ? bytes : deflated;
    const method = useStore ? 0 : 8;

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0, true);
    local.setUint16(8, method, true);
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, body.length, true);
    local.setUint32(22, bytes.length, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);
    chunks.push(new Uint8Array(local.buffer), nameBytes, body);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0, true);
    cd.setUint16(10, method, true);
    cd.setUint16(12, time, true);
    cd.setUint16(14, date, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, body.length, true);
    cd.setUint32(24, bytes.length, true);
    cd.setUint16(28, nameBytes.length, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), nameBytes);

    offset += 30 + nameBytes.length + body.length;
  }

  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...chunks, ...central, new Uint8Array(end.buffer)],
                  {type: 'application/zip'});
}
