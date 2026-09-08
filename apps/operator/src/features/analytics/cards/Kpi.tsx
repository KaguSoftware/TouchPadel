/**
 * One pulse tile: big number, optional signed delta vs the comparison window,
 * and a muted footnote. A `null` delta is never rendered as 0 % — the tile says
 * why the comparison is unavailable instead (`reason`).
 */
import type { ReactNode } from 'react';
import { Skeleton, card } from '../../../components/ui';
import type { Formatters } from '../format';

export function Kpi({
  label,
  value,
  delta,
  reason,
  note,
  estimated,
  loading,
  unavailable,
  vsLabel,
  f,
}: {
  /** The query behind this tile failed — show a dash, never a misleading 0. */
  unavailable?: boolean;
  label: string;
  value: string;
  delta?: number | null;
  /** "vs 1 – 30 Jul" — precomputed by the page so every tile says the same thing. */
  vsLabel?: string;
  /** Shown in place of the delta when it is null (muted comparison, no baseline). */
  reason?: string;
  note?: ReactNode;
  estimated?: boolean;
  loading?: boolean;
  f: Formatters;
}) {
  const shownDelta = unavailable ? null : delta;
  const tone =
    shownDelta == null
      ? 'var(--tp-muted-fg)'
      : shownDelta > 0
        ? 'var(--tp-accent)'
        : shownDelta < 0
          ? 'var(--tp-danger)'
          : 'var(--tp-muted-fg)';
  return (
    <div style={{ ...card, minInlineSize: 0 }}>
      <span style={{ display: 'block', fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {label}
      </span>
      {loading ? (
        <Skeleton lines={1} blockSize="1.5rem" style={{ marginBlock: '0.35rem' }} />
      ) : (
        <strong style={{ display: 'block', fontSize: 'var(--tp-fs-2xl)', lineHeight: 1.3 }}>
          {estimated && !unavailable && <span style={{ color: 'var(--tp-muted-fg)', fontWeight: 400 }}>~</span>}
          {unavailable ? '—' : value}
        </strong>
      )}
      <span style={{ display: 'block', fontSize: 'var(--tp-fs-xs)', color: tone }}>
        {shownDelta == null ? (unavailable ? '' : (reason ?? '')) : `${f.signedPct(shownDelta)} ${vsLabel ?? ''}`}
      </span>
      {note && <span style={{ display: 'block', fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{note}</span>}
    </div>
  );
}
