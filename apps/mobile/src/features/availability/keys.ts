/**
 * The availability query keys (re-exported by hooks.ts, next to the hooks).
 *
 * Per branch since multi-venue slice 4: every read that belongs to one branch
 * carries its `venueId`, so switching branch reads that branch's rows instead
 * of showing the previous branch's from cache. The first segment of each key
 * is unchanged, so a prefix invalidation (`['availability']`, which every
 * hold/confirm/cancel mutation and the realtime broadcast target) still
 * reaches every branch at once.
 *
 * PURE (vitest).
 */
export const availabilityKeys = {
  /** Every open branch (venue_settings_public, one row per branch). */
  branches: ['venue-branches'] as const,
  /** One branch's public settings row. */
  settings: (venueId: string) => ['venue-settings', venueId] as const,
  /** One branch's active courts. */
  courts: (venueId: string) => ['courts', venueId] as const,
  /**
   * The active courts of EVERY open branch — the bookings list, the history
   * and the detail name a reservation's court, and a guest's bookings can be
   * at any branch.
   */
  allCourts: ['courts', 'all'] as const,
  /** One branch's active rate rules. */
  rates: (venueId: string) => ['rate-rules', venueId] as const,
  /**
   * Rule prices, not per branch: rate_rule_prices carries no venue, the grid
   * looks a price up by the rule's id, so another branch's prices never match.
   */
  ratePrices: ['rate-rule-prices'] as const,
  /**
   * Busy ranges for the WHOLE day strip of one branch, fetched once
   * (api.fetchAvailabilityWindow). Still under the 'availability' prefix.
   */
  window: (venueId: string, from: string, to: string) =>
    ['availability', 'window', venueId, from, to] as const,
  /** The branch's degraded flag (app.is_degraded(p_venue)). */
  degraded: (venueId: string) => ['is-degraded', venueId] as const,
};
