import { describe, expect, it } from 'vitest';
import { PING_MIN_GAP_MS, nextPing, pingStateFor, pingVersion, screenOf, type LastPing } from './activityPing';

describe('pingStateFor', () => {
  it('reports active while visible and background once hidden', () => {
    expect(pingStateFor('mount', true)).toBe('active');
    expect(pingStateFor('mount', false)).toBe('background');
    expect(pingStateFor('hidden', false)).toBe('background');
    expect(pingStateFor('visible', true)).toBe('active');
    expect(pingStateFor('signOut', true)).toBe('signed_out');
  });
  it('a tick or a route change behind a hidden window reports nothing', () => {
    expect(pingStateFor('tick', true)).toBe('active');
    expect(pingStateFor('tick', false)).toBeNull();
    expect(pingStateFor('route', false)).toBeNull();
  });
});

describe('nextPing', () => {
  const last: LastPing = { state: 'active', screen: '/till', at: 1_000_000 };
  it('the first ping is always sent', () => {
    expect(nextPing('mount', true, '/till', null, 5)).toEqual({ state: 'active', screen: '/till', at: 5 });
  });
  it('skips an identical ping inside the server window, sends it after', () => {
    expect(nextPing('tick', true, '/till', last, last.at + PING_MIN_GAP_MS - 1)).toBeNull();
    expect(nextPing('tick', true, '/till', last, last.at + 60_000)).toEqual({ state: 'active', screen: '/till', at: last.at + 60_000 });
  });
  it('a new screen or a new state goes at once', () => {
    expect(nextPing('route', true, '/till/tabs', last, last.at + 1)?.screen).toBe('/till/tabs');
    expect(nextPing('hidden', false, '/till', last, last.at + 1)?.state).toBe('background');
  });
  it('sign-out is always sent', () => {
    expect(nextPing('signOut', true, '/till', { ...last, state: 'signed_out' }, last.at + 1)?.state).toBe('signed_out');
  });
  it('nothing while hidden but the background ping', () => {
    expect(nextPing('tick', false, '/till', last, last.at + 120_000)).toBeNull();
  });
});

describe('screenOf / pingVersion', () => {
  it('trims the query, the hash and the trailing slash', () => {
    expect(screenOf('/till/tabs/?x=1')).toBe('/till/tabs');
    expect(screenOf('/admin/audit#top')).toBe('/admin/audit');
    expect(screenOf('')).toBe('/');
  });
  it('an empty version is null', () => {
    expect(pingVersion('0.2.30')).toBe('0.2.30');
    expect(pingVersion('  ')).toBeNull();
    expect(pingVersion(undefined)).toBeNull();
  });
});
