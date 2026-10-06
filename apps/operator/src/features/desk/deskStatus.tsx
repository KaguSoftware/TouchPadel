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
import { formatIQD } from '@touch/i18n';
import { BookingStatusIndicator, StatusBadge, type Tone } from '../../components/kit';
import { useLocale } from '../../lib/i18n';
import { LessonBadge } from '../coaching/LessonBadge';
import type { DeskLesson } from '../coaching/lessonPayloads';
import type { ReservationKind } from './deskTypes';
import { chargeLabelOf, type BillStateRow } from './payment/deskPaymentLogic';

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

/**
 * A block's tone (coaching operator.md §5.8): the kit's Tone does not grow, so
 * the grids paint a lesson with its own family. A lesson's court row is
 * `lesson`; so is a held lesson's hold row once the desk knows it is one
 * (`heldLesson`, from desk_lessons). Everything else is reservationTone.
 */
export type BlockTone = Tone | 'lesson' | 'tournament';

export const BLOCK_SOFT: Record<BlockTone, string> = {
  ...TONE_SOFT,
  lesson: 'var(--tp-lesson-soft)',
  tournament: 'var(--tp-tournament-soft)',
};
export const BLOCK_FG: Record<BlockTone, string> = { ...TONE_FG, lesson: 'var(--tp-lesson)', tournament: 'var(--tp-tournament)' };
export const BLOCK_EDGE: Record<BlockTone, string> = { ...TONE_EDGE, lesson: 'var(--tp-lesson)', tournament: 'var(--tp-tournament)' };

/**
 * `tournamentBlock`: the row is a tournament's adopted event block (an event
 * `maintenance` row the desk_tournaments read names, tournaments §1.11). It
 * paints in the tournament family instead of the neutral block tone.
 */
export function reservationBlockTone(r: ReservationLike, heldLesson = false, tournamentBlock = false): BlockTone {
  if (r.kind === 'lesson' || (heldLesson && r.kind === 'hold')) return 'lesson';
  if (tournamentBlock && r.kind === 'maintenance') return 'tournament';
  return reservationTone(r);
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
export function ReservationBadge({
  reservation: r,
  size,
  lesson,
}: {
  reservation: ReservationLike;
  size?: 'sm' | 'md';
  /**
   * The desk_lessons row this reservation holds, when the caller knows it. A
   * `lesson` row always reads as a lesson; a `hold` row does only when it is a
   * held lesson's (coaching operator.md §5.8), so pass it for those.
   */
  lesson?: Pick<DeskLesson, 'kind' | 'status'> | null;
}) {
  const { tr } = useLocale();
  if (r.kind === 'booking') return <BookingStatusIndicator status={r.status} size={size} />;
  if (r.kind === 'lesson' || (r.kind === 'hold' && lesson)) {
    return <LessonBadge kind={lesson?.kind ?? null} held={r.kind === 'hold' || lesson?.status === 'held'} size={size} />;
  }
  const kind = (r.kind === 'hold' || r.kind === 'maintenance' ? r.kind : 'booking') satisfies ReservationKind;
  return <StatusBadge size={size} tone={reservationTone(r)} label={tr(`ws.kit.reservationKind.${kind}`)} />;
}

/**
 * Where the court fee stands (0106), from app.booking_bill_states. Holds and
 * blocks have no fee; a state that could not be loaded prints "—", never a
 * guess. "Not paid" is only a warning once the game is over.
 */
export function ChargeCell({ state, kind, ended }: { state: BillStateRow | undefined; kind: string; ended: boolean }) {
  const { tr, locale } = useLocale();
  if (kind !== 'booking') return null;
  if (!state) return <span style={{ color: 'var(--tp-muted-fg)' }}>—</span>;
  const label = chargeLabelOf(state, ended);
  const text = tr(`ws.courtDesk.board.charge.${label.key}`, { amount: label.amount != null ? formatIQD(label.amount, locale) : '' });
  if (label.tone === 'muted') return <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{text}</span>;
  return <StatusBadge size="sm" tone={label.tone} label={text} />;
}
