/**
 * files.ts — the owner assistant's `file_read` (0354): the words of a stored
 * file, read in windows.
 *
 * The Files page stores every document compressed (venue_files, migration
 * 0354), and beside it the words the browser pulled out of it as gzip text
 * (`<venue>/<id>.txt.gz`). The chat function downloads that object as the
 * owner, `gunzipText` unpacks it under a size cap, and `fileWindow` cuts the
 * window the model asked for into lines, which clean() lays out like any
 * other rows (and pseudonymises phone numbers and e-mail addresses in).
 *
 * Pure: no Deno, no npm. DecompressionStream and Response are web standards
 * (Deno, browsers and Node 18+ all have them).
 */

export const FILES_BUCKET = 'venue-files';
export const FILE_READ_DEFAULT_CHARS = 12_000;
export const FILE_READ_MAX_CHARS = 40_000;
/**
 * 0354 caps text_chars at 500,000; 4 MB of UTF-8 holds that even at four
 * bytes a character, plus room. A bigger stream is not one we stored.
 */
export const FILE_TEXT_MAX_BYTES = 4 * 1024 * 1024;

export class FileTextTooLarge extends Error {
  constructor() {
    super('the stored text is larger than any file the Files page keeps');
    this.name = 'FileTextTooLarge';
  }
}

/** Unzip a gzip body to text, refusing anything past `maxBytes` unpacked. */
export async function gunzipText(body: Blob | ReadableStream<Uint8Array>, maxBytes = FILE_TEXT_MAX_BYTES): Promise<string> {
  const stream = body instanceof Blob ? body.stream() : body;
  // Bytes in, bytes out. Newer lib typings give the writable side BufferSource,
  // which a Uint8Array<ArrayBufferLike> no longer satisfies, so say what it is.
  const gunzip = new DecompressionStream('gzip') as unknown as TransformStream<Uint8Array, Uint8Array>;
  const reader = stream.pipeThrough(gunzip).getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new FileTextTooLarge();
    }
    parts.push(value);
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    all.set(p, at);
    at += p.byteLength;
  }
  return new TextDecoder('utf-8').decode(all);
}

export interface FileWindow {
  /** The window's lines, blank ones dropped. */
  lines: string[];
  offset: number;
  /** Where the window ended (exclusive). */
  end: number;
  total_chars: number;
  /** The offset to ask for next, or null at the end of the text. */
  next_offset: number | null;
}

/**
 * The window [offset, offset + chars) of `text`, ended at the last line break
 * inside it when that keeps at least half the window, so a line is not cut in
 * two between reads. `chars` is clamped to 1…FILE_READ_MAX_CHARS.
 */
export function fileWindow(text: string, offset = 0, chars = FILE_READ_DEFAULT_CHARS): FileWindow {
  const total = text.length;
  const size = Math.min(Math.max(Math.trunc(chars) || FILE_READ_DEFAULT_CHARS, 1), FILE_READ_MAX_CHARS);
  const start = Math.min(Math.max(Math.trunc(offset) || 0, 0), total);
  let end = Math.min(start + size, total);
  if (end < total) {
    const nl = text.lastIndexOf('\n', end - 1);
    if (nl >= start + size / 2) end = nl + 1;
  }
  const lines = text
    .slice(start, end)
    .split('\n')
    .map((l) => l.replace(/\s+$/u, ''))
    .filter((l) => l.trim() !== '');
  return { lines, offset: start, end, total_chars: total, next_offset: end < total ? end : null };
}
