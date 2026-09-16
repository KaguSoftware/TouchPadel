/**
 * How long something has been waiting, in the unit a person reads it in.
 *
 * The waiter-call panel used to count only minutes, so a call left over from
 * yesterday read "Waiting 2720 min" — a number nobody converts in their head
 * while a queue waits. The open-tabs board stopped at hours and wrapped
 * "29 h 44 min" onto three lines. Both now go through this one scale:
 *
 *   < 1 min   just now
 *   < 1 h     25 min
 *   < 1 day   2 h 10 min
 *   ≥ 1 day   2 d 3 h
 *
 * Display only: the timestamp is the server's, `now` is this station's clock.
 */

export type Elapsed =
  | { unit: 'now' }
  | { unit: 'minutes'; minutes: number }
  | { unit: 'hours'; hours: number; minutes: number }
  | { unit: 'days'; days: number; hours: number };

export function elapsedSince(fromIso: string, now: number): Elapsed {
  const minutes = Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 60_000));
  if (minutes < 1) return { unit: 'now' };
  if (minutes < 60) return { unit: 'minutes', minutes };
  if (minutes < 24 * 60) return { unit: 'hours', hours: Math.floor(minutes / 60), minutes: minutes % 60 };
  return { unit: 'days', days: Math.floor(minutes / (24 * 60)), hours: Math.floor(minutes / 60) % 24 };
}

/** Whole minutes elapsed — the escalation thresholds are written in minutes. */
export function minutesSince(fromIso: string, now: number): number {
  return Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 60_000));
}

type ElapsedKey = 'ws.cashier.tabs.ageNow' | 'ws.cashier.tabs.age' | 'ws.cashier.tabs.ageHours' | 'ws.cashier.tabs.ageDays';
type Tr = (key: ElapsedKey, params?: Record<string, string | number>) => string;

/** "just now" · "25 min" · "2 h 10 min" · "2 d 3 h". */
export function formatElapsed(fromIso: string, now: number, tr: Tr): string {
  const e = elapsedSince(fromIso, now);
  switch (e.unit) {
    case 'now':
      return tr('ws.cashier.tabs.ageNow');
    case 'minutes':
      return tr('ws.cashier.tabs.age', { minutes: e.minutes });
    case 'hours':
      return tr('ws.cashier.tabs.ageHours', { hours: e.hours, minutes: e.minutes });
    case 'days':
      return tr('ws.cashier.tabs.ageDays', { days: e.days, hours: e.hours });
  }
}
