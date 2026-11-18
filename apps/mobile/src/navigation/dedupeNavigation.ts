import { router } from 'expo-router';

/**
 * A second tap on the same button, a few hundred ms after the first, used to open the page twice
 * (most visible on Android, where the first transition has not finished). Every screen calls the
 * shared `router`, so one guard here covers them all: the same navigation call with the same target
 * inside the window is dropped. A different target, or the same one after the window, goes through.
 */
export const NAV_DEDUPE_MS = 700;
export const BACK_DEDUPE_MS = 400;

type Call = (...args: unknown[]) => unknown;

let disabled = false;

/**
 * Test-only: the smoke renders press the same button in EN and then AR, or twice in one case, far
 * inside the window, and assert each navigation. `jest.setup.ts` turns the guard off; the guard
 * itself is pinned by `__tests__/dedupeNavigation.test.ts`.
 */
export function disableNavigationDedupe(): void {
  disabled = true;
}

export function createDedupe(now: () => number = Date.now) {
  let lastKey = '';
  let lastAt = -Infinity;
  const allow = (key: string, windowMs: number): boolean => {
    if (disabled) return true;
    const t = now();
    if (key === lastKey && t - lastAt < windowMs) return false;
    lastKey = key;
    lastAt = t;
    return true;
  };
  return allow;
}

/** One window shared by `router` and every `useRouter()`, so the two paths dedupe each other. */
export const sharedAllow = createDedupe();

function keyOf(method: string, args: unknown[]): string {
  try {
    return `${method}:${JSON.stringify(args[0])}`;
  } catch {
    return `${method}:?`;
  }
}

let installed = false;

export function installNavigationDedupe(): void {
  if (installed) return;
  installed = true;
  const allow = sharedAllow;
  const target = router as unknown as Record<string, Call>;
  for (const method of ['push', 'navigate', 'replace'] as const) {
    const original = target[method]?.bind(router);
    if (!original) continue;
    target[method] = (...args) =>
      allow(keyOf(method, args), NAV_DEDUPE_MS) ? original(...args) : undefined;
  }
  const back = target.back?.bind(router);
  if (back) {
    target.back = (...args) => (allow('back', BACK_DEDUPE_MS) ? back(...args) : undefined);
  }
}

/**
 * Wraps a router object (the `useRouter()` one is a separate object from the exported `router`, so
 * patching `router` alone misses every screen that uses the hook).
 */
export function guardRouter<T extends object>(base: T, allow: (key: string, windowMs: number) => boolean): T {
  const source = base as unknown as Record<string, Call>;
  const wrapped: Record<string, Call> = { ...source };
  for (const method of ['push', 'navigate', 'replace'] as const) {
    const original = source[method];
    if (!original) continue;
    wrapped[method] = (...args) => (allow(keyOf(method, args), NAV_DEDUPE_MS) ? original(...args) : undefined);
  }
  const back = source.back;
  if (back) wrapped.back = (...args) => (allow('back', BACK_DEDUPE_MS) ? back(...args) : undefined);
  return wrapped as unknown as T;
}
