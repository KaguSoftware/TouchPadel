# Touch Padel — Security Checklist (General)

**Version** 2.0 · **Date** 2026-08-30 · **Supersedes** Phase 1 Security Audit Checklist v1.0 (2026-08-29)
**Companions** `docs/scope/touch-padel-phase1-scope-of-work.txt` (the contract) · Security Layer v1.1 (the build standard) · `docs/security/security-layer-1.md` (the foundation slice)
**Verified against** the repository at commit `3a6d8f5`, 2026-08-30 — 55 tables, 55 migrations, 21 DB suites.

> **Why v2.0 exists.** v1.0 claimed "verified against the repository, 2026-08-29" but carried findings copied
> from `docs/design/padel-backend-audit-2026-08-27.md` — a document whose own header says it is report-only.
> Migrations **0048** and **0049** (both 2026-08-27) implemented that report two days before v1.0 was written.
> Every Phase 2 item in v1.0 was already closed when it shipped. Section 2 below is the corrected record.
> **Do not work from v1.0.**

A phase is done when every box in it is ticked by a named person and dated. Each item carries its queue ID
(`SEC-xx`) and its owner: **SEC** security owner · **DEV** platform, DB, Electron · **FE1** mobile ·
**FE2** web and operator · **CLIENT** the venue.

**Tags** — ★ hard gate (we do not ship without it) · `[CI]` should become an automated check ·
`[FREEZE]` re-run against the final artifact · `[SOW]` a signed contract commitment, not a nice-to-have.

**Dates** — store submission 2026-09-16 (hard stop 09-18) · build ends 2026-09-20 · handover 2026-10-04.

---

## 00 · How to run this without being a security specialist

1. **Prefer a machine ticking the box over a person.** Anything markable `[CI]` should become a CI job —
   then it is checked on every pull request forever. Section 13 is the list.
2. **Ask for the failing test, not for a yes.** "Show me the test that goes red when you remove the fix."
   A developer can say "done" about anything. Make this the standard for every item in Phases 2 and 3.
3. **Never merge SQL a chat wrote without running it locally first.** Proven twice on this project: v1.0 of
   this document referenced `app.guests` and `app.push_tokens`, neither of which exists, and asserted a
   state of the booking code that was two days stale. Run it against `pnpm db:start`, watch red turn green.
4. **Do not be the only reviewer on the dangerous five.** The authz sweep (SEC-12), the offline queue
   (SEC-32), account deletion (SEC-15/16), key rotation at handover (SEC-42), and the store privacy
   declarations (SEC-20). Second approver, every time.
5. **Check the claim before you check the box.** v1.0 failed because nobody re-ran its premises. When an
   item says "today X is broken", verify X is still broken before spending a day on it.

---

## 01 · Contract deviations — settle these first

These are places where the **signed Scope of Work** and the **built system** disagree. They are not
technical debt; they are commercial exposure. None of them appeared in v1.0.

| # | SOW says | Reality | Action |
|---|---|---|---|
| D1 | Module 1 INCLUDED: "**Staging and production environments**" | One Supabase project, which is the client's live database. `.github/workflows/db-migrate.yml` names its job `staging` while its own comment says "the linked Supabase project is the CLIENT'S long-term production database". | Signed variation, or build staging. A risk note is not enough — this is a delivered-scope gap. (SEC-37 · SEC) |
| D2 | Module 1 INCLUDED: "**Error tracking and uptime monitoring** on the booking and ordering paths" | Neither exists in any client. | Build both, or vary the contract. (SEC-36 · DEV) |
| D3 | Module 1 INCLUDED: "Automated daily backups with **point-in-time recovery**" | PITR is treated as an open question. | PITR is promised. Buy the tier or get the variation signed. (SEC-38 · SEC) |
| D4 | Module 6 NOT INCLUDED: "**Analytics**, marketing tags or advertising pixels" | PostHog is mounted on the guest cafe web app (`apps/web/src/lib/analytics/AnalyticsProvider.tsx`) — the exact surface carrying a table token in the URL. | Remove it, or get a signed variation **and** complete SEC-25. (SEC-19 · SEC) |
| D5 | Module 1 NOT INCLUDED: "**Phone / SMS one-time-code login**" | Security Layer v1.1 §5.2 recommends phone + OTP. | **Settled by contract: email + password.** SEC-22 is closed. Correct the Security Layer. (SEC-22 · SEC) |
| D6 | Track A week 4: "**load test at twice peak**" | Not scheduled, not in v1.0. | Schedule it. (SEC-38 · DEV) |
| D7 | Module 7: "the day **cannot be closed while unsynced items remain**" | Not verified; no box in v1.0. | Add the assertion and a test. (SEC-32 · DEV) |

- [ ] `[SOW]` Walk D1–D7 with the client, decide each, and record the decision in writing. Nothing below is
      trustworthy until D1 is settled, because it decides what "production" means. (SEC-37 · SEC)

---

## 02 · Already true — do not redo these

Verified in the repository on 2026-08-30. **Items marked ⚠ were listed as open work in v1.0 and are not.**
Ticking these again wastes days.

### Database and authorization
- ⚠ **RLS on every table.** 55 tables, 55 `enable row level security`, 69 policies. The SOW's core promise
  ("permissions enforced by row-level security in the database") holds.
- ⚠ **Default privileges already revoked.** `0003:22-29` — `alter default privileges for role postgres in
  schema public revoke all on tables/sequences/functions from anon, authenticated`, plus functions in `app`.
  v1.0 listed this as open. *Caveat: scoped to role `postgres`; an object created by another role would not inherit.*
- ⚠ **`app.staff_role()` already honours `is_active`.** `0003:50` — `select role from staff where id =
  auth.uid() and is_active`. A disabled account resolves to NULL and every RPC refuses on the next call.
  v1.0 listed this as an open ★ hard gate.
- **Append-only ledgers enforced two ways.** `app.append_only()` trigger (`0003:39`), `audit_log_ao`
  (`0005:25`), and `revoke update, delete` on `stock_movements` (`0018:48`), `payments`/`refunds`
  (`0015:1342`), `sync_replays` (`0021:48`). Owner included. Satisfies Security Layer A.1.
- **`search_path` pinned on definer functions — 159 of 159, zero offenders** across 235 `SECURITY DEFINER`
  statements. The guard test is a pure regression lock, not a fix.
- **Views are already correct.** 12 views, all in `public`. Eight are `security_invoker = on`; the other four
  (`venue_settings_public`, `cafe_settings_public`, `menu_item_availability`, `court_availability`) are
  deliberate, documented, column- or row-restricted public projections. There are no materialized views.
- ⚠ **`pgcrypto` is already in `extensions`** (`0009_pgcrypto_schema_fix.sql` exists for exactly this; every
  call site is schema-qualified) and `pg_cron` installs into `cron`. **Only `btree_gist` is unpinned.**
- ⚠ **The realistic-argument, multi-principal authz pass already exists and runs in CI.** `tests/rls-matrix.ts`
  drives 8 principals (anon, guest_account, guest_anon_session, cashier, prep, court_desk, manager, owner)
  against 50 RPC rules with arguments "chosen to fail fast AFTER the permission/guard layer". What is missing
  is coverage, not a second pass.

### Booking and money — the whole Phase 2 cluster of v1.0
Migration **0048** (booking hardening) and **0049** (replay idempotency), both 2026-08-27:
- ⚠ **Anonymous identities refused on the hold RPC.** `0048/C1` — `ACCOUNT_REQUIRED`, plus a per-caller
  live-hold cap (`0048:311-320`), a booking horizon, and an audit row. The "12/12 holds in 127 ms"
  reproduction v1.0 quotes as current was fixed the day it was reported.
