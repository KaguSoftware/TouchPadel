/**
 * Client-side image compression → WebP via `createImageBitmap` + `<canvas>`.
 * Chromium (Electron + Chrome) encodes WebP natively, so no
 * `browser-image-compression` dependency; keep that package name in mind as
 * the fallback if a non-Chromium runtime ever appears. GIFs decode to their
 * first frame; HEIC/HEIF are NOT decodable by Chromium and reject.
 */

export const IMAGE_MIME_TYPES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/bmp',
]);
export const VIDEO_MIME_TYPES: ReadonlySet<string> = new Set(['video/mp4', 'video/webm']);

export interface CompressOptions {
  /** Longest edge after downscale (default 1200; hero uses 1600). */
  maxPx?: number;
  /** Target size; quality steps 0.85 → 0.5, then the canvas shrinks (default 512 000). */
  maxBytes?: number;
}

export const DEFAULT_MAX_PX = 1200;
export const DEFAULT_MAX_BYTES = 512_000;
const QUALITY_START = 0.85;
const QUALITY_FLOOR = 0.5;
const QUALITY_STEP = 0.1;
const SHRINK_FACTOR = 0.8;
const MAX_SHRINKS = 3;

/** Scale (w, h) to fit inside maxPx on the longest edge; never upscale. */
export function fitWithin(
  width: number,
  height: number,
  maxPx: number,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxPx) return { width, height };
  const scale = maxPx / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('webp encode failed'))),
      'image/webp',
      quality,
    );
  });
}

function draw(bitmap: ImageBitmap, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  ctx.drawImage(bitmap, 0, 0, width, height);
  return canvas;
}

/** Quality step-down loop on one canvas; returns the first blob under maxBytes (or the smallest). */
async function encodeUnder(canvas: HTMLCanvasElement, maxBytes: number): Promise<Blob> {
  let quality = QUALITY_START;
  let best = await canvasToBlob(canvas, quality);
  while (best.size > maxBytes && quality - QUALITY_STEP >= QUALITY_FLOOR - 1e-9) {
    quality = Math.round((quality - QUALITY_STEP) * 100) / 100;
    const next = await canvasToBlob(canvas, quality);
    if (next.size < best.size) best = next;
  }
  return best;
}

/**
 * Decode, orient (EXIF honoured by Chromium), downscale to `maxPx`, encode WebP
 * under `maxBytes` — quality steps first, then up to three 0.8× shrinks.
 * Rejects on undecodable input (caller shows `op.toast.invalidImage`).
 */
export async function compressToWebp(file: Blob, opts: CompressOptions = {}): Promise<Blob> {
  const maxPx = opts.maxPx ?? DEFAULT_MAX_PX;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    let { width, height } = fitWithin(bitmap.width, bitmap.height, maxPx);
    let blob = await encodeUnder(draw(bitmap, width, height), maxBytes);
    for (let shrink = 0; blob.size > maxBytes && shrink < MAX_SHRINKS; shrink++) {
      width = Math.max(1, Math.round(width * SHRINK_FACTOR));
      height = Math.max(1, Math.round(height * SHRINK_FACTOR));
      blob = await encodeUnder(draw(bitmap, width, height), maxBytes);
    }
    return blob;
  } finally {
    bitmap.close();
  }
}

export function isImageFile(file: Blob): boolean {
  return IMAGE_MIME_TYPES.has(file.type);
}

export function isVideoFile(file: Blob): boolean {
  return VIDEO_MIME_TYPES.has(file.type);
}
