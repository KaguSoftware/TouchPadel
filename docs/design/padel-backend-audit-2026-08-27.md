# Padel Booking Backend — Adversarial Audit (2026-08-27)

> **STATUS (2026-08-27, later the same day): C1 and H1-H5 are FIXED and pushed.**
>
> Migrations `20260827000048_booking_hardening.sql` and
> `20260827000049_replay_idempotency.sql` implement fix-order items 1, 2, 3, 4 and 7
> and are applied to the linked project `lczijabnorujcgmbuqlw`. Verified live against
> that project: an anonymous session calling `hold_slot` now returns `ACCOUNT_REQUIRED`,
> the exact call this document reproduces as succeeding.
>
> | Finding | State | Where |
> |---|---|---|
> | C1 anonymous hold | fixed — `ACCOUNT_REQUIRED`, live-hold cap, booking horizon, audit row | 0048 |
> | H1 no re-pricing on move/extend | fixed — `price_slot` re-resolved; manual overrides preserved | 0048 |
> | H2 no re-validation on move/extend | fixed — `assert_bookable` called | 0048 |
> | H3 idempotency read oracle | fixed — caller-scoped, `IDEMPOTENCY_CONFLICT` | 0048 |
> | H4 overnight rate rule divergence | fixed — `check (start_time < end_time)` + RPC guard | 0048 |
> | H5 lock-the-peeked-court | fixed — court re-checked after `FOR UPDATE`, raises `40001` | 0048 |
> | M1-M8 | **still open** — deliberately out of scope for this pass | — |
>
> Also closed here, found while fixing the above:
> * `app.pin_attempts` was the only table without RLS (not client-reachable — its
>   sole grant is to `service_role` — so a missing layer, not an open hole). 0048.
> * `send-push` and `replay` had **never been deployed** to the project, so
>   `notification_outbox` had never been drained. Deployed; the cron that drives
>   the sender now lives in 0048 instead of only in prose (README:100-119).
> * The offline `replay` path could apply `apply_discount`, `override_price` and
>   `record_waste` **twice**. 0049.
>
> Both CI guards that blessed C1 were the reason it shipped, and both now fail on it:
> `check:authz` no longer exempts `hold_slot` and probes ownership with two real
> principals; `check:locks` understands `app.lock_court` and no longer reads SQL
> comments as code. Regression suites: `tests/booking-hardening.test.ts`,
> `tests/replay-idempotency.test.ts`.
>
> **The findings below are left exactly as written.** They record what was true when
> the audit ran, which is what makes the reproductions checkable.


## Scope and method

