import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PENDING_LESSON_TTL_MS,
  clearPendingLesson,
  getPendingLesson,
  pendingLessonHref,
  setPendingLesson,
  subscribePendingLesson,
} from '../pendingLesson';
import { clearPendingIntents, hasPendingIntent } from '../../booking/pendingIntent';

/** The signed-out lesson intent (guest.md §4.9.5): in memory, subscribable, never persisted. */
afterEach(() => {
  clearPendingLesson();
  vi.useRealTimers();
});

const PRIVATE = {
  kind: 'private' as const,
  coachId: 'c-1',
  lessonTypeId: 't-1',
  venueId: 'v-1',
  startAt: '2026-10-02T15:00:00.000Z',
  priceIqd: 30000,
};

describe('pendingLesson', () => {
  it('keeps, tells and forgets the intent', () => {
    const seen: number[] = [];
    const off = subscribePendingLesson(() => seen.push(1));
    setPendingLesson(PRIVATE);
    expect(getPendingLesson()).toEqual(PRIVATE);
    expect(hasPendingIntent()).toBe(true);
    clearPendingLesson();
    expect(getPendingLesson()).toBeNull();
    off();
    expect(seen.length).toBe(2);
  });

  it('is forgotten once stale', () => {
    vi.useFakeTimers();
    setPendingLesson(PRIVATE);
    vi.advanceTimersByTime(PENDING_LESSON_TTL_MS + 1);
    expect(getPendingLesson()).toBeNull();
  });

  it('is cleared with the other intents', () => {
    setPendingLesson({ kind: 'class', classKind: 'course', id: 'k-1' });
    clearPendingIntents();
    expect(getPendingLesson()).toBeNull();
  });

  it('opens the review (the price is a hint) or the class; never books by itself', () => {
    expect(pendingLessonHref(PRIVATE)).toEqual({
      pathname: '/lesson-review',
      params: {
        coachId: 'c-1',
        lessonTypeId: 't-1',
        venueId: 'v-1',
        startAt: PRIVATE.startAt,
        priceIqd: '30000',
      },
    });
    expect(pendingLessonHref({ ...PRIVATE, priceIqd: null }).params).not.toHaveProperty('priceIqd');
    expect(pendingLessonHref({ kind: 'class', classKind: 'session', id: 'l-1' })).toEqual({
      pathname: '/class/[id]',
      params: { id: 'l-1', kind: 'session' },
    });
  });
});
