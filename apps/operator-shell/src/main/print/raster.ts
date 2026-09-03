/**
 * BGRA → 1-bit monochrome for GS v 0. No sharp, no native deps: Chromium has
 * already anti-aliased the glyphs (Arabic shaping included), so a fixed
 * luminance threshold produces crisp text at 576 px / 203 dpi. 1 = black,
 * MSB-first, rows padded to whole bytes.
 */

export interface Monochrome {
  widthBytes: number;
  height: number;
  bits: Buffer;
}

export function bgraToMonochrome(
  bgra: Buffer,
  width: number,
  height: number,
  threshold = 160,
): Monochrome {
  const widthBytes = Math.ceil(width / 8);
  const bits = Buffer.alloc(widthBytes * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const b = bgra[i]!;
      const g = bgra[i + 1]!;
      const r = bgra[i + 2]!;
      const a = bgra[i + 3]!;
      // Transparent pixels are paper. Rec. 601 luma, integer math.
      const luma = a === 0 ? 255 : (r * 299 + g * 587 + b * 114) / 1000;
      if (luma < threshold) {
        bits[y * widthBytes + (x >> 3)]! |= 0x80 >> (x & 7);
      }
    }
  }
  return { widthBytes, height, bits };
}
