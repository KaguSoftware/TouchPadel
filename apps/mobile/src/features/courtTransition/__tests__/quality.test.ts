import { describe, expect, it } from 'vitest';
import { courtQualityFor, LITE_ANDROID_MEMORY, LITE_YEAR_CLASS } from '../quality';

const GIB = 1024 ** 3;

describe('court quality tier (shadows + trail only on phones that can afford them)', () => {
  it('iOS: the year class alone decides — A11 and older are lite, newer are full', () => {
    expect(courtQualityFor({ os: 'ios', yearClass: LITE_YEAR_CLASS.ios, totalMemory: 2 * GIB })).toBe('lite');
    expect(courtQualityFor({ os: 'ios', yearClass: 2015, totalMemory: 2 * GIB })).toBe('lite');
    expect(courtQualityFor({ os: 'ios', yearClass: LITE_YEAR_CLASS.ios + 1, totalMemory: 3 * GIB })).toBe('full');
    expect(courtQualityFor({ os: 'ios', yearClass: 2023, totalMemory: 6 * GIB })).toBe('full');
  });

  it('iOS: RAM never demotes (iPhones run the full court on 3 GB)', () => {
    expect(courtQualityFor({ os: 'ios', yearClass: 2019, totalMemory: 3 * GIB })).toBe('full');
  });

  it('iOS: an unknown model is newer than the table, so full', () => {
    expect(courtQualityFor({ os: 'ios', yearClass: null, totalMemory: null })).toBe('full');
  });

  it('Android: old year class OR little RAM is lite', () => {
    expect(courtQualityFor({ os: 'android', yearClass: LITE_YEAR_CLASS.android, totalMemory: 8 * GIB })).toBe('lite');
    expect(courtQualityFor({ os: 'android', yearClass: 2022, totalMemory: LITE_ANDROID_MEMORY - 1 })).toBe('lite');
    expect(courtQualityFor({ os: 'android', yearClass: 2022, totalMemory: LITE_ANDROID_MEMORY })).toBe('full');
    expect(courtQualityFor({ os: 'android', yearClass: LITE_YEAR_CLASS.android + 1, totalMemory: 6 * GIB })).toBe('full');
  });

  it('Android: unknown signals are assumed low-end', () => {
    expect(courtQualityFor({ os: 'android', yearClass: null, totalMemory: 8 * GIB })).toBe('lite');
    expect(courtQualityFor({ os: 'android', yearClass: 2023, totalMemory: null })).toBe('lite');
  });

  it('anything else (web, tests) gets the full court', () => {
    expect(courtQualityFor({ os: 'other', yearClass: null, totalMemory: null })).toBe('full');
  });
});
