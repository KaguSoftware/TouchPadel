/**
 * Whether this deployment of the site takes part in online payment (Qi Card).
 *
 * F-02 / F-03 (Majed, 2026-11-01): no online payment in this build, on the phone or on the
 * web. The phone's switch is the build-time `EXPO_PUBLIC_ONLINE_PAYMENTS`
 * (apps/mobile/src/features/deposit/enabled.ts); this is the site's twin,
 * `NEXT_PUBLIC_ONLINE_PAYMENTS`, with the same grammar: only the literal "on" enables, so an
 * unset variable means off. Off, `/{locale}/pay/return` says that payment is made at the
 * club instead of handing a payment reference to the app, and no page on the site offers to
 * pay online. A later reviewed release turns both switches on together.
 */
export function parseOnlinePaymentsFlag(value: string | undefined | null): boolean {
  return (value ?? '').trim().toLowerCase() === 'on';
}

/**
 * Read at call time so a test can flip it. A literal `process.env.NEXT_PUBLIC_*` member
 * expression: the only shape Next inlines into a client bundle.
 */
export function onlinePaymentsOnWeb(): boolean {
  return parseOnlinePaymentsFlag(process.env.NEXT_PUBLIC_ONLINE_PAYMENTS);
}
