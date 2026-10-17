import { describe, expect, it } from 'vitest';
import {
  agoOf,
  filterRows,
  onlineCounts,
  operatorScreenLabelKey,
  partWord,
  seenToday,
  serverNow,
  type ActivityPart,
  type ActivityRow,
} from './activityLogic';

const TZ = 'Asia/Baghdad';
const NOW = Date.parse('2026-10-16T12:00:00Z'); // 15:00 in Baghdad

const part = (over: Partial<ActivityPart> = {}): ActivityPart => ({
  status: 'online',
  state: 'active',
  stateAt: '2026-10-16T11:59:00Z',
  lastSeenAt: '2026-10-16T11:59:00Z',
  screen: '/till',
  appVersion: '0.2.30',
  deviceId: 'TILL1',
  lastAction: 'discount.apply',
  lastActionEntity: 'tab',
  lastActionAt: '2026-10-16T11:50:00Z',
  ...over,
});
const row = (over: Partial<ActivityRow> = {}): ActivityRow => ({
  staffId: 's1',
  name: 'Hasan',
  role: 'waiter',
  onBreak: false,
  operator: null,
  mobile: null,
  ...over,
});

describe('serverNow', () => {
  it('counts from the server clock, not the PC clock', () => {
    // The PC is ten minutes fast; thirty seconds passed since the fetch.
    const fetchedAt = NOW + 600_000;
    expect(serverNow('2026-10-16T12:00:00Z', fetchedAt, fetchedAt + 30_000)).toBe(NOW + 30_000);
  });
  it('never goes backwards when the PC clock does', () => {
    expect(serverNow('2026-10-16T12:00:00Z', 5_000, 1_000)).toBe(NOW);
  });
  it('falls back to the PC clock on a bad server time', () => {
    expect(serverNow('nope', 0, 42)).toBe(42);
  });
});

describe('agoOf', () => {
  it('just now under a minute, and for a time ahead of now', () => {
    expect(agoOf('2026-10-16T11:59:30Z', NOW)).toEqual({ unit: 'justNow' });
    expect(agoOf('2026-10-16T12:05:00Z', NOW)).toEqual({ unit: 'justNow' });
  });
  it('minutes, hours, days', () => {
    expect(agoOf('2026-10-16T11:58:00Z', NOW)).toEqual({ unit: 'minutes', count: 2 });
    expect(agoOf('2026-10-16T09:00:00Z', NOW)).toEqual({ unit: 'hours', count: 3 });
    expect(agoOf('2026-10-13T11:00:00Z', NOW)).toEqual({ unit: 'days', count: 3 });
  });
});

describe('partWord', () => {
  it('never used, signed out, or the server status', () => {
    expect(partWord(null)).toBe('never');
    expect(partWord(part({ status: 'offline', state: 'signed_out' }))).toBe('signedOut');
    expect(partWord(part({ status: 'offline', state: 'background' }))).toBe('offline');
    expect(partWord(part({ status: 'away', state: 'background' }))).toBe('away');
    expect(partWord(part())).toBe('online');
  });
});

describe('filters and counts', () => {
  const rows = [
    row({ staffId: 'a', name: 'Ali', operator: part() }),
    row({ staffId: 'b', name: 'Bareq', mobile: part({ status: 'away' }) }),
    // Last seen yesterday evening in Baghdad (20:00 local).
    row({ staffId: 'c', name: 'Maha', mobile: part({ status: 'offline', lastSeenAt: '2026-10-15T17:00:00Z' }) }),
    row({ staffId: 'd', name: 'Tiba' }),
    row({ staffId: 'e', name: 'Yusuf', operator: part({ status: 'offline' }), mobile: part() }),
  ];
  it('online now: either app online, in the server order', () => {
    expect(filterRows(rows, 'online', NOW, TZ).map((r) => r.staffId)).toEqual(['a', 'e']);
  });
  it('not seen today, by the venue calendar day; never used counts as not seen', () => {
    expect(filterRows(rows, 'notToday', NOW, TZ).map((r) => r.staffId)).toEqual(['c', 'd']);
    // 21:30Z on the 15th is 00:30 on the 16th in Baghdad: today.
    expect(seenToday(row({ mobile: part({ lastSeenAt: '2026-10-15T21:30:00Z' }) }), NOW, TZ)).toBe(true);
  });
  it('all keeps every row as sent', () => {
    expect(filterRows(rows, 'all', NOW, TZ).map((r) => r.name)).toEqual(['Ali', 'Bareq', 'Maha', 'Tiba', 'Yusuf']);
  });
  it('counts online people per app', () => {
    expect(onlineCounts(rows)).toEqual({ operator: 1, mobile: 1 });
  });
});

describe('operatorScreenLabelKey', () => {
  it('names a screen by its rail row', () => {
    expect(operatorScreenLabelKey('/observation/tills')).toBe('tills');
    expect(operatorScreenLabelKey('/admin/audit')).toBe('audit');
  });
  it('null for no screen or a path no rail row covers', () => {
    expect(operatorScreenLabelKey(null)).toBeNull();
    expect(operatorScreenLabelKey('/no/such/screen')).toBeNull();
  });
});
