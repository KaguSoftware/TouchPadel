# Touch Padel — Security Layer 1 (Foundation)

**Version** 1.0 · **Date** 2026-08-30 · **Owner** DEV, with SEC signing off
**Parent** `docs/security/security-general.md` — the full checklist. This file is the slice you do **first**.
**Verified against** the repository at commit `3a6d8f5`, 2026-08-30.

---

## What Layer 1 is

The security that has to exist **underneath** feature code: the floor everything else stands on. It is
foundational not because it is the most dangerous, but because it is the most expensive to retrofit —
every one of these items gets harder the more code sits on top of it.

**What it is not:** the feature-level security. Booking money integrity, the offline queue, printer byte
whitelisting, store submission, retention policy — none of that can be written before the features exist.
Those live in `security-general.md`, phases 2 and 4 through 9.

Sixty boxes. **Target: landed inside one week**, minus the two that cannot be (see below). After that the 17 in Block 2 are permanently a
machine's problem and stay ticked.

**Two boxes will not fit in a week no matter who drives them**, so start them today and plan around them:
the **OV/EV code-signing certificate** (identity verification plus issuance, measured in days) and the
**domain and DNS delegation** (waiting on the client, and it blocks the auth redirect allowlist, HSTS,
universal links, the privacy URL and printing QR cards).

---

## Read this first — what you do not need to build

The repository is at migration 55 with 21 DB test suites. A great deal of Layer 1 is already done, and the
previous audit (v1.0, 2026-08-29) was wrong about most of it. Do not start by rebuilding these:

| Already true | Where |
|---|---|
| **RLS on every table** — 55 of 55, 69 policies | every migration |
| **Default privileges revoked** from `anon`/`authenticated` on future tables, sequences and functions | `0003:22-29` |
| **`app.staff_role()` returns NULL for a disabled account** | `0003:50` |
| **Append-only ledgers** — trigger + revoked `UPDATE`/`DELETE` on audit log, stock, payments | `0003:39`, `0005:25`, `0018:48`, `0015:1342` |
| **`search_path` pinned — 159 of 159 functions, zero offenders** across 235 definer statements | migrations |
| **Views already correct** — 12 views, 8 `security_invoker = on`, 4 deliberate audited projections | `0019`, `0020`, `0006`, `0029`, `0013`, `0008` |
| **`pgcrypto` already in `extensions`, `pg_cron` in `cron`** — only `btree_gist` is unpinned | `0009`; `0001:5` |
| **A realistic-argument, multi-principal authz pass already runs in CI** — `tests/rls-matrix.ts`, 8 principals, 50 RPC rules | `.github/workflows/ci.yml` |
| **`verify_jwt` declared per edge function** | `config.toml:84-100` |

Three CI gates also already exist and work — `check:authz`, `check:locks`, `check:safeupdate` in
`.github/workflows/ci.yml`. Everything in Block 2 below extends that pattern; you are not inventing it.

---

## Block 0 · Decisions that gate everything else

These are not code. They are unanswered questions that make Layer 1 work either correct or wasted. Settle
them in week 1 or the rest of this file is guesswork.

- [ ] **D1 — one project or two.** The signed SOW (Module 1, INCLUDED) promises "staging and production
      environments". There is one Supabase project and it is the client's live database. `db-migrate.yml`
      names its job `staging` while its own comment says the linked project is "the CLIENT'S long-term
      production database". Either build staging or get a signed variation. **Everything about access
      control, seeding and migration safety depends on the answer.** (SEC-37 · SEC+CLIENT)
- [x] **Guest sign-in — settled.** Email + password. SOW Module 1 NOT INCLUDED lists "Phone / SMS
      one-time-code login" explicitly, with a written rationale. The Security Layer v1.1 §5.2 recommendation
      of phone + OTP contradicts the contract; ignore it and correct the standard. (SEC-22)
