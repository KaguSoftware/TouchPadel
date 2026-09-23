/**
 * A minimal ZIP writer, so an export made of several tables can be several
 * files instead of several tables crammed into one sheet.
 *
 * A sectioned CSV — a title line, a header row, rows, a blank line, another
 * header row — is not a CSV. Every spreadsheet reads the first header row and
 * then tries to fit every later section into those columns, which is where
 * the ragged, unreadable sheets came from. One table per file, zipped, gives
 * each table its own uniform header and its own sheet when opened.
 *
 * Entries are STORED (no compression). A CSV compresses well, but deflate
 * would mean shipping an implementation of it; stored entries are read by
 * Explorer, Finder, Windows, macOS, Excel and every unzip tool there is, and
 * an export is a handful of files a manager opens once.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** DOS date/time, the only clock a ZIP entry has. */
function dosStamp(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2) & 0x1f),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export interface ZipEntry {
  /** Path inside the archive, e.g. `2-figures.csv`. */
  name: string;
  /** The file's text. */
  text: string;
}

/** The entries as one `application/zip` blob. */
export function zipBlob(entries: readonly ZipEntry[], now: Date = new Date()): Blob {
  const encoder = new TextEncoder();
  const { time, date } = dosStamp(now);
  const locals: BlobPart[] = [];
  const central: BlobPart[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const data = encoder.encode(entry.text);
    const crc = crc32(data);

    // Bit 11 marks the name as UTF-8 — an Arabic section title survives it.
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); // version needed
    local.setUint16(6, 0x0800, true); // flags: UTF-8 name
    local.setUint16(8, 0, true); // method: stored
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true); // extra field length
    locals.push(local.buffer, name, data);

    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true);
    dir.setUint16(4, 20, true); // version made by
    dir.setUint16(6, 20, true); // version needed
    dir.setUint16(8, 0x0800, true);
    dir.setUint16(10, 0, true);
    dir.setUint16(12, time, true);
    dir.setUint16(14, date, true);
    dir.setUint32(16, crc, true);
    dir.setUint32(20, data.length, true);
    dir.setUint32(24, data.length, true);
    dir.setUint16(28, name.length, true);
    dir.setUint16(30, 0, true); // extra
    dir.setUint16(32, 0, true); // comment
    dir.setUint16(34, 0, true); // disk
    dir.setUint16(36, 0, true); // internal attrs
    dir.setUint32(38, 0, true); // external attrs
    dir.setUint32(42, offset, true);
    central.push(dir.buffer, name);

    offset += 30 + name.length + data.length;
  }

  const centralSize = central.reduce((n, part) => n + (part instanceof ArrayBuffer ? part.byteLength : (part as Uint8Array).length), 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(4, 0, true); // this disk
  end.setUint16(6, 0, true); // disk with central dir
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  end.setUint16(20, 0, true); // comment length

  return new Blob([...locals, ...central, end.buffer], { type: 'application/zip' });
}
