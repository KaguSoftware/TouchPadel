import { describe, expect, it } from 'vitest';
import { MoneyError } from '../money/iqd';
import { splitEvenly } from '../money/split';
import {
  BASIS_POINTS,
  allocateCourseMoney,
  courseLateJoinPrice,
  courseLeaveRefund,
  lessonCoachShare,
  type CourseLeaveSession,
} from './statement';

/** Deterministic PRNG (mulberry32), as split.test.ts, so property failures are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof MoneyError ? e.code : 'not-a-money-error';
  }
  return undefined;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/** Weekly course sessions from `first`, with the enrolment's own shares and no cancels. */
function weekly(first: Date, shares: readonly number[]): CourseLeaveSession[] {
  return shares.map((shareIqd, i) => ({
    shareIqd,
    startAt: new Date(first.getTime() + i * WEEK),
    cancelledAt: null,
  }));
}

// money.md §10's scenario prices: private 40,000 (court share 10,000); group 15,000 a place (court
// share 10,000); course 100,001 for 4 sessions (court share 8,000); coach_share_bp 6000.
const BP = 6000;

describe('lessonCoachShare (C-6, CD-5; twin of app.lesson_coach_share)', () => {
  it('money.md S1: D1 private 18,000; D3 group 21,000; D4 session 1 10,200; R2 late cancel 18,000', () => {
    expect(lessonCoachShare(40_000, 10_000, BP)).toBe(18_000); // D1
    expect(lessonCoachShare(45_000, 10_000, BP)).toBe(21_000); // D3: three places paid
    expect(lessonCoachShare(25_001, 8_000, BP)).toBe(10_200); // floor(6000 × 17,001 / 10000)
    expect(lessonCoachShare(40_000, 10_000, BP)).toBe(18_000); // R2: late cancel, money kept
  });

  it('money.md S2: the October adjustments and regular lines', () => {
    // After D5's goodwill refund, sessions 1 and 2 collect 22,500 each.
    const after = lessonCoachShare(22_500, 8_000, BP);
    expect(after).toBe(8_700); // floor(6000 × 14,500 / 10000)
    expect(after - lessonCoachShare(25_001, 8_000, BP)).toBe(-1_500); // session 1 adjustment
    expect(after - lessonCoachShare(25_000, 8_000, BP)).toBe(-1_500); // session 2 adjustment
    // Sessions 3 and 4: the full member's 22,500 plus the late joiner's 25,000.
    expect(lessonCoachShare(47_500, 8_000, BP)).toBe(23_700); // floor(6000 × 39,500 / 10000)
  });

  it('is 0 when collected does not exceed the court share (a no-show line, S12)', () => {
    expect(lessonCoachShare(0, 10_000, BP)).toBe(0);
    expect(lessonCoachShare(10_000, 10_000, BP)).toBe(0);
    expect(lessonCoachShare(9_999, 10_000, BP)).toBe(0);
    expect(lessonCoachShare(0, 0, BP)).toBe(0);
  });

  it('floors, never rounds', () => {
    expect(lessonCoachShare(1, 0, BP)).toBe(0); // 0.6
    expect(lessonCoachShare(2, 0, BP)).toBe(1); // 1.2
    expect(lessonCoachShare(10_001, 0, 9_999)).toBe(9_999); // 9,999.9999
    expect(lessonCoachShare(3, 0, 3_333)).toBe(0); // 0.9999
  });

  it('takes the whole bp range: 0 earns nothing, 10000 earns everything above the court share', () => {
    expect(lessonCoachShare(40_000, 10_000, 0)).toBe(0);
    expect(lessonCoachShare(40_000, 10_000, BASIS_POINTS)).toBe(30_000);
  });

  it('is exact past 2^53 / 10000 (the product is BigInt, as the SQL bigint is)', () => {
    const big = Number.MAX_SAFE_INTEGER; // 9,007,199,254,740,991
    // floor(6000 × big / 10000) computed exactly.
    const exact = Number((6000n * BigInt(big)) / 10000n);
    expect(lessonCoachShare(big, 0, BP)).toBe(exact);
    expect(lessonCoachShare(big, 0, BASIS_POINTS)).toBe(big);
  });

  it('refuses a bp outside 0..10000, a fractional bp, and negative or fractional money', () => {
    expect(codeOf(() => lessonCoachShare(1000, 0, -1))).toBe('INVALID_ARGUMENT');
    expect(codeOf(() => lessonCoachShare(1000, 0, 10_001))).toBe('INVALID_ARGUMENT');
    expect(codeOf(() => lessonCoachShare(1000, 0, 60.5))).toBe('INVALID_ARGUMENT');
    expect(codeOf(() => lessonCoachShare(1000, 0, Number.NaN))).toBe('INVALID_ARGUMENT');
    expect(codeOf(() => lessonCoachShare(-1, 0, BP))).toBe('NEGATIVE_AMOUNT');
    expect(codeOf(() => lessonCoachShare(1000, -1, BP))).toBe('NEGATIVE_AMOUNT');
    expect(codeOf(() => lessonCoachShare(1000.5, 0, BP))).toBe('NOT_AN_INTEGER');
  });

  it('property: monotone in collected and in bp, never above collected − court share', () => {
    const rand = mulberry32(20261001);
    for (let i = 0; i < 2000; i++) {
      const collected = Math.floor(rand() * 2_000_000);
      const court = Math.floor(rand() * 100_000);
      const bp = Math.floor(rand() * (BASIS_POINTS + 1));
      const share = lessonCoachShare(collected, court, bp);
      expect(Number.isSafeInteger(share) && share >= 0).toBe(true);
      expect(share).toBeLessThanOrEqual(Math.max(0, collected - court));
      expect(lessonCoachShare(collected + 1, court, bp)).toBeGreaterThanOrEqual(share);
      if (bp < BASIS_POINTS) {
        expect(lessonCoachShare(collected, court, bp + 1)).toBeGreaterThanOrEqual(share);
      }
      if (collected <= court) expect(share).toBe(0);
    }
  });
});

