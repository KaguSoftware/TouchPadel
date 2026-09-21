# Milestone 0: the hosted push (owner runbook, 2026-09-21)

For Parsa at the keyboard. This is the ordered expansion of `PHASE-2-CHECKLIST.md`
"Milestone 0, left (owner, Parsa)" (L40–47). Every step gives the command, the output to expect,
what to do when the output differs, and the checklist line it closes.

**Two rules that apply to every step.**

1. Every `supabase` command runs from **`packages/db`**, never the repo root. From the root the CLI
   sees an empty `supabase/migrations`, reports "Remote migration versions not found in local
   migrations directory" and offers `supabase migration repair --status reverted <every version>`.
   **Never run that.** It marks the whole hosted history as undone.
2. The CLI on this machine has been logged in as the wrong account before
   (`petitati.ist@gmail.com`, which 403s on `--linked`). Run `npx supabase login` as the account in
   the **touch padel** Supabase organisation first, and check with `npx supabase projects list`.

Do the database steps **outside service hours**. Steps 2 and 3 are the long ones.

## Summary

| Step | What | Closes | Done? |
|---|---|---|---|
| 0 | CI is green on `main` for the latest commit | L40 | [ ] |
| 1 | Read the hosted ledger (done from CI 2026-09-21: 0121 complete, 0 pending) | L41 | [x] |
| 2 | Buy PITR on production, create the staging project | L43 (first half) | [ ] |
| 3 | Rehearse the whole push on staging | L43 (second half) | [ ] |
| 4 | S1: rotate the seeded staff. 0115 is ALREADY on production, so this is urgent | L42 | [ ] |
| 5 | Run `db-migrate.yml` (ran on push 09-20 and by dispatch 09-21; 0108–0121 applied) | L44 (first half) | [x] |
| 6 | Deploy `replay` (functions-deploy ran green on every push; assistant functions gated) | L44 (second half) | [x] |
| 7 | Post-push checks | L45 | [ ] |
| 8 | Supabase Auth dashboard settings | L46 | [ ] |
| 9 | GitHub: release gate, `operator-v0.2.14`, the OTP repository variable | L47 | [ ] |

Background reading, linked rather than copied: `PHASE-2-PLAN.md` (why each item exists),
`PHASE-2-CHECKLIST.md` (the short list), `docs/client/release-gate-2026-09-20.md` (step 9),
`docs/client/hosted-catchup-2026-09-12.md` (the last time the ledger was stuck, and the verify
curls), `docs/client/phone-otp-activation.md` (the OTP switches), `packages/db/CLAUDE.md` (the rules
the migrations follow).

---

## Step 0. Preconditions: CI green on `main`

The last three Milestone 0 commits are `2b9adf7` (the 0115/0116 fixes), `8616549` (item 9, 0120) and
`c2793ae` (the checklist). Nothing goes to hosted until their runs are green.

```sh
gh run list --branch main --limit 5
```

**Expect:** the five most recent runs on `main`, each `completed  success`. `CI` is the one that
matters; `DB Migrate (staging)` and `Functions deploy (staging)` may show `waiting`. That is step
5's approval, not a failure.

**If it differs.**

- A red `CI` run: `gh run view <id> --log-failed`. Do not push to hosted with a red gate; the
  types-drift and migration-order steps are exactly the ones that catch a bad push.
- A `queued` or `in_progress` run: wait for it.
- A `waiting` run on `DB Migrate (staging)`: read the warning in step 5 **before** you do anything
  else. An unapproved waiting run holds the `db-migrate` concurrency group.

**Closes** `PHASE-2-CHECKLIST.md` L40.

---

## Step 1. Read the hosted ledger

```sh
cd packages/db
npx supabase login
npx supabase projects list          # the touch padel org's project must be listed
npx supabase migration list --linked
```

**Expect (verified 2026-09-21 09:28 UTC, `db-migrate.yml` run 35583475145):** 0001–0121 on both
sides, **0 pending**. The 09-20 pushes applied 0108–0119 and 0121; 0120 sorts before 0121, was
refused by `db push`, and was applied on 2026-09-21 with the workflow's `include_all` input.

**If it differs.**

- **More pending than that** (anything from 0090 up): that is the real answer, not an error. The
  last position this repository actually proves is 0089 on 2026-09-12, and 0090/0091 were queued
  behind an approval on 09-13 with no later run recorded. Take the list at its word, and expect the
  push in step 5 to be bigger.