The cafe backend has had **two** adversarial passes (17 defects in `01057bb`, 6 more in `e273b6c`).
The padel booking backend — the signed contract's #1 technical promise (*"double-booking prevention
… a database exclusion constraint on court and time range … delivered with concurrency tests"*,
SOW L279-288) — had had exactly one **reactive** fix (`22e4e36`, the 40P01 from CI run #17) and no
systematic audit.

**Method.** Every migration touching `reservations`, `courts`, `rate_rules`, `venue_settings` read in
full, latest-definition-wins; `packages/core` pricing/time/money read in full; then **every finding
below was reproduced against the running local stack** — real anonymous sessions, real account
guests, real staff logins, real RPC calls. Output quoted verbatim.

The local DB was reset to fixtures afterwards (`supabase db reset --local`). **Nothing touched the
hosted project.**

**Per the owner's instruction this is report-only.** No migrations, no RPC changes, no test additions
were made. Fix *shapes* are described; fixes are not applied.

One important negative result up front: **the contractual guest journey works.** A real account guest
can hold → confirm → cancel end to end. It has simply never been executed by the test suite (§4.1).

---

## CRITICAL

### C1 — An anonymous session can block any court, and the resulting hold is unconfirmable, uncancellable, unreadable and unaudited

`app.handle_new_user` returns early for anonymous users, so they get **no `profiles` row**:

```sql
  if coalesce(new.is_anonymous, false) then
    return new;                                -- cafe anonymous sessions: no profile
```

`app.hold_slot` is granted to `authenticated`, and Supabase anonymous sign-ins hold `authenticated`.
It writes:

```sql
       (select id from profiles where id = v_uid),          -- null for anonymous sessions
```

The comment is the author's own. The row lands with `guest_id = NULL`, `status = 'pending'` — and
`pending` is inside the exclusion constraint:

```sql
EXCLUDE USING gist (court_id WITH =, period WITH &&)
  WHERE ((status = ANY (ARRAY['pending','confirmed','arrived'])))
```

**Reproduced:**

```
uid: 4d91fcca-2027-4ad1-9107-f9e9fdb32878
profiles row for this uid: 0 (expect 0)
hold_slot           -> OK: {"duplicate":false,"price_iqd":40000,...,"reservation_id":"894f761a-..."}
read own hold        -> rows=0 err=none          <- cannot see it
confirm_booking     -> ERR: FORBIDDEN            <- cannot confirm it
cancel_reservation  -> ERR: FORBIDDEN            <- cannot cancel it
row as service_role -> {"guest_id":null,"status":"pending","kind":"hold","device_id":null}
audit rows for hold  -> 0                        <- no attribution
```

Both refusals come from the same expression — `v.guest_id is distinct from <uid>` — which is TRUE
when `guest_id` is NULL.

**It really does block real guests:**

```
anon holds slot     -> OK 5e08940c-cb8e-4df6-9d8b-892b4e36374f
real guest same slot-> ERR SLOT_TAKEN
desk can cancel it  -> OK                        <- the only remedy, one row at a time
```

**And it amplifies without limit.** There is no per-caller hold quota, no rate limit, and no upper
booking horizon (`hold_slot` checks only `p_start_at > now()`):

```
holds taken by ONE anonymous identity: 12/12 in 127ms — no quota, no rate limit
orphan pending holds now in table: 13
```

Anonymous signup is unlimited — the repo already knows this (`hardening.test.ts:165-168`:
*"anonymous sign-up is unlimited, so a fresh identity per attempt reset the per-caller window"*).
One script can hold every court × every open slot, arbitrarily far into the future, re-issuing every
`hold_ttl_seconds`, forever. The desk cannot even *find* the rows through the guest grid, because
`court_availability` hides a hold once its TTL lapses.

**Every layer of automation blesses it.** `rls-matrix.ts:301` expects `guest_anon_session` to
`execute` `hold_slot`; `check-rpc-authz.mjs:48` lists `hold_slot`, `confirm_booking`,
`cancel_reservation` and `expire_stale_holds` under `PUBLIC_BY_DESIGN` and never inspects them.

**Fix shape.** Refuse the call when the caller has no `profiles` row (a distinct code such as
`ACCOUNT_REQUIRED`, not a silent NULL write); add a per-`auth.uid()` cap on live holds; add a
`max_booking_horizon_days` setting; write an audit row on hold creation.

---

## HIGH

### H1 — `move_reservation` and `extend_reservation` never re-price. Real money.

Verified by counting call sites in the **live** function bodies:

| function | `assert_bookable` | `price_slot` | `write_audit` |
|---|---|---|---|
| `hold_slot` | 1 | 1 | **0** |
| `staff_create_reservation` | 1 | 1 | 2 |
| **`move_reservation`** | **0** | **0** | 1 |
| **`extend_reservation`** | **0** | **0** | 1 |

**Reproduced** with off-peak 09-17 (60=40k/90=55k/120=70k) and peak 17-23 (60=60k/90=80k/120=90k):

```
=== move OFF-PEAK -> PEAK ===
before: 40000 IQD via "PROBE offpeak"  (10:00 local, 60min)
move -> OK
after : 40000 IQD via "PROBE offpeak"  (20:00 local, 60min)
  peak 60min list price is 60000 -> venue loses 20000 IQD,
  and rate_rule_id still names the OFF-PEAK rule

=== extend 60 -> 90 ===
before: 40000 IQD for 60min
extend +30 -> OK
after : 40000 IQD for 90min  (90min list is 55000 -> venue loses 15000 IQD)
```

Both are one-click buttons on the desk calendar (`DeskCalendar.tsx:627` extend, `:680` move).
Repeating "Extend +30" runs a court all night at the one-hour price.

This also **silently corrupts price provenance**, which the schema header calls a design invariant
(`0007:2-3`, *"bookings snapshot (rate_rule_id, price_iqd) so a historical price is explainable
forever"*). After a move, `rate_rule_id` explains the price against a rule whose window the booking
no longer falls in.

**Fix shape.** Re-run `app.price_slot` inside both RPCs and re-stamp `rate_rule_id`/`price_iqd`, or
refuse the operation when the resolved rule changes and require an explicit override.

### H2 — `move`/`extend` bypass `assert_bookable` entirely

The two guards migration 0026 exists to add are trivially bypassed by moving or extending into them.

**Reproduced** (venue opens 09:00–23:00 local):

```
move a booking to 00:00 local              -> OK   <- assert_bookable BYPASSED
extend a 22:00 booking to 01:00 local      -> OK   <- assert_bookable BYPASSED

CREATE on closed date 2028-03-03            -> ERR CLOSED_DATE   (guard works here)
EXTEND on that same closed date             -> OK   <- assert_bookable BYPASSED
```

The contrast in the last two lines is the whole finding: the guard is correct on the create path and
simply absent on the mutate paths.

Neither RPC validates `p_court_id` either (no `is_active` check, no existence check — they rely on
the FK), so the desk can move a booking onto a **deactivated** court, after which it appears in
neither the guest grid nor the desk's court list.

**Fix shape.** Call `assert_bookable` on the post-mutation range in both RPCs; validate the target
court is active.

### H3 — The booking side never received 0038's caller-scoped idempotency fix: a cross-principal read oracle

`0038` fixed exactly this class for the cafe (`create_guest_order`, `open_tab`) and **never touched
`hold_slot` or `staff_create_reservation`**. Both still do an unscoped lookup, *before* the court
check, `assert_bookable`, and the degraded guard:

```sql
  select * into v_existing from reservations where idempotency_key = p_idempotency_key;
  if found then return jsonb_build_object('duplicate', true, 'reservation_id', v_existing.id,
    'status', v_existing.status, 'hold_expires_at', v_existing.hold_expires_at);
```

**Reproduced** — guest B is a *different principal* asking about a *different court and duration*:

```
A holds with key K  -> OK f314647e-bd10-4469-89bc-e499afcda0b2
B (different principal, different court-time, SAME key):
                    -> OK: {"status":"pending","duplicate":true,
                            "reservation_id":"f314647e-bd10-4469-89bc-e499afcda0b2",...}
  *** B received A's reservation_id + status. RLS says B cannot read this row. ***
  direct table read by B: rows=0 (RLS correctly hides it)
```

The last line is the point: RLS is doing its job, and the RPC hands out what RLS forbids. The key
namespace is shared with the desk, so a guest replaying a desk key reads a desk booking. Keys are
ULID-suffixed, so this is an oracle rather than an enumeration — the same characterisation `0038:35`
gives the cafe case it fixed.

`client_ref` has no replay handling at all: a collision escapes as a raw `23505`, mapped in no client.

**Fix shape.** Port the `0038` pattern — verify the replayed row belongs to the caller, else
`IDEMPOTENCY_CONFLICT`.

### H4 — An overnight rate rule makes SQL and `@touch/core` disagree: guest shown one price, charged another

`rate_rules` has **zero CHECK constraints** (verified live), `app.upsert_rate_rule` validates the day
array and the price blob but nothing about the times, and the admin UI is two free `<input
type="time">`. So `start_time > end_time` is creatable. SQL handles it by wrapping:

```sql
     and ( (r.start_time <= r.end_time and loc.lts::time >= r.start_time and loc.lts::time < r.end_time)
        or (r.start_time >  r.end_time and (loc.lts::time >= r.start_time or loc.lts::time < r.end_time)) )
```

`packages/core/src/pricing/rateRules.ts:79` refuses it:

```ts
    if (end <= start) return false; // midnight-crossing windows unsupported
```

**Reproduced.** One rule `22:00 → 02:00 @ 90 000` (priority 20) alongside peak `17:00–23:00 @ 60 000`
(priority 10); slot = 22:00 Asia/Baghdad, 60 min; identical rule/price data fed to both sides:

```
create overnight rule 22:00->02:00 (start > end) -> ACCEPTED
hold_slot charges   -> 90000 IQD          <- SQL wraps, picks the overnight rule
TS resolveRateRule  -> 60000 IQD via peak <- TS filters the overnight rule out
```

**A 30 000 IQD gap between the price the app displays and the price the guest is charged, from a
configuration change alone — no code change, no misconfiguration flagged anywhere.**

**Fix shape.** Decide one semantic. Either add `check (start_time < end_time)` and validate in
`upsert_rate_rule` (simplest, matches what TS already assumes), or implement wrapping in TS. Do not
leave the two disagreeing.

### H5 — `move`/`extend` lock the court they *peeked*, not the court they *write* (analysis; not reproduced)

Both read `court_id` **unlocked**, take `lock_court` on that value, then take the row lock and
**re-resolve the court from the freshly-locked row**. The code asserts this is safe:

```sql
  -- Re-resolve against the locked row. v.court_id cannot differ from the peek:
  -- changing it requires the advisory lock this transaction is holding.
```

That reasoning does not hold, because two concurrent movers lock **different pairs**. T_a moves R
`C1→C2` holding `{C1,C2}`; T_b peeked `C1` and holds `{C1,C3}`. After T_a commits, T_b re-reads
`v.court_id = C2` and — when `p_court_id` is NULL, exactly what the offline replay path sends
(`functions/replay/index.ts:67`) — writes to C2 holding locks on C1 and C3 only, entering the
exclusion window unserialized against a `hold_slot` that *does* hold `lock_court(C2)`.

The expected symptom is a raw **`40P01`** — the precise failure 0042 was written to eliminate, and
which `HANDOFF.md` classifies as a regression rather than a flake.

**Not reproduced**: it needs a three-way interleave with sub-millisecond timing, and I did not want
to claim a race I had not actually observed. Everything *around* it is verified — the unlocked peek,
the re-resolve, and the lock set are all in the deployed bodies.

**Fix shape.** After `FOR UPDATE`, re-check that `v.court_id` is in the locked set; if not, raise a
serialization error (`40001`) so the caller retries — the `TAB_MOVED` idiom 0038/0044 already use.

---

## MEDIUM

### M1 — `mark_reservation` has no temporal guard: a future paid booking can be silently resold

It validates the status transition and nothing else.

**Reproduced:**

```
booking starts 2028-03-05T10:00:00.000Z (~556 days away), status=confirmed
mark_reservation completed -> OK              <- no temporal guard
a different guest re-holds that slot -> OK    <- the booking was silently resold
original booking row still exists: status=completed, price=40000 (guest is never told)
```

`completed`, `no_show` and `cancelled` all fall out of the exclusion predicate, so the slot becomes
instantly rebookable and realtime broadcasts `busy:false`. `no_show` additionally fires **no** push
(migration 0024 only branches on `cancelled`). Both are single unconfirmed buttons on the desk
calendar (`DeskCalendar.tsx:604,616`).

**Fix shape.** Gate `arrived`/`no_show`/`completed` on `now() >= start_at` minus a small grace window.

### M2 — The quoted price is never the committed price

`hold_slot` resolves a price, **returns** it, and writes neither `rate_rule_id` nor `price_iqd`.
Confirmed live — the hold row reads `price_iqd: null`:

```
read own hold -> rows=1 [{"id":"75e230ca-...","status":"pending","price_iqd":null}]
```

`confirm_booking` then re-resolves from scratch and stamps *that*. Any rate edit inside the
300-second hold window silently changes the charge versus the quote, with no `PRICE_CHANGED` signal
and no record of what was quoted. The mobile confirm screen compounds it by discarding the price
`confirm_booking` returns (`confirm.tsx:51`).

**Fix shape.** Persist the quote on the hold; compare at confirm and raise `PRICE_CHANGED` on a
mismatch.

### M3 — Rate-boundary straddle: both implementations price from the slot start only

**Reproduced** — a 16:00–18:00 booking, half of which is peak time:

```
hold 16:00-18:00 (120min) -> 70000 IQD via "PROBE offpeak"
  off-peak 120min = 70000 | peak 120min = 90000
```

Not a divergence — a shared design hole, reachable from the mobile UI today with no tooling.
Relatedly, `hold_slot` never snaps `p_start_at` to a grid (`slotIncrementMin` is a *rendering*
parameter with no server counterpart), so `start_at = 09:01` makes one booking block two grid cells.

**Fix shape.** Price by covered segment, or refuse slots that straddle a rule boundary. Snap or
validate `start_at` server-side.

### M4 — Missing CHECK constraints where the code assumes them

Verified live: **`rate_rules` has zero CHECK constraints; `courts` has zero;** `venue_settings` has
only an id check.

| Missing | Consequence |
|---|---|
| `rate_rules` time ordering | H4 above |
| `venue_settings.hold_ttl_seconds > 0` | **Reproduced**: set to `0` → `hold_slot` OK, `confirm_booking -> HOLD_EXPIRED`. Every confirm fails, with no error pointing at the setting. |
| `courts.duration_options` NULL-element guard | `if not (p_duration_min = any (…))` evaluates to `NULL` when the array holds a NULL and nothing matches → `if NULL then` does not fire → the `INVALID_DURATION` guard **silently passes**. Latent (service-role writes only) but the wrong shape for a guard; `… is not true` would be correct. |

### M5 — `parseHHMM` throws on the database's own time format

`rate_rules.start_time` is `time`, and PostgREST returns `HH:MM:SS`. `packages/core`'s `parseHHMM`
accepts only `HH:MM` and throws otherwise. Observed while building the H4 comparison:

```
RangeError: expected 'HH:MM' (00:00-23:59), got '00:00:00'
  ❯ Module.parseHHMM src/time/tz.ts:83:17
  ❯ Module.resolveRateRule src/pricing/rateRules.ts:73:28
```

The mobile client only survives because `assemble.ts:85-88` truncates with `time.slice(0, 5)` — a
load-bearing workaround that **discards seconds**, so `end_time = '18:00:30'` means an 18:00 slot
matches in SQL and not in TS. The DB test helper already seeds `end_time: '23:59:59'`.

`buildSlotGrid` throws the same `RangeError` on an opening-hours value SQL accepts (`"24:00"`,
`"9:00"`), and it is called inside a `useMemo` with **no error boundary anywhere in `apps/mobile`** —
so a malformed opening-hours row is a white-screen crash on the guest's availability screen, a silent
no-op on the desk, and a total `OUTSIDE_HOURS` lockout server-side.

### M6 — `hold_slot` writes no audit row

Confirmed live (`write_audit` count = 0), contradicting the file's own header:
*"every mutating function … audit rows written atomically"*. Creating a hold is the act that takes a
court off the market and is the only reservation mutation with no trail. Combined with C1 —
`guest_id` NULL and a client-supplied, unvalidated `device_id` — a court-blocking hold is
**unattributable after the fact**. `expire_stale_holds` is likewise unaudited.

### M7 — `app.expire_stale_holds` is executable by every authenticated caller

Verified live: `anon=false, authenticated=true, service_role=false`. Every sibling internal helper
(`assert_bookable`, `assert_not_degraded_for`, `lock_court`, `write_audit`) is revoked from
`authenticated`; this one is not, and the grant is load-bearing only for `concurrency.test.ts:200`.
Called with no arguments it is an unbounded `UPDATE … FOR UPDATE` over the whole table. Semantically
it can only expire already-expired holds, so this is resource consumption rather than a correctness
hole — but it should be revoked and the test should call it as `service_role`.

### M8 — The degraded-mode trapped hold

`hold_slot` guards on `p_start_at`; `confirm_booking` guards on `v.start_at` but **only for
non-staff**; `cancel_reservation` has no degraded guard but does apply
`cancellation_window_hours`. So: healthy → guest holds a slot 6 h out → till goes silent for 45 s →
`confirm_booking` raises `DEGRADED_LOCKOUT`, and `cancel_reservation` raises `CANCELLATION_WINDOW`.
The guest can neither proceed nor retreat, and the slot stays blocked until TTL. For an anonymous
session it is worse: both calls fail with `FORBIDDEN` (C1) before either guard is even reached.

**Neither branch of `confirm_booking` under degraded mode has any test.**

---

## Disproved — recorded so the next pass does not re-audit them

- **Timezone handling is correct on both sides.** SQL uses `at time zone` from `venue_settings`
  everywhere (no `current_date`/`now()::date` anywhere in the padel path); TS uses `Intl` with a
  two-pass fixed point and never `getDay()`. Neither bakes in a DST assumption — correct, since Iraq
  abolished DST in 2008 and the code does not rely on that.
- **`0041_availability_local_day` is a cafe menu-86 fix**, not a court-availability fix. The padel
  path never had that bug.
- **Money rounding does not diverge.** Padel pricing is a pure integer *lookup* — no multiplication,
  no division, no float anywhere. Every SQL/TS pair that *does* divide (`split_evenly`,
  `apply_pct_discount`) rounds identically, and the SQL uses `numeric`, not `float8`.
- **No client-supplied price reaches the server.** Payload schemas are `.strict()` with explicit
  "no price fields" notes; the only price argument is manager/owner-gated and called by no app.
- **The exclusion constraint itself is sound.** No writer moves a row from outside the predicate back
  inside it, so there is no resurrection path. Its `status` column is the predicate of a partial
  index, so status updates *do* re-run the check — they are safe for the right reason, not the reason
  the `0042` header gives.
- **The contractual guest journey works** — see §4.1.

---

## Coverage gaps — why none of this was caught

### 4.1 The real guest journey has never been executed

**Reproduced — it works:**

```
profiles row: [{"full_name":"Probe journey"}]
hold_slot           -> OK  (price_iqd 40000)
read own hold        -> rows=1
confirm_booking     -> OK
cancel_reservation  -> OK
row as service_role -> {"status":"cancelled","kind":"booking","price_iqd":40000}
```

But **every padel test uses `anonymousSessionClient()`**. Because of C1 those holds cannot be
confirmed by their creator, so `concurrency.test.ts:197` routes the confirm through the **desk**
client, and `:187` records why: `guest_id: null, // anonymous session has no profile`. The suite
worked *around* C1 rather than failing on it.

`confirm_booking` is called exactly once in the whole suite — as staff, inside a race. **There is no
happy-path confirm test of any kind.**

### 4.2 The guards

| Guard | What it misses |
|---|---|
| **`check:locks`** | Detects only `FOR UPDATE` and `app.x(` calls. `0042`'s entire fix is `pg_advisory_xact_lock` inside `app.lock_court` — **the script has no concept of an advisory lock**. Nothing verifies the lock precedes the first write, nothing verifies the cross-court `least()/greatest()` ordering. Reversing them leaves the guard green. `reservations` is also the last rank in its `ORDER`, so an inversion involving it can essentially never fire. |
| **`check:authz`** | Exempts exactly the four ownership-guarded booking RPCs via `PUBLIC_BY_DESIGN`, and probes only the first line (all args NULL). It proves *role*, never *ownership* — and ownership is where C1 and H3 live. A refusal for the wrong reason also counts: `DEGRADED_LOCKOUT` is in its `REFUSED` regex. |
| **`rls-matrix`** | All ten booking RPC rules pass `NIL_UUID` and classify grant-layer outcomes only. It actively blesses C1 (`expect: ex('execute', …)` for `guest_anon_session` on `hold_slot`). |

### 4.3 Tests

- **Zero functional coverage** for `move_reservation` and `mark_reservation` — both appear only in the
  RLS matrix with a NIL uuid, which dies at the role guard before doing anything.
- **Twelve raise codes are never asserted anywhere**: `AUTH_REQUIRED`, `COURT_NOT_FOUND`,
  `INVALID_DURATION`, `SLOT_IN_PAST`, `HOLD_NOT_FOUND`, `GUEST_REQUIRED`, `RESERVATION_NOT_FOUND`,
  `NOT_MOVABLE`, `NOT_EXTENDABLE`, `NOT_CANCELLABLE`, `INVALID_TRANSITION`, `INVALID_PRICE`.
- `expire_stale_holds` is called once and only `expect(ok).toBe(true)` — its return count is never read.
- No test asserts a **SQLSTATE**; `outcome()` captures only `error.message`, so `23P01`, `40P01` and
  `P0001` are indistinguishable to the suite.
- **`confirm_booking` under degraded mode: no test on either branch.**
- The real TTL path is never exercised — no test lets a hold expire naturally.
- The **e2e job is commented out in CI** (`ci.yml:99-123`) and never runs.

### 4.4 Client error mapping

`apps/mobile/src/features/booking/errors.ts` does not map `CLOSED_DATE`, `OUTSIDE_HOURS`,
`NOT_MOVABLE`, `NOT_EXTENDABLE`, `INVALID_TRANSITION`, `INVALID_PRICE`, or any raw SQLSTATE — all
render "Something went wrong". `apps/operator/src/lib/errors.ts` is missing `CLOSED_DATE`,
`OUTSIDE_HOURS`, `HOLD_EXPIRED`, `CANCELLATION_WINDOW`, `SLOT_IN_PAST`, `GUEST_REQUIRED` — so the desk
gets a generic error for the two guards 0026 exists to add.

---

## Recommended fix order

Reported for decision. **Items 1, 2, 3, 4 and 7 were implemented in migrations 0048/0049 —
see the STATUS block at the top of this file.** Items 5, 6, 8 (partially), 9 and 10 remain open;
item 8 is done for both guard scripts.

| # | Work | Why first | Size |
|---|---|---|---|
| 1 | **C1** — refuse `hold_slot` without a `profiles` row; add a live-hold cap and a booking horizon; audit hold creation | The only finding remotely exploitable by an outsider, and it denies the venue's entire inventory | 1 migration + settings |
| 2 | **H1 + H2** — re-price and re-validate in `move`/`extend` | Loses real money on every desk mis-use, today, with no tooling | 1 migration |
| 3 | **H4 + M4** — `check (start_time < end_time)` + validation in `upsert_rate_rule` | Closes the quote-vs-charge divergence at the source; cheaper than implementing wrapping in TS | 1 migration |
| 4 | **H3** — port 0038's caller-scoped idempotency to the two booking RPCs | Cross-principal read oracle on an RLS-protected table | 1 migration |
| 5 | **M1** — temporal guard on `mark_reservation` | A mis-click resells a paid booking with no signal to anyone | small |
| 6 | **M2** — persist the quote, compare at confirm | Contractual "explainable forever" price provenance | small |
| 7 | **H5** — re-check the court after `FOR UPDATE`, raise `40001` | Prevents the 40P01 regression 0042 was written to remove | small |
| 8 | **Guards**: teach `check:locks` about advisory locks; drop the `PUBLIC_BY_DESIGN` exemption and probe ownership with two distinct principals | These are what let items 1–7 through CI | 1 day |
| 9 | **Tests**: the account-guest journey; `move`/`mark` functional coverage; the twelve unasserted codes; `confirm_booking` under degraded | Turns this audit into a permanent regression net | 1–2 days |
| 10 | **M5–M8**, client error maps, missing CHECK constraints | Cleanup | small |

Overlaps already logged in `docs/design/mobile-audit-2026-08-27.md`: `app.release_hold()` (no release
path exists — `cancel_reservation` refuses inside the cancellation window), `app.delete_account()`
(FK-blocked), and the missing `court-media` bucket. Items 1 and 6 here should land in the same
migration as `release_hold`.
