import { describe, expect, it } from 'vitest';
import { countPhrase, formatDateTime, formatIQD, makeT, type Locale } from '@touch/i18n';
import { cancelCopy, cancelledToast, windowHoursOf } from '../cancel';
import type { CancelPreview } from '../logic';

/** The dialog's words, from the server's preview (§4.9.4; R8, R62, C-23). */
const preview = (over: Partial<CancelPreview> = {}): CancelPreview => ({
  policy: 'free',
  freeUntil: '2026-10-06T15:00:00.000Z',
  freeBecause: null,
  refundIqd: 0,
  keptIqd: 0,
  countsLate: true,
  refundSessions: null,
  keptSessions: null,
  nextStartAt: null,
  ...over,
});

const ctx = (locale: Locale) => ({ t: makeT(locale), locale, tz: 'Asia/Baghdad', windowHours: 24 });
const plain = (s: string) => s.replace(/[\u2066-\u2069]/g, '');

describe('cancelCopy: a private lesson or a group session', () => {
  it('free, with the refund when something was paid online', () => {
    const c = cancelCopy(preview({ refundIqd: 30000 }), 'private', ctx('en'));
    expect(c.body.startsWith("Cancel this lesson? It's free to cancel until")).toBe(true);
    expect(plain(c.body)).toContain('30,000');
    expect(c.confirm).toBe('Cancel the lesson');
    expect(c.keep).toBe('Keep it');
  });

  it('free with nothing paid drops the refund sentence', () => {
    expect(cancelCopy(preview(), 'group', ctx('en')).body.endsWith('.')).toBe(true);
    expect(cancelCopy(preview(), 'group', ctx('en')).body).not.toContain('{refund}');
  });

  it('a held place says nothing has been paid, never "free until {time}" (MB-11)', () => {
    for (const locale of ['en', 'ar'] as const) {
      const t = makeT(locale);
      const c = cancelCopy(preview({ freeUntil: null }), 'private', { ...ctx(locale), held: true });
      expect(c.body).toBe(t('coaching.guest.cancel.freeHeld'));
      expect(cancelCopy(preview(), 'group', { ...ctx(locale), held: true }).body).toBe(
        t('coaching.guest.cancel.freeHeld'),
      );
    }
  });

  it('a free cancel with no deadline sent never shows an empty time (MB-11)', () => {
    const c = cancelCopy(preview({ freeUntil: null }), 'private', ctx('en'));
    expect(c.body).toBe("Cancel this lesson? It's free to cancel.");
    expect(c.body).not.toContain('until');
    const ar = cancelCopy(preview({ freeUntil: null }), 'private', ctx('ar'));
    expect(ar.body).not.toContain('حتى');
  });

  it('free because it was moved (R8)', () => {
    const c = cancelCopy(preview({ freeBecause: 'rescheduled' }), 'private', ctx('en'));
    expect(c.body).toContain('moved after you booked');
  });

  it('late: kept and counted, kept only, nothing paid', () => {
    expect(
      plain(cancelCopy(preview({ policy: 'late', keptIqd: 30000 }), 'private', ctx('en')).body),
    ).toBe(
      "It's less than 24 hours before the lesson. If you cancel now, 30,000 IQD paid online is kept, and it counts as a late cancellation.",
    );
    expect(
      cancelCopy(
        preview({ policy: 'late', keptIqd: 30000, countsLate: false }),
        'private',
        ctx('en'),
      ).body,
    ).not.toContain('late cancellation');
    expect(plain(cancelCopy(preview({ policy: 'late' }), 'private', ctx('en')).body)).toBe(
      "It's less than 24 hours before the lesson. If you cancel now, it counts as a late cancellation.",
    );
    expect(
      plain(cancelCopy(preview({ policy: 'late', countsLate: false }), 'private', ctx('en')).body),
    ).toBe("It's less than 24 hours before the lesson.");
  });
});

