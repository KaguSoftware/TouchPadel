/**
 * React SVG port of `renderCard()` in packages/db/scripts/qr-artwork.mjs.
 * Type and panels come from @touch/ui `cafePalette`; the Arabic footer comes
 * from the catalog instead of numeric entities.
 *
 * The QR itself does NOT come from the palette — it is black on white, always.
 * See QR_INK in qrCardGeometry for why that had to be said out loud.
 */
import { useMemo } from 'react';
import { cafePalette, latinDisplayStack } from '@touch/ui';
import { useLocale } from '../../../lib/i18n';
import { QR_INK, QR_PAPER, cardLayout, qrModules, qrPath } from './qrCardGeometry';

const BLUE = cafePalette['--tp-accent'];
/**
 * The ink for everything on the card that is WORDS.
 *
 * This was `cafePalette['--tp-accent-2']`, named BROWN after the token's value
 * when the card was written. The cafe palette was later corrected to the brand
 * deck and --tp-accent-2 became #A5D06F, the brand green — so the footer that
 * tells the guest what to do, and the "TABLE / طاولة" label above the number,
 * have been printing at 1.77:1 on white. --tp-fg is the cafe's body ink and
 * gives 14.32:1. See QR_INK in qrCardGeometry for the same drift on the code
 * itself, which is the half that stopped scanning.
 */
const INK = cafePalette['--tp-fg'];
const PANEL_BG = cafePalette['--tp-surface'];
const HAIRLINE = cafePalette['--tp-border'];
const WHITE = cafePalette['--tp-brand-white'];
/** 4.82:1. The host line used to be drawn in the hairline colour: 1.20:1. */
const FAINT = cafePalette['--tp-muted-fg'];
// This card is SVG inside the live document, not a standalone file, so the faces
// ThemeProvider registers apply to the <text> nodes and the A6 print goes out with
// them. That is the one difference from the generator this is a port of:
// packages/db/scripts/qr-artwork.mjs writes .svg files a print shop opens on a
// machine that has never heard of our fonts, so it has to embed them as base64.
// The tail matters anyway — it covers the frame before the face lands and the
// Arabic footer, which is why it is the display token and not a bare family.
const SANS = latinDisplayStack;

/**
 * SWAP POINT: replace this text wordmark with the licensed Touch Cafe logo
 * (an inline <path>/<image> group fitting the 400×88 header band) once the
 * brand assets land. Keep the same anchor so the card layout is unchanged.
 */
export function TouchCafeWordmark() {
  return (
    <text
      x="210"
      y="55"
      textAnchor="middle"
      fill={WHITE}
      fontFamily={SANS}
      fontSize="30"
      fontWeight="700"
      letterSpacing="6"
    >
      TOUCH CAFE
    </text>
  );
}

export function QrCard({
  tableNumber,
  url,
  style,
}: {
  tableNumber: string;
  /** Full guest URL (`${site}/t/${token}`). */
  url: string;
  style?: React.CSSProperties;
}) {
  const { tr } = useLocale();
  const layout = cardLayout(tableNumber);
  const { d, size } = useMemo(() => qrPath(qrModules(url)), [url]);
  const scale = layout.scaleFor(size);
  const { qrX, qrY, qrBox, quiet } = layout;
  const host = useMemo(() => {
    try {
      return new URL(url).host;
    } catch {
      return '';
    }
  }, [url]);

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={layout.viewBox}
      role="img"
      aria-label={`${tr('op.qr.tableWord')} ${tableNumber}`}
      style={{ display: 'block', inlineSize: '100%', blockSize: 'auto', ...style }}
    >
      <rect width={layout.width} height={layout.height} fill={PANEL_BG} />
      <rect x="10" y="10" width="400" height="572" rx="18" fill={WHITE} stroke={HAIRLINE} strokeWidth="2" />

      {/* header band */}
      <path d="M10 28a18 18 0 0 1 18-18h364a18 18 0 0 1 18 18v70H10z" fill={BLUE} />
      <TouchCafeWordmark />
      <text x="210" y="86" textAnchor="middle" fill={WHITE} fontFamily={SANS} fontSize="17" opacity="0.9">
        {tr('op.qr.brandLine')}
      </text>

      {/* table number, huge */}
      <text
        x="210"
        y="136"
        textAnchor="middle"
        fill={INK}
        fontFamily={SANS}
        fontSize="20"
        fontWeight="600"
        letterSpacing="3"
      >
        TABLE طاولة
      </text>
      <text
        x="210"
        y="234"
        textAnchor="middle"
        fill={BLUE}
        fontFamily={SANS}
        fontSize={layout.numSize}
        fontWeight="800"
      >
        {tableNumber}
      </text>

      {/*
        QR. The plate is drawn in QR_PAPER, not the card's WHITE token, and the
        modules in QR_INK — the code is a machine-readable mark and does not
        take brand colour (see qrCardGeometry). No stroke on the plate either:
        a 2px rule 10 units off the quiet zone is close enough to read as a
        module edge to some decoders, and the quiet zone is what the plate is
        for.
      */}
      <rect x={qrX - 12} y={qrY - 12} width={qrBox + 24} height={qrBox + 24} rx="12" fill={QR_PAPER} />
      <g transform={`translate(${qrX + quiet * scale} ${qrY + quiet * scale}) scale(${scale})`}>
        <path d={d} fill={QR_INK} shapeRendering="crispEdges" />
      </g>

      {/* bilingual footer */}
      <text
        x="210"
        y={qrY + qrBox + 44}
        textAnchor="middle"
        fill={INK}
        fontFamily={SANS}
        fontSize="19"
        fontWeight="600"
      >
        Scan to see the menu &amp; order
      </text>
      <text
        x="210"
        y={qrY + qrBox + 72}
        textAnchor="middle"
        fill={INK}
        fontFamily={SANS}
        fontSize="19"
        fontWeight="600"
        direction="rtl"
        lang="ar"
      >
        امسح الرمز لعرض القائمة والطلب
      </text>
      <text x="210" y="574" textAnchor="middle" fill={FAINT} fontFamily={SANS} fontSize="10">
        {host}
      </text>
    </svg>
  );
}
