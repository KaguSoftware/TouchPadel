/**
 * Just enough ZIP to read the text out of Office and OpenDocument files
 * (.docx, .xlsx, .pptx, .odt, .ods, .odp are ZIP folders of XML). Reads the
 * central directory, then inflates one named entry with the standard
 * DecompressionStream('deflate-raw'). Stored (0) and deflate (8) entries only;
 * no ZIP64, no encryption: anything else answers null and the file is kept
 * without text, never refused.
 */

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;
/** No entry we read is bigger than this unpacked (a 50 MB file's XML). */
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  localOffset: number;
}

export function listZip(buf: Uint8Array): ZipEntry[] | null {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // The end record sits in the last 22 bytes plus at most a 64 KB comment.
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  const entries: ZipEntry[] = [];
  const names = new TextDecoder('utf-8');
  for (let n = 0; n < count; n++) {
    if (at + 46 > buf.byteLength || view.getUint32(at, true) !== CENTRAL_SIG) return null;
    const method = view.getUint16(at + 10, true);
    const compressedSize = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLen = view.getUint16(at + 28, true);
    const extraLen = view.getUint16(at + 30, true);
    const commentLen = view.getUint16(at + 32, true);
    const localOffset = view.getUint32(at + 42, true);
    const name = names.decode(buf.subarray(at + 46, at + 46 + nameLen));
    entries.push({ name, method, compressedSize, size, localOffset });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** One entry's bytes, or null when it is missing or in a form we do not read. */
export async function readZipEntry(buf: Uint8Array, entry: ZipEntry): Promise<Uint8Array | null> {
  if (entry.size > MAX_ENTRY_BYTES) return null;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const at = entry.localOffset;
  if (at + 30 > buf.byteLength || view.getUint32(at, true) !== LOCAL_SIG) return null;
  const start = at + 30 + view.getUint16(at + 26, true) + view.getUint16(at + 28, true);
  const data = buf.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return data;
  if (entry.method !== 8) return null;
  const stream = new Blob([new Uint8Array(data)]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The named entries as text, in the order asked; a missing one is skipped. */
export async function readZipTexts(buf: Uint8Array, wanted: (name: string) => boolean): Promise<{ name: string; text: string }[] | null> {
  const entries = listZip(buf);
  if (!entries) return null;
  const out: { name: string; text: string }[] = [];
  const decoder = new TextDecoder('utf-8');
  for (const e of entries.filter((x) => wanted(x.name))) {
    const bytes = await readZipEntry(buf, e);
    if (bytes) out.push({ name: e.name, text: decoder.decode(bytes) });
  }
  return out;
}
