/**
 * The Americano schedule (T-1, plan §4). PURE, integers only.
 *
 * The desk generates the whole schedule up front and sends it in one `tournament_set_rounds`
 * (`from_round = 1`); a no-show without a substitute deletes the unplayed rounds and the desk
 * regenerates them from the played history (`regenerate.ts`). The server checks the invariants
 * (`validate.ts`); fairness is this file's and its tests', never the server's.
 *
 * Per round:
 * - Courts: `min(|courts|, floor(N/4))`, lowest `sort` first (`tourPlayCourts`).
 * - Sit-outs (N − 4c of them): fewest sit-outs so far → did not sit out the round before → the
 *   circle's bye (below) → a seeded order.
 * - Partners: a round-robin "circle" over a seeded order of the entries (one fixed seat, the others
 *   rotating; a phantom seat when N is odd, whose partner is the circle's bye). Round r uses factor
 *   `(r − 1) mod (M − 1)`, so in the first N − 1 rounds no two players partner twice whenever the
 *   bye is the only sit-out (N ≡ 0 or 1 mod 4 on enough courts). A circle pair is kept only when
 *   both play and have never partnered; everyone else is re-paired by the search.
 * - Matches: 256 seeded candidates (the free players shuffled into pairs, then all pairs shuffled
 *   into matches on the courts in order), keeping the lowest cost
 *   `1000·Σ partner² + 10·Σ opponent² + court repeats` (counts before the round; a court repeat is a
 *   player on the court he played the round before). The first candidate at cost 0 wins at once.
 * - Team `a` is the team holding the lowest `seed_no`; inside a team, and in `sit_out`, ids go by
 *   `seed_no`.
 *
 * Every round draws from `mulberry32(roundSeed(seed, round_no))`, so a round never depends on how
 * many rounds were generated before it: regenerating with an unchanged entry set and history
 * reproduces the original rounds exactly.
 */
import { mulberry32, randInt, roundSeed, shuffle, type TourRng } from './prng';
import {
  TOUR_LIMITS,
  type TourCourt,
  type TourEntryRef,
  type TourMatch,
  type TourRound,
} from './types';

/** Candidates the match search scores per round (plan §4). */
export const AMERICANO_CANDIDATES = 256;

const W_PARTNER = 1000;
const W_OPPONENT = 10;
const W_COURT = 1;

export interface AmericanoInput {
  /** The active set: the registered entries, every one seated once per round. */
  entries: readonly TourEntryRef[];
  /** The courts the desk picked. */
  courts: readonly TourCourt[];
  /** Rounds to generate; default `americanoDefaultRounds(N)` for a first schedule. */
  rounds?: number;
  /** `seedFrom(tournament_id)`. */
  seed: number;
  /** The rounds already played (before the first generated one); their counts carry over. */
  history?: readonly TourRound[];
  /** The first generated `round_no`; default one past the history's last round. */
  firstRound?: number;
}

/** The default Americano length: everyone partners everyone once, capped at 30 rounds. */
export function americanoDefaultRounds(entries: number): number {
  return Math.max(1, Math.min(entries - 1, TOUR_LIMITS.roundsMax));
}

/** Matches per round: `min(|courts|, floor(active / 4))`. */
export function tourCourtsPerRound(active: number, courts: number): number {
  return Math.max(0, Math.min(courts, Math.floor(active / 4)));
}

/** The courts a round plays on, lowest `sort` first (then court id), `count` of them. */
export function tourPlayCourts(courts: readonly TourCourt[], count: number): TourCourt[] {
  return courts
    .slice()
    .sort((x, y) => x.sort - y.sort || cmp(x.court_id, y.court_id))
    .slice(0, count);
}

/** One match in its canonical form: team `a` holds the lowest seed, each team by seed. */
export function tourOrderMatch(
  court_id: string,
  t1: readonly [string, string],
  t2: readonly [string, string],
  seedOf: (id: string) => number,
): TourMatch {
  const team = (t: readonly [string, string]): [string, string] =>
    seedCmp(t[0], t[1], seedOf) <= 0 ? [t[0], t[1]] : [t[1], t[0]];
  const a = team(t1);
  const b = team(t2);
  return seedCmp(a[0], b[0], seedOf) <= 0 ? { court_id, a, b } : { court_id, a: b, b: a };
}

/** Ids by seed (then id), the order of every id list the engine writes. */
export function tourSortBySeed(ids: readonly string[], seedOf: (id: string) => number): string[] {
  return ids.slice().sort((x, y) => seedCmp(x, y, seedOf));
}

/** The seed lookup for an entry list; an unknown id sorts last. */
export function tourSeedLookup(entries: readonly TourEntryRef[]): (id: string) => number {
  const seeds = new Map(entries.map((e) => [e.entry_id, e.seed_no]));
  return (id) => seeds.get(id) ?? Number.MAX_SAFE_INTEGER;
}

function cmp(x: string, y: string): number {
  return x < y ? -1 : x > y ? 1 : 0;
}