- [ ] **Venue PC policy, in writing from the client.** BitLocker, OS auto-updates, 5-minute screen lock,
      no shared Windows admin account, and guest wifi on a separate VLAN from the POS. The offline queue and
      `pin_cache` live on that disk — if nobody manages the machines, Block 4 gets stricter. (SEC-41 · CLIENT)
- [ ] **The domain.** Blocks the privacy URL, the deletion URL, the auth redirect allowlist, HSTS and
      printing QR cards. Ask today, delegate DNS today. (SEC-06 · CLIENT)
- [ ] **Account ownership at handover** — transfer the existing accounts or re-create in the client's name.
      Longest-lead item in the project. (SEC-42 · CLIENT)
- [ ] **Supabase plan tier and PITR.** The SOW promises point-in-time recovery. Confirm it is available on
      the current tier; if not, that is a contract gap, not a preference. (SEC-38 · SEC)

### Technical decisions — settle these before writing code, not mid-list

Four boxes further down are **decisions**, not implementation. Each has more than one defensible answer and
each changes the code around it, so answering them while already halfway through the work means rewriting.
Decide them first; the boxes then become ordinary tasks.

- [ ] **The table token in the URL** — exchange it for a cookie on first load, or accept it in writing with
      the `Referrer-Policy` and analytics mitigations. Not a small change: it touches `proxy.ts`, the session
      boot in `useTableSession.ts`, and the relationship with QR cards that may already be printed.
      *(Box in Block 4 · Web.)*
- [ ] **PostHog on the guest cafe app** — remove it, or get a signed variation. This is a contract question,
      not a technical one: SOW Module 6 NOT INCLUDED lists "Analytics, marketing tags or advertising pixels".
      *(Box in Block 4 · Web.)*
- [ ] **`pin_cache` on the venue PC** — encrypt via `safeStorage`, restrict to the roles that need it, or
      drop offline PIN unlock. All three are defensible; one must be chosen before the Electron work lands.
      *(Box in Block 4 · Desktop.)*
- [ ] **Who accepts the risk of bringing the hosted project to head.** The write itself is routine; the
      context is not — it lands on the client's live database, over real guest data, with no staging
      rehearsal. Name the person who accepts that the venue may not trade if it goes wrong, and pick a time
      outside service. *(Box in Block 3.)*

---

## Block 1 · Accounts and access — no code, hours not days

- [ ] ★ **MFA org-wide**: GitHub, Supabase, Vercel, PostHog, Expo, Apple, Google, and the domain registrar.
      Recovery codes sealed to the client's owner, never to a Kagu inbox. (SEC-40 · CLIENT+SEC)
- [ ] **Registrar lock** on the domain once it exists. Losing the domain is losing the venue's front door.
      (SEC-40 · SEC)
- [ ] **Supabase member roles**: SEC and DEV as Owner/Admin; FE1 and FE2 as Developer with **no SQL Editor
      access to the hosted project**. With one project, access control *is* environment separation.
      (SEC-37 · SEC)
- [ ] **`.github/CODEOWNERS`** routing `packages/db/supabase/migrations/` and
      `.github/workflows/db-migrate.yml` to the technical lead; enable "Require review from Code Owners" on
      the `main` ruleset. **Confirmed missing — there is no CODEOWNERS file today.** (SEC-01 · SEC)
- [ ] **Re-verify required reviewers on the `staging` GitHub Environment.** They were enabled on 2026-08-27,
      before the secrets went in (`HANDOFF.md:542-546`) — the correct order. But this is a GitHub UI setting
      with **no repo artifact**: it can be edited or deleted at any time leaving no git trace, and the job it
      guards pushes straight to the client's production database (the job is named `staging`; the real
      `production` job is commented out). Confirm it by looking, add it to the freeze pass, and never take
      prose as evidence for it. (SEC-02 · DEV+SEC)
- [ ] **Branch protection on `main`**: no direct pushes, one approving review, CI green before merge.
      (SEC-01 · SEC)

---

## Block 2 · The repo gates — `[CI]`, land these once

