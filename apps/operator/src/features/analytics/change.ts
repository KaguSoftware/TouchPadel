/**
 * How a figure moved against the comparison window, in words a reader can
 * check. Two rules the old tiles broke:
 *
 *  - **A rate moves in points, not percent.** A cancellation rate going from
 *    20% to 23% is "+3 pts"; the tiles printed "+3%", which reads as a 3%
 *    relative rise (20% → 20.6%). The derivation already computed points for
 *    rates; only the label was wrong.
 *  - **Tone only where a direction is good or bad**, and never tone alone: the
 *    sign and an arrow carry the direction, the colour only says whether that
 *    direction is welcome. Waiter calls and session length stay neutral.
 */
export type DeltaKind = 'pct' | 'points';
export type ChangeTone = 'success' | 'danger' | 'neutral';

export interface Change {
  /** "+12%", "−3 pts", "0%". */
  text: string;
  direction: 'up' | 'down' | 'flat';
  tone: ChangeTone;
}

export interface ChangeOptions {
  kind?: DeltaKind;
  /** A rise is bad (cancellations, refunds, waste). */
  invert?: boolean;
  /** Neither direction is good (waiter calls, session length). */
  neutral?: boolean;
}

/**
 * `delta` is a whole-number change (percent for 'pct', points for 'points');
 * `null` (no comparison, or an unreliable one) describes nothing.
 * `points` formats the number with the unit ("{n} pts").
 */
export function describeChange(
  delta: number | null | undefined,
  { kind = 'pct', invert = false, neutral = false }: ChangeOptions,
  fmt: { num: (n: number) => string; points: (body: string) => string },
): Change | null {
  if (delta == null || !Number.isFinite(delta)) return null;
  const r = Math.round(delta);
  const direction = r > 0 ? 'up' : r < 0 ? 'down' : 'flat';
  const sign = r > 0 ? '+' : r < 0 ? '−' : '';
  const body = `${sign}${fmt.num(Math.abs(r))}`;
  const text = kind === 'points' ? fmt.points(body) : `${body}%`;
  const good = direction === 'flat' || neutral ? null : invert ? direction === 'down' : direction === 'up';
  return { text, direction, tone: good === null ? 'neutral' : good ? 'success' : 'danger' };
}
