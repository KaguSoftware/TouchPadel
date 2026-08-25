import { describe, expect, it } from 'vitest';
import {
  CALL_ALARM_CONFIG,
  STALE_SECS,
  initialAlarmState,
  onCreated,
  onSeen,
  reconcile,
  type AlarmSubject,
} from './alarms';

const T0 = 1_000_000;
const sub = (id: string, ageSecs: number, pending = true): AlarmSubject => ({
  id,
  pending,
  createdMs: T0 - ageSecs * 1000,
});

describe('reconcile', () => {
  it('fresh → stale exactly at the 90 s boundary while queued', () => {
    const fresh = reconcile([sub('a', STALE_SECS - 1)], T0, initialAlarmState);
    expect(fresh.next.stale.size).toBe(0);
    expect(fresh.effects).toEqual([]);

    const stale = reconcile([sub('a', STALE_SECS)], T0, initialAlarmState);
    expect([...stale.next.stale]).toEqual(['a']);
    expect(stale.effects).toEqual([{ type: 'startAlarmTimer', ticketId: 'a' }, { type: 'alarm' }]);
  });

  it('does not start a second timer for an already-stale ticket', () => {
    const first = reconcile([sub('a', 100)], T0, initialAlarmState);
    const second = reconcile([sub('a', 110)], T0 + 10_000, first.next);
    expect(second.effects).toEqual([]);
    expect(second.next).toBe(first.next); // same instance when nothing changed
  });

  it('stops the timer when the ticket leaves queued', () => {
    const first = reconcile([sub('a', 100)], T0, initialAlarmState);
    const cleared = reconcile([sub('a', 120, false)], T0 + 20_000, first.next);
    expect(cleared.effects).toEqual([{ type: 'stopAlarmTimer', ticketId: 'a' }]);
    expect(cleared.next.stale.size).toBe(0);
  });

  it('stops the timer when the ticket disappears', () => {
    const first = reconcile([sub('a', 100)], T0, initialAlarmState);
    const gone = reconcile([], T0, first.next);
    expect(gone.effects).toEqual([{ type: 'stopAlarmTimer', ticketId: 'a' }]);
  });

  it('never goes stale for non-pending items regardless of age', () => {
    const r = reconcile([sub('a', 10_000, false)], T0, initialAlarmState);
    expect(r.next.stale.size).toBe(0);
  });

  it('emits one alarm per pass even when several go stale together', () => {
    const r = reconcile([sub('a', 100), sub('b', 200)], T0, initialAlarmState);
    expect(r.effects.filter((e) => e.type === 'alarm')).toHaveLength(1);
    expect(r.effects.filter((e) => e.type === 'startAlarmTimer')).toHaveLength(2);
  });

  it('is parameterised for waiter calls (5 min / 60 s)', () => {
    expect(reconcile([sub('c', 299)], T0, initialAlarmState, CALL_ALARM_CONFIG).next.stale.size).toBe(0);
    expect(reconcile([sub('c', 300)], T0, initialAlarmState, CALL_ALARM_CONFIG).next.stale.size).toBe(1);
    expect(CALL_ALARM_CONFIG.repeatMs).toBe(60_000);
  });
});

describe('unseen counter', () => {
  it('increments only when the window is hidden/unfocused and always chimes', () => {
    const hidden = onCreated(initialAlarmState, false);
    expect(hidden.next.unseen).toBe(1);
    expect(hidden.effects).toEqual([{ type: 'chime' }]);
    const visible = onCreated(hidden.next, true);
    expect(visible.next.unseen).toBe(1);
    expect(visible.effects).toEqual([{ type: 'chime' }]);
  });

  it('resets on focus/visible', () => {
    const s = onCreated(onCreated(initialAlarmState, false).next, false).next;
    expect(s.unseen).toBe(2);
    expect(onSeen(s).unseen).toBe(0);
    expect(onSeen(initialAlarmState)).toBe(initialAlarmState);
  });
});