function seedCmp(x: string, y: string, seedOf: (id: string) => number): number {
  return seedOf(x) - seedOf(y) || cmp(x, y);
}

/** Refuses (RangeError) an input no round can be built from: duplicates, < 4 entries, no court. */
export function tourCheckInput(
  entries: readonly TourEntryRef[],
  courts: readonly TourCourt[],
): void {
  const ids = new Set(entries.map((e) => e.entry_id));
  if (ids.size !== entries.length) throw new RangeError('entries must be distinct');
  if (new Set(courts.map((c) => c.court_id)).size !== courts.length)
    throw new RangeError('courts must be distinct');
  if (tourCourtsPerRound(entries.length, courts.length) < 1)
    throw new RangeError(
      `a round needs at least 4 entries and 1 court (got ${entries.length} and ${courts.length})`,
    );
}

/** `shuffle` in place over the first `len` slots of `buf`, with the same draws in the same order. */
function shuffleInto(buf: Int32Array, len: number, rng: TourRng): void {
  for (let i = len - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    const tmp = buf[i]!;
    buf[i] = buf[j]!;
    buf[j] = tmp;
  }
}

/** The circle's partner factors over a seeded order: factor t is a list of index pairs. */
function circleFactors(
  n: number,
  order: readonly number[],
): { pairs: [number, number][]; bye: number }[] {
  // Seat 0 is fixed; seats 1..M-1 rotate. With N odd, seat 0 is the phantom (-1).
  const seats = n % 2 === 0 ? order.slice() : [-1, ...order];
  const m = seats.length;
  const rot = seats.slice(1);
  const out: { pairs: [number, number][]; bye: number }[] = [];
  for (let t = 0; t < m - 1; t++) {
    const pairs: [number, number][] = [];
    let bye = -1;
    const first = rot[t % (m - 1)]!;
    if (seats[0] === -1) bye = first;
    else pairs.push([seats[0]!, first]);
    for (let i = 1; i < m / 2; i++) {
      pairs.push([rot[(t + i) % (m - 1)]!, rot[(t - i + (m - 1)) % (m - 1)]!]);
    }
    out.push({ pairs, bye });
  }
  return out;
}

