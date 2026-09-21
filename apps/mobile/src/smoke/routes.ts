/**
 * Every route in `app/`, with the testID of the action that screen exists for.
 *
 * TWO READERS, ON PURPOSE:
 *  • the smoke suites (`*.smoke.test.tsx`) drive their `it.each` from it, so a
 *    route's primary id is written down once;
 *  • `src/navigation/__tests__/smokeCoverage.test.ts` walks `app/**​/*.tsx` and
 *    fails when a file is missing from here — a new screen therefore cannot
 *    ship without either a smoke case or a deliberate `todo` beside it.
 *
 * PLAIN DATA, NO REACT. The coverage test runs under vitest in plain node,
 * where importing react-native throws, so this file holds strings and nothing
 * else. The suites import the components themselves.
 *
 * The route name is the file path minus `app/`, `(tabs)`, and `.tsx`, with
 * three spellings fixed: `(tabs)/index` → `book`, `booking/[id]` →
 * `booking-detail`, `(tabs)/_layout` → `tabs`.
 */
export interface SmokeRoute {
  /** Path under `app/`, '/'-separated — what the coverage test matches on. */
  file: string;
  /** The route segment ids are built from (`sign-in`, `book`, `tabs`). */
  route: string;
  /** The always-mounted action the suite asserts on. */
  primary: string;
  /**
   * Set when the screen cannot yet be rendered in Node and the exact reason.
   * A `todo` route stays in this table — it is still a route, and deleting it
   * would take the coverage check's teeth out with it.
   */
  todo?: string;
}

export const SMOKE_ROUTES: readonly SmokeRoute[] = [
  // ── auth ──────────────────────────────────────────────────────────────────
  { file: 'welcome.tsx', route: 'welcome', primary: 'welcome.sign-in' },
  { file: 'sign-in.tsx', route: 'sign-in', primary: 'sign-in.submit' },
  { file: 'sign-up.tsx', route: 'sign-up', primary: 'sign-up.submit' },
  { file: 'forgot-password.tsx', route: 'forgot-password', primary: 'forgot-password.submit' },
  { file: 'reset-password.tsx', route: 'reset-password', primary: 'reset-password.save' },
  { file: 'verify-email.tsx', route: 'verify-email', primary: 'verify-email.resend' },
  { file: 'verify-otp.tsx', route: 'verify-otp', primary: 'verify-otp.continue' },
  { file: 'verify-result.tsx', route: 'verify-result', primary: 'verify-result.continue' },
  { file: 'phone-sign-in.tsx', route: 'phone-sign-in', primary: 'phone-sign-in.send-code' },
  { file: 'complete-profile.tsx', route: 'complete-profile', primary: 'complete-profile.submit' },
  // ── tabs ──────────────────────────────────────────────────────────────────
  { file: '(tabs)/_layout.tsx', route: 'tabs', primary: 'tabs.book' },
  { file: '(tabs)/index.tsx', route: 'book', primary: 'book.view-availability' },
  { file: '(tabs)/bookings.tsx', route: 'bookings', primary: 'bookings.filter.upcoming' },
  { file: '(tabs)/profile.tsx', route: 'profile', primary: 'profile.settings' },
  // ── booking ───────────────────────────────────────────────────────────────
  { file: 'availability.tsx', route: 'availability', primary: 'availability.duration' },
  { file: 'booking/[id].tsx', route: 'booking-detail', primary: 'booking-detail.cancel' },
  { file: 'booking-history.tsx', route: 'booking-history', primary: 'booking-history.clear' },
  { file: 'review.tsx', route: 'review', primary: 'review.reserve' },
  { file: 'success.tsx', route: 'success', primary: 'success.done' },
  // ── profile ───────────────────────────────────────────────────────────────
  { file: 'settings.tsx', route: 'settings', primary: 'settings.language' },
  { file: 'profile-edit.tsx', route: 'profile-edit', primary: 'profile-edit.save' },
  { file: 'change-password.tsx', route: 'change-password', primary: 'change-password.submit' },
  { file: 'delete-account.tsx', route: 'delete-account', primary: 'delete-account.confirm' },
  // ── root ──────────────────────────────────────────────────────────────────
  // No primary action of its own: the root layout is providers and chrome.
  // `app.direction-root` is the node every screen's mirroring is read from, so
  // it is the one thing this file MUST put on screen.
  { file: '_layout.tsx', route: 'app', primary: 'app.direction-root' },
];

/** Lookup by route name, for a suite that wants one entry by hand. */
export function smokeRoute(route: string): SmokeRoute {
  const found = SMOKE_ROUTES.find((r) => r.route === route);
  if (!found) throw new Error(`No smoke route named ${route}`);
  return found;
}
