# Open matches: money and tickets (lane Money)

Date: 2026-09-28. Status: **final contract for lane Money, ready for builders.** Merged from
`drafts/money-2026-09-28.md`, the two reviews (`drafts/review-concurrency-money-2026-09-28.md`, items
`C…`/`D…`; `drafts/review-decisions-rules-2026-09-28.md`, items `G…`, `§4…`, rules-`D…`) and the
rulings of `build-contracts-2026-09-27.md` §1.12. §0, §1 and §1.12 of that file are binding and are
not repeated here. Where this file adds to §1 or changes it, §14 says so exactly. It supersedes the
Money draft.

Before this file is committed, `packages/db/fixtures/assistant-coverage.json` needs a `docs` entry for
it (`check:assistant-coverage` walks the filesystem). Recommended value: `"excluded: engineering
contract for the open-matches money build; not venue knowledge the owner asks about"`.

Conventions:
- **Ordinals are the renumbered ones.** 0249–0251 were taken on main by 43625f39, so every §1.1
  ordinal moved up by three. Money's files are **0254** (CHECK widenings), **0258** (its part of the
  tables file), **0259** (ticket purchase and cash-out), **0262** (its part of desk money) and
  **0265** (reports). The other lanes' files are 0253, 0255, 0256, 0257, 0260, 0261, 0263 and 0264.
  A ruling that names an old ordinal means the new one (R26 "0258" is 0261).
- `NNNN:line` is a line in an existing migration (`packages/db/supabase/migrations/2026…NNNN_*.sql`,
  all ≤ 0251), checked on 2026-09-28 at 43625f39. `fn/` is `packages/db/supabase/functions/`, `op/` is
  `apps/operator/src/`.
- Every file opens with `set lock_timeout = '3s'; set statement_timeout = '60s';`, re-issues from
  the latest body, uses `$<name>_0NNN$` tags with the real ordinal, and every CHECK added to an
  existing table is `NOT VALID` plus a validate guarded on `conname` and `conrelid` (the 0241:191-199
  form).

## 1. Where every dinar lives

| Money | Record | Counts as | Never counts in |
| --- | --- | --- | --- |
| A ticket purchase (Qi) | `booking_payments` row, `purpose='ticket'`, `venue_id` NULL (R7), `ticket_count` 1..3 | a chain liability while its tickets are `available`, `reserved` or `in_use` | `court_fee_paid`, `deposit_net_paid`, `my_reservations`, `booking_bill`, cash, card, any branch revenue |
| A forfeited ticket | `match_tickets.status='forfeited'`, `forfeited_venue_id`, `forfeited_at` | revenue of the branch where the no-show happened, dated `forfeited_at` | court money |
| A cashed-out ticket | `match_tickets.status='cashed_out'` plus the purchase row's single Qi refund | money returned | revenue |
| A share paid at the desk | a settled booking tab (court line capped by `tabs.court_cap_iqd`), its `payments` row, its `payment_match_seats` links | court money of the match booking (`court_fee_paid`, cash, card) | ticket figures |
| A share nobody pays (no-show, unrefilled late leave, vacant seat after start, manager write-off) | derived, never stored as money: `app.court_fee_written_off` | written off | cash, card, money collected |
| A deposit (existing, 0241/0242) | `booking_payments`, `purpose='deposit'` | unchanged | ticket figures |

A ticket is a bond, not a prepayment of a share. A player who shows gets the ticket back and pays the
full `share_iqd` at the desk (OM-45). A no-show loses the ticket and the share is written off.

## 2. Decisions this lane takes (technical; each is final unless Parsa reverses it)

| # | Decision | Why |
| --- | --- | --- |
| MD-1 | A ticket purchase is a chain row: `booking_payments.venue_id` NULL (R7). | Tickets are chain-wide; any branch stamp would leak ticket money into that branch. |
| MD-2 | A valid SUCCESS always creates `ticket_count` tickets, however late (also after `failed`/`expired`). The only refunds on a SUCCESS are `amount_mismatch` (not our payment, whole row) and `account_deleted`. A second purchase that succeeds is a second purchase, never `duplicate_success`. | A ticket holds no slot, so nothing can be lost. |
| MD-3 | Cash-out moves the tickets to `cashed_out` when the refund is **requested**, not when Qi confirms. | The tickets stop working the moment money is promised back; the refund machine (0242) guarantees the money reaches the card or a manager settles it by hand. |
| MD-4 | Cash-out is per purchase, takes **all** its `available` tickets in one Qi refund, and waits while any ticket of that purchase is `reserved`, `in_use`, or `forfeited` but still restorable (R13, §5.8). | A purchase row carries one refund (0241:56-57, 0242:179). |
| MD-5 | A guest with a `match_ban` cannot buy tickets (`MATCH_BANNED`). | A ticket only buys a match seat. |
| MD-6 | Wallet limit: `available` + the new count ≤ 3 × `platform_settings.max_filling_matches_per_guest` (default 9). A constant rule, not a setting; `my_tickets.max_available` carries the number. | OM-20 × OM-37 is the most one guest can ever lock at once. |
| MD-7 | One live ticket attempt per guest; three `failed`/`expired` attempts in 24 hours → `TOO_MANY_ATTEMPTS`; payment window 900 s. Constants. | The deposit rules (0242:393-397, 0241:140) with no hold to count against. |
| MD-8 | Seat money is one fresh booking tab per desk action, settled in the same call. An **empty** live tab on the booking is adopted instead; any other live tab refuses `BOOKING_TAB_OPEN` and is closed through `match_link_payment`. | A partly paid tab blocks day close (0216:158-162) and an empty one cannot be cancelled while court is owed (0244:631-635). |
| MD-9 | The credit pool. Court money on the booking that no carrying seat holds (unlinked payments, links on seats that no longer carry) and a price fall are applied automatically: first to a price rise, then to collectable seats from the highest `seat_no` down, then to automatic write-offs from the highest `seat_no` down. Open shares are never credited. The desk makes it exact with `match_link_payment`. | Σ seat figures always equal what the booking is owed, so the last payer is never refused and the day closes. |
| MD-10 | DF-16 is enforced on the server (R20, §6.8). | Supersedes the draft's UI-only wall. |
| MD-11 | A manager write-off (R1) forgives a share; it is undone only by collecting it: `match_seat_settle` may take a share from a seat with a manual write-off, clears the write-off in the same transaction and audits it. No separate undo RPC, no PIN to receive money. | A player who walked out and comes back can pay; nothing else can reopen the share. |
| MD-12 | `payment_match_seats` is append-only. A wrong link changes who is shown as paid, never what the booking is owed; the desk collects the rest from whoever owes it. No unlink in v1. | The money trail stays intact. |
| MD-13 | Refunds are not netted from links, exactly as `court_fee_paid` does not net them (0106:120-124). A refund on a seat payment shows as `court_refund_due_iqd` on the bill. | One rule for all court money. |
| MD-14 | One money lock per match, `app.lock_match_money` (R19), taken first by every writer that can change what a seat owes and that runs outside the reservations path (§6.1). The others are caught by the court-line check. | Closes C6 (over-linking) and C18 (paid seat turned no-show). |
| MD-15 | A profile's `payment_sandbox` cannot flip while it holds live tickets or a live ticket attempt (§5.13). | C20: a flip would strand the tickets. |
| MD-16 | One helper computes every ticket figure (`app.ticket_money_figures`, §7.1) for `reports_figures`, `report_matches` and `day_close_online`. | The three screens cannot disagree. |

## 3. 0254 `booking_payments_ticket_checks` (CHECK widening only)

Both constraints are inline column CHECKs in 0241, so Postgres named them
`booking_payments_purpose_check` (0241:33) and `booking_payments_refund_reason_check` (0241:53-55).
Do not confuse the second with the table constraint `booking_payments_refund_reason` (0241:70-72).

```sql
alter table booking_payments drop constraint if exists booking_payments_purpose_check;
alter table booking_payments add constraint booking_payments_purpose_check
  check (purpose in ('deposit', 'ticket')) not valid;
alter table booking_payments drop constraint if exists booking_payments_refund_reason_check;
alter table booking_payments add constraint booking_payments_refund_reason_check
  check (refund_reason is null or refund_reason in
    ('guest_cancel', 'staff_cancel', 'no_show', 'slot_lost', 'venue_offline', 'amount_mismatch',
     'duplicate_success', 'manual', 'staff_refund', 'ticket_cashout', 'account_deleted')) not valid;
-- then one guarded VALIDATE per constraint (conname AND conrelid = 'public.booking_payments'::regclass)
```

Safe on its own: no function writes `purpose='ticket'` until 0259, and 0258 scopes every deposit hook
first.

**Gates with 0254:** `check:migrations` (NOT VALID + guarded VALIDATE); `pnpm db:types` (no diff
expected); `deposits.test.ts` green unmodified. It ships in push B with 0253 and 0255 (§12).

## 4. 0258 `match_tables`: Money's part

All of it lands in the same file as DB's tables, before any ticket row can exist. The file is never
split (rollout push D).

### 4.1 `booking_payments`

```sql
alter table booking_payments alter column hold_id drop not null;          -- 0241:31
alter table booking_payments alter column reservation_id drop not null;   -- 0241:30
alter table booking_payments alter column venue_id drop not null;         -- 0241:29 (R7; the default stays)
alter table booking_payments add column if not exists ticket_count smallint;

-- each NOT VALID, then a guarded VALIDATE:
constraint booking_payments_anchor check (
  (purpose = 'deposit' and venue_id is not null and hold_id is not null
                       and reservation_id is not null and ticket_count is null)
  or (purpose = 'ticket' and venue_id is null and hold_id is null
                         and reservation_id is null and ticket_count between 1 and 3));
constraint booking_payments_ticket_amount check (
  purpose <> 'ticket' or amount_iqd = ticket_count * quoted_price_iqd);     -- quoted_price_iqd = unit price
constraint booking_payments_reason_by_purpose check (
  refund_reason is null
  or (purpose = 'ticket'  and refund_reason in ('ticket_cashout', 'account_deleted', 'amount_mismatch'))
  or (purpose = 'deposit' and refund_reason not in ('ticket_cashout', 'account_deleted')));

create unique index if not exists booking_payments_one_active_ticket
  on booking_payments (guest_id) where purpose = 'ticket' and status in ('created', 'pending');
```

- `booking_payments_one_active` (0241:84-85) is on `hold_id`; a ticket row has it NULL and never
  collides.
- `zz_branch_guard` (0241:99-101) needs no change: its link loop skips a NULL id (0230:131) and its
  staff check skips a NULL venue (0230:152).
- The `venue_id` default (`app.current_venue()`) stays for deposits. A ticket insert **names**
  `venue_id` as NULL; leaving the column out would stamp a branch (or raise `VENUE_REQUIRED`).
- For a ticket row `quoted_price_iqd` is the unit price stamped at prepare (DF-21).
- `guest_id` stays nullable (`on delete set null`, 0241:32): a profile is tombstoned, never deleted,
  but an admin hard delete must not fail on this row. §5.4 handles a NULL payer.

### 4.2 `payment_match_seats` (Money's DDL)

```sql
create table if not exists payment_match_seats (
  payment_id    uuid not null references payments(id),
  match_seat_id uuid not null references match_seats(id),
  venue_id      uuid not null references venues(id),     -- no default: the writer names the match's branch
  amount_iqd    iqd  not null check (amount_iqd > 0),
  linked_by     uuid not null references staff(id),
  created_at    timestamptz not null default now(),
  primary key (payment_id, match_seat_id));
create index if not exists payment_match_seats_seat on payment_match_seats (match_seat_id);
-- zz_branch_guard: app.trg_branch_guard('scoped', 'payments','payment_id', 'match_seats','match_seat_id')
-- append-only: before update or delete (statement) execute function app.forbid_mutation() (as payments_ao, 0015:164-166)
-- RLS on, no policy; revoke all from anon, authenticated; grant all to service_role (0241:93-97)
```

Comment: *"0258. Which seats of an open match a desk payment paid, and how much of it. Written only by
match_seat_settle and match_link_payment. Append-only: a wrong link is never edited."*

### 4.3 What Money needs in DB's ticket DDL (rules-D4, conc-D3: DB writes it)

DB's `match_tickets` and `match_ticket_events` DDL (`db.md` §4.4.4–4.4.5, which carries all of the
following; the names are DB's) plus:
- `match_tickets.sandbox boolean not null` with **no default** (it always copies the purchase row);
- `match_tickets_cashed_out`: `(status = 'cashed_out') = (cashed_out_at is not null and
  cashout_payment_id is not null)`;
- `match_tickets_cashout_same`: `cashout_payment_id is null or cashout_payment_id =
  purchase_payment_id` (R8: nobody reads it as another payment);
- indexes `(purchase_payment_id)`, `(forfeited_venue_id, forfeited_at) where status = 'forfeited'`,
  and on `match_ticket_events` `(type, at)` besides DB's `(ticket_id, at)`, `(guest_id, at)`;
- only Money inserts `match_tickets` rows (status `available`, event `bought`) and only Money writes
  `cashed_out`, `cashed_out_at`, `cashout_payment_id`.

### 4.4 `tabs.court_cap_iqd`

