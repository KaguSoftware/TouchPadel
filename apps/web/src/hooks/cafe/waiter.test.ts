import { describe, expect, it } from 'vitest';
import {
  cooldownLeftMs,
  cooldownStorageKey,
  formatCooldown,
  isCallOpen,
  waiterPhase,
} from './waiter';

describe('waiterPhase', () => {
  it('sending beats everything', () => {
    expect(waiterPhase({ sending: true, failed: true, call: null })).toBe('sending');
    expect(
      waiterPhase({ sending: true, failed: false, call: { callId: 'c', status: 'raised' } }),
    ).toBe('sending');
  });

  it('failed beats an existing call once the RPC settles', () => {
    expect(waiterPhase({ sending: false, failed: true, call: null })).toBe('failed');
  });

  it('maps call status to the guest-facing phase', () => {
    expect(waiterPhase({ sending: false, failed: false, call: null })).toBe('idle');
    expect(
      waiterPhase({ sending: false, failed: false, call: { callId: 'c', status: 'raised' } }),
    ).toBe('raised');
    expect(
      waiterPhase({ sending: false, failed: false, call: { callId: 'c', status: 'acknowledged' } }),
    ).toBe('acknowledged');
    expect(
      waiterPhase({ sending: false, failed: false, call: { callId: 'c', status: 'resolved' } }),
    ).toBe('done');
  });

  it('isCallOpen is true until resolved', () => {
    expect(isCallOpen(null)).toBe(false);
    expect(isCallOpen({ callId: 'c', status: 'raised' })).toBe(true);
    expect(isCallOpen({ callId: 'c', status: 'acknowledged' })).toBe(true);
    expect(isCallOpen({ callId: 'c', status: 'resolved' })).toBe(false);
  });
});

describe('formatCooldown', () => {
  it('renders m:ss with a zero-padded seconds field', () => {
    expect(formatCooldown(0)).toBe('0:00');
    expect(formatCooldown(1)).toBe('0:01');
    expect(formatCooldown(9_000)).toBe('0:09');
    expect(formatCooldown(59_000)).toBe('0:59');
    expect(formatCooldown(60_000)).toBe('1:00');
    expect(formatCooldown(61_500)).toBe('1:02');
    expect(formatCooldown(125_000)).toBe('2:05');
    expect(formatCooldown(600_000)).toBe('10:00');
  });

  it('clamps nonsense to 0:00', () => {
    expect(formatCooldown(-5_000)).toBe('0:00');
    expect(formatCooldown(Number.NaN)).toBe('0:00');
    expect(formatCooldown(Number.POSITIVE_INFINITY)).toBe('0:00');
  });
});

describe('cooldown persistence', () => {
  it('keys per table, walk-in fallback', () => {
    expect(cooldownStorageKey('t-1')).toBe('tp-waiter-t-1');
    expect(cooldownStorageKey(null)).toBe('tp-waiter-walkin');
  });

  it('reads a deadline, ignoring stale or malformed values', () => {
    const now = 1_000_000;
    expect(cooldownLeftMs(String(now + 30_000), now)).toBe(30_000);
    expect(cooldownLeftMs(String(now - 1), now)).toBe(0);
    expect(cooldownLeftMs('not-a-number', now)).toBe(0);
    expect(cooldownLeftMs(null, now)).toBe(0);
  });
});
