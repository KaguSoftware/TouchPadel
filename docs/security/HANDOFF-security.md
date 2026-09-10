# Security programme — handoff

**Written** 2026-09-07 · **Updated** 2026-09-09 (session 4) · **Branch** `kemal`

> **Session 4 corrected three things this file said.** Read §9 first if you are picking up mid-stream:
> sessions 2-3's work IS committed and merged (`97b356c`), `E2E_PROD_BUILD=1` IS wired into CI, and the
> pure-code queue in §5 is now empty.
**Read this first in any new session that touches the security lane.** It exists so the state of
the work survives a lost conversation. It is a pointer file: it records **what is true now, who
is blocked on what, and what to do next** — not the checklists themselves.

---

## 0 · Read in this order

| File | What it is |
|---|---|
| **this file** | current state, decisions, next steps |
| `docs/security/macbook-docker-checks.md` | **what has actually been EXECUTED**, with numbers. The most load-bearing file here. |
| `docs/security/security-layer-1.md` | the foundation slice — 60 boxes |
| `docs/security/security-general.md` | the full programme — phases 0–9 |
| `docs/security/layer-1-rules-and-decisions.md` | the boxes that are RULES, not code. **§1, §5 and §6 are binding.** |
| `docs/security/security-advisor-waiver-2026-09-06.md` | the four accepted `security_definer_view` findings |
| `docs/security/eas-update-signing.md` | the OTA signing runbook |

---

## 1 · The standing rules — violate none of these

These are not preferences. Each one has a documented reason and most have a gate behind them.

1. **The hosted Supabase project IS the client's live production database.** There is no staging
   (decision D1, unresolved). `db-migrate.yml` names its job `staging`; its own comment says
   otherwise. Every migration reaches real guest data with no rehearsal.
2. **Schema changes are migrations only.** `packages/db/supabase/migrations/`. Never edit the
   local DB or any dashboard by hand (`CONTRIBUTING.md`).
3. **Nothing is written to the hosted DB through the dashboard SQL Editor — ever.** No
   `insert`/`update`/`delete`/DDL, and no `select` against `profiles`, `reservations`,
   `payments`, `guest_sessions`, `audit_log` or `staff`
   (`layer-1-rules-and-decisions.md` §1). The Editor bypasses every RLS policy and leaves no
   audit trail of what was read.
4. **Never edit a committed migration.** When migration 0075 reverted a guard from 0071, the fix
   was a NEW migration (0076) merging both bodies — not an edit to a colleague's file.
5. **Every new migration opens with** `set lock_timeout = '3s'; set statement_timeout = '60s';`
   Enforced by `check:migrations`. `lock_timeout = 0` is rejected. Without it an `ALTER TABLE`
   queued behind a long Realtime transaction freezes the till mid-service.
6. **Do not tick a box you have not executed.** This is the rule the whole programme is built on
   — see §2.
7. **Do not disable anonymous sign-in** on Supabase. It is the cafe's guest identity; every table
   session boots through `signInAnonymously()` at `apps/web/src/hooks/cafe/useTableSession.ts:58`.

---

## 2 · The one thing to understand before doing anything

Until 2026-09-07 this repository **had no container runtime**, so `supabase start` had never come
up and no gate had ever run. Boxes were ticked on the strength of reading the code.

A runtime was installed and everything ran for the first time. **Two ticked boxes were false:**

- **Migration 0069** aborted with 42P01 — its post-check named `app.reservations`, a relation that
  does not exist. `supabase start` failed outright; 0070 and 0071 never applied. It would have
  failed identically on the client's live database.
- **No web security header was shipping.** The constants were written, exported, and imported into
  `next.config.ts` where nothing used them. Three separate controls should have caught it and each
  missed differently — including a CI gate that grepped for the constant NAME, which an unused
  import satisfied.

**Session 2 (2026-09-07) found four more of the same kind**, all while building the deletion spine —
which is the point: the premises were wrong in the direction of "this is smaller than it looks".

- **A second foreign key blocked account deletion and no document mentioned it.**
  `guest_sessions.auth_user_id → auth.users` is NO ACTION, so deleting a guest who ever scanned a
  table QR failed with 23503. The FK chain in §5 below listed seven relationships and not this one.
- **`reservations` and `reservation_series` carry their own `guest_name` / `guest_phone`** beside
  `guest_id`. Anonymising `profiles` alone — which is all the box asked for — would have left the
  guest's name on their bookings.
