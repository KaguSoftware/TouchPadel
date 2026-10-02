import { describe, expect, it } from 'vitest';
import { makeT, type Locale } from '@touch/i18n';
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
