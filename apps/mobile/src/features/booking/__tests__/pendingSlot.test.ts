import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PENDING_SLOT_TTL_MS,
  clearPendingSlot,
  getPendingSlot,
  setPendingSlot,
  subscribePendingSlot,
  type PendingSlot,
} from '../pendingSlot';
import {
  clearPendingIntents,
  setOnlyPendingJoin,
  setOnlyPendingLesson,
  setOnlyPendingSlot,
} from '../pendingIntent';
import { getPendingJoin } from '../../matches/pendingJoin';
import { getPendingLesson } from '../../coaching/pendingLesson';

afterEach(() => {
  clearPendingIntents();
  vi.useRealTimers();
});

const slot: PendingSlot = {
  courtId: 'c1',
  startAt: '2026-09-01T07:00:00.000Z',
  durationMin: 60,
  priceIqd: 40_000,
  courtNameEn: 'Court 1',
  courtNameAr: 'ملعب 1',
};

describe('pendingSlot store', () => {
  it('notifies subscribers on set and clear, and stays set until cleared', () => {
    // The (auth) layout guard reads this at render; a plain module variable
    // gave it no way to re-evaluate, and the intent was dropped BEFORE the
    // post-auth hold settled — the redirect race that stranded guests on the tabs.
    const seen: (PendingSlot | null)[] = [];
    const unsubscribe = subscribePendingSlot(() => seen.push(getPendingSlot()));

    setPendingSlot(slot);
    expect(getPendingSlot()).toEqual(slot);
    expect(getPendingSlot()).toEqual(slot); // peeking does not consume

    clearPendingSlot();
    expect(getPendingSlot()).toBeNull();
    clearPendingSlot(); // idempotent: no extra notification
    unsubscribe();
    setPendingSlot(slot);
    clearPendingSlot();

    expect(seen).toEqual([slot, null]);
  });
});

describe('pendingSlot TTL and one intent at a time (MB-04)', () => {
  const LESSON = { kind: 'class' as const, classKind: 'session' as const, id: 'l-1' };
  const JOIN = { kind: 'link' as const, token: 'tok' };

  it('forgets a slot after thirty minutes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-02T12:00:00Z'));
    setPendingSlot(slot);
    vi.setSystemTime(Date.now() + PENDING_SLOT_TTL_MS);
    expect(getPendingSlot()).toEqual(slot);
    vi.setSystemTime(Date.now() + 1);
    expect(getPendingSlot()).toBeNull();
  });

  it('keeps only the latest intent: each setter clears the other two', () => {
    setOnlyPendingSlot(slot);
    setOnlyPendingLesson(LESSON);
    expect(getPendingSlot()).toBeNull();
    expect(getPendingLesson()).toEqual(LESSON);

    setOnlyPendingJoin(JOIN);
    expect(getPendingLesson()).toBeNull();
    expect(getPendingJoin()).toEqual(JOIN);
    setOnlyPendingLesson(LESSON);
    expect(getPendingJoin()).toBeNull();

    setOnlyPendingSlot(slot);
    expect(getPendingLesson()).toBeNull();
    expect(getPendingJoin()).toBeNull();
    expect(getPendingSlot()).toEqual(slot);
  });
});