- **SEC-21's box said the `profiles` read was already "guest-only". It was not.** `0004:160` is a bare
  `grant select on profiles to authenticated`, so every court-desk session could read every guest's
  `expo_push_token`. The box recorded the *intent*, not the migration.
- **`packages/db/src/types.gen.ts` was stale**, missing `reason_given` from migration 0071. Nothing
  regenerates it in CI, so it drifts silently.

**Therefore:** re-verify a box against the code before working it, and never take this or any
other document's word for a premise. Full detail in `macbook-docker-checks.md` §4.

---

## 3 · Where the programme stands

Measured 2026-09-07 (session 2) by counting checkboxes, after reconciling `security-general.md`
§04/§05/§07/§10/§15 against what is actually in the tree.

| | done | open | ticked |
|---|---|---|---|
| `security-layer-1.md` | 34 | 25 | **58%** |
| `security-general.md` | **83** | **83** | **50%** — session 4 moved six boxes |

Session 2 moved `security-general.md` from **45 to 78 done**. Roughly half of that was BUILDING and half
was RECONCILING — Phase 5 in particular read 2/22 and was actually 15/22, because the desktop lane was
built and the checklist never caught up.

Built: the Phase 4 deletion spine (0077), SEC-20 stored-field allowlist, SEC-21 push token, the ★ authz
sweep (73→138 of 141), SEC-13 PIN strength (0078), SEC-29 LLM spend cap (0079), SEC-27 guest text
sanitising (0080), SEC-35 staff global sign-out (0081), SEC-25 café abuse limits (0082), SEC-26 table
token rotation (0083), the SEC-28 broadcast gate, the SEC-29 analytics gate, the production-build header
run, and the PR template.

**Layer 1 Block 2 — the CI gates — is 17 of 17 and all now executed.** That is the highest-leverage
section in the programme and it is the one that is complete. Phase 2 (booking and money) is 7 of 8.

**Nothing is left in Layer 1 that only needed a machine to run it.** The 25 open boxes break down
as: 12 need a dashboard or account, 7 need the client, 1 needs a purchase, 5 are deliberately
incomplete with the reasoning recorded in the box.

✅ **`security-general.md` §07 (Phase 3) is now reconciled** (session 2). The two items the previous
handoff suspected were indeed already built and running in CI — the coverage ratchet
(`rpc-coverage-floor.json`) and the data-driven allowlist (`rpc-allowlist.json`), both at
`.github/workflows/ci.yml:105`. They are ticked with their evidence. The remaining §07 items were each
re-verified against the live catalog and are genuinely open: the PIN minimum is still `^[0-9]{4,6}$`,
`staff-admin` still has no global sign-out, and the LLM insights function still has no per-day quota or
spend cap (its only "budget" is a 25-second per-request timeout).

### Open items by phase

Recounted 2026-09-07 (session 2), directly from the file:

| Phase | Open | ★ open | Note |
|---|---|---|---|
| 01 Contract | 1 | — | D1, needs a signature |
| 04 Phase 0 | 11 | 4 | **9 of the 11 need a dashboard or the client** |
| 05 Phase 1 | 5 | 2 | |
| 06 Phase 2 | 1 | 0 | |
| 07 Phase 3 | 8 | **0** | reconciled; the ★ authz sweep is closed |
| **08 Phase 4 — store lane** | **17** | **7** | **deadline 2026-09-16** — was 22/9 |
| 09 Phase 5 — desktop/offline | 21 | 3 | the largest untouched block |
| 10 Phase 6 — web/QR | 7 | 2 | |
| 11 Phase 7 — privacy/retention | 5 | — | |
| 12 Phase 8 — drills | 11 | 3 | |
| 13 Phase 9 — handover | 9 | — | |

§15 and §16 are cross-references to items above, not new work.

**Phase 4 went 22→17 open and 9→7 ★.** What moved: the FK chain, `delete_my_account`, its test, the
stored-field allowlist (SEC-20) and the push-token work (SEC-21). What is left there is mostly **not
code**: the deletion SCREEN, the web deletion page and the privacy notice (both need the domain), the
store forms themselves, universal links, and Apple's `/auth/revoke` (needs the `.p8`).

---

## 4 · What is blocked on a human, ordered by LEAD TIME not importance

None of this can be written into the repository. Each needs somebody signed in, or a purchase.
Full list: `layer-1-rules-and-decisions.md` §8.

