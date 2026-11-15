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
 *
 * `deals` is NOT persisted (0410): a deal's state is live (open, used, the one picked, inside its
 * hours or not), and a pick read back from disk would put "the cashier applies this deal" on the
 * member card for a deal that was used or lapsed since. With no signal on a cold start the card
 * shows its QR and no deal line; the pick itself lives on the server, so the cashier still
 * applies it.
 *
 * `vouchers` is NOT persisted (0415): each holds a fixed code that is worth a reward to whoever
 * shows it, and lives 15 minutes; the server answers again on every open.
 */
export type LoyaltyMutation = 'rotate' | 'pick-deal' | 'redeem' | 'cancel-voucher';

export const loyaltyKeys = {
  /** Every loyalty read and write. */
  all: ['loyalty'] as const,
  /** app.my_loyalty(): balance, tier, history and rewards. */
  mine: ['loyalty', 'mine'] as const,
  /** app.my_member_card(): the member code and the TOTP secret. Never written to disk. */
  card: ['loyalty', 'card'] as const,
  /** app.my_deals(): the listed deals and the one picked. Live state, never written to disk. */
  deals: ['loyalty', 'deals'] as const,
  /**
   * app.my_reward_vouchers() (0415): the rewards redeemed in the app and their codes. A code is
   * a bearer voucher (whoever shows it collects), so it never reaches the disk cache either.
   */
  vouchers: ['loyalty', 'vouchers'] as const,
  /** Mutation keys: queryClient.ts gives this prefix "run now or fail now". */
  mutation: (name: LoyaltyMutation) => ['loyalty', 'mutation', name] as const,
};
