/**
 * The standings twin (TD-8, TD-10, plan §3.6). PURE, integers only.
 *
 * The standings are `app.tournament_standings(p_tournament_id)`, computed in SQL on every read and
 * never stored. This is its line-for-line twin, used only by the parity suite
 * (`packages/db/tests/tournament-rounds.test.ts`); every client shows the server's rows.
 *
 * - Rows: the registered entries, plus an entry in any other status that has played a scored
 *   match (`withdrawn` = its status is not `registered`).
 * - `played`, `points_against`: over scored matches only.
 * - `points_won`: own team's points in scored matches, plus `floor(points_target / 2)` for each
 *   sit-out in a **complete** round (at least one match, every match scored). `sat_out` counts
 *   those credited sit-outs; a sit-out in a round still being played counts nothing yet.
 * - `diff`: match points won − `points_against` (a sit-out adds 0).
 * - `h2h`: counted once per scored match: for each match the entry played in which at least one
 *   opponent shares the entry's (`points_won`, `diff`), own points − other points.
 * - Order: registered rows first, then `points_won` desc, `diff` desc, `h2h` desc, `seed_no` asc
 *   (then entry id). `rank` = 1 + the rows of its kind strictly better on the first three keys,
 *   so a tie shares its rank; a withdrawn row also counts every registered row before it (0311,
 *   c27: a player who left never pushes down one still playing).
 */
import type { TourEntryStatus, TourMatch, TourStandingRow } from './types';

export interface TourStandingsEntry {
  entry_id: string;
  seed_no: number | null;
  status: TourEntryStatus;
}

export interface TourScoredMatch extends TourMatch {
  points_a: number | null;
  points_b: number | null;
}

export interface TourScoredRound {
  round_no: number;
  sit_out: readonly string[];
  matches: readonly TourScoredMatch[];
}

export interface TourStandingsInput {
  points_target: number;
  entries: readonly TourStandingsEntry[];
  rounds: readonly TourScoredRound[];
}

interface Tally {
  won: number;
  matchWon: number;
  against: number;
  played: number;
  sat: number;
}

const scored = (
  m: TourScoredMatch,
): m is TourScoredMatch & { points_a: number; points_b: number } =>
  m.points_a !== null && m.points_b !== null;

export function rankStandings(input: TourStandingsInput): TourStandingRow[] {
  const credit = Math.floor(input.points_target / 2);
  const tally = new Map<string, Tally>();
  const t = (id: string): Tally => {
    let x = tally.get(id);
    if (!x) {
      x = { won: 0, matchWon: 0, against: 0, played: 0, sat: 0 };
      tally.set(id, x);
    }
    return x;
  };

  for (const r of input.rounds) {
    for (const m of r.matches) {
      if (!scored(m)) continue;
      for (const id of m.a) {
        const x = t(id);
        x.played++;
        x.matchWon += m.points_a;
        x.against += m.points_b;
      }
      for (const id of m.b) {
        const x = t(id);
        x.played++;
        x.matchWon += m.points_b;
        x.against += m.points_a;
      }
    }
    const complete = r.matches.length > 0 && r.matches.every(scored);
    if (complete) for (const id of r.sit_out) t(id).sat++;
  }

  const rows = input.entries
    .filter((e) => e.status === 'registered' || (tally.get(e.entry_id)?.played ?? 0) > 0)
    .map((e) => {
      const x = tally.get(e.entry_id) ?? { won: 0, matchWon: 0, against: 0, played: 0, sat: 0 };
      return {
        entry: e,
        points_won: x.matchWon + credit * x.sat,
        points_against: x.against,
        diff: x.matchWon - x.against,
        played: x.played,
        sat_out: x.sat,
        h2h: 0,
      };
    });

  // Head-to-head inside each (points_won, diff) tie group, once per match.
  const group = new Map(rows.map((r) => [r.entry.entry_id, `${r.points_won}|${r.diff}`]));
  for (const row of rows) {
    const id = row.entry.entry_id;
    const g = group.get(id)!;
    for (const r of input.rounds) {
      for (const m of r.matches) {
        if (!scored(m)) continue;
        const inA = m.a.includes(id);
        const inB = m.b.includes(id);
        if (!inA && !inB) continue;
        const opponents = inA ? m.b : m.a;
        if (!opponents.some((o) => group.get(o) === g)) continue;
        row.h2h += inA ? m.points_a - m.points_b : m.points_b - m.points_a;
      }
    }
  }

  const better = (x: (typeof rows)[number], y: (typeof rows)[number]): number =>
    y.points_won - x.points_won || y.diff - x.diff || y.h2h - x.h2h;
  const seedKey = (s: number | null): number => (s === null ? Number.MAX_SAFE_INTEGER : s);
  const gone = (x: (typeof rows)[number]): number => (x.entry.status === 'registered' ? 0 : 1);
  rows.sort(
    (x, y) =>
      gone(x) - gone(y) ||
      better(x, y) ||
      seedKey(x.entry.seed_no) - seedKey(y.entry.seed_no) ||
      (x.entry.entry_id < y.entry.entry_id ? -1 : x.entry.entry_id > y.entry.entry_id ? 1 : 0),
  );

  const registered = rows.filter((o) => gone(o) === 0).length;
  return rows.map((r) => ({
    entry_id: r.entry.entry_id,
    rank:
      1 +
      (gone(r) === 1 ? registered : 0) +
      rows.filter((o) => gone(o) === gone(r) && better(o, r) < 0).length,
    points_won: r.points_won,
    points_against: r.points_against,
    diff: r.diff,
    h2h: r.h2h,
    played: r.played,
    sat_out: r.sat_out,
    withdrawn: r.entry.status !== 'registered',
  }));
}