| Item | Lead time | Blocks |
|---|---|---|
| **Domain + DNS delegation** | days–weeks, **client-gated** | web deletion page, privacy URL, universal links, auth redirect allowlist, HSTS preload, printing QR cards |
| **OV/EV code-signing certificate** | days (identity verification) | the signed **Windows** installer for `operator-shell` and the update-verification gate. ⚠ **Nothing to do with Apple** — separate platform, separate CA, separate purchase. |
| **Sign in with Apple `.p8` key** | days (Apple Developer enrolment) | Apple's `/auth/revoke` call, which account deletion **requires**. A store blocker hiding behind an account signup. |
| MFA org-wide, registrar lock, Supabase member roles | ~1 hour | SEC-40, SEC-37 |
| Branch protection + "Require review from Code Owners" + the `@KaguSoftware/tech-leads` team | ~1 hour | **`.github/CODEOWNERS` enforces NOTHING without these.** GitHub silently ignores an owner it cannot resolve. |
| CAPTCHA, redirect allowlist, leaked-password protection, JWT 30 min | ~1 hour | best done once the domain exists |
| PITR on the Supabase tier | ~1 hour | SOW promises it; if the tier lacks it that is a contract gap |

**Known live settings, read 2026-09-01:** CAPTCHA **OFF**, leaked-password protection **OFF**, and
`localhost` + `exp://` still in the redirect allowlist — while anonymous sign-in is ON. That is the
combination Supabase's own inline warning names.

### Signatures outstanding

- **D1 — one project or two.** The SOW promises "staging and production". There is one project.
  Either build staging or get a signed variation. `layer-1-rules-and-decisions.md` §5 holds the
  risk statement and signature block.
- **PostHog on the guest web app.** Technically mitigated; SOW Module 6 excludes analytics. The
  variation is SEC's call, not a technical one.
- **Bringing the hosted project to migration head** needs three preconditions
  (`layer-1-rules-and-decisions.md` §6): a **named** risk owner — a name and a date, not a role —
  a time outside service, and D1 resolved.

⚠ **Until the hosted project is at head, every green gate describes a database the venue does not
use.**

---

## 5 · What is built, and what pure code is left

### Migrations added in session 2 (all LOCAL ONLY — see §8)

| | |
|---|---|
| `0077_account_deletion` | FK surgery + `app.delete_my_account` + `profiles` grant narrowed |
| `0078_pin_strength` | PIN 4→6 digits, `app.pin_is_weak`; **seeded dev PINs changed** to 719264 / 380517 |
| `0079_llm_spend_cap` | day quota + monthly cap + `llm_usage`; gate wired into `analytics-insights` |
| `0080_guest_text_sanitising` | `app.safe_line` / `safe_text` + triggers; strips bidi and control bytes |
| `0081_staff_global_signout` | `app.revoke_user_sessions`, called by `set_staff_active(false)` |
| `0082_cafe_abuse_limits` | orders/minute and items/order per guest session, as triggers |
| `0083_table_token_prev_secret` | dual-key verify + `rotate_table_token_secret` / `clear_..._prev` |

### New gates — all wired into `.github/workflows/ci.yml`

- `check:broadcast` (SEC-28) — no money or identity on a KDS/floor topic, no whole-row payloads.
- `check:analytics` (SEC-29) — no guest identifier in any client-callable analytics/report/panel output.
- `check:electron` — **existed and had never run.** CI called
  `pnpm --filter @touch/operator-shell check:electron`, the script was not in that package's
  `package.json`, and pnpm exits **0** on a missing script. Registered; now passes and is mutation-tested.
- The header e2e now runs against `next build && next start` in CI (`E2E_PROD_BUILD=1`).

### The pure code that is genuinely LEFT

**NONE. Session 4 emptied this queue** — all six items below are done; see §9. The list is kept because
each entry records the reasoning that produced the work, and item 4's warning still stands as written.

Ordered by value. None is blocked on anybody.

1. **The in-app deletion SCREEN** (SEC-16, ★). `deleteAccount()` exists in
   `apps/mobile/src/features/profile/api.ts` and NOTHING CALLS IT. The store requirement is an in-app
   path, so the RPC alone does not satisfy it. Highest-value remaining item in the deadline phase.
2. **SEC-36 the quiet-error rule** — no stack trace, no raw Postgres error, no constraint name reaching
   a guest. Touches all three clients.