```sql
alter table tabs add column if not exists court_cap_iqd iqd;
-- tabs_court_cap_positive: check (court_cap_iqd is null or court_cap_iqd > 0), NOT VALID + guarded VALIDATE
```

When set, a tab's court line is `least(court_cap_iqd, court_fee_remaining(...))` (§6.3). Written only
as R2 says: by `match_seat_settle` on the tab it settles (fresh, or an adopted empty live tab) and by
`match_link_payment` when it closes a live court-only tab at what was paid on it.

### 4.5 The 0242 hooks, scoped to `purpose='deposit'`

Each re-issued from its latest body (all 0242). "Explicit" means the function is already safe for a
ticket row (it keys on `reservation_id` or `hold_id`, which are NULL there) and gains the predicate so
it stays safe if the code around it changes.

| Function | Latest | Exact change | Kind |
| --- | --- | --- | --- |
| `trg_reservation_deposit` | 0242:933 | the loop (0242:945-949) gains `and purpose = 'deposit'` | explicit |
| `deposit_settle_success` | 0242:498 | (a) the `duplicate_success` subquery (0242:513-517) gains `and o.purpose = 'deposit'`; (b) **R15 hoist**, below | (a) explicit; (b) needed |
| `deposits_due_for_reconcile` | 0242:756 | the first loop (0242:766-778) gains `and bp.purpose = 'deposit'`; every output row (0242:800-814) gains `purpose` and `ticket_count` | loop explicit; output needed by `deposit-reconcile` |
| `deposit_attention` | 0242:1116 | `join reservations` (0242:1151) becomes `left join`; the venue filter (0242:1154) becomes `(bp.venue_id = v_venue or (bp.purpose = 'ticket' and not bp.sandbox))`; the "succeeded, booking not live" branch (0242:1157-1158) starts `bp.purpose = 'deposit' and`; items gain `purpose`, `ticket_count`, `customer_id` (= `bp.guest_id`). The name and phone (0242:1135-1136) need no change: `coalesce(r.…, p.…)` already gives the payer when `r` is NULL | needed |
| `deposit_refund_request` | 0242:1271 | right after `PAYMENT_NOT_FOUND` (0242:1281-1283): a ticket row raises `PAYMENT_STATE` detail `ticket` (cash-out is the only refund of a purchase) | clearer refusal (today it is `VENUE_MISMATCH` by accident) |
| `deposit_refund_manual` | 0242:1208 | **R23**, for both purposes: the accepted status (0242:1241) is `refund_failed` only, and the `succeeded → 'manual'` reason (0242:1248) goes. Ticket rows skip the branch check (0242:1230: any manager or owner, chain money), the court and reservation locks (0242:1238-1239) and `set_config` (0242:1244). The tickets are already `cashed_out`; nothing else moves | needed |
| `deposit_refund_retry` | 0242:1168 | ticket rows skip the branch check (0242:1181), the locks (0242:1185-1186) and `set_config` (0242:1191) | needed (addition to §1.8) |
| `my_reservations` | 0242:1702 | the lateral (0242:1725-1731) gains `and bp.purpose = 'deposit'`; same result type, so `create or replace` | explicit |
| `deposit_net_paid` | 0242:97 | the `where` gains `and bp.purpose = 'deposit'` | explicit |

**R15 in `deposit_settle_success`.** Today the in-place `update reservations` (0242:541) comes before
the `expire_stale_holds` call (0242:560) in the text. The lock walker expands the new match trigger
under every reservations write, so from 0263 on it would read `match_tickets` before `reservations`
and fail Rule 1 on `deposit_apply`. The expiry moves above every reservations write, under the same
condition the old call had, so nothing changes at run time:

```sql
select * into v from booking_payments where id = p_payment_id;
select * into r from reservations where id = v.reservation_id;
-- 0258 (R15): the swept-hold branch's expiry, hoisted above every reservations write.
if r.kind = 'hold' and r.status = 'expired' and r.end_at > now() then
  perform app.expire_stale_holds(r.court_id, tstzrange(r.start_at, r.end_at, '[)'));
end if;
-- … the 0242 body as before, with the call at 0242:560 deleted …
```

It now runs before `assert_not_degraded_for` and outside the sub-block, so a later `slot_lost` or
`venue_offline` no longer rolls it back. It only expires holds that are already stale, which any
sweep would expire anyway.

**R23 changes deposit behaviour.** "Settled another way" on a deposit in `refund_pending` (a Qi refund
may already be on its way: double pay) and on a `succeeded` deposit is refused `PAYMENT_STATE`. A
manager refunds a succeeded deposit with `deposit_refund_request`; a stuck `refund_pending` turns
`refund_failed` after ten unanswered attempts (0242:914-915) and can then be settled by hand. In the
same commit: `deposits.test.ts` (the case at :486-535) applies a second `failed` before the manual
settle, gains a case "manual on `refund_pending` → `PAYMENT_STATE`", and
`docs/design/payments/build-contracts-2026-09-27.md` §2.3 line "`refund_pending | refund_failed |
succeeded → refunded`" is corrected.

Unchanged, because they look rows up by `hold_id` or by id and `lock_court(NULL)` is a no-op
(0042:53): `deposit_quote`, `deposit_prepare`, `deposit_mark_created`, `deposit_log_event`,
`deposit_note_cancel_attempt`, `deposit_begin_refund`, `deposit_nudge`, `confirm_booking`,
`release_hold`, `expire_stale_holds`, `court_fee_paid` (through `deposit_net_paid`). `booking_bill`'s
online list gains its `purpose = 'deposit'` predicate in its own 0262 re-issue.

### 4.6 Gates that travel with 0258 (Money's part)

- `check:migrations`: the four new constraints NOT VALID + guarded VALIDATE. The partial index on
  `booking_payments` and the `payment_match_seats` index share the file's waiver, **in the commit
  body** (R34): `MIGRATION-RISK-ACCEPTED: plain indexes on new, empty tables; one partial index on
  booking_payments (deposit rows only, tens at most; the predicate matches none)`. Run
  `check-migrations` locally with `MIGRATION_RISK_ACCEPTED` set before the push.
- SEC-20 (`tests/stored-fields.test.ts:158-169`): `booking_payments.ticket_count: n` (C19); the `why`
  of `amount_iqd`, `quoted_price_iqd`, `refund_amount_iqd` widened to "a deposit or open-match tickets
  paid online". `payment_match_seats` is **not** declared (R29, G5a: no guest link).
- `tests/rls-matrix.ts` drop 24 (shared with the other lanes; drop 23 is 0250/0251's): `payment_match_seats` select and insert `denied` for
  all eight principals.
- `fixtures/assistant-coverage.json`: `tables.payment_match_seats` → `excluded: service_role only; the
  desk reads seat payments through booking_bill and desk_match_detail`. The re-issued functions keep
  their entries.
- `deposits.test.ts`: the R23 edit above, plus "the reservations trigger, the reconciler's first loop,
  `deposit_net_paid`, `my_reservations` and `deposit_attention`'s not-live branch ignore a ticket row"
  (a ticket row inserted as the service role).
- `src/types.gen.ts` regenerated; no client catalog change.

## 5. 0259 `ticket_purchase`

### 5.1 The purchase end to end

```text
app "Buy 2 tickets" → POST ticket-begin {count:2, locale} → app.ticket_payment_prepare
  → gateway create (createAtGateway) → app.deposit_mark_created → 200 {request_id, form_url, …}
  → the app opens form_url and polls deposit-status (/pay/status?ref=…)
Qi → deposit-webhook | deposit-status poll | deposit-reconcile → app.deposit_apply (ticket branch)
  → app.ticket_settle_success → 2 × match_tickets 'available' (+ 'bought' events)
```

### 5.2 `app.ticket_payment_prepare(p_guest_id uuid, p_count int, p_locale text, p_provider text) → jsonb`

Service role only (edge `ticket-begin`, on behalf of the JWT user). Refusals, in this order:

1. `INVALID_ARGUMENT`: `p_guest_id` NULL; `p_provider` not `qi`/`fake` (detail `p_provider`).
2. `ACCOUNT_REQUIRED`: no profile, or `deleted_at` set.
3. The guest's live attempt (`purpose='ticket'`, `created|pending`, locked `for update`) → return it
   with `reused: true`, whatever `p_count` says (a double tap; the app shows that attempt's count).
4. `TICKET_COUNT_INVALID` detail `p_count`: NULL or not 1..3.
5. `MATCHES_OFF`: no branch in `app.open_venue_ids()` has `venue_settings.matches_enabled` (R10:
   off everywhere stops new purchases).
6. `PHONE_REQUIRED`: blank `profiles.phone` (0242:385-389).
7. `TERMS_REQUIRED`: the `match_guest` terms test, evaluated inline for `p_guest_id` (`match_guest`
   reads `auth.uid()`, NULL under the service role). A test pins both copies to the same answers.
8. `MATCH_BANNED`: a `customer_flags` row `type='match_ban'` (MD-5).
9. `TICKET_COUNT_INVALID` detail `wallet_limit`: `available` tickets + `p_count` > 3 ×
   `max_filling_matches_per_guest` (MD-6).
10. `TOO_MANY_ATTEMPTS`: ≥ 3 of the guest's ticket rows `failed|expired` created in the last 24 h.

Then: `v_unit := platform_settings.match_ticket_price_iqd`; insert `(venue_id NULL, reservation_id
NULL, hold_id NULL, guest_id, purpose 'ticket', ticket_count p_count, provider, sandbox =
profiles.payment_sandbox, request_id gen_random_uuid(), amount_iqd v_unit × p_count, quoted_price_iqd
v_unit, locale ('en' or 'ar'), status 'created', deadline_at now() + 900 s)`. A `unique_violation` on
`booking_payments_one_active_ticket` (two taps at once) re-reads and returns the live row as
`reused`. Event `begin`; audit `ticket.purchase_begin` `{payment_id, ticket_count, amount_iqd,
sandbox}`. No `assert_not_degraded_for`: a ticket holds no slot.

Returns `{id, request_id, purpose:'ticket', status, provider, sandbox, amount_iqd, ticket_count,
unit_price_iqd, deadline_at, form_url, provider_payment_id, locale, reused, guest_phone, guest_name}`.

### 5.3 Edge `ticket-begin` (`fn/ticket-begin/index.ts`, `verify_jwt = true`)

`POST {count, locale}` → 200 `{request_id, form_url, amount_iqd, ticket_count, unit_price_iqd,
deadline_at, status:'pending', reused}`. `count` must be an integer (else 400 `BAD_REQUEST`; the range
is SQL's). `locale` is `en`, anything else `ar` (as `deposit-begin/index.ts:59`).

| HTTP | Codes |
| --- | --- |
| 400 | `BAD_REQUEST`, `TICKET_COUNT_INVALID`, `PHONE_REQUIRED`, `INVALID_ARGUMENT` |
| 401 | `AUTH_REQUIRED` |
| 403 | `ACCOUNT_REQUIRED`, `TERMS_REQUIRED`, `MATCH_BANNED` |
| 409 | `MATCHES_OFF` |
| 429 | `TOO_MANY_ATTEMPTS` |
| 503 | `PROVIDER_UNAVAILABLE` (no provider configured, or the gateway failed), `RETRY_LATER` (a retryable pg error, or a stale attempt, below) |

A refusal body is `{error: <CODE>, detail?: <text>}`: `detail` is the SQL refusal's detail when it
has one (the phone reads `TICKET_COUNT_INVALID` detail `wallet_limit` through
`DepositEdgeError.detail`, `guest.md` §4.10.2, §4.30 item 8).

Flow:
1. No provider configured → 503 `PROVIDER_UNAVAILABLE` before prepare, so an unconfigured project
   never burns a guest's attempts (copied from `deposit-begin/index.ts:65-71`).
2. `ticket_payment_prepare`. A reused attempt whose `deadline_at` has passed: run `checkNow(…,
   'poll')` on it once, then prepare again. Still the same stale attempt → 503 `RETRY_LATER` (the
   reconciler closes it within a minute).
3. A reused `pending` attempt with a `form_url` → 200 with it. Otherwise `createAtGateway` (below)
   with `additionalInfo {purpose:'ticket', ticket_count:'<n>', request_id}` and `customer {phone,
   accountId: uid}`.

Shared code, reused rather than copied:
- `fn/_shared/deposits.ts:22-39`: `PaymentRow.hold_id` and `reservation_id` become `string | null`;
  `purpose: 'deposit' | 'ticket'` and `ticket_count: number | null` join the type and `ROW_COLUMNS`.
- The gateway half of `deposit-begin` (`deposit-begin/index.ts:108-161`: create, recover on
  `already_used`, `deposit_mark_created`, apply a recovered outcome) moves into `createAtGateway(service,
  env, row, uid, additionalInfo)` in `_shared/deposits.ts`. `deposit-begin` calls it with
  `{reservation_id, request_id}` (today's `:120`; behaviour identical).
- `deposit-reconcile`: `DueRow` (`:32-46`) gains `purpose`; the refund message (`:127`) reads `Touch
  Padel ticket refund (${reason})` for a ticket row.
- `deposit-webhook`, `deposit-status` and `payments-fake` route by `request_id` and need only the type
  change. `tp_deposit_sweep` (0242:1811-1823) is unchanged: `deposit_nudge` already wakes on any
  `created`, `pending` or `refund_pending` row (0242:135-139).
- The gateway routes by the row's own `sandbox` and `provider` (`providerFor`), so a sandbox purchase
  and its refund stay on Qi's sandbox.

### 5.4 `deposit_apply` ticket branch (re-issued from 0242:605) and `app.ticket_settle_success`

`deposit_apply`, after the row is matched (0242:630-637):
- **Locks.** Written as `if v.purpose = 'deposit' then <0242:639-644 verbatim> else select … from
  booking_payments where id = v.id for update; end if;`. A ticket row takes no court or reservation
  lock and sets no `app.venue_id`. The deposit branch comes **first in the text** (§8).
- **SUCCESS**, status `created|pending|failed|expired`: the amount and currency test (0242:682-690)
  is shared; a mismatch is `amount_mismatch` on the whole row, no tickets. Otherwise `if v.purpose =
  'deposit' then v_new := app.deposit_settle_success(v.id); else v_new :=
  app.ticket_settle_success(v.id); end if;` (deposit call first in the text).
- **FAILED / EXPIRED**: unchanged status writes; the hold release (0242:712-717) runs only for
  `purpose='deposit'`.
- The returned JSON gains `purpose` and `ticket_count`.

`app.ticket_settle_success(p_payment_id uuid) returns text` (internal, service path; the caller holds
the purchase row lock). It never raises on a valid row: a raise would roll back `deposit_apply`, the
webhook would answer 500 and the reconciler would loop.
1. Tickets already exist for this purchase → return the row's status (replay).
2. `status='succeeded'`, `succeeded_at = coalesce(succeeded_at, now())`, `failure_code = null`.
3. `guest_id` NULL (a hard-deleted profile) → `deposit_begin_refund(id, 'account_deleted')`,
   `deposit_nudge()`, return `refund_pending`. No tickets.
4. Insert `ticket_count` tickets: `guest_id`, `status 'available'`, `price_iqd = quoted_price_iqd`,
   `sandbox = bp.sandbox`, `purchase_payment_id = bp.id`; one `bought` event each with `payment_id`.
5. The profile has `deleted_at` → `app.tickets_cash_out(bp.id, 'account_deleted', null)` (§5.9),
   return `refund_pending`.
6. Audit `ticket.purchase` `{payment_id, ticket_count, amount_iqd, sandbox}`; return `succeeded`.

No push on a purchase: the payment screen is open.

### 5.5 `deposit_status` (re-issued from 0242:266), purpose-aware

Deposit rows: unchanged, plus `"purpose": "deposit"`, `"ticket_count": null`. The staff read
(0242:282-283) stays deposit-only by construction (`is_staff_at(NULL, …)` is false): staff get
`PAYMENT_NOT_FOUND` on a ticket row and read tickets through `guest_tickets`. Ticket rows, the owner
guest only:

```json
{ "request_id": "uuid", "purpose": "ticket",
  "status": "created|pending|succeeded|failed|expired|refund_pending|refunded|refund_failed",
  "failure_code": null, "amount_iqd": 20000, "ticket_count": 2, "unit_price_iqd": 10000,
  "price_iqd": 20000, "rest_iqd": 0, "deadline_at": "…", "form_url": "…" | null,
  "refund_reason": null | "amount_mismatch|account_deleted|ticket_cashout",
  "refund_amount_iqd": null, "refunded_at": null, "sandbox": false,
  "deposit_mode": null, "attempts_left": 2, "hold_live": false, "reservation": null,
  "tickets": { "from_this_purchase": 2, "available": 3, "reserved": 0, "in_use": 1 },
  "server_now": "…" }
