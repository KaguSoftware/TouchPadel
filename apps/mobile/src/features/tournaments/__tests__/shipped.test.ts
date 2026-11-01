import { describe, expect, it } from 'vitest';
import { playTabShown } from '../shipped';
import { anyTournaments } from '../logic';
import { suggest } from '../../playProfile/suggest';

/**
 * Tournaments follow the BRANCH settings, not the build (Majed, 2026-11-01, F-71):
 * EXPO_PUBLIC_TOURNAMENTS is gone, and the Play tab is in the bar while some branch has
 * tournaments or open matches on.
 */
describe('playTabShown', () => {
  it('keeps Play while the branch list is unknown (loading or unread)', () => {
    expect(playTabShown(undefined)).toBe(true);
    expect(playTabShown(null)).toBe(true);
  });

  it('shows Play when some branch has tournaments or open matches on', () => {
    expect(playTabShown([{ tournaments_enabled: true, matches_enabled: false }])).toBe(true);
    expect(playTabShown([{ tournaments_enabled: false, matches_enabled: true }])).toBe(true);
    expect(playTabShown([{ tournaments_enabled: false }, { tournaments_enabled: true }])).toBe(true);
  });

  it('takes Play out of the bar when no branch has either on', () => {
    expect(playTabShown([])).toBe(false);
    expect(playTabShown([{ tournaments_enabled: false, matches_enabled: false }])).toBe(false);
  });
});

describe('the branch decides', () => {
  it('reads tournaments from the branches alone', () => {
    expect(anyTournaments([{ tournaments_enabled: true }])).toBe(true);
    expect(anyTournaments([{ tournaments_enabled: false }])).toBe(false);
  });

  it('offers Americano and Mexicano when the branches offer them, and not when they do not', () => {
    const profile = { level: 'advanced', years: 'three_plus', wants: ['tournaments'], gender: null } as never;
    for (const s of suggest(profile).filter((x) => x.kind === 'americano' || x.kind === 'mexicano')) {
      expect(s.available).toBe(true);
    }
    const off = suggest(profile, { americano: false, mexicano: false } as never);
    for (const s of off.filter((x) => x.kind === 'americano' || x.kind === 'mexicano')) {
      expect(s.available).toBe(false);
    }
  });
});
