/**
 * The pure rules behind Coach pay's "this month so far" (`CoachesThisMonth`,
 * 0321): the server's `live` rows, who is getting what at the figures now, and
 * the few numbers the small analytics band reads off them. No React, no
 * fetches. Every money figure is the server's; the only arithmetic here is a
 * sum of those figures, an average per lesson and a share of the total, all
 * display-only.
 */
import type { Locale } from '@touch/i18n';
import type { LiveCoachRow } from '../../coaching/lessonPayloads';
import { coachOf, isOtherBranch } from './statementsLogic';

export interface LiveTotals {
  /** Distinct coaches (a coach at two branches counts once). */
  coaches: number;
  lessons: number;
  collected: number;
  courtShare: number;
  coachIqd: number;
  privateLessons: number;
  groupLessons: number;
  courseLessons: number;
}

const n = (v: number | null): number => v ?? 0;

export function liveTotals(rows: readonly LiveCoachRow[]): LiveTotals {
  const t: LiveTotals = {
    coaches: new Set(rows.map((r) => r.coach_id)).size,
    lessons: 0,
    collected: 0,
    courtShare: 0,
    coachIqd: 0,
    privateLessons: 0,
    groupLessons: 0,
    courseLessons: 0,
  };
  for (const r of rows) {
    t.lessons += n(r.lessons_count);
    t.collected += n(r.collected_iqd);
    t.courtShare += n(r.court_share_iqd);
    t.coachIqd += n(r.coach_iqd);
    t.privateLessons += n(r.private_count);
    t.groupLessons += n(r.group_count);
    t.courseLessons += n(r.course_count);
  }
  return t;
}

/** What the coaches earn per lesson taught, rounded to a whole dinar; null with no lessons. */
export function averagePerLesson(t: Pick<LiveTotals, 'lessons' | 'coachIqd'>): number | null {
  return t.lessons > 0 ? Math.round(t.coachIqd / t.lessons) : null;
}

/** A row's whole-number percent of everyone's coach share; null when nobody has earned anything yet. */
export function shareOfTotal(row: Pick<LiveCoachRow, 'coach_iqd'>, total: number): number | null {
  if (total <= 0) return null;
  return Math.round((n(row.coach_iqd) / total) * 100);
}

/** The coach with the largest share, once anything has been earned; null before. */
export function topEarner(rows: readonly LiveCoachRow[]): LiveCoachRow | null {
  let best: LiveCoachRow | null = null;
  for (const r of rows) if (n(r.coach_iqd) > 0 && (best === null || n(r.coach_iqd) > n(best.coach_iqd))) best = r;
  return best;
}

/** The rail branch's rows first, then by coach share (largest first), then by name. */
export function orderLive(
  rows: readonly LiveCoachRow[],
  locale: Locale,
  railBranch: string | null,
): LiveCoachRow[] {
  return [...rows].sort((a, b) => {
    const other = Number(isOtherBranch(a, railBranch)) - Number(isOtherBranch(b, railBranch));
    if (other !== 0) return other;
    const diff = n(b.coach_iqd) - n(a.coach_iqd);
    if (diff !== 0) return diff;
    return coachOf(a, locale).localeCompare(coachOf(b, locale), locale);
  });
}
