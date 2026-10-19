/**
 * The desk calendar's kept bands (Gender hours, 0353): for one court and one
 * trading night, the stretches of the grid kept for women, for men, or for
 * both (two rules that clash, so nobody can book). Pure; the band component
 * (GenderBands.tsx) draws them.
 *
 * The rule semantics are @touch/core's slotGenderRules, the same mirror the
 * phone uses: this file only finds where a kept stretch can start or end (a
 * rule's window edge on the night or a day either side of it) and asks
 * slotGenderRules about each piece between two edges, so a band can never
 * disagree with the verdict the server and the booking dialog give.
 */
import { clockMinutes, keptFor, runsPastMidnight, slotGenderRules, wallTimeToUtc, type GenderRuleLike } from '@touch/core';

export interface GenderBand {
  /** Minutes from the grid's start, and the band's length in minutes. */
  fromMin: number;
  minutes: number;
  kept: 'female' | 'male' | 'both';
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * The kept stretches of [gridStart, gridEnd) on `courtId`, as minutes from
 * gridStart. `date` is the night's venue-local date (the grid's day): window
 * edges are tried on the day before, the day itself and the day after, which
 * covers a night that runs past midnight and a rule that does too.
 */
export function genderBands(
  rules: readonly GenderRuleLike[],
  courtId: string,
  date: string,
  gridStart: Date,
  gridEnd: Date,
  tz: string,
): GenderBand[] {
  const startMs = gridStart.getTime();
  const endMs = gridEnd.getTime();
  if (!(endMs > startMs)) return [];
  const live = rules.filter((r) => r.is_active && (r.court_id === null || r.court_id === courtId));
  if (live.length === 0) return [];

  const edges = new Set<number>([startMs, endMs]);
  for (const day of [addDays(date, -1), date, addDays(date, 1)]) {
    for (const r of live) {
      const s = clockMinutes(r.start_time);
      const e = clockMinutes(r.end_time) + (runsPastMidnight(r) ? 1440 : 0);
      for (const min of [s, e]) {
        const t = wallTimeToUtc(day, min, tz).getTime();
        if (t > startMs && t < endMs) edges.add(t);
      }
    }
  }
  const cuts = [...edges].sort((a, b) => a - b);

  const bands: GenderBand[] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const from = cuts[i]!;
    const to = cuts[i + 1]!;
    const kept = keptFor(slotGenderRules(live, courtId, new Date(from), new Date(to), tz));
    if (!kept) continue;
    const fromMin = (from - startMs) / 60_000;
    const minutes = (to - from) / 60_000;
    const last = bands[bands.length - 1];
    if (last && last.kept === kept && last.fromMin + last.minutes === fromMin) last.minutes += minutes;
    else bands.push({ fromMin, minutes, kept });
  }
  return bands;
}