- ⚠ **Idempotency keys are caller-scoped.** `0048/H3` plus `0049`'s `app.rpc_replays` (`caller uuid not
  null`) → another principal replaying your key gets `IDEMPOTENCY_CONFLICT`, never your result.
- ⚠ **Move and extend re-price and re-check bookability.** `0048/H1` re-resolves `app.price_slot`;
  `0048/H2` calls `app.assert_bookable`. A manual price override is deliberately preserved.
- ⚠ **`rate_rules` is constrained.** `rate_rules_time_order check (start_time < end_time)`,
  `0048:124-130`. v1.0 says "it has zero today".
- ⚠ **The overnight-rate question is settled.** `app.upsert_rate_rule` raises `INVALID_TIME_RANGE` with the
  hint "split an overnight window into two rules" (`0048:170-172`). The two-row model is enforced, not pending.
- ⚠ **Degraded mode is enforced server-side, with a distinct error code.** `app.assert_not_degraded_for()`
  raises `DEGRADED_LOCKOUT` / `P0001` for any start inside `venue_settings.protected_horizon_hours`
  (`0008:62-73`); `app.is_degraded()` became a real heartbeat-staleness check in `0021:56-68`; callers include
  `hold_slot` (`0048:309`). Covered by `degraded.test.ts` and `heartbeat-liveness.test.ts`. v1.0 listed this
  as an open ★ hard gate.
- ⚠ **The expired-hold reaper already runs.** `app.expire_stale_holds()` (`0008:81-96`) is scheduled every
  minute as `tp_hold_sweep` (`0021:306`), alongside `tp_degraded_sweep` and `tp_expiry_flagging`.
- ⚠ **Flush-before-confirm is already in place.** `queue.ts:16-17` sets `journal_mode = WAL` and
  `synchronous = FULL`; better-sqlite3 is synchronous so the insert returns only after the fsynced commit,
  and the IPC promise resolves after it (`index.ts:124-126`). Asserted in `queue.test.ts:38-46`.
- ⚠ **Edge functions resolve the role server-side and the Telegram chat-id allowlist exists.** All seven
  functions are declared in `config.toml`; `_shared/auth.ts requireStaffRole` re-resolves against the `staff`
  table; `telegram-callback` compares `X-Telegram-Bot-Api-Secret-Token` constant-time and **fails closed when
  the secret is unset** (`index.ts:73-85`); the chat allowlist lives in the DB (`0039:406-413`,
  `telegram_chat_id` + `telegram_staff`), tested at `telegram.test.ts:631,639`.

### Clients and platform
- **Electron window hardening.** `contextIsolation: true`, `nodeIntegration: false`, **both** `will-navigate`
  and `will-redirect` blocked (`index.ts:77-80`), `setWindowOpenHandler` scheme-filtered and always returning
  `deny` (`:87-93`), and `will-attach-webview` refused (`:97-101`). Only `sandbox: true` and the preload
  bundle remain — a known `TODO(W3)`.
- **PIN rate-limit keying.** Migration 0026 counts failures per caller with a prefix match across that
  caller's devices; rotating a client-supplied device id does not reset the counter.
- **Menu media bucket.** `allowed_mime_types` restricted to webp/jpeg/png/mp4/webm with a size limit —
  SVG cannot be uploaded, so the stored-XSS path is closed.
- **Realtime.** Broadcast-from-database on private topics with per-topic RLS on `realtime.messages`
  (`0022:21-155`, policies `0022:166-216`). Zero `postgres_changes` subscriptions anywhere, and **no table is
  in the `supabase_realtime` publication at all**, so nothing is replicated for CDC. The remaining work is
  auditing what the explicit payloads contain (SEC-28).
- ⚠ **Edge functions declare `verify_jwt` explicitly.** `supabase/config.toml:84-100` lists every function;
  only `telegram-callback` is `false`, authenticated by its secret-token header.
- ⚠ **Per-table QR rotation already works.** `app.rotate_table_token` (owner, audited) plus
  `cafe_tables.token_version` (`0014:24`). What is missing is *secret* rotation (SEC-26), not table rotation.
- **Push token: read isolation, provider-410 clearing and no logging all hold.** `profiles_select`
  (`0004:163`); `send-push/index.ts:182` nulls the token on an Expo `DeviceNotRegistered` ticket; the mobile
  breadcrumb records only `'registered'|'denied'|'unavailable'`, never the token.
- ⚠ **No cash-drawer kick exists.** `index.ts:136` — "NO cash-drawer kick — cut from phase 1 (plan cut #7)".
  Hardware control is contractually out of scope; what ships is `app.record_drawer_open` (`0053:343`), an
  audit write requiring a reason code and a cashier/manager/owner role.
- **`.gitignore` covers the secret shapes.** `.env`, `.env.*`, `station.json`, `*.pem`, `*.p12`, `*.keystore`.
### Money, booking and guest-side integrity — the surface the v1.0 queue never covered

- **Double-booking is structurally impossible.** `reservations_no_overlap exclude using gist (court_id with =,
  period with &&) where (status in ('pending','confirmed','arrived'))` (`0008:43-45`), raising `SLOT_TAKEN`.
  Proven by 10 cases in `packages/db/tests/concurrency.test.ts`. This is the SOW's KEY GUARANTEE.
- **A crafted request cannot set a price.** `order_items.unit_price_iqd` is annotated "SNAPSHOT from DB at send
  time — never client-supplied" and `line_total_iqd` "computed server-side" (`0015:80-81`); the insert at
  `0015:254-256` writes the server-resolved value.
- **Money is integer minor units.** The `iqd` domain over `bigint` throughout; tax rounds through `numeric` and
  casts straight back to `bigint` (`0015:335`). No float touches a total.
- **The day cannot close with an open tab.** `close_day` raises `DAY_OPEN_TABS` with the hint "settle or void
  every open tab before closing the day" (`0020:6,53-54`) — enforced in the database, not the UI.
- **Refunds are manager-only and reverse stock.** `app.refund()` requires `app.is_staff('manager','owner')`
  plus a PIN, else `FORBIDDEN` (`0015:1194-1213`); `refund_items` drives `refund_reversal` movements into the
  append-only stock ledger (`0015:146,1263`).
- **The waiter call is debounced.** `venue_settings.waiter_call_cooldown_seconds`, default 120 (`0006:18`),
  enforced at `0016:48`; `cafe_tables.bell_enabled` (`0031`) is the per-table mute.
- **Guest order notes are capped and never rendered as HTML.** `z.string().max(500)` and `.max(1000)` in
  `packages/core/src/schemas/mutations.ts:94,187`; no `dangerouslySetInnerHTML` anywhere in `apps/web` or
  `apps/operator`.
- **The role matrix is overwhelmingly negative.** `tests/rls-matrix.ts` asserts 116 `denied` and 42 `guarded`
  outcomes against a single `allowed` — it is a must-not suite, which is what Security Layer §4.3 demands.
- **Mobile tokens are in the OS keystore.** A chunking `expo-secure-store` adapter is the Supabase auth storage
  (`apps/mobile/src/lib/secureStorage.ts`, wired at `supabase.ts:33`). `AsyncStorage` is used only for the
  TanStack query cache, which excludes `my-bookings` and is wiped on sign-out after a real cross-account leak
  was found and fixed (`queryClient.ts:87-110`).
- **Deep links cannot carry an action.** `deepLink.ts` is a pure parser recognising exactly three auth shapes;
  anything else parses to `null`, so "an ordinary `touchpadel://bookings` share link must never be mistaken for
  a callback".
- **No client opens a direct Postgres connection.** Every client reaches data through the Supabase URL; there is
  no `postgres://` or `:5432` in any client path.

### Repository and delivery

- **`db-migrate.yml` is armed and gated.** Required reviewers were enabled on the `staging` GitHub
  Environment **first**, then the secrets were added (`HANDOFF.md:542-546`, 2026-08-27). ⚠ *But the gate is a
  GitHub UI setting with no repo artifact — it can be edited or deleted leaving no git trace, and the job it
  guards pushes to the client's production database. Re-verify it, do not assume it.*

---

## 03 · Corrections to v1.0 — do not restore the original wording

1. **Invented table names.** v1.0's SQL references `app.guests` and `app.push_tokens`. Neither exists. The
   real objects are `profiles` (with `expo_push_token` as a column), `staff`, and `guest_sessions`.
