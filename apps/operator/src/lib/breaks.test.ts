import { describe, it, expect } from 'vitest';
import {
  breakPhase,
  canStartBreak,
  elapsedSeconds,
  formatElapsed,
  remainingSeconds,
  stationIdOk,
  wholeMinutes,
  type BreakStatus,
} from './breaks';

const T0 = Date.parse('2026-09-17T10:00:00Z');

function status(over: Partial<BreakStatus> = {}): BreakStatus {
  return {
    now: '2026-09-17T10:00:00Z',
    business_date: '2026-09-17',
    allowance_seconds: 3600,
    used_seconds: 600,
    remaining_seconds: 3000,
    open: null,
    candidates: [],
    ...over,
  };
}

const OPEN = {
  id: 'b1',
  station_id: 'TILL-01',
  business_date: '2026-09-17',
  started_at: '2026-09-17T09:55:00Z',
  ended_at: null,
  cover: null,
};

describe('breakPhase', () => {
  it('is none / away / covered from the open break and its cover', () => {
    expect(breakPhase(null)).toBe('none');
    expect(breakPhase(status())).toBe('none');
    expect(breakPhase(status({ open: OPEN }))).toBe('away');
    expect(breakPhase(status({ open: { ...OPEN, cover: { id: 's', display_name: 'Sara', role: 'cashier', since: '2026-09-17T09:56:00Z' } } }))).toBe('covered');
  });
});

describe('time arithmetic runs on the server clock', () => {
  it('elapsed = (server now - started) + time passed here since the stamp', () => {
    // Started 5 min before the stamp; 90 s have passed on this machine since.
    expect(elapsedSeconds(status({ open: OPEN }), T0 + 90_000)).toBe(390);
    expect(elapsedSeconds(status(), T0 + 90_000)).toBe(0);
  });

  it('a machine clock BEHIND the server never produces negative time', () => {
    expect(elapsedSeconds(status({ open: OPEN }), T0 - 60_000)).toBe(300);
    expect(remainingSeconds(status({ open: OPEN, used_seconds: 900 }), T0 - 60_000)).toBe(2700);
  });

  it('remaining counts down only while a break is open, and goes negative on an overrun', () => {
    expect(remainingSeconds(status(), T0 + 600_000)).toBe(3000);
    // used_seconds already includes the open break up to the stamp (server-side).
    expect(remainingSeconds(status({ open: OPEN, used_seconds: 900 }), T0 + 120_000)).toBe(2580);
    expect(remainingSeconds(status({ open: OPEN, used_seconds: 3500 }), T0 + 200_000)).toBe(-100);
  });
});

describe('canStartBreak', () => {
  it('needs no open break and at least a minute left', () => {
    expect(canStartBreak(status(), T0)).toBe(true);
    expect(canStartBreak(status({ open: OPEN }), T0)).toBe(false);
    expect(canStartBreak(status({ used_seconds: 3541 }), T0)).toBe(false);
    expect(canStartBreak(status({ used_seconds: 3540 }), T0)).toBe(true);
    expect(canStartBreak(null, T0)).toBe(false);
  });
});

describe('formatting', () => {
  it('rounds minutes up so a permitted break never reads as 0 min', () => {
    expect(wholeMinutes(1)).toBe(1);
    expect(wholeMinutes(60)).toBe(1);
    expect(wholeMinutes(61)).toBe(2);
    expect(wholeMinutes(-90)).toBe(2);
  });

  it('formats a running clock', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(65)).toBe('1:05');
    expect(formatElapsed(754)).toBe('12:34');
    expect(formatElapsed(3600)).toBe('1:00:00');
    expect(formatElapsed(-5)).toBe('0:00');
  });
});

describe('stationIdOk', () => {
  it('matches the server: capitals, digits, dashes, starting with a letter', () => {
    expect(stationIdOk('TILL-01')).toBe(true);
    expect(stationIdOk('DEV1')).toBe(true);
    expect(stationIdOk('till-01')).toBe(false);
    expect(stationIdOk('1TILL')).toBe(false);
    expect(stationIdOk('')).toBe(false);
  });
});