describe('allocateCourseMoney (CM-4; = splitEvenly = app.iqd_split)', () => {
  it('money.md D4: 100,001 over 4 sessions → [25001, 25000, 25000, 25000]', () => {
    expect(allocateCourseMoney(100_001, 4)).toEqual([25_001, 25_000, 25_000, 25_000]);
  });

  it('money.md D5: kept 90,000 after the goodwill refund → 22,500 × 4', () => {
    expect(allocateCourseMoney(90_000, 4)).toEqual([22_500, 22_500, 22_500, 22_500]);
  });

  it('money.md R4: the rest cancelled after two sessions → kept 50,001 on sessions 1 and 2', () => {
    expect(allocateCourseMoney(50_001, 2)).toEqual([25_001, 25_000]);
  });

  it('money.md R9: 160,000 for 8 sessions is 20,000 each; sessions 4–8 are 100,000', () => {
    const shares = allocateCourseMoney(160_000, 8);
    expect(shares.every((s) => s === 20_000)).toBe(true);
    expect(sum(shares.slice(3))).toBe(100_000);
  });

  it('is splitEvenly exactly, including 0 and amounts below the count', () => {
    expect(allocateCourseMoney(0, 3)).toEqual([0, 0, 0]);
    expect(allocateCourseMoney(2, 5)).toEqual([1, 1, 0, 0, 0]);
    expect(allocateCourseMoney(99_999, 52)).toEqual(splitEvenly(99_999, 52));
  });

  it('refuses a session count below 1 and non-integer money', () => {
    expect(codeOf(() => allocateCourseMoney(1000, 0))).toBe('INVALID_ARGUMENT');
    expect(codeOf(() => allocateCourseMoney(1000.5, 2))).toBe('NOT_AN_INTEGER');
  });

  it('property: Σ allocation = kept, shares differ by at most 1, the larger ones first', () => {
    const rand = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const kept = Math.floor(rand() * 10_000_000);
      const n = 1 + Math.floor(rand() * 52);
      const alloc = allocateCourseMoney(kept, n);
      expect(sum(alloc)).toBe(kept);
      expect(Math.max(...alloc) - Math.min(...alloc)).toBeLessThanOrEqual(1);
      for (let k = 1; k < n; k++) {
        expect(alloc[k] as number).toBeLessThanOrEqual(alloc[k - 1] as number);
      }
    }
  });
});

