/**
 * Which court a browser gets, decided once before anything is downloaded.
 *
 *  - `flat`: the animated SVG court (CourtIllustration), and three.js is never
 *    fetched. For Save-Data (the visitor asked us not to spend their bundle on
 *    a 140 KB decoration) and for devices too weak to hold a frame rate.
 *  - `lite`: the same 3D court with no shadow pass and a plainer racket
 *    (scene.ts / racket.ts `lite`), DPR capped at 1.5.
 *  - `full`: shadows on, DPR capped at 2.
 *
 * The web has no device-year class (the phone's quality.ts line), so it reads
 * what browsers expose: `navigator.connection.saveData`, `deviceMemory`
 * (Chromium only, rounded GiB), `hardwareConcurrency`, and whether the main
 * pointer is coarse on a small screen (a phone). Missing signals are not
 * evidence of anything, so an unknown value never lowers the tier.
 *
 * Pure: the browser reads live in readTierSignals(), unit-tested below.
 */
export type CourtTier = 'flat' | 'lite' | 'full';

export interface TierSignals {
  saveData: boolean;
  /** GiB, Chromium's rounded figure; null when the browser does not say. */
  deviceMemory: number | null;
  /** Logical cores; null when the browser does not say. */
  cores: number | null;
  /** `(pointer: coarse)` and the short side under 768 CSS px. */
  coarseSmall: boolean;
}

/** At or below these the device cannot hold the rally smoothly: flat court. */
export const FLAT_BELOW = { memory: 2, cores: 2 } as const;
/** Below 4 GiB or at 4 cores or fewer: the lite court. */
export const LITE_BELOW = { memory: 4, cores: 4 } as const;

export function courtTierFor(s: TierSignals): CourtTier {
  if (s.saveData) return 'flat';
  if (s.deviceMemory !== null && s.deviceMemory < FLAT_BELOW.memory) return 'flat';
  if (s.cores !== null && s.cores <= FLAT_BELOW.cores) return 'flat';
  if (s.deviceMemory !== null && s.deviceMemory < LITE_BELOW.memory) return 'lite';
  if (s.cores !== null && s.cores <= LITE_BELOW.cores) return 'lite';
  if (s.coarseSmall) return 'lite';
  return 'full';
}

/** Device-pixel-ratio cap per tier. */
export const DPR_CAP = { full: 2, lite: 1.5 } as const;

interface NavigatorSignals {
  connection?: { saveData?: boolean };
  deviceMemory?: number;
  hardwareConcurrency?: number;
}

/** The browser's side of courtTierFor. Every read is guarded: none is universal. */
export function readTierSignals(): TierSignals {
  const nav = (typeof navigator === 'undefined' ? {} : navigator) as NavigatorSignals;
  let coarseSmall = false;
  try {
    const short = Math.min(window.screen.width, window.screen.height);
    coarseSmall = window.matchMedia('(pointer: coarse)').matches && short < 768;
  } catch {
    coarseSmall = false;
  }
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
  return {
    saveData: nav.connection?.saveData === true,
    deviceMemory: num(nav.deviceMemory),
    cores: num(nav.hardwareConcurrency),
    coarseSmall,
  };
}

/** Whether this browser can draw WebGL at all. Throwaway canvas; never throws. */
export function canDrawWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') ?? c.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return false;
    // Hand the probe's context straight back: browsers cap live contexts (~16).
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}