2. **The entire Phase 2 was stale** — see §02. Seven ★ hard gates were already closed.
3. **SEC-18 is mis-described.** v1.0 says the reset and verification redirects "both point at localhost
   today". They do not: `apps/mobile/src/features/auth/api.ts:24-25` uses `touchpadel://reset-password` and
   `touchpadel://verify-email`, and `redirects.ts` resolves per environment via `Linking.createURL()`.
   The real gap is universal/app links against a real domain, and the GoTrue allowlist — not localhost.
4. **SEC-28's premise is wrong.** Nothing subscribes with `postgres_changes`; the item shrinks to auditing
   broadcast payloads.
5. **SEC-13 is understated, not overstated.** v1.0 says only set-time policy survives. In fact
   `app.set_staff_pin` accepts `^[0-9]{4,6}$` — **four digits pass**, against a 6-digit standard — and PINs
   exist only for `manager`/`owner`, which is the root of the SEC-34 self-unlock gap.
6. **SEC-26 is half-credited.** Per-table rotation exists; secret rotation without reprinting does not.
7. **What v1.0 got right, worth repeating:** `gitleaks` is **not** in CI, despite the Security Layer stating
   it runs there and fails the build. The standard describes an intention, not the pipeline.

---

## 04 · Phase 0 — today, no code

*(Full detail and ordering in `security-layer-1.md`. Summary here.)*

- [ ] ★ Enable MFA org-wide: GitHub, Supabase, Vercel, PostHog, Expo, Apple, Google. Recovery codes sealed to the client's owner, not a Kagu inbox. **2026-09-01:** the Expo/EAS, Apple Developer and Google Cloud accounts that social sign-in and the store release need do not exist yet (`API.md` §8 placeholders); each falls under this item the day it is created, Google Play included. (SEC-40 · CLIENT+SEC)
- [ ] Add `.github/CODEOWNERS` routing `packages/db/supabase/migrations/` and `.github/workflows/db-migrate.yml` to the technical lead; enable "Require review from Code Owners" on `main`. **Confirmed missing.** (SEC-01 · SEC)
- [ ] Add required reviewers to the `staging` GitHub Environment **before** the deploy secrets go in — without them the gate in `db-migrate.yml` is a no-op. (SEC-02 · DEV)
- [ ] ★ `[CI]` Run `gitleaks detect --source . -v --log-opts="--all"` over full history. **Confirmed absent from the repo.** (SEC-24 · DEV)
- [ ] Rotate anything gitleaks finds, in rotation-runbook order. (SEC-24 · DEV)
- [ ] ★ `[CI]` `[FREEZE]` Grep built artifacts for a service key — Expo bundle, `.next/static`, Electron `app.asar`. Search `service_role`, `sb_secret`, `role":"service_role"`. Code review is not evidence. (SEC-24 · DEV)
- [ ] ★ Supabase → Auth → Attack Protection: CAPTCHA on, token passed on `signInAnonymously`. **Nothing
      captcha-related exists in the repo** (0 hits); the only throttle today is `[auth.rate_limit]
      anonymous_users = 300` (`config.toml:74`), flagged in-file as "revisit before production handover".
      ⚠ **Anonymous sign-in is load-bearing for the cafe** — `apps/web/src/hooks/cafe/useTableSession.ts:57`
      is the one production call site and every table session boots through it. Do **not** disable anonymous
      sign-in; add the CAPTCHA token to that call. 0048's `ACCOUNT_REQUIRED` is scoped to `app.hold_slot`
      alone, so court booking needs a real account while table sessions do not. (SEC-05 · DEV)
- [ ] ★ Replace the auth redirect allowlist with exact production URLs — no wildcards, no `localhost`, no `exp://*` in the hosted project. (SEC-05 · DEV) **Verified still open 2026-09-01 (Prompt C, report-only):** hosted list = `https://localhost:3000`, `touchpadel://verify-email`, `touchpadel://reset-password`, `exp://192.168.1.108:8081/--/*` — the last is a wildcard LAN entry for Expo Go email-link tests; removal + Site URL fix are scheduled for release week (`docs/client/social-auth-setup-2026-09-01.md`, Prompt D Task 4).
- [ ] ★ Leaked-password protection on; JWT expiry 30 minutes with refresh rotation and reuse detection. (SEC-05, SEC-35 · DEV) **Verified 2026-09-01: leaked-password protection OFF and CAPTCHA OFF while anonymous sign-ins are ON** — the MAU-inflation combination Supabase's own inline warning names.
- [ ] Set Supabase member roles: SEC and DEV Owner/Admin; FE1 and FE2 Developer with **no SQL Editor access**. With one project, access control *is* environment separation. (SEC-37 · SEC)
- [ ] Ask the client for the domain today and delegate DNS. Blocks the privacy URL, the deletion URL, auth redirects, HSTS and QR cards. (SEC-06 · CLIENT)
- [ ] Ask the client for the PC policy in writing: BitLocker, OS auto-updates, 5-minute screen lock, no shared Windows admin account, **guest wifi on a separate VLAN from the POS**. (SEC-41 · CLIENT)
- [ ] Ask the client to decide account ownership at handover. Longest-lead item. (SEC-42 · CLIENT)
- [ ] Confirm the Supabase plan tier and whether PITR is available — **note D3: the SOW promises it.** (SEC-38 · SEC)
- [x] ~~Decide guest sign-in~~ — **settled by the SOW: email + password. Phone/OTP is out of scope.** (SEC-22)

---

## 05 · Phase 1 — make the one live database safe to work on

- [ ] ★ Write the live-migration procedure: `SET lock_timeout = '3s'; SET statement_timeout = '60s';` at the top of every migration session. An `ALTER TABLE` behind a long Realtime transaction freezes the till mid-service. (SEC-02 · DEV)
- [ ] ★ `[CI]` Add `check:migrations`, and **scope it to lock-taking DDL, not just object drops.** A
      drop-only rule lands green here while missing every real hazard in the repo:
      **11 of 12 `add constraint` statements omit `NOT VALID`** (`0027:50,54,58,63`, `0030:35,40`,
      `0054:37,141`, `0019:33`, `0008:43`), each taking `ACCESS EXCLUSIVE` plus a full validating scan on
      tables that already hold live data; `0039:71` is a three-statement blocking sequence on `order_items`,
      the hottest table in a POS; and **0 of 48 `create index` statements use `CONCURRENTLY`**. Exactly one
      site uses the safe `NOT VALID` → `VALIDATE` pattern, which proves the pattern is known and simply not
      applied. Fail on all of it unless the PR body carries `MIGRATION-RISK-ACCEPTED:` with a reason —
      plus the original `DROP TABLE` / `DROP COLUMN` / `TRUNCATE` / `ALTER COLUMN … TYPE` /
      unpaired `DROP POLICY` classes.
      ⚠ **Scope the check to the migration files changed in the pull request, not the whole directory.**
      The 11 existing constraint sites and 48 non-concurrent indexes are already applied and cannot be
      rewritten; a whole-directory scan turns `main` red on history and the rule gets weakened or deleted
      within a day. Grandfather what is committed, guard what arrives. (SEC-02 · DEV)
- [ ] Take a data-only dump of the ledger tables as a retained CI artifact **before** each push; print `supabase db diff` into the job log. (SEC-02 · DEV)
- [ ] Add `timeout-minutes` to the `db-migrate` job. There is none today, so a push blocked on a lock can sit against GitHub's 360-minute default while the till is frozen. (SEC-02 · DEV)
- [ ] `[FREEZE]` Re-verify that required reviewers are still enabled on the `staging` GitHub Environment. It is an out-of-repo setting with no git trace, and it is the only thing between a merge to `main` and the client's production database. (SEC-02 · SEC)
- [ ] ★ Bring the hosted project to the local migration head through that gated procedure. This has already
      bitten once: `db-migrate.yml` silently skipped from day 1 for want of secrets, and **the hosted DB drifted
      eight migrations behind** before anyone noticed (`HANDOFF.md:544-545`). Every green-gate claim about a
      drifted database is a claim about a database the venue does not use. (SEC-03 · DEV)
