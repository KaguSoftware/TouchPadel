/**
 * The online deposit's query key family (build-contracts-2026-09-27 §4).
 *
 * Split out of `hooks.ts`, like `historyKeys.ts` and `staff/keys.ts`, because two
 * pure readers need the exact arrays: `lib/queryClient.ts` keeps the whole
 * family off the disk cache (a payment's state read back from disk would be
 * shown before it is re-checked), and the query-defaults test pins that.
 * `hooks.ts` re-exports it, so the family is still found next to its hooks.
 */
export const depositKeys = {
  /** Every deposit read and write: the persister's filter matches on this root. */
  all: ['deposit'] as const,
  /** app.deposit_quote for one hold (Review). */
  quote: (holdId: string) => ['deposit', 'quote', holdId] as const,
  /** deposit-status for one attempt (the payment screen). */
  status: (ref: string) => ['deposit', 'status', ref] as const,
  /** Mutation keys: queryClient.ts gives this prefix "run now or fail now". */
  mutation: (name: 'begin') => ['deposit', 'mutation', name] as const,
};
