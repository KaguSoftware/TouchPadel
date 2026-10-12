import { describe, expect, it } from 'vitest';
import { showsTournament, tournamentFit } from '../fit';
import type { PlayLevel, PlayYears } from '../logic';
import type { TourClass, TourYears } from '../../tournaments/logic';

/**
 * The phone's side of 0339, every pairing: 4 levels × 4 years answers and the skipped answers,
 * against 3 classes × (3 years brackets + none). For each, what the Join tab does (list or hide)
 * and what the tournament page offers (Register, "not for you", "Answer now"), checked against
 * what `app.tournament_register` answers for the same pair (packages/db/tests/
 * tournament-fit-matrix.test.ts runs those 264 registrations against the database).
 */

const CLASSES: TourClass[] = ['A', 'B', 'C'];
const BRACKETS: (TourYears | null)[] = ['under_one', 'one_to_three', 'three_plus', null];
const LEVELS: PlayLevel[] = ['new', 'beginner', 'intermediate', 'advanced'];
const YEARS: PlayYears[] = ['never', 'under_one', 'one_to_three', 'three_plus'];

const TOURS = CLASSES.flatMap((c) =>
  BRACKETS.map((b) => ({ id: `${c}/${b ?? 'none'}`, tourClass: c, playYears: b, mine: null })),
);
const GUESTS: { id: string; level: PlayLevel | null; years: PlayYears | null }[] = [
  ...LEVELS.flatMap((l) => YEARS.map((y) => ({ id: `${l}/${y}`, level: l, years: y }))),
  ...LEVELS.map((l) => ({ id: `${l}/skipped`, level: l, years: null })),
  { id: 'skipped/one_to_three', level: null, years: 'one_to_three' },
  { id: 'skipped/skipped', level: null, years: null },
];

/** The server's answer for a pair (tournament_register 0339), as the database matrix expects it. */
function server(g: { level: string | null; years: string | null }, t: { tourClass: string; playYears: string | null }) {
  if (g.level === null) return 'PROFILE_REQUIRED:level';
  const cls = g.level === 'advanced' ? 'A' : g.level === 'intermediate' ? 'B' : 'C';
  if (cls !== t.tourClass) return 'LEVEL_MISMATCH:level';
  if (t.playYears !== null) {
    if (g.years === null) return 'PROFILE_REQUIRED:years';
    if ((g.years === 'never' ? 'under_one' : g.years) !== t.playYears) return 'LEVEL_MISMATCH:years';
  }
  return 'registered';
}

describe('0339 on the phone: every level and years answer against every tournament', () => {
  it('lists, offers and refuses exactly as the server registers (264 pairs)', () => {
    const wrong: string[] = [];
    const screens: Record<string, number> = {};
    for (const g of GUESTS) {
      for (const t of TOURS) {
        const answers = { level: g.level, years: g.years };
        const fit = tournamentFit(t, answers);
        const listed = showsTournament(t, answers);
        // What the tournament page shows in place of (or as) its action.
        const page =
          fit.fit === 'fits' ? 'Register' : fit.fit === 'mismatch' ? `not for you (${fit.on})` : `Answer now (${fit.on})`;
        const join = listed ? 'listed' : 'hidden';
        const key = `${join} · ${page}`;
        screens[key] = (screens[key] ?? 0) + 1;

        const want = server(g, t);
        const phone =
          fit.fit === 'fits'
            ? 'registered'
            : fit.fit === 'mismatch'
              ? `LEVEL_MISMATCH:${fit.on}`
              : `PROFILE_REQUIRED:${fit.on}`;
        if (phone !== want) wrong.push(`${g.id} @ ${t.id}: phone ${phone}, server ${want}`);
        // The Join tab hides only what the server would refuse as another level or bracket.
        if (listed !== (fit.fit !== 'mismatch')) wrong.push(`${g.id} @ ${t.id}: listed ${listed}`);
      }
    }
    console.table(screens);
    expect(wrong).toEqual([]);
    expect(Object.values(screens).reduce((a, b) => a + b, 0)).toBe(264);
  });

  it('keeps a tournament the guest entered on the Join tab, whatever they answer later', () => {
    for (const g of GUESTS) {
      for (const t of TOURS) {
        expect(showsTournament({ ...t, mine: { status: 'registered' } }, g)).toBe(true);
      }
    }
  });
});
