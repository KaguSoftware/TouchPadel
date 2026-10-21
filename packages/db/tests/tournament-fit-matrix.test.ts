/**
 * 0339: who a tournament is for, every way round (owner, 2026-10-13). Four tournaments and ten
 * guests; each guest registers in each tournament through `app.tournament_register`, and the
 * whole table is checked against the rule:
 *
 *   level  fits the class exactly: advanced A, intermediate B, beginner or new C
 *   years  when the tournament names a bracket, the guest's answer is that bracket exactly
 *          ("never" counts as under_one); a plan from before 0339 names none
 *   order  level before years; an unanswered question is TOURNAMENT_PROFILE_REQUIRED, another
 *          answer TOURNAMENT_LEVEL_MISMATCH, each with the question as its detail
 *
 * Then: the desk adds a guest the tournament is not for (it may), a guest who changes their
 * answers after entering keeps the entry, and both guest reads name the class and the bracket.
 * The phone's twin of the rule is apps/mobile/src/features/playProfile/fit.ts.
 */
import { describe, expect, it } from 'vitest';
import { stackAvailable } from './helpers';
import { E, GUEST } from './matches-harness';
import { dockerReachable, scenario, T } from './stores-harness';
import { PUBLISH, RUN, TOUR_BRANCH, TOUR_SETUP, answer, refusal } from './tournaments-plant';

const up = await stackAvailable();
const docker = up && dockerReachable();

/** The tournaments: class, years bracket (null: a plan from before 0339), and its day. */
const TOURS = {
  tA3: { class: 'A', play_years: 'three_plus', days: 3 },
  tB13: { class: 'B', play_years: 'one_to_three', days: 4 },
  tCu1: { class: 'C', play_years: 'under_one', days: 5 },
  tCold: { class: 'C', play_years: null, days: 6 },
} as const;
type Tour = keyof typeof TOURS;

/** The guests' play survey answers (null: the question was skipped). */
const GUESTS = {
  adv_3p: { level: 'advanced', years: 'three_plus' },
  adv_13: { level: 'advanced', years: 'one_to_three' },
  int_13: { level: 'intermediate', years: 'one_to_three' },
  int_3p: { level: 'intermediate', years: 'three_plus' },
  beg_u1: { level: 'beginner', years: 'under_one' },
  new_never: { level: 'new', years: 'never' },
  beg_13: { level: 'beginner', years: 'one_to_three' },
  no_answers: { level: null, years: null },
  int_no_years: { level: 'intermediate', years: null },
  new_no_years: { level: 'new', years: null },
} as const;
type Guest = keyof typeof GUESTS;

const OK = 'registered';
const PROFILE = (on: string) => `TOURNAMENT_PROFILE_REQUIRED:${on}`;
const MISMATCH = (on: string) => `TOURNAMENT_LEVEL_MISMATCH:${on}`;

/** What each guest gets from each tournament, written out by hand from the rule above. */
const EXPECTED: Record<Guest, Record<Tour, string>> = {
  adv_3p: { tA3: OK, tB13: MISMATCH('level'), tCu1: MISMATCH('level'), tCold: MISMATCH('level') },
  adv_13: { tA3: MISMATCH('years'), tB13: MISMATCH('level'), tCu1: MISMATCH('level'), tCold: MISMATCH('level') },
  int_13: { tA3: MISMATCH('level'), tB13: OK, tCu1: MISMATCH('level'), tCold: MISMATCH('level') },
  int_3p: { tA3: MISMATCH('level'), tB13: MISMATCH('years'), tCu1: MISMATCH('level'), tCold: MISMATCH('level') },
  beg_u1: { tA3: MISMATCH('level'), tB13: MISMATCH('level'), tCu1: OK, tCold: OK },
  new_never: { tA3: MISMATCH('level'), tB13: MISMATCH('level'), tCu1: OK, tCold: OK },
  beg_13: { tA3: MISMATCH('level'), tB13: MISMATCH('level'), tCu1: MISMATCH('years'), tCold: OK },
  no_answers: { tA3: PROFILE('level'), tB13: PROFILE('level'), tCu1: PROFILE('level'), tCold: PROFILE('level') },
  int_no_years: { tA3: MISMATCH('level'), tB13: PROFILE('years'), tCu1: MISMATCH('level'), tCold: MISMATCH('level') },
  new_no_years: { tA3: MISMATCH('level'), tB13: MISMATCH('level'), tCu1: PROFILE('years'), tCold: OK },
};