describe('courseLateJoinPrice (C-15; twin of app.course_late_join_price)', () => {
  it('money.md D4: joining 100,001 / 4 from session 3 costs 50,000', () => {
    expect(courseLateJoinPrice(100_001, 4, 3)).toBe(50_000);
  });

  it('sums the LAST shares (the suffix): the first session carries the extra dinar', () => {
    // splitEvenly(100001, 4) = [25001, 25000, 25000, 25000]
    expect(courseLateJoinPrice(100_001, 4, 1)).toBe(100_001); // the whole course
    expect(courseLateJoinPrice(100_001, 4, 2)).toBe(75_000);
    expect(courseLateJoinPrice(100_001, 4, 4)).toBe(25_000);
    // 10 over 4 = [3, 3, 2, 2]: from session 3 is 4, not the first two shares' 6.
    expect(courseLateJoinPrice(10, 4, 3)).toBe(4);
  });

  it('prices nothing past the last session, as the SQL coalesce(sum, 0) does', () => {
    expect(courseLateJoinPrice(100_001, 4, 5)).toBe(0);
    expect(courseLateJoinPrice(100_001, 4, 99)).toBe(0);
  });

  it('refuses a session number below 1 or fractional, a bad count, and bad money', () => {
    expect(codeOf(() => courseLateJoinPrice(100_001, 4, 0))).toBe('INVALID_ARGUMENT');
    expect(codeOf(() => courseLateJoinPrice(100_001, 4, -1))).toBe('INVALID_ARGUMENT');
    expect(codeOf(() => courseLateJoinPrice(100_001, 4, 1.5))).toBe('INVALID_ARGUMENT');
    expect(codeOf(() => courseLateJoinPrice(100_001, 0, 1))).toBe('INVALID_ARGUMENT');
    expect(codeOf(() => courseLateJoinPrice(-1, 4, 1))).toBe('NEGATIVE_AMOUNT');
  });

  it('parity amounts (0, 1, n − 1, n, n + 1, 99,999, 100,001; n in 1..52) agree with Σ the split suffix', () => {
    for (let n = 1; n <= 52; n++) {
      for (const price of [0, 1, n - 1, n, n + 1, 99_999, 100_001]) {
        const shares = splitEvenly(price, n);
        for (let f = 1; f <= n + 1; f++) {
          expect(courseLateJoinPrice(price, n, f)).toBe(sum(shares.slice(f - 1)));
        }
      }
    }
  });

  it('property (money.md §5.1): a late joiner’s per-session share equals a full member’s', () => {
    const rand = mulberry32(15);
    for (let i = 0; i < 1500; i++) {
      const price = Math.floor(rand() * 5_000_000);
      const n = 1 + Math.floor(rand() * 52);
      const f = 1 + Math.floor(rand() * n);
      const late = courseLateJoinPrice(price, n, f);
      const full = splitEvenly(price, n);
      expect(splitEvenly(late, n - f + 1)).toEqual(full.slice(f - 1));
    }
  });
});

