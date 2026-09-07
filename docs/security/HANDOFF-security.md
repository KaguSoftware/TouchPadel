# Security programme — handoff

**Written** 2026-09-07 · **Branch** `kemal` · **HEAD** `9a8bba5`
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

**Therefore:** re-verify a box against the code before working it, and never take this or any
other document's word for a premise. Full detail in `macbook-docker-checks.md` §4.

---

## 3 · Where the programme stands

Measured 2026-09-07 by counting checkboxes, after reconciling `security-general.md` §04/§05/§10/§15
against Layer 1's completions (those sections duplicated Layer 1 work and had never been reconciled;
§05 read 0/18 while eleven were done and running in CI).

| | done | partial | open | ticked |
|---|---|---|---|---|
| `security-layer-1.md` | 34 | 1 | 25 | **56%** |
| `security-general.md` | 45 | 3 | 121 | **26%** |

**Layer 1 Block 2 — the CI gates — is 17 of 17 and all now executed.** That is the highest-leverage
section in the programme and it is the one that is complete. Phase 2 (booking and money) is 7 of 8.

**Nothing is left in Layer 1 that only needed a machine to run it.** The 25 open boxes break down
as: 12 need a dashboard or account, 7 need the client, 1 needs a purchase, 5 are deliberately
incomplete with the reasoning recorded in the box.

⚠ **`security-general.md` §07 (Phase 3) has NOT been reconciled** the way §04/§05/§10/§15 were.
At least two of its items are already done and still show open — "track the covered/granted ratio
and fail on regression" and "store the allowlist as data" both landed in Layer 1
(`rpc-coverage-floor.json`, `rpc-allowlist.json`). Reconcile §07 before working it.

### Open items by phase

| Phase | Open | ★ hard gates | Note |
|---|---|---|---|
| 01 Contract | 1 | — | |
| 04 Phase 0 | 11 | 4 | **9 of the 11 need a dashboard or the client** |
| 05 Phase 1 | 5 | 2 | |
| 06 Phase 2 | 1 | 0 | |
| 07 Phase 3 | 11 | 1 | ⚠ not reconciled; ≥2 already done |
| **08 Phase 4 — store lane** | **22** | **9** | **deadline 2026-09-16** |
| 09 Phase 5 — desktop/offline | 21 | 3 | |
| 10 Phase 6 — web/QR | 7 | 2 | |
| 11 Phase 7 — privacy/retention | 5 | — | |
| 12 Phase 8 — drills | 11 | 3 | |
| 13 Phase 9 — handover | 9 | — | |

§15 and §16 are cross-references to items above, not new work.

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

## 5 · What can be built with no human input — the next four steps

Roughly 40 of the 121 open items are pure code with no external dependency. In priority order:

### Step 1 — the account-deletion spine (Phase 4, 5 of its 9 ★ gates)

The largest ★ cluster in the deadline-bearing phase, and none of it needs the domain.

The FK chain, verified:

```
profiles.id       → auth.users(id)  ON DELETE CASCADE      0004:9
reservations.guest_id → profiles(id)  (no action)          0008:21
push_outbox.profile_id → profiles(id) ON DELETE CASCADE    0024:21
customers/loyalty → profiles(id)    ON DELETE CASCADE      0065:75,87
guest_sessions.linked_profile_id → profiles(id)            0014:32
reservation_series.guest_id → profiles(id)                 0066:60
promotions.customer_id → profiles(id)                      0067:136
```

Deleting the auth user cascades the profile away, which then **fails** against
`reservations.guest_id` — or worse, succeeds on the tables that cascade and silently destroys the
customer and loyalty history the venue needs for statistics.

The decision the box calls for: **break the cascade on `profiles.id`** so an anonymised profile row
survives its auth user. That is a migration that has to be right the first time on a live database.

Then: `app.delete_my_account()` as `SECURITY DEFINER` with a pinned `search_path` — anonymise the
name, null phone and email, clear the push token, write an audit row, delete the auth user, revoke
sessions globally.

Tests: no name/phone/email remains, reservations still count in statistics, the audit row exists,
the auth user is gone, an old refresh token no longer mints a JWT.

⚠ **Stub Apple's `/auth/revoke` edge function with a FAILING test** until the `.p8` exists, so it
cannot be quietly forgotten. Design note: `docs/design/social-signin-2026-09-01.md`.

### Step 2 — `[CI]` stored-field allowlist test (SEC-20)

