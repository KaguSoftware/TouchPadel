import { describe, expect, it } from 'vitest';
import { courtTierFor, DPR_CAP, type TierSignals } from '../tier';

const desktop: TierSignals = { saveData: false, deviceMemory: 8, cores: 8, coarseSmall: false };

describe('court tier', () => {
  it('a capable desktop gets the full court', () => {
    expect(courtTierFor(desktop)).toBe('full');
  });

  it('Save-Data never downloads three.js, whatever the device', () => {
    expect(courtTierFor({ ...desktop, saveData: true })).toBe('flat');
  });

  it('a very weak device gets the flat court', () => {
    expect(courtTierFor({ ...desktop, deviceMemory: 1 })).toBe('flat');
    expect(courtTierFor({ ...desktop, cores: 2 })).toBe('flat');
  });

  it('under 4 GiB, 4 cores or fewer, or a phone gets the lite court', () => {
    expect(courtTierFor({ ...desktop, deviceMemory: 2 })).toBe('lite');
    expect(courtTierFor({ ...desktop, cores: 4 })).toBe('lite');
    expect(courtTierFor({ ...desktop, coarseSmall: true })).toBe('lite');
  });

  it('unknown signals never lower the tier (Safari and Firefox report no deviceMemory)', () => {
    expect(courtTierFor({ ...desktop, deviceMemory: null, cores: null })).toBe('full');
  });

  it('caps the pixel ratio at 2 full / 1.5 lite', () => {
    expect(DPR_CAP).toEqual({ full: 2, lite: 1.5 });
  });
});
