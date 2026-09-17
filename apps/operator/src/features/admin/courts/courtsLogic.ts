/**
 * Court duration options (SOW L301 "duration options configured per court") —
 * chip-toggle logic kept pure so the 30–300/15-step contract the RPC enforces
 * (0062 INVALID_DURATIONS) is mirrored and testable client-side — plus the
 * reading of app.delete_court's COURT_IN_USE refusal (0074).
 */
import { AppRpcError } from '../../../lib/appRpc';

export const DURATION_CHOICES = [30, 45, 60, 75, 90, 120, 150, 180] as const;

export function toggleDuration(selected: readonly number[], value: number): number[] {
  const next = selected.includes(value)
    ? selected.filter((v) => v !== value)
    : [...selected, value];
  return next.sort((a, b) => a - b);
}

export function durationsValid(selected: readonly number[]): boolean {
  return (
    selected.length > 0 && selected.every((v) => v >= 30 && v <= 300 && v % 15 === 0)
  );
}

/** What is holding a court that cannot be deleted (0074 COURT_IN_USE detail). */
export interface CourtUsage {
  reservations: number;
  series: number;
  rate_rules: number;
}

/**
 * app.delete_court raises COURT_IN_USE with the counts as JSON in the error's
 * DETAIL, so the screen can say what is holding the court rather than "it is in
 * use". Returns null for anything that is not that refusal — a real failure
 * must not be dressed up as one.
 *
 * A COURT_IN_USE whose detail will not parse still returns a usage: the
 * operator needs the refusal and the deactivate offered with it far more than
 * they need the exact numbers, and throwing out of an error handler would show
 * them neither.
 */
export function courtUsageFromError(error: unknown): CourtUsage | null {
  if (!(error instanceof AppRpcError) || error.code !== 'COURT_IN_USE') return null;
  const zero: CourtUsage = { reservations: 0, series: 0, rate_rules: 0 };
  try {
    const parsed = JSON.parse(error.details ?? '') as Partial<Record<keyof CourtUsage, unknown>>;
    if (!parsed || typeof parsed !== 'object') return zero;
    const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    return {
      reservations: num(parsed.reservations),
      series: num(parsed.series),
      rate_rules: num(parsed.rate_rules),
    };
  } catch {
    return zero;
  }
}

/**
 * Calendar order when only some courts are listed (switched-off courts fold
 * away). Moving a court swaps it with its neighbour IN THE LIST THE OWNER SEES,
 * and the full order sent to app.reorder_courts keeps every hidden court where
 * it was. Null when the move goes nowhere (top of the list, bottom, unknown id).
 */
export function moveAmongShown(allIds: readonly string[], shownIds: readonly string[], id: string, delta: -1 | 1): string[] | null {
  const at = shownIds.indexOf(id);
  const neighbour = shownIds[at + delta];
  if (at < 0 || neighbour === undefined) return null;
  const from = allIds.indexOf(id);
  const to = allIds.indexOf(neighbour);
  if (from < 0 || to < 0) return null;
  const next = [...allIds];
  next[from] = neighbour;
  next[to] = id;
  return next;
}