const guests = Object.keys(GUESTS) as Guest[];
const tours = Object.keys(TOURS) as Tour[];


// ── Every pairing: 3 classes × (3 brackets + none), against 4 levels × 4 years answers and the
// skipped answers. The expectation is the rule itself, written once below; the table above is the
// same rule spelled out by hand for a few of them.

const CLASSES = ['A', 'B', 'C'] as const;
const BRACKETS = ['under_one', 'one_to_three', 'three_plus', null] as const;
const LEVELS = ['new', 'beginner', 'intermediate', 'advanced'] as const;
const YEARS = ['never', 'under_one', 'one_to_three', 'three_plus'] as const;

const ALL_TOURS = CLASSES.flatMap((c) => BRACKETS.map((b) => ({ id: `t${c}_${b ?? 'none'}`, cls: c, bracket: b })));
const ALL_GUESTS: { id: string; level: string | null; years: string | null }[] = [
  ...LEVELS.flatMap((l) => YEARS.map((y) => ({ id: `g_${l}_${y}`, level: l, years: y }))),
  ...LEVELS.map((l) => ({ id: `g_${l}_skipped`, level: l, years: null })),
  { id: 'g_skipped_one_to_three', level: null, years: 'one_to_three' },
  { id: 'g_skipped_skipped', level: null, years: null },
];

/** The rule, as tournament_register and the phone's fit.ts apply it. */
function expected(g: { level: string | null; years: string | null }, t: { cls: string; bracket: string | null }) {
  if (g.level === null) return PROFILE('level');
  const cls = g.level === 'advanced' ? 'A' : g.level === 'intermediate' ? 'B' : 'C';
  if (cls !== t.cls) return MISMATCH('level');
  if (t.bracket !== null) {
    if (g.years === null) return PROFILE('years');
    if ((g.years === 'never' ? 'under_one' : g.years) !== t.bracket) return MISMATCH('years');
  }
  return OK;
}

