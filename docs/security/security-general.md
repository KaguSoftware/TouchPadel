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

| #   | SOW says                                                                                        | Reality                                                                                                                                                                                                                                                                | Action                                                                                                                                                                                                                                            |
| --- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Module 1 INCLUDED: "**Staging and production environments**"                                    | One Supabase project, which is the client's live database. `.github/workflows/db-migrate.yml` names its job `staging` while its own comment says "the linked Supabase project is the CLIENT'S long-term production database".                                          | Signed variation, or build staging. A risk note is not enough — this is a delivered-scope gap. (SEC-37 · SEC)                                                                                                                                     |
| D2  | Module 1 INCLUDED: "**Error tracking and uptime monitoring** on the booking and ordering paths" | Neither exists in any client.                                                                                                                                                                                                                                          | Build both, or vary the contract. (SEC-36 · DEV)                                                                                                                                                                                                  |
| D3  | Module 1 INCLUDED: "Automated daily backups with **point-in-time recovery**"                    | PITR is treated as an open question.                                                                                                                                                                                                                                   | PITR is promised. Buy the tier or get the variation signed. (SEC-38 · SEC)                                                                                                                                                                        |
| D4  | Module 6 NOT INCLUDED: "**Analytics**, marketing tags or advertising pixels"                    | PostHog is mounted on the guest cafe web app (`apps/web/src/lib/analytics/AnalyticsProvider.tsx`) — the exact surface carrying a table token in the URL.                                                                                                               | Remove it, or get a signed variation **and** complete SEC-25. (SEC-19 · SEC)                                                                                                                                                                      |
| D5  | Module 1 NOT INCLUDED: "**Phone / SMS one-time-code login**"                                    | Security Layer v1.1 §5.2 recommends phone + OTP. **2026-09-05:** a DORMANT scaffold exists (migration 0069, `functions/send-sms-otp`, flag-gated mobile screens; `docs/design/phone-otp-2026-09-05.md`) — three switches, all off; no client role can reach any of it. | **Settled by contract: email + password.** SEC-22 stays closed until the owner's written decision D4a–D4d activates the scaffold (`docs/client/phone-otp-activation.md`); the SEC checklist for that day is in the design note §5. (SEC-22 · SEC) |
| D6  | Track A week 4: "**load test at twice peak**"                                                   | Not scheduled, not in v1.0.                                                                                                                                                                                                                                            | Schedule it. (SEC-38 · DEV)                                                                                                                                                                                                                       |
| D7  | Module 7: "the day **cannot be closed while unsynced items remain**"                            | Not verified; no box in v1.0.                                                                                                                                                                                                                                          | Add the assertion and a test. (SEC-32 · DEV)                                                                                                                                                                                                      |

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
  v1.0 listed this as open. _Caveat: scoped to role `postgres`; an object created by another role would not inherit._
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
  `cafe_tables.token_version` (`0014:24`). What is missing is _secret_ rotation (SEC-26), not table rotation.
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

- ⚠ **The RPC registry gate is load-bearing, and it has now fired in anger.** On 2026-09-06
  `check:rpc-registry` was **red on branch `kemal`**: migration 0070 (`send_test_push`, 2026-09-06)
  granted execute to `authenticated` without an entry in `packages/db/fixtures/rpc-allowlist.json`,
  and the coverage ratio had regressed 60/127 → 60/128. This is exactly the failure the gate was built
  for in Layer 1 — under the previous hardcoded-`Set` design the RPC would have shipped in no list at
  all, unguarded by default, and nothing would have said so. Closed the same day: classified
  `publicByDesign` with its reason (it takes no arguments, so it can only ever target `auth.uid()`),
  covered by a rule in `tests/rls-matrix.ts`, floor ratcheted to 61/128.
- **`db-migrate.yml` is armed and gated.** Required reviewers were enabled on the `staging` GitHub
  Environment **first**, then the secrets were added (`HANDOFF.md:542-546`, 2026-08-27). ⚠ _But the gate is a
  GitHub UI setting with no repo artifact — it can be edited or deleted leaving no git trace, and the job it
  guards pushes to the client's production database. Re-verify it, do not assume it._

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

_(Full detail and ordering in `security-layer-1.md`. Summary here.)_

- [ ] ★ Enable MFA org-wide: GitHub, Supabase, Vercel, PostHog, Expo, Apple, Google. Recovery codes sealed to the client's owner, not a Kagu inbox. **2026-09-01:** the Expo/EAS, Apple Developer and Google Cloud accounts that social sign-in and the store release need do not exist yet (`API.md` §8 placeholders); each falls under this item the day it is created, Google Play included. (SEC-40 · CLIENT+SEC)
- [ ] Add `.github/CODEOWNERS` routing `packages/db/supabase/migrations/` and `.github/workflows/db-migrate.yml` to the technical lead; enable "Require review from Code Owners" on `main`. **Confirmed missing.** (SEC-01 · SEC)
- [ ] Add required reviewers to the `staging` GitHub Environment **before** the deploy secrets go in — without them the gate in `db-migrate.yml` is a no-op. (SEC-02 · DEV)
- [x] ★ `[CI]` `gitleaks` over full history — DONE, DEV, 2026-09-04. `.gitleaks.toml` + the `secrets` job in `ci.yml` (fetch-depth 0, pinned 8.30.1 binary). 123 commits, 10 findings, **zero real leaks**, all allowlisted by exact value. _(Layer 1 Block 2 · Secrets.)_ (SEC-24 · DEV)
- [x] Rotate anything gitleaks finds — **nothing to rotate**, DEV, 2026-09-04. The hosted `service_role` key lives only in untracked `.env.local`; `git log --all -S` over the full object graph confirms it was never committed. _(Layer 1 Block 2.)_ (SEC-24 · DEV)
- [x] ★ `[CI]` Built-artifact secret grep — DONE, DEV, 2026-09-04. `scripts/security/check-artifact-secrets.mjs`, wired into the three jobs that already build each client. Fails on a JWT whose **decoded** payload claims `service_role`, any `sb_secret_*`, or a real-project token with an unexpected role — the bare-word grep in this box fires 168 times on a clean tree and is not implementable as written. **Also fails when nothing was built.** _(Layer 1 Block 2.)_ `[FREEZE]` still applies to the final release builds — §16. (SEC-24 · DEV)
- [ ] ★ Supabase → Auth → Attack Protection: CAPTCHA on, token passed on `signInAnonymously`. **Nothing
      captcha-related exists in the repo** (0 hits); the only throttle today is `[auth.rate_limit]
    anonymous_users = 300` (`config.toml:74`), flagged in-file as "revisit before production handover".
      ⚠ **Anonymous sign-in is load-bearing for the cafe** — `apps/web/src/hooks/cafe/useTableSession.ts:57`
      is the one production call site and every table session boots through it. Do **not** disable anonymous
      sign-in; add the CAPTCHA token to that call. 0048's `ACCOUNT_REQUIRED` is scoped to `app.hold_slot`
      alone, so court booking needs a real account while table sessions do not. (SEC-05 · DEV)
- [ ] ★ Replace the auth redirect allowlist with exact production URLs — no wildcards, no `localhost`, no `exp://*` in the hosted project. (SEC-05 · DEV) **Verified still open 2026-09-01 (Prompt C, report-only):** hosted list = `https://localhost:3000`, `touchpadel://verify-email`, `touchpadel://reset-password`, `exp://192.168.1.108:8081/--/*` — the last is a wildcard LAN entry for Expo Go email-link tests; removal + Site URL fix are scheduled for release week (`docs/client/social-auth-setup-2026-09-01.md`, Prompt D Task 4).
- [ ] ★ Leaked-password protection on; JWT expiry 30 minutes with refresh rotation and reuse detection. (SEC-05, SEC-35 · DEV) **Verified 2026-09-01: leaked-password protection OFF and CAPTCHA OFF while anonymous sign-ins are ON** — the MAU-inflation combination Supabase's own inline warning names.
- [ ] Set Supabase member roles: SEC and DEV Owner/Admin; FE1 and FE2 Developer with **no SQL Editor access**. With one project, access control _is_ environment separation. (SEC-37 · SEC)
- [ ] Ask the client for the domain today and delegate DNS. Blocks the privacy URL, the deletion URL, auth redirects, HSTS and QR cards. (SEC-06 · CLIENT)
- [ ] Ask the client for the PC policy in writing: BitLocker, OS auto-updates, 5-minute screen lock, no shared Windows admin account, **guest wifi on a separate VLAN from the POS**. (SEC-41 · CLIENT)
- [ ] Ask the client to decide account ownership at handover. Longest-lead item. (SEC-42 · CLIENT)
- [ ] Confirm the Supabase plan tier and whether PITR is available — **note D3: the SOW promises it.** (SEC-38 · SEC)
- [x] ~~Decide guest sign-in~~ — **settled by the SOW: email + password. Phone/OTP is out of scope.** (SEC-22) 2026-09-05: a dormant phone-OTP scaffold exists behind three off switches; activation needs the owner's written D4a–D4d (D5 row above).

---

## 05 · Phase 1 — make the one live database safe to work on