A `packages/db` test asserting the exact column set of the guest-facing tables. Both stores' data-
safety forms get filled **from that test's array**, not from memory. A paragraph drifts; a test goes
red.

### Step 3 — push-token cleanup (SEC-21)

Already done: cleared on an Expo `DeviceNotRegistered` ticket (`send-push:182`), never logged.

**Still open**, all three verified in the code 2026-09-07:

- **Clear it on sign-out.** `apps/mobile/src/features/auth/api.ts:92` calls `auth.signOut()` and
  nothing else.
- **Clear it on account deletion** — no path exists yet; it belongs inside
  `app.delete_my_account()` from Step 1.
- **Narrow the `profiles` select grant.** ⚠ The checklist calls this "guest-only read" and that is
  **not what the migration does**: `0004:160` is a bare `grant select on profiles to authenticated`
  — the whole table — and the `profiles_select` policy at `0004:163` reads
  `id = auth.uid() or app.is_staff('court_desk','manager','owner')`. So **any court-desk user can
  read every guest's `expo_push_token` today.** The fix is the column-level grant the `staff` table
  already gets at `0004:171`, which is exactly how `pin_hash` is kept unreadable.

### Step 4 — Phase 3 authz coverage, 72 → 139

The single largest block of open code work. **Reconcile §07 first** (see §3). Extend the existing
`tests/rls-matrix.ts` — 8 principals — rather than building a second sweep. 67 RPCs still have no
rule, including `override_price`, `void_after_send`, `apply_pct_discount`, `merge_tabs`,
`split_by_item` and the `analytics_*` family. `check:rpc-registry` prints them on every run.

*(`check-rpc-authz.mjs` passes NULL for every argument by design — it is the blunt net, not the
realistic pass.)*

### Also unblocked, smaller

- PIN minimum 4 → 6 digits; reject repeated and sequential runs; uniform failure code, message and
  delay on every path (SEC-13)
- The quiet-error rule: no stack traces, no raw Postgres errors, no constraint names reaching a
  guest (SEC-36)
- A per-day call quota and hard monthly spend cap on the LLM insights function — every cafe guest
  holds an `authenticated` JWT, so an uncapped model endpoint is an uncapped bill (SEC-29)
- Treat retrieved text as data before it enters a prompt; guest-written order notes reach a prompt
  the owner reads as advice (SEC-29)
- Assert prep never receives a price, total or guest field in a broadcast payload (SEC-28)
- Global sign-out on staff disable — the DB half is already done (SEC-35)

---

## 6 · Known open items I deliberately did NOT fix

Recorded rather than silently closed:

1. **`E2E_PROD_BUILD=1` is set nowhere, including CI.** Two assertions in
   `e2e/tests/web-security-headers.spec.ts` — the absence of `unsafe-eval` and the inline-script
   nonce — are production-build properties and have therefore **never executed on any machine**.
   CI must run that suite against `next build && next start`.
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

---

## 7 · How to verify anything

```sh
pnpm db:start && pnpm db:reset && pnpm db:fixtures   # db:fixtures is NOT optional
pnpm turbo lint typecheck test build
pnpm --filter @touch/db test                          # 594 tests
pnpm e2e                                              # 48 tests, both locales
```

Gates:

```sh
for s in check:locks check:authz check:safeupdate check:migrations check:invariants check:rpc-registry; do
  pnpm --filter @touch/db "$s"; done
for f in scripts/security/*.mjs; do node "$f"; done   # artifact-secrets needs --only=<client>
```

Expected numbers, all green at HEAD `9a8bba5`: **594** DB tests · **48** e2e · **19/19** turbo tasks
· **12** views / 8 invoker / 4 owner-rights · **215/215** definer functions pin `search_path` ·
**139** RPCs, 20 public by design / 119 guarded.

A differing count is more informative than a differing verdict — see `macbook-docker-checks.md` §6.

---

## 8 · Session state as of this file

Branch `kemal`, **5 commits ahead of `origin/main`**, working tree clean:

```
9a8bba5  docs(security): record what the MacBook Docker run actually verified
22ce202  e2e: the printed QR URL is exchanged, not preserved
b8689e4  Merge branch 'main' … into kemal
90c86eb  Merge branch 'main' … into kemal
25d84af  security: fix headers never shipping, two migration bugs found by first run
```

**Nothing is pushed.** Push before starting a new session — a fresh session cannot see local
commits, and `25d84af` carries the header fix and the two migration fixes.

---

*Kagu Web Studio · Touch Padel Phase 1 · 2026-09-07*
