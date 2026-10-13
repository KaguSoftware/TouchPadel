/**
 * The store-build switch for online payment AND open matches (one flag, both).
 *
 * Why: Qi, the online payment provider, was delayed (2026-10-13), so the app
 * goes to the App Store and Google Play without online payment and without open
 * matches (they need it: tickets are bought online). Apple guideline 2.3.1 and
 * Google Play's Behavior Transparency policy forbid hidden features that can be
 * switched on remotely, so the store build must ignore the server for these
 * features: this is a BUILD-TIME flag (EXPO_PUBLIC_ONLINE_PAYMENTS), "off" in
 * every eas.json profile. A venue's `deposit_mode`, `matches_enabled` or lesson
 * payment mode cannot turn the features on. The code stays; a later reviewed
 * release sets the flag "on".
 *
 * Pure module (no RN / expo imports) so node tests can use it.
 */

/** The flag's grammar, separate from the env read so it is testable. Only the literal "on" enables. */
export function parseOnlinePaymentsFlag(value: string | undefined | null): boolean {
  return (value ?? '').trim().toLowerCase() === 'on';
}

/**
 * Read at call time, not module scope, so a test can never freeze it. The env
 * access stays a STATIC `process.env.EXPO_PUBLIC_…` member expression — that
 * is the only shape Expo inlines into the bundle.
 */
export function onlinePaymentsShipped(): boolean {
  return parseOnlinePaymentsFlag(process.env.EXPO_PUBLIC_ONLINE_PAYMENTS);
}
