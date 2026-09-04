# Touch Padel — Security Layer 1 (Foundation)

**Version** 1.0 · **Date** 2026-08-30 · **Owner** DEV, with SEC signing off
**Parent** `docs/security/security-general.md` — the full checklist. This file is the slice you do **first**.
**Verified against** the repository at commit `3a6d8f5`, 2026-08-30.

## Status — 2026-09-04

**30 of 60 ticked.** Everything that is code is done and verified, except where a box says otherwise.

| Why the other 30 are open | Count |
|---|---|
| Needs a **dashboard/account** (GitHub, Supabase, Vercel, Expo, Apple, registrar) | 13 |
| Needs the **client** (D1, domain, venue-PC policy, signatures, account ownership) | 8 |
| Needs a **purchase** (OV/EV code-signing certificate) | 1 |
| **Written but unverified** — Docker was not running, so no local Supabase stack | 4 |
| **Deliberately incomplete**, with the reasoning in the box | 4 |

The four unverified boxes are `check:invariants` (views + `search_path`), the header e2e suite, and
migration 0069. Run `pnpm db:start` then `pnpm --filter @touch/db check:invariants && pnpm db:reset && pnpm e2e`
to close them.

New gates, all runnable now: `pnpm security` · `pnpm --filter @touch/db check:migrations`
· `check:rpc-registry` · `check:invariants` · `pnpm --filter @touch/operator-shell check:electron`.

---

> ⚠ **This file has drifted from the repo.** It was verified at migration 55; the repo is at 68. Some boxes
> describe work that has since landed — `sandbox: true` and the single-file preload bundle are both done
> (`apps/operator-shell/src/main/index.ts:107-112`), and `lan-kds-server.ts` does not exist yet at all.
> Re-verify each box against the code before working it; do not trust a box's premise.

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

- [x] **The table token in the URL — SETTLED 2026-09-04: exchange for a cookie.** Implemented and
      verified; see the Block 4 · Web box. *(Box in Block 4 · Web.)*
- [ ] **PostHog — technical mitigation DONE, contract question OPEN.** Kept and fully mitigated rather
      than deleted on our own judgement; the signed variation is still required and is SEC's call.
      *(Box in Block 4 · Web.)*
- [x] **`pin_cache` — SETTLED 2026-09-04: encrypt via `safeStorage`, fail closed.** Implemented and
      tested. *(Box in Block 4 · Desktop.)*
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
- [ ] **`.github/CODEOWNERS`** — **FILE WRITTEN; INERT UNTIL TWO GITHUB SETTINGS EXIST.**
      Routes the migrations directory, `db-migrate.yml`, `ci.yml`, `CODEOWNERS` itself and the security
      gates to `@KaguSoftware/tech-leads` — the gates included, because otherwise the cheapest way to make
      a failing check pass is to edit the check.
      ⚠ **GitHub silently ignores an owner it cannot resolve**, so a file that looks like a control can
      enforce nothing. The team must exist AND "Require review from Code Owners" must be on the `main`
      ruleset. Confirm with a test PR. (SEC-01 · SEC)
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
- [x] ★ **`gitleaks` over full history** — DONE, DEV, 2026-09-04. `.gitleaks.toml` + the `secrets` job in
      `ci.yml` (`fetch-depth: 0`, pinned 8.30.1 binary — the official ACTION needs a paid licence for
      org-owned repos and would have failed on licensing rather than on secrets). Baseline run: 123 commits,
      10 findings, **zero real leaks** — 8 are the published `iss: supabase-demo` local-stack keys, 2 are the
      hosted project's **anon** key in `eas.json`, which ships in every client binary by design. All three
      are allowlisted **by exact value**, never by path, so a different token in the same file still fails.
      A custom rule (`touchpadel-live-service-role`) fails on any JWT claiming `service_role`; verified
      against a planted key. (SEC-24 · DEV)
- [x] Rotate anything it finds — **nothing to rotate**, DEV, 2026-09-04. The one genuinely sensitive
      credential in the project, the hosted `service_role` key, lives only in untracked `.env.local` files;
      `git log --all -S` over the full object graph confirms it was never committed. (SEC-24 · DEV)
