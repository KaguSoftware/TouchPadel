/**
 * The engine's seeded randomness (plan §4). PURE.
 *
 * Every draw is 32-bit integer maths (`Math.imul`, shifts, `>>> 0`) and no float ever decides an
 * outcome, so Hermes (the phone), V8 (the desk and the web) and node (the parity suite) produce the
 * same schedule from the same seed, bit for bit. The desk seeds a tournament with
 * `seedFrom(tournament_id)`, so a regeneration reproduces whatever it does not have to change.
 */

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/**
 * FNV-1a, 32-bit, over the string's UTF-16 code units. A uuid is ASCII, so for a tournament id
 * this is exactly FNV-1a over its bytes.
 */
export function seedFrom(text: string): number {
  let h = FNV_OFFSET;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME);
  }
  return h >>> 0;
}

/** A generator of uint32 draws (0 ≤ draw < 2^32). */
export type TourRng = () => number;

/**
 * mulberry32 (Tommy Ettinger), returning the raw uint32 instead of the usual `/ 2^32` float: the
 * float form is this draw divided by 4294967296, the test pins the two together.
 */
export function mulberry32(seed: number): TourRng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}

/** A seed for one round of a tournament: the round's draws never depend on the rounds before. */
export function roundSeed(seed: number, roundNo: number): number {
  return seedFrom(`${seed >>> 0}:${roundNo}`);
}

/** A draw in `0..n-1` (modulo; the bias is below 2^-26 for every n the engine uses). */
export function randInt(rng: TourRng, n: number): number {
  return rng() % n;
}

/** A shuffled copy of `items` (Fisher–Yates, from the back); the input is never touched. */
export function shuffle<T>(items: readonly T[], rng: TourRng): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}
