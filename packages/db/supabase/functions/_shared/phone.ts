/**
 * Iraqi phone normaliser — the edge-function COPY of @touch/core
 * `phone/iraq.ts`. Edge functions cannot import workspace packages (no import
 * map; deps are `npm:` specifiers), so this file MUST agree with
 * packages/core/src/phone/iraq.ts and with the SQL pair app.phone_digits /
 * app.phone_canon (migration 0065). packages/db/tests/phone-otp.test.ts runs
 * one fixture table through this file and the core module and fails on any
 * divergence.
 *
 * PURE: no `Deno.*`, no supabase-js, no fetch — importable under vitest.
 */

export const IRAQ_CC = '964';

const IRAQI_MOBILE_NSN = /^7\d{9}$/;

export function phoneDigits(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/[٠-٩۰-۹]/g, (ch) => {
      const code = ch.charCodeAt(0);
      return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
    })
    .replace(/[^0-9]/g, '');
}

export function phoneCanon(raw: unknown): string {
  return phoneDigits(raw)
    .replace(/^00/, '')
    .replace(/^(964|0)/, '');
}

export function toE164Iraq(raw: unknown): string | null {
  const canon = phoneCanon(raw);
  return IRAQI_MOBILE_NSN.test(canon) ? `+${IRAQ_CC}${canon}` : null;
}

export function isIraqiMobile(raw: unknown): boolean {
  return toE164Iraq(raw) !== null;
}

export function gotruePhone(e164: string): string {
  return e164.replace(/^\+/, '');
}

/** Digits with a leading '+': the E.164 form of whatever GoTrue hands the hook (digits only). */
export function e164FromGotrue(phone: unknown): string | null {
  const digits = phoneDigits(phone);
  return digits ? `+${digits}` : null;
}
