/**
 * Pieces the tournament screens share (2026-10-05 redesign): the calendar
 * tile a card and the detail banner lead with, the fill bar, and the numbered
 * medal of a leaderboard row. Colours are the operator tokens only, so blue
 * mode follows.
 */
import type { CSSProperties } from 'react';
import { formatDayNumber, formatMonthShort, formatWeekdayShort } from '@touch/i18n';
import { useLocale } from '../../lib/i18n';
import type { TourStatus } from '@touch/core/tournaments';

/** The tile's colours by status: green while it plays, muted once it is over. */
export function dateTileColors(status: TourStatus): { bg: string; fg: string } {
  if (status === 'running') return { bg: 'var(--tp-accent-2)', fg: 'var(--tp-accent-2-contrast)' };
  if (status === 'finished' || status === 'cancelled')
    return { bg: 'var(--tp-surface-3)', fg: 'var(--tp-muted-fg)' };
  return { bg: 'var(--tp-accent)', fg: 'var(--tp-accent-contrast)' };
}

export function DateTile({
  at,
  tz,
  status,
  size = 'md',
}: {
  at: string;
  tz: string;
  status: TourStatus;
  size?: 'sm' | 'md' | 'lg';
}) {
  const { locale } = useLocale();
  const c = dateTileColors(status);
  const date = at ? new Date(at) : null;
  const lg = size === 'lg';
  const sm = size === 'sm';
  return (
    <span
      aria-hidden="true"
      style={{
        flexShrink: 0,
        inlineSize: lg ? '4.5rem' : sm ? '3rem' : '4rem',
        blockSize: lg ? '5rem' : sm ? '3.375rem' : '4.5rem',
        borderRadius: 'var(--tp-radius-dialog)',
        background: c.bg,
        color: c.fg,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        lineHeight: 1.1,
      }}
    >
      {date ? (
        <>
          <span style={{ fontSize: 'var(--tp-fs-xs)', fontWeight: 700 }}>
            {formatMonthShort(date, locale, tz)}
          </span>
          <span
            style={{
              fontSize: lg ? 'var(--tp-fs-3xl)' : sm ? 'var(--tp-fs-xl)' : 'var(--tp-fs-2xl)',
              fontWeight: 800,
            }}
          >
            {formatDayNumber(date, locale, tz)}
          </span>
          <span style={{ fontSize: 'var(--tp-fs-xs)', fontWeight: 600 }}>
            {formatWeekdayShort(date, locale, tz)}
          </span>
        </>
      ) : (
        '—'
      )}
    </span>
  );
}

/**
 * A thin progress bar; `track` lets the banner draw it on the navy ground.
 * `decorative` drops the progressbar role where the figure is already text
 * beside it (inside a card's button, whose children are presentational).
 */
export function FillBar({
  percent,
  color = 'var(--tp-accent)',
  track = 'var(--tp-surface-3)',
  height = '0.5rem',
  label,
  decorative = false,
}: {
  percent: number;
  color?: string;
  track?: string;
  height?: string;
  label?: string;
  decorative?: boolean;
}) {
  const a11y = decorative
    ? { 'aria-hidden': true as const }
    : {
        role: 'progressbar',
        'aria-label': label,
        'aria-valuemin': 0,
        'aria-valuemax': 100,
        'aria-valuenow': percent,
      };
  return (
    <div
      {...a11y}
      style={{
        blockSize: height,
        borderRadius: 'var(--tp-radius-pill)',
        background: track,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          blockSize: '100%',
          inlineSize: `${percent}%`,
          background: color,
          borderRadius: 'var(--tp-radius-pill)',
        }}
      />
    </div>
  );
}

const MEDALS: CSSProperties[] = [
  { background: 'var(--tp-accent-2)', color: 'var(--tp-accent-2-contrast)' },
  { background: 'var(--tp-accent)', color: 'var(--tp-accent-contrast)' },
  { background: 'var(--tp-fg)', color: 'var(--tp-surface)' },
];

/** A rank in a circle: the top three in green, blue and ink, the rest muted. */
export function RankMedal({ rank, label }: { rank: number; label: string }) {
  const style = MEDALS[rank - 1] ?? {
    background: 'var(--tp-surface-2)',
    color: 'var(--tp-muted-fg)',
  };
  return (
    <span
      style={{
        ...style,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        inlineSize: '1.75rem',
        blockSize: '1.75rem',
        borderRadius: 'var(--tp-radius-pill)',
        fontSize: 'var(--tp-fs-sm)',
        fontWeight: 800,
        flexShrink: 0,
      }}
    >
      {label}
    </span>
  );
}