/** The whole (or the rest of the) Americano schedule. */
export function americanoSchedule(input: AmericanoInput): TourRound[] {
  const { entries, courts, seed } = input;
  tourCheckInput(entries, courts);
  const history = (input.history ?? []).slice().sort((x, y) => x.round_no - y.round_no);
  const lastPlayed = history.length ? history[history.length - 1]!.round_no : 0;
  const first = input.firstRound ?? lastPlayed + 1;
  const n = entries.length;
  const count = input.rounds ?? americanoDefaultRounds(n);
  if (!Number.isInteger(count) || count < 1)
    throw new RangeError('rounds must be a positive integer');
  if (!Number.isInteger(first) || first < 1 || first - 1 + count > TOUR_LIMITS.roundsMax)
    throw new RangeError(`rounds ${first}..${first - 1 + count} leave 1..${TOUR_LIMITS.roundsMax}`);

  const seedOf = tourSeedLookup(entries);
  // Index space: 0..N-1 in seed order.
  const ids = tourSortBySeed(
    entries.map((e) => e.entry_id),
    seedOf,
  );
  const idx = new Map(ids.map((id, i) => [id, i]));
  const c = tourCourtsPerRound(n, courts.length);
  const play = tourPlayCourts(courts, c);
  const courtIdx = new Map(play.map((ct, i) => [ct.court_id, i]));

  const partner = new Int32Array(n * n);
  const opponent = new Int32Array(n * n);
  const sat = new Int32Array(n);
  let satLast = new Uint8Array(n);
  let lastCourt = new Int32Array(n).fill(-1);
  let lastRoundNo = 0;

  const record = (r: TourRound): void => {
    const nextLast = new Int32Array(n).fill(-1);
    const nextSat = new Uint8Array(n);
    for (const m of r.matches) {
      const ci = courtIdx.get(m.court_id) ?? -1;
      const a = m.a.map((id) => idx.get(id) ?? -1);
      const b = m.b.map((id) => idx.get(id) ?? -1);
      for (const [x, y] of [a, b] as [number, number][]) {
        if (x >= 0 && y >= 0) {
          partner[x * n + y]!++;
          partner[y * n + x]!++;
        }
      }
      for (const x of a)
        for (const y of b)
          if (x >= 0 && y >= 0) {
            opponent[x * n + y]!++;
            opponent[y * n + x]!++;
          }
      for (const x of [...a, ...b]) if (x >= 0) nextLast[x] = ci;
    }
    for (const id of r.sit_out) {
      const x = idx.get(id);
      if (x !== undefined) {
        sat[x]!++;
        nextSat[x] = 1;
      }
    }
    lastCourt = nextLast;
    satLast = nextSat;
    lastRoundNo = r.round_no;
  };
  for (const r of history) if (r.round_no < first) record(r);
  // Only the round straight before counts as "the round before".
  if (lastRoundNo !== first - 1) {
    satLast = new Uint8Array(n);
    lastCourt = new Int32Array(n).fill(-1);
  }

  const order = shuffle(
    ids.map((_, i) => i),
    mulberry32(seed),
  );
  const factors = circleFactors(n, order);
  const sits = n - 4 * c;

  const out: TourRound[] = [];
  for (let roundNo = first; roundNo < first + count; roundNo++) {
    const rng = mulberry32(roundSeed(seed, roundNo));
    const factor = factors[(roundNo - 1) % factors.length]!;

    // Sit-outs.
    const tiebreak = shuffle(
      ids.map((_, i) => i),
      rng,
    );
    const rankOf = new Int32Array(n);
    tiebreak.forEach((p, i) => (rankOf[p] = i));
    const bySit = ids
      .map((_, i) => i)
      .sort(
        (x, y) =>
          sat[x]! - sat[y]! ||
          satLast[x]! - satLast[y]! ||
          (y === factor.bye ? 1 : 0) - (x === factor.bye ? 1 : 0) ||
          rankOf[x]! - rankOf[y]!,
      );
    const sitting = new Uint8Array(n);
    for (let i = 0; i < sits; i++) sitting[bySit[i]!] = 1;

    // Partners kept from the circle; the rest are free for the search.
    const fixed: [number, number][] = [];
    const paired = new Uint8Array(n);
    for (const [x, y] of factor.pairs) {
      if (!sitting[x] && !sitting[y] && partner[x * n + y] === 0) {
        fixed.push([x, y]);
        paired[x] = 1;
        paired[y] = 1;
      }
    }
    const free: number[] = [];
    for (let p = 0; p < n; p++) if (!sitting[p] && !paired[p]) free.push(p);

    // The match search. A candidate is 2c pairs laid out flat (seat 4i..4i+3 = match i: a, a, b,
    // b); the buffers are reused, and `shuffleInto` draws exactly as `shuffle` does.
    const nFree = free.length;
    const nFixed = fixed.length;
    const freeBuf = Int32Array.from(free);
    const pairOrder = new Int32Array(2 * c);
    const cand = new Int32Array(4 * c);
    const best = new Int32Array(4 * c);
    let bestCost = Infinity;
    for (let k = 0; k < AMERICANO_CANDIDATES && bestCost > 0; k++) {
      freeBuf.set(free);
      shuffleInto(freeBuf, nFree, rng);
      for (let i = 0; i < 2 * c; i++) pairOrder[i] = i;
      shuffleInto(pairOrder, 2 * c, rng);
      for (let i = 0; i < 2 * c; i++) {
        const p = pairOrder[i]!;
        if (p < nFixed) {
          cand[2 * i] = fixed[p]![0];
          cand[2 * i + 1] = fixed[p]![1];
        } else {
          const f = 2 * (p - nFixed);
          cand[2 * i] = freeBuf[f]!;
          cand[2 * i + 1] = freeBuf[f + 1]!;
        }
      }
      let cost = 0;
      for (let mi = 0; mi < c && cost < bestCost; mi++) {
        const a1 = cand[4 * mi]!;
        const a2 = cand[4 * mi + 1]!;
        const b1 = cand[4 * mi + 2]!;
        const b2 = cand[4 * mi + 3]!;
        const pa = partner[a1 * n + a2]!;
        const pb = partner[b1 * n + b2]!;
        const o1 = opponent[a1 * n + b1]!;
        const o2 = opponent[a1 * n + b2]!;
        const o3 = opponent[a2 * n + b1]!;
        const o4 = opponent[a2 * n + b2]!;
        cost +=
          W_PARTNER * (pa * pa + pb * pb) +
          W_OPPONENT * (o1 * o1 + o2 * o2 + o3 * o3 + o4 * o4) +
          W_COURT *
            ((lastCourt[a1] === mi ? 1 : 0) +
              (lastCourt[a2] === mi ? 1 : 0) +
              (lastCourt[b1] === mi ? 1 : 0) +
              (lastCourt[b2] === mi ? 1 : 0));
      }
      if (cost < bestCost) {
        bestCost = cost;
        best.set(cand);
      }
    }

    const matches: TourMatch[] = [];
    for (let mi = 0; mi < c; mi++) {
      const s = 4 * mi;
      matches.push(
        tourOrderMatch(
          play[mi]!.court_id,
          [ids[best[s]!]!, ids[best[s + 1]!]!],
          [ids[best[s + 2]!]!, ids[best[s + 3]!]!],
          seedOf,
        ),
      );
    }
    const sitOut = tourSortBySeed(
      ids.filter((_, i) => sitting[i]),
      seedOf,
    );
    const round: TourRound = { round_no: roundNo, matches, sit_out: sitOut };
    out.push(round);
    record(round);
  }
  return out;
}