- [x] ★ **Built-artifact secret grep** — DONE, DEV, 2026-09-04.
      `scripts/security/check-artifact-secrets.mjs`, wired into the three jobs that already build each
      client (`--only=web|mobile|desktop`) rather than a fourth job that rebuilds them all.
      ⚠ The literal grep in this box is **not implementable as written**: `@supabase/auth-js` contains the
      string `service_role` in its own source, so a bare-word gate fires 168 times on a clean tree and would
      be deleted within a day. It fails instead on things that cannot be false positives — a JWT whose
      **decoded** payload claims `service_role`, any `sb_secret_*`, or a token for a real project with an
      unexpected role — and reports the bare-word count as information. It also **fails when nothing was
      built**, because a scan of an empty directory is the exact green tick this gate exists to prevent.
      First real run: `.next` built with a live `service_role` in `.env.local` — not inlined. (SEC-24 · DEV)
- [x] **`NEXT_PUBLIC_` / `EXPO_PUBLIC_` naming check** — DONE, DEV, 2026-09-04.
      `scripts/security/check-public-env-names.mjs`, over `git ls-files` so build output and untracked local
      `.env` files cannot skew it. Four names legitimately match the pattern (both Supabase anon keys, the
      publishable key, the PostHog ingest key) and are allowlisted by exact name with a written reason each.
      (SEC-24 · DEV)
- [x] **Lint rule: no `service_role` in client paths** — DONE, DEV, 2026-09-04. `clientSecrets` /
      `clientSecretRules` in `@touch/config/eslint`, wired into all four client packages.
      ⚠ Landing it exposed a trap worth knowing about: ESLint **replaces** `no-restricted-syntax` wholesale
      rather than merging it, and both the RTL guard and this rule use that rule name. The two pre-existing
      `'no-restricted-syntax': 'off'` exemptions (operator recharts geometry, mobile court art) would have
      silently opened holes where a key could sit unlinted, so both now restate the secret rules explicitly.
      One true-negative suppressed with a reason: the audit-log test asserting how the till *renders* the
      role name `service_role`. (SEC-24 · DEV)
- [x] **`pnpm audit --audit-level=high` + Dependabot** — DONE, DEV, 2026-09-04.
      ⚠ Bare `pnpm audit --audit-level=high` goes **red on arrival** (14 high, 2 critical, all transitive),
      so it lands wrapped in `scripts/security/check-dependency-audit.mjs` on the same principle this file
      applies to migrations — grandfather what is committed, guard what arrives.
      `.security/audit-waivers.json` holds all 14 with a per-advisory reachability argument, an owner and an
      **expiry date**; an expired waiver fails the build exactly as an un-waived advisory does, and stale
      waivers are reported so the file shrinks as upgrades land. All three behaviours verified.
      **The one that matters is `electron@33.4.11` — 7 high advisories, fixed only at ≥38.8.6/39.8.10,
      including a context-isolation bypass. That is the binary on the venue PC. Waived to 2026-10-15 and it
      belongs in the Block 4 desktop lane, not here.** Dependabot groups by "does it ship" so the backlog
      arrives as a handful of reviewable PRs, not thirty unread ones. (SEC-24 · DEV)
- [x] Confirm `.env*`, `.env.remote` and `station.json` are absent from git **history** — DONE, DEV,
      2026-09-04. `scripts/security/check-history-secrets.mjs` walks `--diff-filter=A` over `--all`: 994
      paths, clean. Four `.env.example` files (deliberate) and a root `.npmrc` holding only pnpm settings.
      The `.npmrc` is checked by **content in every historical revision** rather than by path — a committed
      root `.npmrc` is normal and correct, and a path rule there is either a permanent false positive or a
      missed `_authToken`. (SEC-24 · DEV)

### Migrations
- [x] ★ **`check:migrations`, scoped to lock-taking DDL** — DONE — DEV, 2026-09-04.
      `packages/db/scripts/check-migrations.mjs`. Independently reproduced this file's audit:
      **57 non-CONCURRENTLY indexes, 11 `add constraint` without `NOT VALID`, and `0039:71`** — the exact
      site named above. Scoped to files changed against the merge base, so history is grandfathered and only
      new migrations are judged; `MIGRATION-RISK-ACCEPTED:` in the PR body downgrades a failure to a report.
      Also enforces the Block 3 timeout preamble. All four behaviours negative-tested.
      ⚠ Its SQL parser strips string literals, so the preamble rule reads the RAW text of the region before
      the first non-SET statement — that is what lets it reject `lock_timeout = 0`, which would otherwise
      pass as "a timeout is set". (SEC-02 · DEV)
