/**
 * Compressed first (Majed 2026-10-20: "make sure that any file touching the
 * database is compressed first"). Every byte the Files page stores is packed
 * here, in the browser, before the upload starts:
 *
 *   * a photo (JPEG, PNG, WebP, BMP) is redrawn as WebP at most PHOTO_MAX_EDGE
 *     on its long side; that is `webp`, and the download is the WebP;
 *   * everything else, and a photo the redraw does not make smaller, is
 *     gzipped; that is `gzip`, and the download unzips it back to the exact
 *     bytes that were picked;
 *   * the words pulled out of a document (extract.ts) are gzipped too.
 *
 * The venue-files bucket admits only application/gzip and image/webp (0354),
 * so an uncompressed object is refused by storage as well as by this file.
 * CompressionStream and DecompressionStream are web standards (Chromium,
 * Electron, Node 18+), so nothing here needs a library.
 */

export type Encoding = 'gzip' | 'webp';

/** What one picked file may weigh before compression (0354 venue_files_size_chk). */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
/** The bucket's own limit per object (0354). */
export const MAX_STORED_BYTES = 50 * 1024 * 1024;

export const PHOTO_MAX_EDGE = 2560;
export const PHOTO_QUALITY = 0.82;
/** Photos the browser can draw. GIF is left out: a redraw would lose its frames. */
const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/bmp']);

export const STORED_TYPES: Readonly<Record<Encoding, string>> = {
  gzip: 'application/gzip',
  webp: 'image/webp',
};

export interface Compressed {
  blob: Blob;
  encoding: Encoding;
}

export function isPhoto(type: string): boolean {
  return PHOTO_TYPES.has(type.toLowerCase());
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<ArrayBuffer> {
  return new Response(stream).arrayBuffer();
}

export async function gzip(data: Blob): Promise<Blob> {
  const packed = await readAll(data.stream().pipeThrough(new CompressionStream('gzip')));
  return new Blob([packed], { type: STORED_TYPES.gzip });
}

/** Unzip a stored `gzip` object back to the original bytes, typed `type`. */
export async function gunzip(data: Blob, type: string): Promise<Blob> {
  const raw = await readAll(data.stream().pipeThrough(new DecompressionStream('gzip')));
  return new Blob([raw], { type });
}

export function gzipText(text: string): Promise<Blob> {
  return gzip(new Blob([text], { type: 'text/plain;charset=utf-8' }));
}

/** The longest edge at most `max`, aspect kept, never upscaled. */
export function fitWithin(width: number, height: number, max = PHOTO_MAX_EDGE): { width: number; height: number } {
  const long = Math.max(width, height);
  if (long <= max || long === 0) return { width, height };
  const k = max / long;
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

/** Redraw a photo as WebP; null when this browser cannot (or would not write WebP). */
export async function redrawAsWebp(file: Blob): Promise<Blob | null> {
  if (typeof createImageBitmap !== 'function') return null;
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, STORED_TYPES.webp, PHOTO_QUALITY));
    // A browser that cannot write WebP hands back a PNG: not what we store.
    return blob && blob.type === STORED_TYPES.webp ? blob : null;
  } finally {
    bitmap.close();
  }
}

/**
 * Pack one picked file for storage. `redraw` is injectable for tests (node has
 * no canvas).
 */
export async function compressFile(file: Blob, redraw: (f: Blob) => Promise<Blob | null> = redrawAsWebp): Promise<Compressed> {
  if (isPhoto(file.type)) {
    const webp = await redraw(file).catch(() => null);
    if (webp && webp.size < file.size) return { blob: webp, encoding: 'webp' };
  }
  return { blob: await gzip(file), encoding: 'gzip' };
}

/** The name a download is saved under: a redrawn photo is a .webp now. */
export function downloadName(name: string, encoding: Encoding): string {
  if (encoding !== 'webp') return name;
  const base = name.replace(/\.[^./\\]+$/, '');
  return `${base || 'photo'}.webp`;
}

/** The stored object back as the file to save. */
export async function restoreFile(stored: Blob, encoding: Encoding, mime: string): Promise<Blob> {
  return encoding === 'gzip' ? gunzip(stored, mime) : new Blob([stored], { type: STORED_TYPES.webp });
}
