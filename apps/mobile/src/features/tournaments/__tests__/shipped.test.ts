import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseTournamentsFlag, tournamentsShipped } from '../shipped';
import { anyTournaments } from '../logic';
import { suggest } from '../../playProfile/suggest';

/**
 * The tournaments build switch (Majed, 2026-10-22: off in production for now, everything kept).
 * Off, no branch's switch can bring tournaments back on the phone, and nothing suggests them.
 */
afterEach(() => vi.unstubAllEnvs());

describe('parseTournamentsFlag', () => {
  it('on by default; only the literal "off" disables', () => {
    expect(parseTournamentsFlag('off')).toBe(false);
    expect(parseTournamentsFlag(' OFF ')).toBe(false);
    for (const v of ['on', '', 'true', '1', undefined, null]) {
      expect(parseTournamentsFlag(v)).toBe(true);
    }
  });

  it('reads the env at call time', () => {
    vi.stubEnv('EXPO_PUBLIC_TOURNAMENTS', 'on');
    expect(tournamentsShipped()).toBe(true);
    vi.stubEnv('EXPO_PUBLIC_TOURNAMENTS', 'off');
    expect(tournamentsShipped()).toBe(false);
  });
});

describe('a build without tournaments', () => {
  it('reads every branch as off, whatever it says', () => {
    vi.stubEnv('EXPO_PUBLIC_TOURNAMENTS', 'off');
    expect(anyTournaments([{ tournaments_enabled: true }])).toBe(false);
    vi.stubEnv('EXPO_PUBLIC_TOURNAMENTS', 'on');
    expect(anyTournaments([{ tournaments_enabled: true }])).toBe(true);
  });

  it('never offers Americano or Mexicano', () => {
    vi.stubEnv('EXPO_PUBLIC_TOURNAMENTS', 'off');
    const out = suggest({ level: 'advanced', years: 'three_plus', wants: ['tournaments'], gender: null } as never);
    for (const s of out.filter((x) => x.kind === 'americano' || x.kind === 'mexicano')) {
      expect(s.available).toBe(false);
    }
  });
});