- [ ] ★ `[CI]` Nightly `supabase db diff --linked`, failing on non-empty output. (SEC-03 · DEV)
- [ ] Re-run the DB suite against the hosted project through a restricted role, never `service_role` from a laptop. (SEC-03 · DEV)
- [ ] `[CI]` `packages/db` test asserting every view in `public`/`app` is `security_invoker = on`, **with a named allowlist of the four audited projections** (`venue_settings_public`, `cafe_settings_public`, `menu_item_availability`, `court_availability`). Any *new* invoker-off view fails. Asserting a flat zero would go red on a clean repo. (SEC-04 · DEV)
- [ ] `[CI]` `packages/db` test asserting every `security definer` function in `app` has a pinned `search_path`. Regression guard — expect it to pass first run. (SEC-04 · DEV)
- [ ] Move **`btree_gist` only** into `extensions` — `0001:5` is a bare `create extension if not exists btree_gist;`. `pgcrypto` is already in `extensions` (0009) and `pg_cron` in `cron`; leave both alone. (SEC-04 · DEV)
- [ ] `[FREEZE]` Run the dashboard Security Advisor; file the result. Expect exactly two known findings: `extension_in_public` for `btree_gist` (fix it) and `security_definer_view` ×4 (accepted by design — record the waiver). "Clean" means every other lint is zero. (SEC-04 · SEC)
- [ ] `[CI]` CI check that seed and fixture files contain no real-format Iraqi phone number outside a reserved test range. (SEC-37 · DEV)
- [ ] Write the rule that production rows are inspected only through a masked, audited definer function — never the SQL Editor. (SEC-37 · SEC)
- [ ] ★ Write down **the rule that has no exception** (Security Layer §1.1) and give it a check: never add a column, form field, note field or log line that could hold a card number. **Nothing in the repo states or enforces this today.** Add it to the PR checklist and to the guest-field allowlist test. (SEC-20 · SEC)
- [ ] Restrict direct database connections on the hosted project so clients reach data only through the API and the pooler. No client opens a raw Postgres socket today, but the port posture is a dashboard setting nobody has checked. (SEC-04 · DEV)
- [ ] Set the `client-data/` intake rule: packs are committed verbatim, so **no pack containing guest or staff personal data may be committed**. Currently clean (`courts.sql` only). (SEC-37 · DEV)
- [ ] Record the residual risk in writing and have the client sign it — with one project, a bad migration reaches live guest data with no rehearsal. See **D1**. (SEC-37 · SEC)

---

## 06 · Phase 2 — booking and money integrity

> **Most of this phase closed in migrations 0048 and 0049.** What follows is what genuinely remains.
> See §02 before starting anything here.

- [ ] Clean any remaining NULL-guest reservation rows, then make the guest column `not null`. (SEC-07 · DEV)
- [ ] Extend the existing hold reaper to cover **legacy NULL-guest rows**. The sweep itself already runs —
      `app.expire_stale_holds()` (`0008:81-96`) is scheduled every minute as `tp_hold_sweep` (`0021:306`) —
      so this is a widening, not a build. (SEC-07 · DEV)
- [ ] Add the remaining `rate_rules` CHECK constraints: **positive price** and **sane minute bounds**. Only `start_time < end_time` exists today. (SEC-10 · DEV)
- [x] ~~Add a GiST exclusion constraint preventing overlapping rules~~ — **dropped, the premise is wrong.**
      Overlap *is* the pricing model: `rate_rules.priority` (`0007:25`, "highest priority wins on overlap") is
      resolved deterministically by `app.price_slot` (`0007:63`, court-specificity → priority → id) and mirrored
      in `packages/core/src/pricing/rateRules.ts:86-91`. The DB test helper seeds a priority `-100` all-day rule
      that overlaps every fixture rule, so the constraint would make the suite unloadable — and `days_of_week`
      is `int[]`, which has no GiST opclass without `intarray`. *If ambiguity is the worry, add an admin-UI
      warning for two active same-priority rules instead.* (SEC-10 · DEV)
- [ ] Create one shared golden-case fixture — ~30 `(court, timestamp, expected_iqd)` triples across both sides of midnight and both boundary minutes — asserted by a `packages/db` test **and** a `@touch/core` unit test reading the same file. (SEC-10 · DEV)
- [ ] Require a reason code when a move or extend changes the price, and write both prices into the audit before/after. (SEC-09 · DEV)
- [ ] ★ Add a temporal guard so a future reservation cannot be marked no-show or released and resold. Cancelling stays legal through the cancel RPC with a reason, and a manager PIN if it was paid. (SEC-11 · DEV)
- [ ] Keep the 0048 regression suite green and named in the handover pack: anonymous refused, concurrent-hold cap, horizon, cross-caller idempotency, create-vs-move price equality. (SEC-07/08/09 · DEV)

---

## 07 · Phase 3 — authorization, sessions and the surfaces the tests cannot see

- [ ] ★ `[CI]` **Extend the realistic-argument pass that already exists** — `tests/rls-matrix.ts`, 8 principals
      including `prep`, 50 RPC rules — to the RPCs it does not cover. Against the 121 distinct names in
      `grant execute on function app.*`, **71 are uncovered**, including `override_price`, `void_after_send`,
      `apply_pct_discount`, `merge_tabs`, `split_by_item`, `set_cafe_settings`, `set_opening_hours`, and the
      whole staff-admin and `analytics_*` families. Do not build a second sweep; close the gap in this one.
      *(`check-rpc-authz.mjs` passes NULL for every argument by its own design — it is the blunt net, not the
      realistic pass.)* (SEC-12 · SEC)
- [ ] `[CI]` Track the covered/granted ratio as a number and fail the build when it regresses. (SEC-12 · SEC)
- [ ] `[CI]` Store the allowlist as data (`packages/db/fixtures/rpc-allowlist.json`) and fail CI when a function appears in `pg_proc` and not in the file. Closes "a new RPC ships unguarded" permanently. (SEC-12 · SEC)
- [ ] Raise the PIN minimum to 6 digits — `app.set_staff_pin` accepts `^[0-9]{4,6}$` today — and reject repeated and sequential runs. (SEC-13 · DEV)
- [ ] Make every PIN failure path return the same code, message and delay; audit every lockout and every manager-cleared lock. (SEC-13 · DEV)
- [ ] Write and test the **quiet-error rule**: no stack traces, no raw Postgres errors, no "user 4412 not found" that confirms which accounts exist — the same generic message whether the account exists or not, with the full error going to the tracker. A guest must never see a constraint name. (SEC-36 · FE1+FE2)
- [ ] Audit the private broadcast payloads the KDS and floor view receive: assert prep never receives a price, total or guest field. Send explicit payloads, never whole rows. (SEC-28 · DEV)
- [x] ~~Confirm `telegram-callback` verifies its secret header and allowlists the chat id~~ — **already done**
      (`index.ts:73-85` constant-time, fails closed when unset; allowlist in the DB at `0039:406-413`, tested).
- [ ] Add a per-day call quota and a hard monthly spend cap to the LLM insights function. **Owner-only access
      already holds**; the cap does not. Every cafe guest holds an `authenticated` JWT, so an uncapped model
      endpoint is an uncapped bill. (SEC-29 · DEV)
- [ ] Treat retrieved text as data before it enters a prompt: strip control and bidi characters, delimit it, constrain the response. Guest-written order notes reaching a prompt the owner reads as advice is prompt injection with the owner as the target. (SEC-29 · DEV)
- [ ] Assert in code that no guest identifier leaves in the analytics or insights payload. (SEC-29 · DEV)
- [ ] Have the disable-staff RPC call the admin API to sign the user out globally, and drop the operator's Realtime channel on the next role-resolution failure. *(The DB half is already done — see §02.)* (SEC-35 · DEV)

---

## 08 · Phase 4 — store submission lane · 2026-09-16

