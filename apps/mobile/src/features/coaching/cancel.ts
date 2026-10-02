/**
 * The cancel dialog's words (docs/design/coaching/guest.md §4.9.4), built from
 * the server's preview (`my_lesson.cancel`, R8, R62, C-23). PURE (vitest).
 *
 * Every figure is the server's: free or late, the refund, what is kept, how
 * many course sessions go either way, the guest's next session. The phone
 * only chooses the sentence. The server decides again at the moment of the
 * call; the toast follows its answer, not this preview.
 */
import {
  countPhrase,
  formatDateTime,
  formatIQD,
  isolate,
  type Locale,
  type MessageKey,
  type TParams,
} from '@touch/i18n';
import type { CancelPreview, LessonKind } from './logic';

type T = (key: MessageKey, params?: TParams) => string;

export interface CancelCopy {
  title: string;
  body: string;
  /** The destructive button: "Cancel the lesson" or "Leave the course". */
  confirm: string;
  /** "Keep it". */
  keep: string;
}

export function cancelCopy(
  preview: CancelPreview,
  kind: LessonKind | null,
  ctx: {
    t: T;
    locale: Locale;
    tz: string;
    windowHours: number;
    /** The place is `held`: nothing has been paid yet (MB-11). */
    held?: boolean;
  },
): CancelCopy {
  const { t, locale, tz } = ctx;
  const money = (n: number) => isolate(formatIQD(n, locale));
  const when = (iso: string | null) => (iso ? formatDateTime(new Date(iso), locale, tz) : '');
  const hours = countPhrase('coaching.common.count.hours', ctx.windowHours, locale);
  const refund =
    preview.refundIqd > 0
      ? t('coaching.guest.cancel.refund', { amount: money(preview.refundIqd) })
      : '';
  const course = kind === 'course';
  const title = t(course ? 'coaching.guest.lesson.leave' : 'coaching.guest.lesson.cancel');
  const base = { title, confirm: title, keep: t('coaching.guest.cancel.keep') };

  if (course) {
    if (preview.policy === 'late') {
      // MB-15: sentence by sentence, each only when it has something to say:
      // never "its share (IQD 0) is kept", never "after it are cancelled:" with
      // nothing after the colon.
      const refundSessions = preview.refundSessions ?? 0;
      const parts = [
        t('coaching.guest.cancel.courseLate', { when: when(preview.nextStartAt), hours }),
        preview.keptIqd > 0
          ? t('coaching.guest.cancel.courseLateKept', {
              kept: money(preview.keptIqd),
              late: preview.countsLate ? t('coaching.guest.cancel.lateClause') : '',
            })
          : preview.countsLate
            ? t('coaching.guest.cancel.courseLateCounts')
            : '',
        refundSessions > 0
          ? t('coaching.guest.cancel.courseLateRest', {
              refundSessions: countPhrase('coaching.common.count.sessions', refundSessions, locale),
            })
          : '',
        refund,
      ];
      return { ...base, body: parts.filter((p) => p !== '').join(' ') };
    }
    return { ...base, body: t('coaching.guest.cancel.courseFree', { refund }).trim() };
  }

  if (preview.policy === 'late') {
    const kept = preview.keptIqd > 0;
    const key: MessageKey = preview.countsLate
      ? kept
        ? 'coaching.guest.cancel.lateCounts'
        : 'coaching.guest.cancel.lateNothingPaidCounts'
      : kept
        ? 'coaching.guest.cancel.late'
        : 'coaching.guest.cancel.lateNothingPaid';
    return { ...base, body: t(key, { hours, kept: money(preview.keptIqd) }) };
  }
  // MB-11: a held place has nothing to refund and no "{time}" to promise; a
  // free cancel the server gave no deadline for never shows an empty time.
  if (ctx.held) return { ...base, body: t('coaching.guest.cancel.freeHeld') };
  if (preview.freeBecause === 'rescheduled') {
    return { ...base, body: t('coaching.guest.cancel.freeMoved', { refund }).trim() };
  }
  if (!preview.freeUntil) {
    return { ...base, body: t('coaching.guest.cancel.freeNoTime', { refund }).trim() };
  }
  return {
    ...base,
    body: t('coaching.guest.cancel.free', { time: when(preview.freeUntil), refund }).trim(),
  };
}

/** The toast after a cancel, from the server's ANSWER (it may differ from the preview). */
export function cancelledToast(refundIqd: number, ctx: { t: T; locale: Locale }): string {
  return refundIqd > 0
    ? ctx.t('coaching.guest.cancel.doneRefund', {
        amount: isolate(formatIQD(refundIqd, ctx.locale)),
      })
    : ctx.t('coaching.guest.cancel.done');
}

/**
 * The branch's cancellation window in hours, for "less than {hours}": the
 * branch setting when known, else the gap between the start and `free_until`
 * (start − window), else 0.
 */
export function windowHoursOf(
  settingHours: number | null | undefined,
  startAt: string,
  freeUntil: string | null,
): number {
  if (typeof settingHours === 'number' && settingHours >= 0) return settingHours;
  const gap = freeUntil ? Date.parse(startAt) - Date.parse(freeUntil) : NaN;
  return Number.isFinite(gap) && gap > 0 ? Math.round(gap / 3_600_000) : 0;
}