describe('courseLeaveRefund (C-23, R62; the engine’s guest_late course row)', () => {
  // money.md R8: online 100,001, weekly sessions, a 12-hour window.
  const first = new Date('2026-10-04T15:00:00.000Z'); // Sun 18:00 Baghdad
  const FULL = [25_001, 25_000, 25_000, 25_000];
  const session = (k: number): Date => new Date(first.getTime() + (k - 1) * WEEK);

  it('money.md R8: leaving 6 h before session 2 refunds 50,000 (sessions 3–4) and keeps 50,001', () => {
    const leftAt = new Date(session(2).getTime() - 6 * HOUR);
    expect(courseLeaveRefund(weekly(first, FULL), leftAt, 12)).toBe(50_000);
  });

  it('money.md R8: a late joiner from session 3, leaving 6 h before it, keeps 25,000 and refunds 25,000', () => {
    const price = courseLateJoinPrice(100_001, 4, 3);
    expect(price).toBe(50_000);
    const covered = weekly(session(3), splitEvenly(price, 2));
    const leftAt = new Date(session(3).getTime() - 6 * HOUR);
    expect(courseLeaveRefund(covered, leftAt, 12)).toBe(25_000);
  });

  it('money.md R8: the venue then cancels the rest before session 2 → 75,000 in all (25,000 blocked)', () => {
    const leftAt = new Date(session(2).getTime() - 6 * HOUR);
    const cancelAt = new Date(session(2).getTime() - 2 * HOUR); // after the leave
    const sessions = weekly(first, FULL).map((s, i) =>
      i >= 1 ? { ...s, cancelledAt: cancelAt } : s,
    );
    const total = courseLeaveRefund(sessions, leftAt, 12);
    expect(total).toBe(75_000);
    // The leave already refunded 50,000; session 2's share is what the row can no longer give back.
    expect(total - 50_000).toBe(25_000);
  });

  it('is 0 when every remaining session starts inside the window', () => {
    const leftAt = new Date(session(1).getTime() - 2 * HOUR);
    // A 4-week window covers all four weekly sessions.
    expect(courseLeaveRefund(weekly(first, FULL), leftAt, 4 * 7 * 24)).toBe(0);
  });

  it('keeps sessions already begun and the next one; refunds every later one (weekly, 12 h)', () => {
    // Leaving during session 2 (it has begun): sessions 1 and 2 kept, the next is 3 (a week on).
    const leftAt = new Date(session(2).getTime() + 30 * 60_000);
    expect(courseLeaveRefund(weekly(first, FULL), leftAt, 12)).toBe(25_000); // session 4 only
  });

  it('property: weekly sessions and a 12 h window refund Σ the shares after the next session', () => {
    const rand = mulberry32(23);
    for (let i = 0; i < 500; i++) {
      const n = 2 + Math.floor(rand() * 51);
      const price = Math.floor(rand() * 5_000_000);
      const shares = splitEvenly(price, n);
      const k = 1 + Math.floor(rand() * n); // the next session, 1-based
      // Leave between 1 and 11 hours before session k: inside the window, so it is a late leave.
      const leftAt = new Date(session(k).getTime() - (1 + Math.floor(rand() * 11)) * HOUR);
      expect(courseLeaveRefund(weekly(first, shares), leftAt, 12)).toBe(sum(shares.slice(k)));
    }
  });

  it('reads the order from start times, not from the array order', () => {
    const leftAt = new Date(session(2).getTime() - 6 * HOUR);
    const shuffled = [...weekly(first, FULL)].reverse();
    expect(courseLeaveRefund(shuffled, leftAt, 12)).toBe(50_000);
  });

  it('a session the venue cancelled before the leave is never the kept next one', () => {
    // Session 2 was cancelled (rescheduling aside) before the leave; the next is session 3.
    const leftAt = new Date(session(2).getTime() - 6 * HOUR);
    const sessions = weekly(first, FULL).map((s, i) =>
      i === 1 ? { ...s, cancelledAt: new Date(leftAt.getTime() - DAY) } : s,
    );
    // Kept: session 1 (begun) and session 3 (the next); refunded: 2 (cancelled) and 4.
    expect(courseLeaveRefund(sessions, leftAt, 12)).toBe(50_000);
  });

  it('the late rule keeps the next session even outside the window (a free leave is the engine’s other row)', () => {
    // Two days before session 2 the database judges the leave guest_free (C-23) and the engine
    // refunds 75,000 by its free row; this twin describes only the late row, which keeps N.
    const leftAt = new Date(session(2).getTime() - 2 * DAY);
    expect(courseLeaveRefund(weekly(first, FULL), leftAt, 12)).toBe(50_000);
  });

  it('a 0-hour window keeps only what has begun and the next session', () => {
    const leftAt = new Date(session(2).getTime() - HOUR);
    expect(courseLeaveRefund(weekly(first, FULL), leftAt, 0)).toBe(50_000);
  });

  it('nothing left to come refunds nothing; no sessions refund nothing', () => {
    const leftAt = new Date(session(4).getTime() + HOUR);
    expect(courseLeaveRefund(weekly(first, FULL), leftAt, 12)).toBe(0);
    expect(courseLeaveRefund([], leftAt, 12)).toBe(0);
  });

  it('refuses invalid dates, a negative or fractional window, and bad shares', () => {
    const ok = weekly(first, FULL);
    expect(codeOf(() => courseLeaveRefund(ok, new Date(Number.NaN), 12))).toBe('INVALID_ARGUMENT');
    expect(codeOf(() => courseLeaveRefund(ok, first, -1))).toBe('INVALID_ARGUMENT');
    expect(codeOf(() => courseLeaveRefund(ok, first, 1.5))).toBe('INVALID_ARGUMENT');
    expect(
      codeOf(() =>
        courseLeaveRefund(
          [{ shareIqd: 1, startAt: new Date('nope'), cancelledAt: null }],
          first,
          12,
        ),
      ),
    ).toBe('INVALID_ARGUMENT');
    expect(
      codeOf(() =>
        courseLeaveRefund([{ shareIqd: -5, startAt: first, cancelledAt: null }], first, 12),
      ),
    ).toBe('NEGATIVE_AMOUNT');
  });
});
