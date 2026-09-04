/** Small shared style atoms for the till modules. Logical properties only. */
import type { CSSProperties } from 'react';

export const sectionTitle: CSSProperties = {
  fontSize: 'var(--tp-fs-xs)',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: 'var(--tp-muted-fg)',
};

export const kvRow: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  gap: '0.5rem',
  paddingBlock: '0.15rem',
};

export const numeric: CSSProperties = {
  fontVariantNumeric: 'tabular-nums',
  fontFamily: 'var(--tp-font-numeric)',
};

export const muted: CSSProperties = { color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' };

/** 44px minimum touch target on the till (DESIGN.md density). */
export const touchTarget: CSSProperties = { minBlockSize: 'var(--tp-touch)', minInlineSize: 'var(--tp-touch)' };
