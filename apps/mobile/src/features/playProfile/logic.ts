/**
 * The guest's play profile (docs/design/play-coaches/contracts-2026-10-11.md
 * §4.1, §8): three optional answers from the sign-up survey and when it was
 * answered or skipped. PURE (no RN, no supabase) so vitest runs it in node.
 *
 * The survey is the ONE place the app asks about the player (2026-10-12): the
 * three play questions and, while the profile has none, the gender (OM-28,
 * `set_my_gender`, set once; the front desk corrects it). The match,
 * tournament and coaches screens no longer ask: they send the guest here.
 *
 *   play_level      new | beginner | intermediate | advanced
 *   play_years      never | under_one | one_to_three | three_plus
 *   play_wants      a subset of matches | tournaments | lessons
 *   play_survey_at  stamped on every save, a skip included; null = never asked
 *
 * Every read goes through `playProfileOf`, which is defensive on purpose: the
 * own profile is persisted to disk, so a row cached by a build from before
 * 0334 carries none of the four keys, and a value this build has never heard
 * of reads as unanswered rather than as a guess.
 */

export const PLAY_LEVELS = ['new', 'beginner', 'intermediate', 'advanced'] as const;
export const PLAY_YEARS = ['never', 'under_one', 'one_to_three', 'three_plus'] as const;
export const PLAY_WANTS = ['matches', 'tournaments', 'lessons'] as const;

export type PlayLevel = (typeof PLAY_LEVELS)[number];
export type PlayYears = (typeof PLAY_YEARS)[number];
export type PlayWant = (typeof PLAY_WANTS)[number];

/** What the guest said. Any answer may be missing: every question is optional. */
export interface PlayAnswers {
  level: PlayLevel | null;
  years: PlayYears | null;
  /** In vocabulary order, no repeats; empty when not answered. */
  wants: PlayWant[];
}

export interface PlayProfile extends PlayAnswers {
  /** ISO time of the last save or skip; null = the survey was never shown to this account. */
  answeredAt: string | null;
}

/** Every step the survey can ask, in order. Gender is asked only while unset. */
export const SURVEY_STEPS = ['level', 'years', 'wants', 'gender'] as const;
export type SurveyStep = (typeof SURVEY_STEPS)[number];

/** The gender step's tiles. `none` ("Prefer not to say") writes nothing. */
// No "prefer not to say": a gender is a must for every account (0353, Majed 2026-10-19).
export const GENDER_CHOICES = ['female', 'male'] as const;
export type GenderChoice = (typeof GENDER_CHOICES)[number];

/**
 * The steps one run of the survey asks. `genderOnly` is the match and
 * tournament screens' way in (`step=gender`): that question alone. Otherwise
 * the three play questions, then the gender while the profile has none.
 */
export function surveyStepsFor(o: { askGender: boolean; genderOnly: boolean }): SurveyStep[] {
  if (o.genderOnly) return ['gender'];
  return SURVEY_STEPS.filter((s) => s !== 'gender' || o.askGender);
}

/** What `set_my_gender` should store for a choice; null writes nothing. */
export function genderToSave(choice: GenderChoice | null): 'female' | 'male' | null {
  return choice === 'female' || choice === 'male' ? choice : null;
}

export const EMPTY_ANSWERS: PlayAnswers = { level: null, years: null, wants: [] };

function oneOf<T extends string>(list: readonly T[], value: unknown): T | null {
  return typeof value === 'string' && (list as readonly string[]).includes(value) ? (value as T) : null;
}

export function parseLevel(value: unknown): PlayLevel | null {
  return oneOf(PLAY_LEVELS, value);
}

export function parseYears(value: unknown): PlayYears | null {
  return oneOf(PLAY_YEARS, value);
}

/** Known values only, once each, in vocabulary order. Anything else is an empty list. */
export function parseWants(value: unknown): PlayWant[] {
  if (!Array.isArray(value)) return [];
  return PLAY_WANTS.filter((w) => value.includes(w));
}