describe.skipIf(!docker)('0339 tournament_register: only the guest a tournament is for', () => {
  it('registers exactly the guests whose level and years fit, and says why to the rest', () => {
    const r = scenario('tfit', [
      TOUR_SETUP,
      ...TOUR_BRANCH,
      ...tours.flatMap((tour) => {
        const { days, ...plan } = TOURS[tour];
        return [RUN(`r_${tour}`, { ...plan, days }), ...PUBLISH(`pub_${tour}`, `r_${tour}`, tour)];
      }),
      ...guests.map((g) => GUEST(g, JSON.stringify(GUESTS[g]))),
      ...guests.flatMap((g) => tours.map((tour) => T(`${g}@${tour}`, g, `select app.tournament_register({{${tour}}})`))),
      // The desk adds anyone (owner, 2026-10-13): an advanced 3+ guest into the beginners' night.
      T('desk_add', 'desk', `select app.tournament_add_entry({{tCu1}}, {{adv_3p}})`),
      // A guest who entered, then changed their answers, keeps the entry.
      T('int_13_changes', 'int_13', `select app.set_my_play_profile('advanced', 'three_plus', null)`),
      T('int_13_again', 'int_13', `select app.tournament_register({{tB13}})`),
      T('pub_list', 'beg_u1', `select app.tournaments_public(null)`),
      E('pub_one', null, `select app.tournament_public({{tB13}})`),
    ]);

    // The whole table first, so a failure shows every cell at once.
    const got: Record<string, Record<string, string>> = {};
    for (const g of guests) {
      got[g] = {};
      for (const tour of tours) {
        const o = r[`${g}@${tour}`]!;
        got[g]![tour] = o.ok ? String((o.data as { status: string }).status) : refusal(r, `${g}@${tour}`);
      }
    }
    console.table(got);
    expect(got).toEqual(EXPECTED);

    expect(answer(r, 'desk_add')).toMatchObject({ status: 'registered' });
    expect(answer(r, 'int_13_again')).toMatchObject({ status: 'registered', duplicate: true });

    const list = answer<{ tournaments: Array<Record<string, unknown>> }>(r, 'pub_list');
    const byClass = list.tournaments.map((t) => [t.class, t.play_years]).sort();
    expect(byClass).toEqual(
      [
        ['A', 'three_plus'],
        ['B', 'one_to_three'],
        ['C', 'under_one'],
        ['C', null],
      ].sort(),
    );
    expect(answer(r, 'pub_one')).toMatchObject({ class: 'B', play_years: 'one_to_three' });
  });
  it('0354: a tournament for several classes takes a guest whose level fits any of them', () => {
    const r = scenario('tfit-classes', [
      TOUR_SETUP,
      ...TOUR_BRANCH,
      RUN('r_ab', { classes: ['A', 'B'], play_years: null, days: 3 }),
      ...PUBLISH('pub_ab', 'r_ab', 'tAB'),
      ...(['adv_3p', 'int_13', 'beg_u1', 'no_answers'] as const).map((g) => GUEST(g, JSON.stringify(GUESTS[g]))),
      ...(['adv_3p', 'int_13', 'beg_u1', 'no_answers'] as const).map((g) =>
        T(`${g}@tAB`, g, `select app.tournament_register({{tAB}})`),
      ),
      T('pub_list', 'adv_3p', `select app.tournaments_public(null)`),
      E('pub_one', null, `select app.tournament_public({{tAB}})`),
    ]);
    expect(answer(r, 'adv_3p@tAB')).toMatchObject({ status: 'registered' });
    expect(answer(r, 'int_13@tAB')).toMatchObject({ status: 'registered' });
    expect(refusal(r, 'beg_u1@tAB')).toBe('TOURNAMENT_LEVEL_MISMATCH:level');
    expect(refusal(r, 'no_answers@tAB')).toBe('TOURNAMENT_PROFILE_REQUIRED:level');
    const list = answer<{ tournaments: Array<Record<string, unknown>> }>(r, 'pub_list');
    expect(list.tournaments.find((t) => t.classes !== undefined && (t.classes as string[]).length === 2)).toMatchObject({
      class: 'A',
      classes: ['A', 'B'],
    });
    expect(answer(r, 'pub_one')).toMatchObject({ class: 'A', classes: ['A', 'B'] });
  });

  it('every level and years answer against every class and bracket (264 registrations)', () => {
    const r = scenario('tfit-all', [
      TOUR_SETUP,
      ...TOUR_BRANCH,
      ...ALL_TOURS.flatMap((t, i) => [
        RUN(`r_${t.id}`, { class: t.cls, play_years: t.bracket, days: 3 + i, count: 32 }),
        ...PUBLISH(`pub_${t.id}`, `r_${t.id}`, t.id),
      ]),
      ...ALL_GUESTS.map((g) => GUEST(g.id, JSON.stringify({ level: g.level, years: g.years }))),
      ...ALL_GUESTS.flatMap((g) =>
        ALL_TOURS.map((t) => T(`${g.id}@${t.id}`, g.id, `select app.tournament_register({{${t.id}}})`)),
      ),
    ]);

    const wrong: string[] = [];
    const tally: Record<string, number> = {};
    const grid: Record<string, Record<string, string>> = {};
    for (const g of ALL_GUESTS) {
      grid[g.id] = {};
      for (const t of ALL_TOURS) {
        const o = r[`${g.id}@${t.id}`]!;
        const got = o.ok ? String((o.data as { status: string }).status) : refusal(r, `${g.id}@${t.id}`);
        const want = expected(g, t);
        tally[got] = (tally[got] ?? 0) + 1;
        grid[g.id]![t.id] = got === OK ? 'OK' : got.replace('TOURNAMENT_', '').replace('_REQUIRED', '').replace('_MISMATCH', '');
        if (got !== want) wrong.push(`${g.id} @ ${t.id}: got ${got}, want ${want}`);
      }
    }
    console.table(grid);
    console.log(tally);
    expect(wrong).toEqual([]);
    expect(Object.values(tally).reduce((a, b) => a + b, 0)).toBe(ALL_GUESTS.length * ALL_TOURS.length);
  });
});
