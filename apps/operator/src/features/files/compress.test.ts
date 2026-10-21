import { describe, expect, it } from 'vitest';
import { gunzipSync } from 'node:zlib';
import { compressFile, downloadName, fitWithin, gunzip, gzip, gzipText, isPhoto, restoreFile, STORED_TYPES } from './compress';

// Compressed first (0354): nothing leaves the browser as it was picked.

const bytes = async (b: Blob) => new Uint8Array(await b.arrayBuffer());

describe('gzip', () => {
  it('packs to application/gzip and unpacks to the exact bytes, any type', async () => {
    const original = new Blob(['%PDF-1.7 '.repeat(500)], { type: 'application/pdf' });
    const packed = await gzip(original);
    expect(packed.type).toBe(STORED_TYPES.gzip);
    expect(packed.size).toBeLessThan(original.size / 10);
    // A standard gzip stream: node's zlib reads it.
    expect(Buffer.from(gunzipSync(await bytes(packed))).toString()).toBe('%PDF-1.7 '.repeat(500));
    const back = await gunzip(packed, 'application/pdf');
    expect(back.type).toBe('application/pdf');
    expect(await bytes(back)).toEqual(await bytes(original));
  });

  it('packs text as UTF-8, Arabic intact', async () => {
    const packed = await gzipText('عقد توريد\nTerm 12 months');
    expect(Buffer.from(gunzipSync(await bytes(packed))).toString('utf8')).toBe('عقد توريد\nTerm 12 months');
  });
});

describe('compressFile', () => {
  const photo = new Blob([new Uint8Array(4000)], { type: 'image/jpeg' });

  it('keeps a photo as WebP when the redraw is smaller', async () => {
    const webp = new Blob([new Uint8Array(900)], { type: 'image/webp' });
    const out = await compressFile(photo, async () => webp);
    expect(out).toEqual({ blob: webp, encoding: 'webp' });
  });

  it('gzips a photo the redraw does not shrink, or cannot draw', async () => {
    const bigger = new Blob([new Uint8Array(9000)], { type: 'image/webp' });
    expect((await compressFile(photo, async () => bigger)).encoding).toBe('gzip');
    expect((await compressFile(photo, async () => null)).encoding).toBe('gzip');
    expect((await compressFile(photo, async () => Promise.reject(new Error('decode')))).encoding).toBe('gzip');
  });

  it('gzips everything that is not a photo, without trying to draw it', async () => {
    let drew = false;
    const draw = async () => {
      drew = true;
      return null;
    };
    for (const type of ['application/pdf', 'image/gif', 'text/csv', '']) {
      const out = await compressFile(new Blob(['abc'], { type }), draw);
      expect(out.encoding).toBe('gzip');
      expect(out.blob.type).toBe(STORED_TYPES.gzip);
    }
    expect(drew).toBe(false);
  });

  it('knows which types it redraws', () => {
    expect(isPhoto('image/PNG')).toBe(true);
    expect(isPhoto('image/gif')).toBe(false);
    expect(isPhoto('image/heic')).toBe(false);
  });
});

describe('sizes and names', () => {
  it('fits the long edge within the cap, never upscaling', () => {
    expect(fitWithin(5120, 2880)).toEqual({ width: 2560, height: 1440 });
    expect(fitWithin(1000, 4000)).toEqual({ width: 640, height: 2560 });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it('names a redrawn photo .webp and leaves a zipped file its name', () => {
    expect(downloadName('Licence scan.JPG', 'webp')).toBe('Licence scan.webp');
    expect(downloadName('.jpg', 'webp')).toBe('photo.webp');
    expect(downloadName('Contract.pdf', 'gzip')).toBe('Contract.pdf');
  });

  it('restores a WebP as it is', async () => {
    const webp = new Blob([new Uint8Array([1, 2, 3])]);
    const out = await restoreFile(webp, 'webp', 'image/jpeg');
    expect(out.type).toBe('image/webp');
    expect(await bytes(out)).toEqual(new Uint8Array([1, 2, 3]));
  });
});
