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

/**
 * The ink the QR is printed in — and it is BLACK, not a brand colour.
 *
 * The card used to draw its modules in `cafePalette['--tp-accent-2']`. That
 * token held the cafe brown when this card was written; the cafe palette was
 * later corrected to the brand deck and --tp-accent-2 became #A5D06F, the
 * brand GREEN. Nothing pointed at the card, so the QR quietly became pale
 * green on white — 1.77:1 contrast, against the ~3:1 a scanner needs and the
 * 21:1 black gives. On a monochrome printer it is worse than the number
 * suggests: a mid-tone green cannot be printed as ink coverage, so the head
 * halftones it into a dotted grey mesh and the modules stop having edges.
 *
 * A QR is a machine-readable mark, not a brand surface. It is black, on white,
 * with a white quiet zone, on every card. The brand lives in the header band,
 * the table number and the type around it.
 */
export const QR_INK = '#000000';
export const QR_PAPER = '#FFFFFF';

/**
 * One <path> for the dark modules, as horizontal RUNS rather than one square
 * per module.
 *
 * It used to emit `M{x} {y}h1v1h-1z` per dark module. Same shape on screen,
 * but on paper each of those ~1500 squares is an independent fill edge, and a
 * printer that rounds edges to its own dot grid leaves hairline white seams
 * down the middle of what the scanner has to read as one solid block. Merging
 * each row's consecutive dark modules into a single rect removes every
 * interior vertical edge and cuts the path to roughly a third of its length,
 * which is also the difference between a print spooler that copes and one
 * that stalls on a sheet of 24 cards.
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
