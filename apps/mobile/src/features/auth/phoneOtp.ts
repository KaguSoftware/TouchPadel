/**
 * Phone auth — the PURE half (no RN / expo / supabase imports; unit-tested under
 * node like social.ts). The Supabase calls live in ./api.ts; the screens are
 * app/sign-up.tsx, app/sign-in.tsx, app/forgot-password.tsx, app/verify-otp.tsx
 * and app/phone-sign-in.tsx (linking a number to a social account).
 *
 * Owner decision 2026-09-15: an account is created with a phone number and a
 * password, confirmed ONCE by a code (WhatsApp, or SMS if that number has no
 * WhatsApp — vendor routing, 2026-09-16); every later sign-in is phone +
 * password. The code is spent again only to recover a forgotten password or
 * to link a number. Email sign-up / sign-in left the guest app that day and
 * came back BESIDE phone on 2026-09-20 (Phase 2 plan O2; ./emailAuth.ts) —
 * phone remains the default segment on every screen.
 *
 * EXPO_PUBLIC_PHONE_OTP now gates only the optional number-linking flows
 * (Profile → Verify phone number, Edit profile's number change); sign-up,
 * sign-in and password recovery are phone-only and never hidden.
 */
import type { MessageKey } from '@touch/i18n';
import { composePhone, validatePhone } from '../profile/phone';
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

/**
 * A number from ANY country (owner decision 2026-09-15: phone sign-in is open
 * worldwide; the SMS gate's allowed_prefixes is '{""}'). The country comes
 * from the picker, the national digits from the field; the same length rule
 * the profile phone uses decides, and the result is the E.164 GoTrue expects.
 * Anything it cannot turn into a number is PHONE_INVALID before a paid code
 * is requested.
 */
export function validatePhoneInput(iso: string, national: string): { e164: string | null; error: PhoneValidation } {
  if (validatePhone(iso, national) !== null) return { e164: null, error: 'PHONE_INVALID' };
  const e164 = composePhone(iso, national);
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
  PHONE_NOT_ALLOWED: 'auth.phoneOtpInvalid',
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
      return 'auth.phoneOtpInvalid';
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

function isCodeOrMessage(err: unknown, codes: string[], pattern: RegExp): boolean {
  const code = codeOf(err);
  if (code && codes.includes(code)) return true;
  return pattern.test(errorMessageOf(err) ?? '');
}

/** Sign-up refused because a CONFIRMED account already owns the number. */
export function isPhoneTaken(err: unknown): boolean {
  return isCodeOrMessage(err, ['phone_exists', 'user_already_exists'], /already (registered|exists)/i);
}

export type PhoneSignInFailure = 'wrong-credentials' | 'phone-not-confirmed' | 'other';

/**
 * Why a phone + password sign-in failed. An unconfirmed number means the
 * sign-up's code was never entered: the screen sends a fresh one and takes the
 * guest to the code step rather than blaming the password.
 */
export function classifyPhoneSignIn(err: unknown): PhoneSignInFailure {
  if (isCodeOrMessage(err, ['invalid_credentials'], /invalid login credentials/i)) return 'wrong-credentials';
  if (isCodeOrMessage(err, ['phone_not_confirmed'], /phone not confirmed/i)) return 'phone-not-confirmed';
  return 'other';
}

/**
 * Forgot password asked for a code to a number no account uses. GoTrue answers
 * `otp_disabled` "Signups not allowed for otp" when shouldCreateUser is false —
 * the SAME code as a switched-off provider, so the message decides.
 */
export function isNoAccountForPhone(err: unknown): boolean {
  return /signups not allowed/i.test(errorMessageOf(err) ?? '');
}