3. **SEC-13 second half** — uniform code, message and DELAY on every PIN failure path, and an audit row
   for every lockout and every manager-cleared lock. The strength rule (0078) is done; the timing and
   uniformity are not.
4. **SEC-29 prompt hardening** — ⚠ the box's stated vector does not exist (traced: guests cannot write
   order notes, and notes never enter the insights payload). The real surfaces are manager-authored menu
   names and `prior_insights`, which is model output fed back into a prompt. **Rewrite the box before
   working it.** `app.safe_line` / `safe_text` (0080) can be reused.
5. **SEC-35 client half** — drop the operator's Realtime channel on the next role-resolution failure.
   The DB half is done (0081).
6. **§11 guest anonymisation after an inactivity window** — the window itself (24 months is proposed)
   is a decision, but the mechanism is code and `delete_my_account` already does the anonymising.
7. **Phase 5 leftovers that need a PRODUCT decision, not code:** `station.ts` currently defaults a
   machine with no `station.json` to `TILL1/till` so `electron .` boots on a clean dev box — making it
   refuse to trade instead is a one-line change and a real trade-off. Same for the self-unlock PIN gap
   (a cashier has no PIN to unlock with; the box itself offers two options).

### Deliberately NOT done, with reasons

- **The per-IP café limit.** Postgres sees PostgREST, never the client IP. It belongs in front of the
  site with the other rate-limiting box; solving it in the database would have been pretence.
- **`start_count`, `verify_manager_pin`, `verify_own_pin` are outside the rls-matrix** — reasons in
  `tests/rls-matrix.ts`. The two PIN RPCs share the `app.pin_attempts` limiter that `hardening.test.ts`
  and `idle-lock.test.ts` deliberately drive to lockout and assert on; probing them as five principals
  every run would make both suites flaky. All three are covered by their own suites.
- **ESC/POS byte whitelist (SEC-27, was ★)** — not applicable as written. The receipt is rendered to a
  BITMAP by an offscreen sandboxed Chromium window; `receiptJob` takes pixels, not strings. There is no
  text field entering the builder. Closed by proving the property instead — `escpos.test.ts` builds a job
  whose entire bitmap is the drawer-kick sequence and walks the byte stream to show nothing escapes a
  `GS v 0` frame.

## 6 · Known open items I deliberately did NOT fix

Recorded rather than silently closed:

1. ~~**`E2E_PROD_BUILD=1` is set nowhere, including CI.**~~ **CLOSED — it is set**, at
   `.github/workflows/ci.yml:418`. This entry was already stale when it was written; verified
   2026-09-09. The two production-build assertions in `e2e/tests/web-security-headers.spec.ts` do run.
2. **`Cache-Control: no-store` does not survive on the rendered `/{locale}/t` page.** Next stamps
   its own `no-cache, must-revalidate` over both `headers()` and `NextResponse.next()`. Measured.
   Defence-in-depth, not access control — the session is gated by the HttpOnly cookie.
3. **`check-artifact-secrets.mjs --only=desktop` has not run locally** — it needs an Electron
   package build. CI covers it.
4. **The table token still appears once in the RSC payload.** The cookie exchange fixed `Referer`
   leakage, analytics capture, browser history, screenshots and shared links. An XSS in the guest
   app could still read it. Closing that means never sending the token to the client — a real
   refactor of the ordering boot.
5. **`extension_in_public` did not appear in the Security Advisor run.** Either the list was
   filtered to CRITICAL, or the hosted DB differs from the repo — which would be drift, a bigger
   finding than the four waived views. Re-run unfiltered.
6. **LAN KDS PSK is not rotated per shell start.** Rotating it would break every paired tablet on
   every restart without a re-pairing handshake — a feature with a UI that cannot be validated
   without a real tablet. Deliberately left.
7. **`packages/db/1h,`** — an empty file with a comma in its name, committed to `main` by mistake
   (commit `124387a`). Harmless, worth deleting.

Added session 2 (2026-09-07):

8. **`types.gen.ts` is not regenerated in CI**, so it drifts. It was stale by one migration (0071's
   `reason_given`) until this session regenerated it. Nothing detects this; a `db:types` + `git diff
   --exit-code` step would.
9. **The `apple-revoke` tripwire does not fail the suite today.** Deliberate, decided in session — a
   permanently red gate gets weakened or deleted, which `check-migrations.mjs` argues in its own header.
   It is armed on the `APPLE_*` secrets instead. If you would rather it were hard-red, that is a
   one-line change in `tests/apple-revoke.test.ts`.
