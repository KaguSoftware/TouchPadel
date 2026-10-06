/**
 * The engine against the database (docs/design/tournaments/build-contracts-2026-10-03.md §1.9,
 * TD-7, TD-8; plan §4 "Parity"): core generates, SQL checks and ranks.
 *
 *   * 22 scenarios (Americano and Mexicano, 4 to 16 entries, 1 to 4 courts, two points targets,
 *     some with the last round half played, some with a no-show who had played, and two (0311,
 *     c27) where the leader leaves mid-play and must rank after every registered entry): the engine's
 *     rounds are submitted through tournament_set_rounds, scored with seeded scores through
 *     tournament_score, and app.tournament_standings must equal rankStandings row for row;
 *   * the invalid corpus: every mutation of a valid payload gets from the server the first
 *     detail validateRoundsPayload returns (INVALID_ARGUMENT p_payload for 'payload');
 *   * two submits on the same revision: the second is stale.
 *
 * The engine (prng, americano, mexicano, standings) is the engine lane's (plan §7) and joins
 * packages/core at the integration merge; this suite imports it by relative path
 * (../../core/src/tournaments, the coaching-desk-money precedent) at run time, so the db
 * package typechecks before it lands. TOUR_ENGINE_DIR points it at another checkout (an engine
 * worktree) until then. With docker up and no engine, the suite FAILS rather than skips: it is
 * the integration's parity gate (check-no-skips). Without docker it skips, as every stack suite.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { stackAvailable } from './helpers';
import { GUEST } from './matches-harness';
import { dockerReachable, KEEP, Q, scenario, T, X, type Results } from './stores-harness';
import { answer, KEY, PUBLISH, RUN, TOUR_BRANCH, TOUR_SETUP } from './tournaments-plant';

const up = await stackAvailable();
const docker = up && dockerReachable();

// ── the engine, loaded at run time ──────────────────────────────────────────
type Id = string;
interface EntryRef {
  entry_id: Id;
  seed_no: number;
}
interface Court {
  court_id: Id;
  sort: number;
}
interface Match {
  court_id: Id;
  a: [Id, Id];
  b: [Id, Id];
}
interface Round {
  round_no: number;
  matches: Match[];
  sit_out: Id[];
}
interface StandingRow {
  entry_id: Id;
  rank: number;
  points_won: number;
  points_against: number;
  diff: number;
  h2h: number;
  played: number;
  sat_out: number;
  withdrawn: boolean;
}
interface ScoredMatch extends Match {
  points_a: number | null;
  points_b: number | null;
}
interface Engine {
  seedFrom(text: string): number;
  mulberry32(seed: number): () => number;
  americanoSchedule(i: {
    entries: EntryRef[];
    courts: Court[];
    rounds?: number;
    seed: number;
  }): Round[];
  mexicanoRound(i: {
    entries: EntryRef[];
    courts: Court[];
    standings: Pick<StandingRow, 'entry_id' | 'rank' | 'sat_out'>[];
    lastRound: Round | null;
    roundNo: number;
    seed: number;
  }): Round;
  rankStandings(i: {
    points_target: number;
    entries: { entry_id: Id; seed_no: number | null; status: string }[];
    rounds: { round_no: number; sit_out: Id[]; matches: ScoredMatch[] }[];
  }): StandingRow[];
  validateRoundsPayload(payload: unknown, ctx: Record<string, unknown>): string[];
}

const ENGINE_DIR =
  process.env.TOUR_ENGINE_DIR ?? path.resolve(import.meta.dirname, '../../core/src/tournaments');
const ENGINE_FILES = ['prng.ts', 'americano.ts', 'mexicano.ts', 'standings.ts', 'validate.ts'];
let engine: Engine;

async function loadEngine(): Promise<Engine> {
  const missing = ENGINE_FILES.filter((f) => !existsSync(path.join(ENGINE_DIR, f)));
  if (missing.length > 0) {
    throw new Error(
      `tournament-rounds: the engine is not in ${ENGINE_DIR} (missing ${missing.join(', ')}). ` +
        'It lands with the engine lane at the integration merge; set TOUR_ENGINE_DIR to run it earlier.',
    );
  }
  // A plain path, not a file URL: vite resolves it as is (a URL's %20 is not decoded).
  const load = (f: string) =>
    import(/* @vite-ignore */ path.join(ENGINE_DIR, f).split(path.sep).join('/')) as Promise<
      Record<string, unknown>
    >;
  const mods = await Promise.all(ENGINE_FILES.map(load));
  return Object.assign({}, ...mods) as Engine;
}

