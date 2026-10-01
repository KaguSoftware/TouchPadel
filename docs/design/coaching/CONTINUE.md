# Coaching: where the build stands, and how to continue it

Phase 2 milestone 5 (change-order item 2). Planned and approved by Parsa on 2026-10-01. The plan is
`~/.claude/plans/which-features-are-left-eventual-wigderson.md`; the binding names are
`build-contracts-2026-10-01.md` §1.

## Where things stand

| Piece | State |
| --- | --- |
| Decisions | Settled with Parsa over six rounds, approved 2026-10-01: C-1…C-20 and defaults CD-1…CD-12 in §0 of `build-contracts-2026-10-01.md`; C-21…C-31 (§0.2b) answered the reviews' questions the same day. |
| Binding names | §1 of `build-contracts-2026-10-01.md`: migrations 0270–0286, tables, statuses, locks, RPCs, push, error codes, client names. |
| Lane contracts | **Written 2026-10-01**: `db.md`, `money.md`, `guest.md`, `operator.md` (about 7,100 lines). Their additions and contradictions were merged as rulings R1–R23 in §1.12; §1 was patched to match. The lane files themselves still need the consistency pass. |
| Adversarial review | **Done 2026-10-01**: `drafts/review-concurrency-money-2026-10-01.md` (1 blocker, 9 majors) and `drafts/review-rules-privacy-2026-10-01.md` (4 blockers). Parsa answered their ten questions (C-21…C-31, §0.2b). Their fixes are rulings R24–R63 in §1.13. |
| Consistency pass | **Done 2026-10-01**: each lane file aligned with §1.12–§1.13 and C-21…C-31; what the passes left open is settled by the closing rulings R64–R80 (§1.14). **Step 1 is complete.** Authority order for a builder: §0 decisions → §1.14 → §1.13 → §1.12 → §1.1–§1.11 → the lane file. |
| Coverage | `assistant-coverage.json` has an `excluded` entry for every file under `docs/design/coaching/` (R53); `check:assistant-coverage` passes. |
| Shared code | **Committed `a3d221f7`**: `packages/core/src/coaching/` (statement maths, grid, `COACHING_SHAPES`) and `coachingGlossary`. |
| Database (step 2) | **0277–0286 green on the local stack 2026-10-01; not committed.** The six drafts (`packages/db/.coaching-staging/`, untracked) are placed in `supabase/migrations` (0280 = 0280a + 0280b, one header), with `functions/lesson-begin`, D's patches to `_shared/deposits.ts`, `deposit-reconcile`, `verify-jwt.json`, `config.toml`, and the 15 suites in `tests/` (A's and F's plants merged in `tests/coaching-plant.ts` as `PLANT_BRANCH` and `PLANT`). R82 applied in 0282 (`max_places` in the shape for private types only; pinned in `coaching-price-protocol.test.ts`). Fixes on landing: `coach_slots` answers the coach about themselves before acceptance and with coaching off (no horizon, no offline cut), NULL-safe; `lesson_check_start` / `lesson_coach_free` raise with an empty detail instead of a NULL one. Folded: `ERROR_CODE_KEYS` + `opErrors.coaching.{en,ar}` (34 codes, operator.md §5.19 wording), widened `BRANCH_HAS_BOOKINGS`, `PRICE_VIA_PROTOCOL`, `LAUNCH_VIA_PROTOCOL`, `PRICE_TARGET_CHANGED`; `rls-matrix.ts` drop 25 (+63 rows, `GUEST_OR_COACH`, `DESK_UP`), allowlist (5 public by design, 58 guarded), floor 456/458; assistant coverage (statement RPCs and `report_lessons` `excluded`, and the map builder now gives an `excluded` function no action chunk, C-28), map regenerated; `PIN_GATED_RPCS` ×3 (+ `lesson_blocked_refund_record`, `coach_statement_mark_paid`, `coach_statement_void`); `shapes.ts` (R81 additions); the SEC-20 deletion proof (coach, confirmed and pending links); lock-order pins (0278, 0279–0280, 0281, 0284); `till-shifts` (C-31), `reports`, `matches-reports`, `analytics-courts` key and identity pins; `matches-account-deletion` comment pin. Gates: clean `db reset` + fixtures, `db:types` stable, `check:migrations` (with the waivers), `check:rpc-registry`, `check:locks`, `check:authz`, `check:safeupdate`, `check:invariants`, `check:broadcast`, `check:analytics`, `check:assistant-coverage`, `check:error-codes`, `check:config-env`, `check:verify-jwt`, assistant map `--check`, `deno check` (25 functions), root `pnpm security`; `@touch/db` typecheck + lint; `@touch/core` and `@touch/i18n` typecheck + tests. Full db suite with `TP_REQUIRE_STACK=1` and functions served: 185 files, 3055 passed, 8 skipped (7 `phone-otp` without the local test-OTP variable, 1 allowlisted). Commit waivers: the 0276 index line and `MIGRATION-RISK-ACCEPTED: 0278 day_sessions cash/card expected iqd -> iqd_signed (same bigint base, no rewrite) so a cross-day refund (C-31) cannot fail close_day`. Left: `packages/db/CLAUDE.md` stale lines (paperwork commit). |
| 2a (`reservation_kind_lesson` … `coaching_indexes`; ordinals 0270–0276 on 2026-10-01, named by file so they can shift) | **Green on the local stack 2026-10-01; not committed.** Migrations `reservation_kind_lesson` (enum `lesson`, alone), `outbox_lesson_kinds` (16 kinds), `booking_payments_lesson_checks` (purpose `lesson`; `coach_cancel`, `under_filled`), `tabs_kind_lesson`, `coaching_settings` (five `venue_settings` columns incl. `coach_max_open_private` R56; `platform_settings.lesson_terms_version` R50; `venue_settings_public` + three columns; `coaching_rules`, `lesson_terms_ok`; `coaching_settings` / `set_coaching_settings` with `ONLINE_PAYMENT_OFF` `terms` R50/R67, the read also answering `lesson_terms_ready`), `coaching_tables` (the 16 tables of §1.2 as amended: `public_accepted_at`, `cutoff_checked_at`, `rescheduled_at`, `link_confirmed_at`, `refunded_outside_iqd` R75, `lapsed_hold`, statement lines per R24, `coach_photo_purges`; `reservations.lesson_id` + `reservations_lesson_link/_kind/_row` + the R1 hold rule; Money's `tabs` / `booking_payments` columns, `tabs_lesson_shape`, anchor and `reason_by_purpose`; guards on the 13 branch tables and re-created on the three changed ones; sanitisers, `lesson_events` append-only, `coach_statement_lines_frozen`; RLS on, no client grant; `menu-media/coaches/`; `lock_coach` / `try_lock_coach` R6), `coaching_indexes` (every §4.4 index; the six hot-table partials in the same file). `send-push` lesson family: `_shared/guest-push.json` (6 kinds, 41 keys, 5 routes, 6 params), `guestStrings.ts` (18 keys EN + DRAFT-AR, four titles, `{places}`, `{month}`, `guestMonth`), `index.ts` (lesson and statement reads only for coaching rows; `LESSON_GONE`, `STATEMENT_GONE`, `REMINDER_STALE`). Phone: `pushRoutes.ts` lists + `LESSON_PUSH_KINDS`; coaching taps open nothing until G4/G5; a lesson push never refreshes `['match']`. `types.gen.ts`. Gates: lock walker (`coach_advisory`, once per sequence, the R64 skip-locked rule, `SERVICE_WALK` + 4 names), `rls-matrix.ts` drop 25 (34 rows), allowlist + floor 393/395, assistant coverage (16 tables, 13 functions) + map regenerated, SEC-20 (`LINK_COLUMNS` + 4, the `empty` route, `Financial info`, seven tables in `GUEST_DATA`, `COACH_DATA`), SEC-28/29 (`friend_names`, `student`, `share_bp`; the coach patterns; `PERSON_MONEY_REPORTS`), `assistant-catalog.test.ts`, error codes `ONLINE_PAYMENT_OFF`, `STATEMENT_NOT_DRAFT` (`opErrors.coaching.{en,ar}.ts`, DRAFT-AR), web `menu.test.ts` fixture, `docs/design/multi-venue/slice-1-2026-09-21.md` lists. Tests: new `coaching-schema`, `lock-order-coaching`; `outbox-kinds`, `guest-push` (match subset, R18), `send-push-guest`, `lock-order-matches`, `stored-fields`, mobile `pushRoutes`. Commit waiver line: `MIGRATION-RISK-ACCEPTED: new and empty tables, plus partial indexes on reservations, tabs and booking_payments whose predicates match no row today`. Left for later: the deletion proof of the SEC-20 `empty` routes (with `lesson_account_deletion`); `packages/db/CLAUDE.md`'s latest-ordinal, push-kind and error-mapping lines (R23; not edited by an agent). |
| Apps (step 3) | **Building in parallel**, each in its own git worktree branch with a marked provisional block in `types.gen.ts` (replaced by the regenerated file at integration): phone guest side, phone coach mode, operator (+ staff-phone protocol forms and the core protocol twin), web. |
| Integration (step 4) | Not started. |
| Hosted | Nothing. Coaching ships off on every branch (`coaching_enabled = false`). |

## How to run it

### Step 1. Finish the design

1. The four lane contracts, each against §1. New names go under "Additions to §1"; the merge folds
   them back into §1.
2. An adversarial review in two parts:
   - concurrency and money: lock order, the lesson guards, double counting, refunds;
   - rules, privacy and decisions.
   Their fixes become rulings R1… in a new §1.12 of the contracts.
3. A consistency pass over the four lane files against §1 and the rulings.

### Step 2. Database, in order (each sub-step: migrations, tests, gates green on the local stack)

0270 → 0271 → 0272 → 0273 → 0274 → 0275 → 0276 → 0277 → 0278 → 0279 → 0280 → 0281 → 0282 → 0283
→ 0284 → 0285 → 0286. Regenerate `types.gen.ts` after 0275 and after every migration that changes a
signature. The widenings (0270–0273) are each alone, ahead of anything that uses them.

### Step 3. The apps (after `types.gen.ts`; lanes can run side by side)

- Core: `packages/core/src/coaching/`, the `mutations.ts` kind enum, `slotGrid.ts`.
- Mobile guest and coach mode (`guest.md`).
- Web `/coaching` and `/c/[id]` (`guest.md`).
- Operator (`operator.md`).
- Edge: `lesson-begin`, the `send-push` guest strings.

### Step 4. Put it together

A fresh `db:reset` + `node scripts/db-fixtures.mjs`; every db gate; the full db suite with
`TP_REQUIRE_STACK=1`; root `pnpm typecheck`, `lint`, `test`, `security`;
`pnpm --filter @touch/mobile test:smoke`; `pnpm e2e` (EN + AR) with the coaching spec;
`pnpm db:types` with no diff; `pnpm --filter @touch/db assistant:map`.

### Step 5. Paperwork, commit, push

`PHASE-2-CHECKLIST.md`, `PHASE-2-PLAN.md` (status block), `HANDOFF.md` (a Day entry, the scope
ledger rows, the file map), the change order (EN + AR), `packages/db/CLAUDE.md` (the latest-ordinal
line). Commits authored by Parsa, no co-author trailer. Push per the root `CLAUDE.md` "Pushing".

## Owner and client steps (never run by an agent)

- **Client:**
  - the coach list;
  - lesson types and prices;
  - written confirmation of the 60 % coach share;
  - the tax group for lessons;
  - Mustafa's OK to show lesson prices on the website (C-11);
  - review of every DRAFT-AR string.
- **Parsa:**
  - the operator tag;
  - the production `eas build` (coach mode, guest coaching, the `/c/` links);
  - Qi secrets, if lessons are to be paid online;
  - `coaching_enabled` at one branch for the TestFlight trial.