- [x] ★ **Live-migration procedure** — DONE, DEV, 2026-09-04. Not a document: a rule in `check:migrations` requiring `set lock_timeout = '3s'; set statement_timeout = '60s';` at the top of every NEW migration, with `lock_timeout = 0` rejected. Written up in `layer-1-rules-and-decisions.md` §6. _(Layer 1 Block 3.)_ (SEC-02 · DEV)
- [x] ★ `[CI]` **`check:migrations`, scoped to lock-taking DDL** — DONE, DEV, 2026-09-04; **executed 2026-09-07**. Independently reproduced this section's audit (57 non-CONCURRENTLY indexes, 11 `add constraint` without `NOT VALID`, `0039:71`). Scoped to files changed against the merge base, exactly as this box demands, with `MIGRATION-RISK-ACCEPTED:` as the escape hatch. All four behaviours negative-tested. _(Layer 1 Block 2.)_ (SEC-02 · DEV)
- [x] **Ledger dump + printed `db diff`** — DONE, DEV, 2026-09-04. Both in `db-migrate.yml`; the diff goes to the **job summary**, where the person approving the environment gate actually looks. `audit_log` / `stock_ledger` / `payments` retained 30 days. Evidence, not a restore path. _(Layer 1 Block 2.)_ (SEC-02 · DEV)
- [x] **`timeout-minutes: 15` on `db-migrate`** — DONE, DEV, 2026-09-04. GitHub's default is 360 minutes. This is the outer bound; `lock_timeout = '3s'` is the real control. _(Layer 1 Block 3.)_ (SEC-02 · DEV)
- [ ] `[FREEZE]` Re-verify that required reviewers are still enabled on the `staging` GitHub Environment. It is an out-of-repo setting with no git trace, and it is the only thing between a merge to `main` and the client's production database. (SEC-02 · SEC)
- [ ] ★ Bring the hosted project to the local migration head through that gated procedure. This has already
      bitten once: `db-migrate.yml` silently skipped from day 1 for want of secrets, and **the hosted DB drifted
      eight migrations behind** before anyone noticed (`HANDOFF.md:544-545`). Every green-gate claim about a
      drifted database is a claim about a database the venue does not use. (SEC-03 · DEV)
- [x] ★ `[CI]` **Nightly `supabase db diff --linked`** — DONE, DEV, 2026-09-04. `.github/workflows/db-drift.yml`, 02:00 Asia/Baghdad. Two checks: `migration list` catches the hosted project being BEHIND, a non-empty `db diff` catches hand-editing. Missing secrets raise a warning annotation, not a silent pass. _(Layer 1 Block 2.)_ (SEC-03 · DEV)
- [ ] Re-run the DB suite against the hosted project through a restricted role, never `service_role` from a laptop. (SEC-03 · DEV)
- [x] `[CI]` **Every view is `security_invoker = on`** — DONE, DEV; **VERIFIED 2026-09-07, first execution**: 12 views · 8 invoker · 4 owner-rights, exactly the named allowlist. Any NEW invoker-off view fails. _(Layer 1 Block 2.)_ (SEC-04 · DEV)
- [x] `[CI]` **Every definer function pins `search_path`** — DONE, DEV; **VERIFIED 2026-09-07**: **215 of 215**, zero offenders. _(Layer 1 Block 2.)_ (SEC-04 · DEV)
- [x] **`btree_gist` moved into `extensions`** — DONE, DEV; **EXECUTED 2026-09-07 — and the migration was BROKEN.** Its post-check named `app.reservations`, which does not exist (the table is in `public`), so it raised 42P01 and stopped the stack booting. It had never run anywhere and would have failed identically on the hosted project. Fixed; re-run clean with the reservations exclusion constraint verified intact and the concurrency suite green. _(Layer 1 Block 3.)_ (SEC-04 · DEV)
- [~] `[FREEZE]` Run the dashboard Security Advisor; file the result. **PARTIAL:** run by a colleague 2026-09-06 and waived in `security-advisor-waiver-2026-09-06.md` — 4 `security_definer_view`, all four the audited projections, each re-verified against its base table. **Not closed:** `extension_in_public` did not appear, and 0069 had never successfully run anywhere, so it cannot have been fixed — the list was almost certainly filtered by severity. Re-run unfiltered. Expect exactly two known findings: `extension_in_public` for `btree_gist` (fix it) and `security_definer_view` ×4 (accepted by design — record the waiver). "Clean" means every other lint is zero. (SEC-04 · SEC)
- [x] `[CI]` **No real-format Iraqi phone numbers in seeds or fixtures** — DONE, DEV, 2026-09-04. `scripts/security/check-data-hygiene.mjs` DEFINES the reserved convention `+964 7XX 000000N` (Iraq has no ITU documentation range). Green. _(Layer 1 Block 2.)_ (SEC-37 · DEV)
- [x] **Production rows read only through a masked, audited definer function** — DONE, SEC, 2026-09-04. `layer-1-rules-and-decisions.md` §1, with §2 (who may reach the hosted project) as the control that enforces it — a read cannot be caught after the fact, so access is limited instead. DDL through the SQL Editor IS caught, by the nightly drift job. _(Layer 1 Block 3.)_ (SEC-37 · SEC)
- [ ] ★ Write down **the rule that has no exception** (Security Layer §1.1) and give it a check: never add a column, form field, note field or log line that could hold a card number. **Nothing in the repo states or enforces this today.** Add it to the PR checklist and to the guest-field allowlist test. (SEC-20 · SEC)
- [ ] Restrict direct database connections on the hosted project so clients reach data only through the API and the pooler. No client opens a raw Postgres socket today, but the port posture is a dashboard setting nobody has checked. (SEC-04 · DEV)
- [x] **`client-data/` intake rule** — DONE, DEV, 2026-09-04. Written up (§3 of the rules doc) and **enforced** by `check-data-hygiene.mjs`. ⚠ This section said "currently clean"; it was not — the client's own hosting-account email was already in both packs (`634462a`, `e4f2acc`). Business contact, not guest data, grandfathered explicitly. **Raise it with the client so the acceptance is theirs.** _(Layer 1 Block 3.)_ (SEC-37 · DEV)
- [~] **Record the residual risk in writing and have the client sign it** — **WRITTEN, AWAITING SIGNATURE.** `layer-1-rules-and-decisions.md` §5: the risk stated plainly, the six controls now reducing it and what each cannot catch, and a signature block. No control removes it — only a second project does, which is D1. Original text: — with one project, a bad migration reaches live guest data with no rehearsal. See **D1**. (SEC-37 · SEC)

---

## 06 · Phase 2 — booking and money integrity

> **Most of this phase closed in migrations 0048 and 0049.** What follows is what genuinely remains.
> See §02 before starting anything here.

> **Status 2026-09-07 — DEV. EXECUTED AND GREEN.** A container runtime was installed (OrbStack), the
> stack was reset from zero, and everything below ran: **594 DB tests across 35 files**, plus
> `check:invariants` · `check:locks` · `check:safeupdate` · `check:authz` — the four catalog-reading
> gates that had never executed on any machine.
>
> **Running it found five things that reading it could not.** Recorded because the point of §17 is
> that a written migration is a claim and a green suite is evidence:
>
> | #   | Found                                                                                                                                                                                                                                                                                                | Where                 |
> | --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
> | 1   | **Migration 0069 was broken and stopped the stack booting.** Its post-check named `app.reservations`; that table is in `public`. `::regclass` raised 42P01, the migration aborted, and 0070/0071 never ran. It had never executed anywhere — it would have failed identically on the hosted project. | `0069`, fixed         |
> | 2   | **0075 silently reverted the SEC-11 hard gate.** Written a day later against the pre-0071 body, it re-issued `app.mark_reservation` through `CREATE OR REPLACE` and dropped the temporal guard. Nothing failed — 0075's own tests mark FUTURE bookings.                                              | `0076`, restored      |
> | 3   | **11 client-callable RPCs shipped unclassified** (0072/0073/0074): the staff-request and marketing families, including owner-only approval and campaign writes.                                                                                                                                      | registered + covered  |
> | 4   | **`ensureTestRateRule` seeded an open-ended all-courts rule**, so "no rule prices this slot" could never be asserted anywhere in the DB suite.                                                                                                                                                       | bounded               |
> | 5   | Three existing fixtures planted holds with `guest_id = null` — a state 0048/C1 abolished and 0071 now refuses at the table.                                                                                                                                                                          | fixtures given owners |
>
> Items 1 and 2 are the ones that mattered: both were invisible to every static check, and both would
> have reached the venue's database.

- [x] **A live hold belongs to an account** — DONE, DEV, **verified 2026-09-07**. 0071 §1.
      Not `guest_id not null` on the table, which would break the desk: a walk-in booking legitimately
      carries `guest_name` with no account (`0008:38`). The property that actually matters is narrower —
      a hold that occupies the exclusion set must be releasable by someone — so the constraint is
      `reservations_live_hold_has_guest`: `kind <> 'hold' or status <> 'pending' or guest_id is not null`.
      An orphan hold blocks the court AND cannot be handed back, because `app.release_hold` (0060) matches
      on `guest_id = auth.uid()`. Scoped to `status = 'pending'` because a hold is only ever pending while
      live (`confirm_booking` rewrites `kind` to `'booking'`, `0008:321`) — expired holds are history and
      constraining them would fail VALIDATE on legacy rows to no purpose. The migration expires live
      orphans first, then adds the constraint `NOT VALID` and validates. (SEC-07 · DEV)