10. **`guest_sessions.auth_user_id` keeps the deleted user's uuid.** The row must survive (`orders` and
    `waiter_calls` are NO ACTION onto it) and the id is retained as a pseudonymous key, consistent with
    `profiles.id`. It no longer resolves to any auth row, so it names nobody — but it does still
    correlate that guest's sessions with each other.
11. **Anonymous auth users are never cleaned up.** There is no purge job, so `auth.users` grows without
    bound from café table sessions. Out of scope here; it belongs with Phase 7 retention.
12. **The three RPCs outside the matrix** (§5 above) — recorded rather than silently skipped.
13. **Test suites leak café tables.** A full DB run leaves ~24 `T-*` rows in `cafe_tables`; 22 come from
    pre-existing suites (`T-AN`, `T-C8`, `T-DEGR`). This is not cosmetic — at ~96 rows the operator's
    table dropdown broke an e2e case that expects exactly one match, which is how it was found. The three
    suites added this session now clean up after themselves; the older ones do not.
14. **`analytics_sales_lines` returns `guest_session_id`.** Safe today — it is granted to nobody and is
    only the detail table the aggregates are built from — but if it is ever exposed, `check:analytics`
    will not see it, because that gate deliberately judges only client-callable functions.

---

## 7 · How to verify anything

```sh
pnpm db:start && pnpm db:reset && pnpm db:fixtures   # db:fixtures is NOT optional
pnpm turbo lint typecheck test build
pnpm --filter @touch/db test                          # 737 tests
pnpm e2e                                              # 48 tests, both locales
```

Gates:

```sh
for s in check:locks check:authz check:safeupdate check:migrations check:invariants \
         check:rpc-registry check:broadcast check:analytics; do
  pnpm --filter @touch/db "$s"; done
pnpm --filter @touch/operator-shell check:electron     # the 9th gate lives in the shell package
for f in scripts/security/*.mjs; do node "$f"; done   # artifact-secrets needs --only=<client>
```

Expected numbers, all green 2026-09-07 at the end of session 3: **737** DB tests · **185** operator-shell
tests · **48** e2e · **23/23** turbo tasks · **12** views / 8 invoker / 4 owner-rights · every definer
function pins `search_path` · **141** RPCs, 20 public by design / 121 guarded · **138/141** covered by
`rls-matrix` (the 3 are the documented exclusions).

Gates, all PASS: `check:locks` `check:authz` `check:safeupdate` `check:migrations` `check:invariants`
`check:rpc-registry` `check:broadcast` `check:analytics` (db) and `check:electron` (operator-shell).
Of `scripts/security/*.mjs`, five pass and `check-artifact-secrets.mjs` needs built client artifacts —
pre-existing, see §6.3.

(The previous handoff recorded "19/19 turbo tasks". The real figure for
`pnpm turbo lint typecheck test build` is 23; no task was added this session.)

