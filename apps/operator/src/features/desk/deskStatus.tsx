/**
 * The court desk's ONE status vocabulary.
 *
 * Three screens used to answer "what does this colour mean" three different
 * ways: the day grid mapped a reservation onto the kit's Tone scale, WeekGrid
 * drew its own saturated palette (solid --tp-accent / --tp-accent-2 fills)
 * with no labels at all, and the availability strip picked its tones inline.
 * A desk clerk who learns the day grid should not have to learn the week grid
 * a second time, and a state carried by colour alone is unreadable to the
 * third of a shift the counter spends looking sideways at a guest.
 *
 * Everything here derives from the kit's Tone vocabulary, so a badge, a grid
 * block and a week chip that mean the same thing always look the same.
 */
import { BookingStatusIndicator, StatusBadge, type Tone } from '../../components/kit';
import { useLocale } from '../../lib/i18n';
import type { ReservationKind } from './deskTypes';

/** The tinted ground a labelled block sits on. */
export const TONE_SOFT: Record<Tone, string> = {
  neutral: 'var(--tp-neutral-soft)',
  accent: 'var(--tp-accent-soft)',
  success: 'var(--tp-success-soft)',
  warn: 'var(--tp-warn-soft)',
  danger: 'var(--tp-danger-soft)',
  info: 'var(--tp-info-soft)',
};

/** Ink on that ground. */
export const TONE_FG: Record<Tone, string> = {
  neutral: 'var(--tp-neutral-fg)',
  accent: 'var(--tp-accent-soft-fg)',
  success: 'var(--tp-success-fg)',
  warn: 'var(--tp-warn-fg)',
  danger: 'var(--tp-danger-fg)',
  info: 'var(--tp-info-fg)',
};

/**
 * A 1px boundary is a MARK, not a fill. --tp-success measures 1.78:1 on the
 * desk's paper ground, so the block edge that used to be drawn in it simply
 * was not there; the -mark rungs exist for dots, hairlines and small glyphs
 * for exactly this reason.
 */
export const TONE_EDGE: Record<Tone, string> = {
  neutral: 'var(--tp-neutral-mark)',
  accent: 'var(--tp-accent)',
  success: 'var(--tp-success-mark)',
  warn: 'var(--tp-warn-mark)',
  danger: 'var(--tp-danger-mark)',
  info: 'var(--tp-accent)',
};

export interface ReservationLike {
  kind: ReservationKind | string;
  status: string;
}

/** Tone per reservation — the single source the grids and the chips read. */
export function reservationTone(r: ReservationLike): Tone {
  if (r.kind === 'maintenance') return 'neutral';
  if (r.kind === 'hold') return 'info';
  switch (r.status) {
    case 'arrived':
      return 'success';
    case 'pending':
      return 'warn';
    case 'completed':
      return 'neutral';
    default:
      return 'accent';
  }
}

/** Tone per court in the availability strip, in the same vocabulary. */
export function availabilityTone(a: { state: 'free' | 'busy'; kind?: ReservationKind | string }): Tone {
  if (a.state === 'free') return 'success';
  return a.kind === 'maintenance' ? 'neutral' : 'accent';
}

/**
 * The labelled status of one reservation. Five screens wrote this same
 * ternary; a block, a row, a chip and a dialog subtitle now all say it once.
 */
export function ReservationBadge({ reservation: r, size }: { reservation: ReservationLike; size?: 'sm' | 'md' }) {
  const { tr } = useLocale();
  if (r.kind === 'booking') return <BookingStatusIndicator status={r.status} size={size} />;
  const kind = (r.kind === 'hold' || r.kind === 'maintenance' ? r.kind : 'booking') satisfies ReservationKind;
  return <StatusBadge size={size} tone={reservationTone(r)} label={tr(`ws.kit.reservationKind.${kind}`)} />;
}