function parseStamp(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  return Number.isNaN(Date.parse(value)) ? null : value;
}

/**
 * The play profile from the own-profile row (or `app.set_my_play_profile`'s
 * jsonb, which has the same four keys). Null when it cannot be known yet: no
 * row, or a row without the `play_survey_at` key (cached before 0334, or the
 * column not deployed). A row that HAS the key always yields a profile.
 */
export function playProfileOf(row: unknown): PlayProfile | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  if (!('play_survey_at' in r)) return null;
  return {
    level: parseLevel(r.play_level),
    years: parseYears(r.play_years),
    wants: parseWants(r.play_wants),
    answeredAt: parseStamp(r.play_survey_at),
  };
}

/** True when at least one question has an answer. */
export function hasAnswers(a: PlayAnswers | null | undefined): boolean {
  return !!a && (a.level !== null || a.years !== null || a.wants.length > 0);
}

/**
 * Does a "how long have you played" answer fit the level? Every level past
 * "Just starting" says the guest has played (a rally, the walls, competing),
 * so "Not yet" fits only `new`, or no level. Every other pairing is possible
 * (a tennis player can be Advanced within a year), so nothing else is refused.
 */
export function yearsFitLevel(level: PlayLevel | null, years: PlayYears): boolean {
  return years !== 'never' || level === null || level === 'new';
}

/** The answers with a new level; a years answer it contradicts is dropped, to be asked again. */
export function withLevel(a: PlayAnswers, level: PlayLevel): PlayAnswers {
  return { ...a, level, years: a.years && !yearsFitLevel(level, a.years) ? null : a.years };
}

/** Saved answers made consistent: a pair stored before the rule loses its years answer. */
export function consistentAnswers(a: PlayAnswers): PlayAnswers {
  return a.level !== null && a.years !== null && !yearsFitLevel(a.level, a.years) ? { ...a, years: null } : a;
}

/** Add or remove one want, keeping the vocabulary order. */
export function toggleWant(wants: readonly PlayWant[], want: PlayWant): PlayWant[] {
  const has = wants.includes(want);
  return PLAY_WANTS.filter((w) => (w === want ? !has : wants.includes(w)));
}

/** `app.set_my_play_profile`'s arguments: an unanswered question goes as null. */
export function surveyArgs(a: PlayAnswers): {
  p_level: PlayLevel | null;
  p_years: PlayYears | null;
  p_wants: PlayWant[] | null;
} {
  return {
    p_level: a.level,
    p_years: a.years,
    p_wants: a.wants.length > 0 ? [...a.wants] : null,
  };
}

/** The four columns as the own-profile row carries them, for writing a save into the cache. */
export function rowPatchOf(p: PlayProfile): {
  play_level: PlayLevel | null;
  play_years: PlayYears | null;
  play_wants: PlayWant[] | null;
  play_survey_at: string | null;
} {
  return {
    play_level: p.level,
    play_years: p.years,
    play_wants: p.wants.length > 0 ? [...p.wants] : null,
    play_survey_at: p.answeredAt,
  };
}

/**
 * The coach level a guest's level matches (§4.2): `new` reads as `beginner`.
 * Null when the level is unknown, meaning "All".
 */
export function coachLevelOf(level: PlayLevel | null | undefined): 'beginner' | 'intermediate' | 'advanced' | null {
  if (level === 'new' || level === 'beginner') return 'beginner';
  if (level === 'intermediate' || level === 'advanced') return level;
  return null;
}

/** The step after `step` in `steps`, or null after the last (or for a step not in it). */
export function nextStep(steps: readonly SurveyStep[], step: SurveyStep): SurveyStep | null {
  const i = steps.indexOf(step);
  return i < 0 ? null : (steps[i + 1] ?? null);
}

/** The step before `step` in `steps`, or null on the first (or for a step not in it). */
export function previousStep(steps: readonly SurveyStep[], step: SurveyStep): SurveyStep | null {
  const i = steps.indexOf(step);
  return i > 0 ? (steps[i - 1] ?? null) : null;
}
