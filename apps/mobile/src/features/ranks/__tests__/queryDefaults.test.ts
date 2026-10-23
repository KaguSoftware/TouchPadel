import { describe, expect, it, vi } from 'vitest';

/**
 * The leaderboard family's query defaults, set once in lib/queryClient.ts (migration 0364).
 * Asserted on the app's REAL client, with the native modules it touches at import stubbed (as
 * loyalty/__tests__/queryDefaults does).
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
const { ranksKeys } = await import('../keys');

describe('leaderboard writes', () => {
  it('a report and an answer run now or fail now, and are never sent again by themselves', () => {
    for (const name of ['report', 'confirm'] as const) {
      const d = queryClient.getMutationDefaults(ranksKeys.mutation(name));
      expect(d.networkMode).toBe('always');
      expect(d.retry).toBe(false);
    }
  });
});

describe('the disk cache', () => {
  it('never writes the leaderboard: the board and the guest page carry other players’ names', () => {
    for (const queryKey of [ranksKeys.board, ranksKeys.mine, ranksKeys.player('sara')]) {
      expect(
        persistOptions.dehydrateOptions.shouldDehydrateQuery({ state: { status: 'success' }, queryKey }),
      ).toBe(false);
    }
  });
});
