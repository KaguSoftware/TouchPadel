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
 * The route name is the file path minus `app/`, `(tabs)`, `(coaching)`, `(coach-mode)`, `(tournaments)`, `(staff)`, `(matches)` and `.tsx`, with
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
  { file: 'auth-callback.tsx', route: 'auth-callback', primary: 'auth-callback.waiting' },
  { file: 'complete-profile.tsx', route: 'complete-profile', primary: 'complete-profile.submit' },
  // ── tabs ──────────────────────────────────────────────────────────────────
  { file: '(tabs)/_layout.tsx', route: 'tabs', primary: 'tabs.book' },
  { file: '(tabs)/index.tsx', route: 'book', primary: 'book.view-availability' },
  { file: '(tabs)/bookings.tsx', route: 'bookings', primary: 'bookings.filter.upcoming' },
  // Open matches and tournaments together (play-coaches contracts §7), cased by
  // play.smoke.test.tsx: its one action, "Start a match", beside the title.
  { file: '(tabs)/play.tsx', route: 'play', primary: 'play.start' },
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
  // The sign-up play survey (play-coaches contracts §8), cased by playSurvey.smoke.test.tsx.
  { file: 'play-survey.tsx', route: 'play-survey', primary: 'play-survey.skip' },
  { file: 'change-password.tsx', route: 'change-password', primary: 'change-password.submit' },
  { file: 'delete-account.tsx', route: 'delete-account', primary: 'delete-account.confirm' },
  { file: 'accept-terms.tsx', route: 'accept-terms', primary: 'accept-terms.accept' },
  { file: 'terms-review.tsx', route: 'terms-review', primary: 'terms-review.accept' },
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
  {
    file: '(staff)/_layout.tsx',
    route: 'staff-stack',
    primary: 'staff-stack.bar',
    todo: 'an expo-router Stack layout renders only inside a live router, which Node has not got',
  },
  { file: '(staff)/staff-work.tsx', route: 'staff-work', primary: 'staff-work.empty' },
  { file: '(staff)/staff-request.tsx', route: 'staff-request', primary: 'staff-request.list' },
  {
    file: '(staff)/staff-request-new.tsx',
    route: 'staff-request-new',
    primary: 'staff-request-new.submit',
  },
  {
    file: '(staff)/staff-checklist.tsx',
    route: 'staff-checklist',
    primary: 'staff-checklist.done',
  },
  { file: '(staff)/staff-start.tsx', route: 'staff-start', primary: 'staff-start.submit' },
  { file: '(staff)/staff-runs.tsx', route: 'staff-runs', primary: 'staff-runs.filter.waiting' },
  { file: '(staff)/staff-run.tsx', route: 'staff-run', primary: 'staff-run.current-step' },
  { file: '(staff)/staff-step.tsx', route: 'staff-step', primary: 'staff-step.submit' },
  {
    file: '(staff)/staff-production.tsx',
    route: 'staff-production',
    primary: 'staff-production.record',
  },
  { file: '(staff)/staff-shopping.tsx', route: 'staff-shopping', primary: 'staff-shopping.add' },
  { file: '(staff)/staff-purchase.tsx', route: 'staff-purchase', primary: 'staff-purchase.save' },
  // Phase 2 Milestone 4b: the camera pages.
  {
    file: '(staff)/staff-order-slip.tsx',
    route: 'staff-order-slip',
    primary: 'staff-order-slip.send',
  },
  // Place an order (0251): the tables, a table's menu, an item's sheet and the
  // review, cased by staffOrder.smoke.test.tsx.
  { file: '(staff)/staff-order.tsx', route: 'staff-order', primary: 'staff-order.tables' },
  {
    file: '(staff)/staff-order-menu.tsx',
    route: 'staff-order-menu',
    primary: 'staff-order-menu.review',
  },
  {
    file: '(staff)/staff-order-item.tsx',
    route: 'staff-order-item',
    primary: 'staff-order-item.add',
  },
  {
    file: '(staff)/staff-order-review.tsx',
    route: 'staff-order-review',
    primary: 'staff-order-review.send',
  },
  { file: '(staff)/staff-receipt.tsx', route: 'staff-receipt', primary: 'staff-receipt.send' },
  {
    file: '(staff)/staff-marketing.tsx',
    route: 'staff-marketing',
    primary: 'staff-marketing.tab.take',
  },
  { file: '(staff)/staff-notes.tsx', route: 'staff-notes', primary: 'staff-notes.add' },
  // Role spec (plan #61–#74).
  { file: '(staff)/staff-ideas.tsx', route: 'staff-ideas', primary: 'staff-ideas.submit' },
  {
    file: '(staff)/staff-teachings.tsx',
    route: 'staff-teachings',
    primary: 'staff-teachings.list',
  },
  {
    file: '(staff)/staff-suggestions.tsx',
    route: 'staff-suggestions',
    primary: 'staff-suggestions.list',
  },
  {
    file: '(staff)/staff-suggestion-new.tsx',
    route: 'staff-suggestion-new',
    primary: 'staff-suggestion-new.submit',
  },
  { file: '(staff)/staff-stock.tsx', route: 'staff-stock', primary: 'staff-stock.list' },
  { file: '(staff)/staff-recipes.tsx', route: 'staff-recipes', primary: 'staff-recipes.list' },
  {
    file: '(staff)/staff-recipe-change.tsx',
    route: 'staff-recipe-change',
    primary: 'staff-recipe-change.submit',
  },
  {
    file: '(staff)/staff-marketing-requests.tsx',
    route: 'staff-marketing-requests',
    primary: 'staff-marketing-requests.list',
  },
  {
    file: '(staff)/staff-marketing-request-new.tsx',
    route: 'staff-marketing-request-new',
    primary: 'staff-marketing-request-new.submit',
  },
  // Wave 5, lane R (wave5-addendum-2026-09-25 §2.1.8): the waiter's guest
  // calls, cased by staffCalls.smoke.test.tsx.
  { file: '(staff)/staff-calls.tsx', route: 'staff-calls', primary: 'staff-calls.list' },
  // Wave 5, lane S (wave5-addendum-2026-09-25 §5.3): the stores, cased by
  // staffStores.smoke.test.tsx.
  {
    file: '(staff)/staff-stock-log.tsx',
    route: 'staff-stock-log',
    primary: 'staff-stock-log.save',
  },
  {
    file: '(staff)/staff-stock-move.tsx',
    route: 'staff-stock-move',
    primary: 'staff-stock-move.move',
  },
  {
    file: '(staff)/staff-stock-count.tsx',
    route: 'staff-stock-count',
    primary: 'staff-stock-count.submit',
  },
  // Wave 5, lane P (wave5-addendum-2026-09-25 §5.3): the people records,
  // cased by staffPeople.smoke.test.tsx.
  {
    file: '(staff)/staff-deductions.tsx',
    route: 'staff-deductions',
    primary: 'staff-deductions.list',
  },
  {
    file: '(staff)/staff-deduction-propose.tsx',
    route: 'staff-deduction-propose',
    primary: 'staff-deduction-propose.submit',
  },
  {
    file: '(staff)/staff-incidents.tsx',
    route: 'staff-incidents',
    primary: 'staff-incidents.list',
  },
  {
    file: '(staff)/staff-incident-report.tsx',
    route: 'staff-incident-report',
    // The first of the report's steps opens on its way on: the next step.
    primary: 'staff-incident-report.next',
  },
  { file: '(staff)/staff-content.tsx', route: 'staff-content', primary: 'staff-content.submit' },
  // The owner's assistant on the phone, cased by staffAssistant.smoke.test.tsx.
  // The thread's primary is the Send button, an icon with no text of its own,
  // so its case names a `nearbyKey`.
  {
    file: '(staff)/staff-assistant.tsx',
    route: 'staff-assistant',
    primary: 'staff-assistant.composer.send',
  },
  {
    file: '(staff)/staff-assistant-chats.tsx',
    route: 'staff-assistant-chats',
    primary: 'staff-assistant-chats.new',
  },
  // The owner's list of staff screenshots, cased by staffAssistant.smoke.test.tsx.
  {
    file: '(staff)/staff-screenshots.tsx',
    route: 'staff-screenshots',
    primary: 'staff-screenshots.intro',
  },
  // The owner's activity monitor (0341), cased by staffActivity.smoke.test.tsx. The filter is
  // always on screen, whatever the board holds.
  {
    file: '(staff)/staff-activity.tsx',
    route: 'staff-activity',
    primary: 'staff-activity.filter',
  },
  // Rewards for orders placed (0332), cased by staffRewards.smoke.test.tsx: the person's own
  // page (its how-it-counts note is always there) and the owner's page.
  { file: '(staff)/staff-rewards.tsx', route: 'staff-rewards', primary: 'staff-rewards.how' },
  {
    file: '(staff)/staff-rewards-admin.tsx',
    route: 'staff-rewards-admin',
    primary: 'staff-rewards-admin.intro',
  },
  // ── open matches ──────────────────────────────────────────────────────────
  // docs/design/open-matches/guest.md §4.27, cased by matches.smoke.test.tsx
  // in EN and AR. Two spellings are fixed like booking/[id]: `match/[id]` →
  // `match-detail` and `m/[token]` → `match-link`.
  // The list itself is the Play tab now (`(tabs)/play.tsx`, above).
  {
    file: '(matches)/_layout.tsx',
    route: 'matches-stack',
    primary: 'matches-stack.bar',
    todo: 'an expo-router Stack layout renders only inside a live router, which Node has not got',
  },
  { file: '(matches)/match/[id].tsx', route: 'match-detail', primary: 'match-detail.join' },
  { file: '(matches)/match-new.tsx', route: 'match-new', primary: 'match-new.start' },
  { file: 'm/[token].tsx', route: 'match-link', primary: 'match-link.sign-in' },
  { file: '(matches)/match-report.tsx', route: 'match-report', primary: 'match-report.submit' },
  { file: 'blocked-players.tsx', route: 'blocked-players', primary: 'blocked-players.list' },
  // The wallet starts a ticket purchase: cased with the payment screens in
  // deposit.smoke.test.tsx.
  { file: 'tickets.tsx', route: 'tickets', primary: 'tickets.buy' },
  // ── coaching, the guest's side ────────────────────────────────────────────
  // docs/design/coaching/guest.md §4.17, cased by coaching.smoke.test.tsx in
  // EN and AR. Three spellings are fixed like match/[id]: `coach/[id]` →
  // `coach-detail`, `class/[id]` → `class-detail`, `lesson/[id]` →
  // `lesson-detail`. Coach mode's rows follow (coachMode.smoke.test.tsx).
  {
    file: '(coaching)/_layout.tsx',
    route: 'coaching-stack',
    primary: 'coaching-stack.bar',
    todo: 'an expo-router Stack layout renders only inside a live router, which Node has not got',
  },
  // The Coaches tab (play-coaches contracts §6) took over `/coaches`.
  { file: '(tabs)/coaches.tsx', route: 'coaches', primary: 'coaches.list' },
  { file: '(coaching)/coach/[id].tsx', route: 'coach-detail', primary: 'coach-detail.offers' },
  { file: '(coaching)/classes.tsx', route: 'classes', primary: 'classes.list' },
  { file: '(coaching)/class/[id].tsx', route: 'class-detail', primary: 'class-detail.join' },
  { file: '(coaching)/lesson-times.tsx', route: 'lesson-times', primary: 'lesson-times.grid' },
  { file: '(coaching)/lesson-review.tsx', route: 'lesson-review', primary: 'lesson-review.book' },
  { file: '(coaching)/lesson/[id].tsx', route: 'lesson-detail', primary: 'lesson-detail.cancel' },
  { file: '(coaching)/my-lessons.tsx', route: 'my-lessons', primary: 'my-lessons.filter.upcoming' },
  // ── tournaments, the guest's side ─────────────────────────────────────────
  // Tournaments plan §5.2, cased by tournaments.smoke.test.tsx in EN and AR.
  // One spelling is fixed like lesson/[id]: `tournament/[id]` →
  // `tournament-detail`. Join the waitlist shares Register's id: it is the
  // same write, and the server decides which the guest gets.
  {
    file: '(tournaments)/_layout.tsx',
    route: 'tournaments-stack',
    primary: 'tournaments-stack.bar',
    todo: 'an expo-router Stack layout renders only inside a live router, which Node has not got',
  },
  {
    file: '(tournaments)/tournament/[id].tsx',
    route: 'tournament-detail',
    primary: 'tournament-detail.register',
  },
  // ── loyalty ───────────────────────────────────────────────────────────────
  // Loyalty plan §5.1, cased by loyalty.smoke.test.tsx in EN and AR. The
  // member card's primary is the QR itself (a mark, no text of its own); the
  // loyalty screen's is the way to that card.
  { file: 'member-card.tsx', route: 'member-card', primary: 'member-card.qr' },
  { file: 'loyalty.tsx', route: 'loyalty', primary: 'loyalty.show-card' },
  // ── coach mode ────────────────────────────────────────────────────────────
  // docs/design/coaching/guest.md §4.17, cased by coachMode.smoke.test.tsx in
  // EN and AR with the `coach` render option (a signed-in account that
  // coaches). A list primary carries no text of its own, so those cases name
  // a `nearbyKey`.
  {
    file: '(coach-mode)/_layout.tsx',
    route: 'coach-mode-stack',
    primary: 'coach-mode-stack.bar',
    todo: 'an expo-router Stack layout renders only inside a live router, which Node has not got',
  },
  { file: '(coach-mode)/coach-mode.tsx', route: 'coach-mode', primary: 'coach-mode.schedule' },
  {
    file: '(coach-mode)/coach-mode-hours.tsx',
    route: 'coach-mode-hours',
    primary: 'coach-mode-hours.save',
  },
  {
    file: '(coach-mode)/coach-mode-lesson.tsx',
    route: 'coach-mode-lesson',
    primary: 'coach-mode-lesson.roster',
  },
  {
    file: '(coach-mode)/coach-mode-new.tsx',
    route: 'coach-mode-new',
    primary: 'coach-mode-new.create',
  },
  {
    file: '(coach-mode)/coach-mode-book.tsx',
    route: 'coach-mode-book',
    primary: 'coach-mode-book.book',
  },
  {
    file: '(coach-mode)/coach-mode-statements.tsx',
    route: 'coach-mode-statements',
    primary: 'coach-mode-statements.month',
  },
  // ── root ──────────────────────────────────────────────────────────────────
  // No primary action of its own: the root layout is providers and chrome.
  // `app.direction-root` is the node every screen's mirroring is read from, so
  // it is the one thing this file MUST put on screen.
  { file: '_layout.tsx', route: 'app', primary: 'app.direction-root' },
];
