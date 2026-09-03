/**
 * Court duration options (SOW L301 "duration options configured per court") —
 * chip-toggle logic kept pure so the 30–300/15-step contract the RPC enforces
 * (0062 INVALID_DURATIONS) is mirrored and testable client-side.
 */

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
