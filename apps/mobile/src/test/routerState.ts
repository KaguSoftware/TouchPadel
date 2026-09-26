/**
 * The router's answers for one smoke case, in a mutable holder.
 *
 * WHY A HOLDER AND NOT A PER-TEST `jest.mock`. `expo-router` is mocked ONCE,
 * in jest.setup.ts, because half the app reads it at module scope
 * (`import { router } from 'expo-router'` in app/_layout.tsx, `Redirect` in
 * every gate) and a mock declared inside a test file lands too late for those.
 * A single mock that reads its answers from here lets each case say what
 * `useLocalSearchParams()` should return — `booking/[id]` needs an `id`,
 * `verify-otp` needs a `phone` — without re-mocking the module.
 *
 * `renderRoute` (src/test/smoke.tsx) resets it for every render, so one case
 * cannot leave a param behind for the next.
 *
 * TEST-ONLY. Nothing in `app/` or `src/features/` imports this file; it is
 * plain data with no react-native import, so the coverage test can read it too.
 */
export interface RouterState {
  /** What `useLocalSearchParams()` returns. */
  params: Record<string, string>;
  /** What `usePathname()` returns. */
  pathname: string;
  /** What `useSegments()` returns. */
  segments: string[];
  /** Every `push` / `replace` / `navigate` / `back` the render performed. */
  calls: { method: string; arg?: unknown }[];
}

export const routerState: RouterState = {
  params: {},
  pathname: '/',
  segments: [],
  calls: [],
};

export function resetRouterState(params: Record<string, string> = {}, pathname = '/'): void {
  routerState.params = params;
  routerState.pathname = pathname;
  routerState.segments = pathname.split('/').filter(Boolean);
  routerState.calls = [];
}
