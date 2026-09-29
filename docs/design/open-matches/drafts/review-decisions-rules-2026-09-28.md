> **Adversarial review, decisions + rules + gates, 2026-09-28.** Read-only review of
> `../build-contracts-2026-09-27.md` §0, §1, §1.12 and the four lane drafts
> (`db-`, `money-`, `guest-`, `operator-2026-09-28.md`), checked against the rules files and the gate
> scripts at `fa86fe09` (latest migration 0248). Sibling: `review-concurrency-money-2026-09-28.md`
> (races, money invariants). Citations: `bc:` = build contracts, `db:` / `mo:` / `gu:` / `op:` = the
> four drafts, `NNNN:line` = a migration, anything else is a repo path.
>
> **This file needs an `assistant-coverage.json` `docs` entry before it is committed** (see G8b).

# Review: decisions, rules and gates

## Verdict

Every OM and DF decision has a home in at least one draft. The design is buildable. **As written it
would not pass CI**, for four reasons:

- **The lock gate fails on two functions.** `app.match_lock`, which every seat-taking and marking
  call goes through, fails. So does `deposit_apply` once it is walked.
- **Three §1.12 rulings are not applied.** R1, R4 and R9 are not in the drafts, and R11 is missing
  from the operator's code table.
- **Four fixture gates trip.** SEC-20, `check:error-codes`, `check:assistant-coverage` and
  `check:migrations` each fail on the drafts as written.
- **The Book tab breaks.** The DB lane caps guest windows at 8 days, but the phone asks for its
  15-day strip.

The drafts also disagree on about 40 names and shapes. Most of that is read-payload drift between
the DB/Money lanes that build a payload and the Guest/Operator lanes that read it.

Six items change what players or staff experience. They go to Parsa, not to the merge:

- **Q1. Call-off with unmarked seats.** Either the unmarked seats are counted as present (DB), or
  every seat must be marked first (Operator).
- **Q2. Cash-out granularity.** MD-4 refuses a purchase's cash-out while any one of its tickets is in
  a match. OM-48 says "a manager can refund unused tickets".
- **Q3. Ban reason.** A fixed code (DB) or a free note (Operator).
- **Q4. How long waiting and forgetting last.**
  - How long `awaiting_court` waits: until the start, or until the fill deadline.
  - Whether unmarked seats auto-attend at `end_at + 3 h` (DB open questions 1 and 2).
- **Q5. Reports "kept 12 months".** The privacy text says so, but nothing deletes them.
- **Q6. Gender and other players' names reaching the owner's AI assistant.** They would travel
  through the `customer_record` and `booking_bill` tools.

## 1. Decision coverage

Status key: **Done** = specified end to end. **Partial** = specified, but one lane is missing or out of
step. **Contradicted** = a draft says the opposite of §0 or §1.12. **Missing** = no draft owns it.