- [ ] ★ Unblock the FK chain so a guest can be deleted: anonymise the profile row rather than cascading, so booking rows survive for statistics. A data-model decision, not a button. (SEC-15 · DEV)
- [ ] ★ Write `app.delete_my_account()` as `SECURITY DEFINER` with a pinned `search_path`: anonymise the name, null the phone and email, clear the push token, write an audit row, then delete the auth user and revoke sessions globally. **Confirmed absent from the repo.** (SEC-15 · DEV)
- [ ] **Added 2026-09-01 (social sign-in, vendor addition):** Apple requires token revocation (`POST https://appleid.apple.com/auth/revoke`) when an account that used Sign in with Apple is deleted. `auth.admin.deleteUser` does not do it, and the id-token grant yields no refresh token — so the deletion flow must re-authenticate with Apple for a fresh `authorizationCode`, then exchange + revoke it from an edge function holding a Sign in with Apple `.p8` key: the ONLY Apple secret the feature introduces, server-side only, never in a client. Design note: `docs/design/social-signin-2026-09-01.md`. (SEC-15 · DEV)
- [ ] Test it: no phone/email/name left, reservations still count in statistics, audit row exists, auth user gone, old refresh token no longer mints a JWT. (SEC-15 · DEV)
- [ ] ★ `[FREEZE]` Build the in-app deletion screen with a typed confirmation; on success clear every chunk of the secure-store adapter, delete the push token locally and server-side, route to signed-out. No email, no support ticket. (SEC-16 · FE1)
- [ ] `[FREEZE]` Verify on a physical device of each platform: delete, force-quit, reopen, still signed out, old token refused. (SEC-16 · FE1)
- [ ] ★ `[FREEZE]` Publish a **web** deletion-request page on the real domain, both locales. Google Play requires a URL reachable without installing the app. (SEC-17 · FE2)
- [ ] ★ `[FREEZE]` Publish the privacy notice in Arabic and English, matching the code: the exact stored-field list, the processors, the legal basis, a contact address. Arabic is the default locale, so it is the primary text. (SEC-17 · FE2)
- [ ] ★ Register universal / app links against the real domain. **The redirect bug is fixed — do not redo it**
      (`api.ts:24-25` + `redirects.ts` `Linking.createURL()` + `useAuthDeepLink` mounted at `_layout.tsx:73`;
      the local allowlist at `config.toml:59-63` lists both `touchpadel://` URLs). What remains: add
      `ios.associatedDomains` and `android.intentFilters` to `app.config.ts`; serve
      `apple-app-site-association` and `/.well-known/assetlinks.json` from `apps/web`; add `exp://*` to the
      **dev** project only; and fix `site_url = "http://localhost:3000"` (`config.toml:53`) on the hosted
      project — **still `http://localhost:3000` on 2026-09-01** (Prompt C reading; Prompt D Task 4 sets it). (SEC-18 · FE1)
- [ ] `[FREEZE]` Verify the full reset flow on one iOS and one Android device from a cold install; record the build number. (SEC-18 · FE1)
- [ ] ★ `[FREEZE]` **Social sign-in audiences (added 2026-09-01):** Supabase → Auth → Providers — the Client-ID lists must be **exact and minimal**. Apple: `com.kagu.touchpadel` (+ `host.exp.Exponent` during development only). Google: the Web client id + the iOS client id, nothing else — Android tokens carry the Web id as `aud`, so no Android id is ever listed. GoTrue's audience check is the only thing that stops an id token minted for another app from signing in here. Read the two fields via the report-only Chrome prompts C/D in `docs/client/social-auth-setup-2026-09-01.md`; `packages/db/supabase/config.toml` `[auth.external.*]` mirrors the intended lists locally. (SEC-05 · SEC)
- [ ] ★ `[FREEZE]` **Remove `host.exp.Exponent` from the Apple Client IDs before the store build** (Prompt D Task 4). It is Expo Go's bundle id: while listed, a token minted inside Expo Go by anyone signs in as its holder's own Apple identity — a guest account with no privilege, but not a production audience. (SEC-05 · SEC)
- [ ] **"Skip nonce check" stays OFF on both providers, by design.** The app mints a nonce per attempt (`apps/mobile/src/features/auth/providers/nonce.ts`: raw → GoTrue, SHA-256 hex → provider), so a replayed id token is refused. Turning it ON for Google is the documented fallback ONLY after the one-file library swap to `@react-native-google-signin` (no nonce support) or a proven SDK nonce defect — and only with SEC sign-off, a HANDOFF entry, and the client omitting `nonce`. `config.toml` pins `skip_nonce_check = false` locally; the hosted toggle has to be looked at (Prompt C reports it). (SEC-05 · SEC)
- [ ] MFA on the three new accounts — Expo/EAS, Apple Developer, Google Cloud (and Google Play when created) — the day each is created. They are already named in the SEC-40 line in §04; nothing new to decide, just do not skip them because they arrived late. (SEC-40 · CLIENT+SEC)
- [ ] Make push work end to end, sending only from an Edge Function that resolves recipients server-side — never from a client-supplied token list. (SEC-21 · FE1)
- [ ] Finish treating the push token as personal data. **Already done:** guest-only read (`0004:163`), cleared
      on an Expo `DeviceNotRegistered` ticket (`send-push:182`), never logged. **Still open:** clear it on
      sign-out (`auth/api.ts:92` calls `auth.signOut()` and nothing else), clear it on account deletion (no
      path exists yet), and narrow the `profiles` select grant so staff cannot read `expo_push_token` —
      `pin_hash` already gets that column-level treatment at `0004:171`. (SEC-21 · FE1)
- [ ] Sign EAS Updates and reject unsigned manifests. An OTA channel pushes code to every guest phone with no store review — the highest-leverage credential in the mobile lane. (SEC-23 · FE1)
- [ ] `[CI]` Encode the stored-field allowlist as a `packages/db` test asserting the exact column set of the guest-facing tables. A paragraph drifts; a test goes red. (SEC-20 · SEC)
- [ ] `[FREEZE]` Fill both stores' data-safety forms **from that test's array**, not from memory. (SEC-20 · SEC)
- [ ] ★ Write the processor register. All three are **live in production and none is papered**: PostHog
      (EU, project `touch-padel` id 209766, `HANDOFF.md:163`), **Groq** for LLM insights
      (`analytics-insights/index.ts:53`), and the Telegram Bot API (`telegram-send`). Record data categories,
      region, retention, legal basis and contract status; sign PostHog's DPA; get Groq zero-retention in
      writing. **See D4 — PostHog on the guest web app is outside the SOW.** (SEC-19 · SEC)
- [ ] Decide Telegram explicitly: strip the payload to ticket number and table (no notes, no totals) and disclose it, or replace it. Live order contents currently go to a consumer messaging platform under no agreement. (SEC-19 · SEC)
- [ ] `[CI]` Add the CI secret gates permanently: artifact grep, gitleaks over history, `pnpm audit --audit-level=high`, Dependabot, and a check that no `NEXT_PUBLIC_`/`EXPO_PUBLIC_` name matches `/SECRET|KEY|TOKEN|PIN|HMAC/`. (SEC-24 · DEV)

---

## 09 · Phase 5 — desktop app and the offline queue

- [ ] Bundle the preload to a single file and set `sandbox: true`. The rest of the window hardening is in place; this is the one `TODO(W3)` left. (SEC-30 · DEV)
- [ ] `[CI]` Add `check:electron` failing on `nodeIntegration: true`, `contextIsolation: false`, `sandbox: false`, `webSecurity: false` or `@electron/remote`, so the hardening cannot regress. (SEC-30 · DEV)
- [ ] Buy an OV or EV code-signing certificate, key in a cloud HSM, not on a laptop. Issuance takes days — start now. (SEC-14 · DEV)
- [ ] Sign the installer and binaries; configure the updater to verify the publisher against the certificate and refuse a mismatch. (SEC-14 · DEV)
- [ ] Prove it: install the signed build with no SmartScreen prompt, then serve a tampered `.exe` and show the updater refuses. (SEC-14 · DEV)
- [ ] Encrypt the queue at rest with `safeStorage` (DPAPI-backed), and refuse to trade offline if `isEncryptionAvailable()` is false. (SEC-32 · DEV)
- [ ] **Encrypt or remove `pin_cache`.** `queue.ts:36` stores argon2 staff PIN hashes on the venue PC for offline unlock (`TODO(W3)`). PIN hashes at rest on an unmanaged Windows box is a credential store nobody has scoped. **Not in v1.0.** (SEC-32/SEC-34 · DEV)
- [x] ~~Write and flush to disk before the renderer confirms~~ — **already done** (`queue.ts:16-17`
      WAL + `synchronous = FULL`, IPC resolves after commit, asserted in `queue.test.ts:38-46`). `[SOW]` Module 7.
