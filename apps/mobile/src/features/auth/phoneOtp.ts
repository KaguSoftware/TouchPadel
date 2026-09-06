/**
 * Phone OTP — the PURE half (no RN / expo / supabase imports; unit-tested under
 * node like social.ts). The Supabase calls live in ./api.ts, the screens are
 * app/phone-sign-in.tsx and app/verify-otp.tsx.
 *
 * DORMANT vendor-addition scaffold (2026-09-05). SOW L259-260 excludes
 * phone/SMS one-time-code login; the owner asked for the base to exist so
 * activation is configuration, not code. Nothing renders unless
 * EXPO_PUBLIC_PHONE_OTP=on (eas.json per profile / .env locally) — see
 * docs/design/phone-otp-2026-09-05.md and docs/client/phone-otp-activation.md.
 */
import type { MessageKey } from '@touch/i18n';
import { toE164Iraq } from '@touch/core';
import { errorMessageOf, isTransportError } from '../../lib/network';

export const OTP_LENGTH = 6;
export const RESEND_COOLDOWN_S = 30;

/** Desk-created walk-ins carry a synthetic address (desk-customer-create/phone.ts). */
export const GUEST_EMAIL_DOMAIN = 'guest.touch.local';

/** The flag's grammar, separate from the env read so it is testable. Only the literal "on" enables. */
export function parsePhoneOtpFlag(value: string | undefined | null): boolean {
  return (value ?? '').trim().toLowerCase() === 'on';
}

/**
 * Read at call time, not module scope, so a test can never freeze it. The env
 * access stays a STATIC `process.env.EXPO_PUBLIC_…` member expression — that
 * is the only shape Expo inlines into the bundle.
 */
export function phoneOtpEnabled(): boolean {
  return parsePhoneOtpFlag(process.env.EXPO_PUBLIC_PHONE_OTP);
}

export type PhoneValidation = 'PHONE_INVALID' | null;

/** Strict: an Iraqi mobile in any accepted shape, else PHONE_INVALID (a code to a typo is money spent on nothing). */
export function validatePhoneInput(raw: string): { e164: string | null; error: PhoneValidation } {
  const e164 = toE164Iraq(raw);
  return e164 ? { e164, error: null } : { e164: null, error: 'PHONE_INVALID' };
}

/** Digits only, Arabic-Indic folded, capped at the code length — the code field's onChangeText. */
export function sanitizeOtpInput(raw: string): string {
  return raw
    .replace(/[٠-٩۰-۹]/g, (ch) => {
      const code = ch.charCodeAt(0);
      return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
    })
    .replace(/[^0-9]/g, '')
    .slice(0, OTP_LENGTH);
}

/**
 * A phone-only account has no email, and a desk-created walk-in has a synthetic
 * one. Neither can change a password (there is none / no mailbox to recover to),
 * so the change-password row is hidden for them.
 */
export function hasRealEmail(user: { email?: string | null } | null | undefined): boolean {
  const email = (user?.email ?? '').trim().toLowerCase();
  if (!email) return false;
  return !email.endsWith(`@${GUEST_EMAIL_DOMAIN}`);
}

/** Refusal reasons the send-sms-otp hook relays through GoTrue as the error message. */
const HOOK_REASON_KEY: Record<string, MessageKey> = {
  SMS_DISABLED: 'auth.phoneSignInUnavailable',
  PHONE_NOT_ALLOWED: 'auth.phoneInvalid',
  PHONE_RATE: 'auth.otpTooMany',
  DAILY_CAP: 'auth.otpSendFailed',
  SMS_SEND_FAILED: 'auth.otpSendFailed',
  UNAUTHORIZED: 'auth.phoneSignInUnavailable',
};

function codeOf(err: unknown): string | null {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code: unknown }).code;
    return typeof code === 'string' ? code : null;
  }
  return null;
}

/**
 * Map a GoTrue AuthApiError (by `code`, then by message), a relayed hook
 * refusal, or a transport failure to copy. GoTrue's `otp_expired` covers both a
 * wrong and a stale code, so both read as otpInvalid.
 */
export function mapOtpError(err: unknown): MessageKey {
  if (isTransportError(err)) return 'errors.network';
  const code = codeOf(err);
  switch (code) {
    case 'otp_expired':
      return 'auth.otpInvalid';
    case 'over_sms_send_rate_limit':
    case 'over_request_rate_limit':
      return 'auth.otpTooMany';
    case 'sms_send_failed':
      return 'auth.otpSendFailed';
    case 'phone_provider_disabled':
    case 'otp_disabled':
    case 'hook_timeout':
    case 'hook_timeout_after_retry':
    case 'hook_payload_invalid_content_type':
    case 'hook_payload_over_size_limit':
      return 'auth.phoneSignInUnavailable';
    case 'validation_failed':
      return 'auth.phoneInvalid';
    default:
      break;
  }
  const message = errorMessageOf(err) ?? '';
  for (const reason of Object.keys(HOOK_REASON_KEY)) {
    if (message.includes(reason)) return HOOK_REASON_KEY[reason] as MessageKey;
  }
  if (/token has expired or is invalid/i.test(message)) return 'auth.otpInvalid';
  if (/rate limit/i.test(message)) return 'auth.otpTooMany';
  if (/provider|not enabled|unsupported phone|otp.*disabled/i.test(message)) {
    return 'auth.phoneSignInUnavailable';
  }
  return 'errors.generic';
}
