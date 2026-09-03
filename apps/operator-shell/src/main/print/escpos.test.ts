import { describe, expect, it } from 'vitest';
import { CUT_PARTIAL, INIT, feed, rasterBand, rasterToBands, receiptJob } from './escpos';
import { bgraToMonochrome } from './raster';

// Golden bytes: an ESC/POS stream is write-only hardware I/O — the only way to
// test it without a printer is to pin the exact bytes the pipeline emits.

describe('escpos bytes', () => {
  it('pins the control sequences', () => {
    expect([...INIT]).toEqual([0x1b, 0x40]);
    expect([...feed(4)]).toEqual([0x1b, 0x64, 4]);
    expect([...CUT_PARTIAL]).toEqual([0x1d, 0x56, 0x42, 0x00]);
  });

  it('builds a GS v 0 band with little-endian dimensions', () => {
    // 2 bytes wide (16 dots), 3 lines.
    const bits = Buffer.from([0b10000001, 0xff, 0x00, 0x0f, 0xaa, 0x55]);
    const band = rasterBand(bits, 2, 3);
    expect([...band.subarray(0, 8)]).toEqual([0x1d, 0x76, 0x30, 0x00, 2, 0, 3, 0]);
    expect(band.subarray(8)).toEqual(bits);
  });

  it('refuses a band whose data does not match its dimensions', () => {
    expect(() => rasterBand(Buffer.alloc(5), 2, 3)).toThrow(/expected 6/);
  });

  it('splits tall bitmaps into ≤ maxLines bands that reassemble exactly', () => {
    const widthBytes = 4;
    const height = 500;
    const bits = Buffer.alloc(widthBytes * height, 0x3c);
    const bands = rasterToBands(bits, widthBytes, height, 240);
    expect(bands).toHaveLength(3); // 240 + 240 + 20
    const heights = bands.map((b) => b[6]! | (b[7]! << 8));
    expect(heights).toEqual([240, 240, 20]);
    const reassembled = Buffer.concat(bands.map((b) => b.subarray(8)));
    expect(reassembled).toEqual(bits);
  });

  it('receiptJob = init, bands, feed, cut — in that order', () => {
    const job = receiptJob(Buffer.alloc(2), 1, 2);
    expect([...job.subarray(0, 2)]).toEqual([...INIT]);
    expect([...job.subarray(-3)]).toEqual([0x56, 0x42, 0x00]);
  });
});

describe('bgraToMonochrome', () => {
  function px(r: number, g: number, b: number, a = 255): number[] {
    return [b, g, r, a]; // BGRA
  }

  it('thresholds ink to 1-bits, MSB first, and treats transparency as paper', () => {
    // 3px wide, 1 row: black, white, transparent.
    const bgra = Buffer.from([...px(0, 0, 0), ...px(255, 255, 255), ...px(0, 0, 0, 0)]);
    const mono = bgraToMonochrome(bgra, 3, 1);
    expect(mono.widthBytes).toBe(1);
    expect(mono.bits[0]).toBe(0b10000000);
  });

  it('pads rows to whole bytes and keeps rows independent', () => {
    // 9px wide → 2 bytes/row; 2 rows, second row all black.
    const white = Array.from({ length: 9 }, () => px(255, 255, 255)).flat();
    const black = Array.from({ length: 9 }, () => px(0, 0, 0)).flat();
    const mono = bgraToMonochrome(Buffer.from([...white, ...black]), 9, 2);
    expect(mono.widthBytes).toBe(2);
    expect([...mono.bits]).toEqual([0x00, 0x00, 0xff, 0b10000000]);
  });

  it('anti-aliased grey lands by luminance against the threshold', () => {
    const mono = bgraToMonochrome(
      Buffer.from([...px(100, 100, 100), ...px(200, 200, 200)]),
      2,
      1,
    );
    expect(mono.bits[0]).toBe(0b10000000); // 100 < 160 ink, 200 ≥ 160 paper
  });
});
