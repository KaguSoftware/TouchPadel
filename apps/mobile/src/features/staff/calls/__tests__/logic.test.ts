import { describe, expect, it } from 'vitest';
import {
  CALL_ROLES,
  actionKey,
  answeredBy,
  callRefusal,
  callUrgency,
  elapsedSince,
  openCallCount,
  orderCalls,
  readCalls,
  reasonKey,
  wasDuplicate,
  type WaiterCall,
} from '../logic';

const NOW = Date.parse('2026-09-26T12:00:00Z');
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

const call = (id: string, minutes: number, patch: Partial<WaiterCall> = {}): WaiterCall => ({
  id,
  reason: 'bill',
  status: 'raised',
  raised_at: ago(minutes),
  acknowledged_by: null,
  table: { table_number: '4' },
  ...patch,
});

describe('guest calls on the phone (wave 5 §2.1.8)', () => {
  it('are the waiter’s: the till keeps the cashier and managers', () => {
    expect(CALL_ROLES).toEqual(['waiter']);
  });

  it('read amber at 2 minutes and red at 5 while nobody answers, the till’s thresholds', () => {
    expect(callUrgency(call('a', 1), NOW)).toBe('calm');
    expect(callUrgency(call('a', 2), NOW)).toBe('warn');
    expect(callUrgency(call('a', 4), NOW)).toBe('warn');
    expect(callUrgency(call('a', 5), NOW)).toBe('late');
    expect(callUrgency(call('a', 30, { status: 'acknowledged' }), NOW)).toBe('calm');
    // Older than two hours is old news, not an alarm.
    expect(callUrgency(call('a', 121), NOW)).toBe('calm');
  });

  it('list newest first, with the ones older than two hours after them', () => {
    const { recent, old } = orderCalls(
      [call('mid', 10), call('old', 180), call('new', 1), call('older', 300)],
      NOW,
    );
    expect(recent.map((c) => c.id)).toEqual(['new', 'mid']);
    expect(old.map((c) => c.id)).toEqual(['old', 'older']);
  });

  it('count the open calls of the last two hours on Today, answered or not', () => {
    expect(openCallCount(undefined, NOW)).toBe(0);
    expect(
      openCallCount([call('a', 3), call('b', 9, { status: 'acknowledged' }), call('c', 200)], NOW),
    ).toBe(2);
  });

  it('age on the till’s scale', () => {
    expect(elapsedSince(ago(0), NOW)).toEqual({ unit: 'now' });
    expect(elapsedSince(ago(25), NOW)).toEqual({ unit: 'minutes', minutes: 25 });
    expect(elapsedSince(ago(130), NOW)).toEqual({ unit: 'hours', hours: 2, minutes: 10 });
    expect(elapsedSince(ago(24 * 60 * 2 + 180), NOW)).toEqual({ unit: 'days', days: 2, hours: 3 });
    // A clock behind the server's never reads as negative.
    expect(elapsedSince(new Date(NOW + 60_000).toISOString(), NOW)).toEqual({ unit: 'now' });
  });

  it('say who is on the way', () => {
    expect(answeredBy(call('a', 1), 'me')).toBe('none');
    expect(answeredBy(call('a', 1, { status: 'acknowledged', acknowledged_by: 'me' }), 'me')).toBe(
      'me',
    );
    expect(
      answeredBy(call('a', 1, { status: 'acknowledged', acknowledged_by: 'maha' }), 'me'),
    ).toBe('other');
    expect(answeredBy(call('a', 1, { status: 'acknowledged', acknowledged_by: null }), null)).toBe(
      'other',
    );
  });

  it('key each button per call and action', () => {
    expect(actionKey('c1', 'ack')).toBe('c1:ack');
    expect(actionKey('c1', 'resolve')).not.toBe(actionKey('c1', 'ack'));
    expect(actionKey('c2', 'ack')).not.toBe(actionKey('c1', 'ack'));
  });

  it('read a call closed on the till, or another venue’s, as already answered', () => {
    expect(callRefusal(new Error('CALL_NOT_FOUND'))).toBe('answered');
    expect(callRefusal({ message: 'INVALID_TRANSITION' })).toBe('answered');
    expect(callRefusal(new Error('FORBIDDEN'))).toBe('other');
    expect(callRefusal(new TypeError('Network request failed'))).toBe('other');
  });

  it('name each reason in the till’s words, and an unknown one as assistance', () => {
    expect(reasonKey('bill')).toBe('op.floor.reasons.bill');
    expect(reasonKey('water')).toBe('op.floor.reasons.water');
    expect(reasonKey('order')).toBe('op.floor.reasons.order');
    expect(reasonKey('assistance')).toBe('op.floor.reasons.assistance');
    expect(reasonKey('napkins')).toBe('op.floor.reasons.assistance');
  });

  it('read rows defensively', () => {
    expect(readCalls(null)).toEqual([]);
    const rows = readCalls([
      {
        id: 'a',
        reason: 'water',
        status: 'raised',
        raised_at: ago(1),
        acknowledged_by: null,
        table: { table_number: '7' },
      },
      { id: 'b', reason: 'bill', status: 'resolved', raised_at: ago(1) },
      { reason: 'bill', status: 'raised', raised_at: ago(1) },
      { id: 'c', status: 'acknowledged', raised_at: ago(2), acknowledged_by: 'u1', table: null },
    ]);
    expect(rows.map((r) => r.id)).toEqual(['a', 'c']);
    expect(rows[0]!.table).toEqual({ table_number: '7' });
    expect(rows[1]).toMatchObject({ reason: 'assistance', acknowledged_by: 'u1', table: null });
  });
});

describe('an acknowledge that was already made', () => {
  it('reads 0032’s duplicate flag, and nothing else, as already answered', () => {
    expect(wasDuplicate({ duplicate: true, call_id: 'a', status: 'acknowledged' })).toBe(true);
    expect(wasDuplicate({ duplicate: false, call_id: 'a', status: 'acknowledged' })).toBe(false);
    expect(wasDuplicate(null)).toBe(false);
    expect(wasDuplicate('duplicate')).toBe(false);
  });
});