describe('cancelCopy: a course (C-23, R62)', () => {
  it('leaving free', () => {
    const c = cancelCopy(preview({ refundIqd: 40000 }), 'course', ctx('en'));
    expect(c.body.startsWith('Leave the course?')).toBe(true);
    expect(c.confirm).toBe('Leave the course');
  });

  it('leaving late keeps the next session’s share and refunds the rest, every figure the server’s', () => {
    const c = cancelCopy(
      preview({
        policy: 'late',
        keptIqd: 10000,
        refundIqd: 30000,
        keptSessions: 1,
        refundSessions: 3,
        nextStartAt: '2026-10-05T14:00:00.000Z',
      }),
      'course',
      ctx('en'),
    );
    const body = plain(c.body);
    expect(body).toContain('10,000');
    expect(body).toContain('30,000');
    expect(body).toContain('3 sessions');
    expect(body).toContain('counts as a late cancellation');
  });

  it.each(['en', 'ar'] as const)(
    'says only what is true when nothing is kept or nothing comes after, in %s (MB-15)',
    (locale) => {
      const t = makeT(locale);
      const cases: Partial<CancelPreview>[] = [
        // kept 0 / refund 0 (a held or desk-paid place), sessions after it.
        { keptIqd: 0, refundIqd: 0, refundSessions: 2 },
        // refundSessions 0: the next session is the last one.
        { keptIqd: 10000, refundIqd: 0, refundSessions: 0 },
        // nothing kept, nothing after it, not counted late.
        { keptIqd: 0, refundIqd: 0, refundSessions: 0, countsLate: false },
      ];
      const zeroMoney = plain(formatIQD(0, locale));
      // A figure of 0 on its own, not the tail of "10,000 IQD" (the digit before it).
      const isZeroMoney = (body: string) =>
        body
          .split(zeroMoney)
          .slice(0, -1)
          .some((before) => !/[\d,٬٠-٩]$/.test(before));
      const noneAfter = plain(
        t('coaching.guest.cancel.courseLateRest', {
          refundSessions: countPhrase('coaching.common.count.sessions', 0, locale),
        }),
      );
      for (const over of cases) {
        const body = plain(
          cancelCopy(
            preview({ policy: 'late', nextStartAt: '2026-10-05T14:00:00.000Z', ...over }),
            'course',
            ctx(locale),
          ).body,
        );
        expect(body).not.toMatch(/\{\w+\}/);
        expect(isZeroMoney(body)).toBe(false);
        expect(body).not.toContain(noneAfter);
        expect(body.trim()).not.toMatch(/[:،]$/);
        expect(body).not.toMatch(/ {2}/);
        expect(body).toBe(body.trim());
      }
    },
  );

  it('builds the English sentences from parts (MB-15)', () => {
    const next = '2026-10-05T14:00:00.000Z';
    const when = formatDateTime(new Date(next), 'en', 'Asia/Baghdad');
    const intro = `Leave the course? Your next session, ${when}, is less than 24 hours away.`;
    const body = (over: Partial<CancelPreview>) =>
      plain(
        cancelCopy(preview({ policy: 'late', nextStartAt: next, ...over }), 'course', ctx('en'))
          .body,
      );
    expect(body({ keptIqd: 0, refundSessions: 0 })).toBe(
      plain(`${intro} Leaving now counts as a late cancellation.`),
    );
    expect(body({ keptIqd: 0, refundSessions: 0, countsLate: false })).toBe(plain(intro));
    expect(body({ keptIqd: 10000, refundSessions: 0, countsLate: false })).toBe(
      plain(`${intro} Its share (${formatIQD(10000, 'en')}) is kept.`),
    );
    expect(body({ keptIqd: 0, refundSessions: 2, refundIqd: 20000, countsLate: false })).toBe(
      plain(
        `${intro} The 2 sessions after it are cancelled. ${formatIQD(20000, 'en')} paid online goes back to your card.`,
      ),
    );
  });

  it('reads in Arabic with no placeholder left', () => {
    const c = cancelCopy(
      preview({
        policy: 'late',
        keptIqd: 10000,
        refundIqd: 30000,
        refundSessions: 3,
        nextStartAt: '2026-10-05T14:00:00.000Z',
      }),
      'course',
      ctx('ar'),
    );
    expect(c.body).not.toMatch(/\{\w+\}/);
    expect(c.confirm).toBe('الانسحاب من الدورة');
  });
});

describe('the toast and the window', () => {
  it('the toast follows the server’s answer', () => {
    expect(plain(cancelledToast(30000, { t: makeT('en'), locale: 'en' }))).toContain('30,000');
    expect(cancelledToast(0, { t: makeT('en'), locale: 'en' })).toBe('Cancelled.');
  });

  it('the window: the setting, else start − free_until, else 0', () => {
    expect(windowHoursOf(12, '2026-10-06T15:00:00Z', null)).toBe(12);
    expect(windowHoursOf(null, '2026-10-06T15:00:00Z', '2026-10-05T15:00:00Z')).toBe(24);
    expect(windowHoursOf(undefined, '2026-10-06T15:00:00Z', null)).toBe(0);
  });
});