The highest-leverage work in the whole programme. Each one replaces a judgement somebody would otherwise
have to make on every pull request forever.

> **Four of these go red the moment they land, and that is correct — but it means you cannot land them all
> at once.** Fix first, then fit the gate, or `main` sits red and people learn to ignore it:
>
> | Gate | Goes red because | Land it after |
> |---|---|---|
> | `check:electron` | `sandbox: false` today | the preload bundle + `sandbox: true` fix in Block 4 |
> | Authz coverage counter | 50 of 121 RPCs covered | you have raised coverage, or set the initial floor at 50 and ratchet up |
> | Web header e2e assertions | no headers ship today | the `headers()` block in Block 4 |
> | `check:migrations` | 11 legacy constraint sites, 48 non-concurrent indexes | never — scope it to changed files instead (see below) |
>
> The other thirteen pass or fail honestly on the current repo and can land immediately.

### Secrets
- [ ] ★ **`gitleaks` over full history**: `gitleaks detect --source . -v --log-opts="--all"`. Not just the
      working tree. **Confirmed absent — `gitleaks` appears nowhere in the repo**, despite Security Layer
      §9.2 and §11.3 both stating it runs in CI and fails the build. The standard describes an intention.
      (SEC-24 · DEV)
- [ ] Rotate anything it finds, in rotation-runbook order. (SEC-24 · DEV)
- [ ] ★ **Built-artifact secret grep** on all three clients: the Expo bundle, `.next/static`, and the
      Electron `app.asar`. Search `service_role`, `sb_secret`, `role":"service_role"`. Code review is not
      evidence. (SEC-24 · DEV)
- [ ] **`NEXT_PUBLIC_` / `EXPO_PUBLIC_` naming check** — fail if any such name matches
      `/SECRET|KEY|TOKEN|PIN|HMAC/`. (SEC-24 · DEV)
- [ ] **Lint rule: no `service_role` in client paths.** Security Layer §11.3 lists this as a merge-blocking
      gate. It does not exist. There is no root eslint config — only `apps/mobile`, `apps/operator` and
      `apps/operator-shell` have one, and **`apps/web` has no lint script at all**, which is also the only
      app with no login. (SEC-24 · DEV)
- [ ] **`pnpm audit --audit-level=high` + Dependabot.** Neither is configured. (SEC-24 · DEV)
- [ ] Confirm `.env*`, `.env.remote` and `station.json` are absent from git **history**, not just ignored.
      `.gitignore` already covers `.env`, `.env.*`, `station.json`, `*.pem`, `*.p12`, `*.keystore`.
      (SEC-24 · DEV)

### Migrations
- [ ] ★ **`check:migrations` — and scope it to lock-taking DDL, not just object drops.** The obvious
      drop-only rule lands green on this repo while missing every real hazard in it:
      **11 of 12 `add constraint` statements omit `NOT VALID`** (`0027:50,54,58,63`, `0030:35,40`,
      `0054:37,141`, `0019:33`, `0008:43`) — each takes `ACCESS EXCLUSIVE` plus a full validating scan on a
      table that already holds live data — `0039:71` is a three-statement blocking sequence on `order_items`,
      and **0 of 48 `create index` statements use `CONCURRENTLY`**. Exactly one site uses the safe
      `NOT VALID` → `VALIDATE` pattern, so the pattern is known and simply not applied. Fail on all of that,
      plus `DROP TABLE` / `DROP COLUMN` / `TRUNCATE` / `ALTER COLUMN … TYPE` / unpaired `DROP POLICY`,
      unless the PR body carries `MIGRATION-RISK-ACCEPTED:` with a reason.
      ⚠ **Scope the check to the migration files changed in the pull request, not the whole directory.**
      The existing 11 constraint sites and 48 non-concurrent indexes are already applied and cannot be
      rewritten; a whole-directory scan turns `main` red on history and the rule gets weakened or deleted
      within a day. Grandfather what is committed, guard what arrives. (SEC-02 · DEV)