- **The CLI offers `migration repair --status reverted`**: you are in the wrong directory. `cd
  packages/db` and run it again. Never accept the offer.
- **A local file sorts BEFORE the newest remote version**: `db push` refuses it and every later one,
  silently. That is what stalled hosted for six days in September. The fix is the `include_all`
  input on `db-migrate.yml` (step 5), used only with the pending list in front of you.
- **403 on `--linked`**: wrong account. `npx supabase login` again.

**Closes** `PHASE-2-CHECKLIST.md` L41.

---

## Step 2. PITR on production, and a staging project

Decision of 2026-09-20, reversing the 2026-08-30 decline: the client buys point-in-time recovery,
and a staging project is created before the multi-venue push (`PHASE-2-PLAN.md`; deviation D3 in
`docs/security/security-general.md` §01).

1. **PITR.** Supabase dashboard → the production project → Settings → Add-ons → **Point in Time
   Recovery** → enable. Then Database → Backups → the PITR tab must show a restore window.
   **Expect:** a non-empty recovery window (it starts short and grows).
   **If it differs:** the add-on needs the project on a paid plan and takes a few minutes to arm. If
   the tab still says "not enabled" after that, it did not apply. Do not go on to step 3 believing
   you have it.
2. **The staging project.** Dashboard → New project, in the **same organisation and the same
   region** as production, named `touch-padel-staging`. Then Database → Backups on **production** →
   the latest daily backup → Restore → **restore into the new project** (or download and restore
   locally if the dashboard will not target another project).
   **Expect:** the staging project comes up with production's schema and data, and
   `npx supabase migration list --linked` against it shows the same applied ledger production had.
   **If it differs:** a schema-only staging is still usable for a migration rehearsal, but say so in
   this file. A rehearsal on empty tables does not prove a `VALIDATE CONSTRAINT` over real rows.
3. Write the staging project ref down here, and keep it out of `PROJECT_REF` until step 5 says so:
   `staging ref = [                    ]`, `PITR enabled on [ date ]`.

**Closes** `PHASE-2-CHECKLIST.md` L43, first half.

---

## Step 3. Rehearse the whole push on staging

Everything that will touch production is done on staging first, in the same order.

```sh
cd packages/db
npx supabase link --project-ref <staging-ref>
npx supabase migration list --linked         # same pending list as step 1
npx supabase db push --linked --dry-run      # prints exactly what it will apply
npx supabase db push --linked --yes
npx supabase migration list --linked         # 0 pending
```

**Expect:** the dry run lists the same versions step 1 called pending, the push applies them without
a lock timeout, and the ledger ends at 0 pending. Then run step 7's checks against staging.

**If it differs.**

- **`lock_timeout` (55P03) or `canceling statement` (57014):** something was holding a row. Every
  migration opens with `lock_timeout = '3s'` on purpose, so this is a clean refusal, not damage.
  Retry once.
- **A constraint fails to validate:** real data violates it. Do not force it. The migration header
  names the pre-flight query that lists the offending rows. Run that, fix the data, push again.
  Finding this here instead of on production is the entire point of the rehearsal.
- **`PGRST203` or a "function is not unique" error afterwards:** a stray overload. That is the
  0115/0119 defect class; run step 7's `pg_proc` query before blaming anything else.

Relink to production before step 5: `npx supabase link --project-ref <production-ref>`.

**Closes** `PHASE-2-CHECKLIST.md` L43, second half.

---

## Step 4. S1, rotate the seeded staff. 0115 is ALREADY on production, so this is urgent

Five `@dev.touch.local` staff accounts with a repo-committed shared password are live on the hosted
project, and pre-0078 short PINs still verify (`PHASE-2-PLAN.md` S1). **0115 landed on production on 2026-09-20 21:53 UTC** (the `staging` environment carries no reviewer,
so the push applied on merge), and it makes `verify_manager_pin` treat a correct-but-weak
PIN exactly like a wrong one: a manager whose PIN is weak can authorise nothing until it is reset.
Until this step is done, every seeded manager whose PIN fails the 0115 rule is already locked out of
money operations on the client's project. Do this step first, today.

