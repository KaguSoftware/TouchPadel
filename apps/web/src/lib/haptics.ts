/**
 * Haptics — the two brand gestures used across the cafe app (web-slice §2):
 * `tap()` for a confirmed touch (add to basket, pill select, qty step) and
 * `buzz()` for a state change worth feeling (waiter call sent, order sent).
 *
 * Everything is best-effort: iOS Safari has no Vibration API, users can switch
 * it off, and `prefers-reduced-motion: reduce` means "no incidental motion" —
 * we honour it here too. Never throws, never awaits.
 */

function canVibrate(): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return false;
  try {
    // Reduced motion also means reduced incidental buzzing.
    if (
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return false;
    }
  } catch {
    /* matchMedia unavailable — carry on */
  }
  return true;
}

function fire(pattern: number | number[]): void {
  if (!canVibrate()) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    /* ignore */
  }
}

/** Short confirmation tick (~10 ms). */
export function tap(): void {
  fire(10);
}

/** Double pulse for a completed request (waiter called, order sent). */
export function buzz(): void {
  fire([14, 45, 14]);
}