- [ ] ★ **Nightly `supabase db diff --linked`**, failing on non-empty output. "We are behind" becomes a
      build failure instead of a memory. (SEC-03 · DEV)
- [ ] Data-only dump of the ledger tables as a retained CI artifact **before** each push; print
      `supabase db diff` into the job log for the reviewer. (SEC-02 · DEV)

### Database invariants
- [ ] **Every view is `security_invoker = on`**, with a named allowlist of the four audited projections
      (`venue_settings_public`, `cafe_settings_public`, `menu_item_availability`, `court_availability`). Any
      *new* invoker-off view fails the test. Asserting a flat zero would go red on a clean repo. (SEC-04 · DEV)
- [ ] **Every `security definer` function in `app` has a pinned `search_path`.** Coverage is 159/159 with
      zero offenders — this is a pure regression lock so the next function cannot forget. It will pass on the
      first run. (SEC-04 · DEV)
- [ ] **RPC registry** — move the exemption list out of code and into data. It exists today as a hardcoded
      JS `Set` (`PUBLIC_BY_DESIGN`, `check-rpc-authz.mjs:38-56`); make it
      `packages/db/fixtures/rpc-allowlist.json` and fail when a function appears in `pg_proc` and not in the
      file. Closes "a new RPC ships unguarded" permanently. (SEC-12 · SEC)
- [ ] **Authz coverage counter — this is the real gap.** Against the 121 distinct names in
      `grant execute on function app.*`, `tests/rls-matrix.ts` covers 50; **71 are uncovered**, including
      `override_price`, `void_after_send`, `apply_pct_discount`, `merge_tabs`, `split_by_item`,
      `set_cafe_settings`, `set_opening_hours` and the staff-admin and `analytics_*` families. Extend the
      pass that already exists rather than writing a second one, and fail the build when the ratio
      regresses. (SEC-12 · SEC)
- [ ] **No real-format Iraqi phone numbers** in seed or fixture files outside a reserved test range.
      (SEC-37 · DEV)

### Clients
- [ ] **`check:electron`** — fail on `nodeIntegration: true`, `contextIsolation: false`, `sandbox: false`,
      `webSecurity: false` or `@electron/remote`, so the hardening cannot regress. Note this gate must land
      *with* the `sandbox: true` fix in Block 4, not before it. (SEC-30 · DEV)
- [ ] **Web security-header e2e assertions** — each header present, no inline script without a nonce, no
      table-token substring in any captured analytics payload. (SEC-25 · FE2)

---

## Block 3 · The database floor

- [ ] ★ **Write the live-migration procedure**: `SET lock_timeout = '3s'; SET statement_timeout = '60s';`
      at the top of every migration session. An `ALTER TABLE` behind a long Realtime transaction freezes
      the till mid-service. No migration currently sets either. (SEC-02 · DEV)
- [ ] ★ **Bring the hosted project to the local migration head** through that gated procedure. This has
      already bitten once: `db-migrate.yml` silently skipped from day 1 for want of secrets and **the hosted
      DB drifted eight migrations behind** before anyone noticed (`HANDOFF.md:544-545`). Until it is at head,
      every green-gate claim is a claim about a database the venue does not use. (SEC-03 · DEV)
- [ ] **Add `timeout-minutes` to the `db-migrate` job.** There is none, so a push blocked on a lock can sit
      against GitHub's 360-minute default while the till is frozen mid-service. (SEC-02 · DEV)
- [ ] Re-run the DB suite against the hosted project through a **restricted role**, never `service_role`
      from a laptop. (SEC-03 · DEV)
- [ ] **Move `btree_gist` into `extensions`** — `0001:5` is a bare `create extension if not exists
      btree_gist;`. `pgcrypto` is already in `extensions` (`0009` exists for exactly this) and `pg_cron` in
      `cron`; leave both alone. This is the one finding the dashboard Security Advisor will raise as
      `extension_in_public`. (SEC-04 · DEV)