**The PIN rule, so you can pick before you start.** `app.set_staff_pin` (0078, re-issued by 0105)
refuses anything that is not **6 to 12 digits** (`PIN_FORMAT`), and then refuses the weak shapes
(`PIN_WEAK`): one digit repeated (`111111`), a straight ascending run (`123456`, `567890`) and a
straight descending run (`654321`). Dates, repeated pairs like `121212` and keypad walks are
allowed by design. Since 0105 every **active** staff member has a PIN, not just managers and owners,
and only an **owner** may set one.

Order, outside service hours:

1. **Report only, first.** List what is there before changing anything:
   ```sh
   cd packages/db
   npx supabase db query --linked "select id, display_name, role, is_active from staff order by role, display_name"
   ```
   **Expect:** the five `Dev …` rows, plus anything real. One statement per call. The Management
   API returns only the last result of a multi-statement input.
2. **Create the real owner** with `scripts/create-operator-owner.mjs` (repo **root** `scripts/`, not
   `packages/db/scripts/`). Sign in as that owner in the operator app and confirm it works **before**
   touching the dev accounts. Everything below needs an owner session.
3. **Delete the default credentials** in `scripts/create-operator-owner.mjs` (`:24-25`) in the same
   sitting, and commit that as a normal change. A committed default password is how this finding
   started.
4. **Deactivate the five `@dev.touch.local` staff through staff-admin** in the operator app, not with
   a password reset. Deactivation revokes refresh tokens (0081); a password reset alone leaves every
   existing session signed in.
   **Expect:** `is_active = false` on all five, and their sessions dead.
5. **Set a fresh PIN for every remaining active staff member** with `app.set_staff_pin`, as the
   owner. **Expect:** no error. `PIN_FORMAT` means fewer than 6 digits or a non-digit; `PIN_WEAK`
   means one of the three shapes above; `STAFF_NOT_FOUND` means the target is not active.
6. **Repoint `telegram_staff`** to the real staff rows. Today it maps one row, Parsa → `Dev Owner`.
   Note the trap recorded in `HANDOFF.md`: `app.set_telegram_staff` reads the caller's JWT, which the
   SQL editor and the CLI do not have, so it raises `FORBIDDEN` there and the only path that works
   today is a direct insert, which skips the audit row.
7. **Re-run the report query.** **Expect:** no active `@dev.touch.local` row, a real owner, and every
   active member holding a PIN.

**Closes** `PHASE-2-CHECKLIST.md` L42.

---

## Step 5. Run `db-migrate.yml`: staging, then production

**Read this warning first.** Both `db-migrate.yml` and `functions-deploy.yml` use a single
concurrency group (`db-migrate`, `functions-deploy`) and are bound to the `staging` GitHub
Environment, which on 2026-09-21 had **no required reviewer**: a push to `main` that touches
migrations or functions applies to the client's project immediately, and that is how 0108–0121 got
there. If you want the stop back, add a reviewer to the environment; then the rest of this warning
applies. GitHub keeps **one** pending run per group: while an
unapproved run sits there `waiting`, the next run you start replaces it and the older one is
cancelled, and if you queue a third, the second goes the same way, quietly. **Approve or cancel the
waiting run before you start the next one**, and check `gh run list --workflow db-migrate.yml
--limit 5` between runs.

1. **Staging.** The workflow deploys to whatever `PROJECT_REF` holds, and there is one such secret.
   If you want the workflow itself rehearsed, set `PROJECT_REF` to the staging ref
   (`gh secret set PROJECT_REF -R KaguSoftware/TouchPadel`), run it, then set it back to production.
   If you already rehearsed with the CLI in step 3, say so here and skip straight to production,
   but do not leave `PROJECT_REF` pointing at staging.
2. **Production.** Actions → **DB Migrate (staging)** → Run workflow on `main`. Leave
   `include_all` **false** unless step 1 showed a file sorting before the newest remote version.
   Read the **"Show pending migrations"** step in the run summary before approving.
   **Expect:** exactly the versions step 1 called pending, an additive diff, then a green push.
   **If it differs:** a longer list than you expect means the ledger was further behind than you
   thought. That is information, not an error, but re-read it before approving. A list containing a
   version you do not recognise means someone else pushed; stop and find out who.
   **If the push step is red:** read it. A lock timeout is a retry. A failed `VALIDATE CONSTRAINT` is
   data, and the migration header names the query that finds the rows.
