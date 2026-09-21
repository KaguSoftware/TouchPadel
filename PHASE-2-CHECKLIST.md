# Phase 2 — checklist

Updated 2026-09-21 (commits `1daa960`, `2b9adf7`, `8616549` on `main`). The decision record and
per-milestone design are `PHASE-2-PLAN.md` (repo) and Parsa's plan file
(`~/.claude/plans/i-got-this-scope-binary-piglet.md`); this file is the short list of what is
done and what is left. Update it in the same commit as the work it describes.

| Measure | Now |
| --- | --- |
| Milestone 0 (criticals before any Phase 2 table) | about 75 %; about 95 % code-side once item 11, S10 and the docs land |
| The nine client-visible Phase 2 items | 0 of 9 |
| Whole programme by effort (≈ 40 agent-weeks) | about 10 % |

## Milestone 0 — done

- [x] Replay transport: retryable vs terminal errors, PIN redaction, `app.log_replay` dropped, duplicate-of-conflict treated as a conflict (0114).
- [x] Manager-PIN grants on the five money RPCs; weak PINs refused (0115). Stray overloads of `apply_discount` / `override_price` removed (0119) and a static gate fails the build on any accidental overload (`check:rpc-registry`, `fixtures/rpc-overloads.json`).
- [x] Profile CHECKs on name, phone and push token (0116); the service-role grant they needed (0121).
- [x] Quote equals charge: a hold stamps its price, `confirm_booking` raises `PRICE_CHANGED`, mobile maps it (0117).
- [x] Retire a device, editable offline thresholds, Devices panel in Settings (0118).
- [x] Queued money corrections: refund, void, tab removal, zero close and waste on the durable queue with idempotency keys; `merge_tabs`, `record_drawer_open`, `open_day`, `close_day` stay online-only by decision (0120, HANDOFF scope ledger).
- [x] Release gate: `environment: release` on publish, `permissions: contents: read` on every workflow, CLI pinned, ledger dump limited to the public ledgers (code half).
- [x] Mobile: deep-link token branch removed, reset form only after an in-session recovery, email sign-up / sign-in / verify / reset restored beside phone.
- [x] Web: CSP matcher, `requireLocale()`, `/t/[token]` as a route handler.
- [x] Gates: ordinal rules in `check-migrations`, one RPC allowlist, `QK` registry, grant and signature replay in the registry gate, digit boundaries in the phone-number gate, assistant coverage running on Windows.
- [x] Rules files: `packages/db`, `apps/operator`, `apps/mobile`, `apps/web` `CLAUDE.md`.
- [x] Docker runs locally; the whole db suite and `pnpm db:types` run on the dev machine.

## Milestone 0 — left (code)

- [x] Item 11 web: jsdom for `*.test.tsx` via `environmentMatchGlobs` (node stays the default), `app/**` added to `include` so a page test sits beside its page, `vitest.setup.ts` (cleanup + the `IntersectionObserver`, `ResizeObserver`, `matchMedia`, `navigator.vibrate`, `Element.scrollTo` and `CSS.escape` stubs jsdom lacks — `CategoryPills` throws without the last one), `src/test/renderPage.tsx` awaiting the async server component and `src/test/fixtures.ts` (two categories, four items, settings, venue). 7 suites, 45 cases, every one EN and AR: cafe root (walk-in shell with no table chip, category and row language, `MenuUnavailable` on `status: 'error'` instead of a blank menu), `/t` with and without the `tp-table` cookie, the error boundary (`reset` really clicked), not-found (both languages, `/ar` and `/en` links), download (both stable version-less artifact URLs), privacy and support (title, section headings, `dir="ltr"` phone, hours block on and off). Direction is only on `<html>` in `layout.tsx`, which a page test does not render, so Arabic is asserted as catalog strings through `t(locale, key)`. `@touch/web`: 247 tests passing, typecheck and lint clean.
- [x] Item 11 mobile: 118 `testID`s across the 24 route files (`<route>.<element>`; 107 fixed ids plus 11 built from an entity id), forwarded EXPLICITLY — never through a spread — by 27 shared components and hard-coded on exactly one node, `app.direction-root`; `testIdRules` in `@touch/config/eslint` fails `lint` on an interactive element without one, composed with the RTL and client-secret selectors into apps/mobile's single `no-restricted-syntax` array (ESLint does not merge that rule) and pinned by a 16-case self-test; jest-expo beside vitest (`test:smoke`, preset `jest-expo/ios`, globs that cannot overlap); 47 smoke cases — 23 screens × EN/AR plus the root layout — each asserting the primary action's id, the direction the tree resolved to, and that the label is the one `makeT(locale)` gives, so an Arabic screen rendering English fails; `smokeCoverage` locks the checked-in route table to `app/**`; CI renders them between expo-doctor and the bundle.
- [ ] Item 11 bench: `packages/db/bench` (booking, cafe, analytics, replay), committed baseline from the CI runner, nightly `bench.yml`, compare with a 10 % regression rule.
- [x] S10: the test-OTP code left the repo. `config.toml:108-118` holds `env(SUPABASE_AUTH_SMS_TEST_OTP_CODE)` and the CLI substitutes it at `supabase start` (proved on 2.115.0: `docker exec supabase_auth_touchpadel env | grep TEST_OTP`); the value comes from `packages/db/.env` locally and from the repository variable in the CI `db` and `e2e` jobs, with no literal fallback. `scripts/check-config-env.mjs` fails on any literal or undeclared `env()` name (static, in `pnpm security` as `check:config-env`) and, with `--require-values`, gates `db:start` on a six-digit code that is not the burned `123456`. `scripts/security/check-no-config-push.mjs` (root `pnpm security:config-push`, no allowlist) refuses any `supabase config push` in a workflow, a script or a `package.json` scripts block — M8 (`docs/security/security-audit-2026-09-13.md:191`). Runbook step 7 now demands a fresh reviewer pair per review, deleted after the decision; `tests/phone-otp.test.ts` reads the code from the environment and skips its stack block without it.
- [x] Item 12 docs: `HANDOFF.md` reconciled against O8 (booking criticals, `check:locks`, `compute_tab_totals`, PITR, one hosted-state line, Days 26–31, file map, roadmap), `docs/scope/phase2-change-order-2026-09-21.md` (bilingual, EN + AR), `docs/security/security-general.md` §01 (D3–D5 amended, D8–D10 added, walk line now D1–D10), `docs/client/hosted-push-milestone0-2026-09-21.md` (owner runbook for the hosted push).
- [ ] Finding to carry into the bench and Milestone 1: `analytics_courts_summary` over 400 days hits the statement timeout on a database full of test data.

