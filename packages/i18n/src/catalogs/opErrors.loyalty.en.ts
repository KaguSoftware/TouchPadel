/**
 * `op.errors.<CODE>` for loyalty and the account merge (docs/design/loyalty/build-contracts-2026-10-05.md
 * §2), spread at the end of `op.errors` in en.ts. Mirror every key in opErrors.loyalty.ar.ts.
 *
 * Each code is in ERROR_CODE_KEYS (../errors.ts); the wording fits staff and guests alike.
 */
export const opErrorsLoyaltyEn = {
  PHONE_TAKEN:
    'That phone number is already on another account. Ask the desk to join the two accounts.',
  MERGE_REFUSED: "These two accounts can't be joined: both belong to staff or both to coaches.",
  TIER_IN_USE: 'A promotion is still limited to this tier. Change that promotion first.',
  MEMBER_CODE_INVALID:
    "That isn't a member code. Scan the QR again or type the guest's phone number.",
  MEMBER_CODE_EXPIRED: 'That member code has expired. Ask the guest to open their card again.',
  MEMBER_NOT_FOUND: 'No account has that member code or phone number.',
  NO_CUSTOMER:
    'Add the guest to the bill first: scan their member card or type their phone number.',
  LOYALTY_OFF: 'Loyalty points are switched off.',
  POINTS_INSUFFICIENT: "The guest doesn't have enough points for that.",
  POINTS_BELOW_MIN: 'That is below the smallest number of points that can be used at once.',
  REWARD_NOT_FOUND: "That reward isn't available any more.",
};