- [x] ★ **Nightly `supabase db diff --linked`** — DONE — DEV, 2026-09-04.
      `.github/workflows/db-drift.yml`, 02:00 Asia/Baghdad. Two checks, because the remedies differ:
      `migration list` catches the hosted project being BEHIND (the eight-migration drift that already
      happened), and a non-empty `db diff` catches the schema being EDITED BY HAND — which Block 3 forbids
      precisely because it leaves no migration and no audit trail.
      ⚠ Missing secrets produce a **warning annotation**, not a silent pass: a drift job that never runs is
      the original failure with extra steps. (SEC-03 · DEV)
- [x] Data-only dump of the ledger tables + `db diff` in the job log — DONE — DEV, 2026-09-04.
      Both added to `db-migrate.yml`. The diff is printed into the **job summary**, where the person
      approving the environment gate actually looks. The ledger dump (`audit_log`, `stock_ledger`,
      `payments` — the three with UPDATE/DELETE revoked) is retained 30 days: with no PITR rehearsal and no
      staging, it is the only "before" that will exist. It is evidence, not a restore path. (SEC-02 · DEV)
### Database invariants
- [ ] **Every view is `security_invoker = on`** — **WRITTEN, NOT VERIFIED.**
      `packages/db/scripts/check-db-invariants.mjs` (`pnpm --filter @touch/db check:invariants`), wired into
      the CI `db` job. The four audited projections are named in an allowlist; any NEW invoker-off view fails.
      ⚠ **Docker was not running on this machine, so it has never been executed.** It reads `pg_class`
      through the stack's container exactly as `check-lock-order.mjs` does. Run `pnpm db:start` then
      `pnpm --filter @touch/db check:invariants` before trusting it. (SEC-04 · DEV)
- [ ] **Every `security definer` function has a pinned `search_path`** — **WRITTEN, NOT VERIFIED.**
      Second stage of the same `check:invariants` script. Expected to pass on the first run (159/159).
      ⚠ Unexecuted for the same reason — no Docker. (SEC-04 · DEV)
- [x] **RPC registry — moved out of code and into data** — DONE — DEV, 2026-09-04.
      `packages/db/fixtures/rpc-allowlist.json` classifies all **127** client-callable RPCs (19 public by
      design with a written reason each, 108 guarded); `check-rpc-authz.mjs` now loads its exemptions from
      it instead of the hardcoded `Set`.
      The point is the DEFAULT, not the list: a newly granted RPC used to appear in no list at all, so
      nothing failed and it shipped unguarded unless a reviewer noticed. `check:rpc-registry` now fails on
      any unclassified RPC — silence stops being a pass. Negative-tested. (SEC-12 · SEC)
- [x] **Authz coverage counter, with a ratchet** — DONE — DEV, 2026-09-04.
      Measured against the grants themselves: **60 of 127 covered, 67 uncovered** (this file said 50/121 —
      the repo has grown from migration 55 to 69). The floor is recorded in
      `packages/db/fixtures/rpc-coverage-floor.json` and the build fails when the RATIO regresses, so
      adding an RPC without a rule in `tests/rls-matrix.ts` fails. Verified: adding an RPC dropped it to
      60/128 and failed.
      ⚠ **This closes the ratchet, not the gap.** `override_price`, `void_after_send`, `apply_pct_discount`,
      `merge_tabs`, `split_by_item` and the `analytics_*` family are still asserted by nobody — the script
      prints them on every run. Raising 60 → 127 is real work and is NOT done. (SEC-12 · SEC)
- [x] **No real-format Iraqi phone numbers in seeds or fixtures** — DONE — DEV, 2026-09-04.
      `scripts/security/check-data-hygiene.mjs`. Iraq has no ITU documentation range, so the script DEFINES
      the reserved convention: `+964 7XX 000000N`. Currently clean. (SEC-37 · DEV)
### Clients
- [x] **`check:electron`** — DONE — DEV, 2026-09-04.
      `apps/operator-shell/scripts/check-electron.mjs`. ⚠ **This file's premise is stale**: `sandbox: true`
      and the single-file preload bundle both landed already (`src/main/index.ts:107-112`), so the gate
      passes today and did NOT need to wait for Block 4.
      It fails on the five forbidden settings AND on any REQUIRED one going MISSING — a deleted
      `sandbox: true` is as dangerous as an inverted one, and Electron's defaults have changed across
      majors. Also asserts `will-navigate`, `setWindowOpenHandler` and `will-attach-webview` stay wired.
      Negative-tested. (SEC-30 · DEV)
