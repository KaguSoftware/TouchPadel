# Security audit — pre-launch · 2026-09-13

**Branch** `two` @ `2d6436d` · **Scope** `apps/web`, `apps/mobile`, `apps/operator` + `apps/operator-shell`,
`packages/db` (migrations 0001–0089 + 10 edge functions), `.github/`
**Method** Four parallel code audits (web · mobile · db/functions · desktop/CI), the repo's own security gates,
and read-only checks of the public web deployment. **Nothing was written to any hosted system and no code was
changed.** Every Critical/High, and every finding that contradicts an existing doc, was re-checked against the
code before it was written here.
**Read with** `HANDOFF-security.md` §10, the session entry that points here. The ~11k lines that landed after
2026-09-09 had not been through the security lane; this file covers them and the places where the 09-09 docs
were wrong. Each correction is also marked in place in the doc it corrects (⚠ *2026-09-13*).

Confidence tags: **[confirmed]** read in code or measured · **[likely]** strong evidence, not executed ·
**[verify]** needs a person with dashboard or account access to look.

⚠ **Not covered:** the uncommitted push-notification work that was in progress in the same working tree while this
was written (`20260913000090_push_immediate_delivery.sql`, `functions/send-push/index.ts`,
`apps/mobile/src/features/profile/push.ts`, `tests/push-claim-lease.test.ts`). It needs its own review before merge.

---

## 0 · Bottom line

The foundation holds: RLS/authz, booking and money integrity, secrets hygiene, dependency posture and the live web
headers are in better shape than most apps at launch. **What is not safe is operational, and most of it is fixable
tonight without a database migration:**

1. **C1 — the dev seed staff accounts (shared password committed in the repo) are very likely still active on the
   live project.** Owner access = every guest's name and phone, refunds, and creating hidden owners.
2. **H1 — the till release pipeline:** a tag push ships an unsigned, unreviewed build that auto-installs on every
   till, published with a personal GitHub token that carries `admin:org`.
3. **H2 — one malformed packet from any host on the venue LAN crashes the till.**
4. **Mobile:** two small auth bugs (M1, M2) must be fixed before the store build, the OTA signing key's whereabouts
   must be confirmed before the store build (M15), and the privacy/deletion URLs do not exist (store blocker).

No live-DB migration is recommended tonight. The migration-grade fixes (H3, M4, M5, M9) go in Patch 1 (§4).

---

## 1 · Verified solid

