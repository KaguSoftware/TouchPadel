/**
 * Pure helpers for the rates editor (spec 06.25).
 *
 * Overlap detection is DISPLAY ONLY: `app.price_slot` (0007) is the authority
 * and resolves overlaps deterministically (court-specific beats all-courts,
 * then higher priority). The editor warns so a manager can see that two rules
 * compete for the same slot; it never changes what the server would charge.
 * Comparisons are on 'HH:MM' strings (lexical order == clock order), so there
 * is no time arithmetic here; an overnight window (start > end) is split into
 * its two clock intervals.
 */

export interface RateRuleLike {
  id: string;
  name: string;
  court_id: string | null;
  days_of_week: number[];
  /** 'HH:MM' or 'HH:MM:SS' */
  start_time: string;
  end_time: string;
  priority: number;
  valid_from: string | null;
  valid_to: string | null;
  is_active: boolean;
}

export interface Overlap {
  ruleId: string;
  otherId: string;
  otherName: string;
  /** 0 = Sunday, the first weekday the two rules share. */
  weekday: number;
}

type Interval = [string, string];

/** Clock intervals of a rule as half-open 'HH:MM' pairs; overnight splits in two. */
export function clockIntervals(start: string, end: string): Interval[] {
  const s = start.slice(0, 5);
  const e = end.slice(0, 5);
  if (s === e) return [];
  if (s < e) return [[s, e]];
  return [
    [s, '24:00'],
    ['00:00', e],
  ];
}

function intervalsOverlap(a: Interval, b: Interval): boolean {
  return a[0] < b[1] && b[0] < a[1];
}

function courtsMeet(a: string | null, b: string | null): boolean {
  return a === null || b === null || a === b;
}

/** Whether two validity date ranges (YYYY-MM-DD, null = open) can meet. */
export function validityMeets(a: RateRuleLike, b: RateRuleLike): boolean {
  const aFrom = a.valid_from ?? '0000-00-00';
  const aTo = a.valid_to ?? '9999-99-99';
  const bFrom = b.valid_from ?? '0000-00-00';
  const bTo = b.valid_to ?? '9999-99-99';
  return aFrom <= bTo && bFrom <= aTo;
}

export function rulesOverlap(a: RateRuleLike, b: RateRuleLike): number | null {
  if (a.id === b.id) return null;
  if (!a.is_active || !b.is_active) return null;
  if (!courtsMeet(a.court_id, b.court_id)) return null;
  if (!validityMeets(a, b)) return null;
  const shared = a.days_of_week.filter((d) => b.days_of_week.includes(d)).sort((x, y) => x - y);
  if (shared.length === 0) return null;
  const ai = clockIntervals(a.start_time, a.end_time);
  const bi = clockIntervals(b.start_time, b.end_time);
  const clash = ai.some((x) => bi.some((y) => intervalsOverlap(x, y)));
  return clash ? shared[0]! : null;
}

/** Every (rule, other) pair that competes for at least one slot. Symmetric: both directions are listed. */
export function findOverlaps(rules: readonly RateRuleLike[]): Overlap[] {
  const out: Overlap[] = [];
  for (const a of rules) {
    for (const b of rules) {
      if (a.id === b.id) continue;
      const day = rulesOverlap(a, b);
      if (day !== null) out.push({ ruleId: a.id, otherId: b.id, otherName: b.name, weekday: day });
    }
  }
  return out;
}

export function overlapsFor(overlaps: readonly Overlap[], ruleId: string): Overlap[] {
  return overlaps.filter((o) => o.ruleId === ruleId);
}

/** Which of the seven weekday keys a rule covers, in Sunday-first order. */
export const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

export function coversEveryDay(days: readonly number[]): boolean {
  return DAY_KEYS.every((_, i) => days.includes(i));
}