- [ ] **Web security-header e2e assertions** — **WRITTEN, NOT RUN.**
      `e2e/tests/web-security-headers.spec.ts`: every header present, a fresh nonce per request, no inline
      script without one, the cookie exchange, and — the assertion that would otherwise be argued rather
      than measured — **no outbound request carrying the table token**.
      ⚠ Playwright needs the local Supabase stack, and Docker was not running. The header and nonce
      assertions WERE verified by hand against a production build (`next start` + curl: all 14 inline
      scripts carried the nonce). The token-leak test has never executed. (SEC-25 · FE2)
---

## Block 3 · The database floor

- [x] ★ **Live-migration procedure** — DONE — DEV, 2026-09-04.
      Not a document — a rule in `check:migrations`: every NEW migration must open with
      `set lock_timeout = '3s'; set statement_timeout = '60s';` and `lock_timeout = 0` is rejected.
      Without it an `ALTER TABLE` queued behind a long Realtime transaction waits forever and everything
      arriving after it queues behind the ALTER: the till freezes mid-service and stays frozen until
      someone finds and kills the session. A failed deploy is recoverable; that is not.
      Written up in `docs/security/layer-1-rules-and-decisions.md` §6. (SEC-02 · DEV)
- [ ] ★ **Bring the hosted project to the migration head** — **NOT DONE. Needs a named person, not a
      script.** Everything around it is now in place: the gated procedure, the printed diff, the ledger
      snapshot, the 15-minute bound and the timeout preamble. What is missing is the three preconditions in
      `docs/security/layer-1-rules-and-decisions.md` §6 — a named risk owner, a time outside service, and
      D1 answered. **Until this runs, every green gate above describes a database the venue does not use.**
      (SEC-03 · DEV)
- [x] **`timeout-minutes` on the `db-migrate` job** — DONE — DEV, 2026-09-04.
      `timeout-minutes: 15`. GitHub's default is **360 minutes** — six hours of a held lock with the till
      frozen behind it. This is the outer bound; `lock_timeout = '3s'` is the real control. (SEC-02 · DEV)
- [ ] Re-run the DB suite against the hosted project through a **restricted role** — **NOT DONE.**
      Requires hosted credentials and a restricted role that does not exist yet; blocked behind the item
      above. (SEC-03 · DEV)
- [ ] **Move `btree_gist` into `extensions`** — **MIGRATION WRITTEN, NOT EXECUTED.**
      `20260904000069_btree_gist_schema_fix.sql`. Idempotent, carries the timeout preamble, and ends with a
      post-check that re-asserts the reservations exclusion constraint still exists — the constraint that
      stops two bookings taking the same court, i.e. the most important invariant in the product.
      Relocation is a catalog update (btree_gist is `relocatable`; the index references its opclasses by
      OID), so it should not touch data.
      ⚠ **"Should" is doing work in that sentence and Docker was not running to check.** Run
      `pnpm db:reset` and the concurrency suite before this reaches the venue's database. (SEC-04 · DEV)
- [x] **Production rows are read only through a masked, audited definer function** — DONE — DEV, 2026-09-04.
      `docs/security/layer-1-rules-and-decisions.md` §1, with §2 (who may reach the hosted project) as the
      control that actually enforces it — a read cannot be caught after the fact, so access is limited
      instead. DDL through the SQL Editor IS caught, by the nightly drift job. (SEC-37 · SEC)
- [x] **`client-data/` intake rule** — DONE — DEV, 2026-09-04. Written up (§3) and **enforced** by
      `check-data-hygiene.mjs`.
      ⚠ **This file said "currently clean". It was not.** The scan found the client's own hosting-account
      email in both intake packs, already committed in `634462a` and `e4f2acc` — so redaction would remove
      nothing. It is a business contact rather than guest or staff data, so it is grandfathered explicitly
      with that reasoning; **raise it with the client so the acceptance is theirs.** (SEC-37 · DEV)
- [ ] `[FREEZE]` Run the dashboard **Security Advisor** — **NOT DONE (dashboard access).**
      Migration 0069 removes the expected `extension_in_public`; the four `security_definer_view` findings
      are the audited projections now named in `check:invariants`, and the waiver wording is in §2 of the
      rules doc. (SEC-04 · SEC)