// ── fixed ids, so the engine can write payloads before the transaction runs ─
const hex = (n: number) => n.toString(16).padStart(12, '0');
const entryId = (s: number, i: number) => `00000000-0000-4000-8e00-${hex(s * 1000 + i)}`;
const courtId = (i: number) => `00000000-0000-4000-8c00-${hex(i)}`;

/** Four courts of fixed ids at the branch (k1..k4, sorted after SETUP's own). */
const COURTS = [1, 2, 3, 4].flatMap((i) => [
  X(`insert into courts (id, venue_id, name_en, name_ar, duration_options, sort_order, is_active)
     values ('${courtId(i)}', {{v}}::uuid, 'Parity ${i}', 'ملعب ${i}', '{60,90,120}', ${10 + i}, true)`),
  KEEP(`k${i}`, `select '${courtId(i)}'`),
]);

/** n registered entries of fixed ids (entered in order: seeds 1..n at the close). */
const ENTRIES = (tour: string, s: number, n: number, prefix: string) =>
  Array.from({ length: n }, (_, j) => j + 1).flatMap((i) => [
    GUEST(`${prefix}${i}`, `{"given": "P${i}", "family": "F${i}", "gender": "male"}`),
    X(`insert into tournament_entries (id, venue_id, tournament_id, guest_id, status, added_by_kind, entered_at)
       values ('${entryId(s, i)}', {{v}}::uuid, {{${tour}}}::uuid, {{${prefix}${i}}}::uuid, 'registered', 'guest',
               now() + make_interval(secs => ${i}))`),
  ]);

/** Score one match (by round and court) through the RPC, as the desk, from a postgres helper. */
const SCORE_AT = String.raw`
create function pg_temp.score_at(p_tour text, p_round int, p_court uuid, p_a int, p_b int) returns jsonb
language plpgsql as $f$
declare m tournament_matches%rowtype; v jsonb;
begin
  select * into m from tournament_matches
   where tournament_id = pg_temp.var(p_tour)::uuid and round_no = p_round and court_id = p_court;
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', pg_temp.var('desk'), 'role', 'authenticated')::text, true);
  v := app.tournament_score(m.id, p_a::smallint, p_b::smallint, m.revision, null);
  perform set_config('request.jwt.claims', '', true);
  return v;
end $f$;
`;

const ROUNDS_CALL = (label: string, tour: string, payload: unknown) =>
  T(
    label,
    'desk',
    `select app.tournament_set_rounds({{${tour}}}, '${JSON.stringify(payload)}'::jsonb, ${KEY(label)})`,
  );

interface Plan {
  format: 'americano' | 'mexicano';
  n: number;
  courts: number;
  target: number;
  rounds: number;
  partial: boolean;
  noShow: boolean;
  /** 0311 (c27): the leader, not the first entry, leaves with the last round half played. */
  leader?: boolean;
}

/** The 22 scenarios: a spread of field sizes, courts, targets and endings. */
const PLANS: Plan[] = Array.from({ length: 20 }, (_, s): Plan => {
  const format = s % 3 === 2 ? 'mexicano' : 'americano';
  const n = 4 + ((s * 5) % 13);
  return {
    format,
    n,
    courts: 1 + (s % 4),
    target: s % 2 === 0 ? 24 : 16,
    rounds: format === 'mexicano' ? 3 : Math.min(n - 1, 5),
    partial: s % 4 === 1,
    noShow: s % 5 === 3,
  };
}).concat([
  {
    format: 'americano',
    n: 9,
    courts: 2,
    target: 24,
    rounds: 5,
    partial: true,
    noShow: true,
    leader: true,
  },
  {
    format: 'mexicano',
    n: 8,
    courts: 2,
    target: 16,
    rounds: 3,
    partial: true,
    noShow: true,
    leader: true,
  },
]);

