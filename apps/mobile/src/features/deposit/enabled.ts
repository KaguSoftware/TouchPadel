/**
 * The store-build switch for online payment.
 *
 * Why: Qi, the online payment provider, was delayed (2026-10-13), so the app
 * goes to the App Store and Google Play without online payment. Apple
 * guideline 2.3.1 and Google Play's Behavior Transparency policy forbid hidden
 * features that can be switched on remotely, so the store build must ignore
 * the server here: this is a BUILD-TIME flag (EXPO_PUBLIC_ONLINE_PAYMENTS),
 * "off" in every eas.json profile. A venue's `deposit_mode` or lesson payment
 * mode cannot turn online payment on. The code stays; a later reviewed release
 * sets the flag "on".
 *
 * What "off" hides: the court deposit (Review's Pay now), lesson online pay,
 * the open-match ticket wallet and ticket purchases, and the /tickets and
 * /pay/* screens (OnlinePaymentsGate). What it does NOT hide: open matches
 * themselves. Until 2026-11-01 they rode on this flag too (tickets were the
 * only way to pay a seat); since 0370 a seat is paid at the desk, so open
 * matches follow the branch's `matches_enabled` alone and, in a build with
 * this flag off, never ask for a ticket (useMatchPayAtDesk answers true).
 *
 * The flag was "on" from 2026-10-25 until 2026-11-01, when Majed ruled for the
 * launch: no online payments in this build at all (finding F-02). Every
 * profile is "off" again, and src/lib/__tests__/buildFlags.test.ts pins that,
 * so a profile flipped back fails CI instead of shipping.
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
