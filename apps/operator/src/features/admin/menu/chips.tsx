/** Small presentational bits shared by the item list and the item form. */
import type { CSSProperties, ReactNode } from 'react';
import { useLocale } from '../../../lib/i18n';
import { publicUrl } from '../../../lib/storage';
import { marginBand, marginPct } from './menuLogic';
import type { Highlight } from './useAdminMenu';

export const HIGHLIGHT_COLOR: Record<Highlight, string> = {
  none: 'transparent',
  blue: 'var(--tp-brand-blue, #3360AB)',
  brown: 'var(--tp-brand-brown, #603813)',
};

export function Chip({
  children,
  tone = 'neutral',
  style,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'good' | 'ok' | 'bad' | 'danger';
  style?: CSSProperties;
}) {
  const tones: Record<NonNullable<typeof tone>, CSSProperties> = {
    neutral: { background: 'var(--tp-muted)', color: 'var(--tp-muted-fg)' },
    good: { background: 'var(--tp-accent-2)', color: 'var(--tp-accent-2-contrast)' },
    ok: { background: 'var(--tp-warn-bg, #FBEFC9)', color: 'var(--tp-warn-fg, #6B4E00)' },
    bad: { background: 'var(--tp-danger)', color: 'var(--tp-danger-contrast)' },
    danger: { background: 'var(--tp-danger)', color: 'var(--tp-danger-contrast)' },
  };
  return (
    <span
      style={{
        display: 'inline-block',
        fontSize: '0.72rem',
        lineHeight: 1.4,
        paddingBlock: '0.05rem',
        paddingInline: '0.45rem',
        borderRadius: '999px',
        whiteSpace: 'nowrap',
        ...tones[tone],
        ...style,
      }}
    >
      {children}
    </span>
  );
}

/** Banded margin chip; grey "No cost" when the cost is unknown. */
export function MarginChip({ price, cost }: { price: number | null; cost: number | null }) {
  const { tr } = useLocale();
  const pct = marginPct(price, cost);
  const band = marginBand(pct);
  if (band === 'noCost') return <Chip>{tr('op.menu.noCost')}</Chip>;
  return <Chip tone={band}>{tr('op.menu.margin', { pct: pct ?? 0 })}</Chip>;
}

export function HighlightDot({ highlight }: { highlight: Highlight }) {
  if (highlight === 'none') return null;
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-block',
        inlineSize: '0.6rem',
        blockSize: '0.6rem',
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
    borderRadius: '0.35rem',
    flexShrink: 0,
    background: 'var(--tp-muted)',
    objectFit: 'cover',
  };
  if (!path) return <span aria-hidden="true" style={base} />;
  return <img src={publicUrl(path)} alt="" style={base} />;
}