- [ ] **One-project residual risk** — **WRITTEN, AWAITING SIGNATURE.**
      `docs/security/layer-1-rules-and-decisions.md` §5: the risk stated plainly, a table of the six
      controls now reducing it and what each cannot catch, and a signature block. **No control removes it —
      only a second project does, which is D1.** (SEC-37 · SEC)
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

- [x] ★ **Production security headers** — DONE — DEV, 2026-09-04.
      `next.config.ts` `headers()` + a per-request nonce CSP in `proxy.ts`. HSTS (2y, includeSubDomains,
      preload), nosniff, `frame-ancestors 'none'`, X-Frame-Options, Referrer-Policy, Permissions-Policy,
      COOP. **Verified against a real production build**, not just configured: `script-src` is
      `'nonce-…' 'strict-dynamic'` with no `unsafe-inline`, and all 14 of Next's inline scripts plus the
      layout's inline `<style>` carried the nonce.
      ⚠ **Cost, stated:** the nonce forces `/[locale]` to render dynamically — it was static. The menu
      still comes from the cached read model, so it costs a render, not a database round trip.
      (SEC-25 · FE2)
- [x] ★ **Table token exchanged for a cookie** — DONE — DEV, 2026-09-04.
      `proxy.ts` 307s `/t/{token}` → `/{locale}/t` with an `HttpOnly; Secure; SameSite=Lax` cookie; the
      `[token]` route remains as a defence-in-depth fallback for a future matcher edit. **Printed QR cards
      are unaffected.** Verified end to end.
      ⚠ **KNOWN RESIDUAL, measured not assumed.** The token still appears **once** in the RSC payload,
      because `useTableSession` runs in the browser and needs it to call `open_table_session`.
      FIXED: `Referer` leakage, analytics capture, browser history, screenshots, shared links.
      NOT FIXED: an XSS in the guest app could still read it. Closing that means never sending the token to
      the client at all — a route handler calling the RPC server-side as the guest — which is a real
      refactor of the ordering boot and is **not** done. (SEC-25 · FE2)
- [x] `Referrer-Policy: no-referrer` on `/t/*` — DONE — DEV, 2026-09-04. Plus
      `Cache-Control: no-store` there: a table page is one guest's session and must never sit in a shared
      cache. Verified on the live route. (SEC-25 · FE2)
- [x] Cookies are `HttpOnly; Secure; SameSite=Lax` — DONE — DEV, 2026-09-04.
      Confirmed on the wire. `Lax` not `Strict` on purpose: a guest following the QR from a messaging app
      arrives cross-site, and `Strict` would drop the cookie on the one navigation that matters.
      (SEC-25 · FE2)
- [x] **Next image optimizer allowlist narrowed** — DONE — DEV, 2026-09-04.
      The `*.supabase.co` wildcard made the optimizer an open proxy: anyone could pass
      `/_next/image?url=https://<their-project>.supabase.co/…` and have this origin fetch, resize, cache and
      serve their bytes under the venue's own domain and TLS certificate. Now derived from
      `NEXT_PUBLIC_SUPABASE_URL` — following the deployment rather than hardcoding a ref that silently
      breaks at handover, which is how the wildcard gets put back. (SEC-25 · FE2)
- [x] **PWA posture decided and enforced** — DONE — DEV, 2026-09-04.
      Written as CODE, not a sentence: `check-web-security.mjs` passes vacuously while no service worker
      exists, and the moment one appears it FAILS unless `/t` is excluded from caching. A cached table page
      is one guest's session served to the next person on that phone; a cached `/t/{token}` puts the
      credential in Cache Storage where page script CAN read it, undoing the HttpOnly cookie entirely.
      (SEC-25 · FE2)
- [ ] **Guard Vercel preview deployments** — **NOT DONE (dashboard access).**
      Vercel → Deployment Protection. Every preview points at the one live database. (SEC-25 · FE2)
- [ ] **PostHog** — **MITIGATED; the contract question is still open.**
      Decision taken: keep + mitigate rather than delete a shipped feature on our own judgement.
      `sanitize_properties` now redacts `/t/<token>` from every captured property — `$current_url`,
      `$pathname`, `$referrer` — which covers the first request and any QR card printed before the cookie
      exchange. Autocapture and session recording were already off.
      ⚠ **SOW Module 6 NOT INCLUDED still lists "Analytics, marketing tags or advertising pixels". The
      signed variation is outstanding and is SEC's call, not a technical one.** (SEC-19 · SEC)
