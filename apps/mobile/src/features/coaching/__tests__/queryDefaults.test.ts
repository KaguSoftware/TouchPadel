import { describe, expect, it, vi } from 'vitest';

/**
 * The guest coaching family's query defaults, set once in lib/queryClient.ts
 * (docs/design/coaching/guest.md §4.7.3), and the lesson keys of
 * lib/idempotency.ts (§4.7.4). Asserted on the app's REAL client, with the
 * native modules it touches at import stubbed (as matches/__tests__/
 * queryDefaults does).
 */
vi.mock('react-native', () => ({
  AppState: { addEventListener: () => ({ remove: () => {} }) },
}));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  },
}));
vi.mock('@react-native-community/netinfo', () => ({
  default: { configure: () => {}, addEventListener: () => () => {} },
}));

const { queryClient, persistOptions } = await import('../../../lib/queryClient');
const { coachingKeys } = await import('../keys');
const { clearAllLessonIntentKeys, clearLessonIntentKey, lessonIntentKey } =
  await import('../../../lib/idempotency');

type Retry = (n: number, e: unknown) => boolean;

describe('lesson writes', () => {
  it('never pause offline: run now or fail now (CD-6)', () => {
    for (const name of ['book', 'join', 'course', 'cancel', 'pay', 'confirm'] as const) {
      expect(queryClient.getMutationDefaults(coachingKeys.mutation(name)).networkMode, name).toBe(
        'always',
      );
    }
  });

  it('retry once on a dropped connection, never a refusal the server made', () => {
    const retry = queryClient.getMutationDefaults(coachingKeys.mutation('book')).retry as Retry;
    expect(retry(0, new TypeError('Network request failed'))).toBe(true);
    expect(retry(1, new TypeError('Network request failed'))).toBe(false);
    expect(retry(0, { message: 'COACH_BUSY' })).toBe(false);
  });
});

describe('a coach’s grid', () => {
  it('fails fast on anything but a dropped connection', () => {
    const retry = queryClient.getQueryDefaults(coachingKeys.slots('c', 't', 'f', 'to'))
      .retry as Retry;
    expect(retry(0, { message: 'Could not find the function app.coach_slots' })).toBe(false);
    expect(retry(0, new TypeError('Network request failed'))).toBe(true);
  });

  it('leaves the other lesson reads on the app defaults', () => {
    expect(queryClient.getQueryDefaults(coachingKeys.one('e')).retry).toBeUndefined();
  });
});

describe('the disk cache', () => {
  const dehydrates = (queryKey: readonly unknown[]) =>
    persistOptions.dehydrateOptions.shouldDehydrateQuery({
      state: { status: 'success' },
      queryKey,
    });

  it('never writes a lesson read to disk (§1.11)', () => {
    expect(dehydrates(coachingKeys.public('v'))).toBe(false);
    expect(dehydrates(coachingKeys.profile('c', 'v'))).toBe(false);
    expect(dehydrates(coachingKeys.slots('c', 't', 'f', 'to'))).toBe(false);
    expect(dehydrates(coachingKeys.offer('course', 'k'))).toBe(false);
    expect(dehydrates(coachingKeys.mine('upcoming'))).toBe(false);
    expect(dehydrates(coachingKeys.one('e'))).toBe(false);
  });

  it('still persists the guest’s ordinary reads', () => {
    expect(dehydrates(['courts'])).toBe(true);
  });
});

describe('coachingKeys', () => {
  it('keeps every key under the one root', () => {
    expect(coachingKeys.all).toEqual(['coaching']);
    expect(coachingKeys.slotsAll).toEqual(['coaching', 'slots']);
    expect(coachingKeys.slots('c', 't', 'f', 'to').slice(0, 2)).toEqual(coachingKeys.slotsAll);
    expect(coachingKeys.mutation('pay')).toEqual(['coaching', 'mutation', 'pay']);
  });
});

describe('lessonIntentKey (§4.7.4)', () => {
  it('memoises one key per intent, with the station and the kind in it', () => {
    const a = lessonIntentKey('private:x', 'book_private');
    expect(a).toMatch(/^MOBILE:lesson\.book_private:[0-9A-Z]{26}$/);
    expect(lessonIntentKey('private:x', 'book_private')).toBe(a);
    expect(lessonIntentKey('private:y', 'book_private')).not.toBe(a);
  });

  it('forgets one intent, or every one on sign-out', () => {
    const a = lessonIntentKey('join:l|desk', 'join');
    clearLessonIntentKey('join:l|desk');
    expect(lessonIntentKey('join:l|desk', 'join')).not.toBe(a);
    const b = lessonIntentKey('course:k|desk', 'course_join');
    clearAllLessonIntentKeys();
    expect(lessonIntentKey('course:k|desk', 'course_join')).not.toBe(b);
  });
});
