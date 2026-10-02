import { describe, expect, it, vi } from 'vitest';

/**
 * Coach-mode writes run now or fail now (CD-6), and coach reads never touch
 * the disk (docs/design/coaching/guest.md §4.7.3): a roster carries students'
 * phones and a statement the coach's pay. Asserted on the app's REAL query
 * client, with the three native modules it touches at import stubbed.
 */
vi.mock('react-native', () => ({
  AppState: { addEventListener: () => ({ remove: () => {} }) },
}));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
}));
vi.mock('@react-native-community/netinfo', () => ({
  default: { configure: () => {}, addEventListener: () => () => {} },
}));

const { queryClient, persistOptions } = await import('../../../lib/queryClient');
const { coachKeys } = await import('../keys');
const { clearAllLessonIntentKeys, clearLessonIntentKey, lessonIdemKey, lessonIntentKey } =
  await import('../../../lib/idempotency');

describe('coach mutation defaults', () => {
  it('never pause a coach write offline to fire it later', () => {
    expect(queryClient.getMutationDefaults(coachKeys.mutation('book')).networkMode).toBe('always');
    expect(queryClient.getMutationDefaults(coachKeys.mutation('attendance')).networkMode).toBe(
      'always',
    );
  });

  it('retry once on a dropped connection, never on a refusal', () => {
    const retry = queryClient.getMutationDefaults(coachKeys.mutation('reschedule')).retry as (
      n: number,
      e: unknown,
    ) => boolean;
    expect(retry(0, new TypeError('Network request failed'))).toBe(true);
    expect(retry(1, new TypeError('Network request failed'))).toBe(false);
    expect(retry(0, { message: 'COACH_BUSY' })).toBe(false);
  });

  it('let the free times fail fast', () => {
    const retry = queryClient.getQueryDefaults(coachKeys.slots('c', 't', 'f', 'u')).retry as (
      n: number,
      e: unknown,
    ) => boolean;
    expect(retry(0, { message: 'COACH_NOT_FOUND' })).toBe(false);
    expect(retry(1, new TypeError('Network request failed'))).toBe(false);
  });
});

describe('the disk cache', () => {
  const dehydrates = (queryKey: readonly unknown[]) =>
    persistOptions.dehydrateOptions.shouldDehydrateQuery({
      state: { status: 'success' },
      queryKey,
    });

  it('keeps every coach query in memory only', () => {
    for (const key of [
      coachKeys.me('u'),
      coachKeys.schedule('a', 'b'),
      coachKeys.hours,
      coachKeys.lesson('l'),
      coachKeys.slots('c', 't', 'f', 'u'),
      coachKeys.statements('summary'),
    ]) {
      expect(dehydrates(key)).toBe(false);
    }
  });

  it('still persists the guest’s reads as before', () => {
    expect(dehydrates(['courts'])).toBe(true);
  });
});

describe('coachKeys', () => {
  it('keeps every key under the one coach root', () => {
    for (const key of [
      coachKeys.all,
      coachKeys.me('u'),
      coachKeys.schedule('a', 'b'),
      coachKeys.hours,
      coachKeys.lesson('l'),
      coachKeys.slots('c', 't', 'f', 'u'),
      coachKeys.statements('2026-09-01'),
      coachKeys.mutation('accept'),
    ]) {
      expect(key[0]).toBe('coach');
    }
  });
});

describe('lesson idempotency keys (guest.md §4.7.4)', () => {
  it('mints MOBILE:lesson.<kind>:<ulid>, one per intent, until cleared', () => {
    expect(lessonIdemKey('coach_book')).toMatch(
      /^MOBILE:lesson\.coach_book:[0-9A-HJKMNP-TV-Z]{26}$/,
    );
    const a = lessonIntentKey('coach-book:t|v|s|1|Ali', 'coach_book');
    expect(lessonIntentKey('coach-book:t|v|s|1|Ali', 'coach_book')).toBe(a);
    expect(lessonIntentKey('coach-book:t|v|s|2|Ali', 'coach_book')).not.toBe(a);
    clearLessonIntentKey('coach-book:t|v|s|1|Ali');
    expect(lessonIntentKey('coach-book:t|v|s|1|Ali', 'coach_book')).not.toBe(a);
  });

  it('forgets every key on sign-out', () => {
    const a = lessonIntentKey('group:t|v|s', 'create_group');
    clearAllLessonIntentKeys();
    expect(lessonIntentKey('group:t|v|s', 'create_group')).not.toBe(a);
  });
});
