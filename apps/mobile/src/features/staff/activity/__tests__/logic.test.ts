import { describe, expect, it } from 'vitest';
import { makeT, type MessageKey } from '@touch/i18n';
import {
  PING_INTERVAL_MS,
  actionFamily,
  actionWords,
  appStateToPing,
  codeToKey,
  filterRows,
  hasMessage,
  onlineCounts,
  partStatus,
  pingScreen,
  shouldPing,
  sinceOf,
  type ActivityPart,
  type ActivityRow,
} from '../logic';

const part = (status: ActivityPart['status']): ActivityPart => ({
  status,
  state: 'active',
  stateAt: '2026-10-16T10:00:00Z',
  lastSeenAt: '2026-10-16T10:00:00Z',
  screen: null,
  appVersion: null,
  deviceId: null,
  lastAction: null,
  lastActionEntity: null,
  lastActionAt: null,
});

const row = (name: string, operator: ActivityPart | null, mobile: ActivityPart | null): ActivityRow => ({
  staffId: name,
  name,
  role: 'waiter',
  onBreak: false,
  operator,
  mobile,
});

describe('the board', () => {
  const rows = [
    row('Ali', part('online'), null),
    row('Bareq', null, null),
    row('Hiba', part('away'), part('online')),
    row('Zaid', part('offline'), part('away')),
  ];

  it('reads a part never used as never', () => {
    expect(partStatus(null)).toBe('never');
    expect(partStatus(part('away'))).toBe('away');
  });

  it('keeps name order and drops only the people offline on both apps', () => {
    expect(filterRows(rows, 'all').map((r) => r.name)).toEqual(['Ali', 'Bareq', 'Hiba', 'Zaid']);
    expect(filterRows(rows, 'online').map((r) => r.name)).toEqual(['Ali', 'Hiba']);
  });

  it('counts the people online on each app', () => {
    expect(onlineCounts(rows)).toEqual({ operator: 1, mobile: 1 });
    expect(onlineCounts([])).toEqual({ operator: 0, mobile: 0 });
  });
});

describe('sinceOf', () => {
  const server = '2026-10-16T12:00:00.000Z';
  const fetched = 1_000_000;

  it('counts against the server clock plus the time since the fetch', () => {
    expect(sinceOf('2026-10-16T11:57:00Z', server, fetched, fetched)).toEqual({ kind: 'minutes', n: 3 });
    // Two minutes after the fetch, on any phone clock.
    expect(sinceOf('2026-10-16T11:57:00Z', server, fetched, fetched + 120_000)).toEqual({
      kind: 'minutes',
      n: 5,
    });
  });

  it('reads under a minute, and a little in the future, as now', () => {
    expect(sinceOf('2026-10-16T11:59:30Z', server, fetched, fetched)).toEqual({ kind: 'now' });
    expect(sinceOf('2026-10-16T12:00:20Z', server, fetched, fetched)).toEqual({ kind: 'now' });
  });

  it('moves to hours, days, then a date after a week', () => {
    expect(sinceOf('2026-10-16T09:00:00Z', server, fetched, fetched)).toEqual({ kind: 'hours', n: 3 });
    expect(sinceOf('2026-10-14T11:00:00Z', server, fetched, fetched)).toEqual({ kind: 'days', n: 2 });
    const old = sinceOf('2026-10-01T12:00:00Z', server, fetched, fetched);
    expect(old.kind).toBe('date');
  });

  it('never goes backwards when the phone clock is behind the fetch', () => {
    expect(sinceOf('2026-10-16T11:57:00Z', server, fetched, fetched - 60_000)).toEqual({
      kind: 'minutes',
      n: 3,
    });
  });
});

describe('action words', () => {
  const t = makeT('en') as (key: MessageKey) => string;

  it('uses the desktop Audit log key rule', () => {
    expect(codeToKey('order_item.void')).toBe('orderItemVoid');
    expect(codeToKey('discount.apply')).toBe('discountApply');
    expect(actionFamily('discount.apply')).toBe('discount');
    expect(actionFamily('login')).toBe('login');
  });

  it("says a known action in the Audit log's own words", () => {
    expect(hasMessage('ws.manager.audit.actions.discountApply')).toBe(true);
    expect(actionWords('discount.apply', t)).toBe(t('ws.manager.audit.actions.discountApply' as MessageKey));
    expect(actionWords('discount.apply', makeT('ar') as (key: MessageKey) => string)).not.toBe(
      actionWords('discount.apply', t),
    );
  });

  it("falls back to the area's words and the code, then to the code", () => {
    const fam = t('ws.manager.audit.families.discount' as MessageKey);
    expect(actionWords('discount.something_new', t)).toBe(`${fam} · discount.something_new`);
    expect(actionWords('zzz.unknown', t)).toBe('zzz.unknown');
  });

  it('never takes a branch of the catalog for a string', () => {
    expect(hasMessage('ws.manager.audit')).toBe(false);
    expect(hasMessage('ws.nope.nothing')).toBe(false);
  });
});

describe('the ping', () => {
  const at = 5_000_000;

  it('sends the first one, and any change of state', () => {
    expect(shouldPing(null, { state: 'active', screen: '/staff' }, at)).toBe(true);
    const last = { state: 'active' as const, screen: '/staff', at };
    expect(shouldPing(last, { state: 'background', screen: '/staff' }, at + 1)).toBe(true);
    expect(shouldPing(last, { state: 'signed_out', screen: '/staff' }, at + 1)).toBe(true);
  });

  it('sends a new page in the foreground at once', () => {
    const last = { state: 'active' as const, screen: '/staff', at };
    expect(shouldPing(last, { state: 'active', screen: '/staff-order' }, at + 1)).toBe(true);
  });

  it('otherwise sends once a minute', () => {
    const last = { state: 'active' as const, screen: '/staff', at };
    expect(shouldPing(last, { state: 'active', screen: '/staff' }, at + 30_000)).toBe(false);
    expect(shouldPing(last, { state: 'active', screen: '/staff' }, at + PING_INTERVAL_MS)).toBe(true);
    // A timer a little early still counts.
    expect(shouldPing(last, { state: 'active', screen: '/staff' }, at + PING_INTERVAL_MS - 500)).toBe(true);
  });

  it('does not repeat "background" on a page change behind the screen', () => {
    const last = { state: 'background' as const, screen: '/staff', at };
    expect(shouldPing(last, { state: 'background', screen: '/staff-order' }, at + 1)).toBe(false);
  });

  it('maps the app state', () => {
    expect(appStateToPing('active')).toBe('active');
    expect(appStateToPing('background')).toBe('background');
    expect(appStateToPing('inactive')).toBe('background');
    expect(appStateToPing('unknown')).toBeNull();
    expect(appStateToPing('extension')).toBeNull();
  });

  it('keeps the screen to what the database takes', () => {
    expect(pingScreen('/staff-order')).toBe('/staff-order');
    expect(pingScreen('')).toBe('/');
    expect(pingScreen(null)).toBe('/');
    expect(pingScreen('/a b?c=1')).toBe('/abc1');
    expect(pingScreen(`/${'x'.repeat(300)}`)).toHaveLength(160);
  });
});
