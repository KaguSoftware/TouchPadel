/** Small presentational bits shared by the item list and the item form. */
import type { CSSProperties } from 'react';
import { useLocale } from '../../../lib/i18n';
import { StatusBadge, type Tone } from '../../../components/kit';
import { publicUrl } from '../../../lib/storage';
import { marginBand, marginPct } from './menuLogic';
import type { Highlight } from './useAdminMenu';

/**
 * The two highlight swatches a manager can put on a GUEST menu item. They
 * preview the guest surface, so they sample the CAFE identity rather than
 * operator chrome.
 *
 * `brown` is a stored value, not a colour: the approved 2026 Touch Cafe menu
 * has no brown in it, and packages/ui keeps `--tp-cafe-brown` only as a
 * deprecated alias onto the cafe green. That alias is emitted in the cafe theme
 * block and NOT in the operator's, so naming it here would resolve to nothing.
 * The swatch paints what the guest actually sees.
 */
export const HIGHLIGHT_COLOR: Record<Highlight, string> = {
  none: 'transparent',
  blue: 'var(--tp-brand-blue)',
  brown: 'var(--tp-brand-green)',
};

/**
 * Margin health, in the app's ONE status vocabulary.
 *
 * This was a private tone map that painted "good" in a solid --tp-accent-2 —
 * Padel Green, which already means live / ready / arrived / fresh everywhere
 * else, so a healthy margin quietly spent a word the status vocabulary needs.
 * It also had `bad` and `danger` as two names for one style. StatusBadge owns
 * the shape, the ground and the dot now, as it does for every other state in
 * the product.
 */
const BAND_TONE: Record<'good' | 'ok' | 'bad', Tone> = {
  good: 'success',
  ok: 'warn',
  bad: 'danger',
};

/** Banded margin chip; grey "No cost" when the cost is unknown. */
export function MarginChip({ price, cost }: { price: number | null; cost: number | null }) {
  const { tr } = useLocale();
  const pct = marginPct(price, cost);
  const band = marginBand(pct);
  if (band === 'noCost') return <StatusBadge size="sm" tone="neutral" dot={false} label={tr('op.menu.noCost')} />;
  return <StatusBadge size="sm" tone={BAND_TONE[band]} dot={false} label={tr('op.menu.margin', { pct: pct ?? 0 })} />;
}

export function HighlightDot({ highlight }: { highlight: Highlight }) {
  if (highlight === 'none') return null;
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-block',
        inlineSize: 'var(--tp-sp-2-5)',
        blockSize: 'var(--tp-sp-2-5)',
        borderRadius: '50%',
        background: HIGHLIGHT_COLOR[highlight],
        flexShrink: 0,
      }}
    />
  );
}

/** 40 px thumbnail or a neutral placeholder square. */
export function Thumb({ path, size = '2.5rem' }: { path: string | null; size?: string }) {
  const base: CSSProperties = {
    inlineSize: size,
    blockSize: size,
    borderRadius: 'var(--tp-radius-ctl)',
    flexShrink: 0,
    background: 'var(--tp-muted)',
    objectFit: 'cover',
  };
  if (!path) return <span aria-hidden="true" style={base} />;
  return <img src={publicUrl(path)} alt="" style={base} />;
}
