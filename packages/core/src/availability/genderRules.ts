/**
 * Gender hours (migration 0353, `court_gender_rules`): courts kept for women
 * or men at set times. The server is the authority — `app.slot_gender_rules`
 * behind the `reservations_gender_guard` and `matches_gender_guard` triggers —
 * and this mirrors it so the phone's grid and the desk's calendar show the
 * same kept windows before anyone taps.
 *
 * The rules, as the SQL has them:
 * - A window belongs to the venue-local day it STARTS on. An end at or before
 *   the start runs past midnight into the next day ("Fri 22:00–02:00" is
 *   Friday night), so the day before a period's first day is tried too.
 * - Any overlap counts: a 90-minute booking from 15:30 touches a window from
 *   16:00. Half-open intervals, so a booking ending at 16:00 does not.
 * - `court_id` null keeps every court of the branch; a court rule keeps only
 *   its court; `courtId` null asks about any court (an open match before it
 *   has one).
 * - Off rules keep nothing; `valid_from` / `valid_to` bound the day a window
 *   starts on.
 */
import { localParts, wallTimeToUtc, dayOfWeekOfDate } from '../time/tz';

export type Gender = 'female' | 'male';

export interface GenderRuleLike {
  id: string;
  gender: Gender | string;
  court_id: string | null;
  /** 0 = Sunday .. 6 = Saturday, the days a window starts on. */
  days_of_week: readonly number[];
  /** 'HH:MM' or 'HH:MM:SS'. */
  start_time: string;
  end_time: string;
  valid_from: string | null;
  valid_to: string | null;
  is_active: boolean;
}

/** Minutes since midnight of 'HH:MM[:SS]'; '24:00' is 1440. */
export function clockMinutes(value: string): number {
  const m = /^(\d{1,2}):(\d{2})/.exec(value);
  if (!m) throw new RangeError(`expected 'HH:MM', got '${value}'`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** A window whose end is at or before its start runs past midnight. */
export function runsPastMidnight(rule: Pick<GenderRuleLike, 'start_time' | 'end_time'>): boolean {
  return clockMinutes(rule.end_time) <= clockMinutes(rule.start_time);
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function isGender(value: string): value is Gender {
  return value === 'female' || value === 'male';
}

/**
 * The genders (sorted: female, male) of the active rules the period
 * [startAt, endAt) touches on `courtId` (null: any court), or [] when none.
 */
export function slotGenderRules(
  rules: readonly GenderRuleLike[],
  courtId: string | null,
  startAt: Date,
  endAt: Date,
  tz: string,
): Gender[] {
  if (!(endAt.getTime() > startAt.getTime())) return [];
  const live = rules.filter(
    (r) => r.is_active && isGender(r.gender) && (courtId === null || r.court_id === null || r.court_id === courtId),
  );
  if (live.length === 0) return [];
  const first = addDays(localParts(startAt, tz).date, -1);
  const last = localParts(new Date(endAt.getTime() - 1), tz).date;
  const kept = new Set<Gender>();
  for (let day = first; day <= last; day = addDays(day, 1)) {
    const dow = dayOfWeekOfDate(day);
    for (const r of live) {
      if (kept.has(r.gender as Gender)) continue;
      if (!r.days_of_week.includes(dow)) continue;
      if (r.valid_from && day < r.valid_from) continue;
      if (r.valid_to && day > r.valid_to) continue;
      const s = clockMinutes(r.start_time);
      const e = clockMinutes(r.end_time) + (runsPastMidnight(r) ? 1440 : 0);
      const ws = wallTimeToUtc(day, s, tz).getTime();
      const we = wallTimeToUtc(day, e, tz).getTime();
      if (ws < endAt.getTime() && we > startAt.getTime()) kept.add(r.gender as Gender);
    }
  }
  return (['female', 'male'] as const).filter((g) => kept.has(g));
}

/** What the server says to a booking on a slot kept for `kept`, by the booker's gender. */
export type GenderVerdict = 'open' | 'kept_ok' | 'gender_required' | 'restricted';

export function genderVerdict(kept: readonly Gender[], gender: Gender | null | undefined): GenderVerdict {
  if (kept.length === 0) return 'open';
  if (!gender) return 'gender_required';
  return kept.every((k) => k === gender) ? 'kept_ok' : 'restricted';
}

/** The one gender a slot is kept for, 'both' when two rules disagree, null when open. */
export function keptFor(kept: readonly Gender[]): Gender | 'both' | null {
  if (kept.length === 0) return null;
  return kept.length === 1 ? kept[0]! : 'both';
}

/** The open-match category a kept window allows (the matches_gender_guard rule), or null for none. */
export function matchCategoryFor(kept: readonly Gender[]): 'women' | 'men' | null {
  const one = keptFor(kept);
  return one === 'female' ? 'women' : one === 'male' ? 'men' : null;
}

export interface GenderRuleClash {
  ruleId: string;
  otherId: string;
  /** The first weekday (0 = Sunday) the two windows meet on. */
  weekday: number;
}

function datesMeet(a: GenderRuleLike, b: GenderRuleLike): boolean {
  return (a.valid_from ?? '0000-00-00') <= (b.valid_to ?? '9999-99-99') && (b.valid_from ?? '0000-00-00') <= (a.valid_to ?? '9999-99-99');
}

/** Week-minute intervals of a rule (a Saturday-night window wraps into Sunday). */
function weekIntervals(r: GenderRuleLike): { day: number; s: number; e: number }[] {
  const s = clockMinutes(r.start_time);
  const e = clockMinutes(r.end_time) + (runsPastMidnight(r) ? 1440 : 0);
  return r.days_of_week.flatMap((day) => {
    const base = day * 1440;
    return [
      { day, s: base + s, e: base + e },
      { day, s: base + s - 7 * 1440, e: base + e - 7 * 1440 },
    ];
  });
}

/**
 * Pairs of active rules for different genders that keep the same court at the
 * same time: nobody can book there then (the server answers "both"). Each pair
 * once, in rule order. Display only.
 */
export function findGenderClashes(rules: readonly GenderRuleLike[]): GenderRuleClash[] {
  const out: GenderRuleClash[] = [];
  rules.forEach((a, i) => {
    for (const b of rules.slice(i + 1)) {
      if (!a.is_active || !b.is_active || a.gender === b.gender) continue;
      if (a.court_id !== null && b.court_id !== null && a.court_id !== b.court_id) continue;
      if (!datesMeet(a, b)) continue;
      const ai = weekIntervals(a);
      const bi = weekIntervals(b);
      const hit = ai.find((x) => bi.some((y) => x.s < y.e && y.s < x.e));
      if (hit) out.push({ ruleId: a.id, otherId: b.id, weekday: hit.day });
    }
  });
  return out;
}