/** Build the SQL of one scenario and the TS model of what it plays. */
function build(s: number, p: Plan) {
  const rng = engine.mulberry32(engine.seedFrom(`parity-${s}`));
  const entries: EntryRef[] = Array.from({ length: p.n }, (_, j) => ({
    entry_id: entryId(s, j + 1),
    seed_no: j + 1,
  }));
  const courts: Court[] = Array.from({ length: p.courts }, (_, j) => ({
    court_id: courtId(j + 1),
    sort: j + 1,
  }));
  const seed = engine.seedFrom(`tournament-${s}`);
  const played: { round_no: number; sit_out: Id[]; matches: ScoredMatch[] }[] = [];
  const body: string[] = [];
  let revision = 0;

  const scoreRound = (round: Round, all: boolean) => {
    const scored: ScoredMatch[] = round.matches.map((m) => ({
      ...m,
      points_a: null,
      points_b: null,
    }));
    scored.forEach((m, i) => {
      if (!all && i % 2 === 1) return;
      const a = rng() % (p.target + 1);
      m.points_a = a;
      m.points_b = p.target - a;
      body.push(
        Q(
          `s${s}_r${round.round_no}_m${i}`,
          `select pg_temp.score_at('t', ${round.round_no}, '${m.court_id}', ${a}, ${p.target - a})`,
        ),
      );
      revision++;
    });
    played.push({ round_no: round.round_no, sit_out: round.sit_out, matches: scored });
  };

  if (p.format === 'americano') {
    const schedule = engine.americanoSchedule({ entries, courts, rounds: p.rounds, seed });
    body.push(
      ROUNDS_CALL(`s${s}_set`, 't', {
        engine: 'tp-tour-1',
        format: 'americano',
        based_on_revision: revision,
        from_round: 1,
        rounds: schedule,
      }),
    );
    revision++;
    schedule.forEach((round, k) => scoreRound(round, !(p.partial && k === schedule.length - 1)));
  } else {
    let last: Round | null = null;
    for (let k = 1; k <= p.rounds; k++) {
      const standings = engine.rankStandings({
        points_target: p.target,
        entries: entries.map((e) => ({ ...e, status: 'registered' })),
        rounds: played,
      });
      const round = engine.mexicanoRound({
        entries,
        courts,
        standings,
        lastRound: last,
        roundNo: k,
        seed,
      });
      body.push(
        ROUNDS_CALL(`s${s}_set${k}`, 't', {
          engine: 'tp-tour-1',
          format: 'mexicano',
          based_on_revision: revision,
          from_round: k,
          rounds: [round],
        }),
      );
      revision++;
      scoreRound(round, !(p.partial && k === p.rounds));
      last = round;
    }
  }

  // A no-show after the play: the first entry that played leaves the registered set.
  const statuses = new Map(entries.map((e) => [e.entry_id, 'registered']));
  if (p.noShow) {
    const gone = p.leader
      ? engine.rankStandings({
          points_target: p.target,
          entries: entries.map((e) => ({ ...e, status: 'registered' })),
          rounds: played,
        })[0]!.entry_id
      : entries[0]!.entry_id;
    statuses.set(gone, 'no_show');
    body.push(
      X(
        `update tournament_entries set status = 'no_show', no_show_at = now() where id = '${gone}'::uuid`,
      ),
    );
  }
  body.push(
    Q(
      `s${s}_standings`,
      `select coalesce(jsonb_agg(to_jsonb(x) - 'ord' order by x.ord), '[]'::jsonb)
                            from app.tournament_standings({{t}}::uuid)
                                 with ordinality x(entry_id, rank, points_won, points_against, diff, h2h, played,
                                                   sat_out, withdrawn, ord)`,
    ),
  );

  const expected = engine.rankStandings({
    points_target: p.target,
    entries: entries.map((e) => ({ ...e, status: statuses.get(e.entry_id)! })),
    rounds: played,
  });
  return { body, expected };
}

/** A published, closed tournament of the plan on the fixed courts, its entries fixed. */
function setup(s: number, p: Plan, tour = 't', run = 'r', days = 3): string[] {
  return [
    RUN(run, {
      days,
      format: p.format,
      count: 16,
      courts: Array.from({ length: p.courts }, (_, j) => `k${j + 1}`),
    }),
    ...PUBLISH(`pub_${tour}`, run, tour, {
      points_target: p.target,
      ...(p.format === 'mexicano' ? { rounds: p.rounds } : {}),
    }),
    ...ENTRIES(tour, s, p.n, `g${tour}_`),
    `select pg_temp.close('${tour}');`,
  ];
}

