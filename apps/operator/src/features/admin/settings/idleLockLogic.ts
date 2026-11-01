/**
 * The idle-lock timeout the owner picks (F-48): cafe setting
 * till_idle_lock_seconds, which every station of the branch reads for its
 * idle lock (routes/__root.tsx IdleLock). The server takes 0 to 3600 seconds
 * (0064's spec, int(0,3600)); 0 means the station never locks itself.
 *
 * A list of choices rather than a free number: an owner thinks "15 minutes",
 * not "900", and a list cannot hold a value the server would refuse.
 */
export const IDLE_LOCK_MAX_SECONDS = 3600;

/** Never, then 1 minute to an hour. */
export const IDLE_LOCK_CHOICES: readonly number[] = [0, 60, 120, 300, 600, 900, 1200, 1800, 2700, 3600];

/** The choices to show: the list, plus the stored value when someone set one off the list. */
export function idleLockChoices(current: number): number[] {
  const out = new Set(IDLE_LOCK_CHOICES);
  if (Number.isInteger(current) && current >= 0 && current <= IDLE_LOCK_MAX_SECONDS) out.add(current);
  return [...out].sort((a, b) => a - b);
}

/** How a choice reads: 'never', whole minutes, or minutes and seconds for an odd stored value. */
export type IdleLockLabel = { kind: 'never' } | { kind: 'minutes'; minutes: number } | { kind: 'seconds'; seconds: number };

export function idleLockLabel(seconds: number): IdleLockLabel {
  if (seconds <= 0) return { kind: 'never' };
  if (seconds % 60 === 0) return { kind: 'minutes', minutes: seconds / 60 };
  return { kind: 'seconds', seconds };
}

/** A choice the server accepts. */
export function idleLockValid(seconds: number): boolean {
  return Number.isInteger(seconds) && seconds >= 0 && seconds <= IDLE_LOCK_MAX_SECONDS;
}