- [ ] Generate the idempotency key at the moment of the action and carry the staff session captured at that moment — never the session present at replay. `[SOW]` Module 7. (SEC-32 · DEV)
- [ ] Implement dequeue: ordered replay, bounded retry, no reordering. `queue.ts` exposes `openQueue`/`enqueue`/`ack`/`queueStatus`/`getCachedRef` — there is no dequeue, and the renderer never calls `touch.enqueue`. (SEC-32 · DEV)
- [ ] Route a server-rejected write to a visible "needs a manager" list; never drop it, never let it block the queue forever. `[SOW]` Module 7. (SEC-32 · DEV)
- [ ] Purge on confirmed sync, and assert the local schema cannot store the guest list. (SEC-32 · DEV)
- [ ] Stamp both the client's action time and the server's receipt time on a queued write and reconcile on replay. The venue PC's clock is managed by nobody. (SEC-32 · DEV)
- [ ] `[SOW]` Assert the day cannot be closed while unsynced items remain — **D7**. (SEC-32 · DEV)
- [ ] Make `QueueStatus.degraded` reflect the real heartbeat instead of a hard-coded `false` (`queue.ts:87`; there is a KNOWN-GAP test at `queue.test.ts:130`). The server-side guard holds, but the till's own banner lies. (SEC-33 · DEV)
- [ ] Stop `station.ts:37-42` defaulting a misconfigured machine into a working station identity. A station with no `station.json` should refuse to trade, not guess. (SEC-32 · DEV)
- [ ] ★ Strip control bytes and Unicode bidi overrides from guest text at write time in the RPC. **No such stripping exists today.** (SEC-27 · DEV)
- [ ] ★ Whitelist bytes on every **text field entering the W3 ESC/POS builder** — printable ASCII, Arabic
      ranges, LF; nothing else in `0x00–0x1F` — and **exempt the framed `GS v 0` raster payload**, or the
      whitelist destroys the raster command itself. The designed pipeline rasterises in an offscreen window so
      "the printer never sees text" (`design-arch.md` §6.1), but every field feeding that render is still guest
      input. Nothing to audit yet: `index.ts:130-138` returns `printing-not-implemented`. (SEC-27 · DEV)
- [ ] Keep Phase 1 drawer-kick-free and **prove the injection case instead**: assert in the W3 print tests that
      a note containing `0x1B 0x70` prints as inert glyphs and never reaches the printer as control bytes. The
      drawer is wired to the printer's own pulse, so the risk is injection, not an emit site. Gate any future
      kick to the settle path only. (SEC-27 · DEV)
- [ ] ★ Bind the LAN KDS server to the POS interface, not `0.0.0.0`, and require a bearer token minted at pairing and rotated on each shell start. `lan-kds-server.ts:26` is still `TODO(W4)`. (SEC-31 · DEV)
- [ ] Restrict the printer socket to the shell's host, and never expose the print endpoint through the KDS server. (SEC-31 · DEV)
- [ ] Resolve the self-unlock PIN gap: PINs exist only for `manager`/`owner` today, so a cashier has nothing to unlock with. Either lock returns to the staff picker with the account password, or add a **separate** unlock PIN in a separate column with a verification function that can never satisfy an approval RPC. Do not reuse the manager PIN. (SEC-34 · FE2)

---

## 10 · Phase 6 — public web and the QR surface

> `apps/web` currently ships **zero security headers**, has **no `middleware.ts`**, and has **no lint script**.
> This is the least-defended surface in the system and the only one with no login.