| ID | Status | Where | Verdict |
| --- | --- | --- | --- |
| OM-3 visibility | Done | db:116, db:676-693, gu:565-566, op:215 | Token is 16 random bytes → 22 url-safe chars (db:923-924), matches `^[A-Za-z0-9_-]{22}$`. |
| OM-4 join policy | Done | db:936-1028, gu:622-628, op:214, op:231 | The desk never approves (op:231); an `approve` desk match needs an account organiser (db:1246-1248). |
| OM-7/38 category fixed | Done | db:118, gu:563-564, op:213 | No RPC can change it. |
| OM-12/19 waits-for-four only | Done | db:520-536 | — |
| OM-13 no court held, firm bump | Done | db:1516-1565, op:188-200, gu:648-649 | See G1: the trigger's body breaks the lock gate on two callers. Bump warning only in the new-booking dialog (op:692-694, known limit). |
| OM-16 no levels | Done | gu:1293 ("no level-based matchmaking") | Nothing in any draft adds a level. |
| OM-17 preset messages | Done | db:1084-1091, gu:739-753, gu:921-924 | — |
| OM-20 up to 3 seats | Done | db:893, db:1249, gu:568-571, op:212 | — |
| OM-22 fill deadline setting | Done | db:460, op:397 | — |
| OM-25 no new tab | Done | gu:450-551, gu:785-853 | The `/matches` list opens from the sheet. Profile rows for tickets and blocks are menu rows, not a tab. |
| OM-26 "First I.", Former player | Partial | db:366-437, db:697-709, gu:153-252 | Two different specs of the same 0253 file: prefix list, three-token "Abd al", trigger column list, GUC name, CHECK set and grants all differ (Disagreements D1). DB's §2.4 is the stricter one. |
| OM-27 report + block + ban | Partial | db:1093-1118, db:1410-1421, db:1442-1449, gu:755-783, op:379, op:405-415 | Ban reason is 4 codes in DB (db:1413) and a free note in the operator (op:105): every operator ban would fail `REASON_REQUIRED` (Q3). |
| OM-28 gender once; staff correct | Done | db:439-444, db:668, db:1423-1428, gu:311-321, op:376 | DB allows clearing to NULL; the operator offers only two values. Harmless. |
| OM-29/30 desk powers | Done | db:1238-1408, op:150-347 | — |
| OM-31 no name on a lock screen | Done | gu:900-924 (every body is nameless), db:1108-1109 (staff key, no params) | — |
| OM-32 links + web page, 1.0, per-branch switch | Done | gu:678-735, gu:1047-1109, db:459 | Android verification waits for the Play fingerprints (gu:1057-1060). |
| OM-33 own milestone and tables | Done | bc:102-116 | — |
| OM-34 organiser handover | Done | db:817-829, gu:664-665 | — |
| OM-36 eligibility | Done | db:658-669, mo:204-217 | Two copies of the eligibility check: `match_guest` and `ticket_payment_prepare` (mo:211-213). A test must pin both (mo says so). |
| OM-37 max 3 filling | Done | db:907-909, op:399 | Chain-wide count; desk seats are exempt (db:1266-1267). |
| OM-39 friend gender | Partial | db:237-247, gu:569-571 | `desk_match_detail` returns seat `gender` (db:1227), but the Players panel row never shows it (op:247-250). "The desk can check" needs it on the row. |
| OM-41 games and no-shows to the organiser | Done | db:836-843, db:1151-1152, gu:638-640, gu:1296 | — |
| OM-42 filling ≤ firm-free courts | Done | db:912-914 | The phone's pre-check counts free cells, not firm-free courts (gu:492-497). The server stays authoritative. |
| OM-43 start ≥ deadline + 60 | Done | db:911, gu:495, op:216 | — |
| OM-44 remove, no rejoin | Done | db:1057-1073, gu:657-658 | — |
| OM-45 reusable ticket | Done | db:576-592, mo:345-366 | — |
| OM-46 ticket price chain setting | Done | db:461, op:398 | — |
| OM-47 short one | **Contradicted** | db:210, db:1299-1301 vs bc:372 (R4), op:318-319 | The DB seat-number index still covers `no_show`, and `desk_add_seat` cannot fill a no-show's number, so "the desk may add a walk-in" is impossible. Call-off semantics differ between DB and Operator (Q1). |
| OM-48 cash-out at the desk, no expiry | Partial | mo:370-394, op:378 | MD-4 (mo:36) refuses the cash-out while any ticket of that purchase is reserved or in use, so a player's other unused tickets cannot be refunded (Q2). |
| OM-11 refilled leaver's ticket back | Done | db:553, db:961-963, db:1299-1301 | Also restores the ticket if it was already forfeited at the start. |
| OM-14 attended = ticket back + share | Done | db:556, mo:460 | — |
| OM-18 seat needs a ticket; buy | Done | db:764-766, gu:390-427 | — |
| OM-23 leave while filling = ticket back | Done | db:547 | — |
| OM-24 leave after booking ≈ no-show unless refilled | Done | db:552-554 | — |
| OM-35 reserved at request | Done | db:570-575 | — |
| DF-1 branch picked; link never changes it | Done | gu:528, gu:600, gu:704 | — |
| DF-2 normal slot lengths | Done | db:897 | — |
| DF-3 price stamped; quote = charge | Partial | db:918-919 (guest path) | `desk_start_match` has no quoted-price argument (bc:281). The operator shows a price it computed itself (op:217), which can differ from the stamp. |
| DF-4 move/extend re-prices; line on the bill | Done | db:1543-1545, mo:612-614 | — |
| DF-5 pushes per §1.9 | **Partial** | gu:855-1045 | Keys, copy and `match_notify` are specified. **Nobody owns the mechanism** that turns `match_events` and `match_ticket_events` rows into `match_notify` calls, or the callers of `match_sync_reminders` (db:1892-1895 and gu:946-974 each point at the other). |
| DF-9 web page shows no names | Done | db:1177-1181, gu:1091-1098 | The guest lane reads `timezone` from `match_invite`, but DB does not return it (D12). |
| DF-10 gender and block filters | Done | db:686-693 | — |
| DF-11 online only | Done | db:855-856, op:15-28 | Two different scope-ledger rows are proposed (D25). |
| DF-12 seat no-shows in the total | Done | db:1483-1488 | Deposit policy does not count no-shows (0242 `deposit_mode_for`), so nothing else needs the term. |
| DF-14 OM-40 dropped | Done | — | Nothing to build. |
| DF-15 friend no-show on the holder | Done | db:840-843 | — |
| DF-16 café on its own bill | Partial | mo:42, op:364-365 | UI-only wall. The till's picker can still attach café lines (op:759-763). Accepted as MD-10; record it as a known limit. |
| DF-17 UGC Yes; terms re-accepted at 1.0 | Done | gu:1284, gu:1301 | — |
| DF-18 hold at 4th → awaiting_court | Done | db:522, db:527-530 | End condition is open (Q4). |
| DF-19 sandbox isolation | Partial | db:681, db:736, mo:738-746 | **The review account has no way to get sandbox tickets or a sandbox match at 2/4** (gu:1588-1590). No lane owns it. |
| DF-20 deletion | Partial | db:1494-1514, mo:411-427 | The refund function name and the caller disagree (D2, D3). Money's lock claim for `delete_my_account` is wrong (mo:761). |
| DF-21 price change never touches bought tickets | Done | mo:429-433 | — |
| R10 switch off | Done | db:504-507 | Operator open question 4 is already answered by R10. |

### What §0.1 says that the drafts dropped

1. *"The desk may add a walk-in"* in a short game. The DB lane does not apply R4 (row OM-47).
2. *"No card refunds except a manager cash-out of unused tickets."* MD-4 narrows this to whole
   purchases with nothing in play (row OM-48). It is a technical limit: one refund per
   `booking_payments` row (0241:56-57). The player-visible effect is a Parsa call.

Nothing else was dropped.

## 2. Gate violations, as written

### G1. `check:locks` (`packages/db/scripts/check-lock-order.mjs`, CI db job): two hard failures

The walker expands **every** trigger of a written table and ignores its `WHEN` clause
(`sequence()`, check-lock-order.mjs:149-160). `app.expire_stale_holds` locks and writes
`reservations` in one statement (0242:1495-1515, `update … for update of r`). So every caller of it
now expands the new `reservations_match` body, which contains:

- `lock_match_venue`, emitted as `match_venue_advisory`;
- `match_end` → `ticket_release`, which is `match_tickets` FOR UPDATE.

1. **`app.match_lock` (db:650-656): Rule 1 inversion.**
   - The sequence is `court_advisory → [expire_stale_holds: reservations, trigger → match_venue_advisory
     → match_tickets] → reservations` (step 3, the booking row FOR UPDATE).
   - Every L2 caller inherits it: `match_join`, `match_decide`, `desk_add_seat`, `mark_match_seats`,
     `desk_call_off_short`, `match_seat_write_off`.
   - **Fix:** take the booking row FOR UPDATE right after the court locks and before
     `expire_stale_holds`. In practice, split `match_lock_courts` into a lock step and an expire
     step. It is also the runtime order the gate expects.
2. **`deposit_apply` once walked (bc:228-229, db:629-631): Rule 1 inversion in its callee.**
   - `deposit_settle_success` runs `update reservations` (0242:541, which expands the trigger), then
     `perform app.expire_stale_holds` (0242:560, a reservations FOR UPDATE).
   - **Fix, in Money's 0255 re-issue (it re-issues this function anyway, mo:178):** put the
     `r.status = 'expired'` re-create branch textually before the `pending` branch. The branches
     are exclusive; the walker reads text order.
   - The alternative is to keep `deposit_apply` off the walk list, with the reason written in the
     script.
3. **Keep DB's "emit `match_venue_advisory` once per sequence" rule (db:626-628).** Without it every
   L2 body reads as `match_tickets → match_venue_advisory`.
