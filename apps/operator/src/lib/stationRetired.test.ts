import { beforeEach, describe, expect, it } from 'vitest';
import { idleLockTimeout, nextRetired, rememberIdleLock, rememberRetired, rememberedIdleLock, rememberedRetired } from './stationRetired';
import { stationVerdict } from './heartbeat';

// A node test: a tiny localStorage stand-in.
const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

beforeEach(() => store.clear());

describe('retired station (F-49)', () => {
  it('reads the beat: retired, live, or neither (never registered, older server)', () => {
    expect(stationVerdict({ degraded: false, server_time: '', registered: false, retired: true })).toBe('retired');
    expect(stationVerdict({ degraded: false, server_time: '', registered: true })).toBe('live');
    expect(stationVerdict({ degraded: false, server_time: '', registered: false, retired: false })).toBe('other');
    expect(stationVerdict({ degraded: false, server_time: '' })).toBe('other');
  });

  it('only a live beat lifts it; an outage or an unknown answer never does', () => {
    expect(nextRetired(false, 'retired')).toBe(true);
    expect(nextRetired(true, null)).toBe(true);
    expect(nextRetired(true, undefined)).toBe(true);
    expect(nextRetired(true, 'other')).toBe(true);
    expect(nextRetired(true, 'live')).toBe(false);
    expect(nextRetired(false, 'other')).toBe(false);
  });

  it('is remembered per station id across a restart', () => {
    expect(rememberedRetired('TILL-01')).toBe(false);
    rememberRetired('TILL-01', true);
    expect(rememberedRetired('TILL-01')).toBe(true);
    expect(rememberedRetired('TILL-02')).toBe(false);
    rememberRetired('TILL-02', false);
    expect(rememberedRetired('TILL-01')).toBe(true);
    rememberRetired('TILL-01', false);
    expect(rememberedRetired('TILL-01')).toBe(false);
  });
});

describe('the idle-lock timeout every role runs (F-48)', () => {
  it('the owner’s value from the beat wins; without one, the settings value (or its default)', () => {
    expect(idleLockTimeout(300, 900)).toBe(300);
    expect(idleLockTimeout(0, 900)).toBe(0);
    expect(idleLockTimeout(null, 900)).toBe(900);
  });

  it('is remembered for an offline boot, and only a sane value is read back', () => {
    expect(rememberedIdleLock()).toBeNull();
    rememberIdleLock(600);
    expect(rememberedIdleLock()).toBe(600);
    rememberIdleLock(null);
    expect(rememberedIdleLock()).toBeNull();
    store.set('tp.station.idleLockSeconds', '99999');
    expect(rememberedIdleLock()).toBeNull();
  });
});
