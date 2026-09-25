/**
 * Every route in `app/`, with the testID of the action that screen exists for.
 *
 * TWO READERS, ON PURPOSE:
 *  • the smoke suites (`*.smoke.test.tsx`) name a route and get its primary id
 *    (and its `todo`) from here through `src/test/smokeCase.tsx`, so an id is
 *    written down once;
 *  • `src/navigation/__tests__/smokeCoverage.test.ts` walks `app/**​/*.tsx`
 *    against this table AND reads every suite's source for `route: '<name>'`,
 *    so a new screen cannot ship without an entry here and a case in exactly
 *    one suite (or a deliberate `todo` beside the entry, which the runner
 *    skips by name).
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
  { file: 'accept-terms.tsx', route: 'accept-terms', primary: 'accept-terms.accept' },
  // ── staff ─────────────────────────────────────────────────────────────────
  // build-contracts-2026-09-23 §6.2. Each page lane adds its rows with its
  // screens. The suites that case them, in EN and AR, as a staff session:
  // staff.smoke.test.tsx (Today, requests), staffProtocols.smoke.test.tsx
  // (start, runs, run, step, ideas, notes), staffDaily.smoke.test.tsx
  // (checklist, production, stock, teachings, suggestions, recipes, recipe
  // change) and staffSuppliesMarketing.smoke.test.tsx (shopping, purchase,
  // marketing, requests to marketing).
  { file: 'staff.tsx', route: 'staff', primary: 'staff.requests' },
  { file: 'staff-request.tsx', route: 'staff-request', primary: 'staff-request.submit' },
  { file: 'staff-checklist.tsx', route: 'staff-checklist', primary: 'staff-checklist.done' },
  { file: 'staff-start.tsx', route: 'staff-start', primary: 'staff-start.submit' },
  { file: 'staff-runs.tsx', route: 'staff-runs', primary: 'staff-runs.filter.waiting' },
  { file: 'staff-run.tsx', route: 'staff-run', primary: 'staff-run.current-step' },
  { file: 'staff-step.tsx', route: 'staff-step', primary: 'staff-step.submit' },
  { file: 'staff-production.tsx', route: 'staff-production', primary: 'staff-production.record' },
  { file: 'staff-shopping.tsx', route: 'staff-shopping', primary: 'staff-shopping.add' },
  { file: 'staff-purchase.tsx', route: 'staff-purchase', primary: 'staff-purchase.save' },
  { file: 'staff-marketing.tsx', route: 'staff-marketing', primary: 'staff-marketing.tab.take' },
  { file: 'staff-notes.tsx', route: 'staff-notes', primary: 'staff-notes.add' },
  // Role spec (plan #61–#74).
  { file: 'staff-ideas.tsx', route: 'staff-ideas', primary: 'staff-ideas.submit' },
  { file: 'staff-teachings.tsx', route: 'staff-teachings', primary: 'staff-teachings.list' },
  {
    file: 'staff-suggestions.tsx',
    route: 'staff-suggestions',
    primary: 'staff-suggestions.submit',
  },
  { file: 'staff-stock.tsx', route: 'staff-stock', primary: 'staff-stock.list' },
  { file: 'staff-recipes.tsx', route: 'staff-recipes', primary: 'staff-recipes.list' },
  {
    file: 'staff-recipe-change.tsx',
    route: 'staff-recipe-change',
    primary: 'staff-recipe-change.submit',
  },
  {
    file: 'staff-marketing-requests.tsx',
    route: 'staff-marketing-requests',
    primary: 'staff-marketing-requests.submit',
  },
  // ── root ──────────────────────────────────────────────────────────────────
  // No primary action of its own: the root layout is providers and chrome.
  // `app.direction-root` is the node every screen's mirroring is read from, so
  // it is the one thing this file MUST put on screen.
  { file: '_layout.tsx', route: 'app', primary: 'app.direction-root' },
];
