/**
 * send-sms-otp — PURE helpers (no `Deno.*`, no supabase-js, no fetch), shared
 * by the edge function and packages/db/tests/phone-otp.test.ts.
 *
 * The hook payload GoTrue POSTs (Send SMS hook):
 *   { user: { id, phone, email?, ... }, sms: { otp: "561166", sms_type?: "sms" | "phone_change" | "reauthentication" } }
 * `user.phone` is digits without '+'. For a phone CHANGE the payload's
 * user.phone is the NEW number GoTrue is confirming.
 *
 * The hook's error contract: a JSON body `{ error: { http_code, message } }`
 * with a non-2xx status makes GoTrue fail the client's signInWithOtp with
 * that status and message — which is how a refusal reason reaches the app
 * (features/auth/phoneOtp.ts maps the message back to copy).
 */
import { e164FromGotrue, phoneCanon } from '../_shared/phone.ts';

export interface HookPayload {
  userId: string | null;
  /** E.164 with '+'. */
  phoneE164: string;
  phoneCanon: string;
  otp: string;
  purpose: 'sms' | 'phone_change' | 'reauthentication';
}

export type ParseOutcome = { ok: true; payload: HookPayload } | { ok: false; reason: string };

export function parseHookPayload(json: unknown): ParseOutcome {
  if (!json || typeof json !== 'object') return { ok: false, reason: 'body must be a JSON object' };
  const body = json as { user?: unknown; sms?: unknown };
  const user = (body.user ?? {}) as { id?: unknown; phone?: unknown };
  const sms = (body.sms ?? {}) as { otp?: unknown; sms_type?: unknown };

  const phoneE164 = e164FromGotrue(user.phone);
  if (!phoneE164) return { ok: false, reason: 'user.phone missing' };
  const otp = typeof sms.otp === 'string' ? sms.otp.trim() : '';
  if (!/^\d{4,10}$/.test(otp)) return { ok: false, reason: 'sms.otp missing' };

  const rawType = typeof sms.sms_type === 'string' ? sms.sms_type : 'sms';
  const purpose: HookPayload['purpose'] =
    rawType === 'phone_change' || rawType === 'reauthentication' ? rawType : 'sms';

  return {
    ok: true,
    payload: {
      userId: typeof user.id === 'string' && user.id ? user.id : null,
      phoneE164,
      phoneCanon: phoneCanon(phoneE164),
      otp,
      purpose,
    },
  };
}

/**
 * The message. ONE segment: Arabic forces UCS-2, whose single-segment limit is
 * 70 UTF-16 code units — a longer text bills as two messages on every send.
 * Bilingual on purpose (the app runs in EN or AR; the SMS cannot know which).
 * Enforced by test: renderTemplate(code).length <= 70 for a 6-digit code.
 */
export const TEMPLATE_MAX_UNITS = 70;

export function renderTemplate(code: string): string {
  return `Touch Padel: ${code}\nرمز الدخول: ${code}`;
}

/** UTF-16 code units — what the GSM/UCS-2 segment counter sees. */
export function templateUnits(text: string): number {
  return text.length;
}

/** The hook error body GoTrue understands. */
export function hookError(
  httpCode: number,
  message: string,
): { error: { http_code: number; message: string } } {
  return { error: { http_code: httpCode, message } };
}

/** Which HTTP status a gate refusal maps to (429 for rate, 403 for policy). */
export function statusForRefusal(reason: string): number {
  switch (reason) {
    case 'PHONE_RATE':
    case 'DAILY_CAP':
      return 429;
    case 'SMS_DISABLED':
    case 'PHONE_NOT_ALLOWED':
      return 403;
    default:
      return 400;
  }
}
