// The member-card token (loyalty build contracts §1.3, §3): `TP-<member_code>-<6 digits>`, the
// digits an RFC 6238 TOTP over the card's 20-byte secret. Computed offline on the phone and in
// the browser; app.loyalty_identify verifies it at the till with counter ± 2. The SQL twin is
// app.loyalty_totp; packages/db/tests/loyalty-totp-parity.test.ts runs both over one table.
import { phoneDigits } from '../phone/iraq';
import { hmacSha1 } from './sha1';

/** Crockford base32 without I, L, O, U: what `loyalty_cards.member_code` holds. */
export const MEMBER_CODE_RE = /^[0-9A-HJKMNP-TV-Z]{8}$/;
/** Fits the till's barcode wedge charset `[0-9A-Za-z-]` unchanged. */
export const MEMBER_TOKEN_RE = /^TP-([0-9A-HJKMNP-TV-Z]{8})-([0-9]{6})$/;

export interface MemberCard {
  member_code: string;
  /** RFC 4648 base32, no padding (32 characters for 20 bytes). */
  secret_b32: string;
  /** Seconds per code, `loyalty_settings.totp_step_seconds`. */
  step: number;
}

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Decode(s: string): Uint8Array {
  const clean = s.toUpperCase().replace(/=+$/, '');
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error('base32: bad character');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}

/** RFC 4226 HOTP, 6 digits. */
export function hotp(secret: Uint8Array, counter: number): string {
  const msg = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) {
    msg[i] = c & 0xff;
    c = Math.floor(c / 256);
  }
  const mac = hmacSha1(secret, msg);
  const off = mac[19]! & 0x0f;
  const bin =
    ((mac[off]! & 0x7f) << 24) | (mac[off + 1]! << 16) | (mac[off + 2]! << 8) | mac[off + 3]!;
  return String(bin % 1_000_000).padStart(6, '0');
}

/** The token to draw now, and how long until it changes. */
export function memberToken(
  card: MemberCard,
  nowMs: number,
): { token: string; secondsLeft: number } {
  const step = card.step > 0 ? card.step : 30;
  const secs = Math.floor(nowMs / 1000);
  const counter = Math.floor(secs / step);
  const otp = hotp(base32Decode(card.secret_b32), counter);
  return { token: `TP-${card.member_code}-${otp}`, secondsLeft: step - (secs % step) };
}

export type MemberInput =
  | { kind: 'token'; token: string; code: string; otp: string }
  | { kind: 'phone'; digits: string }
  | { kind: 'invalid' };

/**
 * What the till's one field holds: a scanned or typed token, or the phone number the guest
 * said. A phone needs 7–15 digits (the profiles_phone_format rule); the server matches it
 * exactly on `phone_key`, never partially.
 */
export function parseMemberInput(raw: string): MemberInput {
  const t = raw.trim().toUpperCase();
  const m = MEMBER_TOKEN_RE.exec(t);
  if (m) return { kind: 'token', token: t, code: m[1]!, otp: m[2]! };
  if (t.startsWith('TP-')) return { kind: 'invalid' };
  const digits = phoneDigits(raw);
  if (digits.length >= 7 && digits.length <= 15 && !/[A-Z]/.test(t))
    return { kind: 'phone', digits };
  return { kind: 'invalid' };
}