## Milestone 0 — left (owner, Parsa)

- [ ] Check the GitHub Actions runs for `2b9adf7` and `8616549`.
- [ ] `cd packages/db && npx supabase migration list --linked`; expect 0108–0121 pending; never `migration repair --status reverted`.
- [ ] Before pushing: create the real owner, deactivate the five `@dev.touch.local` staff, rotate every PIN with `app.set_staff_pin` (0115 refuses weak PINs), repoint `telegram_staff`, delete the defaults in `scripts/create-operator-owner.mjs`.
- [ ] Buy PITR on the production project; create the staging project from the latest backup; rehearse every push there first.
- [ ] Run `db-migrate.yml` (staging, then production), then `functions-deploy.yml` for `replay`; the assistant functions stay gated.
- [ ] Post-push checks: no unexpected overloads in `pg_proc`, `cron.job` rows, `pg_extension` (`pg_cron`, `pg_net`, `vector`), migration list at 0 pending, CI types-drift step clean.
- [ ] Supabase Auth: email confirmations on, secure password change on, redirect allow-list for web and the mobile scheme.
- [x] GitHub: the repository variable `SUPABASE_AUTH_SMS_TEST_OTP_CODE` (created 2026-09-21, S10). The `db` and `e2e` jobs read it at job level; the `db` job fails with a named `::error::` when it is empty, and a fork PR skips that step because forks cannot read repository variables.
- [ ] GitHub: `docs/client/release-gate-2026-09-20.md` §1–§5 (release environment, PAT swap, tag ruleset, old artifacts), cut `operator-v0.2.14`.

## Inputs owed (client)

- [ ] Qi Card: the ASK QI items in `docs/design/payments/qi-deposit-plan-2026-09-20.md` §2; credentials via `supabase secrets set`.
- [ ] Second venue: name EN/AR, address, phone, courts, tables, hours, rate rules.
- [ ] Loyalty: point value in IQD, tier names EN/AR, thresholds, discount percentages.
- [ ] Coaching: coach list, lesson types and prices, the 60 % share confirmed.
- [ ] Receipts: 20–30 real supplier receipts, the Anthropic API key, the ingredient and supplier list.
- [ ] Tax: which tax group applies to lessons, seats, entries and retail.
- [ ] Phase 1 leftovers: rate rules (every real booking is `NO_RATE`), menu, recipes, staff list, floor numbering, printer model, brand files, phone number.

## Milestones 1–6 — not started

- [ ] 1 Multi-venue: `venues`, `venue_id` on every scoped parent table, stations registry, `staff_venues`, `platform_settings` split, composite uniques, per-venue degraded mode, per-venue realtime topics, owner venue switcher, mobile venue picker, assistant venue axis, two-venue fixture, rehearsal on staging. 6–7 weeks.
- [ ] 2 Online payment (Qi deposits): Majed's design with `venue_id` and a wider `purpose`, `court_fee_paid` nets online amounts, mobile `/pay/return` + `/pay/status`, web return page, four edge functions + fake provider, bulk refund RPC, day-close columns, go-live gates. 3–4 weeks plus Qi lead time.
- [ ] 3 Customers 360 + loyalty: `tabs.customer_id`, session re-key, web sign-in (phone OTP + Google + Apple), `customer_identities`, `customer_metrics`, `customer_360`, loyalty tables and hooks, `loyalty_redeem` adjustment kind, tiers as goods promotions, clawback in `refund`. 6–7 weeks.
- [ ] 4 Shop + AI receipts: `retail` ingredient kind, shop categories without kitchen tickets, `retail_variants`, `suppliers`, receipt tables and private bucket, phone camera page, `receipt-parse` on the existing meter, `pg_trgm` matching, idempotent `confirm_receipt`. 5–6 weeks.
- [ ] 5 Coaching (phone-app coach mode): `lesson` reservation kind, coach tables, generic `event_participants`, `lock_coach`, settlements, lessons masked in `court_availability`. 4–5 weeks.
- [ ] 6 Open matches, then tournaments: matches on `event_participants`, `lock_match`, definer read RPCs, seat money into `court_fee_paid`, scheduling modules in `packages/core`, atomic multi-court block, entries and standings. 8–9 weeks.

Every milestone also carries: enum widenings as their own migrations, migrations to hosted before any client build, an internal mobile build when it has guest screens, Arabic drafted with the English and reviewed by the client, `types.gen.ts` regenerated, both i18n catalogs, matrix rows, allowlist entries, SEC-20/28/29 declarations, assistant coverage, an e2e script in EN and AR, a hosted push checklist, written sign-off.
