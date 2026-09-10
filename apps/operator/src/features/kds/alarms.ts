/**
 * Pure stale-alarm state machine shared by KDS tickets and waiter calls
 * (operator-slice §4.2, mirrors UpperDeck §3.5).
 *
 *   Ticket: (pending, age<STALE) FRESH --age>=STALE--> STALE --not pending--> CLEARED
 *   Unseen: 0 --created while hidden/unfocused--> n+1 --focus/visible--> 0
 *
 * The machine emits effects; the hook (useKdsAlarms.ts) owns the real timers.
 */
export const STALE_SECS = 90;
export const STALE_REPEAT_MS = 30_000;
export const RECONCILE_MS = 10_000;

export const CALL_STALE_SECS = 300;
export const CALL_REPEAT_MS = 60_000;

export interface AlarmConfig {
  staleSecs: number;
  repeatMs: number;
}
export const KDS_ALARM_CONFIG: AlarmConfig = { staleSecs: STALE_SECS, repeatMs: STALE_REPEAT_MS };
export const CALL_ALARM_CONFIG: AlarmConfig = { staleSecs: CALL_STALE_SECS, repeatMs: CALL_REPEAT_MS };

/** Minimal shape both tickets and waiter calls satisfy. */
export interface AlarmSubject {
  id: string;
  /** true while the item still needs a first human action (queued / raised). */
  pending: boolean;
  /** epoch ms when it was created / raised. */
  createdMs: number;
}

export interface AlarmState {
  /** ids currently stale (each owns exactly one repeating timer). */
  stale: ReadonlySet<string>;
  unseen: number;
}

export type Effect =
  | { type: 'chime' }
  | { type: 'alarm' }
  | { type: 'startAlarmTimer'; ticketId: string }
  | { type: 'stopAlarmTimer'; ticketId: string };

export const initialAlarmState: AlarmState = { stale: new Set(), unseen: 0 };

export function isStale(s: AlarmSubject, nowMs: number, cfg: AlarmConfig = KDS_ALARM_CONFIG): boolean {
  return s.pending && (nowMs - s.createdMs) / 1000 >= cfg.staleSecs;
}

/**
 * Diff the stale set against the current subjects. Emits one start per newly
 * stale id, one stop per id that left stale (no longer pending, or vanished),
 * and an immediate 'alarm' when anything became stale in this pass.
 */
export function reconcile(
  subjects: readonly AlarmSubject[],
  nowMs: number,
  prev: AlarmState,
  cfg: AlarmConfig = KDS_ALARM_CONFIG,
): { next: AlarmState; effects: Effect[] } {
  const effects: Effect[] = [];
  const stale = new Set<string>();
  for (const s of subjects) if (isStale(s, nowMs, cfg)) stale.add(s.id);

  let becameStale = false;
  for (const id of stale) {
    if (!prev.stale.has(id)) {
      effects.push({ type: 'startAlarmTimer', ticketId: id });
      becameStale = true;
    }
  }
  for (const id of prev.stale) {
    if (!stale.has(id)) effects.push({ type: 'stopAlarmTimer', ticketId: id });
  }
  if (becameStale) effects.push({ type: 'alarm' });

  // Unchanged set → keep the previous instance so React deps stay stable.
  const same = stale.size === prev.stale.size && [...stale].every((id) => prev.stale.has(id));
  return { next: same ? prev : { ...prev, stale }, effects };
}

/** A new item arrived over broadcast. Always chimes; counts as unseen when the window is not visible/focused. */
export function onCreated(prev: AlarmState, visible: boolean): { next: AlarmState; effects: Effect[] } {
  return {
    next: visible ? prev : { ...prev, unseen: prev.unseen + 1 },
    effects: [{ type: 'chime' }],
  };
}

/** Window regained focus / became visible. */
export function onSeen(prev: AlarmState): AlarmState {
  return prev.unseen === 0 ? prev : { ...prev, unseen: 0 };
}
