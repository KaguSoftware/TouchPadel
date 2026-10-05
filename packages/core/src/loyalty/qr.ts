// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- the apps compile this source, and only a reference carries the ambient qrcode declaration to them
/// <reference path="./qrcode-core.d.ts" />
// QR module matrix and one-path SVG geometry, shared by the operator's table cards and the
// member card on mobile and web (loyalty build contracts §3). Moved from
// apps/operator/src/features/admin/qr/qrCardGeometry.ts, which re-exports it.
//
// Imports qrcode's pure encoder, not the package entry: the entry pulls the Node renderers
// (pngjs, fs) unless the bundler honours the "browser" field, and Metro and Next would each
// have to get that right. The encoder has no I/O at all.
import { create } from 'qrcode/lib/core/qrcode';

export interface QrModules {
  size: number;
  /** Row-major, 1 = dark module. */
  data: ArrayLike<number>;
}

/** Encode text at error-correction level M and return the module matrix. */
export function qrModules(text: string): QrModules {
  const qr = create(text, { errorCorrectionLevel: 'M' });
  return { size: qr.modules.size, data: qr.modules.data };
}

/**
 * The ink a QR is drawn in: black on white, always. A brand colour once turned the table card's
 * QR pale green (1.77:1 contrast) and it stopped scanning. A QR is a machine-readable mark, not
 * a brand surface.
 */
export const QR_INK = '#000000';
export const QR_PAPER = '#FFFFFF';
/** The white margin a scanner needs around the code, in modules. */
export const QUIET_MODULES = 4;

/**
 * One <path> for the dark modules as horizontal runs, not one square per module: a printer that
 * rounds each square to its dot grid leaves hairline seams a scanner cannot read through, and the
 * path is a third of the length.
 */
export function qrPath(modules: QrModules): { d: string; size: number } {
  const { size, data } = modules;
  let d = '';
  for (let y = 0; y < size; y++) {
    let x = 0;
    while (x < size) {
      if (!data[y * size + x]) {
        x++;
        continue;
      }
      let run = 1;
      while (x + run < size && data[y * size + x + run]) run++;
      d += `M${x} ${y}h${run}v1h-${run}z`;
      x += run;
    }
  }
  return { d, size };
}