describe.skipIf(!docker)('the engine against the database (TD-7, TD-8)', () => {
  beforeAll(async () => {
    engine = await loadEngine();
  });

  it('app.tournament_standings equals rankStandings over 22 played scenarios', () => {
    for (const [s, p] of PLANS.entries()) {
      const { body, expected } = build(s, p);
      const r: Results = scenario(`tr-par-${s}`, [
        TOUR_SETUP,
        SCORE_AT,
        ...TOUR_BRANCH,
        ...COURTS,
        ...setup(s, p),
        ...body,
      ]);
      const label = `scenario ${s} (${p.format}, ${p.n} entries, ${p.courts} courts, target ${p.target})`;
      for (const [k, o] of Object.entries(r)) {
        if (k.startsWith(`s${s}_`) && k !== `s${s}_standings`)
          expect(o.ok, `${label} ${k}: ${o.code} ${o.detail ?? ''}`).toBe(true);
      }
      expect(answer(r, `s${s}_standings`), label).toEqual(expected);
      expect(expected.length, label).toBeGreaterThan(0);
      if (p.leader) {
        // The leader left: last, ranked after every registered row (0311, c27).
        const last = expected[expected.length - 1]!;
        expect(last.withdrawn, label).toBe(true);
        expect(last.rank, label).toBe(expected.length);
      }
    }
  });

  it('the invalid corpus: the server raises the first detail validateRoundsPayload returns', () => {
    const am: Plan = {
      format: 'americano',
      n: 9,
      courts: 2,
      target: 24,
      rounds: 4,
      partial: false,
      noShow: false,
    };
    const s = 90;
    const entries: EntryRef[] = Array.from({ length: am.n }, (_, j) => ({
      entry_id: entryId(s, j + 1),
      seed_no: j + 1,
    }));
    const courts: Court[] = [1, 2].map((j) => ({ court_id: courtId(j), sort: j }));
    const rounds = engine.americanoSchedule({
      entries,
      courts,
      rounds: 4,
      seed: engine.seedFrom('corpus'),
    });
    const valid = {
      engine: 'tp-tour-1',
      format: 'americano',
      based_on_revision: 0,
      from_round: 1,
      rounds,
    };
    const ctx = {
      status: 'closed',
      revision: 0,
      format: 'americano',
      rounds_planned: null,
      last_round: 0,
      scored_rounds: [],
      complete_rounds: [],
      active: entries.map((e) => e.entry_id),
      courts: courts.map((c) => c.court_id),
    };
    const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
    const corpus: Record<string, unknown> = {
      not_object: [],
      team_of_one: (() => {
        const x = clone(valid) as { rounds: Array<{ matches: Array<{ a: string[] }> }> };
        x.rounds[0]!.matches[0]!.a = [entries[0]!.entry_id];
        return x;
      })(),
      stale: { ...clone(valid), based_on_revision: 4 },
      engine: { ...clone(valid), engine: 'tp-tour-2' },
      format: { ...clone(valid), format: 'mexicano' },
      stale_and_engine: { ...clone(valid), based_on_revision: 1, engine: 'x' },
      from_two: { ...clone(valid), from_round: 2 },
      too_many: {
        ...clone(valid),
        rounds: Array.from({ length: 31 }, (_, k) => ({ ...clone(rounds[0]!), round_no: k + 1 })),
      },
      gap: (() => {
        const x = clone(valid);
        x.rounds[1]!.round_no = 7;
        return x;
      })(),
      seat_unknown: (() => {
        const x = clone(valid);
        x.rounds[0]!.sit_out = ['00000000-0000-4000-8000-0000000000aa'];
        return x;
      })(),
      seat_twice: (() => {
        const x = clone(valid);
        x.rounds[0]!.sit_out = [x.rounds[0]!.matches[0]!.a[0]];
        return x;
      })(),
      court_unknown: (() => {
        const x = clone(valid);
        x.rounds[0]!.matches[0]!.court_id = courtId(3);
        return x;
      })(),
      court_twice: (() => {
        const x = clone(valid);
        if (x.rounds[0]!.matches[1])
          x.rounds[0]!.matches[1]!.court_id = x.rounds[0]!.matches[0]!.court_id;
        return x;
      })(),
      // 0311 (c26): round 2 sits round 1's sit-out again while others have sat none.
      sit_twice: (() => {
        const x = clone(valid);
        x.rounds[1] = { ...clone(x.rounds[0]!), round_no: 2 };
        return x;
      })(),
      no_matches: (() => {
        const x = clone(valid);
        x.rounds[0] = { round_no: 1, matches: [], sit_out: entries.map((e) => e.entry_id) };
        return x;
      })(),
      valid,
    };
    const body = Object.entries(corpus).map(([name, payload]) =>
      ROUNDS_CALL(`c_${name}`, 't', payload),
    );
    // Two submits of the same revision: the second is stale.
    body.push(ROUNDS_CALL('c_twice', 't', valid));
    const r = scenario('tr-corpus', [
      TOUR_SETUP,
      SCORE_AT,
      ...TOUR_BRANCH,
      ...COURTS,
      ...setup(s, am),
      ...body,
    ]);
    for (const [name, payload] of Object.entries(corpus)) {
      const details = engine.validateRoundsPayload(payload, ctx);
      const o = r[`c_${name}`]!;
      if (details.length === 0) {
        expect(o.ok, `${name}: ${o.code} ${o.detail ?? ''}`).toBe(true);
        continue;
      }
      const want =
        details[0] === 'payload'
          ? 'INVALID_ARGUMENT:p_payload'
          : `TOURNAMENT_ROUNDS_INVALID:${details[0]}`;
      expect(o.ok, name).toBe(false);
      expect(`${o.code}:${o.detail}`, name).toBe(want);
    }
    expect(
      engine.validateRoundsPayload(valid, {
        ...ctx,
        revision: 1,
        status: 'running',
        last_round: 4,
      })[0],
    ).toBe('stale');
    expect(`${r.c_twice!.code}:${r.c_twice!.detail}`).toBe('TOURNAMENT_ROUNDS_INVALID:stale');
    expect(engine.validateRoundsPayload(corpus.sit_twice, ctx)).toEqual(['sit_out']);
  });

  it('Mexicano: one round past the first, before its round is scored, and over a played round', () => {
    const mx: Plan = {
      format: 'mexicano',
      n: 8,
      courts: 2,
      target: 16,
      rounds: 2,
      partial: false,
      noShow: false,
    };
    const s = 91;
    const entries: EntryRef[] = Array.from({ length: mx.n }, (_, j) => ({
      entry_id: entryId(s, j + 1),
      seed_no: j + 1,
    }));
    const courts: Court[] = [1, 2].map((j) => ({ court_id: courtId(j), sort: j }));
    const seed = engine.seedFrom('mexicano');
    const r1 = engine.mexicanoRound({
      entries,
      courts,
      standings: [],
      lastRound: null,
      roundNo: 1,
      seed,
    });
    const r2 = {
      ...engine.mexicanoRound({ entries, courts, standings: [], lastRound: r1, roundNo: 2, seed }),
      round_no: 2,
    };
    const pay = (rev: number, from: number, rs: Round[]) => ({
      engine: 'tp-tour-1',
      format: 'mexicano',
      based_on_revision: rev,
      from_round: from,
      rounds: rs,
    });
    const base = {
      format: 'mexicano',
      rounds_planned: 2,
      active: entries.map((e) => e.entry_id),
      courts: courts.map((c) => c.court_id),
    };
    const cases: Array<[string, unknown, Record<string, unknown>]> = [
      [
        'two_at_once',
        pay(1, 2, [r2, { ...r2, round_no: 3 }]),
        { status: 'running', revision: 1, last_round: 1, scored_rounds: [], complete_rounds: [] },
      ],
      [
        'round_open',
        pay(1, 2, [r2]),
        { status: 'running', revision: 1, last_round: 1, scored_rounds: [], complete_rounds: [] },
      ],
    ];
    const body: string[] = [ROUNDS_CALL('m_r1', 't', pay(0, 1, [r1]))];
    for (const [name, payload] of cases) body.push(ROUNDS_CALL(`m_${name}`, 't', payload));
    r1.matches.forEach((m, i) =>
      body.push(Q(`m_score_${i}`, `select pg_temp.score_at('t', 1, '${m.court_id}', 10, 6)`)),
    );
    const afterScores = 1 + r1.matches.length;
    const played = pay(afterScores, 1, [r1]);
    body.push(ROUNDS_CALL('m_played', 't', played));
    const res = scenario('tr-mex', [
      TOUR_SETUP,
      SCORE_AT,
      ...TOUR_BRANCH,
      ...COURTS,
      ...setup(s, mx),
      ...body,
    ]);
    expect(res.m_r1!.ok, `${res.m_r1!.code} ${res.m_r1!.detail ?? ''}`).toBe(true);
    for (const [name, payload, ctx] of cases) {
      const d = engine.validateRoundsPayload(payload, { ...base, ...ctx });
      expect(`${res[`m_${name}`]!.code}:${res[`m_${name}`]!.detail}`, name).toBe(
        `TOURNAMENT_ROUNDS_INVALID:${d[0]}`,
      );
    }
    const dPlayed = engine.validateRoundsPayload(played, {
      ...base,
      status: 'running',
      revision: afterScores,
      last_round: 1,
      scored_rounds: [1],
      complete_rounds: [1],
    });
    expect(`${res.m_played!.code}:${res.m_played!.detail}`).toBe(
      `TOURNAMENT_ROUNDS_INVALID:${dPlayed[0]}`,
    );
  });
});
