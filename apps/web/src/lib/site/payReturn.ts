/**
 * The pure half of the payment return page (app/[locale]/pay/return/page.tsx).
 *
 * Qi's hosted payment page sends the guest's browser to
 * `/{locale}/pay/return?ref=<request_id>` (build contracts 2026-09-27 §3), and the page's
 * one job is to hand that ref to the app on `touchpadel://pay/return?ref=…`, where the
 * app asks the server how the payment went. The ref is a `booking_payments` request id, a
 * UUID. Anything else is dropped rather than forwarded: the app link then carries no ref
 * at all, what to show is the app's call, and the page does not jump by itself.
 */

/** The app's own return route (apps/mobile `app/pay/return.tsx`); `scheme: 'touchpadel'`. */
export const APP_RETURN_URL = 'touchpadel://pay/return';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The `ref` query value as a lowercase UUID, or null. A repeated `?ref=` reads the first,
 * as `URLSearchParams.get` does.
 */
export function parsePaymentRef(raw: string | string[] | undefined): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return UUID.test(trimmed) ? trimmed.toLowerCase() : null;
}

/** The app link: with the ref when there is a valid one, without it otherwise. */
export function appReturnHref(ref: string | null): string {
  return ref ? `${APP_RETURN_URL}?ref=${ref}` : APP_RETURN_URL;
}

/** The same page in the other language, keeping a valid ref (and dropping an invalid one). */
export function payReturnPath(locale: string, ref: string | null): string {
  return ref ? `/${locale}/pay/return?ref=${ref}` : `/${locale}/pay/return`;
}

/**
 * Whether this browser is on a phone or tablet, the only devices the app runs on.
 *
 * The page jumps to the app by itself only there. On a computer the scheme has no handler,
 * and some desktop browsers answer an unprompted jump to one with an error page (Firefox)
 * or a modal alert (Safari), which `location.replace` would leave the visitor stuck on,
 * with no Back to the page that explains itself. iPadOS asks for the desktop site and
 * reports itself as a Mac; a touch screen is what gives it away.
 */
export function isAppDevice(userAgent: string, maxTouchPoints: number): boolean {
  if (/Android|iPhone|iPad|iPod/i.test(userAgent)) return true;
  return /Macintosh/.test(userAgent) && maxTouchPoints > 1;
}