```

`deposit_mode` is `null` for a ticket (conc-D15, rules-D33; the phone treats it as off).
`attempts_left` = `greatest(3 − the guest's ticket rows failed|expired in the last 24 h, 0)`.

### 5.6 `deposit_refund_apply` (re-issued from 0242:848)

Ticket rows skip the court and reservation locks (0242:869-870) and `set_config` (0242:872). On
`succeeded`, instead of the `deposit_refunded` insert (0242:893-902), a ticket row with `sandbox =
false` calls `app.match_notify(null, array[v.guest_id], 'tickets_refunded', '{}', null, null,
'tickets_refunded:' || v.request_id)` (R3, conc-D26: Guest's one validator; route `tickets`, `id`
null) inside `begin … exception when others then raise warning … end`: a push never fails a money
write, and the call binds late, so a refund that runs before Guest's `match_notify` exists loses only
its push. Audit `ticket.refunded` in place of `deposit.refunded`. Deposit rows are verbatim. A refund
outcome never moves a ticket: they are already `cashed_out`.

### 5.7 Wallet reads: `app.ticket_wallet`, `my_tickets`, `guest_tickets`

One internal builder, `app.ticket_wallet(p_guest_id uuid, p_staff boolean) returns jsonb`, feeds both
reads, so the phone and the desk cannot disagree.

**`my_tickets()`** (guest, `authenticated`). First statements: `AUTH_REQUIRED`, then
`ACCOUNT_REQUIRED` (no profile or `deleted_at`). Shape (Money's plus Guest's three fields,
conc-D14 / rules-D16):

```json
{ "price_iqd": 10000, "max_available": 9, "sandbox": false,
  "available": 2, "reserved": 0, "in_use": 1,
  "tickets": [ { "id", "status", "price_iqd", "sandbox", "bought_at", "purchase_payment_id",
                 "match": null | { "match_id", "start_at", "venue_id", "status" },
                 "forfeited_at", "cashed_out_at" } ],
  "purchases": [ { "payment_id", "request_id", "status", "ticket_count", "unit_price_iqd", "amount_iqd",
                   "bought_at", "refund_reason", "refund_amount_iqd", "refunded_at", "sandbox" } ],
  "pending": null | { "request_id", "status", "ticket_count", "amount_iqd", "form_url", "deadline_at" },
  "server_now": "…" }
```

- `price_iqd` is today's ticket price; `max_available` is MD-6's number (the phone clamps the stepper
  and words the `wallet_limit` refusal with it); top-level `sandbox` is the caller's
  `payment_sandbox`.
- `match` is set for `reserved` (the request's match), `in_use` and `forfeited` tickets.
- `tickets`: every live ticket, then the last 50 ended ones; `purchases`: the last 20; `pending`: the
  live attempt, so the phone can offer "Payment in progress · Continue" (§4.1 #9). No names.

**`guest_tickets(p_customer_id uuid)`** (court_desk, manager, owner; any branch, chain data like
`customer_flags`; Money owns it, R31). `FORBIDDEN`, then `CUSTOMER_NOT_FOUND` for an unknown id (a
tombstoned customer is shown). The same shape plus `customer_id`, top-level `forfeited` and
`cashed_out` counts, `forfeited_venue_id` on ticket rows, `pending` without `form_url`, and per
purchase:

```json
"tickets": { "available": 1, "reserved": 0, "in_use": 1, "forfeited": 0, "cashed_out": 0 },
"cashout": { "allowed": false,
             "reason": null | "in_use" | "reserved" | "restorable" | "none_unused" | "not_succeeded" | "done",
             "tickets": 1, "amount_iqd": 10000, "until_at": "…" | null }
```

`cashout` comes from `app.ticket_cashout_block` (§5.8). The operator shows the button and the amount
from it and never computes them (conc-D9, rules-D5).

### 5.8 The ticket ledger and the rules DB's helpers keep

| From → to | Who | Event | Money |
| --- | --- | --- | --- |
| (new) → `available` | `ticket_settle_success` | `bought` | liability + price |
| `available` → `reserved` | `match_request` (DB) | `reserved` | none |
| `reserved` → `in_use` | `match_decide` approve (DB) | `locked` | none |
| `reserved` → `available` | decline, withdraw, request expiry, match end (DB) | `released` | none |
| `available` → `in_use` | start, join; undo of `attended` while `booked` (DB) | `locked` | none |
| `in_use` → `available` | leave or removal while filling, bump, expiry, cancel, OM-44, refill of a `left_late` seat, `attended`, call-off for a present player, a deleted holder's late leave at start (R18) | `released` | none |
| `in_use` → `forfeited` | `no_show`; unrefilled `left_late` at start (not a deleted holder); call-off for the no-show | `forfeited` | liability − price; forfeit revenue + price at `forfeited_venue_id` |
| `available` → `forfeited` | `attended` → `no_show` correction | `forfeited` | as above |
| `forfeited` → `available` or `in_use` | a correction or a venue cancel while the ticket is **restorable** | `restored` | the forfeit reverses |
| `available` → `cashed_out` | `tickets_cash_out` only (cash-out, DF-20, deleted payer at SUCCESS) | `cashed_out` | liability − price; one Qi refund per purchase |

Rules DB's `ticket_pick` / `ticket_lock` / `ticket_release` / `ticket_forfeit` / `ticket_restore`
keep (their signatures are `db.md` §4.5.4's; `ticket_release` takes the pairing,
`(p_ticket_ids uuid[], p_code text, p_seat_ids uuid[] default null, p_request_id uuid default
null)`; Money calls none of them):
- Pick the guest's `available` tickets with `sandbox = matches.sandbox` (DF-19), oldest first
  (`created_at, id`); lock `for update` in id order. Friend seats use the holder's tickets.
- `ticket_lock` moves `reserved → in_use` only for its own request; without a request it takes
  `available` only. Every helper asserts the ticket belongs to the seat or request it moves (R17).
- `ticket_forfeit` stamps `forfeited_at`, `forfeited_venue_id = matches.venue_id`,
  `forfeited_seat_id`; a restore clears all three.
- A deleted holder's ticket is released, never forfeited (R18); `ticket_refund_deleted` then refunds
  it.
- No `in_use` ticket on a terminal match (R16): undo to `in` only while the match is `booked`.
- Never touch a `cashed_out` ticket; leave `forfeited` only by `restored`, and **only while the ticket
  is restorable**.
- One `match_ticket_events` row per move, with `match_id`, `seat_id` or `request_id`, `venue_id` (the
  match's), `code`, and `actor_staff_id` when staff caused it.

**Restorable** (R13, C4). A `forfeited` ticket is restorable while `app.match_marks_open(match_id)`
is true for the match of its `forfeited_seat_id`: that match is `booked`, `played` or `no_show`, not
sandbox, and the business day of its start is still open (`db.md` §4.5.3). It is the same test DB's
`ticket_restore` applies, so "restorable" here and "can still be restored" there never disagree.
Cash-out and DF-20 wait while any forfeit of the purchase is restorable, so a restore can never
land on a refunded purchase.

**`app.ticket_cashout_block(p_payment_id uuid) returns jsonb`** (internal) is the one place that
decides whether a purchase may be cashed out. It returns NULL when it may, else `{reason, count,
until_at}` with the first reason that applies:
- `in_use`: a ticket in a match; `until_at` = the latest `end_at + 3 h` of those matches (R37's
  auto-attend bound);
- `reserved`: a ticket held by a pending request; `until_at` = the request's match `fill_deadline_at`
  (filling) or `start_at` (booked);
- `restorable`: a restorable forfeit; `until_at` = `end_at + 3 h` while the match is `booked`, NULL
  (it waits for the day close) otherwise.

`count` is the number of blocking tickets; `until_at` is the latest known time, NULL when any blocker
waits for the day close. Used by `guest_tickets.cashout`, `ticket_cashout` (before and after its
locks), `tickets_cash_out` and `ticket_refund_deleted`.

### 5.9 Cash-out

**`app.ticket_cashout(p_customer_id uuid, p_purchase_payment_id uuid) → jsonb`** (manager, owner,
any branch; not PIN-gated: the money goes back to the card it came from, as with
`deposit_refund_request`; state-idempotent, no key). Refusals, in order:
1. `FORBIDDEN`.
2. `INVALID_ARGUMENT`: a NULL argument.
3. `PAYMENT_NOT_FOUND`: not a ticket purchase, or not this customer's.
4. Already `refund_pending|refund_failed|refunded` with `refund_reason='ticket_cashout'` → `{duplicate:
   true, …}` with its figures.
5. `PAYMENT_STATE` detail = the status, when not `succeeded` (e.g. `account_deleted`,
   `amount_mismatch`).
6. `TICKET_IN_USE` detail = `ticket_cashout_block` as JSON text (`{"reason","count","until_at"}`), from an
   unlocked read (C15).
7. `NO_UNUSED_TICKETS`: no `available` ticket.

Then: lock the purchase's **`available`** tickets `for update` in id order (conc-D17), then the
purchase row `for update`; re-check 4, 5, 6 and 7 in a new statement (a join that committed meanwhile
shows here); `app.tickets_cash_out(p_purchase_payment_id, 'ticket_cashout', auth.uid())`; audit
`ticket.cashout` `{customer_id, payment_id, tickets, amount_iqd}`. Returns `{duplicate:false,
payment_id, tickets_cashed_out, refund_amount_iqd, status:'refund_pending'}`.

**`app.tickets_cash_out(p_payment_id uuid, p_reason text, p_staff_id uuid) returns jsonb`**
(internal; the one writer of `cashed_out`). Takes the purchase's `available` ticket locks in id order
if the caller has not, then the row lock. Refuses (`PAYMENT_STATE`) unless the row is `succeeded`,
`ticket_cashout_block` is NULL and at least one ticket is `available`. Moves every `available` ticket
to `cashed_out` (`cashed_out_at = now()`, `cashout_payment_id = p_payment_id`), one `cashed_out` event
each (`payment_id`, `code = p_reason`, `actor_staff_id`, `venue_id = app.resolve_venue()` for staff,
NULL otherwise), then `app.deposit_begin_refund(p_payment_id, p_reason, Σ price_iqd of those tickets,
'<n> tickets')` (0242:165) and `app.deposit_nudge()`. The refund is the price **paid** (DF-21), never
today's price. Returns `{tickets, amount_iqd}`.

### 5.10 Refund failures

A cash-out or DF-20 refund that Qi refuses, or that stays unanswered for ten attempts, becomes
`refund_failed` and shows in `deposit_attention` at **every** branch (chain row, sandbox excluded;
the operator labels it "any branch can settle this", §4.4 #4). A manager presses Retry
(`deposit_refund_retry`) or "Settled another way" (`deposit_refund_manual`, manager PIN, a note that
says how). R23: "Settled another way" only from `refund_failed`. The tickets stay `cashed_out` in
every case.

### 5.11 DF-20: `app.ticket_refund_deleted(p_guest_id uuid default null) returns int`

Internal. Candidates: ticket purchases in `succeeded` (R13: anything else never enters the queue) of a
deleted guest (`profiles.deleted_at` set; only `p_guest_id` when given) with at least one `available`
ticket and `ticket_cashout_block(id)` NULL, ordered by `succeeded_at, id`, at most 50 per call. For
each, in its own `begin … exception when others then raise warning … end`: lock its `available`
tickets `for update skip locked` in id order; if any was skipped, leave the purchase for the next
call; else `tickets_cash_out(id, 'account_deleted', null)`. Returns the number of purchases refunded.

Callers (DB, required):
- `delete_my_account` (0264) calls `app.ticket_refund_deleted(v_uid)` as its **last** write, after
  the profile is tombstoned and after every reservations write, and takes no match lock (R25).
- `match_sweep` (0263) calls `app.ticket_refund_deleted(null)` as its last step, in its own exception
  block. It refunds a purchase once its last ticket has been released by the sweep (filling seats
  left, requests withdrawn, a deleted holder's late leave released at start).

A purchase still `created|pending` at deletion is caught at its SUCCESS (§5.4). No push (the token is
gone, 0077:190). Qi refunds to the card; no account is needed.

### 5.12 DF-21

`match_tickets.price_iqd` is copied from the purchase row's `quoted_price_iqd`. A new
`match_ticket_price_iqd` affects only the next prepare. Cash-out sums `match_tickets.price_iqd`.

### 5.13 Sandbox (DF-19)

- Purchase rows and tickets carry `sandbox` from `profiles.payment_sandbox` (0241:180). Sandbox
  tickets lock only into sandbox matches; sandbox matches never create a reservation, so no sandbox
  money reaches a court figure. Every figure in §7 filters `not sandbox` and counts what it left out.
- `deposit_refund_apply` sends no push for a sandbox row; `deposit_attention` lists no sandbox ticket
  row.
- **The flip guard (C20).** `app.trg_profile_sandbox_tickets()`, trigger `profiles_sandbox_tickets`
  `before update of payment_sandbox on profiles for each row when (old.payment_sandbox is distinct
  from new.payment_sandbox)`: refuses `INVALID_TRANSITION` detail `live_tickets` while the profile has
  a ticket `available|reserved|in_use` or a ticket attempt `created|pending`. Cash out (or use) the
  tickets first. This is the only such guard: DB's draft `profiles_sandbox_guard` is dropped
  (`db.md` §4.4.8, D-11).
- The App Review account needs no seeded tickets: it buys them through the normal flow on Qi's
  sandbox with the test card, as it pays deposits. Seeding a sandbox match to join is DB/Ops work.

### 5.14 Gates that travel with 0259

- `tests/rls-matrix.ts` drop 24: `my_tickets` `ex('execute', {anon:'denied',
  guest_anon_session:'guarded'})` (the `hold_slot` row shape); `guest_tickets` inline `ex('guarded',
  {anon:'denied', court_desk:'execute', manager:'execute', owner:'execute'})`; `ticket_cashout`
  `MANAGER_UP`. `fixtures/rpc-allowlist.json` `guarded` gains the three; `--update-floor`.
  `ticket_payment_prepare` is granted to the service role only and needs no row.
- `fixtures/assistant-coverage.json` (R30): `my_tickets`, `guest_tickets`, `ticket_cashout` →
  `map:action`; `ticket_payment_prepare`, `ticket_settle_success`, `tickets_cash_out`,
  `ticket_refund_deleted`, `ticket_wallet`, `ticket_cashout_block`, `trg_profile_sandbox_tickets` →
  `excluded: service_role only — …`.
- Error codes (R11, R28; literal entries, both catalogs):
  - mobile `CODE_TO_KEY` (`apps/mobile/src/features/booking/errors.ts:12`): `TICKET_COUNT_INVALID`
    (the copy branches on detail `wallet_limit`, §4.1 #5), `MATCHES_OFF`, `TERMS_REQUIRED`,
    `MATCH_BANNED` (first raised here);
  - operator `MAPPED_CODES` (`op/lib/errors.ts:10`): `TICKET_IN_USE` (the panel says what blocks and
    until when, from the detail), `NO_UNUSED_TICKETS`, `CUSTOMER_NOT_FOUND` (it leaves
    `fixtures/error-codes-unmapped.json:23` via `check-error-codes.mjs --update` in this commit).
    These are the first operator match codes, so this commit creates the pair
    `opErrors.matches.en.ts`/`.ar.ts` (`operator.md` §5.20); the mobile `matches` pair already
    exists from Guest's 0256 commit;
  - `PAYMENT_STATE` detail `ticket` and `INVALID_TRANSITION` detail `live_tickets` reuse mapped codes.
- `tests/tickets.test.ts` (§9); `pnpm db:types`.
- `check:locks`: nothing new in this commit (`match_tickets` joins `ORDER` with DB's 0260 gate edit,
  which also walks Money's four service paths, §8).
- The edge function itself ships in push E (§12) with `supabase/config.toml` `[functions.ticket-begin]
  verify_jwt = true`, `fixtures/assistant-coverage.json` `"ticket-begin": "map:system"` (beside
  `"deposit-begin"`), and `tests/payments-provider.test.ts:370` listing `ticket-begin`.

## 6. 0262 `match_desk_money`: Money's part

### 6.1 The money lock (R19)

`app.lock_match_money(p_match_id uuid) returns void`: `pg_advisory_xact_lock(hashtextextended(
'app.matches:money:' || p_match_id, 0))`. Internal. Ranked after `day_sessions` and before `tabs`
(§8). It is one of DB's lock primitives, created in 0260 with the gate edit that ranks it
(`db.md` §2.2, §2.6); Money only calls it.

Taken **first** (after any day lock, before any other lock) by: `match_seat_settle`,
`match_link_payment`, `match_seat_write_off`, and DB's `mark_match_seats`, `desk_call_off_short`,
`desk_remove_seat`, `desk_add_seat` (R19 with C6's list). Not taken by the guest RPCs, the reservation
trigger or the sweep: they run under the court and reservation locks, which rank after it. What they
change (a late leave, a refill, auto-attend, a start forfeit, a re-price) can never over-link a seat,
and a settle that races one of them is caught by its court-line check (§6.4 step 13).

### 6.2 The engine: `app.match_money(p_match_id uuid, p_exclude_tab_id uuid) returns jsonb`

Internal, `stable`, no locks. `match_seat_money(uuid)` (§1.5) is `select … from
jsonb_to_recordset(app.match_money($1, null)->'seats')`; `court_fee_written_off` reads the same engine.
One engine, so booking figures and seat figures cannot drift.

**Inputs**, for the match's reservation `r`:
- `live` = `r.kind='booking' and r.status in ('confirmed','arrived','completed')`. No reservation
  (filling, sandbox) or not live (called off, cancelled, all no-show) → `phase='not_live'`, every
  owed, open, written-off, delta and credit figure 0; `paid_iqd`, `desk_paid_iqd` and each seat's
  `paid_desk_iqd` are still reported (a refund may be due).
- `M = matches.price_iqd` (Σ shares, DF-3); `P = r.price_iqd` (moves with DF-4); `D = greatest(P − M,
  0)`; `C = greatest(M − P, 0)`; `started = now() ≥ r.start_at`.
- `links(s)` = Σ `payment_match_seats.amount_iqd` of seat `s` over payments whose tab is `settled`,
  not merged, and not `p_exclude_tab_id` (the filter of `court_fee_paid`, 0242:1533-1538). Gross (MD-13).
- `paid = app.court_fee_paid(r.id, p_exclude_tab_id)`; `live_tab_paid` = `tab_net_paid` of the
  booking's live tab (0 when none).

**Carriers** (R21), read through DB's `app.match_carriers` (`db.md` §3.2), the one definition both
lanes use. The carrier of a `seat_no` is its seat with status `in`, `attended`, `no_show` or
`left_late` that no other such seat replaces (`replaces_seat_id`). A `seat_no` with no carrier is
**vacant**. Seats `left`, `removed`, `cancelled`, `refilled`, and a replaced `no_show` (R4) carry
nothing.

**Per `seat_no`**, with `S = shares_iqd[seat_no]`, `L = least(links(carrier), S)` (0 when vacant),
`base = S − L`:

| Carrier | Group | Before start | After start |
| --- | --- | --- | --- |
| `in` or `attended`, no write-off | collectable | owed | owed |
| `in` or `attended`, `written_off_at` set | collectable, flagged `manual` | written off (`manual`) | same |
| `no_show` | automatic write-off | written off (`no_show`) | same |
| `left_late` | open / automatic | open | written off (`left_late`) |
| vacant | open / automatic | open (`S`) | written off (`vacant`) |

**The pool** (MD-9): `U = greatest(paid − Σ L over carriers, 0)`, `K = U + C`. `K` pays `D` first
(`delta_owed = D − that`), then collectable seats from the highest `seat_no` down, then automatic
write-offs from the highest `seat_no` down; what is left is `over`. Open shares are never credited.
Per seat: `credit` is what the pool gave it; a collectable seat owes `base − credit`; a `manual` one
shows that as `written_off` with `owed = 0`; an automatic one is written off `base − credit`; an open
one is open `base`. `take` (what Take share collects) = `owed`, or the `manual` write-off, else 0.
Keeping `manual` seats in the collectable group means clearing one (MD-11) moves no other seat's
figure.

**Output:**

```json
{ "match_id", "reservation_id", "phase": "not_live|booked|started",
  "price_iqd": 40000, "booking_price_iqd": 40000, "price_delta_iqd": 0,
  "paid_iqd": 20000, "live_tab_paid_iqd": 0, "desk_paid_iqd": 20000,
  "unassigned_iqd": 0, "delta_owed_iqd": 0,
  "owed_iqd": 10000, "written_off_iqd": 10000, "open_iqd": 0, "over_iqd": 0,
  "seats": [ { "seat_id": "uuid|null", "seat_no": 1, "kind": "account|friend|desk|vacant",
               "status": "attended", "carrying": true, "share_iqd": 10000,
               "paid_desk_iqd": 10000, "credit_iqd": 0, "owed_iqd": 0, "written_off_iqd": 0,
               "write_off": null | "manual|no_show|left_late|vacant", "open_iqd": 0, "take_iqd": 0 } ],
  "unassigned": [ { "payment_id", "tab_id", "tab_live", "method", "amount_iqd", "unassigned_iqd", "created_at" } ] }
```

- `seats[]`: one row per `seat_no` 1..4 (carrier or vacant), then one row per non-carrying seat
  (`carrying:false`; only `paid_desk_iqd` can be non-zero).
- `desk_paid_iqd = paid_iqd + live_tab_paid_iqd` (the call-off warning reads it).
- `unassigned_iqd = U`. `unassigned[]` lists money the desk can still link: per payment on a settled
  tab, `least(amount − its refunds − its links, tab court_iqd − the tab's links)`; per payment on a
  live court-only tab, `amount − its refunds` (`tab_live: true`); rows above 0 only. It feeds
  `booking_bill.match.unassigned` and DB's `desk_match_detail.money.unassigned[]` (conc-D11).
- Identity (proved from the definitions): `owed + written_off + open + delta_owed = P − paid + over`.
  With `over = 0`: `P − paid − written_off = owed + open + delta_owed` (invariant M3).

### 6.3 `court_fee_written_off`, `court_fee_remaining`, `compute_tab_totals`

These three internals (`match_money`, `match_seat_money`, `court_fee_written_off`) are created
**here in 0262**, not in 0260 as §1.5 lists the last two: every caller is in 0262 or later, and they
read DB's 0260 `match_carriers`.

```sql
-- internal (§1.5). 0 unless r is a live match booking; one probe of matches_reservation_key otherwise.
app.court_fee_written_off(p_reservation_id uuid, p_exclude_tab_id uuid default null) returns bigint
  = least((app.match_money(m.id, p_exclude_tab_id)->>'written_off_iqd')::bigint,
          greatest(r.price_iqd - app.court_fee_paid(r.id, p_exclude_tab_id), 0))
    from matches m join reservations r on r.id = m.reservation_id
   where m.reservation_id = p_reservation_id;     -- coalesce(…, 0)

-- court_fee_remaining, re-issued from 0106:138: one term added
greatest(r.price_iqd - app.court_fee_paid(r.id, p_exclude_tab_id)
                     - app.court_fee_written_off(r.id, p_exclude_tab_id), 0)

-- compute_tab_totals, re-issued from 0211:200: the court line (0211:246-250) becomes
select case when t.court_cap_iqd is null then app.court_fee_remaining(t.reservation_id, t.id)
            else least(t.court_cap_iqd, app.court_fee_remaining(t.reservation_id, t.id)) end
  into v_court from tabs t where t.id = p_tab_id and t.reservation_id is not null;
```

`match_money` never calls `court_fee_remaining` or `compute_tab_totals`, so there is no recursion. A
booking with no match is unchanged (written off 0, no cap): `booking_bill_states` (0106:949),
`unpaid_played_bookings` (0231:950), `settle_tab`, `settle_zero_tab` and `cancel_tab` (0244:312, :456,
:631-635) inherit the netted figure; `desk-payment.test.ts` stays green unmodified.

### 6.4 `app.match_seat_settle(…)` (§1.7 signature, unchanged)

Cashier, court_desk, manager, owner at the match's branch (not shop_staff: the operator gates it on
`takeSeatPayment`, never `takeCourtPayment`, which includes shop_staff at `op/lib/auth.tsx:587`).
Online only (DF-11). One call settles one tab in full (MD-8). `p_expected_owed_iqd` is Σ `take_iqd` of
the selected seats (= Σ `owed_iqd` unless a seat has a manual write-off).

Refusals and steps, in order:
1. `FORBIDDEN`.
2. `INVALID_ARGUMENT`: `p_seat_ids` NULL, empty, more than 4 or with duplicates;
   `p_expected_owed_iqd` NULL or < 1; `p_amount_iqd` given and < 1; `p_idempotency_key` NULL (detail
   `p_idempotency_key`, C16; the signature keeps its default).
3. `SEAT_NOT_FOUND`: an unknown seat, or seats of two matches.
4. `VENUE_MISMATCH` unless `is_staff_at` the match's branch; then `set_config('app.venue_id', …)`.
5. `app.claim_replay(p_idempotency_key, 'match_seat_settle')` (0049:68): a replay returns the stored
   result; `IDEMPOTENCY_CONFLICT`.
6. `NO_OPEN_DAY`: `v_day := app.current_open_day_locked(m.venue_id)` (the match's branch named, never
   the station's).
7. `app.lock_match_money(m.id)`.
8. `MATCH_NOT_BOOKED`: the match is not `booked`/`played`, or its reservation is not live.
9. The booking's live tab: none → a new one (step 12); empty (no orders, payments or adjustments) →
   adopt it (`for update`); anything else → `BOOKING_TAB_OPEN` (detail = tab id).
10. From `match_money(m.id, null)`, in this statement: `NOTHING_OWED` (detail = seat id) when a
    selected seat's `take_iqd` is 0; `SEAT_OWED_CHANGED` (detail `expected X, now Y`) when Σ `take_iqd`
    ≠ `p_expected_owed_iqd`; `INVALID_AMOUNT` when `p_amount_iqd` > that sum.
11. `v_amount := coalesce(p_amount_iqd, Σ take)`. Clear the manual write-off of every selected seat
    that has one (`written_off_* := null where id = …`; audit `match.seat_write_off_cleared`).
12. Tab: insert `tabs (venue_id m.venue_id, day_session_id v_day, reservation_id r.id,
    opened_by_staff_id auth.uid(), device_id p_device_id, kind 'cafe', court_cap_iqd v_amount)`; a
    `unique_violation` on `tabs_one_live_per_reservation` re-reads the live tab and adopts it when
    empty, else `BOOKING_TAB_OPEN`. An adopted tab gets `update tabs set court_cap_iqd = v_amount where
    id = v_tab.id` (G12).
13. `compute_tab_totals(tab).court_iqd <> v_amount` → `SEAT_OWED_CHANGED` (the net for writers that
    cannot take the money lock: a cancel, a re-price, the sweep).
14. `app.settle_tab(tab, p_method, p_tendered_iqd, v_amount, p_idempotency_key, p_device_id,
    v_amount)` (0244:312): `TENDER_SHORT`, `TENDER_CARD`, the till-shift stamp's refusals (0205) as for
    any till payment, and in a rare race `TOTAL_CHANGED` (handled like `SEAT_OWED_CHANGED`).
15. Insert `payment_match_seats` rows, spreading `v_amount` over the seats in the order given, each up
    to its `take_iqd`; audit `match.seat_settle` `{match_id, payment_id, tab_id, method, seats[],
    cleared_write_offs[]}`; `finish_replay`.

Returns `{duplicate:false, payment_id, tab_id, amount_iqd, change_iqd, seats:[{seat_id, seat_no,
applied_iqd, owed_iqd}], cleared_write_offs:[seat_id], booking_remaining_iqd}` (`owed_iqd` after the
payment). A part payment (`p_amount_iqd` below the sum) still settles its tab in full; the seats keep
owing the rest.

The direct tab insert (not `open_tab`) names the match's branch and day and sets the cap at insert;
`tabs_reservation_venue_fkey` (0133:52-56) keeps tab and booking on one branch.

### 6.5 `app.match_link_payment(p_payment_id uuid, p_allocations jsonb, p_idempotency_key text default null) → jsonb`

Attributes a payment taken on the booking's normal bill (the offline path, queued `tab.open`/
`tab.settle`) to seats, or closes that bill. `p_allocations` = `[{seat_id, amount_iqd}]`, **0..4**
items (C22: `[]` closes a live court-only tab as booking-level money, e.g. a DF-4 price rise).
Cashier, court_desk, manager, owner. Online only.

Refusals and steps, in order:
1. `FORBIDDEN`.
2. `INVALID_ARGUMENT`: the key NULL (C16); not an array; more than 4 items; an item without a seat or
   with an amount < 1; duplicate seats.
3. `PAYMENT_NOT_FOUND`.
4. `VENUE_MISMATCH`; `set_config('app.venue_id', …)`.
5. `claim_replay(p_idempotency_key, 'match_link_payment')`.
6. `PAYMENT_NOT_ON_MATCH`: the payment's tab is not on a match's booking.
7. `MATCH_NOT_BOOKED`: that booking is not live.
8. `SEAT_NOT_FOUND`: a seat of another match.
9. When the tab is live (unlocked read): `current_open_day_locked(m.venue_id)` first (`NO_OPEN_DAY`).
10. `app.lock_match_money(m.id)`; the tab `for update`.
11. `PAYMENT_STATE`: the tab is `void` or merged (detail = status); a live tab with nothing paid
    (detail `empty`: adopt it through `match_seat_settle` instead).
12. A live tab: `court_cap_iqd := app.tab_net_paid(tab)` (0037:31), then `app.settle_zero_tab(tab,
    'match_link', p_device_id, null)` (0244:456). It settles with `court_iqd` = what was paid;
    `REFUND_DUE` from it becomes `PAYMENT_STATE` detail `over_paid` (paid more than the booking now
    owes). The rest of the booking's price goes back to the seats.
13. `[]` on a settled tab → `INVALID_ARGUMENT` detail `p_allocations` (nothing to do).
14. Per item: `NOTHING_OWED` (detail = seat id) when the seat carries nothing; `INVALID_ARGUMENT`
    detail `already_linked` when this payment already has a link to that seat (the primary key);
    `AMOUNT_OVER_SEAT` when the seat's links + amount > its share; `PAYMENT_OVER_ALLOCATED` when the
    payment's links > `amount_iqd −` its refunds, or the tab's links > its `court_iqd`.
15. Insert the links; audit `match.payment_link`; `finish_replay`.

Returns `{duplicate, payment_id, tab_id, tab_closed, links:[{seat_id, seat_no, amount_iqd}],
unassigned_iqd}` (`unassigned_iqd` = what of this payment is still unlinked). A link on a `no_show`
seat is allowed (it lowers the write-off: the organiser paid for the absent friend).

### 6.6 `app.match_seat_write_off(p_seat_id uuid, p_reason text, p_pin text, p_device_id text default null) → jsonb` (R1)

court_desk, manager, owner; a **manager PIN grant** authorises it (the till's `apply_discount`
model): `verify_manager_pin` mints, the RPC spends with `app.consume_pin_grant(p_device_id)`
(0156:446). `PIN_GATED_RPCS` gains it in all three copies (G13). For a player who played and walked
out, or a staff error.

Refusals, in order:
1. `FORBIDDEN`.
2. `REASON_REQUIRED`: blank or not `walked_out`, `staff_error`, `other`.
3. `SEAT_NOT_FOUND`.
4. `VENUE_MISMATCH`; `set_config('app.venue_id', …)`.
5. Already written off by hand → `{duplicate:true}` (before the grant is spent).
6. `PIN_GRANT_REQUIRED`: `consume_pin_grant(p_device_id)` returns the authorizer.
7. `app.lock_match_money(m.id)`, then `app.match_lock(m.id)` (courts → booking row → hold expiry →
   venue mutex, R15; conc-D4 pick), and under them:
8. `MATCH_NOT_BOOKED`: not `booked`/`played` (C22: `played` allowed), or the booking not live.
9. `SEAT_NOT_STARTED`: `now() < r.start_at`.
10. `NOTHING_OWED`: the seat is not `in` or `attended` (a no-show, a late leave and a vacant number
    are written off on their own), or its `owed_iqd` is 0.

Stamps `written_off_by_staff_id` (the caller), `written_off_at`, `write_off_reason`. The amount is not
stored: it is whatever the seat has not paid, so a payment that lands later only shrinks it. Audit
`match.seat_write_off` with `p_authorizer_id` = the manager who proved the PIN. Returns `{duplicate,
seat_id, seat_no, written_off_iqd, booking_remaining_iqd}`. Undone only by collecting (MD-11).

### 6.7 `booking_bill` (from 0242:1551) and `booking_bill_states` (from 0106:949)

`booking_bill` gains, for every booking (NULL/0 when there is no match):
- `court_written_off_iqd` = `court_fee_written_off(r.id, null)`;
- `match`: `null | {id, status, phase, price_iqd, booking_price_iqd, price_delta_iqd, paid_iqd,
  desk_paid_iqd, unassigned_iqd, delta_owed_iqd, owed_iqd, written_off_iqd, open_iqd, over_iqd,
  unassigned[]}` (the §6.2 top level; rules-D23 keeps `unassigned_iqd`);
- `seats`: the §6.2 rows plus `label` (staff-facing: the player's, the linked customer's or the
  typed desk name; for a friend seat the holder's name, which the operator words as "‹name›'s
  friend" from `kind`; NULL for a vacant number), `ticket` (`in_use|released|forfeited|none`) and
  `write_off_reason`. No phones: cashiers read this RPC;
- `settled_tabs[].payments[]` items gain `seats: [{seat_no, amount_iqd}]` from the links;
- the online list (0242:1657-1670) gains `and bp.purpose = 'deposit'`.

`booking_bill_states` rows gain `match_id`, `court_written_off_iqd`, `seats_owing` (carriers with
`owed_iqd > 0`), `seats_paid` (carriers with links and `owed_iqd = 0`) and `seats_owed_iqd` (Σ). The
`state` vocabulary is unchanged; the operator renders match rows from the new fields (rules-D19).

### 6.8 The DF-16 wall (R20)

```sql
create or replace function app.trg_match_booking_no_cafe() returns trigger  -- security definer
  … if exists (select 1 from tabs t join matches m on m.reservation_id = t.reservation_id
                where t.id = new.tab_id) then
      raise exception 'MATCH_BOOKING_NO_CAFE' using errcode = 'P0001',
        hint = 'café orders by match players go on their own café bill';
    end if; return new; …
create trigger orders_match_booking_no_cafe
  before insert or update of tab_id on orders for each row execute function app.trg_match_booking_no_cafe();
create trigger tab_adjustments_match_booking_no_cafe
  before insert or update of tab_id on tab_adjustments for each row execute function app.trg_match_booking_no_cafe();
```

It catches every path: `open_tab` + `till_add_items`, a merge into the booking's tab (`merge_tabs`
moves orders and adjustments, 0244:1074-1075), the floor phone (0251 `place_floor_order`), a queued
`order.create`/`adjustment.apply` replay (a non-retryable conflict). An empty court-only tab (the
offline path) stays allowed. Discounts and promotions on a match booking are therefore impossible; a
share is forgiven only by a write-off. One probe of `matches_reservation_key`; no hot RPC re-issued.

### 6.9 Price changes, call-off, removals, refills

- **DF-4.** A desk move or extend re-prices the reservation (0150, 0071); shares stay stamped. A rise
  is `delta_owed_iqd`, taken on the normal bill and closed with `match_link_payment(…, [])`; a fall is
  credit (MD-9).
- **Call-off (OM-47, R12).** `desk_call_off_short` (DB) cancels the booking: it is no longer live, so
  `court_fee_remaining` and `court_fee_written_off` are 0 and nobody owes anything. Money already taken
  shows as `court_refund_due_iqd` (0242:1631-1633) and a manager refunds it at the till (`app.refund`,
  PIN). A partly paid live tab on the booking shows `refund_due` and blocks day close until refunded
  and closed, as for any cancelled booking. A staff cancel of a booked match is the same, every ticket
  released.
- **Removal after booking** (`staff_error`/`duplicate`): the seat stops carrying; its number is open
  before start and written off (`vacant`) after, unless refilled.
- **Refill** (online before start, desk until `end_at`, R4 after a no-show): the new seat is the
  carrier and owes the share; the replaced seat's links (if any) join the pool.

### 6.10 Gates that travel with 0262 (Money's part)

- `tests/rls-matrix.ts` drop 24: `match_seat_settle`, `match_link_payment` inline `ex('guarded',
  {anon:'denied', cashier:'execute', court_desk:'execute', manager:'execute', owner:'execute'})`
  (shop_staff denied); `match_seat_write_off` inline `ex('guarded', {anon:'denied',
  court_desk:'execute', manager:'execute', owner:'execute'})` with `p_pin: MANAGER_PIN` (the
  `deposit_refund_manual` row's args, `tests/rls-matrix.ts:4254-4259`, G3c). Allowlist `guarded`;
  `--update-floor`.
- `PIN_GATED_RPCS` + `match_seat_write_off` in `packages/core/src/schemas/mutations.ts:49-57`,
  `fn/_shared/mutation-types.json:20-27` (`pinGatedRpcs`) and `packages/db/tests/helpers.ts:162-164`,
  same commit (the `_shared` edit starts `functions-deploy`; harmless, §12).
- `fixtures/assistant-coverage.json`: the three RPCs `map:action`; `match_money`,
  `match_seat_money`, `court_fee_written_off`, `trg_match_booking_no_cafe` `excluded`. The
  `booking_bill` tool's `id_keys` gain `match_id`, `seat_id` in both byte-identical copies
  (`packages/core/src/assistant/tools.ts:533` and `fn/_shared/assistant/tools.ts`; R14 lets the owner's
  assistant see the seat names). Regenerate the map.
- Operator `MAPPED_CODES` + both `ws` catalogs: `SEAT_OWED_CHANGED`, `NOTHING_OWED`,
  `PAYMENT_NOT_ON_MATCH`, `AMOUNT_OVER_SEAT`, `PAYMENT_OVER_ALLOCATED`, `MATCH_NOT_BOOKED`,
  `SEAT_NOT_STARTED`, `SEAT_NOT_FOUND`, `MATCH_BOOKING_NO_CAFE` (new, R20); detail words for
  `PAYMENT_STATE` `over_paid`/`empty` and `INVALID_ARGUMENT` `already_linked` (G7c).
- `check:locks`: nothing to edit here; DB's 0260 gate edit already ranks `match_money_advisory` and
  emits it for `app.lock_match_money(` (`db.md` §2.6). The printed sequences must match §8.
- `check:safeupdate`: every UPDATE has a WHERE. `tests/match-money.test.ts` (§9);
  `desk-payment.test.ts` unmodified; `pnpm db:types`.

## 7. 0265 `match_reports`: Money's part

### 7.1 `app.ticket_money_figures(p_ts_from timestamptz, p_ts_to timestamptz, p_venues uuid[]) returns jsonb`

Internal (MD-16), non-sandbox only:

| Key | Scope | Definition |
| --- | --- | --- |
| `soldIqd`, `soldTickets`, `purchases` | chain | ticket purchases with `succeeded_at` in range, except those refunded `amount_mismatch` (never a sale) |
| `refundedIqd`, `refundedTickets` | chain | ticket rows `refunded` with `refunded_at` in range, reasons `ticket_cashout`/`account_deleted` (a manual settle keeps its reason) |
| `refundsWaitingIqd`, `refundsWaitingCount` | chain | ticket rows in `refund_pending` or `refund_failed` now |
| `forfeitsIqd`, `forfeitedTickets` | `forfeited_venue_id = any(p_venues)` | tickets `forfeited` now with `forfeited_at` in range (a restore removes the forfeit from every period) |
| `restoredTickets` | venue of the event | `restored` events in range |
| `cashoutsHereIqd`, `cashoutsHereTickets` | venue of the `cashed_out` event | cash-outs pressed at these branches |
| `liabilityIqd`, `liabilityTickets` | chain | tickets whose latest `match_ticket_events` row before `p_ts_to` is `bought`, `reserved`, `locked`, `released` or `restored` (exact replay; the table is small) |
| `sandboxExcluded` | chain | sandbox purchases left out |

### 7.2 `app.day_close_online(p_day_session_id uuid default null) → jsonb` (manager, owner)

The `day_close_shop` precedent (0246:450): default = the branch's open day, else its latest; another
branch's day is `DAY_NOT_FOUND`. Information only: `close_day` is untouched, and seat money is already
in cash and card because it is ordinary `payments`. Shape (conc-D10, rules-D21: Money's; the operator
adapts):

```json
{ "day_session_id", "venue_id", "business_date", "as_of",
  "deposits":      { "received_iqd", "received_count", "refunded_iqd", "refunded_count",
                     "forfeited_iqd", "forfeited_count", "refunds_waiting_iqd", "refunds_waiting_count" },
  "tickets_here":  { "forfeited_iqd", "forfeited_count", "restored_count", "cashouts_iqd", "cashouts_count" },
  "tickets_chain": { "sold_iqd", "sold_tickets", "purchases", "refunded_iqd", "refunded_tickets",
                     "refunds_waiting_iqd", "refunds_waiting_count", "liability_iqd", "liability_tickets" },
  "matches":       { "bookings", "price_iqd", "desk_paid_iqd", "written_off_iqd", "owed_iqd",
                     "called_off", "no_show_seats" },
  "sandbox_excluded": { "deposits": 0, "tickets": 0 } }
```

- Bucketing: `app.venue_business_date(v_day.venue_id, ts) = v_day.business_date` (0211:29).
  Deposits: received by `succeeded_at`, refunded by `refunded_at`, forfeited by `forfeited_at`,
  waiting = now. Tickets through §7.1 with the day's bounds; `tickets_chain` is labelled chain-wide,
  liability as of `coalesce(v_day.closed_at, now())`. Matches: live match bookings starting that
  business day (Σ price, Σ `court_fee_paid`, Σ `court_fee_written_off`, Σ `court_fee_remaining`),
  call-offs and no-show carriers of matches starting that day.

### 7.3 `reports_figures` (from 0219:174) and `panel_headline` (from 0096:107)

`reports_figures` gains (`v_b.ts_from`/`ts_to`, non-sandbox):

| Key | Scope | Definition |
| --- | --- | --- |
| `onlineDeposits` | `report_venues()` | deposit Σ `amount_iqd` by `succeeded_at` − Σ `refund_amount_iqd` by `refunded_at` |
| `depositForfeits` | `report_venues()` | deposits with `forfeited_at` in range |
| `ticketSales` | chain | §7.1 `soldIqd` |
| `ticketRefunds` | chain | §7.1 `refundedIqd` |
| `ticketForfeits` | `report_venues()` | §7.1 `forfeitsIqd` |
| `ticketLiability` | chain | §7.1 `liabilityIqd` at `ts_to` |
| `matchWrittenOff` | `report_venues()` | Σ `court_fee_written_off(r.id, null)` of live match bookings starting in range |

`revenue`, `padelRevenue`, `cash` and `card` are unchanged (the headline question is Parsa's, §16).
`panel_headline`'s fixed key list (0096:117-118) gains the seven keys at the end (owner only,
`reports_guard(true)`), so the owner's assistant and a later panel tile can read them; the operator's
`mapFigures` drops unknown keys (`op/features/panel/figures.ts`), so nothing renders until the Operator
lane adds tiles. The `panel_headline` tool description gains "ticket sales, refunds, forfeits and
liability, online deposits, written-off match shares" in both tool copies.

The operator's Courts report reads ticket money from `report_matches.tickets` (§7.6): the same helper
as `reports_figures`, reachable by managers (rules-D22; §4.4 #3 names the reader).

### 7.4 `report_courts` (from 0219:2438): `matches` block

The return object gains `matches: {bookings, bookedIqd, deskPaidIqd, writtenOffIqd, noShowSeats,
calledOffShort, ticketForfeitsIqd}` for `app.analysis_venue()` (0219:2445). Match bookings stay in the
per-court rows as ordinary bookings. No names, labels or customer ids (G6a). The `report_courts` tool
description mentions the block in both copies.

### 7.5 `unpaid_played_bookings` (from 0231:950)

Rows gain `match_id`, `owed_by_seats_iqd` (Σ `owed_iqd`), `delta_owed_iqd` and `seats_owing:
[{seat_no, label, owed_iqd}]` (`label` as in `booking_bill.seats`; this read and `booking_bill` are
the only places a staff label appears, never a `report_*`, G6a). The filter is unchanged; because `court_fee_remaining` nets write-offs, a match whose present players
paid and whose no-shows are written off drops off the list.

### 7.6 `app.report_matches(p_from date, p_to date, p_filters jsonb default '{}') → jsonb`

`reports_guard(false)` (0068:70), `report_venues()`, `analytics_bounds`. Filters: `category`,
`joinPolicy` (else `INVALID_ARGUMENT`, detail = key). Matches by `start_at`, sandbox excluded.

```json
{ "period": {"from","to"},
  "totals": { "started", "booked", "played", "bumped", "expired", "cancelled", "calledOffShort",
              "allNoShow", "fillRatePct", "seatsFilled", "accountSeats", "friendSeats", "deskSeats",
              "attendedSeats", "noShowSeats", "leftLateSeats", "refilledSeats",
              "bookedIqd", "deskPaidIqd", "writtenOffIqd", "ticketForfeitsIqd", "sandboxExcluded" },
  "tickets": { "soldIqd", "soldTickets", "refundedIqd", "refundedTickets", "forfeitsIqd",
               "forfeitedTickets", "liabilityIqd", "liabilityTickets",
               "chainWide": ["soldIqd","soldTickets","refundedIqd","refundedTickets","liabilityIqd","liabilityTickets"] },
  "byDay": [ { "date", "started", "booked", "bookedIqd", "writtenOffIqd", "noShowSeats" } ],
  "columns": [ … the report_courts column shape, EN + AR labels … ] }
```

`fillRatePct` = matches that ever had a `reservation_id` ÷ matches started, one decimal. No names.

### 7.7 Gates that travel with 0265 (Money's part)

- `tests/rls-matrix.ts`: `day_close_online` and `report_matches` `MANAGER_UP` (as `report_courts`,
  `tests/rls-matrix.ts:2281`). Allowlist `guarded`; `--update-floor`.
- `fixtures/assistant-coverage.json`: `day_close_online`, `report_matches` → `map:action`;
  `ticket_money_figures` → `excluded`. Tool descriptions (§7.3, §7.4) in both copies; regenerate the
  map.
- SEC-29 (`check-analytics-payload.mjs`): `report_matches` and `report_courts` carry no forbidden key
  (the nine DB patterns, rules-D31).
- `tests/reports.test.ts` the new keys; `match-money.test.ts` the report cases; `pnpm db:types`.

## 8. Lock order

The final `ORDER` (DB's 0260 gate edit, `db.md` §2.6, which also carries R19's rank):

```text
day_sessions → match_money_advisory → tabs → orders → order_items → tickets → payments → till_shifts
  → refunds → stock_batches → court_advisory → reservations → match_venue_advisory → match_tickets
```

`booking_payments` and `app.pin_grants` stay out of `ORDER`: deposit rows are locked before the venue
mutex (court → reservations → deposit row), ticket rows only after `match_tickets`, and no function
locks both kinds. `day_sessions` is taken `for share` by `current_open_day_locked`, which the walker
does not see; the run-time order is kept anyway.

| Function | Locks, in order |
| --- | --- |
| `deposit_settle_success` | [hoisted, R15] `expire_stale_holds` → `reservations` → then only writes (in-place update, re-create insert) and the deposit row |
| `deposit_apply`, deposit branch | `court_advisory` → `reservations` → [deposit row] → `deposit_settle_success` → the hold-release write |
| `deposit_apply`, ticket branch | [purchase row] → `ticket_settle_success` (inserts; a deleted payer: `match_tickets` of its new rows → [row]); textually after the deposit branch |
| `deposit_refund_apply` / `_retry` / `_manual` / `_request` | deposits unchanged (`_manual`: [pin grant] first); ticket rows: [purchase row] only |
| `deposits_due_for_reconcile`, `trg_reservation_deposit` | [booking_payments] only, unchanged |
| `ticket_payment_prepare` | [the guest's live ticket row `for update`, or an insert] |
| `ticket_cashout` | `match_tickets` (`available` rows, id order) → [purchase row] → `tickets_cash_out` |
| `tickets_cash_out` | `match_tickets` (if not held; id order) → [purchase row] |
| `ticket_refund_deleted` | per purchase: `match_tickets` (`skip locked`, id order) → [row] |
| `match_seat_settle` | `day_sessions` (share) → `match_money_advisory` → `tabs` (insert, or `for update` on the adopted tab) → `settle_tab`: `tabs` → `payments` (+ `till_shifts` share, stamp trigger) → link inserts |
| `match_link_payment` | [`day_sessions` share, only when closing a live tab] → `match_money_advisory` → `tabs` → [`settle_zero_tab`: the same day and tab again] → link inserts |
| `match_seat_write_off` | [pin grant] → `match_money_advisory` → `court_advisory` (every court, id order) → `reservations` (booking row) → `expire_stale_holds` → `match_venue_advisory` → one seat UPDATE |
| DB marks, call-off, remove, add | `match_money_advisory` → their L1/L2 |
| `delete_my_account` (DB) | its own writes → `ticket_refund_deleted` last: `match_tickets` → [rows] |
| `match_sweep` (DB) | its venues' locks → … → `ticket_refund_deleted` last |
| R20 guard, `trg_profile_sandbox_tickets`, reads (`my_tickets`, `guest_tickets`, `deposit_status`, `booking_bill*`, `match_money`, `court_fee_*`, `compute_tab_totals`, reports, `day_close_online`) | none |

Static sequences the walker must print (the `check:locks` fixture test for R15 lands with 0263, the
first file where the trigger makes it matter; DB writes the test):
- `deposit_apply`: `court_advisory → reservations → match_venue_advisory → match_tickets`.
- `ticket_cashout`, `tickets_cash_out`, `ticket_refund_deleted`: `match_tickets`.
- `match_seat_settle`: `match_money_advisory → tabs → payments`.
- `match_seat_write_off`: `match_money_advisory → court_advisory → reservations →
  match_venue_advisory → match_tickets` (the last two from the trigger the gate expands under the hold
  expiry, with DB's once-per-sequence mutex rule).

Two textual rules keep these green: in `deposit_apply` the deposit locks and the
`deposit_settle_success` call come before anything ticket-related; in `match_link_payment` the day
lock comes before `lock_match_money`. The walker's service-role list (§1.4, R8) is extended by DB's
0260 edit with Money's `deposit_apply`, `ticket_settle_success`, `tickets_cash_out`,
`ticket_refund_deleted`.

## 9. Money invariants (the tests assert them)

`assertMatchMoney(matchId)` and `assertTicketLedger(guestId)` (`packages/db/tests/helpers.ts`) run
after every case of `match-money.test.ts`, `tickets.test.ts` and DB's match suites.

Court money:
1. **M1** `Σ shares_iqd = matches.price_iqd`, non-increasing, max − min ≤ 1, equal to core
   `splitEvenly` (`packages/core/src/money/split.ts:16`) for the same price (the
   `cafe-flow.test.ts:392-429` pattern over awkward prices).
2. **M2** The booking is created at `price_iqd = matches.price_iqd`.
3. **M3** Live match booking with `over_iqd = 0`: `court_fee_paid + court_fee_written_off +
   court_fee_remaining = r.price_iqd` and `court_fee_remaining = owed + open + delta_owed`.
4. **M4** Per carrier: `paid_desk + credit + owed + written_off + open = share_iqd`.
5. **M5** After any `match_seat_settle` or `match_link_payment` commit the booking has no live tab; every
   tab with `court_cap_iqd` is `settled` with `court_iqd = court_cap_iqd`; a settle tab also has
   `total_iqd = court_iqd = Σ` its links.
6. **M6** At link time: per payment Σ links ≤ `amount_iqd −` refunds; per tab Σ links ≤ `court_iqd`;
   per seat Σ links ≤ `share_iqd`.
7. **M7** A not-live match booking: `court_fee_remaining = 0` and `court_fee_written_off = 0`.
8. **M8** No ticket row is ever counted by `deposit_net_paid`, `court_fee_paid`, `my_reservations`,
   `booking_bill`, cash, card or the day's cash count.
9. **M9** A booking with no match: `court_fee_remaining`, `compute_tab_totals`, `booking_bill` and
   `booking_bill_states` (old keys) equal their 0106/0242 values; `desk-payment.test.ts` passes
   unmodified; `deposits.test.ts` passes with only the R23 edit.
10. **M10** No sandbox match has a `reservation_id`; sandbox rows and tickets add 0 to every §7 figure.
11. **M11** No `orders` or `tab_adjustments` row on a match booking's tab (R20).
12. **M12** A seat with links is never `no_show` (C18, enforced by DB's marks under the money lock).

Tickets:
13. **T1** A ticket purchase in `succeeded|refund_*|refunded` whose reason is not `amount_mismatch` and
    whose payer existed at SUCCESS has exactly `ticket_count` tickets; every other purchase has none.
14. **T2** Each ticket: `price_iqd = purchase.quoted_price_iqd`, `sandbox = purchase.sandbox`; each
    purchase: `amount_iqd = ticket_count × quoted_price_iqd`.
15. **T3** A purchase with a `cashed_out` ticket is `refund_pending|refund_failed|refunded` with reason
    `ticket_cashout` or `account_deleted`, `refund_amount_iqd = Σ price_iqd` of its `cashed_out`
    tickets, and none of its tickets is, or later becomes, `available`, `reserved` or `in_use` (C4).
16. **T4** A purchase is refunded at most once (0241:56-57, :73-74) and never before it succeeded.
17. **T5** `reserved ⇔ request_id`, `in_use ⇔ seat_id`; an `in_use` ticket's seat is `in` or
    `left_late` and its `guest_id` is the ticket's owner; a `reserved` ticket's request is `pending`
    and the requester's (R17).
18. **T6** A ticket's latest event matches its status.
19. **T7** Over all time, non-sandbox: tickets sold = live + forfeited + cashed out, in count and in
    Σ `price_iqd`.
20. **T8** A `reserved` or `in_use` ticket has `sandbox = matches.sandbox` of its match.
21. **T9** No `in_use` ticket on a seat of a terminal match (R16).
22. **T10** A cash-out or DF-20 refund never happens while `ticket_cashout_block` is not NULL (R13).
23. **T11** A deleted holder's ticket is never `forfeited` after deletion (R18).
24. **T12** `cashout_payment_id = purchase_payment_id` whenever set (R8).

Test files:
- **`tests/tickets.test.ts`** (0259; narrative like `deposits.test.ts`, fake provider through
  `deposit_apply`): every prepare refusal in order; double tap and the concurrent-insert race; wallet
  limit; attempts; SUCCESS → N tickets; late SUCCESS after `expired`; amount mismatch; deleted account
  at SUCCESS; replay; FAILED/EXPIRED leave nothing; `deposit_status` ticket shape and staff
  `PAYMENT_NOT_FOUND`; `my_tickets`/`guest_tickets`; cash-out (all unused; `TICKET_IN_USE` for
  `in_use`, `reserved` and `restorable` with `until_at`; `NO_UNUSED_TICKETS`; duplicate;
  `PAYMENT_STATE`); a cash-out racing a join (two connections: never both); refund applied → no error;
  `refund_failed` → attention at two branches, retry and manual by a manager of the other branch,
  manual refused from `refund_pending`; `deposit_refund_request` refuses a ticket row; DF-20 at once
  and after the sweep; DF-21 price change; the sandbox flip guard; a guest cannot read the tables. The
  `tickets_refunded` push row is asserted in Guest's `guest-push.test.ts` (it needs `match_notify`).
- **`tests/match-money.test.ts`** (0262, 0265): shares parity; every §10 court-money row;
  `match_seat_settle` single, several, partial, `SEAT_OWED_CHANGED`, `NOTHING_OWED`, `BOOKING_TAB_OPEN`
  vs adopting an empty tab, replay, null key, shop_staff refused, other branch refused, two
  connections on one seat (one payment), a settle racing a link (never over the share), clearing a
  manual write-off; `match_link_payment` incl. closing a partly paid live tab, `[]`, `over_paid`,
  `already_linked`; write-off with a PIN by court_desk, `SEAT_NOT_STARTED`, a no-show refused, duplicate,
  `played`; DF-4 up and down; the R20 wall (till item, merge, adjustment, floor order); call-off with
  money taken → refund due; day close closes with a no-show; `unpaid_played_bookings` empty after the
  present players pay; `day_close_online`, `reports_figures`, `report_courts.matches`,
  `report_matches`.

## 10. Situations

| # | Situation | Tickets | Court money |
| --- | --- | --- | --- |
| 1 | Ticket SUCCESS, right amount | N `available` | none |
| 2 | Late SUCCESS after `failed`/`expired` | N `available` (MD-2) | none |
| 3 | SUCCESS, wrong amount or currency | none; whole row refunded `amount_mismatch` | none |
| 4 | SUCCESS after the payer deleted the account | N created, then `cashed_out`; refund `account_deleted` | none |
| 5 | Two attempts both succeed | two purchases, both kept | none |
| 6 | FAILED / EXPIRED / GIVE_UP | none; retry while `attempts_left > 0` | none |
| 7 | Join, request, approve, decline, leave while filling, bump, expiry, cancel, OM-44 | §5.8 moves (DB) | none: no reservation while filling |
| 8 | The 4th seat books | all `in_use` | reservation at `M`; each carrier owes its share |
| 9 | Leave after booking, before start | stays `in_use` (`left_late`) | that share is open |
| 10 | The `left_late` seat is refilled | released | the refill owes the share |
| 11 | Start with a `left_late` seat not refilled | forfeited; a deleted holder's is released and refunded (R18) | share written off (`left_late`) |
| 12 | Seat removed by staff after booking (`staff_error`/`duplicate`), not refilled | released (DB) | open before start, written off (`vacant`) after |
| 13 | Seat `attended` | released | owes `share − paid` |
| 14 | Seat `no_show` (account or friend) | forfeited (friend: the holder's ticket, DF-15) | written off (`no_show`) |
| 15 | A walk-in takes a no-show's number after start (R4) | the no-show keeps its forfeit | the walk-in owes the share; nothing written off for that number |
| 16 | Desk walk-in seat marked `no_show` | no ticket | written off |
| 17 | Correction `no_show` → `attended` while marks are open | `restored` | owes again |
| 18 | `attended` → `no_show` on a seat that already paid | refused `SEAT_MARK_LOCKED` detail `paid` (C18) | unchanged |
| 19 | Walked out without paying | released | desk starts, manager PIN writes off (`manual`, R1) |
| 20 | The walked-out player comes back to pay | — | Take share clears the manual write-off and takes it (MD-11) |
| 21 | The organiser pays everyone on the normal bill | released as attended | the pool credits every seat to 0; Assign makes it exact |
| 22 | A partly paid normal bill left open | — | seat settles refuse `BOOKING_TAB_OPEN`; Assign closes it at what was paid; seats owe the rest |
| 23 | The desk extends the match (price up 5,000) | — | `delta_owed 5,000`, taken on the normal bill and closed with Assign `[]` |
| 24 | Call-off short (R12) | present released, no-show forfeited | booking cancelled: nothing owed; money taken → refund due at the till |
| 25 | Staff cancel of a booked match | all released, marked no-shows restored | nothing owed; refund due if paid |
| 26 | All four `no_show` | all forfeited | booking not live: nothing owed, nothing written off |
| 27 | A café order on a match booking | — | refused `MATCH_BOOKING_NO_CAFE`; own café bill (R20) |
| 28 | Cash-out, nothing locked or restorable | `available` → `cashed_out` | none; one Qi refund of the price paid |
| 29 | Cash-out with a ticket in a match or held by a request | refused `TICKET_IN_USE` with `until_at` (R13) | none |
| 30 | Cash-out on the night of a no-show forfeit | refused `TICKET_IN_USE` (`restorable`) until the day closes | none |
| 31 | Qi refuses the refund | stay `cashed_out` | attention list at every branch → Retry or "Settled another way" (from `refund_failed` only, R23) |
| 32 | "Settled another way" while `refund_pending` | — | refused `PAYMENT_STATE` (R23) |
| 33 | Account deleted with tickets in every state | available refunded at once; filling seats left by the sweep, then refunded; booked seat `left_late`, released at start, refunded; forfeited stay forfeited | none |
| 34 | Sandbox (App Review) profile | sandbox tickets, sandbox matches only | never: sandbox matches never book |
| 35 | Someone flips `payment_sandbox` on a profile with live tickets | refused `INVALID_TRANSITION` `live_tickets` | none |
| 36 | Ticket price changed by the owner | bought tickets keep their price (DF-21) | cash-out returns the price paid |

## 11. What this lane needs from the other lanes

**DB:**
- The ticket DDL with §4.3's constraints and indexes; the helper rules of §5.8 (R16, R17, R18,
  restores only while restorable).
- `app.match_marks_open(p_match_id uuid) returns boolean` (internal, 0260): the attendance day-window
  test behind `SEAT_MARK_LOCKED day_closed`, `desk_match_detail.match.marks_open`, and Money's
  restorable rule. One definition.
- `delete_my_account` (0264) and `match_sweep` (0263) call `ticket_refund_deleted` last (§5.11, R25).
- `mark_match_seats`, `desk_call_off_short`, `desk_remove_seat`, `desk_add_seat` take
  `app.lock_match_money(match)` first (R19); `mark_match_seats` refuses a move to `no_show` while the
  seat has links (`SEAT_MARK_LOCKED` detail `paid`, C18).
- The lock primitive `app.lock_match_money` and the shared `app.match_carriers` (0260, `db.md` §2.2,
  §3.2); `match_try_book` books at `matches.price_iqd`; sandbox matches never book; only Money writes
  `match_seats.written_off_*`.
- `desk_match_detail` (rules-D20, the operator's list): `seats[].{share_iqd, paid_desk_iqd,
  credit_iqd, owed_iqd, written_off_iqd, write_off, write_off_reason, open_iqd, take_iqd}` from
  `match_seat_money` (the seat row `db.md`/`operator.md` list, **plus `take_iqd`**); `money {…,
  desk_paid_iqd, unassigned[]}` from `match_money`; `can.take_share` = `take_iqd > 0` (not
  `owed_iqd > 0`: a manually written-off seat can still be collected, MD-11); `can.write_off` = seat
  `in` or `attended`, started, `booked`/`played`, `owed_iqd > 0`, caller court_desk/manager/owner.
- The gate edit in 0260 walks Money's four service paths (§8).

**Guest:** `app.match_notify` accepts `tickets_refunded` with a NULL match id and route `tickets`
(R3); the fan-out trigger on `match_ticket_events` acts on `forfeited` only (R26), so Money's
`bought`/`cashed_out` events push nothing. The phone reads `my_tickets` (§5.7), `deposit_status` (§5.5)
and `ticket-begin` (§5.3) as specified, words `wallet_limit` with `max_available`, and maps
`RETRY_LATER` (R6).

**Operator:** reads `booking_bill.match/seats`, `booking_bill_states` new keys, `guest_tickets.
purchases[].cashout`, `day_close_online`, `report_courts.matches`, `report_matches` (counts in
`totals`, ticket money in `tickets`), `unpaid_played_bookings` new keys; sends `p_expected_owed_iqd` =
Σ picked `take_iqd`; offers Take share on a manually written-off row; write-off open to court_desk
with a manager PIN (R1); Assign with no seats closes a live court-only bill; maps the §5.14 and §6.10
codes and details. Where `operator.md` (written alongside) differed, this file's shapes win (R31),
and `operator.md` has been aligned: `TICKET_IN_USE`'s detail is the JSON `{reason, count, until_at}`
(not a bare time), `PAYMENT_STATE` has no `tab_has_orders` detail any more (R20 makes it impossible;
`empty` is new), and the seat money row carries `take_iqd`.

## 12. Rollout constraints for this lane

1. **Push A (functions only):** the `_shared/deposits.ts` type change and the `createAtGateway`
   extraction ride with Guest's `send-push` work (`deposit-begin` behaviour identical). No
   `ticket-begin`, no `config.toml`.
2. **Push B:** 0254 with 0253 and 0255 (CHECK widenings only).
3. **Push D** (after Guest's 0256 in push C): 0257–0265, each file with its own gates (R28) and
   `types.gen.ts`; commit bodies carry
   the waiver (R34). 0258 is never split: its hook re-issues land before any ticket row can exist.
   0259 lands in the same push as 0260/0261 (`match_notify`; a split only loses refund pushes). 0262's
   `_shared/mutation-types.json` edit starts `functions-deploy`: harmless, `match_seat_write_off` is
   never queued.
4. **Push E:** `ticket-begin` with `config.toml`, the coverage entry and the provider test, after 0259
   is on hosted.
5. The operator tag ships after 0262 and 0265 are on hosted. `matches_enabled` stays false everywhere
   until then, so no ticket can be bought (`MATCHES_OFF`).
6. Before real money: the ASK QI items (A8 in `docs/client/qi-card-activation.md`): fees, minimum
   amount, refund time limit, partial refunds, prepaid passes.

## 13. Resolutions

| Item | Resolution |
| --- | --- |
| Draft conflict 1 (write-off PIN) | R1: `(p_seat_id, p_reason, p_pin, p_device_id default null)`, court_desk/manager/owner + manager PIN grant (§6.6). |
| Draft conflict 2 (`court_cap_iqd` writers) | R2 (§4.4). |
| Draft conflict 3 (`tickets_refunded` route) | R3: route `tickets`, id NULL, through `match_notify` (§5.6). |
| Draft conflicts 4, 5 (walker list, `cashout_payment_id`) | R8 (§8, §4.3). |
| C1, G1 (lock gate on `deposit_apply`) | R15: the conditional hoist (§4.5). |
| C4 (restore after refund; DF-20 queue jam) | R13: `ticket_cashout_block` with `restorable`; DF-20 takes only `succeeded` purchases and filters blocked ones in its query (§5.8, §5.11). |
| C6 (over-linking) | R19 money lock (§6.1). |
| C7, conc-D16 (DF-16) | R20 wall (§6.8); MD-10 of the draft withdrawn. |
| C10 (double refund) | R23 for tickets and deposits (§4.5). |
| C15, conc-D17 (cash-out locks) | Unlocked pre-check, then lock `available` rows only, re-check (§5.9). |
| C16 (null keys) | `INVALID_ARGUMENT` detail `p_idempotency_key` in settle and link. |
| C18 (paid seat turned no-show) | DB refuses under the money lock (§11); invariant M12. |
| C19 (SEC-20 `ticket_count`) | Declared `n` (§4.6). |
| C20 (sandbox leaks) | Attention list filters sandbox tickets; the flip guard (§5.13). |
| C22 (write-off on `played`; delta collection) | `played` allowed (§6.6); `p_allocations = []` (§6.5). |
| conc-D1, rules-D3 (deletion) | R25: `delete_my_account` takes no match lock and calls only `ticket_refund_deleted`; the draft's lock claim for it is withdrawn. |
| conc-D2, rules-D2 (refund helper names) | Money's `tickets_cash_out` + `ticket_refund_deleted` (R8). |
| conc-D3, rules-D4 (ticket DDL) | DB writes it with §4.3's additions. |
| conc-D4 (write-off locking) | Under `match_lock`, after the money lock (§6.6). |
| conc-D9, rules-D5 (`guest_tickets`) | Money owns it; `cashout{…}` shape (§5.7). |
| conc-D10, rules-D21 (`day_close_online`) | Money's shape (§7.2). |
| conc-D11, rules-D23 (unassigned money) | `unassigned_iqd` + `unassigned[]` from the engine (§6.2). |
| conc-D14, rules-D16 (`my_tickets`) | Money's shape plus `sandbox`, `purchase_payment_id`, `match.status` (§5.7). |
| conc-D15, rules-D33 (`deposit_mode`) | `null` for a ticket (§5.5). |
| rules-D19 (booking-list money) | `booking_bill_states.seats_owing`, `seats_owed_iqd` (§6.7). |
| rules-D22 (reports) | Money's shapes; counts in `report_matches.totals`; ticket money from the one helper behind `reports_figures`, reachable as `report_matches.tickets` (§7). |
| rules-D26 (refund push) | `match_notify` (§5.6). |
| rules-D30, G13 (PIN copies) | Three copies (§6.10). |
| G3c, G5a, G6a, G7b, G8a, G12 | §6.10, §4.6, §7.4/§7.7, §5.14, §5.14/§6.10/§7.7, §6.4. |
| §4.1 #5, #9, #10 (wallet limit copy, pending purchase, cash-out note) | `max_available`, `pending` (§5.7); the note follows R13 (Guest words it). |
| §4.4 #3, #4 (reports reader, attention label) | §7.3; chain rows labelled by `purpose` (§5.10). |
| Draft open question 4 (write-off undo) | MD-11: collecting clears it. |
| Draft open question 6 (constants) | Constants (MD-6, MD-7). |
| Draft open question 7 (pool order) | Fixed (MD-9). |
| Draft open question 9 (past liability) | Exact replay of events (§7.1). |
| Draft open question 2 (Qi refund time limit) | Known limit (§15); ASK QI. |

## 14. Changes and additions to §1

Changes:
1. **Ordinals.** §1.1 moves up by three (coordinator, 2026-09-28): Money's files are 0254, 0258,
   0259, 0262, 0265.
2. **§1.5 placement.** `match_seat_money(uuid)` and `court_fee_written_off(uuid, uuid)` are created in
   0262 (Money's part), not 0260.
3. **`match_seat_settle`**, signature unchanged: `p_expected_owed_iqd` means Σ `take_iqd` of the
   selected seats; a NULL `p_idempotency_key` is refused. **`match_link_payment`**: NULL key refused;
   `p_allocations` may be `[]`.
4. **`deposit_refund_manual`**: `refund_failed` only, both purposes (R23).
5. §1.2 `tabs.court_cap_iqd` wording follows R2.

Additions:
1. **Internal functions:** `match_money(uuid, uuid) returns jsonb` (0262);
   `ticket_settle_success(uuid) returns text`, `tickets_cash_out(uuid, text, uuid)
   returns jsonb`, `ticket_refund_deleted(uuid default null) returns int`, `ticket_wallet(uuid,
   boolean) returns jsonb`, `ticket_cashout_block(uuid) returns jsonb` (0259);
   `ticket_money_figures(timestamptz, timestamptz, uuid[]) returns jsonb` (0265). Needed from DB in
   0260: `lock_match_money(uuid)` and `match_carriers` (both in `db.md`), and
   `match_marks_open(uuid) returns boolean` (§11).
2. **Triggers:** `app.trg_match_booking_no_cafe()` with `orders_match_booking_no_cafe` and
   `tab_adjustments_match_booking_no_cafe` (0262); `app.trg_profile_sandbox_tickets()` with
   `profiles_sandbox_tickets` (0259).
3. **Re-issued (§1.8):** `deposit_refund_retry` (0242, Money, 0258: chain rows); `panel_headline`
   (0096, Money, 0265: seven keys); `booking_bill`'s online list scoped to deposits (in its 0262
   re-issue).
4. **Constraints and index:** `booking_payments_ticket_amount`, `booking_payments_reason_by_purpose`,
   `tabs_court_cap_positive`, `match_tickets_cashout_same` (DB writes it, `db.md` §4.4.4);
   `booking_payments_one_active_ticket`.
5. **Staff codes:** `MATCH_BOOKING_NO_CAFE` (R20); `TICKET_IN_USE`, `CUSTOMER_NOT_FOUND` (R11).
6. **Refusal details:** `TICKET_COUNT_INVALID` `p_count`|`wallet_limit`; `TICKET_IN_USE` JSON
   `{reason, count, until_at}`; `PAYMENT_STATE` `ticket`|`over_paid`|`empty`; `INVALID_ARGUMENT`
   `p_idempotency_key`|`p_allocations`|`already_linked`; `INVALID_TRANSITION` `live_tickets`.
7. **Audit actions:** `ticket.purchase_begin`, `ticket.purchase`, `ticket.cashout`, `ticket.refunded`,
   `match.seat_settle`, `match.seat_write_off_cleared`, `match.payment_link`, `match.seat_write_off`.
8. **Gate:** `ORDER` gains `match_money_advisory` between `day_sessions` and `tabs` (R19; DB's 0260
   edit).
9. **Read shapes owned here:** `my_tickets`, `guest_tickets`, `deposit_status` (ticket),
   `ticket-begin`, `match_money`/`match_seat_money`, `booking_bill`, `booking_bill_states`,
   `unpaid_played_bookings`, `day_close_online`, `reports_figures` keys, `report_courts.matches`,
   `report_matches`.

## 15. Known limits

- Qi's refund time limit: a cash-out or DF-20 refund long after the purchase may be refused; it lands
  in `refund_failed` and a manager settles it by hand.
- A refund stuck in `refund_pending` can be settled by hand only after it turns `refund_failed` (up to
  ten reconciler attempts), R23.
- Cash-out waits for a purchase's tickets to come back and for the day of any fresh forfeit to close.
- The pool credits in a fixed order; the desk makes attribution exact with Assign. A wrong link
  cannot be undone; it only mislabels who paid.
- A live court-only tab on a match booking blocks day close until it is paid or assigned, as any open
  tab does.
- A restored forfeit leaves every past period's forfeit figure.
- A cashier holds `takeSeatPayment` but no cashier screen shows seats (Operator's limit).
- No discount or promotion on a match booking (R20); forgiveness is a write-off.
- Reports (0265): `report_drill` knows none of the seven new `panel_headline` keys (a drill on one is
  `INVALID_ARGUMENT`); `report_matches.tickets` and `totals.ticketForfeitsIqd` ignore the category and
  join-policy filters (ticket money is dated by its own stamps and belongs to a branch, not a
  category); `report_courts.matches` is the whole branch whatever `courtId` says; the refunds-waiting
  figures include an `amount_mismatch` refund still waiting; `unpaid_played_bookings.seats_owing`
  carries no `kind`, so a friend seat shows its holder's plain name.
- Every report over match bookings runs the money engine once per live match booking in range (an
  owner's "All branches" year is that many engine runs); the first place to look if a report slows.

## 16. Owner questions

These change what players or staff experience; none blocks the build.
1. **Headline revenue.** `padelRevenue` counts a match booking at its full price, written-off shares
   included, and forfeited tickets are not in it. Keep the headline as it is and show
   `matchWrittenOff` and `ticketForfeits` beside it (the build's default), or net them in?
2. **Qi fees on a cash-out** (and on a DF-20 refund): the guest gets the full price paid back (DF-21).
   Who bears Qi's payment and refund fees?
3. **"Settled another way" hands cash back with no till movement**, for tickets as for deposits
   today. Acceptable, or should it record a drawer payout?
4. **Tax on seat money and on forfeited tickets.** Court money is untaxed today (the court line is
   added after tax, `compute_tab_totals` 0211:252-310); a tax would need a tax path on the court line.
