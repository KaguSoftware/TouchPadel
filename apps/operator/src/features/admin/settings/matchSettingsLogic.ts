/**
 * The owner's open-match rules, as typed and as stored (docs/design/open-matches/
 * operator.md §5.16; app.match_settings / app.set_match_settings, 0257).
 *
 * Two rules belong to the branch in scope (whether open matches run here, and
 * the fill deadline) and two to every branch (the ticket price and how many
 * filling matches one player may hold). The form keeps numbers as strings
 * until they are checked, sends only the keys that changed, and places a
 * server refusal (INVALID_ARGUMENT, detail = the settings key) on its field.
 * The bounds mirror 0257's so a typo is caught before the round trip; the
 * server is still the wall.
 */
import type { MatchSettings } from '../../matches/matchPayloads';

/** The form as the owner types it. */
export interface MatchSettingsDraft {
  enabled: boolean;
  /** Minutes before the start by which a match must be full (OM-22). */
  deadlineMinutes: string;
  /** IQD, chain-wide (OM-46). */
  priceIqd: string;
  /** Chain-wide (OM-37). */
  maxFilling: string;
}

export type MatchSettingsField = keyof MatchSettingsDraft;
export type MatchSettingsFieldError = 'wholeNumber' | 'range' | 'step' | 'refused';

/** 0257's bounds. The price also moves in steps of 250 IQD. */
export const MATCH_SETTINGS_RANGES = {
  deadlineMinutes: { min: 60, max: 2880 },
  priceIqd: { min: 1_000, max: 1_000_000 },
  maxFilling: { min: 1, max: 10 },
} as const satisfies Partial<Record<MatchSettingsField, { min: number; max: number }>>;

export type RangedMatchField = keyof typeof MATCH_SETTINGS_RANGES;

export const TICKET_PRICE_STEP = 250;

/** The server's key for each field (set_match_settings' patch keys, and its INVALID_ARGUMENT detail). */
export const MATCH_SERVER_FIELD: Record<string, MatchSettingsField> = {
  matches_enabled: 'enabled',
  match_fill_deadline_minutes: 'deadlineMinutes',
  match_ticket_price_iqd: 'priceIqd',
  max_filling_matches_per_guest: 'maxFilling',
};

/** The fields that apply to every branch, under the "Changing these changes them at every branch" lead. */
export const CHAIN_FIELDS: readonly MatchSettingsField[] = ['priceIqd', 'maxFilling'];

/** A refusal's field: INVALID_ARGUMENT names the settings key in its detail. Anything else is not a field's. */
export function serverFieldOf(details: string | null | undefined): MatchSettingsField | null {
  return details ? (MATCH_SERVER_FIELD[details.trim()] ?? null) : null;
}

const str = (n: number | null) => (n == null ? '' : String(n));

export function draftFromMatchSettings(s: MatchSettings): MatchSettingsDraft {
  return {
    enabled: s.matches_enabled,
    deadlineMinutes: str(s.match_fill_deadline_minutes),
    priceIqd: str(s.match_ticket_price_iqd),
    maxFilling: str(s.max_filling_matches_per_guest),
  };
}

const WHOLE = /^\d+$/;

export function matchSettingsErrors(d: MatchSettingsDraft): Partial<Record<MatchSettingsField, MatchSettingsFieldError>> {
  const errors: Partial<Record<MatchSettingsField, MatchSettingsFieldError>> = {};
  const check = (field: RangedMatchField, raw: string) => {
    const v = raw.trim();
    if (!WHOLE.test(v)) {
      errors[field] = 'wholeNumber';
      return;
    }
    const n = Number(v);
    const r = MATCH_SETTINGS_RANGES[field];
    if (n < r.min || n > r.max) errors[field] = 'range';
  };
  check('deadlineMinutes', d.deadlineMinutes);
  check('priceIqd', d.priceIqd);
  check('maxFilling', d.maxFilling);
  if (!errors.priceIqd && Number(d.priceIqd.trim()) % TICKET_PRICE_STEP !== 0) errors.priceIqd = 'step';
  return errors;
}

/**
 * Only what changed, in the server's keys; empty when nothing did. Call it on
 * a draft without errors: the numbers are read as typed. A value the server
 * sent as null (an unreadable figure) counts as changed once typed.
 */
export function matchSettingsPatch(saved: MatchSettings, d: MatchSettingsDraft): Record<string, number | boolean> {
  const patch: Record<string, number | boolean> = {};
  if (d.enabled !== saved.matches_enabled) patch.matches_enabled = d.enabled;
  const num = (field: RangedMatchField, key: string, was: number | null) => {
    const v = Number(d[field].trim());
    if (v !== was) patch[key] = v;
  };
  num('deadlineMinutes', 'match_fill_deadline_minutes', saved.match_fill_deadline_minutes);
  num('priceIqd', 'match_ticket_price_iqd', saved.match_ticket_price_iqd);
  num('maxFilling', 'max_filling_matches_per_guest', saved.max_filling_matches_per_guest);
  return patch;
}