4. **R8 is not applied.** The walker list at db:629-631 lacks `ticket_refund_deleted` and
   `tickets_cash_out` (bc:376).
5. **`match_tickets` is safe next to the KDS `tickets` in `TBL`.** The alias regex is anchored after
   `from|join|update\s+`, so `from match_tickets` never matches `tickets`.

A read-only approximation of the walker over the current migrations found no other existing function
that writes `reservations` and then locks `court_advisory` or `reservations` again. Only
`deposit_apply` and `deposit_settle_success` do. Re-run `check:locks` on the stack after 0260 to
confirm.

### G2. `check:migrations`

- **a. An ALTER-added constraint without NOT VALID.**
  - `alter table match_seats add constraint match_seats_ticket_fk …` (db:196) has no `NOT VALID`,
    so it trips `constraint-validating`. It is waivable, but it should not need a waiver.
  - Add it `NOT VALID`, then run the guarded `VALIDATE` (the table is empty).
- **b. Every `create index` in 0255 trips `index-not-concurrent`.**
  - That covers the new tables and `booking_payments_one_active_ticket` on an existing table
    (mo:91-92).
  - bc:100 and mo:100 put the waiver "in the PR body". **This repo pushes to `main`, not through
    PRs.** CI reads `PR_BODY` only from `github.event.pull_request.body` (`.github/workflows/ci.yml:144`).
  - On a direct push the merge base is the pushed HEAD, so CI's run appears to judge an empty diff.
    The gate of record is the local run.
  - The precedent is the waiver line in the **commit message**: `git log` shows "MIGRATION-RISK-ACCEPTED:
    plain indexes on new, empty tables".
  - Fix bc:100 to say: "waiver in the commit body; run `MIGRATION_RISK_ACCEPTED=… node
    scripts/check-migrations.mjs` before the push".
- **c. The CHECK widenings are compliant.** 0249, 0250 and 0251 each stand alone, re-list the
  values, and use `NOT VALID` plus a guarded `VALIDATE` on `conname` and `conrelid` (db:450-452,
  mo:51-63, gu:1040-1041).

### G3. `check:rpc-registry`, `tests/rls-matrix.ts`, the coverage floor

- **a. The floor is 340/342** (`fixtures/rpc-coverage-floor.json`).
  - A commit that grants an RPC without its matrix row lowers the ratio and fails `pnpm security`.
  - CONTINUE.md:87 batches every matrix row, allowlist entry, coverage key and error map into
    step **2g**. That breaks the one-commit rule (`packages/db/CLAUDE.md:14-16`): every commit
    for 2a–2f would be red. **Gates travel with the migration that needs them.**
- **b. One drop number (23) for all three lanes' rows.** DB proposes 23 (db:1701); Money and Guest
  name no drop.
- **c. The `match_seat_write_off` row follows R1.**
  - `ex('guarded', {anon:'denied', court_desk:'execute', manager:'execute', owner:'execute'})` with
    `p_pin: MANAGER_PIN`, the `deposit_refund_manual` form (tests/rls-matrix.ts:4255-4258).
  - Money's roles text (mo:582-584) is manager and owner only. That contradicts R1.
- **d. No stray overloads.** Every re-issue keeps its signature. The only signature §1.12 changes is
  the new `match_seat_write_off`.

### G4. `check:authz` and the guard-first rule

- **`match_settings` (db:475-476) and `match_reports_open` (db:1432-1433) resolve
  `coalesce(p_venue_id, app.current_venue())` before their guard.**
  - With two active venues, an anonymous guest gets `VENUE_REQUIRED`. That code is not in the
    sweep's `REFUSED` set (check-rpc-authz.mjs:98), so the run fails.
  - It also breaks "the role or venue guard is the first statement" (`packages/db/CLAUDE.md:151-152`).
  - **Fix:** `if not app.is_staff('manager','owner') then raise exception 'FORBIDDEN'` first, as 0242's
    `deposit_settings` does. Then resolve the venue and check `is_staff_at`.
- **Guest RPCs pass.** `match_guest` comes first (db:658-669). `my_tickets` checks
  `AUTH_REQUIRED` and `ACCOUNT_REQUIRED` first (mo:322).

### G5. SEC-20 (`packages/db/tests/stored-fields.test.ts`)

- **a. Money declares `payment_match_seats` (mo:834-835), but it carries no `LINK_COLUMNS` column.**
  The test fails with *"declared here but no longer carries a guest link"*
  (stored-fields.test.ts:272). Do not declare it.
- **b. `LINK_COLUMNS` must gain the six new link columns (db:1677-1678):** `organiser_id`,
  `blocker_id`, `blocked_id`, `reporter_id`, `reported_id`, `actor_guest_id`. Without them,
  discovery never finds `matches`, `match_events`, `match_blocks` or `match_reports`.
  Guest (gu:255-265) edits the same file: make it one edit.
- **c. `match_seats.guest_name` and `guest_phone` are declared `scrub` (db:1686), but the proof is
  impossible.**
  - `match_seats_kind` (db:204) forbids a name or phone on any seat with a `guest_id`.
  - The deletion test can never populate them on a row the deleted guest owns, so the proof is
    vacuous.
  - Declare them honestly as staff-typed walk-in data that account deletion never reaches (as
    `reservations.guest_name` is for walk-ins), and prove the `gender` scrub on a linked seat instead.
- **d. `match_requests.friend_genders` is gender data, declared `n` (db:1687).**
  - Declare it as `'Other personal info'`, with `scrub`.
  - Null it in 0261 beside the seat `gender`.
- **e. The deletion test populates only `profiles`, `reservations` and three `row` tables**
  (stored-fields.test.ts:314-356). It must also set:
  - `profiles.gender`;
  - a linked match seat;
  - a pending request;
  - a block (a `row` delete, db:1501).
- **f. `Category` gains `'Other personal info'` exactly once.** DB (db:1676) and Guest (gu:255) both
  add it.

### G6. SEC-28 and SEC-29

- **a. The analytics gate scans every client-callable `report_%` function**
  (check-analytics-payload.mjs:90). That includes the new `report_matches` and the re-issued
  `report_courts`.
  - Their keys are clean as drafted (mo:709-736).
  - Never put a `label`, `full_name` or `customer_id` into them. The staff labels belong only in
    `unpaid_played_bookings` and `booking_bill`, which are not scanned.
- **b. One edit to both `FORBIDDEN` lists, using DB's superset** (db:1695-1699 ⊇ gu:267-269).
  - `/\bgender\b/i` does not match `gender_set_at`, because `_` is a word character. That is
    acceptable.

### G7. `check:error-codes` (runs in `pnpm security`)

- **a. `RATE_LIMITED` is on `fixtures/error-codes-unmapped.json:64`.**
  - R6 maps it on mobile (gu:1156-1157). The gate then fails *"a listed code is now mapped"*
    unless `node scripts/check-error-codes.mjs --update` runs in the same commit.
  - The Guest draft does not say so. `CUSTOMER_NOT_FOUND` (:23) has the same rule, and DB and Money
    do say it for that one.
- **b. `TICKET_IN_USE` (raised in 0256, mo:377) is not in the operator's table** (op:475-502).
  R11 requires it (bc:379). As drafted the gate fails at 0256, and the cash-out refusal renders
  generic. The operator's handling at op:108 also omits it.
- **c. Detail-bearing codes pass the gate but show the wrong words** (§4.2):
  - `SEAT_MARK_LOCKED` (3 details);
  - `INVALID_TRANSITION` (6);
  - `TICKET_COUNT_INVALID` `wallet_limit`;
  - `PAYMENT_STATE` `ticket`, `tab_has_orders` and `over_paid`.

### G8. `check:assistant-coverage` and `tests/assistant-map.test.ts` (both in `pnpm security` / `pnpm test`)

- **a. Every `create function app.X` needs a `functions` entry, granted or not**
  (`inventoryFunctions`, build-assistant-map.mjs:276-301).
  - Money lists tables, RPCs and the edge function only (mo:841-842). It is missing
    `match_money`, `court_fee_written_off`, `ticket_settle_success`, `tickets_cash_out`,
    `ticket_refund_deleted` and `ticket_wallet`.
  - Guest lists only `set_my_gender` (gu:270-272). It is missing `match_notify` and
    `match_sync_reminders`.
  - DB covers its own (db:1733-1735).
- **b. `inventoryDocs` walks the filesystem** (build-assistant-map.mjs:147-155, :485-490).
  - **This file and the concurrency review each need an `excluded:` docs entry in the commit
    that adds them.**
  - When the drafts are deleted after the merge, their four entries
    (`fixtures/assistant-coverage.json:999-1002`) and the two review entries must go in the same
    commit. Otherwise the gate fails with "in the fixture but no longer in the code".
- **c. `build-contracts-2026-09-27.md` is `index:doc` (assistant-coverage.json:997), so its text
  is chunked into the map.**
  - The merge edit, and every later edit, makes `assistant-map.test.ts:47-59` stale until
    `pnpm --filter @touch/db assistant:map` runs in the same commit.
  - One of the three regenerated files sits under `supabase/functions/_shared/assistant/`, so that
    commit also starts `functions-deploy.yml`.
  - Consider marking the contract `excluded:` (engineering spec, not venue knowledge). That stops
    a ~350 KB SQL spec from entering the owner's assistant index.
  - DB's "untracked today" (db:1737-1738) is stale: the doc is tracked and covered.
- **d. `/desk/matches/$id` has no `ROUTE_ROLES` entry** (op:451-453), following the
  `/desk/bookings/$id` precedent (`routes/desk/_children.ts:92`, absent from `auth.tsx:226-229`).
  That passes the gate. `apps/operator/CLAUDE.md:20-22` asks for registration, so write the
  exception down in the operator section.

### G9. i18n

- **a. Digits.**
  - `formatNumber` pins Latin digits for Arabic (`packages/i18n/src/formatting.ts:20`,
    `ar-IQ-u-nu-latn`; `:173-175`). The guest lane is right (gu:1264-1265).
  - The operator's "Arabic digits come from formatNumber/formatIQD" (op:522-523) and its jsdom case
    "AR render … with Arabic digits" (op:579-580) are wrong, and that test would fail. Assert Latin
    digits.
- **b. Plurals.**
  - The operator claims "no plurals, label-and-figure" (op:522), but writes counted phrases:
    - "needs 1 more by 19:00" (op:229);
    - "Take 2 shares · 20,000" (op:288);
    - "Take Sara + 1 friend" (op:289);
    - "Cash out 2 unused (20,000)" (op:378);
    - "Players still owing: 2" (op:176, acceptable).
  - Either use `pluralForm` (gu:1231-1238) or rewrite them as label-and-figure.
- **c. Catalogs.**
  - `matches.en.ts` / `matches.ar.ts` follow the `branches.*.ts` precedent. Type the Arabic file
    `DeepMessages<typeof matchesEn>` like the `ws` lanes, so a missing key fails `typecheck`, not
    only the parity test.

### G10. Mobile smoke and testID lint

- **Pass.** Seven route rows (gu:1306-1317), with no new `_layout.tsx` (routes.test.ts allows
  exactly two layouts), and every navigation target has a file.
- **`tickets.buy`'s label interpolates "Pay {total} with Qi Card".** The smoke case asserts
  `makeT(locale)(<key>)`, so give the case its params or make the primary a static key.
- **`match-link.sign-in` exists only signed out.** The smoke render must use the signed-out state.

### G11. Web

- **Pass.**
  - `LINK_PATHS` edit (`apps/web/src/lib/security/applinks.ts:48`).
  - The proxy matcher is unchanged (the token has no dot).
  - A page test, the `proxy.test.ts` 307 case, and `security:web`.
- **Missing:** the delete-account copy (§4.5, item 6).

### G12. `check:safeupdate`

- `update tabs set court_cap_iqd = v_amount` (mo:539) has no WHERE as written. Say `where id =
  v_tab_id`.

### G13. `PIN_GATED_RPCS`: three copies held equal by a test

- The copies are `packages/core/src/schemas/mutations.ts:49-56`, `_shared/mutation-types.json`
  (`pinGatedRpcs`) and `packages/db/tests/helpers.ts:162`.
- Money names all three (mo:844-845). The operator names one (op:733). Merge on Money's list.

## 3. Rollout and deploy order

`functions-deploy.yml` fires on `packages/db/supabase/functions/**` and `supabase/config.toml`, and
`db-migrate.yml` on `supabase/migrations/**`. A push that touches both starts both at once. The
assistant map's copy lives under `functions/_shared/assistant/`, so any commit that regenerates the
map also redeploys functions.

1. **Push A: functions only.**
   - Contents:
     - `guest-push.json`, `guestStrings.ts` and the `send-push` guest branch;
     - `staff-push.json` and `staffStrings.ts` with `match_report_new`;
     - Money's `_shared/deposits.ts` type change and the `createAtGateway` extraction (mo:859-860);
     - **no** `ticket-begin` and **no** `config.toml`.
   - Wait for `functions-deploy` to go green.
   - Both the Guest (gu:1036-1045) and Money (mo:857-858) drafts agree.
2. **Push B: 0249, 0250 and 0251**, three files, CHECK widenings only. This must come after push A,
   because an unknown kind is terminal in a stale `send-push`.
3. **Push C: 0253.**
   - After it is hosted, the two-name profile screens and GenderAsk plumbing may ship over the air.
     `expo-updates` is present and `runtimeVersion` follows the app version (`app.config.ts:196-227`).
   - Until 0253 is hosted, deletions are already covered: the sync trigger nulls the new columns on
     the tombstone (db:410-411, gu:198).
4. **Push D: 0254–0262.**
   - Each file lands with its own gates (G3a) and `types.gen.ts`.
   - `matches_enabled` stays false everywhere.
   - **0255 carries the nine deposit-hook re-issues before any ticket row can exist** (mo:170-189).
     That holds only if 0255 is never split. `deposits.test.ts` must stay green unmodified.
   - Commit bodies carry the `MIGRATION-RISK-ACCEPTED` line (G2b).
   - Afterwards, check that `cron.job` has `tp_match_sweep` (db:1629-1631).
5. **Push E: functions.**
   - `ticket-begin` and `config.toml` `[functions.ticket-begin] verify_jwt = true`, after 0256 is
     hosted (mo:860).
   - It may ride with push F if F touches no migration.
6. **Push F: web and docs.**
   - `/[locale]/m/[token]`, `LINK_PATHS`, the legal catalogs and the store docs.
   - Set Vercel `APPLE_TEAM_ID=BR42V976FS` first (gu:1055-1056); both `.well-known` routes are
     `force-static`.
   - This push is a production Vercel build (root CLAUDE.md), so batch it with other non-db work.
7. **Operator tag, after 0259 and 0262 are hosted** (mo:861-863).
   - A build that meets a missing RPC shows "needs a connection" (op:167-168, :426-428). Map
     PGRST202 to "not available yet" instead.
8. **Native mobile build (owner-run `eas build`).**
   - `intentFilters`, and `EXPO_PUBLIC_LINK_DOMAIN` in all three `eas.json` profiles. That changes
     `associatedDomains` (`app.config.ts:36,257`).
   - Then TestFlight and an internal APK. Turn on `matches_enabled` at one branch with sandbox
     profiles, once **DF-19's review-account seeding has an owner** (it has none today).
9. **1.0.**
   - Ship the terms-bump build (`packages/core/src/legal/terms.ts:13`).
   - Set `match_terms_version` by migration only after that build is on phones (db:470-471,
     gu:1301). That is a push-D-style migration push.
   - Then the store answers, the store URLs on Vercel, and the Play fingerprints plus a redeploy.

Gaps in the lanes' own order lists:

- **CONTINUE.md:87 (step 2g)** contradicts G3a. It must be dissolved into 2a–2f.
- **Money's 0256 calls `match_notify`.** It should: see D26, where the direct outbox insert is
  replaced. `match_notify` ships in 0257; PL/pgSQL binds late, so that works only if 0256 and 0257
  land in the same push. Push D does that. Never split them.
- **The contract merge (CONTINUE step 1.2) is itself a commit that trips G8c.**

## 4. UX gaps

### 4.1 Guest

1. **A restricted viewer who opens a link hits a dead end.** `match_detail` answers `restricted`
   with no id (db:1140-1141). `m/[token]` signed in then calls `router.replace('/match/[id]', {id})`
   (gu:695-697). Render the restricted card inside `m/[token]`, with `me.refusal`, instead of
   navigating.
2. **A customer the desk seated as the organiser sees nothing.** `guestStateOf` reads only the
   guest's own `account` seat (gu:796). A linked `desk` seat (db:1272-1273) matches no row. Treat
   linked desk seats as the guest's own.
3. **A player the desk removes before start reads "You left"** (gu:813). Desk removal for
   `conduct`, `customer_request` or `other` becomes `left_late` with `end_reason =
   removed_by_staff` (db:1327). Add a `removedLate` state: "The venue removed you · your ticket is
   held until someone takes your seat".
4. **`no_court` is mislabelled.** An `awaiting_court` match that reaches its start with no court
   ends `expired (no_court)` and reads "Cancelled by the venue" (gu:826). A deactivated court ends
   `bumped (no_court)` and reads "a group booked the last court" (gu:823). Both are false. Add
   "Four players, but no court came free · tickets back".
5. **The wallet-limit refusal reads "You can buy 1 to 3 tickets at a time"** (gu:1149). The detail
   is `wallet_limit` (mo:215-216). Branch on the detail: "You already hold the most tickets you can
   (9)".
6. **The forfeit push says the ticket "was used up"** (gu:919). Players are told that tickets come
   back after play, so "used up" reads as normal use. Say it is lost and why, with no name: "You
   didn't come / nobody took your seat, so this match's ticket is lost."
7. **`REQUESTER_INELIGIBLE` leaves the organiser stuck** (gu:1142). Offer Decline on that row.
8. **`MATCH_TOO_LATE` carries the minutes (db:911), but the copy ignores them** (gu:1125). Show the
   earliest start time.
9. **A purchase in progress is invisible.** Money returns `my_tickets.pending` (mo:332); the guest
   shape and the tickets screen drop it (gu:122-130). Show "Payment in progress · Continue".
10. **The cash-out note promises a refund of unused tickets** (gu:346-347). MD-4 refuses it while a
    ticket of the same purchase is in a match. Align the note with Q2.
11. **The Book tab asks for 15 days; DB allows 8** (see D11). Today the chips would fail with
    `INVALID_ARGUMENT`.

### 4.2 Staff

1. **Call-off.** The operator maps `MATCH_MARK_SEATS` as "mark every seat first" (op:101) and gates
   the button on all seats being marked (op:327). DB never raises that code in call-off; it marks
   unmarked seats as attended (db:1401). DB also allows a call-off when a seat is only `left_late`;
   the operator needs a `no_show`. This is Q1: pick one.
2. **Mark refusals all read "This mark can't be changed any more"** (op:494). The three causes need
   three sentences (db:1356-1377):
   - `day_closed` → "the day is closed";
   - `ticket_used` → "they already used this ticket in another match";
   - `court_reused` → "the court was booked again".
3. **`INVALID_TRANSITION` details `marked` and `use_attendance` from Remove (db:1315-1317)** need
   "Undo the mark first" and "After the start, use Arrived or No-show".
4. **Write-off.** Only managers see the button (op:305-308, op:446). R1 says the desk starts it and
   a manager PIN authorises it.
5. **Ban.** The operator sends a free note (op:105) and DB accepts four codes (db:1413). See Q3. If
   codes win, the badge must translate `label` (the code) instead of printing it.
6. **The cash-out's `TICKET_IN_USE` is unhandled** (op:108). The panel should say "1 ticket of this
   purchase is in a match; cash out after it comes back".
7. **Walk-in in a no-show's place.** The operator builds the button (op:318-319); DB cannot serve it
   (G-R4).
8. **The `'Open match'` English literal (db:18-19) leaks into surfaces without `bookingLabel`:**
   the staff phone's lists, Telegram summaries, report drill rows, and `unpaid_played_bookings.guest_name`.
   Arabic staff read English there. Either translate at the read, or accept it as a known limit.
9. **The desk start dialog shows a price it computed itself** (op:217). `desk_start_match` stamps
   its own price (bc:281). Show the server's `price_iqd` and `shares_iqd` after the start, or add
   `p_quoted_price_iqd`.
10. **Players panel rows never show the seat's gender** (op:247-250), which is what OM-39's "the
    desk can check" needs.

### 4.3 Arabic and RTL

1. **Digits: Latin in both apps** (G9a).
2. **The operator's call-off buttons use a masculine imperative, "ألغِ المباراة", and the unnatural
   "تُخسر"** (op:341-343). Use the verbal noun "إلغاء المباراة", and write "ويخسر {missing}
   تذكرته" (or "تُفقد تذكرة {missing}"). Staff are women and men; the guest lane already avoids
   gendered imperatives (gu:508-509, gu:1247-1256).
3. **Counted operator phrases need plural forms** (G9b).
4. **The operator's friend label "Sara Karim +1" (op:247) needs `isolateLtr` on "+1"**, as the guest
   lane does (gu:1260-1261). Otherwise it renders "1+" in RTL.
5. **Guest third-person forms by category, and second person by the reader's gender, are
   consistent** (gu:1247-1256). "لاعب سابق" in an `open` match stays masculine; that is acceptable.

### 4.4 Multi-venue

1. **Tickets are chain-wide, forfeits are per branch, and the ban is chain-wide.** Each is modelled
   and each is said in copy:
   - tickets chain-wide: mo:19, op:377;
   - forfeits per branch: `forfeited_venue_id`, mo:701;
   - ban chain-wide: op:379, gu:822.
   The chain-wide ban is DB open question 4. It needs Parsa's yes, because a manager at one branch
   bans at all.
2. **Chain-wide settings are labelled "All branches"** (op:394-402).
3. **Money adds seven `reports_figures` keys (mo:693-707), but no operator screen shows them.** The
   operator reads only `report_courts.matches` and `report_matches` (op:62-63). Three of the keys
   are chain-wide (`ticketSales`, `ticketRefunds`, `ticketLiability`). A branch-scoped page must
   label them "All branches". Name the owner.
4. **A failed chain-wide refund appears in `deposit_attention` at every branch** (mo:180). Label it
   "any branch can settle this" so two managers don't both chase it.
5. **`day_close_online.tickets_chain` is labelled chain-wide** (mo:687, op:541).

### 4.5 Legal, store and privacy

1. **The consumer-law check exists only in CONTINUE** (CONTINUE.md:121). Two items are
   penalty-shaped and should go to the client's lawyer before the 1.0 terms freeze (gu:1300):
   - forfeiture on a no-show or an unrefilled late leave;
   - refunds only on request at the desk.
2. **"Reports are kept for 12 months" (gu:1297), but DB keeps them for ever** (db:1504-1505). Add a
   retention purge, with its own SEC-20 route, or change the text (Q5).
3. **Gender and other players' labels reach the owner's AI assistant.**
   - The route is the `customer_record` and `booking_bill` lookup tools
     (`packages/core/src/assistant/tools.ts:531,705`). Lookup tools accept `columns: '*'` (the
     `clean.ts` header).
   - Either drop `gender` (and the seat labels) in `clean.ts`, or add it to the privacy text's
     processor list.
   - Add `match_id`, `seat_id` and `ticket_id` to those tools' `id_keys`, so raw UUIDs are
     handled (Q6).
4. **The web delete-account page (the Play deletion URL) is not in the guest lane's legal table.**
   `legal.en.ts:324-330` "what is deleted and what is kept" must name:
   - name parts, gender and blocks (deleted);
   - open-match history and reports (kept without a name);
   - unused tickets (refunded to the card).
   gu:1227-1228 changes only the in-app text.
5. **The App Store 3.1.3(e) claim for reusable, non-expiring tickets** (gu:1288) is a review risk.
   A reviewer may read them as stored credit. The review note should say:
   - tickets are redeemable only for a seat in a match at the venue;
   - they are refundable at the desk;
   - they are never spent on digital content.
   UNVERIFIED.
6. **UGC Yes (gu:1284), the privacy text for names, initial, counts and gender (gu:1294-1296), and
   the ticket terms (gu:1300) are present and consistent with §0.**

## 5. Disagreements, and the pick

| # | Topic | Drafts say | Pick |
| --- | --- | --- | --- |
| D1 | 0253 details | DB §2.4: prefixes incl. `abdel/abdal/abou` + three-token "Abd al"; trigger on `full_name, given_name, family_name, deleted_at`; GUC `app.skip_name_sync`; CHECKs `profiles_name_parts`, `profiles_gender_stamp`; select grant incl. `gender_set_by` (db:376-437). Guest: `Abo`, two tokens; trigger also on `gender` with a `gender_set_at` rule; GUC `app.profile_names_backfill`; only `profiles_gender_set_by_values` (gu:166-225) | **DB's rules; Guest writes the file.** Drop Guest's gender rule: only definer RPCs write gender, and they stamp all three columns. |
| D2 | DF-20 refund function | DB: `ticket_refund_purchase(payment_id, reason)` (db:1637-1642, 1615-1617). Money: `tickets_cash_out(payment, reason, staff)` + `ticket_refund_deleted(guest)` (mo:386-424) | **Money's names** (R8 names them). |
| D3 | Who calls the DF-20 refund | DB: sweep only; `delete_my_account` takes no lock (db:1507-1514). Money: `delete_my_account` also calls it, and claims it holds court → reservations → mutex (mo:419-421, :761) | **Both call it.** `delete_my_account` calls `ticket_refund_deleted(v_uid)` at the end (it locks only `match_tickets` then purchase rows, which fits §1.4). **Correct mo:761:** no court or mutex lock. |
| D4 | `match_tickets` / `match_ticket_events` DDL | Both lanes write `create table` (db:285-330, mo:108-141). DB: forfeited ⇔ incl. `forfeited_seat_id`, `code` column, `sandbox default false`. Money: cashed_out ⇔ incl. `cashout_payment_id`, `sandbox` with no default, extra indexes | **One DDL, written by DB.** Take the union of the constraints, Money's `sandbox not null` with no default, and both index sets. |
| D5 | `guest_tickets` owner and shape | DB body (db:1451-1460, `refundable`). Money body (mo:339-343, `cashout{allowed,reason,tickets,amount_iqd}`). Operator reads `unused, cashable, refund_status, sandbox` (op:57) | **Money owns it (0256).** The operator reads `cashout.*`. |
| D6 | `p_attendance` undo | DB `unmarked` (db:1344, :1854). Operator `in` (op:100) | **`in`** (R9). |
| D7 | Seat-number index | DB covers `in, attended, no_show` (db:210) | **`in, attended`** (R4). DB must also: let `desk_add_seat` replace a `no_show` after the start; refuse a `no_show` undo once its number is re-seated (`SEAT_MARK_LOCKED` detail `replaced`). |
| D8 | Write-off roles | Money manager/owner (mo:582-584); Operator manager/owner (op:446, :305-308) | **court_desk, manager, owner, plus a manager PIN grant** (R1). |
| D9 | Ban reason | DB codes `conduct, no_shows, reported, other` (db:1413); Operator free note ≤ 200 (op:105) | Q3. **Default: codes, plus an optional note in the audit.** |
| D10 | Call-off | DB auto-attends unmarked seats and allows it with only a `left_late` missing (db:1392-1401). Operator needs all marked and a `no_show` (op:327) | Q1. **Default: DB's server rule; the operator shows who will count as present.** |
| D11 | Guest window cap | DB 8 days (db:1125, :1171-1173). Guest asks for the Book strip and `listBookableDates`, today + 14 (gu:460, :530; `assemble.ts:110-113`) | **16 days.** |
| D12 | `match_invite` fields | DB has no `timezone`; `full` = awaiting, or booked with no open seat (db:1177-1181). Guest wants `timezone`; `full` = 4 occupying and no open `left_late` (gu:66-76) | **DB's `full` + a `timezone` field.** |
| D13 | `match_slots` | DB has no `mine` (db:1174-1175). Guest reads `mine` (gu:57) | **Add `mine`** (false for anon). |
| D14 | `open_matches` rows | DB: `match_id`, organiser and player **names** (db:1129-1136). Guest: `id`, no names, adds `share_iqd` (gu:78-88) | **No names** (less exposure; the UI never shows them). Key `match_id`. |
| D15 | `match_detail` fields | DB: `me.role` incl. `removed`, friend `holder{…}`, `refusal` may be `NEED_TICKETS` (db:1138-1155). Guest: `me.excluded`, `holder_seat_no`, per-seat `share_iqd`, `is_mine`, `refusal` never `NEED_TICKETS` (gu:90-111) | **The union.** `refusal` excludes `NEED_TICKETS`; `me.tickets_needed` carries the count. |
| D16 | `my_tickets` | Money: `pending`, `purchases[]`, `server_now` (mo:324-334). Guest: `sandbox`, `purchase_payment_id`, `match.status` (gu:122-128) | **The union.** |
| D17 | `match_quote` | DB returns no `duration_min` (db:870-875). Guest reads it (gu:134-135) | **Echo `duration_min`.** |
| D18 | `desk_open_matches` | DB: bare array, `organiser{customer_id,full_name,phone}`, `courts_free_firm` (db:1197-1206). Operator: envelope `{matches_enabled, fill_deadline_minutes, ticket_price_iqd, matches[]}`, `organiser_name`, `courts_free` (op:55) | **An envelope** (court_desk cannot call `match_settings`) **with DB's inner names.** |
| D19 | `desk_match_states` | DB: keyed object, `label`, no money (db:1208-1215). Operator: `organiser_name`, `organiser_customer_id`, `players_owing`, `owed_iqd` (op:54) | **DB + `organiser_customer_id`.** Money comes from `booking_bill_states.seats_owing` (mo:607). |
| D20 | `desk_match_detail` | DB `seats[].can{…,remove}`, `ticket{}`, `money` = one seat's row (db:1217-1236). Operator needs `match.can`, `match.marks_open`, `match.started`, `organiser_seat_id`, `seats[].can.remove_reasons[]`, `take_share`, `write_off`, `replace`, and `money.unassigned[]` (court_desk cannot read `payments`) (op:67-86) | **The operator's list is the contract**; DB builds it. |
| D21 | `day_close_online` | Money `deposits`, `tickets_here`, `tickets_chain`, `matches`, `sandbox_excluded` (mo:668-679). Operator `tickets`, `unused_tickets`, `refunds_waiting` (op:60) | **Money's**; the operator adapts. |
| D22 | Reports | Money `report_courts.matches{bookings,bookedIqd,…}` and `report_matches.totals` (mo:709-736). Operator reads snake_case counts from `report_courts` and ticket sales from `report_matches` (op:62-63) | **Money's shapes.** Counts come from `report_matches.totals`, ticket money from `reports_figures`. |
| D23 | `booking_bill.match` | Money `unassigned_iqd` (mo:600-601). Operator `unassigned_desk_iqd` (op:64) | **Money's.** |
| D24 | `match_reports_open.reported` | DB `reports_90d`, `no_shows` (db:1438). Operator `open_reports`, `match_no_shows` (op:59) | **DB's.** |
| D25 | HANDOFF scope-ledger row | DB one row (db:1746). Money a second row (mo:845-846). Operator one merged row, "the others add their names" (op:641-649) | **One row** (the operator's text + Money's RPCs + the guest RPCs). |
| D26 | `tickets_refunded` push | Money: direct `notification_outbox` insert (mo:399-403). Guest: everything through `match_notify` (gu:948-965) | **`match_notify`** (one validator, one route rule, R3). |
| D27 | Push fan-out owner | DB: "Guest adds it in 0258, or a new ordinal" (db:1892-1895). Guest: bodies in DB's 0257, "DB calls" reminders (gu:946-974) | **Guest owns it:** an AFTER INSERT trigger on `match_events` and on `match_ticket_events` (`forfeited`), in **0258**. DB calls `match_sync_reminders` from `match_try_book`, the trigger's move path and `match_end`. Record it in §1.1 and §1.5. |
| D28 | 0257 authorship | §1.1 gives 0257 to DB (bc:111). It also holds Money's `match_money` and `court_fee_written_off` (mo:437, :492) and Guest's `match_notify` and `match_sync_reminders` (gu:946) | **Keep them in one file; list three authors in §1.1.** |
| D29 | Error-code table | Operator table lacks `TICKET_IN_USE`, `CUSTOMER_NOT_FOUND` (op:475-502) | **Add both** (R11). |
| D30 | `PIN_GATED_RPCS` copies | Operator names one (op:733). Money names three (mo:844-845) | **Three** (G13). |
| D31 | FORBIDDEN lists | Guest adds 3 patterns (gu:267-269). DB adds 9 (db:1697-1699) | **DB's 9.** |
| D32 | Digits | Guest Latin (gu:1264). Operator Arabic (op:522-523) | **Latin** (the code, G9a). |
| D33 | `deposit_status` for a ticket | Money `deposit_mode: null` (mo:296). Guest "`deposit_mode` is `off`" (gu:151) | **`null`**; the parser treats it as off. |
| D34 | `match_start` key reuse | Guest says a refused start "rolled back its `claim_replay` row" (gu:416-417). DB uses the `matches.idempotency_key` unique column, not `claim_replay` (db:888-890) | **DB.** The guest behaviour is unchanged; fix the sentence. |
| D35 | Contract doc tracked | DB: "untracked today" (db:1737-1738) | **Stale.** It is tracked and `index:doc` (assistant-coverage.json:997). |
| D36 | `set_my_gender` | DB: `AUTH_REQUIRED` first, returns `{gender, duplicate}` (db:439-444). Guest: `ACCOUNT_REQUIRED` first, returns `{gender, gender_set_at}` (gu:227-233) | **DB's** order + `gender_set_at` in the result. |

## 6. Top 15 fixes, ranked

1. **Unbreak `check:locks` (G1).**
   - `match_lock` takes the booking row FOR UPDATE before `expire_stale_holds`.
   - Money's 0255 re-issue of `deposit_settle_success` puts the expired-hold branch first, or
     `deposit_apply` stays off the walk list with the reason written.
   - Keep the once-per-sequence mutex rule and add the two R8 functions.
2. **Apply R4 in DB (D7).**
   - The seat-number index covers `in` and `attended`.
   - `desk_add_seat` replaces a `no_show` after the start.
   - A no-show undo is refused once its number is re-seated.
   Without this, OM-47's walk-in cannot be built.
3. **Apply R1, R9 and R11 in the drafts (D6, D8, D29).**
   - The write-off opens to the desk with a manager PIN.
   - `in`, not `unmarked`.
   - `TICKET_IN_USE` and `CUSTOMER_NOT_FOUND` join the operator's `MAPPED_CODES`.
4. **Give the guest push fan-out an owner and a file (D27, D26).**
   - A trigger on `match_events` and on `match_ticket_events` (`forfeited`) in 0258.
   - The callers of `match_sync_reminders`.
   - `tickets_refunded` goes through `match_notify`.
5. **Fix the window cap to 16 days (D11).** Otherwise the Book-tab chips and the list fail on day one.
6. **Move every gate into the commit of its migration (G3a).** Dissolve CONTINUE step 2g; the
   340/342 floor, the error-code gate and the coverage gate all fail an intermediate commit.
7. **SEC-20 (G5).**
   - Do not declare `payment_match_seats`.
   - Add the six `LINK_COLUMNS` in one edit.
   - Declare the walk-in name and phone honestly.
   - Declare and scrub `friend_genders`.
   - Extend the deletion proof to gender, seats, requests and blocks.
8. **Assistant coverage (G8).**
   - Entries for Money's 6 internals and Guest's 2.
   - `docs` entries for both review files now, and their removal with the drafts.
   - Regenerate the map with every contract edit, or mark the contract `excluded:`.
9. **Settle the read contracts in one table before building (D12–D24).**
   - Especially `desk_open_matches` (envelope), `desk_match_detail` (the operator's `can` and
     `money.unassigned[]`), `open_matches` (no names) and `match_detail` (the union).
   - One owner per function: D4 (the tickets DDL goes to DB), D5 (`guest_tickets` goes to Money).
10. **Guest dead ends (§4.1 items 1–4).**
    - A restricted link viewer.
    - A linked desk seat with no state.
    - Desk removal read as "You left".
    - The `no_court` copy.
11. **`check:error-codes` housekeeping (G7a).** Map `RATE_LIMITED` with `--update` in the same
    commit, and handle each code's details (§4.2 items 2–3; §4.1 item 5).
12. **Authz guard-first (G4).** `match_settings` and `match_reports_open` check `is_staff` before
    `current_venue()`.
13. **Put the migration waiver in the commit body (G2).** CI on a direct push judges nothing, so run
    `check-migrations` locally with the waiver before each migration push. Add `NOT VALID` to the
    `match_seats_ticket_fk`.
14. **Privacy and legal (§4.5).**
    - The web delete-account copy.
    - Reports retention (Q5).
    - Gender and names through the assistant (Q6).
    - The consumer-law check before the 1.0 terms.
    - An owner for DF-19's review-account seeding.
15. **Staff Arabic and digits (G9, §4.3).**
    - Latin digits in the operator test.
    - Verbal nouns in place of "ألغِ", and fix "تُخسر".
    - Plural forms for the counted operator phrases.
    - `isolateLtr` on "+1".
