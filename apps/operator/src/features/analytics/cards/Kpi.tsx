/**
 * One pulse tile: big number, optional signed delta vs the comparison window,
 * and a muted footnote. A `null` delta is never rendered as 0 % — the tile says
 * why the comparison is unavailable instead (`reason`).
 *
 * The delta is the tile's hover layer: with `compare` set it becomes a small
 * text button that opens an InfoTip with both figures and the window they are
 * measured against, so the tile itself stays one number and one signed change.
 * `tip` (an explanation of what is counted) hangs off the label the same way.
 */
import type { ReactNode } from 'react';
import { Skeleton, card } from '../../../components/ui';
import { InfoTip } from '../../../components/InfoTip';
import { useLocale } from '../../../lib/i18n';
import type { Formatters } from '../format';

export interface KpiCompare {
  /** "vs 1 – 30 Jul" */
  label: string;
  current: string;
  previous: string;
}

export function Kpi({
  label,
  value,
  delta,
  reason,
  note,
  tip,
  compare,
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
  /** STATE under the number (a sample size, an estimate note). Stays visible. */
  note?: ReactNode;
  /** EXPLANATION of what is counted. Behind the info button. */
  tip?: ReactNode;
  /** Both figures behind the delta, read on hover / focus / tap. */
  compare?: KpiCompare;
  estimated?: boolean;
  loading?: boolean;
  f: Formatters;
}) {
  const { tr } = useLocale();
  const shownDelta = unavailable ? null : delta;
  const tone =
    shownDelta == null
      ? 'var(--tp-muted-fg)'
      : shownDelta > 0
        ? 'var(--tp-accent)'
        : shownDelta < 0
          ? 'var(--tp-danger)'
          : 'var(--tp-muted-fg)';
  const deltaText = shownDelta == null ? (unavailable ? '' : (reason ?? '')) : `${f.signedPct(shownDelta)} ${vsLabel ?? ''}`;
  return (
    <div style={{ ...card, minInlineSize: 0 }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-0)', minInlineSize: 0 }}>
        <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {label}
        </span>
        {tip && <InfoTip content={tip} label={tr('ws.analytics.tips.about', { title: label })} style={{ marginBlock: '-0.4rem' }} />}
      </span>
      {loading ? (
        <Skeleton lines={1} blockSize="1.5rem" style={{ marginBlock: '0.35rem' }} />
      ) : (
        <strong style={{ display: 'block', fontSize: 'var(--tp-fs-2xl)', lineHeight: 1.3 }}>
          {estimated && !unavailable && <span style={{ color: 'var(--tp-muted-fg)', fontWeight: 400 }}>~</span>}
          {unavailable ? '—' : value}
        </strong>
      )}
      {compare && shownDelta != null ? (
        <InfoTip
          content={
            <span style={{ display: 'grid', gap: 'var(--tp-sp-0)' }}>
              <span style={{ color: 'var(--tp-muted-fg)' }}>{compare.label}</span>
              <span dir="ltr" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {tr('ws.analytics.kpi.compareValues', { previous: compare.previous, current: compare.current })}
              </span>
            </span>
          }
          label={tr('ws.analytics.kpi.compareLabel', { label })}
        >
          <button
            type="button"
            style={{ display: 'block', background: 'none', border: 0, padding: 0, margin: 0, font: 'inherit', fontSize: 'var(--tp-fs-xs)', color: tone, cursor: 'help', textAlign: 'start' }}
          >
            {deltaText}
          </button>
        </InfoTip>
      ) : (
        <span style={{ display: 'block', fontSize: 'var(--tp-fs-xs)', color: tone }}>{deltaText}</span>
      )}
      {note && <span style={{ display: 'block', fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{note}</span>}
    </div>
  );
}
