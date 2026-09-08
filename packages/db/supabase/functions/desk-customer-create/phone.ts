/**
 * desk-customer-create — PURE helpers, no `Deno.*`, no supabase-js, no fetch,
 * so they run unchanged under Deno (the edge function) and under vitest
 * (tests/customers.test.ts), the same arrangement as _shared/telegram.ts.
 *
 * `phoneDigits` MUST agree with `app.phone_digits(text)` (migration 0065):
 * Arabic-Indic U+0660–U+0669 and Extended Arabic-Indic U+06F0–U+06F9 to ASCII,
 * then every non-digit dropped. The edge function uses it to refuse
 * INVALID_PHONE before touching GoTrue and to synthesise the account email;
 * the RPC re-checks with the SQL twin.
 */

/** 7–15 digits: an Iraqi mobile is 11 (07XX XXX XXXX) or 13 with the +964 prefix. */
export const MIN_PHONE_DIGITS = 7;
export const MAX_PHONE_DIGITS = 15;

/** The domain every desk-created guest account lives under when no email was given. */
export const GUEST_EMAIL_DOMAIN = 'guest.touch.local';

export function phoneDigits(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/[٠-٩۰-۹]/g, (ch) => {
      const code = ch.charCodeAt(0);
      return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
    })
    .replace(/[^0-9]/g, '');
}

export function isValidPhone(raw: unknown): boolean {
  const n = phoneDigits(raw).length;
  return n >= MIN_PHONE_DIGITS && n <= MAX_PHONE_DIGITS;
}

/**
 * A walk-in with no email still needs an auth identity so they can claim the
 * account later (build plan §0). `<digits>@guest.touch.local` is unique per
 * phone, obviously synthetic to anyone reading the users list, and can never
 * collide with a real mailbox because .local is not routable.
 */
export function syntheticEmail(phone: string): string {
  return `${phoneDigits(phone)}@${GUEST_EMAIL_DOMAIN}`;
}

export function isSyntheticEmail(email: string): boolean {
  return email.toLowerCase().endsWith(`@${GUEST_EMAIL_DOMAIN}`);
}

/** A loose shape check; GoTrue is the authority on what it accepts. */
export function looksLikeEmail(value: unknown): value is string {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}
