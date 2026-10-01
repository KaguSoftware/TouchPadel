/**
 * The owner's lesson rules for one branch, as typed and as stored
 * (docs/design/coaching/operator.md §5.12; app.coaching_settings /
 * app.set_coaching_settings, 0274; X20, R50, R56, R67).
 *
 * The form keeps numbers as strings until they are checked, sends only the
 * keys that changed, and places a server refusal on its field:
 * INVALID_ARGUMENT names the settings key in its detail, ONLINE_PAYMENT_OFF
 * (detail `provider` or `terms`) lands on the payment mode. The coach's share
 * is typed as a percent with up to two decimals and stored as basis points
 * (CD-5). The bounds mirror 0274's so a typo is caught before the round trip;
 * the server is still the wall.
 */
import type { CoachingSettings, LessonPaymentMode } from '../../coaching/lessonPayloads';

/** The form as the owner types it. */
export interface CoachingSettingsDraft {
  enabled: boolean;
  paymentMode: LessonPaymentMode;
  /** The coach's share as a percent, 0..100 with up to two decimals ("60", "62.5"). */
  sharePercent: string;
  pricesPublic: boolean;
  /** C-24, R56: upcoming coach-booked private lessons a coach may hold, 1..100. */
  maxOpenPrivate: string;
}

export type CoachingSettingsField = keyof CoachingSettingsDraft;
export type CoachingSettingsFieldError = 'wholeNumber' | 'range' | 'percent' | 'refused';

/** 0274's bound on `coach_max_open_private` (R56). */
export const COACH_MAX_OPEN_PRIVATE = { min: 1, max: 100 } as const;

/** `coach_share_bp` is 0..10000 basis points (CD-5). */
export const COACH_SHARE_BP_MAX = 10_000;

/** The server's key for each field (set_coaching_settings' patch keys, and its INVALID_ARGUMENT detail). */
export const COACHING_SERVER_FIELD: Record<string, CoachingSettingsField> = {
  coaching_enabled: 'enabled',
  lesson_payment_mode: 'paymentMode',
  coach_share_bp: 'sharePercent',
  lesson_prices_public: 'pricesPublic',
  coach_max_open_private: 'maxOpenPrivate',
};

/** A refusal's field: INVALID_ARGUMENT names the settings key in its detail. Anything else is not a field's. */
export function serverFieldOf(details: string | null | undefined): CoachingSettingsField | null {
  return details ? (COACHING_SERVER_FIELD[details.trim()] ?? null) : null;
}

/** Basis points as the percent the owner reads: 6000 → "60", 6250 → "62.5", 6255 → "62.55". */
export function bpToPercentText(bp: number | null | undefined): string {
  if (bp == null || !Number.isFinite(bp)) return '';
  const whole = Math.trunc(bp / 100);
  const cents = Math.abs(Math.round(bp) % 100);
  if (cents === 0) return String(whole);
  const frac = String(cents).padStart(2, '0').replace(/0$/, '');
  return `${whole}.${frac}`;
}

const PERCENT = /^(\d{1,3})(?:[.,](\d{1,2}))?$/;

/**
 * A typed percent as basis points, or null when it is not 0..100 with at most
 * two decimals. Read as text, never through a float, so "62.55" is exactly 6255.
 */
export function percentTextToBp(text: string): number | null {
  const m = PERCENT.exec(text.trim());
  if (!m) return null;
  const whole = Number(m[1]);
  const frac = Number((m[2] ?? '').padEnd(2, '0'));
  const bp = whole * 100 + frac;
  return bp >= 0 && bp <= COACH_SHARE_BP_MAX ? bp : null;
}

const str = (n: number | null) => (n == null ? '' : String(n));

export function draftFromCoachingSettings(s: CoachingSettings): CoachingSettingsDraft {
  return {
    enabled: s.coaching_enabled,
    paymentMode: s.lesson_payment_mode,
    sharePercent: bpToPercentText(s.coach_share_bp),
    pricesPublic: s.lesson_prices_public,
    maxOpenPrivate: str(s.coach_max_open_private),
  };
}

const WHOLE = /^\d+$/;

export function coachingSettingsErrors(
  d: CoachingSettingsDraft,
): Partial<Record<CoachingSettingsField, CoachingSettingsFieldError>> {
  const errors: Partial<Record<CoachingSettingsField, CoachingSettingsFieldError>> = {};
  if (percentTextToBp(d.sharePercent) === null) errors.sharePercent = 'percent';
  const max = d.maxOpenPrivate.trim();
  if (!WHOLE.test(max)) errors.maxOpenPrivate = 'wholeNumber';
  else {
    const n = Number(max);
    if (n < COACH_MAX_OPEN_PRIVATE.min || n > COACH_MAX_OPEN_PRIVATE.max)
      errors.maxOpenPrivate = 'range';
  }
  return errors;
}

/**
 * Only what changed, in the server's keys; empty when nothing did. Call it on
 * a draft without errors. A value the server sent as null (an unreadable
 * figure) counts as changed once typed.
 */
export function coachingSettingsPatch(
  saved: CoachingSettings,
  d: CoachingSettingsDraft,
): Record<string, number | boolean | string> {
  const patch: Record<string, number | boolean | string> = {};
  if (d.enabled !== saved.coaching_enabled) patch.coaching_enabled = d.enabled;
  if (d.paymentMode !== saved.lesson_payment_mode) patch.lesson_payment_mode = d.paymentMode;
  const bp = percentTextToBp(d.sharePercent);
  if (bp !== null && bp !== saved.coach_share_bp) patch.coach_share_bp = bp;
  if (d.pricesPublic !== saved.lesson_prices_public) patch.lesson_prices_public = d.pricesPublic;
  const max = Number(d.maxOpenPrivate.trim());
  if (WHOLE.test(d.maxOpenPrivate.trim()) && max !== saved.coach_max_open_private) {
    patch.coach_max_open_private = max;
  }
  return patch;
}

/** Why the two online payment modes cannot be chosen (C-26, R50, R67). */
export type OnlineBlockReason = 'provider' | 'terms';

/** The online modes (`online_optional`, `online_required`). */
export function isOnlineMode(mode: LessonPaymentMode): boolean {
  return mode !== 'desk';
}

/**
 * The reasons the online choices are disabled, in the order they are shown.
 * R67: `online_payments_available` is true once the lessons terms version is
 * live; until then `set_coaching_settings` refuses an online mode with
 * ONLINE_PAYMENT_OFF `terms`. A missing Qi provider is not readable here: it
 * comes back as ONLINE_PAYMENT_OFF `provider` on a save (or later from
 * lesson-begin), and `refused` carries that detail so its line joins the list.
 */
export function onlineModeBlock(
  s: Pick<CoachingSettings, 'online_payments_available'>,
  refused: OnlineBlockReason | null = null,
): OnlineBlockReason[] {
  const out: OnlineBlockReason[] = [];
  if (refused === 'provider') out.push('provider');
  if (!s.online_payments_available || refused === 'terms') out.push('terms');
  return out;
}

/** ONLINE_PAYMENT_OFF's detail, when it names a reason the payment mode can show. */
export function onlineRefusalOf(details: string | null | undefined): OnlineBlockReason | null {
  const d = (details ?? '').trim();
  return d === 'provider' || d === 'terms' ? d : null;
}