3. The pre-push snapshot step must read `dumping: audit_log payments refunds stock_movements
   sync_replays (excluding N other public tables)` and leave an artifact named `public-ledgers-<sha>`.
   If it is red with "Ledger snapshot skipped", the push still went through. The snapshot is
   evidence, not a gate.

**Closes** `PHASE-2-CHECKLIST.md` L44, first half.

---

## Step 6. Deploy `replay`, and only `replay`

0114 changed the replay contract (retryable versus terminal classification, PIN redaction,
`app.log_replay` dropped, duplicate-of-conflict treated as a conflict) and the function has to move
with it.

**Note the mismatch:** `Functions deploy (staging)` runs `supabase functions deploy` with **no
function name**, so it deploys *every* function under `packages/db/supabase/functions`. To deploy
`replay` alone, use the CLI:

```sh
cd packages/db
npx supabase functions deploy replay
npx supabase functions list
```

**Expect:** `replay` shows a new version and a fresh `updated_at`. `telegram-callback` and
`send-sms-otp` keep `verify_jwt = false`; everything else keeps `true`.

**The assistant functions stay gated.** The three assistant edge functions may be deployed without
consequence, they are inert while `ANTHROPIC_API_KEY` is unset and
`venue_settings.llm_daily_request_limit = 0`, but the intent of this milestone is that they are not
switched on. **Do not set `ANTHROPIC_API_KEY` on the hosted project.** If you use the workflow
instead of the CLI and it deploys everything, that is acceptable; setting the key is not. The gate
is recorded as deviation D10 in `docs/security/security-general.md` §01.

**If it differs:** a function that fails to deploy usually fails `deno check` first. Read the error
rather than re-running. If `verify_jwt` flips on `telegram-callback` or `send-sms-otp`, the workflow
fails on purpose; `config.toml` is the source of that flag.

**Closes** `PHASE-2-CHECKLIST.md` L44, second half.

---

## Step 7. Post-push checks

Run each against production (and against staging in step 3). One statement per
`supabase db query --linked` call.

**7a. No unexpected overloads.** This is the 0115/0119 defect class: two live signatures of one
function, where keyed callers silently run the old body and keyless callers get `PGRST203`.

```sql
select n.nspname || '.' || p.proname                                           as fn,
       count(*)                                                                as live_signatures,
       array_agg(pg_get_function_identity_arguments(p.oid) order by p.oid)     as signatures
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'app'
 group by 1
having count(*) > 1
 order by 1;
```

**Expect:** exactly two rows, `app.business_date` and `app.llm_record_usage`, the only names
allowed by `packages/db/fixtures/rpc-overloads.json`, each for a stated reason.
**If it differs:** any third name is a stray overload that reached production. Do not paper over it
with a grant; find the migration that re-issued the function at the wrong arity, and write a new
migration that drops the stray by exact signature and re-issues the intended body, the way 0119 did.

**7b. Cron jobs.**

```sql
select jobid, schedule, jobname, active from cron.job order by jobname;
```

**Expect:** rows, all `active = true`: the hold sweep, the push sweep and the telegram nudge at
least. Schedules are created by best-effort `DO` blocks (0021, 0031), so a missing row is a silent
failure, which is why it is checked by hand.
**If it differs:** no rows at all means `pg_cron` is not installed (see 7c). Missing individual jobs
means re-run the relevant `DO` block from its migration.

**7c. Extensions.**

```sql
select extname, extnamespace::regnamespace as schema from pg_extension order by extname;
```

**Expect:** `pg_cron`, `pg_net` and `vector` present, plus `btree_gist` in `extensions` (the
reservations exclusion constraint depends on it).
**If it differs:** `vector` missing means the assistant migrations (0108–0113) did not fully apply.
`pg_net` missing means push and Telegram will go dark.

**7d. Ledger at zero.**

```sh
cd packages/db && npx supabase migration list --linked
```

**Expect:** 0 pending, local head `0121` on both sides.

**7e. The types-drift step.** The CI job regenerates `src/types.gen.ts` and diffs it
(`.github/workflows/ci.yml:337-338`). **Expect:** green on the latest `main` run.
**If it differs:** the committed types do not match the schema. Regenerate locally with
`pnpm --filter @touch/db db:types` against a stack holding every migration, and commit the result.

**Closes** `PHASE-2-CHECKLIST.md` L45.

---

## Step 8. Supabase Auth dashboard

Milestone 0 restored email sign-up, sign-in, verify and reset beside phone in the mobile app, and
closed the S6 deep-link findings. Three dashboard settings finish it. Production project →
Authentication.

