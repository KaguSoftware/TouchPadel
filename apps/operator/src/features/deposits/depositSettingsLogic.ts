/**
 * The owner's online deposit rules, as typed and as stored (contract §2.3).
 *
 * Each rule is edited in the unit it is said in: the size as a percent of the
 * court price (stored in basis points), the payment window in minutes (stored
 * in seconds), and the cap as an amount or nothing at all (stored as null).
 * Like the booking rules beside it, a value the form cannot show exactly (a
 * 33.33 % set elsewhere) is only rewritten when the owner edits that field.
 *
 * Nothing here computes a deposit: the server rounds and clamps, and the guest
 * is shown the server's figure.
 */
import type { DepositMode, DepositSettings } from './depositApi';

/** The form as the owner types it. Numbers stay strings until they are checked. */
export interface DepositDraft {
  mode: DepositMode;
  /** Whole percent of the court price. */
  percent: string;
  minIqd: string;
  /** Empty means no cap. */
  maxIqd: string;
  windowMinutes: string;
  /** Keep the deposit when the desk marks a no-show (false: refund it). */
  forfeitNoShow: boolean;
}

export type DepositField = keyof DepositDraft;
export type DepositFieldError = 'wholeNumber' | 'range' | 'maxBelowMin';

/**
 * app.set_deposit_settings' bounds in the form's units: 100..10000 bp is
 * 1..100 %, and 120..1800 s is 2..30 min. A cap, when there is one, is at
 * least 1 IQD (0242); no cap is the empty field.
 */
export const DEPOSIT_RANGES = {
  percent: { min: 1, max: 100 },
  minIqd: { min: 0, max: 10_000_000 },
  maxIqd: { min: 1, max: 10_000_000 },
  windowMinutes: { min: 2, max: 30 },
} as const satisfies Partial<Record<DepositField, { min: number; max: number }>>;

export type RangedDepositField = keyof typeof DEPOSIT_RANGES;

/** The server's key for each field, for placing an INVALID_ARGUMENT refusal (its detail). */
export const DEPOSIT_SERVER_FIELD: Record<string, DepositField> = {
  deposit_mode: 'mode',
  deposit_percent_bp: 'percent',
  deposit_min_iqd: 'minIqd',
  deposit_max_iqd: 'maxIqd',
  deposit_window_seconds: 'windowMinutes',
  deposit_forfeit_no_show: 'forfeitNoShow',
};

export function bpToWholePercent(bp: number): number {
  return Math.round(bp / 100);
}

export function percentToBp(percent: number): number {
  return Math.round(percent * 100);
}

export function secondsToWholeMinutes(seconds: number): number {
  return Math.round(seconds / 60);
}

export function minutesToSeconds(minutes: number): number {
  return Math.round(minutes * 60);
}

export function draftFromDeposit(s: DepositSettings): DepositDraft {
  return {
    mode: s.deposit_mode,
    percent: String(bpToWholePercent(s.deposit_percent_bp)),
    minIqd: String(s.deposit_min_iqd),
    maxIqd: s.deposit_max_iqd == null ? '' : String(s.deposit_max_iqd),
    windowMinutes: String(secondsToWholeMinutes(s.deposit_window_seconds)),
    forfeitNoShow: s.deposit_forfeit_no_show,
  };
}

const WHOLE = /^\d+$/;

export function depositDraftErrors(d: DepositDraft): Partial<Record<DepositField, DepositFieldError>> {
  const errors: Partial<Record<DepositField, DepositFieldError>> = {};
  const check = (field: RangedDepositField, raw: string) => {
    const v = raw.trim();
    if (!WHOLE.test(v)) {
      errors[field] = 'wholeNumber';
      return;
    }
    const n = Number(v);
    const r = DEPOSIT_RANGES[field];
    if (n < r.min || n > r.max) errors[field] = 'range';
  };
  check('percent', d.percent);
  check('minIqd', d.minIqd);
  check('windowMinutes', d.windowMinutes);
  if (d.maxIqd.trim() !== '') {
    check('maxIqd', d.maxIqd);
    if (!errors.maxIqd && !errors.minIqd && Number(d.maxIqd.trim()) < Number(d.minIqd.trim())) errors.maxIqd = 'maxBelowMin';
  }
  return errors;
}

/**
 * Only what changed, in the server's keys and units; empty when nothing did.
 * Call it on a draft without errors: the numbers are read as typed.
 */
export function depositPatch(saved: DepositSettings, d: DepositDraft): Record<string, string | number | boolean | null> {
  const patch: Record<string, string | number | boolean | null> = {};
  if (d.mode !== saved.deposit_mode) patch.deposit_mode = d.mode;
  if (d.percent.trim() !== String(bpToWholePercent(saved.deposit_percent_bp))) patch.deposit_percent_bp = percentToBp(Number(d.percent.trim()));
  if (Number(d.minIqd.trim()) !== saved.deposit_min_iqd) patch.deposit_min_iqd = Number(d.minIqd.trim());
  const max = d.maxIqd.trim() === '' ? null : Number(d.maxIqd.trim());
  if (max !== (saved.deposit_max_iqd ?? null)) patch.deposit_max_iqd = max;
  if (d.windowMinutes.trim() !== String(secondsToWholeMinutes(saved.deposit_window_seconds))) {
    patch.deposit_window_seconds = minutesToSeconds(Number(d.windowMinutes.trim()));
  }
  if (d.forfeitNoShow !== saved.deposit_forfeit_no_show) patch.deposit_forfeit_no_show = d.forfeitNoShow;
  return patch;
}