- [ ] Write the rule that **production rows are inspected only through a masked, audited definer
      function** — never the SQL Editor. (SEC-37 · SEC)
- [ ] Set the **`client-data/` intake rule**: intake packs are committed verbatim as the contractual record,
      so no pack containing guest or staff personal data may ever be committed. Currently clean —
      `courts.sql` only. (SEC-37 · DEV)
- [ ] `[FREEZE]` Run the dashboard **Security Advisor** and file the result. Expect exactly two known
      findings: `extension_in_public` for `btree_gist` (fix it) and `security_definer_view` ×4 (accepted by
      design — record the waiver). "Clean" means every other lint is zero. (SEC-04 · SEC)
- [ ] Record the **one-project residual risk** in writing and have the client sign it — with one project, a
      bad migration reaches live guest data with no rehearsal. No control here removes that; see D1.
      (SEC-37 · SEC)

---

## Block 4 · The client floor

The baseline each of the three clients needs before feature work stacks on top.

### Auth configuration — Supabase dashboard
- [ ] ★ **CAPTCHA on** under Auth → Attack Protection, with the token passed on `signInAnonymously`.
      Nothing captcha-related exists in the repo; the only throttle is `[auth.rate_limit] anonymous_users =
      300` (`config.toml:74`), flagged in-file as "revisit before production handover".
      ⚠ **Do not disable anonymous sign-in.** It is the cafe's guest identity — every table session boots
      through `apps/web/src/hooks/cafe/useTableSession.ts:57`. Add the CAPTCHA token to that one call site.
      0048's `ACCOUNT_REQUIRED` is scoped to `app.hold_slot` alone, so court booking needs a real account
      while table sessions do not. (SEC-05 · DEV)
- [ ] ★ **Auth redirect allowlist: exact production URLs only.** No wildcards, no `localhost`, and no
      `exp://*` in the hosted project. `redirects.ts` documents that Expo Go needs a wildcard for local dev —
      that entry belongs on a dev project, never the client's. (SEC-05 · DEV)
- [ ] ★ **Leaked-password protection on; JWT expiry 30 minutes with refresh rotation and reuse detection.**
      This is what makes the leaver promise achievable. (SEC-05, SEC-35 · DEV)

### Web — `apps/web`
> The least-defended surface in the system and the only one with no login. It ships **zero security
> headers**, has **no `middleware.ts`**, and has **no lint script**.

- [ ] ★ **Ship the production headers**: HSTS with `includeSubDomains`, `X-Content-Type-Options: nosniff`,
      `frame-ancestors 'none'`, and a nonce-based CSP with no `unsafe-inline` for scripts. `next.config.ts`
      has no `headers()` block at all. (SEC-25 · FE2)
