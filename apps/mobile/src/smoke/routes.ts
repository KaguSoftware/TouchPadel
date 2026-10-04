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
 * nine spellings fixed: `(tabs)/index` → `book`, `booking/[id]` →
 * `booking-detail`, `(tabs)/_layout` → `tabs`, `match/[id]` → `match-detail`,
 * `m/[token]` → `match-link`, `coach/[id]` → `coach-detail`, `class/[id]` →
 * `class-detail`, `lesson/[id]` → `lesson-detail`, `tournament/[id]` →
 * `tournament-detail`.
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
  { file: 'booking/[id].tsx', route: 'booking-detail', primary: 'booking-detail.cancel' },
  { file: 'booking-history.tsx', route: 'booking-history', primary: 'booking-history.clear' },
  { file: 'review.tsx', route: 'review', primary: 'review.reserve' },
  { file: 'success.tsx', route: 'success', primary: 'success.done' },
  // ── online deposit (build-contracts-2026-09-27 §4), cased by
  // deposit.smoke.test.tsx. The return link's landing has no action of its
  // own (it hands the ref on in an effect), so its primary is the waiting
  // state it shows; the payment screen's is the "checking" state's own.
  { file: 'pay/return.tsx', route: 'pay-return', primary: 'pay-return.waiting' },
  { file: 'pay/status.tsx', route: 'pay-status', primary: 'pay-status.open-again' },
  { file: '+not-found.tsx', route: 'not-found', primary: 'not-found.bookings' },
  // ── profile ───────────────────────────────────────────────────────────────
  { file: 'settings.tsx', route: 'settings', primary: 'settings.language' },
  { file: 'profile-edit.tsx', route: 'profile-edit', primary: 'profile-edit.name' },
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
  { file: 'staff.tsx', route: 'staff', primary: 'staff.settings' },
  { file: 'staff-group.tsx', route: 'staff-group', primary: 'staff-group.list' },
  { file: 'staff-request.tsx', route: 'staff-request', primary: 'staff-request.submit' },
  { file: 'staff-checklist.tsx', route: 'staff-checklist', primary: 'staff-checklist.done' },
  { file: 'staff-start.tsx', route: 'staff-start', primary: 'staff-start.submit' },
  { file: 'staff-runs.tsx', route: 'staff-runs', primary: 'staff-runs.filter.waiting' },
  { file: 'staff-run.tsx', route: 'staff-run', primary: 'staff-run.current-step' },
  { file: 'staff-step.tsx', route: 'staff-step', primary: 'staff-step.submit' },
  { file: 'staff-production.tsx', route: 'staff-production', primary: 'staff-production.record' },
  { file: 'staff-shopping.tsx', route: 'staff-shopping', primary: 'staff-shopping.add' },
  { file: 'staff-purchase.tsx', route: 'staff-purchase', primary: 'staff-purchase.save' },
  // Phase 2 Milestone 4b: the camera pages.
  { file: 'staff-order-slip.tsx', route: 'staff-order-slip', primary: 'staff-order-slip.send' },
  // Place an order (0251): the tables, a table's menu, an item's sheet and the
  // review, cased by staffOrder.smoke.test.tsx.
  { file: 'staff-order.tsx', route: 'staff-order', primary: 'staff-order.tables' },
  { file: 'staff-order-menu.tsx', route: 'staff-order-menu', primary: 'staff-order-menu.review' },
  { file: 'staff-order-item.tsx', route: 'staff-order-item', primary: 'staff-order-item.add' },
  {
    file: 'staff-order-review.tsx',
    route: 'staff-order-review',
    primary: 'staff-order-review.send',
  },
  { file: 'staff-receipt.tsx', route: 'staff-receipt', primary: 'staff-receipt.send' },
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
  // Wave 5, lane R (wave5-addendum-2026-09-25 §2.1.8): the waiter's guest
  // calls, cased by staffCalls.smoke.test.tsx.
  { file: 'staff-calls.tsx', route: 'staff-calls', primary: 'staff-calls.list' },
  // Wave 5, lane S (wave5-addendum-2026-09-25 §5.3): the stores, cased by
  // staffStores.smoke.test.tsx.
  { file: 'staff-stock-log.tsx', route: 'staff-stock-log', primary: 'staff-stock-log.save' },
  { file: 'staff-stock-move.tsx', route: 'staff-stock-move', primary: 'staff-stock-move.move' },
  {
    file: 'staff-stock-count.tsx',
    route: 'staff-stock-count',
    primary: 'staff-stock-count.submit',
  },
  // Wave 5, lane P (wave5-addendum-2026-09-25 §5.3): the people records,
  // cased by staffPeople.smoke.test.tsx.
  { file: 'staff-deductions.tsx', route: 'staff-deductions', primary: 'staff-deductions.propose' },
  { file: 'staff-incidents.tsx', route: 'staff-incidents', primary: 'staff-incidents.submit' },
  { file: 'staff-content.tsx', route: 'staff-content', primary: 'staff-content.submit' },
  // ── open matches ──────────────────────────────────────────────────────────
  // docs/design/open-matches/guest.md §4.27, cased by matches.smoke.test.tsx
  // in EN and AR. Two spellings are fixed like booking/[id]: `match/[id]` →
  // `match-detail` and `m/[token]` → `match-link`.
  { file: 'matches.tsx', route: 'matches', primary: 'matches.start-one' },
  { file: 'match/[id].tsx', route: 'match-detail', primary: 'match-detail.join' },
  { file: 'match-new.tsx', route: 'match-new', primary: 'match-new.start' },
  { file: 'm/[token].tsx', route: 'match-link', primary: 'match-link.sign-in' },
  { file: 'match-report.tsx', route: 'match-report', primary: 'match-report.submit' },
  { file: 'blocked-players.tsx', route: 'blocked-players', primary: 'blocked-players.list' },
  // The wallet starts a ticket purchase: cased with the payment screens in
  // deposit.smoke.test.tsx.
  { file: 'tickets.tsx', route: 'tickets', primary: 'tickets.buy' },
  // ── coaching, the guest's side ────────────────────────────────────────────
  // docs/design/coaching/guest.md §4.17, cased by coaching.smoke.test.tsx in
  // EN and AR. Three spellings are fixed like match/[id]: `coach/[id]` →
  // `coach-detail`, `class/[id]` → `class-detail`, `lesson/[id]` →
  // `lesson-detail`. Coach mode's rows follow (coachMode.smoke.test.tsx).
  { file: 'coaches.tsx', route: 'coaches', primary: 'coaches.list' },
  { file: 'coach/[id].tsx', route: 'coach-detail', primary: 'coach-detail.offers' },
  { file: 'classes.tsx', route: 'classes', primary: 'classes.list' },
  { file: 'class/[id].tsx', route: 'class-detail', primary: 'class-detail.join' },
  { file: 'lesson-review.tsx', route: 'lesson-review', primary: 'lesson-review.book' },
  { file: 'lesson/[id].tsx', route: 'lesson-detail', primary: 'lesson-detail.cancel' },
  { file: 'my-lessons.tsx', route: 'my-lessons', primary: 'my-lessons.filter.upcoming' },
  // ── tournaments, the guest's side ─────────────────────────────────────────
  // Tournaments plan §5.2, cased by tournaments.smoke.test.tsx in EN and AR.
  // One spelling is fixed like lesson/[id]: `tournament/[id]` →
  // `tournament-detail`. Join the waitlist shares Register's id: it is the
  // same write, and the server decides which the guest gets.
  { file: 'tournaments.tsx', route: 'tournaments', primary: 'tournaments.list' },
  {
    file: 'tournament/[id].tsx',
    route: 'tournament-detail',
    primary: 'tournament-detail.register',
  },
  // ── coach mode ────────────────────────────────────────────────────────────
  // docs/design/coaching/guest.md §4.17, cased by coachMode.smoke.test.tsx in
  // EN and AR with the `coach` render option (a signed-in account that
  // coaches). A list primary carries no text of its own, so those cases name
  // a `nearbyKey`.
  { file: 'coach-mode.tsx', route: 'coach-mode', primary: 'coach-mode.schedule' },
  { file: 'coach-mode-hours.tsx', route: 'coach-mode-hours', primary: 'coach-mode-hours.save' },
  { file: 'coach-mode-lesson.tsx', route: 'coach-mode-lesson', primary: 'coach-mode-lesson.roster' },
  { file: 'coach-mode-new.tsx', route: 'coach-mode-new', primary: 'coach-mode-new.create' },
  { file: 'coach-mode-book.tsx', route: 'coach-mode-book', primary: 'coach-mode-book.book' },
  {
    file: 'coach-mode-statements.tsx',
    route: 'coach-mode-statements',
    primary: 'coach-mode-statements.month',
  },
  // ── root ──────────────────────────────────────────────────────────────────
  // No primary action of its own: the root layout is providers and chrome.
  // `app.direction-root` is the node every screen's mirroring is read from, so
  // it is the one thing this file MUST put on screen.
  { file: '_layout.tsx', route: 'app', primary: 'app.direction-root' },
];
