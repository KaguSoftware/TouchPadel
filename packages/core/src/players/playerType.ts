/**
 * A player's level as people see it: Type A, Type B or Type C, the way padel
 * clubs grade players (Majed, 2026-11-12: "everywhere it shows type A, type B,
 * type C, and never the regular way of ranking").
 *
 * The stored codes stay as they are (`profiles.play_level`,
 * `profiles.level_confirmed`, `coaches.levels`: new | beginner | intermediate |
 * advanced) so older app builds keep saving, and the server's tournament rule
 * already reads them this way (0359: advanced A, intermediate B, beginner or
 * new C). Every screen turns a code into a type here and never prints a code's
 * own word.
 *
 * PURE (no React, no network).
 */

/** The three types, best first: the order every picker and list shows them in. */
export const PLAYER_TYPES = ['A', 'B', 'C'] as const;
export type PlayerType = (typeof PLAYER_TYPES)[number];

/** Every stored level code (`profiles.play_level` / `level_confirmed`). */
export type PlayLevelCode = 'new' | 'beginner' | 'intermediate' | 'advanced';

/**
 * The level codes a picker offers, one per type, in type order (A, B, C).
 * Picking Type C saves `beginner`; `new` is only ever kept, never offered.
 */
export const PICKABLE_LEVELS = ['advanced', 'intermediate', 'beginner'] as const satisfies readonly PlayLevelCode[];
export type PickableLevel = (typeof PICKABLE_LEVELS)[number];

/** The type a stored level code reads as; null for no level or a code this build does not know. */
export function playerTypeOf(level: string | null | undefined): PlayerType | null {
  switch (level) {
    case 'advanced':
      return 'A';
    case 'intermediate':
      return 'B';
    case 'beginner':
    case 'new':
      return 'C';
    default:
      return null;
  }
}

/**
 * The bucket a level bucket reads under: `new` folds into `beginner` (both
 * Type C) so a card prints Type C once; any other bucket is itself.
 */
export function typeBucketOf(bucket: string): string {
  return bucket === 'new' ? 'beginner' : bucket;
}

/**
 * Rows whose `key` matches after `typeBucketOf` are merged, in first-seen
 * order, by adding up `sum` fields (a null share plus a number is the number).
 * Only ever joins two server figures for one type; never makes a figure up.
 */
export function foldTypeRows<T extends object>(
  rows: readonly T[],
  key: (row: T) => string,
  sum: readonly { [K in keyof T]: T[K] extends number | null ? K : never }[keyof T][],
  rename: (row: T) => T = (r) => r,
): T[] {
  const out: T[] = [];
  const at = new Map<string, number>();
  for (const raw of rows) {
    const row = rename(raw);
    const k = key(row);
    const i = at.get(k);
    if (i === undefined) {
      at.set(k, out.length);
      out.push({ ...row });
      continue;
    }
    const into = out[i] as Record<string, unknown>;
    for (const f of sum) {
      const a = into[f as string] as number | null;
      const b = (row as Record<string, unknown>)[f as string] as number | null;
      into[f as string] = a === null ? b : b === null ? a : a + b;
    }
  }
  return out;
}

/** The code a picker offers for a type. */
export function levelOfType(type: PlayerType): PickableLevel {
  return type === 'A' ? 'advanced' : type === 'B' ? 'intermediate' : 'beginner';
}

/**
 * Do two codes read as the same type? A picker shows one choice per type, so
 * the choice is "selected" when the current code reads as its type (a stored
 * `new` lights Type C).
 */
export function sameType(a: string | null | undefined, b: string | null | undefined): boolean {
  const ta = playerTypeOf(a);
  return ta !== null && ta === playerTypeOf(b);
}

/**
 * The code to save when a picker's choice is pressed: the current code when it
 * already reads as that type (pressing Type C on a stored `new` changes
 * nothing), else the type's own code.
 */
export function levelForPick<C extends string>(picked: PickableLevel, current: C | null | undefined): PickableLevel | C {
  return current != null && sameType(current, picked) ? current : picked;
}
