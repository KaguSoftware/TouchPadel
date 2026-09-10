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
    const mono = bgraToMonochrome(Buffer.from([...px(100, 100, 100), ...px(200, 200, 200)]), 2, 1);
    expect(mono.bits[0]).toBe(0b10000000); // 100 < 160 ink, 200 ≥ 160 paper
  });
});

/**
 * SEC-27 / SEC-31 — the drawer-kick injection case, proved rather than assumed.
 *
 * THE FEAR. A guest or a staff member types `ESC p` (0x1B 0x70) into an order
 * note. The note reaches the ticket printer. The printer reads it as the
 * CASH-DRAWER KICK command and the till opens, silently, with no sale and no
 * audit row — a note is not supposed to be able to open the money drawer.
 *
 * WHY IT CANNOT HAPPEN HERE, and it is worth being precise about the reason:
 * this printer path never sends text at all. The receipt is composed as HTML,
 * rendered by an offscreen Chromium window and captured as a BITMAP
 * (print-receipt.ts); `receiptJob` takes pixels, not strings. Those bytes are
 * `ESC p` shaped GLYPHS, not the command.
 *
 * The checklist asked for a byte whitelist "on every text field entering the
 * ESC/POS builder". There is no such field — so the honest version of that box
 * is this: assert the byte stream is nothing but INIT, correctly FRAMED raster
 * bands, feed and cut. Anything inside a `GS v 0` frame is consumed as data by
 * the printer's own parser, however it happens to be shaped, which is why the
 * box exempts the framed payload. Anything OUTSIDE a frame would be a command,
 * and there is nothing outside the frames.
 */
describe('drawer-kick injection (SEC-27/SEC-31)', () => {
  /** Walk the job and account for every byte, or fail saying where. */
  function parseJob(job: Buffer): { framedPayloadBytes: number; trailing: number[] } {
    let i = 0;
    const expectPrefix = (buf: Buffer) => {
      expect(job.subarray(i, i + buf.length)).toEqual(buf);
      i += buf.length;
    };
    expectPrefix(INIT);

    let framedPayloadBytes = 0;
    // GS v 0 : 0x1D 0x76 0x30 m xL xH yL yH, then exactly xL..xH * yL..yH bytes.
    while (job[i] === 0x1d && job[i + 1] === 0x76 && job[i + 2] === 0x30) {
      const widthBytes = job[i + 4] | (job[i + 5] << 8);
      const lines = job[i + 6] | (job[i + 7] << 8);
      i += 8;
      const len = widthBytes * lines;
      expect(i + len).toBeLessThanOrEqual(job.length);
      framedPayloadBytes += len;
      i += len; // consumed as DATA by the printer, whatever it contains
    }

    const trailing = [...job.subarray(i)];
    return { framedPayloadBytes, trailing };
  }

  it('a bitmap full of ESC p bytes still produces only framed raster + feed + cut', () => {
    // Every byte of the "image" is the drawer-kick sequence. If any of it could
    // escape its frame, this is the job that would do it.
    const widthBytes = 2;
    const lines = 8;
    const bits = Buffer.alloc(widthBytes * lines);
    for (let n = 0; n < bits.length; n += 2) {
      bits[n] = 0x1b;
      bits[n + 1] = 0x70;
    }

    const job = receiptJob(bits, widthBytes, lines);
    const { framedPayloadBytes, trailing } = parseJob(job);

    // All 16 hostile bytes are inside the frame, where the printer reads them
    // as pixels because its own parser counts them.
    expect(framedPayloadBytes).toBe(bits.length);

    // Nothing after the frames but the two sequences we chose.
    expect(Buffer.from(trailing)).toEqual(Buffer.concat([feed(4), CUT_PARTIAL]));
  });

  it('no ESC p appears anywhere OUTSIDE a raster frame', () => {
    const widthBytes = 4;
    const lines = 300; // forces multiple bands, so there are frame boundaries
    const bits = Buffer.alloc(widthBytes * lines, 0x1b);

    const job = receiptJob(bits, widthBytes, lines);

    // Rebuild the stream with every framed payload blanked out; whatever is
    // left is what the printer will interpret as commands.
    const outside: number[] = [];
    let i = INIT.length;
    outside.push(...INIT);
    while (job[i] === 0x1d && job[i + 1] === 0x76 && job[i + 2] === 0x30) {
      const w = job[i + 4] | (job[i + 5] << 8);
      const h = job[i + 6] | (job[i + 7] << 8);
      outside.push(...job.subarray(i, i + 8));
      i += 8 + w * h;
    }
    outside.push(...job.subarray(i));

    const cmdStream = Buffer.from(outside);
    // ESC p — the kick — must not occur in the command stream at all.
    expect(cmdStream.includes(Buffer.from([0x1b, 0x70]))).toBe(false);
    // The only ESC we ever emit are ESC @ (init) and ESC d (feed).
    for (let k = 0; k < cmdStream.length - 1; k++) {
      if (cmdStream[k] === 0x1b) {
        expect([0x40, 0x64]).toContain(cmdStream[k + 1]);
      }
    }
  });
});