- [x] **Hold reaper widened to orphans** — DONE, DEV, **verified 2026-09-07**. 0071 §1.
      `app.expire_stale_holds` now sweeps `hold_expires_at < now() OR guest_id is null`, same signature and
      same deterministic `order by id ... for update` lock sequence (0042). Orphans are swept on sight
      rather than at TTL because no caller can release them. With the constraint above in place this branch
      is unreachable for NEW rows by design — it is the cleanup path for a database that reaches 0071 late,
      which is the hosted project's actual situation (`security-layer-1.md` Block 3: not at head).
      The test file says explicitly why it does not assert this branch. (SEC-07 · DEV)
- [x] **`rate_rule_prices` constrained** — DONE, DEV, **verified 2026-09-07**. 0071 §2.
      `rate_rule_prices_price_positive` (`price_iqd > 0`) and `rate_rule_prices_duration_bounds`
      (`between 15 and 480`, on a 5-minute grid), both `NOT VALID` then validated. The `iqd` domain is
      `bigint check (value >= 0)` (`0002:26`), so **zero always passed** — and a zero-priced rule is not a
      free court, it is a rule that wins `price_slot` and charges nothing with no error anywhere.
      `app.upsert_rate_rule` re-issued to raise `INVALID_PRICES` / `INVALID_DURATION` **before any write**,
      so a manager sees a sentence rather than a raw 23514 naming the constraint (SEC-36's quiet-error rule)
      — and so a bad entry late in the price map cannot leave the rule half-repriced, since the function
      replaces prices wholesale. Both behaviours have a test. (SEC-10 · DEV)
- [x] ~~Add a GiST exclusion constraint preventing overlapping rules~~ — **dropped, the premise is wrong.**
      Overlap _is_ the pricing model: `rate_rules.priority` (`0007:25`, "highest priority wins on overlap") is
      resolved deterministically by `app.price_slot` (`0007:63`, court-specificity → priority → id) and mirrored
      in `packages/core/src/pricing/rateRules.ts:86-91`. The DB test helper seeds a priority `-100` all-day rule
      that overlaps every fixture rule, so the constraint would make the suite unloadable — and `days_of_week`
      is `int[]`, which has no GiST opclass without `intarray`. _If ambiguity is the worry, add an admin-UI
      warning for two active same-priority rules instead._ (SEC-10 · DEV)
- [x] **Golden pricing fixture** — DONE, DEV, **verified 2026-09-07: 31 green in SQL AND 31 green in TypeScript, same file.**
      `packages/db/fixtures/pricing-golden.json`: 30 cases, read by
      `packages/core/src/pricing/rateRules.golden.test.ts` (31 green against the real `resolveRateRule`)
      and by `packages/db/tests/pricing-golden.test.ts` (31 green against `app.price_slot`). **Both halves
      agree on all 30 cases** — which is the deliverable, not either half alone.
      Covers both boundary minutes of every window (16:59/17:00, 22:59/23:00, 08:59/09:00, 01:59/02:00),
      both sides of midnight on a weekday AND a weekend night — including the day-shift that makes
      Saturday 01:00 the tail of **Friday** (the error the fixture header warns about), pricing by slot
      START not end, court-specificity beating a higher priority, a date-limited promotion, a winning rule
      with no price for the duration falling through, a retired rule ignored, and three cases where nothing
      prices the slot. The DB half asserts the winning **rule id**, not only the money: two rules can carry
      the same price for different reasons, and picking the wrong one is invisible until they diverge.
      ⚠ Landing this exposed a real defect in the shared harness: `ensureTestRateRule` seeded an
      **open-ended all-courts** rule, so "nothing prices this slot" could never be asserted anywhere in the
      DB suite. Now bounded to `valid_from = yesterday`. (SEC-10 · DEV)
- [x] **A price change carries a reason** — DONE, DEV, **verified 2026-09-07**. 0071 §3.
      `move_reservation` and `extend_reservation` raise `REASON_REQUIRED` when the re-priced value differs
      from the stored one and no real reason was given — checked **before** the write, so a refused move
      leaves the booking as it was rather than moved-but-unexplained. `'staff_op'` is the _absence_ of a
      reason spelled as a default, so it is rejected alongside null and blank; the one judgement lives in
      `app.reason_given(text)` so the two paths cannot drift. The audit `after` payload gains
      `price_before` / `price_after` / `price_changed` / `rate_rule_before` / `rate_rule_after` as named
      fields, so "every move that changed a price" is a query rather than a human diffing two row snapshots.
      Deliberately scoped to price CHANGES: a same-price move must not start demanding a justification, or
      the prompt becomes noise staff click through. **No client change was needed** — the operator already
      sends an `OVERRIDE_REASONS` code on every path and already renders `REASON_REQUIRED` as a refusal
      (`deskLogic.ts`). (SEC-09 · DEV)
- [x] ★ **Temporal guard on the desk lifecycle** — DONE, DEV, **verified 2026-09-07**. 0071 §4, restored by 0076 after 0075 reverted it.
      `app.mark_reservation` refuses `no_show` **and** `completed` while `now() < start_at`, with
      `RESERVATION_NOT_STARTED`. Both statuses sit OUTSIDE the exclusion predicate
      (`status in ('pending','confirmed','arrived')`), so either one frees the court the instant it is
      written — the fraud shape is marking a paid Friday booking absent on Tuesday and selling the slot
      twice, and the ledger then shows an unremarkable no-show. `'arrived'` is deliberately **not** guarded:
      it stays inside the predicate, frees nothing, and early check-in is real desk work.
      The check runs against the `FOR UPDATE` read, so it cannot race a concurrent move that shifted
      `start_at`. The legitimate path stays open and is asserted: `app.cancel_reservation` still frees a
      future slot, with a reason and its cancellation window. Mirrored in the UI —
      `allowedMarks(status, startAt)` withholds the two buttons — so the desk never sees a control that
      cannot work, which is how workarounds get invented.
      _Note: **release** needed no work. `app.release_hold` (0060) is already holds-only and owner-only._
      (SEC-11 · DEV)
- [ ] Keep the 0048 regression suite green and named in the handover pack: anonymous refused, concurrent-hold cap, horizon, cross-caller idempotency, create-vs-move price equality. (SEC-07/08/09 · DEV)

---

## 07 · Phase 3 — authorization, sessions and the surfaces the tests cannot see

- [x] ★ `[CI]` ~~**Extend the realistic-argument pass that already exists** — `tests/rls-matrix.ts`,
      8 principals including `prep` — to the RPCs it does not cover~~ — **done 2026-09-07, drop 7.**
      **73/140 → 137/140**, executed against the local stack; floor ratcheted to match. The count this
      line used to carry ("121 names, 71 uncovered") was stale from before drops 5–6.
      `override_price`, `void_after_send`, `merge_tabs`, `split_by_item`, `set_cafe_settings`,
      `set_opening_hours`, the staff-admin family and the whole `analytics_*` family are all now covered
      as all eight principals. No second sweep was built; the gap was closed in the existing one.

      **Three are deliberately NOT covered, and the reason is in the file:**
          `verify_manager_pin` and `verify_own_pin` share one `app.pin_attempts` limiter (5 failures per
          caller per 5 minutes) that `hardening.test.ts` and `idle-lock.test.ts` deliberately drive to
          lockout and assert on — probing them from the matrix as five staff principals would make both
          suites flaky, and both RPCs are already covered there in more depth. `start_count` takes no
          arguments and validates nothing before its INSERT, so manager and owner cannot call it without
          creating a real stock count; it is covered by `stock-admin.test.ts`.

          Every argument was read out of the function body so the call dies on a lookup or a validation
          check **before** anything is written — a NIL foreign key, a blank name, a min>max range, an
          inverted date range, a cooldown below the floor. `override_price`, `void_after_send` and
          `write_off_expired` pass the CORRECT manager PIN on purpose: a wrong one writes a failed row to
          the shared limiter above.
          *(`check-rpc-authz.mjs` passes NULL for every argument by its own design — it is the blunt net, not the
          realistic pass. It stays: it catches a NEW RPC that no one wrote a matrix rule for.)* (SEC-12 · SEC)

- [x] ~~`[CI]` Track the covered/granted ratio as a number and fail the build when it regresses~~ — **already
      done** (reconciled 2026-09-07). `packages/db/fixtures/rpc-coverage-floor.json` holds
      `{covered, total}`; `scripts/check-rpc-registry.mjs` fails on any decrease and only moves up with
      an explicit `--update-floor`. Wired into CI at `.github/workflows/ci.yml:105`. **Observed failing
      correctly**: adding `delete_my_account` (0077) without a rule produced
      `FAIL authorization coverage REGRESSED: 72/140 (was 72/139)`. (SEC-12 · SEC)
- [x] ~~`[CI]` Store the allowlist as data (`packages/db/fixtures/rpc-allowlist.json`) and fail CI when a
      function appears in `pg_proc` and not in the file~~ — **already done** (reconciled 2026-09-07).
      The file carries `publicByDesign` (20, each with its reason) and `guarded` (120); the script fails
      on any granted function missing from it, and `check:authz` then PROVES each `guarded` name actually
      refuses a real anonymous guest. Same CI job. Closes "a new RPC ships unguarded" permanently. (SEC-12 · SEC)
- [x] ~~Raise the PIN minimum to 6 digits and reject repeated and sequential runs~~ — **done 2026-09-07,
      migration 0078.** `^[0-9]{6,12}$` (upper bound generous — a longer PIN is strictly better) plus
      `app.pin_is_weak`, which refuses one repeated digit and straight runs in either direction:
      21 PINs out of a million, and the ones anyone guesses first. Dates, repeated pairs (`121212`) and
      keypad walks are deliberately ALLOWED — a rule that refuses a PIN the user thinks is fine, with no
      way to explain why, trains people to write it down.
      **The seeded dev PINs moved with it.** `111111` / `222222` are both refused by the rule they exist
      to demonstrate; `seed.sql` writes `pin_hash` through `crypt()` directly, so they would have kept
      WORKING while being unsettable through the product. Now `719264` / `380517`, with `DEV_PINS`, the
      e2e specs, the operator's client-side check and the README moved to match.
      8 tests in `pin-strength.test.ts`. (SEC-13 · DEV)
- [ ] Make every PIN failure path return the same code, message and delay; audit every lockout and every manager-cleared lock. (SEC-13 · DEV)
- [ ] Write and test the **quiet-error rule**: no stack traces, no raw Postgres errors, no "user 4412 not found" that confirms which accounts exist — the same generic message whether the account exists or not, with the full error going to the tracker. A guest must never see a constraint name. (SEC-36 · FE1+FE2)
- [x] ~~Audit the private broadcast payloads the KDS and floor view receive: assert prep never receives a
      price, total or guest field~~ — **done 2026-09-07**, `packages/db/scripts/check-broadcast-payloads.mjs`,
      wired into CI. The audit found the payloads already correct: all 11 `realtime.send` call sites use
      explicit `jsonb_build_object` with ids and statuses, no whole rows, no money, no identity. So the
      deliverable is the GATE, not a fix — it reads the catalog, so it sees a payload added by a migration
      nobody reviewed for this, and it fails on a whole-row payload (`to_jsonb(new)`) or any money/identity
      key on the `kds` or `floor` topic. Mutation-tested with a `total_iqd` + `guest_name` payload, which it
      catches with both keys named. (SEC-28 · DEV)
- [x] ~~Confirm `telegram-callback` verifies its secret header and allowlists the chat id~~ — **already done**
      (`index.ts:73-85` constant-time, fails closed when unset; allowlist in the DB at `0039:406-413`, tested).
- [x] ~~Add a per-day call quota and a hard monthly spend cap to the LLM insights function~~ — **done
      2026-09-07, migration 0079.** `venue_settings.llm_daily_request_limit` (200),
      `llm_monthly_cost_cap_micros` (USD 20) and `llm_cost_micros_per_mtok`; an `llm_usage` table;
      `app.llm_begin_request()` as the gate and `app.llm_record_usage()` for the actuals, both
      service-role only. `analytics-insights` calls the gate after the owner check and flushes the tally
      in a `finally`, so a request that burned five calls and timed out on the sixth is still billed —
      a cap that only counts successes is not a cap. Over-quota returns **429**, not 502, and the
      templated fallback still renders. Owner-readable through `app.llm_usage_summary`.
      ⚠ Two corrections to this box: the claim that "every cafe guest holds an `authenticated` JWT, so an
      uncapped model endpoint is an uncapped bill" is **wrong** — `analytics-insights` calls
      `requireStaffRole(..., ['owner'])` on its first line, so a guest never reaches the model. The real
      exposure was that ONE request fans out to SIX model calls and nothing counted a token. And
      `llm_cost_micros_per_mtok` is an **estimate**: nobody here can verify Groq's price list, so the day
      quota is the control that actually bites until somebody sets it. 9 tests. (SEC-29 · DEV)
- [ ] Treat retrieved text as data before it enters a prompt: strip control and bidi characters, delimit
      it, constrain the response. (SEC-29 · DEV)
      ⚠ **The vector this box names does not exist.** Traced 2026-09-07: `app.create_guest_order` takes
      `(p_items, p_idempotency_key, p_device_id)` and writes no free text; `order_items.notes` is written
      only by `app.add_order_items`, a till RPC no guest can call. **Guests cannot write order notes**,
      and notes never enter the `analytics-insights` payload anyway — it carries aggregates, menu names
      and prior insights.
      The item is still worth doing for the surfaces that DO reach the prompt: menu item names
      (manager-authored) and `prior_insights` (model output fed back into a prompt — a real loop).
      Rewrite the box against those before working it. Control/bidi stripping itself now exists as
      `app.safe_line` / `app.safe_text` (0080) and can be reused.
- [x] ~~Assert in code that no guest identifier leaves in the analytics or insights payload~~ — **done
      2026-09-07**, `packages/db/scripts/check-analytics-payload.mjs`, wired into CI. Scans every
      CLIENT-CALLABLE `analytics_*` / `report_*` / `panel_*` function for a key naming a person or
      carrying a handle back to one, and fails naming the function and the key.
      Scope matters and cost a false alarm first time round: `app.analytics_sales_lines` DOES return
      `guest_session_id` — it is the detail table the aggregates are built from — but it is granted to
      nobody, so nothing it returns can leave. The gate now judges what a client can RETRIEVE, since that
      is what reaches Groq. 16 functions scanned, clean. Mutation-tested with a plausible
      "show me my regulars" function, which it catches on `customer_id`. (SEC-29 · DEV)
- [x] ~~Have the disable-staff RPC sign the user out globally~~ — **done 2026-09-07, migration 0081.**
      NOT via the admin API: GoTrue's `auth.admin.signOut(jwt)` takes the user's OWN token, so it cannot
      sign out somebody else. `app.set_staff_active(false)` now calls `app.revoke_user_sessions`, which
      deletes `auth.sessions` for that user — `auth.refresh_tokens` cascades, so every device is ended in
      one statement, ATOMICALLY with the deactivation. The count is recorded on the audit row.
      Before this, `is_active = false` removed every staff PERMISSION but the refresh token in the till
      browser kept minting access tokens, so a leaver stayed signed in with a live Realtime subscription.
      ⚠ Honest limit: an access token already issued stays valid until `jwt_expiry` (3600s today). Nothing
      server-side can retract a signed JWT; shortening that is the SEC-05 dashboard box in Phase 0.
      6 tests, including a refresh token captured before the deactivation failing afterwards — and one
      asserting it WORKED before, so the test cannot pass vacuously.
      Still open, client-side: drop the operator's Realtime channel on the next role-resolution failure. (SEC-35 · DEV)

---

## 08 · Phase 4 — store submission lane · 2026-09-16

- [x] ★ ~~Unblock the FK chain so a guest can be deleted: anonymise the profile row rather than cascading,
      so booking rows survive for statistics~~ — **done 2026-09-07, migration 0077.** `profiles_id_fkey`
      (ON DELETE CASCADE to `auth.users`) is DROPPED: no on-delete action lets a child row outlive its
      parent, so the constraint had to go, and `profiles.id` becomes the venue's durable pseudonymous
      guest key. Profile creation does not weaken — it never came from the FK, it comes from the
      `on_auth_user_created` trigger, still the only INSERT path.
      **A second FK blocked it and is not in the original box:** `guest_sessions.auth_user_id →
    auth.users` is NO ACTION, so the delete failed outright for any guest who ever scanned a table QR —
      and the row could not simply be removed instead, because `orders.guest_session_id` and
      `waiter_calls.guest_session_id` are NO ACTION onto it. Deleting a guest's sessions to delete the
      guest would take the café's sales history with them. Dropped too.
      The cascade is replaced by an `on_auth_user_deleted` trigger + a `profiles.deleted_at` tombstone,
      so `auth.admin.deleteUser` keeps its pre-0077 meaning for the two rollback paths that depend on it
      (`desk-customer-create:161`, `staff-admin:115`). (SEC-15 · DEV)
- [x] ★ ~~Write `app.delete_my_account()` as `SECURITY DEFINER` with a pinned `search_path`~~ — **done
      2026-09-07, migration 0077.** Guards in order: `AUTH_REQUIRED` → `ACCOUNT_REQUIRED` (an anonymous
      café session has no account — this is ALSO what stops `check-rpc-authz.mjs` deleting the account it
      probes with on every run) → `FORBIDDEN` for staff (they are deactivated; `staff.id → auth.users` is
      ON DELETE RESTRICT) → `ALREADY_DELETED` → `CONFIRMATION_REQUIRED` unless `p_confirm => 'DELETE'`.
      Deleting the auth user IS the global sign-out: `auth.sessions` cascades from `auth.users` and
      `auth.refresh_tokens` cascades from `auth.sessions`, taking `auth.identities`, the email, the phone
      and `raw_user_meta_data` with it.
      **Beyond the box:** `reservations` and `reservation_series` each carry their own `guest_name` /
      `guest_phone` beside `guest_id`, and `confirm_booking` writes them whatever `guest_id` holds. No
      client passes them today, so this is forward defence — but without it the deletion would silently
      stop being complete the day the desk screen that does is built. The audit row deliberately carries
      NO before-image: `to_jsonb(profile)` would write the name and phone this function exists to erase
      into an append-only table manager and owner can read. (SEC-15 · DEV)
- [ ] **Added 2026-09-01 (social sign-in, vendor addition):** Apple requires token revocation (`POST https://appleid.apple.com/auth/revoke`) when an account that used Sign in with Apple is deleted. `auth.admin.deleteUser` does not do it, and the id-token grant yields no refresh token — so the deletion flow must re-authenticate with Apple for a fresh `authorizationCode`, then exchange + revoke it from an edge function holding a Sign in with Apple `.p8` key: the ONLY Apple secret the feature introduces, server-side only, never in a client. Design note: `docs/design/social-signin-2026-09-01.md`. (SEC-15 · DEV)
      **Scaffolded 2026-09-07, still OPEN and still blocked on the `.p8`.**
      `supabase/functions/apple-revoke/index.ts` exists, is registered in `config.toml` with
      `verify_jwt = true`, and returns `501 NOT_CONFIGURED` naming the four missing secrets. Deletion is
      NOT held hostage to it — a guest who asks to be deleted is deleted — so
      `app.delete_my_account` records `apple_revoke_pending: true` on the audit row whenever the account
      carried an Apple identity. Count what is owed at any time with:
      `select count(*) from audit_log where action = 'account.delete' and (after->>'apple_revoke_pending')::bool;`
      ⚠ **This gap is LIVE, not hypothetical:** `[auth.external.apple] enabled = true` in `config.toml`
      with the real `com.kagu.touchpadel` client id, so a guest can sign in with Apple today and every
      such deletion already breaches Apple's requirement. `packages/db/tests/apple-revoke.test.ts` is the
      tripwire: it holds the gap documented while it is open and goes RED the moment the `APPLE_*`
      secrets appear (verified by setting one). Per the session decision of 2026-09-07 it does NOT fail
      the suite today — a permanently red gate gets deleted, as `check-migrations.mjs` argues in its own
      header.
- [x] ~~Test it: no phone/email/name left, reservations still count in statistics, audit row exists, auth
      user gone, old refresh token no longer mints a JWT~~ — **done 2026-09-07.**
      `packages/db/tests/account-deletion.test.ts`, 20 tests, all five assertions present including the
      refresh-token one (a token captured before the deletion is replayed against
      `/auth/v1/token?grant_type=refresh_token` and must not mint a JWT). **Mutation-tested**: removing
      the reservations scrub from 0077 turns exactly two of them red and nothing else, so they are not
      vacuous. The whole-table sweep uses a per-run marker — a fixed literal tripped over residue from an
      earlier run and would have been flaky. (SEC-15 · DEV)
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
- [x] ~~Finish treating the push token as personal data~~ — **done 2026-09-07.** All three remaining parts:
      **cleared on sign-out** — `auth/api.ts` now clears it BEFORE `auth.signOut()`, because
      `profiles_update_own` is `id = auth.uid()` and there is no uid afterwards; best effort, so a network
      hiccup cannot strand somebody signed in on a shared phone (3 unit tests, including the ordering).
      **cleared on account deletion** — inside `app.delete_my_account` (0077).
      **grant narrowed** — 0077 replaces the table-wide `grant select on profiles` with a column grant
      excluding `expo_push_token`, exactly the treatment `pin_hash` gets at `0004:171`.
      ⚠ **The old box described this as "guest-only read (`0004:163`)" and that was wrong.** `0004:160` is
      a bare `grant select on profiles to authenticated` — the WHOLE table — and `profiles_select` admits
      `court_desk`/`manager`/`owner`. A café guest holds `authenticated` exactly as staff do, so **every
      desk session could read every guest's `expo_push_token`**: the one credential needed to push an
      arbitrary notification to that guest's phone. The column is now write-only to clients; only the
      service role (`send-push`) reads it back. Asserted for all eight principals in the RLS matrix
      alongside `pin_hash`. (SEC-21 · FE1)
- [ ] Sign EAS Updates and reject unsigned manifests. An OTA channel pushes code to every guest phone with no store review — the highest-leverage credential in the mobile lane. (SEC-23 · FE1)
- [x] ~~`[CI]` Encode the stored-field allowlist as a `packages/db` test asserting the exact column set of
      the guest-facing tables~~ — **done 2026-09-07.** `packages/db/tests/stored-fields.test.ts`.
      `GUEST_DATA` declares every column of all 8 guest-linked tables with its store data-safety category,
      its purpose, and its erasure route. Four things are enforced: the guest-linked tables are
      DISCOVERED from the live catalog (a new table carrying `guest_id`/`profile_id`/`customer_id`/
      `linked_profile_id`/`auth_user_id` fails until declared, so the list cannot silently grow); each
      declared column set must EQUAL the live one; every personal column must carry a purpose and an
      erasure route; and every erasable column is PROVED emptied by running a real
      `app.delete_my_account`. The catalog comes from PostgREST's own OpenAPI document — the same view of
      the schema the clients get. (SEC-20 · SEC)
- [ ] `[FREEZE]` Fill both stores' data-safety forms **from that test's array**, not from memory. The test
      now PRINTS them in the shape both forms ask for — run
      `pnpm --filter @touch/db vitest run tests/stored-fields.test.ts` and copy the block it emits.
      Still open because it needs a human in two store consoles. (SEC-20 · SEC)
- [ ] ★ Write the processor register. All three are **live in production and none is papered**: PostHog
      (EU, project `touch-padel` id 209766, `HANDOFF.md:163`), **Groq** for LLM insights
      (`analytics-insights/index.ts:53`), and the Telegram Bot API (`telegram-send`). Record data categories,
      region, retention, legal basis and contract status; sign PostHog's DPA; get Groq zero-retention in
      writing. **See D4 — PostHog on the guest web app is outside the SOW.** (SEC-19 · SEC)
- [ ] Decide Telegram explicitly: strip the payload to ticket number and table (no notes, no totals) and disclose it, or replace it. Live order contents currently go to a consumer messaging platform under no agreement. (SEC-19 · SEC)
- [ ] `[CI]` Add the CI secret gates permanently: artifact grep, gitleaks over history, `pnpm audit --audit-level=high`, Dependabot, and a check that no `NEXT_PUBLIC_`/`EXPO_PUBLIC_` name matches `/SECRET|KEY|TOKEN|PIN|HMAC/`. (SEC-24 · DEV)

---

## 09 · Phase 5 — desktop app and the offline queue

- [x] ~~Bundle the preload to a single file and set `sandbox: true`~~ — **already done** (reconciled
      2026-09-07). `esbuild.config.mjs:34` bundles `src/preload/index.ts` to a single CJS file, and
      `check:electron` confirms `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false` and the
      three navigation guards. No `TODO(W3)` remains anywhere in the shell source. (SEC-30 · DEV)
- [x] ~~`[CI]` Add `check:electron` failing on `nodeIntegration: true`, `contextIsolation: false`,
      `sandbox: false`, `webSecurity: false` or `@electron/remote`~~ — **done 2026-09-07.**
      ⚠ **The script existed and had NEVER RUN.** `scripts/check-electron.mjs` was written and CI called
      `pnpm --filter @touch/operator-shell check:electron` — but that script was not in the package's
      `package.json`, so pnpm printed "None of the selected packages has a check:electron script" and
      **exited 0**. A green step that checked nothing, on every run since it was added. This is the third
      instance of that exact shape in this repository (the unused header constants, the grep that matched
      an unused import, and now a missing script name). The script is now registered and passes;
      mutation-tested by flipping `sandbox: true` to `false`, which it catches. (SEC-30 · DEV)
- [ ] Buy an OV or EV code-signing certificate, key in a cloud HSM, not on a laptop. Issuance takes days — start now. (SEC-14 · DEV)
- [ ] Sign the installer and binaries; configure the updater to verify the publisher against the certificate and refuse a mismatch. (SEC-14 · DEV)
- [ ] Prove it: install the signed build with no SmartScreen prompt, then serve a tampered `.exe` and show the updater refuses. (SEC-14 · DEV)
- [x] ~~Encrypt the queue at rest with `safeStorage` (DPAPI-backed), and refuse to trade offline if
      `isEncryptionAvailable()` is false~~ — **done 2026-09-07**, queue schema v4.
      ⚠ **This one was real and worse than the box says.** A queued PIN-gated mutation carries the TYPED
      PIN: `apps/operator/src/lib/mutate.ts:128,140` maps `p_pin: p?.pin` into the replayed args for
      `override_price` and `apply_discount`, because the server re-verifies it at replay. So `queue.db`
      held staff authorisation PINs in **plaintext JSON** on an unmanaged Windows box — the same
      credential the `pin_cache` salt encryption went to such lengths to protect, one table away.
      The payload column is now safeStorage ciphertext (`payload_enc` marks the encoding, so a queue
      written before the upgrade still replays). `enqueue` throws
      `QueueEncryptionUnavailableError` when the machine cannot encrypt — the till refuses the offline
      sale rather than writing plaintext. A row that cannot be decrypted later is PARKED as failed and
      stays visible to a manager, never skipped in silence and never replayed with a null body.
      6 new tests, including one asserting a queued PIN is unreadable in the raw file. (SEC-32 · DEV)
- [x] ~~**Encrypt or remove `pin_cache`.**~~ — **already done** (reconciled 2026-09-07). The box
      describes a state that no longer exists: `src/main/pin-cache.ts` stores scrypt hashes whose SALT is
      encrypted with `safeStorage` (DPAPI), and **fails closed** — if encryption is unavailable the
      station does not cache PIN material at all and offline unlock is simply unavailable. `queue.ts:36`
      no longer holds argon2 hashes and no `TODO(W3)` remains. (SEC-32 · DEV)
- [x] ~~Write and flush to disk before the renderer confirms~~ — **already done** (`queue.ts:16-17`
      WAL + `synchronous = FULL`, IPC resolves after commit, asserted in `queue.test.ts:38-46`). `[SOW]` Module 7.
- [x] ~~Generate the idempotency key at the moment of the action and carry the staff session captured at
      that moment~~ — **already done** (reconciled 2026-09-07). `apps/operator/src/lib/mutate.ts:278-287`
      mints the key and captures `staffId` and `createdAt` before the envelope is enqueued; replay uses
      the captured values, never the session present at replay time. (SEC-32 · DEV)
- [x] ~~Implement dequeue: ordered replay, bounded retry, no reordering~~ — **already done**
      (reconciled 2026-09-07). The box's premise ("there is no dequeue") is stale: `queue.ts` exposes
      `peekNext` (strictly by `seq`, resuming an interrupted `inflight` row first), `markInflight`,
      `releaseToPending`, `markConflict`, `markFailed` and `resolveRow`, and `sync-worker.ts` drives them
      with its own tests. (SEC-32 · DEV)
- [x] ~~Route a server-rejected write to a visible "needs a manager" list; never drop it, never let it
      block the queue forever~~ — **already done** (reconciled 2026-09-07). `markConflict` / `markFailed`
      park the row, `listBlockingRows` surfaces it, and `resolveRow` records WHO dismissed it and when —
      the row is never deleted. Terminal rows are skipped by `peekNext` so one poisoned write cannot wedge
      every later sale, and they still block day close. (SEC-32 · DEV)
- [x] ~~Purge on confirmed sync, and assert the local schema cannot store the guest list~~ — **done
      2026-09-07.** The assertion is the part that was missing: `local-data-surface.test.ts` pins the
      exact table set of `queue.db` and fails on any COLUMN matching guest/customer/profile/phone/email/
      full_name in any of them. The venue PC is the one machine in this system with no RLS in front of
      its storage; "cache the customer list so search works offline" is a reasonable-sounding commit that
      now cannot land quietly. (SEC-32 · DEV)
- [ ] Stamp both the client's action time and the server's receipt time on a queued write and reconcile on replay. The venue PC's clock is managed by nobody. (SEC-32 · DEV)
- [x] ~~`[SOW]` Assert the day cannot be closed while unsynced items remain — **D7**~~ — **already
      done** (reconciled 2026-09-07). Enforced server-side (`DAY_UNSYNCED`, 0020) and surfaced by
      `DayClose.tsx`, which lists WHICH rows are blocking rather than showing a bare error code. (SEC-32 · DEV)
- [x] ~~Make `QueueStatus.degraded` reflect the real heartbeat instead of a hard-coded `false`~~ —
      **already done** (reconciled 2026-09-07). `queueStatus()` returns
      `degraded: !rendererOnline || workerUnreachable` — two independent witnesses, the renderer's
      heartbeat verdict and the sync worker's own transport failures. Nothing is hard-coded. (SEC-32 · DEV)
- [ ] Stop `station.ts:37-42` defaulting a misconfigured machine into a working station identity. A station with no `station.json` should refuse to trade, not guess. (SEC-32 · DEV)
- [x] ★ ~~Strip control bytes and Unicode bidi overrides from guest text at write time~~ — **done
      2026-09-07, migration 0080.** `app.safe_line` (names, phones) and `app.safe_text` (notes, keeps
      line breaks) over a shared control class: C0/C1, zero-width, and every bidi override and isolate.
      Arabic is untouched — these are invisible FORMATTING controls, not script, and that is asserted.
      **Enforced by BEFORE triggers, not in the RPC as the box says**, because `profiles.full_name` and
      `profiles.phone` — measured to be the ONLY text columns in `public` a guest can write — are written
      by the client DIRECTLY through PostgREST on a column grant. There is no RPC in that path to
      sanitise in; a trigger is the only interception every writer must pass. `reservations` and
      `reservation_series` are covered too.
      Verified against the real attack: `Ali<U+202E>gnp.exe` stores and renders as `Alignp.exe` instead
      of displaying as `Aliexe.png`. 8 tests. (SEC-27 · DEV)
- [x] ★ ~~Whitelist bytes on every **text field entering the W3 ESC/POS builder**~~ — **NOT APPLICABLE
      as written; closed 2026-09-07 by proving the property instead.**
      There is no text field entering the ESC/POS builder. The receipt is composed as HTML, rendered by an
      offscreen sandboxed Chromium window and captured as a BITMAP (`print-receipt.ts`); `receiptJob`
      takes pixels, a width and a height — no strings at all. That is the SOW's own design ("the bill
      composed and sent as a rendered image", L425-433) and it is a stronger guarantee than a byte
      whitelist: guest text becomes GLYPHS before it is anywhere near the printer's command parser.
      See the next box for the assertion that now holds it true. (SEC-27 · DEV)
- [x] ~~Keep Phase 1 drawer-kick-free and **prove the injection case instead**~~ — **done 2026-09-07.**
      `escpos.test.ts` builds a job whose entire bitmap is `0x1B 0x70` — the drawer kick — repeated, then
      walks the emitted byte stream and accounts for every byte: `ESC @`, correctly framed `GS v 0` bands
      whose payload length the printer's own parser counts, `ESC d` feed, partial cut. Nothing hostile
      escapes a frame, and a second case asserts the only `ESC` sequences OUTSIDE the framed payload are
      `ESC @` and `ESC d`. This is what the box means by exempting the framed raster payload. (SEC-27 · DEV)
- [ ] ★ Bind the LAN KDS server to the POS interface, not `0.0.0.0`, and require a bearer token minted at pairing and rotated on each shell start. Bind: done (`pickLanBind`, first RFC1918 IPv4, `lan_bind` override). Minted at pairing: done 2026-09-05 — the till mints a 50-bit pairing code at first run (`main/first-run.ts`), shows it behind the manager PIN, and the kitchen screen proves it with a real handshake before saving (`main/lan-discover.ts`). Rotation on each shell start is NOT done (a rotated key would strand every paired kitchen screen; needs a re-pair flow first). (SEC-31 · DEV)
- [x] ~~Restrict the printer socket to the shell's host, and never expose the print endpoint through the
      KDS server~~ — **done 2026-09-07** (assertion added; the property already held).
      The printer transport DIALS OUT (`net.createConnection`) and never listens, so there is no print
      socket on the LAN to reach in the first place — a stronger form of "restricted to the shell's host".
      The LAN protocol declares exactly three frame types (`ticket.new`, `ticket.snapshot`,
      `status.update`) and none is a print. `local-data-surface.test.ts` now pins both: the frame set is
      asserted exactly, the KDS modules are asserted never to import the print module, and the transport
      is asserted to contain no `createServer`/`listen`. (SEC-31 · DEV)
- [ ] Resolve the self-unlock PIN gap: PINs exist only for `manager`/`owner` today, so a cashier has nothing to unlock with. Either lock returns to the staff picker with the account password, or add a **separate** unlock PIN in a separate column with a verification function that can never satisfy an approval RPC. Do not reuse the manager PIN. (SEC-34 · FE2)

---

## 10 · Phase 6 — public web and the QR surface

> `apps/web` currently ships **zero security headers**, has **no `middleware.ts`**, and has **no lint script**.
> This is the least-defended surface in the system and the only one with no login.

- [x] ★ `[FREEZE]` **Production headers shipped** — DONE, **2026-09-07**. HSTS (2y, includeSubDomains, preload), nosniff, X-Frame-Options, Referrer-Policy, Permissions-Policy, COOP, plus a per-request nonce CSP with `'strict-dynamic'` and no `unsafe-inline`. 🔴 **Layer 1 ticked this on 2026-09-04 while shipping NOTHING** — the constants were imported into `next.config.ts` and never returned. Found by the first run of the header e2e, confirmed on the wire with `curl`; the gate that missed it now inspects the returned array and is negative-tested. `[FREEZE]` still applies against the real domain. (SEC-25 · FE2)
- [x] ★ **Table token exchanged for a cookie** — DONE 2026-09-04, **e2e-verified 2026-09-07**. `proxy.ts` 307s `/t/{token}` → `/{locale}/t` with an `HttpOnly; Secure; SameSite=Lax` cookie — a redirect rather than `replaceState`, which is stronger: the token never enters history at all. Printed QR cards unaffected. ⚠ **Known residual:** the token still appears once in the RSC payload because `useTableSession` needs it to call `open_table_session` (`layer-1-rules-and-decisions.md` §7). Fixed: Referer, analytics, history, screenshots, shared links. Not fixed: an XSS in the guest app could still read it. (SEC-25 · FE2)
- [x] **`Referrer-Policy: no-referrer` on the table routes** — DONE, **verified on the wire 2026-09-07**, on `/t/{token}` AND on `/{locale}/t` where the 307 lands — the second was missing from the original. (SEC-25 · FE2)
- [x] **Token kept out of analytics** — DONE 2026-09-04. PostHog `sanitize_properties` redacts `/t/<token>` from `$current_url`, `$pathname` and `$referrer`; autocapture and session recording were already off. Asserted by the e2e token-leak test, which checks `Referer` on **every** request. ⚠ **The SOW question is separate and still open — see D4.** (SEC-25 · FE2)
- [x] **Cookies are `HttpOnly; Secure; SameSite=Lax`** — DONE, confirmed on the wire and asserted by e2e. `Lax` not `Strict` on purpose: a guest following the QR from a messaging app arrives cross-site, and `Strict` would drop the cookie on the one navigation that matters. (SEC-25 · FE2)
- [x] ~~Add the **cafe abuse limits** Security Layer §6.2 asks for~~ — **mostly done 2026-09-07,
      migration 0082.** `venue_settings.guest_orders_per_minute` (6),
      `guest_items_per_order` (40) and `tab_confirm_threshold_iqd` (150,000), enforced by BEFORE triggers
      on `orders` and `order_items` rather than by editing `create_guest_order` — 0076's lesson about
      re-issuing a long body to add one line, and a trigger covers every path into the table.
      Limits are per SESSION: one abusive table cannot stop the rest of the café ordering, which is the
      difference between a rate limit and an outage. Staff orders are exempt — a busy till legitimately
      fires faster than any guest and its actor is audited. The tab threshold is ADVISORY (read by the
      till, not enforced): a genuine large tab must never be blocked by the database mid-service.
      6 tests, including the cross-session isolation case.
      **Still open: the per-IP limit.** Postgres never sees the client IP — it sees PostgREST — so it
      belongs in front of the site, with the box below. Solving it here would have been pretence. (SEC-25 · FE2+DEV)
- [ ] Put rate limiting and bot protection in front of the public site and the auth endpoints. (SEC-25 · FE2)
- [x] Add e2e cases asserting each header, no inline script without a nonce, and no token substring in
      the captured analytics payload — DONE, **first executed 2026-09-07, 6/6 green**
      (`e2e/tests/web-security-headers.spec.ts`). This suite is what found that the static security
      headers were never shipping (see `security-layer-1.md` Block 4 · Web). (SEC-25 · FE2)
- [x] ★ ~~**Run the header e2e against a PRODUCTION build in CI.**~~ — **done 2026-09-07.**
      `playwright.config.ts` now runs `next build && next start` when `E2E_PROD_BUILD=1` (with
      `reuseExistingServer: false`, so a dev server already on :3000 cannot be silently measured
      instead), and a CI step runs that one spec with the flag set.
      **Running them for the first time found two things.** The `unsafe-eval` assertion passed. The nonce
      assertion FAILED — and the app was right, the test was wrong: it read
      `document.querySelectorAll('script')` after hydration and flagged Next's `self.__next_f.push(...)`
      chunks, which are created at runtime BY an already-nonced script. `'strict-dynamic'` allows exactly
      that; requiring a nonce on them asserts something CSP does not mean and fails on a correct app.
      Rewritten to assert against the SERVED HTML — where an injected script would have no nonce and be
      blocked — and verified on the wire: 14 of 14 script tags carry the nonce, and every one matches
      that response's own header (checked within a single request, because the nonce is per-request).
      6 of 6 header cases now pass against a real production build. (SEC-25 · FE2)
- [ ] **`Cache-Control: no-store` on the rendered table page.** Measured 2026-09-07: it holds on
      `/t/{token}` (a middleware redirect) but Next overrides it on `/{locale}/t` with
      `no-cache, must-revalidate`, from both `headers()` and `NextResponse.next()`. A cache may store
      that page provided it revalidates. Low severity — the session is gated by the HttpOnly cookie, not
      by the cache — but the Layer 1 box claimed `no-store` "verified on the live route" and that was not
      true. Either accept it in writing or serve the route through a handler that can set it. (SEC-25 · FE2)
- [x] **Next image optimizer allowlist narrowed** — DONE 2026-09-04. The `*.supabase.co` wildcard made the optimizer an open proxy under the venue's own domain and TLS certificate. Now derived from `NEXT_PUBLIC_SUPABASE_URL`, so it follows the deployment instead of hardcoding a ref that breaks at handover. (SEC-25 · FE2)
- [x] **PWA posture decided and enforced as CODE** — DONE 2026-09-04. `check-web-security.mjs` passes vacuously while no service worker exists and FAILS the moment one appears unless `/t` is excluded from caching. A cached `/t/{token}` would put the credential in Cache Storage where page script can read it, undoing the HttpOnly cookie entirely. (SEC-25 · FE2)
- [ ] Guard Vercel preview deployments — `[SOW]` Module 6 promises "preview deployment per change", and every preview points at the one live database. Password-protect previews or point them at a seeded project. **Not in v1.0.** (SEC-25 · FE2)
- [x] ★ ~~Add `table_token_secret_prev` and accept a signature valid under either secret while minting only
      with the current one, writing an audit row when the previous key is used~~ — **done 2026-09-07,
      migration 0083.** `app.table_token_secret_prev()` (never bootstraps — absence is the normal state),
      `verify_table_token` re-issued to try the current key then the previous one, for BOTH token forms,
      and every acceptance on the old key writes `table_token.accepted_prev_secret`.
      **The box described a four-step rotation with no supported way to perform any of it** — the secret
      lives in Vault, so "copy it to prev and mint a new one" meant hand-editing Vault on the live
      project at 2am. So 0083 also adds `app.rotate_table_token_secret()` (steps 1+2 atomically; doing
      them separately leaves a window where every printed card is dead) and
      `app.clear_table_token_secret_prev()` (step 4), which RETURNS how many scans arrived on the old key
      in the last 7 days — so retiring the remaining cards is a decision made against a number.
      Both service-role only. ⚠ Re-issuing the function is also the easiest place to widen a grant by
      accident: the first draft granted `verify_table_token` to `anon`, which it never had. The
      rls-matrix rule for that RPC caught it. (SEC-26 · DEV)
- [x] ~~Test it: a token minted under the previous secret verifies while `prev` is set and fails once
      cleared; a third random secret always fails~~ — **done 2026-09-07**,
      `tests/table-token-rotation.test.ts`, 9 tests. All three named cases plus: a card minted after the
      rotation works, a card TWO rotations old never verifies (the overlap is one generation deep), a
      current-key scan writes no rotation audit row, and garbage is still refused while prev is set.
      The tests drive the real `rotate_table_token_secret()` / `clear_table_token_secret_prev()` RPCs.
      The first version wrote to `app.secrets` directly and measured NOTHING — the live value is in
      Vault, which takes precedence, so the "current" key never changed and every card kept verifying
      under it. (SEC-26 · DEV)

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
- [ ] Set up the **off-platform backup copy**: a weekly encrypted dump stored in an account that is _not_ the Supabase account, so a compromised or suspended account is not also the loss of the backups. Nothing like this exists today. (SEC-38 · DEV)
- [ ] Write the recovery targets down and agree them with the client — how much data may be lost (target under 5 minutes via PITR) and how long recovery takes (target under 2 hours). The client should hear a number, not "we have backups". (SEC-38 · SEC)
- [ ] ★ `[FREEZE]` Power-cut drill, **twice**, on the venue's real PC: pull the network cable mid-order, trade ten minutes across six tickets and two court arrivals, pull the power cable, restart, reconcile against a paper tally. (SEC-39 · SEC)
- [ ] `[FREEZE]` Switching test inside the same run: staff A works four tickets, locks, staff B works four, including offline. Every replayed row must name the person who typed it, not the person who reconnected. (SEC-39 · SEC)
- [ ] ★ `[FREEZE]` Leaver test on real machines: disable an account, confirm sessions end everywhere, record the elapsed time. _(The DB half already holds — this proves the session half.)_ (SEC-35 · SEC)
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

| #   | Gate                                                                                       | Status                                                                                                                                         | How _you_ confirm it, without reading code                                                                                                                                                                                                                                                                                                                                                         |
| --- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01  | No service key in any shipped bundle (SEC-24)                                              | **OPEN**                                                                                                                                       | Run the artifact grep yourself on the release builds. A hit is a stop-ship.                                                                                                                                                                                                                                                                                                                        |
| 02  | `gitleaks` over full history is clean (SEC-24)                                             | **OPEN**                                                                                                                                       | Run it. It prints findings or nothing.                                                                                                                                                                                                                                                                                                                                                             |
| 03  | MFA on every production account (SEC-40)                                                   | **OPEN**                                                                                                                                       | Open each provider's settings and look.                                                                                                                                                                                                                                                                                                                                                            |
| 04  | Hosted database is at the migration head (SEC-03)                                          | **OPEN**                                                                                                                                       | The nightly `db diff --linked` job is green.                                                                                                                                                                                                                                                                                                                                                       |
| 05  | Migration safety procedure in place (SEC-02)                                               | **OPEN**                                                                                                                                       | Open a test PR with a `DROP COLUMN` and watch CI refuse it.                                                                                                                                                                                                                                                                                                                                        |
| 06  | Anonymous sessions cannot hold courts (SEC-07)                                             | ✅ **0048/C1**                                                                                                                                 | Ask for the `booking-hardening` test. It exists and is green.                                                                                                                                                                                                                                                                                                                                      |
| 07  | Idempotency keys scoped to the caller (SEC-08)                                             | ✅ **0048/H3 + 0049**                                                                                                                          | Ask for the cross-caller test. `IDEMPOTENCY_CONFLICT`.                                                                                                                                                                                                                                                                                                                                             |
| 08  | Move and extend re-price (SEC-09)                                                          | ✅ **0048/H1+H2**                                                                                                                              | Ask for the create-vs-move price equality test.                                                                                                                                                                                                                                                                                                                                                    |
| 09  | `rate_rules` constrained, pricing agrees (SEC-10)                                          | ✅ **CLOSED 2026-09-07 (0071)**                                                                                                                | Positive price, minute bounds, and a 30-case golden fixture asserted by BOTH pricing implementations against one file. Ask for `rateRules.golden.test.ts` and `pricing-golden.test.ts` — 31 green each.                                                                                                                                                                                            |
| 10  | Future bookings cannot be resold (SEC-11)                                                  | ✅ **CLOSED 2026-09-07 (0071 §4 + 0076)**                                                                                                      | Ask for `booking-integrity.test.ts` → "no_show on a future booking is refused, and the court stays taken": it marks a future booking, gets `RESERVATION_NOT_STARTED`, then tries to resell the slot and gets `SLOT_TAKEN`. ⚠ **0075 reverted this gate within a day and nothing but that test noticed.** If it is ever removed, this gate is open again.                                           |
| 11  | Second-pass authz sweep green (SEC-12)                                                     | **OPEN**                                                                                                                                       | It is a CI job. Green or red.                                                                                                                                                                                                                                                                                                                                                                      |
| 12  | Account deletion works end to end (SEC-15/16)                                              | **OPEN**                                                                                                                                       | Delete your own test account on a real phone, then try to sign in. **Store blocker.**                                                                                                                                                                                                                                                                                                              |
| 13  | Privacy notice and web deletion page live (SEC-17)                                         | **OPEN**                                                                                                                                       | Open both URLs in Arabic and English. **Store blocker.**                                                                                                                                                                                                                                                                                                                                           |
| 14  | Password reset works on a real device (SEC-18)                                             | **OPEN**                                                                                                                                       | Do it yourself from a cold install. **Store blocker.**                                                                                                                                                                                                                                                                                                                                             |
| 15  | Auth hardening on (SEC-05)                                                                 | **OPEN** — read 2026-09-01: captcha OFF, leaked-password protection OFF, `localhost` + `exp://` still in the redirect list                     | Dashboard toggles — look at them.                                                                                                                                                                                                                                                                                                                                                                  |
| 16  | Production headers and CSP live (SEC-25)                                                   | ⚠ **WAS FALSELY GREEN — fixed 2026-09-07**                                                                                                     | The 2026-09-04 tick was wrong: the header set was written and _imported_ into `next.config.ts` but never returned, so **zero** static headers shipped while the gate stayed green (it grepped for the constant's name, which an unused import satisfies). Now wired, gate strengthened and negative-tested, 6/6 e2e green. Do the third-column check yourself: `curl -I` the domain and read them. |
| 17  | Table token is not a bearer credential in a URL (SEC-25)                                   | **OPEN**                                                                                                                                       | Scan a QR and look at the address bar. **New gate.**                                                                                                                                                                                                                                                                                                                                               |
| 18  | Table-token secret rotatable without reprinting (SEC-26)                                   | **OPEN**                                                                                                                                       | Ask for the test where a token signed with the previous secret still verifies.                                                                                                                                                                                                                                                                                                                     |
| 19  | Guest text cannot reach the printer as commands (SEC-27)                                   | **OPEN**                                                                                                                                       | Order a note containing a drawer-kick sequence; watch the drawer stay shut.                                                                                                                                                                                                                                                                                                                        |
| 20  | KDS and printer unreachable from guest wifi (SEC-31)                                       | **OPEN**                                                                                                                                       | Stand in the cafe with your phone and try.                                                                                                                                                                                                                                                                                                                                                         |
| 21  | Degraded mode enforced server-side (SEC-33)                                                | ✅ **0008 + 0048:309**                                                                                                                         | Ask for `degraded.test.ts`. Green.                                                                                                                                                                                                                                                                                                                                                                 |
| 22  | Queue survives a power cut, or an honest decision not to ship it (SEC-32)                  | **OPEN**                                                                                                                                       | The power-cut drill passes twice — or degraded writing is switched off and the venue is told. A till that promises to trade offline and does not is worse than one that never claimed to.                                                                                                                                                                                                          |
| 23  | Disabling a staff account ends their sessions (SEC-35)                                     | **PARTIAL**                                                                                                                                    | DB half done (`0003:50`). Disable a test account and watch a live session die.                                                                                                                                                                                                                                                                                                                     |
| 24  | The SOW deviations are settled in writing (D1–D7)                                          | **OPEN**                                                                                                                                       | Read the signed variation. **New gate.**                                                                                                                                                                                                                                                                                                                                                           |
| 25  | Social provider audiences exact, `host.exp.Exponent` gone, "Skip nonce check" OFF (SEC-05) | **PARTIAL** — 2026-09-01: audiences exact and the Google toggle OFF (Prompt C); `host.exp.Exponent` still listed on purpose until release week | Open Supabase → Auth → Providers and read the two Client-ID fields and the Google toggle. **New gate 2026-09-01** — social sign-in is a vendor addition; this gate protects the whole auth surface, not just the feature.                                                                                                                                                                          |

**Eighteen of these you can verify entirely by yourself, with no code reading:** 1, 2, 3, 5, 6, 7, 8, 10, 12, 13, 14, 15, 16, 17, 19, 20, 24, 25. That is the point of the third column — pick the evidence that does not need your expertise.

---

## 15 · `[CI]` — checks to automate, then never tick by hand again

The repo already has the pattern — `check:authz`, `check:locks`, `check:safeupdate` — so this extends
something that works. Land these in the first week and thirteen boxes become permanently someone else's problem.

> **Four of these go red the moment they land, and that is correct — but it means you cannot land them all at
> once.** Fix first, then fit the gate, or `main` sits red and people learn to ignore it:
>
> | Gate                      | Goes red because                                      | Land it after                                             |
> | ------------------------- | ----------------------------------------------------- | --------------------------------------------------------- |
> | `check:electron`          | `sandbox: false` today                                | the preload bundle + `sandbox: true` fix (§09)            |
> | Authz coverage counter    | 50 of 121 RPCs covered                                | coverage is raised, or set the floor at 50 and ratchet up |
> | Web header e2e assertions | no headers ship today                                 | the `headers()` block (§10)                               |
> | `check:migrations`        | 11 legacy constraint sites, 48 non-concurrent indexes | never — scope it to changed files, as the item says       |
>
> The rest pass or fail honestly on the current repo and can land immediately.

- [x] **`gitleaks` over full history** (SEC-24) — `.gitleaks.toml` + the `secrets` job, 2026-09-04
- [x] **Built-artifact secret grep** on all three clients (SEC-24) — `check-artifact-secrets.mjs`, fails when nothing was built
- [x] **`pnpm audit` + Dependabot** (SEC-24) — `check-dependency-audit.mjs` with dated, per-advisory waivers in `.security/audit-waivers.json`; an expired waiver fails the build
- [x] **`NEXT_PUBLIC_` / `EXPO_PUBLIC_` naming check** (SEC-24) — `check-public-env-names.mjs`, over `git ls-files`
- [x] **Lint rule: no `service_role` in client paths** (SEC-24) — `clientSecrets` in `@touch/config/eslint`, wired into all four client packages; `apps/web` now has a lint script. ⚠ **Running lint matters as much as having it:** on 2026-09-07 it was already reporting `'STATIC_SECURITY_HEADERS' is defined but never used` — the finding that the entire web header set was not shipping — and nobody had re-run it.
- [x] **`check:migrations`** (SEC-02) — scoped to changed files, lock-taking DDL included
- [x] **Nightly `supabase db diff --linked`** (SEC-03) — `db-drift.yml`
- [x] **Zero views without `security_invoker`** (SEC-04) — **executed 2026-09-07**: 12 views, 4 audited exceptions
- [x] **Every definer function pins `search_path`** (SEC-04) — **executed 2026-09-07**: 215/215
- [x] **RPC registry** (SEC-12) — has now fired in anger twice (0070; then 0072/0073/0074, eleven at once)
- [~] **Authz sweep coverage counter** (SEC-12) — the ratchet is DONE and enforced; the **gap is not**. 72 of 139 covered as of 2026-09-07 (up from 60/127). `override_price`, `void_after_send`, `apply_pct_discount`, `merge_tabs`, `split_by_item` and the `analytics_*` family are still asserted by nobody.
- [x] **`check:electron`** (SEC-30) — window hardening cannot regress
- [x] ~~Guest-field allowlist drift test (SEC-20)~~ — **built 2026-09-07**, `packages/db/tests/stored-fields.test.ts`. No longer blocks the store data-safety forms in §08; those now need only a human in the two consoles.
- [x] **No real-format phone numbers in seeds or fixtures** (SEC-37) — `check-data-hygiene.mjs`
- [x] ~~A **pull-request template** carrying the Security Layer §11.4 checklist~~ — **done 2026-09-07**,
      `.github/pull_request_template.md`. Covers RLS per operation on a new table; a new guest field
      declared in `stored-fields.test.ts` and sanitised through `app.safe_line`/`safe_text`; a new RPC
      classified in the allowlist AND ruled in `rls-matrix.ts` with the floor ratcheted; the role guard as
      the FIRST statement; the migration rules (timeouts, CONCURRENTLY, NOT VALID, never edit an applied
      migration, re-issue the whole function body); no secret in a public env name; no stack trace or
      constraint name reaching a guest; no money or guest field on a KDS broadcast; and the one rule with
      no exception — nothing that could hold a card number.
      Each line names the gate that enforces it, so the template points at a failing check rather than
      asking for a promise. (SEC-43 · SEC)
- [x] **Web security-header e2e assertions** (SEC-25) — **6/6 on the first run, 2026-09-07; it is what found the headers were never shipping**

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

_Kagu Web Studio · Touch Padel Phase 1 · v2.0 · 2026-08-30_