⚠ `pnpm e2e` has a **flaky** case: `operator-cafe-admin.spec.ts:313` ("an item-ready mark survives a
reload") fails intermittently under full-suite load with "element is not stable", and passes in
isolation and on a re-run. Not caused by this session's changes — re-run before investigating.
Session 3 ran the full suite and got **48/48 clean**, so the flake is genuinely intermittent rather
than a standing failure. Session 3's run also logged repeated
`upstream image response failed … menu-media/…/01HZZ.webp 400`: a seeded menu item points at a media
object never uploaded to local storage. Pre-existing seed gap, no test depends on it, nothing in the
security lane touches storage.

A differing count is more informative than a differing verdict — see `macbook-docker-checks.md` §6.

---

## 8 · Session state, and what pushing actually does

### Where the branch is

Branch `kemal` is **6 commits ahead of `origin/main`** and **level with `origin/kemal`**
(`git rev-list --left-right --count origin/kemal...HEAD` -> `0  0`). Session 2 and 3's work is
**staged but NOT COMMITTED** — 49 files, ~5550 insertions. `git status --short` is the authority.

```
33d89fd  Docker file and handoff
4666bd2  docs(security): handoff file so the programme survives a lost session
9a8bba5  docs(security): record what the MacBook Docker run actually verified
22ce202  e2e: the printed QR URL is exchanged, not preserved
b8689e4  Merge branch 'main' ... into kemal
25d84af  security: fix headers never shipping, two migration bugs found by first run
```

**There is nothing to push yet.** The work exists only in the index. A push today is a no-op.

### Session 3 — verification only, one gap closed

No new features. Session 3 re-ran everything uncached and audited the changes that could break
something a green suite would not notice:

- **`profiles` grant narrowing** — `expo_push_token` / `deleted_at` are no longer selectable by
  `authenticated`. Exactly one client SELECT exists and it names its columns. `service_role` retains
  all seven columns, so `send-push` still resolves tokens. Push notifications are unaffected.
- **The Arabic sanitiser** (0080) rewrites guest input on every write. Verified against real data:
  Arabic names, Arabic-Indic digits and emoji pass through byte-identical; only the invisible
  spoofing characters (ZWNJ, RLM/LRM, RLO, BOM) are stripped. The app ships `ar` and `en` only, so
  the ZWNJ strip has no Kurdish/Persian morpheme to damage.
- **The till queue v3 -> v4 upgrade was UNTESTED.** The code comment claimed a pre-v4 plaintext queue
  keeps replaying; nothing proved it. This is the update a station performs mid-service, and getting
  it wrong is unsent sales lost with no trace. Session 3 added two tests to `queue.test.ts` (hence
  183 -> **185**) and mutation-tested them: breaking the `enc !== 1` plaintext branch in
  `decodePayload` turns the peekNext test red. The claim now holds by test, not by comment.
- **CI script cross-check.** All 9 `check:*` scripts referenced by `ci.yml` exist in the package that
  CI names. This is checked BY HAND each session because `pnpm` exits **0** on a missing script —
  the false-green that hid `check:electron` for the whole life of the repo. All four workflow files
  parse as YAML.

### Deliberate behaviour changes someone should sign off

Not bugs — choices, each of which changes how the venue operates:

1. **A till that cannot encrypt now REFUSES to queue an offline sale** rather than falling back to
   plaintext (`QueueEncryptionUnavailableError`). Security over availability. If `safeStorage` is
   unavailable on a venue PC, that station stops trading offline instead of writing staff PINs to
   disk in the clear. This is the one change that can stop a till taking money.
2. **Café rate limits** — 6 orders/minute, 40 items/order, tab confirm at 150,000 IQD. All three live
   in `venue_settings`, so they are tunable without a migration. The numbers are guesses about a
   venue nobody has watched during a rush.
3. **Deactivating a staff member now kills their sessions globally** (0081), not just at that till.
4. **The seeded dev PINs changed** to `719264` / `380517`. `111111` / `222222` are refused by 0078.

### What a push actually triggers

Verified by reading the `on:` block of every workflow:

| Action | `ci.yml` | `db-migrate.yml` | Touches the client's live DB |
|---|---|---|---|
| Push branch `kemal` | no | no | **no** |
| Open a PR into `main` | **yes** | no | **no** |
| Merge to `main` | yes | **yes** (paths: `migrations/**`) | **YES** |

`ci.yml` runs on `pull_request` and pushes to `main`. `db-migrate.yml` runs on `workflow_dispatch` and
pushes to `main` that touch `packages/db/supabase/migrations/**`.

So: **committing and pushing the branch is safe, and opening a PR is the correct next step** — the PR
is the first time these 9 gates and 737 tests run anywhere but this laptop.

**Merging is the dangerous step, and it is NOT ready.** On merge, `db-migrate.yml` pushes migrations to
the linked Supabase project, which is the client's **live production database**. Before a merge:

- [ ] The `--include-all` decision (§6). Without it the push **fails loudly and applies nothing** —
      `LegacyDbPushMissingRemoteError`, because 0069 and 0071 sort before the hosted head. That failure
      is a safe outcome, not a corruption, but it means the merge silently achieves nothing.
- [ ] **Required reviewers on the `staging` GitHub Environment.** `db-migrate.yml` binds to
      `environment: staging` to get a human gate — but with no reviewers configured that binding is a
      **no-op** and the migration applies the moment someone merges. Configure this FIRST.
- [ ] `supabase migration list --linked` actually run. "The hosted project is at 0075" is an
      **assumption**; nobody in sessions 1-3 could reach the hosted project.
- [ ] The three preconditions in `layer-1-rules-and-decisions.md` §6: a **named** risk owner (a name
      and a date), a time outside service, and D1 resolved.

⚠ **Migrations 0077-0083 have run against the LOCAL stack ONLY.** Between them they drop two foreign
keys, narrow a grant, change the seeded staff PINs, add triggers to `profiles`, `reservations`,
`orders` and `order_items`, and re-issue `verify_table_token`, `set_staff_active`, `set_staff_pin` and
`customer_search`.

**Commit and push before starting a new session** — a fresh session cannot see local commits, and
nothing here is even committed yet.

---

---

## 9 · Session 4 (2026-09-09) — the pure-code queue, emptied

### What this file got wrong, and now says correctly

1. **§8 said "nothing is committed" and "there is nothing to push yet".** Both were true when written
   and are not now. Sessions 2-3's 49 files are committed and **merged into `main`** as `97b356c`
   ("Security Full code implementation , verified rotating left"). Migrations 0077-0083 are on `main`.
   A session picking this up must not go looking for lost work.
2. **§6.1 said `E2E_PROD_BUILD=1` is set nowhere.** It is set, `ci.yml:418`.
3. **The migration count moved on.** 0084 (`tab_seat_anchor`) and 0085 (`cancel_empty_tab`) arrived from
   another lane; the client-callable RPC total went 141 → 143 before session 4 added two of its own.

### Built

| | |
|---|---|
| **SEC-16** in-app deletion screen | `app/delete-account.tsx` + `features/profile/{deletion,localPurge,purgeKeys}.ts` + `lib/authStorageKey.ts`. 21 tests. |
| **SEC-36** quiet-error gate | `scripts/security/check-quiet-errors.mjs`, CI-wired, mutation-tested both ways. One real fix in `useOrders.loadError`. |
| **SEC-13** PIN uniformity | migration **0086** + `pin-uniformity.test.ts` (12) + a new `check:invariants` lock. |
| **SEC-35** client half | `lib/roleResolution.ts` + `auth.tsx`. 16 tests, 3 mutants caught. |
| **SEC-32** station identity | `main/station.ts` `canTrade()`, guards on enqueue/lanStatus/print. 14 tests. |
| **SEC-34** self-unlock gap | migration **0087** `app.has_own_pin()` + the lock screen. 6 tests. |

### Bugs found by writing the tests, not by reading the code

The programme's premise again: **the tests found things review did not.**

1. **The lockout audit row silently disabled the lockout.** `audit_log.entity_id` is NOT NULL; the first
   version of 0086 passed `null` there, so the whole transaction aborted — taking the `pin_attempts`
   INSERT with it. The fifth failure was never recorded and `PIN_LOCKED` never engaged. This is the 0011
   failure mode wearing a different hat, and it was green on inspection.
2. **`verify_manager_pin` answered a CORRECT pin faster than a wrong one**, because only the second of
   its two bcrypt scans could stop early. Real, and the direction that matters.
3. **`idle-lock.test.ts`'s cleanup had never run**, for the life of the suite. `svc.from('pin_attempts')`
   resolves to `public.pin_attempts`, which does not exist (the table is in `app`); PostgREST returned
   PGRST205 and the error was never checked. It now asserts the delete landed.
4. **A `station.json` with no `station_id` reported `configured: true` and traded as TILL1** with no
   error anywhere. The missing-FILE path was handled; the incomplete-file path was not.
5. **The SEC-36 gate's own first pattern missed the cast form** — `setError((err as Error).message)`,
   which is the shape that actually occurs in TypeScript. Found by mutating it, not by reading it. A gate
   that has only ever been seen to pass is indistinguishable from one that matches nothing.

### Deliberate behaviour changes someone should sign off

1. **Every manager authorisation now takes ≥250 ms** (0086's delay floor), on the money path — a
   discount, a void, a refund — and holds its connection for that time. It is what makes match and
   mismatch indistinguishable regardless of the bcrypt cost factor.
2. **A machine with an incomplete `station.json` now refuses to queue a sale, print, or announce itself
   on the LAN.** Previously it traded as TILL1. It still BOOTS — the setup screen that fixes it is
   rendered by that same window.
3. **The operator re-reads the staff role every 60 seconds** and drops its Realtime channels on a
   definite revocation. A transient failure explicitly changes nothing.
4. **A staff member with no PIN now sees the password field immediately** on the idle lock, and stays on
   it. `verify_own_pin`'s `NO_PIN_SET` fallback remains as the backstop.

### Verified 2026-09-09, executed not assumed

Container runtime up (OrbStack), `pnpm db:reset && pnpm db:fixtures` from scratch — **0086 and 0087
apply cleanly on a virgin database**, which is the check migration 0069 exists to remind everyone of.

**770** DB tests · **601** operator · **516** mobile · **183** web · **25** i18n · **189/190**
operator-shell. `pnpm e2e` is red for reasons predating this work — see item 5 below.
All 8 DB gates + `check:electron` PASS — `check:migrations` scoped to the two new files
(`--base=HEAD` with them staged); it is red against a freshly-fetched `origin/main` for the branch
reason in item 6, not for anything in these migrations. Six of seven `scripts/security/*.mjs` PASS.
RPC coverage ratcheted **138/141 → 141/144**; the 3 uncovered are the documented exclusions.

### Open, and NOT mine to have closed

1. ⛔ **`check-dependency-audit.mjs` FAILS — 5 un-waived advisories at high or above, including TWO
   CRITICAL unauthenticated-RCE Next.js issues** (GHSA-p293-qw3h-jr36 windows-hosted RCE, and
   GHSA-2xp9-vwfh-vxw4 RCE in the Image Optimization API when AVIF files are used — `apps/web` serves
   menu media). Installed `next@16.3.2`; **both are fixed in 16.3.3**, a patch bump. Also HIGH: `sharp`
   (via next), `extract-zip` (via electron), `js-yaml` (via expo). This is pre-existing and NEW since
   2026-09-07 — freshly published advisories, not a dependency change. It is deliberately NOT bundled
   into this change set: a dependency bump on the guest-facing app deserves its own PR and its own
   verification. **It is the most urgent thing in this file.**
2. ⛔ **`pnpm turbo lint` is RED on `main`** and not because of the security lane:
   `apps/mobile/src/components/Court3D.tsx:107` imports `frameRepaints` and never uses it
   (`@typescript-eslint/no-unused-vars`, an error not a warning). Introduced by `2829d14`. One line.
   Left for that lane's owner rather than edited from here.
3. **`better-sqlite3` is ABI-flipped to NODE** on this machine (`pnpm --filter @touch/operator-shell
   native:node`) so the shell suite can run. `pnpm dist` and the release workflow flip it back. The
   package's own README field documents this; it is not a change, just state to know about.
4. **`lan-discover.test.ts > sweeps many hosts` times out at 10s on this machine.** It does a real TCP
   sweep of the local /24 and imports nothing session 4 touched. Environment-dependent, pre-existing.
5. ⛔ **`pnpm e2e` is RED: 12 operator specs fail, 32 pass, 4 do not run.** (Session 3 recorded 48/48.)
   `operator-stock.spec.ts:88` fails as `ingredients` never reaching the database after the UI reports
   "Saved." — the write does not land — and the other eleven are the same family across
   `operator-journey` and `operator-cafe-admin`.
   **PROVEN NOT to be the security lane**, by two controlled runs: with session 4's two operator files
   stashed it fails identically, and with those stashed AND migrations 0086/0087 removed from a fresh
   `db:reset` it fails identically again. The cause is on `main` at `bb77c04`. Somebody who owns the
   operator lane needs to look at it; the traces are under `test-results/`.
6. ✅ **RESOLVED — the branch was replayed onto the rewritten `main`.**
   `kemal` had been cut before the repo-wide history rewrite, so it and `main` shared no usable
   ancestry: 181 commits on each side, 180 with identical subjects — the same work under different
   hashes. That was not cosmetic. It would have shown 181 phantom commits on a PR, it made
   `check:migrations` scope itself back to 2026-08-30 and judge **33** historical migration files
   (failing on 0067/0075), and — the serious one — three of those pre-rewrite commits still carried
   the AI co-author trailers the rewrite existed to strip, so pushing the branch would have put them
   back into the repository.
   Fixed by replaying the branch's three real commits onto `origin/main` and discarding the 181
   duplicates. **The resulting tree hash is unchanged** (`f05dd13…`), so nothing was lost — verified
   against the pre-cleanup tip before and after.
   ⚠ Note the trap for next time: **before `git fetch`, `origin/main` was a stale ref and the count
   read `0  0`.** The divergence is invisible from `git status` and from an unfetched `git log`.
   A branch cut before the rewrite must be replayed, never merged — merging re-imports the very
   commits the rewrite removed.

5. **The 250 ms PIN floor is a constant, not a `venue_setting`.** Deliberate — a tunable security floor
   is one somebody eventually tunes to zero — but it is a decision, so it is recorded rather than buried.

*Kagu Web Studio · Touch Padel Phase 1 · 2026-09-09*