- [x] Add a `lint` script to `apps/web` and wire it into `turbo lint` — DONE, DEV, 2026-09-04.
      `apps/web/eslint.config.mjs` (base + react + clientSecrets + `@next/eslint-plugin-next`) and a `lint`
      script; `turbo lint` now runs 4 packages, not 3. It found 5 real errors the missing script had been
      hiding, all now fixed: an unused import, a physical-CSS RTL violation, a raw `createClient` import
      outside the factory, and two `eslint-disable` comments naming a rule ESLint had never heard of (the
      Next plugin was not installed, so those deliberate suppressions were themselves failures).
      **Zero client-secret violations** — that is the security result. (SEC-24 · FE2)

### Desktop — `apps/operator-shell`
- [x] **Preload bundled + `sandbox: true`** — **ALREADY DONE before this pass**; verified 2026-09-04.
      `src/main/index.ts:107-112`. This file's `TODO(W3)` is stale. Now locked by `check:electron` so it
      cannot regress. (SEC-30 · DEV)
- [ ] ★ **LAN KDS bind + bearer token** — **MOSTLY ALREADY DONE; rotation is not.**
      This file's premise is stale — `lan-kds-server.ts` binds to the first private RFC1918 IPv4 (never
      `0.0.0.0`, with a test pinning that) and requires `Authorization: Bearer <psk>`.
      ⚠ **What is NOT done is "rotated on each shell start".** The PSK comes from `station.json` at
      pairing and is static. Rotating it per start would break every paired KDS tablet on every restart
      unless a re-pairing handshake distributes the new value — that is a feature with a UI, and it cannot
      be validated without a real tablet. Deliberately left, not overlooked. (SEC-31 · DEV)
- [x] **`pin_cache` scoped** — DONE — DEV, 2026-09-04. Decision: encrypt via `safeStorage`.
      The exposure was not the hashes, it was **the salt sitting in plaintext beside them**: a PIN is 4–6
      digits, so with the salt the whole keyspace falls in seconds — and those PINs are the manager
      authorisations for voids, discounts and price overrides. The salt is now encrypted with `safeStorage`
      (DPAPI on Windows), binding it to the logged-in account: a copied `queue.db` is inert.
      **Fails closed** — no encryption, no cached credential material. Legacy plaintext salts migrate in
      place so a running station does not lose offline unlock; an undecryptable salt wipes the cache rather
      than leaving dead credential material on disk. 6 new tests, 117 passing. (SEC-32/SEC-34 · DEV)
- [ ] **OV/EV code-signing certificate** — **NOT DONE — this is a PURCHASE, and it is one of the two
      items this file says cannot fit in a week. Start it today.** Days of identity verification; key in a
      cloud HSM, not a laptop. Blocks the signed installer and the update-verification gate.
      (SEC-14 · DEV)
### Mobile — `apps/mobile`
- [ ] ★ **Universal / app links** — **CONFIGURED; BLOCKED ON THE DOMAIN.**
      Done: `ios.associatedDomains` and `android.intentFilters` with `autoVerify: true`
      (`app.config.ts`), and both association files served from `apps/web` —
      `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json`, verified 200 with
      `application/json` and NOT swallowed by the locale proxy.
      Scoped to `/auth/*` only — deliberately **not** `/t/*`, which must stay in the browser.
      ⚠ Three values are placeholders that **fail closed** until real ones exist: the domain
      (`touchpadel.invalid`, RFC 2606), `APPLE_TEAM_ID`, and `ANDROID_SHA256_FINGERPRINTS` (empty). Until
      then the app falls back to the custom scheme — today's behaviour. `site_url` on the hosted project is
      a dashboard change (§8). (SEC-18 · FE1)
- [ ] **Sign EAS Updates** — **KEYS GENERATED AND WIRED; TWO HUMAN STEPS LEFT.**
      Done: RSA-2048 keypair, 10-year certificate committed at `apps/mobile/certs/certificate.pem` (with an
      explicit `.gitignore` exception to the blanket `*.pem`), and `app.config.ts` declaring
      `codeSigningCertificate` + `codeSigningMetadata`.
      ⚠ **The private key is NOT in the repository** — it is in this session's scratchpad and must be moved
      to the password manager and EAS secrets, then deleted. Runbook:
      `docs/security/eas-update-signing.md`.
      ⚠ **Signing protects a device only once that device runs a binary containing the certificate**, so
      this must ship in a store release before it protects anyone. Until then the Expo account password is
      still load-bearing. (SEC-23 · FE1)
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