- [ ] ★ **Settle the table token in the URL.** `apps/web/proxy.ts` (Next 16's `proxy` convention) **rewrites**
      rather than redirects at `:50-53`, deliberately keeping the printed token verbatim in the address bar.
      There is no cookie exchange and no `history.replaceState` anywhere in `apps/web`. That contradicts
      Security Layer §6.3 ("the table session is a signed cookie, not a value in the URL"). Either exchange it
      for a cookie on first load, or accept it in writing with the Referrer-Policy and analytics mitigations
      below. (SEC-25 · FE2)
- [ ] Set `Referrer-Policy: no-referrer` on `/t/*` specifically. (SEC-25 · FE2)
- [ ] Confirm cookies are `HttpOnly; Secure; SameSite=Lax`. (SEC-25 · FE2)
- [ ] **Narrow the Next image optimizer allowlist.** `next.config.ts` allows `{ hostname: '*.supabase.co' }`,
      which makes the optimizer a proxy for any Supabase project. Pin the project ref. (SEC-25 · FE2)
- [ ] **Decide the PWA posture now.** `/manifest.webmanifest` ships with no service worker today. Write the
      rule before someone adds one: a service worker must never cache `/t/[token]`. (SEC-25 · FE2)
- [ ] **Guard Vercel preview deployments.** The SOW promises "preview deployment per change", and every
      preview points at the one live database. Password-protect previews or point them at a seeded project.
      (SEC-25 · FE2)
- [ ] **Resolve the PostHog question.** It is mounted on the guest cafe app
      (`src/lib/analytics/AnalyticsProvider.tsx`) while SOW Module 6 NOT INCLUDED lists "Analytics,
      marketing tags or advertising pixels". Removing it is both the cheapest fix and the contract-aligned
      one; keeping it needs a signed variation plus the full SEC-25 token-leak mitigation. (SEC-19 · SEC)
- [ ] Add a `lint` script to `apps/web` and wire it into `turbo lint`. (SEC-24 · FE2)

### Desktop — `apps/operator-shell`
- [ ] **Bundle the preload to a single file and set `sandbox: true`.** Everything else is already in place:
      `contextIsolation: true`, `nodeIntegration: false`, `will-navigate` blocked, `setWindowOpenHandler`
      filtered. This is the one `TODO(W3)` left. (SEC-30 · DEV)
- [ ] ★ **Bind the LAN KDS server to the POS interface, not `0.0.0.0`**, and require a bearer token minted
      at pairing and rotated on each shell start. `lan-kds-server.ts:26` is still `TODO(W4)`, and this is a
      hard gate you will be tested on with a phone in the cafe. (SEC-31 · DEV)
- [ ] **Scope `pin_cache` before it ships.** `queue.ts:36` stores argon2 staff PIN hashes on the venue PC
      for offline unlock (`TODO(W3)`). Decide now whether it is encrypted via `safeStorage`, restricted to
      the roles that actually need it, or dropped — a credential store on an unmanaged Windows box is a
      Layer 1 decision, not a week-4 one. (SEC-32/SEC-34 · DEV)
- [ ] **Start the code-signing certificate purchase.** OV or EV, key in a cloud HSM, not on a laptop.
      Issuance takes days; it blocks the signed installer and the update-verification gate. (SEC-14 · DEV)

### Mobile — `apps/mobile`
- [ ] ★ **Register universal / app links against the real domain.** The redirect bug is *fixed* — do not redo
      it (`api.ts:24-25`, `redirects.ts` via `Linking.createURL()`, `useAuthDeepLink` mounted at
      `_layout.tsx:73`, local allowlist at `config.toml:59-63`). What remains: `ios.associatedDomains` and
      `android.intentFilters` in `app.config.ts`; serve `apple-app-site-association` and
      `/.well-known/assetlinks.json` from `apps/web`; `exp://*` on the **dev** project only; and fix
      `site_url = "http://localhost:3000"` (`config.toml:53`) on the hosted project. (SEC-18 · FE1)
- [ ] **Sign EAS Updates and reject unsigned manifests.** An OTA channel pushes code to every guest phone
      with no store review — the highest-leverage credential in the mobile lane, and today it is protected
      by one password. (SEC-23 · FE1)

---

## Exit criteria — Layer 1 is done when

1. Every box above is ticked with a **name and a date**.
2. The seventeen `[CI]` jobs in Block 2 are green on `main` and block merge.
3. The hosted project is at the migration head and the nightly drift job is green.
4. D1 is answered in writing and signed.
5. `gitleaks` over full history returns nothing, and the artifact grep returns nothing on a real build of
   all three clients.
6. A new pull request that adds a table without RLS, adds a `DROP COLUMN`, or puts `service_role` in a
   client path **fails CI without a human noticing**.

Point 6 is the real test. Layer 1 is not a list of fixes; it is the set of mistakes the project can no
longer make.

---

## What comes after

`docs/security/security-general.md` — phases 2 through 9: booking and money integrity (mostly already
closed by migrations 0048/0049 — read §02 there before starting), authorization and sessions, the store
submission lane, the offline queue, the QR surface, privacy and retention, the drills, and handover.

---

*Kagu Web Studio · Touch Padel Phase 1 · Security Layer 1 v1.0 · 2026-08-30*
