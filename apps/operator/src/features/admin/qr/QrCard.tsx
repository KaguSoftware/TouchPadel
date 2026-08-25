/**
 * React SVG port of `renderCard()` in packages/db/scripts/qr-artwork.mjs.
 * Palette from @touch/ui `cafePalette` (blue / brown / warm surface); the
 * Arabic footer comes from the catalog instead of numeric entities.
 */
import { useMemo } from 'react';
import { cafePalette } from '@touch/ui';
import { useLocale } from '../../../lib/i18n';
import { cardLayout, qrModules, qrPath } from './qrCardGeometry';

const BLUE = cafePalette['--tp-accent'];
const BROWN = cafePalette['--tp-accent-2'];
const WARM_BG = cafePalette['--tp-surface'];
const WARM_BORDER = cafePalette['--tp-border'];
const WHITE = cafePalette['--tp-brand-white'];
// Brand faces (Next Art / Frutiger LT Arabic) are not in hand yet — generic stack.
const SANS = "'Helvetica Neue', Arial, sans-serif";

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
      <rect width={layout.width} height={layout.height} fill={WARM_BG} />
      <rect x="10" y="10" width="400" height="572" rx="18" fill={WHITE} stroke={WARM_BORDER} strokeWidth="2" />

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
        fill={BROWN}
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

      {/* QR (quiet zone is the surrounding white) */}
      <rect
        x={qrX - 10}
        y={qrY - 10}
        width={qrBox + 20}
        height={qrBox + 20}
        rx="12"
        fill={WHITE}
        stroke={WARM_BORDER}
        strokeWidth="2"
      />
      <g transform={`translate(${qrX + quiet * scale} ${qrY + quiet * scale}) scale(${scale})`}>
        <path d={d} fill={BROWN} shapeRendering="crispEdges" />
      </g>

      {/* bilingual footer */}
      <text
        x="210"
        y={qrY + qrBox + 44}
        textAnchor="middle"
        fill={BROWN}
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
        fill={BROWN}
        fontFamily={SANS}
        fontSize="19"
        fontWeight="600"
        direction="rtl"
        lang="ar"
      >
        امسح الرمز لعرض القائمة والطلب
      </text>
      <text x="210" y="574" textAnchor="middle" fill={WARM_BORDER} fontFamily={SANS} fontSize="10">
        {host}
      </text>
    </svg>
  );
}
