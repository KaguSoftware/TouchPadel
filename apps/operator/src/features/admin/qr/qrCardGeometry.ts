/**
 * Pure geometry + QR path for the A6 table card. Port of
 * packages/db/scripts/qr-artwork.mjs (`qrPath`, `renderCard` layout) so the
 * printed card from the operator app matches the script's output 1:1.
 */
import QRCode from 'qrcode';

export interface QrModules {
  size: number;
  /** Row-major, 1 = dark module. */
  data: ArrayLike<number>;
}

/** Encode a URL at error-correction level M and return the module matrix. */
export function qrModules(url: string): QrModules {
  const qr = QRCode.create(url, { errorCorrectionLevel: 'M' });
  return { size: qr.modules.size, data: qr.modules.data };
}

/** One <path> of 1-unit squares for the dark modules (qr-artwork.mjs lines 91–101). */
export function qrPath(modules: QrModules): { d: string; size: number } {
  const { size, data } = modules;
  let d = '';
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (data[y * size + x]) d += `M${x} ${y}h1v1h-1z`;
    }
  }
  return { d, size };
}

/** A6 portrait, 105 × 148 mm at 4 SVG units per mm. */
export const CARD_WIDTH = 420;
export const CARD_HEIGHT = 592;
export const QR_BOX = 224; // ~56 mm printed — comfortable phone-scan size
export const QR_X = (CARD_WIDTH - QR_BOX) / 2; // 98
export const QR_Y = 258;
export const QUIET_MODULES = 4;

export interface CardLayout {
  viewBox: string;
  width: number;
  height: number;
  qrBox: number;
  qrX: number;
  qrY: number;
  quiet: number;
  /** Font size of the huge table number (96 / 72 / 52 by length). */
  numSize: number;
  /** Modules → SVG units for a QR of `size` modules incl. the quiet zone. */
  scaleFor: (size: number) => number;
}

export function numberSize(tableNumber: string): number {
  const n = tableNumber.length;
  return n <= 2 ? 96 : n <= 4 ? 72 : 52;
}

export function cardLayout(tableNumber: string): CardLayout {
  return {
    viewBox: `0 0 ${CARD_WIDTH} ${CARD_HEIGHT}`,
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    qrBox: QR_BOX,
    qrX: QR_X,
    qrY: QR_Y,
    quiet: QUIET_MODULES,
    numSize: numberSize(tableNumber),
    scaleFor: (size) => QR_BOX / (size + QUIET_MODULES * 2),
  };
}

/** Guest URL printed into the card; `null` when the site origin is not configured. */
export function guestTableUrl(siteUrl: string | undefined, token: string): string | null {
  const origin = siteUrl?.trim().replace(/\/+$/, '');
  if (!origin) return null;
  return `${origin}/t/${token}`;
}
