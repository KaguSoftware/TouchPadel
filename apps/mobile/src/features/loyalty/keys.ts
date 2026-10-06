/**
 * The guest loyalty query key family (loyalty plan §5.1).
 *
 * Split out of `hooks.ts`, like `tournaments/keys.ts`, because pure readers need the exact
 * arrays: `lib/queryClient.ts` keeps the card off the disk cache (it carries the TOTP secret,
 * which lives in SecureStore instead, `cardStore.ts`) and gives the mutation prefix "run now or
 * fail now"; `__tests__/queryDefaults.test.ts` pins both. `hooks.ts` re-exports it.
 *
 * `mine` IS persisted: it is the guest's own balance and history, the same class of read as the
 * own profile, and Profile decides from it whether to offer the member card, which has to work
 * on a cold start with no signal at the till. Sign-out wipes the persister (auth/context.tsx).
 */
export type LoyaltyMutation = 'rotate';

export const loyaltyKeys = {
  /** Every loyalty read and write. */
  all: ['loyalty'] as const,
  /** app.my_loyalty(): balance, tier, history and rewards. */
  mine: ['loyalty', 'mine'] as const,
  /** app.my_member_card(): the member code and the TOTP secret. Never written to disk. */
  card: ['loyalty', 'card'] as const,
  /** Mutation keys: queryClient.ts gives this prefix "run now or fail now". */
  mutation: (name: LoyaltyMutation) => ['loyalty', 'mutation', name] as const,
};
