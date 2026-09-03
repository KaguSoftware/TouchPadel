/**
 * Raw ESC/POS bytes — deliberately hand-rolled (the npm escpos ecosystem is
 * unmaintained and drags in transports we don't want). Only what a receipt
 * needs: initialise, GS v 0 raster bands, feed, partial cut.
 *
 * Arabic never goes through the printer's own fonts: low-cost printers cannot
 * shape it, which is why SOW L425-433 specifies the bill "composed and sent as
 * a rendered image". Chromium does the shaping; this file just moves pixels.
 */

export const INIT = Buffer.from([0x1b, 0x40]); // ESC @

export function feed(lines: number): Buffer {
  return Buffer.from([0x1b, 0x64, Math.max(0, Math.min(255, lines))]); // ESC d n
}

/** GS V B 0 — partial cut with feed-to-cutter on most 80mm printers. */
export const CUT_PARTIAL = Buffer.from([0x1d, 0x56, 0x42, 0x00]);

/**
 * One GS v 0 raster band. `bits` is row-major, MSB-first, 1 = black,
 * `widthBytes` bytes per row, exactly `lines` rows.
 */
export function rasterBand(bits: Buffer, widthBytes: number, lines: number): Buffer {
  if (bits.length !== widthBytes * lines) {
    throw new RangeError(`raster band: expected ${widthBytes * lines} bytes, got ${bits.length}`);
  }
  const header = Buffer.from([
    0x1d,
    0x76,
    0x30,
    0x00, // GS v 0, normal density
    widthBytes & 0xff,
    (widthBytes >> 8) & 0xff,
    lines & 0xff,
    (lines >> 8) & 0xff,
  ]);
  return Buffer.concat([header, bits]);
}

/**
 * Split a full-height monochrome bitmap into ≤ maxLines bands. Printers buffer
 * a band at a time; one giant band overruns cheap firmware.
 */
export function rasterToBands(
  bits: Buffer,
  widthBytes: number,
  height: number,
  maxLines = 240,
): Buffer[] {
  const bands: Buffer[] = [];
  for (let y = 0; y < height; y += maxLines) {
    const lines = Math.min(maxLines, height - y);
    bands.push(rasterBand(bits.subarray(y * widthBytes, (y + lines) * widthBytes), widthBytes, lines));
  }
  return bands;
}

/** The complete job: init, bands, feed clear of the tear bar, cut. */
export function receiptJob(bits: Buffer, widthBytes: number, height: number): Buffer {
  return Buffer.concat([INIT, ...rasterToBands(bits, widthBytes, height), feed(4), CUT_PARTIAL]);
}
