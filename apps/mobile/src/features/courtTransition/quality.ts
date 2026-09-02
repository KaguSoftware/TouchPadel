/**
 * Which court a phone gets. The scene (scene.ts) costs most in two places —
 * the shadow pass (a 1024² map re-rendered every frame with every racket part
 * as a caster) and the 36-sphere ball trail — so a low-end phone gets the
 * SAME court without those two: the ball keeps its ground disc, which reads
 * as its shadow from the top-down camera anyway.
 *
 * The tier is decided once, from expo-device's year class (Facebook's
 * device-year heuristic: RAM, cores, clock on Android; the model on iOS) and
 * the RAM figure. iOS phones do far more per gigabyte than Android ones, so
 * the platforms have their own lines. An Android phone that reports nothing
 * is assumed low-end; an iPhone that reports nothing is a model newer than
 * expo-device's table, so it is assumed fine. Pure: unit-tested; the
 * expo-device reads live in deviceQuality.ts.
 */
export type CourtQuality = 'full' | 'lite';

export type CourtOS = 'ios' | 'android' | 'other';

export interface DeviceSignals {
  os: CourtOS;
  /** expo-device `deviceYearClass`; null when unknown. */
  yearClass: number | null;
  /** expo-device `totalMemory` in bytes; null when unknown. */
  totalMemory: number | null;
}

const GIB = 1024 ** 3;

/** Newest year class that still gets the lite court, per platform. */
export const LITE_YEAR_CLASS = {
  /** iPhone 8 / X (A11) and older. */
  ios: 2017,
  /** Snapdragon 8xx-of-2018 flagships and everything budget since. */
  android: 2018,
} as const;

/** Android below this much RAM is lite regardless of year class. */
export const LITE_ANDROID_MEMORY = 4 * GIB;

export function courtQualityFor({ os, yearClass, totalMemory }: DeviceSignals): CourtQuality {
  if (os === 'ios') {
    return yearClass !== null && yearClass <= LITE_YEAR_CLASS.ios ? 'lite' : 'full';
  }
  if (os === 'android') {
    if (yearClass === null || totalMemory === null) return 'lite';
    return yearClass <= LITE_YEAR_CLASS.android || totalMemory < LITE_ANDROID_MEMORY
      ? 'lite'
      : 'full';
  }
  return 'full';
}