- [ ] ★ `[FREEZE]` Ship the production headers: HSTS with `includeSubDomains`, `X-Content-Type-Options: nosniff`, `frame-ancestors 'none'`, and a nonce-based CSP with no `unsafe-inline` for scripts. `next.config.ts` has no `headers()` block at all. (SEC-25 · FE2)
- [ ] ★ Exchange the table token for a cookie on first load and `history.replaceState` the path. `apps/web/proxy.ts`
      (Next 16's `proxy` convention) **rewrites** rather than redirects at `:50-53`, deliberately keeping the printed
      token verbatim in the address bar; there is no cookie exchange and no `replaceState` anywhere in `apps/web`.
      That is a design decision that contradicts Security Layer §6.3 — settle it explicitly. (SEC-25 · FE2)
- [ ] Set `Referrer-Policy: no-referrer` on `/t/*` specifically. The table token is a bearer credential in a URL path. (SEC-25 · FE2)
- [ ] Stop the token reaching analytics: rewrite `$current_url` for `/t/*`, session recording off site-wide. **See D4 — the cleanest fix is removing PostHog from the guest web app, which is also what the SOW says.** (SEC-25 · FE2)
- [ ] Confirm cookies are `HttpOnly; Secure; SameSite=Lax`. (SEC-25 · FE2)
- [ ] Add the **cafe abuse limits** Security Layer §6.2 asks for and the repo does not have: orders per minute and items per order per table session, a total open-tab value above which the till asks staff to confirm, and a per-IP limit. The only rate limiting in the database today is the PIN lockout; the waiter-call cooldown covers the bell and nothing else. (SEC-25 · FE2+DEV)
- [ ] Put rate limiting and bot protection in front of the public site and the auth endpoints. (SEC-25 · FE2)
- [ ] Add e2e cases asserting each header, no inline script without a nonce, and no token substring in the captured analytics payload. (SEC-25 · FE2)
- [ ] Narrow the Next image optimizer allowlist. `next.config.ts` allows `{ hostname: '*.supabase.co' }`, which makes the optimizer a proxy for any Supabase project. Pin the project ref. **Not in v1.0.** (SEC-25 · FE2)
- [ ] Decide the PWA posture. `/manifest.webmanifest` ships today with no service worker. If one is added it must never cache `/t/[token]`. Write the rule now. **Not in v1.0.** (SEC-25 · FE2)
- [ ] Guard Vercel preview deployments — `[SOW]` Module 6 promises "preview deployment per change", and every preview points at the one live database. Password-protect previews or point them at a seeded project. **Not in v1.0.** (SEC-25 · FE2)
- [ ] ★ Add `table_token_secret_prev` and accept a signature valid under either secret while minting only with the current one, writing an audit row when the previous key is used. Today rotating the secret kills every printed card at once, which collides with "all keys rotated at handover". *(Per-table rotation already works — see §02.)* (SEC-26 · DEV)
- [ ] Test it: a token minted under the previous secret verifies while `prev` is set and fails once cleared; a third random secret always fails. (SEC-26 · DEV)

---

## 11 · Phase 7 — privacy, logging and retention

- [ ] `[SOW]` Install an error tracker in all three clients with a named scrub configuration: no default PII; drop or redact anything matching an Iraqi mobile shape, a PIN shape, `authorization`, `apikey`, `p_pin`, refresh and access tokens, and any `/t/` path segment. Console breadcrumbs off, replay off. **None installed today — see D2.** (SEC-36 · DEV)
- [ ] `[SOW]` Add uptime monitoring on the booking and ordering paths — the second half of the same contract line. (SEC-36 · DEV)
- [ ] Prove the scrubbing: put a test phone number into a scratch guest name, force an exception on that screen, search the tracker for it, expect zero hits. Repeat for a fake PIN. (SEC-36 · SEC)
- [ ] Write the retention schedule the standard never states: analytics, error tracker, Telegram history and the LLM provider all need a period. The audit log is forever **by design** — that one is correct. (SEC-19 · SEC)
- [ ] Implement guest anonymisation after the agreed inactivity window (Security Layer §5.2 proposes 24 months) and write the window into the privacy notice. (SEC-19 · SEC)

---

## 12 · Phase 8 — verification and drills

Nothing here is a code change. It is the evidence the sign-off rests on.

- [ ] `[FREEZE]` Proxy test against the mobile app: book a past slot, book beyond the horizon, cancel someone else's booking, read another guest's profile. All four must fail server-side; screenshot each. (SEC-12 · SEC)
- [ ] `[FREEZE]` `[SOW]` Backup drill. **With PITR:** restore to a timestamp into a temporary project, open the operator app against it, confirm today's bookings and the audit log, record the measured recovery time, delete the temporary project. **Without PITR:** the SOW is in breach — see D3. (SEC-38 · DEV)
- [ ] `[SOW]` Load test at twice peak — **D6**. (SEC-38 · DEV)
- [ ] Set up the **off-platform backup copy**: a weekly encrypted dump stored in an account that is *not* the Supabase account, so a compromised or suspended account is not also the loss of the backups. Nothing like this exists today. (SEC-38 · DEV)
- [ ] Write the recovery targets down and agree them with the client — how much data may be lost (target under 5 minutes via PITR) and how long recovery takes (target under 2 hours). The client should hear a number, not "we have backups". (SEC-38 · SEC)
- [ ] ★ `[FREEZE]` Power-cut drill, **twice**, on the venue's real PC: pull the network cable mid-order, trade ten minutes across six tickets and two court arrivals, pull the power cable, restart, reconcile against a paper tally. (SEC-39 · SEC)
- [ ] `[FREEZE]` Switching test inside the same run: staff A works four tickets, locks, staff B works four, including offline. Every replayed row must name the person who typed it, not the person who reconnected. (SEC-39 · SEC)
- [ ] ★ `[FREEZE]` Leaver test on real machines: disable an account, confirm sessions end everywhere, record the elapsed time. *(The DB half already holds — this proves the session half.)* (SEC-35 · SEC)
- [ ] ★ `[FREEZE]` From a phone on the guest wifi, attempt to reach the KDS port and the printer port. Both must fail, on the venue's real network. (SEC-31 · SEC)
- [ ] `[FREEZE]` Re-run the artifact secret grep on the final release builds of all three clients. (SEC-24 · SEC)
- [ ] `[FREEZE]` Demonstrate table-token rotation end to end: rotate one table, print the new card, confirm the old card is refused and the new one works. (SEC-26 · SEC)

---

## 13 · Phase 9 — handover and continuity

- [ ] Execute the account ownership decision from Phase 0. If the Supabase project moves, export `table_token_secret` to a sealed envelope **first** — otherwise every printed card in the venue dies on handover day. `db-migrate.yml` already carries this warning in its production block. (SEC-42 · SEC)
- [ ] Write the rotation runbook: for each of the anon key, service key, Telegram bot token, LLM API key, PostHog key, EAS signing key and `table_token_secret` — where it lives, who rotates it, what breaks, in what order. (SEC-42 · SEC)
- [ ] `[FREEZE]` Rotate every key at handover and verify the venue still trades — specifically, scan one QR card after the rotation. (SEC-42 · SEC)
- [ ] Remove supplier members from every client organisation; set the quarterly access review. (SEC-42 · SEC)
- [ ] Write the incident runbook: who to call, how to disable a staff account immediately, how to enter degraded mode deliberately, what not to delete, how to pull the audit log for a date range. (SEC-43 · SEC)
- [ ] Write the **stolen-PC procedure** into the handover pack: disable the staff accounts, rotate the table tokens, tell us. The venue PC holds the offline queue and the `pin_cache`. (SEC-41 · SEC)
- [ ] Record the **kitchen screen device policy**: fixed-purpose, locked to the app, no general browsing. (SEC-41 · CLIENT)
- [ ] Assemble the handover pack: account inventory with revocation steps, rotation runbook, processor register, PC policy confirmation, drill records, and the signed accepted-risk register including the D1 one-project residual risk. (SEC-43 · SEC)
- [ ] Standing rule after handover: every new feature ships with its authorization check and its negative test. No exceptions. (SEC-43 · SEC)

---

## 14 · ★ Hard gates — what we do not ship without

Re-scored against the repository on 2026-08-30. **Seven of v1.0's twenty-one are already satisfied.**

| # | Gate | Status | How *you* confirm it, without reading code |
|---|---|---|---|
| 01 | No service key in any shipped bundle (SEC-24) | **OPEN** | Run the artifact grep yourself on the release builds. A hit is a stop-ship. |
| 02 | `gitleaks` over full history is clean (SEC-24) | **OPEN** | Run it. It prints findings or nothing. |
| 03 | MFA on every production account (SEC-40) | **OPEN** | Open each provider's settings and look. |
| 04 | Hosted database is at the migration head (SEC-03) | **OPEN** | The nightly `db diff --linked` job is green. |
| 05 | Migration safety procedure in place (SEC-02) | **OPEN** | Open a test PR with a `DROP COLUMN` and watch CI refuse it. |
| 06 | Anonymous sessions cannot hold courts (SEC-07) | ✅ **0048/C1** | Ask for the `booking-hardening` test. It exists and is green. |
| 07 | Idempotency keys scoped to the caller (SEC-08) | ✅ **0048/H3 + 0049** | Ask for the cross-caller test. `IDEMPOTENCY_CONFLICT`. |
| 08 | Move and extend re-price (SEC-09) | ✅ **0048/H1+H2** | Ask for the create-vs-move price equality test. |
| 09 | `rate_rules` constrained, pricing agrees (SEC-10) | **PARTIAL** | `start < end` exists. Positive price, minute bounds and the golden fixture do not. |
| 10 | Future bookings cannot be resold (SEC-11) | **OPEN** | Ask for the test marking a reservation three days out and being refused. |
| 11 | Second-pass authz sweep green (SEC-12) | **OPEN** | It is a CI job. Green or red. |
| 12 | Account deletion works end to end (SEC-15/16) | **OPEN** | Delete your own test account on a real phone, then try to sign in. **Store blocker.** |
| 13 | Privacy notice and web deletion page live (SEC-17) | **OPEN** | Open both URLs in Arabic and English. **Store blocker.** |
| 14 | Password reset works on a real device (SEC-18) | **OPEN** | Do it yourself from a cold install. **Store blocker.** |
| 15 | Auth hardening on (SEC-05) | **OPEN** — read 2026-09-01: captcha OFF, leaked-password protection OFF, `localhost` + `exp://` still in the redirect list | Dashboard toggles — look at them. |
| 16 | Production headers and CSP live (SEC-25) | **OPEN** | `curl -I https://<domain>` and read the headers. Today there are none. |
| 17 | Table token is not a bearer credential in a URL (SEC-25) | **OPEN** | Scan a QR and look at the address bar. **New gate.** |
| 18 | Table-token secret rotatable without reprinting (SEC-26) | **OPEN** | Ask for the test where a token signed with the previous secret still verifies. |
| 19 | Guest text cannot reach the printer as commands (SEC-27) | **OPEN** | Order a note containing a drawer-kick sequence; watch the drawer stay shut. |
| 20 | KDS and printer unreachable from guest wifi (SEC-31) | **OPEN** | Stand in the cafe with your phone and try. |
| 21 | Degraded mode enforced server-side (SEC-33) | ✅ **0008 + 0048:309** | Ask for `degraded.test.ts`. Green. |
| 22 | Queue survives a power cut, or an honest decision not to ship it (SEC-32) | **OPEN** | The power-cut drill passes twice — or degraded writing is switched off and the venue is told. A till that promises to trade offline and does not is worse than one that never claimed to. |
| 23 | Disabling a staff account ends their sessions (SEC-35) | **PARTIAL** | DB half done (`0003:50`). Disable a test account and watch a live session die. |
| 24 | The SOW deviations are settled in writing (D1–D7) | **OPEN** | Read the signed variation. **New gate.** |
| 25 | Social provider audiences exact, `host.exp.Exponent` gone, "Skip nonce check" OFF (SEC-05) | **PARTIAL** — 2026-09-01: audiences exact and the Google toggle OFF (Prompt C); `host.exp.Exponent` still listed on purpose until release week | Open Supabase → Auth → Providers and read the two Client-ID fields and the Google toggle. **New gate 2026-09-01** — social sign-in is a vendor addition; this gate protects the whole auth surface, not just the feature. |

**Eighteen of these you can verify entirely by yourself, with no code reading:** 1, 2, 3, 5, 6, 7, 8, 10, 12, 13, 14, 15, 16, 17, 19, 20, 24, 25. That is the point of the third column — pick the evidence that does not need your expertise.

---

## 15 · `[CI]` — checks to automate, then never tick by hand again

The repo already has the pattern — `check:authz`, `check:locks`, `check:safeupdate` — so this extends
something that works. Land these in the first week and thirteen boxes become permanently someone else's problem.

> **Four of these go red the moment they land, and that is correct — but it means you cannot land them all at
> once.** Fix first, then fit the gate, or `main` sits red and people learn to ignore it:
>
> | Gate | Goes red because | Land it after |
> |---|---|---|
> | `check:electron` | `sandbox: false` today | the preload bundle + `sandbox: true` fix (§09) |
> | Authz coverage counter | 50 of 121 RPCs covered | coverage is raised, or set the floor at 50 and ratchet up |
> | Web header e2e assertions | no headers ship today | the `headers()` block (§10) |
> | `check:migrations` | 11 legacy constraint sites, 48 non-concurrent indexes | never — scope it to changed files, as the item says |
>
> The rest pass or fail honestly on the current repo and can land immediately.

- [ ] `gitleaks` over full history (SEC-24)
- [ ] Built-artifact secret grep on all three clients (SEC-24)
- [ ] `pnpm audit --audit-level=high` + Dependabot (SEC-24)
- [ ] `NEXT_PUBLIC_` / `EXPO_PUBLIC_` naming check — no `SECRET|KEY|TOKEN|PIN|HMAC` (SEC-24)
- [ ] **Lint rule: no `service_role` in client paths** — Security Layer §11.3 lists this as a merge-blocking gate and it does not exist. There is no root eslint config, and `apps/web` has no lint script at all. (SEC-24)
- [ ] `check:migrations` — destructive DDL needs an explicit acceptance line (SEC-02)
- [ ] Nightly `supabase db diff --linked`, red when the hosted project drifts (SEC-03)
- [ ] Zero views without `security_invoker` (SEC-04)
- [ ] Every definer function has a pinned `search_path` (SEC-04)
- [ ] RPC registry — a function in `pg_proc` that is not in the allowlist file fails the build (SEC-12)
- [ ] Authz sweep coverage counter — 49 of ~86 today; fail when it regresses (SEC-12)
- [ ] `check:electron` — window hardening cannot regress (SEC-30)
- [ ] Guest-field allowlist drift test (SEC-20)
- [ ] Seed and fixture files contain no real-format phone numbers (SEC-37)
- [ ] A **pull-request template** carrying the Security Layer §11.4 checklist — new table has RLS with
      per-operation policies and tests; new guest field is in the allowlist and the privacy notice;
      money/stock/booking writes carry an audit row in the same transaction; nothing logged that could hold a
      phone, token or PIN; no client-supplied price, total, role, venue or table trusted; and no field that
      could hold a card number. **There is no PR template in `.github/` today.** (SEC-43 · SEC)
- [ ] Web security-header e2e assertions (SEC-25)

---

## 16 · `[FREEZE]` — what to re-run at the end, and only this

Re-running the whole checklist at the end is wasted effort. These are the items whose answer depends on the
final artifact.

**Before store submission · 2026-09-16 · mobile only · half a day**
- [ ] Artifact secret grep on the exact build being submitted (SEC-24)
- [ ] Proxy test: past slot, beyond horizon, cancel another's booking, read another's profile — all four fail server-side, screenshot each (SEC-12)
- [ ] Account deletion on the submission build, on both platforms (SEC-16)
- [ ] Password reset and email verification on the submission build (SEC-18)
- [ ] Store data-safety forms match the allowlist test's output, not memory (SEC-20)
- [ ] Privacy and deletion URLs live and reachable on the real domain (SEC-17)

**Before handover · 2026-10-04 · one day**
- [ ] Artifact secret grep on the final web and desktop builds (SEC-24)
- [ ] Headers and CSP against the production domain (SEC-25)
- [ ] Power-cut drill, twice, on the venue's own PC, with the switching test inside it (SEC-39)
- [ ] Backup restore drill, dated and timed (SEC-38)
- [ ] Leaver test on real machines, elapsed time recorded (SEC-35)
- [ ] KDS and printer unreachable from the guest network, on the venue's real network (SEC-31)
- [ ] Rotate every key, then scan one QR card to prove the venue still trades (SEC-42)
- [ ] MFA and member list re-checked after everyone who joined or left (SEC-40)
- [ ] Security Advisor clean on the hosted project (SEC-04)

If either pass turns up something new, that is a signal the weekly rhythm broke down — the freeze pass is
meant to confirm, not to discover.

---

## 17 · Weekly rhythm

**Two questions, every week.** Tie it to the demo you already run: which boxes closed, and which are still
unowned. Do not save this for the end — left to the end it is a wall, and walls get climbed by ticking
rather than doing.

**The standard for a tick.** A named person, a date, and — for anything in Phase 2 or Phase 3 — the test
that goes red when the fix is removed. "Done" is not a tick.

**And one more, added after v1.0.** Before you spend a day on an item, re-check that its premise is still
true. This document was wrong about seven hard gates because nobody did that.

---

## 18 · How to re-verify this document

**This document has a short half-life and you should assume it is stale.** v1.0 was two days old and wrong
about seven hard gates. The `[CI]` items in §15 are the permanent fix — a job re-answers its own question on
every pull request — but until they all land, re-run these from the repo root before trusting §02.

```sh
cd packages/db/supabase/migrations

# RLS on every table — the first output must be EMPTY
grep -rhoiE "create table +(if not exists +)?[a-z_.]+" . \
  | sed -E 's/.*(exists +|table +)//I; s/^(app|public)\.//' | tr 'A-Z' 'a-z' | sort -u > /tmp/t
grep -rhoiE "alter table +[a-z_.]+ +enable row level security" . \
  | sed -E 's/alter table +//I; s/ +enable row level security//I; s/^(app|public)\.//' \
  | tr 'A-Z' 'a-z' | sort -u > /tmp/r
comm -23 /tmp/t /tmp/r                                        # tables with no RLS -> expect none

# definer functions without a pinned search_path — the two numbers must match
# (one comment line in 0034 says "security definer" in prose; ignore a diff of 1)
cat *.sql | grep -c "security definer"
cat *.sql | grep -c "security definer set search_path"

# views vs security_invoker — 4 are deliberate: venue_settings_public,
# cafe_settings_public, menu_item_availability, court_availability
cat *.sql | grep -ciE "create( or replace)? view"
cat *.sql | grep -c "security_invoker"

# lock-taking DDL the check:migrations guard must catch
grep -rnE "add +constraint" *.sql | grep -vic "not valid"     # 11 at v2.0
cat *.sql | grep -ciE "create +(unique +)?index"              # 48 at v2.0
cat *.sql | grep -ciE "create +(unique +)?index +concurrently" #  0 at v2.0

cd ../../../..

# authz coverage — granted app RPCs vs rules in the matrix (121 vs 50 at v2.0)
grep -rhoE "grant execute on function app\.[a-z_]+" packages/db/supabase/migrations | sort -u | wc -l
grep -c "kind: 'rpc'" packages/db/tests/rls-matrix.ts

# gates that should exist and did not at v2.0 — every line should eventually print something
grep -ril gitleaks . --exclude-dir=node_modules | head
ls .github/CODEOWNERS .github/PULL_REQUEST_TEMPLATE.md .github/dependabot.yml 2>/dev/null
grep -n "headers()" apps/web/next.config.ts
grep -rn "service_role" packages/config apps/*/eslint.config.mjs 2>/dev/null
```

**The rule this document exists to enforce on itself:** before spending a day on any item, re-check that its
premise is still true. Every claim in §02 carries a `file:line` — open it. A claim you did not re-check is a
claim from a document that was wrong seven times before.

---

*Kagu Web Studio · Touch Padel Phase 1 · v2.0 · 2026-08-30*