| Area | Evidence (2026-09-13) |
|---|---|
| Secrets in git | gitleaks, CI-equivalent run: **367 commits, 0 leaks**. `check-history-secrets`: PASS (1289 paths). No private key in any tracked file. |
| Secrets in builds | Local secret values (incl. the live `service_role` JWT in `apps/web/.env.local`) value-matched against `apps/web/.next/{static,server}`, `apps/mobile/dist`, `apps/operator/dist`, `apps/operator-shell/dist`: **0 hits**. The gitleaks `sb_secret_` hit in `apps/mobile/dist/*.hbc` is a false positive (supabase-js's prefix check concatenated with the next string in the Hermes string pool). |
| Dependencies | `next@16.3.4` — the two critical Next RCEs flagged 09-09 are fixed. `check-dependency-audit`: PASS — 13 high/critical, all waived with dates; all are dev-only (vitest, vite, image-size, extract-zip) or Electron 33 (till, waivers expire **2026-10-15**). |
| Public env names | `check-public-env-names`: PASS. `check-data-hygiene`: PASS. |
| Live web headers | Measured on `touch-padel-web.vercel.app`: HSTS 2y + preload, nonce CSP with `'strict-dynamic'`, `X-Frame-Options: DENY`, nosniff, COOP, Permissions-Policy. `/t/{token}` → 307 + `tp-table` `HttpOnly; Secure; SameSite=Lax` + `no-referrer` + `no-store`. **Except the paths in M3.** |
| DB authz | 233/233 definer functions pin `search_path`; service-role-only RPCs not client-callable; `profiles.expo_push_token` and `staff.pin_hash` not selectable; staff-admin RPCs owner-only with the last-owner guard; storage mime allowlist (no SVG) + size cap; Realtime private topics with per-topic RLS; no wildcard CORS in any function. |
| New migrations | 0084 `open_tab`, 0085 `cancel_tab`, 0088 `cancelled_by`, 0089 re-assert — guards first, grants restated; `cancelled_by` is an enum (`guest`/`staff`), not a person, and is not in any view or broadcast. |
| Booking & money | Server-authoritative: the phone sends court/start/duration/key only; `hold_slot` / `confirm_booking` / cancel enforce ownership, horizon, hours, phone, window and re-price. The exclusion constraint makes double booking impossible. |
| Webhooks | `telegram-callback` and `send-sms-otp`: constant-time signature checks that fail closed when the secret is unset. |
| Mobile | Session in SecureStore (chunked); bookings excluded from the persisted cache, which is wiped on sign-out; deletion is server-first; nonce per social sign-in; OTA code signing configured (`app.config.ts:159-160`); quiet-error gate PASS; phone OTP flag off in every profile; eas.json anon JWT decodes to `role: anon`. |
| Till | `check:electron` PASS (but see L23); queue payload and PIN-cache salt encrypted with safeStorage, both fail closed; `canTrade()` guards enqueue/print/LAN; no generic IPC passthrough; receipt window sandboxed, `data:` URL, React-escaped; KDS WebSocket auth uses an `Authorization` header a browser cannot set (no cross-site WebSocket hijack). |
| CI | No `pull_request_target`/`workflow_run`; no `${{ github.event.* }}` interpolated into `run:`; every `pnpm --filter X <script>` in the workflows resolves to a real script. |
| Deploy blast radius | `two` is 11 commits ahead of `origin/main`, **mobile + i18n only** — merging it triggers neither `db-migrate` nor `functions-deploy`. |

⚠ **CI is red on `two`:** `apps/mobile` typecheck fails at `src/navigation/TabsLayout.android.tsx:182` (TS2322, ref
type), introduced by `2d6436d`. Not a security issue; it blocks the green gate.

---

## 2 · Findings

### Critical

**C1 · Dev seed staff accounts, with a password committed in the repo, are very likely live on production** — [likely] [verify]
- **Evidence.** `git show 84c70bb:HANDOFF.md` lines 60-62: project `lczijabnorujcgmbuqlw` — the ref every production
  client now uses — was "seeded (dev staff + PINs per seed.sql header)" on 2026-08-24, and anonymous sign-in was
  enabled "via `supabase config push`". `packages/db/supabase/seed.sql:7-11,109-160` creates
  `owner|manager|cashier|prep|desk@dev.touch.local`, email-confirmed, one shared password — the same value committed as
  `DEV_PASSWORD` in `packages/db/tests/helpers.ts:20` and `e2e/tests/helpers.ts`. `HANDOFF.md:1521-1523` ("the `staff`
  table still holds only `Dev` seed rows … rotate the seeded dev PINs") and `:1900` are still open. `HANDOFF.md:1809`
  counts **6 staff on hosted** (09-01). `HANDOFF.md:168`: the Telegram allowlist points at `Dev Owner` with `can_void`.
- **Also.** `scripts/create-operator-owner.mjs:24-25` creates an owner on the hosted project with a **committed default
  email and password** when run without arguments — a plausible sixth staff row.
- **Old PINs still verify.** 0078 changed the *set-time* rule only; `verify_manager_pin` never calls `pin_is_weak`, so
  PINs hashed on hosted before 0078 (the seed's `111111`/`222222` at the time) keep authorising until reset.
- **Impact.** Anyone with repo access, or who guesses the dev password, signs in to the operator as owner (CAPTCHA off;
  the anon key is public): `customer_search` lists every guest's name and phone; refunds; analytics; `staff-admin`
  creates a hidden owner and resets real staff passwords.
- **Fix (human, ~45 min, outside service hours — the till may be signed in with one of these accounts):** §3.1-A.
  A password reset alone is not enough — `staff-admin/index.ts:142` does not revoke refresh tokens; deactivation
  does (0081).

### High

**H1 · The till release pipeline: tag → unsigned auto-update to every till, no reviewer, broad token** — [confirmed]
- `.github/workflows/operator-release.yml:30-31` triggers on any pushed `operator-v*` tag and publishes
  (`--publish always`, `:173`, `:272`) with **no `environment:` gate**. Tills check every 6 h (`updater.ts:19`) and
  install on restart. The build is unsigned, so electron-updater performs **no signature check** — integrity rests
  entirely on who can push a tag and who holds the token.
- `RELEASES_GH_TOKEN` is `ParSaMnSS`'s **gh CLI OAuth token with `repo` + `workflow` + `admin:org`**
  (`docs/client/operator-download-2026-09-05.md:28`), exported as `GH_TOKEN` to the `electron-builder` steps
  (`:156`, `:260`) after `pnpm install --frozen-lockfile` without `--ignore-scripts` (`:126`). A malicious transitive
  build script there gets write to every repo that account reaches, and org admin.
- `.github/CODEOWNERS:34-44` covers the migrations, `db-migrate.yml`, `ci.yml`, `.security/` and `scripts/security/`
  but **not** `operator-release.yml`, `functions-deploy.yml` or `db-ops.yml`.
- **Fix:** §3.1-B (token swap + revoke + tag ruleset) and §3.2 (environment gate + CODEOWNERS). Effort S + needs-human.

**H2 · One malformed WebSocket frame from any LAN host crashes the till** — [confirmed in code; reproduced by the audit against a copy of the handshake]
- `apps/operator-shell/src/main/lan-kds-server.ts:105-156`: per-connection sockets get `close`/`message` listeners but
  **no `error` listener** — including the rejected-PSK path at `:108-111`. `ws` emits `error` on any protocol violation
  (e.g. an invalid opcode); with no listener Node throws, and the main process has **no `uncaughtException`
  handler**. An unauthenticated peer sending two bytes (`0x83 0x00`) kills the till mid-service and stops the kitchen
  feed. Also `new WebSocketServer({ host, port })` (`:94`) leaves `maxPayload` at the 100 MB default.
- Only active on a till whose `station.json` has `lan_psk`. Reachable from the guest Wi-Fi if it shares the POS
  network (SEC-41, client item, unconfirmed).
- **Fix (S):** `socket.on('error', …)` as the first line of the `connection` handler; `maxPayload: 64 * 1024`. Ship as
  `operator-v0.2.3` **after** H1's token swap.

**H3 · The manager-PIN lockout never engages through the money RPCs** — [confirmed]
- `verify_manager_pin` records the attempt and returns NULL (`20260909000086_pin_failure_uniformity.sql:192`). The
  callers then **raise** `PIN_INVALID` — `apply_discount` (`0049:154-156`), `refund` (`0044:201-203`),
  `void_after_send` (`0032:621-623`), and `override_price` / `write_off_expired` in the same shape — and the raise rolls
  the `pin_attempts` row back with it. The failure 0011 fixed for direct calls, and 0086's own comment warns about, is
  back on every path that matters. Every lockout test calls `verify_manager_pin` directly.
- The PIN is checked **before** the tab/payment lookup, so a random id is a clean oracle (`PIN_INVALID` vs
  `TAB_NOT_FOUND`). Any cashier session can brute-force a 6-digit manager PIN — 250 ms floor, parallelisable — with no
  lockout and no audit row. `replay` reaches the same RPCs.
- **Fix (M, migration, contract change → Patch 1):** return a typed failure instead of raising after a PIN miss (or
  split verification into its own committed call plus a short-lived approval), and reject weak PINs at verify time.
  **Tonight's stopgap:** the C1 cleanup (removes the outsider path to a cashier session) + fresh, unique manager PINs.

### Medium

**M1 · Mobile: a crafted link signs the phone into the attacker's account (login CSRF)** — [confirmed in code]
`apps/mobile/src/features/auth/deepLink.ts:81-85` accepts `#access_token=…&refresh_token=…` on any auth path;
`useAuthDeepLink.ts:65` hands it to `supabase.auth.setSession`. `touchpadel://reset-password#access_token=A&refresh_token=R&type=recovery`
silently signs the victim into the attacker's account; the name and phone they then enter, and their bookings, land
where the attacker reads them. The app is PKCE-only (`src/lib/supabase.ts:37`) and nothing in the repo issues
implicit-flow links (no `generateLink`/`inviteUserByEmail`), so the branch is dead weight.
**Fix (S, tonight):** delete the `tokens` branch and treat it as an invalid link; add a test. Side effect: magic or
recovery links sent from the Supabase dashboard stop opening in-app — acceptable.

**M2 · Mobile: `reset-password` sets a new password for any signed-in session** — [confirmed in code]
`app/reset-password.tsx:43` treats the link as valid whenever *any* session exists, and the screen calls
`updateUser({ password })`; nothing checks that the session came from a recovery exchange. Anyone holding an unlocked
phone opens `touchpadel://reset-password` and sets a new password without the current one — the re-auth that
`change-password.tsx` exists for is bypassed, and an Apple/Google-only guest [likely] gains a password login.
**Fix (S, tonight):** render the form only after `exchangeCodeForSession` returned a recovery exchange in this app
session; turn on Supabase → Auth → "Secure password change".

**M3 · Web: the CSP is skipped on paths the proxy matcher excludes** — [confirmed on production]
`apps/web/proxy.ts:157` matches `'/((?!_next|api|favicon.ico|.*\\..*).*)'`, which excludes every path *beginning*
`api` and every path containing a dot; `[locale]` has no `dynamicParams = false`. So `/api/t`, `/apifoo/t` and
`/x.y/t` still render the table page (with the cookie's token in it) but never pass through the proxy that sets the
CSP. Measured 2026-09-13: `/en/t` carries the CSP; `/api/t` and `/x.y/t` return 200 HTML with **no CSP** (the static
headers still apply). Any future XSS runs unmitigated by sending a guest to `/api/t`.
**Fix (S, tonight):** `dynamicParams = false` (or a 404 for anything but `en|ar`); a matcher that excludes only real
static paths; an e2e case for `/api/t`.

**M4 · Web/DB: guest ordering can be flooded across tables, and staff have no kill switch** — [confirmed in code]
`20260907000082_cafe_abuse_limits.sql:70-72` counts orders per `guest_session_id` only. Opening another table's session
(or signing in anonymously again) resets the count, so a script alternates tables at 6 orders/minute each, 40 lines
per order, from anywhere — tickets on the KDS, stock decremented, Telegram flooded, a neighbour's tab filled.
`guest_orders_per_minute` is exposed by no RPC and no operator screen; the only in-app stops are closing the day (refused
while tabs are open) or degraded mode. Rotating a table token does not end a live session [likely].
**Fix:** Patch 1 — per-table and per-user limits, a staff RPC that closes a table's guest sessions, and a kill switch in
the operator. **Tonight** — a gated `db-ops.yml` action to pause/resume guest ordering (the SQL Editor is off-limits,
`layer-1-rules-and-decisions.md` §1).

**M5 · DB: guests can write order notes — unbounded and unsanitised** — [confirmed]
`app.create_guest_order` (granted to `authenticated`, which includes anonymous café guests) passes the guest's `p_items`
to `app.add_order_items`, which inserts `nullif(v_item->>'notes', '')` verbatim
(`20260825000041_availability_local_day.sql:217-221`). The 500/1000-char limits are Zod schemas in the client only;
there is no server cap and no `app.safe_text` (0080 covers `profiles` and `reservations`, not `order_items`). A script
can put megabyte notes or bidi-spoofed text on the KDS and into Telegram. `p_device_id` and `p_idempotency_key` are
unbounded too. The printer is not reachable this way (receipts are bitmaps).
**Fix (Patch 1, migration):** a BEFORE INSERT trigger `notes := left(app.safe_text(notes), 300)` plus length checks.

**M6 · Functions: typed manager PINs are stored in plaintext in `sync_replays`** — [confirmed]
`packages/db/supabase/functions/replay/index.ts:419-428` records `{ code, message, details, mutation_type, payload }` on
every non-conflict RPC error, and PIN-gated payloads carry the typed `pin`. `sync_replays` is append-only and readable
by managers/owners, so a failed discount or void leaves the PIN — right or wrong — readable indefinitely.
**Fix:** tonight, strip `pin` before `record()` (merging runs the gated functions deploy); Patch 1, purge the existing
rows with a migration.

**M7 · CI: the "ledger snapshot" dumps the `app` schema into a 30-day artifact** — [confirmed in the workflow; contents on hosted: verify]
`.github/workflows/db-migrate.yml:153-162` runs `supabase db dump --linked --data-only --schema app`. The ledgers its
comment names (`audit_log`, `stock_ledger`, `payments`) are in `public`; what the `app` schema holds is `app.secrets`
(the table-token HMAC secret's fallback store when Vault is not used), `sms_sends` (phone numbers), `pin_attempts` and
`rpc_replays`. The file is uploaded as `ledger-snapshot-<sha>` for 30 days, downloadable by anyone with read access to
the repository, and the step runs before the push — so failed runs uploaded it too.
**Fix:** tonight, delete the existing `ledger-snapshot-*` artifacts (human) and point the dump at the public ledger
tables (code, S).

**M8 · Config: `config.toml` would enable phone sign-in with a known OTP if pushed again — and it has been pushed** — [confirmed]
`packages/db/supabase/config.toml` sets `[auth.sms] enable_signup = true`, `[auth.sms.test_otp]` with a
real-format Iraqi number and a fixed code (`:108-111`), an enabled placeholder `[auth.sms.twilio]` block and the local
`site_url`. Its comment (`:119`) says "this file is never pushed", but `supabase config push` was run against this
project on 2026-08-24 (C1 evidence). No workflow runs `config push` today. `docs/client/phone-otp-activation.md:67`
also tells the owner to add the same committed pair to the hosted project for store reviewers — a public credential
for a live account once OTP is on.
**Fix (S, tonight):** move the test pair out of the committed file (env substitution), correct the comment, never
`config push` to this ref; give reviewers an uncommitted pair and remove it after review. Note: editing `config.toml`
triggers `functions-deploy.yml` on merge to `main`.

**M9 · DB: one account can book out every court** — [confirmed in code]
`hold_slot` caps *live holds* per guest (`20260827000048_booking_hardening.sql:315-322`); `confirm_booking` (latest
`20260901000059`) has no cap on upcoming confirmed bookings. Hold → confirm → repeat, to the horizon, costs nothing
with pay-at-venue.
**Fix (Patch 1, migration):** cap future confirmed bookings per guest (a `venue_settings` value).

**M10 · DB/desk: a guest can squat someone else's phone number** — [likely; desk flow not exercised]
Guests may update `profiles.phone` directly (0004 column grant); `app.find_customer_by_phone` (0065) returns the oldest
profile carrying a number, and `desk-customer-create/index.ts:112` answers 409 with that profile. A guest who saves the
victim's number blocks the desk from creating the victim's account and points the desk at the squatter's profile.
**Fix (Patch 2):** match only desk-created or verified phones.

**M11 · Till: guest names and phones sit in plaintext in `queue.db`** — [confirmed]
`apps/operator-shell/src/main/queue.ts:424-427` writes `ref_cache` as `JSON.stringify(payload)`; only
`mutation_queue.payload` and the PIN-cache salt are safeStorage-encrypted. The cached `reservations` projection carries
`guest_name`, `guest_phone` and `notes`. `local-data-surface.test.ts` asserts table and column *names*, so it cannot see
inside a payload blob. A copied `queue.db` gives a day's guest names and numbers.
**Fix (Patch 2):** encrypt `ref_cache`, or drop phone and notes from the cached projection.

**M12 · Till: the renderer persists the staff session to disk** — [confirmed in code]
`apps/operator/src/lib/supabase.ts:47` creates the client with default auth options, so supabase-js keeps the session —
refresh token included — in `localStorage`, which Electron stores as plaintext LevelDB under `%APPDATA%`. The main
process deliberately keeps the staff token in memory only; the renderer undoes that.
**Fix (Patch 2):** `persistSession: false` with a main-side encrypted store, or record the acceptance.

**M13 · Till: Quit to desktop no longer takes a manager PIN** — [confirmed; deliberate]
`6bec87d` (2026-09-09) removed the PIN from **Quit to desktop** and updated `design-arch.md` §2.5
(`apps/operator-shell/src/main/index.ts:147-148`: "what stops a casual exit is its confirmation dialog, not a
credential"). Consequences: anyone at the till can end service — the heartbeat stops and the venue degrades — and quitting
installs a waiting update; `quitApp` and `installUpdate` are the two bridge methods with no gate, so renderer script can
force a restart. `docs/install-runbook.md` §4 and §6 still said it takes a manager PIN (corrected 2026-09-13).
**Decision needed:** sign the change off, or restore the gate.

**M14 · CI: production workflows run a mutable Supabase CLI with production credentials** — [confirmed]
`db-migrate.yml:64-66`, `db-drift.yml:46-48`, `db-ops.yml:47-49` and `functions-deploy.yml:39-41` use
`supabase/setup-cli@v1` with `version: latest` while holding `SUPABASE_ACCESS_TOKEN` and the DB password; only `ci.yml`
pins a version. Five of six workflows also have no top-level `permissions:`.
**Fix (S, tonight):** pin the CLI version and SHA-pin the action; add `permissions: contents: read`.

**M15 · Mobile: nobody has recorded where the OTA signing private key is** — [verify]
Code signing is enforced (`app.config.ts:159-160`, `certs/certificate.pem`), so SEC-23's code is done. But
`eas-update-signing.md` records that the private key was written to a session scratchpad, with three manual steps
(password manager, EAS secret, delete the scratchpad copy) and no record that they happened; on 2026-09-13 a filename
search of the dev machine found only `expo-updates` test fixtures. A binary built with this certificate rejects every
update not signed by that key — if it is lost, every post-launch JavaScript patch needs store review.
**Fix (tonight, before the store build):** confirm custody; otherwise regenerate the keypair and commit the new
certificate before building.

**M16 · Till: no CSP and no permission handler in the operator renderer** — [confirmed]
`apps/operator/index.html` has no CSP; `apps/operator-shell/src` registers no `onHeadersReceived`,
`setPermissionRequestHandler` or `setPermissionCheckHandler`. No XSS sink was found (React escaping holds), so this is
defence in depth — but on EOL Electron 33 with an unsigned build, any future XSS has no ceiling.
**Fix (Patch 2):** a strict CSP and a deny-all permission handler.

**M17 · Functions: the SMS `log` provider can write full phone numbers and OTP codes to hosted logs** — [confirmed in code; hosted env: verify; dormant]
`functions/_shared/sms/index.ts:47-48` treats a missing `SUPABASE_ENV` as local, and `log.ts:16` then logs `to` and
`code` in full; a provider set with incomplete secrets also falls back to `log` (`index.ts:55`). Phone OTP is off
today.
**Fix (before activating OTP):** log codes only when `SUPABASE_ENV === 'local'`; fail closed on a misconfigured provider.

### Low

| # | Lane | Finding | Confidence |
|---|---|---|---|
| L1 | web | The backup exchange `app/[locale]/t/[token]/page.tsx:27` sets the cookie during Server Component render, which Next 16 rejects; it is reached only when the proxy is bypassed (M3 paths) and shows the error page with the token still in the URL. Replace with a `route.ts` 307. | traced |
| L2 | web | The token appears **twice** in the served HTML: `LocaleSwitcher.tsx:33` renders `/${other}/t/${token}` until hydration, so a copied language link shares the table credential. | confirmed |
| L3 | web | The Supabase auth cookie (`src/lib/supabase/client.ts:13`, default `@supabase/ssr` options) is not `Secure` and lives 400 days; it carries the anonymous guest's refresh token. Only `tp-table` is `Secure`. | confirmed in code |
| L4 | web | `public/brand/Touch Cafe Menu Final (standalone).html` (764 KB, inline scripts, referenced nowhere) is served on production without a CSP. Delete it. | confirmed live |
| L5 | web | PostHog's remotely-controlled features (surveys, tours, heatmaps, exception capture, external script loading) are not disabled; `sanitize_properties` scrubs top-level strings only. Matters only if `NEXT_PUBLIC_POSTHOG_KEY` is set in Vercel. | likely |
| L6 | web | The proxy writes any `/t/{string}` into `tp-table` (measured with `/t/invalidtoken123`), so a cross-site link can overwrite a guest's table cookie. Validate the token shape first. | confirmed live |
| L7 | web | `X-Powered-By: Next.js` is sent (measured); the local `127.0.0.1:54321` image pattern is always on; the CSP has no `media-src`. | confirmed |
| L8 | web | The live `service_role` JWT sits in `apps/web/.env.local` (gitignored, never committed, unused by web code, absent from builds) and in copies under `apps/web/.next/cache/turbopack/`. Remove both. | confirmed locally |
| L9 | mobile | The push token is cleared only on a user-initiated sign-out (`features/auth/api.ts:106-109`); an involuntary sign-out clears nothing and `profiles.expo_push_token` is not unique, so the next account on that phone can receive the previous guest's booking pushes. | confirmed in code |
| L10 | mobile | Android template permissions (`SYSTEM_ALERT_WINDOW`, `READ/WRITE_EXTERNAL_STORAGE`) are not in `android.blockedPermissions`. Check the built AAB manifest. | likely |
| L11 | mobile/auth | `config.toml` sets no `minimum_password_length` (GoTrue default 6) while the app enforces 8; the hosted value is unknown. | verify |
| L12 | mobile | The `own-profile` query (id, name, phone) is persisted to AsyncStorage — `src/lib/queryClient.ts:145-148` excludes only `my-bookings` and `reservation`. | confirmed |
| L13 | mobile | Unguarded `console.log('[courtperf] …')` in release code (`Court3D.tsx`, `scene.ts`); timings only. | confirmed |
| L14 | db | Telegram void authority checks `telegram_staff.is_active` only (`20260825000039_telegram_authz_line_no.sql:407`), not `staff.is_active` — a deactivated manager can still void from Telegram. | confirmed |
| L15 | db | `grant select on reservations to authenticated` (`0008:682`) lets a guest read the desk-internal columns of their own bookings (`notes`, `created_by_staff_id`, `cancellation_reason`, `device_id`, `idempotency_key`); `cancellation_reason` is unbounded and unsanitised. | likely |
| L16 | ci | `functions-deploy.yml:87-99` asserts `verify_jwt` by grepping `supabase functions list`, whose output has no such column — it cannot fail. `send-push` and `telegram-send` depend on `verify_jwt` staying on. | likely |
| L17 | db | `rpc-allowlist.json:27,33` classifies `heartbeat` and `log_replay` as public by design although both are staff-guarded, so `check:authz` never proves their guard. | confirmed |
| L18 | db | RLS is not enabled on `app.sms_limits` / `app.sms_sends` in any migration; no client grants, not reachable today. | confirmed |
| L19 | functions | `staff-admin` password reset (`index.ts:142`, `updateUserById`) does not revoke the account's sessions. | confirmed |
| L20 | db | The SMS gate's `allowed_prefixes = '{964}'` accepts any +964 number, not mobiles only — premium-number pumping up to the daily cap once OTP is on. | confirmed (dormant) |
| L21 | db | The DB test harness (`packages/db/tests/helpers.ts:10-19`, `scripts/check-rpc-authz.mjs:165`) takes the URL and service key from `packages/db/.env` with no local-only guard — the same file where `qr-artwork.mjs` needs the live key — so the destructive suite can run against production. | confirmed |
| L22 | till | LAN discovery (`lan-discover.ts:60`) presents the pairing code as a bearer token to every host that answers during the /24 sweep; a rogue listener harvests the LAN PSK. First-run only. | confirmed |
| L23 | till | `check:electron`'s REQUIRED patterns are matched against the joined text of all main-process files, so removing the settings from the main window still passes while the words occur elsewhere (reproduced by the audit on a copy). It does catch a flipped value such as `sandbox: false`. | reproduced |

---

## 3 · Tonight — before shipping

### 3.1 People, not code

**A. C1 cleanup** — outside service hours, in this order:
1. Supabase → Auth → Users: look for `@dev.touch.local` and `owner@touchpadel.local`.
2. Create the real owner and staff accounts with strong passwords (`staff-admin`, or `create-operator-owner.mjs` with
   explicit arguments — never its defaults).
3. Move the till's sign-in to a real account.
4. Deactivate every dev staff row (`set_staff_active(false)` — it also ends their sessions), then delete or ban their
   auth users.
5. Set fresh, unique PINs for every manager and owner.
6. Point the Telegram allowlist away from `Dev Owner`.
7. Read the operator's Audit log screen (not the SQL Editor — rules §1) and the Auth logs for `staff.*` events and
   money actions by the dev accounts since 2026-08-24.

**B. GitHub.** Create a fine-grained token with `contents: write` on `touchpadel-releases` only, overwrite
`RELEASES_GH_TOKEN`, then **revoke the old gh OAuth token** (overwriting the secret does not revoke it). Add a tag
ruleset restricting who may create `operator-v*`. Look at branch protection on `main` and the required reviewers on
`staging`. Delete the `ledger-snapshot-*` artifacts (M7).

**C. OTA key (M15)** — confirmed stored, or regenerated, before the store build.

**D. Supabase → Auth.** Minimum password length 8 and leaked-password protection on (L11, SEC-05); "Secure password
change" on (M2); remove `localhost` and `exp://` from the redirect allowlist and fix `site_url`; remove
`host.exp.Exponent` from the Apple client IDs once Expo Go testing is over.

**E. Vercel.** The deployed Supabase key decodes to `anon` or starts `sb_publishable_`; Deployment Protection on for
previews (every preview uses the live database); note whether `NEXT_PUBLIC_POSTHOG_KEY` is set (L5).

**F. Store listings** need the privacy and deletion URLs — built in §3.2.

**G. Venue.** Confirm the guest Wi-Fi is not on the POS network (SEC-41) — H2 is reachable from any host on the till's
network.

### 3.2 Code — each under an hour, no DB migration

| Lane | Change | Finding |
|---|---|---|
| mobile (before the store build) | Delete the `tokens` branch in `deepLink.ts` + test | M1 |
| mobile | Gate `reset-password` on a recovery exchange | M2 |
| mobile | Fix the typecheck at `TabsLayout.android.tsx:182` (CI red) | — |
| mobile | `android.blockedPermissions`; wrap `[courtperf]` logs in `__DEV__` | L10, L13 |
| web | Privacy notice + account-deletion request page, AR + EN, on the current origin; text from `stored-fields.test.ts` output, signed off by the owner | SEC-17 |
| web | `dynamicParams = false` + a tighter matcher + `/api/t` e2e | M3 |
| web | Delete the standalone HTML; token-less language link; token-shape check in the proxy; `secure` Supabase cookie; `poweredByHeader: false`; PostHog `disable_*` flags | L4, L2, L6, L3, L7, L5 |
| functions | Strip `pin` before `record()` in `replay` (merge → gated functions deploy) | M6 |
| ci | Point the snapshot at the public ledger tables | M7 |
| ci | `operator-release.yml` + `functions-deploy.yml` + `db-ops.yml` into CODEOWNERS; `environment:` gate on the release | H1 |
| ci | Pin the Supabase CLI and SHA-pin the action in the four production workflows; `permissions: contents: read` | M14 |
| ci | `db-ops.yml` action to pause/resume guest ordering | M4 |
| db | Test pair out of `config.toml`, comment corrected (merge → functions deploy) | M8 |
| db | Local-only URL guard in the DB test harness and `check-rpc-authz.mjs` | L21 |
| till | `error` listener on every socket + `maxPayload`; release `v0.2.3` only after §3.1-B | H2 |

### 3.3 Do not do tonight

- **No migration against the live database.** H3, M4, M5 and M9 change live RPC contracts or add triggers, and there is
  no staging (rules §5).
- **Do not enable CAPTCHA** until `useTableSession.ts` and the mobile sign-up pass a token — it breaks café sign-in.
- **Do not deactivate the dev accounts while the till is trading on one of them.**
- **Do not cut an operator release** before the token swap and the tag ruleset.
- **Do not `supabase config push`.**

---

## 4 · Security patches after launch

**Patch 1 — this week** (gated migrations, outside service hours)
- H3 money-RPC PIN lockout, plus weak-PIN rejection at verify time
- M4 per-table and per-user order limits, a close-table-sessions RPC, the operator kill switch
- M5 `order_items.notes` sanitised and capped; bounds on `p_device_id` / `p_idempotency_key`
- M9 cap on upcoming confirmed bookings per guest
- L9 push-token de-duplication
- M6 purge of stored PINs from `sync_replays`
- L14 Telegram authority follows `staff.is_active`
- L15 guest column grants on `reservations`; `cancellation_reason` bounded and sanitised
- L19 `staff-admin` password reset revokes sessions

**Patch 2 — next week**
- Till: M11 `ref_cache`, M12 renderer session, M13 decision, M16 CSP + permission handler, L22 pairing
  challenge-response, L23 gate scoped to the main window
- Web: open the table session server-side so the token never reaches the browser (`layer-1-rules-and-decisions.md`
  §7), L5 deep scrub via `before_send`, L1 route handler
- Mobile: L12 stop persisting the profile
- DB/CI: M10 phone de-duplication on verified phones only, L16 a working `verify_jwt` assertion, L17 registry labels,
  L18 RLS on `app.sms_*`

**Before handover — 2026-10-04**
- Electron 33 → 39 (waivers expire 2026-10-15); OV/EV code-signing certificate (SEC-14); Apple `.p8` for token
  revocation (SEC-15)
- CAPTCHA with client tokens and per-IP rate limiting (SEC-05, SEC-25); error tracking and uptime monitoring (D2, SEC-36)
- Real domain, universal links, HSTS on it (SEC-06, SEC-18); backup restore drill (SEC-38); power-cut, leaver and
  guest-Wi-Fi drills (SEC-31, SEC-35, SEC-39); rotation runbook and processor register (SEC-19, SEC-42); D1 signature
- Before phone OTP is activated: M17, L20, CAPTCHA, and a reviewer OTP pair that is not in the repository (M8)

---

## 5 · Doc claims corrected on 2026-09-13

| Claim | Where it was | What is true | Finding |
|---|---|---|---|
| "Deep links cannot carry an action" | `security-general.md` §02 | The `tokens` branch reaches `setSession` | M1 |
| "Guests cannot write order notes"; notes are capped | `security-general.md` §02, §07 (SEC-29) | Written verbatim through `create_guest_order`; the caps are client-side | M5 |
| `profiles.full_name` / `phone` are the only text a guest writes | `security-general.md` §09 (SEC-27) | Also `order_items.notes` | M5 |
| SEC-23 open / "two human steps left" | `security-general.md` §08, `security-layer-1.md`, `eas-update-signing.md` | Code done; key custody unrecorded | M15 |
| Production CSP shipped | `security-general.md` §10, §14 row 16, `security-layer-1.md` | Only on matcher-covered paths | M3 |
| `apps/web` ships zero headers, no middleware, no lint | `security-general.md` §10 intro | Stale — all three exist | — |
| Cookies are `HttpOnly; Secure; SameSite=Lax` | `security-general.md` §10, `security-layer-1.md` | True for `tp-table` only | L3 |
| Café abuse limits "mostly done" | `security-general.md` §10 | Per session; resets across tables; no kill switch | M4 |
| The token appears once in the page | `layer-1-rules-and-decisions.md` §7, `security-layer-1.md`, `HANDOFF-security.md` §6.4 | Twice | L2 |
| The `[token]` route is a defence-in-depth fallback | `security-layer-1.md` | It throws on Next 16 | L1 |
| PINs ≥ 6 digits (0078) | `security-general.md` §07 | Set-time only; older PINs verify | C1 |
| PIN lockout: 5 failures / 5 min per caller (0086) | `security-general.md` §07 | Not through the money RPCs | H3 |
| Ledger dump of `audit_log` / `stock_ledger` / `payments` | `security-general.md` §05, `security-layer-1.md`, the `db-migrate.yml` comment | Dumps the `app` schema | M7 |
| "This file is never pushed" | `config.toml:119` (code comment — left for the M8 fix) | Pushed 2026-08-24 | M8 |
| AsyncStorage holds only the query cache minus bookings | `security-general.md` §02 | The profile is persisted | L12 |
| The local schema cannot store the guest list | `security-general.md` §09 | `ref_cache` payloads hold names and phones | M11 |
| `check:electron` mutation-tested | `security-general.md` §09, `security-layer-1.md` | Catches flips, not removals | L23 |
| The push token is cleared on sign-out | `security-general.md` §08 (SEC-21) | User-initiated sign-out only | L9 |
| Quit to desktop takes a manager PIN | `install-runbook.md` §4, §6 | Removed in `6bec87d` | M13 |
| CODEOWNERS "confirmed missing" | `security-general.md` §04 | Exists; misses three workflows | H1 |
| The dependency audit fails on two critical Next RCEs | `HANDOFF-security.md` §9 | Resolved — `next@16.3.4`, gate PASS | — |

---

## 6 · Limits of this audit

- **No hosted setting was read.** Auth settings, staff rows, Vercel env, GitHub rules and artifacts are all [verify];
  a read of the hosted auth settings endpoint was deliberately not made from a laptop.
- The DB suites and e2e were not run. Catalog reads used the local stack at 87/89; 0088 and 0089 were read from SQL.
- L10 was not checked against a built AAB; H2 was reproduced against a copy of the handshake, not on a till.
- The uncommitted push-notification work in the tree (see the header) was not reviewed.

*Kagu Web Studio · Touch Padel Phase 1 · 2026-09-13*