1. **Providers → Email → Confirm email: ON.** Without it a typo'd address becomes a usable account.
2. **Sign In / Providers → Email → Secure password change: ON.** This is the server half of S6: it
   makes GoTrue require the current password (or a fresh recovery session) before a password change,
   so a hijacked session cannot take the account over.
3. **URL Configuration → Redirect URLs.** The allow-list must contain, exactly:
   - the web origin, the value of `NEXT_PUBLIC_SITE_URL` for the deployed guest site, plus its
     Vercel origin while the real domain is still parked;
   - `touchpadel://verify-email` and `touchpadel://reset-password`, the two redirects the mobile
     app actually asks for (`apps/mobile/src/features/auth/api.ts:27-28`). The scheme is
     `touchpadel`, declared in `apps/mobile/app.config.ts:166`.

   **Expect:** email verification and password reset from a device land back in the app.
   **If it differs:** a redirect that is not on the list comes back as `otp_expired` or a generic
   error, which reads like a broken link rather than a configuration problem. Add the URL and retry
   before debugging anything in the app.

While you are there, leave the phone settings as `docs/client/phone-otp-activation.md` describes
them, and note that the **store-review test number is still not configured on hosted** (§C step 7 of
that file). It is part of S10, step 9 below.

**Closes** `PHASE-2-CHECKLIST.md` L46.

---

## Step 9. GitHub, release gate, the tag, the OTP variable

**2026-09-21, later the same day:** §1 and §3 of the release-gate runbook were applied and then undone on the owner's decision (no protection rules; see that file's header and D11). Only 9.3, the OTP variable, remains in force from this step.

1. **`docs/client/release-gate-2026-09-20.md` §1–§5.** Do not re-read the detail here; that file is
   the runbook. The order matters: **§4 before §2**, because §2 revokes the `gh` session §4 uses.
   §1 the `release` environment with a required reviewer and an `operator-v*` tag rule; §2 swap
   `RELEASES_GH_TOKEN` for a fine-grained PAT scoped to `touchpadel-releases` and revoke the old
   OAuth session; §3 the `operator-v*` tag ruleset; §4 delete the pre-fix `ledger-snapshot-*`
   artifacts and decide on the table-token secret; §5 verify.
   **Expect:** `gh api repos/KaguSoftware/TouchPadel/environments/release -q '.protection_rules[] |
   .type'` prints `required_reviewers`.
2. **Cut `operator-v0.2.14`.** The next tag after 0.2.13. **Claude cannot push tags. Parsa pushes
   it.** §5 of the release-gate file is the verification: the run must stop at **publish** waiting
   for review; approve it; a till picks the build up within six hours.
   **If it differs:** if the run publishes without waiting, the environment does not exist or has no
   reviewer, so §1 was not applied. If you must re-cut the same version, delete the release and tag in
   the public repo first (`gh release delete v0.2.14 --cleanup-tag -y -R
   KaguSoftware/touchpadel-releases`).
3. **The repository variable `SUPABASE_AUTH_SMS_TEST_OTP_CODE`.** Settings → Secrets and variables →
   Actions → **Variables** → New repository variable, or:
   ```sh
   gh variable set SUPABASE_AUTH_SMS_TEST_OTP_CODE -R KaguSoftware/TouchPadel
   ```
   Value: a **fresh six-digit code you choose now**. **Never `123456`**. That is the value committed
   in `config.toml` today, and it is also one of the three shapes the PIN rule refuses, for the same
   reason. Do not reuse it, and do not write the new value into any file in the repository.
   **Expect:** `gh variable list -R KaguSoftware/TouchPadel` shows the name; the value is not
   readable back.
   **Note:** the code that consumes this variable is **S10**, being wired in parallel: `config.toml`
   moves to `env(SUPABASE_AUTH_SMS_TEST_OTP_CODE)`, `db:start` verifies the substitution, and a gate
   refuses any `config push`. Creating the variable early is harmless and unblocks that work.

**Closes** `PHASE-2-CHECKLIST.md` L47.

---

## When all nine are done

Tick L40–L47 in `PHASE-2-CHECKLIST.md`, record the dates in this file (PITR enabled, staging ref,
the version production ended on), and Milestone 0's owner half is closed. What remains of Milestone
0 is code: item 11 and S10.
